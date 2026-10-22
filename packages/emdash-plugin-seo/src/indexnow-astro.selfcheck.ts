import assert from "node:assert/strict";

import { createIndexNowKeyRoute } from "./indexnow-astro.ts";

type PublicRouteHandler = (pluginId: string, method: string, path: string, request: Request) =>
	Promise<{ success: boolean; data?: unknown; error?: { code?: string } }>;

let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
	networkCalls += 1;
	throw new Error("The public key adapter must not use HTTP");
};

let cacheSetting: false | null = null;
function context(
	method = "GET",
	origin = "https://example.com",
	handler?: PublicRouteHandler,
) {
	const url = new URL("/indexnow-key.txt?visitor=ignored", origin);
	return {
		request: new Request(url, {
			method,
			headers: {
				authorization: "Bearer visitor-only",
				cookie: "visitor-only=1",
				"x-forwarded-host": "private.example",
				"x-visitor-input": "ignored",
			},
		}),
		url,
		locals: handler ? { emdash: { handlePublicPluginApiRoute: handler } } : {},
		cache: { set: (value: false) => (cacheSetting = value) },
	} as never;
}

const key = "A1b2C3d4-verified-key";
const calls: Array<{ pluginId: string; method: string; path: string; request: Request }> = [];
const publicHandler: PublicRouteHandler = async (pluginId, method, path, request) => {
	calls.push({ pluginId, method, path, request });
	return { success: true, data: { configured: true, key } };
};
const ready = createIndexNowKeyRoute();

try {
	const served = await ready(context("GET", "https://example.com", publicHandler));
	assert.equal(served.status, 200);
	assert.equal(await served.text(), key);
	assert.equal(served.headers.get("content-type"), "text/plain; charset=utf-8");
	assert.equal(served.headers.get("cache-control"), "no-store");
	assert.equal(served.headers.get("x-content-type-options"), "nosniff");
	assert.equal(served.headers.get("x-robots-tag"), "noindex, nofollow");
	assert.equal(cacheSetting, false);
	assert.equal(calls.length, 1);
	assert.deepEqual(
		{ pluginId: calls[0].pluginId, method: calls[0].method, path: calls[0].path },
		{ pluginId: "shipit-seo", method: "GET", path: "public-indexnow-key" },
	);
	assert.equal(calls[0].request.method, "GET");
	assert.equal(new URL(calls[0].request.url).pathname, "/_emdash/api/plugins/shipit-seo/public-indexnow-key");
	assert.equal(new URL(calls[0].request.url).search, "");
	assert.deepEqual([...calls[0].request.headers], []);
	assert.equal(calls[0].request.body, null);

	const head = await ready(context("HEAD", "https://example.com", publicHandler));
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
	assert.deepEqual([...head.headers], [...served.headers]);

	for (const origin of [
		"http://127.0.0.1:9944",
		"http://10.0.0.1:81",
		"http://[::1]:9944",
		"https://untrusted.example",
	]) {
		const result = await ready(context("GET", origin, publicHandler));
		assert.equal(result.status, 200);
		assert.equal(await result.text(), key);
		assert.equal((await ready(context("GET", origin))).status, 503);
	}
	assert.equal(networkCalls, 0, "request origins never become network destinations");

	for (const method of ["GET", "HEAD"]) {
		for (const [data, status] of [
			[{ configured: false, key: null }, 404],
			[{ configured: true, key: "bad key" }, 503],
			[{ configured: true, key: "a".repeat(129) }, 503],
			[{ configured: "true", key }, 503],
			[{}, 503],
			[null, 503],
			[[], 503],
		] as const) {
			const result = await ready(context(method, "https://example.com", async () => ({ success: true, data })));
			assert.equal(result.status, status);
			assert.equal(await result.text(), method === "HEAD" ? "" : status === 404 ? "Not found" : "IndexNow verification is unavailable");
		}
		for (const [code, status] of [["NOT_FOUND", 404], ["INTERNAL_ERROR", 503]] as const) {
			const result = await ready(context(method, "https://example.com", async () => ({ success: false, error: { code } })));
			assert.equal(result.status, status);
			if (method === "HEAD") assert.equal(await result.text(), "");
		}
		const failed = await ready(context(method, "https://example.com", async () => { throw new Error("unavailable"); }));
		assert.equal(failed.status, 503);
		if (method === "HEAD") assert.equal(await failed.text(), "");
	}

	for (const malformed of [
		undefined,
		null,
		{ configured: true, key },
		{ success: "true", data: { configured: true, key } },
		{ success: 1, data: { configured: true, key } },
		{ error: { code: "NOT_FOUND" } },
	]) {
		const handler = (async () => malformed) as unknown as PublicRouteHandler;
		assert.equal((await ready(context("GET", "https://example.com", handler))).status, 503);
	}

	let legacyTransportCalls = 0;
	const legacyTransport = createIndexNowKeyRoute({
		fetch: async () => {
			legacyTransportCalls += 1;
			return Response.json({ configured: true, key });
		},
	});
	const beforeLegacy = calls.length;
	assert.equal((await legacyTransport(context("GET", "https://example.com", publicHandler))).status, 503);
	assert.equal((await createIndexNowKeyRoute({ pluginRoute: "/custom-route" })(context("GET", "https://example.com", publicHandler))).status, 503);
	assert.equal((await createIndexNowKeyRoute({ pluginRoute: "https://other.example/key" })(context("GET", "https://example.com", publicHandler))).status, 503);
	assert.equal(calls.length, beforeLegacy, "unsupported legacy options fail before dispatch");
	assert.equal(legacyTransportCalls, 0);
	assert.equal((await createIndexNowKeyRoute({
		pluginRoute: "/_emdash/api/plugins/shipit-seo/public-indexnow-key",
	})(context("GET", "https://example.com", publicHandler))).status, 200);

	const beforePost = calls.length;
	const post = await ready(context("POST", "https://example.com", publicHandler));
	assert.equal(post.status, 405);
	assert.equal(post.headers.get("allow"), "GET, HEAD");
	assert.equal(calls.length, beforePost, "unsupported methods never dispatch");
	assert.equal(networkCalls, 0);
	console.log("IndexNow Astro adapter self-checks passed.");
} finally {
	globalThis.fetch = originalFetch;
}
