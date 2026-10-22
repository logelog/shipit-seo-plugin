import { SEO_ADMIN_MODULE_DEFINITIONS, type SeoAdminModuleValues } from "./admin-contract.ts";
import {
	legacyNotFoundRecordId,
	notFoundRecordId,
	SEO_404_MONITOR_STORAGE_VERSION,
} from "./monitor404.ts";
import seoRuntime from "./sandbox-entry.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
	if (condition) console.log(`  PASS  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}`);
	}
}

function createCollection() {
	const records = new Map<string, any>();
	const metrics = {
		gets: 0,
		puts: 0,
		deletes: 0,
		deleteAttempts: 0,
		counts: 0,
		queries: 0,
	};
	let getBarrier: {
		id: string;
		remaining: number;
		promise: Promise<void>;
		release: () => void;
	} | null = null;
	let countBarrier: {
		remaining: number;
		promise: Promise<void>;
		release: () => void;
	} | null = null;
	let rejectedCompareDeletes = 0;
	return {
		records,
		metrics,
		synchronizeNextGets: (id: string, count = 2) => {
			let release!: () => void;
			const promise = new Promise<void>((resolve) => {
				release = resolve;
			});
			getBarrier = { id, remaining: count, promise, release };
		},
		synchronizeNextCounts: (count = 2) => {
			let release!: () => void;
			const promise = new Promise<void>((resolve) => {
				release = resolve;
			});
			countBarrier = { remaining: count, promise, release };
		},
		rejectNextCompareDeletes: (count = 1) => {
			rejectedCompareDeletes = count;
		},
		resetMetrics: () => {
			metrics.gets = 0;
			metrics.puts = 0;
			metrics.deletes = 0;
			metrics.deleteAttempts = 0;
			metrics.counts = 0;
			metrics.queries = 0;
		},
		get: async (id: string) => {
			metrics.gets += 1;
			const value = structuredClone(records.get(id) ?? null);
			if (getBarrier?.id === id && getBarrier.remaining > 0) {
				const barrier = getBarrier;
				barrier.remaining -= 1;
				if (barrier.remaining === 0) barrier.release();
				else {
					await Promise.race([
						barrier.promise,
						new Promise<void>((resolve) => setTimeout(resolve, 25)),
					]);
				}
				if (barrier.remaining === 0) getBarrier = null;
			}
			return value;
		},
		put: async (id: string, value: unknown) => {
			metrics.puts += 1;
			records.set(id, structuredClone(value));
		},
		compareAndSet: async (id: string, expected: any, next: any) => {
			const present = records.has(id);
			if (expected.state === "missing" ? present : !present) return false;
			if (
				expected.state === "value" &&
				JSON.stringify(records.get(id)) !== JSON.stringify(expected.value)
			)
				return false;
			if (next.action === "delete") {
				metrics.deleteAttempts += 1;
				if (rejectedCompareDeletes > 0) {
					rejectedCompareDeletes -= 1;
					throw new Error("Injected compare-and-set delete failure");
				}
				metrics.deletes += 1;
				return records.delete(id);
			}
			metrics.puts += 1;
			records.set(id, structuredClone(next.value));
			return true;
		},
		delete: async (id: string) => {
			metrics.deletes += 1;
			return records.delete(id);
		},
		count: async () => {
			metrics.counts += 1;
			const size = records.size;
			if (countBarrier && countBarrier.remaining > 0) {
				const barrier = countBarrier;
				barrier.remaining -= 1;
				if (barrier.remaining === 0) barrier.release();
				else {
					await Promise.race([
						barrier.promise,
						new Promise<void>((resolve) => setTimeout(resolve, 25)),
					]);
				}
				if (barrier.remaining === 0) countBarrier = null;
			}
			return size;
		},
		query: async ({ where, orderBy, limit = 100, cursor }: any = {}) => {
			metrics.queries += 1;
			const [field, direction] = Object.entries(orderBy ?? {})[0] ?? [];
			let items = [...records.entries()].map(([id, data]) => ({
				id,
				data: structuredClone(data),
			}));
			if (where) {
				items = items.filter(({ data }) =>
					Object.entries(where).every(
						([key, value]) => (data as Record<string, unknown>)?.[key] === value,
					),
				);
			}
			if (field) items.sort((left, right) => String(left.data[field]).localeCompare(String(right.data[field])) * (direction === "desc" ? -1 : 1));
			const start = Number.parseInt(cursor ?? "0", 10) || 0;
			const pageLimit = Math.min(limit, 100);
			const hasMore = start + pageLimit < items.length;
			return {
				items: items.slice(start, start + pageLimit),
				hasMore,
				cursor: hasMore ? String(start + pageLimit) : undefined,
			};
		},
	};
}

function createContext() {
	const kv = new Map<string, unknown>();
	const kvRevisions = new Map<string, string>();
	let nextKvRevision = 0;
	const notFoundHits = createCollection();
	const operationLeases = createCollection();
	return {
		context: {
			plugin: { id: "shipit-seo", version: "test" },
			schema: { listCollections: async () => [{
				slug: "pages", label: "Pages", hasSeo: true,
				urlPattern: "/{slug}", routable: true, hidden: false,
			}] },
			kv: {
				get: async (key: string) => structuredClone(kv.get(key) ?? null),
				set: async (key: string, value: unknown) => { kv.set(key, structuredClone(value)); kvRevisions.set(key, `kv:${++nextKvRevision}`); },
				delete: async (key: string) => { kvRevisions.delete(key); return kv.delete(key); },
				list: async () => [],
				// Feature controls save only through a revision check, as on published hosts.
				getVersioned: async (key: string) => kv.has(key) ? { value: structuredClone(kv.get(key)), revision: kvRevisions.get(key) ?? `initial:${key}` } : null,
				compareAndSet: async (key: string, expected: string | null, value: unknown) => {
					if ((kv.has(key) ? kvRevisions.get(key) ?? `initial:${key}` : null) !== expected) return { applied: false };
					const revision = `kv:${++nextKvRevision}`;
					kv.set(key, structuredClone(value)); kvRevisions.set(key, revision);
					return { applied: true, revision };
				},
				compareAndDelete: async (key: string, expected: string) => {
					if (!kv.has(key) || (kvRevisions.get(key) ?? `initial:${key}`) !== expected) return { applied: false };
					kv.delete(key); kvRevisions.delete(key); return { applied: true };
				},
			},
			storage: { notFoundHits, operationLeases },
			content: {
				getPublicUrl: async (collection: string, id: string) =>
					collection === "pages" && id === "page-services"
						? "https://example.com/services" : null,
				list: async (collection: string) => ({
					items: collection === "pages" ? [{
						id: "page-services",
						slug: "services",
						status: "published",
						data: { title: "Services", path: "/services" },
					}] : [],
				}),
			},
			url: (path: string) => `https://example.com${path}`,
			log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
		},
		kv,
		notFoundHits,
		operationLeases,
	};
}

function handler(name: string) {
	return (seoRuntime as any).routes[name].handler as (routeContext: any, context: any) => Promise<any>;
}

function adminRoute(input: unknown = {}) {
	return {
		input,
		request: { url: "https://example.com/_emdash/api/plugins/shipit-seo/test", method: "POST", headers: {} },
	};
}

function publicRoute(input: { path: string }, requestPath = input.path) {
	return {
		input,
		request: {
			url: new URL(requestPath, "https://example.com").href,
			method: "GET",
			headers: {},
		},
	};
}

function directPublicApiRoute(input: { path: string }) {
	return {
		input,
		request: {
			url: "https://example.com/_emdash/api/plugins/shipit-seo/public-log-404",
			method: "POST",
			headers: {},
		},
	};
}

const harness = createContext();
const disabled = await handler("public-log-404")(publicRoute({ path: "/servcies" }), harness.context);
check("disabled monitor does not write", disabled.reason === "disabled" && harness.notFoundHits.records.size === 0);

const modules = Object.fromEntries(
	SEO_ADMIN_MODULE_DEFINITIONS.map((definition) => [definition.key, definition.defaultEnabled]),
) as SeoAdminModuleValues;
modules.monitor404 = true;
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), harness.context);

const direct = await handler("public-log-404")(
	directPublicApiRoute({ path: "/direct-write-attempt" }),
	harness.context,
);
check(
	"direct public API dispatch cannot write an arbitrary missing path",
	direct.reason === "untrusted" && harness.notFoundHits.records.size === 0,
);
const mismatched = await handler("public-log-404")(
	publicRoute({ path: "/reported-path" }, "/different-request-path"),
	harness.context,
);
check(
	"in-process dispatch must match the original request path",
	mismatched.reason === "untrusted" && harness.notFoundHits.records.size === 0,
);

await handler("public-log-404")(publicRoute({ path: "/servcies?campaign=private" }, "/servcies?campaign=private"), harness.context);
await handler("public-log-404")(publicRoute({ path: "/servcies" }), harness.context);
const ignored = await handler("public-log-404")(publicRoute({ path: "/assets/missing.svg" }), harness.context);
check("asset requests are ignored", ignored.reason === "ignored");
check("repeated paths aggregate into one record", harness.notFoundHits.records.size === 1);

const monitor = await handler("admin-404-monitor")(adminRoute({ limit: 100 }), harness.context);
check("monitor reports aggregate hits", monitor.summary.totalHits === 2 && monitor.summary.uniquePaths === 1);
check("query strings are never stored", monitor.items[0]?.path === "/servcies");
check("records use explicit storage version", monitor.items[0]?.storageVersion === SEO_404_MONITOR_STORAGE_VERSION);
check("closest content route is suggested", monitor.items[0]?.suggestions[0]?.path === "/services");
check("request identity is not retained", !("referrer" in monitor.items[0]) && !("ip" in monitor.items[0]) && !("userAgent" in monitor.items[0]));

const ghostHarness = createContext();
ghostHarness.context.schema = { listCollections: async () => [
	{ slug: "ghost", label: "Ghost", hasSeo: true, urlPattern: "/ghost/{slug}", routable: true, hidden: false },
	{ slug: "pages", label: "Pages", hasSeo: true, urlPattern: "/{slug}", routable: true, hidden: false },
] };
const listPages = ghostHarness.context.content.list;
ghostHarness.context.content.list = async (collection: string) => {
	if (collection === "ghost") throw new Error("no such table: ec_ghost");
	return listPages(collection);
};
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), ghostHarness.context);
await handler("public-log-404")(publicRoute({ path: "/servcies" }), ghostHarness.context);
const ghostMonitor = await handler("admin-404-monitor")(adminRoute({ limit: 100 }), ghostHarness.context);
check(
	"a content type without a table does not fail the 404 view",
	ghostMonitor.items[0]?.suggestions[0]?.path === "/services",
);

const concurrentHitHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), concurrentHitHarness.context);
await handler("public-log-404")(
	publicRoute({ path: "/concurrent-miss" }),
	concurrentHitHarness.context,
);
const concurrentHitBefore = await handler("admin-404-monitor")(
	adminRoute({ limit: 100 }),
	concurrentHitHarness.context,
);
concurrentHitHarness.notFoundHits.synchronizeNextGets(
	concurrentHitBefore.items[0].id,
);
await Promise.all(
	Array.from({ length: 2 }, () =>
		handler("public-log-404")(
			publicRoute({ path: "/concurrent-miss" }),
			concurrentHitHarness.context,
		),
	),
);
const concurrentHitMonitor = await handler("admin-404-monitor")(
	adminRoute({ limit: 100 }),
	concurrentHitHarness.context,
);
check(
	"concurrent requests retain every 404 hit",
	concurrentHitMonitor.summary.totalHits === 3 &&
		concurrentHitMonitor.summary.uniquePaths === 1,
);

const concurrentTriageHarness = createContext();
await handler("save-admin-modules")(
	adminRoute({ ...modules, expectedRevision: null }),
	concurrentTriageHarness.context,
);
await handler("public-log-404")(
	publicRoute({ path: "/concurrent-triage" }),
	concurrentTriageHarness.context,
);
const concurrentTriageMonitor = await handler("admin-404-monitor")(
	adminRoute({ limit: 100 }),
	concurrentTriageHarness.context,
);
concurrentTriageHarness.notFoundHits.synchronizeNextGets(
	concurrentTriageMonitor.items[0].id,
);
await Promise.all([
	handler("public-log-404")(
		publicRoute({ path: "/concurrent-triage" }),
		concurrentTriageHarness.context,
	),
	handler("triage-admin-404")(
		adminRoute({
			id: concurrentTriageMonitor.items[0].id,
			status: "resolved",
			redirectTarget: "/services",
		}),
		concurrentTriageHarness.context,
	),
]);
const concurrentTriageResult = await handler("admin-404-monitor")(
	adminRoute({ limit: 100 }),
	concurrentTriageHarness.context,
);
check(
	"concurrent triage and logging preserve both updates",
	concurrentTriageResult.summary.totalHits === 2 &&
		concurrentTriageResult.items[0]?.status === "resolved" &&
		concurrentTriageResult.items[0]?.redirectTarget === "/services",
);

const pagedMonitorHarness = createContext();
await handler("save-admin-modules")(
	adminRoute({ ...modules, expectedRevision: null }),
	pagedMonitorHarness.context,
);
for (let index = 0; index < 150; index += 1) {
	const id = `paged-${index.toString().padStart(3, "0")}`;
	const seenAt = new Date(Date.UTC(2026, 5, 1, 0, index)).toISOString();
	pagedMonitorHarness.notFoundHits.records.set(id, {
		storageVersion: SEO_404_MONITOR_STORAGE_VERSION,
		id,
		path: `/paged/${index}`,
		hits: index + 1,
		firstSeenAt: seenAt,
		lastSeenAt: seenAt,
		status: index % 3 === 0 ? "resolved" : "open",
		redirectTarget: index % 3 === 0 ? "/services" : null,
	});
}
const pagedMonitor = await handler("admin-404-monitor")(
	adminRoute({ limit: 200 }),
	pagedMonitorHarness.context,
);
check(
	"404 summaries include records beyond the host's first 100-record page",
	pagedMonitor.summary.uniquePaths === 150 &&
		pagedMonitor.summary.totalHits === (150 * 151) / 2,
);
check(
	"404 monitor sorts the fully paged snapshot by last-seen time",
	pagedMonitor.items.length === 150 &&
		pagedMonitor.items[0]?.path === "/paged/149",
);

const brokenPageHarness = createContext();
await handler("save-admin-modules")(
	adminRoute({ ...modules, expectedRevision: null }),
	brokenPageHarness.context,
);
for (let index = 0; index < 101; index += 1) {
	const id = `broken-page-${index}`;
	brokenPageHarness.notFoundHits.records.set(id, {
		storageVersion: SEO_404_MONITOR_STORAGE_VERSION,
		id,
		path: `/broken-page/${index}`,
		hits: 1,
		firstSeenAt: "2026-07-17T09:00:00.000Z",
		lastSeenAt: "2026-07-17T09:00:00.000Z",
		status: "open",
		redirectTarget: null,
	});
}
const healthyBrokenPageQuery = brokenPageHarness.notFoundHits.query;
brokenPageHarness.notFoundHits.query = async (options: any = {}) => {
	if (options.cursor) throw new Error("Injected second-page failure");
	return healthyBrokenPageQuery(options);
};
let brokenPageRejected = false;
try {
	await handler("admin-404-monitor")(
		adminRoute({ limit: 200 }),
		brokenPageHarness.context,
	);
} catch (error: unknown) {
	brokenPageRejected = String(error).includes("second-page failure");
}
check(
	"a later 404 storage page failure cannot masquerade as an empty successful dashboard",
	brokenPageRejected,
);

const resolved = await handler("triage-admin-404")(adminRoute({
	id: monitor.items[0].id,
	status: "resolved",
	redirectTarget: "/services",
}), harness.context);
check("triage stores the chosen redirect target", resolved.success === true && resolved.monitor.items[0]?.redirectTarget === "/services");
check("resolved paths leave the open queue", resolved.success === true && resolved.monitor.summary.openPaths === 0 && resolved.monitor.summary.resolvedPaths === 1);

const invalid = await handler("triage-admin-404")(adminRoute({
	id: monitor.items[0].id,
	status: "resolved",
	redirectTarget: "/servcies",
}), harness.context);
check("self redirects are rejected", invalid.success === false && invalid.error === "invalid_target");

const collisionHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), collisionHarness.context);
const collisionLeft = "/abw0bwdszo4sf5mt";
const collisionRight = "/9t9qbdqq878y6voz";
const legacyCollisionId = "404-1ba561ea";
collisionHarness.notFoundHits.records.set(legacyCollisionId, {
	storageVersion: 1,
	id: legacyCollisionId,
	path: collisionLeft,
	hits: 1,
	firstSeenAt: "2026-07-17T09:00:00.000Z",
	lastSeenAt: "2026-07-17T09:00:00.000Z",
	status: "open",
	redirectTarget: null,
});
await handler("public-log-404")(publicRoute({ path: collisionRight }), collisionHarness.context);
check(
	"a non-matching legacy collision record is never merged or migrated",
	collisionHarness.notFoundHits.records.size === 2 &&
		collisionHarness.notFoundHits.records.get(legacyCollisionId)?.path === collisionLeft &&
		collisionHarness.notFoundHits.records.get(legacyCollisionId)?.hits === 1,
);
await handler("public-log-404")(publicRoute({ path: collisionLeft }), collisionHarness.context);
check(
	"a matching legacy record migrates lazily to storage v2",
	collisionHarness.notFoundHits.records.size === 2 &&
		!collisionHarness.notFoundHits.records.has(legacyCollisionId) &&
		[...collisionHarness.notFoundHits.records.values()].some(
			(record) => record.path === collisionLeft && record.storageVersion === 2 && record.hits === 2,
		),
);

const committedMoveHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), committedMoveHarness.context);
const committedMovePath = "/legacy-commit-then-throw";
const committedMoveLegacyId = legacyNotFoundRecordId(committedMovePath);
const committedMoveCanonicalId = await notFoundRecordId(committedMovePath);
committedMoveHarness.notFoundHits.records.set(committedMoveLegacyId, {
	storageVersion: 1,
	id: committedMoveLegacyId,
	path: committedMovePath,
	hits: 4,
	firstSeenAt: "2026-07-17T09:00:00.000Z",
	lastSeenAt: "2026-07-17T09:00:00.000Z",
	status: "open",
	redirectTarget: null,
});
const committedMoveCas = committedMoveHarness.notFoundHits.compareAndSet;
let committedMoveInjected = false;
committedMoveHarness.notFoundHits.compareAndSet = async (
	id: string,
	expected: any,
	next: any,
) => {
	const committed = await committedMoveCas(id, expected, next);
	if (
		!committedMoveInjected &&
		id === committedMoveCanonicalId &&
		next.action === "put" &&
		committed
	) {
		committedMoveInjected = true;
		throw new Error("Injected rejection after committed canonical move");
	}
	return committed;
};
const committedMoveResult = await handler("public-log-404")(
	publicRoute({ path: committedMovePath }),
	committedMoveHarness.context,
);
check(
	"a committed canonical move survives a transport rejection",
	committedMoveInjected &&
		committedMoveResult.recorded === true &&
		!committedMoveHarness.notFoundHits.records.has(committedMoveLegacyId) &&
		committedMoveHarness.notFoundHits.records.get(committedMoveCanonicalId)
			?.hits === 5 &&
		!committedMoveHarness.notFoundHits.records.get(committedMoveCanonicalId)
			?.legacyMove,
);

const retryMoveHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), retryMoveHarness.context);
const retryMovePath = "/legacy-delete-retry";
const retryMoveLegacyId = legacyNotFoundRecordId(retryMovePath);
const retryMoveCanonicalId = await notFoundRecordId(retryMovePath);
retryMoveHarness.notFoundHits.records.set(retryMoveLegacyId, {
	storageVersion: 1,
	id: retryMoveLegacyId,
	path: retryMovePath,
	hits: 2,
	firstSeenAt: "2026-07-17T09:00:00.000Z",
	lastSeenAt: "2026-07-17T09:00:00.000Z",
	status: "open",
	redirectTarget: null,
});
const retryMoveCas = retryMoveHarness.notFoundHits.compareAndSet;
let retryMoveDeleteFailed = false;
retryMoveHarness.notFoundHits.compareAndSet = async (
	id: string,
	expected: any,
	next: any,
) => {
	if (
		!retryMoveDeleteFailed &&
		id === retryMoveLegacyId &&
		next.action === "delete"
	) {
		retryMoveDeleteFailed = true;
		throw new Error("Injected legacy delete failure");
	}
	return retryMoveCas(id, expected, next);
};
const retryMoveFirst = await handler("public-log-404")(
	publicRoute({ path: retryMovePath }),
	retryMoveHarness.context,
);
const retryMovePending = retryMoveHarness.notFoundHits.records.get(
	retryMoveCanonicalId,
);
const retryMovePendingMonitor = await handler("admin-404-monitor")(
	adminRoute({ limit: 100 }),
	retryMoveHarness.context,
);
retryMoveHarness.notFoundHits.compareAndSet = retryMoveCas;
const retryMoveSecond = await handler("public-log-404")(
	publicRoute({ path: retryMovePath }),
	retryMoveHarness.context,
);
check(
	"a failed legacy delete leaves a bounded retry marker",
	retryMoveFirst.recorded === false &&
		retryMoveFirst.reason === "busy" &&
		retryMovePending?.legacyMove?.sourceId === retryMoveLegacyId,
);
check(
	"a pending legacy move is counted once in the dashboard",
	retryMovePendingMonitor.summary.uniquePaths === 1 &&
		retryMovePendingMonitor.summary.totalHits === 3,
);
check(
	"a retry completes the exact legacy move without losing hits",
	retryMoveSecond.recorded === true &&
		!retryMoveHarness.notFoundHits.records.has(retryMoveLegacyId) &&
		retryMoveHarness.notFoundHits.records.size === 1 &&
		retryMoveHarness.notFoundHits.records.get(retryMoveCanonicalId)?.hits === 4 &&
		!retryMoveHarness.notFoundHits.records.get(retryMoveCanonicalId)?.legacyMove,
);

const capacityMoveHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), capacityMoveHarness.context);
for (let index = 0; index < 499; index += 1) {
	const path = `/capacity-move/filler-${index}`;
	const id = legacyNotFoundRecordId(path);
	capacityMoveHarness.notFoundHits.records.set(id, {
		storageVersion: 1,
		id,
		path,
		hits: 1,
		firstSeenAt: "2026-07-17T09:00:00.000Z",
		lastSeenAt: "2026-07-17T09:00:00.000Z",
		status: "open",
		redirectTarget: null,
	});
}
const capacityMovePath = "/capacity-move/pending";
const capacityMoveLegacyId = legacyNotFoundRecordId(capacityMovePath);
capacityMoveHarness.notFoundHits.records.set(capacityMoveLegacyId, {
	storageVersion: 1,
	id: capacityMoveLegacyId,
	path: capacityMovePath,
	hits: 2,
	firstSeenAt: "2026-07-17T09:00:00.000Z",
	lastSeenAt: "2026-07-17T09:00:00.000Z",
	status: "open",
	redirectTarget: null,
});
capacityMoveHarness.notFoundHits.rejectNextCompareDeletes();
const capacityMoveResult = await handler("public-log-404")(
	publicRoute({ path: capacityMovePath }),
	capacityMoveHarness.context,
);
const capacityMoveMonitor = await handler("admin-404-monitor")(
	adminRoute({ limit: 100 }),
	capacityMoveHarness.context,
);
check(
	"a pending legacy move remains visible at the physical storage boundary",
	capacityMoveResult.recorded === false &&
		capacityMoveResult.reason === "busy" &&
		capacityMoveHarness.notFoundHits.records.size === 501 &&
		capacityMoveMonitor.summary.uniquePaths === 500 &&
		capacityMoveMonitor.summary.totalHits === 502 &&
		capacityMoveMonitor.items.some(
			(item: any) => item.path === capacityMovePath && item.hits === 3,
		),
);

const changedMoveHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), changedMoveHarness.context);
const changedMovePath = "/legacy-source-changed";
const changedMoveLegacyId = legacyNotFoundRecordId(changedMovePath);
const changedMoveCanonicalId = await notFoundRecordId(changedMovePath);
changedMoveHarness.notFoundHits.records.set(changedMoveLegacyId, {
	storageVersion: 1,
	id: changedMoveLegacyId,
	path: changedMovePath,
	hits: 2,
	firstSeenAt: "2026-07-17T09:00:00.000Z",
	lastSeenAt: "2026-07-17T09:00:00.000Z",
	status: "open",
	redirectTarget: null,
});
const changedMoveCas = changedMoveHarness.notFoundHits.compareAndSet;
let changedMoveSourceMutated = false;
changedMoveHarness.notFoundHits.rejectNextCompareDeletes();
changedMoveHarness.notFoundHits.compareAndSet = async (
	id: string,
	expected: any,
	next: any,
) => {
	const committed = await changedMoveCas(id, expected, next);
	if (
		!changedMoveSourceMutated &&
		committed &&
		id === changedMoveCanonicalId &&
		next.action === "put"
	) {
		changedMoveSourceMutated = true;
		changedMoveHarness.notFoundHits.records.set(changedMoveLegacyId, {
			...changedMoveHarness.notFoundHits.records.get(changedMoveLegacyId),
			hits: 7,
			lastSeenAt: "2026-07-17T09:05:00.000Z",
		});
	}
	return committed;
};
const changedMoveFirst = await handler("public-log-404")(
	publicRoute({ path: changedMovePath }),
	changedMoveHarness.context,
);
const changedMovePendingMonitor = await handler("admin-404-monitor")(
	adminRoute({ limit: 100 }),
	changedMoveHarness.context,
);
const changedMoveSecond = await handler("public-log-404")(
	publicRoute({ path: changedMovePath }),
	changedMoveHarness.context,
);
check(
	"a changed legacy source remains authoritative while marker rollback is pending",
	changedMovePendingMonitor.summary.uniquePaths === 1 &&
		changedMovePendingMonitor.summary.totalHits === 7 &&
		changedMovePendingMonitor.items[0]?.id === changedMoveLegacyId,
);
check(
	"a changed legacy source recovers after canonical rollback is temporarily unavailable",
	changedMoveSourceMutated &&
		changedMoveFirst.recorded === false &&
		changedMoveFirst.reason === "busy" &&
		changedMoveSecond.recorded === true &&
		!changedMoveHarness.notFoundHits.records.has(changedMoveLegacyId) &&
		changedMoveHarness.notFoundHits.records.size === 1 &&
		changedMoveHarness.notFoundHits.records.get(changedMoveCanonicalId)?.hits === 8 &&
		!changedMoveHarness.notFoundHits.records.get(changedMoveCanonicalId)?.legacyMove,
);

const missingMoveCasHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), missingMoveCasHarness.context);
const missingMoveCasPath = "/legacy-without-cas";
const missingMoveCasLegacyId = legacyNotFoundRecordId(missingMoveCasPath);
missingMoveCasHarness.notFoundHits.records.set(missingMoveCasLegacyId, {
	storageVersion: 1,
	id: missingMoveCasLegacyId,
	path: missingMoveCasPath,
	hits: 1,
	firstSeenAt: "2026-07-17T09:00:00.000Z",
	lastSeenAt: "2026-07-17T09:00:00.000Z",
	status: "open",
	redirectTarget: null,
});
missingMoveCasHarness.notFoundHits.compareAndSet = undefined as any;
const missingMoveCasResult = await handler("public-log-404")(
	publicRoute({ path: missingMoveCasPath }),
	missingMoveCasHarness.context,
);
check(
	"legacy moves fail closed when conditional storage is unavailable",
	missingMoveCasResult.recorded === false &&
		missingMoveCasResult.reason === "busy" &&
		missingMoveCasHarness.notFoundHits.records.size === 1 &&
		missingMoveCasHarness.notFoundHits.records.has(missingMoveCasLegacyId),
);

const legacyTriageRaceHarness = createContext();
await handler("save-admin-modules")(
	adminRoute({ ...modules, expectedRevision: null }),
	legacyTriageRaceHarness.context,
);
const legacyTriagePath = "/legacy-triage-race";
const legacyTriageId = legacyNotFoundRecordId(legacyTriagePath);
legacyTriageRaceHarness.notFoundHits.records.set(legacyTriageId, {
	storageVersion: 1,
	id: legacyTriageId,
	path: legacyTriagePath,
	hits: 1,
	firstSeenAt: "2026-07-17T09:00:00.000Z",
	lastSeenAt: "2026-07-17T09:00:00.000Z",
	status: "open",
	redirectTarget: null,
});
legacyTriageRaceHarness.notFoundHits.synchronizeNextGets(legacyTriageId);
await Promise.all([
	handler("public-log-404")(
		publicRoute({ path: legacyTriagePath }),
		legacyTriageRaceHarness.context,
	),
	handler("triage-admin-404")(
		adminRoute({
			id: legacyTriageId,
			status: "resolved",
			redirectTarget: "/services",
		}),
		legacyTriageRaceHarness.context,
	),
]);
const legacyTriageRecords = [
	...legacyTriageRaceHarness.notFoundHits.records.values(),
].filter((record) => record.path === legacyTriagePath);
check(
	"legacy migration and triage preserve one resolved v2 record",
	legacyTriageRecords.length === 1 &&
		legacyTriageRecords[0]?.storageVersion === 2 &&
		legacyTriageRecords[0]?.hits === 2 &&
		legacyTriageRecords[0]?.status === "resolved" &&
		legacyTriageRecords[0]?.redirectTarget === "/services" &&
		!legacyTriageRaceHarness.notFoundHits.records.has(legacyTriageId),
);

const realNow = Date.now;
try {
	const capacityNow = realNow();
	Date.now = () => capacityNow;
	const capacityHarness = createContext();
	await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), capacityHarness.context);
	capacityHarness.notFoundHits.resetMetrics();
	for (let index = 0; index < 500; index += 1) {
		await handler("public-log-404")(
			publicRoute({ path: `/capacity/${index.toString(36)}` }),
			capacityHarness.context,
		);
	}
	const atCapacity = await handler("public-log-404")(
		publicRoute({ path: "/capacity/overflow" }),
		capacityHarness.context,
	);
	check(
		"the public monitor enforces its 500-record capacity",
		atCapacity.reason === "capacity" && capacityHarness.notFoundHits.records.size === 500,
	);
	check(
		"capacity enforcement spends at most one write per admitted unique path",
		capacityHarness.notFoundHits.metrics.puts === 500,
	);
	check(
		"public logging never loads and trims the full monitor collection",
		capacityHarness.notFoundHits.metrics.queries === 0,
	);
} finally {
	Date.now = realNow;
}

const deadlineHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), deadlineHarness.context);
const deadlineQuery = deadlineHarness.operationLeases.query;
let deadlineNow = realNow();
let crossedDeadline = false;
try {
	Date.now = () => deadlineNow;
	const seededAdmission = await handler("public-log-404")(
		publicRoute({ path: "/deadline/existing" }),
		deadlineHarness.context,
	);
	const beforeDeadline = JSON.stringify([...deadlineHarness.notFoundHits.records]);
	deadlineHarness.notFoundHits.resetMetrics();
	deadlineHarness.operationLeases.query = async (options: any) => {
		const result = await deadlineQuery(options);
		if (!crossedDeadline && options?.where?.scope === "404-monitor:capacity-admission") {
			crossedDeadline = true;
			deadlineNow += 251;
		}
		return result;
	};
	const expiredAdmission = await handler("public-log-404")(
		publicRoute({ path: "/deadline/refused" }),
		deadlineHarness.context,
	);
	check(
		"an expired capacity admission deadline returns busy without changing 404 records",
		seededAdmission.recorded === true && crossedDeadline &&
			expiredAdmission.recorded === false &&
			expiredAdmission.reason === "busy" &&
			JSON.stringify([...deadlineHarness.notFoundHits.records]) === beforeDeadline &&
			deadlineHarness.notFoundHits.metrics.puts === 0 &&
			deadlineHarness.notFoundHits.metrics.deletes === 0 &&
			deadlineHarness.notFoundHits.metrics.counts === 0 &&
			deadlineHarness.notFoundHits.metrics.queries === 0 &&
			deadlineHarness.operationLeases.records.size === 0,
	);
} finally {
	Date.now = realNow;
	deadlineHarness.operationLeases.query = deadlineQuery;
}

const concurrentCapacityHarness = createContext();
await handler("save-admin-modules")(adminRoute({ ...modules, expectedRevision: null }), concurrentCapacityHarness.context);
for (let index = 0; index < 499; index += 1) {
	concurrentCapacityHarness.notFoundHits.records.set(`seed-${index}`, { index });
}
concurrentCapacityHarness.notFoundHits.synchronizeNextCounts();
concurrentCapacityHarness.notFoundHits.rejectNextCompareDeletes(2);
const secondCapacityIsolate = {
	...concurrentCapacityHarness.context,
	plugin: { id: "shipit-seo-capacity-isolate", version: "test" },
};
const concurrentCapacityResults = await Promise.all([
	handler("public-log-404")(
		publicRoute({ path: "/capacity/concurrent-a" }),
		concurrentCapacityHarness.context,
	),
	handler("public-log-404")(
		publicRoute({ path: "/capacity/concurrent-b" }),
		secondCapacityIsolate,
	),
]);
const concurrentlyAdmitted = concurrentCapacityResults.filter((result) => result.recorded).length;
check(
	"concurrent unique paths cannot cross the 500-record cap",
	concurrentlyAdmitted === 1 &&
		concurrentCapacityResults.filter((result) => result.reason === "capacity")
			.length === 1 &&
		concurrentCapacityHarness.notFoundHits.records.size === 500 &&
		concurrentCapacityHarness.notFoundHits.metrics.deleteAttempts === 0,
);

if (failures) {
	console.error(`\n${failures} SEO 404 runtime self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nAll SEO 404 runtime self-checks passed.");
}
