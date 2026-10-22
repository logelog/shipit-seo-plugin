import assert from "node:assert/strict";

import {
	SEO_ADMIN_CONTRACT_VERSION, SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, SEO_ENGINE_VERSION,
	type SeoAdminSocialOverrideSnapshot,
} from "../admin-contract.ts";
import {
	beginSocialRecovery, beginSocialSave, canSaveSocialValues, closeSocialSave, reviewSocialSaveValues,
} from "./social-save-state.ts";
import { createSocialEditorStore, type SocialEditorStore, type SocialOverrideDraftState } from "./social-editor-store.ts";

const target = { ref: "posts:entry-a", locale: "nl" };
const header = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION };
function snapshot(revision = "revision-a", title = "Before", description = "Before description"): SeoAdminSocialOverrideSnapshot {
	return { ref: target.ref, revision, override: {
		storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, ref: target.ref, title, description,
		updatedAt: "2026-10-16T07:00:00.000Z",
	} };
}
function initialized() {
	const store = createSocialEditorStore(target);
	store.observeEditing({ state: "ready", snapshot: snapshot() });
	return store;
}
function edit(store: SocialEditorStore, title = "Unsaved title", description = "Unsaved description") {
	const draft = { customizing: true, title, description };
	store.setDraft(draft);
	store.updateState({ type: "draft", draftIdentity: draft });
	return draft;
}
function start(store: SocialEditorStore, draft: SocialOverrideDraftState) {
	const begun = beginSocialSave(store.stateRef.current, {
		draftIdentity: draft, values: { title: draft.title ?? "", description: draft.description ?? "" },
	});
	store.installState(begun.state);
	assert.ok(begun.attempt);
	return begun.attempt;
}
let cases = 0;

// Detaching observers does not discard a form-owned draft or its baseline.
{
	const store = initialized();
	const draft = edit(store, "دليل Dental 123", "A long unsaved description");
	const baseline = store.stateRef.current.baseline;
	const previewOwner = store.previewOwnerRef.current;
	const stop = store.subscribe(() => {});
	const release = store.retain();
	stop(); release();
	await Promise.resolve();
	assert.equal(store.live(), true);
	assert.equal(store.getSnapshot().draft, draft);
	assert.equal(store.stateRef.current.draftIdentity, draft);
	assert.equal(store.stateRef.current.baseline, baseline);
	assert.equal(store.previewOwnerRef.current, previewOwner);
	store.dispose(); cases++;
}

// A second view sees the synchronous pending gate before the first emits.
{
	const store = initialized(); const draft = edit(store);
	let blocked = false;
	const stop = store.subscribe(() => {
		if (store.stateRef.current.phase === "saving") blocked = beginSocialSave(store.stateRef.current, {
			draftIdentity: draft, values: { title: "Second request", description: "" },
		}).attempt === null;
	});
	start(store, draft); assert.equal(blocked, true);
	stop(); store.dispose(); cases++;
}

// A result delivered while no view exists is visible to the next subscriber.
{
	const store = initialized(); const draft = edit(store);
	const attempt = start(store, draft); const epoch = store.previewEpochRef.current;
	let oldNotices = 0; const stopOld = store.subscribe(() => { oldNotices++; }); stopOld();
	store.settle({ type: "save-result", attempt, result: { ...header, success: true, ref: target.ref,
		outcome: "saved", snapshot: snapshot("revision-b", draft.title, draft.description) } });
	let newNotices = 0; const stopNew = store.subscribe(() => { newNotices++; });
	assert.equal(store.stateRef.current.phase, "idle");
	assert.equal(store.stateRef.current.baseline?.revision, "revision-b");
	assert.equal(store.getSnapshot().draft, null);
	assert.equal(store.stateRef.current.acknowledgedDraftIdentity, draft);
	assert.ok(store.previewEpochRef.current > epoch);
	assert.equal(oldNotices, 0); assert.equal(newNotices, 0);
	stopNew(); store.dispose(); cases++;
}

// Acknowledgement clears only the exact submitted draft, not later typing.
{
	const store = initialized(); const submitted = edit(store); const attempt = start(store, submitted);
	const newer = edit(store, "Typed after submit");
	store.settle({ type: "save-result", attempt, result: { ...header, success: true, ref: target.ref,
		outcome: "saved", snapshot: snapshot("revision-b", submitted.title, submitted.description) } });
	assert.equal(store.getSnapshot().draft, newer);
	assert.equal(store.stateRef.current.draftIdentity, newer);
	assert.equal(store.stateRef.current.acknowledgedDraftIdentity, submitted);
	store.dispose(); cases++;
}

// Unknown and review survive observer detachment; fresh reads require adoption.
{
	const store = initialized(); const draft = edit(store); const attempt = start(store, draft);
	store.settle({ type: "save-unconfirmed", attempt });
	const unknown = store.stateRef.current;
	assert.equal(unknown.phase, "unconfirmed");
	store.installState(closeSocialSave(unknown));
	assert.equal(store.getSnapshot().draft, draft);
	assert.equal(canSaveSocialValues(store.stateRef.current), false);
	const checking = beginSocialRecovery(store.stateRef.current); assert.ok(checking.request);
	store.installState(checking.state);
	const stop = store.subscribe(() => {}); stop();
	store.settle({ type: "recovery-result", request: checking.request, result: { ...header, success: true,
		ref: target.ref, snapshot: snapshot("revision-c", "Another saved title", "Another saved description") } });
	assert.equal(store.stateRef.current.phase, "review");
	assert.equal(store.stateRef.current.attempt, attempt);
	assert.equal(store.stateRef.current.reviewSnapshot?.revision, "revision-c");
	assert.equal(store.getSnapshot().draft, draft);
	store.installState(closeSocialSave(store.stateRef.current));
	assert.equal(canSaveSocialValues(store.stateRef.current), false);
	store.installState(reviewSocialSaveValues(store.stateRef.current));
	assert.equal(canSaveSocialValues(store.stateRef.current), true);
	assert.equal(store.stateRef.current.baseline?.revision, "revision-c");
	assert.equal(store.getSnapshot().draft, draft);
	store.dispose(); cases++;
}

// Revocation clears values and drops a late acknowledgement and later edits.
{
	const store = initialized(); const draft = edit(store); const attempt = start(store, draft);
	store.dispose(); const disposed = store.getSnapshot();
	assert.equal(store.live(), false);
	assert.equal(disposed.draft, null);
	assert.equal(disposed.state.baseline, null);
	assert.equal(disposed.state.attempt, null);
	assert.equal(disposed.state.reviewSnapshot, null);
	store.settle({ type: "save-result", attempt, result: { ...header, success: true, ref: target.ref,
		outcome: "saved", snapshot: snapshot("revision-b", draft.title, draft.description) } });
	store.setDraft(draft); store.updateState({ type: "draft", draftIdentity: draft });
	assert.equal(store.getSnapshot(), disposed);
	store.dispose(); cases++;
}

// Effect replay re-retains a local store; its final release really ends it.
{
	const store = createSocialEditorStore(target, { disposeWhenReleased: true });
	const first = store.retain(); edit(store); first();
	const second = store.retain(); await Promise.resolve();
	assert.equal(store.live(), true); assert.ok(store.getSnapshot().draft);
	second(); second(); await Promise.resolve();
	assert.equal(store.live(), false); assert.equal(store.getSnapshot().draft, null);
	cases++;
}

// The same passive observation never churns an external-store snapshot.
{
	const store = createSocialEditorStore(target);
	const editing = { state: "ready" as const, snapshot: snapshot() };
	store.observeEditing(editing); const first = store.getSnapshot();
	store.observeEditing(editing); assert.equal(store.getSnapshot(), first);
	assert.equal(store.getSnapshot(), first);
	store.dispose(); cases++;
}
console.log(`Social editor store self-checks passed (${cases} cases).`);
