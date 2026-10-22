import assert from "node:assert/strict";
import { analyzeSeoContent, seoAnalysisPresentation, summarizeSeoChecks, type SeoAnalysisInput } from "../analysis.ts";
import { buildScoreTrends, createScoreSnapshot } from "../score-history.ts";
import "./score-contract.selfcheck.ts";
import { composeSeoSchema, defaultSeoSchemaComposerInput } from "../schema-composer.ts";

import {
	CORE_SEO_MIGRATION_VERSION,
	SEO_ADMIN_CONFIGURATION_VERSION,
	SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_CRAWL_DIAGNOSTICS_VERSION,
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	SEO_ADMIN_MODULES_STORAGE_VERSION,
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION,
	SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	SEO_ADMIN_SITEMAP_STORAGE_VERSION,
	SEO_ADMIN_OUTPUT_SUPPORT,
	SEO_ADMIN_TEMPLATE_DEFINITIONS,
	SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	SEO_PORTABILITY_FORMAT,
	SEO_PORTABILITY_VERSION,
	SEO_SCORE_VERSION,
	INDEXNOW_ENDPOINT,
	INDEXNOW_PROTOCOL_VERSION,
	defaultIndexNowSettings,
	defaultSeoAdminSitemapValues,
	defaultSeoAdminTemplateSet,
	seoModuleIsEditable,
	type SeoAdminScoreSnapshot,
	type SeoPortabilityBundle,
	type SeoPortabilityImportPlan,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	parseSeoAdminConfiguration,
	parseSeoAdminCrawlDiagnostics,
	parseSeoAdmin404Monitor,
	parseSeoAdmin404TriageResult,
	parseSeoAdminContentOptions,
	parseSeoAdminContentScores,
	parseSeoAdminContentAudit,
	parseSeoAdminEntryAnalysisIdentityResult,
	parseSeoAdminSavedAnalysisResult,
	parseSeoAdminScoreScanResult,
	parseSeoAdminScoreScanStateResult,
	parseSeoAdminScoreScanTaxonomiesResult,
	parseSeoAdminScoreScanTermsResult,
	parseSeoAdminContentAuditOptions,
	parseSeoAdminEntryDirectivesResult,
	parseSeoAdminEntrySchemaPreviewResult,
	parseSeoAdminFocusKeywordSaveResult,
	parseSeoAdminAnalysisProfileResult,
	parseSeoAdminScoreTrends,
	parseSeoAdminCustomSchemaReadResult,
	parseSeoAdminSchemaPresetConfiguration,
	parseSeoAdminCustomSchemaDeleteResult,
	parseSeoAdminCustomSchemaSaveResult,
	parseSeoAdminSchemaComposerSaveResult,
	parseSeoAdminModulesSaveResult,
	parseSeoAdminMigrationOperationResult,
	parseSeoAdminMigrationPlan,
	parseSeoAdminMigrationStatus,
	parseSeoAdminIndexNowHistoryResult,
	parseSeoAdminIndexNowHistoryUrlsResult,
	parseSeoAdminRedirectRuleCreateResult,
	parseSeoAdminRedirectRuleListResult,
	parseSeoAdminIndexNowOperationResult,
	parseSeoAdminIndexNowSaveResult,
	parseSeoAdminIndexNowStatus,
	parseSeoAdminOverview,
	parseSeoAdminRefreshResult,
	parseSeoAdminSchemaContentTypesReadResult,
	parseSeoAdminSchemaContentTypesSaveResult,
	parseSeoAdminSchemaPresetsSaveResult,
	parseSeoAdminSettings,
	parseSeoCollectionAnalysisProfileResult,
	parseSeoCollectionAnalysisProfileSaveResult,
	parseSeoAdminSettingsSaveResult,
	parseSeoAdminSitemap,
	parseSeoAdminSitemapPreview,
	parseSeoAdminSitemapSaveResult,
	parseSeoAdminEntryPreviewResult,
	parseSeoAdminSocialOverrideSaveResult,
	parseSeoAdminTemplateConfiguration,
	parseSeoAdminTemplateExampleResult,
	parseSeoAdminTemplatesSaveResult,
	parseSeoPortabilityApplyResult,
	parseSeoPortabilityExportResponse,
	parseSeoPortabilityPreviewResult,
} from "./contract.ts";
import { parseSeoAdminPublisherOwnershipReadResult, parseSeoAdminPublisherOwnershipWriteResult } from "./contract.ts";
import { parseSeoAdminLegacyDiscardResponse, parseSeoAdminLegacyDiscardResult } from "./contract.ts";
import { SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES } from "../admin-contract.ts";

const scoreAnalysisInput: SeoAnalysisInput = {
	ref: "posts:post-1", collection: "posts", entryId: "post-1", slug: "a-useful-post",
	title: "A useful post", description: "A useful post explains practical steps and links to related guidance.",
	url: "https://shipitdigital.nl/blog/a-useful-post", canonicalStatus: "matches",
	image: "https://shipitdigital.nl/social/a-useful-post.jpg", noindex: false,
	body: "A useful post explains the steps in plain language. Readers can compare the examples and choose a useful next step.",
	document: [
		{ _type: "block", style: "h2", markDefs: [], children: [{ _type: "span", text: "A useful post", marks: [] }] },
		{ _type: "block", style: "normal", markDefs: [{ _key: "guide", _type: "link", href: "/guides" }], children: [
			{ _type: "span", text: "A useful post explains practical steps. Read the ", marks: [] },
			{ _type: "span", text: "related guidance", marks: ["guide"] },
			{ _type: "span", text: " to compare the examples and choose your next step.", marks: [] },
		] },
	],
	focusKeywords: ["useful post", "secondary topic"],
	assessmentProfile: { profile: "article", version: 1 }, schemaEnabled: false, schemaPreset: "",
	sourceUpdatedAt: "2026-07-14T09:00:00.000Z",
};
const currentScoreAssessment = analyzeSeoContent(scoreAnalysisInput);
const currentScorePresentation = seoAnalysisPresentation(currentScoreAssessment);
const currentCheckSummary = summarizeSeoChecks(currentScoreAssessment.checks);
// Needs attention counts Failed and Partly met rows only.
const currentNeedsAttention = currentCheckSummary.issues > 0;

const fixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	generatedAt: "2026-07-14T10:00:00.000Z",
	engineVersion: SEO_ENGINE_VERSION,
	readiness: { score: 84, state: "ready", title: "Ready", description: "Healthy" },
	site: {
		name: "Shipit Digital",
		url: "https://shipitdigital.nl",
		indexable: true,
		robotsMode: "none",
		settingsState: "saved",
		defaultSocialImage: null,
		socialProfileCount: 3,
	},
	summary: {
		totalScored: 1,
		sampleSize: 1,
		averageContentScore: currentScoreAssessment.score,
		needsAttention: Number(currentNeedsAttention),
		schemaPresetsEnabled: 5,
		schemaPresetsTotal: 12,
		customSchemas: 0,
		legacyOverrides: 0,
		migrationRecords: 0,
		enabledModules: 2,
		totalModules: 2,
	},
	priorities: [],
	checks: [],
	content: [
		{
			ref: "posts:post-1",
			entryId: "post-1",
			collection: "posts",
			collectionLabel: "Posts",
			title: "A useful post",
			score: currentScoreAssessment.score,
			grade: currentScoreAssessment.grade,
			presentation: currentScorePresentation,
			needsAttention: currentNeedsAttention,
			firstIssue: "Core checks are passing.",
			updatedAt: "2026-07-14T10:00:00.000Z",
		},
	],
};

assert.equal(parseSeoAdminOverview(fixture).readiness.score, 84);
assert.equal(
	parseSeoAdminOverview({ ...fixture, site: { ...fixture.site, indexable: null, robotsMode: "unknown", settingsState: "corrupt" } }).site.indexable,
	null,
	"unreadable settings report an unknown indexing state",
);
for (const site of [
	{ ...fixture.site, robotsMode: "index,follow" },
	{ ...fixture.site, indexable: false, robotsMode: "none" },
	{ ...fixture.site, indexable: null, robotsMode: "unknown", settingsState: "absent" },
	{ ...fixture.site, indexable: true, robotsMode: "none", settingsState: "unavailable" },
]) {
	assert.throws(() => parseSeoAdminOverview({ ...fixture, site }), /site.indexing/);
}
assert.throws(
	() => parseSeoAdminOverview({ ...fixture, contractVersion: SEO_ADMIN_CONTRACT_VERSION - 1 }),
	new RegExp(
		`expected contract ${SEO_ADMIN_CONTRACT_VERSION}, received ${SEO_ADMIN_CONTRACT_VERSION - 1}.*Restart EmDash`,
	),
);

const scoreRefreshFixture = {
	success: true,
	collection: "posts",
	updated: 100,
	scoreVersion: SEO_SCORE_VERSION,
	revision: `sha256-${"a".repeat(64)}`,
	cursor: "posts-page-2",
	hasMore: true,
};
assert.equal(parseSeoAdminRefreshResult(scoreRefreshFixture).cursor, "posts-page-2");
assert.throws(
	() => parseSeoAdminRefreshResult({ ...scoreRefreshFixture, collection: undefined }),
	/scoreRefresh.root/,
);
assert.throws(
	() => parseSeoAdminRefreshResult({ ...scoreRefreshFixture, updated: 101 }),
	/scoreRefresh.root/,
);
assert.throws(
	() => parseSeoAdminRefreshResult({ ...scoreRefreshFixture, revision: "stale" }),
	/scoreRefresh.root/,
);
assert.throws(
	() => parseSeoAdminRefreshResult({ ...scoreRefreshFixture, cursor: null }),
	/scoreRefresh.root/,
);

const crawlDiagnosticsFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	generatedAt: "2026-07-17T10:00:00.000Z",
	diagnosticsVersion: SEO_CRAWL_DIAGNOSTICS_VERSION,
	limits: { maxEntries: 1_000, maxLinks: 20_000, maxFindingsPerType: 250, maxDocumentNodes: 5_000, maxTotalDocumentNodes: 100_000, inspectedRecords: 3, scannedDocumentNodes: 8, reachedEntryLimit: false, reachedLinkLimit: false, reachedDocumentLimit: false, unresolvedLinksOmitted: 0, orphanEntriesOmitted: 0 },
	coverage: "partial",
	summary: {
		scannedEntries: 3,
		indexableEntries: 3,
		knownRoutes: 4,
		scannedLinks: 2,
		matchedInternalLinks: 1,
		unresolvedInternalLinks: 1,
		possibleOrphans: 1,
		structuredSources: 2,
		partialSources: 1,
	},
	unresolvedLinks: [
		{
		id: "link-12345678",
		sourceRef: "posts:post-1",
		sourceCollection: "posts",
		sourceEntryId: "post-1",
		sourceTitle: "A useful post",
		sourcePath: "/blog/useful-post",
		href: "/missing",
		targetPath: "/missing",
		anchorText: "Missing page",
		},
	],
	orphanEntries: [
		{
		ref: "pages:about",
		collection: "pages",
		entryId: "about",
		title: "About",
		path: "/about",
		incomingLinks: 0,
		confidence: "review",
		},
	],
};

assert.equal(
	parseSeoAdminCrawlDiagnostics(crawlDiagnosticsFixture).unresolvedLinks[0]?.targetPath,
	"/missing",
);
assert.throws(
	() => parseSeoAdminCrawlDiagnostics({ ...crawlDiagnosticsFixture, coverage: "unknown" }),
	/crawlDiagnostics/,
);
assert.throws(
	() =>
		parseSeoAdminCrawlDiagnostics({
		...crawlDiagnosticsFixture,
		summary: { ...crawlDiagnosticsFixture.summary, unresolvedInternalLinks: 2 },
	}),
	/crawlDiagnostics\.summary\.integrity/,
);

const notFoundMonitorFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	generatedAt: "2026-07-17T10:00:00.000Z",
	engineVersion: SEO_ENGINE_VERSION,
	enabled: true,
	summary: { totalHits: 4, uniquePaths: 1, openPaths: 1, resolvedPaths: 0 },
	items: [
		{
		id: "404-12345678",
		path: "/servcies",
		hits: 4,
		firstSeenAt: "2026-07-17T09:00:00.000Z",
		lastSeenAt: "2026-07-17T10:00:00.000Z",
		status: "open",
		redirectTarget: null,
		suggestions: [{ path: "/services", title: "Services", collection: "pages", score: 0.88 }],
		},
	],
};

assert.equal(
	parseSeoAdmin404Monitor(notFoundMonitorFixture).items[0]?.suggestions[0]?.path,
	"/services",
);
assert.equal(
	parseSeoAdmin404TriageResult({ success: true, monitor: notFoundMonitorFixture }).success,
	true,
);
assert.throws(
	() =>
		parseSeoAdmin404Monitor({
			...notFoundMonitorFixture,
			items: [{ ...notFoundMonitorFixture.items[0], hits: -1 }],
		}),
	/404Monitor.items/,
);
assert.throws(
	() => parseSeoAdminOverview({ ...fixture, contractVersion: undefined }),
	/expected contract .* received missing/,
);
assert.throws(
	() => parseSeoAdminOverview({ ...fixture, content: [{ ref: "broken" }] }),
	/content item/,
);

const contentOptionsFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	generatedAt: "2026-07-14T10:00:00.000Z",
	engineVersion: SEO_ENGINE_VERSION,
	collections: [
		{
			collection: "posts",
			label: "Blog posts",
			labelSingular: "Blog post",
			hasSeo: true,
			urlPattern: "/blog/{slug}",
			routable: true,
		},
	],
	items: [
		{
		ref: "posts:post-1",
		entryId: "post-1",
		collection: "posts",
		collectionLabel: "Blog posts",
		title: "A useful post",
		updatedAt: "2026-07-14T10:00:00.000Z",
		},
	],
};

assert.equal(parseSeoAdminContentOptions(contentOptionsFixture).items[0]?.ref, "posts:post-1");
assert.throws(
	() => parseSeoAdminContentOptions({ ...contentOptionsFixture, cursor: "next-page" }),
	/contentOptions.page/,
);
assert.throws(
	() => parseSeoAdminContentOptions({ ...contentOptionsFixture, hasMore: true }),
	/contentOptions.page/,
);
const auditOptionsFixture = { ...contentOptionsFixture, hasMore: false };
assert.equal(parseSeoAdminContentAuditOptions(auditOptionsFixture).items.length, 1);
assert.equal(parseSeoAdminContentAuditOptions({ ...auditOptionsFixture, items: [] }).items.length, 0);
assert.equal(parseSeoAdminContentAuditOptions({
	...auditOptionsFixture, hasMore: true, cursor: "next-page",
}).cursor, "next-page");
for (const invalidOptions of [
	{ ...auditOptionsFixture, hasMore: undefined },
	{ ...auditOptionsFixture, hasMore: true },
	{ ...auditOptionsFixture, cursor: "next-page" },
	{ ...auditOptionsFixture, hasMore: true, cursor: " " },
	{ ...auditOptionsFixture, generatedAt: "invalid" },
	{ ...auditOptionsFixture, items: [{ ...auditOptionsFixture.items[0], sourceVersion: "" }] },
	{ ...auditOptionsFixture, items: [...auditOptionsFixture.items, ...auditOptionsFixture.items] },
	{ ...auditOptionsFixture, items: [{ ...auditOptionsFixture.items[0], entryId: "other" }] },
	{ ...auditOptionsFixture, items: [{ ...auditOptionsFixture.items[0], updatedAt: "invalid" }] },
	{ ...auditOptionsFixture, items: Array.from({ length: 26 }, (_, index) => ({
		...auditOptionsFixture.items[0], ref: `posts:${index}`, entryId: String(index),
	})) },
]) {
	assert.throws(() => parseSeoAdminContentAuditOptions(invalidOptions), /(contentAuditOptions|contentOptions)\./);
}
assert.throws(
	() =>
		parseSeoAdminContentOptions({
			...contentOptionsFixture,
			items: [{ ...contentOptionsFixture.items[0], title: 42 }],
		}),
	/contentOptions.item/,
);

const contentScoreFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	generatedAt: "2026-07-14T10:00:00.000Z",
	engineVersion: SEO_ENGINE_VERSION,
	scoreVersion: SEO_SCORE_VERSION,
	items: [{
		...currentScoreAssessment,
		analysisRevision: 1,
		freshness: "current" as const,
		assessmentProfileRevision: "profile-r1",
		keywords: ["useful post", "secondary topic"],
		profileKeywords: ["useful post", "secondary topic"],
		focusKeywordSource: "profile" as const,
		pillar: false,
		updatedAt: "2026-07-14T10:00:00.000Z",
		templateUpdatedAt: null,
		modulesUpdatedAt: "2026-07-14T08:00:00.000Z",
		configurationFingerprint: "seo-config-v1-fixture",
		metaOverrideUpdatedAt: null,
	}],
	cursor: undefined,
	hasMore: false,
};

assert.equal(parseSeoAdminContentScores(contentScoreFixture).items[0]?.score, currentScoreAssessment.score);
// Current checks need a known basis; legacy snapshots stay readable without one.
const fixtureCheck = contentScoreFixture.items[0].checks.find((check) => check.id === "title")!;
const withCheck = (check: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	...contentScoreFixture,
	items: [{ ...contentScoreFixture.items[0], checks: extra.scoreVersion === SEO_SCORE_VERSION - 1
		? [check] : currentScoreAssessment.checks.map((item) => item.id === fixtureCheck.id ? check : item), ...extra }],
});
const legacyCheck = (({ basis: _basis, limitation: _limitation, ...rest }) => rest)(fixtureCheck);
assert.equal(
	parseSeoAdminContentScores(withCheck(legacyCheck, { scoreVersion: SEO_SCORE_VERSION - 1, freshness: "stale" })).items[0]?.checks[0]?.id,
	"title",
	"a legacy snapshot without evaluation basis is readable",
);
for (const [name, check] of [
	["a current check without basis", legacyCheck],
	["an unknown basis", { ...fixtureCheck, basis: "verified" }],
	["an empty limitation", { ...fixtureCheck, limitation: " " }],
	["a weighted unavailable check", { ...fixtureCheck, basis: "unavailable", severity: "info", status: "review" }],
	["a passed unavailable check", { ...fixtureCheck, basis: "unavailable", severity: "info", weight: 0 }],
	["a failed not-applicable check", { ...fixtureCheck, basis: "not-applicable", severity: "info", weight: 0, status: "fail" }],
	["an unknown condition", { ...fixtureCheck, condition: "paused", weight: 0, basis: "measured" }],
] as const) {
	assert.throws(() => parseSeoAdminContentScores(withCheck(check as Record<string, unknown>)), /contentScores.items/, name);
}
assert.throws(
	() => parseSeoAdminContentScores(withCheck({ ...fixtureCheck, basis: "verified" }, { scoreVersion: SEO_SCORE_VERSION - 1, freshness: "stale" })),
	/contentScores.items/,
	"a legacy snapshot may omit the basis but never carry an unknown one",
);
const identityFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	success: true,
	ref: "posts:post-1",
	identity: {
		scoreVersion: SEO_SCORE_VERSION,
		configurationFingerprint: "seo-config-v1-fixture",
		templateUpdatedAt: null,
		modulesUpdatedAt: "2026-07-14T08:00:00.000Z",
		metaOverrideUpdatedAt: null,
		sourceVersion: "[3,null,\"2026-07-14T09:00:00.000Z\",\"811c9dc5\",null]",
		locale: "en",
		entryInputFingerprint: `sha256-${"0".repeat(64)}`,
	},
};
assert.equal(parseSeoAdminEntryAnalysisIdentityResult(identityFixture, "posts:post-1").success, true);
assert.equal(
	parseSeoAdminEntryAnalysisIdentityResult({ ...identityFixture, success: false, identity: undefined, error: "content_not_found" }, "posts:post-1").success,
	false,
);
for (const [name, value, ref] of [
	["another entry's identity", identityFixture, "posts:post-2"],
	["another contract version", { ...identityFixture, contractVersion: SEO_ADMIN_CONTRACT_VERSION - 1 }, "posts:post-1"],
	["an unknown failure", { ...identityFixture, success: false, error: "denied" }, "posts:post-1"],
	["a missing fingerprint", { ...identityFixture, identity: { ...identityFixture.identity, configurationFingerprint: "" } }, "posts:post-1"],
	["a modules timestamp that is not a date", { ...identityFixture, identity: { ...identityFixture.identity, modulesUpdatedAt: "soon" } }, "posts:post-1"],
	["a missing analyzer version", { ...identityFixture, identity: { ...identityFixture.identity, scoreVersion: 0 } }, "posts:post-1"],
	["an empty saved version", { ...identityFixture, identity: { ...identityFixture.identity, sourceVersion: "" } }, "posts:post-1"],
	["a missing saved version", { ...identityFixture, identity: { ...identityFixture.identity, sourceVersion: undefined } }, "posts:post-1"],
	["a non-string locale", { ...identityFixture, identity: { ...identityFixture.identity, locale: 7 } }, "posts:post-1"],
	["a missing entry input token", { ...identityFixture, identity: { ...identityFixture.identity, entryInputFingerprint: undefined } }, "posts:post-1"],
	["a malformed entry input token", { ...identityFixture, identity: { ...identityFixture.identity, entryInputFingerprint: "md5-1" } }, "posts:post-1"],
] as const) {
	assert.throws(() => parseSeoAdminEntryAnalysisIdentityResult(value, ref), /entryAnalysisIdentity|contract version/i, name);
}
const contentAuditFixture = {
	...contentScoreFixture,
	persistence: "session",
	items: [{ ...contentScoreFixture.items[0], analysisRevision: 0, persistence: "session" }],
	failures: [{ ref: "posts:missing", error: "content_not_found" }],
};
assert.equal(parseSeoAdminContentAudit(contentAuditFixture).items[0]?.analysisRevision, 0);
const token = `sha256-${"f".repeat(64)}`;
assert.equal(parseSeoAdminContentAudit({ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], entryInputFingerprint: token }] }).items[0]?.entryInputFingerprint, token);
assert.throws(() => parseSeoAdminContentAudit({ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], entryInputFingerprint: "abc" }] }), /contentAudit\.items/);
assert.throws(() => parseSeoAdminContentScores({ ...contentScoreFixture, items: [{ ...contentScoreFixture.items[0], entryInputFingerprint: token }] }), /contentScores\.items/, "stored scores carry no entry input token");
assert.equal(parseSeoAdminContentAudit(contentAuditFixture).failures[0]?.ref, "posts:missing");

// Stored input identities: any tag stays readable, session results carry none.
const inputIdentity = `seo-input-v1-sha256-${"a".repeat(64)}`;
const { freshness: _fixtureFreshness, ...storedFixtureItem } = contentScoreFixture.items[0] as Record<string, unknown>;
const storedItem: Record<string, any> = { ...storedFixtureItem, sourceVersion: "saved-3", inputIdentity };
assert.equal(parseSeoAdminContentScores({ ...contentScoreFixture, items: [storedItem] }).items[0]?.inputIdentity, inputIdentity);
assert.equal(parseSeoAdminContentScores({ ...contentScoreFixture, items: [{ ...storedItem, inputIdentity: `seo-input-v2-sha256-${"b".repeat(64)}` }] }).items.length, 1,
	"a later identity tag is readable even though this engine never reuses it");
for (const [name, value] of [
	["an untagged digest", { ...contentScoreFixture, items: [{ ...storedItem, inputIdentity: `sha256-${"a".repeat(64)}` }] }],
	["a short digest", { ...contentScoreFixture, items: [{ ...storedItem, inputIdentity: "seo-input-v1-sha256-abc" }] }],
] as const) assert.throws(() => parseSeoAdminContentScores(value), /contentScores\.items/, name);
assert.throws(() => parseSeoAdminContentAudit({ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], inputIdentity }] }), /contentAudit\.items/,
	"session results never carry a stored input identity");
const unreadableTemplateItem = { ...storedFixtureItem, templateUpdatedAt: "unreadable-templates" };
assert.equal(parseSeoAdminContentScores({ ...contentScoreFixture, items: [unreadableTemplateItem] }).items[0]?.templateUpdatedAt, "unreadable-templates",
	"a stored score recorded while templates were unreadable stays readable history");
assert.throws(() => parseSeoAdminContentScores({ ...contentScoreFixture, items: [{ ...storedFixtureItem, templateUpdatedAt: "not-a-token" }] }), /contentScores\.items/,
	"control: other template tokens are still refused");
assert.equal(parseSeoAdminContentScores({ ...contentScoreFixture, items: [{ ...unreadableTemplateItem, freshness: "stale" }] }).items[0]?.freshness, "stale");
assert.throws(() => parseSeoAdminContentScores({ ...contentScoreFixture, items: [{ ...unreadableTemplateItem, freshness: "current" }] }), /contentScores\.items/,
	"a score recorded with unreadable templates is never current");
assert.throws(() => parseSeoAdminContentAudit({ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], templateUpdatedAt: "unreadable-templates" }] }), /contentAudit\.items/);

// Durable saved analysis: exactly the requested entry, a named outcome and history apart.
const savedRef = storedItem.ref;
const savedFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, ref: savedRef,
	success: true, outcome: "saved", history: "created", item: storedItem,
};
for (const history of ["created", "unchanged", "failed", "uncertain", "not-attempted"])
	assert.equal(parseSeoAdminSavedAnalysisResult({ ...savedFixture, history }, savedRef).success, true, history);
assert.equal(parseSeoAdminSavedAnalysisResult({ ...savedFixture, outcome: "reused", history: "not-attempted" }, savedRef).success, true);
for (const error of ["scoring_disabled", "scoring_unavailable", "superseded", "uncertain", "locale_mismatch", "analysis_failed"])
	assert.equal(parseSeoAdminSavedAnalysisResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, ref: savedRef, success: false, error }, savedRef).success, false, error);
for (const [name, value, ref] of [
	["another requested ref", savedFixture, "posts:other"],
	["reuse that claims a history write", { ...savedFixture, outcome: "reused", history: "created" }, savedRef],
	["a save without a history outcome", { ...savedFixture, history: undefined }, savedRef],
	["a save with an unknown history outcome", { ...savedFixture, history: "pending" }, savedRef],
	["an array history outcome", { ...savedFixture, history: ["not-attempted"] }, savedRef],
	["a null history outcome", { ...savedFixture, history: null }, savedRef],
	["an object history outcome", { ...savedFixture, history: {} }, savedRef],
	["a numeric history outcome", { ...savedFixture, history: 0 }, savedRef],
	["an unknown outcome", { ...savedFixture, outcome: "current" }, savedRef],
	["an item for another entry", { ...savedFixture, item: { ...storedItem, ref: "posts:other", entryId: "other" } }, savedRef],
	["an item whose ref disagrees with its collection and entry", { ...savedFixture, item: { ...storedItem, entryId: "other" } }, savedRef],
	["a session item", { ...savedFixture, item: { ...storedItem, persistence: "session", analysisRevision: 0 } }, savedRef],
	["an item that claims freshness", { ...savedFixture, item: { ...storedItem, freshness: "current" } }, savedRef],
	["an item without an input identity", { ...savedFixture, item: { ...storedItem, inputIdentity: undefined } }, savedRef],
	["an item without a saved version", { ...savedFixture, item: { ...storedItem, sourceVersion: undefined } }, savedRef],
	["an older analyzer item", { ...savedFixture, item: { ...storedItem, scoreVersion: SEO_SCORE_VERSION - 1, freshness: "stale" } }, savedRef],
	["an item recorded with unreadable templates", { ...savedFixture, item: { ...storedItem, templateUpdatedAt: "unreadable-templates" } }, savedRef],
	["an unknown failure", { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, ref: savedRef, success: false, error: "saved" }, savedRef],
] as const) assert.throws(() => parseSeoAdminSavedAnalysisResult(value, ref), /savedAnalysis|contract version/i, name);
assert.equal(parseSeoAdminContentAudit({
	...contentAuditFixture,
	items: [{ ...contentAuditFixture.items[0], sourceVersion: "saved-2", sourceKind: "saved-snapshot" }],
}).items[0]?.sourceVersion, "saved-2");
assert.deepEqual(parseSeoAdminContentAudit({ ...contentAuditFixture, items: [] }).items, []);
assert.throws(() => parseSeoAdminContentScores(contentAuditFixture), /contentScores.metadata/);
assert.throws(() => parseSeoAdminContentScores({ ...contentAuditFixture, items: [] }), /contentScores.metadata/);
assert.throws(() => parseSeoAdminContentScores({
	...contentScoreFixture,
	items: [{ ...contentScoreFixture.items[0], persistence: "session" }],
}), /contentScores.items/);
assert.throws(() => parseSeoAdminContentScores({
	...contentScoreFixture,
	items: [{ ...contentScoreFixture.items[0], analysisRevision: 0 }],
}), /contentScores.items/);
for (const invalidAudit of [
	{ ...contentAuditFixture, persistence: undefined },
	{ ...contentAuditFixture, hasMore: true },
	{ ...contentAuditFixture, cursor: "next" },
	{ ...contentAuditFixture, items: contentScoreFixture.items },
	{ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], analysisRevision: 1 }] },
	{ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], freshness: "stale" }] },
	{ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], persistence: undefined }] },
	{ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], entryId: "other" }] },
	{ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], sourceVersion: "x".repeat(2_049) }] },
	{ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], sourceKind: "saved-snapshot" }] },
	{ ...contentAuditFixture, items: [{ ...contentAuditFixture.items[0], sourceVersion: "saved-2", sourceKind: "unknown" }] },
	{ ...contentAuditFixture, failures: [{ ref: "posts:missing", error: "" }] },
	{ ...contentAuditFixture, failures: [{ ref: "posts:post-1", error: "duplicate" }] },
	{ ...contentAuditFixture, items: [], failures: [] },
	{ ...contentAuditFixture, items: [], failures: Array.from({ length: 26 }, (_, index) => ({ ref: `posts:${index}`, error: "missing" })) },
]) {
	assert.throws(() => parseSeoAdminContentAudit(invalidAudit), /contentAudit\./);
}
assert.equal(
	parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [
			{
			...contentScoreFixture.items[0],
			scoreVersion: Math.max(1, SEO_SCORE_VERSION - 1),
			freshness: "stale",
			},
		],
	}).items[0]?.freshness,
	"stale",
);
assert.throws(
	() =>
		parseSeoAdminContentScores({
		...contentScoreFixture,
			items: [
				{
			...contentScoreFixture.items[0],
			scoreVersion: Math.max(1, SEO_SCORE_VERSION - 1),
			freshness: undefined,
				},
			],
	}),
	/contentScores.items/,
);
assert.deepEqual(
	parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [{ ...contentScoreFixture.items[0], keyword: undefined, keywords: [] }],
	}).items[0]?.keywords,
	[],
);
assert.throws(
	() =>
		parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [{ ...contentScoreFixture.items[0], keywords: [] }],
	}),
	/contentScores.items/,
);
assert.throws(
	() => parseSeoAdminContentScores({ ...contentScoreFixture, scoreVersion: SEO_SCORE_VERSION + 1 }),
	/contentScores.metadata/,
);
assert.throws(
	() =>
		parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [{ ...contentScoreFixture.items[0], score: 101 }],
	}),
	/contentScores.items/,
);
assert.throws(
	() =>
		parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [{ ...contentScoreFixture.items[0], modulesUpdatedAt: "not-a-date" }],
	}),
	/contentScores.items/,
);
assert.throws(
	() =>
		parseSeoAdminContentScores({
		...contentScoreFixture,
			items: [
				{
			...contentScoreFixture.items[0],
					checks: [
						{
							...contentScoreFixture.items[0].checks[0],
							evidence: { actual: {}, expected: "x", source: "x" },
						},
					],
				},
			],
	}),
	/contentScores.items/,
);
assert.throws(
	() => parseSeoAdminContentScores({ ...contentScoreFixture, cursor: 42 }),
	/contentScores.cursor/,
);
assert.throws(
	() => parseSeoAdminContentScores({ ...contentScoreFixture, generatedAt: "not-a-date" }),
	/contentScores.metadata/,
);
assert.throws(
	() =>
		parseSeoAdminContentScores({
		...contentScoreFixture,
			items: [
				{
			...contentScoreFixture.items[0],
			metrics: { ...contentScoreFixture.items[0].metrics, wordCount: 3.5 },
				},
			],
	}),
	/contentScores.items/,
);

// --- keyword ownership on score records ------------------------------------
// Current-version scores always carry profileKeywords + focusKeywordSource.
assert.throws(
	() =>
		parseSeoAdminContentScores({
		...contentScoreFixture,
			items: [
				{
			...contentScoreFixture.items[0],
			profileKeywords: undefined,
			focusKeywordSource: undefined,
				},
			],
	}),
	/contentScores.items/,
);
assert.throws(
	() =>
		parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [{ ...contentScoreFixture.items[0], focusKeywordSource: "guess" }],
	}),
	/contentScores.items/,
);
// Inherited content keyword: effective list present, no profile statement.
assert.equal(
	parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [
			{
			...contentScoreFixture.items[0],
			keyword: "useful post",
			keywords: ["useful post"],
			profileKeywords: null,
			focusKeywordSource: "content",
			},
		],
	}).items[0]?.focusKeywordSource,
	"content",
);
// Intentionally cleared profile: empty statement, nothing effective.
assert.deepEqual(
	parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [
			{
			...contentScoreFixture.items[0],
			keyword: undefined,
			keywords: [],
			profileKeywords: [],
			focusKeywordSource: "none",
			},
		],
	}).items[0]?.profileKeywords,
	[],
);
// Stale last-known records may predate ownership metadata.
assert.equal(
	parseSeoAdminContentScores({
		...contentScoreFixture,
		items: [
			{
			...contentScoreFixture.items[0],
			scoreVersion: Math.max(1, SEO_SCORE_VERSION - 1),
			freshness: "stale",
			profileKeywords: undefined,
			focusKeywordSource: undefined,
			},
		],
	}).items[0]?.freshness,
	"stale",
);

const focusKeywordResult = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	success: true,
	ref: "posts:post-1",
	profile: {
		storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
		ref: "posts:post-1",
		keyword: "useful post",
		keywords: ["useful post", "secondary topic"],
		pillar: false,
		updatedAt: "2026-07-14T10:00:00.000Z",
	},
	item: contentScoreFixture.items[0],
};
assert.equal(parseSeoAdminFocusKeywordSaveResult(focusKeywordResult).success, true);
const profileOnlyAcknowledgement = { ...focusKeywordResult, item: null };
const parsedProfileOnly = parseSeoAdminFocusKeywordSaveResult(profileOnlyAcknowledgement);
assert.equal(parsedProfileOnly.success && parsedProfileOnly.ref, "posts:post-1");
assert.equal(parsedProfileOnly.success && parsedProfileOnly.item, null);
assert.deepEqual(parsedProfileOnly.success && parsedProfileOnly.profile, focusKeywordResult.profile);
assert.equal(parseSeoAdminFocusKeywordSaveResult({ ...profileOnlyAcknowledgement, profile: null }).success, true);
for (const result of [
	{ ...focusKeywordResult, ref: undefined },
	{ ...focusKeywordResult, ref: "posts:" },
	{ ...focusKeywordResult, profile: { ...focusKeywordResult.profile, ref: "posts:other" } },
	{ ...focusKeywordResult, item: { ...focusKeywordResult.item, ref: "posts:other" } },
	{ ...profileOnlyAcknowledgement, profile: undefined },
	{ ...profileOnlyAcknowledgement, item: undefined },
	{ ...profileOnlyAcknowledgement, item: contentAuditFixture.items[0] },
]) {
	assert.throws(() => parseSeoAdminFocusKeywordSaveResult(result), /focusKeyword.result/);
}
assert.equal(
	parseSeoAdminFocusKeywordSaveResult({ ...focusKeywordResult, profile: null }).success,
	true,
);
// Cleared profiles (empty keyword statement) are a valid stored state.
assert.equal(
	parseSeoAdminFocusKeywordSaveResult({
		...focusKeywordResult,
		profile: {
			storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
			ref: "posts:post-1",
			keyword: "",
			keywords: [],
			pillar: true,
			updatedAt: "2026-07-14T10:00:00.000Z",
		},
	}).success,
	true,
);
// v4 null statements (pillar-only profiles) are valid and pair with keyword "".
assert.equal(
	parseSeoAdminFocusKeywordSaveResult({
		...focusKeywordResult,
		profile: {
			storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
			ref: "posts:post-1",
			keyword: "",
			keywords: null,
			pillar: true,
			updatedAt: "2026-07-14T10:00:00.000Z",
		},
	}).success,
	true,
);
assert.throws(() =>
	parseSeoAdminFocusKeywordSaveResult({
		...focusKeywordResult,
		profile: {
			storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
			ref: "posts:post-1",
			keyword: "useful post",
			keywords: null,
			pillar: true,
			updatedAt: "2026-07-14T10:00:00.000Z",
		},
	}),
);
// A profile without the pillar flag is a contract violation in v4.
assert.throws(() =>
	parseSeoAdminFocusKeywordSaveResult({
		...focusKeywordResult,
		profile: {
			storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
			ref: "posts:post-1",
			keyword: "useful post",
			keywords: ["useful post"],
			updatedAt: "2026-07-14T10:00:00.000Z",
		},
	}),
);
assert.equal(
	parseSeoAdminFocusKeywordSaveResult({
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	success: false,
	error: "keyword_too_long",
	}).success,
	false,
);
assert.throws(
	() =>
		parseSeoAdminFocusKeywordSaveResult({
			...focusKeywordResult,
			profile: { ...focusKeywordResult.profile, storageVersion: 99 },
		}),
	/focusKeyword.result/,
);

const analysisProfileResult = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	success: true,
	ref: focusKeywordResult.ref,
	profile: focusKeywordResult.profile,
};
const parsedAnalysisProfile = parseSeoAdminAnalysisProfileResult(analysisProfileResult);
assert.equal(parsedAnalysisProfile.success && parsedAnalysisProfile.ref, "posts:post-1");
assert.deepEqual(parsedAnalysisProfile.success && parsedAnalysisProfile.profile, focusKeywordResult.profile);
assert.equal(parseSeoAdminAnalysisProfileResult({ ...analysisProfileResult, profile: null }).success, true);
for (const keywords of [null, []]) {
	assert.equal(parseSeoAdminAnalysisProfileResult({
		...analysisProfileResult,
		profile: { ...focusKeywordResult.profile, keyword: "", keywords, pillar: true },
	}).success, true);
}
for (const result of [
	{ ...analysisProfileResult, ref: undefined },
	{ ...analysisProfileResult, ref: "posts:" },
	{ ...analysisProfileResult, profile: undefined },
	{ ...analysisProfileResult, profile: { ...focusKeywordResult.profile, ref: "posts:other" } },
	{ ...analysisProfileResult, profile: { ...focusKeywordResult.profile, keyword: "wrong primary" } },
	{ ...analysisProfileResult, profile: { ...focusKeywordResult.profile, pillar: undefined } },
	{ ...analysisProfileResult, profile: { ...focusKeywordResult.profile, updatedAt: "invalid" } },
]) {
	assert.throws(() => parseSeoAdminAnalysisProfileResult(result), /analysisProfile.result/);
}
for (const error of ["not_found", "storage_unavailable"]) {
	assert.equal(parseSeoAdminAnalysisProfileResult({
		...analysisProfileResult, success: false, error,
	}).success, false);
}
assert.throws(() => parseSeoAdminAnalysisProfileResult({
	...analysisProfileResult, success: false, error: "unknown",
}), /analysisProfile.error/);

// --- entry-directives (per-entry robots) -----------------------------------
const directivesResult = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	success: true,
	item: {
		storageVersion: 1,
		ref: "posts:post-1",
		robots: {
			nofollow: true,
			noarchive: false,
			nosnippet: false,
			noimageindex: false,
			notranslate: false,
		},
		updatedAt: "2026-07-19T10:00:00.000Z",
	},
};
assert.equal(parseSeoAdminEntryDirectivesResult(directivesResult).success, true);
assert.equal(
	parseSeoAdminEntryDirectivesResult({
		...directivesResult,
		item: { ...directivesResult.item, disabledPresets: ["blogPosting"] },
	}).success,
	true,
);
assert.throws(
	() =>
		parseSeoAdminEntryDirectivesResult({
			...directivesResult,
			item: { ...directivesResult.item, disabledPresets: [42] },
		}),
	/entryDirectives.item/,
);

// --- entry-schema-preview ----------------------------------------------------
const schemaPreviewResult = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	generatedAt: "2026-07-19T10:00:00.000Z",
	success: true,
	items: [
		{
			id: "preset:blogPosting",
			source: "preset",
			presetKey: "blogPosting",
			name: "BlogPosting",
			types: ["BlogPosting"],
			disabled: false,
			emitted: true,
			suppressedReason: null,
			conflictId: null,
			replacesCore: true,
			graph: { "@type": "BlogPosting" },
		},
		{
			id: "custom:abc",
			source: "custom",
			presetKey: null,
			name: "FAQ block",
			types: ["FAQPage"],
			disabled: false,
			emitted: true,
			suppressedReason: null,
			conflictId: null,
			replacesCore: false,
			graph: { "@type": "FAQPage" },
		},
	],
};
assert.equal(parseSeoAdminEntrySchemaPreviewResult(schemaPreviewResult).success, true);
assert.equal(
	parseSeoAdminEntrySchemaPreviewResult({
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		success: false,
		error: "not_found",
	}).success,
	false,
);
assert.throws(
	() =>
		parseSeoAdminEntrySchemaPreviewResult({
			...schemaPreviewResult,
			items: [{ ...schemaPreviewResult.items[0], source: "weird" }],
		}),
	/entrySchemaPreview.items/,
);
assert.throws(
	() =>
		parseSeoAdminEntrySchemaPreviewResult({
			...schemaPreviewResult,
			items: [
				{
					...schemaPreviewResult.items[0],
					emitted: false,
					suppressedReason: "unknown-conflict",
				},
			],
		}),
	/entrySchemaPreview.items/,
);
assert.equal(parseSeoAdminEntryDirectivesResult({ ...directivesResult, item: null }).success, true);
assert.equal(
	parseSeoAdminEntryDirectivesResult({
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		success: false,
		error: "invalid_values",
	}).success,
	false,
);
assert.throws(
	() =>
		parseSeoAdminEntryDirectivesResult({
			...directivesResult,
			item: { ...directivesResult.item, robots: { nofollow: "yes" } },
		}),
	/entryDirectives.item/,
);
assert.throws(
	() =>
		parseSeoAdminEntryDirectivesResult({
			...directivesResult,
			contractVersion: 14,
		}),
	/entryDirectives.contractVersion/,
);
assert.equal(
	parseSeoAdminFocusKeywordSaveResult({
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	success: false,
	error: "too_many_keywords",
	}).success,
	false,
);
assert.throws(
	() =>
		parseSeoAdminFocusKeywordSaveResult({
			...focusKeywordResult,
			success: false,
			error: "unknown",
		}),
	/focusKeyword.error/,
);

const scoreTrendSnapshot: SeoAdminScoreSnapshot = {
	id: "posts:post-1:2026-07-14T10:00:00.000Z",
	storageVersion: SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION,
	fingerprint: "fnv1a:score-trend-fixture",
	ref: "posts:post-1",
	collection: "posts",
	entryId: "post-1",
	title: "A useful post",
	score: 84,
	grade: "good" as const,
	scoreVersion: 1,
	sourceUpdatedAt: "2026-07-14T09:00:00.000Z",
	templateUpdatedAt: null,
	modulesUpdatedAt: "2026-07-14T08:00:00.000Z",
	capturedAt: "2026-07-14T10:00:00.000Z",
	issues: [
		{
		id: "meta-description",
		label: "Meta description",
		category: "metadata",
		severity: "high",
		status: "fail",
		weight: 16,
		},
	],
};

// The fixture body is under 50 words, so the earlier sample needs a raw score below the 40 limit.
const previousScoreTrendSnapshot = createScoreSnapshot({
	...contentScoreFixture.items[0],
	...analyzeSeoContent({ ...scoreAnalysisInput, title: "", description: "", image: "" }),
	updatedAt: "2026-07-13T10:00:00.000Z",
});
const currentScoreTrendSnapshot = createScoreSnapshot(contentScoreFixture.items[0]);
assert.ok(previousScoreTrendSnapshot.score < currentScoreTrendSnapshot.score, `${previousScoreTrendSnapshot.score} < ${currentScoreTrendSnapshot.score}`);
const scoreTrendsFixture = buildScoreTrends(
	[previousScoreTrendSnapshot, currentScoreTrendSnapshot, scoreTrendSnapshot],
	{ days: 30, now: new Date("2026-07-14T10:01:00.000Z") },
);
assert.equal(parseSeoAdminScoreTrends(scoreTrendsFixture).comparison.direction, "improved");
assert.equal(parseSeoAdminScoreTrends(scoreTrendsFixture).items.find((item) => item.id === scoreTrendSnapshot.id)?.scoreVersion, 1);
assert.equal(
	parseSeoAdminScoreTrends({ ...scoreTrendsFixture, items: scoreTrendsFixture.items.map((item) => item.id === scoreTrendSnapshot.id ? { ...item, sourceVersion: "draft-revision-2" } : item) })
		.items.find((item) => item.id === scoreTrendSnapshot.id)?.sourceVersion,
	"draft-revision-2",
);
assert.throws(
	() => parseSeoAdminScoreTrends({ ...scoreTrendsFixture, items: scoreTrendsFixture.items.map((item) => item.id === scoreTrendSnapshot.id ? { ...item, sourceVersion: "" } : item) }),
	/scoreTrends.items/,
);
const legacyScoreTrendSnapshot = { ...scoreTrendSnapshot } as Record<string, unknown>;
delete legacyScoreTrendSnapshot.modulesUpdatedAt;
assert.equal(
	parseSeoAdminScoreTrends({ ...scoreTrendsFixture, items: scoreTrendsFixture.items.map((item) => item.id === scoreTrendSnapshot.id ? legacyScoreTrendSnapshot : item) }).items
		.length,
	3,
	"storage-v1 snapshots without module revisions remain readable",
);
assert.throws(
	() => parseSeoAdminScoreTrends({ ...scoreTrendsFixture, storageVersion: 2 }),
	/scoreTrends.storageVersion/,
);
assert.throws(
	() =>
		parseSeoAdminScoreTrends({
		...scoreTrendsFixture,
		points: scoreTrendsFixture.points.map((point, index) => index === 0 ? { ...point, date: "14-07-2026" } : point),
	}),
	/scoreTrends.points/,
);
assert.throws(
	() =>
		parseSeoAdminScoreTrends({
		...scoreTrendsFixture,
		topIssues: [{ ...scoreTrendSnapshot.issues[0], affectedEntries: 0 }],
	}),
	/scoreTrends.topIssues/,
);
assert.throws(
	() =>
		parseSeoAdminScoreTrends({
		...scoreTrendsFixture,
		items: [{ ...scoreTrendSnapshot, scoreVersion: 0 }],
	}),
	/scoreTrends.items/,
);

const settingsValuesFixture = {
	siteName: "Shipit Digital",
	siteUrl: "https://shipitdigital.nl",
	publisherType: "organization" as const,
	organizationName: "Shipit Digital",
	organizationLogo: "https://shipitdigital.nl/logo.svg",
	personName: "",
	socialProfiles: ["https://www.linkedin.com/company/shipitdigital/"],
	personProfiles: [],
	defaultSocialImage: "https://shipitdigital.nl/og.jpg",
	twitterHandle: "@shipitdigital",
	noindex: false,
	contentScoringEnabled: true,
};
const legacyGuardFixture = `legacy-v1:${"a".repeat(64)}`;
const settingsFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	storageVersion: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	state: "absent",
	updatedAt: null,
	revision: null,
	legacyGuard: legacyGuardFixture,
	legacyPresent: false,
	indexingPreferenceConfirmed: false,
	values: settingsValuesFixture,
	contentScoring: { state: "pending-confirmation", revision: null, intentEnabled: true, acknowledgedNoticeVersion: null, currentNoticeVersion: 1 },
};
const savedSettingsFixture = {
	...settingsFixture,
	state: "saved",
	updatedAt: "2026-10-03T05:00:00.000Z",
	revision: "opaque-revision",
	contentScoring: { ...settingsFixture.contentScoring, revision: "opaque-revision" },
	legacyGuard: null,
	indexingPreferenceConfirmed: true,
};
const unreadableSettingsFixture = {
	...settingsFixture,
	state: "corrupt",
	revision: "corrupt-revision",
	contentScoring: { state: "unavailable", reason: "corrupt" },
	legacyGuard: null,
	values: null,
};

assert.equal(parseSeoAdminSettings(settingsFixture).values?.siteName, "Shipit Digital");
assert.equal(Object.hasOwn(parseSeoAdminSettings(settingsFixture).values!, "customVerificationTags"), false, "old settings remain without a custom-tag preference");
const customVerificationTags = [{ name: "yandex-verification", content: "synthetic-token" }];
assert.deepEqual(parseSeoAdminSettings({ ...savedSettingsFixture, values: { ...settingsValuesFixture, customVerificationTags } }).values?.customVerificationTags, customVerificationTags);
for (const customVerificationTags of [undefined, null, [{ name: "robots", content: "noindex" }], [{ name: "Yandex-Verification", content: "synthetic-token" }], [{ name: "yandex-verification", content: "one" }, { name: "yandex-verification", content: "two" }]]) {
	assert.throws(() => parseSeoAdminSettings({ ...savedSettingsFixture, values: { ...settingsValuesFixture, customVerificationTags } }), /settings.values.customVerificationTags/, "invalid stored custom tags cannot become an empty editable configuration");
}

assert.equal(Object.hasOwn(parseSeoAdminSettings(settingsFixture).values!, "taxonomyArchiveNoindex"), false,
	"older settings do not acquire an archive policy during parsing");
for (const taxonomyArchiveNoindex of [["category", "custom_type"], []]) {
	assert.deepEqual(parseSeoAdminSettings({ ...savedSettingsFixture, values: { ...settingsValuesFixture, taxonomyArchiveNoindex } }).values?.taxonomyArchiveNoindex,
		taxonomyArchiveNoindex);
}
for (const taxonomyArchiveNoindex of [undefined, null, "category", ["tag", "category"], ["tag", "tag"], ["a/b"], Array(101).fill("category")]) {
	assert.throws(() => parseSeoAdminSettings({ ...savedSettingsFixture, values: { ...settingsValuesFixture, taxonomyArchiveNoindex } }),
		/settings.values.taxonomyArchiveNoindex/, "invalid stored archive policy cannot become an empty editable choice");
}
assert.equal(Object.hasOwn(parseSeoAdminSettings(settingsFixture).values!, "contentTypeNoindex"), false,
	"older settings do not acquire content type rules during parsing");
for (const contentTypeNoindex of [["events", "posts"], []]) {
	assert.deepEqual(parseSeoAdminSettings({ ...savedSettingsFixture, values: { ...settingsValuesFixture, contentTypeNoindex } }).values?.contentTypeNoindex,
		contentTypeNoindex);
}
for (const contentTypeNoindex of [undefined, null, "posts", ["posts", "events"], ["posts", "posts"], ["Posts"], Array(101).fill("posts")]) {
	assert.throws(() => parseSeoAdminSettings({ ...savedSettingsFixture, values: { ...settingsValuesFixture, contentTypeNoindex } }),
		/settings.values.contentTypeNoindex/, "invalid stored rules cannot become an empty editable choice");
}

// The Site identity view, including the business identity form, renders only after this parse.
assert.throws(
	() => parseSeoAdminSettings({ ...settingsFixture, contractVersion: SEO_ADMIN_CONTRACT_VERSION - 1 }),
	new RegExp(`expected contract ${SEO_ADMIN_CONTRACT_VERSION}, received ${SEO_ADMIN_CONTRACT_VERSION - 1}`),
	"an older engine with a newer admin is refused before the identity form loads",
);
assert.equal(parseSeoAdminSettings(savedSettingsFixture).revision, "opaque-revision");
assert.equal(parseSeoAdminSettings(unreadableSettingsFixture).values, null, "an unreadable record carries no values");
assert.equal(parseSeoAdminSettings({ ...unreadableSettingsFixture, state: "unavailable", revision: null }).state, "unavailable");
for (const [label, value, field] of [
	["an empty revision", { ...savedSettingsFixture, revision: "" }, /settings.revision/],
	["a missing revision", { ...savedSettingsFixture, revision: undefined }, /settings.revision/],
	["absent with a revision", { ...settingsFixture, revision: "r1" }, /settings.revision/],
	["saved without a revision", { ...savedSettingsFixture, revision: null }, /settings.revision/],
	["absent without a legacy guard", { ...settingsFixture, legacyGuard: null }, /settings.legacyGuard/],
	["a malformed legacy guard", { ...settingsFixture, legacyGuard: "legacy-v1:zz" }, /settings.legacyGuard/],
	["saved with a legacy guard", { ...savedSettingsFixture, legacyGuard: legacyGuardFixture }, /settings.legacyGuard/],
	["saved without its timestamp", { ...savedSettingsFixture, updatedAt: null }, /settings.updatedAt/],
	["a confirmed absent preference", { ...settingsFixture, indexingPreferenceConfirmed: true }, /settings.source/],
	["a historical seed read as indexable", { ...savedSettingsFixture, state: "historical-seed", updatedAt: null, indexingPreferenceConfirmed: false }, /settings.values.noindex/],
	["an unknown state", { ...settingsFixture, state: "inherited" }, /settings.state/],
	["corrupt settings with values", { ...unreadableSettingsFixture, values: settingsValuesFixture }, /settings.state/],
	["unavailable settings with a revision", { ...unreadableSettingsFixture, state: "unavailable" }, /settings.state/],
] as const) {
	assert.throws(() => parseSeoAdminSettings(value), field, label);
}
assert.equal(
	parseSeoAdminSettingsSaveResult({
		success: false, conflict: true, errors: { _form: "Settings changed." },
	}).success,
	false,
);
const legacySettingsValues: Record<string, unknown> = { ...settingsValuesFixture };
delete legacySettingsValues.publisherType;
delete legacySettingsValues.contentScoringEnabled;
delete legacySettingsValues.personName;
delete legacySettingsValues.personProfiles;
assert.equal(parseSeoAdminSettings({ ...settingsFixture, values: legacySettingsValues }).values?.publisherType, "organization");
assert.equal(parseSeoAdminSettings({ ...settingsFixture, values: legacySettingsValues }).values?.contentScoringEnabled, true);
assert.equal(
	parseSeoAdminSettingsSaveResult({ success: true, settings: savedSettingsFixture }).success,
	true,
);
assert.throws(
	() => parseSeoAdminSettingsSaveResult({ success: true, settings: unreadableSettingsFixture }),
	/settings.save.state/,
	"a successful write never answers with unreadable settings",
);
assert.equal(
	parseSeoAdminSettingsSaveResult({ success: false, errors: { siteUrl: "Invalid URL" } }).success,
	false,
);
assert.throws(
	() =>
		parseSeoAdminSettings({
			...settingsFixture,
			values: { ...settingsValuesFixture, noindex: "false" },
		}),
	/settings.values/,
);
assert.throws(
	() => parseSeoAdminSettingsSaveResult({ success: false, errors: { siteUrl: 42 } }),
	/settings.errors/,
);

const sitemapFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	storageVersion: SEO_ADMIN_SITEMAP_STORAGE_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	updatedAt: "2026-10-03T01:00:00.000Z",
	revision: "r1",
	settings: "saved",
	writable: true,
	moduleEnabled: true,
	owner: "shipit",
	ownerDetail: null,
	availability: "ready",
	groups: [
		{ key: "posts", label: "Posts", source: "saved", urlPattern: null, unique: true },
		{ key: "pages", label: "Pages", source: "default", urlPattern: null, unique: true },
		{ key: "services", label: "Services", source: "saved", urlPattern: "/services/{slug}", unique: true },
	],
	values: { contentTypes: { staticRoutes: true, posts: true, pages: true, services: false }, excludedPaths: ["/thank-you"] },
	preservedKeys: ["staticRoutes"],
	overlaps: [],
	plan: [{ collection: "posts", label: "Posts", candidates: 3, files: [null, "01B"] }],
	pageSize: 500,
	publicFiles: {
		origin: "https://www.example.com",
		source: "site-identity",
		sitemapUrl: "https://www.example.com/sitemap.xml",
		robotsUrl: "https://www.example.com/robots.txt",
	},
};
assert.equal(parseSeoAdminSitemap(sitemapFixture).values.contentTypes.posts, true);
assert.equal(parseSeoAdminSitemap({
	...sitemapFixture,
	publicFiles: { origin: null, source: null, sitemapUrl: null, robotsUrl: null },
}).publicFiles.sitemapUrl, null);
assert.throws(
	() => parseSeoAdminSitemap({
		...sitemapFixture,
		publicFiles: { ...sitemapFixture.publicFiles, sitemapUrl: "/sitemap.xml" },
	}),
	/sitemap.publicFiles.sitemapUrl/,
);
assert.equal(
	parseSeoAdminSitemapSaveResult({ success: true, sitemap: sitemapFixture }).success,
	true,
);
assert.equal(
	parseSeoAdminSitemapSaveResult({ success: false, errors: { excludedPaths: "Invalid path" } })
		.success,
	false,
);
assert.throws(
	() =>
		parseSeoAdminSitemap({
			...sitemapFixture,
			values: { ...sitemapFixture.values, excludedPaths: [42] },
		}),
	/sitemap.values.excludedPaths/,
);
assert.throws(() => parseSeoAdminSitemap({ ...sitemapFixture, owner: "someone" }), /sitemap.owner/);
assert.throws(() => parseSeoAdminSitemap({ ...sitemapFixture, plan: [{ collection: "posts", label: "Posts", candidates: 0, files: [null] }] }), /sitemap.plan.item/);
assert.throws(() => parseSeoAdminSitemap({ ...sitemapFixture, overlaps: [{ collections: ["posts", "unknown"] }] }), /sitemap.overlaps/);
assert.equal(parseSeoAdminSitemapSaveResult({ success: false, conflict: true, errors: { _form: "Changed elsewhere." } }).success, false);
assert.equal(parseSeoAdminSitemap({ ...sitemapFixture, publicFiles: { ...sitemapFixture.publicFiles, source: "astro-site" } }).publicFiles.source, "astro-site");
assert.equal(Object.hasOwn(parseSeoAdminSitemap(sitemapFixture), "noindexContentTypes"), false, "servers without the field still parse");
assert.deepEqual(parseSeoAdminSitemap({ ...sitemapFixture, noindexContentTypes: ["pages", "posts"] }).noindexContentTypes, ["pages", "posts"]);
for (const noindexContentTypes of [null, "posts", ["unknown"], ["posts", "posts"], [7]]) {
	assert.throws(() => parseSeoAdminSitemap({ ...sitemapFixture, noindexContentTypes }), /sitemap.noindexContentTypes/, JSON.stringify(noindexContentTypes));
}
const sitemapPreviewFixture = {
	success: true, collection: "posts", after: null, fileUrl: "https://www.example.com/sitemap-posts.xml",
	included: 1, excluded: 0, total: 1, matched: 1, search: "", status: "all", limit: 25, offset: 0, previousCursor: null, nextCursor: null,
	entries: [{ id: "01A", locale: "en", status: "included", path: "/posts/a", url: "https://www.example.com/posts/a", lastmod: null, image: null, canonical: null, alternates: 0 }],
};
assert.equal(parseSeoAdminSitemapPreview(sitemapPreviewFixture).success, true);
assert.throws(() => parseSeoAdminSitemapPreview({
	...sitemapPreviewFixture, entries: [{ ...sitemapPreviewFixture.entries[0], status: "hidden" }],
}), /sitemap.preview.entry/);
for (const invalid of [
	{ total: 2 }, { matched: 2 }, { offset: 25 }, { limit: 100 }, { entries: Array(26).fill(sitemapPreviewFixture.entries[0]) },
	{ nextCursor: "unexpected" }, { search: "x".repeat(161) }, { included: -1 }, { previousCursor: "" },
]) {
	assert.throws(() => parseSeoAdminSitemapPreview({ ...sitemapPreviewFixture, ...invalid }), /sitemap.preview/);
}
assert.equal(parseSeoAdminSitemapPreview({ success: false, stale: true, errors: { _form: "Refresh this file." } }).success, false);
assert.throws(() => parseSeoAdminCrawlDiagnostics({
	...crawlDiagnosticsFixture, limits: { ...crawlDiagnosticsFixture.limits, inspectedRecords: 1_001 },
}), /crawlDiagnostics.summary.integrity/);
const truncatedGraph = {
	...crawlDiagnosticsFixture,
	coverage: "partial",
	summary: { ...crawlDiagnosticsFixture.summary, scannedLinks: 302, unresolvedInternalLinks: 301 },
	limits: { ...crawlDiagnosticsFixture.limits, unresolvedLinksOmitted: 300 },
};
assert.equal(parseSeoAdminCrawlDiagnostics(truncatedGraph).summary.unresolvedInternalLinks, 301);
assert.throws(() => parseSeoAdminCrawlDiagnostics({ ...truncatedGraph, coverage: "complete" }), /crawlDiagnostics.summary.integrity/);

const indexNowValues = {
	...defaultIndexNowSettings(),
	enabled: true,
	apiKey: "fixture-indexnow-key",
};
const indexNowJob = {
	id: "url:https%3A%2F%2Fshipitdigital.nl%2Fblog%2Fpost",
	storageVersion: SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION,
	url: "https://shipitdigital.nl/blog/post",
	ref: "posts:post-1",
	reason: "publish",
	status: "delivered",
	attempts: 1,
	nextAttemptAt: null,
	lastHttpStatus: 202,
	lastError: null,
	lastSubmittedAt: "2026-07-14T10:00:00.000Z",
	createdAt: "2026-07-14T10:00:00.000Z",
	updatedAt: "2026-07-14T10:00:00.000Z",
};
const indexNowDelivery = {
	id: "delivery:2026-07-14T10:00:00.000Z:12345678",
	storageVersion: SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION,
	status: "accepted",
	urlCount: 1,
	urls: [indexNowJob.url],
	httpStatus: 202,
	attempt: 1,
	detail: "URLs accepted while the API key is verified.",
	retryAt: null,
	createdAt: "2026-07-14T10:00:00.000Z",
};
const indexNowFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	protocolVersion: INDEXNOW_PROTOCOL_VERSION,
	storageVersion: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	generatedAt: "2026-07-14T10:00:01.000Z",
	updatedAt: "2026-07-14T09:59:00.000Z",
	endpoint: INDEXNOW_ENDPOINT,
	values: indexNowValues,
	contentTypeDiscoveryAvailable: true,
	contentTypes: [{ collection: "posts", label: "Posts" }],
	keyLocationUrl: "https://shipitdigital.nl/indexnow-key.txt",
	manualSubmissionReady: true,
	readiness: { state: "ready", title: "Ready", description: "IndexNow is ready." },
	capabilities: { network: true, cron: true },
	queue: {
		pending: 0,
		retrying: 0,
		failed: 0,
		delivered: 1,
		lastAcceptedAt: indexNowDelivery.createdAt,
	},
	jobs: [indexNowJob],
	deliveries: [indexNowDelivery],
	setup: {
		origin: "https://shipitdigital.nl",
		installation: "astro",
		hostPermission: true,
		keyRoute: "injected",
		keySaved: true,
		verifiedAt: "2026-07-14T09:59:00.000Z",
		issue: null,
	},
};

assert.equal(parseSeoAdminIndexNowStatus(indexNowFixture).queue.delivered, 1);
assert.equal(parseSeoAdminIndexNowStatus({ ...indexNowFixture, jobs: [{ ...indexNowJob, submissionId: "submission:x" }] }).jobs.length, 1);
assert.throws(() => parseSeoAdminIndexNowStatus({ ...indexNowFixture, jobs: [{ ...indexNowJob, submissionId: 7 }] }), /indexNow.job/);
for (const setup of [
	undefined,
	{ ...indexNowFixture.setup, installation: "registry" },
	{ ...indexNowFixture.setup, hostPermission: null },
	{ ...indexNowFixture.setup, installation: "unknown", hostPermission: true },
	{ ...indexNowFixture.setup, keyRoute: "elsewhere" },
	{ ...indexNowFixture.setup, issue: { code: "mystery", title: "x", description: "y" } },
	{ ...indexNowFixture.setup, keySaved: "yes" },
]) assert.throws(() => parseSeoAdminIndexNowStatus({ ...indexNowFixture, setup }), /indexNow.setup/);
assert.equal(parseSeoAdminIndexNowStatus({
	...indexNowFixture,
	setup: {
		...indexNowFixture.setup, origin: "http://127.0.0.1:4362", hostPermission: false,
		issue: { code: "local-site", title: "This site is running on a local address", description: "Nothing is sent." },
	},
}).setup.issue?.code, "local-site");
assert.equal(parseSeoAdminIndexNowSaveResult({ success: false, errors: { _form: "Key file missing." }, failedStep: "verify" }).success, false);
assert.throws(() => parseSeoAdminIndexNowSaveResult({ success: false, errors: { _form: "x" }, failedStep: "deploy" }), /indexNow.save.errors/);
assert.equal(parseSeoAdminIndexNowOperationResult({ success: true, enqueued: 1, skipped: 0, rejected: [], history: "partial", indexNow: indexNowFixture }).success, true);
assert.throws(() => parseSeoAdminIndexNowOperationResult({ success: true, enqueued: 1, skipped: 0, rejected: [], history: "maybe", indexNow: indexNowFixture }), /indexNow.operation.summary/);
// Content type noindex rules: optional, so older servers still parse, and validated when present.
assert.equal(Object.hasOwn(parseSeoAdminIndexNowStatus(indexNowFixture), "contentTypeRules"), false);
assert.deepEqual(parseSeoAdminIndexNowStatus({ ...indexNowFixture, contentTypeRules: [{ collection: "posts", label: "Posts", urlPattern: "/blog/{slug}" }] })
	.contentTypeRules, [{ collection: "posts", label: "Posts", urlPattern: "/blog/{slug}" }]);
assert.deepEqual(parseSeoAdminIndexNowStatus({ ...indexNowFixture, contentTypeRules: [] }).contentTypeRules, []);
for (const contentTypeRules of [null, "posts", [{ collection: "posts", label: "Posts" }], [{ collection: "Posts!", label: "Posts", urlPattern: "/p/{slug}" }],
	[{ collection: "posts", label: "Posts", urlPattern: "" }], [{ collection: "posts", label: "Posts", urlPattern: 7 }],
	[{ collection: "posts", label: "Posts", urlPattern: "/a/{slug}" }, { collection: "posts", label: "Posts", urlPattern: "/b/{slug}" }]]) {
	assert.throws(() => parseSeoAdminIndexNowStatus({ ...indexNowFixture, contentTypeRules }), /indexNow.contentTypeRules/, JSON.stringify(contentTypeRules));
}
assert.deepEqual((parseSeoAdminIndexNowOperationResult({ success: true, enqueued: 0, skipped: 0, rejected: [], contentTypeNoindexUrls: ["/blog/a"], indexNow: indexNowFixture }) as
	{ contentTypeNoindexUrls?: string[] }).contentTypeNoindexUrls, ["/blog/a"]);
for (const contentTypeNoindexUrls of [null, "/blog/a", [7]]) {
	assert.throws(() => parseSeoAdminIndexNowOperationResult({ success: true, enqueued: 0, skipped: 0, rejected: [], contentTypeNoindexUrls, indexNow: indexNowFixture }),
		/indexNow.operation.summary/, JSON.stringify(contentTypeNoindexUrls));
}

// History has its own response and parser: summary rows carry a bounded URL
// sample and the original count, never a delivery-shaped urls list.
const submissionFixture = {
	id: "submission:2026-10-02T08:30:00.000Z:00112233aabbccdd",
	storageVersion: 1,
	source: "manual",
	event: null,
	ref: null,
	urlCount: 12,
	sampleUrls: ["https://example.com/menu/lunch", "https://example.com/menu/dinner", "https://example.com/contact"],
	sampleSkipped: [],
	detail: "pages",
	counts: { queued: 0, retrying: 12, sent: 0, accepted: 0, failed: 0, skipped: 0, superseded: 0 },
	status: "retry",
	attempts: 1,
	lastAttemptAt: "2026-10-02T08:30:00.000Z",
	lastHttpStatus: 429,
	nextAttemptAt: "2026-10-02T08:45:00.000Z",
	lastDetail: "IndexNow rate limit reached.",
	createdAt: "2026-10-02T08:29:00.000Z",
	updatedAt: "2026-10-02T08:30:00.000Z",
};
const historyFixture = {
	success: true,
	history: {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt: "2026-10-02T09:00:00.000Z",
		available: true,
		filters: { status: null, source: null },
		pageSize: 10,
		total: 48,
		items: [submissionFixture],
		cursor: "eyJ2IjoxfQ",
		hasMore: true,
		maxAttempts: 5,
		retention: 500,
		historyStartedAt: "2026-10-01T00:00:00.000Z",
	},
};
assert.equal(parseSeoAdminIndexNowHistoryResult(historyFixture).success, true);
assert.equal(parseSeoAdminIndexNowHistoryResult({ success: false, error: "invalid_cursor", detail: "Load the first page again." }).success, false);
const withItem = (patch: Record<string, unknown>) => ({ ...historyFixture, history: { ...historyFixture.history, items: [{ ...submissionFixture, ...patch }] } });
for (const patch of [
	{ urls: submissionFixture.sampleUrls, sampleUrls: undefined },
	{ sampleUrls: submissionFixture.sampleUrls.slice(0, 2) },
	{ sampleUrls: [...submissionFixture.sampleUrls, "https://example.com/four"] },
	{ counts: { ...submissionFixture.counts, retrying: 11 } },
	{ counts: { ...submissionFixture.counts, indexed: 0 } },
	{ status: "sent" },
	{ status: "indexed" },
	{ event: "publish" },
	{ source: "automatic" },
	{ detail: "sample" },
	{ sampleSkipped: [1, 0] },
	{ lastHttpStatus: 700 },
	{ urlCount: 1_001 },
	{ indexedAt: undefined, storageVersion: 2 },
]) assert.throws(() => parseSeoAdminIndexNowHistoryResult(withItem(patch)), /indexNow.submission/, JSON.stringify(patch));
for (const page of [
	{ cursor: null },
	{ hasMore: false },
	{ pageSize: 51 },
	{ items: [submissionFixture, submissionFixture] },
	{ filters: { status: "failed", source: null } },
	{ available: false },
	{ contractVersion: 19 },
]) assert.throws(() => parseSeoAdminIndexNowHistoryResult({ ...historyFixture, history: { ...historyFixture.history, ...page } }),
	/indexNow.historyPage|mismatch/, JSON.stringify(page));
assert.throws(() => parseSeoAdminIndexNowHistoryResult({ success: false, error: "not_found", detail: "x" }), /indexNow.historyResult.error/);
assert.throws(
	() => parseSeoAdminIndexNowStatus({ ...indexNowFixture, deliveries: [{ ...indexNowDelivery, urls: [], urlCount: 12 }] }),
	/indexNow.delivery/,
	"the delivery parser still requires every delivered URL",
);
const urlsFixture = {
	success: true,
	urls: {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt: "2026-10-02T09:00:00.000Z",
		submissionId: submissionFixture.id,
		detail: "pages",
		urlCount: 12,
		page: 0,
		pageCount: 1,
		items: Array.from({ length: 12 }, (_, index) => ({ url: `https://example.com/${index}`, skipped: index === 3 })),
	},
};
assert.equal(parseSeoAdminIndexNowHistoryUrlsResult(urlsFixture).success, true);
assert.equal(parseSeoAdminIndexNowHistoryUrlsResult({ ...urlsFixture, urls: { ...urlsFixture.urls, detail: "expired", pageCount: 0, items: [] } }).success, true);
for (const page of [
	{ items: urlsFixture.urls.items.slice(0, 11) },
	{ detail: "expired" },
	{ page: 1 },
	{ pageCount: 2 },
	{ items: [{ url: "https://example.com/x" }] },
	{ detail: "sample" },
]) assert.throws(() => parseSeoAdminIndexNowHistoryUrlsResult({ ...urlsFixture, urls: { ...urlsFixture.urls, ...page } }), /indexNow.historyUrls/, JSON.stringify(page));
assert.equal(parseSeoAdminIndexNowHistoryUrlsResult({ success: false, error: "not_found", detail: "Gone." }).success, false);
assert.throws(
	() => parseSeoAdminIndexNowStatus({ ...indexNowFixture, contentTypes: [{ collection: "bad:type", label: "Bad" }] }),
	/indexNow.contentTypes/,
);
assert.throws(
	() => parseSeoAdminIndexNowStatus({ ...indexNowFixture, manualSubmissionReady: "yes" }),
	/indexNow.manualSubmissionReady/,
);
assert.equal(
	parseSeoAdminIndexNowSaveResult({ success: true, indexNow: indexNowFixture }).success,
	true,
);
assert.equal(
	parseSeoAdminIndexNowSaveResult({ success: false, errors: { apiKey: "Invalid key" } }).success,
	false,
);
assert.equal(
	parseSeoAdminIndexNowOperationResult({
	success: true,
	enqueued: 1,
	skipped: 0,
	rejected: [],
	indexNow: indexNowFixture,
	}).success,
	true,
);
assert.equal(
	parseSeoAdminIndexNowOperationResult({
	success: false,
	error: "delivery_failed",
	detail: "IndexNow returned HTTP 403.",
	indexNow: indexNowFixture,
	}).success,
	false,
);
assert.equal(
	parseSeoAdminIndexNowOperationResult({
		success: false,
		error: "delivery_in_progress",
		detail: "Another queue drain owns the lease.",
	}).success,
	false,
);
assert.throws(
	() => parseSeoAdminIndexNowStatus({ ...indexNowFixture, protocolVersion: 2 }),
	/indexNow.protocolVersion/,
);
assert.throws(
	() =>
		parseSeoAdminIndexNowStatus({
			...indexNowFixture,
			jobs: [{ ...indexNowJob, status: "mystery" }],
		}),
	/indexNow.job/,
);
assert.throws(
	() =>
		parseSeoAdminIndexNowStatus({
		...indexNowFixture,
		queue: { ...indexNowFixture.queue, failed: -1 },
	}),
	/indexNow.queue/,
);
assert.throws(
	() =>
		parseSeoAdminIndexNowStatus({
		...indexNowFixture,
		deliveries: [{ ...indexNowDelivery, urlCount: 2 }],
	}),
	/indexNow.delivery/,
);
assert.throws(
	() =>
		parseSeoAdminIndexNowOperationResult({ success: false, error: "unknown", detail: "Broken" }),
	/indexNow.operation.error/,
);

const templateValues = defaultSeoAdminTemplateSet();
const templateGuard = { fields: { title: null, description: "rev-description", socialTitle: null, socialDescription: null } };
const templatesFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	storageVersion: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	state: "saved",
	revision: "record-revision",
	discovery: "available",
	allowedVariables: ["title", "description", "siteName"],
	outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
	retainedCollections: [],
	items: SEO_ADMIN_TEMPLATE_DEFINITIONS.map((definition) => ({
		...definition,
		collection: definition.key,
		source: "override",
		values: templateValues[definition.key],
		inheritanceGuard: templateGuard,
		inherited: { source: "default", values: templateValues[definition.key], ignoredLegacyFields: [] },
	})),
};

assert.equal(parseSeoAdminTemplateConfiguration(templatesFixture).items.length, 3);
assert.equal(
	parseSeoAdminTemplatesSaveResult(
		{ success: true, outcome: "saved", collection: "posts", templates: templatesFixture },
		{ collection: "posts" },
	).success,
	true,
);
assert.throws(
	() => parseSeoAdminTemplatesSaveResult({ success: true, outcome: "saved", collection: "pages", templates: null }, { collection: "posts" }),
	/templates.command.collection/,
);
assert.throws(
	() =>
		parseSeoAdminTemplateConfiguration({
		...templatesFixture,
			items: [
				{ ...templatesFixture.items[0], values: { title: "Broken" } },
				...templatesFixture.items.slice(1),
			],
	}),
	/templates.posts.values/,
);
assert.throws(
	() => parseSeoAdminTemplateConfiguration({ ...templatesFixture, state: "corrupt" }),
	/templates.items/,
);
assert.throws(
	() => parseSeoAdminTemplateConfiguration({ ...templatesFixture, state: "absent", revision: null }),
	/templates.item.source|inheritanceGuard.revisions/,
);

// One exact example answers only the collection and entry it was requested for, refusals included.
const exampleRequest = { collection: "posts", entryId: "p40" };
const exampleFixture = {
	success: true,
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	collection: "posts",
	entryId: "p40",
	example: { entryId: "p40", title: "Off-page post", slug: "off-page", locale: "fr", publishedAt: null, updatedAt: "2026-10-01T00:00:00.000Z" },
};
assert.equal(parseSeoAdminTemplateExampleResult(exampleFixture, exampleRequest).success, true);
for (const [patch, field] of [
	[{ collection: "pages" }, /templates.example.request/],
	[{ entryId: "p41" }, /templates.example.request/],
	[{ example: { ...exampleFixture.example, entryId: "p41" } }, /templates.example.example/],
	[{ example: { ...exampleFixture.example, locale: "" } }, /templates.example.example/],
	[{ example: { ...exampleFixture.example, locale: "x".repeat(36) } }, /templates.example.example/],
	[{ example: { ...exampleFixture.example, slug: 3 } }, /templates.example.example/],
	[{ contractVersion: SEO_ADMIN_CONTRACT_VERSION - 1 }, /templates.example.contractVersion/],
] as const) {
	assert.throws(() => parseSeoAdminTemplateExampleResult({ ...exampleFixture, ...patch }, exampleRequest), field);
}
for (const error of ["collection_unavailable", "content_unavailable", "not_found", "not_published", "invalid_locale", "response_too_large"]) {
	const refusal = { success: false, error, collection: "posts", entryId: "p40", message: "Refused." };
	assert.equal(parseSeoAdminTemplateExampleResult(refusal, exampleRequest).success, false, error);
	assert.throws(() => parseSeoAdminTemplateExampleResult({ ...refusal, entryId: "p41" }, exampleRequest), /templates.example.request/, `${error} names its entry`);
	assert.throws(() => parseSeoAdminTemplateExampleResult({ ...refusal, collection: undefined }, exampleRequest), /templates.example.request/, `${error} names its collection`);
}
assert.equal(parseSeoAdminTemplateExampleResult({ success: false, error: "invalid_input", message: "Choose." }, exampleRequest).success, false);
assert.throws(() => parseSeoAdminTemplateExampleResult({ success: false, error: "locale_mismatch", message: "No." }, exampleRequest), /templates.example.error/);
assert.throws(() => parseSeoAdminTemplateExampleResult({ success: false, error: "not_found", collection: "posts", entryId: "p40" }, exampleRequest), /templates.example.error/);

const previewFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	generatedAt: "2026-07-14T10:00:00.000Z",
	content: {
		ref: "posts:post-1",
		entryId: "post-1",
		collection: "posts",
		collectionLabel: "Blog posts",
		title: "A useful post",
		slug: "a-useful-post",
	},
	search: {
		title: "A useful post — Shipit Digital",
		description: "A useful description.",
		fallbackTitle: "A useful post — Shipit Digital",
		fallbackDescription: "A useful description.",
		url: "https://shipitdigital.nl/blog/a-useful-post",
		titleLength: 31,
		descriptionLength: 21,
	},
	social: {
		title: "A useful post",
		description: "A useful description.",
		image: null,
		fallbackTitle: "A useful post",
		fallbackDescription: "A useful description.",
		override: { title: null, description: null, updatedAt: null },
		editing: { state: "ready", snapshot: { ref: "posts:post-1", revision: null, override: null } },
	},
	indexable: true,
	entryNoindex: false,
	canonicalValidation: {
		status: "matches",
		canonical: "https://shipitdigital.nl/blog/a-useful-post",
		expectedPath: "/blog/a-useful-post",
	},
	localeGraph: {
		owner: "emdash-core",
		emitsMarkup: false,
		status: "single-locale",
		hostSupportsTranslationGroups: false,
		currentLocale: "en",
		defaultLocale: "en",
		translationGroup: null,
		discoveredLocales: ["en"],
		alternates: [],
		xDefaultLocale: "en",
		issues: [],
	},
	schemaTypes: ["BlogPosting"],
	sources: {
		title: "template",
		description: "template",
		socialTitle: "template",
		socialDescription: "template",
		canonical: "generated",
		image: "site-default",
	},
	outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
};

assert.equal(
	parseSeoAdminEntryPreviewResult({ success: true, preview: previewFixture }).success,
	true,
);
const previewAnalysisSettings = { imageAltChecks: true, schemaOutput: false, nosnippet: false, descriptionGenerated: true };
const parsedPreviewSettings = parseSeoAdminEntryPreviewResult({ success: true, preview: { ...previewFixture, analysis: previewAnalysisSettings } });
assert.deepEqual(parsedPreviewSettings.success && parsedPreviewSettings.preview.analysis, previewAnalysisSettings,
	"the browser checks read their feature settings from the preview");
for (const analysis of [null, true, {}, { ...previewAnalysisSettings, imageAltChecks: "true" }, { ...previewAnalysisSettings, nosnippet: undefined },
	(({ descriptionGenerated: _generated, ...rest }) => rest)(previewAnalysisSettings)]) {
	assert.throws(() => parseSeoAdminEntryPreviewResult({ success: true, preview: { ...previewFixture, analysis } }), /preview\.analysis/, JSON.stringify(analysis));
}
// Every noindex source in precedence order; optional, so servers without it still parse.
for (const [noindexSources, indexable] of [[[], true], [["content-type-rule"], false], [["site-setting", "content-type-rule", "entry-seo", "legacy-override"], false]] as const) {
	const parsed = parseSeoAdminEntryPreviewResult({ success: true, preview: { ...previewFixture, indexable, noindexSources } });
	assert.deepEqual(parsed.success && parsed.preview.noindexSources, noindexSources);
}
for (const [noindexSources, indexable] of [[["content-type-rule"], true], [[], false], [["type"], false], [["entry-seo", "entry-seo"], false], ["entry-seo", false], [null, false]] as const) {
	assert.throws(() => parseSeoAdminEntryPreviewResult({ success: true, preview: { ...previewFixture, indexable, noindexSources } }),
		/preview\.noindexSources/, JSON.stringify(noindexSources));
}
// The image a cleared custom sharing image reveals; optional, so servers without it still parse.
for (const fallbackImage of [{ value: "https://example.com/featured.jpg", source: "content" }, { value: null, source: "site-default" }]) {
	const parsed = parseSeoAdminEntryPreviewResult({ success: true, preview: { ...previewFixture, social: { ...previewFixture.social, fallbackImage } } });
	assert.deepEqual(parsed.success && parsed.preview.social.fallbackImage, fallbackImage);
}
for (const fallbackImage of [null, "https://example.com/featured.jpg", { value: 1, source: "content" }, { value: null, source: "anywhere" }, { value: null }]) {
	assert.throws(() => parseSeoAdminEntryPreviewResult({ success: true, preview: { ...previewFixture, social: { ...previewFixture.social, fallbackImage } } }),
		/preview\.social\.fallbackImage/, JSON.stringify(fallbackImage));
}
const savedPreviewFixture = { ...previewFixture, sourceKind: "saved-snapshot", sourceVersion: "saved-version-2" };
const parsedSavedPreview = parseSeoAdminEntryPreviewResult({ success: true, preview: savedPreviewFixture });
assert.equal(parsedSavedPreview.success && parsedSavedPreview.preview.sourceVersion, "saved-version-2");
for (const preview of [
	{ ...savedPreviewFixture, sourceKind: undefined },
	{ ...savedPreviewFixture, sourceKind: "stored" },
	{ ...savedPreviewFixture, sourceVersion: undefined },
	{ ...savedPreviewFixture, sourceVersion: "" },
	{ ...savedPreviewFixture, sourceVersion: 2 },
	{ ...savedPreviewFixture, sourceVersion: "x".repeat(2_049) },
]) {
	assert.throws(() => parseSeoAdminEntryPreviewResult({ success: true, preview }), /preview.savedSnapshot/);
}
for (const content of [
	{ ...previewFixture.content, ref: "posts:other" },
	{ ...previewFixture.content, collection: "pages" },
	{ ...previewFixture.content, entryId: "" },
	{ ...previewFixture.content, entryId: undefined },
]) {
	assert.throws(() => parseSeoAdminEntryPreviewResult({ success: true, preview: { ...previewFixture, content } }), /preview.shape/);
}
assert.throws(
	() =>
		parseSeoAdminEntryPreviewResult({
		success: true,
		preview: { ...previewFixture, sources: { ...previewFixture.sources, title: "mystery" } },
	}),
	/preview.sources/,
);
assert.throws(
	() =>
		parseSeoAdminEntryPreviewResult({
		success: true,
		preview: { ...previewFixture, entryNoindex: "false" },
	}),
	/preview.shape/,
);
assert.throws(
	() =>
		parseSeoAdminEntryPreviewResult({
		success: true,
			preview: {
				...previewFixture,
				localeGraph: { ...previewFixture.localeGraph, owner: "plugin" },
			},
	}),
	/preview.localeGraph/,
);

const socialOverrideSaveFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	success: true,
	ref: "posts:post-1",
	outcome: "saved",
	snapshot: {
		ref: "posts:post-1",
		revision: "saved-revision",
		override: {
			storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
			ref: "posts:post-1",
			title: "A dedicated social headline",
			description: null,
			updatedAt: "2026-07-14T10:00:00.000Z",
		},
	},
};
assert.equal(parseSeoAdminSocialOverrideSaveResult(socialOverrideSaveFixture).success, true);
assert.throws(
	() => parseSeoAdminSocialOverrideSaveResult({
		...socialOverrideSaveFixture,
		snapshot: { ...socialOverrideSaveFixture.snapshot,
			override: { ...socialOverrideSaveFixture.snapshot.override, title: "x".repeat(301) } },
	}),
	/socialOverride.snapshot/,
);
assert.throws(
	() => parseSeoAdminSocialOverrideSaveResult({
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		success: false, ref: "posts:post-1", outcome: "rejected", error: "mystery",
	}),
	/socialOverride.error/,
);

const migrationSnapshot = {
	title: null,
	description: null,
	image: null,
	canonical: null,
	noIndex: false,
};

const migrationPlanFixture = {
	success: true,
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	generatedAt: "2026-07-14T10:00:00.000Z",
	migrationVersion: CORE_SEO_MIGRATION_VERSION,
	writeAvailable: true,
	discardAvailable: true,
	summary: { total: 1, ready: 1, conflicts: 0, empty: 0, unresolved: 0 },
	items: [
		{
			sourceOverrideId: "posts:post-1",
			fingerprint: `sha256-${"a".repeat(64)}`,
			ref: "posts:post-1",
			collection: "posts",
			entryId: "post-1",
			title: "A useful post",
			state: "ready",
			detail: "1 core SEO field is ready to migrate.",
			plan: {
			migrationVersion: CORE_SEO_MIGRATION_VERSION,
			ref: "posts:post-1",
			conflictPolicy: "skip",
			status: "ready",
			before: migrationSnapshot,
			target: { ...migrationSnapshot, title: "Legacy title" },
				fields: [
					{
				field: "title",
				action: "copy",
				legacy: "Legacy title",
				current: null,
				target: "Legacy title",
				conflict: false,
					},
				],
			conflicts: [],
			mappedFields: ["title"],
		},
		},
	],
	hasMore: false,
};

assert.equal(parseSeoAdminMigrationPlan(migrationPlanFixture).summary.ready, 1);
assert.equal(
	parseSeoAdminMigrationPlan({ ...migrationPlanFixture, hasMore: true, cursor: "overrides:next" }).cursor,
	"overrides:next",
);
assert.throws(
	() => parseSeoAdminMigrationPlan({ ...migrationPlanFixture, hasMore: true }),
	/migration.plan.cursor/,
);
assert.equal(parseSeoAdminMigrationPlan({ ...migrationPlanFixture, writeAvailable: false }).writeAvailable, false);
assert.throws(
	() => parseSeoAdminMigrationPlan({ ...migrationPlanFixture, writeAvailable: undefined }),
	/migration\.plan\.writeAvailable/,
);
assert.equal(
	parseSeoAdminMigrationPlan({
		...migrationPlanFixture,
		summary: { total: 1, ready: 0, conflicts: 0, empty: 0, unresolved: 1 },
		items: [
			{
			...migrationPlanFixture.items[0],
			entryId: undefined,
			title: undefined,
			state: "identifier-lookup-unavailable",
			detail:
				"The direct content ID lookup returned no entry. This host does not expose a bounded slug lookup to plugins, so migration cannot continue.",
			plan: undefined,
			},
		],
	}).items[0]?.state,
	"identifier-lookup-unavailable",
);
assert.throws(
	() => parseSeoAdminMigrationPlan({ ...migrationPlanFixture, migrationVersion: 2 }),
	/migrationVersion/,
);
assert.throws(
	() =>
		parseSeoAdminMigrationPlan({
		...migrationPlanFixture,
		items: [{ ...migrationPlanFixture.items[0], plan: undefined }],
	}),
	/missingPlan/,
);
assert.throws(
	() =>
		parseSeoAdminMigrationPlan({
			...migrationPlanFixture,
			items: [{ ...migrationPlanFixture.items[0], fingerprint: "fnv1a-12345678" }],
		}),
	/migration\.plan\.item/,
);

const migrationRecord = {
	id: "batch-1:posts%3Apost-1",
	batchId: "batch-1",
	migrationVersion: CORE_SEO_MIGRATION_VERSION,
	ref: "posts:post-1",
	collection: "posts",
	entryId: "post-1",
	sourceOverrideId: "posts:post-1",
	sourceOverride: {
		ref: "posts:post-1",
		title: "Legacy title",
		updatedAt: "2026-07-14T09:00:00.000Z",
	},
	conflictPolicy: "skip",
	before: migrationSnapshot,
	after: { ...migrationSnapshot, title: "Legacy title" },
	status: "applied",
	createdAt: "2026-07-14T10:00:00.000Z",
	updatedAt: "2026-07-14T10:00:01.000Z",
};

const migrationStatusFixture = {
	success: true,
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	generatedAt: "2026-07-14T10:00:02.000Z",
	migrationVersion: CORE_SEO_MIGRATION_VERSION,
	writeAvailable: true,
	items: [migrationRecord],
	hasMore: false,
};

assert.equal(parseSeoAdminMigrationStatus(migrationStatusFixture).items[0]?.status, "applied");
assert.equal(parseSeoAdminMigrationStatus({ ...migrationStatusFixture, writeAvailable: false }).writeAvailable, false);
assert.throws(
	() => parseSeoAdminMigrationStatus({ ...migrationStatusFixture, writeAvailable: undefined }),
	/migration\.status\.shape/,
);
assert.throws(
	() =>
		parseSeoAdminMigrationStatus({
		...migrationStatusFixture,
		items: [{ ...migrationRecord, before: { ...migrationSnapshot, noIndex: "false" } }],
	}),
	/item.before/,
);

const migrationOperationFixture = {
	success: true,
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	generatedAt: "2026-07-14T10:00:02.000Z",
	migrationVersion: CORE_SEO_MIGRATION_VERSION,
	batchId: "batch-1",
	summary: { applied: 1 },
	results: [{ ref: "posts:post-1", status: "applied", migrationId: migrationRecord.id }],
};

assert.equal(parseSeoAdminMigrationOperationResult(migrationOperationFixture).success, true);
assert.equal(
	parseSeoAdminMigrationOperationResult({
		...migrationOperationFixture,
		success: false,
		summary: { "identifier-lookup-unavailable": 1 },
		results: [
			{
			ref: "posts:article-slug",
			status: "identifier-lookup-unavailable",
			error: "The host does not expose a bounded slug lookup to plugins.",
			},
		],
	}).success,
	false,
);
assert.equal(
	parseSeoAdminMigrationOperationResult({
		...migrationOperationFixture,
		success: false,
		summary: { "partial-conflict": 1 },
		results: [
			{
				ref: "posts:post-1",
				status: "partial-conflict",
				migrationId: migrationRecord.id,
				error: "A newer human edit was preserved.",
			},
		],
	}).success,
	false,
);
assert.equal(
	parseSeoAdminMigrationOperationResult({
	success: false,
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	generatedAt: "2026-07-14T10:00:02.000Z",
	migrationVersion: CORE_SEO_MIGRATION_VERSION,
	error: "confirmation_required",
	expected: "MIGRATE_TO_CORE_SEO",
	}).success,
	false,
);
assert.throws(
	() =>
		parseSeoAdminMigrationOperationResult({
			...migrationOperationFixture,
			results: [{ ref: "posts:post-1", status: "mystery" }],
		}),
	/operation.item/,
);

const modulesFixture = {
	storageVersion: SEO_ADMIN_MODULES_STORAGE_VERSION,
	updatedAt: null,
	revision: null,
	writable: true,
	items: SEO_ADMIN_MODULE_DEFINITIONS.map((definition) => ({
		...definition,
		enabled: (seoModuleIsEditable(definition.status) || definition.key === "sitemap") && definition.defaultEnabled,
		editable: seoModuleIsEditable(definition.status),
	})),
};

const presetsFixture = {
	revision: "presets-r1",
	record: "valid",
	writable: true,
	storageVersion: SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	updatedAt: "2026-07-14T10:00:00.000Z",
	migrationNeeded: false,
	items: SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => ({
		...definition,
		enabled: definition.defaultEnabled,
	})),
};

const customSchemaFixture = {
	revision: "schema-r1",
	id: "schema-1",
	storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	name: "FAQ schema",
	scope: "pages:faq",
	json: '{"@context":"https://schema.org","@type":"FAQPage"}',
	enabled: true,
	types: ["FAQPage"],
	valid: true,
	validationError: null,
	createdAt: "2026-07-14T10:00:00.000Z",
	updatedAt: "2026-07-14T10:00:00.000Z",
};

const contentTypesFixture = {
	storageVersion: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	updatedAt: "2026-07-14T10:00:00.000Z",
	revision: "r-1",
	record: "valid",
	writable: true,
	discoveryAvailable: true,
	discoveredCount: 3,
	items: [
		{ collection: "posts", label: "Posts", role: "blogPosting", source: "default" },
		{ collection: "articles", label: "Articles", role: "blogPosting", source: "saved" },
		{ collection: "pages", label: "Pages", role: "webPage", source: "saved" },
	],
	unlisted: [{ collection: "archive", role: "service" }],
};

const configurationFixture = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	configurationVersion: SEO_ADMIN_CONFIGURATION_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	modules: modulesFixture,
	schema: {
		contentTypes: contentTypesFixture,
		presets: presetsFixture,
		customSchemaStorageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		customSchemas: [customSchemaFixture],
		hasMore: false,
	},
};

assert.equal(parseSeoAdminConfiguration(configurationFixture).modules.items.length, 9);
const withModules = (items: unknown[]) => ({ ...configurationFixture, modules: { ...configurationFixture.modules, items } });
const nativeSitemapModule = (configurationFixture.modules.items as any[]).map((item) => item.key === "sitemap"
	? { ...item, status: "active", editable: true, capability: "native-sitemap" } : item);
assert.equal(parseSeoAdminConfiguration(withModules(nativeSitemapModule)).modules.items.find((item) => item.key === "sitemap")?.editable, true,
	"native sitemap control is accepted only with its explicit capability");
assert.throws(() => parseSeoAdminConfiguration(withModules((configurationFixture.modules.items as any[]).map((item) => item.key === "sitemap"
	? { ...item, status: "active", editable: true } : item))), /configuration.modules.item/);
assert.throws(() => parseSeoAdminConfiguration(withModules((configurationFixture.modules.items as any[]).map((item) => item.key === "schema"
	? { ...item, capability: "native-sitemap" } : item))), /configuration.modules.item/);
assert.equal(
	parseSeoAdminConfiguration(configurationFixture).modules.items.find((item) => item.key === "monitor404")?.editable,
	true,
	"the 404 Monitor switch parses as editable",
);
assert.equal(parseSeoAdminConfiguration(configurationFixture).schema.contentTypes.items[1]?.role, "blogPosting");
for (const contentTypes of [
	{ ...contentTypesFixture, items: [{ ...contentTypesFixture.items[0], role: "recipe" }] },
	{ ...contentTypesFixture, items: [contentTypesFixture.items[0], contentTypesFixture.items[0]] },
	{ ...contentTypesFixture, discoveryAvailable: "yes" },
	{ ...contentTypesFixture, storageVersion: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION + 1 },
	{ ...contentTypesFixture, record: "missing" },
	{ ...contentTypesFixture, revision: "" },
	{ ...contentTypesFixture, writable: undefined },
	{ ...contentTypesFixture, discoveredCount: -1 },
	{ ...contentTypesFixture, unlisted: [{ collection: "posts", role: "none" }] },
	{ ...contentTypesFixture, items: Array.from({ length: 101 }, (_, index) => ({ collection: `type-${index}`, label: "Type", role: "none", source: "default" })) },
]) {
	assert.throws(
		() => parseSeoAdminConfiguration({ ...configurationFixture, schema: { ...configurationFixture.schema, contentTypes } }),
		/contentTypes/,
	);
}
assert.equal(
	parseSeoAdminSchemaContentTypesSaveResult({ success: true, contentTypes: contentTypesFixture }).success,
	true,
);
assert.equal(parseSeoAdminConfiguration(configurationFixture).schema.contentTypes.items[2]?.role, "webPage");
const conflictResult = parseSeoAdminSchemaContentTypesSaveResult({
	success: false,
	error: "conflict",
	errors: { _form: "The mapping changed after you opened it. Nothing was saved." },
	current: contentTypesFixture,
});
assert.equal(!conflictResult.success && conflictResult.error === "conflict" && conflictResult.current?.revision, "r-1");
assert.throws(
	() => parseSeoAdminSchemaContentTypesSaveResult({ success: false, errors: { articles: "Choose a supported schema type." } }),
	/contentTypes\.error/,
	"a failed save names its reason",
);
assert.equal(parseSeoAdminSchemaContentTypesReadResult({ contentTypes: contentTypesFixture, check: "not_applied" }).check, "not_applied");
assert.throws(() => parseSeoAdminSchemaContentTypesReadResult({ contentTypes: contentTypesFixture, check: "maybe" }), /check/);
assert.throws(() => parseSeoAdminSchemaContentTypesSaveResult({ success: true }), /contentTypes/);
assert.equal(parseSeoAdminConfiguration(configurationFixture).schema.presets.items.length, 12);
assert.equal(
	parseSeoAdminConfiguration(configurationFixture).schema.customSchemas[0]?.types[0],
	"FAQPage",
);
assert.throws(
	() =>
		parseSeoAdminConfiguration({
		...configurationFixture,
		configurationVersion: SEO_ADMIN_CONFIGURATION_VERSION + 1,
	}),
	/configurationVersion/,
);
assert.throws(
	() =>
		parseSeoAdminConfiguration({
			...configurationFixture,
			modules: {
				...modulesFixture,
				items: [{ ...modulesFixture.items[0], editable: "yes" }, ...modulesFixture.items.slice(1)],
			},
		}),
	/modules.item/,
);
assert.throws(
	() =>
		parseSeoAdminConfiguration({
			...configurationFixture,
			modules: {
				...modulesFixture,
				items: [{ ...modulesFixture.items[0], enabled: true }, ...modulesFixture.items.slice(1)],
			},
		}),
	/modules.item/,
);
assert.throws(
	() =>
		parseSeoAdminConfiguration({
		...configurationFixture,
		schema: {
			...configurationFixture.schema,
			presets: {
				...presetsFixture,
					items: [
						{ ...presetsFixture.items[0], group: "unknown" },
						...presetsFixture.items.slice(1),
					],
			},
		},
	}),
	/presets.item/,
);
assert.throws(
	() =>
		parseSeoAdminConfiguration({
		...configurationFixture,
			schema: {
				...configurationFixture.schema,
				customSchemas: [{ ...customSchemaFixture, types: [42] }],
			},
	}),
	/customSchema/,
);
assert.equal(
	parseSeoAdminModulesSaveResult({ success: true, modules: modulesFixture }).success,
	true,
);
assert.equal(
	parseSeoAdminModulesSaveResult({ success: false, errors: { analytics: "Connect provider" } })
		.success,
	false,
);
// Module writes name a stored revision; a refused write reports a conflict explicitly.
assert.deepEqual(parseSeoAdminModulesSaveResult({ success: false, conflict: true, errors: { _form: "Changed" } }),
	{ success: false, conflict: true, errors: { _form: "Changed" } });
assert.throws(() => parseSeoAdminModulesSaveResult({ success: false, conflict: "yes", errors: {} }), /modules.conflict/);
assert.equal(parseSeoAdminConfiguration({ ...configurationFixture, modules: { ...modulesFixture, revision: "rev-1" } }).modules.revision, "rev-1");
assert.throws(() => parseSeoAdminConfiguration({ ...configurationFixture, modules: { ...modulesFixture, revision: 7 } }), /modules.revision/);
assert.throws(() => parseSeoAdminConfiguration({ ...configurationFixture, modules: { ...modulesFixture, writable: undefined } }), /modules.writable/);
assert.throws(() => parseSeoAdminConfiguration({ ...configurationFixture, modules: { ...modulesFixture, writable: false, revision: "rev-1" } }), /modules.writable/,
	"an unwritable record has no revision to name");
assert.equal(
	parseSeoAdminSchemaPresetsSaveResult({ success: true, changed: true, presets: presetsFixture }).success,
	true,
);
assert.equal(
	parseSeoAdminCustomSchemaSaveResult({ success: true, changed: true, schema: customSchemaFixture }).success,
	true,
);
assert.equal(
	parseSeoAdminSchemaComposerSaveResult({
	success: true,
	changed: true,
	schema: customSchemaFixture,
	recipe: "howTo",
	json: customSchemaFixture.json,
	}).success,
	true,
);
assert.equal(
	parseSeoAdminSchemaComposerSaveResult({ success: false, error: "invalid_values", message: "Add two steps", errors: { steps: "Add two steps" } })
		.success,
	false,
);
assert.throws(
	() =>
		parseSeoAdminSchemaComposerSaveResult({
		success: true,
		changed: true,
		schema: customSchemaFixture,
		recipe: "unsafe",
		json: customSchemaFixture.json,
	}),
	/composer.recipe/,
);
assert.equal(
	parseSeoAdminCustomSchemaDeleteResult({ success: true, id: "schema-1" }).success,
	true,
);
assert.throws(
	() => parseSeoAdminCustomSchemaDeleteResult({ success: false, error: "unknown" }),
	/delete.error/,
);

const schemaWrite = { id: customSchemaFixture.id, expectedRevision: null,
	name: customSchemaFixture.name, scope: customSchemaFixture.scope, json: customSchemaFixture.json, enabled: customSchemaFixture.enabled };
const savedSchemaWrite = { success: true, changed: true, schema: customSchemaFixture };
assert.equal(parseSeoAdminCustomSchemaSaveResult(savedSchemaWrite, schemaWrite).success, true);
for (const schema of [
	{ ...customSchemaFixture, id: "other-schema" },
	{ ...customSchemaFixture, revision: null },
	{ ...customSchemaFixture, revision: "" },
	{ ...customSchemaFixture, name: "Other name" },
	{ ...customSchemaFixture, scope: "global" },
	{ ...customSchemaFixture, json: "{}" },
	{ ...customSchemaFixture, enabled: false },
	{ ...customSchemaFixture, valid: false },
]) assert.throws(() => parseSeoAdminCustomSchemaSaveResult({ ...savedSchemaWrite, schema }, schemaWrite), /configuration.schema.custom/);
assert.throws(() => parseSeoAdminCustomSchemaSaveResult({ ...savedSchemaWrite, changed: false }, schemaWrite), /custom.saved/);
assert.throws(() => parseSeoAdminCustomSchemaSaveResult(savedSchemaWrite, { ...schemaWrite, expectedRevision: customSchemaFixture.revision }), /custom.saved/);
assert.equal(parseSeoAdminCustomSchemaSaveResult({ ...savedSchemaWrite, changed: false }, { ...schemaWrite, expectedRevision: customSchemaFixture.revision }).success, true);
assert.throws(() => parseSeoAdminCustomSchemaSaveResult({ success: true, schema: customSchemaFixture }, schemaWrite), /custom.changed/);
assert.throws(() => parseSeoAdminCustomSchemaSaveResult({ success: false, errors: {} }, schemaWrite), /custom.error/);
const customConflict = { success: false, error: "conflict", message: "The schema changed.", errors: { _form: "Review the stored version." }, current: customSchemaFixture };
assert.equal(parseSeoAdminCustomSchemaSaveResult(customConflict, schemaWrite).success, false);
assert.throws(() => parseSeoAdminCustomSchemaSaveResult({ ...customConflict, current: { ...customSchemaFixture, id: "other-schema" } }, schemaWrite), /current.id/);
assert.equal(parseSeoAdminCustomSchemaReadResult({ success: true, id: schemaWrite.id, state: "saved", schema: customSchemaFixture }, schemaWrite.id).success, true);
assert.equal(parseSeoAdminCustomSchemaReadResult({ success: true, id: schemaWrite.id, state: "absent", schema: null }, schemaWrite.id).success, true);
assert.equal(parseSeoAdminCustomSchemaReadResult({ success: true, id: schemaWrite.id, state: "invalid", schema: null, revision: "invalid-r1" }, schemaWrite.id).success, true);
assert.equal(parseSeoAdminCustomSchemaReadResult({ success: false, error: "unavailable", message: "Storage could not be read." }, schemaWrite.id).success, false);
for (const response of [
	{ success: true, id: "other-schema", state: "saved", schema: customSchemaFixture },
	{ success: true, id: schemaWrite.id, state: "saved", schema: { ...customSchemaFixture, id: "other-schema" } },
	{ success: true, id: schemaWrite.id, state: "invalid", schema: null, revision: null },
	{ success: true, id: schemaWrite.id, state: "absent", schema: customSchemaFixture },
	{ success: true, id: schemaWrite.id, state: "unknown", schema: null },
	{ success: false, error: "unavailable", message: "" },
]) assert.throws(() => parseSeoAdminCustomSchemaReadResult(response, schemaWrite.id), /custom.read/);
assert.throws(() => parseSeoAdminCustomSchemaDeleteResult({ success: true, id: "other-schema" }, schemaWrite.id), /delete.id/);
assert.throws(() => parseSeoAdminCustomSchemaDeleteResult({ ...customConflict, current: { ...customSchemaFixture, id: "other-schema" } }, schemaWrite.id), /delete.current.id/);
const presetValues = Object.fromEntries(presetsFixture.items.map(item => [item.key, item.enabled])) as import("../admin-contract.ts").SeoAdminSchemaPresetValues;
const presetWrite = { values: presetValues, expectedRevision: null };
const presetSaved = { success: true, changed: true, presets: presetsFixture };
assert.equal(parseSeoAdminSchemaPresetsSaveResult(presetSaved, presetWrite).success, true);
assert.throws(() => parseSeoAdminSchemaPresetsSaveResult(presetSaved, { ...presetWrite, expectedRevision: presetsFixture.revision }), /presets.saved/);
assert.throws(() => parseSeoAdminSchemaPresetsSaveResult({ ...presetSaved, changed: false }, presetWrite), /presets.saved/);
assert.equal(parseSeoAdminSchemaPresetsSaveResult({ ...presetSaved, changed: false }, { ...presetWrite, expectedRevision: presetsFixture.revision }).success, true);
assert.throws(() => parseSeoAdminSchemaPresetsSaveResult({ ...presetSaved, presets: { ...presetsFixture, items: presetsFixture.items.map((item, i) => i ? item : { ...item, enabled: !item.enabled }) } }, presetWrite), /presets.saved/);
assert.equal(parseSeoAdminSchemaPresetsSaveResult({ success: true, changed: true, presets: { ...presetsFixture, record: "absent", revision: null, updatedAt: null } }, { operation: "reset", expectedRevision: "presets-r1" }).success, true);
assert.throws(() => parseSeoAdminSchemaPresetsSaveResult(presetSaved, { operation: "reset", expectedRevision: "presets-r1" }), /presets.reset/);
for (const presets of [
	{ ...presetsFixture, revision: null },
	{ ...presetsFixture, record: "absent" },
	{ ...presetsFixture, record: "invalid", revision: null },
	{ ...presetsFixture, record: "unavailable", revision: null, writable: true },
	{ ...presetsFixture, items: [presetsFixture.items[0], presetsFixture.items[0], ...presetsFixture.items.slice(2)] },
]) assert.throws(() => parseSeoAdminSchemaPresetConfiguration(presets), /presets/);
assert.equal(parseSeoAdminSchemaPresetConfiguration({ ...presetsFixture, record: "unavailable", revision: null, writable: false }).record, "unavailable");

const composedWrite = { ...defaultSeoSchemaComposerInput("course"), id: "course-schema", expectedRevision: null, scope: "pages:course", schemaName: "  Course schema  " };
const composedValue = composeSeoSchema(composedWrite);
assert.equal(composedValue.success, true);
if (composedValue.success) {
	const composedStored = { ...customSchemaFixture, id: composedWrite.id, revision: "course-r1",
		name: composedValue.output.schemaName, scope: composedValue.output.scope, json: composedValue.output.json,
		enabled: composedValue.output.enabled, types: ["Course"] };
	const composedSuccess = { success: true, changed: true, schema: composedStored, recipe: composedValue.output.recipe, json: composedValue.output.json };
	assert.equal(parseSeoAdminSchemaComposerSaveResult(composedSuccess, composedWrite).success, true);
	for (const response of [
		{ ...composedSuccess, schema: { ...composedStored, id: "wrong-course" } },
		{ ...composedSuccess, recipe: "howTo" },
		{ ...composedSuccess, json: "{}" },
		{ ...composedSuccess, schema: { ...composedStored, json: "{}" }, json: "{}" },
	]) assert.throws(() => parseSeoAdminSchemaComposerSaveResult(response, composedWrite), /configuration.schema/);
}

const portabilityBundleFixture: SeoPortabilityBundle = {
	format: SEO_PORTABILITY_FORMAT,
	version: SEO_PORTABILITY_VERSION,
	exportedAt: "2026-07-14T10:00:00.000Z",
	engineVersion: SEO_ENGINE_VERSION,
	source: {
		siteName: settingsFixture.values.siteName,
		siteUrl: settingsFixture.values.siteUrl,
	},
	safeguards: {
		secrets: "omitted",
		excluded: ["indexNow.apiKey", "indexNow.queue", "indexNow.deliveries"],
	},
	configuration: {
		settings: settingsFixture.values,
		sitemap: defaultSeoAdminSitemapValues(),
		modules: Object.fromEntries(
			modulesFixture.items.map((item) => [item.key, item.enabled]),
		) as SeoPortabilityBundle["configuration"]["modules"],
		schemaPresets: Object.fromEntries(
			presetsFixture.items.map((item) => [item.key, item.enabled]),
		) as SeoPortabilityBundle["configuration"]["schemaPresets"],
		templates: templateValues,
		customSchemas: [
			{
			id: customSchemaFixture.id,
			name: customSchemaFixture.name,
			scope: customSchemaFixture.scope,
			json: customSchemaFixture.json,
			enabled: customSchemaFixture.enabled,
			},
		],
		indexNow: {
			autoSubmit: indexNowValues.autoSubmit,
			autoSubmitContentTypes: indexNowValues.autoSubmitContentTypes,
			keyLocation: indexNowValues.keyLocation,
			batchSize: indexNowValues.batchSize,
			minIntervalSeconds: indexNowValues.minIntervalSeconds,
			maxAttempts: indexNowValues.maxAttempts,
		},
	},
};

const portabilityPlanFixture: SeoPortabilityImportPlan = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	portabilityVersion: SEO_PORTABILITY_VERSION,
	generatedAt: "2026-07-14T10:01:00.000Z",
	mode: "merge",
	fingerprint: "fnv1a:fixture",
	source: portabilityBundleFixture.source,
	target: portabilityBundleFixture.source,
	summary: {
		changedSections: 1,
		added: 1,
		updated: 0,
		unchanged: 6,
		deleted: 0,
		destructive: false,
		indexNowWillBeDisabled: false,
	},
	sections: [
		{
			key: "settings",
			label: "Site and social",
			changed: false,
			added: 0,
			updated: 0,
			unchanged: 1,
			deleted: 0,
		},
		{
			key: "sitemap",
			label: "Sitemap policy",
			changed: false,
			added: 0,
			updated: 0,
			unchanged: 1,
			deleted: 0,
		},
		{
			key: "modules",
			label: "Modules",
			changed: false,
			added: 0,
			updated: 0,
			unchanged: 1,
			deleted: 0,
		},
		{
			key: "schemaPresets",
			label: "Schema presets",
			changed: false,
			added: 0,
			updated: 0,
			unchanged: 1,
			deleted: 0,
		},
		{
			key: "templates",
			label: "Templates",
			changed: false,
			added: 0,
			updated: 0,
			unchanged: 1,
			deleted: 0,
		},
		{
			key: "customSchemas",
			label: "Custom schemas",
			changed: true,
			added: 1,
			updated: 0,
			unchanged: 0,
			deleted: 0,
		},
		{
			key: "indexNow",
			label: "IndexNow policy",
			changed: false,
			added: 0,
			updated: 0,
			unchanged: 1,
			deleted: 0,
		},
	],
	warnings: [],
	requiresConfirmation: true,
};

assert.equal(
	parseSeoPortabilityExportResponse({
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	generatedAt: portabilityBundleFixture.exportedAt,
	bundle: portabilityBundleFixture,
	warnings: ["Secrets are omitted."],
	}).bundle.safeguards.secrets,
	"omitted",
);
assert.throws(
	() =>
		parseSeoPortabilityExportResponse({
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		generatedAt: portabilityBundleFixture.exportedAt,
		bundle: {
			...portabilityBundleFixture,
			configuration: {
				...portabilityBundleFixture.configuration,
					indexNow: {
						...portabilityBundleFixture.configuration.indexNow,
						apiKey: "must-not-cross-boundary",
			},
		},
			},
		warnings: [],
	}),
	/portability.bundle.indexNow/,
);
assert.equal(
	parseSeoPortabilityPreviewResult({
	success: true,
	plan: portabilityPlanFixture,
	bundle: portabilityBundleFixture,
	}).success,
	true,
);
assert.equal(
	parseSeoPortabilityPreviewResult({
	success: false,
	error: "invalid_bundle",
	errors: ["Unsupported bundle version."],
	}).success,
	false,
);
assert.equal(
	parseSeoPortabilityApplyResult({
	success: true,
	appliedAt: "2026-07-14T10:02:00.000Z",
	plan: portabilityPlanFixture,
	backup: portabilityBundleFixture,
	}).success,
	true,
);
assert.equal(
	parseSeoPortabilityApplyResult({
	success: false,
	error: "apply_failed",
	detail: "The previous configuration was restored.",
	rollbackPerformed: true,
	}).success,
	false,
);
assert.equal(
	parseSeoPortabilityApplyResult({
	success: false,
	error: "preview_stale",
	detail: "Validate the import again.",
	}).success,
	false,
);
assert.equal(
	parseSeoPortabilityApplyResult({
		success: false,
		error: "rollback_conflict",
		detail: "Concurrent changes were preserved.",
		errors: ["settings:global:v1 changed during rollback"],
		rollbackPerformed: false,
	}).success,
	false,
);
assert.throws(
	() => parseSeoPortabilityPreviewResult({ success: false, error: "invalid_bundle", errors: [42] }),
	/portability.preview.error/,
);

// Redirect results: the list is bounded by its own query, and create shares
// one strict union with its read-only reconciliation.
{
	const rule = {
		id: "01J9REDIRECT", source: "/old", destination: "/new", type: 301, isPattern: false, enabled: true,
		hits: 3, lastHitAt: null, groupName: null, auto: false,
		createdAt: "2026-10-02T12:00:00.000Z", updatedAt: "2026-10-02T12:00:00.000Z",
	};
	const query = { search: null, enabled: null, auto: null, group: null, limit: 2, cursor: null };
	const page = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "ok", query, items: [rule], cursor: "next", hasMore: true, create: "available" };
	assert.equal(parseSeoAdminRedirectRuleListResult(page).status, "ok");
	for (const broken of [
		{ ...page, contractVersion: 1 },
		{ ...page, hasMore: false },
		{ ...page, cursor: null },
		{ ...page, create: "maybe" },
		{ ...page, items: [rule, { ...rule, id: "second" }, { ...rule, id: "third" }] },
		{ ...page, items: [rule, rule] },
		{ ...page, items: [{ ...rule, hits: -1 }] },
		{ ...page, items: [{ ...rule, type: "301" }] },
		{ ...page, query: { ...query, limit: 101 } },
		{ ...page, status: "partial" },
	]) assert.throws(() => parseSeoAdminRedirectRuleListResult(broken), /redirects\./);
	assert.equal(parseSeoAdminRedirectRuleListResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "invalid-cursor", query, message: "Load the first page again." }).status, "invalid-cursor");
	assert.throws(() => parseSeoAdminRedirectRuleListResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "failed", message: "" }));

	const created = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "created", rule, confirmedBy: "lookup" };
	assert.equal(parseSeoAdminRedirectRuleCreateResult(created).status, "created");
	for (const valid of [
		{ status: "invalid", errors: { source: { code: "query", message: "Remove the ? part." } } },
		{ status: "conflict", reason: "trailing-slash", message: "same address", existing: rule },
		{ status: "conflict", reason: "check-incomplete", message: "could not check", existing: null },
		{ status: "failed", reason: "not-saved", message: "kept", retryable: true },
		{ status: "uncertain", message: "Search for it in EmDash Redirects." },
		{ status: "unavailable", reason: "read-only", message: "read only" },
	]) assert.equal(parseSeoAdminRedirectRuleCreateResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, ...valid }).status, valid.status);
	for (const broken of [
		{ ...created, confirmedBy: "guess" },
		{ ...created, rule: { ...rule, enabled: false } },
		{ ...created, rule: { ...rule, isPattern: true } },
		{ ...created, rule: { ...rule, type: 307 } },
		{ ...created, rule: { ...rule, id: "" } },
		{ contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "invalid", errors: {} },
		{ contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "invalid", errors: { slug: { code: "query", message: "x" } } },
		{ contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "conflict", reason: "maybe", message: "x", existing: null },
		{ contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "failed", reason: "not-saved", message: "kept" },
		{ contractVersion: SEO_ADMIN_CONTRACT_VERSION, status: "created" },
	]) assert.throws(() => parseSeoAdminRedirectRuleCreateResult(broken), /redirects\./);
}

// ---- Publisher ownership: the effective mode must follow from the stored state ----
{
	const ownership = { storageVersion: 1, state: "valid", mode: "none", effective: "none", revision: "r1", writable: true, gates: { schemaModule: true, sitePublisherPreset: false }, message: null };
	assert.equal(parseSeoAdminPublisherOwnershipReadResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, ownership }).ownership.effective, "none");
	assert.equal(parseSeoAdminPublisherOwnershipReadResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, ownership: { ...ownership, state: "absent", mode: null, effective: "automatic", revision: null } }).ownership.state, "absent");
	assert.equal(parseSeoAdminPublisherOwnershipReadResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, ownership: { ...ownership, state: "corrupt", mode: null, effective: "unknown", writable: false, message: "damaged" } }).ownership.effective, "unknown");
	assert.throws(() => parseSeoAdminPublisherOwnershipReadResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION - 1, ownership }), /engine\/admin mismatch/);
	for (const broken of [
		{ ...ownership, effective: "automatic" },
		{ ...ownership, state: "corrupt", mode: null, effective: "none", writable: false },
		{ ...ownership, state: "corrupt", mode: null, effective: "unknown", writable: true },
		{ ...ownership, state: "absent", mode: null, effective: "automatic", revision: "r1" },
		{ ...ownership, revision: null },
		{ ...ownership, mode: "off" },
		{ ...ownership, gates: { schemaModule: "yes", sitePublisherPreset: true } },
		{ ...ownership, storageVersion: 2 },
	]) assert.throws(() => parseSeoAdminPublisherOwnershipReadResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, ownership: broken }), /publisherOwnership/);
	assert.equal(parseSeoAdminPublisherOwnershipReadResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, ownership, check: "matches_loaded" }).check, "matches_loaded");
	assert.throws(() => parseSeoAdminPublisherOwnershipReadResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, ownership, check: "applied" }), /publisherOwnership/);
	const refused = { status: "refused", reason: "collision", source: "legacy", entityId: "https://x/#organization", checked: 1, definitions: [{ id: "a", name: "A", scope: "global", ownedIds: ["https://x/#organization"] }], more: 0, message: "defines" };
	const write = parseSeoAdminPublisherOwnershipWriteResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: false, error: "preflight", message: "defines", ownership, preflight: refused });
	assert.ok(!write.success && write.preflight?.reason === "collision");
	assert.throws(() => parseSeoAdminPublisherOwnershipWriteResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: false, error: "preflight", message: "x", preflight: { ...refused, definitions: Array.from({ length: 11 }, () => refused.definitions[0]) } }), /publisherOwnership/);
	assert.throws(() => parseSeoAdminPublisherOwnershipWriteResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: true, changed: true, ownership, preflight: refused }), /publisherOwnership/);
	assert.throws(() => parseSeoAdminPublisherOwnershipWriteResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: false, error: "retry", message: "x" }), /publisherOwnership/);
	assert.ok(!parseSeoAdminPublisherOwnershipWriteResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: false, error: "unconfirmed", message: "x", intended: "none" }).success);
	assert.throws(() => parseSeoAdminPublisherOwnershipWriteResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: false, error: "unconfirmed", message: "x", intended: "maybe" }), /publisherOwnership/);
	const clear = parseSeoAdminPublisherOwnershipWriteResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: true, changed: true, ownership: { ...ownership, mode: "automatic", effective: "automatic" }, preflight: { status: "clear", source: "business", entityId: "https://x/#organization", checked: 3 } });
	assert.ok(clear.success && clear.preflight?.checked === 3);
}

// ---- Saved ownership facts on the entry preview ----
const ownedPreview = {
	...savedPreviewFixture,
	ownership: {
		status: "current",
		reason: null,
		sourceVersion: "saved-version-2",
		locale: "en",
		record: { sourceOverrideId: "posts:post-1", keyKind: "id" },
		fields: [
			{ field: "title", state: "conflict", core: "Core title", legacy: "Legacy title", effective: "Legacy title", effectiveSource: "legacy-override", social: { value: "Legacy title", source: "legacy-override" } },
			{ field: "description", state: "equal", core: "Same text", legacy: "Same text", effective: "Same text", effectiveSource: "legacy-override", social: { value: "Same text", source: "legacy-override" } },
			// Equal after URL resolution although the stored strings differ.
			{ field: "canonical", state: "equal", core: "/blog/a-useful-post", legacy: "https://shipitdigital.nl/blog/a-useful-post", effective: "https://shipitdigital.nl/blog/a-useful-post", effectiveSource: "legacy-override", social: null },
			{ field: "image", state: "not-shadowed", core: null, legacy: null, effective: null, effectiveSource: "site-default", social: null },
			{ field: "noIndex", state: "conflict", core: false, legacy: true, effective: true, effectiveSource: "legacy-override", social: null },
		],
		unsupportedDirectives: { state: "present", tokens: ["noarchive"] },
	},
};
const ownershipVariant = (change: (ownership: any, preview: any) => void) => {
	const preview = structuredClone(ownedPreview) as any;
	change(preview.ownership, preview);
	return { success: true, preview };
};
assert.equal(parseSeoAdminEntryPreviewResult({ success: true, preview: ownedPreview }).success, true);
assert.equal(
	parseSeoAdminEntryPreviewResult(ownershipVariant((ownership) => {
		ownership.record = { sourceOverrideId: "posts:a-useful-post", keyKind: "slug-alias" };
	})).success,
	true,
	"an alias key in the entry's collection is valid",
);
const staleOwnership = (ownership: any) => {
	ownership.status = "stale";
	ownership.reason = "saved-version-mismatch";
	ownership.record = null;
	ownership.fields = ownership.fields.map((item: any) => ({
		field: item.field, state: "unknown", core: null, legacy: null, effective: null, effectiveSource: null, social: null, reason: "saved-version-mismatch",
	}));
	ownership.unsupportedDirectives = { state: "unknown", tokens: [] };
};
assert.equal(parseSeoAdminEntryPreviewResult(ownershipVariant(staleOwnership)).success, true);
for (const [name, change, pattern] of [
	["an exact-ID key other than the entry", (ownership: any) => { ownership.record.sourceOverrideId = "posts:post-2"; }, /preview\.ownership\.record/],
	["an alias key from another collection", (ownership: any) => { ownership.record = { sourceOverrideId: "pages:a-useful-post", keyKind: "slug-alias" }; }, /preview\.ownership\.record/],
	["a not-shadowed field decided by a legacy record", (ownership: any) => { ownership.fields[3].effectiveSource = "legacy-override"; }, /fields\.image/],
	["equal title values that differ", (ownership: any) => { ownership.fields[0].state = "equal"; }, /fields\.title/],
	["a conflict reported without a record", (ownership: any) => { ownership.record = null; }, /fields\.title/],
	["an unknown field that keeps values", (ownership: any) => { Object.assign(ownership.fields[1], { state: "unknown", reason: "legacy-field-invalid" }); }, /fields\.description/],
	["four fields", (ownership: any) => { ownership.fields.pop(); }, /preview\.ownership/],
	["fields out of order", (ownership: any) => { ownership.fields.reverse(); }, /fields\.title/],
	["a stale answer that names a record", (ownership: any) => { staleOwnership(ownership); ownership.record = { sourceOverrideId: "posts:post-1", keyKind: "id" }; }, /preview\.ownership\.status/],
	["a stale answer with known facts", (ownership: any) => { staleOwnership(ownership); ownership.unsupportedDirectives = { state: "none", tokens: [] }; }, /unsupportedDirectives/],
	["a current answer for another saved version", (ownership: any) => { ownership.sourceVersion = "saved-version-3"; }, /preview\.ownership\.sourceVersion/],
	["an unexpected key", (ownership: any) => { ownership.extra = true; }, /preview\.ownership/],
	["a non-boolean noIndex value", (ownership: any) => { ownership.fields[4].core = "false"; }, /fields\.noIndex/],
] as const) {
	assert.throws(() => parseSeoAdminEntryPreviewResult(ownershipVariant(change)), pattern, name);
}
// A content type rule can decide only the noIndex field.
assert.equal(parseSeoAdminEntryPreviewResult(ownershipVariant((ownership) => {
	ownership.fields[4] = { field: "noIndex", state: "not-shadowed", core: false, legacy: null, effective: true, effectiveSource: "content-type-rule", social: null };
})).success, true, "the rule may decide noIndex");
assert.throws(() => parseSeoAdminEntryPreviewResult(ownershipVariant((ownership) => {
	ownership.fields[3] = { ...ownership.fields[3], effectiveSource: "content-type-rule" };
})), /fields\.image/, "the rule never decides another field");

// ---- Discard capability and the bound record export ----
assert.throws(
	() => parseSeoAdminMigrationPlan({ ...migrationPlanFixture, discardAvailable: undefined }),
	/migration\.plan\.discardAvailable/,
);
const exportFingerprint = migrationPlanFixture.items[0].fingerprint;
const exportDocument = (change: (document: any) => void = () => undefined) => {
	const document: any = {
		format: "shipit-seo-legacy-record-export",
		formatVersion: 1,
		generatedAt: migrationPlanFixture.generatedAt,
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		sourceOverrideId: "posts:post-1",
		reference: "posts:post-1",
		entry: { ref: "posts:post-1", collection: "posts", entryId: "post-1", locale: "en" },
		conflictPolicy: "skip",
		fingerprint: exportFingerprint,
		record: { ref: "posts:post-1", title: "Legacy title", robots: "noindex,noarchive", notes: { kept: [1, "two", null, true] } },
	};
	change(document);
	return JSON.stringify(document);
};
const snapshotPlan = (document: string, options: { bytes?: number; plan?: Record<string, unknown> } = {}) => ({
	...migrationPlanFixture,
	...options.plan,
	items: [{
		...migrationPlanFixture.items[0],
		snapshot: { status: "available", bytes: options.bytes ?? new TextEncoder().encode(document).byteLength, document },
	}],
});
const parsedSnapshot = parseSeoAdminMigrationPlan(snapshotPlan(exportDocument())).items[0].snapshot;
assert.equal(parsedSnapshot?.status, "available");
assert.equal(
	parseSeoAdminMigrationPlan({ ...migrationPlanFixture, items: [{ ...migrationPlanFixture.items[0], snapshot: { status: "refused", reason: "not-json" } }] })
		.items[0].snapshot?.status,
	"refused",
);
for (const [name, plan, pattern] of [
	["a byte count that is not the document's", snapshotPlan(exportDocument(), { bytes: 10 }), /migration\.plan\.snapshot$/],
	["a document above the limit", snapshotPlan(exportDocument((document) => { document.record.notes = "x".repeat(SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES); })), /migration\.plan\.snapshot$/],
	["another fingerprint", snapshotPlan(exportDocument((document) => { document.fingerprint = `sha256-${"b".repeat(64)}`; })), /snapshot\.document/],
	["a policy other than the plan's", snapshotPlan(exportDocument((document) => { document.conflictPolicy = "prefer-core"; })), /snapshot\.document/],
	["an alias record", snapshotPlan(exportDocument((document) => { document.sourceOverrideId = "posts:a-useful-post"; })), /snapshot\.document/],
	["another entry", snapshotPlan(exportDocument((document) => { document.entry.entryId = "post-2"; })), /snapshot\.document/],
	["a non-string locale", snapshotPlan(exportDocument((document) => { document.entry.locale = 1; })), /snapshot\.document/],
	["another response time", snapshotPlan(exportDocument((document) => { document.generatedAt = "2026-07-14T10:00:01.000Z"; })), /snapshot\.document/],
	["an extra envelope field", snapshotPlan(exportDocument((document) => { document.extra = true; })), /snapshot\.document/],
	["a record number JSON.parse makes infinite", snapshotPlan(exportDocument().replace('"kept":[1,', '"kept":[1e400,')), /snapshot\.document/],
	["a negative zero", snapshotPlan(exportDocument().replace('"kept":[1,', '"kept":[-0,')), /snapshot\.document/],
	["text that is not JSON", snapshotPlan(exportDocument().slice(0, -1)), /snapshot\.document/],
	["a snapshot on a paged response", snapshotPlan(exportDocument(), { plan: { hasMore: true, cursor: "overrides:next" } }), /snapshot\.scope/],
	["a snapshot among two items", { ...snapshotPlan(exportDocument()), items: [snapshotPlan(exportDocument()).items[0], migrationPlanFixture.items[0]], summary: { ...migrationPlanFixture.summary, total: 2 } }, /snapshot\.scope/],
	["an unknown refusal", { ...migrationPlanFixture, items: [{ ...migrationPlanFixture.items[0], snapshot: { status: "refused", reason: "truncated" } }] }, /migration\.plan\.snapshot$/],
	["a refusal carrying a record", { ...migrationPlanFixture, items: [{ ...migrationPlanFixture.items[0], snapshot: { status: "refused", reason: "too-large", document: "{}" } }] }, /migration\.plan\.snapshot$/],
] as const) {
	assert.throws(() => parseSeoAdminMigrationPlan(plan), pattern, name);
}
const unavailableDiscard = {
	success: false,
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	error: "discard_unavailable",
};
assert.equal(parseSeoAdminLegacyDiscardResponse(unavailableDiscard).success, false);
assert.throws(() => parseSeoAdminLegacyDiscardResult(unavailableDiscard), /migration\.discard\.error/, "the earlier result type never carries the capability refusal");
assert.throws(() => parseSeoAdminLegacyDiscardResponse({ ...unavailableDiscard, sourceOverrideId: "posts:post-1" }), /migration\.discard/);
assert.throws(() => parseSeoAdminLegacyDiscardResponse({ ...unavailableDiscard, contractVersion: 32 }), /migration\.discard/);
assert.equal(
	parseSeoAdminLegacyDiscardResponse({ ...unavailableDiscard, error: "preview_stale" }).success,
	false,
	"other refusals keep their earlier parser",
);

// ---- Durable score scans ----

const scanCounters = Object.fromEntries([
	"fetchedCandidates", "examinedCandidates", "matchedReferences", "noLongerMatching", "admitted", "attempts", "analyzed",
	"reused", "saved", "superseded", "skipped", "failed", "retried", "uncertain",
	"historyCreated", "historyUnchanged", "historyFailed", "historyUncertain", "historyUnknown",
].map((key) => [key, 0]));
const scanOutcome = {
	attemptId: "attempt-1", admission: 1, ref: "posts:a", locale: "en", recordedAt: "2026-10-04T10:00:00.000Z",
	status: "saved", reason: null, computation: "confirmed", score: 80, history: "created",
};
const scanView = {
	runId: "scan-0123456789", revision: 3, state: "running", pauseReason: null, completion: null,
	createdAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T10:00:01.000Z",
	scope: { collection: "posts", status: "published", locale: null, taxonomies: [{ taxonomy: "category", termIds: ["t1"], includeDescendants: true, termGroupCount: 3 }] },
	target: { mode: "count", count: 10 }, counters: { ...scanCounters, admitted: 1, saved: 1 }, failureStreak: 0,
	unit: null, retry: null, bufferedReferences: 2, exhausted: false, outcomes: [scanOutcome], outcomeRetention: 20,
};
const scanResult = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, command: "continue", commandId: "cmd-00000001",
	replayed: false, decision: "continue", progress: "outcome", outcome: scanOutcome, scan: scanView,
};
const scanCommand = { command: "continue" as const, commandId: "cmd-00000001" };
assert.equal(parseSeoAdminScoreScanResult(scanResult, scanCommand).success, true);
assert.equal(parseSeoAdminScoreScanResult({ ...scanResult, replayed: true, decision: "completed" }, scanCommand).success, true,
	"a replay returns its recorded decision with the current state");
const dashedSavedOutcome = { ...scanOutcome, score: null };
const dashedReusedOutcome = { ...scanOutcome, status: "reused", history: "not-attempted", score: null };
assert.equal(parseSeoAdminScoreScanResult({ ...scanResult, outcome: dashedSavedOutcome, scan: { ...scanView, outcomes: [dashedSavedOutcome] } }, scanCommand).success, true,
	"a saved outcome whose shared display shows a dash carries a null score");
assert.equal(parseSeoAdminScoreScanResult({ ...scanResult, outcome: dashedReusedOutcome, scan: { ...scanView, outcomes: [dashedReusedOutcome] } }, scanCommand).success, true,
	"a reused outcome whose shared display shows a dash carries a null score");
assert.equal(parseSeoAdminScoreScanStateResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, checkedAt: "2026-10-04T10:00:02.000Z", scan: { ...scanView, outcomes: [dashedSavedOutcome, dashedReusedOutcome] } }).success, true,
	"retained dashed outcomes stay readable in the scan state");
assert.equal(parseSeoAdminScoreScanResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: false, command: "continue", commandId: "cmd-00000001", error: "uncertain", detail: "Resume recovers it.", scan: scanView }, scanCommand).success, false);
assert.equal(parseSeoAdminScoreScanStateResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, checkedAt: "2026-10-04T10:00:02.000Z", scan: null }).success, true);
assert.equal(parseSeoAdminScoreScanStateResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: false, error: "scan_unavailable" }).success, false);
for (const [name, value, expected] of [
	["another command's answer", scanResult, { command: "continue", commandId: "cmd-00000009" }],
	["a fresh decision that contradicts the state", { ...scanResult, decision: "completed" }, scanCommand],
	["a reused outcome claiming history", { ...scanResult, outcome: { ...scanOutcome, status: "reused", history: "created" } }, scanCommand],
	["a refused outcome carrying a score", { ...scanResult, outcome: { ...scanOutcome, status: "failed", history: "not-attempted" } }, scanCommand],
	["a skipped outcome carrying a score", { ...scanResult, outcome: { ...scanOutcome, status: "skipped", history: "not-attempted", score: 0 } }, scanCommand],
	["a saved outcome with a fractional score", { ...scanResult, outcome: { ...scanOutcome, score: 80.5 } }, scanCommand],
	["a paused state without a reason", { ...scanResult, decision: "paused", scan: { ...scanView, state: "paused" } }, scanCommand],
	["a percentage-like count", { ...scanResult, scan: { ...scanView, target: { mode: "count", count: 100_001 } } }, scanCommand],
	["an unknown failure", { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: false, command: "continue", commandId: "cmd-00000001", error: "saved", detail: null, scan: null }, scanCommand],
] as const) assert.throws(() => parseSeoAdminScoreScanResult(value, expected), /scoreScan|contract version/i, name);
assert.equal(parseSeoAdminScoreScanTaxonomiesResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, collection: "posts", taxonomies: [{ name: "category", label: "Categories", hierarchical: true }] }, "posts").success, true);
assert.throws(() => parseSeoAdminScoreScanTaxonomiesResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, collection: "pages", taxonomies: [] }, "posts"), /scoreScan\.taxonomies/);
const termsRequest = { collection: "posts", taxonomy: "category" };
assert.equal(parseSeoAdminScoreScanTermsResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, ...termsRequest, terms: [{ id: "t1", translationGroup: "g1", label: "News", locale: "en" }], nextCursor: "x".repeat(2_048) }, termsRequest).success, true);
assert.equal(parseSeoAdminScoreScanTermsResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: false, ...termsRequest, error: "invalid_selection", detail: "Taxonomy \"category\" is not attached." }, termsRequest).success, false);
for (const [name, value] of [
	["more than one page", { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, ...termsRequest, terms: Array.from({ length: 51 }, (_, index) => ({ id: `t${index}`, translationGroup: "g", label: "L", locale: "en" })), nextCursor: null }],
	["an oversized cursor", { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, ...termsRequest, terms: [], nextCursor: "x".repeat(2_049) }],
	["another taxonomy", { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, collection: "posts", taxonomy: "tag", terms: [], nextCursor: null }],
] as const) assert.throws(() => parseSeoAdminScoreScanTermsResult(value, termsRequest), /scoreScan\.terms/, name);


const profileResult = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, collection: "posts",
	selection: { state: "configured", collection: "posts", profile: "article", version: 1, revision: "profile-r1" },
};
assert.equal(parseSeoCollectionAnalysisProfileResult(profileResult, "posts").selection.state, "configured");
assert.throws(() => parseSeoCollectionAnalysisProfileResult(profileResult, "pages"), /collectionAnalysisProfile.metadata/);
assert.throws(() => parseSeoCollectionAnalysisProfileResult({ ...profileResult,
	selection: { ...profileResult.selection, profile: "auto" } }, "posts"), /collectionAnalysisProfile.configured/);
assert.throws(() => parseSeoCollectionAnalysisProfileSaveResult({ ...profileResult, success: true,
	selection: { state: "unconfigured", collection: "posts", revision: null } }, "posts"), /collectionAnalysisProfile.saved/);
assert.equal(parseSeoCollectionAnalysisProfileSaveResult({ contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION, success: false, error: "conflict", conflict: true }, "posts").success, false);
for (const contentScoring of [
	{ ...settingsFixture.contentScoring, state: "enabled" },
	{ ...settingsFixture.contentScoring, state: "paused" },
	{ ...settingsFixture.contentScoring, revision: "other" },
	{ ...settingsFixture.contentScoring, currentNoticeVersion: 2 },
]) assert.throws(() => parseSeoAdminSettings({ ...settingsFixture, contentScoring }), /settings.contentScoring/);
for (const mutation of [
	{ assessmentProfile: undefined }, { assessmentProfileRevision: undefined }, { calculation: undefined }, { coverage: undefined },
	{ calculation: { ...contentScoreFixture.items[0].calculation, score: 99 } },
	{ coverage: { ...contentScoreFixture.items[0].coverage, measured: 1 } },
]) assert.throws(() => parseSeoAdminContentScores({ ...contentScoreFixture,
	items: [{ ...contentScoreFixture.items[0], ...mutation }] }), /contentScores.items/);
assert.equal(parseSeoAdminContentScores({ ...contentScoreFixture, items: [{ ...contentScoreFixture.items[0],
	scoreVersion: SEO_SCORE_VERSION - 1, freshness: "stale", assessmentProfile: undefined,
	assessmentProfileRevision: undefined, calculation: undefined, coverage: undefined }] }).items.length, 1,
	"older records remain readable without inventing new evidence");

console.log("SEO admin contract self-check passed.");
