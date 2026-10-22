import assert from "node:assert/strict";

import type { PluginContext } from "emdash";

import { SEO_ADMIN_SETTINGS_STORAGE_VERSION } from "./admin-contract.ts";
import { createLinkHostPorts } from "./internal-link-host-ports.ts";
import { readLinkScopeDefinition } from "./internal-link-native-source.ts";
import {
	LINK_TARGET_OVERRIDE_BYTES,
	LINK_TARGET_SEO_FALLBACK_BYTES,
	createNativeLinkTargetPort,
} from "./internal-link-native-target.ts";
import { LINK_SUGGESTION_LIMITS, type LinkTargetRead } from "./internal-link-suggestions.ts";
import { GLOBAL_SETTINGS_KEY } from "./settings-runtime.ts";

// ---------------------------------------------------------------------------
// A recording query builder over an in-memory model. Select callbacks run
// against a recording expression builder, and their typeof/byte-length CASE
// expressions are evaluated with SQLite's value types, so the module's own
// bounded projections decide what a row returns.

type Row = Record<string, unknown>;
interface ExpressionNode { op: string; args: unknown[]; as(alias: string): { alias: string; node: ExpressionNode } }
interface Query { table: string; wheres: unknown[][]; selections: unknown[]; refs: Set<string>; limit: number | null }

const encoder = new TextEncoder();

function node(op: string, args: unknown[]): ExpressionNode {
	const created: ExpressionNode = { op, args, as: (alias) => ({ alias, node: created }) };
	return created;
}

function expressionBuilder(): any {
	const eb: any = (left: unknown, op: string, right: unknown) => node("cmp", [left, op, right]);
	eb.fn = Object.assign((name: string, args: unknown[]) => node("fn", [name, ...args]), {
		coalesce: (...args: unknown[]) => node("fn", ["coalesce", ...args]),
	});
	eb.cast = (value: unknown, type: string) => node("cast", [value, type]);
	eb.lit = (value: unknown) => node("lit", [value]);
	eb.val = (value: unknown) => node("val", [value]);
	eb.ref = (column: string) => node("ref", [column]);
	eb.and = (items: unknown[]) => node("and", items);
	const caseBuilder = (whens: unknown[][]): any => ({
		when: (...args: unknown[]) => ({ then: (value: unknown) => caseBuilder([...whens, [args, value]]) }),
		else: (value: unknown) => ({ end: () => node("case", [whens, value]) }),
		end: () => node("case", [whens, undefined]),
	});
	eb.case = () => caseBuilder([]);
	return eb;
}

function sqlType(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "number") return Number.isInteger(value) ? "integer" : "real";
	if (value instanceof Uint8Array) return "blob";
	return "text";
}

function compare(left: unknown, op: string, right: unknown): boolean | null {
	if (left === null || left === undefined || right === null || right === undefined) return null;
	const [l, r] = [left as number, right as number];
	if (op === "=") return l === r;
	if (op === "<>") return l !== r;
	if (op === ">") return l > r;
	if (op === "<=") return l <= r;
	throw new Error("Unsupported comparison " + op);
}

/** Bare strings are column references, except a comparison's right operand, which is a bound value. */
function evaluate(value: unknown, row: Row, bareIsValue = false): unknown {
	if (typeof value === "string") return bareIsValue ? value : row[value];
	if (!value || typeof value !== "object" || !("op" in value)) return value;
	const expression = value as ExpressionNode;
	const [first, second, third] = expression.args;
	switch (expression.op) {
		case "ref": return row[first as string];
		case "val": case "lit": return first;
		case "cast": {
			const inner = evaluate(first, row);
			return inner === null || inner === undefined ? null : inner instanceof Uint8Array ? inner : encoder.encode(String(inner));
		}
		case "fn": {
			const [name, ...rest] = expression.args;
			const values = rest.map((item) => evaluate(item, row));
			if (name === "typeof") return sqlType(values[0]);
			if (name === "length") return values[0] === null || values[0] === undefined ? null : values[0] instanceof Uint8Array ? values[0].length : [...String(values[0])].length;
			if (name === "coalesce") return values.find((item) => item !== null && item !== undefined) ?? null;
			throw new Error("Unsupported function " + String(name));
		}
		case "cmp": return compare(evaluate(first, row), second as string, evaluate(third, row, true));
		case "and": return expression.args.every((item) => evaluate(item, row) === true);
		case "case": {
			for (const [args, result] of first as unknown[][]) {
				const condition = (args as unknown[]).length === 1
					? evaluate((args as unknown[])[0], row)
					: compare(evaluate((args as unknown[])[0], row), (args as unknown[])[1] as string, evaluate((args as unknown[])[2], row, true));
				if (condition === true) return evaluate(result, row);
			}
			return second === undefined ? null : evaluate(second, row);
		}
	}
	throw new Error("Unsupported expression " + expression.op);
}

function collectRefs(value: unknown, refs: Set<string>, bareIsRef = true): void {
	if (typeof value === "string") {
		if (bareIsRef) refs.add(value.split(" as ")[0].split(".").pop() as string);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectRefs(item, refs, bareIsRef);
		return;
	}
	if (!value || typeof value !== "object") return;
	if ("alias" in value && "node" in value) return collectRefs((value as { node: unknown }).node, refs);
	const expression = value as ExpressionNode;
	if (expression.op === "ref") refs.add(expression.args[0] as string);
	else if (expression.op === "cmp") collectRefs(expression.args[0], refs);
	else if (expression.op === "fn") collectRefs(expression.args.slice(1), refs);
	else if (expression.op === "cast") collectRefs(expression.args[0], refs);
	else if (expression.op === "and") collectRefs(expression.args, refs);
	else if (expression.op === "case") {
		for (const [args, result] of expression.args[0] as unknown[][]) {
			const list = args as unknown[];
			collectRefs(list.length === 1 ? list[0] : list[0], refs);
			collectRefs(result, refs);
		}
		if (expression.args[1] !== undefined) collectRefs(expression.args[1], refs);
	}
}

function prefixed(alias: string, row: Row | undefined, columns: readonly string[]): Row {
	return Object.fromEntries(columns.map((column) => [alias + "." + column, row ? row[column] ?? null : null]));
}

const forbidden: string[] = [];

function fakeDatabase(model: Site, log: Query[]) {
	const builder = (name: string) => {
		const [table, alias] = name.split(" as ");
		const base = model.tables[table] ?? [];
		let rows: Row[] = alias ? base.map((row) => prefixed(alias, row, Object.keys(row))) : base.map((row) => ({ ...row }));
		const query: Query = { table: name, wheres: [], selections: [], refs: new Set(), limit: null };
		log.push(query);
		let order: string | null = null;
		const chain: Record<string, (...args: any[]) => unknown> = {
			leftJoin(target: string, left: unknown, right?: string) {
				const [joined, joinAlias] = target.split(" as ");
				const conditions: Array<{ left: string; ref?: string; value?: unknown }> = [];
				if (typeof left === "function") {
					const join: any = {
						onRef: (l: string, _op: string, r: string) => { conditions.push({ left: l, ref: r }); return join; },
						on: (l: string, _op: string, value: unknown) => { conditions.push({ left: l, value }); return join; },
					};
					left(join);
				} else conditions.push({ left: left as string, ref: right });
				const joinRows = (model.tables[joined] ?? []).map((row) => prefixed(joinAlias, row, Object.keys(row)));
				const columns = Object.keys((model.tables[joined] ?? [])[0] ?? { id: null });
				rows = rows.map((row) => {
					const match = joinRows.find((candidate) => conditions.every((condition) =>
						candidate[condition.left] === (condition.ref !== undefined ? row[condition.ref] : condition.value)));
					return { ...row, ...(match ?? prefixed(joinAlias, undefined, columns)) };
				});
				return chain;
			},
			select(selection: unknown) {
				const items = typeof selection === "function" ? (selection as (eb: unknown) => unknown[])(expressionBuilder()) : selection;
				query.selections = Array.isArray(items) ? items : [items];
				collectRefs(query.selections, query.refs);
				return chain;
			},
			where(column: string, op: string, value: unknown) {
				query.wheres.push([column, op, value]);
				rows = rows.filter((row) => {
					const current = row[column];
					if (op === "=") return current === value;
					if (op === "in") return (value as unknown[]).includes(current);
					if (op === "is") return value === null ? current === null || current === undefined : current === value;
					throw new Error("Unsupported where " + op);
				});
				return chain;
			},
			orderBy(column: string) {
				order = column;
				return chain;
			},
			limit(count: number) {
				query.limit = count;
				return chain;
			},
			async execute() {
				if (order !== null) rows = [...rows].sort((left, right) => String(left[order as string]).localeCompare(String(right[order as string])));
				const limited = query.limit === null ? rows : rows.slice(0, query.limit);
				return limited.map((row) => Object.fromEntries(query.selections.map((item) => {
					if (typeof item === "string") {
						const [source, name] = item.split(" as ");
						return [name ?? source.split(".").pop(), row[source] ?? null];
					}
					const aliased = item as { alias: string; node: ExpressionNode };
					return [aliased.alias, evaluate(aliased.node, row)];
				})));
			},
			async executeTakeFirst() {
				return (await chain.execute() as Row[])[0];
			},
		};
		return new Proxy(chain, {
			get(target, key) {
				if (typeof key === "string" && !Object.hasOwn(target, key)) forbidden.push("query." + key);
				return target[key as string];
			},
		});
	};
	return new Proxy({ selectFrom: builder }, {
		get(target, key) {
			if (key !== "selectFrom" && typeof key === "string" && key !== "then") forbidden.push("db." + key);
			return (target as Record<string, unknown>)[key as string];
		},
	});
}

// ---------------------------------------------------------------------------
// The model and a plugin context with only the surfaces a target read may use

const SITE = "https://example.com";
const STAMP = "2026-10-04 12:00:00";
const ID = (index: number) => "01KG" + String(index).padStart(22, "0");
const TARGET = ID(3);

interface Site {
	tables: Record<string, Row[]>;
	settings: { noindex: boolean; revision: string; contentTypeNoindex?: string[] };
	overrides: Record<string, unknown>;
	storageFails: boolean;
	kvFails: boolean;
	url: ((collection: string, id: string, env: Environment) => unknown) | null;
}

const entry = (index: number, patch: Row = {}): Row => ({
	id: ID(index), slug: "guide-" + index, status: "published", locale: "en", translation_group: "grp-entry-" + index,
	deleted_at: null, published_at: "2026-10-01T09:00:00.000Z", version: 2, updated_at: STAMP, title: "Guide " + index,
	body: '[{"_type":"block"}]', seo: null, ...patch,
});

function site(): Site {
	return {
		tables: {
			_emdash_collections: [{ id: "col-guides", slug: "guides", label: "Guides", hidden: 0, routable: 1, url_pattern: "/guides/{slug}", title_field: null, has_seo: 1 }],
			_emdash_fields: [
				{ id: "fld-title", collection_id: "col-guides", slug: "title", type: "string", column_type: "TEXT" },
				{ id: "fld-body", collection_id: "col-guides", slug: "body", type: "portableText", column_type: "JSON" },
			],
			_emdash_taxonomy_defs: [{ id: "def-topics-en", name: "topics", locale: "en", translation_group: "grp-def-topics", collections: '["stale"]' }],
			_emdash_taxonomy_def_groups: [{ id: "grp-def-topics", name: "topics", collections: '["guides"]' }],
			taxonomies: [
				{ id: "t-water", name: "topics", locale: "en", translation_group: "grp-topic-water" },
				{ id: "t-soil", name: "topics", locale: "en", translation_group: "grp-topic-soil" },
			],
			content_taxonomies: [{ collection: "guides", entry_id: "grp-entry-3", taxonomy_id: "grp-topic-water" }],
			_emdash_seo: [],
			ec_guides: [entry(3, { slug: "drip-irrigation", title: "Drip irrigation" }), entry(4)],
		},
		settings: { noindex: false, revision: "settings-1" },
		overrides: {},
		storageFails: false,
		kvFails: false,
		url: (collection, id) => {
			const row = sitesRow(collection, id);
			return row ? SITE + "/guides/" + String(row.slug) + "/" : null;
		},
	};
}
let current: Site;
const sitesRow = (collection: string, id: string) => current.tables["ec_" + collection]?.find((row) => row.id === id);
const targetRow = (model: Site) => model.tables.ec_guides.find((row) => row.id === TARGET) as Row;

interface Environment {
	db: unknown;
	ctx: PluginContext;
	ports: ReturnType<typeof createLinkHostPorts>;
	version: string;
	log: Query[];
	calls: Array<{ name: string; args: unknown[] }>;
}

function settingsRecord(noindex: boolean, contentTypeNoindex?: string[]) {
	return {
		version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-04T12:00:00.000Z", siteName: "Garden", siteUrl: SITE,
		organizationName: "Garden", organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "",
		noindex, indexingPreferenceConfirmed: true, ...(contentTypeNoindex === undefined ? {} : { contentTypeNoindex }),
	};
}

async function environment(model: Site): Promise<Environment> {
	current = model;
	const log: Query[] = [];
	const calls: Array<{ name: string; args: unknown[] }> = [];
	const env = {} as Environment;
	const surface = (name: string, methods: Record<string, ((...args: any[]) => unknown) | null>) => new Proxy({}, {
		get(_target, key) {
			if (typeof key !== "string" || key === "then") return undefined;
			const method = methods[key];
			if (method) return async (...args: unknown[]) => {
				calls.push({ name: name + "." + key, args });
				return method(...args);
			};
			// An absent optional method may be probed; any other access is a forbidden operation.
			if (!(key in methods)) forbidden.push(name + "." + key);
			return undefined;
		},
	});
	const parts: Row = {
		site: { name: "Garden", url: SITE, locale: "en" },
		log: { warn() {}, info() {}, error() {}, debug() {} },
		storage: new Proxy({
			overrides: surface("overrides", {
				get: (key: string) => {
					if (model.storageFails) throw new Error("Synthetic storage failure");
					return Object.hasOwn(model.overrides, key) ? model.overrides[key] : null;
				},
			}),
		}, {
			get(target, key) {
				if (key !== "overrides" && typeof key === "string") forbidden.push("storage." + key);
				return (target as Row)[key as string];
			},
		}),
		content: surface("content", { getPublicUrl: model.url ? (collection: string, id: string) => (model.url as NonNullable<Site["url"]>)(collection, id, env) : null }),
		kv: surface("kv", {
			getVersioned: (key: string) => {
				if (model.kvFails) throw new Error("Synthetic KV failure");
				return key === GLOBAL_SETTINGS_KEY
					? { value: settingsRecord(model.settings.noindex, model.settings.contentTypeNoindex), revision: model.settings.revision } : null;
			},
		}),
	};
	const ctx = new Proxy(parts, {
		get(target, key) {
			if (typeof key !== "string" || key === "then") return undefined;
			if (!Object.hasOwn(target, key)) forbidden.push("ctx." + key);
			return target[key];
		},
	}) as unknown as PluginContext;
	const ports = createLinkHostPorts(ctx);
	const policy = await ports.policy.readPolicy();
	if (policy.kind !== "readable") throw new Error("The fixture policy must be readable");
	Object.assign(env, { db: fakeDatabase(model, log), ctx, ports, version: policy.version, log, calls });
	return env;
}

interface ReadOptions {
	taxonomy?: string[];
	scopeVersion?: string;
	ref?: { collection: string; entryId: string };
	version?: (env: Environment) => string;
}

async function read(model: Site, options: ReadOptions = {}) {
	const env = await environment(model);
	const selection = {
		collection: "guides", locale: "en",
		taxonomy: options.taxonomy ? "topics" : null, termIds: options.taxonomy ? [...options.taxonomy].sort() : [],
	};
	let scopeVersion = options.scopeVersion;
	if (scopeVersion === undefined) {
		const definition = await readLinkScopeDefinition(env.db, selection);
		if (definition.kind !== "resolved") throw new Error("The fixture scope must resolve");
		scopeVersion = definition.scopeVersion;
	}
	env.log.length = 0;
	env.calls.length = 0;
	const port = createNativeLinkTargetPort({ db: env.db, ctx: env.ctx, policyObservation: env.ports.policyObservation });
	const result = await port.readTarget(options.ref ?? { collection: "guides", entryId: TARGET },
		{ ...selection, scopeVersion, upperId: ID(9) }, options.version ? options.version(env) : env.version);
	return {
		result,
		env,
		tables: env.log.map((query) => query.table),
		storage: env.calls.filter((call) => call.name === "overrides.get").map((call) => call.args[0]),
		urls: env.calls.filter((call) => call.name === "content.getPublicUrl").length,
		kv: env.calls.filter((call) => call.name.startsWith("kv.")).length,
	};
}

function found(result: LinkTargetRead, label: string) {
	if (result.kind !== "found") return assert.fail(label + ": expected a found target, got " + JSON.stringify(result));
	return result.target;
}

const PASS = ["_emdash_collections", "_emdash_fields", "_emdash_collections as c", "ec_guides", "_emdash_seo"];
const TAXONOMY_PASS = ["_emdash_collections", "_emdash_fields", "_emdash_taxonomy_defs as d", "taxonomies", "_emdash_collections as c", "ec_guides", "content_taxonomies", "_emdash_seo"];
const idKey = "guides:" + TARGET;
const slugKey = "guides:drip-irrigation";
const cases: string[] = [];
const withSeoField = (model: Site, type = "json", columnType = "JSON") => {
	model.tables._emdash_fields.push({ id: "fld-seo", collection_id: "col-guides", slug: "seo", type, column_type: columnType });
	return model;
};
const coreDisabled = (model: Site) => {
	model.tables._emdash_collections[0].has_seo = 0;
	return model;
};
const unreadablePolicy = (target: { noindex: boolean | null; targetPolicyVersion: string | null; publicUrl: string | null }, label: string) => {
	assert.equal(target.noindex, null, label + ": noindex");
	assert.equal(target.targetPolicyVersion, null, label + ": target policy");
	assert.equal(target.publicUrl, null, label + ": URL");
};

let networkCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
	networkCalls += 1;
	throw new Error("Network access is not allowed in the native target selfcheck");
}) as typeof fetch;

// ---------------------------------------------------------------------------
// The eligible control: two full observations around one host URL read

let controlPolicyVersion = "";
{
	const { result, env, tables, storage, urls, kv } = await read(site());
	const target = found(result, "control");
	assert.deepEqual(target, {
		collection: "guides", entryId: TARGET, locale: "en", status: "published", version: "entry-v1:2:" + STAMP, title: "Drip irrigation",
		publicUrl: SITE + "/guides/drip-irrigation/", inScope: true, noindex: false, globalPolicyVersion: env.version,
		targetPolicyVersion: target.targetPolicyVersion,
	});
	assert.match(String(target.targetPolicyVersion), /^link-target-policy-v1:sha256-[0-9a-f]{64}$/);
	assert.notEqual(target.targetPolicyVersion, target.globalPolicyVersion);
	controlPolicyVersion = String(target.targetPolicyVersion);
	assert.deepEqual(tables, [...PASS, ...PASS], "One observation before and one after the URL read");
	assert.deepEqual(storage, [idKey, slugKey, idKey, slugKey]);
	assert.equal(urls, 1);
	assert.deepEqual(env.calls.find((call) => call.name === "content.getPublicUrl")?.args, ["guides", TARGET]);
	assert.equal(kv, 0, "No global setting is reread per target");

	const rowQuery = env.log.find((query) => query.table === "ec_guides") as Query;
	assert.deepEqual(rowQuery.wheres, [["id", "=", TARGET], ["deleted_at", "is", null]]);
	assert.equal(rowQuery.limit, 1);
	assert.deepEqual(rowQuery.selections.filter((item) => typeof item === "string"), ["id"], "Every other row column is a bounded projection");
	assert.ok(!rowQuery.refs.has("body") && !rowQuery.refs.has("seo") && !rowQuery.refs.has("data"), "No body, data document or suppressed fallback column");
	const seoQuery = env.log.find((query) => query.table === "_emdash_seo") as Query;
	assert.deepEqual(seoQuery.wheres, [["collection", "=", "guides"], ["content_id", "=", TARGET]]);
	cases.push("an eligible target reads its definitions, row, core policy and override twice around exactly one URL read");
}

{
	// The complete worst case: taxonomy membership, core row and a slug fallback.
	const { result, tables, storage, urls } = await read(site(), { taxonomy: ["t-water"] });
	assert.equal(found(result, "worst case").inScope, true);
	assert.deepEqual(tables, [...TAXONOMY_PASS, ...TAXONOMY_PASS]);
	assert.equal(tables.length, 16, "Sixteen plugin SELECTs before the host URL helper's own reads");
	assert.equal(storage.length, 4, "Four override reads");
	assert.equal(urls, 1);
	cases.push("worst case: 16 SELECTs, 4 override reads and 1 host URL call, which itself reads the full row and the collection");
}

// ---------------------------------------------------------------------------
// Core SEO precedence and identity

{
	// Core SEO enabled without a row: defaults apply and a declared fallback is suppressed.
	const model = withSeoField(site());
	targetRow(model).seo = '{"noIndex":true}';
	const suppressed = await read(model);
	const target = found(suppressed.result, "core without row");
	assert.equal(target.noindex, false);
	assert.equal(suppressed.urls, 1);
	assert.ok(!(suppressed.env.log.find((query) => query.table === "ec_guides") as Query).refs.has("seo"));

	const noindexRow = site();
	noindexRow.tables._emdash_seo.push({ collection: "guides", content_id: TARGET, seo_no_index: 1, updated_at: "2026-10-04T12:00:00.000Z" });
	const excluded = await read(noindexRow);
	assert.equal(found(excluded.result, "core noindex").noindex, true);
	assert.equal(excluded.urls, 0, "A noindex target gets no URL read");
	assert.deepEqual(excluded.tables, PASS, "One observation without a URL read");

	const versionFor = async (rows: Row[]) => {
		const model = site();
		model.tables._emdash_seo.push(...rows);
		return found((await read(model)).result, "core identity").targetPolicyVersion;
	};
	const indexedRow = (updatedAt: string) => ({ collection: "guides", content_id: TARGET, seo_no_index: 0, updated_at: updatedAt });
	const first = await versionFor([indexedRow("2026-10-04T12:00:00.000Z")]);
	assert.equal(await versionFor([indexedRow("2026-10-04T12:00:00.000Z")]), first, "Identical observations give the same identity");
	assert.notEqual(await versionFor([indexedRow("2026-10-04T12:00:01.000Z")]), first, "A same-value upsert with a new timestamp is a new identity");
	assert.notEqual(first, controlPolicyVersion, "A row with defaults differs from no row");

	for (const [label, row] of [
		["noIndex outside 0 and 1", { seo_no_index: 2, updated_at: STAMP }],
		["text noIndex", { seo_no_index: "1", updated_at: STAMP }],
		["missing timestamp", { seo_no_index: 0, updated_at: null }],
		["oversized timestamp", { seo_no_index: 0, updated_at: "2".repeat(300) }],
		["timestamp beyond its identity bound", { seo_no_index: 0, updated_at: "2".repeat(65) }],
	] as const) {
		const model = site();
		model.tables._emdash_seo.push({ collection: "guides", content_id: TARGET, ...row });
		const outcome = await read(model);
		unreadablePolicy(found(outcome.result, label), label);
		assert.equal(outcome.urls, 0, label);
	}
	const invalidFlag = site();
	invalidFlag.tables._emdash_collections[0].has_seo = 2;
	assert.deepEqual((await read(invalidFlag, { scopeVersion: "scope-version-unused" })).result, { kind: "unavailable" });
	cases.push("core SEO owns the flag without a row; row presence, noIndex and timestamp form the identity; malformed core state is unreadable");
}

{
	// Without core SEO, only a declared seo column counts, decoded as the host does.
	const fallback = async (value: unknown, type = "json", columnType = "JSON") => {
		const model = withSeoField(coreDisabled(site()), type, columnType);
		targetRow(model).seo = value;
		return read(model);
	};
	const noindex = await fallback('{"noIndex":true}');
	assert.equal(found(noindex.result, "fallback noindex").noindex, true);
	assert.equal(noindex.urls, 0);
	assert.ok(!noindex.tables.includes("_emdash_seo"), "No core table read while core SEO is disabled");
	assert.ok((noindex.env.log.find((query) => query.table === "ec_guides") as Query).refs.has("seo"));
	for (const value of ['{"noIndex":false,"title":"Kept"}', "{}", null]) {
		const outcome = await fallback(value);
		assert.equal(found(outcome.result, "fallback " + String(value)).noindex, false);
		assert.equal(outcome.urls, 1);
	}
	const undeclared = await read(coreDisabled(site()));
	assert.equal(found(undeclared.result, "no declared fallback").noindex, false);
	assert.ok(!(undeclared.env.log.find((query) => query.table === "ec_guides") as Query).refs.has("seo"));
	for (const [label, value, type, columnType] of [
		["leading space is not JSON to the host", ' {"noIndex":true}', "json", "JSON"],
		["malformed JSON", "{oops", "json", "JSON"],
		["a list", "[true]", "json", "JSON"],
		["non-Boolean noIndex", '{"noIndex":"yes"}', "json", "JSON"],
		["plain text", "plain", "string", "TEXT"],
		["a number", 42, "json", "JSON"],
		["oversized", '{"noIndex":false,"pad":"' + "p".repeat(LINK_TARGET_SEO_FALLBACK_BYTES) + '"}', "json", "JSON"],
		["a storageless declaration", '{"noIndex":false}', "reference", "TEXT"],
		["a numeric declaration", '{"noIndex":false}', "number", "REAL"],
	] as const) {
		const outcome = await fallback(value, type, columnType);
		unreadablePolicy(found(outcome.result, label), label);
		assert.equal(outcome.urls, 0, label);
	}
	cases.push("disabled core SEO reads only a declared fallback column through a bounded projection; unreadable fallback is never indexable");
}

// ---------------------------------------------------------------------------
// Overrides: ID first, slug only when the ID record is absent

{
	const override = (robots: unknown, updatedAt: unknown = "2026-10-04T12:00:00.000Z") => ({ ref: "x", robots, updatedAt });
	const withOverrides = (records: Record<string, unknown>) => {
		const model = site();
		model.overrides = records;
		return model;
	};
	const idNoindex = await read(withOverrides({ [idKey]: override(" NoIndex, Follow ") }));
	assert.equal(found(idNoindex.result, "ID noindex").noindex, true);
	assert.deepEqual(idNoindex.storage, [idKey], "A present ID record suppresses the slug read");

	const idSuppresses = await read(withOverrides({ [idKey]: override("index,follow"), [slugKey]: override("noindex") }));
	assert.equal(found(idSuppresses.result, "ID suppresses slug").noindex, false);
	assert.deepEqual(idSuppresses.storage, [idKey, idKey]);

	const slugFallback = await read(withOverrides({ [slugKey]: override("noindex") }));
	assert.equal(found(slugFallback.result, "slug fallback").noindex, true);
	assert.deepEqual(slugFallback.storage, [idKey, slugKey]);

	const noSlug = site();
	targetRow(noSlug).slug = null;
	assert.deepEqual((await read(noSlug)).storage, [idKey, idKey], "Without a slug only the ID record is read");

	const first = found((await read(withOverrides({ [idKey]: override("index") }))).result, "override identity").targetPolicyVersion;
	const touched = found((await read(withOverrides({ [idKey]: override("index", "2026-10-04T12:00:01.000Z") }))).result, "override touched").targetPolicyVersion;
	assert.notEqual(touched, first, "An override rewrite changes the identity");
	assert.notEqual(first, controlPolicyVersion);

	for (const [label, records, fails] of [
		["non-text robots", { [idKey]: override(7) }, false],
		["missing timestamp", { [idKey]: { ref: "x", robots: "index" } }, false],
		["oversized record", { [idKey]: override("index " + "x".repeat(LINK_TARGET_OVERRIDE_BYTES)) }, false],
		["a falsy ID record", { [idKey]: false, [slugKey]: override("index") }, false],
		["store failure", {}, true],
	] as const) {
		const model = withOverrides(records as Record<string, unknown>);
		model.storageFails = fails;
		const outcome = await read(model);
		unreadablePolicy(found(outcome.result, label), label);
		assert.equal(outcome.urls, 0, label);
	}
	cases.push("ID-first overrides follow the existing resolver; robots noindex excludes; malformed, oversized or failed reads are unreadable");
}

{
	// The site-wide flag from this invocation's policy observation.
	const model = site();
	model.settings.noindex = true;
	const outcome = await read(model);
	const target = found(outcome.result, "global noindex");
	assert.equal(target.noindex, true);
	assert.match(String(target.targetPolicyVersion), /^link-target-policy-v1:/);
	assert.equal(outcome.urls, 0);
	assert.equal(outcome.kv, 0);
	cases.push("the invocation's global noindex excludes without any per-target settings read");
}

{
	// A content type noindex rule for the target's own type, from the same observation.
	const model = site();
	model.settings.contentTypeNoindex = ["guides"];
	const outcome = await read(model);
	const target = found(outcome.result, "content type rule");
	assert.equal(target.noindex, true);
	assert.equal(target.publicUrl, null);
	assert.equal(outcome.urls, 0, "a ruled target gets no URL read");
	assert.equal(outcome.kv, 0);
	const other = site();
	other.settings.contentTypeNoindex = ["posts"];
	const otherTarget = found((await read(other)).result, "another type's rule");
	assert.equal(otherTarget.noindex, false, "a rule for another type changes nothing here");
	assert.equal(otherTarget.publicUrl, SITE + "/guides/drip-irrigation/");
	cases.push("a content type rule for the target's type excludes it under the invocation's policy, another type's rule does not");
}

// ---------------------------------------------------------------------------
// Exact entry state and scope

{
	for (const [label, patch, field, expected] of [
		["draft", { status: "draft" }, "status", "draft"],
		["another locale", { locale: "fr" }, "locale", "fr"],
	] as const) {
		const model = site();
		Object.assign(targetRow(model), patch);
		const outcome = await read(model);
		assert.equal((found(outcome.result, label) as unknown as Row)[field], expected, label);
		assert.equal(outcome.urls, 0, label);
	}
	const deleted = site();
	targetRow(deleted).deleted_at = STAMP;
	assert.deepEqual((await read(deleted)).result, { kind: "missing" });
	assert.deepEqual((await read(site(), { ref: { collection: "guides", entryId: ID(99) } })).result, { kind: "missing" });
	const untitled = site();
	targetRow(untitled).title = "   ";
	const noTitle = await read(untitled);
	assert.equal(found(noTitle.result, "no title").title, "");
	assert.equal(noTitle.urls, 0);

	const unassigned = site();
	unassigned.tables.content_taxonomies = [{ collection: "guides", entry_id: "grp-entry-3", taxonomy_id: "grp-topic-soil" }];
	const outside = await read(unassigned, { taxonomy: ["t-water"] });
	assert.equal(found(outside.result, "unassigned").inScope, false);
	assert.equal(outside.urls, 0);
	const otherCollection = site();
	otherCollection.tables.content_taxonomies = [{ collection: "pages", entry_id: "grp-entry-3", taxonomy_id: "grp-topic-water" }];
	assert.equal(found((await read(otherCollection, { taxonomy: ["t-water"] })).result, "other collection").inScope, false);
	const ungrouped = site();
	targetRow(ungrouped).translation_group = null;
	assert.equal(found((await read(ungrouped, { taxonomy: ["t-water"] })).result, "no group").inScope, false);
	const either = await read(site(), { taxonomy: ["t-soil", "t-water"] });
	assert.equal(found(either.result, "either term").inScope, true);

	const stale = await read(site(), { scopeVersion: "link-scope-v1:sha256-" + "0".repeat(64) });
	assert.equal(found(stale.result, "changed definitions").inScope, null);
	assert.equal(stale.urls, 0);
	const detached = site();
	detached.tables._emdash_taxonomy_def_groups[0].collections = "[]";
	assert.deepEqual((await read(detached, { taxonomy: ["t-water"], scopeVersion: "link-scope-v1:sha256-" + "0".repeat(64) })).result, { kind: "unavailable" });
	cases.push("deleted or absent rows are missing; status, locale, title, group membership and definition drift withhold the URL read");
}

// ---------------------------------------------------------------------------
// The host URL and drift around it

{
	const withUrl = (url: Site["url"]) => {
		const model = site();
		model.url = url;
		return model;
	};
	const nullUrl = await read(withUrl(() => null));
	assert.equal(found(nullUrl.result, "null URL").publicUrl, null);
	assert.equal(nullUrl.urls, 1);
	assert.deepEqual(nullUrl.tables, [...PASS, ...PASS]);
	for (const [label, url] of [
		["URL failure", () => { throw new Error("Synthetic URL failure"); }],
		["non-text URL", () => 7],
		["oversized URL", () => SITE + "/" + "u".repeat(LINK_SUGGESTION_LIMITS.urlChars)],
	] as const) {
		const outcome = await read(withUrl(url));
		assert.deepEqual(outcome.result, { kind: "unavailable" }, label);
		assert.equal(outcome.urls, 1, label);
	}
	const noHelper = await read(withUrl(null));
	assert.equal(found(noHelper.result, "no URL helper").publicUrl, null);
	assert.equal(noHelper.urls, 0);
	assert.deepEqual(noHelper.tables, PASS);

	const exactUrl = await read(withUrl(() => "https://example.com/Guides/Drip%20Irrigation?ref=x#top"));
	assert.equal(found(exactUrl.result, "exact URL").publicUrl, "https://example.com/Guides/Drip%20Irrigation?ref=x#top", "The host URL is kept exactly");

	const drifting = (change: (model: Site, env: Environment) => unknown) => {
		const model = site();
		model.url = (collection, id, env) => {
			const url = SITE + "/guides/drip-irrigation/";
			const pending = change(model, env);
			return pending instanceof Promise ? pending.then(() => url) : url;
		};
		return model;
	};
	for (const [label, change, expected] of [
		["unpublished meanwhile", (model: Site) => { targetRow(model).status = "draft"; }, { kind: "unavailable" }],
		["new version meanwhile", (model: Site) => { targetRow(model).version = 3; }, { kind: "unavailable" }],
		["retitled meanwhile", (model: Site) => { targetRow(model).title = "Drip watering"; }, { kind: "unavailable" }],
		["deleted meanwhile", (model: Site) => { targetRow(model).deleted_at = STAMP; }, { kind: "missing" }],
		["core row written meanwhile", (model: Site) => { model.tables._emdash_seo.push({ collection: "guides", content_id: TARGET, seo_no_index: 0, updated_at: STAMP }); }, { kind: "unavailable" }],
		["override written meanwhile", (model: Site) => { model.overrides[idKey] = { ref: "x", robots: "index", updatedAt: STAMP }; }, { kind: "unavailable" }],
		["route definition changed meanwhile", (model: Site) => { model.tables._emdash_collections[0].url_pattern = "/learn/{slug}"; }, { kind: "unavailable" }],
		["global policy unreadable meanwhile", async (model: Site, env: Environment) => { model.kvFails = true; await env.ports.policy.readPolicy(); }, { kind: "unavailable" }],
		["global policy changed meanwhile", async (model: Site, env: Environment) => { model.settings = { noindex: true, revision: "settings-2" }; await env.ports.policy.readPolicy(); }, { kind: "unavailable" }],
	] as const) {
		const outcome = await read(drifting(change as (model: Site, env: Environment) => unknown));
		assert.deepEqual(outcome.result, expected, label);
		assert.equal(outcome.urls, 1, label);
	}
	const membershipDrift = drifting((model) => { model.tables.content_taxonomies = []; });
	assert.deepEqual((await read(membershipDrift, { taxonomy: ["t-water"] })).result, { kind: "unavailable" }, "membership removed meanwhile");

	// A date route: the host formats {year} from the row's published date while resolving the URL.
	const dateRoute = (afterFormatting?: (model: Site) => void) => {
		const model = site();
		model.tables._emdash_collections[0].url_pattern = "/blog/{year}/{slug}";
		model.url = (collection, id) => {
			const row = sitesRow(collection, id) as Row;
			const url = SITE + "/blog/" + String(row.published_at).slice(0, 4) + "/" + String(row.slug) + "/";
			afterFormatting?.(model);
			return url;
		};
		return model;
	};
	const stable = await read(dateRoute());
	assert.equal(found(stable.result, "stable date route").publicUrl, SITE + "/blog/2026/drip-irrigation/");
	assert.deepEqual(stable.tables, [...PASS, ...PASS]);
	const redated = await read(dateRoute((model) => { targetRow(model).published_at = "2025-12-31T23:00:00.000Z"; }));
	assert.deepEqual(redated.result, { kind: "unavailable" }, "A date-only change while the URL resolved refuses the earlier URL");
	assert.equal(redated.urls, 1);
	for (const [label, value] of [["a numeric published date", 1_759_309_200_000], ["an oversized published date", "2".repeat(300)]] as const) {
		const model = site();
		targetRow(model).published_at = value;
		const outcome = await read(model);
		assert.deepEqual(outcome.result, { kind: "unavailable" }, label);
		assert.equal(outcome.urls, 0, label);
	}
	const undated = site();
	targetRow(undated).published_at = null;
	assert.equal(found((await read(undated)).result, "no published date").publicUrl, SITE + "/guides/drip-irrigation/");
	cases.push("the host URL is kept exactly or refused; any version, date, scope, membership or policy drift around it refuses the target");
}

// ---------------------------------------------------------------------------
// Inputs and the exact policy lookup refuse before any read

{
	for (const [label, options] of [
		["another policy version", { version: (env: Environment) => env.version.slice(0, -1) + (env.version.endsWith("0") ? "1" : "0") }],
		["a malformed policy version", { version: () => " " }],
		["another collection's target", { ref: { collection: "pages", entryId: TARGET } }],
		["an empty entry", { ref: { collection: "guides", entryId: "" } }],
		["a malformed scope version", { scopeVersion: "" }],
	] as const) {
		const outcome = await read(site(), options as ReadOptions);
		assert.deepEqual(outcome.result, { kind: "unavailable" }, label);
		assert.deepEqual(outcome.tables, [], label);
		assert.equal(outcome.env.calls.length, 0, label);
	}
	const clearedModel = site();
	const cleared = await environment(clearedModel);
	clearedModel.kvFails = true;
	await cleared.ports.policy.readPolicy();
	const port = createNativeLinkTargetPort({ db: cleared.db, ctx: cleared.ctx, policyObservation: cleared.ports.policyObservation });
	cleared.log.length = 0;
	cleared.calls.length = 0;
	assert.deepEqual(await port.readTarget({ collection: "guides", entryId: TARGET },
		{ collection: "guides", locale: "en", taxonomy: null, termIds: [], scopeVersion: "link-scope-v1:sha256-" + "0".repeat(64), upperId: null },
		cleared.version), { kind: "unavailable" });
	assert.equal(cleared.log.length, 0, "A cleared observation refuses before any read");
	cases.push("a missing, cleared or mismatched policy observation and malformed inputs refuse before any read");
}

assert.deepEqual(forbidden, [], "A forbidden database, context, storage or content operation was touched");
assert.equal(networkCalls, 0, "The target port reached the network");
globalThis.fetch = realFetch;
console.log("Internal link native target selfcheck passed: " + cases.length + " groups");
