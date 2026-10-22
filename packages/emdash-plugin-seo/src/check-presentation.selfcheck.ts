import assert from "node:assert/strict";

import {
	SEO_SCORE_VERSION,
	analyzeSeoContent,
	classifySeoContentCheck,
	seoScoreDisplay,
	type SeoAnalysisInput,
	type SeoAnalysisResult,
	type SeoContentCheck,
} from "./analysis.ts";
import { analyzed as acceptanceResults } from "./analysis-acceptance.selfcheck.ts";
import { ANALYZER_20_FIXTURES } from "./analyzer20-compat.selfcheck.ts";
import {
	SEO_CHECK_ACTION_VERBS,
	SEO_CHECK_GROUPS,
	SEO_CHECK_ROW_WORDS,
	SEO_EARLIER_ANALYZER_TEXT,
	presentSeoChecks,
	seoCheckActionTarget,
	seoCheckRowWord,
	seoCheckTotals,
	seoCheckTotalsText,
	seoGradeBandLabel,
	seoScoreBandLabel,
	seoScoreDisplayText,
	type SeoCheckPresentation,
	type SeoCheckRowKind,
} from "./check-presentation.ts";

let cases = 0;
function check(name: string, run: () => void): void {
	run();
	cases += 1;
	console.log(`  PASS  ${name}`);
}

const span = (text: string, marks: string[] = []) => ({ _type: "span", _key: `s${text.length}`, text, marks });
const paragraph = (text: string) => ({ _type: "block", _key: `p${text.length}`, style: "normal", markDefs: [], children: [span(text)] });
const words = (count: number) => Array.from({ length: count }, (_, index) => ["Owners", "keep", "homes", "warm", "by", "checking", "pressure", "and", "vents", "yearly"][index % 10]);
const sentences = (count: number) => {
	const list = words(count);
	const parts: string[] = [];
	for (let start = 0; start < list.length; start += 10) parts.push(`${list.slice(start, start + 10).join(" ")}.`);
	return parts.join(" ");
};

function input(overrides: Partial<SeoAnalysisInput> = {}): SeoAnalysisInput {
	const document = Object.hasOwn(overrides, "document") ? overrides.document : [paragraph(sentences(120))];
	return {
		ref: "posts:presentation", collection: "posts", entryId: "presentation", slug: "boiler-repair-guide",
		title: "Boiler repair guide for small homes", titleSource: "core-seo",
		description: "How to plan a boiler repair, what a visit costs and which checks a homeowner can do first.",
		descriptionSource: "core-seo", url: "https://example.test/boiler-repair-guide", canonicalStatus: "matches",
		image: "https://example.test/social.jpg", imageSource: "core-seo", noindex: false, noindexSources: [],
		publicationStatus: "published", contentImages: [], focusKeywords: [],
		assessmentProfile: { profile: "article", version: 1 }, schemaEnabled: true, schemaPreset: "BlogPosting", imageSeoEnabled: true,
		body: "", ...overrides, document,
	};
}

const RANK: Readonly<Record<SeoCheckRowKind, number>> = { failed: 0, "partly-met": 1, suggestion: 2, "not-checked": 3, passed: 4, earlier: 5 };

function assertWellFormed(name: string, result: Pick<SeoAnalysisResult, "checks" | "scoreVersion" | "assessmentProfile">, presentation: SeoCheckPresentation): void {
	const sums = seoCheckTotals(presentation.groups);
	assert.deepEqual(presentation.totals, sums, `${name}: header totals are the group sums`);
	for (const key of ["issues", "suggestions", "notChecked", "notApplicable", "passed"] as const)
		assert.equal(presentation.totals[key], presentation.groups.reduce((total, group) => total + group.counts[key], 0), `${name}: ${key}`);
	const placed = presentation.groups.flatMap((group) => [...group.rows.map((row) => row.check.id), ...group.notApplicable.flatMap((item) => item.checks.map((entry) => entry.id))]);
	assert.equal(new Set(placed).size, placed.length, `${name}: one place per check`);
	const hidden = result.checks.filter((item) => !placed.includes(item.id)).map((item) => item.id);
	for (const id of hidden) assert.ok(id === "indexability" || id === "focus-keyword", `${name}: only the directive and a set keyword are hidden, not ${id}`);
	for (const group of presentation.groups) {
		assert.ok(group.rows.length + group.notApplicable.length > 0, `${name}: empty groups are dropped`);
		group.rows.forEach((row, index) => {
			assert.equal(row.word, SEO_CHECK_ROW_WORDS[row.kind]);
			if (index === 0) return;
			const previous = group.rows[index - 1];
			assert.ok(RANK[previous.kind] <= RANK[row.kind], `${name}: ${group.id} orders Failed, Partly met, Suggestion, Not checked, Passed`);
			// Earlier-analyzer rows keep table order; their stored weights follow another policy.
			if (previous.kind === row.kind && row.kind !== "earlier") assert.ok(previous.check.weight >= row.check.weight, `${name}: ${group.id} puts heavier rows first`);
		});
	}
}

check("header totals equal the group sums across every engine acceptance fixture", () => {
	assert.ok(acceptanceResults.length >= 20, String(acceptanceResults.length));
	for (const result of acceptanceResults) {
		const presentation = presentSeoChecks(result);
		assertWellFormed(result.ref, result, presentation);
		// Every acceptance fixture is published, so the directive row is measured and the counts match the display.
		const display = seoScoreDisplay(result);
		assert.deepEqual([presentation.totals.issues, presentation.totals.suggestions, presentation.totals.notChecked],
			[display.issues, display.suggestions, display.notChecked], result.ref);
		const independent = result.checks.filter((item) => item.basis !== "not-applicable" && item.id !== "indexability" &&
			item.basis !== "unavailable" && classifySeoContentCheck(item, result.assessmentProfile.profile).issue).length;
		assert.equal(presentation.totals.issues, independent, `${result.ref}: issues are Failed and Partly met rows`);
		const pills = presentation.groups.map((group) => group.pill.text);
		assert.ok(pills.every((text) => /^(?:\d+ issues?(?:, \d+ suggestions?)?|\d+ suggestions?|\d+ not checked|All good|Not applicable)$/.test(text)), pills.join(" | "));
	}
});

check("the 600-word article reads All good in every group, and the header reads No issues", () => {
	const full = acceptanceResults.find((result) => result.score === 100 && result.keyword === "boiler repair" && result.metrics.wordCount === 600);
	assert.ok(full, "the full article fixture");
	const presentation = presentSeoChecks(full);
	assert.deepEqual(presentation.groups.map((group) => group.pill.text), ["All good", "All good", "All good", "All good"]);
	assert.deepEqual(presentation.groups.map((group) => group.label), SEO_CHECK_GROUPS.map((group) => group.label));
	assert.equal(seoCheckTotalsText(presentation.totals), "No issues");
	assert.equal(presentation.defaultOpenGroupId, null);
	assert.equal(presentation.groups.flatMap((group) => group.rows).some((row) => row.check.id === "focus-keyword"), false, "a set keyword hides its own row");
});

check("group membership follows the contract table", () => {
	const result = analyzeSeoContent(input({ focusKeywords: ["boiler repair", "pressure gauge"] }));
	const presentation = presentSeoChecks(result);
	const groupOf = (id: string) => presentation.groups.find((group) =>
		group.rows.some((row) => row.check.id === id) || group.notApplicable.some((item) => item.checks.some((entry) => entry.id === id)))?.id;
	for (const id of ["title", "description", "url", "content-depth", "keyword-title", "keyword-description", "keyword-content", "keyword-url", "keyword-introduction", "keyword-heading", "secondary-keyword-coverage"])
		assert.equal(groupOf(id), "basic", id);
	for (const id of ["social-image", "image-alt-text", "internal-links", "descriptive-link-text", "keyword-repetition", "featured-image", "schema"])
		assert.equal(groupOf(id), "additional", id);
	for (const id of ["title-display-length", "description-display-length", "keyword-title-position"]) assert.equal(groupOf(id), "search-snippet", id);
	for (const id of ["sentence-readability", "paragraph-length", "heading-structure"]) assert.equal(groupOf(id), "content-readability", id);
	assert.equal(groupOf("indexability"), undefined, "the indexing directive is not a row");
	const unknown = presentSeoChecks({ ...result, checks: [...result.checks, { ...result.checks.find((item) => item.id === "schema")!, id: "future-advice", label: "Future advice" }] });
	assert.equal(unknown.groups.find((group) => group.id === "additional")!.rows.at(-1)?.check.id, "future-advice", "an unnamed row joins Additional after the named rows");
});

check("pill precedence: issues with suggestions, then suggestions, then not checked, then All good, then Not applicable", () => {
	const base = analyzeSeoContent(input());
	const pick = (ids: readonly string[], patch: (item: SeoContentCheck) => SeoContentCheck = (item) => item) =>
		presentSeoChecks({ ...base, checks: base.checks.filter((item) => ids.includes(item.id)).map(patch) }).groups;
	const failed = analyzeSeoContent(input({ title: "", document: [paragraph("Hello world")] }));
	const basic = presentSeoChecks(failed).groups.find((group) => group.id === "basic")!;
	assert.deepEqual([basic.pill.text, basic.pill.tone], ["2 issues, 1 suggestion", "poor"]);
	const review = analyzeSeoContent(input({ document: [paragraph(sentences(450))] }));
	const reviewBasic = presentSeoChecks(review).groups.find((group) => group.id === "basic")!;
	assert.deepEqual([reviewBasic.pill.text, reviewBasic.pill.tone], ["1 issue, 1 suggestion", "review"], "Partly met alone is a review tone");
	const [suggestionOnly] = pick(["title", "focus-keyword"]);
	assert.deepEqual([suggestionOnly.pill.text, suggestionOnly.pill.tone], ["1 suggestion", "info"]);
	const unavailable = (item: SeoContentCheck): SeoContentCheck => ({ ...item, status: "review", weight: 0, severity: "info", basis: "unavailable" });
	const [notChecked] = pick(["title", "content-depth"], (item) => item.id === "content-depth" ? unavailable(item) : item);
	assert.deepEqual([notChecked.pill.text, notChecked.pill.tone], ["1 not checked", "neutral"]);
	const [allGood] = pick(["title", "description"]);
	assert.deepEqual([allGood.pill.text, allGood.pill.tone], ["All good", "good"]);
	const [mixed] = pick(["title", "focus-keyword", "content-depth"], (item) => item.id === "content-depth" ? unavailable(item) : item);
	assert.equal(mixed.pill.text, "1 suggestion", "suggestions outrank not-checked rows");
});

check("an all-not-applicable group reads Not applicable and lists its rows collapsed by reason", () => {
	const empty = analyzeSeoContent(input({ document: [] }));
	const readability = presentSeoChecks(empty).groups.find((group) => group.id === "content-readability")!;
	assert.equal(readability.rows.length, 0);
	assert.deepEqual([readability.pill.text, readability.pill.tone], ["Not applicable", "neutral"]);
	assert.equal(readability.notApplicableLabel, `${readability.counts.notApplicable} not applicable`);
	const keywordless = presentSeoChecks(analyzeSeoContent(input())).groups.find((group) => group.id === "basic")!;
	const noKeyword = keywordless.notApplicable.find((item) => item.reason === "No focus keyword is set.")!;
	assert.deepEqual(noKeyword.checks.map((entry) => entry.id), ["keyword-title", "keyword-description", "keyword-url", "keyword-introduction", "keyword-content", "keyword-heading"]);
	assert.equal(noKeyword.text, `${noKeyword.checks.map((entry) => entry.label).join(", ")}: No focus keyword is set.`);
	assert.equal(keywordless.notApplicable.length, 2, "rows that share a reason share one line");
	assert.equal(keywordless.counts.notApplicable, 7);
	assert.equal(seoCheckRowWord(empty.checks.find((item) => item.id === "keyword-title")!, empty), "Not applicable");
	assert.equal(seoCheckRowWord(empty.checks.find((item) => item.id === "indexability")!, empty), null);
	assert.equal(seoCheckRowWord(empty.checks.find((item) => item.id === "content-depth")!, empty), "Failed");
});

check("rows read Failed, Partly met, Suggestion, Not checked and Passed in that order, heavier first", () => {
	const result = analyzeSeoContent(input({ title: "", document: [paragraph("Hello world")] }));
	const basic = presentSeoChecks(result).groups.find((group) => group.id === "basic")!;
	assert.deepEqual(basic.rows.map((row) => [row.check.id, row.word]), [
		["title", "Failed"], ["content-depth", "Failed"], ["focus-keyword", "Suggestion"], ["description", "Passed"], ["url", "Passed"],
	]);
	const templated = analyzeSeoContent(input({ document: undefined, body: "", bodySource: "template", focusKeywords: ["boiler repair"] }));
	const templateBasic = presentSeoChecks(templated).groups.find((group) => group.id === "basic")!;
	assert.deepEqual(templateBasic.rows.filter((row) => row.kind === "not-checked").map((row) => row.check.id),
		["content-depth", "keyword-content", "keyword-introduction", "keyword-heading"], "not-checked rows keep table order, weighted rows first");
	assert.ok(templateBasic.rows.filter((row) => row.kind === "not-checked").every((row) => row.showRecommendation), "Not checked rows show their recommendation");
	assert.ok(templateBasic.rows.filter((row) => row.kind === "passed").every((row) => !row.showRecommendation && row.action === null));
});

check("actions are named by target and offered only on Failed, Partly met and Suggestion rows", () => {
	assert.deepEqual(SEO_CHECK_ACTION_VERBS, {
		keyword: "Add keyword", title: "Edit title", description: "Edit description", slug: "Review URL", image: "Edit image", advanced: "Open Advanced",
	});
	const keywordless = presentSeoChecks(analyzeSeoContent(input({ image: "" })));
	const rows = keywordless.groups.flatMap((group) => group.rows);
	assert.deepEqual(rows.find((row) => row.check.id === "focus-keyword")?.action, { target: "keyword", verb: "Add keyword" });
	assert.deepEqual(rows.find((row) => row.check.id === "social-image")?.action, { target: "image", verb: "Edit image" });
	const missed = presentSeoChecks(analyzeSeoContent(input({ focusKeywords: ["heat pump installation"], url: "https://example.test/#fragment" })));
	const missedRows = missed.groups.flatMap((group) => group.rows);
	for (const [id, verb] of [["keyword-title", "Edit title"], ["keyword-description", "Edit description"], ["keyword-url", "Review URL"], ["url", "Open Advanced"]] as const)
		assert.equal(missedRows.find((row) => row.check.id === id)?.action?.verb, verb, id);
	assert.equal(missedRows.find((row) => row.check.id === "keyword-content")?.action, null, "body rows have no editor target");
	assert.ok(missedRows.filter((row) => row.kind === "passed" || row.kind === "not-checked").every((row) => row.action === null));
	for (const [id, target] of [["title-display-length", "title"], ["description-display-length", "description"], ["keyword-title-position", "title"], ["social-image-fallback", "image"], ["canonical-policy-review", "advanced"], ["content-depth", null], ["indexability", null]] as const)
		assert.equal(seoCheckActionTarget({ id }), target, id);
});

check("an earlier analyzer reads Earlier analyzer: no counts, no actions and no number", () => {
	for (const [key, { score }] of Object.entries(ANALYZER_20_FIXTURES)) {
		const presentation = presentSeoChecks(score);
		assert.equal(presentation.legacy, true, key);
		assert.equal(presentation.defaultOpenGroupId, null, key);
		assert.deepEqual(presentation.totals, { issues: 0, suggestions: 0, notChecked: 0, notApplicable: presentation.totals.notApplicable, passed: 0 }, key);
		assert.ok(presentation.groups.every((group) => group.pill.text === "Earlier analyzer" && group.pill.tone === "neutral"), key);
		assert.ok(presentation.groups.flatMap((group) => group.rows).every((row) => row.word === "Earlier result" && row.action === null && !row.showRecommendation), key);
		assertWellFormed(key, score as never, presentation);
		const display = seoScoreDisplay(score);
		assert.equal(display.score, null, key);
		assert.equal(seoScoreDisplayText(display), SEO_EARLIER_ANALYZER_TEXT, key);
	}
	assert.equal(SEO_EARLIER_ANALYZER_TEXT, "Earlier analyzer. Analyze again.");
	assert.equal(presentSeoChecks({ checks: [], scoreVersion: SEO_SCORE_VERSION }).legacy, false);
});

check("band labels and short display text are shared", () => {
	assert.deepEqual(["good", "needs-improvement", "poor"].map((band) => seoScoreBandLabel(band as never)), ["Good", "Needs improvement", "Poor"]);
	assert.deepEqual(["excellent", "good", "needs-work", "poor", "pending"].map(seoGradeBandLabel), ["Good", "Good", "Needs improvement", "Poor", "Not scored"]);
	const limited = acceptanceResults.find((result) => result.score === 70 && result.metrics.wordCount === 61)!;
	assert.equal(seoScoreDisplayText(seoScoreDisplay(limited)), "70/100, Needs improvement");
	const dashed = acceptanceResults.find((result) => seoScoreDisplay(result).label === "Too little text to score")!;
	assert.equal(seoScoreDisplayText(seoScoreDisplay(dashed)), "Too little text to score. 2 words of body text");
	assert.equal(seoCheckTotalsText({ issues: 2, suggestions: 1, notChecked: 0 }), "2 issues, 1 suggestion");
	assert.equal(seoCheckTotalsText({ issues: 0, suggestions: 2, notChecked: 3 }), "0 issues, 2 suggestions, 3 not checked");
	assert.equal(seoCheckTotalsText({ issues: 1, suggestions: 0, notChecked: 0 }), "1 issue, 0 suggestions");
});

check("the default open group is the first with issues, else suggestions, else not-checked rows", () => {
	const failed = presentSeoChecks(analyzeSeoContent(input({ document: [paragraph(sentences(120))], image: "" })));
	assert.equal(failed.defaultOpenGroupId, "basic");
	const full = acceptanceResults.find((result) => result.score === 100 && result.keyword === "boiler repair" && result.metrics.wordCount === 600)!;
	const withRow = (id: string, patch: Partial<SeoContentCheck>) => ({ ...full, checks: full.checks.map((item) => item.id === id ? { ...item, ...patch } : item) });
	assert.equal(presentSeoChecks(withRow("title-display-length", { status: "review" })).defaultOpenGroupId, "search-snippet");
	assert.equal(presentSeoChecks(withRow("schema", { status: "review", basis: "unavailable" })).defaultOpenGroupId, "additional");
	assert.equal(presentSeoChecks(full).defaultOpenGroupId, null);
});

assert.equal(cases, 10);
console.log(`Check presentation self-check passed (${cases} cases).`);
