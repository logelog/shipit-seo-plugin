import {
	SEO_SCORE_VERSION,
	aggregateSeoChecks,
	analyzeSeoContent,
	calculateSeoScore,
	classifySeoContentCheck,
	seoAnalysisPresentation,
	seoAnalysisSummary,
	seoContentCheckProblem,
	seoScoreDisplay,
	seoScoredCheckMask,
	isSeoScoredCheckMask,
	type SeoAnalysisInput,
	type SeoCheckRole,
	type SeoContentCheck,
} from "./analysis.ts";
import {
	normaliseSeoKeywordText,
	seoKeywordOccurrenceCount,
	seoTextContainsKeyword,
} from "./keyword-match.ts";
import { seoSnippetCutPoint, seoSnippetFit } from "./snippet-fit.ts";
import { SNIPPET_PREVIEW_PROFILES, measureSnippetPreviewText } from "./snippet-metrics.ts";
import { extractSeoDocumentSignals } from "./document-signals.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

function span(text: string, marks: string[] = []) {
	return { _type: "span", text, marks };
}

function block(
	text: string,
	options: { style?: string; markDefs?: Array<Record<string, unknown>>; children?: Array<Record<string, unknown>> } = {},
) {
	return {
		_type: "block",
		style: options.style ?? "normal",
		markDefs: options.markDefs ?? [],
		children: options.children ?? [span(text)],
	};
}

function image(alt?: string) {
	return {
		_type: "image",
		asset: { _ref: "media:image-1", mimeType: "image/webp" },
		...(alt !== undefined ? { alt } : {}),
	};
}

function idealDocument() {
	const sentence = "Useful audience research connects clear messaging, measurement, channel strategy, and sustained demand.";
	return [
		block("Growth marketing strategy foundations", { style: "h2" }),
		image("Growth marketer reviewing a search visibility dashboard"),
		block("", {
			markDefs: [
				{ _key: "internal", _type: "link", href: "/services/seo-ai-visibility" },
				{ _key: "external", _type: "link", href: "https://developers.google.com/search" },
			],
			children: [
				span("Growth marketing teams can review our "),
				span("technical SEO service", ["internal"]),
				span(" alongside "),
				span("Google Search documentation", ["external"]),
				span("."),
			],
		}),
		...Array.from({ length: 50 }, () => block(sentence)),
	];
}

function fixture(overrides: Partial<SeoAnalysisInput> = {}): SeoAnalysisInput {
	return {
		ref: "posts:article-1",
		collection: "posts",
		entryId: "article-1",
		slug: "growth-marketing-strategy",
		title: "Growth marketing strategy for measurable demand",
		description:
			"A practical growth marketing strategy that connects search, content, paid media and measurement to build qualified demand and sustainable growth.",
		url: "https://shipitdigital.nl/blog/growth-marketing-strategy",
		image: "https://shipitdigital.nl/og/growth-marketing-strategy.png",
		featuredImage: "https://shipitdigital.nl/media/growth-marketing-strategy.jpg",
		noindex: false,
		publicationStatus: "published",
		body: Array.from({ length: 500 }, () => "useful").join(" "),
		document: idealDocument(),
		focusKeyword: "growth marketing",
			assessmentProfile: { profile: "article", version: 1 },
		schemaEnabled: true,
		schemaPreset: "BlogPosting",
		imageSeoEnabled: true,
		sourceUpdatedAt: "2026-07-14T10:00:00.000Z",
		...overrides,
	};
}

const ideal = analyzeSeoContent(fixture());
check("ideal article scores 100", ideal.score === 100, `got ${ideal.score}`);
check("ideal article passes every evaluated check; inapplicable rows stay unscored reviews",
	ideal.checks.every((item) => item.basis === "not-applicable"
		? item.status === "review" && item.weight === 0
		: item.status === "pass"),
	ideal.checks.filter((item) => item.basis !== "not-applicable" && item.status !== "pass").map((item) => item.id).join(", "));
check("score algorithm version is explicit", ideal.scoreVersion === SEO_SCORE_VERSION);
check("source revision is preserved", ideal.sourceUpdatedAt === "2026-07-14T10:00:00.000Z");
check("structured editor metrics are persisted", ideal.metrics.structured && ideal.metrics.wordCount >= 450);
check("portable text headings are measured", ideal.metrics.headingCount === 1 && ideal.metrics.h1Count === 0);
check("internal and external links are classified", ideal.metrics.internalLinkCount === 1 && ideal.metrics.externalLinkCount === 1);
check("analyzer covers links and readability", ideal.checks.some((item) => item.category === "links") && ideal.checks.some((item) => item.category === "readability"));
check("image metadata is measured", ideal.metrics.imageCount === 1 && ideal.metrics.imageAltCount === 1 && ideal.metrics.imageMissingAltCount === 0);
check("saved image alt attributes pass as presence", ideal.checks.some((item) => item.id === "image-alt-text" && item.status === "pass" && item.weight === 6));
check("a configured primary target is recorded as unweighted advice", ideal.checks.some((item) =>
	item.id === "focus-keyword" && item.status === "pass" && item.weight === 0 && item.severity === "info" && item.basis === "measured"));
check("the focus keyword is coached against the saved slug", ideal.checks.some((item) => item.id === "keyword-url" && item.status === "pass" && item.evidence.source === "saved slug"));
check("the focus keyword is evaluated against body prose", ideal.checks.some((item) => item.id === "keyword-content" && item.status === "pass"));
check("the primary keyword is evaluated near the start of the title", ideal.checks.some((item) => item.id === "keyword-title-position" && item.status === "pass"));
check("post featured image is evaluated independently from the social image", ideal.checks.some((item) => item.id === "featured-image" && item.status === "pass"));

const repeated = analyzeSeoContent(fixture());
check("analysis is deterministic", JSON.stringify(ideal) === JSON.stringify(repeated));
const partlyMetSocial = analyzeSeoContent(fixture({ image: "" }));
check(
	"partly met scored rows receive 35% of their weight",
	partlyMetSocial.checks.find((item) => item.id === "social-image")?.status === "review" &&
		partlyMetSocial.calculation.totalWeight === ideal.calculation.totalWeight &&
		Math.abs(partlyMetSocial.calculation.earnedWeight - (ideal.calculation.totalWeight - 8 + 8 * 0.35)) < 1e-9 &&
		partlyMetSocial.score === Math.round(100 * (ideal.calculation.totalWeight - 8 * 0.65) / ideal.calculation.totalWeight),
	JSON.stringify(partlyMetSocial.calculation),
);
check(
	"keyword matching tolerates harmless accents, punctuation, and spacing",
	seoTextContainsKeyword("A café-growth strategy", "cafe growth strategy"),
);
check(
	"keyword matching respects phrase boundaries",
	!seoTextContainsKeyword("Theater marketing", "heat"),
);
const symbolKeyword = analyzeSeoContent(fixture({ focusKeyword: undefined, focusKeywords: ["\u{1f355}", "growth marketing"] }));
const symbolOnly = analyzeSeoContent(fixture({ focusKeyword: "\u{1f355}", focusKeywords: ["\u{1f355}"] }));
check(
	"a keyword with nothing left to match is ignored rather than failing every keyword row",
	symbolKeyword.keyword === "growth marketing" && symbolOnly.keyword === undefined &&
		symbolOnly.checks.find((item) => item.id === "focus-keyword")?.status === "review" &&
		symbolOnly.calculation.limits.every((limit) => limit.reason !== "missing-primary-keyword"),
	JSON.stringify([symbolKeyword.keyword, symbolOnly.keyword, symbolOnly.calculation.limits]),
);
check(
	"keyword identity is stable across presentation variants",
	normaliseSeoKeywordText("  SEO—AI  ") === normaliseSeoKeywordText("seo ai"),
);
check(
	"literal keyword occurrences respect normalized phrase boundaries",
	seoKeywordOccurrenceCount(
		"Café growth, cafe-growth; and CAFÉ GROWTH.",
		"cafe growth",
	) === 3,
);
check(
	"snippet fit uses the preview's glyph metrics, so wide glyphs take more room than narrow ones",
	measureSnippetPreviewText("WWWWWW", SNIPPET_PREVIEW_PROFILES.desktop.title) >
		measureSnippetPreviewText("iiiiii", SNIPPET_PREVIEW_PROFILES.desktop.title),
);
check(
	"healthy fixture metadata fits the phone and desktop previews",
	[...seoSnippetFit(ideal.title, "title"), ...seoSnippetFit(fixture().description, "description")].every((fit) => !fit.clipped),
);

// Fit follows the preview widths, never a character count.
for (const [field, value, expectedStatus] of [
	["title", "i".repeat(60) + "\u{1f600}", "pass"],
	["description", Array.from({ length: 40 }, () => "iii").join(" ") + "\u{1f600}", "pass"],
	["title", "WWWWWW WWWWWW WWWWWW WWWWWW WWWWWW WWWWWW WWWWWW", "review"],
] as const) {
	const result = analyzeSeoContent(fixture(field === "title" ? { title: value } : { description: value }));
	const measured = result.checks.find((item) => item.id === field + "-display-length");
	const copy = `${measured?.detail} ${measured?.evidence.actual} ${measured?.evidence.expected} ${measured?.recommendation}`;
	check(`${field} fit of ${[...value].length} characters is ${expectedStatus}, an estimate that never cites a character limit`,
		measured?.status === expectedStatus && measured.weight === 0 && measured.basis === "heuristic" &&
		measured.detail.startsWith("Estimate:") && /phones/.test(String(measured.evidence.actual)) &&
		/desktop/.test(String(measured.evidence.actual)) && !/characters?\b/.test(copy) &&
		/including what a metadata template adds, such as the site name in a title; text the theme adds when it renders the page is not included/.test(measured.limitation),
		JSON.stringify(measured));
}

const visuallyWideTitle = analyzeSeoContent(
	fixture({ title: "WWWWWW WWWWWW WWWWWW WWWWWW WWWWWW WWWWWW WWWWWW" }),
);
const wideFit = visuallyWideTitle.checks.find((item) => item.id === "title-display-length");
check(
	"a title too wide for phones names the device and the cut point",
	wideFit?.status === "review" &&
		/^Estimate: may be cut off on phones after "\.\.\.[W ]+" and on desktop after "\.\.\.[W ]+"\.$/.test(wideFit.detail) &&
		String(wideFit.evidence.actual).startsWith('phones: cut after "...'),
	JSON.stringify(wideFit),
);
const unspacedTitle = analyzeSeoContent(fixture({ title: "小さな会社が顧客の声を集めて毎週の目標とサービスを改善するための実践的な方法と事例の完全ガイド" }));
const unspacedFit = unspacedTitle.checks.find((item) => item.id === "title-display-length");
check(
	"text without spaces is quoted by its last twelve graphemes at the cut, never as the whole visible value",
	unspacedFit?.status === "review" &&
		/^phones: cut after "\.\.\.ための実践的な方法と事例"; desktop: cut after "\.\.\.目標とサービスを改善する"$/.test(String(unspacedFit.evidence.actual)) &&
		seoSnippetCutPoint("Boiler repair guide for small homes with a careful") === "...with a careful" &&
		seoSnippetCutPoint("iPhone の設定") === "...iPhone の設定",
	JSON.stringify(unspacedFit?.evidence.actual),
);
const longDescription = `${fixture().description} It also explains how to review results every quarter, which channels to drop and how to brief a small team.`;
const descriptionFit = (overrides: Partial<SeoAnalysisInput>) =>
	analyzeSeoContent(fixture(overrides)).checks.find((item) => item.id === "description-display-length")!;
const longDescriptionFit = descriptionFit({ description: longDescription });
check("a description too long for phones is a Suggestion that names phones and the cut point if Google uses it",
	longDescriptionFit.status === "review" && longDescriptionFit.weight === 0 &&
	/^Estimate: if Google uses this description, it may be cut off on phones after "\.\.\.[^"]+"/.test(longDescriptionFit.detail),
	JSON.stringify(longDescriptionFit));
{
	const prefix = "Oct 18, 2026 \u2014 ";
	const dated = descriptionFit({ description: longDescription, descriptionPrefix: prefix });
	const fits = seoSnippetFit(longDescription, "description", prefix);
	check("a publication date shown before the description is measured with it, as the preview cuts it",
		dated.status === "review" && fits.some((fit) => fit.clipped) &&
		fits.filter((fit) => fit.clipped).every((fit) => dated.detail.includes(`"${seoSnippetCutPoint(fit.visible)}"`)) &&
		String(dated.evidence.actual) !== String(longDescriptionFit.evidence.actual) && /publication date/.test(dated.limitation),
		JSON.stringify([dated, longDescriptionFit.evidence]));
}
const generatedFit = descriptionFit({ description: longDescription, descriptionSource: "generated" });
const nosnippetFit = descriptionFit({ description: longDescription, nosnippet: true });
check("a generated description asks for a written one, and nosnippet makes description fit not applicable",
	generatedFit.status === "review" && generatedFit.recommendation === "Write a description for this page." &&
	nosnippetFit.basis === "not-applicable" && /nosnippet/.test(nosnippetFit.detail),
	JSON.stringify([generatedFit, nosnippetFit]));

const broken = analyzeSeoContent(
	fixture({
		title: "",
		description: "",
		url: "",
		image: "",
		featuredImage: "",
		noindex: true,
		body: "",
		document: undefined,
		focusKeyword: undefined,
		schemaEnabled: false,
	}),
);
check("missing critical SEO data produces a poor score", broken.score <= 20, `got ${broken.score}`);
const brokenIndexing = broken.checks.find((item) => item.id === "indexability");
check(
	"published noindex is an excluded-from-search condition with zero weight",
	brokenIndexing?.condition === "excluded-from-search" && brokenIndexing.basis === "measured" &&
		brokenIndexing.weight === 0 && brokenIndexing.status === "review" && brokenIndexing.severity === "info",
	JSON.stringify(brokenIndexing),
);

// Noindex is shown as a condition, never as a quality failure or a cap.
const noindexedHealthyPost = analyzeSeoContent(
	fixture({ noindex: true, noindexSources: ["site-setting", "entry-seo"] }),
);
const noindexCondition = noindexedHealthyPost.checks.find((item) => item.id === "indexability");
check(
	"published noindex neither caps nor lowers an otherwise healthy score",
	noindexedHealthyPost.score === ideal.score && noindexedHealthyPost.status === "pass",
	`got ${noindexedHealthyPost.score} ${noindexedHealthyPost.status}`,
);
check(
	"the excluded-from-search condition names every actual directive source",
	noindexCondition?.label === "Excluded from search" &&
		noindexCondition.evidence.source.includes("site-wide noindex setting") &&
		noindexCondition.evidence.source.includes("seo.noIndex") &&
		noindexCondition.detail.includes("not part of the score"),
	noindexCondition?.evidence.source,
);
const indexableCheck = ideal.checks.find((item) => item.id === "indexability");
check(
	"a published entry without noindex reports the directive, not proof of indexing",
	indexableCheck?.status === "pass" && indexableCheck.basis === "measured" && indexableCheck.label === "Indexing directive" &&
		indexableCheck.weight === 0 && indexableCheck.severity === "info" &&
		/reach, crawl or index/.test(indexableCheck.limitation) && !/indexable\./i.test(indexableCheck.detail),
	JSON.stringify(indexableCheck),
);
for (const status of ["draft", "scheduled"]) {
	const unpublished = analyzeSeoContent(fixture({ publicationStatus: status }));
	const indexing = unpublished.checks.find((item) => item.id === "indexability");
	check(
		`a ${status} entry without noindex earns no public indexability pass`,
		indexing?.basis === "not-applicable" && indexing.status !== "pass" && indexing.weight === 0 &&
			indexing.detail.includes(`not published (${status})`) && unpublished.score === ideal.score,
		JSON.stringify(indexing),
	);
}
// The indexing directive never moves the score: imperfect content must score
// the same whether it is allowed, noindexed, a draft or scheduled.
for (const [name, imperfect] of [
	["no social or featured image", { image: "", featuredImage: "" }],
	["no description and thin body", { description: "", body: "useful words only", document: [block("Useful research connects messaging.")] }],
] as const) {
	const allowed = analyzeSeoContent(fixture(imperfect));
	const variants = [
		["noindex", analyzeSeoContent(fixture({ ...imperfect, noindex: true, noindexSources: ["entry-seo"] }))],
		["draft", analyzeSeoContent(fixture({ ...imperfect, publicationStatus: "draft" }))],
		["scheduled", analyzeSeoContent(fixture({ ...imperfect, publicationStatus: "scheduled" }))],
	] as const;
	for (const [variant, result] of variants) {
		check(
			`indexing state does not change the score of imperfect content (${name}, ${variant})`,
			result.score === allowed.score && result.status === allowed.status && result.grade === allowed.grade,
			`allowed ${allowed.score}/${allowed.status}, ${variant} ${result.score}/${result.status}`,
		);
	}
}
const unknownStatus = analyzeSeoContent(fixture({ publicationStatus: null }));
check(
	"an unreadable publication status is unavailable, never an indexing pass",
	unknownStatus.checks.some((item) => item.id === "indexability" && item.basis === "unavailable" && item.status === "review" && item.weight === 0),
);
check("blocking metadata failures control the aggregate status", broken.status === "fail");
check(
	"checks expose actionable evidence",
	broken.checks.every((item) => item.category && item.evidence.expected && item.evidence.source && item.recommendation),
);

const templatePage = analyzeSeoContent(
	fixture({
		ref: "pages:home",
		collection: "pages",
		entryId: "home",
		slug: "home",
		body: "",
		document: undefined,
		bodySource: "template",
		focusKeyword: undefined,
		schemaPreset: "WebPage",
	}),
);
const templateDepth = templatePage.checks.find((item) => item.id === "content-depth");
check(
	"template-managed body depth is unavailable, never a pass claiming rendered analysis",
	templateDepth?.basis === "unavailable" && templateDepth.status === "review" && templateDepth.weight === 0 &&
		/not observed/.test(templateDepth.detail) && !/evaluated in its template/.test(templateDepth.detail),
	JSON.stringify(templateDepth),
);
check(
	"every body-dependent template check is unavailable rather than passed",
	["content-depth", "heading-structure", "internal-links", "descriptive-link-text", "sentence-readability", "paragraph-length"].every((id) =>
		templatePage.checks.find((item) => item.id === id)?.basis === "unavailable"),
);
const templateLinks = templatePage.checks.find((item) => item.id === "descriptive-link-text");
check(
	"template-rendered link labels are a manual check, not not-applicable",
	templateLinks?.basis === "unavailable" && templateLinks.weight === 0 && templateLinks.status === "review" &&
		/not observed/.test(templateLinks.detail),
	JSON.stringify(templateLinks),
);
const emptyStructuredPage = analyzeSeoContent(fixture({ collection: "pages", ref: "pages:empty", body: "", document: [], assessmentProfile: { profile: "general", version: 1 } }));
check(
	"an empty editor-managed body without links stays not-applicable",
	emptyStructuredPage.checks.find((item) => item.id === "descriptive-link-text")?.basis === "not-applicable",
);
const templateKeyword = analyzeSeoContent(
	fixture({ collection: "pages", ref: "pages:home", bodySource: "template", body: "", document: undefined, assessmentProfile: { profile: "general", version: 1 } }),
);
check(
	"keyword body checks on a template page are unavailable with a keyword set",
	["keyword-introduction", "keyword-content", "keyword-heading"].every((id) =>
		templateKeyword.checks.find((item) => item.id === id)?.basis === "unavailable"),
);
check(
	"an unset focus keyword keeps every keyword check unweighted and non-failing",
	templatePage.checks
		.filter((item) => item.category === "keyword")
		.every((item) => item.weight === 0 && item.status !== "fail"),
);
check("template-managed and optional checks do not dilute the score", templatePage.score === 100, `got ${templatePage.score}`);

const missingPostKeyword = analyzeSeoContent(
	fixture({ focusKeyword: undefined }),
);
check(
	"a missing primary target is a Suggestion to add one, never a failure or score cap",
	missingPostKeyword.checks.some((item) => item.id === "focus-keyword" && item.basis === "measured" && item.status === "review" &&
		item.weight === 0 && /Add a focus keyword/.test(item.recommendation)) &&
		missingPostKeyword.checks.filter((item) => item.category === "keyword").every((item) => item.weight === 0) &&
		missingPostKeyword.calculation.limit === null && missingPostKeyword.status === "pass" && missingPostKeyword.score === 100 &&
		seoScoreDisplay(missingPostKeyword).qualifier === "No focus keyword",
	`${missingPostKeyword.score} ${missingPostKeyword.status}`,
);

const severelyThinPost = analyzeSeoContent(
	fixture({
		body: Array.from({ length: 90 }, () => "useful").join(" "),
		document: Array.from({ length: 9 }, () =>
			block("Useful research connects messaging and measurable demand."),
		),
	}),
);
const shortDepth = severelyThinPost.checks.find((item) => item.id === "content-depth");
check(
	"an article body of 50 to 99 words fails Body text length and limits the score to 70",
	shortDepth?.basis === "measured" && shortDepth.status === "fail" && shortDepth.weight === 10 &&
		shortDepth.evidence.actual === 63 && severelyThinPost.metrics.wordCount === 63 &&
		JSON.stringify(severelyThinPost.calculation.limit) === JSON.stringify({ reason: "thin-content", cap: 70, checkIds: ["content-depth"] }) &&
		severelyThinPost.score <= 70 && /Google sets no minimum word count/.test(shortDepth.detail),
	JSON.stringify(shortDepth),
);

const keywordMissingFromUrl = analyzeSeoContent(
	fixture({ slug: "demand-strategy", url: "https://shipitdigital.nl/blog/demand-strategy" }),
);

const keywordLateInTitle = analyzeSeoContent(
	fixture({ title: "A practical framework for measurable demand, careful planning and steady customer research across every channel with growth marketing" }),
);
const lateKeyword = keywordLateInTitle.checks.find((item) => item.id === "keyword-title-position");
check(
	"a keyword that phones may cut off is separate unweighted advice naming the cut point",
	lateKeyword?.status === "review" && lateKeyword.weight === 0 && lateKeyword.basis === "heuristic" &&
		/^Estimate: phones may cut the title after "\.\.\.[^"]+", before the focus keyword\.$/.test(lateKeyword.detail) &&
		keywordLateInTitle.checks.find((item) => item.id === "keyword-title")?.status === "pass" &&
		keywordLateInTitle.score === ideal.score,
	JSON.stringify(lateKeyword),
);
const urlAdvice = keywordMissingFromUrl.checks.find((item) => item.id === "keyword-url");
check(
	"focus keyword URL coverage is unweighted advice that notes redirects",
	urlAdvice?.status === "review" && urlAdvice.weight === 0 && classifySeoContentCheck(urlAdvice).role === "advisory" &&
		/redirect the old one/.test(urlAdvice.detail) && keywordMissingFromUrl.score === ideal.score,
	JSON.stringify(urlAdvice),
);
const opaqueSlug = analyzeSeoContent(
	fixture({ slug: "01JAB3C4D5E6F7G8H9JKMNPQRS", url: "https://shipitdigital.nl/blog/01JAB3C4D5E6F7G8H9JKMNPQRS" }),
);
const opaqueUrlCheck = opaqueSlug.checks.find((item) => item.id === "keyword-url");
check(
	"an opaque ULID slug makes Focus keyword in URL not applicable, not a missed keyword",
	opaqueUrlCheck?.basis === "not-applicable" && opaqueUrlCheck.weight === 0 &&
		opaqueUrlCheck.detail === "The saved slug is not readable words." &&
		urlAdvice?.basis === "heuristic" && opaqueSlug.score === ideal.score,
	JSON.stringify(opaqueUrlCheck),
);

// Fragment-only links and links back to this entry are not links to other pages.
function selfLinkDocument(otherHref?: string) {
	return [
		block("Growth marketing strategy foundations", { style: "h2" }),
		block("", {
			markDefs: [
				{ _key: "top", _type: "link", href: "#top" },
				{ _key: "self", _type: "link", href: "/blog/growth-marketing-strategy/" },
				{ _key: "selfAbsolute", _type: "link", href: "https://shipitdigital.nl/blog/growth-marketing-strategy#pricing" },
				...(otherHref ? [{ _key: "other", _type: "link", href: otherHref }] : []),
			],
			children: [
				span("Return to the "),
				span("start of this guide", ["top"]),
				span(", reread "),
				span("this growth marketing strategy", ["self"]),
				span(" or compare "),
				span("its pricing section", ["selfAbsolute"]),
				...(otherHref ? [span(" with "), span("our technical SEO service", ["other"])] : []),
				span("."),
			],
		}),
		...Array.from({ length: 45 }, () => block("Useful audience research connects clear messaging, measurement, channel strategy, and sustained demand.")),
	];
}
const selfLinksOnly = analyzeSeoContent(fixture({ document: selfLinkDocument() }));
const selfLinksAndOther = analyzeSeoContent(fixture({ document: selfLinkDocument("/services/seo-ai-visibility") }));
const selfLinksCheck = selfLinksOnly.checks.find((item) => item.id === "internal-links");
check(
	"only fragment and self links give 0 internal links and fail Internal links for an article",
	selfLinksOnly.metrics.internalLinkCount === 0 && selfLinksCheck?.status === "fail" && selfLinksCheck.evidence.actual === 0 &&
		selfLinksCheck.weight === 5,
	`${selfLinksOnly.metrics.internalLinkCount} ${JSON.stringify(selfLinksCheck)}`,
);
check(
	"a link to another page beside the same fragment and self links counts once",
	selfLinksAndOther.metrics.internalLinkCount === 1 &&
		selfLinksAndOther.checks.find((item) => item.id === "internal-links")?.status === "pass",
	String(selfLinksAndOther.metrics.internalLinkCount),
);

// Secondary keywords: one low-weight coverage check, never a multiplier.
const coveredSecondaries = analyzeSeoContent(
	fixture({
		focusKeywords: ["growth marketing", "measurable demand"],
	}),
);
check(
	"covered secondary keywords pass as unweighted coverage advice",
	coveredSecondaries.checks.some(
		(item) =>
			item.id === "secondary-keyword-coverage" &&
			item.status === "pass" &&
			item.weight === 0,
	),
);
const missingSecondaries = analyzeSeoContent(
	fixture({
		focusKeywords: ["growth marketing", "quantum basket weaving"],
	}),
);
const missingSecondaryCheck = missingSecondaries.checks.find(
	(item) => item.id === "secondary-keyword-coverage",
);
check(
	"missing secondary keywords are unweighted advice with evidence",
	missingSecondaryCheck?.status === "review" &&
		missingSecondaryCheck.severity === "info" &&
		missingSecondaryCheck.weight === 0 &&
		missingSecondaryCheck.detail.includes("quantum basket weaving") &&
		missingSecondaries.score === ideal.score,
);
check(
	"secondary keywords do not multiply the per-keyword checks",
	missingSecondaries.checks.filter((item) => item.category === "keyword").length ===
		analyzeSeoContent(fixture()).checks.filter((item) => item.category === "keyword").length,
);
check(
	"only the primary keyword drives the title check",
	missingSecondaries.checks.some(
		(item) => item.id === "keyword-title" && item.status === "pass",
	),
);

const missingFeaturedImage = analyzeSeoContent(
	fixture({ featuredImage: "" }),
);
check(
	"a missing featured image is unweighted article advice",
	missingFeaturedImage.checks.some(
		(item) => item.id === "featured-image" && item.status === "review" && item.weight === 0 && item.basis === "measured",
	) && missingFeaturedImage.score === ideal.score,
);

const mappedArticle = analyzeSeoContent(
	fixture({ collection: "articles", featuredImage: "", assessmentProfile: { profile: "article", version: 1 } }),
);
check(
	"an explicitly selected Article profile gets article advice on a custom collection",
	mappedArticle.checks.some(
		(item) => item.id === "featured-image" && item.status === "review" && item.basis === "measured" && item.weight === 0,
	) && mappedArticle.checks.find((item) => item.id === "focus-keyword")?.weight === 0,
);
const unmappedPost = analyzeSeoContent(fixture({ featuredImage: "", assessmentProfile: { profile: "general", version: 1 } }));
check(
	"posts mapped away from Blog posting drop the article-only advice",
	unmappedPost.checks.find((item) => item.id === "featured-image")?.basis === "not-applicable" &&
		unmappedPost.checks.find((item) => item.id === "focus-keyword")?.weight === 0,
);
check(
	"collection names do not override an explicit Article profile",
	analyzeSeoContent(fixture({ collection: "articles", featuredImage: "" }))
		.checks.find((item) => item.id === "featured-image")?.basis === "measured",
);

const draftNoindex = analyzeSeoContent(
	fixture({ noindex: true, publicationStatus: "draft" }),
);
check(
	"draft noindex is informational and unweighted",
	draftNoindex.checks.some(
		(item) => item.id === "indexability" && item.status === "review" && item.severity === "info" && item.weight === 0,
	),
);
check("draft noindex does not lower an otherwise healthy score", draftNoindex.score === 100, `got ${draftNoindex.score}`);

const canonicalReview = analyzeSeoContent(
	fixture({ canonicalStatus: "different-path" }),
);
check(
	"intentional canonical consolidation is separate advice and does not lower the score",
	canonicalReview.checks.some((item) => item.id === "url" && item.status === "pass") &&
		canonicalReview.checks.some((item) => item.id === "canonical-policy-review" && item.status === "review" && item.weight === 0) &&
		canonicalReview.score === ideal.score && canonicalReview.status === "pass",
);

const canonicalFailure = analyzeSeoContent(
	fixture({ url: "https://shipitdigital.nl/blog/growth-marketing-strategy#top", canonicalStatus: "query-or-fragment" }),
);
check(
	"a canonical fragment fails its row without a numeric cap; status and grade follow the band of the number",
	canonicalFailure.checks.some((item) => item.id === "url" && item.status === "fail" && item.detail.includes("fragment")) &&
		canonicalFailure.score === 91 && canonicalFailure.status === "pass" && canonicalFailure.grade === "good" &&
		canonicalFailure.calculation.limit === null &&
		canonicalFailure.score === Math.round(100 * (ideal.calculation.totalWeight - 8) / ideal.calculation.totalWeight),
	`${canonicalFailure.score}`,
);
const canonicalQuery = analyzeSeoContent(
	fixture({ url: "https://shipitdigital.nl/blog/growth-marketing-strategy?ref=newsletter", canonicalStatus: "query-or-fragment" }),
);
check("query parameters alone are not a malformed canonical",
	canonicalQuery.checks.find((item) => item.id === "url")?.status === "pass" && canonicalQuery.score === ideal.score);

const duplicateH1 = analyzeSeoContent(
	fixture({
		document: [block("Duplicate page heading", { style: "h1" }), ...idealDocument()],
	}),
);
const bodyH1 = duplicateH1.checks.find((item) => item.id === "heading-structure");
check(
	"a saved-body H1 is reviewed without asserting a rendered duplicate",
	bodyH1?.status === "review" && bodyH1.basis === "heuristic" && duplicateH1.metrics.h1Count === 1 &&
		/rendered page also shows a title H1 is not observed/.test(bodyH1.detail) && !/already owns H1/.test(bodyH1.detail),
	JSON.stringify(bodyH1),
);

const genericLink = analyzeSeoContent(
	fixture({
		document: [
			block("Growth marketing strategy foundations", { style: "h2" }),
			block("", {
				markDefs: [{ _key: "generic", _type: "link", href: "/services" }],
				children: [span("Click here", ["generic"]), span(" for the service list.")],
			}),
			...idealDocument().slice(3),
		],
	}),
);
check("generic anchor text is actionable", genericLink.checks.some((item) => item.id === "descriptive-link-text" && item.status === "review"));
const unlistedAnchor = analyzeSeoContent(
	fixture({
		document: [
			block("Growth marketing strategy foundations", { style: "h2" }),
			block("", {
				markDefs: [{ _key: "short", _type: "link", href: "/services" }],
				children: [span("x", ["short"]), span(" for the service list.")],
			}),
			...idealDocument().slice(3),
		],
	}),
);
const anchorCheck = unlistedAnchor.checks.find((item) => item.id === "descriptive-link-text");
check(
	"a dictionary miss is a heuristic match count, not descriptive quality",
	anchorCheck?.status === "pass" && anchorCheck.basis === "heuristic" && anchorCheck.label === "Link text" &&
		/listed generic phrase/.test(anchorCheck.detail) && !/descriptive/i.test(anchorCheck.detail) &&
		/describes its destination is not evaluated/.test(anchorCheck.limitation),
	JSON.stringify(anchorCheck),
);

const protocolRelativeLink = analyzeSeoContent(
	fixture({
		document: [
			block("Growth marketing strategy foundations", { style: "h2" }),
			block("", {
				markDefs: [{ _key: "external", _type: "link", href: "//example.com/research" }],
				children: [span("Independent research", ["external"]), span(" supports this plan.")],
			}),
			...idealDocument().slice(3),
		],
	}),
);
check("protocol-relative links are not mistaken for internal paths", protocolRelativeLink.metrics.externalLinkCount === 1);

const headingOnlyKeyword = analyzeSeoContent(
	fixture({
		document: [
			block("Growth marketing strategy foundations", { style: "h2" }),
			...Array.from({ length: 45 }, () => block("Clear research connects useful messaging, measurement, and sustained customer demand.")),
		],
	}),
);
check("heading keywords do not satisfy the introduction check", headingOnlyKeyword.checks.some((item) => item.id === "keyword-introduction" && item.status === "review"));
check("a keyword in a subheading counts as body text", headingOnlyKeyword.checks.some((item) => item.id === "keyword-content" && item.status === "pass" && item.evidence.actual === 1));
check("heading keyword placement is evaluated separately", headingOnlyKeyword.checks.some((item) => item.id === "keyword-heading" && item.status === "pass"));

const repetitiveKeywordBody = analyzeSeoContent(
	fixture({
		document: [
			block("Growth marketing strategy foundations", { style: "h2" }),
			...Array.from({ length: 30 }, () =>
				block(
					"Growth marketing growth marketing growth marketing supports measurable demand.",
				),
			),
		],
	}),
);
const repetitionHint = repetitiveKeywordBody.checks.find((item) => item.id === "keyword-repetition");
check(
	"mechanical repetition fails Focus keyword repetition and limits the score to 79",
	repetitiveKeywordBody.checks.find((item) => item.id === "keyword-content")?.status === "pass" &&
		repetitionHint?.status === "fail" && repetitionHint.weight === 4 && repetitionHint.severity === "medium" &&
		repetitionHint.evidence.actual === 91 && repetitiveKeywordBody.metrics.wordCount === 274 &&
		/91 times in 274 words \(33\.2%\)/.test(repetitionHint.detail) && classifySeoContentCheck(repetitionHint).eligible &&
		repetitiveKeywordBody.calculation.limits.some((limit) => limit.reason === "keyword-repetition" && limit.cap === 79) &&
		repetitiveKeywordBody.score <= 79,
	JSON.stringify(repetitionHint),
);

const nearTargetDepth = analyzeSeoContent(
	fixture({
		body: Array.from({ length: 400 }, () => "useful").join(" "),
		document: Array.from({ length: 40 }, () =>
			block("Growth marketing connects useful research, messaging, measurement, and demand."),
		),
	}),
);
check(
	"an article body of 300 to 599 words partly meets Body text length and is limited to 70",
	nearTargetDepth.checks.some((item) => item.id === "content-depth" && item.status === "review" && item.weight === 10 &&
		item.evidence.actual === 360 && item.evidence.actual === nearTargetDepth.metrics.wordCount &&
		item.evidence.expected === "600 or more words of body text (checklist guideline)" && /Google sets no word count/.test(item.limitation)) &&
		nearTargetDepth.calculation.limit?.reason === "thin-content" && nearTargetDepth.calculation.limit.cap === 70 && nearTargetDepth.score <= 70,
);

const denseSentence = Array.from({ length: 45 }, (_, index) => `word${index}`).join(" ");
const denseCopy = analyzeSeoContent(
	fixture({
		document: [
			block("Growth marketing strategy foundations", { style: "h2" }),
			block(`${denseSentence}.`),
			block(`${denseSentence}.`),
			block(`${denseSentence}.`),
		],
	}),
);
check("very long average sentences are reviewed, never failed", denseCopy.checks.some((item) => item.id === "sentence-readability" && item.status === "review" && item.weight === 4));

const plainTextOnly = analyzeSeoContent(
	fixture({ document: undefined }),
);
check(
	"missing structured data is transparent and unweighted",
	plainTextOnly.checks
		.filter((item) => ["heading-structure", "internal-links", "descriptive-link-text"].includes(item.id))
		.every((item) => item.weight === 0),
);
const plainTextKeyword = analyzeSeoContent(fixture({ document: undefined, focusKeywords: ["growth marketing"] }));
check(
	"a plain-text body cannot hold headings or links, so those rows do not apply instead of reading Not checked",
	["heading-structure", "keyword-heading", "internal-links", "descriptive-link-text"].every((id) => {
		const item = plainTextKeyword.checks.find((candidate) => candidate.id === id);
		return item?.basis === "not-applicable" && /plain text, which cannot hold/.test(item.detail);
	}),
	JSON.stringify(plainTextKeyword.checks.filter((item) => /heading|link/.test(item.id)).map((item) => [item.id, item.basis, item.detail])),
);

const missingImageAlt = analyzeSeoContent(
	fixture({
		document: [...idealDocument(), image()],
		contentImages: [{ source: "featured_image", value: { id: "hero", src: "/uploads/hero.webp" } }],
	}),
);
check(
	"missing alt attributes of body images fail with a bounded count, without a numeric cap",
	missingImageAlt.metrics.imageMissingAltCount === 2 &&
		missingImageAlt.checks.some((item) => item.id === "image-alt-text" && item.status === "fail" && item.evidence.actual === 1 &&
			item.detail === "1 of 2 body images has no alt attribute.") &&
		missingImageAlt.score === Math.round(100 * (ideal.calculation.totalWeight - 6) / ideal.calculation.totalWeight) &&
		missingImageAlt.status === "pass" && missingImageAlt.calculation.limit === null,
	`${missingImageAlt.score} ${missingImageAlt.status}`,
);

const emptyAltImage = analyzeSeoContent(
	fixture({ document: [image("")], contentImages: [] }),
);
check(
	"an explicit empty alt passes attribute presence and keeps a separate unweighted purpose review",
	emptyAltImage.metrics.imageDecorativeCount === 1 &&
		emptyAltImage.checks.some((item) => item.id === "image-alt-text" && item.status === "pass" && item.weight === 6) &&
		emptyAltImage.checks.some((item) => item.id === "image-empty-alt-review" && item.status === "review" && item.weight === 0 && item.severity === "info"),
);

const mixedImageAlt = analyzeSeoContent(
	fixture({
		document: [image("Quarterly organic traffic chart"), image("")],
		contentImages: [],
	}),
);
check(
	"mixed descriptive and empty alt values keep a separate review",
	mixedImageAlt.checks.some((item) => item.id === "image-alt-text" && item.status === "pass") &&
		mixedImageAlt.checks.some(
			(item) =>
				item.id === "image-empty-alt-review" &&
				item.status === "review" &&
				item.weight === 0 &&
				item.evidence.actual === 1,
		),
);

const tiptapImage = analyzeSeoContent(
	fixture({
		document: {
			type: "doc",
			content: [{ type: "image", attrs: { src: "/uploads/chart.png", alt: "Quarterly organic traffic chart" } }],
		},
		contentImages: [],
	}),
);
check("TipTap image nodes are measured", tiptapImage.metrics.imageCount === 1 && tiptapImage.metrics.imageAltCount === 1);
const placeholderAlt = analyzeSeoContent(fixture({ document: [...idealDocument().slice(0, 1), image("img"), ...idealDocument().slice(2)], contentImages: [] }));
const placeholderAltCheck = placeholderAlt.checks.find((item) => item.id === "image-alt-text");
check(
	"nonempty alt text is measured as presence, never as descriptive quality",
	placeholderAltCheck?.status === "pass" && placeholderAltCheck.basis === "measured" &&
		placeholderAltCheck.detail === "The body image has an alt attribute." && !/descriptive/i.test(placeholderAltCheck.detail) &&
		/descriptive quality[^.]*not verified/.test(placeholderAltCheck.limitation),
	JSON.stringify(placeholderAltCheck),
);

// The host's featured image picker stores alt "" when the media item has none; image fields are not body images.
const featuredEmptyAlt = analyzeSeoContent(fixture({
	document: idealDocument(),
	contentImages: [{ source: "featured_image", value: { id: "hero", src: "/uploads/hero.webp", alt: "" } }],
}));
const featuredEmptyAltCheck = featuredEmptyAlt.checks.find((item) => item.id === "image-alt-text");
check(
	"a featured image with empty or missing alt adds no alt row, count or empty-alt advice",
	featuredEmptyAlt.metrics.imageDecorativeCount === 1 && featuredEmptyAltCheck?.status === "pass" &&
		featuredEmptyAltCheck.evidence.actual === 0 && featuredEmptyAltCheck.detail === "The body image has an alt attribute." &&
		!featuredEmptyAlt.checks.some((item) => item.id === "image-empty-alt-review") && featuredEmptyAlt.score === ideal.score,
	JSON.stringify(featuredEmptyAltCheck),
);
const featuredOnly = analyzeSeoContent(fixture({
	document: idealDocument().filter((node) => node._type !== "image"),
	contentImages: [{ source: "featured_image", value: { id: "hero", src: "/uploads/hero.webp" } }],
}));
check(
	"a featured image alone leaves Image alt text not applicable",
	featuredOnly.checks.find((item) => item.id === "image-alt-text")?.basis === "not-applicable" &&
		featuredOnly.checks.find((item) => item.id === "image-alt-text")?.detail === "No images in the body text.",
	JSON.stringify(featuredOnly.checks.find((item) => item.id === "image-alt-text")),
);
const singleEmptyAlt = analyzeSeoContent(fixture({ document: [image("")], contentImages: [] }));
check(
	"one empty body alt is reported in the singular",
	singleEmptyAlt.checks.find((item) => item.id === "image-empty-alt-review")?.detail === "1 body image uses explicit empty alt.",
	singleEmptyAlt.checks.find((item) => item.id === "image-empty-alt-review")?.detail,
);

const disabledImageSeo = analyzeSeoContent(
	fixture({ document: [image()], contentImages: [], imageSeoEnabled: false }),
);
check(
	"disabled Image SEO never changes the weighted score",
	disabledImageSeo.checks.some((item) => item.id === "image-alt-text" && item.status === "review" && item.weight === 0),
);

// --- Pillar intent: context only, without word-count or link quotas --------
const standardDepth = analyzeSeoContent(fixture());
const pillarDepth = analyzeSeoContent(fixture({ pillar: true }));
const standardDepthCheck = standardDepth.checks.find((item) => item.id === "content-depth");
const pillarDepthCheck = pillarDepth.checks.find((item) => item.id === "content-depth");
check(
	"pillar intent adds no word-count target beyond the article guidance",
	pillarDepthCheck?.evidence.expected === standardDepthCheck?.evidence.expected &&
		pillarDepthCheck?.status === standardDepthCheck?.status && pillarDepthCheck?.weight === 10 &&
		pillarDepthCheck?.evidence.expected === "600 or more words of body text (checklist guideline)",
	String(pillarDepthCheck?.evidence.expected),
);
const pillarLinks = pillarDepth.checks.find((item) => item.id === "internal-links");
check(
	"pillar intent adds no internal-link quota",
	pillarLinks?.status === "pass" && pillarLinks.weight === 5 && pillarDepth.score === standardDepth.score,
	`${pillarLinks?.status} ${pillarDepth.score}/${standardDepth.score}`,
);
check(
	"pillar never changes the score version contract",
	pillarDepth.scoreVersion === standardDepth.scoreVersion,
);
const pillarPage = analyzeSeoContent(fixture({ pillar: true, collection: "pages", assessmentProfile: { profile: "general", version: 1 } }));
check(
	"pillar pages keep the same saved-text observation as other general pages",
	JSON.stringify(pillarPage.checks.find((item) => item.id === "content-depth")) === JSON.stringify(
		analyzeSeoContent(fixture({ collection: "pages", assessmentProfile: { profile: "general", version: 1 } }))
			.checks.find((item) => item.id === "content-depth")) &&
		pillarPage.checks.find((item) => item.id === "content-depth")?.weight === 0,
);

// --- Evaluation basis, sources and score invariance ------------------------
const titleFromTemplate = analyzeSeoContent(fixture({ titleSource: "template", descriptionSource: "content" }));
const titleCheck = titleFromTemplate.checks.find((item) => item.id === "title");
check(
	"the title presence row names the resolver source, stores no title text and never claims the served <title>",
	titleCheck?.evidence.source === "Resolved title suggestion: metadata template" &&
		titleCheck.label === "Title" && titleCheck.evidence.actual === true && /served <title> element/.test(titleCheck.limitation) &&
		titleFromTemplate.checks.find((item) => item.id === "description")?.evidence.source === "Resolved meta description: content excerpt or body" &&
		titleFromTemplate.checks.find((item) => item.id === "keyword-title")?.evidence.source === "Resolved title suggestion: metadata template",
	JSON.stringify(titleCheck),
);
check(
	"no check labels a template or content title as seo.title",
	titleFromTemplate.checks.every((item) => !item.evidence.source.includes("seo.title")),
);
check(
	"a core SEO title keeps its actual field as the source",
	analyzeSeoContent(fixture({ titleSource: "core-seo" })).checks.find((item) => item.id === "title")?.evidence.source ===
		"Resolved title suggestion: entry SEO title",
);
{
	const socialRow = (imageSource: SeoAnalysisInput["imageSource"]) =>
		analyzeSeoContent(fixture({ image: "https://example.invalid/share.jpg", imageSource })).checks.find((item) => item.id === "social-image")?.detail;
	check("the social image row names a site-wide or featured image instead of calling it the entry's own",
		socialRow("site-default") === "This entry shares the site-wide social image." &&
		socialRow("content") === "This entry shares its featured image." &&
		socialRow("core-seo") === "A social image is set for this entry.",
		JSON.stringify([socialRow("site-default"), socialRow("content"), socialRow("core-seo")]));
}
check(
	"evidence sources name fields in words, not storage keys",
	analyzeSeoContent(fixture({ titleSource: "core-seo", descriptionSource: "core-seo" })).checks.every((item) => !/\(seo\./.test(item.evidence.source)),
);
const allFixtures = [ideal, broken, templatePage, templateKeyword, duplicateH1, genericLink, plainTextOnly, emptyAltImage,
	mixedImageAlt, disabledImageSeo, noindexedHealthyPost, unknownStatus, missingPostKeyword, placeholderAlt, unlistedAnchor,
	severelyThinPost, canonicalReview, canonicalFailure, canonicalQuery, missingImageAlt, repetitiveKeywordBody];
{
	const storageKey = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/i;
	const shown = allFixtures.flatMap((result) => result.checks.map((item) => ({ id: item.id, source: item.evidence.source, detail: item.detail })));
	check("the storage-key search finds a snake_case field name", storageKey.test("body_source") && storageKey.test("content featured_image / image field"));
	check(
		"evidence sources in every fixture name fields in words, never snake_case storage keys",
		shown.length > 0 && shown.every((item) => !storageKey.test(item.source)),
		shown.filter((item) => storageKey.test(item.source)).map((item) => `${item.id}: ${item.source}`).join(", "),
	);
	check(
		"template-managed and image rows read words for their sources",
		templatePage.checks.some((item) => item.basis === "unavailable" && item.evidence.source === "body source field: template") &&
			ideal.checks.find((item) => item.id === "featured-image")?.evidence.source === "saved featured image or image field",
		JSON.stringify(templatePage.checks.filter((item) => item.basis === "unavailable").map((item) => item.evidence.source)),
	);
	check(
		"check details never describe the analyzer's internals",
		shown.every((item) => !/\bresolver\b/i.test(item.detail)) &&
			ideal.checks.find((item) => item.id === "schema")?.detail === "Saved settings add BlogPosting schema to this page.",
		shown.filter((item) => /\bresolver\b/i.test(item.detail)).map((item) => `${item.id}: ${item.detail}`).join(", "),
	);
}
check(
	"every current check carries a known basis and a limitation the shared validator accepts",
	allFixtures.every((result) => result.checks.every((item) => seoContentCheckProblem(item, true) === null)),
	allFixtures.flatMap((result) => result.checks.filter((item) => seoContentCheckProblem(item, true) !== null).map((item) => `${item.id}:${seoContentCheckProblem(item, true)}`)).join(", "),
);
check(
	"unavailable and not-applicable checks carry no weight, never fail, and unavailable never passes",
	allFixtures.every((result) => result.checks.every((item) =>
		(item.basis !== "unavailable" && item.basis !== "not-applicable") ||
		(item.weight === 0 && item.status !== "fail" && (item.basis !== "unavailable" || item.status === "review")))),
);
const urlCheckOf = (result: ReturnType<typeof analyzeSeoContent>) => result.checks.find((item) => item.id === "url")!;
const unscored = (id: string): SeoContentCheck => ({
	id, label: id, category: "content", severity: "info", status: "review", weight: 0, detail: "", recommendation: "",
	evidence: { actual: null, expected: "", source: "" }, basis: "unavailable", limitation: "not observed",
});
check(
	"adding or removing unavailable checks never changes the score",
	calculateSeoScore([...ideal.checks, unscored("a"), unscored("b")]).score === calculateSeoScore(ideal.checks).score &&
		calculateSeoScore(templatePage.checks.filter((item) => item.basis !== "unavailable" && item.basis !== "not-applicable")).score === templatePage.score,
);
let weightedUnavailableRefused = false;
try {
	calculateSeoScore([...ideal.checks.filter((item) => item.id !== "url"),
		{ ...urlCheckOf(ideal), status: "fail", weight: 8, basis: "unavailable" }]);
} catch { weightedUnavailableRefused = true; }
check("a weighted check marked unavailable is refused rather than silently ignored", weightedUnavailableRefused);
const validCheck = ideal.checks.find((item) => item.id === "title")!;
const validatorCases: Array<[string, unknown, boolean, boolean]> = [
	["unknown basis", { ...validCheck, basis: "verified" }, true, false],
	["missing limitation", { ...validCheck, limitation: "" }, true, false],
	["current check without basis", { ...validCheck, basis: undefined, limitation: undefined }, true, false],
	["legacy check without basis", (({ basis: _basis, limitation: _limitation, ...legacy }) => legacy)(validCheck), false, true],
	["weighted not-applicable", { ...unscored("x"), basis: "not-applicable", weight: 3 }, true, false],
	["passed unavailable", { ...unscored("x"), status: "pass" }, true, false],
	["condition on a scored policy row", { ...validCheck, condition: "excluded-from-search" }, true, false],
	["condition on a heuristic", { ...ideal.checks.find((item) => item.id === "keyword-title")!, condition: "excluded-from-search", weight: 0, severity: "info" }, true, false],
	["title presence carrying metadata text", { ...validCheck, evidence: { ...validCheck.evidence, actual: "Growth marketing strategy" } }, true, false],
	["title presence that disagrees with its status", { ...validCheck, status: "fail" }, true, false],
	["a scored row with a non-policy weight", { ...validCheck, weight: 10 }, true, false],
	["an advisory failure", { ...ideal.checks.find((item) => item.id === "focus-keyword")!, status: "fail" }, true, false],
	["an unknown weighted row", { ...unscored("custom-weighted"), basis: "measured", status: "pass", weight: 2, severity: "low" }, true, false],
	["an unknown unweighted advisory row", { ...unscored("custom-note"), basis: "measured" }, true, true],
	["a legacy weighted row", { ...validCheck, weight: 10 }, false, true],
	["unknown condition", { ...noindexCondition, condition: "hidden" }, true, false],
	["unknown status", { ...validCheck, status: "ok" }, true, false],
	["the excluded condition", noindexCondition, true, true],
];
for (const [name, value, current, accepted] of validatorCases) {
	check(`validator: ${name} is ${accepted ? "accepted" : "refused"}`, (seoContentCheckProblem(value, current) === null) === accepted);
}

const substringKeyword = analyzeSeoContent(fixture({ focusKeyword: "art", title: "Smart dental planning for local patients" }));
check("a substring inside Smart is not rewarded as early keyword placement",
	substringKeyword.checks.find((item) => item.id === "keyword-title")?.status === "fail" &&
	substringKeyword.checks.find((item) => item.id === "keyword-title-position")?.basis === "not-applicable");
const templateSecondary = analyzeSeoContent(fixture({ bodySource: "template", document: undefined, body: "", focusKeywords: ["growth marketing", "unobserved template phrase"] }));
check("unobserved template copy cannot fail secondary whole-page coverage",
	templateSecondary.checks.find((item) => item.id === "secondary-keyword-coverage")?.basis === "unavailable" &&
	templateSecondary.checks.find((item) => item.id === "secondary-keyword-coverage")?.weight === 0);
const observedTemplateSecondary = analyzeSeoContent(fixture({ bodySource: "template", document: undefined, body: "", focusKeywords: ["growth marketing", "measurable demand"] }));
check("secondary keywords observed in metadata still establish coverage on a template page",
	observedTemplateSecondary.checks.find((item) => item.id === "secondary-keyword-coverage")?.status === "pass");
const unusedTemplateBody = analyzeSeoContent(fixture({ bodySource: "template", document: undefined, body: "unobserved template phrase", focusKeywords: ["growth marketing", "unobserved template phrase"] }));
check("unused saved body text cannot claim template secondary coverage",
	unusedTemplateBody.checks.find((item) => item.id === "secondary-keyword-coverage")?.basis === "unavailable");
const editorialIds = ["focus-keyword", "featured-image", "content-depth", "heading-structure"];
const noAutomaticSchema = analyzeSeoContent(fixture({ schemaEnabled: false, schemaPreset: "None" }));
check("changing schema output preserves the selected editorial checks",
	JSON.stringify(ideal.checks.filter((item) => editorialIds.includes(item.id))) === JSON.stringify(noAutomaticSchema.checks.filter((item) => editorialIds.includes(item.id))));
let refusedProfile = false;
try { analyzeSeoContent(fixture({ assessmentProfile: undefined })); } catch { refusedProfile = true; }
check("the pure analyzer refuses missing assessment purpose rather than inferring posts", refusedProfile);
check("score arithmetic reports exact passing applicable weight", ideal.calculation.earnedWeight === ideal.calculation.totalWeight && ideal.calculation.score === 100 && ideal.calculation.limit === null);
check("a high-severity failure lowers the number without a numeric cap; the band sets the status", canonicalFailure.calculation.score === canonicalFailure.score && canonicalFailure.calculation.rawScore === canonicalFailure.score && canonicalFailure.calculation.limit === null && canonicalFailure.calculation.limits.length === 0 && canonicalFailure.status === "pass");
check("coverage counts every check without treating unavailable or inapplicable as weighted passes",
	templatePage.coverage.evaluated + templatePage.coverage.unweighted + templatePage.coverage.unavailable + templatePage.coverage.notApplicable === templatePage.checks.length &&
	templatePage.coverage.unavailable >= 6 && templatePage.calculation.totalWeight === templatePage.checks.reduce((total, item) => total + item.weight, 0));

const keywordEvidenceCheck = (result: ReturnType<typeof analyzeSeoContent>, id: string) =>
	result.checks.find((item) => item.id === id)!;
const splitHeadings = analyzeSeoContent(fixture({
	focusKeyword: "dental implants",
	document: [block("Dental", { style: "h2" }), block("implants", { style: "h2" }), block("Patient planning notes.")],
}));
check("separate headings cannot invent one keyword phrase",
	keywordEvidenceCheck(splitHeadings, "keyword-heading").status === "review");
const completeHeading = analyzeSeoContent(fixture({
	focusKeyword: "dental implants",
	document: [block("Dental implants explained", { style: "h2" }), block("Patient planning notes.")],
}));
check("a complete phrase in one heading remains valid evidence",
	keywordEvidenceCheck(completeHeading, "keyword-heading").status === "pass");

for (const bodySource of ["editor", "template"]) {
	const splitMetadata = analyzeSeoContent(fixture({
		title: "A guide to dental", description: "Implants explained for patients", bodySource,
		focusKeywords: ["growth marketing", "dental implants"],
	}));
	const coverage = keywordEvidenceCheck(splitMetadata, "secondary-keyword-coverage");
	check(`${bodySource} metadata fields cannot invent secondary coverage`,
		bodySource === "template"
			? coverage.basis === "unavailable" && coverage.weight === 0
			: coverage.status === "review" && coverage.evidence.actual === "0/1 covered");
}

for (const [format, document] of [
	["Portable Text", [block("Growth marketing guide", { style: "h2" })]],
	["Tiptap", { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Growth marketing guide" }] }] }],
] as const) {
	const signals = extractSeoDocumentSignals(document, "Growth marketing guide");
	const result = analyzeSeoContent(fixture({ document, body: "Growth marketing guide" }));
	check(`${format} headings alone do not become prose or paragraphs`,
		signals.structured && signals.proseText === "" && signals.introductionText === "" &&
		signals.paragraphCount === 0 && signals.sentenceCount === 0 && signals.wordCount === 3);
	check(`${format} headings alone count as body text but leave the introduction and paragraphs not applicable`,
		keywordEvidenceCheck(result, "keyword-content").status === "pass" &&
		keywordEvidenceCheck(result, "keyword-introduction").basis === "not-applicable" &&
		keywordEvidenceCheck(result, "paragraph-length").basis === "not-applicable");
}

const splitProse = analyzeSeoContent(fixture({
	focusKeyword: "dental implants", focusKeywords: ["dental implants", "planning notes"],
	document: [block("Dental"), block("implants"), block("planning"), block("notes")],
}));
check("separate paragraphs cannot invent body, introduction or secondary matches",
	keywordEvidenceCheck(splitProse, "keyword-content").status === "fail" &&
	["keyword-introduction", "secondary-keyword-coverage"].every((id) =>
		keywordEvidenceCheck(splitProse, id).status === "review"));
const inlinePhrase = analyzeSeoContent(fixture({
	focusKeyword: "dental implants",
	document: [block("", { children: [span("Dental "), span("implants", ["strong"]), span(" planning.")] })],
}));
check("inline formatting within one paragraph preserves literal phrase evidence",
	["keyword-content", "keyword-introduction"].every((id) => keywordEvidenceCheck(inlinePhrase, id).status === "pass"));
const plainPhrase = analyzeSeoContent(fixture({
	focusKeyword: "dental implants", document: undefined, body: "Dental implants planning.",
}));
check("plain-text fallback still supplies actual prose evidence",
	["keyword-content", "keyword-introduction"].every((id) => keywordEvidenceCheck(plainPhrase, id).status === "pass"));
for (const [format, makeDocument] of [
	["Portable Text", (parts: string[]) => [block("", { children: parts.map((text) => span(text)) })]],
	["Tiptap", (parts: string[]) => ({ type: "doc", content: [{ type: "paragraph", content: parts.map((text) => ({ type: "text", text })) }] })],
] as const) {
	for (const [parts, expected] of [[["dent", "al care"], "pass"], [["dental", "care"], "review"]] as const) {
		const inlineBoundary = analyzeSeoContent(fixture({ focusKeyword: "dental care", document: makeDocument([...parts]) }));
		check(`${format} inline fragments ${expected === "pass" ? "preserve a split word" : "do not invent a space"}`,
			keywordEvidenceCheck(inlineBoundary, "keyword-content").status === (expected === "pass" ? "pass" : "fail") &&
			keywordEvidenceCheck(inlineBoundary, "keyword-introduction").status === expected);
	}
}

const repeatedProse = `Growth marketing growth marketing growth marketing growth marketing ${Array.from({ length: 92 }, () => "useful").join(" ")}`;
const proseOnly = analyzeSeoContent(fixture({ document: [block(repeatedProse)] }));
const proseWithHeading = analyzeSeoContent(fixture({ document: [
	block(Array.from({ length: 20 }, () => "planning").join(" "), { style: "h2" }), block(repeatedProse),
] }));
const proseOnlyRepetition = keywordEvidenceCheck(proseOnly, "keyword-repetition");
const headedRepetition = keywordEvidenceCheck(proseWithHeading, "keyword-repetition");
check("a two-word phrase used 4 times in 100 words is a 4% share and fails repetition",
	keywordEvidenceCheck(proseOnly, "keyword-content").status === "pass" && proseOnly.metrics.wordCount === 100 &&
	proseOnlyRepetition.status === "fail" && proseOnlyRepetition.evidence.actual === 4 &&
	proseOnlyRepetition.detail.includes("4 times in 100 words (4%)"), JSON.stringify(proseOnlyRepetition));
check("heading words are body words, so they count in the repetition share",
	proseWithHeading.metrics.wordCount === 120 && headedRepetition.status === "pass" && headedRepetition.evidence.actual === 4 &&
	headedRepetition.detail === "The focus keyword appears 4 times in 120 words.", JSON.stringify(headedRepetition));
const shortRepeatedProse = `Growth marketing growth marketing ${Array.from({ length: 6 }, () => "useful").join(" ")}`;
const shortProseWithHeading = analyzeSeoContent(fixture({ document: [block(shortRepeatedProse)] }));
const shortRepetition = keywordEvidenceCheck(shortProseWithHeading, "keyword-repetition");
check("repetition does not score a body below the minimum sample, even with two uses",
	keywordEvidenceCheck(shortProseWithHeading, "keyword-content").status === "pass" &&
	shortProseWithHeading.metrics.wordCount === 10 && shortRepetition.basis === "not-applicable" &&
	shortRepetition.status === "review" && shortRepetition.evidence.actual === null && shortRepetition.weight === 0,
	JSON.stringify(shortRepetition));

for (const [prefixWords, expected] of [[118, "pass"], [119, "review"]] as const) {
	const introductionBoundary = analyzeSeoContent(fixture({
		focusKeyword: "dental implants",
		document: [block(Array.from({ length: 60 }, () => "useful").join(" ")),
			block(`${Array.from({ length: prefixWords - 60 }, () => "useful").join(" ")} dental implants`)],
	}));
	check(`the introduction's 120-word window ${expected === "pass" ? "includes" : "excludes"} a phrase at ${prefixWords + 1}`,
		keywordEvidenceCheck(introductionBoundary, "keyword-introduction").status === expected);
}

function readabilityWords(length: number): string {
	return Array.from({ length }, () => "useful").join(" ");
}

for (const [format, makeDocument, inlineDocument] of [
	["Portable Text", (paragraphs: string[], heading = "") => [
		...(heading ? [block(heading, { style: "h2" })] : []),
		...paragraphs.map((paragraph) => block(paragraph)),
	], [block("", { children: [
		span("Clear plann", ["strong"]), span("ing "), span(`${readabilityWords(18)}\n`),
		span(`${readabilityWords(20)}. ${readabilityWords(20)}.`),
	] })]],
	["Tiptap", (paragraphs: string[], heading = "") => ({ type: "doc", content: [
		...(heading ? [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: heading }] }] : []),
		...paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
	] }), { type: "doc", content: [{ type: "paragraph", content: [
		{ type: "text", text: "Clear plann", marks: [{ type: "bold" }] },
		{ type: "text", text: "ing " }, { type: "text", text: readabilityWords(18) },
		{ type: "hardBreak" }, { type: "text", text: `${readabilityWords(20)}. ${readabilityWords(20)}.` },
	] }] }],
] as const) {
	for (const proseWords of [59, 60]) {
		const paragraphs = [20, 20, proseWords - 40].map((words) => `${readabilityWords(words)}.`);
		const plainDocument = makeDocument(paragraphs);
		const headedDocument = makeDocument(paragraphs, readabilityWords(57));
		const plainResult = analyzeSeoContent(fixture({ document: plainDocument }));
		const headedResult = analyzeSeoContent(fixture({ document: headedDocument }));
		const plainCheck = keywordEvidenceCheck(plainResult, "sentence-readability");
		const headedCheck = keywordEvidenceCheck(headedResult, "sentence-readability");
		const headedSignals = extractSeoDocumentSignals(headedDocument);
		check(`${format} ${proseWords} prose words preserve separate total and prose counts`,
			headedSignals.wordCount === proseWords + 57 && headedSignals.proseWordCount === proseWords &&
			headedSignals.sentenceCount === 3 && headedResult.metrics.wordCount === proseWords + 57);
		check(`${format} ${proseWords} prose words ${proseWords === 60 ? "activate" : "do not activate"} sentence readability`,
			proseWords === 60
				? plainCheck.status === "pass" && plainCheck.basis === "heuristic" && plainCheck.weight === 4
				: plainCheck.basis === "not-applicable" && plainCheck.weight === 0);
		check(`${format} headings cannot change sentence evidence at ${proseWords} prose words`,
			JSON.stringify(plainCheck) === JSON.stringify(headedCheck));
	}

	const shortSample = analyzeSeoContent(fixture({
		document: makeDocument(["Yes. No. Maybe."], readabilityWords(57)),
	}));
	check(`${format} a heading cannot qualify three one-word sentences`,
		shortSample.metrics.wordCount === 60 && shortSample.metrics.sentenceCount === 3 &&
		keywordEvidenceCheck(shortSample, "sentence-readability").basis === "not-applicable" &&
		keywordEvidenceCheck(shortSample, "sentence-readability").weight === 0);
	const twoSentences = analyzeSeoContent(fixture({
		document: makeDocument([`${readabilityWords(30)}.`, `${readabilityWords(30)}.`]),
	}));
	check(`${format} 60 prose words still require three sentence segments`,
		twoSentences.metrics.sentenceCount === 2 &&
		keywordEvidenceCheck(twoSentences, "sentence-readability").basis === "not-applicable" &&
		keywordEvidenceCheck(twoSentences, "sentence-readability").weight === 0);

	for (const { name, paragraphs } of [
		{ name: "mixed punctuation", paragraphs: [readabilityWords(20), ...Array.from({ length: 3 }, () => `${readabilityWords(20)}.`)] },
		{ name: "unterminated paragraphs", paragraphs: Array.from({ length: 3 }, () => readabilityWords(20)) },
		{ name: "punctuated paragraphs", paragraphs: Array.from({ length: 4 }, () => `${readabilityWords(20)}.`) },
	]) {
		const result = analyzeSeoContent(fixture({ document: makeDocument(paragraphs) }));
		check(`${format} ${name} preserve independent sentence segments`,
			result.metrics.sentenceCount === paragraphs.length && result.metrics.averageSentenceWords === 20 &&
			result.metrics.paragraphCount === paragraphs.length && result.metrics.longestParagraphWords === 20 &&
			keywordEvidenceCheck(result, "sentence-readability").status === "pass");
	}

	const inlineSignals = extractSeoDocumentSignals(inlineDocument);
	const inlineResult = analyzeSeoContent(fixture({ document: inlineDocument, focusKeyword: "clear planning" }));
	check(`${format} inline marks and a hard break preserve words within one paragraph`,
		inlineSignals.proseText.startsWith("Clear planning ") && inlineSignals.wordCount === 60 &&
		inlineSignals.proseWordCount === 60 && inlineSignals.paragraphCount === 1 &&
		inlineSignals.longestParagraphWords === 60 && inlineSignals.sentenceCount === 2 &&
		inlineSignals.averageSentenceWords === 30 &&
		keywordEvidenceCheck(inlineResult, "keyword-content").status === "pass" &&
		keywordEvidenceCheck(inlineResult, "sentence-readability").basis === "not-applicable");

	for (const [words, expected] of [[120, "pass"], [121, "review"], [180, "review"], [181, "review"], [400, "review"]] as const) {
		const result = analyzeSeoContent(fixture({ document: makeDocument([readabilityWords(words)]) }));
		const paragraphCheck = keywordEvidenceCheck(result, "paragraph-length");
		check(`${format} paragraph length at ${words} words is ${expected}; coaching never fails`,
			paragraphCheck.status === expected && paragraphCheck.weight === 3 &&
			paragraphCheck.evidence.actual === words && paragraphCheck.evidence.source === "structured content paragraphs");
	}

	const headingOnly = analyzeSeoContent(fixture({ document: makeDocument([], readabilityWords(450)) }));
	check(`${format} depth and internal-link applicability retain total body words`,
		headingOnly.metrics.wordCount === 450 &&
		keywordEvidenceCheck(headingOnly, "content-depth").status === "review" &&
		keywordEvidenceCheck(headingOnly, "content-depth").evidence.actual === 450 &&
		keywordEvidenceCheck(headingOnly, "internal-links").status === "fail" &&
		keywordEvidenceCheck(headingOnly, "internal-links").weight === 5 &&
		keywordEvidenceCheck(headingOnly, "sentence-readability").basis === "not-applicable" &&
		keywordEvidenceCheck(headingOnly, "paragraph-length").basis === "not-applicable");
}

const plainParagraphs = [readabilityWords(20), ...Array.from({ length: 3 }, () => `${readabilityWords(20)}.`)];
const plainParagraphResult = analyzeSeoContent(fixture({ document: undefined, body: plainParagraphs.join("\n\n") }));
check("plain-text fallback preserves paragraph sentence boundaries and identifies its source",
	!plainParagraphResult.metrics.structured && plainParagraphResult.metrics.wordCount === 80 &&
	plainParagraphResult.metrics.sentenceCount === 4 && plainParagraphResult.metrics.averageSentenceWords === 20 &&
	plainParagraphResult.metrics.paragraphCount === 4 && plainParagraphResult.metrics.longestParagraphWords === 20 &&
	keywordEvidenceCheck(plainParagraphResult, "sentence-readability").status === "pass" &&
	keywordEvidenceCheck(plainParagraphResult, "paragraph-length").evidence.source === "plain-text paragraphs");
for (const proseWords of [59, 60]) {
	const plainSample = analyzeSeoContent(fixture({
		document: undefined,
		body: [20, 20, proseWords - 40].map((words) => `${readabilityWords(words)}.`).join("\n\n"),
	}));
	const sampleCheck = keywordEvidenceCheck(plainSample, "sentence-readability");
	check(`plain-text fallback requires 60 prose words at the ${proseWords}-word boundary`,
		proseWords === 60
			? sampleCheck.status === "pass" && sampleCheck.weight === 4
			: sampleCheck.basis === "not-applicable" && sampleCheck.weight === 0);
}

// --- Analyzer 22 shared membership, aggregate and evidence boundaries -------
const SCORED_MASK_ORDER = ["title", "description", "url", "social-image", "image-alt-text", "keyword-title",
	"keyword-description", "keyword-content", "internal-links", "descriptive-link-text", "sentence-readability",
	"paragraph-length", "content-depth", "keyword-repetition"];
const FULL_MASK = 16_383;
const expectedMask = (ids: readonly string[]) => ids.reduce((mask, id) => mask | (1 << SCORED_MASK_ORDER.indexOf(id)), 0);
const bitCount = (value: number) => value.toString(2).split("1").length - 1;
type AnalysisResult = ReturnType<typeof analyzeSeoContent>;

check("stored membership masks require both mandatory metadata bits within the fixed policy domain",
	[3, 7, FULL_MASK].every(isSeoScoredCheckMask) &&
	[undefined, null, "3", 0, 1, 2, 4, 5, 6, -1, 3.5, FULL_MASK + 1, NaN, Infinity].every((value) => !isSeoScoredCheckMask(value)));

const idealMask = seoScoredCheckMask(ideal.checks);
check("the scored mask covers exactly the 14 analyzer 22 scored policies",
	idealMask === FULL_MASK && expectedMask(SCORED_MASK_ORDER) === FULL_MASK && Number.isSafeInteger(idealMask), String(idealMask));
check("the mask records scored membership, not pass or fail",
	seoScoredCheckMask(broken.checks) === expectedMask(["title", "description", "social-image"]) &&
	broken.checks.some((item) => item.id === "title" && item.status === "fail"), String(seoScoredCheckMask(broken.checks)));
check("a template page keeps only its observed metadata membership",
	seoScoredCheckMask(templatePage.checks) === expectedMask(["title", "description", "url", "social-image"]));
check("an absent primary target removes only the conditional phrase coaching bits",
	seoScoredCheckMask(missingPostKeyword.checks) === FULL_MASK - expectedMask(["keyword-title", "keyword-description", "keyword-content", "keyword-repetition"]));
check("noindex is a condition outside scored membership",
	seoScoredCheckMask(noindexedHealthyPost.checks) === idealMask);
check("the mask is order independent and agrees with the shared evaluated coverage",
	seoScoredCheckMask([...ideal.checks].reverse()) === idealMask &&
	[ideal, broken, templatePage, missingPostKeyword, severelyThinPost].every((result) => {
		const mask = seoScoredCheckMask(result.checks);
		return mask !== null && bitCount(mask) === result.coverage.evaluated;
	}));
check("advisory and unknown unweighted rows never change the mask",
	seoScoredCheckMask(ideal.checks.filter((item) => item.id !== "focus-keyword" && item.id !== "title-display-length")) === idealMask &&
	seoScoredCheckMask([...ideal.checks, unscored("custom-note")]) === idealMask);
const titleRow = ideal.checks.find((item) => item.id === "title")!;
const maskRefusals: Array<[string, unknown]> = [
	["a duplicate check ID", [...ideal.checks, titleRow]],
	["missing mandatory description evidence", ideal.checks.filter((item) => item.id !== "description")],
	["unavailable mandatory title evidence", ideal.checks.map((item) => item.id === "title"
		? { ...item, basis: "unavailable", status: "review", weight: 0, severity: "info", evidence: { ...item.evidence, actual: null } }
		: item)],
	["a scored row with a forged weight", ideal.checks.map((item) => item.id === "url" ? { ...item, weight: 20 } : item)],
	["presence evidence carrying metadata text", ideal.checks.map((item) => item.id === "description"
		? { ...item, evidence: { ...item.evidence, actual: fixture().description } }
		: item)],
	["a malformed row", [...ideal.checks, { id: "malformed" }]],
	["a non-array value", "title,description"],
];
for (const [name, value] of maskRefusals) check(`the scored mask is null for ${name}`, seoScoredCheckMask(value) === null);

const roleOf = (result: AnalysisResult, id: string): SeoCheckRole =>
	classifySeoContentCheck(result.checks.find((item) => item.id === id)!).role;
check("shared roles separate completeness, coaching, advice, condition and unobserved rows",
	roleOf(ideal, "title") === "scored-completeness" && roleOf(ideal, "keyword-title") === "scored-coaching" &&
	roleOf(ideal, "focus-keyword") === "advisory" && roleOf(ideal, "indexability") === "condition" &&
	roleOf(ideal, "secondary-keyword-coverage") === "not-applicable" && roleOf(templatePage, "content-depth") === "unavailable");

let duplicateRefused = false;
try { aggregateSeoChecks([...ideal.checks, titleRow]); } catch { duplicateRefused = true; }
let missingMetadataRefused = false;
try { aggregateSeoChecks(ideal.checks.filter((item) => item.id !== "title")); } catch { missingMetadataRefused = true; }
check("the shared aggregate refuses duplicate rows and missing mandatory metadata", duplicateRefused && missingMetadataRefused);
check("stored score, status, grade, calculation and coverage equal one recomputation from the checks",
	[ideal, broken, templatePage, severelyThinPost, canonicalFailure].every((result) => {
		const again = aggregateSeoChecks(result.checks);
		return again.score === result.score && again.status === result.status && again.grade === result.grade &&
			JSON.stringify(again.calculation) === JSON.stringify(result.calculation) &&
			JSON.stringify(again.coverage) === JSON.stringify(result.coverage);
	}));
check("current grades describe the aggregate state, never a numeric excellent band",
	ideal.status === "pass" && ideal.grade === "good" && severelyThinPost.status === "review" && severelyThinPost.grade === "needs-work" &&
	broken.status === "fail" && broken.grade === "poor" && canonicalFailure.score === 91 && canonicalFailure.grade === "good" &&
	severelyThinPost.score === 70 && severelyThinPost.calculation.rawScore === 76);

const longTitle = analyzeSeoContent(fixture({ title: `${fixture().title} with a much longer explanatory ending for search` }));
check("display-fit advice never changes the presence score",
	longTitle.checks.find((item) => item.id === "title-display-length")?.status === "review" &&
	longTitle.checks.find((item) => item.id === "title")?.status === "pass" && longTitle.score === ideal.score);
const missingTitle = analyzeSeoContent(fixture({ title: "   " }));
check("a missing title fails, limits the score to 49 and fails the keyword-in-title row; its fit advice is not applicable",
	missingTitle.checks.find((item) => item.id === "title")?.status === "fail" &&
	missingTitle.checks.find((item) => item.id === "title-display-length")?.basis === "not-applicable" &&
	missingTitle.checks.find((item) => item.id === "keyword-title")?.status === "fail" &&
	missingTitle.score === 49 && missingTitle.calculation.rawScore === Math.round(100 * (ideal.calculation.totalWeight - 18) / ideal.calculation.totalWeight) &&
	JSON.stringify(missingTitle.calculation.limit) === JSON.stringify({ reason: "missing-title", cap: 49, checkIds: ["title"] }) &&
	missingTitle.status === "fail" && missingTitle.grade === "poor" && seoScoredCheckMask(missingTitle.checks) === FULL_MASK);
for (const field of ["title", "description"] as const) {
	const result = analyzeSeoContent(fixture({ [field]: "   " }));
	const item = keywordEvidenceCheck(result, `keyword-${field}`);
	check(`a configured keyword fails against a missing resolved ${field} and names why`,
		item.detail === `No ${field} resolves, so it does not contain "growth marketing".` &&
		item.evidence.actual === false && item.basis === "heuristic" && item.weight === (field === "title" ? 4 : 3) &&
		item.status === "fail" && result.checks.find((row) => row.id === field)?.status === "fail" &&
		seoScoredCheckMask(result.checks) === FULL_MASK, JSON.stringify(item));
}
check("an absent keyword keeps the optional-keyword explanation",
	["keyword-title", "keyword-description"].every((id) => {
		const item = keywordEvidenceCheck(missingPostKeyword, id);
		return item.detail === "No focus keyword is set." &&
			item.evidence.expected === "an optional focus keyword" &&
			item.basis === "not-applicable" && item.weight === 0;
	}));
check("presence rows store booleans and no check copies the resolved title or description",
	titleRow.evidence.actual === true && ideal.checks.find((item) => item.id === "description")?.evidence.actual === true &&
	broken.checks.find((item) => item.id === "description")?.evidence.actual === false &&
	!JSON.stringify(ideal.checks).includes(fixture().description) && !JSON.stringify(ideal.checks).includes(fixture().title));

const unknownBody = analyzeSeoContent(fixture({ document: { unsupported: true }, body: "" }));
const emptySupportedBody = analyzeSeoContent(fixture({ document: [], body: "" }));
check("an unsupported unread body is unavailable, neither passed nor failed",
	["content-depth", "heading-structure", "internal-links", "descriptive-link-text", "sentence-readability", "paragraph-length",
		"keyword-introduction", "keyword-content", "keyword-heading"].every((id) => {
		const item = unknownBody.checks.find((row) => row.id === id);
		return item?.basis === "unavailable" && item.status === "review" && item.weight === 0;
	}));
check("an unread body shows a dash for a passed metadata-only result, naming the weighted rows not checked",
	unknownBody.status === "pass" &&
	JSON.stringify(seoAnalysisPresentation(unknownBody)) === JSON.stringify({ label: "Partially checked", qualifier: "7 weighted checks not checked", tone: "neutral" }) &&
	JSON.stringify(seoAnalysisPresentation(templatePage)) === JSON.stringify({ label: "Partially checked", qualifier: "6 weighted checks not checked", tone: "neutral" }),
	JSON.stringify([seoAnalysisPresentation(unknownBody), seoAnalysisPresentation(templatePage)]));
const emptyDepth = emptySupportedBody.checks.find((item) => item.id === "content-depth");
check("an inspected empty article body is zero words of text, failed and limited to 40, not an unread body",
	emptyDepth?.basis === "measured" && emptyDepth.status === "fail" && emptyDepth.evidence.actual === 0 &&
	emptySupportedBody.score === 40 &&
	JSON.stringify(seoAnalysisPresentation(emptySupportedBody)) === JSON.stringify({ label: "Poor", qualifier: "Limited to 40: under 50 words of body text", tone: "poor" }),
	JSON.stringify(seoAnalysisPresentation(emptySupportedBody)));
check("a fully observed passing body is a plain Good result",
	JSON.stringify(seoAnalysisPresentation(ideal)) === JSON.stringify({ label: "Good", qualifier: null, tone: "good" }));

// A presentation summary must not turn a small applicable denominator into a
// complete content assessment or rewrite the persisted weighted calculation.
const observedText = "testtesttesttest testttasfassssssss";
const observedTwoWord = analyzeSeoContent(fixture({
	title: "test", description: "tes", slug: "test", url: "https://example.test/posts/test",
	body: observedText,
	document: [block("testtesttesttest", { style: "h1" }), block("testttasfassssssss")],
	focusKeyword: undefined, focusKeywords: [], imageSeoEnabled: false,
	assessmentProfile: { profile: "general", version: 1 },
}));
const observedSummary = seoAnalysisSummary(observedTwoWord);
check("the observed two-word general entry keeps its exact six-check arithmetic but shows no number",
	observedText.length === 35 && observedTwoWord.metrics.wordCount === 2 &&
	observedTwoWord.score === 94 && observedTwoWord.calculation.earnedWeight === 48.75 &&
	observedTwoWord.calculation.totalWeight === 52 && observedTwoWord.calculation.limit === null &&
	observedSummary.evaluated === 6 && observedSummary.scoredIssues === 1 &&
	keywordEvidenceCheck(observedTwoWord, "internal-links").status === "review" &&
	!observedSummary.numericBadgeAvailable && observedSummary.label === "Too little text to score" &&
	observedSummary.qualifier === "2 words of body text" && observedSummary.tone === "neutral",
	JSON.stringify({ score: observedTwoWord.calculation, observedSummary }));
check("short metadata fits its previews; the keyword, body H1 and short text are three Suggestions, not scored failures",
	observedSummary.advisorySuggestions === 3 &&
	JSON.stringify(observedTwoWord.checks.filter((item) => classifySeoContentCheck(item).role === "advisory" && item.status === "review").map((item) => item.id)) ===
		JSON.stringify(["focus-keyword", "content-depth", "heading-structure"]) &&
	["title-display-length", "description-display-length"].every((id) => keywordEvidenceCheck(observedTwoWord, id).status === "pass") &&
	observedSummary.readabilityLimited && observedSummary.bodyLimited);
check("an optional absent keyword is counted as not applicable, never missing scored evidence",
	observedSummary.notApplicable > 0 && observedSummary.unavailable === 0 &&
	observedTwoWord.checks.filter(item => item.category === "keyword").every(item => item.weight === 0 && item.status !== "fail"));

const limitedReadableSample = analyzeSeoContent(fixture({
	body: "A useful note.", document: [block("A useful note.")],
	focusKeyword: undefined, focusKeywords: [], imageSeoEnabled: false,
	assessmentProfile: { profile: "general", version: 1 },
}));
const limitedSampleSummary = seoAnalysisSummary(limitedReadableSample);
check("a General entry under 50 words withholds the number as Too little text to score",
	limitedReadableSample.score === 94 && limitedSampleSummary.scoredIssues === 1 &&
	limitedSampleSummary.advisorySuggestions === 2 && limitedSampleSummary.bodyLimited &&
	limitedSampleSummary.readabilityLimited && !limitedSampleSummary.numericBadgeAvailable &&
	limitedSampleSummary.label === "Too little text to score" && limitedSampleSummary.qualifier === "3 words of body text" &&
	limitedSampleSummary.tone === "neutral", JSON.stringify(limitedSampleSummary));

const suggestionOnly = analyzeSeoContent(fixture({ title: `${fixture().title} with a much longer explanatory ending for search` }));
const suggestionSummary = seoAnalysisSummary(suggestionOnly);
check("an unweighted suggestion neither lowers nor hides the number",
	suggestionOnly.score === ideal.score && suggestionSummary.scoredIssues === 0 &&
	suggestionSummary.advisorySuggestions > 0 && !suggestionSummary.bodyLimited && !suggestionSummary.readabilityLimited &&
	suggestionSummary.numericBadgeAvailable && suggestionSummary.label === "Good" && suggestionSummary.qualifier === null);
check("a fully observed control keeps its number; an unset keyword adds a Suggestion and the qualifier",
	[ideal, missingPostKeyword].every(result => {
		const summary = seoAnalysisSummary(result);
		const keywordUnset = result === missingPostKeyword;
		return summary.numericBadgeAvailable && !summary.bodyLimited && !summary.readabilityLimited &&
			summary.scoredIssues === 0 && summary.advisorySuggestions === (keywordUnset ? 1 : 0) &&
			summary.qualifier === (keywordUnset ? "No focus keyword" : null) &&
			summary.label === "Good" && summary.tone === "good";
	}));
check("unobserved and template bodies withhold the number without a limit; an inspected empty article body shows its limit",
	[unknownBody, templatePage].every(result => {
		const summary = seoAnalysisSummary(result);
		return summary.bodyLimited && summary.readabilityLimited && !summary.numericBadgeAvailable &&
			summary.label === "Partially checked" && result.calculation.limit === null;
	}) && (() => {
		const summary = seoAnalysisSummary(emptySupportedBody);
		return !summary.bodyLimited && summary.readabilityLimited && summary.numericBadgeAvailable &&
			emptySupportedBody.calculation.limit?.reason === "severely-thin-content";
	})());

const unreadMetadataChecks: SeoContentCheck[] = ideal.checks.map(item => item.id === "description" ? {
	...item, basis: "unavailable", severity: "info", status: "review", weight: 0,
	evidence: { ...item.evidence, actual: null },
} : item);
const unreadMetadataSummary = seoAnalysisSummary({ score: ideal.score, checks: unreadMetadataChecks });
let unreadMetadataAggregateRefused = false;
try { aggregateSeoChecks(unreadMetadataChecks); } catch { unreadMetadataAggregateRefused = true; }
check("unread metadata is unassessed evidence, not a known missing-value failure or a current numeric result",
	unreadMetadataSummary.unavailable === 1 && unreadMetadataSummary.scoredIssues === 0 &&
	!unreadMetadataSummary.numericBadgeAvailable && unreadMetadataSummary.label === "Partially checked" &&
	unreadMetadataSummary.qualifier === "1 weighted check not checked" && unreadMetadataAggregateRefused,
	JSON.stringify(unreadMetadataSummary));
const missingMetadataSummary = seoAnalysisSummary({
	score: ideal.score, checks: ideal.checks.filter(item => item.id !== "description"),
});
check("an omitted mandatory metadata row cannot claim complete badge evidence",
	!missingMetadataSummary.numericBadgeAvailable && missingMetadataSummary.label === "Partially checked" &&
	missingMetadataSummary.qualifier === "1 weighted check not checked");
check("known empty metadata retains a scored failure and its weighted arithmetic",
	seoAnalysisSummary(missingTitle).scoredIssues > 0 && seoAnalysisSummary(missingTitle).label === "Poor" &&
	seoAnalysisSummary(missingTitle).tone === "poor" && missingTitle.score === aggregateSeoChecks(missingTitle.checks).score);

const draftControl = analyzeSeoContent(fixture({ publicationStatus: "draft" }));
const scopedResults = [ideal, missingPostKeyword, observedTwoWord, limitedReadableSample, suggestionOnly,
	unknownBody, templatePage, emptySupportedBody, missingTitle, broken, draftControl];
const beforeSummaries = JSON.stringify(scopedResults);
const beforeMasks = scopedResults.map(result => seoScoredCheckMask(result.checks));
check("numeric badge availability and the three-field projection share the one display decision",
	scopedResults.every(result => {
		const summary = seoAnalysisSummary(result);
		return summary.numericBadgeAvailable === (seoScoreDisplay(result).score !== null) &&
			JSON.stringify(seoAnalysisPresentation(result)) === JSON.stringify({ label: summary.label, qualifier: summary.qualifier, tone: summary.tone });
	}));
check("presentation leaves analyzer version, membership, weighted results and durable payloads unchanged",
	JSON.stringify(scopedResults) === beforeSummaries &&
	JSON.stringify(scopedResults.map(result => seoScoredCheckMask(result.checks))) === JSON.stringify(beforeMasks) &&
	scopedResults.every(result => result.scoreVersion === SEO_SCORE_VERSION && result.scoreVersion === 22 &&
		["summary", "numericBadgeAvailable", "bodyLimited", "readabilityLimited", "persistence", "freshness"].every(key => !Object.hasOwn(result, key))));
check("draft publication state changes no mechanical assessment scope and creates no durable summary state",
	draftControl.score === ideal.score && seoAnalysisSummary(draftControl).numericBadgeAvailable &&
	!Object.hasOwn(draftControl, "persistence") && !Object.hasOwn(draftControl, "summary"));

const urlRow = (result: AnalysisResult) => result.checks.find((item) => item.id === "url")!;
const syntaxOnly = urlRow(ideal);
check("an absolute URL without runtime context is a syntax pass that claims no origin or route comparison",
	syntaxOnly.status === "pass" && syntaxOnly.basis === "measured" && /not compared/.test(syntaxOnly.detail) &&
	!/real site context/.test(syntaxOnly.evidence.expected) && /not compared/.test(syntaxOnly.limitation),
	JSON.stringify(syntaxOnly));
const siteValidated = urlRow(analyzeSeoContent(fixture({ canonicalStatus: "matches" })));
check("a runtime-validated canonical keeps its site-context expectation",
	siteValidated.status === "pass" && siteValidated.detail === fixture().url && /real site context/.test(siteValidated.evidence.expected));
const relativeUnvalidated = analyzeSeoContent(fixture({ url: "/blog/growth-marketing-strategy" }));
check("a relative URL without runtime validation is unavailable and outside scored membership",
	urlRow(relativeUnvalidated).basis === "unavailable" && urlRow(relativeUnvalidated).weight === 0 &&
	((seoScoredCheckMask(relativeUnvalidated.checks) ?? expectedMask(["url"])) & expectedMask(["url"])) === 0);
const relativeValidated = analyzeSeoContent(fixture({ url: "/blog/growth-marketing-strategy", canonicalStatus: "matches" }));
check("a runtime-validated relative URL can pass", urlRow(relativeValidated).status === "pass");
const canonicalFailures: Array<[string, string, "invalid" | undefined]> = [
	["unsupported syntax", "ftp://shipitdigital.nl/blog/growth-marketing-strategy", undefined],
	["a fragment without runtime context", "https://shipitdigital.nl/blog/growth-marketing-strategy#top", undefined],
	["a runtime refusal", "https://shipitdigital.nl/blog/growth-marketing-strategy", "invalid"],
];
for (const [name, url, canonicalStatus] of canonicalFailures) {
	const row = urlRow(analyzeSeoContent(fixture({ url, ...(canonicalStatus ? { canonicalStatus } : {}) })));
	check(`a canonical with ${name} fails`, row.status === "fail" && row.weight === 8, JSON.stringify(row));
}
check("an empty URL is unavailable, not failed", urlRow(analyzeSeoContent(fixture({ url: "" }))).basis === "unavailable");
check("new boundary fixtures carry only valid current checks",
	[longTitle, missingTitle, unknownBody, emptySupportedBody, relativeUnvalidated, relativeValidated].every((result) =>
		result.checks.every((item) => seoContentCheckProblem(item, true) === null)));

console.log(failures === 0 ? "\nALL SEO ANALYSIS CHECKS PASSED" : `\n${failures} SEO ANALYSIS CHECK(S) FAILED`);
if (failures > 0) throw new Error(`${failures} SEO analysis self-check(s) failed`);
