import assert from "node:assert/strict";

import {
	normalizeRenderedCrawlUrl,
	runSeoRenderedCrawl,
	type SeoRenderedCrawlDocument,
} from "./rendered-crawl.ts";

const origin = "https://example.com";

assert.equal(normalizeRenderedCrawlUrl("/about?campaign=test#team", origin), "https://example.com/about");
assert.equal(normalizeRenderedCrawlUrl("https://example.com/about/", origin), "https://example.com/about");
assert.equal(normalizeRenderedCrawlUrl("//example.com/about", origin), "https://example.com/about");
assert.equal(
	normalizeRenderedCrawlUrl("//localhost:4321/about", "http://localhost:4321"),
	"http://localhost:4321/about",
);
assert.equal(normalizeRenderedCrawlUrl("https://other.example/about", origin), null);
assert.equal(normalizeRenderedCrawlUrl("javascript:alert(1)", origin), null);
assert.equal(normalizeRenderedCrawlUrl("/assets/report.pdf", origin), null);
assert.equal(normalizeRenderedCrawlUrl("/_emdash/admin", origin), null);

function document(overrides: Partial<SeoRenderedCrawlDocument> = {}): SeoRenderedCrawlDocument {
	return {
		title: "A useful page",
		titleCount: 1,
		description: "A complete rendered description.",
		canonical: "https://example.com/",
		robots: "index, follow",
		h1Count: 1,
		ogTitle: "A useful page",
		ogDescription: "A complete rendered description.",
		ogImage: "https://example.com/og.png",
		ogUrl: "https://example.com/",
		links: [],
		...overrides,
	};
}

function response(
	body: string,
	status: number,
	url: string,
	options: { redirected?: boolean; contentType?: string } = {},
): Response {
	const value = new Response(body, {
		status,
		headers: { "content-type": options.contentType ?? "text/html; charset=utf-8" },
	});
	Object.defineProperty(value, "url", { value: url });
	Object.defineProperty(value, "redirected", { value: options.redirected ?? false });
	return value;
}

const fetcher = async (url: string): Promise<Response> => {
	const path = new URL(url).pathname;
	if (path === "/sitemap.xml") return response("sitemap", 200, url, { contentType: "application/xml" });
	if (path === "/") return response("home", 200, url);
	if (path === "/about") return response("about", 200, `${origin}/about-us`, { redirected: true });
	if (path === "/hidden") return response("hidden", 200, url);
	if (path === "/missing") return response("missing", 404, url);
	throw new Error(`Unexpected request: ${url}`);
};

const parseHtml = (_html: string, url: string): SeoRenderedCrawlDocument => {
	const path = new URL(url).pathname;
	if (path === "/") return document({ links: [`${origin}/about`, `${origin}/hidden`, `${origin}/missing`] });
	if (path === "/about-us") return document({ canonical: `${origin}/about-us`, ogUrl: `${origin}/about-us` });
	if (path === "/hidden") return document({
		canonical: `${origin}/hidden`,
		ogUrl: `${origin}/hidden`,
		description: "",
	});
	return document();
};

const report = await runSeoRenderedCrawl({
	origin,
	fetcher,
	parseHtml,
	parseSitemap: () => ({
		pageUrls: [`${origin}/`, `${origin}/about`, `${origin}/missing`],
		sitemapUrls: [],
	}),
	now: () => "2026-07-17T10:00:00.000Z",
});

assert.equal(report.generatedAt, "2026-07-17T10:00:00.000Z");
assert.equal(report.coverage, "complete");
assert.equal(report.summary.sitemapPages, 3);
assert.equal(report.summary.crawledPages, 4);
assert.equal(report.summary.brokenPages, 1);
assert.equal(report.summary.redirects, 1);
assert.equal(report.findings.some((item) => item.code === "page-http-error" && item.path === "/missing"), true);
assert.equal(report.findings.some((item) => item.code === "page-redirect" && item.target === "/about-us"), true);
assert.equal(report.findings.some((item) => item.code === "page-not-in-sitemap" && item.path === "/hidden"), true);
assert.equal(report.findings.some((item) => item.code === "description-missing" && item.path === "/hidden"), true);
assert.deepEqual(
	report.findings.find((item) => item.code === "page-http-error")?.sources,
	["/"],
);

const limited = await runSeoRenderedCrawl({
	origin,
	fetcher,
	parseHtml,
	parseSitemap: () => ({
		pageUrls: [`${origin}/`, `${origin}/about`, `${origin}/missing`],
		sitemapUrls: [],
	}),
	maxPages: 2,
});
assert.equal(limited.coverage, "limited");
assert.equal(limited.limits.reachedPageLimit, true);
assert.equal(limited.summary.crawledPages, 2);

const oversized = await runSeoRenderedCrawl({
	origin,
	fetcher: async (url) => {
		if (new URL(url).pathname === "/sitemap.xml") {
			return response("sitemap", 200, url, { contentType: "application/xml" });
		}
		return response("x".repeat(2_048), 200, url);
	},
	parseHtml,
	parseSitemap: () => ({ pageUrls: [`${origin}/`], sitemapUrls: [] }),
	maxPageBytes: 1_024,
});
assert.equal(oversized.coverage, "limited");
assert.equal(oversized.summary.brokenPages, 1);
assert.equal(oversized.findings.some((item) => item.code === "page-too-large"), true);

const boundedEdges = await runSeoRenderedCrawl({
	origin,
	fetcher: async (url) => response("body", 200, url, { contentType: new URL(url).pathname === "/sitemap.xml" ? "application/xml" : "text/html" }),
	parseSitemap: () => ({ pageUrls: [`${origin}/`], sitemapUrls: [] }),
	parseHtml: () => document({ links: Array.from({ length: 501 }, (_, index) => `${origin}/linked-${index}`) }),
	maxPages: 1,
});
assert.equal(boundedEdges.coverage, "limited");
assert.equal(boundedEdges.limits.reachedLinkLimit, true);
assert.equal(boundedEdges.limits.scannedLinks, 500);
assert.equal(boundedEdges.pages[0]?.document?.links.length, 500);
const totalEdges = await runSeoRenderedCrawl({
	origin,
	fetcher: async (url) => response("body", 200, url),
	parseSitemap: () => ({ pageUrls: Array.from({ length: 50 }, (_, index) => `${origin}/${index}`), sitemapUrls: [] }),
	parseHtml: (_html, url) => document({ canonical: url, links: Array.from({ length: 500 }, (_, index) => `${origin}/${index}`) }),
});
assert.equal(totalEdges.limits.scannedLinks, 20_000);
assert.equal(totalEdges.pages.reduce((sum, page) => sum + (page.document?.links.length ?? 0), 0), 20_000);
assert.equal(totalEdges.limits.reachedLinkLimit, true);
assert.equal(totalEdges.coverage, "limited");
const alreadyCancelled = new AbortController();
alreadyCancelled.abort();
let unexpectedRequests = 0;
await assert.rejects(runSeoRenderedCrawl({ origin, signal: alreadyCancelled.signal, fetcher: async () => { unexpectedRequests += 1; throw new Error("Must not fetch"); } }), { name: "AbortError" });
assert.equal(unexpectedRequests, 0);
const cancelling = new AbortController();
const cancelledPaths: string[] = [];
await assert.rejects(runSeoRenderedCrawl({
	origin,
	signal: cancelling.signal,
	concurrency: 1,
	fetcher: async (url, init) => {
		cancelledPaths.push(new URL(url).pathname);
		assert.ok(init?.signal);
		if (new URL(url).pathname === "/sitemap.xml") return response("sitemap", 200, url);
		return new Promise<Response>((_resolve, reject) => {
			init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
			cancelling.abort();
		});
	},
	parseSitemap: () => ({ pageUrls: [`${origin}/`, `${origin}/must-not-run`], sitemapUrls: [] }),
}), { name: "AbortError" });
assert.deepEqual(cancelledPaths, ["/sitemap.xml", "/"]);
console.log("Rendered SEO crawl self-check passed.");
