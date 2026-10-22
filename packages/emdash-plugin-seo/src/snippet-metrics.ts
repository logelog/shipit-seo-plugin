export interface SnippetTextProfile {
	readonly width: number;
	readonly fontSize: number;
	readonly lineCount: number;
	readonly lineHeight: number;
	readonly weight: "regular" | "bold";
	readonly fontFamily: string;
	readonly metrics: "nimbus-sans-v1";
}

export interface SnippetPreviewProfile {
	title: { width: number; height: number; fontSize: number; lineHeight: number; nowrap: boolean };
	description: { width: number; height: number; fontSize: number; lineHeight: number };
}

export interface MeasuredSnippetPreviewProfile extends SnippetPreviewProfile {
	readonly title: SnippetTextProfile & { readonly height: number; readonly nowrap: boolean };
	readonly description: SnippetTextProfile & { readonly height: number };
}

export function snippetTextProfile(
	width: number,
	fontSize: number,
	lineCount: number,
	weight: "regular" | "bold" = "regular",
): SnippetTextProfile {
	return Object.freeze({
		width, fontSize, lineCount, weight, lineHeight: 1.5,
		// Metric-compatible families keep the rendered card on these advances where Arial is not installed.
		fontFamily: 'Arial, Helvetica, "Nimbus Sans", "Nimbus Sans L", "Liberation Sans", Arimo, sans-serif', metrics: "nimbus-sans-v1",
	});
}

// These are local display assumptions, independent of the surrounding editor.
// The analyzer fits saved metadata with them too, so changing a width, a line
// count or an advance changes snippet-fit rows and needs a new SEO_SCORE_VERSION.
export const SNIPPET_PREVIEW_PROFILES = Object.freeze({
	desktop: Object.freeze({
		title: Object.freeze({ ...snippetTextProfile(538, 18, 1), height: 24, lineHeight: 1.3, nowrap: true }),
		description: Object.freeze({ ...snippetTextProfile(538, 13, 2), height: 39 }),
	}),
	mobile: Object.freeze({
		title: Object.freeze({ ...snippetTextProfile(338, 16, 2), height: 44, lineHeight: 1.35, nowrap: false }),
		description: Object.freeze({ ...snippetTextProfile(338, 13, 3), height: 58.5 }),
	}),
}) satisfies Readonly<Record<"desktop" | "mobile", MeasuredSnippetPreviewProfile>>;

export const SNIPPET_PREVIEW_INPUT_LIMIT = 32_768;
const PREFIX_LIMIT = 512;
const segmenter = typeof Intl.Segmenter === "function"
	? new Intl.Segmenter(undefined, { granularity: "grapheme" })
	: null;

// Preserve common combining and emoji sequences when Segmenter is unavailable.
function fallbackGraphemes(value: string): string[] {
	const clusters: string[] = [];
	let regionalIndicators = 0;
	for (const character of value) {
		const last = clusters.length - 1;
		const regional = /[\u{1f1e6}-\u{1f1ff}]/u.test(character);
		const extendsCluster = /[\p{Mark}\u{1f3fb}-\u{1f3ff}]/u.test(character);
		const joinedPictograph = last >= 0 && clusters[last].endsWith("\u200d") &&
			/\p{Extended_Pictographic}/u.test(clusters[last]) && /\p{Extended_Pictographic}/u.test(character);
		if (last >= 0 && (extendsCluster || character === "\u200d" || joinedPictograph ||
			(regional && regionalIndicators % 2 === 1))) {
			clusters[last] += character;
		} else {
			clusters.push(character);
		}
		regionalIndicators = regional ? regionalIndicators + 1 : 0;
	}
	return clusters;
}

function graphemes(value: string): string[] {
	return segmenter
		? Array.from(segmenter.segment(value), (segment) => segment.segment)
		: fallbackGraphemes(value);
}

function boundedText(value: string, limit: number): { text: string; limited: boolean } {
	if (value.length <= limit) return { text: value, limited: false };
	const clusters = graphemes(value.slice(0, limit + 64));
	let length = 0;
	let end = 0;
	while (end < clusters.length && length + clusters[end].length <= limit) length += clusters[end++].length;
	return { text: clusters.slice(0, end).join(""), limited: true };
}

// Advance widths measured from Nimbus Sans Regular/Bold AFM v1.00, in 1/1000 em.
// Accents use their Latin base; emoji/CJK use 1 em; other scripts use 0.65 em.
// Kerning and script shaping vary by renderer, so this is an approximation.
const REGULAR_ADVANCES = [278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584] as const;
// Punctuation that titles, templates and the date prefix render, from the same AFM files: [regular, bold].
const PUNCTUATION_ADVANCES: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
	"\u00a0": [278, 278], "\u00ab": [556, 556], "\u00b7": [278, 278], "\u00bb": [556, 556],
	"\u2013": [556, 556], "\u2014": [1000, 1000], "\u2018": [222, 278], "\u2019": [222, 278],
	"\u201c": [333, 500], "\u201d": [333, 500], "\u2022": [350, 350], "\u2026": [1000, 1000],
	"\u2039": [333, 333], "\u203a": [333, 333],
});
const BOLD_ADVANCES = [278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 278, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584] as const;

function clusterAdvance(cluster: string, weight: SnippetTextProfile["weight"]): number {
	if (/\p{Extended_Pictographic}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(cluster)) return 1000;
	let advance = 0;
	for (const character of cluster.normalize("NFD")) {
		if (/\p{Mark}|[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufe0e\ufe0f]/u.test(character)) continue;
		const code = character.codePointAt(0)!;
		if (code >= 32 && code <= 126) advance += (weight === "bold" ? BOLD_ADVANCES : REGULAR_ADVANCES)[code - 32];
		else if (Object.hasOwn(PUNCTUATION_ADVANCES, character)) advance += PUNCTUATION_ADVANCES[character]![weight === "bold" ? 1 : 0];
		else if (character === "ı") advance += weight === "bold" ? 278 : 222;
		else advance += 650;
	}
	return advance;
}

export function measureSnippetPreviewText(value: string, profile: SnippetTextProfile): number {
	const bounded = boundedText(value, SNIPPET_PREVIEW_INPUT_LIMIT);
	return graphemes(bounded.text).reduce((width, cluster) => width + clusterAdvance(cluster, profile.weight), 0)
		* profile.fontSize / 1000;
}

function wrapText(value: string, profile: SnippetTextProfile): string[] | null {
	const lines: string[] = [];
	let line = "";
	let width = 0;
	for (const word of value.split(" ")) {
		const gap = line ? clusterAdvance(" ", profile.weight) * profile.fontSize / 1000 : 0;
		const wordWidth = measureSnippetPreviewText(word, profile);
		if (line && width + gap + wordWidth > profile.width) {
			lines.push(line);
			if (lines.length >= profile.lineCount) return null;
			line = "";
			width = 0;
		}
		if (line) {
			line += " ";
			width += gap;
		}
		for (const cluster of graphemes(word)) {
			const nextWidth = clusterAdvance(cluster, profile.weight) * profile.fontSize / 1000;
			if (nextWidth > profile.width) return null;
			if (line && width + nextWidth > profile.width) {
				lines.push(line);
				if (lines.length >= profile.lineCount) return null;
				line = "";
				width = 0;
			}
			line += cluster;
			width += nextWidth;
		}
	}
	if (line) lines.push(line);
	return lines.length <= profile.lineCount ? lines : null;
}

/** A cut inside a word moves back to the last space within this many graphemes; a longer word is cut where it overflows. */
const WORD_CUT_MAX_GRAPHEMES = 20;

/** The last space before a cut that falls inside a word, or null when the cut already ends a word or no space is near. */
function wordBoundaryBefore(characters: readonly string[], end: number): number | null {
	if (end <= 0 || end >= characters.length || /\s/u.test(characters[end]!) || /\s/u.test(characters[end - 1]!)) return null;
	for (let index = end - 1; index > 0 && end - index <= WORD_CUT_MAX_GRAPHEMES; index--) {
		if (/\s/u.test(characters[index]!)) return characters.slice(0, index).join("").trim() ? index : null;
	}
	return null;
}

export interface FittedSnippetText {
	text: string;
	/** Fitted display text, including the normalized prefix, before line wrapping. */
	displayText: string;
	lines: string[];
	clipped: boolean;
	inputLimited: boolean;
	prefixClipped: boolean;
}

export function fitSnippetPreviewText(
	value: string,
	profile: SnippetTextProfile,
	prefix = "",
): FittedSnippetText {
	if (!Number.isFinite(profile.width) || profile.width <= 0 ||
		!Number.isFinite(profile.fontSize) || profile.fontSize <= 0 ||
		!Number.isInteger(profile.lineCount) || profile.lineCount < 1 || profile.lineCount > 8) {
		throw new RangeError("Invalid snippet preview profile");
	}
	const bounded = boundedText(value, SNIPPET_PREVIEW_INPUT_LIMIT);
	const boundedPrefix = boundedText(prefix, PREFIX_LIMIT);
	const text = bounded.text.replace(/\s+/gu, " ").trim();
	const leading = boundedPrefix.text.replace(/\s+/gu, " ").trim();
	const join = (candidate: string) => [leading, candidate].filter(Boolean).join(" ");
	const inputLimited = bounded.limited || boundedPrefix.limited;
	const completeLines = wrapText(join(text), profile);
	if (completeLines && !inputLimited) return { text, displayText: join(text), lines: completeLines, clipped: false, inputLimited, prefixClipped: false };

	if (boundedPrefix.limited || !wrapText(leading, profile)) {
		return { text: "", displayText: "", lines: [], clipped: true, inputLimited, prefixClipped: true };
	}
	const characters = graphemes(text);
	let low = 0;
	let high = characters.length;
	// Ellipsis can push a word to another line; find the unadorned bound first.
	while (low < high) {
		const midpoint = Math.ceil((low + high) / 2);
		if (wrapText(join(characters.slice(0, midpoint).join("").trimEnd()), profile)) low = midpoint;
		else high = midpoint - 1;
	}
	if (wrapText(join("…"), profile)) {
		let end = low;
		let attempts = 0;
		while (end >= 0 && attempts < 64) {
			// Removing zero-width suffixes cannot change the measured fit.
			while (end > 0 && clusterAdvance(characters[end - 1], profile.weight) === 0) end--;
			const candidate = characters.slice(0, end).join("").trimEnd() + "…";
			const lines = wrapText(join(candidate), profile);
			if (lines) {
				const boundary = wordBoundaryBefore(characters, end);
				const whole = boundary === null ? null : characters.slice(0, boundary).join("").trimEnd() + "\u2026";
				const wholeLines = whole === null ? null : wrapText(join(whole), profile);
				if (whole !== null && wholeLines) return { text: whole, displayText: join(whole), lines: wholeLines, clipped: true, inputLimited, prefixClipped: false };
				return { text: candidate, displayText: join(candidate), lines, clipped: true, inputLimited, prefixClipped: false };
			}
			end--;
			attempts++;
		}
		if (end >= 0) return { text: "", displayText: leading, lines: wrapText(leading, profile) ?? [],
			clipped: true, inputLimited: true, prefixClipped: false };
	}
	return { text: "", displayText: leading, lines: wrapText(leading, profile) ?? [], clipped: true, inputLimited, prefixClipped: false };

}

/** The prefix must consume the same line budget as the text it precedes. */
export function truncateSnippetPreviewText(
	value: string,
	prefix: string,
	fits: (candidate: string) => boolean,
): { text: string; clipped: boolean } {
	const bounded = boundedText(value, SNIPPET_PREVIEW_INPUT_LIMIT);
	const boundedPrefix = boundedText(prefix, PREFIX_LIMIT);
	if (!bounded.limited && !boundedPrefix.limited && fits(prefix + value)) return { text: value, clipped: false };
	if (boundedPrefix.limited || !fits(prefix + "…")) return { text: "", clipped: true };

	const characters = graphemes(bounded.text);
	let low = 0;
	let high = characters.length;
	while (low < high) {
		const midpoint = Math.ceil((low + high) / 2);
		const candidate = characters.slice(0, midpoint).join("").trimEnd() + "…";
		if (fits(prefix + candidate)) low = midpoint;
		else high = midpoint - 1;
	}
	return { text: characters.slice(0, low).join("").trimEnd() + "…", clipped: true };
}
