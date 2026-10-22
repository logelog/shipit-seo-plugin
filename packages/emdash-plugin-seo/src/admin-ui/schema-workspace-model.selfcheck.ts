import assert from "node:assert/strict";

import {
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	type SeoAdminCustomSchema,
	type SeoAdminSchemaConfiguration,
	type SeoAdminSchemaContentTypeConfiguration,
	type SeoAdminSchemaPresetConfiguration,
	type SeoAdminSchemaPresetValues,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { createSeoSchemaComposerDraft } from "./schema-composer-view-model.ts";
import {
	createSchemaWorkspaceMutationGate,
	createSchemaWorkspacePresetDraft,
	schemaWorkspacePresetReviewRequired,
	captureSchemaWorkspaceAttempt,
	schemaWorkspaceReviewedIdentity,
	patchSchemaWorkspacePresets,
	reconcileSchemaWorkspacePresetDraft,
	schemaWorkspacePresetDraftDirty,
	type SchemaWorkspacePresetDraftState,
	removeSchemaWorkspaceCustom,
	schemaComposerDraftDirty,
	schemaWorkspaceRoute,
	schemaWorkspaceScopeLabel,
	schemaWorkspaceSectionForRoute,
	upsertSchemaWorkspaceCustom,
} from "./schema-workspace-model.ts";

function custom(id: string, name = id): SeoAdminCustomSchema {
	return {
		id,
		name,
		scope: "posts",
		json: '{"@context":"https://schema.org","@type":"Article"}',
		enabled: true,
		storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		types: ["Article"],
		valid: true,
		validationError: null,
		createdAt: "2026-10-16T10:00:00.000Z",
		updatedAt: "2026-10-16T10:00:00.000Z",
	};
}

function contentTypes(revision: string): SeoAdminSchemaContentTypeConfiguration {
	return {
		storageVersion: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
		updatedAt: "2026-10-16T10:00:00.000Z",
		revision,
		record: "valid",
		writable: true,
		discoveryAvailable: true,
		discoveredCount: 2,
		items: [
			{ collection: "posts", label: "Blog posts", role: "blogPosting", source: "saved" },
			{ collection: "pages", label: "Pages", role: "webPage", source: "saved" },
		],
		unlisted: [{ collection: "removed-collection", role: "service" }],
	};
}

function presets(updatedAt: string): SeoAdminSchemaPresetConfiguration {
	return {
		storageVersion: SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
		revision: updatedAt,
		record: "valid",
		writable: true,
		updatedAt,
		migrationNeeded: false,
		items: [],
	};
}

function freeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}

const before: SeoAdminSchemaConfiguration = freeze({
	contentTypes: contentTypes("mapping-before"),
	presets: presets("2026-10-16T10:00:00.000Z"),
	customSchemaStorageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	customSchemas: [custom("editing", "Before edit"), custom("unrelated", "Before another edit")],
	hasMore: false,
});
const snapshot = JSON.stringify(before);
const newerMapping = freeze(contentTypes("mapping-saved-while-away"));
const newerPresets = freeze(presets("2026-10-16T10:01:00.000Z"));
const newerUnrelated = freeze(custom("unrelated", "Another editor's saved name"));
const addedWhileAway = freeze(custom("created-while-away"));
const current: SeoAdminSchemaConfiguration = freeze({
	...before,
	contentTypes: newerMapping,
	presets: newerPresets,
	customSchemas: [before.customSchemas[0]!, newerUnrelated, addedWhileAway],
	hasMore: true,
});

// A request starts on the old snapshot; its result settles after other owners change.
const savedEdit = freeze(custom("editing", "Our confirmed saved edit"));
const afterEdit = upsertSchemaWorkspaceCustom(current, savedEdit);
assert.equal(afterEdit.contentTypes, newerMapping, "a late custom save retains the newer content mapping");
assert.equal(afterEdit.presets, newerPresets, "a late custom save retains newer presets");
assert.equal(afterEdit.customSchemas.find((item) => item.id === newerUnrelated.id), newerUnrelated,
	"a late custom save does not replace another record with the request-start copy");
assert.equal(afterEdit.customSchemas.find((item) => item.id === addedWhileAway.id), addedWhileAway,
	"a custom record created during the pending save stays in the list");
assert.equal(afterEdit.customSchemas[0], savedEdit);
assert.equal(afterEdit.customSchemas.filter((item) => item.id === savedEdit.id).length, 1);
assert.equal(afterEdit.hasMore, true, "the currently known overflow is preserved");
assert.equal(afterEdit.customSchemaStorageVersion, current.customSchemaStorageVersion);
assert.equal(current.customSchemas[0]?.name, "Before edit", "the previous cache is not mutated");

const savedPresetResult = freeze(presets("2026-10-16T10:02:00.000Z"));
const afterPresets = patchSchemaWorkspacePresets(afterEdit, savedPresetResult);
assert.equal(afterPresets.presets, savedPresetResult, "only the confirmed preset result is adopted");
assert.equal(afterPresets.contentTypes, newerMapping, "a pending preset save cannot restore an old mapping");
assert.equal(afterPresets.customSchemas, afterEdit.customSchemas,
	"a pending preset save keeps custom records confirmed while it was in flight");
assert.equal(afterPresets.hasMore, true);

const afterDelete = removeSchemaWorkspaceCustom(afterPresets, "editing");
assert.equal(afterDelete.customSchemas.some((item) => item.id === "editing"), false);
assert.equal(afterDelete.customSchemas.find((item) => item.id === "unrelated"), newerUnrelated,
	"a late deletion keeps another record's newer saved version");
assert.equal(afterDelete.customSchemas.find((item) => item.id === addedWhileAway.id), addedWhileAway,
	"a late deletion keeps records absent from its request-start list");
assert.equal(afterDelete.contentTypes, newerMapping);
assert.equal(afterDelete.presets, savedPresetResult);
assert.equal(afterDelete.hasMore, true);
assert.equal(removeSchemaWorkspaceCustom(afterDelete, "already-removed"), afterDelete,
	"an absent deletion does not replace the current cache");
assert.equal(JSON.stringify(before), snapshot, "all request-start state remains unchanged");

assert.equal(schemaWorkspaceScopeLabel("global", newerMapping), "All pages");
assert.equal(schemaWorkspaceScopeLabel("posts", newerMapping), "Blog posts");
assert.equal(schemaWorkspaceScopeLabel("pages:contact", newerMapping), "Pages: contact");
assert.equal(schemaWorkspaceScopeLabel("posts:01M50QF1J9JDP1CCYXV18VD8WB", newerMapping),
	"Blog posts: 01M50QF1J9JDP1CCYXV18VD8WB", "entry identifiers are not presented as fetched titles");
assert.equal(schemaWorkspaceScopeLabel("archived:old-entry", newerMapping), "archived:old-entry",
	"an unknown collection keeps its exact raw scope");
assert.equal(schemaWorkspaceScopeLabel("removed-collection", newerMapping), "removed-collection",
	"an unlisted saved role does not become an invented collection label");
assert.equal(schemaWorkspaceScopeLabel("posts:", newerMapping), "posts:", "an incomplete saved scope is not repaired for display");
assert.equal(schemaWorkspaceScopeLabel(" posts ", newerMapping), " posts ", "unknown saved values are not normalized");
assert.equal(schemaWorkspaceScopeLabel("", newerMapping), "");
assert.equal(schemaWorkspaceScopeLabel("posts", { ...newerMapping, discoveryAvailable: false }), "posts",
	"unavailable discovery does not reuse a label as though it were current");
assert.equal(schemaWorkspaceScopeLabel("posts", {
	...newerMapping,
	items: [{ ...newerMapping.items[0]!, label: "   " }],
}), "posts", "an empty label retains the raw key");

const baseline = createSeoSchemaComposerDraft("howTo");
assert.equal(schemaComposerDraftDirty(createSeoSchemaComposerDraft("howTo"), baseline), false,
	"independently created defaults are clean");
const reordered = { ...baseline, input: { ...baseline.input, values: Object.fromEntries(Object.entries(baseline.input.values).reverse()) } };
assert.equal(schemaComposerDraftDirty(reordered, baseline), false, "value key insertion order is immaterial");
assert.equal(schemaComposerDraftDirty({ ...baseline, input: { ...baseline.input, schemaName: baseline.input.schemaName + " " } }, baseline), true,
	"even unfinished whitespace in a name is retained until discard");
assert.equal(schemaComposerDraftDirty({ ...baseline, scope: { ...baseline.scope, entry: "unfinished-entry" } }, baseline), true);
assert.equal(schemaComposerDraftDirty({ ...baseline, scope: { ...baseline.scope, mode: "global" } }, baseline), true);
assert.equal(schemaComposerDraftDirty({ ...baseline, input: { ...baseline.input, enabled: !baseline.input.enabled } }, baseline), true);
assert.equal(schemaComposerDraftDirty({
	...baseline,
	input: { ...baseline.input, values: { ...baseline.input.values, steps: "First step" } },
}, baseline), true, "a recipe-specific value makes the draft dirty");
assert.equal(schemaComposerDraftDirty({
	...baseline,
	input: { ...baseline.input, values: { ...baseline.input.values, name: undefined } },
}, baseline), true, "removing a default variable also makes the draft dirty");
assert.equal(schemaComposerDraftDirty(createSeoSchemaComposerDraft("event"), baseline), true);
assert.equal(baseline.input.values.name, "{{title}}", "dirty comparison never rewrites the input");

const presetChoicesA = freeze(Object.fromEntries(
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((item) => [item.key, false]),
) as SeoAdminSchemaPresetValues);
const presetChoicesB = freeze({ ...presetChoicesA, website: true });
const presetSnapshot = (revision: string, choices: SeoAdminSchemaPresetValues): SeoAdminSchemaPresetConfiguration => ({
	...presets(revision),
	revision,
	items: SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((item) => ({ ...item, enabled: choices[item.key] })),
});
const savedA = freeze(presetSnapshot("revision-a", presetChoicesA));
const equalValuesNewRevision = freeze(presetSnapshot("revision-b", presetChoicesA));
const changedValuesNewRevision = freeze(presetSnapshot("revision-c", presetChoicesB));
const cleanPresetState = freeze(createSchemaWorkspacePresetDraft(savedA));
const cleanSnapshot = JSON.stringify(cleanPresetState);
assert.equal(reconcileSchemaWorkspacePresetDraft(cleanPresetState, equalValuesNewRevision), cleanPresetState,
	"an equal-value update from another writer cannot silently authorize overwrite");
assert.equal(reconcileSchemaWorkspacePresetDraft(cleanPresetState, changedValuesNewRevision), cleanPresetState,
	"a clean form also keeps the revision the user reviewed");
assert.equal(schemaWorkspacePresetReviewRequired(cleanPresetState, equalValuesNewRevision), true);
assert.equal(schemaWorkspacePresetReviewRequired(cleanPresetState, savedA), false);
assert.equal(reconcileSchemaWorkspacePresetDraft(cleanPresetState, savedA), cleanPresetState);
assert.equal(JSON.stringify(cleanPresetState), cleanSnapshot);
const dirtyPresetState = freeze({ ...cleanPresetState, draft: { ...presetChoicesA, service: true } });
assert.equal(schemaWorkspacePresetDraftDirty(dirtyPresetState), true);
assert.equal(reconcileSchemaWorkspacePresetDraft(dirtyPresetState, changedValuesNewRevision), dirtyPresetState);
assert.equal(dirtyPresetState.revision, "revision-a");
const explicitlyKept = freeze(createSchemaWorkspacePresetDraft(changedValuesNewRevision, dirtyPresetState.draft));
assert.equal(explicitlyKept.revision, "revision-c", "only explicit review adopts the new revision");
assert.equal(explicitlyKept.draft, dirtyPresetState.draft, "explicit rebase keeps the user's choices");
assert.equal(schemaWorkspacePresetDraftDirty(explicitlyKept), true);
const explicitlyUsed = createSchemaWorkspacePresetDraft(changedValuesNewRevision);
assert.equal(schemaWorkspacePresetDraftDirty(explicitlyUsed), false);
assert.equal(explicitlyUsed.draft.website, true);
assert.equal(schemaWorkspacePresetReviewRequired(explicitlyKept, changedValuesNewRevision), false);
const unavailable = { ...changedValuesNewRevision, revision: null, record: "unavailable" as const, writable: false };
assert.equal(schemaWorkspacePresetReviewRequired(explicitlyKept, unavailable), true);
assert.equal(reconcileSchemaWorkspacePresetDraft(explicitlyKept, unavailable), explicitlyKept,
	"an unavailable read cannot become absence or a reviewed writable baseline");

const commandValues = { name: "Original", scope: "global", json: "{}", enabled: true };
const attempted = captureSchemaWorkspaceAttempt({
	kind: "custom" as const, source: "raw" as const,
	command: { ...commandValues, id: "schema-stable", expectedRevision: null },
});
commandValues.name = "Later input";
assert.equal(attempted.command.name, "Original");
assert.equal(attempted.command.id, "schema-stable", "the exact create ID survives unknown-outcome review");
assert.equal(Object.isFrozen(attempted), true);
assert.equal(Object.isFrozen(attempted.command), true);
const presetInput = { ...presetChoicesB };
const presetAttempt = captureSchemaWorkspaceAttempt({
	kind: "presets" as const, source: "save" as const,
	command: { values: presetInput, expectedRevision: "reviewed-revision" },
});
presetInput.service = true;
assert.equal(presetAttempt.command.values.service, false, "later input cannot mutate an uncertain command");
assert.equal(presetAttempt.command.expectedRevision, "reviewed-revision");
assert.equal(Object.isFrozen(presetAttempt.command.values), true);

const storedRead = { success: true as const, id: "schema-stable", state: "saved" as const, schema: { ...custom("schema-stable"), revision: "saved-revision" } };
assert.deepEqual(schemaWorkspaceReviewedIdentity("schema-stable", storedRead),
	{ id: "schema-stable", expectedRevision: "saved-revision" });
assert.deepEqual(schemaWorkspaceReviewedIdentity("schema-stable", { success: true, id: "schema-stable", state: "absent", schema: null }),
	{ id: "schema-stable", expectedRevision: null }, "reviewing absence preserves the original create identifier");
assert.equal(schemaWorkspaceReviewedIdentity("another-target", storedRead), null, "a different record cannot authorize this draft");
assert.equal(schemaWorkspaceReviewedIdentity("schema-stable", { success: true, id: "schema-stable", state: "invalid", schema: null, revision: "bad-record" }), null);
assert.equal(schemaWorkspaceReviewedIdentity("schema-stable", { success: false, error: "unavailable", message: "Read failed" }), null);
const reorderedSameVersion = { ...savedA, items: [...savedA.items].reverse() };
assert.equal(schemaWorkspacePresetReviewRequired(cleanPresetState, reorderedSameVersion), false,
	"item order alone is not a new preset baseline");

const gate = createSchemaWorkspaceMutationGate();
assert.equal(gate.isUnconfirmed(), false);
assert.equal(gate.beginReview(), false, "a reload is not a recovery review without an unknown outcome");
assert.equal(gate.allowAfterReview(), false);
assert.equal(gate.claim(), true, "the first activation claims a pending mutation");
assert.equal(gate.claim(), false, "another activation in the same tick cannot send a second request");
assert.equal(gate.claim(), false, "another mutation owner shares the pending claim");
gate.release();
assert.equal(gate.claim(), true, "a confirmed completion permits the next explicit action");
gate.markUnconfirmed();
assert.equal(gate.isUnconfirmed(), true);
assert.equal(gate.claim(), false, "unknown outcomes block every mutation owner");
assert.equal(gate.beginReview(), false, "logical request cleanup must finish before a review");
gate.release();
assert.equal(gate.claim(), false, "finally cleanup cannot unlock an unknown outcome");
gate.release();
assert.equal(gate.isUnconfirmed(), true, "repeated cleanup never means a write was rejected");
assert.equal(gate.allowAfterReview(), false, "acknowledgement alone cannot unlock an unknown outcome");
assert.equal(gate.beginReview(), true);
assert.equal(gate.beginReview(), false, "two reload activations send only one review read");
assert.equal(gate.claim(), false);
assert.equal(gate.allowAfterReview(), false, "a pending read is not a successful review");
gate.completeReview(false);
assert.equal(gate.allowAfterReview(), false, "a failed reload cannot unlock another mutation");
assert.equal(gate.beginReview(), true);
gate.completeReview(true);
assert.equal(gate.allowAfterReview(), true, "only a successful settled review permits acknowledgement");
assert.equal(gate.isUnconfirmed(), false);
assert.equal(gate.allowAfterReview(), false, "the acknowledgement is consumed once");
assert.equal(gate.claim(), true);
gate.release();
const independentGate = createSchemaWorkspaceMutationGate();
gate.markUnconfirmed();
assert.equal(independentGate.claim(), true, "another workspace lifetime does not inherit a hidden shared singleton");
assert.equal(gate.claim(), false);

// A UI deadline can expire while the original transport still commits later.
const delayed = createSchemaWorkspaceMutationGate();
assert.equal(delayed.claim(), true);
delayed.beginTransport();
let finishTransport: () => void = () => { throw new Error("Transport was not started"); };
const transport = new Promise<void>((resolve) => { finishTransport = resolve; });
const settled = transport.finally(() => delayed.settleTransport());
delayed.markUnconfirmed();
delayed.release();
assert.equal(delayed.beginReview(), false, "a read before the late transport settles cannot count as review");
delayed.completeReview(true);
assert.equal(delayed.allowAfterReview(), false, "even an early successful read cannot authorize another create");
assert.equal(delayed.claim(), false);
finishTransport();
await settled;
assert.equal(delayed.isUnconfirmed(), true, "late transport completion does not prove its write outcome");
assert.equal(delayed.allowAfterReview(), false, "settlement requires a new review read");
assert.equal(delayed.beginReview(), true, "a fresh post-settlement review may now start");
assert.equal(delayed.allowAfterReview(), false);
delayed.completeReview(true);
assert.equal(delayed.allowAfterReview(), true);
assert.equal(delayed.claim(), true, "a deliberately acknowledged fresh review permits the next action");
delayed.beginTransport();
delayed.release();
assert.equal(delayed.claim(), false, "logical cleanup cannot allow an overlapping transport");
delayed.settleTransport();
assert.equal(delayed.claim(), true);
delayed.markUnconfirmed();
delayed.release();
assert.equal(delayed.beginReview(), true);
delayed.completeReview(true);
delayed.settleTransport();
assert.equal(delayed.allowAfterReview(), false, "transport settlement invalidates any earlier review");
assert.equal(delayed.beginReview(), true);
delayed.completeReview(true);
assert.equal(delayed.allowAfterReview(), true);

// Library is a Schema tab with its own deep link; the other tabs share one route.
assert.equal(schemaWorkspaceRoute("library"), "library");
for (const section of ["overview", "custom", "defaults"] as const) {
	assert.equal(schemaWorkspaceRoute(section), "schema");
	assert.equal(schemaWorkspaceSectionForRoute("schema", section, "overview"), section, "a schema route keeps the open non-library tab");
	assert.equal(schemaWorkspaceSectionForRoute("library", section, "overview"), "library", "?view=library always selects the Library tab");
}
assert.equal(schemaWorkspaceSectionForRoute("schema", "library", "custom"), "custom", "leaving Library by Back or Forward restores the last other tab");
assert.equal(schemaWorkspaceSectionForRoute("library", "library", "defaults"), "library");

console.log("SEO schema workspace model self-check passed.");
