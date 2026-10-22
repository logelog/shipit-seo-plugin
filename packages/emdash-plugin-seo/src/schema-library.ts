// Saved JSON-LD templates: one versioned plugin KV record holding named,
// unresolved entry schema JSON. Templates are inert. No page reads them, and
// copying one into an entry editor makes an independent draft that the entry
// save command stores as that entry's own record. Every write replaces the
// whole record under the revision the editor loaded, so a create, edit or
// delete never lands on a library it did not see. No React, DOM, Node or
// storage import.

import {
	ENTRY_SCHEMA_NAME_MAX_LENGTH,
	validateEntrySchemaJson,
} from "./entry-schemas.ts";
import { jsonUtf8LengthWithin } from "./lib.ts";

export const SCHEMA_LIBRARY_STORAGE_VERSION = 1 as const;
export const SCHEMA_LIBRARY_KEY = `schema-library:v${SCHEMA_LIBRARY_STORAGE_VERSION}`;
export const SCHEMA_LIBRARY_MAX_TEMPLATES = 20;
/** UTF-8 bytes of the whole stored record as serialized JSON. */
export const SCHEMA_LIBRARY_MAX_RECORD_BYTES = 131_072;
/** Identifiers proposed by the editor, so an unconfirmed create can be found again. */
export const SCHEMA_LIBRARY_ID_PATTERN = /^tpl-[a-z0-9]{20}$/;

const TIMESTAMP_MAX_LENGTH = 40;
const REVISION_MAX_LENGTH = 256;

export interface SchemaLibraryTemplate {
	id: string;
	name: string;
	/** Unresolved JSON-LD; variables are expanded only for an entry. */
	json: string;
	createdAt: string;
	updatedAt: string;
}

export interface SchemaLibraryRecord {
	version: typeof SCHEMA_LIBRARY_STORAGE_VERSION;
	templates: SchemaLibraryTemplate[];
}

export type SchemaLibraryCorruptReason =
	| "not-object"
	| "unsupported-version"
	| "unexpected-fields"
	| "invalid-templates"
	| "too-large";

export type SchemaLibrarySnapshot =
	| { state: "absent"; revision: null; templates: SchemaLibraryTemplate[]; bytes: 0 }
	| { state: "saved"; revision: string; templates: SchemaLibraryTemplate[]; bytes: number }
	| { state: "corrupt"; revision: string; reason: SchemaLibraryCorruptReason; detail: string }
	| { state: "unavailable"; revision: null };

export interface SchemaLibraryFieldErrors {
	name?: string;
	json?: string;
}

export type SchemaLibraryWriteFailure =
	| "invalid_input"
	| "conflict"
	| "id_in_use"
	| "limit_reached"
	| "corrupt"
	| "unavailable"
	| "unconfirmed";

export type SchemaLibraryWriteResult =
	| {
		success: true;
		/** False when the request matched the stored template and nothing was written. */
		changed: boolean;
		library: Extract<SchemaLibrarySnapshot, { state: "saved" }>;
		/** The written template; null after a deletion. */
		template: SchemaLibraryTemplate | null;
	}
	| { success: false; error: "invalid_values"; errors: SchemaLibraryFieldErrors }
	| { success: false; error: SchemaLibraryWriteFailure; message: string };

/** The plugin KV methods these commands use; absent methods make the library unavailable. */
export interface SchemaLibraryStorage {
	getVersioned?: (key: string) => Promise<unknown>;
	compareAndSet?: (key: string, expectedRevision: string | null, value: unknown) => Promise<unknown>;
}

export interface SchemaLibraryHost {
	kv: SchemaLibraryStorage | null | undefined;
	now(): string;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= REVISION_MAX_LENGTH;
}

function validTimestamp(value: unknown): value is string {
	return typeof value === "string" && value.length <= TIMESTAMP_MAX_LENGTH && Number.isFinite(Date.parse(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const present = Object.keys(value);
	return present.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function failure<E extends SchemaLibraryWriteFailure>(error: E, message: string) {
	return { success: false as const, error, message };
}

/** Name rules for stored and submitted templates: trimmed, non-empty, at most 120 characters. */
export function schemaLibraryNameProblem(name: unknown): string | null {
	if (typeof name !== "string" || !name.trim()) return "Enter a name.";
	if (name.trim().length > ENTRY_SCHEMA_NAME_MAX_LENGTH) return `Use at most ${ENTRY_SCHEMA_NAME_MAX_LENGTH} characters.`;
	return null;
}

function nameKey(name: string): string {
	return name.trim().toLocaleLowerCase("en");
}

/** UTF-8 bytes of the record as the KV adapter stores it, or null above the cap. */
export function schemaLibraryRecordBytes(value: SchemaLibraryRecord): number | null {
	return jsonUtf8LengthWithin(value, SCHEMA_LIBRARY_MAX_RECORD_BYTES);
}

/**
 * Strict parse of a stored record. Every template must pass the entry JSON
 * rules it was saved under, so a template can always be copied into an
 * entry editor as it is.
 */
export function parseSchemaLibraryRecord(
	value: unknown,
): { ok: true; record: SchemaLibraryRecord; bytes: number } | { ok: false; reason: SchemaLibraryCorruptReason; detail: string } {
	const source = record(value);
	if (!source) return { ok: false, reason: "not-object", detail: "The stored library is not an object." };
	if (source.version !== SCHEMA_LIBRARY_STORAGE_VERSION) {
		return { ok: false, reason: "unsupported-version", detail: "The stored library has an unsupported version." };
	}
	if (!exactKeys(source, ["version", "templates"])) {
		return { ok: false, reason: "unexpected-fields", detail: "The stored library has unexpected fields." };
	}
	const templates = source.templates;
	if (!Array.isArray(templates) || templates.length > SCHEMA_LIBRARY_MAX_TEMPLATES) {
		return { ok: false, reason: "invalid-templates", detail: `The stored library must list at most ${SCHEMA_LIBRARY_MAX_TEMPLATES} templates.` };
	}
	const ids = new Set<string>();
	const names = new Set<string>();
	const parsed: SchemaLibraryTemplate[] = [];
	for (const [index, item] of templates.entries()) {
		const template = record(item);
		const position = `Template ${index + 1}`;
		if (!template || !exactKeys(template, ["id", "name", "json", "createdAt", "updatedAt"])) {
			return { ok: false, reason: "invalid-templates", detail: `${position} has unexpected fields.` };
		}
		const { id, name, json, createdAt, updatedAt } = template;
		if (typeof id !== "string" || !SCHEMA_LIBRARY_ID_PATTERN.test(id) || ids.has(id)) {
			return { ok: false, reason: "invalid-templates", detail: `${position} has a missing or repeated identifier.` };
		}
		if (schemaLibraryNameProblem(name) || (name as string) !== (name as string).trim() || names.has(nameKey(name as string))) {
			return { ok: false, reason: "invalid-templates", detail: `${position} has an invalid or repeated name.` };
		}
		if (typeof json !== "string" || json !== json.trim() || !validateEntrySchemaJson(json).ok) {
			return { ok: false, reason: "invalid-templates", detail: `${position} has JSON-LD that no longer passes the entry schema rules.` };
		}
		if (!validTimestamp(createdAt) || !validTimestamp(updatedAt)) {
			return { ok: false, reason: "invalid-templates", detail: `${position} has an invalid timestamp.` };
		}
		ids.add(id);
		names.add(nameKey(name as string));
		parsed.push({ id, name: name as string, json, createdAt, updatedAt });
	}
	const next: SchemaLibraryRecord = { version: SCHEMA_LIBRARY_STORAGE_VERSION, templates: parsed };
	const bytes = schemaLibraryRecordBytes(next);
	if (bytes === null) {
		return { ok: false, reason: "too-large", detail: `The stored library exceeds ${SCHEMA_LIBRARY_MAX_RECORD_BYTES.toLocaleString("en-US")} bytes.` };
	}
	return { ok: true, record: next, bytes };
}

/**
 * Reads the record without creating one. A present value that is not a valid
 * record is corrupt with its revision. A missing versioned API, a thrown read
 * or a malformed revision envelope is unavailable.
 */
export async function readSchemaLibrary(host: SchemaLibraryHost): Promise<SchemaLibrarySnapshot> {
	const kv = host.kv;
	if (typeof kv?.getVersioned !== "function") return { state: "unavailable", revision: null };
	let stored: unknown;
	try {
		stored = await kv.getVersioned(SCHEMA_LIBRARY_KEY);
	} catch {
		return { state: "unavailable", revision: null };
	}
	if (stored === null) return { state: "absent", revision: null, templates: [], bytes: 0 };
	const envelope = record(stored);
	if (!envelope || !Object.hasOwn(envelope, "value") || !validRevision(envelope.revision)) {
		return { state: "unavailable", revision: null };
	}
	const parsed = parseSchemaLibraryRecord(envelope.value);
	return parsed.ok
		? { state: "saved", revision: envelope.revision, templates: parsed.record.templates, bytes: parsed.bytes }
		: { state: "corrupt", revision: envelope.revision, reason: parsed.reason, detail: parsed.detail };
}

function expectedRevisionInput(value: unknown, allowNull: boolean): string | null | undefined {
	if (value === null && allowNull) return null;
	return validRevision(value) ? value : undefined;
}

const CONFLICT = "The library changed after you loaded it. Nothing was saved. Reload it; your form is kept.";
const DELETE_CONFLICT = "The library changed after you loaded it. Nothing was deleted. Review the list as it is now before deleting.";
const UNCONFIRMED = "The library change could not be confirmed. It may have been saved. Reload the library before changing it again.";

async function guardedSnapshot(
	host: SchemaLibraryHost,
	expectedRevision: string | null,
	conflict = CONFLICT,
): Promise<{ ok: true; templates: SchemaLibraryTemplate[] } | { ok: false; result: SchemaLibraryWriteResult }> {
	if (typeof host.kv?.compareAndSet !== "function") {
		return { ok: false, result: failure("unavailable", "This EmDash version does not provide revision-checked plugin storage. Nothing was saved.") };
	}
	const snapshot = await readSchemaLibrary(host);
	if (snapshot.state === "unavailable") {
		return { ok: false, result: failure("unavailable", "The library could not be read. Nothing was saved.") };
	}
	if (snapshot.state === "corrupt") {
		return { ok: false, result: failure("corrupt", "The stored library is invalid, so it cannot be changed here. Nothing was saved.") };
	}
	if (snapshot.revision !== expectedRevision) return { ok: false, result: failure("conflict", conflict) };
	return { ok: true, templates: snapshot.templates };
}

async function writeRecord(
	host: SchemaLibraryHost,
	expectedRevision: string | null,
	templates: SchemaLibraryTemplate[],
	template: SchemaLibraryTemplate | null,
	conflict = CONFLICT,
): Promise<SchemaLibraryWriteResult> {
	const next: SchemaLibraryRecord = { version: SCHEMA_LIBRARY_STORAGE_VERSION, templates };
	const bytes = schemaLibraryRecordBytes(next);
	if (bytes === null) {
		return failure(
			"limit_reached",
			`The library is limited to ${SCHEMA_LIBRARY_MAX_RECORD_BYTES.toLocaleString("en-US")} bytes in total. Nothing was saved; shorten or remove templates first.`,
		);
	}
	let result: unknown;
	try {
		result = await host.kv!.compareAndSet!(SCHEMA_LIBRARY_KEY, expectedRevision, next);
	} catch {
		return failure("unconfirmed", UNCONFIRMED);
	}
	const written = record(result);
	if (written?.applied === false) return failure("conflict", conflict);
	if (written?.applied !== true || !validRevision(written.revision)) return failure("unconfirmed", UNCONFIRMED);
	return {
		success: true,
		changed: true,
		library: { state: "saved", revision: written.revision, templates, bytes },
		template,
	};
}

/**
 * Creates (`expectedRevision` null for an absent library) or edits one
 * template. An edit keeps the template's identifier, creation time and
 * position. Saving the stored name and JSON again writes nothing.
 */
export async function saveSchemaLibraryTemplate(host: SchemaLibraryHost, input: unknown): Promise<SchemaLibraryWriteResult> {
	const source = record(input);
	const mode = source?.mode;
	const id = source?.id;
	const expectedRevision = expectedRevisionInput(source?.expectedRevision, mode === "create");
	if (!source || (mode !== "create" && mode !== "update") || typeof id !== "string" || !SCHEMA_LIBRARY_ID_PATTERN.test(id) || expectedRevision === undefined) {
		return failure("invalid_input", "The template identifier, mode or revision is invalid.");
	}
	const errors: SchemaLibraryFieldErrors = {};
	const nameProblem = schemaLibraryNameProblem(source.name);
	if (nameProblem) errors.name = nameProblem;
	const validation = validateEntrySchemaJson(source.json);
	if (!validation.ok) errors.json = validation.message;
	if (errors.name || errors.json) return { success: false, error: "invalid_values", errors };
	const name = (source.name as string).trim();
	const json = (source.json as string).trim();

	const guarded = await guardedSnapshot(host, expectedRevision);
	if (!guarded.ok) return guarded.result;
	const templates = guarded.templates;
	const index = templates.findIndex((template) => template.id === id);
	if (templates.some((template, position) => position !== index && nameKey(template.name) === nameKey(name))) {
		return { success: false, error: "invalid_values", errors: { name: "Another template already uses this name." } };
	}
	const now = host.now();
	if (mode === "create") {
		if (index !== -1) return failure("id_in_use", "That identifier is already in use. Nothing was saved; save again to use a new one.");
		if (templates.length >= SCHEMA_LIBRARY_MAX_TEMPLATES) {
			return failure("limit_reached", `The library holds at most ${SCHEMA_LIBRARY_MAX_TEMPLATES} templates. Nothing was saved; remove one first.`);
		}
		const template = { id, name, json, createdAt: now, updatedAt: now };
		return writeRecord(host, expectedRevision, [...templates, template], template);
	}
	// The loaded revision matched, so an unknown identifier was never in this library.
	if (index === -1) return failure("invalid_input", "This template is not in the loaded library.");
	const current = templates[index];
	if (current.name === name && current.json === json) {
		return {
			success: true,
			changed: false,
			library: { state: "saved", revision: expectedRevision as string, templates, bytes: schemaLibraryRecordBytes({ version: SCHEMA_LIBRARY_STORAGE_VERSION, templates }) ?? 0 },
			template: current,
		};
	}
	const template = { ...current, name, json, updatedAt: now };
	return writeRecord(host, expectedRevision, templates.map((item, position) => (position === index ? template : item)), template);
}

/**
 * Removes one template the editor reviewed under the loaded revision. Entry
 * schemas that were copied from it are separate records and stay as they are.
 */
export async function deleteSchemaLibraryTemplate(host: SchemaLibraryHost, input: unknown): Promise<SchemaLibraryWriteResult> {
	const source = record(input);
	const id = source?.id;
	const expectedRevision = expectedRevisionInput(source?.expectedRevision, false);
	if (!source || typeof id !== "string" || !SCHEMA_LIBRARY_ID_PATTERN.test(id) || !expectedRevision) {
		return failure("invalid_input", "Choose one template from the loaded library.");
	}
	const guarded = await guardedSnapshot(host, expectedRevision, DELETE_CONFLICT);
	if (!guarded.ok) return guarded.result;
	if (!guarded.templates.some((template) => template.id === id)) {
		return failure("invalid_input", "This template is not in the loaded library.");
	}
	return writeRecord(host, expectedRevision, guarded.templates.filter((template) => template.id !== id), null, DELETE_CONFLICT);
}
