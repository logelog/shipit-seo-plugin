import assert from "node:assert/strict";

import { SEO_ADMIN_INDEXNOW_STORAGE_VERSION, SEO_ADMIN_SETTINGS_STORAGE_VERSION, SEO_ENGINE_VERSION, defaultIndexNowSettings } from "./admin-contract.ts";
import { parseSeoAdminIndexNowOperationResult, parseSeoAdminIndexNowStatus } from "./admin-ui/contract.ts";
import { INDEXNOW_SETTINGS_STORAGE_KEY } from "./indexnow-runtime.ts";
import { indexNowJobId } from "./indexnow.ts";
import seoRuntime from "./sandbox-entry.ts";
import { defaultSettingsValues } from "./settings-state.ts";

const SITE = "https://example.com";
const API_KEY = "content-type-rule-key-123";
const clone = <T>(value: T): T => structuredClone(value);
const collections = [
	{ slug: "pages", label: "Pages", hasSeo: true, routable: true, hidden: false, urlPattern: "/{slug}" },
	{ slug: "posts", label: "Posts", hasSeo: true, routable: true, hidden: false, urlPattern: "/blog/{slug}" },
	{ slug: "events", label: "Events", hasSeo: false, routable: true, hidden: false, urlPattern: "/events/{year}/{slug}" },
];

function memoryCollection() {
	const values = new Map<string, Record<string, any>>();
	const api: Record<string, any> = {
		get: async (id: string) => clone(values.get(id) ?? null),
		put: async (id: string, value: Record<string, any>) => { values.set(id, clone(value)); },
		compareAndSet: async (id: string, expected: { state: "missing" } | { state: "value"; value: unknown },
			next: { action: "put"; value: Record<string, any> } | { action: "delete" }) => {
			if (expected.state === "missing" ? values.has(id) : JSON.stringify(values.get(id)) !== JSON.stringify(expected.value)) return false;
			if (next.action === "delete") return values.delete(id);
			values.set(id, clone(next.value));
			return true;
		},
		delete: async (id: string) => values.delete(id),
		getMany: async (ids: string[]) => new Map(ids.flatMap((id) => values.has(id) ? [[id, clone(values.get(id))]] : [])),
		deleteMany: async (ids: string[]) => ids.filter((id) => values.delete(id)).length,
		count: async (where?: Record<string, unknown>) => [...values.values()].filter((value) =>
			!where || Object.entries(where).every(([key, expected]) => value[key] === expected)).length,
		query: async (options: { where?: Record<string, unknown>; limit?: number } = {}) => {
			const items = [...values.entries()].filter(([, value]) => !options.where ||
				Object.entries(options.where).every(([key, expected]) => value[key] === expected));
			return { items: items.slice(0, options.limit ?? 50).map(([id, data]) => ({ id, data: clone(data) })), hasMore: false };
		},
	};
	return { values, api };
}

function fixture(options: { rule?: string[]; unreadable?: boolean; autoSubmit?: boolean; scope?: string[] | null } = {}) {
	const kv = new Map<string, unknown>();
	const writeSettings = (rule: string[] | undefined) => kv.set("settings:global:v1", {
		version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-18T00:00:00.000Z",
		...defaultSettingsValues({ siteName: "Example", siteUrl: SITE }), indexingPreferenceConfirmed: true, noindex: false,
		contentScoringEnabled: false, ...(rule === undefined ? {} : { contentTypeNoindex: [...rule] }),
	});
	writeSettings(options.rule);
	const values = { ...defaultIndexNowSettings(), enabled: true, autoSubmit: options.autoSubmit ?? false,
		autoSubmitContentTypes: options.scope === undefined ? ["pages", "posts"] : options.scope, apiKey: API_KEY };
	kv.set(INDEXNOW_SETTINGS_STORAGE_KEY, { version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION, updatedAt: "2026-10-18T00:00:00.000Z", values,
		verification: { siteOrigin: SITE, keyLocation: values.keyLocation, apiKey: API_KEY, checkedAt: new Date().toISOString() } });
	const jobs = memoryCollection();
	const network: string[] = [];
	const scheduled = new Map<string, { name: string; nextRunAt: string }>();
	const ctx: any = {
		plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
		site: { name: "Example", url: SITE, locale: "en" },
		kv: {
			get: async (key: string) => clone(kv.get(key) ?? null),
			getVersioned: async (key: string) => {
				if (options.unreadable && key === "settings:global:v1") throw new Error("Settings cannot be read.");
				return kv.has(key) ? { value: clone(kv.get(key)), revision: "fixture" } : null;
			},
			set: async (key: string, value: unknown) => { kv.set(key, clone(value)); },
			delete: async (key: string) => kv.delete(key),
			list: async () => [],
		},
		storage: { indexnowJobs: jobs.api, indexnowDeliveries: memoryCollection().api, operationLeases: memoryCollection().api },
		content: {
			get: async () => null,
			listCollections: async () => clone(collections),
			getPublicUrl: async (collection: string, id: string) => {
				const pattern = collections.find((item) => item.slug === collection)?.urlPattern ?? "";
				return SITE + pattern.replace("{year}", "2026").replace("{slug}", id);
			},
		},
		schema: { listCollections: async () => clone(collections) },
		http: { fetch: async (url: string) => { network.push(url); return new Response(null, { status: 202 }); } },
		cron: {
			schedule: async (name: string, input: { schedule: string }) => { scheduled.set(name, { name, nextRunAt: input.schedule }); },
			cancel: async (name: string) => { scheduled.delete(name); },
			list: async () => [...scheduled.values()].map((task) => ({ ...task, schedule: task.nextRunAt, lastRunAt: null })),
		},
		url: (path: string) => new URL(path, SITE).href,
		log: { debug() {}, info() {}, warn() {}, error() {} },
	};
	const queued = () => [...jobs.values.values()].map((job) => job.url).sort();
	return { ctx, kv, jobs, network, queued, writeSettings };
}

const routes = (seoRuntime as any).routes;
const hooks = (seoRuntime as any).hooks;
const call = (name: string, ctx: unknown, input: unknown = {}) => routes[name].handler({
	input, request: { url: SITE + "/_emdash/api/plugins/shipit-seo/" + name, method: "POST", headers: {} },
}, ctx);
const submit = async (ctx: unknown, urls: string[]) =>
	parseSeoAdminIndexNowOperationResult(await call("submit-admin-indexnow", ctx, { urls, force: false, deliverNow: false }));
let cases = 0;
async function check(name: string, run: () => Promise<void>) {
	await run();
	cases += 1;
	console.log("  PASS  " + name);
}

await check("the status names ruled public content types with their address patterns", async () => {
	const ruled = fixture({ rule: ["events", "posts"] });
	const status = parseSeoAdminIndexNowStatus(await call("admin-indexnow", ruled.ctx));
	assert.deepEqual(status.contentTypes.map((item) => item.collection), ["pages", "posts"], "the picker still lists every public type");
	assert.deepEqual(status.contentTypeRules, [
		{ collection: "posts", label: "Posts", urlPattern: "/blog/{slug}" },
		{ collection: "events", label: "Events", urlPattern: "/events/{year}/{slug}" },
	]);
	assert.deepEqual(status.values.autoSubmitContentTypes, ["pages", "posts"], "the stored IndexNow choice is unchanged");
	assert.deepEqual(parseSeoAdminIndexNowStatus(await call("admin-indexnow", fixture().ctx)).contentTypeRules, [], "control: no rule");
	assert.deepEqual(parseSeoAdminIndexNowStatus(await call("admin-indexnow", fixture({ rule: ["archived"] }).ctx)).contentTypeRules, [],
		"a kept rule for a removed type names no public type");
	assert.equal(Object.hasOwn(await call("admin-indexnow", fixture({ rule: ["posts"], unreadable: true }).ctx), "contentTypeRules"), false,
		"unreadable settings report no rule state");
});

await check("readiness and start leave out ruled types without changing the saved scope", async () => {
	const onlyRuled = fixture({ rule: ["posts"], autoSubmit: true, scope: ["posts"] });
	const status = await call("admin-indexnow", onlyRuled.ctx);
	assert.equal(status.readiness.title, "Manual delivery is ready");
	assert.match(status.readiness.description, /Every selected content type has a noindex rule in Indexing rules/);
	const control = await call("admin-indexnow", fixture({ autoSubmit: true, scope: ["posts"] }).ctx);
	assert.equal(control.readiness.title, "Automatic delivery is ready", "control: the same scope without a rule");

	const start = fixture({ rule: ["posts"], scope: ["posts"] });
	const before = await call("admin-indexnow", start.ctx);
	const refused = await call("save-admin-indexnow-automation", start.ctx, { expectedUpdatedAt: before.updatedAt, action: "start", contentTypes: ["posts"] });
	assert.equal(refused.success, false);
	assert.match(refused.errors.autoSubmitContentTypes, /Every selected content type has a noindex rule/);
	const saved = await call("save-admin-indexnow-automation", start.ctx, { expectedUpdatedAt: before.updatedAt, action: "scope", contentTypes: ["pages", "posts"] });
	assert.equal(saved.success, true, "a ruled type stays selectable");
	assert.deepEqual(saved.indexNow.values.autoSubmitContentTypes, ["pages", "posts"]);
	const started = await call("save-admin-indexnow-automation", start.ctx, { expectedUpdatedAt: saved.indexNow.updatedAt, action: "start", contentTypes: ["pages", "posts"] });
	assert.equal(started.success, true, "another selected type can start automatic submission");
	assert.deepEqual(started.indexNow.values.autoSubmitContentTypes, ["pages", "posts"], "the ruled choice is kept for when the rule is removed");
});

await check("automatic submission skips a ruled type and resumes once the rule is removed", async () => {
	const site = fixture({ rule: ["posts"], autoSubmit: true });
	await hooks["content:afterPublish"].handler({ collection: "posts", content: { id: "ruled-post", slug: "ruled-post", status: "published", data: {} } }, site.ctx);
	await hooks["content:afterPublish"].handler({ collection: "pages", content: { id: "about", slug: "about", status: "published", data: {} } }, site.ctx);
	assert.deepEqual(site.queued(), [SITE + "/about"]);
	site.writeSettings([]);
	await hooks["content:afterPublish"].handler({ collection: "posts", content: { id: "ruled-post", slug: "ruled-post", status: "published", data: {} } }, site.ctx);
	assert.deepEqual(site.queued(), [SITE + "/about", SITE + "/blog/ruled-post"]);
});

await check("manual submission withholds URLs matching a ruled pattern and queues the rest", async () => {
	const site = fixture({ rule: ["events", "posts"] });
	const result = await submit(site.ctx, ["/blog/ruled-post", SITE + "/events/2026/open-day/", "/about", "/blog/archive/2026", "/events/next/open-day"]);
	assert.equal(result.success, true);
	if (!result.success) return;
	assert.deepEqual(result.contentTypeNoindexUrls, ["/blog/ruled-post", SITE + "/events/2026/open-day/"]);
	assert.equal(result.enqueued, 3);
	assert.deepEqual(site.queued(), [SITE + "/about", SITE + "/blog/archive/2026", SITE + "/events/next/open-day"],
		"other shapes under the same prefix are not attributed to the rule");
	assert.equal(site.jobs.values.has(indexNowJobId(SITE + "/blog/ruled-post")), false);
	assert.deepEqual(site.network, [], "nothing is delivered while delivery waits");
});

await check("a list of only withheld URLs succeeds without queuing or failing", async () => {
	const site = fixture({ rule: ["posts"] });
	const result = await submit(site.ctx, ["/blog/one", "/blog/two"]);
	assert.equal(result.success, true);
	if (!result.success) return;
	assert.deepEqual([result.enqueued, result.skipped, result.rejected, result.contentTypeNoindexUrls], [0, 0, [], ["/blog/one", "/blog/two"]]);
	assert.deepEqual(site.queued(), []);
	const mixed = await submit(site.ctx, ["/blog/three", "https://other.example/page"]);
	assert.equal(mixed.success, true, "a withheld URL beside only invalid lines is not a failed submission");
	if (!mixed.success) return;
	assert.deepEqual([mixed.enqueued, mixed.rejected, mixed.contentTypeNoindexUrls], [0, ["https://other.example/page"], ["/blog/three"]]);
	const invalidOnly = await submit(site.ctx, ["https://other.example/page"]);
	assert.equal(invalidOnly.success, false, "control: invalid lines alone still fail as before");
});

await check("without a readable rule manual submission is unchanged", async () => {
	for (const [label, site] of [["no rule", fixture()], ["empty rule", fixture({ rule: [] })], ["unreadable", fixture({ rule: ["posts"], unreadable: true })]] as const) {
		const result = await submit(site.ctx, ["/blog/ruled-post", "/about"]);
		assert.equal(result.success, true, label);
		if (!result.success) continue;
		assert.equal(Object.hasOwn(result, "contentTypeNoindexUrls"), false, label + ": no withheld field");
		assert.deepEqual(site.queued(), [SITE + "/about", SITE + "/blog/ruled-post"], label);
	}
	const removed = fixture({ rule: ["posts"] });
	assert.deepEqual((await submit(removed.ctx, ["/blog/ruled-post"])).success && removed.queued(), []);
	removed.writeSettings([]);
	const after = await submit(removed.ctx, ["/blog/ruled-post"]);
	assert.equal(after.success && after.enqueued, 1, "removing the rule submits the same URL");
});

console.log(`Content type noindex IndexNow self-check passed (${cases} groups).`);
