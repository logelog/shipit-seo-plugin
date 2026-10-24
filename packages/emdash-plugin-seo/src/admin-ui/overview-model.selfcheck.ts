import assert from "node:assert/strict";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	SEO_SCORE_VERSION,
	type SeoAdminContentScore,
	type SeoAdminOverview,
	type SeoAdminReadableSettings,
	type SeoAdminUnreadableSettings,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { analyzeSeoContent, seoAnalysisPresentation, seoScoreDisplay, type SeoAnalysisInput } from "../analysis.ts";
import {
	CONTENT_HEALTH_FRESHNESS_CHECKS,
	buildSeoOverviewModel,
	contentHealthFreshnessRefs,
	contentHealthScoreCell,
	priorityViewForArea,
} from "./overview-model.ts";
import { SEO_SETTINGS_UNREADABLE_VIEW, buildSeoOverviewContentSummary } from "./workspace-model.ts";

function overview(): SeoAdminOverview {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION,
		generatedAt: "2026-10-16T12:00:00.000Z",
		readiness: { score: 91, state: "review", title: "SEO setup needs review", description: "Review setup." },
		site: { name: "Example Dental Practice", url: "https://dental.test", indexable: true, robotsMode: "none", settingsState: "saved", defaultSocialImage: null, socialProfileCount: 0 },
		summary: { totalScored: 10, sampleSize: 6, averageContentScore: 51, needsAttention: 4, schemaPresetsEnabled: 3, schemaPresetsTotal: 5, customSchemas: 1, legacyOverrides: 0, migrationRecords: 0, enabledModules: 2, totalModules: 8 },
		priorities: [{ priority: 1, area: "Search & social", check: "Default social image", status: "review", detail: "Host fallback is not observed." }],
		checks: [{ group: "Social", check: "Default social image", status: "review", weight: 8, detail: "Host fallback is not observed." }],
		content: [{ ref: "posts:entry-1", collection: "posts", collectionLabel: "Posts", entryId: "entry-1", title: "Appointment preparation", score: 51, grade: "poor", presentation: { label: "Saved analysis", qualifier: "Current content not checked", tone: "neutral" }, needsAttention: true, firstIssue: "Review saved content", updatedAt: "2026-10-16T11:00:00.000Z" }],
	};
}

function settings(): SeoAdminReadableSettings {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, storageVersion: SEO_ADMIN_SETTINGS_STORAGE_VERSION, engineVersion: SEO_ENGINE_VERSION,
		state: "saved", updatedAt: "2026-10-16T11:00:00.000Z", revision: "settings-revision-1", legacyGuard: null, legacyPresent: false, indexingPreferenceConfirmed: true,
		hostSiteUrl: "https://dental.test",
		contentScoring: { state: "paused", revision: "scoring-1", intentEnabled: false, acknowledgedNoticeVersion: null, currentNoticeVersion: 1 },
		values: { siteName: "Example Dental Practice", siteUrl: "https://dental.test", publisherType: "organization", organizationName: "Example Dental Practice", organizationLogo: "", personName: "", socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false, contentScoringEnabled: false },
	};
}

function unreadable(state: SeoAdminUnreadableSettings["state"]): SeoAdminUnreadableSettings {
	const readable = settings();
	return { ...readable, state, updatedAt: null, revision: null, legacyGuard: null, legacyPresent: false, indexingPreferenceConfirmed: false, values: null,
		contentScoring: { state: "unavailable", reason: state === "corrupt" ? "corrupt" : "unreadable" } };
}

let cases = 0;
function check(name: string, run: () => void) { run(); cases += 1; }

check("saved results keep the existing qualified summary rather than becoming current site health", () => {
	const data = overview();
	const result = buildSeoOverviewModel(data);
	assert.deepEqual(result.contentSummary, buildSeoOverviewContentSummary(data.summary, "saved"));
	assert.equal(result.sampleState, "available");
	assert.equal(result.sampleSize, 6);
	assert.equal(result.nextStep.kind, "saved-results");
	assert.equal(result.nextStep.view, "content");
	assert.match(result.nextStep.description, /saved/);
	assert.match(result.nextStep.description, /latest analysis/);
	assert.equal(result.setupSnapshotCurrent, true);
});

for (const state of ["corrupt", "unavailable"] as const) {
	check(`${state} cached settings override an older ready Overview and mask its numeric sample`, () => {
		const data = overview();
		data.readiness = { score: 100, state: "ready", title: "Ready", description: "Old snapshot" };
		const result = buildSeoOverviewModel(data, unreadable(state));
		assert.equal(result.settingsState, state);
		assert.equal(result.indexable, null);
		assert.equal(result.sampleState, "unavailable");
		assert.equal(result.sampleSize, null);
		assert.equal(result.contentSummary.averageValue, "--");
		assert.equal(result.contentSummary.needsWorkValue, "--");
		assert.equal(result.nextStep.kind, "settings-unreadable");
		assert.equal(result.nextStep.view, SEO_SETTINGS_UNREADABLE_VIEW, "Unreadable settings open the one shared destination");
		assert.equal(result.nextStep.view, "indexing");
		assert.match(result.nextStep.description, /adds no metadata to public pages/);
		assert.equal(result.setupSnapshotCurrent, false);
	});
	check(`recovered settings do not turn an old ${state} Overview sample into empty or measured zero`, () => {
		const data = overview();
		data.site.settingsState = state;
		data.site.indexable = null;
		data.site.robotsMode = "unknown";
		data.summary.sampleSize = 0;
		data.summary.averageContentScore = null;
		data.summary.needsAttention = 0;
		const result = buildSeoOverviewModel(data, settings());
		assert.equal(result.settingsState, "saved");
		assert.equal(result.indexable, true);
		assert.equal(result.sampleState, "unavailable");
		assert.equal(result.sampleSize, null);
		assert.equal(result.nextStep.kind, "saved-results");
		assert.equal(result.nextStep.view, "content");
		assert.match(result.nextStep.description, /unavailable/);
		assert.equal(result.contentSummary.averageValue, "--");
		assert.match(result.contentSummary.averageDetail, /reloading/);
		assert.doesNotMatch(result.contentSummary.averageDetail, /cannot be read|No saved score/);
		assert.equal(result.setupSnapshotCurrent, false);
	});
	check(`unreadable ${state} Overview without a cache never means noindex off`, () => {
		const data = overview();
		data.site.settingsState = state;
		data.site.indexable = null;
		const result = buildSeoOverviewModel(data);
		assert.equal(result.nextStep.kind, "settings-unreadable");
		assert.equal(result.nextStep.view, SEO_SETTINGS_UNREADABLE_VIEW);
		assert.equal(result.indexable, null);
	});
}

check("cached noindex wins even if its timestamp is older than the Overview", () => {
	const cached = settings();
	cached.values.noindex = true;
	const result = buildSeoOverviewModel(overview(), cached);
	assert.equal(result.nextStep.kind, "noindex");
	assert.equal(result.nextStep.view, "indexing");
	assert.equal(result.indexable, false);
	assert.match(result.nextStep.description, /intentional/);
	assert.equal(result.setupSnapshotCurrent, false);
});

check("unknown snapshot indexability cannot expose a numeric sample as available", () => {
	const data = overview();
	data.site.indexable = null;
	data.site.robotsMode = "unknown";
	const result = buildSeoOverviewModel(data);
	assert.equal(result.indexable, null);
	assert.equal(result.nextStep.kind, "settings-unreadable");
	assert.equal(result.sampleState, "unavailable");
	assert.equal(result.contentSummary.averageValue, "--");
	assert.equal(result.contentSummary.needsWorkValue, "--");
});

check("cached unrestricted settings override old noindex without pretending its setup number is current", () => {
	const data = overview();
	data.site.indexable = false;
	data.site.robotsMode = "noindex,nofollow";
	const result = buildSeoOverviewModel(data, settings());
	assert.equal(result.indexable, true);
	assert.equal(result.nextStep.kind, "saved-results");
	assert.equal(result.setupSnapshotCurrent, false);
});

check("known missing URL precedes choosing content, while a real inherited host URL prevents that prompt", () => {
	const data = overview();
	data.summary.sampleSize = 0;
	data.summary.averageContentScore = null;
	data.summary.needsAttention = 0;
	const cached = settings();
	cached.values.siteUrl = "";
	cached.hostSiteUrl = "";
	let result = buildSeoOverviewModel(data, cached);
	assert.equal(result.siteUrlKnown, true);
	assert.equal(result.effectiveSiteUrl, null);
	assert.equal(result.nextStep.kind, "missing-url");
	assert.equal(result.nextStep.view, "site");
	cached.hostSiteUrl = "https://inherited.test";
	result = buildSeoOverviewModel(data, cached);
	assert.equal(result.effectiveSiteUrl, "https://inherited.test");
	assert.equal(result.nextStep.kind, "no-sample");
	delete cached.hostSiteUrl;
	result = buildSeoOverviewModel(data, cached);
	assert.equal(result.siteUrlKnown, false);
	assert.equal(result.nextStep.kind, "no-sample", "An omitted host fact must not invent a missing production URL.");
});

check("no sample is not measured zero or zero below-threshold findings", () => {
	const data = overview();
	data.summary.sampleSize = 0;
	data.summary.averageContentScore = null;
	data.summary.needsAttention = 0;
	const empty = buildSeoOverviewModel(data);
	assert.equal(empty.sampleState, "empty");
	assert.equal(empty.sampleSize, 0);
	assert.equal(empty.contentSummary.averageValue, "--");
	assert.equal(empty.contentSummary.needsWorkValue, "--");
	assert.equal(empty.nextStep.kind, "no-sample");
	assert.equal(empty.nextStep.view, "content");
	data.summary.sampleSize = 1;
	data.summary.averageContentScore = 0;
	data.summary.needsAttention = 1;
	const zero = buildSeoOverviewModel(data);
	assert.equal(zero.sampleState, "available");
	assert.equal(zero.contentSummary.averageValue, 0);
	assert.equal(zero.contentSummary.needsWorkValue, 1);
	assert.equal(zero.nextStep.kind, "saved-results");
	data.summary.averageContentScore = 91;
	data.summary.needsAttention = 0;
	const noFindings = buildSeoOverviewModel(data);
	assert.equal(noFindings.sampleState, "available");
	assert.equal(noFindings.contentSummary.needsWorkValue, 0);
	assert.equal(noFindings.nextStep.kind, "saved-results");
});

check("newer settings suppress a stale setup snapshot without replacing an available saved sample", () => {
	const cached = settings();
	cached.updatedAt = "2026-10-16T12:01:00.000Z";
	const result = buildSeoOverviewModel(overview(), cached);
	assert.equal(result.setupSnapshotCurrent, false);
	assert.equal(result.sampleState, "available");
	assert.equal(result.contentSummary.averageValue, 51);
});

check("precedence is unreadable, noindex, missing URL, empty sample, available sample", () => {
	const data = overview();
	data.summary.sampleSize = 0;
	data.site.url = null;
	data.site.indexable = false;
	assert.equal(buildSeoOverviewModel(data, unreadable("unavailable")).nextStep.kind, "settings-unreadable");
	assert.equal(buildSeoOverviewModel(data).nextStep.kind, "noindex");
	data.site.indexable = true;
	assert.equal(buildSeoOverviewModel(data).nextStep.kind, "missing-url");
	assert.equal(buildSeoOverviewModel(data).nextStep.view, "site", "the missing production URL belongs to Website settings");
	data.site.url = "https://dental.test";
	assert.equal(buildSeoOverviewModel(data).nextStep.kind, "no-sample");
	data.summary.sampleSize = 1;
	assert.equal(buildSeoOverviewModel(data).nextStep.kind, "saved-results");
});

check("every known priority area resolves to its actual owner and unknown areas have no guessed action", () => {
	for (const [area, view] of [["Site identity", "identity"], ["Search & social", "social"], ["Schema", "schema"], ["Templates", "templates"], ["Modules", "modules"]]) {
		assert.equal(priorityViewForArea(area), view);
	}
	for (const area of ["Review", "Future feature", "", "constructor", "Content health"]) assert.equal(priorityViewForArea(area), null);
});

check("specific assessments distinguish the website address from publisher profiles in a shared legacy area", () => {
	assert.equal(priorityViewForArea("Site identity", "Site URL"), "site");
	assert.equal(priorityViewForArea("Site identity", "SameAs profiles"), "identity");
	assert.equal(priorityViewForArea("Site identity"), "identity", "legacy publisher routing is not remapped wholesale");
	assert.equal(priorityViewForArea("Review", "Unknown future assessment"), null);
});

check("optional setup suggestions and feature counts do not become activation actions", () => {
	const data = overview();
	data.summary.enabledModules = 0;
	const beforeData = structuredClone(data);
	const cached = settings();
	const beforeSettings = structuredClone(cached);
	const result = buildSeoOverviewModel(data, cached);
	assert.equal(result.nextStep.kind, "saved-results");
	assert.equal(result.nextStep.view, "content");
	assert.deepEqual(data, beforeData);
	assert.deepEqual(cached, beforeSettings);
	assert.equal(cached.values.contentScoringEnabled, false);
	assert.equal(result.nextStep.tone, "neutral");
});

// ---- Content health score cells over stored rows and their stored-only checks ----

const sentence = "Fresh harbour loaves are shaped by hand every morning and baked in small batches for visitors.";
function stored(words: number, updatedAt = "2026-10-16T11:00:00.000Z"): SeoAdminContentScore {
	const text = Array.from({ length: Math.ceil(words / 16) }, () => sentence).join(" ").split(" ").slice(0, words).join(" ");
	const input: SeoAnalysisInput = {
		ref: "pages:harbour", collection: "pages", entryId: "harbour", slug: "harbour-loaves",
		title: "Harbour loaves baked every morning", description: "Fresh harbour loaves from the bakery, shaped by hand each morning and sold the same day.",
		url: "https://dental.test/harbour-loaves", canonicalStatus: "matches", image: "https://dental.test/social.jpg", noindex: false,
		body: text, document: [{ _type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text, marks: [] }] }],
		focusKeywords: [], assessmentProfile: { profile: "general", version: 1 }, schemaEnabled: false, schemaPreset: "",
		sourceUpdatedAt: "2026-10-16T10:00:00.000Z",
	};
	return {
		...analyzeSeoContent(input), analysisRevision: 1, freshness: "current", updatedAt,
		templateUpdatedAt: null, modulesUpdatedAt: null, configurationFingerprint: "content-health-config", metaOverrideUpdatedAt: null,
	};
}
type HealthRow = SeoAdminOverview["content"][number];
function healthRow(score: SeoAdminContentScore, patch: Partial<HealthRow> = {}): HealthRow {
	return {
		ref: score.ref, entryId: score.entryId, collection: score.collection, collectionLabel: "Pages", title: score.title,
		score: score.score, grade: score.grade, presentation: { label: "Saved analysis", qualifier: "Current content not checked", tone: "neutral" },
		needsAttention: false, firstIssue: "Review saved content", updatedAt: score.updatedAt, ...patch,
	};
}
const numbered = stored(90);
const savedCell = (row: HealthRow) => ({
	badgeText: String(row.score), variant: "secondary", label: "Saved analysis", qualifier: "Current content not checked", current: false, accessiblePrefix: "Saved score",
});

check("a stored row with no check shows its saved number, not a dash", () => {
	assert.notEqual(seoScoreDisplay(numbered).score, null, "control: the stored result has a number");
	const row = healthRow(numbered);
	assert.deepEqual(contentHealthScoreCell(row), savedCell(row));
});

check("a matching current check shows the band of the stored result beside the saved number", () => {
	const row = healthRow(numbered);
	const band = seoAnalysisPresentation(numbered);
	assert.notEqual(band.tone, "neutral", "control: the stored result has a band");
	const cell = contentHealthScoreCell(row, structuredClone(numbered));
	assert.deepEqual(cell, {
		badgeText: String(numbered.score), variant: band.tone === "good" ? "success" : band.tone === "review" ? "warning" : "error",
		label: band.label, qualifier: band.qualifier, current: true, accessiblePrefix: null,
	});
});

check("an unset focus keyword shows the same number below Good in the Overview row and the editor", () => {
	assert.deepEqual([numbered.score, seoAnalysisPresentation(numbered)], [79, { label: "Needs improvement", qualifier: "Add a focus keyword", tone: "review" }]);
	const row = healthRow(numbered, { presentation: seoAnalysisPresentation(numbered), needsAttention: true });
	const editor = contentHealthScoreCell(row, structuredClone(numbered));
	const saved = contentHealthScoreCell(row);
	assert.deepEqual([editor.badgeText, editor.variant, editor.label, editor.qualifier], ["79", "warning", "Needs improvement", "Add a focus keyword"]);
	assert.deepEqual([saved.badgeText, saved.variant, saved.label, saved.qualifier], [editor.badgeText, editor.variant, editor.label, editor.qualifier]);
});

check("a matching stale check keeps the saved number and asks for a refresh", () => {
	const row = healthRow(numbered);
	assert.deepEqual(contentHealthScoreCell(row, { ...numbered, freshness: "stale" }), {
		badgeText: String(numbered.score), variant: "secondary", label: "Analysis needs refreshing",
		qualifier: "Saved inputs or analysis version no longer match", current: false, accessiblePrefix: "Last known score",
	});
});

check("a check of another stored result or without freshness describes nothing", () => {
	const row = healthRow(numbered);
	for (const [name, checked] of [
		["a later save", { ...numbered, updatedAt: "2026-10-16T11:30:00.000Z" }],
		["another score", { ...numbered, score: numbered.score - 1 }],
		["another entry", { ...numbered, ref: "pages:other" }],
		["an earlier analyzer", { ...numbered, scoreVersion: SEO_SCORE_VERSION - 1 }],
		["no freshness", (({ freshness: _freshness, ...rest }) => rest)(numbered)],
	] as const) {
		assert.deepEqual(contentHealthScoreCell(row, checked as SeoAdminContentScore), savedCell(row), name);
		assert.deepEqual(contentHealthScoreCell(row, { ...(checked as SeoAdminContentScore), freshness: "stale" }), name === "no freshness"
			? contentHealthScoreCell(row, { ...numbered, freshness: "stale" }) : savedCell(row), name + " marked stale");
	}
});

check("an earlier analyzer label, a missing presentation and a current result without a number never invent one", () => {
	const earlier = healthRow(numbered, { presentation: { label: "Earlier analyzer", qualifier: "Analyze again.", tone: "neutral" } });
	assert.deepEqual(contentHealthScoreCell(earlier), {
		badgeText: "Earlier analyzer", variant: "secondary", label: "Earlier analyzer", qualifier: "Analyze again.", current: false, accessiblePrefix: null,
	});
	const unknown = healthRow(numbered, { presentation: null });
	assert.deepEqual(contentHealthScoreCell(unknown), {
		badgeText: "-", variant: "secondary", label: "Previous analysis", qualifier: null, current: false, accessiblePrefix: null,
	});
	const short = stored(22);
	assert.equal(seoScoreDisplay(short).score, null, "control: 22 words of General text show no number");
	assert.deepEqual(contentHealthScoreCell(healthRow(short), short), {
		badgeText: "-", variant: "secondary", label: "Too little text to score", qualifier: "22 words of body text", current: true, accessiblePrefix: null,
	});
});

check("freshness checks cover the first rows of the given list and the focused row once", () => {
	assert.equal(CONTENT_HEALTH_FRESHNESS_CHECKS, 10);
	const rows = Array.from({ length: 12 }, (_, index) => ({ ref: `pages:row-${index + 1}` }));
	const first = rows.slice(0, 10).map((row) => row.ref);
	assert.deepEqual(contentHealthFreshnessRefs(rows), first);
	assert.deepEqual(contentHealthFreshnessRefs(rows, null), first);
	assert.deepEqual(contentHealthFreshnessRefs(rows, "pages:row-4"), first, "a focused row already checked is not repeated");
	assert.deepEqual(contentHealthFreshnessRefs(rows, "pages:row-12"), [...first, "pages:row-12"], "a focused row further down is added once");
	assert.deepEqual(contentHealthFreshnessRefs(rows.slice(0, 3), "posts:focused"), ["pages:row-1", "pages:row-2", "pages:row-3", "posts:focused"]);
	assert.deepEqual(contentHealthFreshnessRefs([]), []);
});

console.log(`Overview model selfcheck passed (${cases} cases).`);
