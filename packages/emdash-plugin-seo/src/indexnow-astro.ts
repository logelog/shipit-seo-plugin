import type { APIRoute } from "astro";

const PLUGIN_ID = "shipit-seo";
const PUBLIC_KEY_ROUTE = "public-indexnow-key";
const DEFAULT_PLUGIN_ROUTE = `/_emdash/api/plugins/${PLUGIN_ID}/${PUBLIC_KEY_ROUTE}`;
const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const RESPONSE_HEADERS = {
	"cache-control": "no-store",
	"content-type": "text/plain; charset=utf-8",
	"x-content-type-options": "nosniff",
	"x-robots-tag": "noindex, nofollow",
} as const;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PublicRouteHandler = (pluginId: string, method: string, path: string, request: Request) =>
	Promise<{ success: boolean; data?: unknown; error?: { code?: string } }>;

export interface IndexNowAstroRouteOptions {
	/** @deprecated Only the default path is supported by the in-process public dispatcher. */
	pluginRoute?: string;
	/** @deprecated Custom HTTP transports are unsupported; supplying one returns unavailable. */
	fetch?: FetchLike;
}

function response(status: number, body: string | null, headers: HeadersInit = {}): Response {
	return new Response(body, {
		status,
		headers: { ...RESPONSE_HEADERS, ...headers },
	});
}

/**
 * Expose the plugin-owned IndexNow verification key through EmDash's public
 * dispatcher. Visitor headers and query data never reach the plugin handler.
 */
export function createIndexNowKeyRoute(
	options: IndexNowAstroRouteOptions = {},
): APIRoute {
	const unsupportedOptions = options.fetch !== undefined ||
		(options.pluginRoute !== undefined && options.pluginRoute !== DEFAULT_PLUGIN_ROUTE);

	return async ({ request, url, cache, locals }) => {
		cache.set(false);
		const respond = (status: number, body: string, headers: HeadersInit = {}) =>
			response(status, request.method === "HEAD" ? null : body, headers);
		if (request.method !== "GET" && request.method !== "HEAD") {
			return respond(405, "Method not allowed", { allow: "GET, HEAD" });
		}
		const handler = (locals as { emdash?: { handlePublicPluginApiRoute?: PublicRouteHandler } } | undefined)
			?.emdash?.handlePublicPluginApiRoute;
		if (unsupportedOptions || typeof handler !== "function") {
			return respond(503, "IndexNow verification is unavailable");
		}

		let result: Awaited<ReturnType<PublicRouteHandler>>;
		try {
			const internal = new Request(new URL(DEFAULT_PLUGIN_ROUTE, url.origin));
			result = await handler(PLUGIN_ID, "GET", PUBLIC_KEY_ROUTE, internal);
		} catch {
			return respond(503, "IndexNow verification is unavailable");
		}
		if (result?.success === false && result?.error?.code === "NOT_FOUND") return respond(404, "Not found");
		if (result?.success !== true || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
			return respond(503, "IndexNow verification is unavailable");
		}
		const value = result.data as { configured?: unknown; key?: unknown };
		if (value.configured === false) return respond(404, "Not found");
		if (value.configured !== true || typeof value.key !== "string" || !INDEXNOW_KEY_PATTERN.test(value.key)) {
			return respond(503, "IndexNow verification is unavailable");
		}
		return respond(200, value.key);
	};
}
