import assert from "node:assert/strict";

import {
	CORE_SEO_MIGRATION_VERSION,
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminMigrationPlanResponse,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	LEGACY_BACKUP_UNAVAILABLE_MESSAGES,
	acknowledgeLegacyBackup,
	beginLegacyDiscard,
	legacyDiscardBusy,
	legacyDiscardSubject,
	settleLegacyDiscard,
	initialLegacyDiscardState,
	legacyBackupFilename,
	legacyDiscardEligibility,
	legacyDiscardGuard,
	markLegacyBackupDownloaded,
	receiveLegacyBackup,
	resetLegacyDiscard,
	startLegacyBackup,
	type LegacyDiscardState,
	type LegacyDiscardTarget,
} from "./legacy-discard-model.ts";

const fingerprint = `sha256-${"a".repeat(64)}`;
const target: LegacyDiscardTarget = { sourceOverrideId: "posts:post-1", fingerprint, conflictPolicy: "skip" };
const generatedAt = "2026-10-03T19:00:00.000Z";

function exportDocument(change: (document: any) => void = () => undefined): string {
	const document: any = {
		format: "shipit-seo-legacy-record-export",
		formatVersion: 1,
		generatedAt,
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		sourceOverrideId: "posts:post-1",
		reference: "posts:post-1",
		entry: { ref: "posts:post-1", collection: "posts", entryId: "post-1", locale: "fr" },
		conflictPolicy: "skip",
		fingerprint,
		record: { ref: "posts:post-1", title: "Legacy title", robots: "noindex,noarchive", notes: "kept" },
	};
	change(document);
	return JSON.stringify(document);
}

function plan(options: {
	document?: string;
	snapshot?: unknown;
	fingerprint?: string;
	sourceOverrideId?: string;
	discardAvailable?: boolean;
	items?: number;
} = {}): SeoAdminMigrationPlanResponse {
	const document = options.document ?? exportDocument();
	const item = {
		sourceOverrideId: options.sourceOverrideId ?? "posts:post-1",
		fingerprint: options.fingerprint ?? fingerprint,
		ref: "posts:post-1",
		collection: "posts",
		entryId: "post-1",
		state: "conflict",
		detail: "Resolve title.",
		snapshot: options.snapshot ?? { status: "available", bytes: new TextEncoder().encode(document).byteLength, document },
	};
	return {
		success: true,
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt,
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		writeAvailable: false,
		discardAvailable: options.discardAvailable ?? true,
		summary: { total: 1, ready: 0, conflicts: 1, empty: 0, unresolved: 0 },
		items: Array.from({ length: options.items ?? 1 }, () => item),
		hasMore: false,
	} as unknown as SeoAdminMigrationPlanResponse;
}

function ready(): Extract<LegacyDiscardState, { status: "ready" }> {
	const preparing = startLegacyBackup(initialLegacyDiscardState(), target);
	const state = receiveLegacyBackup(preparing, preparing.generation, { plan: plan() });
	assert.equal(state.status, "ready");
	return state as Extract<LegacyDiscardState, { status: "ready" }>;
}

// ---- Eligibility: only exact-ID records on a host with conditional deletion ----
assert.deepEqual(legacyDiscardEligibility({ sourceOverrideId: "posts:post-1", collection: "posts", entryId: "post-1" }, true), { eligible: true });
assert.deepEqual(legacyDiscardEligibility({ sourceOverrideId: "posts:post-1", collection: "posts", entryId: "post-1" }, false), { eligible: false, reason: "host" });
assert.deepEqual(legacyDiscardEligibility({ sourceOverrideId: "posts:a-useful-post", collection: "posts", entryId: "post-1" }, true), { eligible: false, reason: "alias" });
assert.deepEqual(legacyDiscardEligibility({ sourceOverrideId: "posts:a-useful-post", collection: "posts" }, true), { eligible: false, reason: "no-entry" });

// ---- The binding comes from the delivered document, unchanged ----
const prepared = ready();
assert.equal(prepared.document, exportDocument(), "the download is the delivered document, byte for byte");
assert.deepEqual(prepared.binding, {
	...target, ref: "posts:post-1", reference: "posts:post-1", collection: "posts", entryId: "post-1", locale: "fr", generation: prepared.generation,
});
assert.equal(prepared.acknowledged, false);
assert.equal(legacyDiscardGuard(prepared, target, prepared.generation), null, "a prepared backup is not an acknowledgement");
const unlocalised = receiveLegacyBackup(startLegacyBackup(initialLegacyDiscardState(), target), 1, {
	plan: plan({ document: exportDocument((document) => { document.entry.locale = null; }) }),
});
assert.equal(unlocalised.status === "ready" && unlocalised.binding.locale, null, "a missing actual locale stays null");

// ---- Download is not acknowledgement ----
const downloaded = markLegacyBackupDownloaded(prepared, prepared.generation);
assert.equal(downloaded.status === "ready" && downloaded.downloaded, true);
assert.equal(legacyDiscardGuard(downloaded, target, prepared.generation), null);
const acknowledged = acknowledgeLegacyBackup(downloaded, prepared.generation, true);
const binding = legacyDiscardGuard(acknowledged, target, prepared.generation);
assert.ok(binding, "an acknowledged backup for the same row, fingerprint, policy and generation may be discarded");
assert.equal(legacyDiscardGuard(acknowledgeLegacyBackup(acknowledged, prepared.generation, false), target, prepared.generation), null);

// ---- Every part of the binding is checked again at confirmation ----
for (const [name, candidate, generation] of [
	["another record", { ...target, sourceOverrideId: "posts:post-2" }, prepared.generation],
	["another fingerprint", { ...target, fingerprint: `sha256-${"b".repeat(64)}` }, prepared.generation],
	["another policy", { ...target, conflictPolicy: "prefer-core" }, prepared.generation],
	["another request generation", target, prepared.generation + 1],
] as const) {
	assert.equal(legacyDiscardGuard(acknowledged, candidate, generation), null, name);
}
const refreshed = resetLegacyDiscard(acknowledged);
assert.deepEqual(refreshed, { status: "idle", generation: prepared.generation + 1 });
assert.equal(legacyDiscardGuard(refreshed, target, prepared.generation), null, "a refresh ends the acknowledgement");
assert.equal(acknowledgeLegacyBackup(refreshed, prepared.generation, true), refreshed, "an acknowledgement for an earlier request does nothing");

// ---- Delayed completions never replace a newer request ----
const first = startLegacyBackup(initialLegacyDiscardState(), target);
const second = startLegacyBackup(first, { ...target, sourceOverrideId: "posts:post-2" });
assert.equal(receiveLegacyBackup(second, first.generation, { plan: plan() }), second, "the first request's late response is ignored");
assert.equal(receiveLegacyBackup(resetLegacyDiscard(first), first.generation, { plan: plan() }).status, "idle", "a response after a refresh is ignored");
const afterSelection = startLegacyBackup(acknowledged, { ...target, sourceOverrideId: "posts:post-2" });
assert.equal(legacyDiscardGuard(afterSelection, target, prepared.generation), null, "selecting another record ends the acknowledgement");

// ---- What a backup response cannot prove ----
const outcome = (response: Parameters<typeof receiveLegacyBackup>[2]) =>
	receiveLegacyBackup(startLegacyBackup(initialLegacyDiscardState(), target), 1, response);
for (const [name, response, reason] of [
	["a host without conditional deletion", { plan: plan({ discardAvailable: false }) }, "discard-unavailable"],
	["a changed fingerprint", { plan: plan({ fingerprint: `sha256-${"c".repeat(64)}` }) }, "plan-changed"],
	["another record", { plan: plan({ sourceOverrideId: "posts:post-2" }) }, "plan-changed"],
	["two items", { plan: plan({ items: 2 }) }, "plan-changed"],
	["a document for another policy", { plan: plan({ document: exportDocument((document) => { document.conflictPolicy = "prefer-core"; }) }) }, "plan-changed"],
	["a refused alias", { plan: plan({ snapshot: { status: "refused", reason: "not-exact-id" } }) }, "not-exact-id"],
	["a refused large record", { plan: plan({ snapshot: { status: "refused", reason: "too-large" } }) }, "too-large"],
	["a refused recovery", { plan: plan({ snapshot: { status: "refused", reason: "recovery-pending" } }) }, "recovery-pending"],
	["a missing snapshot", { plan: { ...plan(), items: [{ ...plan().items[0], snapshot: undefined }] } }, "request-failed"],
	["a failed request", { error: new Error("offline") }, "request-failed"],
] as const) {
	const next = outcome(response as Parameters<typeof receiveLegacyBackup>[2]);
	assert.equal(next.status, "unavailable", name);
	assert.equal(next.status === "unavailable" && next.reason, reason, name);
	assert.ok(LEGACY_BACKUP_UNAVAILABLE_MESSAGES[reason], name);
}
assert.equal((outcome({ error: new Error("offline") }) as any).message, "offline");

// ---- A refused or failed discard resets and marks the retained row out of date ----
const discarding = beginLegacyDiscard(acknowledged, binding!);
assert.equal(discarding.status, "discarding");
assert.equal(beginLegacyDiscard(refreshed, binding!), refreshed, "a discard for an earlier request never starts");
assert.equal(legacyDiscardBusy(discarding), true);
assert.equal(legacyDiscardBusy(acknowledged), false);
assert.equal(legacyDiscardSubject(discarding), "posts:post-1");
for (const result of ["refused", "failed"] as const) {
	const settled = settleLegacyDiscard(discarding, binding!, result);
	assert.deepEqual(settled, { state: { status: "idle", generation: discarding.generation + 1 }, staleSourceOverrideId: "posts:post-1", rebuild: true, current: true }, result);
	assert.equal(legacyDiscardGuard(settled.state, target, discarding.generation), null, result);
}
assert.deepEqual(settleLegacyDiscard(discarding, binding!, "removed"), {
	state: { status: "idle", generation: discarding.generation + 1 }, staleSourceOverrideId: "posts:post-1", rebuild: true, current: true,
});

// ---- Overlap: a request that settles after a newer one started ----
const newerTarget = { ...target, sourceOverrideId: "posts:post-2" };
const newerBackup = startLegacyBackup(discarding, newerTarget);
const afterRefresh = resetLegacyDiscard(discarding);
for (const later of [newerBackup, afterRefresh]) {
	for (const result of ["refused", "failed"] as const) {
		assert.deepEqual(settleLegacyDiscard(later, binding!, result), { state: later, staleSourceOverrideId: null, rebuild: false, current: false },
			`a late ${result} changes nothing`);
	}
	// A late removal still invalidates the plan shown before it and marks its row, and keeps unrelated newer state.
	assert.deepEqual(settleLegacyDiscard(later, binding!, "removed"), { state: later, staleSourceOverrideId: "posts:post-1", rebuild: true, current: false });
}
const newerReady = receiveLegacyBackup(newerBackup, newerBackup.generation, {
	plan: plan({ sourceOverrideId: "posts:post-2", document: exportDocument((document) => { document.sourceOverrideId = "posts:post-2"; document.entry = { ...document.entry, ref: "posts:post-2", entryId: "post-2" }; }) }),
});
const newerAcknowledged = acknowledgeLegacyBackup(newerReady, newerBackup.generation, true);
const newerDiscarding = beginLegacyDiscard(newerAcknowledged, legacyDiscardGuard(newerAcknowledged, newerTarget, newerBackup.generation)!);
assert.equal(settleLegacyDiscard(newerDiscarding, binding!, "refused").current, false, "an earlier binding never settles a newer discard");
assert.equal(settleLegacyDiscard(newerDiscarding, binding!, "removed").state, newerDiscarding, "nor resets it on a late removal");
// A newer backup of the record that was just removed is never left ready or acknowledged.
const sameRecordAgain = startLegacyBackup(afterRefresh, target);
const sameRecordReady = acknowledgeLegacyBackup(receiveLegacyBackup(sameRecordAgain, sameRecordAgain.generation, { plan: plan() }), sameRecordAgain.generation, true);
assert.equal(sameRecordReady.status === "ready" && sameRecordReady.acknowledged, true);
const lateRemoval = settleLegacyDiscard(sameRecordReady, binding!, "removed");
assert.deepEqual([lateRemoval.state.status, lateRemoval.staleSourceOverrideId, lateRemoval.rebuild], ["idle", "posts:post-1", true]);
assert.equal(legacyDiscardGuard(lateRemoval.state, target, sameRecordAgain.generation), null);

assert.equal(
	legacyBackupFilename({ sourceOverrideId: "posts:post 1/../x", fingerprint }),
	"seo-legacy-posts-post-1-..-x-aaaaaaaaaaaa.json",
);

console.log("Legacy discard model self-check passed.");
