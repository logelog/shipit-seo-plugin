// State for the Templates view, kept outside React so a draft, a pending
// command and a pending preview survive leaving and reopening the view. Each
// draft remembers the record revision and inheritance guard it was edited
// against; a command sends those, never a revision read later. A newer read
// rebases a draft only when its own collection is unchanged, so a change the
// editor has not seen always needs an explicit choice. A preview belongs to
// the selection generation that requested it.

import {
	validateSeoAdminTemplateValues,
	type SeoAdminTemplateConfiguration,
	type SeoAdminTemplateErrors,
	type SeoAdminTemplateField,
	type SeoAdminTemplateInheritanceGuard,
	type SeoAdminTemplateItem,
	type SeoAdminTemplatePreviewResult,
	type SeoAdminTemplatesSaveResult,
	type SeoAdminTemplateValues,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { classifySchemaLibraryRequestError, type SchemaLibraryRequestFailure } from "./schema-library-model.ts";
import {
	parseTemplateExampleRef,
	sameTemplateExampleTarget,
	type TemplateExampleRequest,
	type TemplateExampleTarget,
} from "./template-example-selection-model.ts";

export type { TemplateExampleTarget } from "./template-example-selection-model.ts";

export const TEMPLATE_FIELDS: readonly SeoAdminTemplateField[] = Object.freeze([
	"title",
	"description",
	"socialTitle",
	"socialDescription",
]);

export const METADATA_TEMPLATE_DEADLINES = Object.freeze({ writeMs: 20_000, previewMs: 15_000 });

let lastStamp = 0;
/** Strictly increasing, so a read requested after an unknown outcome is ordered after it. */
export function nextTemplateStamp(now: () => number = Date.now): number {
	lastStamp = Math.max(now(), lastStamp + 1);
	return lastStamp;
}

export const TEMPLATE_DENIED_MESSAGE =
	"Changing templates needs the plugin administrator permission (plugins:manage). Nothing was changed.";
const UNKNOWN_SAVE = "The save could not be confirmed. It may or may not have been stored. Reload the templates before changing them again.";
const UNKNOWN_RESET = "The reset could not be confirmed. It may or may not have been applied. Reload the templates before changing them again.";

export interface TemplatesRead {
	configuration: SeoAdminTemplateConfiguration;
	/** When the read was requested; an older request never replaces a newer one. */
	requestedAt: number;
}

export interface TemplateDraft {
	values: SeoAdminTemplateValues;
	/** The item and record revision the editing started from or was explicitly rebased on. */
	loaded: SeoAdminTemplateItem;
	loadedRevision: string | null;
	errors: SeoAdminTemplateErrors;
}

export interface TemplateOperation {
	id: string;
	kind: "save" | "reset";
	collection: string;
	expectedRevision: string | null;
	inheritanceGuard: SeoAdminTemplateInheritanceGuard;
	values: SeoAdminTemplateValues | null;
	startedAt: number;
}

export interface TemplateResetReview {
	collection: string;
	revision: string | null;
	inheritanceGuard: SeoAdminTemplateInheritanceGuard;
	inherited: SeoAdminTemplateItem["inherited"];
	current: SeoAdminTemplateValues;
}

export interface TemplatePreviewRequest {
	collection: string;
	entryId: string;
	locale: string;
	values: SeoAdminTemplateValues;
}

export type TemplatePreviewOutcome =
	| { kind: "result"; result: SeoAdminTemplatePreviewResult }
	| { kind: "failed"; message: string };

export interface TemplatePreviewState {
	pending: { id: string; key: string; generation: number; request: TemplatePreviewRequest } | null;
	settled: { key: string; generation: number; outcome: TemplatePreviewOutcome } | null;
}

export type TemplateNotice = { collection: string; tone: "success" | "info" | "error"; text: string };

export interface TemplateConflict {
	message: string;
	/** Until a readable read requested after this is applied, no choice is offered. */
	awaitingReadAfter: number | null;
}

export interface TemplatesState {
	base: TemplatesRead | null;
	/** Reads requested before this may predate a confirmed write and are ignored. */
	barrier: number;
	active: string | null;
	drafts: Readonly<Record<string, TemplateDraft>>;
	pending: TemplateOperation | null;
	/** A command whose outcome is unknown; writes wait for a readable read requested after `at`. */
	unknown: { operation: TemplateOperation; at: number; message: string } | null;
	/** A confirmed command no applied read has shown yet; writes wait for one requested after `after`. */
	observing: { operation: TemplateOperation; after: number } | null;
	/** Collections whose draft must be explicitly kept or discarded before saving. */
	conflicts: Readonly<Record<string, TemplateConflict>>;
	confirmingReset: TemplateResetReview | null;
	notice: TemplateNotice | null;
	/** The example each content type last showed. */
	examples: Readonly<Record<string, TemplateExampleTarget>>;
	/** The requested reference last applied; a view reports each new reference once. */
	appliedRef: string | null;
	/** An explicit reference that controls the example until the editor chooses another entry or type. */
	request: TemplateExampleRequest | null;
	/** Advances when the active type, its availability or its example changes. */
	generation: number;
	preview: TemplatePreviewState;
}

export const INITIAL_TEMPLATES_STATE: TemplatesState = Object.freeze({
	base: null,
	barrier: 0,
	active: null,
	drafts: Object.freeze({}),
	pending: null,
	unknown: null,
	observing: null,
	conflicts: Object.freeze({}),
	confirmingReset: null,
	notice: null,
	examples: Object.freeze({}),
	appliedRef: null,
	request: null,
	generation: 0,
	preview: Object.freeze({ pending: null, settled: null }),
});

export function templateValuesEqual(left: SeoAdminTemplateValues, right: SeoAdminTemplateValues): boolean {
	return TEMPLATE_FIELDS.every((field) => left[field] === right[field]);
}

function guardsEqual(left: SeoAdminTemplateInheritanceGuard, right: SeoAdminTemplateInheritanceGuard): boolean {
	return (
		TEMPLATE_FIELDS.every((field) => left.fields[field] === right.fields[field]) &&
		Object.hasOwn(left, "revisions") === Object.hasOwn(right, "revisions") &&
		left.revisions === right.revisions
	);
}

/** Everything a collection's decision depends on, as one read showed it. */
export function templateItemsEqual(left: SeoAdminTemplateItem, right: SeoAdminTemplateItem): boolean {
	return (
		left.collection === right.collection &&
		left.source === right.source &&
		templateValuesEqual(left.values, right.values) &&
		left.inherited.source === right.inherited.source &&
		templateValuesEqual(left.inherited.values, right.inherited.values) &&
		guardsEqual(left.inheritanceGuard, right.inheritanceGuard)
	);
}

export function templateItem(state: TemplatesState, collection: string | null): SeoAdminTemplateItem | null {
	if (!collection) return null;
	return state.base?.configuration.items.find((item) => item.collection === collection) ?? null;
}

export function templateDraftDirty(draft: TemplateDraft | undefined): boolean {
	return Boolean(draft && !templateValuesEqual(draft.values, draft.loaded.values));
}

/** The values shown in the form: the draft if one exists, else the newest read. */
export function templateFormValues(state: TemplatesState, collection: string): SeoAdminTemplateValues | null {
	return state.drafts[collection]?.values ?? templateItem(state, collection)?.values ?? null;
}

/** A read that can show the stored templates: a readable record and available content types. */
function observable(configuration: SeoAdminTemplateConfiguration | undefined): boolean {
	return Boolean(configuration && (configuration.state === "absent" || configuration.state === "saved") && configuration.discovery === "available");
}

/** Whether a new command may start; the reasons are shown by the view. */
export function templateWritesBlocked(state: TemplatesState): boolean {
	return state.pending !== null || state.unknown !== null || state.observing !== null || !observable(state.base?.configuration);
}

/** Whether the view should read again on its own: nothing it shows can settle what is waiting. */
export function templateReadNeeded(state: TemplatesState): boolean {
	return state.observing !== null || state.unknown !== null ||
		Object.values(state.conflicts).some((conflict) => conflict.awaitingReadAfter !== null);
}

/** The newest outcome a read must be requested after. */
export function templateWaitingSince(state: TemplatesState): number {
	return Math.max(
		state.observing?.after ?? 0,
		state.unknown?.at ?? 0,
		...Object.values(state.conflicts).map((conflict) => conflict.awaitingReadAfter ?? 0),
	);
}

/**
 * The outcome to request one fresh read for, or null. A running read may
 * have started before the outcome, so the request waits for it to finish;
 * an outcome already requested for is not requested again, so a failed
 * read leaves the Reload button instead of a retry loop.
 */
export function templateReadToRequest(state: TemplatesState, fetching: boolean, lastRequestedFor: number): number | null {
	if (!templateReadNeeded(state) || fetching) return null;
	const since = templateWaitingSince(state);
	return since > lastRequestedFor ? since : null;
}

export function canSaveTemplate(state: TemplatesState, collection: string): boolean {
	const draft = state.drafts[collection];
	return !templateWritesBlocked(state) && templateDraftDirty(draft) && !state.conflicts[collection];
}

/** Whether the conflict choices can bind to a read that shows the conflicting state. */
export function templateConflictResolvable(state: TemplatesState, collection: string): boolean {
	const conflict = state.conflicts[collection];
	return Boolean(conflict && conflict.awaitingReadAfter === null && state.pending === null && observable(state.base?.configuration));
}

export function canResetTemplate(state: TemplatesState, collection: string): boolean {
	const item = templateItem(state, collection);
	return !templateWritesBlocked(state) && item?.source === "override" && !templateDraftDirty(state.drafts[collection]) &&
		!state.conflicts[collection];
}

export function templatePreviewKey(request: TemplatePreviewRequest): string {
	return JSON.stringify([request.collection, request.entryId, request.locale, ...TEMPLATE_FIELDS.map((field) => request.values[field])]);
}

/**
 * The settled preview, only while it still describes the form, the chosen
 * example and the selection generation it was requested in. Returning to an
 * earlier example needs another Preview.
 */
export function currentTemplatePreview(state: TemplatesState, request: TemplatePreviewRequest | null):
	| { kind: "none" }
	| { kind: "pending" }
	| { kind: "stale" }
	| { kind: "settled"; outcome: TemplatePreviewOutcome } {
	if (!request) return { kind: "none" };
	const key = templatePreviewKey(request);
	const { pending, settled } = state.preview;
	if (pending?.key === key && pending.generation === state.generation) return { kind: "pending" };
	if (settled?.key === key && settled.generation === state.generation) return { kind: "settled", outcome: settled.outcome };
	return settled || pending ? { kind: "stale" } : { kind: "none" };
}

export type TemplatesEvent =
	| { type: "read"; read: TemplatesRead }
	| { type: "select"; collection: string }
	| { type: "edit"; collection: string; field: SeoAdminTemplateField; value: string }
	| { type: "discard"; collection: string }
	| { type: "keep-edits"; collection: string }
	| { type: "invalid"; collection: string; errors: SeoAdminTemplateErrors }
	| { type: "start"; operation: TemplateOperation }
	| { type: "result"; operationId: string; result: SeoAdminTemplatesSaveResult; at: number }
	| { type: "error"; operationId: string; failure: SchemaLibraryRequestFailure; message: string; at: number }
	| { type: "open-reset"; collection: string }
	| { type: "close-reset" }
	| { type: "dismiss-notice" }
	/** The editor chose this example; it ends any request for its type. */
	| { type: "select-example"; collection: string; example: TemplateExampleTarget | null }
	| { type: "request-example"; ref: string | null }
	/** The current request resolved to its own entry. */
	| { type: "resolve-example"; ref: string; example: TemplateExampleTarget }
	/** The first listed entry, only for a type with no request and no remembered example. */
	| { type: "auto-example"; collection: string; example: TemplateExampleTarget }
	| { type: "preview-start"; id: string; request: TemplatePreviewRequest }
	| { type: "preview-settle"; id: string; outcome: TemplatePreviewOutcome };

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
	if (!Object.hasOwn(record, key)) return record;
	const next = { ...record };
	delete next[key];
	return next;
}

/**
 * Applies a read unless a newer one, or a confirmed write it may predate,
 * was applied. A draft follows the read only when its collection looks
 * exactly as it did when editing started; otherwise real edits wait for the
 * editor's choice and a clean draft is replaced by the read.
 */
function applyRead(state: TemplatesState, read: TemplatesRead): TemplatesState {
	if (state.base && read.requestedAt < state.base.requestedAt) return state;
	if (read.requestedAt < state.barrier) return state;
	const configuration = read.configuration;
	const readable = observable(configuration);
	const drafts: Record<string, TemplateDraft> = { ...state.drafts };
	const conflicts: Record<string, TemplateConflict> = { ...state.conflicts };
	let observing = state.observing;
	let notice = state.notice;
	if (observing && readable && read.requestedAt > observing.after) {
		const operation = observing.operation;
		const item = configuration.items.find((candidate) => candidate.collection === operation.collection);
		const shown = item && (operation.kind === "save"
			? item.source === "override" && operation.values !== null && templateValuesEqual(item.values, operation.values)
			: item.source !== "override");
		if (shown) {
			delete drafts[operation.collection];
			delete conflicts[operation.collection];
		}
		if (notice?.collection === operation.collection) {
			notice = {
				collection: operation.collection,
				tone: shown ? "success" : "info",
				text: shown
					? operation.kind === "save" ? "Template saved and shown as stored." : "The inherited template is in effect."
					: "The change was stored, and the templates have changed again since. Review the values shown.",
			};
		}
		observing = null;
	}
	for (const [collection, draft] of Object.entries(drafts)) {
		const item = configuration.items.find((candidate) => candidate.collection === collection);
		if (item && templateItemsEqual(item, draft.loaded)) {
			drafts[collection] = { ...draft, loaded: item, loadedRevision: configuration.revision };
			continue;
		}
		if (!readable) continue;
		// A clean draft follows the newer read; only real edits wait for a choice.
		if (!templateDraftDirty(draft)) {
			delete drafts[collection];
			delete conflicts[collection];
			continue;
		}
		const existing = conflicts[collection];
		conflicts[collection] = {
			message: item
				? "The saved values for this content type changed after you started editing. Keep your edits to save them over the newer values, or use the saved values."
				: "This content type is not available as a template target now. Your edits are kept but cannot be saved.",
			// A read requested before the conflict was reported cannot show what caused it.
			awaitingReadAfter: existing?.awaitingReadAfter ?? null,
		};
	}
	if (readable) {
		for (const [collection, conflict] of Object.entries(conflicts)) {
			if (conflict.awaitingReadAfter !== null && read.requestedAt > conflict.awaitingReadAfter) {
				conflicts[collection] = { ...conflict, awaitingReadAfter: null };
			}
		}
	}
	// Only a readable read that lists the collection can show what the unknown command left.
	const unknown = state.unknown && readable && read.requestedAt > state.unknown.at &&
		configuration.items.some((item) => item.collection === state.unknown!.operation.collection)
		? null
		: state.unknown;
	// A type that stops being a target stays active and is shown as unavailable.
	const active = state.active ?? configuration.items[0]?.collection ?? null;
	return { ...state, base: read, drafts, conflicts, unknown, observing, notice, active };
}

function startDraft(state: TemplatesState, collection: string): TemplateDraft | null {
	const existing = state.drafts[collection];
	if (existing) return existing;
	const item = templateItem(state, collection);
	if (!item || !state.base) return null;
	return { values: { ...item.values }, loaded: item, loadedRevision: state.base.configuration.revision, errors: {} };
}

function settleOperation(state: TemplatesState, operation: TemplateOperation, result: SeoAdminTemplatesSaveResult, at: number): TemplatesState {
	let next: TemplatesState = { ...state, pending: null };
	const collection = operation.collection;
	// The answer's read ran after the command, but a read requested while the
	// command was in flight may already be applied and may predate it. Only a
	// readable answer that lists the collection can show the command's result.
	const answerIsNewest = !state.base || state.base.requestedAt <= operation.startedAt;
	const answerShows = (configuration: SeoAdminTemplateConfiguration | null): configuration is SeoAdminTemplateConfiguration =>
		Boolean(configuration && answerIsNewest && observable(configuration) &&
			configuration.items.some((item) => item.collection === collection));
	if (result.success) {
		const label = operation.kind === "save"
			? result.outcome === "saved" ? "Template saved." : "Nothing to save; these values are already in effect."
			: result.outcome === "saved" ? "This content type now uses its inherited template." : "This content type already uses its inherited template.";
		if (answerShows(result.templates)) {
			next = applyRead(next, { configuration: result.templates, requestedAt: operation.startedAt });
			return {
				...next,
				drafts: withoutKey(next.drafts, collection),
				conflicts: withoutKey(next.conflicts, collection),
				barrier: Math.max(next.barrier, at),
				notice: { collection, tone: result.outcome === "saved" ? "success" : "info", text: label },
			};
		}
		// The outcome is known but no applied read shows it yet: keep the draft and read again.
		return {
			...next,
			barrier: Math.max(next.barrier, at),
			observing: { operation, after: at },
			notice: { collection, tone: "info", text: `${label} Reading the templates again to show what is stored.` },
		};
	}
	if (result.error === "invalid_values") {
		const draft = next.drafts[collection];
		return {
			...next,
			drafts: draft ? { ...next.drafts, [collection]: { ...draft, errors: result.errors } } : next.drafts,
			notice: { collection, tone: "error", text: "Fix the highlighted fields. Nothing was saved." },
		};
	}
	if (result.error === "conflict") {
		const shown = answerShows(result.templates);
		if (shown) next = applyRead(next, { configuration: result.templates!, requestedAt: operation.startedAt });
		const conflict: TemplateConflict = { message: result.message, awaitingReadAfter: shown ? null : at };
		const conflicts = operation.kind === "save" || next.drafts[collection]
			? { ...next.conflicts, [collection]: conflict }
			: next.conflicts;
		return { ...next, conflicts, notice: { collection, tone: "error", text: result.message } };
	}
	if (result.error === "unconfirmed") {
		return { ...next, unknown: { operation, at, message: result.message }, notice: { collection, tone: "error", text: result.message } };
	}
	return { ...next, notice: { collection, tone: "error", text: result.message } };
}

function exampleRef(collection: string, example: TemplateExampleTarget | undefined): string | null {
	return example ? `${collection}:${example.entryId}` : null;
}

function reduceTemplates(state: TemplatesState, event: TemplatesEvent): TemplatesState {
	switch (event.type) {
		case "read":
			return applyRead(state, event.read);
		case "select":
			if (state.active === event.collection) return state;
			// Choosing a type ends any request; its remembered example becomes the applied reference.
			return { ...state, active: event.collection, request: null, appliedRef: exampleRef(event.collection, state.examples[event.collection]) };
		case "edit": {
			if (state.pending?.collection === event.collection) return state;
			const draft = startDraft(state, event.collection);
			if (!draft) return state;
			const errors = { ...draft.errors };
			delete errors[`${event.collection}.${event.field}`];
			delete errors._form;
			return {
				...state,
				drafts: { ...state.drafts, [event.collection]: { ...draft, values: { ...draft.values, [event.field]: event.value }, errors } },
				notice: state.notice?.collection === event.collection ? null : state.notice,
			};
		}
		case "discard":
		case "keep-edits": {
			if (state.pending?.collection === event.collection) return state;
			// A conflict choice binds only to a read that shows the conflicting state.
			if (state.conflicts[event.collection] && !templateConflictResolvable(state, event.collection)) return state;
			const conflicts = withoutKey(state.conflicts, event.collection);
			// The choice replaces any message about this collection's earlier command.
			const notice = state.notice?.collection === event.collection ? null : state.notice;
			if (event.type === "discard") return { ...state, drafts: withoutKey(state.drafts, event.collection), conflicts, notice };
			const draft = state.drafts[event.collection];
			const item = templateItem(state, event.collection);
			if (!draft || !item || !state.base) return { ...state, conflicts, notice };
			// The editor chose to save over the values the newest read shows.
			return {
				...state,
				conflicts,
				notice,
				drafts: { ...state.drafts, [event.collection]: { ...draft, loaded: item, loadedRevision: state.base.configuration.revision } },
			};
		}
		case "invalid": {
			const draft = state.drafts[event.collection];
			return draft ? { ...state, drafts: { ...state.drafts, [event.collection]: { ...draft, errors: event.errors } } } : state;
		}
		case "start":
			if (templateWritesBlocked(state)) return state;
			return { ...state, pending: event.operation, confirmingReset: null, notice: null };
		case "result":
			if (state.pending?.id !== event.operationId) return state;
			return settleOperation(state, state.pending, event.result, event.at);
		case "error": {
			const operation = state.pending;
			if (operation?.id !== event.operationId) return state;
			const next = { ...state, pending: null };
			if (event.failure === "unknown") {
				const message = operation.kind === "save" ? UNKNOWN_SAVE : UNKNOWN_RESET;
				return { ...next, unknown: { operation, at: event.at, message }, notice: { collection: operation.collection, tone: "error", text: message } };
			}
			const text = event.failure === "denied" ? TEMPLATE_DENIED_MESSAGE : `${event.message} Nothing was changed.`;
			return { ...next, notice: { collection: operation.collection, tone: "error", text } };
		}
		case "open-reset": {
			const item = templateItem(state, event.collection);
			if (!item || !state.base || !canResetTemplate(state, event.collection)) return state;
			return {
				...state,
				confirmingReset: {
					collection: event.collection,
					revision: state.base.configuration.revision,
					inheritanceGuard: item.inheritanceGuard,
					inherited: item.inherited,
					current: item.values,
				},
			};
		}
		case "close-reset":
			return state.confirmingReset ? { ...state, confirmingReset: null } : state;
		case "dismiss-notice":
			return state.notice ? { ...state, notice: null } : state;
		case "select-example": {
			const example = event.example ?? undefined;
			const ends = state.request !== null && (state.request.collection === event.collection || state.active === event.collection);
			return {
				...state,
				examples: example ? { ...state.examples, [event.collection]: example } : withoutKey(state.examples, event.collection),
				request: ends ? null : state.request,
				appliedRef: ends || state.active === event.collection ? exampleRef(event.collection, example) : state.appliedRef,
			};
		}
		case "request-example": {
			if (event.ref === state.appliedRef) return state;
			if (event.ref === null) return { ...state, appliedRef: null, request: null };
			const request = parseTemplateExampleRef(event.ref);
			return { ...state, appliedRef: event.ref, request, active: request.collection ?? state.active };
		}
		case "resolve-example": {
			const request = state.request;
			if (!request || request.ref !== event.ref || request.collection === null || request.entryId !== event.example.entryId) return state;
			if (!templateItem(state, request.collection)) return state;
			const current = state.examples[request.collection];
			if (current && sameTemplateExampleTarget(current, event.example)) return state;
			return { ...state, examples: { ...state.examples, [request.collection]: event.example } };
		}
		case "auto-example":
			if (state.request || state.examples[event.collection] || !templateItem(state, event.collection)) return state;
			return { ...state, examples: { ...state.examples, [event.collection]: event.example } };
		case "preview-start":
			return {
				...state,
				preview: { ...state.preview, pending: { id: event.id, key: templatePreviewKey(event.request), generation: state.generation, request: event.request } },
			};
		case "preview-settle": {
			const pending = state.preview.pending;
			// A late answer for a replaced request is dropped.
			if (pending?.id !== event.id) return state;
			return { ...state, preview: { pending: null, settled: { key: pending.key, generation: pending.generation, outcome: event.outcome } } };
		}
	}
}

/**
 * What a preview describes besides its values: the active type, whether it is
 * a target, and its example or request with the actual locale shown for it.
 */
function selectionIdentity(state: TemplatesState): string {
	const active = state.active;
	const available = Boolean(active && observable(state.base?.configuration) && templateItem(state, active));
	const request = state.request;
	const remembered = active ? state.examples[active] : undefined;
	const target = request
		? request.collection === null
			? ["invalid", request.ref]
			: ["entry", request.collection, request.entryId, remembered?.entryId === request.entryId ? remembered.locale : null]
		: remembered && active ? ["entry", active, remembered.entryId, remembered.locale] : ["none"];
	return JSON.stringify([active, available, target]);
}

export function templatesReducer(state: TemplatesState, event: TemplatesEvent): TemplatesState {
	const next = reduceTemplates(state, event);
	if (next === state || selectionIdentity(next) === selectionIdentity(state)) return next;
	return { ...next, generation: state.generation + 1 };
}

export interface TemplatesStore {
	get(): TemplatesState;
	dispatch(event: TemplatesEvent): void;
	subscribe(listener: () => void): () => void;
}

export function createTemplatesStore(initial: TemplatesState = INITIAL_TEMPLATES_STATE): TemplatesStore {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		dispatch(event) {
			const next = templatesReducer(state, event);
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

/** One store per admin session: the workspace view can unmount while a draft or command is open. */
export const templatesStore = createTemplatesStore();

export interface TemplatesPort {
	save(request: {
		collection: string;
		expectedRevision: string | null;
		inheritanceGuard: SeoAdminTemplateInheritanceGuard;
		values: SeoAdminTemplateValues;
	}, signal: AbortSignal): Promise<SeoAdminTemplatesSaveResult>;
	reset(request: {
		collection: string;
		expectedRevision: string | null;
		inheritanceGuard: SeoAdminTemplateInheritanceGuard;
	}, signal: AbortSignal): Promise<SeoAdminTemplatesSaveResult>;
	preview(request: TemplatePreviewRequest, signal: AbortSignal): Promise<SeoAdminTemplatePreviewResult>;
	/** The clock reads and commands are stamped with. */
	now(): number;
	newId(): string;
	/** Runs a request under one deadline and one abort signal. */
	withDeadline<T>(request: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T>;
}

/**
 * Claims the store for one command. Only the call that moves `pending` from
 * empty to this operation may send; a second call in the same tick finds it
 * taken.
 */
function acquire(store: TemplatesStore, operation: TemplateOperation): boolean {
	store.dispatch({ type: "start", operation });
	return store.get().pending?.id === operation.id;
}

export interface TemplateCommandRun {
	sent: boolean;
	/** True only when the server reported a stored change. */
	changed: boolean;
}

const NOT_SENT: TemplateCommandRun = Object.freeze({ sent: false, changed: false });

async function sendCommand(
	store: TemplatesStore,
	port: TemplatesPort,
	operation: TemplateOperation,
	request: (signal: AbortSignal) => Promise<SeoAdminTemplatesSaveResult>,
): Promise<TemplateCommandRun> {
	if (!acquire(store, operation)) return NOT_SENT;
	try {
		const result = await port.withDeadline(request, METADATA_TEMPLATE_DEADLINES.writeMs);
		store.dispatch({ type: "result", operationId: operation.id, result, at: port.now() });
		return { sent: true, changed: result.success && result.outcome === "saved" };
	} catch (error) {
		store.dispatch({
			type: "error",
			operationId: operation.id,
			failure: classifySchemaLibraryRequestError(error),
			message: error instanceof Error ? error.message : "The request was refused.",
			at: port.now(),
		});
		return { sent: true, changed: false };
	}
}

/** Sends the collection's draft once, against the revision it was edited from. */
export async function runTemplateSave(store: TemplatesStore, port: TemplatesPort, collection: string): Promise<TemplateCommandRun> {
	const state = store.get();
	const draft = state.drafts[collection];
	if (!draft || !canSaveTemplate(state, collection)) return NOT_SENT;
	const validation = validateSeoAdminTemplateValues(draft.values, collection);
	if (!validation.success) {
		store.dispatch({ type: "invalid", collection, errors: validation.errors });
		return NOT_SENT;
	}
	const operation: TemplateOperation = {
		id: port.newId(),
		kind: "save",
		collection,
		expectedRevision: draft.loadedRevision,
		inheritanceGuard: draft.loaded.inheritanceGuard,
		values: validation.values,
		startedAt: port.now(),
	};
	return sendCommand(store, port, operation, (signal) => port.save({
		collection,
		expectedRevision: operation.expectedRevision,
		inheritanceGuard: operation.inheritanceGuard,
		values: validation.values,
	}, signal));
}

/** Sends the reviewed reset once, with the revision and guard shown in the review. */
export async function runTemplateReset(store: TemplatesStore, port: TemplatesPort): Promise<TemplateCommandRun> {
	const review = store.get().confirmingReset;
	if (!review || templateWritesBlocked(store.get())) return NOT_SENT;
	const operation: TemplateOperation = {
		id: port.newId(),
		kind: "reset",
		collection: review.collection,
		expectedRevision: review.revision,
		inheritanceGuard: review.inheritanceGuard,
		values: null,
		startedAt: port.now(),
	};
	return sendCommand(store, port, operation, (signal) => port.reset({
		collection: review.collection,
		expectedRevision: review.revision,
		inheritanceGuard: review.inheritanceGuard,
	}, signal));
}

/** Previews the form for the chosen example; the same request while one is pending sends nothing. */
export async function runTemplatePreview(store: TemplatesStore, port: TemplatesPort, request: TemplatePreviewRequest): Promise<boolean> {
	const key = templatePreviewKey(request);
	const current = store.get();
	if (current.preview.pending?.key === key && current.preview.pending.generation === current.generation) return false;
	const id = port.newId();
	store.dispatch({ type: "preview-start", id, request });
	if (store.get().preview.pending?.id !== id) return false;
	try {
		const result = await port.withDeadline((signal) => port.preview(request, signal), METADATA_TEMPLATE_DEADLINES.previewMs);
		store.dispatch({ type: "preview-settle", id, outcome: { kind: "result", result } });
	} catch (error) {
		const timedOut = error instanceof DOMException && error.name === "TimeoutError";
		store.dispatch({
			type: "preview-settle",
			id,
			outcome: {
				kind: "failed",
				message: timedOut
					? "The preview did not finish in time. Nothing is shown; run it again."
					: error instanceof Error ? error.message : "The preview could not be resolved.",
			},
		});
	}
	return true;
}
