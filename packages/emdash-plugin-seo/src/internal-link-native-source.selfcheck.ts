import assert from "node:assert/strict";

import {
	LinkCandidatePageRefusal,
	createNativeLinkCandidatePort,
	decodeLinkScalar,
	linkEditorialSelections,
	linkEntryVersion,
	selectLinkEditorialText,
	type LinkScalar,
} from "./internal-link-native-source.ts";
import type { LinkResolvedScope, LinkScopeRequest, LinkScopeResolution } from "./internal-link-source.ts";
import { LINK_SUGGESTION_LIMITS, rankLinkSuggestions, type LinkCandidatePage } from "./internal-link-suggestions.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostDatabase = any;
type Budget = { candidateRows: number; scopeMatches: number };

interface SelfcheckOptions {
	measure?: <T>(label: string, action: () => Promise<T>) => Promise<T>;
}

const FULL: Budget = { candidateRows: 200, scopeMatches: 25 };
const STAMP = "2026-10-04 12:00:00";

function refusedWith(reason: "scope-changed" | "unavailable") {
	return (error: unknown) => {
		assert.ok(error instanceof LinkCandidatePageRefusal, String(error));
		assert.equal(error.reason, reason);
		return true;
	};
}

function typeError(error: unknown): boolean {
	assert.ok(error instanceof TypeError, String(error));
	return true;
}

function resolvedScope(resolution: LinkScopeResolution, label: string): LinkResolvedScope {
	if (resolution.kind !== "resolved") return assert.fail(label + ": expected a resolved scope, got " + JSON.stringify(resolution));
	return resolution.scope;
}

/** The frozen engine must accept every native page; empty titles are its malformed count. */
function engineMalformed(scope: LinkResolvedScope, afterId: string | null, page: LinkCandidatePage): number {
	const source = { collection: "link_source", entryId: "source-entry", locale: scope.locale, sourceVersion: "source-v1", revisionId: null, field: "body" };
	const result = rankLinkSuggestions({
		owner: {
			source,
			scope: { collection: scope.collection, locale: scope.locale, taxonomy: scope.taxonomy, termIds: [...scope.termIds], afterId, scopeVersion: scope.scopeVersion },
			generation: 1,
		},
		source: {
			...source, siteUrl: "https://example.com", routeUrl: null,
			body: [{ _type: "block", _key: "b1", style: "normal", markDefs: [], children: [{ _type: "span", _key: "s1", text: "A saved paragraph.", marks: [] }] }],
		},
		page,
	});
	if (result.kind !== "ranked") return assert.fail("The engine refused a native page: " + result.reason);
	assert.equal(result.page.examinedRows, page.examinedRows);
	assert.equal(result.page.scopeMatches, page.candidates.length);
	return result.excluded["candidate-malformed"];
}

// ---------------------------------------------------------------------------
// Decoding, selection and version identity

const text = (value: string): LinkScalar => ({ kind: "text", value });
for (const [kind, raw, expected] of [
	["null", null, { kind: "empty" }],
	["integer", null, { kind: "not-text" }],
	["real", null, { kind: "not-text" }],
	["blob", null, { kind: "not-text" }],
	["overflow", null, { kind: "oversized" }],
	["text", "  Hello world  ", text("Hello world")],
	["text", "   ", { kind: "empty" }],
	["text", '{"a":1}', { kind: "not-text" }],
	["text", "[1, 2]", { kind: "not-text" }],
	["text", "[]", { kind: "not-text" }],
	["text", "{oops", text("{oops")],
	["text", "[not json", text("[not json")],
	// The host parses only an untrimmed prefix, so this stays text.
	["text", ' {"a":1}', text('{"a":1}')],
	["text", " Title ", text("Title")],
	["text", "\u{1f600}".repeat(512), text("\u{1f600}".repeat(512))],
	["text", "\u{1f600}".repeat(513), { kind: "oversized" }],
	["text", "a".repeat(513), { kind: "oversized" }],
	["text", "  " + "a".repeat(512) + "  ", text("a".repeat(512))],
] as const) {
	assert.deepEqual(decodeLinkScalar(kind, raw, LINK_SUGGESTION_LIMITS.titleChars), expected, kind + " " + String(raw).slice(0, 24));
}
for (const [kind, raw] of [
	["text", null], ["text", 3], ["null", "x"], ["integer", 3], ["overflow", "x"], ["blob", new Uint8Array(1)], ["varchar", "x"], [undefined, undefined],
] as const) assert.equal(decodeLinkScalar(kind, raw, LINK_SUGGESTION_LIMITS.titleChars), null, "Driver shape " + String(kind));

assert.deepEqual(selectLinkEditorialText([{ kind: "empty" }, { kind: "not-text" }, text("Third")]), text("Third"));
assert.deepEqual(selectLinkEditorialText([text("First"), { kind: "oversized" }]), text("First"));
assert.deepEqual(selectLinkEditorialText([{ kind: "empty" }, { kind: "oversized" }, text("Later")]), { kind: "refused" });
assert.deepEqual(selectLinkEditorialText([{ kind: "empty" }, { kind: "not-text" }]), { kind: "absent" });
assert.deepEqual(selectLinkEditorialText([]), { kind: "absent" });

assert.equal(linkEntryVersion(3, STAMP), "entry-v1:3:" + STAMP);
assert.equal(linkEntryVersion(1, "2026-10-04T12:00:00.000Z"), "entry-v1:1:2026-10-04T12:00:00.000Z");
for (const [version, updatedAt] of [
	[0, STAMP], [1.5, STAMP], ["3", STAMP], [3n, STAMP], [null, STAMP],
	[3, ""], [3, " " + STAMP], [3, null], [3, 1759579200], [3, "x".repeat(65)], [3, "2026\n10"],
] as const) assert.equal(linkEntryVersion(version, updatedAt), null, "Version " + String(version) + " " + String(updatedAt));

let prohibitedReads = 0;
const noDatabase = new Proxy({}, {
	get() {
		prohibitedReads += 1;
		throw new Error("No database access is allowed in a pure bound check.");
	},
});
for (const column of ["slug", "id", "locale", "title;drop", "Title"]) {
	assert.throws(() => linkEditorialSelections(noDatabase, { collection: "posts", titleColumns: [column], excerptColumns: [] }), typeError);
}

// ---------------------------------------------------------------------------
// Request and page bounds fail before any database access

const pure = createNativeLinkCandidatePort(noDatabase);
const request = (values: Partial<LinkScopeRequest> = {}): LinkScopeRequest => ({ collection: "posts", locale: "en", taxonomy: null, ...values });
const terms = (count: number) => Array.from({ length: count }, (_, index) => "term-" + index);
for (const [values, allowed, reason] of [
	[{}, [], "collection-unavailable"],
	[{ collection: "Posts" }, ["Posts"], "collection-unavailable"],
	[{ collection: "ec-posts" }, ["ec-posts"], "collection-unavailable"],
	[{ taxonomy: { taxonomy: "", termIds: ["a"] } }, ["posts"], "taxonomy-not-attached"],
	[{ taxonomy: { taxonomy: "tags", termIds: [] } }, ["posts"], "term-unavailable"],
	[{ taxonomy: { taxonomy: "tags", termIds: ["a", " b"] } }, ["posts"], "term-unavailable"],
	[{ taxonomy: { taxonomy: "tags", termIds: terms(9) } }, ["posts"], "too-many-terms"],
] as const) {
	assert.deepEqual(await pure.resolveScope(request(values as Partial<LinkScopeRequest>), allowed), { kind: "invalid", reason });
}
for (const locale of ["en_US", "EN", "not a locale", ""]) {
	await assert.rejects(() => pure.resolveScope(request({ locale }), ["posts"]), typeError);
}
const pureScope: LinkResolvedScope = { collection: "posts", locale: "en", taxonomy: null, termIds: [], scopeVersion: "v", upperId: "z" };
for (const [scope, afterId, budget] of [
	[pureScope, null, { candidateRows: 0, scopeMatches: 1 }],
	[pureScope, null, { candidateRows: 201, scopeMatches: 25 }],
	[pureScope, null, { candidateRows: 200, scopeMatches: 26 }],
	[pureScope, null, { candidateRows: 200, scopeMatches: 1.5 }],
	[pureScope, "", FULL],
	[pureScope, " a", FULL],
	[{ ...pureScope, collection: "posts;drop" }, null, FULL],
	[{ ...pureScope, locale: "en_US" }, null, FULL],
	[{ ...pureScope, termIds: ["a"] }, null, FULL],
	[{ ...pureScope, taxonomy: "tags", termIds: [] }, null, FULL],
	[{ ...pureScope, taxonomy: "tags", termIds: ["b", "a"] }, null, FULL],
	[{ ...pureScope, taxonomy: "tags", termIds: ["a", "a"] }, null, FULL],
	[{ ...pureScope, taxonomy: "tags", termIds: terms(9).sort() }, null, FULL],
	[{ ...pureScope, scopeVersion: "" }, null, FULL],
	[{ ...pureScope, scopeVersion: "v".repeat(513) }, null, FULL],
	[{ ...pureScope, upperId: "" }, null, FULL],
] as const) {
	await assert.rejects(() => pure.page(scope as LinkResolvedScope, afterId, budget), typeError);
}
assert.equal(prohibitedReads, 0);

// ---------------------------------------------------------------------------
// Unreadable answers refuse instead of reading as absence

type Queue = Record<string, unknown[][]>;

function stubDatabase(queue: Queue, log: string[]) {
	return {
		selectFrom(table: string) {
			const next = () => {
				const rows = queue[table]?.shift();
				if (!rows) return assert.fail("Unexpected stub query on " + table);
				log.push(table);
				return rows;
			};
			const chain: Record<string, (...args: unknown[]) => unknown> = {
				select: () => chain, leftJoin: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain,
				execute: async () => next(),
				executeTakeFirst: async () => next()[0],
			};
			return chain;
		},
	};
}

function queued(taxonomy: boolean, rest: Queue = {}): Queue {
	const queue: Queue = {
		"_emdash_collections": [[{ id: "c1", slug: "posts", hidden: 0, routable: 1, url_pattern: null, title_field: null }]],
		"_emdash_fields": [[{ id: "f1", slug: "title", type: "string", column_type: "TEXT" }]],
	};
	if (taxonomy) {
		queue["_emdash_taxonomy_defs as d"] = [[{ definition_id: "d1", definition_group: "g1", group_id: "g1", collections: '["posts"]' }]];
		queue.taxonomies = [[{ id: "t1", name: "tags", locale: "en", translation_group: "tg1" }]];
	}
	return { ...queue, ...rest };
}

const windowRows = (ids: readonly string[], values: Record<string, unknown> = {}) =>
	ids.map((id) => ({ id, locale: "en", translation_group: id, status: "published", deleted_at: null, ...values }));
const projectedRow = (id: string, values: Record<string, unknown> = {}) =>
	({ id, version: 1, updated_at: STAMP, t0_kind: "text", t0_text: "Title " + id, ...values });

async function stubScope(taxonomy: boolean): Promise<LinkResolvedScope> {
	const log: string[] = [];
	const port = createNativeLinkCandidatePort(stubDatabase(queued(taxonomy, { ec_posts: [[{ id: "a" }]] }), log));
	const scope = resolvedScope(await port.resolveScope(request(taxonomy ? { taxonomy: { taxonomy: "tags", termIds: ["t1"] } } : {}), ["posts"]), "stub");
	return { ...scope, upperId: "z" };
}

const stubCases: string[] = [];
async function stubPage(label: string, taxonomy: boolean, rest: Queue, scopeValues: Partial<LinkResolvedScope> = {}) {
	const log: string[] = [];
	const scope = { ...(await stubScope(taxonomy)), ...scopeValues };
	const port = createNativeLinkCandidatePort(stubDatabase(queued(taxonomy, rest), log));
	stubCases.push(label);
	return { result: port.page(scope, null, FULL), log, scope };
}

{
	const membership = (rows: unknown[], ids = ["a"]) => ({ ec_posts: [windowRows(ids)], content_taxonomies: [rows] });
	const pair = (entry: unknown, term: unknown) => ({ entry_id: entry, taxonomy_id: term });
	for (const [label, rest] of [
		["membership above the pivot bound", membership([pair("a", "tg1"), pair("a", "tg1")])],
		["repeated membership", membership([pair("a", "tg1"), pair("a", "tg1")], ["a", "b"])],
		["membership for an unrequested entry", membership([pair("x", "tg1")])],
		["membership for an unselected term", membership([pair("a", "tg9")])],
		["malformed membership", membership([pair(7, "tg1")])],
		["membership at the 1,601-row sentinel", membership(Array.from({ length: 1601 }, (_, index) => pair("e" + index, "tg1")),
			Array.from({ length: 200 }, (_, index) => "e" + String(index).padStart(3, "0")))],
		["malformed eligible translation group", { ec_posts: [windowRows(["a"], { translation_group: " a" })] }],
	] as const) {
		const { result } = await stubPage(label, true, rest as Queue);
		await assert.rejects(() => result, refusedWith("unavailable"), label);
	}
	for (const [label, rows] of [
		["unordered window", windowRows(["b", "a"])],
		["window beyond the upper ID", windowRows(["zz"])],
		["window row without an identity", windowRows([""])],
		["window row without a locale", windowRows(["a"], { locale: null })],
	] as const) {
		const { result } = await stubPage(label, false, { ec_posts: [rows] });
		await assert.rejects(() => result, refusedWith("unavailable"), label);
	}
	for (const [label, rows] of [
		["duplicate projected reference", [projectedRow("a"), projectedRow("a")]],
		["unrequested projected reference", [projectedRow("x")]],
		["projected version outside its identity", [projectedRow("a", { version: 0 })]],
		["projected timestamp outside its identity", [projectedRow("a", { updated_at: null })]],
		["projected title outside the selection shape", [projectedRow("a", { t0_text: null })]],
	] as const) {
		const { result } = await stubPage(label, false, { ec_posts: [windowRows(["a"]), [...rows]] });
		await assert.rejects(() => result, refusedWith("unavailable"), label);
	}

	const missing = await stubPage("missing projected reference is omitted without refill", false, {
		ec_posts: [windowRows(["a", "b", "c"]), [projectedRow("c"), projectedRow("a")]],
	});
	const page = await missing.result;
	assert.deepEqual(page.candidates.map((candidate) => candidate.entryId), ["a", "c"]);
	assert.equal(page.examinedRows, 3);
	assert.equal(page.exhausted, true);
	assert.equal(page.nextAfterId, null);
	assert.equal(engineMalformed(missing.scope, null, page), 0);
	assert.deepEqual(missing.log, ["_emdash_collections", "_emdash_fields", "ec_posts", "ec_posts"]);

	const changed = await stubPage("a changed scope version reads no content", true, {}, { scopeVersion: "link-scope-v1:sha256-other" });
	await assert.rejects(() => changed.result, refusedWith("scope-changed"));
	assert.ok(changed.log.every((table) => !table.startsWith("ec_") && table !== "content_taxonomies"));

	const unreadable = await stubPage("malformed attachments are unavailable", true, {
		"_emdash_taxonomy_defs as d": [[{ definition_id: "d1", definition_group: "g1", group_id: "g1", collections: "not-json" }]],
	});
	await assert.rejects(() => unreadable.result, refusedWith("unavailable"));
	const readFailure = new Error("Synthetic source read failure");
	const failing = createNativeLinkCandidatePort({ selectFrom() { throw readFailure; } });
	await assert.rejects(() => failing.resolveScope(request(), ["posts"]), (error) => error === readFailure);
	await assert.rejects(() => failing.page(pureScope, null, FULL), (error) => error === readFailure);
	stubCases.push("database read failures propagate unchanged");
}

// ---------------------------------------------------------------------------
// Native SQLite fixture, driven by scripts/published-host/internal-link-source-smoke.mjs

const id = (index: number) => "01K" + String(index).padStart(23, "0");
const termId = (index: number) => "01T" + String(index).padStart(23, "0");

export async function runInternalLinkNativeSourceSelfcheck(db: HostDatabase, options: SelfcheckOptions = {}) {
	const measure = options.measure ?? (async <T>(_label: string, action: () => Promise<T>) => action());
	const measured = new Set([
		"resolve-dense", "dense-page", "dense-next-page", "dense-final-page", "sparse-empty-page", "sparse-page",
		"sparse-final-page", "upper-boundary-page", "zero-match-page", "metadata-page", "resolve-taxonomy",
		"membership-dense-page", "taxonomy-page", "group-term-page", "scope-changed-page",
	]);
	const observed = <T>(label: string, action: () => Promise<T>) => measured.has(label) ? measure(label, action) : action();
	const created: string[] = [];
	const cases: string[] = [];
	const pages: Array<Record<string, unknown>> = [];
	const port = createNativeLinkCandidatePort(db);
	const allowed = ["link_posts", "link_sparse", "link_meta", "link_tagged", "link_hidden", "link_unroutable", "link_untitled"];

	const insert = async (table: string, rows: readonly Record<string, unknown>[]) => {
		for (let start = 0; start < rows.length; start += 50) await db.insertInto(table).values(rows.slice(start, start + 50)).execute();
	};
	const resolve = (label: string, values: Partial<LinkScopeRequest>, allowedCollections: readonly string[] = allowed) =>
		observed(label, () => port.resolveScope(request(values), allowedCollections));
	const scopeOf = async (label: string, values: Partial<LinkScopeRequest>) => resolvedScope(await resolve(label, values), label);
	const page = async (label: string, scope: LinkResolvedScope, afterId: string | null = null, budget: Budget = FULL) => {
		const result = await observed(label, () => port.page(scope, afterId, budget));
		assert.ok(result.candidates.length <= budget.scopeMatches, label + ": too many matches");
		assert.ok(result.examinedRows <= budget.candidateRows && result.candidates.length <= result.examinedRows, label + ": examined rows");
		assert.equal(result.exhausted, result.nextAfterId === null, label + ": exhaustion and cursor disagree");
		if (result.nextAfterId !== null) {
			assert.ok(scope.upperId !== null && result.nextAfterId <= scope.upperId && (afterId === null || result.nextAfterId > afterId), label + ": cursor");
		}
		result.candidates.forEach((candidate, index) => {
			assert.equal(candidate.collection, scope.collection);
			assert.equal(candidate.locale, scope.locale);
			assert.equal(candidate.afterId, candidate.entryId);
			assert.ok((afterId === null || candidate.entryId > afterId) && scope.upperId !== null && candidate.entryId <= scope.upperId);
			assert.ok(index === 0 || result.candidates[index - 1].entryId < candidate.entryId, label + ": order");
			assert.ok(result.nextAfterId === null || candidate.entryId <= result.nextAfterId, label + ": unconsumed match");
		});
		const malformed = result.candidates.filter((candidate) => candidate.title === "").length;
		assert.equal(engineMalformed(scope, afterId, result), malformed, label + ": engine malformed count");
		pages.push({
			label, examinedRows: result.examinedRows, candidates: result.candidates.length, malformed,
			nextAfterId: result.nextAfterId, exhausted: result.exhausted,
		});
		return result;
	};
	const ids = (result: LinkCandidatePage) => result.candidates.map((candidate) => candidate.entryId);
	const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => id(from + index));
	const content = (index: number, values: Record<string, unknown> = {}) => ({
		id: id(index), slug: "entry-" + index, status: "published", locale: "en", translation_group: id(index),
		deleted_at: null, version: 1, created_at: STAMP, updated_at: STAMP, title: "Entry " + index,
		body: '[{"_type":"block","children":[{"_type":"span","text":"Body text is never projected."}]}]',
		...values,
	});

	try {
		// Columns, keys and constraints mirror the published 1.1.0 migrations and schema registry.
		await db.schema.createTable("revisions")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("collection", "text", (column: any) => column.notNull())
			.addColumn("entry_id", "text", (column: any) => column.notNull())
			.addColumn("data", "text", (column: any) => column.notNull())
			.addColumn("author_id", "text")
			.addColumn("created_at", "text")
			.execute();
		created.push("revisions");
		await db.schema.createTable("_emdash_collections")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("slug", "text", (column: any) => column.notNull().unique())
			.addColumn("label", "text", (column: any) => column.notNull())
			.addColumn("label_singular", "text")
			.addColumn("description", "text")
			.addColumn("icon", "text")
			.addColumn("supports", "text")
			.addColumn("source", "text")
			.addColumn("created_at", "text")
			.addColumn("updated_at", "text")
			.addColumn("has_seo", "integer", (column: any) => column.notNull().defaultTo(0))
			.addColumn("url_pattern", "text")
			.addColumn("hidden", "integer", (column: any) => column.notNull().defaultTo(0))
			.addColumn("sort_order", "integer")
			.addColumn("admin_config", "text")
			.addColumn("title_field", "text")
			.addColumn("date_field", "text")
			.addColumn("routable", "integer", (column: any) => column.notNull().defaultTo(1))
			.execute();
		created.push("_emdash_collections");
		await db.schema.createTable("_emdash_fields")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("collection_id", "text", (column: any) => column.notNull().references("_emdash_collections.id").onDelete("cascade"))
			.addColumn("slug", "text", (column: any) => column.notNull())
			.addColumn("label", "text", (column: any) => column.notNull())
			.addColumn("type", "text", (column: any) => column.notNull())
			.addColumn("column_type", "text", (column: any) => column.notNull())
			.addColumn("required", "integer", (column: any) => column.defaultTo(0))
			.addColumn("unique", "integer", (column: any) => column.defaultTo(0))
			.addColumn("default_value", "text")
			.addColumn("validation", "text")
			.addColumn("widget", "text")
			.addColumn("options", "text")
			.addColumn("sort_order", "integer", (column: any) => column.defaultTo(0))
			.addColumn("created_at", "text")
			.addColumn("searchable", "integer", (column: any) => column.notNull().defaultTo(0))
			.addColumn("indexed", "integer", (column: any) => column.notNull().defaultTo(0))
			.addColumn("translatable", "integer", (column: any) => column.notNull().defaultTo(1))
			.execute();
		created.push("_emdash_fields");
		await db.schema.createIndex("idx_fields_collection_slug").on("_emdash_fields").columns(["collection_id", "slug"]).unique().execute();
		await db.schema.createTable("_emdash_taxonomy_def_groups")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("name", "text", (column: any) => column.notNull())
			.addColumn("hierarchical", "integer", (column: any) => column.notNull().defaultTo(0))
			.addColumn("collections", "text", (column: any) => column.notNull().defaultTo("[]"))
			.addColumn("created_at", "text")
			.addUniqueConstraint("_emdash_taxonomy_def_groups_name_unique", ["name"])
			.execute();
		created.push("_emdash_taxonomy_def_groups");
		await db.schema.createTable("_emdash_taxonomy_defs")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("name", "text", (column: any) => column.notNull())
			.addColumn("label", "text", (column: any) => column.notNull())
			.addColumn("label_singular", "text")
			.addColumn("hierarchical", "integer", (column: any) => column.defaultTo(0))
			.addColumn("collections", "text")
			.addColumn("created_at", "text")
			.addColumn("locale", "text", (column: any) => column.notNull().defaultTo("en"))
			.addColumn("translation_group", "text")
			.addUniqueConstraint("_emdash_taxonomy_defs_name_locale_unique", ["name", "locale"])
			.execute();
		created.push("_emdash_taxonomy_defs");
		await db.schema.createTable("taxonomies")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("name", "text", (column: any) => column.notNull())
			.addColumn("slug", "text", (column: any) => column.notNull())
			.addColumn("label", "text", (column: any) => column.notNull())
			.addColumn("parent_id", "text")
			.addColumn("data", "text")
			.addColumn("locale", "text", (column: any) => column.notNull().defaultTo("en"))
			.addColumn("translation_group", "text")
			.addColumn("sort_order", "integer", (column: any) => column.notNull().defaultTo(0))
			.addUniqueConstraint("taxonomies_name_slug_locale_unique", ["name", "slug", "locale"])
			.execute();
		created.push("taxonomies");
		await db.schema.createIndex("idx_taxonomies_name_locale").on("taxonomies").columns(["name", "locale"]).execute();
		await db.schema.createIndex("uidx_taxonomies_translation_locale").on("taxonomies").columns(["translation_group", "locale"])
			.unique().where("translation_group", "is not", null).execute();
		// taxonomy_id stores a term translation group, so 1.1.0 keeps no foreign key to taxonomies.id.
		await db.schema.createTable("content_taxonomies")
			.addColumn("collection", "text", (column: any) => column.notNull())
			.addColumn("entry_id", "text", (column: any) => column.notNull())
			.addColumn("taxonomy_id", "text", (column: any) => column.notNull())
			.addColumn("status", "text")
			.addColumn("scheduled_at", "text")
			.addColumn("deleted_at", "text")
			.addColumn("locale", "text")
			.addColumn("published_at", "text")
			.addColumn("created_at", "text")
			.addPrimaryKeyConstraint("content_taxonomies_pk", ["collection", "entry_id", "taxonomy_id"])
			.execute();
		created.push("content_taxonomies");
		await db.schema.createIndex("idx_content_taxonomies_group_lookup").on("content_taxonomies").columns(["taxonomy_id", "collection", "entry_id"]).execute();

		const collection = (slug: string, values: Record<string, unknown> = {}) => ({
			id: "col-" + slug, slug, label: slug, created_at: STAMP, updated_at: STAMP, url_pattern: null, title_field: null, ...values,
		});
		const field = (collectionSlug: string, slug: string, type: string, columnType: string) => ({
			id: "fld-" + collectionSlug + "-" + slug, collection_id: "col-" + collectionSlug, slug, label: slug, type, column_type: columnType, created_at: STAMP,
		});
		const dataType: Record<string, string> = { TEXT: "text", REAL: "real", INTEGER: "integer", JSON: "json" };
		const defineCollection = async (slug: string, values: Record<string, unknown>, fields: readonly [string, string, string][]) => {
			await insert("_emdash_collections", [collection(slug, values)]);
			await insert("_emdash_fields", fields.map(([name, type, columnType]) => field(slug, name, type, columnType)));
			const table = "ec_" + slug;
			let builder = db.schema.createTable(table)
				.addColumn("id", "text", (column: any) => column.primaryKey())
				.addColumn("slug", "text")
				.addColumn("status", "text", (column: any) => column.defaultTo("draft"))
				.addColumn("author_id", "text")
				.addColumn("primary_byline_id", "text")
				.addColumn("created_at", "text")
				.addColumn("updated_at", "text")
				.addColumn("published_at", "text")
				.addColumn("scheduled_at", "text")
				.addColumn("deleted_at", "text")
				.addColumn("version", "integer", (column: any) => column.defaultTo(1))
				.addColumn("live_revision_id", "text", (column: any) => column.references("revisions.id"))
				.addColumn("draft_revision_id", "text", (column: any) => column.references("revisions.id"))
				.addColumn("locale", "text", (column: any) => column.notNull().defaultTo("en"))
				.addColumn("translation_group", "text");
			for (const [name, , columnType] of fields) builder = builder.addColumn(name, dataType[columnType]);
			await builder.addUniqueConstraint(table + "_slug_locale_unique", ["slug", "locale"]).execute();
			created.push(table);
			await db.schema.createIndex("uidx_" + table + "_active_tg_locale").on(table)
				.columns(["translation_group", db.fn("lower", ["locale"])]).unique()
				.where("deleted_at", "is", null).where("translation_group", "is not", null).execute();
		};
		const body: [string, string, string] = ["body", "portableText", "JSON"];
		await defineCollection("link_posts", { title_field: "headline", url_pattern: "/blog/{slug}" }, [
			["headline", "string", "TEXT"], ["title", "string", "TEXT"], ["excerpt", "text", "TEXT"], ["summary", "text", "TEXT"], body,
		]);
		await defineCollection("link_sparse", { title_field: "missing_field" }, [["title", "string", "TEXT"], ["description", "text", "TEXT"], body]);
		await defineCollection("link_meta", { title_field: "headline" }, [
			["headline", "string", "TEXT"], ["title", "string", "TEXT"], ["name", "slug", "TEXT"],
			["excerpt", "text", "TEXT"], ["summary", "string", "TEXT"], ["description", "text", "TEXT"], body,
		]);
		await defineCollection("link_tagged", {}, [["title", "string", "TEXT"], body]);
		await defineCollection("link_hidden", { hidden: 1 }, [["title", "string", "TEXT"]]);
		await defineCollection("link_unroutable", { routable: 0 }, [["title", "string", "TEXT"]]);
		await defineCollection("link_untitled", { title_field: "rating" }, [["rating", "number", "REAL"], ["name", "json", "JSON"], ["title", "string", "JSON"]]);

		// ---- Collection eligibility and schema-valid titles ----
		for (const slug of ["link_hidden", "link_unroutable", "link_untitled", "link_missing"]) {
			assert.deepEqual(await resolve("ineligible-" + slug, { collection: slug }, [...allowed, "link_missing"]), { kind: "invalid", reason: "collection-unavailable" });
		}
		assert.deepEqual(await resolve("not-allowed", { collection: "link_posts" }, ["link_meta"]), { kind: "invalid", reason: "collection-unavailable" });
		cases.push("hidden, unroutable, untitled, missing and unallowed collections are not selectable");

		// ---- Dense, bounded pages and the fixed upper window ----
		await insert("ec_link_posts", Array.from({ length: 260 }, (_, index) => content(index + 1, {
			headline: "Guide " + (index + 1), title: "Post " + (index + 1), excerpt: "Excerpt " + (index + 1),
		})));
		const dense = await scopeOf("resolve-dense", { collection: "link_posts" });
		assert.equal(dense.upperId, id(260));
		assert.equal(dense.taxonomy, null);
		assert.deepEqual(dense.termIds, []);
		assert.match(dense.scopeVersion, /^link-scope-v1:sha256-[0-9a-f]{64}$/);
		assert.equal(resolvedScope(await resolve("resolve-dense-again", { collection: "link_posts" }), "again").scopeVersion, dense.scopeVersion);
		await insert("ec_link_posts", [content(261, { headline: "Beyond the window" })]);
		assert.equal(resolvedScope(await resolve("resolve-dense-later", { collection: "link_posts" }), "later").scopeVersion, dense.scopeVersion);
		const first = await page("dense-page", dense);
		assert.deepEqual(ids(first), range(1, 25));
		assert.equal(first.examinedRows, 25);
		assert.equal(first.nextAfterId, id(25));
		assert.equal(first.candidates[0].title, "Guide 1");
		assert.equal(first.candidates[0].excerpt, "Excerpt 1");
		assert.equal(first.candidates[0].version, "entry-v1:1:" + STAMP);
		const second = await page("dense-next-page", dense, first.nextAfterId);
		assert.deepEqual(ids(second), range(26, 50));
		const last = await page("dense-final-page", dense, id(250));
		assert.deepEqual(ids(last), range(251, 260));
		assert.equal(last.examinedRows, 10);
		assert.equal(last.exhausted, true);
		cases.push("dense pages stop at 25 matches and Next keeps the original upper ID");

		// ---- Sparse windows, the ID-only sentinel and exhaustion ----
		await insert("ec_link_sparse", Array.from({ length: 430 }, (_, offset) => {
			const index = offset + 1;
			if (index === 205 || index === 407) return content(index, { description: "Sparse " + index });
			if (index % 50 === 0) return content(index, { locale: "fr", translation_group: "fr-" + index });
			if (index % 70 === 0) return content(index, { deleted_at: STAMP });
			return content(index, { status: "draft" });
		}));
		const sparse = await scopeOf("resolve-sparse", { collection: "link_sparse" });
		assert.equal(sparse.upperId, id(430));
		const empty = await page("sparse-empty-page", sparse);
		assert.deepEqual(ids(empty), []);
		assert.equal(empty.examinedRows, 200);
		assert.equal(empty.nextAfterId, id(200));
		const sparsePage = await page("sparse-page", sparse, empty.nextAfterId);
		assert.deepEqual(ids(sparsePage), [id(205)]);
		assert.equal(sparsePage.candidates[0].title, "Entry 205");
		assert.equal(sparsePage.candidates[0].excerpt, "Sparse 205");
		assert.equal(sparsePage.nextAfterId, id(400));
		const sparseFinal = await page("sparse-final-page", sparse, sparsePage.nextAfterId);
		assert.deepEqual(ids(sparseFinal), [id(407)]);
		assert.equal(sparseFinal.examinedRows, 30);
		assert.equal(sparseFinal.exhausted, true);
		const boundary = await page("upper-boundary-page", { ...sparse, upperId: id(400) }, id(200));
		assert.deepEqual(ids(boundary), [id(205)]);
		assert.equal(boundary.examinedRows, 200);
		assert.equal(boundary.exhausted, true);
		const zero = await page("zero-match-page", { ...sparse, upperId: id(100) });
		assert.deepEqual(ids(zero), []);
		assert.equal(zero.examinedRows, 100);
		assert.equal(zero.exhausted, true);
		assert.deepEqual(ids(await page("past-upper-page", sparse, id(430))), []);
		const small = await page("small-budget-page", sparse, id(200), { candidateRows: 3, scopeMatches: 1 });
		assert.equal(small.examinedRows, 3);
		assert.equal(small.nextAfterId, id(203));
		cases.push("a sparse empty page has Next; a window ending at the upper ID needs no sentinel; exhaustion has no cursor");
		cases.push("wrong-locale, deleted and draft rows are consumed but never matched");

		// ---- Bounded scalar metadata and the host's decoding ----
		const longWithNul = "short\u0000" + "x".repeat(3000);
		await insert("ec_link_meta", [
			content(1, { headline: "  Hello world  ", excerpt: "  Short  " }),
			content(2, { headline: '{"a":1}', title: "Fallback title" }),
			content(3, { headline: "[1, 2]", title: null, name: "slug-like-name" }),
			content(4, { headline: "{oops" }),
			content(5, { headline: ' {"a":1}' }),
			content(6, { headline: "x".repeat(2049), title: "Never a fallback for oversized" }),
			content(7, { headline: "\u{1f600}".repeat(512) }),
			content(8, { headline: "\u{1f600}".repeat(513) }),
			content(9, { headline: "a".repeat(513) }),
			content(10, { headline: "  " + "a".repeat(512) + "  " }),
			content(11, { headline: "", title: "   ", name: null }),
			content(12, { headline: longWithNul, title: "Never a fallback for NUL overflow" }),
			// The host dialect binds a JS number as REAL; TEXT affinity then stores the text "42.0".
			content(13, { headline: 42 }),
			content(14, { headline: "Excerpt fallback", excerpt: '{"x":1}', summary: "Summary text" }),
			content(15, { headline: "Oversized excerpt", excerpt: "e".repeat(8193) }),
			content(16, { headline: "Too many excerpt code points", excerpt: "é".repeat(2049) }),
			content(17, { headline: "Description fallback", excerpt: null, summary: "", description: "  Description  " }),
			content(18, { headline: "No excerpt" }),
			content(19, { headline: new Uint8Array([104, 105]), title: "Blob headline fallback" }),
			content(20, { headline: "Deleted", deleted_at: STAMP }),
			content(21, { headline: "French", locale: "fr", translation_group: "fr-21" }),
			content(22, { headline: "Draft", status: "draft" }),
		]);
		const stored = await db.selectFrom("ec_link_meta")
			.select((eb: any) => eb.fn("length", [eb.cast("headline", "blob")]).as("bytes"))
			.where("id", "=", id(12)).executeTakeFirstOrThrow();
		assert.ok(stored.bytes > 4 * LINK_SUGGESTION_LIMITS.titleChars, "The fixture must store text after its NUL");
		const numeric = await db.selectFrom("ec_link_meta")
			.select((eb: any) => ["headline", eb.fn("typeof", ["headline"]).as("type")])
			.where("id", "=", id(13)).executeTakeFirstOrThrow();
		assert.deepEqual({ headline: numeric.headline, type: numeric.type }, { headline: "42.0", type: "text" },
			"The fixture must store the numeric headline as the text 42.0");
		const meta = await scopeOf("resolve-meta", { collection: "link_meta" });
		const metadata = await page("metadata-page", meta);
		const byId = new Map(metadata.candidates.map((candidate) => [candidate.entryId, candidate]));
		assert.equal(metadata.examinedRows, 22);
		assert.equal(metadata.exhausted, true);
		assert.deepEqual(ids(metadata), range(1, 19));
		for (const [index, title, excerpt] of [
			[1, "Hello world", "Short"], [2, "Fallback title", null], [3, "slug-like-name", null], [4, "{oops", null],
			[5, '{"a":1}', null], [6, "", null], [7, "\u{1f600}".repeat(512), null], [8, "", null], [9, "", null],
			[10, "a".repeat(512), null], [11, "", null], [12, "", null], [13, "42.0", null],
			[14, "Excerpt fallback", "Summary text"], [15, "", null], [16, "", null],
			[17, "Description fallback", "Description"], [18, "No excerpt", null], [19, "Blob headline fallback", null],
		] as const) {
			const candidate = byId.get(id(index));
			assert.ok(candidate, "Metadata row " + index);
			assert.equal(candidate.title, title, "Metadata title " + index);
			assert.equal(candidate.excerpt, excerpt, "Metadata excerpt " + index);
		}
		cases.push("raw scalars are byte-bounded in SQL, NUL included, before one host-style JSON pass and trimming");
		cases.push("configured, title and name fallbacks skip empty and decoded values; oversized values refuse without fallback");

		// ---- One attached taxonomy, exact same-locale terms, no descendants ----
		await insert("_emdash_taxonomy_def_groups", [
			{ id: "grp-topic", name: "link_topic", collections: '["link_tagged"]' },
			{ id: "grp-detached", name: "link_detached", collections: '["link_posts"]' },
		]);
		await insert("_emdash_taxonomy_defs", [
			{ id: "def-topic-en", name: "link_topic", label: "Topics", locale: "en", translation_group: "grp-topic", collections: '["link_stale"]' },
			{ id: "def-topic-fr", name: "link_topic", label: "Sujets", locale: "fr", translation_group: "grp-topic", collections: '["link_stale"]' },
			{ id: "def-legacy-en", name: "link_legacy", label: "Legacy", locale: "en", translation_group: "def-legacy-en", collections: '["link_tagged"]' },
			{ id: "def-detached-en", name: "link_detached", label: "Detached", locale: "en", translation_group: "grp-detached", collections: '["link_tagged"]' },
		]);
		const term = (index: number, values: Record<string, unknown> = {}) => ({
			id: termId(index), name: "link_topic", slug: "t-" + index, label: "Topic " + index, locale: "en", translation_group: termId(index), ...values,
		});
		await insert("taxonomies", [
			...Array.from({ length: 9 }, (_, index) => term(index + 1)),
			term(20, { parent_id: termId(1) }),
			term(101, { slug: "t-1", locale: "fr", translation_group: termId(1) }),
			term(50, { name: "link_legacy" }),
			term(30, { translation_group: "grp-topic-30" }),
		]);
		const T = (index: number) => termId(index);
		const eight = Array.from({ length: 8 }, (_, index) => T(index + 1));
		await insert("ec_link_tagged", [
			...Array.from({ length: 200 }, (_, index) => content(index + 1)),
			content(201), content(202), content(203), content(204),
			content(205, { locale: "fr", translation_group: id(201) }),
			content(206, { deleted_at: STAMP }), content(207, { status: "draft" }), content(208, { translation_group: null }),
			content(209), content(210),
			...Array.from({ length: 20 }, (_, index) => content(211 + index,
				index + 211 === 212 || index + 211 === 220 ? { translation_group: "grp-entry-" + (index + 211) } : {})),
		]);
		const assignment = (entry: number, taxonomy: string, values: Record<string, unknown> = {}) =>
			({ collection: "link_tagged", entry_id: id(entry), taxonomy_id: taxonomy, ...values });
		await insert("content_taxonomies", [
			...Array.from({ length: 200 }, (_, index) => eight.map((taxonomy) => assignment(index + 1, taxonomy))).flat(),
			assignment(201, T(1)), assignment(202, T(2)), assignment(203, T(20)), assignment(204, T(3)),
			assignment(206, T(1)), assignment(207, T(1)),
			{ collection: "link_posts", entry_id: id(209), taxonomy_id: T(1) },
			assignment(210, T(1), { locale: "fr", status: "draft", deleted_at: STAMP }),
			{ collection: "link_tagged", entry_id: "grp-entry-212", taxonomy_id: "grp-topic-30" },
			{ collection: "link_tagged", entry_id: "grp-entry-220", taxonomy_id: "grp-topic-30" },
		]);
		const topic = (termIds: readonly string[], taxonomy = "link_topic") => ({ collection: "link_tagged", taxonomy: { taxonomy, termIds } });
		const all8 = await scopeOf("resolve-taxonomy", topic([...eight].reverse()));
		assert.deepEqual(all8.termIds, eight);
		assert.equal(all8.upperId, id(230));
		assert.deepEqual(await resolve("nine-terms", topic([...eight, T(9)])), { kind: "invalid", reason: "too-many-terms" });
		for (const [label, values, reason] of [
			["translated-term", topic([T(101)]), "term-unavailable"],
			["other-taxonomy-term", topic([T(50)]), "term-unavailable"],
			["missing-term", topic([termId(999)]), "term-unavailable"],
			["detached-taxonomy", topic([T(1)], "link_detached"), "taxonomy-not-attached"],
			["unknown-taxonomy", topic([T(1)], "link_unknown"), "taxonomy-not-attached"],
			["unattached-collection", { collection: "link_posts", taxonomy: { taxonomy: "link_topic", termIds: [T(1)] } }, "taxonomy-not-attached"],
		] as const) assert.deepEqual(await resolve(label, values), { kind: "invalid", reason }, label);
		resolvedScope(await resolve("legacy-definition", topic([T(50)], "link_legacy")), "legacy");
		cases.push("exactly eight same-locale terms resolve sorted; translations, other names and detached groups do not");

		const membershipDense = await page("membership-dense-page", all8);
		assert.deepEqual(ids(membershipDense), range(1, 25));
		assert.equal(membershipDense.examinedRows, 25);
		const scope12 = await scopeOf("resolve-two-terms", topic([T(2), T(1), T(2)]));
		assert.deepEqual(scope12.termIds, [T(1), T(2)]);
		const tagged = await page("taxonomy-page", scope12, id(200));
		assert.deepEqual(ids(tagged), [id(201), id(202), id(210)]);
		assert.equal(tagged.examinedRows, 30);
		assert.equal(tagged.exhausted, true);
		const parent = await scopeOf("resolve-parent", topic([T(1)]));
		assert.deepEqual(ids(await page("parent-without-descendants", parent, id(200))), [id(201), id(210)]);
		const child = await scopeOf("resolve-child", topic([T(20)]));
		assert.deepEqual(ids(await page("exact-child-term", child, id(200))), [id(203)]);

		// Neither group equals a row ID on its side; a row-ID membership read on either side finds nothing.
		const termRowsNamedByGroup = await db.selectFrom("taxonomies").select("id").where("id", "=", "grp-topic-30").execute();
		assert.equal(termRowsNamedByGroup.length, 0, "The term group must differ from every taxonomies.id");
		const entryRowsNamedByGroup = await db.selectFrom("ec_link_tagged").select("id")
			.where("id", "in", ["grp-entry-212", "grp-entry-220"]).execute();
		assert.equal(entryRowsNamedByGroup.length, 0, "The content groups must differ from every ec_link_tagged.id");
		const grouped = await scopeOf("resolve-group-term", topic([T(30)]));
		assert.deepEqual(grouped.termIds, [T(30)]);
		const single: Budget = { candidateRows: 200, scopeMatches: 1 };
		const groupFirst = await page("group-term-page", grouped, id(200), single);
		assert.deepEqual(ids(groupFirst), [id(212)]);
		assert.equal(groupFirst.examinedRows, 12);
		assert.equal(groupFirst.nextAfterId, id(212));
		const groupNext = await page("group-term-next-page", grouped, groupFirst.nextAfterId, single);
		assert.deepEqual(ids(groupNext), [id(220)]);
		assert.equal(groupNext.examinedRows, 8);
		assert.equal(groupNext.nextAfterId, id(220));
		const groupFinal = await page("group-term-final-page", grouped, groupNext.nextAfterId, single);
		assert.deepEqual(ids(groupFinal), []);
		assert.equal(groupFinal.examinedRows, 10);
		assert.equal(groupFinal.exhausted, true);
		const mixed = await scopeOf("resolve-mixed-groups", topic([T(30), T(1)]));
		assert.deepEqual(mixed.termIds, [T(1), T(30)]);
		assert.deepEqual(ids(await page("mixed-group-page", mixed, id(200))), [id(201), id(210), id(212), id(220)]);
		cases.push("a selected term whose group matches no term row ID resolves, matches its pivot group and pages to exhaustion");
		cases.push("one membership batch matches selected terms by OR, ignores descendants, other collections and legacy pivot columns");

		// ---- Fresh definitions: changed scope refuses, unchanged scope stays current ----
		const expectChanged = async (label: string, change: () => Promise<unknown>, restore: () => Promise<unknown>, resolution?: LinkScopeResolution) => {
			await change();
			if (resolution) assert.deepEqual(await resolve(label + "-resolve", topic(scope12.termIds)), resolution, label);
			await assert.rejects(() => observed(label === "group-attachments" ? "scope-changed-page" : label, () => port.page(scope12, id(200), FULL)),
				refusedWith(resolution?.kind === "unavailable" ? "unavailable" : "scope-changed"), label);
			await restore();
			assert.deepEqual(ids(await port.page(scope12, id(200), FULL)), [id(201), id(202), id(210)], label + " restored");
		};
		const group = (collections: string) => db.updateTable("_emdash_taxonomy_def_groups").set({ collections }).where("id", "=", "grp-topic").execute();
		const tagField = (values: Record<string, unknown>) => db.updateTable("_emdash_fields").set(values).where("id", "=", "fld-link_tagged-title").execute();
		const tagCollection = (values: Record<string, unknown>) => db.updateTable("_emdash_collections").set(values).where("id", "=", "col-link_tagged").execute();
		await expectChanged("group-attachments", () => group('["link_tagged","link_posts"]'), () => group('["link_tagged"]'));
		await expectChanged("term-group", () => db.updateTable("taxonomies").set({ translation_group: "grp-moved" }).where("id", "=", T(2)).execute(),
			() => db.updateTable("taxonomies").set({ translation_group: T(2) }).where("id", "=", T(2)).execute());
		await expectChanged("definition-fallback", () => db.deleteFrom("_emdash_taxonomy_def_groups").where("id", "=", "grp-topic").execute(),
			() => insert("_emdash_taxonomy_def_groups", [{ id: "grp-topic", name: "link_topic", collections: '["link_tagged"]' }]),
			{ kind: "invalid", reason: "taxonomy-not-attached" });
		await expectChanged("title-schema", () => tagField({ type: "json" }), () => tagField({ type: "string" }), { kind: "invalid", reason: "collection-unavailable" });
		await expectChanged("title-column-type", () => tagField({ column_type: "JSON" }), () => tagField({ column_type: "TEXT" }));
		await expectChanged("collection-hidden", () => tagCollection({ hidden: 1 }), () => tagCollection({ hidden: 0 }), { kind: "invalid", reason: "collection-unavailable" });
		await expectChanged("collection-route", () => tagCollection({ url_pattern: "/topics/{slug}" }), () => tagCollection({ url_pattern: null }));
		await expectChanged("title-config", () => tagCollection({ title_field: "title" }), () => tagCollection({ title_field: null }));
		await expectChanged("unreadable-attachments", () => group("not-json"), () => group('["link_tagged"]'), { kind: "unavailable" });
		await db.updateTable("_emdash_fields").set({ label: "Renamed" }).where("id", "=", "fld-link_tagged-title").execute();
		await db.updateTable("_emdash_collections").set({ title_field: "title" }).where("id", "=", "col-link_posts").execute();
		await insert("ec_link_tagged", [content(231)]);
		await insert("content_taxonomies", [assignment(231, T(1))]);
		const current = resolvedScope(await resolve("resolve-two-terms-again", topic(scope12.termIds)), "again");
		assert.equal(current.scopeVersion, scope12.scopeVersion);
		assert.equal(current.upperId, id(231));
		assert.deepEqual(ids(await port.page(scope12, id(200), FULL)), [id(201), id(202), id(210)]);
		cases.push("attachments, term groups, definition fallback, field type, visibility, route and title config change the scope version");
		cases.push("labels, other collections and new content leave the version unchanged; the original upper ID is never recaptured");

		// ---- A reference that changes after the window is omitted without refill ----
		const raced = createNativeLinkCandidatePort(afterWindow(db, "ec_link_posts", async () => {
			await db.deleteFrom("ec_link_posts").where("id", "=", id(3)).execute();
			await db.updateTable("ec_link_posts").set({ deleted_at: STAMP }).where("id", "=", id(4)).execute();
			await db.updateTable("ec_link_posts").set({ status: "draft" }).where("id", "=", id(5)).execute();
			await db.updateTable("ec_link_posts").set({ locale: "fr" }).where("id", "=", id(6)).execute();
		}));
		const racedPage = await raced.page({ ...resolvedScope(await resolve("resolve-raced", { collection: "link_posts" }), "raced"), upperId: id(30) }, null, FULL);
		assert.deepEqual(ids(racedPage), range(1, 25).filter((entry) => ![id(3), id(4), id(5), id(6)].includes(entry)));
		assert.equal(racedPage.examinedRows, 25);
		assert.equal(racedPage.nextAfterId, id(25));
		cases.push("missing, deleted, unpublished and relocalized references are omitted and never refilled");

		return { cases, stubCases, pages };
	} finally {
		for (const table of created.reverse()) await db.schema.dropTable(table).execute();
	}
}

/** Runs `change` once, after the first `table` read and before the next one; unmeasured. */
function afterWindow(db: HostDatabase, table: string, change: () => Promise<void>): HostDatabase {
	let reads = 0;
	let changed = false;
	const deferred = (builder: any): any => new Proxy(builder, {
		get(target, key) {
			const value = Reflect.get(target, key, target);
			if (typeof value !== "function") return value;
			if (key === "execute" || key === "executeTakeFirst") {
				return async (...args: unknown[]) => {
					if (!changed) {
						changed = true;
						await change();
					}
					return value.apply(target, args);
				};
			}
			return (...args: unknown[]) => {
				const result = value.apply(target, args);
				return result && typeof result.execute === "function" ? deferred(result) : result;
			};
		},
	});
	return new Proxy(db, {
		get(target, key) {
			const value = Reflect.get(target, key, target);
			if (key !== "selectFrom") return typeof value === "function" ? value.bind(target) : value;
			return (name: string) => {
				const builder = target.selectFrom(name);
				return name === table && ++reads === 2 ? deferred(builder) : builder;
			};
		},
	});
}

console.log("Internal link native source bounds: " + stubCases.length + " refusal cases passed; SQLite fixtures run through the native smoke.");
