// Wording that earlier versions stored in analysis rows and score history.
// It is the only module that may name the earlier product in shipped code;
// the packed-archive check allows that name nowhere else.

/** Remove earlier product names from stored rows without changing historical thresholds. */
export const LEGACY_BRAND_PHRASES: ReadonlyArray<readonly [earlier: string, current: string]> = [
	["the meta description Shipit resolves from saved values", "the meta description resolved from saved values"],
	["the meta description Shipit resolves;", "the meta description resolved from saved values;"],
	["Reports the saved directive Shipit resolves;", "Reports the directive resolved from saved settings;"],
	["Shipit site-wide setting, entry SEO noindex and legacy robots override", "site-wide noindex setting, entry SEO noindex and legacy robots override"],
	["the content type rule in Shipit SEO Indexing rules", "the content type rule in Indexing rules"],
	["the site-wide noindex setting in Shipit SEO", "the site-wide noindex setting in Indexing rules"],
	["the Shipit site-wide noindex setting", "the site-wide noindex setting"],
	["the Shipit content type noindex rule", "the content type noindex rule"],
	["a legacy Shipit robots override", "a legacy robots override"],
	["an earlier Shipit robots setting", "an earlier robots setting"],
	["legacy Shipit override", "legacy SEO override"],
	["optional and private to Shipit;", "optional and used only by these checks;"],
	["Shipit SEO focus keyword profile", "SEO focus keyword profile"],
	["Shipit SEO keyword profile", "SEO keyword profile"],
	["The 3.5% threshold is Shipit guidance;", "The 3.5% threshold is a checklist guideline;"],
	["Shipit flags more than 3.5%.", "This checklist flags more than 3.5%."],
	["This is Shipit guidance, not a Google limit.", "This is a checklist guideline, not a Google limit."],
	["Word targets are Shipit guidance;", "Word targets are checklist guidelines;"],
	["(Shipit guidance;", "(checklist guideline;"],
	["(Shipit guidance)", "(checklist guideline)"],
	["Shipit suggests at least 300 words", "This checklist suggests at least 300 words"],
	["fits in Shipit's phone and desktop previews", "fits in the phone and desktop previews"],
	["Estimated with Shipit preview widths", "Estimated with preview widths"],
	["what a Shipit template adds", "what a metadata template adds"],
	["Shipit schema configuration", "Schema configuration"],
	["No Shipit graph is predicted", "No schema graph is predicted"],
	["saved Shipit schema settings", "saved schema settings"],
];

/** The earlier name as a word, with its possessive; never part of a longer word. */
export const LEGACY_BRAND_NAME = /\b(Shipit SEO|Shipit)('s)?(?![\w-])/g;
/** The full earlier product name, which keeps "SEO" when the earlier word is dropped. */
export const LEGACY_BRAND_FULL_NAME = "Shipit SEO";
export const LEGACY_BRAND_PRESENT = /Shipit/;

/** Words that follow the earlier name as the subject of a sentence. */
export const LEGACY_BRAND_VERBS: ReadonlySet<string> = new Set([
	"adds", "added", "answers", "can", "cannot", "checks", "could", "covers", "creates", "decides", "did", "does", "edits",
	"flags", "has", "hit", "is", "keeps", "leaves", "may", "needs", "paused", "pauses", "predicts", "reads", "records",
	"resolves", "resumes", "serves", "sets", "suggests", "then", "tracked", "uses", "will", "would",
]);

/** Words the earlier name qualified; they read the same without it, except where a neutral word stands in. */
export const LEGACY_BRAND_NOUNS: Readonly<Record<string, string>> = {
	guidance: "checklist ", admin: "", analysis: "", archive: "", checklist: "", configuration: "", content: "", default: "",
	defaults: "", engine: "", features: "", focus: "", graph: "", keyword: "", metadata: "", modules: "", noindex: "", output: "",
	override: "", overrides: "", packages: "", presets: "", preview: "", previews: "", record: "", records: "", robots: "",
	rule: "", rules: "", schema: "", score: "", settings: "", "site-wide": "", social: "", tags: "", template: "", templates: "",
};
