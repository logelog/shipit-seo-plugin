// Native exact-target proof on one disposable, migrated SQLite connection.
// Driver statements and returned rows include the SDK's full-row URL read;
// they do not establish physical reads, CPU, D1, Postgres or sandbox cost.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === "--target" && ["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(args[1]),
	"Usage: node scripts/published-host/internal-link-target-smoke.mjs --target native-1.1.0|native-1.2.0|native-1.3.0");
process.env.SHIPIT_HOST_TARGET = args[1];
const { hostPackageRoot, sourceRoot, target } = await import("./host-loader.mjs");
assert.equal(target.name, args[1]);
const realFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
	networkCalls += 1;
	throw new Error("External networking is disabled in this smoke check");
};

const { Kysely, sql } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const { createContentAccess } = await import("emdash");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createNativeLinkCandidatePort } = await source("internal-link-native-source.ts");
const { createNativeLinkTargetPort, LINK_TARGET_SEO_FALLBACK_BYTES } = await source("internal-link-native-target.ts");
const { createLinkHostPorts } = await source("internal-link-host-ports.ts");
const { GLOBAL_SETTINGS_KEY } = await source("settings-runtime.ts");
const { SEO_ADMIN_SETTINGS_STORAGE_VERSION } = await source("admin-contract.ts");

// The published runtime's i18n mirror is configured before its first URL call.
async function hostDistExport(name) {
	const dist = new URL("dist/", hostPackageRoot("emdash"));
	for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const alias = readFileSync(new URL(file, dist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(new URL(file, dist).href))[alias];
	}
	throw new Error(`Published ${name} was not found`);
}
const SchemaRegistry = await hostDistExport("SchemaRegistry");
const PluginContextFactory = await hostDistExport("PluginContextFactory");
const setI18nConfig = await hostDistExport("setI18nConfig");
setI18nConfig({ defaultLocale: "en", locales: ["en", "fr"], prefixDefaultLocale: false });

const statements = [];
let phase = { owner: "fixture", label: "setup", surface: "fixture" };
async function tagged(owner, label, surface, action) {
	const previous = phase;
	phase = { owner, label, surface };
	try { return await action(); } finally { phase = previous; }
}
const fixture = (label, action) => tagged("fixture", label, "fixture", action);

function observedDialect(dialect) {
	return new Proxy(dialect, {
		get(object, property) {
			const value = Reflect.get(object, property, object);
			if (property !== "createDriver") return typeof value === "function" ? value.bind(object) : value;
			return () => {
				const driver = object.createDriver();
				const observed = new WeakMap();
				const originals = new WeakMap();
				return new Proxy(driver, {
					get(owner, key) {
						if (key === "acquireConnection") return async (...args) => {
							const connection = await owner.acquireConnection(...args);
							if (observed.has(connection)) return observed.get(connection);
							const wrapped = new Proxy(connection, {
								get(origin, method) {
									const member = Reflect.get(origin, method, origin);
									if (method !== "executeQuery") return typeof member === "function" ? member.bind(origin) : member;
									return async (query) => {
										assert.ok(statements.length < 20_000, "The fixture exceeded its statement bound");
										const entry = { ...phase, sql: query.sql, parameters: [...query.parameters], returnedRows: 0, rowKeys: [], maxTextBytes: 0, bodyBytes: 0, fallbackBytes: 0 };
										statements.push(entry);
										try {
											const result = await member.call(origin, query);
											entry.returnedRows = result.rows.length;
											entry.rowKeys = [...new Set(result.rows.flatMap((row) => Object.keys(row)))].sort();
											for (const row of result.rows) for (const [column, cell] of Object.entries(row)) {
												if (typeof cell !== "string") continue;
												const bytes = Buffer.byteLength(cell);
												entry.maxTextBytes = Math.max(entry.maxTextBytes, bytes);
												if (column === "body") entry.bodyBytes = Math.max(entry.bodyBytes, bytes);
												if (column === "seo_text") entry.fallbackBytes = Math.max(entry.fallbackBytes, bytes);
											}
											return result;
										} catch (error) {
											entry.error = String(error instanceof Error ? error.message : error).slice(0, 1024);
											throw error;
										}
									};
								},
							});
							observed.set(connection, wrapped);
							originals.set(wrapped, connection);
							return wrapped;
						};
						if (key === "releaseConnection") return (connection, ...args) =>
							owner.releaseConnection(originals.get(connection) ?? connection, ...args);
						const member = Reflect.get(owner, key, owner);
						return typeof member === "function" ? member.bind(owner) : member;
					},
				});
			};
		},
	});
}

const db = new Kysely({ dialect: observedDialect(createDialect({ url: ":memory:" })) });
const SITE = "https://example.com";
const COLLECTION = "link_targets";
const TABLE = "ec_" + COLLECTION;
const STAMP = "2026-10-04 12:00:00";
const TOUCHED = "2026-10-04 12:00:01";
const PUBLISHED = "2026-01-02 10:00:00";
const id = (index) => "01K" + String(index).padStart(23, "0");
const termId = (index) => "01T" + String(index).padStart(23, "0");
const TARGET = id(1);
const ENTRY_GROUP = "grp-entry-water";
const termGroup = (index) => "grp-topic-" + index;
const idKey = COLLECTION + ":" + TARGET;
const slugKey = COLLECTION + ":drip-irrigation";
const BODY = JSON.stringify([{ _type: "block", _key: "large", children: [{ _type: "span", _key: "large-s", text: "b".repeat(70_000), marks: [] }], markDefs: [] }]);
const forbidden = [];
const sdkCalls = [];
const overrideCalls = [];
const report = {
	target: target.name, emdash: target.versions.get("emdash"), storage: "migrated sqlite :memory:", workers: 1, status: "running",
	measurementLimit: "Complete driver statements, errors and returned rows, including SDK full-row hydration. Not physical reads, CPU, Cloudflare D1, Postgres or sandbox evidence. Fixture writes are tagged separately.",
	measurements: [], sqlShapes: [], races: [],
};

function kindOf(entry) {
	if (!/^\s*select\b/i.test(entry.sql)) return "write";
	if (entry.surface === "sdk-url") return /\bfrom "ec_/i.test(entry.sql) ? "sdk-hydration" : "sdk-collection";
	if (/\bfrom "ec_/i.test(entry.sql)) return "projection";
	if (/\bfrom "_emdash_collections"/i.test(entry.sql)) return entry.sql.includes('"has_seo"') ? "seo-definition" : "collection";
	if (/\bfrom "_emdash_fields"/i.test(entry.sql)) return "fields";
	if (/\bfrom "_emdash_taxonomy_defs"/i.test(entry.sql)) return "taxonomy";
	if (/\bfrom "taxonomies"/i.test(entry.sql)) return "terms";
	if (/\bfrom "content_taxonomies"/i.test(entry.sql)) return "membership";
	if (/\bfrom "_emdash_seo"/i.test(entry.sql)) return "core";
	if (/\bfrom "_plugin_storage"/i.test(entry.sql)) return "override";
	return "other";
}

function assertTargetRead(entry) {
	const kind = kindOf(entry);
	assert.notEqual(kind, "write", "The target port issued a write");
	assert.notEqual(kind, "other", "Unexpected target query: " + entry.sql.slice(0, 160));
	assert.doesNotMatch(entry.sql, /\bcount\s*\(/i, "The target port must not count");
	if (kind === "sdk-hydration") {
		assert.match(entry.sql, /select \* from "ec_link_targets"/i);
		assert.match(entry.sql, /where id = \?\s+and deleted_at is null/i);
		assert.deepEqual(entry.parameters, [sdkCalls.at(-1).entryId]);
		assert.ok(entry.returnedRows <= 1, "SDK point lookup returned multiple rows");
		return;
	}
	if (kind === "sdk-collection") {
		assert.match(entry.sql, /select \* from "_emdash_collections" where "slug" = \?$/i);
		assert.deepEqual(entry.parameters, [COLLECTION]);
		assert.ok(entry.returnedRows <= 1);
		return;
	}
	assert.doesNotMatch(entry.sql, /(?:\bselect\s+(?:distinct\s+)?|,)\s*(?:"[^"]+"\.)?\*/i,
		"Adapter and override reads must use explicit projections");
	if (kind === "override") {
		assert.match(entry.sql, /where "plugin_id" = \? and "collection" = \? and "id" = \?$/i);
		assert.equal(entry.parameters[1], "overrides");
		assert.ok(entry.returnedRows <= 1);
		assert.deepEqual(entry.rowKeys, entry.returnedRows ? ["data"] : []);
		return;
	}
	const max = { collection: 1, fields: 6, taxonomy: 1, terms: 8, "seo-definition": 2, projection: 1, membership: 8, core: 1 }[kind];
	assert.ok(max, "Unbounded target query kind: " + kind);
	assert.match(entry.sql, /\blimit \?$/i);
	const limit = entry.parameters.at(-1);
	assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= max);
	assert.ok(entry.returnedRows <= limit);
	if (kind === "projection") {
		assert.match(entry.sql, /where "id" = \? and "deleted_at" is null limit \?$/i);
		assert.doesNotMatch(entry.sql, /"(?:body|data|live_revision_id|draft_revision_id)"/i);
		assert.ok(entry.rowKeys.every((key) => key === "id" || /^(?:[a-z_]+|t\d+)_(?:kind|text|value)$/.test(key)));
		assert.ok(entry.fallbackBytes <= LINK_TARGET_SEO_FALLBACK_BYTES);
	}
	if (kind === "membership") {
		assert.doesNotMatch(entry.sql, /"(?:locale|status|published_at|deleted_at)"/i);
		assert.ok(entry.parameters.includes(ENTRY_GROUP), "Membership must use the content translation group");
		assert.ok(entry.rowKeys.every((key) => key === "taxonomy_id"));
	}
}

async function measure(label, action, profile = "target") {
	const start = statements.length;
	const urls = sdkCalls.length;
	const stores = overrideCalls.length;
	let value;
	let failure;
	try { value = await tagged("product", label, profile === "sdk" ? "sdk-url" : "target", action); }
	catch (error) { failure = error; }
	const run = statements.slice(start);
	const product = run.filter((entry) => entry.owner === "product");
	const mutations = run.filter((entry) => entry.owner === "fixture");
	const byKind = {};
	for (const entry of product) {
		const kind = kindOf(entry);
		const counts = byKind[kind] ??= { queries: 0, returnedRows: 0, errors: 0, maxRows: 0 };
		counts.queries += 1;
		counts.returnedRows += entry.returnedRows;
		counts.errors += Number(Boolean(entry.error));
		counts.maxRows = Math.max(counts.maxRows, entry.returnedRows);
		if (profile === "target") assertTargetRead(entry);
		if (profile !== "observer" && !report.sqlShapes.some((shape) => shape.kind === kind)) {
			report.sqlShapes.push({ kind, sql: entry.sql.slice(0, 1024), truncated: entry.sql.length > 1024, parameterCount: entry.parameters.length });
		}
	}
	assert.equal(product.filter((entry) => kindOf(entry) === "write").length, 0, label + ": product write");
	if (profile === "target") {
		for (const [kind, counts] of Object.entries(byKind)) assert.ok(counts.queries <= (kind === "override" ? 4 : 2), label + ": extra " + kind + " reads");
		assert.ok(sdkCalls.length - urls <= 1, label + ": extra SDK URL call");
		assert.ok(overrideCalls.length - stores <= 4, label + ": extra override read");
		assert.equal(byKind.override?.queries ?? 0, overrideCalls.length - stores, "Every override read must reach the real store");
	}
	const measurement = {
		label, profile, outcome: failure ? "threw" : value?.kind ?? "returned", queries: product.length,
		returnedRows: product.reduce((sum, entry) => sum + entry.returnedRows, 0), errors: product.filter((entry) => entry.error).length,
		writes: 0, fixtureWrites: mutations.filter((entry) => kindOf(entry) === "write").length,
		sdkUrlCalls: sdkCalls.length - urls, overrideReads: overrideCalls.length - stores, byKind,
		maxSdkBodyBytes: Math.max(0, ...product.filter((entry) => kindOf(entry) === "sdk-hydration").map((entry) => entry.bodyBytes)),
		maxFallbackBytes: Math.max(0, ...product.map((entry) => entry.fallbackBytes)),
	};
	report.measurements.push(measurement);
	if (failure) throw failure;
	return { value, measurement, product, mutations, overrideKeys: overrideCalls.slice(stores) };
}

function found(result, label) {
	assert.equal(result.kind, "found", label + ": target must be found");
	return result.target;
}
function unreadable(result, label) {
	const target = found(result, label);
	assert.equal(target.noindex, null, label);
	assert.equal(target.targetPolicyVersion, null, label);
	assert.equal(target.publicUrl, null, label);
}

let failure;
try {
	await fixture("migrations-and-schema", async () => {
		await runMigrations(db);
		const schema = new SchemaRegistry(db);
		await schema.createCollection({ slug: COLLECTION, label: "Link targets", hasSeo: true, routable: true, urlPattern: "/blog/{year}/{slug}" });
		for (const [slug, type] of [["headline", "string"], ["title", "string"], ["name", "string"], ["excerpt", "text"], ["summary", "text"], ["description", "text"], ["body", "portableText"], ["seo", "json"]]) {
			await schema.createField(COLLECTION, { slug, label: slug, type });
		}
		await db.updateTable("_emdash_collections").set({ title_field: "headline" }).where("slug", "=", COLLECTION).execute();
		await db.insertInto("_emdash_taxonomy_def_groups").values({ id: "grp-def-topics", name: "topics", collections: JSON.stringify([COLLECTION]), hierarchical: 0 }).execute();
		await db.insertInto("_emdash_taxonomy_defs").values({ id: "def-topics-en", name: "topics", label: "Topics", locale: "en", translation_group: "grp-def-topics", collections: '["stale"]', hierarchical: 0 }).execute();
		await db.insertInto("taxonomies").values([
			...Array.from({ length: 8 }, (_, index) => ({ id: termId(index + 1), name: "topics", slug: "topic-" + (index + 1), label: "Topic " + (index + 1), locale: "en", translation_group: termGroup(index + 1) })),
			{ id: termId(9), name: "topics", slug: "topic-1", label: "Sujet 1", locale: "fr", translation_group: termGroup(1) },
		]).execute();
		const entry = (index, values = {}) => ({ id: id(index), slug: "guide-" + index, status: "published", locale: "en", translation_group: "grp-entry-" + index,
			created_at: STAMP, updated_at: STAMP, published_at: PUBLISHED, deleted_at: null, version: 3,
			headline: "Drip irrigation", title: "Secondary title", name: "Third title", body: BODY, seo: '{"noIndex":true}', ...values });
		await db.insertInto(TABLE).values([
			entry(1, { slug: "drip-irrigation", translation_group: ENTRY_GROUP }),
			entry(2, { slug: "arrosage", locale: "fr", translation_group: ENTRY_GROUP, headline: "Arrosage goutte a goutte" }),
			entry(3, { deleted_at: STAMP }), entry(4, { status: "draft" }), entry(5, { locale: "fr" }),
		]).execute();
		await db.insertInto("content_taxonomies").values([
			...Array.from({ length: 8 }, (_, index) => ({ collection: COLLECTION, entry_id: ENTRY_GROUP, taxonomy_id: termGroup(index + 1), locale: "fr", status: "draft" })),
			{ collection: COLLECTION, entry_id: TARGET, taxonomy_id: termId(1), locale: "en", status: "published" },
		]).execute();
	});

	const factory = new PluginContextFactory({ db, siteInfo: { siteName: "Garden", siteUrl: SITE, locale: "en", trailingSlash: "always" } });
	const baseContext = factory.createContext({ id: "link-target-proof", version: "0.0.0", capabilities: ["content:read", "schema:read"], admin: {}, storage: { overrides: { indexes: [] } }, allowedHosts: [] });
	const genuineContent = createContentAccess(db, { site: baseContext.site });
	const realStore = baseContext.storage.overrides;
	await fixture("global-policy", () => baseContext.kv.set(GLOBAL_SETTINGS_KEY, {
		version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-04T12:00:00.000Z", siteName: "Garden", siteUrl: SITE,
		organizationName: "Garden", organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false, indexingPreferenceConfirmed: true,
	}));
	const hostPorts = createLinkHostPorts(baseContext);
	const policy = await tagged("preparation", "policy", "policy", () => hostPorts.policy.readPolicy());
	assert.equal(policy.kind, "readable");
	const globalPolicyVersion = policy.version;
	assert.equal(hostPorts.policyObservation(globalPolicyVersion)?.noindex, false);
	const candidates = createNativeLinkCandidatePort(db);
	let urlMutation = null;
	const guarded = (name, methods) => new Proxy(methods, {
		get(object, key) {
			if (typeof key !== "string" || key === "then") return undefined;
			if (Object.hasOwn(object, key)) return object[key];
			forbidden.push(name + "." + key);
			throw new Error("Forbidden proof surface: " + name + "." + key);
		},
	});
	const content = guarded("content", { async getPublicUrl(collection, entryId) {
		sdkCalls.push({ collection, entryId });
		const url = await tagged("product", phase.label, "sdk-url", () => genuineContent.getPublicUrl(collection, entryId));
		if (urlMutation) await urlMutation(url);
		return url;
	} });
	const ctx = guarded("ctx", {
		site: baseContext.site, log: baseContext.log, content,
		storage: guarded("storage", { overrides: guarded("overrides", { async get(key) {
			overrideCalls.push(key);
			return realStore.get(key);
		} }) }),
		kv: guarded("kv", {}),
	});
	const port = createNativeLinkTargetPort({ db, ctx, policyObservation: hostPorts.policyObservation });
	const scopeFor = async (label, locale = "en", selected = [termId(1)]) => {
		const resolution = await tagged("preparation", label + "-scope", "scope", () => candidates.resolveScope({
			collection: COLLECTION, locale, taxonomy: selected === null ? null : { taxonomy: "topics", termIds: selected },
		}, [COLLECTION]));
		assert.equal(resolution.kind, "resolved", label);
		return resolution.scope;
	};
	const read = async (label, options = {}) => {
		const scope = options.scope ?? await scopeFor(label, options.locale ?? "en", options.terms === undefined ? [termId(1)] : options.terms);
		return measure(label, () => port.readTarget({ collection: COLLECTION, entryId: options.entryId ?? TARGET }, scope, globalPolicyVersion));
	};
	const reset = () => fixture("restore-target", async () => {
		await db.updateTable("_emdash_collections").set({ has_seo: 1 }).where("slug", "=", COLLECTION).execute();
		await db.updateTable(TABLE).set({ slug: "drip-irrigation", version: 3, updated_at: STAMP, published_at: PUBLISHED, seo: '{"noIndex":true}' }).where("id", "=", TARGET).execute();
		await db.deleteFrom("_emdash_seo").where("collection", "=", COLLECTION).execute();
		await realStore.delete(idKey);
		await realStore.delete(slugKey);
		urlMutation = null;
	});
	const core = (noindex, updated = STAMP) => fixture("core-policy", () => db.insertInto("_emdash_seo").values({ collection: COLLECTION, content_id: TARGET, seo_no_index: noindex, created_at: STAMP, updated_at: updated })
		.onConflict((oc) => oc.columns(["collection", "content_id"]).doUpdateSet({ seo_no_index: noindex, updated_at: updated })).execute());
	const override = (robots) => ({ ref: idKey, robots, updatedAt: "2026-10-04T12:00:00.000Z" });

	const observerStart = statements.length;
	const observer = await measure("observer-returned-row-control", () => db.selectFrom(TABLE).select("id").where("id", "=", TARGET).execute(), "observer");
	assert.equal(observer.measurement.queries, 1);
	assert.equal(observer.measurement.returnedRows, 1);
	assert.equal(statements[observerStart].returnedRows, 1);
	await assert.rejects(() => measure("observer-error-control", () => db.selectFrom("missing_link_target_proof_table").select("id").execute(), "observer"));
	assert.equal(report.measurements.at(-1).queries, 1);
	assert.equal(report.measurements.at(-1).errors, 1);
	const shape = await fixture("schema-controls", async () => ({
		seo: (await sql`PRAGMA table_info(_emdash_seo)`.execute(db)).rows,
		content: (await sql`PRAGMA table_info(ec_link_targets)`.execute(db)).rows,
		pivot: (await sql`PRAGMA table_info(content_taxonomies)`.execute(db)).rows,
		pivotForeignKeys: (await sql`PRAGMA foreign_key_list(content_taxonomies)`.execute(db)).rows,
	}));
	assert.deepEqual(shape.seo.filter((row) => row.pk).sort((a, b) => a.pk - b.pk).map((row) => row.name), ["collection", "content_id"]);
	assert.equal(shape.seo.find((row) => row.name === "seo_no_index").type.toUpperCase(), "INTEGER");
	assert.equal(shape.seo.find((row) => row.name === "updated_at").type.toUpperCase(), "TEXT");
	assert.deepEqual(shape.pivot.filter((row) => row.pk).sort((a, b) => a.pk - b.pk).map((row) => row.name), ["collection", "entry_id", "taxonomy_id"]);
	assert.equal(shape.pivotForeignKeys.length, 0, "The migrated pivot stores groups without a row-ID foreign key");
	assert.notEqual(TARGET, ENTRY_GROUP);
	assert.notEqual(termId(1), termGroup(1));
	report.fixture = { migrated: true, seoPrimaryKey: ["collection", "content_id"], pivotPrimaryKey: ["collection", "entry_id", "taxonomy_id"], fallbackColumnType: shape.content.find((row) => row.name === "seo").type, bodyBytes: Buffer.byteLength(BODY), distinctGroupIds: true };

	const urlControl = await measure("genuine-sdk-url-control", () => content.getPublicUrl(COLLECTION, TARGET), "sdk");
	assert.equal(urlControl.value, SITE + "/blog/2026/drip-irrigation/");
	assert.equal(urlControl.measurement.queries, 2);
	assert.equal(urlControl.measurement.byKind["sdk-hydration"].returnedRows, 1);
	assert.equal(urlControl.measurement.maxSdkBodyBytes, Buffer.byteLength(BODY));
	const enabled = await read("core-enabled-absent-row-suppresses-fallback");
	const enabledTarget = found(enabled.value, "core defaults");
	assert.equal(enabledTarget.noindex, false);
	assert.equal(enabledTarget.publicUrl, urlControl.value);
	assert.equal(enabledTarget.inScope, true);
	assert.equal(enabled.measurement.sdkUrlCalls, 1);
	assert.equal(enabled.measurement.byKind.membership.returnedRows, 2);
	assert.equal(enabled.measurement.maxSdkBodyBytes, Buffer.byteLength(BODY));
	assert.ok(enabled.product.filter((entry) => kindOf(entry) === "projection").every((entry) => !entry.sql.includes('"seo"')));
	assert.ok(enabled.product.filter((entry) => kindOf(entry) === "core").every((entry) => entry.returnedRows === 0));
	assert.equal(enabled.measurement.queries, Object.values(enabled.measurement.byKind).reduce((sum, value) => sum + value.queries, 0));

	await core(0);
	const coreFirst = found((await read("core-row-defaults")).value, "core row");
	const coreAgain = found((await read("core-row-identical")).value, "same core row");
	assert.equal(coreFirst.targetPolicyVersion, coreAgain.targetPolicyVersion);
	assert.notEqual(coreFirst.targetPolicyVersion, enabledTarget.targetPolicyVersion);
	await core(0, TOUCHED);
	const coreTouched = found((await read("core-timestamp-only-change")).value, "core timestamp");
	assert.equal(coreTouched.version, coreFirst.version);
	assert.notEqual(coreTouched.targetPolicyVersion, coreFirst.targetPolicyVersion);
	await core(1);
	const excluded = await read("core-noindex");
	assert.equal(found(excluded.value, "core noindex").noindex, true);
	assert.equal(excluded.measurement.sdkUrlCalls, 0);

	await reset();
	await fixture("disable-core", () => db.updateTable("_emdash_collections").set({ has_seo: 0 }).where("slug", "=", COLLECTION).execute());
	for (const [label, raw, expected] of [
		["false", '{"noIndex":false,"title":"Stored"}', false], ["true", '{"noIndex":true}', true], ["empty-object", "{}", false], ["null", null, false],
		["original-prefix", ' {"noIndex":false}', null], ["malformed", "{oops", null], ["array", "[true]", null], ["nonboolean", '{"noIndex":"yes"}', null],
		["oversized", '{"noIndex":false,"pad":"' + "p".repeat(LINK_TARGET_SEO_FALLBACK_BYTES) + '"}', null],
	]) {
		await fixture("fallback-" + label, () => db.updateTable(TABLE).set({ seo: raw }).where("id", "=", TARGET).execute());
		const result = await read("disabled-core-fallback-" + label);
		assert.equal(result.measurement.byKind.core, undefined, "Disabled core SEO must not read the core table");
		if (expected === null) unreadable(result.value, label);
		else assert.equal(found(result.value, label).noindex, expected);
		assert.equal(result.measurement.sdkUrlCalls, Number(expected === false));
		if (label === "oversized") assert.ok(result.product.filter((entry) => kindOf(entry) === "projection").every((entry) => entry.fallbackBytes === 0));
	}

	await reset();
	await fixture("id-override-control", async () => {
		await realStore.put(idKey, override("index,follow"));
		await realStore.put(slugKey, override("noindex"));
	});
	const idWins = await read("id-override-suppresses-slug");
	assert.equal(found(idWins.value, "ID override").noindex, false);
	assert.deepEqual(idWins.overrideKeys, [idKey, idKey]);
	await fixture("remove-id-override", () => realStore.delete(idKey));
	const slugWins = await read("slug-override-when-id-absent");
	assert.equal(found(slugWins.value, "slug override").noindex, true);
	assert.deepEqual(slugWins.overrideKeys, [idKey, slugKey]);
	assert.equal(slugWins.measurement.sdkUrlCalls, 0);
	await fixture("id-noindex", () => realStore.put(idKey, override(" NoIndex, Follow ")));
	const idNoindex = await read("id-override-noindex");
	assert.equal(found(idNoindex.value, "ID noindex").noindex, true);
	assert.deepEqual(idNoindex.overrideKeys, [idKey]);
	await fixture("malformed-id", () => realStore.put(idKey, { ref: idKey, robots: 7, updatedAt: STAMP }));
	unreadable((await read("malformed-id-override")).value, "malformed override");
	await fixture("falsy-id-control", async () => {
		await realStore.put(idKey, false);
		await realStore.put(slugKey, override("index,follow"));
	});
	const falsyId = await read("falsy-id-alias-read-is-still-unreadable");
	unreadable(falsyId.value, "falsy ID override");
	assert.deepEqual(falsyId.overrideKeys, [idKey, slugKey]);
	assert.equal(falsyId.measurement.sdkUrlCalls, 0);

	await reset();
	await core(0);
	await fixture("worst-case-slug-override", () => realStore.put(slugKey, override("index,follow")));
	const worst = await read("eight-terms-core-row-slug-override", { terms: Array.from({ length: 8 }, (_, index) => termId(index + 1)) });
	assert.equal(found(worst.value, "eight terms").publicUrl, urlControl.value);
	assert.equal(worst.measurement.byKind.membership.queries, 2);
	assert.equal(worst.measurement.byKind.membership.returnedRows, 16);
	assert.equal(worst.measurement.byKind.terms.returnedRows, 16);
	assert.deepEqual(worst.overrideKeys, [idKey, slugKey, idKey, slugKey]);
	const observations = 2;
	const projectedKinds = ["collection", "fields", "taxonomy", "terms", "seo-definition", "projection", "membership", "core"];
	for (const kind of projectedKinds) assert.equal(worst.measurement.byKind[kind].queries, observations, "Two exact observations: " + kind);
	assert.equal(worst.measurement.byKind.fields.returnedRows, 12, "Six eligible field definitions per observation");
	const expectedQueries = projectedKinds.length * observations + worst.overrideKeys.length + 2;
	assert.equal(worst.measurement.queries, expectedQueries, "Every adapter, override and SDK query must be accounted for");
	report.worstCase = { label: worst.measurement.label, queries: worst.measurement.queries, returnedRows: worst.measurement.returnedRows, writes: 0, sdkBodyBytes: worst.measurement.maxSdkBodyBytes };

	await reset();
	const french = await read("same-group-french-route", { entryId: id(2), locale: "fr", terms: [termId(9)] });
	assert.equal(found(french.value, "French target").publicUrl, SITE + "/fr/blog/2026/arrosage/");
	assert.equal(found(french.value, "French target").inScope, true);
	const wrongLocale = await read("target-locale-mismatch", { entryId: id(2) });
	assert.equal(found(wrongLocale.value, "wrong locale").locale, "fr");
	assert.equal(wrongLocale.measurement.sdkUrlCalls, 0);
	assert.equal(found(wrongLocale.value, "wrong locale").publicUrl, null);
	const draft = await read("draft-target", { entryId: id(4), terms: null });
	assert.equal(found(draft.value, "draft").status, "draft");
	assert.equal(draft.measurement.sdkUrlCalls, 0);
	const deleted = await read("deleted-target", { entryId: id(3), terms: null });
	assert.deepEqual(deleted.value, { kind: "missing" });
	assert.equal(deleted.measurement.sdkUrlCalls, 0);
	await fixture("remove-group-membership", () => db.deleteFrom("content_taxonomies").where("collection", "=", COLLECTION).where("entry_id", "=", ENTRY_GROUP).where("taxonomy_id", "=", termGroup(1)).execute());
	const removed = await read("removed-group-membership-row-id-decoy-retained");
	assert.equal(found(removed.value, "removed membership").inScope, false);
	assert.equal(removed.measurement.byKind.membership.returnedRows, 0);
	assert.equal(removed.measurement.sdkUrlCalls, 0);
	await fixture("restore-group-membership", () => db.insertInto("content_taxonomies").values({ collection: COLLECTION, entry_id: ENTRY_GROUP, taxonomy_id: termGroup(1), locale: "fr", status: "draft" }).execute());

	for (const [label, change] of [
		["slug", () => db.updateTable(TABLE).set({ slug: "changed-slug" }).where("id", "=", TARGET).execute()],
		["version", () => db.updateTable(TABLE).set({ version: 4 }).where("id", "=", TARGET).execute()],
		["core-policy", () => db.updateTable("_emdash_seo").set({ seo_no_index: 1 }).where("collection", "=", COLLECTION).where("content_id", "=", TARGET).execute()],
		["published-at-only", () => db.updateTable(TABLE).set({ published_at: "2027-01-02 10:00:00" }).where("id", "=", TARGET).execute()],
	]) {
		await reset();
		await core(0);
		let oldUrl = null;
		let mutations = 0;
		let mutationFailure = null;
		urlMutation = async (url) => {
			try {
				assert.equal(url, urlControl.value, "Race starts after the genuine old URL resolves");
				oldUrl = url;
				await fixture("race-" + label, change);
				if (label === "published-at-only") {
					const unchanged = await fixture("race-date-identity-control", () => db.selectFrom(TABLE).select(["version", "updated_at", "published_at"]).where("id", "=", TARGET).executeTakeFirst());
					assert.equal(unchanged?.version, 3);
					assert.equal(unchanged?.updated_at, STAMP);
					assert.equal(unchanged?.published_at, "2027-01-02 10:00:00");
				}
				mutations += 1;
			} catch (error) {
				mutationFailure = error;
				throw error;
			}
		};
		try {
			const race = await read("race-after-genuine-url-" + label);
			if (mutationFailure) throw mutationFailure;
			assert.deepEqual(race.value, { kind: "unavailable" }, label + ": stale URL must be refused");
			assert.equal(mutations, 1);
			assert.equal(race.measurement.sdkUrlCalls, 1);
			assert.equal(race.measurement.fixtureWrites, 1);
			assert.equal(race.measurement.writes, 0);
			assert.equal(race.measurement.byKind.projection.queries, 2);
			report.races.push({ changed: label, genuineOldUrl: oldUrl, fixtureWrites: 1, productWrites: 0, outcome: "unavailable" });
		} finally { urlMutation = null; }
	}
	await reset();
	await fixture("hide-core-table", () => sql`ALTER TABLE _emdash_seo RENAME TO _emdash_seo_fixture_hidden`.execute(db));
	try {
		const broken = await read("real-core-select-failure");
		assert.deepEqual(broken.value, { kind: "unavailable" });
		assert.equal(broken.measurement.errors, 1);
		assert.equal(broken.measurement.sdkUrlCalls, 0);
	} finally {
		await fixture("restore-core-table", () => sql`ALTER TABLE _emdash_seo_fixture_hidden RENAME TO _emdash_seo`.execute(db));
	}
	assert.deepEqual(forbidden, [], "An undeclared SDK, KV or storage operation was attempted");
	assert.equal(networkCalls, 0);
	report.status = "passed";
} catch (error) {
	failure = error;
	report.status = "failed";
	report.error = String(error instanceof Error ? error.message : error).slice(0, 2048);
} finally {
	await db.destroy();
	globalThis.fetch = realFetch;
}

const totals = (owner) => {
	const entries = statements.filter((entry) => entry.owner === owner);
	return { statements: entries.length, selects: entries.filter((entry) => /^\s*select\b/i.test(entry.sql)).length,
		writes: entries.filter((entry) => /^(?:\s*)(?:insert|update|delete|replace|create|alter|drop)\b/i.test(entry.sql)).length,
		errors: entries.filter((entry) => entry.error).length, returnedRows: entries.reduce((sum, entry) => sum + entry.returnedRows, 0) };
};
report.driver = { product: totals("product"), preparation: totals("preparation"), fixture: totals("fixture") };
report.networkCalls = networkCalls;
const output = new URL(`artifacts/current-validation/internal-link-target-smoke-${target.name}.json`, sourceRoot);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
assert.ok(Buffer.byteLength(serialized) <= 64 * 1024, "The target smoke report exceeded 64 KiB");
mkdirSync(new URL("artifacts/current-validation/", sourceRoot), { recursive: true });
writeFileSync(output, serialized);
if (failure) throw failure;
console.log(`Native internal link target smoke passed: ${report.measurements.length} measured calls; SQLite :memory:, one worker. Report: ${output.pathname}`);
