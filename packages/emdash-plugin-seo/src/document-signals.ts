export type SeoDocumentLinkKind = "internal" | "external";

export interface SeoDocumentHeading {
	level: number;
	text: string;
}

export interface SeoDocumentLink {
	href: string;
	text: string;
	kind: SeoDocumentLinkKind;
	generic: boolean;
	/** A fragment-only link or a link to the entry's own URL; never counted as an internal link. */
	sameEntry: boolean;
}

/**
 * `structured` is a block document that can carry links, `plain-text` a
 * string body, `none` no body value, `unsupported` any other value.
 */
export type SeoBodyFormat = "structured" | "plain-text" | "none" | "unsupported";

export interface SeoDocumentImageInput {
	source: string;
	value: unknown;
}

export interface SeoDocumentImage {
	source: string;
	reference: string | null;
	/** `null` means no alt metadata; an empty string does not prove decorative intent. */
	alt: string | null;
}

export interface SeoDocumentSignals {
	text: string;
	/** Body prose without heading text, used for evidence-based keyword checks. */
	proseText: string;
	proseBlocks: readonly string[];
	proseWordCount: number;
	introductionText: string;
	introductionBlocks: readonly string[];
	wordCount: number;
	sentenceCount: number;
	averageSentenceWords: number | null;
	paragraphCount: number;
	longestParagraphWords: number;
	headings: SeoDocumentHeading[];
	h1Count: number;
	links: SeoDocumentLink[];
	internalLinkCount: number;
	externalLinkCount: number;
	genericLinkCount: number;
	images: SeoDocumentImage[];
	imageCount: number;
	imageAltCount: number;
	/** Legacy field name. Counts empty alt values, not verified decorative intent. */
	imageDecorativeCount: number;
	imageMissingAltCount: number;
	structured: boolean;
	bodyFormat: SeoBodyFormat;
	/** Top-level blocks whose text is not read, such as custom or embed blocks. They can only add words. */
	unsupportedBlockCount: number;
}

const GENERIC_LINK_TEXT = new Set([
	"click",
	"click here",
	"here",
	"learn more",
	"link",
	"more",
	"read more",
	"this",
	"visit",
	"view",
	"website",
]);

const SENTENCE_PATTERN = /[^.!?\u3002\uff01\uff1f]+[.!?\u3002\uff01\uff1f]+|[^.!?\u3002\uff01\uff1f]+$/gu;

// A fixed locale keeps browser and server counts equal; dictionary segmentation of unspaced scripts does not depend on it.
const WORD_SEGMENTER = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("en", { granularity: "word" }) : null;

const PORTABLE_TEXT_BLOCK_TYPES = new Set(["block", "image", "break"]);
const TIPTAP_BLOCK_TYPES = new Set([
	"paragraph", "heading", "image", "bulletList", "orderedList", "listItem", "taskList", "taskItem",
	"blockquote", "codeBlock", "horizontalRule", "hardBreak", "table", "tableRow", "tableCell", "tableHeader",
]);

/** Node names understood by saved-body extraction; attributes are not nodes. */
export function supportedSeoDocumentNode(value: Record<string, unknown>): boolean {
 return typeof value._type === "string"
  ? PORTABLE_TEXT_BLOCK_TYPES.has(value._type) || value._type === "span" || value._type === "link"
  : typeof value.type === "string" && (TIPTAP_BLOCK_TYPES.has(value.type) || value.type === "doc" || value.type === "text" || value.type === "link");
}

export function extractSeoDocumentSignals(
	document: unknown,
	fallbackText = "",
	publicUrl = "",
	contentImages: readonly SeoDocumentImageInput[] = [],
): SeoDocumentSignals {
	const paragraphs: string[] = [];
	const headings: SeoDocumentHeading[] = [];
	const rawLinks: Array<{ href: string; text: string }> = [];
	const images: SeoDocumentImage[] = [];
	let structured = false;

	visitDocument(document, {
		paragraphs,
		headings,
		rawLinks,
		images,
		markStructured: () => {
			structured = true;
		},
	}, "document");
	for (const image of contentImages) collectImageValue(image.value, image.source, images);

	const extractedText = documentText(document);
	const text = normalizeText(extractedText || fallbackText);
	if (!structured && paragraphs.length === 0 && text) {
		paragraphs.push(
			...String(extractedText || fallbackText)
				.split(/\n\s*\n/u)
				.map(normalizeText)
				.filter(Boolean),
		);
	}

	const proseText = normalizeText(paragraphs.join(" "));
	const introductionBlocks = firstProseWords(paragraphs, 120);
	const shape = bodyShape(document, text);
	const links = dedupeLinks(rawLinks)
		.map((link): SeoDocumentLink | null => {
			const kind = classifyLink(link.href, publicUrl);
			if (!kind) return null;
			const text = normalizeText(link.text);
			return {
				href: link.href.trim(),
				text,
				kind,
				generic: isGenericLinkText(text),
				sameEntry: kind === "internal" && linksToSameEntry(link.href, publicUrl),
			};
		})
		.filter((link): link is SeoDocumentLink => link !== null);
	const sentenceWordCounts = paragraphs.flatMap(sentenceSegments).map(countSeoWords).filter((count) => count > 0);
	const paragraphWordCounts = paragraphs.map(countSeoWords).filter((count) => count > 0);

	return {
		text,
		proseText,
		proseBlocks: paragraphs,
		proseWordCount: paragraphWordCounts.reduce((total, words) => total + words, 0),
		introductionText: introductionBlocks.join(" "),
		introductionBlocks,
		wordCount: countSeoWords(text),
		sentenceCount: sentenceWordCounts.length,
		averageSentenceWords:
			sentenceWordCounts.length > 0
				? roundToOne(sentenceWordCounts.reduce((sum, count) => sum + count, 0) / sentenceWordCounts.length)
				: null,
		paragraphCount: paragraphWordCounts.length,
		longestParagraphWords: paragraphWordCounts.length > 0 ? Math.max(...paragraphWordCounts) : 0,
		headings,
		h1Count: headings.filter((heading) => heading.level === 1).length,
		links,
		internalLinkCount: links.filter((link) => link.kind === "internal" && !link.sameEntry).length,
		externalLinkCount: links.filter((link) => link.kind === "external").length,
		genericLinkCount: links.filter((link) => link.generic).length,
		images,
		imageCount: images.length,
		imageAltCount: images.filter((image) => typeof image.alt === "string" && image.alt.length > 0).length,
		imageDecorativeCount: images.filter((image) => image.alt === "").length,
		imageMissingAltCount: images.filter((image) => image.alt === null).length,
		structured,
		bodyFormat: shape.format,
		unsupportedBlockCount: shape.unsupportedBlocks,
	};
}

function supportedBlock(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return typeof value._type === "string"
		? PORTABLE_TEXT_BLOCK_TYPES.has(value._type)
		: TIPTAP_BLOCK_TYPES.has(cleanString(value.type));
}

function bodyShape(document: unknown, text: string): { format: SeoBodyFormat; unsupportedBlocks: number } {
	if (typeof document === "string") return { format: "plain-text", unsupportedBlocks: 0 };
	if (document === undefined || document === null) return { format: text ? "plain-text" : "none", unsupportedBlocks: 0 };
	const blocks = Array.isArray(document)
		? document
		: isRecord(document) && document.type === "doc" && Array.isArray(document.content)
			? document.content
			: supportedBlock(document) ? [document] : null;
	if (!blocks) return { format: "unsupported", unsupportedBlocks: 1 };
	return { format: "structured", unsupportedBlocks: blocks.filter((block) => !supportedBlock(block)).length };
}

interface DocumentCollector {
	paragraphs: string[];
	headings: SeoDocumentHeading[];
	rawLinks: Array<{ href: string; text: string }>;
	images: SeoDocumentImage[];
	markStructured: () => void;
}

function visitDocument(value: unknown, collector: DocumentCollector, path: string): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) visitDocument(item, collector, `${path}[${index}]`);
		return;
	}
	if (!isRecord(value)) return;
	collectImageNode(value, path, collector);

	const portableBlock = value._type === "block" && Array.isArray(value.children);
	const nodeType = cleanString(value.type);
	const tiptapBlock = nodeType === "paragraph" || nodeType === "heading";
	if (portableBlock || tiptapBlock) {
		collector.markStructured();
		const blockText = normalizeText(documentText(value.children ?? value.content, true));
		const headingLevel = portableBlock ? portableHeadingLevel(value.style) : tiptapHeadingLevel(value);
		if (headingLevel && blockText) collector.headings.push({ level: headingLevel, text: blockText });
		else if (blockText) collector.paragraphs.push(blockText);
	}

	collectPortableTextLinks(value, collector);
	collectNodeLinks(value, collector);

	if (Array.isArray(value.children)) visitDocument(value.children, collector, `${path}.children`);
	if (Array.isArray(value.content)) visitDocument(value.content, collector, `${path}.content`);
}

function collectImageNode(value: Record<string, unknown>, source: string, collector: DocumentCollector): void {
	const type = (cleanString(value._type) || cleanString(value.type)).toLocaleLowerCase("en");
	if (type !== "image") return;
	collectImageValue(value, source, collector.images);
	collector.markStructured();
}

function collectImageValue(value: unknown, source: string, images: SeoDocumentImage[]): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) collectImageValue(item, `${source}[${index}]`, images);
		return;
	}
	if (typeof value === "string") {
		const reference = value.trim();
		if (reference) images.push({ source, reference, alt: null });
		return;
	}
	if (!isRecord(value)) return;

	const attrs = isRecord(value.attrs) ? value.attrs : {};
	const asset = isRecord(value.asset) ? value.asset : {};
	const reference = firstString(
		value.src,
		value.url,
		value.previewUrl,
		attrs.src,
		attrs.url,
		asset.url,
		asset.src,
		asset._ref,
		asset.id,
		value.id,
	);
	const alt = imageAlt(value, attrs);
	if (!reference && alt === null) return;
	images.push({ source, reference: reference || null, alt });
}

function imageAlt(value: Record<string, unknown>, attrs: Record<string, unknown>): string | null {
	for (const [record, key] of [
		[value, "alt"],
		[value, "altText"],
		[value, "alternativeText"],
		[attrs, "alt"],
		[attrs, "altText"],
		[attrs, "alternativeText"],
	] as const) {
		if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
		return typeof record[key] === "string" ? normalizeText(record[key]) : null;
	}
	return null;
}

function firstString(...values: unknown[]): string {
	for (const value of values) {
		const cleaned = cleanString(value);
		if (cleaned) return cleaned;
	}
	return "";
}

function collectPortableTextLinks(value: Record<string, unknown>, collector: DocumentCollector): void {
	if (value._type !== "block" || !Array.isArray(value.markDefs) || !Array.isArray(value.children)) return;
	for (const definition of value.markDefs) {
		if (!isRecord(definition)) continue;
		const key = cleanString(definition._key);
		const href = linkHref(definition);
		if (!key || !href) continue;
		const text = value.children
			.filter(
				(child) =>
					isRecord(child) &&
					Array.isArray(child.marks) &&
					child.marks.some((mark) => cleanString(mark) === key),
			)
			.map((child) => documentText(child))
			.join(" ");
		collector.rawLinks.push({ href, text });
		collector.markStructured();
	}
}

function collectNodeLinks(value: Record<string, unknown>, collector: DocumentCollector): void {
	const directHref = linkHref(value);
	if ((value.type === "link" || value._type === "link") && directHref) {
		collector.rawLinks.push({ href: directHref, text: documentText(value.content ?? value.children ?? value.text, true) });
		collector.markStructured();
	}

	if (typeof value.text !== "string" || !Array.isArray(value.marks)) return;
	for (const mark of value.marks) {
		if (!isRecord(mark) || (mark.type !== "link" && mark._type !== "link")) continue;
		const href = linkHref(mark);
		if (!href) continue;
		collector.rawLinks.push({ href, text: value.text });
		collector.markStructured();
	}
}

/** Text content only; node attributes and other metadata are not traversed. */
export function extractSeoDocumentText(document: unknown): string {
	return documentText(document);
}

function documentText(value: unknown, inline = false): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map((item) => documentText(item, inline)).filter(Boolean).join(inline ? "" : " ");
	if (!isRecord(value)) return "";
	if (typeof value.text === "string") return value.text;
	if (value.type === "hardBreak") return "\n";
	const inlineChildren = inline || value._type === "block" || value.type === "paragraph" || value.type === "heading" || value.type === "link" || value._type === "link";
	if (Array.isArray(value.children)) return documentText(value.children, inlineChildren);
	if (Array.isArray(value.content)) return documentText(value.content, inlineChildren);
	return "";
}

function firstProseWords(paragraphs: readonly string[], limit: number): string[] {
	const segments: string[] = [];
	let remaining = limit;
	for (const paragraph of paragraphs) {
		if (remaining <= 0) break;
		const words = leadingWords(paragraph, remaining);
		segments.push(words.text);
		remaining -= words.count;
	}
	return segments;
}

function leadingWords(value: string, limit: number): { text: string; count: number } {
	if (!WORD_SEGMENTER) {
		const words = value.split(/\s+/u).filter(Boolean).slice(0, limit);
		return { text: words.join(" "), count: words.length };
	}
	let count = 0;
	let end = 0;
	for (const segment of WORD_SEGMENTER.segment(value)) {
		if (!segment.isWordLike) continue;
		if (count === limit) break;
		count += 1;
		end = segment.index + segment.segment.length;
	}
	return { text: value.slice(0, end), count };
}

function portableHeadingLevel(style: unknown): number | null {
	const match = /^h([1-6])$/u.exec(cleanString(style));
	return match ? Number(match[1]) : null;
}

function tiptapHeadingLevel(value: Record<string, unknown>): number | null {
	if (value.type !== "heading") return null;
	const attrs = isRecord(value.attrs) ? value.attrs : {};
	const level = Number(attrs.level);
	return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2;
}

function linkHref(value: Record<string, unknown>): string {
	const attrs = isRecord(value.attrs) ? value.attrs : {};
	return cleanString(value.href) || cleanString(attrs.href);
}

function linksToSameEntry(href: string, publicUrl: string): boolean {
	const value = href.trim();
	if (value.startsWith("#")) return true;
	try {
		const site = new URL(publicUrl);
		const target = new URL(value.startsWith("//") ? `https:${value}` : value, site);
		const path = (url: URL) => url.pathname.replace(/\/+$/u, "") || "/";
		return target.origin === site.origin && path(target) === path(site);
	} catch {
		return false;
	}
}

function classifyLink(href: string, publicUrl: string): SeoDocumentLinkKind | null {
	const value = href.trim();
	if (!value || /^(?:mailto|tel|sms|javascript|data):/iu.test(value)) return null;
	if (value.startsWith("#") || (/^(?:\/?\.\.?\/|\/)/u.test(value) && !value.startsWith("//"))) {
		return "internal";
	}
	try {
		const target = new URL(value.startsWith("//") ? `https:${value}` : value);
		if (target.protocol !== "http:" && target.protocol !== "https:") return null;
		let site: URL | null = null;
		try {
			site = publicUrl ? new URL(publicUrl) : null;
		} catch {
			site = null;
		}
		return site && target.origin === site.origin ? "internal" : "external";
	} catch {
		return "internal";
	}
}

function dedupeLinks(links: Array<{ href: string; text: string }>): Array<{ href: string; text: string }> {
	const seen = new Set<string>();
	return links.filter((link) => {
		const key = `${link.href.trim()}\u0000${normalizeText(link.text).toLocaleLowerCase("en")}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function isGenericLinkText(value: string): boolean {
	const normalized = value.toLocaleLowerCase("en").replace(/[\s.:;!?]+$/u, "").trim();
	return !normalized || GENERIC_LINK_TEXT.has(normalized);
}

function sentenceSegments(value: string): string[] {
	return value.match(SENTENCE_PATTERN)?.map(normalizeText).filter(Boolean) ?? [];
}

/**
 * Words in text: word-like segments when Intl.Segmenter exists, otherwise
 * whitespace-separated tokens. Every body word metric uses this count.
 */
export function countSeoWords(value: string): number {
	const cleaned = normalizeText(value);
	if (!cleaned) return 0;
	if (!WORD_SEGMENTER) return cleaned.split(/\s+/u).length;
	let count = 0;
	for (const segment of WORD_SEGMENTER.segment(cleaned)) if (segment.isWordLike) count += 1;
	return count;
}

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function cleanString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function roundToOne(value: number): number {
	return Math.round(value * 10) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
