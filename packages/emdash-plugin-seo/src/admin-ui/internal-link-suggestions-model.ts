// Pure session model for contextual internal-link suggestions in one entry
// editor. It holds one current page and its next receipt, one chosen
// submission, verified copy eligibility and one copied receipt. Every
// operation captures a monotonic ID, the context epoch, the generation and
// the saved version; a completion that no longer matches them changes
// nothing, whether it succeeded or failed. Nothing here fetches, polls,
// writes or starts an operation by itself.

import type { LinkFindRequest, LinkNextRequest, LinkPageReceipt } from "../admin-contract.ts";
import { canonicalLinkLocale, type LinkSuggestionResponse } from "../internal-link-suggestions.ts";
import {
	prepareLinkSubmission,
	type LinkCheckOutcome,
	type LinkPageOutcome,
	type LinkSubmission,
	type LinkVerifyOutcome,
} from "./internal-link-api.ts";

/** The editor context: exact entry, actual locale, saved version and selected destination scope. */
export interface LinkSessionContext {
	collection: string;
	entryId: string;
	locale: string;
	/** The saved version the editor shows; null before a saved version is known. */
	savedVersion: string | null;
	destination: { collection: string; taxonomy: { taxonomy: string; termIds: readonly string[] } | null } | null;
}

interface OperationBase {
	readonly id: number;
	readonly epoch: number;
	readonly generation: number;
	readonly savedVersion: string | null;
}
export interface LinkFindOperation extends OperationBase { readonly kind: "find"; readonly request: LinkFindRequest }
export interface LinkNextOperation extends OperationBase { readonly kind: "next"; readonly request: LinkNextRequest }
export interface LinkVerifyOperation extends OperationBase { readonly kind: "verify"; readonly submission: LinkSubmission }
/** An issued Copy keeps the exact request and URL it was issued with. */
export interface LinkCopyOperation extends OperationBase { readonly kind: "copy"; readonly submission: LinkSubmission; readonly url: string }
export interface LinkCheckOperation extends OperationBase { readonly kind: "check"; readonly receiptId: number; readonly submission: LinkSubmission }
export type LinkPagingOperation = LinkFindOperation | LinkNextOperation;

export type LinkSettlement<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** A request that did not answer: aborted, an HTTP status such as 401 or 403, or another failure. */
export interface LinkTransportFailure {
	aborted: boolean;
	status: number | null;
}

/** A copied receipt: the verified request and URL the clipboard received, for one entry, locale and scope. */
export interface LinkCopiedReceipt {
	readonly id: number;
	readonly epoch: number;
	readonly submission: LinkSubmission;
	readonly url: string;
}

export interface LinkSessionState {
	readonly context: LinkSessionContext | null;
	readonly epoch: number;
	readonly generation: number;
	readonly lastOperationId: number;
	readonly page: { readonly response: LinkSuggestionResponse; readonly receipt: LinkPageReceipt | null } | null;
	/** The last paging answer that was not a page, kept for display only. */
	readonly pageOutcome: Exclude<LinkPageOutcome, { kind: "result" }> | null;
	readonly pageFailure: LinkTransportFailure | null;
	readonly paging: LinkPagingOperation | null;
	readonly chosen: LinkSubmission | null;
	readonly verifying: LinkVerifyOperation | null;
	/** The last Verify answer that did not verify, kept for display only. */
	readonly verdict: LinkVerifyOutcome | null;
	readonly verifyFailure: LinkTransportFailure | null;
	/** Copy eligibility: the verified URL for the chosen submission. */
	readonly verified: { readonly submission: LinkSubmission; readonly url: string; readonly route: string } | null;
	readonly copying: LinkCopyOperation | null;
	readonly copyFailed: boolean;
	readonly copied: LinkCopiedReceipt | null;
	readonly checking: LinkCheckOperation | null;
	/**
	 * The saved-link answer for the copied receipt. The host does not report
	 * which newer saved version it examined, so none is recorded or implied.
	 */
	readonly checked: { readonly receiptId: number; readonly outcome: LinkCheckOutcome } | null;
	readonly checkFailure: LinkTransportFailure | null;
}

export function createLinkSession(): LinkSessionState {
	return {
		context: null, epoch: 0, generation: 0, lastOperationId: 0,
		page: null, pageOutcome: null, pageFailure: null, paging: null,
		chosen: null, verifying: null, verdict: null, verifyFailure: null, verified: null,
		copying: null, copyFailed: false, copied: null, checking: null, checked: null, checkFailure: null,
	};
}

// ---------------------------------------------------------------------------
// Context

function normalizedContext(context: LinkSessionContext): LinkSessionContext {
	const destination = context.destination === null ? null : {
		collection: context.destination.collection,
		taxonomy: context.destination.taxonomy === null ? null : {
			taxonomy: context.destination.taxonomy.taxonomy,
			termIds: [...new Set(context.destination.taxonomy.termIds)].sort(),
		},
	};
	return { collection: context.collection, entryId: context.entryId, locale: context.locale, savedVersion: context.savedVersion, destination };
}

function sameScope(left: LinkSessionContext, right: LinkSessionContext): boolean {
	return left.collection === right.collection && left.entryId === right.entryId && left.locale === right.locale &&
		JSON.stringify(left.destination) === JSON.stringify(right.destination);
}

const CANDIDATE_RESET = {
	page: null, pageOutcome: null, pageFailure: null, paging: null,
	chosen: null, verifying: null, verdict: null, verifyFailure: null, verified: null,
	checking: null, checked: null, checkFailure: null,
} as const;

/**
 * A new editor context. A save advances the generation and clears candidate,
 * Verify and copy eligibility but keeps the copied receipt and an issued
 * Copy for the same entry, locale and scope. Any identity, locale or scope
 * change also advances the epoch and clears the copied receipt.
 */
export function updateLinkSessionContext(state: LinkSessionState, next: LinkSessionContext): LinkSessionState {
	const context = normalizedContext(next);
	const previous = state.context;
	if (previous === null || !sameScope(previous, context)) {
		return {
			...state, ...CANDIDATE_RESET, context, epoch: state.epoch + 1, generation: state.generation + 1,
			copying: null, copyFailed: false, copied: null,
		};
	}
	if (previous.savedVersion !== context.savedVersion) {
		return { ...state, ...CANDIDATE_RESET, context, generation: state.generation + 1, copyFailed: false };
	}
	return state;
}

function capture(state: LinkSessionState) {
	const id = state.lastOperationId + 1;
	return { id, epoch: state.epoch, generation: state.generation, savedVersion: state.context?.savedVersion ?? null };
}

function failure(error: unknown): LinkTransportFailure {
	const record = typeof error === "object" && error !== null ? error as { name?: unknown; status?: unknown } : {};
	return {
		aborted: record.name === "AbortError",
		status: typeof record.status === "number" && Number.isInteger(record.status) ? record.status : null,
	};
}

// The operation is still the latest of its kind in the same context and saved state.
const currentCandidate = (state: LinkSessionState, operation: OperationBase) =>
	operation.epoch === state.epoch && operation.generation === state.generation && operation.savedVersion === (state.context?.savedVersion ?? null);

export type LinkBegin<T> = { state: LinkSessionState; operation: T } | { state: LinkSessionState; operation: null };

// An issued request is detached from the state and caller and frozen at every
// level, so what was sent and what its answer is checked against cannot drift.
function issued<T>(value: T): T {
	const freeze = (item: unknown): void => {
		if (item === null || typeof item !== "object") return;
		for (const child of Object.values(item)) freeze(child);
		Object.freeze(item);
	};
	const copy = structuredClone(value);
	freeze(copy);
	return copy;
}

// ---------------------------------------------------------------------------
// Find and Next

/** An explicit Find for the current context; it supersedes any paging in flight. */
export function beginLinkFind(state: LinkSessionState): LinkBegin<LinkFindOperation> {
	const context = state.context;
	if (!context || context.savedVersion === null || context.destination === null || canonicalLinkLocale(context.locale) !== context.locale) {
		return { state, operation: null };
	}
	const base = capture(state);
	const operation: LinkFindOperation = Object.freeze({
		...base,
		kind: "find",
		request: issued<LinkFindRequest>({
			source: { collection: context.collection, entryId: context.entryId, locale: context.locale, sourceVersion: context.savedVersion },
			generation: base.generation,
			destination: {
				collection: context.destination.collection,
				taxonomy: context.destination.taxonomy === null ? null : {
					taxonomy: context.destination.taxonomy.taxonomy, termIds: [...context.destination.taxonomy.termIds],
				},
			},
		}),
	});
	return { state: { ...state, lastOperationId: base.id, paging: operation, pageFailure: null }, operation };
}

/** An explicit Next from the current page's receipt; the receipt keeps the original window. */
export function beginLinkNext(state: LinkSessionState): LinkBegin<LinkNextOperation> {
	const receipt = state.page?.receipt;
	if (!receipt || !state.context) return { state, operation: null };
	const base = capture(state);
	const operation: LinkNextOperation = Object.freeze({ ...base, kind: "next", request: issued<LinkNextRequest>({ generation: receipt.generation, receipt }) });
	return { state: { ...state, lastOperationId: base.id, paging: operation, pageFailure: null }, operation };
}

/** A Find or Next completion. A superseded or stale one, success or failure, changes nothing. */
export function settleLinkPaging(state: LinkSessionState, operation: LinkPagingOperation, settlement: LinkSettlement<LinkPageOutcome>): LinkSessionState {
	if (state.paging?.id !== operation.id || !currentCandidate(state, operation)) return state;
	if (!settlement.ok) return { ...state, paging: null, pageFailure: failure(settlement.error) };
	const outcome = settlement.value;
	if (outcome.kind === "result") {
		return {
			...state, paging: null, pageOutcome: null, pageFailure: null,
			page: { response: outcome.response, receipt: outcome.next },
			chosen: null, verifying: null, verdict: null, verifyFailure: null, verified: null,
			...(operation.kind === "find" ? { copyFailed: false } : {}),
		};
	}
	// A failed Find leaves no page. A failed Next keeps the page but ends paging; nothing refetches.
	const page = operation.kind === "next" && state.page ? { response: state.page.response, receipt: null } : null;
	return {
		...state, paging: null, pageOutcome: outcome, pageFailure: null, page,
		...(page === null ? { chosen: null, verifying: null, verdict: null, verifyFailure: null, verified: null } : {}),
	};
}

/** A transport failure keeps the receipt, but no reference-only page may continue from it. */
export function isLinkPageReferenceOnly(state: LinkSessionState): boolean {
	return state.page !== null && (state.pageFailure !== null || state.pageOutcome !== null);
}

// ---------------------------------------------------------------------------
// Choose and Verify

/** Chooses one suggestion of the current page as an immutable submission; any Verify or copy eligibility resets. */
export function chooseLinkSuggestion(state: LinkSessionState, entryId: string): LinkSessionState {
	const response = state.page?.response;
	const suggestion = response?.suggestions.find((item) => item.target.entryId === entryId);
	if (!response || !suggestion) return state;
	const submission = prepareLinkSubmission({ owner: response.owner, policyVersion: response.policyVersion, suggestion });
	if (!submission) return state;
	return { ...state, chosen: submission, verifying: null, verdict: null, verifyFailure: null, verified: null, copyFailed: false };
}

export function beginLinkVerify(state: LinkSessionState): LinkBegin<LinkVerifyOperation> {
	if (!state.chosen || !state.context) return { state, operation: null };
	const base = capture(state);
	const operation: LinkVerifyOperation = Object.freeze({ ...base, kind: "verify", submission: state.chosen });
	return { state: { ...state, lastOperationId: base.id, verifying: operation, verdict: null, verifyFailure: null, verified: null }, operation };
}

/** Only a verified answer for the still-chosen submission grants copy eligibility; anything else clears it. */
export function settleLinkVerify(state: LinkSessionState, operation: LinkVerifyOperation, settlement: LinkSettlement<LinkVerifyOutcome>): LinkSessionState {
	if (state.verifying?.id !== operation.id || state.chosen !== operation.submission || !currentCandidate(state, operation)) return state;
	if (!settlement.ok) return { ...state, verifying: null, verified: null, verifyFailure: failure(settlement.error) };
	const outcome = settlement.value;
	if (outcome.kind === "verification" && outcome.verification.kind === "verified") {
		return {
			...state, verifying: null, verdict: null, verifyFailure: null,
			verified: { submission: operation.submission, url: outcome.verification.url, route: outcome.verification.route },
		};
	}
	return { ...state, verifying: null, verified: null, verifyFailure: null, verdict: outcome };
}

// ---------------------------------------------------------------------------
// Copy and Check

/** One explicit Copy at a time, of the verified URL. The caller writes `operation.url` to the clipboard. */
export function beginLinkCopy(state: LinkSessionState): LinkBegin<LinkCopyOperation> {
	if (!state.verified || state.copying || !state.context) return { state, operation: null };
	const base = capture(state);
	const operation: LinkCopyOperation = Object.freeze({ ...base, kind: "copy", submission: state.verified.submission, url: state.verified.url });
	return { state: { ...state, lastOperationId: base.id, copying: operation, copyFailed: false }, operation };
}

/**
 * The clipboard result of an issued Copy. A save meanwhile does not discard
 * it: success still records the issued request and URL as the copied receipt
 * in the same context, without restoring any cleared candidate state. A
 * context change discards it; failure records no receipt.
 */
export function settleLinkCopy(state: LinkSessionState, operation: LinkCopyOperation, copied: boolean): LinkSessionState {
	if (state.copying?.id !== operation.id || operation.epoch !== state.epoch) return state;
	if (!copied) return { ...state, copying: null, copyFailed: true };
	const receipt: LinkCopiedReceipt = Object.freeze({ id: operation.id, epoch: operation.epoch, submission: operation.submission, url: operation.url });
	return { ...state, copying: null, copyFailed: false, copied: receipt, checking: null, checked: null, checkFailure: null };
}

/** An explicit Check of the copied receipt's original request against the newer saved source. */
export function beginLinkCheck(state: LinkSessionState): LinkBegin<LinkCheckOperation> {
	const copied = state.copied;
	if (!copied || !state.context) return { state, operation: null };
	const base = capture(state);
	const operation: LinkCheckOperation = Object.freeze({ ...base, kind: "check", receiptId: copied.id, submission: copied.submission });
	return { state: { ...state, lastOperationId: base.id, checking: operation, checked: null, checkFailure: null }, operation };
}

/** Recorded only for the same receipt, epoch and operation, and while the saved version seen at Check start is still current. */
export function settleLinkCheck(state: LinkSessionState, operation: LinkCheckOperation, settlement: LinkSettlement<LinkCheckOutcome>): LinkSessionState {
	if (state.checking?.id !== operation.id || state.copied?.id !== operation.receiptId || operation.epoch !== state.epoch ||
		(state.context?.savedVersion ?? null) !== operation.savedVersion) return state;
	if (!settlement.ok) return { ...state, checking: null, checkFailure: failure(settlement.error) };
	return { ...state, checking: null, checkFailure: null, checked: { receiptId: operation.receiptId, outcome: settlement.value } };
}
