import assert from "node:assert/strict";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_SCORE_VERSION,
	classifySeoContentCheck,
	seoAnalysisPresentation,
	seoScoreDisplay,
	summarizeSeoChecks,
	type SeoAdminContentScore,
	type SeoAdminEntryPreview,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { analyzeSeoContent, type SeoAnalysisInput } from "../analysis.ts";
import { seoCheckTotalsText } from "../check-presentation.ts";

import {
	buildSavedSearchPreviewModel,
	buildSavedSocialPreviewModel,
	buildSeoSnippetApplyPlan,
	resolveSeoSocialImagePreview,
	seoSnippetDialogPrimaryAction,
	seoSocialImageChange,
	changedHostSnippetFields,
	executeSeoSnippetApplyPlan,
	buildSeoWorkQueue,
	currentSeoWorkQueueScores,
	buildSeoAdminSearch,
	createCancellableDebounce,
	entryRef,
	evaluatedCheckCount,
	checkEvidenceBasis,
	manualCheckCount,
	searchExclusionCheck,
	hasCurrentEditorAnalysis,
	selectEditorScore,
	analysisStatusLabel,
	analysisPresentation,
	analysisSummary,
	analysisTone,
	gradeLabel,
	groupContentChecks,
	contentCheckPresentation,
	checkActionVerb,
	keywordCheckCoverage,
	indexContentScores,
	normalizeSeoSnippetDraft,
	parseEntryRef,
	parseSeoAdminLocation,
	passingCheckCount,
	priorityCheckCount,
	resolveCheckFixTarget,
	resolveSeoDraftIndexability,
	resolveSeoLiveSearchPreview,
	resolveSeoLiveSocialPreview,
	isDevelopmentHostname,
	resolveSeoPreviewUrl,
	scoredCheckCount,
	scoreBadgeVariant,
	scorePresentationBadgeText,
	searchPreviewValuesMatch,
	seoKeywordCoverage,
	seoWorkQueueEmptyState,
	seoWorkQueueScoreCoverage,
	selectPriorityChecks,
	summarizeSeoWorkQueue,
	localeGraphDiagnosticLabel,
	validateSeoCanonicalDraft,
	validateSeoSlugDraft,
	type SeoContentCheck,
	readAfterMountConfirmed,
	retainEntryPreview,
	DIALOG_TABBABLE_SELECTOR,
	dialogTabWrapTarget,
} from "./content-extension-model.ts";
import {
	editorScoreStateCopy,
	editorManualAnalysisState,
	isPermissionDenied,
	resolveSeoOwnershipNotice,
	savedAnalysisNotice,
	savedAnalysisRequestFailureNotice,
	seoOwnershipFieldViews,
	seoOwnershipSummary,
	storedScoreSummary,
	type SeoOwnershipObservation,
	type SeoOwnershipRetention,
} from "./content-extension-model.ts";

const score = {
	ref: "posts:entry-1",
	collection: "posts",
	entryId: "entry-1",
	slug: "example",
	title: "Example article",
	score: 58,
	scoreVersion: SEO_SCORE_VERSION - 1,
	grade: "needs-work",
	updatedAt: "2026-07-15T10:00:00.000Z",
	checks: [
		{
			id: "pass",
			label: "Passing",
			status: "pass",
			severity: "critical",
			weight: 20,
		},
		{
			id: "review-low",
			label: "Low review",
			status: "review",
			severity: "low",
			weight: 4,
		},
		{
			id: "fail-medium",
			label: "Medium failure",
			status: "fail",
			severity: "medium",
			weight: 5,
		},
		{
			id: "review-high",
			label: "High review",
			status: "review",
			severity: "high",
			weight: 12,
		},
		{
			id: "informational",
			label: "Informational",
			status: "review",
			severity: "info",
			weight: 0,
		},
	],
} as SeoAdminContentScore;

for (const [tone, variant] of [
	["good", "success"], ["review", "warning"], ["poor", "error"], ["neutral", "secondary"],
] as const) {
	assert.equal(scoreBadgeVariant({ tone }), variant);
}
assert.equal(scoreBadgeVariant(null), "secondary");
assert.equal(gradeLabel(score.grade), "Needs improvement");
for (const [grade, label] of [
	["excellent", "Good"],
	["good", "Good"],
	["needs-work", "Needs improvement"],
	["poor", "Poor"],
] as const) {
	assert.equal(gradeLabel(grade), label);
}
assert.equal(analysisTone(score), "neutral", "legacy checks never enter the current classifier");
assert.equal(analysisStatusLabel(score), "Earlier analyzer");
assert.equal(analysisSummary(score), "Earlier analyzer. Analyze again.");
assert.equal(evaluatedCheckCount(score), 0);
assert.equal(entryRef("pages", "home"), "pages:home");
assert.deepEqual(parseEntryRef("posts:entry:with-colon"), {
	collection: "posts",
	entryId: "entry:with-colon",
});
assert.equal(parseEntryRef("invalid"), null);
assert.deepEqual(parseSeoAdminLocation("?view=content&ref=posts%3Aentry-1"), {
	view: "content",
	ref: "posts:entry-1",
	queueScope: "all",
});
assert.deepEqual(parseSeoAdminLocation("?view=unknown&ref=posts%3Aentry-1"), {
	view: "overview",
	ref: null,
	queueScope: "all",
});
assert.equal(
	buildSeoAdminSearch("?utm_source=admin", "content", "posts:entry-1"),
	"?utm_source=admin&view=content&ref=posts%3Aentry-1",
);
assert.equal(
	buildSeoAdminSearch("?view=content&ref=posts%3Aentry-1", "schema"),
	"?view=schema",
);
assert.deepEqual(parseSeoAdminLocation("?view=queue&ref=posts%3Aentry-1"), {
	view: "queue",
	ref: null,
	queueScope: "all",
});
assert.deepEqual(parseSeoAdminLocation("?view=queue&scope=images"), {
	view: "queue",
	ref: null,
	queueScope: "images",
});
assert.equal(
	buildSeoAdminSearch("?view=queue", "queue", null, "images"),
	"?view=queue&scope=images",
);
assert.equal(
	buildSeoAdminSearch("?view=queue&scope=images", "overview"),
	"?view=overview",
);
assert.deepEqual(parseSeoAdminLocation("?view=crawl&ref=posts%3Aentry-1"), {
	view: "crawl",
	ref: null,
	queueScope: "all",
});
assert.equal(
	buildSeoAdminSearch("?view=content&ref=posts%3Aentry-1", "crawl"),
	"?view=crawl",
);
for (const view of ["site", "identity", "indexing"] as const) {
	const search = buildSeoAdminSearch("?keep=1&view=content&ref=posts%3Aentry-1&scope=images", view);
	assert.equal(search, `?keep=1&view=${view}`);
	assert.deepEqual(parseSeoAdminLocation(search), { view, ref: null, queueScope: "all" },
		"General settings, Local SEO and Indexing retain distinct canonical destinations");
}

const savedPreview = {
	content: {
		ref: "posts:entry-1",
		title: "Saved content title",
		slug: "saved-slug",
	},
	search: {
		title: "Saved SEO title",
		description: "Saved meta description",
		fallbackTitle: "Template title fallback",
		fallbackDescription: "Template description fallback",
	},
} as SeoAdminEntryPreview;

const resolvedPreview = {
	...savedPreview,
	search: { ...savedPreview.search, url: "https://canonical.example:8443/section/a%2Fb?keep=%2F#part" },
	social: {
		title: "Independent social title",
		description: "Independent social description",
		image: "/media/a%20b.png?keep=%2F",
		fallbackTitle: "Resolved social title fallback",
		fallbackDescription: "Resolved social description fallback",
		override: { title: null, description: null, updatedAt: null },
	},
	sources: {
		title: "legacy-override", description: "template", socialTitle: "core-seo",
		socialDescription: "template", canonical: "core-seo", image: "content",
	},
} as SeoAdminEntryPreview;
const resolvedPreviewBefore = JSON.stringify(resolvedPreview);
for (const device of ["desktop", "mobile"] as const) {
	const model = buildSavedSearchPreviewModel(resolvedPreview, device, "12 Oct 2026 - ");
	assert.deepEqual(model.title, { value: resolvedPreview.search.title, source: "legacy-override", state: "saved" });
	assert.deepEqual(model.description, { value: resolvedPreview.search.description, source: "template", state: "saved" });
	assert.deepEqual(model.canonical, { value: resolvedPreview.search.url, source: "core-seo", state: "saved" });
	assert.equal(model.displayUrl, resolvedPreview.search.url);
	assert.equal(model.permalink.state, "unavailable");
	assert.equal(model.permalink.value, null);
	assert.equal(model.isDraft, false);
	assert.ok(model.fittedDescription.lines.join(" ").startsWith("12 Oct 2026 - "));
}
for (const url of [
	"https://external.example/other/path/?query=a%2Fb#section",
	"https://example.com/base/collection/item/extra",
	"/relative/path?query=1",
	"",
]) {
	const preview = { ...resolvedPreview, search: { ...resolvedPreview.search, url } };
	assert.equal(buildSavedSearchPreviewModel(preview, "desktop").canonical.value, url);
	assert.equal(buildSavedSocialPreviewModel(preview, "facebook").fields.url.value, url);
	assert.equal(buildSavedSearchPreviewModel(preview, "desktop").permalink.state, "unavailable");
}
const generatedPreview = {
	...resolvedPreview,
	sources: { ...resolvedPreview.sources, canonical: "generated" as const },
};
assert.deepEqual(buildSavedSearchPreviewModel(generatedPreview, "desktop").permalink, {
	value: generatedPreview.search.url, source: "generated", state: "saved",
});
assert.equal(buildSavedSearchPreviewModel({
	...generatedPreview, search: { ...generatedPreview.search, url: "" },
}, "desktop").permalink.state, "unavailable");
for (const source of ["core-seo", "template", "legacy-override"] as const) {
	const preview = { ...resolvedPreview, sources: {
		...resolvedPreview.sources, title: source, description: source, socialTitle: source, socialDescription: source,
	} };
	const searchModel = buildSavedSearchPreviewModel(preview, "desktop");
	assert.deepEqual(searchModel.title, { value: preview.search.title, source, state: "saved" });
	assert.deepEqual(searchModel.description, { value: preview.search.description, source, state: "saved" });
	const model = buildSavedSocialPreviewModel(preview, "facebook", { enabled: false });
	assert.deepEqual(model.fields.title, { value: preview.social.title, source, state: "saved" });
	assert.deepEqual(model.fields.description, { value: preview.social.description, source, state: "saved" });
	assert.equal(model.isDraft, false, "disabled customization without saved plugin overrides does not change resolved values");
}
const savedSocial = buildSavedSocialPreviewModel(resolvedPreview, "facebook");
const changedOwner = buildSavedSocialPreviewModel(resolvedPreview, "facebook", {
	enabled: true, title: resolvedPreview.social.title,
});
assert.equal(changedOwner.fields.title.value, savedSocial.fields.title.value);
assert.equal(changedOwner.fields.title.source, "plugin-social-override");
assert.equal(changedOwner.fields.title.state, "draft", "an equal value with a new owner is still an explicit override change");
assert.deepEqual(changedOwner.fields.description, savedSocial.fields.description);
const ownedPreview = {
	...resolvedPreview,
	social: {
		...resolvedPreview.social, title: "Saved plugin title", description: "Saved plugin description",
		override: { title: "Saved plugin title", description: "Saved plugin description", updatedAt: "2026-10-03T12:00:00.000Z" },
	},
	sources: { ...resolvedPreview.sources, socialTitle: "plugin-social-override" as const, socialDescription: "plugin-social-override" as const },
};
const unchangedOwned = buildSavedSocialPreviewModel(ownedPreview, "facebook", {
	enabled: true, title: "  Saved plugin title  ", description: " Saved plugin description ",
});
assert.equal(unchangedOwned.isDraft, false, "comparison uses the same normalized values as social persistence");
assert.equal(unchangedOwned.fields.title.state, "saved");
assert.equal(unchangedOwned.fields.description.state, "saved");
const equivalentWhitespace = buildSavedSocialPreviewModel({
	...ownedPreview,
	social: {
		...ownedPreview.social,
		override: { ...ownedPreview.social.override, title: "Saved  plugin\ntitle" },
	},
}, "facebook", {
	enabled: true,
	title: " Saved\tplugin title ",
	description: "Saved  plugin\ndescription",
});
assert.equal(equivalentWhitespace.isDraft, false, "equivalent repeated whitespace stays saved");
assert.deepEqual(equivalentWhitespace.fields, unchangedOwned.fields);
for (const field of ["title", "description"] as const) {
	const otherField = field === "title" ? "description" : "title";
	const changed = buildSavedSocialPreviewModel(ownedPreview, "x", { enabled: true, [field]: " New owned value " });
	assert.deepEqual(changed.fields[field], { value: "New owned value", source: "plugin-social-override", state: "draft" });
	assert.deepEqual(changed.fields[otherField], unchangedOwned.fields[otherField], "an omitted owned field stays saved");
	const cleared = buildSavedSocialPreviewModel(ownedPreview, "x", { enabled: true, [field]: null });
	assert.deepEqual(cleared.fields[field], {
		value: field === "title" ? ownedPreview.social.fallbackTitle : ownedPreview.social.fallbackDescription,
		source: "Saved social fallback (source not reported)", state: "draft",
	});
	assert.deepEqual(cleared.fields[otherField], unchangedOwned.fields[otherField]);
	assert.deepEqual(cleared.fields.image, savedSocial.fields.image);
	assert.deepEqual(cleared.fields.url, savedSocial.fields.url);
}
const clearBoth = buildSavedSocialPreviewModel(ownedPreview, "facebook", { enabled: false });
assert.equal(clearBoth.fields.title.state, "draft");
assert.equal(clearBoth.fields.description.state, "draft");
const canonicalCreationOverAlias = buildSavedSocialPreviewModel(ownedPreview, "facebook", {
	enabled: true, title: "New canonical title", description: "",
});
assert.equal(canonicalCreationOverAlias.fields.title.value, "New canonical title");
assert.equal(canonicalCreationOverAlias.fields.description.value, ownedPreview.social.fallbackDescription,
	"creating a canonical record with a blank description shadows the alias and uses the saved fallback");
const blankFallback = buildSavedSocialPreviewModel({
	...ownedPreview, social: { ...ownedPreview.social, fallbackTitle: "" },
}, "facebook", { enabled: true, title: "" });
assert.equal(blankFallback.fields.title.value, "", "an empty resolved fallback is retained without a search-title guess");
assert.equal(blankFallback.fields.title.state, "draft");
const incidentalDraft = { enabled: true, isDirty: true, slug: "another-slug", image: "/pending.png" };
assert.deepEqual(buildSavedSocialPreviewModel(resolvedPreview, "x", incidentalDraft).fields, savedSocial.fields);
assert.equal(buildSavedSocialPreviewModel(resolvedPreview, "x", incidentalDraft).isDraft, false);
assert.equal(savedSocial.imageState, "available");
assert.deepEqual(savedSocial.fields.image, { value: resolvedPreview.social.image, source: "content", state: "saved" });
assert.equal(buildSavedSocialPreviewModel({
	...resolvedPreview, social: { ...resolvedPreview.social, image: null },
}, "facebook").imageState, "missing");
const anotherEntry = {
	...resolvedPreview, content: { ...resolvedPreview.content, ref: "pages:another-entry", slug: "another-slug" },
	search: { ...resolvedPreview.search, title: "Other saved title", url: "https://example.com/other" },
	social: { ...resolvedPreview.social, title: "Other saved social title" },
};
assert.equal(buildSavedSocialPreviewModel(anotherEntry, "facebook").fields.title.value, "Other saved social title");
assert.equal(buildSavedSocialPreviewModel(resolvedPreview, "facebook").isDraft, false);
assert.equal(buildSavedSearchPreviewModel(anotherEntry, "mobile").title.value, "Other saved title");
assert.equal(buildSavedSearchPreviewModel(resolvedPreview, "desktop").title.value, resolvedPreview.search.title);
assert.equal(JSON.stringify(resolvedPreview), resolvedPreviewBefore, "building adapters does not mutate the saved response");

const indexabilityPreview = {
	indexable: true,
	entryNoindex: false,
} as SeoAdminEntryPreview;

assert.deepEqual(resolveSeoDraftIndexability(indexabilityPreview), {
	entryIndexable: true,
	effectiveIndexable: true,
	pending: false,
});
assert.deepEqual(
	resolveSeoDraftIndexability(indexabilityPreview, {
		seo: { noIndex: true },
		isDirty: true,
	}),
	{
		entryIndexable: false,
		effectiveIndexable: false,
		pending: true,
	},
);
assert.deepEqual(
	resolveSeoDraftIndexability(
		{
			indexable: false,
			entryNoindex: true,
		} as SeoAdminEntryPreview,
		{ seo: { noIndex: false }, isDirty: true },
	),
	{
		entryIndexable: true,
		effectiveIndexable: false,
		pending: true,
	},
);
const uncheckedLocaleGraph: SeoAdminEntryPreview["localeGraph"] = {
	owner: "emdash-core",
	emitsMarkup: false,
	status: "incomplete",
	hostSupportsTranslationGroups: false,
	currentLocale: "en",
	defaultLocale: "en",
	translationGroup: null,
	discoveredLocales: ["en"],
	alternates: [],
	xDefaultLocale: null,
	issues: [{
		code: "translation-context-unavailable",
		severity: "info",
		message: "Translation groups are not checked in this entry preview.",
		locale: null,
	}],
};
const uncheckedLocaleSnapshot = JSON.stringify(uncheckedLocaleGraph);
assert.equal(localeGraphDiagnosticLabel(uncheckedLocaleGraph), "Not checked in this preview",
	"the entry-only informational payload does not claim a translation problem");
assert.equal(localeGraphDiagnosticLabel({
	...uncheckedLocaleGraph,
	issues: [...uncheckedLocaleGraph.issues, { ...uncheckedLocaleGraph.issues[0]!, locale: "nl" }],
}), "Not checked in this preview", "multiple informational unavailable contexts remain unchecked");
for (const issue of [
	{ code: "duplicate-locale", severity: "error", message: "Two published entries use en.", locale: "en" },
	{ code: "current-locale-missing", severity: "warning", message: "The entry has no locale.", locale: null },
	{ code: "translation-context-unavailable", severity: "warning", message: "The host lookup failed.", locale: null },
] as const) {
	assert.equal(localeGraphDiagnosticLabel({ ...uncheckedLocaleGraph, issues: [issue] }), "Translation set needs review",
		`a real ${issue.code} ${issue.severity} remains a review`);
	assert.equal(localeGraphDiagnosticLabel({ ...uncheckedLocaleGraph, issues: [...uncheckedLocaleGraph.issues, issue] }),
		"Translation set needs review", "an informational issue cannot hide a concurrent warning or error");
}
assert.equal(localeGraphDiagnosticLabel({ ...uncheckedLocaleGraph, issues: [] }), "Translation set needs review",
	"incomplete without a known informational explanation remains a review");
assert.equal(localeGraphDiagnosticLabel({
	...uncheckedLocaleGraph,
	issues: [{ code: "current-entry-excluded", severity: "info", message: "The entry is excluded.", locale: "en" }],
}), "Translation set needs review", "unrelated informational issues do not claim the graph was deliberately unchecked");
for (const [status, label] of [
	["single-locale", "Single-language entry"],
	["complete", "Translation set complete"],
	["not-indexable", "Excluded from hreflang"],
	["host-upgrade-required", "Host update required"],
] as const) {
	assert.equal(localeGraphDiagnosticLabel({ ...uncheckedLocaleGraph, status, issues: [] }), label,
		`${status} keeps its existing label`);
}
assert.equal(JSON.stringify(uncheckedLocaleGraph), uncheckedLocaleSnapshot,
	"presentation never changes the server's graph, issues or output state");

assert.deepEqual(validateSeoCanonicalDraft(""), {
	valid: true,
	value: "",
	message: null,
});
assert.deepEqual(validateSeoCanonicalDraft("https://example.com/article"), {
	valid: true,
	value: "https://example.com/article",
	message: null,
});
assert.equal(validateSeoCanonicalDraft("example.com/article").valid, false);
assert.equal(validateSeoCanonicalDraft("ftp://example.com/article").valid, false);
assert.equal(
	validateSeoCanonicalDraft("https://example.com/article?preview=1").message,
	"Remove query parameters and fragments from the canonical URL.",
);
assert.deepEqual(
	resolveSeoDraftIndexability(
		{
			indexable: false,
			entryNoindex: false,
		} as SeoAdminEntryPreview,
		{ seo: { noIndex: false }, isDirty: true },
	),
	{
		entryIndexable: true,
		effectiveIndexable: false,
		pending: false,
	},
);

assert.deepEqual(resolveSeoLiveSearchPreview(savedPreview), {
	title: "Saved SEO title",
	slug: "saved-slug",
	description: "Saved meta description",
	isDirty: false,
});
assert.deepEqual(
	buildSeoSnippetApplyPlan(
		{
			title: "Saved SEO title",
			slug: "saved-slug",
			description: "Saved meta description",
		},
		{
			title: "Saved SEO title",
			slug: "saved-slug",
			description: "Saved meta description",
		},
	),
	{ seo: null, slug: null, changedFields: [] },
);
assert.deepEqual(
	buildSeoSnippetApplyPlan(
		{
			title: "Saved SEO title",
			slug: "saved-slug",
			description: "Saved meta description",
		},
		{
			title: "Updated SEO title",
			slug: "updated-slug",
			description: "Updated meta description",
		},
	),
	{
		seo: {
			title: "Updated SEO title",
			description: "Updated meta description",
		},
		slug: "updated-slug",
		changedFields: ["title", "slug", "description"],
	},
);
assert.deepEqual(
	normalizeSeoSnippetDraft({
		title: "  Updated SEO title  ",
		slug: "  updated-slug  ",
		description: "  Updated meta description  ",
	}),
	{
		title: "Updated SEO title",
		slug: "updated-slug",
		description: "Updated meta description",
	},
);
assert.deepEqual(
	changedHostSnippetFields(
		{ title: "Original", slug: "original", description: "Original description" },
		{ title: "Other editor value", slug: "other-slug", description: "Original description" },
		["title", "description"],
	),
	["title"],
	"an unrelated host slug edit must not block a metadata-only patch",
);
assert.deepEqual(
	changedHostSnippetFields(
		{ title: "Original", slug: "original", description: "Original description" },
		{ title: "Other editor value", slug: "other-slug", description: "Original description" },
		["title", "slug"],
	),
	["title", "slug"],
	"a host edit to fields being applied must stop a stale dialog write",
);
assert.deepEqual(
	buildSeoSnippetApplyPlan(
		{
			title: "Saved SEO title",
			slug: "saved-slug",
			description: "Saved meta description",
		},
		{
			title: "  Saved SEO title  ",
			slug: "  saved-slug  ",
			description: "  Saved meta description  ",
		},
	),
	{ seo: null, slug: null, changedFields: [] },
);
assert.deepEqual(
	buildSeoSnippetApplyPlan(
		{
			title: "Saved SEO title",
			slug: "saved-slug",
			description: "Saved meta description",
		},
		{
			title: "   ",
			slug: "  updated-slug  ",
			description: "   ",
		},
	),
	{
		seo: { title: null, description: null },
		slug: "updated-slug",
		changedFields: ["title", "slug", "description"],
	},
);
assert.deepEqual(validateSeoSlugDraft("   "), {
	valid: false,
	value: "",
	message: "Enter a slug before applying this snippet.",
});
assert.deepEqual(validateSeoSlugDraft("  article-slug  "), {
	valid: true,
	value: "article-slug",
	message: null,
});

const coordinatedPlan = buildSeoSnippetApplyPlan(
	{
		title: "Saved SEO title",
		slug: "saved-slug",
		description: "Saved meta description",
	},
	{
		title: "Updated SEO title",
		slug: "updated-slug",
		description: "Updated meta description",
	},
);
const coordinatedRollback = buildSeoSnippetApplyPlan(
	{
		title: "Updated SEO title",
		slug: "updated-slug",
		description: "Updated meta description",
	},
	{
		title: "Saved SEO title",
		slug: "saved-slug",
		description: "Saved meta description",
	},
);
const applyCalls: string[] = [];
assert.deepEqual(
	await executeSeoSnippetApplyPlan(coordinatedPlan, coordinatedRollback, {
		applySeo: () => {
			applyCalls.push("apply-seo");
		},
		rollbackSeo: () => {
			applyCalls.push("rollback-seo");
		},
		applySlug: () => {
			applyCalls.push("apply-slug");
		},
		rollbackSlug: () => {
			applyCalls.push("rollback-slug");
		},
	}),
	{ success: true, failedStep: null, rollbackFailed: false },
);
assert.deepEqual(applyCalls, ["apply-seo", "apply-slug"]);

const rollbackCalls: string[] = [];
assert.deepEqual(
	await executeSeoSnippetApplyPlan(coordinatedPlan, coordinatedRollback, {
		applySeo: () => {
			rollbackCalls.push("apply-seo");
		},
		rollbackSeo: () => {
			rollbackCalls.push("rollback-seo");
		},
		applySlug: () => {
			rollbackCalls.push("apply-slug");
			throw new Error("slug rejected");
		},
		rollbackSlug: () => {
			rollbackCalls.push("rollback-slug");
		},
	}),
	{ success: false, failedStep: "slug", rollbackFailed: false },
);
assert.deepEqual(rollbackCalls, [
	"apply-seo",
	"apply-slug",
	"rollback-slug",
	"rollback-seo",
]);

assert.deepEqual(
	await executeSeoSnippetApplyPlan(coordinatedPlan, coordinatedRollback, {
		applySeo: () => {
			throw new Error("seo rejected");
		},
		rollbackSeo: () => {
			throw new Error("seo rollback rejected");
		},
		applySlug: () => undefined,
		rollbackSlug: () => undefined,
	}),
	{ success: false, failedStep: "seo", rollbackFailed: true },
);
assert.deepEqual(
	buildSeoSnippetApplyPlan(
		{
			title: "Saved SEO title",
			slug: "saved-slug",
			description: "Saved meta description",
		},
		{
			title: "",
			slug: "saved-slug",
			description: "",
		},
	),
	{
		seo: { title: null, description: null },
		slug: null,
		changedFields: ["title", "description"],
	},
);
assert.deepEqual(
	resolveSeoLiveSearchPreview(savedPreview, {
		data: {
			title: "Live content title",
			excerpt: "Live excerpt",
		},
		slug: "live-slug",
		isDirty: true,
	}),
	{
		title: "Live content title",
		slug: "live-slug",
		description: "Live excerpt",
		isDirty: true,
	},
);
assert.deepEqual(
	resolveSeoLiveSearchPreview(savedPreview, {
		seo: { title: null, description: null },
	}),
	{
		title: "Template title fallback",
		slug: "saved-slug",
		description: "Template description fallback",
		isDirty: false,
	},
	"clearing core SEO overrides must preview the resolved template/content fallback, not the old override",
);
assert.deepEqual(
	resolveSeoLiveSearchPreview(savedPreview, {
		data: {
			title: "Live content title",
			excerpt: "Live excerpt",
		},
		slug: "live-slug",
		seo: {
			title: "Live SEO title",
			description: "Live SEO description",
		},
	}),
	{
		title: "Live SEO title",
		slug: "live-slug",
		description: "Live SEO description",
		isDirty: false,
	},
);
assert.deepEqual(
	resolveSeoLiveSearchPreview(savedPreview, {
		data: {
			title: "Fallback content title",
			excerpt: "Fallback excerpt",
		},
		seo: {
			title: "   ",
			description: null,
		},
	}),
	{
		title: "Fallback content title",
		slug: "saved-slug",
		description: "Fallback excerpt",
		isDirty: false,
	},
);
assert.deepEqual(
	seoKeywordCoverage("topical authority", {
		title: "Building topical authority that AI engines trust",
		description: "A practical topical authority framework.",
		slug: "topical-authority-ai-trust",
	}),
	{
		tone: "good",
		label: "Preview text coverage: 3/3 fields",
		matches: ["title", "description", "slug"],
	},
);
assert.deepEqual(
	seoKeywordCoverage("search intent", {
		title: "Search intent mapping",
		description: "A practical content framework.",
		slug: "content-framework",
	}),
	{
		tone: "review",
		label: "Preview text coverage: 1/3 fields",
		matches: ["title"],
	},
);
assert.deepEqual(
	seoKeywordCoverage("technical seo", {
		title: "Content authority",
		description: "A practical framework.",
		slug: "content-authority",
	}),
	{
		tone: "poor",
		label: "Preview text coverage: 0/3 fields",
		matches: [],
	},
);

const socialPreview = {
	content: {
		ref: "posts:entry-1",
		slug: "saved-slug",
	},
	search: {
		title: "Saved search title",
		description: "Saved search description",
	},
	social: {
		fallbackTitle: "Saved social fallback title",
		fallbackDescription: "Saved social fallback description",
	},
} as SeoAdminEntryPreview;

assert.deepEqual(resolveSeoLiveSocialPreview(socialPreview), {
	title: "Saved social fallback title",
	slug: "saved-slug",
	description: "Saved social fallback description",
	isDirty: false,
});
assert.deepEqual(
	resolveSeoLiveSocialPreview(socialPreview, {
		title: "Saved search title",
		slug: "saved-slug",
		description: "Saved search description",
		isDirty: false,
	}),
	{
		title: "Saved social fallback title",
		slug: "saved-slug",
		description: "Saved social fallback description",
		isDirty: false,
	},
);
const liveSearchPreview = {
	title: "Live search title",
	slug: "live-search-slug",
	description: "Live search description",
	isDirty: true,
};
assert.deepEqual(
	resolveSeoLiveSocialPreview(socialPreview, liveSearchPreview),
	{
		title: "Live search title",
		slug: "live-search-slug",
		description: "Live search description",
		isDirty: true,
	},
);
assert.deepEqual(
	resolveSeoLiveSocialPreview(socialPreview, liveSearchPreview, {
		enabled: true,
		title: "Social-only title",
		description: "  ",
	}),
	{
		title: "Social-only title",
		slug: "live-search-slug",
		description: "Live search description",
		isDirty: true,
	},
);
assert.deepEqual(
	resolveSeoLiveSocialPreview(socialPreview, liveSearchPreview, {
		enabled: false,
		title: "Ignored social title",
		description: "Ignored social description",
	}),
	{
		title: "Live search title",
		slug: "live-search-slug",
		description: "Live search description",
		isDirty: true,
	},
);

const index = indexContentScores([score]);
assert.equal(index.get("posts:entry-1"), score);
assert.equal(index.get("posts:example"), score);
assert.equal(priorityCheckCount(score), 0);
assert.equal(passingCheckCount(score), 0);
assert.equal(scoredCheckCount(score), 0);
assert.deepEqual(selectPriorityChecks(score, 2), []);
assert.deepEqual(selectPriorityChecks(score, 0), []);
assert.deepEqual(
	groupContentChecks(score).map((group) => ({
		id: group.id,
		checks: group.checks.map((check) => check.id),
		issues: group.issueCount,
	})),
	[
		{
			id: "additional",
			checks: [
				"pass",
				"review-low",
				"fail-medium",
				"review-high",
				"informational",
			],
			issues: 0,
		},
	],
);

const queue = buildSeoWorkQueue([score]);
assert.deepEqual(
	queue.map((item) => item.check.id),
	[],
);
assert.deepEqual(summarizeSeoWorkQueue(queue), {
	totalIssues: 0,
	affectedContent: 0,
	failing: 0,
	review: 0,
	highPriority: 0,
});
assert.deepEqual(seoWorkQueueEmptyState(3, "current", "all"), {
	title: "No matching issues",
	description: "Adjust the queue filters.",
});
assert.deepEqual(seoWorkQueueEmptyState(0, "none", "all"), {
	title: "No analysis to show",
	description: "Refresh scores for a content type to populate this work queue.",
});
assert.deepEqual(seoWorkQueueEmptyState(0, "none", "images"), {
	title: "No analysis to show",
	description: "Refresh scores for a content type to populate this work queue.",
});
assert.deepEqual(seoWorkQueueEmptyState(0, "current", "all"), {
	title: "Queue is clear",
	description: "No weighted issues were found in the analyzed content.",
});
assert.deepEqual(seoWorkQueueEmptyState(0, "current", "images"), {
	title: "No missing-alt issues found",
	description: "No missing-alt issues were found in the analyzed saved content. Empty-alt intent and image quality still need review.",
});
assert.deepEqual(seoWorkQueueEmptyState(2, "mixed", "images", "disabled"), {
	title: "Image alt checks are off",
	description:
		"Turn on Image alt checks in Feature controls, save, then reanalyze saved content.",
});
assert.deepEqual(seoWorkQueueEmptyState(0, "stale", "images", "loading"), {
	title: "Checking image alt check status",
	description: "The image triage queue will appear when the module status is ready.",
});
assert.deepEqual(seoWorkQueueEmptyState(0, "stale", "images", "unavailable"), {
	title: "Image alt check status unavailable",
	description: "Reload the module status before using image triage.",
});
assert.deepEqual(seoWorkQueueEmptyState(0, "stale", "all"), {
	title: "Analysis is out of date",
	description: "Refresh scores for a content type before using this work queue.",
});
assert.deepEqual(seoWorkQueueEmptyState(0, "mixed", "all"), {
	title: "Analysis is incomplete",
	description:
		"Some stored scores are out of date. Refresh scores before treating this queue as clear.",
});

const imageScore = {
	...analyzeSeoContent({
		ref: "posts:image-entry", collection: "posts", entryId: "image-entry", title: "Image review",
		description: "Saved example description", url: "https://example.com/image-entry", canonicalStatus: "matches",
		body: "Example saved text.", document: [
			{ _type: "image", asset: { _ref: "media:missing" } },
			{ _type: "image", asset: { _ref: "media:empty" }, alt: "" },
		], imageSeoEnabled: true, image: "", noindex: false, assessmentProfile: { profile: "general", version: 1 },
		schemaEnabled: true, schemaPreset: "WebPage",
	}),
	freshness: "current",
} as SeoAdminContentScore;
assert.deepEqual(
	selectPriorityChecks(imageScore, 2).map((check) => check.id),
	["image-alt-text", "social-image"],
	"missing alt fails before the higher-weight social-image review",
);
assert.deepEqual(
	selectPriorityChecks(imageScore, 1).map((check) => check.id),
	["image-alt-text"],
	"the limit keeps only the highest-priority current finding",
);
assert.deepEqual(selectPriorityChecks(imageScore, 0), []);
const currentImageQueue = buildSeoWorkQueue([imageScore]);
assert.deepEqual(currentImageQueue.map((item) => item.check.id), ["image-alt-text", "social-image", "internal-links"],
	"a General entry without links has Internal links Partly met");
assert.deepEqual(summarizeSeoWorkQueue(currentImageQueue), {
	totalIssues: 3,
	affectedContent: 1,
	failing: 1,
	review: 2,
	highPriority: 0,
});
const expectedImageIssues = imageScore.checks.filter((check) => classifySeoContentCheck(check).issue).map((check) => check.id);
assert.deepEqual(
	buildSeoWorkQueue([imageScore]).map((item) => item.check.id).sort(),
	expectedImageIssues.sort(),
	"the general queue keeps its weighted-action contract",
);
assert.deepEqual(
	buildSeoWorkQueue([imageScore], "images").map((item) => item.check.id),
	["image-alt-text"],
	"Image SEO never promotes advisory empty-alt checks into scored issues",
);
assert.deepEqual(
	buildSeoWorkQueue([imageScore], "images", "disabled"),
	[],
	"a disabled Image SEO module suppresses stale image findings",
);
assert.deepEqual(
	buildSeoWorkQueue([imageScore], "all", "disabled").map(
		(item) => item.check.id,
	).sort(),
	expectedImageIssues.sort(),
	"the all-issues queue does not depend on the Image SEO module presentation state",
);
const staleImageScore = {
	...imageScore,
	freshness: "stale",
} as SeoAdminContentScore;
assert.deepEqual(seoWorkQueueScoreCoverage([]), {
	currentScores: [],
	staleCount: 0,
	state: "none",
});
assert.deepEqual(seoWorkQueueScoreCoverage([imageScore]), {
	currentScores: [imageScore],
	staleCount: 0,
	state: "current",
});
assert.deepEqual(seoWorkQueueScoreCoverage([staleImageScore]), {
	currentScores: [],
	staleCount: 1,
	state: "stale",
});
assert.deepEqual(seoWorkQueueScoreCoverage([staleImageScore, imageScore]), {
	currentScores: [imageScore],
	staleCount: 1,
	state: "mixed",
});
assert.deepEqual(
	currentSeoWorkQueueScores([staleImageScore, imageScore]),
	[imageScore],
	"only current-compatible snapshots can populate the work queue",
);
assert.deepEqual(
	buildSeoWorkQueue([staleImageScore]),
	[],
	"the all-issues queue never surfaces stale findings",
);
assert.deepEqual(
	buildSeoWorkQueue([staleImageScore], "images"),
	[],
	"Image SEO never surfaces stale findings",
);

const unweightedTechnicalReview = {
	...imageScore,
	checks: imageScore.checks.filter((check) => check.id === "image-empty-alt-review"),
} as SeoAdminContentScore;
assert.equal(
	priorityCheckCount(unweightedTechnicalReview),
	0,
	"advisories remain outside scored issue counts",
);
assert.deepEqual(
	selectPriorityChecks(unweightedTechnicalReview).map((check) => check.id),
	[],
);
assert.deepEqual(
	buildSeoWorkQueue([unweightedTechnicalReview]).map((item) => item.check.id),
	[],
);

// --- searchPreviewValuesMatch: value equality, not identity ----------------
const previewA = { title: "T", slug: "s", description: "D", isDirty: false };
assert.equal(searchPreviewValuesMatch(previewA, { ...previewA }), true);
assert.equal(searchPreviewValuesMatch(previewA, { ...previewA, title: "X" }), false);
assert.equal(searchPreviewValuesMatch(previewA, { ...previewA, isDirty: true }), false);
assert.equal(searchPreviewValuesMatch(null, null), true);
assert.equal(searchPreviewValuesMatch(previewA, null), false);

// --- createCancellableDebounce: supersede, cancel, flush -------------------
{
	const pending = new Map<number, () => void>();
	let nextHandle = 0;
	const timers = {
		set: (fn: () => void, _ms: number) => {
			nextHandle += 1;
			pending.set(nextHandle, fn);
			return nextHandle;
		},
		clear: (handle: unknown) => {
			pending.delete(handle as number);
		},
	};
	const fired: string[] = [];
	const fireAll = () => {
		for (const [handle, fn] of [...pending.entries()]) {
			pending.delete(handle);
			fn();
		}
	};
	const debounce = createCancellableDebounce<string>((value) => fired.push(value), 100, timers);

	debounce.schedule("stale");
	debounce.schedule("fresh");
	assert.equal(pending.size, 1, "a newer schedule supersedes the pending one");
	assert.equal(debounce.pending(), true);
	fireAll();
	assert.deepEqual(fired, ["fresh"], "only the freshest payload fires");
	assert.equal(debounce.pending(), false);

	debounce.schedule("cancelled");
	debounce.cancel();
	assert.equal(pending.size, 0);
	assert.deepEqual(fired, ["fresh"], "cancelled payloads never fire");

	debounce.schedule("flushed");
	debounce.flush();
	assert.deepEqual(fired, ["fresh", "flushed"], "flush fires immediately");
	assert.equal(pending.size, 0);
	debounce.flush();
	assert.deepEqual(fired, ["fresh", "flushed"], "flush without pending is a no-op");
}

// --- resolveCheckFixTarget: route fixes to where the field lives -----------
function checkFixture(overrides: Partial<SeoContentCheck>): SeoContentCheck {
	return {
		id: "title",
		label: "SEO title length",
		category: "metadata",
		severity: "high",
		status: "fail",
		weight: 10,
		detail: "",
		recommendation: "",
		evidence: { actual: null, expected: "", source: "seo.title" },
		...overrides,
	} as SeoContentCheck;
}
assert.deepEqual(resolveCheckFixTarget(checkFixture({})), {
	kind: "dialog",
	view: "general",
	field: "title",
});
assert.deepEqual(
	resolveCheckFixTarget(
		checkFixture({ id: "description", evidence: { actual: null, expected: "", source: "seo.description" } }),
	),
	{ kind: "dialog", view: "general", field: "description" },
);
assert.deepEqual(
	resolveCheckFixTarget(
		checkFixture({ id: "social-image", category: "social", evidence: { actual: null, expected: "", source: "seo.image" } }),
	),
	{ kind: "dialog", view: "social" },
);
assert.deepEqual(
	resolveCheckFixTarget(
		checkFixture({ id: "indexability", category: "indexability", evidence: { actual: null, expected: "", source: "seo.noIndex" } }),
	),
	{ kind: "advanced" },
);
assert.deepEqual(
	resolveCheckFixTarget(
		checkFixture({ id: "content-depth", category: "content", evidence: { actual: null, expected: "", source: "content body" } }),
	),
	null,
	"the host has no stable focus target for a localized content field",
);
assert.equal(
	resolveCheckFixTarget(checkFixture({ status: "pass" })),
	null,
	"passing checks have no fix target",
);

// --- Evaluation basis in groups, summaries and fix targets -----------------
const analyzedInput: SeoAnalysisInput = {
	ref: "pages:home", collection: "pages", entryId: "home", slug: "home",
	title: "Harbour Bakery fresh bread and pastries daily",
	description: "Fresh bread, pastries and celebration cakes baked every morning at Harbour Bakery, with orders for pickup and local delivery.",
	url: "https://example.com/", canonicalStatus: "matches", image: "https://example.com/og.jpg",
	noindex: false, publicationStatus: "published", body: "", bodySource: "template", assessmentProfile: { profile: "general", version: 1 },
	schemaEnabled: true, schemaPreset: "WebPage", imageSeoEnabled: true,
};
const keywordActionInput: SeoAnalysisInput = {
	...analyzedInput, bodySource: undefined, body: "Fresh bread and pastries are made here every morning.",
	assessmentProfile: { profile: "article", version: 1 },
	focusKeyword: "dental implants", focusKeywords: ["dental implants", "oral surgery"],
};
const keywordActionChecks = analyzeSeoContent(keywordActionInput).checks;
const generatedCheck = (id: string, input = keywordActionInput) => {
	const check = analyzeSeoContent(input).checks.find((item) => item.id === id);
	assert.ok(check, id);
	return check;
};
for (const [id, field, status] of [
	["keyword-title", "title", "fail"], ["keyword-description", "description", "fail"], ["keyword-url", "slug", "review"],
] as const) {
	const check = generatedCheck(id);
	assert.equal(check.status, status, id);
	assert.equal(check.basis, "heuristic", id);
	assert.deepEqual(resolveCheckFixTarget(check), { kind: "dialog", view: "general", field },
		id + " reviews its saved resolved value instead of changing the configured keyword");
}
const lateKeywordTitle = generatedCheck("keyword-title-position", {
	...keywordActionInput, title: "A complete guide to choosing the right treatment plan for patients considering dental implants",
});
assert.equal(lateKeywordTitle.status, "review");
assert.equal(lateKeywordTitle.basis, "heuristic");
assert.deepEqual(resolveCheckFixTarget(lateKeywordTitle), { kind: "dialog", view: "general", field: "title" });
const missingPrimary = generatedCheck("focus-keyword", { ...keywordActionInput, focusKeyword: undefined, focusKeywords: [] });
assert.deepEqual([missingPrimary.status, missingPrimary.basis], ["review", "measured"]);
assert.deepEqual(resolveCheckFixTarget(missingPrimary), { kind: "keyword" }, "the keyword Suggestion focuses the keyword field");
assert.equal(checkActionVerb("keyword"), "Add keyword");
for (const id of ["keyword-introduction", "keyword-content", "keyword-heading", "secondary-keyword-coverage"]) {
	const check = keywordActionChecks.find((item) => item.id === id)!;
	assert.ok(check, id);
	assert.equal(resolveCheckFixTarget(check), null, id + " has no unrelated keyword-field action");
}
for (const check of [
	{ ...generatedCheck("keyword-title"), id: "future-keyword-check" },
	{ ...generatedCheck("keyword-title"), status: "pass" as const },
	{ ...generatedCheck("keyword-title"), basis: "unavailable" as const },
	{ ...generatedCheck("keyword-title"), basis: "not-applicable" as const },
]) assert.equal(resolveCheckFixTarget(check), null, check.id + "/" + check.status + "/" + check.basis);
assert.equal(resolveCheckFixTarget(checkFixture({ id: "future-keyword-check", category: "keyword", evidence: { actual: null, expected: "", source: "seo.title" } })), null,
	"unknown legacy keyword checks do not inherit a metadata target from their evidence source");

const asScore = (result: ReturnType<typeof analyzeSeoContent>, extra: Partial<SeoAdminContentScore> = {}) => ({
	...result, analysisRevision: 0, updatedAt: "2026-10-03T10:00:00.000Z", templateUpdatedAt: null, modulesUpdatedAt: null,
	configurationFingerprint: "seo-config-v1-00000000", metaOverrideUpdatedAt: null, ...extra,
	freshness: extra.freshness ?? "current",
}) as SeoAdminContentScore;
const templateScore = asScore(analyzeSeoContent(analyzedInput));
const templatePresentation = contentCheckPresentation(templateScore);
const templateGroups = templatePresentation.groups;
assert.deepEqual(templateGroups, groupContentChecks(templateScore));
assert.deepEqual(templateGroups.map((group) => group.label), ["Basic SEO", "Additional", "Search snippet", "Content readability"]);
const readability = templateGroups.find((group) => group.id === "content-readability")!;
assert.equal(readability.complete, false, "unavailable body checks never become complete");
assert.deepEqual([readability.summary.label, readability.summary.tone], ["3 not checked", "neutral"]);
assert.equal(readability.scoredCount, 0);
assert.ok(templateGroups.every((group) => !group.complete || group.manualCount === 0), "no group with not-checked rows is complete");
assert.ok(templateGroups.every((group) => (group.summary.label === "All good") ===
	(group.checks.length > 0 && group.issueCount === 0 && group.reviewCount === 0 && group.manualCount === 0)),
	"All good appears exactly when a row applies and nothing is open or not checked");
const templateSummary = summarizeSeoChecks(templateScore.checks);
assert.equal(manualCheckCount(templateScore), templateSummary.unavailable);
assert.equal(analysisSummary(templateScore), seoCheckTotalsText(templatePresentation.totals), "the header line is the sum of the group pills");
assert.ok(analysisSummary(templateScore).endsWith(`${templatePresentation.totals.notChecked} not checked`));
assert.deepEqual(analysisPresentation(templateScore), seoAnalysisPresentation(templateScore));

assert.equal(scorePresentationBadgeText(templateScore.score, analysisPresentation(templateScore)), "-", "a dashed result shows no number");
assert.equal(scorePresentationBadgeText(100, { qualifier: null, tone: "good" }), "100");
assert.equal(scorePresentationBadgeText(77, { label: "Needs improvement", qualifier: "No focus keyword", tone: "review" }), "77", "an unset keyword never hides the number");
assert.equal(scorePresentationBadgeText(79, { label: "Needs improvement", qualifier: "Limited to 79: under 100 words of body text", tone: "review" }), "79");
assert.equal(scorePresentationBadgeText(100, { label: "Earlier analyzer", qualifier: "Analyze again.", tone: "neutral" }), "Earlier analyzer");
assert.equal(scorePresentationBadgeText(100, { label: "Saved analysis", qualifier: "Current content not checked", tone: "neutral" }), "-");
assert.equal(scorePresentationBadgeText(100, null), "-", "an unknown presentation never shows a number");

assert.equal(analysisTone(templateScore), "neutral", "passing metadata cannot imply observed body quality");
assert.equal(analysisStatusLabel(templateScore), "Partially checked");
for (const freshness of ["stale", undefined] as const) {
	assert.equal(analysisTone({ ...templateScore, freshness }), "neutral");
	assert.notEqual(analysisStatusLabel({ ...templateScore, freshness }), "Partially checked");
}
const missingTitleScore = asScore(analyzeSeoContent({ ...analyzedInput, title: "" }));
assert.deepEqual(analysisPresentation(missingTitleScore), seoAnalysisPresentation(missingTitleScore));
const missingTitleMeasured = asScore(analyzeSeoContent({ ...analyzedInput, title: "", bodySource: undefined, body: "word ".repeat(150), document: undefined }));
assert.deepEqual([missingTitleMeasured.score, analysisTone(missingTitleMeasured), analysisStatusLabel(missingTitleMeasured)], [49, "poor", "Poor"],
	"a missing title limits the score to 49, which is Poor");
assert.equal(analysisTone({ ...templateScore, score: 0 }), "neutral", "a dashed presentation is independent of the stored number");

const unscoredExtra = (id: string, basis: "unavailable" | "not-applicable"): SeoContentCheck => ({
	id, label: id, category: "readability", severity: "info", status: "review", weight: 0, detail: "", recommendation: "",
	evidence: { actual: null, expected: "", source: "" }, basis, limitation: "not observed",
});
const measuredScore = asScore(analyzeSeoContent({ ...analyzedInput, bodySource: undefined, body: "word ".repeat(150), document: undefined }));
const extendedScore = { ...measuredScore, checks: [...measuredScore.checks, unscoredExtra("x-manual", "unavailable"), unscoredExtra("x-na", "not-applicable")] } as SeoAdminContentScore;
assert.equal(evaluatedCheckCount(extendedScore), evaluatedCheckCount(measuredScore), "unavailable and not-applicable checks never enter the denominator");
assert.equal(priorityCheckCount(extendedScore), priorityCheckCount(measuredScore));
assert.equal(scoredCheckCount(extendedScore), scoredCheckCount(measuredScore));
assert.equal(
	groupContentChecks(measuredScore).reduce((sum, group) => sum + group.scoredCount, 0),
	evaluatedCheckCount(measuredScore),
	"group denominators add up to the summary denominator",
);
assert.equal(
	groupContentChecks(measuredScore).reduce((sum, group) => sum + group.issueCount, 0),
	priorityCheckCount(measuredScore),
	"group issue counts add up to the summary issue count",
);
for (const scoreCase of [templateScore, measuredScore, extendedScore, missingTitleMeasured]) {
	const presentation = contentCheckPresentation(scoreCase);
	for (const [key, field] of [["issues", "issueCount"], ["suggestions", "reviewCount"], ["notChecked", "manualCount"], ["notApplicable", "notApplicableCount"]] as const)
		assert.equal(presentation.totals[key], presentation.groups.reduce((sum, group) => sum + group[field], 0), `header ${key} is the sum of the groups`);
}
const naOnly = groupContentChecks({ ...measuredScore, checks: [unscoredExtra("y-na", "not-applicable")] } as SeoAdminContentScore)[0];
assert.deepEqual([naOnly.summary.label, naOnly.summary.tone, naOnly.complete, naOnly.checks.length], ["Not applicable", "neutral", false, 0]);
assert.equal(naOnly.note, "1 not applicable: y-na: Does not apply to this entry.", "the not-applicable list stays visible as one closed line");
const passingOnly = groupContentChecks({ ...measuredScore, checks: measuredScore.checks.filter((check) => check.id === "url") } as SeoAdminContentScore)[0];
assert.deepEqual([passingOnly.summary.label, passingOnly.summary.tone, passingOnly.complete], ["All good", "good", true]);

// Rows by basis: a set keyword hides its own row, inapplicable rows move to one list.
const countBlock = (key: string, style: "h2" | "normal", text: string) => ({
	_type: "block", _key: key, style, markDefs: [],
	children: [{ _type: "span", _key: key + "-text", text, marks: [] }],
});
const countDocument = [
	countBlock("count-heading", "h2", "Planning a first dental visit"),
	countBlock("count-introduction", "normal", "A first dental visit starts with practical questions. Keep the appointment details and a short list of topics together."),
	countBlock("count-followup", "normal", "Bring useful notes and check the arrangements beforehand. This fictional example helps an editor review a saved article."),
];
const mixedCountInput: SeoAnalysisInput = {
	...analyzedInput, ref: "posts:visible-pass-count", collection: "posts", entryId: "visible-pass-count",
	slug: "first-dental-visit", title: "First dental visit: planning your appointment",
	description: "Plan a first dental visit with useful appointment notes, clear questions and practical arrangements in this fictional example for editors.",
	url: "https://example.com/posts/first-dental-visit", bodySource: undefined,
	body: "A first dental visit starts with practical questions. Keep useful notes together.", document: countDocument,
	focusKeyword: "first dental visit", focusKeywords: ["first dental visit"],
};
const mixedCountScore = asScore(analyzeSeoContent(mixedCountInput));
const mixedCountBefore = structuredClone(mixedCountScore);
const mixedCountTotals = summarizeSeoChecks(mixedCountScore.checks);
const mixedCountGroups = groupContentChecks(mixedCountScore);
const mixedCountBasic = mixedCountGroups.find((group) => group.id === "basic")!;
assert.deepEqual(mixedCountBasic.checks.filter((check) => classifySeoContentCheck(check).eligible).map((check) => check.id).sort(),
	["description", "keyword-content", "keyword-description", "keyword-title", "title", "url"]);
assert.deepEqual(mixedCountBasic.checks.filter((check) => classifySeoContentCheck(check).role === "advisory" && check.status === "pass").map((check) => check.id).sort(),
	["keyword-heading", "keyword-introduction", "keyword-url"]);
assert.equal(mixedCountBasic.checks.some((check) => check.id === "focus-keyword"), false, "a set keyword hides the Focus keyword row");
assert.deepEqual(mixedCountBasic.notApplicable.flatMap((item) => item.checks.map((entry) => entry.id)), ["secondary-keyword-coverage"]);
assert.equal(mixedCountBasic.checks.some((check) => check.basis === "not-applicable"), false, "inapplicable rows are listed, never shown as rows");
assert.deepEqual(
	[mixedCountBasic.summary.label, mixedCountBasic.summary.tone, mixedCountBasic.scoredCount, mixedCountBasic.notApplicableCount, mixedCountBasic.complete, mixedCountBasic.counts.passed],
	["1 suggestion", "info", 6, 1, false, 9],
	"short General text is a Suggestion; six scored and three advisory rows pass",
);
assert.deepEqual(mixedCountBasic.rows.map((row) => [row.check.id, row.word]).slice(0, 2), [["content-depth", "Suggestion"], ["title", "Passed"]]);
assert.equal(mixedCountGroups.reduce((sum, group) => sum + group.scoredCount, 0), mixedCountTotals.evaluated);
assert.equal(scoredCheckCount(mixedCountScore), mixedCountTotals.evaluated);
assert.equal(priorityCheckCount(mixedCountScore), mixedCountTotals.issues);
assert.deepEqual(mixedCountScore, mixedCountBefore, "group presentation preserves every engine result and weighted calculation");

const countAdviceOnly = groupContentChecks({ ...mixedCountScore, checks: mixedCountBasic.checks.filter((check) =>
	["keyword-introduction", "keyword-heading"].includes(check.id)) } as SeoAdminContentScore)[0];
assert.deepEqual([countAdviceOnly.summary.label, countAdviceOnly.summary.tone, countAdviceOnly.scoredCount, countAdviceOnly.complete],
	["All good", "good", 0, true], "passed advice is a row that applies");
const countDirective = mixedCountScore.checks.find((check) => check.id === "indexability")!;
assert.deepEqual([countDirective.status, classifySeoContentCheck(countDirective).role], ["pass", "condition"]);
const countWithCondition = groupContentChecks({ ...mixedCountScore, checks: [countDirective,
	mixedCountScore.checks.find((check) => check.id === "social-image")!] } as SeoAdminContentScore);
assert.deepEqual(countWithCondition.map((group) => [group.summary.label, group.scoredCount, group.checks.length]), [["All good", 1, 1]],
	"the indexing directive is never a row");
const countLegacy = groupContentChecks({ ...mixedCountScore, scoreVersion: SEO_SCORE_VERSION - 1 }).find((group) => group.id === "basic")!;
assert.deepEqual([countLegacy.summary.label, countLegacy.summary.tone, countLegacy.complete], ["Earlier analyzer", "neutral", false]);
const countWithIssue = groupContentChecks(asScore(analyzeSeoContent({ ...mixedCountInput, title: "" }))).find((group) => group.id === "basic")!;
assert.deepEqual([countWithIssue.summary.label, countWithIssue.summary.tone, countWithIssue.complete], ["2 issues, 1 suggestion", "poor", false]);
assert.deepEqual(countWithIssue.rows.slice(0, 3).map((row) => [row.check.id, row.word]), [["title", "Failed"], ["keyword-title", "Failed"], ["content-depth", "Suggestion"]],
	"Failed rows come first, heavier first");
const countWithReview = groupContentChecks(asScore(analyzeSeoContent({ ...mixedCountInput,
	document: [countBlock("count-heading", "h2", "Questions to bring"), ...countDocument.slice(1)],
}))).find((group) => group.id === "basic")!;
assert.deepEqual([countWithReview.summary.label, countWithReview.issueCount, countWithReview.reviewCount, countWithReview.complete],
	["2 suggestions", 0, 2, false], "advice that is not met is a Suggestion, never an issue");
const countManualCheck = analyzeSeoContent({ ...mixedCountInput, bodySource: "template" }).checks.find((check) => check.id === "keyword-introduction")!;
assert.equal(countManualCheck.basis, "unavailable");
const countWithManual = groupContentChecks({ ...mixedCountScore, checks: mixedCountBasic.checks.filter((check) => check.status === "pass").map((check) =>
	check.id === countManualCheck.id ? countManualCheck : check) } as SeoAdminContentScore)[0];
assert.deepEqual([countWithManual.summary.label, countWithManual.manualCount, countWithManual.complete],
	["1 not checked", 1, false], "unavailable evidence still takes precedence over successful rows");

// Keyword chips follow the rows that checked that keyword.
assert.deepEqual(keywordCheckCoverage("First dental visit", "primary", mixedCountScore), {
	tone: "good", count: "3/3", label: "In the title, description and body text", found: ["title", "description", "body"], missing: [],
});
const keywordMissed = analyzeSeoContent(keywordActionInput);
assert.deepEqual(keywordCheckCoverage("dental implants", "primary", keywordMissed), {
	tone: "poor", count: "0/3", label: "Not in the title, description or body text", found: [], missing: ["title", "description", "body"],
});
const keywordInTitle = analyzeSeoContent({ ...keywordActionInput, title: "Dental implants at Harbour Bakery" });
assert.deepEqual(keywordCheckCoverage("dental implants", "primary", keywordInTitle), {
	tone: "review", count: "1/3", label: "In the title; not in the description or body text", found: ["title"], missing: ["description", "body"],
});
const templateKeyword = analyzeSeoContent({ ...keywordActionInput, bodySource: "template", body: "", title: "Dental implants guide" });
assert.equal(keywordCheckCoverage("dental implants", "primary", templateKeyword)?.count, "1/2", "an unread body leaves the body row out of the chip");
assert.equal(keywordCheckCoverage("oral surgery", "primary", keywordMissed), null, "the chip never borrows another keyword's rows");
assert.equal(keywordCheckCoverage("dental implants", "primary", { ...keywordMissed, scoreVersion: SEO_SCORE_VERSION - 1 }), null);
assert.equal(keywordCheckCoverage("dental implants", "primary", null), null);
assert.deepEqual(keywordCheckCoverage("oral surgery", "secondary", keywordMissed)?.tone, "poor");
const secondaryCovered = analyzeSeoContent({ ...keywordActionInput, description: "Oral surgery and fresh bread, explained by Harbour Bakery." });
assert.deepEqual(keywordCheckCoverage("Oral Surgery", "secondary", secondaryCovered), {
	tone: "good", count: null, label: "In the title, description or body text", found: [], missing: [],
});
const twoSecondaries = analyzeSeoContent({ ...keywordActionInput, focusKeywords: ["dental implants", "oral surgery", "fresh bread"] });
assert.equal(keywordCheckCoverage("fresh bread", "secondary", twoSecondaries)?.tone, "good");
assert.equal(keywordCheckCoverage("oral surgery", "secondary", twoSecondaries)?.tone, "poor");
assert.equal(keywordCheckCoverage("oral surgery", "secondary", { ...twoSecondaries, keywords: ["dental implants", "fresh bread"] }), null,
	"a keyword the analysis did not check has no coverage");
assert.equal(keywordCheckCoverage("oral surgery", "secondary", mixedCountScore), null, "no secondary row was evaluated");
for (const [phrase, other] of [['27" display', "fresh bread"], ["missing: piece", "fresh bread"], ['the "best" screen', "oral surgery"]] as const) {
	const keywords = ["dental implants", phrase, other];
	const quoted = { ...analyzeSeoContent({ ...keywordActionInput, focusKeywords: keywords }), keywords };
	assert.match(quoted.checks.find((check) => check.id === "secondary-keyword-coverage")!.detail, /missing: /);
	assert.equal(keywordCheckCoverage(phrase, "secondary", quoted)?.tone, "poor", `${phrase} is listed as missing`);
}
const quotedCovered = ["dental implants", "27", '27" display'];
assert.equal(keywordCheckCoverage("27", "secondary", {
	...analyzeSeoContent({ ...keywordActionInput, description: "Book 27 dental implants checks at Harbour Bakery.", focusKeywords: quotedCovered }), keywords: quotedCovered,
})?.tone, "good", "a covered phrase is not read out of a longer missing entry");

// An empty alt is an open measured review without weight: it never changes the
// score or the issue count, but its group is not complete.
const emptyAlt = asScore(analyzeSeoContent({
	...analyzedInput, bodySource: undefined, body: "word ".repeat(150), imageSeoEnabled: true,
	document: [{ _type: "image", asset: { _ref: "media:1" }, alt: "" }],
}));
const emptyAltCheck = emptyAlt.checks.find((check) => check.id === "image-empty-alt-review")!;
assert.deepEqual([emptyAltCheck.basis, emptyAltCheck.status, emptyAltCheck.weight, emptyAltCheck.severity], ["measured", "review", 0, "info"]);
const altGroup = groupContentChecks({ ...emptyAlt, checks: emptyAlt.checks.filter((check) => ["social-image", "image-empty-alt-review"].includes(check.id)) } as SeoAdminContentScore)[0];
assert.deepEqual(
	[altGroup.summary.label, altGroup.summary.tone, altGroup.complete, altGroup.issueCount, altGroup.reviewCount, altGroup.scoredCount],
	["1 suggestion", "info", false, 0, 1, 1],
	"an outstanding empty-alt review is a Suggestion, never a weighted issue",
);
assert.equal(priorityCheckCount(emptyAlt), priorityCheckCount({ ...emptyAlt, checks: emptyAlt.checks.filter((check) => check.id !== "image-empty-alt-review") } as SeoAdminContentScore));
assert.equal(buildSeoWorkQueue([emptyAlt]).some((item) => item.check.id === "image-empty-alt-review"), false);
assert.equal(groupContentChecks(emptyAlt).reduce((sum, group) => sum + group.reviewCount, 0), summarizeSeoChecks(emptyAlt.checks).advisories);
const allVisible = groupContentChecks(emptyAlt).flatMap((group) => group.checks.map((check) => check.id));
assert.equal(new Set(allVisible).size, allVisible.length, "a check is assigned to one group only");

const legacyScore = asScore(analyzeSeoContent(analyzedInput), { scoreVersion: SEO_SCORE_VERSION - 1, freshness: "stale" });
const legacyGroups = groupContentChecks(legacyScore);
assert.ok(legacyGroups.every((group) => group.legacy && !group.complete && group.manualCount === 0), "a legacy score claims no completion or basis");
assert.ok(legacyGroups.every((group) => group.summary.label === "Earlier analyzer" && group.issueCount === 0));
assert.ok(legacyGroups.flatMap((group) => group.rows).every((row) => row.word === "Earlier result" && row.action === null));
assert.equal(analysisSummary(legacyScore), "Earlier analyzer. Analyze again.");
assert.ok(legacyScore.checks.every((check) => checkEvidenceBasis(legacyScore, check) === "legacy"));
assert.equal(manualCheckCount(legacyScore), 0);
assert.equal(searchExclusionCheck(legacyScore), null);

const excludedScore = asScore(analyzeSeoContent({ ...analyzedInput, noindex: true, noindexSources: ["entry-seo"] }));
const excluded = searchExclusionCheck(excludedScore);
assert.equal(excluded?.id, "indexability");
assert.equal(excludedScore.checks.filter((check) => check.condition).length, 1);
assert.equal(priorityCheckCount(excludedScore), priorityCheckCount(templateScore), "the condition is not an issue");
assert.equal(evaluatedCheckCount(excludedScore), evaluatedCheckCount(templateScore), "the indexing directive is never in the denominator, allowed or excluded");
assert.deepEqual([excludedScore.score, excludedScore.status], [templateScore.score, templateScore.status], "noindex does not change the score of the same content");
assert.deepEqual(resolveCheckFixTarget(excluded!), { kind: "advanced" }, "the condition can be reviewed where noindex is set");
assert.equal(groupContentChecks(excludedScore).flatMap((group) => group.checks).some((check) => check.id === "indexability"), false,
	"an excluded entry shows the banner, never a row");

const currentTitle = analyzeSeoContent({ ...analyzedInput, title: "", titleSource: "template" }).checks.find((check) => check.id === "title")!;
assert.deepEqual(resolveCheckFixTarget(currentTitle), { kind: "dialog", view: "general", field: "title" }, "a template title opens the saved title review");
const manualDepth = templateScore.checks.find((check) => check.id === "content-depth")!;
assert.equal(resolveCheckFixTarget(manualDepth), null, "a manual check has nothing to fix in the editor");

// Ordinary stored snapshots stay historical; confirmed session evidence can be current.
const storedCurrent = { ...templateScore, freshness: "current" } as SeoAdminContentScore;
const sessionCurrent = { ...templateScore, persistence: "session", freshness: "current" } as SeoAdminContentScore;
const sessionStale = { ...sessionCurrent, freshness: "stale" } as SeoAdminContentScore;
assert.equal(hasCurrentEditorAnalysis(sessionCurrent), true, "confirmed current evidence from the current analyzer enables editor findings");
assert.equal(hasCurrentEditorAnalysis(sessionStale), false, "stale evidence cannot enable editor findings");
assert.equal(hasCurrentEditorAnalysis({ scoreVersion: SEO_SCORE_VERSION }), false, "evidence without confirmed freshness cannot enable editor findings");
assert.equal(hasCurrentEditorAnalysis({ ...sessionCurrent, scoreVersion: SEO_SCORE_VERSION - 1 }), false,
	"an earlier analyzer cannot enable editor findings even when its freshness is current");
assert.equal(selectEditorScore({ sessionScore: sessionCurrent, storedSnapshot: storedCurrent, storedProfileChanged: false }).score, sessionCurrent);
const coldLoad = selectEditorScore({ sessionScore: null, storedSnapshot: storedCurrent, storedProfileChanged: false });
assert.deepEqual([coldLoad.score?.freshness, coldLoad.storedOutOfDate], [undefined, false],
	"a cold load withdraws an ordinary snapshot's current claim without inventing a mismatch");
assert.equal(hasCurrentEditorAnalysis(coldLoad.score!), false);
assert.deepEqual(analysisPresentation(coldLoad.score!), {
	label: "Saved analysis", qualifier: "Current content not checked", tone: "neutral",
});
assert.equal(storedCurrent.freshness, "current", "selection never mutates the source snapshot");
const unknownLoad = selectEditorScore({
	sessionScore: null, storedSnapshot: { ...storedCurrent, freshness: undefined }, storedProfileChanged: false,
});
assert.deepEqual([unknownLoad.score?.freshness, unknownLoad.storedOutOfDate], [undefined, false]);
assert.deepEqual(analysisPresentation(unknownLoad.score!), analysisPresentation(coldLoad.score!),
	"an unverified snapshot stays unverified after an ordinary reload or responsive remount");
const afterDemotion = selectEditorScore({ sessionScore: sessionStale, storedSnapshot: storedCurrent, storedProfileChanged: false });
assert.deepEqual([afterDemotion.score?.persistence, afterDemotion.score?.freshness], [undefined, undefined],
	"a demoted session result never hands the current claim to a stored score");
const refetchedAgain = selectEditorScore({ sessionScore: sessionStale, storedSnapshot: { ...storedCurrent, updatedAt: "2026-10-03T13:00:00.000Z" }, storedProfileChanged: false });
assert.equal(refetchedAgain.score?.freshness, undefined, "a later stored refetch does not restore a current claim");
assert.equal(hasCurrentEditorAnalysis(refetchedAgain.score!), false);
for (const [storedSnapshot, storedProfileChanged] of [
	[{ ...storedCurrent, freshness: "stale" }, false],
	[storedCurrent, true],
] as const) {
	const knownMismatch = selectEditorScore({ sessionScore: null, storedSnapshot, storedProfileChanged });
	assert.deepEqual([knownMismatch.score?.freshness, knownMismatch.storedOutOfDate], ["stale", true]);
	assert.equal(hasCurrentEditorAnalysis(knownMismatch.score!), false);
	assert.deepEqual(analysisPresentation(knownMismatch.score!), {
		label: "Analysis needs refreshing", qualifier: "Current content not checked", tone: "neutral",
	}, "a proven source or profile mismatch keeps the refresh state");
}
assert.equal(selectEditorScore({ sessionScore: sessionStale, storedSnapshot: null, storedProfileChanged: false }).score, sessionStale);

const verifiedStored = { ...storedCurrent, inputIdentity: `seo-input-v1-sha256-${"a".repeat(64)}` } as SeoAdminContentScore;
assert.equal(selectEditorScore({ sessionScore: null, storedSnapshot: storedCurrent, verifiedStoredScore: verifiedStored, storedProfileChanged: false }).score, verifiedStored,
	"an explicit current-input readback can show the durable result as current");
assert.equal(selectEditorScore({ sessionScore: sessionCurrent, storedSnapshot: storedCurrent, verifiedStoredScore: verifiedStored, storedProfileChanged: false }).score, sessionCurrent,
	"a later confirmed session analysis stays separate and takes precedence");
assert.equal(selectEditorScore({ sessionScore: sessionStale, storedSnapshot: storedCurrent, verifiedStoredScore: verifiedStored, storedProfileChanged: false }).score, verifiedStored,
	"the explicit readback is distinct from a stale session result");
for (const patch of [{ freshness: undefined }, { freshness: "stale" }, { scoreVersion: SEO_SCORE_VERSION - 1 }, { persistence: "session" }]) {
	const rejectedProof = selectEditorScore({ sessionScore: null, storedSnapshot: storedCurrent, verifiedStoredScore: { ...verifiedStored, ...patch } as SeoAdminContentScore, storedProfileChanged: false });
	assert.deepEqual([rejectedProof.score?.freshness, rejectedProof.storedOutOfDate], [undefined, false],
		"an unusable durable proof leaves the ordinary snapshot unverified, never current or proven stale");
	assert.equal(hasCurrentEditorAnalysis(rejectedProof.score!), false);
}
assert.equal(selectEditorScore({ sessionScore: null, storedSnapshot: storedCurrent, verifiedStoredScore: verifiedStored, storedProfileChanged: true }).score?.freshness, "stale",
	"a changed profile withdraws the stored proof");
const selectedLegacy = selectEditorScore({
	sessionScore: null, storedSnapshot: { ...storedCurrent, scoreVersion: SEO_SCORE_VERSION - 1 }, storedProfileChanged: false,
});
assert.equal(hasCurrentEditorAnalysis(selectedLegacy.score!), false);
assert.deepEqual(analysisPresentation(selectedLegacy.score!), {
	label: "Earlier analyzer", qualifier: "Analyze again.", tone: "neutral",
}, "legacy wording takes precedence over the snapshot's unverified state");
assert.deepEqual(selectEditorScore({ sessionScore: null, storedSnapshot: null, storedProfileChanged: false }),
	{ score: null, storedOutOfDate: false });

// --- Search-preview URL resolution ------------------------------------------
// Order: valid configured public site URL > entry/site-context URL. The
// development badge only appears for loopback origins.

// 1. Configured production URL wins even while the admin runs locally.
const configuredResolved = resolveSeoPreviewUrl(
	"http://localhost:4322/blog/a-post",
	"https://shipitdigital.nl",
);
assert.equal(configuredResolved.url, "https://shipitdigital.nl/blog/a-post");
assert.equal(configuredResolved.source, "configured");
assert.equal(configuredResolved.development, false, "a production origin shows no dev badge");

// 2. Localhost fallback when nothing is configured.
const localhostResolved = resolveSeoPreviewUrl("http://localhost:4322/blog/a-post", null);
assert.equal(localhostResolved.source, "entry");
assert.equal(localhostResolved.development, true);

// 3. IPv4 loopback (whole 127/8 block).
assert.equal(resolveSeoPreviewUrl("http://127.0.0.1:4322/x", "").development, true);
assert.equal(resolveSeoPreviewUrl("http://127.8.1.2/x", undefined).development, true);

// 4. IPv6 loopback.
assert.equal(resolveSeoPreviewUrl("http://[::1]:4322/x", null).development, true);
assert.equal(isDevelopmentHostname("[::1]"), true);
assert.equal(isDevelopmentHostname("::1"), true);

// 5. Invalid configured URL falls back to the entry URL instead of breaking
// the preview.
const invalidConfigured = resolveSeoPreviewUrl(
	"http://localhost:4322/blog/a-post",
	"not a url",
);
assert.equal(invalidConfigured.source, "entry");
assert.equal(invalidConfigured.development, true);
assert.equal(
	resolveSeoPreviewUrl("https://shipitdigital.nl/blog/a-post", "ftp://weird").url,
	"https://shipitdigital.nl/blog/a-post",
	"non-http(s) configured URLs are ignored",
);

// 6. Relative entry paths: joined onto a valid configured base, and kept
// relative (no invented origin, no dev badge) without one.
assert.equal(
	resolveSeoPreviewUrl("/blog/a-post", "https://shipitdigital.nl").url,
	"https://shipitdigital.nl/blog/a-post",
);
const relativeResolved = resolveSeoPreviewUrl("/blog/a-post", null);
assert.equal(relativeResolved.url, "/blog/a-post");
assert.equal(relativeResolved.hostname, "");
assert.equal(relativeResolved.development, false);

// Non-loopback hosts never show the badge.
assert.equal(isDevelopmentHostname("shipitdigital.nl"), false);
assert.equal(isDevelopmentHostname("127.0.0.1.evil.example"), false);
assert.equal(isDevelopmentHostname("staging.localhost"), true);

const savedEntryImage = {
	savedImage: "https://example.com/media/saved.jpg",
	savedSource: "core-seo",
	hostImage: "https://example.com/media/saved.jpg",
};
assert.deepEqual(
	resolveSeoSocialImagePreview({ ...savedEntryImage, pendingImage: null }),
	{ url: null, state: "removed", removable: false },
	"a removed entry image is not previewed with the old saved image",
);
assert.deepEqual(
	resolveSeoSocialImagePreview({ ...savedEntryImage, hostImage: null, pendingImage: undefined }),
	{ url: null, state: "removed", removable: false },
	"a host draft that cleared the entry image previews as removed",
);
assert.deepEqual(
	resolveSeoSocialImagePreview({
		savedImage: "https://example.com/media/featured.jpg",
		savedSource: "content",
		hostImage: null,
		pendingImage: undefined,
	}),
	{ url: "https://example.com/media/featured.jpg", state: "saved", removable: false },
	"a featured-image fallback stays visible and offers no Remove action",
);
assert.deepEqual(
	resolveSeoSocialImagePreview({ ...savedEntryImage, pendingImage: "/_emdash/api/media/file/new.png" }),
	{ url: "/_emdash/api/media/file/new.png", state: "selected", removable: true },
);
assert.deepEqual(seoSocialImageChange(savedEntryImage.hostImage, undefined), { changed: false, next: null });
assert.deepEqual(seoSocialImageChange(savedEntryImage.hostImage, null), { changed: true, next: null });
assert.deepEqual(
	seoSocialImageChange(savedEntryImage.hostImage, ` ${savedEntryImage.hostImage} `),
	{ changed: false, next: savedEntryImage.hostImage },
);
const snippetBaseline = { title: "Title", slug: "entry", description: "Description" };
const imageOnlyPlan = buildSeoSnippetApplyPlan(snippetBaseline, snippetBaseline, {
	baseline: savedEntryImage.hostImage,
	next: null,
});
assert.deepEqual(imageOnlyPlan.changedFields, ["image"], "an image-only change is part of the apply plan");
assert.deepEqual(imageOnlyPlan.seo, { image: null });
assert.equal(
	seoSnippetDialogPrimaryAction({ general: false, social: false, image: true }),
	"apply",
	"an image-only change is applied, not closed",
);
assert.equal(seoSnippetDialogPrimaryAction({ general: false, social: false, image: false }), "close");

// Render readiness across one panel mount: a background refetch or a failed
// refresh keeps the confirmed data, so the open dialog is not unmounted.
{
	const step = (confirmed: boolean, isFetchedAfterMount: boolean, isSuccess: boolean, data: unknown) =>
		readAfterMountConfirmed(confirmed, { isFetchedAfterMount, isSuccess, data });
	const cachedFromEarlierMount = step(false, false, true, { values: {} });
	assert.equal(cachedFromEarlierMount, false, "data cached before this mount is not enough");
	const firstFetchFailed = step(false, true, false, { values: {} });
	assert.equal(firstFetchFailed, false, "the first read after mount must succeed");
	const confirmed = step(false, true, true, { values: {} });
	assert.equal(confirmed, true);
	assert.equal(step(confirmed, true, true, { values: {} }), true, "a background refetch keeps it");
	assert.equal(step(confirmed, true, false, { values: {} }), true, "a failed refresh keeps it");
	assert.equal(step(false, true, true, undefined), false);
}

// A host autosave changes the saved version, so its preview query starts empty.
// The shown preview keeps the entry and locale identity, never the version.
{
	const identity = JSON.stringify(["posts:entry-a", "en"]);
	const first = retainEntryPreview(null, identity, "preview of version 4");
	assert.deepEqual([first.shown, first.earlier], ["preview of version 4", false]);
	const loadingNewer = retainEntryPreview(first.retained, identity, null);
	assert.deepEqual([loadingNewer.shown, loadingNewer.earlier], ["preview of version 4", true],
		"the open dialog keeps its preview while version 5 loads");
	const newer = retainEntryPreview(loadingNewer.retained, identity, "preview of version 5");
	assert.deepEqual([newer.shown, newer.earlier], ["preview of version 5", false]);
	for (const other of [JSON.stringify(["posts:entry-b", "en"]), JSON.stringify(["posts:entry-a", "nl"])]) {
		const switched = retainEntryPreview(newer.retained, other, null);
		assert.deepEqual([switched.shown, switched.retained], [null, null], "another entry or locale never shows this preview");
	}
	assert.equal(retainEntryPreview(null, identity, null).shown, null, "nothing is shown before the first load");
}

// ---- Saved field ownership notice ----
const ownershipFor = (sourceVersion: string, locale: string | null = "en", status: "current" | "stale" | "unknown" = "current"): any => status === "current"
	? {
		status, reason: null, sourceVersion, locale,
		record: { sourceOverrideId: "posts:post-1", keyKind: "id" },
		fields: [
			{ field: "title", state: "conflict", core: "Core title", legacy: "Legacy title", effective: "Legacy title", effectiveSource: "legacy-override", social: { value: "Social title", source: "plugin-social-override" } },
			{ field: "description", state: "equal", core: "Same", legacy: "Same", effective: "Same", effectiveSource: "legacy-override", social: { value: "Same", source: "legacy-override" } },
			{ field: "canonical", state: "not-shadowed", core: null, legacy: null, effective: "https://example.com/a", effectiveSource: "generated", social: null },
			{ field: "image", state: "unknown", core: null, legacy: null, effective: null, effectiveSource: null, social: null, reason: "legacy-field-invalid" },
			{ field: "noIndex", state: "conflict", core: false, legacy: true, effective: true, effectiveSource: "legacy-override", social: null },
		],
		unsupportedDirectives: { state: "present", tokens: ["noarchive"] },
	}
	: {
		status, reason: status === "stale" ? "saved-version-mismatch" : "core-seo-invalid", sourceVersion, locale, record: null,
		fields: ["title", "description", "canonical", "image", "noIndex"].map((field) => ({
			field, state: "unknown", core: null, legacy: null, effective: null, effectiveSource: null, social: null,
			reason: status === "stale" ? "saved-version-mismatch" : "core-seo-invalid",
		})),
		unsupportedDirectives: { state: "unknown", tokens: [] },
	};
const ownershipPreview = (sourceVersion: string, ownership: any, ref = "posts:post-1") =>
	({ content: { ref }, sourceKind: "saved-snapshot", sourceVersion, ownership } as unknown as SeoAdminEntryPreview);
const observe = (observation: Partial<SeoOwnershipObservation>): SeoOwnershipObservation =>
	({ preview: null, fetchedAfterMount: true, fetching: false, error: null, ...observation });
const resolveOwnership = (savedVersion: string, retained: SeoOwnershipRetention | null, observation: Partial<SeoOwnershipObservation>, ref = "posts:post-1") =>
	resolveSeoOwnershipNotice({ ref, savedVersion, retained, observation: observe(observation) });

const fresh = resolveOwnership("v1", null, { preview: ownershipPreview("v1", ownershipFor("v1")) });
assert.equal(fresh.notice.kind, "current");
assert.deepEqual([fresh.retained?.ref, fresh.retained?.locale, fresh.retained?.sourceVersion], ["posts:post-1", "en", "v1"]);

// Cached data from before this mount is never current; with nothing verified yet it is loading.
assert.equal(resolveOwnership("v1", null, { preview: ownershipPreview("v1", ownershipFor("v1")), fetchedAfterMount: false, fetching: true }).notice.kind, "loading");
assert.equal(resolveOwnership("v1", null, { preview: ownershipPreview("v1", ownershipFor("v1")), fetchedAfterMount: false }).notice.kind, "loading");

// While the same version refetches, the verified facts are explicitly stale.
const refetching = resolveOwnership("v1", fresh.retained, { preview: ownershipPreview("v1", ownershipFor("v1")), fetching: true });
assert.deepEqual([refetching.notice.kind, (refetching.notice as any).cause, (refetching.notice as any).savedVersionChanged], ["stale", "refreshing", false]);

// After a core save the preview for the new version is pending, then may fail: the old facts stay, never current.
const afterSave = resolveOwnership("v2", fresh.retained, { fetching: true });
assert.deepEqual([afterSave.notice.kind, (afterSave.notice as any).cause, (afterSave.notice as any).savedVersionChanged], ["stale", "refreshing", true]);
const failedAfterSave = resolveOwnership("v2", afterSave.retained, { error: new Error("offline") });
assert.deepEqual([failedAfterSave.notice.kind, (failedAfterSave.notice as any).cause, (failedAfterSave.notice as any).savedVersionChanged], ["stale", "failed", true]);
assert.equal((failedAfterSave.notice as any).ownership, fresh.retained!.ownership, "the retained facts are the ones verified earlier");
assert.equal(resolveOwnership("v1", null, { error: new Error("offline") }).notice.kind, "unavailable");

// A failed refetch keeps its earlier data in the query; the error outranks it.
const failedRefetch = resolveOwnership("v1", fresh.retained, { preview: ownershipPreview("v1", ownershipFor("v1")), error: new Error("offline") });
assert.deepEqual([failedRefetch.notice.kind, (failedRefetch.notice as any).cause, (failedRefetch.notice as any).savedVersionChanged], ["stale", "failed", false]);
assert.equal(failedRefetch.retained, fresh.retained);
const failedAfterNewSave = resolveOwnership("v2", fresh.retained, { preview: ownershipPreview("v1", ownershipFor("v1")), error: new Error("offline") });
assert.deepEqual([failedAfterNewSave.notice.kind, (failedAfterNewSave.notice as any).cause, (failedAfterNewSave.notice as any).savedVersionChanged], ["stale", "failed", true]);
const failedWithoutVerified = resolveOwnership("v1", null, { preview: ownershipPreview("v1", ownershipFor("v1")), error: new Error("offline") });
assert.deepEqual([failedWithoutVerified.notice, failedWithoutVerified.retained], [{ kind: "unavailable", cause: "failed", reason: null }, null],
	"data held beside an error is never adopted as verified");

// A delayed completion for an earlier version is not current for the newer save.
const delayed = resolveOwnership("v2", fresh.retained, { preview: ownershipPreview("v1", ownershipFor("v1")) });
assert.deepEqual([delayed.notice.kind, (delayed.notice as any).cause], ["stale", "not-current"]);
const recovered = resolveOwnership("v2", delayed.retained, { preview: ownershipPreview("v2", ownershipFor("v2")) });
assert.deepEqual([recovered.notice.kind, recovered.retained?.sourceVersion], ["current", "v2"]);

// An answer the engine marks stale or unknown keeps the earlier facts stale and names why.
const engineStale = resolveOwnership("v2", recovered.retained, { preview: ownershipPreview("v2", ownershipFor("v1", "en", "stale")) });
assert.deepEqual([engineStale.notice.kind, (engineStale.notice as any).reason], ["stale", "saved-version-mismatch"]);
const unknownFirst = resolveOwnership("v1", null, { preview: ownershipPreview("v1", ownershipFor("v1", "en", "unknown")) });
assert.deepEqual(unknownFirst.notice, { kind: "unavailable", cause: "not-current", reason: "core-seo-invalid" });
const missingOwnership = resolveOwnership("v1", null, { preview: ownershipPreview("v1", undefined) });
assert.deepEqual(missingOwnership.notice, { kind: "unavailable", cause: "not-current", reason: null }, "an answer without ownership is never shown as conflict-free");

// Locale and entry isolation.
const otherLocale = resolveOwnership("v2", recovered.retained, { preview: ownershipPreview("v2", ownershipFor("v2", "fr", "unknown")) });
assert.deepEqual([otherLocale.notice.kind, otherLocale.retained], ["unavailable", null], "facts for another actual locale are dropped");
const switchedLocale = resolveOwnership("v2", recovered.retained, { preview: ownershipPreview("v2", ownershipFor("v2", "fr")) });
assert.deepEqual([switchedLocale.notice.kind, switchedLocale.retained?.locale], ["current", "fr"]);
const nullLocale = resolveOwnership("v2", recovered.retained, { preview: ownershipPreview("v2", ownershipFor("v2", null, "unknown")) });
assert.equal(nullLocale.retained, null, "a host row without a locale is another actual locale");
const otherEntry = resolveOwnership("v1", fresh.retained, { fetching: true }, "posts:post-2");
assert.deepEqual([otherEntry.notice.kind, otherEntry.retained], ["loading", null]);

// A permission refusal clears everything and is reported first.
const denied = resolveOwnership("v1", fresh.retained, { error: Object.assign(new Error("Forbidden"), { status: 403 }), fetching: true });
assert.deepEqual([denied.notice, denied.retained], [{ kind: "permission-denied" }, null]);
assert.equal(isPermissionDenied({ status: 401 }), false);
assert.equal(isPermissionDenied(null), false);

// Field text: five saved fields, the title scope and honest unknowns.
const views = seoOwnershipFieldViews(ownershipFor("v1"));
assert.deepEqual(views.map((view) => view.field), ["title", "description", "canonical", "image", "noIndex"]);
assert.equal(views[0].label, "Social title and title suggestion");
assert.doesNotMatch(views.map((view) => view.label).join(" "), /page title/i);
assert.deepEqual([views[0].core, views[0].effective, views[0].source], ["Core title", "Legacy title", "Legacy SEO record"]);
assert.equal(views[0].social, "Social override decides the social value.");
assert.equal(views[1].social, null);
assert.deepEqual([views[2].core, views[2].source], ["Not set", "Generated from the entry"]);
assert.deepEqual([views[3].state, views[3].reason], ["unknown", "The legacy record's value for this field is not valid."]);
assert.deepEqual([views[4].core, views[4].effective], ["Indexable", "noindex"]);
assert.deepEqual(seoOwnershipSummary(ownershipFor("v1")), { conflicts: 2, equal: 1, unknown: 1, coreOnly: false });
const coreOnly = {
	...ownershipFor("v1"), record: null, unsupportedDirectives: { state: "none", tokens: [] },
	fields: ownershipFor("v1").fields.map((item: any) => ({ ...item, state: "not-shadowed", legacy: null, effectiveSource: "core-seo", reason: undefined })),
};
assert.equal(seoOwnershipSummary(coreOnly).coreOnly, true);
assert.equal(seoOwnershipSummary(ownershipFor("v1", "en", "unknown")).coreOnly, false, "unknown is never reported as core-only");

console.log("SEO content extension model self-check passed.");

// ---- Durable saved analysis notices ----
{
	const answer = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", ref: score.ref } as const;
	const saved = (history: "created" | "unchanged" | "failed" | "uncertain") =>
		savedAnalysisNotice({ ...answer, success: true, outcome: "saved", history, item: score as any });
	assert.deepEqual(saved("created"), { tone: "success", message: "Analysis of the saved content was stored." });
	assert.deepEqual(saved("unchanged").tone, "success");
	assert.deepEqual(saved("failed"), { tone: "warning", message: "Analysis of the saved content was stored. Its score history entry could not be recorded." },
		"a saved score stays saved with a separate history warning");
	assert.match(saved("uncertain").message, /stored\. Its score history entry could not be confirmed\./);
	assert.match(savedAnalysisNotice({ ...answer, success: true, outcome: "reused", history: "not-attempted", item: score as any }).message, /unchanged, so the stored analysis was reused/);
	for (const error of ["scoring_disabled", "scoring_unavailable", "superseded", "uncertain", "analysis_failed"] as const) {
		const notice = savedAnalysisNotice({ ...answer, success: false, error });
		assert.equal(notice.tone, "error", error);
		assert.doesNotMatch(notice.message, /^Analysis of the saved content was stored/, `${error} is never presented as stored`);
	}
	assert.match(savedAnalysisNotice({ ...answer, success: false, error: "uncertain" }).message, /Reload this entry before analyzing again/);
	const v2Result = { ...answer, success: true, outcome: "saved", history: "created", item: { ...score, sourceVersion: "saved-v2" } as any } as const;
	assert.deepEqual(savedAnalysisNotice(v2Result, "saved-v2").tone, "success", "control: the requested saved version");
	const v1Editor = savedAnalysisNotice(v2Result, "saved-v1");
	assert.equal(v1Editor.tone, "warning");
	assert.match(v1Editor.message, /saved again elsewhere[\s\S]*Reload/, "a newer save's result is not presented as this editor's version");
	assert.doesNotMatch(v1Editor.message, /^Analysis of the saved content was stored/);
	for (const [history, warning] of [["failed", "could not be recorded"], ["uncertain", "could not be confirmed"]] as const) {
		const notice = savedAnalysisNotice({ ...v2Result, history }, "saved-v1");
		assert.equal(notice.tone, "warning");
		assert.match(notice.message, new RegExp(`saved again elsewhere[\\s\\S]*history entry ${warning}[\\s\\S]*Reload`),
			`a newer-save notice keeps the ${history} history warning`);
	}
	assert.match(savedAnalysisNotice({ ...answer, success: false, error: "scoring_disabled" }).message, /no analysis result was stored/,
		"a refusal after computation never claims nothing was analyzed");
	const unavailable = editorScoreStateCopy({ scoringEnabled: true, scoringUnknown: false, storedUnavailable: true });
	assert.equal(unavailable.heading, "Saved score unavailable");
	assert.doesNotMatch(`${unavailable.heading} ${unavailable.detail}`, /Not analyzed|No saved analysis yet/,
		"a stored score that could not be read is never shown as never analyzed");
	assert.match(unavailable.detail, /unknown/);
	assert.deepEqual(editorScoreStateCopy({ scoringEnabled: true, scoringUnknown: false, storedUnavailable: false }).heading, "Not analyzed",
		"control: a readable absence is not analyzed");
	assert.equal(editorScoreStateCopy({ scoringEnabled: false, scoringUnknown: true, storedUnavailable: true }).heading, "SEO settings unavailable");
	assert.deepEqual(editorScoreStateCopy({ scoringEnabled: false, scoringUnknown: false, storedUnavailable: false }),
		{ heading: "Not analyzed", detail: "Analyze this entry to store a result. Automatic analysis stays paused." });
	assert.equal(editorScoreStateCopy({ scoringEnabled: false, scoringUnknown: true, settingsUnavailable: true, storedUnavailable: false }).heading, "SEO settings unavailable",
		"an unreadable policy stays unavailable even when values were retained");
	assert.equal(editorScoreStateCopy({ scoringEnabled: true, scoringUnknown: false, storedUnavailable: false, profileRequired: true }).heading, "Choose an assessment profile");
	assert.equal(editorScoreStateCopy({ scoringEnabled: false, scoringUnknown: false, storedUnavailable: false, profileRequired: true }).heading, "Choose an assessment profile");
	assert.match(editorScoreStateCopy({ scoringEnabled: true, scoringUnknown: false, storedUnavailable: false, profileUnavailable: true }).detail, /Previous results remain available/);
	for (const error of ["activation_required", "profile_required", "profile_unavailable"] as const) {
		const notice = savedAnalysisNotice({ ...answer, success: false, error });
		assert.equal(notice.tone, "error");
		assert.match(notice.message, /No result was stored|no analysis result was stored/);
	}
	assert.match(savedAnalysisRequestFailureNotice(true).message, /administrator access/);
	assert.match(savedAnalysisRequestFailureNotice(false).message, /unknown whether a result was stored/);
	const manualOnly = savedAnalysisNotice({ ...v2Result, history: "not-attempted" }, "saved-v2");
	assert.equal(manualOnly.tone, "success");
	assert.match(manualOnly.message, /Score history was not updated/);
	const summary = storedScoreSummary({ ...measuredScore, keywords: ["sourdough", "bread"], pillar: true });
	const measuredDisplay = seoScoreDisplay(measuredScore);
	assert.notEqual(measuredDisplay.score, null);
	assert.equal(summary.label, `Last saved SEO score: ${measuredDisplay.score}/100, ${measuredDisplay.label}.`);
	assert.equal(summary.keywords, "Keywords saved with this score: sourdough, bread. Saved as pillar content.");
	const earlierSummary = storedScoreSummary({ ...score, scoreVersion: 1, keywords: [] } as any).label;
	assert.equal(earlierSummary, "Last saved SEO result: Earlier analyzer. Analyze again.");
	assert.doesNotMatch(earlierSummary, /\d+\/100/, "an earlier analyzer never renders a number");
	assert.equal(storedScoreSummary(templateScore).label, "Last saved SEO result: Partially checked.");
	assert.equal(storedScoreSummary(mixedCountScore).label, "Last saved SEO result: Too little text to score.");
	assert.equal(storedScoreSummary({ ...mixedCountScore, keywords: [] }).keywords, "No keywords were saved with this score.");
}

const manualReady = {
	settingsReady: true, assessmentReady: true, assessmentConfigured: true, assessmentDirty: false,
	profileReady: true, keywordDirty: false, keywordSaving: false, savedTargetReady: true,
};
assert.deepEqual(editorManualAnalysisState(manualReady), { admitted: true, detail: null });
for (const [field, value, expected] of [
	["settingsReady", false, /saved SEO settings/],
	["assessmentReady", false, /assessment profile/],
	["assessmentConfigured", false, /Choose and save/],
	["assessmentDirty", true, /Save or reset/],
	["profileReady", false, /saved focus keywords/],
	["keywordDirty", true, /keyword changes to save/],
	["keywordSaving", true, /keyword changes to save/],
	["keywordUnconfirmed", true, /Reload saved focus keywords/],
	["savedTargetReady", false, /current language/],
] as const) {
	const state = editorManualAnalysisState({ ...manualReady, [field]: value });
	assert.equal(state.admitted, false, field);
	assert.match(state.detail!, expected, field);
}
assert.match(editorManualAnalysisState({ ...manualReady, keywordUnconfirmed: true, keywordSaving: true }).detail!, /keyword changes to save/,
	"a live write must settle before a saved-profile reload can confirm it");

// Tab past either end of the Edit SEO dialog wraps to the other end instead of reaching a focus guard.
{
	const order = ["General", "Desktop", "Title", "Check saved SEO fields", "Close"];
	assert.equal(dialogTabWrapTarget(order, "Close", false), "General");
	assert.equal(dialogTabWrapTarget(order, "General", true), "Close");
	for (const active of ["Desktop", "Title", "Check saved SEO fields"]) {
		assert.equal(dialogTabWrapTarget(order, active, false), null, active + " keeps the browser order");
		assert.equal(dialogTabWrapTarget(order, active, true), null);
	}
	assert.equal(dialogTabWrapTarget(order, "Close", true), null);
	assert.equal(dialogTabWrapTarget(order, null, false), null, "focus outside the list keeps the browser order");
	assert.equal(dialogTabWrapTarget([], "Close", false), null);
	assert.equal(dialogTabWrapTarget(["Close"], "Close", false), "Close", "a single control keeps focus");
	for (const part of ['button:not([disabled])', '[tabindex]:not([tabindex="-1"])', 'textarea:not([disabled])', 'a[href]'])
		assert.ok(DIALOG_TABBABLE_SELECTOR.includes(part), part);
}
