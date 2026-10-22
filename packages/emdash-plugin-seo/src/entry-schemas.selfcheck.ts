import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";

import { SEO_ENGINE_VERSION, SEO_PORTABILITY_CONFIRMATION } from "./admin-contract.ts";
import {
	ENTRY_SCHEMA_MAX_APPLICABLE,
	ENTRY_SCHEMA_MAX_PER_ENTRY,
	entrySchemaTargetMatches,
	listEntrySchemas,
	removeEntrySchema,
	saveEntrySchema,
	validateEntrySchemaJson,
	type EntrySchemaHost,
	type EntrySchemaHostEntry,
	type StoredEntrySchema,
} from "./entry-schemas.ts";
import { validateSeoPortabilityBundle } from "./portability.ts";
import seoRuntime from "./sandbox-entry.ts";

// In-memory model of the published 1.1.0 storage collection: per-row opaque
// revisions, create-only-when-absent for a null expected revision, and indexed
// `scope` filters for equality, `in` lists and null.
class VersionedStore {
	rows = new Map<string, { value: unknown; revision: string }>();
	private sequence = 0;
	beforeWrite: ((id: string) => Promise<void>) | null = null;
	failWrite: ((id: string) => boolean) | null = null;
	failDelete = false;
	queryShape: ((result: unknown) => unknown) | null = null;
	versionedShape: ((result: unknown) => unknown) | null = null;
	versionedReads: string[] = [];
	queries: Array<{ where?: Record<string, unknown>; limit?: number }> = [];

	private nextRevision(): string {
		this.sequence += 1;
		return `rev-${this.sequence}`;
	}

	seed(id: string, value: unknown): string {
		const revision = this.nextRevision();
		this.rows.set(id, { value: structuredClone(value), revision });
		return revision;
	}

	async get(id: string) {
		return structuredClone(this.rows.get(id)?.value ?? null);
	}

	async put(id: string, value: unknown) {
		this.seed(id, value);
	}

	async delete(id: string) {
		return this.rows.delete(id);
	}

	async getVersioned(id: string): Promise<unknown> {
		this.versionedReads.push(id);
		const row = this.rows.get(id);
		const result = row ? { value: structuredClone(row.value), revision: row.revision } : null;
		return this.versionedShape ? this.versionedShape(result) : result;
	}

	async compareAndSet(id: string, expectedRevision: string | null, data: StoredEntrySchema) {
		await this.beforeWrite?.(id);
		const row = this.rows.get(id);
		const matches = expectedRevision === null ? !row : row?.revision === expectedRevision;
		if (!matches) return { applied: false as const };
		const revision = this.seed(id, data);
		if (this.failWrite?.(id)) throw new Error("connection reset after commit");
		return { applied: true as const, revision };
	}

	async compareAndDelete(id: string, expectedRevision: string) {
		if (this.failDelete) throw new Error("connection reset");
		const row = this.rows.get(id);
		if (!row || row.revision !== expectedRevision) return { applied: false };
		this.rows.delete(id);
		return { applied: true };
	}

	async count() {
		return this.rows.size;
	}

	async query(options: { where?: Record<string, unknown>; limit?: number } = {}): Promise<unknown> {
		this.queries.push(structuredClone(options));
		const condition = options.where?.scope;
		const items = [...this.rows.entries()]
			.map(([id, row]) => ({ id, data: structuredClone(row.value) as Record<string, unknown> }))
			.filter(({ data }) => {
				if (condition === undefined) return true;
				const scope = data.scope;
				if (condition === null) return scope === null || scope === undefined;
				if (typeof condition === "string") return scope === condition;
				const list = (condition as { in?: unknown[] }).in;
				return Array.isArray(list) && list.includes(scope);
			});
		const limit = options.limit ?? 100;
		const result = { items: items.slice(0, limit), hasMore: items.length > limit, cursor: undefined };
		return this.queryShape ? this.queryShape(result) : result;
	}
}

const entries = new Map<string, EntrySchemaHostEntry & { data?: Record<string, unknown> }>();
function addEntry(collection: string, entry: EntrySchemaHostEntry) {
	entries.set(`${collection}:${entry.id}`, entry);
}

function hostFor(store: VersionedStore, options: { getEntry?: EntrySchemaHost["getEntry"] } = {}): EntrySchemaHost {
	return {
		hasCollection: async (collection) => collection === "posts" || collection === "pages",
		schemaOutputEnabled: async () => true,
		getEntry: options.getEntry ?? (async (collection, id) => structuredClone(entries.get(`${collection}:${id}`) ?? null)),
		schemas: store,
		now: () => "2026-10-02T12:00:00.000Z",
	};
}

const POST = "01JPOSTAAAAAAAAAAAAAAAAAAA";
const OTHER_POST = "01JPOSTBBBBBBBBBBBBBBBBBBB";
const FRENCH_POST = "01JPOSTFRFRFRFRFRFRFRFRFRF";
const DRAFT_PAGE = "01JPAGEDRAFTDRAFTDRAFTDRAF";
addEntry("posts", { id: POST, slug: "launch-notes", locale: "en", status: "published" });
addEntry("posts", { id: OTHER_POST, slug: "other-notes", locale: "en", status: "published" });
addEntry("posts", { id: FRENCH_POST, slug: "launch-notes", locale: "fr", status: "published" });
addEntry("pages", { id: DRAFT_PAGE, slug: "draft-page", locale: "en", status: "draft" });
// Same namespace collision: one page's ID is another page's slug.
addEntry("pages", { id: "legacy-key", slug: "about", locale: "en", status: "published" });
addEntry("pages", { id: "01JPAGESLUGSLUGSLUGSLUGSLU", slug: "legacy-key", locale: "en", status: "published" });

const article = (headline: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline, ...extra });
const newId = (seed: string) => `entry-${seed.padEnd(20, "0").slice(0, 20)}`;
const postRef = { collection: "posts", entryId: POST, locale: "en" };

// --- bounded validation: syntax and data safety only --------------------------

assert.equal(validateEntrySchemaJson(article("{{title}} at {{siteName}}")).ok, true);
assert.equal(validateEntrySchemaJson(JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Thing" }] })).ok, true);
const rejected = (json: string) => {
	const result = validateEntrySchemaJson(json);
	assert.equal(result.ok, false, json.slice(0, 80));
	return result.ok ? "" : result.message;
};
assert.match(rejected(article("x".repeat(33_000))), /32,768 bytes/);
let deep: unknown = "leaf";
for (let level = 0; level < 18; level += 1) deep = { nested: deep };
assert.match(rejected(article("Deep", { deep })), /16 levels/);
assert.match(rejected(article("Wide", { list: Array.from({ length: 2_100 }, (_, index) => index) })), /2,000 values/);
assert.match(rejected(article("{{unknownVar}}")), /Unknown variables: \{\{unknownVar\}\}/);
assert.match(rejected(article("{{title|trim}}")), /filters and other braces/, "filter syntax is not left unresolved");
assert.match(rejected(article("{{foo-bar}}")), /filters and other braces/);
assert.match(rejected(article("closing }} only")), /filters and other braces/);
assert.match(
	rejected('{"@context":"https://schema.org","@type":"Article","headline":"\\u007b\\u007btitle|trim\\u007d\\u007d"}'),
	/filters and other braces/,
	"escaped delimiters are checked after JSON decoding",
);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@type": "Article", "{{title}}": "x" })), /property names/);
assert.match(rejected(JSON.stringify({ "@context": "https://evil.example/context.jsonld", "@type": "Article" })), /schema\.org/);
assert.match(
	rejected(JSON.stringify({ "@context": "https://schema.org", "@type": "Article", author: { "@context": ["https://schema.org", "https://x.example/c"], "@type": "Person" } })),
	/schema\.org/,
	"nested remote contexts are refused",
);
assert.match(rejected(JSON.stringify({ "@type": "Article" })), /@context/);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", name: "x" })), /@type or an @graph/);
assert.match(rejected(article("</script><script>alert(1)</script>")), /data only/);
assert.equal(validateEntrySchemaJson(JSON.stringify({ "@context": "https://schema.org", "@type": ["Article", "NewsArticle"], headline: "x" })).ok, true, "several type names stay valid");
assert.equal(validateEntrySchemaJson(JSON.stringify({ "@context": "https://schema.org", "@graph": { "@type": "Thing" } })).ok, true, "a single graph object stays valid");
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@type": 123 })), /@type must be/);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@type": null })), /@type must be/);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@type": "" })), /@type must be/);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@type": [] })), /@type must be/);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@type": "Article", author: { "@type": ["Person", 5] } })), /@type must be/);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@graph": 123 })), /@graph must be/);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@graph": [123] })), /@graph must be/);
assert.match(rejected(JSON.stringify({ "@context": "https://schema.org", "@graph": [] })), /@graph must be/);

// --- create, reload, edit and remove one exact entry's record -----------------

{
	const store = new VersionedStore();
	const host = hostFor(store);
	const created = await saveEntrySchema(host, { ...postRef, id: newId("a1"), expectedRevision: null, name: "Launch article", json: article("Launch"), enabled: true });
	assert.equal(created.success, true);
	if (!created.success) throw new Error("unreachable");
	assert.equal(created.alreadySaved, false);
	const stored = store.rows.get(newId("a1"))?.value as StoredEntrySchema;
	assert.equal(stored.scope, `posts:${POST}`);
	assert.deepEqual(stored.target, { collection: "posts", entryId: POST, locale: "en" });

	const listed = await listEntrySchemas(host, { collection: "posts", entryId: POST });
	assert.equal(listed.success, true);
	if (!listed.success) throw new Error("unreachable");
	assert.equal(listed.items.length, 1);
	assert.equal(Object.hasOwn(listed.items[0], "revision"), false, "a read-only list never supplies a write revision");
	assert.equal(listed.items[0].json, article("Launch"));
	assert.equal(listed.entry.locale, "en");
	assert.equal(listed.outputEnabled, true);

	const selected = await listEntrySchemas(host, { ...postRef, inspectId: newId("a1") });
	if (!selected.success || selected.inspected?.state !== "owned") throw new Error("the selected schema must be owned");
	assert.equal(selected.inspected.schema.revision, created.schema.revision);
	const edited = await saveEntrySchema(host, { ...postRef, id: newId("a1"), expectedRevision: selected.inspected.schema.revision, name: "Launch article", json: article("Launch, revised"), enabled: false });
	assert.equal(edited.success, true);
	if (!edited.success) throw new Error("unreachable");
	assert.equal(edited.schema.createdAt, created.schema.createdAt);
	assert.notEqual(edited.schema.revision, created.schema.revision);

	const stale = await saveEntrySchema(host, { ...postRef, id: newId("a1"), expectedRevision: created.schema.revision, name: "Old tab", json: article("Old tab"), enabled: true });
	assert.equal(stale.success, false);
	assert.equal(!stale.success && stale.error, "conflict", "a stale revision never overwrites");
	assert.equal(!stale.success && stale.error === "conflict" && stale.current?.json, article("Launch, revised"));
	assert.equal((store.rows.get(newId("a1"))?.value as StoredEntrySchema).json, article("Launch, revised"));

	const staleRemove = await removeEntrySchema(host, { ...postRef, id: newId("a1"), expectedRevision: created.schema.revision });
	assert.equal(!staleRemove.success && staleRemove.error, "conflict", "removal never deletes a newer edit");
	assert.ok(store.rows.has(newId("a1")));

	const inspectedOwned = await listEntrySchemas(host, { ...postRef, inspectId: newId("a1") });
	assert.equal(inspectedOwned.success && inspectedOwned.inspected?.state, "owned");
	store.seed("moved-away", { name: "Moved", scope: "global", json: article("Moved"), enabled: true });
	const inspectedElsewhere = await listEntrySchemas(host, { ...postRef, inspectId: "moved-away" });
	assert.equal(inspectedElsewhere.success && inspectedElsewhere.inspected?.state, "elsewhere", "a row outside this entry is not reported as deleted");
	const inspectedAbsent = await listEntrySchemas(host, { ...postRef, inspectId: newId("never") });
	assert.equal(inspectedAbsent.success && inspectedAbsent.inspected?.state, "absent");
	assert.equal((await listEntrySchemas(host, { ...postRef, inspectId: "bad id" })).success, false);
	store.rows.delete("moved-away");

	const removed = await removeEntrySchema(host, { ...postRef, id: newId("a1"), expectedRevision: edited.schema.revision });
	assert.deepEqual(removed, { success: true, id: newId("a1") });
	assert.equal(store.rows.has(newId("a1")), false);
	const again = await removeEntrySchema(host, { ...postRef, id: newId("a1"), expectedRevision: edited.schema.revision });
	assert.equal(!again.success && again.error, "not_found");
}

// --- list read budgets and exact selected snapshots -----------------------------

for (const count of [0, 1, ENTRY_SCHEMA_MAX_PER_ENTRY]) {
	const store = new VersionedStore();
	const host = hostFor(store);
	for (let index = 0; index < count; index += 1) {
		store.seed(`owned-${String(index).padStart(2, "0")}`, {
			name: `Owned ${index}`,
			scope: `posts:${POST}`,
			json: article(`Owned ${index}`),
			enabled: index % 2 === 0,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
			target: { collection: "posts", entryId: POST, locale: "en" },
		});
	}
	store.seed("inherited-site", { name: "Site", scope: "global", json: article("Site"), enabled: true });
	for (let index = 0; index < 50; index += 1) {
		store.seed(`unrelated-${index}`, { name: "Other entry", scope: `posts:${OTHER_POST}`, json: article("Other"), enabled: true });
	}
	const before = structuredClone([...store.rows.entries()]);
	const listed = await listEntrySchemas(host, postRef);
	assert.equal(listed.success, true);
	if (!listed.success) throw new Error("unreachable");
	assert.equal(listed.items.length, count);
	assert.deepEqual(store.versionedReads, [], `${count} list rows require no versioned reads`);
	assert.deepEqual(store.queries, [
		{ where: { scope: { in: ["global", "", "posts", `posts:${POST}`, "posts:launch-notes"] } }, limit: ENTRY_SCHEMA_MAX_APPLICABLE + 1 },
		{ where: { scope: null }, limit: ENTRY_SCHEMA_MAX_APPLICABLE - count },
	], "two bounded scope queries remain; unrelated entry records are not enumerated");
	assert.deepEqual(listed.inherited.map((item) => item.id), ["inherited-site"]);
	for (const [index, summary] of listed.items.entries()) {
		assert.equal(Object.hasOwn(summary, "revision"), false);
		assert.equal(summary.id, `owned-${String(index).padStart(2, "0")}`);
		assert.equal(summary.name, `Owned ${index}`);
		assert.equal(summary.json, article(`Owned ${index}`));
		assert.equal(summary.enabled, index % 2 === 0);
		assert.deepEqual(summary.types, ["Article"]);
		assert.equal(summary.valid, true);
		assert.equal(summary.validationError, null);
		assert.equal(summary.createdAt, "2026-01-01T00:00:00.000Z");
		assert.equal(summary.updatedAt, "2026-01-02T00:00:00.000Z");
	}
	store.queries = [];
	const inspectId = count ? listed.items[count - 1].id : "not-present";
	const inspected = await listEntrySchemas(host, { ...postRef, inspectId });
	assert.equal(inspected.success, true);
	if (!inspected.success) throw new Error("unreachable");
	assert.deepEqual(store.versionedReads, [inspectId], "exact inspection reads only the chosen ID, including an already listed row");
	assert.equal(store.queries.length, 2);
	assert.equal(inspected.inspected?.state, count ? "owned" : "absent");
	if (inspected.inspected?.state === "owned") {
		assert.equal(inspected.inspected.schema.revision, store.rows.get(inspectId)?.revision);
		assert.equal(inspected.inspected.schema.json, article(`Owned ${count - 1}`));
	}
	assert.deepEqual([...store.rows.entries()], before, "list and inspection never change storage");
}

for (const change of ["updated", "moved", "deleted"] as const) {
	const store = new VersionedStore();
	const host = hostFor(store);
	const id = "selected-during-query";
	const value = {
		name: "Before selection",
		scope: `posts:${POST}`,
		json: article("Before selection"),
		enabled: true,
		target: { collection: "posts", entryId: POST, locale: "en" },
	};
	const oldRevision = store.seed(id, value);
	let changed = false;
	store.queryShape = (result) => {
		if (!changed) {
			changed = true;
			if (change === "deleted") store.rows.delete(id);
			else store.seed(id, change === "updated"
				? { ...value, name: "After selection", json: article("After selection") }
				: { ...value, scope: `posts:${OTHER_POST}`, target: { ...value.target, entryId: OTHER_POST } });
		}
		return result;
	};
	const result = await listEntrySchemas(host, { ...postRef, inspectId: id });
	assert.equal(result.success, true);
	if (!result.success) throw new Error("unreachable");
	assert.equal(result.items[0].name, "Before selection", "the list remains the read-only query snapshot");
	assert.equal(Object.hasOwn(result.items[0], "revision"), false);
	assert.deepEqual(store.versionedReads, [id]);
	assert.equal(store.queries.length, 2);
	assert.deepEqual(result.entry, { ...postRef, slug: "launch-notes", status: "published" });
	assert.equal(result.inspected?.state, change === "updated" ? "owned" : change === "moved" ? "elsewhere" : "absent");
	if (result.inspected?.state === "owned") {
		assert.equal(result.inspected.schema.name, "After selection");
		assert.equal(result.inspected.schema.json, article("After selection"));
		assert.notEqual(result.inspected.schema.revision, oldRevision, "opening uses the selected snapshot, not a list revision");
	}
}

{
	const store = new VersionedStore();
	const host = hostFor(store);
	const id = newId("repair");
	const revision = store.seed(id, { name: "Broken JSON", scope: `posts:${POST}`, json: "{", enabled: true, target: { collection: "posts", entryId: POST, locale: "en" } });
	const listed = await listEntrySchemas(host, postRef);
	if (!listed.success) throw new Error("unreachable");
	assert.equal(listed.items[0].valid, false);
	assert.equal(listed.items[0].json, "{", "invalid stored JSON stays visible for repair");
	assert.equal(typeof listed.items[0].validationError, "string");
	assert.equal(Object.hasOwn(listed.items[0], "revision"), false);
	assert.deepEqual(store.versionedReads, []);
	const selected = await listEntrySchemas(host, { ...postRef, inspectId: id });
	if (!selected.success || selected.inspected?.state !== "owned") throw new Error("an owned invalid schema can be repaired");
	assert.equal(selected.inspected.schema.valid, false);
	assert.equal(selected.inspected.schema.revision, revision);
	assert.deepEqual(store.versionedReads, [id]);
	const repaired = await saveEntrySchema(host, { ...postRef, id, expectedRevision: selected.inspected.schema.revision, name: "Repaired", json: article("Repaired"), enabled: true });
	assert.equal(repaired.success && repaired.schema.valid, true, "exact ownership and revision permit repair without trusting the list");
}

// --- ownership: inherited, other-entry and legacy records stay read-only -------

{
	const store = new VersionedStore();
	const host = hostFor(store);
	const globalRevision = store.seed("global-1", { name: "Site", scope: "global", json: article("Site"), enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	store.seed("posts-1", { name: "All posts", scope: "posts", json: article("Posts"), enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	store.seed("unscoped-1", { name: "Unscoped", json: article("Unscoped"), enabled: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	const legacyRevision = store.seed("legacy-1", { name: "Old panel", scope: `posts:${POST}`, json: article("Old"), enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	const otherRevision = store.seed("other-1", { name: "Other", scope: `posts:${OTHER_POST}`, json: article("Other"), enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", target: { collection: "posts", entryId: OTHER_POST, locale: "en" } });
	const snapshot = structuredClone([...store.rows.entries()]);

	const listed = await listEntrySchemas(host, { collection: "posts", entryId: POST, locale: "en" });
	assert.equal(listed.success, true);
	if (!listed.success) throw new Error("unreachable");
	assert.deepEqual(listed.items, []);
	assert.deepEqual(
		listed.inherited.map((item) => [item.id, item.owner]).sort(),
		[["global-1", "site"], ["legacy-1", "legacy-entry"], ["posts-1", "collection"], ["unscoped-1", "site"]],
		"inherited and untargeted exact-scope records are read-only; another entry's record does not apply",
	);

	for (const [id, revision] of [["global-1", globalRevision], ["legacy-1", legacyRevision], ["other-1", otherRevision]] as const) {
		const save = await saveEntrySchema(host, { ...postRef, id, expectedRevision: revision, name: "Moved", json: article("Moved"), enabled: true });
		assert.equal(!save.success && save.error, "scope_mismatch", `${id} cannot be edited from this entry`);
		const remove = await removeEntrySchema(host, { ...postRef, id, expectedRevision: revision });
		assert.equal(!remove.success && remove.error, "scope_mismatch", `${id} cannot be removed from this entry`);
	}
	assert.deepEqual([...store.rows.entries()], snapshot, "no shared, legacy or other-entry record changed");

	const duplicate = await saveEntrySchema(host, {
		...postRef,
		id: newId("dup"),
		expectedRevision: null,
		name: "Duplicate",
		json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": "https://example.com/#thing", name: "x" }),
		enabled: true,
	});
	assert.equal(duplicate.success, true, "no enabled applicable record defines that entity yet");
	store.seed("posts-entity", { name: "Typed", scope: "posts", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": "https://example.com/#shared", name: "y" }), enabled: true, createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });
	store.seed("broken-target", { name: "Broken", scope: "global", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": "https://example.com/#suppressed", name: "z" }), enabled: true, createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", target: { collection: "posts", entryId: POST, locale: "en" } });
	const conflicting = await saveEntrySchema(host, { ...postRef, id: newId("dup2"), expectedRevision: null, name: "Clash", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": "https://example.com/#shared", name: "x" }), enabled: true });
	assert.equal(!conflicting.success && conflicting.error, "invalid_values");
	assert.match(!conflicting.success && conflicting.error === "invalid_values" ? conflicting.errors.json ?? "" : "", /this content type/);
	const suppressedTwin = await saveEntrySchema(host, { ...postRef, id: newId("dup3"), expectedRevision: null, name: "Twin", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": "https://example.com/#suppressed", name: "x" }), enabled: true });
	assert.equal(suppressedTwin.success, true, "a record the public reader drops for its invalid target cannot collide");
	const relisted = await listEntrySchemas(host, { collection: "posts", entryId: POST, locale: "en" });
	assert.equal(relisted.success && relisted.inherited.find((item) => item.id === "broken-target")?.valid, false, "the invalid record stays visible as invalid");
}

// --- same ID and slug namespace -----------------------------------------------

{
	const store = new VersionedStore();
	const host = hostFor(store);
	const slugPage = "01JPAGESLUGSLUGSLUGSLUGSLU";
	const untargetedRevision = store.seed("shared-key", { name: "Ambiguous", scope: "pages:legacy-key", json: article("Ambiguous"), enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	const ownerList = await listEntrySchemas(host, { collection: "pages", entryId: "legacy-key", locale: "en" });
	const slugList = await listEntrySchemas(host, { collection: "pages", entryId: slugPage, locale: "en" });
	assert.equal(ownerList.success && ownerList.inherited[0]?.owner, "legacy-entry");
	assert.equal(slugList.success && slugList.inherited[0]?.owner, "legacy-slug");
	for (const entryId of ["legacy-key", slugPage]) {
		const result = await removeEntrySchema(host, { collection: "pages", entryId, locale: "en", id: "shared-key", expectedRevision: untargetedRevision });
		assert.equal(!result.success && result.error, "scope_mismatch", "neither entry can prove it owns an untargeted record");
	}
	assert.ok(store.rows.has("shared-key"));

	const owned = await saveEntrySchema(host, { collection: "pages", entryId: "legacy-key", locale: "en", id: newId("key"), expectedRevision: null, name: "Owned", json: article("Owned"), enabled: true });
	assert.equal(owned.success, true);
	const slugAfter = await listEntrySchemas(host, { collection: "pages", entryId: slugPage, locale: "en" });
	assert.equal(slugAfter.success && slugAfter.inherited.some((item) => item.id === newId("key")), false, "a targeted record never reaches the slug twin");
	const ownedValue = store.rows.get(newId("key"))?.value;
	assert.equal(entrySchemaTargetMatches(ownedValue, { collection: "pages", id: "legacy-key", locale: "en" }), true);
	assert.equal(entrySchemaTargetMatches(ownedValue, { collection: "pages", id: slugPage, locale: "en" }), false);
	assert.equal(entrySchemaTargetMatches(ownedValue, { collection: "pages", id: "legacy-key", locale: "nl" }), false, "another locale for the same ID does not match");
	assert.equal(entrySchemaTargetMatches(ownedValue, null), false, "without a loaded entry a target fails closed");
	assert.equal(entrySchemaTargetMatches({ scope: "pages:legacy-key", name: "Legacy" }, null), true, "untargeted legacy records keep their public behavior");
	assert.equal(entrySchemaTargetMatches({ scope: "global", target: { collection: "pages", entryId: "legacy-key", locale: "en" } }, { collection: "pages", id: "legacy-key", locale: "en" }), false, "a target inconsistent with its scope fails closed");
}

// --- exact identity and locale --------------------------------------------------

{
	const store = new VersionedStore();
	const host = hostFor(store);
	const wrongLocale = await saveEntrySchema(host, { collection: "posts", entryId: FRENCH_POST, locale: "en", id: newId("fr"), expectedRevision: null, name: "FR", json: article("FR"), enabled: true });
	assert.equal(!wrongLocale.success && wrongLocale.error, "entry_mismatch", "a stale locale is refused");
	const french = await saveEntrySchema(host, { collection: "posts", entryId: FRENCH_POST, locale: "fr", id: newId("fr"), expectedRevision: null, name: "FR", json: article("FR"), enabled: true });
	assert.equal(french.success, true);
	assert.equal((store.rows.get(newId("fr"))?.value as StoredEntrySchema).target.locale, "fr");
	const english = await listEntrySchemas(host, postRef);
	assert.equal(english.success && english.items.length, 0, "the English translation shares the slug but not the record");
	assert.equal(english.success && english.inherited.length, 0);

	const slugLookup = hostFor(store, { getEntry: async () => ({ id: POST, slug: "launch-notes", locale: "en", status: "published" }) });
	const bySlug = await listEntrySchemas(slugLookup, { collection: "posts", entryId: "launch-notes" });
	assert.equal(!bySlug.success && bySlug.error, "entry_mismatch", "a host resolving a slug is not the exact entry");
	const missing = await listEntrySchemas(host, { collection: "posts", entryId: "01JMISSINGMISSINGMISSINGMI" });
	assert.equal(!missing.success && missing.error, "entry_not_found");
	const unknownType = await listEntrySchemas(host, { collection: "products", entryId: POST });
	assert.equal(!unknownType.success && unknownType.error, "entry_not_found");
	const draft = await listEntrySchemas(host, { collection: "pages", entryId: DRAFT_PAGE });
	assert.equal(draft.success && draft.entry.status, "draft", "the editor is told the entry is not published");
}

// --- create-if-absent, recovery and caps --------------------------------------

{
	const store = new VersionedStore();
	const host = hostFor(store);
	store.seed(newId("taken"), { name: "Someone else", scope: `posts:${OTHER_POST}`, json: article("Else"), enabled: true, target: { collection: "posts", entryId: OTHER_POST, locale: "en" } });
	const taken = await saveEntrySchema(host, { ...postRef, id: newId("taken"), expectedRevision: null, name: "Mine", json: article("Mine"), enabled: true });
	assert.equal(!taken.success && taken.error, "id_in_use");
	assert.equal((store.rows.get(newId("taken"))?.value as StoredEntrySchema).name, "Someone else");

	store.failWrite = (id) => id === newId("lost");
	const lost = await saveEntrySchema(host, { ...postRef, id: newId("lost"), expectedRevision: null, name: "Lost", json: article("Lost"), enabled: true });
	assert.equal(!lost.success && lost.error, "unconfirmed", "a thrown write is unconfirmed, not failed");
	store.failWrite = null;
	const retried = await saveEntrySchema(host, { ...postRef, id: newId("lost"), expectedRevision: null, name: "Lost", json: article("Lost"), enabled: true });
	assert.equal(retried.success && retried.alreadySaved, true, "retrying the same identifier finds the committed create");
	assert.equal(store.rows.size, 2, "the retry did not create a second record");
}

{
	// A recovered create only knows a revision read back later. An editor may have
	// saved the same content since, so over a cap the record is kept and reported.
	const store = new VersionedStore();
	const host = hostFor(store);
	for (let index = 0; index < ENTRY_SCHEMA_MAX_PER_ENTRY; index += 1) {
		store.seed(`own-${index}`, { name: `Own ${index}`, scope: `posts:${POST}`, json: article(`Own ${index}`), enabled: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", target: { collection: "posts", entryId: POST, locale: "en" } });
	}
	const limited = await saveEntrySchema(host, { ...postRef, id: newId("cap"), expectedRevision: null, name: "Too many", json: article("Too many"), enabled: false });
	assert.equal(!limited.success && limited.error, "limit_reached");
	store.seed(newId("recovered"), { name: "Recovered", scope: `posts:${POST}`, json: article("Recovered"), enabled: false, createdAt: "2026-10-02T11:00:00.000Z", updatedAt: "2026-10-02T11:30:00.000Z", target: { collection: "posts", entryId: POST, locale: "en" } });
	const newerRevision = store.seed(newId("recovered"), { name: "Recovered", scope: `posts:${POST}`, json: article("Recovered"), enabled: false, createdAt: "2026-10-02T11:00:00.000Z", updatedAt: "2026-10-02T11:45:00.000Z", target: { collection: "posts", entryId: POST, locale: "en" } });
	const recovered = await saveEntrySchema(host, { ...postRef, id: newId("recovered"), expectedRevision: null, name: "Recovered", json: article("Recovered"), enabled: false });
	assert.equal(!recovered.success && recovered.error, "limit_reached");
	assert.match(!recovered.success && "message" in recovered ? recovered.message : "", /kept/);
	assert.equal(store.rows.get(newId("recovered"))?.revision, newerRevision, "same content at a newer revision is not deleted");
}

{
	// Two creates for one entry pass the checks before either writes; the total stays far below 500.
	const store = new VersionedStore();
	const host = hostFor(store);
	for (let index = 0; index < ENTRY_SCHEMA_MAX_PER_ENTRY - 1; index += 1) {
		store.seed(`own-${index}`, { name: `Own ${index}`, scope: `posts:${POST}`, json: article(`Own ${index}`), enabled: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", target: { collection: "posts", entryId: POST, locale: "en" } });
	}
	let arrived = 0;
	let release!: () => void;
	const bothArrived = new Promise<void>((resolve) => (release = resolve));
	store.beforeWrite = async () => {
		arrived += 1;
		if (arrived === 2) release();
		await bothArrived;
	};
	const results = await Promise.all(["racea", "raceb"].map((seed) =>
		saveEntrySchema(host, { ...postRef, id: newId(seed), expectedRevision: null, name: seed, json: article(seed), enabled: false }),
	));
	store.beforeWrite = null;
	const ownCount = [...store.rows.values()].filter((row) => (row.value as StoredEntrySchema).scope === `posts:${POST}`).length;
	assert.ok(ownCount <= ENTRY_SCHEMA_MAX_PER_ENTRY, `per-entry cap holds under a concurrent create (${ownCount})`);
	assert.ok(store.rows.size < 500);
	for (const result of results) {
		assert.ok(result.success || (result.error === "limit_reached" && /rolled back/.test((result as { message: string }).message)), JSON.stringify(result));
	}
	assert.equal(results.filter((result) => result.success).length, ownCount - (ENTRY_SCHEMA_MAX_PER_ENTRY - 1));
}

// --- invalid or incomplete storage reads are never an empty list ----------------

{
	const store = new VersionedStore();
	const host = hostFor(store);
	store.seed("global-1", { name: "Site", scope: "global", json: article("Site"), enabled: true });
	store.queryShape = (result) => ({ ...(result as object), items: undefined });
	const missingItems = await listEntrySchemas(host, postRef);
	assert.equal(!missingItems.success && missingItems.error, "storage_unavailable");
	store.queryShape = (result) => ({ ...(result as object), items: [{ id: "global-1" }] });
	assert.equal((await listEntrySchemas(host, postRef)).success, false, "a row without data is an invalid read");
	store.queryShape = (result) => ({ items: (result as { items: unknown[] }).items });
	assert.equal((await listEntrySchemas(host, postRef)).success, false, "a page without hasMore is an invalid read");
	store.queryShape = null;
	store.seed(newId("shape"), { name: "Mine", scope: `posts:${POST}`, json: article("Mine"), enabled: true, target: { collection: "posts", entryId: POST, locale: "en" } });
	store.versionedShape = (result) => (result ? { value: "not an object", revision: "x" } : result);
	assert.equal((await listEntrySchemas(host, postRef)).success, true, "listing does not depend on per-row versioned reads");
	const malformedInspection = await listEntrySchemas(host, { ...postRef, inspectId: newId("shape") });
	assert.equal(!malformedInspection.success && malformedInspection.error, "storage_unavailable", "a malformed exact snapshot cannot be opened for editing");
	store.versionedShape = null;
	for (let index = 0; index < 101; index += 1) store.seed(`bulk-${index}`, { name: "Bulk", scope: "posts", json: article("Bulk"), enabled: false });
	const tooMany = await listEntrySchemas(host, postRef);
	assert.equal(!tooMany.success && tooMany.error, "too_many_applicable", "more than 100 applicable rows is explicit, not truncated");
}

{
	const store = new VersionedStore();
	const host = hostFor(store);
	const saved = await saveEntrySchema(host, { ...postRef, id: newId("del"), expectedRevision: null, name: "Del", json: article("Del"), enabled: true });
	assert.equal(saved.success, true);
	store.failDelete = true;
	const unconfirmed = await removeEntrySchema(host, { ...postRef, id: newId("del"), expectedRevision: saved.success ? saved.schema.revision : "" });
	assert.equal(!unconfirmed.success && unconfirmed.error, "unconfirmed");
}

// --- native routes, public output and legacy paths -------------------------------

const kvStore = new VersionedStore();
kvStore.seed("settings:siteName", "Example");
kvStore.seed("settings:siteUrl", "https://example.com");
const runtimeStore = new VersionedStore();
const contentItems = new Map<string, any>([
	[`posts:${POST}`, { id: POST, type: "posts", slug: "launch-notes", status: "published", locale: "en", data: { title: "Launch notes" }, seo: null, updatedAt: "2026-09-01T10:00:00.000Z", publishedAt: "2026-09-01T10:00:00.000Z" }],
	[`posts:${OTHER_POST}`, { id: OTHER_POST, type: "posts", slug: POST, status: "published", locale: "en", data: { title: "Slug twin" }, seo: null, updatedAt: "2026-09-01T10:00:00.000Z", publishedAt: "2026-09-01T10:00:00.000Z" }],
]);
const context = {
	plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
	site: { name: "Example", url: "https://example.com", locale: "en" },
	schema: { listCollections: async () => [{ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" }] },
	kv: {
		get: (key: string) => kvStore.get(key),
		set: (key: string, value: unknown) => kvStore.put(key, value),
		delete: (key: string) => kvStore.delete(key),
		list: async () => [],
		getVersioned: (key: string) => kvStore.getVersioned(key),
		compareAndSet: (key: string, revision: string | null, value: unknown) => kvStore.compareAndSet(key, revision, value as StoredEntrySchema),
		compareAndDelete: (key: string, revision: string) => kvStore.compareAndDelete(key, revision),
	},
	// Routes may spread the context, so collections they need must exist up front.
	storage: new Proxy({ schemas: runtimeStore, operationLeases: new VersionedStore() } as Record<string, unknown>, {
		get: (target, key: string) => (target[key] ??= new VersionedStore()),
	}),
	content: {
		get: async (collection: string, id: string) => structuredClone(contentItems.get(`${collection}:${id}`) ?? null),
		getPublicUrl: async (collection: string, id: string) => {
			const item = contentItems.get(`${collection}:${id}`);
			return item ? `https://example.com/posts/${item.slug}` : null;
		},
		list: async () => ({ items: [], hasMore: false }),
	},
	url: (path: string) => new URL(path, "https://example.com").href,
	log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
};
const routes = (seoRuntime as any).routes;
const call = (route: string, input: unknown) => routes[route].handler({ input }, context);
for (const route of ["entry-custom-schemas", "save-entry-custom-schema", "remove-entry-custom-schema"]) {
	assert.equal(routes[route].permission, "plugins:manage", `${route} keeps the Admin-only boundary explicit`);
}
assert.equal(routes["save-entry-custom-schema"].input.safeParse({ ...postRef, id: newId("z"), expectedRevision: null, name: "x", json: "{}", enabled: true, scope: "global" }).success, false, "a caller cannot pass a scope");

function page(id: string, slug: string): PublicPageContext {
	return {
		url: `https://example.com/posts/${slug}`,
		path: `/posts/${slug}`,
		locale: "en",
		kind: "content",
		pageType: "article",
		title: slug,
		pageTitle: slug,
		description: "",
		canonical: `https://example.com/posts/${slug}`,
		image: null,
		content: { collection: "posts", id, slug },
		seo: {},
		siteName: "Example",
		siteUrl: "https://example.com",
	} as PublicPageContext;
}
const customGraphs = async (id: string, slug: string) =>
	((await (seoRuntime as any).hooks["page:metadata"].handler({ page: page(id, slug) }, context)) as any[])
		.filter((item) => item.kind === "jsonld" && String(item.id).startsWith("custom:"))
		.map((item) => item.id);

const routeSaved = await call("save-entry-custom-schema", { ...postRef, id: newId("route"), expectedRevision: null, name: "Route article", json: article("{{title}}"), enabled: true });
assert.equal(routeSaved.contractVersion !== undefined && routeSaved.success, true);
assert.deepEqual(await customGraphs(POST, "launch-notes"), [`custom:${newId("route")}`], "the saved record reaches its own page");
assert.deepEqual(await customGraphs(OTHER_POST, POST), [], "the slug alias does not carry it to the entry whose slug is this ID");
const twinPreview = await call("entry-schema-preview", { ref: `posts:${OTHER_POST}`, entryOnly: true });
assert.equal(twinPreview.items.some((item: any) => item.id === `custom:${newId("route")}`), false, "the preview agrees with public output");

// Legacy workspace saves keep the target, and cannot move an entry's record.
const legacyMove = await call("save-admin-custom-schema", { id: newId("route"), expectedRevision: (await runtimeStore.getVersioned(newId("route")) as { revision: string }).revision, name: "Route article", scope: "global", json: article("Moved"), enabled: true });
assert.equal(legacyMove.success, false);
assert.ok(legacyMove.errors.scope);
const legacyEdit = await call("save-admin-custom-schema", { id: newId("route"), expectedRevision: (await runtimeStore.getVersioned(newId("route")) as { revision: string }).revision, name: "Renamed in workspace", scope: `posts:${POST}`, json: article("Workspace"), enabled: true });
assert.equal(legacyEdit.success, true);
assert.deepEqual((runtimeStore.rows.get(newId("route"))?.value as StoredEntrySchema).target, { collection: "posts", entryId: POST, locale: "en" });
const configuration = await call("admin-configuration", { limit: 10 });
assert.deepEqual(configuration.schema.customSchemas.find((item: any) => item.id === newId("route"))?.target, { collection: "posts", entryId: POST, locale: "en" });

// A backup round trip keeps ownership; a bundle with a target that contradicts its scope is refused.
const exported = await call("admin-portability-export", {});
const exportedSchema = exported.bundle.configuration.customSchemas.find((item: any) => item.id === newId("route"));
assert.deepEqual(exportedSchema.target, { collection: "posts", entryId: POST, locale: "en" });
assert.equal(validateSeoPortabilityBundle(exported.bundle).success, true);
const contradicting = structuredClone(exported.bundle);
contradicting.configuration.customSchemas.find((item: any) => item.id === newId("route")).target.entryId = OTHER_POST;
assert.equal(validateSeoPortabilityBundle(contradicting).success, false);
runtimeStore.rows.delete(newId("route"));
const preview = await call("admin-portability-preview", { bundle: exported.bundle, mode: "merge" });
assert.equal(preview.success, true, JSON.stringify(preview).slice(0, 300));
const applied = await call("admin-portability-apply", { bundle: exported.bundle, mode: "merge", confirmation: SEO_PORTABILITY_CONFIRMATION, planFingerprint: preview.plan.fingerprint });
assert.equal(applied.success, true, JSON.stringify(applied).slice(0, 300));
assert.deepEqual((runtimeStore.rows.get(newId("route"))?.value as StoredEntrySchema).target, { collection: "posts", entryId: POST, locale: "en" }, "import writes the target back");
assert.deepEqual(await customGraphs(OTHER_POST, POST), [], "after import the slug twin still does not receive it");

// An imported target naming another locale for this row is syntactically valid but never applies.
const wrongLocale = structuredClone(exported.bundle);
wrongLocale.configuration.customSchemas.find((item: any) => item.id === newId("route")).target.locale = "nl";
assert.equal(validateSeoPortabilityBundle(wrongLocale).success, true, "import validation stays syntactic");
const wrongPreview = await call("admin-portability-preview", { bundle: wrongLocale, mode: "merge" });
const wrongApplied = await call("admin-portability-apply", { bundle: wrongLocale, mode: "merge", confirmation: SEO_PORTABILITY_CONFIRMATION, planFingerprint: wrongPreview.plan.fingerprint });
assert.equal(wrongApplied.success, true);
assert.equal((runtimeStore.rows.get(newId("route"))?.value as StoredEntrySchema).target.locale, "nl");
assert.deepEqual(await customGraphs(POST, "launch-notes"), [], "a wrong-locale target is suppressed on the public page");
const wrongEntryPreview = await call("entry-schema-preview", { ref: `posts:${POST}`, entryOnly: true });
assert.equal(wrongEntryPreview.items.some((item: any) => item.id === `custom:${newId("route")}`), false, "and in the preview");
const wrongList = await call("entry-custom-schemas", { collection: "posts", entryId: POST, locale: "en" });
const wrongRow = wrongList.inherited.find((item: any) => item.id === newId("route"));
assert.equal(wrongRow?.owner, "wrong-locale");
assert.equal(wrongRow?.targetLocale, "nl", "the editor sees which locale the record names");
assert.equal(wrongList.items.some((item: any) => item.id === newId("route")), false, "and cannot edit it as its own");
const wrongSave = await call("save-entry-custom-schema", { ...postRef, id: newId("route"), expectedRevision: runtimeStore.rows.get(newId("route"))?.revision ?? "", name: "x", json: article("x"), enabled: true });
assert.equal(wrongSave.success === false && wrongSave.error, "scope_mismatch");

console.log("SEO entry custom schema self-check passed.");
