import assert from "node:assert/strict";
import {
	deleteSchemaConditional, readSchemaVersioned, schemaConditionalStore,
	validSchemaWriteRevision, writeSchemaConditional, type SchemaConditionalStore,
} from "./schema-write-storage.ts";

let current: { value: unknown; revision: string } | null = null;
let sequence = 0;
let writes = 0;
const store: SchemaConditionalStore = {
	getVersioned: async () => structuredClone(current),
	compareAndSet: async (_id, expected, value) => {
		writes += 1;
		if ((current?.revision ?? null) !== expected) return { applied: false };
		const revision = String(++sequence);
		current = { value: structuredClone(value), revision };
		return { applied: true, revision };
	},
	compareAndDelete: async (_id, expected) => {
		writes += 1;
		if (current?.revision !== expected) return { applied: false };
		current = null; return { applied: true };
	},
};
assert.equal(validSchemaWriteRevision("0"), true);
assert.equal(validSchemaWriteRevision(""), false);
assert.equal(validSchemaWriteRevision("x".repeat(257)), false);
assert.equal(schemaConditionalStore({ getVersioned: store.getVersioned }), null);
assert.equal(await readSchemaVersioned(store, "one"), null);

const created = await writeSchemaConditional(store, "one", null, { name: "One" });
assert.equal(created.applied, true);
if (!created.applied) throw new Error("Creation was refused");
const baseline = await readSchemaVersioned(store, "one");
assert.equal(baseline?.revision, created.revision);
assert.deepEqual(await writeSchemaConditional(store, "one", null, { name: "Retry" }), { applied: false });
const edited = await writeSchemaConditional(store, "one", created.revision, { name: "Newer" });
assert.equal(edited.applied, true);
assert.deepEqual(await writeSchemaConditional(store, "one", created.revision, { name: "Stale" }), { applied: false });
assert.equal(await deleteSchemaConditional(store, "one", created.revision), false);
assert.deepEqual((await readSchemaVersioned(store, "one"))?.value, { name: "Newer" });

const beforeUnknown = writes;
await assert.rejects(() => writeSchemaConditional({
	...store, compareAndSet: async (id, revision, value) => {
		await store.compareAndSet(id, revision, value);
		throw new Error("Lost acknowledgement");
	},
}, "one", (current as { revision: string } | null)?.revision ?? null, { name: "Committed unknown" }), /Lost acknowledgement/);
assert.equal(writes, beforeUnknown + 1);
assert.deepEqual((await readSchemaVersioned(store, "one"))?.value, { name: "Committed unknown" });
for (const malformed of [true, null, { applied: true }, { applied: true, revision: "" }, { applied: true, revision: "reviewed" }]) {
	await assert.rejects(() => writeSchemaConditional({ ...store, compareAndSet: async () => malformed }, "one", "reviewed", {}));
}
for (const malformed of [true, null, {}, { applied: "yes" }])
	await assert.rejects(() => deleteSchemaConditional({ ...store, compareAndDelete: async () => malformed }, "one", "reviewed"));
for (const malformed of [undefined, {}, { value: {}, revision: "" }, { revision: "1" }])
	await assert.rejects(() => readSchemaVersioned({ ...store, getVersioned: async () => malformed }, "one"));
assert.deepEqual(await readSchemaVersioned({ ...store, getVersioned: async () => ({ value: null, revision: "0" }) }, "one"), { value: null, revision: "0" });
console.log("Schema revision storage checks passed");
