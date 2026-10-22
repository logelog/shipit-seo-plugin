export const SEO_SITEMAP_ENTRY_REASONS = [
	"included",
	"unresolved-path",
	"not-published",
	"site-noindex",
	"module-disabled",
	"entry-noindex",
	"content-type-disabled",
	"path-excluded",
] as const;

export type SeoSitemapEntryReason = (typeof SEO_SITEMAP_ENTRY_REASONS)[number];

export const SEO_CANONICAL_STATUSES = [
	"matches",
	"invalid",
	"off-origin",
	"different-path",
	"query-or-fragment",
] as const;

export type SeoCanonicalStatus = (typeof SEO_CANONICAL_STATUSES)[number];

export interface SeoSitemapEntryDecisionInput {
	path: string | null;
	published: boolean;
	siteNoindex: boolean;
	moduleEnabled: boolean;
	entryNoindex: boolean;
	contentTypeEnabled: boolean;
	excludedPaths: readonly string[];
	image: string | null;
}

export interface SeoSitemapEntryDecision {
	path: string | null;
	included: boolean;
	reason: SeoSitemapEntryReason;
	entryNoindex: boolean;
	image: string | null;
	imageIncluded: boolean;
}

export interface SeoCanonicalValidation {
	status: SeoCanonicalStatus;
	canonical: string;
	expectedPath: string | null;
}

export function normalizeSeoSitemapPath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const path = value.trim();
	if (
		!path ||
		path.length > 512 ||
		!path.startsWith("/") ||
		path.startsWith("//") ||
		path.includes("?") ||
		path.includes("#") ||
		path.includes("*") ||
		path.includes("\\") ||
		/[\u0000-\u001f\u007f]/.test(path)
	) {
		return null;
	}

	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		return null;
	}
	if (
		decoded.includes("\\") ||
		decoded.includes("//") ||
		/[\u0000-\u001f\u007f]/.test(decoded) ||
		decoded.split("/").some((segment) => segment === "." || segment === "..")
	) {
		return null;
	}

	return path === "/" ? path : path.replace(/\/+$/, "");
}

export function decideSeoSitemapEntry(
	input: SeoSitemapEntryDecisionInput,
): SeoSitemapEntryDecision {
	const path = normalizeSeoSitemapPath(input.path);
	let reason: SeoSitemapEntryReason = "included";
	if (!path) reason = "unresolved-path";
	else if (!input.published) reason = "not-published";
	else if (input.siteNoindex) reason = "site-noindex";
	else if (!input.moduleEnabled) reason = "module-disabled";
	else if (input.entryNoindex) reason = "entry-noindex";
	else if (!input.contentTypeEnabled) reason = "content-type-disabled";
	else if (input.excludedPaths.includes(path)) reason = "path-excluded";

	const included = reason === "included";
	const image = cleanHttpUrl(input.image);
	return {
		path,
		included,
		reason,
		entryNoindex: input.entryNoindex,
		image,
		imageIncluded: included && image !== null,
	};
}

export function validateSeoCanonical(
	canonicalValue: unknown,
	siteUrlValue: unknown,
	expectedPathValue: unknown,
): SeoCanonicalValidation {
	const canonical = typeof canonicalValue === "string" ? canonicalValue.trim() : "";
	const expectedPath = normalizeSeoSitemapPath(expectedPathValue);
	if (!canonical || !expectedPath || typeof siteUrlValue !== "string") {
		return { status: "invalid", canonical, expectedPath };
	}

	let canonicalUrl: URL;
	let siteUrl: URL;
	try {
		siteUrl = new URL(siteUrlValue);
		canonicalUrl = new URL(canonical, siteUrl);
	} catch {
		return { status: "invalid", canonical, expectedPath };
	}

	if (!isHttpProtocol(canonicalUrl) || !isHttpProtocol(siteUrl)) {
		return { status: "invalid", canonical, expectedPath };
	}
	if (canonicalUrl.search || canonicalUrl.hash) {
		return { status: "query-or-fragment", canonical: canonicalUrl.href, expectedPath };
	}
	if (canonicalUrl.origin !== siteUrl.origin) {
		return { status: "off-origin", canonical: canonicalUrl.href, expectedPath };
	}
	if (normalizeSeoSitemapPath(canonicalUrl.pathname) !== expectedPath) {
		return { status: "different-path", canonical: canonicalUrl.href, expectedPath };
	}
	return { status: "matches", canonical: canonicalUrl.href, expectedPath };
}

function cleanHttpUrl(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) return null;
	try {
		const url = new URL(value.trim());
		return isHttpProtocol(url) ? url.href : null;
	} catch {
		return null;
	}
}

function isHttpProtocol(url: URL): boolean {
	return url.protocol === "http:" || url.protocol === "https:";
}
