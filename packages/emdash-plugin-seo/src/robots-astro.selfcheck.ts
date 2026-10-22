import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { shipitSeo } from "./astro.ts";
import { seoRobotsInstallation, type SeoPluginOptions } from "./index.ts";
import { buildRobotsTxtFacts } from "./robots-runtime.ts";
import plugin, { createSeoEngine } from "./sandbox-entry.ts";

const workspace = mkdtempSync(join(tmpdir(), "shipit-robots-astro-"));
let counter = 0;

function site(version: string) {
	const root = join(workspace, `site-${version}-${counter++}`);
	mkdirSync(join(root, "node_modules", "emdash"), { recursive: true });
	writeFileSync(join(root, "node_modules", "emdash", "package.json"), JSON.stringify({ name: "emdash", version, main: "index.js" }));
	writeFileSync(join(root, "node_modules", "emdash", "index.js"), "");
	mkdirSync(join(root, "src", "pages"), { recursive: true });
	mkdirSync(join(root, "public"), { recursive: true });
	return root;
}

type Robots = { owner: string; detail: string | null; hostVersion: string | null; emdashSiteUrl: string | null };

function install(root: string, emdashConfig: Record<string, unknown> = {}, patch: Record<string, unknown> = {}) {
	let plugins: { options?: { installation?: { robots?: Robots } } }[] = [];
	const fakeEmdash = (config: { plugins?: unknown[] }) => {
		plugins = (config.plugins ?? []) as typeof plugins;
		return { name: "emdash", hooks: { "astro:config:setup": async () => undefined } } as never;
	};
	const integration = shipitSeo(fakeEmdash, emdashConfig);
	const logs: string[] = [];
	const logger = { warn: (message: string) => logs.push(message), info: (message: string) => logs.push(message) };
	const url = (path: string) => pathToFileURL(join(root, path) + "/");
	const config = {
		root: url(""), srcDir: url("src"), publicDir: url("public"), base: "/", trailingSlash: "ignore",
		integrations: [{ name: "emdash" }], site: undefined, ...patch,
	};
	const hooks = integration.hooks as Record<string, (params: unknown) => Promise<unknown>>;
	return {
		robots: () => plugins[0]?.options?.installation?.robots,
		options: () => (plugins[0]?.options ?? {}) as SeoPluginOptions,
		logs,
		setup: () => hooks["astro:config:setup"]({
			config, logger, injectRoute: () => undefined, addMiddleware: () => undefined, updateConfig: () => undefined,
		}),
		done: () => hooks["astro:config:done"]({ config, logger }),
		routes: (routes: unknown[]) => hooks["astro:routes:resolved"]({ routes, logger }),
	};
}

const coreRobots = { pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "node_modules/.pnpm/emdash@1.1.0/node_modules/emdash/dist/astro/routes/robots.txt.mjs" };
const coreSitemap = { pattern: "/sitemap.xml", patternRegex: /^\/sitemap\.xml\/?$/, entrypoint: "node_modules/emdash/dist/astro/routes/sitemap.xml.mjs" };
const otherRobots = { pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "node_modules/astro-robots/route.ts" };
const redirect = { pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "/robots.txt" };
const textFiles = { pattern: "/[file].txt", patternRegex: /^\/([^/]+?)\.txt$/, entrypoint: "src/pages/[file].txt.ts" };

try {
	// Configuration alone never names core; the resolved routes settle it.
	const core = install(site("1.1.0"), { siteUrl: "https://cms.example.org/admin/" });
	await core.setup();
	assert.equal(core.robots()?.owner, "unsettled");
	await core.done();
	assert.equal(core.robots()?.owner, "unsettled", "no route evidence yet");
	assert.equal(seoRobotsInstallation(core.options())?.owner, "unsettled");
	await core.routes([coreSitemap, coreRobots, textFiles]);
	assert.deepEqual(core.robots(), { owner: "emdash-core", detail: null, hostVersion: "1.1.0", emdashSiteUrl: "https://cms.example.org" });
	assert.deepEqual(buildRobotsTxtFacts(seoRobotsInstallation(core.options()), {}).configuredOrigin,
		{ origin: "https://cms.example.org", source: "emdash-config" });
	await core.routes([textFiles, coreRobots]);
	assert.equal(core.robots()?.owner, "competing-route", "a route ahead of core's answers");
	await core.routes([coreRobots, otherRobots]);
	assert.deepEqual([core.robots()?.owner, core.robots()?.detail], ["competing-route", "/robots.txt is defined twice"]);
	await core.routes([coreRobots, redirect]);
	assert.equal(core.robots()?.owner, "competing-route", "a configured redirect for the same path competes");
	await core.routes([coreSitemap]);
	assert.equal(core.robots()?.owner, "not-served");
	await core.routes([coreRobots]);
	assert.equal(core.robots()?.owner, "emdash-core");
	assert.ok(core.logs.some((line) => line.includes("Robots.txt editor is read-only")));

	for (const version of ["1.2.0", "1.3.0"]) {
		const released = install(site(version), { siteUrl: "https://cms.example.org/admin/" });
		await released.setup();
		await released.done();
		await released.routes([{ ...coreRobots, entrypoint: coreRobots.entrypoint.replace("emdash@1.1.0", `emdash@${version}`) }]);
		assert.deepEqual(released.robots(), { owner: "emdash-core", detail: null, hostVersion: version, emdashSiteUrl: "https://cms.example.org" });
	}

	// A public file answers first, also over a site page.
	const both = site("1.1.0");
	writeFileSync(join(both, "public", "robots.txt"), "User-agent: *\n");
	writeFileSync(join(both, "src", "pages", "robots.txt.ts"), "export const GET = () => new Response('');\n");
	const staticFirst = install(both);
	await staticFirst.setup();
	await staticFirst.done();
	await staticFirst.routes([{ pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "src/pages/robots.txt.ts" }]);
	assert.deepEqual([staticFirst.robots()?.owner, staticFirst.robots()?.detail], ["static-file", "public/robots.txt"]);

	const page = site("1.1.0");
	mkdirSync(join(page, "src", "pages", "robots.txt"), { recursive: true });
	writeFileSync(join(page, "src", "pages", "robots.txt", "index.ts"), "");
	const pageOwned = install(page);
	await pageOwned.setup();
	await pageOwned.routes([{ pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "src/pages/robots.txt/index.ts" }]);
	assert.deepEqual([pageOwned.robots()?.owner, pageOwned.robots()?.detail], ["site-route", "src/pages/robots.txt"]);

	const based = install(site("1.1.0"), {}, { base: "/docs" });
	await based.setup();
	await based.routes([coreRobots]);
	assert.equal(based.robots()?.owner, "unsupported-routing");

	const older = install(site("1.0.1"));
	await older.setup();
	await older.routes([coreRobots]);
	assert.deepEqual([older.robots()?.owner, older.robots()?.hostVersion], ["unsupported-host", "1.0.1"]);

	const integration = install(site("1.1.0"), {}, { integrations: [{ name: "emdash" }, { name: "astro-robots-txt" }] });
	await integration.setup();
	await integration.done();
	await integration.routes([coreRobots]);
	assert.deepEqual([integration.robots()?.owner, integration.robots()?.detail], ["integration", "astro-robots-txt"]);
} finally {
	rmSync(workspace, { recursive: true, force: true });
}

// The admin route is readable with settings:read and reports what was bound.
const route = (plugin.routes as Record<string, { permission?: string; handler: (...args: unknown[]) => unknown }>)["admin-robots-txt"];
assert.equal(route.permission, "settings:read");
const ctx = {};
assert.deepEqual(await route.handler({ input: {} }, ctx), {
	contractVersion: buildRobotsTxtFacts(null).contractVersion,
	engineVersion: buildRobotsTxtFacts(null).engineVersion,
	owner: "not-installed",
	ownerDetail: null,
	hostVersion: null,
	configuredOrigin: null,
	configuredOriginKnown: false,
});
const bound = createSeoEngine(undefined, {
	robots: { owner: "emdash-core", detail: null, hostVersion: "1.1.0", emdashSiteUrl: null },
});
const boundRoute = (bound.routes as Record<string, { permission?: string; handler: (...args: unknown[]) => unknown }>)["admin-robots-txt"];
assert.equal(boundRoute.permission, "settings:read");
const facts = await boundRoute.handler({ input: {} }, {}) as ReturnType<typeof buildRobotsTxtFacts>;
assert.deepEqual([facts.owner, facts.hostVersion, facts.configuredOriginKnown], ["emdash-core", "1.1.0", true]);

// Core reads EMDASH_SITE_URL || SITE_URL; an invalid first value does not fall through.
const installation = { owner: "emdash-core", detail: null, hostVersion: "1.1.0", emdashSiteUrl: null } as const;
assert.deepEqual(buildRobotsTxtFacts(installation, { SITE_URL: "https://env.example/x" }).configuredOrigin,
	{ origin: "https://env.example", source: "environment" });
assert.equal(buildRobotsTxtFacts(installation, { EMDASH_SITE_URL: "nope", SITE_URL: "https://env.example" }).configuredOrigin, null);

console.log("robots-astro selfcheck passed");
