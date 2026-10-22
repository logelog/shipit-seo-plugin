import type { SeoAdminSitemapPreview, SeoAdminSitemapPreviewRequest } from "../admin-contract.ts";

// Preview file selection for the Sitemaps view. Plans change after saves and
// reloads, so the requested position is resolved against the current plan
// before it is shown, fetched or moved.

export interface SitemapPreviewPlanFiles {
	collection: string;
	files: readonly (string | null)[];
}

export interface SitemapPreviewPosition {
	collection: string | null;
	fileIndex: number;
}

export interface SitemapPreviewSelection {
	collection: string;
	index: number;
	after: string | null;
	count: number;
	previous: SitemapPreviewPosition | null;
	next: SitemapPreviewPosition | null;
}

/**
 * The file that is shown, fetched and paged from. A collection that left the
 * plan falls back to the first planned one at its first file; a file index
 * beyond a shrunken plan is clamped to the last file.
 */
export function sitemapPreviewSelection(
	plans: readonly SitemapPreviewPlanFiles[],
	requested: SitemapPreviewPosition,
): SitemapPreviewSelection | null {
	const available = plans.filter((plan) => plan.files.length > 0);
	const plan = available.find((item) => item.collection === requested.collection) ?? available[0];
	if (!plan) return null;
	const wanted = plan.collection === requested.collection ? requested.fileIndex : 0;
	const index = Math.min(Math.max(0, Math.trunc(wanted) || 0), plan.files.length - 1);
	return {
		collection: plan.collection,
		index,
		after: plan.files[index] ?? null,
		count: plan.files.length,
		previous: index > 0 ? { collection: plan.collection, fileIndex: index - 1 } : null,
		next: index < plan.files.length - 1 ? { collection: plan.collection, fileIndex: index + 1 } : null,
	};
}

/** The public address of one planned child file, in the engine's sitemap path format. */
export function sitemapFileUrl(origin: string, collection: string, after: string | null): string {
	return after === null
		? `${origin}/sitemap-${collection}.xml`
		: `${origin}/sitemap-${collection}.xml?${new URLSearchParams({ after }).toString()}`;
}

/** At most `limit` file links per type; the rest are counted. */
export function sitemapFileLinks(
	origin: string | null,
	plan: SitemapPreviewPlanFiles | undefined,
	limit = 3,
): { urls: string[]; more: number } {
	if (!origin || !plan) return { urls: [], more: 0 };
	const urls = plan.files.slice(0, limit).map((after) => sitemapFileUrl(origin, plan.collection, after));
	return { urls, more: Math.max(0, plan.files.length - urls.length) };
}

/**
 * The plan counts published entries before noindex, excluded paths and
 * canonical rules, so the label names the files built from them and never
 * implies that every counted entry is listed.
 */
export function sitemapPlanSummary(plan: { candidates: number; files: readonly unknown[] }): string {
	const files = plan.files.length;
	return `${files.toLocaleString("en")} ${files === 1 ? "file" : "files"} from ${plan.candidates.toLocaleString("en")} published ${plan.candidates === 1 ? "entry" : "entries"}`;
}

/** Splits an address after each slash outside "//", so a narrow column breaks it between path parts first. */
export function sitemapUrlParts(url: string): string[] {
	return url.split(/(?<=\/)(?!\/)/).filter(Boolean);
}

/**
 * Link text as breakable parts and its last character, which shares one line with the link
 * icon so the icon never wraps away from the text. Joined, the parts and `end` are the text.
 */
export function publicLinkText(text: string, address: boolean): { parts: string[]; end: string } {
	const parts = address ? sitemapUrlParts(text) : [text];
	const last = Array.from(parts.pop() ?? "");
	const end = last.pop() ?? "";
	return { parts: [...parts, last.join("")], end };
}

export type SitemapPreviewStatus = "all" | "included" | "excluded";
export type SitemapPreviewSuccess = Extract<SeoAdminSitemapPreview, { success: true }>;

export interface SitemapExplorerFilters {
	search: string;
	status: SitemapPreviewStatus;
	limit: 25 | 50;
	cursor: string | null;
	/** A cursor belongs to one file and saved settings revision. */
	cursorScope: string | null;
}

export function initialSitemapExplorerFilters(): SitemapExplorerFilters {
	return { search: "", status: "all", limit: 25, cursor: null, cursorScope: null };
}

export function sitemapPreviewScope(revision: string | null, selection: Pick<SitemapPreviewSelection, "collection" | "after">): string {
	return JSON.stringify([revision, selection.collection, selection.after]);
}

export function sitemapExplorerRequest(
	selection: SitemapPreviewSelection,
	scope: string,
	filters: SitemapExplorerFilters,
): SeoAdminSitemapPreviewRequest {
	return {
		collection: selection.collection,
		after: selection.after,
		search: filters.search,
		status: filters.status,
		limit: filters.limit,
		cursor: filters.cursorScope === scope ? filters.cursor : null,
	};
}

/** Changing a table filter starts again at its first matching row. */
export function filterSitemapExplorer(
	current: SitemapExplorerFilters,
	patch: Partial<Pick<SitemapExplorerFilters, "search" | "status" | "limit">>,
): SitemapExplorerFilters {
	return { ...current, ...patch, cursor: null, cursorScope: null };
}

export function pageSitemapExplorer(current: SitemapExplorerFilters, scope: string, cursor: string | null): SitemapExplorerFilters {
	return { ...current, cursor, cursorScope: scope };
}

export function sitemapPreviewMatches(request: SeoAdminSitemapPreviewRequest, result: SitemapPreviewSuccess): boolean {
	return result.collection === request.collection && result.after === request.after
		&& result.search === (request.search ?? "") && result.status === (request.status ?? "all")
		&& result.limit === (request.limit ?? 25);
}

export function sitemapPreviewReadDenied(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("status" in error)) return false;
	return error.status === 401 || error.status === 403;
}

/** A failed read may retain an earlier table only for the same public file. */
export function sitemapPreviewDisplay(
	request: SeoAdminSitemapPreviewRequest,
	current: SeoAdminSitemapPreview | undefined,
	previous: SitemapPreviewSuccess | null,
	failed: boolean,
	denied = false,
): { result: SitemapPreviewSuccess; stale: boolean } | null {
	if (denied) return null;
	if (current?.success && sitemapPreviewMatches(request, current)) return { result: current, stale: failed };
	if (failed && previous?.collection === request.collection && previous.after === request.after) {
		return { result: previous, stale: true };
	}
	return null;
}

/** This describes the displayed response, never the controls for a pending request. */
export function sitemapPreviewRowsLabel(result: SitemapPreviewSuccess): string {
	const count = result.matched.toLocaleString("en");
	const rows = result.entries.length === 0
		? "0"
		: `${(result.offset + 1).toLocaleString("en")}-${(result.offset + result.entries.length).toLocaleString("en")}`;
	const status = result.status === "included" ? "Listed" : result.status === "excluded" ? "Left out" : "All statuses";
	return `Rows ${rows} of ${count} matching entries · ${status}${result.search ? ` · Search: “${result.search}”` : ""}`;
}
