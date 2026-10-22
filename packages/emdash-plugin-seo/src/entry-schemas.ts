// Custom JSON-LD owned by one exact content entry. An entry owns only records
// that carry a target naming that collection, entry ID and locale. Legacy
// records without a target stay read-only: `collection:id` and the public
// `collection:slug` alias share one namespace, so a scope string alone cannot
// prove which entry a legacy record belongs to. Every write compares the
// per-row revision the editor loaded. A per-row comparison does not make the
// per-entry or total caps atomic; creates recount after writing instead.
// No React, DOM or Node dependencies.

import {
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	extractSeoSchemaTypes,
	isSeoAdminSchemaScope,
} from "./entry-schema-domain.ts";
import {
	JsonLdValidationError,
	TEMPLATE_VARS,
	schemaDefinitionIdentities,
	validateCustomJsonLd,
} from "./lib.ts";
import { entrySchemaPreviewUnresolvedProblem } from "./entry-schema-candidate.ts";

export const ENTRY_SCHEMA_MAX_PER_ENTRY = 20;
/** Matching rows read for one entry, including inherited and disabled ones. */
export const ENTRY_SCHEMA_MAX_APPLICABLE = 100;
/** The legacy total that the public reader and portability tools assume. */
export const ENTRY_SCHEMA_MAX_TOTAL = 500;
export const ENTRY_SCHEMA_JSON_MAX_BYTES = 32_768;
export const ENTRY_SCHEMA_MAX_DEPTH = 16;
export const ENTRY_SCHEMA_MAX_VALUES = 2_000;
export const ENTRY_SCHEMA_NAME_MAX_LENGTH = 120;

const COLLECTION_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~%-]{0,119}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
/** Identifiers proposed by the editor for a new record. */
export const ENTRY_SCHEMA_NEW_ID_PATTERN = /^entry-[a-z0-9]{20}$/;
const STORED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TEMPLATE_TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;
const SCHEMA_ORG_CONTEXT = /^https?:\/\/schema\.org\/?$/;

export interface EntrySchemaRef {
	collection: string;
	entryId: string;
	locale: string | null;
}

export interface EntrySchemaTarget {
	collection: string;
	entryId: string;
	locale: string | null;
}

export interface StoredEntrySchema {
	storageVersion: typeof SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION;
	name: string;
	scope: string;
	json: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	target: EntrySchemaTarget;
}

export interface EntrySchemaHostEntry {
	id: string;
	slug: string | null;
	locale: string | null;
	status: string;
}

/** The subset of the host storage collection these commands use. */
export interface EntrySchemaStorage {
	query(options: { where: Record<string, unknown>; limit: number }): Promise<unknown>;
	getVersioned(id: string): Promise<unknown>;
	compareAndSet(
		id: string,
		expectedRevision: string | null,
		data: StoredEntrySchema,
	): Promise<{ applied: true; revision: string } | { applied: false }>;
	compareAndDelete(id: string, expectedRevision: string): Promise<{ applied: boolean }>;
	count(): Promise<number>;
}

export interface EntrySchemaHost {
	hasCollection(collection: string): Promise<boolean>;
	/** Whether Shipit SEO adds any schema to public pages at all. */
	schemaOutputEnabled(): Promise<boolean>;
	/**
	 * Refuses an enabled record that defines an ID owned by an active business
	 * identity, or that cannot be checked completely.
	 */
	businessIdentityConflict?(
		parsed: unknown,
		scope: string,
		target: EntrySchemaTarget,
	): Promise<{ unavailable: boolean; message: string } | null>;
	getEntry(collection: string, id: string): Promise<EntrySchemaHostEntry | null>;
	schemas: EntrySchemaStorage;
	now(): string;
}

export interface EntryCustomSchema {
	id: string;
	revision: string;
	name: string;
	json: string;
	enabled: boolean;
	types: string[];
	valid: boolean;
	validationError: string | null;
	createdAt: string;
	updatedAt: string;
}

export type EntryCustomSchemaSummary = Omit<EntryCustomSchema, "revision">;

export type EntryInheritedSchemaOwner = "site" | "collection" | "legacy-slug" | "legacy-entry" | "wrong-locale";

export interface EntryInheritedSchema {
	id: string;
	name: string;
	owner: EntryInheritedSchemaOwner;
	scope: string;
	enabled: boolean;
	types: string[];
	valid: boolean;
	/** For a wrong-locale record, the locale its target names. */
	targetLocale?: string | null;
}

export interface EntrySchemaEntry {
	collection: string;
	entryId: string;
	locale: string | null;
	slug: string | null;
	status: string;
}

export type EntrySchemaFailure =
	| "invalid_input"
	| "entry_not_found"
	| "entry_mismatch"
	| "too_many_applicable"
	| "storage_unavailable";

/** One exact stored ID, read by revision, before editing or recovering an unconfirmed write. */
export type EntrySchemaInspection =
	| { id: string; state: "absent" }
	| { id: string; state: "owned"; schema: EntryCustomSchema }
	| { id: string; state: "elsewhere" };

export type EntrySchemaListResult =
	| {
		success: true;
		entry: EntrySchemaEntry;
		outputEnabled: boolean;
		items: EntryCustomSchemaSummary[];
		inherited: EntryInheritedSchema[];
		limits: { perEntry: number; applicable: number };
		inspected?: EntrySchemaInspection;
	}
	| { success: false; error: EntrySchemaFailure; message: string };

export interface EntrySchemaFieldErrors {
	name?: string;
	json?: string;
	enabled?: string;
}

export type EntrySchemaWriteFailure =
	| EntrySchemaFailure
	| "not_found"
	| "scope_mismatch"
	| "id_in_use"
	| "limit_reached"
	| "unconfirmed";

export type EntrySchemaSaveResult =
	| { success: true; schema: EntryCustomSchema; alreadySaved: boolean }
	| { success: false; error: "invalid_values"; errors: EntrySchemaFieldErrors }
	| { success: false; error: "conflict"; current: EntryCustomSchema | null; message: string }
	| { success: false; error: EntrySchemaWriteFailure; message: string };

export type EntrySchemaRemoveResult =
	| { success: true; id: string }
	| { success: false; error: "conflict"; current: EntryCustomSchema; message: string }
	| { success: false; error: EntrySchemaWriteFailure; message: string };

interface StoredRow {
	id: string;
	value: Record<string, unknown>;
	scope: string;
}

interface ApplicableSet {
	exactScope: string;
	/** Every row stored under `collection:id`, owned or legacy; the per-entry cap counts all of them. */
	exactCount: number;
	own: StoredRow[];
	inherited: Array<StoredRow & { owner: EntryInheritedSchemaOwner }>;
}

class StorageShapeError extends Error {}

const READ_FAILED = "Stored schemas could not be read completely. Nothing was changed.";

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function storedScope(value: Record<string, unknown>): string {
	// Rows without a scope have always been treated as global.
	return text(value.scope) || "global";
}

function failure<E extends string>(error: E, message: string) {
	return { success: false as const, error, message };
}

/** Rejects a result that is not the host's `{ items: { id, data }[], hasMore }` page. */
function queryRows(result: unknown): Array<{ id: string; value: Record<string, unknown> }> {
	const page = record(result);
	if (!page || !Array.isArray(page.items) || typeof page.hasMore !== "boolean") throw new StorageShapeError();
	return page.items.map((item) => {
		const row = record(item);
		const value = record(row?.data);
		if (!row || typeof row.id !== "string" || !row.id || !value) throw new StorageShapeError();
		return { id: row.id, value };
	});
}

function versionedRow(result: unknown): { value: Record<string, unknown>; revision: string } | null {
	if (result === null) return null;
	const row = record(result);
	const value = record(row?.value);
	if (!row || !value || typeof row.revision !== "string" || !row.revision) throw new StorageShapeError();
	return { value, revision: row.revision };
}

/**
 * Validates the ownership metadata carried by a stored or imported record. A
 * target must name the same entry as the record's scope.
 */
export function parseStoredEntrySchemaTarget(
	value: unknown,
	scope: string,
): { ok: true; target: EntrySchemaTarget | null } | { ok: false; message: string } {
	if (value === undefined) return { ok: true, target: null };
	const source = record(value);
	const locale = source?.locale;
	if (
		!source ||
		typeof source.collection !== "string" ||
		!COLLECTION_PATTERN.test(source.collection) ||
		typeof source.entryId !== "string" ||
		!ENTRY_ID_PATTERN.test(source.entryId) ||
		!(locale === null || (typeof locale === "string" && LOCALE_PATTERN.test(locale)))
	) {
		return { ok: false, message: "Entry ownership metadata is invalid." };
	}
	if (scope !== `${source.collection}:${source.entryId}`) {
		return { ok: false, message: "Entry ownership metadata does not match the schema scope." };
	}
	return {
		ok: true,
		target: { collection: source.collection, entryId: source.entryId, locale: locale as string | null },
	};
}

/** The stored content row a page renders, as loaded from the host. */
export interface EntrySchemaPageEntry {
	collection: string;
	id: string;
	locale: string | null;
}

/**
 * Whether a target names this exact row. A targeted record applies only to its
 * own entry and locale, so neither the legacy slug alias nor an imported target
 * with another locale can carry it to a different page. Without a loaded entry
 * a target cannot be checked and fails closed.
 */
export function entrySchemaTargetApplies(target: EntrySchemaTarget | null, entry: EntrySchemaPageEntry | null): boolean {
	if (!target) return true;
	return entry !== null && target.collection === entry.collection && target.entryId === entry.id && target.locale === entry.locale;
}

/** Applies `entrySchemaTargetApplies` to a raw stored record; invalid targets fail closed. */
export function entrySchemaTargetMatches(value: unknown, entry: EntrySchemaPageEntry | null): boolean {
	const source = record(value);
	if (!source) return false;
	const parsed = parseStoredEntrySchemaTarget(source.target, storedScope(source));
	return parsed.ok && entrySchemaTargetApplies(parsed.target, entry);
}

function ownedTarget(value: Record<string, unknown>, ref: EntrySchemaRef, locale: string | null): boolean {
	const scope = storedScope(value);
	if (scope !== `${ref.collection}:${ref.entryId}`) return false;
	const parsed = parseStoredEntrySchemaTarget(value.target, scope);
	return parsed.ok && parsed.target !== null && parsed.target.locale === locale;
}

export function parseEntrySchemaRef(
	input: unknown,
	options: { requireLocale: boolean },
): EntrySchemaRef | null {
	const source = record(input);
	if (!source) return null;
	const collection = typeof source.collection === "string" ? source.collection : "";
	const entryId = typeof source.entryId === "string" ? source.entryId : "";
	if (!COLLECTION_PATTERN.test(collection) || !ENTRY_ID_PATTERN.test(entryId)) return null;
	if (source.locale === undefined) return options.requireLocale ? null : { collection, entryId, locale: null };
	if (source.locale !== null && (typeof source.locale !== "string" || !LOCALE_PATTERN.test(source.locale))) return null;
	return { collection, entryId, locale: source.locale as string | null };
}

async function resolveEntry(
	host: EntrySchemaHost,
	ref: EntrySchemaRef,
	options: { checkLocale: boolean },
): Promise<{ ok: true; entry: EntrySchemaHostEntry } | { ok: false; error: EntrySchemaFailure; message: string }> {
	let entry: EntrySchemaHostEntry | null;
	try {
		if (!(await host.hasCollection(ref.collection))) {
			return { ok: false, error: "entry_not_found", message: "This content type is not available." };
		}
		entry = await host.getEntry(ref.collection, ref.entryId);
	} catch {
		return { ok: false, error: "storage_unavailable", message: "The entry could not be read. Nothing was changed." };
	}
	if (!entry) return { ok: false, error: "entry_not_found", message: "This entry no longer exists." };
	// The host may resolve other identifiers; only the exact stored row counts.
	if (entry.id !== ref.entryId) {
		return { ok: false, error: "entry_mismatch", message: "The entry identifier does not match a stored entry." };
	}
	if (options.checkLocale && (entry.locale ?? null) !== ref.locale) {
		return {
			ok: false,
			error: "entry_mismatch",
			message: "This entry's locale changed since the editor loaded it. Reload the editor.",
		};
	}
	return { ok: true, entry };
}

async function readApplicable(
	host: EntrySchemaHost,
	ref: EntrySchemaRef,
	entry: EntrySchemaHostEntry,
): Promise<{ ok: true; set: ApplicableSet } | { ok: false; error: EntrySchemaFailure; message: string }> {
	const exactScope = `${ref.collection}:${ref.entryId}`;
	const slug = text(entry.slug);
	const candidateSlugScope = slug && slug !== ref.entryId ? `${ref.collection}:${slug}` : "";
	const slugScope = candidateSlugScope && isSeoAdminSchemaScope(candidateSlugScope) ? candidateSlugScope : null;
	const scopes = ["global", "", ref.collection, exactScope, ...(slugScope ? [slugScope] : [])];
	const tooMany = {
		ok: false as const,
		error: "too_many_applicable" as const,
		message: `More than ${ENTRY_SCHEMA_MAX_APPLICABLE} stored schemas apply to this entry. Narrow site or content type schemas in the SEO workspace first.`,
	};
	const rows = new Map<string, Record<string, unknown>>();
	try {
		const scoped = await host.schemas.query({
			where: { scope: { in: scopes } },
			limit: ENTRY_SCHEMA_MAX_APPLICABLE + 1,
		});
		for (const row of queryRows(scoped)) rows.set(row.id, row.value);
		if ((scoped as { hasMore: boolean }).hasMore || rows.size > ENTRY_SCHEMA_MAX_APPLICABLE) return tooMany;
		// Rows saved without a scope are global; an `in` list cannot match them.
		const unscoped = await host.schemas.query({
			where: { scope: null },
			limit: ENTRY_SCHEMA_MAX_APPLICABLE + 1 - rows.size,
		});
		for (const row of queryRows(unscoped)) rows.set(row.id, row.value);
		if ((unscoped as { hasMore: boolean }).hasMore || rows.size > ENTRY_SCHEMA_MAX_APPLICABLE) return tooMany;
	} catch {
		return { ok: false, error: "storage_unavailable", message: READ_FAILED };
	}

	const set: ApplicableSet = { exactScope, exactCount: 0, own: [], inherited: [] };
	for (const [id, value] of rows) {
		const scope = storedScope(value);
		const target = parseStoredEntrySchemaTarget(value.target, scope);
		if (scope === exactScope) {
			set.exactCount += 1;
			if (ownedTarget(value, ref, entry.locale ?? null)) set.own.push({ id, value, scope });
			else if (target.ok && target.target) set.inherited.push({ id, value, scope, owner: "wrong-locale" });
			else set.inherited.push({ id, value, scope, owner: "legacy-entry" });
		} else if (target.ok && target.target) {
			// A valid target on the slug alias names another entry; it never applies here.
			continue;
		} else if (scope === "global") set.inherited.push({ id, value, scope, owner: "site" });
		else if (scope === ref.collection) set.inherited.push({ id, value, scope, owner: "collection" });
		else if (slugScope && scope === slugScope) set.inherited.push({ id, value, scope, owner: "legacy-slug" });
	}
	const byCreated = (left: StoredRow, right: StoredRow) =>
		text(left.value.createdAt).localeCompare(text(right.value.createdAt)) || left.id.localeCompare(right.id);
	set.own.sort(byCreated);
	set.inherited.sort(byCreated);
	return { ok: true, set };
}

function storedState(value: Record<string, unknown>): { types: string[]; valid: boolean; validationError: string | null } {
	const json = typeof value.json === "string" ? value.json : "";
	let types: string[] = [];
	let validationError: string | null = null;
	try {
		types = extractSeoSchemaTypes(validateCustomJsonLd(json));
	} catch (error: unknown) {
		validationError = error instanceof JsonLdValidationError ? error.message : "Stored JSON-LD is invalid.";
	}
	const target = parseStoredEntrySchemaTarget(value.target, storedScope(value));
	if (!target.ok) validationError ??= target.message;
	return { types, valid: validationError === null, validationError };
}

function toEntrySchemaSummary(id: string, value: Record<string, unknown>): EntryCustomSchemaSummary {
	const createdAt = text(value.createdAt) || new Date(0).toISOString();
	return {
		id,
		name: text(value.name) || "Untitled schema",
		json: typeof value.json === "string" ? value.json : "",
		enabled: value.enabled === true,
		...storedState(value),
		createdAt,
		updatedAt: text(value.updatedAt) || createdAt,
	};
}

function toEntrySchema(id: string, revision: string, value: Record<string, unknown>): EntryCustomSchema {
	return { ...toEntrySchemaSummary(id, value), revision };
}

function inheritedSchema(row: StoredRow & { owner: EntryInheritedSchemaOwner }): EntryInheritedSchema {
	const state = storedState(row.value);
	const target = row.owner === "wrong-locale" ? parseStoredEntrySchemaTarget(row.value.target, row.scope) : null;
	return {
		id: row.id,
		name: text(row.value.name) || "Untitled schema",
		owner: row.owner,
		scope: row.scope,
		enabled: row.value.enabled === true,
		types: state.types,
		valid: state.valid,
		...(target?.ok && target.target ? { targetLocale: target.target.locale } : {}),
	};
}

export async function listEntrySchemas(host: EntrySchemaHost, input: unknown): Promise<EntrySchemaListResult> {
	const ref = parseEntrySchemaRef(input, { requireLocale: false });
	const inspectId = record(input)?.inspectId;
	if (!ref || (inspectId !== undefined && (typeof inspectId !== "string" || !STORED_ID_PATTERN.test(inspectId)))) {
		return failure("invalid_input", "Choose one exact entry.");
	}
	const resolved = await resolveEntry(host, ref, { checkLocale: record(input)?.locale !== undefined });
	if (!resolved.ok) return failure(resolved.error, resolved.message);
	const applicable = await readApplicable(host, ref, resolved.entry);
	if (!applicable.ok) return failure(applicable.error, applicable.message);
	if (applicable.set.own.length > ENTRY_SCHEMA_MAX_PER_ENTRY) {
		return failure(
			"too_many_applicable",
			`This entry has more than ${ENTRY_SCHEMA_MAX_PER_ENTRY} custom schemas. Remove some in the SEO workspace before editing here.`,
		);
	}

	let items: EntryCustomSchemaSummary[];
	const locale = resolved.entry.locale ?? null;
	let outputEnabled: boolean;
	let inspected: EntrySchemaInspection | undefined;
	try {
		outputEnabled = await host.schemaOutputEnabled();
		if (typeof inspectId === "string") {
			// Absence from this entry's list is not proof of deletion; only the exact row is.
			const row = versionedRow(await host.schemas.getVersioned(inspectId));
			inspected = !row
				? { id: inspectId, state: "absent" }
				: ownedTarget(row.value, ref, locale)
					? { id: inspectId, state: "owned", schema: toEntrySchema(inspectId, row.revision, row.value) }
					: { id: inspectId, state: "elsewhere" };
		}
		items = applicable.set.own.map((row) => toEntrySchemaSummary(row.id, row.value));
	} catch {
		return failure("storage_unavailable", READ_FAILED);
	}
	return {
		success: true,
		entry: {
			collection: ref.collection,
			entryId: ref.entryId,
			locale,
			slug: resolved.entry.slug ?? null,
			status: resolved.entry.status,
		},
		outputEnabled,
		items,
		inherited: applicable.set.inherited.map(inheritedSchema),
		limits: { perEntry: ENTRY_SCHEMA_MAX_PER_ENTRY, applicable: ENTRY_SCHEMA_MAX_APPLICABLE },
		...(inspected ? { inspected } : {}),
	};
}

// JSON-LD node object shapes (https://www.w3.org/TR/json-ld11/#node-objects):
// @type holds one IRI or a list of them, @graph holds node objects.
function validTypeValue(value: unknown): boolean {
	const types = Array.isArray(value) ? value : [value];
	return types.length > 0 && types.every((type) => typeof type === "string" && type.trim() !== "");
}

function validGraphValue(value: unknown): boolean {
	const nodes = Array.isArray(value) ? value : [value];
	return nodes.length > 0 && nodes.every((node) => record(node) !== null);
}

/** Bounded syntax and data-safety checks for new entry writes; not content or eligibility checks. */
export function validateEntrySchemaJson(
	raw: unknown,
): { ok: true; parsed: Record<string, unknown> | Record<string, unknown>[] } | { ok: false; message: string } {
	const json = typeof raw === "string" ? raw.trim() : "";
	if (!json) return { ok: false, message: "Enter JSON-LD." };
	if (new TextEncoder().encode(json).byteLength > ENTRY_SCHEMA_JSON_MAX_BYTES) {
		return { ok: false, message: `Use at most ${ENTRY_SCHEMA_JSON_MAX_BYTES.toLocaleString("en-US")} bytes of JSON-LD.` };
	}
	let parsed: Record<string, unknown> | Record<string, unknown>[];
	try {
		parsed = validateCustomJsonLd(json);
	} catch (error: unknown) {
		return { ok: false, message: error instanceof JsonLdValidationError ? error.message : "Enter valid JSON-LD." };
	}

	const allowed = new Set<string>(TEMPLATE_VARS);
	const unknown = new Set<string>();
	let values = 0;
	let problem: string | null = null;
	// Checks the parsed strings, so JSON escapes such as { cannot hide a delimiter.
	const checkText = (value: string, where: "value" | "key"): void => {
		const tokens = [...value.matchAll(TEMPLATE_TOKEN)];
		if (where === "key" && (tokens.length || value.includes("{{") || value.includes("}}"))) {
			problem = "Variables can be used in values only, not in property names.";
			return;
		}
		for (const match of tokens) if (!allowed.has(match[1])) unknown.add(match[1]);
		const rest = value.replace(TEMPLATE_TOKEN, "");
		if (rest.includes("{{") || rest.includes("}}")) {
			problem = `Write each variable like {{title}}, using ${TEMPLATE_VARS.map((key) => `{{${key}}}`).join(", ")}; filters and other braces are not supported.`;
		}
	};
	const visit = (value: unknown, depth: number): void => {
		if (problem) return;
		values += 1;
		if (values > ENTRY_SCHEMA_MAX_VALUES) {
			problem = `Use at most ${ENTRY_SCHEMA_MAX_VALUES.toLocaleString("en-US")} values.`;
			return;
		}
		if (depth > ENTRY_SCHEMA_MAX_DEPTH) {
			problem = `Nest objects and lists at most ${ENTRY_SCHEMA_MAX_DEPTH} levels deep.`;
			return;
		}
		if (typeof value === "string") {
			checkText(value, "value");
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) visit(item, depth + 1);
			return;
		}
		if (value && typeof value === "object") {
			for (const [key, child] of Object.entries(value)) {
				checkText(key, "key");
				if (problem) return;
				if (key === "@context" && !(typeof child === "string" && SCHEMA_ORG_CONTEXT.test(child))) {
					problem = 'Use "@context": "https://schema.org". Other contexts are not loaded or allowed.';
					return;
				}
				if (key === "@type" && !validTypeValue(child)) {
					problem = "Each @type must be a type name or a list of type names.";
					return;
				}
				if (key === "@graph" && !validGraphValue(child)) {
					problem = "@graph must be an object or a non-empty list of objects.";
					return;
				}
				visit(child, depth + 1);
			}
		}
	};
	visit(parsed, 0);
	if (problem) return { ok: false, message: problem };
	if (unknown.size) {
		return {
			ok: false,
			message: `Unknown variables: ${[...unknown].slice(0, 5).map((key) => `{{${key}}}`).join(", ")}. Use ${TEMPLATE_VARS.map((key) => `{{${key}}}`).join(", ")}.`,
		};
	}
	for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
		if (typeof node["@context"] !== "string") {
			return { ok: false, message: 'Add "@context": "https://schema.org" to each top-level object.' };
		}
		if (!validTypeValue(node["@type"]) && !validGraphValue(node["@graph"])) {
			return { ok: false, message: "Give each top-level object an @type or an @graph." };
		}
	}
	return { ok: true, parsed };
}

const OWNER_LABELS: Record<EntryInheritedSchemaOwner | "entry", string> = {
	entry: "this entry",
	site: "every page",
	collection: "this content type",
	"legacy-slug": "a legacy slug scope",
	"legacy-entry": "an older record for this entry",
	"wrong-locale": "a record for another locale",
};

function identityConflict(
	parsed: unknown,
	others: Array<StoredRow & { owner: EntryInheritedSchemaOwner | "entry" }>,
): string | null {
	const identities = new Set(schemaDefinitionIdentities(parsed));
	if (!identities.size) return null;
	for (const row of others) {
		if (row.value.enabled !== true || typeof row.value.json !== "string") continue;
		// The public reader drops records with an invalid target, so they cannot collide.
		if (!parseStoredEntrySchemaTarget(row.value.target, row.scope).ok) continue;
		let existing: unknown;
		try {
			existing = validateCustomJsonLd(row.value.json);
		} catch {
			continue;
		}
		const duplicate = schemaDefinitionIdentities(existing).find((id) => identities.has(id));
		if (duplicate) {
			return `Entity @id ${duplicate} is already defined by the enabled schema "${text(row.value.name) || "Untitled schema"}" (${OWNER_LABELS[row.owner]}).`;
		}
	}
	return null;
}

function sameContent(value: Record<string, unknown>, next: { name: string; json: string; enabled: boolean }): boolean {
	return value.name === next.name && value.json === next.json && value.enabled === next.enabled;
}

const UNCONFIRMED_SAVE = "The save could not be confirmed. Check the current state before saving again.";

type EntrySchemaWriteValues =
	| { ok: true; name: string; json: string; enabled: boolean; parsed: Record<string, unknown> | Record<string, unknown>[] }
	| { ok: false; errors: EntrySchemaFieldErrors };

/** Field rules for a record about to be written or previewed. */
function entrySchemaWriteValues(source: Record<string, unknown>): EntrySchemaWriteValues {
	const errors: EntrySchemaFieldErrors = {};
	const name = typeof source.name === "string" ? source.name.trim() : "";
	if (!name) errors.name = "Enter a name.";
	else if (name.length > ENTRY_SCHEMA_NAME_MAX_LENGTH) errors.name = `Use at most ${ENTRY_SCHEMA_NAME_MAX_LENGTH} characters.`;
	const validation = validateEntrySchemaJson(source.json);
	if (!validation.ok) errors.json = validation.message;
	if (typeof source.enabled !== "boolean") errors.enabled = "Choose whether this schema is included in page output.";
	if (Object.keys(errors).length || !validation.ok) return { ok: false, errors };
	return { ok: true, name, json: (source.json as string).trim(), enabled: source.enabled as boolean, parsed: validation.parsed };
}

/**
 * Identity checks for an enabled record: another record the public reader
 * applies to this page, or the active business identity, already defines one
 * of its entities.
 */
async function entrySchemaWriteRefusal(
	host: EntrySchemaHost,
	parsed: unknown,
	set: ApplicableSet,
	id: string,
	target: EntrySchemaTarget,
): Promise<{ field: "json"; message: string } | { field: "_form"; message: string } | null> {
	// Records the public reader suppresses for this page cannot collide on it.
	const others = [
		...set.own.map((row) => ({ ...row, owner: "entry" as const })),
		...set.inherited.filter((row) => row.owner !== "wrong-locale"),
	].filter((row) => row.id !== id);
	const conflict = identityConflict(parsed, others);
	if (conflict) return { field: "json", message: conflict };
	if (!host.businessIdentityConflict) return null;
	let owned: { unavailable: boolean; message: string } | null;
	try {
		owned = await host.businessIdentityConflict(parsed, set.exactScope, target);
	} catch {
		owned = { unavailable: true, message: "The business identity could not be checked. Nothing was saved." };
	}
	if (!owned) return null;
	return owned.unavailable ? { field: "_form", message: owned.message } : { field: "json", message: owned.message };
}

/**
 * Every create checks both caps after its record exists. A create that holds
 * the revision returned by its own write removes itself by that revision when
 * over a cap; concurrent creates may each pass the earlier checks, and the last
 * one to recount always sees every create that was kept. A recovered create
 * only has a revision read back later, which an editor may have produced with
 * the same content, so it never deletes and reports the excess for review.
 */
async function settleCreate(
	host: EntrySchemaHost,
	exactScope: string,
	id: string,
	schema: EntryCustomSchema,
	ownWriteRevision: string | null,
): Promise<EntrySchemaSaveResult> {
	const alreadySaved = ownWriteRevision === null;
	let limit: string | null = null;
	try {
		const own = await host.schemas.query({ where: { scope: exactScope }, limit: ENTRY_SCHEMA_MAX_PER_ENTRY + 1 });
		const rows = queryRows(own);
		if ((own as { hasMore: boolean }).hasMore || rows.length > ENTRY_SCHEMA_MAX_PER_ENTRY) {
			limit = `An entry can have at most ${ENTRY_SCHEMA_MAX_PER_ENTRY} custom schemas.`;
		} else if ((await host.schemas.count()) > ENTRY_SCHEMA_MAX_TOTAL) {
			limit = `Custom schemas are limited to ${ENTRY_SCHEMA_MAX_TOTAL} records in total.`;
		}
		if (!limit) return { success: true, schema, alreadySaved };
		if (ownWriteRevision === null) {
			return failure(
				"limit_reached",
				`${limit} This schema is stored and was kept; review this entry's schemas and remove one.`,
			);
		}
		const rolledBack = await host.schemas.compareAndDelete(id, ownWriteRevision);
		return failure(
			"limit_reached",
			rolledBack.applied
				? `${limit} This create was rolled back.`
				: `${limit} This create changed before it could be rolled back; review this entry's schemas.`,
		);
	} catch {
		return failure("unconfirmed", UNCONFIRMED_SAVE);
	}
}

export async function saveEntrySchema(host: EntrySchemaHost, input: unknown): Promise<EntrySchemaSaveResult> {
	const source = record(input);
	const ref = parseEntrySchemaRef(source, { requireLocale: true });
	if (!source || !ref) return failure("invalid_input", "Choose one exact entry.");
	const id = typeof source.id === "string" ? source.id : "";
	const expectedRevision = source.expectedRevision;
	const creating = expectedRevision === null;
	if (
		!(creating ? ENTRY_SCHEMA_NEW_ID_PATTERN.test(id) : STORED_ID_PATTERN.test(id)) ||
		(!creating && (typeof expectedRevision !== "string" || !expectedRevision || expectedRevision.length > 256))
	) {
		return failure("invalid_input", "The schema identifier or revision is invalid.");
	}

	const values = entrySchemaWriteValues(source);
	if (!values.ok) return { success: false, error: "invalid_values", errors: values.errors };
	const { name, json, enabled } = values;

	const resolved = await resolveEntry(host, ref, { checkLocale: true });
	if (!resolved.ok) return failure(resolved.error, resolved.message);
	const locale = resolved.entry.locale ?? null;
	const applicable = await readApplicable(host, ref, resolved.entry);
	if (!applicable.ok) return failure(applicable.error, applicable.message);

	let stored: { value: Record<string, unknown>; revision: string } | null;
	try {
		stored = versionedRow(await host.schemas.getVersioned(id));
	} catch {
		return failure("storage_unavailable", "The stored schema could not be read. Nothing was changed.");
	}
	if (creating) {
		if (stored) {
			// A retried create whose first response was lost: the same caps decide whether it stays.
			if (ownedTarget(stored.value, ref, locale) && sameContent(stored.value, { name, json, enabled })) {
				return settleCreate(host, applicable.set.exactScope, id, toEntrySchema(id, stored.revision, stored.value), null);
			}
			return failure("id_in_use", "That identifier is already in use. Nothing was saved; save again to use a new one.");
		}
		if (applicable.set.exactCount >= ENTRY_SCHEMA_MAX_PER_ENTRY) {
			return failure("limit_reached", `An entry can have at most ${ENTRY_SCHEMA_MAX_PER_ENTRY} custom schemas.`);
		}
		try {
			if ((await host.schemas.count()) >= ENTRY_SCHEMA_MAX_TOTAL) {
				return failure("limit_reached", `Custom schemas are limited to ${ENTRY_SCHEMA_MAX_TOTAL} records in total.`);
			}
		} catch {
			return failure("storage_unavailable", "Custom schema capacity could not be checked. Nothing was saved.");
		}
	} else {
		if (!stored) {
			return failure("not_found", "This schema was removed elsewhere. Your input is kept; add it again to create a new record.");
		}
		if (!ownedTarget(stored.value, ref, locale)) {
			return failure("scope_mismatch", "This schema is not owned by this entry and cannot be changed here.");
		}
		if (stored.revision !== expectedRevision) {
			return {
				success: false,
				error: "conflict",
				current: toEntrySchema(id, stored.revision, stored.value),
				message: "This schema changed after you opened it. Nothing was saved.",
			};
		}
	}

	if (enabled) {
		const refusal = await entrySchemaWriteRefusal(host, values.parsed, applicable.set, id, {
			collection: ref.collection,
			entryId: ref.entryId,
			locale,
		});
		if (refusal?.field === "_form") return failure("storage_unavailable", refusal.message);
		if (refusal) return { success: false, error: "invalid_values", errors: { json: refusal.message } };
	}

	const now = host.now();
	const next: StoredEntrySchema = {
		storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		name,
		scope: applicable.set.exactScope,
		json,
		enabled,
		createdAt: !creating && stored ? text(stored.value.createdAt) || now : now,
		updatedAt: now,
		target: { collection: ref.collection, entryId: ref.entryId, locale },
	};
	let written: { applied: true; revision: string } | { applied: false };
	try {
		written = await host.schemas.compareAndSet(id, creating ? null : (expectedRevision as string), next);
	} catch {
		return failure("unconfirmed", UNCONFIRMED_SAVE);
	}
	if (written.applied) {
		const schema = toEntrySchema(id, written.revision, { ...next });
		return creating
			? settleCreate(host, applicable.set.exactScope, id, schema, written.revision)
			: { success: true, schema, alreadySaved: false };
	}

	let current: { value: Record<string, unknown>; revision: string } | null;
	try {
		current = versionedRow(await host.schemas.getVersioned(id));
	} catch {
		return failure("unconfirmed", UNCONFIRMED_SAVE);
	}
	if (creating) {
		if (current && ownedTarget(current.value, ref, locale) && sameContent(current.value, { name, json, enabled })) {
			return settleCreate(host, applicable.set.exactScope, id, toEntrySchema(id, current.revision, current.value), null);
		}
		return failure("id_in_use", "That identifier is already in use. Nothing was saved; save again to use a new one.");
	}
	if (current && !ownedTarget(current.value, ref, locale)) {
		return failure("scope_mismatch", "This schema was moved away from this entry. Nothing was saved.");
	}
	return {
		success: false,
		error: "conflict",
		current: current ? toEntrySchema(id, current.revision, current.value) : null,
		message: current
			? "This schema changed after you opened it. Nothing was saved."
			: "This schema was removed elsewhere. Nothing was saved.",
	};
}

/** What the save command would refuse for this candidate as the stores read now; never a promise about a later save. */
export type EntrySchemaCandidateSaveCheck =
	| { ok: true }
	| { ok: false; reason: "identity" | "limit" | "unavailable"; message: string };

export type EntrySchemaCandidatePreparation =
	| {
		success: true;
		entry: EntrySchemaHostEntry;
		mode: "add" | "edit";
		/** The record the save would write, with the observation time as `updatedAt`. */
		candidate: { id: string; value: StoredEntrySchema };
		/**
		 * Every applicable stored row read for this entry, with an edited row
		 * replaced by the candidate in place and an added one appended. Raw
		 * values: the public reader's target and scope rules still apply.
		 */
		rows: Array<{ id: string; value: Record<string, unknown> }>;
		saveCheck: EntrySchemaCandidateSaveCheck;
	}
	| { success: false; error: "invalid_values"; errors: EntrySchemaFieldErrors }
	| { success: false; error: "conflict"; current: EntryCustomSchema; message: string }
	| { success: false; error: EntrySchemaFailure | "not_found" | "scope_mismatch" | "id_in_use" | "schemas_too_large"; message: string };

/**
 * Checks an unsaved candidate exactly as `saveEntrySchema` would before its
 * write: field rules, the exact entry and locale, the applicable-record cap,
 * and either an absent new identifier or the owned row at the loaded
 * revision. Nothing is written. Cap and identity outcomes are reported in
 * `saveCheck` so the resolver can still show what it would emit.
 */
export async function prepareEntrySchemaCandidate(
	host: EntrySchemaHost,
	input: unknown,
): Promise<EntrySchemaCandidatePreparation> {
	const source = record(input);
	const ref = parseEntrySchemaRef(source, { requireLocale: true });
	if (!source || !ref) return failure("invalid_input", "Choose one exact entry.");
	const id = typeof source.id === "string" ? source.id : "";
	const expectedRevision = source.expectedRevision;
	const creating = expectedRevision === null;
	if (
		!(creating ? ENTRY_SCHEMA_NEW_ID_PATTERN.test(id) : STORED_ID_PATTERN.test(id)) ||
		(!creating && (typeof expectedRevision !== "string" || !expectedRevision || expectedRevision.length > 256))
	) {
		return failure("invalid_input", "The schema identifier or revision is invalid.");
	}
	const values = entrySchemaWriteValues(source);
	if (!values.ok) return { success: false, error: "invalid_values", errors: values.errors };

	const resolved = await resolveEntry(host, ref, { checkLocale: true });
	if (!resolved.ok) return failure(resolved.error, resolved.message);
	const locale = resolved.entry.locale ?? null;
	const applicable = await readApplicable(host, ref, resolved.entry);
	if (!applicable.ok) return failure(applicable.error, applicable.message);
	const set = applicable.set;

	let stored: { value: Record<string, unknown>; revision: string } | null;
	try {
		stored = versionedRow(await host.schemas.getVersioned(id));
	} catch {
		return failure("storage_unavailable", "The stored schema could not be read.");
	}
	// Every stored JSON this preview could parse, counted before any of it is parsed.
	const unresolved = entrySchemaPreviewUnresolvedProblem([
		...[...set.own, ...set.inherited].filter((row) => row.id !== id),
		...(stored ? [stored] : []),
		{ value: { json: values.json } },
	]);
	if (unresolved) return failure("schemas_too_large", unresolved);
	if (creating) {
		if (stored) return failure("id_in_use", "That identifier is already in use. Start a new schema to preview it.");
	} else {
		if (!stored) return failure("not_found", "This schema was removed elsewhere. Your input is kept; add it again to create a new record.");
		if (!ownedTarget(stored.value, ref, locale)) {
			return failure("scope_mismatch", "This schema is not owned by this entry and cannot be previewed here.");
		}
		if (stored.revision !== expectedRevision) {
			return {
				success: false,
				error: "conflict",
				current: toEntrySchema(id, stored.revision, stored.value),
				message: "This schema changed after you opened it. Review the saved version before previewing.",
			};
		}
	}

	const now = host.now();
	const target = { collection: ref.collection, entryId: ref.entryId, locale };
	const value: StoredEntrySchema = {
		storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		name: values.name,
		scope: set.exactScope,
		json: values.json,
		enabled: values.enabled,
		createdAt: !creating && stored ? text(stored.value.createdAt) || now : now,
		updatedAt: now,
		target,
	};
	const rows = [...set.own, ...set.inherited]
		.map((row) => (row.id === id ? { id, value: value as unknown as Record<string, unknown> } : { id: row.id, value: row.value }));
	// The query read and the versioned read are separate; the verified owned row applies either way.
	if (creating || !rows.some((row) => row.id === id)) rows.push({ id, value: value as unknown as Record<string, unknown> });

	let saveCheck: EntrySchemaCandidateSaveCheck = { ok: true };
	if (creating && set.exactCount >= ENTRY_SCHEMA_MAX_PER_ENTRY) {
		saveCheck = { ok: false, reason: "limit", message: `An entry can have at most ${ENTRY_SCHEMA_MAX_PER_ENTRY} custom schemas.` };
	} else if (creating) {
		try {
			if ((await host.schemas.count()) >= ENTRY_SCHEMA_MAX_TOTAL) {
				saveCheck = { ok: false, reason: "limit", message: `Custom schemas are limited to ${ENTRY_SCHEMA_MAX_TOTAL} records in total.` };
			}
		} catch {
			saveCheck = { ok: false, reason: "unavailable", message: "Custom schema capacity could not be checked." };
		}
	}
	if (saveCheck.ok && values.enabled) {
		const refusal = await entrySchemaWriteRefusal(host, values.parsed, set, id, target);
		if (refusal) {
			saveCheck = { ok: false, reason: refusal.field === "_form" ? "unavailable" : "identity", message: refusal.message };
		}
	}
	return { success: true, entry: resolved.entry, mode: creating ? "add" : "edit", candidate: { id, value }, rows, saveCheck };
}

export async function removeEntrySchema(host: EntrySchemaHost, input: unknown): Promise<EntrySchemaRemoveResult> {
	const source = record(input);
	const ref = parseEntrySchemaRef(source, { requireLocale: true });
	const id = typeof source?.id === "string" ? source.id : "";
	const expectedRevision = source?.expectedRevision;
	if (!source || !ref || !STORED_ID_PATTERN.test(id) || typeof expectedRevision !== "string" || !expectedRevision || expectedRevision.length > 256) {
		return failure("invalid_input", "Choose one stored schema on one exact entry.");
	}
	const resolved = await resolveEntry(host, ref, { checkLocale: true });
	if (!resolved.ok) return failure(resolved.error, resolved.message);
	const locale = resolved.entry.locale ?? null;

	const inspect = async (): Promise<EntrySchemaRemoveResult | { value: Record<string, unknown>; revision: string }> => {
		const stored = versionedRow(await host.schemas.getVersioned(id));
		if (!stored) return failure("not_found", "This schema was already removed.");
		if (!ownedTarget(stored.value, ref, locale)) {
			return failure("scope_mismatch", "This schema is not owned by this entry and cannot be removed here.");
		}
		if (stored.revision !== expectedRevision) {
			return {
				success: false,
				error: "conflict",
				current: toEntrySchema(id, stored.revision, stored.value),
				message: "This schema changed after you opened it. Nothing was removed.",
			};
		}
		return stored;
	};

	let before: Awaited<ReturnType<typeof inspect>>;
	try {
		before = await inspect();
	} catch {
		return failure("storage_unavailable", "The stored schema could not be read. Nothing was removed.");
	}
	if ("success" in before) return before;
	let removed: { applied: boolean };
	try {
		removed = await host.schemas.compareAndDelete(id, expectedRevision);
	} catch {
		return failure("unconfirmed", "The removal could not be confirmed. Check the current state before trying again.");
	}
	if (removed.applied) return { success: true, id };
	try {
		const after = await inspect();
		if ("success" in after) return after;
	} catch {
		// Fall through: the outcome is unknown.
	}
	return failure("unconfirmed", "The removal could not be confirmed. Check the current state before trying again.");
}
