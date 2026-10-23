// Shared sitemap engine: selection rules, public route resolution, entry
// decisions, file planning and XML rendering. No React, DOM, Node, SQL or
// network dependency; a host adapter supplies projected public URL metadata.

import { normalizeSeoSitemapPath } from "./sitemap-policy.ts";

/** sitemaps.org limits for one sitemap or sitemap index file. */
export const SITEMAP_PROTOCOL_MAX_URLS = 50_000;
export const SITEMAP_PROTOCOL_MAX_BYTES = 52_428_800;
/** sitemaps.org requires each URL to be shorter than 2,048 characters. */
export const SITEMAP_MAX_URL_LENGTH = 2_047;
/**
 * Most source rows per child file. A child file starts after a cursor id and
 * covers the next rows in id order, so no request skips rows with OFFSET;
 * `sitemapPageSize` lowers it when the byte bound requires.
 */
export const SITEMAP_SOURCE_PAGE_SIZE = 500;
/** Longest accepted `after` cursor; EmDash content ids are 26-character ULIDs. */
export const SITEMAP_MAX_CURSOR_LENGTH = 128;
/** Builtin collections selected while no explicit choice is stored for them. */
export const SITEMAP_DEFAULT_COLLECTIONS: readonly string[] = ["pages", "posts"];

const COLLECTION_FILE_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const CHILD_PATH = /^\/sitemap-([^/]+)\.xml$/;
// eslint-disable-next-line no-control-regex
const CURSOR_INVALID = /[\u0000-\u001f\u007f\s]/;

export interface SitemapLimits {
	pageSize: number;
	maxUrls: number;
	maxBytes: number;
	maxUrlLength: number;
}

export const SITEMAP_LIMITS: SitemapLimits = Object.freeze({
	pageSize: SITEMAP_SOURCE_PAGE_SIZE,
	maxUrls: SITEMAP_PROTOCOL_MAX_URLS,
	maxBytes: SITEMAP_PROTOCOL_MAX_BYTES,
	maxUrlLength: SITEMAP_MAX_URL_LENGTH,
});

/** Longest accepted locale value; installation facts refuse longer ones. */
export const SITEMAP_MAX_LOCALE_LENGTH = 64;
// XML escaping turns one URL character into at most six bytes (`&apos;`).
const ESCAPE_FACTOR = 6;
const ENVELOPE_BYTES = 512;
const ENTRY_OVERHEAD_BYTES = 128;
const ALTERNATE_OVERHEAD_BYTES = 64;

/**
 * Worst-case bytes of one `<url>` element: a location and an image of the
 * longest accepted URL, fully expanded by escaping, plus one alternate per
 * accepted locale value and x-default when locales are routed.
 */
export function sitemapEntryByteBound(routing: SitemapRouting, siteLocale: string, limits: SitemapLimits = SITEMAP_LIMITS): number {
	const url = limits.maxUrlLength * ESCAPE_FACTOR;
	const alternates = sitemapLocalesRouted(routing) ? sitemapAcceptedLocales(routing, siteLocale).length + 1 : 0;
	return ENTRY_OVERHEAD_BYTES + 2 * url +
		alternates * (ALTERNATE_OVERHEAD_BYTES + SITEMAP_MAX_LOCALE_LENGTH * ESCAPE_FACTOR + url);
}

/**
 * Rows per child file. Bounded by the URL limit and by the byte limit divided
 * by the worst-case entry size, so a full file fits both protocol limits
 * without reading entries first. Planning, reading and previews all use it.
 */
export function sitemapPageSize(routing: SitemapRouting, siteLocale: string, limits: SitemapLimits = SITEMAP_LIMITS): number {
	const byBytes = Math.floor((limits.maxBytes - ENVELOPE_BYTES) / sitemapEntryByteBound(routing, siteLocale, limits));
	return Math.max(1, Math.min(limits.pageSize, limits.maxUrls, byBytes));
}

// ---------------------------------------------------------------------------
// Routing facts captured from the site's Astro configuration
// ---------------------------------------------------------------------------

export type SitemapLocaleEntry = string | { path: string; codes: string[] };

export interface SitemapRouting {
	trailingSlash: "always" | "never" | "ignore";
	i18n: {
		defaultLocale: string;
		locales: SitemapLocaleEntry[];
		prefixDefaultLocale: boolean;
	} | null;
}

/** True when the configuration routes more than one locale, which is when EmDash adds locale segments. */
export function sitemapLocalesRouted(routing: SitemapRouting): boolean {
	return Boolean(routing.i18n && routing.i18n.locales.length > 1);
}

function localeEntryValues(entry: SitemapLocaleEntry): string[] {
	return typeof entry === "string" ? [entry] : [entry.path, ...entry.codes];
}

/**
 * Locale values whose rows have their own public address. With several
 * routed locales that is every configured string, custom path and code.
 * Without locale routing every row shares one unprefixed address, so only the
 * single configured locale, or the site locale without Astro i18n, is listed.
 */
export function sitemapAcceptedLocales(routing: SitemapRouting, siteLocale: string): string[] {
	const entries = routing.i18n?.locales ?? [];
	if (!routing.i18n || entries.length === 0) return [siteLocale];
	return [...new Set(entries.flatMap(localeEntryValues))].sort();
}

interface LocaleMatch {
	segment: string;
	isDefault: boolean;
	hreflang: string;
}

// Mirrors EmDash 1.1.0 `resolveLocaleSegmentFromConfig` for the segment and
// default decision; hreflang is the row locale when it is a language code,
// else the entry's first code.
function matchLocale(routing: SitemapRouting, locale: string): LocaleMatch | undefined {
	const i18n = routing.i18n;
	if (!i18n) return undefined;
	for (const entry of i18n.locales) {
		if (typeof entry === "string") {
			if (entry === locale) return { segment: entry, isDefault: locale === i18n.defaultLocale, hreflang: entry };
		} else if (entry.path === locale || entry.codes.includes(locale)) {
			return {
				segment: entry.path,
				isDefault: locale === i18n.defaultLocale || entry.path === i18n.defaultLocale || entry.codes.includes(i18n.defaultLocale),
				hreflang: entry.codes.includes(locale) ? locale : entry.codes[0] ?? locale,
			};
		}
	}
	return undefined;
}

// null means no prefix (i18n off or single locale), "" means the unprefixed
// default locale, undefined means the locale has no route.
function localeSegment(routing: SitemapRouting, locale: string): string | null | undefined {
	if (!sitemapLocalesRouted(routing)) return null;
	const match = matchLocale(routing, locale);
	if (!match) return undefined;
	return match.isDefault && !routing.i18n!.prefixDefaultLocale ? "" : match.segment;
}

const REPEATED_SLASHES = /\/{2,}/g;
const DATE_TOKEN = /\{(year|month|day|hour|minute|second)\}/g;
const OFFSETLESS_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;
const UNRESOLVED_TOKEN = /\{[^/{}]*\}/;

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

// Stored SQLite datetimes carry no offset and are UTC.
function parseUtcDate(value: string): Date {
	const offsetless = OFFSETLESS_DATETIME.exec(value);
	return new Date(offsetless ? `${offsetless[1]}T${offsetless[2]}Z` : value);
}

function applyDateTokens(path: string, date: string | null): string {
	const parsed = date == null ? null : parseUtcDate(date);
	if (!parsed || Number.isNaN(parsed.getTime())) return path;
	const parts: Record<string, string> = {
		year: String(parsed.getUTCFullYear()),
		month: pad2(parsed.getUTCMonth() + 1),
		day: pad2(parsed.getUTCDate()),
		hour: pad2(parsed.getUTCHours()),
		minute: pad2(parsed.getUTCMinutes()),
		second: pad2(parsed.getUTCSeconds()),
	};
	return path.replace(DATE_TOKEN, (match, key: string) => parts[key] ?? match);
}

function normalizeRoutePath(path: string): string {
	let normalized = path.replace(REPEATED_SLASHES, "/");
	if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
	if (!normalized.startsWith("/")) normalized = `/${normalized}`;
	return normalized;
}

export interface SitemapRouteInput {
	pattern: string | null;
	collection: string;
	slug: string;
	id: string;
	/** Publication date; date tokens use it in UTC, never the modification date. */
	publishedAt: string | null;
	locale: string;
}

export type SitemapRouteResult =
	| { path: string; reason: null }
	| { path: null; reason: "locale-unrouted" | "unresolved-route" };

/**
 * Public path for one row, matching EmDash 1.1.0 `getPublicUrl` for the same
 * pattern, slug, id, publication date, locale and trailing-slash policy.
 * Paths that keep an unresolved `{token}` are refused instead of advertised.
 */
export function resolveSitemapRoute(input: SitemapRouteInput, routing: SitemapRouting): SitemapRouteResult {
	const basePattern = input.pattern ?? `/${encodeURIComponent(input.collection)}/{slug}`;
	let path = basePattern
		.replaceAll("{slug}", encodeURIComponent(input.slug))
		.replaceAll("{id}", encodeURIComponent(input.id));
	path = normalizeRoutePath(applyDateTokens(path, input.publishedAt));
	if (UNRESOLVED_TOKEN.test(path)) return { path: null, reason: "unresolved-route" };
	const segment = localeSegment(routing, input.locale);
	if (segment === undefined) return { path: null, reason: "locale-unrouted" };
	let localized = segment ? normalizeRoutePath(`/${segment}${path}`) : normalizeRoutePath(path);
	if (routing.trailingSlash === "always" && localized !== "/") localized = `${localized}/`;
	return { path: localized, reason: null };
}

// ---------------------------------------------------------------------------
// Supported routing boundary
// ---------------------------------------------------------------------------

const ROW_TOKEN = /\{(?:slug|id)\}/;
const ANY_TOKEN = /\{[^/{}]*\}/;

function effectivePattern(collection: { key: string; urlPattern: string | null }): string {
	return collection.urlPattern ?? `/${encodeURIComponent(collection.key)}/{slug}`;
}

/**
 * True when the pattern gives each row its own address: EmDash keeps slugs
 * unique per locale and ids unique, so `{slug}` or `{id}` is required. Fixed
 * and date-only patterns can give several rows one address.
 */
export function sitemapPatternIsUnique(collection: { key: string; urlPattern: string | null }): boolean {
	return ROW_TOKEN.test(effectivePattern(collection));
}

/** A fixed public path can be used only after checking its current rows. */
export function sitemapPatternIsConstant(collection: { key: string; urlPattern: string | null }): boolean {
	const pattern = effectivePattern(collection);
	return !/[{}]/.test(pattern) && normalizeSeoSitemapPath(pattern) !== null;
}

function literalKey(segment: string): string {
	return sitemapPathKey(`/${segment}`).slice(1);
}

// Conservative: any segment holding a token may equal any other segment.
function segmentsMayMatch(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((segment, index) =>
		ANY_TOKEN.test(segment) || ANY_TOKEN.test(right[index]) || literalKey(segment) === literalKey(right[index]));
}

/** Locale segment lists EmDash may put before a content route; an empty list is the unprefixed form. */
export function sitemapLocalePrefixes(routing: SitemapRouting): string[][] {
	if (!sitemapLocalesRouted(routing)) return [[]];
	const prefixes = new Map<string, string[]>();
	for (const entry of routing.i18n!.locales) {
		const segment = localeSegment(routing, typeof entry === "string" ? entry : entry.path);
		if (segment !== undefined && segment !== null) prefixes.set(segment, segment ? [segment] : []);
	}
	return [...prefixes.values()];
}

export interface SitemapRouteOverlap {
	collections: [string, string];
}

/**
 * Pairs of collections whose patterns may produce the same public address in
 * any routed locale. Listing both could advertise one URL twice across files,
 * so such a selection is refused rather than deduplicated by a stored index.
 */
export function sitemapRouteOverlaps(
	collections: readonly { key: string; urlPattern: string | null }[],
	routing: SitemapRouting,
): SitemapRouteOverlap[] {
	const prefixes = sitemapLocalePrefixes(routing);
	const forms = collections.map((collection) => {
		const segments = normalizeRoutePath(effectivePattern(collection)).split("/").filter(Boolean);
		return { key: collection.key, forms: prefixes.map((prefix) => [...prefix, ...segments]) };
	});
	const overlaps: SitemapRouteOverlap[] = [];
	for (let left = 0; left < forms.length; left += 1) {
		for (let right = left + 1; right < forms.length; right += 1) {
			const collide = forms[left].forms.some((a) => forms[right].forms.some((b) => segmentsMayMatch(a, b)));
			if (collide) overlaps.push({ collections: [forms[left].key, forms[right].key] });
		}
	}
	return overlaps;
}

// ---------------------------------------------------------------------------
// Selection and exclusions
// ---------------------------------------------------------------------------

export interface SitemapCollectionInfo {
	key: string;
	label: string;
	urlPattern: string | null;
}

export interface SitemapSelection {
	key: string;
	selected: boolean;
	/** `saved`: an explicit stored choice; `default`: no stored choice for this key. */
	source: "saved" | "default";
}

/** Valid file key for `/sitemap-<key>.xml`; EmDash collection slugs are SQL identifiers. */
export function isSitemapCollectionFileKey(value: unknown): value is string {
	return typeof value === "string" && COLLECTION_FILE_KEY.test(value);
}

/**
 * Explicit stored choices win. Without one, builtin Pages and Posts are
 * selected and every other collection stays unselected, including collections
 * created after the configuration was saved.
 */
export function resolveSitemapSelection(
	collections: readonly SitemapCollectionInfo[],
	saved: Readonly<Record<string, boolean>> | null,
): SitemapSelection[] {
	return collections.map((collection) => {
		const stored = saved && Object.hasOwn(saved, collection.key) ? saved[collection.key] : undefined;
		return typeof stored === "boolean"
			? { key: collection.key, selected: stored, source: "saved" }
			: { key: collection.key, selected: SITEMAP_DEFAULT_COLLECTIONS.includes(collection.key), source: "default" };
	});
}

/**
 * Comparison key for exact path exclusions: no trailing slash except the
 * root, each segment percent-decoded and in Unicode NFC, so `/über` and
 * `/%C3%BCber/` name the same address. A decoded `/` or `%` stays escaped,
 * so `/a%2Fb` and `/a/b` remain different addresses.
 */
export function sitemapPathKey(path: string): string {
	const trimmed = path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
	return trimmed.split("/").map((segment) => {
		let decoded: string;
		try {
			decoded = decodeURIComponent(segment);
		} catch {
			return segment.normalize("NFC");
		}
		return decoded.normalize("NFC").replaceAll("%", "%25").replaceAll("/", "%2F");
	}).join("/");
}

/** Normalized exclusion keys; invalid stored paths are ignored, as validation already refuses them. */
export function sitemapExclusionKeys(paths: readonly string[]): Set<string> {
	const keys = new Set<string>();
	for (const path of paths) {
		const normalized = normalizeSeoSitemapPath(path);
		if (normalized) keys.add(sitemapPathKey(normalized));
	}
	return keys;
}

// ---------------------------------------------------------------------------
// Source rows and decisions
// ---------------------------------------------------------------------------

/** Public URL metadata for one published row; the source never supplies bodies or authors. */
export interface SitemapSourceRow {
	id: string;
	slug: string;
	locale: string;
	translationGroup: string | null;
	updatedAt: string | null;
	publishedAt: string | null;
	/** Core SEO metadata; null when the row has none, which is indexable. */
	seo: { noIndex: boolean; canonical: string | null; image: string | null; updatedAt: string | null } | null;
	/** Shipit legacy override still owning canonical, robots or the social image for this row. */
	legacy?: { canonical: string | null; noIndex: boolean; image: string | null } | null;
}

export interface SitemapSourceFilter {
	/** Locale values with their own public address; other rows are not candidates. */
	locales: string[];
}

/** Candidate count and child file start cursors for one collection. */
export interface SitemapCollectionPlan {
	rowCount: number;
	/** `null` starts at the first row; every other cursor is the last id of the previous file. */
	cursors: (string | null)[];
}

/**
 * Narrow projected source. Every method applies the same candidate
 * predicate: published, not deleted, non-blank slug and an accepted locale.
 * `planFiles` returns the cursor before every `pageSize` candidates in id
 * order; `readRows` returns up to `limit` candidates with ids greater than
 * `after`, in id order. `readGroups` returns every candidate of the given
 * translation groups, in any order.
 */
export interface SitemapSource {
	planFiles(collection: string, filter: SitemapSourceFilter, pageSize: number): Promise<SitemapCollectionPlan>;
	readRows(collection: string, filter: SitemapSourceFilter, range: { after: string | null; limit: number }): Promise<SitemapSourceRow[]>;
	readGroups(collection: string, filter: SitemapSourceFilter, groups: readonly string[]): Promise<SitemapSourceRow[]>;
}

/**
 * Plan from the candidate count and the ids at 1-based positions size,
 * 2*size and so on that are followed by another candidate.
 */
export function sitemapPlan(rowCount: number, boundaryIds: readonly string[]): SitemapCollectionPlan {
	return rowCount <= 0 ? { rowCount: 0, cursors: [] } : { rowCount, cursors: [null, ...boundaryIds] };
}

/** Resolves stored image and canonical references to the URLs public pages emit. */
export type SitemapSeoUrlResolver = (
	seo: { image: string | null; canonical: string | null },
	siteUrl: string,
	path: string,
) => { image: string | null; canonical: string | null };

const ABSOLUTE_HTTP = /^https?:\/\//i;

/**
 * Portable copy of EmDash 1.1.0 `buildSeoImageUrl` and the canonical branch of
 * `getSeoMeta`. The native adapter uses EmDash's own `getSeoMeta` instead.
 */
export const portableSitemapSeoUrls: SitemapSeoUrlResolver = (seo, siteUrl, path) => {
	const base = siteUrl.replace(/\/$/, "");
	let image: string | null = null;
	if (seo.image) {
		if (ABSOLUTE_HTTP.test(seo.image) || seo.image.startsWith("//")) image = seo.image;
		else if (seo.image.startsWith("/")) image = `${base}${seo.image}`;
		else image = `${base}/_emdash/api/media/file/${seo.image}`;
	}
	let canonical: string;
	if (seo.canonical) {
		canonical = ABSOLUTE_HTTP.test(seo.canonical) || seo.canonical.startsWith("//")
			? seo.canonical
			: `${base}${seo.canonical.startsWith("/") ? seo.canonical : `/${seo.canonical}`}`;
	} else {
		canonical = `${base}${path.startsWith("/") ? path : `/${path}`}`;
	}
	return { image, canonical };
};

export const SITEMAP_ENTRY_STATUSES = [
	"included",
	"locale-unrouted",
	"unresolved-route",
	"noindex",
	"excluded-path",
	"canonical-elsewhere",
	"canonical-invalid",
	"invalid-url",
	"duplicate-url",
] as const;

export type SitemapEntryStatus = (typeof SITEMAP_ENTRY_STATUSES)[number];

export interface SitemapEntryDecision {
	id: string;
	locale: string;
	translationGroup: string | null;
	status: SitemapEntryStatus;
	path: string | null;
	url: string | null;
	lastmod: string | null;
	image: string | null;
	/** Absolute canonical URL the page emits when it differs from `url`. */
	canonical: string | null;
}

export interface SitemapDecisionContext {
	collection: SitemapCollectionInfo;
	routing: SitemapRouting;
	/** Public site origin without trailing slash. */
	origin: string;
	exclusions: ReadonlySet<string>;
	seoUrls: SitemapSeoUrlResolver;
	maxUrlLength: number;
}

const TZ_SUFFIX = /([zZ]|[+-]\d{2}(:?\d{2})?)$/;

/** W3C datetime in UTC, or null when the stored value cannot be read as a date. */
export function sitemapLastmod(value: string | null): string | null {
	if (!value) return null;
	let normalized = value.trim();
	if (normalized.includes(" ") && !normalized.includes("T")) normalized = normalized.replace(" ", "T");
	if (!TZ_SUFFIX.test(normalized)) normalized += "Z";
	const parsed = Date.parse(normalized);
	return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// EmDash leaves the content row's timestamp unchanged on SEO-only writes and
// advances the SEO row's, so a page changes when either one does.
function newestLastmod(content: string | null, seo: string | null): string | null {
	const values = [sitemapLastmod(content), sitemapLastmod(seo)].filter((value): value is string => value !== null);
	return values.length ? values.sort().at(-1)! : null;
}

// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/;

function absoluteHttpUrl(value: string, origin: string): string | null {
	try {
		const url = new URL(value, `${origin}/`);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

function usableUrl(value: string, maxLength: number): boolean {
	return value.length <= maxLength && !XML_INVALID.test(value) && !/\s/.test(value);
}

const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;

// URL serialization removes `.` and `..` segments, which would advertise a
// different address than the route; such paths are refused instead.
function serializedRouteUrl(path: string, origin: string): string | null {
	if (XML_INVALID.test(path) || path.split("/").some((segment) => DOT_SEGMENT.test(segment))) return null;
	const url = absoluteHttpUrl(path, origin);
	return url && new URL(url).origin === origin ? url : null;
}

/**
 * One row's sitemap decision. A row is listed only when it has a public route
 * in a routed locale, is not noindex, is not excluded by exact path and its
 * page does not declare another canonical address. `url` is the serialized
 * absolute URL, so non-ASCII route text is percent-encoded before the length
 * limit applies.
 */
export function decideSitemapEntry(row: SitemapSourceRow, context: SitemapDecisionContext): SitemapEntryDecision {
	const route = resolveSitemapRoute({
		pattern: context.collection.urlPattern,
		collection: context.collection.key,
		slug: row.slug,
		id: row.id,
		publishedAt: row.publishedAt,
		locale: row.locale,
	}, context.routing);
	const base = {
		id: row.id,
		locale: row.locale,
		translationGroup: row.translationGroup,
		lastmod: newestLastmod(row.updatedAt, row.seo?.updatedAt ?? null),
	};
	if (route.path === null) {
		return { ...base, status: route.reason, path: null, url: null, image: null, canonical: null };
	}
	const url = serializedRouteUrl(route.path, context.origin);
	const decided = (status: SitemapEntryStatus, extra: { image?: string | null; canonical?: string | null } = {}) => ({
		...base, status, path: route.path, url, image: extra.image ?? null, canonical: extra.canonical ?? null,
	});
	if (row.legacy?.noIndex || row.seo?.noIndex) return decided("noindex");
	if (context.exclusions.has(sitemapPathKey(route.path))) return decided("excluded-path");
	if (url === null || !usableUrl(url, context.maxUrlLength)) return decided("invalid-url");

	const canonicalSource = row.legacy?.canonical ?? row.seo?.canonical ?? null;
	const resolved = context.seoUrls({ image: row.seo?.image ?? null, canonical: canonicalSource }, context.origin, route.path);
	if (canonicalSource) {
		const canonical = resolved.canonical ? absoluteHttpUrl(resolved.canonical, context.origin) : null;
		if (!canonical) return decided("canonical-invalid");
		if (canonical !== url) return decided("canonical-elsewhere", { canonical });
	}
	// A legacy image replaces the core one even when unusable, as on the page.
	const imageSource = row.legacy?.image ?? resolved.image;
	const image = imageSource ? absoluteHttpUrl(imageSource, context.origin) : null;
	return decided("included", { image: image && usableUrl(image, context.maxUrlLength) ? image : null });
}

export interface SitemapAlternate {
	hreflang: string;
	href: string;
}

/**
 * Hreflang alternates for included rows, built only from included members of
 * the same translation group, so excluded, noindex and non-canonical
 * translations are never linked. Without routed locales no alternates exist.
 */
export function sitemapAlternates(
	entries: readonly SitemapEntryDecision[],
	groupMembers: readonly SitemapEntryDecision[],
	routing: SitemapRouting,
): Map<string, SitemapAlternate[]> {
	const result = new Map<string, SitemapAlternate[]>();
	if (!sitemapLocalesRouted(routing)) return result;
	const byId = (a: SitemapEntryDecision, b: SitemapEntryDecision) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	const groups = new Map<string, { hreflang: string; isDefault: boolean; href: string }[]>();
	for (const member of [...groupMembers].sort(byId)) {
		const match = matchLocale(routing, member.locale);
		if (member.status !== "included" || !member.translationGroup || !member.url || !match) continue;
		const list = groups.get(member.translationGroup) ?? [];
		// One address per language: the lowest id wins when locale aliases meet.
		if (!list.some((item) => item.hreflang === match.hreflang || item.href === member.url)) {
			list.push({ hreflang: match.hreflang, isDefault: match.isDefault, href: member.url });
		}
		groups.set(member.translationGroup, list);
	}
	for (const list of groups.values()) list.sort((a, b) => (a.hreflang < b.hreflang ? -1 : a.hreflang > b.hreflang ? 1 : 0));
	for (const entry of entries) {
		const match = matchLocale(routing, entry.locale);
		if (entry.status !== "included" || !entry.url || !match) continue;
		const members = (entry.translationGroup ? groups.get(entry.translationGroup) : undefined) ??
			[{ hreflang: match.hreflang, isDefault: match.isDefault, href: entry.url }];
		const alternates = members.map((member) => ({ hreflang: member.hreflang, href: member.href }));
		const fallback = members.find((member) => member.isDefault) ?? members[0];
		if (fallback) alternates.push({ hreflang: "x-default", href: fallback.href });
		result.set(entry.id, alternates);
	}
	return result;
}

/**
 * Keeps the first included entry per URL in id order and marks later ones,
 * so a file never lists one address twice.
 */
export function markDuplicateSitemapUrls(entries: readonly SitemapEntryDecision[]): SitemapEntryDecision[] {
	const seen = new Set<string>();
	return [...entries].map((entry) => {
		if (entry.status !== "included" || !entry.url) return entry;
		if (seen.has(entry.url)) return { ...entry, status: "duplicate-url" as const, image: null };
		seen.add(entry.url);
		return entry;
	});
}

// ---------------------------------------------------------------------------
// Public file addresses
// ---------------------------------------------------------------------------

export type SitemapFileRequest =
	| { kind: "index" }
	| { kind: "child"; collection: string; after: string | null };

export type SitemapPublicPathMatch =
	| { match: "none" }
	| { match: "invalid" }
	| { match: "file"; file: SitemapFileRequest };

export function isSitemapCursor(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= SITEMAP_MAX_CURSOR_LENGTH &&
		!CURSOR_INVALID.test(value);
}

/**
 * Strict public address parser. `/sitemap.xml` takes no query. A child file
 * accepts at most one non-empty `after` cursor and nothing else; the first
 * file of a collection has no parameter.
 */
export function parseSitemapPublicPath(pathname: string, search: string): SitemapPublicPathMatch {
	if (pathname === "/sitemap.xml") {
		return search === "" || search === "?" ? { match: "file", file: { kind: "index" } } : { match: "invalid" };
	}
	const child = CHILD_PATH.exec(pathname);
	if (!child) return { match: "none" };
	if (!COLLECTION_FILE_KEY.test(child[1])) return { match: "invalid" };
	if (search === "" || search === "?") return { match: "file", file: { kind: "child", collection: child[1], after: null } };
	const params = new URLSearchParams(search);
	const keys = [...params.keys()];
	const values = params.getAll("after");
	if (keys.length !== 1 || values.length !== 1 || !isSitemapCursor(values[0])) return { match: "invalid" };
	return { match: "file", file: { kind: "child", collection: child[1], after: values[0] } };
}

export function sitemapChildPath(collection: string, after: string | null): string {
	return after === null
		? `/sitemap-${collection}.xml`
		: `/sitemap-${collection}.xml?${new URLSearchParams({ after }).toString()}`;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

export function escapeSitemapXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** `protocol`: a sitemaps.org file limit; `request-budget`: more queries than one request may run. */
export class SitemapCapacityError extends Error {
	readonly kind: "protocol" | "request-budget";

	constructor(message: string, kind: "protocol" | "request-budget" = "protocol") {
		super(message);
		this.name = "SitemapCapacityError";
		this.kind = kind;
	}
}

const encoder = new TextEncoder();

export function sitemapByteLength(value: string): number {
	return encoder.encode(value).byteLength;
}

/** Sitemap index listing child files in collection order, then page order. */
export function renderSitemapIndex(
	origin: string,
	files: readonly { collection: string; after: string | null }[],
	limits: SitemapLimits = SITEMAP_LIMITS,
): string {
	if (files.length > limits.maxUrls) {
		throw new SitemapCapacityError(`The sitemap index would list ${files.length} files; the protocol allows ${limits.maxUrls}.`);
	}
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
	];
	for (const file of files) {
		lines.push("  <sitemap>", `    <loc>${escapeSitemapXml(`${origin}${sitemapChildPath(file.collection, file.after)}`)}</loc>`, "  </sitemap>");
	}
	lines.push("</sitemapindex>", "");
	const xml = lines.join("\n");
	if (sitemapByteLength(xml) > limits.maxBytes) {
		throw new SitemapCapacityError("The sitemap index exceeds the protocol size limit.");
	}
	return xml;
}

/**
 * One child file. Throws instead of returning a partial file when the URL
 * count or byte size would exceed the protocol limits.
 */
export function renderSitemapUrlset(
	entries: readonly SitemapEntryDecision[],
	alternates: ReadonlyMap<string, SitemapAlternate[]>,
	limits: SitemapLimits = SITEMAP_LIMITS,
): string {
	const included = entries.filter((entry) => entry.status === "included" && entry.url);
	if (included.length > limits.maxUrls) {
		throw new SitemapCapacityError(`A sitemap file would list ${included.length} URLs; the protocol allows ${limits.maxUrls}.`);
	}
	const withAlternates = included.some((entry) => (alternates.get(entry.id)?.length ?? 0) > 0);
	const withImages = included.some((entry) => entry.image);
	const namespaces = [
		'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
		...(withAlternates ? ['xmlns:xhtml="http://www.w3.org/1999/xhtml"'] : []),
		...(withImages ? ['xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'] : []),
	];
	const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<urlset ${namespaces.join(" ")}>`];
	let bytes = sitemapByteLength(lines.join("\n")) + 12;
	for (const entry of included) {
		const block = ["  <url>", `    <loc>${escapeSitemapXml(entry.url!)}</loc>`];
		if (entry.lastmod) block.push(`    <lastmod>${entry.lastmod}</lastmod>`);
		if (entry.image) block.push("    <image:image>", `      <image:loc>${escapeSitemapXml(entry.image)}</image:loc>`, "    </image:image>");
		for (const alternate of alternates.get(entry.id) ?? []) {
			block.push(`    <xhtml:link rel="alternate" hreflang="${escapeSitemapXml(alternate.hreflang)}" href="${escapeSitemapXml(alternate.href)}" />`);
		}
		block.push("  </url>");
		const text = block.join("\n");
		bytes += sitemapByteLength(text) + 1;
		if (bytes > limits.maxBytes) throw new SitemapCapacityError("A sitemap file exceeds the protocol size limit.");
		lines.push(text);
	}
	lines.push("</urlset>", "");
	return lines.join("\n");
}
