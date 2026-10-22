export const SEO_RENDERED_CRAWL_VERSION = 1 as const;

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_SITEMAPS = 10;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_PAGE_BYTES = 2_000_000;
const DEFAULT_MAX_SITEMAP_BYTES = 5_000_000;
const MAX_LINKS_PER_PAGE = 500;
const MAX_TOTAL_LINKS = 20_000;
const NON_DOCUMENT_EXTENSION = /\.(?:avif|bmp|css|csv|eot|gif|ico|jpe?g|js|json|map|mp3|mp4|ogg|pdf|png|svg|tar|tiff?|ttf|txt|web[mp]|woff2?|xml|zip)$/i;
const IGNORED_ROUTE_PREFIXES = ["/_emdash", "/api", "/.well-known"];

export type SeoRenderedCrawlSeverity = "error" | "warning" | "notice";
export type SeoRenderedCrawlFindingCode =
	| "sitemap-fetch-failed"
	| "sitemap-http-error"
	| "sitemap-invalid"
	| "sitemap-too-large"
	| "page-fetch-failed"
	| "page-http-error"
	| "page-too-large"
	| "page-redirect"
	| "page-non-html"
	| "page-not-in-sitemap"
	| "title-missing"
	| "title-duplicate"
	| "description-missing"
	| "canonical-missing"
	| "canonical-invalid"
	| "canonical-mismatch"
	| "robots-noindex"
	| "h1-missing"
	| "h1-multiple"
	| "open-graph-incomplete";

export interface SeoRenderedCrawlDocument {
	title: string;
	titleCount: number;
	description: string;
	canonical: string;
	robots: string;
	h1Count: number;
	ogTitle: string;
	ogDescription: string;
	ogImage: string;
	ogUrl: string;
	links: string[];
	linksLimited?: boolean;
}

export interface SeoRenderedSitemapDocument {
	pageUrls: string[];
	sitemapUrls: string[];
}

export interface SeoRenderedCrawlPage {
	requestedUrl: string;
	requestedPath: string;
	finalUrl: string;
	finalPath: string;
	status: number;
	redirected: boolean;
	contentType: string;
	fromSitemap: boolean;
	sources: string[];
	document: SeoRenderedCrawlDocument | null;
	errorCode: "page-fetch-failed" | "page-too-large" | null;
	error: string | null;
}

export interface SeoRenderedCrawlFinding {
	id: string;
	code: SeoRenderedCrawlFindingCode;
	severity: SeoRenderedCrawlSeverity;
	path: string;
	target: string | null;
	detail: string;
	sources: string[];
}

export interface SeoRenderedCrawlReport {
	version: typeof SEO_RENDERED_CRAWL_VERSION;
	generatedAt: string;
	origin: string;
	coverage: "complete" | "limited";
	summary: {
		sitemapPages: number;
		crawledPages: number;
		healthyPages: number;
		brokenPages: number;
		redirects: number;
		metadataIssues: number;
		warnings: number;
	};
	limits: {
		maxPages: number;
		maxSitemaps: number;
		maxPageBytes: number;
		maxSitemapBytes: number;
		reachedPageLimit: boolean;
		reachedSitemapLimit: boolean;
		sitemapDocuments: number;
		maxLinksPerPage: number;
		maxTotalLinks: number;
		scannedLinks: number;
		reachedLinkLimit: boolean;
	};
	pages: SeoRenderedCrawlPage[];
	findings: SeoRenderedCrawlFinding[];
}

export interface RunSeoRenderedCrawlOptions {
	origin: string;
	signal?: AbortSignal;
	fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
	parseHtml?: (html: string, url: string) => SeoRenderedCrawlDocument;
	parseSitemap?: (xml: string, url: string) => SeoRenderedSitemapDocument;
	maxPages?: number;
	maxSitemaps?: number;
	concurrency?: number;
	timeoutMs?: number;
	maxPageBytes?: number;
	maxSitemapBytes?: number;
	now?: () => string;
}

interface CrawlSeed {
	fromSitemap: boolean;
	sources: Set<string>;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.trunc(value ?? fallback)));
}

function cleanText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePathname(pathname: string): string {
	const compact = pathname.replace(/\/{2,}/g, "/");
	if (compact === "/") return compact;
	return compact.replace(/\/+$/, "") || "/";
}

function routeIsIgnored(pathname: string): boolean {
	return IGNORED_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function normalizeSameOriginUrl(
	value: unknown,
	origin: string,
	baseUrl: string,
	allowDocumentOnly: boolean,
): string | null {
	if (typeof value !== "string") return null;
	const input = value.trim();
	if (!input || input.startsWith("#") || /^(?:mailto|tel|sms|javascript|data):/i.test(input)) return null;
	try {
		const url = new URL(input, baseUrl);
		if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) return null;
		if (url.username || url.password) return null;
		url.pathname = normalizePathname(url.pathname);
		url.search = "";
		url.hash = "";
		if (routeIsIgnored(url.pathname)) return null;
		if (allowDocumentOnly && NON_DOCUMENT_EXTENSION.test(url.pathname)) return null;
		return url.href;
	} catch {
		return null;
	}
}

export function normalizeRenderedCrawlUrl(value: unknown, origin: string, baseUrl = origin): string | null {
	let normalizedOrigin: string;
	try {
		const parsed = new URL(origin);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		normalizedOrigin = parsed.origin;
	} catch {
		return null;
	}
	return normalizeSameOriginUrl(value, normalizedOrigin, baseUrl, true);
}

function normalizeSitemapUrl(value: unknown, origin: string, baseUrl: string): string | null {
	return normalizeSameOriginUrl(value, origin, baseUrl, false);
}

function directChildText(element: Element, localName: string): string {
	for (const child of Array.from(element.children)) {
		if (child.localName === localName) return cleanText(child.textContent);
	}
	return "";
}

export function parseRenderedSitemap(xml: string, sitemapUrl: string): SeoRenderedSitemapDocument {
	const document = new DOMParser().parseFromString(xml, "application/xml");
	if (document.getElementsByTagName("parsererror").length > 0) {
		throw new Error(`Invalid sitemap XML at ${new URL(sitemapUrl).pathname}`);
	}
	const pageUrls = Array.from(document.getElementsByTagNameNS("*", "url"))
		.map((entry) => directChildText(entry, "loc"))
		.filter(Boolean);
	const sitemapUrls = Array.from(document.getElementsByTagNameNS("*", "sitemap"))
		.map((entry) => directChildText(entry, "loc"))
		.filter(Boolean);
	return { pageUrls, sitemapUrls };
}

function metaContent(document: Document, selector: string): string {
	return cleanText(document.querySelector<HTMLMetaElement>(selector)?.content);
}

export function parseRenderedHtml(html: string, documentUrl: string): SeoRenderedCrawlDocument {
	const document = new DOMParser().parseFromString(html, "text/html");
	const links = new Set<string>();
	let linksLimited = false;
	for (const element of document.querySelectorAll<HTMLAnchorElement>("a[href], area[href]")) {
		const href = element.getAttribute("href") ?? "";
		if (href.length > 2_048) { linksLimited = true; continue; }
		const link = normalizeRenderedCrawlUrl(href, new URL(documentUrl).origin, documentUrl);
		if (!link || links.has(link)) continue;
		if (links.size >= MAX_LINKS_PER_PAGE) { linksLimited = true; break; }
		links.add(link);
	}
	return {
		title: cleanText(document.querySelector("title")?.textContent),
		titleCount: document.querySelectorAll("title").length,
		description: metaContent(document, 'meta[name="description" i]'),
		canonical: cleanText(document.querySelector<HTMLLinkElement>('link[rel~="canonical" i]')?.getAttribute("href")),
		robots: metaContent(document, 'meta[name="robots" i]'),
		h1Count: document.querySelectorAll("h1").length,
		ogTitle: metaContent(document, 'meta[property="og:title" i]'),
		ogDescription: metaContent(document, 'meta[property="og:description" i]'),
		ogImage: metaContent(document, 'meta[property="og:image" i]'),
		ogUrl: metaContent(document, 'meta[property="og:url" i]'),
		links: [...links],
		linksLimited,
	};
}

class SeoRenderedCrawlBodyLimitError extends Error {
	readonly kind: "page" | "sitemap";

	constructor(kind: "page" | "sitemap", maxBytes: number) {
		const limit = maxBytes >= 1_000_000
			? `${(maxBytes / 1_000_000).toFixed(1)} MB`
			: `${Math.ceil(maxBytes / 1_000)} KB`;
		super(`${kind === "page" ? "Page" : "Sitemap"} response exceeds the ${limit} safety limit.`);
		this.name = "SeoRenderedCrawlBodyLimitError";
		this.kind = kind;
	}
}

async function readBoundedText(response: Response, maxBytes: number, kind: "page" | "sitemap"): Promise<string> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new SeoRenderedCrawlBodyLimitError(kind, maxBytes);
	}
	if (!response.body) {
		const text = await response.text();
		if (new TextEncoder().encode(text).byteLength > maxBytes) {
			throw new SeoRenderedCrawlBodyLimitError(kind, maxBytes);
		}
		return text;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let byteLength = 0;
	let text = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			byteLength += chunk.value.byteLength;
			if (byteLength > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new SeoRenderedCrawlBodyLimitError(kind, maxBytes);
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException("The crawl was cancelled.", "AbortError");
}

async function fetchBoundedText(
	fetcher: (url: string, init?: RequestInit) => Promise<Response>,
	url: string,
	init: RequestInit,
	timeoutMs: number,
	maxBytes: number,
	kind: "page" | "sitemap",
	shouldRead: (response: Response) => boolean,
	signal?: AbortSignal,
): Promise<{ response: Response; text: string }> {
	throwIfCancelled(signal);
	const controller = new AbortController();
	const cancel = () => controller.abort();
	signal?.addEventListener("abort", cancel, { once: true });
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetcher(url, { ...init, signal: controller.signal });
		const text = shouldRead(response) ? await readBoundedText(response, maxBytes, kind) : "";
		return { response, text };
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", cancel);
	}
}

function finding(
	code: SeoRenderedCrawlFindingCode,
	severity: SeoRenderedCrawlSeverity,
	path: string,
	detail: string,
	options: { target?: string | null; sources?: string[] } = {},
): SeoRenderedCrawlFinding {
	const target = options.target ?? null;
	return {
		id: `${code}:${path}:${target ?? ""}`,
		code,
		severity,
		path,
		target,
		detail,
		sources: [...new Set(options.sources ?? [])].sort(),
	};
}

function canonicalPath(value: string, origin: string, baseUrl: string): string | null {
	try {
		const url = new URL(value, baseUrl);
		if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) return null;
		return normalizePathname(url.pathname);
	} catch {
		return null;
	}
}

function analyzePage(page: SeoRenderedCrawlPage, origin: string): SeoRenderedCrawlFinding[] {
	if (page.error) {
		return [finding(page.errorCode ?? "page-fetch-failed", "error", page.requestedPath, page.error, { sources: page.sources })];
	}
	if (page.status < 200 || page.status >= 400) {
		return [finding("page-http-error", "error", page.requestedPath, `HTTP ${page.status}`, { sources: page.sources })];
	}

	const findings: SeoRenderedCrawlFinding[] = [];
	if (page.redirected || page.requestedPath !== page.finalPath) {
		findings.push(finding(
			"page-redirect",
			"warning",
			page.requestedPath,
			`Resolves to ${page.finalPath}`,
			{ target: page.finalPath, sources: page.sources },
		));
	}
	if (!page.document) {
		findings.push(finding("page-non-html", "warning", page.requestedPath, `Expected HTML but received ${page.contentType || "an unknown content type"}.`));
		return findings;
	}

	const document = page.document;
	if (!page.fromSitemap) {
		findings.push(finding("page-not-in-sitemap", "notice", page.requestedPath, "Discovered through an internal link but not listed in the sitemap."));
	}
	if (!document.title) findings.push(finding("title-missing", "error", page.requestedPath, "The rendered page has no title."));
	if (document.titleCount > 1) findings.push(finding("title-duplicate", "warning", page.requestedPath, `The rendered page contains ${document.titleCount} title elements.`));
	if (!document.description) findings.push(finding("description-missing", "warning", page.requestedPath, "The rendered page has no meta description."));
	if (!document.canonical) {
		findings.push(finding("canonical-missing", "error", page.requestedPath, "The rendered page has no canonical URL."));
	} else {
		const expectedPath = page.finalPath;
		const resolvedPath = canonicalPath(document.canonical, origin, page.finalUrl);
		if (!resolvedPath) {
			findings.push(finding("canonical-invalid", "error", page.requestedPath, "The canonical URL is invalid or points to another origin.", { target: document.canonical }));
		} else if (resolvedPath !== expectedPath) {
			findings.push(finding("canonical-mismatch", "error", page.requestedPath, `Canonical points to ${resolvedPath} instead of ${expectedPath}.`, { target: resolvedPath }));
		}
	}
	if (page.fromSitemap && /(?:^|,)\s*noindex\b/i.test(document.robots)) {
		findings.push(finding("robots-noindex", "error", page.requestedPath, "A sitemap URL renders a noindex directive."));
	}
	if (document.h1Count === 0) findings.push(finding("h1-missing", "warning", page.requestedPath, "The rendered page has no H1 heading."));
	if (document.h1Count > 1) findings.push(finding("h1-multiple", "warning", page.requestedPath, `The rendered page contains ${document.h1Count} H1 headings.`));
	const missingOpenGraph = [
		["title", document.ogTitle],
		["description", document.ogDescription],
		["image", document.ogImage],
		["URL", document.ogUrl],
	].filter(([, value]) => !value).map(([label]) => label);
	if (missingOpenGraph.length) {
		findings.push(finding("open-graph-incomplete", "warning", page.requestedPath, `Missing Open Graph ${missingOpenGraph.join(", ")}.`));
	}
	return findings;
}

function findingRank(severity: SeoRenderedCrawlSeverity): number {
	return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function responsePath(responseUrl: string, fallback: string): string {
	try {
		return normalizePathname(new URL(responseUrl).pathname);
	} catch {
		return fallback;
	}
}

async function scanPage(
	url: string,
	seed: CrawlSeed,
	options: Required<Pick<RunSeoRenderedCrawlOptions, "fetcher" | "parseHtml">> & {
		timeoutMs: number;
		maxPageBytes: number;
		origin: string;
		signal?: AbortSignal;
	},
): Promise<SeoRenderedCrawlPage> {
	const requestedPath = new URL(url).pathname;
	try {
		const { response, text: html } = await fetchBoundedText(options.fetcher, url, {
			method: "GET",
			credentials: "same-origin",
			redirect: "follow",
			headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
		}, options.timeoutMs, options.maxPageBytes, "page", (candidate) => {
			const type = candidate.headers.get("content-type") ?? "";
			return candidate.status >= 200
				&& candidate.status < 400
				&& (!type || /(?:text\/html|application\/xhtml\+xml)/i.test(type));
		}, options.signal);
		throwIfCancelled(options.signal);
		const finalUrl = response.url || url;
		const finalOrigin = new URL(finalUrl).origin;
		if (finalOrigin !== options.origin) throw new Error("The page redirected outside the current site origin.");
		const contentType = response.headers.get("content-type") ?? "";
		const document = html ? options.parseHtml(html, finalUrl) : null;
		if (document && document.links.length > MAX_LINKS_PER_PAGE) {
			document.links = document.links.slice(0, MAX_LINKS_PER_PAGE);
			document.linksLimited = true;
		}
		return {
			requestedUrl: url,
			requestedPath,
			finalUrl,
			finalPath: responsePath(finalUrl, requestedPath),
			status: response.status,
			redirected: response.redirected,
			contentType,
			fromSitemap: seed.fromSitemap,
			sources: [...seed.sources].sort(),
			document,
			errorCode: null,
			error: null,
		};
	} catch (cause) {
		throwIfCancelled(options.signal);
		return {
			requestedUrl: url,
			requestedPath,
			finalUrl: url,
			finalPath: requestedPath,
			status: 0,
			redirected: false,
			contentType: "",
			fromSitemap: seed.fromSitemap,
			sources: [...seed.sources].sort(),
			document: null,
			errorCode: cause instanceof SeoRenderedCrawlBodyLimitError ? "page-too-large" : "page-fetch-failed",
			error: cause instanceof Error ? cause.message : "The page request failed.",
		};
	}
}

export async function runSeoRenderedCrawl(options: RunSeoRenderedCrawlOptions): Promise<SeoRenderedCrawlReport> {
	throwIfCancelled(options.signal);
	const parsedOrigin = new URL(options.origin);
	if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") throw new Error("Rendered crawl requires an HTTP(S) origin.");
	const origin = parsedOrigin.origin;
	const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
	const parseHtml = options.parseHtml ?? parseRenderedHtml;
	const parseSitemap = options.parseSitemap ?? parseRenderedSitemap;
	const maxPages = boundedInteger(options.maxPages, DEFAULT_MAX_PAGES, 1, 100);
	const maxSitemaps = boundedInteger(options.maxSitemaps, DEFAULT_MAX_SITEMAPS, 1, 20);
	const concurrency = boundedInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, 6);
	const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 30_000);
	const maxPageBytes = boundedInteger(options.maxPageBytes, DEFAULT_MAX_PAGE_BYTES, 1_024, 10_000_000);
	const maxSitemapBytes = boundedInteger(options.maxSitemapBytes, DEFAULT_MAX_SITEMAP_BYTES, 1_024, 20_000_000);
	const findings: SeoRenderedCrawlFinding[] = [];
	const sitemapPages = new Set<string>();
	const sitemapQueue = [new URL("/sitemap.xml", origin).href];
	const visitedSitemaps = new Set<string>();
	let sitemapPageOverflow = false;
	let sitemapQueueOverflow = false;

	while (sitemapQueue.length && visitedSitemaps.size < maxSitemaps) {
		throwIfCancelled(options.signal);
		const sitemapUrl = sitemapQueue.shift();
		if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
		visitedSitemaps.add(sitemapUrl);
		const sitemapPath = new URL(sitemapUrl).pathname;
		try {
			const { response, text } = await fetchBoundedText(fetcher, sitemapUrl, {
				method: "GET",
				credentials: "same-origin",
				redirect: "follow",
				headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
			}, timeoutMs, maxSitemapBytes, "sitemap", (candidate) => candidate.ok, options.signal);
			throwIfCancelled(options.signal);
			if (new URL(response.url || sitemapUrl).origin !== origin) {
				throw new Error("The sitemap redirected outside the current site origin.");
			}
			if (!response.ok) {
				findings.push(finding("sitemap-http-error", "error", sitemapPath, `Sitemap returned HTTP ${response.status}.`));
				continue;
			}
			const parsed = parseSitemap(text, response.url || sitemapUrl);
			for (const value of parsed.pageUrls) {
				const url = normalizeRenderedCrawlUrl(value, origin, response.url || sitemapUrl);
				if (!url || sitemapPages.has(url)) continue;
				if (sitemapPages.size >= maxPages) {
					sitemapPageOverflow = true;
					continue;
				}
				sitemapPages.add(url);
			}
			for (const value of parsed.sitemapUrls) {
				const url = normalizeSitemapUrl(value, origin, response.url || sitemapUrl);
				if (!url || visitedSitemaps.has(url) || sitemapQueue.includes(url)) continue;
				if (visitedSitemaps.size + sitemapQueue.length >= maxSitemaps) {
					sitemapQueueOverflow = true;
					continue;
				}
				sitemapQueue.push(url);
			}
		} catch (cause) {
			throwIfCancelled(options.signal);
			const detail = cause instanceof Error ? cause.message : "The sitemap request failed.";
			findings.push(finding(
				cause instanceof SeoRenderedCrawlBodyLimitError
					? "sitemap-too-large"
					: detail.startsWith("Invalid sitemap XML") ? "sitemap-invalid" : "sitemap-fetch-failed",
				"error",
				sitemapPath,
				detail,
			));
		}
	}

	const reachedSitemapLimit = sitemapQueue.length > 0 || sitemapQueueOverflow;
	const seeds = new Map<string, CrawlSeed>();
	const queue: string[] = [];
	const rootUrl = normalizeRenderedCrawlUrl("/", origin, origin);
	if (rootUrl) {
		seeds.set(rootUrl, { fromSitemap: sitemapPages.has(rootUrl), sources: new Set() });
		queue.push(rootUrl);
	}
	for (const url of sitemapPages) {
		if (seeds.has(url)) continue;
		if (seeds.size >= maxPages) {
			sitemapPageOverflow = true;
			break;
		}
		seeds.set(url, { fromSitemap: true, sources: new Set() });
		queue.push(url);
	}

	const pages: SeoRenderedCrawlPage[] = [];
	let discoveredPageOverflow = false;
	let reachedLinkLimit = false;
	let scannedLinks = 0;
	let cursor = 0;
	while (cursor < queue.length && pages.length < maxPages) {
		throwIfCancelled(options.signal);
		const remaining = maxPages - pages.length;
		const batchUrls = queue.slice(cursor, cursor + Math.min(concurrency, remaining));
		cursor += batchUrls.length;
		const batch = await Promise.all(batchUrls.map((url) => scanPage(url, seeds.get(url) ?? {
			fromSitemap: false,
			sources: new Set(),
		}, { fetcher, parseHtml, timeoutMs, maxPageBytes, origin, signal: options.signal })));
		throwIfCancelled(options.signal);
		for (const page of batch) {
			pages.push(page);
			if (page.document) {
				if (page.document.linksLimited) reachedLinkLimit = true;
				const remainingLinks = MAX_TOTAL_LINKS - scannedLinks;
				if (page.document.links.length > remainingLinks) {
					page.document.links = page.document.links.slice(0, remainingLinks);
					page.document.linksLimited = true;
					reachedLinkLimit = true;
				}
				scannedLinks += page.document.links.length;
			}
			for (const linkedUrl of page.document?.links ?? []) {
				const normalized = normalizeRenderedCrawlUrl(linkedUrl, origin, page.finalUrl);
				if (!normalized) continue;
				const existing = seeds.get(normalized);
				if (existing) {
					existing.sources.add(page.finalPath);
					continue;
				}
				if (seeds.size >= maxPages) {
					discoveredPageOverflow = true;
					continue;
				}
				seeds.set(normalized, { fromSitemap: sitemapPages.has(normalized), sources: new Set([page.finalPath]) });
				queue.push(normalized);
			}
		}
	}

	const reachedPageLimit = cursor < queue.length || sitemapPageOverflow || discoveredPageOverflow;
	for (const page of pages) {
		page.sources = [...(seeds.get(page.requestedUrl)?.sources ?? [])].sort();
	}
	for (const page of pages) findings.push(...analyzePage(page, origin));
	findings.sort((left, right) => (
		findingRank(left.severity) - findingRank(right.severity)
		|| left.path.localeCompare(right.path)
		|| left.code.localeCompare(right.code)
	));

	const pageProblems = new Set(
		findings
			.filter((item) => item.severity !== "notice" && !item.code.startsWith("sitemap-"))
			.map((item) => item.path),
	);
	const brokenCodes = new Set<SeoRenderedCrawlFindingCode>(["page-fetch-failed", "page-http-error", "page-too-large"]);
	const metadataCodes = new Set<SeoRenderedCrawlFindingCode>([
		"title-missing",
		"title-duplicate",
		"description-missing",
		"canonical-missing",
		"canonical-invalid",
		"canonical-mismatch",
		"robots-noindex",
		"h1-missing",
		"h1-multiple",
		"open-graph-incomplete",
	]);
	const coverageLimitedCodes = new Set<SeoRenderedCrawlFindingCode>([
		"page-fetch-failed",
		"page-too-large",
		"sitemap-fetch-failed",
		"sitemap-http-error",
		"sitemap-invalid",
		"sitemap-too-large",
	]);
	return {
		version: SEO_RENDERED_CRAWL_VERSION,
		generatedAt: options.now?.() ?? new Date().toISOString(),
		origin,
		coverage: reachedPageLimit || reachedSitemapLimit || reachedLinkLimit || findings.some((item) => coverageLimitedCodes.has(item.code)) ? "limited" : "complete",
		summary: {
			sitemapPages: sitemapPages.size,
			crawledPages: pages.length,
			healthyPages: pages.filter((page) => page.status >= 200 && page.status < 400 && !pageProblems.has(page.requestedPath)).length,
			brokenPages: findings.filter((item) => brokenCodes.has(item.code)).length,
			redirects: findings.filter((item) => item.code === "page-redirect").length,
			metadataIssues: findings.filter((item) => metadataCodes.has(item.code)).length,
			warnings: findings.filter((item) => item.severity === "warning").length,
		},
		limits: {
			maxPages,
			maxSitemaps,
			maxPageBytes,
			maxSitemapBytes,
			reachedPageLimit,
			reachedSitemapLimit,
			sitemapDocuments: visitedSitemaps.size,
			maxLinksPerPage: MAX_LINKS_PER_PAGE,
			maxTotalLinks: MAX_TOTAL_LINKS,
			scannedLinks,
			reachedLinkLimit,
		},
		pages,
		findings,
	};
}
