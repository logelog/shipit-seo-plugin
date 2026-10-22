import {
	schemaConditionalStore, readSchemaVersioned, writeSchemaConditional,
	deleteSchemaConditional, validSchemaWriteRevision, type SchemaVersionedValue,
} from "./schema-write-storage.ts";
import { compareStoredValue, supportsConditionalStorage } from "./conditional-storage.ts";
import { z } from "astro/zod";
import { projectCoexistenceRobots } from "./plugin-coexistence.ts";
import { bindCoexistenceHost, readCoexistenceInventory, coexistenceAdmission, type CoexistenceHost } from "./plugin-coexistence-runtime.ts";
// Plugin runtime — runs at REQUEST time (Node trusted mode locally via the in-process
// adapter; V8 isolate when sandboxed on Cloudflare). NO Node built-ins — Web APIs only.
//
// Route handlers receive TWO args: (routeCtx, ctx).
//   routeCtx = { input (validated), request: { url, method, headers } }  // request is PLAIN
//   ctx      = the plugin context: storage, kv, log, content?, http?, ...
// Hooks receive TWO args: (event, ctx).
//
// SECURITY: the page:metadata hook NEVER emits raw HTML/script. It returns DATA
// contributions only; JSON-LD is a plain object the host renders + escapes. Custom
// schema is validated (validateCustomJsonLd) before storage AND before emission.
import type { PluginContext, PublicPageContext } from "emdash";
import type { SandboxedPlugin } from "emdash/plugin";

import {
	SEO_ADMIN_CONFIGURATION_VERSION,
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_MODULES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	SEO_ADMIN_SOCIAL_READ_REQUEST_MAX_BYTES,
	SEO_ADMIN_SOCIAL_WRITE_REQUEST_MAX_BYTES,
	SEO_ADMIN_SITEMAP_STORAGE_VERSION,
	SEO_ADMIN_OUTPUT_SUPPORT,
	SEO_ADMIN_LEGACY_EXPORT_FORMAT,
	SEO_ADMIN_LEGACY_EXPORT_FORMAT_VERSION,
	SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES,
	SEO_ADMIN_TEMPLATE_DEFINITIONS,
	SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	SEO_PORTABILITY_CONFIRMATION,
	extractSeoSchemaTypes,
	seoModuleCanRun,
	seoModuleIsEditable,
	classifySeoContentCheck,
	summarizeSeoChecks,
	seoAnalysisPresentation,
	seoScoreDisplay,
	type SeoAdminConfiguration,
	type SeoAdminContentScore,
	type SeoAdminContentScores,
	type SeoAdminEntryAnalysisIdentityFailure,
	type SeoAdminEntryAnalysisIdentityResult,
	type SeoAdminSavedAnalysisFailure,
	type SeoAdminSavedAnalysisResult,
	type SeoAdminContentOptions,
	type SeoAdmin404Monitor,
	type SeoAdmin404TriageResult,
	type SeoAdminRedirectRuleCreateResult,
	type SeoAdminEntrySchemaListResult,
	type SeoAdminEntrySchemaRemoveResult,
	type SeoAdminEntrySchemaCandidateFailure,
	type SeoAdminEntrySchemaCandidatePreview,
	type SeoAdminEntrySchemaCandidatePreviewResult,
	type SeoAdminSchemaLibrary,
	type SeoAdminSchemaLibraryWriteResult,
	SEO_ADMIN_SCHEMA_LIBRARY_LIMITS,
	SEO_ADMIN_SCHEMA_LIBRARY_WRITE_REQUEST_MAX_BYTES,
	SEO_ADMIN_TEMPLATE_CONFIGURATION_RESPONSE_MAX_BYTES,
	SEO_ADMIN_TEMPLATE_EXAMPLES_MAX_LIMIT,
	SEO_ADMIN_TEMPLATE_SMALL_REQUEST_MAX_BYTES,
	SEO_ADMIN_TEMPLATE_WRITE_REQUEST_MAX_BYTES,
	SEO_ADMIN_REDIRECT_EDIT_LIMITS,
	type SeoAdminRedirectRuleLoadResult,
	type SeoAdminRedirectRuleUpdateResult,
	type SeoAdminRedirectRuleUpdateRecoveryResult,
	type SeoAdminTemplateExampleResult,
	type SeoAdminTemplateExamplesResult,
	type SeoAdminTemplatePreviewResult,
	type SeoAdminEntrySchemaSaveResult,
	type SeoAdminRedirectRuleListResult,
	type SeoAdminCrawlDiagnostics,
	type SeoAdminScoreTrends,
	type SeoAdminCustomSchema,
	type SeoAdminCustomSchemaSnapshot,
	type SeoAdminCustomSchemaReadResult,
	type SeoAdminSchemaCommandError,
	type SeoAdminCustomSchemaDeleteResult,
	type SeoAdminCustomSchemaSaveResult,
	type SeoAdminModuleConfiguration,
	type SeoAdminModulesSaveResult,
	type SeoAdminModuleValues,
	type SeoAdminOverview,
	type SeoAdminSchemaPresetConfiguration,
	type SeoAdminSchemaPresetsSaveResult,
	type SeoAdminPublisherOwnershipReadResult,
	type SeoAdminPublisherOwnershipWriteResult,
	type SeoAdminSchemaPresetValues,
	type SeoAdminSchemaContentTypeConfiguration,
	type SeoAdminSchemaContentTypeValues,
	type SeoAdminSchemaContentTypesReadResult,
	type SeoAdminSchemaContentTypesSaveResult,
	type SeoAdminSchemaComposerSaveResult,
	type SeoAdminSettingsSaveResult,
	type SeoAdminSettingsValues,
	type SeoAdminSitemapPreview,
	type SeoAdminSitemapSaveResult,
	type SeoAdminSitemapValues,
	type SeoAdminEntryPreview,
	type SeoAdminEntrySchemaGraph,
	type SeoAdminLegacyRecordExport,
	type SeoAdminLegacyRecordSnapshot,
	type SeoAdminEntryPreviewResult,
	type SeoAdminAnalysisProfileResult,
	type SeoAdminFocusKeywordSaveResult,
	type SeoAdminIndexNowContentTypeRule,
	type SeoAdminIndexNowHistoryResult,
	type SeoAdminIndexNowHistoryUrlsResult,
	type SeoAdminIndexNowOperationResult,
	type SeoAdminIndexNowSaveResult,
	type SeoAdminMetaOverride,
	type SeoAdminSocialOverrideReadResult,
	type SeoAdminSocialOverrideReadError,
	type SeoAdminSocialOverrideSaveResult,
	type SeoAdminTemplateConfiguration,
	type SeoAdminTemplateSet,
	type SeoAdminTemplatesSaveResult,
	type SeoAdminTemplateValues,
	type SeoPortabilityApplyResult,
	type SeoPortabilityExportResponse,
	type SeoPortabilityMode,
	type SeoPortabilityPreviewResult,
	type SeoModuleKey,
	type SeoSchemaPresetKey,
	type SeoTemplateCollection,
	validateSeoAdminCustomSchemaInput,
	validateSeoAdminModuleValues,
	validateSeoAdminSchemaPresetValues,
	validateSeoAdminSettings,
	validateSeoAdminSettingsWriteGuard,
	validateSeoContentScoringChange,
	validateSeoAdminTemplateSet,
	validateSeoAdminTemplateValues,
	isSeoContentCollectionKey,
} from "./admin-contract.ts";
import {
	SEO_SCORE_VERSION,
	type SeoAnalysisResult,
	type SeoCheckCategory,
	type SeoCheckStatus,
	type SeoContentCheck,
} from "./analysis.ts";
import {
	SEO_EARLIER_ANALYZER_TEXT,
	presentSeoChecks,
	seoCheckRowWord,
	seoCheckTotalsText,
	seoScoreDisplayText,
} from "./check-presentation.ts";
import type { SeoAdminBranding, SeoInstalledBranding } from "./branding.ts";
import { generatedContentDescription, isGeneratedDescription } from "./content-analysis-inputs.ts";
import { SEO_SNIPPET_DEVICE_LABELS, SEO_SNIPPET_ESTIMATE_NOTE, seoSnippetCutPoint, seoSnippetFit } from "./snippet-fit.ts";
import {
	COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX,
	collectionAnalysisProfileKey,
	readCollectionAnalysisProfile,
	saveCollectionAnalysisProfile,
	type CollectionAnalysisProfileSelection,
} from "./collection-analysis-profile.ts";
import { analyzeSeoCrawlGraph, extractSeoCrawlLinks, SEO_CRAWL_LIMITS, type SeoCrawlEntryInput } from "./crawl-diagnostics.ts";
import { contentAuditRefs, runContentAudit } from "./content-audit.ts";
import { extractSeoDocumentSignals } from "./document-signals.ts";
import {
	focusKeywordsValidationError,
	deleteAnalysisProfile,
	persistAnalysisProfile,
	readAnalysisProfile,
	resolveFocusKeywordOwnership,
	type FocusKeywordOwnership,
} from "./focus-keyword.ts";
import {
	INDEXNOW_SETTINGS_STORAGE_KEY,
	buildAdminIndexNowStatus,
	deliverIndexNowQueue,
	enqueueIndexNowUrls,
	isIndexNowDrainTask,
	listIndexNowHistory,
	publicIndexNowKey,
	readIndexNowHistoryUrls,
	readIndexNowSettings,
	retryFailedIndexNowJobs,
	retryIndexNowSubmission,
	updateIndexNowAutomation,
	updateIndexNowSettings,
	withIndexNowQueueLease,
	withIndexNowSettingsLease,
	type IndexNowHistoryRecording,
	type IndexNowSettingsUpdateResult,
	type IndexNowUrlCandidate,
} from "./indexnow-runtime.ts";
import {
	INDEXNOW_HISTORY_MAX_PAGE_SIZE,
	INDEXNOW_MANUAL_URL_LIMIT,
	INDEXNOW_SUBMISSION_STATUSES,
	UNKNOWN_INDEXNOW_INSTALLATION,
	createIndexNowKey,
	indexNowPublicOrigin,
	normalizeIndexNowUrl,
	validateIndexNowSettings,
	type IndexNowInstallation,
	type IndexNowSubmissionStatus,
} from "./indexnow.ts";
import { setupIndexNow } from "./indexnow-setup.ts";
import { IndexNowSetupError } from "./indexnow-verification.ts";
import {
	JsonLdValidationError,
	SCHEMA_PRESET_REQUIREMENTS,
	TEMPLATE_VARS,
	TemplateExpansionLimitError,
	applyVarsDeep,
	buildSchemaPresetGraphs,
	buildVars,
	duplicateSchemaDefinitionIds,
	isHttpUrl,
	jsonUtf8LengthWithin,
	localBusinessSchema,
	resolveContentTypeTemplate,
	resolveSchemaOrganizationReferences,
	resolveTemplate,
	schemaContentTypeRole,
	schemaDefinitionIdentities,
	validateCustomJsonLd,
	type GlobalSeoSettings,
} from "./lib.ts";
import {
	diagnoseSeoLocaleGraph,
	resolveSeoHreflangLinks,
	type SeoLocaleGraphDiagnostic,
	type SeoLocaleGraphEntry,
} from "./locale-graph.ts";
import { loadExactTranslationGroup } from "./host-translations.ts";
import {
	deleteMetaOverride,
	mergeRobotsDirectives,
	normaliseDisabledPresets,
	normaliseRobotsDirectives,
	readMetaOverride,
	readMetaOverrideStrict,
	updateMetaOverride,
} from "./meta-overrides.ts";
import { listIndexingTaxonomies, validateNewArchiveSelections } from "./taxonomy-indexing.ts";
import { validateNewContentTypeNoindex } from "./content-type-indexing.ts";
import { contentTypeNoindexApplies } from "./content-type-noindex-policy.ts";
import { contentTypeRoutePattern, createContentTypeRouteMatcher } from "./content-type-noindex-routes.ts";
import { taxonomyArchiveName } from "./taxonomy-archives.ts";
import { taxonomyArchiveNoindexApplies } from "./taxonomy-archive-policy.ts";
import {
	CORE_SEO_MIGRATION_VERSION,
	coreSeoEquals,
	normaliseCoreSeo,
	planLegacyOverrideMigration,
	type CoreSeoMigrationConflictPolicy,
	type CoreSeoMigrationPlan,
	type CoreSeoSnapshot,
} from "./migration.ts";
import { createSeo404Runtime } from "./monitor404-runtime.ts";
import { normalizeNotFoundPath, type SeoRedirectCandidate } from "./monitor404.ts";
import { withOperationLease } from "./operation-lease.ts";
import {
	createSeoPortabilityBundle,
	planSeoPortabilityWrites,
	previewSeoPortabilityImport,
	seoPortabilityStoredRecords,
	type SeoPortabilityState,
	type SeoPortabilityTargetContext,
	type SeoPortabilityWritePlan,
} from "./portability.ts";
import {
	REDIRECT_GROUP_MAX_LENGTH,
	REDIRECT_ID_MAX_LENGTH,
	REDIRECT_REVISION_MAX_LENGTH,
	REDIRECT_EDIT_INPUT_MAX_LENGTH,
	REDIRECT_LIST_MAX_PAGE_SIZE,
	REDIRECT_PATH_MAX_LENGTH,
	REDIRECT_SEARCH_MAX_LENGTH,
	createRedirectRule,
	listRedirectRules,
	loadRedirectRule,
	updateRedirectRule,
	reconcileRedirectRuleUpdate,
	reconcileRedirectRule,
	type RedirectRuleLoadResult,
	type RedirectRuleUpdateResult,
	type RedirectRuleUpdateRecoveryResult,
} from "./redirects.ts";
import { canManageRedirects, emdashRedirectHost } from "./redirects-emdash.ts";
import { emdashEntrySchemaHost, toEntrySchemaHostEntry } from "./entry-schemas-emdash.ts";
import {
	parseStoredEntrySchemaTarget,
	ENTRY_SCHEMA_NAME_MAX_LENGTH,
	entrySchemaTargetMatches,
	type EntrySchemaPageEntry,
	listEntrySchemas,
	prepareEntrySchemaCandidate,
	removeEntrySchema,
	saveEntrySchema,
	type EntrySchemaHost,
} from "./entry-schemas.ts";
import {
	ENTRY_SCHEMA_CANDIDATE_MAX_BYTES,
	ENTRY_SCHEMA_CANONICAL_UNRESOLVED,
	ENTRY_SCHEMA_PREVIEW_REQUEST_MAX_BYTES,
	ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES,
	ENTRY_SCHEMA_PREVIEW_RESPONSE_TOO_LARGE,
	createEntrySchemaPreviewExpansion,
	entrySchemaCandidateGraphBytes,
	entrySchemaPreviewContentProblem,
	entrySchemaPreviewWireBytes,
	entrySchemaUsesVariable,
} from "./entry-schema-candidate.ts";
import {
	deleteSchemaLibraryTemplate,
	readSchemaLibrary,
	saveSchemaLibraryTemplate,
	type SchemaLibraryHost,
	type SchemaLibrarySnapshot,
	type SchemaLibraryWriteResult,
} from "./schema-library.ts";
import { composeSeoSchema } from "./schema-composer.ts";
import {
	BUSINESS_IDENTITY_LEGACY_PUBLISHER_FIELDS,
	businessIdentityOwnedIds,
	type BusinessIdentityCustomRecord,
	type BusinessIdentityLegacySettings,
	type BusinessIdentityTarget,
} from "./business-identity.ts";
import {
	inspectPublisherOwnership,
	presetDefinesCustomPublisherId,
	publisherOwnershipEffective,
	publisherOwnershipOptedOut,
	readPublisherOwnership,
	resolvePublisherOutput,
	savePublisherOwnership,
	type PublisherOwnershipHost,
} from "./publisher-ownership.ts";
import {
	BUSINESS_IDENTITY_PAGE_LIMIT,
	businessIdentityStoreFor,
	customRecordOwnedIds,
	inspectBusinessIdentity,
	listBusinessIdentityPages,
	previewBusinessIdentity,
	readBusinessIdentityRenderState,
	readBusinessIdentityStored,
	saveBusinessIdentity,
	setBusinessIdentityActive,
	transitionBusinessIdentityEntity,
	type BusinessIdentityHost,
	type BusinessIdentityTargetResolution,
} from "./business-identity-commands.ts";
import {
	buildSchemaContentTypeConfiguration,
	inspectSchemaContentTypes,
	resetSchemaContentTypes,
	saveSchemaContentTypes,
	type SchemaContentTypesHost,
} from "./schema-content-types.ts";
import { createSeoSchemaResolutionState, resolveSeoSchemaCandidate } from "./schema-resolution.ts";
import {
	buildScoreTrends,
	enforceScoreHistoryRetention,
	listScoreSnapshots,
} from "./score-history.ts";
import { runManualSavedScoreLifecycle, runSavedScoreLifecycle, verifyStoredScoreFreshness, type SavedScoreOutcome } from "./score-lifecycle.ts";
import type { EntryAnalysisPurpose } from "./analysis-admission.ts";
import type { ScoreHistoryOutcome } from "./score-history.ts";
import {
	commandScoreScanRoute,
	scoreScanRouteInputs,
	scoreScanStateRoute,
	scoreScanTaxonomiesRoute,
	scoreScanTermsRoute,
	startScoreScanRoute,
	type ScoreScanHost,
} from "./score-scan.ts";
import {
	GLOBAL_SETTINGS_KEY,
	SiteSettingsUnreadableError,
	buildAdminSettings,
	getContentScoringEnabled,
	getGlobalSettings,
	getNoindex,
	hostOnlySettingsValues,
	persistAdminSettings,
	readAdminSettings,
	readContentScoringPolicy,
	readReadableSiteSettings,
	readSiteIndexingFacts,
	readSiteSettings,
	resetAdminSettings,
	saveAdminSettingsIfCurrent,
	saveCustomVerificationTags,
	saveContentScoring,
	withdrawContentScoringAcknowledgement,
} from "./settings-runtime.ts";
import { isReadableSiteSettings, legacySettingsGuard } from "./settings-state.ts";
import { customVerificationContributions } from "./custom-verification-tags.ts";
import { LLMS_TXT_WRITE_REQUEST_MAX_BYTES } from "./llms-txt-document.ts";
import type { LlmsTxtInstallation } from "./llms-txt-installation.ts";
import {
	LINK_PAGE_REQUEST_MAX_BYTES,
	LINK_SUGGESTION_REQUEST_MAX_BYTES,
	createLinkCommands,
	type LinkCommandHost,
} from "./internal-link-routes.ts";
import {
	buildLlmsTxtAdmin,
	resetCorruptLlmsTxt,
	saveLlmsTxtDocument,
	serveLlmsTxt,
	setLlmsTxtEnabled,
	type LlmsTxtHttpResult,
} from "./llms-txt-runtime.ts";
import type { RobotsInstallation } from "./robots-installation.ts";
import { buildRobotsTxtFacts } from "./robots-runtime.ts";
import { SITEMAP_MAX_CURSOR_LENGTH, isSitemapCursor } from "./sitemap-engine.ts";
import { validateSeoCanonical } from "./sitemap-policy.ts";
import {
	SITEMAP_SETTINGS_KEY,
	buildSitemapAdmin,
	previewSitemapFile,
	readSitemapPortableValues,
	resetSitemapSettings,
	saveSitemapSettings,
	serveSitemapFile,
	type SitemapHost,
	type SitemapHttpResult,
} from "./sitemap-runtime.ts";
import {
	deleteSocialOverride,
	persistSocialOverride,
	readSocialOverride,
	readSocialOverrideSnapshot,
	readSocialOverrideEditing,
} from "./social-overrides.ts";
import {
	LEGACY_SCHEMA_PRESETS_SETTINGS_KEY,
	MODULES_SETTINGS_KEY,
	PRESET_KEYS,
	SCHEMA_CONTENT_TYPES_SETTINGS_KEY,
	SCHEMA_PRESETS_SETTINGS_KEY,
	SEO_MODULES,
	TEMPLATES_SETTINGS_KEY,
	absoluteMetadataUrl,
	analyzeContentPreview,
	buildEntryPublicPageContext,
	clean,
	cleanCollection,
	contentBodyValue,
	contentItemIsPublished,
	contentItemLocale,
	contentItemTitle,
	contentRef,
	contentSchemaScopes,
	contentSourceUpdatedAt,
	effectiveField,
	entryAnalysisConfigurationFingerprint,
	getTemplate,
	isStoredScoreCurrent,
	isStoredScoreUsable,
	isTemplateCollection,
	keywordFromContent,
	legacyOverrideAliasRefs,
	normaliseKeyword,
	plainText,
	publicCustomSchema,
	publicUrlForContent,
	readAdminModules,
	readAdminSchemaPresets,
	readInheritedAdminSchemaPresets,
	readAdminTemplates,
	readAllAdminCustomSchemas,
	readAllRawCustomSchemas,
	readAnalysisRuntimeConfig,
	readEntryAnalysisIdentity,
	readSchemaContentTypeRoles,
	readScopedAdminCustomSchemas,
	schemaOutputContentTypeRoles,
	readScoreRefreshInputSnapshot,
	readStoredScoreSnapshot,
	resolveContentCollection,
	resolveContentCollectionSource,
	resolveContentCollections,
	resolveEffectiveContentMetadata,
	createMetadataReadObservation,
	resolveEntryOwnership,
	entrySchemaPageEntry,
	resolveEntrySchemaGraphs,
	resolveOverrideForContentItem,
	resolvedEntrySchemaTypes,
	scoreContentSourceVersion,
	scoreRefreshRevision,
	supportedContentCollection,
	templateRevisionFor,
	uniqueStrings,
	unsavedContentSnapshots,
	type ContentCollectionResolution,
	type EffectiveSeoMetadata,
	type Override,
	type PluginContentAccess,
	type SeoContentCollectionDefinition,
	type SeoScoreRecord,
	type StoredCustomSchema,
	type StoredSeoAdminModules,
	type StoredSeoAdminSchemaContentTypes,
	type StoredSeoAdminSchemaPresets,
} from "./entry-analysis-runtime.ts";
import {
	LEGACY_TEMPLATE_REVISIONS_KEY,
	METADATA_TEMPLATES_KEY,
	inheritedMetadataTemplate,
	metadataTemplateValuesEqual,
	observeLegacyRevisions,
	observeLegacyTemplate,
	readLegacyTemplateFields,
	readMetadataTemplates,
	resetMetadataTemplate,
	rollbackPortabilityTemplates,
	saveMetadataTemplate,
	writePortabilityTemplates,
	type BoundMetadataTemplates,
	type MetadataTemplateCommandResult,
	type MetadataTemplatesHost,
} from "./metadata-templates.ts";
import { listMetadataTemplateExamples, previewMetadataTemplate, readMetadataTemplateExample, templateRouteWireBytes } from "./metadata-template-preview.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CoreSeoMigrationRecordStatus = "prepared" | "applied" | "rolled-back" | "failed";

const CORE_SEO_MIGRATION_OPERATION_STORAGE_VERSION = 1 as const;

type CoreSeoMigrationOperationStatus =
	| "prepared"
	| "applied"
	| "failed"
	| "rolling-back"
	| "rolled-back";

interface CoreSeoMigrationRecord {
	id: string;
	batchId: string;
	migrationVersion: typeof CORE_SEO_MIGRATION_VERSION;
	ref: string;
	collection: string;
	entryId: string;
	sourceOverrideId: string;
	sourceOverride: Override;
	conflictPolicy: CoreSeoMigrationConflictPolicy;
	before: CoreSeoSnapshot;
	after: CoreSeoSnapshot;
	status: CoreSeoMigrationRecordStatus;
	createdAt: string;
	updatedAt: string;
	error?: string;
}

interface CoreSeoMigrationOperation {
	id: string;
	storageVersion: typeof CORE_SEO_MIGRATION_OPERATION_STORAGE_VERSION;
	sourceOverrideId: string;
	selectionFingerprint: string;
	status: CoreSeoMigrationOperationStatus;
	record: CoreSeoMigrationRecord;
	updatedAt: string;
}

type CoreSeoMigrationPlanState =
	| CoreSeoMigrationPlan["status"]
	| "override-not-found"
	| "invalid-ref"
	| "unsupported-collection"
	| "content-not-found"
	| "identifier-lookup-unavailable"
	| "seo-disabled";

interface ResolvedCoreSeoMigrationPlan {
	sourceOverrideId: string;
	ref: string;
	override?: Override;
	collection?: string;
	entryId?: string;
	title?: string;
	state: CoreSeoMigrationPlanState;
	plan?: CoreSeoMigrationPlan;
	contentItem?: any;
	recoveryOperation?: CoreSeoMigrationOperation;
	detail: string;
}

interface PreviewInput {
	title?: string;
	description?: string;
	url?: string;
	focusKeyword?: string;
	image?: string;
}

interface AnalyzerViewInput {
	collection?: string;
	cursor?: string;
	pageNumber?: number;
	ref?: string;
	keyword?: string;
	category?: SeoCheckCategory | "all";
	refreshCollection?: string;
	refreshCursor?: string;
	refreshRevision?: string;
	analysis?: SeoScoreRecord;
}

interface SeoAuditCheck {
	group: string;
	check: string;
	status: SeoCheckStatus;
	weight: number;
	detail: string;
}

const SAVED_CONTENT_SNAPSHOT_SCHEMA = z.object({
	ref: z.string().min(1).max(512),
	data: z.record(z.string(), z.unknown()),
	slug: z.string().nullable(),
	seo: z.object({
		title: z.string().nullable().optional(),
		description: z.string().nullable().optional(),
		image: z.string().nullable().optional(),
		canonical: z.string().nullable().optional(),
		noIndex: z.boolean().optional(),
	}).optional(),
	sourceVersion: z.string().min(1).max(2048),
});
const SCORE_REFRESH_REVISION_PATTERN = /^sha256-[a-f0-9]{64}$/;
type PluginContentListOptions = Parameters<PluginContentAccess["list"]>[1];
type PluginContentListResult = Awaited<ReturnType<PluginContentAccess["list"]>>;

function templateContentCollections(
	definitions: SeoContentCollectionDefinition[],
): SeoContentCollectionDefinition[] {
	return definitions.filter((definition) => definition.hasSeo);
}

async function resolveIndexNowContentCollections(ctx: PluginContext): Promise<ContentCollectionResolution> {
	const resolution = await resolveContentCollectionSource(ctx);
	return {
		available: resolution.available,
		definitions: resolution.available
			? resolution.definitions.filter((definition) => definition.hasSeo)
			: [],
	};
}

async function contentCollectionLabels(ctx: PluginContext): Promise<Map<string, string>> {
	return new Map(
		(await resolveContentCollections(ctx)).map((definition) => [
			definition.collection,
			definition.label,
		]),
	);
}

function contentCollectionDescription(definition: SeoContentCollectionDefinition): string {
	const label = definition.label.toLocaleLowerCase("en");
	return definition.hasSeo
		? `Defaults for ${label}. Saved entry overrides take precedence over these templates.`
		: `Defaults for ${label}. EmDash SEO fields are off for this content type, but templates still supply its description and social defaults. Saved entry overrides take precedence.`;
}

function errorMessages(error: unknown): string[] {
	const messages: string[] = [];
	const seen = new Set<unknown>();
	let current: unknown = error;

	for (let depth = 0; depth < 5 && current != null; depth += 1) {
		if (seen.has(current)) break;
		seen.add(current);

		if (typeof current === "string") {
			messages.push(current);
			break;
		}
		if (typeof current !== "object") break;

		const message = Reflect.get(current, "message");
		if (typeof message === "string") messages.push(message);
		current = Reflect.get(current, "cause");
	}

	return messages;
}

function isMissingContentCollection(error: unknown, collection: string): boolean {
	const table = `ec_${collection}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const sqlite = new RegExp(
		`no such table:\\s*(?:[a-z0-9_]+\\.)?["'\`]?${table}["'\`]?(?:\\s|:|$)`,
		"i",
	);
	const postgres = new RegExp(
		`(?:relation|table)\\s+["'\`]?${table}["'\`]?\\s+does not exist`,
		"i",
	);

	return errorMessages(error).some((message) => sqlite.test(message) || postgres.test(message));
}

async function listAvailableContentCollection(
	content: PluginContentAccess,
	collection: string,
	options?: PluginContentListOptions,
): Promise<PluginContentListResult | null> {
	try {
		return await content.list(collection, options);
	} catch (error) {
		if (isMissingContentCollection(error, collection)) return null;
		throw error;
	}
}

// ---------------------------------------------------------------------------
// KV-backed settings access
// ---------------------------------------------------------------------------

// Imports write the sitemap record directly; the portability flow fences and
// rolls back its own KV writes.
async function persistAdminSitemap(ctx: PluginContext, values: SeoAdminSitemapValues): Promise<void> {
	await ctx.kv.set(SITEMAP_SETTINGS_KEY, {
		version: SEO_ADMIN_SITEMAP_STORAGE_VERSION,
		updatedAt: new Date().toISOString(),
		values,
	});
}

// Only import writes the module record without a revision check; the
// portability flow fences and rolls back its own KV writes.
async function persistAdminModules(
	ctx: PluginContext,
	values: SeoAdminModuleValues,
): Promise<void> {
	await ctx.kv.set(MODULES_SETTINGS_KEY, {
		version: SEO_ADMIN_MODULES_STORAGE_VERSION,
		updatedAt: new Date().toISOString(),
		values,
	} satisfies StoredSeoAdminModules);
}

interface AdminModuleWriteSnapshot {
	values: SeoAdminModuleValues;
	updatedAt: string | null;
	revision: string | null;
	writable: boolean;
}

/**
 * The revision is read before the values, so a write landing between the two
 * reads makes the next guarded save conflict instead of overwriting it.
 */
async function readAdminModuleWriteSnapshot(ctx: PluginContext): Promise<AdminModuleWriteSnapshot> {
	const store = schemaConditionalStore(ctx.kv);
	let revision: string | null = null;
	let writable = store !== null;
	if (store) {
		try { revision = (await readSchemaVersioned(store, MODULES_SETTINGS_KEY))?.revision ?? null; }
		catch { writable = false; }
	}
	return { ...await readAdminModules(ctx), revision, writable };
}

async function buildAdminModuleConfiguration(
	ctx: PluginContext,
	state?: AdminModuleWriteSnapshot,
): Promise<SeoAdminModuleConfiguration> {
	const current = state ?? (await readAdminModuleWriteSnapshot(ctx));
	const nativeSitemap = sitemapModuleControllable(ctx);
	return {
		storageVersion: SEO_ADMIN_MODULES_STORAGE_VERSION,
		updatedAt: current.updatedAt,
		revision: current.revision,
		writable: current.writable,
		items: SEO_MODULES.map((definition) => definition.key === "sitemap" && nativeSitemap
			? { ...definition, status: "active" as const, capability: "native-sitemap" as const, enabled: current.values.sitemap, editable: true }
			: {
				...definition,
				enabled: seoModuleCanRun(definition.key) && current.values[definition.key],
				editable: seoModuleIsEditable(definition.status),
			}),
	};
}

// Only an installation whose native middleware serves /sitemap.xml can switch
// it; elsewhere the stored flag is kept but changes nothing.
function sitemapModuleControllable(ctx: PluginContext): boolean {
	return sitemapHost(ctx)?.installation.owner === "shipit";
}

const SITEMAP_MODULE_LOCKED = "This installation does not serve /sitemap.xml through this plugin, so the Sitemaps setting cannot be changed here.";

async function getModules(ctx: PluginContext): Promise<SeoAdminModuleValues> {
	return (await readAdminModules(ctx)).values;
}

interface AdminPresetWriteSnapshot {
	values: SeoAdminSchemaPresetValues;
	updatedAt: string | null;
	migrationNeeded: boolean;
	revision: string | null;
	record: SeoAdminSchemaPresetConfiguration["record"];
	writable: boolean;
}

async function readAdminPresetWriteSnapshot(ctx: PluginContext): Promise<AdminPresetWriteSnapshot> {
	const fallback = async () => {
		try { return await readInheritedAdminSchemaPresets(ctx); }
		catch {
			return {
				values: Object.fromEntries(SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((item) => [item.key, item.defaultEnabled])) as SeoAdminSchemaPresetValues,
				updatedAt: null, migrationNeeded: false,
			};
		}
	};
	const store = schemaConditionalStore(ctx.kv);
	if (!store) return { ...await fallback(), revision: null, record: "unavailable", writable: false };
	let stored: SchemaVersionedValue | null;
	try { stored = await readSchemaVersioned(store, SCHEMA_PRESETS_SETTINGS_KEY); }
	catch { return { ...await fallback(), revision: null, record: "unavailable", writable: false }; }
	if (!stored) return { ...await fallback(), revision: null, record: "absent", writable: true };
	const raw = stored.value as Partial<StoredSeoAdminSchemaPresets> | null;
	const validation = validateSeoAdminSchemaPresetValues(raw?.values);
	if (!raw || raw.version !== SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION ||
		typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt)) || !validation.success) {
		return { ...await fallback(), revision: stored.revision, record: "invalid", writable: true };
	}
	return { values: validation.values, updatedAt: raw.updatedAt, migrationNeeded: false, revision: stored.revision, record: "valid", writable: true };
}

/** Import supplies a tracking context that fences this write to its captured revision. */
async function persistAdminSchemaPresets(ctx: PluginContext, values: SeoAdminSchemaPresetValues): Promise<void> {
	const updatedAt = new Date().toISOString();
	await ctx.kv.set(SCHEMA_PRESETS_SETTINGS_KEY, {
		version: SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION, updatedAt, values,
	} satisfies StoredSeoAdminSchemaPresets);
}

function presetWriteFailure(
	error: SeoAdminSchemaCommandError, message: string,
	errors: Record<string, string> = { _form: message }, current?: SeoAdminSchemaPresetConfiguration,
): Extract<SeoAdminSchemaPresetsSaveResult, { success: false }> {
	return { success: false, error, message, errors, ...(current ? { current } : {}) };
}

async function saveAdminSchemaPresets(ctx: PluginContext, input: unknown): Promise<SeoAdminSchemaPresetsSaveResult> {
	const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
	if (!source || !Object.hasOwn(source, "expectedRevision") ||
		!(source.expectedRevision === null || validSchemaWriteRevision(source.expectedRevision))) {
		return presetWriteFailure("invalid_input", "Send the preset choices with the revision you reviewed.");
	}
	const validation = validateSeoAdminSchemaPresetValues(source.values);
	if (!validation.success) return presetWriteFailure("invalid_values", "Review the preset choices.", validation.errors as Record<string, string>);
	const before = await readAdminPresetWriteSnapshot(ctx);
	if (!before.writable || before.record === "unavailable") return presetWriteFailure("unavailable", "Preset storage could not be read safely. Nothing was changed.");
	if (before.revision !== source.expectedRevision) return presetWriteFailure("conflict", "Presets changed after you opened them. Your choices are kept.", undefined, await buildAdminSchemaPresetConfiguration(ctx, before));
	if (before.record === "invalid" && source.replaceInvalid !== true) return presetWriteFailure("invalid_record", "The stored presets are invalid. Review an explicit replacement before saving.", undefined, await buildAdminSchemaPresetConfiguration(ctx, before));
	if (before.record === "valid" && portabilityValueEquals(before.values, validation.values))
		return { success: true, changed: false, presets: await buildAdminSchemaPresetConfiguration(ctx, before) };
	const updatedAt = new Date().toISOString();
	let written: Awaited<ReturnType<typeof writeSchemaConditional>>;
	try {
		written = await writeSchemaConditional(schemaConditionalStore(ctx.kv)!, SCHEMA_PRESETS_SETTINGS_KEY, source.expectedRevision as string | null, {
			version: SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION, updatedAt, values: validation.values,
		});
	} catch { return presetWriteFailure("unconfirmed", "The preset save could not be confirmed. Read the saved choices before another attempt."); }
	if (!written.applied) return presetWriteFailure("conflict", "Presets changed before the save. Nothing was overwritten.");
	return { success: true, changed: true, presets: await buildAdminSchemaPresetConfiguration(ctx, {
		values: validation.values, updatedAt, migrationNeeded: false, revision: written.revision, record: "valid", writable: true,
	}) };
}

async function buildAdminSchemaPresetConfiguration(
	ctx: PluginContext,
	state?: AdminPresetWriteSnapshot,
): Promise<SeoAdminSchemaPresetConfiguration> {
	const current = state ?? (await readAdminPresetWriteSnapshot(ctx));
	const [discovery, roles] = await Promise.all([
		resolveContentCollectionSource(ctx),
		readSchemaContentTypeRoles(ctx),
	]);
	const mappedRoles = new Set(discovery.definitions.map((definition) =>
		schemaContentTypeRole(definition.collection, roles.values)));
	// An unreadable mapping emits no role-owned graph, so whether a role is used is unknown.
	const rolesKnown = discovery.available && !roles.invalid;
	return {
		storageVersion: SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
		revision: current.revision, record: current.record, writable: current.writable,
		updatedAt: current.updatedAt,
		migrationNeeded: current.migrationNeeded,
		items: SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => {
			const requiredRole = SCHEMA_PRESET_REQUIREMENTS[definition.key]?.contentTypeRole;
			return {
				...definition,
				enabled: current.values[definition.key],
				applicable: requiredRole
					? rolesKnown ? mappedRoles.has(requiredRole) : undefined
					: true,
			};
		}),
	};
}

const MODULES_REVISION_REQUIRED = "Send the module choices with the revision you loaded.";
const MODULES_UNGUARDED = "This host cannot store Feature controls with a revision check, so nothing was changed.";
const MODULES_UNCONFIRMED = "The change could not be confirmed. Reload Feature controls to see what is stored before trying again.";

function moduleWriteRevision(input: unknown): { ok: true; expectedRevision: string | null } | { ok: false } {
	const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
	if (!source || !Object.hasOwn(source, "expectedRevision")) return { ok: false };
	const expected = source.expectedRevision;
	return expected === null || validSchemaWriteRevision(expected) ? { ok: true, expectedRevision: expected } : { ok: false };
}

async function saveAdminModules(ctx: PluginContext, input: unknown): Promise<SeoAdminModulesSaveResult> {
	const guard = moduleWriteRevision(input);
	if (!guard.ok) return { success: false, errors: { _form: MODULES_REVISION_REQUIRED } };
	const validation = validateSeoAdminModuleValues(input);
	if (!validation.success) return validation;
	const before = await readAdminModuleWriteSnapshot(ctx);
	if (!before.writable) return { success: false, errors: { _form: MODULES_UNGUARDED } };
	if (before.revision !== guard.expectedRevision) {
		return { success: false, conflict: true, errors: { _form: "Feature controls changed after you opened them. Nothing was saved." } };
	}
	if (!sitemapModuleControllable(ctx) && validation.values.sitemap !== before.values.sitemap) {
		return { success: false, errors: { sitemap: SITEMAP_MODULE_LOCKED } };
	}
	const updatedAt = new Date().toISOString();
	let written: Awaited<ReturnType<typeof writeSchemaConditional>>;
	try {
		written = await writeSchemaConditional(schemaConditionalStore(ctx.kv)!, MODULES_SETTINGS_KEY, guard.expectedRevision, {
			version: SEO_ADMIN_MODULES_STORAGE_VERSION, updatedAt, values: validation.values,
		} satisfies StoredSeoAdminModules);
	} catch {
		return { success: false, errors: { _form: MODULES_UNCONFIRMED } };
	}
	if (!written.applied) {
		return { success: false, conflict: true, errors: { _form: "Feature controls changed before the save. Nothing was overwritten." } };
	}
	return { success: true, modules: await buildAdminModuleConfiguration(ctx, {
		values: validation.values, updatedAt, revision: written.revision, writable: true,
	}) };
}

async function resetAdminModules(ctx: PluginContext, input: unknown): Promise<SeoAdminModulesSaveResult> {
	const guard = moduleWriteRevision(input);
	if (!guard.ok) return { success: false, errors: { _form: MODULES_REVISION_REQUIRED } };
	const before = await readAdminModuleWriteSnapshot(ctx);
	if (!before.writable) return { success: false, errors: { _form: MODULES_UNGUARDED } };
	if (before.revision !== guard.expectedRevision) {
		return { success: false, conflict: true, errors: { _form: "Feature controls changed after you opened them. Nothing was restored." } };
	}
	// Without the snapshot the flag falls back to its legacy key, then the default.
	if (!sitemapModuleControllable(ctx)) {
		const sitemapDefault = SEO_MODULES.find((definition) => definition.key === "sitemap")!.defaultEnabled;
		const inherited = (await ctx.kv.get<boolean>("module:sitemap")) ?? sitemapDefault;
		if (before.values.sitemap !== inherited) {
			return { success: false, errors: { sitemap: SITEMAP_MODULE_LOCKED } };
		}
	}
	if (guard.expectedRevision === null) return { success: true, modules: await buildAdminModuleConfiguration(ctx) };
	let applied: boolean;
	try { applied = await deleteSchemaConditional(schemaConditionalStore(ctx.kv)!, MODULES_SETTINGS_KEY, guard.expectedRevision); }
	catch { return { success: false, errors: { _form: MODULES_UNCONFIRMED } }; }
	if (!applied) {
		return { success: false, conflict: true, errors: { _form: "Feature controls changed before the restore. Nothing was removed." } };
	}
	return { success: true, modules: await buildAdminModuleConfiguration(ctx) };
}

async function resetAdminSchemaPresets(ctx: PluginContext, input: unknown): Promise<SeoAdminSchemaPresetsSaveResult> {
	const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
	if (!source || !validSchemaWriteRevision(source.expectedRevision)) return presetWriteFailure("invalid_input", "Send the preset revision shown in the restore review.");
	const before = await readAdminPresetWriteSnapshot(ctx);
	if (!before.writable || before.record === "unavailable") return presetWriteFailure("unavailable", "Preset storage could not be read safely. Nothing was changed.");
	if (before.revision !== source.expectedRevision) return presetWriteFailure("conflict", "Presets changed after the restore review. Nothing was removed.", undefined, await buildAdminSchemaPresetConfiguration(ctx, before));
	let applied: boolean;
	try { applied = await deleteSchemaConditional(schemaConditionalStore(ctx.kv)!, SCHEMA_PRESETS_SETTINGS_KEY, source.expectedRevision); }
	catch { return presetWriteFailure("unconfirmed", "The restore could not be confirmed. Read the saved choices before another attempt."); }
	if (!applied) return presetWriteFailure("conflict", "Presets changed before the restore. Nothing was removed.");
	const inherited = await readInheritedAdminSchemaPresets(ctx);
	return { success: true, changed: true, presets: await buildAdminSchemaPresetConfiguration(ctx, {
		...inherited, revision: null, record: "absent", writable: true,
	}) };
}

const schemaContentTypeValuesInput = z
	.record(z.string().max(64), z.string().max(32))
	.refine((values) => Object.keys(values).length <= 100, "Map at most 100 content types.");

function schemaContentTypesHost(ctx: PluginContext): SchemaContentTypesHost {
	return {
		kv: ctx.kv,
		discover: async () => {
			const source = await resolveContentCollectionSource(ctx);
			return {
				available: source.available,
				definitions: source.definitions.map((definition) => ({
					collection: definition.collection,
					label: definition.label,
				})),
			};
		},
		now: () => new Date().toISOString(),
	};
}

// The business identity commands over this host. Site facts are read once per
// command; custom records come from the bounded reader that refuses past 500.
function businessIdentityHost(ctx: PluginContext): BusinessIdentityHost {
	let site: Promise<{ legacy: BusinessIdentityLegacySettings; global: GlobalSeoSettings }> | null = null;
	const siteFacts = () => (site ??= (async () => {
		const values = (await readAdminSettings(ctx)).values;
		const global = await getGlobalSettings(ctx, undefined, values);
		return {
			global,
			legacy: {
				siteName: global.siteName,
				siteUrl: global.siteUrl,
				publisherType: values.publisherType === "person" ? "person" : "organization",
				organizationName: values.organizationName,
				organizationLogo: values.organizationLogo,
				personName: values.personName ?? "",
				socialProfiles: [...values.socialProfiles],
				personProfiles: [...values.personProfiles],
			},
		};
	})());
	const collections = async () => {
		const source = await resolveContentCollectionSource(ctx);
		return { available: source.available, definitions: source.definitions };
	};
	return {
		store: businessIdentityStoreFor(ctx as unknown as { settings?: unknown; kv?: unknown }),
		readPublisherOwnership: () => readPublisherOwnership(ctx.kv),
		readSettings: async () => (await siteFacts()).legacy,
		readSwitches: async () => {
			const [modules, presets] = await Promise.all([getModules(ctx), getPresets(ctx)]);
			return { moduleEnabled: modules.schema, presetEnabled: presets.organization, localBusinessPreset: presets.localBusiness };
		},
		listCollections: async () => {
			const source = await collections();
			return {
				available: source.available,
				collections: source.definitions.map((definition) => ({ collection: definition.collection, label: definition.label })),
			};
		},
		listTargetCandidates: async (collection, limit, cursor) => {
			const definition = (await collections()).definitions.find((item) => item.collection === collection);
			if (!definition || !ctx.content) throw new Error("Select an available content type.");
			const page = await ctx.content.list(collection, {
				limit,
				...(cursor ? { cursor } : {}),
				where: { status: "published" },
				orderBy: { updatedAt: "desc" },
			});
			if (page.items.length > limit || (page.hasMore && (!page.cursor || page.cursor === cursor || !page.items.length)))
				throw new Error("Content pagination did not advance within its limit.");
			const items = [];
			for (const item of page.items as any[]) {
				if (!contentItemIsPublished(item)) continue;
				items.push({
					entryId: String(item.id),
					title: contentItemTitle(item, definition.titleField),
					locale: typeof item.locale === "string" ? item.locale : null,
					slug: typeof item.slug === "string" ? item.slug : null,
					url: await publicUrlForContent(ctx, collection, item),
				});
			}
			return { items, ...(page.hasMore && page.cursor ? { cursor: page.cursor } : {}) };
		},
		resolveTarget: async (target: BusinessIdentityTarget): Promise<BusinessIdentityTargetResolution> => {
			const { global } = await siteFacts();
			if (target.kind === "home") {
				if (!isHttpUrl(global.siteUrl)) return { status: "no_url" };
				const root = `${new URL(global.siteUrl).origin}/`;
				return {
					status: "ok",
					url: root,
					title: "Homepage",
					locale: null,
					slug: null,
					vars: Object.fromEntries(TEMPLATE_VARS.map((key) => [key, key === "canonical" ? root : ""])),
				};
			}
			const source = await collections();
			if (!source.available || !ctx.content) return { status: "unavailable" };
			const definition = source.definitions.find((item) => item.collection === target.collection);
			if (!definition) return { status: "missing" };
			let item: any;
			try {
				item = await ctx.content.get(target.collection, target.entryId);
			} catch {
				return { status: "unavailable" };
			}
			if (!item || String(item.id) !== target.entryId) return { status: "missing" };
			if (!contentItemIsPublished(item)) return { status: "unpublished" };
			const url = await publicUrlForContent(ctx, target.collection, item);
			if (!isHttpUrl(url)) return { status: "no_url" };
			const effective = await resolveEffectiveContentMetadata(ctx, target.collection, item);
			return {
				status: "ok",
				url,
				title: contentItemTitle(item, definition.titleField),
				locale: typeof item.locale === "string" ? item.locale : null,
				slug: typeof item.slug === "string" ? item.slug : null,
				vars: effective.vars,
				data: item.data,
			};
		},
		resolveEntryVars: async (collection, identifier) => {
			const source = await collections();
			if (!source.available || !ctx.content) return { status: "unavailable" };
			if (!source.definitions.some((item) => item.collection === collection)) return { status: "none" };
			let item: any;
			try {
				item = await ctx.content.get(collection, identifier);
			} catch {
				return { status: "unavailable" };
			}
			if (!item || String(item.id) !== identifier) return { status: "missing" };
			return { status: "ok", vars: (await resolveEffectiveContentMetadata(ctx, collection, item)).vars };
		},
		readAllCustomSchemas: async () =>
			[...(await readAllRawCustomSchemas(ctx)).entries()].map(([id, value]) => ({
				id,
				name: typeof value.name === "string" ? value.name : id,
				scope: typeof value.scope === "string" ? value.scope : "",
				json: typeof value.json === "string" ? value.json : "",
				enabled: value.enabled === true,
				target: value.target ?? null,
			})),
		targetLocalBusinessNode: (resolution, target) => {
			if (target.kind !== "content") return null;
			const page = {
				url: resolution.url,
				path: "",
				locale: resolution.locale,
				kind: "content",
				canonical: resolution.url,
				content: { collection: target.collection, id: target.entryId, slug: resolution.slug },
			} as unknown as PublicPageContext;
			// Only name, telephone and street are compared, and none depends on site settings.
			return localBusinessSchema(page, { siteName: "", siteUrl: resolution.url, orgName: "", orgLogo: "", sameAs: [], defaultOgImage: "", twitterHandle: "" }, resolution.data);
		},
		now: () => new Date().toISOString(),
	};
}

/** Whether the legacy publisher fields are read-only: an active, invalid or unreadable identity owns the publisher. */
async function legacyPublisherLocked(ctx: PluginContext): Promise<boolean> {
	const state = await readBusinessIdentityStored(businessIdentityStoreFor(ctx as unknown as { settings?: unknown; kv?: unknown }));
	return state.state === "valid" ? state.record.active : state.state !== "absent";
}

// A non-atomic read before the settings write: a racing activation can let one
// legacy edit through, which only changes the inactive fallback.
async function legacyPublisherGuard(
	ctx: PluginContext,
	values: SeoAdminSettingsValues,
	current: SeoAdminSettingsValues,
): Promise<SeoAdminSettingsSaveResult | null> {
	if (!(await legacyPublisherLocked(ctx))) return null;
	const changed = BUSINESS_IDENTITY_LEGACY_PUBLISHER_FIELDS.filter(
		(field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(values[field] ?? null),
	);
	if (!changed.length) return null;
	const message = "The business identity is active or cannot be read, so these publisher fields are used only when it is inactive and cannot be changed now.";
	return {
		success: false,
		errors: { _form: message, ...Object.fromEntries(changed.map((field) => [field, message])) },
	};
}

/**
 * While an identity is active, an enabled custom schema may reference its ID
 * but not define it. One identity read per save, plus the selected page and
 * the record's own entry when an ID depends on page variables; anything that
 * cannot be checked is refused rather than assumed clean.
 */
async function businessIdentityCustomConflict(
	ctx: PluginContext,
	parsed: unknown,
	record: { scope: string; target?: { collection: string; entryId: string; locale: string | null } | null },
): Promise<{ field: "json" | "_form"; message: string } | null> {
	// A saved opt-out means Shipit adds no publisher that could collide. An
	// unreadable ownership record is not an opt-out, so the check still runs.
	if (publisherOwnershipOptedOut(await readPublisherOwnership(ctx.kv))) return null;
	const state = await readBusinessIdentityStored(businessIdentityStoreFor(ctx as unknown as { settings?: unknown; kv?: unknown }));
	if (state.state === "read_unavailable" && state.reason === "failed") {
		return { field: "_form", message: "The business identity could not be read, so this schema was not saved. Try again." };
	}
	if (state.state !== "valid" || !state.record.active) return null;
	const host = businessIdentityHost(ctx);
	const scan = await customRecordOwnedIds(host, {
		record: { id: "", name: "", json: "", enabled: true, scope: record.scope, target: record.target ?? null },
		parsed,
		owned: businessIdentityOwnedIds(state.record.entityId),
		settings: await host.readSettings(),
		identityTarget: state.record.target,
		state: { lookups: 0 },
	});
	if ("incomplete" in scan) {
		return { field: "json", message: `${scan.incomplete} Save it turned off, scope it to an entry ID or simplify its @id.` };
	}
	if (scan.ids.length) {
		return {
			field: "json",
			message: `This schema defines ${scan.ids[0]}, which belongs to the business identity. Reference it as {"@id": "${state.record.entityId}"} instead, or save the schema turned off.`,
		};
	}
	return null;
}

/**
 * Custom schema rows that apply to the whole site: scope `global`, empty or
 * missing, as the public reader treats them. Indexed scope queries only, at
 * most `limit + 1` rows; a read that fails or does not advance throws.
 */
async function readGlobalCustomSchemaRecords(ctx: PluginContext, limit: number): Promise<BusinessIdentityCustomRecord[]> {
	const records = new Map<string, BusinessIdentityCustomRecord>();
	for (const where of [{ scope: { in: ["global", ""] } }, { scope: null }]) {
		let cursor: string | undefined;
		const seenCursors = new Set<string>();
		while (records.size <= limit) {
			const result = await ctx.storage.schemas.query({
				where: where as any,
				limit: Math.min(100, limit + 1 - records.size),
				...(cursor ? { cursor } : {}),
			});
			for (const item of result.items ?? []) {
				const id = String((item as any).id ?? "").trim();
				const normalized = id ? publicCustomSchema(id, (item as any).data ?? item) : null;
				if (!normalized) throw new Error("A malformed custom schema record cannot be checked.");
				records.set(id, {
					id,
					name: normalized.name,
					scope: normalized.scope,
					json: normalized.json,
					enabled: normalized.enabled,
					target: normalized.target ?? null,
				});
			}
			if (!result.hasMore) break;
			const nextCursor = typeof result.cursor === "string" ? result.cursor : "";
			if (!nextCursor || seenCursors.has(nextCursor)) throw new Error("Custom schema pagination did not advance.");
			seenCursors.add(nextCursor);
			cursor = nextCursor;
		}
		if (records.size > limit) break;
	}
	return [...records.values()];
}

function publisherOwnershipHost(ctx: PluginContext): PublisherOwnershipHost {
	return {
		kv: ctx.kv as unknown as PublisherOwnershipHost["kv"],
		readSite: async () => {
			const values = (await readAdminSettings(ctx)).values;
			const global = await getGlobalSettings(ctx, undefined, values);
			return { siteName: global.siteName, siteUrl: global.siteUrl, publisherType: values.publisherType === "person" ? "person" : "organization" };
		},
		readIdentity: () => readBusinessIdentityRenderState(businessIdentityStoreFor(ctx as unknown as { settings?: unknown; kv?: unknown })),
		readGlobalCustomSchemas: (limit) => readGlobalCustomSchemaRecords(ctx, limit),
		readGates: async () => {
			const [modules, presets] = await Promise.all([getModules(ctx), getPresets(ctx)]);
			return { schemaModule: modules.schema, sitePublisherPreset: presets.organization };
		},
	};
}

async function buildAdminSchemaContentTypeConfiguration(ctx: PluginContext): Promise<SeoAdminSchemaContentTypeConfiguration> {
	return buildSchemaContentTypeConfiguration(schemaContentTypesHost(ctx));
}

// Portability import only. Editors write through the revision-checked commands.
async function writeSchemaContentTypeRoles(
	ctx: PluginContext,
	values: SeoAdminSchemaContentTypeValues,
): Promise<string> {
	const updatedAt = new Date().toISOString();
	await ctx.kv.set(SCHEMA_CONTENT_TYPES_SETTINGS_KEY, {
		version: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
		updatedAt,
		values,
	} satisfies StoredSeoAdminSchemaContentTypes);
	return updatedAt;
}

async function getPresets(ctx: PluginContext): Promise<SeoAdminSchemaPresetValues> {
	return (await readAdminSchemaPresets(ctx)).values;
}

function metadataTemplatesHost(ctx: PluginContext): MetadataTemplatesHost {
	return {
		kv: ctx.kv as any,
		targets: () => templateTargetCollections(ctx),
		now: () => Date.now(),
	};
}

// Template targets share discovery's visibility and routing constraints.
function templateTargetDefinitions(discovery: ContentCollectionResolution): SeoContentCollectionDefinition[] | null {
	return discovery.available ? discovery.definitions : null;
}

async function templateTargetCollections(ctx: PluginContext): Promise<string[] | null> {
	return templateTargetDefinitions(await resolveContentCollectionSource(ctx))?.map((definition) => definition.collection) ?? null;
}

/**
 * The Templates view's authoritative read: record state and KV revision, then
 * each visible target's values in effect and the values it inherits. Legacy
 * keys are read for visible targets only. An unreadable record lists nothing
 * and is never replaced here.
 */
async function buildAdminTemplateConfiguration(ctx: PluginContext): Promise<SeoAdminTemplateConfiguration> {
	const discovery = await resolveContentCollectionSource(ctx);
	const snapshot = await readMetadataTemplates(ctx.kv as any);
	const base = {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		storageVersion: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		state: snapshot.state,
		revision: snapshot.revision,
		discovery: discovery.available ? "available" as const : "unavailable" as const,
		allowedVariables: [...TEMPLATE_VARS],
		outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
	};
	if (snapshot.state === "corrupt" || snapshot.state === "unavailable" || !discovery.available) {
		return { ...base, retainedCollections: [], items: [] };
	}
	const definitions = templateTargetDefinitions(discovery) ?? [];
	const overrides = snapshot.state === "saved" ? snapshot.record.values : {};
	const visible = new Set(definitions.map((definition) => definition.collection));
	const legacyRevisions = snapshot.state === "absent" ? (await observeLegacyRevisions(ctx.kv as any)).revision : undefined;
	const items: SeoAdminTemplateConfiguration["items"] = [];
	for (const definition of definitions) {
		const observation = await observeLegacyTemplate(ctx.kv as any, definition.collection);
		const inherited = inheritedMetadataTemplate(definition.collection, observation.fields);
		const override = overrides[definition.collection];
		items.push({
			collection: definition.collection,
			label: definition.label,
			description: contentCollectionDescription(definition),
			source: override ? "override" : inherited.source,
			values: { ...(override ?? inherited.values) },
			inheritanceGuard: {
				fields: { ...observation.guard.fields },
				...(legacyRevisions !== undefined ? { revisions: legacyRevisions } : {}),
			},
			inherited: {
				source: inherited.source,
				values: { ...inherited.values },
				ignoredLegacyFields: [...inherited.ignoredLegacyFields],
			},
		});
	}
	return {
		...base,
		retainedCollections: Object.keys(overrides).filter((collection) => !visible.has(collection)).sort(),
		items,
	};
}

async function boundedAdminTemplateConfiguration(ctx: PluginContext): Promise<SeoAdminTemplateConfiguration> {
	const configuration = await buildAdminTemplateConfiguration(ctx);
	if (templateRouteWireBytes(configuration, SEO_ADMIN_TEMPLATE_CONFIGURATION_RESPONSE_MAX_BYTES) === null) {
		throw new Error("The template configuration is too large to show.");
	}
	return configuration;
}

/**
 * A committed command never becomes an error because the read after it
 * failed; the editor then reads again.
 */
async function adminTemplateCommandResult(
	ctx: PluginContext,
	result: MetadataTemplateCommandResult,
): Promise<SeoAdminTemplatesSaveResult> {
	const readAfter = async () => {
		try {
			return await boundedAdminTemplateConfiguration(ctx);
		} catch {
			return null;
		}
	};
	if (result.success) {
		return {
			success: true,
			outcome: result.changed ? "saved" : "unchanged",
			collection: result.collection,
			templates: await readAfter(),
		};
	}
	if (result.error === "invalid_values") return result;
	if (result.error === "conflict") return { success: false, error: "conflict", message: result.message, templates: await readAfter() };
	return { success: false, error: result.error, message: result.message };
}

async function listAdminCustomSchemas(
	ctx: PluginContext,
	limit = 100,
): Promise<{ items: SeoAdminCustomSchema[]; hasMore: boolean }> {
	try {
		const result = await ctx.storage.schemas.query({
			orderBy: { createdAt: "desc" },
			limit,
		});
		const items: SeoAdminCustomSchema[] = [];
		for (const item of result.items ?? []) {
			const id = String((item as any).id ?? "").trim();
			const normalized = id ? publicCustomSchema(id, (item as any).data ?? item) : null;
			if (normalized) items.push(normalized);
			else ctx.log.warn("seo: skipping malformed custom schema record", { id });
		}
		return { items, hasMore: Boolean(result.hasMore) };
	} catch (error: unknown) {
		ctx.log.warn("seo: failed to list custom schemas", {
			error: String(error),
		});
		return { items: [], hasMore: false };
	}
}

function customSchemaScopesOverlap(left: string, right: string): boolean {
	if (left === "global" || right === "global") return true;
	if (left === right) return true;
	const [leftCollection, leftEntry] = left.split(":", 2);
	const [rightCollection, rightEntry] = right.split(":", 2);
	if (leftCollection !== rightCollection) return false;
	return !leftEntry || !rightEntry;
}

async function customSchemaIdentityConflict(
	ctx: PluginContext,
	input: { id?: string; name: string; scope: string; enabled: boolean },
	parsed: unknown,
): Promise<string | null> {
	if (!input.enabled) return null;
	const identities = new Set(schemaDefinitionIdentities(parsed));
	if (!identities.size) return null;

	let cursor: string | undefined;
	for (let page = 0; page < 20; page += 1) {
		const result = await ctx.storage.schemas.query({
			limit: 500,
			...(cursor ? { cursor } : {}),
		});
		for (const item of result.items ?? []) {
			const id = String((item as any).id ?? "").trim();
			if (!id || id === input.id) continue;
			const schema = publicCustomSchema(id, (item as any).data ?? item);
			if (
				!schema?.enabled ||
				!schema.valid ||
				!customSchemaScopesOverlap(input.scope, schema.scope)
			)
				continue;
			try {
				const existing = validateCustomJsonLd(schema.json);
				const duplicate = schemaDefinitionIdentities(existing).find((entityId) =>
					identities.has(entityId),
				);
				if (duplicate) {
					return `Entity @id ${duplicate} is already defined by enabled schema "${schema.name}" in overlapping scope ${schema.scope}.`;
				}
			} catch {
				// Invalid stored records are surfaced in the list and skipped at runtime.
			}
		}
		if (!result.hasMore) return null;
		if (!result.cursor || result.cursor === cursor) {
			return "Could not verify schema entity identities across all stored schemas.";
		}
		cursor = result.cursor;
	}
	return "Could not verify schema entity identities across all stored schemas.";
}

const ADMIN_SCHEMA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function customSchemaWriteFailure(
	error: SeoAdminSchemaCommandError, message: string,
	errors: Record<string, string> = { _form: message }, current?: SeoAdminCustomSchemaSnapshot | null,
): Extract<SeoAdminCustomSchemaSaveResult, { success: false }> {
	return { success: false, error, message, errors, ...(current !== undefined ? { current } : {}) };
}

function customSchemaSnapshot(id: string, stored: SchemaVersionedValue): SeoAdminCustomSchemaSnapshot | null {
	const raw = stored.value as Partial<StoredCustomSchema> | null;
	if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
		(raw.storageVersion !== undefined && raw.storageVersion !== SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION) ||
		typeof raw.name !== "string" || typeof raw.scope !== "string" || typeof raw.json !== "string" ||
		typeof raw.enabled !== "boolean" || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string" ||
		!parseStoredEntrySchemaTarget(raw.target, raw.scope).ok) return null;
	const schema = publicCustomSchema(id, stored.value);
	return schema ? { ...schema, revision: stored.revision } : null;
}

async function readAdminCustomSchema(ctx: PluginContext, idInput: unknown): Promise<SeoAdminCustomSchemaReadResult> {
	const id = typeof idInput === "string" ? idInput : "";
	if (!ADMIN_SCHEMA_ID_PATTERN.test(id)) return { success: false, error: "invalid_input", message: "Choose one stored schema." };
	const store = schemaConditionalStore(ctx.storage.schemas);
	if (!store) return { success: false, error: "unavailable", message: "Revision-checked schema storage is unavailable." };
	try {
		const stored = await readSchemaVersioned(store, id);
		if (!stored) return { success: true, id, state: "absent", schema: null };
		const schema = customSchemaSnapshot(id, stored);
		return schema ? { success: true, id, state: "saved", schema } : { success: true, id, state: "invalid", schema: null, revision: stored.revision };
	} catch { return { success: false, error: "unavailable", message: "The exact saved schema could not be read." }; }
}

async function saveAdminCustomSchema(ctx: PluginContext, input: unknown): Promise<SeoAdminCustomSchemaSaveResult> {
	const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
	if (!source || typeof source.id !== "string" || !ADMIN_SCHEMA_ID_PATTERN.test(source.id) ||
		!Object.hasOwn(source, "expectedRevision") || !(source.expectedRevision === null || validSchemaWriteRevision(source.expectedRevision))) {
		return customSchemaWriteFailure("invalid_input", "Send a stable schema ID and the revision you reviewed.");
	}
	const validation = validateSeoAdminCustomSchemaInput(source);
	if (!validation.success) return customSchemaWriteFailure("invalid_values", "Review the schema fields.", validation.errors as Record<string, string>);
	const store = schemaConditionalStore(ctx.storage.schemas);
	if (!store) return customSchemaWriteFailure("unavailable", "Revision-checked schema storage is unavailable. Nothing was changed.");
	const id = source.id;
	const creating = source.expectedRevision === null;
	let stored: SchemaVersionedValue | null;
	try { stored = await readSchemaVersioned(store, id); }
	catch { return customSchemaWriteFailure("unavailable", "The saved schema could not be read. Nothing was changed."); }
	const current = stored ? customSchemaSnapshot(id, stored) : null;
	if (creating && stored) return customSchemaWriteFailure("conflict", "This ID is already stored. Read it before choosing another action.", undefined, current);
	if (!creating && !stored) return customSchemaWriteFailure("not_found", "This schema was removed elsewhere. Your draft is kept.", undefined, null);
	if (stored && stored.revision !== source.expectedRevision) return customSchemaWriteFailure("conflict", "This schema changed after you opened it. Nothing was overwritten.", undefined, current);
	if (stored && !current) return customSchemaWriteFailure("invalid_record", "The stored schema cannot be edited safely. Its data was preserved.");
	let parsed: Record<string, unknown> | unknown[];
	try { parsed = validateCustomJsonLd(validation.values.json); }
	catch (cause) { return customSchemaWriteFailure("invalid_values", "Review the JSON-LD.", { json: cause instanceof Error ? cause.message : "JSON-LD validation failed." }); }
	const existing = stored?.value as StoredCustomSchema | undefined;
	if (existing?.target !== undefined && validation.values.scope !== existing.scope)
		return customSchemaWriteFailure("invalid_values", "This schema belongs to one exact entry.", { scope: "Remove it from that entry's editor before changing its scope." });
	let conflict: string | null;
	try { conflict = await customSchemaIdentityConflict(ctx, validation.values, parsed); }
	catch { return customSchemaWriteFailure("unavailable", "Schema identities could not be checked. Nothing was changed."); }
	if (conflict) return customSchemaWriteFailure("invalid_values", "Review the JSON-LD entity IDs.", { json: conflict });
	if (validation.values.enabled) {
		const owned = await businessIdentityCustomConflict(ctx, parsed, { scope: validation.values.scope, target: existing?.target ?? null });
		if (owned) return customSchemaWriteFailure(owned.field === "_form" ? "unavailable" : "invalid_values", owned.message, { [owned.field]: owned.message });
	}
	if (creating) {
		try {
			if (await ctx.storage.schemas.count() >= 500) return customSchemaWriteFailure("limit_reached", "Custom schemas are limited to 500 records.");
		} catch { return customSchemaWriteFailure("unavailable", "Custom schema capacity could not be checked. Nothing was changed."); }
	}
	if (current && portabilityValueEquals(
		{ name: current.name, scope: current.scope, json: current.json, enabled: current.enabled },
		{ name: validation.values.name, scope: validation.values.scope, json: validation.values.json, enabled: validation.values.enabled },
	)) return { success: true, changed: false, schema: current };
	const now = new Date().toISOString();
	const record: StoredCustomSchema = {
		storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION, name: validation.values.name, scope: validation.values.scope,
		json: validation.values.json, enabled: validation.values.enabled, createdAt: existing?.createdAt ?? now, updatedAt: now,
		...(existing?.target !== undefined ? { target: existing.target } : {}),
	};
	let written: Awaited<ReturnType<typeof writeSchemaConditional>>;
	try { written = await writeSchemaConditional(store, id, source.expectedRevision as string | null, record); }
	catch { return customSchemaWriteFailure("unconfirmed", "The save could not be confirmed. Read this exact schema before another attempt."); }
	if (!written.applied) return customSchemaWriteFailure("conflict", "This schema changed before the save. Nothing was overwritten.");
	if (creating) {
		let overLimit = false;
		try { overLimit = await ctx.storage.schemas.count() > 500; }
		catch { overLimit = true; }
		if (overLimit) {
			try {
				const removed = await deleteSchemaConditional(store, id, written.revision);
				return customSchemaWriteFailure(removed ? "limit_reached" : "conflict", removed
					? "Custom schema capacity could not be verified within 500 records. This create was rolled back."
					: "This create changed before capacity cleanup. The newer record was preserved; review it.");
			} catch { return customSchemaWriteFailure("unconfirmed", "Schema capacity cleanup could not be confirmed. Read this exact schema before another attempt."); }
		}
	}
	return { success: true, changed: true, schema: { ...publicCustomSchema(id, record)!, revision: written.revision } };
}

async function saveAdminComposedSchema(ctx: PluginContext, input: unknown): Promise<SeoAdminSchemaComposerSaveResult> {
	const composed = composeSeoSchema(input);
	if (!composed.success) return customSchemaWriteFailure("invalid_values", "Review the guided schema fields.", Object.fromEntries(Object.entries(composed.errors).filter((item): item is [string, string] => typeof item[1] === "string")));
	const source = input as Record<string, unknown>;
	const saved = await saveAdminCustomSchema(ctx, {
		id: source.id, expectedRevision: source.expectedRevision, name: composed.output.schemaName,
		scope: composed.output.scope, json: composed.output.json, enabled: composed.output.enabled,
	});
	if (!saved.success) return saved;
	return { success: true, changed: saved.changed, schema: saved.schema, recipe: composed.output.recipe, json: composed.output.json };
}

async function deleteAdminCustomSchema(ctx: PluginContext, input: unknown): Promise<SeoAdminCustomSchemaDeleteResult> {
	const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
	const id = typeof source?.id === "string" ? source.id : "";
	if (!source || !ADMIN_SCHEMA_ID_PATTERN.test(id) || !validSchemaWriteRevision(source.expectedRevision))
		return customSchemaWriteFailure("invalid_input", "Send the exact schema ID and revision shown in the delete review.");
	const store = schemaConditionalStore(ctx.storage.schemas);
	if (!store) return customSchemaWriteFailure("unavailable", "Revision-checked schema storage is unavailable. Nothing was removed.");
	let stored: SchemaVersionedValue | null;
	try { stored = await readSchemaVersioned(store, id); }
	catch { return customSchemaWriteFailure("unavailable", "The exact schema could not be read. Nothing was removed."); }
	if (!stored) return customSchemaWriteFailure("not_found", "This schema is absent now.", undefined, null);
	const current = customSchemaSnapshot(id, stored);
	if (stored.revision !== source.expectedRevision) return customSchemaWriteFailure("conflict", "This schema changed after the delete review. Nothing was removed.", undefined, current);
	let applied: boolean;
	try { applied = await deleteSchemaConditional(store, id, source.expectedRevision); }
	catch { return customSchemaWriteFailure("unconfirmed", "The removal could not be confirmed. Read this exact ID before another attempt."); }
	if (!applied) return customSchemaWriteFailure("conflict", "This schema changed before removal. Nothing was removed.");
	return { success: true, id };
}

// JSON escaping uses at most six bytes per UTF-16 code unit; the remainder
// bounds the other validated fields and the command envelope. The current
// composer recipes total at most 92,288 normalized UTF-16 code units.
const ADMIN_SCHEMA_WRITE_REQUEST_MAX_BYTES = 100_000 * 6 + 8_192;
const adminSchemaIdInput = z.string().regex(ADMIN_SCHEMA_ID_PATTERN);
const adminSchemaRevisionInput = z.string().min(1).max(256);
const adminCustomSchemaWriteInput = z.object({
	id: adminSchemaIdInput,
	expectedRevision: adminSchemaRevisionInput.nullable(),
	name: z.string().max(240),
	scope: z.string().max(256),
	json: z.string().max(100_000),
	enabled: z.boolean(),
}).strict();
const adminCustomSchemaDeleteInput = z.object({
	id: adminSchemaIdInput,
	expectedRevision: adminSchemaRevisionInput,
}).strict();
const adminComposedSchemaWriteInput = z.object({
	id: adminSchemaIdInput,
	expectedRevision: adminSchemaRevisionInput.nullable(),
	recipe: z.string().max(64),
	schemaName: z.string().max(240),
	scope: z.string().max(256),
	enabled: z.boolean(),
	values: z.record(z.string().max(80), z.unknown())
		.refine((values) => Object.keys(values).length <= 100),
}).strict();
const adminSchemaPresetsWriteInput = z.object({
	values: z.record(z.string().max(64), z.boolean())
		.refine((values) => Object.keys(values).length <= SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.length),
	expectedRevision: adminSchemaRevisionInput.nullable(),
	replaceInvalid: z.literal(true).optional(),
}).strict();

const entrySchemaRefInput = z.object({
	collection: z.string().max(64),
	entryId: z.string().max(120),
	locale: z.string().max(40).nullable().optional(),
}).strict();

const entrySchemaCandidateInput = entrySchemaRefInput.extend({
	requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
	id: z.string().max(128),
	expectedRevision: z.string().max(256).nullable(),
	name: z.string().max(ENTRY_SCHEMA_NAME_MAX_LENGTH * 2),
	json: z.string().max(65_536),
	enabled: z.boolean(),
	snapshot: SAVED_CONTENT_SNAPSHOT_SCHEMA.optional(),
}).strict();

async function withEntrySchemaHost<T>(
	ctx: PluginContext,
	command: (host: EntrySchemaHost) => Promise<T>,
): Promise<T | { success: false; error: "storage_unavailable"; message: string }> {
	const host = emdashEntrySchemaHost(ctx, {
		hasCollection: async (collection) => Boolean(await resolveContentCollection(ctx, collection)),
		schemaOutputEnabled: async () => (await getModules(ctx)).schema,
		businessIdentityConflict: async (parsed, scope, target) => {
			const conflict = await businessIdentityCustomConflict(ctx, parsed, { scope, target });
			return conflict ? { unavailable: conflict.field === "_form", message: conflict.message } : null;
		},
	});
	if (!host) {
		return {
			success: false,
			error: "storage_unavailable",
			message: "This EmDash version does not provide the content reads and versioned storage these schemas need.",
		};
	}
	return command(host);
}

async function buildAdminConfiguration(
	ctx: PluginContext,
	customSchemaLimit = 100,
): Promise<SeoAdminConfiguration> {
	const customSchemas = await listAdminCustomSchemas(ctx, customSchemaLimit);
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		configurationVersion: SEO_ADMIN_CONFIGURATION_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		modules: await buildAdminModuleConfiguration(ctx),
		schema: {
			contentTypes: await buildAdminSchemaContentTypeConfiguration(ctx),
			presets: await buildAdminSchemaPresetConfiguration(ctx),
			customSchemaStorageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
			customSchemas: customSchemas.items,
			hasMore: customSchemas.hasMore,
		},
	};
}

interface SeoPortabilityRuntimeSnapshot {
	state: SeoPortabilityState;
	rawSchemas: Map<string, StoredCustomSchema>;
	/** The IndexNow write is conditional on this, so a key rotated mid-import is kept. */
	indexNowUpdatedAt: string | null;
}

const PORTABILITY_KV_KEYS = [
	GLOBAL_SETTINGS_KEY,
	SITEMAP_SETTINGS_KEY,
	MODULES_SETTINGS_KEY,
	SCHEMA_PRESETS_SETTINGS_KEY,
	LEGACY_SCHEMA_PRESETS_SETTINGS_KEY,
	TEMPLATES_SETTINGS_KEY,
	SCHEMA_CONTENT_TYPES_SETTINGS_KEY,
	INDEXNOW_SETTINGS_STORAGE_KEY,
	"settings:siteName",
	"settings:siteUrl",
	"settings:orgName",
	"settings:orgLogo",
	"settings:sameAs",
	"settings:defaultOgImage",
	"settings:twitterHandle",
	"settings:noindex",
	...SEO_MODULES.map((definition) => `module:${definition.key}`),
	...SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => `preset:${definition.key}`),
	...SEO_ADMIN_TEMPLATE_DEFINITIONS.flatMap((definition) => [
		`tpl:${definition.key}:title`,
		`tpl:${definition.key}:description`,
		`tpl:${definition.key}:socialTitle`,
		`tpl:${definition.key}:socialDescription`,
	]),
] as const;

async function readPublicScopedCustomSchemas(
	ctx: PluginContext,
	scopes: string[],
	entry: EntrySchemaPageEntry | null,
): Promise<SeoAdminCustomSchema[]> {
	const requestedScopes = uniqueStrings(scopes);
	if (!requestedScopes.length) return [];
	const matchingScopes = new Set(requestedScopes);
	const rawSchemas = new Map<string, unknown>();
	let rowsRead = 0;
	let pagesRead = 0;
	let truncated = false;
	// Indexed scope filters cap a public request at 500 matching rows, including disabled records.
	for (const where of [
		{ scope: { in: [...requestedScopes, ""] } },
		{ scope: null },
	]) {
		let cursor: string | undefined;
		const seenCursors = new Set<string>();
		while (rowsRead < 500 && pagesRead < 6) {
			const result = await ctx.storage.schemas.query({
				where,
				limit: Math.min(100, 500 - rowsRead),
				...(cursor ? { cursor } : {}),
			});
			pagesRead += 1;
			rowsRead += result.items?.length ?? 0;
			for (const item of result.items ?? []) {
				const id = String((item as any).id ?? "").trim();
				if (id) rawSchemas.set(id, (item as any).data ?? item);
				else ctx.log.warn("seo: skipping malformed custom schema record", { id });
			}
			if (!result.hasMore) break;
			if (rowsRead >= 500 || pagesRead >= 6) {
				truncated = true;
				break;
			}
			const nextCursor = typeof result.cursor === "string" ? result.cursor : "";
			if (!nextCursor || seenCursors.has(nextCursor))
				throw new Error("Custom schema pagination did not advance.");
			seenCursors.add(nextCursor);
			cursor = nextCursor;
		}
		if (truncated || rowsRead >= 500 || pagesRead >= 6) break;
	}
	if (truncated) ctx.log.warn("seo: matching custom schemas exceed the 500-record runtime cap");
	const items: SeoAdminCustomSchema[] = [];
	for (const [id, value] of rawSchemas) {
		if (!entrySchemaTargetMatches(value, entry)) continue;
		const normalized = publicCustomSchema(id, value);
		if (normalized && matchingScopes.has(normalized.scope)) items.push(normalized);
		else if (!normalized) ctx.log.warn("seo: skipping malformed custom schema record", { id });
	}
	return items.sort(
		(left, right) =>
			right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
	);
}

async function portableAnalysisProfileRows(ctx: PluginContext): Promise<Array<{ key: string; value: unknown }>> {
	const rows = await ctx.kv.list(COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX);
	if (rows.length > 100 || rows.some((row) => !row.key.startsWith(COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX) ||
		!isSeoContentCollectionKey(row.key.slice(COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX.length))))
		throw new Error("The assessment profile configuration exceeds its portable scope or contains an invalid collection.");
	return rows;
}

async function readPortableAnalysisProfiles(ctx: PluginContext): Promise<Record<string, CollectionAnalysisProfileSelection>> {
	const profiles: Record<string, CollectionAnalysisProfileSelection> = {};
	for (const row of await portableAnalysisProfileRows(ctx)) {
		const collection = row.key.slice(COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX.length);
		const profile = await readCollectionAnalysisProfile(ctx, collection);
		if (profile.state !== "configured") throw new Error("Assessment profiles must be readable before export or import.");
		profiles[collection] = { profile: profile.profile, version: profile.version };
	}
	return profiles;
}

async function readSeoPortabilityState(ctx: PluginContext): Promise<SeoPortabilityRuntimeSnapshot> {
	const [settings, sitemap, modules, presets, templates, indexNow, rawSchemas, contentTypeRoles, analysisProfiles] = await Promise.all([
		readSiteSettings(ctx),
		readSitemapPortableValues(ctx),
		readAdminModules(ctx),
		readAdminSchemaPresets(ctx),
		readAdminTemplates(ctx),
		readIndexNowSettings(ctx),
		readAllRawCustomSchemas(ctx),
		readSchemaContentTypeRoles(ctx),
		readPortableAnalysisProfiles(ctx),
	]);
	if (!isReadableSiteSettings(settings)) {
		throw new Error(settings.state === "corrupt"
			? "The stored SEO settings must be restored before export or import."
			: "The SEO settings could not be read. Try the export or import again later.");
	}
	if (contentTypeRoles.invalid) {
		throw new Error("The content type schema mapping must be restored or replaced before export or import.");
	}
	if (templates.state === "corrupt") throw new Error("The stored SEO templates must be restored before export or import.");
	if (templates.state === "unavailable") throw new Error("The SEO templates could not be read. Try the export or import again later.");
	const customSchemas = [];
	for (const [id, raw] of rawSchemas) {
		const schema = publicCustomSchema(id, raw);
		if (!schema?.valid) {
			throw new Error(`Custom schema ${id} must be repaired before export or import.`);
		}
		customSchemas.push({
			id: schema.id,
			name: schema.name,
			scope: schema.scope,
			json: schema.json,
			enabled: schema.enabled,
			...(schema.target ? { target: schema.target } : {}),
		});
	}
	return {
		state: {
			settings: settings.values,
			sitemap: sitemap.values,
			modules: modules.values,
			schemaPresets: presets.values,
			templates: templates.values,
			customSchemas,
			indexNow: indexNow.values,
			schemaContentTypes: contentTypeRoles.values,
			analysisProfiles,
		},
		rawSchemas,
		indexNowUpdatedAt: indexNow.updatedAt,
	};
}

async function capturePortabilityKv(ctx: PluginContext): Promise<Map<string, unknown>> {
	const values = new Map<string, unknown>();
	for (const key of PORTABILITY_KV_KEYS)
		values.set(key, structuredClone(await ctx.kv.get<unknown>(key)));
	for (const row of await portableAnalysisProfileRows(ctx)) values.set(row.key, structuredClone(row.value));
	return values;
}

interface PortabilityWriteExpectations {
	kv: Map<string, unknown>;
	/** Revisions returned by this import's applied conditional writes. */
	kvRevisions: Map<string, string>;
	schemas: Map<string, StoredCustomSchema | null>;
	schemaRevisions: Map<string, string>;
	uncertainKv: Set<string>;
	uncertainSchemas: Set<string>;
}

/** The template record with its KV revision from one versioned read. */
async function captureTemplatesBinding(ctx: PluginContext): Promise<BoundMetadataTemplates> {
	if (typeof ctx.kv.getVersioned !== "function") {
		throw new Error("This EmDash version does not provide revision-checked plugin storage for SEO templates.");
	}
	const stored = await ctx.kv.getVersioned<unknown>(TEMPLATES_SETTINGS_KEY);
	return stored ? { revision: stored.revision, value: structuredClone(stored.value) } : { revision: null, value: null };
}

function portabilityValueEquals(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => portabilityValueEquals(value, right[index]))
		);
	}
	if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord).sort();
	const rightKeys = Object.keys(rightRecord).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] && portabilityValueEquals(leftRecord[key], rightRecord[key]),
		)
	);
}

function portabilityMapEquals(
	left: ReadonlyMap<string, unknown>,
	right: ReadonlyMap<string, unknown>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [key, value] of left) {
		if (!right.has(key) || !portabilityValueEquals(value, right.get(key))) return false;
	}
	return true;
}

class SeoPortabilityStateChangedError extends Error {
	constructor() {
		super("SEO configuration changed while it was being read. Retry from a fresh preview.");
		this.name = "SeoPortabilityStateChangedError";
	}
}

interface StableSeoPortabilitySnapshot {
	current: SeoPortabilityRuntimeSnapshot;
	kv: Map<string, unknown>;
	/** Template writes and their rollback are conditional on this revision. */
	templates: BoundMetadataTemplates;
	schemas: Map<string, SchemaVersionedValue>;
	presets: SchemaVersionedValue | null;
}

async function capturePortabilitySchemaBindings(
	ctx: PluginContext, rows: Map<string, StoredCustomSchema>,
): Promise<Map<string, SchemaVersionedValue>> {
	const store = schemaConditionalStore(ctx.storage.schemas);
	if (!store) throw new Error("Schema import requires revision-checked storage.");
	const bindings = new Map<string, SchemaVersionedValue>();
	for (const [id, value] of rows) {
		const stored = await readSchemaVersioned(store, id);
		if (!stored || !portabilityValueEquals(stored.value, value)) throw new SeoPortabilityStateChangedError();
		bindings.set(id, { value: structuredClone(stored.value), revision: stored.revision });
	}
	return bindings;
}

async function capturePortabilityPresetsBinding(ctx: PluginContext): Promise<SchemaVersionedValue | null> {
	const store = schemaConditionalStore(ctx.kv);
	if (!store) throw new Error("Preset import requires revision-checked storage.");
	return readSchemaVersioned(store, SCHEMA_PRESETS_SETTINGS_KEY);
}

async function readStableSeoPortabilitySnapshot(
	ctx: PluginContext,
	maxAttempts = 2,
): Promise<StableSeoPortabilitySnapshot> {
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const beforeTemplates = await captureTemplatesBinding(ctx);
		const beforePresets = await capturePortabilityPresetsBinding(ctx);
		const beforeSchemas = await capturePortabilitySchemaBindings(ctx, await readAllRawCustomSchemas(ctx));
		const beforeKv = await capturePortabilityKv(ctx);
		const current = await readSeoPortabilityState(ctx);
		const [afterKv, afterSchemas] = await Promise.all([
			capturePortabilityKv(ctx),
			readAllRawCustomSchemas(ctx),
		]);
		const afterTemplates = await captureTemplatesBinding(ctx);
		const afterPresets = await capturePortabilityPresetsBinding(ctx);
		const afterSchemaBindings = await capturePortabilitySchemaBindings(ctx, afterSchemas);
		if (
			portabilityValueEquals(beforePresets, afterPresets) &&
			portabilityValueEquals(afterPresets?.value ?? null, afterKv.get(SCHEMA_PRESETS_SETTINGS_KEY) ?? null) &&
			portabilityMapEquals(beforeSchemas, afterSchemaBindings) &&
			beforeTemplates.revision === afterTemplates.revision &&
			portabilityValueEquals(afterTemplates.value, afterKv.get(TEMPLATES_SETTINGS_KEY) ?? null) &&
			portabilityMapEquals(beforeKv, afterKv) &&
			portabilityMapEquals(current.rawSchemas, afterSchemas)
		) {
			return {
				current: { ...current, rawSchemas: afterSchemas },
				kv: afterKv,
				templates: afterTemplates,
				schemas: afterSchemaBindings,
				presets: afterPresets,
			};
		}
	}
	throw new SeoPortabilityStateChangedError();
}

function portabilityTrackingContext(
	ctx: PluginContext,
	expected: PortabilityWriteExpectations,
	kvSnapshot: Map<string, unknown>,
	schemaBindings: Map<string, SchemaVersionedValue>,
	presetsBinding: SchemaVersionedValue | null,
): PluginContext {
	const trackedKv = new Proxy(ctx.kv, {
		get(target, property, receiver) {
			if (property === "compareAndSet" && typeof target.compareAndSet === "function") {
				return async (key: string, revision: string | null, value: unknown) => {
					if (key.startsWith(COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX)) {
						const before = expected.kv.has(key) ? expected.kv.get(key) : kvSnapshot.get(key) ?? null;
						const current = await target.getVersioned(key);
						if ((current?.revision ?? null) !== revision || !portabilityValueEquals(current?.value ?? null, before))
							throw new Error(`portability_write_conflict:${key}`);
					}
					try {
						const result = await target.compareAndSet(key, revision, value);
						if (result.applied) {
							expected.kv.set(key, structuredClone(value));
							if (typeof result.revision === "string") expected.kvRevisions.set(key, result.revision);
						}
						return result;
					} catch (cause) {
						// A transport error can occur after the conditional write commits.
						// Without its revision we cannot safely claim ownership for rollback.
						expected.uncertainKv.add(key);
						throw cause;
					}
				};
			}
			if (property === "compareAndDelete" && typeof target.compareAndDelete === "function") {
				return async (key: string, revision: string) => {
					const before = expected.kv.has(key) ? expected.kv.get(key) : kvSnapshot.get(key) ?? null;
					const current = await target.getVersioned(key);
					if (current?.revision !== revision || !portabilityValueEquals(current?.value ?? null, before))
						throw new Error(`portability_write_conflict:${key}`);
					try {
						const result = await target.compareAndDelete(key, revision);
						if (result.applied) expected.kv.set(key, null);
						return result;
					} catch (cause) { expected.uncertainKv.add(key); throw cause; }
				};
			}
			if (property === "set") {
				return async (key: string, value: unknown) => {
					if (key === SCHEMA_PRESETS_SETTINGS_KEY) {
						const store = schemaConditionalStore(target);
						if (!store) throw new Error("Preset import requires revision-checked storage.");
						let written: Awaited<ReturnType<typeof writeSchemaConditional>>;
						try {
							written = await writeSchemaConditional(store, key, expected.kvRevisions.get(key) ?? presetsBinding?.revision ?? null, value);
						} catch (cause) { expected.uncertainKv.add(key); throw cause; }
						if (!written.applied) throw new Error(`portability_write_conflict:${key}`);
						expected.kv.set(key, structuredClone(value));
						expected.kvRevisions.set(key, written.revision);
						return;
					}
					const before = expected.kv.has(key) ? expected.kv.get(key) : kvSnapshot.get(key);
					if (!portabilityValueEquals(await target.get(key), before))
						throw new Error(`portability_write_conflict:${key}`);
					expected.kv.set(key, structuredClone(value));
					await target.set(key, value);
				};
			}
			if (property === "delete") {
				return async (key: string) => {
					const before = expected.kv.has(key) ? expected.kv.get(key) : kvSnapshot.get(key);
					if (!portabilityValueEquals(await target.get(key), before))
						throw new Error(`portability_write_conflict:${key}`);
					expected.kv.set(key, null);
					const deleted = await target.delete(key);
					return deleted;
				};
			}
			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const schemaStore = ctx.storage.schemas as any;
	const trackedSchemas = new Proxy(schemaStore, {
		get(target, property, receiver) {
			if (property === "put") {
				return async (id: string, value: StoredCustomSchema) => {
					const store = schemaConditionalStore(target);
					if (!store) throw new Error("Schema import requires revision-checked storage.");
					const revision = expected.schemaRevisions.get(id) ?? schemaBindings.get(id)?.revision ?? null;
					let written: Awaited<ReturnType<typeof writeSchemaConditional>>;
					try { written = await writeSchemaConditional(store, id, revision, value); }
					catch (cause) { expected.uncertainSchemas.add(id); throw cause; }
					if (!written.applied) throw new Error(`portability_write_conflict:schema:${id}`);
					expected.schemas.set(id, structuredClone(value));
					expected.schemaRevisions.set(id, written.revision);
				};
			}
			if (property === "delete") {
				return async (id: string) => {
					const store = schemaConditionalStore(target);
					const revision = expected.schemaRevisions.get(id) ?? schemaBindings.get(id)?.revision;
					if (!store || !revision) throw new Error(`portability_write_conflict:schema:${id}`);
					let deleted: boolean;
					try { deleted = await deleteSchemaConditional(store, id, revision); }
					catch (cause) { expected.uncertainSchemas.add(id); throw cause; }
					if (!deleted) throw new Error(`portability_write_conflict:schema:${id}`);
					expected.schemas.set(id, null);
					expected.schemaRevisions.delete(id);
					return true;
				};
			}
			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return {
		...ctx,
		kv: trackedKv,
		storage: { ...ctx.storage, schemas: trackedSchemas },
	} as PluginContext;
}

async function verifyPortabilityWrites(
	ctx: PluginContext,
	expected: PortabilityWriteExpectations,
): Promise<void> {
	for (const [key, value] of expected.kv) {
		if (key === SCHEMA_PRESETS_SETTINGS_KEY) {
			const store = schemaConditionalStore(ctx.kv);
			const current = store ? await readSchemaVersioned(store, key) : null;
			if (!current || current.revision !== expected.kvRevisions.get(key) || !portabilityValueEquals(current.value, value))
				throw new Error(`portability_write_conflict:${key}`);
		} else if (!portabilityValueEquals(await ctx.kv.get<unknown>(key), value))
			throw new Error(`portability_write_conflict:${key}`);
	}
	const store = schemaConditionalStore(ctx.storage.schemas);
	if (!store) throw new Error("Schema import requires revision-checked storage.");
	for (const [id, value] of expected.schemas) {
		const current = await readSchemaVersioned(store, id);
		if (value === null ? current !== null :
			!current || current.revision !== expected.schemaRevisions.get(id) || !portabilityValueEquals(current.value, value))
			throw new Error(`portability_write_conflict:schema:${id}`);
	}
}

async function syncPortableSchemas(
	ctx: PluginContext,
	schemas: readonly SeoPortabilityState["customSchemas"][number][],
	writes: SeoPortabilityWritePlan["customSchemas"],
	createdAtById: Map<string, StoredCustomSchema>,
): Promise<void> {
	const now = new Date().toISOString();
	const byId = new Map(schemas.map((schema) => [schema.id, schema]));
	for (const id of writes.put) {
		const schema = byId.get(id);
		if (!schema) throw new Error(`portability_write_conflict:schema:${id}`);
		const previous = createdAtById.get(schema.id);
		await ctx.storage.schemas.put(schema.id, {
			storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
			name: schema.name,
			scope: schema.scope,
			json: schema.json,
			enabled: schema.enabled,
			createdAt: previous?.createdAt ?? now,
			updatedAt: now,
			...(schema.target ? { target: schema.target } : {}),
		} satisfies StoredCustomSchema);
	}
	for (const id of writes.remove) await ctx.storage.schemas.delete(id);
}

async function rollbackPortabilityWrites(
	ctx: PluginContext,
	kvSnapshot: Map<string, unknown>,
	schemaSnapshot: Map<string, StoredCustomSchema>,
	expected: PortabilityWriteExpectations,
	templatesBinding: BoundMetadataTemplates,
): Promise<{ conflicts: string[]; errors: string[] }> {
	const conflicts: string[] = [];
	const errors: string[] = [];

	for (const id of expected.uncertainSchemas)
		conflicts.push(`schema:${id} may have changed during an unconfirmed write; it was left as it is.`);
	for (const [id] of [...expected.schemas.entries()].reverse()) {
		if (expected.uncertainSchemas.has(id)) continue;
		const owned = expected.schemaRevisions.get(id);
		if (!owned) {
			conflicts.push(`schema:${id} was removed by the import; restoration requires review.`);
			continue;
		}
		try {
			const store = schemaConditionalStore(ctx.storage.schemas);
			if (!store) throw new Error("Revision-checked schema storage is unavailable.");
			const previous = schemaSnapshot.get(id) ?? null;
			const restored = previous === null
				? await deleteSchemaConditional(store, id, owned)
				: (await writeSchemaConditional(store, id, owned, structuredClone(previous))).applied;
			if (!restored) conflicts.push(`schema:${id} changed after the import write; the newer value was preserved.`);
		} catch (error: unknown) {
			errors.push(`schema:${id} rollback could not be confirmed: ${String(error)}`);
		}
	}

	const rollbackKvKey = async (
		key: string,
		expectedValue: unknown,
		beforeMutation?: () => Promise<void>,
	): Promise<void> => {
		try {
			if (key === SCHEMA_PRESETS_SETTINGS_KEY) {
				if (expected.uncertainKv.has(key)) {
					conflicts.push(`${key} may have changed during an unconfirmed write; it was left as it is.`);
					return;
				}
				const owned = expected.kvRevisions.get(key);
				const store = schemaConditionalStore(ctx.kv);
				if (!owned || !store) {
					conflicts.push(`${key} has no confirmed import revision; it was left as it is.`);
					return;
				}
				const previous = kvSnapshot.get(key) ?? null;
				const restored = previous === null
					? await deleteSchemaConditional(store, key, owned)
					: (await writeSchemaConditional(store, key, owned, structuredClone(previous))).applied;
				if (!restored) conflicts.push(`${key} changed after the import write; the newer value was preserved.`);
				return;
			}
			const versioned = typeof ctx.kv.getVersioned === "function"
				? await ctx.kv.getVersioned<unknown>(key)
				: null;
			const current = versioned ? versioned.value : await ctx.kv.get<unknown>(key);
			const previous = kvSnapshot.get(key) ?? null;
			if (portabilityValueEquals(current, previous)) return;
			if (!portabilityValueEquals(current, expectedValue)) {
				conflicts.push(`${key} changed after the import write; the newer value was preserved.`);
				return;
			}
			if (key.startsWith(COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX) && expectedValue !== null &&
				versioned?.revision !== expected.kvRevisions.get(key)) {
				conflicts.push(`${key} changed revision after the import write; the newer value was preserved.`);
				return;
			}
			let restoreError: unknown = null;
			try {
				await beforeMutation?.();
				if (versioned && typeof ctx.kv.compareAndSet === "function" &&
					typeof ctx.kv.compareAndDelete === "function") {
					const result = previous === null || previous === undefined
						? await ctx.kv.compareAndDelete(key, versioned.revision)
						: await ctx.kv.compareAndSet(key, versioned.revision, structuredClone(previous));
					if (!result.applied) {
						conflicts.push(`${key} changed during rollback; the newer value was preserved.`);
						return;
					}
				} else if (key.startsWith(COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX) && previous !== null) {
					const result = await ctx.kv.compareAndSet(key, null, structuredClone(previous));
					if (!result.applied) { conflicts.push(`${key} changed during rollback; the newer value was preserved.`); return; }
				} else if (previous === null || previous === undefined) {
					await ctx.kv.delete(key);
				} else {
					await ctx.kv.set(key, structuredClone(previous));
				}
			} catch (cause: unknown) {
				restoreError = cause;
			}
			const restored = await ctx.kv.get<unknown>(key);
			if (portabilityValueEquals(restored, previous)) return;
			if (!portabilityValueEquals(restored, expectedValue)) {
				conflicts.push(`${key} changed during rollback; the newer value was preserved.`);
				return;
			}
			errors.push(
				`${key} rollback failed: ${String(restoreError ?? "snapshot verification failed")}`,
			);
		} catch (error: unknown) {
			errors.push(`${key} rollback failed: ${String(error)}`);
		}
	};

	for (const [key, expectedValue] of [...expected.kv.entries()].reverse()) {
		if (key === TEMPLATES_SETTINGS_KEY) {
			// Only the import's own write is undone, by the revision it returned;
			// a later write with equal values belongs to someone else.
			const owned = expected.kvRevisions.get(key);
			if (!owned) {
				conflicts.push(`${key} was written without a confirmed revision; it was left as it is.`);
				continue;
			}
			const outcome = await rollbackPortabilityTemplates(ctx.kv as any, owned, templatesBinding);
			if (outcome === "conflict") conflicts.push(`${key} changed after the import write; the newer value was preserved.`);
			else if (outcome === "unconfirmed") errors.push(`${key} rollback could not be confirmed; reload before changing templates.`);
			else if (outcome === "unavailable") errors.push(`${key} rollback needs revision-checked plugin storage; it was left as it is.`);
			continue;
		}
		if (key === INDEXNOW_SETTINGS_STORAGE_KEY) {
			try {
				const queueLease = await withIndexNowQueueLease(ctx, async (queueOwner) => {
					return withIndexNowSettingsLease(ctx, async (settingsOwner) => {
						await rollbackKvKey(key, expectedValue, async () => {
							if (!await queueOwner.renew() || !await settingsOwner.renew())
								throw new Error("IndexNow rollback lease ownership was lost.");
						});
						return true;
					});
				});
				if (!queueLease.acquired) errors.push(`${key} rollback lease failed: ${queueLease.reason}`);
				else if (!queueLease.value.acquired) errors.push(`${key} rollback lease failed: ${queueLease.value.reason}`);
			} catch (error: unknown) {
				errors.push(`${key} rollback lease failed: ${String(error)}`);
			}
			continue;
		}
		await rollbackKvKey(key, expectedValue);
	}

	return { conflicts, errors };
}

/**
 * Writes only the sections the reviewed plan reports as changed, plus the
 * acknowledgement withdrawal every import makes. `storedSettings` is the
 * settings record of the same fenced snapshot as the plan.
 */
async function persistSeoPortabilityState(
	ctx: PluginContext,
	writes: SeoPortabilityWritePlan,
	storedSettings: unknown,
	createdAtById: Map<string, StoredCustomSchema>,
	indexNowUpdatedAt: string | null,
	templatesBinding: BoundMetadataTemplates,
): Promise<void> {
	const state = writes.state;
	const sections = new Set(writes.sections);
	if (sections.has("settings")) await persistAdminSettings(ctx, state.settings, writes.settingsMarkers);
	else if (writes.withdrawAcknowledgement) await withdrawContentScoringAcknowledgement(ctx, storedSettings);
	if (sections.has("sitemap")) await persistAdminSitemap(ctx, state.sitemap);
	if (sections.has("modules")) await persistAdminModules(ctx, state.modules);
	if (sections.has("schemaPresets")) await persistAdminSchemaPresets(ctx, state.schemaPresets);
	if (sections.has("templates")) {
		const templates = await writePortabilityTemplates(
			ctx.kv as any,
			templatesBinding,
			writes.templates,
			(collection) => readLegacyTemplateFields(ctx.kv as any, collection),
			templatesBinding.revision === null ? await ctx.kv.get<unknown>(LEGACY_TEMPLATE_REVISIONS_KEY) : null,
			Date.now(),
		);
		if (templates.status === "refused") throw new Error(`portability_templates_${templates.reason}:${TEMPLATES_SETTINGS_KEY}`);
	}
	if (sections.has("schemaContentTypes")) {
		const currentRoles = await readSchemaContentTypeRoles(ctx);
		if (!portabilityValueEquals(currentRoles.values, state.schemaContentTypes)) {
			await writeSchemaContentTypeRoles(ctx, state.schemaContentTypes);
		}
	}
	if (sections.has("analysisProfiles") && state.analysisProfiles !== undefined) {
		const existing = await portableAnalysisProfileRows(ctx);
		const collections = new Set([...existing.map((row) => row.key.slice(COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX.length)), ...Object.keys(state.analysisProfiles)]);
		for (const collection of [...collections].sort()) {
			const key = collectionAnalysisProfileKey(collection);
			const current = await ctx.kv.getVersioned<unknown>(key);
			const next = state.analysisProfiles[collection];
			if (!next) {
				if (current && !(await ctx.kv.compareAndDelete(key, current.revision)).applied) throw new Error(`portability_write_conflict:${key}`);
				continue;
			}
			const selected = await readCollectionAnalysisProfile(ctx, collection);
			if (selected.state === "configured" && selected.profile === next.profile && selected.version === next.version) continue;
			const saved = await saveCollectionAnalysisProfile(ctx, collection, { profile: next.profile, expectedRevision: current?.revision ?? null });
			if (!saved.success) throw new Error(`portability_assessment_profile_${saved.error}:${key}`);
		}
	}
	if (sections.has("indexNow")) {
		const indexNowUpdate = await updateIndexNowSettings(ctx, () => state.indexNow, {
			expectedUpdatedAt: indexNowUpdatedAt,
		});
		if (!indexNowUpdate.updated) {
			throw new Error(`portability_indexnow_write_${indexNowUpdate.reason}`);
		}
	}
	await syncPortableSchemas(ctx, state.customSchemas, writes.customSchemas, createdAtById);
}

async function buildSeoPortabilityExport(
	ctx: PluginContext,
): Promise<SeoPortabilityExportResponse> {
	const { current } = await readStableSeoPortabilitySnapshot(ctx);
	const generatedAt = new Date();
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		generatedAt: generatedAt.toISOString(),
		bundle: createSeoPortabilityBundle(current.state, generatedAt),
		warnings: [],
	};
}

async function portabilityTargetContext(ctx: PluginContext): Promise<SeoPortabilityTargetContext> {
	const [collections, indexNow, templates] = await Promise.all([
		resolveContentCollectionSource(ctx),
		resolveIndexNowContentCollections(ctx),
		readAdminTemplates(ctx),
	]);
	const discovered = new Set(collections.available ? collections.definitions.map((definition) => definition.collection) : []);
	// A saved template equal to its inherited value is not a saved difference: replace keeps it stored and the preview does not count it as deleted.
	const savedTemplateCollections: string[] = [];
	for (const [collection, source] of Object.entries(templates.sources)) {
		if (source !== "snapshot") continue;
		const inherited = discovered.has(collection)
			? inheritedMetadataTemplate(collection, await readLegacyTemplateFields(ctx.kv as any, collection)).values
			: null;
		if (!inherited || !metadataTemplateValuesEqual(templates.values[collection], inherited)) savedTemplateCollections.push(collection);
	}
	return {
		templateCollections: collections.available
			? templateContentCollections(collections.definitions).map((definition) => definition.collection)
			: null,
		indexNowContentTypes: indexNow.available
			? indexNow.definitions.map((definition) => definition.collection)
			: null,
		savedTemplateCollections,
	};
}

async function previewSeoPortabilityRoute(
	ctx: PluginContext,
	bundle: unknown,
	mode: SeoPortabilityMode,
): Promise<SeoPortabilityPreviewResult> {
	try {
		const { current } = await readStableSeoPortabilitySnapshot(ctx);
		return previewSeoPortabilityImport(bundle, current.state, mode, undefined, await portabilityTargetContext(ctx));
	} catch (cause) {
		return {
			success: false,
			error: "invalid_bundle",
			errors: [
				cause instanceof Error ? cause.message : "Current SEO configuration is not portable.",
			],
		};
	}
}

async function applySeoPortabilityRoute(
	ctx: PluginContext,
	bundle: unknown,
	mode: SeoPortabilityMode,
	confirmation: unknown,
	planFingerprint: unknown,
): Promise<SeoPortabilityApplyResult> {
	let initial: StableSeoPortabilitySnapshot;
	try {
		initial = await readStableSeoPortabilitySnapshot(ctx);
	} catch (cause) {
		if (cause instanceof SeoPortabilityStateChangedError) {
			return {
				success: false,
				error: "preview_stale",
				detail:
					"SEO configuration changed while the import was being prepared. Validate the import again.",
			};
		}
		return {
			success: false,
			error: "invalid_bundle",
			detail: "Current SEO configuration is not portable.",
			errors: [
				cause instanceof Error ? cause.message : "Repair the current SEO configuration first.",
			],
		};
	}
	const current = initial.current;
	const target = await portabilityTargetContext(ctx);
	const preview = previewSeoPortabilityImport(bundle, current.state, mode, undefined, target);
	if (!preview.success) {
		return {
			success: false,
			error: "invalid_bundle",
			detail: "The import bundle failed validation.",
			errors: preview.errors,
		};
	}
	if (confirmation !== SEO_PORTABILITY_CONFIRMATION) {
		return {
			success: false,
			error: "confirmation_required",
			detail: `Type ${SEO_PORTABILITY_CONFIRMATION} to apply this import.`,
		};
	}
	if (typeof planFingerprint !== "string" || planFingerprint !== preview.plan.fingerprint) {
		return {
			success: false,
			error: "preview_stale",
			detail:
				"SEO configuration changed after the preview. Validate the import again before applying it.",
		};
	}

	// Rebuild one more stable snapshot immediately before writing. Comparing raw
	// observations as well as the normalized fingerprint closes metadata-only
	// and state-to-rollback-snapshot interleaves.
	let confirmedSnapshot: StableSeoPortabilitySnapshot;
	try {
		confirmedSnapshot = await readStableSeoPortabilitySnapshot(ctx);
	} catch {
		return {
			success: false,
			error: "preview_stale",
			detail:
				"SEO configuration changed while the import was being prepared. Validate the import again.",
		};
	}
	const confirmed = confirmedSnapshot.current;
	const confirmedPreview = previewSeoPortabilityImport(bundle, confirmed.state, mode, undefined, target);
	if (
		!confirmedPreview.success ||
		confirmedPreview.plan.fingerprint !== preview.plan.fingerprint ||
		initial.templates.revision !== confirmedSnapshot.templates.revision ||
		!portabilityValueEquals(initial.presets, confirmedSnapshot.presets) ||
		!portabilityMapEquals(initial.schemas, confirmedSnapshot.schemas) ||
		!portabilityMapEquals(initial.kv, confirmedSnapshot.kv) ||
		!portabilityMapEquals(current.rawSchemas, confirmed.rawSchemas)
	) {
		return {
			success: false,
			error: "preview_stale",
			detail:
				"SEO configuration changed while the import was being prepared. Validate the import again.",
		};
	}

	const kvSnapshot = confirmedSnapshot.kv;
	const schemaSnapshot = confirmed.rawSchemas;
	const backup = createSeoPortabilityBundle(confirmed.state);
	// Stored records come from the same fenced snapshot as the confirmed state.
	const storedSettings = kvSnapshot.get(GLOBAL_SETTINGS_KEY);
	const writes = planSeoPortabilityWrites(
		confirmedPreview.bundle,
		confirmed.state,
		mode,
		seoPortabilityStoredRecords(storedSettings, kvSnapshot.get(TEMPLATES_SETTINGS_KEY)),
		target,
	);
	const expected: PortabilityWriteExpectations = {
		kv: new Map(),
		kvRevisions: new Map(),
		schemas: new Map(),
		schemaRevisions: new Map(),
		uncertainKv: new Set(),
		uncertainSchemas: new Set(),
	};
	const writeContext = portabilityTrackingContext(ctx, expected, kvSnapshot, confirmedSnapshot.schemas, confirmedSnapshot.presets);
	try {
		await persistSeoPortabilityState(writeContext, writes, storedSettings, schemaSnapshot, confirmed.indexNowUpdatedAt, confirmedSnapshot.templates);
		await verifyPortabilityWrites(ctx, expected);
	} catch (cause) {
		const failureDetail = cause instanceof Error ? cause.message : "SEO import failed.";
		const rollback = await rollbackPortabilityWrites(ctx, kvSnapshot, schemaSnapshot, expected, confirmedSnapshot.templates);
		for (const key of expected.uncertainKv) {
			if (key === SCHEMA_PRESETS_SETTINGS_KEY) {
				if (!expected.kv.has(key)) rollback.conflicts.push(`${key} may have changed during an unconfirmed write; it was left as it is.`);
				continue;
			}
			try {
				if (!portabilityValueEquals(await ctx.kv.get<unknown>(key), kvSnapshot.get(key))) {
					rollback.conflicts.push(`${key} may have changed during a failed conditional write; its ownership could not be verified.`);
				}
			} catch (readError) {
				rollback.errors.push(`${key} could not be verified after a failed conditional write: ${String(readError)}`);
			}
		}
		if (rollback.errors.length === 0 && rollback.conflicts.length === 0) {
			return {
				success: false,
				error: "apply_failed",
				detail: `Import failed. Confirmed import writes were rolled back; concurrent changes were preserved. ${failureDetail}`,
				rollbackPerformed: true,
			};
		}
		if (rollback.errors.length > 0) {
			ctx.log.error("seo: portability rollback failed", {
				error: rollback.errors.join("; "),
				conflicts: rollback.conflicts,
			});
			return {
				success: false,
				error: "rollback_failed",
				detail: `SEO import failed. Some automatic rollback writes failed; concurrent changes were left untouched. ${failureDetail}`,
				errors: [...rollback.errors, ...rollback.conflicts],
				rollbackPerformed: false,
			};
		}
		return {
			success: false,
			error: "rollback_conflict",
			detail: `Import failed. Unchanged import writes were rolled back, but newer concurrent changes were preserved; configuration remains partial. ${failureDetail}`,
			errors: rollback.conflicts,
			rollbackPerformed: false,
		};
	}

	return {
		success: true,
		appliedAt: new Date().toISOString(),
		plan: confirmedPreview.plan,
		backup,
	};
}

// ---------------------------------------------------------------------------
// Override resolution: ${collection}:${id} → fallback ${collection}:${slug}
// ---------------------------------------------------------------------------

async function resolveOverride(
	ctx: PluginContext,
	page: PublicPageContext,
): Promise<Override | null> {
	const content = page.content;
	if (!content) return null;
	const byId = `${content.collection}:${content.id}`;
	let rec = (await ctx.storage.overrides.get(byId)) as Override | null;
	if (!rec && content.slug) {
		const bySlug = `${content.collection}:${content.slug}`;
		rec = (await ctx.storage.overrides.get(bySlug)) as Override | null;
	}
	return rec;
}

// ---------------------------------------------------------------------------
// Contribution helpers — keep the page:metadata handler readable.
// ---------------------------------------------------------------------------

function meta(name: string, content: string, key?: string) {
	return key
		? { kind: "meta" as const, name, content, key }
		: { kind: "meta" as const, name, content };
}
function property(prop: string, content: string, key?: string) {
	return key
		? { kind: "property" as const, property: prop, content, key }
		: { kind: "property" as const, property: prop, content };
}
// EmDash's metadata merge keeps a link only when its href starts with this
// prefix, while it keeps any property tag.
const MERGE_KEPT_LINK_HREF = /^https?:\/\//i;

function socialOverrideRefsForPage(page: PublicPageContext): string[] {
	if (!page.content) return [];
	const refs = [`${page.content.collection}:${page.content.id}`];
	if (page.content.slug && page.content.slug !== page.content.id) {
		refs.push(`${page.content.collection}:${page.content.slug}`);
	}
	return refs;
}

function rawOverrideRobots(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, "robots");
	return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

/** `settings` must come from a readable settings snapshot. */
async function resolveEffectivePageMetadata(
	page: PublicPageContext,
	ctx: PluginContext,
	contentItem: any | null | undefined,
	settings: SeoAdminSettingsValues,
	robotsSources?: unknown[],
): Promise<EffectiveSeoMetadata> {
	const collection = page.content?.collection;
	if (collection && isTemplateCollection(collection) && page.content?.id && ctx.content) {
		const item =
			contentItem === undefined ? await ctx.content.get(collection, page.content.id) : contentItem;
		if (item) {
			const observation = robotsSources ? createMetadataReadObservation() : undefined;
			const effective = await resolveEffectiveContentMetadata(ctx, collection, item, undefined, settings, undefined, observation);
			if (robotsSources) robotsSources.push(rawOverrideRobots(observation?.legacy.at(-1)?.value));
			// The plugin's robots tag replaces the core one first-wins, so without a plugin noindex source or
			// legacy robots the theme's own value stays the base that entry directives extend.
			if (!effective.robots) effective.robots = clean(page.seo?.robots) ?? "";
			if (effective.canonical.source === "generated" && isHttpUrl(page.canonical)) {
				effective.canonical = effectiveField(page.canonical ?? "", "generated");
				effective.vars.canonical = effective.canonical.value;
			}
			return effective;
		}
	}

	const global = await getGlobalSettings(ctx, page, settings);
	const override = await resolveOverride(ctx, page);
	if (robotsSources) robotsSources.push(rawOverrideRobots(override));
	const socialOverride = await readSocialOverride(ctx, socialOverrideRefsForPage(page));
	const vars = buildVars(page);
	vars.siteUrl = global.siteUrl;
	const template = collection ? await getTemplate(ctx, collection) : null;
	const resolvedTemplate = template ? resolveContentTypeTemplate(template, vars) : null;
	const legacyTitle = clean(override?.title);
	const title = legacyTitle
		? effectiveField(legacyTitle, "legacy-override")
		: resolvedTemplate?.title
			? effectiveField(resolvedTemplate.title, "template")
			: effectiveField(vars.title, "content");
	const legacyDescription = clean(override?.description);
	const description = legacyDescription
		? effectiveField(legacyDescription, "legacy-override")
		: resolvedTemplate?.description
			? effectiveField(resolvedTemplate.description, "template")
			: effectiveField(vars.description, "content");
	const socialTitleValue = clean(page.seo?.ogTitle);
	const storedSocialTitle = clean(socialOverride?.title);
	const socialTitleFallback = socialTitleValue
		? effectiveField(socialTitleValue, "core-seo")
		: resolvedTemplate?.socialTitle
			? effectiveField(resolvedTemplate.socialTitle, "template")
			: { ...title };
	const socialTitle = storedSocialTitle
		? effectiveField(storedSocialTitle, "plugin-social-override")
		: socialTitleFallback;
	const socialDescriptionValue = clean(page.seo?.ogDescription);
	const storedSocialDescription = clean(socialOverride?.description);
	const socialDescriptionFallback = socialDescriptionValue
		? effectiveField(socialDescriptionValue, "core-seo")
		: resolvedTemplate?.socialDescription
			? effectiveField(resolvedTemplate.socialDescription, "template")
			: { ...description };
	const socialDescription = storedSocialDescription
		? effectiveField(storedSocialDescription, "plugin-social-override")
		: socialDescriptionFallback;
	const legacyCanonical = clean(override?.canonical);
	const canonical = legacyCanonical
		? effectiveField(absoluteMetadataUrl(legacyCanonical, global.siteUrl), "legacy-override")
		: effectiveField(absoluteMetadataUrl(page.canonical ?? page.url, global.siteUrl), "generated");
	const legacyImage = clean(override?.ogImage);
	const pageImage = clean(page.seo?.ogImage) ?? clean(page.image);
	const image = legacyImage
		? effectiveField(absoluteMetadataUrl(legacyImage, global.siteUrl), "legacy-override")
		: pageImage
			? effectiveField(absoluteMetadataUrl(pageImage, global.siteUrl), "content")
			: effectiveField(absoluteMetadataUrl(global.defaultOgImage, global.siteUrl), "site-default");
	const overrideRobots = clean(override?.robots);
	const robots = overrideRobots ?? clean(page.seo?.robots) ?? "";
	// The plugin's own noindex sources emit its directive; a theme value that already has noindex keeps its directives.
	const pluginNoindex = (await getNoindex(ctx, settings)) || contentTypeNoindexApplies(settings.contentTypeNoindex, collection) ||
		Boolean(overrideRobots?.toLowerCase().includes("noindex"));
	const noindex = pluginNoindex || robots.toLowerCase().includes("noindex");
	vars.title = title.value;
	vars.description = description.value;
	vars.canonical = canonical.value;
	vars.image = image.value;
	return {
		title,
		description,
		searchTitleFallback: title,
		searchDescriptionFallback: description,
		socialTitle,
		socialDescription,
		socialTitleFallback,
		socialDescriptionFallback,
		canonical,
		image,
		socialOverride,
		indexable: !noindex,
		robots: pluginNoindex ? "noindex,nofollow" : robots,
		vars,
	};
}

// The host hands the hook the entry's stored SEO image already made absolute on its own
// Site URL. Where og:image is that stored image, structured data names it by og:image's URL.
function withEntrySeoImage(page: PublicPageContext, image: EffectiveSeoMetadata["image"]): PublicPageContext {
	const chosen = page.image ?? page.seo?.ogImage;
	if (image.source !== "core-seo" || chosen === image.value || !isHttpUrl(chosen) || !isHttpUrl(image.value)) return page;
	const hostUrl = new URL(chosen as string);
	const ownUrl = new URL(image.value);
	if (hostUrl.pathname !== ownUrl.pathname || hostUrl.search !== ownUrl.search) return page;
	return {
		...page,
		image: page.image === chosen ? image.value : page.image,
		...(page.seo ? { seo: { ...page.seo, ogImage: page.seo.ogImage === chosen ? image.value : page.seo.ogImage } } : {}),
	};
}

// ---------------------------------------------------------------------------
// page:metadata — the core SEO surface.
// ---------------------------------------------------------------------------

async function buildPageMetadata(page: PublicPageContext, ctx: PluginContext): Promise<any[]> {
	const contributions: any[] = [];

	// Unreadable settings contribute nothing, as a failed hook does: Shipit
	// neither guesses index,follow nor invents a noindex, and core robots stay.
	const site = await readSiteSettings(ctx);
	if (!isReadableSiteSettings(site)) {
		ctx.log.warn("seo: page metadata skipped because the site settings are unreadable", { state: site.state });
		return contributions;
	}
	const settings = site.values;
	const coexistence = await readCoexistenceInventory(ctx);
	const paused = (surface: "metadata" | "robots" | "schema") => coexistence?.paused.includes(surface) ?? false;
	const verificationContributions = customVerificationContributions(settings.customVerificationTags);
	contributions.push(...verificationContributions);
	const global = await getGlobalSettings(ctx, page, settings);
	const presets = await getPresets(ctx);
	const configuredModules = await getModules(ctx);
	const modules = { ...configuredModules, schema: configuredModules.schema && !paused("schema") };
	const collection = page.content?.collection;
	let contentItem: any | null = null;
	if (collection && page.content?.id && ctx.content) {
		try {
			contentItem = await ctx.content.get(collection, page.content.id);
		} catch (error: unknown) {
			ctx.log.warn("seo: failed to load content for metadata", {
				collection,
				id: page.content.id,
				error: String(error),
			});
		}
	}
	const robotsSources: unknown[] | undefined = paused("metadata") || paused("robots") ? [] : undefined;
	const effective = await resolveEffectivePageMetadata(page, ctx, contentItem, settings, robotsSources);
	const vars = effective.vars;
	const schemaResolution = createSeoSchemaResolutionState();
	const addJsonLd = (id: string, graph: unknown, source: string) => {
		const decision = resolveSeoSchemaCandidate(schemaResolution, id, graph);
		if (!decision.emitted) {
			ctx.log.warn("seo: skipping schema contribution", {
				source,
				id,
				reason: decision.reason,
				conflictId: decision.conflictId,
			});
			return;
		}
		contributions.push({ kind: "jsonld", id, graph });
	};

	// EmDash deduplicates the canonical link and og:url under separate keys, so
	// both come from this one value or the base layer can pair them differently.
	// A link the merge drops would leave og:url beside the base canonical.
	if (isHttpUrl(effective.canonical.value)) {
		contributions.push({
			kind: "link",
			rel: "canonical",
			href: effective.canonical.value,
		});
		if (MERGE_KEPT_LINK_HREF.test(effective.canonical.value)) {
			contributions.push(property("og:url", effective.canonical.value));
		}
	}

	// EmDash resolves metadata first-wins in plugin → site → base order, so these
	// contributions replace the matching core fallback without rendering duplicates.
	if (effective.description.value)
		contributions.push(meta("description", effective.description.value));
	if (effective.socialTitle.value)
		contributions.push(property("og:title", effective.socialTitle.value));
	if (effective.socialDescription.value) {
		contributions.push(property("og:description", effective.socialDescription.value));
	}
	const socialImage = isHttpUrl(effective.image.value) ? effective.image.value : "";
	if (socialImage) {
		contributions.push(property("og:image", socialImage));
		contributions.push(meta("twitter:card", "summary_large_image"));
	}
	if (effective.socialTitle.value)
		contributions.push(meta("twitter:title", effective.socialTitle.value));
	if (effective.socialDescription.value) {
		contributions.push(meta("twitter:description", effective.socialDescription.value));
	}
	if (socialImage) contributions.push(meta("twitter:image", socialImage));
	if (global.twitterHandle) contributions.push(meta("twitter:site", global.twitterHandle));
	// Entry restrictions extend core SEO. Archive policy applies only to bound
	// custom pages and leaves content entry indexing under its existing owner.
	const metaOverride =
		collection && page.content?.id
			? await readMetaOverride(ctx, `${collection}:${page.content.id}`)
			: null;
	const archiveNoindex = taxonomyArchiveNoindexApplies(settings.taxonomyArchiveNoindex, taxonomyArchiveName(page));
	// Bound archives have no entry override. Keep the theme's directives and
	// include the existing site-wide restriction only when that policy is on.
	const archiveRobots = settings.noindex
		? `${effective.robots},${clean(page.seo?.robots) ?? ""}`
		: clean(page.seo?.robots) ?? "";
	const robotsBase = archiveNoindex
		? [...new Set([...archiveRobots.split(",").map((token) => token.trim().toLowerCase())
			.filter((token) => token && token !== "index" && !(settings.noindex && token === "follow")), "noindex"])].join(",")
		: effective.robots;
	const robotsContent = mergeRobotsDirectives(robotsBase, metaOverride?.robots);
	if (robotsContent) contributions.push(meta("robots", robotsContent));

	if (collection && contentItem) {
		const alternates = await buildPageHreflangLinks(
			ctx,
			collection,
			contentItem,
			effective.canonical.value || page.canonical || page.url,
			effective.indexable,
		);
		for (const alternate of alternates) {
			contributions.push({
				kind: "link",
				rel: "alternate",
				href: alternate.href,
				hreflang: alternate.hreflang,
			});
		}
	}

	// --- JSON-LD: presets, then custom schemas (data only; host wraps + escapes) ---
	const disabledPresets = new Set(metaOverride?.disabledPresets ?? []);
	// Custom schemas whose scope matches (global | collection | collection:id).
	// They are expanded before the presets because an owned business identity
	// definition in one of them decides how the publisher is emitted.
	const scopes = ["global"];
	if (collection) {
		scopes.push(collection);
		if (page.content?.id) scopes.push(`${collection}:${page.content.id}`);
		if (page.content?.slug) scopes.push(`${collection}:${page.content.slug}`);
	}
	let customs: SeoAdminCustomSchema[] = [];
	if (modules.schema) {
		try {
			// Don't filter by the boolean `enabled` in the query: SQLite can't bind booleans.
			// Scope is indexed; enabled state is checked after loading bounded pages.
			// Entry-owned records need the loaded row: its ID must match the page and its locale the target.
			const entry = contentItem && String(contentItem.id) === page.content?.id
				? entrySchemaPageEntry(collection, contentItem)
				: null;
			customs = await readPublicScopedCustomSchemas(ctx, scopes, entry);
		} catch (err: unknown) {
			ctx.log.warn("seo: failed to load custom schemas", { err: String(err) });
		}
	}
	const expandedCustoms: Array<{ schema: SeoAdminCustomSchema; graph: unknown }> = [];
	for (const schema of customs) {
		if (!schema.enabled) continue;
		if (!scopes.includes(schema.scope)) continue;
		try {
			expandedCustoms.push({ schema, graph: applyVarsDeep(validateCustomJsonLd(schema.json), vars) });
		} catch (err: unknown) {
			// A bad custom schema must NEVER break page render; log and skip it.
			ctx.log.warn("seo: skipping invalid custom schema", {
				id: schema.id,
				err: String(err),
			});
		}
	}
	const publisherSwitch = presets.organization && !disabledPresets.has("organization");
	// One ownership read per request; the identity is read only while ownership
	// is automatic, and that one read serves the publisher, its links and reference expansion.
	let identity: ReturnType<typeof resolvePublisherOutput> | null = null;
	if (modules.schema) {
		const ownershipState = await readPublisherOwnership(ctx.kv);
		const ownership = publisherOwnershipEffective(ownershipState);
		if (ownership === "unknown") {
			ctx.log.warn("seo: publisher ownership cannot be read, so no automatic publisher is added", { state: ownershipState.state });
		}
		identity = resolvePublisherOutput({
			ownership,
			identity: ownership === "automatic"
				? await readBusinessIdentityRenderState(businessIdentityStoreFor(ctx as unknown as { settings?: unknown; kv?: unknown }))
				: null,
			settings: global,
			page,
			customs: expandedCustoms.map(({ schema, graph }) => ({ id: schema.id, graph })),
		});
	}
	for (const conflict of identity?.conflicts ?? []) {
		ctx.log.warn("seo: custom schema defines the automatic publisher, so it is left off this page", {
			id: conflict.customId,
			ownedIds: conflict.ownedIds,
			outcome: conflict.outcome,
			source: identity?.source,
		});
	}
	const publisher = identity?.publisher;
	const publisherEmitted = publisherSwitch && (publisher?.kind !== "identity" || publisher.graph !== null);
	if (modules.schema) {
		for (const preset of buildSchemaPresetGraphs({
			page: withEntrySeoImage(page, effective.image),
			settings: global,
			presets,
			data: contentItem?.data,
			disabledPresets,
			contentTypeRoles: schemaOutputContentTypeRoles(await readSchemaContentTypeRoles(ctx)),
			publisher,
		})) {
			if (disabledPresets.has(preset.key)) continue;
			const customOwned = presetDefinesCustomPublisherId(preset.graph, identity?.customIds ?? []);
			if (customOwned) {
				ctx.log.warn("seo: skipping schema contribution", { source: `preset:${preset.key}`, id: preset.contributionId, reason: "entity-conflict", conflictId: customOwned });
				continue;
			}
			addJsonLd(preset.contributionId, preset.graph, `preset:${preset.key}`);
		}
	}

	for (const { schema, graph: expanded } of expandedCustoms) {
		try {
			const graph = resolveSchemaOrganizationReferences(
				expanded,
				global,
				publisherEmitted,
				publisher,
			);
			addJsonLd(`custom:${schema.id}`, graph, `custom:${schema.id}`);
		} catch (err: unknown) {
			// A bad custom schema must NEVER break page render; log and skip it.
			ctx.log.warn("seo: skipping invalid custom schema", {
				id: schema.id,
				err: String(err),
			});
		}
	}

	let output = paused("metadata")
		? contributions.filter((contribution) => contribution.kind === "jsonld" ||
			(coexistence?.status === "available" && verificationContributions.includes(contribution)))
		: contributions;
	if (paused("metadata") || paused("robots")) {
		output = output.filter((contribution) => contribution.kind !== "meta" || contribution.name !== "robots");
		const restrictions = projectCoexistenceRobots({
			sources: [page.seo?.robots, ...(robotsSources ?? []), robotsContent],
			siteNoindex: settings.noindex,
		});
		if (restrictions.contribution) output.push(restrictions.contribution);
		if (restrictions.status === "unresolved") ctx.log.warn("seo: saved robots rules need manual review", {
			unresolved: restrictions.unresolved.length,
		});
	}
	return output;
}

// The native adapter supplies installation facts for each context it serves; a
// sandbox host supplies none, so its IndexNow checks report what they observe.
const indexNowInstallations = new WeakMap<object, IndexNowInstallation>();
// Only the native entry binds a sitemap host; registry installations have none.
const sitemapHosts = new WeakMap<object, SitemapHost>();
// Only the native entry binds robots.txt ownership facts.
const robotsInstallations = new WeakMap<object, RobotsInstallation>();
// Only the native entry binds llms.txt ownership facts.
const llmsTxtInstallations = new WeakMap<object, LlmsTxtInstallation>();
// Only the native entry binds score scan ports; other hosts report the scan unavailable.
const scoreScanHosts = new WeakMap<object, ScoreScanHost>();
// Only the native entry binds site branding; other hosts report no logo.
const brandingHosts = new WeakMap<object, SeoInstalledBranding>();

function scoreScanHost(ctx: PluginContext): ScoreScanHost | null {
	return scoreScanHosts.get(ctx as object) ?? null;
}

function sitemapHost(ctx: PluginContext): SitemapHost | null {
	return sitemapHosts.get(ctx as object) ?? null;
}

function robotsInstallation(ctx: PluginContext): RobotsInstallation | null {
	return robotsInstallations.get(ctx as object) ?? null;
}

function llmsTxtInstallation(ctx: PluginContext): LlmsTxtInstallation | null {
	return llmsTxtInstallations.get(ctx as object) ?? null;
}

function indexNowInstallation(ctx: PluginContext): IndexNowInstallation {
	return indexNowInstallations.get(ctx as object) ?? UNKNOWN_INDEXNOW_INSTALLATION;
}

// Through the Astro entry point the installed site address is authoritative,
// because the network permission was bound to it at build time.
async function indexNowSiteOrigin(ctx: PluginContext): Promise<string> {
	const installation = indexNowInstallation(ctx);
	if (installation.mode === "astro") return installation.siteUrl ?? installation.siteOrigin ?? "";
	const settings = await getGlobalSettings(ctx);
	return settings.siteUrl || ctx.site.url;
}

// The host only resolves a public URL while the entry is published.
function indexNowPublishedUrlKey(collection: string, id: string): string {
	return `state:indexnow-published-url:${encodeURIComponent(collection)}:${encodeURIComponent(id)}`;
}

async function indexNowAdminStatus(
	ctx: PluginContext,
	siteOrigin: string,
	limit?: number,
	settingsSnapshot?: Parameters<typeof buildAdminIndexNowStatus>[3],
) {
	const [status, contentTypes, rules] = await Promise.all([
		buildAdminIndexNowStatus(ctx, siteOrigin, limit, settingsSnapshot, indexNowInstallation(ctx)),
		resolveIndexNowContentCollections(ctx),
		indexNowContentTypeRules(ctx),
	]);
	const ruled = new Set(rules?.map((rule) => rule.collection) ?? []);
	const selectedTypes = status.values.autoSubmitContentTypes;
	const selectedDefinitions = contentTypes.definitions.filter((definition) =>
		selectedTypes === null || selectedTypes.includes(definition.collection));
	const eligibleTypes = selectedDefinitions.filter((definition) => !ruled.has(definition.collection));
	const readiness = status.values.enabled && status.values.autoSubmit && status.readiness.state === "ready"
		? !contentTypes.available
			? {
				state: "unavailable" as const,
				title: "Automatic notifications unavailable",
				description: "Public content types could not be discovered. Manual URL submission remains available.",
			}
			: eligibleTypes.length === 0
				? {
					state: "ready" as const,
					title: "Manual delivery is ready",
					description: selectedDefinitions.length
						? "Every selected content type has a noindex rule in Indexing rules, so nothing is submitted automatically. Manual URL submission remains available."
						: "No public content types are selected for automatic submission. Manual URL submission remains available.",
				}
				: status.readiness
		: status.readiness;
	return {
		...status,
		readiness,
		contentTypeDiscoveryAvailable: contentTypes.available,
		contentTypes: contentTypes.definitions.map((definition) => ({
			collection: definition.collection,
			label: definition.label,
		})),
		...(rules ? { contentTypeRules: rules } : {}),
	};
}

/**
 * Public content types with a noindex rule and the address pattern their
 * entries use. Null while the rule or the content types cannot be read.
 */
async function indexNowContentTypeRules(ctx: PluginContext): Promise<SeoAdminIndexNowContentTypeRule[] | null> {
	const facts = await readSiteIndexingFacts(ctx);
	if (facts.state !== "ok") return null;
	if (!facts.contentTypeNoindex.length) return [];
	const source = await resolveContentCollectionSource(ctx);
	if (!source.available) return null;
	return source.definitions
		.filter((definition) => facts.contentTypeNoindex.includes(definition.collection))
		.map((definition) => ({ collection: definition.collection, label: definition.label, urlPattern: contentTypeRoutePattern(definition) }));
}

/**
 * Manual URLs, as given, whose address matches the URL pattern of a content
 * type with a noindex rule. A rule or content type list that cannot be read
 * withholds nothing.
 */
async function indexNowRuledManualUrls(ctx: PluginContext, siteOrigin: string, urls: readonly string[]): Promise<Set<string>> {
	const origin = indexNowPublicOrigin(siteOrigin);
	if (!origin.ready) return new Set();
	const rules = await indexNowContentTypeRules(ctx);
	if (!rules?.length) return new Set();
	const match = createContentTypeRouteMatcher(rules, sitemapHost(ctx)?.installation.routing ?? null);
	return new Set(urls.filter((url) => {
		const normalized = normalizeIndexNowUrl(url, origin.origin);
		return normalized !== null && match(new URL(normalized).pathname) !== null;
	}));
}

async function indexNowEventUrl(
	ctx: PluginContext,
	definition: SeoContentCollectionDefinition,
	item: any,
	siteOrigin: string,
): Promise<string | null> {
	const content = ctx.content as
		| (PluginContentAccess & { getPublicUrl?: (collection: string, id: string) => Promise<string | null> })
		| undefined;
	if (!contentItemIsPublished(item) || typeof content?.getPublicUrl !== "function") return null;
	try {
		const url = await content.getPublicUrl(definition.collection, String(item.id));
		return url ? normalizeIndexNowUrl(url, siteOrigin) : null;
	} catch (error: unknown) {
		ctx.log?.warn?.("seo:indexnow public URL lookup failed", {
			collection: definition.collection,
			entryId: String(item.id),
			error: String(error),
		});
		return null;
	}
}

async function indexNowEligibleCollection(
	ctx: PluginContext,
	collection: string,
	selection: readonly string[] | null,
): Promise<SeoContentCollectionDefinition | null> {
	if (selection !== null && !selection.includes(collection)) return null;
	const discovered = await resolveIndexNowContentCollections(ctx);
	return discovered.definitions.find((definition) => definition.collection === collection) ?? null;
}

// Without `siteNoindex` it reads the strict preference and throws while that
// preference cannot be read.
async function indexNowContentIsIndexable(
	ctx: PluginContext,
	collection: string,
	item: any,
	indexing?: { noindex: boolean; contentTypeNoindex?: readonly string[] },
): Promise<boolean> {
	const facts = indexing ?? (await readReadableSiteSettings(ctx, "indexing")).values;
	if (facts.noindex) return false;
	if (contentTypeNoindexApplies(facts.contentTypeNoindex, collection)) return false;
	const seo = item?.seo ?? item?.data?.seo;
	if (seo?.noIndex === true) return false;
	if (typeof (ctx.storage as any)?.overrides?.get === "function") {
		const override = await resolveOverrideForContentItem(ctx, collection, item);
		if (clean(override?.robots)?.toLowerCase().includes("noindex")) return false;
	}
	return true;
}

function contentStatus(item: any): string {
	return clean(item?.status) ?? clean(item?.data?.status) ?? "";
}

async function queueIndexNowContentEvent(
	event: { content?: Record<string, unknown>; collection?: string },
	ctx: PluginContext,
	reason: "publish" | "update" | "unpublish",
): Promise<void> {
	const collection = cleanCollection(event.collection);
	if (!collection) return;
	const item = event.content as any;
	if (!item) return;
	const id = clean(item.id);
	if (!id) return;
	const snapshotKey = indexNowPublishedUrlKey(collection, id);
	let snapshot: { url?: string } | null = null;
	let snapshotAvailable = true;
	try {
		snapshot = await ctx.kv.get<{ url?: string }>(snapshotKey);
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow published URL lookup failed", { collection, id, error: String(error) });
		if (reason === "unpublish") return;
		snapshotAvailable = false;
	}
	const settings = await readIndexNowSettings(ctx);
	if (!settings.values.enabled || !settings.values.autoSubmit) return;
	if (!(await coexistenceAdmission(ctx, "indexnow"))) return;
	if (reason === "update" && contentStatus(item) !== "published") return;
	// While a draft is pending, saves are not sent, even ones that also change live
	// SEO; publishing the draft submits the URL with everything changed meanwhile.
	if (reason === "update" && clean(item.draftRevisionId) && clean(item.draftRevisionId) !== clean(item.liveRevisionId)) return;
	if (reason !== "unpublish" && !contentItemIsPublished(item)) return;
	const siteOrigin = await indexNowSiteOrigin(ctx);
	const definition = await indexNowEligibleCollection(ctx, collection, settings.values.autoSubmitContentTypes);
	if (!definition) return;
	if (reason !== "unpublish") {
		const facts = await readSiteIndexingFacts(ctx);
		if (facts.state !== "ok") {
			ctx.log.warn("seo:indexnow automatic notification skipped because the site settings are unreadable", {
				collection,
				reason,
				state: facts.state,
			});
			return;
		}
		if (!(await indexNowContentIsIndexable(ctx, collection, item, facts))) return;
	}
	const url = reason === "unpublish"
		? normalizeIndexNowUrl(snapshot?.url ?? "", siteOrigin)
		: await indexNowEventUrl(ctx, definition, item, siteOrigin);
	if (!url) return;
	const hadPreviousUrl = reason !== "unpublish" && snapshotAvailable && typeof snapshot?.url === "string" && snapshot.url.length > 0;
	const previousUrl = hadPreviousUrl
		? normalizeIndexNowUrl(snapshot?.url ?? "", siteOrigin)
		: null;
	const urlChanged = hadPreviousUrl && snapshot?.url !== url;
	if (reason !== "unpublish" && snapshotAvailable && !urlChanged) {
		try {
			await ctx.kv.set(snapshotKey, { url });
		} catch (error: unknown) {
			ctx.log.warn("seo:indexnow published URL snapshot failed", { collection, id, error: String(error) });
		}
	}
	const candidates: IndexNowUrlCandidate[] = [
		...(urlChanged && previousUrl
			? [{ url: previousUrl, ref: contentRef(collection, item), reason: "unpublish" as const, event: "url-change" as const }]
			: []),
		{ url, ref: contentRef(collection, item), reason },
	];
	const result = await enqueueIndexNowUrls(
		ctx,
		siteOrigin,
		candidates,
		{ delayMs: 5_000, force: reason === "unpublish" || urlChanged },
	);
	if (reason !== "unpublish" && snapshotAvailable && urlChanged &&
		result.success && result.enqueued === candidates.length && result.rejected.length === 0) {
		try {
			await ctx.kv.set(snapshotKey, { url });
		} catch (error: unknown) {
			ctx.log.warn("seo:indexnow published URL snapshot failed", { collection, id, error: String(error) });
		}
	}
	if (reason === "unpublish" && result.success) {
		try {
			await ctx.kv.delete(snapshotKey);
		} catch (error: unknown) {
			ctx.log.warn("seo:indexnow published URL cleanup failed", { collection, id, error: String(error) });
		}
	}
	if (!result.success && result.error !== "indexnow_disabled") {
		ctx.log.warn("seo:indexnow content event was not queued", {
			collection,
			reason,
			error: result.error,
		});
	}
	warnIndexNowHistory(ctx, result.history, { collection, reason });
}

function warnIndexNowHistory(ctx: PluginContext, history: IndexNowHistoryRecording | undefined, detail: Record<string, unknown>): void {
	if (history && history !== "recorded")
		ctx.log.warn("seo:indexnow queued URLs without complete history", { ...detail, history });
}

// Entries published before URL snapshots existed have none; the host can only
// resolve their public URL while they are still published.
async function captureIndexNowUnpublishUrl(event: any, ctx: PluginContext): Promise<void> {
	const collection = cleanCollection(event?.collection);
	const item = event?.content as any;
	const id = clean(item?.id);
	if (!collection || !id) return;
	try {
		const snapshotKey = indexNowPublishedUrlKey(collection, id);
		if ((await ctx.kv.get<{ url?: string }>(snapshotKey))?.url) return;
		const settings = await readIndexNowSettings(ctx);
		if (!settings.values.enabled || !settings.values.autoSubmit) return;
		if (!(await coexistenceAdmission(ctx, "indexnow"))) return;
		const definition = await indexNowEligibleCollection(ctx, collection, settings.values.autoSubmitContentTypes);
		if (!definition || !(await indexNowContentIsIndexable(ctx, collection, item))) return;
		const url = await indexNowEventUrl(ctx, definition, item, await indexNowSiteOrigin(ctx));
		if (url) await ctx.kv.set(snapshotKey, { url });
	} catch (error: unknown) {
		ctx.log?.warn?.("seo:indexnow unpublish URL capture failed", { collection, id, error: String(error) });
	}
}

async function captureIndexNowDeleteUrl(event: any, ctx: PluginContext): Promise<void> {
	const collection = cleanCollection(event?.collection);
	const id = clean(event?.id);
	if (!collection || !id) return;
	const snapshotKey = indexNowPublishedUrlKey(collection, id);
	try {
		if ((await ctx.kv.get<{ url?: string }>(snapshotKey))?.url) return;
		const settings = await readIndexNowSettings(ctx);
		if (!settings.values.enabled || !settings.values.autoSubmit) return;
		if (!(await coexistenceAdmission(ctx, "indexnow"))) return;
		const definition = await indexNowEligibleCollection(ctx, collection, settings.values.autoSubmitContentTypes);
		if (!definition || !ctx.content) return;
		const item = await resolveContentItem(ctx, collection, id);
		if (!item || !(await indexNowContentIsIndexable(ctx, collection, item))) return;
		const url = await indexNowEventUrl(ctx, definition, item, await indexNowSiteOrigin(ctx));
		if (url) await ctx.kv.set(snapshotKey, { url });
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow delete URL capture failed", { collection, id, error: String(error) });
	}
}

async function queueIndexNowDelete(event: any, ctx: PluginContext): Promise<void> {
	const collection = cleanCollection(event?.collection);
	const id = clean(event?.id);
	if (!collection || !id) return;
	const snapshotKey = indexNowPublishedUrlKey(collection, id);
	let snapshot: { url?: string } | null = null;
	try {
		snapshot = await ctx.kv.get<{ url?: string }>(snapshotKey);
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow published URL lookup failed", { collection, id, error: String(error) });
		return;
	}
	if (!snapshot?.url) return;
	const settings = await readIndexNowSettings(ctx);
	if (!settings.values.enabled || !settings.values.autoSubmit) return;
	if (!(await coexistenceAdmission(ctx, "indexnow"))) return;
	const definition = await indexNowEligibleCollection(ctx, collection, settings.values.autoSubmitContentTypes);
	if (!definition) return;
	const result = await enqueueIndexNowUrls(
		ctx,
		await indexNowSiteOrigin(ctx),
		[
			{
				url: snapshot.url,
				ref: `${collection}:${id}`,
				reason: "delete",
			},
		],
		{ delayMs: 1_000, force: true },
	);
	if (result.success) {
		try {
			await ctx.kv.delete(snapshotKey);
		} catch (error: unknown) {
			ctx.log.warn("seo:indexnow published URL cleanup failed", { collection, id, error: String(error) });
		}
	}
	warnIndexNowHistory(ctx, result.history, { collection, reason: "delete" });
}

const DEFAULT_REDIRECT_CANDIDATES: readonly SeoRedirectCandidate[] = [
	{ path: "/", title: "Home", collection: "pages" },
];

function isTrustedNotFoundDispatch(routeCtx: any, inputPath: unknown): boolean {
	const method = String(routeCtx?.request?.method ?? "").toUpperCase();
	if (method !== "GET" && method !== "HEAD") return false;
	const reportedPath = normalizeNotFoundPath(inputPath);
	if (!reportedPath) return false;
	try {
		const requestUrl = new URL(String(routeCtx?.request?.url ?? ""));
		return normalizeNotFoundPath(requestUrl.pathname) === reportedPath;
	} catch {
		return false;
	}
}

async function redirectCandidates(ctx: PluginContext): Promise<SeoRedirectCandidate[]> {
	const candidates = [...DEFAULT_REDIRECT_CANDIDATES];
	if (!ctx.content) return candidates;
	for (const definition of await resolveContentCollections(ctx)) {
		const collection = definition.collection;
		let cursor: string | undefined;
		let inspected = 0;
		const seen = new Set<string>();
		do {
			// Suggestions degrade per collection; one unreadable collection must not fail the 404 view.
			let result: PluginContentListResult | null;
			try {
				result = await listAvailableContentCollection(ctx.content, collection, {
					limit: 100,
					cursor,
					orderBy: { updatedAt: "desc" },
				});
			} catch (error) {
				ctx.log?.warn?.("seo: redirect suggestions skipped a content type", { collection, error: String(error) });
				result = null;
			}
			if (!result) break;
			for (const item of result.items) {
				inspected += 1;
				if (!contentItemIsPublished(item)) continue;
				const path = normalizeNotFoundPath(await publicUrlForContent(ctx, collection, item));
				if (path) candidates.push({ path, title: contentItemTitle(item, definition.titleField), collection });
				if (inspected >= 1_000) break;
			}
			if (inspected >= 1_000 || !result.cursor || seen.has(result.cursor)) break;
			seen.add(result.cursor);
			cursor = result.cursor;
		} while (cursor);
	}
	return candidates;
}

const monitor404Runtime = createSeo404Runtime({
	isEnabled: async (ctx) => (await getModules(ctx)).monitor404,
	loadRedirectCandidates: redirectCandidates,
	valuesEqual: portabilityValueEquals,
});

async function buildAdminCrawlDiagnostics(ctx: PluginContext): Promise<SeoAdminCrawlDiagnostics> {
	const entries: SeoCrawlEntryInput[] = [];
	if (!ctx.content) throw new Error("Content access is unavailable for crawl diagnostics.");
	const site = await readReadableSiteSettings(ctx);
	const collectionSource = await resolveContentCollectionSource(ctx);
	let coverageLimited = !collectionSource.available;
	let inspectedRecords = 0;
	let scannedDocumentNodes = 0;
	let retainedLinks = 0;
	let reachedEntryLimit = false;
	let reachedDocumentLimit = false;
	let reachedLinkLimit = false;
	for (const [collectionIndex, definition] of collectionSource.definitions.entries()) {
		const collection = definition.collection;
		let cursor: string | undefined;
		const seen = new Set<string>();
		do {
			const remaining = SEO_CRAWL_LIMITS.maxEntries - inspectedRecords;
			if (remaining <= 0) {
				coverageLimited = true;
				reachedEntryLimit = true;
				break;
			}
			const result = await listAvailableContentCollection(ctx.content, collection, {
				limit: Math.min(100, remaining),
				cursor,
				orderBy: { updatedAt: "desc" },
			});
			if (!result || result.items.length === 0) {
				if (!result || result.hasMore || result.cursor) coverageLimited = true;
				break;
			}
			for (const item of result.items.slice(0, remaining)) {
				inspectedRecords += 1;
				if (!contentItemIsPublished(item)) continue;
				const data = (item?.data ?? {}) as Record<string, any>;
				const routeUrl = await publicUrlForContent(ctx, collection, item);
				if (!routeUrl) {
					coverageLimited = true;
					continue;
				}
				const signals = extractSeoCrawlLinks(contentBodyValue(data, definition), {
					maxNodes: Math.min(SEO_CRAWL_LIMITS.maxDocumentNodes, SEO_CRAWL_LIMITS.maxTotalDocumentNodes - scannedDocumentNodes),
					maxLinks: SEO_CRAWL_LIMITS.maxLinks - retainedLinks,
				});
				scannedDocumentNodes += signals.scannedNodes;
				retainedLinks += signals.links.length;
				if (signals.limited) {
					coverageLimited = true;
					reachedDocumentLimit = true;
				}
				if (retainedLinks >= SEO_CRAWL_LIMITS.maxLinks && signals.limited) reachedLinkLimit = true;
				const seo = (item?.seo ?? data.seo ?? {}) as Record<string, unknown>;
				const effective = await resolveEffectiveContentMetadata(ctx, collection, item, undefined, site.values);
				entries.push({
					ref: contentRef(collection, item),
					collection,
					entryId: String(item.id),
					title: contentItemTitle(item, definition.titleField),
					url: routeUrl,
					indexable: effective ? effective.indexable : seo.noIndex !== true,
					bodySource: clean(data.body_source),
					structured: signals.structured,
					links: signals.links,
				});
			}
			if (inspectedRecords >= SEO_CRAWL_LIMITS.maxEntries) {
				if (result.items.length > remaining || result.hasMore || result.cursor || collectionIndex + 1 < collectionSource.definitions.length) {
					coverageLimited = true;
					reachedEntryLimit = true;
				}
				break;
			}
			if (!result.cursor) {
				if (result.hasMore) coverageLimited = true;
				break;
			}
			if (seen.has(result.cursor)) {
				coverageLimited = true;
				break;
			}
			seen.add(result.cursor);
			cursor = result.cursor;
		} while (cursor);
		if (inspectedRecords >= SEO_CRAWL_LIMITS.maxEntries) break;
	}
	const report = analyzeSeoCrawlGraph(entries, ["/"], coverageLimited);
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt: new Date().toISOString(),
		...report,
		limits: {
			...report.limits,
			inspectedRecords,
			scannedDocumentNodes,
			reachedEntryLimit: reachedEntryLimit || report.limits.reachedEntryLimit,
			reachedLinkLimit: reachedLinkLimit || report.limits.reachedLinkLimit,
			reachedDocumentLimit,
		},
	};
}

function indexNowSettingsUpdateFailure(
	reason: Extract<IndexNowSettingsUpdateResult, { updated: false }>["reason"],
): SeoAdminIndexNowSaveResult {
	return {
		success: false,
		errors: {
			_form:
				reason === "changed"
				? "IndexNow settings changed in another session. Refresh, reset to the latest settings, then reapply your changes."
				: "IndexNow settings are being updated in another request. Try again.",
		},
	};
}

async function indexNowOperationResult(
	ctx: PluginContext,
	siteOrigin: string,
	queued: Awaited<ReturnType<typeof enqueueIndexNowUrls>>,
	deliver: { force: boolean } | null,
	fallbackError: "no_valid_urls" | "no_due_jobs",
	fallbackDetail: string,
): Promise<SeoAdminIndexNowOperationResult> {
	if (!queued.success) {
		return {
			success: false,
			error: queued.error ?? fallbackError,
			detail: queued.detail ?? fallbackDetail,
			indexNow: await indexNowAdminStatus(ctx, siteOrigin),
		};
	}
	let history = queued.history;
	if (deliver && queued.enqueued) {
		const delivery = await deliverIndexNowQueue(ctx, siteOrigin, deliver);
		if (history === "recorded" && delivery.history && delivery.history !== "recorded") history = "partial";
		if (!delivery.success && delivery.error !== "no_due_jobs") {
			return {
				success: false,
				error: delivery.error ?? "delivery_failed",
				detail: delivery.detail ?? "IndexNow delivery failed.",
				indexNow: await indexNowAdminStatus(ctx, siteOrigin),
			};
		}
	}
	return {
		success: true,
		enqueued: queued.enqueued,
		skipped: queued.skipped,
		rejected: queued.rejected,
		...(history ? { history } : {}),
		indexNow: await indexNowAdminStatus(ctx, siteOrigin),
	};
}

// Lengths above the path limit still parse, so the command can explain them.
const redirectRuleRouteInput = z.object({
	source: z.string().max(REDIRECT_PATH_MAX_LENGTH * 2),
	destination: z.string().max(REDIRECT_PATH_MAX_LENGTH * 2),
	type: z.union([z.literal(301), z.literal(302)]),
}).strict();

const redirectEditId = z.string().min(1).max(REDIRECT_ID_MAX_LENGTH);
const redirectEditRevision = z.string().min(1).max(REDIRECT_REVISION_MAX_LENGTH);
const redirectEditDraft = z.object({
	source: z.string().max(REDIRECT_EDIT_INPUT_MAX_LENGTH),
	destination: z.string().max(REDIRECT_EDIT_INPUT_MAX_LENGTH),
	type: z.union([z.literal(301), z.literal(302)]),
	enabled: z.boolean(),
}).strict();
const redirectEditLoadInput = z.object({ id: redirectEditId }).strict();
const redirectEditUpdateInput = redirectEditDraft.extend({
	id: redirectEditId,
	revision: redirectEditRevision,
}).strict();
const redirectEditRecoveryInput = z.object({
	id: redirectEditId,
	revision: redirectEditRevision,
	baseline: z.object({
		source: z.string().max(REDIRECT_PATH_MAX_LENGTH),
		destination: z.string().max(REDIRECT_PATH_MAX_LENGTH),
		type: z.union([z.literal(301), z.literal(302)]),
		enabled: z.boolean(),
		isPattern: z.literal(false),
		groupName: z.string().max(REDIRECT_GROUP_MAX_LENGTH).nullable(),
		auto: z.boolean(),
	}).strict(),
	draft: redirectEditDraft,
}).strict();

function redirectLoadResponse(result: RedirectRuleLoadResult): SeoAdminRedirectRuleLoadResult {
	const response = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, ...result };
	if (jsonUtf8LengthWithin(response, SEO_ADMIN_REDIRECT_EDIT_LIMITS.resultBytes) !== null) return response;
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		status: "failed",
		message: "EmDash returned more redirect data than this form can read. Review the redirect in EmDash Redirects.",
		retryable: true,
	};
}

function redirectUpdateResponse<T extends RedirectRuleUpdateResult>(
	result: T,
): { contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & (
	T | Extract<RedirectRuleUpdateResult, { status: "uncertain" }>
) {
	const response = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, ...result };
	if (jsonUtf8LengthWithin(response, SEO_ADMIN_REDIRECT_EDIT_LIMITS.resultBytes) !== null) return response;
	// A response-size failure after a write cannot establish that nothing was saved.
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		status: "uncertain",
		reason: "unreadable",
		message: "This plugin cannot read the result of this change. Check the saved redirect before trying again.",
	};
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin = {
	hooks: {
		"plugin:install": {
			handler: async (_event: unknown, ctx: PluginContext) => {
				ctx.log.info("shipit-seo installed");
			},
		},

		// THE core SEO surface. Wrapped in try/catch so a bad config or schema never
		// breaks page render — on error we log and contribute nothing.
		"page:metadata": {
			handler: async (event: { page: PublicPageContext }, ctx: PluginContext) => {
				try {
					return await buildPageMetadata(event.page, ctx as any);
				} catch (err: unknown) {
					(ctx as any).log.warn("seo: page:metadata failed", {
						err: String(err),
					});
					return null;
				}
			},
		},

		"content:afterSave": {
			errorPolicy: "continue",
			handler: async (event: any, ctx: PluginContext) => {
				await refreshScoreFromContentEvent(event, ctx);
				await queueIndexNowContentEvent(event, ctx, "update");
			},
		},

		"content:afterPublish": {
			errorPolicy: "continue",
			handler: async (event: any, ctx: PluginContext) => {
				await refreshScoreFromContentEvent(event, ctx as any);
				await queueIndexNowContentEvent(event, ctx, "publish");
			},
		},

		// A content policy hook: it must never cancel the unpublish, and a failure
		// here must not block it, so errors are swallowed and nothing is returned.
		"content:beforeUnpublish": {
			errorPolicy: "continue",
			handler: async (event: any, ctx: PluginContext) => {
				await captureIndexNowUnpublishUrl(event, ctx);
			},
		},

		"content:afterUnpublish": {
			errorPolicy: "continue",
			handler: async (event: any, ctx: PluginContext) => {
				await refreshScoreFromContentEvent(event, ctx);
				await queueIndexNowContentEvent(event, ctx, "unpublish");
			},
		},

		"content:afterRestore": {
			errorPolicy: "continue",
			handler: refreshScoreFromContentEvent,
		},

		"content:afterSchedule": {
			errorPolicy: "continue",
			handler: refreshScoreFromContentEvent,
		},

		"content:afterUnschedule": {
			errorPolicy: "continue",
			handler: refreshScoreFromContentEvent,
		},

		"content:beforeDelete": {
			errorPolicy: "continue",
			handler: async (event: any, ctx: PluginContext) => {
				await captureIndexNowDeleteUrl(event, ctx);
		},
		},

		"content:afterDelete": {
			errorPolicy: "continue",
			handler: async (event: any, ctx: PluginContext) => {
				await queueIndexNowDelete(event, ctx);
				await cleanupAnalysisFromContentEvent(event, ctx);
			},
		},

		cron: {
			errorPolicy: "continue",
			handler: async (event: any, ctx: PluginContext) => {
				if (!isIndexNowDrainTask(String(event?.name ?? ""))) return;
				await deliverIndexNowQueue(ctx, await indexNowSiteOrigin(ctx), {
					currentTask: String(event.name),
				});
			},
		},
	},

	routes: {
		"admin-branding": {
			permission: "plugins:read" as const,
			methods: ["GET"] as ["GET"],
			input: z.object({}).optional(),
			handler: async (_routeCtx: unknown, ctx: PluginContext): Promise<SeoAdminBranding> => {
				const branding = brandingHosts.get(ctx as object);
				return { logo: branding?.logo ?? null, logoDark: branding?.logoDark ?? null };
			},
		},
		"admin-plugin-coexistence": {
			permission: "plugins:read" as const,
			methods: ["GET"] as ["GET"],
			input: z.object({}).optional(),
			handler: async (_routeCtx: unknown, ctx: PluginContext) => {
				const inventory = await readCoexistenceInventory(ctx);
				return inventory ?? {
					status: "unsupported", scope: "checked-catalog",
					message: "Plugin output checks need the native installation adapter.",
				};
			},
		},
		"admin-crawl-diagnostics": {
			input: z.any().optional(),
			handler: async (_routeCtx: any, ctx: PluginContext): Promise<SeoAdminCrawlDiagnostics> =>
				buildAdminCrawlDiagnostics(ctx),
		},

		// The site calls this in-process before its existing /404 redirect. Only the
		// original normalized pathname and aggregate count are retained; request
		// identity is discarded.
		"public-log-404": {
			public: true,
			input: z.object({ path: z.string().min(1).max(1_024) }),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				if (!isTrustedNotFoundDispatch(routeCtx, routeCtx.input.path)) {
					return { success: true, recorded: false, reason: "untrusted" as const };
				}
				return monitor404Runtime.logNotFoundPath(ctx, routeCtx.input.path);
			},
		},

		"admin-404-monitor": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdmin404Monitor> => {
				const input = routeInput(routeCtx);
				return monitor404Runtime.buildAdmin404Monitor(ctx, clampInt(input.limit, 1, 200, 100));
			},
		},

		"triage-admin-404": {
			input: z.object({
				id: z.string().min(1).max(128),
				status: z.enum(["open", "ignored", "resolved"]),
				redirectTarget: z.string().max(1_024).nullable().optional(),
				limit: z.number().int().min(1).max(200).optional(),
			}),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdmin404TriageResult> =>
				monitor404Runtime.triageNotFoundPath(ctx, routeCtx.input),
		},

		// EmDash owns redirect records. The host checks these permissions, the
		// session CSRF header and token scope before a handler runs.
		"admin-redirect-rules": {
			permission: "redirects:read",
			input: z.object({
				search: z.string().max(REDIRECT_SEARCH_MAX_LENGTH).nullable().optional(),
				enabled: z.boolean().nullable().optional(),
				auto: z.boolean().nullable().optional(),
				group: z.string().max(REDIRECT_GROUP_MAX_LENGTH).nullable().optional(),
				limit: z.number().int().min(1).max(REDIRECT_LIST_MAX_PAGE_SIZE).optional(),
				cursor: z.string().max(1_024).nullable().optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminRedirectRuleListResult> => ({
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				...await listRedirectRules(emdashRedirectHost(ctx), routeCtx.input ?? {}, {
					canManage: canManageRedirects(routeCtx.user),
				}),
			}),
		},

		"create-admin-redirect-rule": {
			permission: "redirects:manage",
			input: redirectRuleRouteInput,
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminRedirectRuleCreateResult> => ({
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				...await createRedirectRule(emdashRedirectHost(ctx), routeCtx.input),
			}),
		},

		// Read-only recovery for a create whose response never reached the admin.
		"reconcile-admin-redirect-rule": {
			permission: "redirects:read",
			input: redirectRuleRouteInput,
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminRedirectRuleCreateResult> => ({
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				...await reconcileRedirectRule(emdashRedirectHost(ctx), routeCtx.input),
			}),
		},

		"admin-redirect-rule": {
			permission: "redirects:read",
			request: { body: "json", maxBytes: SEO_ADMIN_REDIRECT_EDIT_LIMITS.loadRequestBytes },
			input: redirectEditLoadInput,
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminRedirectRuleLoadResult> =>
				redirectLoadResponse(await loadRedirectRule(emdashRedirectHost(ctx), routeCtx.input, {
					canManage: canManageRedirects(routeCtx.user),
				})),
		},

		"update-admin-redirect-rule": {
			permission: "redirects:manage",
			request: { body: "json", maxBytes: SEO_ADMIN_REDIRECT_EDIT_LIMITS.updateRequestBytes },
			input: redirectEditUpdateInput,
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminRedirectRuleUpdateResult> =>
				redirectUpdateResponse(await updateRedirectRule(emdashRedirectHost(ctx), routeCtx.input)),
		},

		"reconcile-admin-redirect-rule-update": {
			permission: "redirects:read",
			request: { body: "json", maxBytes: SEO_ADMIN_REDIRECT_EDIT_LIMITS.recoveryRequestBytes },
			input: redirectEditRecoveryInput,
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminRedirectRuleUpdateRecoveryResult> =>
				redirectUpdateResponse(await reconcileRedirectRuleUpdate(emdashRedirectHost(ctx), routeCtx.input)),
		},

		// ---- PUBLIC: read-only config for optional site integrations ----
		// Exposes ONLY non-sensitive flags. No secrets, no admin config leaks here.
		"public-config": {
			public: true,
			input: z.object({}).passthrough(),
			handler: async (_routeCtx: any, ctx: PluginContext) => {
				// Unreadable settings fail the request instead of reporting a guess.
				const [site, modules] = await Promise.all([readReadableSiteSettings(ctx), getModules(ctx)]);
				const settings = await getGlobalSettings(ctx, undefined, site.values);
				// Content type choices and exclusions stay private; the sitemap
				// XML itself is the public record of what is listed.
				return {
					noindex: site.values.noindex,
					siteName: settings.siteName,
					sitemapUrl: modules.sitemap ? "/sitemap.xml" : null,
					sitemap: { enabled: modules.sitemap, url: "/sitemap.xml" },
				};
			},
		},

		// The key is public by protocol design. The site adapter exposes it as plain
		// text at /indexnow-key.txt; this JSON route keeps storage ownership inside
		// the standard plugin without granting the theme direct database access.
		"public-indexnow-key": {
			public: true,
			input: z.object({}).passthrough(),
			handler: async (_routeCtx: any, ctx: PluginContext) => publicIndexNowKey(ctx),
		},

		"admin-indexnow": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeInput(routeCtx);
				return indexNowAdminStatus(
					ctx,
					await indexNowSiteOrigin(ctx),
					clampInt(input.limit, 1, 100, 25),
				);
			},
		},

		"setup-admin-indexnow": {
			input: z.object({ expectedUpdatedAt: z.string().max(100).nullable() }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminIndexNowSaveResult> => {
				const input = routeInput(routeCtx);
				if (routeCtx.request?.method !== "POST" ||
					!(input.expectedUpdatedAt === null || typeof input.expectedUpdatedAt === "string"))
					return { success: false, errors: { _form: "Submit setup with the current settings revision." } };
				try {
					const updated = await setupIndexNow(ctx, input.expectedUpdatedAt as string | null, () => indexNowSiteOrigin(ctx), {
						installation: indexNowInstallation(ctx),
					});
					return {
						success: true,
						indexNow: await indexNowAdminStatus(ctx, await indexNowSiteOrigin(ctx), undefined, updated),
					};
				} catch (error) {
					return error instanceof IndexNowSetupError
						? { success: false, errors: { _form: error.message }, failedStep: error.step }
						: { success: false, errors: { _form: "IndexNow setup could not complete. Refresh the settings and try again." } };
				}
			},
		},

		"save-admin-indexnow-automation": {
			input: z.object({
				expectedUpdatedAt: z.string().max(100).nullable(),
				action: z.enum(["start", "stop", "scope"]),
				contentTypes: z.array(z.string().max(64)).max(100).nullable().optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminIndexNowSaveResult> => {
				if (routeCtx.request?.method !== "POST")
					return { success: false, errors: { _form: "Submit automatic submission changes with the current settings revision." } };
				const input = routeCtx.input as {
					expectedUpdatedAt: string | null;
					action: "start" | "stop" | "scope";
					contentTypes?: string[] | null;
				};
				const [siteOrigin, discovered, indexing] = await Promise.all([
					indexNowSiteOrigin(ctx),
					resolveIndexNowContentCollections(ctx),
					readSiteIndexingFacts(ctx),
				]);
				const updated = await updateIndexNowAutomation(ctx, input, {
					siteOrigin,
					installation: indexNowInstallation(ctx),
					discovery: {
						available: discovered.available,
						collections: discovered.definitions.map((definition) => definition.collection),
						noindex: indexing.state === "ok" ? indexing.contentTypeNoindex : [],
					},
				});
				if (!updated.updated) {
					return updated.reason === "invalid"
						? { success: false, errors: updated.errors }
						: indexNowSettingsUpdateFailure(updated.reason);
				}
				return { success: true, indexNow: await indexNowAdminStatus(ctx, siteOrigin, undefined, updated) };
			},
		},

		// History is read only through this bounded page route; it never builds
		// the full status, scans queue jobs or enumerates content.
		"admin-indexnow-history": {
			input: z.object({
				cursor: z.string().max(1_024).nullable().optional(),
				limit: z.number().int().min(1).max(INDEXNOW_HISTORY_MAX_PAGE_SIZE).optional(),
				status: z.enum(INDEXNOW_SUBMISSION_STATUSES as [IndexNowSubmissionStatus, ...IndexNowSubmissionStatus[]]).nullable().optional(),
				source: z.enum(["automatic", "manual"]).nullable().optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminIndexNowHistoryResult> => {
				const page = await listIndexNowHistory(ctx, routeCtx.input ?? {});
				return "error" in page
					? { success: false, error: "invalid_cursor", detail: "This history page is no longer valid. Load the first page again." }
					: { success: true, history: page };
			},
		},

		"admin-indexnow-history-urls": {
			input: z.object({
				submissionId: z.string().min(1).max(100),
				page: z.number().int().min(0).max(Math.ceil(INDEXNOW_MANUAL_URL_LIMIT / 100) - 1),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminIndexNowHistoryUrlsResult> => {
				const input = routeCtx.input as { submissionId: string; page: number };
				const urls = await readIndexNowHistoryUrls(ctx, input.submissionId, input.page);
				return urls
					? { success: true, urls }
					: { success: false, error: "not_found", detail: "This history entry or page is no longer available." };
			},
		},

		"save-admin-indexnow": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminIndexNowSaveResult> => {
				const input = routeInput(routeCtx);
				const validation = validateIndexNowSettings(input);
				if (!validation.success) return validation;
				if (validation.values.autoSubmitContentTypes !== null) {
					// Stored types that later disappear stay saveable; otherwise switching
					// IndexNow or automatic submission off would be rejected.
					const [discovered, stored] = await Promise.all([
						resolveIndexNowContentCollections(ctx),
						readIndexNowSettings(ctx),
					]);
					const storedTypes = new Set(stored.values.autoSubmitContentTypes ?? []);
					if (validation.values.autoSubmitContentTypes.some((collection) =>
						!storedTypes.has(collection) &&
						!discovered.definitions.some((definition) => definition.collection === collection))) {
						return { success: false, errors: { autoSubmitContentTypes: "Choose available public content types after enabling collection discovery." } };
					}
				}
				const hasExpectedRevision = Object.prototype.hasOwnProperty.call(
					input,
					"expectedUpdatedAt",
				);
				if (
					hasExpectedRevision &&
					input.expectedUpdatedAt !== null &&
					typeof input.expectedUpdatedAt !== "string"
				) {
					return {
						success: false,
						errors: { _form: "The IndexNow settings revision is invalid." },
					};
				}
				const updated = await updateIndexNowSettings(
					ctx,
					() => validation.values,
					hasExpectedRevision
						? { expectedUpdatedAt: input.expectedUpdatedAt as string | null }
						: undefined,
				);
				if (!updated.updated) return indexNowSettingsUpdateFailure(updated.reason);
				return {
					success: true,
					indexNow: await indexNowAdminStatus(
						ctx,
						await indexNowSiteOrigin(ctx),
						undefined,
						updated,
					),
				};
			},
		},

		"generate-admin-indexnow-key": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminIndexNowSaveResult> => {
				const input = routeInput(routeCtx);
				const hasExpectedRevision = Object.prototype.hasOwnProperty.call(
					input,
					"expectedUpdatedAt",
				);
				if (
					hasExpectedRevision &&
					input.expectedUpdatedAt !== null &&
					typeof input.expectedUpdatedAt !== "string"
				) {
					return {
						success: false,
						errors: { _form: "The IndexNow settings revision is invalid." },
					};
				}
				const updated = await updateIndexNowSettings(
					ctx,
					(current) => ({
						...current.values,
						apiKey: createIndexNowKey(),
					}),
					hasExpectedRevision
						? { expectedUpdatedAt: input.expectedUpdatedAt as string | null }
						: undefined,
				);
				if (!updated.updated) return indexNowSettingsUpdateFailure(updated.reason);
				return {
					success: true,
					indexNow: await indexNowAdminStatus(
						ctx,
						await indexNowSiteOrigin(ctx),
						undefined,
						updated,
					),
				};
			},
		},

		"submit-admin-indexnow": {
			input: z.object({
				urls: z.array(z.string().min(1).max(2_048)).min(1).max(INDEXNOW_MANUAL_URL_LIMIT),
				force: z.boolean().optional().default(false),
				deliverNow: z.boolean().optional().default(true),
			}),
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminIndexNowOperationResult> => {
				const input = routeCtx.input as {
					urls: string[];
					force: boolean;
					deliverNow: boolean;
				};
				const siteOrigin = await indexNowSiteOrigin(ctx);
				const withheld = await indexNowRuledManualUrls(ctx, siteOrigin, input.urls);
				const remaining = input.urls.filter((url) => !withheld.has(url));
				const contentTypeNoindexUrls = [...withheld];
				if (!remaining.length) {
					return { success: true, enqueued: 0, skipped: 0, rejected: [], contentTypeNoindexUrls,
						indexNow: await indexNowAdminStatus(ctx, siteOrigin) };
				}
				const queued = await enqueueIndexNowUrls(
					ctx,
					siteOrigin,
					remaining.map((url) => ({ url, reason: "manual" as const })),
					{ force: input.force },
				);
				// Beside withheld URLs, no_valid_urls means every remaining line is invalid and stays in the list.
				const settled = withheld.size && !queued.success && queued.error === "no_valid_urls"
					? { success: true, enqueued: 0, skipped: 0, rejected: queued.rejected }
					: queued;
				const result = await indexNowOperationResult(ctx, siteOrigin, settled, input.deliverNow ? { force: false } : null,
					"no_valid_urls", "No URLs were queued.");
				return result.success && withheld.size ? { ...result, contentTypeNoindexUrls } : result;
			},
		},

		"drain-admin-indexnow": {
			input: z.object({ force: z.boolean().optional().default(false) }),
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminIndexNowOperationResult> => {
				const siteOrigin = await indexNowSiteOrigin(ctx);
				const result = await deliverIndexNowQueue(ctx, siteOrigin, {
					force: routeCtx.input.force,
				});
				if (!result.success) {
					return {
						success: false,
						error: result.error ?? "delivery_failed",
						detail: result.detail ?? "IndexNow delivery failed.",
						indexNow: await indexNowAdminStatus(ctx, siteOrigin),
					};
				}
				return {
					success: true,
					enqueued: 0,
					skipped: 0,
					rejected: [],
					...(result.history ? { history: result.history } : {}),
					indexNow: await indexNowAdminStatus(ctx, siteOrigin),
				};
			},
		},

		"retry-admin-indexnow": {
			input: z.object({ deliverNow: z.boolean().optional().default(true) }),
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminIndexNowOperationResult> => {
				const siteOrigin = await indexNowSiteOrigin(ctx);
				const queued = await retryFailedIndexNowJobs(ctx, siteOrigin);
				return indexNowOperationResult(ctx, siteOrigin, queued, routeCtx.input.deliverNow ? { force: true } : null,
					"no_due_jobs", "No failed URLs were queued.");
			},
		},

		"retry-admin-indexnow-submission": {
			input: z.object({
				submissionId: z.string().min(1).max(100),
				deliverNow: z.boolean().optional().default(true),
			}).strict(),
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminIndexNowOperationResult> => {
				const input = routeCtx.input as { submissionId: string; deliverNow: boolean };
				const siteOrigin = await indexNowSiteOrigin(ctx);
				const queued = await retryIndexNowSubmission(ctx, siteOrigin, input.submissionId);
				return indexNowOperationResult(ctx, siteOrigin, queued, input.deliverNow ? { force: true } : null,
					"no_due_jobs", "No failed URLs were queued.");
			},
		},

		"admin-portability-export": {
			input: z.any().optional(),
			handler: async (_routeCtx: any, ctx: PluginContext): Promise<SeoPortabilityExportResponse> =>
				buildSeoPortabilityExport(ctx),
		},

		"admin-portability-preview": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoPortabilityPreviewResult> => {
				const input = routeInput(routeCtx);
				if (input.mode !== "merge" && input.mode !== "replace") {
					return {
						success: false,
						error: "invalid_bundle",
						errors: ["Choose merge or replace import mode."],
					};
				}
				return previewSeoPortabilityRoute(ctx, input.bundle, input.mode);
			},
		},

		"admin-portability-apply": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoPortabilityApplyResult> => {
				const input = routeInput(routeCtx);
				if (input.mode !== "merge" && input.mode !== "replace") {
					return {
						success: false,
						error: "invalid_bundle",
						detail: "Choose merge or replace import mode.",
						errors: ["mode must be merge or replace."],
					};
				}
				return applySeoPortabilityRoute(
					ctx,
					input.bundle,
					input.mode,
					input.confirmation,
					input.planFingerprint,
				);
			},
		},

		// Structured product API consumed by the optional native Kumo admin companion.
		// The SEO engine remains a standard/sandbox-compatible plugin; only presentation
		// is trusted React. Keep this contract free of secrets and raw HTML.
		"admin-overview": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeInput(routeCtx);
				return buildAdminOverview(ctx, clampInt(input.limit, 6, 100, 50));
			},
		},

		"admin-content-options": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeInput(routeCtx);
				const collection = clean(input.collection);
				if (!collection) {
					if (input.cursor !== undefined) throw new Error("Choose a content type before paging content.");
					return buildAdminContentOptions(ctx);
				}
				const limit = Number(input.limit);
				if (!Number.isInteger(limit) || limit < 1 || limit > 25)
					throw new Error("Choose a content page size from 1 to 25.");
				const cursor = input.cursor === undefined ? undefined : clean(input.cursor);
				if (input.cursor !== undefined && (!cursor || cursor.length > 2_048))
					throw new Error("The content cursor is invalid.");
				return buildAdminContentOptions(ctx, collection, limit, cursor);
			},
		},

		"audit-content-options": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeInput(routeCtx);
				const definitions = await resolveContentCollections(ctx);
				const response = {
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					generatedAt: new Date().toISOString(),
					engineVersion: SEO_ENGINE_VERSION,
					collections: definitions,
					items: [] as SeoAdminContentOptions["items"],
					hasMore: false,
				};
				if (!input.collection) return response;
				const definition = definitions.find((item) => item.collection === input.collection);
				if (!definition || !ctx.content) throw new Error("Select an available content type.");
				const cursor = typeof input.cursor === "string" ? input.cursor : undefined;
				const page = await ctx.content.list(definition.collection, {
					limit: 25, cursor, orderBy: { updatedAt: "desc" },
				});
				if (page.items.length > 25 || (page.hasMore && (!page.cursor || page.cursor === cursor || !page.items.length)))
					throw new Error("Content pagination did not advance within its limit.");
				return {
					...response,
					items: page.items.map((item: any) => ({
						ref: contentRef(definition.collection, item),
						entryId: String(item.id), collection: definition.collection,
						collectionLabel: definition.label, title: contentItemTitle(item, definition.titleField),
						updatedAt: contentSourceUpdatedAt(item),
					})),
					...(page.hasMore ? { cursor: page.cursor } : {}),
					hasMore: Boolean(page.hasMore),
				};
			},
		},

		"admin-indexing-taxonomies": {
			permission: "plugins:manage",
			methods: ["GET"],
			request: { body: "none" },
			handler: async (_routeCtx: any, ctx: PluginContext) => listIndexingTaxonomies(ctx),
		},

		"admin-settings": {
			input: z.any().optional(),
			handler: async (_routeCtx: any, ctx: PluginContext) => buildAdminSettings(ctx),
		},

		"save-admin-settings": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSettingsSaveResult> => {
				const input = routeInput(routeCtx);
				const guard = validateSeoAdminSettingsWriteGuard(input);
				if (!guard.success) return guard;
				const validation = validateSeoAdminSettings(input);
				if (!validation.success) return validation;
				const current = await readSiteSettings(ctx);
				if (isReadableSiteSettings(current)) {
					if (current.revision !== guard.guard.expectedRevision ||
						(guard.guard.expectedRevision === null &&
							(!("legacy" in current) || await legacySettingsGuard(current.legacy) !== guard.guard.expectedLegacyGuard))) {
						return saveAdminSettingsIfCurrent(ctx, validation.values, guard.guard, current);
					}
					const locked = await legacyPublisherGuard(ctx, validation.values, current.values);
					if (locked) return locked;
					const taxonomyError = await validateNewArchiveSelections(
						ctx, validation.values.taxonomyArchiveNoindex, current.values.taxonomyArchiveNoindex,
					);
					if (taxonomyError) return { success: false, errors: { taxonomyArchiveNoindex: taxonomyError } };
					const contentTypeError = await validateNewContentTypeNoindex(
						ctx, validation.values.contentTypeNoindex, current.values.contentTypeNoindex,
					);
					if (contentTypeError) return { success: false, errors: { contentTypeNoindex: contentTypeError } };
				}
				return saveAdminSettingsIfCurrent(ctx, validation.values, guard.guard, current);
			},
		},

		"save-custom-verification-tags": {
			permission: "settings:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: 12_288 },
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSettingsSaveResult> =>
				saveCustomVerificationTags(ctx, routeInput(routeCtx)),
		},

		"admin-analysis-profile": {
			permission: "plugins:manage",
			input: z.object({ collection: z.string().min(1).max(64) }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const collection = await supportedContentCollection(ctx, routeCtx.input.collection);
				if (!collection) throw new Error("Choose an available content type.");
				return { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, collection,
					selection: await readCollectionAnalysisProfile(ctx, collection) };
			},
		},

		"save-analysis-profile": {
			permission: "plugins:manage",
			input: z.object({ collection: z.string().min(1).max(64), profile: z.enum(["article", "general"]), expectedRevision: z.string().min(1).max(128).nullable() }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const answer = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION };
				const collection = await supportedContentCollection(ctx, routeCtx.input.collection);
				if (!collection) return { ...answer, success: false as const, error: "unsupported_collection" };
				const saved = await saveCollectionAnalysisProfile(ctx, collection, routeCtx.input);
				return saved.success ? { ...answer, success: true as const, collection, selection: saved.value }
					: { ...answer, success: false as const, error: saved.error, ...(saved.error === "conflict" ? { conflict: true } : {}) };
			},
		},

		"save-content-scoring": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSettingsSaveResult> => {
				const validation = validateSeoContentScoringChange(routeInput(routeCtx));
				if (!validation.success) return validation;
				return saveContentScoring(ctx, validation.values);
			},
		},

		"reset-admin-settings": {
			input: z.object({ expectedRevision: z.string().min(1).max(128) }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSettingsSaveResult> =>
				resetAdminSettings(ctx, routeCtx.input.expectedRevision),
		},

		"admin-sitemap": {
			permission: "plugins:manage",
			input: z.object({}).strict().optional(),
			handler: async (_routeCtx: any, ctx: PluginContext) => buildSitemapAdmin(ctx, sitemapHost(ctx)),
		},

		"save-admin-sitemap": {
			permission: "plugins:manage",
			input: z.object({
				contentTypes: z.record(z.string().max(64), z.boolean()),
				excludedPaths: z.array(z.string().max(512)).max(100),
				expectedRevision: z.string().min(1).max(128).nullable(),
				replaceInvalid: z.literal(true).optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSitemapSaveResult> =>
				saveSitemapSettings(ctx, sitemapHost(ctx), routeCtx.input),
		},

		"reset-admin-sitemap": {
			permission: "plugins:manage",
			input: z.object({ expectedRevision: z.string().min(1).max(128).nullable() }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSitemapSaveResult> =>
				resetSitemapSettings(ctx, sitemapHost(ctx), routeCtx.input),
		},

		"preview-admin-sitemap": {
			permission: "plugins:manage",
			input: z.object({
				collection: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
				after: z.string().min(1).max(SITEMAP_MAX_CURSOR_LENGTH).nullable(),
				search: z.string().max(160).optional(),
				status: z.enum(["all", "included", "excluded"]).optional(),
				limit: z.union([z.literal(25), z.literal(50)]).optional(),
				cursor: z.string().min(1).max(192).nullable().optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSitemapPreview> =>
				previewSitemapFile(ctx, sitemapHost(ctx), routeCtx.input),
		},

		// Readable by everyone who can read EmDash's site settings; the
		// Robots.txt text itself is read and saved through core's settings API.
		"admin-robots-txt": {
			permission: "settings:read",
			input: z.object({}).strict().optional(),
			handler: async (_routeCtx: any, ctx: PluginContext) => buildRobotsTxtFacts(robotsInstallation(ctx)),
		},

		// The llms.txt document and its output switch share one KV revision.
		// Every operation needs plugins:manage at the dispatcher; writes declare
		// bounded JSON so the text arrives as a JSON string with any leading BOM.
		"admin-llms-txt": {
			permission: "plugins:manage",
			methods: ["GET"],
			request: { body: "none" },
			input: z.object({}).strict().optional(),
			handler: async (_routeCtx: any, ctx: PluginContext) => buildLlmsTxtAdmin(ctx, llmsTxtInstallation(ctx)),
		},

		"save-admin-llms-txt": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: LLMS_TXT_WRITE_REQUEST_MAX_BYTES },
			input: z.object({
				expectedRevision: z.string().min(1).max(128).nullable(),
				text: z.string(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) =>
				saveLlmsTxtDocument(ctx, llmsTxtInstallation(ctx), routeCtx.input),
		},

		"set-admin-llms-txt-enabled": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: LLMS_TXT_WRITE_REQUEST_MAX_BYTES },
			input: z.object({ expectedRevision: z.string().min(1).max(128), enabled: z.boolean() }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) =>
				setLlmsTxtEnabled(ctx, llmsTxtInstallation(ctx), routeCtx.input),
		},

		"reset-admin-llms-txt": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: LLMS_TXT_WRITE_REQUEST_MAX_BYTES },
			input: z.object({ expectedRevision: z.string().min(1).max(128), confirm: z.literal(true) }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) =>
				resetCorruptLlmsTxt(ctx, llmsTxtInstallation(ctx), routeCtx.input),
		},

		// ---- PUBLIC: llms.txt for the native Astro middleware ----
		// `pass` when Shipit does not own /llms.txt on this installation. The
		// middleware forwards only a refused method or query, never visitor input.
		"llms-txt": {
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			input: z.object({ refuse: z.enum(["method", "query"]).optional() }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<LlmsTxtHttpResult> =>
				serveLlmsTxt(ctx, llmsTxtInstallation(ctx), (routeCtx.input as { refuse?: "method" | "query" }).refuse ?? null),
		},

		// ---- PUBLIC: sitemap XML for the native Astro middleware ----
		// Returns the same public URLs the XML lists, or `pass` when Shipit does
		// not own /sitemap.xml on this installation.
		"sitemap": {
			public: true,
			methods: ["GET"],
			input: z.object({
				collection: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).optional(),
				after: z.string().min(1).max(SITEMAP_MAX_CURSOR_LENGTH).optional(),
				// A sitemap address with an unsupported query: 404 when Shipit owns the file.
				invalid: z.literal("true").optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SitemapHttpResult> => {
				const input = routeCtx.input as { collection?: string; after?: string; invalid?: "true" };
				const valid = input.invalid === undefined &&
					!(input.collection === undefined && input.after !== undefined) &&
					(input.after === undefined || isSitemapCursor(input.after));
				return serveSitemapFile(ctx, sitemapHost(ctx), !valid
					? null
					: input.collection === undefined
						? { kind: "index" }
						: { kind: "child", collection: input.collection, after: input.after ?? null });
			},
		},

		// One versioned record; each write changes one selected collection under
		// the KV revision the editor loaded. Preview is read-only.
		"admin-templates": {
			permission: "plugins:manage",
			methods: ["GET"],
			request: { body: "none" },
			handler: async (_routeCtx: any, ctx: PluginContext): Promise<SeoAdminTemplateConfiguration> =>
				boundedAdminTemplateConfiguration(ctx),
		},

		"save-admin-templates": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: SEO_ADMIN_TEMPLATE_WRITE_REQUEST_MAX_BYTES },
			input: z.object({
				collection: z.string().max(64),
				expectedRevision: z.string().max(256).nullable(),
				inheritanceGuard: z.object({
					fields: z.object({
						title: z.string().max(256).nullable(),
						description: z.string().max(256).nullable(),
						socialTitle: z.string().max(256).nullable(),
						socialDescription: z.string().max(256).nullable(),
					}).strict(),
					revisions: z.string().max(256).nullable().optional(),
				}).strict(),
				values: z.object({
					title: z.string().max(2_000),
					description: z.string().max(4_000),
					socialTitle: z.string().max(2_000),
					socialDescription: z.string().max(4_000),
				}).strict(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminTemplatesSaveResult> =>
				adminTemplateCommandResult(ctx, await saveMetadataTemplate(metadataTemplatesHost(ctx), routeCtx.input)),
		},

		"reset-admin-templates": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: SEO_ADMIN_TEMPLATE_SMALL_REQUEST_MAX_BYTES },
			input: z.object({
				collection: z.string().max(64),
				expectedRevision: z.string().max(256).nullable(),
				inheritanceGuard: z.object({
					fields: z.object({
						title: z.string().max(256).nullable(),
						description: z.string().max(256).nullable(),
						socialTitle: z.string().max(256).nullable(),
						socialDescription: z.string().max(256).nullable(),
					}).strict(),
					revisions: z.string().max(256).nullable().optional(),
				}).strict(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminTemplatesSaveResult> =>
				adminTemplateCommandResult(ctx, await resetMetadataTemplate(metadataTemplatesHost(ctx), routeCtx.input)),
		},

		"admin-template-examples": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: SEO_ADMIN_TEMPLATE_SMALL_REQUEST_MAX_BYTES },
			input: z.object({
				collection: z.string().max(64),
				limit: z.number().int().min(1).max(SEO_ADMIN_TEMPLATE_EXAMPLES_MAX_LIMIT),
				cursor: z.string().min(1).max(2_048).optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminTemplateExamplesResult> =>
				listMetadataTemplateExamples({ ctx, targets: () => templateTargetCollections(ctx) }, routeCtx.input),
		},

		"admin-template-example": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: SEO_ADMIN_TEMPLATE_SMALL_REQUEST_MAX_BYTES },
			input: z.object({
				collection: z.string().max(64),
				entryId: z.string().min(1).max(128),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminTemplateExampleResult> =>
				readMetadataTemplateExample({ ctx, targets: () => templateTargetCollections(ctx) }, routeCtx.input),
		},

		"preview-admin-template": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: SEO_ADMIN_TEMPLATE_WRITE_REQUEST_MAX_BYTES },
			input: z.object({
				collection: z.string().max(64),
				entryId: z.string().max(128),
				locale: z.string().max(35),
				values: z.object({
					title: z.string().max(2_000),
					description: z.string().max(4_000),
					socialTitle: z.string().max(2_000),
					socialDescription: z.string().max(4_000),
				}).strict(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminTemplatePreviewResult> =>
				previewMetadataTemplate({ ctx, targets: () => templateTargetCollections(ctx) }, routeCtx.input),
		},

		"admin-entry-preview": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminEntryPreviewResult> => {
				const result = await buildAdminEntryPreview(ctx, routeInput(routeCtx));
				return result.success ? { success: true, preview: result.preview } : result;
			},
		},

		"admin-entry-social": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: SEO_ADMIN_SOCIAL_READ_REQUEST_MAX_BYTES },
			input: z.object({ ref: z.string().min(1).max(256) }).strict(),
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminSocialOverrideReadResult> => {
				const response = {
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: SEO_ENGINE_VERSION,
				};
				const target = await resolveAdminSocialTarget(ctx, routeInput(routeCtx).ref);
				if (!target.success) return { ...response, ...target };
				const result = await readSocialOverrideSnapshot(ctx, target.ref);
				return result.success
					? { ...response, success: true, ref: target.ref, snapshot: result.snapshot }
					: { ...response, success: false, ref: target.ref, error: result.error };
			},
		},

		"save-admin-entry-social": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: SEO_ADMIN_SOCIAL_WRITE_REQUEST_MAX_BYTES },
			input: z.object({
				ref: z.string().min(1).max(256),
				title: z.string().max(2_400),
				description: z.string().max(8_000),
				expectedRevision: z.string().min(1).max(128).nullable(),
			}).strict(),
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminSocialOverrideSaveResult> => {
				const input = routeInput(routeCtx);
				const response = {
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: SEO_ENGINE_VERSION,
				};
				const target = await resolveAdminSocialTarget(ctx, input.ref);
				if (!target.success) return { ...response, ...target, outcome: "rejected" };
				const result = await persistSocialOverride(ctx, target.ref, {
					title: input.title,
					description: input.description,
				}, input.expectedRevision);
				return { ...response, ref: target.ref, ...result };
			},
		},

		"admin-configuration": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeInput(routeCtx);
				return buildAdminConfiguration(ctx, clampInt(input.limit, 1, 200, 100));
			},
		},

		"save-admin-modules": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminModulesSaveResult> =>
				saveAdminModules(ctx, routeInput(routeCtx)),
		},

		"reset-admin-modules": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminModulesSaveResult> =>
				resetAdminModules(ctx, routeInput(routeCtx)),
		},

		"admin-schema-presets": {
			permission: "plugins:manage",
			methods: ["GET"],
			request: { body: "none" },
			input: z.object({}).strict().optional(),
			handler: async (_routeCtx: any, ctx: PluginContext) => buildAdminSchemaPresetConfiguration(ctx),
		},
		"admin-custom-schema": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: 4096 },
			input: z.object({ id: adminSchemaIdInput }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => readAdminCustomSchema(ctx, routeCtx.input.id),
		},
		"save-admin-schema-presets": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: 16384 },
			input: adminSchemaPresetsWriteInput,
			handler: async (routeCtx: any, ctx: PluginContext) => saveAdminSchemaPresets(ctx, routeInput(routeCtx)),
		},

		// The content type schema mapping. Admin-only like the other schema routes;
		// declared so a manifest carries the same boundary to a sandbox host.
		"admin-schema-content-types": {
			permission: "plugins:manage",
			input: z.object({
				expectedRevision: z.string().max(128).nullable().optional(),
				check: z.union([
					z.object({
						action: z.literal("save"),
						values: schemaContentTypeValuesInput,
						replaceInvalid: z.literal(true).optional(),
					}).strict(),
					z.object({ action: z.literal("reset") }).strict(),
				]).optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSchemaContentTypesReadResult> =>
				inspectSchemaContentTypes(schemaContentTypesHost(ctx), routeCtx.input),
		},

		"save-admin-schema-content-types": {
			permission: "plugins:manage",
			input: z.object({
				values: schemaContentTypeValuesInput,
				expectedRevision: z.string().max(128).nullable(),
				replaceInvalid: z.boolean().optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSchemaContentTypesSaveResult> =>
				saveSchemaContentTypes(schemaContentTypesHost(ctx), routeCtx.input),
		},

		"reset-admin-schema-content-types": {
			permission: "plugins:manage",
			input: z.object({
				expectedRevision: z.string().max(128),
				confirmed: z.literal(true),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSchemaContentTypesSaveResult> =>
				resetSchemaContentTypes(schemaContentTypesHost(ctx), routeCtx.input),
		},

		// Business identity and one location. Every write compares the revision the
		// form loaded; the read route's check settles an unconfirmed write.
		"admin-business-identity": {
			permission: "plugins:manage",
			input: z.object({
				expectedRevision: z.string().min(1).max(128).nullable().optional(),
				check: z.object({
					intended: z.record(z.string(), z.unknown()).nullable(),
					loaded: z.record(z.string(), z.unknown()).nullable(),
				}).strict().optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => inspectBusinessIdentity(businessIdentityHost(ctx), routeCtx.input),
		},

		"preview-business-identity": {
			permission: "plugins:manage",
			input: z.object({ document: z.record(z.string(), z.unknown()) }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => previewBusinessIdentity(businessIdentityHost(ctx), routeCtx.input),
		},

		"save-business-identity": {
			permission: "plugins:manage",
			input: z.object({
				document: z.record(z.string(), z.unknown()),
				expectedRevision: z.string().min(1).max(128).nullable(),
				replaceInvalid: z.literal(true).optional(),
				publisherChange: z.object({
					confirmed: z.literal(true),
					fromEntityId: z.string().min(1).max(2048),
					fromType: z.enum(["person", "organization"]),
				}).strict().optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => saveBusinessIdentity(businessIdentityHost(ctx), routeCtx.input),
		},

		"set-business-identity-active": {
			permission: "plugins:manage",
			input: z.object({
				active: z.boolean(),
				expectedRevision: z.string().min(1).max(128),
				confirmed: z.literal(true),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => setBusinessIdentityActive(businessIdentityHost(ctx), routeCtx.input),
		},

		"transition-business-identity-entity": {
			permission: "plugins:manage",
			input: z.object({
				to: z.enum(["origin", "person", "organization"]),
				expectedRevision: z.string().min(1).max(128),
				confirmed: z.literal(true),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => transitionBusinessIdentityEntity(businessIdentityHost(ctx), routeCtx.input),
		},

		// Automatic publisher ownership: one revision-checked KV record. Reads never write it.
		"admin-publisher-ownership": {
			permission: "plugins:manage",
			input: z.object({
				check: z.object({
					mode: z.enum(["automatic", "none"]),
					expectedRevision: z.string().min(1).max(128).nullable(),
				}).strict().optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminPublisherOwnershipReadResult> => ({
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				...(await inspectPublisherOwnership(publisherOwnershipHost(ctx), routeCtx.input ?? {})),
			}),
		},

		"save-admin-publisher-ownership": {
			permission: "plugins:manage",
			input: z.object({
				mode: z.enum(["automatic", "none"]),
				expectedRevision: z.string().min(1).max(128).nullable(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminPublisherOwnershipWriteResult> => ({
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				...(await savePublisherOwnership(publisherOwnershipHost(ctx), routeCtx.input)),
			}),
		},

		"admin-business-identity-pages": {
			permission: "plugins:manage",
			input: z.object({
				collection: z.string().min(1).max(64),
				limit: z.number().int().min(1).max(BUSINESS_IDENTITY_PAGE_LIMIT),
				cursor: z.string().min(1).max(2048).optional(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => listBusinessIdentityPages(businessIdentityHost(ctx), routeCtx.input),
		},

		"reset-admin-schema-presets": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: 4096 },
			input: z.object({ expectedRevision: adminSchemaRevisionInput }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext) => resetAdminSchemaPresets(ctx, routeInput(routeCtx)),
		},

		"save-admin-custom-schema": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: ADMIN_SCHEMA_WRITE_REQUEST_MAX_BYTES },
			input: adminCustomSchemaWriteInput,
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminCustomSchemaSaveResult> =>
				saveAdminCustomSchema(ctx, routeInput(routeCtx)),
		},

		"compose-admin-schema": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: ADMIN_SCHEMA_WRITE_REQUEST_MAX_BYTES },
			input: adminComposedSchemaWriteInput,
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminSchemaComposerSaveResult> =>
				saveAdminComposedSchema(ctx, routeInput(routeCtx)),
		},

		"delete-admin-custom-schema": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: 4096 },
			input: adminCustomSchemaDeleteInput,
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminCustomSchemaDeleteResult> =>
				deleteAdminCustomSchema(ctx, routeInput(routeCtx)),
		},

		// ---- Admin: content-level SEO score API for list badges and inline panels ----
			scores: {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const i = routeInput(routeCtx);
				const collection = await supportedContentCollection(ctx, i.collection);
				const limit = clampInt(i.limit, 1, 200, 100);
				const cursor = typeof i.cursor === "string" ? i.cursor : undefined;
				const storedOnly = toBool(i.storedOnly);
				if (!storedOnly && !(await getContentScoringEnabled(ctx))) return adminContentScores([]);
				if (!storedOnly && collection && await contentAnalysisAdmissionFailure(ctx, collection)) return adminContentScores([]);
				const refs = cleanRefs(i.refs, 200);
				// Stored snapshots make no freshness claim; verification reads each row's exact inputs.
				const storedScores = async (items: SeoScoreRecord[], cursor?: string, hasMore = false) =>
					adminContentScores(items, cursor, hasMore, toBool(i.snapshotOnly) ? false : await verifiedStoredFreshness(ctx, items));

				if (typeof i.ref === "string" && i.ref.trim()) {
					if (storedOnly) {
						const stored = await readStoredScoreSnapshot(ctx, i.ref.trim());
						return storedScores(stored ? [stored] : []);
					}
					if (!ctx.content) return adminContentScores([]);
					const item = await scoreByRef(ctx, i.ref.trim(), clean(i.keyword));
					return adminContentScores(item ? [item] : []);
				}

				if (refs.length > 0) {
					const items: SeoScoreRecord[] = [];
					for (const ref of refs) {
						if (storedOnly) {
							const stored = await readStoredScoreSnapshot(ctx, ref);
							if (stored) items.push(stored);
							continue;
						}
						if (!ctx.content) break;
						const item = await scoreByRef(ctx, ref, clean(i.keyword));
						if (item) items.push(item);
					}
					return storedOnly ? storedScores(items) : adminContentScores(items);
				}

				if (!collection) return adminContentScores([]);
				if (storedOnly) {
					const res = await ctx.storage.scores.query({
						where: { collection },
						orderBy: { score: "asc" },
						limit,
						cursor,
					});
					const items = (res.items ?? [])
						.map((item: any) => item.data ?? item)
						.filter(isStoredScoreUsable) as SeoScoreRecord[];
					return storedScores(items, res.cursor, Boolean(res.hasMore));
				}

				if (!ctx.content) return adminContentScores([]);

				const res = await ctx.content.list(collection, {
					limit,
					cursor,
					orderBy: { updatedAt: "desc" },
				});
				const items: SeoScoreRecord[] = [];
				for (const item of res.items) {
					const id = clean(item?.id);
					if (!id) throw new Error("Content page returned an item without an identifier.");
					const score = await scoreByRef(ctx, `${collection}:${id}`, clean(i.keyword));
					if (score) items.push(score);
				}
				return adminContentScores(items, res.cursor, Boolean(res.hasMore));
			},
		},

		"audit-content": {
			permission: "plugins:manage",
			input: z.object({
				refs: z.array(z.string().min(1).max(512)).min(1).max(25),
				snapshots: z.array(SAVED_CONTENT_SNAPSHOT_SCHEMA).max(25).optional(),
			}),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const refs = contentAuditRefs(routeCtx.input?.refs);
				const globalFailure = await contentAnalysisAdmissionFailure(ctx);
				if (globalFailure) return {
					...adminContentScores([]),
					persistence: "session" as const,
					failures: refs.map((ref) => ({ ref, error: globalFailure })),
				};
				const snapshots = routeCtx.input?.snapshots ?? [];
				if (new TextEncoder().encode(JSON.stringify(snapshots)).byteLength > 2 * 1024 * 1024)
					throw new Error("Selected content exceeds the analysis request size limit. Analyze fewer entries.");
				if (new Set(snapshots.map((item: any) => item.ref)).size !== snapshots.length ||
					snapshots.some((item: any) => !refs.includes(item.ref)))
					throw new Error("Saved snapshots must match unique selected entry references.");
				const result = await runContentAudit(refs, async (ref) => {
					const parsed = parseContentRef(ref);
					if (!parsed) return "invalid_ref";
					const collection = await supportedContentCollection(ctx, parsed.collection);
					if (!collection) return "unsupported_collection";
					if (`${collection}:${parsed.identifier}` !== ref) return "invalid_ref";
					const admissionFailure = await contentAnalysisAdmissionFailure(ctx, collection);
					if (admissionFailure) return admissionFailure;
					if (!ctx.content) return "content_unavailable";
					const item = await ctx.content.get(collection, parsed.identifier);
					if (!item || String(item.id) !== parsed.identifier) return "content_not_found";
					const snapshot = snapshots.find((candidate: any) => candidate.ref === ref);
					const analyzedItem = snapshot ? {
						...item, data: snapshot.data, slug: snapshot.slug,
						...(snapshot.seo ? { seo: snapshot.seo } : {}),
					} : item;
					const score = await analyzeContentPreview(ctx, collection, analyzedItem, undefined, item);
					return snapshot ? {
						...score,
						sourceVersion: snapshot.sourceVersion,
						sourceKind: "saved-snapshot" as const,
					} : score;
				});
				return {
					...adminContentScores([]),
					...result,
					persistence: "session" as const,
				};
			},
		},

		// Validates a cached session result without analyzing: the exact entry
		// row and the scoped configuration `audit-content` would read, no writes.
		"entry-analysis-identity": {
			permission: "plugins:manage",
			input: z.object({ ref: z.string().min(1).max(512) }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminEntryAnalysisIdentityResult> => {
				const ref = String(routeCtx.input.ref);
				const answer = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, ref };
				const failure = (error: SeoAdminEntryAnalysisIdentityFailure) => ({ ...answer, success: false as const, error });
				const globalFailure = await contentAnalysisAdmissionFailure(ctx, undefined, "manual-entry");
				if (globalFailure) return failure(globalFailure === "scoring_unavailable" ? "configuration_unreadable" : globalFailure);
				const parsed = parseContentRef(ref);
				if (!parsed) return failure("invalid_ref");
				const collection = await supportedContentCollection(ctx, parsed.collection);
				if (!collection) return failure("unsupported_collection");
				if (`${collection}:${parsed.identifier}` !== ref) return failure("invalid_ref");
				const admissionFailure = await contentAnalysisAdmissionFailure(ctx, collection, "manual-entry");
				if (admissionFailure) return failure(admissionFailure === "scoring_unavailable" ? "configuration_unreadable" : admissionFailure);
				if (!ctx.content) return failure("content_unavailable");
				const item = await ctx.content.get(collection, parsed.identifier);
				if (!item || String(item.id) !== parsed.identifier) return failure("content_not_found");
				try {
					return { ...answer, success: true as const, identity: await readEntryAnalysisIdentity(ctx, collection, item, "manual-entry") };
				} catch (error: unknown) {
					ctx.log?.warn?.("seo: entry analysis identity unreadable", { ref, error: String(error) });
					return failure("configuration_unreadable");
				}
			},
		},

		"analyze-content": {
			input: z.object({}).passthrough(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const globalFailure = await contentAnalysisAdmissionFailure(ctx);
				if (globalFailure) return { success: false, error: globalFailure };
				const i = routeCtx.input ?? {};
				const collection = await supportedContentCollection(ctx, i.collection);
				const id = typeof i.id === "string" ? i.id.trim() : "";
				if (!ctx.content || !collection || !id)
					return { success: false, error: "missing_content_ref" };
				const admissionFailure = await contentAnalysisAdmissionFailure(ctx, collection);
				if (admissionFailure) return { success: false, error: admissionFailure };
				// A trial keyword is never stored, so it is analyzed in session mode.
				if (i.persist === false || i.persist === "false" || clean(i.keyword)) {
					const item = await ctx.content.get(collection, id);
					if (!item) return { success: false, error: "content_not_found" };
					const score = await analyzeContentPreview(ctx, collection, item, clean(i.keyword));
					return {
						success: true,
						item: score,
						persistence: "session" as const,
						scoreVersion: SEO_SCORE_VERSION,
					};
				}
				const outcome = await runSavedScoreLifecycle(ctx, { collection, id });
				if (outcome.status === "saved" || outcome.status === "reused") {
					return { success: true, item: outcome.score, scoreVersion: SEO_SCORE_VERSION, outcome: outcome.status, history: outcome.history };
				}
				return { success: false, error: savedAnalysisFailure(outcome) };
			},
		},

		// Durable analysis of one exact saved entry and locale. The request names
		// the entry only; nothing from the editor or a trial keyword is stored.
		"analyze-saved-content": {
			permission: "plugins:manage",
			input: z.object({
				ref: z.string().min(1).max(512),
				locale: z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).nullable(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSavedAnalysisResult> => {
				const ref = String(routeCtx.input.ref);
				const answer = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, ref };
				const failure = (error: SeoAdminSavedAnalysisFailure) => ({ ...answer, success: false as const, error });
				const parsed = parseContentRef(ref);
				if (!parsed) return failure("invalid_ref");
				const collection = await supportedContentCollection(ctx, parsed.collection);
				if (!collection) return failure("unsupported_collection");
				if (`${collection}:${parsed.identifier}` !== ref) return failure("invalid_ref");
				if (!ctx.content) return failure("content_unavailable");
				const outcome = await runManualSavedScoreLifecycle(ctx, {
					collection,
					id: parsed.identifier,
					locale: routeCtx.input.locale ?? null,
				});
				if (outcome.status === "saved" || outcome.status === "reused") {
					return { ...answer, success: true as const, outcome: outcome.status, history: outcome.history, item: outcome.score };
				}
				return failure(savedAnalysisFailure(outcome));
			},
		},

		"analysis-profile": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminAnalysisProfileResult> => {
				const input = routeInput(routeCtx);
				const response = {
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: SEO_ENGINE_VERSION,
				};
				const parsed = parseContentRef(typeof input.ref === "string" ? input.ref.trim() : "");
				if (!parsed) return { ...response, success: false, error: "invalid_ref" };
				const collection = await supportedContentCollection(ctx, parsed.collection);
				if (!collection) return { ...response, success: false, error: "unsupported_collection" };
				if (!ctx.content) return { ...response, success: false, error: "content_unavailable" };
				const item = await ctx.content.get(collection, parsed.identifier);
				if (!item || String(item.id) !== parsed.identifier)
					return { ...response, success: false, error: "not_found" };
				const ref = contentRef(collection, item);
				try {
					const profile = await readAnalysisProfile(ctx, ref, { persistMigration: false, requireReadable: true });
					return { ...response, success: true, ref, profile };
				} catch {
					return { ...response, success: false, error: "storage_unavailable" };
				}
			},
		},

		"save-focus-keyword": {
			input: z.any().optional(),
			handler: async (
				routeCtx: any,
				ctx: PluginContext,
			): Promise<SeoAdminFocusKeywordSaveResult> => {
				const input = routeInput(routeCtx);
				const response = {
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: SEO_ENGINE_VERSION,
				};
				const parsed = parseContentRef(typeof input.ref === "string" ? input.ref.trim() : "");
				if (!parsed) return { ...response, success: false, error: "invalid_ref" };
				const collection = await supportedContentCollection(ctx, parsed.collection);
				if (!collection)
					return {
						...response,
						success: false,
						error: "unsupported_collection",
					};
				// `keywords: null` updates the pillar flag alone while preserving the
				// stored keyword statement — it must never adopt an inherited content
				// keyword into the profile.
				const keywordInput =
					input.keywords === null
						? null
						: Array.isArray(input.keywords)
							? input.keywords
							: input.keyword;
				if (keywordInput !== null) {
					const validationError = focusKeywordsValidationError(keywordInput);
					if (validationError) return { ...response, success: false, error: validationError };
				}
				if (input.pillar !== undefined && typeof input.pillar !== "boolean") {
					return { ...response, success: false, error: "invalid_keyword" };
				}
				if (!ctx.content) return { ...response, success: false, error: "content_unavailable" };
				const item = await ctx.content.get(collection, parsed.identifier);
				if (!item || String(item.id) !== parsed.identifier)
					return { ...response, success: false, error: "not_found" };

				let profile;
				try {
					profile = await persistAnalysisProfile(ctx, contentRef(collection, item), keywordInput, {
						pillar: input.pillar,
					});
				} catch (error: unknown) {
					ctx.log?.warn?.("seo: focus keyword storage failed", {
						error: String(error),
					});
					return { ...response, success: false, error: "storage_unavailable" };
				}

				if (input.profileOnly === true) {
					return { ...response, success: true, ref: contentRef(collection, item), profile, item: null };
				}
				const outcome = await runSavedScoreLifecycle(ctx, { collection, id: String(item.id) });
				if (outcome.status === "not-found") return { ...response, success: false, error: "not_found" };
				return {
					...response,
					success: true,
					ref: contentRef(collection, item),
					profile,
					item: outcome.status === "saved" || outcome.status === "reused" ? outcome.score : null,
				};
			},
		},

		// ---- Admin: per-entry robots directives (nofollow/noarchive/...) ----
		"entry-directives": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeInput(routeCtx);
				const response = {
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: SEO_ENGINE_VERSION,
				};
				const parsed = parseContentRef(typeof input.ref === "string" ? input.ref.trim() : "");
				if (!parsed) return { ...response, success: false, error: "invalid_ref" };
				const collection = await supportedContentCollection(ctx, parsed.collection);
				if (!collection)
					return {
						...response,
						success: false,
						error: "unsupported_collection",
					};
				try {
					const item = await readMetaOverrideStrict(ctx, `${collection}:${parsed.identifier}`);
					return { ...response, success: true, item };
				} catch (error: unknown) {
					ctx.log?.warn?.("seo: meta override storage read failed", {
						error: String(error),
					});
					return { ...response, success: false, error: "storage_unavailable" };
				}
			},
		},

		"save-entry-directives": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeInput(routeCtx);
				const response = {
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: SEO_ENGINE_VERSION,
				};
				const parsed = parseContentRef(typeof input.ref === "string" ? input.ref.trim() : "");
				if (!parsed) return { ...response, success: false, error: "invalid_ref" };
				const collection = await supportedContentCollection(ctx, parsed.collection);
				if (!collection)
					return {
						...response,
						success: false,
						error: "unsupported_collection",
					};
				const updatesRobots = Object.prototype.hasOwnProperty.call(input, "robots");
				const robots = updatesRobots ? normaliseRobotsDirectives(input.robots) : undefined;
				if (robots === null) {
					return { ...response, success: false, error: "invalid_values" };
				}
				const updatesDisabledPresets = Object.prototype.hasOwnProperty.call(
					input,
					"disabledPresets",
				);
				if (updatesDisabledPresets && !Array.isArray(input.disabledPresets)) {
					return { ...response, success: false, error: "invalid_values" };
				}
				const disabledPresets = updatesDisabledPresets
					? normaliseDisabledPresets(input.disabledPresets)
					: undefined;
				if (disabledPresets === null) {
					return { ...response, success: false, error: "invalid_values" };
				}
				if (!updatesRobots && !updatesDisabledPresets) {
					return { ...response, success: false, error: "invalid_values" };
				}
				if (!ctx.content) return { ...response, success: false, error: "content_unavailable" };
				const contentItem = await ctx.content.get(collection, parsed.identifier);
				if (!contentItem) return { ...response, success: false, error: "not_found" };
				let item: SeoAdminMetaOverride | null;
				try {
					item = await updateMetaOverride(ctx, contentRef(collection, contentItem), {
						...(robots === undefined ? {} : { robots }),
						...(disabledPresets === undefined ? {} : { disabledPresets }),
					});
				} catch (error: unknown) {
					ctx.log?.warn?.("seo: meta override storage failed", {
						error: String(error),
					});
					return { ...response, success: false, error: "storage_unavailable" };
				}
				// Preset suppression affects the schema check, so the stored score
				// refreshes with the save (mirrors save-focus-keyword).
				await runSavedScoreLifecycle(ctx, { collection, id: String(contentItem.id) });
				return { ...response, success: true, item };
			},
		},

		// ---- Admin: full resolved JSON-LD graphs for one entry ----
		"entry-schema-preview": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeInput(routeCtx);
				const response = {
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: SEO_ENGINE_VERSION,
				};
				const result = await buildAdminEntryPreview(ctx, input);
				if (!result.success) {
					const error = result.error === "invalid_template" ? "invalid_values" : result.error;
					return { ...response, success: false, error };
				}
				return {
					...response,
					generatedAt: new Date().toISOString(),
					success: true,
					items: result.schemaGraphs,
				};
			},
		},

		// One entry's own custom JSON-LD. Admin-only like the other schema routes,
		// declared here so a manifest carries the same boundary to a sandbox host.
		"entry-custom-schemas": {
			permission: "plugins:manage",
			input: entrySchemaRefInput.extend({ inspectId: z.string().max(128).optional() }).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminEntrySchemaListResult> => ({
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				...await withEntrySchemaHost(ctx, (host) => listEntrySchemas(host, routeCtx.input)),
			}),
		},

		"save-entry-custom-schema": {
			permission: "plugins:manage",
			input: entrySchemaRefInput.extend({
				id: z.string().max(128),
				expectedRevision: z.string().max(256).nullable(),
				name: z.string().max(ENTRY_SCHEMA_NAME_MAX_LENGTH * 2),
				json: z.string().max(65_536),
				enabled: z.boolean(),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminEntrySchemaSaveResult> => ({
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				...await withEntrySchemaHost(ctx, (host) => saveEntrySchema(host, routeCtx.input)),
			}),
		},

		"remove-entry-custom-schema": {
			permission: "plugins:manage",
			input: entrySchemaRefInput.extend({
				id: z.string().max(128),
				expectedRevision: z.string().max(256),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminEntrySchemaRemoveResult> => ({
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				...await withEntrySchemaHost(ctx, (host) => removeEntrySchema(host, routeCtx.input)),
			}),
		},

		// Predicts the plugin's contribution for one entry with an unsaved
		// record. Reads only; the save command stays the only writer.
		"preview-entry-schema-candidate": {
			permission: "plugins:manage",
			request: { body: "json", maxBytes: ENTRY_SCHEMA_PREVIEW_REQUEST_MAX_BYTES },
			input: entrySchemaCandidateInput,
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminEntrySchemaCandidatePreviewResult> =>
				boundedEntrySchemaCandidatePreview(ctx, routeCtx.input),
		},

		// Saved templates: inert library records that no page reads.
		"schema-library": {
			permission: "plugins:manage",
			request: { body: "none" },
			handler: async (_routeCtx: any, ctx: PluginContext): Promise<SeoAdminSchemaLibrary> =>
				adminSchemaLibrary(ctx, await readSchemaLibrary(schemaLibraryHost(ctx))),
		},

		"save-schema-library-template": {
			permission: "plugins:manage",
			request: { body: "json", maxBytes: SEO_ADMIN_SCHEMA_LIBRARY_WRITE_REQUEST_MAX_BYTES },
			input: z.object({
				mode: z.enum(["create", "update"]),
				expectedRevision: z.string().max(256).nullable(),
				id: z.string().max(64),
				name: z.string().max(ENTRY_SCHEMA_NAME_MAX_LENGTH * 2),
				json: z.string().max(65_536),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSchemaLibraryWriteResult> =>
				adminSchemaLibraryWriteResult(ctx, await saveSchemaLibraryTemplate(schemaLibraryHost(ctx), routeCtx.input)),
		},

		"delete-schema-library-template": {
			permission: "plugins:manage",
			request: { body: "json", maxBytes: 4_096 },
			input: z.object({
				expectedRevision: z.string().max(256),
				id: z.string().max(64),
			}).strict(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminSchemaLibraryWriteResult> =>
				adminSchemaLibraryWriteResult(ctx, await deleteSchemaLibraryTemplate(schemaLibraryHost(ctx), routeCtx.input)),
		},

		"score-trends": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext): Promise<SeoAdminScoreTrends> => {
				const input = routeInput(routeCtx);
				const days = clampInt(input.days, 7, 90, 30);
				const collection = input.collection
					? await supportedContentCollection(ctx, input.collection)
					: null;
				const ref = clean(input.ref) ?? null;
				const snapshots = await listScoreSnapshots(ctx, {
					collection,
					ref,
					limit: 2_000,
				});
				return buildScoreTrends(snapshots, { days, collection, ref });
			},
		},

		"refresh-scores": {
			input: z
				.object({
					collection: z.string().min(1),
					cursor: z.string().min(1).max(2_048).optional(),
					revision: z.string().regex(SCORE_REFRESH_REVISION_PATTERN).optional(),
					limit: z.number().int().min(1).optional(),
					keyword: z.string().optional(),
					status: z.enum(["draft", "published", "scheduled"]).optional(),
					locale: z.string().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
				})
				.passthrough(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const globalFailure = await contentAnalysisAdmissionFailure(ctx);
				if (globalFailure) return { success: false, error: globalFailure };
				const i = routeCtx.input ?? {};
				if (clean(i.keyword)) return { success: false, error: "trial_keyword_not_durable" };
				const collection = await supportedContentCollection(ctx, i.collection);
				if (!ctx.content) return { success: false, error: "content_api_unavailable" };
				if (!collection) return { success: false, error: "unsupported_collection" };
				const admissionFailure = await contentAnalysisAdmissionFailure(ctx, collection);
				if (admissionFailure) return { success: false, error: admissionFailure };
				const cursor = i.cursor === undefined ? undefined : clean(i.cursor);
				if (i.cursor !== undefined && !cursor) return { success: false, error: "invalid_cursor" };
				const revision = i.revision === undefined ? undefined : clean(i.revision);
				if (cursor && !SCORE_REFRESH_REVISION_PATTERN.test(revision ?? "")) {
					throw new Error("Score refresh continuation requires its scoring revision.");
				}
				const result = await refreshScorePage(ctx, collection, {
					cursor,
					revision,
					limit: clampInt(i.limit, 1, 100, 100),
					status: i.status,
					locale: i.locale,
				});
				return {
					success: true,
					collection,
					processed: result.processed,
					updated: result.updated,
					scoreVersion: result.scoreVersion,
					revision: result.revision,
					cursor: result.cursor,
					hasMore: result.hasMore,
				};
			},
		},

		// ---- Admin: durable scoped score scan ----
		// One request runs at most one source window or one entry lifecycle.
		"score-scan": {
			permission: "plugins:manage",
			input: scoreScanRouteInputs.state,
			handler: async (_routeCtx: any, ctx: PluginContext) => scoreScanStateRoute(ctx, scoreScanHost(ctx)),
		},

		"start-score-scan": {
			permission: "plugins:manage",
			input: scoreScanRouteInputs.start,
			handler: async (routeCtx: any, ctx: PluginContext) => startScoreScanRoute(ctx, scoreScanHost(ctx), routeCtx.input),
		},

		"command-score-scan": {
			permission: "plugins:manage",
			input: scoreScanRouteInputs.command,
			handler: async (routeCtx: any, ctx: PluginContext) => commandScoreScanRoute(ctx, scoreScanHost(ctx), routeCtx.input),
		},

		"score-scan-taxonomies": {
			permission: "plugins:manage",
			input: scoreScanRouteInputs.taxonomies,
			handler: async (routeCtx: any, ctx: PluginContext) => scoreScanTaxonomiesRoute(ctx, scoreScanHost(ctx), routeCtx.input),
		},

		"score-scan-terms": {
			permission: "plugins:manage",
			input: scoreScanRouteInputs.terms,
			handler: async (routeCtx: any, ctx: PluginContext) => scoreScanTermsRoute(ctx, scoreScanHost(ctx), routeCtx.input),
		},

		// ---- Admin: read EmDash core SEO for one entry ----
		"entry-seo": {
			input: z.object({
				collection: z.string().min(1),
				id: z.string().min(1),
			}),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const collection = await supportedContentCollection(ctx, routeCtx.input.collection);
				const identifier = String(routeCtx.input.id ?? "").trim();
				if (!ctx.content) return { success: false, error: "content_api_unavailable" };
				if (!collection || !identifier) return { success: false, error: "missing_content_ref" };

				const item = await resolveContentItem(ctx, collection, identifier);
				if (!item) return { success: false, error: "content_not_found" };
				if (item.seo === undefined) return { success: false, error: "seo_disabled" };
				const pendingLegacyRef = await findLegacyOverrideRef(ctx, collection, item);

				return {
					success: true,
					legacyOverrideRef: pendingLegacyRef,
					item: {
						collection,
						id: String(item.id),
						slug: item.slug ?? null,
						title: contentItemTitle(item),
						seo: normaliseCoreSeo(item.seo),
					},
				};
			},
		},

		// ---- Admin: list / get per-entry overrides ----
		overrides: {
			input: z.object({
				ref: z.string().optional(),
				limit: z.number().min(1).max(200).default(100),
				cursor: z.string().optional(),
			}),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const { ref, limit, cursor } = routeCtx.input as {
					ref?: string;
					limit: number;
					cursor?: string;
				};
				if (ref) {
					const rec = (await ctx.storage.overrides.get(ref)) as Override | null;
					return { item: rec ? { id: ref, ...rec } : null };
				}
				const res = await ctx.storage.overrides.query({ limit, cursor });
				return {
					items: res.items.map((i: any) => ({ id: i.id, ...i.data })),
					cursor: res.cursor,
					hasMore: res.hasMore,
				};
			},
		},

		// ---- Admin: discard one reviewed legacy override ----
		"discard-admin-legacy-override": {
			input: z.any().optional(),
			handler: async (routeCtx: any, ctx: PluginContext) => discardLegacyOverride(ctx, routeInput(routeCtx)),
		},

		// ---- Admin: reversible migration from legacy overrides to core SEO ----
		"core-seo-migration-plan": {
			input: z.object({
				refs: z.array(z.string().min(1)).max(100).optional(),
				conflictPolicy: z.enum(["skip", "prefer-core", "prefer-legacy"]).default("skip"),
				limit: z.number().min(1).max(100).default(100),
				cursor: z.string().min(1).max(1_100).optional(),
				// The export belongs to exactly one resolved plan.
				snapshot: z.literal(true).optional(),
			}).refine(
				(input) => input.snapshot !== true ||
					(input.refs?.length === 1 && input.limit === 1 && input.cursor === undefined),
				{ message: "A record snapshot requires exactly one ref, limit 1 and no cursor." },
			),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeCtx.input as {
					refs?: string[];
					conflictPolicy: CoreSeoMigrationConflictPolicy;
					limit: number;
					cursor?: string;
					snapshot?: true;
				};
				const page = input.refs?.length
					? {
						plans: await buildCoreSeoMigrationPlans(ctx, input.conflictPolicy, input.refs, input.limit),
						hasMore: false,
					}
					: await buildCoreSeoMigrationPlanPage(ctx, input.conflictPolicy, input.limit ?? 100, input.cursor);
				const items = page.plans;
				const response = adminMigrationResponse({
					success: true,
					writeAvailable: coreSeoMigrationWriteAvailable(ctx),
					discardAvailable: legacyDiscardAvailable(ctx),
					summary: summariseMigrationPlans(items),
					items: [] as Awaited<ReturnType<typeof publicMigrationPlan>>[],
					...("cursor" in page && page.cursor ? { cursor: page.cursor } : {}),
					hasMore: page.hasMore,
				});
				response.items = await Promise.all(
					items.map((item) =>
						publicMigrationPlan(item, input.conflictPolicy, input.snapshot ? response.generatedAt : undefined)),
				);
				return response;
			},
		},

		"core-seo-migration-apply": {
			input: z.object({
				plans: z
					.array(
						z.object({
							sourceOverrideId: z.string().min(1),
							fingerprint: z.string().regex(/^sha256-[a-f0-9]{64}$/),
						}),
					)
					.min(1)
					.max(100),
				conflictPolicy: z.enum(["skip", "prefer-core", "prefer-legacy"]).default("skip"),
				confirm: z.string(),
			}),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeCtx.input as {
					plans: Array<{ sourceOverrideId: string; fingerprint: string }>;
					conflictPolicy: CoreSeoMigrationConflictPolicy;
					confirm: string;
				};
				if (input.confirm !== "MIGRATE_TO_CORE_SEO") {
					return adminMigrationResponse({
						success: false,
						error: "confirmation_required",
						expected: "MIGRATE_TO_CORE_SEO",
					});
				}
				return adminMigrationResponse(
					await applyCoreSeoMigration(ctx, input.plans, input.conflictPolicy),
				);
			},
		},

		"core-seo-migration-status": {
			input: z.object({
				batchId: z.string().optional(),
				status: z.enum(["prepared", "applied", "rolled-back", "failed"]).optional(),
				limit: z.number().min(1).max(200).default(100),
				cursor: z.string().optional(),
				latest: z.boolean().default(false),
			}),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeCtx.input as {
					batchId?: string;
					status?: CoreSeoMigrationRecordStatus;
					limit: number;
					cursor?: string;
					latest?: boolean;
				};
				let where: Record<string, string> | undefined;
				if (input.batchId) where = { batchId: input.batchId };
				else if (input.status) where = { status: input.status };
				// EmDash 0.40 pages a single-direction orderBy by keyset, so older
				// journal records stay reachable behind the newest page.
				const result = await ctx.storage.migrations.query({
					where,
					limit: input.limit,
					...(input.latest === true ? { orderBy: { createdAt: "desc" } } : {}),
					...(input.cursor ? { cursor: input.cursor } : {}),
				});
				const items = (result.items ?? [])
					.map((item: any) => item.data ?? item)
					.filter((item: any) => !input.status || item.status === input.status);
				return adminMigrationResponse({
					success: true,
					writeAvailable: coreSeoMigrationWriteAvailable(ctx),
					items,
					cursor: result.cursor,
					hasMore: result.hasMore,
				});
			},
		},

		"core-seo-migration-rollback": {
			input: z.object({
				batchId: z.string().min(1),
				confirm: z.string(),
			}),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const input = routeCtx.input as { batchId: string; confirm: string };
				if (input.confirm !== "ROLLBACK_CORE_SEO") {
					return adminMigrationResponse({
						success: false,
						error: "confirmation_required",
						expected: "ROLLBACK_CORE_SEO",
					});
				}
				return adminMigrationResponse(await rollbackCoreSeoMigration(ctx, input.batchId));
			},
		},

		// ---- Admin: list custom schemas ----
		schemas: {
			input: z.object({
				scope: z.string().optional(),
				limit: z.number().min(1).max(200).default(100),
				cursor: z.string().optional(),
			}),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const { scope, limit, cursor } = routeCtx.input as {
					scope?: string;
					limit: number;
					cursor?: string;
				};
				const res = await ctx.storage.schemas.query({
					where: scope ? { scope } : undefined,
					limit,
					cursor,
				});
				return {
					items: res.items
						.map((item: any) => publicCustomSchema(String(item.id), item.data ?? item))
						.filter(Boolean),
					cursor: res.cursor,
					hasMore: res.hasMore,
				};
			},
		},

		// ---- Admin: create/update a custom schema (validate JSON-LD before storing) ----
		"save-schema": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: ADMIN_SCHEMA_WRITE_REQUEST_MAX_BYTES },
			input: adminCustomSchemaWriteInput,
			handler: async (routeCtx: any, ctx: PluginContext) => saveAdminCustomSchema(ctx, routeInput(routeCtx)),
		},
		"delete-schema": {
			permission: "plugins:manage",
			methods: ["POST"],
			request: { body: "json", maxBytes: 4096 },
			input: adminCustomSchemaDeleteInput,
			handler: async (routeCtx: any, ctx: PluginContext) => deleteAdminCustomSchema(ctx, routeInput(routeCtx)),
		},

		// ---- Admin: contextual internal-link commands ----
		...internalLinkRoutes(null),

		// ---- Block Kit admin UI (multi-section page + dashboard widget) ----
		admin: {
			input: z.object({}).passthrough(),
			handler: async (routeCtx: any, ctx: PluginContext) => {
				const i = (routeCtx.input ?? {}) as {
					type?: string;
					page?: string;
					analyzer?: AnalyzerViewInput;
					widget?: string;
					action_id?: string;
					block_id?: string;
					value?: unknown;
					values?: Record<string, any>;
				};
				return adminHandler(i, ctx);
			},
		},
	},
} satisfies SandboxedPlugin;

export default plugin;

/**
 * The four private internal-link command routes for one engine. The handlers
 * close over the inert host only; each command opens fresh ports itself.
 */
function internalLinkRoutes(host: LinkCommandHost | null) {
	const commands = createLinkCommands(host);
	const command = (maxBytes: number, run: (input: unknown, ctx: PluginContext) => Promise<unknown>) => ({
		permission: "plugins:manage" as const,
		methods: ["POST"] as ["POST"],
		// The dispatcher refuses unparsable or oversized bodies itself; the command checks the parsed shape.
		request: { body: "json" as const, maxBytes },
		input: z.unknown(),
		handler: async (routeCtx: any, ctx: PluginContext) => run(routeCtx.input, ctx),
	});
	return {
		"find-link-suggestions": command(LINK_PAGE_REQUEST_MAX_BYTES, commands.find),
		"next-link-suggestions": command(LINK_PAGE_REQUEST_MAX_BYTES, commands.next),
		"verify-link-suggestion": command(LINK_SUGGESTION_REQUEST_MAX_BYTES, commands.verify),
		"check-saved-link": command(LINK_SUGGESTION_REQUEST_MAX_BYTES, commands.checkSaved),
	};
}

/**
 * The engine with installation facts bound to every hook and route context.
 * The native adapter passes what the Astro entry point configured; a sandbox
 * host uses the default export and reports only what it can observe.
 */
export function createSeoEngine(
	installation: IndexNowInstallation = UNKNOWN_INDEXNOW_INSTALLATION,
	options: {
		sitemap?: SitemapHost;
		robots?: RobotsInstallation;
		llmsTxt?: LlmsTxtInstallation;
		scoreScan?: ScoreScanHost;
		internalLinks?: LinkCommandHost;
		coexistence?: CoexistenceHost;
		branding?: SeoInstalledBranding;
	} = {},
): typeof plugin {
	if (installation.mode === "unknown" && !options.sitemap && !options.robots && !options.llmsTxt && !options.scoreScan && !options.internalLinks && !options.coexistence && !options.branding) {
		return plugin;
	}
	const bind = (handler: (...args: any[]) => any) => (first: unknown, ctx: unknown, ...rest: unknown[]) => {
		if (ctx && typeof ctx === "object") {
			if (installation.mode !== "unknown") indexNowInstallations.set(ctx, installation);
			if (options.sitemap) sitemapHosts.set(ctx, options.sitemap);
			if (options.robots) robotsInstallations.set(ctx, options.robots);
			if (options.llmsTxt) llmsTxtInstallations.set(ctx, options.llmsTxt);
			if (options.scoreScan) scoreScanHosts.set(ctx, options.scoreScan);
			if (options.coexistence) bindCoexistenceHost(ctx, options.coexistence);
			if (options.branding) brandingHosts.set(ctx, options.branding);
		}
		return handler(first, ctx, ...rest);
	};
	const wrap = (entry: any) => typeof entry === "function" ? bind(entry) : { ...entry, handler: bind(entry.handler) };
	// This engine's own command closures replace the inert defaults; nothing is shared with another engine.
	const routes = { ...plugin.routes, ...internalLinkRoutes(options.internalLinks ?? null) };
	return {
		...plugin,
		hooks: Object.fromEntries(Object.entries(plugin.hooks).map(([name, entry]) => [name, wrap(entry)])),
		routes: Object.fromEntries(Object.entries(routes).map(([name, entry]) => [name, wrap(entry)])),
	} as typeof plugin;
}

// ---------------------------------------------------------------------------
// Admin (Block Kit) — kept outside the descriptor literal for readability.
// ---------------------------------------------------------------------------

function cleanRefs(value: unknown, limit: number): string[] {
	let candidate = value;
	if (typeof candidate === "string") {
		try {
			candidate = JSON.parse(candidate);
		} catch {
			candidate = [candidate];
		}
	}
	if (!Array.isArray(candidate)) return [];
	return [
		...new Set(
			candidate
				.filter((ref): ref is string => typeof ref === "string")
				.map((ref) => ref.trim())
				.filter(Boolean),
		),
	].slice(0, limit);
}

function hasOwn(value: object, key: PropertyKey): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

async function counts(ctx: PluginContext) {
	const migrationStore = (ctx.storage as any)?.migrations;
	const [overrides, schemas, scores, migrationRecords] = await Promise.all([
		ctx.storage.overrides.count().catch(() => 0),
		ctx.storage.schemas.count().catch(() => 0),
		ctx.storage.scores.count().catch(() => 0),
		typeof migrationStore?.count === "function"
			? Promise.resolve(migrationStore.count()).catch(() => 0)
			: Promise.resolve(0),
	]);
	const presets = await getPresets(ctx);
	const presetsOn = PRESET_KEYS.filter((k) => presets[k]).length;
	return {
		overrides,
		schemas,
		scores,
		migrationRecords,
		presetsOn,
		presetsTotal: PRESET_KEYS.length,
	};
}

function normaliseUrl(value: string, fallback: string): string {
	const raw = value.trim() || fallback;
	if (isHttpUrl(raw)) return raw;
	return raw.startsWith("/") ? raw : `/${raw.replace(/^\/+/, "")}`;
}

function scoreRefreshActionValue(value: unknown): {
	collection: string;
	cursor?: string;
	revision?: string;
	ref?: string;
} | null {
	if (typeof value !== "string") return null;
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		const collection = cleanCollection(parsed.collection);
		const cursor = parsed.cursor === undefined ? undefined : clean(parsed.cursor);
		const revision = parsed.revision === undefined ? undefined : clean(parsed.revision);
		const ref = clean(parsed.ref);
		if (
			!collection ||
			(parsed.cursor !== undefined && !cursor) ||
			(cursor && !SCORE_REFRESH_REVISION_PATTERN.test(revision ?? "")) ||
			(cursor?.length ?? 0) > 2_048
		) {
			return null;
		}
		return { collection, cursor, revision, ref };
	} catch {
		return null;
	}
}

function analyzerPageActionValue(value: unknown): AnalyzerViewInput | null {
	if (typeof value !== "string") return null;
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		const collection = cleanCollection(parsed.collection);
		const cursor = parsed.cursor === undefined ? undefined : clean(parsed.cursor);
		const pageNumber = Number(parsed.pageNumber);
		if (!collection || (parsed.cursor !== undefined && (!cursor || cursor.length > 2_048)) ||
			!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 1_000 ||
			(cursor === undefined && pageNumber !== 1) || (cursor !== undefined && pageNumber === 1)) return null;
		return { collection, cursor, pageNumber };
	} catch {
		return null;
	}
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.round(n)));
}

function toBool(value: unknown): boolean {
	return value === true || value === "true" || value === "1" || value === 1;
}

function routeInput(routeCtx: any): Record<string, any> {
	const out: Record<string, any> = {};
	try {
		const url = new URL(String(routeCtx?.request?.url ?? "http://localhost/"));
		for (const [key, value] of url.searchParams.entries()) out[key] = value;
	} catch {
		// Ignore malformed route URLs; body input below may still be valid.
	}
	if (routeCtx?.input && typeof routeCtx.input === "object") {
		Object.assign(out, routeCtx.input);
	}
	return out;
}

function adminMigrationResponse<T extends Record<string, unknown>>(payload: T) {
	return {
		...payload,
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt: new Date().toISOString(),
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
	};
}

interface CoreSeoMigrationSource {
	id: string;
	override?: Override;
	recoveryOperation?: CoreSeoMigrationOperation;
}

const CORE_SEO_MIGRATION_PLAN_CURSOR = /^(operations|overrides):(.{0,1024})$/;

async function preparedCoreSeoMigrationOperation(
	ctx: PluginContext,
	sourceOverrideId: string,
): Promise<CoreSeoMigrationOperation | undefined> {
	const operationStore = (ctx.storage as any)?.migrationOperations;
	if (typeof operationStore?.get !== "function") return undefined;
	const operationId = await coreSeoMigrationOperationId(sourceOverrideId);
	const operation = storedCoreSeoMigrationOperation(operationId, await operationStore.get(operationId));
	return operation?.status === "prepared" ? operation : undefined;
}

const CORE_SEO_MIGRATION_OPERATION_SCAN_PAGES = 5;

// Pages prepared handoffs whose legacy owner is gone, then every legacy owner.
// A prepared handoff whose owner still exists is listed once, with that owner.
async function collectCoreSeoMigrationSourcePage(
	ctx: PluginContext,
	limit: number,
	cursor?: string,
): Promise<{ sources: CoreSeoMigrationSource[]; cursor?: string; hasMore: boolean }> {
	const operationStore = (ctx.storage as any)?.migrationOperations;
	const match = cursor === undefined ? null : CORE_SEO_MIGRATION_PLAN_CURSOR.exec(cursor);
	if (cursor !== undefined && !match) throw new Error("The migration plan cursor is invalid. Rebuild the plan.");
	const sources: CoreSeoMigrationSource[] = [];
	let phase = match?.[1] ?? (typeof operationStore?.query === "function" ? "operations" : "overrides");
	let hostCursor = match?.[2] || undefined;
	if (phase === "operations") {
		// The default (created_at, id) order carries its seek values in the cursor.
		// An orderBy on updatedAt would re-read the cursor row, and finalizing that
		// operation between pages would skip every prepared operation after it.
		for (let scanned = 1; ; scanned += 1) {
			const page = await operationStore.query({
				where: { status: "prepared" },
				limit,
				...(hostCursor ? { cursor: hostCursor } : {}),
			});
			for (const item of page.items ?? []) {
				const operation = storedCoreSeoMigrationOperation(String((item as any).id ?? ""), (item as any).data ?? item);
				if (!operation || await ctx.storage.overrides.get(operation.sourceOverrideId)) continue;
				sources.push({ id: operation.sourceOverrideId, recoveryOperation: operation });
			}
			if (!page.hasMore) break;
			if (!page.cursor) throw new Error("Prepared migration operations could not be paged.");
			hostCursor = page.cursor;
			// Operations whose owner still exists are listed with that owner later, so
			// a page can come back empty; scan a few more before handing back a cursor.
			if (sources.length || scanned >= CORE_SEO_MIGRATION_OPERATION_SCAN_PAGES) {
				return { sources, cursor: `operations:${page.cursor}`, hasMore: true };
			}
		}
		if (sources.length >= limit) return { sources, cursor: "overrides:", hasMore: true };
		phase = "overrides";
		hostCursor = undefined;
	}
	const known = new Set(sources.map((source) => source.id));
	const page = await ctx.storage.overrides.query({
		limit: limit - sources.length,
		...(hostCursor ? { cursor: hostCursor } : {}),
	});
	for (const item of page.items ?? []) {
		const sourceId = String((item as any).id);
		if (known.has(sourceId)) continue;
		sources.push({
			id: sourceId,
			override: (item as any).data as Override,
			recoveryOperation: await preparedCoreSeoMigrationOperation(ctx, sourceId),
		});
	}
	if (!page.hasMore) return { sources, hasMore: false };
	if (!page.cursor) throw new Error("Legacy SEO overrides could not be paged.");
	return { sources, cursor: `overrides:${page.cursor}`, hasMore: true };
}

async function buildCoreSeoMigrationPlanPage(
	ctx: PluginContext,
	conflictPolicy: CoreSeoMigrationConflictPolicy,
	limit: number,
	cursor?: string,
): Promise<{ plans: ResolvedCoreSeoMigrationPlan[]; cursor?: string; hasMore: boolean }> {
	const page = await collectCoreSeoMigrationSourcePage(
		ctx,
		Math.min(Math.max(Math.trunc(limit), 1), 100),
		cursor,
	);
	return {
		plans: await plansFromCoreSeoMigrationSources(ctx, conflictPolicy, page.sources),
		...(page.cursor ? { cursor: page.cursor } : {}),
		hasMore: page.hasMore,
	};
}

async function buildCoreSeoMigrationPlans(
	ctx: PluginContext,
	conflictPolicy: CoreSeoMigrationConflictPolicy = "skip",
	refs?: string[],
	limit = 100,
): Promise<ResolvedCoreSeoMigrationPlan[]> {
	limit = Math.min(Math.max(Math.trunc(limit), 1), 100);
	if (!refs?.length) return (await buildCoreSeoMigrationPlanPage(ctx, conflictPolicy, limit)).plans;
	const sources: CoreSeoMigrationSource[] = [];
	for (const ref of uniqueStrings(refs).slice(0, limit)) {
		const override = (await ctx.storage.overrides.get(ref)) as Override | null;
		sources.push({
			id: ref,
			override: override ?? undefined,
			recoveryOperation: await preparedCoreSeoMigrationOperation(ctx, ref),
		});
	}
	return plansFromCoreSeoMigrationSources(ctx, conflictPolicy, sources);
}

async function plansFromCoreSeoMigrationSources(
	ctx: PluginContext,
	conflictPolicy: CoreSeoMigrationConflictPolicy,
	sources: readonly CoreSeoMigrationSource[],
): Promise<ResolvedCoreSeoMigrationPlan[]> {
	const plans: ResolvedCoreSeoMigrationPlan[] = [];
	for (const source of sources) {
		if (source.recoveryOperation) {
			const operation = source.recoveryOperation;
			const record = operation.record;
			const contentItem = ctx.content
				? await ctx.content.get(record.collection, record.entryId)
				: null;
			const recoveryPlan = planLegacyOverrideMigration({
				ref: record.ref,
				override: record.sourceOverride,
				currentSeo: record.before,
				conflictPolicy: record.conflictPolicy,
			});
			if (
				record.conflictPolicy !== conflictPolicy ||
				!coreSeoEquals(recoveryPlan.before, record.before) ||
				!coreSeoEquals(recoveryPlan.target, record.after)
			) {
				plans.push({
					sourceOverrideId: source.id,
					ref: record.ref,
					override: record.sourceOverride,
					collection: record.collection,
					entryId: record.entryId,
					contentItem,
					recoveryOperation: operation,
					state: "conflict",
					detail:
						"A prepared migration uses a different conflict policy or plan. Select its original policy before recovery.",
				});
				continue;
			}
			plans.push({
				sourceOverrideId: source.id,
				ref: record.ref,
				override: record.sourceOverride,
				collection: record.collection,
				entryId: record.entryId,
				title: contentItem ? contentItemTitle(contentItem) : undefined,
				contentItem,
				recoveryOperation: operation,
				state: "ready",
				plan: recoveryPlan,
				detail: "A prepared owner handoff is ready for bounded recovery.",
			});
			continue;
		}
		if (!source.override) {
			plans.push({
				sourceOverrideId: source.id,
				ref: source.id,
				state: "override-not-found",
				detail: "No legacy override exists for this ref.",
			});
			continue;
		}

		const ref = clean(source.override.ref) ?? source.id;
		const parsed = parseContentRef(ref);
		if (!parsed) {
			plans.push({
				sourceOverrideId: source.id,
				ref,
				override: source.override,
				state: "invalid-ref",
				detail: "Expected a ref in collection:identifier format.",
			});
			continue;
		}

		const collection = await supportedContentCollection(ctx, parsed.collection);
		if (!collection) {
			plans.push({
				sourceOverrideId: source.id,
				ref,
				override: source.override,
				collection: parsed.collection,
				state: "unsupported-collection",
				detail: `Collection "${parsed.collection}" is not part of the SEO migration allowlist.`,
			});
			continue;
		}

		if (!ctx.content) {
			plans.push({
				sourceOverrideId: source.id,
				ref,
				override: source.override,
				collection,
				state: "content-not-found",
				detail: "The EmDash content API is unavailable.",
			});
			continue;
		}

		const item = await resolveContentItem(ctx, collection, parsed.identifier);
		if (!item) {
			plans.push({
				sourceOverrideId: source.id,
				ref,
				override: source.override,
				collection,
				state: "identifier-lookup-unavailable",
				detail:
					"The direct content ID lookup returned no entry. This host does not expose a bounded slug lookup to plugins, so migration cannot continue.",
			});
			continue;
		}

		if (item.seo === undefined) {
			plans.push({
				sourceOverrideId: source.id,
				ref,
				override: source.override,
				collection,
				entryId: String(item.id),
				title: contentItemTitle(item),
				contentItem: item,
				state: "seo-disabled",
				detail: "Core SEO is not enabled for this collection.",
			});
			continue;
		}

		if (!legacyOverrideAliasRefs(collection, item).includes(source.id)) {
			plans.push({
				sourceOverrideId: source.id,
				ref,
				override: source.override,
				collection,
				entryId: String(item.id),
				title: contentItemTitle(item),
				contentItem: item,
				state: "conflict",
				detail: `Legacy owner ${source.id} no longer matches this entry's canonical ID or current slug. Repair its ref before migration.`,
			});
			continue;
		}

		const siblingOverrideId = await findSiblingLegacyOverride(ctx, collection, item, source.id);
		if (siblingOverrideId) {
			plans.push({
				sourceOverrideId: source.id,
				ref,
				override: source.override,
				collection,
				entryId: String(item.id),
				title: contentItemTitle(item),
				contentItem: item,
				state: "conflict",
				detail: `Multiple legacy owners (${source.id} and ${siblingOverrideId}) resolve to this entry. Consolidate them before migration.`,
			});
			continue;
		}

		const plan = planLegacyOverrideMigration({
			ref,
			override: source.override,
			currentSeo: item.seo,
			conflictPolicy,
		});
		plans.push({
			sourceOverrideId: source.id,
			ref,
			override: source.override,
			collection,
			entryId: String(item.id),
			title: contentItemTitle(item),
			contentItem: item,
			state: plan.status,
			plan,
			detail:
				plan.unmappedRobots?.length
					? `Core SEO cannot hold the legacy robots directives ${plan.unmappedRobots.join(", ")}. Migrating would drop them, so this record stays with the plugin.`
					: plan.status === "conflict"
					? `Resolve ${plan.conflicts.join(", ")} or choose an explicit conflict policy.`
					: plan.status === "empty"
						? "The legacy override contains no values that map to core SEO."
						: `${plan.mappedFields.length} core SEO field(s) are ready to migrate.`,
		});
	}
	return plans;
}

function stableMigrationFingerprintValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableMigrationFingerprintValue);
	if (!value || typeof value !== "object") return value;
	const source = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(source)
			.sort()
			.map((key) => [key, stableMigrationFingerprintValue(source[key])]),
	);
}

function migrationEntryIdentity(collection: string, item: any) {
	return {
		collection,
		entryId: String(item?.id ?? ""),
		slug: clean(item?.slug ?? item?.data?.slug) ?? null,
	};
}

function migrationContentRevision(item: any) {
	const revision = item?.revision;
	if (
		!revision ||
		!Number.isSafeInteger(revision.contentVersion) ||
		revision.contentVersion < 0 ||
		!Number.isSafeInteger(revision.seoVersion) ||
		revision.seoVersion < 0
	)
		return null;
	return {
		contentVersion: revision.contentVersion,
		seoVersion: revision.seoVersion,
	};
}

function coreSeoMigrationPlanFingerprintInput(
	item: ResolvedCoreSeoMigrationPlan,
	conflictPolicy: CoreSeoMigrationConflictPolicy,
) {
	return {
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		conflictPolicy,
		sourceOverrideId: item.sourceOverrideId,
		ref: item.ref,
		state: item.state,
		entryIdentity:
			item.collection && item.contentItem
				? migrationEntryIdentity(item.collection, item.contentItem)
				: null,
		entryLocale: item.contentItem ? hostContentLocale(item.contentItem) : null,
		sourceOverride: item.override ?? null,
		before: item.plan?.before ?? null,
		target: item.plan?.target ?? null,
	};
}

async function coreSeoMigrationPlanFingerprint(
	item: ResolvedCoreSeoMigrationPlan,
	conflictPolicy: CoreSeoMigrationConflictPolicy,
): Promise<string> {
	if (item.recoveryOperation) return item.recoveryOperation.selectionFingerprint;
	const input = coreSeoMigrationPlanFingerprintInput(item, conflictPolicy);
	// Input JSON cannot represent exactly is never canonicalized. Its plan gets a
	// fingerprint no later request repeats, so apply and discard refuse it.
	const payload = isLosslessJsonValue(input)
		? JSON.stringify(stableMigrationFingerprintValue(input))
		: `unreviewable:${globalThis.crypto.randomUUID()}`;
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(payload),
	);
	return `sha256-${Array.from(new Uint8Array(digest), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("")}`;
}

/** The host row's own locale; a missing value is not replaced by a site default. */
function hostContentLocale(item: any): string | null {
	return typeof item?.locale === "string" ? item.locale : null;
}

/**
 * Whether `JSON.stringify` keeps every part of a stored value: plain objects
 * and dense arrays only, finite numbers other than -0, no cycles, symbol keys,
 * accessors or hidden properties.
 */
function isLosslessJsonValue(root: unknown): boolean {
	const active = new Set<object>();
	const stack: Array<{ value: unknown } | { leave: object }> = [{ value: root }];
	let visited = 0;
	while (stack.length) {
		const frame = stack.pop()!;
		if ("leave" in frame) {
			active.delete(frame.leave);
			continue;
		}
		const value = frame.value;
		// Shared references could repeat without bound; a value within the export limit has far fewer nodes.
		if (++visited > 4_000_000) return false;
		if (value === null || typeof value === "boolean" || typeof value === "string") continue;
		if (typeof value === "number") {
			if (!Number.isFinite(value) || Object.is(value, -0)) return false;
			continue;
		}
		if (typeof value !== "object" || active.has(value) || Object.getOwnPropertySymbols(value).length) return false;
		const names = Object.getOwnPropertyNames(value);
		const children: unknown[] = [];
		if (Array.isArray(value)) {
			if (Object.getPrototypeOf(value) !== Array.prototype || names.length !== value.length + 1) return false;
			for (let index = 0; index < value.length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(value, index);
				if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
				children.push(descriptor.value);
			}
		} else {
			const prototype = Object.getPrototypeOf(value);
			if (prototype !== Object.prototype && prototype !== null) return false;
			for (const name of names) {
				const descriptor = Object.getOwnPropertyDescriptor(value, name);
				if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return false;
				children.push(descriptor.value);
			}
		}
		active.add(value);
		stack.push({ leave: value });
		for (const child of children) stack.push({ value: child });
	}
	return true;
}

/**
 * The export of one exact-ID record from the plan the fingerprint was computed
 * for: the record is the object that fingerprint covers, never a second read,
 * and the measured bytes are the document the administrator downloads.
 */
function legacyRecordSnapshot(
	item: ResolvedCoreSeoMigrationPlan,
	conflictPolicy: CoreSeoMigrationConflictPolicy,
	fingerprint: string,
	generatedAt: string,
): SeoAdminLegacyRecordSnapshot {
	const refused = (reason: Extract<SeoAdminLegacyRecordSnapshot, { status: "refused" }>["reason"]) =>
		({ status: "refused" as const, reason });
	if (item.recoveryOperation) return refused("recovery-pending");
	if (item.override === undefined || item.override === null) return refused("record-missing");
	if (!item.collection || !item.entryId || !item.contentItem || String(item.contentItem.id) !== item.entryId)
		return refused("entry-unavailable");
	const entryRef = `${item.collection}:${item.entryId}`;
	if (item.sourceOverrideId !== entryRef) return refused("not-exact-id");
	// The same check the fingerprint applies, so an available export is never bound to an unrepeatable fingerprint.
	if (!isLosslessJsonValue(coreSeoMigrationPlanFingerprintInput(item, conflictPolicy))) return refused("not-json");
	const exported: SeoAdminLegacyRecordExport = {
		format: SEO_ADMIN_LEGACY_EXPORT_FORMAT,
		formatVersion: SEO_ADMIN_LEGACY_EXPORT_FORMAT_VERSION,
		generatedAt,
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		sourceOverrideId: item.sourceOverrideId,
		reference: item.ref,
		entry: { ref: entryRef, collection: item.collection, entryId: item.entryId, locale: hostContentLocale(item.contentItem) },
		conflictPolicy,
		fingerprint,
		record: item.override as unknown as SeoAdminLegacyRecordExport["record"],
	};
	if (!isLosslessJsonValue(exported)) return refused("not-json");
	let document: string;
	try {
		document = JSON.stringify(exported);
	} catch {
		return refused("not-json");
	}
	const bytes = new TextEncoder().encode(document).byteLength;
	if (bytes > SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES) return refused("too-large");
	return { status: "available", bytes, document };
}

/** Guarded discard deletes only through a conditional storage operation. */
function legacyDiscardAvailable(ctx: PluginContext): boolean {
	const store = (ctx.storage as any)?.overrides;
	return Boolean(store && typeof store.get === "function" && supportsConditionalStorage(store));
}

const LEGACY_DISCARD_CONFIRMATION = "DISCARD_LEGACY_SEO";

// Bound to the reviewed plan fingerprint, like apply, so a record that changed
// after review is reported instead of deleted. A prepared handoff is recovered,
// never discarded.
async function discardLegacyOverride(ctx: PluginContext, input: Record<string, unknown>) {
	const response = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION };
	const sourceOverrideId = typeof input.sourceOverrideId === "string" ? input.sourceOverrideId.trim() : "";
	const fingerprint = typeof input.fingerprint === "string" ? input.fingerprint : "";
	const conflictPolicy = input.conflictPolicy;
	if (
		!sourceOverrideId ||
		sourceOverrideId.length > 512 ||
		!/^sha256-[a-f0-9]{64}$/.test(fingerprint) ||
		(conflictPolicy !== "skip" && conflictPolicy !== "prefer-core" && conflictPolicy !== "prefer-legacy")
	) {
		return { ...response, success: false as const, error: "invalid_input" as const };
	}
	if (input.confirm !== LEGACY_DISCARD_CONFIRMATION) {
		return { ...response, success: false as const, error: "confirmation_required" as const };
	}
	if (!legacyDiscardAvailable(ctx)) {
		return { ...response, success: false as const, error: "discard_unavailable" as const };
	}
	const [plan] = await buildCoreSeoMigrationPlans(ctx, conflictPolicy, [sourceOverrideId], 1);
	if (!plan || plan.sourceOverrideId !== sourceOverrideId || !plan.override) {
		return { ...response, success: false as const, error: "not_found" as const };
	}
	if (plan.recoveryOperation) {
		return { ...response, success: false as const, error: "recovery_pending" as const };
	}
	if (await coreSeoMigrationPlanFingerprint(plan, conflictPolicy) !== fingerprint) {
		return { ...response, success: false as const, error: "preview_stale" as const };
	}
	const store = ctx.storage.overrides;
	const current = await store.get(sourceOverrideId);
	if (!current || !portabilityValueEquals(current, plan.override)) {
		return { ...response, success: false as const, error: "preview_stale" as const };
	}
	// A change after the read above fails the conditional delete instead of being removed.
	const deleted = await compareStoredValue(store, sourceOverrideId, { state: "value", value: current }, { action: "delete" });
	if (!deleted) return { ...response, success: false as const, error: "preview_stale" as const };
	const sibling = plan.collection && plan.contentItem
		? await findSiblingLegacyOverride(ctx, plan.collection, plan.contentItem, sourceOverrideId)
		: null;
	const nextOwner = sibling
		? { kind: "legacy" as const, sourceOverrideId: sibling }
		: plan.state === "seo-disabled"
			? { kind: "plugin-defaults" as const }
			: { kind: "core-seo" as const };
	return { ...response, success: true as const, sourceOverrideId, discarded: current as Override, nextOwner };
}

async function publicMigrationPlan(
	item: ResolvedCoreSeoMigrationPlan,
	conflictPolicy: CoreSeoMigrationConflictPolicy,
	snapshotGeneratedAt?: string,
) {
	const fingerprint = await coreSeoMigrationPlanFingerprint(item, conflictPolicy);
	return {
		sourceOverrideId: item.sourceOverrideId,
		fingerprint,
		ref: item.ref,
		collection: item.collection,
		entryId: item.entryId,
		title: item.title,
		state: item.state,
		detail: item.detail,
		plan: item.plan,
		...(snapshotGeneratedAt !== undefined
			? { snapshot: legacyRecordSnapshot(item, conflictPolicy, fingerprint, snapshotGeneratedAt) }
			: {}),
	};
}

function summariseMigrationPlans(items: ResolvedCoreSeoMigrationPlan[]) {
	return {
		total: items.length,
		ready: items.filter((item) => item.state === "ready").length,
		conflicts: items.filter((item) => item.state === "conflict").length,
		empty: items.filter((item) => item.state === "empty").length,
		unresolved: items.filter((item) => !["ready", "conflict", "empty"].includes(item.state)).length,
	};
}

async function persistCoreSeoMigrationRecord(
	ctx: PluginContext,
	record: CoreSeoMigrationRecord,
): Promise<{ persisted: true } | { persisted: false; error: string }> {
	let lastError: unknown = new Error("migration journal verification failed");
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await ctx.storage.migrations.put(record.id, record);
		} catch (error: unknown) {
			lastError = error;
		}
		try {
			const stored = (await ctx.storage.migrations.get(record.id)) as CoreSeoMigrationRecord | null;
			if (stored && portabilityValueEquals(stored, record)) return { persisted: true };
			lastError = new Error("migration journal snapshot verification failed");
		} catch (error: unknown) {
			lastError = error;
		}
	}
	return { persisted: false, error: String(lastError) };
}

function coreSeoMigrationOperationStore(ctx: PluginContext): any | null {
	const store = (ctx.storage as any)?.migrationOperations;
	return store && typeof store.get === "function" && supportsConditionalStorage(store)
		? store
		: null;
}

function coreSeoMigrationWriteAvailable(ctx: PluginContext): boolean {
	return Boolean(
		ctx.content &&
			typeof (ctx.content as any).updateIfUnchanged === "function" &&
			supportsConditionalStorage(ctx.storage.overrides) &&
			coreSeoMigrationOperationStore(ctx),
	);
}

async function coreSeoMigrationOperationId(sourceOverrideId: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(sourceOverrideId),
	);
	return `core-seo-operation:${Array.from(new Uint8Array(digest), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("")}`;
}

async function coreSeoMigrationRecordFingerprint(record: CoreSeoMigrationRecord): Promise<string> {
	const payload = JSON.stringify(stableMigrationFingerprintValue(record));
	const digest = await globalThis.crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(payload),
	);
	return `sha256-${Array.from(new Uint8Array(digest), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("")}`;
}

function storedCoreSeoMigrationOperation(
	id: string,
	value: unknown,
): CoreSeoMigrationOperation | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<CoreSeoMigrationOperation>;
	const record = candidate.record as Partial<CoreSeoMigrationRecord> | undefined;
	if (
		candidate.id !== id ||
		candidate.storageVersion !== CORE_SEO_MIGRATION_OPERATION_STORAGE_VERSION ||
		typeof candidate.sourceOverrideId !== "string" ||
		!/^sha256-[a-f0-9]{64}$/.test(candidate.selectionFingerprint ?? "") ||
		!(["prepared", "applied", "failed", "rolling-back", "rolled-back"] as const).includes(
			candidate.status as CoreSeoMigrationOperationStatus,
		) ||
		!record ||
		typeof record.id !== "string" ||
		record.sourceOverrideId !== candidate.sourceOverrideId ||
		typeof record.collection !== "string" ||
		typeof record.entryId !== "string" ||
		typeof record.ref !== "string" ||
		typeof candidate.updatedAt !== "string"
	)
		return null;
	return candidate as CoreSeoMigrationOperation;
}

type CoreSeoMigrationOperationWrite = "committed" | "changed" | "unavailable";

async function compareCoreSeoMigrationOperation(
	store: any,
	id: string,
	expected: unknown | null,
	next: CoreSeoMigrationOperation,
): Promise<CoreSeoMigrationOperationWrite> {
	const expectedState =
		expected === null
			? { state: "missing" as const }
			: { state: "value" as const, value: expected };
	try {
		if (
			await compareStoredValue(store, id, expectedState, {
				action: "put",
				value: next,
			})
		)
			return "committed";
	} catch {
		// The exact reread below resolves commit-then-reject transports.
	}
	let current: unknown;
	try {
		current = await store.get(id);
	} catch {
		return "unavailable";
	}
	if (portabilityValueEquals(current, next)) return "committed";
	return portabilityValueEquals(current, expected) ? "unavailable" : "changed";
}

async function finalizeCoreSeoMigrationOperation(
	store: any,
	expected: CoreSeoMigrationOperation,
	status: CoreSeoMigrationOperationStatus,
	record: CoreSeoMigrationRecord,
): Promise<CoreSeoMigrationOperationWrite> {
	return compareCoreSeoMigrationOperation(store, expected.id, expected, {
		...expected,
		status,
		record: structuredClone(record),
		updatedAt: new Date().toISOString(),
	});
}

type PreparedMigrationRecovery =
	| { retry: true }
	| {
			retry: false;
			result: {
				ref: string;
				status: string;
				migrationId?: string;
				error?: string;
			};
		  };

async function readCoreSeoMigrationOwners(
	ctx: PluginContext,
	record: CoreSeoMigrationRecord,
): Promise<{
	content: any | null;
	source: Override | null;
	siblingId: string | null;
	canonicalEntry: boolean;
	sourceAliases: boolean;
}> {
	const [content, source] = await Promise.all([
		ctx.content!.get(record.collection, record.entryId),
		ctx.storage.overrides.get(record.sourceOverrideId) as Promise<Override | null>,
	]);
	const canonicalEntry = Boolean(content && String(content.id ?? "") === record.entryId);
	const sourceAliases = Boolean(
		content &&
		legacyOverrideAliasRefs(record.collection, content).includes(record.sourceOverrideId),
	);
	return {
		content,
		source,
		siblingId: content
			? await findSiblingLegacyOverride(ctx, record.collection, content, record.sourceOverrideId)
			: null,
		canonicalEntry,
		sourceAliases,
	};
}

async function recoverCoreSeoMigrationOperation(
	ctx: PluginContext,
	operationStore: any,
	initialOperation: CoreSeoMigrationOperation,
	selectionFingerprint: string,
	compareOverrideAndSet: (
		id: string,
		expected: { state: "missing" } | { state: "value"; value: Override },
		next: { action: "put"; value: Override } | { action: "delete" },
	) => Promise<boolean>,
	updateContentIfUnchanged: (
		collection: string,
		id: string,
		input: { seo: CoreSeoSnapshot },
		expectedRevision: { contentVersion: number; seoVersion: number },
	) => Promise<{ updated: boolean; item?: any }>,
): Promise<PreparedMigrationRecovery> {
	const record = structuredClone(initialOperation.record);
	const leased = await withOperationLease(
		ctx,
		`core-seo-migration:${record.collection}:${record.entryId}`,
		async (owner): Promise<PreparedMigrationRecovery> => {
			const operationRaw = await operationStore.get(initialOperation.id);
			const operation = storedCoreSeoMigrationOperation(initialOperation.id, operationRaw);
			if (!operation || operation.selectionFingerprint !== selectionFingerprint)
				return {
					retry: false,
					result: {
						ref: record.ref,
						status: "partial-conflict",
						migrationId: record.id,
						error: "The migration recovery record changed before reconciliation.",
					},
				};
			const currentRecord = structuredClone(operation.record);
			const [currentContent, currentOverride] = await Promise.all([
				ctx.content!.get(currentRecord.collection, currentRecord.entryId),
				ctx.storage.overrides.get(currentRecord.sourceOverrideId) as Promise<Override | null>,
			]);
			const beforeState =
				currentContent &&
				coreSeoEquals(currentContent.seo, currentRecord.before) &&
				currentOverride &&
				legacyOverrideEquals(currentOverride, currentRecord.sourceOverride);
			const appliedState =
				currentContent &&
				coreSeoEquals(currentContent.seo, currentRecord.after) &&
				!currentOverride;

			if (operation.status !== "prepared") {
				if (operation.status === "applied" && appliedState) {
					return {
						retry: false,
						result: {
							ref: currentRecord.ref,
							status: "applied",
							migrationId: currentRecord.id,
						},
					};
				}
				return { retry: true };
			}

			if (beforeState) {
				currentRecord.status = "failed";
				currentRecord.error = "recovered_before_migration_mutation";
				currentRecord.updatedAt = new Date().toISOString();
				const journal = await persistCoreSeoMigrationRecord(ctx, currentRecord);
				if (!journal.persisted)
					return {
						retry: false,
						result: {
							ref: currentRecord.ref,
							status: "failed",
							migrationId: currentRecord.id,
							error: `recovery_journal_finalize_failed: ${journal.error}`,
						},
					};
				const finalized = await finalizeCoreSeoMigrationOperation(
					operationStore,
					operation,
					"failed",
					currentRecord,
				);
				return finalized === "committed"
					? { retry: true }
					: {
							retry: false,
							result: {
								ref: currentRecord.ref,
								status: "operation-busy",
								migrationId: currentRecord.id,
								error: "The migration recovery record could not be finalized.",
							},
						};
			}

			if (
				!currentContent ||
				!coreSeoEquals(currentContent.seo, currentRecord.after) ||
				(currentOverride && !legacyOverrideEquals(currentOverride, currentRecord.sourceOverride)) ||
				!legacyOverrideAliasRefs(currentRecord.collection, currentContent).includes(
					currentRecord.sourceOverrideId,
				) ||
				(await findSiblingLegacyOverride(
					ctx,
					currentRecord.collection,
					currentContent,
					currentRecord.sourceOverrideId,
				))
			) {
				currentRecord.status = "failed";
				currentRecord.error = "recovery_state_conflict";
				currentRecord.updatedAt = new Date().toISOString();
				await persistCoreSeoMigrationRecord(ctx, currentRecord);
				await finalizeCoreSeoMigrationOperation(operationStore, operation, "failed", currentRecord);
				return {
					retry: false,
					result: {
						ref: currentRecord.ref,
						status: "partial-conflict",
						migrationId: currentRecord.id,
						error: "Prepared migration owners no longer match either safe checkpoint.",
					},
				};
			}

			if (currentOverride) {
				if (!(await owner.renew()))
					return {
						retry: false,
						result: {
							ref: currentRecord.ref,
							status: "operation-busy",
							migrationId: currentRecord.id,
						},
					};
				let deleted = false;
				try {
					deleted = await compareOverrideAndSet(
						currentRecord.sourceOverrideId,
						{ state: "value", value: currentOverride },
						{ action: "delete" },
					);
				} catch {
					deleted = (await ctx.storage.overrides.get(currentRecord.sourceOverrideId)) == null;
				}
				if (!deleted)
					return {
						retry: false,
						result: {
							ref: currentRecord.ref,
							status: "partial-conflict",
							migrationId: currentRecord.id,
							error: "The legacy owner changed during migration recovery.",
						},
					};
			}

			let finalOwners: Awaited<ReturnType<typeof readCoreSeoMigrationOwners>>;
			try {
				finalOwners = await readCoreSeoMigrationOwners(ctx, currentRecord);
			} catch (error: unknown) {
				return {
					retry: false,
					result: {
						ref: currentRecord.ref,
						status: "operation-busy",
						migrationId: currentRecord.id,
						error: `recovery_owner_verification_unavailable: ${String(error)}`,
					},
				};
			}
			const finalOwnersMatch = Boolean(
				finalOwners.content &&
					coreSeoEquals(finalOwners.content.seo, currentRecord.after) &&
					finalOwners.canonicalEntry &&
					finalOwners.sourceAliases &&
					!finalOwners.source &&
					!finalOwners.siblingId,
			);
			if (!finalOwnersMatch) {
				const conflicts: string[] = [];
				let coreRestored = Boolean(
					finalOwners.content && coreSeoEquals(finalOwners.content.seo, currentRecord.before),
				);
				let coreCompensated = false;
				if (
					!coreRestored &&
					currentOverride &&
					finalOwners.content &&
					coreSeoEquals(finalOwners.content.seo, currentRecord.after) &&
					finalOwners.canonicalEntry &&
					finalOwners.sourceAliases
				) {
					const revision = migrationContentRevision(finalOwners.content);
					if (revision) {
						try {
							const restored = await updateContentIfUnchanged(
								currentRecord.collection,
								currentRecord.entryId,
								{ seo: currentRecord.before },
								revision,
							);
							coreCompensated = Boolean(restored?.updated);
						} catch (error: unknown) {
							conflicts.push(`core_compensation_failed: ${String(error)}`);
						}
					} else {
						conflicts.push("core_revision_unavailable_during_recovery");
					}
				}

				let compensatedOwners: Awaited<ReturnType<typeof readCoreSeoMigrationOwners>> | null = null;
				try {
					compensatedOwners = await readCoreSeoMigrationOwners(ctx, currentRecord);
					coreRestored = Boolean(
						compensatedOwners.content &&
						coreSeoEquals(compensatedOwners.content.seo, currentRecord.before),
					);
				} catch (error: unknown) {
					conflicts.push(`compensation_verification_failed: ${String(error)}`);
				}

				let sourceCompensationAttempted = false;
				let sourceCompensationCommitted = false;
				if (
					currentOverride &&
					coreRestored &&
					compensatedOwners?.canonicalEntry &&
					compensatedOwners.sourceAliases &&
					!compensatedOwners.source &&
					!compensatedOwners.siblingId
				) {
					sourceCompensationAttempted = true;
					try {
						sourceCompensationCommitted = await compareOverrideAndSet(
							currentRecord.sourceOverrideId,
							{ state: "missing" },
							{ action: "put", value: currentRecord.sourceOverride },
						);
						if (!sourceCompensationCommitted) conflicts.push("source_compensation_compare_failed");
					} catch (error: unknown) {
						conflicts.push(`source_compensation_failed: ${String(error)}`);
					}
				}

				let postCompensationOwners = compensatedOwners;
				try {
					postCompensationOwners = await readCoreSeoMigrationOwners(ctx, currentRecord);
				} catch (error: unknown) {
					conflicts.push(`compensated_owner_verification_failed: ${String(error)}`);
				}
				if (
					postCompensationOwners?.source &&
					!legacyOverrideEquals(postCompensationOwners.source, currentRecord.sourceOverride)
				) {
					conflicts.push("source_owner_changed_during_recovery");
				}
				if (
					sourceCompensationAttempted &&
					!sourceCompensationCommitted &&
					!postCompensationOwners?.source
				) {
					conflicts.push("source_compensation_not_committed");
				}
				if (sourceCompensationCommitted) {
					const sourceCompensationIsSafe = Boolean(
						postCompensationOwners?.content &&
						coreSeoEquals(postCompensationOwners.content.seo, currentRecord.before) &&
							postCompensationOwners.canonicalEntry &&
							postCompensationOwners.sourceAliases &&
							postCompensationOwners.source &&
						legacyOverrideEquals(postCompensationOwners.source, currentRecord.sourceOverride) &&
							!postCompensationOwners.siblingId,
					);
					if (!sourceCompensationIsSafe) {
						let sourceCompensationCleaned = false;
						try {
							const cleanupCandidate = (await ctx.storage.overrides.get(
								currentRecord.sourceOverrideId,
							)) as Override | null;
							if (
								cleanupCandidate &&
								legacyOverrideEquals(cleanupCandidate, currentRecord.sourceOverride)
							) {
								try {
									sourceCompensationCleaned = await compareOverrideAndSet(
										currentRecord.sourceOverrideId,
										{ state: "value", value: cleanupCandidate },
										{ action: "delete" },
									);
								} catch {
									sourceCompensationCleaned =
										(await ctx.storage.overrides.get(currentRecord.sourceOverrideId)) == null;
								}
							}
						} catch (error: unknown) {
							conflicts.push(`source_compensation_cleanup_failed: ${String(error)}`);
						}
						if (!sourceCompensationCleaned) conflicts.push("source_compensation_owner_changed");
					}
				}
				if (coreCompensated && postCompensationOwners?.content) {
					await refreshScoreAfterCoreSeoWrite(
						ctx,
						currentRecord.collection,
						postCompensationOwners.content,
					).catch(() => undefined);
				}
				currentRecord.status = "failed";
				currentRecord.error = ["recovery_owner_changed_after_source_delete", ...conflicts].join(
					"; ",
				);
				currentRecord.updatedAt = new Date().toISOString();
				const failedJournal = await persistCoreSeoMigrationRecord(ctx, currentRecord);
				const failedOperation = await finalizeCoreSeoMigrationOperation(
					operationStore,
					operation,
					"failed",
					currentRecord,
				);
				const resultError = failedJournal.persisted
					? failedOperation === "committed"
						? currentRecord.error
						: `${currentRecord.error}; recovery_operation_finalize_failed`
					: `${currentRecord.error}; failed_journal_finalize_failed: ${failedJournal.error}`;
				return {
					retry: false,
					result: {
						ref: currentRecord.ref,
						status: "partial-conflict",
						migrationId: currentRecord.id,
						error: resultError,
					},
				};
			}
			const finalContent = finalOwners.content!;
			currentRecord.status = "applied";
			currentRecord.updatedAt = new Date().toISOString();
			delete currentRecord.error;
			const journal = await persistCoreSeoMigrationRecord(ctx, currentRecord);
			if (!journal.persisted)
				return {
					retry: false,
					result: {
						ref: currentRecord.ref,
						status: "failed",
						migrationId: currentRecord.id,
						error: `applied_journal_finalize_failed: ${journal.error}`,
					},
				};
			const finalized = await finalizeCoreSeoMigrationOperation(
				operationStore,
				operation,
				"applied",
				currentRecord,
			);
			if (finalized !== "committed")
				return {
					retry: false,
					result: {
						ref: currentRecord.ref,
						status: "operation-busy",
						migrationId: currentRecord.id,
						error: "The applied migration recovery record could not be finalized.",
					},
				};
			await refreshScoreAfterCoreSeoWrite(ctx, currentRecord.collection, finalContent).catch(
				(error: unknown) => {
				ctx.log.warn("seo: recovered migration score refresh failed", {
					ref: currentRecord.ref,
					error: String(error),
				});
				},
			);
			return {
				retry: false,
				result: {
					ref: currentRecord.ref,
					status: "applied",
					migrationId: currentRecord.id,
				},
			};
		},
	);
	if (leased.acquired) return leased.value;
	if ("value" in leased && leased.value !== undefined) return leased.value;
	return {
		retry: false,
		result: {
			ref: initialOperation.record.ref,
			status: "operation-busy",
			migrationId: initialOperation.record.id,
			error: "Another migration operation owns this entry lease.",
		},
	};
}

async function applyCoreSeoMigration(
	ctx: PluginContext,
	selections: Array<{ sourceOverrideId: string; fingerprint: string }>,
	conflictPolicy: CoreSeoMigrationConflictPolicy,
) {
	const content = ctx.content;
	const conditionalContentUpdate = (content as any)?.updateIfUnchanged;
	const operationStore = coreSeoMigrationOperationStore(ctx);
	if (
		!content ||
		typeof conditionalContentUpdate !== "function" ||
		!supportsConditionalStorage(ctx.storage.overrides) ||
		!operationStore
	)
		return { success: false, error: "content_write_unavailable" };
	const updateContentIfUnchanged = conditionalContentUpdate.bind(content);
	const compareOverrideAndSet = compareStoredValue.bind(null, ctx.storage.overrides);

	const batchId = createMigrationBatchId();
	const results: Array<{
		ref: string;
		status: string;
		migrationId?: string;
		error?: string;
	}> = [];
	const pendingSelections: typeof selections = [];
	for (const selection of selections) {
		const operationId = await coreSeoMigrationOperationId(selection.sourceOverrideId);
		const operation = storedCoreSeoMigrationOperation(
			operationId,
			await operationStore.get(operationId),
		);
		if (
			!operation ||
			operation.selectionFingerprint !== selection.fingerprint ||
			(operation.status !== "prepared" && operation.status !== "applied")
		) {
			pendingSelections.push(selection);
			continue;
		}
		const recovery = await recoverCoreSeoMigrationOperation(
			ctx,
			operationStore,
			operation,
			selection.fingerprint,
			compareOverrideAndSet,
			updateContentIfUnchanged,
		);
		if (recovery.retry) pendingSelections.push(selection);
		else results.push(recovery.result);
	}
	if (pendingSelections.length === 0) {
		return {
			success: results.some((item) => item.status === "applied"),
			batchId,
			migrationVersion: CORE_SEO_MIGRATION_VERSION,
			summary: summariseOperationResults(results),
			results,
		};
	}

	const expectedBySource = new Map(
		pendingSelections.map((selection) => [selection.sourceOverrideId, selection.fingerprint]),
	);
	const plans = await buildCoreSeoMigrationPlans(
		ctx,
		conflictPolicy,
		pendingSelections.map((selection) => selection.sourceOverrideId),
		100,
	);
	const fingerprints = new Map(
		await Promise.all(
			plans.map(
				async (item) =>
					[
						item.sourceOverrideId,
						await coreSeoMigrationPlanFingerprint(item, conflictPolicy),
					] as const,
			),
		),
	);
	const previewChanged =
		expectedBySource.size !== pendingSelections.length ||
		plans.length !== expectedBySource.size ||
		plans.some(
			(item) =>
				fingerprints.get(item.sourceOverrideId) !== expectedBySource.get(item.sourceOverrideId),
		);
	if (previewChanged) {
		for (const item of plans) {
			results.push({
				ref: item.ref,
				status: "changed-since-preview",
				error:
					"The exact legacy/core migration plan changed after review. Refresh the preview before applying any selected record.",
			});
		}
		return {
			success: false,
			batchId,
			migrationVersion: CORE_SEO_MIGRATION_VERSION,
			summary: summariseOperationResults(results),
			results,
		};
	}

	for (const item of plans) {
		if (
			item.state !== "ready" ||
			!item.plan ||
			!item.override ||
			!item.collection ||
			!item.entryId
		) {
			results.push({ ref: item.ref, status: item.state, error: item.detail });
			continue;
		}

		const leased = await withOperationLease(
			ctx,
			`core-seo-migration:${item.collection}:${item.entryId}`,
			async (owner) => {
				// The submitted fingerprint binds this plan to the exact preview the
				// admin confirmed. Claim-time validation closes the later preflight-to-
				// write window by comparing both owners and the entry identity again.
				const [latestOverride, latestContent] = await Promise.all([
					ctx.storage.overrides.get(item.sourceOverrideId) as Promise<Override | null>,
					content.get(item.collection!, item.entryId!),
				]);
				if (
					!latestOverride ||
					!legacyOverrideEquals(latestOverride, item.override!) ||
					!latestContent ||
					!coreSeoEquals(latestContent.seo, item.plan!.before)
				) {
					return {
						ref: item.ref,
						status: "changed-since-preview",
						error: "Core SEO or the legacy owner changed after this migration preview.",
					};
				}
				if (
					!portabilityValueEquals(
						migrationEntryIdentity(item.collection!, latestContent),
						migrationEntryIdentity(item.collection!, item.contentItem),
					)
				) {
					return {
						ref: item.ref,
						status: "changed-since-preview",
						error: "The entry identity changed after this migration preview.",
					};
				}
				if (
					!legacyOverrideAliasRefs(item.collection!, latestContent).includes(item.sourceOverrideId)
				) {
					return {
						ref: item.ref,
						status: "changed-since-preview",
						error:
							"The entry ID/slug no longer resolves to this legacy owner. Refresh the migration preview.",
					};
				}
				const claimSibling = await findSiblingLegacyOverride(
					ctx,
					item.collection!,
					latestContent,
					item.sourceOverrideId,
				);
				if (claimSibling) {
					return {
						ref: item.ref,
						status: "changed-since-preview",
						error: `Legacy owner ${claimSibling} now aliases this entry. Consolidate both owners before migration.`,
					};
				}
				if (!(await owner.renew())) {
					return {
						ref: item.ref,
						status: "operation-busy",
						error: "The entry lease approached expiry before migration started. Retry safely.",
					};
				}

				const now = new Date().toISOString();
				const migrationId = `${batchId}:${encodeURIComponent(item.ref)}`;
				const record: CoreSeoMigrationRecord = {
					id: migrationId,
					batchId,
					migrationVersion: CORE_SEO_MIGRATION_VERSION,
					ref: item.ref,
					collection: item.collection!,
					entryId: item.entryId!,
					sourceOverrideId: item.sourceOverrideId,
					sourceOverride: item.override!,
					conflictPolicy,
					before: item.plan!.before,
					after: item.plan!.target,
					status: "prepared",
					createdAt: now,
					updatedAt: now,
				};
				const operationId = await coreSeoMigrationOperationId(item.sourceOverrideId);
				const existingOperationRaw = await operationStore.get(operationId);
				const existingOperation = storedCoreSeoMigrationOperation(
					operationId,
					existingOperationRaw,
				);
				if (existingOperationRaw != null && !existingOperation) {
					return {
						ref: item.ref,
						status: "partial-conflict",
						error: "The migration recovery record is invalid.",
					};
				}
				if (existingOperation?.status === "prepared") {
					return {
						ref: item.ref,
						status: "operation-busy",
						migrationId: existingOperation.record.id,
						error: "A prepared migration recovery record still owns this legacy entry.",
					};
				}
				const preparedOperation: CoreSeoMigrationOperation = {
					id: operationId,
					storageVersion: CORE_SEO_MIGRATION_OPERATION_STORAGE_VERSION,
					sourceOverrideId: item.sourceOverrideId,
					selectionFingerprint: fingerprints.get(item.sourceOverrideId)!,
					status: "prepared",
					record: structuredClone(record),
					updatedAt: now,
				};
				const operationPrepared = await compareCoreSeoMigrationOperation(
					operationStore,
					operationId,
					existingOperationRaw,
					preparedOperation,
				);
				if (operationPrepared !== "committed") {
					return {
						ref: item.ref,
						status: "operation-busy",
						error: "The migration recovery record changed before preparation.",
					};
				}

				const preparedJournal = await persistCoreSeoMigrationRecord(ctx, record);
				if (!preparedJournal.persisted) {
					record.status = "failed";
					record.error = `backup_failed: ${preparedJournal.error}`;
					record.updatedAt = new Date().toISOString();
					await finalizeCoreSeoMigrationOperation(
						operationStore,
						preparedOperation,
						"failed",
						record,
					);
					return {
						ref: item.ref,
						status: "failed",
						error: record.error,
					};
				}

				let coreWriteAttempted = false;
				let overrideDeleteAttempted = false;
				let stateChangedBeforeCoreWrite = false;
				try {
					if (!(await owner.renew())) throw new Error("operation_lease_changed_before_core_write");
					const siblingCheckContent = await content.get(item.collection!, item.entryId!);
					if (
						!siblingCheckContent ||
						(await findSiblingLegacyOverride(
							ctx,
							item.collection!,
							siblingCheckContent,
							item.sourceOverrideId,
						))
					) {
						stateChangedBeforeCoreWrite = true;
						throw new Error("legacy_alias_changed_before_core_write");
					}
					const [preCoreContent, preCoreOverride] = await Promise.all([
						content.get(item.collection!, item.entryId!),
						ctx.storage.overrides.get(item.sourceOverrideId) as Promise<Override | null>,
					]);
					if (
						!preCoreContent ||
						!coreSeoEquals(preCoreContent.seo, item.plan!.before) ||
						!portabilityValueEquals(
							migrationEntryIdentity(item.collection!, preCoreContent),
							migrationEntryIdentity(item.collection!, item.contentItem),
						) ||
						!legacyOverrideAliasRefs(item.collection!, preCoreContent).includes(
							item.sourceOverrideId,
						) ||
						!preCoreOverride ||
						!legacyOverrideEquals(preCoreOverride, item.override!)
					) {
						stateChangedBeforeCoreWrite = true;
						throw new Error("migration_state_changed_before_core_write");
					}
					const preCoreRevision = migrationContentRevision(preCoreContent);
					if (!preCoreRevision) {
						stateChangedBeforeCoreWrite = true;
						throw new Error("migration_revision_unavailable_before_core_write");
					}
					coreWriteAttempted = true;
					const updateResult = await updateContentIfUnchanged(
						item.collection!,
						item.entryId!,
						{ seo: item.plan!.target },
						preCoreRevision,
					);
					if (!updateResult?.updated) {
						coreWriteAttempted = false;
						stateChangedBeforeCoreWrite = true;
						throw new Error("migration_state_changed_before_core_write");
					}
					const updated = updateResult.item;
					if (!coreSeoEquals(updated.seo, item.plan!.target))
						throw new Error("core_seo_verification_failed");

					if (!(await owner.renew())) throw new Error("operation_lease_changed_before_handoff");
					const handoffContent = await content.get(item.collection!, item.entryId!);
					if (!handoffContent || !coreSeoEquals(handoffContent.seo, item.plan!.target))
						throw new Error("core_seo_changed_before_handoff");
					if (
						!portabilityValueEquals(
							migrationEntryIdentity(item.collection!, handoffContent),
							migrationEntryIdentity(item.collection!, item.contentItem),
						)
					)
						throw new Error("entry_identity_changed_before_handoff");
					if (
						!legacyOverrideAliasRefs(item.collection!, handoffContent).includes(
							item.sourceOverrideId,
						)
					)
						throw new Error("legacy_owner_alias_changed_before_handoff");
					if (
						await findSiblingLegacyOverride(
							ctx,
							item.collection!,
							handoffContent,
							item.sourceOverrideId,
						)
					)
						throw new Error("legacy_alias_changed_before_handoff");
					const handoffOverride = (await ctx.storage.overrides.get(
						item.sourceOverrideId,
					)) as Override | null;
					if (!handoffOverride || !legacyOverrideEquals(handoffOverride, item.override!))
						throw new Error("legacy_override_changed_before_handoff");

					overrideDeleteAttempted = true;
					const overrideDeleted = await compareOverrideAndSet(
							item.sourceOverrideId,
							{ state: "value", value: handoffOverride },
							{ action: "delete" },
						);
					if (!overrideDeleted) throw new Error("legacy_override_changed_before_handoff");
					if (await ctx.storage.overrides.get(item.sourceOverrideId))
						throw new Error("legacy_override_reappeared_during_handoff");
					const postHandoffContent = await content.get(item.collection!, item.entryId!);
					if (!postHandoffContent || !coreSeoEquals(postHandoffContent.seo, item.plan!.target))
						throw new Error("core_seo_changed_after_handoff");
					if (
						!portabilityValueEquals(
							migrationEntryIdentity(item.collection!, postHandoffContent),
							migrationEntryIdentity(item.collection!, item.contentItem),
						)
					)
						throw new Error("entry_identity_changed_after_handoff");
					if (
						!legacyOverrideAliasRefs(item.collection!, postHandoffContent).includes(
							item.sourceOverrideId,
					)
					)
						throw new Error("legacy_owner_alias_changed_after_handoff");
					if (
						await findSiblingLegacyOverride(
							ctx,
							item.collection!,
							postHandoffContent,
							item.sourceOverrideId,
						)
					)
						throw new Error("legacy_alias_changed_after_handoff");

					record.status = "applied";
					record.updatedAt = new Date().toISOString();
					const appliedJournal = await persistCoreSeoMigrationRecord(ctx, record);
					if (!appliedJournal.persisted)
						throw new Error(`applied_journal_finalize_failed: ${appliedJournal.error}`);
					if (
						(await finalizeCoreSeoMigrationOperation(
							operationStore,
							preparedOperation,
							"applied",
							record,
						)) !== "committed"
					)
						throw new Error("migration_recovery_finalize_failed");
					await refreshScoreAfterCoreSeoWrite(ctx, item.collection!, postHandoffContent);
					return { ref: item.ref, status: "applied", migrationId };
				} catch (error: unknown) {
					if (stateChangedBeforeCoreWrite && !coreWriteAttempted && !overrideDeleteAttempted) {
						record.status = "failed";
						record.error = String(error);
						record.updatedAt = new Date().toISOString();
						const failedJournal = await persistCoreSeoMigrationRecord(ctx, record);
						const failedOperation = await finalizeCoreSeoMigrationOperation(
							operationStore,
							preparedOperation,
							"failed",
							record,
						);
						const resultError = failedJournal.persisted
							? failedOperation === "committed"
								? record.error
								: `${record.error}; recovery_operation_finalize_failed`
							: `${record.error}; failed_journal_finalize_failed: ${failedJournal.error}`;
						return {
							ref: item.ref,
							status: "changed-since-preview",
							migrationId,
							error: resultError,
						};
					}
					const compensationErrors: string[] = [];
					const compensationConflicts: string[] = [];
					let currentContent: any | null = null;
					let currentOverride: Override | null = null;
					let currentSiblingOverrideId: string | null = null;
					let currentEntryIdentityChanged = false;
					let currentSourceStillAliases = false;
					try {
						[currentContent, currentOverride] = await Promise.all([
							content.get(item.collection!, item.entryId!),
							ctx.storage.overrides.get(item.sourceOverrideId) as Promise<Override | null>,
						]);
						if (currentContent) {
							currentEntryIdentityChanged = !portabilityValueEquals(
								migrationEntryIdentity(item.collection!, currentContent),
								migrationEntryIdentity(item.collection!, item.contentItem),
							);
							currentSourceStillAliases = legacyOverrideAliasRefs(
								item.collection!,
								currentContent,
							).includes(item.sourceOverrideId);
							currentSiblingOverrideId = await findSiblingLegacyOverride(
								ctx,
								item.collection!,
								currentContent,
								item.sourceOverrideId,
							);
						}
					} catch (stateError: unknown) {
						compensationConflicts.push(`migration_state_check_failed: ${String(stateError)}`);
					}

					// A delete or the final journal write may commit and still surface a
					// transport error. If both final owners already match the applied
					// state, finish the journal rather than rolling back a valid handoff.
					if (
						overrideDeleteAttempted &&
						currentContent &&
						coreSeoEquals(currentContent.seo, item.plan!.target) &&
						!currentOverride &&
						!currentSiblingOverrideId &&
						!currentEntryIdentityChanged &&
						currentSourceStillAliases
					) {
						record.status = "applied";
						record.updatedAt = new Date().toISOString();
						delete record.error;
						const journalApplied = await persistCoreSeoMigrationRecord(ctx, record);
						if (!journalApplied.persisted) {
							compensationErrors.push(`applied_journal_finalize_failed: ${journalApplied.error}`);
						} else if (
							(await finalizeCoreSeoMigrationOperation(
								operationStore,
								preparedOperation,
								"applied",
								record,
							)) === "committed"
						) {
							await refreshScoreAfterCoreSeoWrite(ctx, item.collection!, currentContent).catch(
								(scoreError: unknown) => {
								ctx.log.warn("seo: applied migration score refresh failed", {
									ref: item.ref,
									error: String(scoreError),
								});
								},
							);
							return { ref: item.ref, status: "applied", migrationId };
						}
					}

					if (currentEntryIdentityChanged) {
						compensationConflicts.push("entry_identity_changed_during_migration");
					}
					if (currentContent && !currentSourceStillAliases) {
						compensationConflicts.push("legacy_owner_no_longer_aliases_entry");
					}

					let coreRestored = false;
					if (!currentContent) {
						compensationConflicts.push("core_owner_missing_after_migration_write");
					} else if (coreSeoEquals(currentContent.seo, item.plan!.before)) {
						coreRestored = true;
					} else if (
						coreWriteAttempted &&
						coreSeoEquals(currentContent.seo, item.plan!.target) &&
						currentSourceStillAliases
					) {
						try {
							const beforeRestore = await content.get(item.collection!, item.entryId!);
							if (!beforeRestore) {
								compensationConflicts.push("core_owner_missing_before_migration_compensation");
							} else if (coreSeoEquals(beforeRestore.seo, item.plan!.before)) {
								coreRestored = true;
							} else if (!coreSeoEquals(beforeRestore.seo, item.plan!.target)) {
								compensationConflicts.push("core_changed_after_migration_write");
							} else {
								let restoreError: unknown = null;
								const restoreRevision = migrationContentRevision(beforeRestore);
								if (!restoreRevision) {
									restoreError = new Error(
										"core_revision_unavailable_during_migration_compensation",
									);
								} else {
									try {
										const restoreResult = await updateContentIfUnchanged(
											item.collection!,
											item.entryId!,
											{ seo: item.plan!.before },
											restoreRevision,
										);
										if (!restoreResult?.updated)
											restoreError = new Error("core_changed_during_migration_compensation");
									} catch (cause: unknown) {
										restoreError = cause;
									}
								}
								const verified = await content.get(item.collection!, item.entryId!);
								if (verified && coreSeoEquals(verified.seo, item.plan!.before)) {
									coreRestored = true;
								} else if (!verified) {
									compensationConflicts.push("core_owner_missing_during_migration_compensation");
								} else if (!coreSeoEquals(verified.seo, item.plan!.target)) {
									compensationConflicts.push("core_changed_during_migration_compensation");
								} else {
									compensationErrors.push(
										`core_restore_failed: ${String(restoreError ?? "core_restore_verification_failed")}`,
									);
								}
							}
						} catch (compensationError: unknown) {
							compensationErrors.push(`core_restore_failed: ${String(compensationError)}`);
						}
					} else if (coreWriteAttempted && coreSeoEquals(currentContent.seo, item.plan!.target)) {
						// The source key no longer aliases this entry. Keep the exact migrated
						// core value visible and surface the identity conflict for manual
						// reconciliation instead of restoring into an unreachable owner.
					} else {
						compensationConflicts.push("core_changed_after_migration_write");
					}

					try {
						currentOverride = (await ctx.storage.overrides.get(
							item.sourceOverrideId,
						)) as Override | null;
						currentSiblingOverrideId = currentContent
							? await findSiblingLegacyOverride(
									ctx,
									item.collection!,
									currentContent,
									item.sourceOverrideId,
								)
							: null;
						if (overrideDeleteAttempted && currentSiblingOverrideId) {
							compensationConflicts.push(
								`legacy_alias_changed_after_handoff:${currentSiblingOverrideId}`,
							);
						}
						if (
							currentOverride &&
							legacyOverrideEquals(currentOverride, item.override!) &&
							overrideDeleteAttempted &&
							currentSiblingOverrideId &&
							coreRestored
						) {
							let cleanupError: unknown = null;
							try {
								const cleaned = await compareOverrideAndSet(
									item.sourceOverrideId,
									{ state: "value", value: currentOverride },
									{ action: "delete" },
								);
								if (!cleaned) cleanupError = new Error("legacy_owner_changed_during_cleanup");
							} catch (cause: unknown) {
								cleanupError = cause;
							}
							currentOverride = (await ctx.storage.overrides.get(
								item.sourceOverrideId,
							)) as Override | null;
							if (currentOverride) {
								compensationConflicts.push(
									`legacy_owner_cleanup_failed: ${String(cleanupError ?? "delete_not_committed")}`,
								);
							}
						}
						if (
							!currentOverride &&
							overrideDeleteAttempted &&
							!currentSiblingOverrideId &&
							currentSourceStillAliases
						) {
							if (!coreRestored) {
								compensationConflicts.push(
									"legacy_owner_not_restored_while_core_restore_is_unsafe",
								);
							} else {
								let restoreError: unknown = null;
								try {
									const restored = await compareOverrideAndSet(
										item.sourceOverrideId,
										{ state: "missing" },
										{ action: "put", value: item.override! },
									);
									if (!restored) restoreError = new Error("legacy_owner_changed_during_restore");
								} catch (cause: unknown) {
									restoreError = cause;
								}
								const restored = (await ctx.storage.overrides.get(
									item.sourceOverrideId,
								)) as Override | null;
								if (!restored) {
									compensationErrors.push(
										`override_restore_failed: ${String(restoreError ?? "legacy_override_restore_verification_failed")}`,
									);
								} else if (!legacyOverrideEquals(restored, item.override!)) {
									compensationConflicts.push("legacy_owner_changed_during_restore");
								} else if (
									currentContent &&
									(await findSiblingLegacyOverride(
										ctx,
										item.collection!,
										currentContent,
										item.sourceOverrideId,
									))
								) {
									let cleanupError: unknown = null;
									try {
										const cleaned = await compareOverrideAndSet(
											item.sourceOverrideId,
											{ state: "value", value: restored },
											{ action: "delete" },
										);
										if (!cleaned) cleanupError = new Error("legacy_owner_changed_during_cleanup");
									} catch (cause: unknown) {
										cleanupError = cause;
									}
									const afterCleanup = (await ctx.storage.overrides.get(
										item.sourceOverrideId,
									)) as Override | null;
									if (afterCleanup) {
										compensationConflicts.push(
											`legacy_owner_cleanup_failed: ${String(cleanupError ?? "delete_not_committed")}`,
										);
									}
								}
							}
						} else if (currentSiblingOverrideId && !coreRestored) {
							compensationConflicts.push("legacy_alias_present_while_core_restore_is_unsafe");
						} else if (!currentOverride && !coreRestored) {
							compensationConflicts.push("legacy_owner_missing_while_core_restore_is_unsafe");
						}
					} catch (compensationError: unknown) {
						compensationErrors.push(`override_restore_failed: ${String(compensationError)}`);
					}

					record.status = "failed";
					record.error = [
						String(error),
						...compensationErrors,
						...compensationConflicts.map((conflict) => `compensation_conflict: ${conflict}`),
					].join("; ");
					record.updatedAt = new Date().toISOString();
					const failedJournal = await persistCoreSeoMigrationRecord(ctx, record);
					const failedOperation = await finalizeCoreSeoMigrationOperation(
						operationStore,
						preparedOperation,
						"failed",
						record,
					);
					const resultError = failedJournal.persisted
						? failedOperation === "committed"
							? record.error
							: `${record.error}; recovery_operation_finalize_failed`
						: `${record.error}; failed_journal_finalize_failed: ${failedJournal.error}`;
					if (!failedJournal.persisted) {
						ctx.log.error("seo: failed migration journal could not be finalized", {
								ref: item.ref,
								error: failedJournal.error,
						});
					}
					const changedPreview =
						(String(error).includes("changed_before_handoff") ||
							String(error).includes("legacy_alias_changed")) &&
						compensationErrors.length === 0 &&
						compensationConflicts.length === 0;
					const leaseChanged =
						String(error).includes("operation_lease_changed") &&
						compensationErrors.length === 0 &&
						compensationConflicts.length === 0;
					return {
						ref: item.ref,
						status: leaseChanged
							? "operation-busy"
							: changedPreview
								? "changed-since-preview"
								: compensationConflicts.length
									? "partial-conflict"
									: "failed",
						migrationId,
						error: resultError,
					};
				}
			},
		);
		if (leased.acquired) {
			results.push(leased.value);
		} else if ("value" in leased && leased.value !== undefined) {
			results.push(leased.value);
		} else {
			results.push({
				ref: item.ref,
				status: "operation-busy",
				error: "Another migration operation owns this entry lease. Retry after it completes.",
			});
		}
	}

	return {
		success: results.some((item) => item.status === "applied"),
		batchId,
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		summary: summariseOperationResults(results),
		results,
	};
}

async function rollbackCoreSeoMigration(ctx: PluginContext, batchId: string) {
	const content = ctx.content;
	const conditionalContentUpdate = (content as any)?.updateIfUnchanged;
	const operationStore = coreSeoMigrationOperationStore(ctx);
	if (
		!content ||
		typeof conditionalContentUpdate !== "function" ||
		!supportsConditionalStorage(ctx.storage.overrides) ||
		!operationStore
	)
		return { success: false, error: "content_write_unavailable" };
	const updateContentIfUnchanged = conditionalContentUpdate.bind(content);
	const compareOverrideAndSet = compareStoredValue.bind(null, ctx.storage.overrides);
	const batch = await migrationRecordsForBatch(ctx, batchId);
	if (!batch.complete) {
		return {
			success: false,
			error: "incomplete_batch",
			batchId,
			summary: summariseOperationResults([]),
			results: [],
		};
	}
	const records = batch.records;
	const results: Array<{
		ref: string;
		status: string;
		migrationId?: string;
		error?: string;
	}> = [];

	for (const staleRecord of records) {
		if (staleRecord.status !== "applied") {
			results.push({
				ref: staleRecord.ref,
				status: `not-applied:${staleRecord.status}`,
				migrationId: staleRecord.id,
			});
			continue;
		}

		const leased = await withOperationLease(
			ctx,
			`core-seo-migration:${staleRecord.collection}:${staleRecord.entryId}`,
			async (owner) => {
				const record = (await ctx.storage.migrations.get(
					staleRecord.id,
				)) as CoreSeoMigrationRecord | null;
				if (!record || record.status !== "applied") {
					return {
						ref: staleRecord.ref,
						status: `not-applied:${record?.status ?? "failed"}`,
						migrationId: staleRecord.id,
					};
				}
				const operationId = await coreSeoMigrationOperationId(record.sourceOverrideId);
				let operationRaw = await operationStore.get(operationId);
				let operation = storedCoreSeoMigrationOperation(operationId, operationRaw);
				if (operationRaw != null && !operation) {
					return {
						ref: record.ref,
						status: "partial-conflict",
						migrationId: record.id,
						error: "The migration recovery record is invalid.",
					};
				}
				if (operation && operation.record.id !== record.id) {
					return {
						ref: record.ref,
						status: "changed-since-migration",
						migrationId: record.id,
						error: "A newer migration recovery record owns this legacy entry.",
					};
				}

				if (
					operation?.record.id === record.id &&
					(operation.status === "rolling-back" || operation.status === "rolled-back")
				) {
					const [checkpointCore, checkpointOverride] = await Promise.all([
						content.get(record.collection, record.entryId),
						ctx.storage.overrides.get(record.sourceOverrideId) as Promise<Override | null>,
					]);
					if (!checkpointCore) {
						return {
							ref: record.ref,
							status: "partial-conflict",
							migrationId: record.id,
							error: "The rollback recovery owner is missing.",
						};
					}
					const sourceStillAliases = legacyOverrideAliasRefs(
						record.collection,
						checkpointCore,
					).includes(record.sourceOverrideId);
					const checkpointIsCanonical = String(checkpointCore.id ?? "") === record.entryId;
					const checkpointSibling = await findSiblingLegacyOverride(
						ctx,
						record.collection,
						checkpointCore,
						record.sourceOverrideId,
					);
					if (!checkpointIsCanonical || !sourceStillAliases || checkpointSibling) {
						return {
							ref: record.ref,
							status: "partial-conflict",
							migrationId: record.id,
							error: "The rollback recovery identity changed.",
						};
					}
					if (coreSeoEquals(checkpointCore.seo, record.before)) {
						if (
							checkpointOverride &&
							!legacyOverrideEquals(checkpointOverride, record.sourceOverride)
						) {
							return {
								ref: record.ref,
								status: "partial-conflict",
								migrationId: record.id,
								error: "A different legacy owner blocks rollback recovery.",
							};
						}
						let restoredMissingSource = false;
						if (!checkpointOverride) {
							if (!(await owner.renew())) {
								return {
									ref: record.ref,
									status: "operation-busy",
									migrationId: record.id,
								};
							}
							let restored = false;
							try {
								restored = await compareOverrideAndSet(
									record.sourceOverrideId,
									{ state: "missing" },
									{ action: "put", value: record.sourceOverride },
								);
							} catch (error: unknown) {
								return {
									ref: record.ref,
									status: "operation-busy",
									migrationId: record.id,
									error: `Rollback source restore outcome is unavailable: ${String(error)}`,
								};
							}
							if (!restored) {
								return {
									ref: record.ref,
									status: "partial-conflict",
									migrationId: record.id,
									error: "The legacy owner changed during rollback recovery.",
								};
							}
							restoredMissingSource = true;
						}

						let verifiedOwners: Awaited<ReturnType<typeof readCoreSeoMigrationOwners>> | null =
							null;
						let verificationError: unknown = null;
						try {
							verifiedOwners = await readCoreSeoMigrationOwners(ctx, record);
						} catch (error: unknown) {
							verificationError = error;
						}
						const ownersMatch = Boolean(
							verifiedOwners?.content &&
								coreSeoEquals(verifiedOwners.content.seo, record.before) &&
								verifiedOwners.canonicalEntry &&
								verifiedOwners.sourceAliases &&
								verifiedOwners.source &&
							legacyOverrideEquals(verifiedOwners.source, record.sourceOverride) &&
								!verifiedOwners.siblingId,
						);
						if (!ownersMatch) {
							let cleanupDetail = "";
							if (restoredMissingSource) {
								try {
									const cleanupCandidate = (await ctx.storage.overrides.get(
										record.sourceOverrideId,
									)) as Override | null;
									if (
										cleanupCandidate &&
										legacyOverrideEquals(cleanupCandidate, record.sourceOverride)
									) {
										let cleaned = false;
										try {
											cleaned = await compareOverrideAndSet(
												record.sourceOverrideId,
												{
													state: "value",
													value: cleanupCandidate,
												},
												{ action: "delete" },
											);
										} catch {
											cleaned = (await ctx.storage.overrides.get(record.sourceOverrideId)) == null;
										}
										if (!cleaned)
											cleanupDetail = " The exact restored source could not be removed.";
									}
								} catch (error: unknown) {
									cleanupDetail = ` Restored-source cleanup failed: ${String(error)}`;
								}
							}
							return {
								ref: record.ref,
								status: "partial-conflict",
								migrationId: record.id,
								error: `Rollback recovery owners changed after source restore.${
									verificationError ? ` ${String(verificationError)}` : ""
								}${cleanupDetail}`,
							};
						}
						record.status = "rolled-back";
						record.updatedAt = new Date().toISOString();
						delete record.error;
						const journal = await persistCoreSeoMigrationRecord(ctx, record);
						if (!journal.persisted) {
							return {
								ref: record.ref,
								status: "operation-busy",
								migrationId: record.id,
								error: `rollback_journal_finalize_failed: ${journal.error}`,
							};
						}
						if (
							(await finalizeCoreSeoMigrationOperation(
								operationStore,
								operation,
								"rolled-back",
								record,
							)) !== "committed"
						) {
							return {
								ref: record.ref,
								status: "operation-busy",
								migrationId: record.id,
								error: "The rollback recovery record could not be finalized.",
							};
						}
						await refreshScoreAfterCoreSeoWrite(
							ctx,
							record.collection,
							verifiedOwners!.content,
						).catch(() => undefined);
						return {
							ref: record.ref,
							status: "rolled-back",
							migrationId: record.id,
						};
					}
					if (!coreSeoEquals(checkpointCore.seo, record.after)) {
						return {
							ref: record.ref,
							status: "partial-conflict",
							migrationId: record.id,
							error: "Core SEO changed outside the rollback recovery checkpoints.",
						};
					}
				}

				const current = await content.get(record.collection, record.entryId);
				if (!current) {
					return {
						ref: record.ref,
						status: "content-not-found",
						migrationId: record.id,
					};
				}
				if (
					!legacyOverrideAliasRefs(record.collection, current).includes(record.sourceOverrideId)
				) {
					return {
						ref: record.ref,
						status: "changed-since-migration",
						migrationId: record.id,
						error:
							"The entry ID/slug no longer resolves to the journaled legacy owner; rollback was skipped to avoid restoring unreachable metadata.",
					};
				}
				if (!coreSeoEquals(current.seo, record.after)) {
					return {
						ref: record.ref,
						status: "changed-since-migration",
						migrationId: record.id,
						error:
							"Core SEO changed after migration; rollback was skipped to protect the newer edit.",
					};
				}
				const siblingOverrideId = await findSiblingLegacyOverride(
					ctx,
					record.collection,
					current,
					record.sourceOverrideId,
				);
				if (siblingOverrideId) {
					return {
						ref: record.ref,
						status: "override-conflict",
						migrationId: record.id,
						error: `Legacy owner ${siblingOverrideId} now aliases this entry; rollback was skipped to avoid creating two legacy owners.`,
					};
				}

				const existingOverride = (await ctx.storage.overrides.get(
					record.sourceOverrideId,
				)) as Override | null;
				if (existingOverride && !legacyOverrideEquals(existingOverride, record.sourceOverride)) {
					return {
						ref: record.ref,
						status: "override-conflict",
						migrationId: record.id,
						error: "A different legacy override now exists; rollback was skipped.",
					};
				}
				if (!(await owner.renew())) {
					return {
						ref: record.ref,
						status: "operation-busy",
						migrationId: record.id,
						error: "The entry lease approached expiry before rollback started. Retry safely.",
					};
				}
				const restoreBoundaryContent = await content.get(record.collection, record.entryId);
				if (
					!restoreBoundaryContent ||
					!coreSeoEquals(restoreBoundaryContent.seo, record.after) ||
					!legacyOverrideAliasRefs(record.collection, restoreBoundaryContent).includes(
						record.sourceOverrideId,
					)
				) {
					return {
						ref: record.ref,
						status: "changed-since-migration",
						migrationId: record.id,
						error:
							"Core SEO or the entry identity changed before the legacy owner restore; rollback was skipped.",
					};
				}
				const restoreBoundarySibling = await findSiblingLegacyOverride(
					ctx,
					record.collection,
					restoreBoundaryContent,
					record.sourceOverrideId,
				);
				if (restoreBoundarySibling) {
					return {
						ref: record.ref,
						status: "override-conflict",
						migrationId: record.id,
						error: `Legacy owner ${restoreBoundarySibling} appeared before restore; rollback was skipped.`,
					};
				}
				const restoreBoundaryOverride = (await ctx.storage.overrides.get(
					record.sourceOverrideId,
				)) as Override | null;
				if (
					restoreBoundaryOverride &&
					!legacyOverrideEquals(restoreBoundaryOverride, record.sourceOverride)
				) {
					return {
						ref: record.ref,
						status: "override-conflict",
						migrationId: record.id,
						error: "A different legacy override appeared before restore; rollback was skipped.",
					};
				}
				let rollbackOperation: CoreSeoMigrationOperation;
				if (operation?.record.id === record.id && operation.status === "rolling-back") {
					rollbackOperation = operation;
				} else {
					rollbackOperation = {
						id: operationId,
						storageVersion: CORE_SEO_MIGRATION_OPERATION_STORAGE_VERSION,
						sourceOverrideId: record.sourceOverrideId,
						selectionFingerprint:
							operation?.selectionFingerprint ?? (await coreSeoMigrationRecordFingerprint(record)),
						status: "rolling-back",
						record: structuredClone(record),
						updatedAt: new Date().toISOString(),
					};
					const prepared = await compareCoreSeoMigrationOperation(
						operationStore,
						operationId,
						operationRaw,
						rollbackOperation,
					);
					if (prepared !== "committed") {
						return {
							ref: record.ref,
							status: "operation-busy",
							migrationId: record.id,
							error: "The rollback recovery record changed before mutation.",
						};
					}
					operationRaw = rollbackOperation;
					operation = rollbackOperation;
				}

				let overrideRestoreAttempted = false;
				try {
					if (!restoreBoundaryOverride) {
						overrideRestoreAttempted = true;
						const restored = await compareOverrideAndSet(
							record.sourceOverrideId,
							{ state: "missing" },
							{ action: "put", value: record.sourceOverride },
						);
						if (!restored) throw new Error("legacy_override_changed_during_restore");
					}

					if (!(await owner.renew())) throw new Error("operation_lease_changed_before_restore");
					const [beforeCoreRestore, beforeCoreOverride] = await Promise.all([
						content.get(record.collection, record.entryId),
						ctx.storage.overrides.get(record.sourceOverrideId) as Promise<Override | null>,
					]);
					if (!beforeCoreRestore || !coreSeoEquals(beforeCoreRestore.seo, record.after))
						throw new Error("core_seo_changed_before_restore");
					if (
						!beforeCoreOverride ||
						!legacyOverrideEquals(beforeCoreOverride, record.sourceOverride)
					)
						throw new Error("legacy_override_changed_during_restore");
					if (
						!legacyOverrideAliasRefs(record.collection, beforeCoreRestore).includes(
							record.sourceOverrideId,
					)
					)
						throw new Error("legacy_owner_alias_changed_before_restore");
					if (
						await findSiblingLegacyOverride(
							ctx,
							record.collection,
							beforeCoreRestore,
							record.sourceOverrideId,
						)
					)
						throw new Error("legacy_alias_changed_before_restore");
					const restoreRevision = migrationContentRevision(beforeCoreRestore);
					if (!restoreRevision) throw new Error("core_revision_unavailable_before_restore");
					const updateResult = await updateContentIfUnchanged(
						record.collection,
						record.entryId,
						{
							seo: record.before,
						},
						restoreRevision,
					);
					if (!updateResult?.updated) throw new Error("core_seo_changed_before_restore");
					const updated = updateResult.item;
					if (!coreSeoEquals(updated.seo, record.before))
						throw new Error("core_seo_restore_verification_failed");

					const [finalCore, finalOverride] = await Promise.all([
						content.get(record.collection, record.entryId),
						ctx.storage.overrides.get(record.sourceOverrideId) as Promise<Override | null>,
					]);
					if (!finalCore || !coreSeoEquals(finalCore.seo, record.before))
						throw new Error("core_seo_changed_after_restore");
					if (!finalOverride || !legacyOverrideEquals(finalOverride, record.sourceOverride))
						throw new Error("legacy_override_changed_after_restore");
					if (
						!legacyOverrideAliasRefs(record.collection, finalCore).includes(record.sourceOverrideId)
						)
						throw new Error("legacy_owner_alias_changed_after_restore");
					if (
						await findSiblingLegacyOverride(
							ctx,
							record.collection,
							finalCore,
							record.sourceOverrideId,
						)
					)
						throw new Error("legacy_alias_changed_after_restore");

					record.status = "rolled-back";
					record.updatedAt = new Date().toISOString();
					delete record.error;
					const rolledBackJournal = await persistCoreSeoMigrationRecord(ctx, record);
					if (!rolledBackJournal.persisted)
						throw new Error(`rollback_journal_finalize_failed: ${rolledBackJournal.error}`);
					if (
						(await finalizeCoreSeoMigrationOperation(
							operationStore,
							rollbackOperation,
							"rolled-back",
							record,
						)) !== "committed"
					)
						throw new Error("rollback_recovery_finalize_failed");
					await refreshScoreAfterCoreSeoWrite(ctx, record.collection, updated);
					return {
						ref: record.ref,
						status: "rolled-back",
						migrationId: record.id,
					};
				} catch (error: unknown) {
					const conflicts: string[] = [];
					let currentCore: any | null = null;
					let currentOverride: Override | null = null;
					let currentSiblingOverrideId: string | null = null;
					let currentSourceStillAliases = false;
					try {
						[currentCore, currentOverride] = await Promise.all([
							content.get(record.collection, record.entryId),
							ctx.storage.overrides.get(record.sourceOverrideId) as Promise<Override | null>,
						]);
						if (currentCore) {
							currentSourceStillAliases = legacyOverrideAliasRefs(
								record.collection,
								currentCore,
							).includes(record.sourceOverrideId);
							currentSiblingOverrideId = await findSiblingLegacyOverride(
								ctx,
								record.collection,
								currentCore,
								record.sourceOverrideId,
							);
						}
					} catch (readError: unknown) {
						conflicts.push(`rollback_state_check_failed: ${String(readError)}`);
					}

					// An update can commit and still surface a transport error. If both
					// expected rollback values are durable, finish the journal instead of
					// compensating a successful rollback.
					if (
						currentCore &&
						coreSeoEquals(currentCore.seo, record.before) &&
						currentOverride &&
						legacyOverrideEquals(currentOverride, record.sourceOverride) &&
						!currentSiblingOverrideId &&
						currentSourceStillAliases
					) {
						record.status = "rolled-back";
						record.updatedAt = new Date().toISOString();
						delete record.error;
						const journalRolledBack = await persistCoreSeoMigrationRecord(ctx, record);
						if (!journalRolledBack.persisted) {
							conflicts.push(`rollback_journal_finalize_failed: ${journalRolledBack.error}`);
						} else if (
							(await finalizeCoreSeoMigrationOperation(
								operationStore,
								rollbackOperation,
								"rolled-back",
								record,
							)) === "committed"
						) {
							await refreshScoreAfterCoreSeoWrite(ctx, record.collection, currentCore).catch(
								(scoreError: unknown) => {
									ctx.log.warn("seo: rolled-back migration score refresh failed", {
										ref: record.ref,
										error: String(scoreError),
									});
									},
								);
							return {
								ref: record.ref,
								status: "rolled-back",
								migrationId: record.id,
							};
						}
					}

					if (!currentCore) {
						conflicts.push("core_owner_missing_during_rollback");
					} else if (!coreSeoEquals(currentCore.seo, record.after)) {
						conflicts.push("core_owner_changed_during_rollback");
					}
					if (currentCore && !currentSourceStillAliases) {
						conflicts.push("legacy_owner_no_longer_aliases_entry");
					}
					if (currentSiblingOverrideId) {
						conflicts.push(`legacy_alias_changed_during_rollback:${currentSiblingOverrideId}`);
					}
					if (
						overrideRestoreAttempted &&
						currentOverride &&
						!legacyOverrideEquals(currentOverride, record.sourceOverride)
					) {
						conflicts.push("legacy_owner_changed_during_rollback");
					}
					if (
						overrideRestoreAttempted &&
						currentOverride &&
						legacyOverrideEquals(currentOverride, record.sourceOverride) &&
						(Boolean(currentCore && !currentSourceStillAliases) ||
							currentSiblingOverrideId ||
							Boolean(currentCore && !coreSeoEquals(currentCore.seo, record.before)))
					) {
						try {
							const cleanupCandidate = (await ctx.storage.overrides.get(
								record.sourceOverrideId,
							)) as Override | null;
							if (
								cleanupCandidate &&
								!legacyOverrideEquals(cleanupCandidate, record.sourceOverride)
							) {
								conflicts.push("legacy_owner_changed_during_rollback_cleanup");
							} else if (cleanupCandidate) {
								let cleanupError: unknown = null;
								try {
									const cleaned = await compareOverrideAndSet(
										record.sourceOverrideId,
										{ state: "value", value: cleanupCandidate },
										{ action: "delete" },
									);
									if (!cleaned)
										cleanupError = new Error("legacy_owner_changed_during_rollback_cleanup");
								} catch (cause: unknown) {
									cleanupError = cause;
								}
								const afterCleanup = (await ctx.storage.overrides.get(
									record.sourceOverrideId,
								)) as Override | null;
								if (afterCleanup && legacyOverrideEquals(afterCleanup, record.sourceOverride)) {
									conflicts.push(
										`legacy_owner_cleanup_failed: ${String(cleanupError ?? "delete_not_committed")}`,
									);
								} else if (afterCleanup) {
									conflicts.push("legacy_owner_changed_during_rollback_cleanup");
								}
							}
						} catch (cleanupError: unknown) {
							conflicts.push(`legacy_owner_cleanup_failed: ${String(cleanupError)}`);
						}
					}
					record.status = conflicts.length ? "failed" : "applied";
					record.error = [
						String(error),
						...conflicts.map((conflict) => `rollback_conflict: ${conflict}`),
					].join("; ");
					record.updatedAt = new Date().toISOString();
					const failedJournal = await persistCoreSeoMigrationRecord(ctx, record);
					const failedOperation = await finalizeCoreSeoMigrationOperation(
						operationStore,
						rollbackOperation,
						record.status === "applied" ? "applied" : "failed",
						record,
					);
					const resultError = failedJournal.persisted
						? failedOperation === "committed"
							? record.error
							: `${record.error}; rollback_recovery_finalize_failed`
						: `${record.error}; failed_journal_finalize_failed: ${failedJournal.error}`;
					if (!failedJournal.persisted) {
						ctx.log.error("seo: rollback journal could not be finalized", {
							ref: record.ref,
							error: failedJournal.error,
						});
					}
					const leaseChanged =
						String(error).includes("operation_lease_changed") && conflicts.length === 0;
					return {
						ref: record.ref,
						status: conflicts.length
							? "partial-conflict"
							: leaseChanged
								? "operation-busy"
								: "failed",
						migrationId: record.id,
						error: resultError,
					};
				}
			},
		);
		if (leased.acquired) {
			results.push(leased.value);
		} else if ("value" in leased && leased.value !== undefined) {
			results.push(leased.value);
		} else {
			results.push({
				ref: staleRecord.ref,
				status: "operation-busy",
				migrationId: staleRecord.id,
				error: "Another migration operation owns this entry lease. Retry after it completes.",
			});
		}
	}

	return {
		success: results.some((item) => item.status === "rolled-back"),
		batchId,
		summary: summariseOperationResults(results),
		results,
	};
}

async function migrationRecordsForBatch(
	ctx: PluginContext,
	batchId: string,
): Promise<
	{ complete: true; records: CoreSeoMigrationRecord[] } | { complete: false; records: [] }
> {
	const records = new Map<string, CoreSeoMigrationRecord>();
	let scanned = 0;
	let cursor: string | undefined;
	const seenCursors = new Set<string>();
	do {
		const result = await ctx.storage.migrations.query({
			where: { batchId },
			limit: Math.min(100, 500 - scanned),
			cursor,
		});
		const items = result.items ?? [];
		scanned += items.length;
		for (const item of items) {
			const record = ((item as any).data ?? item) as CoreSeoMigrationRecord;
			if (record?.batchId === batchId && record.id) records.set(record.id, record);
		}
		if (!result.hasMore) break;
		if (!result.cursor || seenCursors.has(result.cursor) || items.length === 0 || scanned >= 500) {
			return { complete: false, records: [] };
		}
		seenCursors.add(result.cursor);
		cursor = result.cursor;
	} while (cursor && scanned < 500);
	return {
		complete: true,
		records: [...records.values()].sort((left, right) => {
			const createdAtOrder = String(left.createdAt).localeCompare(String(right.createdAt));
		return createdAtOrder || left.id.localeCompare(right.id);
		}),
	};
}

async function resolveContentItem(
	ctx: PluginContext,
	collection: string,
	identifier: string,
): Promise<any | null> {
	if (!ctx.content) return null;
	return ctx.content.get(collection, identifier);
}

async function findSiblingLegacyOverride(
	ctx: PluginContext,
	collection: string,
	item: any,
	sourceOverrideId: string,
): Promise<string | null> {
	for (const ref of legacyOverrideAliasRefs(collection, item)) {
		if (ref !== sourceOverrideId && (await ctx.storage.overrides.get(ref))) return ref;
	}
	return null;
}

async function findLegacyOverrideRef(
	ctx: PluginContext,
	collection: string,
	item: any,
): Promise<string | null> {
	const refs = legacyOverrideAliasRefs(collection, item);
	for (const ref of refs) {
		if (await ctx.storage.overrides.get(ref)) return ref;
	}
	return null;
}

async function refreshScoreAfterCoreSeoWrite(
	ctx: PluginContext,
	collection: string,
	item: any,
): Promise<void> {
	await runSavedScoreLifecycle(ctx, { collection, id: String(item.id) });
}

function parseContentRef(ref: string): { collection: string; identifier: string } | null {
	const separator = ref.indexOf(":");
	if (separator <= 0 || separator === ref.length - 1) return null;
	const collection = ref.slice(0, separator).trim();
	const identifier = ref.slice(separator + 1).trim();
	return collection && identifier ? { collection, identifier } : null;
}

async function resolveAdminSocialTarget(
	ctx: PluginContext,
	value: unknown,
): Promise<
	| { success: true; ref: string }
	| { success: false; ref: string | null; error: SeoAdminSocialOverrideReadError }
> {
	const parsed = typeof value === "string" && value.length <= 256 ? parseContentRef(value) : null;
	if (!parsed || value !== `${parsed.collection}:${parsed.identifier}` ||
		parsed.collection.length > 64 || parsed.identifier.length > 128) {
		return { success: false, ref: null, error: "invalid_ref" };
	}
	const ref = value as string;
	try {
		const collection = await supportedContentCollection(ctx, parsed.collection);
		if (!collection) return { success: false, ref, error: "unsupported_collection" };
		if (!ctx.content) return { success: false, ref, error: "content_unavailable" };
		const item = await ctx.content.get(collection, parsed.identifier);
		if (!item || String(item.id) !== parsed.identifier || contentRef(collection, item) !== ref) {
			return { success: false, ref, error: "not_found" };
		}
		return { success: true, ref };
	} catch {
		return { success: false, ref, error: "content_unavailable" };
	}
}

function createMigrationBatchId(): string {
	const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
	return `core-seo-v${CORE_SEO_MIGRATION_VERSION}-${Date.now()}-${random}`;
}

function legacyOverrideEquals(a: Override, b: Override): boolean {
	// Ownership handoff is snapshot-exact, not merely semantically equivalent.
	// Unknown compatibility fields and whitespace are part of the raw owner that
	// the preview fingerprint protected and must never be silently discarded.
	return portabilityValueEquals(a, b);
}

function summariseOperationResults(results: Array<{ status: string }>) {
	return results.reduce<Record<string, number>>((summary, result) => {
		summary[result.status] = (summary[result.status] ?? 0) + 1;
		return summary;
	}, {});
}

// The event identifies the saved row and gates its version; analysis always
// rereads the exact id and locale and hydrates the saved draft itself.
async function refreshScoreFromContentEvent(event: any, ctx: PluginContext): Promise<void> {
	const collection = cleanCollection(event?.collection);
	if (!collection || !ctx.content) return;
	const content = event?.content;
	const id = clean(content?.id);
	if (!id) return;
	const hasSavedPayload = content?.data && typeof content.data === "object" && !Array.isArray(content.data);
	await runSavedScoreLifecycle(ctx, {
		collection,
		id,
		...(typeof content?.locale === "string" ? { locale: content.locale } : {}),
		...(hasSavedPayload ? { gate: (current: any) => sameScoreContentSource(current, content) } : {}),
	});
}

function sameScoreContentSource(current: any, saved: any): boolean {
	const version = scoreContentSourceVersion(current);
	return version !== null && version === scoreContentSourceVersion(saved) &&
		current.id === saved.id && current.status === saved.status &&
		(current.liveRevisionId ?? null) === (saved.liveRevisionId ?? null) &&
		(current.slug ?? null) === (saved.slug ?? null);
}

async function cleanupAnalysisFromContentEvent(event: any, ctx: PluginContext): Promise<void> {
	const collection = cleanCollection(event?.collection);
	const id = clean(event?.id ?? event?.content?.id);
	if (!collection || !id) return;
	const ref = `${collection}:${id}`;
	const cleanup = [
		deleteAnalysisProfile(ctx, ref),
		deleteSocialOverride(ctx, ref),
		deleteMetaOverride(ctx, ref),
	];
	const scoreStore = (ctx.storage as any)?.scores;
	if (scoreStore && typeof scoreStore.delete === "function") cleanup.push(scoreStore.delete(ref));
	const results = await Promise.allSettled(cleanup);
	for (const result of results) {
		if (result.status === "rejected") {
			ctx.log?.warn?.("seo: deleted content analysis cleanup failed", {
				error: String(result.reason),
			});
		}
	}
}

// Stored rows verified one at a time, so a list costs one scoped input capture per returned row.
async function verifiedStoredFreshness(
	ctx: PluginContext,
	items: readonly SeoScoreRecord[],
): Promise<Map<string, "current" | "stale">> {
	const freshness = new Map<string, "current" | "stale">();
	for (const item of items) freshness.set(item.ref, await verifyStoredScoreFreshness(ctx, item));
	return freshness;
}

function adminContentScores(
	items: SeoAdminContentScore[],
	cursor?: string,
	hasMore = false,
	verified?: ReadonlyMap<string, "current" | "stale"> | false,
): SeoAdminContentScores {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		generatedAt: new Date().toISOString(),
		engineVersion: SEO_ENGINE_VERSION,
		scoreVersion: SEO_SCORE_VERSION,
		items: items.map((item) => {
			const { freshness: _storedFreshness, ...score } = item;
			// History alone claims nothing current; an earlier analyzer's record is always stale.
			if (verified === false) return score.scoreVersion === SEO_SCORE_VERSION ? score : { ...score, freshness: "stale" as const };
			if (verified) return { ...score, freshness: verified.get(score.ref) ?? "stale" };
			return { ...score, freshness: isStoredScoreCurrent(score) ? "current" : "stale" };
		}),
		...(cursor !== undefined ? { cursor } : {}),
		hasMore,
	};
}

type ContentAnalysisAdmissionFailure = "activation_required" | "scoring_disabled" | "scoring_unavailable" | "profile_required" | "profile_unavailable";

async function contentAnalysisAdmissionFailure(
	ctx: PluginContext,
	collection?: string,
	purpose: EntryAnalysisPurpose = "automatic",
): Promise<ContentAnalysisAdmissionFailure | null> {
	const policy = await readContentScoringPolicy(ctx);
	if (purpose === "automatic" && policy.state === "pending-confirmation") return "activation_required";
	if (purpose === "automatic" && policy.state === "paused") return "scoring_disabled";
	if (policy.state === "unavailable") return "scoring_unavailable";
	if (collection !== undefined) {
		const profile = await readCollectionAnalysisProfile(ctx, collection);
		if (profile.state === "unconfigured") return "profile_required";
		if (profile.state === "unavailable") return "profile_unavailable";
	}
	return null;
}

function savedAnalysisFailure(outcome: SavedScoreOutcome): SeoAdminSavedAnalysisFailure {
	switch (outcome.status) {
		case "activation_required":
		case "profile_required":
		case "profile_unavailable":
			return outcome.status;
		case "disabled":
			return "scoring_disabled";
		case "unavailable":
			return outcome.reason === "content" ? "content_unavailable" : "scoring_unavailable";
		case "not-found":
			return "content_not_found";
		case "locale-mismatch":
			return "locale_mismatch";
		case "superseded":
			return "superseded";
		case "uncertain":
			return "uncertain";
		default:
			return "analysis_failed";
	}
}

const LEGACY_ANALYZER_REFUSALS: Record<SeoAdminSavedAnalysisFailure, string> = {
	invalid_ref: "Select content to analyze",
	unsupported_collection: "Select content to analyze",
	content_unavailable: "Content access is unavailable, so no analysis result was stored",
	content_not_found: "The selected content is no longer available",
	locale_mismatch: "The selected content is no longer available",
	scoring_disabled: "Content scoring is paused in SEO > Content health",
	activation_required: "Review resource use and enable analysis in SEO > Content health",
	profile_required: "Choose an assessment profile for this content type in SEO > Content health",
	profile_unavailable: "The assessment profile could not be read, so no analysis result was stored",
	scoring_unavailable: "SEO scoring settings could not be read, so no analysis result was stored",
	superseded: "The content or SEO settings changed during analysis, so no analysis result was stored; analyze again",
	uncertain: "The score could not be confirmed as saved. Reload before analyzing again",
	analysis_failed: "The selected content could not be analyzed",
};

const LEGACY_HISTORY_WARNINGS: Partial<Record<ScoreHistoryOutcome, string>> = {
	failed: "Its score history entry could not be recorded.",
	uncertain: "Its score history entry could not be confirmed.",
};

interface LegacyAnalyzerResult {
	score: SeoScoreRecord | null;
	/** `session` for a trial keyword; otherwise the lifecycle's accepted outcome. */
	outcome: "saved" | "reused" | "session" | null;
	history: ScoreHistoryOutcome;
	refusal: string | null;
}

// A trial keyword is analyzed in session mode, so only the entry's own
// keywords reach stored scores and history.
async function legacyAnalyzerScore(
	ctx: PluginContext,
	ref: string,
	keyword?: string,
): Promise<LegacyAnalyzerResult> {
	const refused = (refusal: string): LegacyAnalyzerResult => ({ score: null, outcome: null, history: "not-attempted", refusal });
	const parsed = parseContentRef(ref);
	const collection = parsed ? cleanCollection(parsed.collection) : null;
	if (!ctx.content || !parsed || !collection) return refused(LEGACY_ANALYZER_REFUSALS.content_not_found);
	const admissionFailure = await contentAnalysisAdmissionFailure(ctx, collection);
	if (admissionFailure) return refused(LEGACY_ANALYZER_REFUSALS[admissionFailure]);
	if (keyword) {
		const item = await ctx.content.get(collection, parsed.identifier);
		if (!item) return refused(LEGACY_ANALYZER_REFUSALS.content_not_found);
		return { score: await analyzeContentPreview(ctx, collection, item, keyword), outcome: "session", history: "not-attempted", refusal: null };
	}
	const outcome = await runSavedScoreLifecycle(ctx, { collection, id: parsed.identifier });
	return outcome.status === "saved" || outcome.status === "reused"
		? { score: outcome.score, outcome: outcome.status, history: outcome.history, refusal: null }
		: refused(LEGACY_ANALYZER_REFUSALS[savedAnalysisFailure(outcome)]);
}

async function scoreByRef(
	ctx: PluginContext,
	ref: string,
	keyword?: string,
): Promise<SeoScoreRecord | null> {
	return (await legacyAnalyzerScore(ctx, ref, keyword)).score;
}

const UNAVAILABLE_REFRESH_INPUTS: Record<Extract<SavedScoreOutcome, { status: "unavailable" }>["reason"], string> = {
	policy: "scoring settings",
	configuration: "SEO configuration",
	content: "saved content",
	storage: "score storage",
};

async function refreshScorePage(
	ctx: PluginContext,
	collection: string,
	options: { cursor?: string; revision?: string; limit: number; status?: string; locale?: string },
): Promise<{
	processed: number;
	updated: number;
	scoreVersion: typeof SEO_SCORE_VERSION;
	revision: string;
	cursor: string | null;
	hasMore: boolean;
}> {
	const policy = await readContentScoringPolicy(ctx);
	if (policy.state === "paused") throw new Error("Content scoring is paused.");
	if (policy.state === "pending-confirmation") throw new Error("Review resource use and enable content analysis first.");
	if (policy.state === "unavailable") throw new Error("Content scoring settings could not be read.");
	const admissionFailure = await contentAnalysisAdmissionFailure(ctx, collection);
	if (admissionFailure) throw new Error(LEGACY_ANALYZER_REFUSALS[admissionFailure]);
	if (!ctx.content) {
		return {
			processed: 0,
			updated: 0,
			scoreVersion: SEO_SCORE_VERSION,
			revision: await scoreRefreshRevision("content-api-unavailable"),
			cursor: null,
			hasMore: false,
		};
	}
	const initialInputs = await readScoreRefreshInputSnapshot(ctx, undefined, undefined, { ...options, collection });
	if (options.cursor && options.revision !== initialInputs.revision) {
		throw new Error("Score refresh configuration changed. Start again from the first page.");
	}
	let processed = 0;
	let updated = 0;
	let historyCreated = false;
	let nextCursor: string | null = null;
	let hasMore = false;
	let revision = initialInputs.revision;
	try {
		const contentPage = await ctx.content.list(collection, {
			limit: options.limit,
			cursor: options.cursor,
			orderBy: { updatedAt: "desc" },
			...(options.status || options.locale ? { where: {
				...(options.status ? { status: options.status } : {}),
				...(options.locale ? { locale: options.locale } : {}),
			} } : {}),
		});
		if (contentPage.items.length > options.limit) {
			throw new Error("Content page exceeded the requested limit.");
		}
		processed = contentPage.items.length;
		nextCursor = clean(contentPage.cursor) ?? null;
		hasMore = Boolean(contentPage.hasMore || nextCursor);
		if (options.cursor && nextCursor === options.cursor) {
			throw new Error("Content pagination did not advance.");
		}
		if (hasMore && !nextCursor) {
			throw new Error("Content pagination did not provide a continuation cursor.");
		}
		const ids: string[] = [];
		for (const listedItem of contentPage.items) {
			const id = clean(listedItem?.id);
			if (!id) throw new Error("Content page returned an item without an identifier.");
			ids.push(id);
		}
		const inputs = await readScoreRefreshInputSnapshot(ctx, undefined, undefined, { ...options, collection });
		revision = inputs.revision;
		if (options.cursor && options.revision !== revision) {
			throw new Error("Score refresh configuration changed. Start again from the first page.");
		}
		// Processed counts every listed entry; updated counts accepted saves only,
		// so reused and refused entries are processed without being updated. A
		// failed, uncertain or unavailable entry stops the page, as an analysis
		// error always has, even when the refusal carries no error of its own.
		for (const id of ids) {
			const outcome = await runSavedScoreLifecycle(ctx, { collection, id, deferGlobalPrune: true });
			if ("error" in outcome && outcome.error !== undefined) throw outcome.error;
			if (outcome.status === "unavailable")
				throw new Error(`Score refresh stopped at ${collection}:${id}: its ${UNAVAILABLE_REFRESH_INPUTS[outcome.reason]} could not be read.`);
			if (outcome.status !== "saved") continue;
			updated += 1;
			historyCreated ||= outcome.history === "created";
		}
	} finally {
		if (historyCreated) {
			try {
				await enforceScoreHistoryRetention(ctx);
			} catch (error: unknown) {
				ctx.log?.warn?.("seo: score history retention maintenance failed", {
					error: String(error),
				});
			}
		}
	}
	return {
		processed,
		updated,
		scoreVersion: SEO_SCORE_VERSION,
		revision,
		cursor: nextCursor,
		hasMore,
	};
}

function contentItemTranslationGroup(item: any): string | null {
	return clean(item?.translationGroup) ?? null;
}

function contentItemExposesTranslationGroup(item: any): boolean {
	return Boolean(
		item &&
		typeof item === "object" &&
		Object.prototype.hasOwnProperty.call(item, "translationGroup"),
	);
}

async function buildLocaleGraphDiagnostic(
	ctx: PluginContext,
	collection: string,
	currentItem: any,
	currentUrl: string,
	currentIndexable: boolean,
): Promise<SeoLocaleGraphDiagnostic> {
	const context = await collectLocaleGraphItems(ctx, collection, currentItem);
	const diagnostic = await diagnoseLocaleGraphFromItems(
		ctx,
		collection,
		currentItem,
		currentUrl,
		currentIndexable,
		context.itemsById,
		{ inferredTranslationGroup: context.inferredTranslationGroup },
	);
	if (!context.lookupFailed) return diagnostic;
	return {
		...diagnostic,
		status: "incomplete",
		alternates: [],
		xDefaultLocale: null,
		issues: [{
			code: "translation-context-unavailable",
			severity: "warning",
			message: "The host could not resolve this entry's translations.",
			locale: diagnostic.currentLocale,
		}],
	};
}

async function collectLocaleGraphItems(
	ctx: PluginContext,
	collection: string,
	currentItem: any,
): Promise<{
	itemsById: Map<string, any>;
	inferredTranslationGroup?: string;
	lookupFailed?: boolean;
}> {
	const currentId = String(currentItem.id);
	const currentOnly = () => ({ itemsById: new Map([[currentId, currentItem]]) });
	if (!ctx.content) return currentOnly();
	const content = ctx.content as PluginContentAccess & {
		getTranslations?: (
			collection: string,
			id: string,
		) => Promise<{ translationGroup: string; translations: Array<{ id: string }> }>;
	};
	try {
		if (typeof content.getTranslations === "function") {
			const group = await loadExactTranslationGroup(content, collection, currentItem);
			if (group) return {
				itemsById: group.itemsById,
				inferredTranslationGroup: group.translationGroup,
			};
		}
		const translationKey = clean(currentItem?.data?.translation_key);
		if (!translationKey) return currentOnly();
		const result = await content.list(collection, {
			limit: 20,
			where: {
				status: "published",
				fieldFilters: { translation_key: translationKey },
			},
		});
		if (result.hasMore || result.cursor) {
			throw new Error("The indexed translation group exceeds the lookup limit.");
		}
		const itemsById = new Map(result.items.map((item) => [String(item.id), item]));
		itemsById.set(currentId, currentItem);
		return { itemsById, inferredTranslationGroup: `key:${translationKey}` };
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: localized route lookup failed", {
			collection,
			entryId: currentId,
			error: String(error),
		});
		return { ...currentOnly(), lookupFailed: true };
	}
}

async function diagnoseLocaleGraphFromItems(
	ctx: PluginContext,
	collection: string,
	currentItem: any,
	currentUrl: string,
	currentIndexable: boolean,
	itemsById: Map<string, any>,
	overrides: { inferredTranslationGroup?: string } = {},
): Promise<SeoLocaleGraphDiagnostic> {
	const hostSupportsTranslationGroups = [...itemsById.values()].some(
		contentItemExposesTranslationGroup,
	);
	const currentEntryId = String(currentItem.id);
	const entries: SeoLocaleGraphEntry[] = await Promise.all(
		[...itemsById.values()].map(async (item) => {
			const entryId = String(item.id);
			const rawSeo = (item?.seo ?? item?.data?.seo ?? {}) as Record<string, unknown>;
			const canonical = clean(rawSeo.canonical as string | null | undefined);
			const fallbackUrl = canonical ? null : await publicUrlForContent(ctx, collection, item);
			return {
				entryId,
				locale: contentItemLocale(ctx, item),
				translationGroup:
					overrides.inferredTranslationGroup ?? contentItemTranslationGroup(item),
				published: contentItemIsPublished(item),
				indexable: entryId === currentEntryId ? currentIndexable : rawSeo.noIndex !== true,
				url:
					entryId === currentEntryId
						? currentUrl
						: (canonical ?? fallbackUrl),
			};
		}),
	);

	return diagnoseSeoLocaleGraph({
		currentEntryId,
		defaultLocale: clean(ctx.site?.locale) ?? "en",
		hostSupportsTranslationGroups:
			hostSupportsTranslationGroups || Boolean(overrides.inferredTranslationGroup),
		entries,
	});
}

async function buildPageHreflangLinks(
	ctx: PluginContext,
	collection: string,
	currentItem: any,
	currentUrl: string,
	currentIndexable: boolean,
) {
	const context = await collectLocaleGraphItems(ctx, collection, currentItem);
	if (context.lookupFailed || context.itemsById.size < 2) return [];
	const diagnostic = await diagnoseLocaleGraphFromItems(
		ctx,
		collection,
		currentItem,
		currentUrl,
		currentIndexable,
		context.itemsById,
		{ inferredTranslationGroup: context.inferredTranslationGroup },
	);
	return resolveSeoHreflangLinks(diagnostic);
}

async function seoAudit(ctx: PluginContext) {
	const c = await counts(ctx);
	const site = await readSiteSettings(ctx);
	const readable = isReadableSiteSettings(site);
	// Unreadable settings are not read again: only host facts are shown.
	const g = await getGlobalSettings(ctx, undefined, readable ? site.values : hostOnlySettingsValues(ctx));
	const noindex: boolean | null = readable ? site.values.noindex : null;
	const presets = await getPresets(ctx);
	const modules = await getModules(ctx);
	const ownership = publisherOwnershipEffective(await readPublisherOwnership(ctx.kv));
	const hasPublisherSchema = modules.schema && ownership === "automatic" && presets.organization && presets.website;
	const hasPublicSocialImage = isHttpUrl(absoluteMetadataUrl(g.defaultOgImage, g.siteUrl));

	const checks: SeoAuditCheck[] = [
		{
			group: "Indexing",
			check: "Search visibility",
			status: noindex === false ? "pass" : "fail",
			weight: 18,
			detail: site.state === "corrupt"
				? "The stored SEO settings are invalid. This plugin adds no metadata to public pages until they are restored."
				: site.state === "unavailable"
					? "The SEO settings could not be read. Public pages get no SEO metadata from this plugin while they cannot be read."
					: noindex
						? "This plugin adds noindex metadata to supported public pages."
						: site.state === "absent"
							? "No indexing preference is saved, so this plugin adds no site-wide noindex."
							: "This plugin's site-wide noindex setting is off.",
		},
		{
			group: "Indexing",
			check: "Site URL",
			status: g.siteUrl ? "pass" : "review",
			weight: 10,
			detail: g.siteUrl || "Set the production domain for canonical and schema consistency.",
		},
		{
			group: "Schema",
			check: "Publisher schema",
			status: hasPublisherSchema ? "pass" : "review",
			weight: 14,
			detail: hasPublisherSchema
				? `${g.publisherType === "person" ? "Person" : "Organization"} and WebSite schema are configured to be emitted.`
				: !modules.schema
					? "Schema output is off in Feature controls, so the plugin publishes no site entity. EmDash still emits its own minimal WebSite or BlogPosting graph."
					: ownership === "none"
						? "Automatic publisher output is off, so this plugin adds no site Person, Organization or LocalBusiness and no publisher links. Custom schema and EmDash's own markup are unchanged."
					: ownership === "unknown"
						? "The publisher output setting cannot be read, so this plugin adds no automatic publisher until it is repaired."
					: !presets.organization
						? "The site publisher preset is off, so pages carry no Organization or Person entity."
						: "The WebSite preset is off. The site publisher is still emitted, and EmDash fills the page's primary graph with its own WebSite or BlogPosting.",
		},
		{
			group: "Social",
			check: "Default social image",
			status: hasPublicSocialImage ? "pass" : "review",
			weight: 8,
			detail: hasPublicSocialImage
				? "A public fallback Open Graph image is configured."
				: "No fallback image is set in this plugin. EmDash's default social image applies when one is set in its SEO settings, which this plugin cannot read. For a media-library image, also set the site URL.",
		},
	];
	const total = checks.reduce((sum, item) => sum + item.weight, 0);
	const earned = checks.reduce(
		(sum, item) =>
			sum +
			(item.status === "pass" ? item.weight : item.status === "review" ? item.weight * 0.45 : 0),
		0,
	);
	const score = Math.round((earned / total) * 100);
	return { score, checks, counts: c, global: g, noindex, settingsState: site.state, modules };
}

async function buildAdminEntryPreview(
	ctx: PluginContext,
	input: unknown,
): Promise<
	| {
			success: true;
			preview: SeoAdminEntryPreview;
			schemaGraphs: SeoAdminEntrySchemaGraph[];
	  }
	| Exclude<SeoAdminEntryPreviewResult, { success: true }>
> {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return { success: false, error: "invalid_ref" };
	}
	const source = input as Record<string, unknown>;
	const ref = typeof source.ref === "string" ? source.ref.trim() : "";
	let snapshot: SavedContentSnapshotInput | undefined;
	if (source.snapshot !== undefined) {
		if (new TextEncoder().encode(JSON.stringify(source.snapshot)).byteLength > 2 * 1024 * 1024)
			throw new Error("Saved content exceeds the preview request size limit.");
		snapshot = parseSavedContentSnapshot(source.snapshot, ref);
	}
	const entryOnly = toBool(source.entryOnly) || snapshot !== undefined;
	const parsed = parseContentRef(ref);
	if (!parsed || !(await resolveContentCollection(ctx, parsed.collection))) {
		return { success: false, error: "invalid_ref" };
	}
	if (!ctx.content) return { success: false, error: "content_unavailable" };

	let templateOverride: SeoAdminTemplateValues | undefined;
	if (source.template !== undefined) {
		const validation = validateSeoAdminTemplateValues(source.template, parsed.collection);
		if (!validation.success) {
			return {
				success: false,
				error: "invalid_template",
				errors: validation.errors,
			};
		}
		templateOverride = validation.values;
	}

	const hostItem = await resolveContentItem(ctx, parsed.collection, parsed.identifier);
	if (!hostItem) return { success: false, error: "not_found" };
	if (snapshot && String(hostItem.id) !== parsed.identifier)
		throw new Error("Saved preview snapshot requires an exact entry identifier.");
	const item = snapshot ? withSavedContentSnapshot(hostItem, snapshot) : hostItem;
	const site = await readReadableSiteSettings(ctx);
	const observation = createMetadataReadObservation();
	const {
		effective, presets, modules, global, metaOverride, contentTypeRoles, businessIdentity, publisherOwnership, previewPage,
	} = await entrySchemaResolutionInputs(ctx, parsed.collection, parsed.identifier, item, site.values, templateOverride, observation);
	const slug = String(item?.slug ?? item?.data?.slug ?? item?.id ?? "");
	const url =
		effective.canonical.value || (await publicUrlForContent(ctx, parsed.collection, item));
	const customSchemas = entryOnly
		? await readScopedAdminCustomSchemas(ctx, contentSchemaScopes(parsed.collection, item))
		: await readAllAdminCustomSchemas(ctx);
	const schemaGraphs = resolveEntrySchemaGraphs({
		page: previewPage,
		data: item?.data,
		vars: effective.vars,
		settings: global,
		moduleEnabled: modules.schema,
		presets,
		customSchemas,
		contentTypeRoles: schemaOutputContentTypeRoles(contentTypeRoles),
		metaOverride,
		entry: entrySchemaPageEntry(parsed.collection, item),
		businessIdentity,
		publisherOwnership,
	});
	const schemaTypes = resolvedEntrySchemaTypes(previewPage, schemaGraphs);
	const rawSeo = (item?.seo ?? item?.data?.seo ?? {}) as Record<string, unknown>;
	const entryNoindex = rawSeo.noIndex === true;
	let canonicalSiteUrl = global.siteUrl;
	if (!isHttpUrl(canonicalSiteUrl)) {
		try {
			canonicalSiteUrl = new URL(url).origin;
		} catch {
			canonicalSiteUrl = "";
		}
	}
	const canonicalValidation = validateSeoCanonical(
		effective.canonical.value,
		canonicalSiteUrl,
		previewPage.path,
	);
	const localeGraph = entryOnly
		? {
			...await diagnoseLocaleGraphFromItems(ctx, parsed.collection, item,
				effective.canonical.value, effective.indexable, new Map([[String(item.id), item]])),
			status: "incomplete" as const,
			alternates: [],
			xDefaultLocale: null,
			issues: [{
				code: "translation-context-unavailable" as const,
				severity: "info" as const,
				message: "Translation groups are not checked in this entry preview.",
				locale: null,
			}],
		}
		: await buildLocaleGraphDiagnostic(ctx, parsed.collection, item,
			effective.canonical.value, effective.indexable);
	const collectionDefinition = await resolveContentCollection(ctx, parsed.collection);

	const preview: SeoAdminEntryPreview = {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt: new Date().toISOString(),
		...(snapshot ? { sourceVersion: snapshot.sourceVersion, sourceKind: "saved-snapshot" as const } : {}),
		content: {
			ref: `${parsed.collection}:${String(item.id)}`,
			entryId: String(item.id),
			collection: parsed.collection,
			collectionLabel: collectionDefinition?.label ?? parsed.collection,
			title: contentItemTitle(item, collectionDefinition?.titleField),
			slug,
		},
		search: {
			title: effective.title.value,
			description: effective.description.value,
			fallbackTitle: effective.searchTitleFallback.value,
			fallbackDescription: effective.searchDescriptionFallback.value,
			url: effective.canonical.value,
			titleLength: effective.title.value.length,
			descriptionLength: effective.description.value.length,
			publishedAt: effective.vars.publishedAt || null,
		},
		social: {
			editing: await readSocialOverrideEditing(ctx, contentRef(parsed.collection, item), {
				present: observation.socialRefs[0] === contentRef(parsed.collection, item) && observation.social.length > 0,
				value: observation.social[0],
			}),
			title: effective.socialTitle.value,
			description: effective.socialDescription.value,
			image: effective.image.value || null,
			fallbackTitle: effective.socialTitleFallback.value,
			fallbackDescription: effective.socialDescriptionFallback.value,
			...(effective.imageFallback ? {
				fallbackImage: { value: effective.imageFallback.value || null, source: effective.imageFallback.source },
			} : {}),
			override: {
				title: effective.socialOverride?.title ?? null,
				description: effective.socialOverride?.description ?? null,
				updatedAt: effective.socialOverride?.updatedAt ?? null,
			},
		},
		indexable: effective.indexable,
		entryNoindex,
		...(effective.noindexSources ? { noindexSources: [...effective.noindexSources] } : {}),
		canonicalValidation,
		localeGraph,
		schemaTypes: uniqueStrings(schemaTypes),
		sources: {
			title: effective.title.source,
			description: effective.description.source,
			socialTitle: effective.socialTitle.source,
			socialDescription: effective.socialDescription.source,
			canonical: effective.canonical.source,
			image: effective.image.source,
		},
		outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
		ownership: resolveEntryOwnership({
			hostItem,
			resolvedItem: item,
			...(snapshot ? { requestedVersion: snapshot.sourceVersion } : {}),
			effective,
			observation,
		}),
		// The same module, override and description reads the server analysis uses.
		analysis: {
			imageAltChecks: modules.imageSeo,
			schemaOutput: modules.schema,
			nosnippet: metaOverride?.robots?.nosnippet === true,
			descriptionGenerated: isGeneratedDescription(effective.description.value, effective.description.source,
				generatedContentDescription((item?.data ?? {}) as Record<string, unknown>, collectionDefinition ?? null)),
		},
	};
	if (snapshot && await contentChangedSince(ctx, parsed.collection, hostItem))
		throw new Error("Content changed while resolving the preview. Load the saved entry again.");
	return { success: true, preview, schemaGraphs };
}

type SavedContentSnapshotInput = z.infer<typeof SAVED_CONTENT_SNAPSHOT_SCHEMA>;

/** The editor's saved content for exactly one entry, as both entry previews accept it. */
function parseSavedContentSnapshot(value: unknown, ref: string): SavedContentSnapshotInput {
	const validation = SAVED_CONTENT_SNAPSHOT_SCHEMA.safeParse(value);
	if (!validation.success || validation.data.ref !== ref)
		throw new Error("Saved preview snapshot must match the requested entry.");
	return validation.data;
}

function withSavedContentSnapshot(hostItem: any, snapshot: SavedContentSnapshotInput): any {
	const item = {
		...hostItem, data: snapshot.data, slug: snapshot.slug,
		...(snapshot.seo ? { seo: snapshot.seo } : {}),
	};
	// A changed slug needs a route different from the saved host row.
	if (snapshot.slug !== hostItem.slug) unsavedContentSnapshots.add(item);
	return item;
}

/** Reads the row again; a preview resolved against a row that changed meanwhile is not shown. */
async function contentChangedSince(ctx: PluginContext, collection: string, hostItem: any): Promise<boolean> {
	const latest = await ctx.content!.get(collection, String(hostItem.id));
	return !latest || JSON.stringify(latest) !== JSON.stringify(hostItem);
}

/** Everything the shared entry resolver needs besides the stored schema records. */
async function entrySchemaResolutionInputs(
	ctx: PluginContext,
	collection: string,
	identifier: string,
	item: any,
	siteValues: Awaited<ReturnType<typeof readReadableSiteSettings>>["values"],
	templateOverride?: SeoAdminTemplateValues,
	observation?: ReturnType<typeof createMetadataReadObservation>,
) {
	const effective = await resolveEffectiveContentMetadata(ctx, collection, item, templateOverride, siteValues, undefined, observation);
	const [presets, modules, global, metaOverride, contentTypeRoles, businessIdentity, ownershipState] = await Promise.all([
		getPresets(ctx),
		getModules(ctx),
		getGlobalSettings(ctx, undefined, siteValues),
		readMetaOverride(ctx, `${collection}:${identifier}`),
		readSchemaContentTypeRoles(ctx),
		readBusinessIdentityRenderState(businessIdentityStoreFor(ctx as unknown as { settings?: unknown; kv?: unknown })),
		readPublisherOwnership(ctx.kv),
	]);
	const previewPage = await buildEntryPublicPageContext(ctx, collection, item, effective, global, contentTypeRoles.values);
	const publisherOwnership = publisherOwnershipEffective(ownershipState);
	return { effective, presets, modules, global, metaOverride, contentTypeRoles, businessIdentity, publisherOwnership, previewPage };
}

/**
 * The plugin's predicted contribution for one entry with an unsaved schema
 * record, at the content and stored records read during this request. The
 * candidate passes the save command's checks without being written; an
 * edited record replaces its stored row in place and keeps its creation
 * time, so the resolver orders it as the public reader would. Stored rows
 * come from the save command's scoped read, never from every schema record.
 */
async function buildEntrySchemaCandidatePreview(
	ctx: PluginContext,
	input: z.infer<typeof entrySchemaCandidateInput>,
): Promise<SeoAdminEntrySchemaCandidatePreviewResult> {
	const base = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, requestId: input.requestId };
	const refused = (error: SeoAdminEntrySchemaCandidateFailure, message: string): SeoAdminEntrySchemaCandidatePreviewResult =>
		({ ...base, success: false, error, message });
	const ref = `${input.collection}:${input.entryId}`;
	let snapshot: SavedContentSnapshotInput | undefined;
	if (input.snapshot !== undefined) {
		try {
			snapshot = parseSavedContentSnapshot(input.snapshot, ref);
		} catch {
			return refused("snapshot_mismatch", "The saved content sent with this preview belongs to another entry.");
		}
	}
	const prepared = await withEntrySchemaHost(ctx, (host) => prepareEntrySchemaCandidate(host, input));
	if (!prepared.success) {
		if (prepared.error === "invalid_values") {
			return { ...base, success: false, error: "invalid_values", errors: prepared.errors, message: "Fix the highlighted fields to preview this schema." };
		}
		if (prepared.error === "conflict") {
			return { ...base, success: false, error: "conflict", current: prepared.current, message: prepared.message };
		}
		return refused(prepared.error, prepared.message);
	}
	const collection = input.collection;
	const hostItem = await ctx.content?.get(collection, input.entryId);
	// The stored rows were chosen with the first read's slug alias; resolving them
	// against a later read with another slug, locale or status would mix two observations.
	let observed: ReturnType<typeof toEntrySchemaHostEntry> | null = null;
	try {
		observed = hostItem ? toEntrySchemaHostEntry(hostItem) : null;
	} catch {
		observed = null;
	}
	if (
		!observed ||
		observed.id !== input.entryId ||
		observed.slug !== prepared.entry.slug ||
		observed.locale !== prepared.entry.locale ||
		observed.status !== prepared.entry.status
	) {
		return refused("content_changed", "This entry changed while the preview was prepared. Reload the editor.");
	}
	// The host has already loaded this row; what the helpers build from it is bounded first.
	const hostProblem = entrySchemaPreviewContentProblem(hostItem);
	if (hostProblem) return refused("content_too_large", hostProblem);
	const item = snapshot ? withSavedContentSnapshot(hostItem, snapshot) : hostItem;
	const snapshotProblem = snapshot ? entrySchemaPreviewContentProblem(item) : null;
	if (snapshotProblem) return refused("content_too_large", snapshotProblem);
	if (snapshot && toEntrySchemaHostEntry(item).slug !== observed.slug) {
		return refused(
			"snapshot_mismatch",
			"The saved content changes this entry's slug, but stored schemas were read for the current slug. Publish the change or preview the stored entry.",
		);
	}

	let site: Awaited<ReturnType<typeof readReadableSiteSettings>>;
	try {
		site = await readReadableSiteSettings(ctx);
	} catch (error) {
		if (error instanceof SiteSettingsUnreadableError) {
			return refused("settings_unreadable", "SEO settings cannot be read, so this plugin adds no metadata to this page. Nothing can be predicted.");
		}
		throw error;
	}
	const {
		effective, presets, modules, global, metaOverride, contentTypeRoles, businessIdentity, publisherOwnership, previewPage,
	} = await entrySchemaResolutionInputs(ctx, collection, input.entryId, item, site.values);
	const canonicalSource = effective.canonical.source === "generated" || !isHttpUrl(effective.vars.canonical) ? "page" : "entry";
	// Only a published, unchanged entry uses the host lookup; draft and changed-slug paths are inferred.
	const registeredRoute = effective.canonical.source === "generated" && contentItemIsPublished(item) &&
		!unsavedContentSnapshots.has(item) && isHttpUrl(effective.vars.canonical);
	const candidateJson = validateCustomJsonLd(prepared.candidate.value.json);
	if (canonicalSource === "page" && !registeredRoute && prepared.candidate.value.enabled && entrySchemaUsesVariable(candidateJson, "canonical")) {
		return refused("canonical_unresolved", ENTRY_SCHEMA_CANONICAL_UNRESOLVED);
	}
	const pageEntry = entrySchemaPageEntry(collection, item);
	// The public reader's rules over the rows the save command read.
	const scopes = new Set(["global", collection, `${collection}:${input.entryId}`]);
	if (previewPage.content?.slug) scopes.add(`${collection}:${previewPage.content.slug}`);
	const customSchemas = prepared.rows
		.filter((row) => entrySchemaTargetMatches(row.value, pageEntry))
		.flatMap((row) => {
			const normalized = publicCustomSchema(row.id, row.value);
			return normalized && scopes.has(normalized.scope) ? [normalized] : [];
		})
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
	const expansion = createEntrySchemaPreviewExpansion(prepared.candidate.id);
	let items: SeoAdminEntrySchemaGraph[];
	try {
		items = resolveEntrySchemaGraphs({
			page: previewPage,
			data: item?.data,
			vars: effective.vars,
			settings: global,
			moduleEnabled: modules.schema,
			presets,
			customSchemas,
			contentTypeRoles: schemaOutputContentTypeRoles(contentTypeRoles),
			metaOverride,
			entry: pageEntry,
			businessIdentity,
			publisherOwnership,
			expand: expansion.expand,
		});
	} catch (error) {
		if (!(error instanceof TemplateExpansionLimitError)) throw error;
		const limit = expansion.limitFailure(error);
		return refused(limit.error, limit.message);
	}
	const graphId = `custom:${prepared.candidate.id}`;
	const candidateGraph = items.find((graph) => graph.id === graphId);
	let resolvedBytes: number | null = null;
	if (candidateGraph && candidateGraph.graph !== null && candidateGraph.graph !== undefined) {
		const measured = entrySchemaCandidateGraphBytes(candidateGraph.graph);
		if (!measured.ok) return refused(measured.failure.error, measured.failure.message);
		resolvedBytes = measured.bytes;
	}
	if (await candidateContentChangedSince(ctx, collection, hostItem)) {
		return refused("content_changed", "Content changed while resolving the preview. Load the saved entry again.");
	}
	const preview: SeoAdminEntrySchemaCandidatePreview = {
		...base,
		success: true,
		generatedAt: new Date().toISOString(),
		scope: "plugin-contribution",
		entry: {
			collection,
			entryId: input.entryId,
			locale: prepared.entry.locale ?? null,
			slug: prepared.entry.slug ?? null,
			status: prepared.entry.status,
		},
		content: snapshot
			? { sourceKind: "saved-snapshot", sourceVersion: snapshot.sourceVersion }
			: { sourceKind: "stored-entry", sourceVersion: null },
		candidate: {
			mode: prepared.mode,
			id: prepared.candidate.id,
			expectedRevision: input.expectedRevision,
			name: prepared.candidate.value.name,
			enabled: prepared.candidate.value.enabled,
			graphId,
			resolvedBytes,
		},
		outputEnabled: modules.schema,
		canonicalSource,
		saveCheck: prepared.saveCheck,
		items,
		limits: { candidateBytes: ENTRY_SCHEMA_CANDIDATE_MAX_BYTES, responseBytes: ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES },
	};
	return preview;
}

/** Every answer of the candidate route, failures with stored records included, fits the response cap. */
async function boundedEntrySchemaCandidatePreview(
	ctx: PluginContext,
	input: z.infer<typeof entrySchemaCandidateInput>,
): Promise<SeoAdminEntrySchemaCandidatePreviewResult> {
	const result = await buildEntrySchemaCandidatePreview(ctx, input);
	if (entrySchemaPreviewWireBytes(result) !== null) return result;
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		requestId: input.requestId,
		success: false,
		error: ENTRY_SCHEMA_PREVIEW_RESPONSE_TOO_LARGE.error,
		message: result.success
			? ENTRY_SCHEMA_PREVIEW_RESPONSE_TOO_LARGE.message
			: `${ENTRY_SCHEMA_PREVIEW_RESPONSE_TOO_LARGE.message} Reload the editor to review the stored schema.`,
	};
}

/**
 * The candidate preview's re-read. The new row is held to the preview bounds
 * before it is serialized for comparison; the row it is compared with passed
 * them already.
 */
async function candidateContentChangedSince(ctx: PluginContext, collection: string, hostItem: any): Promise<boolean> {
	const latest = await ctx.content!.get(collection, String(hostItem.id));
	if (!latest || entrySchemaPreviewContentProblem(latest)) return true;
	return JSON.stringify(latest) !== JSON.stringify(hostItem);
}

function schemaLibraryHost(ctx: PluginContext): SchemaLibraryHost {
	return { kv: ctx.kv as SchemaLibraryHost["kv"], now: () => new Date().toISOString() };
}

function adminSchemaLibrary(ctx: PluginContext, snapshot: SchemaLibrarySnapshot): SeoAdminSchemaLibrary {
	const kv = ctx.kv as SchemaLibraryHost["kv"];
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		state: snapshot.state,
		revision: snapshot.revision,
		templates: snapshot.state === "saved" ? snapshot.templates : [],
		bytes: snapshot.state === "saved" ? snapshot.bytes : snapshot.state === "absent" ? 0 : null,
		corrupt: snapshot.state === "corrupt" ? { reason: snapshot.reason, detail: snapshot.detail } : null,
		conditionalStorage: typeof kv?.getVersioned === "function" && typeof kv?.compareAndSet === "function",
		limits: SEO_ADMIN_SCHEMA_LIBRARY_LIMITS,
	};
}

function adminSchemaLibraryWriteResult(ctx: PluginContext, result: SchemaLibraryWriteResult): SeoAdminSchemaLibraryWriteResult {
	if (!result.success) return { contractVersion: SEO_ADMIN_CONTRACT_VERSION, ...result };
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		success: true,
		changed: result.changed,
		template: result.template,
		library: adminSchemaLibrary(ctx, result.library),
	};
}

async function buildAdminContentOptions(
	ctx: PluginContext,
	collection?: string,
	limit = 25,
	cursor?: string,
): Promise<SeoAdminContentOptions> {
	const definitions = await resolveContentCollections(ctx);
	const definition = collection
		? definitions.find((item) => item.collection === collection)
		: undefined;
	if (collection && (!definition || !ctx.content)) throw new Error("Select an available content type.");
	const page = definition && ctx.content
		? await listAvailableContentCollection(ctx.content, definition.collection, {
			limit,
			cursor,
			orderBy: { updatedAt: "desc" },
		})
		: null;
	if (page && (page.items.length > limit || (page.hasMore &&
		(!page.cursor || page.cursor === cursor))))
		throw new Error("Content pagination did not advance within its limit.");
	const items: SeoAdminContentOptions["items"] = page && definition
		? page.items.map((item) => ({
			ref: contentRef(definition.collection, item),
			entryId: String(item.id),
			collection: definition.collection,
			collectionLabel: definition.label,
			title: contentItemTitle(item, definition?.titleField),
			updatedAt: contentSourceUpdatedAt(item),
		}))
		: [];
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		generatedAt: new Date().toISOString(),
		engineVersion: SEO_ENGINE_VERSION,
		collections: definitions,
		items,
		...(page?.hasMore ? { cursor: page.cursor } : {}),
		hasMore: Boolean(page?.hasMore),
	};
}

async function buildAdminOverview(ctx: PluginContext, limit: number): Promise<SeoAdminOverview> {
	const audit = await seoAudit(ctx);
	const recent = await recentContentScores(ctx, limit);
	const collectionLabels = await contentCollectionLabels(ctx);
	const priorities = priorityChecks(audit.checks);
	const failed = audit.checks.some((item) => item.status === "fail");
	const unreadable = audit.noindex === null;
	const ready = audit.noindex === false && audit.score >= 80 && priorities.length === 0;
	const state = audit.noindex !== false || failed ? "blocked" : ready ? "ready" : "review";
	// The resolved configuration knows which switches this installation offers.
	const switchableModules = (await buildAdminModuleConfiguration(ctx)).items.filter((module) => module.editable);
	const enabledModules = switchableModules.filter((module) => module.enabled).length;

	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		generatedAt: new Date().toISOString(),
		engineVersion: SEO_ENGINE_VERSION,
		readiness: {
			score: audit.score,
			state,
			title:
				state === "ready"
					? "SEO setup is ready"
					: unreadable
						? "SEO settings cannot be read"
						: audit.noindex
							? "Noindex is enabled"
							: failed
								? "Critical SEO setup needs attention"
								: "SEO setup needs review",
			description: unreadable
				? "This plugin adds no metadata to public pages until its settings can be read. Open Search & social for details."
				: audit.noindex
				? "This plugin adds noindex, nofollow metadata to supported pages. Check EmDash robots.txt and sitemap settings separately."
				: ready
					? recent.length
						? "Technical defaults, schema, and indexability are healthy. Content quality is reported separately."
						: "Technical defaults, schema, and indexability are healthy. Analyze content before evaluating content quality."
					: "Work through the highest-priority checks before launch.",
		},
		site: {
			name: audit.global.siteName,
			url: audit.global.siteUrl || null,
			indexable: unreadable ? null : !audit.noindex,
			robotsMode: unreadable ? "unknown" : audit.noindex ? "noindex,nofollow" : "none",
			settingsState: audit.settingsState,
			defaultSocialImage: audit.global.defaultOgImage || null,
			socialProfileCount: audit.global.sameAs?.length ?? 0,
		},
		summary: {
			totalScored: audit.counts.scores,
			sampleSize: recent.length,
			averageContentScore: averageScore(recent),
			needsAttention: recent.filter(scoreNeedsAttention).length,
			schemaPresetsEnabled: audit.counts.presetsOn,
			schemaPresetsTotal: audit.counts.presetsTotal,
			customSchemas: audit.counts.schemas,
			legacyOverrides: audit.counts.overrides,
			migrationRecords: audit.counts.migrationRecords,
			enabledModules,
			totalModules: switchableModules.length,
		},
		priorities: priorities.map((item, index) => ({
			priority: index + 1,
			area: priorityAction(item),
			check: item.check,
			status: item.status === "fail" ? "fail" : "review",
			detail: item.detail,
		})),
		checks: audit.checks,
		content: recent.map((item) => ({
			ref: item.ref,
			entryId: item.entryId,
			collection: item.collection,
			collectionLabel: collectionLabels.get(item.collection) ?? item.collection,
			title: item.title || item.entryId,
			score: item.score,
			grade: item.grade,
			presentation: item.freshness === "current" ? seoAnalysisPresentation(item) :
				{ label: "Saved analysis", qualifier: "Current content not checked", tone: "neutral" as const },
			needsAttention: scoreNeedsAttention(item),
			firstIssue: firstScoreIssue(item),
			updatedAt: item.updatedAt,
		})),
	};
}

async function recentContentScores(ctx: PluginContext, limit = 6): Promise<SeoScoreRecord[]> {
	const [templates, modules] = await Promise.all([readAdminTemplates(ctx), readAdminModules(ctx)]);
	const runtimeConfig = await readAnalysisRuntimeConfig(ctx, undefined, modules).catch((error: unknown) => {
		if (error instanceof SiteSettingsUnreadableError) return null;
		throw error;
	});
	if (!runtimeConfig) return [];
	const res = await ctx.storage.scores
		.query({
			orderBy: { updatedAt: "desc" },
			limit: Math.min(Math.max(limit * 4, limit), 100),
		})
		.catch(() => ({ items: [] }));
	const profiles = new Map<string, Awaited<ReturnType<typeof readCollectionAnalysisProfile>>>();
	const recent: SeoScoreRecord[] = [];
	for (const row of res.items ?? []) {
		const item = (row as any).data ?? row;
		if (!isStoredScoreUsable(item) || item.scoreVersion !== SEO_SCORE_VERSION ||
			item.templateUpdatedAt !== templateRevisionFor(templates, item.collection) ||
			item.modulesUpdatedAt !== modules.updatedAt) continue;
		let profile = profiles.get(item.collection);
		if (!profile) {
			profile = await readCollectionAnalysisProfile(ctx, item.collection);
			profiles.set(item.collection, profile);
		}
		if (profile.state !== "configured" || item.assessmentProfile?.profile !== profile.profile ||
			item.assessmentProfile.version !== profile.version ||
			item.configurationFingerprint !== entryAnalysisConfigurationFingerprint(
				runtimeConfig, modules.values, item.collection, { id: item.entryId, slug: item.slug }, profile,
			)) continue;
		// A result without a number stays out of the sample, its average and its tables.
		if (seoScoreDisplay(item).score === null) continue;
		recent.push(item);
		if (recent.length >= limit) break;
	}
	return recent;
}

function averageScore(items: SeoScoreRecord[]): number | null {
	if (!items.length) return null;
	const total = items.reduce((sum, item) => sum + item.score, 0);
	return Math.round(total / items.length);
}

/** Suggestions never count; only Failed and Partly met rows need attention. */
function scoreNeedsAttention(item: Pick<SeoScoreRecord, "checks">): boolean {
	return summarizeSeoChecks(item.checks).issues > 0;
}

function firstScoreIssue(item: SeoScoreRecord): string {
	if (item.scoreVersion !== SEO_SCORE_VERSION) return SEO_EARLIER_ANALYZER_TEXT;
	const issue = item.checks.find((check) => classifySeoContentCheck(check).issue) ??
		item.checks.find((check) => classifySeoContentCheck(check).role === "advisory" && check.status !== "pass");
	return issue ? `${issue.label}: ${issue.detail}` : seoAnalysisPresentation(item).label;
}

function statusLabel(status: SeoCheckStatus): string {
	if (status === "pass") return "pass";
	if (status === "fail") return "fail";
	return "review";
}

function priorityAction(check: SeoAuditCheck): string {
	if (check.check === "Search visibility" || check.check === "Default social image") return "Search & social";
	if (check.check === "Site URL" || check.check === "SameAs profiles") return "Site identity";
	if (check.check === "Publisher schema" || check.check === "Content schema") return "Schema";
	if (check.check === "Content templates") return "Templates";
	if (
		check.check === "Sitemap" ||
		check.check === "Robots.txt" ||
		check.check === "Active SEO modules"
	)
		return "Modules";
	return "Review";
}

function priorityChecks(checks: SeoAuditCheck[], limit = 5): SeoAuditCheck[] {
	return checks
		.filter((check) => check.status !== "pass")
		.sort((a, b) => {
			const statusScore = (status: SeoCheckStatus) =>
				status === "fail" ? 0 : status === "review" ? 1 : 2;
			const statusDelta = statusScore(a.status) - statusScore(b.status);
			return statusDelta || b.weight - a.weight;
		})
		.slice(0, limit);
}

const BLOCK_KIT_READ_ONLY_MESSAGE =
	"This legacy page is read-only. Change settings on the SEO page (Plugins > SEO).";

async function adminHandler(i: any, ctx: PluginContext): Promise<any> {
	// ---- Form submissions ----
	if (i.type === "form_submit") {
		const v = i.values ?? {};

		if (i.block_id === "seo_preview") {
			return {
				blocks: await page(ctx, "preview", {
					preview: {
						title: String(v.title ?? ""),
						description: String(v.description ?? ""),
						url: String(v.url ?? ""),
						focusKeyword: String(v.focusKeyword ?? ""),
						image: String(v.image ?? ""),
					},
				}),
			};
		}

		if (i.block_id === "seo_content_analyzer") {
			if (!(await getContentScoringEnabled(ctx))) {
				return {
					blocks: await page(ctx, "analyzer"),
					toast: { message: "Content scoring is paused in SEO > Content health", type: "error" },
				};
			}
			const contentSelection = clean(v.ref);
			const parsed = contentSelection ? parseContentRef(contentSelection) : null;
			const ref = parsed && await supportedContentCollection(ctx, parsed.collection)
				? contentSelection
				: undefined;
			const keyword = clean(v.keyword);
			const category = analyzerCategory(v.category);
			if (!ref) {
				return {
					blocks: await page(ctx, "analyzer"),
					toast: { message: "Select content to analyze", type: "error" },
				};
			}
			const analyzed = await legacyAnalyzerScore(ctx, ref, keyword);
			const item = analyzed.score;
			if (!item) {
				return {
					blocks: await page(ctx, "analyzer"),
					toast: {
						message: analyzed.refusal ?? LEGACY_ANALYZER_REFUSALS.analysis_failed,
						type: "error",
					},
				};
			}
			const label = item.title || item.entryId;
			const historyWarning = LEGACY_HISTORY_WARNINGS[analyzed.history];
			return {
				blocks: await page(ctx, "analyzer", {
					analyzer: { ref, keyword, category, analysis: item },
				}),
				toast: {
					message: analyzed.outcome === "session"
						? `Analyzed ${label} with a trial keyword: ${seoScoreDisplayText(seoScoreDisplay(item))} (not saved)`
						: analyzed.outcome === "reused"
							? `${label} is unchanged since its saved analysis: ${seoScoreDisplayText(seoScoreDisplay(item))} (reused)`
							: `Analyzed ${label}: ${seoScoreDisplayText(seoScoreDisplay(item))} (saved).${historyWarning ? ` ${historyWarning}` : ""}`,
					type: "success",
				},
			};
		}

		return {
			blocks: await page(ctx, "dashboard"),
			toast: { message: BLOCK_KIT_READ_ONLY_MESSAGE, type: "error" },
		};
	}

	// ---- Button actions (read-only views) ----
	// A button click delivers its action_id and value. The exact carrier varies, so
	// read defensively from the top-level value and the values record.
	if (i.action_id) {
		const btnValue = i.value ?? i.values?.value ?? i.values?.id ?? i.values?.ref;
		if (i.action_id === "refresh_scores") {
			return {
				blocks: await page(ctx, "dashboard"),
				toast: {
					message: "Choose a content collection in the analyzer before refreshing scores",
					type: "error",
				},
			};
		}
		if (i.action_id === "refresh_analyzer_scores") {
			if (!(await getContentScoringEnabled(ctx))) {
				return {
					blocks: await page(ctx, "analyzer"),
					toast: { message: "Content scoring is paused in SEO > Content health", type: "error" },
				};
			}
			const refresh = scoreRefreshActionValue(btnValue);
			if (!refresh) {
				return {
					blocks: await page(ctx, "analyzer"),
					toast: {
						message: "Choose content before refreshing its collection",
						type: "error",
					},
				};
			}
			const result = await refreshScorePage(ctx, refresh.collection, {
				cursor: refresh.cursor,
				revision: refresh.revision,
				limit: 100,
			});
			return {
				blocks: await page(ctx, "analyzer", {
					analyzer: {
						collection: refresh.collection,
						ref: refresh.ref,
						refreshCollection: refresh.collection,
						refreshCursor: result.cursor ?? undefined,
						refreshRevision: result.revision,
					},
				}),
				toast: {
					message: `${result.processed} ${refresh.collection} entries processed, ${result.updated} scores saved; ${result.hasMore ? "more entries remain" : "collection complete"}`,
					type: "success",
				},
			};
		}
		if (i.action_id === "select_analyzer_collection") {
			const collection = cleanCollection(btnValue);
			if (!collection || !await supportedContentCollection(ctx, collection)) {
				return { blocks: await page(ctx, "analyzer") };
			}
			return { blocks: await page(ctx, "analyzer", { analyzer: { collection } }) };
		}
		if (i.action_id === "analyzer_page") {
			const selection = analyzerPageActionValue(btnValue);
			if (!selection || !await supportedContentCollection(ctx, selection.collection)) {
				return { blocks: await page(ctx, "analyzer") };
			}
			return { blocks: await page(ctx, "analyzer", { analyzer: selection }) };
		}
		// Section tab navigation
		if (typeof i.action_id === "string" && i.action_id.startsWith("nav_")) {
			return { blocks: await page(ctx, i.action_id.slice("nav_".length)) };
		}
		return {
			blocks: await page(ctx, "dashboard"),
			toast: { message: BLOCK_KIT_READ_ONLY_MESSAGE, type: "error" },
		};
	}

	// ---- Compact dashboard widget ----
	if (i.widget === "seo-overview" || i.page === "widget:seo-overview") {
		const audit = await seoAudit(ctx);
		const c = audit.counts;
		const noindex = audit.noindex;
		const g = audit.global;
		const health = audit.score;
		return {
			blocks: [
				{
					type: "banner",
					title: noindex === null ? "SEO settings cannot be read" : noindex ? "Noindex is enabled" : "SEO output is live",
					description: noindex === null
						? "This plugin adds no metadata to public pages until its settings can be read."
						: noindex
						? "This plugin adds noindex, nofollow metadata to supported pages. Check EmDash robots.txt and sitemap settings separately."
						: `Metadata and schema are active for ${g.siteName}.`,
					variant: noindex === false ? "default" : "alert",
				},
				{
					type: "meter",
					label: "SEO setup readiness",
					value: health,
					max: 100,
					custom_value: `${health}%`,
				},
				{
					type: "stats",
					items: [
						{
							label: "Overrides",
							value: String(c.overrides),
							description: "Page-specific rules",
						},
						{
							label: "Scores",
							value: String(c.scores),
							description: "Content analyzer",
						},
						{
							label: "JSON-LD",
							value: String(c.schemas),
							description: "Custom schema",
						},
						{
							label: "Presets",
							value: `${c.presetsOn}/${c.presetsTotal}`,
							description: "Enabled",
						},
					],
				},
			],
		};
	}

	// ---- Full admin page ----
	return { blocks: await page(ctx, i.page || "dashboard", { analyzer: i.analyzer }) };
}

// Build the admin page for a given section.
async function page(
	ctx: PluginContext,
	section: string,
	opts?: {
		preview?: PreviewInput;
		analyzer?: AnalyzerViewInput;
	},
): Promise<any[]> {
	const blocks: any[] = [
		{ type: "header", text: "SEO" },
		...navBlocks(section),
		{ type: "context", text: BLOCK_KIT_READ_ONLY_MESSAGE },
		{ type: "divider" },
	];

	if (section === "analyzer") {
		blocks.push(...(await analyzerSection(ctx, opts?.analyzer)));
	} else if (section === "preview") {
		blocks.push(...(await previewSection(ctx, opts?.preview)));
	} else if (section === "overrides") {
		blocks.push(...(await overridesSection(ctx)));
	} else {
		blocks.push(...(await dashboardSection(ctx)));
	}
	return blocks;
}

function navBlocks(active: string) {
	const tabs: { id: string; label: string }[] = [
		{ id: "dashboard", label: "Overview" },
		{ id: "analyzer", label: "Content analyzer" },
		{ id: "preview", label: "Search/Social" },
		{ id: "overrides", label: "Legacy overrides" },
	];
	return [
		{
			type: "actions",
			elements: tabs.map((t) => ({
				type: "button",
				label: t.label,
				action_id: `nav_${t.id}`,
				style: t.id === active ? "primary" : "secondary",
			})),
		},
	];
}

async function dashboardSection(ctx: PluginContext): Promise<any[]> {
	const audit = await seoAudit(ctx);
	const c = audit.counts;
	const g = audit.global;
	const noindex = audit.noindex;
	const health = audit.score;
	const urgent = priorityChecks(audit.checks);
	const recent = await recentContentScores(ctx, 6);
	const collectionLabels = await contentCollectionLabels(ctx);
	const avgContentScore = averageScore(recent);
	const needsAttention = recent.filter(scoreNeedsAttention).length;
	const readyForLaunch = noindex === false && health >= 80 && urgent.length === 0;
	return [
		{
			type: "banner",
			title: readyForLaunch
				? "SEO setup is ready"
				: noindex === null
					? "SEO settings cannot be read"
					: noindex
					? "Noindex is enabled"
					: "SEO output is live",
			description: noindex === null
				? "This plugin adds no metadata to public pages until its settings can be read."
				: noindex
				? "This plugin adds noindex, nofollow metadata to supported pages. Check EmDash robots.txt and sitemap settings separately."
				: readyForLaunch
					? recent.length
						? `${g.siteName} has healthy technical defaults, schema, and indexability. Content quality is reported separately.`
						: `${g.siteName} has healthy technical defaults, schema, and indexability. Analyze content before evaluating content quality.`
					: `${g.siteName} is indexable, but a few setup items still need review.`,
			variant: noindex === false ? "default" : "alert",
		},
		{
			type: "actions",
			elements: [
				{
					type: "button",
					label: "Run analyzer",
					action_id: "nav_analyzer",
					style: "primary",
				},
				{
					type: "button",
					label: "Preview search result",
					action_id: "nav_preview",
					style: "secondary",
				},
			],
		},
		{
			type: "columns",
			columns: [
				[
					{
						type: "meter",
						label: "SEO setup readiness",
						value: health,
						max: 100,
						custom_value: `${health}%`,
					},
					{
						type: "stats",
						items: [
							{
								label: "Content average",
								value: avgContentScore === null ? "--" : String(avgContentScore),
								description: recent.length
									? `${recent.length} latest scored items`
									: "No current content scores",
							},
							{
								label: "Needs attention",
								value: recent.length ? String(needsAttention) : "--",
								description: recent.length ? "Recent items with scored issues" : "Analyze content to measure",
							},
							{
								label: "Schema presets",
								value: `${c.presetsOn}/${c.presetsTotal}`,
								description: "Recommended defaults",
							},
							{
								label: "Overrides",
								value: String(c.overrides),
								description: "Page-specific rules",
							},
						],
					},
					{
						type: "fields",
						fields: [
							{
								label: "Robots mode",
								value: noindex === null
									? "Unknown: settings cannot be read"
									: noindex ? "Staging: noindex,nofollow" : "No site-wide plugin robots tag",
							},
							{ label: "Production URL", value: g.siteUrl || "Not set" },
							{
								label: "Default social image",
								value: g.defaultOgImage || "Not set",
							},
							{
								label: "Social profiles",
								value: `${g.sameAs?.length ?? 0} connected`,
							},
							{ label: "Custom JSON-LD", value: `${c.schemas} snippets` },
						],
					},
				],
				[
					{ type: "section", text: "Next best actions" },
					{
						type: "table",
						columns: [
							{ key: "priority", label: "Priority", format: "badge" },
							{ key: "action", label: "Open", format: "text" },
							{ key: "status", label: "Status", format: "badge" },
							{ key: "detail", label: "Detail", format: "text" },
						],
						rows: urgent.length
							? urgent.map((item, index) => ({
									priority: index === 0 && item.status === "fail" ? "fix first" : `P${index + 1}`,
									action: priorityAction(item),
									status: statusLabel(item.status),
									detail: `${item.check}: ${item.detail}`,
								}))
							: [
									{
										priority: "done",
										action: "Keep monitoring",
										status: "pass",
										detail: "Core SEO setup is healthy.",
									},
								],
					},
					{
						type: "accordion",
						label: "How this score is built",
						blocks: [
							{
								type: "context",
								text: "SEO setup readiness combines search visibility, the production URL, publisher schema, and the default social image.",
							},
							{
								type: "context",
								text: "Content scores are saved separately for each routable collection, then surfaced in list views as SEO badges.",
							},
						],
					},
				],
			],
		},
		{ type: "section", text: "Recent content scores" },
		recent.length
			? {
					type: "table",
					columns: [
						{ key: "title", label: "Content", format: "text" },
						{ key: "collection", label: "Type", format: "badge" },
						{ key: "score", label: "Score", format: "badge" },
						{ key: "grade", label: "Band", format: "badge" },
						{ key: "issue", label: "First issue", format: "text" },
					],
					rows: recent.map((item) => {
						const display = seoScoreDisplay(item);
						return {
							title: item.title || item.entryId,
							collection: collectionLabels.get(item.collection) ?? item.collection,
							score: display.score === null ? "-" : String(display.score),
							grade: display.label,
							issue: firstScoreIssue(item),
						};
					}),
				}
			: {
					type: "empty",
					title: "No content scores yet",
					description:
						"Run the analyzer once to score a content collection. Scores also refresh when content is saved or published.",
					size: "sm",
				},
	];
}

const ANALYZER_CATEGORIES: ReadonlyArray<{
	value: SeoCheckCategory | "all";
	label: string;
}> = [
	{ value: "all", label: "All checks" },
	{ value: "metadata", label: "Metadata" },
	{ value: "content", label: "Content" },
	{ value: "links", label: "Links" },
	{ value: "images", label: "Images" },
	{ value: "readability", label: "Readability" },
	{ value: "keyword", label: "Focus keyword" },
	{ value: "schema", label: "Schema" },
	{ value: "social", label: "Social" },
	{ value: "indexability", label: "Indexability" },
];

function analyzerCategory(value: unknown): SeoCheckCategory | "all" {
	const candidate = typeof value === "string" ? value.trim() : "all";
	const match = ANALYZER_CATEGORIES.find(
		(item) =>
			item.value === candidate ||
			item.label.toLocaleLowerCase("en") === candidate.toLocaleLowerCase("en"),
	);
	return match?.value ?? "all";
}

function analyzerCategoryLabel(category: SeoCheckCategory | "all"): string {
	return ANALYZER_CATEGORIES.find((item) => item.value === category)?.label ?? "All checks";
}

function analyzerContentChoices(items: SeoAdminContentOptions["items"]): Array<{
	ref: string;
	label: string;
}> {
	const baseLabels = items.map((item) => `${item.collectionLabel} · ${item.title}`);
	const totals = baseLabels.reduce<Map<string, number>>((counts, label) => {
		counts.set(label, (counts.get(label) ?? 0) + 1);
		return counts;
	}, new Map());
	const seen = new Map<string, number>();
	return items.map((item, index) => {
		const base = baseLabels[index];
		const position = (seen.get(base) ?? 0) + 1;
		seen.set(base, position);
		return {
			ref: item.ref,
			label: (totals.get(base) ?? 0) > 1 ? `${base} (${position})` : base,
		};
	});
}

function contentCheckEvidence(check: SeoContentCheck): string {
	const actual =
		check.evidence.actual === null
			? "Not set"
			: typeof check.evidence.actual === "boolean"
				? check.evidence.actual
					? "Yes"
					: "No"
				: String(check.evidence.actual);
	return `${check.detail} Evidence: ${actual}; expected ${check.evidence.expected}.`;
}

function contentCheckPriority(check: SeoContentCheck): number {
	const status = check.status === "fail" ? 0 : check.status === "review" ? 1 : 2;
	const severity =
		check.severity === "critical"
			? 0
			: check.severity === "high"
				? 1
				: check.severity === "medium"
					? 2
					: check.severity === "low"
						? 3
						: 4;
	return status * 100 + severity * 10 - check.weight;
}

async function analyzerSection(ctx: PluginContext, input?: AnalyzerViewInput): Promise<any[]> {
	const [audit, definitions, recent] = await Promise.all([
		seoAudit(ctx),
		resolveContentCollections(ctx),
		recentContentScores(ctx, 10),
	]);
	const requestedRef = clean(input?.ref);
	const requestedCollection = cleanCollection(input?.collection ?? parseContentRef(requestedRef ?? "")?.collection);
	const selectedDefinition = definitions.find((item) => item.collection === requestedCollection) ?? definitions[0];
	const cursor = clean(input?.cursor);
	if (cursor && cursor.length > 2_048) throw new Error("The analyzer content cursor is invalid.");
	const pageNumber = cursor && Number.isInteger(input?.pageNumber) && (input?.pageNumber ?? 0) > 1
		? input?.pageNumber ?? 1
		: 1;
	const contentOptions = await buildAdminContentOptions(ctx, selectedDefinition?.collection, 25, cursor);
	const collectionLabels = new Map(
		contentOptions.collections.map((definition) => [definition.collection, definition.label]),
	);
	const contentChoices = analyzerContentChoices(contentOptions.items);
	const availableRefs = new Set(contentChoices.map((item) => item.ref));
	const exactRequestedRef = requestedRef && parseContentRef(requestedRef)?.collection === selectedDefinition?.collection
		? requestedRef
		: undefined;
	let selectedRef = exactRequestedRef ??
		(recent.find((item) => availableRefs.has(item.ref))?.ref ?? contentOptions.items[0]?.ref);
	const category = analyzerCategory(input?.category);
	let selected = input?.analysis?.ref === selectedRef ? input.analysis
		: selectedRef ? await readStoredScoreSnapshot(ctx, selectedRef) : null;
	if (!selected && selectedRef === exactRequestedRef && selectedRef && !availableRefs.has(selectedRef)) {
		const parsed = parseContentRef(selectedRef);
		const item = parsed
			? await resolveContentItem(ctx, parsed.collection, parsed.identifier).catch(() => null)
			: null;
		if (item) {
			contentChoices.push({
				ref: selectedRef,
				label: `${selectedDefinition?.label ?? parsed?.collection} · ${contentItemTitle(item, selectedDefinition?.titleField)}`,
			});
		} else {
			selectedRef = contentOptions.items[0]?.ref;
			selected = selectedRef ? await readStoredScoreSnapshot(ctx, selectedRef) : null;
		}
	}
	if (selected && selectedRef && !availableRefs.has(selectedRef)) {
		contentChoices.push({
			ref: selectedRef,
			label: `${collectionLabels.get(selected.collection) ?? selected.collection} · ${selected.title || selected.entryId}`,
		});
	}
	const selectedCollection = selectedDefinition?.collection;
	const candidateRefreshRevision = clean(input?.refreshRevision);
	const refreshRevision = SCORE_REFRESH_REVISION_PATTERN.test(candidateRefreshRevision ?? "")
		? candidateRefreshRevision
		: undefined;
	const refreshCursor =
		selectedCollection === cleanCollection(input?.refreshCollection) && refreshRevision
			? clean(input?.refreshCursor)
			: undefined;
	const blocks: any[] = [
		{
			type: "banner",
			title: "Content analysis workspace",
			description:
				`Analyze real EmDash content using metadata, structure, links, image alt metadata, readability, schema, social, and optional focus-keyword signals. Showing page ${pageNumber} of ${selectedDefinition?.label ?? "content"}.`,
			variant: "default",
		},
		{
			type: "actions",
			elements: definitions.map((definition) => ({
				type: "button",
				label: definition.label,
				action_id: "select_analyzer_collection",
				value: definition.collection,
				style: definition.collection === selectedCollection ? "primary" : "secondary",
			})),
		},
		...(pageNumber > 1 || contentOptions.hasMore ? [{
			type: "actions",
			elements: [
				...(pageNumber > 1 ? [{
					type: "button",
					label: "First content page",
					action_id: "analyzer_page",
					value: JSON.stringify({ collection: selectedCollection, pageNumber: 1 }),
					style: "secondary",
				}] : []),
				...(contentOptions.hasMore && contentOptions.cursor ? [{
					type: "button",
					label: "Next content page",
					action_id: "analyzer_page",
					value: JSON.stringify({ collection: selectedCollection, cursor: contentOptions.cursor, pageNumber: pageNumber + 1 }),
					style: "secondary",
				}] : []),
			],
		}] : []),
		{
			type: "actions",
			elements: [
				...(selectedCollection
					? [
							{
								type: "button",
								label: `Refresh ${refreshCursor ? "next" : "first"} 100 ${selectedCollection} scores`,
								action_id: "refresh_analyzer_scores",
								value: JSON.stringify({
									collection: selectedCollection,
									...(refreshCursor ? { cursor: refreshCursor } : {}),
									...(refreshCursor && refreshRevision ? { revision: refreshRevision } : {}),
									...(selectedRef ? { ref: selectedRef } : {}),
								}),
								style: "secondary",
							},
						]
					: []),
				{
					type: "button",
					label: "Search/social preview",
					action_id: "nav_preview",
					style: "secondary",
				},
			],
		},
	];

	if (contentChoices.length === 0) {
		blocks.push({
			type: "empty",
			title: contentOptions.hasMore ? "No entries on this page" : "No analyzable content in this type",
			description:
				contentOptions.hasMore
					? "Choose Next content page to continue browsing this type."
					: "Choose another content type or create an entry in this type. The analyzer will score it after the first save or publish event.",
			size: "sm",
		});
		return blocks;
	}

	blocks.push({
		type: "form",
		block_id: "seo_content_analyzer",
		fields: [
			{
				type: "select",
				action_id: "ref",
				label: "Content",
				initial_value: selectedRef,
				options: contentChoices.map((item) => ({
					label: item.label,
					value: item.ref,
				})),
			},
			{
				type: "text_input",
				action_id: "keyword",
				label: "Focus keyword (optional)",
				placeholder: "Use a phrase only when this entry targets one",
				initial_value: input?.keyword ?? selected?.keyword ?? "",
			},
			{
				type: "select",
				action_id: "category",
				label: "Check category",
				initial_value: analyzerCategoryLabel(category),
				options: ANALYZER_CATEGORIES.map((item) => ({
					label: item.label,
					value: item.label,
				})),
			},
		],
		submit: { label: "Analyze content", action_id: "analyze_content" },
	});

	if (!selected) {
		blocks.push({
			type: "empty",
			title: "Content could not be loaded",
			description:
				"The selected entry may have been removed. Choose another item and run the analyzer again.",
			size: "sm",
		});
		return blocks;
	}

	// The editor's display decision and rows; an earlier analyzer shows neither a number nor findings.
	const display = seoScoreDisplay(selected);
	const presentation = presentSeoChecks(selected);
	const earlier = presentation.legacy;
	// The indexing directive is never a row, so the editor's exclusion banner is the only place it is named.
	const exclusion = earlier ? undefined : selected.checks.find((check) => check.condition === "excluded-from-search");
	const rowWord = (check: SeoContentCheck) => seoCheckRowWord(check, selected);
	const filteredChecks = (category === "all"
		? selected.checks
		: selected.checks.filter((check) => check.category === category)).filter((check) => rowWord(check) !== null);
	const priorities = presentation.groups
		.flatMap((group) => group.rows)
		.filter((row) => row.kind === "failed" || row.kind === "partly-met")
		.map((row) => row.check)
		.sort((left, right) => contentCheckPriority(left) - contentCheckPriority(right))
		.slice(0, 6);
	const totalLinks = selected.metrics.internalLinkCount + selected.metrics.externalLinkCount;
	const collectionLabel = collectionLabels.get(selected.collection) ?? selected.collection;

	blocks.push(
		{ type: "divider" },
		{ type: "section", text: selected.title || selected.entryId },
		display.score !== null
			? {
					type: "meter",
					label: `Content score: ${display.label}`,
					value: display.score,
					max: 100,
					custom_value: `${display.score}/100`,
				}
			: {
					type: "banner",
					title: display.label,
					...(display.qualifier ? { description: display.qualifier } : {}),
					variant: "default",
				},
		...(exclusion ? [{ type: "banner", title: "Excluded from search", description: exclusion.detail, variant: "default" }] : []),
		{
			type: "fields",
			fields: [
				{ label: "Band", value: display.band ? display.label : "-" },
				...(display.qualifier && display.score !== null ? [{ label: "Note", value: display.qualifier }] : []),
				{ label: "Content type", value: collectionLabel },
				{ label: "Checklist", value: earlier ? SEO_EARLIER_ANALYZER_TEXT : seoCheckTotalsText(presentation.totals) },
				{ label: "Passed", value: `${presentation.totals.passed} rows` },
				{ label: "Not applicable", value: `${presentation.totals.notApplicable} rows` },
				{
					label: "Focus keyword",
					value: selected.keyword || "Not set; keyword checks do not affect this score",
				},
				{ label: "Public URL", value: selected.url || "Not resolved" },
				{ label: "Last analyzed", value: selected.updatedAt },
				{ label: "Analyzer", value: earlier ? `Analyzer ${selected.scoreVersion}. ${SEO_EARLIER_ANALYZER_TEXT}` : `Analyzer ${selected.scoreVersion}` },
			],
		},
		{
			type: "accordion",
			label: "Document signals",
			blocks: [
				{
					type: "fields",
					fields: [
						{ label: "Words", value: String(selected.metrics.wordCount) },
						{
							label: "Sentences",
							value: String(selected.metrics.sentenceCount),
						},
						{
							label: "Average sentence",
							value:
								selected.metrics.averageSentenceWords === null
									? "Not available"
									: `${selected.metrics.averageSentenceWords} words`,
						},
						{
							label: "Paragraphs",
							value: String(selected.metrics.paragraphCount),
						},
						{
							label: "Longest paragraph",
							value: `${selected.metrics.longestParagraphWords} words`,
						},
						{
							label: "Headings",
							value: `${selected.metrics.headingCount} total; ${selected.metrics.h1Count} body H1`,
						},
						{
							label: "Links",
							value: `${totalLinks} total; ${selected.metrics.internalLinkCount} internal, ${selected.metrics.externalLinkCount} external`,
						},
						{
							label: "Generic anchors",
							value: String(selected.metrics.genericLinkCount),
						},
						{
							label: "Images",
							value: `${selected.metrics.imageCount} total; ${selected.metrics.imageAltCount} described, ${selected.metrics.imageDecorativeCount} empty alt, ${selected.metrics.imageMissingAltCount} missing alt`,
						},
						{
							label: "Structured body",
							value: selected.metrics.structured ? "Available" : "Unavailable",
						},
					],
				},
			],
		},
		{ type: "section", text: "Priority improvements" },
	);

	blocks.push(
		priorities.length
			? {
					type: "table",
					columns: [
						{ key: "priority", label: "Priority", format: "badge" },
						{ key: "area", label: "Area", format: "badge" },
						{ key: "check", label: "Check", format: "text" },
						{ key: "next", label: "Recommended action", format: "text" },
					],
					rows: priorities.map((check, index) => ({
						priority: `P${index + 1}`,
						area: analyzerCategoryLabel(check.category),
						check: `${check.label}: ${check.detail}`,
						next: check.recommendation,
					})),
				}
			: earlier
				? {
						type: "banner",
						title: "Earlier analyzer",
						description: "This result was saved with an earlier analyzer. Analyze this entry to update it.",
						variant: "default",
					}
				: {
						type: "banner",
						title: "No issues",
						description:
							"No Failed or Partly met rows. Re-run the analyzer after meaningful content or metadata changes.",
						variant: "default",
					},
	);

	blocks.push(
		{
			type: "section",
			text: `${analyzerCategoryLabel(category)} (${filteredChecks.length})`,
		},
		{
			type: "table",
			columns: [
				{ key: "status", label: "Status", format: "badge" },
				{ key: "area", label: "Area", format: "badge" },
				{ key: "check", label: "Check", format: "text" },
				{ key: "finding", label: "Finding", format: "text" },
			],
			rows: filteredChecks.map((check) => ({
				status: rowWord(check) ?? "",
				area: analyzerCategoryLabel(check.category),
				check: check.label,
				finding: contentCheckEvidence(check),
			})),
		},
		{
			type: "accordion",
			label: "Recommendations and data sources",
			blocks: [
				{
					type: "fields",
					fields: filteredChecks.map((check) => ({
						label: `${rowWord(check) ?? ""}: ${check.label}`,
						value: `${check.recommendation} Source: ${check.evidence.source}.`,
					})),
				},
			],
		},
	);

	const siteFailed = audit.checks.filter((check) => check.status === "fail").length;
	const siteReview = audit.checks.filter((check) => check.status === "review").length;
	const sitePriorities = priorityChecks(audit.checks);
	blocks.push({
		type: "accordion",
		label: `Site-wide setup · ${audit.score}/100`,
		blocks: [
			{
				type: "meter",
				label: "Technical SEO readiness",
				value: audit.score,
				max: 100,
				custom_value: `${audit.score}/100`,
			},
			{
				type: "fields",
				fields: [
					{ label: "Failed", value: String(siteFailed) },
					{ label: "Review", value: String(siteReview) },
					{
						label: "Passed",
						value: String(audit.checks.length - siteFailed - siteReview),
					},
				],
			},
			{
				type: "table",
				columns: [
					{ key: "status", label: "Status", format: "badge" },
					{ key: "area", label: "Area", format: "text" },
					{ key: "check", label: "Check", format: "text" },
					{ key: "detail", label: "Detail", format: "text" },
				],
				rows: sitePriorities.length
					? sitePriorities.map((check) => ({
							status: statusLabel(check.status),
							area: priorityAction(check),
							check: check.check,
							detail: check.detail,
						}))
					: [
							{
								status: "pass",
								area: "Monitor",
								check: "Core setup",
								detail: "No failed or review checks.",
							},
						],
			},
			{
				type: "context",
				text: "The content score evaluates one entry. Site-wide readiness separately evaluates search visibility, the production URL, publisher schema, and the default social image.",
			},
		],
	});

	if (recent.length > 0) {
		blocks.push(
			{ type: "divider" },
			{ type: "section", text: "Recently analyzed content" },
			{
				type: "table",
				columns: [
					{ key: "title", label: "Content", format: "text" },
					{ key: "type", label: "Type", format: "badge" },
					{ key: "score", label: "Score", format: "badge" },
					{ key: "issue", label: "First issue", format: "text" },
				],
				rows: recent.map((item) => ({
					title: item.title || item.entryId,
					type: collectionLabels.get(item.collection) ?? item.collection,
					score: seoScoreDisplayText(seoScoreDisplay(item)),
					issue: firstScoreIssue(item),
				})),
			},
		);
	}

	blocks.push({
		type: "context",
		text: "Saved-content analysis reports configured metadata and directional content checks. Unavailable and inapplicable checks carry no weight; review coverage and limitations with the score.",
	});
	return blocks;
}

async function previewSection(ctx: PluginContext, input?: PreviewInput): Promise<any[]> {
	const g = await getGlobalSettings(ctx);
	const fallbackTitle = `${g.siteName} | Search preview`;
	const fallbackDescription = "A concise description of this page for search and social previews.";
	const values = {
		title: input?.title?.trim() || fallbackTitle,
		description: input?.description?.trim() || fallbackDescription,
		url: normaliseUrl(input?.url ?? "", g.siteUrl || "https://example.com/"),
		focusKeyword: input?.focusKeyword?.trim() || "Example",
		image: input?.image?.trim() || g.defaultOgImage || "",
	};
	// Shipit preview widths, never a character count: the same estimate as the editor preview and its rows.
	const fitText = (field: "title" | "description") => {
		const cut = seoSnippetFit(values[field], field).filter((fit) => fit.clipped);
		return cut.length
			? `Estimate: may be cut off ${cut.map((fit) => `on ${SEO_SNIPPET_DEVICE_LABELS[fit.device]} after "${seoSnippetCutPoint(fit.visible)}"`).join(" and ")}`
			: "Estimate: fits in the phone and desktop previews";
	};
	return [
		{
			type: "columns",
			columns: [
				[
					{ type: "section", text: "Snippet editor" },
					{
						type: "form",
						block_id: "seo_preview",
						fields: [
							{
								type: "text_input",
								action_id: "focusKeyword",
								label: "Focus keyword",
								initial_value: values.focusKeyword,
							},
							{
								type: "text_input",
								action_id: "title",
								label: "SEO title",
								initial_value: values.title,
							},
							{
								type: "text_input",
								action_id: "description",
								label: "Meta description",
								multiline: true,
								initial_value: values.description,
							},
							{
								type: "text_input",
								action_id: "url",
								label: "Preview URL",
								initial_value: values.url,
							},
							{
								type: "text_input",
								action_id: "image",
								label: "Social image URL",
								initial_value: values.image,
							},
						],
						submit: { label: "Update preview", action_id: "update_preview" },
					},
				],
				[
					{
						type: "fields",
						fields: [
							{
								label: "Title fit",
								value: fitText("title"),
							},
							{
								label: "Description fit",
								value: fitText("description"),
							},
							{
								label: "Keyword in title",
								value: values.title.toLowerCase().includes(values.focusKeyword.toLowerCase())
									? "Yes"
									: "No",
							},
							{
								label: "Keyword in description",
								value: values.description.toLowerCase().includes(values.focusKeyword.toLowerCase())
									? "Yes"
									: "No",
							},
							{
								label: "Social image",
								value: values.image ? "Set" : "Missing",
							},
						],
					},
				],
			],
		},
		{ type: "section", text: "Google-style preview" },
		{
			type: "fields",
			fields: [
				{ label: "URL", value: values.url },
				{ label: "Title", value: values.title },
				{ label: "Description", value: values.description },
			],
		},
		{ type: "context", text: SEO_SNIPPET_ESTIMATE_NOTE },
		{ type: "section", text: "Social preview" },
		{
			type: "fields",
			fields: [
				{ label: "Image", value: values.image || "Fallback image missing" },
				{ label: "Open Graph title", value: values.title },
				{
					label: "Open Graph description",
					value: values.description,
				},
			],
		},
		{
			type: "context",
			text: "Use this preview for page copy decisions, then save permanent exceptions in Page overrides or content-type templates.",
		},
	];
}

async function coreSeoMigrationBlocks(ctx: PluginContext): Promise<any[]> {
	const page = await buildCoreSeoMigrationPlanPage(ctx, "skip", 100).catch(() => ({ plans: [], hasMore: false }));
	const plans = page.plans;
	const summary = summariseMigrationPlans(plans);
	const noneRemain = summary.total === 0 && !page.hasMore;
	const recent = await ctx.storage.migrations
		.query({ orderBy: { createdAt: "desc" }, limit: 12 })
		.catch(() => ({ items: [] }));
	const writeAvailable = coreSeoMigrationWriteAvailable(ctx);
	const blocks: any[] = [
		{ type: "section", text: "Move legacy metadata to EmDash core SEO" },
		{
			type: "banner",
			title:
				noneRemain
					? "Core SEO is the active metadata owner"
					: !writeAvailable
						? "Migration is read-only on this host"
						: summary.conflicts > 0
							? "Legacy overrides need a migration decision"
							: "Legacy overrides are ready to migrate",
			description:
				noneRemain
					? "No legacy page overrides remain. Entry metadata can be managed through EmDash core SEO fields."
					: !writeAvailable
						? "Legacy records keep controlling their pages. This host lacks the guarded writes migration needs, so records can be reviewed but not moved."
						: page.hasMore
							? "This summary covers the first page of legacy records. Review every page in the SEO admin migration view before migrating."
							: "Preview is read-only. Apply writes a complete backup first, verifies core SEO, and removes the legacy record only after success.",
			variant: summary.conflicts > 0 || !writeAvailable ? "alert" : "default",
		},
		{
			type: "stats",
			items: [
				{
					label: "Legacy records",
					value: String(summary.total),
					description: page.hasMore ? "Scanned on the first page; more remain" : "Scanned",
				},
				{
					label: "Ready",
					value: String(summary.ready),
					description: "Safe with default policy",
				},
				{
					label: "Conflicts",
					value: String(summary.conflicts),
					description: "Require an explicit decision",
				},
				{
					label: "Unresolved",
					value: String(summary.unresolved + summary.empty),
					description: "Missing, disabled, or empty",
				},
			],
		},
	];

	if (plans.length > 0) {
		blocks.push({
			type: "table",
			columns: [
				{ key: "ref", label: "Legacy ref", format: "text" },
				{ key: "entry", label: "Entry", format: "text" },
				{ key: "state", label: "State", format: "badge" },
				{ key: "mapped", label: "Mapped fields", format: "text" },
				{ key: "conflicts", label: "Conflicts", format: "text" },
			],
			rows: plans.slice(0, 20).map((item) => ({
				ref: item.ref,
				entry: item.title ?? item.entryId ?? "Not resolved",
				state: item.state,
				mapped: item.plan?.mappedFields.join(", ") || "None",
				conflicts: item.plan?.conflicts.join(", ") || "None",
			})),
		});
	}

	if (writeAvailable && summary.total > 0) {
		blocks.push({
			type: "context",
			text: "Apply is available on the SEO page's Migration view, where every selected record is bound to the reviewed snapshots with a plan fingerprint. This view is read-only.",
		});
	}

	if (!writeAvailable) {
		blocks.push({
			type: "context",
			text: "Migration is read-only because the host does not provide the guarded-write capabilities required to apply changes safely.",
		});
	}

	if ((recent.items ?? []).length > 0) {
		blocks.push(
			{ type: "divider" },
			{ type: "section", text: writeAvailable ? "Migration journal and rollback" : "Migration journal" },
			{
				type: "table",
				columns: [
					{ key: "batch", label: "Batch", format: "text" },
					{ key: "ref", label: "Ref", format: "text" },
					{ key: "status", label: "Status", format: "badge" },
					{ key: "date", label: "Updated", format: "relative_time" },
				],
				rows: recent.items.map((item: any) => {
					const record = (item.data ?? item) as CoreSeoMigrationRecord;
					return {
						batch: record.batchId,
						ref: record.ref,
						status: record.status,
						date: record.updatedAt,
					};
				}),
			},
			{
				type: "context",
				text: writeAvailable
					? "Roll back a batch on the SEO page's Migration view. Rollback runs only when current core SEO still matches the migrated snapshot."
					: "Rollback is unavailable on this host because it lacks the guarded writes migration needs.",
			},
		);
	}

	return blocks;
}

async function overridesSection(ctx: PluginContext): Promise<any[]> {
	const res = await ctx.storage.overrides.query({ limit: 100 }).catch(() => ({ items: [] }));
	const blocks: any[] = [...(await coreSeoMigrationBlocks(ctx)), { type: "divider" }];

	if (res.items.length === 0) {
		blocks.push({
			type: "empty",
			title: "No legacy override editor needed",
			description:
				"EmDash core SEO is the only entry-metadata editor. New legacy records cannot be created.",
			size: "sm",
		});
		return blocks;
	}

	blocks.push(
		{ type: "section", text: "Legacy records awaiting migration" },
		{
			type: "context",
			text: "This list is read-only. Review and migrate legacy records on the SEO page's Migration view; no new legacy records can be created.",
		},
		{
			type: "table",
			columns: [
				{ key: "ref", label: "Ref", format: "text" },
				{ key: "title", label: "SEO title", format: "text" },
				{ key: "robots", label: "Robots", format: "badge" },
				{ key: "date", label: "Updated", format: "relative_time" },
			],
			rows: res.items.map((it: any) => {
				const override = it.data as Override;
				return {
					ref: override.ref,
					title: override.title ?? "—",
					robots: override.robots ?? "default",
					date: override.updatedAt,
				};
			}),
		},
	);

	return blocks;
}
