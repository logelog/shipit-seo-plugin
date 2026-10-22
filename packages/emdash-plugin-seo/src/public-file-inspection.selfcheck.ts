import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { shipitSeo } from "./astro.ts";
import { seoRobotsInstallation, seoSitemapInstallation, type SeoPluginOptions } from "./index.ts";
import { buildRobotsTxtFacts } from "./robots-runtime.ts";
import { createSitemapMiddleware } from "./sitemap-middleware.ts";

const workspace = mkdtempSync(join(tmpdir(), "shipit-public-file-inspection-"));
let counter = 0;
let permissionCases = 0;

function site() {
	const root = join(workspace, `site-${counter++}`);
	mkdirSync(join(root, "node_modules", "emdash"), { recursive: true });
	writeFileSync(join(root, "node_modules", "emdash", "package.json"), JSON.stringify({ name: "emdash", version: "1.2.0", main: "index.js" }));
	writeFileSync(join(root, "node_modules", "emdash", "index.js"), "");
	mkdirSync(join(root, "src", "pages"), { recursive: true });
	mkdirSync(join(root, "public"));
	return root;
}

type Owner = { owner: string; detail: string | null };
type VitePlugin = { name: string; resolveId: (id: string) => string | undefined; load: (id: string) => string | undefined };

async function inspect(root: string) {
	let plugins: { options?: SeoPluginOptions }[] = [];
	const vitePlugins: VitePlugin[] = [];
	const fakeEmdash = (config: { plugins?: unknown[] }) => {
		plugins = (config.plugins ?? []) as typeof plugins;
		return { name: "emdash", hooks: { "astro:config:setup": async () => undefined } } as never;
	};
	const integration = shipitSeo(fakeEmdash, {});
	const url = (path: string) => pathToFileURL(join(root, path) + "/");
	const config = {
		root: url(""), srcDir: url("src"), publicDir: url("public"), base: "/", trailingSlash: "ignore",
		integrations: [{ name: "emdash" }], site: undefined,
	};
	const logger = { warn: () => undefined, info: () => undefined };
	const hooks = integration.hooks as Record<string, (params: unknown) => Promise<unknown>>;
	await hooks["astro:config:setup"]({
		config, logger, injectRoute: () => undefined, addMiddleware: () => undefined,
		updateConfig: (update: { vite?: { plugins?: VitePlugin[] } }) => vitePlugins.push(...(update.vite?.plugins ?? [])),
	});
	await hooks["astro:config:done"]({ config, logger });
	await hooks["astro:routes:resolved"]({
		logger,
		routes: [
			{ pattern: "/sitemap.xml", patternRegex: /^\/sitemap\.xml\/?$/, entrypoint: "node_modules/emdash/dist/astro/routes/sitemap.xml.mjs" },
			{ pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "node_modules/emdash/dist/astro/routes/robots.txt.mjs" },
		],
	});
	const options = plugins[0]?.options ?? {};
	const sitemap = seoSitemapInstallation(options) as Owner | null;
	const robots = seoRobotsInstallation(options);
	const ownerPlugin = vitePlugins.find((plugin) => plugin.name === "shipit-seo:sitemap-owner");
	const moduleId = ownerPlugin?.resolveId("virtual:shipit-seo/sitemap-owner");
	return { sitemap, robots, robotsFacts: buildRobotsTxtFacts(robots), ownerModule: moduleId ? ownerPlugin!.load(moduleId) : undefined };
}

async function checkUnknown(root: string, expected: ("sitemap" | "robots")[], detail: RegExp) {
	const result = await inspect(root);
	for (const key of expected) {
		assert.equal(result[key]?.owner, "unknown", `${key}: failed inspection must survive final route settlement`);
		assert.match(result[key]?.detail ?? "", detail);
	}
	if (expected.includes("sitemap")) {
		assert.equal(result.ownerModule, 'export default "unknown";');
		let dispatched = false;
		const middleware = createSitemapMiddleware(result.sitemap!.owner);
		const url = new URL("https://example.com/sitemap.xml");
		const next = new Response("existing owner", { status: 299 });
		const response = await middleware({
			url, request: new Request(url),
			locals: { emdash: { handlePublicPluginApiRoute: async () => { dispatched = true; throw new Error("must not dispatch"); } } },
		} as never, async () => next);
		assert.equal(response, next, "unknown ownership leaves public response untouched");
		assert.equal(dispatched, false);
	}
	if (expected.includes("robots")) assert.equal(result.robotsFacts.owner, "unknown", "admin facts retain the read-only owner");
	return result;
}

try {
	const readable = site();
	assert.deepEqual([(await inspect(readable)).sitemap?.owner, (await inspect(readable)).robots?.owner], ["shipit", "emdash-core"]);
	const absent = site();
	rmSync(join(absent, "public"), { recursive: true });
	rmSync(join(absent, "src", "pages"), { recursive: true });
	assert.deepEqual([(await inspect(absent)).sitemap?.owner, (await inspect(absent)).robots?.owner], ["shipit", "emdash-core"], "ENOENT is a safe absent-directory control");

	if (process.getuid?.() !== undefined && process.getuid() !== 0) {
		for (const path of ["public", "src/pages"]) {
			const root = site();
			const directory = join(root, path);
			chmodSync(directory, 0o000);
			try {
				assert.throws(() => readdirSync(directory), { code: "EACCES" }, "the operating system must deny the real directory read");
				await checkUnknown(root, ["sitemap", "robots"], /could not be read \(EACCES\)/);
				permissionCases++;
			} finally {
				chmodSync(directory, 0o700);
			}
			const recovered = await inspect(root);
			assert.deepEqual([recovered.sitemap?.owner, recovered.robots?.owner], ["shipit", "emdash-core"], "a new configuration pass recovers after permissions are restored");
		}
	} else {
		console.log("Permission-denial cases skipped: a non-root POSIX user is required.");
	}

	for (const path of ["public", "src/pages"]) {
		const root = site();
		const directory = join(root, path);
		rmSync(directory, { recursive: true });
		writeFileSync(directory, "not a directory");
		await checkUnknown(root, ["sitemap", "robots"], /could not be read \(ENOTDIR\)/);
	}

	for (const [name, owner] of [["sitemap.xml", "sitemap"], ["robots.txt", "robots"]] as const) {
		const root = site();
		writeFileSync(join(root, "public", name), "site-owned bytes");
		assert.equal((await inspect(root))[owner]?.owner, "static-file");
		const nested = site();
		mkdirSync(join(nested, "src", "pages", name));
		writeFileSync(join(nested, "src", "pages", name, "index.ts"), "");
		assert.equal((await inspect(nested))[owner]?.owner, "site-route");
	}

	if (process.platform !== "win32") {
		for (const path of ["public", "src/pages"]) {
			const root = site();
			rmSync(join(root, path), { recursive: true });
			symlinkSync(join(root, "missing-target"), join(root, path));
			await checkUnknown(root, ["sitemap", "robots"], /symbolic link/);
		}
		for (const [name, owner, other] of [["sitemap.xml", "sitemap", "robots"], ["robots.txt", "robots", "sitemap"]] as const) {
			const root = site();
			symlinkSync(join(root, "missing-target"), join(root, "public", name));
			await checkUnknown(root, [owner], /symbolic link/);
			assert.equal((await inspect(root))[other]?.owner, other === "sitemap" ? "shipit" : "emdash-core", "an irrelevant public symlink does not block the other owner");
			const route = site();
			symlinkSync(join(route, "missing-target"), join(route, "src", "pages", name));
			await checkUnknown(route, [owner], /symbolic link/);
			const index = site();
			mkdirSync(join(index, "src", "pages", name));
			symlinkSync(join(index, "missing-target"), join(index, "src", "pages", name, "index.ts"));
			await checkUnknown(index, [owner], /symbolic link/);
			const linked = site();
			mkdirSync(join(linked, "route-target"));
			writeFileSync(join(linked, "route-target", "index.ts"), "");
			symlinkSync(join(linked, "route-target"), join(linked, "src", "pages", name));
			assert.equal((await inspect(linked))[owner]?.owner, "site-route", "a resolved symbolic-link directory retains its route");
			if (process.getuid?.() !== undefined && process.getuid() !== 0) {
				const known = site();
				writeFileSync(join(known, "public", name), "existing public file");
				chmodSync(join(known, "src", "pages"), 0o000);
				try {
					assert.throws(() => readdirSync(join(known, "src", "pages")), { code: "EACCES" });
					const result = await inspect(known);
					assert.equal(result[owner]?.owner, "static-file", "a known public file keeps its higher-priority ownership despite unreadable pages");
					assert.equal(result[other]?.owner, "unknown", "the public file establishes no ownership for another feature");
					permissionCases++;
				} finally {
					chmodSync(join(known, "src", "pages"), 0o700);
				}
				const locked = site();
				const directory = join(locked, "src", "pages", name);
				mkdirSync(directory);
				chmodSync(directory, 0o000);
				try {
					await checkUnknown(locked, [owner], /could not be read \(EACCES\)/);
					assert.equal((await inspect(locked))[other]?.owner, other === "sitemap" ? "shipit" : "emdash-core", "an irrelevant nested directory does not block the other owner");
					permissionCases++;
				} finally {
					chmodSync(directory, 0o700);
				}
			}
		}
		const unrelated = site();
		mkdirSync(join(unrelated, "src", "pages", "unrelated"));
		chmodSync(join(unrelated, "src", "pages", "unrelated"), 0o000);
		symlinkSync(join(unrelated, "missing-target"), join(unrelated, "src", "pages", "unrelated-link"));
		try {
			const result = await inspect(unrelated);
			assert.deepEqual([result.sitemap?.owner, result.robots?.owner], ["shipit", "emdash-core"]);
		} finally {
			chmodSync(join(unrelated, "src", "pages", "unrelated"), 0o700);
		}
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}

console.log(`Public-file ownership inspection selfcheck passed (${permissionCases} actual non-root permission-denial cases).`);
