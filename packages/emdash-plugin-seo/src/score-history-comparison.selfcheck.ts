import assert from "node:assert/strict";
import { analyzeSeoContent, SEO_SCORE_COMPARISON_POLICY, SEO_SCORE_VERSION, seoScoredCheckMask, classifySeoContentCheck } from "./analysis.ts";
import type { SeoAdminContentScore, SeoAdminScoreSnapshot, SeoScoreComparisonContext } from "./admin-contract.ts";
import { createScoreComparisonContext, scoreComparisonContextProblem } from "./score-history-comparison.ts";
import { buildScoreTrends, createScoreSnapshot, isScoreSnapshot, scoreSnapshotFingerprint } from "./score-history.ts";

let cases = 0;
function check(name: string, run: () => void): void {
	run();
	cases += 1;
	console.log(`  PASS  ${name}`);
}

const now = new Date("2026-07-15T12:00:00.000Z");
const context: SeoScoreComparisonContext = {
	version: 1, policy: SEO_SCORE_COMPARISON_POLICY, assessmentProfile: { version: 1, profile: "article" }, eligibleMask: 3,
};

/** Projection fixtures are stored observations; analyzer arithmetic is tested separately. */
function snapshot(ref: string, score: number, capturedAt: string, extra: Partial<SeoAdminScoreSnapshot> = {}): SeoAdminScoreSnapshot {
	const [collection, entryId] = ref.split(":");
	return {
		id: `${ref}:${capturedAt}:${score}`,
		storageVersion: 1,
		fingerprint: "projection-fixture",
		ref, collection, entryId, title: entryId, score,
		grade: score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 55 ? "needs-work" : "poor",
		scoreVersion: SEO_SCORE_VERSION,
		sourceUpdatedAt: capturedAt,
		templateUpdatedAt: null,
		capturedAt,
		issues: [],
		comparisonContext: structuredClone(context),
		...extra,
	};
}
function issue(id: string) {
	return { id, label: id, category: "metadata" as const, severity: "medium" as const, status: "review" as const, weight: 14 };
}
function trends(items: SeoAdminScoreSnapshot[], days = 7) {
	const before = structuredClone(items);
	const result = buildScoreTrends(items, { now, days });
	assert.deepEqual(items, before, "projection must not mutate input snapshots or raw context");
	assert.equal(result.comparison.observedEntries, result.comparison.pairedEntries + result.comparison.singleSampleEntries + result.comparison.excludedEntries);
	assert.equal(Object.values(result.comparison.exclusions).reduce((sum, count) => sum + count, 0), result.comparison.excludedEntries);
	assert.equal(result.comparison.improvedEntries + result.comparison.declinedEntries + result.comparison.unchangedEntries, result.comparison.pairedEntries);
	assert.equal(result.changes.hasMore, result.changes.total > result.changes.items.length);
	return result;
}
function pair(ref: string, previous: number, current: number) {
	return [snapshot(ref, previous, "2026-07-10T09:00:00.000Z"), snapshot(ref, current, "2026-07-14T09:00:00.000Z")];
}
function analyzedScore(): SeoAdminContentScore {
	return {
		...analyzeSeoContent({
			ref: "posts:private", collection: "posts", entryId: "private",
			title: "Private title sentinel", description: "Private description sentinel", url: "https://example.com/private",
			body: "A private body is saved for this focused fixture.", noindex: false, schemaEnabled: false, schemaPreset: "",
			assessmentProfile: { version: 1, profile: "article" },
		}),
		analysisRevision: 1,
		assessmentProfileRevision: "fixture-profile",
		updatedAt: "2026-07-14T09:00:00.000Z",
		templateUpdatedAt: null, modulesUpdatedAt: null,
		configurationFingerprint: "fixture", metaOverrideUpdatedAt: null,
	};
}

check("fresh context uses the real shared classifier and stays bounded/private", () => {
	const score = analyzedScore();
	const saved = createScoreSnapshot(score);
	assert.deepEqual(saved.comparisonContext, createScoreComparisonContext(score));
	assert.equal(scoreComparisonContextProblem(saved.comparisonContext), null);
	assert.equal((saved.comparisonContext as SeoScoreComparisonContext).eligibleMask, seoScoredCheckMask(score.checks));
	const serialized = JSON.stringify(saved.comparisonContext);
	assert.ok(Buffer.byteLength(serialized, "utf8") <= 256);
	assert.equal(serialized.includes("sentinel"), false);
	assert.equal(serialized.includes("https://"), false);
	assert.deepEqual(saved.issues.map((item) => item.id), score.checks.filter((item) => classifySeoContentCheck(item).issue).map((item) => item.id).sort());
});

check("legacy writers, including analyzer21, do not gain current context or reclassify legacy issues", () => {
	assert.equal(SEO_SCORE_VERSION, 24);
	assert.equal(SEO_SCORE_COMPARISON_POLICY, "seo24-scored-v1");
	assert.equal(scoreComparisonContextProblem({ ...context, policy: "seo21-scored-v1" }), "invalidContext");
	for (const scoreVersion of [19, 21]) {
		const score = { ...analyzedScore(), scoreVersion };
		const saved = createScoreSnapshot(score);
		assert.equal(Object.hasOwn(saved, "comparisonContext"), false);
		assert.equal(isScoreSnapshot(saved.id, saved), true);
		assert.deepEqual(saved.issues.map((item) => item.id), score.checks.filter((item) => item.weight > 0 && item.status !== "pass").map((item) => item.id).sort());
	}
});

check("context participates in new snapshot dedup without storing raw check arrays", () => {
	const score = analyzedScore();
	assert.notEqual(scoreSnapshotFingerprint(score), scoreSnapshotFingerprint({ ...score, assessmentProfile: undefined }));
	assert.throws(() => scoreSnapshotFingerprint({ ...score, assessmentProfile: { version: 1, profile: "general" } }), /Invalid current check/,
		"article rows relabelled as general are not current evidence");
	const invalid = { ...score, checks: [{ ...score.checks[0], weight: 999 }] };
	assert.equal(createScoreComparisonContext(invalid), undefined);
	assert.throws(() => createScoreSnapshot(invalid), /Invalid current check/, "invalid current evidence must not be normalized into history");
});

check("two equal qualified samples are stable with no change rows", () => {
	const result = trends(pair("posts:a", 60, 60));
	assert.equal(result.comparison.pairedEntries, 1);
	assert.equal(result.comparison.scoreDelta, 0);
	assert.equal(result.comparison.direction, "stable");
	assert.equal(result.comparison.openedIssues, 0);
	assert.equal(result.comparison.resolvedIssues, 0);
	assert.equal(result.comparison.unchangedEntries, 1);
	assert.equal(result.changes.total, 0);
});

check("new high singleton does not create improvement or veto an existing pair", () => {
	const items = pair("posts:a", 60, 60);
	items.push(snapshot("posts:b", 100, "2026-07-14T10:00:00.000Z", { issues: [issue("description")] }));
	const result = trends(items);
	assert.equal(result.summary.currentAverage, 80);
	assert.equal(result.comparison.currentAverage, 60);
	assert.equal(result.comparison.scoreDelta, 0);
	assert.equal(result.comparison.direction, "stable");
	assert.equal(result.comparison.singleSampleEntries, 1);
	assert.equal(result.comparison.openedIssues, 0);
});

check("a first current sample after legacy stays insufficient and raw legacy remains", () => {
	const result = trends([
		snapshot("posts:a", 10, "2026-07-10T09:00:00.000Z", { scoreVersion: 19, comparisonContext: undefined, issues: [issue("legacy")] }),
		snapshot("posts:a", 90, "2026-07-14T09:00:00.000Z"),
	]);
	assert.equal(result.summary.snapshotCount, 2);
	assert.equal(result.items.length, 2);
	assert.equal(result.summary.currentAverage, 90);
	assert.equal(result.summary.openIssues, 0);
	assert.equal(result.comparison.singleSampleEntries, 1);
	assert.equal(result.comparison.direction, "insufficient-data");
	for (const field of ["baselineAverage", "currentAverage", "scoreDelta", "openedIssues", "resolvedIssues"] as const) assert.equal(result.comparison[field], null);
});

check("a sole missing-context observation is a single sample, not an excluded pair", () => {
	const result = trends([snapshot("posts:a", 60, "2026-07-14T09:00:00.000Z", { comparisonContext: undefined })]);
	assert.equal(result.comparison.singleSampleEntries, 1);
	assert.equal(result.comparison.excludedEntries, 0);
	assert.equal(result.comparison.exclusions.missingContext, 0);
	assert.equal(result.comparison.direction, "insufficient-data");
	assert.equal(result.summary.snapshotCount, 1);
	assert.equal(result.items.length, 1);
});

check("a sole malformed-context observation is a single sample and remains raw", () => {
	const item = snapshot("posts:a", 60, "2026-07-14T09:00:00.000Z", { comparisonContext: { invalid: "raw context" } });
	const result = trends([item]);
	assert.equal(result.comparison.singleSampleEntries, 1);
	assert.equal(result.comparison.excludedEntries, 0);
	assert.equal(result.comparison.exclusions.invalidContext, 0);
	assert.equal(result.comparison.scoreDelta, null);
	assert.deepEqual(result.items, [item]);
});

check("a later legacy record never shadows current observational state or points", () => {
	const result = trends([
		snapshot("posts:a", 60, "2026-07-14T09:00:00.000Z"),
		snapshot("posts:a", 99, "2026-07-15T09:00:00.000Z", { scoreVersion: 19, issues: [issue("legacy")] }),
	]);
	assert.equal(result.summary.currentAverage, 60);
	assert.equal(result.points.at(-1)?.averageScore, 60);
	assert.equal(result.topIssues.length, 0);
});

check("window-first baseline drives summary and list instead of latest two", () => {
	const result = trends([
		snapshot("posts:a", 40, "2026-07-10T09:00:00.000Z"),
		snapshot("posts:a", 90, "2026-07-12T09:00:00.000Z"),
		snapshot("posts:a", 60, "2026-07-14T09:00:00.000Z"),
	]);
	assert.equal(result.comparison.scoreDelta, 20);
	assert.equal(result.changes.items[0]?.delta, 20);
	assert.equal(result.changes.items[0]?.baselineBasis, "first-in-window");
	assert.equal(result.changes.items[0]?.previousCapturedAt, "2026-07-10T09:00:00.000Z");
});

check("latest before-window baseline and actual endpoint IDs are preserved", () => {
	const items = [snapshot("posts:a", 90, "2026-07-07T09:00:00.000Z"), snapshot("posts:a", 80, "2026-07-08T09:00:00.000Z"), ...pair("posts:a", 40, 60)];
	const result = trends(items);
	assert.equal(result.comparison.scoreDelta, -20);
	assert.equal(result.changes.items[0]?.baselineBasis, "before-window");
	assert.equal(result.changes.items[0]?.previousSnapshotId, items[1].id);
	assert.equal(result.changes.items[0]?.currentSnapshotId, items[3].id);
	assert.equal(result.comparison.range.start, "2026-07-09T00:00:00.000Z");
	assert.equal(result.comparison.range.end, now.toISOString());
});

check("issue changes use same-ref set differences even with an unchanged score", () => {
	const items = pair("posts:a", 60, 60);
	items[0].issues = [issue("title")];
	items[1].issues = [issue("description")];
	const result = trends(items);
	assert.equal(result.comparison.openedIssues, 1);
	assert.equal(result.comparison.resolvedIssues, 1);
	assert.equal(result.comparison.unchangedEntries, 1);
	assert.equal(result.changes.total, 1);
});

check("ordinary scoring membership changes qualify instead of being excluded", () => {
	const items = pair("posts:a", 60, 80);
	items[1].comparisonContext = { ...context, eligibleMask: 7 };
	items[1].configurationFingerprint = "changed-keyword-pillar-template-settings";
	const result = trends(items);
	assert.equal(result.comparison.pairedEntries, 1);
	assert.equal(result.comparison.excludedEntries, 0);
	assert.equal(result.comparison.scopeChangedPairs, 1);
	assert.equal(result.comparison.scoreDelta, 20);
	assert.equal(result.changes.items[0]?.scopeChanged, true);
});

check("scope-only changes stay diagnostic without inventing a score/issue row", () => {
	const items = pair("posts:a", 60, 60);
	items[1].comparisonContext = { ...context, eligibleMask: 7 };
	const result = trends(items);
	assert.equal(result.comparison.scopeChangedPairs, 1);
	assert.equal(result.comparison.direction, "stable");
	assert.equal(result.changes.total, 0);
});

check("missing selected context has no matching-context or in-range fallback", () => {
	const items = [snapshot("posts:a", 10, "2026-07-08T09:00:00.000Z", { comparisonContext: undefined }), ...pair("posts:a", 60, 80)];
	const result = trends(items);
	assert.equal(result.comparison.pairedEntries, 0);
	assert.equal(result.comparison.exclusions.missingContext, 1);
	assert.equal(result.summary.snapshotCount, 2);
	assert.equal(isScoreSnapshot(items[0].id, items[0]), true);
});

check("compact context accepts only the exact bounded shape", () => {
	assert.equal(scoreComparisonContextProblem({ ...context, eligibleMask: 3 }), null);
	assert.equal(scoreComparisonContextProblem({ ...context, eligibleMask: 7 }), null);
	assert.equal(scoreComparisonContextProblem({ ...context, eligibleMask: 16_383 }), null);
	assert.equal(scoreComparisonContextProblem({ ...context, policy: "seo20-scored-v1" }), "invalidContext");
	assert.equal(scoreComparisonContextProblem(undefined), "missingContext");
	assert.equal(scoreComparisonContextProblem({ ...context, assessmentProfile: { ...context.assessmentProfile, private: "extra" } }), "invalidContext");
});

const invalidContexts: unknown[] = [null, "invalid", {}, ...[0, 1, 2, 4, 5, 6].map((eligibleMask) => ({ ...context, eligibleMask })), { ...context, version: 2 }, { ...context, policy: "unknown" }, { ...context, eligibleMask: -1 }, { ...context, eligibleMask: 16_384 }, { ...context, eligibleMask: 1.5 }, { ...context, eligibleMask: NaN }, { ...context, eligibleMask: Infinity }, { ...context, eligibleMask: "1" }, { ...context, eligibleMask: true }, { ...context, extra: "do not retain this as qualified context" }, { ...context, assessmentProfile: { version: 1, profile: "unknown" } }];
for (const [index, value] of invalidContexts.entries()) check(`malformed optional context${index} remains raw but cannot qualify`, () => {
	const items = pair("posts:a", 60, 80);
	items[0].comparisonContext = value;
	assert.equal(isScoreSnapshot(items[0].id, items[0]), true);
	const result = trends(items);
	assert.equal(result.summary.snapshotCount, 2);
	assert.equal(result.items.length, 2);
	assert.equal(result.comparison.exclusions.invalidContext, 1);
	assert.equal(result.comparison.pairedEntries, 0);
});

check("profile mismatch is excluded without erasing a different ref's comparison", () => {
	const bad = pair("posts:changed", 50, 100);
	bad[1].comparisonContext = { ...context, assessmentProfile: { version: 1, profile: "general" } };
	const result = trends([...bad, ...pair("posts:good", 60, 70)]);
	assert.equal(result.comparison.exclusions.changedProfile, 1);
	assert.equal(result.comparison.pairedEntries, 1);
	assert.equal(result.comparison.scoreDelta, 10);
	assert.equal(result.comparison.direction, "improved");
});

check("equal-time selected current endpoints are ambiguous despite different IDs", () => {
	const items = pair("posts:a", 60, 80);
	items.push({ ...items[1], id: "different-id", score: 90 });
	const result = trends(items);
	assert.equal(result.comparison.exclusions.ambiguousTime, 1);
	assert.equal(result.comparison.pairedEntries, 0);
});

check("equal-time selected prewindow baselines are ambiguous", () => {
	const before = snapshot("posts:a", 60, "2026-07-08T09:00:00.000Z");
	const result = trends([before, { ...before, id: "other-before", score: 70 }, snapshot("posts:a", 80, "2026-07-14T09:00:00.000Z")]);
	assert.equal(result.comparison.exclusions.ambiguousTime, 1);
});

check("an irrelevant intermediate timestamp tie does not change selected endpoints", () => {
	const middle = snapshot("posts:a", 20, "2026-07-12T09:00:00.000Z");
	const result = trends([...pair("posts:a", 60, 80), middle, { ...middle, id: "other-middle", score: 30 }]);
	assert.equal(result.comparison.pairedEntries, 1);
	assert.equal(result.comparison.scoreDelta, 20);
});

check("all pair counts are computed before the20-row list cap", () => {
	const items = Array.from({ length: 30 }, (_, index) => {
		const samples = pair(`posts:${index}`, 60, 70);
		samples[1].issues = [issue("description")];
		return samples;
	}).flat();
	const result = trends(items);
	assert.equal(result.comparison.pairedEntries, 30);
	assert.equal(result.comparison.improvedEntries, 30);
	assert.equal(result.comparison.openedIssues, 30);
	assert.equal(result.changes.total, 30);
	assert.equal(result.changes.items.length, 20);
	assert.equal(result.changes.hasMore, true);
});

check("rounded stable mean can coexist with one exact per-entry improvement", () => {
	const result = trends([...pair("posts:a", 50, 51), ...pair("posts:b", 50, 50), ...pair("posts:c", 50, 50)]);
	assert.equal(result.comparison.baselineAverage, 50);
	assert.equal(result.comparison.currentAverage, 50);
	assert.equal(result.comparison.scoreDelta, 0);
	assert.equal(result.comparison.direction, "stable");
	assert.equal(result.comparison.improvedEntries, 1);
	assert.equal(result.comparison.unchangedEntries, 2);
});

check("all-generation raw ordering/count/cap stay independent of derived20 state", () => {
	const items = Array.from({ length: 130 }, (_, index) => snapshot(`posts:${index}`, index % 101, new Date(Date.UTC(2026, 6, 10, 0, index)).toISOString(), { scoreVersion: index % 2 ? 19 : SEO_SCORE_VERSION, comparisonContext: index % 3 ? context : "invalid raw context" }));
	const result = trends(items);
	const expected = [...items].sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt)).slice(0, 100);
	assert.equal(result.summary.snapshotCount, 130);
	assert.deepEqual(result.items, expected);
	assert.equal(result.summary.trackedEntries, 65);
});

check("future and out-of-scope snapshots do not enter the selected cohort", () => {
	const items = [...pair("posts:a", 60, 70), snapshot("posts:a", 100, "2026-07-16T09:00:00.000Z"), ...pair("pages:b", 10, 100)];
	const result = buildScoreTrends(items, { now, days: 7, collection: "posts", ref: "posts:a" });
	assert.equal(result.summary.snapshotCount, 2);
	assert.equal(result.comparison.observedEntries, 1);
	assert.equal(result.comparison.scoreDelta, 10);
});

check("a result without a shown number gets no comparison context and marks its snapshot unscored", () => {
	const template: SeoAdminContentScore = {
		...analyzedScore(),
		...analyzeSeoContent({
			ref: "posts:private", collection: "posts", entryId: "private",
			title: "Private title sentinel", description: "Private description sentinel", url: "https://example.com/private",
			body: "", document: undefined, bodySource: "template", noindex: false, schemaEnabled: false, schemaPreset: "",
			assessmentProfile: { version: 1, profile: "article" },
		}),
	};
	assert.equal(createScoreComparisonContext(template), undefined);
	const saved = createScoreSnapshot(template);
	assert.equal(saved.unscored, "partially-checked");
	assert.equal(Object.hasOwn(saved, "comparisonContext"), false);
	assert.equal(isScoreSnapshot(saved.id, saved), true);
	assert.notEqual(scoreSnapshotFingerprint(template), scoreSnapshotFingerprint({ ...template, checks: analyzedScore().checks, score: analyzedScore().score }));
	assert.equal(isScoreSnapshot(saved.id, { ...saved, unscored: "hidden" }), false);
});

check("a dashed latest snapshot replaces an earlier number but stays out of averages and pairs", () => {
	const result = trends([
		snapshot("posts:a", 60, "2026-07-10T09:00:00.000Z"),
		snapshot("posts:a", 100, "2026-07-14T09:00:00.000Z", { comparisonContext: undefined, unscored: "too-little-text", issues: [issue("description")] }),
		snapshot("posts:b", 80, "2026-07-14T09:00:00.000Z"),
	]);
	assert.equal(result.summary.currentAverage, 80);
	assert.equal(result.summary.trackedEntries, 1);
	assert.equal(result.summary.openIssues, 0);
	assert.equal(result.points.at(-1)?.averageScore, 80);
	assert.equal(result.points.at(-1)?.trackedEntries, 1);
	assert.equal(result.points.at(-1)?.reviewIssues, 0);
	assert.equal(result.comparison.pairedEntries, 0);
	assert.equal(result.comparison.exclusions.missingContext, 1);
	assert.equal(result.items.length, 3);
});

console.log(`shipit-seo score history comparison self-check passed (${cases} cases)`);
