import assert from "node:assert/strict";
import {
	INDEXNOW_DELIVERY_TIMEOUT_MS,
	IndexNowDeliveryTimeoutError,
	requestIndexNowDelivery,
} from "./indexnow-delivery.ts";
import { INDEXNOW_ENDPOINT } from "./indexnow.ts";

const payload = { host: "example.com", key: "DeadlineFixturePublicKey", urlList: ["https://example.com/deadline"] };
const originalTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const tick = () => new Promise<void>((resolve) => originalTimeout(resolve, 0));
const context = (fetch: (url: string, init: RequestInit) => Promise<Response>) => ({ http: { fetch } }) as any;
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
async function settles<T>(promise: Promise<T>): Promise<T> {
	let timer!: ReturnType<typeof setTimeout>;
	try {
		return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
			timer = originalTimeout(() => reject(new Error("Delivery did not settle after cancellation.")), 250);
		})]);
	} finally { originalClearTimeout(timer); }
}
async function withDeadline(run: (clock: { fire(): void; active(): number }) => Promise<void>) {
	const timers = new Map<object, () => void>();
	globalThis.setTimeout = ((callback: () => void, milliseconds?: number, ...args: unknown[]) => {
		if (milliseconds !== 10_000) return originalTimeout(callback, milliseconds, ...args);
		const timer = {};
		timers.set(timer, callback);
		return timer;
	}) as unknown as typeof setTimeout;
	globalThis.clearTimeout = ((timer: unknown) => {
		if (!timers.delete(timer as object)) originalClearTimeout(timer as ReturnType<typeof setTimeout>);
	}) as typeof clearTimeout;
	try {
		await run({
			fire: () => { assert.equal(timers.size, 1); [...timers.values()][0](); },
			active: () => timers.size,
		});
		assert.equal(timers.size, 0, "every settled delivery clears its deadline");
	} finally {
		globalThis.setTimeout = originalTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	}
}
assert.equal(INDEXNOW_DELIVERY_TIMEOUT_MS, 10_000);

// Status and headers suffice; hanging body cancellation must not delay success.
await withDeadline(async (clock) => {
	const lease = new AbortController();
	const observed: { signal: AbortSignal | undefined } = { signal: undefined };
	let cancelled = 0;
	const response = await settles(requestIndexNowDelivery(context(async (url, init) => {
		assert.equal(url, INDEXNOW_ENDPOINT);
		assert.equal(init.method, "POST");
		assert.deepEqual(JSON.parse(String(init.body)), payload);
		observed.signal = init.signal ?? undefined;
		return new Response(new ReadableStream({ cancel() { cancelled += 1; return new Promise(() => {}); } }), { status: 202 });
	}), payload, lease.signal));
	assert.equal(response.status, 202);
	assert.equal(cancelled, 1);
	assert.equal(clock.active(), 0);
	lease.abort();
	assert.equal(observed.signal?.aborted, false, "finished requests detach the lease listener");
});

await withDeadline(async () => {
	const failure = new Error("Controlled provider rejection");
	await assert.rejects(() => requestIndexNowDelivery(context(async () => { throw failure; }), payload), (error) => error === failure);
});

await withDeadline(async () => {
	const lease = new AbortController();
	lease.abort();
	let calls = 0;
	await assert.rejects(() => requestIndexNowDelivery(context(async () => { calls += 1; return new Response(); }), payload, lease.signal),
		(error: any) => error?.name === "AbortError");
	assert.equal(calls, 0, "lost ownership before dispatch never calls transport");
});

for (const late of ["success", "rejection"] as const) await withDeadline(async (clock) => {
	const transport = deferred<Response>();
	const observed: { signal: AbortSignal | undefined } = { signal: undefined };
	const request = requestIndexNowDelivery(context(async (_url, init) => {
		observed.signal = init.signal ?? undefined;
		return transport.promise;
	}), payload);
	const outcome = request.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
	clock.fire();
	const result = await settles(outcome);
	assert.ok(result.error instanceof IndexNowDeliveryTimeoutError);
	assert.match(result.error.message, /timed out|timeout/i);
	assert.match(result.error.message, /accept|confirm|unknown/i);
	assert.equal(result.error.message.includes(payload.key), false);
	assert.equal(observed.signal?.aborted, true);
	assert.equal(clock.active(), 0);
	if (late === "success") {
		let cancelled = 0;
		transport.resolve(new Response(new ReadableStream({ cancel() { cancelled += 1; throw new Error("Controlled cancellation rejection"); } }), { status: 200 }));
		await tick();
		assert.equal(cancelled, 1, "late success is discarded even if its body cancellation rejects");
	} else {
		transport.reject(new Error("Controlled late provider rejection"));
		await tick();
	}
});

await withDeadline(async (clock) => {
	const lease = new AbortController();
	const transport = deferred<Response>();
	const observed: { signal: AbortSignal | undefined } = { signal: undefined };
	const request = requestIndexNowDelivery(context(async (_url, init) => {
		observed.signal = init.signal ?? undefined;
		return transport.promise;
	}), payload, lease.signal);
	const outcome = request.then((value) => ({ value, error: null }), (error: any) => ({ value: null, error }));
	lease.abort(new Error("Controlled lease loss"));
	const result = await settles(outcome);
	assert.equal(result.error?.name, "AbortError");
	assert.equal(observed.signal?.aborted, true);
	assert.equal(clock.active(), 0);
	let cancelled = 0;
	transport.resolve(new Response(new ReadableStream({ cancel() { cancelled += 1; return new Promise(() => {}); } }), { status: 202 }));
	await tick();
	assert.equal(cancelled, 1, "lease loss discards late success without waiting for body cancellation");
});

console.log("IndexNow delivery deadline self-check passed.");
