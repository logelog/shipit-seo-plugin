import assert from "node:assert/strict";

import {
	SEO_SCORE_VERSION,
	analyzeSeoContent,
	classifySeoContentCheck,
	seoContentCheckProblem,
	seoScoreDisplay,
	seoScoreLimitText,
	type SeoAnalysisInput,
	type SeoAnalysisResult,
	type SeoContentCheck,
} from "./analysis.ts";
import type { SeoAdminContentScore } from "./admin-contract.ts";
import { presentSeoChecks } from "./check-presentation.ts";
import { extractSeoDocumentText } from "./document-signals.ts";
import { plainText } from "./entry-analysis-runtime.ts";
import { createScoreComparisonContext } from "./score-history-comparison.ts";
import { buildScoreTrends, createScoreSnapshot } from "./score-history.ts";
import { currentSeoScoreAssessmentProblem } from "./score-result-validation.ts";

/**
 * Engine rows of the current Acceptance table in docs/score-checklist-contract.md.
 * Fixtures follow the contract: published, canonical matching, social image set,
 * no images unless stated, and the body as a saved Portable Text array.
 */

let cases = 0;
function check(name: string, run: () => void): void {
	run();
	cases += 1;
	console.log(`  PASS  ${name}`);
}

const span = (text: string, marks: string[] = []) => ({ _type: "span", _key: `s${text.length}`, text, marks });
const paragraph = (text: string) => ({ _type: "block", _key: `p${text.length}`, style: "normal", markDefs: [], children: [span(text)] });
const heading = (text: string) => ({ _type: "block", _key: `h${text.length}`, style: "h2", markDefs: [], children: [span(text)] });
/** "See the heating checklist for details." is six words with one internal link. */
const linkParagraph = () => ({
	_type: "block", _key: "link", style: "normal",
	markDefs: [{ _key: "guide", _type: "link", href: "/guides/heating-checklist" }],
	children: [span("See the "), span("heating checklist", ["guide"]), span(" for details.")],
});
const image = (alt: string) => ({ _type: "image", _key: "image", asset: { _ref: "media:boiler-photo", mimeType: "image/webp" }, alt });

// Ten plain words without any keyword used below.
const FILLER = ["Owners", "keep", "homes", "warm", "by", "checking", "pressure", "and", "vents", "yearly"];
/** `count` words as ten-word sentences, in paragraphs of at most fifty words. */
function filler(count: number): ReturnType<typeof paragraph>[] {
	const words = Array.from({ length: count }, (_, index) => FILLER[index % FILLER.length]);
	const paragraphs: ReturnType<typeof paragraph>[] = [];
	for (let start = 0; start < words.length; start += 50) {
		const chunk = words.slice(start, start + 50);
		const sentences: string[] = [];
		for (let offset = 0; offset < chunk.length; offset += 10) sentences.push(`${chunk.slice(offset, offset + 10).join(" ")}.`);
		paragraphs.push(paragraph(sentences.join(" ")));
	}
	return paragraphs;
}
const sentence = (count: number) => `${Array.from({ length: count }, (_, index) => FILLER[index % FILLER.length]).join(" ")}.`;
/** Whitespace tokens of the saved text, an independent count for plain English bodies. */
const spacedWords = (document: unknown) => extractSeoDocumentText(document).split(/\s+/u).filter(Boolean).length;

const ARTICLE = { profile: "article", version: 1 } as const;
const GENERAL = { profile: "general", version: 1 } as const;

function input(overrides: Partial<SeoAnalysisInput> & { document?: unknown } = {}): SeoAnalysisInput {
	const document = Object.hasOwn(overrides, "document") ? overrides.document : [];
	return {
		ref: "posts:acceptance", collection: "posts", entryId: "acceptance", slug: "boiler-repair-guide",
		title: "Boiler repair guide for small homes", titleSource: "core-seo",
		description: "How to plan a boiler repair, what a visit costs and which checks a homeowner can do before calling an engineer.",
		descriptionSource: "core-seo",
		url: "https://example.test/boiler-repair-guide", canonicalStatus: "matches",
		image: "https://example.test/social/boiler.jpg", imageSource: "core-seo",
		featuredImage: "https://example.test/media/boiler.jpg",
		noindex: false, noindexSources: [], publicationStatus: "published",
		contentImages: [], focusKeywords: [],
		assessmentProfile: ARTICLE, schemaEnabled: true, schemaPreset: "BlogPosting", imageSeoEnabled: true,
		sourceUpdatedAt: "2026-10-17T10:00:00.000Z",
		...overrides,
		document,
		body: overrides.body ?? extractSeoDocumentText(document),
	};
}

const row = (result: SeoAnalysisResult, id: string): SeoContentCheck => {
	const found = result.checks.find((item) => item.id === id);
	assert.ok(found, `row ${id}`);
	return found;
};
const evaluated = (item: SeoContentCheck) => item.basis === "measured" || item.basis === "heuristic";
/** Every engine result of the acceptance cases, for presentation checks that import this file. */
export const analyzed: SeoAnalysisResult[] = [];
function analyze(overrides: Parameters<typeof input>[0]): SeoAnalysisResult {
	const result = analyzeSeoContent(input(overrides));
	analyzed.push(result);
	return result;
}

/** 600 words: a keyword subheading, a keyword introduction, one internal link, one image with alt, then filler. */
function fullArticleBody(): unknown[] {
	return [
		heading("Boiler repair basics"),
		paragraph("A boiler repair starts with a calm look at the pressure gauge."),
		image("Engineer checking the pressure gauge of a wall boiler"),
		linkParagraph(),
		...filler(600 - 3 - 12 - 6),
	];
}

check("Article, 2 words, metadata complete: 40 Poor, limit named, Body text length Failed", () => {
	const result = analyze({ document: [paragraph("Hello world")] });
	assert.equal(result.metrics.wordCount, 2);
	assert.equal(row(result, "content-depth").status, "fail");
	assert.equal(row(result, "content-depth").evidence.actual, 2);
	assert.deepEqual([result.calculation.earnedWeight, result.calculation.totalWeight, result.calculation.rawScore], [47, 62, 76]);
	assert.deepEqual(result.calculation.limit, { reason: "severely-thin-content", cap: 40, checkIds: ["content-depth"] });
	assert.deepEqual([result.score, result.status, result.grade], [40, "fail", "poor"]);
	const display = seoScoreDisplay(result);
	assert.deepEqual([display.score, display.band, display.label], [40, "poor", "Poor"]);
	assert.equal(display.qualifier, "Limited to 40: under 50 words of body text. No focus keyword",
		"a named limit keeps the unset focus keyword visible");
	assert.equal(display.issues, 2, "Body text length and Internal links");
});

check("Article, empty body array: 40 Poor, no keyword placement advice", () => {
	const withoutKeyword = analyze({ document: [] });
	assert.equal(withoutKeyword.metrics.wordCount, 0);
	assert.equal(row(withoutKeyword, "content-depth").basis, "measured");
	assert.equal(row(withoutKeyword, "content-depth").status, "fail");
	assert.deepEqual([withoutKeyword.calculation.rawScore, withoutKeyword.score, seoScoreDisplay(withoutKeyword).label], [75, 40, "Poor"]);
	const withKeyword = analyze({ document: [], focusKeywords: ["boiler repair"] });
	assert.deepEqual([withKeyword.calculation.rawScore, withKeyword.score, seoScoreDisplay(withKeyword).label], [74, 40, "Poor"]);
	for (const id of ["keyword-introduction", "keyword-heading", "keyword-repetition"])
		assert.equal(row(withKeyword, id).basis, "not-applicable", id);
	assert.equal(row(withKeyword, "keyword-content").status, "fail", "a keyword absent from an empty body is not in the body text");
});

check("Article, 49 then 50 words with one link: 40 then 70", () => {
	const short = analyze({ document: [linkParagraph(), ...filler(43)] });
	const longer = analyze({ document: [linkParagraph(), ...filler(44)] });
	assert.deepEqual([short.metrics.wordCount, longer.metrics.wordCount], [49, 50]);
	assert.equal(short.metrics.internalLinkCount, 1);
	assert.deepEqual([short.calculation.rawScore, short.score, short.calculation.limit?.cap], [85, 40, 40]);
	assert.deepEqual([longer.calculation.rawScore, longer.score], [85, 70]);
	assert.deepEqual(longer.calculation.limit, { reason: "thin-content", cap: 70, checkIds: ["content-depth"] });
	assert.equal(seoScoreDisplay(longer).qualifier, "Limited to 70: under 600 words of body text. No focus keyword");
});

check("Article, 61 words, 3 sentences, no links, no keyword: 70 Needs improvement, two issues", () => {
	const result = analyze({ document: [paragraph(`${sentence(20)} ${sentence(20)} ${sentence(21)}`)] });
	assert.deepEqual([result.metrics.wordCount, result.metrics.sentenceCount, result.metrics.internalLinkCount], [61, 3, 0]);
	assert.equal(row(result, "sentence-readability").status, "pass");
	assert.equal(row(result, "internal-links").status, "fail");
	assert.deepEqual([result.calculation.earnedWeight, result.calculation.totalWeight], [51, 66]);
	assert.deepEqual([result.score, result.status, result.grade], [70, "review", "needs-work"]);
	const display = seoScoreDisplay(result);
	assert.deepEqual([display.score, display.label, display.issues], [70, "Needs improvement", 2]);
	assert.equal(display.qualifier, "Limited to 70: under 600 words of body text. No focus keyword");
	assert.deepEqual(result.calculation.limit, { reason: "thin-content", cap: 70, checkIds: ["content-depth"] });
});

check("Article length boundaries share the same status, limit and numeric display", () => {
	for (const words of [49, 50, 99, 100, 299, 300, 599, 600]) {
		const result = analyze({ document: [linkParagraph(), ...filler(words - 6)] });
		const depth = row(result, "content-depth");
		assert.equal(result.metrics.wordCount, words);
		assert.equal(depth.status, words >= 600 ? "pass" : words >= 300 ? "review" : "fail");
		assert.equal(depth.weight, 10);
		assert.equal(result.calculation.limit?.cap ?? null, words < 50 ? 40 : words < 600 ? 70 : 79);
		assert.equal(result.score, words < 50 ? 40 : words < 600 ? 70 : 79);
		assert.equal(seoScoreDisplay(result).score, result.score);
		assert.equal(currentSeoScoreAssessmentProblem(JSON.parse(JSON.stringify(result))), null);
	}
});

check("The same 63-word dental text has no density penalty with or without a keyword", () => {
	const document = [paragraph(Array.from({ length: 3 }, () => `Dental ${sentence(20)}`).join(" "))];
	assert.equal(spacedWords(document), 63);
	for (const assessmentProfile of [ARTICLE, GENERAL]) {
		const metadata = { document, assessmentProfile, title: "Dental care for small homes", description: "Dental treatment and care options for the family." };
		const withoutKeyword = analyze(metadata);
		const withKeyword = analyze({ ...metadata, focusKeywords: ["dental"] });
		for (const result of [withoutKeyword, withKeyword]) {
			assert.equal(result.metrics.wordCount, 63);
			assert.deepEqual([row(result, "keyword-repetition").basis, row(result, "keyword-repetition").weight], ["not-applicable", 0]);
			assert.equal(result.calculation.limits.some((limit) => limit.reason === "keyword-repetition"), false);
			assert.notEqual(seoScoreDisplay(result).score, null);
		}
		assert.ok(withKeyword.score >= withoutKeyword.score, "three natural uses cannot introduce a density failure");
		assert.equal(withKeyword.score, assessmentProfile.profile === "article" ? 70 : 95);
	}
});

check("Density starts at 100 body words and compares the unrounded occurrence share", () => {
	for (const [words, uses, status] of [[99, 4, "review"], [100, 4, "fail"], [200, 7, "pass"], [200, 8, "fail"]] as const) {
		const document = [paragraph([...Array.from({ length: uses }, () => "dental"), ...Array.from({ length: words - uses }, () => "care")].join(" "))];
		const result = analyze({ document, assessmentProfile: GENERAL, focusKeywords: ["dental"] });
		const repetition = row(result, "keyword-repetition");
		assert.equal(result.metrics.wordCount, words);
		assert.equal(repetition.status, status);
		assert.equal(repetition.basis, words < 100 ? "not-applicable" : "heuristic");
		assert.equal(repetition.weight, words < 100 ? 0 : 4);
		assert.equal(result.calculation.limits.some((limit) => limit.reason === "keyword-repetition"), status === "fail");
		assert.doesNotMatch(repetition.detail, /keyword stuffing|spam/i);
		assert.notEqual(seoScoreDisplay(result).score, null);
	}
});

check("A 600-word article with genuinely high density fails repetition and is limited to 79", () => {
	const document = [paragraph(Array.from({ length: 24 }, () => "boiler repair").join(" ")), ...filler(552)];
	const result = analyze({ document, focusKeywords: ["boiler repair"] });
	const repetition = row(result, "keyword-repetition");
	assert.equal(result.metrics.wordCount, 600);
	assert.equal(row(result, "content-depth").status, "pass");
	assert.deepEqual([repetition.status, repetition.evidence.actual, repetition.weight], ["fail", 24, 4]);
	assert.match(repetition.detail, /^The focus keyword appears 24 times in 600 words \(4%\)/);
	assert.doesNotMatch(repetition.detail, /keyword stuffing|spam/i);
	assert.deepEqual(result.calculation.limit, { reason: "keyword-repetition", cap: 79, checkIds: ["keyword-repetition"] });
	assert.equal(result.score, 79);
	assert.equal(seoScoreDisplay(result).qualifier, "Limited to 79: high focus keyword density");
});

check("Article, 600 words, keyword placed, link, alt, schema, fitting snippet: 100 Good, groups All good", () => {
	const document = fullArticleBody();
	assert.equal(spacedWords(document), 600);
	const result = analyze({ document, focusKeywords: ["boiler repair"] });
	assert.equal(result.metrics.wordCount, 600);
	assert.deepEqual([result.metrics.internalLinkCount, result.metrics.imageCount, result.metrics.imageAltCount], [1, 1, 1]);
	assert.deepEqual([result.score, result.status, result.grade, result.calculation.totalWeight], [100, "pass", "good", 89]);
	assert.deepEqual(result.calculation.limits, []);
	const notPassed = result.checks.filter((item) => evaluated(item) && item.status !== "pass").map((item) => item.id);
	assert.deepEqual(notPassed, []);
	assert.equal(result.checks.some((item) => item.basis === "unavailable"), false);
	const display = seoScoreDisplay(result);
	assert.deepEqual(display, { score: 100, band: "good", label: "Good", qualifier: null, limit: null, issues: 0, suggestions: 0, notChecked: 0 });
	assert.equal(row(result, "keyword-repetition").evidence.actual, 2);
});

check("Article, 600 words, featured image saved with empty alt: still 100 Good, groups All good", () => {
	// The host's featured image picker stores alt "" when the media item has none; image fields are not body images.
	const result = analyze({ document: fullArticleBody(), focusKeywords: ["boiler repair"],
		contentImages: [{ source: "featured_image", value: { id: "boiler", src: "https://example.test/media/boiler.jpg", alt: "" } }] });
	assert.deepEqual([result.metrics.imageCount, result.metrics.imageDecorativeCount], [2, 1], "metrics still observe every saved image");
	assert.deepEqual([row(result, "image-alt-text").status, row(result, "image-alt-text").evidence.actual], ["pass", 0]);
	assert.equal(row(result, "image-alt-text").detail, "The body image has an alt attribute.");
	assert.equal(result.checks.some((item) => item.id === "image-empty-alt-review"), false, "no empty-alt advice for an image field");
	assert.equal(result.score, 100);
	const display = seoScoreDisplay(result);
	assert.deepEqual([display.issues, display.suggestions, display.notChecked], [0, 0, 0]);
	for (const group of presentSeoChecks(result).groups) assert.equal(group.pill.text, group.rows.length ? "All good" : "Not applicable", group.id);
});

check("General, 2 words: dash, Too little text to score", () => {
	const result = analyze({ document: [paragraph("Hello world")], assessmentProfile: GENERAL });
	const display = seoScoreDisplay(result);
	assert.deepEqual([display.score, display.band, display.label, display.qualifier], [null, null, "Too little text to score", "2 words of body text"]);
	assert.equal(result.calculation.limit?.reason, "focus-keyword-unset", "General entries carry keyword readiness, never a word-count limit");
});

check("General, 61 words, no links: number shown, Internal links Partly met, short-text Suggestion", () => {
	const result = analyze({ document: [paragraph(`${sentence(20)} ${sentence(20)} ${sentence(21)}`)], assessmentProfile: GENERAL });
	assert.equal(row(result, "internal-links").status, "review");
	assert.equal(classifySeoContentCheck(row(result, "internal-links")).role, "scored-coaching");
	const depth = row(result, "content-depth");
	assert.deepEqual([depth.status, depth.weight, classifySeoContentCheck(depth).role], ["review", 0, "advisory"]);
	assert.match(depth.detail, /^Short body text: 61 words\./);
	assert.deepEqual([result.calculation.earnedWeight, result.calculation.totalWeight, result.score], [52.75, 56, 79]);
	const display = seoScoreDisplay(result);
	assert.deepEqual([display.score, display.label, display.issues, display.suggestions], [79, "Needs improvement", 1, 2]);
	const headings = row(result, "heading-structure");
	assert.deepEqual([headings.basis, headings.detail], ["not-applicable", "Short general content: under 300 words without section headings."],
		"rule 2: general heading advice does not apply below 300 words without headings");
	const longer = analyze({ document: filler(320), assessmentProfile: GENERAL });
	assert.deepEqual([row(longer, "heading-structure").basis, row(longer, "heading-structure").status], ["heuristic", "review"],
		"from 300 words the same body gets heading advice");
});

check("Keyword never used, 600 words: 79 at most, three keyword rows Failed", () => {
	const result = analyze({ document: fullArticleBody(), focusKeywords: ["heat pump installation"] });
	for (const id of ["keyword-title", "keyword-description", "keyword-content"]) assert.equal(row(result, id).status, "fail", id);
	const phones = row(result, "keyword-title-position");
	assert.deepEqual([phones.basis, phones.detail], ["not-applicable", "The focus keyword is not in the title."],
		"rule 2: phone visibility does not apply when the title row already fails");
	assert.deepEqual([result.calculation.earnedWeight, result.calculation.totalWeight, result.calculation.rawScore], [79, 89, 89]);
	assert.deepEqual(result.calculation.limit, { reason: "missing-primary-keyword", cap: 79, checkIds: ["keyword-title", "keyword-description", "keyword-content"] });
	assert.equal(result.score, 79);
	assert.equal(seoScoreDisplay(result).qualifier, "Limited to 79: focus keyword not in title, description or body text");
	assert.equal(seoScoreDisplay(result).band, "needs-improvement");
});

// Quoted from Google Search Central, "Spam policies for Google web search", Keyword stuffing, read 2026-10-17.
const GOOGLE_SPAM_EXAMPLE = "Unlimited app store credit. There are so many sites that claim to offer app store credit for $0 but they're all fake and always mess up with users looking for unlimited app store credits. You can get limitless credits for app store right here on this website. Visit our unlimited app store credit page and get it today!";

check("A 58-word paragraph with three uses is below the repetition sample", () => {
	const metadata = {
		slug: "unlimited-app-store-credit", url: "https://example.test/unlimited-app-store-credit",
		title: "Unlimited app store credit", description: "Get unlimited app store credit today on this website.",
		focusKeywords: ["app store credit"], document: [paragraph(GOOGLE_SPAM_EXAMPLE)],
	};
	for (const assessmentProfile of [GENERAL, ARTICLE]) {
		const result = analyze({ ...metadata, assessmentProfile });
		const repetition = row(result, "keyword-repetition");
		assert.equal(result.metrics.wordCount, 58);
		assert.deepEqual([repetition.basis, repetition.status, repetition.weight], ["not-applicable", "review", 0]);
		assert.match(repetition.detail, /not assessed below 100 words/);
		assert.equal(result.calculation.limits.some((limit) => limit.reason === "keyword-repetition"), false);
		assert.notEqual(seoScoreDisplay(result).score, null, "a small density sample is neutral, not unavailable");
	}
});

check("3-word phrase 4 times in 300 words: Repetition Passed", () => {
	const phraseSentence = "An emergency boiler repair visit starts with a safety check.";
	const document = [paragraph(`${phraseSentence} ${phraseSentence}`), paragraph(`${phraseSentence} ${phraseSentence}`), ...filler(260)];
	assert.equal(spacedWords(document), 300);
	const result = analyze({
		document, focusKeywords: ["emergency boiler repair"],
		title: "Emergency boiler repair for small homes", slug: "emergency-boiler-repair",
		description: "What an emergency boiler repair visit includes and how to prepare for the engineer.",
	});
	const repetition = row(result, "keyword-repetition");
	assert.equal(result.metrics.wordCount, 300);
	assert.deepEqual([repetition.status, repetition.evidence.actual], ["pass", 4]);
	assert.equal(repetition.detail, "The focus keyword appears 4 times in 300 words.");
	assert.equal(row(result, "content-depth").status, "review");
	assert.equal(result.calculation.limits.some((limit) => limit.reason === "keyword-repetition"), false);
});

check("No keyword: 79 Needs improvement and an actionable focus keyword qualifier", () => {
	const result = analyze({ document: fullArticleBody() });
	const keyword = row(result, "focus-keyword");
	assert.deepEqual([keyword.status, keyword.basis, keyword.weight, classifySeoContentCheck(keyword).role], ["review", "measured", 0, "advisory"]);
	assert.match(keyword.recommendation, /^Add a focus keyword/);
	for (const id of ["keyword-title", "keyword-description", "keyword-content", "keyword-repetition"]) assert.equal(row(result, id).basis, "not-applicable", id);
	assert.deepEqual([result.score, result.calculation.totalWeight], [79, 75]);
	const display = seoScoreDisplay(result);
	assert.deepEqual([display.score, display.label, display.qualifier, display.suggestions], [79, "Needs improvement", "Add a focus keyword", 1]);
});

const JAPANESE_PARAGRAPH = "小さな会社では毎週の目標を確認しながら、顧客の声を丁寧に集めてサービスを改善しています。" +
	"担当者は問い合わせの内容を整理して、次の打ち合わせで共有する資料を準備します。" +
	"季節ごとの売上の変化を記録すると、来年の計画を立てるときに役立ちます。";

check("Japanese 3000-character body: word count from segments; not limited", () => {
	const paragraphs = Array.from({ length: Math.ceil(3000 / JAPANESE_PARAGRAPH.length) }, () => JAPANESE_PARAGRAPH);
	const characters = [...paragraphs.join("")].length;
	assert.ok(characters >= 3000 && characters < 3000 + JAPANESE_PARAGRAPH.length, String(characters));
	const document = paragraphs.map(paragraph);
	const text = extractSeoDocumentText(document);
	assert.ok(text.split(/\s+/u).length < 50, "whitespace alone would count only the paragraphs");
	const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
	const segmentWords = [...segmenter.segment(text)].filter((segment) => segment.isWordLike).length;
	const result = analyze({
		document, focusKeywords: ["顧客の声"], slug: "customer-voice-guide", url: "https://example.test/customer-voice-guide",
		title: "顧客の声を集める小さな会社の改善ガイド", description: "小さな会社が顧客の声を集めて、毎週の目標とサービスを改善する方法を紹介します。",
	});
	assert.equal(result.metrics.wordCount, segmentWords);
	assert.ok(result.metrics.wordCount >= 600, String(result.metrics.wordCount));
	assert.equal(row(result, "content-depth").status, "pass");
	assert.deepEqual(result.calculation.limits, []);
	assert.deepEqual([result.calculation.earnedWeight, result.calculation.totalWeight, result.score], [75, 80, 94], "only Internal links fails");
	for (const id of ["keyword-title", "keyword-description", "keyword-content"]) assert.equal(row(result, id).status, "pass", id);
	assert.equal(row(result, "keyword-content").evidence.actual, paragraphs.length, "an unspaced keyword matches as a substring");
	assert.equal(row(result, "keyword-repetition").status, "pass");
	assert.notEqual(seoScoreDisplay(result).score, null);
});

check("Custom blocks with a short paragraph: Body text length Not checked; dash", () => {
	const callToAction = { _type: "callToAction", _key: "cta", heading: "Book a visit today", buttonLabel: "Call now" };
	const result = analyze({ document: [callToAction, paragraph("A short paragraph about our service.")] });
	const depth = row(result, "content-depth");
	assert.deepEqual([depth.basis, depth.status, depth.weight], ["unavailable", "review", 0]);
	assert.match(depth.detail, /^6 words read\. Some blocks in this body are not read, for example custom blocks/);
	assert.deepEqual(result.calculation.limits.map(limit => limit.reason), ["focus-keyword-unset"], "an unread row adds no body limit");
	const display = seoScoreDisplay(result);
	assert.deepEqual([display.score, display.band, display.label], [null, null, "Partially checked"]);
	const passing = analyze({ document: [callToAction, ...fullArticleBody()] });
	assert.equal(row(passing, "content-depth").status, "pass", "unread blocks can only add words, so a passing count stands");
	assert.notEqual(seoScoreDisplay(passing).score, null);
});

function storedScore(result: SeoAnalysisResult, capturedAt: string): SeoAdminContentScore {
	return {
		...result, assessmentProfileRevision: "profile-1", analysisRevision: 1, profileKeywords: null,
		focusKeywordSource: "none", keywords: [], updatedAt: capturedAt, templateUpdatedAt: null, modulesUpdatedAt: null,
		configurationFingerprint: "acceptance-fixture", metaOverrideUpdatedAt: null,
	} as SeoAdminContentScore;
}

check("Template body field: dash, Partially checked; excluded from averages", () => {
	const template = analyze({ ref: "pages:home", collection: "pages", entryId: "home", document: undefined, body: "", bodySource: "template", assessmentProfile: GENERAL });
	const display = seoScoreDisplay(template);
	assert.deepEqual([display.score, display.label], [null, "Partially checked"]);
	assert.equal(display.qualifier, "6 weighted checks not checked");
	const templateScore = storedScore(template, "2026-10-16T10:00:00.000Z");
	assert.equal(createScoreComparisonContext(templateScore), undefined);
	const templateSnapshot = createScoreSnapshot(templateScore);
	assert.equal(templateSnapshot.unscored, "partially-checked");
	const numbered = analyze({ ref: "posts:numbered", entryId: "numbered", document: fullArticleBody() });
	const trends = buildScoreTrends([templateSnapshot, createScoreSnapshot(storedScore(numbered, "2026-10-16T11:00:00.000Z"))],
		{ days: 7, now: new Date("2026-10-17T12:00:00.000Z") });
	assert.deepEqual([trends.summary.snapshotCount, trends.summary.trackedEntries, trends.summary.currentAverage], [2, 1, 79]);
});

check("Too long for phones: Suggestion naming phones and the cut point, marked estimate", () => {
	const result = analyze({ document: fullArticleBody(),
		title: "Boiler repair guide for small homes with a careful explanation of every winter check and each spare part" });
	const fit = row(result, "title-display-length");
	assert.deepEqual([fit.status, fit.weight, classifySeoContentCheck(fit).role], ["review", 0, "advisory"]);
	assert.match(fit.detail, /^Estimate: may be cut off on phones after "\.\.\.[^"]+"/);
	assert.match(String(fit.evidence.actual), /^phones: cut after "\.\.\.[^"]+"/);
	assert.match(fit.limitation, /^Estimated with preview widths/);
	assert.match(fit.limitation, /measures the resolved text, including what a metadata template adds, such as the site name in a title/);
	assert.match(fit.limitation, /text the theme adds when it renders the page is not included/);
	assert.doesNotMatch(`${fit.detail} ${fit.recommendation} ${fit.limitation}`, /characters?\b/, "no character limit is cited");
	assert.equal(result.score, 79, "fit advice never changes keyword readiness");
});

check("Production browser checks: the server reads the same body text the browser checks read", () => {
	const document = [...fullArticleBody(), { _type: "callToAction", _key: "cta", heading: "Book a visit today" }];
	const serverText = plainText(document);
	assert.equal(serverText, extractSeoDocumentText(document));
	assert.doesNotMatch(serverText, /media:boiler-photo|image\/webp|callToAction|_key/, "block attributes are never body text");
	const fromServer = analyzeSeoContent(input({ document, body: serverText, focusKeywords: ["boiler repair"] }));
	const fromBrowser = analyzeSeoContent(input({ document, body: extractSeoDocumentText(document), focusKeywords: ["boiler repair"] }));
	assert.equal(JSON.stringify(fromServer), JSON.stringify(fromBrowser));
});

check("Group counts: the display counts are the sums of issue, suggestion and not-checked rows", () => {
	assert.ok(analyzed.length >= 20);
	for (const result of analyzed) {
		const display = seoScoreDisplay(result);
		const roles = result.checks.map((item) => ({ item, classification: classifySeoContentCheck(item, result.assessmentProfile.profile) }));
		assert.equal(display.issues, roles.filter(({ classification }) => classification.issue).length);
		assert.equal(display.suggestions, roles.filter(({ item, classification }) => classification.role === "advisory" && item.status === "review").length);
		assert.equal(display.notChecked, result.checks.filter((item) => item.basis === "unavailable" && item.id !== "indexability").length);
	}
	const unreadableStatus = analyze({ document: fullArticleBody(), publicationStatus: undefined });
	assert.equal(row(unreadableStatus, "indexability").basis, "unavailable");
	assert.equal(seoScoreDisplay(unreadableStatus).notChecked, presentSeoChecks(unreadableStatus).totals.notChecked,
		"the hidden indexing directive is not counted as a row that was not checked");
});

// An excerpt of fixture "a" in analyzer20-compat.selfcheck.ts, which holds the complete frozen records.
const ANALYZER_20_EXCERPT = {
	scoreVersion: 20, ref: "posts:two-words", collection: "posts", entryId: "two-words", slug: "growth-marketing-strategy",
	title: "Growth marketing strategy for small teams", score: 100, grade: "good", status: "pass",
	assessmentProfile: { profile: "general", version: 1 },
	calculation: { earnedWeight: 47, totalWeight: 47, rawScore: 100, score: 100, reviewCredit: 0.35, limit: null },
	checks: [
		{ id: "title", label: "Title", category: "metadata", severity: "high", status: "pass", weight: 14, basis: "measured", detail: "Saved metadata is available.", evidence: { actual: true, expected: "nonempty resolved saved metadata", source: "Resolved title suggestion: entry SEO title (seo.title)" }, limitation: "Measures the resolved title suggestion. EmDash leaves the served <title> element to the site template, which this analysis does not observe. Length and pixel ranges are directional, not a search engine rule.", recommendation: "Keep it accurate and useful for this entry." },
		{ id: "content-depth", label: "Saved body text", category: "content", severity: "info", status: "pass", weight: 0, basis: "measured", detail: "2 saved words extracted.", evidence: { actual: 2, expected: "a saved-text observation, without a word-count target", source: "saved body extraction" }, limitation: "Extraction does not establish rendered-page completeness, usefulness or a preferred word count.", recommendation: "Review the content needed for the page purpose." },
		{ id: "internal-links", label: "Internal links", category: "links", severity: "info", status: "review", weight: 0, basis: "not-applicable", detail: "Short content; no internal-link target is required for scoring.", evidence: { actual: null, expected: "contextual links when useful", source: "structured content links" }, limitation: "Counts links in the saved body; navigation and template links are not observed. Link targets are directional, not a ranking rule.", recommendation: "No action is required; add this element only when it improves the reader's path." },
	],
};

check("Analyzer 20 stored result (frozen fixture): Earlier analyzer, no number, no comparison", () => {
	const stored = structuredClone(ANALYZER_20_EXCERPT) as unknown as SeoAdminContentScore;
	assert.deepEqual(seoScoreDisplay(stored), {
		score: null, band: null, label: "Earlier analyzer", qualifier: "Analyze again.", limit: null, issues: 0, suggestions: 0, notChecked: 0,
	});
	assert.equal(createScoreComparisonContext(stored), undefined);
	assert.equal(currentSeoScoreAssessmentProblem(stored), "scoreVersion");
	const previous21 = { ...analyze({ document: fullArticleBody(), focusKeywords: ["boiler repair"] }), scoreVersion: 21 } as unknown as SeoAdminContentScore;
	assert.equal(seoScoreDisplay(previous21).label, "Earlier analyzer", "analyzer21 cannot render as current after the policy change");
	assert.equal(createScoreComparisonContext(previous21), undefined);
	assert.equal(currentSeoScoreAssessmentProblem(previous21), "scoreVersion");

	for (const item of ANALYZER_20_EXCERPT.checks) assert.equal(seoContentCheckProblem(item, false), null, item.id);
	const reanalyzed = analyze({ document: [paragraph("Hello world")], assessmentProfile: GENERAL });
	assert.equal(reanalyzed.scoreVersion, SEO_SCORE_VERSION);
	assert.equal(seoScoreDisplay(reanalyzed).label, "Too little text to score", "the same two words are no longer a 100");
});

check("A capped result stays valid after a JSON round trip; a changed limit is refused", () => {
	const capped = analyzed.filter((result) => result.calculation.limit !== null);
	assert.ok(capped.length >= 5);
	for (const result of capped) {
		const stored = JSON.parse(JSON.stringify(result));
		assert.equal(currentSeoScoreAssessmentProblem(stored), null, result.ref);
		assert.equal(currentSeoScoreAssessmentProblem({ ...stored, calculation: { ...stored.calculation, limit: { ...stored.calculation.limit, cap: stored.calculation.limit.cap + 1 } } }), "calculation.limit");
		assert.equal(currentSeoScoreAssessmentProblem({ ...stored, calculation: { ...stored.calculation, limits: [] } }), "calculation.limits");
		assert.equal(seoScoreLimitText(stored.calculation.limit).startsWith(`Limited to ${stored.calculation.limit.cap}: `), true);
	}
	const missingTitle = analyze({ title: "", document: fullArticleBody() });
	assert.deepEqual([missingTitle.calculation.earnedWeight, missingTitle.calculation.totalWeight, missingTitle.calculation.rawScore, missingTitle.score], [61, 75, 81, 49]);
	assert.deepEqual(missingTitle.calculation.limit, { reason: "missing-title", cap: 49, checkIds: ["title"] });
	assert.equal(currentSeoScoreAssessmentProblem(JSON.parse(JSON.stringify(missingTitle))), null);
});

check("Score rounds the exact earned share: 55.35 of 82 points is 68", () => {
	const keyword = "boiler repair";
	const words = (count: number) => sentence(count).slice(0, -1);
	const result = analyze({
		title: "Guide for small homes", image: "", imageSource: undefined, focusKeywords: [keyword],
		document: [image("Engineer checking a boiler"), paragraph(`${keyword} ${words(140)} ${keyword} ${keyword}. ${keyword} ${words(136)} ${keyword} ${Array.from({ length: 7 }, () => keyword).join(" ")}.`)],
	});
	assert.deepEqual([result.calculation.earnedWeight, result.calculation.totalWeight, result.calculation.rawScore, result.score], [55.35, 82, 68, 68],
		"5535 hundredths over 82 is exactly 67.5, which rounds up");
	assert.equal(currentSeoScoreAssessmentProblem(JSON.parse(JSON.stringify(result))), null);
});

check("Each policy allows only its listed outcomes", () => {
	const result = analyze({ document: [paragraph(`${sentence(20)} ${sentence(20)} ${sentence(21)}`)], assessmentProfile: GENERAL });
	const links = row(result, "internal-links");
	assert.equal(seoContentCheckProblem({ ...links, status: "fail" }, true, "general"), "policy-status");
	assert.equal(seoContentCheckProblem({ ...row(result, "social-image"), status: "fail" }, true), "policy-status");
	assert.equal(seoContentCheckProblem({ ...row(result, "title"), status: "review" }, true), "policy-status");
	const article = analyze({ document: [paragraph("Hello world")] });
	assert.equal(seoContentCheckProblem({ ...row(article, "content-depth"), status: "review" }, true), "depth-evidence",
		"a stored word count must agree with its status");
});

assert.equal(cases, 26);
console.log(`Analyzer ${SEO_SCORE_VERSION} acceptance checks passed (${cases} cases).`);
