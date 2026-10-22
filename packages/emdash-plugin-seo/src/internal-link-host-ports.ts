// Exact SDK saved-source and global indexing-policy ports for one runtime
// invocation. The source port reads one collection schema, one content row
// and, only when that row points at a draft revision, that exact revision.
// The policy port reads the plugin's global settings record, or while it is
// absent its legacy keys. Nothing here lists, counts, writes, reads a target
// or calls the network, and nothing outlives the factory that created it.

import type { PluginContext } from "emdash";

import { isSeoContentCollectionKey } from "./admin-contract.ts";
import { isSavedContentItem, savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import { isStoredContentTypeNoindex } from "./content-type-noindex-policy.ts";
import type { LinkPolicyPort, LinkSourcePort } from "./internal-link-source.ts";
import {
	LINK_SUGGESTION_LIMITS,
	canonicalLinkLocale,
	validateLinkSourceDocument,
	type LinkPolicyRead,
	type LinkSourceRead,
} from "./internal-link-suggestions.ts";
import { jsonUtf8LengthWithin } from "./lib.ts";
import { readReadableSiteSettings } from "./settings-runtime.ts";
import { LEGACY_SETTINGS_KEYS } from "./settings-state.ts";

/**
 * What `savedContentVersion` may serialize: the SEO record always, and the
 * row's data and slug when the host gives neither a version nor a usable
 * revision token. Larger input is refused rather than given another version.
 */
export const LINK_VERSION_FINGERPRINT_BYTES = 2 * LINK_SUGGESTION_LIMITS.sourceBodyBytes;
/**
 * Both the settings envelopes one policy read returns, together, and the
 * canonical material its identity covers, each serialized.
 */
export const LINK_POLICY_MATERIAL_BYTES = 65_536;

const POLICY_VERSION_PREFIX = "link-policy-v1:sha256-";
const REVISION_TOKEN_CHARS = 512;
/** Row timestamp metadata; an ISO timestamp needs well under this. */
const TIMESTAMP_CHARS = 64;
const PORTABLE_TEXT = "portableText";

/** One immutable global indexing observation, valid only under its exact policy version. */
export interface LinkPolicyObservation {
	readonly version: string;
	readonly noindex: boolean;
	/** Content types whose every entry is noindex; empty while none is stored. */
	readonly contentTypeNoindex: readonly string[];
	readonly siteUrl: string;
}

export interface LinkHostPorts {
	source: LinkSourcePort;
	policy: LinkPolicyPort;
	/**
	 * The observation of the latest successful policy read of this factory,
	 * only when `version` is exactly the version it returned; otherwise null.
	 */
	policyObservation(version: string): LinkPolicyObservation | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentity(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= LINK_SUGGESTION_LIMITS.identityChars &&
		value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
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
// Saved source

const UNAVAILABLE: LinkSourceRead = { kind: "unavailable" };

type BodyField =
	| { kind: "field"; slug: string }
	| { kind: "unsupported"; reason: "no-portable-text-field" | "ambiguous-body-field" }
	| { kind: "malformed" };

/** The collection's one Portable Text field, from its exact schema only. */
function bodyField(schema: unknown, collection: string): BodyField {
	if (!isRecord(schema) || schema.slug !== collection || !Array.isArray(schema.fields)) return { kind: "malformed" };
	const slugs = new Set<string>();
	const portable: string[] = [];
	for (const field of schema.fields) {
		if (!isRecord(field) || !isIdentity(field.slug) || typeof field.type !== "string" || slugs.has(field.slug)) return { kind: "malformed" };
		slugs.add(field.slug);
		if (field.type === PORTABLE_TEXT) portable.push(field.slug);
	}
	if (portable.length === 0) return { kind: "unsupported", reason: "no-portable-text-field" };
	if (portable.length > 1) return { kind: "unsupported", reason: "ambiguous-body-field" };
	return { kind: "field", slug: portable[0] };
}

/**
 * Whether `savedContentVersion` would fall back to fingerprinting data and
 * slug: the same version and revision-token reading as that helper, with an
 * oversized token refused before it is decoded.
 */
function fingerprintsData(item: { version?: unknown; _rev?: unknown; draftRevisionId?: string | null }): boolean | null {
	if (typeof item.version === "number" && Number.isSafeInteger(item.version)) return false;
	if (typeof item._rev === "string") {
		if (item._rev.length > REVISION_TOKEN_CHARS) return null;
		try {
			const counter = Number(atob(item._rev).split(":")[0]);
			if (Number.isSafeInteger(counter) && counter >= 0) return false;
		} catch {
			// The helper falls through to the fingerprint below.
		}
	}
	return !item.draftRevisionId;
}

async function readSavedSource(ctx: PluginContext, ref: { collection: string; entryId: string }): Promise<LinkSourceRead> {
	const { collection, entryId } = ref;
	if (!isSeoContentCollectionKey(collection) || !isIdentity(entryId)) return UNAVAILABLE;
	const schemaAccess = ctx.schema;
	const content = ctx.content;
	if (typeof schemaAccess?.getCollection !== "function" || typeof content?.get !== "function") return UNAVAILABLE;

	let schema: unknown;
	try {
		schema = await schemaAccess.getCollection(collection);
	} catch {
		return UNAVAILABLE;
	}
	if (schema === null) return { kind: "missing" };
	const field = bodyField(schema, collection);
	if (field.kind === "malformed") return UNAVAILABLE;
	if (field.kind === "unsupported") return { kind: "unsupported", reason: field.reason };

	// The SDK hydrates the whole row, body included, before any bound below applies.
	let item: unknown;
	try {
		item = await content.get(collection, entryId);
	} catch {
		return UNAVAILABLE;
	}
	if (item === null) return { kind: "missing" };
	// Bounded before the shared helpers parse or serialize them, or the pointer reaches the SDK.
	if (!isRecord(item) || typeof item.updatedAt !== "string" || item.updatedAt.length > TIMESTAMP_CHARS ||
		(item.draftRevisionId !== undefined && item.draftRevisionId !== null && !isIdentity(item.draftRevisionId))) return UNAVAILABLE;
	if (!isSavedContentItem(item)) return UNAVAILABLE;
	const row = item as typeof item & { type?: unknown; locale?: unknown };
	if (row.id !== entryId || row.type !== collection || typeof row.locale !== "string" || canonicalLinkLocale(row.locale) !== row.locale ||
		(row.version !== undefined && !(Number.isSafeInteger(row.version) && (row.version as number) >= 0))) return UNAVAILABLE;
	const locale = row.locale;

	// The saved version comes from the untouched row, before any draft body is chosen.
	const fallback = fingerprintsData(row);
	if (fallback === null || !withinBytes(row.seo ?? null, LINK_VERSION_FINGERPRINT_BYTES) ||
		(fallback && !withinBytes([row.data, row.slug], LINK_VERSION_FINGERPRINT_BYTES))) return UNAVAILABLE;
	const sourceVersion = savedContentVersion(row);

	let body: unknown;
	let revisionId: string | null = null;
	const pointer = row.draftRevisionId;
	if (typeof pointer === "string") {
		// A saved draft owns the body; live content is never read in its place.
		if (typeof content.getRevision !== "function") return UNAVAILABLE;
		let revision: unknown;
		try {
			revision = await content.getRevision(collection, entryId, pointer);
		} catch {
			return UNAVAILABLE;
		}
		if (!isRecord(revision) || revision.id !== pointer || revision.collection !== collection || revision.entryId !== entryId ||
			!Object.hasOwn(revision, "data") || !isRecord(revision.data) || !Object.hasOwn(revision.data, field.slug)) return UNAVAILABLE;
		body = revision.data[field.slug];
		revisionId = pointer;
	} else {
		body = Object.hasOwn(row.data, field.slug) ? row.data[field.slug] : null;
	}
	if (!withinBytes(body, LINK_SUGGESTION_LIMITS.sourceBodyBytes)) return UNAVAILABLE;

	const siteUrl = typeof ctx.site?.url === "string" ? ctx.site.url : null;
	const document = validateLinkSourceDocument({
		collection, entryId, locale, sourceVersion, revisionId, field: field.slug, body, siteUrl, routeUrl: null,
	});
	return document ? { kind: "found", document } : UNAVAILABLE;
}

// ---------------------------------------------------------------------------
// Global indexing policy

type ReadableSettings = Awaited<ReturnType<typeof readReadableSiteSettings>>;

/**
 * A read-only view with only the surfaces the settings helper uses. Each
 * versioned read is forwarded once and returned unchanged, unless together
 * with the earlier envelopes of this read it passes the policy bound; then it
 * throws before the classifier serializes it. The host has already read and
 * hydrated that envelope; this bounds plugin processing only.
 */
function boundedSettingsContext(ctx: PluginContext): PluginContext {
	const kv = ctx.kv;
	let used = 0;
	const getVersioned = typeof kv?.getVersioned === "function"
		? async (key: string) => {
			const entry = await kv.getVersioned<unknown>(key);
			let size: number | null;
			try {
				size = jsonUtf8LengthWithin(entry, LINK_POLICY_MATERIAL_BYTES - used);
			} catch {
				size = null;
			}
			if (size === null) throw new Error("Stored SEO settings exceed the link policy bound.");
			used += size;
			return entry;
		}
		: undefined;
	return { site: ctx.site, log: ctx.log, kv: { getVersioned } } as unknown as PluginContext;
}

/**
 * Everything the policy identity covers: the classification, the stored
 * record's revision or, without a record, every legacy envelope including
 * absence, and the effective indexing values. A same-value rewrite still
 * changes a revision, so it changes the identity.
 */
function policyMaterial(settings: ReadableSettings): unknown {
	const values = [settings.values.noindex, settings.values.siteUrl,
		...(settings.values.contentTypeNoindex === undefined ? [] : [settings.values.contentTypeNoindex])];
	// Only record-less settings snapshots carry legacy observations.
	if (!("legacy" in settings)) {
		return ["link-policy-v1", settings.state, settings.revision, settings.confirmed, values];
	}
	const legacy = LEGACY_SETTINGS_KEYS.map((key) => {
		const entry = settings.legacy[key];
		if (entry === undefined) return [key, "unread"];
		return entry === null ? [key, null] : [key, entry.revision, entry.value];
	});
	return ["link-policy-v1", settings.state, settings.legacyPresent, legacy, values];
}

/**
 * Source and policy ports for exactly one runtime invocation. The policy
 * observation lives only in this closure; a failed read clears it and an
 * older read finishing late cannot replace a newer one.
 */
export function createLinkHostPorts(ctx: PluginContext): LinkHostPorts {
	let observation: LinkPolicyObservation | null = null;
	let latestRead = 0;

	return {
		source: {
			readSource: (ref) => readSavedSource(ctx, ref),
		},
		policy: {
			async readPolicy(): Promise<LinkPolicyRead> {
				const read = ++latestRead;
				observation = null;
				let result: { version: string; noindex: boolean; contentTypeNoindex: readonly string[]; siteUrl: string } | null = null;
				try {
					const settings = await readReadableSiteSettings(boundedSettingsContext(ctx), "full");
					const { noindex, siteUrl } = settings.values;
					const contentTypeNoindex = settings.values.contentTypeNoindex ?? [];
					const material = policyMaterial(settings);
					if (typeof noindex === "boolean" && typeof siteUrl === "string" && isStoredContentTypeNoindex(contentTypeNoindex) &&
						withinBytes(material, LINK_POLICY_MATERIAL_BYTES)) {
						result = {
							version: POLICY_VERSION_PREFIX + await sha256Hex(JSON.stringify(material)), noindex,
							contentTypeNoindex: Object.freeze([...contentTypeNoindex]), siteUrl,
						};
					}
				} catch {
					// Corrupt or unavailable settings are unreadable, never defaults.
				}
				if (read === latestRead) observation = result ? Object.freeze({ ...result }) : null;
				return result ? { kind: "readable", version: result.version } : { kind: "unreadable" };
			},
		},
		policyObservation(version) {
			return observation !== null && observation.version === version ? observation : null;
		},
	};
}
