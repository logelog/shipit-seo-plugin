import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import { Badge } from "@cloudflare/kumo/components/badge";
import type { SeoAdminScoreTrends } from "../admin-contract.ts";

const source = readFileSync(new URL("./trends-view.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("trends-view.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
function declaration(name: string) {
	const found = parsed.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
	assert.ok(found, name);
	return found.getText(parsed);
}
const compiled = ts.transpileModule([
	"collectionLabel", "readableDate", "directionCopy", "DirectionIcon", "deltaLabel", "countLabel", "Summary", "ComparisonCoverage", "RecentChanges",
].map(declaration).join("\n") + "\nmodule.exports = { Summary, ComparisonCoverage, RecentChanges };", {
	fileName: "trends-view.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} };
const badgeVariants: unknown[] = [];
function ObservedBadge(props: React.ComponentProps<typeof Badge>) {
	badgeVariants.push(props.variant);
	return React.createElement(Badge, props);
}
new Function("require", "module", "exports", "React", "Badge", "TrendUp", "TrendDown", "Minus", "ArrowSquareOut", "contentEditorUrl", compiled.outputText)(
	createRequire(import.meta.resolve("react")), output, output.exports, React, ObservedBadge, icons.TrendUp, icons.TrendDown, icons.Minus, icons.ArrowSquareOut,
	(collection: string, entryId: string) => `/_emdash/admin/content/${collection}/${entryId}`,
);
const components = output.exports as Record<"Summary" | "ComparisonCoverage" | "RecentChanges", React.ComponentType<{ data: SeoAdminScoreTrends }>>;
const data = {
	summary: { snapshotCount: 7, trackedEntries: 5, currentAverage: 47, openIssues: 3 },
	comparison: {
		policy: "same-ref-window-v1", range: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-16T00:00:00.000Z" },
		observedEntries: 5, pairedEntries: 2, singleSampleEntries: 1, excludedEntries: 2,
		exclusions: { missingContext: 1, invalidContext: 0, changedProfile: 1, ambiguousTime: 0 },
		scopeChangedPairs: 1, baselineAverage: 80, currentAverage: 80, scoreDelta: 0, direction: "stable",
		openedIssues: 1, resolvedIssues: 1, improvedEntries: 1, declinedEntries: 1, unchangedEntries: 0,
	},
	changes: { total: 2, hasMore: false, items: [{
		ref: "posts:a", collection: "posts", entryId: "a", title: "Saved example", previousSnapshotId: "old", currentSnapshotId: "new",
		previousCapturedAt: "2026-09-30T12:00:00.000Z", capturedAt: "2026-10-15T12:00:00.000Z", baselineBasis: "before-window", scopeChanged: true,
		previousScore: 70, currentScore: 90, delta: 20, openedIssues: 0, resolvedIssues: 1,
	}, {
		ref: "posts:b", collection: "posts", entryId: "b", title: "Second saved example", previousSnapshotId: "b-old", currentSnapshotId: "b-new",
		previousCapturedAt: "2026-10-02T12:00:00.000Z", capturedAt: "2026-10-14T12:00:00.000Z", baselineBasis: "first-in-window", scopeChanged: false,
		previousScore: 90, currentScore: 70, delta: -20, openedIssues: 1, resolvedIssues: 0,
	}] },
} as SeoAdminScoreTrends;
function render(name: keyof typeof components, value = data) {
	return renderToStaticMarkup(React.createElement(components[name], { data: value }));
}
const summary = render("Summary");
assert.match(summary, /Latest retained average<\/dt><dd>47/);
assert.match(summary, /Paired score change/);
assert.match(summary, /Paired average unchanged/);
assert.doesNotMatch(summary, /Collecting history|>Improved</);
const coverage = render("ComparisonCoverage");
assert.match(coverage, /2 paired entries of 5 observed/);
assert.match(coverage, /1 single-sample; 2 excluded/);
assert.match(coverage, /Paired average: 80 to 80/);
assert.match(coverage, /1 pair has changed check coverage/);
assert.match(coverage, /1 missing context, 1 changed profile/);
const changes = render("RecentChanges");
assert.match(changes, /70 → 90/);
assert.match(changes, /Before-window baseline/);
assert.match(changes, /Check coverage changed/);
assert.deepEqual(badgeVariants, ["secondary", "secondary"], "historical numeric snapshots have neutral badges");
const capped = { ...data, comparison: { ...data.comparison, observedEntries: 24, pairedEntries: 21, improvedEntries: 20, declinedEntries: 1, unchangedEntries: 0 },
	changes: { total: 21, hasMore: true, items: Array.from({ length: 20 }, (_, index) => ({ ...data.changes.items[0]!, ref: `posts:${index}`, entryId: String(index) })) },
};
assert.match(render("RecentChanges", capped), /Showing 20 of 21 changed entries/);
const unchanged = { ...data, changes: { items: [], total: 0, hasMore: false } };
assert.match(render("RecentChanges", unchanged), /No score or issue changes in comparable saved pairs/);
const empty = { ...data, comparison: { ...data.comparison, pairedEntries: 0, baselineAverage: null, currentAverage: null, scoreDelta: null,
	direction: "insufficient-data", openedIssues: null, resolvedIssues: null, improvedEntries: 0, declinedEntries: 0, unchangedEntries: 0 },
	changes: { items: [], total: 0, hasMore: false },
} as SeoAdminScoreTrends;
assert.match(render("Summary", empty), /No comparable pairs/);
assert.match(render("Summary", empty), /Resolved in pairs<\/dt><dd>--/);
assert.match(render("RecentChanges", empty), /No comparable saved pairs/);
assert.doesNotMatch(source, /averageScore >=|scoreBadgeVariant\(/);
console.log("SEO trend presentation self-checks passed.");
