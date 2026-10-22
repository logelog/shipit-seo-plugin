// Saved-entry metadata resolution and disposable analysis shared by the native
// engine and the registry panel bundle. The registry bundle imports this module
// directly, so it must stay free of route wiring, zod and Node built-ins or the
// whole engine is pulled into a bundle with a 128 KiB per-file limit.
import type { PluginContext, PublicPageContext } from "emdash";
import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import {
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_MODULES_STORAGE_VERSION,
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	extractSeoSchemaTypes,
	isSeoContentCollectionKey,
	seoKeywordIdentity,
	seoModuleCanRun,
	SEO_ADMIN_OWNERSHIP_FIELDS,
	type SeoAdminContentScore,
	type SeoAdminCustomSchema,
	type SeoAdminEntryOwnership,
	type SeoAdminOwnershipField,
	type SeoAdminOwnershipFieldName,
	type SeoAdminOwnershipFieldReason,
	type SeoAdminOwnershipEntryReason,
	type SeoAdminModuleValues,
	type SeoAdminSchemaPresetValues,
	type SeoAdminSchemaContentTypeValues,
	type SeoAdminSettingsValues,
	type SeoAdminEntrySchemaGraph,
	type SeoAdminMetadataSource,
	type SeoAdminMetaOverride,
	type SeoAdminSocialOverride,
	type SeoAdminTemplateSet,
	type SeoAdminTemplateValues,
	type SeoTemplateCollection,
	validateSeoAdminCustomSchemaInput,
	validateSeoAdminSchemaContentTypeValues,
	validateSeoAdminSchemaPresetValues,
	validateSeoAdminTemplateSet,
} from "./admin-contract.ts";
import { SEO_SCORE_VERSION, analyzeSeoContent, seoContentCheckProblem, type SeoNoindexSource } from "./analysis.ts";
import { contentTypeNoindexApplies } from "./content-type-noindex-policy.ts";
import { currentSeoScoreAssessmentProblem } from "./score-result-validation.ts";
import {
	requireCollectionAnalysisProfile,
	verifyCollectionAnalysisProfileRevision,
	type CollectionAnalysisProfileSelection,
	type ConfiguredCollectionAnalysisProfile,
} from "./collection-analysis-profile.ts";
import { extractSeoDocumentText } from "./document-signals.ts";
import {
	contentBodyValue,
	generatedContentDescription,
	isGeneratedDescription,
	contentImageInputs,
	featuredImageFromContentData,
	keywordFromContent,
} from "./content-analysis-inputs.ts";
export { contentBodyValue, keywordFromContent } from "./content-analysis-inputs.ts";
import {
	entrySchemaTargetApplies,
	parseStoredEntrySchemaTarget,
	type EntrySchemaPageEntry,
	type EntrySchemaTarget,
} from "./entry-schemas.ts";
import { resolveFocusKeywordOwnership, type FocusKeywordOwnership } from "./focus-keyword.ts";
import {
	INVALID_SCHEMA_CONTENT_TYPE_ROLES,
	JsonLdValidationError,
	TemplateExpansionLimitError,
	applyVarsDeep,
	buildSchemaPresetGraphs,
	defaultSchemaContentTypeRole,
	isHttpUrl,
	resolveContentTypeTemplate,
	resolveSchemaOrganizationReferences,
	schemaContentTypeRole,
	validateCustomJsonLd,
	type ContentTypeTemplate,
	type GlobalSeoSettings,
} from "./lib.ts";
import { readMetaOverride } from "./meta-overrides.ts";
import { planLegacyOverrideMigration } from "./migration.ts";
import {
	METADATA_TEMPLATES_KEY,
	LEGACY_TEMPLATE_REVISIONS_KEY,
	absentTokens,
	defaultMetadataTemplate,
	inheritedMetadataTemplate,
	readLegacyTemplateFields,
	readMetadataTemplates,
	recordTokens,
	scoreTokenFor,
	type InheritedMetadataTemplate,
} from "./metadata-templates.ts";
import {
	canonicalBusinessIdentityJson,
	type BusinessIdentityRenderState,
} from "./business-identity.ts";
import { businessIdentityStoreFor, readBusinessIdentityRenderState } from "./business-identity-commands.ts";
import {
	PUBLISHER_RESOLVER_VERSION,
	presetDefinesCustomPublisherId,
	publisherOwnershipEffective,
	readPublisherOwnership,
	resolvePublisherOutput,
	type PublisherOwnershipEffective,
} from "./publisher-ownership.ts";
import { createSeoSchemaResolutionState, resolveSeoSchemaCandidate } from "./schema-resolution.ts";
import { getGlobalSettings, getNoindex, readContentScoringPolicy, readReadableSiteSettings } from "./settings-runtime.ts";
import { entryAnalysisPolicyAdmits, type EntryAnalysisPurpose } from "./analysis-admission.ts";
import { normalizeSeoSitemapPath, validateSeoCanonical, type SeoCanonicalStatus } from "./sitemap-policy.ts";
import { readSocialOverride } from "./social-overrides.ts";
import { seoSnippetDatePrefix } from "./snippet-fit.ts";

export interface Override {
	ref: string;
	title?: string;
	description?: string;
	canonical?: string;
	robots?: string;
	ogImage?: string;
	updatedAt: string;
}

export type SeoScoreRecord = SeoAdminContentScore;

interface SeoAnalysisRuntimeConfig {
	global: GlobalSeoSettings;
	presets: SeoAdminSchemaPresetValues;
	customSchemas: SeoAdminCustomSchema[];
	contentTypeRoles: SeoAdminSchemaContentTypeValues;
	/** The stored mapping exists but cannot be read; schema output fails closed. */
	contentTypeRolesInvalid: boolean;
	businessIdentity: BusinessIdentityRenderState;
	publisherOwnership: PublisherOwnershipEffective;
	/** Values of the readable settings snapshot the fingerprint was taken from. */
	settings: SeoAdminSettingsValues;
	fingerprint: string;
}

export interface StoredCustomSchema {
	storageVersion?: typeof SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION;
	name: string;
	scope: string; // "global" | "posts" | "pages" | "services" | "${collection}:${id}"
	json: string; // raw JSON-LD text (validated on save)
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	/** Written by the exact-entry commands; legacy paths must keep it. */
	target?: EntrySchemaTarget;
}

export interface StoredSeoAdminModules {
	version: typeof SEO_ADMIN_MODULES_STORAGE_VERSION;
	updatedAt: string;
	values: SeoAdminModuleValues;
}

export interface StoredSeoAdminSchemaPresets {
	version: typeof SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION;
	updatedAt: string;
	values: SeoAdminSchemaPresetValues;
}

interface StoredSeoAdminSchemaPresetsV1 {
	version: 1;
	updatedAt: string;
	values: Partial<SeoAdminSchemaPresetValues>;
}

export const PRESET_KEYS = SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => definition.key);
export const SEO_MODULES = SEO_ADMIN_MODULE_DEFINITIONS;
export type PluginContentAccess = NonNullable<PluginContext["content"]>;

export interface SeoContentCollectionDefinition {
	collection: string;
	label: string;
	labelSingular: string;
	titleField: string | null;
	dateField: string | null;
	portableTextBodyField: string | null;
	hasSeo: boolean;
	urlPattern: string | null;
	routable: boolean;
}

interface DiscoveredContentCollection {
	slug: string;
	label: string;
	labelSingular?: string | null;
	titleField?: string | null;
	dateField?: string | null;
	fields?: Array<{ slug: string; type: string }>;
	hasSeo?: boolean;
	urlPattern?: string | null;
	routable?: boolean;
	hidden?: boolean;
}

type CollectionAwareContentAccess = PluginContentAccess & {
	listCollections?: () => Promise<DiscoveredContentCollection[]>;
};

type CollectionAwarePluginContext = PluginContext & {
	schema?: { listCollections: () => Promise<DiscoveredContentCollection[]> };
};

export interface ContentCollectionResolution {
	available: boolean;
	definitions: SeoContentCollectionDefinition[];
}

const contentCollectionCache = new WeakMap<object, Promise<ContentCollectionResolution>>();

function singlePortableTextField(fields: DiscoveredContentCollection["fields"]): string | null {
	let selected: string | null = null;
	for (const field of fields ?? []) {
		if (field.type !== "portableText" || typeof field.slug !== "string" || !field.slug) continue;
		if (selected) return null;
		selected = field.slug;
	}
	return selected;
}

export async function resolveContentCollectionSource(
	ctx: PluginContext,
): Promise<ContentCollectionResolution> {
	const schema = (ctx as CollectionAwarePluginContext).schema;
	const content = ctx.content as CollectionAwareContentAccess | undefined;
	const discovery = typeof schema?.listCollections === "function" ? schema : content;
	const listCollections = discovery?.listCollections;
	if (!discovery || typeof listCollections !== "function")
		return { available: false, definitions: [] };
	const cached = contentCollectionCache.get(discovery);
	if (cached) return cached;
	const pending = (async () => {
		try {
			const definitions = (await listCollections.call(discovery))
				.filter(
					(item) =>
						isSeoContentCollectionKey(item.slug) && item.routable !== false && item.hidden !== true,
				)
				.map((item) => ({
					collection: item.slug,
					label: clean(item.label) ?? item.slug,
					labelSingular: clean(item.labelSingular) ?? clean(item.label) ?? item.slug,
					titleField: clean(item.titleField) ?? null,
					dateField: clean(item.dateField) ?? null,
					portableTextBodyField: singlePortableTextField(item.fields),
					hasSeo: item.hasSeo !== false,
					urlPattern: clean(item.urlPattern) ?? null,
					routable: item.routable !== false,
				}));
			return { available: true, definitions };
		} catch (error: unknown) {
			ctx.log?.warn?.("seo: content collection discovery failed", { error: String(error) });
			return { available: false, definitions: [] };
		}
	})();
	contentCollectionCache.set(discovery, pending);
	void pending.then((resolution) => {
		if (!resolution.available && contentCollectionCache.get(discovery) === pending)
			contentCollectionCache.delete(discovery);
	}, () => {
		if (contentCollectionCache.get(discovery) === pending)
			contentCollectionCache.delete(discovery);
	});
	return pending;
}

export async function resolveContentCollections(ctx: PluginContext): Promise<SeoContentCollectionDefinition[]> {
	return (await resolveContentCollectionSource(ctx)).definitions;
}

export async function resolveContentCollection(
	ctx: PluginContext,
	collection: string,
): Promise<SeoContentCollectionDefinition | null> {
	return (
		(await resolveContentCollections(ctx)).find((item) => item.collection === collection) ?? null
	);
}
export const MODULES_SETTINGS_KEY = `configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`;
export const SCHEMA_PRESETS_SETTINGS_KEY = `configuration:schema-presets:v${SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION}`;
export const LEGACY_SCHEMA_PRESETS_SETTINGS_KEY = "configuration:schema-presets:v1";
export const TEMPLATES_SETTINGS_KEY = METADATA_TEMPLATES_KEY;
export const SCHEMA_CONTENT_TYPES_SETTINGS_KEY = `configuration:schema-content-types:v${SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION}`;

export function storedModulesRecord(value: unknown): StoredSeoAdminModules | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredSeoAdminModules>;
	if (
		candidate.version !== SEO_ADMIN_MODULES_STORAGE_VERSION ||
		typeof candidate.updatedAt !== "string"
	)
		return null;
	const source = candidate.values;
	if (!source || typeof source !== "object" || Array.isArray(source)) return null;
	const values = {} as SeoAdminModuleValues;
	for (const definition of SEO_MODULES) {
		const enabled = source[definition.key];
		if (typeof enabled !== "boolean") return null;
		values[definition.key] = enabled;
	}
	return {
		version: SEO_ADMIN_MODULES_STORAGE_VERSION,
		updatedAt: candidate.updatedAt,
		values,
	};
}

function effectiveModuleValues(values: SeoAdminModuleValues): SeoAdminModuleValues {
	return Object.fromEntries(
		SEO_MODULES.map((definition) => [
			definition.key,
			seoModuleCanRun(definition.key) && values[definition.key],
		]),
	) as SeoAdminModuleValues;
}

function storedSchemaPresetsRecord(value: unknown): StoredSeoAdminSchemaPresets | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredSeoAdminSchemaPresets>;
	if (
		candidate.version !== SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION ||
		typeof candidate.updatedAt !== "string"
	)
		return null;
	const validation = validateSeoAdminSchemaPresetValues(candidate.values);
	if (!validation.success) return null;
	return {
		version: SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
		updatedAt: candidate.updatedAt,
		values: validation.values,
	};
}

function schemaPresetValuesWithDefaults(value?: unknown): SeoAdminSchemaPresetValues {
	const source =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return Object.fromEntries(
		SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => [
			definition.key,
			typeof source[definition.key] === "boolean"
				? source[definition.key]
				: definition.defaultEnabled,
		]),
	) as SeoAdminSchemaPresetValues;
}

function legacySchemaPresetsRecord(value: unknown): StoredSeoAdminSchemaPresetsV1 | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredSeoAdminSchemaPresetsV1>;
	if (candidate.version !== 1 || typeof candidate.updatedAt !== "string") return null;
	if (!candidate.values || typeof candidate.values !== "object" || Array.isArray(candidate.values))
		return null;
	return {
		version: 1,
		updatedAt: candidate.updatedAt,
		values: schemaPresetValuesWithDefaults(candidate.values),
	};
}

export async function readAdminModules(
	ctx: PluginContext,
): Promise<{ values: SeoAdminModuleValues; updatedAt: string | null }> {
	const stored = storedModulesRecord(await ctx.kv.get<unknown>(MODULES_SETTINGS_KEY));
	if (stored) return { values: effectiveModuleValues(stored.values), updatedAt: stored.updatedAt };

	const values = {} as SeoAdminModuleValues;
	for (const definition of SEO_MODULES) {
		const legacy = await ctx.kv.get<boolean>(`module:${definition.key}`);
		values[definition.key] = seoModuleCanRun(definition.key)
			? (legacy ?? definition.defaultEnabled)
			: false;
	}
	return { values, updatedAt: null };
}

export async function readAdminSchemaPresets(ctx: PluginContext): Promise<{
	values: SeoAdminSchemaPresetValues;
	updatedAt: string | null;
	migrationNeeded: boolean;
}> {
	const stored = storedSchemaPresetsRecord(await ctx.kv.get<unknown>(SCHEMA_PRESETS_SETTINGS_KEY));
	if (stored)
		return {
			values: stored.values,
			updatedAt: stored.updatedAt,
			migrationNeeded: false,
		};
	return readInheritedAdminSchemaPresets(ctx);
}

export async function readInheritedAdminSchemaPresets(ctx: PluginContext): Promise<{
	values: SeoAdminSchemaPresetValues;
	updatedAt: string | null;
	migrationNeeded: boolean;
}> {
	const legacySnapshot = legacySchemaPresetsRecord(
		await ctx.kv.get<unknown>(LEGACY_SCHEMA_PRESETS_SETTINGS_KEY),
	);
	if (legacySnapshot) {
		return {
			values: schemaPresetValuesWithDefaults(legacySnapshot.values),
			updatedAt: legacySnapshot.updatedAt,
			migrationNeeded: true,
		};
	}

	const values = schemaPresetValuesWithDefaults();
	let legacyFound = false;
	for (const definition of SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS) {
		const legacy = await ctx.kv.get<boolean>(`preset:${definition.key}`);
		if (typeof legacy === "boolean") {
			values[definition.key] = legacy;
			legacyFound = true;
		}
	}
	return { values, updatedAt: null, migrationNeeded: legacyFound };
}

export interface StoredSeoAdminSchemaContentTypes {
	version: typeof SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION;
	updatedAt: string;
	values: SeoAdminSchemaContentTypeValues;
}

export function storedSchemaContentTypesRecord(value: unknown): StoredSeoAdminSchemaContentTypes | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredSeoAdminSchemaContentTypes>;
	if (candidate.version !== SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION || typeof candidate.updatedAt !== "string")
		return null;
	const validation = validateSeoAdminSchemaContentTypeValues(candidate.values);
	if (!validation.success) return null;
	return { version: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION, updatedAt: candidate.updatedAt, values: validation.values };
}

export interface SchemaContentTypeRolesRead {
	values: SeoAdminSchemaContentTypeValues;
	updatedAt: string | null;
	/** A record is stored but unreadable; `values` is then empty, not the saved mapping. */
	invalid: boolean;
}

/** One read. A versioned read tells a missing record from a stored JSON null, which is invalid. */
export async function readSchemaContentTypeRoles(ctx: PluginContext): Promise<SchemaContentTypeRolesRead> {
	const kv = ctx.kv as Partial<PluginContext["kv"]>;
	let present: boolean;
	let raw: unknown;
	if (typeof kv.getVersioned === "function") {
		const versioned = await kv.getVersioned<unknown>(SCHEMA_CONTENT_TYPES_SETTINGS_KEY);
		present = versioned !== null && versioned !== undefined;
		raw = versioned ? versioned.value : null;
	} else {
		raw = await ctx.kv.get<unknown>(SCHEMA_CONTENT_TYPES_SETTINGS_KEY);
		present = raw !== null && raw !== undefined;
	}
	const stored = present ? storedSchemaContentTypesRecord(raw) : null;
	return { values: stored?.values ?? {}, updatedAt: stored?.updatedAt ?? null, invalid: present && !stored };
}

/** Roles for schema output: an unreadable record fails closed instead of reverting to defaults. */
export function schemaOutputContentTypeRoles(
	read: Pick<SchemaContentTypeRolesRead, "values" | "invalid">,
): SeoAdminSchemaContentTypeValues | typeof INVALID_SCHEMA_CONTENT_TYPE_ROLES {
	return read.invalid ? INVALID_SCHEMA_CONTENT_TYPE_ROLES : read.values;
}

function analysisConfigurationFingerprint(
	settings: SeoAdminSettingsValues,
	presets: SeoAdminSchemaPresetValues,
	customSchemas: readonly SeoAdminCustomSchema[],
	contentTypeRoles: SeoAdminSchemaContentTypeValues = {},
	contentTypeRolesInvalid = false,
	businessIdentity: BusinessIdentityRenderState = { state: "absent" },
	publisherOwnership: PublisherOwnershipEffective = "automatic",
	modules?: SeoAdminModuleValues,
): string {
	const roleEntries = Object.entries(contentTypeRoles)
		.filter(([collection, role]) => role !== defaultSchemaContentTypeRole(collection))
		.sort(([left], [right]) => left.localeCompare(right));
	const payload = JSON.stringify({
		// Omitted while every role is a default, so earlier fingerprints stay valid.
		...(roleEntries.length ? { contentTypeRoles: roleEntries } : {}),
		...(contentTypeRolesInvalid ? { contentTypeRolesInvalid: true } : {}),
		// Always present: schema results depend on the publisher decision and its
		// version, so scores from an earlier rule read as stale, never current.
		publisherResolver: [PUBLISHER_RESOLVER_VERSION, publisherOwnership],
		// Omitted while no identity is stored, so earlier fingerprints stay valid.
		...(businessIdentity.state === "absent"
			? {}
			: {
					businessIdentity: businessIdentity.state === "valid"
						? canonicalBusinessIdentityJson(businessIdentity.record)
						: businessIdentity.state,
				}),
		settings: [
			settings.siteName,
			settings.siteUrl,
			settings.publisherType,
			settings.organizationName,
			settings.organizationLogo,
			settings.personName,
			settings.defaultSocialImage,
			settings.twitterHandle,
			settings.noindex,
			[...settings.socialProfiles],
			[...settings.personProfiles],
		],
		presets: PRESET_KEYS.map((key) => [key, presets[key]]),
		// Effective flags, so a legacy module key without a versioned record still counts.
		...(modules ? { modules: SEO_MODULES.map((definition) => [definition.key, modules[definition.key]]) } : {}),
		customSchemas: [...customSchemas]
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((schema) => [
				schema.id,
				schema.scope,
				schema.enabled,
				schema.valid,
				schema.updatedAt,
				[...schema.types].sort(),
			]),
	});
	let hash = 0x811c9dc5;
	for (let index = 0; index < payload.length; index += 1) {
		hash ^= payload.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `seo-config-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function readAnalysisRuntimeConfig(
	ctx: PluginContext,
	schemaScopes?: string[],
	moduleState?: { values: SeoAdminModuleValues },
): Promise<SeoAnalysisRuntimeConfig> {
	const [settings, schemaPresets, customSchemas, contentTypeRoles, businessIdentity, ownershipState, modules] = await Promise.all([
		readReadableSiteSettings(ctx),
		readAdminSchemaPresets(ctx),
		schemaScopes ? readScopedAdminCustomSchemas(ctx, schemaScopes) : readAllAdminCustomSchemas(ctx),
		readSchemaContentTypeRoles(ctx),
		readBusinessIdentityRenderState(businessIdentityStoreFor(ctx as unknown as { settings?: unknown; kv?: unknown })),
		readPublisherOwnership(ctx.kv),
		moduleState ? Promise.resolve(moduleState) : readAdminModules(ctx),
	]);
	const publisherOwnership = publisherOwnershipEffective(ownershipState);
	return {
		global: {
			siteName: settings.values.siteName || ctx.site?.name || "Website",
			siteUrl: settings.values.siteUrl,
			publisherType: settings.values.publisherType,
			orgName: settings.values.organizationName || settings.values.siteName,
			orgLogo: settings.values.organizationLogo,
			personName: settings.values.personName,
			sameAs: settings.values.publisherType === "person"
				? settings.values.personProfiles
				: settings.values.socialProfiles,
			defaultOgImage: settings.values.defaultSocialImage,
			twitterHandle: settings.values.twitterHandle,
		},
		presets: schemaPresets.values,
		customSchemas,
		contentTypeRoles: contentTypeRoles.values,
		contentTypeRolesInvalid: contentTypeRoles.invalid,
		businessIdentity,
		publisherOwnership,
		settings: settings.values,
		fingerprint: analysisConfigurationFingerprint(
			settings.values,
			schemaPresets.values,
			customSchemas,
			contentTypeRoles.values,
			contentTypeRoles.invalid,
			businessIdentity,
			publisherOwnership,
			modules.values,
		),
	};
}

export function entryAnalysisConfigurationFingerprint(
	runtimeConfig: SeoAnalysisRuntimeConfig,
	modules: SeoAdminModuleValues,
	collection: string,
	item: any,
	assessmentProfile: CollectionAnalysisProfileSelection,
): string {
	const scopes = contentSchemaScopes(collection, item);
	const fingerprint = analysisConfigurationFingerprint(
		runtimeConfig.settings,
		runtimeConfig.presets,
		runtimeConfig.customSchemas.filter((schema) => scopes.includes(schema.scope)),
		runtimeConfig.contentTypeRoles,
		runtimeConfig.contentTypeRolesInvalid,
		runtimeConfig.businessIdentity,
		runtimeConfig.publisherOwnership,
		modules,
	);
	// Only a rule that covers this collection is an input, so other types keep their fingerprints.
	const typeRule = contentTypeNoindexApplies(runtimeConfig.settings.contentTypeNoindex, collection) ? ":content-type-noindex" : "";
	return `${fingerprint}:assessment-v${assessmentProfile.version}:${assessmentProfile.profile}${typeRule}`;
}

export function isTemplateCollection(value: string): value is SeoTemplateCollection {
	return isSeoContentCollectionKey(value);
}

export interface TemplateRevisionState {
	updatedAt: string | null;
	revisions: Record<string, string | null>;
}

export function templateRevisionFor(state: TemplateRevisionState, collection: string): string | null {
	return Object.prototype.hasOwnProperty.call(state.revisions, collection)
		? state.revisions[collection]
		: state.updatedAt;
}

/** Score token stored and compared while the template record cannot be read. */
export const UNREADABLE_TEMPLATES_TOKEN = "unreadable-templates";

export interface AdminTemplatesState {
	values: SeoAdminTemplateSet;
	/** Fallback score token for collections without their own entry. */
	updatedAt: string | null;
	sources: Record<SeoTemplateCollection, "snapshot" | "legacy" | "default">;
	revisions: Record<string, string | null>;
	state: "absent" | "saved" | "corrupt" | "unavailable";
	/** KV revision of the record; null when absent or unreadable. */
	revision: string | null;
	/** Inherited values of discovered collections without an override. */
	inherited: Record<string, InheritedMetadataTemplate>;
}

/**
 * Effective templates and score tokens for every discovered collection and
 * every stored override. Legacy keys are read only for collections without
 * an override. An unreadable record yields no templates and one token that no
 * readable state produces, and is never replaced here.
 */
export async function readAdminTemplates(ctx: PluginContext): Promise<AdminTemplatesState> {
	const definitions = await resolveContentCollections(ctx);
	const snapshot = await readMetadataTemplates(ctx.kv as any);
	if (snapshot.state === "corrupt" || snapshot.state === "unavailable") {
		return {
			values: {},
			updatedAt: UNREADABLE_TEMPLATES_TOKEN,
			sources: {},
			revisions: {},
			state: snapshot.state,
			revision: snapshot.revision,
			inherited: {},
		};
	}
	const record = snapshot.state === "saved" ? snapshot.record : null;
	// A legacy token map too large to carry exactly makes every token unreadable.
	const tokens = record
		? recordTokens(record)
		: absentTokens(await ctx.kv.get<unknown>(LEGACY_TEMPLATE_REVISIONS_KEY)) ?? { revisions: {}, fallback: UNREADABLE_TEMPLATES_TOKEN };
	const values: SeoAdminTemplateSet = {};
	const sources = {} as Record<SeoTemplateCollection, "snapshot" | "legacy" | "default">;
	const inherited: Record<string, InheritedMetadataTemplate> = {};
	for (const [collection, override] of Object.entries(record?.values ?? {})) {
		values[collection] = { ...override };
		sources[collection] = "snapshot";
	}
	for (const definition of definitions) {
		const collection = definition.collection;
		if (values[collection]) continue;
		const inheritedTemplate = inheritedMetadataTemplate(collection, await readLegacyTemplateFields(ctx.kv as any, collection));
		values[collection] = { ...inheritedTemplate.values };
		sources[collection] = inheritedTemplate.source;
		inherited[collection] = inheritedTemplate;
	}
	const revisions = Object.fromEntries(Object.keys(values).map((collection) => [collection, scoreTokenFor(tokens, collection)]));
	return {
		values,
		updatedAt: tokens.fallback,
		sources,
		revisions,
		state: snapshot.state,
		revision: snapshot.revision,
		inherited,
	};
}

export function publicCustomSchema(id: string, value: unknown): SeoAdminCustomSchema | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredCustomSchema>;
	const name =
		typeof candidate.name === "string" && candidate.name.trim()
			? candidate.name.trim()
			: "Untitled schema";
	const scope =
		typeof candidate.scope === "string" && candidate.scope.trim()
			? candidate.scope.trim()
			: "global";
	const json = typeof candidate.json === "string" ? candidate.json : "";
	const enabled = candidate.enabled === true;
	const createdAt =
		typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString();
	const updatedAt = typeof candidate.updatedAt === "string" ? candidate.updatedAt : createdAt;

	let parsed: Record<string, unknown> | unknown[] | null = null;
	let validationError: string | null = null;
	const shape = validateSeoAdminCustomSchemaInput({
		name,
		scope,
		json,
		enabled,
	});
	if (!shape.success)
		validationError = Object.values(shape.errors)[0] ?? "Invalid custom schema record.";
	try {
		parsed = validateCustomJsonLd(json);
	} catch (error: unknown) {
		validationError ??= error instanceof JsonLdValidationError ? error.message : String(error);
	}
	const target = parseStoredEntrySchemaTarget(candidate.target, scope);
	if (!target.ok) validationError ??= target.message;

	return {
		id,
		storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		name,
		scope,
		json,
		enabled,
		types: parsed ? extractSeoSchemaTypes(parsed) : [],
		valid: validationError === null,
		validationError,
		createdAt,
		updatedAt,
		...(target.ok && target.target ? { target: target.target } : {}),
	};
}

export async function readAllRawCustomSchemas(
	ctx: PluginContext,
	options: { overflow?: "error" | "truncate" } = {},
): Promise<Map<string, StoredCustomSchema>> {
	const schemas = new Map<string, StoredCustomSchema>();
	let cursor: string | undefined;
	const seenCursors = new Set<string>();
	let recordCount = 0;
	do {
		const result = await ctx.storage.schemas.query({
			limit: Math.min(100, 501 - recordCount),
			...(cursor ? { cursor } : {}),
		});
		for (const item of result.items ?? []) {
			recordCount += 1;
			if (recordCount > 500) {
				if (options.overflow === "truncate") {
					ctx.log.warn("seo: custom schema storage exceeds the 500-record runtime cap");
					return new Map(
						[...schemas.entries()].sort(([left], [right]) => left.localeCompare(right)),
					);
				}
				throw new Error(
					"Repair or reduce custom schemas to 500 records before using portability tools.",
				);
			}
			const id = String((item as any).id ?? "").trim();
			const data = ((item as any).data ?? item) as StoredCustomSchema;
			if (!id || !data || typeof data !== "object" || schemas.has(id)) {
				throw new Error(
					"A malformed custom schema record must be repaired before export or import.",
				);
			}
			schemas.set(id, structuredClone(data));
		}
		if (!result.hasMore) break;
		const nextCursor = typeof result.cursor === "string" ? result.cursor : "";
		if (!nextCursor || seenCursors.has(nextCursor)) {
			throw new Error(
				"Custom schema pagination did not advance; retry portability from a stable host.",
			);
		}
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	} while (recordCount <= 500);
	return new Map([...schemas.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export async function readAllAdminCustomSchemas(ctx: PluginContext): Promise<SeoAdminCustomSchema[]> {
	const rawSchemas = await readAllRawCustomSchemas(ctx, {
		overflow: "truncate",
	});
	const items: SeoAdminCustomSchema[] = [];
	for (const [id, value] of rawSchemas) {
		const normalized = publicCustomSchema(id, value);
		if (normalized) items.push(normalized);
		else ctx.log.warn("seo: skipping malformed custom schema record", { id });
	}
	return items.sort(
		(left, right) =>
			right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
	);
}

export function contentSchemaScopes(collection: string, item: any): string[] {
	return uniqueStrings(["global", collection, ...legacyOverrideAliasRefs(collection, item)]);
}

/**
 * The custom schema rows that can apply to one entry, read as the public
 * reader reads them: the named scopes plus legacy rows with an empty or
 * missing scope, which apply site-wide. One cap of 100 rows covers both
 * queries; more is an error rather than a partial list.
 */
export async function readScopedAdminCustomSchemas(ctx: PluginContext, scopes: string[]): Promise<SeoAdminCustomSchema[]> {
	const tooMany = "Too many schema rules match this entry. Narrow their scope before analyzing.";
	const rows = new Map<string, unknown>();
	for (const where of [{ scope: { in: [...scopes, ""] } }, { scope: null }]) {
		const result = await ctx.storage.schemas.query({ where: where as any, limit: 101 - rows.size });
		for (const item of result.items ?? []) rows.set(String((item as any).id ?? ""), (item as any).data ?? item);
		if (result.hasMore || rows.size > 100) throw new Error(tooMany);
	}
	return [...rows].flatMap(([id, value]) => {
		const normalized = publicCustomSchema(id, value);
		return normalized && scopes.includes(normalized.scope) ? [normalized] : [];
	}).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

const EMPTY_TEMPLATE: ContentTypeTemplate = Object.freeze({ title: "", description: "", socialTitle: "", socialDescription: "" });

/**
 * One collection's template for output and analysis: its override, else its
 * readable legacy keys over the default. An unreadable record or legacy read
 * gives an empty template, so the resolver uses the entry's own values.
 */
export async function getTemplate(ctx: PluginContext, collection: string): Promise<ContentTypeTemplate> {
	if (!isTemplateCollection(collection)) return defaultMetadataTemplate(collection);
	const snapshot = await readMetadataTemplates(ctx.kv as any);
	if (snapshot.state === "corrupt" || snapshot.state === "unavailable") {
		ctx.log?.warn?.("seo: metadata templates are unreadable; entry values are used", { state: snapshot.state, collection });
		return { ...EMPTY_TEMPLATE };
	}
	const override = snapshot.state === "saved" ? snapshot.record.values[collection] : undefined;
	if (override) return { ...override };
	try {
		return inheritedMetadataTemplate(collection, await readLegacyTemplateFields(ctx.kv as any, collection)).values;
	} catch {
		ctx.log?.warn?.("seo: metadata templates are unreadable; entry values are used", { state: "unavailable", collection });
		return { ...EMPTY_TEMPLATE };
	}
}

interface EffectiveMetadataField {
	value: string;
	source: SeoAdminMetadataSource;
}

export interface EffectiveSeoMetadata {
	title: EffectiveMetadataField;
	description: EffectiveMetadataField;
	searchTitleFallback: EffectiveMetadataField;
	searchDescriptionFallback: EffectiveMetadataField;
	socialTitle: EffectiveMetadataField;
	socialDescription: EffectiveMetadataField;
	socialTitleFallback: EffectiveMetadataField;
	socialDescriptionFallback: EffectiveMetadataField;
	canonical: EffectiveMetadataField;
	image: EffectiveMetadataField;
	/** Content entries only: the image that shows once the entry's own SEO image is cleared. */
	imageFallback?: EffectiveMetadataField;
	socialOverride: SeoAdminSocialOverride | null;
	indexable: boolean;
	/** Content entries only: every input that sets noindex, empty while indexable. */
	noindexSources?: SeoNoindexSource[];
	robots: string;
	vars: Record<string, string>;
}

export function effectiveField(
	value: string | undefined,
	source: SeoAdminMetadataSource,
): EffectiveMetadataField {
	return { value: value?.trim() ?? "", source };
}


function contentDescription(
	data: Record<string, any>,
	definition: SeoContentCollectionDefinition | null,
): string {
	return (
		clean(data.excerpt) ??
		clean(data.summary) ??
		clean(data.description) ??
		generatedContentDescription(data, definition)
	);
}

function contentAuthor(data: Record<string, any>): string {
	const author = data.author;
	if (typeof author === "string") return author.trim();
	if (author && typeof author === "object") return clean(author.name) ?? clean(author.title) ?? "";
	const byline = Array.isArray(data.bylines) ? data.bylines[0] : undefined;
	if (typeof byline === "string") return byline.trim();
	if (byline && typeof byline === "object") return clean(byline.name) ?? clean(byline.title) ?? "";
	return "";
}

export function absoluteMetadataUrl(value: string, siteUrl: string): string {
	if (!value) return "";
	if (isHttpUrl(value)) return value;
	if (!isHttpUrl(siteUrl)) return value;
	try {
		return new URL(value, `${new URL(siteUrl).origin}/`).href;
	} catch {
		return value;
	}
}

export function socialOverrideRefsForContentItem(collection: string, item: any): string[] {
	const refs = [`${collection}:${String(item.id)}`];
	const slug = clean(item?.slug ?? item?.data?.slug);
	if (slug && slug !== String(item.id)) refs.push(`${collection}:${slug}`);
	return refs;
}

/**
 * Limits a preview applies inside the shared resolver. The public hook passes
 * none, so its reads and expansion are unchanged.
 */
export interface MetadataResolutionBounds {
	/** Each stored override exactly as read, before validation or trimming; throws to refuse. */
	inspectStored(value: unknown): void;
	/** Expands one template string, refusing before an oversized result is built. */
	substitute(template: string, vars: Record<string, string>): string;
	/** The entry's public URL the caller already read and checked, so it is observed once. */
	publicUrl?: string;
}

/**
 * The stored override rows one resolution read, exactly as read, so facts
 * about them describe the same snapshot the resolved metadata used.
 */
export interface MetadataReadObservation {
	legacy: Array<{ key: string; keyKind: "id" | "slug-alias"; value: unknown }>;
	/** The refs the social reader was asked for, in order. */
	socialRefs: string[];
	/** What its inspection callback saw, in ref order; a failed or missing store read leaves a gap. */
	social: unknown[];
	socialResult: SeoAdminSocialOverride | null;
}

export function createMetadataReadObservation(): MetadataReadObservation {
	return { legacy: [], socialRefs: [], social: [], socialResult: null };
}

export async function resolveEffectiveContentMetadata(
	ctx: PluginContext,
	collection: SeoTemplateCollection,
	item: any,
	templateOverride?: SeoAdminTemplateValues,
	readableSettings?: SeoAdminSettingsValues,
	bounds?: MetadataResolutionBounds,
	observation?: MetadataReadObservation,
): Promise<EffectiveSeoMetadata> {
	// One strict read serves the identity fields and the site-wide noindex.
	const settings = readableSettings ?? (await readReadableSiteSettings(ctx)).values;
	const data = (item?.data ?? {}) as Record<string, any>;
	const seo = (item?.seo ?? data.seo ?? {}) as Record<string, any>;
	const override = await resolveOverrideForContentItem(
		ctx, collection, item, bounds?.inspectStored,
		observation ? (key, keyKind, value) => void observation.legacy.push({ key, keyKind, value }) : undefined,
	);
	const socialRefs = socialOverrideRefsForContentItem(collection, item);
	const socialOverride = await readSocialOverride(
		ctx,
		socialRefs,
		bounds || observation
			? (value) => {
				bounds?.inspectStored(value);
				observation?.social.push(value);
			}
			: undefined,
	);
	if (observation) {
		observation.socialRefs = socialRefs;
		observation.socialResult = socialOverride;
	}
	const global = await getGlobalSettings(ctx, undefined, settings);
	const template = templateOverride ?? (await getTemplate(ctx, collection));
	const definition = await resolveContentCollection(ctx, collection);
	const rawTitle = contentItemTitle(item, definition?.titleField);
	const rawDescription = contentDescription(data, definition);
	const generatedUrl = absoluteMetadataUrl(
		bounds?.publicUrl ?? (await publicUrlForContent(ctx, collection, item)),
		global.siteUrl,
	);
	const coreCanonical = clean(seo.canonical);
	const contentImage = featuredImageFromContentData(data);
	const coreImage = clean(seo.image);
	const slug = String(item?.slug ?? data.slug ?? item?.id ?? "");
	const vars: Record<string, string> = {
		siteName: global.siteName,
		siteUrl: global.siteUrl,
		title: rawTitle,
		description: rawDescription,
		canonical: absoluteMetadataUrl(coreCanonical ?? generatedUrl, global.siteUrl),
		image: absoluteMetadataUrl(coreImage ?? (contentImage || global.defaultOgImage), global.siteUrl),
		author: contentAuthor(data),
		publishedAt:
			clean(item?.publishedAt) ?? clean(data.publishedAt) ?? clean(data.published_at) ?? "",
		updatedAt: clean(item?.updatedAt) ?? clean(data.updatedAt) ?? clean(data.updated_at) ?? "",
		collection,
		slug,
	};
	const resolvedTemplate = resolveContentTypeTemplate(template, vars, bounds?.substitute);

	const legacyTitle = clean(override?.title);
	const coreTitle = clean(seo.title);
	const searchTitleFallback = legacyTitle
		? effectiveField(legacyTitle, "legacy-override")
		: resolvedTemplate.title
			? effectiveField(resolvedTemplate.title, "template")
			: effectiveField(rawTitle, "content");
	const title = legacyTitle
		? effectiveField(legacyTitle, "legacy-override")
		: coreTitle
			? effectiveField(coreTitle, "core-seo")
			: searchTitleFallback;

	const legacyDescription = clean(override?.description);
	const coreDescription = clean(seo.description);
	const searchDescriptionFallback = legacyDescription
		? effectiveField(legacyDescription, "legacy-override")
		: resolvedTemplate.description
			? effectiveField(resolvedTemplate.description, "template")
			: effectiveField(rawDescription, "content");
	const description = legacyDescription
		? effectiveField(legacyDescription, "legacy-override")
		: coreDescription
			? effectiveField(coreDescription, "core-seo")
			: searchDescriptionFallback;

	const explicitSocialTitle = clean(seo.ogTitle);
	const storedSocialTitle = clean(socialOverride?.title);
	const socialTitleFallback = explicitSocialTitle
		? effectiveField(explicitSocialTitle, "core-seo")
		: legacyTitle
			? effectiveField(legacyTitle, "legacy-override")
			: coreTitle
				? effectiveField(coreTitle, "core-seo")
				: resolvedTemplate.socialTitle
					? effectiveField(resolvedTemplate.socialTitle, "template")
					: { ...title };
	const socialTitle = storedSocialTitle
		? effectiveField(storedSocialTitle, "plugin-social-override")
		: socialTitleFallback;

	const explicitSocialDescription = clean(seo.ogDescription);
	const storedSocialDescription = clean(socialOverride?.description);
	const socialDescriptionFallback = explicitSocialDescription
		? effectiveField(explicitSocialDescription, "core-seo")
		: legacyDescription
			? effectiveField(legacyDescription, "legacy-override")
			: coreDescription
				? effectiveField(coreDescription, "core-seo")
				: resolvedTemplate.socialDescription
					? effectiveField(resolvedTemplate.socialDescription, "template")
					: { ...description };
	const socialDescription = storedSocialDescription
		? effectiveField(storedSocialDescription, "plugin-social-override")
		: socialDescriptionFallback;

	const legacyCanonical = clean(override?.canonical);
	const canonical = legacyCanonical
		? effectiveField(absoluteMetadataUrl(legacyCanonical, global.siteUrl), "legacy-override")
		: coreCanonical
			? effectiveField(absoluteMetadataUrl(coreCanonical, global.siteUrl), "core-seo")
			: effectiveField(generatedUrl, "generated");

	const legacyImage = clean(override?.ogImage);
	const imageFallback = legacyImage
		? effectiveField(absoluteMetadataUrl(legacyImage, global.siteUrl), "legacy-override")
		: contentImage
			? effectiveField(absoluteMetadataUrl(contentImage, global.siteUrl), "content")
			: effectiveField(
					absoluteMetadataUrl(global.defaultOgImage, global.siteUrl),
					"site-default",
				);
	const image = coreImage && !legacyImage
		? effectiveField(absoluteMetadataUrl(coreImage, global.siteUrl), "core-seo")
		: imageFallback;

	const overrideRobots = clean(override?.robots)?.toLowerCase() ?? "";
	const noindexSources: SeoNoindexSource[] = [
		...((await getNoindex(ctx, settings)) ? ["site-setting" as const] : []),
		...(contentTypeNoindexApplies(settings.contentTypeNoindex, collection) ? ["content-type-rule" as const] : []),
		...(seo.noIndex === true ? ["entry-seo" as const] : []),
		...(overrideRobots.includes("noindex") ? ["legacy-override" as const] : []),
	];
	const noindex = noindexSources.length > 0;
	vars.title = title.value;
	vars.description = description.value;
	vars.canonical = canonical.value;
	vars.image = image.value;
	return {
		title,
		description,
		searchTitleFallback,
		searchDescriptionFallback,
		socialTitle,
		socialDescription,
		socialTitleFallback,
		socialDescriptionFallback,
		canonical,
		image,
		imageFallback,
		socialOverride,
		indexable: !noindex,
		noindexSources,
		robots: noindex ? "noindex,nofollow" : overrideRobots,
		vars,
	};
}

export function clean(v: unknown): string | undefined {
	const s = typeof v === "string" ? v.trim() : "";
	return s === "" ? undefined : s;
}

export function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function cleanCollection(value: unknown): string | null {
	const collection = typeof value === "string" ? value.trim() : "";
	return isSeoContentCollectionKey(collection) ? collection : null;
}

export async function supportedContentCollection(
	ctx: PluginContext,
	value: unknown,
): Promise<string | null> {
	const collection = cleanCollection(value);
	if (!collection) return null;
	return (await resolveContentCollection(ctx, collection)) ? collection : null;
}

export function legacyOverrideAliasRefs(collection: string, item: any): string[] {
	const slug = clean(item?.slug ?? item?.data?.slug);
	return uniqueStrings([
		`${collection}:${String(item?.id ?? "")}`,
		slug ? `${collection}:${slug}` : "",
	]);
}

export function contentItemTitle(item: any, titleField?: string | null): string {
	return (
		(titleField ? clean(item?.data?.[titleField]) : null) ??
		clean(item?.data?.title) ??
		clean(item?.data?.name) ??
		String(item?.slug ?? item?.id ?? "Untitled")
	);
}

export function contentItemIsPublished(item: any): boolean {
	const status = clean(item?.status) ?? clean(item?.data?.status);
	if (status) return status === "published";
	return Boolean(
		item?.publishedAt ?? item?.published_at ?? item?.data?.publishedAt ?? item?.data?.published_at,
	);
}

export function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function scoreContentSourceVersion(item: any): string | null {
	if (!item || typeof item !== "object" || !item.data || typeof item.data !== "object" || Array.isArray(item.data))
		return null;
	return savedContentVersion(item);
}

export async function hydrateStoredScoreDraft(
	ctx: PluginContext,
	collection: string,
	item: any,
): Promise<any> {
	const draftRevisionId = clean(item?.draftRevisionId);
	if (!draftRevisionId) return item;
	if (typeof ctx.content?.getRevision !== "function")
		throw new Error("Draft scoring requires content revision read access.");
	const revision = await ctx.content.getRevision(collection, String(item.id), draftRevisionId);
	if (!revision || revision.id !== draftRevisionId || revision.collection !== collection ||
		revision.entryId !== String(item.id) || !revision.data || typeof revision.data !== "object" ||
		Array.isArray(revision.data))
		throw new Error("Saved draft revision is unavailable for scoring.");
	const draftData = Object.fromEntries(Object.entries(revision.data).filter(([key]) => !key.startsWith("_")));
	return {
		...item,
		data: { ...item.data, ...draftData },
		slug: typeof revision.data._slug === "string" ? revision.data._slug : item.slug,
	};
}

export interface ScoreFreshnessRevision {
	templates: TemplateRevisionState;
	modulesUpdatedAt: string | null;
	configurationFingerprint: string;
}

export async function readCurrentScoreRevision(ctx: PluginContext): Promise<ScoreFreshnessRevision> {
	const [templates, modules] = await Promise.all([readAdminTemplates(ctx), readAdminModules(ctx)]);
	const runtimeConfig = await readAnalysisRuntimeConfig(ctx, undefined, modules);
	return {
		templates,
		modulesUpdatedAt: modules.updatedAt,
		configurationFingerprint: runtimeConfig.fingerprint,
	};
}

/**
 * One collection's template score token, equal to
 * `templateRevisionFor(await readAdminTemplates(ctx), collection)` without
 * discovering collections or reading their legacy template rows.
 */
export async function readCollectionTemplateToken(ctx: PluginContext, collection: string): Promise<string | null> {
	const snapshot = await readMetadataTemplates(ctx.kv as any);
	if (snapshot.state === "corrupt" || snapshot.state === "unavailable") return UNREADABLE_TEMPLATES_TOKEN;
	const tokens = snapshot.state === "saved"
		? recordTokens(snapshot.record)
		: absentTokens(await ctx.kv.get<unknown>(LEGACY_TEMPLATE_REVISIONS_KEY)) ?? { revisions: {}, fallback: UNREADABLE_TEMPLATES_TOKEN };
	return scoreTokenFor(tokens, collection);
}

/** The inputs a session result for this entry records, read without analyzing. */
export interface EntryAnalysisIdentity {
	scoreVersion: typeof SEO_SCORE_VERSION;
	configurationFingerprint: string;
	templateUpdatedAt: string | null;
	modulesUpdatedAt: string | null;
	metaOverrideUpdatedAt: string | null;
	/** The saved version of the row read now, as the editor's saved snapshot computes it. */
	sourceVersion: string | null;
	locale: string | null;
	/** The entry's analysis profile, meta override and legacy overrides, as session analysis reads them. */
	entryInputFingerprint: string;
}

/**
 * The same scoped configuration `analyzeContentPreview` reads for this exact
 * entry, so equal fields mean an unchanged entry would analyze identically
 * apart from its content and profile, which the caller compares itself.
 */
export async function readEntryAnalysisIdentity(
	ctx: PluginContext,
	collection: string,
	item: any,
	purpose: EntryAnalysisPurpose = "automatic",
): Promise<EntryAnalysisIdentity> {
	const admission = await readContentScoringPolicy(ctx);
	if (!entryAnalysisPolicyAdmits(admission, purpose)) throw new Error("Content analysis policy does not admit this identity check.");
	const assessmentProfile = await requireCollectionAnalysisProfile(ctx, collection);
	// The editor analyzes its saved snapshot, so a saved draft's slug decides the alias scopes on both reads.
	const saved = await hydrateStoredScoreDraft(ctx, collection, item);
	const modules = await readAdminModules(ctx);
	const [templateUpdatedAt, runtimeConfig, metaOverride, entrySnapshot] = await Promise.all([
		readCollectionTemplateToken(ctx, collection),
		readAnalysisRuntimeConfig(ctx, contentSchemaScopes(collection, saved), modules),
		readMetaOverride(ctx, contentRef(collection, item)),
		contentPreviewEntrySnapshot(ctx, collection, saved),
	]);
	if (!(await verifyCollectionAnalysisProfileRevision(ctx, assessmentProfile)))
		throw new Error("The assessment profile changed during identity verification.");
	const currentPolicy = await readContentScoringPolicy(ctx);
	if (!entryAnalysisPolicyAdmits(currentPolicy, purpose) || currentPolicy.revision !== admission.revision)
		throw new Error("Content analysis settings changed during identity verification.");
	return {
		scoreVersion: SEO_SCORE_VERSION,
		configurationFingerprint: entryAnalysisConfigurationFingerprint(runtimeConfig, modules.values, collection, saved, assessmentProfile),
		templateUpdatedAt,
		modulesUpdatedAt: modules.updatedAt,
		metaOverrideUpdatedAt: metaOverride?.updatedAt ?? null,
		sourceVersion: scoreContentSourceVersion(item),
		locale: clean(item?.locale) ?? null,
		entryInputFingerprint: await scoreRefreshRevision(entrySnapshot),
	};
}

export function isStoredScoreCurrent(
	value: unknown,
	currentRevision?: ScoreFreshnessRevision | false,
): value is SeoScoreRecord {
	if (!value || typeof value !== "object") return false;
	const score = value as Partial<SeoScoreRecord>;
	return (
		score.scoreVersion === SEO_SCORE_VERSION &&
		typeof score.ref === "string" &&
		typeof score.collection === "string" &&
		typeof score.score === "number" &&
		Number.isFinite(score.score) &&
		Array.isArray(score.checks) &&
		currentSeoScoreAssessmentProblem(score) === null &&
		Number.isSafeInteger(score.analysisRevision) &&
		(score.analysisRevision ?? 0) > 0 &&
		typeof score.configurationFingerprint === "string" &&
		(currentRevision === undefined ||
			(currentRevision !== false &&
				score.templateUpdatedAt === templateRevisionFor(currentRevision.templates, score.collection) &&
				score.modulesUpdatedAt === currentRevision.modulesUpdatedAt &&
				score.configurationFingerprint === currentRevision.configurationFingerprint))
	);
}

export function isStoredScoreUsable(value: unknown): value is SeoScoreRecord {
	if (!value || typeof value !== "object") return false;
	const score = value as Partial<SeoScoreRecord>;
	return (
		score.persistence !== "session" &&
		typeof score.scoreVersion === "number" &&
		Number.isInteger(score.scoreVersion) &&
		score.scoreVersion > 0 &&
		typeof score.ref === "string" &&
		typeof score.collection === "string" &&
		typeof score.entryId === "string" &&
		typeof score.score === "number" &&
		Number.isFinite(score.score) &&
		score.score >= 0 &&
		score.score <= 100 &&
		Array.isArray(score.checks) &&
		// Earlier analyzer versions stay readable without an evaluation basis.
		(score.scoreVersion === SEO_SCORE_VERSION
			? currentSeoScoreAssessmentProblem(score) === null
			: score.checks.every((check) => seoContentCheckProblem(check, false) === null)) &&
		typeof score.configurationFingerprint === "string" &&
		typeof score.updatedAt === "string"
	);
}

export async function readStoredScoreSnapshot(
	ctx: PluginContext,
	ref: string,
): Promise<SeoScoreRecord | null> {
	try {
		const stored = await ctx.storage.scores.get(ref);
		return isStoredScoreUsable(stored) ? stored : null;
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: persisted score read failed", {
			ref,
			error: String(error),
		});
		throw error;
	}
}

export async function scoreRefreshRevision(payload: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(payload),
	);
	return `sha256-${Array.from(new Uint8Array(digest), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("")}`;
}

export async function readScoreRefreshInputSnapshot(
	ctx: PluginContext,
	keyword: string | undefined,
	schemaScopes?: string[],
	scope: { collection?: string; status?: string; locale?: string } = {},
): Promise<{
	templates: Awaited<ReturnType<typeof readAdminTemplates>>;
	modules: Awaited<ReturnType<typeof readAdminModules>>;
	runtimeConfig: SeoAnalysisRuntimeConfig;
	revision: string;
}> {
	const [templates, modules] = await Promise.all([readAdminTemplates(ctx), readAdminModules(ctx)]);
	const runtimeConfig = await readAnalysisRuntimeConfig(ctx, schemaScopes, modules);
	return {
		templates,
		modules,
		runtimeConfig,
		revision: await scoreRefreshRevision(
			JSON.stringify({
				scoreVersion: SEO_SCORE_VERSION,
				templates: { updatedAt: templates.updatedAt, values: templates.values, revisions: templates.revisions },
				modules: { updatedAt: modules.updatedAt, values: modules.values },
				analysisConfiguration: runtimeConfig.fingerprint,
				keyword: normaliseKeyword(keyword),
				collection: scope.collection ?? null,
				status: scope.status ?? null,
				locale: scope.locale ?? null,
			}),
		),
	};
}

export function normaliseKeyword(value: unknown): string {
	return seoKeywordIdentity(value);
}

export function contentSourceUpdatedAt(item: any): string | null {
	return (
		clean(item?.updatedAt) ?? clean(item?.data?.updatedAt) ?? clean(item?.data?.updated_at) ?? null
	);
}

async function contentPreviewEntrySnapshot(
	ctx: PluginContext,
	collection: string,
	item: any,
): Promise<string> {
	const ref = contentRef(collection, item);
	const records = await Promise.all([
		ctx.storage.analysisProfiles?.get(ref),
		ctx.storage.metaOverrides?.get(ref),
		...legacyOverrideAliasRefs(collection, item).map((alias) => ctx.storage.overrides?.get(alias)),
	]);
	return JSON.stringify(records);
}

export async function analyzeContentPreview(
	ctx: PluginContext,
	collection: string,
	item: any,
	keyword?: string,
	hostSnapshot: any = item,
): Promise<SeoScoreRecord> {
	const admission = await readContentScoringPolicy(ctx);
	if (admission.state !== "enabled") throw new Error("Enable content analysis before analyzing saved content.");
	const assessmentProfile = await requireCollectionAnalysisProfile(ctx, collection);
	const scopes = contentSchemaScopes(collection, item);
	const input = await readScoreRefreshInputSnapshot(ctx, keyword, scopes);
	const entrySnapshot = await contentPreviewEntrySnapshot(ctx, collection, item);
	const score = await analyzeContentItem(
		ctx, collection, item, keyword, templateRevisionFor(input.templates, collection), input.modules,
		undefined, input.runtimeConfig, undefined, undefined, "preview", assessmentProfile,
	);
	const latest = await ctx.content!.get(collection, String(item.id));
	if (!latest || JSON.stringify(latest) !== JSON.stringify(hostSnapshot))
		throw new Error("Content changed during analysis. Run analysis again.");
	const after = await readScoreRefreshInputSnapshot(ctx, keyword, scopes);
	if (after.revision !== input.revision || entrySnapshot !== await contentPreviewEntrySnapshot(ctx, collection, item))
		throw new Error("SEO configuration changed during analysis. Run analysis again.");
	if (!(await verifyCollectionAnalysisProfileRevision(ctx, assessmentProfile)))
		throw new Error("The assessment profile changed during analysis. Run analysis again.");
	const currentPolicy = await readContentScoringPolicy(ctx);
	if (currentPolicy.state !== "enabled" || currentPolicy.revision !== admission.revision)
		throw new Error("Content analysis settings changed during analysis. Run analysis again.");
	// The entry's own plugin records this result used, so a later change to them is detectable.
	return { ...score, entryInputFingerprint: await scoreRefreshRevision(entrySnapshot) };
}

export async function analyzeContentItem(
	ctx: PluginContext,
	collection: string,
	item: any,
	keyword?: string | readonly string[],
	templateUpdatedAt?: string | null,
	moduleState?: { values: SeoAdminModuleValues; updatedAt: string | null },
	pillarOverride?: boolean,
	runtimeConfig?: SeoAnalysisRuntimeConfig,
	metaOverrideInput?: SeoAdminMetaOverride | null,
	ownershipInput?: FocusKeywordOwnership,
	analysisRevisionInput?: number | "preview",
	assessmentProfileInput?: ConfiguredCollectionAnalysisProfile,
): Promise<SeoScoreRecord> {
	const assessmentProfile = assessmentProfileInput ?? await requireCollectionAnalysisProfile(ctx, collection);
	const preview = analysisRevisionInput === "preview";
	if (!preview) item = await hydrateStoredScoreDraft(ctx, collection, item);
	if (!preview && (!Number.isSafeInteger(analysisRevisionInput) || (analysisRevisionInput ?? 0) < 1))
		throw new Error("Score analysis revision was not reserved before input reads");
	const prepared = await prepareContentItemAnalysis(
		ctx, collection, item, keyword, templateUpdatedAt, moduleState, pillarOverride,
		runtimeConfig, metaOverrideInput, ownershipInput, preview, assessmentProfile,
	);
	return completeContentItemAnalysis(prepared, preview ? "preview" : analysisRevisionInput as number);
}

/** Analyzer input and record fields for one entry; producing it reads, completing it does not. */
export interface PreparedContentAnalysis {
	input: Parameters<typeof analyzeSeoContent>[0];
	sourceVersion: string | null;
	keywords: string[];
	profileKeywords: string[] | null;
	focusKeywordSource: FocusKeywordOwnership["source"];
	pillar: boolean;
	templateUpdatedAt: string | null;
	modulesUpdatedAt: string | null;
	configurationFingerprint: string;
	metaOverrideUpdatedAt: string | null;
	assessmentProfile: CollectionAnalysisProfileSelection;
	assessmentProfileRevision: string;
}

/** Every read of one analysis; `item` is already the hydrated saved draft unless `preview`. */
export async function prepareContentItemAnalysis(
	ctx: PluginContext,
	collection: string,
	item: any,
	keyword: string | readonly string[] | undefined,
	templateUpdatedAt: string | null | undefined,
	moduleState: { values: SeoAdminModuleValues; updatedAt: string | null } | undefined,
	pillarOverride: boolean | undefined,
	runtimeConfig: SeoAnalysisRuntimeConfig | undefined,
	metaOverrideInput: SeoAdminMetaOverride | null | undefined,
	ownershipInput: FocusKeywordOwnership | undefined,
	preview: boolean,
	assessmentProfileInput?: ConfiguredCollectionAnalysisProfile,
): Promise<PreparedContentAnalysis> {
	const assessmentProfile = assessmentProfileInput ?? await requireCollectionAnalysisProfile(ctx, collection);
	if (assessmentProfile.collection !== collection)
		throw new Error("The assessment profile does not belong to this content type.");
	const ref = contentRef(collection, item);
	const [effectiveTemplateUpdatedAt, effectiveModules, effectiveRuntimeConfig] = await Promise.all([
		templateUpdatedAt === undefined
			? readAdminTemplates(ctx).then((templates) => templateRevisionFor(templates, collection))
			: Promise.resolve(templateUpdatedAt),
		moduleState ? Promise.resolve(moduleState) : readAdminModules(ctx),
		runtimeConfig ? Promise.resolve(runtimeConfig) : readAnalysisRuntimeConfig(ctx),
	]);
	const global = effectiveRuntimeConfig.global;
	const data = (item?.data ?? {}) as Record<string, any>;
	const definition = await resolveContentCollection(ctx, collection);
	const effective = isTemplateCollection(collection)
		? await resolveEffectiveContentMetadata(ctx, collection, item, undefined, effectiveRuntimeConfig.settings)
		: null;
	const seo = item?.seo ?? data.seo ?? {};
	const title =
		effective?.title.value ?? clean(seo.title) ?? clean(data.title) ?? clean(data.name) ?? "";
	const description =
		effective?.description.value ?? clean(seo.description) ?? contentDescription(data, definition);
	const publicUrl = await publicUrlForContent(ctx, collection, item);
	const url = effective?.canonical.value ?? clean(seo.canonical) ?? publicUrl;
	const canonicalStatus = scoringCanonicalStatus(url, publicUrl, global.siteUrl || ctx.site?.url || "");
	const featuredImage = featuredImageFromContentData(data);
	const image = effective?.image.value ?? clean(seo.image) ?? featuredImage;
	const noindex = effective ? !effective.indexable : seo.noIndex === true;
	const document = contentBodyValue(data, definition);
	const body = extractSeoDocumentText(document);
	const bodySource = clean(data.body_source);
	const resolvedDescriptionSource = effective ? effective.description.source : clean(seo.description) ? "core-seo" : "content";
	const descriptionSource = isGeneratedDescription(description, resolvedDescriptionSource, generatedContentDescription(data, definition))
		? "generated" as const
		: effective?.description.source;
	const ownership =
		ownershipInput ??
		(await resolveFocusKeywordOwnership(
			ctx, ref, keyword ?? "", keywordFromContent(data, item),
			{ persistMigration: !preview },
		));
	// The stored keyword list must name the analyzed primary first, so keywords with nothing to match are left out of both.
	const focusKeywords = ownership.keywords.filter((item) => seoKeywordIdentity(item) !== "");
	const focusKeyword = focusKeywords[0];
	const pillar = pillarOverride ?? ownership.pillar;
	const metaOverride =
		metaOverrideInput === undefined ? await readMetaOverride(ctx, ref) : metaOverrideInput;
	const schema = await schemaAnalysisForEntry(
		ctx,
		collection,
		item,
		effectiveRuntimeConfig,
		metaOverride,
		effectiveModules.values.schema,
		effective,
	);
	const sourceVersion = preview ? null : scoreContentSourceVersion(item);
	if (!preview && !sourceVersion) throw new Error("Saved content version is unavailable for scoring.");
	return {
		input: {
			ref,
			collection,
			entryId: String(item.id),
			slug: item.slug ?? data.slug ?? null,
			title,
			titleSource: effective?.title.source,
			description,
			...(descriptionSource === undefined ? {} : { descriptionSource }),
			// The entry preview shows the same date before its description.
			descriptionPrefix: seoSnippetDatePrefix(effective?.vars.publishedAt, clean(item?.locale)),
			url,
			...(canonicalStatus === undefined ? {} : { canonicalStatus }),
			image,
			...(effective ? { imageSource: effective.image.source } : {}),
			featuredImage,
			noindex,
			noindexSources: effective?.noindexSources ?? (noindex ? ["entry-seo"] : []),
			nosnippet: metaOverride?.robots?.nosnippet === true,
			publicationStatus: clean(item?.status) ?? clean(data.status) ?? null,
			body,
			document,
			contentImages: contentImageInputs(data),
			bodySource,
			focusKeyword,
			focusKeywords,
			pillar,
			assessmentProfile: { profile: assessmentProfile.profile, version: assessmentProfile.version },
			schemaEnabled: schema.enabled,
			schemaPreset: schema.preset,
			imageSeoEnabled: effectiveModules.values.imageSeo,
			sourceUpdatedAt: contentSourceUpdatedAt(item),
		},
		sourceVersion,
		keywords: focusKeywords,
		profileKeywords: ownership.profileKeywords,
		focusKeywordSource: ownership.source,
		pillar,
		templateUpdatedAt: effectiveTemplateUpdatedAt,
		modulesUpdatedAt: effectiveModules.updatedAt,
		configurationFingerprint: entryAnalysisConfigurationFingerprint(effectiveRuntimeConfig, effectiveModules.values, collection, item, assessmentProfile),
		metaOverrideUpdatedAt: metaOverride?.updatedAt ?? null,
		assessmentProfile: { profile: assessmentProfile.profile, version: assessmentProfile.version },
		assessmentProfileRevision: assessmentProfile.revision,
	};
}

/** Runs the analyzer on prepared inputs only. */
export function completeContentItemAnalysis(
	prepared: PreparedContentAnalysis,
	analysisRevisionInput: number | "preview",
): SeoScoreRecord {
	const preview = analysisRevisionInput === "preview";
	const analysis = analyzeSeoContent(prepared.input);
	return {
		...analysis,
		analysisRevision: preview ? 0 : analysisRevisionInput,
		...(prepared.sourceVersion ? { sourceVersion: prepared.sourceVersion } : {}),
		...(preview ? { persistence: "session" as const, freshness: "current" as const } : {}),
		keywords: prepared.keywords,
		profileKeywords: prepared.profileKeywords,
		focusKeywordSource: prepared.focusKeywordSource,
		pillar: prepared.pillar,
		updatedAt: new Date().toISOString(),
		templateUpdatedAt: prepared.templateUpdatedAt,
		modulesUpdatedAt: prepared.modulesUpdatedAt,
		configurationFingerprint: prepared.configurationFingerprint,
		metaOverrideUpdatedAt: prepared.metaOverrideUpdatedAt,
		assessmentProfileRevision: prepared.assessmentProfileRevision,
	};
}

async function schemaAnalysisForEntry(
	ctx: PluginContext,
	collection: string,
	item: any,
	runtimeConfig: SeoAnalysisRuntimeConfig,
	metaOverride: SeoAdminMetaOverride | null,
	moduleEnabled: boolean,
	effective: EffectiveSeoMetadata | null,
): Promise<{
	enabled: boolean;
	preset: string;
}> {
	if (!effective || !isTemplateCollection(collection)) {
		return { enabled: false, preset: "None" };
	}
	const page = await buildEntryPublicPageContext(
		ctx,
		collection,
		item,
		effective,
		runtimeConfig.global,
		runtimeConfig.contentTypeRoles,
	);
	const graphs = resolveEntrySchemaGraphs({
		page,
		data: item?.data,
		vars: effective.vars,
		settings: runtimeConfig.global,
		moduleEnabled,
		presets: runtimeConfig.presets,
		customSchemas: runtimeConfig.customSchemas,
		contentTypeRoles: runtimeConfig.contentTypeRolesInvalid ? INVALID_SCHEMA_CONTENT_TYPE_ROLES : runtimeConfig.contentTypeRoles,
		metaOverride,
		entry: entrySchemaPageEntry(collection, item),
		businessIdentity: runtimeConfig.businessIdentity,
		publisherOwnership: runtimeConfig.publisherOwnership,
	});
	const uniqueTypes = resolvedEntrySchemaTypes(page, graphs);
	return {
		enabled: uniqueTypes.length > 0,
		preset: uniqueTypes.join(", ") || "None",
	};
}

export async function buildEntryPublicPageContext(
	ctx: PluginContext,
	collection: SeoTemplateCollection,
	item: any,
	effective: EffectiveSeoMetadata,
	global: GlobalSeoSettings,
	contentTypeRoles: SeoAdminSchemaContentTypeValues,
): Promise<PublicPageContext> {
	const article = schemaContentTypeRole(collection, contentTypeRoles) === "blogPosting";
	const slug = String(item?.slug ?? item?.data?.slug ?? item?.id ?? "");
	const generatedUrl = await publicUrlForContent(ctx, collection, item);
	const url = effective.canonical.value || generatedUrl;
	let path = generatedUrl.startsWith("/") ? generatedUrl : `/${slug}`;
	try {
		path = new URL(generatedUrl, global.siteUrl || "https://example.invalid").pathname;
	} catch {
		// Preserve the generated route when a site origin has not been configured yet.
	}
	return {
		url,
		path,
		locale: contentItemLocale(ctx, item),
		kind: "content",
		// EmDash's default for content pages; it decides the core fallback graph.
		pageType: "article",
		title: effective.title.value,
		pageTitle: contentItemTitle(item, (await resolveContentCollection(ctx, collection))?.titleField),
		description: effective.description.value,
		canonical: effective.canonical.value || null,
		image: effective.image.value || null,
		content: {
			collection,
			id: String(item.id),
			slug: slug || null,
		},
		articleMeta:
			article
				? {
						author: effective.vars.author || null,
						publishedTime: effective.vars.publishedAt || null,
						modifiedTime: effective.vars.updatedAt || null,
					}
				: undefined,
		siteName: global.siteName,
		siteUrl: global.siteUrl,
	};
}

export function entrySchemaPageEntry(collection: string | null | undefined, item: any): EntrySchemaPageEntry | null {
	const id = typeof item?.id === "string" ? item.id : "";
	return collection && id ? { collection, id, locale: typeof item.locale === "string" ? item.locale : null } : null;
}

export function resolveEntrySchemaGraphs(input: {
	page: PublicPageContext;
	data?: unknown;
	vars: Record<string, string>;
	settings: GlobalSeoSettings;
	moduleEnabled: boolean;
	presets: SeoAdminSchemaPresetValues;
	customSchemas: readonly SeoAdminCustomSchema[];
	contentTypeRoles: SeoAdminSchemaContentTypeValues | typeof INVALID_SCHEMA_CONTENT_TYPE_ROLES;
	metaOverride: SeoAdminMetaOverride | null;
	/** The loaded content row; entry-owned records apply only to that exact row. */
	entry: EntrySchemaPageEntry | null;
	/** The identity read for this request; omitted keeps the legacy publisher. */
	businessIdentity?: BusinessIdentityRenderState;
	/** The publisher ownership read for this request; omitted is automatic. */
	publisherOwnership?: PublisherOwnershipEffective;
	/**
	 * Replaces the public expansion for a preview. It must expand each record
	 * once; a `TemplateExpansionLimitError` it throws ends the resolution
	 * instead of marking that record invalid.
	 */
	expand?: (schema: SeoAdminCustomSchema, parsed: unknown, vars: Record<string, string>) => unknown;
}): SeoAdminEntrySchemaGraph[] {
	if (!input.moduleEnabled) return [];

	const disabledPresets = new Set(input.metaOverride?.disabledPresets ?? []);
	const schemaResolution = createSeoSchemaResolutionState();
	const graphs: SeoAdminEntrySchemaGraph[] = [];

	const collection = input.page.content?.collection ?? "";
	const id = input.page.content?.id ?? "";
	const slug = input.page.content?.slug ?? "";
	const scopes = new Set([
		"global",
		...(collection ? [collection] : []),
		...(collection && id ? [`${collection}:${id}`] : []),
		...(collection && slug ? [`${collection}:${slug}`] : []),
	]);
	// Same order as the public hook: custom graphs are expanded first because an
	// owned identity definition in one of them decides how the publisher is emitted.
	const applicable = input.customSchemas
		.filter((schema) => schema.enabled && schema.valid && scopes.has(schema.scope))
		// Same rule as the public reader: another entry's or locale's own record never applies here.
		.filter((schema) => entrySchemaTargetApplies(schema.target ?? null, input.entry))
		.map((schema) => {
			try {
				const parsed = validateCustomJsonLd(schema.json);
				return { schema, expanded: (input.expand ? input.expand(schema, parsed, input.vars) : applyVarsDeep(parsed, input.vars)) as unknown };
			} catch (error) {
				if (error instanceof TemplateExpansionLimitError) throw error;
				return { schema, expanded: undefined };
			}
		});
	const publisherSwitch = input.presets.organization && !disabledPresets.has("organization");
	const identity = resolvePublisherOutput({
		ownership: input.publisherOwnership ?? "automatic",
		identity: input.businessIdentity ?? { state: "absent" },
		settings: input.settings,
		page: input.page,
		customs: applicable.flatMap((item) => item.expanded === undefined ? [] : [{ id: item.schema.id, graph: item.expanded }]),
	});
	const publisher = identity.publisher;
	const publisherEmitted = publisherSwitch && (publisher?.kind !== "identity" || publisher.graph !== null);
	for (const preset of buildSchemaPresetGraphs({
		page: input.page,
		settings: input.settings,
		presets: input.presets,
		data: input.data,
		disabledPresets,
		contentTypeRoles: input.contentTypeRoles,
		publisher,
	})) {
		const disabled = disabledPresets.has(preset.key);
		const customOwned = disabled ? null : presetDefinesCustomPublisherId(preset.graph, identity.customIds);
		const decision = disabled
			? { emitted: false, reason: "disabled" as const, conflictId: null }
			: customOwned
				? { emitted: false, reason: "entity-conflict" as const, conflictId: customOwned }
				: resolveSeoSchemaCandidate(schemaResolution, preset.contributionId, preset.graph);
		graphs.push({
			id: `preset:${preset.key}`,
			source: "preset",
			presetKey: preset.key,
			name: preset.type,
			types: [preset.type],
			disabled,
			emitted: decision.emitted,
			suppressedReason: decision.reason,
			conflictId: decision.conflictId,
			replacesCore: preset.contributionId === "primary",
			graph: preset.graph,
		});
	}

	for (const { schema, expanded } of applicable) {
		let graph: unknown = null;
		let decision: Pick<SeoAdminEntrySchemaGraph, "emitted" | "suppressedReason" | "conflictId">;
		try {
			if (expanded === undefined) throw new Error("invalid custom schema");
			graph = resolveSchemaOrganizationReferences(
				expanded,
				input.settings,
				publisherEmitted,
				publisher,
			);
			const resolved = resolveSeoSchemaCandidate(schemaResolution, `custom:${schema.id}`, graph);
			decision = {
				emitted: resolved.emitted,
				suppressedReason: resolved.reason,
				conflictId: resolved.conflictId,
			};
		} catch {
			decision = {
				emitted: false,
				suppressedReason: "invalid",
				conflictId: null,
			};
		}
		graphs.push({
			id: `custom:${schema.id}`,
			source: "custom",
			presetKey: null,
			name: schema.name,
			types: schema.types,
			disabled: false,
			...decision,
			replacesCore: false,
			graph,
		});
	}
	return graphs;
}

function coreSchemaType(page: PublicPageContext): string | null {
	if (page.pageType === "article") {
		return page.canonical ? "BlogPosting" : null;
	}
	return page.siteName ? "WebSite" : null;
}

export function resolvedEntrySchemaTypes(
	page: PublicPageContext,
	graphs: readonly SeoAdminEntrySchemaGraph[],
): string[] {
	const emitted = graphs.filter((graph) => graph.emitted);
	const types = emitted.flatMap((graph) => graph.types);
	if (!emitted.some((graph) => graph.replacesCore)) {
		const coreType = coreSchemaType(page);
		if (coreType) types.push(coreType);
	}
	return uniqueStrings(types);
}

export async function resolveOverrideForContentItem(
	ctx: PluginContext,
	collection: string,
	item: any,
	inspect?: (value: unknown) => void,
	observe?: (key: string, keyKind: "id" | "slug-alias", value: unknown) => void,
): Promise<Override | null> {
	const byId = `${collection}:${item.id}`;
	let rec = (await ctx.storage.overrides.get(byId)) as Override | null;
	inspect?.(rec);
	observe?.(byId, "id", rec);
	const slug = item.slug ?? item.data?.slug;
	if (!rec && slug) {
		const alias = `${collection}:${slug}`;
		rec = (await ctx.storage.overrides.get(alias)) as Override | null;
		inspect?.(rec);
		observe?.(alias, "slug-alias", rec);
	}
	return rec;
}

const OWNERSHIP_LEGACY_KEYS: Record<SeoAdminOwnershipFieldName, keyof Override> = {
	title: "title",
	description: "description",
	canonical: "canonical",
	image: "ogImage",
	noIndex: "robots",
};

function storedCoreSeo(value: unknown): { title: string | null; description: string | null; canonical: string | null; image: string | null; noIndex: boolean } | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const seo = value as Record<string, unknown>;
	for (const key of ["title", "description", "canonical", "image"] as const) {
		if (seo[key] !== null && typeof seo[key] !== "string") return null;
	}
	if (typeof seo.noIndex !== "boolean") return null;
	return {
		title: clean(seo.title) ?? null,
		description: clean(seo.description) ?? null,
		canonical: clean(seo.canonical) ?? null,
		image: clean(seo.image) ?? null,
		noIndex: seo.noIndex,
	};
}

function unknownOwnershipField(field: SeoAdminOwnershipFieldName, reason: SeoAdminOwnershipFieldReason): SeoAdminOwnershipField {
	return { field, state: "unknown", core: null, legacy: null, effective: null, effectiveSource: null, social: null, reason };
}

function unknownOwnership(
	status: "stale" | "unknown",
	reason: SeoAdminOwnershipEntryReason,
	sourceVersion: string | null,
	locale: string | null,
): SeoAdminEntryOwnership {
	return {
		status,
		reason,
		sourceVersion,
		locale,
		record: null,
		fields: SEO_ADMIN_OWNERSHIP_FIELDS.map((field) => unknownOwnershipField(field, reason)),
		unsupportedDirectives: { state: "unknown", tokens: [] },
	};
}

/**
 * Saved ownership of the five stored core SEO fields. Core values come only
 * from the host row; the legacy record and social rows are the ones the
 * resolver observed while producing `effective`. A row that is not the
 * requested saved version, or a resolver input whose SEO differs from the
 * host row, yields no current facts.
 */
export function resolveEntryOwnership(input: {
	hostItem: any;
	/** The item the resolver read: the host row, or the saved snapshot applied to it. */
	resolvedItem: any;
	/** The saved version the request named, when it sent a saved snapshot. */
	requestedVersion?: string;
	effective: EffectiveSeoMetadata;
	observation: MetadataReadObservation;
}): SeoAdminEntryOwnership {
	const { hostItem, effective, observation } = input;
	const locale = typeof hostItem?.locale === "string" ? hostItem.locale : null;
	const sourceVersion = scoreContentSourceVersion(hostItem);
	if (!sourceVersion) return unknownOwnership("unknown", "saved-version-unavailable", null, locale);
	if (input.requestedVersion !== undefined && input.requestedVersion !== sourceVersion)
		return unknownOwnership("stale", "saved-version-mismatch", sourceVersion, locale);
	if (hostItem.seo === undefined) return unknownOwnership("unknown", "core-seo-unavailable", sourceVersion, locale);
	const core = storedCoreSeo(hostItem.seo);
	if (!core) return unknownOwnership("unknown", "core-seo-invalid", sourceVersion, locale);
	const resolvedSeo = input.resolvedItem?.seo;
	const consumed = resolvedSeo === hostItem.seo ? core : storedCoreSeo(resolvedSeo);
	if (!consumed || SEO_ADMIN_OWNERSHIP_FIELDS.some((field) => consumed[field] !== core[field]))
		return unknownOwnership("unknown", "snapshot-seo-mismatch", sourceVersion, locale);

	// The resolver reads the exact-ID key, then the slug alias only when that row is empty.
	const reads = observation.legacy;
	let recordFailure: SeoAdminOwnershipFieldReason | null =
		reads.length === 0 || reads.length > 2 || reads[0].keyKind !== "id" || (reads.length === 2 && reads[1].keyKind !== "slug-alias")
			? "legacy-read-incomplete"
			: null;
	const invalidRead = reads.find((read) => read.value !== null && read.value !== undefined &&
		(typeof read.value !== "object" || Array.isArray(read.value)));
	if (!recordFailure && invalidRead) recordFailure = "legacy-record-invalid";
	const selected = invalidRead ?? reads.find((read) => read.value !== null && read.value !== undefined);
	const record = selected ? { sourceOverrideId: selected.key, keyKind: selected.keyKind } : null;
	const stored = !recordFailure && selected ? selected.value as Record<string, unknown> : null;

	// The social reader stops at the first valid row; anything it skipped or failed to read is not a known absence.
	const socialSeen = observation.social;
	const socialFailure: SeoAdminOwnershipFieldReason | null = observation.socialResult
		? socialSeen.length === 0 || socialSeen.at(-1) !== observation.socialResult || socialSeen.slice(0, -1).some((value) => value !== null && value !== undefined)
			? "social-record-invalid"
			: null
		: socialSeen.length !== observation.socialRefs.length
			? "social-read-incomplete"
			: socialSeen.some((value) => value !== null && value !== undefined)
				? "social-record-invalid"
				: null;

	const siteUrl = effective.vars.siteUrl;
	const resolved = { title: effective.title, description: effective.description, canonical: effective.canonical, image: effective.image };
	const fields = SEO_ADMIN_OWNERSHIP_FIELDS.map((field): SeoAdminOwnershipField => {
		if (recordFailure) return unknownOwnershipField(field, recordFailure);
		const raw = stored?.[OWNERSHIP_LEGACY_KEYS[field]];
		if (raw !== undefined && raw !== null && typeof raw !== "string") return unknownOwnershipField(field, "legacy-field-invalid");
		if (field === "noIndex") {
			// The public contribution treats any robots value containing noindex as noindex.
			const legacy = clean(raw)?.toLowerCase().includes("noindex") ? true : null;
			const sources = effective.noindexSources ?? [];
			if ((legacy === true) !== sources.includes("legacy-override"))
				return unknownOwnershipField(field, "effective-source-mismatch");
			return {
				field,
				state: legacy === null ? "not-shadowed" : core.noIndex ? "equal" : "conflict",
				core: core.noIndex,
				legacy,
				effective: !effective.indexable,
				effectiveSource: sources.includes("legacy-override")
					? "legacy-override"
					: sources.includes("entry-seo")
						? "core-seo"
						: sources.includes("site-setting")
							? "site-setting"
							: sources.includes("content-type-rule")
								? "content-type-rule"
								: "core-seo",
				social: null,
			};
		}
		if ((field === "title" || field === "description") && socialFailure) return unknownOwnershipField(field, socialFailure);
		const legacy = clean(raw) ?? null;
		const current = resolved[field];
		if ((legacy !== null) !== (current.source === "legacy-override"))
			return unknownOwnershipField(field, "effective-source-mismatch");
		const coreValue = core[field];
		// Canonical and image are compared after the URL resolution output applies.
		const same = legacy !== null && coreValue !== null && (field === "canonical" || field === "image"
			? absoluteMetadataUrl(legacy, siteUrl) === absoluteMetadataUrl(coreValue, siteUrl)
			: legacy === coreValue);
		const social = field === "title" ? effective.socialTitle : field === "description" ? effective.socialDescription : null;
		return {
			field,
			state: legacy === null ? "not-shadowed" : same ? "equal" : "conflict",
			core: coreValue,
			legacy,
			effective: current.value || null,
			effectiveSource: current.source,
			social: social ? { value: social.value, source: social.source } : null,
		};
	});

	let unsupportedDirectives: SeoAdminEntryOwnership["unsupportedDirectives"] = { state: "none", tokens: [] };
	if (recordFailure || (stored && stored.robots !== undefined && stored.robots !== null && typeof stored.robots !== "string")) {
		unsupportedDirectives = { state: "unknown", tokens: [] };
	} else if (record && stored && clean(stored.robots)) {
		const tokens = planLegacyOverrideMigration({
			ref: record.sourceOverrideId,
			override: { ref: record.sourceOverrideId, robots: clean(stored.robots) },
			currentSeo: core,
			conflictPolicy: "skip",
		}).unmappedRobots ?? [];
		unsupportedDirectives = tokens.length ? { state: "present", tokens } : { state: "none", tokens: [] };
	}

	return { status: "current", reason: null, sourceVersion, locale, record, fields, unsupportedDirectives };
}

/** Scoring compares canonicals only against an observed public route and real origin. */
function scoringCanonicalStatus(canonical: string, publicUrl: string, siteUrl: string): SeoCanonicalStatus | undefined {
	const route = publicUrl.trim();
	if (!canonical.trim() || !route || !(isHttpUrl(route) || (route.startsWith("/") && !route.startsWith("//")))) return undefined;
	let origin: string;
	let expectedPath: string;
	try {
		origin = isHttpUrl(siteUrl) ? new URL(siteUrl).origin : isHttpUrl(route) ? new URL(route).origin : "";
		if (!origin) return undefined;
		expectedPath = new URL(route, origin).pathname;
	} catch {
		return undefined;
	}
	if (!normalizeSeoSitemapPath(expectedPath)) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(canonical, origin);
	} catch {
		return "invalid";
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "invalid";
	const queryOrFragment = Boolean(parsed.search || parsed.hash);
	parsed.search = "";
	parsed.hash = "";
	const compared = validateSeoCanonical(parsed.href, origin, expectedPath);
	// Query parameters do not hide an independently observed origin/path preference.
	return compared.status === "matches" && queryOrFragment ? "query-or-fragment" : compared.status;
}

export function entryCanonicalValidation(canonical: string, publicUrl: string, siteUrl: string) {
	let expectedPath = publicUrl.startsWith("/") ? publicUrl : "";
	try {
		expectedPath = new URL(publicUrl, siteUrl || "https://example.invalid").pathname;
	} catch {
		// validateSeoCanonical will report an invalid route below.
	}
	let canonicalSiteUrl = siteUrl;
	if (!isHttpUrl(canonicalSiteUrl)) {
		try {
			canonicalSiteUrl = new URL(publicUrl).origin;
		} catch {
			canonicalSiteUrl = "";
		}
	}
	return validateSeoCanonical(canonical, canonicalSiteUrl, expectedPath);
}

export function contentRef(collection: string, item: any): string {
	return `${collection}:${String(item.id)}`;
}

export const unsavedContentSnapshots = new WeakSet<object>();

export async function publicUrlForContent(
	ctx: PluginContext,
	collection: string,
	item: any,
): Promise<string> {
	const content = ctx.content as
		| (PluginContentAccess & { getPublicUrl?: (collection: string, id: string) => Promise<string | null> })
		| undefined;
	if (contentItemIsPublished(item) && !unsavedContentSnapshots.has(item)) {
		if (typeof content?.getPublicUrl !== "function") return "";
		try {
			const url = await content.getPublicUrl(collection, String(item.id));
			return url && isHttpUrl(url) ? url : "";
		} catch (error: unknown) {
			ctx.log?.warn?.("seo: public content URL lookup failed", {
				collection,
				entryId: String(item.id),
				error: String(error),
			});
			return "";
		}
	}
	const discovered = await resolveContentCollectionSource(ctx);
	if (!discovered.available) return "";
	const definition = discovered.definitions.find((entry) => entry.collection === collection);
	const pattern = definition?.urlPattern;
	const slug = clean(item?.slug) ?? clean(item?.data?.slug);
	if (!pattern?.startsWith("/") || pattern.startsWith("//") || !pattern.includes("{slug}") || !slug)
		return "";
	const path = pattern.replaceAll("{slug}", encodeURIComponent(slug));
	if (/[?#]/.test(path) || /\{[^{}]*\}/.test(path)) return "";
	const normalized = path.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
	return ctx.url?.(normalized) ?? normalized;
}

export function contentItemLocale(ctx: PluginContext, item: any): string | null {
	return clean(item?.locale) ?? clean(item?.data?.locale) ?? clean(ctx.site?.locale) ?? "en";
}


/** Body text as the analyzer and the browser checks read it; block attributes are never text. */
export function plainText(value: unknown): string {
	return extractSeoDocumentText(value);
}
