// Native SQLite candidate adapter for internal-link suggestions. It uses the
// host's lazily opened Kysely database and rereads collection, field and
// taxonomy definitions on every call. A page reads one bounded content ID
// window, at most one membership batch and one scalar projection of the
// matched references. It writes nothing and never reads a body, revision,
// data document or count. Identifiers are validated before Kysely quotes
// them; the SQL shape targets native SQLite only.

import {
	LINK_PORT_BUDGETS,
	type LinkCandidatePort,
	type LinkResolvedScope,
	type LinkScopeRequest,
	type LinkScopeResolution,
} from "./internal-link-source.ts";
import {
	LINK_SUGGESTION_LIMITS,
	canonicalLinkLocale,
	type LinkCandidatePage,
	type LinkCandidateProjection,
} from "./internal-link-suggestions.ts";

// The native EmDash 1.1.0 Kysely connection quotes identifiers and binds values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostDatabase = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExpressionBuilder = any;

const COLLECTION_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const TITLE_TYPES: readonly string[] = ["string", "text", "slug"];
const EXCERPT_TYPES: readonly string[] = ["string", "text"];
const TITLE_FALLBACKS: readonly string[] = ["title", "name"];
const EXCERPT_FIELDS: readonly string[] = ["excerpt", "summary", "description"];
// Standard content columns are never editorial text, whatever a definition claims.
const SYSTEM_COLUMNS: ReadonlySet<string> = new Set([
	"id", "slug", "status", "author_id", "primary_byline_id", "created_at", "updated_at", "published_at",
	"scheduled_at", "deleted_at", "version", "live_revision_id", "draft_revision_id", "locale", "translation_group",
]);
// UTF-8 needs at most four bytes per allowed code point; a raw value beyond that is refused, not truncated.
const RAW_BYTES = Object.freeze({
	title: 4 * LINK_SUGGESTION_LIMITS.titleChars,
	excerpt: 4 * LINK_SUGGESTION_LIMITS.excerptChars,
});
// The pivot key (collection, entry_id, taxonomy_id) bounds one batch at 200 x 8 rows.
const MEMBERSHIP_SENTINEL = LINK_PORT_BUDGETS.candidateRows * LINK_SUGGESTION_LIMITS.taxonomyTerms + 1;
const SCOPE_VERSION_PREFIX = "link-scope-v1:sha256-";
const ENTRY_VERSION_PREFIX = "entry-v1:";
const TIMESTAMP_CHARS = 64;

// Keep a 200-row candidate window in one statement without exceeding D1's
// 100-parameter limit. The values stay bound and never become SQL text.
function textIds(db: HostDatabase, ids: readonly string[]): HostDatabase {
	return db.selectFrom((eb: ExpressionBuilder) => eb.fn("json_each", [eb.val(JSON.stringify(ids))]).as("selected_ids"))
		.select("selected_ids.value");
}

function isIdentity(value: unknown, max: number = LINK_SUGGESTION_LIMITS.identityChars): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value &&
		!/[\u0000-\u001f\u007f]/u.test(value);
}

function isCount(value: unknown, min: number, max: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function withinCodePoints(text: string, limit: number): boolean {
	if (text.length <= limit) return true;
	let count = 0;
	for (const _ of text) if (++count > limit) return false;
	return true;
}

function contentTable(collection: string): string {
	if (!COLLECTION_KEY.test(collection)) throw new TypeError("Invalid link candidate collection.");
	return "ec_" + collection;
}

export type LinkCandidatePageRefusalReason = "scope-changed" | "unavailable";

/**
 * A page that cannot answer for the scope it was given. `scope-changed` means
 * fresh definitions no longer match its `scopeVersion`; `unavailable` means a
 * definition, row or membership answer was unreadable. Neither is an empty
 * result, and neither starts a new window.
 */
export class LinkCandidatePageRefusal extends Error {
	readonly reason: LinkCandidatePageRefusalReason;

	constructor(reason: LinkCandidatePageRefusalReason, message: string) {
		super(message);
		this.name = "LinkCandidatePageRefusal";
		this.reason = reason;
	}
}

function unavailable(message: string): never {
	throw new LinkCandidatePageRefusal("unavailable", message);
}

// ---------------------------------------------------------------------------
// Bounded scalar projection, shared with the exact target read

/** One raw editorial column after the host's decoding, before any fallback. */
export type LinkScalar =
	| { kind: "empty" }
	/** A number, a blob, or an object/array the host would decode: never editorial text. */
	| { kind: "not-text" }
	| { kind: "oversized" }
	| { kind: "text"; value: string };

/**
 * Decodes a column projected by `linkEditorialSelections`: its SQLite type or
 * `overflow`, and its text only when within the raw byte bound. Text follows
 * `ContentRepository.deserializeValue`: an untrimmed `{` or `[` prefix is
 * parsed once, a successful parse is not text and malformed JSON stays the
 * raw string. Only then is a string trimmed and measured in code points.
 * Null when the driver answered outside that shape.
 */
export function decodeLinkScalar(kind: unknown, text: unknown, maxCodePoints: number): LinkScalar | null {
	if (kind === "null") return text === null ? { kind: "empty" } : null;
	if (kind === "integer" || kind === "real" || kind === "blob") return text === null ? { kind: "not-text" } : null;
	if (kind === "overflow") return text === null ? { kind: "oversized" } : null;
	if (kind !== "text" || typeof text !== "string") return null;
	if (text.startsWith("{") || text.startsWith("[")) {
		try {
			JSON.parse(text);
			return { kind: "not-text" };
		} catch {
			// Malformed JSON remains the stored string, as in the host.
		}
	}
	const value = text.trim();
	if (value === "") return { kind: "empty" };
	return withinCodePoints(value, maxCodePoints) ? { kind: "text", value } : { kind: "oversized" };
}

export type LinkEditorialText = { kind: "text"; value: string } | { kind: "absent" } | { kind: "refused" };

/**
 * The first usable value in field preference order. Empty and non-text values
 * fall through, as the host's title fallback skips them; an oversized value
 * refuses instead of falling back to a later field.
 */
export function selectLinkEditorialText(values: readonly LinkScalar[]): LinkEditorialText {
	for (const value of values) {
		if (value.kind === "text") return value;
		if (value.kind === "oversized") return { kind: "refused" };
	}
	return { kind: "absent" };
}

/** Validated editorial columns of one collection, never a slug, ID or body. */
export interface LinkEditorialSchema {
	collection: string;
	/** A valid configured title field, then `title`, then `name`: string, text or slug TEXT columns. */
	titleColumns: readonly string[];
	/** Declared `excerpt`, `summary`, then `description`: string or text TEXT columns. */
	excerptColumns: readonly string[];
}

function boundedScalar(eb: ExpressionBuilder, column: string, alias: string, maxBytes: number): unknown[] {
	if (!FIELD_KEY.test(column) || SYSTEM_COLUMNS.has(column)) throw new TypeError("Invalid editorial column.");
	const type = eb.fn("typeof", [column]);
	// Bytes, not characters: SQLite counts text characters only up to the first NUL.
	const bytes = eb.fn("length", [eb.cast(column, "blob")]);
	return [
		eb.case().when(type, "<>", "text").then(type)
			.when(bytes, ">", eb.lit(maxBytes)).then(eb.val("overflow"))
			.else(eb.val("text")).end().as(alias + "_kind"),
		eb.case().when(eb.and([eb(type, "=", "text"), eb(bytes, "<=", eb.lit(maxBytes))]))
			.then(eb.ref(column)).end().as(alias + "_text"),
	];
}

/** Bounded kind/text selection pairs for every editorial column; aliases never carry field names. */
export function linkEditorialSelections(eb: ExpressionBuilder, schema: LinkEditorialSchema): unknown[] {
	return [
		...schema.titleColumns.flatMap((column, index) => boundedScalar(eb, column, "t" + index, RAW_BYTES.title)),
		...schema.excerptColumns.flatMap((column, index) => boundedScalar(eb, column, "e" + index, RAW_BYTES.excerpt)),
	];
}

/** Title and excerpt of one projected row; null when the driver answered outside the selection shape. */
export function linkEditorialText(
	row: Record<string, unknown>,
	schema: LinkEditorialSchema,
): { title: LinkEditorialText; excerpt: LinkEditorialText } | null {
	const select = (prefix: string, count: number, limit: number): LinkEditorialText | null => {
		const values: LinkScalar[] = [];
		for (let index = 0; index < count; index++) {
			const value = decodeLinkScalar(row[prefix + index + "_kind"], row[prefix + index + "_text"], limit);
			if (value === null) return null;
			values.push(value);
		}
		return selectLinkEditorialText(values);
	};
	const title = select("t", schema.titleColumns.length, LINK_SUGGESTION_LIMITS.titleChars);
	const excerpt = select("e", schema.excerptColumns.length, LINK_SUGGESTION_LIMITS.excerptChars);
	return title && excerpt ? { title, excerpt } : null;
}

/**
 * A published row's version identity from its `version` and `updated_at`.
 * Candidate projection and the exact target read compare this same value.
 */
export function linkEntryVersion(version: unknown, updatedAt: unknown): string | null {
	if (!isCount(version, 1, Number.MAX_SAFE_INTEGER) || !isIdentity(updatedAt, TIMESTAMP_CHARS)) return null;
	return ENTRY_VERSION_PREFIX + version + ":" + updatedAt;
}

// ---------------------------------------------------------------------------
// Fresh definitions

export interface LinkScopeSelection {
	collection: string;
	locale: string;
	taxonomy: string | null;
	/** Sorted unique term IDs; empty without a taxonomy. */
	termIds: readonly string[];
}

export type LinkScopeDefinition =
	| { kind: "resolved"; schema: LinkEditorialSchema; termGroups: readonly string[]; scopeVersion: string }
	| { kind: "invalid"; reason: "collection-unavailable" | "taxonomy-not-attached" | "term-unavailable" }
	| { kind: "unavailable" };

function parseAttachments(value: unknown): string[] | null {
	// A definition without attachments has none, as in the host; malformed ones are unreadable.
	if (value === null) return [];
	if (typeof value !== "string") return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) return null;
	return [...new Set(parsed as string[])].sort();
}

async function fingerprint(material: unknown): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(material)));
	return SCOPE_VERSION_PREFIX + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Reads the selection's definitions fresh: a visible, routable collection with
 * a usable title field, the taxonomy's effective attachments (its group's
 * collections, else its definition's) and the exact selected terms in the
 * source locale, without descendants. `scopeVersion` fingerprints exactly what
 * was checked and never the content upper ID. Read failures propagate.
 */
export async function readLinkScopeDefinition(db: HostDatabase, selection: LinkScopeSelection): Promise<LinkScopeDefinition> {
	const collection = await db.selectFrom("_emdash_collections")
		.select(["id", "slug", "hidden", "routable", "url_pattern", "title_field"])
		.where("slug", "=", selection.collection)
		.limit(1)
		.executeTakeFirst();
	if (!collection) return { kind: "invalid", reason: "collection-unavailable" };
	const { id: collectionId, hidden, routable, url_pattern: urlPattern, title_field: titleField } = collection;
	if (!isIdentity(collectionId) || collection.slug !== selection.collection || (hidden !== 0 && hidden !== 1) ||
		(routable !== 0 && routable !== 1) || (urlPattern !== null && typeof urlPattern !== "string") ||
		(titleField !== null && typeof titleField !== "string")) return { kind: "unavailable" };
	if (hidden !== 0 || routable !== 1) return { kind: "invalid", reason: "collection-unavailable" };

	// A configured title field that names no valid text column is ignored, as in the host.
	const configured = typeof titleField === "string" && FIELD_KEY.test(titleField) && !SYSTEM_COLUMNS.has(titleField) ? titleField : null;
	const titleOrder = [...new Set(configured ? [configured, ...TITLE_FALLBACKS] : TITLE_FALLBACKS)];
	const wanted = [...new Set([...titleOrder, ...EXCERPT_FIELDS])];
	const fieldRows = await db.selectFrom("_emdash_fields")
		.select(["id", "slug", "type", "column_type"])
		.where("collection_id", "=", collectionId)
		.where("slug", "in", wanted)
		.orderBy("slug")
		.limit(wanted.length)
		.execute() as Record<string, unknown>[];
	const fields = new Map<string, { type: string; columnType: string }>();
	const fieldIdentity: unknown[] = [];
	for (const field of fieldRows) {
		const { id, slug, type, column_type: columnType } = field;
		if (!isIdentity(id) || typeof slug !== "string" || !wanted.includes(slug) || fields.has(slug) ||
			typeof type !== "string" || typeof columnType !== "string") return { kind: "unavailable" };
		fields.set(slug, { type, columnType });
		fieldIdentity.push([slug, id, type, columnType]);
	}
	const usable = (slug: string, types: readonly string[]) => {
		const field = fields.get(slug);
		return field !== undefined && types.includes(field.type) && field.columnType === "TEXT";
	};
	const schema: LinkEditorialSchema = {
		collection: selection.collection,
		titleColumns: titleOrder.filter((slug) => usable(slug, TITLE_TYPES)),
		excerptColumns: EXCERPT_FIELDS.filter((slug) => usable(slug, EXCERPT_TYPES)),
	};
	if (schema.titleColumns.length === 0) return { kind: "invalid", reason: "collection-unavailable" };

	let taxonomyIdentity: unknown = null;
	const termIdentity: unknown[] = [];
	const termGroups = new Set<string>();
	if (selection.taxonomy !== null) {
		if (selection.termIds.length === 0) return { kind: "invalid", reason: "term-unavailable" };
		const definition = await db.selectFrom("_emdash_taxonomy_defs as d")
			.leftJoin("_emdash_taxonomy_def_groups as g", "g.name", "d.name")
			.select((eb: ExpressionBuilder) => [
				"d.id as definition_id",
				"d.translation_group as definition_group",
				"g.id as group_id",
				eb.fn.coalesce("g.collections", "d.collections").as("collections"),
			])
			.where("d.name", "=", selection.taxonomy)
			.orderBy("d.id")
			.limit(1)
			.executeTakeFirst() as Record<string, unknown> | undefined;
		if (!definition) return { kind: "invalid", reason: "taxonomy-not-attached" };
		const attachments = parseAttachments(definition.collections);
		const { definition_id: definitionId, definition_group: definitionGroup, group_id: groupId } = definition;
		if (!attachments || !isIdentity(definitionId) || (definitionGroup !== null && !isIdentity(definitionGroup)) ||
			(groupId !== null && !isIdentity(groupId))) return { kind: "unavailable" };
		if (!attachments.includes(selection.collection)) return { kind: "invalid", reason: "taxonomy-not-attached" };
		taxonomyIdentity = [selection.taxonomy, groupId, definitionGroup ?? definitionId, attachments];

		const terms = await db.selectFrom("taxonomies")
			.select(["id", "name", "locale", "translation_group"])
			.where("id", "in", selection.termIds)
			.limit(selection.termIds.length)
			.execute() as Record<string, unknown>[];
		const byId = new Map<string, Record<string, unknown>>();
		for (const term of terms) {
			if (typeof term.id !== "string" || !selection.termIds.includes(term.id) || byId.has(term.id) ||
				typeof term.name !== "string" || typeof term.locale !== "string" || !isIdentity(term.translation_group)) {
				return { kind: "unavailable" };
			}
			byId.set(term.id, term);
		}
		for (const termId of selection.termIds) {
			const term = byId.get(termId);
			if (!term || term.name !== selection.taxonomy || term.locale !== selection.locale) return { kind: "invalid", reason: "term-unavailable" };
			termGroups.add(term.translation_group as string);
			termIdentity.push([termId, term.translation_group, term.locale]);
		}
	}

	const scopeVersion = await fingerprint([
		"link-scope-v1", selection.collection, selection.locale,
		[collectionId, hidden, routable, urlPattern, titleField],
		fieldIdentity, taxonomyIdentity, termIdentity,
	]);
	return { kind: "resolved", schema, termGroups: [...termGroups].sort(), scopeVersion };
}

// ---------------------------------------------------------------------------
// Request and scope validation

type ScopeRequestCheck =
	| { kind: "valid"; selection: LinkScopeSelection }
	| { kind: "invalid"; reason: "collection-unavailable" | "taxonomy-not-attached" | "term-unavailable" | "too-many-terms" };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeRequest(request: LinkScopeRequest, allowedCollections: readonly string[]): ScopeRequestCheck {
	if (!isRecord(request)) throw new TypeError("Invalid link scope request.");
	const { collection, locale, taxonomy } = request;
	// The runtime supplies the validated source locale; anything else is a caller defect.
	if (typeof locale !== "string" || canonicalLinkLocale(locale) !== locale) throw new TypeError("The link scope locale must be canonical.");
	if (typeof collection !== "string" || !COLLECTION_KEY.test(collection) || !Array.isArray(allowedCollections) ||
		!allowedCollections.includes(collection)) return { kind: "invalid", reason: "collection-unavailable" };
	if (taxonomy === null) return { kind: "valid", selection: { collection, locale, taxonomy: null, termIds: [] } };
	if (!isRecord(taxonomy) || !isIdentity(taxonomy.taxonomy)) return { kind: "invalid", reason: "taxonomy-not-attached" };
	const termIds = taxonomy.termIds;
	if (!Array.isArray(termIds)) return { kind: "invalid", reason: "term-unavailable" };
	if (termIds.length > LINK_SUGGESTION_LIMITS.taxonomyTerms) return { kind: "invalid", reason: "too-many-terms" };
	if (termIds.length === 0 || !termIds.every((term) => isIdentity(term))) return { kind: "invalid", reason: "term-unavailable" };
	return {
		kind: "valid",
		selection: { collection, locale, taxonomy: taxonomy.taxonomy, termIds: [...new Set(termIds as string[])].sort() },
	};
}

function pageSelection(scope: LinkResolvedScope): LinkScopeSelection {
	if (!isRecord(scope)) throw new TypeError("Invalid link candidate scope.");
	const { collection, locale, taxonomy, termIds, scopeVersion, upperId } = scope;
	if (
		typeof collection !== "string" || !COLLECTION_KEY.test(collection) || typeof locale !== "string" ||
		canonicalLinkLocale(locale) !== locale || (taxonomy !== null && !isIdentity(taxonomy)) || !Array.isArray(termIds) ||
		termIds.length > LINK_SUGGESTION_LIMITS.taxonomyTerms || (taxonomy === null) !== (termIds.length === 0) ||
		!termIds.every((term, index) => isIdentity(term) && (index === 0 || String(termIds[index - 1]) < term)) ||
		!isIdentity(scopeVersion, LINK_SUGGESTION_LIMITS.versionChars) || (upperId !== null && !isIdentity(upperId))
	) throw new TypeError("Invalid link candidate scope.");
	return { collection, locale, taxonomy, termIds: [...termIds] };
}

// ---------------------------------------------------------------------------
// The port

interface WindowRow {
	id: string;
	locale: string;
	translation_group: unknown;
	status: unknown;
	deleted_at: unknown;
}

/**
 * The native `LinkCandidatePort`. It cannot see the runtime's allowed
 * collections at page time; the caller rechecks them before Next.
 */
export function createNativeLinkCandidatePort(db: HostDatabase): LinkCandidatePort {
	return {
		async resolveScope(request, allowedCollections): Promise<LinkScopeResolution> {
			const check = scopeRequest(request, allowedCollections);
			if (check.kind === "invalid") return check;
			const { selection } = check;
			const definition = await readLinkScopeDefinition(db, selection);
			if (definition.kind !== "resolved") return definition;
			const upper = await db.selectFrom(contentTable(selection.collection)).select("id")
				.orderBy("id", "desc").limit(1).executeTakeFirst() as { id: unknown } | undefined;
			if (upper !== undefined && !isIdentity(upper.id)) return { kind: "unavailable" };
			return {
				kind: "resolved",
				scope: { ...selection, scopeVersion: definition.scopeVersion, upperId: upper === undefined ? null : upper.id as string },
			};
		},

		async page(scope, afterId, budget): Promise<LinkCandidatePage> {
			const selection = pageSelection(scope);
			if (afterId !== null && !isIdentity(afterId)) throw new TypeError("Invalid link candidate cursor.");
			if (!isRecord(budget) || !isCount(budget.candidateRows, 1, LINK_PORT_BUDGETS.candidateRows) ||
				!isCount(budget.scopeMatches, 1, LINK_PORT_BUDGETS.scopeMatches)) throw new TypeError("Invalid link candidate budget.");
			const definition = await readLinkScopeDefinition(db, selection);
			if (definition.kind === "unavailable") unavailable("The link candidate definitions are unreadable.");
			if (definition.kind === "invalid" || definition.scopeVersion !== scope.scopeVersion) {
				throw new LinkCandidatePageRefusal("scope-changed", "The link candidate scope changed; find suggestions again.");
			}
			const upperId = scope.upperId;
			if (upperId === null) return { candidates: [], examinedRows: 0, nextAfterId: null, exhausted: true };
			const table = contentTable(selection.collection);

			// The fixed ID window is bounded before any eligibility or membership predicate.
			let window = db.selectFrom(table).select(["id", "locale", "translation_group", "status", "deleted_at"])
				.where("id", "<=", upperId);
			if (afterId !== null) window = window.where("id", ">", afterId);
			const rows = await window.orderBy("id").limit(budget.candidateRows).execute() as WindowRow[];
			if (!Array.isArray(rows) || rows.length > budget.candidateRows) unavailable("The link candidate window is unreadable.");
			let previous = afterId;
			for (const row of rows) {
				if (!isRecord(row) || !isIdentity(row.id) || row.id > upperId || (previous !== null && row.id <= previous) ||
					typeof row.locale !== "string") unavailable("The link candidate window is unreadable.");
				previous = row.id;
			}
			const eligible = (row: WindowRow) => row.status === "published" && row.deleted_at === null && row.locale === selection.locale;

			let members: Set<string> | null = null;
			if (definition.termGroups.length > 0) {
				members = new Set();
				const groups = new Set<string>();
				for (const row of rows) {
					if (!eligible(row) || row.translation_group === null) continue;
					if (!isIdentity(row.translation_group)) unavailable("A link candidate translation group is unreadable.");
					groups.add(row.translation_group);
				}
				if (groups.size > 0) {
					const termGroups = new Set(definition.termGroups);
					// Legacy pivot locale and status columns are not authoritative and are not read.
					const memberships = await db.selectFrom("content_taxonomies")
						.select(["entry_id", "taxonomy_id"])
						.where("collection", "=", selection.collection)
						.where("entry_id", "in", textIds(db, [...groups]))
						.where("taxonomy_id", "in", definition.termGroups)
						.limit(MEMBERSHIP_SENTINEL)
						.execute() as Record<string, unknown>[];
					if (!Array.isArray(memberships) || memberships.length > groups.size * termGroups.size) {
						unavailable("The link candidate membership overflowed its bound.");
					}
					const pairs = new Set<string>();
					for (const membership of memberships) {
						const { entry_id: entry, taxonomy_id: term } = membership;
						if (typeof entry !== "string" || typeof term !== "string" || !groups.has(entry) || !termGroups.has(term)) {
							unavailable("The link candidate membership is unreadable.");
						}
						const pair = JSON.stringify([entry, term]);
						if (pairs.has(pair)) unavailable("The link candidate membership repeats an assignment.");
						pairs.add(pair);
						members.add(entry);
					}
				}
			}

			// Walk the original order; rows after the last match stay unconsumed for Next.
			const matched: string[] = [];
			let examinedRows = 0;
			let lastId: string | null = null;
			for (const row of rows) {
				examinedRows += 1;
				lastId = row.id;
				if (!eligible(row) || (members !== null && !members.has(row.translation_group as string))) continue;
				matched.push(row.id);
				if (matched.length === budget.scopeMatches) break;
			}
			let exhausted = examinedRows === rows.length && (rows.length < budget.candidateRows || lastId === upperId);
			if (!exhausted && examinedRows === rows.length) {
				// An ID-only sentinel after a full window; it is never consumed.
				const sentinel = await db.selectFrom(table).select("id")
					.where("id", ">", lastId).where("id", "<=", upperId)
					.orderBy("id").limit(1).executeTakeFirst();
				exhausted = sentinel === undefined;
			}

			const candidates: LinkCandidateProjection[] = [];
			if (matched.length > 0) {
				const wanted = new Set(matched);
				const projected = await db.selectFrom(table)
					.select((eb: ExpressionBuilder) => ["id", "version", "updated_at", ...linkEditorialSelections(eb, definition.schema)])
					.where("id", "in", matched)
					.where("status", "=", "published")
					.where("deleted_at", "is", null)
					.where("locale", "=", selection.locale)
					.limit(matched.length)
					.execute() as Record<string, unknown>[];
				if (!Array.isArray(projected)) unavailable("The link candidate projection is unreadable.");
				const byId = new Map<string, Record<string, unknown>>();
				for (const row of projected) {
					if (!isRecord(row) || typeof row.id !== "string" || !wanted.has(row.id) || byId.has(row.id)) {
						unavailable("The link candidate projection is unreadable.");
					}
					byId.set(row.id, row);
				}
				for (const entryId of matched) {
					const row = byId.get(entryId);
					// Changed since the window read; no later row replaces it.
					if (!row) continue;
					const version = linkEntryVersion(row.version, row.updated_at);
					const text = linkEditorialText(row, definition.schema);
					if (version === null || text === null) unavailable("A link candidate version or projection is unreadable.");
					const title = text.title.kind === "text" && text.excerpt.kind !== "refused" ? text.title.value : null;
					candidates.push({
						collection: selection.collection,
						entryId,
						locale: selection.locale,
						version,
						// An empty title is the engine's malformed-candidate signal: counted, never shown or replaced.
						title: title ?? "",
						excerpt: title !== null && text.excerpt.kind === "text" ? text.excerpt.value : null,
						afterId: entryId,
					});
				}
			}
			return { candidates, examinedRows, nextAfterId: exhausted ? null : lastId, exhausted };
		},
	};
}
