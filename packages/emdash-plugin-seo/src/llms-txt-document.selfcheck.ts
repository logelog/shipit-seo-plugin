import assert from "node:assert/strict";

import {
	LLMS_TXT_CACHE_CONTROL,
	LLMS_TXT_DOCUMENT_MAX_BYTES,
	LLMS_TXT_WRITE_REQUEST_MAX_BYTES,
	checkLlmsTxtActivation,
	checkLlmsTxtDocument,
	classifyLlmsTxtObservation,
	isPlainUtf8MediaType,
	llmsTxtPublicResponse,
	llmsTxtUtf8Bytes,
	parseLlmsTxtRecord,
} from "./llms-txt-document.ts";
import * as structured from "./llms-txt.ts";

const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const NUL = String.fromCharCode(0);
const HIGH = String.fromCharCode(0xd800);
const LOW = String.fromCharCode(0xdc00);
const REPLACEMENT = String.fromCharCode(0xfffd);
const EMOJI = String.fromCodePoint(0x1f600);
const CONTROL = String.fromCharCode(1);

// The structured renderer is a separate feature; its runtime exports stay as they were.
assert.deepEqual(Object.keys(structured).sort(), [
	"LLMS_TXT_LIMITS", "LLMS_TXT_MAX_BODY_LENGTH", "LLMS_TXT_MAX_LINKS_PER_SECTION", "LLMS_TXT_MAX_LINK_DESCRIPTION_LENGTH",
	"LLMS_TXT_MAX_LINK_LABEL_LENGTH", "LLMS_TXT_MAX_OUTPUT_LENGTH", "LLMS_TXT_MAX_SECTIONS", "LLMS_TXT_MAX_SECTION_TITLE_LENGTH",
	"LLMS_TXT_MAX_SUMMARY_LENGTH", "LLMS_TXT_MAX_TITLE_LENGTH", "LLMS_TXT_MAX_TOTAL_LINKS", "LLMS_TXT_MAX_URL_LENGTH",
	"renderLlmsTxt",
]);

// ---- UTF-8 bytes, Unicode and NUL -------------------------------------------

assert.equal(llmsTxtUtf8Bytes(""), 0);
assert.equal(llmsTxtUtf8Bytes("# A"), 3);
assert.equal(llmsTxtUtf8Bytes("é"), 2);
assert.equal(llmsTxtUtf8Bytes("€"), 3);
assert.equal(llmsTxtUtf8Bytes(EMOJI), 4);
assert.equal(llmsTxtUtf8Bytes(BOM), 3);
assert.equal(llmsTxtUtf8Bytes(`${BOM}# Ünïcødé 日本語\r\n`), new TextEncoder().encode(`${BOM}# Ünïcødé 日本語\r\n`).byteLength);

assert.deepEqual(checkLlmsTxtDocument(42), { ok: false, problem: "not-text", bytes: null, index: null });
assert.deepEqual(checkLlmsTxtDocument(null), { ok: false, problem: "not-text", bytes: null, index: null });
assert.deepEqual(checkLlmsTxtDocument(`# A${NUL}`), { ok: false, problem: "nul", bytes: null, index: 3 });
assert.deepEqual(checkLlmsTxtDocument(`# A${HIGH}`), { ok: false, problem: "unpaired-surrogate", bytes: null, index: 3 });
assert.deepEqual(checkLlmsTxtDocument(`# ${LOW}A`), { ok: false, problem: "unpaired-surrogate", bytes: null, index: 2 });
assert.deepEqual(checkLlmsTxtDocument(`${LOW}${HIGH}`), { ok: false, problem: "unpaired-surrogate", bytes: null, index: 0 }, "reversed pair");
assert.deepEqual(checkLlmsTxtDocument(`${HIGH}${HIGH}${LOW}`), { ok: false, problem: "unpaired-surrogate", bytes: null, index: 0 });
assert.deepEqual(checkLlmsTxtDocument(`# ${EMOJI}`), { ok: true, bytes: 6 });
assert.deepEqual(checkLlmsTxtDocument(`# ${REPLACEMENT}`), { ok: true, bytes: 5 }, "a literal U+FFFD is valid text");
assert.deepEqual(checkLlmsTxtDocument(`# A${CONTROL}`), { ok: true, bytes: 4 }, "other control characters are kept");
assert.deepEqual(checkLlmsTxtDocument(""), { ok: true, bytes: 0 });

// Exactly at the bound with multi-byte characters, and one byte over: refused, never truncated.
const atLimit = `# T\n${"a".repeat(LLMS_TXT_DOCUMENT_MAX_BYTES - 6)}é`;
assert.equal(llmsTxtUtf8Bytes(atLimit), LLMS_TXT_DOCUMENT_MAX_BYTES);
assert.deepEqual(checkLlmsTxtDocument(atLimit), { ok: true, bytes: LLMS_TXT_DOCUMENT_MAX_BYTES });
const overLimit = `# T\n${"a".repeat(LLMS_TXT_DOCUMENT_MAX_BYTES - 6)}€`;
assert.deepEqual(checkLlmsTxtDocument(overLimit), { ok: false, problem: "too-large", bytes: LLMS_TXT_DOCUMENT_MAX_BYTES + 1, index: null });
assert.equal(checkLlmsTxtDocument(`${BOM}${"a".repeat(LLMS_TXT_DOCUMENT_MAX_BYTES - 2)}`).ok, false, "the BOM counts three bytes");
assert.equal(checkLlmsTxtDocument(`${BOM}${"a".repeat(LLMS_TXT_DOCUMENT_MAX_BYTES - 3)}`).ok, true);

// The worst-case JSON escaping of a valid document fits the write request bound.
const worstCase = JSON.stringify({ expectedRevision: "r".repeat(128), text: CONTROL.repeat(LLMS_TXT_DOCUMENT_MAX_BYTES) });
assert.ok(llmsTxtUtf8Bytes(worstCase) < LLMS_TXT_WRITE_REQUEST_MAX_BYTES, `worst case ${llmsTxtUtf8Bytes(worstCase)} bytes`);
assert.equal(JSON.parse(JSON.stringify({ text: `${BOM}# A` })).text, `${BOM}# A`, "a leading BOM survives JSON string transport");

// ---- Activation H1 rule, version 1 --------------------------------------------

const accepted: [string, number, string][] = [
	["# Site", 1, "Site"],
	[`${BOM}# Site`, 1, "Site"],
	["\n \t\n# Site", 3, "Site"],
	["\r\n# Site\r\n", 2, "Site"],
	["\r# Site", 2, "Site"],
	["#\tSite", 1, "Site"],
	["# Ünïcødé 日本語", 1, "Ünïcødé 日本語"],
	["# Site ##", 1, "Site ##"],
	["# C#", 1, "C#"],
	["#   Spaced   ", 1, "Spaced"],
	[`${BOM}\r\n\t\r\n# Site\nmore`, 3, "Site"],
];
for (const [text, line, heading] of accepted) {
	assert.deepEqual(checkLlmsTxtActivation(text), { ok: true, line, heading }, JSON.stringify(text));
}
const refused: [string, string][] = [
	["", "no-content"],
	["\n\n \t\n", "no-content"],
	[BOM, "no-content"],
	["#Site", "no-space"],
	["## Site", "not-h1"],
	[" # Site", "indented"],
	["\t# Site", "indented"],
	["#", "empty-heading"],
	["# ", "empty-heading"],
	["# ##", "empty-heading"],
	["#\t \t", "empty-heading"],
	["Site\n====", "not-heading"],
	[`${NBSP}\n# Site`, "not-heading"],
	[`${BOM}${BOM}# Site`, "not-heading"],
	["> # Site", "not-heading"],
	["Intro\n# Site", "not-heading"],
];
for (const [text, problem] of refused) {
	const result = checkLlmsTxtActivation(text);
	assert.equal(result.ok, false, JSON.stringify(text));
	assert.equal(!result.ok && result.problem, problem, JSON.stringify(text));
}
assert.equal((checkLlmsTxtActivation(`# A${NUL}`) as { problem: string }).problem, "nul", "document rules come first");
assert.equal((checkLlmsTxtActivation(overLimit) as { problem: string }).problem, "too-large");
// Linear scan: a maximal document of blank lines answers quickly.
const started = performance.now();
assert.equal((checkLlmsTxtActivation("\n".repeat(LLMS_TXT_DOCUMENT_MAX_BYTES)) as { problem: string }).problem, "no-content");
assert.ok(performance.now() - started < 1_000, "blank-line scan is linear");

// ---- Stored record --------------------------------------------------------------

assert.deepEqual(parseLlmsTxtRecord({ version: 1, enabled: false, text: "" }), { ok: true, record: { version: 1, enabled: false, text: "" } });
assert.deepEqual(parseLlmsTxtRecord({ version: 1, enabled: true, text: `${BOM}# A\r\n` }).ok, true);
const reasons: [unknown, string][] = [
	[null, "not-object"],
	["# A", "not-object"],
	[[1], "not-object"],
	[{ enabled: true, text: "# A" }, "unsupported-version"],
	[{ version: 2, enabled: true, text: "# A" }, "unsupported-version"],
	[{ version: "1", enabled: true, text: "# A" }, "unsupported-version"],
	[{ version: 1, enabled: true, text: "# A", extra: 1 }, "unexpected-fields"],
	[{ version: 1, text: "# A" }, "unexpected-fields"],
	[{ version: 1, enabled: "yes", text: "# A" }, "enabled-not-boolean"],
	[{ version: 1, enabled: false, text: 7 }, "text-invalid"],
	[{ version: 1, enabled: false, text: `a${NUL}` }, "text-invalid"],
	[{ version: 1, enabled: false, text: overLimit }, "text-invalid"],
	[{ version: 1, enabled: true, text: "no heading" }, "enabled-without-h1"],
];
for (const [value, reason] of reasons) {
	const parsed = parseLlmsTxtRecord(value);
	assert.equal(parsed.ok, false, JSON.stringify(value)?.slice(0, 80));
	assert.equal(!parsed.ok && parsed.reason, reason);
}
assert.equal(parseLlmsTxtRecord({ version: 1, enabled: false, text: "no heading" }).ok, true, "a disabled draft needs no H1");
const huge = parseLlmsTxtRecord({ version: { nested: "x".repeat(100_000) }, enabled: true, text: "# A" });
assert.ok(!huge.ok && huge.detail.length < 200, "details never copy a stored value");
const manyFields = parseLlmsTxtRecord(Object.fromEntries([["version", 1], ...Array.from({ length: 50 }, (_, index) => [`field-${"x".repeat(80)}-${index}`, 1])]));
assert.ok(!manyFields.ok && manyFields.detail.length < 600);

// ---- Public response ----------------------------------------------------------

const record = (enabled: boolean, text = `${BOM}# Site\r\n`) => ({ state: "stored" as const, record: { version: 1 as const, enabled, text } });
assert.deepEqual(llmsTxtPublicResponse({ refusal: null, stored: record(true) }),
	{ status: 200, contentType: "text/plain; charset=utf-8", cacheControl: LLMS_TXT_CACHE_CONTROL, body: `${BOM}# Site\r\n` });
assert.equal(LLMS_TXT_CACHE_CONTROL, "public, max-age=300");
for (const stored of [{ state: "absent" as const }, record(false)]) {
	const response = llmsTxtPublicResponse({ refusal: null, stored });
	assert.deepEqual([response.status, response.cacheControl, response.body.includes("Site")], [404, "no-store", false], "disabled text is never exposed");
}
for (const stored of [{ state: "corrupt" as const }, { state: "unavailable" as const }]) {
	const response = llmsTxtPublicResponse({ refusal: null, stored });
	assert.deepEqual([response.status, response.cacheControl, response.retryAfter], [503, "no-store", 300]);
}
assert.deepEqual(llmsTxtPublicResponse({ refusal: "method" }), {
	status: 405, contentType: "text/plain; charset=utf-8", cacheControl: "no-store", body: "Method not allowed.\n", allow: "GET, HEAD",
});
assert.deepEqual([llmsTxtPublicResponse({ refusal: "query" }).status, llmsTxtPublicResponse({ refusal: "query" }).cacheControl], [404, "no-store"]);

// ---- Media type ---------------------------------------------------------------

for (const value of ["text/plain; charset=utf-8", "text/plain;charset=utf-8", "TEXT/Plain; Charset=UTF-8", "text/plain ;  charset=utf-8", " text/plain; charset=\"utf-8\" "]) {
	assert.equal(isPlainUtf8MediaType(value), true, value);
}
for (const value of [null, "", "text/plain", "te xt/plain; charset=utf-8", "text/pl ain; charset=utf-8", "text/plain; charset = utf-8",
	"text/plain; charset=utf -8", "text/plain; char set=utf-8", "text/plain; charset=utf-16", "text/plain; charset=utf-8; x=y",
	"text/html; charset=utf-8", "text/plain, text/html; charset=utf-8", "text/plain; charset=utf-8;"]) {
	assert.equal(isPlainUtf8MediaType(value), false, String(value));
}

// ---- Observation classes ------------------------------------------------------

const observed = (status: number, body: string, extra: Partial<{ contentType: string | null; redirected: boolean; truncated: boolean; invalidEncoding: boolean }> = {}) =>
	({ status, body, contentType: "text/plain; charset=utf-8", redirected: false, truncated: false, invalidEncoding: false, ...extra });
const text = `${BOM}# A`;
assert.deepEqual(classifyLlmsTxtObservation({ kind: "text", text }, observed(200, text)), { status: "matches" });
assert.deepEqual(classifyLlmsTxtObservation({ kind: "text", text }, observed(200, "# A")), { status: "different-text" }, "a dropped BOM differs");
assert.deepEqual(classifyLlmsTxtObservation({ kind: "text", text }, observed(200, text, { contentType: "te xt/plain; charset=utf-8" })),
	{ status: "wrong-type", contentType: "te xt/plain; charset=utf-8" });
assert.deepEqual(classifyLlmsTxtObservation({ kind: "text", text }, observed(200, text, { truncated: true })), { status: "not-observed", reason: "too-large" });
assert.deepEqual(classifyLlmsTxtObservation({ kind: "text", text: `# A${REPLACEMENT}` }, observed(200, "", { invalidEncoding: true })),
	{ status: "not-observed", reason: "invalid-encoding" }, "invalid bytes never match a literal U+FFFD");
assert.deepEqual(classifyLlmsTxtObservation({ kind: "text", text }, observed(404, "Not found.\n")), { status: "unexpected-status" });
assert.deepEqual(classifyLlmsTxtObservation({ kind: "text", text }, observed(301, "", { redirected: true })), { status: "not-observed", reason: "redirect" });
assert.deepEqual(classifyLlmsTxtObservation({ kind: "status", status: 404 }, observed(404, "Not found.\n")), { status: "expected-status" });
assert.deepEqual(classifyLlmsTxtObservation({ kind: "status", status: 404 }, observed(200, text)), { status: "served-unexpectedly" });
assert.deepEqual(classifyLlmsTxtObservation({ kind: "status", status: 503 }, observed(404, "")), { status: "unexpected-status" });
assert.deepEqual(classifyLlmsTxtObservation({ kind: "none" }, observed(200, text)), { status: "observed" });

console.log("llms.txt document policy self-check passed.");
