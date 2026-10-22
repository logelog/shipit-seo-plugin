// Admin table pages are independent of the public XML file's source boundary.
import type { SeoAdminSitemapPreviewEntry } from "./admin-contract.ts";
import { SITEMAP_SOURCE_PAGE_SIZE } from "./sitemap-engine.ts";

export interface SitemapPreviewWindowInput {
	search?: string;
	status?: "all" | "included" | "excluded";
	limit?: 25 | 50;
	cursor?: string | null;
}

export class SitemapPreviewWindowError extends Error {
	readonly stale: boolean;
	constructor(message: string, stale = false) {
		super(message);
		this.name = "SitemapPreviewWindowError";
		this.stale = stale;
	}
}

const CURSOR_VERSION = "sitemap-preview-window-v1";
const CURSOR_LIMIT = 192;
const STALE = "This sitemap file changed. Refresh the preview before continuing.";

function selection(input: SitemapPreviewWindowInput) {
	const search = input.search ?? "";
	const status = input.status ?? "all";
	const limit = input.limit ?? 25;
	const cursor = input.cursor ?? null;
	if (typeof search !== "string" || search.length > 160 || /[\u0000-\u001f\u007f]/.test(search) ||
		!["all", "included", "excluded"].includes(status) || (limit !== 25 && limit !== 50) ||
		(cursor !== null && (typeof cursor !== "string" || cursor.length === 0 || cursor.length > CURSOR_LIMIT))) {
		throw new SitemapPreviewWindowError("Choose a valid search, status and preview page size.");
	}
	return { search: search.trim(), status, limit, cursor };
}

async function fingerprint(value: unknown): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Filter only the complete current file, after its original inclusion decisions. */
export async function sitemapPreviewWindow(
	entries: readonly SeoAdminSitemapPreviewEntry[],
	snapshot: unknown,
	input: SitemapPreviewWindowInput,
) {
	if (entries.length > SITEMAP_SOURCE_PAGE_SIZE) throw new Error("The sitemap preview file exceeds its source bound.");
	const options = selection(input);
	const needle = options.search.toLowerCase();
	const digest = await fingerprint([CURSOR_VERSION, options.limit, options.status, needle, snapshot, entries]);
	const matches = entries.filter((entry) => {
		if (options.status === "included" && entry.status !== "included") return false;
		if (options.status === "excluded" && entry.status === "included") return false;
		return needle === "" || [entry.id, entry.locale, entry.path, entry.url, entry.canonical]
			.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
	});
	let offset = 0;
	if (options.cursor !== null) {
		let value: unknown;
		try { value = JSON.parse(options.cursor); } catch { throw new SitemapPreviewWindowError(STALE, true); }
		if (!Array.isArray(value) || value.length !== 3 || value[0] !== CURSOR_VERSION ||
			typeof value[1] !== "number" || !Number.isInteger(value[1]) || value[1] < 0 || value[1] > SITEMAP_SOURCE_PAGE_SIZE ||
			value[1] % options.limit !== 0 || typeof value[2] !== "string" || !/^[a-f0-9]{64}$/.test(value[2]) ||
			value[2] !== digest || (value[1] >= matches.length && value[1] !== 0)) {
			throw new SitemapPreviewWindowError(STALE, true);
		}
		offset = value[1];
	}
	const cursorAt = (position: number) => JSON.stringify([CURSOR_VERSION, position, digest]);
	const included = entries.filter((entry) => entry.status === "included").length;
	return {
		search: options.search,
		status: options.status,
		limit: options.limit,
		offset,
		total: entries.length,
		matched: matches.length,
		included,
		excluded: entries.length - included,
		entries: matches.slice(offset, offset + options.limit),
		previousCursor: offset > 0 ? cursorAt(offset - options.limit) : null,
		nextCursor: offset + options.limit < matches.length ? cursorAt(offset + options.limit) : null,
	};
}
