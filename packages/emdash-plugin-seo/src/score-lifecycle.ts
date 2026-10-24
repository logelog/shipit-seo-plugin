import { copyContentAnalysis } from "./content-body-mapping.ts";
import type { PluginContext } from "emdash";

import type { EntryAnalysisPurpose } from "./analysis-admission.ts";

import {
	SEO_ENGINE_VERSION,
	SEO_SCORE_INPUT_IDENTITY_TAG,
	isSeoContentCollectionKey,
} from "./admin-contract.ts";
import { SEO_SCORE_VERSION } from "./analysis.ts";
import { BUSINESS_IDENTITY_KV_KEY, BUSINESS_IDENTITY_SETTINGS_KEY } from "./business-identity.ts";
import { compareStoredValue, supportsConditionalStorage } from "./conditional-storage.ts";
import { contentTypeNoindexApplies } from "./content-type-noindex-policy.ts";
import {
	collectionAnalysisProfileKey,
	readCollectionAnalysisProfile,
	verifyCollectionAnalysisProfileRevision,
	type ConfiguredCollectionAnalysisProfile,
} from "./collection-analysis-profile.ts";
import {
	LEGACY_SCHEMA_PRESETS_SETTINGS_KEY,
	MODULES_SETTINGS_KEY,
	PRESET_KEYS,
	SCHEMA_CONTENT_TYPES_SETTINGS_KEY,
	SCHEMA_PRESETS_SETTINGS_KEY,
	SEO_MODULES,
	UNREADABLE_TEMPLATES_TOKEN,
	clean,
	completeContentItemAnalysis,
	contentSchemaScopes,
	getTemplate,
	hydrateStoredScoreDraft,
	isStoredScoreUsable,
	isTemplateCollection,
	keywordFromContent,
	legacyOverrideAliasRefs,
	prepareContentItemAnalysis,
	publicUrlForContent,
	readAdminModules,
	readAnalysisRuntimeConfig,
	readCollectionTemplateToken,
	resolveContentCollection,
	resolveOverrideForContentItem,
	scoreContentSourceVersion,
	scoreRefreshRevision,
	socialOverrideRefsForContentItem,
	type SeoScoreRecord,
} from "./entry-analysis-runtime.ts";
import { resolveFocusKeywordOwnership } from "./focus-keyword.ts";
import { readMetaOverride } from "./meta-overrides.ts";
import { LEGACY_TEMPLATE_REVISIONS_KEY, METADATA_TEMPLATES_KEY } from "./metadata-templates.ts";
import { PUBLISHER_OWNERSHIP_KEY } from "./publisher-ownership.ts";
import {
	ScorePersistenceError,
	persistScoreWithHistory,
	type ScoreAcceptance,
	type ScoreHistoryOutcome,
	type ScorePersistenceRefusal,
} from "./score-history.ts";
import {
	GLOBAL_SETTINGS_KEY,
	SiteSettingsUnreadableError,
	readContentScoringPolicy,
	type ContentScoringAdmission,
} from "./settings-runtime.ts";
import { LEGACY_SETTINGS_KEYS } from "./settings-state.ts";
import { readSocialOverride } from "./social-overrides.ts";

// ---- Analysis revision reservation ----

const SCORE_ANALYSIS_REVISION_STORAGE_VERSION = 1 as const;

interface StoredScoreAnalysisRevision {
	id: string;
	ref: string;
	storageVersion: typeof SCORE_ANALYSIS_REVISION_STORAGE_VERSION;
	revision: number;
	updatedAt: string;
}

class ScoreStorageUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ScoreStorageUnavailableError";
	}
}

function storedScoreAnalysisRevision(
	id: string,
	value: unknown,
): StoredScoreAnalysisRevision | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredScoreAnalysisRevision>;
	if (
		candidate.id !== id ||
		candidate.ref !== id ||
		candidate.storageVersion !== SCORE_ANALYSIS_REVISION_STORAGE_VERSION ||
		!Number.isSafeInteger(candidate.revision) ||
		(candidate.revision ?? 0) < 1 ||
		typeof candidate.updatedAt !== "string"
	)
		return null;
	return candidate as StoredScoreAnalysisRevision;
}

/** Reserved before the inputs are read, so a later reservation always reads later inputs. */
export async function reserveScoreAnalysisRevision(ctx: PluginContext, ref: string): Promise<number> {
	const store = (ctx.storage as any)?.scoreAnalysisRevisions;
	if (!store || typeof store.get !== "function" || !supportsConditionalStorage(store))
		throw new ScoreStorageUnavailableError("Conditional score analysis revisions are unavailable");
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const currentRaw = await store.get(ref);
		const current = currentRaw == null ? null : storedScoreAnalysisRevision(ref, currentRaw);
		if (currentRaw != null && !current)
			throw new Error("Score analysis revision storage contains an invalid record");
		const revision = (current?.revision ?? 0) + 1;
		if (!Number.isSafeInteger(revision)) throw new Error("Score analysis revision is exhausted");
		const next: StoredScoreAnalysisRevision = {
			id: ref,
			ref,
			storageVersion: SCORE_ANALYSIS_REVISION_STORAGE_VERSION,
			revision,
			updatedAt: new Date().toISOString(),
		};
		try {
			if (
				await compareStoredValue(
					store,
					ref,
					currentRaw == null ? { state: "missing" } : { state: "value", value: currentRaw },
					{ action: "put", value: next },
				)
			)
				return revision;
		} catch (error: unknown) {
			const afterError = storedScoreAnalysisRevision(ref, await store.get(ref));
			if (afterError && canonicalJson(afterError) === canonicalJson(next)) return revision;
			if (attempt === 7) throw error;
		}
	}
	throw new Error("Score analysis revision changed during reservation");
}

// ---- Captured saved-entry inputs ----

/** JSON with object keys sorted at every depth; equal values give equal text. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_key, current) => {
		if (current instanceof Map) return { map: [...current.entries()].sort(([left], [right]) => String(left).localeCompare(String(right))) };
		if (!current || typeof current !== "object" || Array.isArray(current)) return current;
		return Object.fromEntries(Object.keys(current).sort().map((key) => [key, current[key]]));
	}) ?? "null";
}

/** An analysis read outside the saved entry's captured inputs. */
export class UncapturedInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UncapturedInputError";
	}
}

const TEMPLATE_FIELDS = new Set(["title", "description", "socialTitle", "socialDescription"]);
const CONFIGURATION_KEYS = new Set<string>([
	GLOBAL_SETTINGS_KEY,
	...LEGACY_SETTINGS_KEYS,
	MODULES_SETTINGS_KEY,
	...SEO_MODULES.map((definition) => `module:${definition.key}`),
	SCHEMA_PRESETS_SETTINGS_KEY,
	LEGACY_SCHEMA_PRESETS_SETTINGS_KEY,
	...PRESET_KEYS.map((key) => `preset:${key}`),
	METADATA_TEMPLATES_KEY,
	LEGACY_TEMPLATE_REVISIONS_KEY,
	SCHEMA_CONTENT_TYPES_SETTINGS_KEY,
	PUBLISHER_OWNERSHIP_KEY,
	BUSINESS_IDENTITY_KV_KEY,
]);

// One record holds every collection's templates; analysis uses only this
// collection's effective template and score token, which the identity hashes
// instead of the shared record.
function templateStorageRead(key: string): boolean {
	return key === `kv.getVersioned:${METADATA_TEMPLATES_KEY}` || key === `kv.get:${LEGACY_TEMPLATE_REVISIONS_KEY}` ||
		key.startsWith("kv.get:tpl:") || key.startsWith("kv.getVersioned:tpl:");
}

const COLLECTION_DISCOVERY_READS = new Set(["content.listCollections", "schema.listCollections"]);

function configurationKey(key: unknown, entryCollection: string): key is string {
	if (typeof key !== "string") return false;
	if (CONFIGURATION_KEYS.has(key) || key === collectionAnalysisProfileKey(entryCollection)) return true;
	const [prefix, collection, field, extra] = key.split(":");
	return prefix === "tpl" && extra === undefined && isSeoContentCollectionKey(collection) && TEMPLATE_FIELDS.has(field);
}

interface EntryInputScope {
	collection: string;
	id: string;
	ref: string;
	draftRevisionId: string | null;
	/** The id ref and the saved draft's slug alias, for legacy and social records. */
	aliases: Set<string>;
	/** Custom schema scopes of the saved draft; set once the draft is hydrated. */
	schemaScopes: string[] | null;
	/** Host site values cloned at capture start; capture and replay use this copy. */
	site: Record<string, unknown> | undefined;
}

const STORE_METHODS = [
	"getVersioned", "compareAndSet", "compareAndDelete", "put", "delete", "exists",
	"getMany", "putMany", "deleteMany", "count", "updateIf", "query",
];

type CapturedRead = { value: unknown } | { failed: string };

function semanticConfigurationRead(key: string, read: CapturedRead, collection: string): CapturedRead {
	if (!("value" in read)) return read;
	const versioned = key.startsWith("kv.getVersioned:");
	const storageKey = key.slice(key.indexOf(":") + 1);
	const envelope = read.value as { value?: unknown } | null;
	const raw = versioned ? envelope?.value : read.value;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return read;
	if (storageKey === collectionAnalysisProfileKey(collection)) {
		const profile = raw as { profile?: unknown; version?: unknown };
		return { value: { profile: profile.profile, version: profile.version } };
	}
	if (storageKey !== GLOBAL_SETTINGS_KEY) return read;
	const semantic = Object.fromEntries(Object.entries(raw).filter(([name]) =>
		name !== "updatedAt" && name !== "contentScoringEnabled" && name !== "contentScoringResourceNoticeVersion" &&
		name !== "taxonomyArchiveNoindex" && name !== "contentTypeNoindex"));
	// Only a rule naming this collection is an analysis input; its absence keeps earlier identities.
	if (contentTypeNoindexApplies((raw as { contentTypeNoindex?: unknown }).contentTypeNoindex, collection)) semantic.contentTypeNoindex = true;
	return { value: semantic };
}

/**
 * The reads one saved-entry analysis may make, each taken once. Capture reads
 * the host; replay serves only what capture read. Anything else, including a
 * write, is refused and recorded, so a reader that swallows the refusal still
 * fails the analysis.
 */
class SavedEntryInputReads {
	readonly scope: EntryInputScope;
	private readonly ctx: PluginContext;
	private readonly replaying: boolean;
	private readonly entries: Map<string, Promise<CapturedRead>>;
	private readonly urls: Map<string, string>;
	private readonly outside = new Set<string>();
	private facade: PluginContext | null = null;

	constructor(
		ctx: PluginContext,
		scope: EntryInputScope,
		replaying = false,
		entries = new Map<string, Promise<CapturedRead>>(),
		urls = new Map<string, string>(),
	) {
		this.ctx = ctx;
		this.scope = scope;
		this.replaying = replaying;
		this.entries = entries;
		this.urls = urls;
	}

	replay(): SavedEntryInputReads {
		return new SavedEntryInputReads(this.ctx, this.scope, true, this.entries, this.urls);
	}

	get readCount(): number {
		return this.entries.size;
	}

	/** Keys whose read failed; a reader that swallowed the error still leaves its input unknown. */
	async failedReads(): Promise<string[]> {
		const reads = await Promise.all([...this.entries].map(async ([key, entry]) => ("failed" in await entry ? key : null)));
		return reads.filter((key): key is string => key !== null);
	}

	assertWithinScope(): void {
		if (this.outside.size > 0)
			throw new UncapturedInputError(`Analysis read outside its saved entry inputs: ${[...this.outside].join(", ")}`);
	}

	async snapshot(): Promise<Array<[string, CapturedRead]>> {
		const reads = await Promise.all([...this.entries].map(async ([key, entry]) => [key, await entry] as [string, CapturedRead]));
		const urls = [...this.urls].map(([path, url]) => [`url:${path}`, { value: url }] as [string, CapturedRead]);
		return [...reads, ...urls].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	}

	/** The host URL helper is synchronous, so its outputs are kept apart from storage reads. */
	private url(path: string): string {
		const captured = this.urls.get(path);
		if (captured !== undefined) return captured;
		if (this.replaying) throw this.refuse(`url:${path}`);
		const url = String((this.ctx as any).url(path));
		this.urls.set(path, url);
		return url;
	}

	private refuse(access: string): UncapturedInputError {
		this.outside.add(access);
		return new UncapturedInputError(`Analysis read outside its saved entry inputs: ${access}`);
	}

	private async read(key: string, load: () => Promise<unknown>): Promise<any> {
		let entry = this.entries.get(key);
		if (!entry) {
			if (this.replaying) throw this.refuse(key);
			entry = Promise.resolve().then(load).then(
				(value) => ({ value: structuredClone(value ?? null) }),
				(error: unknown) => ({ failed: String(error) }),
			);
			this.entries.set(key, entry);
		}
		const result = await entry;
		if ("failed" in result) throw new Error(result.failed);
		return structuredClone(result.value);
	}

	context(): PluginContext {
		if (this.facade) return this.facade;
		const { ctx, scope } = this;
		const host = ctx as any;
		const refuseWrite = (access: string) => () => {
			throw this.refuse(access);
		};
		const mirrorWrites = (source: any, access: string, names: string[]) =>
			Object.fromEntries(names.filter((name) => typeof source?.[name] === "function").map((name) => [name, refuseWrite(`${access}.${name}`)]));
		const kv = {
			get: (key: string) => {
				if (!configurationKey(key, scope.collection)) throw this.refuse(`kv.get:${String(key)}`);
				return this.read(`kv.get:${key}`, () => host.kv.get(key));
			},
			getVersioned: (key: string) => {
				if (!configurationKey(key, scope.collection)) throw this.refuse(`kv.getVersioned:${String(key)}`);
				return this.read(`kv.getVersioned:${key}`, () => host.kv.getVersioned(key));
			},
			// Present exactly when the host has them, so store selection is unchanged.
			...mirrorWrites(host.kv, "kv", ["set", "delete", "compareAndSet", "compareAndDelete"]),
		};
		const settings = host.settings && typeof host.settings === "object" ? {
			...(typeof host.settings.getVersioned === "function" ? {
				getVersioned: (key: string) => {
					if (key !== BUSINESS_IDENTITY_SETTINGS_KEY) throw this.refuse(`settings.getVersioned:${String(key)}`);
					return this.read(`settings.getVersioned:${key}`, () => host.settings.getVersioned(key));
				},
			} : {}),
			...mirrorWrites(host.settings, "settings", ["set", "delete", "compareAndSet", "compareAndDelete"]),
		} : undefined;
		// Host methods stay present as refusing stubs: readers select a store by them.
		const record = (collection: string, inScope: (id: string) => boolean) => {
			const store = host.storage?.[collection];
			if (!store || typeof store.get !== "function") return undefined;
			return {
				...mirrorWrites(store, `storage.${collection}`, STORE_METHODS),
				get: (id: string) => {
					if (typeof id !== "string" || !inScope(id)) throw this.refuse(`storage.${collection}.get:${String(id)}`);
					return this.read(`storage.${collection}.get:${id}`, () => store.get(id));
				},
			};
		};
		// Only the two bounded queries readScopedAdminCustomSchemas makes for this entry's scopes.
		const scopedSchemaQuery = (options: any): boolean => {
			const scopes = scope.schemaScopes;
			if (!scopes || !options || typeof options !== "object" || options.cursor !== undefined) return false;
			if (Object.keys(options).some((key) => key !== "where" && key !== "limit")) return false;
			if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 101) return false;
			const where = canonicalJson(options.where);
			return where === canonicalJson({ scope: { in: [...scopes, ""] } }) || where === canonicalJson({ scope: null });
		};
		const schemas = host.storage?.schemas;
		const storage = {
			analysisProfiles: record("analysisProfiles", (id) => id === scope.ref),
			metaOverrides: record("metaOverrides", (id) => id === scope.ref),
			overrides: record("overrides", (id) => scope.aliases.has(id)),
			socialOverrides: record("socialOverrides", (id) => scope.aliases.has(id)),
			schemas: schemas && typeof schemas.query === "function" ? {
				...mirrorWrites(schemas, "storage.schemas", STORE_METHODS.filter((name) => name !== "query")),
				query: (options: Record<string, unknown> = {}) => {
					if (!scopedSchemaQuery(options)) throw this.refuse(`storage.schemas.query:${canonicalJson(options)}`);
					return this.read(`storage.schemas.query:${canonicalJson(options)}`, () => schemas.query(options));
				},
			} : undefined,
		};
		const exact = (collection: unknown, id: unknown) => collection === scope.collection && id === scope.id;
		const content = host.content;
		const contentFacade = {
			get: (collection: string, id: string) => {
				if (!exact(collection, id)) throw this.refuse(`content.get:${String(collection)}:${String(id)}`);
				return this.read(`content.get:${collection}:${id}`, () => content.get(collection, id));
			},
			...(typeof content?.getRevision === "function" ? {
				getRevision: (collection: string, id: string, revisionId: string) => {
					if (!exact(collection, id) || !scope.draftRevisionId || revisionId !== scope.draftRevisionId)
						throw this.refuse(`content.getRevision:${String(collection)}:${String(id)}:${String(revisionId)}`);
					return this.read(`content.getRevision:${collection}:${id}:${revisionId}`, () => content.getRevision(collection, id, revisionId));
				},
			} : {}),
			...(typeof content?.getPublicUrl === "function" ? {
				getPublicUrl: (collection: string, id: string) => {
					if (!exact(collection, id)) throw this.refuse(`content.getPublicUrl:${String(collection)}:${String(id)}`);
					return this.read(`content.getPublicUrl:${collection}:${id}`, () => content.getPublicUrl(collection, id));
				},
			} : {}),
			...(typeof content?.listCollections === "function"
				? { listCollections: () => this.read("content.listCollections", () => content.listCollections()) }
				: {}),
		};
		const schema = typeof host.schema?.listCollections === "function"
			? { listCollections: () => this.read("schema.listCollections", () => host.schema.listCollections()) }
			: undefined;
		this.facade = {
			plugin: host.plugin,
			site: scope.site,
			log: host.log,
			...(typeof host.url === "function" ? { url: (path: string) => this.url(path) } : {}),
			kv,
			storage,
			content: contentFacade,
			...(schema ? { schema } : {}),
			...(settings ? { settings } : {}),
		} as unknown as PluginContext;
		copyContentAnalysis(host, this.facade);
		return this.facade;
	}
}

interface SavedEntryRequest {
	collection: string;
	id: string;
	locale?: string | null;
	gate?: (row: any) => boolean;
}

interface CapturedSavedEntry {
	status: "ready";
	ref: string;
	sourceVersion: string;
	identity: string;
	reads: SavedEntryInputReads;
	hydrated: any;
	templateUpdatedAt: string | null;
	assessmentProfile: ConfiguredCollectionAnalysisProfile;
	modules: Awaited<ReturnType<typeof readAdminModules>>;
	runtimeConfig: Awaited<ReturnType<typeof readAnalysisRuntimeConfig>>;
	ownership: Awaited<ReturnType<typeof resolveFocusKeywordOwnership>>;
	metaOverride: Awaited<ReturnType<typeof readMetaOverride>>;
}

type CaptureResult = CapturedSavedEntry | { status: "not-found" | "locale-mismatch" | "superseded" | "unreadable" | "profile_required" | "profile_unavailable" };

/**
 * Reads the exact saved entry and every input its durable analysis uses, with
 * no analysis and no writes. Profiles are not migrated on this path.
 */
async function captureSavedEntryInputs(ctx: PluginContext, request: SavedEntryRequest): Promise<CaptureResult> {
	const ref = `${request.collection}:${request.id}`;
	// The installed host shares one mutable site object, so one copy serves the whole capture.
	const site = ctx.site ? JSON.parse(JSON.stringify(ctx.site)) as Record<string, unknown> : undefined;
	const scope: EntryInputScope = {
		collection: request.collection, id: request.id, ref, draftRevisionId: null,
		aliases: new Set([ref]), schemaScopes: null, site,
	};
	const reads = new SavedEntryInputReads(ctx, scope);
	const reader = reads.context();
	const assessmentProfile = await readCollectionAnalysisProfile(reader, request.collection);
	if (assessmentProfile.state !== "configured")
		return { status: assessmentProfile.state === "unconfigured" ? "profile_required" : "profile_unavailable" };
	const row = await reader.content!.get(request.collection, request.id);
	if (!row || String(row.id) !== request.id) return { status: "not-found" };
	const locale = clean(row.locale) ?? null;
	if (request.locale !== undefined && locale !== request.locale) return { status: "locale-mismatch" };
	if (request.gate && !request.gate(row)) return { status: "superseded" };
	const sourceVersion = scoreContentSourceVersion(row);
	if (!sourceVersion) throw new Error("Saved content version is unavailable for scoring.");
	scope.draftRevisionId = clean(row.draftRevisionId) ?? null;
	// Keyword ownership and every alias come from the hydrated draft, never the live row.
	const hydrated = await hydrateStoredScoreDraft(reader, request.collection, row);
	const rawSlug = hydrated?.slug ?? hydrated?.data?.slug;
	for (const alias of [
		...legacyOverrideAliasRefs(request.collection, hydrated),
		...socialOverrideRefsForContentItem(request.collection, hydrated),
		...(rawSlug ? [`${request.collection}:${rawSlug}`] : []),
	]) scope.aliases.add(alias);
	scope.schemaScopes = contentSchemaScopes(request.collection, hydrated);
	const modules = await readAdminModules(reader);
	const [templateUpdatedAt, runtimeConfig, ownership, metaOverride] = await Promise.all([
		readCollectionTemplateToken(reader, request.collection),
		readAnalysisRuntimeConfig(reader, scope.schemaScopes, modules),
		resolveFocusKeywordOwnership(reader, ref, "", keywordFromContent(hydrated?.data ?? {}, hydrated), { persistMigration: false }),
		readMetaOverride(reader, ref),
	]);
	let template: Awaited<ReturnType<typeof getTemplate>> | null = null;
	if (isTemplateCollection(request.collection)) {
		[, , template] = await Promise.all([
			resolveOverrideForContentItem(reader, request.collection, hydrated),
			readSocialOverride(reader, socialOverrideRefsForContentItem(request.collection, hydrated)),
			getTemplate(reader, request.collection),
		]);
	}
	await resolveContentCollection(reader, request.collection);
	const publicUrl = await publicUrlForContent(reader, request.collection, hydrated);
	reads.assertWithinScope();
	const failed = await reads.failedReads();
	// A corrupt template record reads successfully but leaves the template unknown.
	if (templateUpdatedAt === UNREADABLE_TEMPLATES_TOKEN) failed.push("templates");
	if (failed.length > 0) {
		ctx.log?.warn?.("seo: saved entry inputs could not be read", { ref, failed });
		return { status: "unreadable" };
	}
	const captured = await reads.snapshot();
	// Discovery lists every collection; only this collection's definition is an input here.
	const definition = captured.flatMap(([key, read]) =>
		COLLECTION_DISCOVERY_READS.has(key) && "value" in read && Array.isArray(read.value)
			? read.value.filter((item: any) => item?.slug === request.collection)
			: []);
	const digest = await scoreRefreshRevision(canonicalJson({
		tag: SEO_SCORE_INPUT_IDENTITY_TAG,
		analyzer: { scoreVersion: SEO_SCORE_VERSION, engineVersion: SEO_ENGINE_VERSION },
		ref,
		locale,
		sourceVersion,
		site: site ?? null,
		publicUrl,
		template: { token: templateUpdatedAt, values: template },
		collection: definition,
		assessmentProfile: { profile: assessmentProfile.profile, version: assessmentProfile.version },
		...(runtimeConfig.contentAnalysis ? { contentAnalysis: runtimeConfig.contentAnalysis } : {}),
		reads: captured.filter(([key]) => !templateStorageRead(key) && !COLLECTION_DISCOVERY_READS.has(key))
			.map(([key, read]) => [key, semanticConfigurationRead(key, read, request.collection)]),
	}));
	return {
		status: "ready",
		ref,
		sourceVersion,
		identity: `${SEO_SCORE_INPUT_IDENTITY_TAG}-${digest}`,
		reads,
		hydrated,
		templateUpdatedAt,
		assessmentProfile,
		modules,
		runtimeConfig,
		ownership,
		metaOverride,
	};
}

/** Analyzes the captured inputs; a read the capture did not take fails the analysis. */
async function analyzeCapturedInputs(captured: CapturedSavedEntry, analysisRevision: number): Promise<SeoScoreRecord> {
	const replay = captured.reads.replay();
	const prepared = await prepareContentItemAnalysis(
		replay.context(),
		captured.reads.scope.collection,
		captured.hydrated,
		undefined,
		captured.templateUpdatedAt,
		captured.modules,
		undefined,
		captured.runtimeConfig,
		captured.metaOverride,
		captured.ownership,
		false,
		captured.assessmentProfile,
	);
	replay.assertWithinScope();
	if (prepared.sourceVersion !== captured.sourceVersion)
		throw new Error("Captured saved content version changed during preparation.");
	return { ...completeContentItemAnalysis(prepared, analysisRevision), inputIdentity: captured.identity };
}

// ---- Lifecycle ----

export interface SavedScoreRequest extends SavedEntryRequest {
	deferGlobalPrune?: boolean;
}

/**
 * A caller-owned terminal operation. Any policy revision other than
 * `policyRevision` supersedes the request, and an analyzed score is persisted
 * only through `accept`, which owns the final checks and records no history.
 * A saved outcome then reports history as not attempted.
 */
export interface SavedScoreTerminalBoundary {
	readonly policyRevision: string | null;
	accept(score: SeoScoreRecord, admission: ContentScoringAdmission): Promise<ScoreAcceptance>;
}

export type SavedScoreSupersededReason =
	| "source-changed"
	| "inputs-changed"
	| "policy-changed"
	| "newer-result"
	| "reservation-superseded";

export type SavedScoreOutcome =
	| { status: "reused"; score: SeoScoreRecord; history: "not-attempted" }
	| { status: "saved"; score: SeoScoreRecord; history: ScoreHistoryOutcome }
	| { status: "superseded"; reason: SavedScoreSupersededReason }
	| { status: "disabled" }
	| { status: "activation_required" | "profile_required" | "profile_unavailable" }
	| { status: "unavailable"; reason: "policy" | "configuration" | "content" | "storage"; error?: unknown }
	| { status: "not-found" }
	| { status: "locale-mismatch" }
	| { status: "uncertain"; error: unknown }
	| { status: "failed"; error: unknown };

function inputIdentityOf(score: SeoScoreRecord): string | null {
	const identity = score.inputIdentity;
	return typeof identity === "string" && identity.startsWith(`${SEO_SCORE_INPUT_IDENTITY_TAG}-sha256-`) ? identity : null;
}

/**
 * The stored score when it qualifies for strict reuse. A read that throws is
 * not an absent score: the row may be valid or newer, so the caller refuses
 * rather than reserving, analyzing or replacing it.
 */
async function readReusableScore(ctx: PluginContext, ref: string): Promise<SeoScoreRecord | null> {
	const stored: unknown = await (ctx.storage as any)?.scores?.get?.(ref);
	return isStoredScoreUsable(stored) && stored.scoreVersion === SEO_SCORE_VERSION && stored.ref === ref &&
		Number.isSafeInteger(stored.analysisRevision) && stored.analysisRevision > 0 && inputIdentityOf(stored) &&
		stored.templateUpdatedAt !== UNREADABLE_TEMPLATES_TOKEN
		? stored
		: null;
}

/**
 * Freshness of one stored score at this observation: the exact entry's inputs
 * are captured as for analysis and compared with the recorded identity and
 * saved version. Read-only, with no analysis, reservation or write. Inputs
 * that cannot be read throw rather than being reported as either state.
 */
export async function verifyStoredScoreFreshness(ctx: PluginContext, score: SeoScoreRecord): Promise<"current" | "stale"> {
	const identity = inputIdentityOf(score);
	if (score.scoreVersion !== SEO_SCORE_VERSION || !identity || !score.sourceVersion ||
		score.templateUpdatedAt === UNREADABLE_TEMPLATES_TOKEN || score.ref !== `${score.collection}:${score.entryId}`)
		return "stale";
	if (!ctx.content) throw new Error("Content read access is unavailable, so stored score freshness cannot be verified.");
	const captured = await captureSavedEntryInputs(ctx, { collection: score.collection, id: score.entryId });
	if (captured.status === "unreadable")
		throw new Error(`SEO inputs for ${score.ref} could not be read, so its stored score freshness is unknown.`);
	if (captured.status !== "ready") return "stale";
	return captured.identity === identity && captured.sourceVersion === score.sourceVersion ? "current" : "stale";
}

function captureRefusal(result: Exclude<CaptureResult, CapturedSavedEntry>): SavedScoreOutcome {
	if (result.status === "superseded") return { status: "superseded", reason: "source-changed" };
	if (result.status === "unreadable") return { status: "unavailable", reason: "configuration" };
	return { status: result.status };
}

function persistenceRefusal(refusal: ScorePersistenceRefusal | undefined): SavedScoreOutcome {
	if (refusal === "scoring-disabled") return { status: "disabled" };
	if (refusal === "scoring-unavailable") return { status: "unavailable", reason: "policy" };
	return { status: "superseded", reason: refusal ?? "newer-result" };
}

/**
 * The one durable path for a saved entry's score. Matching captured inputs
 * reuse the stored result with no reservation, analysis or write. Otherwise a
 * revision is reserved, the inputs are captured again and analyzed, captured
 * once more to confirm they did not change, and persisted only while the
 * admitting policy revision still allows that operation. Concurrent misses can each
 * compute; conditional storage decides which result is accepted.
 */
export const savedScoreLifecycleSteps = { analyze: analyzeCapturedInputs };

export async function runSavedScoreLifecycle(
	ctx: PluginContext,
	request: SavedScoreRequest,
	steps: typeof savedScoreLifecycleSteps = savedScoreLifecycleSteps,
	terminal?: SavedScoreTerminalBoundary,
): Promise<SavedScoreOutcome> {
	return runScoreLifecycle(ctx, request, steps, "automatic", terminal);
}

/** One deliberate saved-entry action; it does not enable automatic analysis or history. */
export async function runManualSavedScoreLifecycle(
	ctx: PluginContext,
	request: SavedScoreRequest & { locale: string | null },
	steps: typeof savedScoreLifecycleSteps = savedScoreLifecycleSteps,
): Promise<SavedScoreOutcome> {
	return runScoreLifecycle(ctx, request, steps, "manual-entry");
}

async function runScoreLifecycle(
	ctx: PluginContext,
	request: SavedScoreRequest,
	steps: typeof savedScoreLifecycleSteps,
	purpose: EntryAnalysisPurpose,
	terminal?: SavedScoreTerminalBoundary,
): Promise<SavedScoreOutcome> {
	const ref = `${request.collection}:${request.id}`;
	const policy = await readContentScoringPolicy(ctx);
	if (purpose === "automatic" && policy.state === "paused") return { status: "disabled" };
	if (purpose === "automatic" && policy.state === "pending-confirmation") return { status: "activation_required" };
	if (policy.state === "unavailable") return { status: "unavailable", reason: "policy" };
	if (terminal && policy.revision !== terminal.policyRevision) return { status: "superseded", reason: "policy-changed" };
	if (!ctx.content) return { status: "unavailable", reason: "content" };
	const assessmentProfile = await readCollectionAnalysisProfile(ctx, request.collection);
	if (assessmentProfile.state !== "configured")
		return { status: assessmentProfile.state === "unconfigured" ? "profile_required" : "profile_unavailable" };
	let phase: "prepare" | "persist" = "prepare";
	try {
		let stored: SeoScoreRecord | null;
		try {
			stored = await readReusableScore(ctx, ref);
		} catch (error: unknown) {
			ctx.log?.warn?.("seo: stored score could not be read", { ref, error: String(error) });
			return { status: "unavailable", reason: "storage", error };
		}
		if (stored) {
			const probe = await captureSavedEntryInputs(ctx, request);
			if (probe.status !== "ready") return captureRefusal(probe);
			if (inputIdentityOf(stored) === probe.identity && stored.sourceVersion === probe.sourceVersion)
				return { status: "reused", score: stored, history: "not-attempted" };
		}
		const analysisRevision = await reserveScoreAnalysisRevision(ctx, ref);
		const snapshot = await captureSavedEntryInputs(ctx, request);
		if (snapshot.status !== "ready") return captureRefusal(snapshot);
		const score = await steps.analyze(snapshot, analysisRevision);
		const recheck = await captureSavedEntryInputs(ctx, request);
		if (recheck.status !== "ready") return captureRefusal(recheck);
		if (recheck.identity !== snapshot.identity || recheck.assessmentProfile.revision !== snapshot.assessmentProfile.revision ||
			!await verifyCollectionAnalysisProfileRevision(ctx, snapshot.assessmentProfile))
			return { status: "superseded", reason: "inputs-changed" };
		phase = "persist";
		if (terminal) {
			if (policy.state !== "enabled") return { status: "disabled" };
			const accepted = await terminal.accept(score, policy);
			return accepted.persisted
				? { status: "saved", score, history: "not-attempted" }
				: persistenceRefusal(accepted.refusal);
		}
		const persisted = await persistScoreWithHistory(ctx, score, {
			...(purpose === "manual-entry"
				? { manualEntryAdmission: { ref, locale: request.locale ?? null, policy } }
				: { admission: policy.state === "enabled" ? policy : undefined }),
			deferGlobalPrune: request.deferGlobalPrune,
		});
		return persisted.persisted
			? { status: "saved", score, history: persisted.history }
			: persistenceRefusal(persisted.refusal);
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: saved score lifecycle failed", { ref, phase, error: String(error) });
		// Before the first conditional score write nothing was written; after one the stored score is unknown.
		if (phase === "persist") {
			if (error instanceof ScorePersistenceError && !error.scoreWriteAttempted)
				return error.storageUnavailable ? { status: "unavailable", reason: "storage", error } : { status: "failed", error };
			return { status: "uncertain", error };
		}
		if (error instanceof SiteSettingsUnreadableError) return { status: "unavailable", reason: "configuration", error };
		if (error instanceof ScoreStorageUnavailableError) return { status: "unavailable", reason: "storage", error };
		return { status: "failed", error };
	}
}
