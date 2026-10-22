import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as ts from "typescript";
import { SEO_SCORE_VERSION, analyzeSeoContent } from "./analysis.ts";
import { entryCanonicalValidation, isStoredScoreCurrent, isStoredScoreUsable } from "./entry-analysis-runtime.ts";
import { isHttpUrl } from "./lib.ts";
import { normalizeSeoSitemapPath, validateSeoCanonical, type SeoCanonicalStatus } from "./sitemap-policy.ts";

const assessment = analyzeSeoContent({
	ref: "pages:runtime-example", collection: "pages", entryId: "runtime-example", slug: "runtime-example",
	title: "Saved example title", description: "Saved example description.", url: "https://example.test/runtime-example",
	body: "", document: [], image: "https://example.test/social.png", noindex: false, schemaEnabled: false, schemaPreset: "",
	assessmentProfile: { profile: "general", version: 1 },
});
const record = { ...assessment, analysisRevision: 1, configurationFingerprint: "fixture-configuration", updatedAt: "2026-10-16T12:00:00.000Z" };
assert.equal(isStoredScoreCurrent(record), true);
assert.equal(isStoredScoreUsable(record), true);
for (const corrupted of [
	{ ...record, checks: [] },
	{ ...record, checks: [...record.checks, record.checks[0]] },
	{ ...record, checks: record.checks.filter((check) => check.id !== "description") },
	{ ...record, score: record.score === 100 ? 99 : record.score + 1 },
	{ ...record, grade: "excellent" },
	{ ...record, status: record.status === "pass" ? "fail" : "pass" },
	{ ...record, calculation: { ...record.calculation, totalWeight: record.calculation.totalWeight + 1 } },
	{ ...record, coverage: { ...record.coverage, evaluated: record.coverage.evaluated + 1 } },
]) {
	assert.equal(isStoredScoreCurrent(corrupted), false);
	assert.equal(isStoredScoreUsable(corrupted), false, "current malformed records cannot enter via the readable branch");
}
assert.equal(isStoredScoreCurrent({ ...record, analysisRevision: 0 }), false, "the existing analysis revision fence stays in force");
assert.equal(isStoredScoreCurrent(record, false), false, "unavailable current configuration cannot admit a score");
const legacy = {
	...record, scoreVersion: SEO_SCORE_VERSION - 1, grade: "excellent", status: "pass", score: 100,
	calculation: undefined, coverage: undefined,
	checks: record.checks.map((check) => {
		const { basis: _basis, limitation: _limitation, condition: _condition, ...old } = check;
		return old.id === "title" ? { ...old, evidence: { ...old.evidence, actual: "Old stored title" } } : old;
	}),
};
assert.equal(isStoredScoreUsable(legacy), true, "older retained rows remain readable without current aggregate fields");
assert.equal(isStoredScoreCurrent(legacy), false);

// Read the actual private adapter declaration without adding a public export.
const source = await readFile(new URL("./entry-analysis-runtime.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("entry-analysis-runtime.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = parsed.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "scoringCanonicalStatus");
assert.ok(declaration);
const compiled = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const canonicalStatus = new Function("isHttpUrl", "normalizeSeoSitemapPath", "validateSeoCanonical", compiled + "\nreturn scoringCanonicalStatus;")(
	isHttpUrl, normalizeSeoSitemapPath, validateSeoCanonical,
) as (canonical: string, publicUrl: string, siteUrl: string) => SeoCanonicalStatus | undefined;
assert.match(source, /const canonicalStatus = scoringCanonicalStatus\(url, publicUrl, global\.siteUrl \|\| ctx\.site\?\.url \|\| ""\);/);
assert.match(source, /\.\.\.\(canonicalStatus === undefined \? \{\} : \{ canonicalStatus \}\)/);
const cases: readonly [string, string, string, SeoCanonicalStatus | undefined][] = [
	["https://example.test/posts/entry", "", "https://example.test", undefined],
	["https://example.test/posts/entry", "", "", undefined],
	["/posts/entry", "/posts/entry", "", undefined],
	["/posts/entry", "/posts/entry", "broken", undefined],
	["https://example.test/posts/entry", "not-an-observed-root-path", "https://example.test", undefined],
	["/posts/entry", "//other.test/posts/entry", "https://example.test", undefined],
	["/posts/entry", "/bad%ZZ", "https://example.test", undefined],
	["", "/posts/entry", "https://example.test", undefined],
	["/", "/", "https://example.test", "matches"],
	["/posts/entry", "https://example.test/posts/entry", "", "matches"],
	["/posts/entry", "https://example.test/posts/entry", "broken", "matches"],
	["/posts/entry?view=1", "/posts/entry", "https://example.test", "query-or-fragment"],
	["https://other.test/posts/entry?view=1", "/posts/entry", "https://example.test", "off-origin"],
	["https://example.test/preferred?view=1", "/posts/entry", "https://example.test", "different-path"],
	["https://example.test/posts/entry#section", "/posts/entry", "https://example.test", "query-or-fragment"],
	["ftp://example.test/posts/entry", "/posts/entry", "https://example.test", "invalid"],
];
for (const [canonical, publicUrl, siteUrl, expected] of cases) {
	assert.equal(canonicalStatus(canonical, publicUrl, siteUrl), expected, JSON.stringify({ canonical, publicUrl, siteUrl }));
}
const input = {
	ref: "pages:canonical-example", collection: "pages", entryId: "canonical-example", slug: "canonical-example",
	title: "Saved title", description: "Saved description.", body: "", document: [],
	image: "https://example.test/social.png", noindex: false, schemaEnabled: false, schemaPreset: "", assessmentProfile: { profile: "general" as const, version: 1 as const },
};
const checked = (url: string, route: string, site: string) => analyzeSeoContent({
	...input, url, canonicalStatus: canonicalStatus(url, route, site),
});
const independentAbsolute = checked("https://example.test/posts/entry", "", "");
assert.equal(independentAbsolute.checks.find((check) => check.id === "url")?.status, "pass",
	"absolute syntax remains measurable without claiming canonical comparison context");
const unbasedRelative = checked("/posts/entry", "/posts/entry", "");
assert.equal(unbasedRelative.checks.find((check) => check.id === "url")?.basis, "unavailable");
assert.equal(unbasedRelative.checks.find((check) => check.id === "url")?.weight, 0);
const queryPreference = checked("https://other.test/preferred?view=1", "/posts/entry", "https://example.test");
assert.equal(queryPreference.checks.find((check) => check.id === "url")?.status, "pass");
assert.equal(queryPreference.checks.find((check) => check.id === "canonical-policy-review")?.weight, 0);
assert.equal(queryPreference.checks.find((check) => check.id === "canonical-policy-review")?.status, "review");
const fragment = checked("https://example.test/posts/entry#section", "/posts/entry", "https://example.test");
assert.equal(fragment.checks.find((check) => check.id === "url")?.status, "fail");
assert.equal(entryCanonicalValidation("https://other.test/preferred?view=1", "https://example.test/posts/entry", "https://example.test").status,
	"query-or-fragment", "the existing public preview/sitemap validation contract is unchanged");
console.log("Entry analysis: strict current admission, readable legacy and canonical comparison context passed.");
