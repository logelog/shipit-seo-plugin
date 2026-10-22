// State rules for the llms.txt editor. The plugin route owns the stored record
// and its revision; this module decides what the editor may show and send. It
// has no React, DOM or host imports, so a sandbox editor can reuse it.
import type { SeoAdminLlmsTxt, SeoAdminLlmsTxtWriteResult } from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	LLMS_TXT_DOCUMENT_MAX_BYTES,
	LLMS_TXT_WRITE_REQUEST_MAX_BYTES,
	checkLlmsTxtActivation,
	checkLlmsTxtDocument,
	llmsTxtUtf8Bytes,
	type LlmsTxtObservationExpectation,
} from "../llms-txt-document.ts";

// ---- Draft ----------------------------------------------------------------

/** What a textarea can hold: it reports every CR and CRLF as LF. */
export function llmsTxtEditorText(stored: string): string {
	return stored.replace(/\r\n?/g, "\n");
}

/**
 * The editor's own draft: the raw text it started from and the textarea value.
 * It is independent of later reads of the stored record, so a reload cannot
 * change the bytes a save would send; only an initial load, an explicit
 * discard, a confirmed save or a reset starts a new basis.
 */
export interface LlmsTxtDraft {
	basis: string;
	editorValue: string;
}

export function llmsTxtDraftFrom(raw: string): LlmsTxtDraft {
	return { basis: raw, editorValue: llmsTxtEditorText(raw) };
}

/**
 * The text a save sends. While the textarea still shows the basis, the raw
 * basis is kept, so CR, CRLF and every other byte survive; any edit sends the
 * textarea's LF text.
 */
export function llmsTxtDraftText(draft: LlmsTxtDraft): string {
	return draft.editorValue === llmsTxtEditorText(draft.basis) ? draft.basis : draft.editorValue;
}

/** Compares the bytes a save would send with the latest stored bytes. */
export function llmsTxtDraftDirty(draft: LlmsTxtDraft, stored: string): boolean {
	return llmsTxtDraftText(draft) !== stored;
}

/** An edit of a CR or CRLF basis saves LF line ends, which needs explicit consent. */
export function llmsTxtLineEndConsentNeeded(draft: LlmsTxtDraft): boolean {
	return draft.basis.includes("\r") && llmsTxtDraftText(draft) !== draft.basis;
}

export function llmsTxtLineEnds(text: string): { lf: number; crlf: number; cr: number } {
	let lf = 0;
	let crlf = 0;
	let cr = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] === "\r") {
			if (text[index + 1] === "\n") {
				crlf += 1;
				index += 1;
			} else cr += 1;
		} else if (text[index] === "\n") lf += 1;
	}
	return { lf, crlf, cr };
}

export function llmsTxtStartsWithBom(text: string): boolean {
	return text.charCodeAt(0) === 0xfeff;
}

/** The exact save request and its UTF-8 size, measured before anything is sent. */
export function llmsTxtSaveRequest(expectedRevision: string | null, text: string): { body: string; bytes: number } {
	const body = JSON.stringify({ expectedRevision, text });
	return { body, bytes: llmsTxtUtf8Bytes(body) };
}

export type LlmsTxtSegment =
	| { kind: "text"; text: string }
	| { kind: "space"; text: string }
	| { kind: "eol"; text: string; label: "LF" | "CRLF" | "CR" }
	| { kind: "mark"; text: string; label: string };

const INVISIBLE_LABELS: Record<string, string> = {
	"\ufeff": "U+FEFF",
	"\u00a0": "NBSP",
	"\u200b": "U+200B",
};

/** Splits text for the visible-whitespace preview; joining every segment's text gives the input back. */
export function llmsTxtSegments(text: string): LlmsTxtSegment[] {
	const segments: LlmsTxtSegment[] = [];
	const pattern = /(\r\n|\r|\n|[ \t]+|[\ufeff\u00a0\u200b])/g;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > last) segments.push({ kind: "text", text: text.slice(last, match.index) });
		const piece = match[0];
		if (piece === "\n" || piece === "\r\n" || piece === "\r") {
			segments.push({ kind: "eol", text: piece, label: piece === "\n" ? "LF" : piece === "\r\n" ? "CRLF" : "CR" });
		} else if (/^[ \t]+$/.test(piece)) segments.push({ kind: "space", text: piece });
		else segments.push({ kind: "mark", text: piece, label: INVISIBLE_LABELS[piece] });
		last = match.index + piece.length;
	}
	if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
	return segments;
}

// ---- Request failures -----------------------------------------------------

export type LlmsTxtRequestFailure =
	| { type: "response"; status: number; code: string; message: string }
	| { type: "malformed"; detail: string }
	| { type: "transport"; message: string };

export type LlmsTxtReadProblem = "unauthorized" | "denied" | "not-found" | "refused" | "service" | "malformed" | "network";

export function llmsTxtReadProblem(failure: LlmsTxtRequestFailure): LlmsTxtReadProblem {
	if (failure.type === "malformed") return "malformed";
	if (failure.type === "transport") return "network";
	if (failure.status === 401) return "unauthorized";
	if (failure.status === 403 && failure.code === "FORBIDDEN") return "denied";
	if (failure.status === 404) return "not-found";
	return failure.status >= 400 && failure.status < 500 ? "refused" : "service";
}

export type LlmsTxtWriteRejection = "unauthorized" | "denied" | "too-large" | "invalid-request" | "not-found" | "refused";

/**
 * EmDash answers a 4xx before the route handler runs: authentication, the
 * permission, CSRF, the body limit and input validation. A 5xx, a lost
 * response or an unreadable body may follow a committed write.
 */
export function llmsTxtWriteFailure(failure: LlmsTxtRequestFailure): { kind: "rejected"; problem: LlmsTxtWriteRejection } | { kind: "uncertain" } {
	if (failure.type !== "response" || failure.status < 400 || failure.status >= 500) return { kind: "uncertain" };
	if (failure.status === 401) return { kind: "rejected", problem: "unauthorized" };
	if (failure.status === 403 && failure.code === "FORBIDDEN") return { kind: "rejected", problem: "denied" };
	if (failure.status === 413) return { kind: "rejected", problem: "too-large" };
	if (failure.status === 400) return { kind: "rejected", problem: "invalid-request" };
	if (failure.status === 404) return { kind: "rejected", problem: "not-found" };
	return { kind: "rejected", problem: "refused" };
}

// ---- Writes ---------------------------------------------------------------

export type LlmsTxtPortResult<T> = { ok: true; value: T } | { ok: false; failure: LlmsTxtRequestFailure };

/** The plugin routes as the editor uses them. */
export interface LlmsTxtPort {
	read(): Promise<LlmsTxtPortResult<SeoAdminLlmsTxt>>;
	save(body: string): Promise<LlmsTxtPortResult<SeoAdminLlmsTxtWriteResult>>;
	setEnabled(expectedRevision: string, enabled: boolean): Promise<LlmsTxtPortResult<SeoAdminLlmsTxtWriteResult>>;
	reset(expectedRevision: string): Promise<LlmsTxtPortResult<SeoAdminLlmsTxtWriteResult>>;
}

export type LlmsTxtOperation =
	| { kind: "save"; base: SeoAdminLlmsTxt; text: string }
	| { kind: "output"; base: SeoAdminLlmsTxt & { revision: string }; enabled: boolean }
	| { kind: "reset"; base: SeoAdminLlmsTxt & { revision: string } };

/**
 * What one reload after an uncertain write shows. It describes the stored
 * record now, not what happened to the write: another editor can store the
 * same value, or put the previous one back after a write that was applied.
 */
export type LlmsTxtUncertainOutcome = "sent-value" | "previous-value" | "other-value";

export function llmsTxtUncertainOutcome(operation: LlmsTxtOperation, now: SeoAdminLlmsTxt): LlmsTxtUncertainOutcome {
	const base = operation.base;
	if (now.state === base.state && now.revision === base.revision) return "previous-value";
	if (operation.kind === "reset") return now.state === "absent" ? "sent-value" : "other-value";
	if (now.state !== "stored") return "other-value";
	if (operation.kind === "save") return now.text === operation.text && now.enabled === base.enabled ? "sent-value" : "other-value";
	return now.enabled === operation.enabled && now.text === base.text ? "sent-value" : "other-value";
}

export type LlmsTxtWriteOutcome =
	/** The route answered success; `changed` is false when the record already held this value. */
	| { status: "stored"; state: SeoAdminLlmsTxt; changed: boolean }
	/** The route read the record and refused before writing; nothing was written. */
	| { status: "refused"; reason: "conflict" | "invalid" | "blocked" | "unavailable"; message: string; field?: "text" }
	/** EmDash refused the request before the route ran; nothing was written. */
	| { status: "rejected"; problem: LlmsTxtWriteRejection; failure: LlmsTxtRequestFailure }
	/** The request would exceed the declared body limit, so it was not sent. */
	| { status: "not-sent"; bytes: number }
	/**
	 * The write may have been applied; the editor reloaded once to find out. A
	 * reload answering "unavailable" read no record, so it settles nothing.
	 */
	| { status: "uncertain"; failure: LlmsTxtRequestFailure; reload: { ok: true; state: SeoAdminLlmsTxt; outcome: LlmsTxtUncertainOutcome } | { ok: false; problem: LlmsTxtReadProblem | "record-unavailable" } };

/**
 * One revision-checked write. A conflict, a refusal and an uncertain result
 * never retry, overwrite or roll back; an uncertain result is followed by one
 * authoritative read, and the editor must not write again until a read succeeds.
 */
export async function runLlmsTxtWrite(port: LlmsTxtPort, operation: LlmsTxtOperation): Promise<LlmsTxtWriteOutcome> {
	let result: LlmsTxtPortResult<SeoAdminLlmsTxtWriteResult>;
	if (operation.kind === "save") {
		const request = llmsTxtSaveRequest(operation.base.revision, operation.text);
		if (request.bytes > LLMS_TXT_WRITE_REQUEST_MAX_BYTES) return { status: "not-sent", bytes: request.bytes };
		result = await port.save(request.body);
	} else if (operation.kind === "output") {
		result = await port.setEnabled(operation.base.revision, operation.enabled);
	} else {
		result = await port.reset(operation.base.revision);
	}
	if (result.ok) {
		const value = result.value;
		return value.success
			? { status: "stored", state: value.llms, changed: value.changed }
			: { status: "refused", reason: value.reason, message: value.message, ...(value.field ? { field: value.field } : {}) };
	}
	const failure = llmsTxtWriteFailure(result.failure);
	if (failure.kind === "rejected") return { status: "rejected", problem: failure.problem, failure: result.failure };
	const reload = await port.read();
	if (!reload.ok) return { status: "uncertain", failure: result.failure, reload: { ok: false, problem: llmsTxtReadProblem(reload.failure) } };
	if (!llmsTxtAuthoritative(reload.value)) return { status: "uncertain", failure: result.failure, reload: { ok: false, problem: "record-unavailable" } };
	return { status: "uncertain", failure: result.failure, reload: { ok: true, state: reload.value, outcome: llmsTxtUncertainOutcome(operation, reload.value) } };
}

/**
 * A read that returned the record (or its absence). "unavailable" means the
 * route could not read it, so it cannot settle an uncertain write or a conflict.
 */
export function llmsTxtAuthoritative(state: SeoAdminLlmsTxt): boolean {
	return state.state !== "unavailable";
}

// ---- Blockers -------------------------------------------------------------

export type LlmsTxtBlocker =
	| "loading"
	| "unavailable"
	| "corrupt"
	| "owner"
	| "storage"
	| "uncertain"
	| "reload-required"
	| "busy"
	| "document"
	| "activation"
	| "line-ends"
	| "unchanged"
	| "unsaved"
	| "no-document";

export interface LlmsTxtEditorFlags {
	state: SeoAdminLlmsTxt | null;
	/** An uncertain write whose authoritative reload has not succeeded yet. */
	uncertain: boolean;
	/** A conflict or unreadable record was reported; only a reload clears it. */
	reloadRequired: boolean;
	busy: boolean;
}

function commonBlockers(flags: LlmsTxtEditorFlags): LlmsTxtBlocker[] {
	const state = flags.state;
	if (!state) return ["loading"];
	const blockers: LlmsTxtBlocker[] = [];
	if (state.state === "unavailable") blockers.push("unavailable");
	if (state.state === "corrupt") blockers.push("corrupt");
	if (state.owner !== "shipit") blockers.push("owner");
	if (!state.conditionalStorage) blockers.push("storage");
	if (flags.uncertain) blockers.push("uncertain");
	if (flags.reloadRequired) blockers.push("reload-required");
	if (flags.busy) blockers.push("busy");
	return blockers;
}

/** The stored raw text the draft is compared with: empty for an absent record. */
export function llmsTxtStoredText(state: SeoAdminLlmsTxt | null): string {
	return state?.state === "stored" ? state.text ?? "" : "";
}

/**
 * Reasons Save is off now. The route checks owner, revision, document and H1
 * again; these keep the editor from sending what it would refuse.
 */
export function llmsTxtSaveBlockers(flags: LlmsTxtEditorFlags & { draft: LlmsTxtDraft; lineEndsAccepted: boolean }): LlmsTxtBlocker[] {
	const blockers = commonBlockers(flags);
	if (!flags.state) return blockers;
	const text = llmsTxtDraftText(flags.draft);
	if (!checkLlmsTxtDocument(text).ok) blockers.push("document");
	else if (flags.state.enabled && !checkLlmsTxtActivation(text).ok) blockers.push("activation");
	if (llmsTxtLineEndConsentNeeded(flags.draft) && !flags.lineEndsAccepted) blockers.push("line-ends");
	if (!llmsTxtDraftDirty(flags.draft, llmsTxtStoredText(flags.state))) blockers.push("unchanged");
	return blockers;
}

/** Reasons the output switch cannot move to `enabled` now; it acts on the stored text, so a draft must be saved first. */
export function llmsTxtOutputBlockers(flags: LlmsTxtEditorFlags & { draft: LlmsTxtDraft; enabled: boolean }): LlmsTxtBlocker[] {
	const blockers = commonBlockers(flags);
	const state = flags.state;
	if (!state) return blockers;
	if (llmsTxtDraftDirty(flags.draft, llmsTxtStoredText(state))) blockers.push("unsaved");
	if (state.state === "absent") blockers.push("no-document");
	if (state.state === "stored" && flags.enabled && !checkLlmsTxtActivation(state.text).ok) blockers.push("activation");
	if (state.state === "stored" && state.enabled === flags.enabled) blockers.push("unchanged");
	return blockers;
}

export type LlmsTxtResetBlocker = Exclude<LlmsTxtBlocker, "corrupt"> | "not-corrupt" | "no-copy" | "copy-not-saved";

/**
 * Reasons the confirmed reset cannot be sent now: everything that stops other
 * writes, an uncertain or unreloaded earlier write included, plus a record
 * that is not invalid, a copy that was not offered, or not downloaded here.
 */
export function llmsTxtResetBlockers(flags: LlmsTxtEditorFlags & { copySaved: boolean }): LlmsTxtResetBlocker[] {
	const blockers: LlmsTxtResetBlocker[] = [];
	for (const blocker of commonBlockers(flags)) if (blocker !== "corrupt") blockers.push(blocker);
	const state = flags.state;
	if (!state) return blockers;
	if (state.state !== "corrupt" || state.revision === null) blockers.push("not-corrupt");
	else if (state.corrupt?.copy === null || state.corrupt?.copy === undefined) blockers.push("no-copy");
	if (!flags.copySaved) blockers.push("copy-not-saved");
	return blockers;
}

/** Whether the text box accepts edits. It is read-only while a write or reload is in flight. */
export function llmsTxtEditable(flags: LlmsTxtEditorFlags): boolean {
	return commonBlockers(flags).filter((blocker) => blocker !== "reload-required").length === 0;
}

// ---- Observation ----------------------------------------------------------

/** Bytes read from an observed /llms.txt: the largest valid document. A longer body is not verified. */
export const LLMS_TXT_OBSERVATION_MAX_BYTES = LLMS_TXT_DOCUMENT_MAX_BYTES;

/**
 * What the origin answers for an authoritative stored state while Shipit owns
 * the file. Without an owner or a readable record nothing is predicted.
 */
export function llmsTxtObservationExpectation(state: SeoAdminLlmsTxt): LlmsTxtObservationExpectation {
	if (state.owner !== "shipit" || !llmsTxtAuthoritative(state)) return { kind: "none" };
	if (state.state === "corrupt") return { kind: "status", status: 503 };
	if (state.state === "stored" && state.enabled) return { kind: "text", text: state.text ?? "" };
	return { kind: "status", status: 404 };
}

/**
 * Reads at most `maxBytes` of a response body as strict UTF-8, keeping a
 * leading byte order mark, which `Response.text()` strips. Bytes that are not
 * UTF-8 are reported as invalid instead of becoming U+FFFD, so they can never
 * match stored text. The stream is cancelled and released on every path.
 */
export async function readLlmsTxtObservationBody(
	body: ReadableStream<Uint8Array> | null,
	maxBytes: number = LLMS_TXT_OBSERVATION_MAX_BYTES,
): Promise<{ text: string; bytes: number; truncated: boolean; invalidEncoding: boolean }> {
	if (!body) return { text: "", bytes: 0, truncated: false, invalidEncoding: false };
	const reader = body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	let text = "";
	let bytes = 0;
	let finished = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				finished = true;
				return { text: text + decoder.decode(), bytes, truncated: false, invalidEncoding: false };
			}
			if (bytes + value.byteLength > maxBytes) {
				// The cut can split a character; only the end of the stream decides validity.
				return { text: text + decoder.decode(value.subarray(0, maxBytes - bytes), { stream: true }), bytes: maxBytes, truncated: true, invalidEncoding: false };
			}
			bytes += value.byteLength;
			text += decoder.decode(value, { stream: true });
		}
	} catch (error) {
		if (error instanceof TypeError) return { text: "", bytes, truncated: false, invalidEncoding: true };
		throw error;
	} finally {
		if (!finished) await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

/**
 * Whether the public check may run now: never during a write or reload, and
 * never while an earlier write is uncertain or a conflict awaits a reload,
 * because the loaded state may no longer describe the record.
 */
export function llmsTxtObservationAllowed(flags: LlmsTxtEditorFlags): boolean {
	return flags.state !== null && !flags.busy && !flags.uncertain && !flags.reloadRequired;
}

/** The origin answer the stored state predicts; null unless Shipit owns the file and the record was read. */
export function llmsTxtExpectedAnswer(state: SeoAdminLlmsTxt): 200 | 404 | 503 | null {
	const expectation = llmsTxtObservationExpectation(state);
	return expectation.kind === "none" ? null : expectation.kind === "text" ? 200 : expectation.status;
}
