// Contextual internal-link suggestions over one saved Portable Text body and
// one bounded page of projected candidates. Anchors are verbatim occurrences
// inside one original unlinked span, located by block/span keys and UTF-16
// offsets into the original text; tokens are normalized only for comparison.
// The engine reads no candidate body, writes nothing, calls no editor, host or
// network, and produces no score: ordering is an editorial heuristic.

import { isSeoContentCollectionKey } from "./admin-contract.ts";
import { jsonUtf8LengthWithin } from "./lib.ts";

export const LINK_SUGGESTION_LIMITS = Object.freeze({
	sourceBodyBytes: 65_536,
	candidateRows: 200,
	scopeMatches: 25,
	displayed: 5,
	titleChars: 512,
	excerptChars: 2_048,
	responseBytes: 49_152,
	/** UTF-16 length of an anchorable paragraph, which every suggestion carries whole. */
	paragraphChars: 2_048,
	taxonomyTerms: 8,
	identityChars: 128,
	versionChars: 512,
	urlChars: 2_048,
	headingChars: 512,
	phraseTokens: 8,
	localeChars: 35,
});

export const LINK_SUGGESTION_SAVED_SOURCE_NOTICE =
	"Suggestions use saved content. Unsaved edits are not checked; confirm this paragraph and anchor in the editor.";

export const LINK_SUGGESTION_STATUS = "editorial-heuristic";

// ---------------------------------------------------------------------------
// Identities and ownership

export interface LinkSourceIdentity {
	collection: string;
	entryId: string;
	locale: string;
	/** Saved version identity from the exact source read. */
	sourceVersion: string;
	/** The draft revision whose body was read, or null for the live row. */
	revisionId: string | null;
	/** The Portable Text field the adapter selected. */
	field: string;
}

export interface LinkScopeIdentity {
	collection: string;
	/** Always the source locale. */
	locale: string;
	taxonomy: string | null;
	/** Exact same-locale term IDs, sorted and unique, without descendants; empty without a taxonomy. */
	termIds: readonly string[];
	/** Start of this bounded page; null for the first page. */
	afterId: string | null;
	/** The adapter's identity for the fresh collection and taxonomy definitions it checked. */
	scopeVersion: string;
}

export interface LinkSuggestionOwner {
	source: LinkSourceIdentity;
	scope: LinkScopeIdentity;
	/** The client's local selection generation; any selection change advances it. */
	generation: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentity(value: unknown, max: number = LINK_SUGGESTION_LIMITS.identityChars): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value &&
		!/[\u0000-\u001f\u007f]/u.test(value);
}

function isCount(value: unknown, max: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}

/** The canonical BCP 47 form, or null for a value Intl does not accept. */
export function canonicalLinkLocale(value: unknown): string | null {
	if (typeof value !== "string" || !value || value.length > LINK_SUGGESTION_LIMITS.localeChars) return null;
	try {
		return Intl.getCanonicalLocales(value)[0] ?? null;
	} catch {
		return null;
	}
}

export function validateLinkSuggestionOwner(value: unknown): LinkSuggestionOwner | null {
	if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.scope)) return null;
	const source = value.source;
	const scope = value.scope;
	const collection = source.collection;
	const entryId = source.entryId;
	const locale = source.locale;
	const sourceVersion = source.sourceVersion;
	const revisionId = source.revisionId;
	const field = source.field;
	if (
		!isSeoContentCollectionKey(collection) || !isIdentity(entryId) || typeof locale !== "string" ||
		canonicalLinkLocale(locale) !== locale || !isIdentity(sourceVersion, LINK_SUGGESTION_LIMITS.versionChars) ||
		(revisionId !== null && !isIdentity(revisionId)) || !isIdentity(field)
	) return null;
	const scopeCollection = scope.collection;
	const taxonomy = scope.taxonomy;
	const termIds = scope.termIds;
	const afterId = scope.afterId;
	const scopeVersion = scope.scopeVersion;
	if (
		!isSeoContentCollectionKey(scopeCollection) || scope.locale !== locale ||
		(taxonomy !== null && !isIdentity(taxonomy)) || (afterId !== null && !isIdentity(afterId)) ||
		!isIdentity(scopeVersion, LINK_SUGGESTION_LIMITS.versionChars) || !Array.isArray(termIds) ||
		termIds.length > LINK_SUGGESTION_LIMITS.taxonomyTerms || (taxonomy === null) !== (termIds.length === 0) ||
		!termIds.every((term, index) => isIdentity(term) && (index === 0 || String(termIds[index - 1]) < term))
	) return null;
	if (!isCount(value.generation, Number.MAX_SAFE_INTEGER)) return null;
	return {
		source: { collection, entryId, locale, sourceVersion, revisionId, field },
		scope: { collection: scopeCollection, locale, taxonomy, termIds: [...(termIds as string[])], afterId, scopeVersion },
		generation: value.generation,
	};
}

/** Equal keys mean the same source version, field, scope, page and selection generation. */
export function linkSuggestionOwnerKey(owner: LinkSuggestionOwner): string {
	const { source, scope } = owner;
	return JSON.stringify([
		source.collection, source.entryId, source.locale, source.sourceVersion, source.revisionId, source.field,
		scope.collection, scope.locale, scope.taxonomy, scope.termIds, scope.afterId, scope.scopeVersion,
		owner.generation,
	]);
}

// ---------------------------------------------------------------------------
// Shared href normalizer: exclusions, copied URLs and saved-link rechecks

export interface LinkSiteBase {
	/** `protocol//host` of the site; host comparison ignores http versus https. */
	origin: string;
	/**
	 * The saved source's own route, only when an explicit adapter resolved it
	 * for that saved version. Path-relative hrefs need it; nothing else does.
	 */
	routeUrl: string | null;
}

export type LinkHrefClass =
	| { kind: "internal"; route: string }
	| { kind: "same-page" }
	| { kind: "foreign" }
	/** A path-relative href while the source route is unavailable: never guessed. */
	| { kind: "relative-unresolved" }
	| { kind: "unreadable" };

function hasControl(value: string): boolean {
	return /[\u0000-\u001f\u007f]/u.test(value);
}

function parseHttpUrl(value: unknown): URL | null {
	if (typeof value !== "string" || !value || value.length > LINK_SUGGESTION_LIMITS.urlChars || value.trim() !== value || hasControl(value)) {
		return null;
	}
	try {
		const url = new URL(value);
		return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url : null;
	} catch {
		return null;
	}
}

/** The site origin and optional source route base; null without a usable site URL. */
export function linkSiteBase(siteUrl: unknown, routeUrl: unknown): LinkSiteBase | null {
	const site = parseHttpUrl(siteUrl);
	if (!site) return null;
	if (routeUrl === null || routeUrl === undefined) return { origin: `${site.protocol}//${site.host}`, routeUrl: null };
	const route = parseHttpUrl(routeUrl);
	if (!route || route.hostname !== site.hostname || route.port !== site.port) return null;
	return { origin: `${site.protocol}//${site.host}`, routeUrl: route.href };
}

function routeOf(url: URL): string {
	const path = url.pathname.replace(/%[0-9a-f]{2}/giu, (escape) => escape.toUpperCase());
	return path.length > 1 ? path.replace(/\/+$/u, "") || "/" : path;
}

/**
 * Classifies one href against the site. Internal routes compare by path only:
 * query, fragment, a trailing slash, percent-escape case and http versus https
 * on the same host do not make a different destination. Absolute and
 * root-relative hrefs need only the site origin.
 */
export function normalizeLinkHref(href: unknown, base: LinkSiteBase): LinkHrefClass {
	if (typeof href !== "string") return { kind: "unreadable" };
	const value = href.trim();
	if (!value || value.length > LINK_SUGGESTION_LIMITS.urlChars || hasControl(value)) return { kind: "unreadable" };
	if (value.startsWith("#")) return { kind: "same-page" };
	const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(value)?.[1]?.toLowerCase();
	if (scheme && scheme !== "http" && scheme !== "https") return { kind: "foreign" };
	const site = new URL(base.origin);
	let resolved: URL;
	try {
		if (scheme) resolved = new URL(value);
		else if (value.startsWith("//")) resolved = new URL(`${site.protocol}${value}`);
		else if (value.startsWith("/")) resolved = new URL(value, base.origin);
		else if (base.routeUrl) resolved = new URL(value, base.routeUrl);
		else return { kind: "relative-unresolved" };
	} catch {
		return { kind: "unreadable" };
	}
	if (resolved.username || resolved.password) return { kind: "unreadable" };
	if (resolved.hostname !== site.hostname || resolved.port !== site.port) return { kind: "foreign" };
	return { kind: "internal", route: routeOf(resolved) };
}

/** The exact public URL to display and copy, with its route; null unless it is an absolute same-site URL. */
export function linkCopyValue(publicUrl: unknown, base: LinkSiteBase): { url: string; route: string } | null {
	if (!parseHttpUrl(publicUrl)) return null;
	const normalized = normalizeLinkHref(publicUrl, base);
	return normalized.kind === "internal" ? { url: publicUrl as string, route: normalized.route } : null;
}

// ---------------------------------------------------------------------------
// Tokens: original offsets first, normalization only for comparison

interface LinkToken {
	start: number;
	end: number;
	norm: string;
}

const TOKEN_PATTERN = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;
/** Tokens of one phrase may be separated only by spaces or hyphens, never by punctuation. */
const PHRASE_GAP = /^[\p{Zs}\t\n\r\-‐‑]+$/u;

function tokenize(text: string, locale: string): LinkToken[] {
	const tokens: LinkToken[] = [];
	for (const match of text.matchAll(TOKEN_PATTERN)) {
		const start = match.index ?? 0;
		const norm = match[0].normalize("NFKC").replace(/’/gu, "'").toLocaleLowerCase(locale);
		tokens.push({ start, end: start + match[0].length, norm });
	}
	return tokens;
}

function joinable(text: string, left: LinkToken, right: LinkToken): boolean {
	return PHRASE_GAP.test(text.slice(left.end, right.start));
}

/** Boundary words only; a phrase may contain them inside. */
const BOUNDARY_STOPWORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "the", "to", "with",
	"aan", "bij", "de", "een", "en", "het", "met", "om", "op", "te", "van", "voor",
	"bir", "bu", "da", "gibi", "ile", "için", "ki", "mi", "o", "ve",
]);

function codePointLength(text: string, stopAfter: number = Number.POSITIVE_INFINITY): number {
	let count = 0;
	for (let index = 0; index < text.length && count <= stopAfter; index += 1) {
		const code = text.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
			const next = text.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) index += 1;
		}
		count += 1;
	}
	return count;
}

function withinCodePoints(text: string, limit: number): boolean {
	return text.length <= limit || (text.length <= limit * 2 && codePointLength(text, limit) <= limit);
}

function meaningfulBoundary(token: LinkToken): boolean {
	return !BOUNDARY_STOPWORDS.has(token.norm) && codePointLength(token.norm) >= 2;
}

// ---------------------------------------------------------------------------
// Portable Text extraction: anchor eligibility and destination coverage
//
// The two are separate. Anchors come only from plain spans of paragraphs and
// list items. Existing destinations come from link annotations that spans
// actually reference in any text block, from linked images and from table
// cells; content the bounded extractor cannot read makes coverage partial.

export type LinkAnchorBlockKind = "paragraph" | "list-item";
type LinkBlockKind = LinkAnchorBlockKind | "heading" | "other";

/** Host decorators an anchor may carry and the saved-link recheck preserves. `code` never anchors. */
export const LINK_ANCHOR_DECORATORS: readonly string[] = Object.freeze(["em", "strike-through", "strong", "subscript", "superscript", "underline"]);
const ANCHOR_DECORATORS = new Set(LINK_ANCHOR_DECORATORS);
const CODE_DECORATOR = "code";
/** Every decorator the host writes; any other used mark must resolve to an annotation definition. */
const HOST_DECORATORS = new Set([...LINK_ANCHOR_DECORATORS, CODE_DECORATOR]);
/** Block types known to carry no hyperlink. */
const LINK_FREE_BLOCK_TYPES = new Set(["break", "code"]);

export type LinkCoverageGap =
	/** A table, HTML or custom block the bounded extractor does not read. */
	| "unsupported-content"
	/** Href-shaped data outside a link annotation or image link: at most a possible destination. */
	| "possible-destination"
	/** A referenced link, or a supplied image link, whose href or definition cannot be read. */
	| "unreadable-link";

export const LINK_COVERAGE_GAPS: readonly LinkCoverageGap[] = Object.freeze([
	"unsupported-content", "possible-destination", "unreadable-link",
]);

export const LINK_PARTIAL_COVERAGE_LIMITATION = "Known existing links were excluded; embedded/custom content was not fully checked.";

export type LinkCoverage =
	| { kind: "complete" }
	| { kind: "partial"; gaps: LinkCoverageGap[]; limitation: typeof LINK_PARTIAL_COVERAGE_LIMITATION };

interface LinkSourceSpan {
	key: string | null;
	text: string;
	/** Offset of this span's text in the joined paragraph text. */
	blockOffset: number;
	/** Sorted anchor decorators; meaningful only when the span is anchorable. */
	decorators: string[];
	anchorable: boolean;
}

interface LinkSourceBlock {
	key: string | null;
	kind: LinkBlockKind;
	/** Span texts joined without separators. An inline object makes the block ineligible instead. */
	text: string;
	spans: LinkSourceSpan[];
	heading: string | null;
	anchorable: boolean;
}

export type LinkSourceRefusal =
	| "source_body_unsupported"
	| "source_body_malformed"
	| "source_too_large";

type LinkExtraction =
	| { ok: true; blocks: LinkSourceBlock[]; hrefs: unknown[]; gaps: Set<LinkCoverageGap> }
	| { ok: false; reason: LinkSourceRefusal };

function portableBlockKind(block: Record<string, unknown>): LinkBlockKind | null {
	const style = block.style === undefined ? "normal" : block.style;
	if (typeof style !== "string") return null;
	if (/^h[1-6]$/u.test(style)) return "heading";
	if (block.listItem !== undefined) {
		if (typeof block.listItem !== "string") return null;
		return style === "normal" ? "list-item" : "other";
	}
	return style === "normal" ? "paragraph" : "other";
}

function bodyWithinLimit(body: unknown[]): boolean | null {
	try {
		return jsonUtf8LengthWithin(body, LINK_SUGGESTION_LIMITS.sourceBodyBytes) !== null;
	} catch {
		return null;
	}
}

type MarkDefinitions = { definitions: Map<string, Record<string, unknown>>; ambiguous: Set<string>; valid: boolean };

function markDefinitions(value: unknown): MarkDefinitions {
	const definitions = new Map<string, Record<string, unknown>>();
	const ambiguous = new Set<string>();
	let valid = value === undefined || Array.isArray(value);
	for (const definition of Array.isArray(value) ? value : []) {
		if (!isRecord(definition) || !isIdentity(definition._key) || typeof definition._type !== "string") {
			valid = false;
			continue;
		}
		if (definitions.has(definition._key)) {
			ambiguous.add(definition._key);
			valid = false;
		}
		definitions.set(definition._key, definition);
	}
	return { definitions, ambiguous, valid };
}

/** Records the destination of one referenced annotation, the way the host renders it. */
function collectAnnotation(definition: Record<string, unknown>, ambiguous: boolean, hrefs: unknown[], gaps: Set<LinkCoverageGap>): void {
	if (ambiguous) gaps.add("unreadable-link");
	else if (definition._type === "link") hrefs.push(definition.href);
	else if (Object.prototype.hasOwnProperty.call(definition, "href")) gaps.add("possible-destination");
}

/**
 * A supplied image link in its canonical `{href}` or legacy string shape. An
 * absent link and `asset.url` are not hyperlinks; any other supplied shape is
 * unreadable rather than absent.
 */
function imageLink(link: unknown): { kind: "none" } | { kind: "href"; href: string } | { kind: "unreadable" } {
	if (link === undefined || link === null) return { kind: "none" };
	const href = typeof link === "string" ? link : isRecord(link) && typeof link.href === "string" ? link.href : null;
	if (href === null) return { kind: "unreadable" };
	return href.trim() ? { kind: "href", href: href.trim() } : { kind: "none" };
}

/** Link annotations referenced by table cells; cell definitions take precedence over the table's. */
function collectTableLinks(table: Record<string, unknown>, hrefs: unknown[], gaps: Set<LinkCoverageGap>): void {
	const shared = markDefinitions(table.markDefs);
	if (!shared.valid || !Array.isArray(table.rows)) {
		gaps.add("unsupported-content");
		if (!Array.isArray(table.rows)) return;
	}
	for (const row of table.rows as unknown[]) {
		if (!isRecord(row) || !Array.isArray(row.cells)) {
			gaps.add("unsupported-content");
			continue;
		}
		for (const cell of row.cells) {
			if (!isRecord(cell) || !Array.isArray(cell.content)) {
				gaps.add("unsupported-content");
				continue;
			}
			const local = markDefinitions(cell.markDefs);
			if (!local.valid) gaps.add("unsupported-content");
			for (const child of cell.content) {
				if (!isRecord(child) || child._type !== "span") {
					gaps.add("unsupported-content");
					continue;
				}
				if (!Array.isArray(child.marks)) continue;
				for (const mark of child.marks) {
					if (typeof mark !== "string") continue;
					const definition = local.definitions.get(mark) ?? shared.definitions.get(mark);
					if (!definition) continue;
					const ambiguous = local.definitions.has(mark) ? local.ambiguous.has(mark) : shared.ambiguous.has(mark);
					collectAnnotation(definition, ambiguous, hrefs, gaps);
				}
			}
		}
	}
}

function extractPortableText(body: unknown): LinkExtraction {
	if (!Array.isArray(body)) return { ok: false, reason: "source_body_unsupported" };
	const within = bodyWithinLimit(body);
	if (within === null) return { ok: false, reason: "source_body_malformed" };
	if (!within) return { ok: false, reason: "source_too_large" };

	const blocks: LinkSourceBlock[] = [];
	const hrefs: unknown[] = [];
	const gaps = new Set<LinkCoverageGap>();
	const keyCounts = new Map<string, number>();
	let heading: string | null = null;
	for (const item of body) {
		if (!isRecord(item) || typeof item._type !== "string") return { ok: false, reason: "source_body_malformed" };
		const key = isIdentity(item._key) ? item._key : null;
		if (key !== null) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
		if (item._type !== "block") {
			if (item._type === "image") {
				const link = imageLink(item.link);
				if (link.kind === "href") hrefs.push(link.href);
				else if (link.kind === "unreadable") gaps.add("unreadable-link");
			} else if (item._type === "table") collectTableLinks(item, hrefs, gaps);
			else if (!LINK_FREE_BLOCK_TYPES.has(item._type)) gaps.add("unsupported-content");
			blocks.push({ key, kind: "other", text: "", spans: [], heading: null, anchorable: false });
			continue;
		}
		const kind = portableBlockKind(item);
		if (kind === null || !Array.isArray(item.children)) return { ok: false, reason: "source_body_malformed" };

		const marks = markDefinitions(item.markDefs);
		const spans: LinkSourceSpan[] = [];
		const spanKeys = new Set<string>();
		let duplicateSpanKey = false;
		let inlineObject = false;
		let text = "";
		for (const child of item.children) {
			if (!isRecord(child)) return { ok: false, reason: "source_body_malformed" };
			if (child._type !== "span") {
				// Its paragraph never anchors, and its content may carry a destination the extractor does not read.
				inlineObject = true;
				gaps.add("unsupported-content");
				continue;
			}
			if (typeof child.text !== "string") return { ok: false, reason: "source_body_malformed" };
			const spanKey = isIdentity(child._key) ? child._key : null;
			if (spanKey !== null) {
				if (spanKeys.has(spanKey)) duplicateSpanKey = true;
				spanKeys.add(spanKey);
			}
			const spanMarks = child.marks === undefined ? [] : child.marks;
			let plain = Array.isArray(spanMarks);
			const decorators = new Set<string>();
			for (const mark of Array.isArray(spanMarks) ? spanMarks : []) {
				if (typeof mark !== "string") {
					plain = false;
					continue;
				}
				const definition = marks.definitions.get(mark);
				if (definition) {
					plain = false;
					collectAnnotation(definition, marks.ambiguous.has(mark), hrefs, gaps);
				} else if (ANCHOR_DECORATORS.has(mark)) decorators.add(mark);
				else plain = false; // code, or a reference without a definition
			}
			spans.push({
				key: spanKey,
				text: child.text,
				blockOffset: text.length,
				decorators: [...decorators].sort(),
				anchorable: spanKey !== null && plain,
			});
			text += child.text;
		}

		const anchorable = (kind === "paragraph" || kind === "list-item") && key !== null && marks.valid && !duplicateSpanKey &&
			!inlineObject && text.length <= LINK_SUGGESTION_LIMITS.paragraphChars;
		blocks.push({ key, kind, text, spans, heading: kind === "heading" ? null : heading, anchorable });
		if (kind === "heading") {
			const title = text.replace(/\s+/gu, " ").trim();
			heading = title && withinCodePoints(title, LINK_SUGGESTION_LIMITS.headingChars) ? title : null;
		}
	}
	// Identity must be unambiguous: a key shared by any two blocks never anchors.
	for (const block of blocks) {
		if (block.key !== null && (keyCounts.get(block.key) ?? 0) > 1) block.anchorable = false;
	}
	return { ok: true, blocks, hrefs, gaps };
}

type LinkDestinations =
	| { ok: true; routes: Set<string>; coverage: LinkCoverage }
	/** A known path-relative link while the saved source route is unavailable: refused, never ignored. */
	| { ok: false };

/** Known destinations as routes. An unreadable link makes coverage partial. */
function destinationsOf(extraction: { hrefs: readonly unknown[]; gaps: ReadonlySet<LinkCoverageGap> }, base: LinkSiteBase): LinkDestinations {
	const routes = new Set<string>();
	const gaps = new Set(extraction.gaps);
	for (const href of extraction.hrefs) {
		const normalized = normalizeLinkHref(href, base);
		if (normalized.kind === "relative-unresolved") return { ok: false };
		if (normalized.kind === "unreadable") gaps.add("unreadable-link");
		else if (normalized.kind === "internal") routes.add(normalized.route);
	}
	const ordered = LINK_COVERAGE_GAPS.filter((gap) => gaps.has(gap));
	return {
		ok: true,
		routes,
		coverage: ordered.length === 0 ? { kind: "complete" } : { kind: "partial", gaps: ordered, limitation: LINK_PARTIAL_COVERAGE_LIMITATION },
	};
}

// ---------------------------------------------------------------------------
// Validated inputs

export interface LinkSourceDocument extends LinkSourceIdentity {
	body: unknown;
	/** The site URL the host resolves public routes against; null when unknown. */
	siteUrl: string | null;
	/**
	 * The saved source's route, only from an explicit adapter for this saved
	 * version; null otherwise. Never an admin URL, canonical, an older live URL
	 * after a staged slug change or a hand-built pattern.
	 */
	routeUrl: string | null;
}

export function validateLinkSourceDocument(value: unknown): LinkSourceDocument | null {
	if (!isRecord(value)) return null;
	const { collection, entryId, locale, sourceVersion, revisionId, field, siteUrl, routeUrl } = value;
	if (
		!isSeoContentCollectionKey(collection) || !isIdentity(entryId) || typeof locale !== "string" || canonicalLinkLocale(locale) !== locale ||
		!isIdentity(sourceVersion, LINK_SUGGESTION_LIMITS.versionChars) || (revisionId !== null && !isIdentity(revisionId)) ||
		!isIdentity(field) || (siteUrl !== null && typeof siteUrl !== "string") || (routeUrl !== null && typeof routeUrl !== "string")
	) return null;
	return { collection, entryId, locale, sourceVersion, revisionId, field, body: value.body, siteUrl, routeUrl };
}

/** Published scalar title and excerpt of one scoped reference; never a body. */
export interface LinkCandidateProjection {
	collection: string;
	entryId: string;
	locale: string;
	/** Published row version identity. */
	version: string;
	title: string;
	excerpt: string | null;
	/** Bounded cursor position consumed with this reference. */
	afterId: string;
}

export interface LinkCandidatePage {
	candidates: readonly LinkCandidateProjection[];
	/** Raw projected rows examined for this page, at most 200. */
	examinedRows: number;
	nextAfterId: string | null;
	exhausted: boolean;
}

const CANDIDATE_FIELDS = ["collection", "entryId", "locale", "version", "title", "excerpt", "afterId"] as const;

type CandidatePageValidation =
	| { ok: true; page: LinkCandidatePage; rows: number; malformed: number }
	| { ok: false };

function validateCandidatePage(value: unknown, scope: LinkScopeIdentity): CandidatePageValidation {
	if (!isRecord(value) || !Array.isArray(value.candidates)) return { ok: false };
	const rows = value.candidates;
	const examinedRows = value.examinedRows;
	const nextAfterId = value.nextAfterId;
	if (
		rows.length > LINK_SUGGESTION_LIMITS.scopeMatches || !isCount(examinedRows, LINK_SUGGESTION_LIMITS.candidateRows) ||
		examinedRows < rows.length || typeof value.exhausted !== "boolean" || (nextAfterId !== null && !isIdentity(nextAfterId)) ||
		(value.exhausted && nextAfterId !== null)
	) return { ok: false };
	const seen = new Set<string>();
	const candidates: LinkCandidateProjection[] = [];
	let malformed = 0;
	for (const row of rows) {
		if (!isRecord(row)) return { ok: false };
		// Only the projected fields are read; no other property is touched.
		const fields = Object.fromEntries(CANDIDATE_FIELDS.map((field) => [field, row[field]])) as Record<(typeof CANDIDATE_FIELDS)[number], unknown>;
		const { collection, entryId, locale, version, title, excerpt, afterId } = fields;
		if (collection !== scope.collection || locale !== scope.locale || !isIdentity(entryId) ||
			!isIdentity(version, LINK_SUGGESTION_LIMITS.versionChars) || !isIdentity(afterId) || seen.has(entryId)) {
			return { ok: false };
		}
		seen.add(entryId);
		const titleValid = typeof title === "string" && title.trim().length > 0 && withinCodePoints(title, LINK_SUGGESTION_LIMITS.titleChars);
		const excerptValid = excerpt === null || (typeof excerpt === "string" && withinCodePoints(excerpt, LINK_SUGGESTION_LIMITS.excerptChars));
		if (!titleValid || !excerptValid) {
			malformed += 1;
			continue;
		}
		candidates.push({ collection: collection as string, entryId, locale: locale as string, version, title: title as string, excerpt: excerpt as string | null, afterId });
	}
	return { ok: true, page: { candidates, examinedRows, nextAfterId, exhausted: value.exhausted }, rows: rows.length, malformed };
}

// ---------------------------------------------------------------------------
// Phrases and ranking

export type LinkReasonKind = "title" | "title-phrase" | "excerpt-phrase";

interface CandidatePhrase {
	key: string;
	tokens: number;
	kind: LinkReasonKind;
	field: "title" | "excerpt";
	quoteStart: number;
	quoteEnd: number;
}

const KIND_ORDER: Record<LinkReasonKind, number> = { title: 0, "title-phrase": 1, "excerpt-phrase": 2 };

function comparePhrases(left: CandidatePhrase, right: CandidatePhrase): number {
	return KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || right.tokens - left.tokens ||
		(right.quoteEnd - right.quoteStart) - (left.quoteEnd - left.quoteStart) || left.quoteStart - right.quoteStart;
}

function fieldPhrases(text: string, locale: string, field: "title" | "excerpt"): CandidatePhrase[] {
	const tokens = tokenize(text, locale);
	const phrases: CandidatePhrase[] = [];
	const push = (start: number, length: number, kind: LinkReasonKind) => {
		for (let index = start + 1; index < start + length; index += 1) {
			if (!joinable(text, tokens[index - 1], tokens[index])) return;
		}
		phrases.push({
			key: tokens.slice(start, start + length).map((token) => token.norm).join(" "),
			tokens: length,
			kind,
			field,
			quoteStart: tokens[start].start,
			quoteEnd: tokens[start + length - 1].end,
		});
	};
	const count = tokens.length;
	if (field === "title") {
		if (count >= 2 && count <= LINK_SUGGESTION_LIMITS.phraseTokens) push(0, count, "title");
		if (count === 1 && meaningfulBoundary(tokens[0]) && codePointLength(tokens[0].norm) >= 3) push(0, 1, "title");
		for (let length = Math.min(count - 1, 6); length >= 2; length -= 1) {
			for (let start = 0; start + length <= count; start += 1) {
				if (meaningfulBoundary(tokens[start]) && meaningfulBoundary(tokens[start + length - 1])) push(start, length, "title-phrase");
			}
		}
	} else {
		for (let length = 5; length >= 3; length -= 1) {
			for (let start = 0; start + length <= count; start += 1) {
				const window = tokens.slice(start, start + length);
				if (meaningfulBoundary(window[0]) && meaningfulBoundary(window[length - 1]) &&
					window.some((token) => codePointLength(token.norm) >= 4)) push(start, length, "excerpt-phrase");
			}
		}
	}
	const best = new Map<string, CandidatePhrase>();
	for (const phrase of phrases) {
		const current = best.get(phrase.key);
		if (!current || comparePhrases(phrase, current) < 0) best.set(phrase.key, phrase);
	}
	return [...best.values()];
}

interface SourceOccurrence {
	block: number;
	span: number;
	start: number;
	end: number;
	anchorable: boolean;
	ordinal: number;
	total: number;
}

function sourceOccurrences(blocks: readonly LinkSourceBlock[], locale: string, wanted: ReadonlySet<string>): Map<string, SourceOccurrence[]> {
	const found = new Map<string, SourceOccurrence[]>();
	blocks.forEach((block, blockIndex) => {
		block.spans.forEach((span, spanIndex) => {
			const tokens = tokenize(span.text, locale);
			for (let start = 0; start < tokens.length; start += 1) {
				let key = "";
				for (let length = 1; length <= LINK_SUGGESTION_LIMITS.phraseTokens && start + length <= tokens.length; length += 1) {
					const token = tokens[start + length - 1];
					if (length > 1 && !joinable(span.text, tokens[start + length - 2], token)) break;
					key = length === 1 ? token.norm : `${key} ${token.norm}`;
					if (!wanted.has(key)) continue;
					const list = found.get(key) ?? [];
					list.push({
						block: blockIndex,
						span: spanIndex,
						start: tokens[start].start,
						end: token.end,
						anchorable: block.anchorable && span.anchorable,
						ordinal: list.length + 1,
						total: 0,
					});
					found.set(key, list);
				}
			}
		});
	});
	for (const list of found.values()) for (const occurrence of list) occurrence.total = list.length;
	return found;
}

function compareOccurrences(left: SourceOccurrence | undefined, right: SourceOccurrence | undefined): number {
	if (!left || !right) return left ? -1 : right ? 1 : 0;
	return left.block - right.block || left.span - right.span || left.start - right.start;
}

function overlaps(left: SourceOccurrence, right: SourceOccurrence): boolean {
	return left.block === right.block && left.span === right.span && left.start < right.end && right.start < left.end;
}

export interface LinkSuggestionAnchor {
	blockKey: string;
	spanKey: string;
	blockKind: LinkAnchorBlockKind;
	/** UTF-16 offsets into the original span text, on token boundaries. */
	start: number;
	end: number;
	/** The original text between those offsets. */
	text: string;
	/** The original paragraph: span texts joined without separators, as saved. */
	paragraph: string;
	/** UTF-16 range of the anchor inside `paragraph`. */
	paragraphStart: number;
	paragraphEnd: number;
	/** Sorted decorators of each UTF-16 code unit of the anchor, as saved. */
	decorators: string[][];
	/** Position among single-span occurrences of the same normalized phrase in the saved body, in document order. */
	occurrence: { ordinal: number; total: number };
	/** Nearest preceding heading, as context only. */
	heading: string | null;
}

export interface LinkSuggestionReason {
	kind: LinkReasonKind;
	field: "title" | "excerpt";
	/** Verbatim text of the destination field that matched. */
	quote: string;
	tokens: number;
}

export interface LinkProvisionalSuggestion {
	candidate: LinkCandidateProjection;
	anchor: LinkSuggestionAnchor;
	reason: LinkSuggestionReason;
}

export const LINK_EXCLUSION_REASONS = [
	"self",
	"already-linked",
	"candidate-malformed",
	"no-anchor",
	"anchor-taken",
	"display-limit",
	"target-missing",
	"target-unavailable",
	"target-changed",
	"not-published",
	"out-of-scope",
	"scope-unverifiable",
	"noindex",
	"policy-unverifiable",
	"route-unavailable",
] as const;

export type LinkExclusionReason = (typeof LINK_EXCLUSION_REASONS)[number];
export type LinkExclusionCounts = Record<LinkExclusionReason, number>;

function emptyExclusions(): LinkExclusionCounts {
	return Object.fromEntries(LINK_EXCLUSION_REASONS.map((reason) => [reason, 0])) as LinkExclusionCounts;
}

export type LinkRankRefusal =
	| LinkSourceRefusal
	| "invalid_input"
	| "owner_mismatch"
	| "site_url_unavailable"
	| "source_route_unavailable"
	| "candidate_page_invalid";

export interface LinkPageSummary {
	examinedRows: number;
	scopeMatches: number;
	nextAfterId: string | null;
	exhausted: boolean;
}

export interface LinkRanked {
	kind: "ranked";
	owner: LinkSuggestionOwner;
	base: LinkSiteBase;
	sourceRoute: string | null;
	linkedRoutes: readonly string[];
	coverage: LinkCoverage;
	provisional: readonly LinkProvisionalSuggestion[];
	excluded: LinkExclusionCounts;
	page: LinkPageSummary;
}

export type LinkRankResult = LinkRanked | { kind: "refused"; reason: LinkRankRefusal };

/**
 * Ranks one validated page against the saved source. At most five
 * provisional suggestions are chosen, one per destination, with
 * non-overlapping anchors; only those targets are read and resolved later.
 */
export function rankLinkSuggestions(input: { owner: unknown; source: unknown; page: unknown }): LinkRankResult {
	const owner = validateLinkSuggestionOwner(input.owner);
	const source = validateLinkSourceDocument(input.source);
	if (!owner || !source) return { kind: "refused", reason: "invalid_input" };
	const identity = owner.source;
	if (
		identity.collection !== source.collection || identity.entryId !== source.entryId || identity.locale !== source.locale ||
		identity.sourceVersion !== source.sourceVersion || identity.revisionId !== source.revisionId || identity.field !== source.field
	) return { kind: "refused", reason: "owner_mismatch" };
	if (!parseHttpUrl(source.siteUrl)) return { kind: "refused", reason: "site_url_unavailable" };
	const base = linkSiteBase(source.siteUrl, source.routeUrl);
	if (!base) return { kind: "refused", reason: "invalid_input" };
	const extraction = extractPortableText(source.body);
	if (!extraction.ok) return { kind: "refused", reason: extraction.reason };
	const linked = destinationsOf(extraction, base);
	if (!linked.ok) return { kind: "refused", reason: "source_route_unavailable" };
	const sourceRoute = base.routeUrl ? linkCopyValue(base.routeUrl, base)?.route ?? null : null;

	const validation = validateCandidatePage(input.page, owner.scope);
	if (!validation.ok) return { kind: "refused", reason: "candidate_page_invalid" };
	const excluded = emptyExclusions();
	excluded["candidate-malformed"] = validation.malformed;

	const candidates = validation.page.candidates.filter((candidate) => {
		if (candidate.collection !== source.collection || candidate.entryId !== source.entryId) return true;
		excluded.self += 1;
		return false;
	});
	const phrasesByCandidate = candidates.map((candidate) => [
		...fieldPhrases(candidate.title, source.locale, "title"),
		...(candidate.excerpt ? fieldPhrases(candidate.excerpt, source.locale, "excerpt") : []),
	].sort(comparePhrases));
	const wanted = new Set(phrasesByCandidate.flat().map((phrase) => phrase.key));
	const occurrences = sourceOccurrences(extraction.blocks, source.locale, wanted);
	const firstAnchorable = (phrase: CandidatePhrase) => (occurrences.get(phrase.key) ?? []).find((item) => item.anchorable);

	const ranked = candidates.map((candidate, index) => ({
		candidate,
		index,
		phrases: phrasesByCandidate[index].filter((phrase) => firstAnchorable(phrase) !== undefined),
	})).filter((entry) => {
		if (entry.phrases.length > 0) return true;
		excluded["no-anchor"] += 1;
		return false;
	});
	ranked.sort((left, right) => comparePhrases(left.phrases[0], right.phrases[0]) ||
		compareOccurrences(firstAnchorable(left.phrases[0]), firstAnchorable(right.phrases[0])) || left.index - right.index);

	const chosen: SourceOccurrence[] = [];
	const provisional: LinkProvisionalSuggestion[] = [];
	for (const entry of ranked) {
		if (provisional.length >= LINK_SUGGESTION_LIMITS.displayed) {
			excluded["display-limit"] += 1;
			continue;
		}
		let picked: { phrase: CandidatePhrase; occurrence: SourceOccurrence } | null = null;
		for (const phrase of entry.phrases) {
			const occurrence = (occurrences.get(phrase.key) ?? []).find((item) => item.anchorable && !chosen.some((other) => overlaps(item, other)));
			if (occurrence) {
				picked = { phrase, occurrence };
				break;
			}
		}
		if (!picked) {
			excluded["anchor-taken"] += 1;
			continue;
		}
		chosen.push(picked.occurrence);
		const block = extraction.blocks[picked.occurrence.block];
		const span = block.spans[picked.occurrence.span];
		const { start, end } = picked.occurrence;
		const fieldText = picked.phrase.field === "title" ? entry.candidate.title : entry.candidate.excerpt ?? "";
		provisional.push({
			candidate: entry.candidate,
			anchor: {
				blockKey: block.key as string,
				spanKey: span.key as string,
				blockKind: block.kind as LinkAnchorBlockKind,
				start,
				end,
				text: span.text.slice(start, end),
				paragraph: block.text,
				paragraphStart: span.blockOffset + start,
				paragraphEnd: span.blockOffset + end,
				decorators: Array.from({ length: end - start }, () => [...span.decorators]),
				occurrence: { ordinal: picked.occurrence.ordinal, total: picked.occurrence.total },
				heading: block.heading,
			},
			reason: {
				kind: picked.phrase.kind,
				field: picked.phrase.field,
				quote: fieldText.slice(picked.phrase.quoteStart, picked.phrase.quoteEnd),
				tokens: picked.phrase.tokens,
			},
		});
	}
	return {
		kind: "ranked",
		owner,
		base,
		sourceRoute,
		linkedRoutes: [...linked.routes].sort(),
		coverage: linked.coverage,
		provisional,
		excluded,
		page: { examinedRows: validation.page.examinedRows, scopeMatches: validation.rows, nextAfterId: validation.page.nextAfterId, exhausted: validation.page.exhausted },
	};
}

// ---------------------------------------------------------------------------
// Displayed targets, policy and the bounded response

/** The published row of one target (never a pending revision), its route and policy state. */
export interface LinkResolvedTarget {
	collection: string;
	entryId: string;
	locale: string;
	status: string;
	version: string;
	title: string;
	/** From `content.getPublicUrl`; a route is not evidence of reachability or indexing. */
	publicUrl: string | null;
	/** Fresh collection and taxonomy membership for the selected scope; null when unverifiable. */
	inScope: boolean | null;
	/** Effective noindex under both policy identities below; null when unverifiable. */
	noindex: boolean | null;
	/** The global site and plugin policy identity the evaluation used. */
	globalPolicyVersion: string | null;
	/**
	 * This target's own policy identity: its reference, locale and slug, core
	 * SEO enablement and noIndex, and the exact override observations (ID
	 * first, slug fallback). A global identity cannot stand in for it.
	 */
	targetPolicyVersion: string | null;
}

export type LinkTargetRead =
	| { kind: "found"; target: LinkResolvedTarget }
	| { kind: "missing" }
	| { kind: "unavailable" };

/** Every global site and plugin setting that decides effective noindex, named by one version. */
export type LinkPolicyRead = { kind: "readable"; version: string } | { kind: "unreadable" };

export interface LinkSuggestion {
	target: {
		collection: string;
		entryId: string;
		locale: string;
		title: string;
		publicUrl: string;
		route: string;
		version: string;
		/** Verify rereads only this target, so its own policy identity travels with it. */
		targetPolicyVersion: string;
	};
	anchor: LinkSuggestionAnchor;
	reason: LinkSuggestionReason;
}

export interface LinkSuggestionResponse {
	status: typeof LINK_SUGGESTION_STATUS;
	notice: typeof LINK_SUGGESTION_SAVED_SOURCE_NOTICE;
	owner: LinkSuggestionOwner;
	/** The global policy identity every displayed target was evaluated under. */
	policyVersion: string;
	/** Partial coverage makes no exhaustive already-linked claim. */
	coverage: LinkCoverage;
	suggestions: LinkSuggestion[];
	excluded: LinkExclusionCounts;
	/** Lowest-ordered suggestions left out to keep the response within its byte limit. */
	omittedForResponseLimit: number;
	page: LinkPageSummary;
}

export type LinkFinalizeRefusal = "policy_unreadable" | "target_reads_invalid" | "response_too_large";

export type LinkSuggestionOutcome =
	| { kind: "result"; response: LinkSuggestionResponse }
	| { kind: "refused"; reason: LinkFinalizeRefusal };

type TargetCheck =
	| { ok: true; title: string; publicUrl: string; route: string; targetPolicyVersion: string }
	| { ok: false; reason: LinkExclusionReason };

interface TargetContext {
	base: LinkSiteBase;
	policyVersion: string;
	sourceRef: string;
	sourceRoute: string | null;
	linkedRoutes: ReadonlySet<string>;
}

function checkTarget(read: LinkTargetRead, expected: { collection: string; entryId: string; locale: string; version: string }, context: TargetContext): TargetCheck {
	if (read.kind === "missing") return { ok: false, reason: "target-missing" };
	if (read.kind !== "found" || !isRecord(read.target)) return { ok: false, reason: "target-unavailable" };
	const target = read.target;
	if (target.collection !== expected.collection || target.entryId !== expected.entryId) return { ok: false, reason: "target-unavailable" };
	if (`${target.collection}:${target.entryId}` === context.sourceRef) return { ok: false, reason: "self" };
	if (target.status !== "published") return { ok: false, reason: "not-published" };
	if (target.locale !== expected.locale) return { ok: false, reason: "out-of-scope" };
	if (target.version !== expected.version) return { ok: false, reason: "target-changed" };
	if (target.inScope === false) return { ok: false, reason: "out-of-scope" };
	if (target.inScope !== true) return { ok: false, reason: "scope-unverifiable" };
	if (target.globalPolicyVersion !== context.policyVersion || !isIdentity(target.targetPolicyVersion, LINK_SUGGESTION_LIMITS.versionChars) ||
		typeof target.noindex !== "boolean") return { ok: false, reason: "policy-unverifiable" };
	if (target.noindex) return { ok: false, reason: "noindex" };
	if (typeof target.title !== "string" || !target.title.trim() || !withinCodePoints(target.title, LINK_SUGGESTION_LIMITS.titleChars)) {
		return { ok: false, reason: "target-changed" };
	}
	const copy = linkCopyValue(target.publicUrl, context.base);
	if (!copy) return { ok: false, reason: "route-unavailable" };
	if (copy.route === context.sourceRoute) return { ok: false, reason: "self" };
	if (context.linkedRoutes.has(copy.route)) return { ok: false, reason: "already-linked" };
	return { ok: true, title: target.title, publicUrl: copy.url, route: copy.route, targetPolicyVersion: target.targetPolicyVersion };
}

/**
 * Applies the displayed targets' exact reads to the provisional suggestions.
 * There is no backfill: an excluded target leaves fewer suggestions rather
 * than reading more entries.
 */
export function finalizeLinkSuggestions(
	ranked: LinkRanked,
	targets: readonly { collection: string; entryId: string; read: LinkTargetRead }[],
	policy: LinkPolicyRead,
): LinkSuggestionOutcome {
	if (policy.kind !== "readable" || !isIdentity(policy.version, LINK_SUGGESTION_LIMITS.versionChars)) {
		return { kind: "refused", reason: "policy_unreadable" };
	}
	const reads = new Map<string, LinkTargetRead>();
	for (const entry of targets) {
		const key = `${entry.collection}:${entry.entryId}`;
		if (reads.has(key)) return { kind: "refused", reason: "target_reads_invalid" };
		reads.set(key, entry.read);
	}
	const expectedKeys = ranked.provisional.map((item) => `${item.candidate.collection}:${item.candidate.entryId}`);
	if (reads.size !== expectedKeys.length || expectedKeys.some((key) => !reads.has(key))) {
		return { kind: "refused", reason: "target_reads_invalid" };
	}
	const excluded = { ...ranked.excluded };
	const context: TargetContext = {
		base: ranked.base,
		policyVersion: policy.version,
		sourceRef: `${ranked.owner.source.collection}:${ranked.owner.source.entryId}`,
		sourceRoute: ranked.sourceRoute,
		linkedRoutes: new Set(ranked.linkedRoutes),
	};
	const suggestions: LinkSuggestion[] = [];
	for (const item of ranked.provisional) {
		const candidate = item.candidate;
		const check = checkTarget(reads.get(`${candidate.collection}:${candidate.entryId}`) as LinkTargetRead, candidate, context);
		if (!check.ok) {
			excluded[check.reason] += 1;
			continue;
		}
		if (check.title !== candidate.title) {
			excluded["target-changed"] += 1;
			continue;
		}
		suggestions.push({
			target: {
				collection: candidate.collection,
				entryId: candidate.entryId,
				locale: candidate.locale,
				title: check.title,
				publicUrl: check.publicUrl,
				route: check.route,
				version: candidate.version,
				targetPolicyVersion: check.targetPolicyVersion,
			},
			anchor: item.anchor,
			reason: item.reason,
		});
	}
	const response: LinkSuggestionResponse = {
		status: LINK_SUGGESTION_STATUS,
		notice: LINK_SUGGESTION_SAVED_SOURCE_NOTICE,
		owner: ranked.owner,
		policyVersion: policy.version,
		coverage: ranked.coverage,
		suggestions,
		excluded,
		omittedForResponseLimit: 0,
		page: ranked.page,
	};
	while (jsonUtf8LengthWithin(response, LINK_SUGGESTION_LIMITS.responseBytes) === null) {
		if (response.suggestions.length === 0) return { kind: "refused", reason: "response_too_large" };
		response.suggestions = response.suggestions.slice(0, -1);
		response.omittedForResponseLimit += 1;
	}
	return { kind: "result", response };
}

// ---------------------------------------------------------------------------
// Client acceptance and request validation

function validDecorators(value: unknown, length: number): value is string[][] {
	return Array.isArray(value) && value.length === length && value.every((set) =>
		Array.isArray(set) && set.length <= ANCHOR_DECORATORS.size &&
		set.every((name, index) => typeof name === "string" && ANCHOR_DECORATORS.has(name) && (index === 0 || String(set[index - 1]) < name)));
}

function validSuggestion(value: unknown, owner: LinkSuggestionOwner): value is LinkSuggestion {
	if (!isRecord(value) || !isRecord(value.target) || !isRecord(value.anchor) || !isRecord(value.reason)) return false;
	const { target, anchor, reason } = value;
	const url = parseHttpUrl(target.publicUrl);
	if (
		target.collection !== owner.scope.collection || target.locale !== owner.scope.locale || !isIdentity(target.entryId) ||
		typeof target.title !== "string" || !target.title.trim() || !withinCodePoints(target.title, LINK_SUGGESTION_LIMITS.titleChars) ||
		!url || target.route !== routeOf(url) || !isIdentity(target.version, LINK_SUGGESTION_LIMITS.versionChars) ||
		!isIdentity(target.targetPolicyVersion, LINK_SUGGESTION_LIMITS.versionChars)
	) return false;
	const { start, end, text, paragraph, paragraphStart, paragraphEnd, occurrence } = anchor;
	if (
		!isIdentity(anchor.blockKey) || !isIdentity(anchor.spanKey) || (anchor.blockKind !== "paragraph" && anchor.blockKind !== "list-item") ||
		typeof paragraph !== "string" || paragraph.length > LINK_SUGGESTION_LIMITS.paragraphChars ||
		!isCount(start, LINK_SUGGESTION_LIMITS.paragraphChars) || !isCount(end, LINK_SUGGESTION_LIMITS.paragraphChars) || end <= start ||
		!isCount(paragraphStart, paragraph.length) || !isCount(paragraphEnd, paragraph.length) || paragraphEnd - paragraphStart !== end - start ||
		typeof text !== "string" || text.length !== end - start || paragraph.slice(paragraphStart, paragraphEnd) !== text ||
		!validDecorators(anchor.decorators, text.length) || !isRecord(occurrence) ||
		!isCount(occurrence.total, Number.MAX_SAFE_INTEGER) || !isCount(occurrence.ordinal, occurrence.total) || occurrence.ordinal < 1 ||
		(anchor.heading !== null && (typeof anchor.heading !== "string" || !withinCodePoints(anchor.heading, LINK_SUGGESTION_LIMITS.headingChars)))
	) return false;
	return (reason.kind === "title" || reason.kind === "title-phrase" || reason.kind === "excerpt-phrase") &&
		(reason.field === "title" || reason.field === "excerpt") && typeof reason.quote === "string" && reason.quote.length > 0 &&
		withinCodePoints(reason.quote, LINK_SUGGESTION_LIMITS.excerptChars) && isCount(reason.tokens, LINK_SUGGESTION_LIMITS.phraseTokens) &&
		reason.tokens >= 1;
}

function validCoverage(value: unknown): value is LinkCoverage {
	if (!isRecord(value)) return false;
	if (value.kind === "complete") return Object.keys(value).length === 1;
	const gaps = value.gaps;
	return value.kind === "partial" && value.limitation === LINK_PARTIAL_COVERAGE_LIMITATION && Array.isArray(gaps) && gaps.length > 0 &&
		gaps.every((gap, index) => LINK_COVERAGE_GAPS.includes(gap as LinkCoverageGap) &&
			(index === 0 || LINK_COVERAGE_GAPS.indexOf(gaps[index - 1] as LinkCoverageGap) < LINK_COVERAGE_GAPS.indexOf(gap as LinkCoverageGap)));
}

function withinResponseLimit(value: unknown): boolean {
	try {
		return jsonUtf8LengthWithin(value, LINK_SUGGESTION_LIMITS.responseBytes) !== null;
	} catch {
		return false;
	}
}

export type LinkSuggestionAcceptance =
	| { kind: "accepted"; response: LinkSuggestionResponse }
	| { kind: "stale" }
	| { kind: "invalid" };

/**
 * Accepts a response only for the current owner. A late answer for another
 * source version, scope, page or generation is stale and never shown.
 */
export function acceptLinkSuggestionResponse(value: unknown, current: LinkSuggestionOwner): LinkSuggestionAcceptance {
	if (!withinResponseLimit(value) || !isRecord(value) || value.status !== LINK_SUGGESTION_STATUS ||
		value.notice !== LINK_SUGGESTION_SAVED_SOURCE_NOTICE) return { kind: "invalid" };
	const owner = validateLinkSuggestionOwner(value.owner);
	if (!owner) return { kind: "invalid" };
	if (linkSuggestionOwnerKey(owner) !== linkSuggestionOwnerKey(current)) return { kind: "stale" };
	const suggestions = value.suggestions;
	if (!isIdentity(value.policyVersion, LINK_SUGGESTION_LIMITS.versionChars) || !Array.isArray(suggestions) ||
		suggestions.length > LINK_SUGGESTION_LIMITS.displayed || !suggestions.every((item) => validSuggestion(item, owner)) ||
		new Set(suggestions.map((item) => (item as LinkSuggestion).target.entryId)).size !== suggestions.length) {
		return { kind: "invalid" };
	}
	if (!validCoverage(value.coverage)) return { kind: "invalid" };
	const excluded = value.excluded;
	if (!isRecord(excluded) || Object.keys(excluded).length !== LINK_EXCLUSION_REASONS.length ||
		!LINK_EXCLUSION_REASONS.every((reason) => isCount(excluded[reason], Number.MAX_SAFE_INTEGER))) {
		return { kind: "invalid" };
	}
	const page = value.page;
	if (!isCount(value.omittedForResponseLimit, LINK_SUGGESTION_LIMITS.displayed) || !isRecord(page) ||
		!isCount(page.examinedRows, LINK_SUGGESTION_LIMITS.candidateRows) || !isCount(page.scopeMatches, LINK_SUGGESTION_LIMITS.scopeMatches) ||
		(page.nextAfterId !== null && !isIdentity(page.nextAfterId)) || typeof page.exhausted !== "boolean") {
		return { kind: "invalid" };
	}
	return { kind: "accepted", response: value as unknown as LinkSuggestionResponse };
}

/** What the client sends to verify the chosen target or check the saved link. */
export interface LinkSuggestionRequest {
	owner: LinkSuggestionOwner;
	policyVersion: string;
	suggestion: LinkSuggestion;
}

export function validateLinkSuggestionRequest(value: unknown): LinkSuggestionRequest | null {
	if (!withinResponseLimit(value) || !isRecord(value)) return null;
	const owner = validateLinkSuggestionOwner(value.owner);
	if (!owner || !isIdentity(value.policyVersion, LINK_SUGGESTION_LIMITS.versionChars) || !validSuggestion(value.suggestion, owner)) return null;
	return { owner, policyVersion: value.policyVersion, suggestion: value.suggestion };
}

// ---------------------------------------------------------------------------
// Chosen-target verification

export type LinkSourceRead =
	| { kind: "found"; document: LinkSourceDocument }
	| { kind: "missing" }
	| { kind: "unsupported"; reason: "no-portable-text-field" | "ambiguous-body-field" }
	/** Includes a saved draft revision that could not be read: live content is never substituted. */
	| { kind: "unavailable" };

export type LinkScopeCheck =
	| { kind: "current"; scopeVersion: string }
	| { kind: "changed" }
	| { kind: "unavailable" };

export type LinkStaleReason =
	| "source-missing"
	| "source-version-changed"
	| "anchor-changed"
	| "scope-changed"
	| "policy-changed"
	| "target-changed";

export type LinkVerificationUnavailable =
	| "source-unavailable"
	| "source-unsupported"
	| "target-unavailable"
	| "policy-unreadable"
	| "scope-unavailable"
	| "site-url-unavailable"
	| "source-route-unavailable";

export type LinkVerification =
	| { kind: "verified"; url: string; route: string }
	| { kind: "stale"; reasons: LinkStaleReason[]; target?: LinkExclusionReason }
	| { kind: "unavailable"; reason: LinkVerificationUnavailable };

function sameSourceVersion(document: LinkSourceDocument, identity: LinkSourceIdentity): boolean {
	return document.collection === identity.collection && document.entryId === identity.entryId && document.locale === identity.locale &&
		document.field === identity.field && document.sourceVersion === identity.sourceVersion && document.revisionId === identity.revisionId;
}

function anchorStillCurrent(blocks: readonly LinkSourceBlock[], locale: string, anchor: LinkSuggestionAnchor): boolean {
	const keyed = blocks.filter((item) => item.key === anchor.blockKey);
	if (keyed.length !== 1) return false;
	const block = keyed[0];
	if (!block.anchorable || block.kind !== anchor.blockKind || block.text !== anchor.paragraph) return false;
	const spans = block.spans.filter((span) => span.key === anchor.spanKey);
	if (spans.length !== 1) return false;
	const span = spans[0];
	if (!span.anchorable || span.blockOffset + anchor.start !== anchor.paragraphStart || span.text.slice(anchor.start, anchor.end) !== anchor.text) {
		return false;
	}
	const tokens = tokenize(span.text, locale);
	return tokens.some((token) => token.start === anchor.start) && tokens.some((token) => token.end === anchor.end);
}

/**
 * Rechecks the chosen suggestion immediately before its URL is returned:
 * exact saved source version and anchor, current scope, the unchanged global
 * and chosen-target noindex policy identities, the same published target and
 * its route. Any change is a named stale result; any unreadable input
 * refuses, never substitutes.
 */
export function verifyChosenLinkTarget(input: {
	request: LinkSuggestionRequest;
	source: LinkSourceRead;
	target: LinkTargetRead;
	policy: LinkPolicyRead;
	scope: LinkScopeCheck;
}): LinkVerification {
	const { request, source } = input;
	if (source.kind === "unavailable") return { kind: "unavailable", reason: "source-unavailable" };
	if (source.kind === "unsupported") return { kind: "unavailable", reason: "source-unsupported" };
	if (input.policy.kind !== "readable") return { kind: "unavailable", reason: "policy-unreadable" };
	if (input.scope.kind === "unavailable") return { kind: "unavailable", reason: "scope-unavailable" };
	if (input.target.kind === "unavailable") return { kind: "unavailable", reason: "target-unavailable" };
	if (source.kind === "missing") return { kind: "stale", reasons: ["source-missing"] };
	const document = validateLinkSourceDocument(source.document);
	if (!document) return { kind: "unavailable", reason: "source-unavailable" };
	if (!parseHttpUrl(document.siteUrl)) return { kind: "unavailable", reason: "site-url-unavailable" };
	const base = linkSiteBase(document.siteUrl, document.routeUrl);
	if (!base) return { kind: "unavailable", reason: "source-unavailable" };
	const extraction = extractPortableText(document.body);
	if (!extraction.ok) return { kind: "unavailable", reason: "source-unavailable" };
	const linked = destinationsOf(extraction, base);
	if (!linked.ok) return { kind: "unavailable", reason: "source-route-unavailable" };

	// Both policy identities must be freshly readable and consistent with each other before either is compared.
	if (input.target.kind === "found") {
		const fresh = input.target.target;
		if (!isRecord(fresh) || fresh.globalPolicyVersion !== input.policy.version ||
			!isIdentity(fresh.targetPolicyVersion, LINK_SUGGESTION_LIMITS.versionChars)) {
			return { kind: "unavailable", reason: "policy-unreadable" };
		}
	}

	const reasons: LinkStaleReason[] = [];
	const identity = request.owner.source;
	if (!sameSourceVersion(document, identity)) reasons.push("source-version-changed");
	else if (!anchorStillCurrent(extraction.blocks, document.locale, request.suggestion.anchor)) reasons.push("anchor-changed");
	if (input.scope.kind === "changed" || input.scope.scopeVersion !== request.owner.scope.scopeVersion) reasons.push("scope-changed");
	if (input.policy.version !== request.policyVersion ||
		(input.target.kind === "found" && input.target.target.targetPolicyVersion !== request.suggestion.target.targetPolicyVersion)) {
		reasons.push("policy-changed");
	}

	const check = checkTarget(input.target, request.suggestion.target, {
		base,
		policyVersion: input.policy.version,
		sourceRef: `${identity.collection}:${identity.entryId}`,
		sourceRoute: base.routeUrl ? linkCopyValue(base.routeUrl, base)?.route ?? null : null,
		linkedRoutes: linked.routes,
	});
	if (!check.ok && check.reason === "policy-unverifiable") return { kind: "unavailable", reason: "policy-unreadable" };
	let targetReason: LinkExclusionReason | undefined;
	if (!check.ok) targetReason = check.reason;
	else if (check.route !== request.suggestion.target.route || check.title !== request.suggestion.target.title) targetReason = "target-changed";
	if (targetReason) reasons.push("target-changed");
	if (reasons.length > 0 || !check.ok) return { kind: "stale", reasons, ...(targetReason ? { target: targetReason } : {}) };
	return { kind: "verified", url: check.publicUrl, route: check.route };
}

// ---------------------------------------------------------------------------
// Saved-link recheck

export type LinkSavedCheck =
	| { kind: "verified" }
	| { kind: "unlinked" }
	| { kind: "partial" }
	| { kind: "wrong-destination" }
	| { kind: "stale"; detail: "paragraph-missing" | "paragraph-changed" }
	| {
			kind: "inconclusive";
			detail:
				| "same-saved-version"
				| "duplicate-paragraph"
				| "decorators-changed"
				| "source-missing"
				| "source-unavailable"
				| "source-unsupported"
				| "source-unreadable"
				| "site-url-unavailable"
				| "source-route-unavailable"
				| "links-unreadable";
	  };

/**
 * Checks a newer saved version for a real link on the chosen anchor. The host
 * splits spans and assigns new span and annotation keys when a link is added,
 * so only the original block key, the exact joined paragraph text and the
 * UTF-16 anchor range identify it; there is no re-anchoring to another match.
 * Every anchor code unit must carry exactly one link annotation to the chosen
 * route, whatever its key, order or span count, and its original decorators. An unchanged saved version cannot show that an
 * unsaved insertion failed, and an unreadable source is not an absent link.
 */
export function checkSavedLink(input: { request: LinkSuggestionRequest; source: LinkSourceRead }): LinkSavedCheck {
	const { request, source } = input;
	if (source.kind === "missing") return { kind: "inconclusive", detail: "source-missing" };
	if (source.kind === "unavailable") return { kind: "inconclusive", detail: "source-unavailable" };
	if (source.kind === "unsupported") return { kind: "inconclusive", detail: "source-unsupported" };
	const document = validateLinkSourceDocument(source.document);
	const identity = request.owner.source;
	if (!document || document.collection !== identity.collection || document.entryId !== identity.entryId ||
		document.locale !== identity.locale || document.field !== identity.field) {
		return { kind: "inconclusive", detail: "source-unreadable" };
	}
	if (document.sourceVersion === identity.sourceVersion && document.revisionId === identity.revisionId) {
		return { kind: "inconclusive", detail: "same-saved-version" };
	}
	if (!parseHttpUrl(document.siteUrl)) return { kind: "inconclusive", detail: "site-url-unavailable" };
	const base = linkSiteBase(document.siteUrl, document.routeUrl);
	if (!base) return { kind: "inconclusive", detail: "source-unreadable" };
	const body = document.body;
	if (!Array.isArray(body) || bodyWithinLimit(body) !== true || !body.every(isRecord)) return { kind: "inconclusive", detail: "source-unreadable" };

	const anchor = request.suggestion.anchor;
	const keyed = body.filter((item) => item._key === anchor.blockKey);
	if (keyed.length === 0) return { kind: "stale", detail: "paragraph-missing" };
	if (keyed.length > 1) return { kind: "inconclusive", detail: "duplicate-paragraph" };
	const block = keyed[0];
	if (block._type !== "block" || !Array.isArray(block.children)) return { kind: "stale", detail: "paragraph-changed" };

	const spans: Array<{ start: number; end: number; marks: unknown }> = [];
	let text = "";
	for (const child of block.children) {
		if (!isRecord(child)) return { kind: "inconclusive", detail: "source-unreadable" };
		// The anchor paragraph had no inline object; one now means the paragraph changed.
		if (child._type !== "span") return { kind: "stale", detail: "paragraph-changed" };
		if (typeof child.text !== "string") return { kind: "inconclusive", detail: "source-unreadable" };
		spans.push({ start: text.length, end: text.length + child.text.length, marks: child.marks === undefined ? [] : child.marks });
		text += child.text;
	}
	if (text !== anchor.paragraph) return { kind: "stale", detail: "paragraph-changed" };

	if (block.markDefs !== undefined && !Array.isArray(block.markDefs)) return { kind: "inconclusive", detail: "links-unreadable" };
	const current = markDefinitions(block.markDefs);

	let chosen = 0;
	let unlinked = 0;
	let wrong = 0;
	let decoratorsChanged = false;
	for (let offset = anchor.paragraphStart; offset < anchor.paragraphEnd; offset += 1) {
		const span = spans.find((item) => item.start <= offset && offset < item.end);
		if (!span || !Array.isArray(span.marks) || !span.marks.every((mark) => typeof mark === "string")) {
			return { kind: "inconclusive", detail: "source-unreadable" };
		}
		const decorators = new Set<string>();
		const links: LinkHrefClass[] = [];
		for (const mark of span.marks as string[]) {
			if (HOST_DECORATORS.has(mark)) {
				decorators.add(mark);
				continue;
			}
			// A used mark without exactly one well-formed definition cannot be classified: not proof of absence.
			const definition = current.definitions.get(mark);
			if (!definition || current.ambiguous.has(mark)) return { kind: "inconclusive", detail: "links-unreadable" };
			if (definition._type !== "link") continue;
			const href = normalizeLinkHref(definition.href, base);
			if (href.kind === "unreadable") return { kind: "inconclusive", detail: "links-unreadable" };
			if (href.kind === "relative-unresolved") return { kind: "inconclusive", detail: "source-route-unavailable" };
			links.push(href);
		}
		if (JSON.stringify([...decorators].sort()) !== JSON.stringify(anchor.decorators[offset - anchor.paragraphStart])) decoratorsChanged = true;
		if (links.length === 0) unlinked += 1;
		else if (links.length === 1 && links[0].kind === "internal" && links[0].route === request.suggestion.target.route) chosen += 1;
		else wrong += 1;
	}
	if (wrong > 0) return { kind: "wrong-destination" };
	if (chosen > 0 && unlinked > 0) return { kind: "partial" };
	if (unlinked > 0) return { kind: "unlinked" };
	return decoratorsChanged ? { kind: "inconclusive", detail: "decorators-changed" } : { kind: "verified" };
}
