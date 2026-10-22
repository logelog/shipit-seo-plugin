import assert from "node:assert/strict";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_REDIRECT_EDIT_LIMITS,
	type RedirectRule,
} from "../admin-contract.ts";
import {
	createRedirectEditApi,
	parseRedirectEditLoad,
	parseRedirectEditUpdate,
	prepareRedirectEditSubmission,
	type RedirectEditApiClient,
} from "./redirect-edit-api.ts";

const saved: RedirectRule = {
	id: "saved-redirect", source: "/old", destination: "/target", type: 301,
	enabled: true, isPattern: false, groupName: "Imported", auto: true,
	hits: 7, lastHitAt: "2026-10-04T10:00:00Z", createdAt: "2026-10-03T10:00:00Z", updatedAt: "2026-10-04T10:00:00Z",
};
const wrap = <T extends object>(value: T) => ({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, ...value });
const submission = prepareRedirectEditSubmission(saved, "revision-1", { source: "/old", destination: "/new", type: 302, enabled: false })!;
assert.ok(submission);
assert.ok(Object.isFrozen(submission.snapshot.baseline) && Object.isFrozen(submission.request));
const updated = wrap({ status: "updated", rule: { ...saved, destination: "/new", type: 302, enabled: false, hits: 11 }, revision: "revision-2", confirmedBy: "host" });
const recovery = { ...updated, confirmedBy: "recovery" };
const load = wrap({ status: "loaded", rule: saved, revision: "revision-1", update: "available" });

assert.equal(parseRedirectEditLoad(load, saved.id).status, "loaded");
assert.equal(parseRedirectEditLoad({ ...load, rule: { ...saved, enabled: false } }, saved.id).status, "loaded", "disabled rules are editable");
assert.deepEqual(parseRedirectEditLoad(load, "other-id"), { status: "unusable", reason: "identity" });
assert.equal(parseRedirectEditLoad({ ...load, extra: true }, saved.id).status, "unusable");
assert.deepEqual(parseRedirectEditLoad({ ...load, contractVersion: SEO_ADMIN_CONTRACT_VERSION - 1 }, saved.id), { status: "unusable", reason: "version" });
for (const change of [
	{ id: "x".repeat(129) }, { source: "/".repeat(2049) }, { groupName: "x".repeat(201) },
	{ createdAt: "x".repeat(129) }, { hits: Number.MAX_SAFE_INTEGER + 1 }, { type: 200 }, { ignored: true },
]) assert.equal(parseRedirectEditLoad({ ...load, rule: { ...saved, ...change } }, saved.id).status, "unusable");
for (const update of ["available", "no-permission", "read-only"]) {
	assert.equal(parseRedirectEditLoad({ ...load, update }, saved.id).status, "loaded");
}
for (const reason of ["pattern", "type"] as const) {
	const rule = { ...saved, ...(reason === "pattern" ? { isPattern: true } : { type: 308 }) };
	assert.equal(parseRedirectEditLoad(wrap({ status: "unsupported", reason, rule, message: "Manage in EmDash." }), saved.id).status, "unsupported");
}
assert.equal(parseRedirectEditLoad(wrap({ status: "unsupported", reason: "envelope", rule: null, message: "Manage in EmDash." }), saved.id).status, "unsupported");
assert.equal(parseRedirectEditLoad(wrap({ status: "unsupported", reason: "pattern", rule: saved, message: "Manage in EmDash." }), saved.id).status, "unusable");

assert.equal(parseRedirectEditUpdate(updated, submission).status, "updated");
assert.equal(parseRedirectEditUpdate(recovery, submission, true).status, "updated");
assert.equal(parseRedirectEditUpdate(updated, submission, true).status, "unusable", "recovery cannot report host confirmation");
assert.equal(parseRedirectEditUpdate({ ...updated, revision: "revision-1" }, submission).status, "unusable");
assert.deepEqual(parseRedirectEditUpdate({ ...updated, rule: { ...updated.rule, id: "other-id" } }, submission), { status: "unusable", reason: "identity" });
for (const change of [{ groupName: "Other" }, { auto: false }, { isPattern: true }, { type: 301 }, { enabled: true }]) {
	assert.equal(parseRedirectEditUpdate({ ...updated, rule: { ...updated.rule, ...change } }, submission).status, "unusable");
}
const unchanged = wrap({ status: "unchanged", rule: saved, revision: "revision-1" });
assert.equal(parseRedirectEditUpdate(unchanged, submission).status, "unusable", "unchanged cannot discard a requested type or enabled change");
const noOp = prepareRedirectEditSubmission(saved, "revision-1", { source: saved.source, destination: saved.destination, type: 301, enabled: true })!;
assert.equal(parseRedirectEditUpdate(unchanged, noOp).status, "unchanged");
assert.equal(parseRedirectEditUpdate({ ...unchanged, revision: "another-revision" }, noOp).status, "unusable");
assert.equal(parseRedirectEditUpdate({ ...unchanged, revision: "another-revision" }, noOp, true).status, "unchanged");
assert.equal(parseRedirectEditUpdate({ ...updated, rule: { ...updated.rule, source: "/other" } }, submission).status, "unusable", "an untouched source stays unchanged");
const disable = prepareRedirectEditSubmission(saved, "revision-1", { source: saved.source, destination: saved.destination, type: 301, enabled: false })!;
assert.equal(parseRedirectEditUpdate({ ...updated, rule: { ...saved, destination: "/other", enabled: false } }, disable).status, "unusable", "disable-only preserves the destination");

const outcomes = [
	{ status: "invalid", reason: "input", message: "Invalid request." },
	{ status: "invalid", reason: "fields", errors: { source: { code: "stored-path", message: "Retype this source." } } },
	{ status: "conflict", reason: "duplicate", message: "Another source exists.", existing: { ...saved, id: "another" } },
	{ status: "stale", reason: "revision", message: "Review the change.", current: saved },
	{ status: "stale", reason: "changed", message: "Review the change.", current: null },
	{ status: "missing", message: "The redirect is missing." },
	{ status: "unsupported", reason: "envelope", rule: null, message: "Manage in EmDash." },
	{ status: "refused", reason: "precondition", message: "Reload first." },
	{ status: "busy", message: "Another update is running.", retryable: true },
	{ status: "not-saved", reason: "write-failed", message: "Try again.", retryable: true },
	{ status: "uncertain", reason: "pending", message: "Check the saved redirect." },
	{ status: "unavailable", reason: "read-only", message: "Use EmDash." },
];
for (const outcome of outcomes) {
	assert.equal(parseRedirectEditUpdate(wrap(outcome), submission).status, outcome.status, outcome.status);
	assert.equal(parseRedirectEditUpdate(wrap({ ...outcome, extra: true }), submission).status, "unusable");
}
for (const status of ["conflict", "unsupported", "refused", "busy", "not-saved"]) {
	const outcome = outcomes.find((item) => item.status === status)!;
	assert.equal(parseRedirectEditUpdate(wrap(outcome), submission, true).status, "unusable", `recovery rejects ${status}`);
}
assert.equal(parseRedirectEditUpdate(wrap({ status: "invalid", reason: "fields", errors: { type: { code: "type", message: "Invalid type." } } }), submission).status, "unusable");
assert.equal(parseRedirectEditUpdate(wrap({ status: "busy", message: "Try again.", retryable: false }), submission).status, "unusable");
assert.equal(parseRedirectEditUpdate(wrap({ status: "stale", reason: "changed", message: "Review.", current: { ...saved, id: "another" } }), submission).status, "unusable");
assert.deepEqual(parseRedirectEditUpdate(wrap({ status: "unusable", reason: "invented" }), submission), { status: "unusable", reason: "malformed" });

const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
let answer: unknown = updated;
let parseCalls = 0;
let responseFactory: (() => Response) | null = null;
const client: RedirectEditApiClient = {
	async apiFetch(input, init) {
		calls.push({ input, init });
		return responseFactory ? responseFactory() : Response.json({ success: true, data: answer });
	},
	async parseApiResponse<T>(response: Response) {
		parseCalls++;
		const payload = await response.json();
		return payload.data as T;
	},
};
let release!: (value: RedirectEditApiClient) => void;
const api = createRedirectEditApi(() => new Promise((resolve) => { release = resolve; }));
const mutable = JSON.parse(JSON.stringify(submission));
const controller = new AbortController();
const pending = api.update(mutable, controller.signal);
mutable.request.id = "switched-record";
mutable.snapshot.id = "switched-record";
mutable.request.destination = "/wrong";
release(client);
assert.equal((await pending).status, "updated");
assert.deepEqual(JSON.parse(calls[0].init!.body as string), submission.request, "call-time identity and draft survive caller mutation");
assert.equal(calls[0].init!.signal, controller.signal);
assert.equal(calls[0].init!.headers && (calls[0].init!.headers as Record<string, string>)["Content-Type"], "application/json");
assert.match(calls[0].input, /\/update-admin-redirect-rule$/);
assert.equal(calls.length, 1);

const immediate = createRedirectEditApi(async () => client);
answer = recovery;
assert.equal((await immediate.reconcile(submission)).status, "updated");
assert.deepEqual(JSON.parse(calls[1].init!.body as string), submission.snapshot);
assert.match(calls[1].input, /\/reconcile-admin-redirect-rule-update$/);
answer = load;
assert.equal((await immediate.load(saved.id)).status, "loaded");
const beforeInvalid = calls.length;
assert.equal((await immediate.load("x".repeat(129))).status, "unusable");
assert.equal((await immediate.update({ ...submission, snapshot: { ...submission.snapshot, id: "wrong" } })).status, "unusable");
assert.equal(calls.length, beforeInvalid, "invalid requests never load or contact the client");

const large = prepareRedirectEditSubmission(
	{ ...saved, source: "\u0001".repeat(2048), destination: "\u0001".repeat(2048), groupName: "\u0001".repeat(200) },
	"\u0001".repeat(1024),
	{ source: "\u0001".repeat(4096), destination: "\u0001".repeat(4096), type: 302, enabled: false },
)!;
assert.ok(large, "maximum structural character envelopes remain transportable before domain validation");
assert.ok(Buffer.byteLength(JSON.stringify(large.snapshot)) > 65_536);
assert.ok(Buffer.byteLength(JSON.stringify(large.snapshot)) < SEO_ADMIN_REDIRECT_EDIT_LIMITS.recoveryRequestBytes);

for (const declared of [false, true]) {
	let cancelled = false;
	responseFactory = () => new Response(new ReadableStream({
		start(stream) { stream.enqueue(new Uint8Array(SEO_ADMIN_REDIRECT_EDIT_LIMITS.wireResponseBytes + 1)); },
		cancel() { cancelled = true; },
	}), { headers: declared ? { "content-length": String(SEO_ADMIN_REDIRECT_EDIT_LIMITS.wireResponseBytes + 1) } : {} });
	const before = parseCalls;
	assert.deepEqual(await immediate.update(submission), { status: "unusable", reason: "oversized" });
	assert.equal(parseCalls, before, "oversized wire bytes never enter the published JSON parser");
	assert.equal(cancelled, true);
}
responseFactory = null;
const denied = new Error("Published client permission refusal");
let errorFetches = 0;
const deniedApi = createRedirectEditApi(async () => ({
	async apiFetch() { errorFetches++; return Response.json({ success: false }, { status: 403 }); },
	async parseApiResponse(response) { assert.equal(response.status, 403); throw denied; },
}));
await assert.rejects(deniedApi.update(submission), (error: unknown) => error === denied);
assert.equal(errorFetches, 1, "HTTP refusal is not retried");
const abort = new DOMException("Cancelled", "AbortError");
const abortedApi = createRedirectEditApi(async () => ({ ...client, async apiFetch() { throw abort; } }));
await assert.rejects(abortedApi.update(submission), (error: unknown) => error === abort);

console.log("Redirect edit API identity, strict wire and bounded transport self-check passed.");
