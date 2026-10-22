// Astro middleware that `shipitSeo()` registers after EmDash's own middleware
// on a verified EmDash version. It answers exactly /llms.txt through EmDash's
// public plugin dispatcher, and only while the settled owner is Shipit; every
// other request, and every request under another owner, goes to `next()`.
import type { MiddlewareHandler } from "astro";

import { SEO_ENGINE_PLUGIN_ID } from "./admin-contract.ts";
import { LLMS_TXT_CONTENT_TYPE, LLMS_TXT_PATH, llmsTxtUtf8Bytes, type LlmsTxtRefusal } from "./llms-txt-document.ts";

interface LlmsTxtRouteData {
	pass: boolean;
	status?: number;
	contentType?: string;
	cacheControl?: string;
	body?: string;
	allow?: string;
	retryAfter?: number;
}

type PublicRouteHandler = (pluginId: string, method: string, path: string, request: Request) =>
	Promise<{ success: boolean; data?: unknown; error?: { code?: string } }>;

const SERVED_STATUSES = new Set([200, 404, 405, 503]);

function routeData(value: unknown): LlmsTxtRouteData | null {
	if (!value || typeof value !== "object") return null;
	const data = value as LlmsTxtRouteData;
	if (data.pass === true) return data;
	return data.pass === false && SERVED_STATUSES.has(data.status as number) && typeof data.contentType === "string" &&
		typeof data.body === "string" && typeof data.cacheControl === "string"
		? data
		: null;
}

function textResponse(method: string, status: number, body: string, extra: Record<string, string> = {}): Response {
	return new Response(method === "HEAD" ? null : body, {
		status,
		headers: {
			"Content-Type": LLMS_TXT_CONTENT_TYPE,
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"Content-Length": String(llmsTxtUtf8Bytes(body)),
			...extra,
		},
	});
}

/**
 * `owner` is the build-time owner of /llms.txt. Anything but `shipit` passes
 * every request through before the dispatcher is consulted. While Shipit owns
 * the file the plugin route decides, so a deactivated plugin (`NOT_FOUND`)
 * hands the request on; without EmDash's dispatcher the file is a 503.
 */
export function createLlmsTxtMiddleware(owner: string): MiddlewareHandler {
	return (context, next) => (owner === "shipit" && context.url.pathname === LLMS_TXT_PATH
		? handleLlmsTxtRequest(context, next)
		: next());
}

async function handleLlmsTxtRequest(
	context: Parameters<MiddlewareHandler>[0],
	next: Parameters<MiddlewareHandler>[1],
): Promise<Response> {
	const method = context.request.method.toUpperCase();
	const refusal: LlmsTxtRefusal | null = method !== "GET" && method !== "HEAD" ? "method" : context.url.search ? "query" : null;
	const handler = (context.locals as { emdash?: { handlePublicPluginApiRoute?: PublicRouteHandler } })
		.emdash?.handlePublicPluginApiRoute;
	if (typeof handler !== "function") {
		return textResponse(method, 503, "llms.txt is temporarily unavailable.\n", { "Retry-After": "300" });
	}

	// The plugin route reads only this parameter; no visitor header, cookie or query is forwarded.
	const internal = new Request(new URL(`/_emdash/api/plugins/${SEO_ENGINE_PLUGIN_ID}/llms-txt${refusal ? `?refuse=${refusal}` : ""}`, context.url));
	let result: Awaited<ReturnType<PublicRouteHandler>>;
	try {
		result = await handler(SEO_ENGINE_PLUGIN_ID, "GET", "llms-txt", internal);
	} catch {
		return textResponse(method, 503, "llms.txt is temporarily unavailable.\n", { "Retry-After": "300" });
	}
	if (!result.success && result.error?.code === "NOT_FOUND") return next();
	const data = result.success ? routeData(result.data) : null;
	if (!data) return textResponse(method, 503, "llms.txt is temporarily unavailable.\n", { "Retry-After": "300" });
	if (data.pass) return next();
	const headers = new Headers({
		"Content-Type": data.contentType!,
		"Cache-Control": data.cacheControl!,
		"X-Content-Type-Options": "nosniff",
		// Set for GET and HEAD alike, so both carry identical headers.
		"Content-Length": String(llmsTxtUtf8Bytes(data.body!)),
	});
	if (data.allow) headers.set("Allow", data.allow);
	if (data.retryAfter) headers.set("Retry-After", String(data.retryAfter));
	return new Response(method === "HEAD" ? null : data.body!, { status: data.status, headers });
}
