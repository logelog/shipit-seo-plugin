import assert from "node:assert/strict";

import type { PublisherOwnershipView } from "../publisher-ownership.ts";
import {
	INITIAL_OWNERSHIP_STATE,
	createOwnershipStore,
	ownershipGateText,
	ownershipLocked,
	ownershipNextMode,
	ownershipReducer,
	ownershipStatusText,
	type OwnershipEvent,
	type OwnershipState,
} from "./publisher-ownership-model.ts";

function view(effective: "automatic" | "none" | "unknown", revision: string | null, overrides: Partial<PublisherOwnershipView> = {}): PublisherOwnershipView {
	const state = effective === "unknown" ? "corrupt" : revision === null ? "absent" : "valid";
	return {
		storageVersion: 1,
		state,
		mode: state === "valid" ? (effective as "automatic" | "none") : null,
		effective,
		revision,
		writable: effective !== "unknown",
		gates: { schemaModule: true, sitePublisherPreset: true },
		message: null,
		...overrides,
	};
}
const run = (state: OwnershipState, ...events: OwnershipEvent[]) => events.reduce(ownershipReducer, state);
const loaded = run(INITIAL_OWNERSHIP_STATE, { type: "read-start", request: 1, explicit: false }, { type: "read-result", request: 1, view: view("automatic", null) });

// ---- Gating the one command ----
assert.equal(ownershipNextMode(INITIAL_OWNERSHIP_STATE), null, "nothing before the first read");
assert.equal(ownershipNextMode(loaded), "none");
assert.equal(ownershipNextMode(run(loaded, { type: "read-start", request: 2, explicit: false })), null, "not while a read is in flight");
assert.equal(ownershipNextMode(run(INITIAL_OWNERSHIP_STATE, { type: "read-start", request: 1, explicit: false }, { type: "read-result", request: 1, view: view("unknown", "r1") })), null, "unknown ownership is read-only");
assert.equal(ownershipNextMode(run(INITIAL_OWNERSHIP_STATE, { type: "read-start", request: 1, explicit: false }, { type: "read-result", request: 1, view: view("none", "r1", { writable: false }) })), null);
const failedRefresh = run(loaded, { type: "read-start", request: 2, explicit: false }, { type: "read-failed", request: 2, message: "offline", denied: false });
assert.equal(failedRefresh.loadError, "offline");
assert.equal(ownershipNextMode(failedRefresh), null, "no change from a setting that could not be refreshed");
const pending = run(loaded, { type: "write-start", request: 2, mode: "none", expectedRevision: null });
assert.equal(ownershipNextMode(pending), null, "one click sends one command");
assert.equal(run(pending, { type: "write-start", request: 3, mode: "none", expectedRevision: null }).pending?.request, 2, "a second start is ignored");

// ---- A read that overlaps a write never settles it ----
{
	// Started before the write.
	let state = run(loaded, { type: "read-start", request: 2, explicit: false }, { type: "write-start", request: 3, mode: "none", expectedRevision: null });
	assert.equal(state.reading, null, "a write invalidates the read in flight");
	state = run(state, { type: "write-result", request: 3, result: { success: true, changed: true, ownership: view("none", "r1") } });
	assert.equal(run(state, { type: "read-result", request: 2, view: view("automatic", null) }).view?.effective, "none", "an older read cannot replace the saved mode");
	// Started during the write, resolving after the confirmed success.
	state = run(loaded, { type: "write-start", request: 2, mode: "none", expectedRevision: null }, { type: "read-start", request: 3, explicit: false });
	assert.equal(state.reading?.request, 3);
	state = run(state, { type: "write-result", request: 2, result: { success: true, changed: true, ownership: view("none", "r1") } });
	assert.equal(state.reading, null, "settlement invalidates a read started during the write");
	const lateSuccess = run(state, { type: "read-result", request: 3, view: view("automatic", null) });
	assert.equal(lateSuccess.view?.effective, "none", "a late read success cannot restore the old mode");
	assert.equal(lateSuccess.view?.revision, "r1");
	const lateError = run(state, { type: "read-failed", request: 3, message: "late failure", denied: false });
	assert.equal(lateError.loadError, null, "a late read error does not mark the confirmed result as stale");
	// A read started after settlement applies.
	const fresh = run(state, { type: "read-start", request: 5, explicit: false }, { type: "read-result", request: 5, view: view("none", "r2") });
	assert.equal(fresh.view?.revision, "r2");
	// A result arriving while the write is still pending is ignored too.
	const whilePending = run(loaded, { type: "write-start", request: 2, mode: "none", expectedRevision: null }, { type: "read-start", request: 3, explicit: false }, { type: "read-result", request: 3, view: view("none", "rX") });
	assert.equal(whilePending.view?.revision, null, "no read result is applied while the write is pending");
}

// ---- Unknown outcomes: captured revision, explicit post-settlement reload only ----
{
	const base = run(INITIAL_OWNERSHIP_STATE, { type: "read-start", request: 1, explicit: false }, { type: "read-result", request: 1, view: view("none", "r5") });
	let state = run(base, { type: "write-start", request: 2, mode: "automatic", expectedRevision: "r5" });
	state = run(state, { type: "write-failed", request: 2, failure: "unknown", message: "timeout" });
	assert.ok(state.notice?.kind === "unconfirmed" && state.notice.expectedRevision === "r5" && state.notice.intended === "automatic", "the command's own revision is kept");
	assert.equal(ownershipLocked(state), true);
	assert.match(state.notice?.message ?? "", /may or may not have been stored/);
	const structured = run(base, { type: "write-start", request: 2, mode: "automatic", expectedRevision: "r5" }, {
		type: "write-result", request: 2,
		result: { success: false, error: "unconfirmed", message: "x", intended: "automatic" },
	});
	assert.ok(structured.notice?.kind === "unconfirmed" && structured.notice.expectedRevision === "r5", "the structured path uses the same captured revision");
	// Even if the shown setting moved on, the recovery compares against the command's own revision.
	const moved = { ...run(base, { type: "write-start", request: 2, mode: "automatic", expectedRevision: "r5" }), view: view("none", "r-other") };
	const movedFailed = run(moved, { type: "write-failed", request: 2, failure: "unknown", message: "timeout" });
	assert.ok(movedFailed.notice?.kind === "unconfirmed" && movedFailed.notice.expectedRevision === "r5", "the transport failure path keeps the captured revision");
	const movedStructured = run(moved, { type: "write-result", request: 2, result: { success: false, error: "unconfirmed", message: "x", intended: "automatic" } });
	assert.ok(movedStructured.notice?.kind === "unconfirmed" && movedStructured.notice.expectedRevision === "r5", "the structured path keeps the captured revision");
	const background = run(state, { type: "read-start", request: 4, explicit: false }, { type: "read-result", request: 4, view: view("automatic", "r6"), check: "matches_requested" });
	assert.equal(ownershipLocked(background), true, "a background read does not settle the outcome");
	assert.equal(background.view?.revision, "r6", "but shows the current setting");
	const explicit = run(state, { type: "read-start", request: 4, explicit: true }, { type: "read-result", request: 4, view: view("automatic", "r6"), check: "matches_requested" });
	assert.equal(ownershipLocked(explicit), false);
	assert.match(explicit.notice?.message ?? "", /now matches your request/);
	const same = run(state, { type: "read-start", request: 4, explicit: true }, { type: "read-result", request: 4, view: view("none", "r5"), check: "matches_loaded" });
	assert.match(same.notice?.message ?? "", /still the version you loaded/);
	assert.doesNotMatch(same.notice?.message ?? "", /Nothing was changed/, "recovery describes the current state only");
	const before = run(base, { type: "read-start", request: 2, explicit: true }, { type: "write-start", request: 3, mode: "automatic", expectedRevision: "r5" }, {
		type: "write-failed", request: 3, failure: "unknown", message: "timeout",
	}, { type: "read-result", request: 2, view: view("automatic", "r6"), check: "matches_requested" });
	assert.equal(ownershipLocked(before), true, "an explicit read started before settlement cannot resolve it");
	const uncertain = run(base, { type: "write-start", request: 2, mode: "automatic", expectedRevision: "r5" }, {
		type: "write-result", request: 2, result: { success: false, error: "storage_uncertain", message: "refused", ownership: view("none", "r5") },
	});
	assert.equal(ownershipLocked(uncertain), true);
	assert.equal(ownershipLocked(run(uncertain, { type: "read-start", request: 4, explicit: false }, { type: "read-result", request: 4, view: view("none", "r5") })), true);
	assert.equal(ownershipLocked(run(uncertain, { type: "read-start", request: 4, explicit: true }, { type: "read-result", request: 4, view: view("none", "r5") })), false);
	assert.equal(run(uncertain, { type: "dismiss" }), uncertain, "an unsettled notice cannot be dismissed");
}

// ---- Other results ----
{
	const conflict = run(loaded, { type: "write-start", request: 2, mode: "none", expectedRevision: null }, {
		type: "write-result", request: 2, result: { success: false, error: "conflict", message: "changed", ownership: view("none", "r9") },
	});
	assert.ok(conflict.notice?.kind === "conflict" && conflict.notice.requested === "none");
	assert.equal(conflict.view?.revision, "r9", "the current setting is shown with the conflict");
	assert.equal(ownershipNextMode(conflict), "automatic", "the next command starts from the current setting");
	const preflight = run(INITIAL_OWNERSHIP_STATE, { type: "read-start", request: 1, explicit: false }, { type: "read-result", request: 1, view: view("none", "r1") }, { type: "write-start", request: 2, mode: "automatic", expectedRevision: "r1" }, {
		type: "write-result", request: 2,
		result: { success: false, error: "preflight", message: "defines", ownership: view("none", "r1"), preflight: { status: "refused", reason: "collision", source: "legacy", entityId: "https://x/#organization", checked: 1, definitions: [{ id: "a", name: "A", scope: "global", ownedIds: ["https://x/#organization"] }], more: 0, message: "defines" } },
	});
	assert.ok(preflight.notice?.kind === "preflight" && preflight.notice.preflight.definitions.length === 1);
	assert.equal(preflight.view?.effective, "none", "a refused return keeps showing the opt-out");
	const denied = run(loaded, { type: "write-start", request: 2, mode: "none", expectedRevision: null }, { type: "write-failed", request: 2, failure: "denied", message: "403" });
	assert.equal(denied.notice?.kind, "denied");
	assert.equal(ownershipLocked(denied), false);
	const unchanged = run(loaded, { type: "write-start", request: 2, mode: "none", expectedRevision: null }, { type: "write-result", request: 2, result: { success: true, changed: false, ownership: view("none", "r1") } });
	assert.match(unchanged.notice?.message ?? "", /already off/);
}

// ---- Store and text ----
{
	const store = createOwnershipStore();
	let calls = 0;
	store.subscribe(() => { calls += 1; });
	assert.equal(store.nextRequest(), 1);
	assert.equal(store.nextRequest(), 2);
	store.dispatch({ type: "read-result", request: 9, view: view("none", "r1") });
	assert.equal(calls, 0, "an unknown read result changes nothing");
	store.dispatch({ type: "read-start", request: 3, explicit: false });
	assert.equal(calls, 1);
	assert.match(ownershipStatusText(view("automatic", null)), /default, not saved/);
	assert.match(ownershipStatusText(view("none", "r1")), /^Off/);
	assert.match(ownershipStatusText(view("unknown", "r1")), /Ownership unknown/);
	assert.match(ownershipGateText(view("automatic", "r1", { gates: null })) ?? "", /could not be read/, "a failed switch read remains an explicit warning even when publisher ownership is known");
	assert.match(ownershipGateText(view("automatic", "r1", { gates: { schemaModule: false, sitePublisherPreset: true } })) ?? "", /including custom schema/);
	assert.match(ownershipGateText(view("automatic", "r1", { gates: { schemaModule: true, sitePublisherPreset: false } })) ?? "", /inline/);
	assert.equal(ownershipGateText(view("none", "r1", { gates: { schemaModule: true, sitePublisherPreset: false } })), null, "while off the preset says nothing about output");
}

console.log("publisher ownership model selfcheck passed");
