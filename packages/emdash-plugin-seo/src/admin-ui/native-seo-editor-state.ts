import { LOCAL_MEDIA_PREFIX } from "./local-media.ts";

export const NATIVE_SEO_TITLE_MAX_LENGTH = 200;
export const NATIVE_SEO_DESCRIPTION_MAX_LENGTH = 500;
// The host leaves image strings unbounded; this editor bounds its own inputs.
export const NATIVE_SEO_IMAGE_MAX_LENGTH = 4_096;
// Existing host image references use a separate read bound, not the picker input limit.
export const NATIVE_SEO_STORED_IMAGE_MAX_LENGTH = 65_536;
const REVISION_MAX_LENGTH = 1_024;
const FIELDS = ["title", "description", "image"] as const;

export type NativeSeoField = typeof FIELDS[number];
export type NativeSeoValues = Readonly<Record<NativeSeoField, string | null>>;
export type NativeSeoDraft = Readonly<Partial<Record<NativeSeoField, string | null>>>;

export interface NativeSeoTarget {
	readonly principal: Readonly<{ id: string; role: number }>;
	readonly collection: string;
	readonly entryId: string;
	readonly locale: string | null;
}

/** Stored native fields, never the resolved preview or live form values. */
export interface NativeSeoSnapshot {
	readonly target: NativeSeoTarget;
	readonly revision: string;
	readonly values: NativeSeoValues;
}

export interface NativeSeoSaveAttempt {
	readonly id: number;
	readonly target: NativeSeoTarget;
	readonly expectedRevision: string;
	readonly patch: NativeSeoDraft;
	readonly expectedValues: NativeSeoValues;
}

export interface NativeSeoReadbackRequest {
	readonly id: number;
	readonly target: NativeSeoTarget;
	readonly attempt: NativeSeoSaveAttempt | null;
}

export type NativeSeoFieldErrors = Readonly<Partial<Record<NativeSeoField, "invalid" | "too_long">>>;
export interface NativeSeoEditorState {
	readonly target: NativeSeoTarget;
	readonly phase: "idle" | "editing" | "saving" | "confirmed" | "conflict" | "unknown";
	readonly baseline: NativeSeoSnapshot | null;
	readonly draft: NativeSeoDraft;
	readonly attempt: NativeSeoSaveAttempt | null;
	readonly writePending: boolean;
	readonly readback: NativeSeoReadbackRequest | null;
	readonly reviewSnapshot: NativeSeoSnapshot | null;
	readonly sequence: number;
	readonly problem: "invalid_baseline" | "invalid_values" | "conflict" | "unconfirmed" |
		"readback_unavailable" | "response_mismatch" | "rejected" | "locked" | "not_saved" | null;
	readonly errors: NativeSeoFieldErrors;
}

/** `locked`: another editor holds the entry, and the host refused the write before storing anything. */
export type NativeSeoWriteResult =
	| { outcome: "acknowledged"; snapshot: NativeSeoSnapshot }
	| { outcome: "conflict" }
	| { outcome: "rejected" }
	| { outcome: "locked" };

export type NativeSeoEditorEvent =
	| { type: "target"; target: NativeSeoTarget; snapshot: NativeSeoSnapshot | null }
	| { type: "snapshot"; snapshot: NativeSeoSnapshot }
	| { type: "observed"; snapshot: NativeSeoSnapshot }
	| { type: "write-result"; attempt: NativeSeoSaveAttempt; result: NativeSeoWriteResult }
	| { type: "write-unknown"; attempt: NativeSeoSaveAttempt }
	| { type: "readback-result"; request: NativeSeoReadbackRequest; snapshot: NativeSeoSnapshot }
	| { type: "readback-unavailable"; request: NativeSeoReadbackRequest };

function boundedIdentity(value: unknown, limit: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= limit &&
		value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function validTarget(target: NativeSeoTarget): boolean {
	return Boolean(target && typeof target === "object" && target.principal &&
		boundedIdentity(target.principal.id, 256) && Number.isFinite(target.principal.role) &&
		boundedIdentity(target.collection, 128) && /^[a-z][a-z0-9_]*$/.test(target.collection) &&
		boundedIdentity(target.entryId, 256) &&
		(target.locale === null || boundedIdentity(target.locale, 128)));
}

export function sameNativeSeoTarget(left: NativeSeoTarget, right: NativeSeoTarget): boolean {
	return left.principal.id === right.principal.id && left.principal.role === right.principal.role &&
		left.collection === right.collection && left.entryId === right.entryId && left.locale === right.locale;
}

function copyTarget(target: NativeSeoTarget): NativeSeoTarget {
	return Object.freeze({ principal: Object.freeze({ id: target.principal.id, role: target.principal.role }),
		collection: target.collection, entryId: target.entryId, locale: target.locale });
}

function lengthLimit(field: NativeSeoField): number {
	return field === "title" ? NATIVE_SEO_TITLE_MAX_LENGTH
		: field === "description" ? NATIVE_SEO_DESCRIPTION_MAX_LENGTH : NATIVE_SEO_IMAGE_MAX_LENGTH;
}

function nativeValue(value: string | null): string | null {
	return value === null || !value.trim() ? null : value;
}

function validImage(value: string): boolean {
	if (value.startsWith(LOCAL_MEDIA_PREFIX)) {
		try {
			const url = new URL(value, "https://emdash.invalid");
			return url.pathname === value && url.pathname.length > LOCAL_MEDIA_PREFIX.length;
		} catch { return false; }
	}
	try {
		const url = new URL(value);
		return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
	} catch { return false; }
}

export function validateNativeSeoDraft(draft: NativeSeoDraft): NativeSeoFieldErrors {
	const errors: Partial<Record<NativeSeoField, "invalid" | "too_long">> = {};
	for (const field of FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(draft, field)) continue;
		const value = draft[field];
		if (value !== null && typeof value !== "string") errors[field] = "invalid";
		else if (typeof value === "string" && value.length > lengthLimit(field)) errors[field] = "too_long";
		else if (field === "image" && typeof value === "string" && nativeValue(value) !== null && !validImage(value)) errors.image = "invalid";
	}
	return Object.freeze(errors);
}

function coherentSnapshot(snapshot: NativeSeoSnapshot, target: NativeSeoTarget): boolean {
	if (!snapshot || typeof snapshot !== "object" || !validTarget(snapshot.target) ||
		!sameNativeSeoTarget(snapshot.target, target) || !boundedIdentity(snapshot.revision, REVISION_MAX_LENGTH) ||
		!snapshot.values || typeof snapshot.values !== "object") return false;
	// Existing native values are not rewritten to satisfy the picker URL policy.
	return FIELDS.every((field) => {
		const value = snapshot.values[field];
		return value === null || (typeof value === "string" && value.length <=
			(field === "image" ? NATIVE_SEO_STORED_IMAGE_MAX_LENGTH : lengthLimit(field)));
	});
}

function copySnapshot(snapshot: NativeSeoSnapshot): NativeSeoSnapshot {
	return Object.freeze({ target: copyTarget(snapshot.target), revision: snapshot.revision,
		values: Object.freeze({ title: snapshot.values.title, description: snapshot.values.description, image: snapshot.values.image }) });
}

function sameValues(left: NativeSeoValues, right: NativeSeoValues): boolean {
	return FIELDS.every((field) => left[field] === right[field]);
}

function sameSnapshot(left: NativeSeoSnapshot, right: NativeSeoSnapshot): boolean {
	return left.revision === right.revision && sameValues(left.values, right.values);
}

/** Host revision tokens are opaque; only a decodable counter orders two of them. */
function revisionCounter(revision: string): number | null {
	try {
		const decoded = atob(revision);
		const separator = decoded.indexOf(":");
		const counter = separator > 0 ? Number(decoded.slice(0, separator)) : Number.NaN;
		return Number.isSafeInteger(counter) && counter >= 0 ? counter : null;
	} catch { return null; }
}

/** True while `held` is older than `adopted`; tokens without a counter only compare as equal or different. */
export function nativeSeoRevisionBehind(held: string, adopted: string): boolean {
	const heldCounter = revisionCounter(held);
	const adoptedCounter = revisionCounter(adopted);
	return heldCounter === null || adoptedCounter === null ? held !== adopted : heldCounter < adoptedCounter;
}

function changedPatch(draft: NativeSeoDraft, baseline: NativeSeoValues): NativeSeoDraft {
	const patch: Partial<Record<NativeSeoField, string | null>> = {};
	for (const field of FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(draft, field)) continue;
		const value = nativeValue(draft[field]!);
		if (value !== baseline[field]) patch[field] = value;
	}
	return Object.freeze(patch);
}

function remainingDraft(draft: NativeSeoDraft, baseline: NativeSeoValues): NativeSeoDraft {
	const next: Partial<Record<NativeSeoField, string | null>> = {};
	const errors = validateNativeSeoDraft(draft);
	for (const field of FIELDS) {
		if (Object.prototype.hasOwnProperty.call(draft, field) &&
			(errors[field] || nativeValue(draft[field]!) !== baseline[field])) next[field] = draft[field]!;
	}
	return Object.freeze(next);
}

export function createNativeSeoEditorState(target: NativeSeoTarget, snapshot: NativeSeoSnapshot | null): NativeSeoEditorState {
	if (!validTarget(target)) throw new Error("Invalid native SEO editor target");
	const baseline = snapshot && coherentSnapshot(snapshot, target) ? copySnapshot(snapshot) : null;
	return { target: copyTarget(target), phase: baseline ? "idle" : "unknown", baseline,
		draft: Object.freeze({}), attempt: null, writePending: false, readback: null, reviewSnapshot: null,
		sequence: 0, problem: baseline ? null : "invalid_baseline", errors: Object.freeze({}) };
}

export function updateNativeSeoDraft(state: NativeSeoEditorState, patch: NativeSeoDraft): NativeSeoEditorState {
	const draft: Partial<Record<NativeSeoField, string | null>> = { ...state.draft };
	for (const field of FIELDS) if (Object.prototype.hasOwnProperty.call(patch, field)) draft[field] = patch[field]!;
	const errors = validateNativeSeoDraft(draft);
	const nextDraft = Object.freeze(draft);
	const blocked = state.phase === "saving" || state.phase === "conflict" || state.phase === "unknown" || state.readback !== null;
	return { ...state, draft: nextDraft, errors,
		phase: blocked ? state.phase : "editing",
		problem: blocked ? state.problem : Object.keys(errors).length ? "invalid_values" : null };
}

/** Fields a save would send, in field order; empty without a confirmed baseline. */
export function nativeSeoChangedFields(state: NativeSeoEditorState): NativeSeoField[] {
	if (!state.baseline) return [];
	const patch = changedPatch(state.draft, state.baseline.values);
	return FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(patch, field));
}

export function canSaveNativeSeoValues(state: NativeSeoEditorState): boolean {
	return Boolean(state.baseline && !state.writePending && !state.readback && !state.attempt &&
		(state.phase === "idle" || state.phase === "editing" || state.phase === "confirmed") &&
		!Object.keys(validateNativeSeoDraft(state.draft)).length &&
		Object.keys(changedPatch(state.draft, state.baseline.values)).length);
}

export function beginNativeSeoSave(state: NativeSeoEditorState): { state: NativeSeoEditorState; attempt: NativeSeoSaveAttempt | null } {
	if (!canSaveNativeSeoValues(state) || !state.baseline) return { state, attempt: null };
	const patch = changedPatch(state.draft, state.baseline.values);
	const attempt: NativeSeoSaveAttempt = Object.freeze({ id: state.sequence + 1, target: copyTarget(state.target),
		expectedRevision: state.baseline.revision, patch,
		expectedValues: Object.freeze({ ...state.baseline.values, ...patch }) });
	return { state: { ...state, phase: "saving", attempt, writePending: true, readback: null,
		reviewSnapshot: null, sequence: attempt.id, problem: null }, attempt };
}

/** This body cannot write content, canonical, noindex, plugin Social text or media assets. */
export function nativeSeoWriteInput(attempt: NativeSeoSaveAttempt): Readonly<{ seo: NativeSeoDraft; _rev: string }> {
	return Object.freeze({ seo: attempt.patch, _rev: attempt.expectedRevision });
}

export function beginNativeSeoReadback(state: NativeSeoEditorState): { state: NativeSeoEditorState; request: NativeSeoReadbackRequest | null } {
	if (state.writePending || state.readback) return { state, request: null };
	const request: NativeSeoReadbackRequest = Object.freeze({ id: state.sequence + 1,
		target: copyTarget(state.target), attempt: state.attempt });
	return { state: { ...state, readback: request, reviewSnapshot: null, sequence: request.id }, request };
}

function currentAttempt(state: NativeSeoEditorState, attempt: NativeSeoSaveAttempt): boolean {
	return state.writePending && state.attempt === attempt && sameNativeSeoTarget(state.target, attempt.target);
}

function currentReadback(state: NativeSeoEditorState, request: NativeSeoReadbackRequest): boolean {
	return state.readback === request && state.attempt === request.attempt && sameNativeSeoTarget(state.target, request.target);
}

function uncertain(state: NativeSeoEditorState, problem: NativeSeoEditorState["problem"]): NativeSeoEditorState {
	return { ...state, phase: "unknown", writePending: false, readback: null, reviewSnapshot: null, problem };
}

export function nativeSeoEditorReducer(state: NativeSeoEditorState, event: NativeSeoEditorEvent): NativeSeoEditorState {
	switch (event.type) {
		case "target":
			return sameNativeSeoTarget(state.target, event.target)
				? event.snapshot ? nativeSeoEditorReducer(state, { type: "snapshot", snapshot: event.snapshot }) : state
				: createNativeSeoEditorState(event.target, event.snapshot);
		case "snapshot": {
			// Only the initial passive read may supply authority. Later reads are explicit.
			if (state.sequence > 0 || state.attempt || state.readback || !coherentSnapshot(event.snapshot, state.target)) return state;
			if (state.baseline && !sameSnapshot(state.baseline, event.snapshot) && Object.keys(state.draft).length) {
				return { ...state, phase: "conflict", reviewSnapshot: null, problem: "conflict" };
			}
			return { ...state, baseline: copySnapshot(event.snapshot), phase: Object.keys(state.draft).length ? "editing" : "idle", problem: null };
		}
		case "observed": {
			// A newer host revision becomes the guard only while its native fields equal the baseline;
			// otherwise edits wait in the review. Nothing is written or discarded here.
			const baseline = state.baseline;
			if (!baseline || state.attempt || state.writePending || state.readback || state.phase === "conflict" ||
				state.phase === "unknown" || !coherentSnapshot(event.snapshot, state.target)) return state;
			const observed = revisionCounter(event.snapshot.revision);
			const current = revisionCounter(baseline.revision);
			if (observed === null || current === null || observed <= current) return state;
			const snapshot = copySnapshot(event.snapshot);
			if (sameValues(snapshot.values, baseline.values)) return { ...state, baseline: snapshot };
			if (Object.keys(changedPatch(state.draft, baseline.values)).length || Object.keys(state.errors).length) {
				return { ...state, phase: "conflict", reviewSnapshot: snapshot, problem: "conflict" };
			}
			return { ...state, baseline: snapshot, draft: Object.freeze({}), errors: Object.freeze({}), phase: "idle", problem: null };
		}
		case "write-unknown":
			return currentAttempt(state, event.attempt) ? uncertain(state, "unconfirmed") : state;
		case "write-result": {
			if (!currentAttempt(state, event.attempt)) return state;
			if (event.result.outcome === "conflict") return { ...state, phase: "conflict", writePending: false,
				reviewSnapshot: null, problem: "conflict" };
			if (event.result.outcome === "rejected" || event.result.outcome === "locked") return { ...state, phase: "editing",
				writePending: false, attempt: null, problem: event.result.outcome };
			const snapshot = event.result.snapshot;
			if (!coherentSnapshot(snapshot, state.target) || snapshot.revision === event.attempt.expectedRevision ||
				!sameValues(snapshot.values, event.attempt.expectedValues)) return uncertain(state, "response_mismatch");
			// An acknowledgement is not a readback, and cannot synchronize the parent editor.
			return uncertain(state, null);
		}
		case "readback-unavailable":
			return currentReadback(state, event.request) ? uncertain(state, "readback_unavailable") : state;
		case "readback-result": {
			if (!currentReadback(state, event.request)) return state;
			if (!coherentSnapshot(event.snapshot, state.target)) return uncertain(state, "response_mismatch");
			const snapshot = copySnapshot(event.snapshot);
			if (state.attempt) {
				if (snapshot.revision === state.attempt.expectedRevision) {
					if (!state.baseline || !sameSnapshot(state.baseline, snapshot)) return uncertain(state, "unconfirmed");
					// The original request may still commit after a timed-out caller. A new attempt carries this
					// same guard, so the host refuses whichever of the two writes arrives second.
					const kept = remainingDraft(state.draft, snapshot.values);
					return { ...state, phase: Object.keys(kept).length ? "editing" : "idle", baseline: snapshot, draft: kept,
						attempt: null, writePending: false, readback: null, reviewSnapshot: null, problem: "not_saved",
						errors: validateNativeSeoDraft(kept) };
				}
				if (!sameValues(snapshot.values, state.attempt.expectedValues)) {
					return { ...state, phase: "conflict", readback: null, reviewSnapshot: snapshot, problem: "conflict" };
				}
			} else if (Object.keys(state.draft).length && state.baseline && !sameSnapshot(state.baseline, snapshot)) {
				return { ...state, phase: "conflict", readback: null, reviewSnapshot: snapshot, problem: "conflict" };
			}
			const draft = remainingDraft(state.draft, snapshot.values);
			return { ...state, phase: Object.keys(draft).length ? "editing" : state.attempt ? "confirmed" : "idle",
				baseline: snapshot, draft, attempt: null, writePending: false, readback: null, reviewSnapshot: null,
				problem: null, errors: validateNativeSeoDraft(draft) };
		}
	}
}

/** A deliberate review adopts a freshly read guard; it never dispatches a write. */
export function reviewNativeSeoSave(state: NativeSeoEditorState, keepDraft = true): NativeSeoEditorState {
	if (state.phase !== "conflict" || !state.reviewSnapshot || state.readback || state.writePending) return state;
	const baseline = state.reviewSnapshot;
	const draft = keepDraft ? remainingDraft(state.draft, baseline.values) : Object.freeze({});
	return { ...state, baseline, draft, phase: Object.keys(draft).length ? "editing" : "idle",
		attempt: null, readback: null, reviewSnapshot: null, problem: null, errors: validateNativeSeoDraft(draft) };
}

/** Close is not a save, reload or discard, including while a result is uncertain. */
export function canCloseNativeSeoEditor(state: NativeSeoEditorState): boolean {
	return !state.writePending && state.readback === null;
}

export function discardNativeSeoDraft(state: NativeSeoEditorState): NativeSeoEditorState {
	if (!canCloseNativeSeoEditor(state) || state.attempt || state.phase === "unknown" || state.phase === "conflict") return state;
	return { ...state, phase: "idle", draft: Object.freeze({}), problem: null, errors: Object.freeze({}) };
}
