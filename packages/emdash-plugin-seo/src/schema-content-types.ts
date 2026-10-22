// The content type schema mapping: one KV record holding the roles that
// differ from the defaults. Every write compares the revision the editor
// loaded, so a save or reset never replaces a change made elsewhere. An
// unreadable record is reported, never merged into, and replaced only on
// request. A write whose outcome is unknown is reported as unconfirmed and
// settled by reading the record again, never by repeating it.
// No React, DOM or Node dependencies.

import {
	SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	SEO_SCHEMA_CONTENT_TYPE_LIST_LIMIT,
	validateSeoAdminSchemaContentTypeValues,
	type SeoAdminSchemaContentTypeConfiguration,
	type SeoAdminSchemaContentTypeErrors,
	type SeoAdminSchemaContentTypeValues,
	type SeoAdminSchemaContentTypesCheck,
	type SeoAdminSchemaContentTypesReadResult,
	type SeoAdminSchemaContentTypesSaveResult,
	type SeoAdminSchemaContentTypesWriteError,
} from "./admin-contract.ts";
import {
	SCHEMA_CONTENT_TYPES_SETTINGS_KEY,
	storedSchemaContentTypesRecord,
	type StoredSeoAdminSchemaContentTypes,
} from "./entry-analysis-runtime.ts";
import { defaultSchemaContentTypeRole, schemaContentTypeRole } from "./lib.ts";

const MAX_REVISION_LENGTH = 128;

/** The subset of host KV these commands use; the versioned methods may be missing on older hosts. */
export interface SchemaContentTypesKv {
	get<T>(key: string): Promise<T | null | undefined>;
	getVersioned?<T>(key: string): Promise<{ value: T; revision: string } | null>;
	compareAndSet?(
		key: string,
		expectedRevision: string | null,
		value: unknown,
	): Promise<{ applied: true; revision: string } | { applied: false }>;
	compareAndDelete?(key: string, expectedRevision: string): Promise<{ applied: boolean }>;
}

export interface SchemaContentTypesHost {
	kv: SchemaContentTypesKv;
	/** Public, non-hidden, routable content types, in host order. */
	discover(): Promise<{ available: boolean; definitions: readonly { collection: string; label: string }[] }>;
	now(): string;
}

export type SchemaContentTypesRecordState =
	| { state: "absent"; revision: null }
	| { state: "valid"; revision: string | null; record: StoredSeoAdminSchemaContentTypes }
	| { state: "invalid"; revision: string | null };

type VersionedKv = Required<SchemaContentTypesKv>;

function versioned(kv: SchemaContentTypesKv): kv is VersionedKv {
	return (
		typeof kv.getVersioned === "function" &&
		typeof kv.compareAndSet === "function" &&
		typeof kv.compareAndDelete === "function"
	);
}

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_REVISION_LENGTH;
}

function classify(value: unknown, revision: string | null): SchemaContentTypesRecordState {
	if (value === null || value === undefined) {
		return revision === null ? { state: "absent", revision: null } : { state: "invalid", revision };
	}
	const record = storedSchemaContentTypesRecord(value);
	return record ? { state: "valid", revision, record } : { state: "invalid", revision };
}

/** Throws when storage cannot be read; a stored JSON null with a revision is invalid, not absent. */
export async function readSchemaContentTypesRecord(host: SchemaContentTypesHost): Promise<SchemaContentTypesRecordState> {
	if (!versioned(host.kv)) return classify(await host.kv.get<unknown>(SCHEMA_CONTENT_TYPES_SETTINGS_KEY), null);
	const stored = await host.kv.getVersioned<unknown>(SCHEMA_CONTENT_TYPES_SETTINGS_KEY);
	if (!stored) return { state: "absent", revision: null };
	if (!validRevision(stored.revision)) throw new Error("schema_content_types_invalid_revision");
	return classify(stored.value, stored.revision);
}

export async function buildSchemaContentTypeConfiguration(
	host: SchemaContentTypesHost,
	known?: SchemaContentTypesRecordState,
): Promise<SeoAdminSchemaContentTypeConfiguration> {
	const [state, source] = await Promise.all([known ?? readSchemaContentTypesRecord(host), host.discover()]);
	const values = state.state === "valid" ? state.record.values : {};
	const listed = source.available ? source.definitions.slice(0, SEO_SCHEMA_CONTENT_TYPE_LIST_LIMIT) : [];
	const listedKeys = new Set(listed.map((definition) => definition.collection));
	return {
		storageVersion: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
		updatedAt: state.state === "valid" ? state.record.updatedAt : null,
		revision: state.revision,
		record: state.state,
		writable: versioned(host.kv),
		discoveryAvailable: source.available,
		discoveredCount: source.available ? source.definitions.length : 0,
		items: listed.map((definition) => ({
			collection: definition.collection,
			label: definition.label,
			role: schemaContentTypeRole(definition.collection, values),
			source: Object.prototype.hasOwnProperty.call(values, definition.collection) ? "saved" : "default",
		})),
		// The validator caps stored values at 100, so this list is bounded too.
		unlisted: Object.entries(values)
			.filter(([collection]) => !listedKeys.has(collection))
			.map(([collection, role]) => ({ collection, role })),
	};
}

function failure(
	error: SeoAdminSchemaContentTypesWriteError,
	message: string | SeoAdminSchemaContentTypeErrors,
	current?: SeoAdminSchemaContentTypeConfiguration,
): SeoAdminSchemaContentTypesSaveResult {
	return {
		success: false,
		error,
		errors: typeof message === "string" ? { _form: message } : message,
		...(current ? { current } : {}),
	};
}

const UNCONFIRMED = "The change could not be confirmed. Check the current state before trying again.";
const UNWRITABLE = "This site's storage cannot guard against replacing another change, so the mapping cannot be changed here.";
const UNREADABLE = "The saved mapping could not be read. Nothing was changed.";
const CHANGED = "The mapping changed after you opened it. Nothing was saved.";

async function currentOrUndefined(host: SchemaContentTypesHost): Promise<SeoAdminSchemaContentTypeConfiguration | undefined> {
	try {
		return await buildSchemaContentTypeConfiguration(host);
	} catch {
		return undefined;
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Roles that differ from the defaults; default roles are never stored. */
function storedRoles(values: SeoAdminSchemaContentTypeValues): SeoAdminSchemaContentTypeValues {
	return Object.fromEntries(
		Object.entries(values).filter(([collection, role]) => role !== defaultSchemaContentTypeRole(collection)),
	);
}

export async function saveSchemaContentTypes(
	host: SchemaContentTypesHost,
	input: unknown,
): Promise<SeoAdminSchemaContentTypesSaveResult> {
	const source = record(input);
	const expectedRevision = source?.expectedRevision;
	if (!source || !record(source.values) || (expectedRevision !== null && !validRevision(expectedRevision))) {
		return failure("invalid", "Send the mapping with the revision it was loaded from.");
	}
	const replaceInvalid = source.replaceInvalid === true;
	if (!versioned(host.kv)) return failure("unavailable", UNWRITABLE);

	const discovery = await host.discover();
	if (!discovery.available) {
		return failure(
			"unavailable",
			"This site could not list its content types, so the mapping was not changed. The saved mapping, or the defaults when none is saved, stays in place.",
		);
	}
	const validation = validateSeoAdminSchemaContentTypeValues(
		source.values,
		discovery.definitions.map((definition) => definition.collection),
	);
	if (!validation.success) return failure("invalid", validation.errors);

	let state: SchemaContentTypesRecordState;
	try {
		state = await readSchemaContentTypesRecord(host);
	} catch {
		return failure("unavailable", UNREADABLE);
	}
	if (state.revision !== expectedRevision) {
		return failure("conflict", CHANGED, await buildSchemaContentTypeConfiguration(host, state));
	}
	if (state.state === "invalid" && !replaceInvalid) {
		return failure(
			"invalid_stored",
			"The saved mapping cannot be read. Confirm that saving replaces it.",
			await buildSchemaContentTypeConfiguration(host, state),
		);
	}
	// Roles for content types this list does not show stay stored untouched.
	const next = storedRoles({ ...(state.state === "valid" ? state.record.values : {}), ...validation.values });
	if (Object.keys(next).length > SEO_SCHEMA_CONTENT_TYPE_LIST_LIMIT) {
		return failure("invalid", "Map at most 100 content types.");
	}
	if (state.state === "absent" && !Object.keys(next).length) {
		return { success: true, contentTypes: await buildSchemaContentTypeConfiguration(host, state) };
	}
	const stored: StoredSeoAdminSchemaContentTypes = {
		version: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
		updatedAt: host.now(),
		values: next,
	};
	let written: { applied: true; revision: string } | { applied: false };
	try {
		written = await host.kv.compareAndSet(SCHEMA_CONTENT_TYPES_SETTINGS_KEY, expectedRevision, stored);
	} catch {
		return failure("unconfirmed", UNCONFIRMED);
	}
	if (written.applied && validRevision(written.revision)) {
		return {
			success: true,
			contentTypes: await buildSchemaContentTypeConfiguration(host, {
				state: "valid",
				revision: written.revision,
				record: stored,
			}),
		};
	}
	if (written.applied) return failure("unconfirmed", UNCONFIRMED);
	return failure("conflict", CHANGED, await currentOrUndefined(host));
}

export async function resetSchemaContentTypes(
	host: SchemaContentTypesHost,
	input: unknown,
): Promise<SeoAdminSchemaContentTypesSaveResult> {
	const source = record(input);
	if (!source || source.confirmed !== true || !validRevision(source.expectedRevision)) {
		return failure("invalid", "Confirm restoring the defaults for the mapping you loaded.");
	}
	const expectedRevision = source.expectedRevision;
	if (!versioned(host.kv)) return failure("unavailable", UNWRITABLE);
	let state: SchemaContentTypesRecordState;
	try {
		state = await readSchemaContentTypesRecord(host);
	} catch {
		return failure("unavailable", UNREADABLE);
	}
	if (state.revision !== expectedRevision) {
		return failure("conflict", "The mapping changed after you opened it. The defaults were not restored.", await buildSchemaContentTypeConfiguration(host, state));
	}
	let deleted: { applied: boolean };
	try {
		deleted = await host.kv.compareAndDelete(SCHEMA_CONTENT_TYPES_SETTINGS_KEY, expectedRevision);
	} catch {
		return failure("unconfirmed", UNCONFIRMED);
	}
	if (deleted.applied) {
		return {
			success: true,
			contentTypes: await buildSchemaContentTypeConfiguration(host, { state: "absent", revision: null }),
		};
	}
	return failure("conflict", "The mapping changed after you opened it. The defaults were not restored.", await currentOrUndefined(host));
}

function sameRoles(left: SeoAdminSchemaContentTypeValues, right: SeoAdminSchemaContentTypeValues): boolean {
	const keys = Object.keys(left);
	return keys.length === Object.keys(right).length && keys.every((key) => right[key] === left[key]);
}

/**
 * A replacement of an unreadable record is applied only when the stored roles
 * are exactly the intended replacement; an ordinary save only when every role
 * it named now resolves to that role. An empty save names nothing, so it never
 * counts as applied.
 */
function intendedSaveApplied(
	state: SchemaContentTypesRecordState,
	values: SeoAdminSchemaContentTypeValues,
	replaceInvalid: boolean,
): boolean {
	if (state.state === "invalid") return false;
	const stored = state.state === "valid" ? state.record.values : {};
	if (replaceInvalid) return state.state === "valid" && sameRoles(stored, storedRoles(values));
	const entries = Object.entries(values);
	return entries.length > 0 && entries.every(([collection, role]) => schemaContentTypeRole(collection, stored) === role);
}

/**
 * Reads the mapping once. With `check`, it also compares the stored record
 * with an operation whose outcome was not confirmed. It never writes.
 */
export async function inspectSchemaContentTypes(
	host: SchemaContentTypesHost,
	input: unknown,
): Promise<SeoAdminSchemaContentTypesReadResult> {
	const source = record(input) ?? {};
	const state = await readSchemaContentTypesRecord(host);
	const contentTypes = await buildSchemaContentTypeConfiguration(host, state);
	const check = record(source.check);
	if (!check) return { contentTypes };
	let result: SeoAdminSchemaContentTypesCheck;
	let applied = false;
	if (check.action === "reset") applied = state.state === "absent";
	else if (check.action === "save") {
		const intended = validateSeoAdminSchemaContentTypeValues(check.values);
		applied = intended.success && intendedSaveApplied(state, intended.values, check.replaceInvalid === true);
	}
	if (applied) result = "applied";
	else if (source.expectedRevision !== undefined && state.revision === source.expectedRevision) result = "not_applied";
	else result = "changed";
	return { contentTypes, check: result };
}
