import assert from "node:assert/strict";
import { mock } from "node:test";

import {
	SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	defaultIndexNowSettings,
} from "./admin-contract.ts";
import {
	deliverIndexNowQueue,
	enqueueIndexNowUrls,
	INDEXNOW_SETTINGS_STORAGE_KEY,
	indexNowSubmissionId,
	listIndexNowHistory,
	nextIndexNowSettingsUpdatedAt,
	readIndexNowSettings,
	readIndexNowHistoryUrls,
	updateIndexNowSettings,
} from "./indexnow-runtime.ts";
import {
	INDEXNOW_HISTORY_DETAIL_URL_BUDGET,
	INDEXNOW_HISTORY_RETENTION,
	emptyIndexNowSubmissionCounts,
	indexNowSubmissionStatus,
} from "./indexnow.ts";
import {
	withOperationLease,
	type OperationLeaseOwner,
} from "./operation-lease.ts";
import seoRuntime from "./sandbox-entry.ts";
import { indexNowJobId } from "./indexnow.ts";

type RecordValue = Record<string, any>;

function clone<T>(value: T): T {
	return structuredClone(value);
}

function matches(value: RecordValue, where?: Record<string, unknown>): boolean {
	return !where || Object.entries(where).every(([key, expected]) => value[key] === expected);
}

function memoryCollection(onPut?: () => void) {
	const values = new Map<string, RecordValue>();
	const api: Record<string, any> = {
		get: async (id: string) => clone(values.get(id) ?? null),
		put: async (id: string, value: RecordValue) => {
			onPut?.();
			values.set(id, clone(value));
		},
		compareAndSet: async (
			id: string,
			expected:
				| { state: "missing" }
				| { state: "value"; value: RecordValue },
			next:
				| { action: "put"; value: RecordValue }
				| { action: "delete" },
		) => {
			const present = values.has(id);
			if (expected.state === "missing" ? present : !present) return false;
			if (
				expected.state === "value" &&
				JSON.stringify(values.get(id)) !== JSON.stringify(expected.value)
			)
				return false;
			if (next.action === "delete") return api.delete(id);
			await api.put(id, next.value);
			return true;
		},
		delete: async (id: string) => values.delete(id),
		exists: async (id: string) => values.has(id),
		getMany: async (ids: string[]) => new Map(ids.flatMap((id) => values.has(id) ? [[id, clone(values.get(id))]] : [])),
		putMany: async (items: Array<{ id: string; data: RecordValue }>) => {
			for (const item of items) await api.put(item.id, item.data);
		},
		deleteMany: async (ids: string[]) => {
			let deleted = 0;
			for (const id of ids) if (values.delete(id)) deleted += 1;
			return deleted;
		},
		count: async (where?: Record<string, unknown>) => [...values.values()].filter((value) => matches(value, where)).length,
		query: async (
			options: {
				where?: Record<string, unknown>;
				orderBy?: Record<string, "asc" | "desc">;
				limit?: number;
				cursor?: string;
			} = {},
		) => {
			const order = Object.entries(options.orderBy ?? {})[0];
			const filtered = [...values.entries()].filter(([, value]) => matches(value, options.where));
			if (order) {
				const [field, direction] = order;
				filtered.sort((left, right) => {
					const compared = String(left[1][field] ?? "").localeCompare(String(right[1][field] ?? ""));
					return direction === "asc" ? compared : -compared;
				});
			}
			const start = Number.parseInt(options.cursor ?? "0", 10) || 0;
			const limit = Math.min(options.limit ?? 50, 100);
			const page = filtered.slice(start, start + limit);
			const hasMore = start + limit < filtered.length;
			return {
				items: page.map(([id, data]) => ({ id, data: clone(data) })),
				cursor: hasMore ? String(start + limit) : undefined,
				hasMore,
			};
		},
	};
	return {
		values,
		api,
	};
}

function route(input: unknown = {}) {
	return {
		input,
		request: {
			url: "https://example.com/_emdash/api/plugins/shipit-seo/indexnow",
			method: "POST",
			headers: {},
		},
	};
}

function handler(name: string) {
	return (seoRuntime as any).routes[name].handler as (routeContext: any, context: any) => Promise<any>;
}

assert.equal(
	nextIndexNowSettingsUpdatedAt(
		"2026-08-14T10:00:00.000Z",
		new Date("2026-08-14T10:00:00.000Z"),
	),
	"2026-08-14T10:00:00.001Z",
	"settings revisions must advance when serialized writes share one clock tick",
);

const kv = new Map<string, unknown>([["settings:siteUrl", "https://example.com"], ["settings:noindex", false]]);
let jobWrites = 0;
const jobStorage = memoryCollection(() => { jobWrites += 1; });
const deliveryStorage = memoryCollection();
const operationLeaseStorage = memoryCollection();
const scheduled = new Map<string, { name: string; schedule: string; nextRunAt: string; lastRunAt: null }>();
const requests: Array<{ url: string; payload: any }> = [];
const responseStatuses = [202, 429, 200, 200, 403, 200];
const content = new Map<string, any>([[
	"pages:old-page",
	{ id: "old-page", slug: "retired", status: "published", data: { title: "Retired page" } },
]]);
const discoverableCollections = [
	{ slug: "pages", label: "Pages", hasSeo: true, routable: true, hidden: false, urlPattern: "/{slug}" },
	{ slug: "posts", label: "Posts", hasSeo: true, routable: true, hidden: false, urlPattern: "/blog/{slug}" },
	{ slug: "internal", label: "Internal", hasSeo: true, routable: true, hidden: true, urlPattern: "/internal/{slug}" },
	{ slug: "assets", label: "Assets", hasSeo: false, routable: true, hidden: false, urlPattern: "/assets/{slug}" },
];

const missingLeaseCasStorage = memoryCollection();
missingLeaseCasStorage.api.compareAndSet = undefined as any;
let missingLeaseCasOperationRan = false;
const missingLeaseCasResult = await withOperationLease(
	{
		plugin: { id: "shipit-seo-missing-lease-cas" },
		site: { url: "https://example.com" },
		storage: { operationLeases: missingLeaseCasStorage.api },
		log: { warn: () => undefined },
	} as any,
	"missing-lease-cas",
	async () => {
		missingLeaseCasOperationRan = true;
	},
);
assert.equal(missingLeaseCasResult.acquired, false);
assert.equal(
	missingLeaseCasResult.acquired ? null : missingLeaseCasResult.reason,
	"unavailable",
);
assert.equal(
	missingLeaseCasOperationRan,
	false,
	"durable operations must fail closed without lease CAS",
);

const context = {
	plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
	kv: {
		get: async (key: string) => clone(kv.get(key) ?? null),
		// Versioned reads only: the IndexNow settings keep their non-versioned write path here.
		getVersioned: async (key: string) => kv.has(key) ? { value: clone(kv.get(key)), revision: "r1" } : null,
		set: async (key: string, value: unknown) => { kv.set(key, clone(value)); },
		delete: async (key: string) => kv.delete(key),
		list: async () => [],
	},
	storage: {
		indexnowJobs: jobStorage.api,
		indexnowDeliveries: deliveryStorage.api,
		operationLeases: operationLeaseStorage.api,
	},
	content: {
		get: async (collection: string, id: string) => clone(content.get(`${collection}:${id}`) ?? null),
		listCollections: async () => clone(discoverableCollections),
		getPublicUrl: async (collection: string, id: string) => {
			const definition = discoverableCollections.find((item) => item.slug === collection);
			const slug = content.get(`${collection}:${id}`)?.slug ?? id;
			const pattern = definition?.urlPattern;
			return pattern?.includes("{slug}")
				? new URL(pattern.replaceAll("{slug}", encodeURIComponent(slug)), "https://example.com").href
				: null;
		},
	},
	schema: {
		listCollections: async () => clone(discoverableCollections),
	},
	http: {
		fetch: async (url: string, init: RequestInit) => {
			const payload = JSON.parse(String(init.body ?? "{}"));
			requests.push({ url, payload });
			const status = responseStatuses.shift();
			assert.ok(status, "unexpected IndexNow request");
			return new Response(null, {
				status,
				headers: status === 429 ? { "Retry-After": "120" } : {},
			});
		},
	},
	cron: {
		schedule: async (name: string, options: { schedule: string }) => {
			scheduled.set(name, { name, schedule: options.schedule, nextRunAt: options.schedule, lastRunAt: null });
		},
		cancel: async (name: string) => { scheduled.delete(name); },
		list: async () => [...scheduled.values()].map(clone),
	},
	url: (path: string) => new URL(path, "https://example.com").href,
	site: { name: "Example", url: "https://example.com", locale: "en" },
	log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
};

const generatedFromDirtyDraft = await handler("generate-admin-indexnow-key")(
	route({
		...defaultIndexNowSettings(),
		enabled: true,
		batchSize: 321,
	}),
	context,
);
assert.equal(generatedFromDirtyDraft.success, true);
const generatedKey = generatedFromDirtyDraft.indexNow.values.apiKey;
assert.ok(generatedKey, "key generation must persist a non-empty key");
assert.deepEqual(
	generatedFromDirtyDraft.indexNow.values,
	{ ...defaultIndexNowSettings(), apiKey: generatedKey },
	"key generation must ignore unrelated caller settings",
);
const generatedStatus = await handler("admin-indexnow")(route(), context);
assert.deepEqual(
	generatedStatus.values,
	{ ...defaultIndexNowSettings(), apiKey: generatedKey },
	"only the generated key may change in persisted settings",
);
// An installation saved before this version: automatic submission on for
// every eligible type (null), which upgrades keep as saved.
const settings = {
	...defaultIndexNowSettings(),
	enabled: true,
	autoSubmit: true,
	autoSubmitContentTypes: null,
	apiKey: "runtime-check-key-123",
	batchSize: 100,
};
const staleSettingsSave = await handler("save-admin-indexnow")(
	route({ ...settings, expectedUpdatedAt: "1970-01-01T00:00:00.000Z" }),
	context,
);
assert.equal(staleSettingsSave.success, false);
assert.match(staleSettingsSave.errors._form, /changed in another session/i);
assert.deepEqual(
	(await handler("admin-indexnow")(route(), context)).values,
	generatedStatus.values,
	"a stale settings form must not overwrite the generated key",
);

const disabled = await handler("submit-admin-indexnow")(
	route({ urls: ["https://example.com/disabled"], force: false, deliverNow: true }),
	context,
);
assert.equal(disabled.success, false);
assert.equal(disabled.error, "indexnow_disabled");
assert.equal(jobWrites, 0);
assert.equal(requests.length, 0);

const saved = await handler("save-admin-indexnow")(
	route({ ...settings, expectedUpdatedAt: generatedStatus.updatedAt }),
	context,
);
assert.equal(saved.success, true);
assert.equal(saved.indexNow.contentTypeDiscoveryAvailable, true);
assert.deepEqual(saved.indexNow.contentTypes.map((item: any) => item.collection), ["pages", "posts"]);
const unsupportedSelection = await handler("save-admin-indexnow")(
	route({ ...saved.indexNow.values, autoSubmitContentTypes: ["internal"], expectedUpdatedAt: saved.indexNow.updatedAt }),
	context,
);
assert.equal(unsupportedSelection.success, false);
assert.equal((await handler("admin-indexnow")(route(), context)).updatedAt, saved.indexNow.updatedAt);
assert.equal(saved.indexNow.readiness.state, "needs-setup");
assert.equal(saved.indexNow.manualSubmissionReady, false);
const staleKeyGeneration = await handler("generate-admin-indexnow-key")(
	route({ expectedUpdatedAt: generatedStatus.updatedAt }),
	context,
);
assert.equal(staleKeyGeneration.success, false);
assert.match(staleKeyGeneration.errors._form, /changed in another session/i);
assert.deepEqual(
	(await handler("admin-indexnow")(route(), context)).values,
	saved.indexNow.values,
	"key generation from a stale editor must not rebase and overwrite its draft",
);
assert.equal(saved.indexNow.queue.pending, 0);

const publicKey = await handler("public-indexnow-key")(route(), context);
assert.deepEqual(publicKey, { configured: true, key: settings.apiKey });
const unverifiedSubmission = await handler("submit-admin-indexnow")(
	route({ urls: ["/unverified"], force: false, deliverNow: true }),
	context,
);
assert.equal(unverifiedSubmission.success, false);
assert.equal(unverifiedSubmission.error, "indexnow_not_configured");
assert.equal(jobWrites, 0);
assert.equal(requests.length, 0);
const savedSettings = kv.get(INDEXNOW_SETTINGS_STORAGE_KEY) as RecordValue;
kv.set(INDEXNOW_SETTINGS_STORAGE_KEY, {
	...savedSettings,
	verification: {
		siteOrigin: "https://example.com",
		keyLocation: settings.keyLocation,
		apiKey: settings.apiKey,
		checkedAt: new Date().toISOString(),
	},
});
assert.equal((await handler("admin-indexnow")(route(), context)).readiness.state, "ready");
assert.equal((await handler("admin-indexnow")(route(), context)).manualSubmissionReady, true);
const beforeEmptySelection = await handler("admin-indexnow")(route(), context);
const emptySelection = await handler("save-admin-indexnow")(
	route({ ...beforeEmptySelection.values, autoSubmitContentTypes: [], expectedUpdatedAt: beforeEmptySelection.updatedAt }),
	context,
);
assert.equal(emptySelection.success, true);
assert.equal(emptySelection.indexNow.readiness.title, "Manual delivery is ready");
assert.equal(emptySelection.indexNow.manualSubmissionReady, true);
const restoredSelection = await handler("save-admin-indexnow")(
	route({ ...emptySelection.indexNow.values, autoSubmitContentTypes: null, expectedUpdatedAt: emptySelection.indexNow.updatedAt }),
	context,
);
assert.equal(restoredSelection.success, true);
assert.equal(restoredSelection.indexNow.readiness.title, "Automatic delivery is ready");

let discoveryAttempts = 0;
const transientDiscoveryContext = {
	...context,
	schema: {
		listCollections: async () => {
			discoveryAttempts += 1;
			if (discoveryAttempts === 1) throw new Error("Temporary discovery failure");
			return clone(discoverableCollections);
		},
	},
};
const discoveryFailed = await handler("admin-indexnow")(route(), transientDiscoveryContext);
assert.equal(discoveryFailed.contentTypeDiscoveryAvailable, false);
assert.equal(discoveryFailed.readiness.title, "Automatic notifications unavailable");
assert.equal(discoveryFailed.manualSubmissionReady, true);
const discoveryRecovered = await handler("admin-indexnow")(route(), transientDiscoveryContext);
assert.equal(discoveryRecovered.contentTypeDiscoveryAvailable, true);
assert.equal(discoveryRecovered.readiness.title, "Automatic delivery is ready");
assert.equal(discoveryAttempts, 2);

const beforeStaleSelection = await handler("admin-indexnow")(route(), context);
const selectedBeforeRemoval = await handler("save-admin-indexnow")(
	route({ ...beforeStaleSelection.values, autoSubmitContentTypes: ["pages", "posts"], expectedUpdatedAt: beforeStaleSelection.updatedAt }),
	context,
);
assert.equal(selectedBeforeRemoval.success, true);
const removedCollectionContext = {
	...context,
	schema: { listCollections: async () => clone(discoverableCollections.filter((definition) => definition.slug !== "posts")) },
};
const afterRemoval = await handler("admin-indexnow")(route(), removedCollectionContext);
assert.deepEqual(afterRemoval.contentTypes.map((item: any) => item.collection), ["pages"]);
const staleSelectionTurnOff = await handler("save-admin-indexnow")(
	route({ ...afterRemoval.values, autoSubmit: false, expectedUpdatedAt: afterRemoval.updatedAt }),
	removedCollectionContext,
);
assert.equal(staleSelectionTurnOff.success, true, "a stored type that disappeared must not block turning automatic submission off");
assert.deepEqual(staleSelectionTurnOff.indexNow.values.autoSubmitContentTypes, ["pages", "posts"]);
const newUnknownSelection = await handler("save-admin-indexnow")(
	route({ ...staleSelectionTurnOff.indexNow.values, autoSubmitContentTypes: ["pages", "posts", "archive"], expectedUpdatedAt: staleSelectionTurnOff.indexNow.updatedAt }),
	removedCollectionContext,
);
assert.equal(newUnknownSelection.success, false, "a newly added unknown type is still rejected");
const prunedSelection = await handler("save-admin-indexnow")(
	route({ ...staleSelectionTurnOff.indexNow.values, autoSubmitContentTypes: ["pages"], batchSize: 19, expectedUpdatedAt: staleSelectionTurnOff.indexNow.updatedAt }),
	removedCollectionContext,
);
assert.equal(prunedSelection.success, true);
const selectionForFollowingTests = await handler("save-admin-indexnow")(
	route({ ...prunedSelection.indexNow.values, autoSubmit: true, autoSubmitContentTypes: null, batchSize: 100, expectedUpdatedAt: prunedSelection.indexNow.updatedAt }),
	context,
);
assert.equal(selectionForFollowingTests.success, true);

const crossHost = await handler("submit-admin-indexnow")(
	route({ urls: ["https://other.example/private"], force: false, deliverNow: true }),
	context,
);
assert.equal(crossHost.success, false);
assert.equal(crossHost.error, "no_valid_urls");
assert.equal(jobWrites, 0);
assert.equal(requests.length, 0);

const accepted = await handler("submit-admin-indexnow")(
	route({ urls: ["https://example.com/accepted#fragment"], force: false, deliverNow: true }),
	context,
);
assert.equal(accepted.success, true);
assert.equal(accepted.indexNow.queue.delivered, 1);
assert.equal(requests[0]?.url, "https://api.indexnow.org/indexnow");
assert.deepEqual(requests[0]?.payload.urlList, ["https://example.com/accepted"]);
assert.equal(requests[0]?.payload.host, "example.com");
assert.equal(requests[0]?.payload.keyLocation, "https://example.com/indexnow-key.txt");
assert.equal(scheduled.size, 0, "immediate delivery should clear its stale drain task");

const duplicate = await handler("submit-admin-indexnow")(
	route({ urls: ["/accepted"], force: false, deliverNow: true }),
	context,
);
assert.equal(duplicate.success, true);
assert.equal(duplicate.enqueued, 0);
assert.equal(duplicate.skipped, 1);
assert.equal(requests.length, 1, "recently delivered URLs must not be submitted twice");

const rateLimited = await handler("submit-admin-indexnow")(
	route({ urls: ["/rate-limited"], force: false, deliverNow: true }),
	context,
);
assert.equal(rateLimited.success, true);
assert.equal(rateLimited.indexNow.queue.retrying, 1);
const retryJob = [...jobStorage.values.values()].find((job) => job.url.endsWith("/rate-limited"));
assert.equal(retryJob?.status, "retry");
assert.ok(Date.parse(retryJob?.nextAttemptAt) - Date.parse(retryJob?.lastSubmittedAt) >= 300_000);
assert.equal(scheduled.size, 1, "retry should retain one background drain task");

const retryAtBeforeManualSubmit = retryJob?.nextAttemptAt;
const freshWhileRetrying = await handler("submit-admin-indexnow")(
	route({ urls: ["/fresh-while-retrying"], force: false, deliverNow: true }),
	context,
);
assert.equal(freshWhileRetrying.success, true);
assert.equal(freshWhileRetrying.indexNow.queue.retrying, 1);
assert.equal(freshWhileRetrying.indexNow.queue.delivered, 2);
assert.deepEqual(requests[2]?.payload.urlList, ["https://example.com/fresh-while-retrying"]);
assert.equal(requests.length, 3, "manual delivery must not retry a URL before its backoff expires");
const retryAfterManualSubmit = jobStorage.values.get(indexNowJobId("https://example.com/rate-limited"));
assert.equal(retryAfterManualSubmit?.status, "retry");
assert.equal(retryAfterManualSubmit?.attempts, 1);
assert.equal(retryAfterManualSubmit?.nextAttemptAt, retryAtBeforeManualSubmit);

const drained = await handler("drain-admin-indexnow")(route({ force: true }), context);
assert.equal(drained.success, true);
assert.equal(drained.indexNow.queue.retrying, 0);
assert.equal(drained.indexNow.queue.delivered, 3);
assert.equal(scheduled.size, 0);

const forbidden = await handler("submit-admin-indexnow")(
	route({ urls: ["/forbidden"], force: false, deliverNow: true }),
	context,
);
assert.equal(forbidden.success, false);
assert.equal(forbidden.error, "delivery_failed");
assert.equal(forbidden.indexNow.queue.failed, 1);

const retried = await handler("retry-admin-indexnow")(route({ deliverNow: true }), context);
assert.equal(retried.success, true);
assert.equal(retried.indexNow.queue.failed, 0);
assert.equal(retried.indexNow.queue.delivered, 4);

const hooks = (seoRuntime as any).hooks;
const beforeSelection = await handler("admin-indexnow")(route(), context);
const selectedTypes = await handler("save-admin-indexnow")(
	route({ ...beforeSelection.values, autoSubmitContentTypes: ["pages"], expectedUpdatedAt: beforeSelection.updatedAt }),
	context,
);
assert.equal(selectedTypes.success, true);
const recentlySubmittedId = indexNowJobId("https://example.com/accepted");
assert.equal(jobStorage.values.get(recentlySubmittedId)?.status, "delivered");
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "accepted", slug: "accepted", status: "published", data: {} },
}, context);
assert.equal(jobStorage.values.get(recentlySubmittedId)?.status, "delivered", "the normal resubmission interval still applies to publishes");
await hooks["content:afterUnpublish"].handler({
	collection: "pages",
	content: { id: "accepted", slug: "accepted", status: "draft", data: {} },
}, context);
assert.equal(jobStorage.values.get(recentlySubmittedId)?.reason, "unpublish");
assert.equal(jobStorage.values.get(recentlySubmittedId)?.status, "pending", "removal supersedes a recently delivered publish");
assert.equal(kv.has("state:indexnow-published-url:pages:accepted"), false);
const beforeExcludedEvent = jobStorage.values.size;
await hooks["content:afterPublish"].handler({
	collection: "posts",
	content: { id: "excluded-post", slug: "excluded-post", status: "published", data: {} },
}, context);
await hooks["content:afterPublish"].handler({
	collection: "internal",
	content: { id: "hidden", slug: "hidden", status: "published", data: {} },
}, context);
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "noindex", slug: "noindex", status: "published", seo: { noIndex: true }, data: {} },
}, context);
assert.equal(jobStorage.values.size, beforeExcludedEvent, "excluded and hidden content types must not enqueue URLs");
const excludedEntry = { id: "excluded-post", slug: "excluded-post", status: "published", data: {} };
content.set("posts:excluded-post", excludedEntry);
kv.set("state:indexnow-published-url:posts:excluded-post", { url: "https://example.com/posts/excluded-post" });
await hooks["content:afterSave"].handler({ collection: "posts", content: excludedEntry }, context);
await hooks["content:beforeUnpublish"].handler(
	{ collection: "posts", content: excludedEntry, origin: { source: "api" } },
	context,
);
await hooks["content:afterUnpublish"].handler({
	collection: "posts", content: { ...excludedEntry, status: "draft" },
}, context);
await hooks["content:beforeDelete"].handler({ collection: "posts", id: "excluded-post" }, context);
await hooks["content:afterDelete"].handler({ collection: "posts", id: "excluded-post" }, context);
await hooks["content:afterDelete"].handler({ collection: "posts", id: "excluded-post", permanent: true }, context);
content.delete("posts:excluded-post");
kv.delete("state:indexnow-published-url:posts:excluded-post");
assert.equal(
	jobStorage.values.size,
	beforeExcludedEvent,
	"an excluded content type enqueues nothing on update, unpublish, or either delete path",
);
kv.set("settings:noindex", true);
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "staging", slug: "staging", status: "published", data: {} },
}, context);
assert.equal(jobStorage.values.size, beforeExcludedEvent, "site-wide noindex must block automatic submission");
// Unreadable preferences skip enqueueing with a diagnostic, never a guessed default.
const gateWarnings: Array<{ message: string; detail: any }> = [];
const loggingContext = {
	...context,
	log: { ...context.log, warn: (message: string, detail: unknown) => void gateWarnings.push({ message, detail }) },
};
kv.set("settings:global:v1", { version: 1, updatedAt: "2026-10-03T00:00:00.000Z", noindex: "false" });
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "corrupt-settings", slug: "corrupt-settings", status: "published", data: {} },
}, loggingContext);
kv.delete("settings:global:v1");
const unreadableKv = { ...context.kv, getVersioned: async () => { throw new Error("database is locked"); } };
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "unreadable-settings", slug: "unreadable-settings", status: "published", data: {} },
}, { ...loggingContext, kv: unreadableKv });
assert.equal(jobStorage.values.size, beforeExcludedEvent, "corrupt or unreadable preferences enqueue nothing");
assert.deepEqual(
	gateWarnings
		.filter((item) => item.message.startsWith("seo:indexnow automatic notification skipped"))
		.map((item) => item.detail.state),
	["corrupt", "unavailable"],
	"each skipped notification is logged with its preference state",
);
kv.set("settings:noindex", false);
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "about", slug: "about", status: "published", data: {} },
}, context);
await hooks["content:afterUnpublish"].handler({
	collection: "pages",
	content: { id: "about", slug: "about", status: "draft", data: {} },
}, context);
const unpublished = [...jobStorage.values.values()].find((job) => job.url.endsWith("/about"));
assert.equal(unpublished?.reason, "unpublish");
assert.equal(unpublished?.status, "pending");
kv.delete("settings:noindex");
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "no-preference", slug: "no-preference", status: "published", data: {} },
}, context);
assert.equal(
	[...jobStorage.values.values()].find((job) => job.url.endsWith("/no-preference"))?.reason,
	"publish",
	"an absent indexing preference does not block automatic submission",
);
kv.set("settings:noindex", false);
let movedPublicUrl = "https://example.com/nl/2026/old-story/";
const movedRouteContext = {
	...context,
	content: {
		...context.content,
		getPublicUrl: async () => movedPublicUrl,
	},
};
const movedEntry = { id: "moved-story", slug: "old-story", status: "published", locale: "nl", data: {} };
await hooks["content:afterPublish"].handler({ collection: "pages", content: movedEntry }, movedRouteContext);
movedPublicUrl = "https://example.com/nl/2027/new-story/";
await hooks["content:afterSave"].handler({
	collection: "pages", content: { ...movedEntry, slug: "new-story" },
}, movedRouteContext);
assert.equal(jobStorage.values.get(indexNowJobId("https://example.com/nl/2026/old-story/"))?.reason, "unpublish");
assert.equal(jobStorage.values.get(indexNowJobId(movedPublicUrl))?.reason, "update");
assert.deepEqual(kv.get("state:indexnow-published-url:pages:moved-story"), { url: movedPublicUrl });
await hooks["content:afterUnpublish"].handler({
	collection: "pages", content: { ...movedEntry, slug: "new-story", status: "draft" },
}, movedRouteContext);
assert.equal(jobStorage.values.get(indexNowJobId(movedPublicUrl))?.reason, "unpublish");

content.set("pages:move-retry", { id: "move-retry", slug: "move-retry-old", status: "published", data: {} });
await hooks["content:afterPublish"].handler({
	collection: "pages", content: content.get("pages:move-retry"),
}, context);
content.set("pages:move-retry", { id: "move-retry", slug: "move-retry-new", status: "published", data: {} });
const failedMoveContext = {
	...context,
	storage: {
		...context.storage,
		indexnowJobs: {
			...jobStorage.api,
			compareAndSet: async (...args: any[]) => args[0] === indexNowJobId("https://example.com/move-retry-new")
				? false : jobStorage.api.compareAndSet(...args),
		},
	},
};
await hooks["content:afterSave"].handler({
	collection: "pages", content: content.get("pages:move-retry"),
}, failedMoveContext);
assert.deepEqual(kv.get("state:indexnow-published-url:pages:move-retry"), { url: "https://example.com/move-retry-old" });
assert.equal(jobStorage.values.has(indexNowJobId("https://example.com/move-retry-new")), false);
await hooks["content:afterSave"].handler({
	collection: "pages", content: content.get("pages:move-retry"),
}, context);
assert.deepEqual(kv.get("state:indexnow-published-url:pages:move-retry"), { url: "https://example.com/move-retry-new" });
assert.equal(jobStorage.values.get(indexNowJobId("https://example.com/move-retry-new"))?.reason, "update");
const draftOnlyEntry = { id: "draft-only", slug: "draft-only", status: "published", liveRevisionId: "r1", data: {} };
content.set("pages:draft-only", draftOnlyEntry);
await hooks["content:afterSave"].handler({
	collection: "pages", content: { ...draftOnlyEntry, draftRevisionId: "r2" },
}, context);
assert.equal(
	jobStorage.values.has(indexNowJobId("https://example.com/draft-only")),
	false,
	"a save that changes only the draft of a published entry is not submitted",
);
await hooks["content:afterSave"].handler({
	collection: "pages", content: { ...draftOnlyEntry, draftRevisionId: null },
}, context);
assert.equal(
	jobStorage.values.get(indexNowJobId("https://example.com/draft-only"))?.reason,
	"update",
	"a save of the live revision is still submitted",
);

await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "previously-public", slug: "previously-public", status: "published", data: {} },
}, context);
kv.set("settings:noindex", true);
await hooks["content:afterUnpublish"].handler({
	collection: "pages",
	content: { id: "previously-public", slug: "previously-public", status: "draft", seo: { noIndex: true }, data: {} },
}, context);
kv.set("settings:noindex", false);
assert.equal(
	[...jobStorage.values.values()].find((job) => job.url.endsWith("/previously-public"))?.reason,
	"unpublish",
	"unpublishing must announce removal even when the new content state is noindex",
);

assert.ok(hooks["content:beforeUnpublish"], "unpublishing must capture URLs for entries published before snapshot tracking");
assert.equal(hooks["content:beforeUnpublish"].errorPolicy, "continue", "a capture failure must never block an unpublish");
const legacyPublished = { id: "unpublished-before-upgrade", slug: "legacy-unpublish", status: "published", data: {} };
content.set("pages:unpublished-before-upgrade", legacyPublished);
assert.equal(kv.has("state:indexnow-published-url:pages:unpublished-before-upgrade"), false);
const unpublishDecision = await hooks["content:beforeUnpublish"].handler(
	{ collection: "pages", content: clone(legacyPublished), origin: { source: "api" } },
	context,
);
assert.equal(unpublishDecision, undefined, "the URL capture never cancels an unpublish");
const legacyUnpublished = { ...legacyPublished, status: "draft" };
content.set("pages:unpublished-before-upgrade", legacyUnpublished);
await hooks["content:afterUnpublish"].handler({ collection: "pages", content: clone(legacyUnpublished) }, context);
const legacyUnpublishJob = jobStorage.values.get(indexNowJobId("https://example.com/legacy-unpublish"));
assert.equal(legacyUnpublishJob?.reason, "unpublish", "the first unpublish of pre-snapshot content is announced");
assert.equal(kv.has("state:indexnow-published-url:pages:unpublished-before-upgrade"), false);
const failingKvContext = {
	...context,
	kv: { ...context.kv, get: async () => { throw new Error("kv unavailable"); } },
};
assert.equal(
	await hooks["content:beforeUnpublish"].handler(
		{ collection: "pages", content: clone(legacyPublished), origin: { source: "api" } },
		failingKvContext,
	),
	undefined,
	"a failing capture resolves without cancelling",
);

assert.ok(hooks["content:beforeDelete"], "deletion must capture URLs for entries published before snapshot tracking");
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: content.get("pages:old-page"),
}, context);
await hooks["content:beforeDelete"].handler({ collection: "pages", id: "old-page" }, context);
content.delete("pages:old-page");
await hooks["content:afterDelete"].handler({ collection: "pages", id: "old-page" }, context);
const deleted = [...jobStorage.values.values()].find((job) => job.url.endsWith("/retired"));
assert.equal(deleted?.reason, "delete");
assert.equal(deleted?.status, "pending");
content.set("pages:published-before-upgrade", {
	id: "published-before-upgrade", slug: "pre-upgrade", status: "published", data: {},
});
assert.equal(kv.has("state:indexnow-published-url:pages:published-before-upgrade"), false);
await hooks["content:beforeDelete"].handler({ collection: "pages", id: "published-before-upgrade" }, context);
assert.deepEqual(kv.get("state:indexnow-published-url:pages:published-before-upgrade"), {
	url: "https://example.com/pre-upgrade",
});
content.delete("pages:published-before-upgrade");
await hooks["content:afterDelete"].handler({ collection: "pages", id: "published-before-upgrade" }, context);
assert.equal(jobStorage.values.get(indexNowJobId("https://example.com/pre-upgrade"))?.reason, "delete");
assert.equal(kv.has("state:indexnow-published-url:pages:published-before-upgrade"), false);
content.set("pages:removed-during-noindex", {
	id: "removed-during-noindex", slug: "removed-during-noindex", status: "published", data: {},
});
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: content.get("pages:removed-during-noindex"),
}, context);
content.delete("pages:removed-during-noindex");
kv.set("settings:noindex", true);
await hooks["content:afterDelete"].handler({ collection: "pages", id: "removed-during-noindex" }, context);
kv.set("settings:noindex", false);
assert.equal(
	[...jobStorage.values.values()].find((job) => job.url.endsWith("/removed-during-noindex"))?.reason,
	"delete",
	"a captured public URL should still be announced after site noindex changes",
);
content.set("pages:draft-page", { id: "draft-page", slug: "draft-page", status: "draft", data: {} });
await hooks["content:beforeDelete"].handler({ collection: "pages", id: "draft-page" }, context);
assert.equal(kv.has("state:indexnow-published-url:pages:draft-page"), false);
content.delete("pages:draft-page");
await hooks["content:afterDelete"].handler({ collection: "pages", id: "draft-page" }, context);
assert.equal([...jobStorage.values.values()].some((job) => job.url.endsWith("/draft-page")), false,
	"deleting a draft must not announce a URL that was never public");
await hooks["content:afterDelete"].handler({ collection: "pages", id: "missing-snapshot" }, context);
assert.equal([...jobStorage.values.values()].some((job) => job.url.endsWith("/missing-snapshot")), false,
	"deleting without a captured public URL must not guess a URL");

let dateRoutePublished = true;
const dateRouteContext = {
	...context,
	schema: { listCollections: async () => [{
		slug: "pages", label: "Pages", hasSeo: true, routable: true, hidden: false,
		urlPattern: "/news/{year}/{slug}",
	}] },
	content: {
		...context.content,
		getPublicUrl: async (_collection: string, id: string) =>
			dateRoutePublished && id === "dated-page" ? "https://example.com/news/2026/story" : null,
	},
};
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "dated-page", slug: "story", status: "published", publishedAt: "2026-09-25T12:00:00Z", data: {} },
}, dateRouteContext);
dateRoutePublished = false;
await hooks["content:afterUnpublish"].handler({
	collection: "pages",
	content: { id: "dated-page", slug: "story", status: "draft", publishedAt: "2026-09-25T12:00:00Z", data: {} },
}, dateRouteContext);
const datedUnpublish = jobStorage.values.get(indexNowJobId("https://example.com/news/2026/story"));
assert.equal(datedUnpublish?.reason, "unpublish", "unpublish uses the published URL with its date tokens resolved");
assert.equal([...jobStorage.values.values()].some((job) => job.url.includes("%7Byear%7D")), false);
const beforeUnknownDate = jobStorage.values.size;
await hooks["content:afterUnpublish"].handler({
	collection: "pages",
	content: { id: "old-dated-page", slug: "old-story", status: "draft", data: {} },
}, dateRouteContext);
assert.equal(jobStorage.values.size, beforeUnknownDate, "unpublish without a captured URL must not guess a date route");
const noPublicUrlContext = { ...dateRouteContext, content: { get: context.content.get } };
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "guessed-date", slug: "guess", status: "published", data: {} },
}, noPublicUrlContext);
assert.equal(jobStorage.values.size, beforeUnknownDate, "publish without a host URL must not submit unresolved route tokens");
const missingPublicUrlContext = {
	...context,
	schema: { listCollections: async () => [{
		slug: "pages", label: "Pages", hasSeo: true, routable: true, hidden: false,
		urlPattern: "/{slug}",
	}] },
	content: { get: context.content.get },
};
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "encoded-slug", slug: "a/b", status: "published", data: {} },
}, missingPublicUrlContext);
assert.equal(
	jobStorage.values.has(indexNowJobId("https://example.com/a%2Fb")),
	false,
	"a published URL must not be guessed when the host URL resolver is unavailable",
);

let localeRoutePublished = true;
const localeRouteContext = {
	...context,
	site: { ...context.site, locale: "nl", trailingSlash: "always" as const },
	schema: { listCollections: async () => [{
		slug: "pages", label: "Pages", hasSeo: true, routable: true, hidden: false,
		urlPattern: "/{slug}",
	}] },
	content: {
		...context.content,
		getPublicUrl: async (_collection: string, id: string) =>
			localeRoutePublished && id === "locale-page" ? "https://example.com/nl/over-ons/" : null,
	},
};
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "locale-page", slug: "over-ons", status: "published", locale: "nl", data: {} },
}, localeRouteContext);
localeRoutePublished = false;
await hooks["content:afterUnpublish"].handler({
	collection: "pages",
	content: { id: "locale-page", slug: "over-ons", status: "draft", locale: "nl", data: {} },
}, localeRouteContext);
assert.equal(
	jobStorage.values.get(indexNowJobId("https://example.com/nl/over-ons/"))?.reason,
	"unpublish",
	"unpublish preserves the localized public URL and trailing slash",
);
assert.equal([...jobStorage.values.values()].some((job) => job.url === "https://example.com/over-ons"), false);

const failedSnapshotContext = {
	...context,
	kv: {
		...context.kv,
		set: async (key: string, value: unknown) => {
			if (key.startsWith("state:indexnow-published-url:")) throw new Error("Snapshot store unavailable");
			await context.kv.set(key, value);
		},
	},
};
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "snapshot-failure", slug: "snapshot-failure", status: "published", data: {} },
}, failedSnapshotContext);
assert.equal(
	jobStorage.values.get(indexNowJobId("https://example.com/snapshot-failure"))?.reason,
	"publish",
	"a failed URL snapshot must not block the publish notification",
);

const retrySnapshotKey = "state:indexnow-published-url:pages:retryable";
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "retryable", slug: "retryable", status: "published", data: {} },
}, context);
const unavailableLeaseContext = {
	...context,
	storage: {
		...context.storage,
		operationLeases: { ...operationLeaseStorage.api, compareAndSet: undefined },
	},
};
const retryableUnpublish = {
	collection: "pages",
	content: { id: "retryable", slug: "retryable", status: "draft", data: {} },
};
await hooks["content:afterUnpublish"].handler(retryableUnpublish, unavailableLeaseContext);
assert.equal(kv.has(retrySnapshotKey), true, "a failed queue write retains the URL for retry");
assert.equal(jobStorage.values.get(indexNowJobId("https://example.com/retryable"))?.reason, "publish");
await hooks["content:afterUnpublish"].handler(retryableUnpublish, context);
assert.equal(jobStorage.values.get(indexNowJobId("https://example.com/retryable"))?.reason, "unpublish");
assert.equal(kv.has(retrySnapshotKey), false, "a queued unpublish clears its saved URL");
const undiscoveredContext = { ...context, schema: undefined, content: { get: context.content.get } };
assert.equal((await handler("admin-indexnow")(route(), undiscoveredContext)).contentTypeDiscoveryAvailable, false);
const beforeUndiscovered = jobStorage.values.size;
await hooks["content:afterPublish"].handler({
	collection: "pages",
	content: { id: "unverified", slug: "unverified", status: "published", data: {} },
}, undiscoveredContext);
assert.equal(jobStorage.values.size, beforeUndiscovered,
	"automatic submissions require verified public collection discovery");
assert.equal(scheduled.size, 1, "multiple automatic events should coalesce into one drain task");

assert.equal(responseStatuses.length, 0);
assert.equal(deliveryStorage.values.size, 6);
const rateLimitedDeliveries = [...deliveryStorage.values.values()]
	.filter((delivery) => delivery.urls.includes("https://example.com/rate-limited"))
	.sort((left, right) => left.attempt - right.attempt);
assert.deepEqual(rateLimitedDeliveries.map((delivery) => delivery.attempt), [1, 2]);
const deliveryJson = JSON.stringify([...deliveryStorage.values.values()]);
assert.equal(deliveryJson.includes(settings.apiKey), false, "delivery records must never persist the API key");
assert.equal(deliveryJson.includes("runtime-check-key"), false);

// A blocked network request keeps one durable owner. A concurrent drain must
// wait for that owner and then observe the already-delivered job instead of
// submitting the same URL twice.
let releaseConcurrentRequest!: () => void;
let markConcurrentRequestStarted!: () => void;
const concurrentRequestGate = new Promise<void>((resolve) => {
	releaseConcurrentRequest = resolve;
});
const concurrentRequestStarted = new Promise<void>((resolve) => {
	markConcurrentRequestStarted = resolve;
});
let concurrentRequests = 0;
const concurrentFetch = async () => {
	concurrentRequests += 1;
	if (concurrentRequests === 1) {
		markConcurrentRequestStarted();
		await concurrentRequestGate;
	}
	return new Response(null, { status: 202 });
};
context.http.fetch = concurrentFetch;

const queuedConcurrent = await handler("submit-admin-indexnow")(
	route({ urls: ["/concurrent"], force: true, deliverNow: false }),
	context,
);
assert.equal(queuedConcurrent.success, true);
const firstConcurrentDrain = handler("drain-admin-indexnow")(
	route({ force: true }),
	context,
);
await concurrentRequestStarted;
// A distinct plugin ID gives this test a separate module-local lock key while
// sharing the same durable collections, simulating another Workerd isolate.
const secondIsolateContext = {
	...context,
	plugin: { ...context.plugin, id: "shipit-seo-second-isolate" },
};
const secondConcurrentDrain = handler("drain-admin-indexnow")(
	route({ force: true }),
	secondIsolateContext,
);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(
	concurrentRequests,
	1,
	"a concurrent drain must not submit a leased URL twice",
);
const activeLeases = [...operationLeaseStorage.values.values()].filter(
	(lease) => lease.scope === "indexnow:queue",
);
assert.equal(
	activeLeases.length,
	2,
	"both isolate contenders must be visible in durable storage",
);
assert.equal(
	activeLeases.filter((lease) => lease.choosing).length,
	0,
	"durable contenders must finish ticket selection while waiting",
);
assert.ok(
	activeLeases.every((lease) => lease.ownerToken === lease.id),
	"every durable contender must carry its unique owner token",
);
releaseConcurrentRequest();
const [firstConcurrentResult, secondConcurrentResult] = await Promise.all([
	firstConcurrentDrain,
	secondConcurrentDrain,
]);
assert.equal(firstConcurrentResult.success, true);
assert.equal(secondConcurrentResult.success, false);
assert.equal(secondConcurrentResult.error, "no_due_jobs");
assert.equal(
	concurrentRequests,
	1,
	"a repeated drain must observe the first deterministic delivery result",
);
assert.equal(
	operationLeaseStorage.values.size,
	0,
	"the queue owner must release its durable lease",
);
const concurrentJob = [...jobStorage.values.values()].find((job) =>
	job.url.endsWith("/concurrent"),
);
assert.equal(concurrentJob?.status, "delivered");
assert.equal(
	concurrentJob?.attempts,
	1,
	"a leased job must advance exactly one attempt",
);

// Losing the durable owner settles a pending transport before its response
// arrives, without advancing queue or delivery history.
const queuedLeaseLoss = await handler("submit-admin-indexnow")(
	route({ urls: ["/lease-lost-during-request"], force: true, deliverNow: false }),
	context,
);
assert.equal(queuedLeaseLoss.success, true);
const leaseLossJobEntry = [...jobStorage.values.entries()].find(([, job]) =>
	job.url.endsWith("/lease-lost-during-request"),
);
assert.ok(leaseLossJobEntry, "the lease-loss job must be queued");
const [leaseLossJobId, leaseLossJobBefore] = leaseLossJobEntry;
const deliveryCountBeforeLeaseLoss = deliveryStorage.values.size;
let releaseLeaseLossRequest!: () => void;
let markLeaseLossRequestStarted!: () => void;
let leaseLossRequestSignal: AbortSignal | undefined;
const leaseLossRequestGate = new Promise<void>((resolve) => {
	releaseLeaseLossRequest = resolve;
});
const leaseLossRequestStarted = new Promise<void>((resolve) => {
	markLeaseLossRequestStarted = resolve;
});
context.http.fetch = async (_url: string, init: RequestInit) => {
	leaseLossRequestSignal = init.signal ?? undefined;
	markLeaseLossRequestStarted();
	await leaseLossRequestGate;
	return new Response(null, { status: 202 });
};
const leaseLossSetInterval = globalThis.setInterval;
let leaseLossHeartbeat: (() => void) | undefined;
globalThis.setInterval = ((callback: () => void, milliseconds?: number, ...args: unknown[]) => {
	if (milliseconds === 40_000) leaseLossHeartbeat = callback;
	return leaseLossSetInterval(callback, milliseconds, ...args);
}) as unknown as typeof setInterval;
const leaseLossDrain = handler("drain-admin-indexnow")(
	route({ force: true }),
	context,
);
let leaseLossResult: any;
let leaseLossSettlementTimer: ReturnType<typeof setTimeout> | undefined;
try {
	await leaseLossRequestStarted;
	globalThis.setInterval = leaseLossSetInterval;
	const leaseLossOwner = [...operationLeaseStorage.values.entries()].find(
		([, lease]) => lease.scope === "indexnow:queue",
	);
	assert.ok(leaseLossOwner, "the delivery must publish its durable owner");
	operationLeaseStorage.values.delete(leaseLossOwner[0]);
	assert.ok(leaseLossHeartbeat, "the durable owner renews on its heartbeat");
	leaseLossHeartbeat();
	leaseLossResult = await Promise.race([leaseLossDrain, new Promise<never>((_resolve, reject) => {
		leaseLossSettlementTimer = setTimeout(() => reject(new Error("A lost lease did not settle its pending transport.")), 250);
	})]);
} finally {
	globalThis.setInterval = leaseLossSetInterval;
	clearTimeout(leaseLossSettlementTimer);
	releaseLeaseLossRequest();
	await leaseLossDrain;
}
assert.equal(leaseLossResult.success, false);
assert.equal(leaseLossResult.error, "delivery_in_progress");
assert.ok(leaseLossRequestSignal, "the HTTP request must receive cancellation for the owner");
assert.equal(
	leaseLossRequestSignal.aborted,
	true,
	"pending transport is aborted as soon as the heartbeat discovers ownership loss",
);
assert.deepEqual(
	jobStorage.values.get(leaseLossJobId),
	leaseLossJobBefore,
	"a stale owner must not advance queue state",
);
assert.equal(
	deliveryStorage.values.size,
	deliveryCountBeforeLeaseLoss,
	"a stale owner must not append delivery history",
);
jobStorage.values.delete(leaseLossJobId);
scheduled.clear();
context.http.fetch = concurrentFetch;

const queuedPersistenceLoss = await handler("submit-admin-indexnow")(
	route({
		urls: [
			"/lease-lost-after-first-write-a",
			"/lease-lost-after-first-write-b",
		],
		force: true,
		deliverNow: false,
	}),
	context,
);
assert.equal(queuedPersistenceLoss.success, true);
const persistenceLossEntries = [...jobStorage.values.entries()].filter(([, job]) =>
	job.url.includes("/lease-lost-after-first-write-"),
);
assert.equal(persistenceLossEntries.length, 2);
const persistenceLossBefore = new Map(
	persistenceLossEntries.map(([id, job]) => [id, clone(job)]),
);
const deliveryCountBeforePersistenceLoss = deliveryStorage.values.size;
scheduled.clear();
context.http.fetch = async () => new Response(null, { status: 202 });
const persistenceLossCompareAndSet = jobStorage.api.compareAndSet;
let persistedDeliveryJobs = 0;
jobStorage.api.compareAndSet = async (id: string, expected: any, next: any) => {
	const committed = await persistenceLossCompareAndSet(id, expected, next);
	if (
		committed &&
		next.action === "put" &&
		next.value.attempts > 0 &&
		next.value.url.includes("/lease-lost-after-first-write-")
	) {
		persistedDeliveryJobs += 1;
		if (persistedDeliveryJobs === 1) {
			const owner = [...operationLeaseStorage.values.entries()].find(
				([, lease]) => lease.scope === "indexnow:queue",
			);
			assert.ok(owner, "the persistence phase must retain its durable owner");
			operationLeaseStorage.values.delete(owner[0]);
		}
	}
	return committed;
};
const persistenceLossResult = await deliverIndexNowQueue(
	context as any,
	"https://example.com",
	{ force: true },
);
jobStorage.api.compareAndSet = persistenceLossCompareAndSet;
assert.equal(persistenceLossResult.success, false);
assert.equal(persistenceLossResult.error, "delivery_in_progress");
assert.equal(persistenceLossResult.processed, 1);
assert.match(String(persistenceLossResult.detail), /1 of 2 queue jobs/);
assert.match(String(persistenceLossResult.detail), /delivery attempt was recorded in history/i);
assert.equal(
	persistedDeliveryJobs,
	1,
	"a stale owner must stop before the next queue write",
);
const unchangedPersistenceJobs = persistenceLossEntries.filter(
	([id]) =>
		JSON.stringify(jobStorage.values.get(id)) ===
		JSON.stringify(persistenceLossBefore.get(id)),
);
assert.equal(
	unchangedPersistenceJobs.length,
	1,
	"the job after ownership loss must remain unchanged",
);
assert.equal(
	deliveryStorage.values.size,
	deliveryCountBeforePersistenceLoss + 1,
	"a remote response must be audited before queue jobs advance",
);
assert.ok(
	[...deliveryStorage.values.values()].some((delivery) =>
		delivery.urls.includes(
			"https://example.com/lease-lost-after-first-write-a",
		),
	),
	"the partial result must retain the exact remote delivery snapshot",
);
assert.equal(
	scheduled.size,
	0,
	"ownership loss during queue writes must not reschedule the drain",
);
for (const [id] of persistenceLossEntries) jobStorage.values.delete(id);

const missingJobCasQueued = await handler("submit-admin-indexnow")(
	route({ urls: ["/missing-job-cas"], force: true, deliverNow: false }),
	context,
);
assert.equal(missingJobCasQueued.success, true);
const missingJobCasEntry = [...jobStorage.values.entries()].find(([, job]) =>
	job.url.endsWith("/missing-job-cas"),
);
assert.ok(missingJobCasEntry);
const missingJobCasBefore = clone(missingJobCasEntry[1]);
let missingJobCasRequests = 0;
context.http.fetch = async () => {
	missingJobCasRequests += 1;
	return new Response(null, { status: 202 });
};
jobStorage.api.compareAndSet = undefined as any;
const missingJobCasResult = await deliverIndexNowQueue(
	context as any,
	"https://example.com",
	{ force: true },
);
jobStorage.api.compareAndSet = persistenceLossCompareAndSet;
assert.equal(missingJobCasResult.success, false);
assert.equal(missingJobCasResult.error, "delivery_in_progress");
assert.match(String(missingJobCasResult.detail), /conditional queue writes/i);
assert.equal(missingJobCasRequests, 0);
assert.deepEqual(jobStorage.values.get(missingJobCasEntry[0]), missingJobCasBefore);
jobStorage.values.delete(missingJobCasEntry[0]);
context.http.fetch = concurrentFetch;

// Expired owners are recoverable and are cleaned before a new delivery starts.
operationLeaseStorage.values.set("stale-owner", {
	id: "stale-owner",
	ownerToken: "stale-owner",
	storageVersion: 1,
	scope: "indexnow:queue",
	ticket: 1,
	choosing: false,
	createdAt: "2026-07-01T00:00:00.000Z",
	expiresAt: "2026-07-01T00:01:00.000Z",
	reclaimAfter: "2026-07-01T00:02:00.000Z",
});
operationLeaseStorage.values.set("stale-one-off-entry-owner", {
	id: "stale-one-off-entry-owner",
	ownerToken: "stale-one-off-entry-owner",
	storageVersion: 1,
	scope: "core-seo-migration:posts:one-off-entry",
	ticket: 1,
	choosing: false,
	createdAt: "2026-07-01T00:00:00.000Z",
	expiresAt: "2026-07-01T00:01:00.000Z",
	reclaimAfter: "2026-07-01T00:02:00.000Z",
});
const queuedAfterStaleLease = await handler("submit-admin-indexnow")(
	route({ urls: ["/after-stale-lease"], force: true, deliverNow: false }),
	context,
);
assert.equal(queuedAfterStaleLease.success, true);
const recoveredDrain = await handler("drain-admin-indexnow")(
	route({ force: true }),
	context,
);
assert.equal(recoveredDrain.success, true);
assert.equal(
	concurrentRequests,
	2,
	"an expired owner must not block the next delivery",
);
assert.equal(
	operationLeaseStorage.values.size,
	0,
	"bounded acquisition sweeps must clean expired owners from both active and one-off scopes",
);

// A stale sweep works from a queried snapshot. If the owner renews before the
// cleanup reread, the newer complete snapshot must survive even though the
// owner token is unchanged.
const renewedDuringSweepId = "renewed-during-stale-sweep";
const staleSweepSnapshot = {
	id: renewedDuringSweepId,
	ownerToken: renewedDuringSweepId,
	storageVersion: 1,
	scope: "indexnow:renewed-stale-owner",
	ticket: 1,
	choosing: false,
	createdAt: "2026-07-01T00:00:00.000Z",
	expiresAt: "2026-07-01T00:01:00.000Z",
	reclaimAfter: "2026-07-01T00:02:00.000Z",
};
operationLeaseStorage.values.set(renewedDuringSweepId, staleSweepSnapshot);
const originalLeaseQuery = operationLeaseStorage.api.query;
let sweepRenewalInterleaved = false;
operationLeaseStorage.api.query = async (options: any = {}) => {
	const result = await originalLeaseQuery(options);
	if (
		!sweepRenewalInterleaved &&
		options.orderBy?.expiresAt === "asc" &&
		result.items.some((item: any) => item.id === renewedDuringSweepId)
	) {
		sweepRenewalInterleaved = true;
		operationLeaseStorage.values.set(renewedDuringSweepId, {
			...staleSweepSnapshot,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			reclaimAfter: new Date(Date.now() + 120_000).toISOString(),
		});
	}
	return result;
};
const sweepRenewalResult = await withOperationLease(
	context as any,
	"indexnow:stale-sweep-snapshot-selfcheck",
	async () => "completed",
);
operationLeaseStorage.api.query = originalLeaseQuery;
assert.deepEqual(sweepRenewalResult, { acquired: true, value: "completed" });
assert.equal(
	sweepRenewalInterleaved,
	true,
	"the self-check must interleave a sweep renewal",
);
assert.ok(
	Date.parse(
		operationLeaseStorage.values.get(renewedDuringSweepId)?.reclaimAfter ?? "",
	) > Date.now(),
	"stale cleanup must preserve a concurrently renewed complete lease snapshot",
);
operationLeaseStorage.values.delete(renewedDuringSweepId);

const renewedVisibleScope = "indexnow:renewed-visible-owner";
const renewedVisibleId = "renewed-during-visible-contenders";
const staleVisibleSnapshot = {
	id: renewedVisibleId,
	ownerToken: renewedVisibleId,
	storageVersion: 1,
	scope: renewedVisibleScope,
	ticket: 1,
	choosing: false,
	createdAt: "2026-07-01T00:00:00.000Z",
	expiresAt: "2026-07-01T00:01:00.000Z",
	reclaimAfter: "2026-07-01T00:02:00.000Z",
};
operationLeaseStorage.values.set(renewedVisibleId, staleVisibleSnapshot);
const visibleRenewalQuery = operationLeaseStorage.api.query;
let visibleRenewalInterleaved = false;
operationLeaseStorage.api.query = async (options: any = {}) => {
	const result = await visibleRenewalQuery(options);
	if (options.orderBy?.expiresAt === "asc") {
		result.items = result.items.filter(
			(item: any) => item.id !== renewedVisibleId,
		);
	}
	if (
		!visibleRenewalInterleaved &&
		options.where?.scope === renewedVisibleScope &&
		result.items.some((item: any) => item.id === renewedVisibleId)
	) {
		visibleRenewalInterleaved = true;
		operationLeaseStorage.values.set(renewedVisibleId, {
			...staleVisibleSnapshot,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			reclaimAfter: new Date(Date.now() + 120_000).toISOString(),
		});
	}
	return result;
};
let renewedVisibleOperationRan = false;
const renewedVisibleResult = await withOperationLease(
	context as any,
	renewedVisibleScope,
	async () => {
		renewedVisibleOperationRan = true;
	},
	{ acquireTimeoutMs: 0, pollMs: 5 },
);
operationLeaseStorage.api.query = visibleRenewalQuery;
assert.equal(visibleRenewalInterleaved, true);
assert.equal(renewedVisibleOperationRan, false);
assert.deepEqual(renewedVisibleResult, { acquired: false, reason: "busy" });
assert.ok(
	Date.parse(
		operationLeaseStorage.values.get(renewedVisibleId)?.reclaimAfter ?? "",
	) > Date.now(),
	"a renewed visible contender must remain active and block acquisition",
);
operationLeaseStorage.values.delete(renewedVisibleId);

const unverifiableVisibleScope = "indexnow:unverifiable-visible-owner";
const unverifiableVisibleId = "unverifiable-visible-contender";
const unverifiableVisibleSnapshot = {
	id: unverifiableVisibleId,
	ownerToken: unverifiableVisibleId,
	storageVersion: 1,
	scope: unverifiableVisibleScope,
	ticket: 1,
	choosing: false,
	createdAt: "2026-07-01T00:00:00.000Z",
	expiresAt: "2026-07-01T00:01:00.000Z",
	reclaimAfter: "2026-07-01T00:02:00.000Z",
};
operationLeaseStorage.values.set(
	unverifiableVisibleId,
	unverifiableVisibleSnapshot,
);
const unverifiableQuery = operationLeaseStorage.api.query;
const unverifiableCompareAndSet = operationLeaseStorage.api.compareAndSet;
const unverifiableGet = operationLeaseStorage.api.get;
let rejectVisibleVerification = false;
operationLeaseStorage.api.query = async (options: any = {}) => {
	const result = await unverifiableQuery(options);
	if (options.orderBy?.expiresAt === "asc") {
		result.items = result.items.filter(
			(item: any) => item.id !== unverifiableVisibleId,
		);
	}
	return result;
};
operationLeaseStorage.api.compareAndSet = async (
	id: string,
	expected: any,
	next: any,
) => {
	if (
		id === unverifiableVisibleId &&
		next.action === "delete" &&
		!rejectVisibleVerification
	) {
		operationLeaseStorage.values.set(unverifiableVisibleId, {
			...unverifiableVisibleSnapshot,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			reclaimAfter: new Date(Date.now() + 120_000).toISOString(),
		});
		rejectVisibleVerification = true;
		return false;
	}
	return unverifiableCompareAndSet(id, expected, next);
};
operationLeaseStorage.api.get = async (id: string) => {
	if (id === unverifiableVisibleId && rejectVisibleVerification) {
		rejectVisibleVerification = false;
		throw new Error("Injected lease verification failure");
	}
	return unverifiableGet(id);
};
let unverifiableVisibleOperationRan = false;
const unverifiableVisibleResult = await withOperationLease(
	context as any,
	unverifiableVisibleScope,
	async () => {
		unverifiableVisibleOperationRan = true;
	},
	{ acquireTimeoutMs: 0, pollMs: 5 },
);
operationLeaseStorage.api.query = unverifiableQuery;
operationLeaseStorage.api.compareAndSet = unverifiableCompareAndSet;
operationLeaseStorage.api.get = unverifiableGet;
assert.equal(unverifiableVisibleOperationRan, false);
assert.deepEqual(unverifiableVisibleResult, {
	acquired: false,
	reason: "busy",
});
assert.ok(
	operationLeaseStorage.values.has(unverifiableVisibleId),
	"an unverifiable renewed contender must block acquisition",
);
operationLeaseStorage.values.delete(unverifiableVisibleId);

// Active operations heartbeat before their TTL. A slow host request therefore
// keeps ownership; only a crashed owner (no heartbeat) becomes reclaimable.
// Renewal compares the wall clock with the stored expiry, so these heartbeats
// run on mocked timers: a host clock step must not decide the outcome.
const settleLeaseCallbacks = async () => {
	for (let turn = 0; turn < 3; turn += 1)
		await new Promise((resolve) => setImmediate(resolve));
};
const leaseRecord = (scope: string) =>
	[...operationLeaseStorage.values.values()].find(
		(value) => value.scope === scope,
	);
const heartbeatScope = "indexnow:heartbeat-selfcheck";
let releaseHeartbeat!: () => void;
let markHeartbeatStarted!: () => void;
const heartbeatGate = new Promise<void>((resolve) => {
	releaseHeartbeat = resolve;
});
const heartbeatStarted = new Promise<void>((resolve) => {
	markHeartbeatStarted = resolve;
});
mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.now() });
try {
	const heartbeatRun = withOperationLease(
		context as any,
		heartbeatScope,
		async () => {
			markHeartbeatStarted();
			await heartbeatGate;
			return true;
		},
		{ ttlMs: 1_000 },
	);
	await heartbeatStarted;
	const initialHeartbeatExpiry = Date.parse(
		leaseRecord(heartbeatScope)?.expiresAt,
	);
	assert.equal(initialHeartbeatExpiry, Date.now() + 1_000);
	for (let beat = 0; beat < 4; beat += 1) {
		mock.timers.tick(333);
		await settleLeaseCallbacks();
		assert.equal(
			Date.parse(leaseRecord(heartbeatScope)?.expiresAt),
			Date.now() + 1_000,
			"an active lease must renew before its expiry",
		);
	}
	assert.ok(
		Date.now() > initialHeartbeatExpiry,
		"renewal must carry ownership past the first TTL",
	);
	releaseHeartbeat();
	assert.deepEqual(await heartbeatRun, { acquired: true, value: true });
} finally {
	mock.timers.reset();
}
assert.equal(
	operationLeaseStorage.values.size,
	0,
	"heartbeat owners must clean up after completion",
);

// A heartbeat that first runs inside the renewal guard, after a host stall or a
// forward wall-clock step, stands down: its owner is told to stop, the record
// is not extended and the completed operation reports lost ownership.
const stalledScope = "indexnow:heartbeat-stall-selfcheck";
let releaseStalledOwner!: () => void;
let markStalledOwnerStarted!: () => void;
let stalledOwner: OperationLeaseOwner | null = null;
const stalledOwnerGate = new Promise<void>((resolve) => {
	releaseStalledOwner = resolve;
});
const stalledOwnerStarted = new Promise<void>((resolve) => {
	markStalledOwnerStarted = resolve;
});
mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.now() });
try {
	const stalledRun = withOperationLease(
		context as any,
		stalledScope,
		async (owner) => {
			stalledOwner = owner;
			markStalledOwnerStarted();
			await stalledOwnerGate;
			return true;
		},
		{ ttlMs: 1_000 },
	);
	await stalledOwnerStarted;
	const stalledExpiry = leaseRecord(stalledScope)?.expiresAt;
	mock.timers.setTime(Date.now() + 1_500);
	mock.timers.tick(0);
	await settleLeaseCallbacks();
	assert.equal(
		stalledOwner!.signal.aborted,
		true,
		"a heartbeat inside the renewal guard must stop its owner",
	);
	assert.equal(
		leaseRecord(stalledScope)?.expiresAt,
		stalledExpiry,
		"a late heartbeat must not extend the owner record",
	);
	releaseStalledOwner();
	assert.deepEqual(await stalledRun, {
		acquired: false,
		reason: "lost",
		value: true,
	});
} finally {
	mock.timers.reset();
}
assert.equal(
	operationLeaseStorage.values.size,
	0,
	"a lost owner must release its unchanged record",
);

// A heartbeat that starts inside the renewal guard must stand down instead of
// writing a fresh expiry over a contender that is about to reclaim this owner.
// The reclaim grace keeps the old record visible while an on-time heartbeat's
// storage write finishes, closing the practical read-expire-delete-put window.
let releaseGuardedOwner!: () => void;
let markGuardedOwnerStarted!: () => void;
let guardedOwner: OperationLeaseOwner | null = null;
const guardedOwnerGate = new Promise<void>((resolve) => {
	releaseGuardedOwner = resolve;
});
const guardedOwnerStarted = new Promise<void>((resolve) => {
	markGuardedOwnerStarted = resolve;
});
const guardedScope = "indexnow:renewal-guard-selfcheck";
const guardedRun = withOperationLease(
	context as any,
	guardedScope,
	async (owner) => {
		guardedOwner = owner;
		markGuardedOwnerStarted();
		await guardedOwnerGate;
		return true;
	},
	{ ttlMs: 1_000 },
);
await guardedOwnerStarted;
const guardedEntry = [...operationLeaseStorage.values.entries()].find(
	([, value]) => value.scope === guardedScope,
);
assert.ok(guardedEntry, "the guarded owner must publish its durable lease");
const [guardedId, guardedRecord] = guardedEntry;
const guardedExpiry = new Date(Date.now() + 100).toISOString();
operationLeaseStorage.values.set(guardedId, {
	...guardedRecord,
	expiresAt: guardedExpiry,
	reclaimAfter: new Date(Date.now() + 60_000).toISOString(),
});
assert.equal(
	await guardedOwner!.renew(),
	false,
	"a near-expiry owner must refuse renewal",
);
assert.equal(
	guardedOwner!.signal.aborted,
	true,
	"a lost owner must signal its callback to stop",
);
assert.equal(
	operationLeaseStorage.values.get(guardedId)?.expiresAt,
	guardedExpiry,
	"a refused renewal must not resurrect or extend the owner record",
);
releaseGuardedOwner();
assert.deepEqual(await guardedRun, {
	acquired: false,
	reason: "lost",
	value: true,
});
assert.equal(
	operationLeaseStorage.values.size,
	1,
	"a lost owner must not delete a lease snapshot changed by another writer",
);
operationLeaseStorage.values.delete(guardedId);

// A storage delete can commit and then reject. Cleanup reconciles that as a
// released lease and never converts an already-successful operation to failure.
const originalLeaseDelete = operationLeaseStorage.api.delete;
let cleanupRejectionInjected = false;
operationLeaseStorage.api.delete = async (id: string) => {
	const record = operationLeaseStorage.values.get(id);
	const deleted = await originalLeaseDelete(id);
	if (
		!cleanupRejectionInjected &&
		record?.scope === "indexnow:cleanup-selfcheck"
	) {
		cleanupRejectionInjected = true;
		throw new Error(
			"Injected transport rejection after committed lease cleanup",
		);
	}
	return deleted;
};
const cleanupResult = await withOperationLease(
	context as any,
	"indexnow:cleanup-selfcheck",
	async () => "completed",
);
operationLeaseStorage.api.delete = originalLeaseDelete;
assert.deepEqual(
	cleanupResult,
	{ acquired: true, value: "completed" },
	"ambiguous cleanup must preserve the successful operation result",
);
assert.equal(
	operationLeaseStorage.values.size,
	0,
	"committed cleanup must leave no stale owner",
);

// The first contender publication can also commit and then reject. Its exact
// owner-tokened snapshot is reconciled, so it neither leaks choosing:true nor
// turns a successful operation into a transport failure.
const originalLeasePut = operationLeaseStorage.api.put;
let initialPublicationRejectionInjected = false;
operationLeaseStorage.api.put = async (id: string, value: RecordValue) => {
	await originalLeasePut(id, value);
	if (
		!initialPublicationRejectionInjected &&
		value.scope === "indexnow:initial-publication-selfcheck" &&
		value.choosing === true
	) {
		initialPublicationRejectionInjected = true;
		throw new Error(
			"Injected rejection after committed initial lease publication",
		);
	}
};
const initialPublicationResult = await withOperationLease(
	context as any,
	"indexnow:initial-publication-selfcheck",
	async () => "completed",
);
operationLeaseStorage.api.put = originalLeasePut;
assert.deepEqual(
	initialPublicationResult,
	{ acquired: true, value: "completed" },
	"ambiguous initial publication must be reconciled from its exact durable snapshot",
);
assert.equal(
	operationLeaseStorage.values.size,
	0,
	"reconciled initial publication must clean up",
);

// A losing contender reports the authoritative busy result even when its own
// cleanup delete commits and then rejects at the transport boundary.
const failedContenderScope = "indexnow:failed-contender-cleanup-selfcheck";
const failedContenderBlockerId = "failed-contender-blocker";
operationLeaseStorage.values.set(failedContenderBlockerId, {
	id: failedContenderBlockerId,
	ownerToken: failedContenderBlockerId,
	storageVersion: 1,
	scope: failedContenderScope,
	ticket: 1,
	choosing: false,
	createdAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 60_000).toISOString(),
	reclaimAfter: new Date(Date.now() + 120_000).toISOString(),
});
let failedContenderCleanupRejectionInjected = false;
operationLeaseStorage.api.delete = async (id: string) => {
	const record = operationLeaseStorage.values.get(id);
	const deleted = await originalLeaseDelete(id);
	if (
		!failedContenderCleanupRejectionInjected &&
		id !== failedContenderBlockerId &&
		record?.scope === failedContenderScope
	) {
		failedContenderCleanupRejectionInjected = true;
		throw new Error(
			"Injected rejection after committed failed-contender cleanup",
		);
	}
	return deleted;
};
const failedContenderContext = {
	...context,
	plugin: { ...context.plugin, id: "shipit-seo-failed-contender-isolate" },
};
const failedContenderResult = await withOperationLease(
	failedContenderContext as any,
	failedContenderScope,
	async () => "must-not-run",
	{ acquireTimeoutMs: 0, pollMs: 5 },
);
operationLeaseStorage.api.delete = originalLeaseDelete;
assert.deepEqual(
	failedContenderResult,
	{ acquired: false, reason: "busy" },
	"ambiguous failed-contender cleanup must preserve the contention result",
);
assert.equal(
	[...operationLeaseStorage.values.values()].filter(
		(lease) => lease.scope === failedContenderScope,
	).length,
	1,
	"failed contender cleanup must not leave a second durable blocker",
);
operationLeaseStorage.values.delete(failedContenderBlockerId);

// Host collection queries cap every page at 100 records. A configured batch
// larger than that must traverse default-order cursors before sorting in memory.
jobStorage.values.clear();
deliveryStorage.values.clear();
scheduled.clear();
const savedTuning = await handler("save-admin-indexnow")(
	route({ ...settings, batchSize: 150 }),
	context,
);
assert.equal(savedTuning.success, true);
assert.equal(savedTuning.indexNow.readiness.state, "ready");
assert.equal(savedTuning.indexNow.manualSubmissionReady, true);
assert.equal(
	(await handler("admin-indexnow")(route(), context)).readiness.state,
	"ready",
	"changing delivery tuning must retain verification for the same key and site",
);
const pagedRequestPayloads: any[] = [];
context.http.fetch = async (_url: string, init: RequestInit) => {
	pagedRequestPayloads.push(JSON.parse(String(init.body ?? "{}")));
	return new Response(null, { status: 202 });
};
const seedPendingJob = (index: number, prefix: string) => {
	const id = `${prefix}-${index.toString().padStart(4, "0")}`;
	const timestamp = new Date(Date.UTC(2026, 6, 20, 0, index)).toISOString();
	jobStorage.values.set(id, {
		id,
		storageVersion: SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION,
		url: `https://example.com/${prefix}/${index}`,
		ref: null,
		reason: "manual",
		status: "pending",
		attempts: 0,
		nextAttemptAt: null,
		lastHttpStatus: null,
		lastError: null,
		lastSubmittedAt: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	});
};
for (let index = 0; index < 150; index += 1)
	seedPendingJob(index, "paged-batch");
const pagedBatchDrain = await handler("drain-admin-indexnow")(
	route({ force: true }),
	context,
);
assert.equal(pagedBatchDrain.success, true);
assert.equal(pagedRequestPayloads.length, 1);
assert.equal(
	pagedRequestPayloads[0]?.urlList.length,
	150,
	"a 150-URL batch must cross the host's 100-record page cap",
);
assert.equal(
	[...jobStorage.values.values()].filter((job) => job.status === "delivered")
		.length,
	150,
	"every job selected from multiple pages must advance exactly once",
);

// Delivery retention is count-driven and repeatedly deletes the default oldest
// page, so a 251-record store contracts to exactly 200 even under the host cap.
jobStorage.values.clear();
deliveryStorage.values.clear();
pagedRequestPayloads.length = 0;
for (let index = 0; index < 250; index += 1) {
	const id = `retained-delivery-${index.toString().padStart(4, "0")}`;
	const createdAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
	deliveryStorage.values.set(id, {
		id,
		storageVersion: SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION,
		status: "accepted",
		urlCount: 1,
		urls: [`https://example.com/retained/${index}`],
		httpStatus: 202,
		attempt: 1,
		detail: "Accepted",
		retryAt: null,
		createdAt,
	});
}
seedPendingJob(0, "retention-new");
const retentionDrain = await handler("drain-admin-indexnow")(
	route({ force: true }),
	context,
);
assert.equal(retentionDrain.success, true);
assert.equal(
	deliveryStorage.values.size,
	200,
	"251 delivery records must retain exactly the newest 200",
);
assert.equal(
	deliveryStorage.values.has("retained-delivery-0000"),
	false,
	"retention must remove the oldest record first",
);
assert.ok(
	[...deliveryStorage.values.values()].some((delivery) =>
		delivery.urls.includes("https://example.com/retention-new/0"),
	),
	"retention must preserve the newly accepted delivery",
);

const queuedBeforeKeyRotation = await enqueueIndexNowUrls(context as any, "https://example.com", [
	{ url: "/waiting-before-key-rotation", reason: "manual" },
]);
assert.equal(queuedBeforeKeyRotation.success, true);
const concurrentSettingsBaseline = await handler("admin-indexnow")(route(), context);
let markSettingsUpdateStarted!: () => void;
let releaseSettingsUpdate!: () => void;
const settingsUpdateStarted = new Promise<void>((resolve) => {
	markSettingsUpdateStarted = resolve;
});
const settingsUpdateGate = new Promise<void>((resolve) => {
	releaseSettingsUpdate = resolve;
});
const generatedSettingsUpdate = updateIndexNowSettings(
	context as any,
	async (current) => {
		markSettingsUpdateStarted();
		await settingsUpdateGate;
		return { ...current.values, apiKey: "concurrent-generated-key" };
	},
);
await settingsUpdateStarted;
const staleConcurrentSave = updateIndexNowSettings(
	context as any,
	() => ({ ...concurrentSettingsBaseline.values, batchSize: 321 }),
	{ expectedUpdatedAt: concurrentSettingsBaseline.updatedAt },
);
releaseSettingsUpdate();
const [generatedSettingsResult, staleConcurrentSaveResult] = await Promise.all([
	generatedSettingsUpdate,
	staleConcurrentSave,
]);
assert.equal(generatedSettingsResult.updated, true);
assert.deepEqual(staleConcurrentSaveResult, {
	updated: false,
	reason: "changed",
});
assert.deepEqual(
	(await handler("admin-indexnow")(route(), context)).values,
	{
		...concurrentSettingsBaseline.values,
		apiKey: "concurrent-generated-key",
	},
	"a stale concurrent save must not revert a generated key or stored settings",
);
assert.equal((await handler("admin-indexnow")(route(), context)).readiness.state, "needs-setup");
assert.equal((await handler("admin-indexnow")(route(), context)).manualSubmissionReady, false);
const rotatedSettings = kv.get(INDEXNOW_SETTINGS_STORAGE_KEY) as RecordValue;
const rotatedKey = rotatedSettings.values.apiKey as string;
const queuedBeforeUnverifiedChecks = jobWrites;
const jobsBeforeUnverifiedChecks = clone([...jobStorage.values.entries()]);
let rotatedRequests = 0;
context.http.fetch = async (_url: string, init: RequestInit) => {
	rotatedRequests += 1;
	assert.equal(JSON.parse(String(init.body)).key, rotatedKey);
	return new Response(null, { status: 202 });
};
for (const verification of [
	undefined,
	{ siteOrigin: "https://example.com", keyLocation: settings.keyLocation, apiKey: settings.apiKey, checkedAt: new Date().toISOString() },
	{ siteOrigin: "https://example.com", keyLocation: "/other-key.txt", apiKey: rotatedKey, checkedAt: new Date().toISOString() },
	{ siteOrigin: "https://other.example.com", keyLocation: settings.keyLocation, apiKey: rotatedKey, checkedAt: new Date().toISOString() },
]) {
	kv.set(INDEXNOW_SETTINGS_STORAGE_KEY, { ...rotatedSettings, verification });
	const blockedEnqueue = await enqueueIndexNowUrls(context as any, "https://example.com", [
		{ url: "/unverified-after-key-rotation", reason: "manual" },
	]);
	assert.equal(blockedEnqueue.success, false);
	assert.equal(blockedEnqueue.error, "indexnow_not_configured");
	const blockedDelivery = await deliverIndexNowQueue(context as any, "https://example.com", { force: true });
	assert.equal(blockedDelivery.success, false);
	assert.equal(blockedDelivery.error, "indexnow_not_configured");
	assert.equal(jobWrites, queuedBeforeUnverifiedChecks);
	assert.deepEqual([...jobStorage.values.entries()], jobsBeforeUnverifiedChecks);
	assert.equal(rotatedRequests, 0);
}
kv.set(INDEXNOW_SETTINGS_STORAGE_KEY, {
	...rotatedSettings,
	verification: {
		siteOrigin: "https://example.com",
		keyLocation: settings.keyLocation,
		apiKey: rotatedKey,
		checkedAt: new Date().toISOString(),
	},
});
assert.equal((await handler("admin-indexnow")(route(), context)).readiness.state, "ready");
assert.equal((await handler("admin-indexnow")(route(), context)).manualSubmissionReady, true);
const resumedEnqueue = await enqueueIndexNowUrls(context as any, "https://example.com", [
	{ url: "/verified-after-key-rotation", reason: "manual" },
]);
assert.equal(resumedEnqueue.success, true);
const resumedDelivery = await deliverIndexNowQueue(context as any, "https://example.com", { force: true });
assert.equal(resumedDelivery.success, true);
assert.equal(rotatedRequests, 1);

const inFlightJob = await enqueueIndexNowUrls(context as any, "https://example.com", [
	{ url: "/while-key-rotates", reason: "manual" },
]);
assert.equal(inFlightJob.success, true);
let markDeliveryStarted!: () => void;
let releaseDelivery!: () => void;
const deliveryStarted = new Promise<void>((resolve) => { markDeliveryStarted = resolve; });
const deliveryGate = new Promise<void>((resolve) => { releaseDelivery = resolve; });
context.http.fetch = async (_url: string, init: RequestInit) => {
	assert.equal(JSON.parse(String(init.body)).key, rotatedKey);
	markDeliveryStarted();
	await deliveryGate;
	return new Response(null, { status: 202 });
};
const inFlightDelivery = deliverIndexNowQueue(context as any, "https://example.com", { force: true });
await deliveryStarted;
let rotationCallbackEntered = false;
const rotationDuringDelivery = updateIndexNowSettings(context as any, (current) => {
	rotationCallbackEntered = true;
	return { ...current.values, apiKey: "after-in-flight-delivery" };
});
await Promise.resolve();
assert.equal(rotationCallbackEntered, false, "a key rotation must wait for in-flight delivery");
releaseDelivery();
assert.equal((await inFlightDelivery).success, true);
assert.equal((await rotationDuringDelivery).updated, true);
assert.equal(rotationCallbackEntered, true);
assert.equal((await handler("admin-indexnow")(route(), context)).manualSubmissionReady, false);

const bulkSubmitSchema = (seoRuntime as any).routes["submit-admin-indexnow"].input;
assert.equal(bulkSubmitSchema.safeParse({ urls: Array.from({ length: 1_000 }, (_, index) => `/limit/${index}`) }).success, true);
assert.equal(bulkSubmitSchema.safeParse({ urls: Array.from({ length: 1_001 }, (_, index) => `/limit/${index}`) }).success, false);
assert.equal(bulkSubmitSchema.safeParse({ urls: [] }).success, false);
assert.equal(bulkSubmitSchema.safeParse({ urls: ["x".repeat(2_049)] }).success, false);

const bulkKv = new Map<string, unknown>([[INDEXNOW_SETTINGS_STORAGE_KEY, {
	version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	updatedAt: new Date().toISOString(),
	values: { ...settings, batchSize: 100 },
	verification: {
		siteOrigin: "https://example.com",
		keyLocation: settings.keyLocation,
		apiKey: settings.apiKey,
		checkedAt: new Date().toISOString(),
	},
}]]);
const bulkJobs = memoryCollection();
const bulkDeliveries = memoryCollection();
const bulkLeases = memoryCollection();
const bulkScheduled = new Map<string, { name: string; nextRunAt: string }>();
const bulkRequests: Array<{ url: string; payload: { urlList: string[] } }> = [];
const bulkStatuses = [202, 200, 403, 503];
const bulkContext = {
	...context,
	plugin: { ...context.plugin, id: "shipit-seo-bulk-selfcheck" },
	kv: {
		...context.kv,
		get: async (key: string) => clone(bulkKv.get(key) ?? null),
		set: async (key: string, value: unknown) => { bulkKv.set(key, clone(value)); },
		delete: async (key: string) => bulkKv.delete(key),
	},
	storage: {
		indexnowJobs: bulkJobs.api,
		indexnowDeliveries: bulkDeliveries.api,
		operationLeases: bulkLeases.api,
	},
	http: {
		fetch: async (url: string, init: RequestInit) => {
			bulkRequests.push({ url, payload: JSON.parse(String(init.body)) });
			const status = bulkStatuses.shift();
			assert.ok(status, "unexpected bulk IndexNow request");
			return new Response(null, { status });
		},
	},
	cron: {
		schedule: async (name: string, options: { schedule: string }) => {
			bulkScheduled.set(name, { name, nextRunAt: options.schedule });
		},
		cancel: async (name: string) => { bulkScheduled.delete(name); },
		list: async () => [...bulkScheduled.values()].map(clone),
	},
};
async function submitBulk(urls: string[]) {
	return handler("submit-admin-indexnow")(
		route(bulkSubmitSchema.parse({ urls })),
		bulkContext,
	);
}

const bulkUrls = Array.from({ length: 101 }, (_, index) => `/bulk/${index}`);
const bulkRejected = ["https://other.example.com/outside", "ftp://example.com/file", "https://user:password@example.com/private"];
const bulkAccepted = await submitBulk([
	...bulkUrls, "/bulk/0#fragment", "https://example.com/bulk/1", ...bulkRejected,
]);
assert.equal(bulkAccepted.success, true);
assert.equal(bulkAccepted.enqueued, 101);
assert.equal(bulkAccepted.skipped, 0, "same-request duplicates do not count as recently submitted skips");
assert.deepEqual(bulkAccepted.rejected, bulkRejected);
assert.equal(bulkJobs.values.size, 101, "normalized duplicates share one durable job");
assert.equal(bulkRequests.length, 1);
assert.equal(bulkRequests[0]?.url, "https://api.indexnow.org/indexnow");
assert.deepEqual(new Set(bulkRequests[0]?.payload.urlList), new Set(bulkUrls.slice(0, 100).map((url) => `https://example.com${url}`)));
assert.equal(bulkAccepted.indexNow.queue.delivered, 100);
assert.equal(bulkAccepted.indexNow.queue.pending, 1, "only one configured batch is submitted immediately");
assert.equal(bulkScheduled.size, 1, "the remainder keeps a background drain task");

const bulkRecentDuplicates = await submitBulk(["/bulk/0", "/bulk/0#again", "/bulk/1", bulkRejected[0]!]);
assert.equal(bulkRecentDuplicates.success, true);
assert.equal(bulkRecentDuplicates.enqueued, 0);
assert.equal(bulkRecentDuplicates.skipped, 2);
assert.deepEqual(bulkRecentDuplicates.rejected, [bulkRejected[0]]);
assert.equal(bulkRequests.length, 1, "a list of recently delivered URLs causes no immediate delivery");

const bulkRemainder = await handler("drain-admin-indexnow")(route({ force: true }), bulkContext);
assert.equal(bulkRemainder.success, true);
assert.deepEqual(bulkRequests[1]?.payload.urlList, ["https://example.com/bulk/100"]);
assert.equal(bulkRemainder.indexNow.queue.delivered, 101);
assert.equal(bulkRemainder.indexNow.queue.pending, 0);
assert.equal(bulkScheduled.size, 0);

const bulkAllRejected = await submitBulk(bulkRejected);
assert.equal(bulkAllRejected.success, false);
assert.equal(bulkAllRejected.error, "no_valid_urls");
assert.equal(bulkJobs.values.size, 101);
assert.equal(bulkRequests.length, 2, "a fully rejected list does not send a remote request");

const bulkForbidden = await submitBulk(["/bulk-forbidden/one", "/bulk-forbidden/two", bulkRejected[0]!]);
assert.equal(bulkForbidden.success, false);
assert.equal(bulkForbidden.error, "delivery_failed");
assert.equal(bulkForbidden.indexNow.queue.failed, 2);
const bulkFailedJobs = [...bulkJobs.values.values()].filter((job) => job.url.includes("/bulk-forbidden/"));
assert.equal(bulkFailedJobs.length, 2);
assert.ok(bulkFailedJobs.every((job) => job.status === "failed" && job.attempts === 1 && job.lastHttpStatus === 403));
assert.deepEqual(new Set(bulkRequests[2]?.payload.urlList), new Set(bulkFailedJobs.map((job) => job.url)));
assert.equal(bulkScheduled.size, 0, "terminal failures stay available for explicit retry");

const bulkRetrying = await submitBulk(["/bulk-retry/one", "/bulk-retry/two"]);
assert.equal(bulkRetrying.success, true, "retryable remote failures still accept the durable submission");
assert.equal(bulkRetrying.enqueued, 2);
assert.equal(bulkRetrying.indexNow.queue.retrying, 2);
const bulkRetryJobs = [...bulkJobs.values.values()].filter((job) => job.url.includes("/bulk-retry/"));
assert.equal(bulkRetryJobs.length, 2);
assert.ok(bulkRetryJobs.every((job) => job.status === "retry" && job.attempts === 1 && job.lastHttpStatus === 503));
assert.equal(bulkScheduled.size, 1);
assert.equal(bulkStatuses.length, 0);

for (const scenario of ["conflict", "read-error", "lease-loss", "lease-loss-during-schedule"] as const) {
	const partialJobs = memoryCollection();
	const partialLeases = memoryCollection();
	const partialScheduled = new Map<string, { name: string; nextRunAt: string }>();
	let partialCronWrites = 0;
	const firstUrl = `https://example.com/partial-${scenario}/first`;
	const secondUrl = `https://example.com/partial-${scenario}/second`;
	const readError = new Error("second queue read failed");
	const originalPartialCas = partialJobs.api.compareAndSet;
	const originalPartialGet = partialJobs.api.get;
	const unrelated = [...bulkJobs.values.entries()][0]!;
	partialJobs.values.set(unrelated[0], clone(unrelated[1]));
	partialJobs.api.compareAndSet = async (id: string, expected: any, next: any) => {
		if (id === indexNowJobId(secondUrl)) return false;
		const committed = await originalPartialCas(id, expected, next);
		if (committed && scenario === "lease-loss") partialLeases.values.clear();
		return committed;
	};
	partialJobs.api.get = async (id: string) => {
		if (scenario === "read-error" && id === indexNowJobId(secondUrl)) throw readError;
		return originalPartialGet(id);
	};
	if (scenario === "lease-loss-during-schedule") {
		partialScheduled.set("indexnow-drain-existing", {
			name: "indexnow-drain-existing",
			nextRunAt: new Date(Date.now() + 60_000).toISOString(),
		});
	}
	const partialContext = {
		...bulkContext,
		plugin: { ...bulkContext.plugin, id: `shipit-seo-partial-${scenario}` },
		storage: {
			indexnowJobs: partialJobs.api,
			indexnowDeliveries: memoryCollection().api,
			operationLeases: partialLeases.api,
		},
		http: { fetch: async () => { assert.fail("a failed enqueue must not submit a remote request"); } },
		cron: {
			list: async () => {
				if (scenario === "lease-loss-during-schedule") partialLeases.values.clear();
				return [...partialScheduled.values()].map(clone);
			},
			cancel: async (name: string) => {
				partialCronWrites += 1;
				partialScheduled.delete(name);
			},
			schedule: async (name: string, options: { schedule: string }) => {
				partialCronWrites += 1;
				partialScheduled.set(name, { name, nextRunAt: options.schedule });
			},
		},
	};
	const partialEnqueue = enqueueIndexNowUrls(partialContext as any, "https://example.com", [
		{ url: firstUrl, reason: "manual" },
		{ url: secondUrl, reason: "manual" },
	]);
	if (scenario === "read-error") {
		await assert.rejects(partialEnqueue, (error) => error === readError);
	} else {
		const result = await partialEnqueue;
		assert.equal(result.success, false);
		assert.equal(result.enqueued, 1);
		assert.equal(result.error, "delivery_in_progress");
	}
	assert.equal(partialJobs.values.get(indexNowJobId(firstUrl))?.status, "pending");
	assert.equal(partialJobs.values.has(indexNowJobId(secondUrl)), false);
	assert.deepEqual(partialJobs.values.get(unrelated[0]), unrelated[1], "partial enqueue must preserve unrelated jobs");
	if (scenario === "conflict" || scenario === "read-error") {
		assert.equal(partialScheduled.size, 1, "committed jobs need a drain even when the next candidate fails");
		assert.equal(partialCronWrites, 1);
	} else {
		assert.equal(partialCronWrites, 0, "a lost lease cannot schedule or cancel drain tasks");
		assert.equal(partialScheduled.size, scenario === "lease-loss" ? 0 : 1);
	}
}

// ---------------------------------------------------------------------------
// Submission history: entries are written when URLs are queued, counters move
// with every queue transition, and reads stay within the bounded routes.
// ---------------------------------------------------------------------------

function hostCollection() {
	const values = new Map<string, RecordValue>();
	const queryLimits: number[] = [];
	let compareHook: ((id: string, next: unknown) => "conflict" | "commit-then-throw" | void) | null = null;
	let deleteManyHook: ((ids: string[]) => void) | null = null;
	const matchesWhere = (value: RecordValue, where?: Record<string, unknown>) =>
		Object.entries(where ?? {}).every(([key, expected]) =>
			expected && typeof expected === "object" && Array.isArray((expected as any).in)
				? (expected as any).in.includes(value[key])
				: value[key] === expected);
	const api: Record<string, any> = {
		get: async (id: string) => clone(values.get(id) ?? null),
		put: async (id: string, value: RecordValue) => { values.set(id, clone(value)); },
		delete: async (id: string) => values.delete(id),
		exists: async (id: string) => values.has(id),
		getMany: async (ids: string[]) => new Map(ids.flatMap((id) => values.has(id) ? [[id, clone(values.get(id))]] : [])),
		deleteMany: async (ids: string[]) => {
			deleteManyHook?.(ids);
			let deleted = 0;
			for (const id of ids) if (values.delete(id)) deleted += 1;
			return deleted;
		},
		compareAndSet: async (
			id: string,
			expected: { state: "missing" } | { state: "value"; value: RecordValue },
			next: { action: "put"; value: RecordValue } | { action: "delete" },
		) => {
			const decision = compareHook?.(id, next);
			if (decision === "conflict") return false;
			const present = values.has(id);
			if (expected.state === "missing" ? present : !present) return false;
			if (expected.state === "value" && JSON.stringify(values.get(id)) !== JSON.stringify(expected.value)) return false;
			if (next.action === "delete") values.delete(id);
			else values.set(id, clone(next.value));
			if (decision === "commit-then-throw") throw new Error("response lost after commit");
			return true;
		},
		count: async (where?: Record<string, unknown>) => [...values.values()].filter((value) => matchesWhere(value, where)).length,
		// Hosts cap every page at 100 records and continue with an opaque cursor.
		query: async (options: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; limit?: number; cursor?: string } = {}) => {
			const limit = Math.min(options.limit ?? 50, 100);
			queryLimits.push(limit);
			const [field, direction] = Object.entries(options.orderBy ?? {})[0] ?? ["", "asc"];
			const rows = [...values.entries()].filter(([, value]) => matchesWhere(value, options.where));
			rows.sort((left, right) => {
				const compared = field ? String(left[1][field] ?? "").localeCompare(String(right[1][field] ?? "")) : 0;
				return (compared || left[0].localeCompare(right[0])) * (direction === "desc" ? -1 : 1);
			});
			const start = options.cursor ? Number(options.cursor.slice("offset:".length)) : 0;
			const page = rows.slice(start, start + limit);
			const hasMore = start + limit < rows.length;
			return { items: page.map(([id, data]) => ({ id, data: clone(data) })), hasMore, cursor: hasMore ? `offset:${start + limit}` : undefined };
		},
	};
	return {
		values,
		api,
		queryLimits,
		onCompare: (hook: typeof compareHook) => { compareHook = hook; },
		onDeleteMany: (hook: typeof deleteManyHook) => { deleteManyHook = hook; },
	};
}

const historyCollections = [
	...discoverableCollections,
	{ slug: "guides", label: "Guides", hasSeo: true, routable: true, hidden: false, urlPattern: "/guides/{slug}" },
];

function historyContext(label: string, options: { history?: boolean; values?: Partial<ReturnType<typeof defaultIndexNowSettings>> } = {}) {
	const kvValues = new Map<string, unknown>([["settings:siteUrl", "https://example.com"], ["settings:noindex", false]]);
	const stores = {
		jobs: hostCollection(),
		deliveries: hostCollection(),
		leases: hostCollection(),
		submissions: hostCollection(),
		pages: hostCollection(),
	};
	const scheduled = new Map<string, { name: string; schedule: string; nextRunAt: string; lastRunAt: null }>();
	const cronWrites: string[] = [];
	const transport = { statuses: [] as number[], posts: [] as string[][] };
	const entries = new Map<string, any>();
	const ctx: any = {
		plugin: { id: `shipit-seo-history-${label}`, version: SEO_ENGINE_VERSION },
		kv: {
			get: async (key: string) => clone(kvValues.get(key) ?? null),
			getVersioned: async (key: string) => kvValues.has(key) ? { value: clone(kvValues.get(key)), revision: "r1" } : null,
			set: async (key: string, value: unknown) => { kvValues.set(key, clone(value)); },
			delete: async (key: string) => kvValues.delete(key),
			list: async () => [],
		},
		storage: {
			indexnowJobs: stores.jobs.api,
			indexnowDeliveries: stores.deliveries.api,
			operationLeases: stores.leases.api,
			...(options.history === false ? {} : {
				indexnowSubmissions: stores.submissions.api,
				indexnowSubmissionUrls: stores.pages.api,
			}),
		},
		content: {
			get: async (collection: string, id: string) => clone(entries.get(`${collection}:${id}`) ?? null),
			getPublicUrl: async (collection: string, id: string) => {
				const pattern = historyCollections.find((item) => item.slug === collection)?.urlPattern;
				const slug = entries.get(`${collection}:${id}`)?.slug ?? id;
				return pattern ? new URL(pattern.replaceAll("{slug}", slug), "https://example.com").href : null;
			},
		},
		schema: { listCollections: async () => clone(historyCollections) },
		http: {
			fetch: async (_url: string, init: RequestInit) => {
				const status = transport.statuses.shift();
				assert.ok(status, `unexpected IndexNow request in ${label}`);
				transport.posts.push(JSON.parse(String(init.body)).urlList);
				return new Response(null, { status, headers: status === 429 ? { "Retry-After": "600" } : {} });
			},
		},
		cron: {
			schedule: async (name: string, value: { schedule: string }) => {
				cronWrites.push(`schedule:${name}`);
				scheduled.set(name, { name, schedule: value.schedule, nextRunAt: value.schedule, lastRunAt: null });
			},
			cancel: async (name: string) => { cronWrites.push(`cancel:${name}`); scheduled.delete(name); },
			list: async () => [...scheduled.values()].map(clone),
		},
		url: (path: string) => new URL(path, "https://example.com").href,
		site: { name: "Example", url: "https://example.com", locale: "en" },
		log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
	};
	kvValues.set(INDEXNOW_SETTINGS_STORAGE_KEY, {
		version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
		updatedAt: "2026-10-02T08:00:00.000Z",
		values: { ...defaultIndexNowSettings(), enabled: true, autoSubmit: true, apiKey: "history-check-key-1", ...options.values },
		verification: {
			siteOrigin: "https://example.com", keyLocation: "/indexnow-key.txt",
			apiKey: "history-check-key-1", checkedAt: "2026-10-02T08:00:00.000Z",
		},
	});
	const submissionsList = () => [...stores.submissions.values.values()].sort((left, right) =>
		left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
	const assertSums = () => {
		for (const entry of stores.submissions.values.values()) {
			const total = Object.values(entry.counts as Record<string, number>).reduce((sum, count) => sum + count, 0);
			assert.equal(total, entry.urlCount, `${entry.id} counts must cover every URL exactly once`);
			assert.equal(entry.status, indexNowSubmissionStatus(entry.counts));
		}
	};
	return { ctx, kvValues, stores, scheduled, cronWrites, transport, entries, submissionsList, assertSums };
}

const historyHooks = (seoRuntime as any).hooks;
const origin = "https://example.com";
const delay = () => new Promise((resolve) => setTimeout(resolve, 2));

// Content events: one entry per event at enqueue time, with source and event.
{
	const h = historyContext("events");
	const about = { id: "about", slug: "about", status: "published", data: {} };
	h.entries.set("pages:about", about);
	await historyHooks["content:afterPublish"].handler({ collection: "pages", content: about }, h.ctx);
	const [published] = h.submissionsList();
	assert.equal(h.submissionsList().length, 1);
	assert.equal(published.source, "automatic");
	assert.equal(published.event, "publish");
	assert.equal(published.ref, "pages:about");
	assert.deepEqual(published.sampleUrls, ["https://example.com/about"]);
	assert.equal(published.detail, "sample");
	assert.equal(published.status, "queued");
	assert.equal(published.lastAttemptAt, null, "a queued entry has no attempt yet");
	assert.equal(published.lastHttpStatus, null);
	assert.deepEqual(published.counts, { ...emptyIndexNowSubmissionCounts(), queued: 1 });
	assert.equal(h.stores.jobs.values.get(indexNowJobId("https://example.com/about"))?.submissionId, published.id);

	const before = h.submissionsList().length;
	await historyHooks["content:afterSave"].handler({ collection: "pages", content: { ...about, liveRevisionId: "r1", draftRevisionId: "r2" } }, h.ctx);
	await historyHooks["content:afterPublish"].handler({ collection: "pages", content: { id: "hidden", slug: "hidden", status: "published", seo: { noIndex: true }, data: {} } }, h.ctx);
	await historyHooks["content:afterPublish"].handler({ collection: "internal", content: { id: "private", slug: "private", status: "published", data: {} } }, h.ctx);
	await historyHooks["content:afterPublish"].handler({ collection: "guides", content: { id: "guide", slug: "guide", status: "published", data: {} } }, h.ctx);
	await historyHooks["content:afterSave"].handler({ collection: "pages", content: { id: "draft", slug: "draft", status: "draft", data: {} } }, h.ctx);
	assert.equal(h.submissionsList().length, before,
		"draft-only saves, noindex, private collections, unselected opt-in types and drafts record nothing");

	const story = { id: "story", slug: "old-story", status: "published", data: {} };
	h.entries.set("posts:story", story);
	await historyHooks["content:afterPublish"].handler({ collection: "posts", content: story }, h.ctx);
	await delay();
	h.entries.set("posts:story", { ...story, slug: "new-story" });
	await historyHooks["content:afterSave"].handler({ collection: "posts", content: { ...story, slug: "new-story" } }, h.ctx);
	const moved = h.submissionsList().filter((entry) => entry.ref === "posts:story");
	assert.deepEqual(moved.map((entry) => `${entry.event} ${entry.sampleUrls[0]}`).sort(), [
		"publish https://example.com/blog/old-story",
		"update https://example.com/blog/new-story",
		"url-change https://example.com/blog/old-story",
	], "the old address is a separate removal entry");
	assert.equal(h.stores.jobs.values.get(indexNowJobId("https://example.com/blog/old-story"))?.reason, "unpublish");
	assert.equal(moved.find((entry) => entry.event === "publish")!.counts.superseded, 1,
		"the publish entry hands its waiting URL to the removal entry");

	await delay();
	await historyHooks["content:beforeUnpublish"].handler({ collection: "pages", content: about, origin: { source: "api" } }, h.ctx);
	await historyHooks["content:afterUnpublish"].handler({ collection: "pages", content: { ...about, status: "draft" } }, h.ctx);
	const removal = h.submissionsList().at(-1)!;
	assert.equal(removal.event, "unpublish");
	assert.equal(removal.sampleUrls[0], "https://example.com/about");
	assert.equal(h.submissionsList()[0].counts.superseded, 1, "removal supersedes the waiting publish of the same URL");

	const doomed = { id: "doomed", slug: "doomed", status: "published", data: {} };
	h.entries.set("pages:doomed", doomed);
	await historyHooks["content:afterPublish"].handler({ collection: "pages", content: doomed }, h.ctx);
	await delay();
	await historyHooks["content:beforeDelete"].handler({ collection: "pages", id: "doomed" }, h.ctx);
	h.entries.delete("pages:doomed");
	await historyHooks["content:afterDelete"].handler({ collection: "pages", id: "doomed" }, h.ctx);
	assert.equal(h.submissionsList().at(-1)!.event, "delete");
	h.assertSums();

	// Automatic off stops new automatic entries; manual stays available.
	const settings = h.kvValues.get(INDEXNOW_SETTINGS_STORAGE_KEY) as RecordValue;
	h.kvValues.set(INDEXNOW_SETTINGS_STORAGE_KEY, { ...settings, values: { ...settings.values, autoSubmit: false } });
	const beforeOff = h.submissionsList().length;
	await historyHooks["content:afterPublish"].handler({ collection: "pages", content: { id: "off", slug: "off", status: "published", data: {} } }, h.ctx);
	assert.equal(h.submissionsList().length, beforeOff);
	const manualWhileOff = await handler("submit-admin-indexnow")(route({ urls: ["/manual-while-off"], deliverNow: false }), h.ctx);
	assert.equal(manualWhileOff.success, true);
	assert.equal(manualWhileOff.history, "recorded");
	h.kvValues.set(INDEXNOW_SETTINGS_STORAGE_KEY, { ...settings, values: { ...settings.values, enabled: false } });
	await historyHooks["content:afterPublish"].handler({ collection: "pages", content: { id: "disabled", slug: "disabled", status: "published", data: {} } }, h.ctx);
	const disabledManual = await handler("submit-admin-indexnow")(route({ urls: ["/while-disabled"], deliverNow: false }), h.ctx);
	assert.equal(disabledManual.success, false);
	assert.equal(disabledManual.error, "indexnow_disabled", "turning IndexNow off stops new delivery work");
	assert.equal(h.submissionsList().length, beforeOff + 1);
}

// Manual lists: rejected and duplicate rows, re-queued URLs and mixed batches.
{
	const h = historyContext("manual");
	const first = await handler("submit-admin-indexnow")(route({
		urls: ["https://example.com/m1", "/m2", "https://example.com/m1#again", "https://other.example/x", "notaurl::", "/m3", "/m4", "/m5"],
		deliverNow: false,
	}), h.ctx);
	assert.equal(first.success, true);
	assert.equal(first.enqueued, 5, "normalized duplicates are queued once");
	assert.deepEqual(first.rejected, ["https://other.example/x", "notaurl::"], "rejected rows return for correction");
	assert.equal(first.history, "recorded");
	const [manual] = h.submissionsList();
	assert.equal(manual.source, "manual");
	assert.equal(manual.event, null);
	assert.equal(manual.urlCount, 5);
	assert.equal(manual.detail, "pages");
	assert.deepEqual(manual.sampleUrls, ["https://example.com/m1", "https://example.com/m2", "https://example.com/m3"]);
	const detail = await handler("admin-indexnow-history-urls")(route({ submissionId: manual.id, page: 0 }), h.ctx);
	assert.equal(detail.success, true);
	assert.deepEqual(detail.urls.items.map((item: any) => item.url.slice(-3)), ["/m1", "/m2", "/m3", "/m4", "/m5"]);
	assert.equal(detail.urls.items.some((item: any) => item.skipped), false);
	assert.equal((await handler("admin-indexnow-history-urls")(route({ submissionId: manual.id, page: 1 }), h.ctx)).success, false);

	await delay();
	const second = await handler("submit-admin-indexnow")(route({ urls: ["/m1", "/m2", "/m6"], deliverNow: false }), h.ctx);
	assert.equal(second.enqueued, 3, "waiting URLs can be queued again");
	const [firstEntry, secondEntry] = h.submissionsList();
	assert.deepEqual(firstEntry.counts, { ...emptyIndexNowSubmissionCounts(), queued: 3, superseded: 2 });
	assert.deepEqual(secondEntry.counts, { ...emptyIndexNowSubmissionCounts(), queued: 3 });
	const firstDetail = await readIndexNowHistoryUrls(h.ctx, firstEntry.id, 0);
	assert.equal(firstDetail?.items.length, 5, "the original list stays intact after URLs are queued again");

	// A legacy job without an entry rides in the same batch without history writes.
	h.stores.jobs.values.set(indexNowJobId("https://example.com/legacy"), {
		id: indexNowJobId("https://example.com/legacy"), storageVersion: SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION,
		url: "https://example.com/legacy", ref: null, reason: "manual", status: "pending", attempts: 0,
		nextAttemptAt: new Date(Date.now() - 1_000).toISOString(), lastHttpStatus: null, lastError: null,
		lastSubmittedAt: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
	});
	h.transport.statuses.push(200);
	const mixed = await deliverIndexNowQueue(h.ctx, origin, { force: true });
	assert.equal(mixed.success, true);
	assert.equal(mixed.history, "recorded");
	assert.equal(h.transport.posts[0].length, 7, "one batch carries both entries and the legacy job");
	const [sentFirst, sentSecond] = h.submissionsList();
	assert.deepEqual(sentFirst.counts, { ...emptyIndexNowSubmissionCounts(), sent: 3, superseded: 2 });
	assert.deepEqual(sentSecond.counts, { ...emptyIndexNowSubmissionCounts(), sent: 3 });
	for (const entry of [sentFirst, sentSecond]) {
		assert.equal(entry.status, "sent");
		assert.equal(entry.lastHttpStatus, 200);
		assert.equal(entry.attempts, 1);
		assert.ok(entry.lastAttemptAt);
		assert.equal(entry.nextAttemptAt, null);
	}
	assert.equal(h.submissionsList().length, 2, "legacy jobs never gain an invented history entry");

	await delay();
	const recent = await handler("submit-admin-indexnow")(route({ urls: ["/m1", "/m2", "/m7", "/m8"], deliverNow: false }), h.ctx);
	assert.equal(recent.enqueued, 2);
	assert.equal(recent.skipped, 2, "recently sent URLs are skipped and recorded as skipped");
	const skippedEntry = h.submissionsList().at(-1)!;
	assert.deepEqual(skippedEntry.counts, { ...emptyIndexNowSubmissionCounts(), queued: 2, skipped: 2 });
	const skippedDetail = await readIndexNowHistoryUrls(h.ctx, skippedEntry.id, 0);
	assert.deepEqual(skippedDetail?.items.map((item) => item.skipped), [true, true, false, false]);
	h.transport.statuses.push(202);
	await deliverIndexNowQueue(h.ctx, origin, { force: true });
	assert.equal(h.submissionsList().at(-1)!.status, "accepted", "HTTP 202 is recorded as accepted, not as sent or indexed");
	assert.deepEqual(h.submissionsList().at(-1)!.counts, { ...emptyIndexNowSubmissionCounts(), accepted: 2, skipped: 2 });
	h.assertSums();
}

// Retries under conflicting and lost storage responses keep exact counters.
{
	const h = historyContext("retry", { values: { maxAttempts: 2 } });
	const queued = await handler("submit-admin-indexnow")(route({ urls: ["/r1", "/r2", "/r3", "/r4"], deliverNow: false }), h.ctx);
	assert.equal(queued.enqueued, 4);
	const entryId = h.submissionsList()[0].id;
	let conflicts = 0;
	h.stores.submissions.onCompare((id) => {
		if (id === entryId && conflicts === 0) { conflicts += 1; return "conflict"; }
	});
	h.transport.statuses.push(429);
	const limited = await deliverIndexNowQueue(h.ctx, origin, { force: true });
	assert.equal(limited.success, true);
	assert.equal(conflicts, 1, "the first counter write conflicted");
	let entry = h.stores.submissions.values.get(entryId)!;
	assert.deepEqual(entry.counts, { ...emptyIndexNowSubmissionCounts(), retrying: 4 }, "a conflict is re-read and applied once");
	assert.equal(entry.status, "retry");
	assert.equal(entry.lastHttpStatus, 429);
	assert.ok(entry.nextAttemptAt && Date.parse(entry.nextAttemptAt) > Date.now(), "the retry time is shown");

	let lostResponses = 0;
	h.stores.submissions.onCompare((id) => {
		if (id === entryId && lostResponses === 0) { lostResponses += 1; return "commit-then-throw"; }
	});
	h.transport.statuses.push(503);
	await deliverIndexNowQueue(h.ctx, origin, { force: true });
	assert.equal(lostResponses, 1);
	entry = h.stores.submissions.values.get(entryId)!;
	assert.deepEqual(entry.counts, { ...emptyIndexNowSubmissionCounts(), failed: 4 }, "a committed write with a lost response is not applied twice");
	assert.equal(entry.attempts, 2);
	assert.equal(entry.status, "failed");
	h.stores.submissions.onCompare(null);

	await delay();
	const requeued = await handler("submit-admin-indexnow")(route({ urls: ["/r1"], force: true, deliverNow: false }), h.ctx);
	assert.equal(requeued.enqueued, 1);
	assert.deepEqual(h.stores.submissions.values.get(entryId)!.counts, { ...emptyIndexNowSubmissionCounts(), failed: 4 },
		"a failed URL queued again elsewhere keeps its recorded failure here");
	h.transport.statuses.push(200);
	const retried = await handler("retry-admin-indexnow-submission")(route({ submissionId: entryId, deliverNow: true }), h.ctx);
	assert.equal(retried.success, true);
	assert.equal(retried.enqueued, 3, "only URLs that still belong to this entry are retried");
	assert.equal(retried.history, "recorded");
	entry = h.stores.submissions.values.get(entryId)!;
	assert.deepEqual(entry.counts, { ...emptyIndexNowSubmissionCounts(), sent: 3, failed: 1 });
	assert.equal(entry.status, "failed");
	assert.equal(h.submissionsList().at(-1)!.status, "sent", "the other entry's URL was delivered in the same batch");
	const noFailed = await handler("retry-admin-indexnow-submission")(route({ submissionId: h.submissionsList().at(-1)!.id }), h.ctx);
	assert.equal(noFailed.success, false);
	assert.equal(noFailed.error, "no_due_jobs");
	h.assertSums();
}

// Concurrent isolates serialize on the queue lease and keep one owner per URL.
{
	const h = historyContext("concurrent");
	const other = { ...h.ctx, plugin: { ...h.ctx.plugin, id: `${h.ctx.plugin.id}-other` } };
	const [left, right] = await Promise.all([
		enqueueIndexNowUrls(h.ctx, origin, [{ url: "/shared", reason: "manual" }, { url: "/left", reason: "manual" }]),
		enqueueIndexNowUrls(other, origin, [{ url: "/shared", reason: "manual" }, { url: "/right", reason: "manual" }]),
	]);
	assert.equal(left.success && right.success, true);
	const entries = h.submissionsList();
	assert.equal(entries.length, 2);
	const owner = h.stores.jobs.values.get(indexNowJobId("https://example.com/shared"))!.submissionId;
	assert.deepEqual(entries.map((entry) => entry.counts.superseded).sort(), [0, 1]);
	assert.equal(entries.find((entry) => entry.counts.superseded === 0)!.id, owner, "the later entry owns the shared URL");
	h.assertSums();
}

// History pages: capped host pages, scoped cursors and a final empty cursor.
{
	const h = historyContext("pages");
	const base = Date.parse("2026-09-01T00:00:00.000Z");
	for (let index = 0; index < 130; index += 1) {
		const createdAt = new Date(base + index * 1_000).toISOString();
		const id = indexNowSubmissionId(createdAt, index.toString(16).padStart(16, "0"));
		const counts = { ...emptyIndexNowSubmissionCounts(), ...(index % 2 ? { sent: 1 } : { failed: 1 }) };
		h.stores.submissions.values.set(id, {
			id, storageVersion: SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION, source: index % 3 ? "automatic" : "manual",
			event: index % 3 ? "update" : null, ref: index % 3 ? `pages:${index}` : null, urlCount: 1,
			sampleUrls: [`https://example.com/p${index}`], sampleSkipped: [], detail: "sample", counts,
			status: indexNowSubmissionStatus(counts), attempts: 1, lastAttemptAt: createdAt, lastHttpStatus: index % 2 ? 200 : 403,
			nextAttemptAt: null, lastDetail: null, createdAt, updatedAt: createdAt,
		});
	}
	const seen: string[] = [];
	let cursor: string | null = null;
	let pages = 0;
	do {
		const response = await handler("admin-indexnow-history")(route({ limit: 50, ...(cursor ? { cursor } : {}) }), h.ctx);
		assert.equal(response.success, true);
		const page = response.history;
		assert.equal(page.available, true);
		assert.equal(page.total, 130);
		assert.ok(page.items.length <= 50);
		seen.push(...page.items.map((item: any) => item.id));
		cursor = page.cursor;
		assert.equal(page.hasMore, cursor !== null);
		pages += 1;
	} while (cursor && pages < 10);
	assert.equal(pages, 3);
	assert.equal(cursor, null, "the last page ends with no cursor");
	assert.equal(new Set(seen).size, 130, "pages neither repeat nor skip entries");
	assert.deepEqual(seen, [...seen].sort().reverse(), "newest entries come first");
	assert.ok(h.stores.submissions.queryLimits.every((limit) => limit <= 100));
	const firstPage = await handler("admin-indexnow-history")(route({ limit: 50 }), h.ctx);
	const crossFilter = await handler("admin-indexnow-history")(route({ limit: 50, status: "failed", cursor: firstPage.history.cursor }), h.ctx);
	assert.equal(crossFilter.success, false);
	assert.equal(crossFilter.error, "invalid_cursor", "a cursor cannot continue another filter");
	const filtered = await handler("admin-indexnow-history")(route({ limit: 50, status: "failed", source: "manual" }), h.ctx);
	assert.ok(filtered.history.items.every((item: any) => item.status === "failed" && item.source === "manual"));
	assert.equal(filtered.history.total, filtered.history.items.length);
	const queuedBefore = h.stores.jobs.values.size;
	const leaseWritesBefore = h.stores.leases.values.size;
	await handler("admin-indexnow-history")(route({ limit: 10 }), h.ctx);
	assert.equal(h.stores.jobs.values.size, queuedBefore);
	assert.equal(h.stores.leases.values.size, leaseWritesBefore, "reading history takes no queue lease");
	assert.ok(!h.stores.jobs.queryLimits.length, "reading history never queries queue jobs");
}

// The detail budget expires the oldest full lists whole; queue jobs stay.
{
	const h = historyContext("budget", { values: { autoSubmit: false } });
	const list = (prefix: string, size: number) => Array.from({ length: size }, (_, index) => ({ url: `/${prefix}/${index}`, reason: "manual" as const }));
	for (let index = 0; index < 5; index += 1) {
		const result = await enqueueIndexNowUrls(h.ctx, origin, list(`l${index}`, 1_000));
		assert.equal(result.history, "recorded");
		await delay();
	}
	assert.equal(h.stores.pages.values.size, 50);
	assert.ok(h.submissionsList().every((entry) => entry.detail === "pages"), "five full lists fit the budget exactly");
	const sixth = await enqueueIndexNowUrls(h.ctx, origin, list("l5", 1_000));
	assert.equal(sixth.history, "recorded");
	const [oldest, ...newer] = h.submissionsList();
	assert.equal(oldest.detail, "expired");
	assert.equal(oldest.urlCount, 1_000, "the original count is kept");
	assert.equal(oldest.source, "manual");
	assert.deepEqual(oldest.sampleUrls, ["https://example.com/l0/0", "https://example.com/l0/1", "https://example.com/l0/2"]);
	assert.deepEqual(oldest.counts, { ...emptyIndexNowSubmissionCounts(), queued: 1_000 });
	assert.ok(newer.every((entry) => entry.detail === "pages"));
	assert.equal([...h.stores.pages.values.values()].some((page) => page.submissionId === oldest.id), false, "all pages of the oldest list expire together");
	const expiredDetail = await handler("admin-indexnow-history-urls")(route({ submissionId: oldest.id, page: 0 }), h.ctx);
	assert.equal(expiredDetail.urls.detail, "expired");
	assert.deepEqual(expiredDetail.urls.items, []);
	assert.equal(h.stores.jobs.values.get(indexNowJobId("https://example.com/l0/999"))?.status, "pending", "queued jobs are never removed");
	const storedUrls = [...h.stores.pages.values.values()].reduce((sum, page) => sum + page.urls.length, 0);
	assert.ok(storedUrls <= INDEXNOW_HISTORY_DETAIL_URL_BUDGET);

	// A failed page delete leaves the entry expiring; the next upkeep finishes it.
	let failedDeletes = 0;
	h.stores.pages.onDeleteMany(() => {
		if (failedDeletes < 2) { failedDeletes += 1; throw new Error("storage unavailable"); }
	});
	await delay();
	const seventh = await enqueueIndexNowUrls(h.ctx, origin, list("l6", 1_000));
	assert.equal(seventh.success, true);
	assert.equal(seventh.history, "partial", "an entry without its full list is not reported as recorded");
	const stuck = h.submissionsList().filter((entry) => entry.detail === "expiring");
	assert.ok(stuck.length >= 1, "interrupted expiries stay visible as incomplete details");
	const stuckIds = new Set(stuck.map((entry) => entry.id));
	const incomplete = await readIndexNowHistoryUrls(h.ctx, stuck[0].id, 0);
	assert.deepEqual(incomplete?.items, [], "an incomplete list is never shown partially");
	await delay();
	await enqueueIndexNowUrls(h.ctx, origin, list("small", 2));
	assert.equal(h.submissionsList().filter((entry) => stuckIds.has(entry.id) && entry.detail !== "expired").length, 0);
	assert.equal([...h.stores.pages.values.values()].some((page) => stuckIds.has(page.submissionId)), false, "no orphan pages remain");
	const finalUrls = [...h.stores.pages.values.values()].reduce((sum, page) => sum + page.urls.length, 0);
	assert.ok(finalUrls <= INDEXNOW_HISTORY_DETAIL_URL_BUDGET);
	assert.equal([...h.stores.jobs.values.values()].filter((job) => job.status === "pending").length, 7_002);
	h.assertSums();
}

// Summary retention removes only settled entries beyond the limit.
{
	const h = historyContext("retention");
	const base = Date.parse("2026-08-01T00:00:00.000Z");
	const seed = (index: number, counts: ReturnType<typeof emptyIndexNowSubmissionCounts>) => {
		const createdAt = new Date(base + index * 1_000).toISOString();
		const id = indexNowSubmissionId(createdAt, index.toString(16).padStart(16, "0"));
		h.stores.submissions.values.set(id, {
			id, storageVersion: SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION, source: "manual", event: null, ref: null,
			urlCount: 1, sampleUrls: [`https://example.com/s${index}`], sampleSkipped: [], detail: "sample", counts,
			status: indexNowSubmissionStatus(counts), attempts: 0, lastAttemptAt: null, lastHttpStatus: null,
			nextAttemptAt: null, lastDetail: null, createdAt, updatedAt: createdAt,
		});
		return id;
	};
	const waiting = [0, 1, 2].map((index) => seed(index, { ...emptyIndexNowSubmissionCounts(), queued: 1 }));
	for (let index = 3; index < INDEXNOW_HISTORY_RETENTION + 23; index += 1) seed(index, { ...emptyIndexNowSubmissionCounts(), sent: 1 });
	await enqueueIndexNowUrls(h.ctx, origin, [{ url: "/retention-trigger", reason: "manual" }]);
	assert.equal(h.stores.submissions.values.size, INDEXNOW_HISTORY_RETENTION + 23 + 1 - 24);
	assert.ok(waiting.every((id) => h.stores.submissions.values.has(id)), "entries still waiting are never pruned");
}

// Without history storage nothing claims to be recorded.
{
	const h = historyContext("unavailable", { history: false });
	const result = await handler("submit-admin-indexnow")(route({ urls: ["/no-history"], deliverNow: false }), h.ctx);
	assert.equal(result.success, true);
	assert.equal(result.history, "unavailable");
	assert.equal(h.stores.jobs.values.get(indexNowJobId("https://example.com/no-history"))?.submissionId, undefined);
	const page = await handler("admin-indexnow-history")(route({}), h.ctx);
	assert.equal(page.history.available, false);
	assert.deepEqual(page.history.items, []);
	const partial = historyContext("partial");
	partial.stores.submissions.onCompare(() => { throw new Error("history write failed"); });
	const partialResult = await handler("submit-admin-indexnow")(route({ urls: ["/partial"], deliverNow: false }), partial.ctx);
	assert.equal(partialResult.success, true, "queueing still succeeds");
	assert.equal(partialResult.history, "partial");
}

// A drain that loses its lease while scheduling cannot cancel or schedule tasks.
for (const scenario of ["remaining", "empty", "idle"] as const) {
	const h = historyContext(`schedule-${scenario}`);
	await enqueueIndexNowUrls(h.ctx, origin, [{ url: "/due-now", reason: "manual" }]);
	if (scenario === "remaining")
		await enqueueIndexNowUrls(h.ctx, origin, [{ url: "/later", reason: "manual" }], { delayMs: 3_600_000 });
	if (scenario === "idle") {
		const job = h.stores.jobs.values.get(indexNowJobId("https://example.com/due-now"))!;
		h.stores.jobs.values.set(job.id, { ...job, nextAttemptAt: new Date(Date.now() + 3_600_000).toISOString() });
	}
	h.scheduled.set("indexnow-drain-stale", {
		name: "indexnow-drain-stale", schedule: "x", nextRunAt: new Date(Date.now() + 7_200_000).toISOString(), lastRunAt: null,
	});
	const tasksBefore = clone([...h.scheduled.keys()].sort());
	const writesBefore = h.cronWrites.length;
	let releaseList!: () => void;
	let markListed!: () => void;
	const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
	const listed = new Promise<void>((resolve) => { markListed = resolve; });
	h.ctx.cron.list = async () => {
		markListed();
		await listGate;
		return [...h.scheduled.values()].map(clone);
	};
	if (scenario !== "idle") h.transport.statuses.push(200);
	const drain = deliverIndexNowQueue(h.ctx, origin, { force: scenario === "empty" });
	await listed;
	const lease = [...h.stores.leases.values.entries()].find(([, value]) => value.scope === "indexnow:queue");
	assert.ok(lease, "the drain owns the queue lease while it schedules");
	h.stores.leases.values.delete(lease[0]);
	releaseList();
	const result = await drain;
	assert.equal(result.success, false);
	assert.equal(result.error, "delivery_in_progress");
	assert.equal(h.cronWrites.length, writesBefore, `a stale ${scenario} drain makes no cron writes`);
	assert.deepEqual([...h.scheduled.keys()].sort(), tasksBefore);
}

// A stalled provider cannot retain the queue owner or prevent turning delivery off.
const recordedTimeoutNotices: string[] = [];
for (const scenario of ["retry", "terminal", "audit-lease-loss", "job-conflict"] as const) {
	const terminal = scenario === "terminal";
	const refused = scenario === "audit-lease-loss" || scenario === "job-conflict";
	const h = historyContext(`delivery-deadline-off-${scenario}`, { values: { maxAttempts: terminal ? 1 : 3 } });
	const queued = await enqueueIndexNowUrls(h.ctx, origin, [{ url: "/delivery-deadline-off", reason: "manual" }]);
	assert.equal(queued.success, true);
	const jobId = indexNowJobId(`${origin}/delivery-deadline-off`);
	const originalJob = clone(h.stores.jobs.values.get(jobId));
	const originalSubmission = clone(h.submissionsList()[0]);
	let auditRecorded = false;
	let refusedWrites = 0;
	const putAudit = h.stores.deliveries.api.put;
	h.stores.deliveries.api.put = async (id: string, value: RecordValue) => {
		await putAudit(id, value);
		auditRecorded = true;
		if (scenario === "audit-lease-loss") {
			const owner = [...h.stores.leases.values.entries()].find(([, lease]) => lease.scope === "indexnow:queue");
			assert.ok(owner, "the timeout audit is stored while its queue owner is current");
			h.stores.leases.values.delete(owner[0]);
		}
	};
	if (scenario === "job-conflict") h.stores.jobs.onCompare((id) => {
		if (id !== jobId) return;
		assert.equal(auditRecorded, true, "the exact job write follows the timeout audit");
		refusedWrites += 1;
		return "conflict";
	});
	let markStarted!: () => void;
	let releaseRequest!: (response: Response) => void;
	const started = new Promise<void>((resolve) => { markStarted = resolve; });
	const request = new Promise<Response>((resolve) => { releaseRequest = resolve; });
	const requestState: { signal: AbortSignal | null } = { signal: null };
	let requests = 0;
	h.ctx.http.fetch = async (_url: string, init: RequestInit) => {
		requests += 1;
		requestState.signal = init.signal ?? null;
		markStarted();
		return request;
	};
	const originalTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const deadlines: Array<{ callback: () => void; cleared: boolean }> = [];
	globalThis.setTimeout = ((callback: () => void, milliseconds?: number, ...args: unknown[]) => {
		if (milliseconds !== 10_000) return originalTimeout(callback, milliseconds, ...args);
		const deadline = { callback, cleared: false };
		deadlines.push(deadline);
		return deadline;
	}) as unknown as typeof setTimeout;
	globalThis.clearTimeout = ((timer: unknown) => {
		const deadline = deadlines.find((item) => item === timer);
		if (deadline) deadline.cleared = true;
		else originalClearTimeout(timer as ReturnType<typeof setTimeout>);
	}) as typeof clearTimeout;
	let drain: Promise<any> | undefined;
	let off: Promise<any> | undefined;
	const settles = async <T>(pending: Promise<T>): Promise<T> => {
		let timer!: ReturnType<typeof setTimeout>;
		try {
			return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
				timer = originalTimeout(() => reject(new Error("The delivery deadline did not settle the operation.")), 250);
			})]);
		} finally { originalClearTimeout(timer); }
	};
	try {
		drain = deliverIndexNowQueue(h.ctx, origin, { force: true });
		await started;
		let turnedOff = false;
		off = updateIndexNowSettings(h.ctx, (current) => ({ ...current.values, enabled: false }))
			.then((result) => { turnedOff = true; return result; });
		await Promise.resolve();
		assert.equal(turnedOff, false, "turning off waits for the current queue owner");
		assert.equal(h.stores.leases.values.size, 1, "the held provider owns the queue lease");
		assert.equal(deadlines.length, 1, "every provider request has a fixed 10-second wall-clock deadline");
		deadlines[0].callback();
		const result = await settles(drain);
		assert.equal(result.success, !terminal && !refused, "timeouts retain retry/failure outcomes and refuse stale queue writes");
		if (refused) {
			assert.equal(result.error, "delivery_in_progress");
			assert.equal(result.processed, 0);
			assert.equal(auditRecorded, true);
			assert.equal(h.stores.deliveries.values.size, 1);
			assert.deepEqual(h.stores.deliveries.values.get(result.delivery.id), result.delivery);
			assert.equal(refusedWrites, scenario === "job-conflict" ? 1 : 0);
			recordedTimeoutNotices.push(result.detail);
		}
		assert.equal(result.delivery.status, terminal ? "failed" : "retry");
		assert.equal(result.delivery.httpStatus, null);
		assert.match(result.delivery.detail, /timed out|timeout/i);
		assert.match(result.delivery.detail, /accept|confirm/i);
		assert.equal(requestState.signal?.aborted, true, "the deadline also asks transport to stop");
		assert.equal((await settles(off)).updated, true, "turning off proceeds without waiting for transport or lease expiry");
		assert.equal((await readIndexNowSettings(h.ctx)).values.enabled, false);
		assert.equal(h.stores.leases.values.size, 0, "delivery and settings release their durable owners");
		assert.ok(deadlines.every((timer) => timer.cleared), "settlement clears its deadline timer");
		const job = h.stores.jobs.values.get(jobId)!;
		const submission = h.submissionsList()[0];
		if (refused) {
			assert.deepEqual(job, originalJob, "a recorded timeout cannot advance a refused job snapshot");
			assert.deepEqual(submission, originalSubmission, "a refused job cannot advance submission counters");
		} else {
			assert.equal(job.status, terminal ? "failed" : "retry");
			assert.equal(job.attempts, 1);
			if (terminal) assert.equal(job.nextAttemptAt, null, "the final timed-out attempt schedules no retry");
			else assert.ok(Date.parse(job.nextAttemptAt) > Date.now(), "timeout never schedules an immediate retry");
			assert.equal(submission.attempts, 1);
			assert.equal(submission.lastHttpStatus, null);
			assert.match(submission.lastDetail, /accept|confirm|unknown/i);
		}
		h.assertSums();
		const storage = () => JSON.stringify([...[h.stores.jobs, h.stores.deliveries, h.stores.submissions].map((store) => [...store.values]), h.cronWrites]);
		const beforeLate = storage();
		let cancelled = false;
		releaseRequest(new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }), { status: 202 }));
		await new Promise<void>((resolve) => originalTimeout(resolve, 0));
		assert.equal(cancelled, true, "a late unused response is cancelled without awaiting cancellation");
		assert.equal(storage(), beforeLate, "late acceptance cannot rewrite jobs, audit, history or scheduling");
		assert.equal((await deliverIndexNowQueue(h.ctx, origin, { force: true })).error, "indexnow_disabled");
		assert.equal(requests, 1, "turning off and a late provider result cause no additional sends");
	} finally {
		globalThis.setTimeout = originalTimeout;
		globalThis.clearTimeout = originalClearTimeout;
		releaseRequest(new Response(null, { status: 202 }));
		await Promise.allSettled([...(drain ? [drain] : []), ...(off ? [off] : [])]);
	}
}

assert.deepEqual(recordedTimeoutNotices, [
	"The delivery attempt was recorded in history. 0 of 1 queue jobs advanced; unchanged jobs may be submitted again.",
	"The delivery attempt was recorded in history. 0 of 1 exact queue snapshots advanced; 1 changed job(s) may be submitted again.",
], "post-audit refusals describe the local record without claiming remote completion");

console.log("IndexNow runtime self-check passed.");
