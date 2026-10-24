import { bindContentAnalysis, checkContentAnalysisOptions } from "../content-body-mapping.ts";
import assert from "node:assert/strict";
import {
	SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_OUTPUT_SUPPORT,
	SEO_ADMIN_OWNERSHIP_FIELDS,
	SEO_ENGINE_VERSION,
	type SeoAdminAnalysisProfile,
	type SeoAdminEntryPreview,
} from "../admin-contract.ts";
import { aggregateSeoChecks, analyzeSeoContent, seoContentCheckProblem, seoScoreDisplay } from "../analysis.ts";
import { presentSeoChecks } from "../check-presentation.ts";
import { extractSeoDocumentText } from "../document-signals.ts";
import { contentBodyValue, contentImageInputs, featuredImageFromContentData, keywordFromContent } from "../content-analysis-inputs.ts";
import seoRuntime, { createSeoEngine } from "../sandbox-entry.ts";
import { completeContentItemAnalysis, prepareContentItemAnalysis } from "../entry-analysis-runtime.ts";
import { GLOBAL_SETTINGS_KEY } from "../settings-runtime.ts";
import { defaultSettingsValues } from "../settings-state.ts";
import { collectionAnalysisProfileKey } from "../collection-analysis-profile.ts";
import { parseSeoAdminEntryPreviewResult } from "./contract.ts";
import { createSavedContentSnapshot } from "./saved-content-snapshot.ts";
import { createSerpPreviewModel } from "./serp-preview-model.ts";
import { seoSnippetCutPoint, seoSnippetDatePrefix, seoSnippetFit, type SeoSnippetDeviceFit } from "../snippet-fit.ts";
import type { FittedSnippetText } from "../snippet-metrics.ts";
import {
	resolveEditorBasicAnalysis,
	resolveEditorBasicKeywordOwnership,
	type EditorBasicAnalysisInput,
} from "./editor-basic-analysis.ts";

const ref = "posts:basic-example";
const saved = {
	id: "basic-example", slug: "bread-guide", updatedAt: "2026-10-17T10:00:00.000Z",
	data: {
		title: "A practical bread guide",
		focus_keyword: "bread",
		content: [{ _type: "block", style: "normal", children: [{ _type: "span", text: "Bread is made with flour and water. This saved paragraph explains the method." }] }],
		featured_image: { src: "https://example.test/bread.jpg", alt: "A loaf of bread" },
	},
	seo: { title: "A practical bread guide", description: "Learn to make bread with flour and water.", noIndex: false },
};
const snapshot = createSavedContentSnapshot(ref, saved);
const preview: SeoAdminEntryPreview = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, generatedAt: saved.updatedAt,
	sourceKind: "saved-snapshot", sourceVersion: snapshot.sourceVersion,
	content: { ref, entryId: saved.id, collection: "posts", collectionLabel: "Posts", title: saved.data.title, slug: saved.slug },
	search: { title: saved.seo.title, description: saved.seo.description, url: "https://example.test/bread-guide",
		titleLength: saved.seo.title.length, descriptionLength: saved.seo.description.length },
	social: { title: saved.seo.title, description: saved.seo.description, image: "https://example.test/bread.jpg",
		fallbackTitle: saved.seo.title, fallbackDescription: saved.seo.description,
		override: { title: null, description: null, updatedAt: null },
		editing: { state: "ready", snapshot: { ref, revision: null, override: null } } },
	indexable: true, entryNoindex: false,
	canonicalValidation: { status: "matches", canonical: "https://example.test/bread-guide", expectedPath: "/bread-guide" },
	localeGraph: { owner: "emdash-core", emitsMarkup: false, status: "single-locale", hostSupportsTranslationGroups: false,
		currentLocale: "en", defaultLocale: "en", translationGroup: null, discoveredLocales: ["en"], alternates: [], xDefaultLocale: "en", issues: [] },
	schemaTypes: ["BlogPosting"],
	sources: { title: "core-seo", description: "core-seo", socialTitle: "core-seo", socialDescription: "core-seo", canonical: "generated", image: "content" },
	outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
	ownership: {
		status: "current", reason: null, sourceVersion: snapshot.sourceVersion, locale: "en", record: null,
		fields: SEO_ADMIN_OWNERSHIP_FIELDS.map((field) => ({
			field, state: "not-shadowed", core: field === "noIndex" ? false : null, legacy: null,
			effective: field === "noIndex" ? false : null, effectiveSource: "core-seo", social: null,
		})),
		unsupportedDirectives: { state: "none", tokens: [] },
	},
};
const input: EditorBasicAnalysisInput = {
	preview, snapshot, ref, sourceVersion: snapshot.sourceVersion, locale: "en",
	profile: null, profileReady: true,
	assessment: { state: "configured", collection: "posts", revision: "general-profile", profile: "general", version: 1 }, assessmentReady: true,
	publicationStatus: "published",
};
function ready(patch: Partial<EditorBasicAnalysisInput> = {}) {
	const result = resolveEditorBasicAnalysis({ ...input, ...patch });
	if (result.state !== "ready") throw new Error(result.reason);
	return result;
}
function check(id: string, patch: Partial<EditorBasicAnalysisInput> = {}) {
	const found = ready(patch).result.checks.find((item) => item.id === id);
	assert.ok(found, id);
	return found;
}
const before = JSON.stringify(input);
const basic = ready();
assert.equal(basic.profileSource, "configured");
assert.equal(basic.profileLabel, "General content");
assert.deepEqual(basic.result.assessmentProfile, { profile: "general", version: 1 });
assert.equal(basic.result.score, aggregateSeoChecks(basic.result.checks).score);
assert.equal(check("title").status, "pass");
assert.equal(check("content-depth").basis, "measured");
assert.equal(check("featured-image").basis, "not-applicable");
assert.deepEqual(basic.keywordOwnership, { display: ["bread"], inherited: true });
for (const property of ["persistence", "freshness", "analysisRevision", "configurationFingerprint", "updatedAt"]) {
	assert.equal(Object.hasOwn(basic.result, property), false, "Local results carry no server score proof: " + property);
}
assert.equal(JSON.stringify(input), before, "Pure local checks do not change saved inputs or configuration");

// Opening an unconfigured post computes Article checks without saving a collection profile.
const shortProse = "Bread preparation starts with a clean work surface and a clear recipe. Measure the ingredients before mixing so each step is easy to follow. Bread dough needs time to rest before shaping. Keep notes about temperature and timing for the next batch. Allow the bread to cool before slicing, then store it carefully and share the result with friends at the table today.".split(" ").slice(0, 63).join(" ");
assert.equal(shortProse.split(" ").length, 63);
const shortSnapshot = createSavedContentSnapshot(ref, { ...saved, data: { ...saved.data,
	content: [{ _type: "block", style: "normal", children: [{ _type: "span", text: shortProse }] }],
} });
const shortInput: EditorBasicAnalysisInput = { ...input, snapshot: shortSnapshot, sourceVersion: shortSnapshot.sourceVersion,
	preview: { ...preview, sourceVersion: shortSnapshot.sourceVersion, ownership: { ...preview.ownership!, sourceVersion: shortSnapshot.sourceVersion } },
	assessment: { state: "unconfigured", collection: "posts", revision: null },
};
const unconfiguredBefore = JSON.stringify(shortInput);
const unconfigured = ready(shortInput);
assert.equal(unconfigured.profileSource, "default");
assert.equal(unconfigured.profileLabel, "Article");
assert.deepEqual(unconfigured.result.assessmentProfile, { profile: "article", version: 1 });
assert.equal(unconfigured.result.metrics.wordCount, 63);
assert.ok(unconfigured.result.checks.some((check) => check.id === "keyword-title" && check.basis === "heuristic"));
assert.ok(unconfigured.result.checks.some((check) => check.id === "keyword-content" && check.basis === "heuristic"));
assert.ok(typeof seoScoreDisplay(unconfigured.result).score === "number", "opening a post shows a browser score without profile setup");
assert.ok(unconfigured.result.score <= 70, "the default Article retains the short-content cap");
assert.equal(unconfigured.result.checks.find((check) => check.id === "keyword-repetition")?.basis, "not-applicable", "a short sample receives no density penalty");
for (const schemaTypes of [[], ["WebPage"], ["BlogPosting"]]) {
	const result = ready({ ...shortInput, preview: { ...shortInput.preview!, schemaTypes } });
	assert.equal(result.profileLabel, "Article", "the posts default is independent of schema output");
	assert.deepEqual(result.result.assessmentProfile, unconfigured.result.assessmentProfile);
}
for (const collection of ["pages", "services", "articles"]) {
	const otherRef = collection + ":" + saved.id;
	const otherSnapshot = createSavedContentSnapshot(otherRef, { ...saved, data: shortSnapshot.data });
	const otherInput: EditorBasicAnalysisInput = { ...shortInput, ref: otherRef, snapshot: otherSnapshot, sourceVersion: otherSnapshot.sourceVersion,
		preview: { ...shortInput.preview!, sourceVersion: otherSnapshot.sourceVersion,
			content: { ...preview.content, ref: otherRef, collection, collectionLabel: "Posts" },
			ownership: { ...preview.ownership!, sourceVersion: otherSnapshot.sourceVersion }, schemaTypes: ["Article", "BlogPosting"] },
		assessment: { state: "unconfigured", collection, revision: null } };
	const beforeDefault = JSON.stringify(otherInput);
	const result = ready(otherInput);
	assert.equal(result.profileSource, "default");
	assert.equal(result.profileLabel, "General content", collection + " uses General despite its label or schema output");
	assert.deepEqual(result.result.assessmentProfile, { profile: "general", version: 1 });
	assert.equal(typeof seoScoreDisplay(result.result).score, "number", collection + " opens without mandatory profile setup");
	const explicit = ready({ ...otherInput, assessment: { state: "configured", collection, revision: "article-profile", profile: "article", version: 1 } });
	assert.equal(explicit.profileSource, "configured");
	assert.equal(explicit.profileLabel, "Article", "a saved profile overrides the collection default");
	assert.equal(JSON.stringify(otherInput), beforeDefault, "a default is never persisted by basic checks");
}
assert.equal(JSON.stringify(shortInput), unconfiguredBefore, "Basic checks never configure a profile or change saved inputs");
const shortGeneral = ready({ ...shortInput, assessment: input.assessment });
assert.equal(shortGeneral.profileLabel, "General content");
assert.deepEqual(shortGeneral.result.assessmentProfile, { profile: "general", version: 1 });
assert.equal(typeof shortGeneral.result.score, "number", "General is an explicit valid profile for a short page");
const shortArticle = ready({ ...shortInput, assessment: { state: "configured", collection: "posts", revision: "article-profile", profile: "article", version: 1 } });
assert.equal(shortArticle.profileLabel, "Article");
assert.ok(shortArticle.result.score <= 70, "A 63-word Article cannot claim a near-complete score");
assert.deepEqual(unconfigured.result.checks, shortArticle.result.checks, "the default uses the same Article policy as an explicit selection");
assert.deepEqual(unconfigured.result.calculation, shortArticle.result.calculation);

const profile: SeoAdminAnalysisProfile = {
	storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION, ref, keyword: "water", keywords: ["water"], pillar: false, updatedAt: saved.updatedAt,
};
assert.deepEqual(ready({ profile }).keywordOwnership, { display: ["water"], inherited: false });
assert.deepEqual(ready({ profile, keywords: [] }).keywordOwnership, { display: [], inherited: false });
assert.deepEqual(ready({ profile, keywords: null }).keywordOwnership, { display: ["bread"], inherited: true });
assert.equal(check("keyword-title", { keywords: ["bread"] }).status, "pass");
assert.equal(check("keyword-title", { keywords: ["unmentioned phrase"] }).status, "fail", "a set keyword missing from the title fails its row");
const configured = ready({ assessment: { state: "configured", collection: "posts", profile: "article", version: 1, revision: "selected-profile" } });
assert.equal(configured.profileSource, "configured");
assert.equal(configured.profileLabel, "Article");
assert.equal(configured.result.checks.find((item) => item.id === "featured-image")?.basis, "measured");
// The featured image is an image field, not a body image, so it has no alt check in any settings state.
for (const imageSeoEnabled of [undefined, false, true]) assert.equal(check("image-alt-text", { imageSeoEnabled }).basis, "not-applicable");
const bodyImageSnapshot = createSavedContentSnapshot(ref, { ...saved, data: { ...saved.data,
	content: [...saved.data.content, { _type: "image", _key: "body-image", asset: { _ref: "media:loaves" }, alt: "Shaped loaves" }] } });
const bodyImage = { snapshot: bodyImageSnapshot, sourceVersion: bodyImageSnapshot.sourceVersion,
	preview: { ...preview, sourceVersion: bodyImageSnapshot.sourceVersion, ownership: { ...preview.ownership!, sourceVersion: bodyImageSnapshot.sourceVersion } } };
assert.equal(check("image-alt-text", bodyImage).basis, "unavailable", "Unknown feature settings are not reported as disabled");
assert.equal(check("image-alt-text", { ...bodyImage, imageSeoEnabled: false }).basis, "not-applicable");
assert.equal(check("image-alt-text", { ...bodyImage, imageSeoEnabled: true }).basis, "measured");
const noSchema = ready({ preview: { ...preview, schemaTypes: [] } });
const schema = noSchema.result.checks.find((item) => item.id === "schema")!;
assert.equal(schema.basis, "unavailable", "an older server's preview cannot tell a missing schema from an unread one");
assert.equal(schema.weight, 0);
assert.equal(noSchema.result.score, aggregateSeoChecks(noSchema.result.checks).score);

// Settings sent with the entry preview replace the older-server fallbacks.
const settings = { imageAltChecks: true, schemaOutput: true, nosnippet: false, descriptionGenerated: false };
const withSettings = (analysis: Partial<typeof settings> = {}, patch: Partial<SeoAdminEntryPreview> = {}) =>
	({ preview: { ...preview, ...patch, analysis: { ...settings, ...analysis } } });
const bodyImageWithSettings = (analysis: Partial<typeof settings> = {}) =>
	({ ...bodyImage, preview: { ...bodyImage.preview, analysis: { ...settings, ...analysis } } });
assert.equal(check("image-alt-text", bodyImageWithSettings()).basis, "measured", "the preview's image setting is used");
assert.equal(check("image-alt-text", { ...bodyImageWithSettings({ imageAltChecks: false }), imageSeoEnabled: true }).basis, "not-applicable",
	"the preview's setting outranks the editor prop");
const noImages = { ...snapshot, data: { ...snapshot.data, featured_image: undefined } };
assert.equal(check("image-alt-text", { snapshot: noImages }).basis, "not-applicable",
	"with no images the engine's own not-applicable row stands even when the setting is unknown");
assert.equal(check("image-alt-text", { snapshot: noImages }).detail, "No images in the body text.");
assert.equal(check("image-alt-text", { ...withSettings(), snapshot: noImages }).basis, "not-applicable");
const declaredNoSchema = ready(withSettings({ schemaOutput: true }, { schemaTypes: [] }));
const declaredSchema = declaredNoSchema.result.checks.find((item) => item.id === "schema")!;
assert.deepEqual([declaredSchema.basis, declaredSchema.status], ["measured", "review"], "a known schema setting keeps the server's Suggestion");
assert.equal(ready(withSettings({ schemaOutput: false }, { schemaTypes: [] })).result.checks.find((item) => item.id === "schema")?.basis, "measured");
assert.equal(check("description-display-length", withSettings({ nosnippet: true })).basis, "not-applicable", "nosnippet removes description fit");
const generated = check("description-display-length", withSettings({ descriptionGenerated: true }));
assert.deepEqual([generated.status, generated.recommendation], ["review", "Write a description for this page."]);
const siteImage = ready(withSettings({}, { sources: { ...preview.sources, image: "site-default" } }));
assert.equal(siteImage.result.checks.find((item) => item.id === "social-image-fallback")?.status, "review", "the image source reaches the browser checks");
assert.equal(ready({ preview: { ...preview, sources: { ...preview.sources, image: "site-default" } } }).result.checks.some((item) => item.id === "social-image-fallback"), false,
	"an older server's preview leaves the image source unknown");

// Production browser checks: with the preview settings, the browser rows and number are the server's for a default body.
const articleAssessment = { state: "configured" as const, collection: "posts", profile: "article" as const, version: 1 as const, revision: "selected-profile" };
const browser = ready({ ...withSettings(), assessment: articleAssessment, keywords: ["bread"] });
const server = analyzeSeoContent({
	ref, collection: "posts", entryId: saved.id, slug: saved.slug, title: preview.search.title, titleSource: preview.sources.title,
	description: preview.search.description, descriptionSource: preview.sources.description, url: preview.search.url,
	canonicalStatus: preview.canonicalValidation.status, image: preview.social.image ?? undefined, imageSource: preview.sources.image,
	featuredImage: featuredImageFromContentData(saved.data), noindex: false, noindexSources: [], nosnippet: false,
	publicationStatus: "published", body: extractSeoDocumentText(contentBodyValue(saved.data, null)), document: contentBodyValue(saved.data, null),
	contentImages: contentImageInputs(saved.data), focusKeywords: ["bread"], assessmentProfile: { profile: "article", version: 1 },
	schemaEnabled: true, schemaPreset: "BlogPosting", imageSeoEnabled: true,
});
assert.deepEqual(browser.result.checks, server.checks, "the same rows");
assert.deepEqual([browser.result.score, browser.result.calculation], [server.score, server.calculation], "the same number and calculation");
assert.deepEqual(seoScoreDisplay(browser.result), seoScoreDisplay(server));
assert.deepEqual(presentSeoChecks(browser.result), presentSeoChecks(server), "the same groups, pills and rows");
assert.notEqual(seoScoreDisplay(browser.result).score, null, "production browser checks show a number");

// The preview's noindex sources reach the browser row, so it names the same rule as the saved analysis.
for (const noindexSources of [["content-type-rule"], ["site-setting", "content-type-rule"], ["content-type-rule", "entry-seo"]] as const) {
	const ruledPreview = { ...preview, indexable: false, entryNoindex: (noindexSources as readonly string[]).includes("entry-seo"), noindexSources: [...noindexSources] };
	const browserRow = ready({ preview: ruledPreview }).result.checks.find((item) => item.id === "indexability")!;
	const serverRow = analyzeSeoContent({ ref, collection: "posts", entryId: saved.id, slug: saved.slug,
		title: preview.search.title, description: preview.search.description, url: preview.search.url, noindex: true,
		noindexSources: [...noindexSources], publicationStatus: "published", body: "", assessmentProfile: { profile: "general", version: 1 },
		schemaEnabled: false, schemaPreset: "None", imageSeoEnabled: true }).checks.find((item) => item.id === "indexability")!;
	assert.equal(browserRow.detail, serverRow.detail, "the browser row names the same sources: " + noindexSources.join(", "));
	assert.match(browserRow.detail, /the content type rule in Indexing rules/);
}
const olderServer = ready({ preview: { ...preview, indexable: false, entryNoindex: true } }).result.checks.find((item) => item.id === "indexability")!;
assert.match(olderServer.detail, /noindex from this entry's SEO settings|marked noindex by this entry's SEO settings/, "a preview without sources keeps the entry fallback");

const customSnapshot = { ...snapshot, data: { body: saved.data.content, description: "This is metadata, not body evidence." } };
const unknownBody = ready({ snapshot: customSnapshot, keywords: ["bread", "water"], imageSeoEnabled: true });
for (const id of ["content-depth", "heading-structure", "internal-links", "keyword-content", "secondary-keyword-coverage", "image-alt-text"]) {
	assert.equal(unknownBody.result.checks.find((item) => item.id === id)?.basis, "unavailable", id + " does not invent missing custom-body evidence");
}
assert.equal(unknownBody.result.metrics.wordCount, 0);
assert.equal(check("content-depth", { snapshot: { ...snapshot, data: { content: [] } } }).basis, "measured", "A supported empty saved body differs from an unknown field");
assert.equal(check("content-depth", { snapshot: { ...snapshot, data: { ...snapshot.data, body_source: "template" } } }).basis, "unavailable");

for (const patch of [
	{ preview: null },
	{ snapshot: null },
	{ sourceVersion: "another-version" },
	{ snapshot: { ...snapshot, ref: "posts:other" } },
	{ preview: { ...preview, sourceVersion: "another-version" } },
	{ preview: { ...preview, sourceKind: undefined } },
	{ preview: { ...preview, content: { ...preview.content, ref: "posts:other" } } },
	{ locale: "nl" },
	{ preview: { ...preview, ownership: undefined } },
	{ preview: { ...preview, ownership: { ...preview.ownership!, status: "unknown" as const } } },
	{ profileReady: false },
	{ profile: { ...profile, ref: "posts:other" } },
	{ assessmentReady: false },
	{ assessment: null },
	{ assessment: { state: "unavailable" as const, collection: "posts" } },
	{ assessment: { state: "unconfigured" as const, collection: "pages", revision: null } },
] satisfies Partial<EditorBasicAnalysisInput>[]) {
	assert.equal(resolveEditorBasicAnalysis({ ...input, ...patch }).state, "unavailable", JSON.stringify(patch));
}
for (const field of SEO_ADMIN_OWNERSHIP_FIELDS) {
	const ownership = { ...preview.ownership!, fields: preview.ownership!.fields.map((item) =>
		item.field === field ? { ...item, state: "unknown" as const, reason: "legacy-read-incomplete" as const } : item) };
	assert.equal(resolveEditorBasicAnalysis({ ...input, preview: { ...preview, ownership } }).state, "unavailable",
		"Current entry identity does not establish readable " + field + " metadata");
}
assert.equal(resolveEditorBasicKeywordOwnership({ ...input, snapshot: null }), null);
assert.deepEqual(resolveEditorBasicKeywordOwnership({ ...input, snapshot: null, keywords: ["explicit"] }), { display: ["explicit"], inherited: false });
assert.deepEqual(resolveEditorBasicKeywordOwnership({ ...input, keywords: [] }), { display: [], inherited: false });
assert.equal(resolveEditorBasicKeywordOwnership({ ...input, profileReady: false }), null);

assert.equal(contentBodyValue({ content: "" }, { portableTextBodyField: "body" }), "");
assert.equal(contentBodyValue({ body: saved.data.content }, null), undefined);
assert.equal(contentBodyValue({ body: saved.data.content }, { portableTextBodyField: "body" }), saved.data.content);
assert.equal(featuredImageFromContentData(saved.data), saved.data.featured_image.src);
assert.equal(contentImageInputs(saved.data).length, 1);
assert.equal(keywordFromContent({ focus_keyword: "first", focusKeyword: "second", seo: { focusKeyword: "third" } }, { seo: { focusKeyword: "fourth" } }), "first");


const { seo: _coreSeo, ...withoutCoreSeo } = saved;
const noCoreSnapshot = createSavedContentSnapshot(ref, withoutCoreSeo);
const noCoreOwnership: NonNullable<SeoAdminEntryPreview["ownership"]> = {
	...preview.ownership!, status: "unknown", reason: "core-seo-unavailable", sourceVersion: noCoreSnapshot.sourceVersion,
	fields: preview.ownership!.fields.map((field) => ({ ...field, state: "unknown" as const, reason: "core-seo-unavailable" as const })),
};
const noCorePreview = { ...preview, sourceVersion: noCoreSnapshot.sourceVersion, ownership: noCoreOwnership };
const partialInput: EditorBasicAnalysisInput = {
	...input, snapshot: noCoreSnapshot, sourceVersion: noCoreSnapshot.sourceVersion, preview: noCorePreview,
};
const partial = resolveEditorBasicAnalysis(partialInput);
if (partial.state !== "partial") throw new Error("Expected observed body checks with unavailable core SEO");
assert.equal(partial.profileSource, "configured");
assert.equal(partial.reason, "Core SEO metadata is unavailable. These checks cover observed saved body and keywords.");
assert.deepEqual(partial.result.assessmentProfile, { profile: "general", version: 1 });
const unconfiguredMetadata = resolveEditorBasicAnalysis({ ...partialInput, assessment: { state: "unconfigured", collection: "posts", revision: null } });
if (unconfiguredMetadata.state !== "partial") throw new Error("Unknown metadata remains a partial checklist");
assert.equal(unconfiguredMetadata.reason, partial.reason, "An unconfigured profile does not hide the metadata limitation");
assert.equal(unconfiguredMetadata.profileSource, "default");
assert.deepEqual(unconfiguredMetadata.result.assessmentProfile, { profile: "article", version: 1 });
assert.equal(Object.hasOwn(unconfiguredMetadata.result, "score"), false, "a default profile cannot repair unknown metadata");
assert.equal(partial.result.title, "");
assert.equal(partial.result.url, "");
assert.ok(partial.result.metrics.wordCount > 0);
assert.equal(partial.result.checks.find((item) => item.id === "content-depth")?.basis, "measured");
assert.equal(partial.result.checks.find((item) => item.id === "keyword-content")?.status, "pass");
assert.equal(partial.result.checks.find((item) => item.id === "keyword-url")?.status, "pass", "The exact saved slug is independent of canonical metadata");
for (const property of ["score", "status", "grade", "calculation", "coverage", "persistence", "freshness"]) {
	assert.equal(Object.hasOwn(partial.result, property), false, "A partial checklist has no numeric or stored summary: " + property);
}
for (const check of partial.result.checks) {
	assert.equal(seoContentCheckProblem(check, true), null, check.id + " retains the shared check evidence contract");
	if (["metadata", "indexability", "social", "schema", "links"].includes(check.category) ||
		["keyword-title", "keyword-title-position", "keyword-description", "secondary-keyword-coverage"].includes(check.id)) {
		assert.equal(check.basis, "unavailable", check.id);
		assert.equal(check.status, "review", check.id + " is neither a false pass nor a failure");
		assert.equal(check.weight, 0, check.id);
		assert.equal(check.evidence.actual, null, check.id);
		assert.equal(check.condition, undefined, check.id + " cannot retain an unverified exclusion");
	}
}
const restrictedPartial = resolveEditorBasicAnalysis({ ...partialInput, preview: { ...noCorePreview, indexable: false, entryNoindex: true } });
if (restrictedPartial.state !== "partial") throw new Error("Expected unknown indexing evidence");
const unknownIndexing = restrictedPartial.result.checks.find((item) => item.id === "indexability")!;
assert.equal(unknownIndexing.basis, "unavailable");
assert.equal(unknownIndexing.evidence.actual, null);
assert.equal(unknownIndexing.condition, undefined);
const noCoreEmpty = resolveEditorBasicAnalysis({ ...partialInput, snapshot: { ...noCoreSnapshot, data: { content: [] } }, keywords: [] });
assert.equal(noCoreEmpty.state, "partial", "A tiny or empty body still has an honest checklist without a fabricated score");
for (const reason of ["saved-version-unavailable", "core-seo-invalid", "snapshot-seo-mismatch"] as const) {
	assert.equal(resolveEditorBasicAnalysis({ ...partialInput, preview: {
		...noCorePreview, ownership: { ...noCoreOwnership, reason },
	} }).state, "unavailable", reason + " does not bypass the metadata guard");
}
assert.equal(resolveEditorBasicAnalysis({ ...partialInput, snapshot }).state, "unavailable", "The exception requires actual absent core SEO");
assert.equal(resolveEditorBasicAnalysis({ ...partialInput, locale: "nl" }).state, "unavailable");
assert.equal(resolveEditorBasicAnalysis({ ...partialInput, sourceVersion: "another-version" }).state, "unavailable");

// Description fit measures the publication date the preview shows before the description.
{
	const publishedAt = "2026-10-18T09:00:00.000Z";
	const prefix = seoSnippetDatePrefix(publishedAt, "en");
	assert.equal(prefix, "Oct 18, 2026 \u2014 ");
	const words = "Learn to make bread with flour, water, salt and a slow rise that fits around a working day at home".split(" ");
	let description = "";
	for (let index = 0; !seoSnippetFit(description, "description", prefix).some((fit) => fit.clipped); index += 1)
		description = [description, words[index % words.length]].filter(Boolean).join(" ");
	assert.ok(!seoSnippetFit(description, "description").some((fit) => fit.clipped), "control: only the date makes this description too long");
	const datedPreview = { ...preview, search: { ...preview.search, description, descriptionLength: description.length, publishedAt } };
	const row = ready({ preview: datedPreview }).result.checks.find((item) => item.id === "description-display-length");
	assert.ok(row && row.status === "review", "the dated description may be cut");
	for (const device of ["mobile", "desktop"] as const) {
		const fitted: FittedSnippetText = createSerpPreviewModel({ device, datePrefix: prefix, saved: {
			title: { value: preview.search.title, source: "core-seo" }, description: { value: description, source: "core-seo" },
			permalink: { value: preview.search.url, source: "generated" }, canonical: { value: preview.search.url, source: "generated" },
		} }).fittedDescription;
		const fit: SeoSnippetDeviceFit = seoSnippetFit(description, "description", prefix).find((item) => item.device === device)!;
		assert.equal(fit.clipped, fitted.clipped, device + ": the row and the preview agree on the cut");
		if (fit.clipped) {
			assert.equal(fit.visible, fitted.text.replace(/\u2026$/u, "").trimEnd(), device + ": the row quotes the preview's own cut");
			assert.ok(row.detail.includes(`"${seoSnippetCutPoint(fit.visible)}"`), device + ": the detail names that cut point");
		}
	}
	const undated = ready({ preview: { ...datedPreview, search: { ...datedPreview.search, publishedAt: null } } });
	assert.equal(undated.result.checks.find((item) => item.id === "description-display-length")?.status, "pass", "without a date the same text fits");
}

// The server's own runtime preparation and the browser checks built from the server's preview agree
// for each saved default-body entry: the same rows, number and calculation.
{
	const paragraph = (key: string, text: string, markDefs: unknown[] = [], children?: unknown[]) =>
		({ _type: "block", _key: key, style: "normal", markDefs, children: children ?? [{ _type: "span", text, marks: [] }] });
	const runtimeItem = {
		id: "runtime-default", type: "posts", slug: "sourdough-bread-guide", status: "published", locale: "en",
		seo: { title: "Sourdough bread guide for home bakers", description: "Learn sourdough bread with a lively starter, a slow rise and a hot oven for a crisp crust.",
			image: null, canonical: null, noIndex: false },
		data: {
			title: "Sourdough bread guide",
			content: [
				{ _type: "block", _key: "heading", style: "h2", markDefs: [], children: [{ _type: "span", text: "Sourdough bread basics", marks: [] }] },
				paragraph("intro", "", [{ _key: "starter", _type: "link", href: "/blog/starter-care" }], [
					{ _type: "span", text: "Sourdough bread starts with a lively starter, so read ", marks: [] },
					{ _type: "span", text: "how to keep a starter healthy", marks: ["starter"] },
					{ _type: "span", text: " before mixing.", marks: [] },
				]),
				{ _type: "image", _key: "loaf", asset: { _ref: "media:loaf" }, alt: "A sourdough loaf cooling on a rack" },
				...Array.from({ length: 30 }, (_, index) => paragraph("step-" + index,
					"Sourdough bread rises slowly, so plan the mixing, shaping and baking across one calm day at home.")),
			],
			featured_image: { src: "https://example.com/media/sourdough.jpg", alt: "A sourdough loaf" },
		},
		createdAt: "2026-10-16T09:00:00.000Z", updatedAt: "2026-10-17T10:00:00.000Z", publishedAt: "2026-10-17T10:00:00.000Z",
	};
	// A short paragraph and a custom block the extractor does not read, with no body images.
	const customBlockItem = {
		...runtimeItem, id: "runtime-custom-block", slug: "sourdough-starter-notes",
		seo: { title: "Sourdough starter notes", description: "Feed a sourdough starter twice a day and keep it in a warm kitchen.",
			image: "https://example.com/media/starter.jpg", canonical: null, noIndex: false },
		data: {
			title: "Sourdough starter notes",
			content: [
				paragraph("short", "Feed the sourdough starter twice a day and keep it in a warm kitchen until it doubles."),
				{ _type: "callout", _key: "cb1", tone: "info", body: "Discard half of the starter before each feeding." },
			],
		},
	};
	let analysed: { id: string; slug: string } = runtimeItem;
	const kv = new Map<string, unknown>([
		[GLOBAL_SETTINGS_KEY, { ...defaultSettingsValues({ siteName: "Bakery", siteUrl: "https://example.com" }), version: 1,
			updatedAt: "2026-10-15T00:00:00.000Z", contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1 }],
		[collectionAnalysisProfileKey("posts"), { version: 1, profile: "article", updatedAt: "2026-10-15T00:00:00.000Z" }],
	]);
	const stores = new Map<string, Map<string, unknown>>();
	const store = (name: string) => {
		const values = stores.get(name) ?? new Map<string, unknown>();
		stores.set(name, values);
		return {
			get: async (id: string) => structuredClone(values.get(id) ?? null),
			put: async (id: string, value: unknown) => { values.set(id, structuredClone(value)); },
			delete: async (id: string) => values.delete(id),
			deleteMany: async () => 0,
			count: async () => values.size,
			query: async () => ({ items: [], hasMore: false }),
		};
	};
	const runtimeContext: any = {
		plugin: { id: "shipit-seo", version: "test" },
		site: { name: "Bakery", url: "https://example.com" },
		schema: { listCollections: async () => [{ slug: "posts", label: "Posts", labelSingular: "Post", hasSeo: true,
			urlPattern: "/blog/{slug}", routable: true, hidden: false }] },
		kv: {
			get: async (key: string) => structuredClone(kv.get(key) ?? null),
			getVersioned: async (key: string) => kv.has(key) ? { value: structuredClone(kv.get(key)), revision: "r1" } : null,
			set: async (key: string, value: unknown) => { kv.set(key, structuredClone(value)); },
			delete: async (key: string) => kv.delete(key),
			list: async () => [],
		},
		storage: new Proxy({}, { get: (_target, name) => store(String(name)) }),
		content: {
			getPublicUrl: async (_collection: string, id: string) => id === analysed.id ? "https://example.com/blog/" + analysed.slug : null,
			get: async (_collection: string, id: string) => id === analysed.id ? structuredClone(analysed) : null,
			list: async () => ({ items: [structuredClone(analysed)], hasMore: false }),
		},
		url: (path: string) => new URL(path, "https://example.com").href,
		log: { warn() {}, info() {}, error() {}, debug() {} },
	};
	async function runtimeAnalyses(item: typeof runtimeItem | typeof customBlockItem, keywords: string[]) {
		analysed = item;
		const runtimeRef = "posts:" + item.id;
		const prepared = await prepareContentItemAnalysis(runtimeContext, "posts", structuredClone(item), keywords,
			undefined, undefined, undefined, undefined, undefined, undefined, false);
		const runtimeServer = completeContentItemAnalysis(prepared, 1);
		const runtimeSnapshot = createSavedContentSnapshot(runtimeRef, item);
		const previewResult = parseSeoAdminEntryPreviewResult(await (seoRuntime as any).routes["admin-entry-preview"].handler(
			{ input: { ref: runtimeRef, entryOnly: true, snapshot: runtimeSnapshot } }, runtimeContext));
		if (!previewResult.success) throw new Error("Expected the server's entry preview");
		const runtimeBrowser = resolveEditorBasicAnalysis({
			preview: previewResult.preview, snapshot: runtimeSnapshot, ref: runtimeRef, sourceVersion: runtimeSnapshot.sourceVersion, locale: "en",
			profile: null, profileReady: true, keywords,
			assessment: { state: "configured", collection: "posts", profile: "article", version: 1, revision: "selected-profile" }, assessmentReady: true,
			publicationStatus: item.status,
		});
		if (runtimeBrowser.state !== "ready") throw new Error("Expected ready browser checks: " + JSON.stringify(runtimeBrowser));
		return { prepared, runtimeServer, previewResult, runtimeBrowser };
	}
	const keywords = ["sourdough bread"];
	const { prepared, runtimeServer, previewResult, runtimeBrowser } = await runtimeAnalyses(runtimeItem, keywords);
	assert.deepEqual(runtimeBrowser.result.checks, runtimeServer.checks, "the same rows as the runtime-prepared analysis");
	assert.deepEqual([runtimeBrowser.result.score, runtimeBrowser.result.calculation], [runtimeServer.score, runtimeServer.calculation],
		"the same number and calculation as the runtime-prepared analysis");
	assert.deepEqual(seoScoreDisplay(runtimeBrowser.result), seoScoreDisplay(runtimeServer));
	assert.deepEqual(presentSeoChecks(runtimeBrowser.result), presentSeoChecks(runtimeServer));
	// Control: both sides measured the whole default body and the preview's own settings, not two empty inputs.
	assert.ok(previewResult.preview.analysis, "the server preview carries its analysis settings");
	assert.equal(prepared.input.body, extractSeoDocumentText(runtimeItem.data.content));
	assert.deepEqual([runtimeServer.metrics.wordCount > 300, runtimeServer.metrics.internalLinkCount, runtimeServer.metrics.imageCount], [true, 1, 2],
		JSON.stringify(runtimeServer.metrics));
	assert.notEqual(seoScoreDisplay(runtimeServer).score, null);

	// A short default body with an unread custom block and no images: the browser rows are the server's,
	// so Image alt text is not applicable on both and only the word count is Not checked.

 const mappedItem = { ...runtimeItem, data: { ...runtimeItem.data, content: [
  { _type: "article_section", _version: 1, heading: "A saved custom article", body: runtimeItem.data.content, internalNote: "Never count this private field" },
 ] } } as unknown as typeof runtimeItem;
 const mapping = checkContentAnalysisOptions({ mappings: [{ collection: "posts", bodyField: "content", blocks: [
  { type: "article_section", version: 1, fields: [ { kind: "heading", path: ["heading"], level: 2 }, { kind: "richText", path: ["body"] } ] },
 ] }] })!;
 bindContentAnalysis(runtimeContext, mapping);
 const mapped = await runtimeAnalyses(mappedItem, keywords);
 assert.equal(mapped.prepared.input.bodyIncomplete, false);
 assert.ok(mapped.prepared.input.body.includes("A saved custom article"));
 assert.ok(!mapped.prepared.input.body.includes("Never count"));
 assert.deepEqual(mapped.runtimeBrowser.result.checks, mapped.runtimeServer.checks, "mapped body rows agree across the real preview and server preparation");
 assert.deepEqual(mapped.runtimeBrowser.result.metrics, mapped.runtimeServer.metrics);
 assert.notEqual(seoScoreDisplay(mapped.runtimeBrowser.result).score, null, "known custom body produces a numeric badge");
 assert.notEqual(mapped.prepared.configurationFingerprint, prepared.configurationFingerprint, "mapping changes invalidate prior stored inputs");
 // Basic mapped checks need neither activation nor persistent work on entry open.
 kv.set(GLOBAL_SETTINGS_KEY, { ...(kv.get(GLOBAL_SETTINGS_KEY) as object), contentScoringEnabled: false });
 analysed = mappedItem;
 const mappedRef = "posts:" + mappedItem.id;
 const mappedSnapshot = createSavedContentSnapshot(mappedRef, mappedItem);
 const stateBeforeOpen = JSON.stringify([[...kv], [...stores].map(([name, values]) => [name, [...values]])]);
 const mappedEngine = createSeoEngine(undefined, { contentAnalysis: mapping });
 const openResult = parseSeoAdminEntryPreviewResult(await (mappedEngine as any).routes["admin-entry-preview"].handler(
  { input: { ref: mappedRef, entryOnly: true, snapshot: mappedSnapshot } }, runtimeContext));
 assert.equal(JSON.stringify([[...kv], [...stores].map(([name, values]) => [name, [...values]])]), stateBeforeOpen, "opening the mapped entry does not write settings, scores or history");
 assert.equal(openResult.success, true);
 if (!openResult.success) throw new Error("Expected mapped entry preview with optional analysis off");
 const openAnalysis = resolveEditorBasicAnalysis({ ...input, preview: openResult.preview, snapshot: mappedSnapshot, ref: mappedRef,
  sourceVersion: mappedSnapshot.sourceVersion, keywords, publicationStatus: mappedItem.status,
  assessment: { state: "configured", collection: "posts", profile: "article", version: 1, revision: "selected-profile" } });
 assert.equal(openAnalysis.state, "ready");
 assert.notEqual(openAnalysis.state === "ready" ? seoScoreDisplay(openAnalysis.result).score : null, null, "optional server analysis off does not suppress the local score");
 const mismatched = resolveEditorBasicAnalysis({ ...input, preview: mapped.previewResult.preview });
 assert.equal(mismatched.state, "unavailable", "a valid mapped body cannot bypass the entry/version guard");
 const unknownMappedItem = structuredClone(mappedItem);
 (unknownMappedItem.data.content[0] as any)._version = 2;
 const unknownMapped = await runtimeAnalyses(unknownMappedItem, keywords);
 assert.equal(unknownMapped.prepared.input.bodyIncomplete, true);
 assert.equal(seoScoreDisplay(unknownMapped.runtimeBrowser.result).score, null, "an unmapped version is never silently complete");
 assert.deepEqual(unknownMapped.runtimeBrowser.result.checks, unknownMapped.runtimeServer.checks);
 const partlyMappedItem = structuredClone(mappedItem);
 partlyMappedItem.data.content.push({ _type: "unread_embed", text: "Do not guess this is rendered prose" } as any);
 const partlyMapped = await runtimeAnalyses(partlyMappedItem, ["sourdough bread", "starter care", "phrase absent from the observed text"]);
 assert.equal(partlyMapped.prepared.input.bodyIncomplete, true);
 assert.ok(partlyMapped.runtimeBrowser.result.metrics.wordCount > 300, "a substantial observed body still cannot hide unread content");
 assert.equal(seoScoreDisplay(partlyMapped.runtimeBrowser.result).score, null);
 assert.equal(partlyMapped.runtimeBrowser.result.checks.find(c => c.id === "image-alt-text")?.basis, "unavailable", "readable image alt cannot prove all unknown body images");
 assert.equal(partlyMapped.runtimeBrowser.result.checks.find(c => c.id === "secondary-keyword-coverage")?.basis, "unavailable", "unread text cannot prove secondary phrases missing");
 assert.deepEqual(partlyMapped.runtimeBrowser.result.checks, partlyMapped.runtimeServer.checks);
 // Restore the normal path for retained custom-block compatibility controls.
 bindContentAnalysis(runtimeContext, { mappings: [] });

	const blockKeywords = ["sourdough starter", "warm kitchen"];
	const custom = await runtimeAnalyses(customBlockItem, blockKeywords);
	const row = (checks: readonly { id: string; basis: string }[], id: string) => checks.find((item) => item.id === id)?.basis;
	assert.deepEqual(custom.runtimeBrowser.result.checks, custom.runtimeServer.checks, "the same rows for a body with a custom block");
	assert.deepEqual([custom.runtimeBrowser.result.score, custom.runtimeBrowser.result.calculation, custom.runtimeBrowser.result.coverage],
		[custom.runtimeServer.score, custom.runtimeServer.calculation, custom.runtimeServer.coverage], "the same number, calculation and coverage");
	assert.deepEqual(seoScoreDisplay(custom.runtimeBrowser.result), seoScoreDisplay(custom.runtimeServer));
	assert.deepEqual(presentSeoChecks(custom.runtimeBrowser.result), presentSeoChecks(custom.runtimeServer), "the same groups, pills and counts");
	for (const checks of [custom.runtimeBrowser.result.checks, custom.runtimeServer.checks]) {
		assert.equal(row(checks, "image-alt-text"), "not-applicable", "no body images is structural, not unread evidence");
		assert.equal(row(checks, "content-depth"), "unavailable", "control: the custom block leaves the short count Not checked");
		assert.notEqual(row(checks, "secondary-keyword-coverage"), "unavailable", "the default body was read for secondary keywords");
	}
	// Control: the server read the same default body, its custom block and the preview's image setting.
	assert.equal(custom.previewResult.preview.analysis?.imageAltChecks, true);
	assert.equal(custom.prepared.input.body, extractSeoDocumentText(customBlockItem.data.content));
	assert.deepEqual([custom.runtimeServer.metrics.wordCount > 0, custom.runtimeServer.metrics.imageCount], [true, 0],
		JSON.stringify(custom.runtimeServer.metrics));
	assert.match(custom.runtimeServer.checks.find((item) => item.id === "content-depth")!.detail, /not read/);
}

console.log("Editor basic analysis self-check passed: pure saved-input checks, explicit profile source, keyword ownership and unavailable evidence.");
