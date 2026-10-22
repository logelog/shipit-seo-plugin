import assert from "node:assert/strict";

import {
	classifyRobotsInstallation,
	emdashSiteUrlOrigin,
	isRobotsPageEntry,
	robotsRouteFact,
	settleRobotsInstallation,
	validRobotsInstallation,
	type RobotsClassificationFacts,
	type RobotsResolvedRoute,
} from "./robots-installation.ts";

const facts: RobotsClassificationFacts = {
	emdashVersion: "1.1.0",
	pageEntries: [{ name: "index.astro", directory: false }, { name: "posts", directory: true, children: ["[slug].astro"] }],
	publicFiles: ["favicon.svg"],
	integrations: ["@astrojs/react", "emdash"],
	base: "/",
	emdashSiteUrl: null,
};

// Configuration facts alone never name core; the resolved routes must.
assert.deepEqual(classifyRobotsInstallation(facts), { owner: "unsettled", detail: "Resolved routes were not recorded", hostVersion: "1.1.0", emdashSiteUrl: null });
assert.deepEqual(classifyRobotsInstallation({ ...facts, emdashVersion: "1.2.0" }), { owner: "unsettled", detail: "Resolved routes were not recorded", hostVersion: "1.2.0", emdashSiteUrl: null });
assert.equal(classifyRobotsInstallation({ ...facts, emdashVersion: "1.3.0" }).owner, "unsettled");
assert.equal(classifyRobotsInstallation({ ...facts, emdashVersion: "1.4.0" }).owner, "unsupported-host");
assert.equal(classifyRobotsInstallation({ ...facts, emdashVersion: "1.0.1" }).owner, "unsupported-host");
assert.equal(classifyRobotsInstallation({ ...facts, emdashVersion: null }).detail, "EmDash version unknown");

// The same files EmDash's own detector checks, in any letter case.
for (const entry of [
	{ name: "robots.txt.ts", directory: false },
	{ name: "robots.txt.astro", directory: false },
	{ name: "Robots.txt.mjs", directory: false },
	{ name: "robots.txt", directory: true, children: ["index.ts"] },
]) {
	assert.equal(isRobotsPageEntry(entry), true, entry.name);
	assert.equal(classifyRobotsInstallation({ ...facts, pageEntries: [entry] }).owner, "site-route");
}
assert.equal(isRobotsPageEntry({ name: "robots.txt", directory: true, children: ["other.ts"] }), false);
assert.equal(isRobotsPageEntry({ name: "robots.ts", directory: false }), false);
assert.equal(isRobotsPageEntry({ name: "robots.txt.css", directory: false }), false);
assert.deepEqual(classifyRobotsInstallation({ ...facts, pageEntries: [{ name: "robots.txt.ts", directory: false }] }).detail, "src/pages/robots.txt.ts");

assert.deepEqual(
	classifyRobotsInstallation({ ...facts, publicFiles: ["favicon.svg", "robots.txt"] }),
	{ owner: "static-file", detail: "public/robots.txt", hostVersion: "1.1.0", emdashSiteUrl: null },
);
assert.equal(classifyRobotsInstallation({ ...facts, publicFiles: ["ROBOTS.TXT"] }).owner, "static-file");
assert.deepEqual(
	classifyRobotsInstallation({ ...facts, pageEntries: [{ name: "robots.txt.ts", directory: false }], publicFiles: ["robots.txt"] }),
	{ owner: "static-file", detail: "public/robots.txt", hostVersion: "1.1.0", emdashSiteUrl: null },
	"the public file answers before a site page",
);
assert.equal(classifyRobotsInstallation({ ...facts, publicFiles: ["robots.txt.bak"] }).owner, "unsettled");
assert.deepEqual(classifyRobotsInstallation({ ...facts, integrations: ["astro-robots-txt"] }).detail, "astro-robots-txt");
assert.equal(classifyRobotsInstallation({ ...facts, base: "/docs" }).owner, "unsupported-routing");
assert.equal(classifyRobotsInstallation({ ...facts, base: "" }).owner, "unsettled");

// Resolved routes in Astro's precedence order.
const core: RobotsResolvedRoute = { pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "node_modules/emdash/dist/astro/routes/robots.txt.mjs" };
const other: RobotsResolvedRoute = { pattern: "/robots.txt", patternRegex: /^\/robots\.txt$/, entrypoint: "node_modules/astro-robots/route.ts" };
const dynamic: RobotsResolvedRoute = { pattern: "/[file].txt", patternRegex: /^\/([^/]+?)\.txt$/, entrypoint: "src/pages/[file].txt.ts" };
const isCore = (route: RobotsResolvedRoute) => route.entrypoint?.includes("node_modules/emdash/") === true;
assert.deepEqual(robotsRouteFact([core, dynamic], isCore), { winner: "core" });
assert.deepEqual(robotsRouteFact([dynamic, core], isCore), { winner: "other", detail: "/[file].txt answers /robots.txt" });
assert.deepEqual(robotsRouteFact([core, other], isCore), { winner: "other", detail: "/robots.txt is defined twice" },
	"dev and production break this tie differently");
assert.deepEqual(robotsRouteFact([{ ...other, entrypoint: undefined }, core], isCore).winner, "other");
assert.deepEqual(robotsRouteFact([dynamic], isCore).winner, "other");
assert.deepEqual(robotsRouteFact([], isCore), { winner: "none" });

const classified = classifyRobotsInstallation(facts);
assert.deepEqual(settleRobotsInstallation(classified, { winner: "core" }), { ...classified, owner: "emdash-core", detail: null });
assert.deepEqual(settleRobotsInstallation(classified, null), classified, "missing route evidence stays unsettled");
assert.deepEqual(settleRobotsInstallation(classified, { winner: "other", detail: "x" }), { ...classified, owner: "competing-route", detail: "x" });
assert.equal(settleRobotsInstallation(classified, { winner: "none" }).owner, "not-served");
const staticFile = classifyRobotsInstallation({ ...facts, publicFiles: ["robots.txt"] });
assert.deepEqual(settleRobotsInstallation(staticFile, { winner: "core" }), staticFile, "a public file keeps the file");
const unreadable = classifyRobotsInstallation({ ...facts, inspectionError: "public could not be read (EACCES)" });
assert.equal(unreadable.owner, "unknown");
assert.deepEqual(settleRobotsInstallation(unreadable, { winner: "core" }), unreadable, "a core route cannot clear an unresolved filesystem owner");
assert.equal(classifyRobotsInstallation({ ...facts, inspectionError: "src/pages could not be read (EACCES)", publicFiles: ["robots.txt"] }).owner, "static-file");
assert.deepEqual(validRobotsInstallation(JSON.parse(JSON.stringify(unreadable))), unreadable);

// Serialized options are checked strictly.
assert.deepEqual(validRobotsInstallation(classified), classified);
assert.equal(validRobotsInstallation({ ...classified, owner: "shipit" }), null);
assert.equal(validRobotsInstallation({ ...classified, detail: undefined }), null);
assert.equal(validRobotsInstallation({ ...classified, detail: "x".repeat(301) }), null);
assert.equal(validRobotsInstallation({ ...classified, hostVersion: 1 }), null);
assert.equal(validRobotsInstallation({ ...classified, emdashSiteUrl: "https://example.com/" }), null, "only an origin");
assert.deepEqual(validRobotsInstallation({ ...classified, emdashSiteUrl: "https://example.com" })?.emdashSiteUrl, "https://example.com");
assert.equal(validRobotsInstallation([]), null);
assert.equal(emdashSiteUrlOrigin("https://example.com/path/"), "https://example.com");
assert.equal(emdashSiteUrlOrigin("mailto:a@example.com"), null);
assert.equal(emdashSiteUrlOrigin(undefined), null);

console.log("robots-installation selfcheck passed");
