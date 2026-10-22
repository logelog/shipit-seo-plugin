import { sitemapLocalePrefixes, sitemapPathKey, type SitemapRouting } from "./sitemap-engine.ts";

export interface ContentTypeRoute {
	collection: string;
	/** Null is the host default, `/<collection>/{slug}`. */
	urlPattern: string | null;
}

const TOKEN = /\{([^/{}]*)\}/g;
const TOKEN_SOURCES: Readonly<Record<string, string>> = {
	slug: "[^/]+",
	id: "[^/]+",
	year: "\\d{4}",
	month: "\\d{2}",
	day: "\\d{2}",
	hour: "\\d{2}",
	minute: "\\d{2}",
	second: "\\d{2}",
};

export function contentTypeRoutePattern(route: ContentTypeRoute): string {
	return route.urlPattern ?? `/${encodeURIComponent(route.collection)}/{slug}`;
}

function escapeLiteral(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Null for a token the host cannot resolve: such a pattern has no public address. */
function segmentExpression(segment: string): RegExp | null {
	let source = "";
	let last = 0;
	for (const match of segment.matchAll(TOKEN)) {
		const token = TOKEN_SOURCES[match[1]];
		if (token === undefined) return null;
		source += escapeLiteral(segment.slice(last, match.index)) + token;
		last = match.index + match[0].length;
	}
	return new RegExp(`^${source}${escapeLiteral(segment.slice(last))}$`, "u");
}

function segmentsOf(path: string): string[] {
	return sitemapPathKey(path.replace(/\/{2,}/g, "/")).split("/").filter(Boolean);
}

/**
 * The first content type, in the order given, whose URL pattern can produce
 * the path in any routed locale. Matching is by address shape only, so a
 * page outside EmDash content with the same shape as a pattern made only of
 * placeholders, such as `/{slug}`, matches that pattern too.
 */
export function createContentTypeRouteMatcher(
	routes: readonly ContentTypeRoute[],
	routing: SitemapRouting | null,
): (path: string) => string | null {
	const prefixes = sitemapLocalePrefixes(routing ?? { trailingSlash: "ignore", i18n: null })
		.map((prefix) => prefix.map((segment) => segmentsOf(`/${segment}`)[0] ?? segment));
	const compiled = routes.flatMap((route) => {
		const expressions = segmentsOf(contentTypeRoutePattern(route)).map(segmentExpression);
		return expressions.every((expression): expression is RegExp => expression !== null)
			? [{ collection: route.collection, expressions }]
			: [];
	});
	return (path) => {
		if (typeof path !== "string" || !path.startsWith("/")) return null;
		const segments = segmentsOf(path);
		for (const route of compiled) {
			for (const prefix of prefixes) {
				if (segments.length !== prefix.length + route.expressions.length) continue;
				if (!prefix.every((segment, index) => segments[index] === segment)) continue;
				if (route.expressions.every((expression, index) => expression.test(segments[prefix.length + index]!))) return route.collection;
			}
		}
		return null;
	};
}
