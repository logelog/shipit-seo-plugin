import assert from "node:assert/strict";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_SCHEMA_LIBRARY_LIMITS,
	SEO_ENGINE_VERSION,
	type SchemaLibraryTemplate,
	type SeoAdminEntrySchemaCandidatePreviewResult,
	type SeoAdminSchemaLibrary,
	type SeoAdminSchemaLibraryWriteResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	parseSeoAdminEntrySchemaCandidatePreviewResult,
	parseSeoAdminSchemaLibrary,
	parseSeoAdminSchemaLibraryWriteResult,
	type SeoEntrySchemaCandidateExpectation,
} from "./contract.ts";
import {
	acquireEntrySchemaOperation,
	addEntrySchemaEditor,
	createEntrySchemaCandidateStore,
	createEntrySchemaPanelStore,
	editEntrySchemaEditor,
	entrySchemaCandidateView,
	entrySchemaJsonDirty,
	requestEntrySchemaCandidatePreview,
	savedContentCandidatePort,
	type EntrySchemaCandidatePort,
	type EntrySchemaCandidateTarget,
} from "./entry-schema-model.ts";
import {
	createSchemaLibraryStore,
	filterSchemaLibraryTemplates,
	runSchemaLibraryDelete,
	runSchemaLibrarySave,
	schemaLibraryDraftDirty,
	type SchemaLibraryPort,
} from "./schema-library-model.ts";
import { SEO_ADMIN_VIEWS } from "./content-extension-model.ts";
import { SEO_WORKSPACE_NAV_GROUPS, SEO_WORKSPACE_VIEW_LABELS } from "./workspace-model.ts";

// --- navigation keeps the library distinct ---------------------------------------

assert.ok(SEO_ADMIN_VIEWS.includes("library"));
assert.equal(SEO_WORKSPACE_VIEW_LABELS.library, "Schema library");
assert.ok(SEO_WORKSPACE_NAV_GROUPS.find((group) => group.id === "appearance")?.views.includes("library"), "listed under Search appearance");
assert.notEqual(SEO_WORKSPACE_VIEW_LABELS.templates, SEO_WORKSPACE_VIEW_LABELS.library);

// --- fixtures ----------------------------------------------------------------------

const json = (headline: string) => JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline });
const template = (id: string, name: string, headline: string, updatedAt = "2026-10-03T08:00:00.000Z"): SchemaLibraryTemplate =>
	({ id: `tpl-${id.padEnd(20, "0")}`, name, json: json(headline), createdAt: "2026-10-03T08:00:00.000Z", updatedAt });
const bytesOf = (templates: SchemaLibraryTemplate[]) => new TextEncoder().encode(JSON.stringify({ version: 1, templates })).byteLength;
const library = (revision: string | null, templates: SchemaLibraryTemplate[]): SeoAdminSchemaLibrary => ({
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	state: revision === null ? "absent" : "saved",
	revision,
	templates,
	bytes: revision === null ? 0 : bytesOf(templates),
	corrupt: null,
	conditionalStorage: true,
	limits: SEO_ADMIN_SCHEMA_LIBRARY_LIMITS,
});
const A1 = template("a", "Article", "One");
const B = template("a", "Article", "Changed by B", "2026-10-03T09:00:00.000Z");
const C = template("a", "Article", "Changed by C", "2026-10-03T10:00:00.000Z");
const other = template("b", "FAQ", "Other");

// --- the client accepts only libraries the engine would store ------------------------

assert.equal(parseSeoAdminSchemaLibrary(library("rev-1", [A1, other])).templates.length, 2);
assert.equal(parseSeoAdminSchemaLibrary(library(null, [])).state, "absent");
const big = Array.from({ length: 5 }, (_, index) => template(`big${index}x`, `Big ${index}`, "b".repeat(30_000)));
for (const [label, value] of [
	["reported size lie", { ...library("rev-1", [A1]), bytes: 1 }],
	["record over the cap", { ...library("rev-1", big), bytes: 1 }],
	["duplicate names", library("rev-1", [A1, { ...other, name: "Article" }])],
	["duplicate names, other case", library("rev-1", [A1, { ...other, name: "ARTICLE" }])],
	["untrimmed name", library("rev-1", [{ ...A1, name: " Article" }])],
	["untrimmed JSON", library("rev-1", [{ ...A1, json: `${A1.json}\n` }])],
	["duplicate IDs", library("rev-1", [A1, { ...other, id: A1.id }])],
	["unknown variable", library("rev-1", [{ ...A1, json: json("{{price}}") }])],
	["extra field", library("rev-1", [{ ...A1, enabled: true } as SchemaLibraryTemplate])],
	["saved without revision", { ...library("rev-1", [A1]), revision: null }],
	["limits", { ...library("rev-1", [A1]), limits: { ...SEO_ADMIN_SCHEMA_LIBRARY_LIMITS, templates: 21 } }],
] as const) {
	assert.throws(() => parseSeoAdminSchemaLibrary(value), /Invalid SEO admin response/, label);
}
{
	const save = { operation: "save", mode: "create", id: A1.id, expectedRevision: "rev-1", name: " Article ", json: `${A1.json} ` } as const;
	const saved = library("rev-2", [A1, other]);
	const result = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: true, changed: true, template: A1, library: saved };
	assert.equal(parseSeoAdminSchemaLibraryWriteResult(result, save).success, true, "the trimmed submitted template");
	const update = { ...save, mode: "update" } as const;
	assert.equal(parseSeoAdminSchemaLibraryWriteResult({ ...result, changed: false, library: library("rev-1", [A1, other]) }, update).success, true,
		"an unchanged update answers with the revision it sent");
	const remove = { operation: "delete", id: other.id, expectedRevision: "rev-1" } as const;
	assert.equal(parseSeoAdminSchemaLibraryWriteResult({ ...result, template: null, library: library("rev-2", [A1]) }, remove).success, true);
	for (const [label, value, expectation] of [
		["stored template differs", { ...result, template: { ...A1, json: json("Other") } }, save],
		["no template after a save", { ...result, template: null }, save],
		["another template", { ...result, template: other }, save],
		["another submitted JSON", result, { ...save, json: json("Typed") }],
		["template missing from the library", { ...result, library: library("rev-2", [other]) }, save],
		["unchanged create", { ...result, changed: false }, save],
		["revision did not move", { ...result, library: library("rev-1", [A1, other]) }, save],
		["unchanged update with a new revision", { ...result, changed: false }, update],
		["deleted template still listed", { ...result, template: null, library: library("rev-2", [A1, other]) }, remove],
		["template after a delete", { ...result, template: A1, library: library("rev-2", [A1]) }, remove],
		["unchanged delete", { ...result, changed: false, template: null, library: library("rev-1", [A1]) }, remove],
	] as const) {
		assert.throws(() => parseSeoAdminSchemaLibraryWriteResult(value, expectation), /Invalid SEO admin response/, label);
	}
}

// --- library store: one write per action, newest read wins ------------------------------

class Port implements SchemaLibraryPort {
	saves: unknown[] = [];
	removes: unknown[] = [];
	clock = 100;
	next: SeoAdminSchemaLibraryWriteResult | Error = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, success: false, error: "conflict", message: "The library changed after you loaded it. Nothing was saved. Reload it; your form is kept." };
	async save(request: unknown) {
		this.saves.push(request);
		if (this.next instanceof Error) throw this.next;
		return this.next;
	}
	async remove(request: unknown) {
		this.removes.push(request);
		if (this.next instanceof Error) throw this.next;
		return this.next;
	}
	now() {
		return this.clock;
	}
}

{
	const store = createSchemaLibraryStore();
	const port = new Port();
	const loaded = library("rev-1", [A1, other]);
	store.dispatch({ type: "loaded", read: { library: loaded, requestedAt: 1 } });
	store.dispatch({ type: "open-edit", template: A1, library: loaded });
	store.dispatch({ type: "edit", patch: { json: json("Mine") } });
	assert.equal(schemaLibraryDraftDirty(store.get().editor), true);
	const [first, second] = await Promise.all([runSchemaLibrarySave(store, port, loaded), runSchemaLibrarySave(store, port, loaded)]);
	assert.deepEqual([first, second, port.saves.length], [true, false, 1], "two saves in one tick send one request");

	// The refusal names no version; reads B then C must each replace it, so the choice is made against C.
	assert.equal(store.get().notice?.kind, "conflict");
	store.dispatch({ type: "loaded", read: { library: library("rev-2", [B, other]), requestedAt: 2 } });
	const afterB = store.get().notice;
	assert.ok(afterB?.kind === "conflict" && afterB.current?.json === B.json && afterB.revision === "rev-2");
	store.dispatch({ type: "loaded", read: { library: library("rev-3", [C, other]), requestedAt: 3 } });
	const afterC = store.get().notice;
	assert.ok(afterC?.kind === "conflict" && afterC.current?.json === C.json && afterC.revision === "rev-3", "the newest read replaces an earlier conflict version");
	assert.doesNotMatch(afterC.message, /Nothing was saved/);
	store.dispatch({ type: "loaded", read: { library: library("rev-2", [B, other]), requestedAt: 2 } });
	assert.equal((store.get().notice as { revision: string }).revision, "rev-3", "an older read arriving later is ignored");
	store.dispatch({ type: "keep-edits" });
	const kept = store.get().editor;
	assert.ok(kept?.mode === "update" && kept.basisRevision === "rev-3" && kept.original.json === C.json && kept.draft.json === json("Mine"));
	assert.equal(await runSchemaLibrarySave(store, port, library("rev-3", [C, other])), true);
	assert.deepEqual((port.saves[1] as { expectedRevision: string }).expectedRevision, "rev-3", "the save sends the revision of the version reviewed");
}

// Unknown outcomes are settled only by a read requested after them.
{
	const store = createSchemaLibraryStore();
	const port = new Port();
	const loaded = library("rev-1", [A1]);
	store.dispatch({ type: "loaded", read: { library: loaded, requestedAt: 1 } });
	store.dispatch({ type: "open-edit", template: A1, library: loaded });
	store.dispatch({ type: "edit", patch: { json: json("Mine") } });
	port.clock = 10;
	port.next = Object.assign(new Error("timeout"), { status: 504 });
	await runSchemaLibrarySave(store, port, loaded);
	assert.equal(store.get().unconfirmed?.action, "save");
	assert.equal(await runSchemaLibrarySave(store, port, loaded), false, "nothing is resent while the outcome is unknown");
	store.dispatch({ type: "loaded", read: { library: loaded, requestedAt: 1 } });
	store.dispatch({ type: "loaded", read: { library: loaded, requestedAt: 9 } });
	assert.equal(store.get().unconfirmed?.action, "save", "a cached read, or one sent before the outcome but answered later, does not settle it");
	// A failed refresh produces no read at all, so the outcome stays unknown.
	assert.equal(store.get().unconfirmed?.action, "save");
	// The lost response committed, then someone else saved C: the message states what the library holds now.
	store.dispatch({ type: "loaded", read: { library: library("rev-3", [C]), requestedAt: 20 } });
	const settled = store.get();
	assert.equal(settled.unconfirmed, null);
	assert.ok(settled.notice?.kind === "conflict" && settled.notice.current?.json === C.json && settled.notice.revision === "rev-3");
	assert.doesNotMatch(settled.notice.message, /Nothing was saved|not saved|was saved|Confirmed/i, "no claim about whether the earlier save applied");
	assert.match(settled.notice.message, /differs|different/);
	assert.equal(settled.editor?.draft.json, json("Mine"), "the form is kept");
}
{
	const store = createSchemaLibraryStore();
	const port = new Port();
	const loaded = library("rev-1", [A1]);
	store.dispatch({ type: "loaded", read: { library: loaded, requestedAt: 1 } });
	store.dispatch({ type: "open-edit", template: A1, library: loaded });
	store.dispatch({ type: "edit", patch: { json: json("Mine") } });
	port.clock = 10;
	port.next = new Error("network");
	await runSchemaLibrarySave(store, port, loaded);
	const mine = { ...A1, json: json("Mine"), updatedAt: "2026-10-03T11:00:00.000Z" };
	store.dispatch({ type: "loaded", read: { library: library("rev-2", [mine]), requestedAt: 11 } });
	assert.equal(store.get().editor, null);
	assert.match(store.get().notice?.message ?? "", /now holds "Article" with the content of your form/);
}
{
	const store = createSchemaLibraryStore();
	const port = new Port();
	const loaded = library("rev-1", [A1, other]);
	store.dispatch({ type: "loaded", read: { library: loaded, requestedAt: 1 } });
	store.dispatch({ type: "confirm-delete", template: other, library: loaded });
	port.clock = 10;
	port.next = new Error("network");
	const [first, second] = await Promise.all([runSchemaLibraryDelete(store, port), runSchemaLibraryDelete(store, port)]);
	assert.deepEqual([first, second, port.removes.length], [true, false, 1], "two deletes in one tick send one request");
	assert.deepEqual(port.removes[0], { expectedRevision: "rev-1", id: other.id }, "the reviewed revision and template");
	// Deleted, then recreated by someone else: the read says it is there now, not that the deletion failed.
	const recreated = { ...other, json: json("Recreated"), updatedAt: "2026-10-03T12:00:00.000Z" };
	store.dispatch({ type: "loaded", read: { library: library("rev-3", [A1, recreated]), requestedAt: 11 } });
	assert.equal(store.get().unconfirmed, null);
	assert.match(store.get().notice?.message ?? "", /is in the library now with different content/);
	assert.doesNotMatch(store.get().notice?.message ?? "", /not deleted|was deleted/);
}
{
	const store = createSchemaLibraryStore();
	const loaded = library("rev-1", [A1]);
	store.dispatch({ type: "loaded", read: { library: loaded, requestedAt: 5 } });
	assert.equal(store.get().editor, null);
	store.dispatch({ type: "open-edit", template: { ...A1, json: json("Not stored") }, library: loaded });
	assert.equal(store.get().editor, null, "only a template from the loaded library can be edited");
	store.dispatch({ type: "open-create", id: "tpl-new00000000000000000", library: loaded });
	store.dispatch({ type: "edit", patch: { name: "Draft", json: json("Draft") } });
	const kept = structuredClone(store.get().editor);
	// Leaving and revisiting the view keeps the module store; a cached read changes nothing.
	store.dispatch({ type: "loaded", read: { library: loaded, requestedAt: 5 } });
	assert.deepEqual(store.get().editor, kept);
}
assert.deepEqual(filterSchemaLibraryTemplates([A1, other], "faq other").map((item) => item.name), ["FAQ"]);
assert.deepEqual(filterSchemaLibraryTemplates([A1, other], "  ").length, 2);

// --- entry editor: copying a template fills only the unsaved form -----------------------

const applied = { id: A1.id, name: A1.name, json: A1.json };
{
	const store = createEntrySchemaPanelStore();
	store.dispatch({ type: "apply-template", template: applied, id: "entry-newrecord000000000", replace: false });
	const editor = store.get().editor;
	assert.ok(editor?.mode === "add" && editor.id === "entry-newrecord000000000" && editor.draft.json === A1.json && editor.draft.name === "Article");
	assert.match(store.get().notice?.message ?? "", /not saved yet/);
	assert.equal(entrySchemaJsonDirty(editor), false, "an unchanged copy is not an edit");
	store.dispatch({ type: "edit", patch: { json: json("Typed") } });
	store.dispatch({ type: "apply-template", template: { ...applied, id: other.id, json: other.json }, id: "entry-ignored00000000000", replace: false });
	assert.equal(store.get().editor?.draft.json, json("Typed"), "edited JSON is not replaced without confirmation");
	assert.equal(store.get().pendingTemplate?.id, other.id);
	store.dispatch({ type: "cancel-template" });
	assert.equal(store.get().pendingTemplate, null);
	assert.equal(store.get().editor?.draft.json, json("Typed"));
	store.dispatch({ type: "apply-template", template: { ...applied, id: other.id, json: other.json }, id: "entry-ignored00000000000", replace: true });
	assert.equal(store.get().editor?.draft.json, other.json);
	assert.equal(store.get().editor?.id, "entry-newrecord000000000", "the record identifier is unchanged");
}
{
	const stored = { id: "entry-storedrecord0000000", revision: "rev-9", name: "Stored", json: json("Stored"), enabled: false, types: ["Article"], valid: true, validationError: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
	const store = createEntrySchemaPanelStore();
	store.dispatch({ type: "open", editor: editEntrySchemaEditor(stored) });
	store.dispatch({ type: "apply-template", template: applied, id: "entry-unused00000000000", replace: false });
	const editor = store.get().editor;
	assert.ok(editor?.mode === "edit" && editor.id === stored.id && editor.expectedRevision === "rev-9", "an edit keeps its record and revision");
	assert.equal(editor.draft.json, A1.json);
	assert.equal(editor.draft.name, "Stored", "the record keeps its name");
	assert.equal(editor.draft.enabled, false, "and its output choice");
}

const target: EntrySchemaCandidateTarget = { collection: "posts", entryId: "01JPOSTAAAAAAAAAAAAAAAAAAA", locale: "en", savedVersion: "v-1" };
function answer(requestId: string, extra: Partial<Record<string, unknown>> = {}): SeoAdminEntrySchemaCandidatePreviewResult {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, requestId, success: false,
		error: "content_changed", message: "Content changed while resolving the preview. Load the saved entry again.", ...extra,
	} as SeoAdminEntrySchemaCandidatePreviewResult;
}

// --- entry editor: one request per action, and a pending replacement belongs to its form ----

{
	const store = createEntrySchemaPanelStore();
	store.dispatch({ type: "open", editor: addEntrySchemaEditor("entry-acquire000000000000") });
	assert.deepEqual([acquireEntrySchemaOperation(store, "save"), acquireEntrySchemaOperation(store, "save")], [true, false], "a second Save in the same tick sends nothing");
	assert.equal(acquireEntrySchemaOperation(store, "remove"), false);
	const saved = { id: "entry-acquire000000000000", revision: "rev-1", name: "x", json: json("x"), enabled: true, types: ["Article"], valid: true, validationError: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
	store.dispatch({ type: "save-result", result: { success: true, schema: saved, alreadySaved: false } });
	assert.equal(store.get().editor, null);
	store.dispatch({ type: "open", editor: addEntrySchemaEditor("entry-next0000000000000000") });
	assert.equal(store.get().editor?.id, "entry-next0000000000000000", "the next form is not touched by the earlier request");
	assert.equal(store.get().pending, null);
}
for (const finish of ["save", "check", "close", "use-saved"] as const) {
	const store = createEntrySchemaPanelStore();
	const stored = { id: "entry-pendingreplace00000", revision: "rev-1", name: "Stored", json: json("Stored"), enabled: true, types: ["Article"], valid: true, validationError: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
	store.dispatch({ type: "open", editor: editEntrySchemaEditor(stored) });
	store.dispatch({ type: "edit", patch: { json: json("Edited") } });
	store.dispatch({ type: "apply-template", template: applied, id: "entry-unused00000000000", replace: false });
	assert.equal(store.get().pendingTemplate?.id, applied.id);
	if (finish === "save") {
		store.dispatch({ type: "start", operation: "save" });
		store.dispatch({ type: "save-result", result: { success: true, schema: { ...stored, revision: "rev-2", json: json("Edited") }, alreadySaved: false } });
	} else if (finish === "check") {
		store.dispatch({ type: "start", operation: "save" });
		store.dispatch({ type: "save-error", failure: "unknown" });
		store.dispatch({ type: "start", operation: "check" });
		store.dispatch({ type: "check-result", inspected: { id: stored.id, state: "owned", schema: { ...stored, revision: "rev-2", json: json("Edited") } } });
	} else if (finish === "close") {
		store.dispatch({ type: "close" });
	} else {
		store.dispatch({ type: "save-result", result: { success: false, error: "conflict", current: { ...stored, revision: "rev-3" }, message: "changed" } });
		store.dispatch({ type: "use-saved", current: { ...stored, revision: "rev-3" } });
	}
	assert.equal(store.get().pendingTemplate, null, `${finish} drops the replacement question`);
	store.dispatch({ type: "open", editor: addEntrySchemaEditor("entry-reopened0000000000") });
	assert.equal(store.get().pendingTemplate, null, "a reopened form starts without it");
}

// --- the saved content the editor shows is the content previewed --------------------------

{
	const snapshot = { ref: "posts:01JPOSTAAAAAAAAAAAAAAAAAAA", data: { title: "Saved" }, slug: "launch-notes", sourceVersion: "v-1" };
	const calls = { snapshot: 0, version: 0, preview: [] as unknown[] };
	let versionAfter = "v-1";
	let snapshotVersion = "v-1";
	const port = savedContentCandidatePort({
		readSnapshot: async () => {
			calls.snapshot += 1;
			return { ...snapshot, sourceVersion: snapshotVersion };
		},
		readVersion: async () => {
			calls.version += 1;
			return versionAfter;
		},
		preview: async (request) => {
			calls.preview.push(request);
			return { ...answer(request.requestId), success: true } as unknown as SeoAdminEntrySchemaCandidatePreviewResult;
		},
	});
	const panel = createEntrySchemaPanelStore();
	panel.dispatch({ type: "open", editor: addEntrySchemaEditor("entry-savedcontent000000") });
	panel.dispatch({ type: "edit", patch: { name: "x", json: json("x") } });
	const candidates = createEntrySchemaCandidateStore();
	await requestEntrySchemaCandidatePreview(candidates, port, target, panel.get().editor!, "request-saved-1");
	assert.equal(calls.preview.length, 1);
	assert.deepEqual((calls.preview[0] as { snapshot: unknown }).snapshot, snapshot, "the exact snapshot reaches the endpoint");
	assert.equal(calls.version, 1, "the saved version is read again after the answer");

	snapshotVersion = "v-2";
	await requestEntrySchemaCandidatePreview(candidates, port, target, panel.get().editor!, "request-saved-2");
	assert.equal(calls.preview.length, 1, "content changed before Preview: nothing is sent");
	const before = candidates.get().settled?.outcome;
	assert.ok(before?.kind === "error" && /Saved content changed/.test(before.message));

	snapshotVersion = "v-1";
	versionAfter = "v-2";
	panel.dispatch({ type: "edit", patch: { name: "y" } });
	await requestEntrySchemaCandidatePreview(candidates, port, target, panel.get().editor!, "request-saved-3");
	assert.equal(calls.preview.length, 2);
	const during = candidates.get().settled?.outcome;
	assert.ok(during?.kind === "error" && /Saved content changed or could not be verified/.test(during.message), "content changed during Preview: the answer is not shown");
	assert.equal(calls.snapshot, 3, "one saved-content read per Preview action");
}

// One deadline covers the saved-content read, the request and the final version read.
for (const hung of ["snapshot", "preview", "version"] as const) {
	const signals: AbortSignal[] = [];
	const late: Array<() => void> = [];
	const calls = { preview: 0 };
	const snapshot = { ref: "posts:01JPOSTAAAAAAAAAAAAAAAAAAA", data: {}, slug: "launch-notes", sourceVersion: "v-1" };
	const never = <T,>(signal: AbortSignal, value: T) => {
		signals.push(signal);
		return new Promise<T>((resolve) => late.push(() => resolve(value)));
	};
	const port = savedContentCandidatePort({
		readSnapshot: async (_ref, signal) => (hung === "snapshot" ? never(signal, snapshot) : snapshot),
		readVersion: async (_ref, signal) => (hung === "version" ? never(signal, "v-1") : "v-1"),
		preview: async (request, signal) => {
			calls.preview += 1;
			const value = { ...answer(request.requestId), success: true } as unknown as SeoAdminEntrySchemaCandidatePreviewResult;
			return hung === "preview" ? never(signal, value) : value;
		},
	}, 20);
	const panel = createEntrySchemaPanelStore();
	panel.dispatch({ type: "open", editor: addEntrySchemaEditor("entry-deadline000000000") });
	const candidates = createEntrySchemaCandidateStore();
	await requestEntrySchemaCandidatePreview(candidates, port, target, panel.get().editor!, `request-hung-${hung}`);
	assert.equal(candidates.get().pending, null, `a hung ${hung} read ends the Preview`);
	const outcome = candidates.get().settled?.outcome;
	assert.ok(outcome?.kind === "error" && /could not be loaded/.test(outcome.message), hung);
	assert.ok(signals.length === 1 && signals[0].aborted, `the ${hung} request is aborted`);
	for (const resolve of late) resolve();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(candidates.get().settled?.outcome, outcome, "a late answer changes nothing");
	assert.equal(calls.preview, hung === "snapshot" ? 0 : 1, "nothing is retried");
}

// --- entry editor: the unsaved preview runs only on the owner's Preview action ------------

{
	const panel = createEntrySchemaPanelStore();
	panel.dispatch({ type: "open", editor: addEntrySchemaEditor("entry-candidate00000000a") });
	const candidates = createEntrySchemaCandidateStore();
	const sent: string[] = [];
	const resolvers: Array<() => void> = [];
	const port: EntrySchemaCandidatePort = {
		preview: (request) => {
			sent.push(request.requestId);
			return new Promise((resolve) => resolvers.push(() => resolve(answer(request.requestId))));
		},
	};
	for (let index = 0; index < 50; index += 1) panel.dispatch({ type: "edit", patch: { json: `${json("Typing")}${" ".repeat(index)}`, name: `Name ${index}` } });
	panel.dispatch({ type: "apply-template", template: applied, id: "entry-x0000000000000000", replace: true });
	assert.equal(sent.length, 0, "typing and copying a template send no preview request");
	const editor = panel.get().editor!;
	const first = requestEntrySchemaCandidatePreview(candidates, port, target, editor, "request-first");
	const duplicate = requestEntrySchemaCandidatePreview(candidates, port, target, editor, "request-duplicate");
	assert.equal(sent.length, 1, "a second click on the same form while pending sends nothing");
	resolvers[0]();
	await Promise.all([first, duplicate]);
	assert.equal(entrySchemaCandidateView(candidates.get(), editor, target).status, "shown");
	panel.dispatch({ type: "edit", patch: { enabled: false } });
	assert.equal(entrySchemaCandidateView(candidates.get(), panel.get().editor, target).status, "stale", "an edit hides the earlier answer");
	assert.equal(entrySchemaCandidateView(candidates.get(), editor, { ...target, savedVersion: "v-2" }).status, "stale", "so does a new saved content version");
	assert.equal(entrySchemaCandidateView(candidates.get(), addEntrySchemaEditor("entry-anotherrecord00000"), target).status, "idle", "and another form shows nothing");
	assert.equal(sent.length, 1, "and sends nothing by itself");

	// A late answer to an earlier request never replaces the newer one.
	const older = requestEntrySchemaCandidatePreview(candidates, port, target, panel.get().editor!, "request-older");
	panel.dispatch({ type: "edit", patch: { name: "Newer" } });
	const newer = requestEntrySchemaCandidatePreview(candidates, port, target, panel.get().editor!, "request-newer");
	resolvers[2]();
	await newer;
	resolvers[1]();
	await older;
	assert.equal(candidates.get().settled?.requestId, "request-newer");
	assert.equal(sent.length, 3);
}

// --- candidate answers must match the request they answer -----------------------------------

const expectation: SeoEntrySchemaCandidateExpectation = {
	requestId: "request-0001", collection: "posts", entryId: "01JPOSTAAAAAAAAAAAAAAAAAAA", locale: "en",
	id: "entry-candidate00000000a", expectedRevision: null, name: "Candidate", enabled: true, sourceVersion: null,
};
const graph = { "@context": "https://schema.org", "@type": "Article", headline: "x" };
const success = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, requestId: "request-0001", success: true,
	generatedAt: "2026-10-03T08:00:00.000Z", scope: "plugin-contribution",
	entry: { collection: "posts", entryId: expectation.entryId, locale: "en", slug: "launch-notes", status: "published" },
	content: { sourceKind: "stored-entry", sourceVersion: null },
	candidate: { mode: "add", id: expectation.id, expectedRevision: null, name: "Candidate", enabled: true, graphId: `custom:${expectation.id}`, resolvedBytes: JSON.stringify(graph).length },
	outputEnabled: true, canonicalSource: "entry", saveCheck: { ok: true },
	items: [{ id: `custom:${expectation.id}`, source: "custom", presetKey: null, name: "Candidate", types: ["Article"], disabled: false, emitted: true, suppressedReason: null, conflictId: null, replacesCore: false, graph }],
	limits: { candidateBytes: 131_072, responseBytes: 524_288 },
};
assert.equal(parseSeoAdminEntrySchemaCandidatePreviewResult(success, expectation).success, true);
const malformed: Array<[string, unknown, Partial<SeoEntrySchemaCandidateExpectation>?]> = [
	["another request", { ...success, requestId: "request-0002" }],
	["another entry", { ...success, entry: { ...success.entry, entryId: "01JOTHER" } }],
	["another locale", { ...success, entry: { ...success.entry, locale: "fr" } }],
	["another candidate", { ...success, candidate: { ...success.candidate, id: "entry-other0000000000000", graphId: "custom:entry-other0000000000000" } }],
	["another mode", { ...success, candidate: { ...success.candidate, mode: "edit" } }],
	["another revision", { ...success, candidate: { ...success.candidate, mode: "edit", expectedRevision: "rev-1" } }],
	["another source", { ...success, content: { sourceKind: "saved-snapshot", sourceVersion: "v-1" } }],
	["missing snapshot echo", success, { sourceVersion: "v-1" }],
	["missing graph", { ...success, items: [{ ...success.items[0], graph: undefined }] }],
	["text graph", { ...success, items: [{ ...success.items[0], graph: "{}" }] }],
	["emitted null graph", { ...success, items: [{ ...success.items[0], graph: null }] }],
	["size without graph", { ...success, items: [] }],
	["duplicate candidate", { ...success, items: [success.items[0], success.items[0]] }],
	["oversized resolved bytes", { ...success, candidate: { ...success.candidate, resolvedBytes: 131_073 } }],
	["save check", { ...success, saveCheck: { ok: false } }],
	["canonical source", { ...success, canonicalSource: "theme" }],
	["unknown failure", { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "x", requestId: "request-0001", success: false, error: "teapot", message: "x" }],
	["conflict for another record", { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "x", requestId: "request-0001", success: false, error: "conflict", message: "x", current: { id: "entry-other0000000000000", revision: "r", name: "n", json: "{}", enabled: true, types: [], valid: true, validationError: null, createdAt: "", updatedAt: "" } }, { expectedRevision: "r" }],
];
for (const [label, value, override] of malformed) {
	assert.throws(() => parseSeoAdminEntrySchemaCandidatePreviewResult(value, { ...expectation, ...override }), /Invalid SEO admin response/, label);
}

console.log("SEO schema library model self-check passed.");
