import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY,
	SEO_ENGINE_VERSION,
	SEO_PORTABILITY_FORMAT,
	SEO_PORTABILITY_MAX_BYTES,
	SEO_PORTABILITY_VERSION,
	validateSeoAdminCustomSchemaInput,
	validateSeoAdminModuleValues,
	validateSeoAdminSchemaContentTypeValues,
	validateSeoAdminSchemaPresetValues,
	validateSeoAdminSettings,
	validateSeoAdminSitemapValues,
	validateSeoAdminTemplateSet,
	seoModuleCanRun,
	type SeoAdminModuleValues,
	type SeoAdminSchemaContentTypeValues,
	type SeoAdminSchemaPresetValues,
	type SeoAdminSettingsValues,
	type SeoAdminSitemapValues,
	type SeoAdminTemplateSet,
	type SeoPortabilityBundle,
	type SeoPortabilityCustomSchema,
	type SeoPortabilityImportPlan,
	type SeoPortabilityIndexNowPolicy,
	type SeoPortabilityMode,
	type SeoPortabilityPreviewResult,
	type SeoPortabilitySectionKey,
	type SeoPortabilitySectionPlan,
} from "./admin-contract.ts";
import {
	validateIndexNowSettings,
	type IndexNowSettingsValues,
} from "./indexnow.ts";
import { parseStoredEntrySchemaTarget } from "./entry-schemas.ts";
import { isCollectionAnalysisProfileSelection, type CollectionAnalysisProfileSelection } from "./collection-analysis-profile.ts";
import { defaultSchemaContentTypeRole, schemaDefinitionIdentities, validateCustomJsonLd } from "./lib.ts";

export const SEO_PORTABILITY_EXCLUSIONS = [
	"indexNow.apiKey",
	"indexNow.queue",
	"indexNow.deliveries",
	"derivedScores",
	"migrationJournals",
	"legacyOverrides",
	"emdashCoreSeo",
] as const;

export interface SeoPortabilityState {
	settings: SeoAdminSettingsValues;
	sitemap: SeoAdminSitemapValues;
	modules: SeoAdminModuleValues;
	schemaPresets: SeoAdminSchemaPresetValues;
	templates: SeoAdminTemplateSet;
	customSchemas: SeoPortabilityCustomSchema[];
	indexNow: IndexNowSettingsValues;
	schemaContentTypes: SeoAdminSchemaContentTypeValues;
	analysisProfiles?: Record<string, CollectionAnalysisProfileSelection>;
}

export type SeoPortabilityBundleValidation =
	| { success: true; bundle: SeoPortabilityBundle; notices: string[] }
	| { success: false; errors: string[] };

/** What the importing site can currently route; null when it cannot list its content types. */
export interface SeoPortabilityTargetContext {
	templateCollections: readonly string[] | null;
	indexNowContentTypes: readonly string[] | null;
	/** Collections whose saved template differs from the inherited one. Unknown when absent. */
	savedTemplateCollections?: readonly string[];
}

/** The server-owned settings marker an import keeps. A bundle never carries it. */
export interface SeoPortabilitySettingsMarkers {
	indexingPreferenceConfirmed?: true;
}

/** The importing site's stored records, as distinct from the values it inherits. */
export interface SeoPortabilityStoredRecords {
	/** Collections with a stored template; every other template in the state is inherited. */
	templateCollections: readonly string[];
	settingsMarkers: SeoPortabilitySettingsMarkers;
	/** Whether the stored settings hold a resource-use acknowledgement, in any form. */
	resourceNoticeAcknowledged: boolean;
}

/**
 * Exactly the writes an import performs. A section missing from `sections`
 * keeps its stored record, or its absence, untouched.
 */
export interface SeoPortabilityWritePlan {
	state: SeoPortabilityState;
	sections: SeoPortabilitySectionKey[];
	/** Stored with `state.settings` when settings are written. */
	settingsMarkers: SeoPortabilitySettingsMarkers;
	/**
	 * Every import withdraws a stored resource-use acknowledgement. True when
	 * settings are not written, so that withdrawal is the record's only change.
	 */
	withdrawAcknowledgement: boolean;
	/** The stored template overrides when templates are written. */
	templates: SeoAdminTemplateSet;
	customSchemas: { put: string[]; remove: string[] };
}

/** Reads the raw settings and template records captured by the import's own snapshot. */
export function seoPortabilityStoredRecords(settingsRecord: unknown, templatesRecord: unknown): SeoPortabilityStoredRecords {
	const settings = record(settingsRecord);
	const templates = record(record(templatesRecord)?.values);
	return {
		templateCollections: templates ? Object.keys(templates) : [],
		settingsMarkers: settings?.indexingPreferenceConfirmed === true ? { indexingPreferenceConfirmed: true } : {},
		resourceNoticeAcknowledged: settings !== null && settings.contentScoringResourceNoticeVersion !== undefined,
	};
}

function nameList(values: readonly string[]): string {
	const shown = values.slice(0, 10).join(", ");
	return values.length > 10 ? `${shown}, and ${values.length - 10} more` : shown;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function portableSettingsIntent(values: SeoAdminSettingsValues): SeoAdminSettingsValues {
	return {
		...Object.fromEntries([
			"siteName", "siteUrl", "publisherType", "organizationName", "organizationLogo", "personName",
			"socialProfiles", "personProfiles", "defaultSocialImage", "twitterHandle", "noindex", "contentScoringEnabled",
		].map((key) => [key, clone(values[key as keyof SeoAdminSettingsValues])])),
		...(values.customVerificationTags === undefined ? {} : { customVerificationTags: clone(values.customVerificationTags) }),
		...(values.taxonomyArchiveNoindex === undefined ? {} : { taxonomyArchiveNoindex: [...values.taxonomyArchiveNoindex] }),
		...(values.contentTypeNoindex === undefined ? {} : { contentTypeNoindex: [...values.contentTypeNoindex] }),
	} as unknown as SeoAdminSettingsValues;
}

function portableAnalysisProfiles(value: Record<string, CollectionAnalysisProfileSelection>): Record<string, CollectionAnalysisProfileSelection> {
	return Object.fromEntries(Object.entries(value).map(([collection, selection]) =>
		[collection, { profile: selection.profile, version: selection.version }]));
}

function validatePortableAnalysisProfiles(input: unknown): { values?: Record<string, CollectionAnalysisProfileSelection>; errors: string[] } {
	if (input === undefined) return { errors: [] };
	const source = record(input);
	if (!source || Object.keys(source).length > 100) return { errors: ["configuration.analysisProfiles must contain at most 100 content type selections."] };
	const values: Record<string, CollectionAnalysisProfileSelection> = {};
	const errors: string[] = [];
	for (const [collection, selection] of Object.entries(source)) {
		if (!/^[a-z][a-z0-9_-]{0,63}$/.test(collection) || !isCollectionAnalysisProfileSelection(selection)) {
			errors.push("configuration.analysisProfiles contains an invalid content type or assessment profile.");
			continue;
		}
		values[collection] = { profile: selection.profile, version: selection.version };
	}
	return { values, errors };
}

function indexNowPolicy(values: IndexNowSettingsValues): SeoPortabilityIndexNowPolicy {
	return {
		autoSubmit: values.autoSubmit,
		autoSubmitContentTypes: values.autoSubmitContentTypes?.slice() ?? null,
		keyLocation: values.keyLocation,
		batchSize: values.batchSize,
		minIntervalSeconds: values.minIntervalSeconds,
		maxAttempts: values.maxAttempts,
	};
}

export function createSeoPortabilityBundle(
	state: SeoPortabilityState,
	now = new Date(),
	engineVersion = SEO_ENGINE_VERSION,
): SeoPortabilityBundle {
	const bundle: SeoPortabilityBundle = {
		format: SEO_PORTABILITY_FORMAT,
		version: SEO_PORTABILITY_VERSION,
		exportedAt: now.toISOString(),
		engineVersion,
		source: {
			siteName: state.settings.siteName,
			siteUrl: state.settings.siteUrl,
		},
		safeguards: {
			secrets: "omitted",
			excluded: [...SEO_PORTABILITY_EXCLUSIONS],
		},
		configuration: {
			settings: portableSettingsIntent(state.settings),
			sitemap: clone(state.sitemap),
			modules: clone(state.modules),
			schemaPresets: clone(state.schemaPresets),
			templates: clone(state.templates),
			customSchemas: clone(state.customSchemas),
			indexNow: indexNowPolicy(state.indexNow),
			schemaContentTypes: clone(state.schemaContentTypes),
			analysisProfiles: portableAnalysisProfiles(state.analysisProfiles ?? {}),
		},
	};
	const byteLength = jsonByteLength(bundle);
	if (byteLength === null) throw new Error("SEO configuration could not be serialized for export.");
	if (byteLength > SEO_PORTABILITY_MAX_BYTES) {
		throw new Error(`SEO configuration exceeds the ${SEO_PORTABILITY_MAX_BYTES}-byte import limit. Reduce custom schemas before retrying.`);
	}
	return bundle;
}

function validatePortableIndexNow(value: unknown): { value: SeoPortabilityIndexNowPolicy | null; errors: string[] } {
	const source = record(value);
	if (!source) return { value: null, errors: ["configuration.indexNow must be an object."] };
	if ("apiKey" in source || "enabled" in source) {
		return { value: null, errors: ["configuration.indexNow must not contain enabled state or API keys."] };
	}
	const validation = validateIndexNowSettings({ ...source, enabled: false, apiKey: "" });
	if (!validation.success) {
		return {
			value: null,
			errors: Object.entries(validation.errors).map(([field, detail]) => `configuration.indexNow.${field}: ${detail}`),
		};
	}
	return { value: indexNowPolicy(validation.values), errors: [] };
}

function scopesOverlap(left: string, right: string): boolean {
	if (left === "global" || right === "global" || left === right) return true;
	const [leftCollection, leftEntry] = left.split(":", 2);
	const [rightCollection, rightEntry] = right.split(":", 2);
	return leftCollection === rightCollection && (!leftEntry || !rightEntry);
}

function customSchemaSetErrors(schemas: readonly SeoPortabilityCustomSchema[]): string[] {
	const errors: string[] = [];
	const parsed = schemas.map((schema) => {
		try {
			return validateCustomJsonLd(schema.json);
		} catch (cause) {
			errors.push(`configuration.customSchemas.${schema.id}.json: ${cause instanceof Error ? cause.message : "Invalid JSON-LD."}`);
			return null;
		}
	});
	for (let left = 0; left < schemas.length; left += 1) {
		if (!schemas[left].enabled || !parsed[left]) continue;
		const identities = new Set(schemaDefinitionIdentities(parsed[left]));
		if (!identities.size) continue;
		for (let right = left + 1; right < schemas.length; right += 1) {
			if (!schemas[right].enabled || !parsed[right] || !scopesOverlap(schemas[left].scope, schemas[right].scope)) continue;
			const duplicate = schemaDefinitionIdentities(parsed[right]).find((identity) => identities.has(identity));
			if (duplicate) {
				errors.push(
					`configuration.customSchemas: entity @id ${duplicate} is defined by both ${schemas[left].id} and ${schemas[right].id} in overlapping scopes.`,
				);
			}
		}
	}
	return errors;
}

function validatePortableSchemas(value: unknown): { value: SeoPortabilityCustomSchema[]; errors: string[] } {
	if (!Array.isArray(value)) return { value: [], errors: ["configuration.customSchemas must be an array."] };
	if (value.length > 500) return { value: [], errors: ["configuration.customSchemas supports at most 500 records."] };
	const schemas: SeoPortabilityCustomSchema[] = [];
	const errors: string[] = [];
	const ids = new Set<string>();
	for (const [index, item] of value.entries()) {
		const source = record(item);
		const validation = validateSeoAdminCustomSchemaInput(source);
		if (!validation.success) {
			for (const [field, detail] of Object.entries(validation.errors)) {
				errors.push(`configuration.customSchemas.${index}.${field}: ${detail}`);
			}
			continue;
		}
		const id = validation.values.id;
		if (!id) {
			errors.push(`configuration.customSchemas.${index}.id: A stable identifier is required.`);
			continue;
		}
		if (ids.has(id)) {
			errors.push(`configuration.customSchemas.${index}.id: Duplicate identifier ${id}.`);
			continue;
		}
		// Entry ownership travels with the record; dropping it would let the slug alias apply it elsewhere.
		const target = parseStoredEntrySchemaTarget(source?.target, validation.values.scope);
		if (!target.ok) {
			errors.push(`configuration.customSchemas.${index}.target: ${target.message}`);
			continue;
		}
		ids.add(id);
		schemas.push({ ...validation.values, id, ...(target.target ? { target: target.target } : {}) });
	}
	if (!errors.length) errors.push(...customSchemaSetErrors(schemas));
	return { value: schemas, errors };
}

function jsonByteLength(value: unknown): number | null {
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength;
	} catch {
		return null;
	}
}

export function validateSeoPortabilityBundle(input: unknown): SeoPortabilityBundleValidation {
	const byteLength = jsonByteLength(input);
	if (byteLength === null) return { success: false, errors: ["Bundle must be serializable JSON."] };
	if (byteLength > SEO_PORTABILITY_MAX_BYTES) {
		return { success: false, errors: [`Bundle exceeds the ${SEO_PORTABILITY_MAX_BYTES}-byte limit.`] };
	}
	const source = record(input);
	if (!source) return { success: false, errors: ["Bundle must be an object."] };
	const errors: string[] = [];
	if (source.format !== SEO_PORTABILITY_FORMAT) errors.push(`format must be ${SEO_PORTABILITY_FORMAT}.`);
	if (source.version !== SEO_PORTABILITY_VERSION) errors.push(`version must be ${SEO_PORTABILITY_VERSION}.`);
	if (typeof source.exportedAt !== "string" || Number.isNaN(Date.parse(source.exportedAt))) {
		errors.push("exportedAt must be an ISO date.");
	}
	if (typeof source.engineVersion !== "string" || !source.engineVersion.trim() || source.engineVersion.length > 80) {
		errors.push("engineVersion must be a non-empty string of 80 characters or fewer.");
	}
	const bundleSource = record(source.source);
	if (!bundleSource || typeof bundleSource.siteName !== "string" || typeof bundleSource.siteUrl !== "string") {
		errors.push("source must include siteName and siteUrl strings.");
	}
	const safeguards = record(source.safeguards);
	if (!safeguards || safeguards.secrets !== "omitted" || !Array.isArray(safeguards.excluded)) {
		errors.push("safeguards must declare omitted secrets and excluded data.");
	} else {
		for (const required of SEO_PORTABILITY_EXCLUSIONS) {
			if (!safeguards.excluded.includes(required)) errors.push(`safeguards.excluded must include ${required}.`);
		}
		if (safeguards.excluded.some((item) => typeof item !== "string")) {
			errors.push("safeguards.excluded must contain strings only.");
		}
	}
	const configuration = record(source.configuration);
	if (!configuration) return { success: false, errors: [...errors, "configuration must be an object."] };

	const settings = validateSeoAdminSettings(configuration.settings);
	if (!settings.success) {
		for (const [field, detail] of Object.entries(settings.errors)) errors.push(`configuration.settings.${field}: ${detail}`);
	}
	const sitemap = validateSeoAdminSitemapValues(configuration.sitemap);
	if (!sitemap.success) {
		for (const [field, detail] of Object.entries(sitemap.errors)) errors.push(`configuration.sitemap.${field}: ${detail}`);
	}
	// Earlier bundles stored defaults for switches that no longer exist; importing
	// them as off keeps those backups restorable.
	const rawModules = record(configuration.modules);
	const retiredModules = rawModules
		? SEO_ADMIN_MODULE_DEFINITIONS.filter((definition) =>
			rawModules[definition.key] === true && !seoModuleCanRun(definition.key))
		: [];
	const modules = validateSeoAdminModuleValues(rawModules
		? { ...rawModules, ...Object.fromEntries(retiredModules.map((definition) => [definition.key, false])) }
		: configuration.modules);
	if (!modules.success) {
		for (const [field, detail] of Object.entries(modules.errors)) errors.push(`configuration.modules.${field}: ${detail}`);
	}
	const schemaPresets = validateSeoAdminSchemaPresetValues(configuration.schemaPresets);
	if (!schemaPresets.success) {
		for (const [field, detail] of Object.entries(schemaPresets.errors)) errors.push(`configuration.schemaPresets.${field}: ${detail}`);
	}
	const templates = validateSeoAdminTemplateSet(configuration.templates);
	if (!templates.success) {
		for (const [field, detail] of Object.entries(templates.errors)) errors.push(`configuration.templates.${field}: ${detail}`);
	}
	const schemas = validatePortableSchemas(configuration.customSchemas);
	const analysisProfiles = validatePortableAnalysisProfiles(configuration.analysisProfiles);
	errors.push(...analysisProfiles.errors);
	errors.push(...schemas.errors);
	const portableIndexNow = validatePortableIndexNow(configuration.indexNow);
	errors.push(...portableIndexNow.errors);
	const contentTypes = configuration.schemaContentTypes === undefined
		? null
		: validateSeoAdminSchemaContentTypeValues(configuration.schemaContentTypes);
	if (contentTypes && !contentTypes.success) {
		for (const [field, detail] of Object.entries(contentTypes.errors)) errors.push(`configuration.schemaContentTypes.${field}: ${detail}`);
	}

	if (
		settings.success &&
		bundleSource &&
		(bundleSource.siteName !== settings.values.siteName || bundleSource.siteUrl !== settings.values.siteUrl)
	) {
		errors.push("source identity must match configuration.settings.");
	}
	if (
		errors.length ||
		!settings.success ||
		!sitemap.success ||
		!modules.success ||
		!schemaPresets.success ||
		!templates.success ||
		(contentTypes !== null && !contentTypes.success) ||
		!portableIndexNow.value ||
		!bundleSource ||
		!safeguards
	) {
		return { success: false, errors };
	}

	return {
		success: true,
		notices: retiredModules.length
			? [`${nameList(retiredModules.map((definition) => definition.label))} ${retiredModules.length === 1 ? "has" : "have"} no switch in this version and will import as off.`]
			: [],
		bundle: {
			format: SEO_PORTABILITY_FORMAT,
			version: SEO_PORTABILITY_VERSION,
			exportedAt: source.exportedAt as string,
			engineVersion: (source.engineVersion as string).trim(),
			source: {
				siteName: settings.values.siteName,
				siteUrl: settings.values.siteUrl,
			},
			safeguards: {
				secrets: "omitted",
				excluded: [...new Set((safeguards.excluded as string[]).map((item) => item.trim()).filter(Boolean))],
			},
			configuration: {
				settings: settings.values,
				sitemap: sitemap.values,
				modules: modules.values,
				schemaPresets: schemaPresets.values,
				templates: templates.values,
				customSchemas: schemas.value,
				indexNow: portableIndexNow.value,
				...(contentTypes?.success ? { schemaContentTypes: contentTypes.values } : {}),
				...(analysisProfiles.values ? { analysisProfiles: analysisProfiles.values } : {}),
			},
		},
	};
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	const source = record(value);
	if (source) {
		return Object.fromEntries(Object.keys(source).sort().map((key) => [key, stableValue(source[key])]));
	}
	return value;
}

function stableJson(value: unknown): string {
	return JSON.stringify(stableValue(value));
}

function equal(left: unknown, right: unknown): boolean {
	return stableJson(left) === stableJson(right);
}

function fingerprint(value: unknown): string {
	let hash = 2166136261;
	for (const character of stableJson(value)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function seoPortabilityFingerprint(bundle: SeoPortabilityBundle): string {
	return fingerprint(bundle);
}

export function seoPortabilityPlanFingerprint(
	bundle: SeoPortabilityBundle,
	current: SeoPortabilityState,
	mode: SeoPortabilityMode,
): string {
	return fingerprint({
		bundle,
		mode,
			target: {
			settings: current.settings,
			sitemap: current.sitemap,
			modules: current.modules,
			schemaPresets: current.schemaPresets,
			templates: current.templates,
			customSchemas: current.customSchemas,
			indexNow: {
				enabled: current.indexNow.enabled,
				...indexNowPolicy(current.indexNow),
			},
			schemaContentTypes: current.schemaContentTypes,
			analysisProfiles: current.analysisProfiles ?? {},
		},
	});
}

function mergeCustomSchemas(
	current: readonly SeoPortabilityCustomSchema[],
	incoming: readonly SeoPortabilityCustomSchema[],
	mode: SeoPortabilityMode,
): SeoPortabilityCustomSchema[] {
	if (mode === "replace") return clone([...incoming]);
	const importedIds = new Set(incoming.map((schema) => schema.id));
	return clone([...incoming, ...current.filter((schema) => !importedIds.has(schema.id))]);
}

function mergeTemplates(
	current: SeoAdminTemplateSet,
	incoming: SeoAdminTemplateSet,
	mode: SeoPortabilityMode,
): SeoAdminTemplateSet {
	return clone(mode === "merge" ? { ...current, ...incoming } : incoming);
}

// A bundle exported before content type mapping existed says nothing about it,
// so the target's mapping is kept in both modes.
function mergeSchemaContentTypes(
	current: SeoAdminSchemaContentTypeValues,
	incoming: SeoAdminSchemaContentTypeValues | undefined,
	mode: SeoPortabilityMode,
): SeoAdminSchemaContentTypeValues {
	if (incoming === undefined) return clone(current);
	return Object.fromEntries(
		Object.entries(mode === "merge" ? { ...current, ...incoming } : incoming).filter(
			([collection, role]) => role !== defaultSchemaContentTypeRole(collection),
		),
	);
}

function targetIndexNow(
	current: SeoPortabilityState,
	bundle: SeoPortabilityBundle,
): IndexNowSettingsValues {
	const siteUrlChanged = current.settings.siteUrl !== bundle.configuration.settings.siteUrl;
	return {
		...current.indexNow,
		...bundle.configuration.indexNow,
		enabled: siteUrlChanged ? false : current.indexNow.enabled,
		apiKey: current.indexNow.apiKey,
	};
}

export function applySeoPortabilityBundleToState(
	bundle: SeoPortabilityBundle,
	current: SeoPortabilityState,
	mode: SeoPortabilityMode,
): SeoPortabilityState {
	return {
		settings: portableSettingsIntent({
			...bundle.configuration.settings,
			...(bundle.configuration.settings.customVerificationTags === undefined && current.settings.customVerificationTags !== undefined
				? { customVerificationTags: current.settings.customVerificationTags } : {}),
			...(bundle.configuration.settings.taxonomyArchiveNoindex === undefined && current.settings.taxonomyArchiveNoindex !== undefined
				? { taxonomyArchiveNoindex: current.settings.taxonomyArchiveNoindex } : {}),
			...(bundle.configuration.settings.contentTypeNoindex === undefined && current.settings.contentTypeNoindex !== undefined
				? { contentTypeNoindex: current.settings.contentTypeNoindex } : {}),
		}),
		sitemap: clone(bundle.configuration.sitemap),
		modules: clone(bundle.configuration.modules),
		schemaPresets: clone(bundle.configuration.schemaPresets),
		templates: mergeTemplates(current.templates, bundle.configuration.templates, mode),
		customSchemas: mergeCustomSchemas(current.customSchemas, bundle.configuration.customSchemas, mode),
		indexNow: targetIndexNow(current, bundle),
		schemaContentTypes: mergeSchemaContentTypes(current.schemaContentTypes, bundle.configuration.schemaContentTypes, mode),
		analysisProfiles: bundle.configuration.analysisProfiles === undefined
			? portableAnalysisProfiles(current.analysisProfiles ?? {})
			: portableAnalysisProfiles(mode === "merge" ? { ...current.analysisProfiles, ...bundle.configuration.analysisProfiles } : bundle.configuration.analysisProfiles),
	};
}

const SECTION_LABELS: Record<SeoPortabilitySectionKey, string> = {
	settings: "Site settings",
	sitemap: "Sitemap policy",
	modules: "Modules",
	schemaPresets: "Schema presets",
	templates: "Templates",
	customSchemas: "Custom schemas",
	indexNow: "IndexNow policy",
	schemaContentTypes: "Content type schema",
	analysisProfiles: "Assessment profiles",
};

function scalarSection(key: Exclude<SeoPortabilitySectionKey, "customSchemas">, changed: boolean): SeoPortabilitySectionPlan {
	return {
		key,
		label: SECTION_LABELS[key],
		changed,
		added: 0,
		updated: changed ? 1 : 0,
		unchanged: changed ? 0 : 1,
		deleted: 0,
	};
}

function customSchemaWrites(
	current: readonly SeoPortabilityCustomSchema[],
	incoming: readonly SeoPortabilityCustomSchema[],
	mode: SeoPortabilityMode,
): SeoPortabilityWritePlan["customSchemas"] {
	const currentById = new Map(current.map((schema) => [schema.id, schema]));
	const incomingIds = new Set(incoming.map((schema) => schema.id));
	return {
		put: incoming.filter((schema) => {
			const existing = currentById.get(schema.id);
			return !existing || !equal(existing, schema);
		}).map((schema) => schema.id),
		remove: mode === "replace" ? current.filter((schema) => !incomingIds.has(schema.id)).map((schema) => schema.id) : [],
	};
}

function customSchemaSection(
	current: readonly SeoPortabilityCustomSchema[],
	incoming: readonly SeoPortabilityCustomSchema[],
	mode: SeoPortabilityMode,
): SeoPortabilitySectionPlan {
	const currentIds = new Set(current.map((schema) => schema.id));
	const writes = customSchemaWrites(current, incoming, mode);
	const added = writes.put.filter((id) => !currentIds.has(id)).length;
	const updated = writes.put.length - added;
	const unchanged = incoming.length - writes.put.length;
	const deleted = writes.remove.length;
	return {
		key: "customSchemas",
		label: SECTION_LABELS.customSchemas,
		changed: added + updated + deleted > 0,
		added,
		updated,
		unchanged,
		deleted,
	};
}

function templateSection(
	current: SeoAdminTemplateSet,
	incoming: SeoAdminTemplateSet,
	mode: SeoPortabilityMode,
	savedTemplateCollections?: readonly string[],
): SeoPortabilitySectionPlan {
	const incomingKeys = Object.keys(incoming);
	const targetOnly = Object.keys(current).filter((key) => !(key in incoming));
	const added = incomingKeys.filter((key) => !(key in current)).length;
	const updated = incomingKeys.filter((key) => key in current && !equal(current[key], incoming[key])).length;
	// Replace mode drops only saved templates; an inherited template stays as it is.
	const deleted = mode === "replace"
		? targetOnly.filter((key) => !savedTemplateCollections || savedTemplateCollections.includes(key)).length
		: 0;
	const unchanged = incomingKeys.length - added - updated + targetOnly.length - deleted;
	return {
		key: "templates",
		label: SECTION_LABELS.templates,
		changed: added + updated + deleted > 0,
		added,
		updated,
		unchanged,
		deleted,
	};
}

// Must stay equal to the stored overrides whenever templateSection reports no change.
function storedTemplateValues(
	current: SeoAdminTemplateSet,
	next: SeoAdminTemplateSet,
	mode: SeoPortabilityMode,
	storedCollections: readonly string[],
	savedTemplateCollections?: readonly string[],
): SeoAdminTemplateSet {
	const stored = new Set(storedCollections);
	const values: SeoAdminTemplateSet = {};
	for (const [collection, value] of Object.entries(next)) {
		// Storing an equal inherited template would stop it following later default or legacy changes.
		if (!stored.has(collection) && collection in current && equal(current[collection], value)) continue;
		values[collection] = clone(value);
	}
	if (mode === "replace" && savedTemplateCollections) {
		for (const collection of stored) {
			if (!(collection in next) && collection in current && !savedTemplateCollections.includes(collection)) {
				values[collection] = clone(current[collection]);
			}
		}
	}
	return values;
}

function importSections(
	bundle: SeoPortabilityBundle,
	current: SeoPortabilityState,
	next: SeoPortabilityState,
	mode: SeoPortabilityMode,
	savedTemplateCollections?: readonly string[],
): SeoPortabilitySectionPlan[] {
	return [
		scalarSection("settings", !equal(current.settings, next.settings)),
		scalarSection("sitemap", !equal(current.sitemap, next.sitemap)),
		scalarSection("modules", !equal(current.modules, next.modules)),
		scalarSection("schemaPresets", !equal(current.schemaPresets, next.schemaPresets)),
		templateSection(current.templates, bundle.configuration.templates, mode, savedTemplateCollections),
		customSchemaSection(current.customSchemas, bundle.configuration.customSchemas, mode),
		scalarSection("indexNow", !equal(current.indexNow, next.indexNow)),
		scalarSection("schemaContentTypes", !equal(current.schemaContentTypes, next.schemaContentTypes)),
		scalarSection("analysisProfiles", !equal(current.analysisProfiles ?? {}, next.analysisProfiles ?? {})),
	];
}

/**
 * The writes that make the stored records equal to the reviewed plan: a
 * section the plan reports as unchanged is not written, and `stored` must
 * come from the same snapshot as `current`. The plan's warning states the
 * acknowledgement withdrawal every import makes.
 */
export function planSeoPortabilityWrites(
	bundle: SeoPortabilityBundle,
	current: SeoPortabilityState,
	mode: SeoPortabilityMode,
	stored: SeoPortabilityStoredRecords,
	target?: SeoPortabilityTargetContext,
): SeoPortabilityWritePlan {
	const next = applySeoPortabilityBundleToState(bundle, current, mode);
	const sections = importSections(bundle, current, next, mode, target?.savedTemplateCollections)
		.filter((section) => section.changed)
		.map((section) => section.key);
	return {
		state: next,
		sections,
		settingsMarkers: { ...stored.settingsMarkers },
		withdrawAcknowledgement: stored.resourceNoticeAcknowledged && !sections.includes("settings"),
		templates: storedTemplateValues(current.templates, next.templates, mode, stored.templateCollections, target?.savedTemplateCollections),
		customSchemas: customSchemaWrites(current.customSchemas, bundle.configuration.customSchemas, mode),
	};
}

export function buildSeoPortabilityImportPlan(
	bundle: SeoPortabilityBundle,
	current: SeoPortabilityState,
	mode: SeoPortabilityMode,
	now = new Date(),
	target?: SeoPortabilityTargetContext,
): SeoPortabilityImportPlan {
	const next = applySeoPortabilityBundleToState(bundle, current, mode);
	const sections = importSections(bundle, current, next, mode, target?.savedTemplateCollections);
	const siteUrlChanged = current.settings.siteUrl !== next.settings.siteUrl;
	const indexNowWillBeDisabled = current.indexNow.enabled && !next.indexNow.enabled;
	const warnings: string[] = ["Imported settings do not transfer resource-use acknowledgement. Review the notice before enabling saved-content analysis again."];
	if (siteUrlChanged) {
		warnings.push(`Production URL will change from ${current.settings.siteUrl || "not set"} to ${next.settings.siteUrl || "not set"}.`);
	}
	if (current.settings.noindex !== next.settings.noindex) {
		warnings.push(`This plugin's noindex metadata on supported pages will be ${next.settings.noindex ? "enabled" : "disabled"}. EmDash sitemap and robots.txt are configured separately.`);
	}
	const newlyRestrictedArchives = (next.settings.taxonomyArchiveNoindex ?? []).filter((name) =>
		!(current.settings.taxonomyArchiveNoindex ?? []).includes(name));
	if (newlyRestrictedArchives.length) {
		warnings.push(`Noindex will apply to integrated taxonomy archive templates for: ${nameList(newlyRestrictedArchives)}. Assigned posts keep their own indexing settings.`);
	}
	const newlyRestrictedTypes = (next.settings.contentTypeNoindex ?? []).filter((name) =>
		!(current.settings.contentTypeNoindex ?? []).includes(name));
	if (newlyRestrictedTypes.length) {
		warnings.push(`Noindex will apply to every entry of these content types, and their sitemap files stop being listed: ${nameList(newlyRestrictedTypes)}.`);
	}
	const localMediaFields = [
		["organization logo", next.settings.organizationLogo],
		["default social image", next.settings.defaultSocialImage],
	].filter(([, value]) => value.startsWith("/_emdash/api/media/file/"));
	if (localMediaFields.length) {
		warnings.push(`${localMediaFields.map(([label]) => label).join(" and ")} ${localMediaFields.length === 1 ? "references" : "reference"} local media. Media files are not included; verify or reselect these images on the target site.`);
	}
	const deleted = sections.reduce((sum, section) => sum + section.deleted, 0);
	const templateDeletions = sections.find((section) => section.key === "templates")?.deleted ?? 0;
	const schemaDeletions = sections.find((section) => section.key === "customSchemas")?.deleted ?? 0;
	if (templateDeletions) warnings.push(`${templateDeletions} local content-type template${templateDeletions === 1 ? "" : "s"} missing from the bundle will return to inherited defaults in replace mode.`);
	if (schemaDeletions) warnings.push(`${schemaDeletions} local custom schema record${schemaDeletions === 1 ? "" : "s"} will be deleted in replace mode.`);
	const importedTypes = bundle.configuration.indexNow.autoSubmitContentTypes;
	if (!target) {
		if (importedTypes?.length) {
			warnings.push("Review the imported IndexNow content-type selection on this site. An imported collection may not have a public route here.");
		}
	} else {
		if (target.templateCollections === null || target.indexNowContentTypes === null) {
			warnings.push("This site could not list its content types, so imported templates and IndexNow content types could not be checked against it.");
		}
		if (target.templateCollections !== null) {
			const collections = new Set(target.templateCollections);
			const unmatched = Object.keys(bundle.configuration.templates).filter((key) => !collections.has(key));
			if (unmatched.length) {
				warnings.push(`Templates for ${nameList(unmatched)} have no matching content type on this site. They are stored but not used.`);
			}
			const unmatchedRoles = Object.keys(bundle.configuration.schemaContentTypes ?? {})
				.filter((key) => !collections.has(key));
			if (unmatchedRoles.length) {
				warnings.push(`Content type schema for ${nameList(unmatchedRoles)} has no matching content type on this site. It is stored but not used.`);
			}
			const unmatchedTypeRules = (bundle.configuration.settings.contentTypeNoindex ?? []).filter((key) => !collections.has(key));
			if (unmatchedTypeRules.length) {
				warnings.push(`Content type noindex rules for ${nameList(unmatchedTypeRules)} have no matching content type on this site. They are stored but not used.`);
			}
			const unmatchedSitemap = Object.keys(bundle.configuration.sitemap.contentTypes)
				.filter((key) => key !== SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY && !collections.has(key));
			if (unmatchedSitemap.length) {
				warnings.push(`Sitemap choices for ${nameList(unmatchedSitemap)} have no matching content type on this site. They are stored but not used.`);
			}
		}
		if (target.indexNowContentTypes !== null && importedTypes?.length) {
			const available = new Set(target.indexNowContentTypes);
			const missing = importedTypes.filter((collection) => !available.has(collection));
			if (missing.length) {
				warnings.push(`IndexNow automatic submission in this bundle names content types this site does not have: ${nameList(missing)}. They stay in the saved selection but never submit here; review IndexNow content types after import.`);
			}
		}
	}
	if (indexNowWillBeDisabled) warnings.push("IndexNow will be disabled because the production URL changes; the local API key remains stored.");
	if (bundle.engineVersion !== SEO_ENGINE_VERSION) {
		warnings.push(`Bundle engine ${bundle.engineVersion} differs from target engine ${SEO_ENGINE_VERSION}.`);
	}
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		portabilityVersion: SEO_PORTABILITY_VERSION,
		generatedAt: now.toISOString(),
		mode,
		fingerprint: seoPortabilityPlanFingerprint(bundle, current, mode),
		source: clone(bundle.source),
		target: {
			siteName: current.settings.siteName,
			siteUrl: current.settings.siteUrl,
		},
		summary: {
			changedSections: sections.filter((section) => section.changed).length,
			added: sections.reduce((sum, section) => sum + section.added, 0),
			updated: sections.reduce((sum, section) => sum + section.updated, 0),
			unchanged: sections.reduce((sum, section) => sum + section.unchanged, 0),
			deleted,
			destructive: deleted > 0 || (current.settings.noindex === false && next.settings.noindex === true) || newlyRestrictedArchives.length > 0 ||
				newlyRestrictedTypes.length > 0,
			indexNowWillBeDisabled,
		},
		sections,
		warnings,
		requiresConfirmation: true,
	};
}

export function previewSeoPortabilityImport(
	input: unknown,
	current: SeoPortabilityState,
	mode: SeoPortabilityMode,
	now = new Date(),
	target?: SeoPortabilityTargetContext,
): SeoPortabilityPreviewResult {
	const validation = validateSeoPortabilityBundle(input);
	if (!validation.success) return { success: false, error: "invalid_bundle", errors: validation.errors };
	const next = applySeoPortabilityBundleToState(validation.bundle, current, mode);
	const combinedErrors = customSchemaSetErrors(next.customSchemas);
	if (combinedErrors.length) return { success: false, error: "invalid_bundle", errors: combinedErrors };
	const roles = validateSeoAdminSchemaContentTypeValues(next.schemaContentTypes);
	if (!roles.success) {
		return {
			success: false,
			error: "invalid_bundle",
			errors: Object.entries(roles.errors).map(([field, detail]) => `configuration.schemaContentTypes.${field}: ${detail}`),
		};
	}
	const plan = buildSeoPortabilityImportPlan(validation.bundle, current, mode, now, target);
	return {
		success: true,
		bundle: validation.bundle,
		plan: { ...plan, warnings: [...validation.notices, ...plan.warnings] },
	};
}
