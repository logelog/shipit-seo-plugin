import assert from "node:assert/strict";
import type { SeoAdminSitemapPreviewEntry } from "./admin-contract.ts";
import { SitemapPreviewWindowError, sitemapPreviewWindow } from "./sitemap-preview-window.ts";

const entries: SeoAdminSitemapPreviewEntry[] = Array.from({ length: 55 }, (_, index) => ({
	id: String(index).padStart(3, "0"), locale: "en", status: index % 5 === 0 ? "noindex" : "included",
	path: `/posts/entry-${index}`, url: `https://example.com/posts/entry-${index}`,
	lastmod: "2026-10-01T10:00:00.000Z", image: null, canonical: null, alternates: 0,
}));
entries[54] = { ...entries[54], path: "/posts/%_literal", url: "https://example.com/posts/%_literal" };
const snapshot = { collection: "posts", after: null, revision: "r1", alternate: "https://example.com/fr/entry" };
const first = await sitemapPreviewWindow(entries, snapshot, {});
assert.deepEqual([first.total, first.matched, first.included, first.excluded, first.limit, first.offset], [55, 55, 44, 11, 25, 0]);
assert.deepEqual(first.entries, entries.slice(0, 25));
assert.equal(first.previousCursor, null);
assert.ok(first.nextCursor && first.nextCursor.length <= 192);
const second = await sitemapPreviewWindow(entries, snapshot, { cursor: first.nextCursor });
assert.deepEqual(second.entries, entries.slice(25, 50));
assert.equal(second.offset, 25);
const third = await sitemapPreviewWindow(entries, snapshot, { cursor: second.nextCursor });
assert.deepEqual(third.entries, entries.slice(50));
assert.equal(third.nextCursor, null);
const back = await sitemapPreviewWindow(entries, snapshot, { cursor: second.previousCursor });
assert.deepEqual(back.entries, first.entries);
const fifty = await sitemapPreviewWindow(entries, snapshot, { limit: 50 });
assert.equal(fifty.entries.length, 50);
assert.equal((await sitemapPreviewWindow(entries, snapshot, { limit: 50, cursor: fifty.nextCursor })).entries.length, 5);

const included = await sitemapPreviewWindow(entries, snapshot, { status: "included" });
assert.deepEqual([included.matched, included.total, included.included, included.excluded], [44, 55, 44, 11]);
assert.ok(included.entries.every((entry) => entry.status === "included"));
const excluded = await sitemapPreviewWindow(entries, snapshot, { status: "excluded" });
assert.deepEqual(excluded.entries, entries.filter((entry) => entry.status !== "included"));
assert.equal(excluded.matched, 11);
assert.equal((await sitemapPreviewWindow(entries, snapshot, { search: " %_LITERAL " })).matched, 1, "percent and underscore are literal search text");
assert.equal((await sitemapPreviewWindow(entries, snapshot, { search: "entry-999" })).matched, 0);
const empty = await sitemapPreviewWindow([], snapshot, {});
assert.deepEqual([empty.total, empty.matched, empty.included, empty.excluded, empty.previousCursor, empty.nextCursor], [0, 0, 0, 0, null, null]);
const searched = await sitemapPreviewWindow(entries, snapshot, { search: "ENTRY" });
const normalized = await sitemapPreviewWindow(entries, snapshot, { search: " entry ", cursor: searched.nextCursor });
assert.equal(normalized.offset, 25, "equivalent literal search spelling keeps its cursor");

const stale = (action: () => Promise<unknown>) => assert.rejects(action, (error: unknown) => error instanceof SitemapPreviewWindowError && error.stale);
await stale(() => sitemapPreviewWindow(entries, { ...snapshot, revision: "r2" }, { cursor: first.nextCursor }));
await stale(() => sitemapPreviewWindow(entries, { ...snapshot, collection: "pages" }, { cursor: first.nextCursor }));
await stale(() => sitemapPreviewWindow(entries, { ...snapshot, after: "other-file" }, { cursor: first.nextCursor }));
await stale(() => sitemapPreviewWindow(entries, { ...snapshot, alternate: "https://example.com/fr/changed" }, { cursor: first.nextCursor }));
const changed = entries.map((entry, index) => index === 54 ? { ...entry, canonical: "https://example.com/changed" } : entry);
await stale(() => sitemapPreviewWindow(changed, snapshot, { cursor: first.nextCursor }));
await stale(() => sitemapPreviewWindow(entries, snapshot, { search: "entry", cursor: first.nextCursor }));
await stale(() => sitemapPreviewWindow(entries, snapshot, { status: "included", cursor: first.nextCursor }));
await stale(() => sitemapPreviewWindow(entries, snapshot, { limit: 50, cursor: first.nextCursor }));
for (const cursor of ["not-json", "null", "[]", "{}", JSON.stringify(["other", 25, "0".repeat(64)]),
	JSON.stringify(["sitemap-preview-window-v1", -25, "0".repeat(64)]),
	JSON.stringify(["sitemap-preview-window-v1", 26, "0".repeat(64)]),
	JSON.stringify(["sitemap-preview-window-v1", 525, "0".repeat(64)])]) {
	await stale(() => sitemapPreviewWindow(entries, snapshot, { cursor }));
}
for (const input of [{ search: "x".repeat(161) }, { search: "bad\nsearch" }, { limit: 26 }, { status: "draft" }, { cursor: "x".repeat(193) }]) {
	await assert.rejects(sitemapPreviewWindow(entries, snapshot, input as never), SitemapPreviewWindowError);
}
await assert.rejects(sitemapPreviewWindow(Array.from({ length: 501 }, () => entries[0]), snapshot, {}), /source bound/);
console.log("Sitemap preview windows preserve file-local decisions and counts, page25/50, literal filters and snapshot-bound continuation.");
