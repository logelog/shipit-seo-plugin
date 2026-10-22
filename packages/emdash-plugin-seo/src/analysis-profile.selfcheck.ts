import assert from "node:assert/strict";
import seoRuntime from "./sandbox-entry.ts";
import { SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION, SEO_ADMIN_CONTRACT_VERSION } from "./admin-contract.ts";

const ref = "posts:one";
const records = new Map<string, unknown>();
const reads: string[] = [];
const writes: string[] = [];
const reject = () => { throw new Error("Unexpected enumeration or write"); };
const context: any = {
	schema: { listCollections: async () => [{
		slug: "posts", label: "Posts", hasSeo: true,
		urlPattern: "/blog/{slug}", routable: true, hidden: false,
	}] },
	storage: new Proxy({}, {
		get: (_target, name) => {
			assert.equal(name, "analysisProfiles", "profile routes never access score or history storage");
			return {
				get: async (id: string) => {
					assert.equal(id, ref);
					reads.push(`profile:${id}`);
					return records.get(id) ?? null;
				},
				put: async (id: string, value: unknown) => {
					assert.equal(id, ref);
					writes.push(id);
					records.set(id, structuredClone(value));
				},
				delete: reject,
				query: reject,
			};
		},
	}),
	kv: { get: reject, set: reject, list: reject, delete: reject },
	content: {
		get: async (collection: string, id: string) => {
			assert.equal(collection, "posts");
			reads.push(`content:${collection}:${id}`);
			return id === "one" ? { id, data: { title: "Saved post" } } : null;
		},
		list: reject,
		update: reject,
	},
	log: { warn() {} },
};
const route = (name: string, input: unknown, ctx = context) =>
	(seoRuntime as any).routes[name].handler({ input }, ctx);

const empty = await route("analysis-profile", { ref });
assert.equal(empty.contractVersion, SEO_ADMIN_CONTRACT_VERSION);
assert.equal(typeof empty.engineVersion, "string");
assert.equal(empty.success, true);
assert.equal(empty.ref, ref);
assert.equal(empty.profile, null);
assert.deepEqual(reads, ["content:posts:one", "profile:posts:one"]);
assert.equal(writes.length, 0);

for (const legacy of [
	{ storageVersion: 1, keyword: "legacy keyword" },
	{ storageVersion: 2, keyword: "legacy keyword", keywords: ["legacy keyword"] },
	{ storageVersion: 3, keyword: "", keywords: [], pillar: true },
]) {
	const stored = { ...legacy, ref, updatedAt: "2026-09-09T10:00:00.000Z" };
	records.set(ref, stored);
	reads.length = 0;
	const result = await route("analysis-profile", { ref });
	assert.equal(result.success, true);
	assert.equal(result.profile.storageVersion, SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION);
	assert.deepEqual(result.profile.keywords, legacy.storageVersion === 3 ? [] : ["legacy keyword"]);
	assert.equal(result.profile.pillar, legacy.storageVersion === 3);
	assert.deepEqual(reads, ["content:posts:one", "profile:posts:one"]);
	assert.equal(writes.length, 0, "normalizing a legacy profile for reading never migrates storage");
	assert.deepEqual(records.get(ref), stored);
}

records.clear();
for (const input of [
	{ keywords: ["  Main   keyword ", "MAIN KEYWORD"], pillar: true },
	{ keywords: null, pillar: false },
	{ keywords: [] },
	{ keywords: null, pillar: true },
]) {
	reads.length = 0;
	const before: number = writes.length;
	const result = await route("save-focus-keyword", { ref, ...input, profileOnly: true });
	assert.equal(result.success, true, "stock storage without compareAndSet acknowledges a profile save");
	assert.equal(result.ref, ref);
	assert.equal(result.item, null);
	assert.deepEqual(result.profile, records.get(ref));
	assert.deepEqual(reads, ["content:posts:one", "profile:posts:one"]);
	assert.equal(writes.length - before, 1);
	assert.deepEqual(result.profile.keywords, writes.length <= 2 ? ["Main keyword"] : []);
	assert.equal(result.profile.pillar, input.pillar ?? false);
}

records.clear();
const pillarOnly = await route("save-focus-keyword", { ref, keywords: null, pillar: true, profileOnly: true });
assert.equal(pillarOnly.profile.keywords, null, "pillar-only save does not adopt a content keyword");

const beforeFailures = writes.length;
for (const [input, expected] of [
	[{}, "invalid_ref"],
	[{ ref: "posts:missing" }, "not_found"],
	[{ ref: "unknown:one" }, "unsupported_collection"],
] as const) {
	assert.equal((await route("analysis-profile", input)).error, expected);
}
assert.equal((await route("analysis-profile", { ref }, { ...context, content: undefined })).error, "content_unavailable");
assert.equal((await route("analysis-profile", { ref }, {
	...context,
	content: { get: async () => ({ id: "other", data: {} }), list: reject },
})).error, "not_found");
assert.equal((await route("save-focus-keyword", { ref, keywords: [1], profileOnly: true })).error, "invalid_keyword");
assert.equal(writes.length, beforeFailures);

for (const invalid of [
	"unreadable",
	[],
	{ storageVersion: 99, ref, keyword: "future keyword", updatedAt: "2026-10-17T10:00:00.000Z" },
	{ storageVersion: 4, ref: "posts:other", keyword: "other keyword", keywords: ["other keyword"], pillar: true, updatedAt: "2026-10-17T10:00:00.000Z" },
	{ storageVersion: 4, ref, keyword: "wrong primary", keywords: ["saved keyword"], pillar: false, updatedAt: "2026-10-17T10:00:00.000Z" },
]) {
	records.set(ref, structuredClone(invalid));
	reads.length = 0;
	assert.equal((await route("analysis-profile", { ref })).error, "storage_unavailable");
	assert.deepEqual(reads, ["content:posts:one", "profile:posts:one"]);
	for (const keywords of [null, ["replacement"]]) {
		reads.length = 0;
		assert.equal((await route("save-focus-keyword", { ref, keywords, pillar: false, profileOnly: true })).error, "storage_unavailable");
		assert.deepEqual(reads, ["content:posts:one", "profile:posts:one"]);
	}
	assert.equal(writes.length, beforeFailures, "unreadable profiles never reach writes, scoring or history");
	assert.deepEqual(records.get(ref), invalid);
}
const failedReadContext = { ...context, storage: { analysisProfiles: {
	get: async () => { throw new Error("storage read failed"); },
	put: reject, delete: reject, query: reject,
} } };
for (const ctx of [{ ...context, storage: {} }, failedReadContext]) {
	assert.equal((await route("analysis-profile", { ref }, ctx)).error, "storage_unavailable");
	assert.equal((await route("save-focus-keyword", { ref, keywords: ["replacement"], profileOnly: true }, ctx)).error, "storage_unavailable");
}
assert.equal((await route("save-focus-keyword", { ref, keywords: ["replacement"], profileOnly: true }, {
	...context,
	content: { get: async () => ({ id: "other", data: {} }), list: reject },
})).error, "not_found", "save refuses a content row whose identity does not match the requested ref");
assert.equal(writes.length, beforeFailures);

console.log("Analysis profile route self-check passed.");
