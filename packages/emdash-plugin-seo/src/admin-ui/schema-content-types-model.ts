// Editor state for the content type schema mapping. The draft keeps the
// revision it was loaded from until the user saves, discards or chooses a
// newer version, so a background refresh never replaces either. A request
// whose outcome is unknown locks writes until the stored record is checked.

import {
	SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS,
	type SeoAdminSchemaContentTypeConfiguration,
	type SeoAdminSchemaContentTypeValues,
	type SeoAdminSchemaContentTypesCheck,
	type SeoAdminSchemaContentTypesSaveResult,
	type SeoSchemaContentTypeRole,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

export type ContentTypesIntent =
	| { action: "save"; values: SeoAdminSchemaContentTypeValues; expectedRevision: string | null; replaceInvalid?: true }
	| { action: "reset"; expectedRevision: string };

/** A destructive write the user is confirming; fixed when the dialog opens. */
export type ContentTypesConfirmation =
	| { action: "reset"; expectedRevision: string }
	| { action: "replace"; values: SeoAdminSchemaContentTypeValues; expectedRevision: string | null };

export type ContentTypesNotice =
	| { kind: "conflict"; message: string }
	| { kind: "unconfirmed"; intent: ContentTypesIntent; message: string }
	| { kind: "invalid_stored"; message: string }
	| { kind: "denied" | "failed"; message: string }
	| { kind: "info"; message: string };

export interface ContentTypesPanelState {
	/** The newest configuration the server returned. */
	latest: SeoAdminSchemaContentTypeConfiguration | null;
	/** The configuration the draft was loaded from; its revision guards the next write. */
	base: SeoAdminSchemaContentTypeConfiguration | null;
	draft: SeoAdminSchemaContentTypeValues;
	pending: "save" | "reset" | "check" | null;
	notice: ContentTypesNotice | null;
	errors: Record<string, string>;
	/** Set while a confirmation is open; a refresh does not change what it will write. */
	confirming: ContentTypesConfirmation | null;
}

export const INITIAL_CONTENT_TYPES_PANEL: ContentTypesPanelState = Object.freeze({
	latest: null,
	base: null,
	draft: {},
	pending: null,
	notice: null,
	errors: {},
	confirming: null,
}) as ContentTypesPanelState;

export type ContentTypesPanelEvent =
	| { type: "receive"; configuration: SeoAdminSchemaContentTypeConfiguration }
	| { type: "edit"; collection: string; role: SeoSchemaContentTypeRole }
	| { type: "discard" }
	| { type: "confirm-open"; confirmation: ContentTypesConfirmation }
	| { type: "confirm-close" }
	| { type: "start"; pending: "save" | "reset" | "check" }
	| { type: "result"; intent: ContentTypesIntent; result: SeoAdminSchemaContentTypesSaveResult }
	| { type: "request-failed"; intent: ContentTypesIntent; failure: "denied" | "rejected" | "unknown"; message: string }
	| { type: "use-latest" }
	| { type: "keep-edits" }
	| { type: "check-result"; check: SeoAdminSchemaContentTypesCheck | undefined; configuration: SeoAdminSchemaContentTypeConfiguration }
	| { type: "check-failed"; message: string }
	| { type: "dismiss" };

export const CONTENT_TYPES_DENIED_MESSAGE =
	"Changing content type schema needs the plugin administrator permission (plugins:manage). Nothing was changed.";
const UNCONFIRMED_MESSAGE = "The change could not be confirmed. It may have been stored. Check the current state before trying again.";

function draftFrom(configuration: SeoAdminSchemaContentTypeConfiguration): SeoAdminSchemaContentTypeValues {
	return Object.fromEntries(configuration.items.map((item) => [item.collection, item.role]));
}

function adopt(
	state: ContentTypesPanelState,
	configuration: SeoAdminSchemaContentTypeConfiguration,
	notice: ContentTypesNotice | null,
): ContentTypesPanelState {
	return {
		...state,
		latest: configuration,
		base: configuration,
		draft: draftFrom(configuration),
		pending: null,
		notice,
		errors: {},
		confirming: null,
	};
}

/** The intended write for a confirmation, built from the draft and the revision it was loaded from. */
export function contentTypesConfirmation(
	state: ContentTypesPanelState,
	action: ContentTypesConfirmation["action"],
): ContentTypesConfirmation | null {
	const base = state.base;
	if (!base) return null;
	if (action === "reset") return base.revision ? { action, expectedRevision: base.revision } : null;
	return {
		action,
		values: Object.fromEntries(base.items.map((item) => [item.collection, state.draft[item.collection] ?? item.role])),
		expectedRevision: base.revision,
	};
}

/** Listed types whose newer saved role differs from the kept draft, for review before keeping edits. */
export function contentTypesConflictDifferences(
	state: ContentTypesPanelState,
): Array<{ collection: string; label: string; saved: SeoSchemaContentTypeRole; draft: SeoSchemaContentTypeRole }> {
	if (state.notice?.kind !== "conflict" || !state.latest || !state.base) return [];
	const saved = new Map(state.latest.items.map((item) => [item.collection, item.role]));
	return state.base.items.flatMap((item) => {
		const draft = state.draft[item.collection] ?? item.role;
		const latest = saved.get(item.collection);
		return latest !== undefined && latest !== draft ? [{ collection: item.collection, label: item.label, saved: latest, draft }] : [];
	});
}

/** Replaces only the mapping, so a late response keeps newer presets and custom schemas in the cache. */
export function patchSchemaContentTypes<T extends { schema: { contentTypes: SeoAdminSchemaContentTypeConfiguration } }>(
	current: T | undefined,
	contentTypes: SeoAdminSchemaContentTypeConfiguration,
): T | undefined {
	return current ? { ...current, schema: { ...current.schema, contentTypes } } : current;
}

export function contentTypesDirty(state: ContentTypesPanelState): boolean {
	return Boolean(state.base?.items.some((item) => (state.draft[item.collection] ?? item.role) !== item.role));
}

export function contentTypesPanelReducer(state: ContentTypesPanelState, event: ContentTypesPanelEvent): ContentTypesPanelState {
	switch (event.type) {
		case "receive": {
			if (!state.base) return adopt(state, event.configuration, null);
			// An open confirmation keeps the version it shows; the write then meets the newer one as a conflict.
			if (state.confirming) return { ...state, latest: event.configuration };
			// A clean editor follows the server; an edited or unsettled one keeps its base.
			if (!contentTypesDirty(state) && !state.pending && state.notice?.kind !== "unconfirmed" && state.notice?.kind !== "conflict") {
				return { ...adopt(state, event.configuration, state.notice), pending: null };
			}
			const changedElsewhere =
				!state.pending &&
				!state.notice &&
				event.configuration.revision !== state.base.revision;
			return {
				...state,
				latest: event.configuration,
				notice: changedElsewhere
					? { kind: "conflict", message: "The mapping was changed elsewhere while you were editing. Review it before saving." }
					: state.notice,
			};
		}
		case "edit":
			if (state.pending || state.notice?.kind === "unconfirmed") return state;
			return {
				...state,
				draft: { ...state.draft, [event.collection]: event.role },
				errors: Object.fromEntries(Object.entries(state.errors).filter(([key]) => key !== event.collection)),
			};
		case "discard":
			if (state.pending || state.notice?.kind === "unconfirmed" || !state.latest) return state;
			return adopt(state, state.latest, null);
		case "confirm-open":
			if (state.pending || state.notice?.kind === "unconfirmed" || state.notice?.kind === "conflict") return state;
			return { ...state, confirming: event.confirmation };
		case "confirm-close":
			return state.confirming ? { ...state, confirming: null } : state;
		case "start":
			return { ...state, pending: event.pending, errors: event.pending === "check" ? state.errors : {}, confirming: null };
		case "result": {
			const { result } = event;
			if (result.success) {
				return adopt(state, result.contentTypes, {
					kind: "info",
					message: event.intent.action === "save" ? "Content type schema saved." : "Default content type schema restored.",
				});
			}
			const latest = result.current ?? state.latest;
			const message = result.errors._form ?? "Nothing was saved.";
			if (result.error === "conflict") return { ...state, latest, pending: null, notice: { kind: "conflict", message } };
			if (result.error === "invalid_stored") return { ...state, latest, pending: null, notice: { kind: "invalid_stored", message } };
			if (result.error === "unconfirmed") {
				return { ...state, pending: null, notice: { kind: "unconfirmed", intent: event.intent, message: UNCONFIRMED_MESSAGE } };
			}
			if (result.error === "invalid") {
				const errors = Object.fromEntries(
					Object.entries(result.errors).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
				);
				return { ...state, pending: null, errors, notice: errors._form ? { kind: "failed", message: errors._form } : null };
			}
			return { ...state, latest, pending: null, notice: { kind: "failed", message } };
		}
		case "request-failed":
			if (event.failure === "unknown") {
				return { ...state, pending: null, notice: { kind: "unconfirmed", intent: event.intent, message: UNCONFIRMED_MESSAGE } };
			}
			return {
				...state,
				pending: null,
				notice: event.failure === "denied"
					? { kind: "denied", message: CONTENT_TYPES_DENIED_MESSAGE }
					: { kind: "failed", message: event.message },
			};
		case "use-latest":
			if (state.pending || !state.latest || state.notice?.kind === "unconfirmed") return state;
			return adopt(state, state.latest, null);
		case "keep-edits":
			// The user chose to apply their draft over the newer version they reviewed.
			if (state.pending || !state.latest || state.notice?.kind !== "conflict") return state;
			return { ...state, base: state.latest, notice: null };
		case "check-result": {
			if (state.notice?.kind !== "unconfirmed") return { ...state, pending: null, latest: event.configuration };
			if (event.check === "applied") {
				return adopt(state, event.configuration, {
					kind: "info",
					message: state.notice.intent.action === "save" ? "Content type schema saved." : "Default content type schema restored.",
				});
			}
			if (event.check === "not_applied") {
				return {
					...state,
					latest: event.configuration,
					pending: null,
					notice: { kind: "info", message: "Nothing was changed. Your edits are kept; you can try again." },
				};
			}
			return {
				...state,
				latest: event.configuration,
				pending: null,
				notice: { kind: "conflict", message: "The mapping was changed elsewhere. Review it before saving again." },
			};
		}
		case "check-failed":
			if (state.notice?.kind !== "unconfirmed") return { ...state, pending: null };
			return { ...state, pending: null, notice: { ...state.notice, message: `${UNCONFIRMED_MESSAGE} ${event.message}` } };
		case "dismiss":
			if (state.notice?.kind === "unconfirmed" || state.notice?.kind === "conflict") return state;
			return { ...state, notice: null };
	}
}

export interface ContentTypesPanelStore {
	get(): ContentTypesPanelState;
	dispatch(event: ContentTypesPanelEvent): void;
	subscribe(listener: () => void): () => void;
}

/** Outlives the view, so leaving the Schema page keeps a draft, a pending request and its recovery. */
export function createContentTypesPanelStore(initial: ContentTypesPanelState = INITIAL_CONTENT_TYPES_PANEL): ContentTypesPanelStore {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		dispatch(event) {
			const next = contentTypesPanelReducer(state, event);
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

/** Why a type's saved role adds nothing to its pages right now, or null when it does. */
export function contentTypeRoleInactiveReason(
	role: SeoSchemaContentTypeRole,
	context: { outputEnabled: boolean; recordInvalid: boolean; presetEnabled: (key: "blogPosting" | "service") => boolean },
): string | null {
	if (role === "none") return null;
	if (!context.outputEnabled) return "Not emitted: schema output is off in Feature controls.";
	if (context.recordInvalid) return "Not emitted: the saved mapping cannot be read.";
	if ((role === "blogPosting" || role === "service") && !context.presetEnabled(role)) {
		return `Not emitted: the ${SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS[role]} preset is off below.`;
	}
	return null;
}
