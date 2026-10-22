import assert from "node:assert/strict";
import seoRuntime from "./sandbox-entry.ts";
import { GLOBAL_SETTINGS_KEY } from "./settings-runtime.ts";
import { defaultSettingsValues } from "./settings-state.ts";

const values = new Map<string, { value: unknown; revision: string }>();
let version = 0;
let contentReads = 0;
let writes = 0;
const ctx: any = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { name: "Example", url: "https://example.com", locale: "en" },
	kv: {
		get: async (key: string) => structuredClone(values.get(key)?.value ?? null),
		getVersioned: async (key: string) => structuredClone(values.get(key) ?? null),
		compareAndSet: async (key: string, expected: string | null, value: unknown) => {
			if ((values.get(key)?.revision ?? null) !== expected) return { applied: false };
			const revision = `revision-${++version}`;
			values.set(key, { value: structuredClone(value), revision }); writes += 1;
			return { applied: true, revision };
		},
	},
	schema: { listCollections: async () => [{ slug: "posts", label: "Posts", titleField: "title", fields: [{ slug: "content", type: "portableText" }], hasSeo: true, routable: true, urlPattern: "/posts/{slug}" }] },
	content: { get: async () => { contentReads += 1; throw new Error("Analysis read content before admission."); }, list: async () => { contentReads += 1; throw new Error("Analysis enumerated content before admission."); } },
	storage: new Proxy({}, { get() { throw new Error("Analysis touched score/history storage before admission."); } }),
	log: { warn() {}, info() {}, error() {} },
};
const route = (name: string, input: unknown) => (seoRuntime as any).routes[name].handler({ input }, ctx);
const ref = "posts:one";
const exercise = async (expected: string, manualExpected = "profile_required") => {
	assert.equal((await route("analyze-content", { collection: "posts", id: "one" })).error, expected);
	assert.equal((await route("analyze-saved-content", { ref, locale: "en" })).error, manualExpected);
	assert.equal((await route("entry-analysis-identity", { ref })).error, manualExpected);
	assert.equal((await route("audit-content", { refs: [ref] })).failures[0].error, expected);
	assert.equal((await route("refresh-scores", { collection: "posts" })).error, expected);
	await (seoRuntime as any).hooks["content:afterRestore"].handler({ collection: "posts", content: { id: "one", data: { title: "Saved" } } }, ctx);
	assert.equal(contentReads, 0);
};
await exercise("activation_required");
const stored = (enabled: boolean, acknowledged: boolean) => ({
	version: 1, updatedAt: "2026-10-15T00:00:00.000Z", ...defaultSettingsValues({ siteName: ctx.site.name, siteUrl: ctx.site.url }),
	contentScoringEnabled: enabled, ...(acknowledged ? { contentScoringResourceNoticeVersion: 1 } : {}),
});
values.set(GLOBAL_SETTINGS_KEY, { value: stored(true, false), revision: "implicit" });
await exercise("activation_required");
values.set(GLOBAL_SETTINGS_KEY, { value: stored(true, true), revision: "active" });
await exercise("profile_required");
assert.equal(writes, 0, "refused routes and hooks do no score or configuration writes");
assert.equal((await route("admin-analysis-profile", { collection: "posts" })).selection.state, "unconfigured");
const selected = await route("save-analysis-profile", { collection: "posts", profile: "article", expectedRevision: null });
assert.equal(selected.success, true);
assert.equal(selected.selection.profile, "article");
assert.equal(contentReads, 0, "selecting purpose schedules no entry analysis");
const stale = await route("save-analysis-profile", { collection: "posts", profile: "general", expectedRevision: null });
assert.equal(stale.success, false);
assert.equal(stale.conflict, true);
assert.equal(writes, 1);
values.set(GLOBAL_SETTINGS_KEY, { value: stored(false, true), revision: "paused" });
values.delete("configuration:analysis-profile:v1:posts");
await exercise("scoring_disabled");
assert.equal(writes, 1, "pausing preserves the saved assessment purpose and results");
for (const name of ["analyze-saved-content", "entry-analysis-identity", "audit-content"])
	assert.equal((seoRuntime as any).routes[name].permission, "plugins:manage", `${name} retains the administrator boundary`);
assert.equal((seoRuntime as any).routes["analyze-saved-content"].input.safeParse({ ref, locale: "en", purpose: "manual-entry" }).success, false,
	"clients cannot select an internal admission purpose");
assert.equal((await route("audit-content", { refs: [ref, "posts:two"] })).failures[0].error, "scoring_disabled", "multi-entry audit keeps the automatic gate");
console.log("Saved-content route admission: automatic gates, independent manual profile prerequisites, explicit profile CAS and administrator boundaries passed.");
