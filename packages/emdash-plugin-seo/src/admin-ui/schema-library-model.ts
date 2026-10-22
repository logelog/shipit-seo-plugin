// Editor state for the saved schema-template library. The routes own the
// stored record and its revision; this module decides what the view may show
// and send. The store lives outside the view, so leaving the workspace view
// keeps a draft, a pending request and an unconfirmed outcome. No React, DOM
// or host imports.
import type {
	SchemaLibraryFieldErrors,
	SchemaLibraryTemplate,
	SeoAdminSchemaLibrary,
	SeoAdminSchemaLibraryWriteResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A new template's identifier; the server creates it only while it is absent from the library. */
export function newSchemaLibraryTemplateId(random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(20))): string {
	return `tpl-${[...random().slice(0, 20)].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("")}`;
}

export interface SchemaLibraryDraft {
	name: string;
	json: string;
}

/**
 * `basisRevision` is the library revision this form may write against. A
 * read moves it forward only while the template being edited is unchanged
 * there.
 */
export type SchemaLibraryEditor =
	| { mode: "create"; id: string; draft: SchemaLibraryDraft; basisRevision: string | null }
	| { mode: "update"; id: string; draft: SchemaLibraryDraft; basisRevision: string; original: SchemaLibraryTemplate };

/**
 * A conflict names the read it was found in. `current` is that read's
 * version of the edited template, or null when the read does not hold it;
 * `revision` is null until a read after the refusal.
 */
export type SchemaLibraryNotice =
	| { kind: "conflict"; message: string; current: SchemaLibraryTemplate | null; revision: string | null }
	| { kind: "denied"; message: string }
	| { kind: "failed"; message: string }
	| { kind: "info"; message: string };

/**
 * A write whose outcome is unknown. Nothing else is sent until a read that
 * was requested after `since` answers it.
 */
export type SchemaLibraryUnconfirmed =
	| { action: "save"; since: number; message: string }
	| { action: "delete"; since: number; template: SchemaLibraryTemplate; message: string };

export interface SchemaLibraryState {
	editor: SchemaLibraryEditor | null;
	fieldErrors: SchemaLibraryFieldErrors;
	notice: SchemaLibraryNotice | null;
	unconfirmed: SchemaLibraryUnconfirmed | null;
	/** The exact template and library revision the owner is asked to delete. */
	confirmingDelete: { template: SchemaLibraryTemplate; revision: string } | null;
	pending: "save" | "delete" | null;
	search: string;
	/** When the newest applied read was requested; an older read arriving later is ignored. */
	readAt: number;
}

export const INITIAL_SCHEMA_LIBRARY_STATE: SchemaLibraryState = Object.freeze({
	editor: null,
	fieldErrors: {},
	notice: null,
	unconfirmed: null,
	confirmingDelete: null,
	pending: null,
	search: "",
	readAt: Number.NEGATIVE_INFINITY,
});

/** A complete library read and the time it was requested, on the clock the port provides. */
export interface SchemaLibraryRead {
	library: SeoAdminSchemaLibrary;
	requestedAt: number;
}

export type SchemaLibraryRequestFailure = "denied" | "rejected" | "unknown";

/**
 * 401 and 403 come from the dispatcher before the command runs; other 4xx
 * responses also mean nothing was written. Anything else, including a
 * timeout, may have followed a committed write.
 */
export function classifySchemaLibraryRequestError(error: unknown): SchemaLibraryRequestFailure {
	const status = typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number"
		? (error as { status: number }).status
		: null;
	if (status === 401 || status === 403) return "denied";
	if (status !== null && status >= 400 && status < 500 && status !== 408) return "rejected";
	return "unknown";
}

export const SCHEMA_LIBRARY_DENIED_MESSAGE =
	"Changing the schema library needs the plugin administrator permission (plugins:manage). Nothing was changed.";
const UNCONFIRMED_SAVE = "The save could not be confirmed. It may have been stored. Reload the library before changing it again.";
const UNCONFIRMED_DELETE = "The deletion could not be confirmed. Reload the library before changing it again.";

function sameContent(template: SchemaLibraryTemplate, draft: SchemaLibraryDraft): boolean {
	return template.name === draft.name.trim() && template.json === draft.json.trim();
}

function sameTemplate(left: SchemaLibraryTemplate, right: SchemaLibraryTemplate): boolean {
	return left.id === right.id && left.updatedAt === right.updatedAt && left.name === right.name && left.json === right.json;
}

/** Whether closing the form would lose input. */
export function schemaLibraryDraftDirty(editor: SchemaLibraryEditor | null): boolean {
	if (!editor) return false;
	return editor.mode === "create"
		? Boolean(editor.draft.name.trim() || editor.draft.json.trim())
		: !sameContent(editor.original, editor.draft);
}

/** A write needs a readable library, no request in flight, no unknown outcome and no open conflict. */
export function schemaLibraryWritable(state: SchemaLibraryState, library: SeoAdminSchemaLibrary | null): boolean {
	return Boolean(library && (library.state === "saved" || library.state === "absent") && library.conditionalStorage) &&
		state.pending === null && state.unconfirmed === null && state.notice?.kind !== "conflict";
}

/** Templates whose name or JSON contains every word of the search, in library order. */
export function filterSchemaLibraryTemplates(templates: readonly SchemaLibraryTemplate[], search: string): SchemaLibraryTemplate[] {
	const words = search.toLocaleLowerCase("en").split(/\s+/).filter(Boolean);
	if (!words.length) return [...templates];
	return templates.filter((template) => {
		const text = `${template.name}\n${template.json}`.toLocaleLowerCase("en");
		return words.every((word) => text.includes(word));
	});
}

export function schemaLibrarySaveRequest(editor: SchemaLibraryEditor) {
	return {
		mode: editor.mode,
		expectedRevision: editor.basisRevision,
		id: editor.id,
		name: editor.draft.name,
		json: editor.draft.json,
	};
}

export type SchemaLibraryEvent =
	| { type: "search"; value: string }
	| { type: "open-create"; id: string; library: SeoAdminSchemaLibrary }
	| { type: "open-edit"; template: SchemaLibraryTemplate; library: SeoAdminSchemaLibrary }
	| { type: "edit"; patch: Partial<SchemaLibraryDraft> }
	| { type: "close" }
	| { type: "start"; operation: "save" | "delete" }
	| { type: "save-result"; result: SeoAdminSchemaLibraryWriteResult; at: number }
	| { type: "save-error"; failure: SchemaLibraryRequestFailure; at: number }
	| { type: "confirm-delete"; template: SchemaLibraryTemplate; library: SeoAdminSchemaLibrary }
	| { type: "cancel-delete" }
	| { type: "delete-result"; result: SeoAdminSchemaLibraryWriteResult; at: number }
	| { type: "delete-error"; failure: SchemaLibraryRequestFailure; at: number }
	| { type: "loaded"; read: SchemaLibraryRead }
	/** Adopts the conflict's version of the template, from the read that showed it. */
	| { type: "use-saved" }
	/** Keeps the form over the conflict's version, which becomes the reviewed basis. */
	| { type: "keep-edits" }
	| { type: "save-as-new"; id: string };

function failed(state: SchemaLibraryState, failure: SchemaLibraryRequestFailure, unknown: SchemaLibraryUnconfirmed): SchemaLibraryState {
	if (failure === "denied") return { ...state, notice: { kind: "denied", message: SCHEMA_LIBRARY_DENIED_MESSAGE } };
	if (failure === "rejected") return { ...state, notice: { kind: "failed", message: "The request was refused. Nothing was changed." } };
	return { ...state, notice: null, unconfirmed: unknown };
}

function readable(library: SeoAdminSchemaLibrary): boolean {
	return library.state === "saved" || library.state === "absent";
}

/**
 * Describes what a read after an unknown outcome shows. It states what the
 * library holds now; whether the earlier request applied cannot be known,
 * since another change may have followed it.
 */
function settleUnconfirmed(state: SchemaLibraryState, read: SchemaLibraryRead): SchemaLibraryState {
	const pending = state.unconfirmed;
	const library = read.library;
	if (!pending || read.requestedAt <= pending.since || !readable(library)) return state;
	if (pending.action === "delete") {
		const current = library.templates.find((template) => template.id === pending.template.id);
		const message = !current
			? `"${pending.template.name}" is not in the library now.`
			: sameTemplate(current, pending.template)
				? `"${pending.template.name}" is in the library now, unchanged.`
				: `"${pending.template.name}" is in the library now with different content. Review it before deleting.`;
		return { ...state, unconfirmed: null, notice: { kind: "info", message } };
	}
	const editor = state.editor;
	if (!editor) return { ...state, unconfirmed: null };
	const current = library.templates.find((template) => template.id === editor.id);
	if (current && sameContent(current, editor.draft)) {
		return {
			...state,
			editor: null,
			unconfirmed: null,
			fieldErrors: {},
			notice: { kind: "info", message: `The library now holds "${current.name}" with the content of your form.` },
		};
	}
	if (!current) {
		if (editor.mode === "create") {
			return {
				...state,
				unconfirmed: null,
				editor: { ...editor, basisRevision: library.revision },
				notice: { kind: "info", message: "This template is not in the library now. Your form is kept; saving creates it while its identifier is absent." },
			};
		}
		return {
			...state,
			unconfirmed: null,
			notice: { kind: "conflict", message: "This template is not in the library now. Your form is kept.", current: null, revision: library.revision },
		};
	}
	if (editor.mode === "update" && sameTemplate(current, editor.original)) {
		return {
			...state,
			unconfirmed: null,
			editor: { ...editor, basisRevision: library.revision as string },
			notice: { kind: "info", message: "The library holds this template as you opened it. Your form is kept; save again to apply it." },
		};
	}
	return {
		...state,
		unconfirmed: null,
		notice: {
			kind: "conflict",
			message: editor.mode === "create"
				? "This identifier holds a different template now. Your form is kept; save it as a new template."
				: "The library holds a different version of this template now. Your form is kept.",
			current: editor.mode === "update" ? current : null,
			revision: library.revision,
		},
	};
}

/**
 * Applies a read to an open form. An unchanged template moves the basis
 * forward; a changed or missing one replaces any earlier conflict with this
 * read's version, so a choice is always made against the newest read.
 */
function reconcileEditor(state: SchemaLibraryState, library: SeoAdminSchemaLibrary): SchemaLibraryState {
	const editor = state.editor;
	if (!editor || state.unconfirmed || !readable(library)) return state;
	if (editor.mode === "create") {
		if (library.templates.some((template) => template.id === editor.id)) {
			return {
				...state,
				notice: { kind: "conflict", message: "This identifier holds another template now. Your form is kept; save it as a new template.", current: null, revision: library.revision },
			};
		}
		if (editor.basisRevision === library.revision && state.notice?.kind !== "conflict") return state;
		return {
			...state,
			editor: { ...editor, basisRevision: library.revision },
			notice: state.notice?.kind === "conflict" ? { kind: "info", message: "The library changed elsewhere and was reloaded. Your form is kept; review it and save again to create the template." } : state.notice,
		};
	}
	const current = library.templates.find((template) => template.id === editor.id);
	if (current && sameTemplate(current, editor.original)) {
		if (editor.basisRevision === library.revision && state.notice?.kind !== "conflict") return state;
		return {
			...state,
			editor: { ...editor, basisRevision: library.revision as string },
			notice: state.notice?.kind === "conflict" ? { kind: "info", message: "The library changed elsewhere and was reloaded. This template is unchanged there; your form is kept. Review it and save again." } : state.notice,
		};
	}
	return {
		...state,
		notice: current
			? { kind: "conflict", message: "The saved version of this template differs from the one you opened. Your form is kept.", current, revision: library.revision }
			: { kind: "conflict", message: "This template is not in the library now. Your form is kept.", current: null, revision: library.revision },
	};
}

export function schemaLibraryReducer(current: SchemaLibraryState, event: SchemaLibraryEvent): SchemaLibraryState {
	if (event.type === "search") return { ...current, search: event.value.slice(0, 200) };
	if (event.type === "start") {
		if (current.pending || current.unconfirmed) return current;
		if (event.operation === "save" && (!current.editor || current.notice?.kind === "conflict")) return current;
		if (event.operation === "delete" && !current.confirmingDelete) return current;
		return { ...current, pending: event.operation };
	}
	const settles = ["save-result", "save-error", "delete-result", "delete-error"].includes(event.type);
	if (current.pending && !settles && event.type !== "loaded") return current;
	const state = settles ? { ...current, pending: null } : current;
	switch (event.type) {
		case "open-create":
			if (state.editor || state.unconfirmed || state.confirmingDelete || !readable(event.library)) return state;
			return { ...state, editor: { mode: "create", id: event.id, draft: { name: "", json: "" }, basisRevision: event.library.revision }, fieldErrors: {}, notice: null };
		case "open-edit":
			if (state.editor || state.unconfirmed || state.confirmingDelete || event.library.state !== "saved") return state;
			if (!event.library.templates.some((template) => sameTemplate(template, event.template))) return state;
			return {
				...state,
				editor: { mode: "update", id: event.template.id, draft: { name: event.template.name, json: event.template.json }, basisRevision: event.library.revision as string, original: event.template },
				fieldErrors: {},
				notice: null,
			};
		case "edit": {
			if (!state.editor || state.unconfirmed) return state;
			const fieldErrors = { ...state.fieldErrors };
			for (const key of Object.keys(event.patch) as Array<keyof SchemaLibraryDraft>) delete fieldErrors[key];
			return { ...state, editor: { ...state.editor, draft: { ...state.editor.draft, ...event.patch } }, fieldErrors };
		}
		case "close":
			if (state.unconfirmed?.action === "save") return state;
			return { ...state, editor: null, fieldErrors: {}, notice: null };
		case "confirm-delete":
			if (state.editor || state.unconfirmed || event.library.state !== "saved") return state;
			if (!event.library.templates.some((template) => sameTemplate(template, event.template))) return state;
			return { ...state, confirmingDelete: { template: event.template, revision: event.library.revision as string }, notice: null };
		case "cancel-delete":
			return { ...state, confirmingDelete: null };
		case "save-result": {
			const result = event.result;
			if (result.success) {
				return {
					...state,
					editor: null,
					fieldErrors: {},
					notice: { kind: "info", message: result.changed ? `Saved "${result.template?.name ?? "template"}".` : "No changes to save." },
				};
			}
			if (result.error === "invalid_values") return { ...state, fieldErrors: result.errors, notice: null };
			if (result.error === "unconfirmed") return { ...state, notice: null, unconfirmed: { action: "save", since: event.at, message: result.message } };
			if (result.error === "conflict") return { ...state, notice: { kind: "conflict", message: result.message, current: null, revision: null } };
			return { ...state, notice: { kind: "failed", message: result.message } };
		}
		case "save-error":
			return failed(state, event.failure, { action: "save", since: event.at, message: UNCONFIRMED_SAVE });
		case "delete-result": {
			const target = state.confirmingDelete;
			const settled = { ...state, confirmingDelete: null };
			const result = event.result;
			if (result.success) {
				return { ...settled, notice: { kind: "info", message: `Deleted "${target?.template.name ?? "template"}". Entry schemas copied from it are unchanged.` } };
			}
			if (result.error === "unconfirmed" && target) {
				return { ...settled, notice: null, unconfirmed: { action: "delete", since: event.at, template: target.template, message: result.message } };
			}
			if (result.error === "invalid_values") return { ...settled, notice: { kind: "failed", message: "The template could not be deleted." } };
			return { ...settled, notice: { kind: "failed", message: result.message } };
		}
		case "delete-error": {
			const target = state.confirmingDelete;
			const settled = { ...state, confirmingDelete: null };
			if (!target) return settled;
			return failed(settled, event.failure, { action: "delete", since: event.at, template: target.template, message: UNCONFIRMED_DELETE });
		}
		case "loaded": {
			if (event.read.requestedAt <= state.readAt) return state;
			const settled = { ...settleUnconfirmed(state, event.read), readAt: event.read.requestedAt };
			const library = event.read.library;
			const confirming = settled.confirmingDelete && settled.confirmingDelete.revision !== library.revision ? null : settled.confirmingDelete;
			return reconcileEditor({ ...settled, confirmingDelete: confirming }, library);
		}
		case "use-saved": {
			const notice = state.notice;
			if (!state.editor || state.unconfirmed || notice?.kind !== "conflict" || !notice.current || !notice.revision) return state;
			return {
				...state,
				editor: { mode: "update", id: notice.current.id, draft: { name: notice.current.name, json: notice.current.json }, basisRevision: notice.revision, original: notice.current },
				fieldErrors: {},
				notice: null,
			};
		}
		case "keep-edits": {
			const notice = state.notice;
			if (!state.editor || state.unconfirmed || notice?.kind !== "conflict" || !notice.current || !notice.revision) return state;
			return {
				...state,
				editor: { mode: "update", id: notice.current.id, draft: state.editor.draft, basisRevision: notice.revision, original: notice.current },
				notice: { kind: "info", message: "Your edits are kept over the version shown. Review them, then save." },
			};
		}
		case "save-as-new": {
			const notice = state.notice;
			if (!state.editor || state.unconfirmed || notice?.kind !== "conflict" || notice.current || notice.revision === null) return state;
			return {
				...state,
				editor: { mode: "create", id: event.id, draft: state.editor.draft, basisRevision: notice.revision },
				fieldErrors: {},
				notice: { kind: "info", message: "Your form will be saved as a new template. Review it, then save." },
			};
		}
	}
}

export interface SchemaLibraryStore {
	get(): SchemaLibraryState;
	dispatch(event: SchemaLibraryEvent): void;
	subscribe(listener: () => void): () => void;
}

export function createSchemaLibraryStore(initial: SchemaLibraryState = INITIAL_SCHEMA_LIBRARY_STATE): SchemaLibraryStore {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		dispatch(event) {
			const next = schemaLibraryReducer(state, event);
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

/** One store per admin session: the workspace view can unmount while a draft or a write is open. */
export const schemaLibraryStore = createSchemaLibraryStore();

export interface SchemaLibraryPort {
	save(request: ReturnType<typeof schemaLibrarySaveRequest>): Promise<SeoAdminSchemaLibraryWriteResult>;
	remove(request: { expectedRevision: string; id: string }): Promise<SeoAdminSchemaLibraryWriteResult>;
	/** The clock read requests are stamped with. */
	now(): number;
}

/**
 * Claims the store for one write. Only the call that moves `pending` from
 * empty to this operation may send; a second call in the same tick finds it
 * taken.
 */
function acquire(store: SchemaLibraryStore, operation: "save" | "delete"): boolean {
	const before = store.get();
	if (before.pending !== null || before.unconfirmed !== null) return false;
	store.dispatch({ type: "start", operation });
	const after = store.get();
	return after !== before && after.pending === operation;
}

/** Sends the open form once. Returns whether a request was sent. */
export async function runSchemaLibrarySave(store: SchemaLibraryStore, port: SchemaLibraryPort, library: SeoAdminSchemaLibrary | null): Promise<boolean> {
	const editor = store.get().editor;
	if (!editor || !schemaLibraryWritable(store.get(), library) || !acquire(store, "save")) return false;
	try {
		const result = await port.save(schemaLibrarySaveRequest(editor));
		store.dispatch({ type: "save-result", result, at: port.now() });
	} catch (error) {
		store.dispatch({ type: "save-error", failure: classifySchemaLibraryRequestError(error), at: port.now() });
	}
	return true;
}

/** Sends the reviewed deletion once, with the revision shown in the review. Returns whether a request was sent. */
export async function runSchemaLibraryDelete(store: SchemaLibraryStore, port: SchemaLibraryPort): Promise<boolean> {
	const target = store.get().confirmingDelete;
	if (!target || !acquire(store, "delete")) return false;
	try {
		const result = await port.remove({ expectedRevision: target.revision, id: target.template.id });
		store.dispatch({ type: "delete-result", result, at: port.now() });
	} catch (error) {
		store.dispatch({ type: "delete-error", failure: classifySchemaLibraryRequestError(error), at: port.now() });
	}
	return true;
}
