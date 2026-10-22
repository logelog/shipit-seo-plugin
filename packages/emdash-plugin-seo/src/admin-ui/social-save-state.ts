import {
	SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH,
	SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
	SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH,
	type SeoAdminSocialOverrideEditing,
	type SeoAdminSocialOverrideReadResult,
	type SeoAdminSocialOverrideSaveResult,
	type SeoAdminSocialOverrideSnapshot,
	type SeoAdminSocialOverrideValues,
} from "../admin-contract.ts";

export interface SocialSaveTarget {
	ref: string;
	locale: string | null;
}

export interface SocialSaveAttempt {
	id: number;
	target: SocialSaveTarget;
	expectedRevision: string | null;
	values: SeoAdminSocialOverrideValues;
	draftIdentity: object;
}

export interface SocialRecoveryRequest {
	id: number;
	target: SocialSaveTarget;
	attemptId: number | null;
}

export type SocialSaveNotice = {
	kind: "saved" | "unchanged" | "current" | "rejected" | "conflict" |
		"unconfirmed" | "recovery-unavailable" | "review" | "rebased" | "loaded";
	error?: string;
} | null;

/** One entry/locale mount owns this state. Preview availability is independent. */
export interface SocialSaveState {
	target: SocialSaveTarget;
	phase: "idle" | "saving" | "unconfirmed" | "checking" | "review";
	editing: SeoAdminSocialOverrideEditing;
	/** Canonical record only; never the effective preview or a slug-alias record. */
	baseline: SeoAdminSocialOverrideSnapshot | null;
	draftIdentity: object | null;
	attempt: SocialSaveAttempt | null;
	recovery: SocialRecoveryRequest | null;
	reviewSnapshot: SeoAdminSocialOverrideSnapshot | null;
	acknowledgedDraftIdentity: object | null;
	notice: SocialSaveNotice;
	sequence: number;
}

export type SocialSaveEvent =
	| { type: "target"; target: SocialSaveTarget; editing: SeoAdminSocialOverrideEditing }
	| { type: "editing"; editing: SeoAdminSocialOverrideEditing }
	| { type: "draft"; draftIdentity: object | null }
	| { type: "save-result"; attempt: SocialSaveAttempt; result: SeoAdminSocialOverrideSaveResult }
	| { type: "save-unconfirmed"; attempt: SocialSaveAttempt }
	| { type: "recovery-result"; request: SocialRecoveryRequest; result: SeoAdminSocialOverrideReadResult }
	| { type: "recovery-unavailable"; request: SocialRecoveryRequest };

export function normaliseSocialSaveValues(values: SeoAdminSocialOverrideValues): SeoAdminSocialOverrideValues {
	return {
		title: values.title.trim().replace(/\s+/g, " "),
		description: values.description.trim().replace(/\s+/g, " "),
	};
}

function sameTarget(left: SocialSaveTarget, right: SocialSaveTarget): boolean {
	return left.ref === right.ref && left.locale === right.locale;
}

function textField(value: unknown, limit: number): boolean {
	return value === null || (typeof value === "string" && value.length <= limit);
}

/** Response parsers validate the wire shape; adoption still checks its identity. */
function coherentSnapshot(snapshot: SeoAdminSocialOverrideSnapshot, target: SocialSaveTarget): boolean {
	if (!snapshot || typeof snapshot !== "object" || snapshot.ref !== target.ref) return false;
	if (snapshot.override === null) return snapshot.revision === null;
	const override = snapshot.override;
	return typeof snapshot.revision === "string" && snapshot.revision.length > 0 &&
		override !== null && typeof override === "object" && !Array.isArray(override) &&
		override.ref === target.ref &&
		override.storageVersion === SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION &&
		textField(override.title, SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH) &&
		textField(override.description, SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH) &&
		Boolean(override.title?.trim() || override.description?.trim()) &&
		typeof override.updatedAt === "string" && Number.isFinite(Date.parse(override.updatedAt));
}

function copySnapshot(snapshot: SeoAdminSocialOverrideSnapshot): SeoAdminSocialOverrideSnapshot {
	return { ...snapshot, override: snapshot.override ? { ...snapshot.override } : null };
}

function acceptedEditing(editing: SeoAdminSocialOverrideEditing, target: SocialSaveTarget): SeoAdminSocialOverrideEditing {
	if (editing.state === "ready") {
		return coherentSnapshot(editing.snapshot, target)
			? { state: "ready", snapshot: copySnapshot(editing.snapshot) }
			: { state: "unavailable", reason: "snapshot_changed" };
	}
	return { ...editing };
}

function snapshotValues(snapshot: SeoAdminSocialOverrideSnapshot): SeoAdminSocialOverrideValues {
	return normaliseSocialSaveValues({
		title: snapshot.override?.title ?? "",
		description: snapshot.override?.description ?? "",
	});
}

function sameValues(left: SeoAdminSocialOverrideValues, right: SeoAdminSocialOverrideValues): boolean {
	return left.title === right.title && left.description === right.description;
}

function sameSnapshot(left: SeoAdminSocialOverrideSnapshot, right: SeoAdminSocialOverrideSnapshot): boolean {
	return left.ref === right.ref && left.revision === right.revision &&
		sameValues(snapshotValues(left), snapshotValues(right));
}

export function createSocialSaveState(target: SocialSaveTarget, editing: SeoAdminSocialOverrideEditing): SocialSaveState {
	const canonical = acceptedEditing(editing, target);
	return {
		target: { ...target }, phase: "idle", editing: canonical,
		baseline: canonical.state === "ready" ? canonical.snapshot : null,
		draftIdentity: null, attempt: null, recovery: null, reviewSnapshot: null,
		acknowledgedDraftIdentity: null, notice: null, sequence: 0,
	};
}

export function canSaveSocialValues(state: SocialSaveState): boolean {
	return state.phase === "idle" && state.editing.state === "ready" &&
		state.baseline !== null && coherentSnapshot(state.baseline, state.target);
}

export function canCloseSocialSave(state: SocialSaveState): boolean {
	return state.phase !== "saving" && state.phase !== "checking";
}

export function socialSaveAcknowledgesDraft(state: SocialSaveState, draftIdentity: object | null): boolean {
	return draftIdentity !== null && state.acknowledgedDraftIdentity === draftIdentity;
}

/** The caller installs the returned state synchronously before dispatching. */
export function beginSocialSave(
	state: SocialSaveState,
	input: { draftIdentity: object; values: SeoAdminSocialOverrideValues },
): { state: SocialSaveState; attempt: SocialSaveAttempt | null } {
	if (!canSaveSocialValues(state) || !state.baseline) return { state, attempt: null };
	const attempt: SocialSaveAttempt = {
		id: state.sequence + 1, target: { ...state.target },
		expectedRevision: state.baseline.revision,
		values: normaliseSocialSaveValues(input.values), draftIdentity: input.draftIdentity,
	};
	return {
		state: { ...state, phase: "saving", attempt, recovery: null, reviewSnapshot: null,
			draftIdentity: input.draftIdentity, acknowledgedDraftIdentity: null, notice: null, sequence: attempt.id },
		attempt,
	};
}

export function beginSocialRecovery(state: SocialSaveState): { state: SocialSaveState; request: SocialRecoveryRequest | null } {
	if (state.phase === "saving" || state.phase === "checking") return { state, request: null };
	const request: SocialRecoveryRequest = {
		id: state.sequence + 1, target: { ...state.target }, attemptId: state.attempt?.id ?? null,
	};
	return {
		state: { ...state, phase: "checking", recovery: request, reviewSnapshot: null,
			acknowledgedDraftIdentity: null, sequence: request.id },
		request,
	};
}

function currentAttempt(state: SocialSaveState, attempt: SocialSaveAttempt): boolean {
	return state.phase === "saving" && state.attempt === attempt && sameTarget(attempt.target, state.target);
}

function currentRecovery(state: SocialSaveState, request: SocialRecoveryRequest): boolean {
	return state.phase === "checking" && state.recovery === request && sameTarget(request.target, state.target) &&
		request.attemptId === (state.attempt?.id ?? null);
}

function unconfirmed(state: SocialSaveState, error?: string): SocialSaveState {
	return { ...state, phase: "unconfirmed", recovery: null, reviewSnapshot: null,
		acknowledgedDraftIdentity: null, notice: { kind: "unconfirmed", ...(error ? { error } : {}) } };
}

function acknowledge(
	state: SocialSaveState,
	snapshot: SeoAdminSocialOverrideSnapshot,
	kind: "saved" | "unchanged" | "current",
): SocialSaveState {
	const draftIdentity = state.attempt?.draftIdentity ?? null;
	const canonical = copySnapshot(snapshot);
	return {
		...state, phase: "idle", editing: { state: "ready", snapshot: canonical }, baseline: canonical,
		attempt: null, recovery: null, reviewSnapshot: null,
		acknowledgedDraftIdentity: draftIdentity,
		draftIdentity: state.draftIdentity === draftIdentity ? null : state.draftIdentity,
		notice: { kind },
	};
}

function recoveryUnavailable(state: SocialSaveState, error?: string): SocialSaveState {
	const reason = error === "record_invalid" ? "record_invalid"
		: error === "response_mismatch" ? "snapshot_changed" : "storage_unavailable";
	return { ...state, phase: state.attempt ? "unconfirmed" : state.draftIdentity ? "review" : "idle",
		editing: { state: "unavailable", reason }, recovery: null, reviewSnapshot: null,
		acknowledgedDraftIdentity: null, notice: { kind: "recovery-unavailable", ...(error ? { error } : {}) } };
}

export function socialSaveReducer(state: SocialSaveState, event: SocialSaveEvent): SocialSaveState {
	switch (event.type) {
		case "target":
			if (sameTarget(state.target, event.target)) return socialSaveReducer(state, { type: "editing", editing: event.editing });
			return createSocialSaveState(event.target, event.editing);
		case "draft":
			return { ...state, draftIdentity: event.draftIdentity, acknowledgedDraftIdentity: null };
		case "editing": {
			// A passive read may have started before an acknowledged command. Once
			// work starts, only an acknowledgement or explicit read owns the guard.
			if (state.phase !== "idle" || state.sequence > 0) return state;
			const editing = acceptedEditing(event.editing, state.target);
			if (editing.state === "unavailable") return { ...state, editing };
			if (state.draftIdentity && state.baseline && !sameSnapshot(state.baseline, editing.snapshot)) {
				return { ...state, editing, phase: "review", reviewSnapshot: editing.snapshot,
					acknowledgedDraftIdentity: null, notice: { kind: "review" } };
			}
			return { ...state, editing, baseline: editing.snapshot };
		}
		case "save-unconfirmed":
			return currentAttempt(state, event.attempt) ? unconfirmed(state) : state;
		case "save-result": {
			if (!currentAttempt(state, event.attempt)) return state;
			const result = event.result;
			if (result.ref !== state.target.ref) return unconfirmed(state, "response_mismatch");
			if (result.success) {
				if (!coherentSnapshot(result.snapshot, state.target) ||
					!sameValues(snapshotValues(result.snapshot), event.attempt.values)) return unconfirmed(state, "response_mismatch");
				return acknowledge(state, result.snapshot, result.outcome);
			}
			if (result.outcome === "unconfirmed") return unconfirmed(state, result.error);
			if (result.error === "conflict") return { ...state, phase: "review", recovery: null, reviewSnapshot: null,
				acknowledgedDraftIdentity: null, notice: { kind: "conflict", error: result.error } };
			return { ...state, phase: "idle", attempt: null, recovery: null, reviewSnapshot: null,
				acknowledgedDraftIdentity: null, notice: { kind: "rejected", error: result.error } };
		}
		case "recovery-unavailable":
			return currentRecovery(state, event.request) ? recoveryUnavailable(state) : state;
		case "recovery-result": {
			if (!currentRecovery(state, event.request)) return state;
			const result = event.result;
			if (!result.success) return recoveryUnavailable(state, result.error);
			if (result.ref !== state.target.ref || !coherentSnapshot(result.snapshot, state.target)) {
				return recoveryUnavailable(state, "response_mismatch");
			}
			if (!state.attempt) {
				const canonical = copySnapshot(result.snapshot);
				if (state.draftIdentity && state.baseline && !sameSnapshot(state.baseline, canonical)) {
					return { ...state, phase: "review", recovery: null, reviewSnapshot: canonical,
						acknowledgedDraftIdentity: null, notice: { kind: "review" } };
				}
				return { ...state, phase: "idle", recovery: null, editing: { state: "ready", snapshot: canonical },
					baseline: canonical, notice: { kind: "loaded" } };
			}
			if (sameValues(snapshotValues(result.snapshot), state.attempt.values)) return acknowledge(state, result.snapshot, "current");
			return { ...state, phase: "review", recovery: null, reviewSnapshot: copySnapshot(result.snapshot),
				acknowledgedDraftIdentity: null, notice: { kind: "review" } };
		}
	}
}

/** Keeping local edits over a different record is a deliberate new baseline. */
export function reviewSocialSaveValues(state: SocialSaveState): SocialSaveState {
	if (state.phase !== "review" || !state.reviewSnapshot || !coherentSnapshot(state.reviewSnapshot, state.target)) return state;
	const canonical = copySnapshot(state.reviewSnapshot);
	return { ...state, phase: "idle", editing: { state: "ready", snapshot: canonical }, baseline: canonical,
		attempt: null, recovery: null, reviewSnapshot: null, acknowledgedDraftIdentity: null, notice: { kind: "rebased" } };
}

/** Closing an unknown/review state never forgets its command or local draft. */
export function closeSocialSave(state: SocialSaveState): SocialSaveState {
	if (!canCloseSocialSave(state) || state.phase === "unconfirmed" || state.phase === "review") return state;
	return { ...state, draftIdentity: null, acknowledgedDraftIdentity: null,
		notice: null };
}
