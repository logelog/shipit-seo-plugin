import assert from "node:assert/strict";
import { SEO_ADMIN_CONTRACT_VERSION, SEO_ENGINE_VERSION, type SeoAdminLlmsTxt, type SeoAdminLlmsTxtWriteResult } from "@shipitseo/emdash-plugin-seo/admin-contract";

import { LLMS_TXT_DOCUMENT_MAX_BYTES } from "../llms-txt-document.ts";
import {
	llmsTxtAuthoritative,
	llmsTxtDraftDirty,
	llmsTxtDraftFrom,
	llmsTxtDraftText,
	llmsTxtEditable,
	llmsTxtEditorText,
	llmsTxtExpectedAnswer,
	llmsTxtLineEndConsentNeeded,
	llmsTxtLineEnds,
	llmsTxtObservationAllowed,
	llmsTxtObservationExpectation,
	llmsTxtOutputBlockers,
	llmsTxtReadProblem,
	llmsTxtResetBlockers,
	llmsTxtSaveBlockers,
	llmsTxtSaveRequest,
	llmsTxtSegments,
	llmsTxtUncertainOutcome,
	llmsTxtWriteFailure,
	readLlmsTxtObservationBody,
	runLlmsTxtWrite,
	type LlmsTxtDraft,
	type LlmsTxtPort,
	type LlmsTxtPortResult,
	type LlmsTxtRequestFailure,
} from "./llms-txt-model.ts";

const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const REPLACEMENT = String.fromCharCode(0xfffd);

function llms(patch: Partial<SeoAdminLlmsTxt> = {}): SeoAdminLlmsTxt {
	const text = patch.text === undefined ? "# Site\n" : patch.text;
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, owner: "shipit", ownerDetail: null, hostVersion: "1.1.0",
		conditionalStorage: true, state: "stored", revision: "r1", enabled: false, text,
		bytes: text === null ? null : new TextEncoder().encode(text).byteLength, corrupt: null,
		limits: { documentBytes: 131072, requestBytes: 1048576 }, path: "/llms.txt", cacheControl: "public, max-age=300",
		...patch,
	};
}
const absent = () => llms({ state: "absent", revision: null, text: null, bytes: null });
const corrupt = (copy: string | null = "{\"version\":2}") => llms({
	state: "corrupt", revision: "r9", text: null, bytes: null,
	corrupt: { reason: "unsupported-version", detail: "The stored version is 2.", copy, copyBytes: copy === null ? 2_000_000 : copy.length },
});
const unavailable = () => llms({ state: "unavailable", revision: null, text: null, bytes: null });
const flags = { uncertain: false, reloadRequired: false, busy: false };

// ---- Draft basis and line ends ------------------------------------------------

assert.equal(llmsTxtEditorText("# A\r\nb\rc\n"), "# A\nb\nc\n");
const crlf = llmsTxtDraftFrom("# A\r\nlist\r\n");
assert.deepEqual(crlf, { basis: "# A\r\nlist\r\n", editorValue: "# A\nlist\n" });
assert.equal(llmsTxtDraftText(crlf), "# A\r\nlist\r\n", "an unedited draft keeps the raw bytes");
assert.equal(llmsTxtDraftDirty(crlf, "# A\r\nlist\r\n"), false);
assert.equal(llmsTxtLineEndConsentNeeded(crlf), false);
const edited: LlmsTxtDraft = { ...crlf, editorValue: "# A\nlist two\n" };
assert.equal(llmsTxtDraftText(edited), "# A\nlist two\n");
assert.equal(llmsTxtLineEndConsentNeeded(edited), true, "an edit of CRLF text saves LF and needs consent");
assert.equal(llmsTxtDraftText({ ...edited, editorValue: "# A\nlist\n" }), "# A\r\nlist\r\n", "undoing the edit restores the raw basis");
assert.equal(llmsTxtDraftText(llmsTxtDraftFrom(`${BOM}# A`)), `${BOM}# A`, "a leading BOM stays in the draft");
assert.deepEqual(llmsTxtLineEnds("a\r\nb\rc\nd\r\n"), { lf: 1, crlf: 2, cr: 1 });

// Concurrent same-visible changes: the retained draft never silently becomes the reloaded bytes.
const consented: LlmsTxtDraft = { basis: "# A\r\n", editorValue: "# B\n" };
assert.equal(llmsTxtDraftText(consented), "# B\n");
assert.equal(llmsTxtDraftDirty(consented, "# B\r\n"), true, "another actor's CRLF version differs from the LF draft");
assert.equal(llmsTxtLineEndConsentNeeded(consented), true);
const lfBasis = llmsTxtDraftFrom("# A\n");
assert.equal(llmsTxtDraftDirty(lfBasis, "# A\r\n"), true, "a CRLF rewrite elsewhere is a change from the LF draft");
assert.equal(llmsTxtLineEndConsentNeeded(lfBasis), false);
assert.equal(llmsTxtDraftDirty(crlf, "# A\nlist\n"), true, "an LF rewrite elsewhere is a change from the CRLF draft");

// ---- Save, output and reset blockers -------------------------------------------

const saveBlockers = (state: SeoAdminLlmsTxt | null, draft: LlmsTxtDraft, patch: Partial<typeof flags & { lineEndsAccepted: boolean }> = {}) =>
	llmsTxtSaveBlockers({ state, draft, lineEndsAccepted: false, ...flags, ...patch });
assert.deepEqual(saveBlockers(llms(), llmsTxtDraftFrom("# Site\n")), ["unchanged"]);
assert.deepEqual(saveBlockers(llms(), { basis: "# Site\n", editorValue: "# Site two\n" }), []);
assert.deepEqual(saveBlockers(llms(), { basis: "# Site\n", editorValue: "no heading" }), [], "a disabled draft needs no H1");
assert.deepEqual(saveBlockers(llms({ enabled: true }), { basis: "# Site\n", editorValue: "no heading" }), ["activation"]);
assert.deepEqual(saveBlockers(llms(), { basis: "# Site\n", editorValue: `# A${String.fromCharCode(0)}` }), ["document"]);
assert.deepEqual(saveBlockers(llms(), { basis: "# Site\n", editorValue: `# A\n${"a".repeat(LLMS_TXT_DOCUMENT_MAX_BYTES)}` }), ["document"]);
assert.deepEqual(saveBlockers(llms({ text: "# A\r\n" }), { basis: "# A\r\n", editorValue: "# B\n" }), ["line-ends"]);
assert.deepEqual(saveBlockers(llms({ text: "# A\r\n" }), { basis: "# A\r\n", editorValue: "# B\n" }, { lineEndsAccepted: true }), []);
assert.deepEqual(saveBlockers(llms({ owner: "competing-route" }), { basis: "# Site\n", editorValue: "# B" }), ["owner"]);
assert.deepEqual(saveBlockers(llms({ conditionalStorage: false }), { basis: "# Site\n", editorValue: "# B" }), ["storage"]);
assert.deepEqual(saveBlockers(llms(), { basis: "# Site\n", editorValue: "# B" }, { uncertain: true, reloadRequired: true, busy: true }), ["uncertain", "reload-required", "busy"]);
assert.deepEqual(saveBlockers(absent(), llmsTxtDraftFrom("")), ["unchanged"]);
assert.deepEqual(saveBlockers(absent(), { basis: "", editorValue: "draft without heading" }), []);
assert.ok(saveBlockers(corrupt(), llmsTxtDraftFrom("")).includes("corrupt"));
assert.ok(saveBlockers(unavailable(), llmsTxtDraftFrom("")).includes("unavailable"));
assert.deepEqual(saveBlockers(null, llmsTxtDraftFrom("")), ["loading"]);

const outputBlockers = (state: SeoAdminLlmsTxt, enabled: boolean, draft = llmsTxtDraftFrom(state.text ?? ""), patch: Partial<typeof flags> = {}) =>
	llmsTxtOutputBlockers({ state, draft, enabled, ...flags, ...patch });
assert.deepEqual(outputBlockers(llms(), true), []);
assert.deepEqual(outputBlockers(llms({ text: "no heading" }), true), ["activation"]);
assert.deepEqual(outputBlockers(llms({ enabled: true }), false), []);
assert.deepEqual(outputBlockers(llms({ enabled: true }), true), ["unchanged"]);
assert.deepEqual(outputBlockers(llms(), true, { basis: "# Site\n", editorValue: "# Other\n" }), ["unsaved"], "output acts on the stored text only");
assert.deepEqual(outputBlockers(absent(), true), ["no-document"]);
assert.deepEqual(outputBlockers(llms(), true, undefined, { uncertain: true }), ["uncertain"]);

const resetBlockers = (state: SeoAdminLlmsTxt, copySaved: boolean, patch: Partial<typeof flags> = {}) =>
	llmsTxtResetBlockers({ state, copySaved, ...flags, ...patch });
assert.deepEqual(resetBlockers(corrupt(), true), []);
assert.deepEqual(resetBlockers(corrupt(), false), ["copy-not-saved"]);
assert.deepEqual(resetBlockers(corrupt(null), true), ["no-copy"]);
assert.deepEqual(resetBlockers(llms(), true), ["not-corrupt"]);
assert.deepEqual(resetBlockers(corrupt(), true, { uncertain: true }), ["uncertain"], "a lost reset response blocks another reset until a reload");
assert.deepEqual(resetBlockers(corrupt(), true, { reloadRequired: true, busy: true }), ["reload-required", "busy"]);
assert.deepEqual(resetBlockers(llms({ ...corrupt(), owner: "unknown" }), true), ["owner"]);
assert.deepEqual(resetBlockers(llms({ ...corrupt(), conditionalStorage: false }), true), ["storage"]);

assert.equal(llmsTxtEditable({ state: llms(), ...flags }), true);
assert.equal(llmsTxtEditable({ state: llms(), ...flags, reloadRequired: true }), true, "the retained draft stays editable while a reload is pending");
assert.equal(llmsTxtEditable({ state: llms(), ...flags, uncertain: true }), false);
assert.equal(llmsTxtEditable({ state: unavailable(), ...flags }), false);

// ---- Failure classes ------------------------------------------------------------

const response = (status: number, code = "X"): LlmsTxtRequestFailure => ({ type: "response", status, code, message: "" });
assert.deepEqual([401, 403, 404, 400, 413, 500].map((status) => llmsTxtReadProblem(response(status, status === 403 ? "FORBIDDEN" : "X"))),
	["unauthorized", "denied", "not-found", "refused", "refused", "service"]);
assert.equal(llmsTxtReadProblem(response(403, "CSRF_REJECTED")), "refused");
assert.deepEqual([401, 403, 413, 400, 404, 409].map((status) => llmsTxtWriteFailure(response(status, status === 403 ? "FORBIDDEN" : "X"))),
	[{ kind: "rejected", problem: "unauthorized" }, { kind: "rejected", problem: "denied" }, { kind: "rejected", problem: "too-large" },
		{ kind: "rejected", problem: "invalid-request" }, { kind: "rejected", problem: "not-found" }, { kind: "rejected", problem: "refused" }]);
for (const failure of [response(500), response(502), { type: "transport", message: "lost" }, { type: "malformed", detail: "x" }] as LlmsTxtRequestFailure[]) {
	assert.deepEqual(llmsTxtWriteFailure(failure), { kind: "uncertain" });
}

// ---- One write, no retry, one authoritative reload after an uncertain result ----

function port(script: { write?: LlmsTxtPortResult<SeoAdminLlmsTxtWriteResult>; reads?: LlmsTxtPortResult<SeoAdminLlmsTxt>[] }) {
	const log: string[] = [];
	const reads = [...(script.reads ?? [])];
	const value: LlmsTxtPort = {
		read: async () => { log.push("read"); return reads.shift() ?? { ok: false, failure: { type: "transport", message: "no script" } }; },
		save: async (body) => { log.push(`save ${body}`); return script.write!; },
		setEnabled: async (revision, enabled) => { log.push(`output ${revision} ${enabled}`); return script.write!; },
		reset: async (revision) => { log.push(`reset ${revision}`); return script.write!; },
	};
	return { port: value, log };
}
const lost: LlmsTxtPortResult<SeoAdminLlmsTxtWriteResult> = { ok: false, failure: { type: "transport", message: "lost" } };
const base = llms({ text: "# A\r\n" });

const stored = port({ write: { ok: true, value: { success: true, changed: true, llms: llms({ revision: "r2", text: "# B\n" }) } } });
assert.deepEqual(await runLlmsTxtWrite(stored.port, { kind: "save", base, text: "# B\n" }),
	{ status: "stored", state: llms({ revision: "r2", text: "# B\n" }), changed: true });
assert.deepEqual(stored.log, [`save {"expectedRevision":"r1","text":"# B\\n"}`]);

const conflict = port({ write: { ok: true, value: { success: false, reason: "conflict", message: "changed" } } });
assert.deepEqual(await runLlmsTxtWrite(conflict.port, { kind: "save", base, text: "# B\n" }), { status: "refused", reason: "conflict", message: "changed" });
assert.equal(conflict.log.length, 1, "a conflict is neither retried nor followed by a write");

const denied = port({ write: { ok: false, failure: response(403, "FORBIDDEN") } });
assert.equal((await runLlmsTxtWrite(denied.port, { kind: "output", base: { ...base, revision: "r1" }, enabled: true })).status, "rejected");
assert.deepEqual(denied.log, ["output r1 true"]);

const tooLarge = port({});
const huge = await runLlmsTxtWrite(tooLarge.port, { kind: "save", base, text: String.fromCharCode(1).repeat(200_000) });
assert.equal(huge.status, "not-sent");
assert.deepEqual(tooLarge.log, [], "an oversized request is not sent");
assert.equal(llmsTxtSaveRequest(null, `${BOM}# A`).body, JSON.stringify({ expectedRevision: null, text: `${BOM}# A` }));

const appliedElsewhere = port({ write: lost, reads: [{ ok: true, value: llms({ revision: "r2", text: "# B\n" }) }] });
const applied = await runLlmsTxtWrite(appliedElsewhere.port, { kind: "save", base, text: "# B\n" });
assert.ok(applied.status === "uncertain" && applied.reload.ok && applied.reload.outcome === "sent-value");
assert.deepEqual(appliedElsewhere.log.slice(1), ["read"], "exactly one authoritative read, no retry");
const unchanged = await runLlmsTxtWrite(port({ write: lost, reads: [{ ok: true, value: base }] }).port, { kind: "save", base, text: "# B\n" });
assert.ok(unchanged.status === "uncertain" && unchanged.reload.ok && unchanged.reload.outcome === "previous-value");
const other = await runLlmsTxtWrite(port({ write: lost, reads: [{ ok: true, value: llms({ revision: "r3", text: "# B\r\n" }) }] }).port, { kind: "save", base, text: "# B\n" });
assert.ok(other.status === "uncertain" && other.reload.ok && other.reload.outcome === "other-value", "same visible text with CRLF is another value");
const failed = await runLlmsTxtWrite(port({ write: lost, reads: [{ ok: false, failure: response(500) }] }).port, { kind: "save", base, text: "# B\n" });
assert.deepEqual(failed.status === "uncertain" && failed.reload, { ok: false, problem: "service" });
const unreadable = await runLlmsTxtWrite(port({ write: lost, reads: [{ ok: true, value: unavailable() }] }).port, { kind: "save", base, text: "# B\n" });
assert.deepEqual(unreadable.status === "uncertain" && unreadable.reload, { ok: false, problem: "record-unavailable" }, "an unavailable answer settles nothing");
assert.equal(llmsTxtAuthoritative(unavailable()), false);
assert.equal(llmsTxtAuthoritative(corrupt()), true);
assert.equal(llmsTxtUncertainOutcome({ kind: "reset", base: { ...corrupt(), revision: "r9" } }, absent()), "sent-value");
assert.equal(llmsTxtUncertainOutcome({ kind: "reset", base: { ...corrupt(), revision: "r9" } }, corrupt()), "previous-value");
assert.equal(llmsTxtUncertainOutcome({ kind: "output", base: { ...base, revision: "r1" }, enabled: true }, llms({ revision: "r2", text: "# A\r\n", enabled: true })), "sent-value");
assert.equal(llmsTxtUncertainOutcome({ kind: "output", base: { ...base, revision: "r1" }, enabled: true }, llms({ revision: "r2", text: "# A\n", enabled: true })), "other-value");

// ---- Observation ---------------------------------------------------------------

assert.deepEqual(llmsTxtObservationExpectation(llms({ enabled: true, text: `${BOM}# A` })), { kind: "text", text: `${BOM}# A` });
assert.deepEqual(llmsTxtObservationExpectation(llms()), { kind: "status", status: 404 });
assert.deepEqual(llmsTxtObservationExpectation(absent()), { kind: "status", status: 404 });
assert.deepEqual(llmsTxtObservationExpectation(corrupt()), { kind: "status", status: 503 });
assert.deepEqual(llmsTxtObservationExpectation(unavailable()), { kind: "none" }, "nothing is predicted from an unread record");
assert.deepEqual(llmsTxtObservationExpectation(llms({ enabled: true, owner: "unknown" })), { kind: "none" });
assert.deepEqual([llms({ enabled: true }), llms(), corrupt(), unavailable(), llms({ enabled: true, owner: "static-file" })].map(llmsTxtExpectedAnswer), [200, 404, 503, null, null]);
assert.equal(llmsTxtObservationAllowed({ state: llms(), ...flags }), true);
for (const patch of [{ busy: true }, { uncertain: true }, { reloadRequired: true }]) {
	assert.equal(llmsTxtObservationAllowed({ state: llms(), ...flags, ...patch }), false, JSON.stringify(patch));
}
assert.equal(llmsTxtObservationAllowed({ state: null, ...flags }), false);

function stream(chunks: number[][], onCancel?: () => void): ReadableStream<Uint8Array> {
	let index = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index < chunks.length) controller.enqueue(new Uint8Array(chunks[index++]));
			else controller.close();
		},
		cancel() { onCancel?.(); },
	});
}
const bytes = (text: string) => [...new TextEncoder().encode(text)];
const bomAndText = [0xef, 0xbb, 0xbf, ...bytes("# Ü")];
// A BOM and a two-byte character split across chunks decode exactly, BOM kept.
const split = await readLlmsTxtObservationBody(stream([bomAndText.slice(0, 2), bomAndText.slice(2, 5), bomAndText.slice(5)]));
assert.deepEqual(split, { text: `${BOM}# Ü`, bytes: bomAndText.length, truncated: false, invalidEncoding: false });
// A literal U+FFFD is valid text; a raw 0xFF byte is not and never becomes one.
assert.deepEqual(await readLlmsTxtObservationBody(stream([bytes(`# A${REPLACEMENT}`)])), { text: `# A${REPLACEMENT}`, bytes: 6, truncated: false, invalidEncoding: false });
let cancelled = 0;
const invalidStream = stream([[0x23, 0x20, 0x41, 0xff], bytes("rest")], () => { cancelled += 1; });
const invalid = await readLlmsTxtObservationBody(invalidStream);
assert.deepEqual([invalid.invalidEncoding, invalid.text], [true, ""]);
assert.equal(cancelled, 1, "a decode failure cancels the rest of the stream");
assert.equal(invalidStream.locked, false, "the reader lock is released");
const truncatedStream = stream([bytes("# A"), bytes("bcdef")], () => { cancelled += 1; });
const truncated = await readLlmsTxtObservationBody(truncatedStream, 5);
assert.deepEqual([truncated.truncated, truncated.bytes, cancelled, truncatedStream.locked], [true, 5, 2, false]);
const finished = stream([bytes("# A")]);
assert.deepEqual(await readLlmsTxtObservationBody(finished), { text: "# A", bytes: 3, truncated: false, invalidEncoding: false });
assert.equal(finished.locked, false);
assert.deepEqual(await readLlmsTxtObservationBody(stream([[0xe2, 0x82]])), { text: "", bytes: 2, truncated: false, invalidEncoding: true }, "an incomplete final character is invalid");

// ---- Visible whitespace ---------------------------------------------------------

const sample = `${BOM}# A\t b\r\nc${NBSP}d\re\n`;
const segments = llmsTxtSegments(sample);
assert.equal(segments.map((segment) => segment.text).join(""), sample, "segments join back to the exact text");
assert.deepEqual(segments.filter((segment) => segment.kind !== "text" && segment.kind !== "space").map((segment) => "label" in segment ? segment.label : ""),
	["U+FEFF", "CRLF", "NBSP", "CR", "LF"]);

console.log("llms.txt editor model self-check passed.");
