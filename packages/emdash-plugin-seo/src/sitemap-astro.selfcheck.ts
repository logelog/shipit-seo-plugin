import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { shipitSeo } from "./astro.ts";
import { createSitemapMiddleware } from "./sitemap-middleware.ts";

const workspace = mkdtempSync(join(tmpdir(), "shipit-sitemap-astro-"));

function site(version: string) {
	const root = join(workspace, `site-${version}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(join(root, "node_modules", "emdash"), { recursive: true });
	writeFileSync(join(root, "node_modules", "emdash", "package.json"), JSON.stringify({ name: "emdash", version, main: "index.js" }));
	writeFileSync(join(root, "node_modules", "emdash", "index.js"), "");
	mkdirSync(join(root, "src", "pages"), { recursive: true });
	for (const name of ["with-sitemap", "without-sitemap"]) mkdirSync(join(root, name), { recursive: true });
	writeFileSync(join(root, "with-sitemap", "sitemap.xml"), "<urlset/>");
	writeFileSync(join(root, "without-sitemap", "sitemap.xml.gz"), "");
	const url = (path: string) => pathToFileURL(join(root, path) + "/");
	return { root: url(""), srcDir: url("src"), withSitemap: url("with-sitemap"), withoutSitemap: url("without-sitemap") };
}

function install(version: string) {
	const paths = site(version);
	let plugins: { options?: { installation?: { sitemap?: { owner: string; detail: string | null } } } }[] = [];
	const middleware: unknown[] = [];
	const vitePlugins: { resolveId: (id: string) => string | undefined; load: (id: string) => string | undefined }[] = [];
	const fakeEmdash = (config: { plugins?: unknown[] }) => {
		plugins = (config.plugins ?? []) as typeof plugins;
		return { name: "emdash", hooks: { "astro:config:setup": async () => undefined } } as never;
	};
	const integration = shipitSeo(fakeEmdash, {});
	const logger = { warn: () => undefined, info: () => undefined };
	const config = (publicDir: URL) => ({
		root: paths.root, srcDir: paths.srcDir, publicDir, base: "/", trailingSlash: "ignore",
		integrations: [{ name: "emdash" }], site: undefined,
	});
	const hooks = integration.hooks as Record<string, (params: unknown) => Promise<unknown>>;
	return {
		owner: () => plugins[0]?.options?.installation?.sitemap?.owner,
		// The owner the middleware receives, generated when Vite loads it.
		ownerModule: () => {
			const plugin = vitePlugins[0];
			const id = plugin?.resolveId("virtual:shipit-seo/sitemap-owner");
			return id ? plugin.load(id) : null;
		},
		middleware,
		setup: (publicDir: URL) => hooks["astro:config:setup"]({
			config: config(publicDir), logger, injectRoute: () => undefined,
			addMiddleware: (entry: unknown) => middleware.push(entry),
			updateConfig: (update: { vite?: { plugins?: typeof vitePlugins } }) => vitePlugins.push(...(update.vite?.plugins ?? [])),
		}),
		done: (publicDir: URL) => hooks["astro:config:done"]({ config: config(publicDir), logger }),
		routes: (routes: unknown[]) => hooks["astro:routes:resolved"]({ routes, logger }),
		paths,
	};
}

const coreIndex = { pattern: "/sitemap.xml", patternRegex: /^\/sitemap\.xml\/?$/, entrypoint: "node_modules/emdash/dist/astro/routes/sitemap.xml.mjs" };
const coreChild = { pattern: "/sitemap-[collection].xml", patternRegex: /^\/sitemap-([^/]+?)\.xml\/?$/, entrypoint: "node_modules/emdash/dist/astro/routes/sitemap-_collection_.xml.mjs" };
const generic = { pattern: "/[name].xml", patternRegex: /^\/([^/]+?)\.xml\/?$/, entrypoint: "src/feeds/[name].xml.ts" };
const catchAll = { pattern: "/[...slug]", patternRegex: /^(?:\/(.*?))?\/?$/, entrypoint: "src/pages/[...slug].astro" };

try {
	// A later integration moves the public directory away from a static sitemap.
	const freed = install("1.1.0");
	await freed.setup(freed.paths.withSitemap);
	assert.equal(freed.owner(), "static-file");
	const sitemapEntries = freed.middleware.filter((entry) => String((entry as { entrypoint?: URL }).entrypoint).includes("/sitemap-middleware-entry."));
	assert.equal(sitemapEntries.length, 1, "the middleware is added on a verified host whatever the setup owner");
	assert.equal(freed.ownerModule(), 'export default "static-file";');
	await freed.done(freed.paths.withoutSitemap);
	assert.equal(freed.owner(), "shipit", "the final configuration decides; a compressed file owns no address");
	assert.equal(freed.ownerModule(), 'export default "shipit";', "the middleware receives the final owner");
	await freed.routes([coreIndex, coreChild, catchAll]);
	assert.equal(freed.owner(), "shipit", "a rest route never takes a sitemap address");
	await freed.routes([coreIndex, generic, coreChild, catchAll]);
	assert.equal(freed.owner(), "competing-route", "a generic route that wins child addresses keeps them");
	assert.equal(freed.ownerModule(), 'export default "competing-route";');

	// The opposite direction: setup finds no owner, the final config adds a static file.
	const claimed = install("1.1.0");
	await claimed.setup(claimed.paths.withoutSitemap);
	assert.equal(claimed.owner(), "shipit");
	await claimed.done(claimed.paths.withSitemap);
	assert.equal(claimed.owner(), "static-file");
	assert.equal(claimed.ownerModule(), 'export default "static-file";');
	await claimed.routes([coreIndex, coreChild]);
	assert.equal(claimed.owner(), "static-file", "route resolution never overrides a static owner with Shipit");

	for (const version of ["1.2.0", "1.3.0"]) {
		const released = install(version);
		await released.setup(released.paths.withoutSitemap);
		await released.done(released.paths.withoutSitemap);
		assert.equal(released.owner(), "shipit");
		assert.equal(released.ownerModule(), 'export default "shipit";');
		assert.equal(released.middleware.filter((entry) => String((entry as { entrypoint?: URL }).entrypoint).includes("/sitemap-middleware-entry.")).length, 1);
		const numberedChild = { pattern: "/sitemap-[collection]-[page].xml", patternRegex: /^\/sitemap-([^/]+?)-([^/]+?)\.xml\/?$/, entrypoint: "node_modules/emdash/dist/astro/routes/sitemap-_collection_-_page_.xml.mjs" };
		await released.routes([coreIndex, numberedChild, coreChild, catchAll]);
		assert.equal(released.owner(), "shipit");
		await released.routes([coreIndex, { ...numberedChild, entrypoint: "src/integration/sitemap.ts" }, coreChild, catchAll]);
		assert.equal(released.owner(), "competing-route", "a competing numbered child route retains its address");
	}

	const unverified = install("1.0.1");
	await unverified.setup(unverified.paths.withoutSitemap);
	await unverified.done(unverified.paths.withoutSitemap);
	assert.equal(unverified.owner(), "unsupported-host");
	assert.equal(unverified.middleware.length, 0, "no middleware on an unverified EmDash version");
	assert.equal(unverified.ownerModule(), null);
} finally {
	rmSync(workspace, { recursive: true, force: true });
}

// Middleware: exact addresses, in-process dispatch and truthful fallbacks.
type Dispatch = (pluginId: string, method: string, path: string, request: Request) => Promise<unknown>;
async function request(path: string, dispatch: Dispatch | null, method = "GET", owner = "shipit") {
	const onRequest = createSitemapMiddleware(owner);
	const url = new URL(path, "https://example.com");
	let nextCalled = false;
	const calls: string[] = [];
	const response = await (onRequest as (context: unknown, next: () => Promise<Response>) => Promise<Response>)({
		url,
		request: new Request(url, { method }),
		locals: dispatch ? {
			emdash: {
				handlePublicPluginApiRoute: async (pluginId: string, routeMethod: string, routePath: string, internal: Request) => {
					calls.push(`${pluginId} ${routeMethod} ${routePath} ${new URL(internal.url).search}`);
					assert.equal(internal.headers.get("cookie"), null);
					return dispatch(pluginId, routeMethod, routePath, internal);
				},
			},
		} : {},
	}, async () => {
		nextCalled = true;
		return new Response("core", { status: 200 });
	});
	return { response, nextCalled, calls };
}

const xml = { success: true, data: { pass: false, status: 200, contentType: "application/xml; charset=utf-8", body: "<urlset/>", cacheControl: "public, max-age=300" } };
const served = await request("/sitemap-posts.xml?after=01A", async () => xml);
assert.equal(served.response.status, 200);
assert.equal(await served.response.text(), "<urlset/>");
assert.equal(served.response.headers.get("x-content-type-options"), "nosniff");
assert.deepEqual(served.calls, ["shipit-seo GET sitemap ?collection=posts&after=01A"]);
const head = await request("/sitemap.xml", async () => xml, "HEAD");
assert.equal(await head.response.text(), "");
assert.deepEqual(head.calls, ["shipit-seo GET sitemap "]);
assert.deepEqual((await request("/sitemap.xml?ref=1", async () => xml)).calls, ["shipit-seo GET sitemap ?invalid=true"]);
assert.equal((await request("/blog/post", async () => xml)).nextCalled, true);
assert.equal((await request("/sitemap.xml", async () => xml, "POST")).nextCalled, true);
assert.equal((await request("/sitemap.xml", async () => ({ success: true, data: { pass: true } }))).nextCalled, true);
const noDispatcher = await request("/sitemap-bad-name.xml", null);
assert.equal(noDispatcher.response.status, 404, "an owned invalid address is a 404 even without EmDash's dispatcher");
assert.equal(noDispatcher.nextCalled, false);
assert.equal((await request("/sitemap.xml", null)).response.status, 503);
assert.equal((await request("/blog/post", null)).nextCalled, true);
const external = await request("/sitemap-bad-name.xml", async () => xml, "GET", "site-route");
assert.equal(external.nextCalled, true, "an externally owned address is never answered here");
assert.deepEqual(external.calls, []);
const deactivated = await request("/sitemap.xml", async () => ({ success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } }));
assert.equal(deactivated.nextCalled, true, "a deactivated plugin leaves the sitemap to EmDash");
for (const path of ["/sitemap-posts-1.xml", "/sitemap-posts-2.xml"]) {
	const passed = await request(path, async () => ({ success: true, data: { pass: true } }));
	assert.equal(passed.nextCalled, true, "disabled sitemap delivery leaves numbered children to core");
	const absent = await request(path, async () => ({ success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } }));
	assert.equal(absent.nextCalled, true, "a deactivated plugin leaves numbered children to core");
	assert.deepEqual(absent.calls, ["shipit-seo GET sitemap ?invalid=true"]);
}
const failed = await request("/sitemap.xml", async () => ({ success: false, error: { code: "ROUTE_ERROR", message: "boom" } }));
assert.equal(failed.response.status, 503);
assert.equal(failed.response.headers.get("cache-control"), "no-store");
assert.equal((await request("/sitemap.xml", async () => { throw new Error("boom"); })).response.status, 503);
assert.equal((await request("/sitemap.xml", async () => ({ success: true, data: { pass: false, status: 200 } }))).response.status, 503,
	"a malformed route result is not served");

console.log("SEO sitemap Astro installation self-check passed.");
