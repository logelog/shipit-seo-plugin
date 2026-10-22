import type {
	CoreSeoMigrationConflictPolicy,
	SeoAdminLegacyRecordExport,
	SeoAdminLegacyRecordSnapshotRefusal,
	SeoAdminMigrationPlanItem,
	SeoAdminMigrationPlanResponse,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

/** The reviewed plan row a backup and discard are for. */
export interface LegacyDiscardTarget {
	sourceOverrideId: string;
	fingerprint: string;
	conflictPolicy: CoreSeoMigrationConflictPolicy;
}

/** What one exported document proves, together with the request that produced it. */
export interface LegacyBackupBinding extends LegacyDiscardTarget {
	ref: string;
	reference: string;
	collection: string;
	entryId: string;
	/** The entry's actual locale as exported; null when the host stores none. */
	locale: string | null;
	generation: number;
}

export type LegacyBackupUnavailableReason =
	| SeoAdminLegacyRecordSnapshotRefusal
	| "discard-unavailable"
	| "plan-changed"
	| "request-failed";

/**
 * Every transition advances or checks `generation`, so a response to an
 * earlier request, or an acknowledgement given for it, never applies to a
 * later one. The acknowledgement exists only in `ready`.
 */
export type LegacyDiscardState =
	| { status: "idle"; generation: number }
	| { status: "preparing"; generation: number; target: LegacyDiscardTarget }
	| {
		status: "ready";
		generation: number;
		binding: LegacyBackupBinding;
		document: string;
		bytes: number;
		downloaded: boolean;
		acknowledged: boolean;
	}
	| {
		status: "unavailable";
		generation: number;
		target: LegacyDiscardTarget;
		reason: LegacyBackupUnavailableReason;
		message: string | null;
	}
	| { status: "discarding"; generation: number; binding: LegacyBackupBinding };

export type LegacyDiscardEligibility =
	| { eligible: true }
	| { eligible: false; reason: "host" | "alias" | "no-entry" };

export function initialLegacyDiscardState(): LegacyDiscardState {
	return { status: "idle", generation: 0 };
}

/** Only an exact-ID record on a host with conditional deletion gets the guarded removal workflow. */
export function legacyDiscardEligibility(
	item: Pick<SeoAdminMigrationPlanItem, "sourceOverrideId" | "collection" | "entryId">,
	discardAvailable: boolean,
): LegacyDiscardEligibility {
	if (!discardAvailable) return { eligible: false, reason: "host" };
	if (!item.collection || !item.entryId) return { eligible: false, reason: "no-entry" };
	if (item.sourceOverrideId !== `${item.collection}:${item.entryId}`) return { eligible: false, reason: "alias" };
	return { eligible: true };
}

/** A refresh, navigation, new selection, failure or refusal ends any backup and acknowledgement. */
export function resetLegacyDiscard(state: LegacyDiscardState): LegacyDiscardState {
	return { status: "idle", generation: state.generation + 1 };
}

export function startLegacyBackup(state: LegacyDiscardState, target: LegacyDiscardTarget): LegacyDiscardState {
	return { status: "preparing", generation: state.generation + 1, target };
}

function unavailable(
	generation: number,
	target: LegacyDiscardTarget,
	reason: LegacyBackupUnavailableReason,
	message: string | null = null,
): LegacyDiscardState {
	return { status: "unavailable", generation, target, reason, message };
}

/**
 * Accepts only the export requested by the current generation, for the same
 * row, fingerprint and policy. The document is used as delivered; nothing is
 * rebuilt from the parsed copy.
 */
export function receiveLegacyBackup(
	state: LegacyDiscardState,
	generation: number,
	outcome: { plan: SeoAdminMigrationPlanResponse } | { error: unknown },
): LegacyDiscardState {
	if (state.status !== "preparing" || state.generation !== generation) return state;
	const { target } = state;
	if ("error" in outcome) {
		return unavailable(generation, target, "request-failed", outcome.error instanceof Error ? outcome.error.message : null);
	}
	const { plan } = outcome;
	if (!plan.discardAvailable) return unavailable(generation, target, "discard-unavailable");
	const item = plan.items.length === 1 ? plan.items[0] : null;
	// A different fingerprint means the reviewed row no longer describes the stored record or entry.
	if (!item || item.sourceOverrideId !== target.sourceOverrideId || item.fingerprint !== target.fingerprint)
		return unavailable(generation, target, "plan-changed");
	const snapshot = item.snapshot;
	if (!snapshot) return unavailable(generation, target, "request-failed");
	if (snapshot.status === "refused") return unavailable(generation, target, snapshot.reason);
	let exported: SeoAdminLegacyRecordExport;
	try {
		exported = JSON.parse(snapshot.document) as SeoAdminLegacyRecordExport;
	} catch {
		return unavailable(generation, target, "request-failed");
	}
	if (
		exported.sourceOverrideId !== target.sourceOverrideId ||
		exported.fingerprint !== target.fingerprint ||
		exported.conflictPolicy !== target.conflictPolicy
	)
		return unavailable(generation, target, "plan-changed");
	return {
		status: "ready",
		generation,
		binding: {
			...target,
			ref: exported.entry.ref,
			reference: exported.reference,
			collection: exported.entry.collection,
			entryId: exported.entry.entryId,
			locale: exported.entry.locale,
			generation,
		},
		document: snapshot.document,
		bytes: snapshot.bytes,
		downloaded: false,
		acknowledged: false,
	};
}

/** Offering or saving the download never acknowledges it. */
export function markLegacyBackupDownloaded(state: LegacyDiscardState, generation: number): LegacyDiscardState {
	if (state.status !== "ready" || state.generation !== generation) return state;
	return { ...state, downloaded: true };
}

export function acknowledgeLegacyBackup(
	state: LegacyDiscardState,
	generation: number,
	acknowledged: boolean,
): LegacyDiscardState {
	if (state.status !== "ready" || state.generation !== generation) return state;
	return { ...state, acknowledged };
}

/**
 * The binding a discard may use right now, or null. The confirm handler calls
 * this again, so a refresh between opening the dialog and confirming it wins.
 */
export function legacyDiscardGuard(
	state: LegacyDiscardState,
	target: LegacyDiscardTarget,
	generation: number,
): LegacyBackupBinding | null {
	if (state.status !== "ready" || !state.acknowledged || state.generation !== generation) return null;
	const { binding } = state;
	return binding.sourceOverrideId === target.sourceOverrideId &&
		binding.fingerprint === target.fingerprint &&
		binding.conflictPolicy === target.conflictPolicy &&
		binding.generation === generation
		? binding
		: null;
}

export function beginLegacyDiscard(state: LegacyDiscardState, binding: LegacyBackupBinding): LegacyDiscardState {
	if (state.status !== "ready" || state.generation !== binding.generation) return state;
	return { status: "discarding", generation: state.generation, binding };
}

/** The record the workflow currently concerns, if any. */
export function legacyDiscardSubject(state: LegacyDiscardState): string | null {
	if (state.status === "ready" || state.status === "discarding") return state.binding.sourceOverrideId;
	if (state.status === "preparing" || state.status === "unavailable") return state.target.sourceOverrideId;
	return null;
}

/** While a delete is in flight, refreshes, policy changes and other backups wait. */
export function legacyDiscardBusy(state: LegacyDiscardState): boolean {
	return state.status === "discarding";
}

/**
 * Settles one discard request. A refused or failed discard proves only that
 * this request changed nothing: when it is still the current request, the
 * acknowledgement ends, the row is marked out of date and the plan is built
 * again; a late refusal changes nothing. A removal always invalidates the
 * shown plan and marks its row out of date, even when it completes after a
 * newer request; that newer workflow is kept unless it concerns the removed record.
 */
export function settleLegacyDiscard(
	state: LegacyDiscardState,
	binding: LegacyBackupBinding,
	outcome: "removed" | "refused" | "failed",
): { state: LegacyDiscardState; staleSourceOverrideId: string | null; rebuild: boolean; current: boolean } {
	const current = state.status === "discarding" && state.generation === binding.generation && state.binding === binding;
	if (outcome === "removed") {
		return {
			state: current || legacyDiscardSubject(state) === binding.sourceOverrideId ? resetLegacyDiscard(state) : state,
			staleSourceOverrideId: binding.sourceOverrideId,
			rebuild: true,
			current,
		};
	}
	if (!current) return { state, staleSourceOverrideId: null, rebuild: false, current };
	return { state: resetLegacyDiscard(state), staleSourceOverrideId: binding.sourceOverrideId, rebuild: true, current };
}

export function legacyBackupFilename(binding: Pick<LegacyBackupBinding, "sourceOverrideId" | "fingerprint">): string {
	const name = binding.sourceOverrideId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "record";
	return `seo-legacy-${name}-${binding.fingerprint.slice(7, 19)}.json`;
}

export const LEGACY_BACKUP_UNAVAILABLE_MESSAGES: Record<LegacyBackupUnavailableReason, string> = {
	"not-exact-id": "Only a record stored under the entry's own ID can be exported and removed here.",
	"recovery-pending": "A migration of this record is in progress. Finish it before removing the record.",
	"record-missing": "The legacy record no longer exists. Rebuild the plan.",
	"entry-unavailable": "The entry this record belongs to could not be read, so no backup is offered.",
	"not-json": "The stored record is not plain JSON data, so a complete backup cannot be offered.",
	"too-large": "The complete backup is larger than 2 MiB, so it is not offered and the record cannot be removed here.",
	"discard-unavailable": "This site cannot remove the record with a guarded delete.",
	"plan-changed": "The record or its entry changed after this plan was built. Review the rebuilt plan.",
	"request-failed": "The backup could not be prepared.",
};
