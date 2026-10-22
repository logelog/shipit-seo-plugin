import assert from "node:assert/strict";

import { sitemapChildPath } from "../sitemap-engine.ts";
import { publicLinkText, sitemapFileLinks, sitemapFileUrl, sitemapPlanSummary, sitemapPreviewSelection, sitemapUrlParts } from "./sitemap-view-model.ts";

const three = { collection: "posts", files: [null, "01B", "01D"] };
const one = { collection: "posts", files: [null] };
const pages = { collection: "pages", files: [null, "02B"] };

const last = sitemapPreviewSelection([three, pages], { collection: "posts", fileIndex: 2 })!;
assert.deepEqual([last.index, last.after, last.count, last.next], [2, "01D", 3, null]);
assert.deepEqual(last.previous, { collection: "posts", fileIndex: 1 });

// The collection shrinks to one file: shown, fetched and paged as file 1.
const shrunk = sitemapPreviewSelection([one, pages], { collection: "posts", fileIndex: 2 })!;
assert.deepEqual([shrunk.index, shrunk.after, shrunk.previous, shrunk.next], [0, null, null, null],
	"a stale position needs no extra Previous clicks");

// The collection leaves the plan: the fallback starts at its first file.
const switched = sitemapPreviewSelection([pages], { collection: "posts", fileIndex: 2 })!;
assert.deepEqual([switched.collection, switched.index, switched.after, switched.previous], ["pages", 0, null, null]);
assert.deepEqual(switched.next, { collection: "pages", fileIndex: 1 });

// Moving from a clamped position continues from what was shown.
const fromClamped = sitemapPreviewSelection([three], sitemapPreviewSelection([three], { collection: "posts", fileIndex: 9 })!.previous!)!;
assert.equal(fromClamped.index, 1);

assert.equal(sitemapPreviewSelection([{ collection: "posts", files: [] }], { collection: "posts", fileIndex: 0 }), null);
assert.equal(sitemapPreviewSelection([three], { collection: null, fileIndex: -4 })!.index, 0);

// File links use the engine's own child path, so the Sitemaps page links the files the index lists.
for (const after of [null, "01B", "a&b c"]) {
	assert.equal(sitemapFileUrl("https://example.com", "posts", after), `https://example.com${sitemapChildPath("posts", after)}`);
}
assert.deepEqual(sitemapFileLinks("https://example.com", three), {
	urls: ["https://example.com/sitemap-posts.xml", "https://example.com/sitemap-posts.xml?after=01B", "https://example.com/sitemap-posts.xml?after=01D"], more: 0,
});
assert.deepEqual(sitemapFileLinks("https://example.com", three, 1), { urls: ["https://example.com/sitemap-posts.xml"], more: 2 });
assert.deepEqual(sitemapFileLinks(null, three), { urls: [], more: 0 }, "no origin, no links");
assert.deepEqual(sitemapFileLinks("https://example.com", undefined), { urls: [], more: 0 }, "an unplanned type has no links");

// The type summary counts published entries considered, not entries listed: noindex,
// excluded and canonical-elsewhere entries are counted but left out of the file.
assert.equal(sitemapPlanSummary({ candidates: 16, files: [null] }), "1 file from 16 published entries");
assert.equal(sitemapPlanSummary({ candidates: 1, files: [null] }), "1 file from 1 published entry");
assert.equal(sitemapPlanSummary({ candidates: 1200, files: [null, "a", "b"] }), "3 files from 1,200 published entries");
assert.doesNotMatch(sitemapPlanSummary({ candidates: 16, files: [null] }), /16 published entries in/, "the count is never presented as the listed entries");
assert.deepEqual(sitemapUrlParts("http://localhost:4401/sitemap.xml"), ["http://", "localhost:4401/", "sitemap.xml"]);
assert.equal(sitemapUrlParts("https://example.com/sitemap-posts.xml?after=01B").join(""), "https://example.com/sitemap-posts.xml?after=01B");
// The link icon stays with the last character, so a wrapped address keeps it beside its text.
assert.deepEqual(publicLinkText("https://example.com/sitemap.xml", true), { parts: ["https://", "example.com/", "sitemap.xm"], end: "l" });
assert.deepEqual(publicLinkText("Open this public file", false), { parts: ["Open this public fil"], end: "e" });
for (const [text, address] of [["https://example.com/sitemap-posts.xml?after=01B", true], ["/sitemap-pages.xml", false], ["x", false], ["", true]] as const) {
	const { parts, end } = publicLinkText(text, address);
	assert.equal(parts.join("") + end, text, "the visible text is unchanged");
}

// A 50,000-entry plan remains directly addressable without walking each file.
const hundredFiles = { collection: "posts", files: [null, ...Array.from({ length: 99 }, (_, index) => `after-${index + 1}`)] };
const jump = sitemapPreviewSelection([hundredFiles], { collection: "posts", fileIndex: 99 })!;
assert.deepEqual([jump.index, jump.after, jump.count, jump.next], [99, "after-99", 100, null]);
assert.deepEqual(jump.previous, { collection: "posts", fileIndex: 98 });

console.log("Sitemap preview selection self-check passed.");
