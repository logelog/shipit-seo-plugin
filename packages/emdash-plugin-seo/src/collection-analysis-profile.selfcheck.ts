import assert from "node:assert/strict";
import {
	collectionAnalysisProfileKey, readCollectionAnalysisProfile, requireCollectionAnalysisProfile,
	saveCollectionAnalysisProfile, verifyCollectionAnalysisProfileRevision,
	CollectionAnalysisProfileError,
} from "./collection-analysis-profile.ts";
import { prepareContentItemAnalysis } from "./entry-analysis-runtime.ts";

const entries = new Map<string, { value: unknown; revision: string }>();
const reads: string[] = [];
const writes: string[] = [];
let sequence = 0;
const context: any = {
	kv: {
		getVersioned: async (key: string) => { reads.push(key); return structuredClone(entries.get(key) ?? null); },
		compareAndSet: async (key: string, expected: string | null, value: unknown) => {
			if ((entries.get(key)?.revision ?? null) !== expected) return { applied: false };
			const revision = `revision-${++sequence}`;
			entries.set(key, { value: structuredClone(value), revision });
			writes.push(key);
			return { applied: true, revision };
		},
	},
};
assert.deepEqual(await readCollectionAnalysisProfile(context, "posts"), { state: "unconfigured", collection: "posts", revision: null });
await assert.rejects(() => requireCollectionAnalysisProfile(context, "posts"), (error: unknown) => error instanceof CollectionAnalysisProfileError && error.code === "profile_required");
const untouchable = new Proxy({}, { get() { throw new Error("Entry was touched before assessment admission."); } });
await assert.rejects(() => prepareContentItemAnalysis(context, "posts", untouchable, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false),
	(error: unknown) => error instanceof CollectionAnalysisProfileError && error.code === "profile_required");
assert.equal(writes.length, 0);
const article = await saveCollectionAnalysisProfile(context, "posts", { profile: "article", expectedRevision: null });
assert.equal(article.success, true);
if (!article.success) throw new Error("Article profile was not saved.");
assert.equal(await verifyCollectionAnalysisProfileRevision(context, article.value), true);
assert.equal((await readCollectionAnalysisProfile(context, "pages")).state, "unconfigured");
assert.deepEqual(await saveCollectionAnalysisProfile(context, "posts", { profile: "general", expectedRevision: null }), { success: false, error: "conflict" });
const general = await saveCollectionAnalysisProfile(context, "posts", { profile: "general", expectedRevision: article.value.revision });
assert.equal(general.success, true);
assert.equal(await verifyCollectionAnalysisProfileRevision(context, article.value), false, "purpose change invalidates the original admission");
if (!general.success) throw new Error("General profile was not saved.");
const samePurpose = await saveCollectionAnalysisProfile(context, "posts", { profile: "general", expectedRevision: general.value.revision });
assert.equal(samePurpose.success, true);
assert.equal(await verifyCollectionAnalysisProfileRevision(context, general.value), false, "same-value newer revisions still supersede in-flight work");
entries.set(collectionAnalysisProfileKey("pages"), { value: null, revision: "corrupt" });
assert.deepEqual(await readCollectionAnalysisProfile(context, "pages"), { state: "unavailable", collection: "pages", reason: "corrupt" });
assert.deepEqual(await readCollectionAnalysisProfile({ kv: { getVersioned: async () => { throw new Error("Denied"); } } } as any, "posts"), { state: "unavailable", collection: "posts", reason: "unreadable" });
const operationsBeforeInvalid = reads.length + writes.length;
assert.deepEqual(await saveCollectionAnalysisProfile(context, "../posts", { profile: "article", expectedRevision: null }), { success: false, error: "invalid_collection" });
assert.deepEqual(await saveCollectionAnalysisProfile(context, "posts", { profile: "unknown" as any, expectedRevision: null }), { success: false, error: "invalid_profile" });
assert.deepEqual(await saveCollectionAnalysisProfile(context, "posts", { profile: "article", expectedRevision: "" }), { success: false, error: "invalid_revision" });
assert.equal(reads.length + writes.length, operationsBeforeInvalid);
assert.ok(reads.every((key) => key === collectionAnalysisProfileKey("posts") || key === collectionAnalysisProfileKey("pages")), "only the exact named collection is read");
assert.ok(writes.every((key) => key === collectionAnalysisProfileKey("posts")), "selection writes no entry or schema data");
console.log("Collection assessment profile: admission, exact-key CAS, conflicts, revision changes and unavailable storage passed.");
