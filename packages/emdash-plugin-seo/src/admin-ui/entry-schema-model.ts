// Presentation state for one entry's own custom JSON-LD. Stored state comes
// from the exact-entry commands; output state comes from the Shipit SEO preview
// and never stands in for the whole rendered page, which other code can extend.
import type {
	EntryCustomSchema,
	EntryCustomSchemaSummary,
	SeoAdminEntrySchemaListResult,
	EntryInheritedSchema,
	EntryInheritedSchemaOwner,
	EntrySchemaFieldErrors,
	EntrySchemaInspection,
	EntrySchemaRemoveResult,
	EntrySchemaSaveResult,
	SeoAdminEntrySchemaCandidatePreviewResult,
	SeoAdminEntrySchemaGraph,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { ENTRY_SCHEMA_NAME_MAX_LENGTH, validateEntrySchemaJson } from "@shipitseo/emdash-plugin-seo/admin-contract";
import { decodeEntrySchemaAuthoring, entrySchemaAuthoringErrors } from "./entry-schema-authoring.ts";

import { verifySavedContentVersions, type SavedContentSnapshot } from "./saved-content-snapshot.ts";

export function otherEmittedEntrySchemaGraphs(graphs: readonly SeoAdminEntrySchemaGraph[], editedId: string | null | undefined): SeoAdminEntrySchemaGraph[] {
	return graphs.filter((graph) => graph.emitted && (!editedId || graph.id !== `custom:${editedId}`));
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A new record's identifier; the server creates it only while it is still absent. */
export function newEntrySchemaId(random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(20))): string {
	return `entry-${[...random().slice(0, 20)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("")}`;
}

export interface EntrySchemaDraft {
	name: string;
	json: string;
	enabled: boolean;
}

/** A library template copied into the form: its loaded snapshot, never read again. */
export interface EntrySchemaAppliedTemplate {
	id: string;
	name: string;
	json: string;
}

export type EntrySchemaAuthoringMode = "choose" | "guided" | "advanced";

export type EntrySchemaEditor =
	| { authoringMode?: EntrySchemaAuthoringMode; mode: "add"; id: string; expectedRevision: null; draft: EntrySchemaDraft; appliedTemplate?: EntrySchemaAppliedTemplate }
	| { authoringMode?: EntrySchemaAuthoringMode; mode: "edit"; id: string; expectedRevision: string; draft: EntrySchemaDraft; original: EntryCustomSchema; appliedTemplate?: EntrySchemaAppliedTemplate };

/** Empty starter values must be filled or removed before an explicit save. */
export function entrySchemaPlaceholderPaths(json: string): string[] {
	try {
		const paths: string[] = [];
		const visit = (item: unknown, path: string) => {
			if (item === "" || (Array.isArray(item) && item.length === 0)) {
				paths.push(path || "root");
				return;
			}
			if (Array.isArray(item)) {
				item.forEach((child, index) => visit(child, `${path}[${index}]`));
				return;
			}
			if (!item || typeof item !== "object") return;
			for (const [key, child] of Object.entries(item)) {
				if (key !== "@context" && key !== "@type") visit(child, path ? `${path}.${key}` : key);
			}
		};
		visit(JSON.parse(json), "");
		return paths;
	} catch {
		return [];
	}
}

/** Rechecked on the current store value by both the button and submit handler. */
export function entrySchemaEditorCanSave(editor: EntrySchemaEditor | null): boolean {
	if (!editor || editor.authoringMode === "choose") return false;
	const name = editor.draft.name.trim();
	if (!name || name.length > ENTRY_SCHEMA_NAME_MAX_LENGTH || !validateEntrySchemaJson(editor.draft.json).ok) return false;
	if (entrySchemaPlaceholderPaths(editor.draft.json).length) return false;
	if (editor.authoringMode === "guided") {
		const decoded = decodeEntrySchemaAuthoring(editor.draft.json);
		return decoded.ok && Object.keys(entrySchemaAuthoringErrors(decoded)).length === 0;
	}
	return true;
}

/** The JSON the form started from or last received from a template. */
export function entrySchemaJsonBaseline(editor: EntrySchemaEditor): string {
	return editor.appliedTemplate?.json ?? (editor.mode === "edit" ? editor.original.json : "");
}

/** Copying a template over JSON that differs from that baseline needs the owner's confirmation. */
export function entrySchemaJsonDirty(editor: EntrySchemaEditor): boolean {
	return editor.draft.json.trim() !== entrySchemaJsonBaseline(editor).trim();
}

export function addEntrySchemaEditor(id: string = newEntrySchemaId()): EntrySchemaEditor {
	return { mode: "add", authoringMode: "choose", id, expectedRevision: null, draft: { name: "", json: "", enabled: true } };
}

export function editEntrySchemaEditor(schema: EntryCustomSchema): EntrySchemaEditor {
	return {
		mode: "edit",
		authoringMode: "advanced",
		id: schema.id,
		expectedRevision: schema.revision,
		draft: { name: schema.name, json: schema.json, enabled: schema.enabled },
		original: schema,
	};
}

/** Keeps the editor's input and adopts the saved revision after the editor reviewed it. */
export function keepEditsOver(editor: EntrySchemaEditor, current: EntryCustomSchema): EntrySchemaEditor {
	return { mode: "edit", authoringMode: editor.authoringMode, id: current.id, expectedRevision: current.revision, draft: editor.draft, original: current };
}

export type EntrySchemaNotice =
	| { kind: "conflict"; message: string; current: EntryCustomSchema | null }
	| { kind: "unconfirmed"; message: string }
	| { kind: "denied"; message: string }
	| { kind: "failed"; message: string }
	| { kind: "info"; message: string };

export type EntrySchemaRequestFailure = "denied" | "rejected" | "unknown";

/**
 * 401 and 403 come from the dispatcher before the command runs; other 4xx
 * responses also mean nothing was written. Anything else, including a timeout,
 * may have followed a committed write.
 */
export function classifyEntrySchemaRequestError(error: unknown): EntrySchemaRequestFailure {
	const status = typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number"
		? (error as { status: number }).status
		: null;
	if (status === 401 || status === 403) return "denied";
	if (status !== null && status >= 400 && status < 500 && status !== 408) return "rejected";
	return "unknown";
}

export const ENTRY_SCHEMA_DENIED_MESSAGE =
	"Changing entry schemas needs the plugin administrator permission (plugins:manage). Nothing was changed.";

export const ENTRY_SCHEMA_DEADLINES = Object.freeze({ writeMs: 20_000, readMs: 15_000 });

export function withEntrySchemaDeadline<T>(request: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
	const controller = new AbortController();
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			const reason = new DOMException("The operation timed out.", "TimeoutError");
			controller.abort(reason);
			reject(reason);
		}, ms);
		request(controller.signal).then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

export function firstEntrySchemaErrorField(errors: EntrySchemaFieldErrors): "name" | "json" | "enabled" | null {
	return errors.name ? "name" : errors.json ? "json" : errors.enabled ? "enabled" : null;
}

export interface EntrySchemaOutputState {
	tone: "active" | "inactive" | "problem";
	label: string;
}

const SUPPRESSION_LABELS: Record<string, string> = {
	"entity-conflict": "another schema on this page already defines the same entity",
	"duplicate-definition": "it defines the same entity twice",
	"duplicate-contribution": "its contribution ID is already in use",
	invalid: "it could not be resolved",
};

/** What the Shipit SEO resolver does with a stored record; not proof of the rendered page. */
export function entrySchemaOutputState(
	schema: EntryCustomSchemaSummary,
	context: { outputEnabled: boolean; entryStatus: string; graph: SeoAdminEntrySchemaGraph | undefined },
): EntrySchemaOutputState {
	if (!schema.valid) return { tone: "problem", label: `Not added to the page: ${schema.validationError ?? "stored JSON-LD is invalid"}` };
	if (!context.outputEnabled) return { tone: "inactive", label: "Saved. Schema output is off in Feature controls" };
	if (!schema.enabled) return { tone: "inactive", label: "Saved. Excluded from page output" };
	const graph = context.graph;
	if (!graph) return { tone: "problem", label: "Saved. The schema preview did not resolve it" };
	if (!graph.emitted) {
		const reason = SUPPRESSION_LABELS[graph.suppressedReason ?? "invalid"] ?? SUPPRESSION_LABELS.invalid;
		return { tone: "problem", label: `Saved, but not added to the page: ${reason}${graph.conflictId ? ` (${graph.conflictId})` : ""}` };
	}
	if (context.entryStatus !== "published") {
		return { tone: "inactive", label: "Saved. Added to the public page once this entry is published" };
	}
	return { tone: "active", label: "In this plugin's output for this page" };
}

export function inheritedOwnerLabel(
	owner: EntryInheritedSchemaOwner,
	collectionLabel: string,
	locales: { entry: string | null; target?: string | null } = { entry: null },
): string {
	switch (owner) {
		case "wrong-locale":
			return `Saved for locale ${locales.target ?? "none"}, but this entry is ${locales.entry ?? "without a locale"}. Not added to the page`;
		case "site":
			return "Site schema, every page";
		case "collection":
			return `${collectionLabel} schema, every entry of this type`;
		case "legacy-slug":
			return "Legacy slug scope, shared by entries with this slug";
		case "legacy-entry":
			return "Older record for this entry, read-only";
	}
}

export interface EntrySchemaInheritedSummary {
	storedCount: number;
	previewCount: number;
	names: string[];
	remainingCount: number;
}

/** Stored records and emitted contributions are different units; neither proves public HTML. */
export function summarizeInheritedEntrySchemas(
	schemas: readonly EntryInheritedSchema[],
	graphs: readonly SeoAdminEntrySchemaGraph[],
	outputEnabled: boolean,
): EntrySchemaInheritedSummary {
	const emittedIds = new Set(graphs.filter((graph) => graph.source === "custom" && graph.emitted).map((graph) => graph.id));
	return {
		storedCount: schemas.length,
		previewCount: outputEnabled
			? schemas.filter((schema) => schema.enabled && schema.valid && schema.owner !== "wrong-locale" && emittedIds.has(`custom:${schema.id}`)).length
			: 0,
		names: schemas.slice(0, 3).map((schema) => schema.types.length ? `${schema.name} (${schema.types.join(", ")})` : schema.name),
		remainingCount: Math.max(0, schemas.length - 3),
	};
}

export type EntrySchemaRowSource = "entry" | "content-type" | "shared" | "site";

export const ENTRY_SCHEMA_SOURCE_LABELS: Readonly<Record<EntrySchemaRowSource, string>> = Object.freeze({
	entry: "This entry",
	"content-type": "Content type default",
	shared: "Shared",
	site: "Site",
});

/** Built-in graphs that describe the site itself rather than this entry's content type. */
const SITE_PRESET_KEYS: ReadonlySet<string> = new Set(["organization", "website"]);
const SOURCE_ORDER: Readonly<Record<EntrySchemaRowSource, number>> = { entry: 0, "content-type": 1, shared: 2, site: 3 };

export interface EntrySchemaInUseRow {
	key: string;
	source: EntrySchemaRowSource;
	name: string;
	types: string[];
	scope: string;
	note: string | null;
	graph: SeoAdminEntrySchemaGraph | null;
	/** Present only on this entry's own records, the only rows that can be edited or removed here. */
	schema: EntryCustomSchemaSummary | null;
}

export interface EntrySchemaNotAddedRow {
	key: string;
	name: string;
	scope: string;
	reason: string;
}

function sharedScope(owner: EntryInheritedSchemaOwner | null, collectionLabel: string): string {
	switch (owner) {
		case "site":
			return "Every page";
		case "collection":
			return `Every ${collectionLabel} entry`;
		case "legacy-slug":
			return "Entries with this slug";
		case "legacy-entry":
			return "Older record for this entry";
		default:
			return "Managed in Schema";
	}
}

function suppressedReason(graph: SeoAdminEntrySchemaGraph): string {
	const reason = SUPPRESSION_LABELS[graph.suppressedReason ?? "invalid"] ?? SUPPRESSION_LABELS.invalid;
	return `Not added: ${reason}${graph.conflictId ? ` (${graph.conflictId})` : ""}`;
}

/**
 * This entry's own records, added or not, then every other graph the Shipit SEO
 * preview adds for it. A prediction of Shipit's output, never the public page.
 */
export function entrySchemaInUseRows(input: {
	items: readonly EntryCustomSchemaSummary[];
	inherited: readonly EntryInheritedSchema[];
	graphs: readonly SeoAdminEntrySchemaGraph[];
	collectionLabel: string;
	outputEnabled: boolean;
}): EntrySchemaInUseRow[] {
	const own = new Set(input.items.map((schema) => `custom:${schema.id}`));
	const owners = new Map<string, EntryInheritedSchemaOwner>(input.inherited.map((schema) => [`custom:${schema.id}`, schema.owner]));
	const rows: EntrySchemaInUseRow[] = input.items.map((schema) => ({
		key: `custom:${schema.id}`,
		source: "entry",
		name: schema.name,
		types: schema.types,
		scope: "Only this entry",
		note: null,
		graph: input.graphs.find((graph) => graph.id === `custom:${schema.id}`) ?? null,
		schema,
	}));
	for (const graph of input.outputEnabled ? input.graphs : []) {
		if (!graph.emitted || own.has(graph.id)) continue;
		if (graph.source === "preset") {
			const site = SITE_PRESET_KEYS.has(graph.presetKey ?? "");
			rows.push({
				key: graph.id,
				source: site ? "site" : "content-type",
				name: graph.name,
				types: graph.types,
				scope: site ? "Every page" : input.collectionLabel,
				note: !graph.replacesCore ? null : graph.presetKey === "webPage" ? "Main graph from this content type's default" : "Enriches EmDash's built-in graph",
				graph,
				schema: null,
			});
		} else {
			rows.push({ key: graph.id, source: "shared", name: graph.name, types: graph.types, scope: sharedScope(owners.get(graph.id) ?? null, input.collectionLabel), note: null, graph, schema: null });
		}
	}
	return rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => SOURCE_ORDER[a.row.source] - SOURCE_ORDER[b.row.source] || a.index - b.index)
		.map(({ row }) => row);
}

/** Shared records that reach this entry by scope but add nothing to its predicted output. */
export function entrySchemaNotAddedRows(input: {
	items: readonly EntryCustomSchemaSummary[];
	inherited: readonly EntryInheritedSchema[];
	graphs: readonly SeoAdminEntrySchemaGraph[];
	collectionLabel: string;
	outputEnabled: boolean;
	locale: string | null;
}): EntrySchemaNotAddedRow[] {
	const own = new Set(input.items.map((schema) => `custom:${schema.id}`));
	const listed = new Set<string>();
	const rows: EntrySchemaNotAddedRow[] = [];
	for (const schema of input.inherited) {
		const key = `custom:${schema.id}`;
		const graph = input.graphs.find((item) => item.id === key);
		listed.add(key);
		if (input.outputEnabled && graph?.emitted) continue;
		const reason = schema.owner === "wrong-locale"
			? inheritedOwnerLabel(schema.owner, input.collectionLabel, { entry: input.locale, target: schema.targetLocale })
			: !input.outputEnabled ? "Not added: schema output is off in Feature controls"
				: !schema.valid ? "Not added: the stored JSON-LD is invalid"
					: !schema.enabled ? "Not added: excluded from page output"
						: graph ? suppressedReason(graph) : "Not added: the schema preview did not resolve it";
		rows.push({ key, name: schema.name, scope: schema.owner === "wrong-locale" ? "Another locale" : sharedScope(schema.owner, input.collectionLabel), reason });
	}
	for (const graph of input.outputEnabled ? input.graphs : []) {
		if (graph.source !== "custom" || graph.emitted || own.has(graph.id) || listed.has(graph.id)) continue;
		rows.push({ key: graph.id, name: graph.name, scope: sharedScope(null, input.collectionLabel), reason: suppressedReason(graph) });
	}
	return rows;
}

function sameDraft(schema: EntryCustomSchema, draft: EntrySchemaDraft): boolean {
	return schema.name === draft.name.trim() && schema.json === draft.json.trim() && schema.enabled === draft.enabled;
}

export type EntrySchemaSaveCheck =
	| { kind: "saved"; schema: EntryCustomSchema }
	| { kind: "not-saved" }
	| { kind: "changed"; schema: EntryCustomSchema }
	| { kind: "removed" }
	| { kind: "elsewhere" };

/**
 * Reads one exact stored ID after an unconfirmed save. An absent new record is
 * not proof of failure until saved again, and a record that left this entry is
 * neither saved nor removed by this editor.
 */
export function checkUnconfirmedSave(editor: EntrySchemaEditor, inspected: EntrySchemaInspection): EntrySchemaSaveCheck {
	if (inspected.state === "elsewhere") return { kind: "elsewhere" };
	if (inspected.state === "absent") return editor.mode === "add" ? { kind: "not-saved" } : { kind: "removed" };
	if (sameDraft(inspected.schema, editor.draft)) return { kind: "saved", schema: inspected.schema };
	if (editor.mode === "edit" && inspected.schema.revision === editor.expectedRevision) return { kind: "not-saved" };
	return { kind: "changed", schema: inspected.schema };
}

export type EntrySchemaRemoveCheck =
	| { kind: "removed" }
	| { kind: "not-removed" }
	| { kind: "changed"; schema: EntryCustomSchema }
	| { kind: "elsewhere" };

export function checkUnconfirmedRemove(target: { revision: string }, inspected: EntrySchemaInspection): EntrySchemaRemoveCheck {
	if (inspected.state === "absent") return { kind: "removed" };
	if (inspected.state === "elsewhere") return { kind: "elsewhere" };
	return inspected.schema.revision === target.revision ? { kind: "not-removed" } : { kind: "changed", schema: inspected.schema };
}

export type EntrySchemaUnconfirmed =
	| { action: "save"; message: string }
	| { action: "remove"; id: string; revision: string; name: string; message: string };

export interface EntrySchemaOpeningTarget {
	collection: string;
	entryId: string;
	locale: string | null;
	id: string;
	action: "edit" | "remove";
}

/** This object identifies one read-only opening, even when its target is requested again. */
export interface EntrySchemaOpening {
	target: EntrySchemaOpeningTarget;
}

export interface EntrySchemaPanelState {
	editor: EntrySchemaEditor | null;
	opening: EntrySchemaOpening | null;
	fieldErrors: EntrySchemaFieldErrors;
	notice: EntrySchemaNotice | null;
	/** Set until the editor reads the stored state; nothing else can change meanwhile. */
	unconfirmed: EntrySchemaUnconfirmed | null;
	/** The record and revision shown when removal was requested. */
	confirming: EntryCustomSchema | null;
	/** A request in flight; it settles into this state even if the panel unmounted. */
	pending: "save" | "remove" | "check" | null;
	/** A template waiting for confirmation before it replaces edited JSON. */
	pendingTemplate: EntrySchemaAppliedTemplate | null;
}

export const INITIAL_ENTRY_SCHEMA_PANEL: EntrySchemaPanelState = Object.freeze({
	editor: null,
	opening: null,
	fieldErrors: {},
	notice: null,
	unconfirmed: null,
	confirming: null,
	pending: null,
	pendingTemplate: null,
});

export type EntrySchemaPanelEvent =
	| { type: "opening-start"; opening: EntrySchemaOpening }
	| { type: "opening-result"; opening: EntrySchemaOpening; result: SeoAdminEntrySchemaListResult }
	| { type: "opening-failed"; opening: EntrySchemaOpening; message: string }
	| { type: "opening-cancel"; opening: EntrySchemaOpening }
	| { type: "start"; operation: "save" | "remove" | "check" }
	| { type: "open"; editor: EntrySchemaEditor }
	| { type: "close" }
	| { type: "edit"; patch: Partial<EntrySchemaDraft> }
	| { type: "authoring"; mode: EntrySchemaAuthoringMode; json?: string; name?: string }
	| { type: "authoring-error"; message: string }
	| { type: "confirm-remove"; schema: EntryCustomSchema }
	| { type: "cancel-remove" }
	| { type: "save-result"; result: EntrySchemaSaveResult }
	| { type: "save-error"; failure: EntrySchemaRequestFailure }
	| { type: "remove-result"; target: EntryCustomSchema; result: EntrySchemaRemoveResult }
	| { type: "remove-error"; target: EntryCustomSchema; failure: EntrySchemaRequestFailure }
	| { type: "check-result"; inspected: EntrySchemaInspection }
	| { type: "check-failed"; message: string }
	| { type: "use-saved"; current: EntryCustomSchema }
	| { type: "keep-edits"; current: EntryCustomSchema }
	| { type: "save-as-new"; id: string }
	/** Copies a loaded template into the form; `id` names the record a new form would create. */
	| { type: "apply-template"; template: EntrySchemaAppliedTemplate; id: string; replace: boolean }
	| { type: "cancel-template" };

const UNCONFIRMED_SAVE = "The save could not be confirmed. It may have been stored. Check the current state before saving again.";
const UNCONFIRMED_REMOVE = "The removal could not be confirmed. Check the current state before trying again.";

/** A save in flight or with an unknown outcome keeps its form, since checking compares against that input. */
export function canCloseEntrySchemaEditor(state: EntrySchemaPanelState): boolean {
	return state.unconfirmed?.action !== "save" && state.pending !== "save";
}

/** Changing anything else waits for an editor, a confirmation, a request or an unknown outcome. */
export function entrySchemaPanelLocked(state: EntrySchemaPanelState): boolean {
	return state.opening !== null || state.editor !== null || state.confirming !== null || state.unconfirmed !== null || state.pending !== null;
}

/** Removal always sends the revision the editor confirmed, never a later refresh. */
export function entrySchemaRemovalRequest(state: EntrySchemaPanelState): { id: string; expectedRevision: string } | null {
	return state.confirming ? { id: state.confirming.id, expectedRevision: state.confirming.revision } : null;
}

/** An edit whose record left the list still needs its form, input and Cancel. */
export function entrySchemaEditorDetached(state: EntrySchemaPanelState, items: readonly EntryCustomSchemaSummary[]): boolean {
	const editor = state.editor;
	return editor !== null && (editor.mode === "add" || !items.some((schema) => schema.id === editor.id));
}

/** A refresh may remove the list row, but its captured confirmation must stay reachable. */
export function entrySchemaConfirmationDetached(state: EntrySchemaPanelState, items: readonly EntryCustomSchemaSummary[]): boolean {
	const target = state.confirming;
	return target !== null && !items.some((schema) => schema.id === target.id);
}

function requestFailure(
	state: EntrySchemaPanelState,
	failure: EntrySchemaRequestFailure,
	unknown: EntrySchemaUnconfirmed,
): EntrySchemaPanelState {
	if (failure === "denied") return { ...state, notice: { kind: "denied", message: ENTRY_SCHEMA_DENIED_MESSAGE } };
	if (failure === "rejected") return { ...state, notice: { kind: "failed", message: "The request was refused. Nothing was changed." } };
	return { ...state, notice: null, unconfirmed: unknown };
}

/**
 * A pending template replacement belongs to the form it was asked for; when
 * that form closes or another editor takes its place, the question is dropped.
 */
export function entrySchemaPanelReducer(current: EntrySchemaPanelState, event: EntrySchemaPanelEvent): EntrySchemaPanelState {
	const next = panelReducer(current, event);
	const keepsForm = event.type === "edit" || event.type === "apply-template" || event.type === "cancel-template" || event.type === "start";
	if (next.pendingTemplate && (!next.editor || (!keepsForm && next.editor !== current.editor))) return { ...next, pendingTemplate: null };
	return next;
}

/**
 * Claims the panel for one request. Only the call that moves `pending` from
 * empty to this operation may send; a second call in the same tick finds it
 * taken.
 */
export function acquireEntrySchemaOperation(store: EntrySchemaPanelStore, operation: "save" | "remove" | "check"): boolean {
	const before = store.get();
	if (before.pending !== null) return false;
	store.dispatch({ type: "start", operation });
	const after = store.get();
	return after !== before && after.pending === operation;
}

function panelReducer(current: EntrySchemaPanelState, event: EntrySchemaPanelEvent): EntrySchemaPanelState {
	if (event.type === "opening-start") {
		if (entrySchemaPanelLocked(current)) return current;
		return { ...current, opening: event.opening, notice: null };
	}
	if (event.type === "opening-result" || event.type === "opening-failed" || event.type === "opening-cancel") {
		if (current.opening !== event.opening) return current;
		const state = { ...current, opening: null };
		if (event.type === "opening-cancel") return state;
		if (event.type === "opening-failed") return { ...state, notice: { kind: "failed", message: event.message } };
		const { target } = event.opening;
		const result = event.result;
		if (!result.success || result.entry.collection !== target.collection || result.entry.entryId !== target.entryId ||
			result.entry.locale !== target.locale || result.inspected?.id !== target.id) {
			return { ...state, notice: { kind: "failed", message: "This schema could not be loaded. Try again." } };
		}
		const inspected = result.inspected;
		if (inspected.state !== "owned") {
			return { ...state, notice: { kind: "failed", message: inspected.state === "absent"
				? "This schema was removed. Reload the list."
				: "This schema no longer belongs to this entry." } };
		}
		const schema = inspected.schema;
		if (schema.id !== target.id || typeof schema.revision !== "string" || !schema.revision.trim()) {
			return { ...state, notice: { kind: "failed", message: "This schema could not be loaded. Try again." } };
		}
		return target.action === "edit"
			? { ...state, editor: editEntrySchemaEditor(schema), fieldErrors: {}, notice: null }
			: { ...state, confirming: schema, notice: null };
	}
	if (current.opening) return current;
	if (event.type === "start") {
		if (current.pending || current.opening) return current;
		if (event.operation === "save" && (!current.editor || current.unconfirmed)) return current;
		if (event.operation === "remove" && (!current.confirming || current.unconfirmed)) return current;
		if (event.operation === "check" && !current.unconfirmed) return current;
		return { ...current, pending: event.operation };
	}
	// Results settle the request they answer; nothing else changes while one is in flight.
	const settles = ["save-result", "save-error", "remove-result", "remove-error", "check-result", "check-failed"].includes(event.type);
	if (current.pending && !settles) return current;
	const state = settles ? { ...current, pending: null } : current;
	switch (event.type) {
		case "open":
			if (entrySchemaPanelLocked(state)) return state;
			return { ...state, editor: event.editor, fieldErrors: {}, notice: null };
		case "close":
			if (!canCloseEntrySchemaEditor(state)) return state;
			return { ...state, editor: null, fieldErrors: {}, notice: null, pendingTemplate: null };
		case "apply-template": {
			if (state.unconfirmed || state.confirming) return state;
			const template = { id: event.template.id, name: event.template.name, json: event.template.json };
			const copied: EntrySchemaNotice = { kind: "info", message: `Copied "${template.name}" into this form. It is not saved yet.` };
			if (!state.editor) {
				return {
					...state,
					editor: { ...addEntrySchemaEditor(event.id), authoringMode: "advanced", draft: { name: template.name, json: template.json, enabled: true }, appliedTemplate: template },
					fieldErrors: {},
					notice: copied,
					pendingTemplate: null,
				};
			}
			if (entrySchemaJsonDirty(state.editor) && !event.replace) return { ...state, pendingTemplate: template };
			const fieldErrors = { ...state.fieldErrors };
			delete fieldErrors.json;
			if (!state.editor.draft.name.trim()) delete fieldErrors.name;
			return {
				...state,
				editor: {
					...state.editor,
					authoringMode: "advanced",
					draft: { ...state.editor.draft, json: template.json, name: state.editor.draft.name.trim() ? state.editor.draft.name : template.name },
					appliedTemplate: template,
				},
				fieldErrors,
				notice: copied,
				pendingTemplate: null,
			};
		}
		case "cancel-template":
			return { ...state, pendingTemplate: null };
		case "edit": {
			if (!state.editor || state.unconfirmed) return state;
			const fieldErrors = { ...state.fieldErrors };
			for (const key of Object.keys(event.patch) as Array<keyof EntrySchemaDraft>) delete fieldErrors[key];
			return { ...state, editor: { ...state.editor, draft: { ...state.editor.draft, ...event.patch } }, fieldErrors };
		}
		case "authoring-error":
			if (!state.editor || state.unconfirmed || state.confirming) return state;
			return { ...state, fieldErrors: { ...state.fieldErrors, json: event.message } };
		case "authoring":
			if (!state.editor || state.unconfirmed || state.confirming) return state;
			return {
				...state,
				editor: {
					...state.editor,
					authoringMode: event.mode,
					...(event.json === undefined ? {} : { appliedTemplate: undefined }),
					draft: {
						...state.editor.draft,
						...(event.json === undefined ? {} : { json: event.json }),
						...(event.name === undefined ? {} : { name: event.name }),
					},
				},
				fieldErrors: event.json === undefined ? state.fieldErrors : {},
			};
		case "confirm-remove":
			if (entrySchemaPanelLocked(state)) return state;
			return { ...state, confirming: event.schema, notice: null };
		case "cancel-remove":
			return { ...state, confirming: null };
		case "save-result": {
			const result = event.result;
			if (result.success) {
				return {
					...state,
					editor: null,
					fieldErrors: {},
					unconfirmed: null,
					notice: {
						kind: "info",
						message: result.alreadySaved
							? `“${result.schema.name}” was already saved by the earlier request.`
							: `Saved “${result.schema.name}”.`,
					},
				};
			}
			if (result.error === "invalid_values") return { ...state, fieldErrors: result.errors, notice: null };
			if (result.error === "conflict") return { ...state, notice: { kind: "conflict", message: result.message, current: result.current } };
			if (result.error === "unconfirmed") return { ...state, notice: null, unconfirmed: { action: "save", message: result.message } };
			if ((result.error === "not_found" || result.error === "scope_mismatch") && state.editor?.mode === "edit") {
				return { ...state, notice: { kind: "conflict", message: result.message, current: null } };
			}
			return { ...state, notice: { kind: "failed", message: result.message } };
		}
		case "save-error":
			return requestFailure(state, event.failure, { action: "save", message: UNCONFIRMED_SAVE });
		case "remove-result": {
			const result = event.result;
			const settled = { ...state, confirming: null };
			if (result.success) return { ...settled, notice: { kind: "info", message: `Removed “${event.target.name}”.` } };
			if (result.error === "unconfirmed") {
				return {
					...settled,
					notice: null,
					unconfirmed: { action: "remove", id: event.target.id, revision: event.target.revision, name: event.target.name, message: result.message },
				};
			}
			return { ...settled, notice: { kind: result.error === "not_found" ? "info" : "failed", message: result.message } };
		}
		case "remove-error":
			return requestFailure({ ...state, confirming: null }, event.failure, {
				action: "remove",
				id: event.target.id,
				revision: event.target.revision,
				name: event.target.name,
				message: UNCONFIRMED_REMOVE,
			});
		case "check-result": {
			const pending = state.unconfirmed;
			if (!pending) return state;
			if (pending.action === "remove") {
				if (event.inspected.id !== pending.id) return state;
				const check = checkUnconfirmedRemove(pending, event.inspected);
				return {
					...state,
					unconfirmed: null,
					notice:
						check.kind === "removed"
							? { kind: "info", message: `Confirmed: “${pending.name}” is removed.` }
							: check.kind === "not-removed"
								? { kind: "info", message: `“${pending.name}” was not removed.` }
								: check.kind === "elsewhere"
									? { kind: "failed", message: `“${pending.name}” is no longer owned by this entry and was not removed here. Review it in the SEO workspace.` }
									: { kind: "failed", message: `“${pending.name}” changed elsewhere and was not removed. Review it before removing.` },
				};
			}
			if (!state.editor) return { ...state, unconfirmed: null };
			if (event.inspected.id !== state.editor.id) return state;
			const check = checkUnconfirmedSave(state.editor, event.inspected);
			if (check.kind === "saved") {
				return { ...state, editor: null, unconfirmed: null, notice: { kind: "info", message: `Confirmed: “${check.schema.name}” is saved.` } };
			}
			if (check.kind === "not-saved") {
				return {
					...state,
					unconfirmed: null,
					notice: {
						kind: "info",
						message:
							state.editor.mode === "add"
								? "Not stored yet. Your input is kept; saving again creates it only if it is still absent."
								: "Not saved. Your input is kept; save again to apply it.",
					},
				};
			}
			return {
				...state,
				unconfirmed: null,
				notice:
					check.kind === "changed"
						? { kind: "conflict", message: "This schema changed elsewhere. Your save is not confirmed.", current: check.schema }
						: check.kind === "elsewhere"
							? { kind: "conflict", message: "This identifier now belongs elsewhere. Your input is kept; save it as a new schema.", current: null }
							: { kind: "conflict", message: "This schema was removed elsewhere. Your input is kept.", current: null },
			};
		}
		case "check-failed":
			if (!state.unconfirmed) return state;
			return { ...state, unconfirmed: { ...state.unconfirmed, message: `${event.message} The outcome is still unknown.` } };
		case "use-saved":
			return { ...state, editor: editEntrySchemaEditor(event.current), fieldErrors: {}, notice: null };
		case "keep-edits":
			if (!state.editor) return state;
			return {
				...state,
				editor: keepEditsOver(state.editor, event.current),
				notice: { kind: "info", message: "Your edits are kept over the saved version. Review them, then save." },
			};
		case "save-as-new":
			if (!state.editor) return state;
			return {
				...state,
				editor: { ...addEntrySchemaEditor(event.id), authoringMode: state.editor.authoringMode ?? "advanced", draft: state.editor.draft },
				fieldErrors: {},
				notice: { kind: "info", message: "Your input will be saved as a new schema. Review it, then save." },
			};
	}
}

export interface EntrySchemaPanelStore {
	get(): EntrySchemaPanelState;
	dispatch(event: EntrySchemaPanelEvent): void;
	subscribe(listener: () => void): () => void;
}

/** Outlives the panel, so closing the dialog or switching tabs keeps a request, its identifier and its recovery. */
export function createEntrySchemaPanelStore(initial: EntrySchemaPanelState = INITIAL_ENTRY_SCHEMA_PANEL): EntrySchemaPanelStore {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		dispatch(event) {
			const next = entrySchemaPanelReducer(state, event);
			if (next === state) return;
			state = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export interface EntrySchemaOpeningController {
	open(target: EntrySchemaOpeningTarget, read: (signal: AbortSignal) => Promise<SeoAdminEntrySchemaListResult>): Promise<void>;
	cancel(): void;
}

/** Opening reads are disposable; saves and uncertain write recovery retain their existing owner. */
export function createEntrySchemaOpeningController(
	store: EntrySchemaPanelStore,
	deadlineMs: number = ENTRY_SCHEMA_DEADLINES.readMs,
): EntrySchemaOpeningController {
	let active: { opening: EntrySchemaOpening; controller: AbortController; cancelled: boolean } | null = null;
	return {
		async open(target, read) {
			const opening: EntrySchemaOpening = { target: { ...target } };
			store.dispatch({ type: "opening-start", opening });
			if (store.get().opening !== opening) return;
			const attempt = { opening, controller: new AbortController(), cancelled: false };
			active = attempt;
			try {
				const result = await withEntrySchemaDeadline(async (signal) => {
					const abort = () => attempt.controller.abort(signal.reason);
					signal.addEventListener("abort", abort, { once: true });
					try { return await read(attempt.controller.signal); }
					finally { signal.removeEventListener("abort", abort); }
				}, deadlineMs);
				if (active === attempt && !attempt.cancelled) store.dispatch({ type: "opening-result", opening, result });
			} catch (error) {
				if (active === attempt && !attempt.cancelled) store.dispatch({ type: "opening-failed", opening, message:
					classifyEntrySchemaRequestError(error) === "denied" ? ENTRY_SCHEMA_DENIED_MESSAGE : "This schema could not be loaded. Try again." });
			} finally {
				if (active === attempt) active = null;
			}
		},
		cancel() {
			if (!active) return;
			const attempt = active;
			active = null;
			attempt.cancelled = true;
			attempt.controller.abort();
			store.dispatch({ type: "opening-cancel", opening: attempt.opening });
		},
	};
}

// ---- Unsaved candidate preview ------------------------------------------------

/** What the editor shows a candidate preview against, besides the form itself. */
export interface EntrySchemaCandidateTarget {
	collection: string;
	entryId: string;
	locale: string | null;
	/** The saved content version the editor shows, when it has one. */
	savedVersion: string | null;
}

/** Everything a preview answer depends on; any change makes an earlier answer stale. */
export function entrySchemaCandidateKey(target: EntrySchemaCandidateTarget, editor: EntrySchemaEditor): string {
	return JSON.stringify([
		target.collection, target.entryId, target.locale, target.savedVersion,
		editor.mode, editor.id, editor.expectedRevision,
		editor.draft.name.trim(), editor.draft.json.trim(), editor.draft.enabled,
	]);
}

/** The record a form edits; an answer for another record is never shown, not even as stale. */
export function entrySchemaCandidateIdentity(editor: EntrySchemaEditor): string {
	return `${editor.mode}:${editor.id}`;
}

export function newEntrySchemaCandidateRequestId(random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(20))): string {
	return `candidate-${[...random().slice(0, 20)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("")}`;
}

export type EntrySchemaCandidateOutcome =
	| { kind: "result"; value: SeoAdminEntrySchemaCandidatePreviewResult }
	| { kind: "error"; message: string };

export interface EntrySchemaCandidateState {
	pending: { key: string; identity: string; requestId: string } | null;
	settled: { key: string; identity: string; requestId: string; outcome: EntrySchemaCandidateOutcome } | null;
}

export const INITIAL_ENTRY_SCHEMA_CANDIDATE: EntrySchemaCandidateState = Object.freeze({ pending: null, settled: null });

export type EntrySchemaCandidateEvent =
	| { type: "requested"; key: string; identity: string; requestId: string }
	| { type: "answered"; requestId: string; outcome: EntrySchemaCandidateOutcome }
	| { type: "reset" };

/** Only the latest request settles; an earlier answer arriving late is dropped. */
export function entrySchemaCandidateReducer(state: EntrySchemaCandidateState, event: EntrySchemaCandidateEvent): EntrySchemaCandidateState {
	switch (event.type) {
		case "requested":
			return { ...state, pending: { key: event.key, identity: event.identity, requestId: event.requestId } };
		case "answered":
			if (state.pending?.requestId !== event.requestId) return state;
			return { pending: null, settled: { ...state.pending, outcome: event.outcome } };
		case "reset":
			return INITIAL_ENTRY_SCHEMA_CANDIDATE;
	}
}

export type EntrySchemaCandidateView =
	| { status: "idle" }
	| { status: "loading" }
	/** An answer exists for an earlier form; it is not shown. */
	| { status: "stale" }
	| { status: "shown"; outcome: EntrySchemaCandidateOutcome };

export function entrySchemaCandidateView(state: EntrySchemaCandidateState, editor: EntrySchemaEditor | null, target: EntrySchemaCandidateTarget): EntrySchemaCandidateView {
	if (!editor) return { status: "idle" };
	const identity = entrySchemaCandidateIdentity(editor);
	if (state.pending?.identity === identity) return { status: "loading" };
	if (!state.settled || state.settled.identity !== identity) return { status: "idle" };
	return state.settled.key === entrySchemaCandidateKey(target, editor) ? { status: "shown", outcome: state.settled.outcome } : { status: "stale" };
}

/** What the prediction says about the candidate itself; never a claim about the rendered page. */
export function entrySchemaCandidateOutputState(
	preview: Extract<SeoAdminEntrySchemaCandidatePreviewResult, { success: true }>,
): EntrySchemaOutputState {
	if (!preview.outputEnabled) return { tone: "inactive", label: "Schema output is off in Feature controls, so this plugin would add nothing to this page." };
	if (!preview.candidate.enabled) return { tone: "inactive", label: "Excluded from page output. Saving it would not add it to the page." };
	const graph = preview.items.find((item) => item.id === preview.candidate.graphId);
	if (!graph) return { tone: "problem", label: "The resolver would not include it." };
	if (!graph.emitted) {
		const reason = SUPPRESSION_LABELS[graph.suppressedReason ?? "invalid"] ?? SUPPRESSION_LABELS.invalid;
		return { tone: "problem", label: `Would not be added to the page: ${reason}${graph.conflictId ? ` (${graph.conflictId})` : ""}` };
	}
	if (preview.entry.status !== "published") {
		return { tone: "inactive", label: "Would be added to the public page once this entry is published." };
	}
	return { tone: "active", label: "Would be added to this plugin's output for this page once saved." };
}

export interface EntrySchemaCandidateStore {
	get(): EntrySchemaCandidateState;
	dispatch(event: EntrySchemaCandidateEvent): void;
	subscribe(listener: () => void): () => void;
}

export function createEntrySchemaCandidateStore(): EntrySchemaCandidateStore {
	let state = INITIAL_ENTRY_SCHEMA_CANDIDATE;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		dispatch(event) {
			const next = entrySchemaCandidateReducer(state, event);
			if (next === state) return;
			state = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/** The request the editor sends; the port adds the saved content snapshot. */
export interface EntrySchemaCandidateRequest {
	requestId: string;
	collection: string;
	entryId: string;
	locale: string | null;
	id: string;
	expectedRevision: string | null;
	name: string;
	json: string;
	enabled: boolean;
}

export interface EntrySchemaCandidatePort {
	preview(request: EntrySchemaCandidateRequest, savedVersion: string | null): Promise<SeoAdminEntrySchemaCandidatePreviewResult>;
}

export interface EntrySchemaSavedContentReader {
	readSnapshot(ref: string, signal: AbortSignal): Promise<SavedContentSnapshot | null>;
	readVersion(ref: string, signal: AbortSignal): Promise<string | null>;
	preview(request: EntrySchemaCandidateRequest & { snapshot: SavedContentSnapshot }, signal: AbortSignal): Promise<SeoAdminEntrySchemaCandidatePreviewResult>;
}

/**
 * The entry preview's saved-content checks around one candidate request: the
 * snapshot read now must be the version the editor shows, it is sent with
 * the request, and the saved version is read again after the answer. One
 * deadline and one abort signal cover all three requests, so a hung read
 * ends the Preview instead of leaving it pending.
 */
export function savedContentCandidatePort(
	reader: EntrySchemaSavedContentReader,
	deadlineMs: number = ENTRY_SCHEMA_DEADLINES.writeMs,
): EntrySchemaCandidatePort {
	return {
		preview: (request, savedVersion) => withEntrySchemaDeadline(async (signal) => {
			const ref = `${request.collection}:${request.entryId}`;
			// After the deadline a late read never leads to the next request.
			const snapshot = await reader.readSnapshot(ref, signal);
			signal.throwIfAborted();
			if (!snapshot) throw new Error("Saved content could not be read. Reload the entry before previewing.");
			if (savedVersion !== null && snapshot.sourceVersion !== savedVersion) {
				throw new Error("Saved content changed. Reload the entry before previewing.");
			}
			const result = await reader.preview({ ...request, snapshot }, signal);
			signal.throwIfAborted();
			if (result.success) {
				const verified = await verifySavedContentVersions([snapshot], (requested) => reader.readVersion(requested, signal), signal);
				signal.throwIfAborted();
				if (!verified.items.length) throw new Error("Saved content changed or could not be verified. Reload the entry before previewing.");
			}
			return result;
		}, deadlineMs),
	};
}

/**
 * Sends one preview for the form as it is now. Only the owner's Preview action
 * calls this; typing, copying a template or switching tabs never does, and a
 * failed request is not retried.
 */
export async function requestEntrySchemaCandidatePreview(
	store: EntrySchemaCandidateStore,
	port: EntrySchemaCandidatePort,
	target: EntrySchemaCandidateTarget,
	editor: EntrySchemaEditor,
	requestId: string = newEntrySchemaCandidateRequestId(),
): Promise<void> {
	const key = entrySchemaCandidateKey(target, editor);
	// A second click on the same form while its preview is pending sends nothing.
	if (store.get().pending?.key === key) return;
	store.dispatch({ type: "requested", key, identity: entrySchemaCandidateIdentity(editor), requestId });
	try {
		const value = await port.preview({
			requestId,
			collection: target.collection,
			entryId: target.entryId,
			locale: target.locale,
			id: editor.id,
			expectedRevision: editor.expectedRevision,
			name: editor.draft.name,
			json: editor.draft.json,
			enabled: editor.draft.enabled,
		}, target.savedVersion);
		store.dispatch({ type: "answered", requestId, outcome: { kind: "result", value } });
	} catch (error) {
		const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
		const message = classifyEntrySchemaRequestError(error) === "denied"
			? "Previewing schemas needs the plugin administrator permission (plugins:manage)."
			: status === 413
				? "This entry's saved content is larger than the schema preview accepts. Nothing was changed."
				: error instanceof Error && error.message.startsWith("Saved content")
					? error.message
					: "The preview could not be loaded. Nothing was changed; preview again to retry.";
		store.dispatch({ type: "answered", requestId, outcome: { kind: "error", message } });
	}
}
