import assert from "node:assert/strict";
import { analyzeSeoContent, seoAnalysisPresentation, summarizeSeoChecks, type SeoAnalysisInput } from "../analysis.ts";
import {
	SEO_ADMIN_CONTRACT_VERSION, SEO_ENGINE_VERSION, SEO_SCORE_VERSION,
	type SeoAdminContentScore, type SeoAdminScoreSnapshot,
} from "../admin-contract.ts";
import { buildScoreTrends, createScoreSnapshot } from "../score-history.ts";
import { parseSeoAdminContentAudit, parseSeoAdminContentScores, parseSeoAdminOverview, parseSeoAdminScoreTrends } from "./contract.ts";

let cases = 0;
function check(name: string, run: () => void): void {
	run();
	cases += 1;
	console.log("  PASS  " + name);
}

const input: SeoAnalysisInput = {
	ref: "posts:score-contract", collection: "posts", entryId: "score-contract", slug: "useful-post",
	title: "A useful post", description: "A useful post explains the practical steps and links to related guidance.",
	url: "https://example.com/useful-post", canonicalStatus: "matches",
	image: "https://example.com/social.jpg", noindex: false,
	body: "A useful post explains the steps. Read the related guidance and compare the examples.",
	document: [
		{ _type: "block", style: "normal", markDefs: [{ _key: "guide", _type: "link", href: "/guidance" }], children: [
			{ _type: "span", text: "A useful post explains the practical steps. Read the ", marks: [] },
			{ _type: "span", text: "related guidance", marks: ["guide"] },
			{ _type: "span", text: " and compare the examples before choosing your next step.", marks: [] },
		] },
	],
	focusKeywords: ["useful post"], assessmentProfile: { profile: "article", version: 1 },
	schemaEnabled: false, schemaPreset: "", sourceUpdatedAt: "2026-07-14T08:00:00.000Z",
};
function score(overrides: Partial<SeoAnalysisInput> = {}, updatedAt = "2026-07-14T10:00:00.000Z"): SeoAdminContentScore {
	return {
		...analyzeSeoContent({ ...input, ...overrides }),
		analysisRevision: 1, freshness: "current", assessmentProfileRevision: "score-contract-profile",
		keywords: [...(overrides.focusKeywords ?? input.focusKeywords ?? [])],
		profileKeywords: [...(overrides.focusKeywords ?? input.focusKeywords ?? [])],
		focusKeywordSource: (overrides.focusKeywords ?? input.focusKeywords ?? []).length ? "profile" : "none",
		updatedAt, templateUpdatedAt: null, modulesUpdatedAt: null,
		configurationFingerprint: "score-contract-config", metaOverrideUpdatedAt: null,
	};
}
const current = score();
function contentEnvelope(item: unknown) {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, generatedAt: current.updatedAt,
		engineVersion: SEO_ENGINE_VERSION, scoreVersion: SEO_SCORE_VERSION,
		items: [item], hasMore: false,
	};
}
function auditEnvelope(item: Record<string, unknown>) {
	return {
		...contentEnvelope({ ...item, analysisRevision: 0, persistence: "session" }),
		persistence: "session", failures: [],
	};
}
function rejectedAssessment(name: string, patch: Record<string, unknown>): void {
	check(name, () => {
		const item = { ...current, ...patch };
		assert.throws(() => parseSeoAdminContentScores(contentEnvelope(item)), /contentScores\.items/);
		assert.throws(() => parseSeoAdminContentAudit(auditEnvelope(item)), /contentAudit\.items/);
	});
}

check("current engine results cross both stored and session boundaries unchanged", () => {
	for (const item of [current, score({ title: "" }), score({ body: "", document: undefined }), score({ focusKeywords: [] })]) {
		const before = structuredClone(item);
		assert.deepEqual(parseSeoAdminContentScores(contentEnvelope(item)).items[0], item);
		assert.equal(parseSeoAdminContentAudit(auditEnvelope({ ...item })).items[0]?.score, item.score);
		assert.deepEqual(item, before);
	}
});
rejectedAssessment("a forged numeric score cannot reuse valid rows", { score: current.score === 100 ? 99 : current.score + 1 });
rejectedAssessment("a forged status cannot reuse valid rows", { status: current.status === "pass" ? "review" : "pass" });
rejectedAssessment("a forged grade cannot reuse valid rows", { grade: current.grade === "poor" ? "good" : "poor" });
for (const key of ["earnedWeight", "totalWeight", "rawScore", "score"] as const) {
	rejectedAssessment("calculation " + key + " is recomputed", { calculation: { ...current.calculation!, [key]: current.calculation![key] + 1 } });
}
rejectedAssessment("review credit cannot be changed independently", { calculation: { ...current.calculation!, reviewCredit: 0.5 } });
rejectedAssessment("a legacy cap cannot be attached to current arithmetic", {
	calculation: { ...current.calculation!, limit: { reason: "high-failure", cap: 69, checkIds: ["title"] } },
});
for (const key of ["evaluated", "measured", "heuristic", "unavailable", "notApplicable", "unweighted"] as const) {
	rejectedAssessment("coverage " + key + " is recomputed", { coverage: { ...current.coverage!, [key]: current.coverage![key] + 1 } });
}
rejectedAssessment("current calculation is mandatory", { calculation: undefined });
rejectedAssessment("current coverage is mandatory", { coverage: undefined });
rejectedAssessment("duplicate check IDs cannot inflate the aggregate", { checks: [...current.checks, current.checks[0]] });
for (const id of ["title", "description"]) {
	rejectedAssessment("missing mandatory " + id + " is refused", { checks: current.checks.filter((item) => item.id !== id) });
}
rejectedAssessment("an empty check set cannot claim a score", { checks: [] });
rejectedAssessment("unavailable mandatory metadata cannot claim eligible coverage", {
	checks: current.checks.map((item) => item.id === "title" ? { ...item, weight: 0, severity: "info", basis: "unavailable", status: "review" } : item),
});
rejectedAssessment("presence evidence cannot be replaced by a length", {
	checks: current.checks.map((item) => item.id === "title" ? { ...item, evidence: { ...item.evidence, actual: 48 } } : item),
});
check("analyzer19 remains a stale readable observation without current aggregate fields", () => {
	const title = current.checks.find((item) => item.id === "title")!;
	const { basis: _basis, limitation: _limitation, ...legacyCheck } = title;
	const legacy = {
		...current, scoreVersion: 19, freshness: "stale", checks: [legacyCheck], score: 84, grade: "good",
		calculation: undefined, coverage: undefined, assessmentProfile: undefined, assessmentProfileRevision: undefined,
		profileKeywords: undefined, focusKeywordSource: undefined,
	};
	assert.equal(parseSeoAdminContentScores(contentEnvelope(legacy)).items[0]?.score, 84);
	assert.throws(() => parseSeoAdminContentScores(contentEnvelope({ ...legacy, freshness: "current" })), /contentScores\.items/);
});

function overview(item: SeoAdminContentScore) {
	const presentation = seoAnalysisPresentation(item);
	// Suggestions never count; only Failed and Partly met rows need attention.
	const needsAttention = summarizeSeoChecks(item.checks).issues > 0;
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, generatedAt: item.updatedAt, engineVersion: SEO_ENGINE_VERSION,
		readiness: { score: 80, state: "ready", title: "Ready", description: "Saved configuration" },
		site: { name: "Example", url: "https://example.com", indexable: true, robotsMode: "none", settingsState: "saved", defaultSocialImage: null, socialProfileCount: 0 },
		summary: { totalScored: 1, sampleSize: 1, averageContentScore: item.score, needsAttention: Number(needsAttention), schemaPresetsEnabled: 0, schemaPresetsTotal: 0, customSchemas: 0, legacyOverrides: 0, migrationRecords: 0, enabledModules: 1, totalModules: 1 },
		priorities: [], checks: [],
		content: [{ ref: item.ref, entryId: item.entryId, collection: item.collection, collectionLabel: "Posts", title: item.title, score: item.score, grade: item.grade, presentation, needsAttention, firstIssue: "Saved checks", updatedAt: item.updatedAt }],
	};
}
const longText = (count: number) => Array.from({ length: count }, (_, index) => `Readers compare practical examples before choosing a useful next step number ${index}.`).join(" ");
const goodWithSuggestions = score({
	focusKeywords: [], assessmentProfile: { profile: "general", version: 1 },
	document: [
		...input.document as unknown[],
		{ _type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text: longText(6), marks: [] }] },
	],
});
check("Overview accepts numbered shared projections with their band and qualifier", () => {
	for (const item of [current, score({ title: "" }), goodWithSuggestions]) {
		const value = overview(item);
		assert.deepEqual(parseSeoAdminOverview(value).content[0]?.presentation, seoAnalysisPresentation(item));
	}
	const poor = parseSeoAdminOverview(overview(current)).content[0]!;
	assert.deepEqual([poor.presentation, poor.needsAttention], [{ label: "Poor", qualifier: "Limited to 40: under 50 words of body text", tone: "poor" }, true]);
});

check("needs attention counts issues only; suggestions alone never flag an entry", () => {
	const summary = summarizeSeoChecks(goodWithSuggestions.checks);
	assert.equal(summary.issues, 0);
	assert.ok(summary.advisories > 0);
	const parsed = parseSeoAdminOverview(overview(goodWithSuggestions));
	assert.deepEqual(parsed.content[0]?.presentation, { label: "Good", qualifier: "No focus keyword", tone: "good" });
	assert.equal(parsed.content[0]?.needsAttention, false);
	assert.equal(parsed.summary.needsAttention, 0);
});

const overviewFixture = overview(current);
function overviewRow(patch: Record<string, unknown>) {
	return { ...overviewFixture, content: [{ ...overviewFixture.content[0], ...patch }] };
}

function projectionOverview(presentation: unknown, needsAttention: boolean | null, rowScore = overviewFixture.content[0].score) {
	return { ...overviewRow({ presentation, needsAttention, score: rowScore }),
		summary: { ...overviewFixture.summary, needsAttention: Number(needsAttention === true) } };
}
check("dashed and earlier-analyzer results never reach an Overview row", () => {
	for (const item of [score({ body: "", document: undefined }), score({ document: [{ _type: "block", style: "normal", children: [{ _type: "span", text: "A short note." }] }], assessmentProfile: { profile: "general", version: 1 } })]) {
		const presentation = seoAnalysisPresentation(item);
		assert.ok(["Partially checked", "Too little text to score"].includes(presentation.label), presentation.label);
		assert.throws(() => parseSeoAdminOverview(overview(item)), /content item/);
	}
	assert.throws(() => parseSeoAdminOverview(projectionOverview({ label: "Earlier analyzer", qualifier: "Analyze again.", tone: "neutral" }, false)), /content item/);
});

check("band projections accept only their own band, tone and qualifiers", () => {
	for (const [presentation, needsAttention, rowScore] of [
		[{ label: "Good", qualifier: null, tone: "good" }, false, 85],
		[{ label: "Good", qualifier: null, tone: "good" }, true, 80],
		[{ label: "Good", qualifier: "No focus keyword", tone: "good" }, false, 100],
		[{ label: "Needs improvement", qualifier: "Limited to 79: under 100 words of body text", tone: "review" }, true, 79],
		[{ label: "Needs improvement", qualifier: "No focus keyword", tone: "review" }, true, 50],
		[{ label: "Poor", qualifier: "Limited to 40: under 50 words of body text", tone: "poor" }, true, 40],
		[{ label: "Poor", qualifier: "Limited to 40: under 50 words of body text. No focus keyword", tone: "poor" }, true, 40],
		[{ label: "Poor", qualifier: null, tone: "poor" }, true, 0],
	] as const) assert.deepEqual(parseSeoAdminOverview(projectionOverview(presentation, needsAttention, rowScore)).content[0]?.presentation, presentation);
});
check("analyzer 20 labels are refused", () => {
	for (const [presentation, needsAttention] of [
		[{ label: "Needs work", qualifier: null, tone: "poor" }, true],
		[{ label: "Needs attention", qualifier: null, tone: "review" }, true],
		[{ label: "Metadata checks passed", qualifier: "Body not checked", tone: "neutral" }, false],
		[{ label: "Saved checks passed", qualifier: null, tone: "good" }, false],
		[{ label: "Review suggestions", qualifier: "1 suggestion to review", tone: "review" }, true],
		[{ label: "Limited assessment", qualifier: "Readability sample limited", tone: "neutral" }, false],
		[{ label: "Previous analysis", qualifier: "Earlier analyzer", tone: "neutral" }, false],
	] as const) assert.throws(() => parseSeoAdminOverview(projectionOverview(presentation, needsAttention)), /content item/, presentation.label);
});
check("band projections cannot carry another band, tone, qualifier or attention state", () => {
	for (const [presentation, needsAttention, rowScore] of [
		[{ label: "Good", qualifier: null, tone: "review" }, false, 85],
		[{ label: "Good", qualifier: "", tone: "good" }, false, 85],
		[{ label: "Good", qualifier: "Body not checked", tone: "good" }, false, 85],
		[{ label: "Good", qualifier: "Limited to 79", tone: "good" }, false, 85],
		[{ label: "Good", qualifier: null, tone: "good" }, false, 79],
		[{ label: "Needs improvement", qualifier: null, tone: "review" }, true, 85],
		[{ label: "Needs improvement", qualifier: null, tone: "review" }, false, 70],
		[{ label: "Poor", qualifier: null, tone: "poor" }, false, 30],
		[{ label: "Poor", qualifier: null, tone: "review" }, true, 30],
		[{ label: "Partially checked", qualifier: "6 weighted checks not checked", tone: "neutral" }, false, 100],
		[{ label: "Too little text to score", qualifier: "2 words of body text", tone: "neutral" }, false, 94],
		[{ label: "Unexpected label", qualifier: null, tone: "neutral" }, false, 50],
	] as const) assert.throws(() => parseSeoAdminOverview(projectionOverview(presentation, needsAttention, rowScore)), /content item/, JSON.stringify(presentation));
});

check("legacy Overview rows use unknown presentation and attention together", () => {
	const value = { ...overviewRow({ presentation: null, needsAttention: null }), summary: { ...overviewFixture.summary, needsAttention: 0 } };
	assert.equal(parseSeoAdminOverview(value).content[0]?.presentation, null);
});
check("unverified saved Overview projections retain known saved issues without claiming current content", () => {
	for (const needsAttention of [false, true]) {
		const value = {
			...overviewRow({ presentation: { label: "Saved analysis", qualifier: "Current content not checked", tone: "neutral" }, needsAttention }),
			summary: { ...overviewFixture.summary, needsAttention: Number(needsAttention) },
		};
		const parsed = parseSeoAdminOverview(value);
		assert.equal(parsed.content[0]?.needsAttention, needsAttention);
		assert.equal(parsed.content[0]?.presentation?.tone, "neutral");
	}
});
for (const [name, value] of [
	["negative score", overviewRow({ score: -1 })],
	["score exceeding 100", overviewRow({ score: 101 })],
	["fractional score", overviewRow({ score: 99.5 })],
	["missing presentation", overviewRow({ presentation: undefined })],
	["unknown tone", overviewRow({ presentation: { ...overviewFixture.content[0].presentation, tone: "excellent" } })],
	["label and tone disagreement", overviewRow({ presentation: { label: "Poor", qualifier: null, tone: "good" } })],
	["band label with another score", overviewRow({ score: 90 })],
	["unverified saved analysis with good tone", overviewRow({ presentation: { label: "Saved analysis", qualifier: null, tone: "good" } })],
	["blank qualifier", overviewRow({ presentation: { label: "Poor", qualifier: "", tone: "poor" } })],
	["unknown row with a boolean attention state", overviewRow({ presentation: null, needsAttention: false })],
	["Poor row without attention", overviewRow({ needsAttention: !overviewFixture.content[0].needsAttention })],
	["summary attention count differs from projected rows", { ...overviewFixture, summary: { ...overviewFixture.summary, needsAttention: overviewFixture.summary.needsAttention ? 0 : 1 } }],
	["sample size differs from projected rows", { ...overviewFixture, summary: { ...overviewFixture.summary, sampleSize: 2 } }],
] as const) check("Overview rejects " + name, () => assert.throws(() => parseSeoAdminOverview(value), /content item|summary/));

const now = new Date("2026-07-14T12:00:00.000Z");
// Both fixtures are under 50 words, so a pair needs a raw score below the 40 limit to move.
const previous = createScoreSnapshot(score({ title: "", description: "", image: "" }, "2026-07-13T10:00:00.000Z"));
const latest = createScoreSnapshot(current);
assert.ok(previous.score < latest.score, `${previous.score} < ${latest.score}`);
const singleton = createScoreSnapshot(score({ ref: "posts:singleton", entryId: "singleton" }, "2026-07-14T11:00:00.000Z"));
const legacy: SeoAdminScoreSnapshot = { ...latest, id: "legacy-analyzer19", scoreVersion: 19, score: 5, grade: "poor", capturedAt: "2026-07-14T11:30:00.000Z", comparisonContext: undefined };
const trendSnapshots = [previous, latest, singleton, legacy];
const trends = buildScoreTrends(trendSnapshots, { days: 7, now });
check("ABI40 accepts actual paired, singleton and raw legacy builder output", () => {
	const before = structuredClone(trends);
	const parsed = parseSeoAdminScoreTrends(trends);
	assert.equal(parsed.comparison.pairedEntries, 1);
	assert.equal(parsed.comparison.singleSampleEntries, 1);
	assert.equal(parsed.comparison.scoreDelta, latest.score - previous.score);
	assert.equal(parsed.summary.snapshotCount, 4);
	assert.equal(parsed.items.find((item) => item.id === legacy.id)?.scoreVersion, 19);
	assert.deepEqual(trends, before);
});
function comparison(patch: Record<string, unknown>) { return { ...trends, comparison: { ...trends.comparison, ...patch } }; }
function change(patch: Record<string, unknown>) { return { ...trends, changes: { ...trends.changes, items: [{ ...trends.changes.items[0], ...patch }] } }; }
for (const [name, value] of [
	["another comparison policy", comparison({ policy: "latest-two" })],
	["fractional paired count", comparison({ pairedEntries: 0.5 })],
	["negative singleton count", comparison({ singleSampleEntries: -1 })],
	["unbalanced observed coverage", comparison({ observedEntries: trends.comparison.observedEntries + 1 })],
	["unbalanced exclusion counts", comparison({ exclusions: { ...trends.comparison.exclusions, missingContext: 1 } })],
	["scope changes exceeding pairs", comparison({ scopeChangedPairs: trends.comparison.pairedEntries + 1 })],
	["unbalanced movement counts", comparison({ unchangedEntries: trends.comparison.unchangedEntries + 1 })],
	["null paired average", comparison({ baselineAverage: null })],
	["out-of-range paired average", comparison({ currentAverage: 101 })],
	["forged paired delta", comparison({ scoreDelta: (trends.comparison.scoreDelta ?? 0) + 1 })],
	["wrong paired direction", comparison({ direction: "stable" })],
	["null paired issue count", comparison({ openedIssues: null })],
	["shifted UTC window", comparison({ range: { ...trends.comparison.range, start: "2026-07-09T00:00:00.000Z" } })],
	["range end differs from generation time", comparison({ range: { ...trends.comparison.range, end: "2026-07-14T11:59:59.000Z" } })],
	["old array changes envelope", { ...trends, changes: trends.changes.items }],
	["incorrect total changes", { ...trends, changes: { ...trends.changes, total: 0 } }],
	["false pagination claim", { ...trends, changes: { ...trends.changes, hasMore: true } }],
	["forged change delta", change({ delta: trends.changes.items[0].delta + 1 })],
	["identical endpoint IDs", change({ previousSnapshotId: trends.changes.items[0].currentSnapshotId })],
	["empty endpoint ID", change({ currentSnapshotId: "" })],
	["equal endpoint timestamps", change({ previousCapturedAt: trends.changes.items[0].capturedAt })],
	["wrong baseline window provenance", change({ baselineBasis: "before-window" })],
	["future change timestamp", change({ capturedAt: "2026-07-14T13:00:00.000Z" })],
	["unreconciled opened issues", change({ openedIssues: trends.changes.items[0].openedIssues + 1 })],
	["wrong represented endpoint score", change({ currentScore: latest.score - 1, delta: latest.score - 1 - previous.score })],
	["wrong represented endpoint ref", change({ ref: "posts:another-entry" })],
	["raw current endpoint changed to legacy", { ...trends, items: trends.items.map((item) => item.id === latest.id ? { ...item, scoreVersion: 19 } : item) }],
	["duplicate raw IDs", { ...trends, items: trends.items.map((item, index) => index === 1 ? trends.items[0] : item) }],
	["incorrect raw count", { ...trends, summary: { ...trends.summary, snapshotCount: trends.summary.snapshotCount + 1 } }],
	["unknown observational average with tracked entries", { ...trends, summary: { ...trends.summary, currentAverage: null } }],
	["summary differs from final daily observation", { ...trends, summary: { ...trends.summary, openIssues: trends.summary.openIssues + 1 } }],
	["missing daily point", { ...trends, points: trends.points.slice(1) }],
	["out-of-order daily point", { ...trends, points: [...trends.points].reverse() }],
	["null daily average with tracked entries", { ...trends, points: trends.points.map((item, index) => index === trends.points.length - 1 ? { ...item, averageScore: null } : item) }],
	["scope mismatch", { ...trends, scope: { ...trends.scope, collection: "pages" } }],
] as const) check("Trends rejects " + name, () => assert.throws(() => parseSeoAdminScoreTrends(value), /scoreTrends\./));

const legacyOnly = buildScoreTrends([legacy], { days: 7, now });
check("legacy-only raw history has no invented current average or pair", () => {
	const parsed = parseSeoAdminScoreTrends(legacyOnly);
	assert.equal(parsed.summary.currentAverage, null);
	assert.equal(parsed.summary.trackedEntries, 0);
	assert.equal(parsed.items.length, 1);
	assert.equal(parsed.comparison.direction, "insufficient-data");
});
for (const field of ["baselineAverage", "currentAverage", "scoreDelta", "openedIssues", "resolvedIssues"] as const) {
	check("empty comparison requires null " + field, () => assert.throws(() => parseSeoAdminScoreTrends({ ...legacyOnly, comparison: { ...legacyOnly.comparison, [field]: 0 } }), /scoreTrends\.comparison/));
}
check("zero pairs cannot claim a stable movement", () => assert.throws(() => parseSeoAdminScoreTrends({ ...legacyOnly, comparison: { ...legacyOnly.comparison, direction: "stable" } }), /scoreTrends\.comparison/));
check("qualified equal observations are stable with zero issues and no change rows", () => {
	const equal = buildScoreTrends([createScoreSnapshot(score({}, previous.capturedAt)), latest], { days: 7, now });
	const parsed = parseSeoAdminScoreTrends(equal);
	assert.equal(parsed.comparison.direction, "stable");
	assert.equal(parsed.comparison.scoreDelta, 0);
	assert.equal(parsed.comparison.unchangedEntries, 1);
	assert.equal(parsed.changes.total, 0);
});
check("before-window baselines need not appear in within-window raw items", () => {
	const baseline = { ...previous, id: "before-window-baseline", capturedAt: "2026-07-01T10:00:00.000Z" };
	const parsed = parseSeoAdminScoreTrends(buildScoreTrends([baseline, latest], { days: 7, now }));
	assert.equal(parsed.items.length, 1);
	assert.equal(parsed.changes.items[0]?.previousSnapshotId, baseline.id);
	assert.equal(parsed.changes.items[0]?.baselineBasis, "before-window");
});
const unqualifiedContexts = [
	undefined,
	{ version: 1, policy: "unknown" },
	{ version: 1, policy: "seo20-scored-v1", assessmentProfile: { version: 1, profile: "article" }, eligibleMask: 1 },
	{ version: 1, policy: "seo20-scored-v1", assessmentProfile: { version: 1, profile: "article" }, eligibleMask: 2 },
];
check("missing or malformed comparison context preserves raw observations", () => {
	for (const comparisonContext of unqualifiedContexts) {
		const raw = { ...latest, comparisonContext };
		const parsed = parseSeoAdminScoreTrends(buildScoreTrends([previous, raw], { days: 7, now }));
		assert.equal(parsed.items.length, 2);
		assert.equal(parsed.comparison.excludedEntries, 1);
		assert.equal(parsed.comparison.exclusions[comparisonContext === undefined ? "missingContext" : "invalidContext"], 1);
		assert.equal(parsed.comparison.pairedEntries, 0);
		assert.deepEqual(parsed.items.find((item) => item.id === raw.id)?.comparisonContext, comparisonContext);
	}
});
check("single observations need no comparison context before a pair exists", () => {
	for (const comparisonContext of unqualifiedContexts) {
		const raw = { ...latest, comparisonContext };
		const parsed = parseSeoAdminScoreTrends(buildScoreTrends([raw], { days: 7, now }));
		assert.equal(parsed.comparison.observedEntries, 1);
		assert.equal(parsed.comparison.singleSampleEntries, 1);
		assert.equal(parsed.comparison.excludedEntries, 0);
		assert.equal(parsed.comparison.pairedEntries, 0);
		assert.equal(parsed.comparison.direction, "insufficient-data");
		assert.equal(Object.values(parsed.comparison.exclusions).reduce((sum, count) => sum + count, 0), 0);
		assert.deepEqual(parsed.items[0]?.comparisonContext, comparisonContext);
	}
});
check("changed assessment profile excludes the pair without dropping observations", () => {
	const changed = createScoreSnapshot(goodWithSuggestions);
	assert.equal(changed.unscored, undefined);
	const parsed = parseSeoAdminScoreTrends(buildScoreTrends([previous, changed], { days: 7, now }));
	assert.equal(parsed.comparison.exclusions.changedProfile, 1);
	assert.equal(parsed.summary.trackedEntries, 1);
});
check("a later dash keeps the entry observed but out of the average", () => {
	const dashed = createScoreSnapshot(score({ assessmentProfile: { profile: "general", version: 1 } }));
	assert.equal(dashed.unscored, "too-little-text");
	const parsed = parseSeoAdminScoreTrends(buildScoreTrends([previous, dashed], { days: 7, now }));
	assert.deepEqual([parsed.summary.trackedEntries, parsed.summary.currentAverage, parsed.comparison.observedEntries, parsed.comparison.pairedEntries],
		[0, null, 1, 0]);
	assert.equal(parsed.items.length, 2, "both snapshots stay in raw history");
});
check("a capped changes list retains full pair counts", () => {
	const snapshots = Array.from({ length: 21 }, (_, index) => {
		const ref = "posts:pair-" + index, entryId = "pair-" + index;
		return [{ ...previous, id: "previous-" + index, ref, entryId }, { ...latest, id: "current-" + index, ref, entryId }];
	}).flat();
	const value = buildScoreTrends(snapshots, { days: 7, now });
	const parsed = parseSeoAdminScoreTrends(value);
	assert.equal(parsed.comparison.pairedEntries, 21);
	assert.equal(parsed.changes.total, 21);
	assert.equal(parsed.changes.items.length, 20);
	assert.equal(parsed.changes.hasMore, true);
	assert.throws(() => parseSeoAdminScoreTrends({ ...value, changes: { ...value.changes, items: value.changes.items.slice(1) } }), /scoreTrends\.changes/);
	assert.throws(() => parseSeoAdminScoreTrends({ ...value, changes: { ...value.changes, hasMore: false } }), /scoreTrends\.changes/);
});
check("raw cap100 does not shrink the full observed population", () => {
	const snapshots = Array.from({ length: 101 }, (_, index) => ({ ...latest, id: "singleton-" + index, ref: "posts:single-" + index, entryId: "single-" + index }));
	const value = buildScoreTrends(snapshots, { days: 7, now });
	const parsed = parseSeoAdminScoreTrends(value);
	assert.equal(parsed.items.length, 100);
	assert.equal(parsed.summary.snapshotCount, 101);
	assert.equal(parsed.comparison.observedEntries, 101);
	assert.equal(parsed.comparison.singleSampleEntries, 101);
	assert.throws(() => parseSeoAdminScoreTrends({ ...value, items: value.items.slice(1) }), /scoreTrends\.items/);
});

console.log("Shared score admin contract self-check passed: " + cases + " cases.");
