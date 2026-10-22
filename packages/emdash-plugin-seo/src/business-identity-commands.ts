// Business identity commands shared by the native admin and a future sandbox
// renderer. Every write validates, reads the record once, compares the
// revision the editor loaded, runs the ownership and page checks and then
// makes one compare-and-set. A thrown write is reported as unconfirmed and
// settled by one read, never retried, rolled back or overwritten here.
// No React, DOM, Node or SQL dependencies.

import {
	BUSINESS_IDENTITY_KV_KEY,
	BUSINESS_IDENTITY_MAX_BYTES,
	BUSINESS_IDENTITY_SETTINGS_KEY,
	BUSINESS_IDENTITY_STORAGE_VERSION,
	businessIdentityEntityFamily,
	businessIdentityEntityIdFor,
	businessIdentityEntityOrigin,
	businessIdentityFactsForKind,
	businessIdentityFactsOf,
	businessIdentityFamily,
	businessIdentityFullGraph,
	businessIdentityMinimalGraph,
	businessIdentityNotices,
	businessIdentityOwnedIds,
	businessIdentityRecordBytes,
	businessIdentityTemplateContexts,
	customRecordAppliesToEntry,
	customRecordEntryRef,
	customRecordReachesCollection,
	graphOwnedDefinitions,
	ownedIdDependsOnPage,
	legacyBusinessIdentityDraft,
	legacyPublisherEntityId,
	sameBusinessIdentityRecord,
	sameBusinessMatches,
	sameBusinessNodes,
	validateBusinessIdentityFacts,
	validateBusinessIdentityRecord,
	walkJsonLdNodes,
	type BusinessIdentityCustomRecord,
	type BusinessIdentityFacts,
	type BusinessIdentityFamily,
	type BusinessIdentityFieldErrors,
	type BusinessIdentityLegacySettings,
	type BusinessIdentityNotice,
	type BusinessIdentityOwnedDefinition,
	type BusinessIdentityRecord,
	type BusinessIdentityRenderState,
	type BusinessIdentitySameBusinessWarning,
	type BusinessIdentityTarget,
	type BusinessIdentityTemplateContext,
} from "./business-identity.ts";
import { applyVarsDeep, validateCustomJsonLd } from "./lib.ts";
import {
	publisherOwnershipEffective,
	publisherOwnershipOptedOut,
	type PublisherOwnershipEffective,
	type PublisherOwnershipState,
} from "./publisher-ownership.ts";

const MAX_REVISION_LENGTH = 128;
export const BUSINESS_IDENTITY_PAGE_LIMIT = 25;

export interface BusinessIdentityStore {
	getVersioned(): Promise<{ value: unknown; revision: string } | null>;
	/** Absent when the host can read revisions but not compare them on write; the view is then read-only. */
	compareAndSet?(
		expectedRevision: string | null,
		value: unknown,
	): Promise<{ applied: true; revision: string } | { applied: false }>;
}

interface VersionedAccess {
	getVersioned?: (key: string) => Promise<unknown>;
	compareAndSet?: (key: string, expectedRevision: string | null, value: unknown) => Promise<unknown>;
	compareAndDelete?: (key: string, expectedRevision: string) => Promise<unknown>;
}

function hasVersionedMethods(access: unknown): access is Required<VersionedAccess> {
	const candidate = access as VersionedAccess | null | undefined;
	return (
		typeof candidate?.getVersioned === "function" &&
		typeof candidate.compareAndSet === "function" &&
		typeof candidate.compareAndDelete === "function"
	);
}

function hasVersionedRead(access: unknown): access is Pick<Required<VersionedAccess>, "getVersioned"> {
	return typeof (access as VersionedAccess | null | undefined)?.getVersioned === "function";
}

/**
 * Plugin settings when they offer the versioned methods, otherwise the KV
 * alias of the same options row. Reads need a versioned read, so a stored
 * JSON null is never mistaken for a missing row; writes need all three
 * versioned methods. Null when no versioned read exists.
 */
export function businessIdentityStoreFor(ctx: { settings?: unknown; kv?: unknown }): BusinessIdentityStore | null {
	const [access, key, writable] = hasVersionedMethods(ctx.settings)
		? [ctx.settings, BUSINESS_IDENTITY_SETTINGS_KEY, true]
		: hasVersionedMethods(ctx.kv)
			? [ctx.kv, BUSINESS_IDENTITY_KV_KEY, true]
			: hasVersionedRead(ctx.settings)
				? [ctx.settings, BUSINESS_IDENTITY_SETTINGS_KEY, false]
				: hasVersionedRead(ctx.kv)
					? [ctx.kv, BUSINESS_IDENTITY_KV_KEY, false]
					: [null, "", false];
	if (!access) return null;
	const versionedAccess = access as VersionedAccess & Pick<Required<VersionedAccess>, "getVersioned">;
	const store: BusinessIdentityStore = {
		async getVersioned() {
			const stored = (await versionedAccess.getVersioned(key)) as { value?: unknown; revision?: unknown } | null | undefined;
			if (stored === null || stored === undefined) return null;
			if (typeof stored !== "object" || !Object.hasOwn(stored, "value") || !validRevision(stored.revision)) {
				throw new Error("business_identity_invalid_revision");
			}
			return { value: stored.value, revision: stored.revision };
		},
	};
	if (writable && versionedAccess.compareAndSet) {
		const compareAndSet = versionedAccess.compareAndSet;
		store.compareAndSet = async (expectedRevision, value) => {
			const result = (await compareAndSet(key, expectedRevision, value)) as
				| { applied?: unknown; revision?: unknown }
				| null
				| undefined;
			if (!result || typeof result.applied !== "boolean") throw new Error("business_identity_invalid_write_result");
			if (!result.applied) return { applied: false };
			if (!validRevision(result.revision)) throw new Error("business_identity_invalid_write_result");
			return { applied: true, revision: result.revision };
		};
	}
	return store;
}

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_REVISION_LENGTH;
}

/** One read for page output. Anything other than a missing row or a valid record fails closed. */
export async function readBusinessIdentityRenderState(store: BusinessIdentityStore | null): Promise<BusinessIdentityRenderState> {
	if (!store) return { state: "unavailable" };
	let stored: { value: unknown; revision: string } | null;
	try {
		stored = await store.getVersioned();
	} catch {
		return { state: "unavailable" };
	}
	if (!stored) return { state: "absent" };
	const validation = validateBusinessIdentityRecord(stored.value);
	return validation.success ? { state: "valid", record: validation.value } : { state: "invalid" };
}

export type BusinessIdentityStoredState =
	| { state: "absent"; revision: null }
	| { state: "valid"; revision: string; record: BusinessIdentityRecord }
	| { state: "invalid"; revision: string; issues: BusinessIdentityFieldErrors; raw: unknown }
	| { state: "corrupt"; revision: null }
	| { state: "read_unavailable"; revision: null; reason: "unsupported" | "failed" };

function parseFailure(error: unknown): boolean {
	return error instanceof SyntaxError || /JSON|Unexpected token|Unexpected end/i.test(String((error as Error)?.message ?? error));
}

/** Two consecutive JSON parse failures mark a row corrupt; any other failure is a read problem. */
export async function readBusinessIdentityStored(store: BusinessIdentityStore | null): Promise<BusinessIdentityStoredState> {
	if (!store) return { state: "read_unavailable", revision: null, reason: "unsupported" };
	let stored: { value: unknown; revision: string } | null = null;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			stored = await store.getVersioned();
			break;
		} catch (error: unknown) {
			if (!parseFailure(error)) return { state: "read_unavailable", revision: null, reason: "failed" };
			if (attempt === 1) return { state: "corrupt", revision: null };
		}
	}
	if (!stored) return { state: "absent", revision: null };
	const validation = validateBusinessIdentityRecord(stored.value);
	return validation.success
		? { state: "valid", revision: stored.revision, record: validation.value }
		: { state: "invalid", revision: stored.revision, issues: validation.errors, raw: stored.value };
}

export interface BusinessIdentityCollection {
	collection: string;
	label: string;
}

export interface BusinessIdentityPageCandidate {
	entryId: string;
	title: string;
	locale: string | null;
	slug: string | null;
	url: string;
}

export type BusinessIdentityTargetResolution =
	| {
			status: "ok";
			url: string;
			title: string;
			locale: string | null;
			slug: string | null;
			/** Template variable values on that page. */
			vars: Record<string, string>;
			/** The entry's content, for the entry-data local business comparison. */
			data?: unknown;
	  }
	| { status: "missing" | "unpublished" | "no_url" | "unavailable" };

export interface BusinessIdentityHost {
	/** Null when the host cannot compare revisions; the view is then read-only. */
	store: BusinessIdentityStore | null;
	/** The automatic publisher ownership record; a host without it is treated as automatic. */
	readPublisherOwnership?(): Promise<PublisherOwnershipState>;
	readSettings(): Promise<BusinessIdentityLegacySettings>;
	readSwitches(): Promise<{ moduleEnabled: boolean; presetEnabled: boolean; localBusinessPreset: boolean }>;
	/** Public, routable content types; one discovery. */
	listCollections(): Promise<{ available: boolean; collections: BusinessIdentityCollection[] }>;
	listTargetCandidates(
		collection: string,
		limit: number,
		cursor?: string,
	): Promise<{ items: BusinessIdentityPageCandidate[]; cursor?: string }>;
	resolveTarget(target: BusinessIdentityTarget): Promise<BusinessIdentityTargetResolution>;
	/** Every stored custom record; throws when the read is incomplete or past the 500-record cap. */
	readAllCustomSchemas(): Promise<BusinessIdentityCustomRecord[]>;
	/**
	 * Template variables of the entry a record's scope names, by ID. `none`: the
	 * collection has no public pages; `missing`: no entry has that ID (the
	 * scope may name a slug, which is not looked up).
	 */
	resolveEntryVars?(
		collection: string,
		identifier: string,
	): Promise<{ status: "ok"; vars: BusinessIdentityTemplateContext } | { status: "none" | "missing" | "unavailable" }>;
	/** The entry-data local business node for the selected page, when that preset applies. */
	targetLocalBusinessNode?(resolution: Extract<BusinessIdentityTargetResolution, { status: "ok" }>, target: BusinessIdentityTarget): Record<string, unknown> | null;
	now(): string;
}

export type BusinessIdentityTargetStatus =
	| { status: "ok"; url: string; title: string; locale: string | null }
	| { status: "missing" | "unpublished" | "no_url" | "unavailable"; message: string };

const TARGET_MESSAGES: Record<"missing" | "unpublished" | "no_url" | "unavailable", string> = {
	missing: "The selected page no longer exists. Choose another page.",
	unpublished: "The selected page is not published. Publish it or choose another page.",
	no_url: "The selected page has no public address. Check the site URL and the page's route, or choose another page.",
	unavailable: "The selected page could not be checked. Nothing was changed.",
};

function targetStatus(resolution: BusinessIdentityTargetResolution, target: BusinessIdentityTarget): BusinessIdentityTargetStatus {
	if (resolution.status === "ok") {
		return {
			status: "ok",
			url: resolution.url,
			title: target.kind === "content" ? resolution.title || target.title : "Homepage",
			locale: resolution.locale,
		};
	}
	return { status: resolution.status, message: TARGET_MESSAGES[resolution.status] };
}

export interface BusinessIdentityIdUsage {
	id: string;
	name: string;
	scope: string;
	defines: string[];
	references: string[];
}

export type BusinessIdentityOwnership =
	| { status: "complete"; definitions: BusinessIdentityOwnedDefinition[]; sameBusiness: BusinessIdentitySameBusinessWarning[] }
	| { status: "incomplete"; message: string };

export interface BusinessIdentityTransitionOption {
	to: "origin" | "person" | "organization";
	entityId: string;
	/** Saved facts a Person cannot carry; they are not kept in the new record. */
	dropped: string[];
	usage: BusinessIdentityIdUsage[];
	/** False when the custom schemas could not all be read or inspected. */
	usageComplete: boolean;
}

/** What replacing an invalid record keeps: its stored ID, family and state, when the ID is usable. */
export interface BusinessIdentityReplacement {
	entityId: string;
	family: BusinessIdentityFamily;
	active: boolean;
	organizationReferenceAliases: boolean;
}

export function businessIdentityReplacementOf(state: BusinessIdentityStoredState): BusinessIdentityReplacement | null {
	if (state.state !== "invalid") return null;
	const raw = dataRecord(state.raw) ?? {};
	const entityId = typeof raw.entityId === "string" ? raw.entityId : "";
	const family = businessIdentityEntityFamily(entityId);
	if (!family) return null;
	return {
		entityId,
		family,
		active: raw.active === true,
		organizationReferenceAliases: family === "person" && raw.organizationReferenceAliases === true,
	};
}

export interface BusinessIdentityView {
	storageVersion: typeof BUSINESS_IDENTITY_STORAGE_VERSION;
	state: BusinessIdentityStoredState["state"];
	revision: string | null;
	record: BusinessIdentityRecord | null;
	issues: BusinessIdentityFieldErrors;
	writable: boolean;
	message: string | null;
	siteName: string;
	siteUrl: string;
	legacy: {
		publisherType: "organization" | "person";
		entityId: string;
		draft: Record<string, unknown>;
		issues: BusinessIdentityFieldErrors;
	};
	/** For an invalid record: what a replacement keeps. Null means it takes the legacy publisher ID. */
	replacement: BusinessIdentityReplacement | null;
	switches: { moduleEnabled: boolean; presetEnabled: boolean };
	/** Whether Shipit adds an automatic publisher at all, from the separate ownership record. */
	publisherOutput: PublisherOwnershipEffective;
	collections: { available: boolean; items: BusinessIdentityCollection[] };
	target: BusinessIdentityTargetStatus | null;
	ownership: BusinessIdentityOwnership | null;
	notices: BusinessIdentityNotice[];
	output: { full: Record<string, unknown>; minimal: Record<string, unknown> } | null;
	usage: BusinessIdentityIdUsage[] | null;
	transitions: BusinessIdentityTransitionOption[];
}

/** The legacy publisher reviewed before creating an identity in another family. */
export interface BusinessIdentityPublisherChange {
	confirmed: true;
	fromEntityId: string;
	fromType: BusinessIdentityFamily;
}

export type BusinessIdentityCheck = "matches_requested" | "matches_loaded" | "differs";

export type BusinessIdentityWriteError =
	| "invalid"
	| "owned_id_defined"
	| "collision_check_incomplete"
	| "conflict"
	| "invalid_stored"
	| "unavailable"
	| "unconfirmed"
	| "storage_uncertain";

export type BusinessIdentityWriteResult =
	| {
			success: true;
			record: BusinessIdentityRecord;
			revision: string;
			/** Custom records that define or reference the old or new ID; nothing was rewritten. */
			usage?: BusinessIdentityIdUsage[];
			dropped?: string[];
			/** A replaced invalid record had no usable ID, so the current publisher ID was taken. */
			adoptedId?: true;
	  }
	| {
			success: false;
			error: BusinessIdentityWriteError;
			errors: BusinessIdentityFieldErrors;
			definitions?: BusinessIdentityOwnedDefinition[];
			current?: { state: BusinessIdentityStoredState["state"]; revision: string | null; record: BusinessIdentityRecord | null };
			/** For an unconfirmed write: the complete record it tried to store, for the later check. */
			intended?: BusinessIdentityRecord;
	  };

const MESSAGES = {
	unwritable: "This site's storage cannot compare revisions, so the business identity can be viewed but not changed here.",
	unreadable: "The saved business identity could not be read. Nothing was changed.",
	corrupt: "The saved business identity is damaged and cannot be read. Nothing was changed. Follow the recovery steps in the README.",
	changed: "The business identity changed after you opened it. Nothing was saved.",
	unconfirmed: "The change could not be confirmed. Check the saved business identity before editing again.",
	uncertain: "Storage refused the change although the record appears unchanged. Nothing more was attempted. This can happen when an older storage row shadows the record.",
	invalidStored: "The saved business identity is invalid. Confirm that saving replaces it.",
	incomplete: "Custom schemas could not all be checked for the identity's ID, so nothing was saved.",
	noSiteUrl: "Set the site URL in the site settings before adopting a business identity. Its ID is built from that address.",
} as const;

function failure(
	error: BusinessIdentityWriteError,
	message: string | BusinessIdentityFieldErrors,
	extra: Partial<Extract<BusinessIdentityWriteResult, { success: false }>> = {},
): BusinessIdentityWriteResult {
	return { success: false, error, errors: typeof message === "string" ? { _form: message } : message, ...extra };
}

function currentOf(state: BusinessIdentityStoredState): NonNullable<Extract<BusinessIdentityWriteResult, { success: false }>["current"]> {
	return { state: state.state, revision: state.revision, record: state.state === "valid" ? state.record : null };
}

function dataRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Entries resolved for one command at most; a check that needs more is incomplete. */
export const BUSINESS_IDENTITY_ENTRY_LOOKUP_LIMIT = 25;

export interface CustomRecordCheckState {
	lookups: number;
	/** The selected page, resolved once and only when a record needs it. */
	target?: BusinessIdentityTargetResolution;
}

/**
 * Owned IDs one custom record defines on the pages it reaches. Site
 * variables are always applied. Only when an ID depends on page variables and
 * could become an owned ID are the selected page and the exact entry the
 * record's scope names resolved; anything that cannot be resolved makes the
 * check incomplete, never clean.
 */
export async function customRecordOwnedIds(
	host: Pick<BusinessIdentityHost, "resolveEntryVars" | "resolveTarget">,
	input: {
		record: BusinessIdentityCustomRecord;
		parsed: unknown;
		owned: readonly string[];
		settings: Pick<BusinessIdentityLegacySettings, "siteName" | "siteUrl">;
		identityTarget: BusinessIdentityTarget;
		state: CustomRecordCheckState;
	},
): Promise<{ ids: string[] } | { incomplete: string }> {
	const { record, settings } = input;
	const deep = `The custom schema "${record.name || record.scope}" is nested too deeply to check for the identity's ID.`;
	const unresolved = `The page that the custom schema "${record.name || record.scope}" applies to could not be checked for the identity's ID.`;
	const dependence = ownedIdDependsOnPage(input.parsed, input.owned, settings.siteName, settings.siteUrl);
	if (!dependence.complete) return { incomplete: deep };
	// A record that reaches pages which are not listed here (every page of the
	// site or of a collection) cannot be checked when a page value could supply
	// the fragment itself; only its address part is covered by the pages resolved below.
	if (dependence.fragmentFromPage && !customRecordEntryRef(record)) {
		return {
			incomplete: `The custom schema "${record.name || record.scope}" builds an @id fragment from page values, so it cannot be checked for every page it reaches.`,
		};
	}
	let targetEntry: { collection: string; entryId: string; slug: string | null; vars: BusinessIdentityTemplateContext } | null = null;
	const entries: BusinessIdentityTemplateContext[] = [];
	if (dependence.possible) {
		const target = input.identityTarget;
		if (target.kind === "content" && customRecordReachesCollection(record, target.collection)) {
			input.state.target ??= await host.resolveTarget(target).catch(() => ({ status: "unavailable" as const }));
			const resolution = input.state.target;
			if (resolution.status !== "ok") return { incomplete: unresolved };
			targetEntry = { collection: target.collection, entryId: target.entryId, slug: resolution.slug, vars: resolution.vars };
		}
		const ref = customRecordEntryRef(record);
		const isTarget = ref && targetEntry && ref.collection === targetEntry.collection &&
			(ref.identifier === targetEntry.entryId || ref.identifier === targetEntry.slug);
		if (ref && !isTarget) {
			input.state.lookups += 1;
			if (!host.resolveEntryVars || input.state.lookups > BUSINESS_IDENTITY_ENTRY_LOOKUP_LIMIT) return { incomplete: unresolved };
			const entry = await host.resolveEntryVars(ref.collection, ref.identifier).catch(() => ({ status: "unavailable" as const }));
			if (entry.status === "ok") entries.push(entry.vars);
			else if (entry.status !== "none") return { incomplete: unresolved };
		}
	}
	const contexts = businessIdentityTemplateContexts({ record, siteName: settings.siteName, siteUrl: settings.siteUrl, target: targetEntry, entries });
	const scan = graphOwnedDefinitions(input.parsed, input.owned, contexts);
	return scan.complete ? { ids: scan.ids } : { incomplete: deep };
}

/** Owned definitions everywhere, and same-business warnings on the selected page. */
export async function businessIdentityOwnership(
	host: BusinessIdentityHost,
	input: {
		entityId: string;
		facts: BusinessIdentityFacts;
		settings: BusinessIdentityLegacySettings;
		target: BusinessIdentityTargetResolution | null;
		localBusinessPreset: boolean;
		/** Records already read for this request; null when that read was incomplete. */
		records?: BusinessIdentityCustomRecord[] | null;
	},
): Promise<BusinessIdentityOwnership> {
	const records = input.records === undefined ? await readRecords(host) : input.records;
	if (!records) return { status: "incomplete", message: MESSAGES.incomplete };
	const owned = businessIdentityOwnedIds(input.entityId);
	const facts = input.facts;
	const target = input.facts.target;
	const resolution = input.target?.status === "ok" ? input.target : null;
	const targetEntry = target.kind === "content" && resolution
		? { collection: target.collection, entryId: target.entryId, slug: resolution.slug, vars: resolution.vars }
		: null;
	const definitions: BusinessIdentityOwnedDefinition[] = [];
	const sameBusiness: BusinessIdentitySameBusinessWarning[] = [];
	const state: CustomRecordCheckState = { lookups: 0, ...(input.target ? { target: input.target } : {}) };
	for (const record of records) {
		if (!record.enabled) continue;
		let parsed: unknown;
		try {
			parsed = validateCustomJsonLd(record.json);
		} catch {
			// Invalid JSON is never emitted, so it defines nothing.
			continue;
		}
		const contexts = businessIdentityTemplateContexts({
			record,
			siteName: input.settings.siteName,
			siteUrl: input.settings.siteUrl,
			target: targetEntry,
		});
		const scan = await customRecordOwnedIds(host, {
			record,
			parsed,
			owned,
			settings: input.settings,
			identityTarget: target,
			state,
		});
		if ("incomplete" in scan) return { status: "incomplete", message: `${scan.incomplete} Nothing was saved.` };
		if (scan.ids.length) definitions.push({ id: record.id, name: record.name, scope: record.scope, ownedIds: scan.ids });
		const onTarget = targetEntry
			? customRecordAppliesToEntry(record, targetEntry)
			: target.kind === "home" && record.scope === "global" && !record.target;
		if (!onTarget) continue;
		const graph = applyVarsDeep(parsed, contexts[contexts.length - 1]);
		const nodes = sameBusinessNodes(graph, facts, owned);
		if (!nodes.length) continue;
		const types = [...new Set(nodes.flatMap((node) => node.types))];
		sameBusiness.push({
			source: "custom",
			id: record.id,
			name: record.name,
			scope: record.scope,
			types,
			matched: [...new Set(nodes.flatMap((node) => node.matched))],
			deprecatedType: types.includes("ProfessionalService"),
		});
	}
	if (input.localBusinessPreset && resolution && targetEntry && host.targetLocalBusinessNode) {
		const node = host.targetLocalBusinessNode(resolution, target);
		const matched = node ? sameBusinessMatches(node, facts) : [];
		if (node && matched.length) {
			const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).filter(
				(item): item is string => typeof item === "string",
			);
			sameBusiness.push({
				source: "entry-data",
				id: "preset:localBusiness",
				name: "Local business from the page's content fields",
				scope: `${target.kind === "content" ? target.collection : ""}:${targetEntry.entryId}`,
				types,
				matched,
				deprecatedType: types.includes("ProfessionalService"),
			});
		}
	}
	return { status: "complete", definitions, sameBusiness };
}

async function readRecords(host: BusinessIdentityHost): Promise<BusinessIdentityCustomRecord[] | null> {
	try {
		return await host.readAllCustomSchemas();
	} catch {
		return null;
	}
}

/**
 * Records that define or reference any of the given IDs, in the contexts they
 * can reach. Null when a record is too deep to inspect completely.
 */
function idUsage(
	ids: readonly string[],
	settings: BusinessIdentityLegacySettings,
	records: readonly BusinessIdentityCustomRecord[],
): BusinessIdentityIdUsage[] | null {
	const wanted = new Set(ids);
	const usage: BusinessIdentityIdUsage[] = [];
	for (const record of records) {
		let parsed: unknown;
		try {
			parsed = validateCustomJsonLd(record.json);
		} catch {
			continue;
		}
		const defines = new Set<string>();
		const references = new Set<string>();
		for (const vars of businessIdentityTemplateContexts({ record, siteName: settings.siteName, siteUrl: settings.siteUrl })) {
			const complete = walkJsonLdNodes(applyVarsDeep(parsed, vars), (node) => {
				const id = typeof node["@id"] === "string" ? node["@id"].trim() : "";
				if (!wanted.has(id)) return;
				if (Object.keys(node).some((key) => key !== "@id" && key !== "@context")) defines.add(id);
				else references.add(id);
			});
			if (!complete) return null;
		}
		if (defines.size || references.size) {
			usage.push({ id: record.id, name: record.name, scope: record.scope, defines: [...defines], references: [...references] });
		}
	}
	return usage;
}

function transitionTarget(
	record: BusinessIdentityRecord,
	to: "origin" | "person" | "organization",
	siteUrl: string,
): { entityId: string; family: BusinessIdentityFamily } | null {
	const family = businessIdentityEntityFamily(record.entityId);
	const origin = businessIdentityEntityOrigin(record.entityId);
	if (!family || !origin) return null;
	if (to === "origin") {
		const entityId = businessIdentityEntityIdFor(siteUrl, family);
		return entityId && entityId !== record.entityId ? { entityId, family } : null;
	}
	if (to === family) return null;
	return { entityId: `${origin}/#${to}`, family: to };
}

async function siteState(host: BusinessIdentityHost) {
	const [settings, switches, ownership] = await Promise.all([
		host.readSettings(),
		host.readSwitches(),
		host.readPublisherOwnership ? host.readPublisherOwnership() : Promise.resolve<PublisherOwnershipState>({ state: "absent", revision: null }),
	]);
	return { settings, switches, ownership };
}

export async function buildBusinessIdentityView(
	host: BusinessIdentityHost,
	known?: BusinessIdentityStoredState,
): Promise<BusinessIdentityView> {
	const [state, { settings, switches, ownership: ownershipState }, collections] = await Promise.all([
		known ?? readBusinessIdentityStored(host.store),
		siteState(host),
		host.listCollections().catch(() => ({ available: false, collections: [] as BusinessIdentityCollection[] })),
	]);
	const legacy = legacyBusinessIdentityDraft(settings);
	const view: BusinessIdentityView = {
		storageVersion: BUSINESS_IDENTITY_STORAGE_VERSION,
		state: state.state,
		revision: state.revision,
		record: state.state === "valid" ? state.record : null,
		issues: state.state === "invalid" ? state.issues : {},
		writable: Boolean(host.store?.compareAndSet) && state.state !== "corrupt" && state.state !== "read_unavailable",
		message:
			!host.store?.compareAndSet
				? MESSAGES.unwritable
				: state.state === "corrupt"
					? MESSAGES.corrupt
					: state.state === "read_unavailable"
						? MESSAGES.unreadable
						: null,
		siteName: settings.siteName,
		siteUrl: settings.siteUrl,
		legacy: {
			publisherType: settings.publisherType,
			entityId: legacyPublisherEntityId(settings),
			draft: legacy.draft,
			issues: legacy.issues,
		},
		replacement: businessIdentityReplacementOf(state),
		switches: { moduleEnabled: switches.moduleEnabled, presetEnabled: switches.presetEnabled },
		publisherOutput: publisherOwnershipEffective(ownershipState),
		collections: { available: collections.available, items: collections.collections },
		target: null,
		ownership: null,
		notices: [],
		output: null,
		usage: null,
		transitions: [],
	};
	if (state.state !== "valid") return view;
	const record = state.record;
	const [resolution, records] = await Promise.all([
		host.resolveTarget(record.target).catch(() => ({ status: "unavailable" as const })),
		readRecords(host),
	]);
	view.target = targetStatus(resolution, record.target);
	view.ownership = await businessIdentityOwnership(host, {
		entityId: record.entityId,
		facts: businessIdentityFactsOf(record),
		settings,
		target: resolution,
		localBusinessPreset: switches.localBusinessPreset,
		records,
	});
	view.notices = businessIdentityNotices({
		facts: businessIdentityFactsOf(record),
		entityId: record.entityId,
		siteName: settings.siteName,
		siteUrl: settings.siteUrl,
		active: record.active,
		moduleEnabled: switches.moduleEnabled,
		presetEnabled: switches.presetEnabled,
		publisherOutput: view.publisherOutput,
	});
	view.output = {
		full: businessIdentityFullGraph(record, settings.siteUrl),
		minimal: businessIdentityMinimalGraph(record, settings.siteUrl),
	};
	view.usage = records ? idUsage(businessIdentityOwnedIds(record.entityId), settings, records) : null;
	for (const to of ["origin", "person", "organization"] as const) {
		const next = transitionTarget(record, to, settings.siteUrl);
		if (!next) continue;
		const ids = [...businessIdentityOwnedIds(record.entityId), ...businessIdentityOwnedIds(next.entityId)];
		const usage = records ? idUsage(ids, settings, records) : null;
		view.transitions.push({
			to,
			entityId: next.entityId,
			dropped: to === "person" ? businessIdentityFactsForKind(businessIdentityFactsOf(record), "Person").dropped : [],
			usage: usage ?? [],
			usageComplete: usage !== null,
		});
	}
	return view;
}

/** Reads the record once. With `check`, compares it with a write whose outcome was not confirmed. Never writes. */
export async function inspectBusinessIdentity(
	host: BusinessIdentityHost,
	input: unknown,
): Promise<{ identity: BusinessIdentityView; check?: BusinessIdentityCheck }> {
	const source = dataRecord(input) ?? {};
	const state = await readBusinessIdentityStored(host.store);
	const identity = await buildBusinessIdentityView(host, state);
	const check = dataRecord(source.check);
	if (!check) return { identity };
	// The complete record the unconfirmed write would have stored, as its
	// failure result returned it, and the record the editor had loaded.
	// A request that failed before any response has no intended record; only
	// the loaded comparison is then possible.
	const intended = check.intended === null || check.intended === undefined ? null : validateBusinessIdentityRecord(check.intended);
	const loaded = check.loaded === null ? null : validateBusinessIdentityRecord(check.loaded);
	if ((intended !== null && !intended.success) || (loaded !== null && !loaded.success)) return { identity, check: "differs" };
	if (state.state === "corrupt" || state.state === "read_unavailable") return { identity, check: "differs" };
	// Only the values read now are compared. Neither a revision nor equal values
	// show which writer stored them or whether the failed request committed.
	if (state.state === "valid" && intended?.success && sameBusinessIdentityRecord(state.record, intended.value)) {
		return { identity, check: "matches_requested" };
	}
	const matchesLoaded = loaded === null ? state.state === "absent" : state.state === "valid" && sameBusinessIdentityRecord(state.record, loaded.value);
	return { identity, check: matchesLoaded ? "matches_loaded" : "differs" };
}

interface WriteContext {
	state: BusinessIdentityStoredState;
	settings: BusinessIdentityLegacySettings;
	switches: { moduleEnabled: boolean; presetEnabled: boolean; localBusinessPreset: boolean };
	ownership: PublisherOwnershipState;
}

/** Shared preamble: storage support, one read and the revision comparison. */
async function beginWrite(
	host: BusinessIdentityHost,
	expectedRevision: unknown,
): Promise<{ ok: true; context: WriteContext; store: Required<BusinessIdentityStore> } | { ok: false; result: BusinessIdentityWriteResult }> {
	if (expectedRevision !== null && !validRevision(expectedRevision)) {
		return { ok: false, result: failure("invalid", "Send the revision the business identity was loaded from.") };
	}
	const store = host.store;
	if (!store?.compareAndSet) return { ok: false, result: failure("unavailable", MESSAGES.unwritable) };
	const writable = store as Required<BusinessIdentityStore>;
	const state = await readBusinessIdentityStored(writable);
	if (state.state === "read_unavailable") return { ok: false, result: failure("unavailable", MESSAGES.unreadable) };
	if (state.state === "corrupt") return { ok: false, result: failure("unavailable", MESSAGES.corrupt, { current: currentOf(state) }) };
	if (state.revision !== expectedRevision) {
		return { ok: false, result: failure("conflict", MESSAGES.changed, { current: currentOf(state) }) };
	}
	const { settings, switches, ownership } = await siteState(host);
	return { ok: true, context: { state, settings, switches, ownership }, store: writable };
}

async function verifyActive(
	host: BusinessIdentityHost,
	record: BusinessIdentityRecord,
	context: WriteContext,
	resolution: BusinessIdentityTargetResolution | null,
	records: BusinessIdentityCustomRecord[] | null,
): Promise<BusinessIdentityWriteResult | null> {
	// While a readable saved opt-out stops automatic output, a custom definition
	// of the ID collides with nothing; returning to automatic output checks again.
	if (publisherOwnershipOptedOut(context.ownership)) return null;
	const ownership = await businessIdentityOwnership(host, {
		entityId: record.entityId,
		facts: businessIdentityFactsOf(record),
		settings: context.settings,
		target: resolution,
		localBusinessPreset: context.switches.localBusinessPreset,
		records,
	});
	if (ownership.status === "incomplete") return failure("collision_check_incomplete", ownership.message);
	if (ownership.definitions.length) {
		return failure(
			"owned_id_defined",
			`Enabled custom schemas define ${record.entityId}. Change them to reference {"@id": "${record.entityId}"} instead, remove that definition or turn the schema off.`,
			{ definitions: ownership.definitions },
		);
	}
	return null;
}

async function checkTarget(
	host: BusinessIdentityHost,
	target: BusinessIdentityTarget,
): Promise<{ ok: true; resolution: BusinessIdentityTargetResolution } | { ok: false; result: BusinessIdentityWriteResult }> {
	const resolution = await host.resolveTarget(target).catch(() => ({ status: "unavailable" as const }));
	if (resolution.status === "unavailable") return { ok: false, result: failure("unavailable", TARGET_MESSAGES.unavailable) };
	if (resolution.status !== "ok") return { ok: false, result: failure("invalid", { target: TARGET_MESSAGES[resolution.status] }) };
	return { ok: true, resolution };
}

async function commit(
	store: Required<BusinessIdentityStore>,
	expectedRevision: string | null,
	record: BusinessIdentityRecord,
	extra: { usage?: BusinessIdentityIdUsage[]; dropped?: string[]; adoptedId?: true } = {},
): Promise<BusinessIdentityWriteResult> {
	if (businessIdentityRecordBytes(record) > BUSINESS_IDENTITY_MAX_BYTES) {
		return failure("invalid", "These details are larger than 16 KiB. Shorten them before saving.");
	}
	let written: { applied: true; revision: string } | { applied: false };
	try {
		written = await store.compareAndSet(expectedRevision, record);
	} catch {
		return failure("unconfirmed", MESSAGES.unconfirmed, { intended: record });
	}
	if (written.applied) return { success: true, record, revision: written.revision, ...extra };
	const after = await readBusinessIdentityStored(store);
	if (after.state === "corrupt" || after.state === "read_unavailable") {
		return failure("unavailable", MESSAGES.unreadable, { current: currentOf(after) });
	}
	// A refusal while the expected revision is still readable does not show why
	// the write was refused, so it is reported as uncertain, never as a conflict.
	if (after.revision === expectedRevision) {
		return failure("storage_uncertain", MESSAGES.uncertain, { current: currentOf(after) });
	}
	return failure("conflict", MESSAGES.changed, { current: currentOf(after) });
}

/** Creates (adopts), replaces an invalid record, or updates the facts of a valid one. */
export async function saveBusinessIdentity(host: BusinessIdentityHost, input: unknown): Promise<BusinessIdentityWriteResult> {
	const source = dataRecord(input);
	if (!source || !Object.hasOwn(source, "expectedRevision")) {
		return failure("invalid", "Send the details with the revision they were loaded from.");
	}
	if (Object.keys(source).some((key) => !["document", "expectedRevision", "replaceInvalid", "publisherChange"].includes(key))) {
		return failure("invalid", "Send only the business identity details and their reviewed save options.");
	}
	const hasPublisherChange = Object.hasOwn(source, "publisherChange");
	const publisherChange = hasPublisherChange ? dataRecord(source.publisherChange) : null;
	if (hasPublisherChange && (
		!publisherChange ||
		Object.keys(publisherChange).length !== 3 ||
		Object.keys(publisherChange).some((key) => !["confirmed", "fromEntityId", "fromType"].includes(key)) ||
		publisherChange.confirmed !== true ||
		typeof publisherChange.fromEntityId !== "string" ||
		!publisherChange.fromEntityId || publisherChange.fromEntityId.length > 2048 ||
		(publisherChange.fromType !== "person" && publisherChange.fromType !== "organization")
	)) {
		return failure("invalid", "Review the current publisher before changing its entity.");
	}
	const validation = validateBusinessIdentityFacts(source.document);
	if (!validation.success) return failure("invalid", validation.errors);
	const facts = validation.value;
	const begun = await beginWrite(host, source.expectedRevision);
	if (!begun.ok) return begun.result;
	const { context, store } = begun;
	const { state, settings } = context;
	if (hasPublisherChange && state.state !== "absent") {
		return failure("invalid", "Only a first identity can replace the reviewed site publisher. Use Change entity for a saved identity.");
	}
	if (state.state === "invalid" && source.replaceInvalid !== true) {
		return failure("invalid_stored", MESSAGES.invalidStored, { current: currentOf(state) });
	}
	let record: BusinessIdentityRecord;
	let adoptedId = false;
	let publisherChangeIds: string[] | null = null;
	if (state.state === "valid") {
		if (businessIdentityFamily(facts.kind) !== businessIdentityFamily(state.record.kind)) {
			return failure("invalid", {
				kind: "Changing between a person and an organization replaces the entity. Use Change entity after saving your other edits.",
			});
		}
		record = {
			...facts,
			version: BUSINESS_IDENTITY_STORAGE_VERSION,
			updatedAt: host.now(),
			active: state.record.active,
			entityId: state.record.entityId,
			...(state.record.organizationReferenceAliases ? { organizationReferenceAliases: true as const } : {}),
		};
	} else if (state.state === "invalid") {
		// Replacement keeps a usable stored ID and state: the entity, its references
		// and whether it is published do not change without their own commands.
		const raw = dataRecord(state.raw) ?? {};
		const kept = businessIdentityReplacementOf(state);
		if (kept) {
			if (businessIdentityFamily(facts.kind) !== kept.family) {
				return failure("invalid", {
					kind: kept.family === "person"
						? "The saved record's ID names a person. Replace it with a person; change the entity after that if needed."
						: "The saved record's ID names an organization. Replace it with an organization or local business; change the entity after that if needed.",
				});
			}
			record = {
				...facts,
				version: BUSINESS_IDENTITY_STORAGE_VERSION,
				updatedAt: host.now(),
				active: kept.active,
				entityId: kept.entityId,
				...(kept.organizationReferenceAliases ? { organizationReferenceAliases: true as const } : {}),
			};
		} else {
			const entityId = legacyPublisherEntityId(settings);
			if (!entityId) return failure("invalid", MESSAGES.noSiteUrl);
			if (businessIdentityFamily(facts.kind) !== settings.publisherType) {
				return failure("invalid", { kind: "The saved record has no usable ID, so its ID is taken from the site settings. Choose the publisher type the site settings use." });
			}
			record = {
				...facts,
				version: BUSINESS_IDENTITY_STORAGE_VERSION,
				updatedAt: host.now(),
				active: raw.active === true,
				entityId,
				...(settings.publisherType === "person" ? { organizationReferenceAliases: true as const } : {}),
			};
			adoptedId = true;
		}
	} else {
		const legacyId = legacyPublisherEntityId(settings);
		if (!legacyId) return failure("invalid", MESSAGES.noSiteUrl);
		const family = businessIdentityFamily(facts.kind);
		if (publisherChange) {
			if (publisherChange.fromEntityId !== legacyId || publisherChange.fromType !== settings.publisherType) {
				return failure("conflict", "The site publisher changed after you reviewed it. Read it again before changing its entity.", { current: currentOf(state) });
			}
			if (family === settings.publisherType) {
				return failure("invalid", "A reviewed publisher change is only used when the new identity belongs to another family.");
			}
		} else if (family !== settings.publisherType) {
			return failure("invalid", { kind: "Review the publisher change before adopting a person or organization with a different entity ID." });
		}
		const entityId = publisherChange ? businessIdentityEntityIdFor(settings.siteUrl, family) : legacyId;
		if (publisherChange) {
			publisherChangeIds = [...businessIdentityOwnedIds(legacyId), ...businessIdentityOwnedIds(entityId)];
		}
		record = {
			...facts,
			version: BUSINESS_IDENTITY_STORAGE_VERSION,
			updatedAt: host.now(),
			active: true,
			entityId,
			...(!publisherChange && settings.publisherType === "person" ? { organizationReferenceAliases: true as const } : {}),
		};
	}
	const target = await checkTarget(host, record.target);
	if (!target.ok) return target.result;
	const records = record.active || publisherChangeIds ? await readRecords(host) : null;
	if (record.active) {
		const blocked = await verifyActive(host, record, context, target.resolution, records);
		if (blocked) return blocked;
	}
	let usage: BusinessIdentityIdUsage[] | undefined;
	if (publisherChangeIds) {
		if (!records) return failure("collision_check_incomplete", MESSAGES.incomplete);
		const checked = idUsage(publisherChangeIds, settings, records);
		if (!checked) return failure("collision_check_incomplete", MESSAGES.incomplete);
		usage = checked;
	}
	return commit(store, state.revision, record, { ...(adoptedId ? { adoptedId: true } : {}), ...(usage ? { usage } : {}) });
}

export async function setBusinessIdentityActive(host: BusinessIdentityHost, input: unknown): Promise<BusinessIdentityWriteResult> {
	const source = dataRecord(input);
	if (!source || source.confirmed !== true || typeof source.active !== "boolean" || !validRevision(source.expectedRevision)) {
		return failure("invalid", "Confirm the change for the business identity you loaded.");
	}
	const begun = await beginWrite(host, source.expectedRevision);
	if (!begun.ok) return begun.result;
	const { context, store } = begun;
	const { state } = context;
	if (state.state !== "valid") {
		return failure("invalid_stored", "Only a valid saved business identity can be turned on or off.", { current: currentOf(state) });
	}
	const record: BusinessIdentityRecord = { ...state.record, active: source.active, updatedAt: host.now() };
	if (record.active) {
		const target = await checkTarget(host, record.target);
		if (!target.ok) return target.result;
		const blocked = await verifyActive(host, record, context, target.resolution, await readRecords(host));
		if (blocked) return blocked;
	}
	return commit(store, state.revision, record);
}

export async function transitionBusinessIdentityEntity(host: BusinessIdentityHost, input: unknown): Promise<BusinessIdentityWriteResult> {
	const source = dataRecord(input);
	const to = source?.to;
	if (
		!source ||
		source.confirmed !== true ||
		(to !== "origin" && to !== "person" && to !== "organization") ||
		!validRevision(source.expectedRevision)
	) {
		return failure("invalid", "Confirm the entity change for the business identity you loaded.");
	}
	const begun = await beginWrite(host, source.expectedRevision);
	if (!begun.ok) return begun.result;
	const { context, store } = begun;
	const { state, settings } = context;
	if (state.state !== "valid") {
		return failure("invalid_stored", "Only a valid saved business identity can change its entity.", { current: currentOf(state) });
	}
	const next = transitionTarget(state.record, to, settings.siteUrl);
	if (!next) {
		return failure("invalid", to === "origin"
			? "The entity ID already uses the current site address, or the site URL is not set."
			: `The identity is already ${to === "person" ? "a person" : "an organization"}.`);
	}
	const facts = businessIdentityFactsOf(state.record);
	const converted = to === "origin"
		? { facts, dropped: [] as string[] }
		: businessIdentityFactsForKind(facts, to === "person" ? "Person" : "Organization");
	// Built from the converted facts, so fields the new kind cannot carry are really gone.
	const record: BusinessIdentityRecord = {
		...converted.facts,
		version: BUSINESS_IDENTITY_STORAGE_VERSION,
		updatedAt: host.now(),
		active: state.record.active,
		entityId: next.entityId,
		...(to === "origin" && state.record.organizationReferenceAliases ? { organizationReferenceAliases: true as const } : {}),
	};
	const checked = validateBusinessIdentityRecord(record);
	if (!checked.success) return failure("invalid", checked.errors);
	const records = await readRecords(host);
	if (!records) return failure("collision_check_incomplete", MESSAGES.incomplete);
	// The new ID becomes owned whether or not the identity is currently published.
	let resolution: BusinessIdentityTargetResolution | null = null;
	if (record.active) {
		const target = await checkTarget(host, record.target);
		if (!target.ok) return target.result;
		resolution = target.resolution;
	}
	const blocked = await verifyActive(host, record, context, resolution, records);
	if (blocked) return blocked;
	const usage = idUsage(
		[...businessIdentityOwnedIds(state.record.entityId), ...businessIdentityOwnedIds(record.entityId)],
		settings,
		records,
	);
	if (!usage) return failure("collision_check_incomplete", MESSAGES.incomplete);
	return commit(store, state.revision, record, { usage, dropped: converted.dropped });
}

/** Draft output for review; reads only. */
export async function previewBusinessIdentity(
	host: BusinessIdentityHost,
	input: unknown,
): Promise<
	| {
			success: true;
			entityId: string;
			output: { full: Record<string, unknown>; minimal: Record<string, unknown> } | null;
			/** The same ownership decision as public output; `none` and `unknown` emit no draft publisher. */
			publisherOutput: PublisherOwnershipEffective;
			target: BusinessIdentityTargetStatus;
			ownership: BusinessIdentityOwnership | null;
			notices: BusinessIdentityNotice[];
	  }
	| { success: false; errors: BusinessIdentityFieldErrors }
> {
	const source = dataRecord(input);
	const validation = validateBusinessIdentityFacts(source?.document);
	if (!validation.success) return { success: false, errors: validation.errors };
	const facts = validation.value;
	const [state, { settings, switches, ownership: ownershipState }] = await Promise.all([readBusinessIdentityStored(host.store), siteState(host)]);
	const stored = state.state === "valid" ? state.record : null;
	const publisherOutput = publisherOwnershipEffective(ownershipState);
	const entityId = stored && businessIdentityFamily(stored.kind) === businessIdentityFamily(facts.kind)
		? stored.entityId
		: businessIdentityEntityIdFor(
				stored ? `${businessIdentityEntityOrigin(stored.entityId)}/` : settings.siteUrl,
				businessIdentityFamily(facts.kind),
			);
	const resolution = await host.resolveTarget(facts.target).catch(() => ({ status: "unavailable" as const }));
	const record: BusinessIdentityRecord | null = entityId
		? { ...facts, version: BUSINESS_IDENTITY_STORAGE_VERSION, updatedAt: host.now(), active: true, entityId }
		: null;
	return {
		success: true,
		entityId,
		output: record
			? { full: businessIdentityFullGraph(record, settings.siteUrl), minimal: businessIdentityMinimalGraph(record, settings.siteUrl) }
			: null,
		publisherOutput,
		target: targetStatus(resolution, facts.target),
		ownership: entityId
			? await businessIdentityOwnership(host, {
					entityId,
					facts,
					settings,
					target: resolution,
					localBusinessPreset: switches.localBusinessPreset,
				})
			: null,
		notices: businessIdentityNotices({
			facts,
			entityId,
			siteName: settings.siteName,
			siteUrl: settings.siteUrl,
			active: stored ? stored.active : true,
			moduleEnabled: switches.moduleEnabled,
			presetEnabled: switches.presetEnabled,
			publisherOutput,
		}),
	};
}

export async function listBusinessIdentityPages(
	host: BusinessIdentityHost,
	input: unknown,
): Promise<{ success: true; items: BusinessIdentityPageCandidate[]; cursor?: string } | { success: false; error: string }> {
	const source = dataRecord(input);
	const collection = typeof source?.collection === "string" ? source.collection : "";
	const limit = typeof source?.limit === "number" && Number.isInteger(source.limit) ? source.limit : 0;
	const cursor = typeof source?.cursor === "string" && source.cursor ? source.cursor : undefined;
	if (!collection || limit < 1 || limit > BUSINESS_IDENTITY_PAGE_LIMIT) {
		return { success: false, error: "Choose a content type and a page size from 1 to 25." };
	}
	const collections = await host.listCollections();
	if (!collections.available || !collections.collections.some((item) => item.collection === collection)) {
		return { success: false, error: "That content type has no public pages to choose from." };
	}
	try {
		const page = await host.listTargetCandidates(collection, limit, cursor);
		return { success: true, items: page.items.slice(0, limit), ...(page.cursor ? { cursor: page.cursor } : {}) };
	} catch {
		return { success: false, error: "The pages could not be listed. Try again." };
	}
}
