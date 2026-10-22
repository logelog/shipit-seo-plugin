import { strict as assert } from "node:assert";

import { SEO_CRAWL_DIAGNOSTICS_VERSION } from "./crawl-diagnostics.ts";
import seoRuntime from "./sandbox-entry.ts";

function collectionStore() {
	const records = new Map<string, unknown>();
	return {
		get: async (id: string) => structuredClone(records.get(id) ?? null),
		put: async (id: string, value: unknown) => {
			records.set(id, structuredClone(value));
		},
		delete: async (id: string) => records.delete(id),
		count: async () => records.size,
		query: async () => ({ items: [] }),
	};
}

function portableLinks(links: Array<{ key: string; href: string; text: string }>) {
	return [
		{
			_type: "block",
			children: links.map((link) => ({
				_type: "span",
				text: link.text,
				marks: [link.key],
			})),
			markDefs: links.map((link) => ({
				_key: link.key,
				_type: "link",
				href: link.href,
			})),
		},
	];
}

const content = {
	pages: [
		{
			id: "home",
			slug: "home",
			status: "published",
			data: { title: "Home", path: "/", body_source: "template", content: [] },
		},
		{
			id: "about",
			slug: "about",
			status: "published",
			data: { title: "About", path: "/about", content: portableLinks([]) },
		},
	],
	posts: [
		{
			id: "article",
			slug: "article",
			status: "published",
			data: {
				title: "Article",
				content: portableLinks([
					{ key: "about", href: "/about", text: "About us" },
					{ key: "missing", href: "/missing", text: "Missing page" },
				]),
			},
		},
	],
	services: [
		{
			id: "service",
			slug: "service",
			status: "published",
			data: { title: "Service", content: portableLinks([]) },
		},
	],
} as const;

const stores = new Map<PropertyKey, ReturnType<typeof collectionStore>>();
const storage = new Proxy(
	{},
	{
		get(_target, property) {
			if (!stores.has(property)) stores.set(property, collectionStore());
			return stores.get(property);
		},
	},
);
const kv = new Map<string, unknown>([["settings:noindex", false]]);
const context = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { name: "Example", url: "https://example.com", locale: "en" },
	schema: { listCollections: async () => [
		{ slug: "pages", label: "Pages", hasSeo: true, routable: true, urlPattern: "/{slug}" },
		{ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/blog/{slug}" },
		{ slug: "services", label: "Services", hasSeo: true, routable: true, urlPattern: "/services/{slug}" },
	] },
	kv: {
		get: async (key: string) => structuredClone(kv.get(key) ?? null),
		// Published hosts read settings with revisions; unchanged rows keep one.
		getVersioned: async (key: string) => kv.has(key) ? { value: structuredClone(kv.get(key)), revision: "r1" } : null,
		set: async (key: string, value: unknown) => {
			kv.set(key, structuredClone(value));
		},
		delete: async (key: string) => kv.delete(key),
		list: async () => [],
	},
	storage,
	content: {
		getPublicUrl: async (name: keyof typeof content, id: string) => {
			const item = content[name]?.find((entry) => entry.id === id);
			if (!item) return null;
			if (name === "pages") {
				const path = (item.data as { path?: string }).path;
				return path ? `https://example.com${path}` : null;
			}
			return `https://example.com/${name === "posts" ? "blog" : "services"}/${encodeURIComponent(item.slug)}`;
		},
		list: async (name: keyof typeof content) => ({
			items: structuredClone(content[name] ?? []),
			cursor: undefined,
		}),
		get: async (name: keyof typeof content, id: string) =>
			structuredClone(content[name]?.find((item) => item.id === id) ?? null),
	},
	url: (path: string) => new URL(path, "https://example.com").toString(),
	log: {
		warn: () => undefined,
		info: () => undefined,
		error: () => undefined,
		debug: () => undefined,
	},
};

const route = {
	input: {},
	request: {
		url: "https://example.com/admin",
		method: "GET",
		headers: {},
	},
};
const crawlHandler = (seoRuntime as any).routes["admin-crawl-diagnostics"].handler;
const contentOptionsHandler = (seoRuntime as any).routes["admin-content-options"].handler;
const result = await crawlHandler(route, context);

assert.equal(result.diagnosticsVersion, SEO_CRAWL_DIAGNOSTICS_VERSION);
assert.equal(result.summary.scannedEntries, 4);
assert.equal(result.coverage, "partial");
assert.equal(result.unresolvedLinks.length, 1);
assert.equal(result.unresolvedLinks[0]?.targetPath, "/missing");
assert.equal(
	result.orphanEntries.some((item: any) => item.ref === "pages:about"),
	false,
);
assert.equal(
	result.orphanEntries.some((item: any) => item.ref === "posts:article"),
	true,
);
assert.equal(
	result.orphanEntries.every((item: any) => item.confidence === "review"),
	true,
);

const contextWithoutServices = {
	...context,
	content: {
		...context.content,
		list: async (name: keyof typeof content) => {
			if (name === "services") {
				throw new Error("content query failed", {
					cause: new Error("D1_ERROR: no such table: ec_services: SQLITE_ERROR"),
				});
			}
			return context.content.list(name);
		},
	},
};
const diagnosticsWithoutServices = await crawlHandler(route, contextWithoutServices);
assert.equal(diagnosticsWithoutServices.summary.scannedEntries, 3);

const contextWithoutContent = { ...context, content: undefined };
await assert.rejects(() => crawlHandler(route, contextWithoutContent), /Content access is unavailable/);

const contextWithoutPublicUrl = {
	...context,
	schema: { listCollections: async () => [{ slug: "pages", label: "Pages", routable: true }] },
	content: {
		...context.content,
		list: async () => ({ items: structuredClone([content.pages[1]]), cursor: undefined }),
		getPublicUrl: async () => null,
	},
};
const diagnosticsWithoutPublicUrl = await crawlHandler(route, contextWithoutPublicUrl);
assert.equal(diagnosticsWithoutPublicUrl.coverage, "partial");
assert.equal(diagnosticsWithoutPublicUrl.summary.scannedEntries, 0);

const contextWithMissingCollection = {
	...context,
	schema: {
		listCollections: async () => [
			{ slug: "pages", label: "Pages", routable: true },
			{ slug: "services", label: "Services", routable: true },
		],
	},
	content: {
		...context.content,
		list: async (name: string) => {
			if (name === "services") throw new Error("D1_ERROR: no such table: ec_services: SQLITE_ERROR");
			return { items: structuredClone([content.pages[1]]), cursor: undefined };
		},
	},
};
const diagnosticsWithMissingCollection = await crawlHandler(route, contextWithMissingCollection);
assert.equal(diagnosticsWithMissingCollection.coverage, "partial");
assert.equal(diagnosticsWithMissingCollection.summary.scannedEntries, 1);
assert.equal(diagnosticsWithMissingCollection.orphanEntries[0]?.confidence, "review");

const cappedEntries = [
	content.pages[1],
	...Array.from({ length: 1_000 }, (_, index) => ({
		id: `draft-${index}`,
		slug: `draft-${index}`,
		status: "draft",
		data: { title: `Draft ${index}`, content: [] },
	})),
];
const contextAtScanLimit = {
	...context,
	schema: { listCollections: async () => [{ slug: "pages", label: "Pages", routable: true }] },
	content: {
		...context.content,
		list: async (_name: string, options: { cursor?: string; limit?: number } = {}) => {
			const offset = Number(options.cursor ?? 0);
			const items = cappedEntries.slice(offset, offset + (options.limit ?? 100));
			const next = offset + items.length;
			return {
				items: structuredClone(items),
				cursor: next < cappedEntries.length ? String(next) : undefined,
				hasMore: next < cappedEntries.length,
			};
		},
	},
};
const diagnosticsAtScanLimit = await crawlHandler(route, contextAtScanLimit);
assert.equal(diagnosticsAtScanLimit.coverage, "partial");
assert.equal(diagnosticsAtScanLimit.summary.scannedEntries, 1);
assert.equal(diagnosticsAtScanLimit.orphanEntries[0]?.confidence, "review");

const contentOptionsWithoutServices = await contentOptionsHandler(
	{ ...route, input: { collection: "posts", limit: 25 } },
	contextWithoutServices,
);
assert.equal(contentOptionsWithoutServices.items.length, 1);
assert.equal(
	contentOptionsWithoutServices.items.some((item: any) => item.collection === "services"),
	false,
);
const unavailableServicesPage = await contentOptionsHandler(
	{ ...route, input: { collection: "services", limit: 25 } },
	contextWithoutServices,
);
assert.equal(unavailableServicesPage.items.length, 0);

const contextWithDatabaseFailure = {
	...context,
	content: {
		...context.content,
		list: async () => {
			throw new Error("database is locked");
		},
	},
};
await assert.rejects(() => crawlHandler(route, contextWithDatabaseFailure), /database is locked/);


// The record budget is shared by content types; drafts consume it too.
const calls: string[] = [];
const multiCollectionRows = Object.fromEntries(["pages", "posts", "services"].map((name) => [name, Array.from({ length: 600 }, (_, index) => ({
	id: `${name}-${index}`,
	slug: `${name}-${index}`,
	status: "draft",
	data: { title: `${name} ${index}`, content: [] },
}))]));
const multiCollection = await crawlHandler(route, {
	...context,
	content: {
		...context.content,
		list: async (name: string, options: { cursor?: string; limit?: number } = {}) => {
			calls.push(name);
			const offset = Number(options.cursor ?? 0);
			const rows = multiCollectionRows[name] ?? [];
			const items = rows.slice(offset, offset + (options.limit ?? 100));
			const next = offset + items.length;
			return { items, cursor: next < rows.length ? String(next) : undefined, hasMore: next < rows.length };
		},
	},
});
assert.equal(multiCollection.limits.inspectedRecords, 1_000);
assert.equal(multiCollection.limits.reachedEntryLimit, true);
assert.equal(multiCollection.coverage, "partial");
assert.equal(multiCollection.summary.scannedEntries, 0);
assert.equal(calls.filter((name) => name === "pages").length, 6);
assert.equal(calls.filter((name) => name === "posts").length, 4);
assert.equal(calls.includes("services"), false);
const largeBody = await crawlHandler(route, {
	...context,
	schema: { listCollections: async () => [{ slug: "pages", label: "Pages", routable: true }] },
	content: {
		...context.content,
		getPublicUrl: async () => "https://example.com/oversize",
		list: async () => ({ items: [{ id: "oversize", slug: "oversize", status: "published", data: { title: "Oversize", content: Array.from({ length: 10_000 }, () => ({ type: "paragraph", content: [] })) } }] }),
	},
});
assert.equal(largeBody.limits.scannedDocumentNodes, 5_000);
assert.equal(largeBody.limits.reachedDocumentLimit, true);
assert.equal(largeBody.coverage, "partial");
assert.ok(largeBody.orphanEntries.every((item: any) => item.confidence === "review"));

// An adapter cursor cannot keep an empty collection scan alive indefinitely.
const emptyCursorCalls = new Map<string, number>();
const emptyCursorResult = await crawlHandler(route, {
	...context,
	content: {
		...context.content,
		list: async (name: string) => {
			const calls = (emptyCursorCalls.get(name) ?? 0) + 1;
			emptyCursorCalls.set(name, calls);
			assert.equal(calls, 1, "stop after the first empty page even when its cursor changes");
			return { items: [], cursor: `fresh-${name}-${calls}`, hasMore: true };
		},
	},
});
assert.deepEqual([...emptyCursorCalls], [["pages", 1], ["posts", 1], ["services", 1]]);
assert.equal(emptyCursorResult.coverage, "partial");
assert.equal(emptyCursorResult.limits.inspectedRecords, 0);
assert.equal(emptyCursorResult.limits.scannedDocumentNodes, 0);
assert.equal(emptyCursorResult.summary.scannedEntries, 0);
assert.equal(emptyCursorResult.summary.unresolvedInternalLinks, 0);
assert.equal(emptyCursorResult.summary.possibleOrphans, 0);
assert.deepEqual(emptyCursorResult.unresolvedLinks, []);
assert.deepEqual(emptyCursorResult.orphanEntries, []);
console.log("SEO crawl diagnostics runtime self-check passed.");
