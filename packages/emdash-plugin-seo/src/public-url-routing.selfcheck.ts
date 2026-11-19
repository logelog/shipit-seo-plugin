import assert from "node:assert/strict";
import { publicUrlForContent, resolveContentCollectionSource } from "./entry-analysis-runtime.ts";
import { checkSeoPublicUrlOptions, configuredSeoPublicUrl, scopeSeoPublicUrlsContext } from "./public-url-routing.ts";
import { createSeoEngine } from "./sandbox-entry.ts";

const options = checkSeoPublicUrlOptions({ routes: [
	{ collection: "pages", locale: "nl", path: "/{slug}" },
	{ collection: "pages", locale: "nl", slug: "home", path: "/" },
	{ collection: "pages", locale: "en", slug: "about", path: "/en/about-us" },
	{ collection: "pages", locale: "de", slug: "about", path: "/de/uber-uns" },
	{ collection: "posts", locale: "de", path: "/de/blog/{slug}" },
	{ collection: "services", locale: "nl", slugField: "route_key", slug: "visibility", path: "/diensten/zichtbaarheid" },
] });
assert.ok(options);
assert.equal(checkSeoPublicUrlOptions(undefined), undefined);
for (const value of [
	{ routes: [] },
	{ routes: [{ collection: "pages", locale: "nl", path: "//other.example/{slug}" }] },
	{ routes: [{ collection: "pages", locale: "nl", path: "/../{slug}" }] },
	{ routes: [{ collection: "pages", locale: "nl", path: "/%2e%2e/{slug}" }] },
	{ routes: [{ collection: "pages", locale: "nl", path: "/{id}" }] },
	{ routes: [{ collection: "pages", locale: "nl", path: "/{slug}?tracking=1" }] },
	{ routes: [{ collection: "pages", locale: "nl", slug: "home", path: "/{slug}" }] },
	{ routes: [{ collection: "pages", locale: "nl", path: "/{slug}" }, { collection: "pages", locale: "nl", path: "/duplicate/{slug}" }] },
	{ routes: [{ collection: "pages", locale: "nl", path: "/{slug}" }, { collection: "pages", locale: "nl", slugField: "other", slug: "home", path: "/" }] },
]) assert.throws(() => checkSeoPublicUrlOptions(value));

let hostReads = 0;
const definitions = [
	{ slug: "pages", label: "Pages", routable: false, hasSeo: true },
	{ slug: "posts", label: "Posts", routable: true, hasSeo: true, urlPattern: "/articles/{slug}" },
	{ slug: "private", label: "Private", routable: false, hidden: true },
];
const ctx: any = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com", locale: "nl" },
	schema: { listCollections: async () => definitions },
	content: { getPublicUrl: async () => { hostReads += 1; return "https://example.com/host-entry"; } },
	log: { warn() {} },
};
const scoped: any = scopeSeoPublicUrlsContext(ctx, options, "https://example.com");
const other: any = scopeSeoPublicUrlsContext(ctx, options, "https://other.example");
assert.deepEqual(Object.keys(scoped), Object.keys(ctx));
assert.deepEqual({ ...scoped }, { ...ctx }, "downstream context copies preserve all original APIs");
assert.equal(Object.getPrototypeOf(scoped), Object.getPrototypeOf(ctx));
const item = (slug: string, locale = "nl", data: Record<string, unknown> = {}) => ({ id: "saved-1", slug, locale, status: "published", data });
assert.equal(await publicUrlForContent(scoped, "pages", item("home")), "https://example.com/");
assert.equal(await publicUrlForContent(scoped, "pages", item("about", "en")), "https://example.com/en/about-us");
assert.equal(await publicUrlForContent(scoped, "pages", item("about", "de")), "https://example.com/de/uber-uns");
assert.equal(await publicUrlForContent(scoped, "posts", item("guide", "de")), "https://example.com/de/blog/guide");
assert.equal(await publicUrlForContent(scoped, "services", item("saved-slug", "nl", { route_key: "visibility" })), "https://example.com/diensten/zichtbaarheid");
assert.equal(hostReads, 0, "configured saved routes require no extra entry lookup");
assert.equal(await publicUrlForContent(scoped, "pages", item("about", "fr")), "", "unconfigured locales fail closed for a site-owned collection");
assert.equal(await publicUrlForContent(scoped, "pages", item("..")), "", "a slug cannot escape its route");
assert.equal(await publicUrlForContent(scopeSeoPublicUrlsContext(ctx, options, "https://example.com/path") as any, "pages", item("home")), "");
assert.equal(configuredSeoPublicUrl(ctx, "pages", item("home")), undefined, "original host context is unchanged");
assert.deepEqual(await Promise.all([
	publicUrlForContent(scoped, "pages", item("home")),
	publicUrlForContent(other, "pages", item("home")),
	publicUrlForContent(ctx, "pages", item("home")),
]), ["https://example.com/", "https://other.example/", "https://example.com/host-entry"]);
assert.equal(await publicUrlForContent(scoped, "posts", { ...item("draft", "de"), status: "draft" }), "/articles/draft", "non-published URL behavior remains host-pattern based");
assert.deepEqual((await resolveContentCollectionSource(scoped)).definitions.map((entry) => entry.collection), ["pages", "posts"]);
assert.deepEqual((await resolveContentCollectionSource(ctx)).definitions.map((entry) => entry.collection), ["posts"], "route declarations cannot leak into another engine's collection cache");
assert.equal(await publicUrlForContent(scopeSeoPublicUrlsContext(ctx, options, null) as any, "pages", item("home")), "");
assert.equal(await publicUrlForContent(scopeSeoPublicUrlsContext({ ...ctx, content: undefined }, options, "https://example.com") as any, "pages", item("home")), "", "route declarations do not supply missing content-read access");

const installation = { mode: "astro", siteUrl: "https://example.com", siteOrigin: "https://example.com", siteIssue: null, keyRoute: "existing" } as const;
const configuredEngine = createSeoEngine(installation, { publicUrls: options });
const defaultEngine = createSeoEngine(installation);
const differentEngine = createSeoEngine(installation, { publicUrls: checkSeoPublicUrlOptions({ routes: [{ collection: "posts", locale: "de", path: "/de/articles/{slug}" }] }) });
const collections = async (engine: ReturnType<typeof createSeoEngine>) => {
	const result = await (engine.routes!["admin-content-options"] as any).handler({ input: {} }, ctx);
	return result.collections.map((entry: { collection: string }) => entry.collection);
};
assert.deepEqual(await Promise.all([collections(configuredEngine), collections(defaultEngine), collections(differentEngine)]), [["pages", "posts"], ["posts"], ["posts"]], "actual engine invocations keep bindings isolated on a reused host context");
console.log("Native public URL routing self-check passed.");
