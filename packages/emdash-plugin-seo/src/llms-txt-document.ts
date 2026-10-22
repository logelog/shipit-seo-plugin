// Manually curated llms.txt documents: validation, UTF-8 byte accounting, the
// activation H1 rule, the stored record and the public response. Shared by the
// native editor and a later sandbox editor: no React, DOM, Node, SQL or network
// imports. The structured renderer in llms-txt.ts normalizes and truncates, so
// manual text never passes through it.

/** UTF-8 bytes of the stored and served document. Larger text is refused, never truncated. */
export const LLMS_TXT_DOCUMENT_MAX_BYTES = 131_072;

/** Declared body limit of every admin write route, including JSON escaping and the envelope. */
export const LLMS_TXT_WRITE_REQUEST_MAX_BYTES = 1_048_576;

/** Largest JSON copy of an invalid stored value the admin offers for download before a reset. */
export const LLMS_TXT_STORED_COPY_MAX_BYTES = 1_048_576;

export const LLMS_TXT_PATH = "/llms.txt";
export const LLMS_TXT_STORAGE_VERSION = 1;

/** Saved changes reach the origin response at once; shared caches may keep a copy for 5 minutes. */
export const LLMS_TXT_CACHE_CONTROL = "public, max-age=300";
export const LLMS_TXT_CONTENT_TYPE = "text/plain; charset=utf-8";

export type LlmsTxtDocumentProblem = "not-text" | "unpaired-surrogate" | "nul" | "too-large";

export type LlmsTxtDocumentCheck =
	| { ok: true; bytes: number }
	/** `index` is the UTF-16 offset of the first offending character, when there is one. */
	| { ok: false; problem: LlmsTxtDocumentProblem; bytes: number | null; index: number | null };

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * UTF-8 length of a well-formed string. An unpaired surrogate counts 3 bytes,
 * as the U+FFFD that an encoder writes for it; the document check refuses
 * such text before its length matters.
 */
export function llmsTxtUtf8Bytes(text: string): number {
	let bytes = 0;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (isHighSurrogate(code) && index + 1 < text.length && isLowSurrogate(text.charCodeAt(index + 1))) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
	}
	return bytes;
}

/** A string of Unicode scalar values without NUL, at most 131,072 UTF-8 bytes. */
export function checkLlmsTxtDocument(value: unknown): LlmsTxtDocumentCheck {
	if (typeof value !== "string") return { ok: false, problem: "not-text", bytes: null, index: null };
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0) return { ok: false, problem: "nul", bytes: null, index };
		if (isHighSurrogate(code)) {
			if (index + 1 < value.length && isLowSurrogate(value.charCodeAt(index + 1))) {
				index += 1;
				continue;
			}
			return { ok: false, problem: "unpaired-surrogate", bytes: null, index };
		}
		if (isLowSurrogate(code)) return { ok: false, problem: "unpaired-surrogate", bytes: null, index };
	}
	const bytes = llmsTxtUtf8Bytes(value);
	return bytes > LLMS_TXT_DOCUMENT_MAX_BYTES
		? { ok: false, problem: "too-large", bytes, index: null }
		: { ok: true, bytes };
}

// ---- Activation H1 rule, version 1 ------------------------------------------

export type LlmsTxtHeadingProblem = "no-content" | "not-heading" | "indented" | "not-h1" | "no-space" | "empty-heading";

export type LlmsTxtActivationCheck =
	/** `line` is the 1-based line of the H1; `heading` its text after the marker. */
	| { ok: true; line: number; heading: string }
	| { ok: false; problem: LlmsTxtDocumentProblem | LlmsTxtHeadingProblem; line: number | null };

const BLANK_LINE = /^[ \t]*$/;

/**
 * Activation needs a valid document whose first non-blank line is an ATX H1:
 * after one optional leading U+FEFF and lines of only SPACE and TAB (ending in
 * LF, CRLF or CR), the line starts with exactly one `#`, at least one SPACE or
 * TAB, and text containing a character other than SPACE, TAB and `#`.
 * Indentation, Setext headings and other Unicode spaces are refused.
 */
export function checkLlmsTxtActivation(text: unknown): LlmsTxtActivationCheck {
	const document = checkLlmsTxtDocument(text);
	if (!document.ok) return { ok: false, problem: document.problem, line: null };
	const body = text as string;
	let start = body.charCodeAt(0) === 0xfeff ? 1 : 0;
	for (let line = 1; ; line += 1) {
		let end = start;
		while (end < body.length && body[end] !== "\n" && body[end] !== "\r") end += 1;
		const current = body.slice(start, end);
		if (!BLANK_LINE.test(current)) return headingCheck(current, line);
		if (end >= body.length) return { ok: false, problem: "no-content", line: null };
		start = end + (body[end] === "\r" && body[end + 1] === "\n" ? 2 : 1);
	}
}

function headingCheck(line: string, number: number): LlmsTxtActivationCheck {
	if (!line.startsWith("#")) {
		return { ok: false, problem: /^[ \t]+#/.test(line) ? "indented" : "not-heading", line: number };
	}
	if (line.startsWith("##")) return { ok: false, problem: "not-h1", line: number };
	if (line[1] !== " " && line[1] !== "\t") {
		return { ok: false, problem: line.length === 1 ? "empty-heading" : "no-space", line: number };
	}
	const heading = line.slice(2).replace(/^[ \t]+|[ \t]+$/g, "");
	return /[^ \t#]/.test(heading)
		? { ok: true, line: number, heading }
		: { ok: false, problem: "empty-heading", line: number };
}

// ---- Stored record ----------------------------------------------------------

export interface LlmsTxtRecord {
	version: typeof LLMS_TXT_STORAGE_VERSION;
	enabled: boolean;
	text: string;
}

export type LlmsTxtCorruptReason =
	| "not-object"
	| "unsupported-version"
	| "unexpected-fields"
	| "enabled-not-boolean"
	| "text-invalid"
	| "enabled-without-h1";

export type LlmsTxtRecordCheck =
	| { ok: true; record: LlmsTxtRecord }
	| { ok: false; reason: LlmsTxtCorruptReason; detail: string };

const RECORD_FIELDS = ["enabled", "text", "version"];

// Details describe what was found without copying an unbounded stored value.
function describedVersion(value: unknown): string {
	if (value === undefined) return "missing";
	if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
	if (typeof value === "string") return value.length <= 32 ? JSON.stringify(value) : "a long string";
	return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}

function describedFields(fields: readonly string[]): string {
	if (!fields.length) return "none";
	const shown = fields.slice(0, 8).map((field) => (field.length <= 40 ? field : `${field.slice(0, 40)}...`));
	return fields.length > shown.length ? `${shown.join(", ")} and ${fields.length - shown.length} more` : shown.join(", ");
}

/**
 * Strict reading of the stored value. Anything but exactly
 * `{version: 1, enabled, text}` with a valid document, and an H1 when enabled,
 * is invalid; it never becomes an empty or default document.
 */
export function parseLlmsTxtRecord(value: unknown): LlmsTxtRecordCheck {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ok: false, reason: "not-object", detail: `The stored value is ${value === null ? "null" : Array.isArray(value) ? "an array" : typeof value}.` };
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.version !== LLMS_TXT_STORAGE_VERSION) {
		return { ok: false, reason: "unsupported-version", detail: `The stored version is ${describedVersion(candidate.version)}; this release reads version ${LLMS_TXT_STORAGE_VERSION}.` };
	}
	const fields = Object.keys(candidate).sort();
	if (fields.length !== RECORD_FIELDS.length || fields.some((field, index) => field !== RECORD_FIELDS[index])) {
		return { ok: false, reason: "unexpected-fields", detail: `The stored fields are ${describedFields(fields)}.` };
	}
	if (typeof candidate.enabled !== "boolean") {
		return { ok: false, reason: "enabled-not-boolean", detail: "The stored output setting is not true or false." };
	}
	const document = checkLlmsTxtDocument(candidate.text);
	if (!document.ok) {
		return { ok: false, reason: "text-invalid", detail: `The stored text is refused: ${LLMS_TXT_DOCUMENT_PROBLEM_TEXT[document.problem]}` };
	}
	if (candidate.enabled && !checkLlmsTxtActivation(candidate.text).ok) {
		return { ok: false, reason: "enabled-without-h1", detail: "Output is on, but the stored text has no valid H1." };
	}
	return { ok: true, record: { version: LLMS_TXT_STORAGE_VERSION, enabled: candidate.enabled, text: candidate.text as string } };
}

export const LLMS_TXT_DOCUMENT_PROBLEM_TEXT: Record<LlmsTxtDocumentProblem, string> = {
	"not-text": "it is not text.",
	"unpaired-surrogate": "it contains an unpaired UTF-16 surrogate, which is not valid Unicode.",
	nul: "it contains a NUL character (U+0000).",
	"too-large": `it is larger than ${LLMS_TXT_DOCUMENT_MAX_BYTES.toLocaleString("en")} UTF-8 bytes.`,
};

export const LLMS_TXT_HEADING_PROBLEM_TEXT: Record<LlmsTxtHeadingProblem, string> = {
	"no-content": "The text has no line other than blank lines. Start it with an H1 such as \"# Site name\".",
	"not-heading": "The first non-blank line is not a heading. Start the file with an H1 such as \"# Site name\".",
	indented: "The H1 starts with spaces or tabs. Start the \"#\" at the beginning of the line.",
	"not-h1": "The first heading has more than one \"#\". The first non-blank line must be an H1 with exactly one \"#\".",
	"no-space": "Put a space or tab between \"#\" and the heading text.",
	"empty-heading": "The H1 has no text. Write the site or project name after \"# \".",
};

// ---- Public response --------------------------------------------------------

export type LlmsTxtStoredState =
	| { state: "absent" }
	| { state: "stored"; record: LlmsTxtRecord }
	| { state: "corrupt" }
	| { state: "unavailable" };

export type LlmsTxtRefusal = "method" | "query";

export interface LlmsTxtPublicResponse {
	status: 200 | 404 | 405 | 503;
	contentType: string;
	cacheControl: string;
	body: string;
	allow?: string;
	retryAfter?: number;
}

function plainResponse(status: 404 | 405 | 503, body: string): LlmsTxtPublicResponse {
	return {
		status,
		contentType: LLMS_TXT_CONTENT_TYPE,
		cacheControl: "no-store",
		body,
		...(status === 405 ? { allow: "GET, HEAD" } : {}),
		...(status === 503 ? { retryAfter: 300 } : {}),
	};
}

/**
 * The origin response while Shipit owns /llms.txt. A refused method or query
 * is answered without reading storage. Only an enabled valid record is served,
 * byte for byte; nothing about revisions or the admin state is exposed.
 */
export function llmsTxtPublicResponse(input: { refusal: LlmsTxtRefusal } | { refusal: null; stored: LlmsTxtStoredState }): LlmsTxtPublicResponse {
	if (input.refusal !== null) {
		return input.refusal === "method" ? plainResponse(405, "Method not allowed.\n") : plainResponse(404, "Not found.\n");
	}
	const stored = input.stored;
	if (stored.state === "corrupt" || stored.state === "unavailable") return plainResponse(503, "llms.txt is temporarily unavailable.\n");
	if (stored.state === "absent" || !stored.record.enabled) return plainResponse(404, "Not found.\n");
	return { status: 200, contentType: LLMS_TXT_CONTENT_TYPE, cacheControl: LLMS_TXT_CACHE_CONTROL, body: stored.record.text };
}

// ---- Observation ------------------------------------------------------------

export type LlmsTxtObservationExpectation =
	| { kind: "text"; text: string }
	| { kind: "status"; status: 404 | 503 }
	/** Shipit does not own the file, so nothing is expected. */
	| { kind: "none" };

export type LlmsTxtObservationResult =
	| { status: "matches" }
	| { status: "expected-status" }
	| { status: "different-text" }
	| { status: "wrong-type"; contentType: string | null }
	| { status: "served-unexpectedly" }
	| { status: "unexpected-status" }
	| { status: "observed" }
	| { status: "not-observed"; reason: "redirect" | "network" | "timeout" | "too-large" | "invalid-encoding" };

/**
 * Compares one same-origin response with what the stored state makes the
 * origin answer. `matches` means status 200, the exact text and the plain-text
 * UTF-8 type; a stored setting alone is never reported as served.
 */
export function classifyLlmsTxtObservation(
	expected: LlmsTxtObservationExpectation,
	response: { status: number; redirected: boolean; contentType: string | null; body: string; truncated: boolean; invalidEncoding: boolean },
): LlmsTxtObservationResult {
	if (response.redirected) return { status: "not-observed", reason: "redirect" };
	if (expected.kind === "none") return { status: "observed" };
	if (expected.kind === "status") {
		if (response.status === expected.status) return { status: "expected-status" };
		return response.status === 200 ? { status: "served-unexpectedly" } : { status: "unexpected-status" };
	}
	if (response.status !== 200) return { status: "unexpected-status" };
	// A body read only in part, or with bytes that are not UTF-8, is never a match.
	if (response.truncated) return { status: "not-observed", reason: "too-large" };
	if (response.invalidEncoding) return { status: "not-observed", reason: "invalid-encoding" };
	if (response.body !== expected.text) return { status: "different-text" };
	return isPlainUtf8MediaType(response.contentType)
		? { status: "matches" }
		: { status: "wrong-type", contentType: response.contentType };
}

// RFC 9110 media type: whitespace is allowed only around the ";" separator and
// at the ends of the field value, never inside the type, subtype or parameter.
const PLAIN_UTF8_MEDIA_TYPE = /^[ \t]*text\/plain[ \t]*;[ \t]*charset=(?:utf-8|"utf-8")[ \t]*$/i;

/** True for `text/plain` with exactly the `charset=utf-8` parameter, in any letter case. */
export function isPlainUtf8MediaType(value: string | null): boolean {
	return value !== null && PLAIN_UTF8_MEDIA_TYPE.test(value);
}
