import assert from "node:assert/strict";
import test from "node:test";

import {
	compareStoredValue,
	supportsConditionalStorage,
} from "./conditional-storage.ts";

const id = "entry:articles/example";
const missing = { state: "missing" } as const;
const expected = <T>(value: T) => ({ state: "value" as const, value });
const put = <T>(value: T) => ({ action: "put" as const, value });
const remove = { action: "delete" } as const;

function memoryStore() {
	const rows = new Map<string, { value: any; revision: string }>();
	const calls: unknown[][] = [];
	let revision = 0;
	let beforeWrite: (() => void) | undefined;

	function write(key: string, value: unknown) {
		const row = { value: structuredClone(value), revision: `revision-${++revision}` };
		rows.set(key, row);
		return row.revision;
	}

	function read(key: string) {
		return structuredClone(rows.get(key) ?? null);
	}

	function interleave() {
		const action = beforeWrite;
		beforeWrite = undefined;
		action?.();
	}

	const store: any = {
		async getVersioned(key: string) {
			assert.equal(this, store);
			calls.push(["getVersioned", key]);
			return read(key);
		},
		async compareAndSet(key: string, expectedRevision: string | null, value: unknown) {
			assert.equal(this, store);
			calls.push(["compareAndSet", key, expectedRevision, value]);
			interleave();
			if ((rows.get(key)?.revision ?? null) !== expectedRevision) {
				return { applied: false };
			}
			return { applied: true, revision: write(key, value) };
		},
		async compareAndDelete(key: string, expectedRevision: string) {
			assert.equal(this, store);
			calls.push(["compareAndDelete", key, expectedRevision]);
			interleave();
			if (!rows.has(key) || rows.get(key)!.revision !== expectedRevision) {
				return { applied: false };
			}
			rows.delete(key);
			return { applied: true };
		},
	};

	for (const method of ["get", "put", "delete", "exists", "query", "updateIf"]) {
		Object.defineProperty(store, method, {
			get() {
				assert.fail(`Unconditional storage method accessed: ${method}`);
			},
		});
	}

	return {
		store,
		calls,
		write,
		read,
		erase: (key: string) => rows.delete(key),
		beforeWrite: (action: () => void) => { beforeWrite = action; },
	};
}

test("native conditional storage requires all three callable native methods", () => {
	const native = memoryStore().store;
	assert.equal(supportsConditionalStorage(native), true);
	for (const value of [undefined, null, false, 1, "storage", {}]) {
		assert.equal(supportsConditionalStorage(value), false);
	}
	for (const method of ["getVersioned", "compareAndSet", "compareAndDelete"]) {
		for (const value of [undefined, null, true, "callable"]) {
			assert.equal(supportsConditionalStorage({ ...native, [method]: value }), false);
		}
	}
});

test("create uses a null revision without reading and conflicts with an existing row", async () => {
	const fixture = memoryStore();
	const value = { sourceVersion: "v1", score: 80 };
	assert.equal(await compareStoredValue(fixture.store, id, missing, put(value)), true);
	assert.deepEqual(fixture.read(id)!.value, value);
	assert.deepEqual(fixture.calls, [["compareAndSet", id, null, value]]);

	assert.equal(await compareStoredValue(fixture.store, id, missing, put({ score: 10 })), false);
	assert.deepEqual(fixture.read(id)!.value, value);
	assert.deepEqual(fixture.calls[1], ["compareAndSet", id, null, { score: 10 }]);
});

test("equal serialized data updates with the latest revision and preserves method binding", async () => {
	const fixture = memoryStore();
	const value = { sourceVersion: "v1", score: 80, details: ["title", "description"] };
	fixture.write(id, value);
	const latestRevision = fixture.write(id, value);
	const next = { sourceVersion: "v2", score: 95 };

	assert.equal(
		await compareStoredValue(fixture.store, id, expected(structuredClone(value)), put(next)),
		true,
	);
	assert.deepEqual(fixture.calls, [
		["getVersioned", id],
		["compareAndSet", id, latestRevision, next],
	]);
	assert.deepEqual(fixture.read(id)!.value, next);
});

test("JSON serialization determines equality, including object key order", async () => {
	const fixture = memoryStore();
	const value = { first: 1, second: 2 };
	fixture.write(id, value);
	assert.equal(
		await compareStoredValue(fixture.store, id, expected({ second: 2, first: 1 }), put("next")),
		false,
	);
	assert.deepEqual(fixture.calls, [["getVersioned", id]]);
	assert.deepEqual(fixture.read(id)!.value, value);

	assert.equal(
		await compareStoredValue(fixture.store, id, expected({ ...value, omitted: undefined }), put("next")),
		true,
	);
	assert.equal(fixture.read(id)!.value, "next");
});

test("value mismatches and absent rows never reach either conditional write", async () => {
	for (const next of [put("next"), remove]) {
		const fixture = memoryStore();
		fixture.write(id, { sourceVersion: "v2" });
		assert.equal(await compareStoredValue(fixture.store, id, expected({ sourceVersion: "v1" }), next), false);
		assert.deepEqual(fixture.calls, [["getVersioned", id]]);
		fixture.erase(id);
		fixture.calls.length = 0;
		assert.equal(await compareStoredValue(fixture.store, id, expected(null), next), false);
		assert.deepEqual(fixture.calls, [["getVersioned", id]]);
	}
});

test("a stored JSON null is a value and cannot satisfy an absent-row create", async () => {
	const fixture = memoryStore();
	assert.equal(await compareStoredValue(fixture.store, id, missing, put(null)), true);
	const revision = fixture.read(id)!.revision;
	assert.equal(await compareStoredValue(fixture.store, id, missing, put("replacement")), false);
	assert.deepEqual(fixture.read(id), { value: null, revision });
	assert.equal(await compareStoredValue(fixture.store, id, expected(null), put("replacement")), true);
	assert.equal(fixture.read(id)!.value, "replacement");
});

test("delete uses the matching versioned revision, including for stored null", async () => {
	for (const value of [{ sourceVersion: "v1" }, null]) {
		const fixture = memoryStore();
		const revision = fixture.write(id, value);
		assert.equal(await compareStoredValue(fixture.store, id, expected(value), remove), true);
		assert.equal(fixture.read(id), null);
		assert.deepEqual(fixture.calls, [["getVersioned", id], ["compareAndDelete", id, revision]]);
	}
});

test("an absent-row delete returns false without reading or writing", async () => {
	const fixture = memoryStore();
	assert.equal(await compareStoredValue(fixture.store, id, missing, remove), false);
	fixture.write(id, "present");
	assert.equal(await compareStoredValue(fixture.store, id, missing, remove), false);
	assert.deepEqual(fixture.calls, []);
	assert.equal(fixture.read(id)!.value, "present");
});

test("a competing create wins before the native absent-row write", async () => {
	const fixture = memoryStore();
	fixture.beforeWrite(() => fixture.write(id, "concurrent"));
	assert.equal(await compareStoredValue(fixture.store, id, missing, put("ours")), false);
	assert.equal(fixture.read(id)!.value, "concurrent");
	assert.deepEqual(fixture.calls, [["compareAndSet", id, null, "ours"]]);
});

test("writes that race a changed or deleted row report conflict without retrying", async () => {
	for (const next of [put("ours"), remove]) {
		for (const concurrent of ["overwrite", "delete"]) {
			const fixture = memoryStore();
			const revision = fixture.write(id, "original");
			fixture.beforeWrite(() => {
				if (concurrent === "overwrite") fixture.write(id, "concurrent");
				else fixture.erase(id);
			});
			assert.equal(await compareStoredValue(fixture.store, id, expected("original"), next), false);
			assert.equal(fixture.read(id)?.value ?? null, concurrent === "overwrite" ? "concurrent" : null);
			assert.deepEqual(fixture.calls, [
				["getVersioned", id],
				next.action === "put" ? ["compareAndSet", id, revision, "ours"] : ["compareAndDelete", id, revision],
			]);
		}
	}
});

test("ABA changes after the read cannot authorize an update or delete", async () => {
	for (const next of [put("ours"), remove]) {
		for (const intermediate of ["overwrite", "delete"]) {
			const fixture = memoryStore();
			const originalRevision = fixture.write(id, "original");
			fixture.beforeWrite(() => {
				if (intermediate === "overwrite") fixture.write(id, "intermediate");
				else fixture.erase(id);
				fixture.write(id, "original");
			});
			assert.equal(await compareStoredValue(fixture.store, id, expected("original"), next), false);
			assert.equal(fixture.read(id)!.value, "original");
			assert.notEqual(fixture.read(id)!.revision, originalRevision);
			assert.equal(fixture.calls.length, 2);
		}
	}
});

test("native read and write errors propagate without being converted to conflicts", async () => {
	for (const method of ["getVersioned", "compareAndSet", "compareAndDelete"]) {
		const fixture = memoryStore();
		fixture.write(id, "original");
		const error = new Error(`${method} failed`);
		fixture.store[method] = async () => { throw error; };
		await assert.rejects(
			compareStoredValue(fixture.store, id, expected("original"), method === "compareAndDelete" ? remove : put("ours")),
			(actual) => actual === error,
		);
		assert.equal(fixture.read(id)!.value, "original");
	}
});

test("unserializable expected data rejects before attempting a write", async () => {
	const fixture = memoryStore();
	fixture.write(id, "original");
	const circular: any = {};
	circular.self = circular;
	for (const value of [circular, 1n]) {
		await assert.rejects(compareStoredValue(fixture.store, id, expected(value), put("ours")), TypeError);
	}
	assert.ok(fixture.calls.every(([method]) => method === "getVersioned"));
	assert.equal(fixture.read(id)!.value, "original");
});

test("malformed native read envelopes reject before attempting a write", async () => {
	const malformed = [
		undefined, false, "value", [], {},
		{ value: "original" },
		{ revision: "revision-1" },
		{ value: "original", revision: null },
		{ value: "original", revision: 1 },
		{ value: "original", revision: "" },
		{ value: "original", revision: "x".repeat(129) },
	];
	for (const response of malformed) {
		const fixture = memoryStore();
		fixture.store.getVersioned = async () => response;
		await assert.rejects(compareStoredValue(fixture.store, id, expected("original"), put("ours")));
		assert.deepEqual(fixture.calls, []);
	}
});

test("native writes require an object with a boolean applied field", async () => {
	const malformed = [undefined, null, true, false, 1, "applied", [], {}, { applied: 1 }, { applied: "false" }];
	for (const next of [put("ours"), remove]) {
		for (const response of malformed) {
			const fixture = memoryStore();
			fixture.write(id, "original");
			fixture.store[next.action === "put" ? "compareAndSet" : "compareAndDelete"] = async () => response;
			await assert.rejects(compareStoredValue(fixture.store, id, expected("original"), next));
		}
	}
});

test("successful native puts require a revision between one and 128 characters", async () => {
	for (const revision of [undefined, null, 1, "", "x".repeat(129)]) {
		const fixture = memoryStore();
		fixture.store.compareAndSet = async () => ({ applied: true, revision });
		await assert.rejects(compareStoredValue(fixture.store, id, missing, put("ours")));
	}
	for (const revision of ["x", "x".repeat(128)]) {
		const fixture = memoryStore();
		fixture.store.getVersioned = async () => ({ value: "original", revision });
		fixture.store.compareAndSet = async (key: string, expectedRevision: string | null) => {
			assert.equal(key, id);
			assert.equal(expectedRevision, revision);
			return { applied: true, revision };
		};
		assert.equal(await compareStoredValue(fixture.store, id, expected("original"), put("ours")), true);
	}
});

test("unsupported and partial native stores reject without accessing unconditional methods", async () => {
	for (const store of [undefined, null, {}, {
		getVersioned: undefined,
		async compareAndSet() { assert.fail("Partial native compareAndSet was called"); },
		async get() { assert.fail("Unconditional get was called"); },
		async put() { assert.fail("Unconditional put was called"); },
		async delete() { assert.fail("Unconditional delete was called"); },
	}]) {
		assert.equal(supportsConditionalStorage(store), false);
		for (const next of [put("ours"), remove]) {
			await assert.rejects(compareStoredValue(store, id, missing, next), TypeError);
		}
	}
});

test("legacy private CAS preserves snapshots and method binding without unconditional access", async () => {
	const calls: unknown[][] = [];
	let applied = true;
	const legacy = {
		async compareAndSet(key: string, comparison: unknown, mutation: unknown) {
			assert.equal(this, legacy);
			calls.push([key, comparison, mutation]);
			return applied;
		},
		async get() { assert.fail("Unconditional get was called"); },
		async put() { assert.fail("Unconditional put was called"); },
		async delete() { assert.fail("Unconditional delete was called"); },
	};
	assert.equal(supportsConditionalStorage(legacy), true);
	for (const comparison of [missing, expected(null), expected({ score: 80 })]) {
		assert.equal(await compareStoredValue(legacy, id, comparison, put({ score: 95 })), true);
		assert.deepEqual(calls.at(-1), [id, comparison, put({ score: 95 })]);
	}
	applied = false;
	assert.equal(await compareStoredValue(legacy, id, expected(null), remove), false);
	assert.deepEqual(calls.at(-1), [id, expected(null), remove]);
	const count = calls.length;
	assert.equal(await compareStoredValue(legacy, id, missing, remove), false);
	assert.equal(calls.length, count);
});

test("legacy private CAS requires a strict boolean outcome", async () => {
	for (const result of [undefined, null, 1, "false", {}, { applied: false }, { applied: true }]) {
		const legacy = { async compareAndSet() { return result; } };
		await assert.rejects(compareStoredValue(legacy, id, missing, put("ours")), TypeError);
	}
});

test("invalid comparison and mutation arguments reject before reading or writing", async () => {
	const fixture = memoryStore();
	for (const value of [undefined, null, {}, { state: "unknown" }, { state: "value" }]) {
		await assert.rejects(compareStoredValue(fixture.store, id, value as any, put("ours")), TypeError);
	}
	for (const value of [undefined, null, {}, { action: "unknown" }, { action: "put" }]) {
		await assert.rejects(compareStoredValue(fixture.store, id, missing, value as any), TypeError);
	}
	assert.deepEqual(fixture.calls, []);
});

test("caller mutation during the read cannot change the expected value or desired write", async () => {
	const fixture = memoryStore();
	fixture.write(id, { sourceVersion: "original" });
	const comparison = expected({ sourceVersion: "original" });
	const mutation = put({ sourceVersion: "ours" });
	const getVersioned = fixture.store.getVersioned;
	fixture.store.getVersioned = async function (this: unknown, key: string) {
		comparison.value.sourceVersion = "changed while reading";
		mutation.value.sourceVersion = "changed while reading";
		return getVersioned.call(this, key);
	};
	assert.equal(await compareStoredValue(fixture.store, id, comparison, mutation), true);
	assert.deepEqual(fixture.read(id)!.value, { sourceVersion: "ours" });
});
