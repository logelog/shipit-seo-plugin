// Sitemap settings, admin views and public file responses on top of the
// shared engine. Host specifics arrive through `SitemapHost`; this module has
// no database, Astro or native-only import and runs in either plugin format.
import type { PluginContext } from "emdash";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY,
	SEO_ADMIN_SITEMAP_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	validateSeoAdminSitemapValues,
	type SeoAdminPublicFiles,
	type SeoAdminSitemapConfiguration,
	type SeoAdminSitemapFilePlan,
	type SeoAdminSitemapPreview,
	type SeoAdminSitemapSaveResult,
	type SeoAdminSitemapValues,
	type SeoSitemapAvailability,
	type SeoSitemapOwner,
} from "./admin-contract.ts";
import { MODULES_SETTINGS_KEY, resolveContentCollectionSource, storedModulesRecord } from "./entry-analysis-runtime.ts";
import { readSiteIndexingFacts } from "./settings-runtime.ts";
import {
	SITEMAP_LIMITS,
	SitemapCapacityError,
	decideSitemapEntry,
	isSitemapCollectionFileKey,
	renderSitemapIndex,
	renderSitemapUrlset,
	resolveSitemapSelection,
	sitemapAcceptedLocales,
	sitemapAlternates,
	sitemapChildPath,
	markDuplicateSitemapUrls,
	sitemapExclusionKeys,
	sitemapLocalesRouted,
	sitemapPageSize,
	sitemapPatternIsUnique,
	sitemapRouteOverlaps,
	type SitemapAlternate,
	type SitemapCollectionInfo,
	type SitemapEntryDecision,
	type SitemapFileRequest,
	type SitemapLimits,
	type SitemapRouting,
	type SitemapSeoUrlResolver,
	type SitemapSource,
	type SitemapSourceRow,
} from "./sitemap-engine.ts";
import type { SitemapInstallation } from "./sitemap-installation.ts";
import { SitemapPreviewWindowError, sitemapPreviewWindow, type SitemapPreviewWindowInput } from "./sitemap-preview-window.ts";

export const SITEMAP_SETTINGS_KEY = `configuration:sitemap:v${SEO_ADMIN_SITEMAP_STORAGE_VERSION}`;

/** Native host binding; registry installations have none. */
export interface SitemapHost {
	installation: SitemapInstallation;
	/** Public HTTPS origin of Astro's `site`, used only when no site URL is stored. */
	publicOrigin?: string | null;
	openSource(): Promise<SitemapSource>;
	seoUrls: SitemapSeoUrlResolver;
	limits?: SitemapLimits;
}

interface StoredSitemapRecord {
	version: typeof SEO_ADMIN_SITEMAP_STORAGE_VERSION;
	updatedAt: string;
	values: SeoAdminSitemapValues;
}

type SitemapSnapshot =
	| { state: "absent"; revision: null; record: null }
	| { state: "saved"; revision: string | null; record: StoredSitemapRecord }
	| { state: "corrupt"; revision: string | null; record: null }
	| { state: "unavailable"; revision: null; record: null };

interface VersionedKv {
	getVersioned?: (key: string) => Promise<unknown>;
	compareAndSet?: (key: string, expectedRevision: string | null, value: unknown) => Promise<unknown>;
	compareAndDelete?: (key: string, expectedRevision: string) => Promise<unknown>;
}

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function storedSitemapRecord(value: unknown): StoredSitemapRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredSitemapRecord>;
	if (candidate.version !== SEO_ADMIN_SITEMAP_STORAGE_VERSION || typeof candidate.updatedAt !== "string") return null;
	const validation = validateSeoAdminSitemapValues(candidate.values);
	if (!validation.success) return null;
	return { version: SEO_ADMIN_SITEMAP_STORAGE_VERSION, updatedAt: candidate.updatedAt, values: validation.values };
}

/** Reads the stored record without creating one. Invalid records stay corrupt, never defaults. */
export async function readSitemapSnapshot(ctx: PluginContext): Promise<SitemapSnapshot> {
	const kv = ctx.kv as PluginContext["kv"] & VersionedKv;
	try {
		if (typeof kv.getVersioned === "function") {
			const snapshot = await kv.getVersioned(SITEMAP_SETTINGS_KEY) as { value?: unknown; revision?: unknown } | null;
			if (snapshot === null) return { state: "absent", revision: null, record: null };
			if (!snapshot || typeof snapshot !== "object" || !validRevision(snapshot.revision) || !Object.hasOwn(snapshot, "value")) {
				return { state: "unavailable", revision: null, record: null };
			}
			const record = storedSitemapRecord(snapshot.value);
			return record
				? { state: "saved", revision: snapshot.revision, record }
				: { state: "corrupt", revision: snapshot.revision, record: null };
		}
		const value = await ctx.kv.get<unknown>(SITEMAP_SETTINGS_KEY);
		if (value === null || value === undefined) return { state: "absent", revision: null, record: null };
		const record = storedSitemapRecord(value);
		return record ? { state: "saved", revision: null, record } : { state: "corrupt", revision: null, record: null };
	} catch (error) {
		ctx.log?.warn?.("seo: sitemap settings could not be read", { error: String(error) });
		return { state: "unavailable", revision: null, record: null };
	}
}

async function publicCollections(ctx: PluginContext): Promise<{ available: boolean; collections: SitemapCollectionInfo[] }> {
	const resolution = await resolveContentCollectionSource(ctx);
	return {
		available: resolution.available,
		collections: resolution.definitions
			.filter((definition) => isSitemapCollectionFileKey(definition.collection))
			.map((definition) => ({ key: definition.collection, label: definition.label, urlPattern: definition.urlPattern }))
			.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
	};
}

interface EffectiveSitemapValues {
	values: SeoAdminSitemapValues;
	selected: Set<string>;
	sources: Map<string, "saved" | "default">;
	preservedKeys: string[];
}

function effectiveSitemapValues(
	collections: readonly SitemapCollectionInfo[],
	record: StoredSitemapRecord | null,
): EffectiveSitemapValues {
	const stored = record?.values.contentTypes ?? null;
	const selection = resolveSitemapSelection(collections, stored);
	const contentTypes: Record<string, boolean> = { ...(stored ?? {}) };
	for (const item of selection) contentTypes[item.key] = item.selected;
	const available = new Set(collections.map((collection) => collection.key));
	return {
		values: { contentTypes, excludedPaths: record?.values.excludedPaths ?? [] },
		selected: new Set(selection.filter((item) => item.selected).map((item) => item.key)),
		sources: new Map(selection.map((item) => [item.key, item.source])),
		preservedKeys: Object.keys(stored ?? {}).filter((key) => !available.has(key)).sort(),
	};
}

function httpOrigin(value: unknown): string | null {
	if (typeof value !== "string" || !value.trim()) return null;
	try {
		const url = new URL(value.trim());
		if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
		return url.origin;
	} catch {
		return null;
	}
}

type SitemapFiles = SeoAdminPublicFiles & {
	noindex: boolean;
	/** Content types whose entries all carry noindex; the index lists no file for them. */
	contentTypeNoindex: string[];
	settings: "ok" | "corrupt" | "unavailable";
};

// The admin may run on another origin than the public site, so file links and
// sitemap URLs use the configured public site, like canonical metadata does.
async function sitemapPublicFiles(
	ctx: PluginContext,
	host: SitemapHost | null,
): Promise<SitemapFiles> {
	const facts = await readSiteIndexingFacts(ctx);
	if (facts.state !== "ok") {
		return { origin: null, source: null, sitemapUrl: null, robotsUrl: null, noindex: false, contentTypeNoindex: [], settings: facts.state };
	}
	const configured = httpOrigin(facts.siteUrl);
	const emdashSite = httpOrigin(ctx.site?.url);
	// Unsaved settings inherit EmDash's site URL; that is not a Site identity choice.
	const inherited = facts.updatedAt === null && configured !== null && configured === emdashSite;
	const astroSite = httpOrigin(host?.publicOrigin);
	const origin = configured ?? emdashSite ?? astroSite;
	return {
		origin,
		source: origin === null ? null : configured && !inherited ? "site-identity" : emdashSite ? "emdash-site" : "astro-site",
		sitemapUrl: origin ? `${origin}/sitemap.xml` : null,
		robotsUrl: origin ? `${origin}/robots.txt` : null,
		noindex: facts.noindex,
		contentTypeNoindex: facts.contentTypeNoindex,
		settings: "ok",
	};
}

type SitemapModuleFlag = { state: "ok"; enabled: boolean } | { state: "corrupt" | "unavailable" };

const SITEMAP_MODULE_DEFAULT = true;

function versionedSnapshot(value: unknown): value is { value: unknown; revision: string } {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
		Object.hasOwn(value as object, "value") && validRevision((value as { revision?: unknown }).revision);
}

/**
 * The Sitemaps feature flag alone, presence-aware: a stored module snapshot
 * must be valid, and without one the legacy `module:sitemap` key must be a
 * boolean. Anything else is invalid rather than the default.
 */
async function readSitemapModuleFlag(ctx: PluginContext): Promise<SitemapModuleFlag> {
	const kv = ctx.kv as PluginContext["kv"] & VersionedKv;
	if (typeof kv.getVersioned !== "function") return { state: "unavailable" };
	try {
		const snapshot = await kv.getVersioned(MODULES_SETTINGS_KEY);
		if (snapshot !== null) {
			if (!versionedSnapshot(snapshot)) return { state: "unavailable" };
			const record = storedModulesRecord(snapshot.value);
			return record ? { state: "ok", enabled: record.values.sitemap } : { state: "corrupt" };
		}
		const legacy = await kv.getVersioned("module:sitemap");
		if (legacy === null) return { state: "ok", enabled: SITEMAP_MODULE_DEFAULT };
		if (!versionedSnapshot(legacy)) return { state: "unavailable" };
		return typeof legacy.value === "boolean" ? { state: "ok", enabled: legacy.value } : { state: "corrupt" };
	} catch (error) {
		ctx.log?.warn?.("seo: sitemap feature flag could not be read", { error: String(error) });
		return { state: "unavailable" };
	}
}

function sitemapOwner(host: SitemapHost | null, flag: SitemapModuleFlag): SeoSitemapOwner {
	if (!host) return "not-installed";
	if (host.installation.owner !== "shipit") return host.installation.owner;
	return flag.state === "ok" && !flag.enabled ? "module-off" : "shipit";
}

interface SitemapState {
	owner: SeoSitemapOwner;
	routing: SitemapRouting;
	moduleFlag: SitemapModuleFlag;
	moduleEnabled: boolean;
	snapshot: SitemapSnapshot;
	files: SitemapFiles;
	collectionsAvailable: boolean;
	collections: SitemapCollectionInfo[];
	effective: EffectiveSitemapValues;
}

async function sitemapState(ctx: PluginContext, host: SitemapHost | null): Promise<SitemapState> {
	const [snapshot, moduleFlag, files, discovered] = await Promise.all([
		readSitemapSnapshot(ctx),
		readSitemapModuleFlag(ctx),
		sitemapPublicFiles(ctx, host),
		publicCollections(ctx),
	]);
	return {
		owner: sitemapOwner(host, moduleFlag),
		routing: host ? routingFor(host) : { trailingSlash: "ignore", i18n: null },
		moduleFlag,
		moduleEnabled: moduleFlag.state === "ok" && moduleFlag.enabled,
		snapshot,
		files,
		collectionsAvailable: discovered.available,
		collections: discovered.collections,
		effective: effectiveSitemapValues(discovered.collections, snapshot.record),
	};
}

function selectedCollections(state: SitemapState): SitemapCollectionInfo[] {
	return state.collections.filter((collection) => state.effective.selected.has(collection.key));
}

/**
 * Selected collections that get sitemap files. A content type noindex rule
 * leaves its type out without changing the stored selection, which route
 * checks keep using.
 */
function listedCollections(state: SitemapState): SitemapCollectionInfo[] {
	const ruled = new Set(state.files.contentTypeNoindex);
	return selectedCollections(state).filter((collection) => !ruled.has(collection.key));
}

/** Selection problems that would advertise one address for several entries. */
function routeProblems(collections: readonly SitemapCollectionInfo[], routing: SitemapRouting) {
	return {
		notUnique: collections.filter((collection) => !sitemapPatternIsUnique(collection)),
		overlaps: sitemapRouteOverlaps(collections, routing),
	};
}

function stateAvailability(state: SitemapState): SeoSitemapAvailability {
	if (state.owner !== "shipit") return "not-owned";
	if (state.snapshot.state === "corrupt") return "settings-corrupt";
	if (state.snapshot.state === "unavailable" || state.moduleFlag.state === "unavailable" ||
		state.files.settings === "unavailable") return "settings-unavailable";
	if (state.moduleFlag.state === "corrupt") return "feature-controls-invalid";
	if (state.files.settings === "corrupt") return "site-settings-invalid";
	// Site-wide noindex lists nothing, so it needs neither an origin nor a source.
	if (state.files.noindex) return "site-noindex";
	if (!state.files.origin) return "no-origin";
	if (!state.collectionsAvailable) return "source-unavailable";
	const problems = routeProblems(selectedCollections(state), state.routing);
	if (problems.notUnique.length || problems.overlaps.length) return "route-conflict";
	return "ready";
}

function limitsFor(host: SitemapHost): SitemapLimits {
	return host.limits ?? SITEMAP_LIMITS;
}

function siteLocale(ctx: PluginContext): string {
	return ctx.site?.locale || "en";
}

// One size for planning, reading and previews keeps file boundaries identical.
function pageSizeFor(ctx: PluginContext, host: SitemapHost): number {
	return sitemapPageSize(routingFor(host), siteLocale(ctx), limitsFor(host));
}

function routingFor(host: SitemapHost): SitemapRouting {
	return host.installation.routing ?? { trailingSlash: "ignore", i18n: null };
}

function sourceFilter(ctx: PluginContext, host: SitemapHost) {
	return { locales: sitemapAcceptedLocales(routingFor(host), siteLocale(ctx)) };
}

async function planSelected(ctx: PluginContext, host: SitemapHost, state: SitemapState): Promise<SeoAdminSitemapFilePlan[]> {
	const source = await host.openSource();
	const filter = sourceFilter(ctx, host);
	const plans: SeoAdminSitemapFilePlan[] = [];
	for (const collection of listedCollections(state)) {
		const plan = await source.planFiles(collection.key, filter, pageSizeFor(ctx, host));
		plans.push({ collection: collection.key, label: collection.label, candidates: plan.rowCount, files: plan.cursors });
	}
	return plans;
}

// ---------------------------------------------------------------------------
// Admin configuration and settings writes
// ---------------------------------------------------------------------------

export async function buildSitemapAdmin(ctx: PluginContext, host: SitemapHost | null): Promise<SeoAdminSitemapConfiguration> {
	const state = await sitemapState(ctx, host);
	let availability = stateAvailability(state);
	let plan: SeoAdminSitemapFilePlan[] | null = null;
	if (host && availability === "ready") {
		try {
			plan = await planSelected(ctx, host, state);
		} catch (error) {
			ctx.log?.warn?.("seo: sitemap source could not be planned", { error: String(error) });
			availability = "source-unavailable";
		}
	}
	const kv = ctx.kv as PluginContext["kv"] & VersionedKv;
	const conditional = typeof kv.getVersioned === "function" && typeof kv.compareAndSet === "function" &&
		typeof kv.compareAndDelete === "function";
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		storageVersion: SEO_ADMIN_SITEMAP_STORAGE_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		updatedAt: state.snapshot.record?.updatedAt ?? null,
		revision: state.snapshot.revision,
		settings: state.snapshot.state === "absent" ? "default" : state.snapshot.state,
		writable: conditional && state.collectionsAvailable && state.snapshot.state !== "unavailable",
		moduleEnabled: state.moduleEnabled,
		owner: state.owner,
		ownerDetail: host?.installation.detail ?? null,
		availability,
		groups: state.collections.map((collection) => ({
			key: collection.key,
			label: collection.label,
			source: state.effective.sources.get(collection.key) ?? "default",
			urlPattern: collection.urlPattern,
			unique: sitemapPatternIsUnique(collection),
		})),
		values: state.effective.values,
		preservedKeys: state.effective.preservedKeys,
		noindexContentTypes: state.collections
			.filter((collection) => state.files.contentTypeNoindex.includes(collection.key))
			.map((collection) => collection.key),
		overlaps: routeProblems(selectedCollections(state), state.routing).overlaps,
		plan,
		pageSize: host ? pageSizeFor(ctx, host) : SITEMAP_LIMITS.pageSize,
		publicFiles: {
			origin: state.files.origin,
			source: state.files.source,
			sitemapUrl: state.files.sitemapUrl,
			robotsUrl: state.files.robotsUrl,
		},
	};
}

export interface SitemapSaveInput {
	contentTypes: Record<string, boolean>;
	excludedPaths: string[];
	expectedRevision: string | null;
	replaceInvalid?: true;
}

const CONFLICT = "Sitemap settings changed elsewhere. Reload to review the latest choices before saving.";

function conditionalResult(value: unknown, action: "put" | "delete"): boolean {
	if (!value || typeof value !== "object" || typeof (value as { applied?: unknown }).applied !== "boolean") {
		throw new Error("The host returned an invalid conditional settings result.");
	}
	const result = value as { applied: boolean; revision?: unknown };
	if (result.applied && action === "put" && !validRevision(result.revision)) {
		throw new Error("The host returned an invalid settings revision.");
	}
	return result.applied;
}

/**
 * Revision-checked save. Choices for keys that are not public collections
 * now, including the legacy `staticRoutes` key, are kept unchanged.
 */
export async function saveSitemapSettings(
	ctx: PluginContext,
	host: SitemapHost | null,
	input: SitemapSaveInput,
): Promise<SeoAdminSitemapSaveResult> {
	const kv = ctx.kv as PluginContext["kv"] & VersionedKv;
	if (typeof kv.getVersioned !== "function" || typeof kv.compareAndSet !== "function") {
		return { success: false, errors: { _form: "This EmDash host cannot save sitemap settings with a revision check." } };
	}
	const snapshot = await readSitemapSnapshot(ctx);
	if (snapshot.state === "unavailable") {
		return { success: false, errors: { _form: "Stored sitemap settings could not be read. Nothing was saved." } };
	}
	if (snapshot.revision !== input.expectedRevision) return { success: false, conflict: true, errors: { _form: CONFLICT } };
	if (snapshot.state === "corrupt" && input.replaceInvalid !== true) {
		return { success: false, errors: { _form: "Stored sitemap settings are invalid. Confirm that these choices replace them." } };
	}
	const discovered = await publicCollections(ctx);
	if (!discovered.available) {
		return { success: false, errors: { _form: "EmDash content types could not be listed. Nothing was saved." } };
	}
	const available = new Set(discovered.collections.map((collection) => collection.key));
	if (Object.keys(input.contentTypes).some((key) => !available.has(key))) {
		return { success: false, errors: { contentTypes: "A selected content type is no longer a public EmDash collection. Reload and try again." } };
	}
	const merged = { ...(snapshot.record?.values.contentTypes ?? {}), ...input.contentTypes };
	const validation = validateSeoAdminSitemapValues({ contentTypes: merged, excludedPaths: input.excludedPaths });
	if (!validation.success) return { success: false, errors: validation.errors };
	const chosen = effectiveSitemapValues(discovered.collections, {
		version: SEO_ADMIN_SITEMAP_STORAGE_VERSION, updatedAt: "", values: validation.values,
	});
	const problems = routeProblems(discovered.collections.filter((item) => chosen.selected.has(item.key)), host ? routingFor(host) : { trailingSlash: "ignore", i18n: null });
	const label = (key: string) => discovered.collections.find((item) => item.key === key)?.label ?? key;
	if (problems.notUnique.length) {
		return { success: false, errors: { contentTypes: `${problems.notUnique.map((item) => item.label).join(", ")} use a URL pattern without {slug} or {id}, so entries can share one address. Leave them out of the sitemap.` } };
	}
	if (problems.overlaps.length) {
		const [left, right] = problems.overlaps[0].collections;
		return { success: false, errors: { contentTypes: `${label(left)} and ${label(right)} have URL patterns that can produce the same address. Select only one of them.` } };
	}
	const next: StoredSitemapRecord = {
		version: SEO_ADMIN_SITEMAP_STORAGE_VERSION,
		updatedAt: new Date().toISOString(),
		values: validation.values,
	};
	if (!conditionalResult(await kv.compareAndSet(SITEMAP_SETTINGS_KEY, input.expectedRevision, next), "put")) {
		return { success: false, conflict: true, errors: { _form: CONFLICT } };
	}
	return { success: true, sitemap: await buildSitemapAdmin(ctx, host) };
}

/** Revision-checked delete of the stored record, returning to Pages and Posts only. */
export async function resetSitemapSettings(
	ctx: PluginContext,
	host: SitemapHost | null,
	input: { expectedRevision: string | null },
): Promise<SeoAdminSitemapSaveResult> {
	const kv = ctx.kv as PluginContext["kv"] & VersionedKv;
	if (typeof kv.getVersioned !== "function" || typeof kv.compareAndDelete !== "function") {
		return { success: false, errors: { _form: "This EmDash host cannot reset sitemap settings with a revision check." } };
	}
	const snapshot = await readSitemapSnapshot(ctx);
	if (snapshot.state === "unavailable") {
		return { success: false, errors: { _form: "Stored sitemap settings could not be read. Nothing was changed." } };
	}
	if (snapshot.revision !== input.expectedRevision) return { success: false, conflict: true, errors: { _form: CONFLICT } };
	if (input.expectedRevision !== null &&
		!conditionalResult(await kv.compareAndDelete(SITEMAP_SETTINGS_KEY, input.expectedRevision), "delete")) {
		return { success: false, conflict: true, errors: { _form: CONFLICT } };
	}
	return { success: true, sitemap: await buildSitemapAdmin(ctx, host) };
}

/**
 * Explicit choices for export: every public collection's effective state,
 * every preserved stored key and `staticRoutes`. Refuses an unreadable or
 * invalid record instead of exporting defaults in its place.
 */
export async function readSitemapPortableValues(ctx: PluginContext): Promise<{ values: SeoAdminSitemapValues; updatedAt: string | null }> {
	const [snapshot, discovered] = await Promise.all([readSitemapSnapshot(ctx), publicCollections(ctx)]);
	if (snapshot.state === "corrupt" || snapshot.state === "unavailable") {
		throw new Error("Sitemap settings must be restored or replaced before export or import.");
	}
	const effective = effectiveSitemapValues(discovered.collections, snapshot.record);
	return {
		values: {
			contentTypes: { [SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY]: true, ...effective.values.contentTypes },
			excludedPaths: effective.values.excludedPaths,
		},
		updatedAt: snapshot.record?.updatedAt ?? null,
	};
}

// ---------------------------------------------------------------------------
// Child files, preview and public responses
// ---------------------------------------------------------------------------

interface LegacyOverride {
	canonical: string | null;
	noIndex: boolean;
	image: string | null;
}

interface OverrideStore {
	query?: (options: { limit: number }) => Promise<{ items: unknown[] }>;
	getMany?: (ids: string[]) => Promise<Map<string, unknown>>;
}

/** Plugin storage binds the plugin id and collection besides the ids. */
const OVERRIDE_BATCH = 90;

function cleanText(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function overrideRecords(store: OverrideStore, refs: readonly string[]): Promise<Map<string, unknown>> {
	const records = new Map<string, unknown>();
	for (let index = 0; index < refs.length; index += OVERRIDE_BATCH) {
		for (const [ref, value] of await store.getMany!(refs.slice(index, index + OVERRIDE_BATCH))) records.set(ref, value);
	}
	return records;
}

// Legacy Shipit overrides still own canonical, robots and the social image on
// public pages until they are migrated, so the sitemap applies them the same
// way: by id first, then by slug. One bounded probe per request skips the
// lookups entirely once no legacy override remains.
async function readLegacyOverrides(
	ctx: PluginContext,
	collection: string,
	rows: readonly SitemapSourceRow[],
	known: { exists: boolean | null },
): Promise<Map<string, LegacyOverride>> {
	const result = new Map<string, LegacyOverride>();
	const store = (ctx.storage as Record<string, unknown> | undefined)?.overrides as OverrideStore | undefined;
	if (!rows.length || typeof store?.query !== "function" || typeof store.getMany !== "function") return result;
	known.exists ??= (await store.query({ limit: 1 })).items.length > 0;
	if (!known.exists) return result;
	const byId = await overrideRecords(store, rows.map((row) => `${collection}:${row.id}`));
	const slugRefs = rows
		.filter((row) => !byId.has(`${collection}:${row.id}`) && row.slug !== row.id)
		.map((row) => `${collection}:${row.slug}`);
	const bySlug = slugRefs.length ? await overrideRecords(store, slugRefs) : new Map<string, unknown>();
	for (const row of rows) {
		const record = (byId.get(`${collection}:${row.id}`) ?? bySlug.get(`${collection}:${row.slug}`)) as
			| { canonical?: unknown; robots?: unknown; ogImage?: unknown }
			| undefined;
		if (!record) continue;
		const robots = cleanText(record.robots)?.toLowerCase() ?? "";
		result.set(row.id, {
			canonical: cleanText(record.canonical),
			noIndex: robots.includes("noindex"),
			image: cleanText(record.ogImage),
		});
	}
	return result;
}

// Only these outcomes can change when a legacy override applies.
const LEGACY_RELEVANT = new Set(["included", "canonical-elsewhere", "canonical-invalid"]);

interface ChildFile {
	entries: SitemapEntryDecision[];
	alternates: Map<string, SitemapAlternate[]>;
}

async function computeChild(
	ctx: PluginContext,
	host: SitemapHost,
	state: SitemapState,
	collection: SitemapCollectionInfo,
	after: string | null,
): Promise<ChildFile | null> {
	const routing = routingFor(host);
	const limits = limitsFor(host);
	const source = await host.openSource();
	const filter = sourceFilter(ctx, host);
	const rows = await source.readRows(collection.key, filter, { after, limit: pageSizeFor(ctx, host) });
	if (!rows.length) return null;
	const overrides = { exists: null as boolean | null };
	const decisionContext = {
		collection,
		routing,
		origin: state.files.origin!,
		exclusions: sitemapExclusionKeys(state.effective.values.excludedPaths),
		seoUrls: host.seoUrls,
		maxUrlLength: limits.maxUrlLength,
	};
	const decide = async (list: readonly SitemapSourceRow[]) => {
		const first = list.map((row) => decideSitemapEntry(row, decisionContext));
		const relevant = list.filter((_row, index) => LEGACY_RELEVANT.has(first[index].status));
		const legacy = await readLegacyOverrides(ctx, collection.key, relevant, overrides);
		return legacy.size
			? list.map((row, index) => legacy.has(row.id) ? decideSitemapEntry({ ...row, legacy: legacy.get(row.id) }, decisionContext) : first[index])
			: first;
	};
	const entries = markDuplicateSitemapUrls(await decide(rows));
	let alternates = new Map<string, SitemapAlternate[]>();
	if (sitemapLocalesRouted(routing)) {
		const groups = [...new Set(entries
			.filter((entry) => entry.status === "included" && entry.translationGroup)
			.map((entry) => entry.translationGroup!))];
		const pageIds = new Set(rows.map((row) => row.id));
		const members = groups.length ? await source.readGroups(collection.key, filter, groups) : [];
		const outside = members.filter((member) => !pageIds.has(member.id));
		const memberDecisions = [...entries, ...await decide(outside)];
		alternates = sitemapAlternates(entries, memberDecisions, routing);
	}
	return { entries, alternates };
}

export async function previewSitemapFile(
	ctx: PluginContext,
	host: SitemapHost | null,
	input: { collection: string; after: string | null } & SitemapPreviewWindowInput,
): Promise<SeoAdminSitemapPreview> {
	try {
		const state = await sitemapState(ctx, host);
		const availability = stateAvailability(state);
		if (!host || availability !== "ready") {
			return { success: false, errors: { _form: PREVIEW_UNAVAILABLE[availability] } };
		}
		if (state.files.contentTypeNoindex.includes(input.collection) && selectedCollections(state).some((item) => item.key === input.collection)) {
			return { success: false, errors: { _form: "A content type noindex rule in Indexing rules leaves this content type out of the sitemap." } };
		}
		const collection = listedCollections(state).find((item) => item.key === input.collection);
		if (!collection) return { success: false, errors: { _form: "This content type is not selected for the sitemap." } };
		const child = await computeChild(ctx, host, state, collection, input.after);
		if (!child) return { success: false, errors: { _form: "This sitemap file has no published entries." } };
		const entries = child.entries.map((entry) => ({
			id: entry.id,
			locale: entry.locale,
			status: entry.status,
			path: entry.path,
			url: entry.url,
			lastmod: entry.lastmod,
			image: entry.image,
			canonical: entry.canonical,
			alternates: child.alternates.get(entry.id)?.length ?? 0,
		}));
		const alternates = [...child.alternates].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
			.map(([id, values]) => [id, [...values].sort((left, right) => {
				const a = `${left.hreflang}:${left.href}`;
				const b = `${right.hreflang}:${right.href}`;
				return a < b ? -1 : a > b ? 1 : 0;
			})]);
		const window = await sitemapPreviewWindow(entries, {
			collection,
			after: input.after,
			revision: state.snapshot.revision,
			owner: state.owner,
			moduleEnabled: state.moduleEnabled,
			routing: state.routing,
			values: state.effective.values,
			files: state.files,
			collections: state.collections,
			decisions: child.entries,
			alternates,
		}, input);
		return {
			success: true,
			collection: collection.key,
			after: input.after,
			fileUrl: `${state.files.origin}${sitemapChildPath(collection.key, input.after)}`,
			...window,
		};
	} catch (error) {
		if (error instanceof SitemapPreviewWindowError) {
			return { success: false, ...(error.stale ? { stale: true as const } : {}), errors: { _form: error.message } };
		}
		if (error instanceof SitemapCapacityError) return { success: false, errors: { _form: CAPACITY_MESSAGES[error.kind] } };
		ctx.log?.warn?.("seo: sitemap preview failed", { error: String(error) });
		return { success: false, errors: { _form: "Published entries could not be read for this preview." } };
	}
}

const PREVIEW_UNAVAILABLE: Record<SeoSitemapAvailability, string> = {
	ready: "",
	"site-noindex": "Site-wide noindex is on, so the public sitemap lists no URLs.",
	"no-origin": "Set the production URL in Local SEO's Website settings before previewing sitemap files.",
	"settings-corrupt": "Stored sitemap settings are invalid. Replace them before previewing.",
	"settings-unavailable": "Stored sitemap settings could not be read.",
	"feature-controls-invalid": "The stored Feature controls record is invalid, so the Sitemaps switch cannot be read.",
	"site-settings-invalid": "The stored site settings are invalid, so the site URL and site-wide noindex cannot be read.",
	"source-unavailable": "Published entries could not be read.",
	"route-conflict": "Selected content types can give several entries one address. Resolve the URL pattern notice first.",
	"not-owned": "This plugin does not serve this site's sitemap.",
};

const CAPACITY_MESSAGES: Record<SitemapCapacityError["kind"], string> = {
	protocol: "This sitemap file would exceed the sitemap protocol's URL or size limit, so it is not served.",
	"request-budget": "This sitemap file needs more database queries than one request may run, usually because entries have translations in many locales. It is not served.",
};

export type SitemapHttpResult =
	| { pass: true }
	| { pass: false; status: number; contentType: string; body: string; cacheControl: string; retryAfter?: number };

/** Saved changes reach the origin response at once; shared caches may hold a file for 5 minutes. */
export const SITEMAP_CACHE_CONTROL = "public, max-age=300";

function xmlResponse(body: string): SitemapHttpResult {
	return { pass: false, status: 200, contentType: "application/xml; charset=utf-8", body, cacheControl: SITEMAP_CACHE_CONTROL };
}

function textResponse(status: number, body: string, retryAfter?: number): SitemapHttpResult {
	return {
		pass: false,
		status,
		contentType: "text/plain; charset=utf-8",
		body,
		cacheControl: "no-store",
		...(retryAfter ? { retryAfter } : {}),
	};
}

/**
 * Public sitemap response. Returns `pass` when Shipit does not own the file,
 * so the host's own route answers; `null` is an owned address with an
 * unsupported query. Never returns partial XML: source and capacity failures
 * are 503 and 500 responses.
 */
export async function serveSitemapFile(
	ctx: PluginContext,
	host: SitemapHost | null,
	file: SitemapFileRequest | null,
): Promise<SitemapHttpResult> {
	if (!host || host.installation.owner !== "shipit") return { pass: true };
	try {
		const state = await sitemapState(ctx, host);
		if (state.owner !== "shipit") return { pass: true };
		if (file === null) return textResponse(404, "Sitemap file not found.");
		const availability = stateAvailability(state);
		if (availability !== "ready" && availability !== "site-noindex") {
			ctx.log?.warn?.("seo: sitemap unavailable", { availability });
			return textResponse(503, "The sitemap is temporarily unavailable.", 300);
		}
		// Only the empty site-wide noindex index can be served without an origin.
		const origin = state.files.origin ?? "";
		if (file.kind === "index") {
			if (availability === "site-noindex") return xmlResponse(renderSitemapIndex(origin, [], limitsFor(host)));
			const plans = await planSelected(ctx, host, state);
			const files = plans.flatMap((plan) => plan.files.map((after) => ({ collection: plan.collection, after })));
			return xmlResponse(renderSitemapIndex(origin, files, limitsFor(host)));
		}
		if (availability === "site-noindex") return textResponse(404, "Sitemap file not found.");
		const collection = listedCollections(state).find((item) => item.key === file.collection);
		if (!collection) return textResponse(404, "Sitemap file not found.");
		const child = await computeChild(ctx, host, state, collection, file.after);
		if (!child) return textResponse(404, "Sitemap file not found.");
		return xmlResponse(renderSitemapUrlset(child.entries, child.alternates, limitsFor(host)));
	} catch (error) {
		if (error instanceof SitemapCapacityError) {
			ctx.log?.error?.("seo: sitemap capacity exceeded", { kind: error.kind, error: error.message });
			return textResponse(500, CAPACITY_MESSAGES[error.kind]);
		}
		ctx.log?.warn?.("seo: sitemap could not be generated", { error: String(error) });
		return textResponse(503, "The sitemap is temporarily unavailable.", 300);
	}
}
