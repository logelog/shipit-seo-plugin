import assert from "node:assert/strict";

import {
	SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	type SeoAdminSchemaContentTypeConfiguration,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	INITIAL_CONTENT_TYPES_PANEL,
	contentTypeRoleInactiveReason,
	contentTypesConfirmation,
	contentTypesConflictDifferences,
	contentTypesDirty,
	createContentTypesPanelStore,
	patchSchemaContentTypes,
	type ContentTypesIntent,
} from "./schema-content-types-model.ts";

function configuration(
	revision: string | null,
	roles: Record<string, "none" | "blogPosting" | "service" | "webPage">,
): SeoAdminSchemaContentTypeConfiguration {
	return {
		storageVersion: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
		updatedAt: revision ? "2026-10-02T10:00:00.000Z" : null,
		revision,
		record: revision ? "valid" : "absent",
		writable: true,
		discoveryAvailable: true,
		discoveredCount: Object.keys(roles).length,
		items: Object.entries(roles).map(([collection, role]) => ({ collection, label: collection, role, source: "default" })),
		unlisted: [],
	};
}

const loaded = configuration(null, { pages: "none", posts: "blogPosting" });
const store = createContentTypesPanelStore(INITIAL_CONTENT_TYPES_PANEL);
store.dispatch({ type: "receive", configuration: loaded });
assert.equal(store.get().base?.revision, null);
store.dispatch({ type: "edit", collection: "pages", role: "webPage" });
assert.equal(contentTypesDirty(store.get()), true);

store.dispatch({ type: "receive", configuration: { ...loaded } });
assert.equal(store.get().draft.pages, "webPage", "a background refresh of the same version keeps the draft");
assert.equal(store.get().notice, null);

const elsewhere = configuration("r2", { pages: "service", posts: "blogPosting" });
store.dispatch({ type: "receive", configuration: elsewhere });
assert.equal(store.get().draft.pages, "webPage", "a background refresh never erases the draft");
assert.equal(store.get().base?.revision, null, "nor replaces the revision the draft was loaded from");
assert.equal(store.get().notice?.kind, "conflict", "a newer stored version is shown for review");
assert.deepEqual(
	contentTypesConflictDifferences(store.get()).map((item) => [item.collection, item.saved, item.draft]),
	[["pages", "service", "webPage"]],
	"the newer saved choice is shown beside the kept draft before keeping edits",
);
store.dispatch({ type: "keep-edits" });
assert.equal(store.get().base?.revision, "r2", "keeping edits applies them over the reviewed version");
assert.equal(store.get().draft.pages, "webPage");

const saveIntent: ContentTypesIntent = { action: "save", values: { pages: "webPage", posts: "blogPosting" }, expectedRevision: "r2" };
store.dispatch({ type: "start", pending: "save" });
store.dispatch({ type: "request-failed", intent: saveIntent, failure: "unknown", message: "Network error" });
assert.equal(store.get().notice?.kind, "unconfirmed", "a lost response is unconfirmed");
store.dispatch({ type: "edit", collection: "posts", role: "none" });
store.dispatch({ type: "discard" });
assert.equal(store.get().draft.posts, "blogPosting", "an unconfirmed write locks editing until it is checked");
assert.equal(store.get().draft.pages, "webPage");
store.dispatch({ type: "check-result", check: "not_applied", configuration: elsewhere });
assert.equal(store.get().notice?.kind, "info", "a check that finds nothing stored unlocks the editor");
assert.equal(store.get().draft.pages, "webPage", "and keeps the input to try again");
assert.equal(store.get().base?.revision, "r2");

store.dispatch({ type: "start", pending: "save" });
store.dispatch({ type: "request-failed", intent: saveIntent, failure: "unknown", message: "Timeout" });
const stored = configuration("r3", { pages: "webPage", posts: "blogPosting" });
store.dispatch({ type: "check-result", check: "applied", configuration: stored });
assert.equal(store.get().base?.revision, "r3", "a check that finds the save adopts the stored version");
assert.equal(contentTypesDirty(store.get()), false);

store.dispatch({ type: "edit", collection: "posts", role: "none" });
store.dispatch({ type: "start", pending: "save" });
store.dispatch({
	type: "result",
	intent: { action: "save", values: { pages: "webPage", posts: "none" }, expectedRevision: "r3" },
	result: {
		success: false,
		error: "conflict",
		errors: { _form: "The mapping changed after you opened it. Nothing was saved." },
		current: configuration("r4", { pages: "none", posts: "blogPosting" }),
	},
});
assert.equal(store.get().notice?.kind, "conflict");
assert.equal(store.get().draft.posts, "none", "a conflict keeps the draft");
assert.equal(store.get().base?.revision, "r3");
store.dispatch({ type: "use-latest" });
assert.equal(store.get().base?.revision, "r4", "using the saved version adopts it");
assert.equal(store.get().draft.pages, "none");

store.dispatch({ type: "edit", collection: "pages", role: "webPage" });
store.dispatch({ type: "start", pending: "save" });
store.dispatch({ type: "request-failed", intent: saveIntent, failure: "denied", message: "Forbidden" });
assert.equal(store.get().notice?.kind, "denied", "a denied request names the permission");
assert.equal(store.get().draft.pages, "webPage");
store.dispatch({ type: "start", pending: "save" });
store.dispatch({
	type: "result",
	intent: saveIntent,
	result: { success: false, error: "invalid", errors: { pages: "Choose a supported schema type." } },
});
assert.equal(store.get().errors.pages, "Choose a supported schema type.", "field errors stay on the field");

// A confirmation keeps the version it was opened for.
const confirmStore = createContentTypesPanelStore(INITIAL_CONTENT_TYPES_PANEL);
confirmStore.dispatch({ type: "receive", configuration: configuration("r1", { pages: "webPage" }) });
const resetAtR1 = contentTypesConfirmation(confirmStore.get(), "reset");
assert.deepEqual(resetAtR1, { action: "reset", expectedRevision: "r1" });
confirmStore.dispatch({ type: "confirm-open", confirmation: resetAtR1! });
confirmStore.dispatch({ type: "receive", configuration: configuration("r2", { pages: "service" }) });
assert.deepEqual(confirmStore.get().confirming, { action: "reset", expectedRevision: "r1" },
	"a refresh while Restore is open cannot make it delete the newer version");
assert.equal(confirmStore.get().base?.revision, "r1");
assert.equal(confirmStore.get().latest?.revision, "r2");
confirmStore.dispatch({ type: "confirm-close" });
confirmStore.dispatch({ type: "start", pending: "reset" });
confirmStore.dispatch({ type: "request-failed", intent: { action: "reset", expectedRevision: "r1" }, failure: "unknown", message: "Timeout" });
confirmStore.dispatch({ type: "confirm-open", confirmation: { action: "reset", expectedRevision: "r1" } });
assert.equal(confirmStore.get().confirming, null, "no confirmation opens while a write is unconfirmed");

// A save that settles after the view unmounted patches only the mapping.
const navigationStore = createContentTypesPanelStore(INITIAL_CONTENT_TYPES_PANEL);
navigationStore.dispatch({ type: "receive", configuration: configuration(null, { pages: "none" }) });
navigationStore.dispatch({ type: "edit", collection: "pages", role: "webPage" });
navigationStore.dispatch({ type: "start", pending: "save" });
const cacheWhileAway = {
	modules: { items: [] },
	schema: {
		contentTypes: configuration(null, { pages: "none" }),
		presets: { items: [{ key: "webPage", enabled: true }] },
		customSchemas: [{ id: "added-while-away" }],
	},
};
const lateResult = configuration("r9", { pages: "webPage" });
navigationStore.dispatch({
	type: "result",
	intent: { action: "save", values: { pages: "webPage" }, expectedRevision: null },
	result: { success: true, contentTypes: lateResult },
});
const patched = patchSchemaContentTypes(cacheWhileAway, lateResult);
assert.equal(patched?.schema.contentTypes.revision, "r9", "the late save updates the mapping");
assert.deepEqual(patched?.schema.customSchemas, [{ id: "added-while-away" }], "newer custom schemas stay");
assert.deepEqual(patched?.schema.presets, { items: [{ key: "webPage", enabled: true }] }, "newer presets stay");
assert.equal(navigationStore.get().base?.revision, "r9");
assert.equal(patchSchemaContentTypes(undefined, lateResult), undefined);

const presetOff = { outputEnabled: true, recordInvalid: false, presetEnabled: () => false };
assert.match(contentTypeRoleInactiveReason("blogPosting", presetOff) ?? "", /Blog posting preset is off/);
assert.equal(contentTypeRoleInactiveReason("webPage", presetOff), null, "Web page does not depend on a preset switch");
assert.equal(contentTypeRoleInactiveReason("none", presetOff), null);
assert.match(contentTypeRoleInactiveReason("webPage", { ...presetOff, outputEnabled: false }) ?? "", /schema output is off/);
assert.match(contentTypeRoleInactiveReason("service", { ...presetOff, presetEnabled: () => true, recordInvalid: true }) ?? "", /cannot be read/);

console.log("SEO content type schema model self-check passed.");
