import assert from "node:assert/strict";

import { SEO_SCORE_VERSION, analyzeSeoContent, type SeoAnalysisInput, type SeoContentCheck } from "./analysis.ts";
import { cleanStoredSeoCheck, cleanStoredSeoText, presentSeoChecks } from "./check-presentation.ts";
import { LEGACY_BRAND_PHRASES } from "./legacy-brand-text.ts";
import { SEO_SNIPPET_ESTIMATE_NOTE } from "./snippet-fit.ts";
import { buildSeoWorkQueue, searchExclusionCheck } from "./admin-ui/content-extension-model.ts";

const BRAND = /Shipit|SHIPIT/;
let cases = 0;
function check(name: string, run: () => void) {
	try { run(); } catch (error) { throw new Error(name + ": " + (error instanceof Error ? error.message : String(error))); }
	cases += 1;
}

const base: SeoAnalysisInput = {
	ref: "posts:bread", collection: "posts", entryId: "bread", slug: "fresh-bread",
	title: "Fresh bread baked every morning in the old town bakery", titleSource: "template",
	description: "Fresh bread and pastries are baked here every morning, with rye, spelt and sourdough loaves.", descriptionSource: "legacy-override",
	url: "https://example.invalid/fresh-bread", noindex: false, publicationStatus: "published",
	body: "Fresh bread is baked here every morning. ".repeat(40), focusKeyword: "fresh bread", focusKeywords: ["fresh bread", "sourdough"],
	assessmentProfile: { profile: "article", version: 1 }, schemaEnabled: true, schemaPreset: "Article",
};
const inputs: SeoAnalysisInput[] = [
	base,
	{ ...base, body: "Fresh bread. ".repeat(30), schemaEnabled: false, focusKeyword: undefined, focusKeywords: [] },
	{ ...base, body: "A short note.", assessmentProfile: { profile: "general", version: 1 }, title: "A very long title that keeps going well past what a phone shows in results", titleSource: "content" },
	{ ...base, noindex: true, noindexSources: ["site-setting", "content-type-rule", "entry-seo", "legacy-override"] },
	{ ...base, noindex: true, noindexSources: ["legacy-override"], publicationStatus: "draft" },
	{ ...base, body: "fresh bread ".repeat(200), descriptionSource: "generated" },
];

check("new analysis rows and the snippet note name no product", () => {
	assert.doesNotMatch(SEO_SNIPPET_ESTIMATE_NOTE, BRAND);
	const seen = new Set<string>();
	for (const input of inputs) {
		const result = analyzeSeoContent(input);
		assert.equal(result.scoreVersion, SEO_SCORE_VERSION);
		for (const item of result.checks) {
			seen.add(item.id);
			for (const value of [item.label, item.detail, item.recommendation, item.limitation, item.evidence.expected, item.evidence.source, item.evidence.actual]) {
				if (typeof value === "string") assert.doesNotMatch(value, BRAND, `${item.id}: ${value}`);
			}
		}
	}
	assert.equal(SEO_SCORE_VERSION, 22, "current rows use the current analyzer policy");
	for (const id of ["keyword-repetition", "description-display-length", "title-display-length", "focus-keyword", "indexability", "schema", "content-depth", "sentence-readability", "paragraph-length"]) {
		assert.ok(seen.has(id), "covered: " + id);
	}
});

// Analyzer 21 rows keep their historical rules while product names are removed.
const STORED: Array<[earlier: string, current: string]> = [
	["Counts literal uses of the focus keyword in the saved body. The 3.5% threshold is Shipit guidance; Google sets no keyword density.",
		"Counts literal uses of the focus keyword in the saved body. The 3.5% threshold is a checklist guideline; Google sets no keyword density."],
	["3.5% of body words or less, or fewer than 3 uses (Shipit guidance)", "3.5% of body words or less, or fewer than 3 uses (checklist guideline)"],
	["The focus keyword appears 9 times in 120 words (7.5%). This can read as keyword stuffing, which Google's spam policies prohibit. Shipit flags more than 3.5%.",
		"The focus keyword appears 9 times in 120 words (7.5%). This can read as keyword stuffing, which Google's spam policies prohibit. This checklist flags more than 3.5%."],
	["Measures the meta description Shipit resolves from saved values. The served tag and the snippet a search engine displays are not observed. Google often builds the snippet from page text.",
		"Measures the meta description resolved from saved values. The served tag and the snippet a search engine displays are not observed. Google often builds the snippet from page text."],
	["Literal phrase match in the meta description Shipit resolves; the served tag is not observed.",
		"Literal phrase match in the meta description resolved from saved values; the served tag is not observed."],
	["Resolved meta description: legacy Shipit override", "Resolved meta description: legacy SEO override"],
	["A focus keyword is optional and private to Shipit; it is not a search engine requirement.", "A focus keyword is optional and used only by these checks; it is not a search engine requirement."],
	["Shipit SEO keyword profile", "SEO keyword profile"],
	["the Shipit site-wide noindex setting and the Shipit content type noindex rule and a legacy Shipit robots override",
		"the site-wide noindex setting and the content type noindex rule and a legacy robots override"],
	["Shipit site-wide setting, entry SEO noindex and legacy robots override", "site-wide noindex setting, entry SEO noindex and legacy robots override"],
	["This published entry is marked noindex by the site-wide noindex setting in Shipit SEO and the content type rule in Shipit SEO Indexing rules and an earlier Shipit robots setting. Search engines are asked not to index it.",
		"This published entry is marked noindex by the site-wide noindex setting in Indexing rules and the content type rule in Indexing rules and an earlier robots setting. Search engines are asked not to index it."],
	["Reports the saved directive Shipit resolves; the served robots tag and search engine behavior are not observed.",
		"Reports the directive resolved from saved settings; the served robots tag and search engine behavior are not observed."],
	["Estimate: fits in Shipit's phone and desktop previews.", "Estimate: fits in the phone and desktop previews."],
	["Estimate: fits in Shipit's phone and desktop previews if Google uses it.", "Estimate: fits in the phone and desktop previews if Google uses it."],
	["Put the words that matter first, or shorten the title. This is Shipit guidance, not a Google limit.", "Put the words that matter first, or shorten the title. This is a checklist guideline, not a Google limit."],
	["Shipit schema configuration", "Schema configuration"],
	["No Shipit graph is predicted from saved settings.", "No schema graph is predicted from saved settings."],
	["saved Shipit schema settings", "saved schema settings"],
	["Counts words in the saved body only; text the site template adds is not observed. Word targets are Shipit guidance; Google sets no word count.",
		"Counts words in the saved body only; text the site template adds is not observed. Word targets are checklist guidelines; Google sets no word count."],
	["100 or more words of body text (Shipit guidance; not scored for general content)", "100 or more words of body text (checklist guideline; not scored for general content)"],
	["Body text: 120 words. Shipit suggests at least 300 words for articles, and fewer than 100 limits the score. Google sets no minimum word count.",
		"Body text: 120 words. This checklist suggests at least 300 words for articles, and fewer than 100 limits the score. Google sets no minimum word count."],
	["Average sentence length is a directional readability signal written for English (Shipit guidance); meaning, audience and clarity are not evaluated.",
		"Average sentence length is a directional readability signal written for English (checklist guideline); meaning, audience and clarity are not evaluated."],
	[SEO_SNIPPET_ESTIMATE_NOTE.replace("Estimated with preview widths", "Estimated with Shipit preview widths").replace("what a metadata template adds", "what a Shipit template adds"),
		SEO_SNIPPET_ESTIMATE_NOTE],
];

check("stored analyzer 21 wording is debranded without changing its historical rules", () => {
	for (const [earlier, current] of STORED) assert.equal(cleanStoredSeoText(earlier), current);
	for (const [earlier, current] of LEGACY_BRAND_PHRASES) {
		assert.match(earlier, BRAND);
		assert.doesNotMatch(current, BRAND);
		assert.equal(cleanStoredSeoText(earlier), current, earlier);
	}
	const written = new Set(inputs.flatMap((input) => analyzeSeoContent(input).checks.flatMap((item) =>
		[item.label, item.detail, item.recommendation, item.limitation, item.evidence.expected, item.evidence.source])));
	// Density wording changed in analyzer 22; historical thresholds are not rewritten.
	for (const [, current] of [STORED[0]!, ...STORED.slice(3, 8)]) {
		assert.ok([...written].some((text) => text.includes(current)) || /appears 9 times|legacy SEO override/.test(current), "the analyzer writes: " + current);
	}
});

check("earlier wording outside the phrase list is cleaned word by word", () => {
	const cases: Array<[string, string]> = [
		["Shipit SEO adds no metadata to this page.", "The plugin adds no metadata to this page."],
		["Shipit's resolver predicts Article.", "The plugin's resolver predicts Article."],
		["Shipit SEO's site-wide noindex setting is on.", "The plugin's site-wide noindex setting is on."],
		["Values come from Shipit presets, custom schemas and EmDash fallback rules.", "Values come from presets, custom schemas and EmDash fallback rules."],
		["Saved. Shipit presets decide the graph.", "Saved. Presets decide the graph."],
		["Shipit guidance applies here.", "Checklist guidance applies here."],
		["The keyword is private to Shipit.", "The keyword is private to the plugin."],
		["Edited in Shipit SEO focus settings", "Edited in SEO focus settings"],
		["The value the meta description Shipit resolves.", "The value the meta description the plugin resolves."],
		["Stored before Shipit tracked versions.", "Stored before the plugin tracked versions."],
	];
	for (const [earlier, current] of cases) assert.equal(cleanStoredSeoText(earlier), current, earlier);
});

check("entry content and other names stay exactly as stored", () => {
	for (const text of [
		"A useful post - Shipit Digital", "Shipit Academy opens in May.", "Focus keyword: \"Shipit guidance\".",
		"The URL contains \"shipit seo\".", "Contact ShipitLabs for details.", "No brand here at all.",
	]) assert.equal(cleanStoredSeoText(text), text, text);
	assert.equal(cleanStoredSeoText("Focus keyword: \"Shipit SEO\". Shipit flags more than 3.5%."), "Focus keyword: \"Shipit SEO\". This checklist flags more than 3.5%.");
});

const stuffed = analyzeSeoContent({ ...base, body: "fresh bread ".repeat(200), noindex: true, noindexSources: ["site-setting"] });
const repetition = stuffed.checks.find((item) => item.id === "keyword-repetition" && item.status !== "pass");
const indexing = stuffed.checks.find((item) => item.condition === "excluded-from-search");
assert.ok(repetition && indexing, "the fixture produces a repetition issue and a search exclusion");
const stored: SeoContentCheck = {
	...repetition,
	label: "Shipit schema configuration",
	detail: "The focus keyword appears 9 times in 120 words (7.5%). This can read as keyword stuffing, which Google's spam policies prohibit. Shipit flags more than 3.5%.",
	evidence: { ...repetition.evidence, expected: "3.5% of body words or less, or fewer than 3 uses (Shipit guidance)", source: "Shipit SEO keyword profile" },
	recommendation: "This is Shipit guidance, not a Google limit.", limitation: "Word targets are Shipit guidance; Google sets no word count.",
};
const storedExclusion: SeoContentCheck = {
	...indexing,
	detail: "This published entry is marked noindex by the site-wide noindex setting in Shipit SEO. Search engines are asked not to index it.",
};

check("a stored row is cleaned field by field, never its measured value", () => {
	const clean = cleanStoredSeoCheck(stored);
	assert.equal(clean.label, "Schema configuration");
	assert.match(clean.detail, /This checklist flags more than 3\.5%\.$/);
	assert.deepEqual(clean.evidence, { actual: repetition.evidence.actual, expected: "3.5% of body words or less, or fewer than 3 uses (checklist guideline)", source: "SEO keyword profile" });
	const keywordRow = { ...stuffed.checks.find((item) => item.id === "focus-keyword")!, evidence: { actual: "Shipit SEO", expected: "an optional focus keyword", source: "Shipit SEO keyword profile" } };
	assert.deepEqual(cleanStoredSeoCheck(keywordRow).evidence, { actual: "Shipit SEO", expected: "an optional focus keyword", source: "SEO keyword profile" },
		"a keyword that names the earlier product is entry content");
	assert.equal(clean.recommendation, "This is a checklist guideline, not a Google limit.");
	assert.equal(clean.limitation, "Word targets are checklist guidelines; Google sets no word count.");
	assert.equal(stored.label, "Shipit schema configuration", "the stored row itself is not changed");
	assert.equal(cleanStoredSeoCheck(repetition), repetition, "current rows pass through unchanged");
});

check("every surface that shows stored rows shows the cleaned wording", () => {
	const shownText = (item: SeoContentCheck) => [item.label, item.detail, item.recommendation, item.limitation, item.evidence.expected, item.evidence.source].join(" ");
	const presentation = presentSeoChecks({ checks: [stored], scoreVersion: SEO_SCORE_VERSION });
	const shown = presentation.groups.flatMap((group) => group.rows.map((row) => row.check));
	assert.equal(shown.length, 1);
	assert.doesNotMatch(shownText(shown[0]!), BRAND);
	const earlier = presentSeoChecks({ checks: [stored], scoreVersion: 20 });
	assert.doesNotMatch(shownText(earlier.groups[0]!.rows[0]!.check), BRAND, "earlier analyzers are cleaned as well");
	const notApplicable = presentSeoChecks({ checks: [{ ...stored, basis: "not-applicable", detail: "Not applicable while Shipit SEO adds no schema." }], scoreVersion: SEO_SCORE_VERSION });
	assert.equal(notApplicable.groups[0]!.notApplicable[0]!.text, "Schema configuration: Not applicable while the plugin adds no schema.");
	const score = { ...stuffed, updatedAt: "2026-10-18T10:00:00.000Z", freshness: "current",
		checks: stuffed.checks.map((item) => item === repetition ? stored : item === indexing ? storedExclusion : item) };
	assert.equal(searchExclusionCheck(score as never)?.detail,
		"This published entry is marked noindex by the site-wide noindex setting in Indexing rules. Search engines are asked not to index it.");
	const queue = buildSeoWorkQueue([score as never]);
	const queued = queue.find((item) => item.check.id === "keyword-repetition");
	assert.ok(queued, "the stored issue is queued");
	for (const item of queue) assert.doesNotMatch(shownText(item.check), BRAND);
});

console.log(`SEO stored brand text self-check passed (${cases} cases).`);
