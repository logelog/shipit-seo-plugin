/**
 * Normalise text for literal focus-keyword evidence. The analyzer is not a
 * search-volume or stemming engine: it only reports whether the same phrase
 * is present after harmless case, accent, punctuation, and spacing changes.
 */
export function normaliseSeoKeywordText(value: unknown): string {
	if (typeof value !== "string") return "";
	return value
		.normalize("NFKD")
		// Marks are removable accents only on these bases; Thai, Indic and kana marks change the word.
		.replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}])\p{M}+/gu, "$1")
		.toLocaleLowerCase("en")
		// A fixed locale lowercases Turkish "I" to "i", so its dotless pair folds to the same letter.
		.replace(/\u0131/gu, "i")
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

export function seoKeywordIdentity(value: unknown): string {
	return normaliseSeoKeywordText(value);
}

export function seoTextContainsKeyword(text: unknown, keyword: unknown): boolean {
	return seoKeywordOccurrenceCount(text, keyword) > 0;
}

/**
 * Scripts written without spaces between words. A phrase in one of them
 * matches as a substring, because word boundaries are not marked by spaces.
 */
const UNSPACED = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]`;
export const UNSPACED_SCRIPT = new RegExp(UNSPACED, "u");

/** Any other phrase needs a boundary on both sides: an edge, a space or a character of an unspaced script. */
function phrasePattern(text: unknown, keyword: unknown): { haystack: string; pattern: RegExp } | null {
	const haystack = normaliseSeoKeywordText(text);
	const phrase = normaliseSeoKeywordText(keyword);
	if (!haystack || !phrase) return null;
	const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const pattern = UNSPACED_SCRIPT.test(phrase)
		? new RegExp(escaped, "gu")
		: new RegExp(String.raw`(?<=^| |${UNSPACED}\p{M}*)${escaped}(?=$| |${UNSPACED})`, "gu");
	return { haystack, pattern };
}

const graphemeSegmenter = typeof Intl.Segmenter === "function"
	? new Intl.Segmenter(undefined, { granularity: "grapheme" })
	: null;

/**
 * Original-text ranges, as [start, end) UTF-16 offsets, whose normalized form
 * the phrase pattern matches. Each grapheme is normalized on its own; when
 * those pieces do not rebuild the whole-text normalization exactly, no range
 * is returned rather than a guessed one.
 */
export function seoKeywordMatchRanges(text: unknown, keyword: unknown): Array<[number, number]> {
	if (typeof text !== "string") return [];
	const search = phrasePattern(text, keyword);
	if (!search) return [];
	const pieces = graphemeSegmenter
		? Array.from(graphemeSegmenter.segment(text), (part) => ({ value: part.segment, start: part.index }))
		: Array.from(text.matchAll(/[\s\S]/gu), (match) => ({ value: match[0], start: match.index! }));
	let normalized = "";
	const origins: Array<[number, number]> = [];
	for (const piece of pieces) {
		const end = piece.start + piece.value.length;
		const value = piece.value
			.normalize("NFKD")
			.replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}])\p{M}+/gu, "$1")
			.toLocaleLowerCase("en")
			.replace(/ı/gu, "i")
			.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ");
		for (const character of value) {
			if (character === " " && (!normalized || normalized.endsWith(" "))) continue;
			normalized += character;
			for (let index = 0; index < character.length; index += 1) origins.push([piece.start, end]);
		}
	}
	if (normalized.endsWith(" ")) {
		normalized = normalized.slice(0, -1);
		origins.pop();
	}
	if (normalized !== search.haystack) return [];
	const ranges: Array<[number, number]> = [];
	for (const match of normalized.matchAll(search.pattern)) {
		if (!match[0]) continue;
		const start = origins[match.index]![0];
		const end = origins[match.index + match[0].length - 1]![1];
		const last = ranges.at(-1);
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else ranges.push([start, end]);
	}
	return ranges;
}

/** First match in normalized text, or -1 when the phrase is absent. */
export function seoKeywordFirstPosition(text: unknown, keyword: unknown): number {
	const search = phrasePattern(text, keyword);
	return search ? search.haystack.search(search.pattern) : -1;
}

/**
 * Count literal phrase occurrences after presentation-only normalization.
 * This is evidence about the saved copy, not a search-volume, stemming, or
 * ranking estimate.
 */
export function seoKeywordOccurrenceCount(
	text: unknown,
	keyword: unknown,
): number {
	const search = phrasePattern(text, keyword);
	if (!search) return 0;
	let count = 0;
	for (const _match of search.haystack.matchAll(search.pattern)) count += 1;
	return count;
}
