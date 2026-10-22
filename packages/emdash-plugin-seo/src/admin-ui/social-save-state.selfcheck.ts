import assert from "node:assert/strict";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminSocialOverrideReadResult,
	type SeoAdminSocialOverrideSaveResult,
	type SeoAdminSocialOverrideSnapshot,
} from "../admin-contract.ts";
import {
	beginSocialRecovery,
	beginSocialSave,
	canCloseSocialSave,
	canSaveSocialValues,
	closeSocialSave,
	createSocialSaveState,
	reviewSocialSaveValues,
	socialSaveAcknowledgesDraft,
	socialSaveReducer,
	type SocialSaveAttempt,
	type SocialSaveState,
} from "./social-save-state.ts";
import { socialSaveNoticeMessage } from "./social-save-copy.ts";

const target = { ref: "posts:entry-a", locale: "nl" };
const header = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION };
const values = { title: "New title", description: "New description" };
function snapshot(revision: string | null, title = "Before", description = "Before description", ref = target.ref): SeoAdminSocialOverrideSnapshot {
	return { ref, revision, override: revision === null ? null : {
		storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, ref, title, description,
		updatedAt: "2026-10-15T16:00:00.000Z",
	} };
}
const initial = (canonical = snapshot("opaque-a")) => createSocialSaveState(target, { state: "ready", snapshot: canonical });
function start(state = initial(), draftIdentity: object = {}, submitted = values) {
	const next = beginSocialSave(state, { draftIdentity, values: submitted });
	assert.ok(next.attempt);
	return { state: next.state, attempt: next.attempt };
}
function saved(attempt: SocialSaveAttempt, canonical = snapshot("opaque-b", values.title, values.description), outcome: "saved" | "unchanged" = "saved"): SeoAdminSocialOverrideSaveResult {
	return { ...header, success: true, ref: attempt.target.ref, outcome, snapshot: canonical };
}
function read(canonical: SeoAdminSocialOverrideSnapshot): SeoAdminSocialOverrideReadResult {
	return { ...header, success: true, ref: canonical.ref, snapshot: canonical };
}
function unknown(state: SocialSaveState, attempt: SocialSaveAttempt): SocialSaveState {
	return socialSaveReducer(state, { type: "save-unconfirmed", attempt });
}
function recover(state: SocialSaveState, canonical: SeoAdminSocialOverrideSnapshot) {
	const checking = beginSocialRecovery(state);
	assert.ok(checking.request);
	return {
		request: checking.request,
		state: socialSaveReducer(checking.state, { type: "recovery-result", request: checking.request, result: read(canonical) }),
	};
}

// Canonical identity and proven absence are independent of effective fallbacks.
const absent = initial(snapshot(null));
assert.equal(canSaveSocialValues(absent), true);
const alias = initial(snapshot("alias-revision", "Legacy", "Legacy description", "posts:old-slug"));
assert.equal(canSaveSocialValues(alias), false);
assert.equal(alias.editing.state, "unavailable");
const inconsistent = initial({ ...snapshot("opaque-a"), revision: null });
assert.equal(canSaveSocialValues(inconsistent), false);
const external = snapshot("opaque-a");
const isolated = initial(external);
assert.ok(external.override);
external.override.title = "Mutated caller object";
assert.equal(isolated.baseline?.override?.title, "Before");

const draft = {};
const submitted = { title: "  New\n title ", description: " New\t description " };
const first = start(absent, draft, submitted);
submitted.title = "Caller changed its input";
assert.deepEqual(first.attempt.values, values);
assert.equal(first.attempt.expectedRevision, null, "a canonical create never borrows an alias revision");
assert.equal(first.attempt.target.locale, "nl");
assert.equal(beginSocialSave(first.state, { draftIdentity: {}, values }).attempt, null);
assert.equal(beginSocialRecovery(first.state).request, null);
assert.equal(canCloseSocialSave(first.state), false);
assert.equal(closeSocialSave(first.state), first.state);

// Acknowledgement needs neither a resolved preview nor another read.
const acknowledged = socialSaveReducer(first.state, { type: "save-result", attempt: first.attempt, result: saved(first.attempt) });
assert.equal(acknowledged.phase, "idle");
assert.equal(acknowledged.notice?.kind, "saved");
assert.equal(acknowledged.baseline?.revision, "opaque-b");
assert.equal(acknowledged.draftIdentity, null);
assert.equal(socialSaveAcknowledgesDraft(acknowledged, draft), true);
assert.equal(socialSaveAcknowledgesDraft(acknowledged, {}), false, "equal-looking drafts are not the submitted object");
assert.equal(canCloseSocialSave(acknowledged), true);
assert.equal(socialSaveReducer(acknowledged, { type: "editing", editing: { state: "ready", snapshot: snapshot(null) } }), acknowledged,
	"an older passive preview cannot replace the acknowledged canonical revision");

const newerDraft = {};
const editedDuringSave = socialSaveReducer(first.state, { type: "draft", draftIdentity: newerDraft });
const kept = socialSaveReducer(editedDuringSave, { type: "save-result", attempt: first.attempt, result: saved(first.attempt) });
assert.equal(kept.draftIdentity, newerDraft);
assert.equal(socialSaveAcknowledgesDraft(kept, newerDraft), false);
assert.equal(socialSaveAcknowledgesDraft(kept, draft), true);

// Lost acknowledgement blocks writes and survives dialog close without durable drafts.
const lost = unknown(editedDuringSave, first.attempt);
assert.equal(lost.phase, "unconfirmed");
assert.equal(lost.notice?.kind, "unconfirmed");
assert.equal(closeSocialSave(lost), lost);
assert.equal(lost.draftIdentity, newerDraft);
assert.equal(lost.attempt, first.attempt);
assert.equal(beginSocialSave(lost, { draftIdentity: newerDraft, values }).attempt, null);
assert.equal(socialSaveReducer(lost, { type: "editing", editing: { state: "ready", snapshot: snapshot("opaque-b", values.title, values.description) } }), lost);
const checking = beginSocialRecovery(lost);
assert.ok(checking.request);
assert.equal(beginSocialRecovery(checking.state).request, null);
assert.equal(canCloseSocialSave(checking.state), false);
assert.equal(socialSaveReducer(checking.state, { type: "save-result", attempt: first.attempt, result: saved(first.attempt) }), checking.state,
	"an earlier completion cannot interrupt an explicit recovery read");
const matched = socialSaveReducer(checking.state, { type: "recovery-result", request: checking.request,
	result: read(snapshot("opaque-recovered", values.title, values.description)) });
assert.equal(matched.notice?.kind, "current", "readback proves current values, not which request wrote them");
assert.equal(matched.baseline?.revision, "opaque-recovered");
assert.equal(matched.draftIdentity, newerDraft);
assert.equal(matched.attempt, null);
assert.equal(socialSaveReducer(matched, { type: "recovery-unavailable", request: checking.request }), matched);

// Failed/corrupt reads never become a proven empty record or start polling.
const failed = socialSaveReducer(checking.state, { type: "recovery-unavailable", request: checking.request });
assert.equal(failed.phase, "unconfirmed");
assert.equal(failed.recovery, null);
assert.equal(failed.notice?.kind, "recovery-unavailable");
assert.equal(canSaveSocialValues(failed), false);
assert.equal(closeSocialSave(failed), failed);
const unreadable = socialSaveReducer(checking.state, { type: "recovery-result", request: checking.request,
	result: { ...header, success: false, ref: target.ref, error: "record_invalid" } });
assert.equal(unreadable.phase, "unconfirmed");
assert.equal(unreadable.baseline?.revision, null);
const malformedRead = socialSaveReducer(checking.state, { type: "recovery-result", request: checking.request,
	result: read({ ...snapshot("opaque-b"), override: null }) });
assert.equal(malformedRead.phase, "unconfirmed");
assert.equal(malformedRead.notice?.error, "response_mismatch");

// Different values require a deliberate rebase; an ABA value uses its new revision.
const update = start(initial(), draft);
const pending = unknown(update.state, update.attempt);
const different = recover(pending, snapshot("opaque-c", "Another editor", "Different description")).state;
assert.equal(different.phase, "review");
assert.equal(different.baseline?.revision, "opaque-a");
assert.equal(canSaveSocialValues(different), false);
assert.equal(closeSocialSave(different), different);
const rebased = reviewSocialSaveValues(different);
assert.equal(rebased.draftIdentity, draft);
assert.equal(rebased.baseline?.revision, "opaque-c");
assert.equal(rebased.notice?.kind, "rebased");
assert.equal(start(rebased, draft).attempt.expectedRevision, "opaque-c");
const aba = recover(pending, snapshot("opaque-after-aba")).state;
assert.equal(aba.phase, "review");
assert.equal(start(reviewSocialSaveValues(aba), draft).attempt.expectedRevision, "opaque-after-aba");
const conflict = socialSaveReducer(update.state, { type: "save-result", attempt: update.attempt,
	result: { ...header, success: false, ref: target.ref, outcome: "rejected", error: "conflict" } });
assert.equal(conflict.phase, "review");
assert.equal(conflict.notice?.kind, "conflict");
assert.equal(reviewSocialSaveValues(conflict), conflict, "conflict cannot invent a fresh guard");
assert.equal(canSaveSocialValues(conflict), false);

// A clear can be confirmed as currently absent; legacy effective output is not changed here.
const clear = start(initial(), {}, { title: " ", description: "" });
const clearRead = recover(unknown(clear.state, clear.attempt), snapshot(null)).state;
assert.equal(clearRead.notice?.kind, "current");
assert.equal(clearRead.baseline?.override, null);
const noOp = start(absent, {}, { title: "", description: "" });
const unchanged = socialSaveReducer(noOp.state, { type: "save-result", attempt: noOp.attempt,
	result: saved(noOp.attempt, snapshot(null), "unchanged") });
assert.equal(unchanged.notice?.kind, "unchanged");
assert.equal(unchanged.baseline?.revision, null);

// Known rejection and uncertain response are distinct; neither schedules a write.
const rejected = socialSaveReducer(update.state, { type: "save-result", attempt: update.attempt,
	result: { ...header, success: false, ref: target.ref, outcome: "rejected", error: "title_too_long" } });
assert.equal(rejected.phase, "idle");
assert.equal(rejected.notice?.kind, "rejected");
assert.equal(rejected.draftIdentity, draft);
assert.equal(rejected.attempt, null);
assert.equal(closeSocialSave(rejected).draftIdentity, null);
const storageUnknown = socialSaveReducer(update.state, { type: "save-result", attempt: update.attempt,
	result: { ...header, success: false, ref: target.ref, outcome: "unconfirmed", error: "unconfirmed" } });
assert.equal(storageUnknown.phase, "unconfirmed");
for (const wrong of [
	{ ...saved(update.attempt), ref: "posts:other" },
	saved(update.attempt, snapshot("wrong-values")),
	saved(update.attempt, snapshot("alias", values.title, values.description, "posts:old-slug")),
]) {
	const refused = socialSaveReducer(update.state, { type: "save-result", attempt: update.attempt, result: wrong });
	assert.equal(refused.phase, "unconfirmed");
	assert.equal(refused.acknowledgedDraftIdentity, null);
}

// Explicit reads may refresh an idle baseline, but cannot silently rebase local edits.
const edited = socialSaveReducer(initial(), { type: "draft", draftIdentity: draft });
const passiveConflict = socialSaveReducer(edited, { type: "editing", editing: { state: "ready", snapshot: snapshot("new-revision") } });
assert.equal(passiveConflict.phase, "review");
const stillReview = recover(passiveConflict, snapshot("newer-revision")).state;
assert.equal(stillReview.phase, "review");
assert.equal(stillReview.baseline?.revision, "opaque-a");
const reviewRead = beginSocialRecovery(passiveConflict);
assert.ok(reviewRead.request);
const reviewReadFailed = socialSaveReducer(reviewRead.state, { type: "recovery-unavailable", request: reviewRead.request });
assert.equal(reviewReadFailed.phase, "review");
assert.equal(canSaveSocialValues(reviewReadFailed), false);
assert.equal(reviewSocialSaveValues(reviewReadFailed), reviewReadFailed, "a failed check cannot unlock an earlier conflict");
const idleRead = beginSocialRecovery(initial());
assert.ok(idleRead.request);
const idleReadFailed = socialSaveReducer(idleRead.state, { type: "recovery-unavailable", request: idleRead.request });
assert.equal(canSaveSocialValues(idleReadFailed), false, "failed current-state reading cannot leave writes enabled");
const unavailable = createSocialSaveState(target, { state: "unavailable", reason: "storage_unavailable" });
assert.equal(canSaveSocialValues(unavailable), false);
const loaded = recover(unavailable, snapshot(null)).state;
assert.equal(loaded.notice?.kind, "loaded");
assert.equal(canSaveSocialValues(loaded), true);

// Entry/locale switches fence late attempts, including A -> B -> A navigation.
const otherTarget = { ...target, locale: "tr" };
const elsewhere = socialSaveReducer(update.state, { type: "target", target: otherTarget,
	editing: { state: "ready", snapshot: snapshot("other-locale") } });
assert.equal(socialSaveReducer(elsewhere, { type: "save-result", attempt: update.attempt, result: saved(update.attempt) }), elsewhere);
const returned = socialSaveReducer(elsewhere, { type: "target", target,
	editing: { state: "ready", snapshot: snapshot("after-navigation") } });
const newest = start(returned);
assert.notEqual(newest.attempt, update.attempt, "attempt identity fences responses even when a new target restarts its sequence");
assert.equal(socialSaveReducer(newest.state, { type: "save-result", attempt: update.attempt, result: saved(update.attempt) }), newest.state);
// Loading a new target has not started guarded work; its later preview may establish the baseline.
const loadingTarget = socialSaveReducer(update.state, { type: "target", target: otherTarget,
	editing: { state: "unavailable", reason: "storage_unavailable" } });
assert.equal(canSaveSocialValues(loadingTarget), false);
const targetReady = socialSaveReducer(loadingTarget, { type: "editing",
	editing: { state: "ready", snapshot: snapshot("new-target-ready") } });
assert.equal(canSaveSocialValues(targetReady), true);
assert.equal(targetReady.baseline?.revision, "new-target-ready");
assert.equal(socialSaveReducer(targetReady, { type: "save-result", attempt: update.attempt, result: saved(update.attempt) }), targetReady);
const targetSave = start(targetReady);
assert.equal(socialSaveReducer(targetSave.state, { type: "editing", editing: { state: "ready", snapshot: snapshot(null) } }), targetSave.state,
	"once new-target work starts, passive preview responses no longer own its guard");
const freshMount = initial(snapshot("fresh-after-reload"));
assert.equal(freshMount.phase, "idle");
assert.equal(freshMount.attempt, null, "a full reload starts from a fresh authoritative baseline");

// Ordinary Close dismisses the event notice together with the local draft.
// The canonical guard and generation stay intact; reopening is not a new read.
const idleNoticeStates: readonly [string, SocialSaveState][] = [
	["saved", acknowledged],
	["unchanged", unchanged],
	["current", matched],
	["loaded", loaded],
	["rebased", rebased],
	["rejected", rejected],
	["recovery-unavailable without an attempt or draft", idleReadFailed],
];
for (const [label, state] of idleNoticeStates) {
	assert.equal(state.phase, "idle", label);
	assert.ok(state.notice, label);
	const closed = closeSocialSave(state);
	assert.equal(closed.notice, null, label + ": reopening must not repeat an old event notice");
	assert.equal(socialSaveNoticeMessage(closed.notice, false), null, label);
	assert.equal(closed.draftIdentity, null, label);
	assert.equal(closed.acknowledgedDraftIdentity, null, label);
	assert.equal(closed.baseline, state.baseline, label + ": Close does not adopt or reload a record");
	assert.equal(closed.editing, state.editing, label);
	assert.equal(closed.sequence, state.sequence, label + ": Close must not reset the stale-read fence");
	assert.equal(closed.attempt, state.attempt, label);
	assert.equal(closed.recovery, state.recovery, label);
	assert.equal(closed.reviewSnapshot, state.reviewSnapshot, label);
	assert.equal(canSaveSocialValues(closed), canSaveSocialValues(state), label);
}
const closedRebased = closeSocialSave(rebased);
assert.equal(closedRebased.baseline?.revision, "opaque-c");
assert.equal(socialSaveReducer(closedRebased, { type: "editing", editing: { state: "ready", snapshot: snapshot("older-passive") } }), closedRebased);
assert.equal(start(closedRebased).attempt.expectedRevision, "opaque-c",
	"the next deliberate save still uses the adopted revision");
for (const state of [first.state, checking.state, lost, different, conflict, failed, reviewReadFailed]) {
	assert.equal(closeSocialSave(state), state,
		state.phase + ": refusing or preserving Close must retain the exact command/draft/notice object");
}

console.log("Social save state self-checks passed.");
