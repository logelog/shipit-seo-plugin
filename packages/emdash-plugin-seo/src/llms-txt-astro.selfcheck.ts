import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { shipitSeo } from "./astro.ts";
import { seoLlmsTxtInstallation, type SeoPluginOptions } from "./index.ts";
import { createLlmsTxtMiddleware } from "./llms-txt-middleware.ts";
import { llmsTxtUtf8Bytes } from "./llms-txt-document.ts";
import plugin, { createSeoEngine } from "./sandbox-entry.ts";

const BOM = String.fromCharCode(0xfeff);
const workspace = mkdtempSync(join(tmpdir(), "shipit-llms-astro-"));
let counter = 0;

function site(version: string) {
	const root = join(workspace, `site-${version}-${counter++}`);
	mkdirSync(join(root, "node_modules", "emdash"), { recursive: true });
	writeFileSync(join(root, "node_modules", "emdash", "package.json"), JSON.stringify({ name: "emdash", version, main: "index.js" }));
	writeFileSync(join(root, "node_modules", "emdash", "index.js"), "");
	mkdirSync(join(root, "src", "pages"), { recursive: true });
	return root;
}

type Llms = { owner: string; detail: string | null; hostVersion: string | null };
type VitePlugin = { name: string; resolveId: (id: string) => string | undefined; load: (id: string) => string | undefined };

function install(root: string, patch: Record<string, unknown> = {}) {
	let plugins: { options?: { installation?: { llmsTxt?: Llms } } }[] = [];
	const fakeEmdash = (config: { plugins?: unknown[] }) => {
		plugins = (config.plugins ?? []) as typeof plugins;
		return { name: "emdash", hooks: { "astro:config:setup": async () => undefined } } as never;
	};
	const integration = shipitSeo(fakeEmdash, {});
	const logs: string[] = [];
	const middleware: string[] = [];
	const vitePlugins: VitePlugin[] = [];
	const logger = { warn: (message: string) => logs.push(message), info: (message: string) => logs.push(message) };
	const url = (path: string) => pathToFileURL(join(root, path) + "/");
	const config = {
		root: url(""), srcDir: url("src"), publicDir: url("public"), base: "/", trailingSlash: "ignore",
		integrations: [{ name: "emdash" }], site: undefined, ...patch,
	};
	const hooks = integration.hooks as Record<string, (params: unknown) => Promise<unknown>>;
	return {
		llms: () => plugins[0]?.options?.installation?.llmsTxt,
		options: () => (plugins[0]?.options ?? {}) as SeoPluginOptions,
		logs,
		middleware,
		ownerModule: () => {
			const owner = vitePlugins.find((item) => item.name === "shipit-seo:llms-txt-owner");
			const id = owner?.resolveId("virtual:shipit-seo/llms-txt-owner");
			return id ? owner!.load(id) : undefined;
		},
		setup: () => hooks["astro:config:setup"]({
			config, logger, injectRoute: () => undefined,
			addMiddleware: (entry: { entrypoint: URL }) => middleware.push(String(entry.entrypoint)),
			updateConfig: (update: { vite?: { plugins?: VitePlugin[] } }) => vitePlugins.push(...(update.vite?.plugins ?? [])),
		}),
		done: () => hooks["astro:config:done"]({ config, logger }),
		routes: (routes: unknown[]) => hooks["astro:routes:resolved"]({ routes, logger }),
	};
}

const catchAll = { pattern: "/[...slug]", patternRegex: /^(?:\/(.*?))?\/?$/, entrypoint: "src/pages/[...slug].astro", type: "page" };
const coreRobots = { pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "node_modules/emdash/dist/astro/routes/robots.txt.mjs", type: "endpoint" };

try {
	// Configuration alone never names Shipit; the resolved routes settle it.
	const fresh = install(site("1.1.0"));
	await fresh.setup();
	assert.equal(fresh.llms()?.owner, "unsettled");
	assert.ok(fresh.middleware.some((entry) => entry.endsWith("/llms-txt-middleware-entry.ts")), "the llms middleware is added");
	assert.equal(fresh.ownerModule(), "export default \"unsettled\";");
	await fresh.done();
	assert.equal(seoLlmsTxtInstallation(fresh.options())?.owner, "unsettled");
	await fresh.routes([coreRobots]);
	assert.deepEqual(fresh.llms(), { owner: "shipit", detail: null, hostVersion: "1.1.0" });
	assert.equal(fresh.ownerModule(), "export default \"shipit\";", "Vite serializes the settled owner");
	await fresh.routes([coreRobots, catchAll]);
	assert.deepEqual(fresh.llms(), { owner: "competing-route", detail: "/[...slug] answers /llms.txt", hostVersion: "1.1.0" });
	assert.ok(fresh.logs.some((line) => line.includes("leaves /llms.txt unchanged")));

	for (const version of ["1.2.0", "1.3.0"]) {
		const released = install(site(version));
		await released.setup();
		await released.done();
		await released.routes([coreRobots]);
		assert.deepEqual(released.llms(), { owner: "shipit", detail: null, hostVersion: version });
		assert.ok(released.middleware.some((entry) => entry.endsWith("/llms-txt-middleware-entry.ts")));
		assert.equal(released.ownerModule(), 'export default "shipit";');
	}

	// A public file added by the final configuration keeps the address.
	const withFile = site("1.1.0");
	mkdirSync(join(withFile, "public"));
	writeFileSync(join(withFile, "public", "llms.txt"), "# Site\n");
	const staticOwner = install(withFile);
	await staticOwner.setup();
	await staticOwner.done();
	await staticOwner.routes([]);
	assert.deepEqual([staticOwner.llms()?.owner, staticOwner.llms()?.detail], ["static-file", "public/llms.txt"]);

	// An unreadable source directory leaves the owner unknown after every hook.
	if (process.getuid?.() !== 0) {
		const lockedRoot = site("1.1.0");
		chmodSync(join(lockedRoot, "src", "pages"), 0o000);
		try {
			const locked = install(lockedRoot);
			await locked.setup();
			await locked.done();
			await locked.routes([]);
			assert.deepEqual([locked.llms()?.owner, locked.llms()?.detail], ["unknown", "src/pages could not be read (EACCES)"]);
		} finally {
			chmodSync(join(lockedRoot, "src", "pages"), 0o700);
		}
	}

	// An unverified EmDash version adds no llms middleware.
	const older = install(site("1.0.1"));
	await older.setup();
	assert.equal(older.middleware.some((entry) => entry.includes("llms-txt")), false);
	assert.equal(older.llms()?.owner, "unsupported-host");

	// The native binding reaches the public route handler per context.
	const route = (engine: typeof plugin) => (engine.routes as Record<string, { handler: (...args: unknown[]) => Promise<unknown> }>)["llms-txt"];
	const noKv = { kv: {}, log: { warn() {} } };
	assert.deepEqual(await route(plugin).handler({ input: {} }, noKv), { pass: true }, "no binding: pass");
	const bound = createSeoEngine(undefined, { llmsTxt: { owner: "shipit", detail: null, hostVersion: "1.1.0" } });
	assert.deepEqual((await route(bound).handler({ input: { refuse: "method" } }, noKv) as { status: number }).status, 405);
	assert.deepEqual((await route(bound).handler({ input: {} }, noKv) as { status: number }).status, 503, "no versioned KV: unavailable");
} finally {
	rmSync(workspace, { recursive: true, force: true });
}

// ---- Middleware -------------------------------------------------------------------

type Dispatch = (pluginId: string, method: string, path: string, request: Request) => Promise<{ success: boolean; data?: unknown; error?: { code?: string } }>;
const calls: { method: string; path: string; url: string }[] = [];
function context(path: string, method = "GET", dispatch?: Dispatch | null) {
	const url = new URL(path, "http://127.0.0.1:4362");
	return {
		url,
		request: new Request(url, { method }),
		locals: dispatch === null ? {} : {
			emdash: {
				handlePublicPluginApiRoute: async (pluginId: string, routeMethod: string, routePath: string, request: Request) => {
					calls.push({ method: routeMethod, path: routePath, url: request.url });
					return dispatch!(pluginId, routeMethod, routePath, request);
				},
			},
		},
	} as never;
}
const NEXT = new Response("next", { status: 299 });
const next = async () => NEXT;
const served = (data: unknown): Dispatch => async () => ({ success: true, data });
const text = `${BOM}# Ünïcødé site\r\n`;
const ok = served({ pass: false, status: 200, contentType: "text/plain; charset=utf-8", cacheControl: "public, max-age=300", body: text });

// Any owner but Shipit hands every request on before the dispatcher is consulted.
for (const owner of ["competing-route", "unknown", "unsettled", "static-file"]) {
	const run = createLlmsTxtMiddleware(owner);
	assert.equal(await run(context("/llms.txt", "GET", null), next), NEXT, owner);
	assert.equal(await run(context("/llms.txt", "POST", ok), next), NEXT, owner);
}
assert.equal(calls.length, 0, "no dispatcher call under another owner");

const shipit = createLlmsTxtMiddleware("shipit");
assert.equal(await shipit(context("/llms.txt/", "GET", ok), next), NEXT, "only the exact path");
assert.equal(await shipit(context("/LLMS.TXT", "GET", ok), next), NEXT);
assert.equal(await shipit(context("/robots.txt", "GET", ok), next), NEXT);
assert.equal(calls.length, 0);

const get = await shipit(context("/llms.txt", "GET", ok), next) as Response;
const getBytes = new Uint8Array(await get.arrayBuffer());
assert.equal(get.status, 200);
assert.deepEqual([...getBytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "the leading BOM is sent as bytes");
assert.equal(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(getBytes), text, "exact UTF-8 body");
assert.equal(get.headers.get("content-length"), String(llmsTxtUtf8Bytes(text)));
assert.equal(getBytes.byteLength, llmsTxtUtf8Bytes(text));
const head = await shipit(context("/llms.txt", "HEAD", ok), next) as Response;
assert.equal(head.status, 200);
assert.equal(head.body, null, "HEAD has no body");
assert.deepEqual([...head.headers.entries()], [...get.headers.entries()], "HEAD carries the same headers");
assert.deepEqual(Object.fromEntries(get.headers), {
	"cache-control": "public, max-age=300",
	"content-length": String(llmsTxtUtf8Bytes(text)),
	"content-type": "text/plain; charset=utf-8",
	"x-content-type-options": "nosniff",
});
assert.deepEqual(calls.map((call) => [call.method, call.path, new URL(call.url).pathname, new URL(call.url).search]), [
	["GET", "llms-txt", "/_emdash/api/plugins/shipit-seo/llms-txt", ""],
	["GET", "llms-txt", "/_emdash/api/plugins/shipit-seo/llms-txt", ""],
]);

// Refusals are forwarded as the only parameter; visitor query values are not.
calls.length = 0;
const refusal = served({ pass: false, status: 405, contentType: "text/plain; charset=utf-8", cacheControl: "no-store", body: "Method not allowed.\n", allow: "GET, HEAD" });
const post = await shipit(context("/llms.txt", "POST", refusal), next) as Response;
assert.deepEqual([post.status, post.headers.get("allow"), post.headers.get("cache-control")], [405, "GET, HEAD", "no-store"]);
await shipit(context("/llms.txt?utm=x&refuse=none", "GET", served({ pass: false, status: 404, contentType: "text/plain; charset=utf-8", cacheControl: "no-store", body: "Not found.\n" })), next);
assert.deepEqual(calls.map((call) => new URL(call.url).search), ["?refuse=method", "?refuse=query"]);

// Deactivated plugin and other owners at runtime yield; failures are 503 under Shipit only.
assert.equal(await shipit(context("/llms.txt", "GET", async () => ({ success: false, error: { code: "NOT_FOUND" } })), next), NEXT);
assert.equal(await shipit(context("/llms.txt", "GET", served({ pass: true })), next), NEXT);
for (const failing of [
	null,
	async () => { throw new Error("boom"); },
	async () => ({ success: false, error: { code: "INTERNAL_ERROR" } }),
	served({ pass: false, status: 418, contentType: "text/plain", cacheControl: "no-store", body: "" }),
	served({ pass: false, status: 200 }),
] as (Dispatch | null)[]) {
	const response = await shipit(context("/llms.txt", "GET", failing), next) as Response;
	assert.deepEqual([response.status, response.headers.get("cache-control"), response.headers.get("retry-after")], [503, "no-store", "300"]);
}

console.log("llms.txt Astro installation and middleware self-check passed.");
