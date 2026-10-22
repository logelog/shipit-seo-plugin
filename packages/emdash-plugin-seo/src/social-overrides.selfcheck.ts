import assert from "node:assert/strict";

import {
	deleteSocialOverride,
	persistSocialOverride,
	readSocialOverride,
	readSocialOverrideEditing,
	readSocialOverrideSnapshot,
} from "./social-overrides.ts";

function fixture() {
	const records = new Map<string, { value: unknown; revision: string }>();
	const counts = { read: 0, versioned: 0, conditional: 0, put: 0, delete: 0 };
	let sequence = 0;
	let failure: "none" | "before" | "after" | "malformed" = "none";
	let readFailure = false;
	let beforeConditional = async () => {};
	const write = (ref: string, value: unknown) => {
		const revision = `opaque-${++sequence}`;
		records.set(ref, { value: structuredClone(value), revision });
		return revision;
	};
	const store = {
		get: async (ref: string) => { counts.read++; return structuredClone(records.get(ref)?.value ?? null); },
		put: async (ref: string, value: unknown) => { counts.put++; write(ref, value); },
		delete: async (ref: string) => { counts.delete++; records.delete(ref); },
		getVersioned: async (ref: string) => {
			counts.versioned++;
			if (readFailure) throw new Error("unreadable");
			return structuredClone(records.get(ref) ?? null);
		},
		compareAndSet: async (ref: string, revision: string | null, value: unknown) => {
			counts.conditional++;
			await beforeConditional();
			if (failure === "before") throw new Error("not dispatched");
			if ((records.get(ref)?.revision ?? null) !== revision) return { applied: false };
			const next = write(ref, value);
			if (failure === "after") throw new Error("acknowledgement lost");
			return failure === "malformed" ? undefined : { applied: true, revision: next };
		},
		compareAndDelete: async (ref: string, revision: string) => {
			counts.conditional++;
			await beforeConditional();
			if (failure === "before") throw new Error("not dispatched");
			if (records.get(ref)?.revision !== revision) return { applied: false };
			records.delete(ref);
			if (failure === "after") throw new Error("acknowledgement lost");
			return failure === "malformed" ? undefined : { applied: true };
		},
	};
	return {
		records, counts, store, write,
		ctx: { storage: { socialOverrides: store } } as any,
		fail: (value: typeof failure) => { failure = value; },
		failReads: () => { readFailure = true; },
		before: (callback: () => Promise<void>) => { beforeConditional = callback; },
	};
}

const values = (title = "Title", description = "") => ({ title, description });
const ref = "posts:one";
const record = (title = "Title") => ({
	storageVersion: 1, ref, title, description: null, updatedAt: "2026-10-15T12:00:00.000Z",
});
const f = fixture();
const absent = await readSocialOverrideSnapshot(f.ctx, ref);
assert.equal(absent.success && absent.snapshot.revision, null);
assert.equal(absent.success && absent.snapshot.override, null);
const saved = await persistSocialOverride(f.ctx, ref, values("  A social   headline  ", " A dedicated description. "), null);
assert.equal(saved.success && saved.outcome, "saved");
assert.equal(saved.success && saved.snapshot.override?.title, "A social headline");
assert.equal(saved.success && saved.snapshot.override?.description, "A dedicated description.");
assert.equal(f.counts.conditional, 1);
assert.equal(f.counts.put + f.counts.delete, 0);
assert.equal((await readSocialOverride(f.ctx, [ref]))?.title, "A social headline");
assert.ok(saved.success);
const revision = saved.snapshot.revision;
const unchanged = await persistSocialOverride(f.ctx, ref, values(" A social headline ", "A dedicated description."), revision);
assert.equal(unchanged.success && unchanged.outcome, "unchanged");
assert.deepEqual(unchanged.success && unchanged.snapshot, saved.snapshot);
assert.equal(f.counts.conditional, 1, "unchanged values do not refresh revision or timestamp");
const cleared = await persistSocialOverride(f.ctx, ref, values("", ""), revision);
assert.equal(cleared.success && cleared.snapshot.override, null);
assert.equal(cleared.success && cleared.snapshot.revision, null);
assert.equal((await persistSocialOverride(f.ctx, ref, values("", ""), null)).success, true);
assert.equal(f.counts.conditional, 2, "clearing proven absence does not delete");
assert.equal((await persistSocialOverride(f.ctx, ref, values(), revision)).success, false);
assert.equal((await persistSocialOverride(f.ctx, ref, values("x".repeat(301)), null) as any).error, "title_too_long");
assert.equal((await persistSocialOverride(f.ctx, ref, values("", "x".repeat(1001)), null) as any).error, "description_too_long");
const readsBeforeInvalid = f.counts.versioned;
assert.equal((await persistSocialOverride(f.ctx, ref, values(), undefined as any) as any).error, "invalid_values");
assert.equal(f.counts.versioned, readsBeforeInvalid, "unguarded callers cannot establish a fresh baseline");

for (const mode of ["create", "update", "clear"] as const) {
	const race = fixture();
	const expected = mode === "create" ? null : race.write(ref, record());
	let arrivals = 0;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	race.before(async () => { if (++arrivals === 2) release(); await gate; });
	const results = await Promise.all([
		persistSocialOverride(race.ctx, ref, values(mode === "clear" ? "" : "First"), expected),
		persistSocialOverride(race.ctx, ref, values(mode === "clear" ? "" : "Second"), expected),
	]);
	assert.equal(results.filter((result) => result.success).length, 1, `${mode} has one atomic winner`);
	assert.equal(results.filter((result) => !result.success && result.error === "conflict").length, 1);
	assert.equal(race.counts.conditional, 2);
	assert.equal(race.counts.versioned, 2, "CAS refusal does not retry or reread");
}

const aba = fixture();
const oldRevision = aba.write(ref, record());
aba.write(ref, record("Other"));
aba.write(ref, record());
const stale = await persistSocialOverride(aba.ctx, ref, values(), oldRevision);
assert.equal(!stale.success && stale.error, "conflict", "same values after ABA do not authorize a stale command");
assert.equal(aba.counts.conditional, 0);
const beforeCas = fixture();
const observedRevision = beforeCas.write(ref, record());
beforeCas.before(async () => { beforeCas.write(ref, record()); });
const changedBetweenReadAndCas = await persistSocialOverride(beforeCas.ctx, ref, values("Next"), observedRevision);
assert.equal(!changedBetweenReadAndCas.success && changedBetweenReadAndCas.error, "conflict");
assert.equal(beforeCas.counts.conditional, 1, "the exact client revision reaches native CAS");

for (const mode of ["after", "malformed"] as const) {
	const lost = fixture();
	lost.fail(mode);
	const result = await persistSocialOverride(lost.ctx, ref, values("Recovered"), null);
	assert.equal(result.success && result.outcome, "saved");
	assert.equal(result.success && result.snapshot.override?.title, "Recovered");
	assert.equal(lost.counts.versioned, 2);
	assert.equal(lost.counts.conditional, 1);
}
const lostClear = fixture();
const clearRevision = lostClear.write(ref, record());
lostClear.fail("after");
const recoveredClear = await persistSocialOverride(lostClear.ctx, ref, values("", ""), clearRevision);
assert.equal(recoveredClear.success && recoveredClear.snapshot.override, null);
assert.equal(lostClear.counts.versioned, 2);
for (const mode of ["before", "read-failure", "different", "corrupt"] as const) {
	const unknown = fixture();
	unknown.fail(mode === "before" ? "before" : "after");
	unknown.before(async () => {
		if (mode === "read-failure") unknown.failReads();
	});
	if (mode === "different" || mode === "corrupt") {
		const original = unknown.store.compareAndSet;
		unknown.store.compareAndSet = async (...args) => {
			try { return await original(...args); }
			finally { unknown.write(ref, mode === "corrupt" ? { broken: true } : record("Other")); }
		};
	}
	const result = await persistSocialOverride(unknown.ctx, ref, values("Submitted"), null);
	assert.equal(!result.success && result.outcome, "unconfirmed", mode);
	assert.equal(unknown.counts.versioned, 2, "only one readback follows an uncertain write");
	assert.equal(unknown.counts.conditional, 1);
}

const invalid = fixture();
invalid.write(ref, { ...record(), title: { unexpected: true } });
const corrupt = await readSocialOverrideSnapshot(invalid.ctx, ref);
assert.equal(!corrupt.success && corrupt.error, "record_invalid");
assert.equal((await persistSocialOverride(invalid.ctx, ref, values(), invalid.records.get(ref)!.revision) as any).error, "record_invalid");
assert.equal(invalid.counts.conditional, 0);
invalid.write(ref, { ...record(), title: " ".repeat(301) + "Title" });
assert.equal((await readSocialOverrideSnapshot(invalid.ctx, ref) as any).error, "record_invalid");
const unreadable = fixture();
unreadable.failReads();
assert.equal((await readSocialOverrideSnapshot(unreadable.ctx, ref) as any).error, "storage_unavailable");
assert.equal((await persistSocialOverride(unreadable.ctx, ref, values(), null) as any).error, "storage_unavailable");
assert.equal(unreadable.counts.conditional, 0);
const legacyOnly = { storage: { socialOverrides: { get: f.store.get, put: f.store.put, delete: f.store.delete } } } as any;
assert.equal((await persistSocialOverride(legacyOnly, ref, values(), null) as any).error, "storage_unavailable");
assert.equal((await readSocialOverrideSnapshot(legacyOnly, ref) as any).error, "storage_unavailable");

const alias = fixture();
const aliasRef = "posts:legacy-slug";
alias.write(aliasRef, { ...record("Slug fallback"), ref: aliasRef });
assert.equal((await readSocialOverride(alias.ctx, [ref, aliasRef]))?.title, "Slug fallback");
const editing = await readSocialOverrideEditing(alias.ctx, ref, { present: true, value: null });
assert.deepEqual(editing, { state: "ready", snapshot: { ref, revision: null, override: null } });
await persistSocialOverride(alias.ctx, ref, values("Canonical"), null);
assert.equal(alias.records.get(aliasRef)?.value && (alias.records.get(aliasRef)!.value as any).title, "Slug fallback");
assert.equal((await readSocialOverrideEditing(alias.ctx, ref, { present: true, value: null }) as any).reason, "snapshot_changed");
assert.equal((await readSocialOverrideEditing(alias.ctx, ref, { present: false }) as any).reason, "storage_unavailable");
const raw = { ...record(), title: " Title  " };
alias.write(ref, raw);
const normalized = await readSocialOverrideEditing(alias.ctx, ref, { present: true, value: raw });
assert.equal(normalized.state === "ready" && normalized.snapshot.override?.title, "Title");
assert.deepEqual(alias.records.get(ref)?.value, raw, "snapshot projection does not rewrite stored bytes");
await deleteSocialOverride(alias.ctx, aliasRef);
assert.equal(alias.records.has(aliasRef), false);

// Unknown fields may be large or deeply nested; correlation reads only fixed metadata fields.
const deepExtra: { next?: unknown } = {};
let deepCursor = deepExtra;
for (let index = 0; index < 20_000; index++) {
	const next: { next?: unknown } = {};
	deepCursor.next = next;
	deepCursor = next;
}
let extraReads = 0;
const ignoredExtra = { blob: "x".repeat(256 * 1024), deep: deepExtra };
Object.defineProperty(ignoredExtra, "unread", { enumerable: true, get: () => {
	extraReads++; throw new Error("arbitrary extra field was traversed");
} });
const observedLarge = { ...record("A  title"), extra: ignoredExtra };
let currentLarge: unknown = { ...record("A  title"), extra: { blob: "y".repeat(256 * 1024), deep: deepExtra } };
let correlationReads = 0;
const boundedContext = { storage: { socialOverrides: {
	getVersioned: async () => { correlationReads++; return currentLarge === null ? null : { value: currentLarge, revision: "bounded-revision" }; },
	compareAndSet: async () => { throw new Error("correlation must be read-only"); },
	compareAndDelete: async () => { throw new Error("correlation must be read-only"); },
} } } as any;
const boundedEditing = await readSocialOverrideEditing(boundedContext, ref, { present: true, value: observedLarge });
assert.equal(boundedEditing.state, "ready", "unconsumed large/deep extras do not participate in correlation");
assert.equal(extraReads, 0);
assert.equal(correlationReads, 1);
currentLarge = { ...record("A title"), extra: ignoredExtra };
assert.equal((await readSocialOverrideEditing(boundedContext, ref, { present: true, value: observedLarge }) as any).reason,
	"snapshot_changed", "raw interior whitespace consumed by metadata still participates in correlation");
currentLarge = null;
assert.equal((await readSocialOverrideEditing(boundedContext, ref, { present: true, value: { ...record(), title: {} } }) as any).reason,
	"record_invalid", "an invalid observation cannot become proven absence");
assert.equal((await readSocialOverrideEditing(unreadable.ctx, ref, { present: true, value: null }) as any).reason,
	"storage_unavailable", "a failed versioned read cannot become proven absence");
assert.equal(extraReads, 0);

const readWarnings: unknown[] = [];
assert.equal(await readSocialOverride({
	storage: { socialOverrides: {
		get: async () => { throw new Error("read failed"); },
		put: async () => undefined, delete: async () => undefined,
	} }, log: { warn: (...args: unknown[]) => readWarnings.push(args) },
} as any, [ref]), null);
assert.equal(readWarnings.length, 1, "public forgiving metadata reads retain their existing behavior");

console.log("SEO social override storage self-check passed.");
