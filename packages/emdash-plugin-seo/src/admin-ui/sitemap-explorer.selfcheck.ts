import assert from "node:assert/strict";
import type { SeoAdminSitemapPreviewRequest } from "../admin-contract.ts";
import {
	filterSitemapExplorer, initialSitemapExplorerFilters, pageSitemapExplorer,
	sitemapExplorerRequest, sitemapPreviewDisplay, sitemapPreviewMatches,
	sitemapPreviewReadDenied, sitemapPreviewRowsLabel, sitemapPreviewScope, sitemapPreviewSelection,
	type SitemapPreviewSuccess,
} from "./sitemap-view-model.ts";

const plans = [{ collection: "posts", files: [null, "after-500"] }, { collection: "pages", files: [null] }];
const first = sitemapPreviewSelection(plans, { collection: "posts", fileIndex: 0 })!;
const second = sitemapPreviewSelection(plans, { collection: "posts", fileIndex: 1 })!;
const scope = sitemapPreviewScope("revision-1", first);
const base = initialSitemapExplorerFilters();
const request = sitemapExplorerRequest(first, scope, base);
assert.deepEqual(request, { collection: "posts", after: null, search: "", status: "all", limit: 25, cursor: null });

// Row paging never moves to the next public file. File/settings changes discard its cursor.
const paged = pageSitemapExplorer(base, scope, "rows-25");
assert.equal(sitemapExplorerRequest(first, scope, paged).cursor, "rows-25");
assert.equal(sitemapExplorerRequest(second, sitemapPreviewScope("revision-1", second), paged).cursor, null);
assert.equal(sitemapExplorerRequest(first, sitemapPreviewScope("revision-2", first), paged).cursor, null);
assert.equal(sitemapExplorerRequest(first, scope, paged).after, null);
for (const patch of [{ search: "/literal?x=%25" }, { status: "excluded" as const }, { limit: 50 as const }]) {
	const next = filterSitemapExplorer(paged, patch);
	assert.equal(next.cursor, null, "a changed filter starts at its first row");
	assert.equal(next.cursorScope, null);
}
const searched = filterSitemapExplorer(base, { search: "/literal?x=%25", status: "excluded", limit: 50 });
assert.deepEqual(sitemapExplorerRequest(first, scope, searched), {
	collection: "posts", after: null, search: "/literal?x=%25", status: "excluded", limit: 50, cursor: null,
}, "literal search is preserved instead of interpreting URL punctuation");

function resultFor(input: SeoAdminSitemapPreviewRequest, offset = 0): SitemapPreviewSuccess {
	return {
		success: true, collection: input.collection, after: input.after,
		fileUrl: "https://example.com/sitemap-posts.xml", included: 480, excluded: 20, total: 500,
		matched: input.search ? 12 : input.status === "excluded" ? 20 : input.status === "included" ? 480 : 500, search: input.search ?? "", status: input.status ?? "all", limit: input.limit ?? 25,
		offset, previousCursor: offset > 0 ? "rows-previous" : null, nextCursor: "rows-next",
		entries: Array.from({ length: Math.min(input.limit ?? 25, (input.search ? 12 : input.status === "excluded" ? 20 : input.status === "included" ? 480 : 500) - offset) }, (_, index) => ({
			id: `entry-${offset + index}`, locale: "en", status: "included", path: `/posts/${offset + index}`,
			url: `https://example.com/posts/${offset + index}`, lastmod: null, image: null, canonical: null, alternates: 0,
		})),
	};
}
const previous = resultFor(request, 25);
assert.equal(sitemapPreviewMatches(request, previous), true);
assert.equal(sitemapPreviewRowsLabel(previous), "Rows 26-50 of 500 matching entries · All statuses");
assert.equal(previous.included + previous.excluded, previous.total, "whole-file counts differ from the row/page count");
assert.equal(sitemapPreviewDisplay(request, previous, null, false)?.stale, false);

// A response from an earlier filter is not presented as a new, pending search.
const nextRequest = sitemapExplorerRequest(first, scope, searched);
assert.equal(sitemapPreviewMatches(nextRequest, previous), false);
assert.equal(sitemapPreviewDisplay(nextRequest, previous, previous, false), null);
assert.equal(sitemapPreviewDisplay(nextRequest, undefined, previous, false), null);

// When a cursor expires, keep the same file's earlier rows and their actual label.
const expired = { success: false as const, errors: { _form: "This preview changed. Refresh the first page." }, stale: true as const };
const retained = sitemapPreviewDisplay(nextRequest, expired, previous, true)!;
assert.equal(retained.stale, true);
assert.equal(retained.result, previous);
assert.equal(sitemapPreviewRowsLabel(retained.result), "Rows 26-50 of 500 matching entries · All statuses");
assert.doesNotMatch(sitemapPreviewRowsLabel(retained.result), /literal|Left out/, "earlier rows never inherit pending controls' labels");
assert.equal(sitemapPreviewDisplay(request, previous, previous, true)?.stale, true, "a failed refetch marks cached rows stale");
assert.equal(sitemapPreviewReadDenied({ status: 401 }), true);
assert.equal(sitemapPreviewReadDenied({ status: 403 }), true);
assert.equal(sitemapPreviewReadDenied({ status: 503 }), false);
assert.equal(sitemapPreviewDisplay(request, previous, previous, true, true), null, "permission loss hides even cached rows");
const differentFile = sitemapExplorerRequest(second, sitemapPreviewScope("revision-1", second), base);
assert.equal(sitemapPreviewDisplay(differentFile, expired, previous, true), null, "a failed file switch cannot display another file's table");
const differentType = { ...request, collection: "pages" };
assert.equal(sitemapPreviewDisplay(differentType, undefined, previous, true), null);

const fresh = resultFor(nextRequest);
assert.equal(sitemapPreviewDisplay(nextRequest, fresh, previous, false)?.stale, false);
assert.equal(sitemapPreviewRowsLabel(fresh), "Rows 1-12 of 12 matching entries · Left out · Search: “/literal?x=%25”");
const empty = { ...fresh, matched: 0, entries: [], nextCursor: null };
assert.equal(sitemapPreviewRowsLabel(empty), "Rows 0 of 0 matching entries · Left out · Search: “/literal?x=%25”");

console.log("Sitemap explorer pagination and stale-result self-check passed.");
