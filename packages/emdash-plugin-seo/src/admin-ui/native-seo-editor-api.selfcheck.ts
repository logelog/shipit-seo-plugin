import assert from "node:assert/strict";
import type { UpdateContentInput } from "@emdash-cms/admin";

import {
	classifyNativeSeoWriteError,
	fetchNativeSeoSnapshot,
	parseNativeSeoItem,
	saveNativeSeoAttempt,
	type NativeSeoApiDependencies,
} from "./native-seo-editor-api.ts";
import {
	NATIVE_SEO_STORED_IMAGE_MAX_LENGTH,
	beginNativeSeoReadback,
	beginNativeSeoSave,
	createNativeSeoEditorState,
	nativeSeoEditorReducer,
	updateNativeSeoDraft,
	type NativeSeoSaveAttempt,
	type NativeSeoTarget,
} from "./native-seo-editor-state.ts";

// The injected class uses the published constructor/status contract. Plain lookalikes do not qualify.
class ControlledApiResponseError extends Error {
	status: number;
	code: string;
	details?: Record<string, unknown>;
	constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = "ApiResponseError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}
const target: NativeSeoTarget = {
	principal: { id: "synthetic-owner", role: 40 }, collection: "posts", entryId: "entry-a", locale: "nl",
};
const seo = { title: "Native title", description: "Native description", image: "/_emdash/api/media/file/a.jpg", canonical: "https://example.invalid/kept", noIndex: true };
const item = { id: "entry-a", type: "posts", locale: "nl", _rev: "opaque-a", seo,
	data: { title: "Content title must not be copied", content: "Unrelated content" }, slug: "unchanged", draftRevisionId: "saved-draft" };
const baseline = parseNativeSeoItem(item, target);
assert.ok(baseline);
assert.deepEqual(baseline.values, { title: seo.title, description: seo.description, image: seo.image });
assert.equal(baseline.target.principal.id, target.principal.id);
assert.notEqual(baseline.target, target);
assert.ok(Object.isFrozen(baseline) && Object.isFrozen(baseline.values) && Object.isFrozen(baseline.target.principal));
assert.equal("data" in baseline, false);
assert.equal("canonical" in baseline.values, false);
assert.equal("noIndex" in baseline.values, false);
// Native 1.3 hydrates these defaults even before an SEO-enabled entry has its first SEO row.
const firstSavedItem = { ...item, seo: { title: null, description: null, image: null, canonical: null, noIndex: false } };
const firstSavedSnapshot = parseNativeSeoItem(firstSavedItem, target);
assert.ok(firstSavedSnapshot);
assert.deepEqual(firstSavedSnapshot.values, { title: null, description: null, image: null });
const firstSavedAttempt = beginNativeSeoSave(updateNativeSeoDraft(createNativeSeoEditorState(target, firstSavedSnapshot), { title: "First native SEO title" })).attempt;
assert.ok(firstSavedAttempt);
assert.deepEqual(firstSavedAttempt.patch, { title: "First native SEO title" });
assert.equal(parseNativeSeoItem({ ...item, seo: undefined }, target), null, "omitted SEO does not establish the same native null defaults");
const attemptResult = beginNativeSeoSave(updateNativeSeoDraft(createNativeSeoEditorState(target, baseline), { title: "New native title" }));
assert.ok(attemptResult.attempt);
const attempt = attemptResult.attempt;
const updatedItem = { ...item, _rev: "opaque-b", seo: { ...seo, title: "New native title" } };

// Only the actual returned entity can establish entry/collection/locale/revision scope.
for (const invalid of [
	null, [], {},
	{ ...item, id: "another-entry" }, { ...item, type: "pages" }, { ...item, locale: "tr" },
	{ ...item, id: undefined }, { ...item, type: undefined }, { ...item, locale: undefined },
	{ ...item, _rev: undefined }, { ...item, _rev: null }, { ...item, _rev: "" }, { ...item, _rev: "opaque\nrevision" },
	{ ...item, seo: undefined }, { ...item, seo: null }, { ...item, seo: [] },
	{ ...item, seo: { ...seo, title: undefined } }, { ...item, seo: { ...seo, description: false } },
	{ ...item, seo: { ...seo, image: undefined } }, { ...item, seo: { ...seo, title: "x".repeat(201) } },
	{ ...item, seo: { ...seo, description: "x".repeat(501) } },
	{ ...item, seo: { ...seo, image: "x".repeat(NATIVE_SEO_STORED_IMAGE_MAX_LENGTH + 1) } },
	Object.create(item),
]) assert.equal(parseNativeSeoItem(invalid, target), null);
assert.equal(parseNativeSeoItem(item, { ...target, locale: null }), null, "an omitted locale is not a qualified native scope");
assert.equal(parseNativeSeoItem(item, { ...target, principal: { id: "", role: 40 } }), null);
const oldOpaque = "opaque-native-reference:" + "x".repeat(4_096);
const existingRawItem = { ...item, seo: { ...seo, title: "  Existing native spacing  ", description: "Line one\nLine two", image: oldOpaque } };
const existingRaw = parseNativeSeoItem(existingRawItem, target);
assert.ok(existingRaw);
assert.equal(existingRaw.values.title, "  Existing native spacing  ");
assert.equal(existingRaw.values.description, "Line one\nLine two");
assert.equal(existingRaw.values.image, oldOpaque, "the read parser does not apply a new-image URL policy to stored bytes");

for (const status of [400, 401, 403, 404]) {
	assert.equal(classifyNativeSeoWriteError(new ControlledApiResponseError(status, "REQUEST_REFUSED", "Rejected"), ControlledApiResponseError), "rejected");
}
assert.equal(classifyNativeSeoWriteError(new ControlledApiResponseError(409, "CONFLICT", "Changed"), ControlledApiResponseError), "conflict");
// Host 1.3 answers a write to an entry another editor holds with 409 ENTRY_LOCKED before storing anything.
assert.equal(classifyNativeSeoWriteError(new ControlledApiResponseError(409, "ENTRY_LOCKED", "Another editor is holding this entry",
	{ userId: "other-editor" }), ControlledApiResponseError), "locked", "an entry lock is no value conflict");
for (const error of [
	new TypeError("Network failure"), new Error("Request timed out"),
	new ControlledApiResponseError(408, "TIMEOUT", "Unknown"), new ControlledApiResponseError(429, "RATE_LIMITED", "Unknown"),
	new ControlledApiResponseError(500, "SERVER_ERROR", "Unknown"), new ControlledApiResponseError(503, "UNAVAILABLE", "Unknown"),
	{ status: 409, code: "CONFLICT" }, { status: 409, code: "ENTRY_LOCKED" }, { response: { status: 409 } },
	Object.assign(new Error("Lookalike"), { name: "ApiResponseError", status: 409, code: "CONFLICT" }),
]) assert.equal(classifyNativeSeoWriteError(error, ControlledApiResponseError), "unknown");

const reads: Array<{ collection: string; id: string; options: { locale?: string } | undefined }> = [];
const writes: Array<{ collection: string; id: string; input: UpdateContentInput; options: { locale?: string } | undefined }> = [];
let answer: unknown = item;
let writeAnswer: unknown = updatedItem;
let readError: unknown = null;
let writeError: unknown = null;
const dependencies: NativeSeoApiDependencies = {
	ApiResponseError: ControlledApiResponseError,
	async fetchContent(collection, id, options) {
		reads.push({ collection, id, options });
		if (readError) throw readError;
		return answer;
	},
	async updateContent(collection, id, input, options) {
		writes.push({ collection, id, input, options });
		if (writeError) throw writeError;
		return writeAnswer;
	},
};
const loaded = await fetchNativeSeoSnapshot(target, dependencies);
assert.equal(loaded.outcome, "read");
assert.deepEqual(reads, [{ collection: "posts", id: "entry-a", options: { locale: "nl" } }]);
assert.equal(writes.length, 0);
const unknownLocale = await fetchNativeSeoSnapshot({ ...target, locale: null }, dependencies);
assert.deepEqual(unknownLocale, { outcome: "unavailable" });
assert.equal(reads.length, 1, "unknown locale starts no unscoped read");
for (const badAnswer of [{ ...item, id: "other" }, { ...item, locale: undefined }, { ...item, _rev: undefined }]) {
	answer = badAnswer;
	assert.deepEqual(await fetchNativeSeoSnapshot(target, dependencies), { outcome: "unavailable" });
}
answer = item;
readError = new ControlledApiResponseError(404, "NOT_FOUND", "Missing");
const readCount = reads.length;
assert.deepEqual(await fetchNativeSeoSnapshot(target, dependencies), { outcome: "unavailable" });
assert.equal(reads.length, readCount + 1, "a failed read is attempted once");
readError = null;

// The caller can move to another entry while a read waits; the request retains its own owner.
const movingTarget = { ...target, principal: { ...target.principal } };
let releaseRead!: (value: unknown) => void;
let capturedRequest: unknown;
const pendingRead = fetchNativeSeoSnapshot(movingTarget, { ...dependencies,
	fetchContent(collection, id, options) {
		capturedRequest = { collection, id, options };
		return new Promise((resolve) => { releaseRead = resolve; });
	},
});
movingTarget.entryId = "moved-entry";
movingTarget.locale = "tr";
movingTarget.principal.id = "moved-principal";
releaseRead(item);
const capturedRead = await pendingRead;
assert.deepEqual(capturedRequest, { collection: "posts", id: "entry-a", options: { locale: "nl" } });
assert.equal(capturedRead.outcome, "read");
if (capturedRead.outcome !== "read") throw new Error("Missing captured read");
assert.equal(capturedRead.snapshot.target.entryId, "entry-a");
assert.equal(capturedRead.snapshot.target.locale, "nl");
assert.equal(capturedRead.snapshot.target.principal.id, "synthetic-owner");

let firstWriteCalls = 0;
let firstWriteInput: UpdateContentInput | null = null;
const firstDependencies: NativeSeoApiDependencies = { ...dependencies,
	async fetchContent() { throw new Error("First save must not make an implicit read"); },
	async updateContent(collection, id, input, options) {
		firstWriteCalls++;
		firstWriteInput = input;
		assert.deepEqual([collection, id, options], ["posts", "entry-a", { locale: "nl" }]);
		return { ...firstSavedItem, _rev: "opaque-first-seo", seo: { ...firstSavedItem.seo, title: "First native SEO title" } };
	},
};
assert.equal((await saveNativeSeoAttempt(firstSavedAttempt, firstDependencies)).outcome, "acknowledged");
assert.equal(firstWriteCalls, 1);
assert.deepEqual(firstWriteInput, { seo: { title: "First native SEO title" }, _rev: "opaque-a" });

const readsBeforeWrite = reads.length;
const acknowledgement = await saveNativeSeoAttempt(attempt, dependencies);
assert.equal(acknowledgement.outcome, "acknowledged");
assert.equal(writes.length, 1);
assert.equal(reads.length, readsBeforeWrite, "saving performs no hidden readback or retry");
assert.deepEqual(writes[0], { collection: "posts", id: "entry-a", input: { seo: { title: "New native title" }, _rev: "opaque-a" }, options: { locale: "nl" } });
assert.ok(Object.isFrozen(writes[0].input) && Object.isFrozen(writes[0].input.seo));
assert.equal("canonical" in writes[0].input.seo!, false);
assert.equal("noIndex" in writes[0].input.seo!, false);
assert.equal("data" in writes[0].input, false);
assert.equal("slug" in writes[0].input, false);
assert.equal("skipRevision" in writes[0].input, false);
assert.equal(item.data.content, "Unrelated content");
assert.equal(item.seo.canonical, "https://example.invalid/kept");
assert.equal(item.seo.noIndex, true);

// All declared responses are still acknowledgements; confirmation belongs to the state readback.
assert.equal(acknowledgement.outcome, "acknowledged");
if (acknowledgement.outcome !== "acknowledged") throw new Error("Missing acknowledgement fixture");
const awaitingReadback = nativeSeoEditorReducer(attemptResult.state, { type: "write-result", attempt, result: acknowledgement });
assert.equal(awaitingReadback.phase, "unknown");
assert.equal(awaitingReadback.baseline?.revision, "opaque-a");
answer = updatedItem;
const checking = beginNativeSeoReadback(awaitingReadback);
assert.ok(checking.request);
const fresh = await fetchNativeSeoSnapshot(target, dependencies);
assert.equal(fresh.outcome, "read");
if (fresh.outcome !== "read") throw new Error("Missing readback fixture");
const confirmed = nativeSeoEditorReducer(checking.state, { type: "readback-result", request: checking.request, snapshot: fresh.snapshot });
assert.equal(confirmed.phase, "confirmed");

for (const invalidResponse of [
	{ ...updatedItem, id: "foreign" }, { ...updatedItem, type: "pages" }, { ...updatedItem, locale: "en" },
	{ ...updatedItem, _rev: undefined }, { ...updatedItem, _rev: "opaque-a" },
	{ ...updatedItem, seo: { ...updatedItem.seo, title: "Different saved title" } },
]) {
	writeAnswer = invalidResponse;
	const count: number = writes.length;
	assert.deepEqual(await saveNativeSeoAttempt(attempt, dependencies), { outcome: "unknown" });
	assert.equal(writes.length, count + 1);
}
writeAnswer = updatedItem;
for (const [error, outcome] of [
	[new ControlledApiResponseError(409, "CONFLICT", "Changed"), "conflict"],
	[new ControlledApiResponseError(409, "ENTRY_LOCKED", "Another editor is holding this entry", { userId: "other-editor" }), "locked"],
	[new ControlledApiResponseError(400, "INVALID", "Rejected"), "rejected"],
	[new ControlledApiResponseError(401, "UNAUTHORIZED", "Rejected"), "rejected"],
	[new ControlledApiResponseError(403, "FORBIDDEN", "Rejected"), "rejected"],
	[new ControlledApiResponseError(404, "NOT_FOUND", "Rejected"), "rejected"],
	[new ControlledApiResponseError(500, "SERVER_ERROR", "Unknown"), "unknown"],
	[new TypeError("Connection lost"), "unknown"], [{ status: 409 }, "unknown"],
] as const) {
	writeError = error;
	const count: number = writes.length;
	assert.deepEqual(await saveNativeSeoAttempt(attempt, dependencies), { outcome });
	assert.equal(writes.length, count + 1, "every explicit save dispatches once, including uncertain outcomes");
}
writeError = null;

// Forged/mutable attempts do not escape the narrow native payload or start a call.
for (const invalid of [
	{ ...attempt },
	Object.freeze({ ...attempt, patch: { ...attempt.patch } }),
	Object.freeze({ ...attempt, patch: Object.freeze({ title: "New native title", canonical: "https://example.invalid/wrong" }) }),
	Object.freeze({ ...attempt, patch: Object.freeze({}) }),
	Object.freeze({ ...attempt, patch: Object.freeze({ image: "javascript:alert(1)" }) }),
	Object.freeze({ ...attempt, expectedValues: Object.freeze({ ...attempt.expectedValues, title: "Mismatch" }) }),
	Object.freeze({ ...attempt, expectedRevision: "" }),
	Object.freeze({ ...attempt, target: Object.freeze({ ...attempt.target, locale: null }) }),
] as unknown as NativeSeoSaveAttempt[]) {
	const count: number = writes.length;
	assert.deepEqual(await saveNativeSeoAttempt(invalid, dependencies), { outcome: "rejected" });
	assert.equal(writes.length, count);
}

// A long preexisting native image can survive a title edit or be cleared without resubmission.
assert.ok(existingRaw);
const longTitleResult = beginNativeSeoSave(updateNativeSeoDraft(createNativeSeoEditorState(target, existingRaw), { title: "Long-image title edit" }));
assert.ok(longTitleResult.attempt);
writeAnswer = { ...existingRawItem, _rev: "opaque-long-b", seo: { ...existingRawItem.seo, title: "Long-image title edit" } };
assert.equal((await saveNativeSeoAttempt(longTitleResult.attempt, dependencies)).outcome, "acknowledged");
assert.deepEqual(writes.at(-1)!.input.seo, { title: "Long-image title edit" });
const clearResult = beginNativeSeoSave(updateNativeSeoDraft(createNativeSeoEditorState(target, existingRaw), { image: null }));
assert.ok(clearResult.attempt);
writeAnswer = { ...existingRawItem, _rev: "opaque-clear-b", seo: { ...existingRawItem.seo, image: null } };
assert.equal((await saveNativeSeoAttempt(clearResult.attempt, dependencies)).outcome, "acknowledged");
assert.deepEqual(writes.at(-1)!.input.seo, { image: null });
assert.equal("deleteMedia" in writes.at(-1)!.input, false);

console.log("Native SEO editor API self-checks passed.");
