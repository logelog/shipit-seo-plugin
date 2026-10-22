import assert from "node:assert/strict";

import { SEO_ADMIN_SCHEMA_LIBRARY_LIMITS, SEO_ADMIN_SCHEMA_LIBRARY_WRITE_REQUEST_MAX_BYTES } from "./admin-contract.ts";
import { ENTRY_SCHEMA_JSON_MAX_BYTES, ENTRY_SCHEMA_MAX_DEPTH, ENTRY_SCHEMA_MAX_VALUES, ENTRY_SCHEMA_NAME_MAX_LENGTH } from "./entry-schemas.ts";
import {
	SCHEMA_LIBRARY_KEY,
	SCHEMA_LIBRARY_MAX_RECORD_BYTES,
	SCHEMA_LIBRARY_MAX_TEMPLATES,
	deleteSchemaLibraryTemplate,
	parseSchemaLibraryRecord,
	readSchemaLibrary,
	saveSchemaLibraryTemplate,
	type SchemaLibraryHost,
} from "./schema-library.ts";
import seoRuntime from "./sandbox-entry.ts";

assert.deepEqual(SEO_ADMIN_SCHEMA_LIBRARY_LIMITS, {
	templates: SCHEMA_LIBRARY_MAX_TEMPLATES,
	recordBytes: SCHEMA_LIBRARY_MAX_RECORD_BYTES,
	templateBytes: ENTRY_SCHEMA_JSON_MAX_BYTES,
	depth: ENTRY_SCHEMA_MAX_DEPTH,
	values: ENTRY_SCHEMA_MAX_VALUES,
	nameLength: ENTRY_SCHEMA_NAME_MAX_LENGTH,
}, "the admin limits are the library and entry limits");
assert.equal(SCHEMA_LIBRARY_KEY, "schema-library:v1");

// The published 1.1.0 KV contract: opaque revisions, create only when absent
// for a null expected revision, and a stored JSON copy of the value.
class VersionedKv {
	rows = new Map<string, { value: string; revision: string }>();
	writes = 0;
	private sequence = 0;
	afterCommit: (() => never) | null = null;
	envelope: ((result: unknown) => unknown) | null = null;
	readFails = false;
	result: ((applied: unknown) => unknown) | null = null;

	seed(key: string, value: unknown): string {
		this.sequence += 1;
		const revision = `kv-${this.sequence}`;
		this.rows.set(key, { value: JSON.stringify(value), revision });
		return revision;
	}
	async getVersioned(key: string) {
		if (this.readFails) throw new Error("database is locked");
		const row = this.rows.get(key);
		const result = row ? { value: JSON.parse(row.value), revision: row.revision } : null;
		return this.envelope ? this.envelope(result) : result;
	}
	async compareAndSet(key: string, expectedRevision: string | null, value: unknown) {
		const row = this.rows.get(key);
		if (expectedRevision === null ? row : row?.revision !== expectedRevision) return { applied: false };
		this.writes += 1;
		const revision = this.seed(key, value);
		this.afterCommit?.();
		const applied = { applied: true, revision };
		return this.result ? this.result(applied) : applied;
	}
	stored() {
		const row = this.rows.get(SCHEMA_LIBRARY_KEY);
		return row ? JSON.parse(row.value) : null;
	}
}

const host = (kv: Partial<VersionedKv> | null): SchemaLibraryHost => ({
	kv: kv as SchemaLibraryHost["kv"],
	now: () => "2026-10-03T08:00:00.000Z",
});
const json = (headline: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline, ...extra });
const tid = (seed: string) => `tpl-${seed.padEnd(20, "0").slice(0, 20)}`;

// --- absent, create, reload, edit ---------------------------------------------

const kv = new VersionedKv();
const absent = await readSchemaLibrary(host(kv));
assert.deepEqual(absent, { state: "absent", revision: null, templates: [], bytes: 0 });
assert.equal(kv.writes, 0, "reading creates nothing");

const created = await saveSchemaLibraryTemplate(host(kv), { mode: "create", expectedRevision: null, id: tid("a"), name: "  Article  ", json: `  ${json("{{title}}")}  ` });
assert.equal(created.success, true, JSON.stringify(created));
if (!created.success) throw new Error("unreachable");
assert.equal(created.template?.name, "Article", "names are trimmed");
assert.equal(created.template?.json, json("{{title}}"), "JSON is kept unresolved and trimmed");
assert.equal(created.library.templates.length, 1);
const reloaded = await readSchemaLibrary(host(kv));
assert.equal(reloaded.state, "saved");
assert.equal(reloaded.revision, created.library.revision);
assert.deepEqual(reloaded.state === "saved" && reloaded.templates, created.library.templates);
assert.equal(reloaded.state === "saved" && reloaded.bytes, new TextEncoder().encode(kv.rows.get(SCHEMA_LIBRARY_KEY)!.value).byteLength,
	"the byte count is the stored JSON");
assert.deepEqual(Object.keys(kv.stored()), ["version", "templates"], "no scope, enabled flag or output setting is stored");
assert.deepEqual(Object.keys(kv.stored().templates[0]).sort(), ["createdAt", "id", "json", "name", "updatedAt"]);

const second = await saveSchemaLibraryTemplate(host(kv), { mode: "create", expectedRevision: created.library.revision, id: tid("b"), name: "FAQ", json: json("FAQ") });
assert.equal(second.success, true);
if (!second.success) throw new Error("unreachable");

const editedName = await saveSchemaLibraryTemplate(host(kv), { mode: "update", expectedRevision: second.library.revision, id: tid("a"), name: "Article page", json: json("{{title}} at {{siteName}}") });
assert.equal(editedName.success, true);
if (!editedName.success) throw new Error("unreachable");
assert.deepEqual(editedName.library.templates.map((item) => item.id), [tid("a"), tid("b")], "an edit keeps its position");
assert.equal(editedName.template?.createdAt, created.template?.createdAt);

const writesBefore = kv.writes;
const unchanged = await saveSchemaLibraryTemplate(host(kv), { mode: "update", expectedRevision: editedName.library.revision, id: tid("a"), name: "Article page", json: json("{{title}} at {{siteName}}") });
assert.equal(unchanged.success && unchanged.changed, false);
assert.equal(kv.writes, writesBefore, "saving the stored values again writes nothing");

// --- refusals that change nothing ------------------------------------------------

const snapshotBefore = kv.rows.get(SCHEMA_LIBRARY_KEY);
const current = editedName.library.revision;
const refuse = async (input: Record<string, unknown>, error: string, field?: "name" | "json") => {
	const result = await saveSchemaLibraryTemplate(host(kv), input);
	assert.equal(result.success, false, JSON.stringify(input).slice(0, 120));
	if (result.success) return;
	assert.equal(result.error, error, JSON.stringify(result));
	if (field) assert.ok(result.error === "invalid_values" && result.errors[field], field);
	assert.deepEqual(kv.rows.get(SCHEMA_LIBRARY_KEY), snapshotBefore, "nothing was written");
};
await refuse({ mode: "update", expectedRevision: created.library.revision, id: tid("a"), name: "Old", json: json("Old") }, "conflict");
await refuse({ mode: "create", expectedRevision: null, id: tid("c"), name: "New", json: json("New") }, "conflict", undefined);
await refuse({ mode: "create", expectedRevision: current, id: tid("a"), name: "Again", json: json("Again") }, "id_in_use");
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "faq", json: json("x") }, "invalid_values", "name");
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "", json: json("x") }, "invalid_values", "name");
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "n".repeat(121), json: json("x") }, "invalid_values", "name");
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "Big", json: json("x".repeat(ENTRY_SCHEMA_JSON_MAX_BYTES)) }, "invalid_values", "json");
let deep: unknown = "leaf";
for (let level = 0; level < ENTRY_SCHEMA_MAX_DEPTH + 1; level += 1) deep = { nested: deep };
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "Deep", json: json("x", { deep }) }, "invalid_values", "json");
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "Wide", json: json("x", { list: Array.from({ length: ENTRY_SCHEMA_MAX_VALUES + 1 }, () => 1) }) }, "invalid_values", "json");
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "Unknown", json: json("{{price}}") }, "invalid_values", "json");
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "Filter", json: json("{{title|upper}}") }, "invalid_values", "json");
await refuse({ mode: "create", expectedRevision: current, id: tid("c"), name: "Bad", json: "{not json" }, "invalid_values", "json");
await refuse({ mode: "create", expectedRevision: current, id: "custom", name: "Id", json: json("x") }, "invalid_input");
await refuse({ mode: "update", expectedRevision: current, id: tid("zz"), name: "Missing", json: json("x") }, "invalid_input");
await refuse({ mode: "update", expectedRevision: null, id: tid("a"), name: "Null", json: json("x") }, "invalid_input");
await refuse({ mode: "copy", expectedRevision: current, id: tid("a"), name: "Mode", json: json("x") }, "invalid_input");

// The whole stored value is capped, counted as the stored JSON.
{
	const big = new VersionedKv();
	let revision: string | null = null;
	let count = 0;
	for (; count < 6; count += 1) {
		const result = await saveSchemaLibraryTemplate(host(big), { mode: "create", expectedRevision: revision, id: tid(`big${count}x`), name: `Big ${count}`, json: json("b".repeat(30_000)) });
		if (!result.success) {
			assert.equal(result.error, "limit_reached");
			assert.match((result as { message: string }).message, /131,072 bytes/);
			break;
		}
		revision = result.library.revision;
	}
	assert.equal(count, 4, "four 30 KB templates fit; the fifth would pass 131,072 bytes");
	assert.ok(new TextEncoder().encode(big.rows.get(SCHEMA_LIBRARY_KEY)!.value).byteLength <= SCHEMA_LIBRARY_MAX_RECORD_BYTES);
}
{
	const many = new VersionedKv();
	let revision: string | null = null;
	for (let index = 0; index < SCHEMA_LIBRARY_MAX_TEMPLATES; index += 1) {
		const result = await saveSchemaLibraryTemplate(host(many), { mode: "create", expectedRevision: revision, id: tid(`m${index}x`), name: `Template ${index}`, json: json(`T${index}`) });
		assert.equal(result.success, true);
		if (result.success) revision = result.library.revision;
	}
	const over = await saveSchemaLibraryTemplate(host(many), { mode: "create", expectedRevision: revision, id: tid("m20"), name: "One more", json: json("x") });
	assert.equal(!over.success && over.error, "limit_reached", "the 21st template is refused");
	assert.equal(many.stored().templates.length, 20);
}

// --- deletion of one reviewed template ----------------------------------------------

{
	const stale = await deleteSchemaLibraryTemplate(host(kv), { expectedRevision: created.library.revision, id: tid("a") });
	assert.equal(!stale.success && stale.error, "conflict");
	assert.equal(!stale.success && "message" in stale && stale.message,
		"The library changed after you loaded it. Nothing was deleted. Review the list as it is now before deleting.",
		"a refused deletion names the deletion, not a save or a form");
	const staleSave = await saveSchemaLibraryTemplate(host(kv), { mode: "update", expectedRevision: created.library.revision, id: tid("a"), name: "Stale", json: json("x") });
	assert.match(!staleSave.success && "message" in staleSave ? staleSave.message : "", /Nothing was saved\. Reload it; your form is kept\./, "control: a refused save keeps its wording");
	assert.equal(kv.stored().templates.length, 2);
	// Another write lands between the read and the conditional delete: the read revision matches, the write is refused.
	const race = new VersionedKv();
	const raceRevision = race.seed(SCHEMA_LIBRARY_KEY, kv.stored());
	race.envelope = (result) => { race.envelope = null; race.seed(SCHEMA_LIBRARY_KEY, race.stored()); return result; };
	const raced = await deleteSchemaLibraryTemplate(host(race), { expectedRevision: raceRevision, id: tid("a") });
	assert.equal(!raced.success && raced.error, "conflict", "control: the conditional write, not the read, refused the deletion");
	assert.equal(race.writes, 0, "control: nothing was written");
	assert.equal(!raced.success && "message" in raced && raced.message,
		"The library changed after you loaded it. Nothing was deleted. Review the list as it is now before deleting.",
		"a deletion refused by the conditional write names the deletion too");
	assert.equal(race.stored().templates.length, 2);
	assert.equal((await deleteSchemaLibraryTemplate(host(kv), { expectedRevision: current, id: tid("zz") })).success, false);
	assert.equal((await deleteSchemaLibraryTemplate(host(kv), { id: tid("a") })).success, false, "a revision is required");
	const removed = await deleteSchemaLibraryTemplate(host(kv), { expectedRevision: current, id: tid("a") });
	assert.equal(removed.success, true);
	assert.deepEqual(kv.stored().templates.map((item: { id: string }) => item.id), [tid("b")], "only that template is removed");
	assert.equal(removed.success && removed.template, null);
}

// --- corrupt and unavailable --------------------------------------------------------

const corruptValues: Array<[unknown, string]> = [
	[null, "not-object"],
	["text", "not-object"],
	[{ version: 2, templates: [] }, "unsupported-version"],
	[{ version: 1, templates: [], scope: "global" }, "unexpected-fields"],
	[{ version: 1, templates: {} }, "invalid-templates"],
	[{ version: 1, templates: [{ id: tid("x"), name: "X", json: json("x"), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", enabled: true }] }, "invalid-templates"],
	[{ version: 1, templates: [{ id: "bad", name: "X", json: json("x"), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] }, "invalid-templates"],
	[{ version: 1, templates: [{ id: tid("x"), name: "X", json: json("{{price}}"), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] }, "invalid-templates"],
	[{ version: 1, templates: [{ id: tid("x"), name: "X", json: json("x"), createdAt: "never", updatedAt: "2026-01-01T00:00:00.000Z" }] }, "invalid-templates"],
	[{ version: 1, templates: [1, 2].map((n) => ({ id: tid("x"), name: `X${n}`, json: json("x"), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })) }, "invalid-templates"],
	[{ version: 1, templates: [1, 2].map((n) => ({ id: tid(`x${n}`), name: "Same", json: json("x"), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })) }, "invalid-templates"],
	[{ version: 1, templates: Array.from({ length: 5 }, (_, n) => ({ id: tid(`y${n}`), name: `Y${n}`, json: json("y".repeat(30_000)), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })) }, "too-large"],
];
for (const [value, reason] of corruptValues) {
	assert.equal(parseSchemaLibraryRecord(value).ok, false, reason);
	const broken = new VersionedKv();
	const revision = broken.seed(SCHEMA_LIBRARY_KEY, value);
	const read = await readSchemaLibrary(host(broken));
	assert.equal(read.state, "corrupt", JSON.stringify(value).slice(0, 80));
	assert.equal(read.state === "corrupt" && read.reason, reason);
	assert.equal(read.revision, revision);
	const write = await saveSchemaLibraryTemplate(host(broken), { mode: "create", expectedRevision: revision, id: tid("w"), name: "W", json: json("w") });
	assert.equal(!write.success && write.error, "corrupt");
	const drop = await deleteSchemaLibraryTemplate(host(broken), { expectedRevision: revision, id: tid("x") });
	assert.equal(!drop.success && drop.error, "corrupt");
	assert.equal(broken.writes, 0, "a corrupt library is never overwritten");
}

assert.equal((await readSchemaLibrary(host(null))).state, "unavailable");
assert.equal((await readSchemaLibrary(host({}))).state, "unavailable", "no versioned API");
{
	const failing = new VersionedKv();
	failing.readFails = true;
	assert.equal((await readSchemaLibrary(host(failing))).state, "unavailable");
	assert.equal(((await saveSchemaLibraryTemplate(host(failing), { mode: "create", expectedRevision: null, id: tid("u"), name: "U", json: json("u") })) as { error?: string }).error, "unavailable");
	const malformed = new VersionedKv();
	malformed.seed(SCHEMA_LIBRARY_KEY, { version: 1, templates: [] });
	malformed.envelope = (result) => ({ ...(result as object), revision: 7 });
	assert.equal((await readSchemaLibrary(host(malformed))).state, "unavailable", "an invalid revision envelope is unavailable, not corrupt");
	const readOnly = new VersionedKv();
	const write = await saveSchemaLibraryTemplate(host({ getVersioned: readOnly.getVersioned.bind(readOnly) }), { mode: "create", expectedRevision: null, id: tid("r"), name: "R", json: json("r") });
	assert.equal(!write.success && write.error, "unavailable", "without compare-and-set nothing is written");
}

// --- uncertain outcomes are never retried or rolled back ------------------------------

{
	const flaky = new VersionedKv();
	flaky.afterCommit = () => {
		throw new Error("connection reset after commit");
	};
	const lost = await saveSchemaLibraryTemplate(host(flaky), { mode: "create", expectedRevision: null, id: tid("lost"), name: "Lost", json: json("lost") });
	assert.equal(!lost.success && lost.error, "unconfirmed");
	assert.match((lost as { message: string }).message, /Reload the library/);
	assert.equal(flaky.writes, 1, "one attempt, no retry");
	assert.deepEqual(flaky.stored().templates.map((item: { id: string }) => item.id), [tid("lost")], "the committed write stays; no rollback");
	const reread = await readSchemaLibrary(host(flaky));
	assert.equal(reread.state === "saved" && reread.templates[0].id, tid("lost"), "an authoritative reload finds it by its identifier");

	const odd = new VersionedKv();
	odd.result = () => ({ applied: true });
	const noRevision = await saveSchemaLibraryTemplate(host(odd), { mode: "create", expectedRevision: null, id: tid("odd"), name: "Odd", json: json("odd") });
	assert.equal(!noRevision.success && noRevision.error, "unconfirmed", "an applied write without a revision is not confirmed");
}

// --- routes: Admin-only, declared bodies, strict input --------------------------------

const routes = (seoRuntime as any).routes;
for (const name of ["schema-library", "save-schema-library-template", "delete-schema-library-template", "preview-entry-schema-candidate"]) {
	assert.equal(routes[name].permission, "plugins:manage", name);
	assert.equal(routes[name].public, undefined, `${name} is private`);
}
assert.deepEqual(routes["schema-library"].request, { body: "none" });
assert.deepEqual(routes["save-schema-library-template"].request, { body: "json", maxBytes: SEO_ADMIN_SCHEMA_LIBRARY_WRITE_REQUEST_MAX_BYTES });
const saveInput = routes["save-schema-library-template"].input;
// Each stored backslash is two bytes of JSON text and four on the wire.
const worstTemplate = json("\\".repeat(16_000));
assert.ok(new TextEncoder().encode(worstTemplate).byteLength <= ENTRY_SCHEMA_JSON_MAX_BYTES);
assert.ok(new TextEncoder().encode(JSON.stringify({ mode: "update", expectedRevision: "r".repeat(256), id: tid("w"), name: "n".repeat(240), json: worstTemplate })).byteLength
	< SEO_ADMIN_SCHEMA_LIBRARY_WRITE_REQUEST_MAX_BYTES, "a valid template fits the declared body with its escaping");
assert.equal(saveInput.safeParse({ mode: "create", expectedRevision: null, id: tid("a"), name: "x", json: "{}", scope: "global" }).success, false, "no scope");
assert.equal(saveInput.safeParse({ mode: "create", expectedRevision: null, id: tid("a"), name: "x", json: "{}", enabled: true }).success, false, "no enabled flag");

const libraryKv = new VersionedKv();
const context = {
	kv: {
		get: async () => null,
		set: async () => undefined,
		getVersioned: (key: string) => libraryKv.getVersioned(key),
		compareAndSet: (key: string, revision: string | null, value: unknown) => libraryKv.compareAndSet(key, revision, value),
		compareAndDelete: async () => ({ applied: false }),
	},
	log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
};
const call = (name: string, input?: unknown) => routes[name].handler({ input }, context);
const emptyRoute = await call("schema-library");
assert.equal(emptyRoute.state, "absent");
assert.equal(emptyRoute.conditionalStorage, true);
assert.deepEqual(emptyRoute.limits, SEO_ADMIN_SCHEMA_LIBRARY_LIMITS);
const routeSaved = await call("save-schema-library-template", { mode: "create", expectedRevision: null, id: tid("route"), name: "Route", json: json("Route") });
assert.equal(routeSaved.success, true);
assert.equal(routeSaved.library.state, "saved");
assert.equal(routeSaved.library.revision, (await call("schema-library")).revision);
const routeDeleted = await call("delete-schema-library-template", { expectedRevision: routeSaved.library.revision, id: tid("route") });
assert.equal(routeDeleted.success, true);
assert.deepEqual(routeDeleted.library.templates, []);

console.log("SEO schema library self-check passed.");
