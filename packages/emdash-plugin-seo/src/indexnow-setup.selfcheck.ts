import assert from "node:assert/strict";
import test from "node:test";
import type { PluginContext } from "emdash";
import { SEO_ADMIN_INDEXNOW_STORAGE_VERSION } from "./admin-contract.ts";
import { defaultIndexNowSettings, type IndexNowInstallation } from "./indexnow.ts";
import {
	INDEXNOW_SETTINGS_STORAGE_KEY, buildAdminIndexNowStatus, publicIndexNowKey,
	deliverIndexNowQueue, enqueueIndexNowUrls, readIndexNowSettings, updateIndexNowSettings,
} from "./indexnow-runtime.ts";
import { setupIndexNow } from "./indexnow-setup.ts";
import { IndexNowSetupError, indexNowVerificationUrl, verifyIndexNowKey } from "./indexnow-verification.ts";

function memoryCollection() {
	const values = new Map<string, any>();
	const store = {
		get: async (id: string) => structuredClone(values.get(id) ?? null),
		put: async (id: string, value: unknown) => { values.set(id, structuredClone(value)); },
		compareAndSet: async (
			id: string,
			expected: { state: "missing" } | { state: "value"; value: unknown },
			next: { action: "delete" } | { action: "put"; value: unknown },
		) => {
			const current = values.get(id);
			if (expected.state === "missing" ? current !== undefined : JSON.stringify(current) !== JSON.stringify(expected.value))
				return false;
			if (next.action === "delete") values.delete(id);
			else values.set(id, structuredClone(next.value));
			return true;
		},
		query: async (options: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; limit?: number } = {}) => {
			const items = [...values.entries()]
				.filter(([, value]) => Object.entries(options.where ?? {}).every(([key, expected]) => value[key] === expected));
			const [field, direction] = Object.entries(options.orderBy ?? {})[0] ?? [];
			if (field) items.sort((left, right) => {
				const leftValue = left[1][field];
				const rightValue = right[1][field];
				if (leftValue == null || rightValue == null) {
					if (leftValue == null && rightValue == null) return 0;
					return (leftValue == null ? 1 : -1) * (direction === "desc" ? -1 : 1);
				}
				return String(leftValue).localeCompare(String(rightValue)) * (direction === "desc" ? -1 : 1);
			});
			return { items: items.slice(0, options.limit ?? 100).map(([id, data]) => ({ id, data: structuredClone(data) })), hasMore: items.length > (options.limit ?? 100) };
		},
		count: async (where?: Record<string, unknown>) => [...values.values()]
			.filter((value) => Object.entries(where ?? {}).every(([key, expected]) => value[key] === expected)).length,
	};
	return { values, store };
}

function fixture(initial?: Record<string, unknown>, verification?: Record<string, unknown>) {
	let value: unknown = initial ? {
		version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION, updatedAt: "2026-09-01T00:00:00.000Z",
		values: { ...defaultIndexNowSettings(), ...initial },
		...(verification ? { verification } : {}),
	} : null;
	let revision = value === null ? 0 : 1;
	const requests: { url: string; init?: RequestInit }[] = [];
	const writes: unknown[] = [];
	const kv = {
		get: async (key: string) => { assert.equal(key, INDEXNOW_SETTINGS_STORAGE_KEY); return structuredClone(value); },
		getVersioned: async (key: string) => {
			assert.equal(key, INDEXNOW_SETTINGS_STORAGE_KEY);
			return value === null ? null : { value: structuredClone(value), revision: String(revision) };
		},
		compareAndSet: async (key: string, expected: string | null, next: unknown) => {
			assert.equal(key, INDEXNOW_SETTINGS_STORAGE_KEY);
			if ((value === null ? null : String(revision)) !== expected) return { applied: false };
			value = structuredClone(next); revision++; writes.push(structuredClone(next));
			return { applied: true, revision: String(revision) };
		},
	};
	const leases = memoryCollection();
	const jobs = memoryCollection();
	const deliveries = memoryCollection();
	const scheduled = new Map<string, { name: string; nextRunAt: string }>();
	const ctx = {
		kv, storage: { operationLeases: leases.store, indexnowJobs: jobs.store, indexnowDeliveries: deliveries.store },
		plugin: { id: "shipit-seo" }, site: { url: "https://example.com" },
		log: { warn: () => undefined, info: () => undefined },
		cron: {
			schedule: async (name: string, options: { schedule: string }) => { scheduled.set(name, { name, nextRunAt: options.schedule }); },
			cancel: async (name: string) => { scheduled.delete(name); },
			list: async () => [...scheduled.values()],
		},
		http: { fetch: async (url: string, init?: RequestInit) => {
			requests.push({ url, init });
			const key = await publicIndexNowKey(ctx as unknown as PluginContext);
			assert.equal(key.configured, true);
			return new Response(key.key, { headers: { "content-type": "text/plain; charset=utf-8" } });
		} },
	} as unknown as PluginContext;
	return { ctx, kv, requests, writes, leases, jobs, scheduled };
}
const site = async () => "https://example.com";

test("setup generates one key, verifies the public file, then enables delivery without automation", async () => {
	const f = fixture();
	const result = await setupIndexNow(f.ctx, null, site);
	assert.match(result.values.apiKey, /^[a-f0-9]{32}$/);
	assert.equal(result.values.enabled, true);
	assert.equal(result.values.autoSubmit, false, "first activation never starts automatic submission");
	assert.deepEqual(result.values.autoSubmitContentTypes, ["pages", "posts"]);
	assert.equal((f.writes[0] as any).values.enabled, false);
	assert.equal(f.writes.length, 2);
	assert.equal(f.requests.length, 1);
	assert.equal(f.requests[0].url, "https://example.com/indexnow-key.txt");
	assert.equal(f.requests[0].init?.redirect, "manual");
	assert.equal(f.requests[0].init?.credentials, "omit");
	assert.equal(new Headers(f.requests[0].init?.headers).has("authorization"), false);
	assert.equal(new Headers(f.requests[0].init?.headers).has("cookie"), false);
	assert.equal((await buildAdminIndexNowStatus(f.ctx, await site())).readiness.state, "ready");
	assert.equal((await buildAdminIndexNowStatus(f.ctx, "https://other.example.com")).readiness.state, "needs-setup");
});

test("an existing key and delivery tuning survive setup and repeated verification", async () => {
	const f = fixture({ apiKey: "existing-key-123", batchSize: 27, maxAttempts: 7, autoSubmit: false });
	const current = await readIndexNowSettings(f.ctx);
	const first = await setupIndexNow(f.ctx, current.updatedAt, site);
	const second = await setupIndexNow(f.ctx, first.updatedAt, site);
	assert.equal(second.values.apiKey, "existing-key-123");
	assert.equal(second.values.batchSize, 27);
	assert.equal(second.values.maxAttempts, 7);
	assert.equal(second.values.autoSubmit, false);
	assert.equal(f.writes.length, 2);
	assert.ok(f.scheduled.size <= 1, "repeated activation never duplicates background tasks");
});

test("a legacy record that was never turned on activates without automatic submission", async () => {
	// Earlier versions seeded every installation with automation on for all types.
	const f = fixture({ autoSubmit: true, autoSubmitContentTypes: null });
	const saved = await setupIndexNow(f.ctx, (await readIndexNowSettings(f.ctx)).updatedAt, site);
	assert.equal(saved.values.autoSubmit, false);
	assert.equal(saved.values.autoSubmitContentTypes, null, "the legacy all-eligible selection is not narrowed");
});

test("a site that was on before keeps its automatic choice and selection when verified again", async () => {
	for (const [initial, verification] of [
		[{ enabled: true, autoSubmit: true, autoSubmitContentTypes: null, apiKey: "existing-key-123" }, undefined],
		[{ enabled: false, autoSubmit: true, autoSubmitContentTypes: ["guides"], apiKey: "existing-key-123" }, {
			siteOrigin: "https://example.com", keyLocation: "/indexnow-key.txt", apiKey: "existing-key-123", checkedAt: "2026-09-01T00:00:00.000Z",
		}],
	] as const) {
		const f = fixture({ ...initial }, verification ? { ...verification } : undefined);
		const saved = await setupIndexNow(f.ctx, (await readIndexNowSettings(f.ctx)).updatedAt, site);
		assert.equal(saved.values.enabled, true);
		assert.equal(saved.values.autoSubmit, true);
		assert.deepEqual(saved.values.autoSubmitContentTypes, initial.autoSubmitContentTypes);
	}
});

test("installation problems stop setup before a key is stored or a request is made", async () => {
	const local: IndexNowInstallation = { mode: "astro", siteUrl: null, siteOrigin: "http://127.0.0.1:4362", siteIssue: "local", keyRoute: "injected" };
	const missing: IndexNowInstallation = { mode: "astro", siteUrl: null, siteOrigin: null, siteIssue: "missing", keyRoute: "injected" };
	const unbound: IndexNowInstallation = { mode: "legacy", siteUrl: null, siteOrigin: null, siteIssue: null, keyRoute: null };
	const rootless: IndexNowInstallation = { mode: "astro", siteUrl: "https://example.com", siteOrigin: "https://example.com", siteIssue: null, keyRoute: "unavailable" };
	for (const [installation, origin, message] of [
		[local, "http://127.0.0.1:4362", /cannot reach http:\/\/127\.0\.0\.1:4362/],
		[missing, "", /public HTTPS address/],
		[unbound, "https://example.com", /cannot read the key file on https:\/\/example\.com/],
		[rootless, "https://example.com", /root path/],
	] as const) {
		const f = fixture();
		await assert.rejects(setupIndexNow(f.ctx, null, async () => origin, { installation }), (error: unknown) =>
			error instanceof IndexNowSetupError && error.step === "origin" && message.test(error.message));
		assert.equal(f.writes.length, 0);
		assert.equal(f.requests.length, 0);
	}
	const bound = fixture();
	const saved = await setupIndexNow(bound.ctx, null, site, {
		installation: { mode: "astro", siteUrl: "https://example.com", siteOrigin: "https://example.com", siteIssue: null, keyRoute: "injected" },
	});
	assert.equal(saved.values.enabled, true);
});

test("failed verification retains a disabled key and retry reuses it", async () => {
	const f = fixture();
	const transport = f.ctx.http!.fetch;
	f.ctx.http!.fetch = async () => new Response("wrong-key", { headers: { "content-type": "text/plain" } });
	await assert.rejects(setupIndexNow(f.ctx, null, site), (error: unknown) =>
		error instanceof IndexNowSetupError && error.step === "verify" && /current key/.test(error.message));
	const pending = await readIndexNowSettings(f.ctx);
	assert.equal(pending.values.enabled, false);
	assert.ok(pending.values.apiKey);
	assert.equal((await publicIndexNowKey(f.ctx)).key, pending.values.apiKey);
	f.ctx.http!.fetch = transport;
	const saved = await setupIndexNow(f.ctx, pending.updatedAt, site);
	assert.equal(saved.values.apiKey, pending.values.apiKey);
});

test("a stale settings version cannot generate a key or make network requests", async () => {
	const f = fixture({});
	await assert.rejects(setupIndexNow(f.ctx, null, site), /settings changed/);
	assert.equal(f.writes.length, 0);
	assert.equal(f.requests.length, 0);
});

test("settings changed during verification are not overwritten", async () => {
	const f = fixture();
	const transport = f.ctx.http!.fetch;
	f.ctx.http!.fetch = async (...args) => {
		const response = await transport(...args);
		const snapshot = await f.kv.getVersioned(INDEXNOW_SETTINGS_STORAGE_KEY);
		assert.ok(snapshot);
		await f.kv.compareAndSet(INDEXNOW_SETTINGS_STORAGE_KEY, snapshot.revision, {
			...(snapshot.value as Record<string, unknown>),
			values: { ...(snapshot.value as any).values, batchSize: 13 },
		});
		return response;
	};
	await assert.rejects(setupIndexNow(f.ctx, null, site), /settings changed/);
	const current = await readIndexNowSettings(f.ctx);
	assert.equal(current.values.batchSize, 13);
	assert.equal(current.values.enabled, false);
});

test("a site address changed during verification prevents activation", async () => {
	const f = fixture();
	let calls = 0;
	await assert.rejects(setupIndexNow(f.ctx, null, async () => ++calls === 1 ? await site() : "https://other.example.com"), /address changed/);
	assert.equal((await readIndexNowSettings(f.ctx)).values.enabled, false);
});

test("losing the queue lease during verification cannot activate a new key", async () => {
	const f = fixture();
	const transport = f.ctx.http!.fetch;
	f.ctx.http!.fetch = async (...args) => {
		const response = await transport(...args);
		f.leases.values.clear();
		return response;
	};
	await assert.rejects(setupIndexNow(f.ctx, null, site), /ownership/);
	assert.equal((await readIndexNowSettings(f.ctx)).values.enabled, false);
	assert.equal(f.writes.length, 1);
});

test("native storage and network are checked before writes", async () => {
	for (const missing of ["kv", "http", "queue"] as const) {
		const f = fixture();
		if (missing === "kv") delete (f.ctx.kv as any).getVersioned;
		else if (missing === "queue") delete (f.ctx.storage.indexnowJobs as any).compareAndSet;
		else delete (f.ctx as any)[missing];
		await assert.rejects(setupIndexNow(f.ctx, null, site));
		assert.equal(f.writes.length, 0);
	}
});

test("configuration alone is not reported as verified; changing key invalidates verification", async () => {
	const f = fixture({ enabled: true, apiKey: "existing-key-123" });
	assert.equal((await buildAdminIndexNowStatus(f.ctx, await site())).readiness.state, "needs-setup");
	const saved = await setupIndexNow(f.ctx, (await readIndexNowSettings(f.ctx)).updatedAt, site);
	await updateIndexNowSettings(f.ctx, (current) => ({ ...current.values, batchSize: 19 }));
	assert.equal((await buildAdminIndexNowStatus(f.ctx, await site())).readiness.state, "ready");
	await updateIndexNowSettings(f.ctx, (current) => ({ ...current.values, apiKey: "replacement-key-123" }));
	assert.equal((await buildAdminIndexNowStatus(f.ctx, await site())).readiness.state, "needs-setup");
	assert.equal(saved.values.apiKey, "existing-key-123");
});

test("unsafe origins and key paths cannot be probed", async () => {
	const settings = { ...defaultIndexNowSettings(), apiKey: "existing-key-123" };
	for (const url of ["http://example.com", "https://127.0.0.1", "https://localhost", "https://[::1]", "https://user:pass@example.com", "https://example.com:8443", "https://example.com/admin"])
		assert.throws(() => indexNowVerificationUrl(settings, url));
	for (const keyLocation of ["https://other.example.com/key.txt", "/nested/key.txt", "/key.txt?x=1", "/%2fsecret.txt", "https://user:pass@example.com/key.txt"])
		assert.throws(() => indexNowVerificationUrl({ ...settings, keyLocation }, "https://example.com"));
	assert.throws(() => indexNowVerificationUrl({ ...settings, apiKey: "" }, "https://example.com"));
	const f = fixture();
	await assert.rejects(setupIndexNow(f.ctx, null, async () => "https://127.0.0.1"));
	assert.equal(f.writes.length, 0);
	assert.equal(f.requests.length, 0);
});

test("redirects, HTTP errors, HTML, oversized bodies and incorrect keys fail verification", async () => {
	const settings = { ...defaultIndexNowSettings(), apiKey: "existing-key-123" };
	const redirectedByHost = new Response(settings.apiKey, { headers: { "content-type": "text/plain" } });
	Object.defineProperty(redirectedByHost, "url", { value: "https://example.com/other-key.txt" });
	for (const response of [
		redirectedByHost,
		new Response(null, { status: 302, headers: { location: "https://example.com/next" } }),
		new Response("not found", { status: 404 }),
		new Response(settings.apiKey, { headers: { "content-type": "text/html" } }),
		new Response("x".repeat(257), { headers: { "content-type": "text/plain" } }),
		new Response("different-key", { headers: { "content-type": "text/plain" } }),
		new Response(new Uint8Array([255]), { headers: { "content-type": "text/plain" } }),
	]) {
		const f = fixture();
		f.ctx.http!.fetch = async () => response;
		await assert.rejects(verifyIndexNowKey(f.ctx, settings, await site()));
	}
});

test("a stalled host request expires without enabling delivery", async () => {
	const f = fixture();
	f.ctx.http!.fetch = async () => new Promise<Response>(() => {});
	await assert.rejects(setupIndexNow(f.ctx, null, site), /timed out/);
	assert.equal((await readIndexNowSettings(f.ctx)).values.enabled, false);
});

test("setup does not need background scheduling", async () => {
	const f = fixture();
	delete (f.ctx as any).cron;
	const saved = await setupIndexNow(f.ctx, null, site);
	assert.equal(saved.values.enabled, true);
	assert.equal(saved.values.autoSubmit, false);
	assert.equal((await buildAdminIndexNowStatus(f.ctx, await site())).readiness.title, "Manual delivery is ready");
	assert.equal((await buildAdminIndexNowStatus(f.ctx, await site())).manualSubmissionReady, true);
});

test("verified manual delivery remains ready when automatic scheduling disappears", async () => {
	const f = fixture({ enabled: true, autoSubmit: true, apiKey: "existing-key-123" });
	await setupIndexNow(f.ctx, (await readIndexNowSettings(f.ctx)).updatedAt, site);
	delete (f.ctx as any).cron;
	const status = await buildAdminIndexNowStatus(f.ctx, await site());
	assert.equal(status.readiness.state, "unavailable");
	assert.equal(status.manualSubmissionReady, true);
});

test("verification resumes pending work after an unverified cron run", async () => {
	const f = fixture();
	await setupIndexNow(f.ctx, null, site);
	const queued = await enqueueIndexNowUrls(f.ctx, await site(), [{ url: "/pending-before-rotation", reason: "manual" }]);
	assert.equal(queued.success, true);
	assert.equal(f.jobs.values.size, 1);
	assert.equal(f.scheduled.size, 1);
	const rotated = await updateIndexNowSettings(f.ctx, (current) => ({ ...current.values, apiKey: "rotated-key-123" }));
	assert.equal(rotated.updated, true);
	const oldTask = [...f.scheduled.keys()][0];
	f.scheduled.delete(oldTask);
	const requestsBeforeCron = f.requests.length;
	const blocked = await deliverIndexNowQueue(f.ctx, await site(), { currentTask: oldTask });
	assert.equal(blocked.success, false);
	assert.equal(blocked.error, "indexnow_not_configured");
	assert.equal(f.requests.length, requestsBeforeCron);
	assert.equal(f.scheduled.size, 0);
	assert.equal([...f.jobs.values.values()][0].status, "pending");
	await setupIndexNow(f.ctx, rotated.updatedAt, site);
	assert.equal(f.scheduled.size, 1, "successful verification must reschedule pending work");
	const verifyFetch = f.ctx.http!.fetch;
	let submitted = 0;
	f.ctx.http!.fetch = async (url, init) => {
		if (init?.method !== "POST") return verifyFetch(url, init);
		submitted++;
		return new Response(null, { status: 202 });
	};
	const delivered = await deliverIndexNowQueue(f.ctx, await site(), { force: true });
	assert.equal(delivered.success, true);
	assert.equal(submitted, 1);
	assert.equal([...f.jobs.values.values()][0].status, "delivered");
});

test("failed background scheduling is visible and can be repaired by verification", async () => {
	const f = fixture();
	await setupIndexNow(f.ctx, null, site);
	const queued = await enqueueIndexNowUrls(f.ctx, await site(), [{ url: "/pending-schedule-repair", reason: "manual" }]);
	assert.equal(queued.success, true);
	const rotated = await updateIndexNowSettings(f.ctx, (current) => ({ ...current.values, apiKey: "rotated-for-repair" }));
	assert.equal(rotated.updated, true);
	f.scheduled.clear();
	const schedule = f.ctx.cron!.schedule;
	f.ctx.cron!.schedule = async () => { throw new Error("scheduler down"); };
	await assert.rejects(setupIndexNow(f.ctx, rotated.updatedAt, site), /pending URLs could not be scheduled/);
	const status = await buildAdminIndexNowStatus(f.ctx, await site());
	assert.equal(status.readiness.state, "unavailable");
	assert.equal(status.manualSubmissionReady, true);
	assert.equal(f.scheduled.size, 0);
	assert.equal([...f.jobs.values.values()][0].status, "pending");
	f.ctx.cron!.schedule = schedule;
	await setupIndexNow(f.ctx, status.updatedAt, site);
	assert.equal(f.scheduled.size, 1);
	assert.equal((await buildAdminIndexNowStatus(f.ctx, await site())).readiness.state, "ready");
});

test("a future drain cannot mask an earlier pending URL", async () => {
	const f = fixture();
	await setupIndexNow(f.ctx, null, site);
	const delayed = await enqueueIndexNowUrls(
		f.ctx, await site(), [{ url: "/later", reason: "manual" }], { delayMs: 600_000 },
	);
	assert.equal(delayed.success, true);
	const lateTask = [...f.scheduled.values()][0];
	assert.ok(Date.parse(lateTask.nextRunAt) > Date.now() + 500_000);
	const cancel = f.ctx.cron!.cancel;
	f.ctx.cron!.cancel = async () => { throw new Error("scheduler cancellation failed"); };
	const earlier = await enqueueIndexNowUrls(f.ctx, await site(), [{ url: "/now", reason: "manual" }]);
	assert.equal(earlier.success, true);
	const nowJob = [...f.jobs.values.values()].find((job) => job.url.endsWith("/now"));
	assert.ok(nowJob);
	nowJob.nextAttemptAt = null;
	assert.equal(f.scheduled.size, 1);
	const stalled = await buildAdminIndexNowStatus(f.ctx, await site());
	assert.equal(stalled.manualSubmissionReady, true);
	assert.equal(stalled.readiness.state, "unavailable");
	f.ctx.cron!.cancel = cancel;
	await setupIndexNow(f.ctx, stalled.updatedAt, site);
	assert.equal(f.scheduled.size, 1);
	assert.ok(Date.parse([...f.scheduled.values()][0].nextRunAt) < Date.parse(lateTask.nextRunAt));
	assert.equal((await buildAdminIndexNowStatus(f.ctx, await site())).readiness.state, "ready");
});
