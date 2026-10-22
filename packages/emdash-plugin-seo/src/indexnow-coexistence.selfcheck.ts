import assert from "node:assert/strict";
import { SEO_ADMIN_INDEXNOW_STORAGE_VERSION, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import {
	deliverIndexNowQueue,
	enqueueIndexNowUrls,
	INDEXNOW_SETTINGS_STORAGE_KEY,
	resumeVerifiedIndexNowQueue,
	retryFailedIndexNowJobs,
	retryIndexNowSubmission,
	withIndexNowQueueLease,
} from "./indexnow-runtime.ts";
import { defaultIndexNowSettings } from "./indexnow.ts";
import { bindCoexistenceHost } from "./plugin-coexistence-runtime.ts";
import { classifyNativePluginInventory, COEXISTENCE_PROFILES } from "./plugin-coexistence.ts";

const ORIGIN = "https://example.com";
const clone = <T>(value: T): T => structuredClone(value);
type Row = Record<string, any>;
let groups = 0;
function passed(label: string) { groups += 1; console.log("PASS " + label); }

function memoryCollection() {
	const values = new Map<string, Row>();
	const stats = { writes: 0, deletes: 0 };
	const hooks: { query?: () => void; put?: () => void } = {};
	const matches = (value: Row, where?: Row) => !where || Object.entries(where).every(([key, expected]) => value[key] === expected);
	const api: Record<string, any> = {
		get: async (id: string) => clone(values.get(id) ?? null),
		put: async (id: string, value: Row) => {
			stats.writes += 1;
			values.set(id, clone(value));
			hooks.put?.();
		},
		delete: async (id: string) => { stats.deletes += 1; return values.delete(id); },
		compareAndSet: async (id: string, expected: any, next: any) => {
			if (expected.state === "missing" ? values.has(id) : !values.has(id)) return false;
			if (expected.state === "value" && JSON.stringify(values.get(id)) !== JSON.stringify(expected.value)) return false;
			if (next.action === "delete") await api.delete(id);
			else await api.put(id, next.value);
			return true;
		},
		getMany: async (ids: string[]) => new Map(ids.flatMap((id) => values.has(id) ? [[id, clone(values.get(id))]] : [])),
		deleteMany: async (ids: string[]) => {
			let deleted = 0;
			for (const id of ids) if (await api.delete(id)) deleted += 1;
			return deleted;
		},
		count: async (where?: Row) => [...values.values()].filter((value) => matches(value, where)).length,
		query: async (options: Row = {}) => {
			hooks.query?.();
			const rows = [...values].filter(([, value]) => matches(value, options.where));
			const order = Object.entries(options.orderBy ?? {})[0];
			if (order) {
				const [field, direction] = order;
				rows.sort((left, right) => {
					const compared = String(left[1][field] ?? "").localeCompare(String(right[1][field] ?? ""));
					return direction === "asc" ? compared : -compared;
				});
			}
			const start = Number(options.cursor ?? 0);
			const limit = options.limit ?? 100;
			const hasMore = start + limit < rows.length;
			return {
				items: rows.slice(start, start + limit).map(([id, data]) => ({ id, data: clone(data) })),
				...(hasMore ? { cursor: String(start + limit) } : {}), hasMore,
			};
		},
	};
	return { values, api, stats, hooks };
}

function harness(nativePort = true) {
	const jobStore = memoryCollection();
	const historyStore = memoryCollection();
	const pageStore = memoryCollection();
	const deliveryStore = memoryCollection();
	const leaseStore = memoryCollection();
	const values = { ...defaultIndexNowSettings(), enabled: true, autoSubmit: true, apiKey: "synthetic-indexnow-key", batchSize: 1 };
	const kv = new Map<string, any>([[INDEXNOW_SETTINGS_STORAGE_KEY, {
		version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
		updatedAt: "2026-10-16T00:00:00.000Z",
		values,
		verification: { siteOrigin: ORIGIN, keyLocation: values.keyLocation, apiKey: values.apiKey, checkedAt: "2026-10-16T00:00:00.000Z" },
	}]]);
	const state = { active: false, unavailable: false, observations: 0, kvWrites: 0, schedules: 0, cancellations: 0, responseStatus: 200 };
	const hooks: { settingsRead?: () => void; dispatch?: () => void } = {};
	const requests: unknown[] = [];
	const tasks = new Map<string, any>();
	const ctx: any = {
		plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
		site: { url: ORIGIN },
		kv: {
			get: async (key: string) => { if (key === INDEXNOW_SETTINGS_STORAGE_KEY) hooks.settingsRead?.(); return clone(kv.get(key) ?? null); },
			set: async (key: string, value: unknown) => { state.kvWrites += 1; kv.set(key, clone(value)); },
		},
		storage: { indexnowJobs: jobStore.api, indexnowSubmissions: historyStore.api,
			indexnowSubmissionUrls: pageStore.api, indexnowDeliveries: deliveryStore.api, operationLeases: leaseStore.api },
		cron: {
			list: async () => [...tasks.values()].map(clone),
			schedule: async (name: string, input: any) => {
				state.schedules += 1;
				tasks.set(name, { name, schedule: input.schedule, nextRunAt: input.schedule });
			},
			cancel: async (name: string) => { state.cancellations += 1; tasks.delete(name); },
		},
		http: { fetch: async (url: string, init: RequestInit) => {
			requests.push({ url, payload: JSON.parse(String(init.body)) });
			hooks.dispatch?.();
			return new Response(null, { status: state.responseStatus });
		} },
		log: { info() {}, warn() {}, error() {}, debug() {} },
	};
	if (nativePort) bindCoexistenceHost(ctx, { observe: async () => {
		state.observations += 1;
		if (state.unavailable) throw new Error("synthetic inventory unavailable");
		const profile = COEXISTENCE_PROFILES.find((item) => item.id === "instant-indexer")!;
		return classifyNativePluginInventory({ configured: [], rows: state.active ? [{
			id: profile.runtimeId, source: "registry", version: profile.assessedVersion, status: "active",
			publisherDid: profile.publisherDid, slug: profile.slug,
		}] : [] });
	} });
	const snapshot = () => clone({ kv: [...kv], jobs: [...jobStore.values], history: [...historyStore.values],
		pages: [...pageStore.values], deliveries: [...deliveryStore.values], tasks: [...tasks] });
	const enqueue = (count = 1) => enqueueIndexNowUrls(ctx, ORIGIN, Array.from({ length: count }, (_, index) => ({ url: `/page-${index}`, reason: "manual" as const })));
	return { ctx, state, hooks, requests, tasks, kv, jobStore, historyStore, pageStore, deliveryStore, leaseStore, snapshot, enqueue };
}

function assertPaused(result: { success: boolean; error?: string; detail?: string }) {
	assert.equal(result.success, false);
	assert.equal(result.error, "coexistence_paused");
	assert.ok(result.detail && result.detail.length < 200);
}

{
	const h = harness(false);
	assert.equal((await h.enqueue()).success, true);
	const result = await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true });
	assert.equal(result.success, true);
	assert.equal(result.processed, 1);
	assert.equal(h.requests.length, 1);
	assert.equal(h.state.observations, 0);
	assert.equal(h.leaseStore.values.size, 0);
	passed("contexts without a native port retain enqueue and delivery behavior");
}

{
	const h = harness();
	h.state.active = true;
	const before = h.snapshot();
	assertPaused(await h.enqueue());
	assert.deepEqual(h.snapshot(), before);
	assert.equal(h.jobStore.stats.writes, 0);
	assert.equal(h.leaseStore.stats.writes, 0);
	assert.equal(h.requests.length, 0);
	assert.equal(h.state.observations, 1);
	passed("an active native peer blocks enqueue before durable queue or lease writes");
}

{
	const h = harness();
	assert.equal((await h.enqueue()).success, true);
	h.state.active = true;
	const before = h.snapshot();
	const writes = h.leaseStore.stats.writes;
	const observed = h.state.observations;
	const result = await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true, currentTask: "indexnow-drain-existing" });
	assertPaused(result);
	assert.equal(result.processed, 0);
	assert.deepEqual(h.snapshot(), before);
	assert.equal(h.leaseStore.stats.writes, writes);
	assert.equal(h.requests.length, 0);
	assert.equal(h.state.observations - observed, 1);
	passed("a queued or cron drain pauses without losing jobs, history or its existing schedule");
}

{
	const h = harness();
	h.state.unavailable = true;
	const before = h.snapshot();
	assertPaused(await h.enqueue());
	assertPaused(await deliverIndexNowQueue(h.ctx, ORIGIN));
	assert.deepEqual(h.snapshot(), before);
	assert.equal(h.state.observations, 2);
	assert.equal(h.requests.length, 0);
	passed("unavailable native inventory fails closed without effects");
}

{
	const h = harness();
	h.hooks.settingsRead = () => { h.state.active = true; };
	assertPaused(await h.enqueue());
	assert.equal(h.jobStore.values.size, 0);
	assert.equal(h.historyStore.values.size, 0);
	assert.equal(h.state.kvWrites, 0);
	assert.equal(h.state.schedules, 0);
	assert.equal(h.leaseStore.values.size, 0);
	assert.equal(h.state.observations, 2);
	passed("activation during settings read is rechecked before queue mutation and releases the lease");
}

{
	const h = harness();
	h.jobStore.hooks.put = () => { h.state.active = true; };
	const result = await h.enqueue(1000);
	assertPaused(result);
	assert.equal(result.enqueued, 1000);
	assert.equal(result.history, "recorded");
	assert.equal(h.jobStore.values.size, 1000);
	assert.equal(h.historyStore.values.size, 1);
	assert.equal(h.pageStore.values.size, 10);
	assert.ok([...h.jobStore.values.values()].every((job) => job.status === "pending" && job.attempts === 0));
	assert.equal(h.state.observations, 3, "inventory reads are bounded per operation, never per URL");
	assert.equal(h.state.schedules, 0);
	assert.equal(h.state.cancellations, 0);
	assert.equal(h.requests.length, 0);
	assert.equal(h.leaseStore.values.size, 0);
	passed("mid-batch activation retains 1000 pending jobs and their history with only three observations");
}

{
	const h = harness();
	await h.enqueue();
	const before = h.snapshot();
	const observed = h.state.observations;
	h.jobStore.hooks.query = () => { h.state.active = true; };
	assertPaused(await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true }));
	assert.deepEqual(h.snapshot(), before);
	assert.equal(h.requests.length, 0);
	assert.equal(h.state.observations - observed, 2);
	assert.equal(h.leaseStore.values.size, 0);
	passed("activation between reading queued jobs and transport blocks the actual provider call");
}

{
	const h = harness();
	await h.enqueue(3);
	const scheduled = h.state.schedules;
	const cancelled = h.state.cancellations;
	const observed = h.state.observations;
	h.hooks.dispatch = () => { h.state.active = true; };
	const result = await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true });
	assertPaused(result);
	assert.equal(result.processed, 1);
	assert.equal(result.delivery?.status, "accepted");
	assert.equal(h.deliveryStore.values.size, 1);
	assert.equal([...h.jobStore.values.values()].filter((job) => job.status === "delivered").length, 1);
	assert.equal([...h.jobStore.values.values()].filter((job) => job.status === "pending").length, 2);
	assert.equal(h.state.schedules, scheduled);
	assert.equal(h.state.cancellations, cancelled);
	assert.equal(h.state.observations - observed, 3);
	const afterAttempt = h.snapshot();
	assertPaused(await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true }));
	assert.deepEqual(h.snapshot(), afterAttempt);
	assert.equal(h.requests.length, 1);
	assert.equal(h.leaseStore.values.size, 0);
	passed("an in-flight attempt stays auditable while a later batch and further scheduling pause");
}

{
	const h = harness();
	await h.enqueue();
	h.state.responseStatus = 403;
	assert.equal((await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true })).error, "delivery_failed");
	h.state.active = true;
	const before = h.snapshot();
	const attempts = h.requests.length;
	const observed = h.state.observations;
	const submissionId = [...h.historyStore.values.keys()][0]!;
	assertPaused(await retryFailedIndexNowJobs(h.ctx, ORIGIN));
	assertPaused(await retryIndexNowSubmission(h.ctx, ORIGIN, submissionId));
	assert.deepEqual(h.snapshot(), before);
	assert.equal(h.requests.length, attempts);
	assert.equal(h.state.observations - observed, 2);
	passed("retry-all and retry-one preserve failed jobs and history while paused");
}

{
	const h = harness();
	h.tasks.set("indexnow-drain-existing", { name: "indexnow-drain-existing", nextRunAt: "2026-10-16T00:00:00.000Z" });
	const before = h.snapshot();
	h.jobStore.hooks.query = () => { h.state.active = true; };
	assertPaused(await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true }));
	assert.deepEqual(h.snapshot(), before);
	assert.equal(h.state.cancellations, 0);
	assert.equal(h.state.observations, 2);
	assert.equal(h.requests.length, 0);
	passed("the no-due-jobs path does not cancel existing tasks after activation");
}

{
	const h = harness();
	await h.enqueue();
	h.state.active = true;
	const before = h.snapshot();
	await assert.rejects(() => withIndexNowQueueLease(h.ctx, (owner) => resumeVerifiedIndexNowQueue(h.ctx, owner)), /IndexNow is paused/);
	assert.deepEqual(h.snapshot(), before);
	assert.equal(h.leaseStore.values.size, 0);
	passed("setup queue resumption reports a fresh scheduling pause and releases ownership");
}

{
	const h = harness();
	const stored = h.kv.get(INDEXNOW_SETTINGS_STORAGE_KEY);
	stored.values.enabled = false;
	stored.values.autoSubmit = false;
	h.state.active = true;
	assertPaused(await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true }));
	const before = h.snapshot();
	h.state.active = false;
	assert.deepEqual(h.snapshot(), before, "peer removal itself performs no catch-up or enabling");
	const result = await deliverIndexNowQueue(h.ctx, ORIGIN, { force: true });
	assert.equal(result.error, "indexnow_disabled");
	assert.deepEqual(h.snapshot(), before);
	assert.equal(h.requests.length, 0);
	assert.equal(h.state.kvWrites, 0);
	assert.equal(h.state.schedules, 0);
	passed("an absent peer does not enable saved-off delivery or automatic submission");
}

console.log(`IndexNow coexistence: ${groups} groups passed; in-memory native-port fixtures, no external requests.`);
