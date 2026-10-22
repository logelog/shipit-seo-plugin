import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";

import { taxonomyArchiveNoindexApplies } from "./taxonomy-archive-policy.ts";
import { taxonomyArchiveName, taxonomyArchivePage } from "./taxonomy-archives.ts";

const page: PublicPageContext = {
	url: "https://example.com/topics/bread", path: "/topics/bread", locale: "en",
	kind: "custom", pageType: "website", title: "Bread", description: "Bakery notes",
	canonical: "https://example.com/topics/bread", image: null,
	seo: { robots: "noarchive" }, breadcrumbs: [{ name: "Bread", url: "/topics/bread" }],
};
const before = structuredClone(page);
const archive = taxonomyArchivePage(page, "category");
assert.notEqual(archive, page);
assert.deepEqual(page, before, "Binding does not mutate the theme's page context");
assert.equal(archive.pageType, "shipit-seo:taxonomy:category");
assert.equal(taxonomyArchiveName(archive), "category");
assert.equal(archive.seo, page.seo); assert.equal(archive.breadcrumbs, page.breadcrumbs);
assert.deepEqual({ ...archive, pageType: page.pageType }, page, "Only the explicit page type changes");
assert.equal(taxonomyArchiveNoindexApplies(["category", "region"], taxonomyArchiveName(archive)), true);
assert.equal(taxonomyArchiveNoindexApplies([], taxonomyArchiveName(archive)), false);
assert.equal(taxonomyArchiveNoindexApplies(undefined, taxonomyArchiveName(archive)), false);
assert.equal(taxonomyArchiveNoindexApplies(["category"], taxonomyArchiveName(taxonomyArchivePage(page, "region"))), false);
assert.equal(taxonomyArchiveName({ ...archive, path: "/different/custom/route", url: "https://example.com/different/custom/route" }), "category",
	"Archive identity comes from the explicit binding, never the address");
assert.equal(taxonomyArchiveName({ ...page, path: "/category/bread" }), null, "A conventional URL alone grants no coverage");
for (const name of ["", " category", "category ", "category/child", "category:child", "a".repeat(65), '<script>', "café"]) {
	assert.throws(() => taxonomyArchivePage(page, name), /exact valid taxonomy name/);
	assert.equal(taxonomyArchiveName({ ...page, pageType: "shipit-seo:taxonomy:" + name }), null);
}
for (const pageType of ["website", "category", "taxonomy:category", "Shipit-seo:taxonomy:category", "shipit-seo:taxonomy:", "shipit-seo:taxonomy:category:extra"]) {
	assert.equal(taxonomyArchiveName({ ...page, pageType }), null, "Only the exact namespace is recognized");
}
for (const input of [null, [], "category", {}, { ...archive, kind: "content" },
	{ ...archive, content: { collection: "posts", id: "entry", slug: "bread" } },
	{ ...archive, content: null }, { ...archive, pageType: 42 }]) {
	assert.equal(taxonomyArchiveName(input), null);
}
assert.throws(() => taxonomyArchivePage({ ...page, kind: "content" }, "category"), /custom page without a content entry/);
assert.throws(() => taxonomyArchivePage({ ...page, content: { collection: "posts", id: "entry", slug: "bread" } }, "category"), /custom page without a content entry/);
const custom = taxonomyArchivePage({ ...page, locale: "nl", title: "Brood" }, "region");
assert.equal(custom.locale, "nl"); assert.equal(custom.title, "Brood"); assert.equal(taxonomyArchiveName(custom), "region");
assert.equal(taxonomyArchiveNoindexApplies(["category"], taxonomyArchiveName(taxonomyArchivePage(page, "Category"))), false,
	"Taxonomy identity remains exact and case-preserving");
console.log("Taxonomy archive binding checks passed (explicit context, exact names and content isolation).");
