// Automatic publisher ownership in the admin: one store shared by Site identity
// and Feature controls, so both show the same saved setting and the same
// result of the last command. Requests are numbered; a read that overlaps a
// write in any way is ignored, and an uncertain write locks further writes
// until a read the owner starts after it settles. No React or DOM dependencies.

import type {
	PublisherOwnershipCheck,
	PublisherOwnershipMode,
	PublisherOwnershipPreflight,
	PublisherOwnershipView,
	PublisherOwnershipWriteResult,
} from "../publisher-ownership.ts";

export type OwnershipNotice =
	| { kind: "saved" | "unchanged" | "info"; message: string }
	| { kind: "conflict"; message: string; requested: PublisherOwnershipMode }
	| { kind: "preflight"; message: string; preflight: Extract<PublisherOwnershipPreflight, { status: "refused" }> }
	| { kind: "unconfirmed"; message: string; intended: PublisherOwnershipMode; expectedRevision: string | null }
	| { kind: "uncertain" | "unreadable" | "denied" | "failed"; message: string };

export interface OwnershipState {
	/** The newest settled read or write result. */
	view: PublisherOwnershipView | null;
	/** The last read failed; `view`, if any, is older than the stored setting. */
	loadError: string | null;
	/** The read in flight. Only an explicit read, started by the owner, can settle an uncertain write. */
	reading: { request: number; explicit: boolean } | null;
	/** The write in flight, with the revision its command was sent with. */
	pending: { request: number; mode: PublisherOwnershipMode; expectedRevision: string | null } | null;
	notice: OwnershipNotice | null;
}

export const INITIAL_OWNERSHIP_STATE: OwnershipState = Object.freeze({
	view: null,
	loadError: null,
	reading: null,
	pending: null,
	notice: null,
}) as OwnershipState;

export const OWNERSHIP_DENIED_MESSAGE =
	"Changing publisher output needs the plugin administrator permission (plugins:manage). The request was refused.";
const UNCONFIRMED_MESSAGE =
	"The change could not be confirmed. It may or may not have been stored. Reload the saved setting before changing it again.";

export type OwnershipEvent =
	| { type: "read-start"; request: number; explicit: boolean }
	| { type: "read-result"; request: number; view: PublisherOwnershipView; check?: PublisherOwnershipCheck }
	| { type: "read-failed"; request: number; message: string; denied: boolean }
	| { type: "write-start"; request: number; mode: PublisherOwnershipMode; expectedRevision: string | null }
	| { type: "write-result"; request: number; result: PublisherOwnershipWriteResult }
	| { type: "write-failed"; request: number; failure: "denied" | "rejected" | "unknown"; message: string }
	| { type: "dismiss" };

/** Writes wait for an explicit reload after an unknown outcome or an unexplained refusal. */
export function ownershipLocked(state: OwnershipState): boolean {
	return state.notice?.kind === "unconfirmed" || state.notice?.kind === "uncertain";
}

/** The mode a click would request, or null when no write may start now. */
export function ownershipNextMode(state: OwnershipState): PublisherOwnershipMode | null {
	const view = state.view;
	if (!view || !view.writable || state.pending || state.reading !== null || ownershipLocked(state) || state.loadError) return null;
	if (view.effective === "unknown") return null;
	return view.effective === "automatic" ? "none" : "automatic";
}

/**
 * Whether a read result may be applied: it is the read in flight and no write
 * is pending. Starting and settling a write both clear `reading`, so a read
 * that overlapped a write in any way is never applied.
 */
function readApplies(state: OwnershipState, request: number): boolean {
	return state.reading?.request === request && state.pending === null;
}

function settleRead(state: OwnershipState, request: number): OwnershipState {
	return state.reading?.request === request ? { ...state, reading: null } : state;
}

export function ownershipReducer(state: OwnershipState, event: OwnershipEvent): OwnershipState {
	switch (event.type) {
		case "read-start":
			return { ...state, reading: { request: event.request, explicit: event.explicit } };
		case "read-result": {
			if (!readApplies(state, event.request)) return settleRead(state, event.request);
			const explicit = state.reading?.explicit === true;
			const base: OwnershipState = { ...state, reading: null, view: event.view, loadError: null };
			if (!ownershipLocked(state) || !explicit) return base;
			if (state.notice?.kind === "uncertain") {
				return { ...base, notice: { kind: "info", message: "The saved setting was read again and is shown here. Review it before changing it." } };
			}
			if (event.check === "matches_requested") {
				return { ...base, notice: { kind: "info", message: "The saved setting now matches your request. This does not show which request stored it." } };
			}
			if (event.check === "matches_loaded") {
				return { ...base, notice: { kind: "info", message: "The saved setting is still the version you loaded. You can try again." } };
			}
			if (event.check === "differs") {
				return { ...base, notice: { kind: "info", message: "The saved setting differs from both your request and the version you loaded. Review it before changing it again." } };
			}
			return base;
		}
		case "read-failed": {
			if (!readApplies(state, event.request)) return settleRead(state, event.request);
			return { ...state, reading: null, loadError: event.denied ? OWNERSHIP_DENIED_MESSAGE : event.message };
		}
		case "write-start":
			if (state.pending || ownershipLocked(state)) return state;
			// A read already in flight cannot describe the result of this write.
			return {
				...state,
				reading: null,
				pending: { request: event.request, mode: event.mode, expectedRevision: event.expectedRevision },
				notice: null,
			};
		case "write-result": {
			const pending = state.pending;
			if (pending?.request !== event.request) return state;
			const settled: OwnershipState = { ...state, pending: null, reading: null };
			const result = event.result;
			if (result.success) {
				return {
					...settled,
					view: result.ownership,
					loadError: null,
					notice: result.changed
						? {
								kind: "saved",
								message: result.ownership.effective === "automatic"
									? `Automatic publisher output is on. ${result.preflight ? `${result.preflight.checked} site-wide custom schema${result.preflight.checked === 1 ? " was" : "s were"} checked; per-page schema is handled when each page renders.` : ""}`.trim()
									: "Automatic publisher output is off. Saved identity details and custom schema are unchanged.",
							}
						: { kind: "unchanged", message: `Automatic publisher output was already ${result.ownership.effective === "automatic" ? "on" : "off"}. Nothing was written.` },
				};
			}
			const view = result.ownership ?? state.view;
			switch (result.error) {
				case "conflict":
					return { ...settled, view, notice: { kind: "conflict", message: result.message, requested: pending.mode } };
				case "preflight":
					return result.preflight
						? { ...settled, view, notice: { kind: "preflight", message: result.message, preflight: result.preflight } }
						: { ...settled, view, notice: { kind: "failed", message: result.message } };
				case "unconfirmed":
					return {
						...settled,
						notice: { kind: "unconfirmed", message: UNCONFIRMED_MESSAGE, intended: result.intended ?? pending.mode, expectedRevision: pending.expectedRevision },
					};
				case "storage_uncertain":
					return { ...settled, view, notice: { kind: "uncertain", message: result.message } };
				case "unreadable":
					return { ...settled, view, notice: { kind: "unreadable", message: result.message } };
				default:
					return { ...settled, view, notice: { kind: "failed", message: result.message } };
			}
		}
		case "write-failed": {
			const pending = state.pending;
			if (pending?.request !== event.request) return state;
			const settled: OwnershipState = { ...state, pending: null, reading: null };
			if (event.failure === "unknown") {
				return { ...settled, notice: { kind: "unconfirmed", message: UNCONFIRMED_MESSAGE, intended: pending.mode, expectedRevision: pending.expectedRevision } };
			}
			return {
				...settled,
				notice: event.failure === "denied" ? { kind: "denied", message: OWNERSHIP_DENIED_MESSAGE } : { kind: "failed", message: event.message },
			};
		}
		case "dismiss":
			return ownershipLocked(state) || !state.notice ? state : { ...state, notice: null };
	}
}

export interface OwnershipStore {
	get(): OwnershipState;
	dispatch(event: OwnershipEvent): void;
	subscribe(listener: () => void): () => void;
	/** The next request number; reads and writes share one sequence. */
	nextRequest(): number;
}

/** Outlives both views, so leaving one keeps a pending write and its recovery. */
export function createOwnershipStore(initial: OwnershipState = INITIAL_OWNERSHIP_STATE): OwnershipStore {
	let state = initial;
	let request = 0;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		dispatch(event) {
			const next = ownershipReducer(state, event);
			if (next === state) return;
			state = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		nextRequest: () => ++request,
	};
}

/** What the saved setting means for public output, in one sentence for a status line. */
export function ownershipStatusText(view: PublisherOwnershipView | null): string {
	if (!view) return "Loading the publisher output setting.";
	if (view.effective === "unknown") {
		return view.state === "corrupt"
			? "Ownership unknown: the saved setting is damaged, so this plugin adds no automatic publisher."
			: "Ownership unknown: the saved setting could not be read, so this plugin adds no automatic publisher.";
	}
	if (view.effective === "none") return "Off: this plugin adds no automatic publisher, publisher links or inline publisher facts.";
	return view.state === "absent"
		? "On (default, not saved): this plugin adds the selected publisher automatically."
		: "On: this plugin adds the selected publisher automatically.";
}

/** The separate switches that also decide output; settings, not an inspection of public pages. */
export function ownershipGateText(view: PublisherOwnershipView | null): string | null {
	const gates = view?.gates;
	if (!view || !gates) return view ? "The Schema and Site publisher switches could not be read." : null;
	if (!gates.schemaModule) return "The Schema switch in Feature controls is off, so this plugin adds no schema at all, including custom schema.";
	if (view.effective === "automatic" && !gates.sitePublisherPreset) {
		return "The Site publisher preset is off: pages get no separate publisher graph, but website, article and service schema still name the publisher inline.";
	}
	return null;
}
