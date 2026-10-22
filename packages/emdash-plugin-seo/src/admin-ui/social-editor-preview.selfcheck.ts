import assert from "node:assert/strict";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminSocialOverrideSnapshot,
} from "../admin-contract.ts";
import {
	buildSocialEditorPreview,
	type SocialEditorPreviewInput,
	type SocialEditorPreviewLoaded,
} from "./social-editor-preview.ts";
import { SOCIAL_PREVIEW_PROFILES } from "./social-preview-model.ts";
import {
	beginSocialRecovery,
	beginSocialSave,
	createSocialSaveState,
	socialSaveReducer,
	type SocialSaveState,
} from "./social-save-state.ts";

const target = { ref: "posts:entry-a", locale: "nl" };
const header = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION };
function snapshot(revision: string | null, title: string | null = "Saved title", description: string | null = "Saved description"): SeoAdminSocialOverrideSnapshot {
	return { ref: target.ref, revision, override: revision === null ? null : {
		storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, ref: target.ref,
		title, description, updatedAt: "2026-10-15T16:00:00.000Z",
	} };
}
const canonical = snapshot("revision-a");
const initial = (value = canonical) => createSocialSaveState(target, { state: "ready", snapshot: value });
function loaded(value = canonical): SocialEditorPreviewLoaded {
	return {
		target: { ...target },
		preview: {
			content: { ref: target.ref, entryId: "entry-a", collection: "posts", collectionLabel: "Posts",
				title: "Content title", slug: "story" },
			search: { title: "Search title", description: "Search description", url: "https://example.test/nl/story",
				titleLength: 12, descriptionLength: 18 },
			social: {
				editing: { state: "ready", snapshot: value },
				title: value.override?.title ?? "Alias title",
				description: value.override?.description ?? "Alias description",
				image: "https://example.test/retained.jpg",
				fallbackTitle: "Core fallback title", fallbackDescription: "Core fallback description",
				override: { title: value.override?.title ?? null, description: value.override?.description ?? null,
					updatedAt: value.override?.updatedAt ?? null },
			},
			sources: { title: "content", description: "content", socialTitle: "plugin-social-override",
				socialDescription: "plugin-social-override", image: "content", canonical: "content" },
		},
	};
}
function render(input: Partial<SocialEditorPreviewInput> = {}) {
	return buildSocialEditorPreview({ target, state: initial(), draft: null, loaded: loaded(),
		platform: "facebook", ...input });
}
function start(state: SocialSaveState, values = { title: "Local title", description: "Local description" }) {
	const next = beginSocialSave(state, { draftIdentity: {}, values });
	assert.ok(next.attempt);
	return { state: next.state, attempt: next.attempt };
}
function acknowledge(state: SocialSaveState, value: SeoAdminSocialOverrideSnapshot) {
	const next = start(state, { title: value.override?.title ?? "", description: value.override?.description ?? "" });
	return socialSaveReducer(next.state, { type: "save-result", attempt: next.attempt,
		result: { ...header, ref: target.ref, success: true, outcome: "saved", snapshot: value } });
}
function retainedMedia(model: ReturnType<typeof render>) {
	assert.equal(model.model.fields.image.value, "https://example.test/retained.jpg");
	assert.equal(model.model.fields.url.value, "https://example.test/nl/story");
	assert.equal(model.fieldBasis.image, "loaded");
	assert.equal(model.fieldBasis.url, "loaded");
}

for (const platform of ["facebook", "x"] as const) {
	const healthy = render({ platform });
	assert.equal(healthy.model.fields.title.value, "Saved title");
	assert.equal(healthy.model.fields.description.value, "Saved description");
	assert.equal(healthy.fieldBasis.title, "confirmed");
	assert.equal(healthy.fieldBasis.description, "confirmed");
	assert.equal(healthy.context.metadataCurrent, true);
	assert.equal(healthy.model.isDraft, false);
	assert.equal(healthy.model.profile, SOCIAL_PREVIEW_PROFILES[platform]);
	retainedMedia(healthy);

	const draft = render({ platform, draft: { customizing: true, title: "  Local\n title  " } });
	assert.equal(draft.model.fields.title.value, "Local title");
	assert.equal(draft.fieldBasis.title, "local");
	assert.equal(draft.model.fields.description.value, "Saved description");
	assert.equal(draft.fieldBasis.description, "confirmed");
	assert.equal(draft.context.hasLocalChanges, true);
	assert.equal(draft.model.isDraft, true);
	retainedMedia(draft);
}

// Acknowledgement updates text without waiting for the old metadata query.
const acknowledged = acknowledge(initial(), snapshot("revision-b", "Confirmed new title", "Confirmed new description"));
for (const previewError of [false, true]) {
	const behind = render({ state: acknowledged, previewError });
	assert.equal(behind.model.fields.title.value, "Confirmed new title");
	assert.equal(behind.model.fields.description.value, "Confirmed new description");
	assert.equal(behind.fieldBasis.title, "confirmed");
	assert.equal(behind.fieldBasis.description, "confirmed");
	assert.equal(behind.context.metadataCurrent, false);
	assert.equal(behind.context.metadataNeedsRefresh, true);
	assert.equal(behind.model.isDraft, false);
	retainedMedia(behind);
}
const noMetadata = render({ state: acknowledged, loaded: null, previewError: true });
assert.equal(noMetadata.model.fields.title.value, "Confirmed new title");
assert.equal(noMetadata.fieldBasis.title, "confirmed");
assert.equal(noMetadata.fieldBasis.image, "unavailable");
assert.equal(noMetadata.model.fields.image.state, "unavailable");
assert.match(noMetadata.caption, /image and URL are unavailable/);

const pending = start(initial());
const unknown = socialSaveReducer(pending.state, { type: "save-unconfirmed", attempt: pending.attempt });
const checking = beginSocialRecovery(unknown);
assert.ok(checking.request);
const review = socialSaveReducer(checking.state, { type: "recovery-result", request: checking.request,
	result: { ...header, ref: target.ref, success: true,
		snapshot: snapshot("revision-other", "Another editor", "Another description") } });
assert.equal(review.phase, "review");
for (const state of [pending.state, unknown, checking.state, review]) {
	const visible = render({ state, previewError: true,
		draft: { customizing: true, title: "Local title", description: "Local description" } });
	assert.equal(visible.model.fields.title.value, "Local title");
	assert.equal(visible.model.fields.description.value, "Local description");
	assert.equal(visible.fieldBasis.title, "local");
	assert.equal(visible.fieldBasis.description, "local");
	assert.equal(visible.context.persistenceUncertain, true);
	assert.doesNotMatch(visible.caption, /unsaved|saved successfully/i);
	retainedMedia(visible);
}
const sameLocal = render({ state: unknown,
	draft: { customizing: true, title: "Saved title", description: "Saved description" } });
assert.equal(sameLocal.fieldBasis.title, "local", "unknown confirmation is not proof that equal local text is unsaved");
assert.equal(sameLocal.context.hasLocalChanges, false);
const reviewOldMetadata = render({ state: review });
assert.equal(reviewOldMetadata.context.metadataCurrent, false, "known different current values make matching old metadata stale");
assert.equal(reviewOldMetadata.model.fields.title.value, "Saved title", "read-only review does not silently adopt another writer's text");

const recovered = socialSaveReducer(checking.state, { type: "recovery-result", request: checking.request,
	result: { ...header, ref: target.ref, success: true,
		snapshot: snapshot("revision-recovered", "Local title", "Local description") } });
const recoveredCard = render({ state: recovered, previewError: true });
assert.equal(recovered.notice?.kind, "current");
assert.equal(recoveredCard.model.fields.title.value, "Local title");
assert.equal(recoveredCard.fieldBasis.title, "confirmed");
assert.equal(recoveredCard.context.metadataCurrent, false);
retainedMedia(recoveredCard);

const unavailableRead = socialSaveReducer(checking.state, { type: "recovery-unavailable", request: checking.request });
const failedRead = render({ state: unavailableRead });
assert.equal(failedRead.context.metadataCurrent, false);
assert.equal(failedRead.model.fields.title.value, "Saved title", "a failed read does not erase prior confirmed canonical text");
retainedMedia(failedRead);

// Partial clears use the reported non-Social fallback while the other canonical field masks aliases.
const partialClear = render({ draft: { customizing: true, title: "" } });
assert.equal(partialClear.model.fields.title.value, "Core fallback title");
assert.equal(partialClear.fieldBasis.title, "loaded");
assert.equal(partialClear.model.fields.description.value, "Saved description");
assert.equal(partialClear.fieldBasis.description, "confirmed");
assert.equal(partialClear.context.clearMayRevealAlias, false);
assert.equal(partialClear.model.isDraft, true);
const noFallback = render({ loaded: null, draft: { customizing: true, title: "" } });
assert.equal(noFallback.fieldBasis.title, "unavailable");
assert.equal(noFallback.model.fields.description.value, "Saved description");

for (const draft of [
	{ customizing: false },
	{ customizing: true, title: "", description: "" },
]) {
	const clearing = render({ draft });
	assert.equal(clearing.context.clearMayRevealAlias, true);
	assert.equal(clearing.model.fields.title.state, "unavailable");
	assert.equal(clearing.model.fields.description.state, "unavailable");
	assert.equal(clearing.fieldBasis.title, "unavailable");
	assert.equal(clearing.fieldBasis.description, "unavailable");
	assert.equal(clearing.model.isDraft, true);
	retainedMedia(clearing);
}
const descriptionOnly = snapshot("description-only", null, "Only canonical description");
const crossFieldClear = render({ state: initial(descriptionOnly), loaded: loaded(descriptionOnly),
	draft: { customizing: true, description: "" } });
assert.equal(crossFieldClear.model.fields.title.state, "unavailable",
	"clearing the last canonical field may change an untouched title through an alias");
assert.equal(crossFieldClear.model.fields.description.state, "unavailable");

// Null revisions cannot distinguish an old absent snapshot from absence after a create/delete cycle.
const absence = snapshot(null);
const oldAbsentMetadata = loaded(absence);
const created = acknowledge(initial(absence), snapshot("created-after-absence", "Temporary", "Temporary description"));
const cleared = acknowledge(created, absence);
assert.equal(cleared.sequence, 2);
const staleAbsence = render({ state: cleared, loaded: oldAbsentMetadata });
assert.equal(staleAbsence.context.metadataCurrent, false);
assert.equal(staleAbsence.context.clearMayRevealAlias, true);
assert.equal(staleAbsence.model.fields.title.state, "unavailable");
assert.equal(staleAbsence.model.fields.description.state, "unavailable");
retainedMedia(staleAbsence);
const afterClear = loaded(absence);
afterClear.preview.social.title = "Newly resolved alias title";
afterClear.preview.social.description = "Newly resolved alias description";
afterClear.receivedAfterCanonicalChange = true;
const freshAbsence = render({ state: cleared, loaded: afterClear });
assert.equal(freshAbsence.context.metadataCurrent, true);
assert.equal(freshAbsence.context.clearMayRevealAlias, false);
assert.equal(freshAbsence.model.fields.title.value, "Newly resolved alias title");
assert.equal(freshAbsence.fieldBasis.title, "loaded");

const afterClearAttempt = start(cleared);
for (const error of ["invalid_values", "conflict"] as const) {
	const replacedNotice = socialSaveReducer(afterClearAttempt.state, { type: "save-result",
		attempt: afterClearAttempt.attempt, result: { ...header, ref: target.ref, success: false,
			outcome: "rejected", error } });
	assert.ok(replacedNotice.notice?.kind === "rejected" || replacedNotice.notice?.kind === "conflict");
	const afterRejection = render({ state: replacedNotice, loaded: oldAbsentMetadata });
	assert.equal(afterRejection.context.metadataCurrent, false);
	assert.equal(afterRejection.model.fields.title.state, "unavailable",
		"replacing the notice cannot make metadata from before the clear fresh");
}
const initialAbsence = render({ state: initial(absence), loaded: oldAbsentMetadata });
assert.equal(initialAbsence.context.metadataCurrent, true);
assert.equal(initialAbsence.model.fields.title.value, "Alias title", "initial correlated absent metadata remains usable");
const initialCreate = render({ state: start(initial(absence)).state, loaded: oldAbsentMetadata,
	draft: { customizing: true, title: "Creating locally", description: "" } });
assert.equal(initialCreate.fieldBasis.title, "local");
assert.equal(initialCreate.context.metadataCurrent, false);
retainedMedia(initialCreate);

const noBaseline = createSocialSaveState(target, { state: "unavailable", reason: "storage_unavailable" });
const draftWithoutBaseline = render({ state: noBaseline, previewError: true,
	draft: { customizing: true, title: "Independent local title" } });
assert.equal(draftWithoutBaseline.model.fields.title.value, "Independent local title");
assert.equal(draftWithoutBaseline.fieldBasis.title, "local");
assert.equal(draftWithoutBaseline.model.fields.description.value, "Core fallback description");
retainedMedia(draftWithoutBaseline);
const unknownClear = render({ state: noBaseline, draft: { customizing: false } });
assert.equal(unknownClear.model.fields.title.state, "unavailable");
assert.equal(unknownClear.model.fields.description.state, "unavailable");

const otherTarget = { ref: "posts:entry-b", locale: "nl" };
const otherEntry = render({ target: otherTarget,
	draft: { customizing: true, title: "Do not leak this draft" } });
assert.equal(otherEntry.context.targetMismatch, true);
for (const field of ["title", "description", "image", "url"] as const) {
	assert.equal(otherEntry.model.fields[field].state, "unavailable");
}
const otherLocale = render({ target: { ...target, locale: "en" },
	draft: { customizing: true, title: "Do not leak this locale" } });
assert.equal(otherLocale.model.fields.title.state, "unavailable");
assert.equal(otherLocale.model.fields.image.state, "unavailable");
const wronglyLabelledMetadata = loaded();
wronglyLabelledMetadata.preview.content.ref = "posts:entry-b";
assert.equal(render({ loaded: wronglyLabelledMetadata }).model.fields.image.state, "unavailable");
const oldLocaleMetadata = loaded();
oldLocaleMetadata.target.locale = "en";
const currentCanonical = render({ loaded: oldLocaleMetadata });
assert.equal(currentCanonical.model.fields.title.value, "Saved title");
assert.equal(currentCanonical.fieldBasis.title, "confirmed");
assert.equal(currentCanonical.model.fields.image.state, "unavailable");
assert.equal(currentCanonical.context.targetMismatch, true);

for (const text of [
	"Short Latin title",
	"Wide WWWWWWWW title",
	"\u6f22\u5b57".repeat(100),
	"Cafe\u0301 with \u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}",
	"W".repeat(300),
]) {
	const input: SocialEditorPreviewInput = { target, state: initial(), loaded: loaded(), platform: "facebook",
		draft: { customizing: true, title: text, description: "D".repeat(1000) } };
	const before = structuredClone(input);
	const result = buildSocialEditorPreview(input);
	assert.equal(result.model.fields.title.value, text, "card fitting never truncates the form value");
	assert.equal(result.model.fields.description.value?.length, 1000);
	assert.ok(result.model.fittedTitle.lines.length <= result.model.profile.title.lineCount);
	assert.ok(result.model.fittedDescription.lines.length <= result.model.profile.description.lineCount);
	assert.equal(result.model.profile.approximate, true);
	assert.deepEqual(input, before, "local preview leaves state, snapshots and form fields unchanged");
}
