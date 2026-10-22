import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import {
	fitSnippetPreviewText, measureSnippetPreviewText, resolvePreviewField,
	SNIPPET_PREVIEW_INPUT_LIMIT, SNIPPET_PREVIEW_PROFILES, snippetTextProfile, truncateSnippetPreviewText,
} from "./snippet-preview.ts";
import { buildSocialPreviewModel, SOCIAL_PREVIEW_PROFILES } from "./social-preview-model.ts";

const singleLine = snippetTextProfile(20, 10, 1);
assert.equal(measureSnippetPreviewText("WWW", singleLine), 28.32);
assert.equal(measureSnippetPreviewText("iii", singleLine), 6.66);
assert.equal(measureSnippetPreviewText("é", singleLine), measureSnippetPreviewText("e\u0301", singleLine));
assert.equal(measureSnippetPreviewText("👨‍👩‍👧‍👦", singleLine), 10);
assert.deepEqual(fitSnippetPreviewText("WWWW", singleLine).lines, ["W…"]);
assert.deepEqual(fitSnippetPreviewText("i WW WWW", snippetTextProfile(25, 10, 2)).lines, ["i WW", "W…"]);
const legacyShape: import("./snippet-preview.ts").SnippetPreviewProfile = {
	title: { width: 100, height: 24, fontSize: 18, lineHeight: 1.3, nowrap: true },
	description: { width: 100, height: 39, fontSize: 13, lineHeight: 1.5 },
};
assert.equal(legacyShape.title.width, 100);
assert.deepEqual(fitSnippetPreviewText("  Een\nwebsite  ", snippetTextProfile(200, 13, 2)), {
	text: "Een website", displayText: "Een website", lines: ["Een website"], clipped: false, inputLimited: false, prefixClipped: false,
});

const ordinaryDescription = "Clear appointment preparation helps patients organise practical questions and confirmed details before a first dental visit, with useful notes for the practice.";
assert.equal([...ordinaryDescription].length, 160);
const oldMobileDescription = fitSnippetPreviewText(ordinaryDescription, snippetTextProfile(338, 13, 2));
assert.equal(oldMobileDescription.clipped, true, "Control: the former two-line card cuts ordinary 160-character prose.");
const ordinaryMobileDescription = fitSnippetPreviewText(ordinaryDescription, SNIPPET_PREVIEW_PROFILES.mobile.description);
assert.equal(ordinaryMobileDescription.text, ordinaryDescription, "The mobile card must retain this ordinary description instead of cutting it early.");
assert.equal(ordinaryMobileDescription.clipped, false);
assert.equal(ordinaryMobileDescription.lines.length, 3);
assert.equal(SNIPPET_PREVIEW_PROFILES.mobile.description.height,
	SNIPPET_PREVIEW_PROFILES.mobile.description.fontSize * SNIPPET_PREVIEW_PROFILES.mobile.description.lineHeight * ordinaryMobileDescription.lines.length,
	"The mobile height must contain all three description lines.");
const wideMobileDescription = fitSnippetPreviewText("W".repeat(160), SNIPPET_PREVIEW_PROFILES.mobile.description);
assert.equal(wideMobileDescription.clipped, true, "Three mobile lines are a visual budget, not a universal 160-character allowance.");
assert.ok(wideMobileDescription.text.endsWith("…"));
const ordinaryWithDate = fitSnippetPreviewText(ordinaryDescription, SNIPPET_PREVIEW_PROFILES.mobile.description, "16 Oct 2026 -");
assert.match(ordinaryWithDate.lines[0], /^16 Oct 2026 - /);
assert.ok(ordinaryWithDate.text.length <= ordinaryMobileDescription.text.length);

const description = "De volledige beschrijving van een website-contentaudit die tot beslissingen leidt. ".repeat(10);
const withoutDate = fitSnippetPreviewText(description, SNIPPET_PREVIEW_PROFILES.mobile.description);
const withDate = fitSnippetPreviewText(description, SNIPPET_PREVIEW_PROFILES.mobile.description, "28 sep 2026 - ");
assert.ok(withDate.text.length < withoutDate.text.length);
assert.match(withDate.lines[0], /^28 sep 2026 - /);
assert.equal(withDate.clipped, true);

const normalizedDate = fitSnippetPreviewText("  Clear\n content. ", snippetTextProfile(240, 13, 2), " 17 \n Oct  2026 - ");
assert.equal(normalizedDate.displayText, "17 Oct 2026 - Clear content.");
assert.equal(normalizedDate.text, "Clear content.");
for (const unbroken of ["漢字交じり文を改行しても文字は変えない", "unbroken".repeat(6), "👩🏽‍💻".repeat(8)]) {
	const fitted = fitSnippetPreviewText(unbroken, snippetTextProfile(60, 10, 8));
	assert.equal(fitted.clipped, false);
	assert.equal(fitted.text, unbroken);
	assert.equal(fitted.displayText, unbroken, "Natural flow retains exact characters before logical wrapping.");
	assert.ok(fitted.lines.length > 1);
	assert.notEqual(fitted.lines.join(" "), unbroken, "Control: joining logical lines would insert characters.");
}
assert.equal(withDate.displayText, "28 sep 2026 - " + withDate.text);
assert.ok(withDate.displayText.endsWith("…"), "Natural flow retains the fitter's clipping marker.");
assert.equal(fitSnippetPreviewText("description", singleLine, "prefix too long").displayText, "");
assert.equal(fitSnippetPreviewText("WW", snippetTextProfile(10, 10, 1), "i").displayText, "i", "A prefix-only fit retains only the displayed prefix.");

for (const device of ["desktop", "mobile"] as const) {
	const profile = SNIPPET_PREVIEW_PROFILES[device];
	assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.title) && Object.isFrozen(profile.description));
	for (const text of [
		"W".repeat(300), "i".repeat(300), description, "İstanbul için ölçülmüş açıklama ".repeat(20),
		"עברית العربية ".repeat(20), "漢字テスト ".repeat(100), "👨‍👩‍👧‍👦e\u0301 ".repeat(100),
	]) {
		for (const budget of [profile.title, profile.description]) {
			const result = fitSnippetPreviewText(text, budget);
			assert.ok(result.lines.length <= budget.lineCount);
			for (const line of result.lines) assert.ok(measureSnippetPreviewText(line, budget) <= budget.width + 0.0001);
			assert.ok(!result.text.includes("\ufffd"));
			if (result.clipped) assert.ok(result.text.endsWith("…"));
		}
	}
}
assert.notEqual(
	fitSnippetPreviewText(description, SNIPPET_PREVIEW_PROFILES.desktop.description).text,
	fitSnippetPreviewText(description, SNIPPET_PREVIEW_PROFILES.mobile.description).text,
);

const family = "👨‍👩‍👧‍👦";
assert.equal(fitSnippetPreviewText("A" + family + "BC", snippetTextProfile(27, 10, 1)).text, "A" + family + "…");
assert.equal(fitSnippetPreviewText("e\u0301".repeat(50), snippetTextProfile(22, 10, 1)).text, "e\u0301e\u0301…");
const bounded = fitSnippetPreviewText("W".repeat(SNIPPET_PREVIEW_INPUT_LIMIT + 100), singleLine);
assert.equal(bounded.inputLimited, true);
assert.equal(bounded.text, "W…");
const zeroWidthSuffix = fitSnippetPreviewText("W".repeat(31) + "\u200b".repeat(SNIPPET_PREVIEW_INPUT_LIMIT), SNIPPET_PREVIEW_PROFILES.desktop.title);
assert.equal(zeroWidthSuffix.text, "W".repeat(30) + "…");
assert.equal(zeroWidthSuffix.inputLimited, true);
assert.equal(fitSnippetPreviewText("description", singleLine, "prefix too long").prefixClipped, true);
assert.equal(fitSnippetPreviewText("W", snippetTextProfile(1, 10, 1)).text, "");
assert.throws(() => fitSnippetPreviewText("test", snippetTextProfile(NaN, 13, 2)), RangeError);

assert.deepEqual(resolvePreviewField({ value: "Resolved template", source: "template" }), {
	value: "Resolved template", source: "template", state: "saved",
});
assert.deepEqual(resolvePreviewField({ value: "saved", source: "core-seo" }, { value: "fallback", source: "template" }), {
	value: "fallback", source: "template", state: "draft",
});
assert.deepEqual(resolvePreviewField({ value: "saved", source: "content" }, { value: "not readable", source: "template", unavailable: true }), {
	value: null, source: "template", state: "unavailable",
});

const fitsTwentyCharacters = (candidate: string) => Array.from(candidate).length <= 20;
assert.equal(truncateSnippetPreviewText("De volledige beschrijving", "", fitsTwentyCharacters).text, "De volledige beschr…");
assert.equal(truncateSnippetPreviewText("De volledige beschrijving", "28 sep 2026 - ", fitsTwentyCharacters).text, "De vo…");
assert.deepEqual(truncateSnippetPreviewText("test", "", () => true), { text: "test", clipped: false });
assert.deepEqual(truncateSnippetPreviewText("test", "prefix", () => false), { text: "", clipped: true });
assert.equal(truncateSnippetPreviewText("A" + family + "BC", "", (candidate) =>
	candidate === "A" + family + "…" || candidate === "A…" || candidate === "…").text, "A" + family + "…");
// snippet-preview.ts re-exports the shared metrics, so the fallback loads the module that defines them.
const metricsSource = readFileSync(new URL("../snippet-metrics.ts", import.meta.url), "utf8");
assert.doesNotMatch(metricsSource, /^\s*(?:import|export\s+[^;]*\sfrom)\s/m, "the metrics module must stay import-free to load in isolation");
const fallbackModule = { exports: {} as typeof import("../snippet-metrics.ts") };
const fallbackIntl = Object.create(Intl) as typeof Intl;
Object.defineProperty(fallbackIntl, "Segmenter", { value: undefined });
const fallbackSource = ts.transpileModule(metricsSource, {
	fileName: "snippet-metrics.ts", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
assert.deepEqual(fallbackSource.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
new Function("Intl", "module", "exports", fallbackSource.outputText)(fallbackIntl, fallbackModule, fallbackModule.exports);
for (const cluster of [family, "e\u0301", "👍🏽", "🇳🇱", "👩🏽‍💻", "✈️"]) {
	assert.equal(fallbackModule.exports.measureSnippetPreviewText(cluster, singleLine),
		measureSnippetPreviewText(cluster, singleLine), "Common Unicode sequences must retain their measured width without Segmenter.");
	for (const budget of [singleLine, snippetTextProfile(20, 10, 2)]) {
		assert.deepEqual(fallbackModule.exports.fitSnippetPreviewText(cluster.repeat(5), budget),
			fitSnippetPreviewText(cluster.repeat(5), budget), "Wrapping and clipping must preserve complete common Unicode sequences.");
	}
	assert.equal(fallbackModule.exports.truncateSnippetPreviewText(cluster + "BC", "",
		(candidate) => candidate.length <= cluster.length).text, "…", "A text bound must not retain part of a Unicode sequence.");
	const prefixLength = SNIPPET_PREVIEW_INPUT_LIMIT - Math.floor(cluster.length / 2);
	const prefix = "i".repeat(prefixLength);
	assert.equal(fallbackModule.exports.truncateSnippetPreviewText(prefix + cluster + "BC", "", () => true).text,
		prefix + "…", "The processing limit must not retain a partial sequence.");
}
assert.equal(fallbackModule.exports.fitSnippetPreviewText("🇳🇱🇩🇪", singleLine).text, "…",
	"Flag clipping must preserve each pair of regional indicators.");
assert.equal(fallbackModule.exports.measureSnippetPreviewText(family, singleLine), 10);

// The rendered date prefix and template separators are measured with their real advances (Nimbus Sans AFM, 1/1000 em).
const em = snippetTextProfile(1000, 10, 1);
const emBold = snippetTextProfile(1000, 10, 1, "bold");
for (const [character, regular, bold] of [
	["\u2014", 1000, 1000], ["\u2013", 556, 556], ["\u2018", 222, 278], ["\u2019", 222, 278], ["\u201c", 333, 500],
	["\u201d", 333, 500], ["\u2022", 350, 350], ["\u00b7", 278, 278], ["\u00a0", 278, 278], ["\u2026", 1000, 1000],
] as const) {
	assert.equal(measureSnippetPreviewText(character, em), regular / 100, `regular ${character.codePointAt(0)!.toString(16)}`);
	assert.equal(measureSnippetPreviewText(character, emBold), bold / 100, `bold ${character.codePointAt(0)!.toString(16)}`);
}
assert.match(SNIPPET_PREVIEW_PROFILES.desktop.description.fontFamily, /^Arial, Helvetica, "Nimbus Sans", "Nimbus Sans L", "Liberation Sans", Arimo, sans-serif$/,
	"metric-compatible families render the measured advances where Arial is not installed");
for (const profile of [SOCIAL_PREVIEW_PROFILES.facebook.title, SOCIAL_PREVIEW_PROFILES.x.description])
	assert.equal(profile.fontFamily, SNIPPET_PREVIEW_PROFILES.mobile.title.fontFamily, "social cards share the metric font stack");

// Long descriptions behind the editor's date prefix: every line fits its device and a cut line ends with the fitted ellipsis.
const datePrefix = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
	.format(new Date("2026-10-18T09:00:00.000Z")) + " \u2014 ";
assert.equal(datePrefix, "Oct 18, 2026 \u2014 ");
const longDescriptions = [
	"This short guide explains how a small group of volunteers prepares a fictional yard for the growing season. It covers soil, seed trays, watering and the shared tools that keep the work simple and calm for everyone involved.",
	"Bring your referral letter \u2014 and a current medication list \u2014 to the first visit; the \u201cwelcome\u201d desk confirms insurance, arrival times and aftercare for families before the appointment begins in the morning.",
	"WWWWW mmmmm ".repeat(30),
];
for (const device of ["mobile", "desktop"] as const) {
	const profile = SNIPPET_PREVIEW_PROFILES[device].description;
	for (const text of longDescriptions) {
		const fitted = fitSnippetPreviewText(text, profile, datePrefix);
		assert.ok(fitted.lines.length >= 1 && fitted.lines.length <= profile.lineCount, `${device} line budget`);
		assert.ok(fitted.lines[0]!.startsWith("Oct 18, 2026 \u2014 "), `${device} line 1 carries the measured prefix`);
		for (const line of fitted.lines) assert.ok(measureSnippetPreviewText(line, profile) <= profile.width + 0.0001,
			`${device} line fits: ${line} (${measureSnippetPreviewText(line, profile)} > ${profile.width})`);
		assert.equal(fitted.clipped, true, `control: ${device} cuts this long description`);
		assert.ok(fitted.lines.at(-1)!.endsWith("\u2026"), `${device} a cut line ends with the fitted ellipsis`);
		assert.ok(fitted.displayText.startsWith(datePrefix.trim() + " "), "the prefix is part of the measured display text");
	}
}
const field = (value: string | null, source: string) => ({ value, source });
for (const platform of ["facebook", "x"] as const) {
	const model = buildSocialPreviewModel({ platform, saved: {
		title: field("Acceptance C popup authoring \u2014 EmDash Dev Site and a long sharing title that keeps going", "template"),
		description: field(longDescriptions[0]!, "template"), image: field(null, "site-default"), url: field("https://example.invalid/post", "generated"),
	} });
	for (const [fitted, profile] of [[model.fittedTitle, model.profile.title], [model.fittedDescription, model.profile.description]] as const) {
		assert.ok(fitted.lines.length <= profile.lineCount);
		for (const line of fitted.lines) assert.ok(measureSnippetPreviewText(line, profile) <= profile.width + 0.0001, `${platform} line fits: ${line}`);
		if (fitted.clipped) assert.ok(fitted.lines.at(-1)!.endsWith("\u2026"), `${platform} a cut line ends with the fitted ellipsis`);
	}
	assert.equal(model.fittedDescription.clipped, true, `control: the ${platform} card cuts the long description`);
}
// A cut inside a word moves back to the last space; a single long word is still cut where it overflows.
{
	const title = "Spring garden checklist for a small volunteer yard behind the fictional reading room and shed";
	const desktopTitle = fitSnippetPreviewText(title, SNIPPET_PREVIEW_PROFILES.desktop.title);
	assert.equal(desktopTitle.clipped, true, "control: the desktop title is cut");
	const kept = desktopTitle.text.replace(/\u2026$/u, "");
	assert.ok(title.startsWith(kept + " "), "the visible title ends on a whole word: " + kept);
	const description = "A spring garden checklist for a fictional volunteer yard, covering soil preparation, seed trays, watering rotas, compost turning, netting for young leaves and sharing spare seedlings with neighbours.";
	for (const device of ["mobile", "desktop"] as const) {
		const fitted = fitSnippetPreviewText(description, SNIPPET_PREVIEW_PROFILES[device].description, "Oct 18, 2026 \u2014");
		assert.equal(fitted.clipped, true, device + " control: the description is cut");
		const visible = fitted.text.replace(/\u2026$/u, "");
		assert.ok(description.startsWith(visible.trimEnd() + " ") || description.startsWith(visible.trimEnd() + ","),
			device + ": the visible description ends on a whole word: " + visible);
		for (const line of fitted.lines) assert.ok(measureSnippetPreviewText(line, SNIPPET_PREVIEW_PROFILES[device].description) <= SNIPPET_PREVIEW_PROFILES[device].description.width + 0.0001);
	}
	const longWord = fitSnippetPreviewText("Internationalisationalisationsupercalifragilistic", snippetTextProfile(120, 13, 1));
	assert.equal(longWord.clipped, true);
	assert.ok(longWord.text.length > 2 && longWord.text.endsWith("\u2026"), "a single long word falls back to a character cut");
	const farBoundary = fitSnippetPreviewText("Go " + "x".repeat(60), snippetTextProfile(200, 13, 1));
	assert.ok(farBoundary.text.startsWith("Go x"), "a space far behind the cut does not drop most of the visible text");
}
console.log("Snippet preview: measured widths, fixed budgets, prefixes, Unicode and bounds passed.");
