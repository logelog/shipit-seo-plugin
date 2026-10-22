import type {
	SeoAdminCustomSchema,
	SeoAdminCustomSchemaReadResult,
	SeoAdminSchemaConfiguration,
	SeoAdminSchemaContentTypeConfiguration,
	SeoAdminSchemaPresetConfiguration,
	SeoAdminSchemaPresetValues,
	SeoAdminCustomSchemaWriteInput,
	SeoAdminSchemaComposerWriteInput,
	SeoAdminCustomSchemaDeleteInput,
	SeoAdminSchemaPresetsWriteInput,
	SchemaLibraryTemplate,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	parseSeoSchemaScope,
	upsertSeoAdminCustomSchema,
	type SeoSchemaComposerDraft,
} from "./schema-composer-view-model.ts";

/** A result owns its presets only; later content mappings and custom records stay current. */
export function patchSchemaWorkspacePresets(
	current: SeoAdminSchemaConfiguration,
	presets: SeoAdminSchemaPresetConfiguration,
): SeoAdminSchemaConfiguration {
	return { ...current, presets };
}

export function upsertSchemaWorkspaceCustom(
	current: SeoAdminSchemaConfiguration,
	schema: SeoAdminCustomSchema,
): SeoAdminSchemaConfiguration {
	return { ...current, customSchemas: upsertSeoAdminCustomSchema(current.customSchemas, schema) };
}

export function removeSchemaWorkspaceCustom(
	current: SeoAdminSchemaConfiguration,
	id: string,
): SeoAdminSchemaConfiguration {
	if (!current.customSchemas.some((schema) => schema.id === id)) return current;
	return { ...current, customSchemas: current.customSchemas.filter((schema) => schema.id !== id) };
}

/** Unknown collections keep their exact saved scope, without inventing a label or entry title. */
export function schemaWorkspaceScopeLabel(
	scope: string,
	contentTypes: SeoAdminSchemaContentTypeConfiguration,
): string {
	if (scope === "global") return "All pages";
	if (!contentTypes.discoveryAvailable) return scope;
	const parsed = parseSeoSchemaScope(scope);
	const label = contentTypes.items.find((item) => item.collection === parsed.collection)?.label.trim();
	if (!label || (parsed.mode === "entry" && !parsed.entry)) return scope;
	return parsed.mode === "entry" ? `${label}: ${parsed.entry}` : label;
}

/** Compare form input exactly, including unfinished scope fields and whitespace. */
export function schemaComposerDraftDirty(
	draft: SeoSchemaComposerDraft,
	baseline: SeoSchemaComposerDraft,
): boolean {
	if (
		draft.input.id !== baseline.input.id ||
		draft.input.recipe !== baseline.input.recipe ||
		draft.input.schemaName !== baseline.input.schemaName ||
		draft.input.scope !== baseline.input.scope ||
		draft.input.enabled !== baseline.input.enabled ||
		draft.scope.mode !== baseline.scope.mode ||
		draft.scope.collection !== baseline.scope.collection ||
		draft.scope.entry !== baseline.scope.entry
	) return true;
	const keys = new Set([...Object.keys(draft.input.values), ...Object.keys(baseline.input.values)]);
	return [...keys].some((key) => !Object.is(
		draft.input.values[key as keyof typeof draft.input.values],
		baseline.input.values[key as keyof typeof baseline.input.values],
	));
}

export interface SchemaWorkspacePresetDraftState {
	baseline: SeoAdminSchemaPresetValues;
	draft: SeoAdminSchemaPresetValues;
	revision: string | null;
	record: SeoAdminSchemaPresetConfiguration["record"];
	writable: boolean;
}

export function schemaWorkspacePresetValues(saved: SeoAdminSchemaPresetConfiguration): SeoAdminSchemaPresetValues {
	return Object.fromEntries(saved.items.map((item) => [item.key, item.enabled])) as SeoAdminSchemaPresetValues;
}

export function createSchemaWorkspacePresetDraft(
	saved: SeoAdminSchemaPresetConfiguration,
	draft = schemaWorkspacePresetValues(saved),
): SchemaWorkspacePresetDraftState {
	return { baseline: schemaWorkspacePresetValues(saved), draft, revision: saved.revision, record: saved.record, writable: saved.writable };
}

export function schemaWorkspacePresetDraftDirty(state: SchemaWorkspacePresetDraftState): boolean {
	const keys = new Set([...Object.keys(state.baseline), ...Object.keys(state.draft)]);
	return [...keys].some((key) =>
		state.baseline[key as keyof SeoAdminSchemaPresetValues] !== state.draft[key as keyof SeoAdminSchemaPresetValues]);
}

export function schemaWorkspacePresetReviewRequired(
	state: SchemaWorkspacePresetDraftState,
	saved: SeoAdminSchemaPresetConfiguration,
): boolean {
	return state.revision !== saved.revision || state.record !== saved.record ||
		schemaWorkspacePresetDraftDirty({ ...state, draft: schemaWorkspacePresetValues(saved) });
}

/** A refresh cannot adopt another writer's revision, even when its values are equal. */
export function reconcileSchemaWorkspacePresetDraft(
	state: SchemaWorkspacePresetDraftState,
	saved: SeoAdminSchemaPresetConfiguration,
): SchemaWorkspacePresetDraftState {
	if (schemaWorkspacePresetReviewRequired(state, saved) || schemaWorkspacePresetDraftDirty(state)) return state;
	if (state.writable === saved.writable) return state;
	return { ...state, writable: saved.writable };
}

export type SchemaWorkspaceAttempt =
	| { kind: "custom"; source: "raw"; command: SeoAdminCustomSchemaWriteInput }
	| { kind: "custom"; source: "guided"; command: SeoAdminSchemaComposerWriteInput }
	| { kind: "custom"; source: "delete"; command: SeoAdminCustomSchemaDeleteInput }
	| { kind: "presets"; source: "save"; command: SeoAdminSchemaPresetsWriteInput }
	| { kind: "presets"; source: "reset"; command: { expectedRevision: string } }
	| { kind: "presets"; source: "review"; command: null };

export function captureSchemaWorkspaceAttempt<T extends SchemaWorkspaceAttempt>(attempt: T): T {
	const copy = JSON.parse(JSON.stringify(attempt)) as T;
	const freeze = (value: unknown): void => {
		if (value && typeof value === "object") {
			Object.values(value).forEach(freeze);
			Object.freeze(value);
		}
	};
	freeze(copy);
	return copy;
}

export function schemaWorkspaceReviewedIdentity(
	id: string,
	read: SeoAdminCustomSchemaReadResult,
): { id: string; expectedRevision: string | null } | null {
	if (!read.success || read.id !== id || read.state === "invalid") return null;
	return { id, expectedRevision: read.state === "saved" ? read.schema.revision : null };
}

export function newSchemaWorkspaceId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return "schema-" + Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export interface SchemaWorkspaceMutationGate {
	claim(): boolean;
	release(): void;
	beginTransport(): void;
	settleTransport(): void;
	markUnconfirmed(): void;
	beginReview(): boolean;
	completeReview(success: boolean): void;
	allowAfterReview(): boolean;
	isUnconfirmed(): boolean;
}

/** A view keeps this gate while hidden; state updates alone cannot claim a request synchronously. */
export function createSchemaWorkspaceMutationGate(): SchemaWorkspaceMutationGate {
	let pending = false;
	let transportPending = false;
	let unconfirmed = false;
	let reviewPending = false;
	let reviewed = false;
	return {
		claim() {
			if (pending || transportPending || unconfirmed || reviewPending) return false;
			pending = true;
			reviewed = false;
			return true;
		},
		release() {
			pending = false;
		},
		beginTransport() {
			transportPending = true;
			reviewPending = false;
			reviewed = false;
		},
		settleTransport() {
			transportPending = false;
			reviewPending = false;
			reviewed = false;
		},
		markUnconfirmed() {
			unconfirmed = true;
			reviewPending = false;
			reviewed = false;
		},
		beginReview() {
			if (!unconfirmed || pending || transportPending || reviewPending) return false;
			reviewPending = true;
			reviewed = false;
			return true;
		},
		completeReview(success) {
			if (!reviewPending) return;
			reviewPending = false;
			reviewed = success && unconfirmed && !pending && !transportPending;
		},
		allowAfterReview() {
			if (!unconfirmed || !reviewed || pending || transportPending || reviewPending) return false;
			unconfirmed = false;
			reviewed = false;
			return true;
		},
		isUnconfirmed() {
			return unconfirmed;
		},
	};
}

/** An independent, disabled copy with no chosen publication scope or saved revision. */
export function schemaWorkspaceTemplateCopy(template: Pick<SchemaLibraryTemplate, "name" | "json">) {
	return { name: template.name, json: template.json, scope: "", enabled: false };
}

export type SchemaWorkspaceSection = "overview" | "custom" | "library" | "defaults";
export type SchemaWorkspaceRoute = "schema" | "library";

/** Library is the only Schema tab with its own route, so `?view=library` opens it directly. */
export function schemaWorkspaceRoute(section: SchemaWorkspaceSection): SchemaWorkspaceRoute {
	return section === "library" ? "library" : "schema";
}

/** Back and Forward move the tab with the route; leaving Library restores the last other tab. */
export function schemaWorkspaceSectionForRoute(
	route: SchemaWorkspaceRoute,
	current: SchemaWorkspaceSection,
	previous: Exclude<SchemaWorkspaceSection, "library">,
): SchemaWorkspaceSection {
	if (route === "library") return "library";
	return current === "library" ? previous : current;
}
