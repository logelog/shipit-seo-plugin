import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { shipitSeo } from "./astro.ts";
import { seoInstallation, type SeoPluginOptions } from "./index.ts";
import { INDEXNOW_KEY_ROUTE_ENTRYPOINT, INDEXNOW_KEY_ROUTE_PATTERN } from "./indexnow-integration.ts";

const workspace = mkdtempSync(join(tmpdir(), "shipit-indexnow-key-route-"));
const ownFile = fileURLToPath(INDEXNOW_KEY_ROUTE_ENTRYPOINT);
const posix = process.platform !== "win32";
// `?` is not a valid Windows file name character.
const specialName = posix ? "site #1 %20 ?& şé" : "site #1 %20 & şé";
let counter = 0;

function site(name = `site-${counter++}`): string {
	const root = join(workspace, name);
	mkdirSync(join(root, "node_modules", "emdash"), { recursive: true });
	writeFileSync(join(root, "node_modules", "emdash", "package.json"), JSON.stringify({ name: "emdash", version: "1.2.0", main: "index.js" }));
	writeFileSync(join(root, "node_modules", "emdash", "index.js"), "");
	mkdirSync(join(root, "src", "pages"), { recursive: true });
	mkdirSync(join(root, "public"));
	return root;
}

/** Astro reports project-relative entrypoints with forward slashes. */
function fromRoot(root: string, file: string): string {
	return relative(root, file).split("\\").join("/");
}

function foreignFile(root: string, path: string): string {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, "export const GET = () => new Response('foreign');\n");
	return file;
}

type Route = { pattern: string; patternRegex: RegExp; entrypoint: string };
type Step = "done" | Route[];

const keyRoutes = (entrypoint: string): Route[] => [
	{ pattern: INDEXNOW_KEY_ROUTE_PATTERN, patternRegex: /^\/indexnow-key\.txt\/?$/, entrypoint },
];

async function settle(setupRoot: string, steps: readonly Step[], doneRoot = setupRoot) {
	let plugins: { options?: SeoPluginOptions }[] = [];
	const injected: { pattern: string; entrypoint: unknown }[] = [];
	const fakeEmdash = (config: { plugins?: unknown[] }) => {
		plugins = (config.plugins ?? []) as typeof plugins;
		return { name: "emdash", hooks: { "astro:config:setup": async () => undefined } } as never;
	};
	const integration = shipitSeo(fakeEmdash, {});
	const configFor = (root: string) => {
		const url = (path: string) => pathToFileURL(join(root, path) + "/");
		return {
			root: url(""), srcDir: url("src"), publicDir: url("public"), base: "/", trailingSlash: "ignore",
			integrations: [{ name: "emdash" }], site: undefined,
		};
	};
	const logger = { warn: () => undefined, info: () => undefined };
	const hooks = integration.hooks as Record<string, (params: unknown) => Promise<unknown>>;
	await hooks["astro:config:setup"]({
		config: configFor(setupRoot), logger, addMiddleware: () => undefined, updateConfig: () => undefined,
		injectRoute: (route: { pattern: string; entrypoint: unknown }) => { injected.push(route); },
	});
	for (const step of steps) {
		if (step === "done") await hooks["astro:config:done"]({ config: configFor(doneRoot), logger });
		else await hooks["astro:routes:resolved"]({ logger, routes: step });
	}
	return { keyRoute: seoInstallation(plugins[0]?.options ?? {}).keyRoute, injected };
}

/** Astro resolves routes before astro:config:done; a dev file change resolves them again afterwards. */
async function expectInBothOrders(root: string, entrypoint: string, expected: "injected" | "existing", label: string) {
	for (const [order, steps] of [
		["routes before the final configuration", [keyRoutes(entrypoint), "done"]],
		["routes after the final configuration", ["done", keyRoutes(entrypoint)]],
	] as const) {
		assert.equal((await settle(root, steps)).keyRoute, expected, `${label}: ${order}`);
	}
}

let cases = 0;
try {
	const root = site();
	const setup = await settle(root, []);
	assert.deepEqual(setup.injected.map((route) => [route.pattern, route.entrypoint]), [[INDEXNOW_KEY_ROUTE_PATTERN, INDEXNOW_KEY_ROUTE_ENTRYPOINT]],
		"the control fixture injects Shipit's own key route");
	assert.equal(setup.keyRoute, "injected", "before routes resolve, the setup classification stands");

	// Astro 7.3.2 reports the injected entrypoint relative to the project root.
	await expectInBothOrders(root, fromRoot(root, ownFile), "injected", "a project-relative entrypoint of Shipit's route file");
	await expectInBothOrders(root, ownFile, "injected", "an absolute path of Shipit's route file");
	await expectInBothOrders(root, INDEXNOW_KEY_ROUTE_ENTRYPOINT.href, "injected", "a file URL of Shipit's route file");
	cases += 3;

	// Another winner keeps the key route, even when its file name or path tail matches Shipit's.
	const sameName = foreignFile(root, join("node_modules", "other-indexnow", "indexnow-route.ts"));
	const sameTail = foreignFile(root, join("vendor", ...fromRoot(dirname(dirname(dirname(ownFile))), ownFile).split("/")));
	const sitePage = foreignFile(root, join("src", "routes", "indexnow-key.txt.ts"));
	for (const [label, file] of [["a foreign file with the same name", sameName], ["a foreign file with the same path tail", sameTail], ["a site route", sitePage]] as const) {
		await expectInBothOrders(root, fromRoot(root, file), "existing", `${label}, project-relative`);
		await expectInBothOrders(root, file, "existing", `${label}, absolute`);
		await expectInBothOrders(root, pathToFileURL(file).href, "existing", `${label}, file URL`);
		cases += 3;
	}
	await expectInBothOrders(root, "", "existing", "a winner without an entrypoint file");
	await expectInBothOrders(root, "node_modules/missing-package/indexnow-route.ts", "existing", "a missing foreign file");
	cases += 2;

	// Relative entrypoints resolve against the project root, never the process directory.
	const cwdRelative = relative(process.cwd(), ownFile);
	if (!isAbsolute(cwdRelative) && process.cwd() !== root) {
		await expectInBothOrders(root, cwdRelative.split("\\").join("/"), "existing", "a path relative to the process directory");
		cases += 1;
	}

	// A URI or virtual identifier cannot become a path by erasing its prefix with .. segments.
	for (const entrypoint of [
		`virtual:/../${fromRoot(root, ownFile)}`,
		`https:/../${fromRoot(root, ownFile)}`,
		`\0virtual/../${fromRoot(root, ownFile)}`,
	]) {
		await expectInBothOrders(root, entrypoint, "existing", "a non-file identifier with path traversal");
		cases += 1;
	}

	// The final astro:config:done root decides, not the root seen during setup.
	const finalRoot = site(join("nested", "deeper", `final-${counter++}`));
	assert.equal((await settle(root, [keyRoutes(fromRoot(finalRoot, ownFile)), "done"], finalRoot)).keyRoute, "injected",
		"an entrypoint relative to the final root is Shipit's");
	assert.equal((await settle(root, [keyRoutes(fromRoot(root, ownFile)), "done"], finalRoot)).keyRoute, "existing",
		"an entrypoint relative to an earlier root is not resolved against it");
	cases += 2;

	// Each resolution starts from the setup classification, so a dev re-run can settle again.
	assert.equal((await settle(root, ["done", keyRoutes(fromRoot(root, sameName)), keyRoutes(fromRoot(root, ownFile))])).keyRoute, "injected");
	assert.equal((await settle(root, ["done", keyRoutes(fromRoot(root, ownFile)), keyRoutes(fromRoot(root, sameName))])).keyRoute, "existing");
	assert.equal((await settle(root, ["done", []])).keyRoute, "unavailable", "no resolved winner leaves the key path unavailable");
	cases += 3;

	// Special characters in the project root and in the entrypoint itself.
	const specialRoot = site(specialName);
	await expectInBothOrders(specialRoot, fromRoot(specialRoot, ownFile), "injected", "a project root with URL-significant and non-ASCII characters");
	const specialForeign = foreignFile(specialRoot, join("node_modules", "pkg #1 %20", "indexnow-route.ts"));
	await expectInBothOrders(specialRoot, fromRoot(specialRoot, specialForeign), "existing", "a foreign file under a special-character path");
	cases += 2;
	if (posix) {
		// A different entrypoint remains foreign even when it links to the same file.
		symlinkSync(dirname(ownFile), join(specialRoot, "linked #% ?ş"));
		const linked = join(specialRoot, "linked #% ?ş", "indexnow-route.ts");
		await expectInBothOrders(specialRoot, fromRoot(specialRoot, linked), "existing", "a linked special-character entrypoint, project-relative");
		await expectInBothOrders(specialRoot, linked, "existing", "a linked special-character entrypoint, absolute");
		await expectInBothOrders(specialRoot, pathToFileURL(linked).href, "existing", "a linked special-character entrypoint, file URL");
		await expectInBothOrders(specialRoot, "file://remote.example/indexnow-route.ts", "existing", "a non-local file URL");
		cases += 4;
	} else {
		console.log("Symbolic-link and remote file URL cases skipped on Windows.");
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}

console.log(`IndexNow key route ownership selfcheck passed (${cases} entrypoint cases).`);
