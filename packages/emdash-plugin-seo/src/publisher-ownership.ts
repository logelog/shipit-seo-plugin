// Automatic publisher ownership: whether Shipit generates the site publisher,
// which is the active business identity or else the legacy settings
// publisher. One strict versioned KV record, the page decision shared by
// public output, previews and analysis, and the bounded check that guards the
// return to automatic output.
// No React, DOM, Node, SQL or network dependencies.

import type { PublicPageContext } from "emdash";

import {
	businessIdentityEntityIdFor,
	businessIdentityOwnedIds,
	businessIdentityReferenceIds,
	businessIdentityTemplateContexts,
	customOwnedIdConflicts,
	graphOwnedDefinitions,
	legacyPublisherEntityId,
	ownedIdDependsOnPage,
	resolveBusinessIdentityGraphs,
	type BusinessIdentityCustomRecord,
	type BusinessIdentityPageConflict,
	type BusinessIdentityRenderState,
} from "./business-identity.ts";
import { schemaDefinitionIdentities, validateCustomJsonLd, type SchemaPublisherSource } from "./lib.ts";

export const PUBLISHER_OWNERSHIP_STORAGE_VERSION = 1 as const;
export const PUBLISHER_OWNERSHIP_KEY = `configuration:publisher-ownership:v${PUBLISHER_OWNERSHIP_STORAGE_VERSION}`;
export const PUBLISHER_OWNERSHIP_MODES = ["automatic", "none"] as const;
/** Global custom schema rows the return to automatic output reads at most. */
export const PUBLISHER_OWNERSHIP_PREFLIGHT_LIMIT = 100;
/** Definitions a refused check names; the rest are counted. */
export const PUBLISHER_OWNERSHIP_LISTED_DEFINITIONS = 10;
/**
 * Version of the page decision below. Every analysis fingerprint records it,
 * so a score computed under an earlier rule is never presented as current.
 */
export const PUBLISHER_RESOLVER_VERSION = 2;

const MAX_REVISION_LENGTH = 128;

export type PublisherOwnershipMode = (typeof PUBLISHER_OWNERSHIP_MODES)[number];

export interface PublisherOwnershipRecord {
	version: typeof PUBLISHER_OWNERSHIP_STORAGE_VERSION;
	mode: PublisherOwnershipMode;
}

export type PublisherOwnershipState =
	| { state: "absent"; revision: null }
	| { state: "valid"; revision: string; mode: PublisherOwnershipMode }
	| { state: "corrupt"; revision: string | null }
	| { state: "unavailable"; revision: null };

/** `unknown`: the record is stored but unreadable, or the read failed. */
export type PublisherOwnershipEffective = "automatic" | "none" | "unknown";

/** Exactly `{version: 1, mode}`; anything else, including a stored JSON null, is corrupt. */
export function parsePublisherOwnershipRecord(value: unknown): PublisherOwnershipRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== 2 || !Object.hasOwn(record, "version") || !Object.hasOwn(record, "mode")) return null;
	if (record.version !== PUBLISHER_OWNERSHIP_STORAGE_VERSION) return null;
	if (!(PUBLISHER_OWNERSHIP_MODES as readonly unknown[]).includes(record.mode)) return null;
	return { version: PUBLISHER_OWNERSHIP_STORAGE_VERSION, mode: record.mode as PublisherOwnershipMode };
}

export interface PublisherOwnershipKv {
	getVersioned?: (key: string) => Promise<unknown>;
	compareAndSet?: (key: string, expectedRevision: string | null, value: unknown) => Promise<unknown>;
}

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_REVISION_LENGTH;
}

function parseFailure(error: unknown): boolean {
	return error instanceof SyntaxError || /JSON|Unexpected token|Unexpected end/i.test(String((error as Error)?.message ?? error));
}

/** One versioned read. Never writes, so an absent record stays absent. */
export async function readPublisherOwnership(kv: PublisherOwnershipKv | null | undefined): Promise<PublisherOwnershipState> {
	if (typeof kv?.getVersioned !== "function") return { state: "unavailable", revision: null };
	let stored: unknown;
	try {
		stored = await kv.getVersioned(PUBLISHER_OWNERSHIP_KEY);
	} catch (error: unknown) {
		// The host parses the row before returning it; bytes it cannot parse are a stored, unreadable record.
		return parseFailure(error) ? { state: "corrupt", revision: null } : { state: "unavailable", revision: null };
	}
	if (stored === null || stored === undefined) return { state: "absent", revision: null };
	const snapshot = stored as { value?: unknown; revision?: unknown };
	if (typeof stored !== "object" || !Object.hasOwn(stored, "value") || !validRevision(snapshot.revision)) {
		return { state: "unavailable", revision: null };
	}
	const record = parsePublisherOwnershipRecord(snapshot.value);
	return record
		? { state: "valid", revision: snapshot.revision, mode: record.mode }
		: { state: "corrupt", revision: snapshot.revision };
}

export function publisherOwnershipEffective(state: PublisherOwnershipState): PublisherOwnershipEffective {
	if (state.state === "absent") return "automatic";
	if (state.state === "valid") return state.mode;
	return "unknown";
}

/** Only a readable saved opt-out lets custom schema define the publisher's IDs; an unreadable record does not. */
export function publisherOwnershipOptedOut(state: PublisherOwnershipState): boolean {
	return state.state === "valid" && state.mode === "none";
}

// ---------------------------------------------------------------------------
// Page decision
// ---------------------------------------------------------------------------

/**
 * Every ID the site publisher can have: the Organization and Person IDs at the
 * site address in the three spellings Shipit answers to, plus the identity's
 * own IDs and aliases when its record was read.
 */
export function sitePublisherIds(siteUrl: string, identity?: BusinessIdentityRenderState | null): string[] {
	const ids = new Set<string>();
	for (const family of ["organization", "person"] as const) {
		const entityId = businessIdentityEntityIdFor(siteUrl, family);
		for (const id of entityId ? businessIdentityOwnedIds(entityId) : []) ids.add(id);
	}
	if (identity?.state === "valid") for (const id of businessIdentityReferenceIds(identity.record)) ids.add(id);
	return [...ids];
}

export type PublisherOutputReason =
	| "automatic"
	| "policy_none"
	| "policy_unknown"
	| "identity_unreadable"
	| "custom_definition";

export interface PublisherOutputDecision {
	/** For the preset builder and the reference resolver; undefined keeps the legacy settings publisher. */
	publisher: SchemaPublisherSource | undefined;
	/** The source automatic mode selects; null while automatic output is off or unknown. */
	source: "business" | "legacy" | null;
	reason: PublisherOutputReason;
	conflicts: BusinessIdentityPageConflict[];
	/** Site publisher IDs that applicable custom graphs define on this page; no preset may define them there. */
	customIds: string[];
	/** True when the identity's full definition is the publisher graph on this page. */
	fullDefinition: boolean;
}

/**
 * The automatic publisher for one page. `customs` are the custom graphs the
 * caller will emit there, after template expansion, and are never changed.
 * `identity` is read only in automatic mode; null means it was not read.
 * Off, unknown and unreadable identity states, and a custom graph defining the
 * selected publisher's ID, all give `none`: no publisher graph, no publisher or
 * provider links, no inline publisher facts and no reference expansion.
 */
export function resolvePublisherOutput(input: {
	ownership: PublisherOwnershipEffective;
	identity: BusinessIdentityRenderState | null;
	settings: { siteUrl: string; publisherType?: "organization" | "person" };
	page: Pick<PublicPageContext, "path" | "url" | "content">;
	customs: ReadonlyArray<{ id: string; graph: unknown }>;
}): PublisherOutputDecision {
	const customIds = [
		...new Set(customOwnedIdConflicts(input.customs, sitePublisherIds(input.settings.siteUrl, input.identity)).flatMap((conflict) => conflict.ownedIds)),
	];
	const none = (
		reason: PublisherOutputReason,
		source: PublisherOutputDecision["source"],
		conflicts: BusinessIdentityPageConflict[] = [],
	): PublisherOutputDecision => ({ publisher: { kind: "none" }, source, reason, conflicts, customIds, fullDefinition: false });
	if (input.ownership === "none") return none("policy_none", null);
	if (input.ownership === "unknown") return none("policy_unknown", null);
	const identity: BusinessIdentityRenderState = input.identity ?? { state: "unavailable" };
	if (identity.state === "invalid" || identity.state === "unavailable") return none("identity_unreadable", "business");
	if (identity.state === "valid" && identity.record.active) {
		const resolved = resolveBusinessIdentityGraphs({ identity, siteUrl: input.settings.siteUrl, page: input.page, customs: input.customs });
		if (resolved.conflicts.length) return none("custom_definition", "business", resolved.conflicts);
		return { publisher: resolved.publisher, source: "business", reason: "automatic", conflicts: [], customIds, fullDefinition: resolved.fullDefinition };
	}
	const legacyId = legacyPublisherEntityId({ siteUrl: input.settings.siteUrl, publisherType: input.settings.publisherType ?? "organization" });
	const conflicts = customOwnedIdConflicts(input.customs, legacyId ? businessIdentityOwnedIds(legacyId) : []);
	if (conflicts.length) return none("custom_definition", "legacy", conflicts);
	return { publisher: undefined, source: "legacy", reason: "automatic", conflicts: [], customIds, fullDefinition: false };
}

/** The site publisher ID a preset graph would define although a custom graph on the page defines it. */
export function presetDefinesCustomPublisherId(graph: unknown, customIds: readonly string[]): string | null {
	if (!customIds.length) return null;
	const ids = new Set(customIds);
	return schemaDefinitionIdentities(graph).find((id) => ids.has(id)) ?? null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface PublisherOwnershipGates {
	schemaModule: boolean;
	sitePublisherPreset: boolean;
}

export interface PublisherOwnershipHost {
	kv: PublisherOwnershipKv;
	readSite(): Promise<{ siteName: string; siteUrl: string; publisherType: "organization" | "person" }>;
	readIdentity(): Promise<BusinessIdentityRenderState>;
	/**
	 * Custom schema rows whose scope is global, empty or missing, with the scope
	 * normalized to `global`; at most `limit + 1`. Throws when the read fails.
	 */
	readGlobalCustomSchemas(limit: number): Promise<BusinessIdentityCustomRecord[]>;
	readGates(): Promise<PublisherOwnershipGates>;
}

export interface PublisherOwnershipView {
	storageVersion: typeof PUBLISHER_OWNERSHIP_STORAGE_VERSION;
	state: PublisherOwnershipState["state"];
	mode: PublisherOwnershipMode | null;
	effective: PublisherOwnershipEffective;
	revision: string | null;
	writable: boolean;
	/** The separate switches that also decide output. Null when they could not be read. */
	gates: PublisherOwnershipGates | null;
	message: string | null;
}

export interface PublisherOwnershipPreflightDefinition {
	id: string;
	name: string;
	scope: string;
	ownedIds: string[];
}

export type PublisherOwnershipPreflightReason = "collision" | "incomplete" | "overflow" | "read_failed" | "publisher_unknown";

export type PublisherOwnershipPreflight =
	| { status: "clear"; source: "business" | "legacy"; entityId: string; checked: number }
	| {
			status: "refused";
			reason: PublisherOwnershipPreflightReason;
			source: "business" | "legacy" | null;
			entityId: string | null;
			checked: number;
			definitions: PublisherOwnershipPreflightDefinition[];
			/** Further definitions or unchecked records not listed. */
			more: number;
			message: string;
	  };

export type PublisherOwnershipWriteError =
	| "invalid"
	| "unsupported"
	| "unreadable"
	| "conflict"
	| "preflight"
	| "unconfirmed"
	| "storage_uncertain";

export type PublisherOwnershipWriteResult =
	| {
			success: true;
			/** False when the saved mode already matched; nothing was written. */
			changed: boolean;
			ownership: PublisherOwnershipView;
			preflight?: Extract<PublisherOwnershipPreflight, { status: "clear" }>;
	  }
	| {
			success: false;
			error: PublisherOwnershipWriteError;
			message: string;
			ownership?: PublisherOwnershipView;
			preflight?: Extract<PublisherOwnershipPreflight, { status: "refused" }>;
			/** For an unconfirmed write: the mode it tried to store, for the later check. */
			intended?: PublisherOwnershipMode;
	  };

/** `matches_requested`: the stored mode is the one requested; `matches_loaded`: the loaded revision is still stored. */
export type PublisherOwnershipCheck = "matches_requested" | "matches_loaded" | "differs";

export const PUBLISHER_OWNERSHIP_MESSAGES = {
	unsupported: "This site's storage cannot compare revisions, so the publisher output setting can be viewed but not changed here.",
	corrupt: "The saved publisher output setting is damaged, so ownership is unknown and this plugin adds no automatic publisher. Nothing was changed. Repair it as described in the README.",
	unavailable: "The publisher output setting could not be read, so ownership is unknown and this plugin adds no automatic publisher. Nothing was changed. Reload to try again.",
	conflict: "The publisher output setting changed after you opened it. Nothing was saved.",
	unconfirmed: "The change could not be confirmed. Reload the saved setting before trying again.",
	uncertain: "Storage refused the change although the setting appears unchanged. Nothing more was attempted.",
	invalid: "Choose automatic or no automatic publisher, with the revision the setting was loaded from.",
} as const;

async function readGates(host: PublisherOwnershipHost): Promise<PublisherOwnershipGates | null> {
	try {
		return await host.readGates();
	} catch {
		return null;
	}
}

export async function buildPublisherOwnershipView(
	host: PublisherOwnershipHost,
	known?: PublisherOwnershipState,
): Promise<PublisherOwnershipView> {
	const [state, gates] = await Promise.all([known ?? readPublisherOwnership(host.kv), readGates(host)]);
	const supported = typeof host.kv.compareAndSet === "function" && typeof host.kv.getVersioned === "function";
	return {
		storageVersion: PUBLISHER_OWNERSHIP_STORAGE_VERSION,
		state: state.state,
		mode: state.state === "valid" ? state.mode : null,
		effective: publisherOwnershipEffective(state),
		revision: state.revision,
		writable: supported && (state.state === "absent" || state.state === "valid"),
		gates,
		message: !supported
			? PUBLISHER_OWNERSHIP_MESSAGES.unsupported
			: state.state === "corrupt"
				? PUBLISHER_OWNERSHIP_MESSAGES.corrupt
				: state.state === "unavailable"
					? PUBLISHER_OWNERSHIP_MESSAGES.unavailable
					: null,
	};
}

/** Reads once. With `check`, compares the stored setting with a write whose outcome was not confirmed. Never writes. */
export async function inspectPublisherOwnership(
	host: PublisherOwnershipHost,
	input: { check?: { mode: PublisherOwnershipMode; expectedRevision: string | null } } = {},
): Promise<{ ownership: PublisherOwnershipView; check?: PublisherOwnershipCheck }> {
	const state = await readPublisherOwnership(host.kv);
	const ownership = await buildPublisherOwnershipView(host, state);
	const check = input.check;
	if (!check) return { ownership };
	// Equal values do not show which writer stored them, only what is stored now.
	if (state.state === "valid" && state.mode === check.mode && state.revision !== check.expectedRevision) {
		return { ownership, check: "matches_requested" };
	}
	const loaded = check.expectedRevision === null ? state.state === "absent" : state.revision === check.expectedRevision;
	return { ownership, check: loaded ? "matches_loaded" : "differs" };
}

function refused(
	reason: PublisherOwnershipPreflightReason,
	message: string,
	extra: Partial<Extract<PublisherOwnershipPreflight, { status: "refused" }>> = {},
): Extract<PublisherOwnershipPreflight, { status: "refused" }> {
	return { status: "refused", reason, source: null, entityId: null, checked: 0, definitions: [], more: 0, message, ...extra };
}

const BOUNDARY = "Only custom schemas that apply to the whole site were checked. Per-page and per-entry schemas are handled when each page renders, and theme or other plugin markup is not checked.";

/**
 * The bounded check before automatic output resumes: the publisher that will
 * resume against custom schemas that apply to the whole site. It reads no
 * entries and never claims the whole site was verified.
 */
export async function publisherOwnershipPreflight(host: PublisherOwnershipHost): Promise<PublisherOwnershipPreflight> {
	let site: Awaited<ReturnType<PublisherOwnershipHost["readSite"]>>;
	let identity: BusinessIdentityRenderState;
	try {
		[site, identity] = await Promise.all([host.readSite(), host.readIdentity()]);
	} catch {
		return refused("read_failed", "The site settings could not be read, so automatic publisher output was not turned back on.");
	}
	if (identity.state === "invalid" || identity.state === "unavailable") {
		return refused("publisher_unknown", "The business identity cannot be read, so the publisher that would resume is unknown. Repair or reload it first.", { source: "business" });
	}
	const active = identity.state === "valid" && identity.record.active ? identity.record : null;
	const source = active ? "business" : "legacy";
	const entityId = active ? active.entityId : legacyPublisherEntityId(site);
	const owned = active ? businessIdentityReferenceIds(active) : entityId ? businessIdentityOwnedIds(entityId) : [];
	let records: BusinessIdentityCustomRecord[];
	try {
		records = await host.readGlobalCustomSchemas(PUBLISHER_OWNERSHIP_PREFLIGHT_LIMIT);
	} catch {
		return refused("read_failed", "Custom schemas could not be read, so automatic publisher output was not turned back on.", { source, entityId });
	}
	if (records.length > PUBLISHER_OWNERSHIP_PREFLIGHT_LIMIT) {
		return refused(
			"overflow",
			`More than ${PUBLISHER_OWNERSHIP_PREFLIGHT_LIMIT} custom schemas apply to the whole site, which is more than this check reads. Remove or rescope some first.`,
			{ source, entityId },
		);
	}
	if (!owned.length) return { status: "clear", source, entityId, checked: records.length };
	const definitions: PublisherOwnershipPreflightDefinition[] = [];
	const unchecked: string[] = [];
	for (const record of records) {
		if (!record.enabled || record.target) continue;
		let parsed: unknown;
		try {
			parsed = validateCustomJsonLd(record.json);
		} catch {
			continue;
		}
		const label = record.name || record.id;
		// A site-wide record reaches pages this check does not read, so an ID that
		// page values could complete into an owned ID cannot be cleared here.
		const dependence = ownedIdDependsOnPage(parsed, owned, site.siteName, site.siteUrl);
		if (!dependence.complete || dependence.possible) {
			unchecked.push(label);
			continue;
		}
		const scan = graphOwnedDefinitions(parsed, owned, businessIdentityTemplateContexts({ record, siteName: site.siteName, siteUrl: site.siteUrl }));
		if (!scan.complete) unchecked.push(label);
		else if (scan.ids.length) definitions.push({ id: record.id, name: record.name, scope: record.scope, ownedIds: scan.ids });
	}
	const listed = definitions.slice(0, PUBLISHER_OWNERSHIP_LISTED_DEFINITIONS);
	if (definitions.length) {
		return refused(
			"collision",
			`Custom schema that applies to the whole site defines ${entityId}, so turning automatic output back on would give that publisher two definitions. Change it to reference the ID, turn it off, or keep automatic output off. ${BOUNDARY}`,
			{ source, entityId, checked: records.length, definitions: listed, more: definitions.length - listed.length },
		);
	}
	if (unchecked.length) {
		return refused(
			"incomplete",
			`Custom schema "${unchecked[0]}" builds an @id from page values or is nested too deeply, so it cannot be checked for ${entityId}. Simplify its @id or turn it off first.`,
			{ source, entityId, checked: records.length, more: unchecked.length - 1 },
		);
	}
	return { status: "clear", source, entityId, checked: records.length };
}

/** Changes the mode under the loaded revision. Returning to automatic output runs the preflight first. */
export async function savePublisherOwnership(host: PublisherOwnershipHost, input: unknown): Promise<PublisherOwnershipWriteResult> {
	const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
	const mode = source?.mode;
	const expectedRevision = source?.expectedRevision;
	if (
		!source ||
		!(PUBLISHER_OWNERSHIP_MODES as readonly unknown[]).includes(mode) ||
		!Object.hasOwn(source, "expectedRevision") ||
		(expectedRevision !== null && !validRevision(expectedRevision))
	) {
		return { success: false, error: "invalid", message: PUBLISHER_OWNERSHIP_MESSAGES.invalid };
	}
	const requested = mode as PublisherOwnershipMode;
	const kv = host.kv;
	if (typeof kv.compareAndSet !== "function" || typeof kv.getVersioned !== "function") {
		return { success: false, error: "unsupported", message: PUBLISHER_OWNERSHIP_MESSAGES.unsupported };
	}
	const state = await readPublisherOwnership(kv);
	if (state.state === "corrupt" || state.state === "unavailable") {
		return {
			success: false,
			error: "unreadable",
			message: state.state === "corrupt" ? PUBLISHER_OWNERSHIP_MESSAGES.corrupt : PUBLISHER_OWNERSHIP_MESSAGES.unavailable,
			ownership: await buildPublisherOwnershipView(host, state),
		};
	}
	if (state.revision !== expectedRevision) {
		return { success: false, error: "conflict", message: PUBLISHER_OWNERSHIP_MESSAGES.conflict, ownership: await buildPublisherOwnershipView(host, state) };
	}
	if (publisherOwnershipEffective(state) === requested) {
		return { success: true, changed: false, ownership: await buildPublisherOwnershipView(host, state) };
	}
	let preflight: Extract<PublisherOwnershipPreflight, { status: "clear" }> | undefined;
	if (requested === "automatic") {
		const checked = await publisherOwnershipPreflight(host);
		if (checked.status === "refused") {
			return { success: false, error: "preflight", message: checked.message, preflight: checked, ownership: await buildPublisherOwnershipView(host, state) };
		}
		preflight = checked;
	}
	const record: PublisherOwnershipRecord = { version: PUBLISHER_OWNERSHIP_STORAGE_VERSION, mode: requested };
	let written: unknown;
	try {
		written = await kv.compareAndSet(PUBLISHER_OWNERSHIP_KEY, state.revision, record);
	} catch {
		return { success: false, error: "unconfirmed", message: PUBLISHER_OWNERSHIP_MESSAGES.unconfirmed, intended: requested };
	}
	const result = written as { applied?: unknown; revision?: unknown } | null | undefined;
	if (!result || typeof result.applied !== "boolean" || (result.applied && !validRevision(result.revision))) {
		return { success: false, error: "unconfirmed", message: PUBLISHER_OWNERSHIP_MESSAGES.unconfirmed, intended: requested };
	}
	if (result.applied) {
		const saved: PublisherOwnershipState = { state: "valid", revision: result.revision as string, mode: requested };
		return { success: true, changed: true, ownership: await buildPublisherOwnershipView(host, saved), ...(preflight ? { preflight } : {}) };
	}
	const after = await readPublisherOwnership(kv);
	const ownership = await buildPublisherOwnershipView(host, after);
	// A refusal while the loaded revision is still readable does not show why it was refused.
	if (after.state === "absent" || after.state === "valid") {
		if (after.revision === state.revision) return { success: false, error: "storage_uncertain", message: PUBLISHER_OWNERSHIP_MESSAGES.uncertain, ownership };
		return { success: false, error: "conflict", message: PUBLISHER_OWNERSHIP_MESSAGES.conflict, ownership };
	}
	return { success: false, error: "unreadable", message: PUBLISHER_OWNERSHIP_MESSAGES.unavailable, ownership };
}
