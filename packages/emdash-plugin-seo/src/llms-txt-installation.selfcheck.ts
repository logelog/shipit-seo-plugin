import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { listLlmsTxtDirectory } from "./llms-txt-files.ts";
import {
	classifyLlmsTxtInstallation,
	llmsTxtPageEntry,
	llmsTxtRouteFact,
	settleLlmsTxtInstallation,
	validLlmsTxtInstallation,
	type LlmsTxtClassificationFacts,
	type LlmsTxtDirectoryListing,
} from "./llms-txt-installation.ts";

const listed = (...names: (string | { name: string; directory?: boolean; unreadable?: string; children?: LlmsTxtDirectoryListing })[]): LlmsTxtDirectoryListing => ({
	state: "listed",
	entries: names.map((entry) => typeof entry === "string" ? { name: entry, directory: false } : { directory: false, ...entry }),
});
const facts = (patch: Partial<LlmsTxtClassificationFacts> = {}): LlmsTxtClassificationFacts => ({
	emdashVersion: "1.1.0", publicDirectory: { state: "absent" }, pagesDirectory: listed("index.astro"), integrations: ["emdash"], ...patch,
});
const owner = (patch: Partial<LlmsTxtClassificationFacts> = {}) => {
	const result = classifyLlmsTxtInstallation(facts(patch));
	return [result.owner, result.detail];
};

// ---- Configuration facts --------------------------------------------------------

assert.deepEqual(owner(), ["unsettled", "Resolved routes were not recorded"]);
assert.deepEqual(settleLlmsTxtInstallation(classifyLlmsTxtInstallation(facts({ emdashVersion: "1.2.0" })), { winner: "none" }),
	{ owner: "shipit", detail: null, hostVersion: "1.2.0" });
assert.deepEqual(owner({ emdashVersion: "1.3.0" }), ["unsettled", "Resolved routes were not recorded"]);
assert.deepEqual(owner({ emdashVersion: "1.4.0" }), ["unsupported-host", "EmDash 1.4.0"]);
assert.deepEqual(owner({ emdashVersion: "1.0.1" }), ["unsupported-host", "EmDash 1.0.1"]);
assert.deepEqual(owner({ emdashVersion: null }), ["unsupported-host", "EmDash version unknown"]);
assert.deepEqual(owner({ publicDirectory: listed("favicon.ico", "LLMS.TXT") }), ["static-file", "public/LLMS.TXT"]);
assert.deepEqual(owner({ publicDirectory: listed("llms.txt"), pagesDirectory: listed("llms.txt.ts") }), ["static-file", "public/llms.txt"], "a public file answers first");
assert.deepEqual(owner({ publicDirectory: listed("llms-full.txt", "llms.txt.bak") }), ["unsettled", "Resolved routes were not recorded"]);
assert.deepEqual(owner({ pagesDirectory: listed("llms.txt.ts") }), ["site-route", "src/pages/llms.txt.ts"]);
assert.deepEqual(owner({ pagesDirectory: listed("Llms.Txt.astro") }), ["site-route", "src/pages/Llms.Txt.astro"]);
assert.deepEqual(owner({ pagesDirectory: listed({ name: "llms.txt", directory: true, children: listed("index.ts") }) }), ["site-route", "src/pages/llms.txt"]);
assert.deepEqual(owner({ pagesDirectory: listed({ name: "llms.txt", directory: true, children: listed("notes.md.bak") }) }), ["unsettled", "Resolved routes were not recorded"]);
assert.deepEqual(owner({ integrations: ["emdash", "astro-llms-generator"] }), ["integration", "astro-llms-generator"]);
assert.deepEqual(owner({ base: "/docs" }), ["unsupported-routing", "Astro base path /docs"]);
assert.deepEqual(owner({ base: "" }), ["unsettled", "Resolved routes were not recorded"]);
assert.deepEqual(owner({ i18n: { defaultLocale: "en", locales: ["en", "fr"] } }), ["unsupported-routing", "Astro i18n routing"]);

// Absent directories are a "no"; unreadable ones never are.
assert.deepEqual(owner({ publicDirectory: { state: "absent" }, pagesDirectory: { state: "absent" } }), ["unsettled", "Resolved routes were not recorded"]);
assert.deepEqual(owner({ publicDirectory: { state: "unreadable", code: "EACCES" } }), ["unknown", "The public directory could not be read (EACCES)"]);
assert.deepEqual(owner({ pagesDirectory: { state: "unreadable", code: "EPERM" } }), ["unknown", "src/pages could not be read (EPERM)"]);
assert.deepEqual(owner({ pagesDirectory: listed({ name: "llms.txt", directory: true, children: { state: "unreadable", code: "EACCES" } }) }),
	["unknown", "src/pages/llms.txt could not be read (EACCES)"]);
assert.deepEqual(owner({ pagesDirectory: listed({ name: "llms.txt.ts", unreadable: "unresolved symbolic link" }) }),
	["unknown", "src/pages/llms.txt.ts could not be read (unresolved symbolic link)"], "a candidate name that cannot be inspected is not ignored");
assert.deepEqual(owner({ pagesDirectory: listed({ name: "about.astro", unreadable: "unresolved symbolic link" }) }), ["unsettled", "Resolved routes were not recorded"]);
assert.deepEqual(owner({ publicDirectory: listed({ name: "llms.txt", unreadable: "unresolved symbolic link" }) }),
	["unknown", "public/llms.txt could not be read (unresolved symbolic link)"]);
assert.deepEqual(llmsTxtPageEntry({ name: "llms.txt", directory: true }), { match: "unreadable", name: "llms.txt", code: "not listed" });

// ---- Resolved routes, with Astro 7.3.2's own patterns ----------------------------

const astroEntry = import.meta.resolve("astro");
const { parseRoute } = await import(new URL("./core/routing/parse-route.js", astroEntry).href) as {
	parseRoute: (route: string, options: { config: { base: string; trailingSlash: string } }, parse: { component: string; type?: string }) => { pattern: RegExp; route: string };
};
function astroRoute(file: string, trailingSlash: "always" | "never" | "ignore", type = "page") {
	const parsed = parseRoute(file, { config: { base: "/", trailingSlash } }, { component: `src/pages/${file}`, type });
	return { pattern: parsed.route, patternRegex: parsed.pattern, type };
}
for (const trailingSlash of ["always", "never", "ignore"] as const) {
	const catchAll = astroRoute("[...slug].astro", trailingSlash);
	const slug = astroRoute("[slug].astro", trailingSlash);
	const textFile = astroRoute("[file].txt.ts", trailingSlash, "endpoint");
	const posts = astroRoute("posts/[slug].astro", trailingSlash);
	if (trailingSlash === "always") assert.equal(catchAll.patternRegex.test("/llms.txt"), false, "control: the pattern needs the slash");
	assert.deepEqual(llmsTxtRouteFact([posts, catchAll]), { winner: "other", detail: "/[...slug] answers /llms.txt" }, `catch-all, ${trailingSlash}`);
	assert.deepEqual(llmsTxtRouteFact([slug]), { winner: "other", detail: "/[slug] answers /llms.txt" }, `slug, ${trailingSlash}`);
	assert.deepEqual(llmsTxtRouteFact([textFile, catchAll]), { winner: "other", detail: "/[file].txt answers /llms.txt" }, "the first match wins");
	assert.deepEqual(llmsTxtRouteFact([posts, astroRoute("index.astro", trailingSlash)]), { winner: "none" });
}
assert.deepEqual(llmsTxtRouteFact([{ pattern: "/llms.txt", patternRegex: /^\/llms\.txt$/, type: "redirect" }]),
	{ winner: "other", detail: "The redirect /llms.txt answers /llms.txt" });
assert.deepEqual(llmsTxtRouteFact([]), { winner: "none" });

const unsettled = classifyLlmsTxtInstallation(facts());
assert.deepEqual(settleLlmsTxtInstallation(unsettled, { winner: "none" }), { owner: "shipit", detail: null, hostVersion: "1.1.0" });
assert.deepEqual(settleLlmsTxtInstallation(unsettled, { winner: "other", detail: "/[...slug] answers /llms.txt" }),
	{ owner: "competing-route", detail: "/[...slug] answers /llms.txt", hostVersion: "1.1.0" });
assert.equal(settleLlmsTxtInstallation(unsettled, null).owner, "unsettled", "no route evidence, no owner");
const staticOwner = classifyLlmsTxtInstallation(facts({ publicDirectory: listed("llms.txt") }));
assert.equal(settleLlmsTxtInstallation(staticOwner, { winner: "none" }).owner, "static-file", "route facts never override a file");

// ---- Serialized options ----------------------------------------------------------

assert.deepEqual(validLlmsTxtInstallation({ owner: "shipit", detail: null, hostVersion: "1.1.0" }), { owner: "shipit", detail: null, hostVersion: "1.1.0" });
for (const value of [null, [], { owner: "someone", detail: null, hostVersion: null }, { owner: "shipit", detail: "x", hostVersion: null },
	{ owner: "unknown", detail: "x".repeat(301), hostVersion: null }, { owner: "unknown", detail: 1, hostVersion: null }, { owner: "unknown", detail: null }]) {
	assert.equal(validLlmsTxtInstallation(value), null, JSON.stringify(value));
}

// ---- Filesystem adapter: absent, unreadable and dangling entries ----------------

const workspace = mkdtempSync(join(tmpdir(), "shipit-llms-files-"));
const url = (path: string) => pathToFileURL(join(workspace, path) + "/");
try {
	assert.deepEqual(listLlmsTxtDirectory(url("missing")), { state: "absent" });
	mkdirSync(join(workspace, "pages", "llms.txt"), { recursive: true });
	writeFileSync(join(workspace, "pages", "llms.txt", "index.ts"), "export const GET = () => new Response('');\n");
	writeFileSync(join(workspace, "pages", "about.astro"), "");
	const pages = listLlmsTxtDirectory(url("pages"));
	assert.equal(pages.state, "listed");
	assert.deepEqual(owner({ pagesDirectory: pages }), ["site-route", "src/pages/llms.txt"]);

	symlinkSync(join(workspace, "nowhere.ts"), join(workspace, "pages", "llms.txt.ts"));
	rmSync(join(workspace, "pages", "llms.txt"), { recursive: true });
	const dangling = listLlmsTxtDirectory(url("pages"));
	assert.ok(dangling.state === "listed" && dangling.entries.some((entry) => entry.name === "llms.txt.ts" && entry.unreadable === "unresolved symbolic link"));
	assert.equal(owner({ pagesDirectory: dangling })[0], "unknown");

	mkdirSync(join(workspace, "locked"));
	chmodSync(join(workspace, "locked"), 0o000);
	const locked = listLlmsTxtDirectory(url("locked"));
	if (process.getuid?.() === 0) {
		console.log("Unreadable-directory control skipped: running as root reads any directory.");
	} else {
		assert.deepEqual(locked, { state: "unreadable", code: "EACCES" });
		assert.deepEqual(owner({ publicDirectory: locked }), ["unknown", "The public directory could not be read (EACCES)"]);
		assert.deepEqual(owner({ pagesDirectory: locked }), ["unknown", "src/pages could not be read (EACCES)"]);
	}
	mkdirSync(join(workspace, "pages2", "llms.txt"), { recursive: true });
	chmodSync(join(workspace, "pages2", "llms.txt"), 0o000);
	if (process.getuid?.() !== 0) {
		assert.deepEqual(owner({ pagesDirectory: listLlmsTxtDirectory(url("pages2")) }), ["unknown", "src/pages/llms.txt could not be read (EACCES)"]);
	}
} finally {
	for (const path of ["locked", join("pages2", "llms.txt")]) {
		try { chmodSync(join(workspace, path), 0o700); } catch { /* already removed */ }
	}
	rmSync(workspace, { recursive: true, force: true });
}

console.log("llms.txt ownership self-check passed.");
