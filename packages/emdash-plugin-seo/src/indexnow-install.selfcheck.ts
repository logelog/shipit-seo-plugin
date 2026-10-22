import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { shipitSeo } from "./astro.ts";
import { seoInstallation, seoPlugin } from "./index.ts";
import { seoIndexNow } from "./indexnow-integration.ts";
import { indexNowSiteOriginUrl } from "./indexnow-site.ts";
import { GET, HEAD, prerender } from "./indexnow-route.ts";

const defaults = seoPlugin();
assert.deepEqual(defaults.allowedHosts, ["api.indexnow.org"]);
assert.deepEqual(defaults.capabilities, [
	"content:read", "content:revisions:read", "network:request", "schema:read", "hooks.content-policy:register", "redirects:write",
	"taxonomies:read",
]);
assert.equal(seoPlugin({}), defaults);
assert.deepEqual(seoPlugin({ siteUrl: "https://example.com" }).capabilities, defaults.capabilities);
assert.deepEqual(seoPlugin({ siteUrl: "https://example.com" }).allowedHosts,
	["api.indexnow.org", "example.com"]);
assert.deepEqual(seoPlugin({ siteUrl: "https://Example.com:443/" }).allowedHosts, ["api.indexnow.org", "example.com"]);
assert.deepEqual(seoPlugin({ siteUrl: "https://api.indexnow.org" }).allowedHosts, ["api.indexnow.org"]);
assert.deepEqual(defaults.allowedHosts, ["api.indexnow.org"]);
assert.equal(indexNowSiteOriginUrl("https://www.example.com").origin, "https://www.example.com");
assert.equal(indexNowSiteOriginUrl("https://bücher.de").hostname, "xn--bcher-kva.de");
assert.equal(HEAD, GET);
assert.equal(prerender, false);

for (const siteUrl of [
	null, "", "https://", "example.com", "http://example.com", "ftp://example.com",
	"https://user:password@example.com", "https://@example.com", "https://example.com/path",
	"https://example.com/path/..", "https://example.com/?private=value",
	"https://example.com/#fragment", "https://example.com/?", "https://example.com/#",
	"https://example.com:8443", "https://*.example.com",
	"https://example.com.", "https://-bad.example.com", "https://bad_.example.com",
	"https://localhost", "https://dev.localhost", "https://dev.local", "https://dev.internal",
	"https://dev.test", "https://dev.invalid", "https://dev.example", "https://service.onion",
	"https://host.home.arpa", "https://127.0.0.1", "https://10.0.0.1", "https://8.8.8.8",
	"https://[::1]", "https://[2001:4860:4860::8888]", "https://2130706433", "https://0x7f000001",
	" https://example.com", "https://example.com\n", "https:\\example.com", "https://exam\tple.com",
]) {
	assert.throws(() => seoPlugin({ siteUrl: siteUrl as string }), {
		message: "IndexNow site URL must be an HTTPS origin with a public DNS hostname.",
	});
}
assert.throws(() => indexNowSiteOriginUrl(undefined as any), /HTTPS origin/);

const temporaryRoot = mkdtempSync(join(tmpdir(), "seo-indexnow-install-"));
try {
	const srcDir = pathToFileURL(`${join(temporaryRoot, "src")}/`);
	const publicDir = pathToFileURL(`${join(temporaryRoot, "public")}/`);
	const integration = seoIndexNow();
	const injected: Array<{ pattern: string; entrypoint: string | URL; prerender?: boolean }> = [];
	const config = { base: "/", srcDir, publicDir, integrations: [integration] };
	const setup = integration.hooks["astro:config:setup"]!;
	const context = { config, injectRoute: (route: any) => injected.push(route) } as any;
	await setup(context);
	assert.deepEqual(injected, [{
		pattern: "/indexnow-key.txt",
		entrypoint: new URL("./indexnow-route.ts", import.meta.url),
		prerender: false,
	}]);

	for (const relative of [
		"public/indexnow-key.txt",
		"src/pages/indexnow-key.txt.ts",
		"src/pages/indexnow-key.txt.js",
		"src/pages/indexnow-key.txt.astro",
		"src/pages/indexnow-key.txt/index.ts",
		"src/pages/indexnow-key.txt/index.js",
		"src/pages/indexnow-key.txt/index.astro",
	]) {
		const path = join(temporaryRoot, relative);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, "existing route");
		injected.length = 0;
		await setup(context);
		assert.deepEqual(injected, [], `Existing ${relative} keeps route ownership`);
		rmSync(path);
	}

	assert.throws(() => setup({ ...context, config: { ...config, base: "/blog" } }), /mounted at the root/);
	assert.throws(() => setup({
		...context,
		config: { ...config, integrations: [integration, seoIndexNow()] },
	}), /only once/);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

// The single Astro entry point owns EmDash, the plugin and the key route once.
const otherPlugin = { id: "other-plugin", format: "native", entrypoint: "other-plugin/runtime", options: { kept: true } };
const configuredPeerFacts = [{ id: "other-plugin", entrypoint: "other-plugin/runtime", version: null }];
function fakeEmdash() {
	const calls: any[] = [];
	const order: string[] = [];
	const factory = (config: any) => {
		calls.push(config);
		return {
			name: "emdash",
			hooks: {
				"astro:config:setup": async () => {
					const seo = config.plugins.find((item: any) => item.id === "shipit-seo");
					order.push(`emdash-setup:${seo.options?.siteUrl ?? "unbound"}:${seo.allowedHosts.join(",")}`);
				},
			},
		} as any;
	};
	return { factory, calls, order };
}

// These fixture roots install no EmDash package, so the sitemap stays with EmDash core.
const UNVERIFIED_SITEMAP = { owner: "unsupported-host", detail: "EmDash version unknown", routing: null };
const UNVERIFIED_ROBOTS = { owner: "unsupported-host", detail: "EmDash version unknown", hostVersion: null, emdashSiteUrl: null };
const UNVERIFIED_LLMS = { owner: "unsupported-host", detail: "EmDash version unknown", hostVersion: null };

function astroConfig(root: string, patch: Record<string, unknown> = {}) {
	return {
		base: "/",
		site: "https://www.example.com",
		srcDir: pathToFileURL(`${join(root, "src")}/`),
		publicDir: pathToFileURL(`${join(root, "public")}/`),
		integrations: [] as any[],
		...patch,
	};
}

async function runEntryPoint(root: string, patch: Record<string, unknown> = {}, extraIntegrations: any[] = []) {
	const emdash = fakeEmdash();
	const integration = shipitSeo(emdash.factory, { database: { entrypoint: "db" }, plugins: [otherPlugin], marker: "kept" } as any);
	const config = astroConfig(root, patch);
	config.integrations = [integration, ...extraIntegrations];
	const injected: any[] = [];
	const warnings: string[] = [];
	await integration.hooks["astro:config:setup"]!({
		config, command: "build", isRestart: false,
		injectRoute: (route: any) => injected.push(route),
		logger: { warn: (message: string) => warnings.push(message), info: () => undefined },
	} as any);
	const descriptor = emdash.calls[0].plugins.find((item: any) => item.id === "shipit-seo");
	return { emdash, integration, descriptor, injected, warnings };
}

const entryRoot = mkdtempSync(join(tmpdir(), "seo-indexnow-entry-"));
try {
	const bound = await runEntryPoint(entryRoot);
	assert.equal(bound.emdash.calls.length, 1, "EmDash is configured once");
	assert.equal(bound.emdash.calls[0].marker, "kept", "unrelated EmDash options are preserved");
	assert.deepEqual(bound.emdash.calls[0].database, { entrypoint: "db" });
	assert.deepEqual(bound.emdash.calls[0].plugins.map((item: any) => item.id), ["other-plugin", "shipit-seo"]);
	assert.equal(bound.emdash.calls[0].plugins[0], otherPlugin, "other plugins are passed through unchanged");
	assert.deepEqual(bound.descriptor.options, {
		siteUrl: "https://www.example.com",
		installation: { siteOrigin: "https://www.example.com", siteIssue: null, keyRoute: "injected", sitemap: UNVERIFIED_SITEMAP, robots: UNVERIFIED_ROBOTS, llmsTxt: UNVERIFIED_LLMS, configuredPlugins: configuredPeerFacts },
	});
	assert.deepEqual(bound.descriptor.allowedHosts, ["api.indexnow.org", "www.example.com"], "only the site hostname is added");
	assert.deepEqual(bound.descriptor.capabilities, defaults.capabilities, "no capability is widened");
	assert.ok(!bound.descriptor.capabilities.includes("network:request:unrestricted"));
	assert.deepEqual(bound.emdash.order, ["emdash-setup:https://www.example.com:api.indexnow.org,www.example.com"],
		"the descriptor is bound before EmDash's own setup hook runs");
	assert.deepEqual(bound.injected, [{
		pattern: "/indexnow-key.txt",
		entrypoint: new URL("./indexnow-route.ts", import.meta.url),
		prerender: false,
	}]);
	assert.deepEqual(defaults.allowedHosts, ["api.indexnow.org"], "the shared descriptor is never changed");
	assert.deepEqual(seoInstallation(bound.descriptor.options), {
		mode: "astro", siteUrl: "https://www.example.com", siteOrigin: "https://www.example.com", siteIssue: null, keyRoute: "injected",
	});

	for (const [site, issue, siteOrigin] of [
		["http://127.0.0.1:4362", "local", "http://127.0.0.1:4362"],
		[undefined, "missing", null],
		["https://www.example.com/blog", "path", "https://www.example.com"],
		["http://www.example.com", "not-https", "http://www.example.com"],
	] as const) {
		const run = await runEntryPoint(entryRoot, { site });
		assert.deepEqual(run.descriptor.options, { installation: { siteOrigin, siteIssue: issue, keyRoute: "injected", sitemap: UNVERIFIED_SITEMAP, robots: UNVERIFIED_ROBOTS, llmsTxt: UNVERIFIED_LLMS, configuredPlugins: configuredPeerFacts } }, String(site));
		assert.deepEqual(run.descriptor.allowedHosts, ["api.indexnow.org"], `${site} adds no hostname permission`);
		assert.equal(run.injected.length, 1, "the key route is still owned once");
		assert.equal(run.warnings.length, 1);
		assert.equal(seoInstallation(run.descriptor.options).mode, "astro");
	}

	const rootless = await runEntryPoint(entryRoot, { base: "/docs" });
	assert.equal(rootless.descriptor.options.installation.keyRoute, "unavailable");
	assert.deepEqual(rootless.injected, []);

	const legacyRoute = await runEntryPoint(entryRoot, {}, [seoIndexNow()]);
	assert.equal(legacyRoute.descriptor.options.installation.keyRoute, "existing", "an existing route integration keeps ownership");
	assert.deepEqual(legacyRoute.injected, []);

	mkdirSync(join(entryRoot, "public"), { recursive: true });
	writeFileSync(join(entryRoot, "public", "indexnow-key.txt"), "existing key file");
	const fileRoute = await runEntryPoint(entryRoot);
	assert.equal(fileRoute.descriptor.options.installation.keyRoute, "existing");
	assert.deepEqual(fileRoute.injected, []);
	rmSync(join(entryRoot, "public", "indexnow-key.txt"));

	await assert.rejects(runEntryPoint(entryRoot, {}, [{ name: "emdash", hooks: {} }]), /Configure EmDash once/);
	assert.throws(() => shipitSeo(fakeEmdash().factory, { plugins: [seoPlugin()] }), /registers the SEO plugin once/);
	assert.throws(() => shipitSeo(fakeEmdash().factory, { plugins: [seoPlugin({ siteUrl: "https://example.com" })] }), /once/);
	assert.throws(() => shipitSeo((() => ({ name: "other", hooks: {} })) as any, {}), /EmDash's Astro integration/);
	assert.throws(() => shipitSeo(undefined as any, {}), /EmDash's Astro integration/);

	// Restarted config setup computes the same binding again.
	const restart = await runEntryPoint(entryRoot);
	await restart.integration.hooks["astro:config:setup"]!({
		config: { ...astroConfig(entryRoot), integrations: [restart.integration] }, command: "dev", isRestart: true,
		injectRoute: () => undefined, logger: { warn: () => undefined },
	} as any);
	assert.deepEqual(restart.descriptor.allowedHosts, ["api.indexnow.org", "www.example.com"]);

	for (const invalid of [
		{ siteUrl: "https://example.com", installation: { siteOrigin: "https://other.example", siteIssue: null, keyRoute: "injected" } },
		{ installation: { siteOrigin: "https://example.com", siteIssue: null, keyRoute: "injected" } },
		{ installation: { siteOrigin: null, siteIssue: "missing", keyRoute: "elsewhere" } },
		{ installation: { siteOrigin: "https://example.com/path", siteIssue: "path", keyRoute: "injected" } },
	]) assert.throws(() => seoPlugin(invalid as any), /installation options are invalid/);
	assert.deepEqual(seoInstallation({}), { mode: "legacy", siteUrl: null, siteOrigin: null, siteIssue: null, keyRoute: null });
	assert.deepEqual(seoInstallation({ siteUrl: "https://example.com" }).siteUrl, "https://example.com");
} finally {
	rmSync(entryRoot, { recursive: true, force: true });
}

// With the installed EmDash 1.1.0 integration, the generated plugin module
// carries the bound options; this is the boundary the entry point relies on.
const emdashAstro = await import("emdash/astro");
const emdashRoot = new URL("../../", import.meta.resolve("emdash/astro"));
const emdashVersion = JSON.parse(readFileSync(fileURLToPath(new URL("package.json", emdashRoot)), "utf8")).version;
if (emdashVersion === "1.1.0") {
	const realRoot = mkdtempSync(join(tmpdir(), "seo-indexnow-emdash-"));
	try {
		const integration = shipitSeo(emdashAstro.default, { plugins: [] });
		const updates: any[] = [];
		const injected: any[] = [];
		const config = {
			...astroConfig(realRoot),
			root: pathToFileURL(`${realRoot}/`),
			trailingSlash: "ignore",
			security: {},
			image: {},
			integrations: [integration],
		};
		await integration.hooks["astro:config:setup"]!({
			config, command: "build", isRestart: false,
			injectRoute: (route: any) => injected.push(route),
			addMiddleware: () => undefined,
			updateConfig: (update: any) => { updates.push(update); return config; },
			logger: { warn: () => undefined, info: () => undefined, debug: () => undefined, error: () => undefined },
		} as any);
		const plugin = updates.flatMap((update) => update.vite?.plugins ?? []).flat()
			.find((item: any) => item?.name === "emdash-virtual-modules");
		assert.ok(plugin, "EmDash registers its virtual module plugin");
		const id = plugin.resolveId("virtual:emdash/plugins");
		const code = String(await plugin.load(id));
		assert.match(code, /import \{ createPlugin as createPlugin0 \} from "@shipit\/emdash-plugin-seo\/plugin";/);
		assert.ok(code.includes(`createPlugin0(${JSON.stringify({
			siteUrl: "https://www.example.com",
			installation: { siteOrigin: "https://www.example.com", siteIssue: null, keyRoute: "injected", sitemap: UNVERIFIED_SITEMAP, robots: UNVERIFIED_ROBOTS, llmsTxt: UNVERIFIED_LLMS, configuredPlugins: [] },
		})})`), "EmDash 1.1.0 instantiates the plugin with the bound site");
		assert.equal(injected.filter((route) => route.pattern === "/indexnow-key.txt").length, 1);
		assert.equal(Object.getOwnPropertySymbols(integration).some((symbol) => String(symbol).includes("emdash:migration-config")), true,
			"the returned integration keeps EmDash's migration metadata for its CLI");
	} finally {
		rmSync(realRoot, { recursive: true, force: true });
	}
} else {
	console.log(`Skipped the EmDash plugin module check on EmDash ${emdashVersion}; the entry point is validated on 1.1.0.`);
}

console.log("IndexNow installation self-checks passed.");
