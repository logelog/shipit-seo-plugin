// Metadata templates: one versioned plugin KV record holding explicit
// per-collection overrides of the description and social defaults, plus the
// per-collection score tokens that stored scores compare by equality. A
// collection without an override inherits its readable legacy `tpl:*` keys
// over the built-in defaults. Each command changes one collection and writes
// the whole record under the KV revision the editor loaded; the KV revision
// guards persistence, the tokens only score freshness. Legacy keys are read,
// never written. No React, DOM, Node or storage import.

import {
	SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	isSeoContentCollectionKey,
	validateSeoAdminTemplateValues,
	type SeoAdminTemplateErrors,
	type SeoAdminTemplateField,
	type SeoAdminTemplateValues,
} from "./admin-contract.ts";
import { DEFAULT_TEMPLATES, jsonUtf8LengthWithin } from "./lib.ts";

export const METADATA_TEMPLATES_KEY = `configuration:templates:v${SEO_ADMIN_TEMPLATES_STORAGE_VERSION}`;
/** Score tokens left by the pre-record reset. Read only while no record exists; never written. */
export const LEGACY_TEMPLATE_REVISIONS_KEY = "configuration:template-revisions:v1";
export const METADATA_TEMPLATE_FIELDS: readonly SeoAdminTemplateField[] = Object.freeze([
	"title",
	"description",
	"socialTitle",
	"socialDescription",
]);
export const METADATA_TEMPLATES_MAX_COLLECTIONS = 100;
/** The 1 MiB of JSON that EmDash 1.1.0 accepts for one conditional KV value. */
export const METADATA_TEMPLATES_MAX_RECORD_BYTES = 1_048_576;
export const METADATA_TEMPLATE_FIELD_MAX_LENGTH: Readonly<Record<SeoAdminTemplateField, number>> = Object.freeze({
	title: 300,
	description: 1_000,
	socialTitle: 300,
	socialDescription: 1_000,
});
const MAX_TOKEN_ENTRIES = 1_000;
const TOKEN_MAX_LENGTH = 64;
const REVISION_MAX_LENGTH = 256;
const RECORD_FIELDS = ["version", "updatedAt", "fallbackScoreRevision", "values", "collectionUpdatedAt"];

export function legacyTemplateKey(collection: string, field: SeoAdminTemplateField): string {
	return `tpl:${collection}:${field}`;
}

export interface MetadataTemplatesRecord {
	version: typeof SEO_ADMIN_TEMPLATES_STORAGE_VERSION;
	/** Older versions read this as the fallback token, so it stays a string. */
	updatedAt: string;
	/** When present (null included), the fallback token for collections without their own entry. */
	fallbackScoreRevision?: string | null;
	/** Explicit overrides only; may be empty when `collectionUpdatedAt` is present. */
	values: Record<string, SeoAdminTemplateValues>;
	collectionUpdatedAt?: Record<string, string | null>;
}

export type MetadataTemplatesCorruptReason =
	| "not-object"
	| "unsupported-version"
	| "unexpected-fields"
	| "invalid-values"
	| "invalid-tokens";

export type MetadataTemplatesSnapshot =
	| { state: "absent"; revision: null }
	| { state: "saved"; revision: string; record: MetadataTemplatesRecord }
	| { state: "corrupt"; revision: string; reason: MetadataTemplatesCorruptReason; detail: string }
	| { state: "unavailable"; revision: null };

/** The plugin KV methods used here; a missing method makes the record unavailable. */
export interface MetadataTemplatesStorage {
	get?: (key: string) => Promise<unknown>;
	getVersioned?: (key: string) => Promise<unknown>;
	compareAndSet?: (key: string, expectedRevision: string | null, value: unknown) => Promise<unknown>;
	compareAndDelete?: (key: string, expectedRevision: string) => Promise<unknown>;
}

function plain(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function validToken(value: unknown): value is string {
	return typeof value === "string" && value.length <= TOKEN_MAX_LENGTH;
}

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= REVISION_MAX_LENGTH;
}

function corrupt(reason: MetadataTemplatesCorruptReason, detail: string) {
	return { ok: false as const, reason, detail };
}

/** Own keys, enumerated one at a time; null as soon as there are more than `cap`. */
function boundedKeys(value: Record<string, unknown>, cap: number): string[] | null {
	const keys: string[] = [];
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		if (keys.length >= cap) return null;
		keys.push(key);
	}
	return keys;
}

function withinFieldLength(field: SeoAdminTemplateField, value: string): boolean {
	return value.length <= METADATA_TEMPLATE_FIELD_MAX_LENGTH[field];
}

/**
 * An override is valid only as exactly the four strings a save stores, each
 * already in its validated form, so writing it back never changes it.
 */
function storedOverride(collection: string, value: unknown): SeoAdminTemplateValues | null {
	const source = plain(value);
	if (!source || boundedKeys(source, METADATA_TEMPLATE_FIELDS.length)?.length !== METADATA_TEMPLATE_FIELDS.length) return null;
	if (!METADATA_TEMPLATE_FIELDS.every((field) => typeof source[field] === "string" && withinFieldLength(field, source[field] as string))) {
		return null;
	}
	const validation = validateSeoAdminTemplateValues(source, collection);
	if (!validation.success) return null;
	if (!METADATA_TEMPLATE_FIELDS.every((field) => validation.values[field] === source[field])) return null;
	return source as unknown as SeoAdminTemplateValues;
}

function tokenMap(value: unknown): Record<string, string | null> | null {
	const source = plain(value);
	const keys = source ? boundedKeys(source, MAX_TOKEN_ENTRIES) : null;
	if (!source || !keys) return null;
	const tokens: Record<string, string | null> = {};
	for (const key of keys) {
		const token = source[key];
		if (!isSeoContentCollectionKey(key) || (token !== null && !validToken(token))) return null;
		tokens[key] = token;
	}
	return tokens;
}

/** Strict decoding of a stored record; anything else is kept as corrupt. */
export function decodeMetadataTemplatesRecord(
	value: unknown,
): { ok: true; record: MetadataTemplatesRecord } | { ok: false; reason: MetadataTemplatesCorruptReason; detail: string } {
	const source = plain(value);
	if (!source) return corrupt("not-object", "The stored templates are not an object.");
	if (source.version !== SEO_ADMIN_TEMPLATES_STORAGE_VERSION) {
		return corrupt("unsupported-version", "The stored templates have an unsupported version.");
	}
	const fields = boundedKeys(source, RECORD_FIELDS.length);
	if (
		!fields ||
		fields.some((key) => !RECORD_FIELDS.includes(key)) ||
		!Object.hasOwn(source, "updatedAt") ||
		!Object.hasOwn(source, "values")
	) {
		return corrupt("unexpected-fields", "The stored templates have missing or unexpected fields.");
	}
	if (!validToken(source.updatedAt)) return corrupt("invalid-tokens", "The stored templates have an invalid update token.");
	const values = plain(source.values);
	if (!values) return corrupt("invalid-values", "The stored template values are not an object.");
	const collections = boundedKeys(values, METADATA_TEMPLATES_MAX_COLLECTIONS);
	if (!collections) {
		return corrupt("invalid-values", `The stored templates list more than ${METADATA_TEMPLATES_MAX_COLLECTIONS} content types.`);
	}
	const decoded: Record<string, SeoAdminTemplateValues> = {};
	for (const collection of collections) {
		const override = isSeoContentCollectionKey(collection) ? storedOverride(collection, values[collection]) : null;
		if (!override) return corrupt("invalid-values", `The stored template for ${collection.slice(0, 64)} is invalid.`);
		decoded[collection] = { ...override };
	}
	const record: MetadataTemplatesRecord = {
		version: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
		updatedAt: source.updatedAt,
		values: decoded,
	};
	if (Object.hasOwn(source, "fallbackScoreRevision")) {
		const fallback = source.fallbackScoreRevision;
		if (fallback !== null && !validToken(fallback)) {
			return corrupt("invalid-tokens", "The stored templates have an invalid fallback token.");
		}
		record.fallbackScoreRevision = fallback;
	}
	if (Object.hasOwn(source, "collectionUpdatedAt")) {
		const tokens = tokenMap(source.collectionUpdatedAt);
		if (!tokens) return corrupt("invalid-tokens", "The stored templates have invalid score tokens.");
		record.collectionUpdatedAt = tokens;
	}
	if (collections.length === 0 && !record.collectionUpdatedAt) {
		return corrupt("invalid-values", "The stored templates have no overrides and no score tokens.");
	}
	return { ok: true, record };
}

/**
 * Reads the record without creating one. A present value that is not a valid
 * record is corrupt with its revision; a missing versioned API, a thrown read
 * (unparsable JSON included) or a malformed revision envelope is unavailable.
 */
export async function readMetadataTemplates(kv: MetadataTemplatesStorage | null | undefined): Promise<MetadataTemplatesSnapshot> {
	if (typeof kv?.getVersioned !== "function") return { state: "unavailable", revision: null };
	let stored: unknown;
	try {
		stored = await kv.getVersioned(METADATA_TEMPLATES_KEY);
	} catch {
		return { state: "unavailable", revision: null };
	}
	if (stored === null || stored === undefined) return { state: "absent", revision: null };
	const envelope = plain(stored);
	if (!envelope || !Object.hasOwn(envelope, "value") || !validRevision(envelope.revision)) {
		return { state: "unavailable", revision: null };
	}
	const decoded = decodeMetadataTemplatesRecord(envelope.value);
	return decoded.ok
		? { state: "saved", revision: envelope.revision, record: decoded.record }
		: { state: "corrupt", revision: envelope.revision, reason: decoded.reason, detail: decoded.detail };
}

// ---------------------------------------------------------------------------
// Score tokens
// ---------------------------------------------------------------------------

export interface MetadataTemplateTokens {
	revisions: Record<string, string | null>;
	fallback: string | null;
}

export function recordTokens(record: MetadataTemplatesRecord): MetadataTemplateTokens {
	return {
		revisions: record.collectionUpdatedAt ?? {},
		fallback: Object.hasOwn(record, "fallbackScoreRevision") ? (record.fallbackScoreRevision as string | null) : record.updatedAt,
	};
}

/**
 * The legacy revision map as earlier versions read it: an unreadable shape
 * counts as empty, and keys that are not content type keys never decide a
 * token. A readable map beyond the record's limits is refused rather than
 * shortened, since dropping an entry would change that collection's token.
 */
export function legacyRevisionTokens(value: unknown): Record<string, string | null> | null {
	const source = plain(plain(value)?.collectionUpdatedAt);
	if (!source) return {};
	const tokens: Record<string, string | null> = {};
	let count = 0;
	for (const key in source) {
		if (!Object.hasOwn(source, key)) continue;
		count += 1;
		if (count > MAX_TOKEN_ENTRIES) return null;
		const token = source[key];
		if (token !== null && typeof token !== "string") return {};
		if (typeof token === "string" && token.length > TOKEN_MAX_LENGTH) return null;
		if (isSeoContentCollectionKey(key)) tokens[key] = token;
	}
	return tokens;
}

/** Null when the legacy map cannot be carried into a record exactly. */
export function absentTokens(legacyRevisions: unknown): MetadataTemplateTokens | null {
	const revisions = legacyRevisionTokens(legacyRevisions);
	return revisions ? { revisions, fallback: null } : null;
}

export function scoreTokenFor(tokens: MetadataTemplateTokens, collection: string): string | null {
	return Object.hasOwn(tokens.revisions, collection) ? tokens.revisions[collection] : tokens.fallback;
}

/**
 * Scores compare tokens for equality, so a write in the same millisecond as an
 * earlier one must still get a later, distinct token.
 */
export function nextMetadataTemplateToken(tokens: MetadataTemplateTokens, nowMs: number): string {
	const latest = [tokens.fallback, ...Object.values(tokens.revisions)]
		.map((token) => (token ? Date.parse(token) : Number.NaN))
		.filter(Number.isFinite)
		.reduce((max, time) => Math.max(max, time), Number.NEGATIVE_INFINITY);
	return new Date(Math.max(nowMs, latest + 1)).toISOString();
}

// ---------------------------------------------------------------------------
// Inheritance
// ---------------------------------------------------------------------------

export type MetadataTemplateLegacyFields = Record<SeoAdminTemplateField, unknown>;

/**
 * KV revisions of the legacy rows an inheritance decision depends on, as the
 * editor loaded them: the four `tpl:*` keys of one collection and, while no
 * record exists, the legacy score-token row. Every `kv.set` gives a row a new
 * revision, so an equal value written again still changes its guard.
 */
export interface MetadataTemplateInheritanceGuard {
	fields: Record<SeoAdminTemplateField, string | null>;
	revisions?: string | null;
}

export interface MetadataTemplateLegacyObservation {
	fields: MetadataTemplateLegacyFields;
	guard: MetadataTemplateInheritanceGuard;
}

export interface InheritedMetadataTemplate {
	source: "legacy" | "default";
	values: SeoAdminTemplateValues;
	/** Legacy fields that are present but invalid; their defaults apply and their bytes stay. */
	ignoredLegacyFields: SeoAdminTemplateField[];
}

export function defaultMetadataTemplate(collection: string): SeoAdminTemplateValues {
	return { ...(DEFAULT_TEMPLATES[collection] ?? DEFAULT_TEMPLATES.pages) };
}

async function versionedRow(kv: MetadataTemplatesStorage, key: string): Promise<{ value: unknown; revision: string | null }> {
	const stored = await kv.getVersioned!(key);
	if (stored === null || stored === undefined) return { value: null, revision: null };
	const envelope = plain(stored);
	if (!envelope || !Object.hasOwn(envelope, "value") || !validRevision(envelope.revision)) {
		throw new Error("Plugin storage returned an invalid revision.");
	}
	return { value: envelope.value, revision: envelope.revision };
}

/** One collection's legacy keys with their revisions; throws when they cannot be read. */
export async function observeLegacyTemplate(
	kv: MetadataTemplatesStorage | null | undefined,
	collection: string,
): Promise<MetadataTemplateLegacyObservation> {
	if (typeof kv?.getVersioned !== "function") throw new Error("Plugin storage cannot be read with revisions.");
	const fields = {} as MetadataTemplateLegacyFields;
	const revisions = {} as Record<SeoAdminTemplateField, string | null>;
	for (const field of METADATA_TEMPLATE_FIELDS) {
		const row = await versionedRow(kv, legacyTemplateKey(collection, field));
		fields[field] = row.value;
		revisions[field] = row.revision;
	}
	return { fields, guard: { fields: revisions } };
}

export async function readLegacyTemplateFields(
	kv: MetadataTemplatesStorage | null | undefined,
	collection: string,
): Promise<MetadataTemplateLegacyFields> {
	return (await observeLegacyTemplate(kv, collection)).fields;
}

/** The legacy score-token row with its revision, used only while no record exists. */
export async function observeLegacyRevisions(
	kv: MetadataTemplatesStorage | null | undefined,
): Promise<{ value: unknown; revision: string | null }> {
	if (typeof kv?.getVersioned !== "function") throw new Error("Plugin storage cannot be read with revisions.");
	return versionedRow(kv, LEGACY_TEMPLATE_REVISIONS_KEY);
}

export function inheritedMetadataTemplate(
	collection: string,
	legacy: MetadataTemplateLegacyFields,
): InheritedMetadataTemplate {
	const defaults = defaultMetadataTemplate(collection);
	const present = METADATA_TEMPLATE_FIELDS.filter((field) => typeof legacy[field] === "string");
	if (!present.length) return { source: "default", values: defaults, ignoredLegacyFields: [] };
	// Oversized strings are ignored before validation trims or scans them.
	const ignored = present.filter((field) => !withinFieldLength(field, legacy[field] as string));
	const merged: SeoAdminTemplateValues = { ...defaults };
	for (const field of present) if (!ignored.includes(field)) merged[field] = legacy[field] as string;
	const first = validateSeoAdminTemplateValues(merged, collection);
	if (!first.success) {
		for (const field of present) {
			if (!ignored.includes(field) && first.errors[`${collection}.${field}`] !== undefined) {
				ignored.push(field);
				merged[field] = defaults[field];
			}
		}
	}
	const second = first.success ? first : validateSeoAdminTemplateValues(merged, collection);
	if (!second.success) return { source: "default", values: defaults, ignoredLegacyFields: present };
	return {
		source: ignored.length === present.length ? "default" : "legacy",
		values: second.values,
		ignoredLegacyFields: METADATA_TEMPLATE_FIELDS.filter((field) => ignored.includes(field)),
	};
}

export function metadataTemplateValuesEqual(left: SeoAdminTemplateValues, right: SeoAdminTemplateValues): boolean {
	return METADATA_TEMPLATE_FIELDS.every((field) => left[field] === right[field]);
}

function parseInheritanceGuard(value: unknown): MetadataTemplateInheritanceGuard | null {
	const source = plain(value);
	const fields = plain(source?.fields);
	if (!source || !fields || Object.keys(fields).length !== METADATA_TEMPLATE_FIELDS.length) return null;
	if (Object.keys(source).some((key) => key !== "fields" && key !== "revisions")) return null;
	const guard: MetadataTemplateInheritanceGuard = { fields: {} as Record<SeoAdminTemplateField, string | null> };
	for (const field of METADATA_TEMPLATE_FIELDS) {
		const revision = fields[field];
		if (!Object.hasOwn(fields, field) || (revision !== null && !validRevision(revision))) return null;
		guard.fields[field] = revision as string | null;
	}
	if (Object.hasOwn(source, "revisions")) {
		if (source.revisions !== null && !validRevision(source.revisions)) return null;
		guard.revisions = source.revisions as string | null;
	}
	return guard;
}

function sameFieldGuards(left: MetadataTemplateInheritanceGuard, right: MetadataTemplateInheritanceGuard): boolean {
	return METADATA_TEMPLATE_FIELDS.every((field) => left.fields[field] === right.fields[field]);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface MetadataTemplatesHost {
	kv: MetadataTemplatesStorage | null | undefined;
	/** Visible template targets, or null when content type discovery is unavailable. */
	targets(): Promise<readonly string[] | null>;
	now(): number;
}

export type MetadataTemplateCommandFailure =
	| "invalid_input"
	| "collection_unavailable"
	| "conflict"
	| "corrupt"
	| "unavailable"
	| "unconfirmed";

export type MetadataTemplateCommandResult =
	| { success: true; changed: boolean; collection: string; revision: string | null }
	| { success: false; error: "invalid_values"; errors: SeoAdminTemplateErrors }
	| { success: false; error: MetadataTemplateCommandFailure; message: string };

export const METADATA_TEMPLATE_MESSAGES = Object.freeze({
	conflict: "The templates changed after you loaded them. Nothing was saved. Your edits are kept; review the saved values first.",
	unconfirmed: "The change could not be confirmed. It may or may not have been saved. Reload the templates before changing them again.",
	corrupt: "The stored templates are invalid, so they cannot be changed here. Nothing was saved.",
	unavailable: "The templates could not be read. Nothing was saved.",
	unsupported: "This EmDash version does not provide revision-checked plugin storage. Nothing was saved.",
	discovery: "Content types are unavailable. Nothing was saved; retry after EmDash restores collection discovery.",
	collection: "This content type is not an SEO template target. Nothing was saved.",
	input: "The content type, loaded revision or inheritance guard is invalid. Nothing was saved.",
	limit: `The templates would exceed their limits (${METADATA_TEMPLATES_MAX_COLLECTIONS} content types, ${MAX_TOKEN_ENTRIES.toLocaleString("en-US")} score tokens, 1 MiB). Nothing was saved.`,
	legacyTokens: "The score tokens left by an earlier version are too large to keep exactly. Nothing was saved.",
});

function failure(error: MetadataTemplateCommandFailure, message: string) {
	return { success: false as const, error, message };
}

function parseCommandInput(input: unknown):
	| {
		ok: true;
		collection: string;
		expectedRevision: string | null;
		guard: MetadataTemplateInheritanceGuard;
		source: Record<string, unknown>;
	}
	| { ok: false } {
	const source = plain(input);
	const collection = source?.collection;
	const expectedRevision = source?.expectedRevision;
	if (!source || typeof collection !== "string" || !isSeoContentCollectionKey(collection)) return { ok: false };
	if (expectedRevision !== null && !validRevision(expectedRevision)) return { ok: false };
	const guard = parseInheritanceGuard(source.inheritanceGuard);
	if (!guard) return { ok: false };
	return { ok: true, collection, expectedRevision, guard, source };
}

type GuardedState =
	| { ok: true; snapshot: Extract<MetadataTemplatesSnapshot, { state: "absent" | "saved" }> }
	| { ok: false; result: MetadataTemplateCommandResult };

async function guardedState(
	host: MetadataTemplatesHost,
	collection: string,
	expectedRevision: string | null,
): Promise<GuardedState> {
	const kv = host.kv;
	if (typeof kv?.getVersioned !== "function" || typeof kv.compareAndSet !== "function") {
		return { ok: false, result: failure("unavailable", METADATA_TEMPLATE_MESSAGES.unsupported) };
	}
	let targets: readonly string[] | null;
	try {
		targets = await host.targets();
	} catch {
		targets = null;
	}
	if (!targets) return { ok: false, result: failure("unavailable", METADATA_TEMPLATE_MESSAGES.discovery) };
	if (!targets.includes(collection)) return { ok: false, result: failure("collection_unavailable", METADATA_TEMPLATE_MESSAGES.collection) };
	const snapshot = await readMetadataTemplates(kv);
	if (snapshot.state === "unavailable") return { ok: false, result: failure("unavailable", METADATA_TEMPLATE_MESSAGES.unavailable) };
	if (snapshot.state === "corrupt") return { ok: false, result: failure("corrupt", METADATA_TEMPLATE_MESSAGES.corrupt) };
	if (snapshot.revision !== expectedRevision) return { ok: false, result: failure("conflict", METADATA_TEMPLATE_MESSAGES.conflict) };
	return { ok: true, snapshot };
}

/**
 * The legacy rows a decision depends on: the collection's four keys when it
 * inherits or is reset, and the legacy score-token row while no record
 * exists. They must still carry the revisions the editor loaded, both before
 * the decision and just before the conditional write; a legacy write between
 * that last check and the write is not guarded.
 */
interface InheritanceDependency {
	fields: boolean;
	revisions: boolean;
}

async function observedInheritance(
	kv: MetadataTemplatesStorage,
	collection: string,
	dependency: InheritanceDependency,
	loaded: MetadataTemplateInheritanceGuard,
): Promise<{ ok: true; fields: MetadataTemplateLegacyFields | null; revisions: unknown } | { ok: false }> {
	let fields: MetadataTemplateLegacyFields | null = null;
	let revisions: unknown = null;
	if (dependency.fields) {
		const observation = await observeLegacyTemplate(kv, collection);
		if (!sameFieldGuards(observation.guard, loaded)) return { ok: false };
		fields = observation.fields;
	}
	if (dependency.revisions) {
		if (!Object.hasOwn(loaded, "revisions")) return { ok: false };
		const row = await observeLegacyRevisions(kv);
		if (row.revision !== loaded.revisions) return { ok: false };
		revisions = row.value;
	}
	return { ok: true, fields, revisions };
}

async function conditionalWrite(
	kv: MetadataTemplatesStorage,
	expectedRevision: string | null,
	next: MetadataTemplatesRecord,
	collection: string,
	dependency: InheritanceDependency,
	loaded: MetadataTemplateInheritanceGuard,
): Promise<MetadataTemplateCommandResult> {
	// Never write a record that a later read would treat as corrupt or the host would refuse.
	if (!decodeMetadataTemplatesRecord(next).ok || jsonUtf8LengthWithin(next, METADATA_TEMPLATES_MAX_RECORD_BYTES) === null) {
		return failure("invalid_input", METADATA_TEMPLATE_MESSAGES.limit);
	}
	try {
		if (!(await observedInheritance(kv, collection, dependency, loaded)).ok) {
			return failure("conflict", METADATA_TEMPLATE_MESSAGES.conflict);
		}
	} catch {
		return failure("unavailable", METADATA_TEMPLATE_MESSAGES.unavailable);
	}
	let result: unknown;
	try {
		result = await kv.compareAndSet!(METADATA_TEMPLATES_KEY, expectedRevision, next);
	} catch {
		return failure("unconfirmed", METADATA_TEMPLATE_MESSAGES.unconfirmed);
	}
	const written = plain(result);
	if (written?.applied === false) return failure("conflict", METADATA_TEMPLATE_MESSAGES.conflict);
	if (written?.applied !== true || !validRevision(written.revision)) return failure("unconfirmed", METADATA_TEMPLATE_MESSAGES.unconfirmed);
	return { success: true, changed: true, collection, revision: written.revision };
}

/**
 * Stores one collection's values as its explicit override. Values equal to
 * the ones in effect, inherited or not, write nothing, so a save never pins
 * inherited values. Unselected collections keep their values and tokens.
 */
export async function saveMetadataTemplate(host: MetadataTemplatesHost, input: unknown): Promise<MetadataTemplateCommandResult> {
	const parsed = parseCommandInput(input);
	if (!parsed.ok) return failure("invalid_input", METADATA_TEMPLATE_MESSAGES.input);
	const { collection, expectedRevision, guard } = parsed;
	const validation = validateSeoAdminTemplateValues(parsed.source.values, collection);
	if (!validation.success) return { success: false, error: "invalid_values", errors: validation.errors };
	const submitted = validation.values;

	let guarded: GuardedState;
	let dependency: InheritanceDependency;
	let observed: Awaited<ReturnType<typeof observedInheritance>>;
	try {
		guarded = await guardedState(host, collection, expectedRevision);
		if (!guarded.ok) return guarded.result;
		const snapshot = guarded.snapshot;
		dependency = {
			fields: snapshot.state === "absent" || !snapshot.record.values[collection],
			revisions: snapshot.state === "absent",
		};
		observed = await observedInheritance(host.kv!, collection, dependency, guard);
	} catch {
		return failure("unavailable", METADATA_TEMPLATE_MESSAGES.unavailable);
	}
	if (!observed.ok) return failure("conflict", METADATA_TEMPLATE_MESSAGES.conflict);
	const snapshot = guarded.snapshot;
	const current = observed.fields
		? inheritedMetadataTemplate(collection, observed.fields).values
		: (snapshot as Extract<MetadataTemplatesSnapshot, { state: "saved" }>).record.values[collection];
	if (metadataTemplateValuesEqual(current, submitted)) {
		return { success: true, changed: false, collection, revision: snapshot.revision };
	}
	let next: MetadataTemplatesRecord;
	if (snapshot.state === "saved") {
		const record = snapshot.record;
		const token = nextMetadataTemplateToken(recordTokens(record), host.now());
		next = {
			...record,
			values: { ...record.values, [collection]: submitted },
			collectionUpdatedAt: { ...(record.collectionUpdatedAt ?? {}), [collection]: token },
		};
	} else {
		const tokens = absentTokens(observed.revisions);
		if (!tokens) return failure("unavailable", METADATA_TEMPLATE_MESSAGES.legacyTokens);
		const token = nextMetadataTemplateToken(tokens, host.now());
		next = {
			version: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
			updatedAt: token,
			fallbackScoreRevision: null,
			values: { [collection]: submitted },
			collectionUpdatedAt: { ...tokens.revisions, [collection]: token },
		};
	}
	return conditionalWrite(host.kv!, expectedRevision, next, collection, dependency, guard);
}

/**
 * Removes one collection's explicit override so it inherits its readable
 * legacy value or the default the editor reviewed. The token advances only
 * when the inherited values differ; the record is kept even with no
 * overrides left.
 */
export async function resetMetadataTemplate(host: MetadataTemplatesHost, input: unknown): Promise<MetadataTemplateCommandResult> {
	const parsed = parseCommandInput(input);
	if (!parsed.ok) return failure("invalid_input", METADATA_TEMPLATE_MESSAGES.input);
	const { collection, expectedRevision, guard } = parsed;
	const dependency: InheritanceDependency = { fields: true, revisions: false };
	let guarded: GuardedState;
	let observed: Awaited<ReturnType<typeof observedInheritance>>;
	try {
		guarded = await guardedState(host, collection, expectedRevision);
		if (!guarded.ok) return guarded.result;
		if (guarded.snapshot.state === "absent" || !guarded.snapshot.record.values[collection]) {
			return { success: true, changed: false, collection, revision: guarded.snapshot.revision };
		}
		observed = await observedInheritance(host.kv!, collection, dependency, guard);
	} catch {
		return failure("unavailable", METADATA_TEMPLATE_MESSAGES.unavailable);
	}
	if (!observed.ok || !observed.fields) return failure("conflict", METADATA_TEMPLATE_MESSAGES.conflict);
	const inherited = inheritedMetadataTemplate(collection, observed.fields);
	const record = (guarded.snapshot as Extract<MetadataTemplatesSnapshot, { state: "saved" }>).record;
	const override = record.values[collection];
	const values = { ...record.values };
	delete values[collection];
	const collectionUpdatedAt = { ...(record.collectionUpdatedAt ?? {}) };
	if (!metadataTemplateValuesEqual(override, inherited.values)) {
		collectionUpdatedAt[collection] = nextMetadataTemplateToken(recordTokens(record), host.now());
	}
	const next: MetadataTemplatesRecord = { ...record, values, collectionUpdatedAt };
	return conditionalWrite(host.kv!, expectedRevision, next, collection, dependency, guard);
}

// ---------------------------------------------------------------------------
// Portability (templates key only)
// ---------------------------------------------------------------------------

/** The record as the portability snapshot observed it, with its KV revision. */
export interface BoundMetadataTemplates {
	revision: string | null;
	value: unknown;
}

export type PortabilityTemplatesWrite =
	| { status: "unchanged" }
	| { status: "written"; revision: string; value: MetadataTemplatesRecord }
	| { status: "refused"; reason: "corrupt" | "unavailable" | "conflict" | "unconfirmed" };

/**
 * Replaces the overrides with an imported set, built from the bound snapshot
 * and written only under its revision, never one read later. Tokens advance
 * only for collections whose effective values change; every other token and
 * the fallback stay exactly as stored.
 */
export async function writePortabilityTemplates(
	kv: MetadataTemplatesStorage | null | undefined,
	bound: BoundMetadataTemplates,
	nextValues: Record<string, SeoAdminTemplateValues>,
	legacyFor: (collection: string) => Promise<MetadataTemplateLegacyFields>,
	legacyRevisions: unknown,
	nowMs: number,
): Promise<PortabilityTemplatesWrite> {
	if (typeof kv?.compareAndSet !== "function") return { status: "refused", reason: "unavailable" };
	let previous: MetadataTemplatesRecord | null = null;
	if (bound.revision !== null) {
		const decoded = decodeMetadataTemplatesRecord(bound.value);
		if (!decoded.ok) return { status: "refused", reason: "corrupt" };
		previous = decoded.record;
	} else if (bound.value !== null && bound.value !== undefined) {
		return { status: "refused", reason: "unavailable" };
	}
	const tokens = previous ? recordTokens(previous) : absentTokens(legacyRevisions);
	if (!tokens) return { status: "refused", reason: "unavailable" };
	const before = previous?.values ?? {};
	const token = nextMetadataTemplateToken(tokens, nowMs);
	const collectionUpdatedAt = previous ? { ...(previous.collectionUpdatedAt ?? {}) } : { ...tokens.revisions };
	let changed = false;
	for (const collection of new Set([...Object.keys(before), ...Object.keys(nextValues)])) {
		const old = before[collection];
		const updated = nextValues[collection];
		if (old && updated && metadataTemplateValuesEqual(old, updated)) continue;
		changed = true;
		const inherited = !old || !updated ? inheritedMetadataTemplate(collection, await legacyFor(collection)).values : null;
		if (!metadataTemplateValuesEqual(old ?? inherited!, updated ?? inherited!)) collectionUpdatedAt[collection] = token;
	}
	if (!changed) return { status: "unchanged" };
	const values = Object.fromEntries(Object.entries(nextValues).map(([collection, value]) => [collection, { ...value }]));
	const next: MetadataTemplatesRecord = previous
		? { ...previous, values, collectionUpdatedAt }
		: {
			version: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
			updatedAt: token,
			fallbackScoreRevision: null,
			values,
			collectionUpdatedAt,
		};
	if (!decodeMetadataTemplatesRecord(next).ok || jsonUtf8LengthWithin(next, METADATA_TEMPLATES_MAX_RECORD_BYTES) === null) {
		return { status: "refused", reason: "corrupt" };
	}
	let result: unknown;
	try {
		result = await kv.compareAndSet(METADATA_TEMPLATES_KEY, bound.revision, next);
	} catch {
		return { status: "refused", reason: "unconfirmed" };
	}
	const written = plain(result);
	if (written?.applied === false) return { status: "refused", reason: "conflict" };
	if (written?.applied !== true || !validRevision(written.revision)) return { status: "refused", reason: "unconfirmed" };
	return { status: "written", revision: written.revision, value: next };
}

export type PortabilityTemplatesRollback = "restored" | "conflict" | "unconfirmed" | "unavailable";

/**
 * Undoes only the import's own write: the revision that write returned must
 * still be current. A later revision with equal values is someone else's
 * write and is preserved.
 */
export async function rollbackPortabilityTemplates(
	kv: MetadataTemplatesStorage | null | undefined,
	writtenRevision: string,
	prior: BoundMetadataTemplates,
): Promise<PortabilityTemplatesRollback> {
	const restoreAbsence = prior.revision === null;
	if (restoreAbsence ? typeof kv?.compareAndDelete !== "function" : typeof kv?.compareAndSet !== "function") return "unavailable";
	let result: unknown;
	try {
		result = restoreAbsence
			? await kv!.compareAndDelete!(METADATA_TEMPLATES_KEY, writtenRevision)
			: await kv!.compareAndSet!(METADATA_TEMPLATES_KEY, writtenRevision, prior.value);
	} catch {
		return "unconfirmed";
	}
	const outcome = plain(result);
	if (outcome?.applied === true) return "restored";
	return outcome?.applied === false ? "conflict" : "unconfirmed";
}
