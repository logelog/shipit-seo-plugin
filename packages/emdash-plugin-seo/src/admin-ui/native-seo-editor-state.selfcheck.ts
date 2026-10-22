import assert from "node:assert/strict";

import {
	NATIVE_SEO_DESCRIPTION_MAX_LENGTH,
	NATIVE_SEO_IMAGE_MAX_LENGTH,
	NATIVE_SEO_STORED_IMAGE_MAX_LENGTH,
	NATIVE_SEO_TITLE_MAX_LENGTH,
	beginNativeSeoReadback,
	beginNativeSeoSave,
	canCloseNativeSeoEditor,
	canSaveNativeSeoValues,
	createNativeSeoEditorState,
	discardNativeSeoDraft,
	nativeSeoEditorReducer,
	nativeSeoRevisionBehind,
	nativeSeoWriteInput,
	reviewNativeSeoSave,
	updateNativeSeoDraft,
	validateNativeSeoDraft,
	type NativeSeoEditorState,
	type NativeSeoSaveAttempt,
	type NativeSeoSnapshot,
	type NativeSeoTarget,
	type NativeSeoValues,
} from "./native-seo-editor-state.ts";

const target: NativeSeoTarget = {
	principal: { id: "synthetic-editor", role: 40 }, collection: "posts", entryId: "entry-a", locale: "nl",
};
const before: NativeSeoValues = { title: "Stored title", description: "Stored description", image: "/_emdash/api/media/file/before.jpg" };
const intended = { title: "New native title", description: "New native description", image: "/_emdash/api/media/file/new.jpg" };
function snapshot(revision = "opaque-a", values: NativeSeoValues = before, owner = target): NativeSeoSnapshot {
	return { target: owner, revision, values };
}
function initial(value: NativeSeoSnapshot | null = snapshot()) {
	return createNativeSeoEditorState(target, value);
}
function start(state = updateNativeSeoDraft(initial(), intended)) {
	const started = beginNativeSeoSave(state);
	assert.ok(started.attempt);
	return { state: started.state, attempt: started.attempt };
}
function unknown(state: NativeSeoEditorState, attempt: NativeSeoSaveAttempt): NativeSeoEditorState {
	return nativeSeoEditorReducer(state, { type: "write-unknown", attempt });
}
function readback(state: NativeSeoEditorState, value: NativeSeoSnapshot) {
	const checking = beginNativeSeoReadback(state);
	assert.ok(checking.request);
	return { request: checking.request, state: nativeSeoEditorReducer(checking.state, {
		type: "readback-result", request: checking.request, snapshot: value,
	}) };
}

// Stored fields, not effective fallbacks, establish the only write baseline.
const firstBaseline = snapshot();
const isolated = initial(firstBaseline);
assert.notEqual(isolated.baseline, firstBaseline);
assert.notEqual(isolated.baseline?.values, firstBaseline.values);
assert.ok(Object.isFrozen(isolated.baseline?.values));
assert.equal(initial(null).phase, "unknown");
assert.equal(initial({ ...snapshot(), revision: "" }).baseline, null);
assert.equal(initial(snapshot("alias", before, { ...target, entryId: "entry-b" })).baseline, null);
assert.equal(initial(snapshot("foreign-principal", before, { ...target, principal: { id: "another-editor", role: 40 } })).baseline, null);
assert.throws(() => createNativeSeoEditorState({ ...target, collection: "../posts" }, null));
assert.equal(canSaveNativeSeoValues(initial()), false, "a clean editor has no write to dispatch");
assert.equal(canSaveNativeSeoValues(updateNativeSeoDraft(initial(null), { title: "Local" })), false);

// Native title/description bounds are distinct from the longer plugin Social text limits.
assert.deepEqual(validateNativeSeoDraft({ title: "t".repeat(200), description: "d".repeat(500) }), {});
assert.deepEqual(validateNativeSeoDraft({ title: "t".repeat(NATIVE_SEO_TITLE_MAX_LENGTH + 1), description: "d".repeat(NATIVE_SEO_DESCRIPTION_MAX_LENGTH + 1) }),
	{ title: "too_long", description: "too_long" });
assert.equal(canSaveNativeSeoValues(updateNativeSeoDraft(initial(), { title: "x".repeat(201) })), false);
assert.deepEqual(validateNativeSeoDraft({ image: "/_emdash/api/media/file/photo.jpg" }), {});
assert.deepEqual(validateNativeSeoDraft({ image: "https://images.example.invalid/photo.jpg?size=1200" }), {});
for (const image of ["javascript:alert(1)", "data:image/png;base64,AA", "//images.example.invalid/a.jpg", "https://user:secret@example.invalid/a.jpg", "/_emdash/api/media/file/../private", "/_emdash/api/media/file/a.jpg#fragment"]) {
	assert.deepEqual(validateNativeSeoDraft({ image }), { image: "invalid" }, image);
}
assert.deepEqual(validateNativeSeoDraft({ image: "x".repeat(NATIVE_SEO_IMAGE_MAX_LENGTH + 1) }), { image: "too_long" });
const invalidExistingImage = initial(snapshot("opaque-existing-invalid", { ...before, image: "old-unresolved-native-reference" }));
assert.equal(canSaveNativeSeoValues(updateNativeSeoDraft(invalidExistingImage, { title: "Fix title only" })), true,
	"an untouched bounded native image is preserved, not rewritten by picker validation");

const longStoredImage = "native-opaque:" + "x".repeat(NATIVE_SEO_IMAGE_MAX_LENGTH);
const longImageBaseline = initial(snapshot("opaque-long-image", { ...before, image: longStoredImage }));
assert.equal(longImageBaseline.baseline?.values.image, longStoredImage);
const longImageTitle = start(updateNativeSeoDraft(longImageBaseline, { title: "Title with old image retained" }));
assert.deepEqual(longImageTitle.attempt.patch, { title: "Title with old image retained" });
assert.equal(longImageTitle.attempt.expectedValues.image, longStoredImage, "title-only edits preserve preexisting long image bytes");
const longImageClear = start(updateNativeSeoDraft(longImageBaseline, { image: null }));
assert.deepEqual(longImageClear.attempt.patch, { image: null }, "a preexisting long image can be cleared without resubmitting it");
assert.equal(initial(snapshot("opaque-image-over-read-bound", { ...before, image: "x".repeat(NATIVE_SEO_STORED_IMAGE_MAX_LENGTH + 1) })).baseline, null);

// Omitted fields remain untouched; clearing means native inheritance, not media deletion.
const titleOnly = start(updateNativeSeoDraft(initial(), { title: "  Keep these spaces  " }));
assert.deepEqual(titleOnly.attempt.patch, { title: "  Keep these spaces  " });
assert.deepEqual(nativeSeoWriteInput(titleOnly.attempt), { seo: { title: "  Keep these spaces  " }, _rev: "opaque-a" });
assert.deepEqual(titleOnly.attempt.expectedValues, { ...before, title: "  Keep these spaces  " });
assert.deepEqual(Object.keys(nativeSeoWriteInput(titleOnly.attempt)).sort(), ["_rev", "seo"]);
assert.equal("canonical" in titleOnly.attempt.patch, false);
assert.equal("noIndex" in titleOnly.attempt.patch, false);
assert.equal("data" in nativeSeoWriteInput(titleOnly.attempt), false);
const empty = start(updateNativeSeoDraft(initial(), { title: " \n\t ", description: "", image: null }));
assert.deepEqual(empty.attempt.patch, { title: null, description: null, image: null });
assert.deepEqual(nativeSeoWriteInput(empty.attempt), { seo: { title: null, description: null, image: null }, _rev: "opaque-a" });
assert.equal("deleteMedia" in nativeSeoWriteInput(empty.attempt), false);
assert.equal(canSaveNativeSeoValues(updateNativeSeoDraft(initial(), { title: before.title })), false);
const noOtherFields = updateNativeSeoDraft(initial(), { title: "Only title", canonical: "https://example.invalid/other", noIndex: true } as Parameters<typeof updateNativeSeoDraft>[1]);
assert.deepEqual(start(noOtherFields).attempt.patch, { title: "Only title" });

const callerPatch = { title: intended.title, description: intended.description, image: intended.image };
const edited = updateNativeSeoDraft(initial(), callerPatch);
const first = start(edited);
callerPatch.title = "Caller mutation";
assert.deepEqual(first.attempt.expectedValues, intended);
assert.deepEqual(first.attempt.patch, intended);
for (const value of [first.attempt, first.attempt.patch, first.attempt.expectedValues, first.attempt.target, first.attempt.target.principal]) assert.ok(Object.isFrozen(value));
assert.throws(() => { (first.attempt.patch as { title: string }).title = "Mutated in flight"; }, TypeError);
assert.equal(beginNativeSeoSave(first.state).attempt, null);
assert.equal(beginNativeSeoReadback(first.state).request, null, "a pending write cannot be raced by recovery");
assert.equal(canCloseNativeSeoEditor(first.state), false);
assert.equal(discardNativeSeoDraft(first.state), first.state);

// Even a coherent acknowledgement is not confirmation; only a subsequent read is.
const acknowledged = nativeSeoEditorReducer(first.state, { type: "write-result", attempt: first.attempt,
	result: { outcome: "acknowledged", snapshot: snapshot("opaque-b", intended) } });
assert.equal(acknowledged.phase, "unknown");
assert.equal(acknowledged.problem, null);
assert.equal(acknowledged.baseline?.revision, "opaque-a");
assert.equal(acknowledged.attempt, first.attempt);
assert.equal(canSaveNativeSeoValues(acknowledged), false);
const confirmed = readback(acknowledged, snapshot("opaque-b", intended)).state;
assert.equal(confirmed.phase, "confirmed");
assert.equal(confirmed.baseline?.revision, "opaque-b");
assert.deepEqual(confirmed.draft, {});
assert.equal(confirmed.attempt, null);
assert.equal(canSaveNativeSeoValues(confirmed), false);
assert.equal(canCloseNativeSeoEditor(confirmed), true);
assert.equal(nativeSeoEditorReducer(confirmed, { type: "write-unknown", attempt: first.attempt }), confirmed);
assert.equal(nativeSeoEditorReducer(confirmed, { type: "snapshot", snapshot: snapshot("older-passive") }), confirmed,
	"old preview data cannot undo a readback-confirmed baseline");

// Wrong entry/principal/locale, stale revision and mismatched values cannot acknowledge a save.
for (const badSnapshot of [
	snapshot("opaque-b", intended, { ...target, entryId: "entry-b" }),
	snapshot("opaque-b", intended, { ...target, locale: "tr" }),
	snapshot("opaque-b", intended, { ...target, principal: { ...target.principal, role: 30 } }),
	snapshot("opaque-a", intended),
	snapshot("opaque-b", before),
]) {
	const refused = nativeSeoEditorReducer(first.state, { type: "write-result", attempt: first.attempt,
		result: { outcome: "acknowledged", snapshot: badSnapshot } });
	assert.equal(refused.phase, "unknown");
	assert.equal(refused.problem, "response_mismatch");
	assert.equal(refused.baseline?.revision, "opaque-a");
	assert.equal(refused.attempt, first.attempt);
	assert.deepEqual(refused.draft, intended);
}

// Timeout may leave the original request in flight; nothing is retried or discarded before a check.
const lost = unknown(first.state, first.attempt);
assert.equal(lost.phase, "unknown");
assert.equal(lost.problem, "unconfirmed");
assert.equal(discardNativeSeoDraft(lost), lost);
assert.equal(beginNativeSeoSave(lost).attempt, null);
// A check that finds the same guard and the pre-save values proves the write did not land.
const notSaved = readback(lost, snapshot()).state;
assert.equal(notSaved.phase, "editing");
assert.equal(notSaved.problem, "not_saved");
assert.equal(notSaved.attempt, null);
assert.equal(notSaved.reviewSnapshot, null);
assert.deepEqual(notSaved.draft, intended, "the attempted values stay as the draft");
assert.equal(notSaved.baseline?.revision, "opaque-a");
assert.equal(canSaveNativeSeoValues(notSaved), true);
const retried = start(notSaved);
assert.notEqual(retried.attempt, first.attempt, "a new save is a fresh attempt, never the old request replayed");
assert.deepEqual(nativeSeoWriteInput(retried.attempt), { seo: intended, _rev: "opaque-a" },
	"the fresh write carries the same guard, so the host refuses it if the original request committed meanwhile");
assert.deepEqual(discardNativeSeoDraft(notSaved).draft, {}, "Discard is available once the write is known not to have landed");
assert.equal(updateNativeSeoDraft(notSaved, { title: "Edited after the check" }).problem, null);
// The same guard with other values is incoherent and stays uncertain.
const incoherent = readback(lost, snapshot("opaque-a", intended)).state;
assert.equal(incoherent.phase, "unknown");
assert.equal(incoherent.problem, "unconfirmed");
assert.equal(incoherent.attempt, first.attempt);
assert.equal(reviewNativeSeoSave(incoherent), incoherent);
assert.equal(beginNativeSeoSave(incoherent).attempt, null);
assert.equal(discardNativeSeoDraft(incoherent), incoherent);
// The original request landing later is refused by the guard of a fresh attempt: a conflict, not an overwrite.
const lateConflict = nativeSeoEditorReducer(retried.state, { type: "write-result", attempt: retried.attempt, result: { outcome: "conflict" } });
assert.equal(lateConflict.phase, "conflict");
assert.deepEqual(lateConflict.draft, intended);
const lostThenCurrent = readback(lost, snapshot("opaque-after-timeout", intended)).state;
assert.equal(lostThenCurrent.phase, "confirmed", "fresh readback establishes current values, not which request wrote them");
const checking = beginNativeSeoReadback(lost);
assert.ok(checking.request);
assert.equal(beginNativeSeoReadback(checking.state).request, null);
assert.equal(canCloseNativeSeoEditor(checking.state), false);
assert.equal(nativeSeoEditorReducer(checking.state, { type: "write-result", attempt: first.attempt,
	result: { outcome: "acknowledged", snapshot: snapshot("opaque-b", intended) } }), checking.state,
	"an old completion cannot interrupt recovery");
const unavailable = nativeSeoEditorReducer(checking.state, { type: "readback-unavailable", request: checking.request });
assert.equal(unavailable.phase, "unknown");
assert.equal(unavailable.problem, "readback_unavailable");
assert.equal(unavailable.attempt, first.attempt);
assert.deepEqual(unavailable.draft, intended);
assert.equal(canSaveNativeSeoValues(unavailable), false);
const nextRead = beginNativeSeoReadback(unavailable);
assert.ok(nextRead.request);
assert.equal(nativeSeoEditorReducer(nextRead.state, { type: "readback-result", request: checking.request, snapshot: snapshot("opaque-b", intended) }), nextRead.state,
	"a superseded read request cannot settle a later read of the same entry");
const foreignRead = readback(lost, snapshot("opaque-foreign", intended, { ...target, entryId: "entry-b" })).state;
assert.equal(foreignRead.phase, "unknown");
assert.equal(foreignRead.problem, "response_mismatch");
assert.equal(foreignRead.reviewSnapshot, null);

// A different stored value with a fresh guard requires deliberate review; nothing retries a write.
const conflict = nativeSeoEditorReducer(first.state, { type: "write-result", attempt: first.attempt, result: { outcome: "conflict" } });
assert.equal(conflict.phase, "conflict");
assert.equal(reviewNativeSeoSave(conflict), conflict, "a refused write supplies no replacement guard");
const otherValues = { ...intended, description: "Saved by another editor" };
const reviewed = readback(conflict, snapshot("opaque-c", otherValues)).state;
assert.equal(reviewed.phase, "conflict");
assert.equal(reviewed.baseline?.revision, "opaque-a");
assert.equal(reviewed.reviewSnapshot?.revision, "opaque-c");
assert.equal(beginNativeSeoSave(reviewed).attempt, null);
const rebased = reviewNativeSeoSave(reviewed);
assert.equal(rebased.phase, "editing");
assert.equal(rebased.attempt, null);
assert.equal(rebased.baseline?.revision, "opaque-c");
assert.deepEqual(rebased.draft, { description: intended.description });
assert.equal(start(rebased).attempt.expectedRevision, "opaque-c");
assert.deepEqual(start(rebased).attempt.patch, { description: intended.description });
const discarded = reviewNativeSeoSave(reviewed, false);
assert.equal(discarded.phase, "idle");
assert.deepEqual(discarded.draft, {});
assert.equal(discarded.baseline?.revision, "opaque-c");
const rejected = nativeSeoEditorReducer(first.state, { type: "write-result", attempt: first.attempt, result: { outcome: "rejected" } });
assert.equal(rejected.phase, "editing");
assert.equal(rejected.problem, "rejected");
assert.deepEqual(rejected.draft, intended);
assert.equal(rejected.attempt, null);
const locked = nativeSeoEditorReducer(first.state, { type: "write-result", attempt: first.attempt, result: { outcome: "locked" } });
assert.equal(locked.phase, "editing", "an entry lock refusal opens no conflict review");
assert.equal(locked.problem, "locked");
assert.equal(locked.reviewSnapshot, null);
assert.equal(locked.writePending, false);
assert.equal(locked.attempt, null);
assert.deepEqual(locked.draft, intended);
assert.equal(locked.baseline, first.state.baseline, "the refused write leaves the saved guard as it was");
assert.equal(canSaveNativeSeoValues(locked), true, "saving again stays an explicit choice");
assert.equal(start(locked).attempt.expectedRevision, "opaque-a");

// Later input, including an intentional return to the old saved value, survives readback.
const newer = updateNativeSeoDraft(first.state, { title: before.title, description: "Typed during save" });
assert.equal(newer.phase, "saving");
const newerCurrent = readback(unknown(newer, first.attempt), snapshot("opaque-b", intended)).state;
assert.equal(newerCurrent.phase, "editing");
assert.deepEqual(newerCurrent.draft, { title: before.title, description: "Typed during save" });
assert.deepEqual(start(newerCurrent).attempt.patch, { title: before.title, description: "Typed during save" });
const invalidNewer = updateNativeSeoDraft(first.state, { title: "x".repeat(201) });
const invalidCurrent = readback(unknown(invalidNewer, first.attempt), snapshot("opaque-b", intended)).state;
assert.equal(invalidCurrent.draft.title?.length, 201);
assert.equal(invalidCurrent.errors.title, "too_long");
assert.equal(canSaveNativeSeoValues(invalidCurrent), false);

// Passive observations do not silently rebase edits; explicit reads remain bounded to their owner.
const passive = nativeSeoEditorReducer(edited, { type: "snapshot", snapshot: snapshot("opaque-c", otherValues) });
assert.equal(passive.phase, "conflict");
assert.equal(passive.reviewSnapshot, null);
assert.equal(reviewNativeSeoSave(passive), passive);
const freshReview = readback(passive, snapshot("opaque-d", otherValues)).state;
assert.equal(freshReview.reviewSnapshot?.revision, "opaque-d");
const initialRead = readback(initial(null), snapshot()).state;
assert.equal(initialRead.phase, "idle");
assert.equal(initialRead.baseline?.revision, "opaque-a");

for (const other of [
	{ ...target, collection: "pages" }, { ...target, entryId: "entry-b" }, { ...target, locale: "tr" },
	{ ...target, principal: { ...target.principal, id: "another-editor" } },
	{ ...target, principal: { ...target.principal, role: 30 } },
]) {
	const switched = nativeSeoEditorReducer(first.state, { type: "target", target: other, snapshot: snapshot("other-revision", before, other) });
	assert.deepEqual(switched.draft, {});
	assert.equal(switched.attempt, null);
	assert.equal(nativeSeoEditorReducer(switched, { type: "write-unknown", attempt: first.attempt }), switched);
	assert.equal(nativeSeoEditorReducer(switched, { type: "readback-result", request: checking.request, snapshot: snapshot("opaque-b", intended) }), switched);
	const returned = nativeSeoEditorReducer(switched, { type: "target", target, snapshot: snapshot("returned") });
	const latest = start(updateNativeSeoDraft(returned, intended));
	assert.notEqual(latest.attempt, first.attempt);
	assert.equal(nativeSeoEditorReducer(latest.state, { type: "write-result", attempt: first.attempt,
		result: { outcome: "acknowledged", snapshot: snapshot("opaque-b", intended) } }), latest.state,
		"A-to-B-to-A keeps late request objects fenced");
}

assert.deepEqual(discardNativeSeoDraft(edited).draft, {});
assert.equal(discardNativeSeoDraft(reviewed), reviewed, "closing or discarding cannot resolve an uncertain conflict implicitly");

// A host autosave delivers a newer saved revision while the popup holds a draft.
const rev = (counter: number) => btoa(`${counter}:synthetic`);
const observe = (state: NativeSeoEditorState, value: NativeSeoSnapshot) => nativeSeoEditorReducer(state, { type: "observed", snapshot: value });
const drafted = updateNativeSeoDraft(initial(snapshot(rev(4))), { title: "Popup title kept across autosave" });
const carried = observe(drafted, snapshot(rev(5)));
assert.equal(carried.baseline?.revision, rev(5), "equal native fields carry the draft onto the newer revision as its guard");
assert.deepEqual(carried.baseline?.values, before);
assert.deepEqual(carried.draft, { title: "Popup title kept across autosave" });
assert.equal(carried.phase, "editing");
const carriedSave = start(carried);
assert.deepEqual(nativeSeoWriteInput(carriedSave.attempt), { seo: { title: "Popup title kept across autosave" }, _rev: rev(5) },
	"the next save is a fresh guarded write with only the changed field");
const changedElsewhere = observe(drafted, snapshot(rev(5), { ...before, title: "Saved by another editor" }));
assert.equal(changedElsewhere.phase, "conflict", "different native fields open the existing review");
assert.equal(changedElsewhere.problem, "conflict");
assert.deepEqual(changedElsewhere.reviewSnapshot?.values, { ...before, title: "Saved by another editor" });
assert.equal(changedElsewhere.baseline?.revision, rev(4), "the review keeps the old guard until the editor chooses");
assert.deepEqual(changedElsewhere.draft, drafted.draft, "the draft is never dropped by an observation");
assert.equal(canSaveNativeSeoValues(changedElsewhere), false, "no write is possible before the review");
const keptAfterReview = reviewNativeSeoSave(changedElsewhere, true);
assert.equal(keptAfterReview.baseline?.revision, rev(5));
assert.deepEqual(nativeSeoWriteInput(start(keptAfterReview).attempt), { seo: { title: "Popup title kept across autosave" }, _rev: rev(5) });
const clean = initial(snapshot(rev(4)));
const refreshedClean = observe(clean, snapshot(rev(6), { ...before, description: "Saved elsewhere" }));
assert.equal(refreshedClean.phase, "idle", "without edits the newer saved values simply become the baseline");
assert.deepEqual(refreshedClean.baseline?.values, { ...before, description: "Saved elsewhere" });
const noOpDraft = updateNativeSeoDraft(clean, { description: before.description });
assert.deepEqual(observe(noOpDraft, snapshot(rev(6), { ...before, description: "Saved elsewhere" })).draft, {},
	"a draft equal to the old saved value is not an edit and cannot revert the newer value");
for (const ignored of [
	observe(drafted, snapshot(rev(4))), observe(drafted, snapshot(rev(3), { ...before, title: "Older" })),
	observe(drafted, snapshot("opaque-revision")), observe(drafted, snapshot(rev(5), before, { ...target, entryId: "entry-b" })),
]) assert.equal(ignored, drafted, "same, older, unordered or foreign revisions change nothing");
const busy = start(updateNativeSeoDraft(initial(snapshot(rev(4))), intended));
assert.equal(observe(busy.state, snapshot(rev(5))), busy.state, "a pending write keeps its own guard and outcome");
const confirmedSave = readback(unknown(busy.state, busy.attempt), snapshot(rev(5), intended)).state;
assert.equal(confirmedSave.phase, "confirmed");
const afterHostRefetch = observe(confirmedSave, snapshot(rev(7), intended));
assert.equal(afterHostRefetch.phase, "confirmed", "the readback confirmation stays until the next edit");
assert.equal(afterHostRefetch.baseline?.revision, rev(7));
assert.equal(updateNativeSeoDraft(afterHostRefetch, { title: "Next edit" }).phase, "editing");
assert.equal(observe(changedElsewhere, snapshot(rev(9))), changedElsewhere, "an open review is not replaced by a later observation");
assert.deepEqual([nativeSeoRevisionBehind(rev(4), rev(5)), nativeSeoRevisionBehind(rev(5), rev(5)), nativeSeoRevisionBehind(rev(6), rev(5))],
	[true, false, false], "a host entry at or past the adopted revision is not behind it");
assert.deepEqual([nativeSeoRevisionBehind("opaque-a", "opaque-a"), nativeSeoRevisionBehind("opaque-a", rev(5))], [false, true],
	"tokens without a counter compare only as equal or different");
console.log("Native SEO editor state self-checks passed.");
