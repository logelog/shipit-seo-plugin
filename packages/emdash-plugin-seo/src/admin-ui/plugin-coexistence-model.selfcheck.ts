import assert from "node:assert/strict";

import {
	COEXISTENCE_MAX_OBSERVATION_BYTES,
	COEXISTENCE_PROFILES,
	classifyNativePluginInventory,
	unavailableCoexistenceInventory,
	type CoexistenceStateRow,
} from "../plugin-coexistence.ts";
import {
	boundedPluginCoexistenceResponse,
	createPluginCoexistenceReader,
	parsePluginCoexistenceObservation,
	type PluginCoexistenceReadState,
} from "./plugin-coexistence-model.ts";

let groups = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
	await run();
	groups += 1;
	console.log("PASS " + name);
}
function registryRow(index = 0, changes: Partial<CoexistenceStateRow> = {}): CoexistenceStateRow {
	const profile = COEXISTENCE_PROFILES[index]!;
	return { id: profile.runtimeId, source: "registry", version: profile.assessedVersion, status: "active", publisherDid: profile.publisherDid, slug: profile.slug, ...changes };
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
	return { promise, resolve, reject };
}
const flush = () => Promise.resolve();
const clear = classifyNativePluginInventory({ configured: [], rows: [] });
const overlap = classifyNativePluginInventory({ configured: [], rows: [registryRow()] });

await check("real classifier results retain catalog scope and supported, future and inactive distinctions", () => {
	for (const inventory of [clear, overlap, unavailableCoexistenceInventory(),
		classifyNativePluginInventory({ configured: [], rows: COEXISTENCE_PROFILES.map((_, index) => registryRow(index)) }),
		classifyNativePluginInventory({ configured: [], rows: [registryRow(0, { version: "99" }), registryRow(3, { version: "99" })] }),
		classifyNativePluginInventory({ configured: [], rows: [registryRow(0, { status: "inactive" })] }),
		classifyNativePluginInventory({ configured: [{ id: "seo", entrypoint: "@moorage/plugin-seo/sandbox", version: "0.1.4" }, { id: "other", entrypoint: "unrelated", version: "1" }], rows: [] }),
	]) assert.deepEqual(parsePluginCoexistenceObservation(inventory), inventory);
	const unsupported = { status: "unsupported", scope: "checked-catalog", message: "Native inventory is not available on this host." };
	assert.deepEqual(parsePluginCoexistenceObservation(unsupported), unsupported);
});

await check("missing identities, duplicate peers and conflicting claims cannot appear clean", () => {
	assert.equal(overlap.status, "available");
	if (overlap.status !== "available") throw new Error("Expected available fixture");
	for (const invalid of [
		{ ...overlap, paused: [] },
		{ ...overlap, paused: ["robots", "robots", "schema"] },
		{ ...clear, paused: ["indexnow"] },
		{ ...overlap, peers: overlap.peers.slice(1) },
		{ ...overlap, peers: [...overlap.peers, overlap.peers[0]] },
		{ ...overlap, peers: overlap.peers.map((peer, index) => index === 0 ? { ...peer, surfaces: [] } : peer) },
		{ ...overlap, peers: overlap.peers.map((peer, index) => index === 0 ? { ...peer, assessment: "none" } : peer) },
		{ ...overlap, peers: overlap.peers.map((peer, index) => index === 0 ? { ...peer, profileId: "seo-suite" } : peer) },
		{ ...overlap, peers: overlap.peers.map((peer, index) => index === 0 ? { ...peer, name: "Different publisher" } : peer) },
		{ ...overlap, peers: overlap.peers.map((peer, index) => index === 0 ? { ...peer, versionAssessment: "unassessed" } : peer) },
		{ ...overlap, peers: overlap.peers.map((peer, index) => index === 0 ? { ...peer, state: "absent" } : peer) },
		{ ...clear, scope: "all-plugins" },
		{ ...clear, uncheckedConfiguredCount: -1 },
		{ ...clear, uncheckedConfiguredCount: 29 },
		{ ...clear, uncheckedConfiguredCount: 0.5 },
		{ ...unavailableCoexistenceInventory(), paused: [] },
		{ ...unavailableCoexistenceInventory(), peers: overlap.peers },
	]) assert.equal(parsePluginCoexistenceObservation(invalid), null);
});

await check("unverified configured identities and future inspection tools do not inherit ownership", () => {
	assert.equal(clear.status, "available");
	if (clear.status !== "available") throw new Error("Expected available fixture");
	const configured = classifyNativePluginInventory({ configured: [{ id: "seo", entrypoint: "@moorage/plugin-seo/sandbox", version: "0.1.4" }], rows: [] });
	assert.equal(configured.status, "available");
	if (configured.status !== "available") throw new Error("Expected configured fixture");
	assert.equal(parsePluginCoexistenceObservation({ ...configured, uncheckedConfiguredCount: 28 }), null);
	assert.equal(parsePluginCoexistenceObservation({ ...configured, peers: configured.peers.map((peer) => peer.id === "seo" ? { ...peer, profileId: "instant-indexer", name: "Instant Indexer" } : peer) }), null);
	const inspector = classifyNativePluginInventory({ configured: [], rows: [registryRow(3, { version: "99" })] });
	assert.equal(inspector.status, "available");
	if (inspector.status !== "available") throw new Error("Expected inspector fixture");
	assert.equal(inspector.peers[3]!.assessment, "unassessed");
	assert.deepEqual(parsePluginCoexistenceObservation(inspector), inspector);
	assert.equal(parsePluginCoexistenceObservation({ ...inspector, peers: inspector.peers.map((peer, index) => index === 3 ? { ...peer, assessment: "inspection-only" } : peer) }), null);
});

await check("malformed, oversized and unsafe messages remain unavailable to the view", () => {
	for (const input of [null, [], "available", { ...clear, extra: true },
		{ status: "unsupported", scope: "checked-catalog", message: "x".repeat(513) },
		{ status: "unsupported", scope: "checked-catalog", message: "x\u200b" },
		{ ...unavailableCoexistenceInventory(), reason: "x".repeat(COEXISTENCE_MAX_OBSERVATION_BYTES) },
	]) assert.equal(parsePluginCoexistenceObservation(input), null);
	const circular: Record<string, unknown> = {}; circular.self = circular;
	assert.equal(parsePluginCoexistenceObservation(circular), null);
});

await check("actual streamed response has an inclusive24KiB cap even without Content-Length", async () => {
	const controller = new AbortController();
	const exact = await boundedPluginCoexistenceResponse(new Response("x".repeat(COEXISTENCE_MAX_OBSERVATION_BYTES)), controller.signal);
	assert.equal((await exact.text()).length, COEXISTENCE_MAX_OBSERVATION_BYTES);
	let cancelled = 0;
	const chunks = [new Uint8Array(16384), new Uint8Array(8193)];
	const response = new Response(new ReadableStream({ pull(stream) { const next = chunks.shift(); if (next) stream.enqueue(next); else stream.close(); }, cancel() { cancelled += 1; } }));
	await assert.rejects(boundedPluginCoexistenceResponse(response, controller.signal), /supported size/);
	assert.equal(cancelled, 1);
	await assert.rejects(boundedPluginCoexistenceResponse(new Response("{}", { headers: { "content-length": "24577" } }), controller.signal), /supported size/);
	const denied = await boundedPluginCoexistenceResponse(new Response('{"error":{"message":"Denied"}}', { status: 403 }), controller.signal);
	assert.equal(denied.status, 403);
});

await check("stream abort cancels a stalled body before any parse succeeds", async () => {
	let cancelled = false;
	const controller = new AbortController();
	const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
	const reading = boundedPluginCoexistenceResponse(response, controller.signal);
	controller.abort(new DOMException("Closed", "AbortError"));
	await assert.rejects(reading, { name: "AbortError" });
	assert.equal(cancelled, true);
});

await check("overlapping reads abort and fence an older successful response", async () => {
	const requests: Array<{ pending: ReturnType<typeof deferred<unknown>>; signal: AbortSignal }> = [];
	const states: PluginCoexistenceReadState[] = [];
	const reader = createPluginCoexistenceReader({ read: (signal) => { const pending = deferred<unknown>(); requests.push({ pending, signal }); return pending.promise; }, onState: (state) => states.push(state) });
	const first = reader.load(); await flush();
	const second = reader.load(); await flush();
	assert.equal(requests.length, 2);
	assert.equal(requests[0]!.signal.aborted, true);
	requests[1]!.pending.resolve(clear); await second;
	requests[0]!.pending.resolve(overlap); await first;
	assert.deepEqual(states.at(-1), { status: "ready", inventory: clear });
	assert.equal(states.filter((state) => state.status === "ready").length, 1);
	reader.dispose();
});

await check("a failed current read clears an earlier result and makes no hidden retry", async () => {
	let calls = 0;
	const states: PluginCoexistenceReadState[] = [];
	const reader = createPluginCoexistenceReader({ read: async () => { calls += 1; if (calls === 1) return overlap; throw { status: 403 }; }, onState: (state) => states.push(state) });
	await reader.load();
	assert.deepEqual(states.at(-1), { status: "ready", inventory: overlap });
	await reader.load();
	assert.equal(calls, 2);
	assert.deepEqual(states.at(-2), { status: "loading" });
	assert.deepEqual(states.at(-1), { status: "error", kind: "denied", message: "You need permission to read plugin status." });
	assert.equal("inventory" in states.at(-1)!, false);
	await flush(); assert.equal(calls, 2);
	reader.dispose();
});

await check("deadline settles even if the transport ignores its AbortSignal", async () => {
	const pending = deferred<unknown>();
	const states: PluginCoexistenceReadState[] = [];
	const request: { signal: AbortSignal | null } = { signal: null };
	const reader = createPluginCoexistenceReader({ timeoutMs: 2, read: async (value) => { request.signal = value; return pending.promise; }, onState: (state) => states.push(state) });
	await reader.load();
	assert.ok(request.signal);
	assert.equal(request.signal.aborted, true);
	assert.equal(states.at(-1)?.status, "error");
	assert.equal((states.at(-1) as { kind: string }).kind, "timeout");
	const before = states.length;
	pending.resolve(clear); await flush(); await flush();
	assert.equal(states.length, before);
	reader.dispose();
});

await check("unmount aborts and invalidates responses without poisoning a fresh view owner", async () => {
	const pending = deferred<unknown>();
	const states: PluginCoexistenceReadState[] = [];
	const request: { signal: AbortSignal | null } = { signal: null };
	const reader = createPluginCoexistenceReader({ read: async (value) => { request.signal = value; return pending.promise; }, onState: (state) => states.push(state) });
	const old = reader.load(); await flush();
	reader.dispose();
	assert.ok(request.signal);
	assert.equal(request.signal.aborted, true);
	const count = states.length;
	const fresh = createPluginCoexistenceReader({ read: async () => clear, onState: (state) => states.push(state) });
	await fresh.load();
	pending.resolve(overlap); await old;
	assert.equal(states.length, count + 2);
	assert.deepEqual(states.at(-1), { status: "ready", inventory: clear });
	await reader.load(); assert.equal(states.length, count + 2);
	fresh.dispose();
});

await check("a malformed successful HTTP payload cannot restore a prior checked result", async () => {
	const states: PluginCoexistenceReadState[] = [];
	let calls = 0;
	const reader = createPluginCoexistenceReader({ read: async () => ++calls === 1 ? clear : { ...overlap, paused: [] }, onState: (state) => states.push(state) });
	await reader.load(); await reader.load();
	assert.equal(states.at(-1)?.status, "error");
	assert.equal((states.at(-1) as { kind: string }).kind, "unavailable");
	assert.equal("inventory" in states.at(-1)!, false);
	reader.dispose();
});

console.log("Plugin coexistence UI model checks passed (" + groups + " groups).");
