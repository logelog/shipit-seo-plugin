import { strict as assert } from "node:assert";

import {
	SEO_CRAWL_DIAGNOSTICS_VERSION,
	SEO_CRAWL_LIMITS,
	extractSeoCrawlLinks,
	analyzeSeoCrawlGraph,
	isCrawlDocumentRoute,
	normalizeCrawlRoute,
	type SeoCrawlEntryInput,
} from "./crawl-diagnostics.ts";

const entries: SeoCrawlEntryInput[] = [
	{
		ref: "pages:home",
		collection: "pages",
		entryId: "home",
		title: "Home",
		url: "https://example.com/",
		indexable: true,
		structured: true,
		links: [
			{ href: "/services/seo", text: "SEO services" },
			{ href: "/blog/missing?campaign=private#top", text: "Missing article" },
			{ href: "https://outside.example/research", text: "Research" },
			{ href: "/assets/guide.pdf", text: "Guide" },
		],
	},
	{
		ref: "services:seo",
		collection: "services",
		entryId: "seo",
		title: "SEO",
		url: "https://example.com/services/seo/",
		indexable: true,
		structured: true,
		links: [{ href: "../../blog/authority", text: "Authority guide" }],
	},
	{
		ref: "posts:authority",
		collection: "posts",
		entryId: "authority",
		title: "Authority",
		url: "https://example.com/blog/authority",
		indexable: true,
		structured: true,
		links: [],
	},
	{
		ref: "pages:about",
		collection: "pages",
		entryId: "about",
		title: "About",
		url: "https://example.com/about",
		indexable: true,
		bodySource: "template",
		structured: false,
		links: [],
	},
	{
		ref: "pages:private",
		collection: "pages",
		entryId: "private",
		title: "Private",
		url: "https://example.com/private",
		indexable: false,
		structured: true,
		links: [],
	},
];

assert.equal(normalizeCrawlRoute("/services//seo/?utm=private#top"), "/services/seo");
assert.equal(normalizeCrawlRoute("../contact", "https://example.com/services/seo"), "/contact");
assert.equal(normalizeCrawlRoute("https://outside.example/page", "https://example.com/source"), null);
assert.equal(normalizeCrawlRoute("https://[invalid", "https://example.com/source"), null);
assert.equal(normalizeCrawlRoute("#section", "https://example.com/source"), null);
assert.equal(isCrawlDocumentRoute("/_emdash/admin"), false);
assert.equal(isCrawlDocumentRoute("/assets/guide.pdf"), false);

const result = analyzeSeoCrawlGraph(entries);
assert.equal(result.diagnosticsVersion, SEO_CRAWL_DIAGNOSTICS_VERSION);
assert.equal(result.coverage, "partial");
assert.equal(result.summary.scannedEntries, 5);
assert.equal(result.summary.indexableEntries, 4);
assert.equal(result.summary.matchedInternalLinks, 2);
assert.equal(result.summary.unresolvedInternalLinks, 1);
assert.equal(result.unresolvedLinks[0]?.targetPath, "/blog/missing");
assert.equal(result.unresolvedLinks[0]?.anchorText, "Missing article");
assert.deepEqual(result.orphanEntries.map((item) => item.ref), ["pages:about"]);
assert.equal(result.orphanEntries[0]?.confidence, "review");
assert.equal(result.orphanEntries.some((item) => item.ref === "pages:private"), false);

const complete = analyzeSeoCrawlGraph(entries.filter((entry) => entry.ref !== "pages:about"));
assert.equal(complete.coverage, "complete");

const detached: SeoCrawlEntryInput = {
	ref: "pages:detached",
	collection: "pages",
	entryId: "detached",
	title: "Detached",
	url: "https://example.com/detached",
	indexable: true,
	structured: true,
	links: [],
};
const completeDetached = analyzeSeoCrawlGraph([detached]);
assert.equal(completeDetached.coverage, "complete");
assert.equal(completeDetached.orphanEntries[0]?.confidence, "high");
const limited = analyzeSeoCrawlGraph([detached], ["/"], true);
assert.equal(limited.coverage, "partial");
assert.equal(limited.orphanEntries[0]?.confidence, "review");

const hugeGraph = analyzeSeoCrawlGraph(Array.from({ length: 1_001 }, (_, index) => ({ ...detached, ref: `pages:${index}`, entryId: String(index), url: `https://example.com/page-${index}` })));
assert.equal(hugeGraph.summary.scannedEntries, 1_000);
assert.equal(hugeGraph.limits.reachedEntryLimit, true);
assert.equal(hugeGraph.summary.possibleOrphans, 1_000);
assert.equal(hugeGraph.orphanEntries.length, 250);
assert.equal(hugeGraph.limits.orphanEntriesOmitted, 750);
assert.equal(hugeGraph.coverage, "partial");
assert.ok(hugeGraph.orphanEntries.every((item) => item.confidence === "review"));
const hugeLinks = analyzeSeoCrawlGraph([{ ...detached, links: Array.from({ length: 20_001 }, (_, index) => ({ href: `/missing-${index}`, text: "x".repeat(1_000) })) }]);
assert.equal(hugeLinks.summary.scannedLinks, SEO_CRAWL_LIMITS.maxLinks);
assert.equal(hugeLinks.summary.unresolvedInternalLinks, 20_000);
assert.equal(hugeLinks.unresolvedLinks.length, 250);
assert.equal(hugeLinks.limits.unresolvedLinksOmitted, 19_750);
assert.equal(hugeLinks.limits.reachedLinkLimit, true);
assert.equal(hugeLinks.unresolvedLinks[0]?.anchorText.length, 512);
assert.equal(hugeLinks.coverage, "partial");
const portable = [{ _type: "block", markDefs: [{ _key: "a", _type: "link", href: "/one" }], children: [{ _type: "span", text: "First", marks: ["a"] }, { _type: "span", text: "link", marks: ["a"] }] }];
const before = structuredClone(portable);
const portableResult = extractSeoCrawlLinks(portable);
assert.deepEqual(portableResult.links, [{ href: "/one", text: "First link" }]);
assert.equal(portableResult.structured, true);
assert.equal(portableResult.limited, false);
assert.deepEqual(portable, before);
const tiptap = extractSeoCrawlLinks({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Read", marks: [{ type: "link", attrs: { href: "/two" } }] }] }] });
assert.deepEqual(tiptap.links, [{ href: "/two", text: "Read" }]);
assert.equal(tiptap.structured, true);
assert.equal(extractSeoCrawlLinks("plain text").structured, false);
const boundedDocument = extractSeoCrawlLinks(Array.from({ length: 100_000 }, () => ({ type: "paragraph", content: [] })), { maxNodes: 25 });
assert.equal(boundedDocument.scannedNodes, 25);
assert.equal(boundedDocument.limited, true);
const boundedLinks = extractSeoCrawlLinks([{ type: "link", attrs: { href: "/one" }, text: "One" }, { type: "link", href: "/two", text: "Two" }], { maxLinks: 1 });
assert.deepEqual(boundedLinks.links, [{ href: "/one", text: "One" }]);
assert.equal(boundedLinks.limited, true);
assert.equal(extractSeoCrawlLinks(portable, { maxNodes: 0 }).limited, true);
assert.equal(extractSeoCrawlLinks(portable, { maxNodes: NaN }).limited, false);
const cyclic: { type: string; content: unknown[] } = { type: "doc", content: [] };
cyclic.content.push(cyclic);
assert.equal(extractSeoCrawlLinks(cyclic, { maxNodes: 50 }).scannedNodes, 50);
assert.equal(extractSeoCrawlLinks(cyclic, { maxNodes: 50 }).limited, true);
assert.equal(extractSeoCrawlLinks({ type: "link", href: "/" + "x".repeat(2_048) }).limited, true);
console.log("SEO crawl diagnostics self-check passed.");
