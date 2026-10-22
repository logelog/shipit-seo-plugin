// Read-only native SQLite target port for internal-link suggestions. For one
// exact entry it reads fresh scope definitions and term-group membership, the
// bounded editorial title and published version, the core or declared
// fallback SEO flag, the ID-first override and, only for an eligible target,
// the host public URL. Every observation is read again after that URL read
// and any change refuses the target. No transaction spans these reads, so the
// pair is a consistency check, not a snapshot. The query syntax targets
// native SQLite only.

import type { PluginContext } from "emdash";

import { isSeoContentCollectionKey } from "./admin-contract.ts";
import { contentTypeNoindexApplies } from "./content-type-noindex-policy.ts";
import { clean, resolveOverrideForContentItem } from "./entry-analysis-runtime.ts";
import type { LinkPolicyObservation } from "./internal-link-host-ports.ts";
import {
	linkEditorialSelections,
	linkEditorialText,
	linkEntryVersion,
	readLinkScopeDefinition,
	type LinkEditorialSchema,
	type LinkScopeSelection,
} from "./internal-link-native-source.ts";
import type { LinkResolvedScope, LinkTargetPort } from "./internal-link-source.ts";
import { LINK_SUGGESTION_LIMITS, canonicalLinkLocale, type LinkTargetRead } from "./internal-link-suggestions.ts";
import { jsonUtf8LengthWithin } from "./lib.ts";

// The native EmDash 1.1.0 Kysely connection quotes identifiers and binds values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostDatabase = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExpressionBuilder = any;

/** A declared fallback `seo` column, raw, before the host's one JSON pass. */
export const LINK_TARGET_SEO_FALLBACK_BYTES = 16_384;
/** One stored override record as the store returns it. */
export const LINK_TARGET_OVERRIDE_BYTES = 16_384;
/** Everything one target's policy identity covers, serialized. */
export const LINK_TARGET_POLICY_MATERIAL_BYTES = 65_536;

const LOCALE_BYTES = 4 * LINK_SUGGESTION_LIMITS.localeChars;
const STATUS_BYTES = 64;
const IDENTITY_BYTES = 4 * LINK_SUGGESTION_LIMITS.identityChars;
const SLUG_BYTES = 1_024;
const TIMESTAMP_BYTES = 256;
const TIMESTAMP_CHARS = 64;
const TARGET_POLICY_PREFIX = "link-target-policy-v1:sha256-";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentity(value: unknown, max: number = LINK_SUGGESTION_LIMITS.identityChars): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value &&
		!/[\u0000-\u001f\u007f]/u.test(value);
}

function withinBytes(value: unknown, limit: number): boolean {
	try {
		return jsonUtf8LengthWithin(value, limit) !== null;
	} catch {
		return false;
	}
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Bounded projections

/** The column's SQLite type or `overflow`, and its text only within `maxBytes` (bytes, so a NUL cannot hide length). */
function boundedText(eb: ExpressionBuilder, column: string, alias: string, maxBytes: number): unknown[] {
	const type = eb.fn("typeof", [column]);
	const bytes = eb.fn("length", [eb.cast(column, "blob")]);
	return [
		eb.case().when(type, "<>", "text").then(type)
			.when(bytes, ">", eb.lit(maxBytes)).then(eb.val("overflow"))
			.else(eb.val("text")).end().as(alias + "_kind"),
		eb.case().when(eb.and([eb(type, "=", "text"), eb(bytes, "<=", eb.lit(maxBytes))]))
			.then(eb.ref(column)).end().as(alias + "_text"),
	];
}

/** The column's SQLite type, and its value only when it is an integer. */
function boundedInteger(eb: ExpressionBuilder, column: string, alias: string): unknown[] {
	const type = eb.fn("typeof", [column]);
	return [type.as(alias + "_kind"), eb.case().when(type, "=", "integer").then(eb.ref(column)).end().as(alias + "_value")];
}

/** Text, null, or undefined for any other type, an overflow or a driver answer outside the projection. */
function textOf(row: Record<string, unknown>, alias: string): string | null | undefined {
	const kind = row[alias + "_kind"];
	const text = row[alias + "_text"];
	if (kind === "null" && text === null) return null;
	if (kind === "text" && typeof text === "string") return text;
	return undefined;
}

function integerOf(row: Record<string, unknown>, alias: string): number | null | undefined {
	const kind = row[alias + "_kind"];
	const value = row[alias + "_value"];
	if (kind === "null" && value === null) return null;
	if (kind === "integer" && Number.isSafeInteger(value)) return value as number;
	return undefined;
}

// ---------------------------------------------------------------------------
// One observation of the target

interface TargetRow {
	locale: string;
	status: string;
	group: string | null;
	slug: string | null;
	/** Raw, as the host's date route tokens read it. */
	publishedAt: string | null;
	version: string;
	title: string;
}

interface TargetPolicy {
	version: string;
	/** Core or fallback noIndex, or the override's robots; the caller applies the global flag and the content type rule. */
	noindex: boolean;
}

type Observation =
	| { kind: "observed"; row: TargetRow; inScope: boolean | null; policy: TargetPolicy | null; fingerprint: string }
	| { kind: "missing" }
	| { kind: "unavailable" };

interface CollectionSeo {
	hasSeo: boolean;
	/** The declared `seo` field when core SEO is disabled; null when none is declared. */
	fallback: { id: string; type: string; columnType: string } | null;
}

async function collectionSeo(db: HostDatabase, collection: string): Promise<CollectionSeo | null> {
	const rows = await db.selectFrom("_emdash_collections as c")
		.leftJoin("_emdash_fields as f", (join: ExpressionBuilder) => join.onRef("f.collection_id", "=", "c.id").on("f.slug", "=", "seo"))
		.select(["c.has_seo as has_seo", "f.id as seo_field_id", "f.type as seo_field_type", "f.column_type as seo_column_type"])
		.where("c.slug", "=", collection)
		.limit(2)
		.execute() as Record<string, unknown>[];
	if (!Array.isArray(rows) || rows.length !== 1) return null;
	const { has_seo: hasSeo, seo_field_id: id, seo_field_type: type, seo_column_type: columnType } = rows[0];
	if (hasSeo !== 0 && hasSeo !== 1) return null;
	if (id === null) return { hasSeo: hasSeo === 1, fallback: null };
	if (!isIdentity(id) || typeof type !== "string" || typeof columnType !== "string") return null;
	return { hasSeo: hasSeo === 1, fallback: hasSeo === 1 ? null : { id, type, columnType } };
}

function validOverride(value: unknown): boolean {
	return isRecord(value) && (value.robots === undefined || typeof value.robots === "string") &&
		typeof value.updatedAt === "string" && value.updatedAt.length <= TIMESTAMP_CHARS &&
		(value.ref === undefined || typeof value.ref === "string");
}

/**
 * The target's own indexing policy, or null when any part is unreadable.
 * Core SEO, when enabled, owns the flag even without a row and the declared
 * fallback is ignored; without core SEO only a declared `seo` column counts,
 * decoded as the host does. The override is ID first, slug only when the ID
 * record is absent.
 */
async function targetPolicy(
	db: HostDatabase,
	ctx: PluginContext,
	ref: { collection: string; entryId: string },
	seo: CollectionSeo,
	row: TargetRow,
	fallbackText: string | null | undefined,
): Promise<TargetPolicy | null> {
	let local: unknown[];
	let localNoindex: boolean;
	if (seo.hasSeo) {
		const rows = await db.selectFrom("_emdash_seo")
			.select((eb: ExpressionBuilder) => [...boundedInteger(eb, "seo_no_index", "no_index"), ...boundedText(eb, "updated_at", "updated", TIMESTAMP_BYTES)])
			.where("collection", "=", ref.collection)
			.where("content_id", "=", ref.entryId)
			.limit(1)
			.execute() as Record<string, unknown>[];
		if (!Array.isArray(rows)) return null;
		if (rows.length === 0) {
			local = ["core", "defaults"];
			localNoindex = false;
		} else {
			const noIndex = integerOf(rows[0], "no_index");
			const updated = textOf(rows[0], "updated");
			if ((noIndex !== 0 && noIndex !== 1) || !isIdentity(updated, TIMESTAMP_CHARS)) return null;
			local = ["core", "row", noIndex, updated];
			localNoindex = noIndex === 1;
		}
	} else if (seo.fallback) {
		const { id, type, columnType } = seo.fallback;
		// Storageless or numeric declarations are not a shape this port can read.
		if (type === "reference" || (columnType !== "TEXT" && columnType !== "JSON") || fallbackText === undefined) return null;
		localNoindex = false;
		if (fallbackText !== null) {
			// ContentRepository.deserializeValue: one parse, only of an untrimmed object or array prefix.
			let decoded: unknown = fallbackText;
			if (fallbackText.startsWith("{") || fallbackText.startsWith("[")) {
				try {
					decoded = JSON.parse(fallbackText);
				} catch {
					decoded = fallbackText;
				}
			}
			if (!isRecord(decoded) || (decoded.noIndex !== undefined && typeof decoded.noIndex !== "boolean")) return null;
			localNoindex = decoded.noIndex === true;
		}
		local = ["fallback", id, type, columnType, fallbackText];
	} else {
		local = ["none"];
		localNoindex = false;
	}

	const observations: unknown[] = [];
	let record: unknown;
	try {
		record = await resolveOverrideForContentItem(ctx, ref.collection, { id: ref.entryId, slug: row.slug },
			(value) => {
				if (!withinBytes(value, LINK_TARGET_OVERRIDE_BYTES)) throw new Error("A stored override exceeds the link target bound.");
			},
			(key, keyKind, value) => void observations.push([key, keyKind, value]));
	} catch {
		return null;
	}
	if (observations.some((entry) => (entry as unknown[])[2] !== null && !validOverride((entry as unknown[])[2])) ||
		(record !== null && !validOverride(record))) return null;
	const robots = record === null ? undefined : (record as { robots?: string }).robots;
	const overrideNoindex = clean(robots)?.toLowerCase().includes("noindex") === true;

	const material = ["link-target-policy-v1", ref.collection, ref.entryId, row.locale, row.slug, local, observations];
	if (!withinBytes(material, LINK_TARGET_POLICY_MATERIAL_BYTES)) return null;
	return { version: TARGET_POLICY_PREFIX + await sha256Hex(JSON.stringify(material)), noindex: localNoindex || overrideNoindex };
}

async function observeTarget(
	db: HostDatabase,
	ctx: PluginContext,
	ref: { collection: string; entryId: string },
	selection: LinkScopeSelection,
	scopeVersion: string,
): Promise<Observation> {
	const definition = await readLinkScopeDefinition(db, selection);
	if (definition.kind !== "resolved") return { kind: "unavailable" };
	const scopeCurrent = definition.scopeVersion === scopeVersion;
	const seo = await collectionSeo(db, ref.collection);
	if (!seo) return { kind: "unavailable" };
	const declaredFallback = seo.fallback !== null && seo.fallback.type !== "reference" &&
		(seo.fallback.columnType === "TEXT" || seo.fallback.columnType === "JSON");

	const titleSchema: LinkEditorialSchema = { ...definition.schema, excerptColumns: [] };
	const rows = await db.selectFrom("ec_" + ref.collection)
		.select((eb: ExpressionBuilder) => [
			"id",
			...boundedText(eb, "locale", "locale", LOCALE_BYTES),
			...boundedText(eb, "status", "status", STATUS_BYTES),
			...boundedText(eb, "translation_group", "group", IDENTITY_BYTES),
			...boundedText(eb, "slug", "slug", SLUG_BYTES),
			...boundedText(eb, "published_at", "published", TIMESTAMP_BYTES),
			...boundedInteger(eb, "version", "version"),
			...boundedText(eb, "updated_at", "updated", TIMESTAMP_BYTES),
			...linkEditorialSelections(eb, titleSchema),
			...(declaredFallback ? boundedText(eb, "seo", "seo", LINK_TARGET_SEO_FALLBACK_BYTES) : []),
		])
		.where("id", "=", ref.entryId)
		.where("deleted_at", "is", null)
		.limit(1)
		.execute() as Record<string, unknown>[];
	if (!Array.isArray(rows)) return { kind: "unavailable" };
	if (rows.length === 0) return { kind: "missing" };
	const raw = rows[0];
	const locale = textOf(raw, "locale");
	const status = textOf(raw, "status");
	const group = textOf(raw, "group");
	const slug = textOf(raw, "slug");
	// The host formats date route tokens from this value, so it is part of the URL's consistency check.
	const publishedAt = textOf(raw, "published");
	const version = linkEntryVersion(integerOf(raw, "version"), textOf(raw, "updated"));
	const editorial = linkEditorialText(raw, titleSchema);
	if (raw.id !== ref.entryId || typeof locale !== "string" || typeof status !== "string" || group === undefined ||
		(group !== null && !isIdentity(group)) || slug === undefined || publishedAt === undefined || version === null ||
		editorial === null) return { kind: "unavailable" };
	// An unusable title is the engine's changed-target signal, never another field.
	const row: TargetRow = {
		locale, status, group, slug, publishedAt, version, title: editorial.title.kind === "text" ? editorial.title.value : "",
	};

	let inScope: boolean | null = null;
	if (scopeCurrent) {
		if (definition.termGroups.length === 0) inScope = true;
		else if (group === null) inScope = false;
		else {
			const memberships = await db.selectFrom("content_taxonomies")
				.select("taxonomy_id")
				.where("collection", "=", ref.collection)
				.where("entry_id", "=", group)
				.where("taxonomy_id", "in", [...definition.termGroups])
				.limit(definition.termGroups.length)
				.execute() as Record<string, unknown>[];
			const seen = new Set<string>();
			const valid = Array.isArray(memberships) && memberships.every((membership) => {
				const term = membership.taxonomy_id;
				if (typeof term !== "string" || !definition.termGroups.includes(term) || seen.has(term)) return false;
				seen.add(term);
				return true;
			});
			inScope = valid ? seen.size > 0 : null;
		}
	}

	const policy = await targetPolicy(db, ctx, ref, seo, row, declaredFallback ? textOf(raw, "seo") : undefined);
	const fingerprint = JSON.stringify([row, definition.scopeVersion, scopeCurrent, inScope, policy]);
	return { kind: "observed", row, inScope, policy, fingerprint };
}

// ---------------------------------------------------------------------------
// The port

function targetSelection(ref: unknown, scope: unknown): LinkScopeSelection | null {
	if (!isRecord(ref) || !isRecord(scope)) return null;
	const { collection, locale, taxonomy, termIds, scopeVersion, upperId } = scope;
	if (
		!isSeoContentCollectionKey(ref.collection) || !/^[a-z][a-z0-9_]{0,62}$/.test(ref.collection) || !isIdentity(ref.entryId) ||
		collection !== ref.collection || typeof locale !== "string" || canonicalLinkLocale(locale) !== locale ||
		(taxonomy !== null && !isIdentity(taxonomy)) || !Array.isArray(termIds) || termIds.length > LINK_SUGGESTION_LIMITS.taxonomyTerms ||
		(taxonomy === null) !== (termIds.length === 0) ||
		!termIds.every((term, index) => isIdentity(term) && (index === 0 || String(termIds[index - 1]) < term)) ||
		!isIdentity(scopeVersion, LINK_SUGGESTION_LIMITS.versionChars) || (upperId !== null && !isIdentity(upperId))
	) return null;
	return { collection: ref.collection, locale, taxonomy: taxonomy as string | null, termIds: [...(termIds as string[])] };
}

function currentObservation(
	lookup: (version: string) => LinkPolicyObservation | null,
	version: string,
): LinkPolicyObservation | null {
	const observation = lookup(version);
	return observation !== null && observation.version === version && typeof observation.noindex === "boolean" ? observation : null;
}

/**
 * The native target port for one runtime invocation. It uses the host
 * database and plugin context it is given and that invocation's exact policy
 * observation; it rereads no global setting and keeps nothing between reads.
 */
export function createNativeLinkTargetPort(options: {
	db: HostDatabase;
	ctx: PluginContext;
	policyObservation: (version: string) => LinkPolicyObservation | null;
}): LinkTargetPort {
	const { db, ctx, policyObservation } = options;
	return {
		async readTarget(ref, scope, globalPolicyVersion): Promise<LinkTargetRead> {
			const selection = targetSelection(ref, scope);
			if (!selection || !isIdentity(globalPolicyVersion, LINK_SUGGESTION_LIMITS.versionChars)) return { kind: "unavailable" };
			const global = currentObservation(policyObservation, globalPolicyVersion);
			if (!global) return { kind: "unavailable" };
			const exact = { collection: ref.collection, entryId: ref.entryId };
			const resolved = scope as LinkResolvedScope;
			try {
				const first = await observeTarget(db, ctx, exact, selection, resolved.scopeVersion);
				if (first.kind !== "observed") return first;
				const noindex = first.policy === null ? null
					: global.noindex || contentTypeNoindexApplies(global.contentTypeNoindex, exact.collection) || first.policy.noindex;
				const eligible = first.row.status === "published" && first.row.locale === selection.locale && first.inScope === true &&
					noindex === false && first.row.title !== "";
				let publicUrl: string | null = null;
				if (eligible && typeof ctx.content?.getPublicUrl === "function") {
					// The host resolves the route from a full-row read of its own.
					const url: unknown = await ctx.content.getPublicUrl(exact.collection, exact.entryId);
					if (url !== null && (typeof url !== "string" || url.length > LINK_SUGGESTION_LIMITS.urlChars)) return { kind: "unavailable" };
					const second = await observeTarget(db, ctx, exact, selection, resolved.scopeVersion);
					if (second.kind === "missing") return { kind: "missing" };
					if (second.kind !== "observed" || second.fingerprint !== first.fingerprint) return { kind: "unavailable" };
					publicUrl = url as string | null;
				}
				const after = currentObservation(policyObservation, globalPolicyVersion);
				if (!after || after.noindex !== global.noindex) return { kind: "unavailable" };
				return {
					kind: "found",
					target: {
						collection: exact.collection, entryId: exact.entryId, locale: first.row.locale, status: first.row.status,
						version: first.row.version, title: first.row.title, publicUrl, inScope: first.inScope, noindex,
						globalPolicyVersion, targetPolicyVersion: first.policy?.version ?? null,
					},
				};
			} catch {
				return { kind: "unavailable" };
			}
		},
	};
}
