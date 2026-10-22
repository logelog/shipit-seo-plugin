import type { ApiResponseError, UpdateContentInput } from "@emdash-cms/admin";

import {
	createNativeSeoEditorState,
	nativeSeoWriteInput,
	validateNativeSeoDraft,
	type NativeSeoSaveAttempt,
	type NativeSeoSnapshot,
	type NativeSeoTarget,
	type NativeSeoValues,
	type NativeSeoWriteResult,
} from "./native-seo-editor-state.ts";

/** The caller supplies only the published native admin functions and error class. */
export interface NativeSeoApiDependencies {
	fetchContent(collection: string, id: string, options?: { locale?: string }): Promise<unknown>;
	updateContent(collection: string, id: string, input: UpdateContentInput, options?: { locale?: string }): Promise<unknown>;
	ApiResponseError: typeof ApiResponseError;
}

export type NativeSeoReadOutcome =
	| { outcome: "read"; snapshot: NativeSeoSnapshot }
	| { outcome: "unavailable" };
export type NativeSeoWriteOutcome = NativeSeoWriteResult | { outcome: "unknown" };
const FIELDS = ["title", "description", "image"] as const;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: object, keys: readonly string[]): boolean {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function qualifiedTarget(target: NativeSeoTarget): boolean {
	try {
		createNativeSeoEditorState(target, null);
		// Native 1.3 returns an actual stored locale; absence does not establish scope.
		return typeof target.locale === "string";
	} catch { return false; }
}

/** Validate the returned entity before attaching the caller's principal ownership. */
export function parseNativeSeoItem(item: unknown, target: NativeSeoTarget): NativeSeoSnapshot | null {
	if (!qualifiedTarget(target) || !record(item) || item.id !== target.entryId || item.type !== target.collection ||
		typeof item.locale !== "string" || item.locale !== target.locale || typeof item._rev !== "string" || !record(item.seo) ||
		!["id", "type", "locale", "_rev", "seo"].every((field) => Object.prototype.hasOwnProperty.call(item, field))) return null;
	const seo = item.seo;
	if (!FIELDS.every((field) => Object.prototype.hasOwnProperty.call(seo, field) &&
		(seo[field] === null || typeof seo[field] === "string"))) return null;
	const values: NativeSeoValues = {
		title: seo.title as string | null,
		description: seo.description as string | null,
		image: seo.image as string | null,
	};
	return createNativeSeoEditorState(target, { target, revision: item._rev, values }).baseline;
}

export function classifyNativeSeoWriteError(
	error: unknown,
	ErrorClass: NativeSeoApiDependencies["ApiResponseError"],
): "conflict" | "locked" | "rejected" | "unknown" {
	if (!(error instanceof ErrorClass)) return "unknown";
	// The host answers another editor's entry lock with 409 too, but refuses it before writing; it is no value conflict.
	if (error.status === 409) return error.code === "ENTRY_LOCKED" ? "locked" : "conflict";
	return [400, 401, 403, 404].includes(error.status) ? "rejected" : "unknown";
}

function qualifiedAttempt(attempt: NativeSeoSaveAttempt): boolean {
	if (!record(attempt) || !exactKeys(attempt, ["id", "target", "expectedRevision", "patch", "expectedValues"]) ||
		!Object.isFrozen(attempt) || !Number.isSafeInteger(attempt.id) || attempt.id < 1 || !qualifiedTarget(attempt.target) ||
		!Object.isFrozen(attempt.target) || !Object.isFrozen(attempt.target.principal) || !record(attempt.patch) ||
		!Object.isFrozen(attempt.patch) || !record(attempt.expectedValues) || !Object.isFrozen(attempt.expectedValues) ||
		!exactKeys(attempt.expectedValues, FIELDS)) return false;
	const fields = Object.keys(attempt.patch);
	if (!fields.length || fields.some((field) => !(FIELDS as readonly string[]).includes(field)) ||
		Object.keys(validateNativeSeoDraft(attempt.patch)).length) return false;
	if (!fields.every((field) => {
		const value = attempt.patch[field as typeof FIELDS[number]];
		return (value === null || (typeof value === "string" && Boolean(value.trim()))) &&
			attempt.expectedValues[field as typeof FIELDS[number]] === value;
	})) return false;
	return createNativeSeoEditorState(attempt.target, {
		target: attempt.target, revision: attempt.expectedRevision, values: attempt.expectedValues,
	}).baseline !== null;
}

/** One fresh native read. Failures never establish empty fields or trigger a write. */
export async function fetchNativeSeoSnapshot(target: NativeSeoTarget, dependencies: NativeSeoApiDependencies): Promise<NativeSeoReadOutcome> {
	if (!qualifiedTarget(target)) return { outcome: "unavailable" };
	// Copy the request identity before awaiting an injected/native function.
	const owner = createNativeSeoEditorState(target, null).target;
	try {
		const item = await dependencies.fetchContent(owner.collection, owner.entryId, { locale: owner.locale! });
		const snapshot = parseNativeSeoItem(item, owner);
		return snapshot ? { outcome: "read", snapshot } : { outcome: "unavailable" };
	} catch { return { outcome: "unavailable" }; }
}

/** One guarded native write. Its acknowledgement still requires a separate readback. */
export async function saveNativeSeoAttempt(attempt: NativeSeoSaveAttempt, dependencies: NativeSeoApiDependencies): Promise<NativeSeoWriteOutcome> {
	if (!qualifiedAttempt(attempt)) return { outcome: "rejected" };
	const input = nativeSeoWriteInput(attempt);
	try {
		const item: unknown = await dependencies.updateContent(attempt.target.collection, attempt.target.entryId,
			input as UpdateContentInput, { locale: attempt.target.locale! });
		const snapshot = parseNativeSeoItem(item, attempt.target);
		if (!snapshot || snapshot.revision === attempt.expectedRevision ||
			!FIELDS.every((field) => snapshot.values[field] === attempt.expectedValues[field])) return { outcome: "unknown" };
		return { outcome: "acknowledged", snapshot };
	} catch (error: unknown) {
		return { outcome: classifyNativeSeoWriteError(error, dependencies.ApiResponseError) };
	}
}
