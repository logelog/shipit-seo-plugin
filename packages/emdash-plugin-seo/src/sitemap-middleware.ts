// Astro middleware that `shipitSeo()` registers after EmDash's own middleware
// on a verified EmDash version. EmDash initializes its full runtime for
// exactly `/sitemap.xml` and `/sitemap-<collection>.xml`, so child files keep
// those paths and carry their cursor in the query.
import type { MiddlewareHandler } from "astro";

import { SEO_ENGINE_PLUGIN_ID } from "./admin-contract.ts";
import { parseSitemapPublicPath } from "./sitemap-engine.ts";

interface SitemapRouteData {
	pass: boolean;
	status?: number;
	contentType?: string;
	body?: string;
	cacheControl?: string;
	retryAfter?: number;
}

type PublicRouteHandler = (pluginId: string, method: string, path: string, request: Request) =>
	Promise<{ success: boolean; data?: unknown; error?: { code?: string } }>;

function routeData(value: unknown): SitemapRouteData | null {
	if (!value || typeof value !== "object") return null;
	const data = value as SitemapRouteData;
	if (data.pass === true) return data;
	return data.pass === false && Number.isInteger(data.status) && typeof data.contentType === "string" &&
		typeof data.body === "string" && typeof data.cacheControl === "string"
		? data
		: null;
}

function unavailable(): Response {
	return new Response("The sitemap is temporarily unavailable.", {
		status: 503,
		headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300" },
	});
}

function notFound(): Response {
	return new Response("Sitemap file not found.", {
		status: 404,
		headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
	});
}

/**
 * `owner` is the build-time owner of the sitemap addresses. Anything but
 * `shipit` passes every request through untouched. While Shipit owns them,
 * the plugin route still decides at runtime, so a feature switched off or a
 * deactivated plugin hands the request to EmDash; without EmDash's plugin
 * dispatcher an unsupported address is a 404 and a sitemap file a 503.
 */
export function createSitemapMiddleware(owner: string): MiddlewareHandler {
	return (context, next) => (owner === "shipit" ? handleSitemapRequest(context, next) : next());
}

async function handleSitemapRequest(
	context: Parameters<MiddlewareHandler>[0],
	next: Parameters<MiddlewareHandler>[1],
): Promise<Response> {
	const match = parseSitemapPublicPath(context.url.pathname, context.url.search);
	if (match.match === "none") return next();
	const method = context.request.method.toUpperCase();
	if (method !== "GET" && method !== "HEAD") return next();
	const handler = (context.locals as { emdash?: { handlePublicPluginApiRoute?: PublicRouteHandler } })
		.emdash?.handlePublicPluginApiRoute;
	if (typeof handler !== "function") return match.match === "invalid" ? notFound() : unavailable();

	// The plugin route reads only these parameters; no visitor header or cookie is forwarded.
	const params = new URLSearchParams();
	if (match.match === "invalid") params.set("invalid", "true");
	else if (match.file.kind === "child") {
		params.set("collection", match.file.collection);
		if (match.file.after !== null) params.set("after", match.file.after);
	}
	const query = params.toString();
	const internal = new Request(new URL(`/_emdash/api/plugins/${SEO_ENGINE_PLUGIN_ID}/sitemap${query ? `?${query}` : ""}`, context.url));
	let result: Awaited<ReturnType<PublicRouteHandler>>;
	try {
		result = await handler(SEO_ENGINE_PLUGIN_ID, "GET", "sitemap", internal);
	} catch {
		return unavailable();
	}
	// A deactivated plugin has no routes; EmDash's own sitemap answers then.
	if (!result.success && result.error?.code === "NOT_FOUND") return next();
	const data = result.success ? routeData(result.data) : null;
	if (!data) return unavailable();
	if (data.pass) return next();
	const headers = new Headers({
		"Content-Type": data.contentType!,
		"Cache-Control": data.cacheControl!,
		"X-Content-Type-Options": "nosniff",
	});
	if (data.retryAfter) headers.set("Retry-After", String(data.retryAfter));
	return new Response(method === "HEAD" ? null : data.body!, { status: data.status, headers });
}
