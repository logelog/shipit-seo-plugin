import assert from "node:assert/strict";

import {
	ENTRY_SCHEMA_NEW_ID_PATTERN,
	SEO_ADMIN_CONTRACT_VERSION,
	type EntryCustomSchema,
	type SeoAdminEntrySchemaListResult,
	type EntryInheritedSchema,
	type SeoAdminEntrySchemaGraph,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	parseSeoAdminEntrySchemaListResult,
	parseSeoAdminEntrySchemaRemoveResult,
	parseSeoAdminEntrySchemaSaveResult,
} from "./contract.ts";
import {
	INITIAL_ENTRY_SCHEMA_PANEL,
	addEntrySchemaEditor,
	canCloseEntrySchemaEditor,
	createEntrySchemaPanelStore,
	createEntrySchemaOpeningController,
	acquireEntrySchemaOperation,
	checkUnconfirmedRemove,
	checkUnconfirmedSave,
	classifyEntrySchemaRequestError,
	editEntrySchemaEditor,
	entrySchemaEditorDetached,
	entrySchemaConfirmationDetached,
	entrySchemaEditorCanSave,
	entrySchemaInUseRows,
	entrySchemaNotAddedRows,
	entrySchemaOutputState,
	entrySchemaPanelLocked,
	entrySchemaPanelReducer,
	entrySchemaRemovalRequest,
	inheritedOwnerLabel,
	keepEditsOver,
	newEntrySchemaId,
	otherEmittedEntrySchemaGraphs,
	summarizeInheritedEntrySchemas,
} from "./entry-schema-model.ts";

import { createEntrySchemaAuthoring, encodeEntrySchemaAuthoring } from "./entry-schema-authoring.ts";

const schema: EntryCustomSchema = {
	id: "entry-aaaaaaaaaaaaaaaaaaaa",
	revision: "rev-1",
	name: "Launch article",
	json: '{"@context":"https://schema.org","@type":"Article","headline":"Launch"}',
	enabled: true,
	types: ["Article"],
	valid: true,
	validationError: null,
	createdAt: "2026-10-02T10:00:00.000Z",
	updatedAt: "2026-10-02T10:00:00.000Z",
};
const graph = (patch: Partial<SeoAdminEntrySchemaGraph> = {}): SeoAdminEntrySchemaGraph => ({
	id: `custom:${schema.id}`,
	source: "custom",
	presetKey: null,
	name: schema.name,
	types: ["Article"],
	disabled: false,
	emitted: true,
	suppressedReason: null,
	conflictId: null,
	replacesCore: false,
	graph: {},
	...patch,
});

const overlapGraphs = Object.freeze([
 Object.freeze(graph({ id: "default:article", source: "preset", types: ["BlogPosting"] })),
 Object.freeze(graph()),
 Object.freeze(graph({ id: "custom:another", types: ["BlogPosting"] })),
 Object.freeze(graph({ id: "custom:disabled", emitted: false, disabled: true, suppressedReason: "disabled" })),
]);
assert.deepEqual(otherEmittedEntrySchemaGraphs(overlapGraphs, schema.id).map(item => item.id), ["default:article", "custom:another"]);
assert.deepEqual(otherEmittedEntrySchemaGraphs(overlapGraphs, null).map(item => item.id), ["default:article", `custom:${schema.id}`, "custom:another"]);
assert.deepEqual(otherEmittedEntrySchemaGraphs([], schema.id), []);

assert.match(newEntrySchemaId(), ENTRY_SCHEMA_NEW_ID_PATTERN);
assert.equal(newEntrySchemaId(() => new Uint8Array(20).fill(36 + 1)), "entry-bbbbbbbbbbbbbbbbbbbb");

assert.equal(classifyEntrySchemaRequestError({ status: 403 }), "denied");
assert.equal(classifyEntrySchemaRequestError({ status: 401 }), "denied");
assert.equal(classifyEntrySchemaRequestError({ status: 400 }), "rejected");
assert.equal(classifyEntrySchemaRequestError({ status: 408 }), "unknown", "a timeout may follow a committed write");
assert.equal(classifyEntrySchemaRequestError({ status: 502 }), "unknown");
assert.equal(classifyEntrySchemaRequestError(new DOMException("The operation timed out.", "TimeoutError")), "unknown");

const published = { outputEnabled: true, entryStatus: "published", graph: graph() };
assert.deepEqual(entrySchemaOutputState(schema, published), { tone: "active", label: "In this plugin's output for this page" });
assert.equal(entrySchemaOutputState({ ...schema, valid: false, validationError: "Bad" }, published).tone, "problem");
assert.equal(entrySchemaOutputState(schema, { ...published, outputEnabled: false }).tone, "inactive");
assert.equal(entrySchemaOutputState({ ...schema, enabled: false }, published).label, "Saved. Excluded from page output");
assert.equal(entrySchemaOutputState(schema, { ...published, graph: undefined }).tone, "problem", "a missing preview row is not output");
assert.match(
	entrySchemaOutputState(schema, { ...published, graph: graph({ emitted: false, suppressedReason: "entity-conflict", conflictId: "https://example.com/#a" }) }).label,
	/not added to the page: another schema.*#a/,
);
assert.match(entrySchemaOutputState(schema, { ...published, entryStatus: "draft" }).label, /once this entry is published/);

assert.match(inheritedOwnerLabel("wrong-locale", "Posts", { entry: "en", target: "nl" }), /locale nl, but this entry is en/);
assert.match(inheritedOwnerLabel("legacy-entry", "Posts"), /read-only/);
assert.match(inheritedOwnerLabel("collection", "Posts"), /^Posts schema/);

const inherited: EntryInheritedSchema[] = [
	{ id: "posts-blog", name: "Practice blog", owner: "collection", scope: "posts", enabled: true, types: ["BlogPosting"], valid: true },
	{ id: "site", name: "Site identity", owner: "site", scope: "global", enabled: true, types: ["Organization"], valid: true },
	{ id: "excluded", name: "Excluded record", owner: "site", scope: "global", enabled: false, types: ["CreativeWork"], valid: true },
	{ id: "invalid", name: "Invalid record", owner: "legacy-entry", scope: "posts:01JPOST", enabled: true, types: [], valid: false },
	{ id: "other-locale", name: "Dutch record", owner: "wrong-locale", scope: "posts:01JPOST", enabled: true, types: ["Article"], valid: true, targetLocale: "nl" },
];
const inheritedGraphs = [
	graph({ id: "custom:posts-blog" }),
	graph({ id: "custom:posts-blog" }),
	graph({ id: "custom:site", emitted: false, suppressedReason: "entity-conflict" }),
	graph({ id: "custom:excluded" }),
	graph({ id: "custom:invalid" }),
	graph({ id: "custom:other-locale" }),
	graph({ id: "preset:article", source: "preset", presetKey: "blogPosting" }),
	graph(),
];
assert.deepEqual(summarizeInheritedEntrySchemas(inherited, inheritedGraphs, true), {
	storedCount: 5,
	previewCount: 1,
	names: ["Practice blog (BlogPosting)", "Site identity (Organization)", "Excluded record (CreativeWork)"],
	remainingCount: 2,
}, "shared records remain visible without treating stored, duplicate, suppressed, disabled, invalid, wrong-locale or own records as emitted contributions");
assert.equal(summarizeInheritedEntrySchemas(inherited, inheritedGraphs, false).previewCount, 0, "output off overrides the resolver preview");

// "Schema in use": own records first and always listed, then only emitted defaults and shared graphs.
const { revision: _ownRevision, ...ownSummary } = schema;
const disabledOwn = { ...ownSummary, id: "entry-bbbbbbbbbbbbbbbbbbbb", name: "Draft FAQ", enabled: false, types: ["FAQPage"] };
const inUseGraphs = [
	graph({ id: "preset:website", source: "preset", presetKey: "website", name: "WebSite", types: ["WebSite"] }),
	graph({ id: "preset:blogPosting", source: "preset", presetKey: "blogPosting", name: "Article", types: ["Article"], replacesCore: true }),
	graph({ id: "preset:faqPage", source: "preset", presetKey: "faqPage", name: "FAQPage", types: ["FAQPage"], disabled: true, emitted: false, suppressedReason: "disabled" }),
	graph(),
	graph({ id: "custom:posts-blog", name: "Practice blog", types: ["BlogPosting"] }),
	graph({ id: "custom:site", name: "Site identity", emitted: false, suppressedReason: "entity-conflict" }),
	graph({ id: "custom:unlisted", name: "Unlisted shared record" }),
	graph({ id: "custom:unknown-scope", name: "Imported record", emitted: false, suppressedReason: "duplicate-definition" }),
];
const inUse = entrySchemaInUseRows({ items: [ownSummary, disabledOwn], inherited, graphs: inUseGraphs, collectionLabel: "Posts", outputEnabled: true });
assert.deepEqual(inUse.map((row) => [row.key, row.source, row.scope]), [
	[`custom:${schema.id}`, "entry", "Only this entry"],
	["custom:entry-bbbbbbbbbbbbbbbbbbbb", "entry", "Only this entry"],
	["preset:blogPosting", "content-type", "Posts"],
	["custom:posts-blog", "shared", "Every Posts entry"],
	["custom:unlisted", "shared", "Managed in Schema"],
	["preset:website", "site", "Every page"],
], "own records lead and stay editable even when not added; suppressed and disabled defaults are not in use");
assert.equal(inUse[0].schema, ownSummary);
assert.equal(inUse[1].graph, null, "an own record without a preview row keeps its row without a graph");
assert.ok(inUse.slice(2).every((row) => row.schema === null), "only this entry's records carry an editable record");
assert.equal(inUse.find((row) => row.key === "preset:blogPosting")?.note, "Enriches EmDash's built-in graph");
assert.equal(inUse.find((row) => row.key === "preset:website")?.note, null);
const legacyOwners: EntryInheritedSchema[] = [
	{ id: "slug", name: "Slug record", owner: "legacy-slug", scope: "posts:launch", enabled: true, types: ["Article"], valid: true },
	{ id: "old", name: "Older record", owner: "legacy-entry", scope: "posts:01JPOST", enabled: true, types: ["Article"], valid: true },
];
assert.deepEqual(entrySchemaInUseRows({ items: [], inherited: legacyOwners, graphs: [graph({ id: "custom:slug" }), graph({ id: "custom:old" })], collectionLabel: "Posts", outputEnabled: true })
	.map((row) => row.scope), ["Entries with this slug", "Older record for this entry"]);
const articleDefaultAndOwn = entrySchemaInUseRows({ items: [ownSummary], inherited: [], collectionLabel: "Posts", outputEnabled: true,
	graphs: [graph({ id: "preset:blogPosting", source: "preset", presetKey: "blogPosting", name: "Article", types: ["Article"] }), graph()] });
assert.deepEqual(articleDefaultAndOwn.map((row) => row.source), ["entry", "content-type"], "an Article default and one entry schema are two rows with their sources");
assert.deepEqual(entrySchemaInUseRows({ items: [ownSummary], inherited, graphs: inUseGraphs, collectionLabel: "Posts", outputEnabled: false }).map((row) => row.source), ["entry"],
	"with output off only the entry's own records are listed, never predicted defaults");
assert.deepEqual(entrySchemaInUseRows({ items: [], inherited: [], graphs: [], collectionLabel: "Posts", outputEnabled: true }), []);

const notAdded = entrySchemaNotAddedRows({ items: [ownSummary], inherited, graphs: inUseGraphs, collectionLabel: "Posts", outputEnabled: true, locale: "en" });
assert.deepEqual(notAdded.map((row) => [row.key, row.scope]), [
	["custom:site", "Every page"],
	["custom:excluded", "Every page"],
	["custom:invalid", "Older record for this entry"],
	["custom:other-locale", "Another locale"],
	["custom:unknown-scope", "Managed in Schema"],
], "only shared records that add nothing are listed; emitted, own and preset rows are not");
assert.match(notAdded[0].reason, /^Not added: another schema on this page already defines the same entity$/);
assert.equal(notAdded[1].reason, "Not added: excluded from page output");
assert.equal(notAdded[2].reason, "Not added: the stored JSON-LD is invalid");
assert.match(notAdded[3].reason, /locale nl, but this entry is en/);
assert.match(notAdded[4].reason, /defines the same entity twice/);
const noGraph = entrySchemaNotAddedRows({ items: [], inherited, graphs: [], collectionLabel: "Posts", outputEnabled: true, locale: "en" });
assert.deepEqual(noGraph.map((row) => row.reason.replace(/^Not added: /, "")), [
	"the schema preview did not resolve it",
	"the schema preview did not resolve it",
	"excluded from page output",
	"the stored JSON-LD is invalid",
	"Saved for locale nl, but this entry is en. Not added to the page",
]);
assert.ok(entrySchemaNotAddedRows({ items: [], inherited, graphs: inUseGraphs, collectionLabel: "Posts", outputEnabled: false, locale: "en" })
	.filter((row) => row.scope !== "Another locale").every((row) => row.reason === "Not added: schema output is off in Feature controls"));
assert.deepEqual(summarizeInheritedEntrySchemas([], [graph()], true), { storedCount: 0, previewCount: 0, names: [], remainingCount: 0 });
assert.deepEqual(summarizeInheritedEntrySchemas([inherited[3]], [], true).names, ["Invalid record"], "stored records remain reviewable when no type can be read");

const editor = editEntrySchemaEditor(schema);
const owned = (item: EntryCustomSchema) => ({ id: item.id, state: "owned" as const, schema: item });
const absentId = (id: string) => ({ id, state: "absent" as const });
assert.deepEqual(checkUnconfirmedSave(editor, owned(schema)), { kind: "saved", schema });
assert.deepEqual(checkUnconfirmedSave({ ...editor, draft: { ...editor.draft, name: "Renamed" } }, owned(schema)), { kind: "not-saved" });
assert.deepEqual(checkUnconfirmedSave({ ...editor, draft: { ...editor.draft, name: "Renamed" } }, owned({ ...schema, revision: "rev-2" })).kind, "changed");
assert.deepEqual(checkUnconfirmedSave(editor, absentId(schema.id)), { kind: "removed" });
assert.deepEqual(checkUnconfirmedSave(editor, { id: schema.id, state: "elsewhere" }), { kind: "elsewhere" }, "a moved record is neither saved nor removed");
const adding = { ...addEntrySchemaEditor("entry-bbbbbbbbbbbbbbbbbbbb"), draft: { name: "New", json: "{}", enabled: true } };
assert.deepEqual(checkUnconfirmedSave(adding, absentId(adding.id)), { kind: "not-saved" }, "an absent create stays retryable with the same identifier");
const kept = keepEditsOver({ ...editor, draft: { ...editor.draft, name: "Mine" } }, { ...schema, revision: "rev-9" });
assert.equal(kept.expectedRevision, "rev-9");
assert.equal(kept.draft.name, "Mine");

assert.deepEqual(checkUnconfirmedRemove({ revision: "rev-1" }, absentId(schema.id)), { kind: "removed" });
assert.deepEqual(checkUnconfirmedRemove({ revision: "rev-1" }, owned(schema)), { kind: "not-removed" });
assert.equal(checkUnconfirmedRemove({ revision: "rev-0" }, owned(schema)).kind, "changed");
assert.deepEqual(checkUnconfirmedRemove({ revision: "rev-1" }, { id: schema.id, state: "elsewhere" }), { kind: "elsewhere" },
	"an import that moved the ID away is not a deletion");

const version = { contractVersion: SEO_ADMIN_CONTRACT_VERSION };
const { revision: listRevision, ...summary } = schema;
assert.equal(listRevision, "rev-1");
const listed = {
	...version,
	success: true,
	entry: { collection: "posts", entryId: "01JPOST", locale: "en", slug: "launch", status: "published" },
	outputEnabled: true,
	items: [summary],
	inherited: [{ id: "g", name: "Site", owner: "wrong-locale", scope: "posts:01JPOST", enabled: true, types: [], valid: true, targetLocale: "nl" }],
	limits: { perEntry: 20, applicable: 100 },
};
assert.equal(parseSeoAdminEntrySchemaListResult(listed).success, true);
assert.throws(() => parseSeoAdminEntrySchemaListResult({ ...listed, outputEnabled: undefined }));
assert.throws(() => parseSeoAdminEntrySchemaListResult({ ...listed, items: [schema] }), "a list row must carry no revision authority");
assert.throws(() => parseSeoAdminEntrySchemaListResult({ ...listed, items: [{ ...summary, revision: undefined }] }), "even an undefined revision property is not a summary");
assert.equal(parseSeoAdminEntrySchemaListResult({ ...listed, inspected: { id: schema.id, state: "owned", schema } }).success, true);
assert.throws(() => parseSeoAdminEntrySchemaListResult({ ...listed, inspected: { id: schema.id, state: "owned", schema: summary } }), "an inspected detail still requires its revision");
assert.throws(() => parseSeoAdminEntrySchemaListResult({ ...listed, inspected: { id: "another-id", state: "owned", schema } }), "an inspected envelope cannot name another record");
assert.throws(() => parseSeoAdminEntrySchemaListResult({ ...listed, inherited: [{ ...listed.inherited[0], owner: "entry" }] }));
assert.equal(parseSeoAdminEntrySchemaListResult({ ...version, success: false, error: "too_many_applicable", message: "Too many." }).success, false);
assert.throws(() => parseSeoAdminEntrySchemaListResult({ ...version, success: false, error: "conflict", message: "x" }));

assert.equal(parseSeoAdminEntrySchemaSaveResult({ ...version, success: true, schema, alreadySaved: false }).success, true);
assert.throws(() => parseSeoAdminEntrySchemaSaveResult({ ...version, success: true, schema }));
assert.equal(parseSeoAdminEntrySchemaSaveResult({ ...version, success: false, error: "invalid_values", errors: { json: "Bad" } }).success, false);
assert.throws(() => parseSeoAdminEntrySchemaSaveResult({ ...version, success: false, error: "invalid_values", errors: { scope: "x" } }));
assert.equal(parseSeoAdminEntrySchemaSaveResult({ ...version, success: false, error: "conflict", current: null, message: "Removed." }).success, false);
assert.equal(parseSeoAdminEntrySchemaSaveResult({ ...version, success: false, error: "unconfirmed", message: "Unknown." }).success, false);
assert.equal(parseSeoAdminEntrySchemaRemoveResult({ ...version, success: true, id: schema.id }).success, true);
assert.throws(() => parseSeoAdminEntrySchemaRemoveResult({ ...version, success: false, error: "conflict", current: null, message: "x" }));

// --- panel state: recovery stays reachable, edits survive removal, removal uses the confirmed revision

const reduce = (state: typeof INITIAL_ENTRY_SCHEMA_PANEL, ...events: Parameters<typeof entrySchemaPanelReducer>[1][]) =>
	events.reduce(entrySchemaPanelReducer, state);

{
	// An ambiguous save cannot be closed away; the recovery action stays in state until checked.
	const opened = reduce(INITIAL_ENTRY_SCHEMA_PANEL, { type: "open", editor: adding });
	const lost = reduce(opened, { type: "save-error", failure: "unknown" });
	assert.equal(lost.unconfirmed?.action, "save");
	assert.equal(canCloseEntrySchemaEditor(lost), false);
	const afterClose = reduce(lost, { type: "close" });
	assert.equal(afterClose, lost, "Cancel and Escape leave the unknown save and its form in place");
	assert.equal(afterClose.unconfirmed?.action, "save", "Check current state remains available");
	assert.equal(reduce(lost, { type: "edit", patch: { name: "Changed" } }).editor?.draft.name, "New", "the compared input is frozen");
	assert.equal(reduce(lost, { type: "open", editor: editEntrySchemaEditor(schema) }), lost, "nothing else opens meanwhile");
	const stillUnknown = reduce(lost, { type: "check-failed", message: "Unreadable." });
	assert.match(stillUnknown.unconfirmed?.message ?? "", /still unknown/);
	const absent = reduce(lost, { type: "check-result", inspected: absentId(adding.id) });
	assert.equal(absent.unconfirmed, null);
	assert.equal(absent.editor?.id, adding.id, "an absent create keeps its identifier for a create-only retry");
	assert.equal(canCloseEntrySchemaEditor(absent), true);
	const stored = { ...schema, id: adding.id, name: "New", json: "{}", enabled: true };
	const confirmed = reduce(lost, { type: "check-result", inspected: owned(stored) });
	assert.equal(reduce(lost, { type: "check-result", inspected: absentId("entry-zzzzzzzzzzzzzzzzzzzz") }).unconfirmed?.action, "save", "an answer for another ID leaves the outcome unknown");
	assert.equal(confirmed.editor, null);
	assert.equal(entrySchemaPanelLocked(confirmed), false);
	const serverUnknown = reduce(opened, { type: "save-result", result: { success: false, error: "unconfirmed", message: "Could not confirm." } });
	assert.equal(canCloseEntrySchemaEditor(serverUnknown), false);
}

{
	// Editing a record another editor removed: the form and input stay, with an explicit save-as-new.
	const editing = reduce(INITIAL_ENTRY_SCHEMA_PANEL, { type: "open", editor: editEntrySchemaEditor(schema) }, { type: "edit", patch: { name: "Mine" } });
	assert.equal(entrySchemaEditorDetached(editing, [schema]), false);
	const gone = reduce(editing, { type: "save-result", result: { success: false, error: "not_found", message: "Removed elsewhere." } });
	assert.deepEqual(gone.notice, { kind: "conflict", message: "Removed elsewhere.", current: null });
	assert.equal(gone.editor?.draft.name, "Mine");
	assert.equal(entrySchemaEditorDetached(gone, []), true, "the form renders without its list row");
	assert.equal(canCloseEntrySchemaEditor(gone), true);
	const asNew = reduce(gone, { type: "save-as-new", id: "entry-cccccccccccccccccccc" });
	assert.deepEqual([asNew.editor?.mode, asNew.editor?.id, asNew.editor?.expectedRevision, asNew.editor?.draft.name], ["add", "entry-cccccccccccccccccccc", null, "Mine"]);
	const moved = reduce(editing, { type: "save-result", result: { success: false, error: "scope_mismatch", message: "Moved." } });
	assert.equal(moved.notice?.kind === "conflict" && moved.notice.current, null);
	const closed = reduce(gone, { type: "close" });
	assert.equal(entrySchemaPanelLocked(closed), false, "Add is available again after Cancel");
}

{
	// Removal sends the revision that was on screen when the editor confirmed it.
	const confirming = reduce(INITIAL_ENTRY_SCHEMA_PANEL, { type: "confirm-remove", schema });
	const refreshed = [{ ...schema, revision: "rev-2", json: "{}" }];
	assert.deepEqual(entrySchemaRemovalRequest(confirming), { id: schema.id, expectedRevision: "rev-1" });
	assert.equal(refreshed[0].revision, "rev-2");
	assert.deepEqual(entrySchemaRemovalRequest(confirming), { id: schema.id, expectedRevision: "rev-1" }, "a refresh does not change the request");
	const conflicted = reduce(confirming, { type: "remove-result", target: schema, result: { success: false, error: "conflict", current: refreshed[0], message: "Changed." } });
	assert.equal(conflicted.confirming, null);
	assert.equal(conflicted.notice?.kind, "failed");
	const lostRemove = reduce(confirming, { type: "remove-error", target: schema, failure: "unknown" });
	assert.deepEqual([lostRemove.unconfirmed?.action, lostRemove.unconfirmed?.action === "remove" && lostRemove.unconfirmed.revision], ["remove", "rev-1"]);
	assert.equal(reduce(lostRemove, { type: "check-result", inspected: owned(refreshed[0]) }).notice?.kind, "failed", "a newer revision is reported, not treated as removed");
	assert.match(reduce(lostRemove, { type: "check-result", inspected: { id: schema.id, state: "elsewhere" } }).notice?.message ?? "", /no longer owned by this entry/);
	assert.equal(reduce(lostRemove, { type: "check-result", inspected: absentId(schema.id) }).notice?.message, "Confirmed: “Launch article” is removed.");
	assert.equal(reduce(confirming, { type: "remove-error", target: schema, failure: "denied" }).notice?.kind, "denied");
	assert.equal(reduce(confirming, { type: "open", editor: adding }), confirming, "no form opens during a confirmation");
}

{
	// The store outlives the panel: a create in flight keeps its identifier and lock
	// across a tab switch or dialog close, and a second submit cannot start another.
	const store = createEntrySchemaPanelStore();
	let notified = 0;
	const unsubscribe = store.subscribe(() => (notified += 1));
	store.dispatch({ type: "open", editor: { ...adding, draft: { name: "New", json: "{}", enabled: true } } });
	store.dispatch({ type: "start", operation: "save" });
	assert.equal(store.get().pending, "save");
	unsubscribe();
	store.dispatch({ type: "start", operation: "save" });
	assert.equal(store.get().pending, "save", "a remount cannot start a second create");
	assert.equal(canCloseEntrySchemaEditor(store.get()), false);
	assert.equal(entrySchemaPanelLocked(store.get()), true);
	store.dispatch({ type: "close" });
	store.dispatch({ type: "open", editor: addEntrySchemaEditor("entry-dddddddddddddddddddd") });
	assert.equal(store.get().editor?.id, adding.id, "the in-flight identifier is kept");
	store.dispatch({ type: "save-error", failure: "unknown" });
	assert.deepEqual([store.get().pending, store.get().unconfirmed?.action], [null, "save"], "the result lands after the panel unmounted");
	assert.ok(notified >= 2);
	store.dispatch({ type: "start", operation: "check" });
	assert.equal(store.get().pending, "check");
	store.dispatch({ type: "check-result", inspected: absentId(adding.id) });
	assert.deepEqual([store.get().pending, store.get().unconfirmed, store.get().editor?.id], [null, null, adding.id]);
	const idle = createEntrySchemaPanelStore();
	idle.dispatch({ type: "start", operation: "save" });
	assert.equal(idle.get().pending, null, "nothing to save means no request");
}


// Authoring is a local adapter over the same draft and command identity.
{
	const blank = addEntrySchemaEditor("entry-cccccccccccccccccccc");
	assert.equal(blank.authoringMode, "choose");
	assert.equal(entrySchemaEditorCanSave(blank), false);
	const opened = reduce(INITIAL_ENTRY_SCHEMA_PANEL, { type: "open", editor: blank });
	const json = createEntrySchemaAuthoring("Article");
	const guided = reduce(opened, { type: "authoring", mode: "guided", json, name: "Article fields" });
	assert.equal(guided.editor?.id, blank.id);
	assert.equal(guided.editor?.expectedRevision, null);
	assert.equal(guided.editor?.draft.json, json);
	assert.equal(entrySchemaEditorCanSave(guided.editor), true);
	const withoutOptional = encodeEntrySchemaAuthoring(json, { fields: { description: undefined, url: undefined } });
	assert.ok(withoutOptional.ok);
	assert.equal(entrySchemaEditorCanSave({ ...guided.editor!, draft: { ...guided.editor!.draft, json: withoutOptional.json } }), true, "clearing optional details removes the property instead of leaving an unsavable empty string");
	const noHeadline = encodeEntrySchemaAuthoring(json, { fields: { headline: "" } });
	assert.ok(noHeadline.ok);
	const incomplete = reduce(guided, { type: "edit", patch: { json: noHeadline.json } });
	assert.equal(entrySchemaEditorCanSave(incomplete.editor), false, "keyboard submit cannot save incomplete guided requirements");
	const raw = reduce(guided, { type: "authoring", mode: "advanced" });
	assert.equal(raw.editor?.draft.json, json, "changing presentation never rewrites JSON");
	assert.equal(raw.editor?.id, blank.id);
	const pending = reduce(guided, { type: "start", operation: "save" });
	assert.equal(reduce(pending, { type: "authoring", mode: "advanced", json: "{}" }), pending, "mode or JSON cannot change a pending command");
	const unknown = reduce(pending, { type: "save-error", failure: "unknown" });
	assert.equal(reduce(unknown, { type: "authoring", mode: "advanced", json: "{}" }), unknown, "an unknown save keeps its exact JSON and recovery");
	assert.equal(entrySchemaEditorCanSave({ ...guided.editor!, draft: { ...guided.editor!.draft, name: "x".repeat(121) } }), false);
	const faq = { ...blank, authoringMode: "guided" as const, draft: { name: "FAQ", json: createEntrySchemaAuthoring("FAQPage"), enabled: true } };
	assert.equal(entrySchemaEditorCanSave(faq), false, "an empty FAQ cannot be submitted");
	const answerMissing = encodeEntrySchemaAuthoring(faq.draft.json, { questions: [{ question: "A visible question?", answer: "" }] });
	assert.ok(answerMissing.ok);
	assert.equal(entrySchemaEditorCanSave({ ...faq, draft: { ...faq.draft, json: answerMissing.json } }), false);
	const completeFaq = encodeEntrySchemaAuthoring(faq.draft.json, { questions: [{ question: "A visible question?", answer: "An explicit answer." }] });
	assert.ok(completeFaq.ok);
	assert.equal(entrySchemaEditorCanSave({ ...faq, draft: { ...faq.draft, json: completeFaq.json } }), true);
	const richer = { ...schema, json: '{"@context":"https://schema.org","@type":"Article","headline":"Saved","author":{"@type":"Person","name":"Explicit author"}}' };
	const existing = editEntrySchemaEditor(richer);
	assert.equal(existing.authoringMode, "advanced");
	assert.equal(entrySchemaEditorCanSave(existing), true, "richer existing JSON retains the authoritative advanced validator");
	assert.equal(existing.draft.json, richer.json);
	const adopted = keepEditsOver({ ...existing, authoringMode: "guided" }, { ...richer, revision: "new-revision" });
	assert.equal(adopted.authoringMode, "guided", "explicit conflict review keeps the draft's presentation");
	const copied = reduce(guided, { type: "apply-template", id: "entry-dddddddddddddddddddd", replace: true, template: { id: "tpl-example", name: "Rich", json: richer.json } });
	assert.equal(copied.editor?.authoringMode, "advanced", "library copies never infer guided conversion");
	assert.equal(copied.editor?.draft.json, richer.json);
	assert.equal(copied.editor?.id, guided.editor?.id, "copying into an existing form keeps its stable target");
}

// A list row is never an editable snapshot; only an explicit exact-ID read opens one.
{
	const target = { collection: "posts", entryId: "01JPOST", locale: "en", id: schema.id, action: "edit" as const };
	const response = (item: EntryCustomSchema = schema): SeoAdminEntrySchemaListResult => ({
		...listed, success: true, inherited: [], inspected: { id: item.id, state: "owned", schema: item },
	});
	const deferred = () => {
		let resolve!: (value: SeoAdminEntrySchemaListResult) => void;
		const promise = new Promise<SeoAdminEntrySchemaListResult>((finish) => { resolve = finish; });
		return { promise, resolve };
	};
	const store = createEntrySchemaPanelStore();
	const opening = createEntrySchemaOpeningController(store);
	const read = deferred();
	let reads = 0;
	const pending = opening.open(target, () => { reads += 1; return read.promise; });
	assert.equal(store.get().opening?.target.action, "edit");
	assert.equal(store.get().editor, null, "no writable editor exists before detail arrives");
	assert.equal(entrySchemaRemovalRequest(store.get()), null, "a summary authorizes no deletion");
	assert.equal(acquireEntrySchemaOperation(store, "save"), false);
	assert.equal(acquireEntrySchemaOperation(store, "remove"), false);
	await opening.open({ ...target, action: "remove" }, async () => { reads += 1; return response(); });
	assert.equal(reads, 1, "duplicate opens, including another action, do not send another request");
	const latest = { ...schema, name: "Changed after listing", revision: "rev-current" };
	read.resolve(response(latest));
	await pending;
	assert.equal(store.get().editor?.draft.name, latest.name, "the form uses the inspected value, not the stale summary");
	assert.equal(store.get().editor?.expectedRevision, "rev-current");
	store.dispatch({ type: "edit", patch: { name: "My unsaved draft" } });
	await opening.open(target, async () => { reads += 1; return response(); });
	assert.equal(reads, 1, "an active draft prevents another opening read");
	assert.equal(store.get().editor?.draft.name, "My unsaved draft");
	assert.equal(store.get().editor?.expectedRevision, "rev-current", "a refresh cannot adopt a newer revision");

	const removing = createEntrySchemaPanelStore();
	await createEntrySchemaOpeningController(removing).open({ ...target, action: "remove" }, async () => response(latest));
	assert.deepEqual(entrySchemaRemovalRequest(removing.get()), { id: schema.id, expectedRevision: "rev-current" });
	assert.equal(removing.get().editor, null, "opening removal does not open an edit form");
	assert.equal(entrySchemaConfirmationDetached(removing.get(), [summary]), false);
	assert.equal(entrySchemaConfirmationDetached(removing.get(), []), true, "a removed list row cannot hide its captured confirmation");
	assert.deepEqual(entrySchemaRemovalRequest(removing.get()), { id: schema.id, expectedRevision: "rev-current" }, "list disappearance never upgrades the captured revision");
	removing.dispatch({ type: "cancel-remove" });
	assert.equal(entrySchemaPanelLocked(removing.get()), false, "Cancel remains a way out after the list target disappeared");
	const invalidJson = { ...schema, valid: false, validationError: "Stored JSON needs repair" };
	const repair = createEntrySchemaPanelStore();
	await createEntrySchemaOpeningController(repair).open(target, async () => response(invalidJson));
	const repaired = repair.get().editor;
	assert.equal(repaired?.mode === "edit" ? repaired.original.valid : null, false, "owned versioned invalid JSON remains explicitly repairable");

	for (const bad of [
		{ ...response(), entry: { ...listed.entry, collection: "pages" } },
		{ ...response(), entry: { ...listed.entry, entryId: "another-entry" } },
		{ ...response(), entry: { ...listed.entry, locale: "nl" } },
		{ ...response(), inspected: { id: "another-id", state: "owned", schema } },
		{ ...response(), inspected: { id: schema.id, state: "owned", schema: { ...schema, revision: "" } } },
		{ ...response(), inspected: { id: schema.id, state: "absent" } },
		{ ...response(), inspected: { id: schema.id, state: "elsewhere" } },
		{ ...version, success: false, error: "storage_unavailable", message: "Unavailable" },
	] as SeoAdminEntrySchemaListResult[]) {
		for (const action of ["edit", "remove"] as const) {
			const denied = createEntrySchemaPanelStore();
			await createEntrySchemaOpeningController(denied).open({ ...target, action }, async () => bad);
			assert.equal(denied.get().editor, null);
			assert.equal(denied.get().confirming, null);
			assert.equal(denied.get().opening, null);
			assert.equal(denied.get().notice?.kind, "failed");
		}
	}

	const cancelled = createEntrySchemaPanelStore();
	const oldOwner = createEntrySchemaOpeningController(cancelled);
	const late = deferred();
	const oldSignal: { value: AbortSignal | null } = { value: null };
	const oldRequest = oldOwner.open(target, (signal) => { oldSignal.value = signal; return late.promise; });
	oldOwner.cancel();
	assert.equal(oldSignal.value?.aborted, true, "unmount/navigation aborts the disposable opening read");
	assert.equal(cancelled.get().opening, null, "unmount immediately releases only the opening token");
	const newOwner = createEntrySchemaOpeningController(cancelled);
	const next = deferred();
	const newRequest = newOwner.open({ ...target, action: "remove" }, () => next.promise);
	late.resolve(response());
	await oldRequest;
	assert.equal(cancelled.get().editor, null, "an old reply cannot open after navigation or remount");
	assert.equal(cancelled.get().opening?.target.action, "remove", "an old reply cannot release the replacement action");
	next.resolve(response(latest));
	await newRequest;
	assert.equal(cancelled.get().confirming?.revision, "rev-current");

	const timed = createEntrySchemaPanelStore();
	const timedRead = deferred();
	const deadlineSignal: { value: AbortSignal | null } = { value: null };
	await createEntrySchemaOpeningController(timed, 1).open(target, (signal) => { deadlineSignal.value = signal; return timedRead.promise; });
	assert.equal(deadlineSignal.value?.aborted, true);
	assert.equal(timed.get().opening, null);
	assert.equal(timed.get().editor, null);
	assert.equal(timed.get().notice?.kind, "failed", "a read timeout is a failed opening, never an unknown write");
	timedRead.resolve(response());
	await Promise.resolve();
	assert.equal(timed.get().editor, null, "a result after the read deadline stays ignored");

	const unknown = createEntrySchemaPanelStore(reduce(INITIAL_ENTRY_SCHEMA_PANEL,
		{ type: "open", editor: editEntrySchemaEditor(schema) }, { type: "save-error", failure: "unknown" }));
	const unknownState = unknown.get();
	const unrelated = createEntrySchemaOpeningController(unknown);
	await unrelated.open(target, async () => { throw new Error("must not read while outcome unknown"); });
	unrelated.cancel();
	assert.equal(unknown.get(), unknownState, "opening cancellation cannot clear a write recovery lock or its draft");
}

console.log("SEO entry schema view model self-check passed.");
