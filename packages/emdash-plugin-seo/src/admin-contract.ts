import { validateCustomVerificationTags, type CustomVerificationTag } from "./custom-verification-tags.ts";
import { validateTaxonomyArchiveNoindex } from "./taxonomy-archive-policy.ts";
import { validateContentTypeNoindex } from "./content-type-noindex-policy.ts";
import {
	SEO_CHECK_BASES,
	SEO_CHECK_CONDITIONS,
	SEO_SCORE_COMPARISON_POLICY,
	SEO_SCORE_VERSION,
	isScoredSeoCheckBasis,
	classifySeoContentCheck,
	summarizeSeoChecks,
	aggregateSeoChecks,
	seoAnalysisPresentation,
	seoScoreBand,
	seoScoreBandLabel,
	seoScoreDisplay,
	seoScoreLimitText,
	seoScoredCheckMask,
	isSeoScoredCheckMask,
	seoContentCheckProblem,
	type SeoAnalysisResult,
	type SeoCheckBasis,
	type SeoCheckCondition,
	type SeoCheckRole,
	type SeoScoreBand,
	type SeoScoreDisplay,
	type SeoScoreDisplayLabel,
	type SeoScoreLimit,
	type SeoScoreLimitReason,
} from "./analysis.ts";
import {
	SEO_CRAWL_DIAGNOSTICS_VERSION,
	type SeoCrawlCoverage,
	type SeoCrawlDiagnosticsResult,
	type SeoOrphanConfidence,
	type SeoPossibleOrphanEntry,
	type SeoUnresolvedInternalLink,
} from "./crawl-diagnostics.ts";
import {
	INDEXNOW_DEFAULT_CONTENT_TYPES,
	INDEXNOW_ENDPOINT,
	INDEXNOW_HISTORY_MAX_PAGE_SIZE,
	INDEXNOW_HISTORY_PAGE_SIZE,
	INDEXNOW_HISTORY_RETENTION,
	INDEXNOW_HISTORY_DETAIL_URL_BUDGET,
	INDEXNOW_HISTORY_SAMPLE_URLS,
	INDEXNOW_HISTORY_URL_PAGE_SIZE,
	INDEXNOW_MANUAL_URL_LIMIT,
	INDEXNOW_PROTOCOL_VERSION,
	INDEXNOW_SUBMISSION_BUCKETS,
	INDEXNOW_SUBMISSION_STATUSES,
	defaultIndexNowSettings,
	indexNowSubmissionStatus,
	validateIndexNowSettings,
	type IndexNowKeyRoute,
	type IndexNowSettingsErrors,
	type IndexNowSettingsField,
	type IndexNowSettingsValidation,
	type IndexNowSettingsValues,
	type IndexNowSetupIssue,
	type IndexNowSetupIssueCode,
	type IndexNowSubmissionCounts,
	type IndexNowSubmissionEvent,
	type IndexNowSubmissionSource,
	type IndexNowSubmissionStatus,
} from "./indexnow.ts";
import type {
	EntryCustomSchema,
	EntrySchemaCandidateSaveCheck,
	EntrySchemaFieldErrors,
	EntrySchemaListResult,
	EntrySchemaRemoveResult,
	EntrySchemaSaveResult,
	EntrySchemaTarget,
} from "./entry-schemas.ts";
import {
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	extractSeoSchemaTypes,
	isSeoAdminSchemaScope,
} from "./entry-schema-domain.ts";
import type {
	SchemaLibraryCorruptReason,
	SchemaLibraryFieldErrors,
	SchemaLibraryTemplate,
	SchemaLibraryWriteFailure,
} from "./schema-library.ts";
import type {
	RedirectRuleCreateResult,
	RedirectRuleListResult,
	RedirectRuleLoadResult,
	RedirectRuleUpdateResult,
	RedirectRuleUpdateRecoveryResult,
} from "./redirects.ts";
import type {
	PublisherOwnershipCheck,
	PublisherOwnershipView,
	PublisherOwnershipWriteResult,
} from "./publisher-ownership.ts";
import {
	DEFAULT_TEMPLATES,
	SCHEMA_CONTENT_TYPE_ROLES,
	SCHEMA_PRESET_KEYS,
	TEMPLATE_VARS,
	unknownTemplateVariables,
	validateCustomJsonLd,
	type SchemaContentTypeRole,
	type SchemaPresetKey,
} from "./lib.ts";
import type { SeoLocaleGraphDiagnostic } from "./locale-graph.ts";
import type { SeoNoindexSource } from "./analysis.ts";
import {
	CORE_SEO_MIGRATION_VERSION,
	type CoreSeoField,
	type CoreSeoFieldAction,
	type CoreSeoFieldPlan,
	type CoreSeoMigrationConflictPolicy,
	type CoreSeoMigrationPlan,
	type CoreSeoSnapshot,
	type LegacySeoOverrideSnapshot,
} from "./migration.ts";
import type { SeoNotFoundStatus, SeoRedirectSuggestion } from "./monitor404.ts";
import type { SeoSchemaComposerErrors, SeoSchemaComposerInput, SeoSchemaComposerRecipe } from "./schema-composer.ts";
import { SITEMAP_DEFAULT_COLLECTIONS, SITEMAP_ENTRY_STATUSES, type SitemapEntryStatus } from "./sitemap-engine.ts";
import type { SeoCanonicalValidation } from "./sitemap-policy.ts";

export { CORE_SEO_MIGRATION_VERSION, SITEMAP_ENTRY_STATUSES };
export {
	normaliseSeoKeywordText,
	seoKeywordIdentity,
	seoTextContainsKeyword,
} from "./keyword-match.ts";
export type {
	CoreSeoField,
	CoreSeoFieldAction,
	CoreSeoFieldPlan,
	CoreSeoMigrationConflictPolicy,
	CoreSeoMigrationPlan,
	CoreSeoSnapshot,
	LegacySeoOverrideSnapshot,
	IndexNowKeyRoute,
	IndexNowSettingsErrors,
	IndexNowSettingsField,
	IndexNowSettingsValidation,
	IndexNowSettingsValues,
	IndexNowSetupIssue,
	IndexNowSetupIssueCode,
	IndexNowSubmissionCounts,
	IndexNowSubmissionEvent,
	IndexNowSubmissionSource,
	IndexNowSubmissionStatus,
	SeoNotFoundStatus,
	SeoRedirectSuggestion,
	SeoCrawlCoverage,
	SeoOrphanConfidence,
	SeoPossibleOrphanEntry,
	SeoUnresolvedInternalLink,
};
export { SEO_CRAWL_DIAGNOSTICS_VERSION };
export {
	INDEXNOW_DEFAULT_CONTENT_TYPES,
	INDEXNOW_ENDPOINT,
	INDEXNOW_HISTORY_MAX_PAGE_SIZE,
	INDEXNOW_HISTORY_PAGE_SIZE,
	INDEXNOW_HISTORY_RETENTION,
	INDEXNOW_HISTORY_DETAIL_URL_BUDGET,
	INDEXNOW_HISTORY_SAMPLE_URLS,
	INDEXNOW_HISTORY_URL_PAGE_SIZE,
	INDEXNOW_MANUAL_URL_LIMIT,
	INDEXNOW_PROTOCOL_VERSION,
	INDEXNOW_SUBMISSION_BUCKETS,
	INDEXNOW_SUBMISSION_STATUSES,
	defaultIndexNowSettings,
	indexNowSubmissionStatus,
	validateIndexNowSettings,
};
export {
	SEO_SCHEMA_COMPOSER_RECIPES,
	SEO_SCHEMA_COMPOSER_VERSION,
	composeSeoSchema,
	defaultSeoSchemaComposerInput,
	isSeoSchemaComposerRecipe,
	seoSchemaComposerFields,
	seoSchemaComposerRecipe,
} from "./schema-composer.ts";
export type {
	SeoSchemaComposerErrorKey,
	SeoSchemaComposerErrors,
	SeoSchemaComposerFieldDefinition,
	SeoSchemaComposerFieldKey,
	SeoSchemaComposerFieldOption,
	SeoSchemaComposerInput,
	SeoSchemaComposerOutput,
	SeoSchemaComposerRecipe,
	SeoSchemaComposerResult,
	SeoSchemaComposerSnapshot,
} from "./schema-composer.ts";
export {
	SEO_CANONICAL_STATUSES,
	SEO_SITEMAP_ENTRY_REASONS,
	decideSeoSitemapEntry,
	normalizeSeoSitemapPath,
	validateSeoCanonical,
} from "./sitemap-policy.ts";
export type {
	SeoCanonicalStatus,
	SeoCanonicalValidation,
	SeoSitemapEntryDecision,
	SeoSitemapEntryDecisionInput,
	SeoSitemapEntryReason,
} from "./sitemap-policy.ts";
export {
	SEO_LOCALE_GRAPH_ISSUE_CODES,
	SEO_LOCALE_GRAPH_STATUSES,
	diagnoseSeoLocaleGraph,
} from "./locale-graph.ts";
export type {
	SeoLocaleGraphAlternate,
	SeoLocaleGraphDiagnostic,
	SeoLocaleGraphEntry,
	SeoLocaleGraphInput,
	SeoLocaleGraphIssue,
	SeoLocaleGraphIssueCode,
	SeoLocaleGraphIssueSeverity,
	SeoLocaleGraphStatus,
} from "./locale-graph.ts";

export {
	REDIRECT_GROUP_MAX_LENGTH,
	REDIRECT_ID_MAX_LENGTH,
	REDIRECT_REVISION_MAX_LENGTH,
	REDIRECT_EDIT_INPUT_MAX_LENGTH,
	REDIRECT_TIMESTAMP_MAX_LENGTH,
	REDIRECT_LIST_MAX_PAGE_SIZE,
	REDIRECT_LIST_PAGE_SIZE,
	REDIRECT_PATH_MAX_LENGTH,
	REDIRECT_RULE_CREATE_TYPES,
	REDIRECT_SEARCH_MAX_LENGTH,
	redirectAliasKey,
	redirectTypeLabel,
	redirectRuleConfiguration,
	redirectRuleEditability,
	validateRedirectRuleDraft,
} from "./redirects.ts";
export type {
	RedirectFieldError,
	RedirectPathIssue,
	RedirectRule,
	RedirectRuleCreateAccess,
	RedirectRuleCreateResult,
	RedirectRuleCreateType,
	RedirectRuleDraft,
	RedirectRuleFieldErrors,
	RedirectRuleListQuery,
	RedirectRuleListResult,
	RedirectRuleValidation,
	RedirectRuleConfiguration,
	RedirectRuleEditAccess,
	RedirectRuleEditDraft,
	RedirectRuleEditFieldErrors,
	RedirectRuleLoadResult,
	RedirectRuleUpdateRequest,
	RedirectRuleUpdateSnapshot,
	RedirectRuleUpdateResult,
	RedirectRuleUpdateRecoveryResult,
} from "./redirects.ts";
export {
	ENTRY_SCHEMA_JSON_MAX_BYTES,
	ENTRY_SCHEMA_MAX_PER_ENTRY,
	ENTRY_SCHEMA_NAME_MAX_LENGTH,
	ENTRY_SCHEMA_NEW_ID_PATTERN,
	validateEntrySchemaJson,
} from "./entry-schemas.ts";
export type {
	EntryCustomSchema,
	EntryCustomSchemaSummary,
	EntryInheritedSchema,
	EntryInheritedSchemaOwner,
	EntrySchemaCandidateSaveCheck,
	EntrySchemaEntry,
	EntrySchemaFieldErrors,
	EntrySchemaInspection,
	EntrySchemaRemoveResult,
	EntrySchemaSaveResult,
	EntrySchemaTarget,
	EntrySchemaWriteFailure,
} from "./entry-schemas.ts";
export {
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	extractSeoSchemaTypes,
	isSeoAdminSchemaScope,
};
export {
	SCHEMA_LIBRARY_ID_PATTERN,
	SCHEMA_LIBRARY_MAX_RECORD_BYTES,
	SCHEMA_LIBRARY_MAX_TEMPLATES,
	parseSchemaLibraryRecord,
	schemaLibraryNameProblem,
} from "./schema-library.ts";
export type {
	SchemaLibraryCorruptReason,
	SchemaLibraryFieldErrors,
	SchemaLibraryTemplate,
	SchemaLibraryWriteFailure,
} from "./schema-library.ts";
export type {
	LinkFindRequest,
	LinkNextRequest,
	LinkPageReceipt,
	LinkPageResult,
	LinkSavedLinkResult,
	LinkVerifyResult,
} from "./internal-link-runtime.ts";
export type { LinkSuggestionRequest } from "./internal-link-suggestions.ts";
export {
	ENTRY_SCHEMA_CANDIDATE_MAX_BYTES,
	ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES,
} from "./entry-schema-candidate.ts";
/** The variables entry schemas and library templates may use. */
export { TEMPLATE_VARS as TEMPLATE_VARIABLE_NAMES };

export const SEO_ADMIN_CONTRACT_VERSION = 47 as const;
export const CONTENT_SCORING_RESOURCE_NOTICE_VERSION = 1 as const;
export const SEO_ENGINE_PLUGIN_ID = "shipit-seo";
export const SEO_ENGINE_VERSION = "0.4.0-beta.56";
export const SEO_ADMIN_API_ROUTES = [
	"admin-branding",
	"admin-plugin-coexistence",
	"admin-crawl-diagnostics",
	"admin-404-monitor",
	"triage-admin-404",
	"admin-redirect-rules",
	"create-admin-redirect-rule",
	"reconcile-admin-redirect-rule",
	"admin-redirect-rule",
	"update-admin-redirect-rule",
	"reconcile-admin-redirect-rule-update",
	"admin-indexnow",
	"admin-indexnow-history",
	"admin-indexnow-history-urls",
	"setup-admin-indexnow",
	"save-admin-indexnow",
	"save-admin-indexnow-automation",
	"generate-admin-indexnow-key",
	"submit-admin-indexnow",
	"drain-admin-indexnow",
	"retry-admin-indexnow",
	"retry-admin-indexnow-submission",
	"admin-portability-export",
	"admin-portability-preview",
	"admin-portability-apply",
	"admin-overview",
	"admin-content-options",
	"admin-settings",
	"admin-indexing-taxonomies",
	"admin-analysis-profile",
	"save-analysis-profile",
	"save-admin-settings",
	"save-custom-verification-tags",
	"save-content-scoring",
	"reset-admin-settings",
	"admin-sitemap",
	"save-admin-sitemap",
	"reset-admin-sitemap",
	"preview-admin-sitemap",
	"admin-robots-txt",
	"admin-llms-txt",
	"save-admin-llms-txt",
	"set-admin-llms-txt-enabled",
	"reset-admin-llms-txt",
	"admin-templates",
	"save-admin-templates",
	"reset-admin-templates",
	"admin-template-examples",
	"admin-template-example",
	"preview-admin-template",
	"admin-entry-preview",
	"admin-entry-social",
	"save-admin-entry-social",
	"admin-configuration",
	"save-admin-modules",
	"reset-admin-modules",
	"admin-schema-presets",
	"save-admin-schema-presets",
	"reset-admin-schema-presets",
	"admin-schema-content-types",
	"save-admin-schema-content-types",
	"reset-admin-schema-content-types",
	"admin-business-identity",
	"preview-business-identity",
	"save-business-identity",
	"set-business-identity-active",
	"transition-business-identity-entity",
	"admin-business-identity-pages",
	"admin-publisher-ownership",
	"save-admin-publisher-ownership",
	"admin-custom-schema",
	"save-admin-custom-schema",
	"compose-admin-schema",
	"delete-admin-custom-schema",
	"scores",
	"audit-content",
	"entry-analysis-identity",
	"analyze-saved-content",
	"audit-content-options",
	"analysis-profile",
	"save-focus-keyword",
	"entry-directives",
	"save-entry-directives",
	"entry-schema-preview",
	"entry-custom-schemas",
	"save-entry-custom-schema",
	"remove-entry-custom-schema",
	"preview-entry-schema-candidate",
	"schema-library",
	"save-schema-library-template",
	"delete-schema-library-template",
	"score-trends",
	"refresh-scores",
	"score-scan",
	"start-score-scan",
	"command-score-scan",
	"score-scan-taxonomies",
	"score-scan-terms",
	"core-seo-migration-plan",
	"core-seo-migration-apply",
	"core-seo-migration-status",
	"core-seo-migration-rollback",
	"discard-admin-legacy-override",
	"find-link-suggestions",
	"next-link-suggestions",
	"verify-link-suggestion",
	"check-saved-link",
] as const;
export type SeoAdminApiRoute = (typeof SEO_ADMIN_API_ROUTES)[number];
export const SEO_ADMIN_SETTINGS_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_SITEMAP_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION = 4 as const;
export const SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH = 120 as const;
export const SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT = 5 as const;
export const SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH = 300 as const;
export const SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH = 1_000 as const;
export const SEO_ADMIN_SOCIAL_READ_REQUEST_MAX_BYTES = 2_048 as const;
export const SEO_ADMIN_SOCIAL_WRITE_REQUEST_MAX_BYTES = 16_384 as const;
export const SEO_ADMIN_CONFIGURATION_VERSION = 2 as const;
export const SEO_ADMIN_MODULES_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION = 2 as const;
export const SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_TEMPLATES_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_INDEXNOW_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION = 1 as const;
export const SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION = 1 as const;

export interface SeoAdmin404MonitorItem {
	id: string;
	path: string;
	hits: number;
	firstSeenAt: string;
	lastSeenAt: string;
	status: SeoNotFoundStatus;
	redirectTarget: string | null;
	suggestions: SeoRedirectSuggestion[];
}

export interface SeoAdmin404Monitor {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	enabled: boolean;
	summary: {
		totalHits: number;
		uniquePaths: number;
		openPaths: number;
		resolvedPaths: number;
	};
	items: SeoAdmin404MonitorItem[];
}

export type SeoAdmin404TriageResult =
	| { success: true; monitor: SeoAdmin404Monitor }
	| { success: false; error: "not_found" | "invalid_target" | "storage_unavailable" };

export type SeoAdminRedirectRuleListResult =
	{ contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & RedirectRuleListResult;
export type SeoAdminRedirectRuleCreateResult =
	{ contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & RedirectRuleCreateResult;
export type SeoAdminRedirectRuleLoadResult =
	{ contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & RedirectRuleLoadResult;
export type SeoAdminRedirectRuleUpdateResult =
	{ contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & RedirectRuleUpdateResult;
export type SeoAdminRedirectRuleUpdateRecoveryResult =
	{ contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & RedirectRuleUpdateRecoveryResult;

export const SEO_ADMIN_REDIRECT_EDIT_LIMITS = Object.freeze({
	loadRequestBytes: 2_048,
	updateRequestBytes: 65_536,
	recoveryRequestBytes: 98_304,
	wireResponseBytes: 65_536,
	// The host success wrapper uses 24 bytes outside the command data.
	resultBytes: 65_512,
	messageLength: 600,
});

export type SeoAdminEntrySchemaListResult =
	{ contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & EntrySchemaListResult;
export type SeoAdminEntrySchemaSaveResult =
	{ contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & EntrySchemaSaveResult;
export type SeoAdminEntrySchemaRemoveResult =
	{ contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & EntrySchemaRemoveResult;

/** JSON request bodies for a template save; a valid template fits with any JSON escaping. */
export const SEO_ADMIN_SCHEMA_LIBRARY_WRITE_REQUEST_MAX_BYTES = 524_288;
/** Declared JSON bodies of the Templates routes; four fields of at most 1,000 characters fit with escaping. */
export const SEO_ADMIN_TEMPLATE_WRITE_REQUEST_MAX_BYTES = 32_768;
export const SEO_ADMIN_TEMPLATE_SMALL_REQUEST_MAX_BYTES = 4_096;
/** Complete HTTP bodies, envelope included, measured before serialization. */
export const SEO_ADMIN_TEMPLATE_CONFIGURATION_RESPONSE_MAX_BYTES = 2_097_152;
export const SEO_ADMIN_TEMPLATE_EXAMPLES_RESPONSE_MAX_BYTES = 131_072;
export const SEO_ADMIN_TEMPLATE_PREVIEW_RESPONSE_MAX_BYTES = 65_536;
/** UTF-8 bytes one template field may expand to in a preview. */
export const SEO_ADMIN_TEMPLATE_EXPANSION_MAX_BYTES = 16_384;
export const SEO_ADMIN_TEMPLATE_EXAMPLES_MAX_LIMIT = 25;
/** The library's caps; each template follows the entry schema JSON rules. */
export const SEO_ADMIN_SCHEMA_LIBRARY_LIMITS = Object.freeze({
	templates: 20,
	recordBytes: 131_072,
	templateBytes: 32_768,
	depth: 16,
	values: 2_000,
	nameLength: 120,
});

/** The saved template library: inert records that no public page reads. */
export interface SeoAdminSchemaLibrary {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	state: "absent" | "saved" | "corrupt" | "unavailable";
	/** The whole library's revision; every write sends the one it loaded. */
	revision: string | null;
	templates: SchemaLibraryTemplate[];
	/** UTF-8 bytes of the stored record; null when it cannot be read. */
	bytes: number | null;
	corrupt: { reason: SchemaLibraryCorruptReason; detail: string } | null;
	conditionalStorage: boolean;
	limits: typeof SEO_ADMIN_SCHEMA_LIBRARY_LIMITS;
}

export type SeoAdminSchemaLibraryWriteResult = { contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & (
	| { success: true; changed: boolean; template: SchemaLibraryTemplate | null; library: SeoAdminSchemaLibrary }
	| { success: false; error: "invalid_values"; errors: SchemaLibraryFieldErrors }
	| { success: false; error: SchemaLibraryWriteFailure; message: string }
);

export type SeoAdminEntrySchemaCandidateFailure =
	| "invalid_input"
	| "entry_not_found"
	| "entry_mismatch"
	| "too_many_applicable"
	| "storage_unavailable"
	| "not_found"
	| "scope_mismatch"
	| "id_in_use"
	| "schemas_too_large"
	| "content_too_large"
	| "expansion_too_large"
	| "response_too_large"
	| "content_changed"
	| "snapshot_mismatch"
	| "settings_unreadable"
	| "canonical_unresolved";

/**
 * The plugin's predicted JSON-LD for one entry with an unsaved record, at the
 * content and records read for this request. It is not the complete page
 * graph, and a later save can see changed records.
 */
export interface SeoAdminEntrySchemaCandidatePreview {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	/** Echoed from the request so a late response is matched to its draft. */
	requestId: string;
	success: true;
	generatedAt: string;
	scope: "plugin-contribution";
	entry: { collection: string; entryId: string; locale: string | null; slug: string | null; status: string };
	content:
		| { sourceKind: "stored-entry"; sourceVersion: null }
		| { sourceKind: "saved-snapshot"; sourceVersion: string };
	candidate: {
		mode: "add" | "edit";
		id: string;
		expectedRevision: string | null;
		name: string;
		enabled: boolean;
		graphId: string;
		/** Serialized bytes of the resolved candidate; null when it resolves to nothing. */
		resolvedBytes: number | null;
	};
	outputEnabled: boolean;
	/**
	 * "entry": the entry's saved canonical or legacy override fills {{canonical}}.
	 * "page": the preview uses the registered public route when available; a
	 * template can set a different public-page canonical. Without an eligible
	 * route, an enabled candidate using {{canonical}} is refused.
	 */
	canonicalSource: "entry" | "page";
	saveCheck: EntrySchemaCandidateSaveCheck;
	items: SeoAdminEntrySchemaGraph[];
	limits: { candidateBytes: number; responseBytes: number };
}

export type SeoAdminEntrySchemaCandidatePreviewResult =
	| SeoAdminEntrySchemaCandidatePreview
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		requestId: string;
		success: false;
		error: "invalid_values";
		errors: EntrySchemaFieldErrors;
		message: string;
	}
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		requestId: string;
		success: false;
		error: "conflict";
		current: EntryCustomSchema;
		message: string;
	}
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		requestId: string;
		success: false;
		error: SeoAdminEntrySchemaCandidateFailure;
		message: string;
	};

export interface SeoAdminCrawlDiagnostics extends SeoCrawlDiagnosticsResult {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	diagnosticsVersion: typeof SEO_CRAWL_DIAGNOSTICS_VERSION;
}
export const SEO_PORTABILITY_FORMAT = "shipit-seo-portable" as const;
export const SEO_PORTABILITY_VERSION = 2 as const;
export const SEO_PORTABILITY_MAX_BYTES = 1_000_000;
export const SEO_PORTABILITY_CONFIRMATION = "IMPORT_SEO_CONFIGURATION" as const;

export { SEO_CHECK_BASES, SEO_CHECK_CONDITIONS, SEO_SCORE_COMPARISON_POLICY, SEO_SCORE_VERSION, isScoredSeoCheckBasis, seoContentCheckProblem,
	classifySeoContentCheck, summarizeSeoChecks, aggregateSeoChecks, seoAnalysisPresentation, seoScoredCheckMask, isSeoScoredCheckMask,
	seoScoreBand, seoScoreBandLabel, seoScoreDisplay, seoScoreLimitText };
export { currentSeoScoreAssessmentProblem } from "./score-result-validation.ts";
export type { SeoCheckBasis, SeoCheckCondition, SeoCheckRole, SeoScoreBand, SeoScoreDisplay, SeoScoreDisplayLabel, SeoScoreLimit, SeoScoreLimitReason };
export type SeoAdminScorePresentation = ReturnType<typeof seoAnalysisPresentation>;

export type SeoAdminCheckStatus = "pass" | "review" | "fail";
export type SeoAdminContentGrade = "excellent" | "good" | "needs-work" | "poor";
export type SeoAdminFocusKeywordSource = "profile" | "content" | "transient" | "none";

export interface SeoAdminContentOption {
	ref: string;
	entryId: string;
	collection: string;
	collectionLabel: string;
	title: string;
	updatedAt: string | null;
	sourceVersion?: string;
}

export interface SeoAdminContentCollection {
	collection: string;
	label: string;
	labelSingular: string;
	hasSeo: boolean;
	urlPattern: string | null;
	routable: boolean;
}

export interface SeoAdminContentOptions {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	generatedAt: string;
	engineVersion: string;
	collections: SeoAdminContentCollection[];
	items: SeoAdminContentOption[];
	cursor?: string;
	hasMore?: boolean;
}

export interface SeoAdminContentAuditOptions extends SeoAdminContentOptions {
	cursor?: string;
	hasMore: boolean;
}

/**
 * Checks of a score from the current analyzer always carry `basis` and
 * `limitation`. A score from an earlier `scoreVersion` is a legacy snapshot:
 * its checks may lack both and must be read as legacy, never as current.
 */
export interface SeoAdminContentScore extends Omit<SeoAnalysisResult, "scoreVersion" | "assessmentProfile" | "calculation" | "coverage"> {
	/** Older snapshots retain their original evidence without inventing a current model. */
	assessmentProfile?: SeoAnalysisResult["assessmentProfile"];
	assessmentProfileRevision?: string;
	/** Results before analyzer 21 have no `limits`. */
	calculation?: Omit<SeoAnalysisResult["calculation"], "limits"> & Partial<Pick<SeoAnalysisResult["calculation"], "limits">>;
	coverage?: SeoAnalysisResult["coverage"];
	/** Analyzer version that produced this score. Older versions remain useful as a last-known value. */
	scoreVersion: number;
	/** Monotonic reserved generation for stored scores; zero only for session analysis. */
	analysisRevision: number;
	/** Session results cannot enter score storage or history. */
	persistence?: "session";
	/** Session results only: digest of the entry's own plugin records the analysis read. */
	entryInputFingerprint?: string;
	/**
	 * Stored results only: SHA-256 identity of the captured saved-entry inputs.
	 * Only an equal identity under the current tag qualifies for strict reuse.
	 */
	inputIdentity?: string;
	/** Saved content identity from the host or an authenticated editor snapshot. */
	sourceVersion?: string;
	sourceKind?: "saved-snapshot";
	/** Whether the score still matches the active analyzer and site configuration. */
	freshness?: "current" | "stale";
	updatedAt: string;
	templateUpdatedAt: string | null;
	modulesUpdatedAt: string | null;
	configurationFingerprint: string;
	metaOverrideUpdatedAt: string | null;
	/** Keywords explicitly stored in the Shipit SEO analysis profile. */
	profileKeywords?: string[] | null;
	/** Where the effective analyzer keyword list came from. */
	focusKeywordSource?: SeoAdminFocusKeywordSource;
	keywords?: string[];
	pillar?: boolean;
}

export interface SeoAdminContentScores {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	generatedAt: string;
	engineVersion: string;
	scoreVersion: typeof SEO_SCORE_VERSION;
	items: SeoAdminContentScore[];
	cursor?: string;
	hasMore: boolean;
}

export interface SeoAdminContentAudit extends SeoAdminContentScores {
	persistence: "session";
	failures: Array<{ ref: string; error: string }>;
}

/**
 * The fields a session result records about the analyzer and its scoped
 * configuration, plus the exact row read now: its saved version, computed as
 * the editor's saved snapshot computes it, and its locale.
 */
export interface SeoAdminEntryAnalysisIdentity {
	scoreVersion: number;
	configurationFingerprint: string;
	templateUpdatedAt: string | null;
	modulesUpdatedAt: string | null;
	metaOverrideUpdatedAt: string | null;
	sourceVersion: string | null;
	locale: string | null;
	/** Digest of the entry's analysis profile, meta override and legacy overrides. */
	entryInputFingerprint: string;
}

export type SeoAdminEntryAnalysisIdentityFailure =
	| "scoring_disabled"
	| "activation_required"
	| "profile_required"
	| "profile_unavailable"
	| "invalid_ref"
	| "unsupported_collection"
	| "content_unavailable"
	| "content_not_found"
	| "configuration_unreadable";

/**
 * What a session analysis of one exact entry would record now, read without
 * analyzing or writing. A cached session result stays current only while every
 * identity field, its saved content version and its analysis profile match.
 */
export type SeoAdminEntryAnalysisIdentityResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		ref: string;
		identity: SeoAdminEntryAnalysisIdentity;
	}
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		ref: string;
		error: SeoAdminEntryAnalysisIdentityFailure;
	};

/** Tag of the current stored input identity; any other tag is readable but never reused. */
export const SEO_SCORE_INPUT_IDENTITY_TAG = "seo-input-v1" as const;

/**
 * Score history after an accepted score: a new snapshot, an equal latest
 * snapshot kept, a write refused before it started, or a write that may or may
 * not have been applied. Reuse writes no history.
 */
export type SeoAdminSavedAnalysisHistory = "created" | "unchanged" | "failed" | "uncertain" | "not-attempted";

export type SeoAdminSavedAnalysisFailure =
	| "invalid_ref"
	| "unsupported_collection"
	| "content_unavailable"
	| "content_not_found"
	| "locale_mismatch"
	| "scoring_disabled"
	| "activation_required"
	| "profile_required"
	| "profile_unavailable"
	| "scoring_unavailable"
	| "superseded"
	| "uncertain"
	| "analysis_failed";

/**
 * Durable analysis of one exact saved entry and locale. `saved` is an accepted
 * snapshot of the recorded inputs, `reused` an existing result whose inputs
 * still match exactly; neither promises freshness after later saves.
 */
export type SeoAdminSavedAnalysisResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		ref: string;
		outcome: "saved" | "reused";
		history: SeoAdminSavedAnalysisHistory;
		item: SeoAdminContentScore;
	}
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		ref: string;
		error: SeoAdminSavedAnalysisFailure;
	};

export interface SeoAdminAnalysisProfile {
	storageVersion: typeof SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION;
	ref: string;
	keyword: string;
	/**
	 * The explicit keyword statement.
	 * - `null`: no statement — an inherited content keyword may keep driving
	 *   analysis (lets pillar persist without silently adopting the fallback).
	 * - `[]`: intentionally cleared — suppresses the content fallback.
	 * - non-empty: explicit analyzer keywords, first entry is primary.
	 */
	keywords: string[] | null;
	pillar: boolean;
	updatedAt: string;
}

export interface SeoAdminRobotsDirectives {
	nofollow: boolean;
	noarchive: boolean;
	nosnippet: boolean;
	noimageindex: boolean;
	notranslate: boolean;
}

export interface SeoAdminMetaOverride {
	storageVersion: typeof SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION;
	ref: string;
	robots: SeoAdminRobotsDirectives;
	/** Global schema presets suppressed for this entry only. */
	disabledPresets?: string[];
	updatedAt: string;
}

export interface SeoAdminEntrySchemaGraph {
	id: string;
	source: "preset" | "custom";
	presetKey: string | null;
	name: string;
	types: string[];
	disabled: boolean;
	/** True only when this graph survives the same conflict checks used at page render time. */
	emitted: boolean;
	suppressedReason:
		| "disabled"
		| "invalid"
		| "duplicate-definition"
		| "entity-conflict"
		| "duplicate-contribution"
		| null;
	conflictId: string | null;
	/**
	 * True when the preset replaces EmDash core's primary JSON-LD graph;
	 * disabling such a preset restores the built-in graph instead of removing
	 * the type from the page.
	 */
	replacesCore: boolean;
	graph: unknown;
}

export interface SeoAdminEntrySchemaPreview {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	success: true;
	items: SeoAdminEntrySchemaGraph[];
}

export type SeoAdminEntrySchemaPreviewResult =
	| SeoAdminEntrySchemaPreview
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		error: SeoAdminEntryDirectivesOperationError;
	  };

export type SeoAdminEntryDirectivesOperationError =
	| "invalid_ref"
	| "invalid_values"
	| "unsupported_collection"
	| "content_unavailable"
	| "not_found"
	| "storage_unavailable";

export type SeoAdminEntryDirectivesResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		item: SeoAdminMetaOverride | null;
	  }
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		error: SeoAdminEntryDirectivesOperationError;
	  };

export type SeoAdminFocusKeywordOperationError =
	| "invalid_ref"
	| "invalid_keyword"
	| "unsupported_collection"
	| "content_unavailable"
	| "not_found"
	| "keyword_too_long"
	| "too_many_keywords"
	| "storage_unavailable";

export type SeoAdminAnalysisProfileResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		ref: string;
		profile: SeoAdminAnalysisProfile | null;
	  }
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		error: "invalid_ref" | "unsupported_collection" | "content_unavailable" | "not_found" | "storage_unavailable";
	  };

export type SeoAdminFocusKeywordSaveResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		ref: string;
		profile: SeoAdminAnalysisProfile | null;
		item: SeoAdminContentScore | null;
	  }
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		error: SeoAdminFocusKeywordOperationError;
	  };

export interface SeoAdminSocialOverride {
	storageVersion: typeof SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION;
	ref: string;
	title: string | null;
	description: string | null;
	updatedAt: string;
}

export interface SeoAdminSocialOverrideValues {
	title: string;
	description: string;
}

export interface SeoAdminSocialOverrideSnapshot {
	ref: string;
	revision: string | null;
	override: SeoAdminSocialOverride | null;
}

export type SeoAdminSocialOverrideEditing =
	| { state: "ready"; snapshot: SeoAdminSocialOverrideSnapshot }
	| {
		state: "unavailable";
		reason: "storage_unavailable" | "record_invalid" | "snapshot_changed";
	  };

export type SeoAdminSocialOverrideReadError =
	| "invalid_ref"
	| "unsupported_collection"
	| "content_unavailable"
	| "not_found"
	| "storage_unavailable"
	| "record_invalid";

export type SeoAdminSocialOverrideOperationError =
	| SeoAdminSocialOverrideReadError
	| "invalid_values"
	| "title_too_long"
	| "description_too_long"
	| "conflict"
	| "unconfirmed";

export type SeoAdminSocialOverrideReadResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		ref: string;
		snapshot: SeoAdminSocialOverrideSnapshot;
	  }
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		ref: string | null;
		error: SeoAdminSocialOverrideReadError;
	  };

export type SeoAdminSocialOverrideSaveResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		ref: string;
		outcome: "saved" | "unchanged";
		snapshot: SeoAdminSocialOverrideSnapshot;
	  }
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		ref: string | null;
		outcome: "rejected" | "unconfirmed";
		error: SeoAdminSocialOverrideOperationError;
	  };

export interface SeoAdminScoreHistoryIssue {
	id: string;
	label: string;
	category: SeoAnalysisResult["checks"][number]["category"];
	severity: SeoAnalysisResult["checks"][number]["severity"];
	status: Exclude<SeoAdminCheckStatus, "pass">;
	weight: number;
}

export interface SeoAdminScoreSnapshot {
	id: string;
	storageVersion: typeof SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION;
	fingerprint: string;
	ref: string;
	collection: string;
	entryId: string;
	title: string;
	score: number;
	grade: SeoAdminContentGrade;
	scoreVersion: number;
	/** Optional so snapshots written before analyzer fencing remain readable. */
	analysisRevision?: number;
	sourceUpdatedAt: string | null;
	/** Optional so snapshots written before revision-aware scoring remain readable. */
	sourceVersion?: string;
	templateUpdatedAt: string | null;
	/** Optional so storage-v1 snapshots written before Image SEO remain readable. */
	modulesUpdatedAt?: string | null;
	/** Optional so snapshots written before score v5 remain readable. */
	configurationFingerprint?: string;
	metaOverrideUpdatedAt?: string | null;
	capturedAt: string;
	issues: SeoAdminScoreHistoryIssue[];
	/** Qualified separately so malformed optional context does not drop raw history. */
	comparisonContext?: unknown;
	/**
	 * Set when the result showed no number. Such a snapshot keeps its place in
	 * history but stays out of averages, trends and comparisons.
	 */
	unscored?: SeoAdminScoreSnapshotUnscored;
}

export type SeoAdminScoreSnapshotUnscored = "partially-checked" | "too-little-text";

export type SeoAdminScoreTrendDirection = "improved" | "declined" | "stable" | "insufficient-data";

export interface SeoAdminScoreTrendPoint {
	date: string;
	averageScore: number | null;
	trackedEntries: number;
	failingIssues: number;
	reviewIssues: number;
}

export interface SeoAdminScoreTrendIssue {
	id: string;
	label: string;
	category: SeoAdminScoreHistoryIssue["category"];
	severity: SeoAdminScoreHistoryIssue["severity"];
	status: SeoAdminScoreHistoryIssue["status"];
	affectedEntries: number;
}

export interface SeoScoreComparisonContext {
	version: 1;
	policy: typeof SEO_SCORE_COMPARISON_POLICY;
	assessmentProfile: SeoAnalysisResult["assessmentProfile"];
	eligibleMask: number;
}

export type SeoScoreBaselineBasis = "before-window" | "first-in-window";

export interface SeoAdminScoreComparison {
	policy: "same-ref-window-v1";
	range: { start: string; end: string };
	observedEntries: number;
	pairedEntries: number;
	singleSampleEntries: number;
	excludedEntries: number;
	exclusions: { missingContext: number; invalidContext: number; changedProfile: number; ambiguousTime: number };
	scopeChangedPairs: number;
	baselineAverage: number | null;
	currentAverage: number | null;
	scoreDelta: number | null;
	direction: SeoAdminScoreTrendDirection;
	openedIssues: number | null;
	resolvedIssues: number | null;
	improvedEntries: number;
	declinedEntries: number;
	unchangedEntries: number;
}

export interface SeoAdminScoreTrendChange {
	ref: string;
	collection: string;
	entryId: string;
	title: string;
	previousSnapshotId: string;
	currentSnapshotId: string;
	previousCapturedAt: string;
	baselineBasis: SeoScoreBaselineBasis;
	scopeChanged: boolean;
	previousScore: number;
	currentScore: number;
	delta: number;
	openedIssues: number;
	resolvedIssues: number;
	capturedAt: string;
}

export interface SeoAdminScoreTrends {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	storageVersion: typeof SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION;
	generatedAt: string;
	engineVersion: string;
	scoreVersion: typeof SEO_SCORE_VERSION;
	scope: {
		days: number;
		collection: string | null;
		ref: string | null;
	};
	/** Observations from retained current-generation history, not a live site census. */
	summary: {
		snapshotCount: number;
		trackedEntries: number;
		currentAverage: number | null;
		openIssues: number;
	};
	comparison: SeoAdminScoreComparison;
	points: SeoAdminScoreTrendPoint[];
	topIssues: SeoAdminScoreTrendIssue[];
	changes: { items: SeoAdminScoreTrendChange[]; total: number; hasMore: boolean };
	items: SeoAdminScoreSnapshot[];
}

export interface SeoAdminOverview {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	generatedAt: string;
	engineVersion: string;
	readiness: {
		score: number;
		state: "ready" | "review" | "blocked";
		title: string;
		description: string;
	};
	site: {
		name: string;
		url: string | null;
		/** Null while the stored indexing preference cannot be read. */
		indexable: boolean | null;
		/** What Shipit adds site-wide; "none" leaves robots to entries and other owners. */
		robotsMode: "none" | "noindex,nofollow" | "unknown";
		settingsState: SeoAdminSettingsState;
		defaultSocialImage: string | null;
		socialProfileCount: number;
	};
	summary: {
		totalScored: number;
		sampleSize: number;
		averageContentScore: number | null;
		needsAttention: number;
		schemaPresetsEnabled: number;
		schemaPresetsTotal: number;
		customSchemas: number;
		legacyOverrides: number;
		/** Migration journal records, so the Migration view can hide when there is nothing to review. */
		migrationRecords: number;
		enabledModules: number;
		totalModules: number;
	};
	priorities: Array<{
		priority: number;
		area: string;
		check: string;
		status: Exclude<SeoAdminCheckStatus, "pass">;
		detail: string;
	}>;
	checks: Array<{
		group: string;
		check: string;
		status: SeoAdminCheckStatus;
		weight: number;
		detail: string;
	}>;
	content: Array<{
		ref: string;
		entryId: string;
		collection: string;
		collectionLabel: string;
		title: string;
		score: number;
		grade: SeoAdminContentGrade;
		presentation: SeoAdminScorePresentation | null;
		needsAttention: boolean | null;
		firstIssue: string;
		updatedAt: string;
	}>;
}

// ---- Durable scoped score scans ----

export type SeoAdminScoreScanStatus = "all" | "draft" | "published" | "scheduled";

export interface SeoAdminScoreScanTaxonomySelection {
	taxonomy: string;
	/** Exact host term IDs; descendants are included only when requested. */
	termIds: string[];
	includeDescendants: boolean;
}

export type SeoAdminScoreScanTarget = { mode: "count"; count: number } | { mode: "all" };

export interface SeoAdminScoreScanStartRequest {
	commandId: string;
	/** The current run this start replaces, or null when no readable run exists. */
	replace: { runId: string; expectedRevision: number } | null;
	collection: string;
	status: SeoAdminScoreScanStatus;
	locale: string | null;
	taxonomies: SeoAdminScoreScanTaxonomySelection[];
	target: SeoAdminScoreScanTarget;
}

export type SeoAdminScoreScanCommand = "continue" | "pause" | "resume" | "stop";

export interface SeoAdminScoreScanCommandRequest {
	command: SeoAdminScoreScanCommand;
	runId: string;
	expectedRevision: number;
	commandId: string;
}

export type SeoAdminScoreScanState = "running" | "paused" | "stopped" | "completed";

export type SeoAdminScoreScanPauseReason =
	| "requested"
	| "scoring-disabled"
	| "activation-required"
	| "profile-required"
	| "profile-unavailable"
	| "scoring-unavailable"
	| "policy-changed"
	| "failure-streak"
	| "source-unavailable"
	| "record-budget";

export type SeoAdminScoreScanCompletion = "target-reached" | "exhausted";

/**
 * One attempt's terminal outcome. `retry` keeps the admitted slot for an
 * explicit Resume; `uncertain` is an attempt left without a terminal receipt
 * that recovery fenced, so its score was not accepted.
 */
export type SeoAdminScoreScanOutcomeStatus =
	| "reused"
	| "saved"
	| "superseded"
	| "skipped"
	| "failed"
	| "retry"
	| "uncertain";

/** Whether analysis completed: confirmed, never started, started but threw, or unprovable. */
export type SeoAdminScoreScanComputation = "confirmed" | "none" | "incomplete" | "unknown";

export type SeoAdminScoreScanHistory =
	| "pending"
	| "created"
	| "unchanged"
	| "failed"
	| "uncertain"
	| "unknown"
	| "not-attempted";

export interface SeoAdminScoreScanOutcome {
	attemptId: string;
	/** The logical admission this attempt belongs to, from 1. */
	admission: number;
	ref: string;
	locale: string;
	recordedAt: string;
	status: SeoAdminScoreScanOutcomeStatus;
	reason: string | null;
	computation: SeoAdminScoreScanComputation;
	score: number | null;
	history: SeoAdminScoreScanHistory;
}

/**
 * Source counters describe projected candidates, not physical reads.
 * `admitted` is the target counter; outcome counters describe attempts, so
 * explicit retries can make them exceed `admitted`.
 */
export interface SeoAdminScoreScanCounters {
	fetchedCandidates: number;
	examinedCandidates: number;
	matchedReferences: number;
	noLongerMatching: number;
	admitted: number;
	attempts: number;
	analyzed: number;
	reused: number;
	saved: number;
	superseded: number;
	skipped: number;
	failed: number;
	retried: number;
	uncertain: number;
	historyCreated: number;
	historyUnchanged: number;
	historyFailed: number;
	historyUncertain: number;
	historyUnknown: number;
}

export interface SeoAdminScoreScanScope {
	collection: string;
	status: SeoAdminScoreScanStatus;
	locale: string | null;
	taxonomies: Array<SeoAdminScoreScanTaxonomySelection & { termGroupCount: number }>;
}

export interface SeoAdminScoreScanView {
	runId: string;
	revision: number;
	state: SeoAdminScoreScanState;
	pauseReason: SeoAdminScoreScanPauseReason | null;
	completion: SeoAdminScoreScanCompletion | null;
	createdAt: string;
	updatedAt: string;
	scope: SeoAdminScoreScanScope;
	target: SeoAdminScoreScanTarget;
	counters: SeoAdminScoreScanCounters;
	failureStreak: number;
	/** Work an owner holds; `active` is false once its lease has expired. */
	unit: { phase: "analysis" | "history"; ref: string; leaseExpiresAt: string; active: boolean } | null;
	/** An admitted entry kept for retry after a refusal or recovery. */
	retry: { ref: string; admission: number } | null;
	bufferedReferences: number;
	exhausted: boolean;
	outcomes: SeoAdminScoreScanOutcome[];
	outcomeRetention: number;
}

export type SeoAdminScoreScanFailure =
	| "scan_unavailable"
	| "storage_unavailable"
	| "source_unavailable"
	| "invalid_command"
	| "invalid_scope"
	| "unsupported_collection"
	| "scope_too_large"
	| "scoring_disabled"
	| "activation_required"
	| "profile_required"
	| "profile_unavailable"
	| "scoring_unavailable"
	| "run_exists"
	| "stale_run"
	| "stale_revision"
	| "receipt_expired"
	| "not_running"
	| "not_resumable"
	| "busy"
	| "recovery_required"
	| "uncertain";

export type SeoAdminScoreScanDecision = "continue" | "paused" | "stopped" | "completed";

/** What one command did: a zero-match source window, a reference that no longer matched, or an attempt outcome. */
export type SeoAdminScoreScanProgress = "window" | "no-longer-matching" | "outcome" | "state";

export type SeoAdminScoreScanResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		command: "start" | SeoAdminScoreScanCommand;
		commandId: string;
		/** True when this answers an already recorded command; `scan` is then the current state. */
		replayed: boolean;
		decision: SeoAdminScoreScanDecision;
		progress: SeoAdminScoreScanProgress;
		outcome: SeoAdminScoreScanOutcome | null;
		scan: SeoAdminScoreScanView;
	}
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		command: "start" | SeoAdminScoreScanCommand;
		commandId: string;
		error: SeoAdminScoreScanFailure;
		detail: string | null;
		scan: SeoAdminScoreScanView | null;
	};

export type SeoAdminScoreScanStateResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		checkedAt: string;
		scan: SeoAdminScoreScanView | null;
	}
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		error: "scan_unavailable" | "storage_unavailable";
	};

export interface SeoAdminScoreScanTaxonomy {
	name: string;
	label: string;
	hierarchical: boolean;
}

export type SeoAdminScoreScanTaxonomiesResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		collection: string;
		taxonomies: SeoAdminScoreScanTaxonomy[];
	}
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		collection: string;
		error: "scan_unavailable" | "unsupported_collection" | "taxonomies_unavailable";
	};

export interface SeoAdminScoreScanTermsRequest {
	collection: string;
	taxonomy: string;
	locale: string | null;
	search: string;
	cursor: string | null;
}

export interface SeoAdminScoreScanTerm {
	id: string;
	translationGroup: string;
	label: string;
	locale: string;
}

export type SeoAdminScoreScanTermsResult =
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: true;
		collection: string;
		taxonomy: string;
		terms: SeoAdminScoreScanTerm[];
		nextCursor: string | null;
	}
	| {
		contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
		engineVersion: string;
		success: false;
		collection: string;
		taxonomy: string;
		error: "scan_unavailable" | "unsupported_collection" | "invalid_selection" | "source_unavailable";
		/** The source's message for a rejected selection, otherwise null. */
		detail: string | null;
	};

export type SeoAdminRefreshCollection = string;

export interface SeoAdminRefreshResult {
	success: boolean;
	collection: SeoAdminRefreshCollection;
	processed?: number;
	updated: number;
	scoreVersion: number;
	revision: string;
	cursor: string | null;
	hasMore: boolean;
}

export type SeoAdminPublisherType = "organization" | "person";

export interface SeoAdminSettingsValues {
	/** Optional in older records; absent means no custom verification tags. */
	customVerificationTags?: CustomVerificationTag[];
	/** Optional in older records; exact taxonomy archives selected for noindex. */
	taxonomyArchiveNoindex?: string[];
	/** Optional in older records; exact content types whose entries all get noindex. */
	contentTypeNoindex?: string[];
	siteName: string;
	siteUrl: string;
	publisherType: SeoAdminPublisherType;
	organizationName: string;
	organizationLogo: string;
	personName: string;
	socialProfiles: string[];
	personProfiles: string[];
	defaultSocialImage: string;
	twitterHandle: string;
	noindex: boolean;
	contentScoringEnabled: boolean;
}

export type SeoAdminSettingsField = keyof SeoAdminSettingsValues;
export type SeoAdminSettingsErrors = Partial<Record<SeoAdminSettingsField | "_form", string>>;

/**
 * Where the effective settings come from. `absent`: no record and no legacy
 * noindex, so Shipit adds no site-wide restriction. `historical-seed`: an
 * unconfirmed record matching an early alpha's install seed, read with
 * site-wide noindex on. `corrupt` and `unavailable` carry no values.
 */
export type SeoAdminSettingsState = "absent" | "saved" | "legacy" | "historical-seed" | "corrupt" | "unavailable";

export const SEO_ADMIN_LEGACY_SETTINGS_GUARD_PATTERN = /^legacy-v1:[0-9a-f]{64}$/;

interface SeoAdminContentScoringPolicyFields {
	revision: string | null;
	intentEnabled: boolean;
	acknowledgedNoticeVersion: number | null;
	currentNoticeVersion: number;
}

export type SeoAdminContentScoringPolicy =
	| (SeoAdminContentScoringPolicyFields & { state: "enabled" })
	| (SeoAdminContentScoringPolicyFields & { state: "paused" })
	| (SeoAdminContentScoringPolicyFields & { state: "pending-confirmation" })
	| { state: "unavailable"; reason: "unreadable" | "corrupt" };

export type SeoAdminCollectionAnalysisProfileSelection =
	| { state: "configured"; collection: string; profile: "article" | "general"; version: 1; revision: string }
	| { state: "unconfigured"; collection: string; revision: null }
	| { state: "unavailable"; collection: string; reason?: string };

export interface SeoAdminCollectionAnalysisProfileResult {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	collection: string;
	selection: SeoAdminCollectionAnalysisProfileSelection;
}

export interface SeoAdminCollectionAnalysisProfileChange {
	collection: string;
	profile: "article" | "general";
	expectedRevision: string | null;
}

export type SeoAdminCollectionAnalysisProfileSaveResult =
	| (SeoAdminCollectionAnalysisProfileResult & { success: true; selection: Extract<SeoAdminCollectionAnalysisProfileSelection, { state: "configured" }> })
	| { contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION; engineVersion: string; success: false; error: string; conflict?: boolean };

interface SeoAdminSettingsEnvelope {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	storageVersion: typeof SEO_ADMIN_SETTINGS_STORAGE_VERSION;
	engineVersion: string;
	hostSiteUrl?: string;
	contentScoring: SeoAdminContentScoringPolicy;
}

export interface SeoAdminReadableSettings extends SeoAdminSettingsEnvelope {
	state: "absent" | "saved" | "legacy" | "historical-seed";
	updatedAt: string | null;
	/** Revision of the stored record, or null while none is stored. */
	revision: string | null;
	/** Presence and revisions of the legacy keys as loaded; only while no record is stored. */
	legacyGuard: string | null;
	/** Some legacy key supplied a value. */
	legacyPresent: boolean;
	/** The stored record carries the server-owned confirmation marker. */
	indexingPreferenceConfirmed: boolean;
	values: SeoAdminSettingsValues;
}

export interface SeoAdminUnreadableSettings extends SeoAdminSettingsEnvelope {
	state: "corrupt" | "unavailable";
	updatedAt: null;
	revision: string | null;
	legacyGuard: null;
	legacyPresent: false;
	indexingPreferenceConfirmed: false;
	values: null;
}

export type SeoAdminSettings = SeoAdminReadableSettings | SeoAdminUnreadableSettings;

export type SeoAdminSettingsSaveResult =
	| { success: true; settings: SeoAdminReadableSettings }
	| { success: false; errors: SeoAdminSettingsErrors; conflict?: boolean };

export interface SeoAdminSettingsWriteGuard {
	expectedRevision: string | null;
	expectedLegacyGuard: string | null;
}

/**
 * A full save names the record it replaces. With no stored record it also
 * names the legacy keys it was loaded from.
 */
export function validateSeoAdminSettingsWriteGuard(
	input: unknown,
): { success: true; guard: SeoAdminSettingsWriteGuard } | { success: false; errors: SeoAdminSettingsErrors } {
	const source = record(input);
	const reload = "The settings revision is missing or invalid. Reload and try again.";
	if (!source || !Object.hasOwn(source, "expectedRevision")) return { success: false, errors: { _form: reload } };
	const expectedRevision = source.expectedRevision;
	if (expectedRevision !== null &&
		(typeof expectedRevision !== "string" || !expectedRevision || expectedRevision.length > 128)) {
		return { success: false, errors: { _form: reload } };
	}
	const legacyGuard = source.expectedLegacyGuard;
	if (expectedRevision === null) {
		if (typeof legacyGuard !== "string" || !SEO_ADMIN_LEGACY_SETTINGS_GUARD_PATTERN.test(legacyGuard)) {
			return { success: false, errors: { _form: "The loaded legacy settings guard is missing or invalid. Reload and try again." } };
		}
		return { success: true, guard: { expectedRevision, expectedLegacyGuard: legacyGuard } };
	}
	if (legacyGuard !== undefined && legacyGuard !== null) {
		return { success: false, errors: { _form: "A legacy settings guard applies only while no settings record is stored. Reload and try again." } };
	}
	return { success: true, guard: { expectedRevision, expectedLegacyGuard: null } };
}

export interface SeoAdminContentScoringChange {
	contentScoringEnabled: boolean;
	expectedContentScoringEnabled: boolean;
	expectedRevision: string | null;
	expectedLegacyGuard?: string | null;
	resourceNoticeVersion?: number;
}

export type SeoAdminContentScoringValidation =
	| { success: true; values: SeoAdminContentScoringChange }
	| { success: false; errors: SeoAdminSettingsErrors };

export type SeoAdminSettingsValidation =
	| { success: true; values: SeoAdminSettingsValues }
	| { success: false; errors: SeoAdminSettingsErrors };

export const SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY = "staticRoutes" as const;
export type SeoAdminSitemapContentType = string;

export interface SeoAdminSitemapValues {
	contentTypes: Record<SeoAdminSitemapContentType, boolean>;
	excludedPaths: string[];
}

/** A public, routable EmDash collection that can be listed in the sitemap. */
export interface SeoAdminSitemapGroup {
	key: string;
	label: string;
	/** `saved`: an explicit stored choice; `default`: Pages/Posts on, everything else off. */
	source: "saved" | "default";
	/** EmDash URL pattern, or null for EmDash's `/{collection}/{slug}` fallback. */
	urlPattern: string | null;
	/** Row-unique pattern, or a fixed path whose current published rows have distinct localized addresses. */
	unique: boolean;
}

export type SeoAdminSitemapField = keyof SeoAdminSitemapValues;
export type SeoAdminSitemapErrors = Partial<Record<SeoAdminSitemapField | "_form", string>>;

export interface SeoAdminPublicFiles {
	/**
	 * Public site origin from Site identity, else EmDash's site URL, else (for
	 * the sitemap) the public Astro `site` recorded at build; null when none is
	 * an http(s) origin.
	 */
	origin: string | null;
	source: "site-identity" | "emdash-site" | "astro-site" | null;
	sitemapUrl: string | null;
	robotsUrl: string | null;
}

/**
 * Who answers `/sitemap.xml`. `shipit` serves these settings; every other
 * value leaves the file with EmDash core or the site, unchanged by them.
 */
export const SEO_SITEMAP_OWNERS = [
	"shipit",
	"module-off",
	"site-route",
	"static-file",
	"integration",
	"competing-route",
	"unknown",
	"unsupported-routing",
	"unsupported-host",
	"not-installed",
] as const;
export type SeoSitemapOwner = (typeof SEO_SITEMAP_OWNERS)[number];

export const SEO_SITEMAP_AVAILABILITY = [
	"ready",
	"site-noindex",
	"no-origin",
	"settings-corrupt",
	"settings-unavailable",
	"feature-controls-invalid",
	"site-settings-invalid",
	"source-unavailable",
	"route-conflict",
	"not-owned",
] as const;
export type SeoSitemapAvailability = (typeof SEO_SITEMAP_AVAILABILITY)[number];

export interface SeoAdminSitemapFilePlan {
	collection: string;
	label: string;
	/** Published candidates before exclusions, noindex and canonical rules. */
	candidates: number;
	/** Child file cursors in order; `null` is the collection's first file. */
	files: (string | null)[];
}

export interface SeoAdminSitemapConfiguration {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	storageVersion: typeof SEO_ADMIN_SITEMAP_STORAGE_VERSION;
	engineVersion: string;
	updatedAt: string | null;
	/** Storage revision for the next conditional save; null while nothing is stored. */
	revision: string | null;
	settings: "default" | "saved" | "corrupt" | "unavailable";
	/** False when the host has no conditional settings write or the stored record must be replaced first. */
	writable: boolean;
	moduleEnabled: boolean;
	owner: SeoSitemapOwner;
	ownerDetail: string | null;
	availability: SeoSitemapAvailability;
	groups: SeoAdminSitemapGroup[];
	values: SeoAdminSitemapValues;
	/** Stored choices for keys that are not public collections now; kept on save. */
	preservedKeys: string[];
	/** Listed groups whose content type noindex rule leaves them out; their stored choice is kept. */
	noindexContentTypes?: string[];
	/** Selected collections whose patterns may produce the same address. */
	overlaps: { collections: [string, string] }[];
	/** Candidate counts and files per selected collection; null when not computed. */
	plan: SeoAdminSitemapFilePlan[] | null;
	pageSize: number;
	publicFiles: SeoAdminPublicFiles;
}

export type SeoAdminSitemapSaveResult =
	| { success: true; sitemap: SeoAdminSitemapConfiguration }
	| { success: false; conflict?: true; errors: SeoAdminSitemapErrors };

/**
 * Who answers `/robots.txt`. Only `emdash-core` lets the Robots.txt editor
 * save: EmDash core serves its stored `seo.robotsTxt` there. `unsettled`
 * means the resolved routes were not recorded; `not-installed` means this
 * runtime has no ownership facts at all.
 */
export const SEO_ROBOTS_TXT_OWNERS = [
	"emdash-core",
	"unsettled",
	"unknown",
	"site-route",
	"static-file",
	"integration",
	"competing-route",
	"unsupported-routing",
	"unsupported-host",
	"not-served",
	"not-installed",
] as const;
export type SeoRobotsTxtOwner = (typeof SEO_ROBOTS_TXT_OWNERS)[number];

/** Build-time facts for the Robots.txt editor; the text itself is EmDash core's site setting. */
export interface SeoAdminRobotsTxtFacts {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	owner: SeoRobotsTxtOwner;
	ownerDetail: string | null;
	/** EmDash version found at build; selects the role hints the editor may show. */
	hostVersion: string | null;
	/** EmDash's `siteUrl` option, else `EMDASH_SITE_URL || SITE_URL`; core uses it when Site settings has no URL. */
	configuredOrigin: { origin: string; source: "emdash-config" | "environment" } | null;
	/** False when no facts were recorded, so the configured origin is not known. */
	configuredOriginKnown: boolean;
}

/**
 * Who answers `/llms.txt`. Only `shipit` lets the llms.txt editor save or turn
 * output on: Shipit SEO answers the file then. `unsettled` means the resolved
 * routes were not recorded, `unknown` that a directory could not be read, and
 * `not-installed` that this runtime has no ownership facts.
 */
export const SEO_LLMS_TXT_OWNERS = [
	"shipit",
	"unsettled",
	"unknown",
	"site-route",
	"static-file",
	"integration",
	"competing-route",
	"unsupported-routing",
	"unsupported-host",
	"not-installed",
] as const;
export type SeoLlmsTxtOwner = (typeof SEO_LLMS_TXT_OWNERS)[number];

export const SEO_LLMS_TXT_CORRUPT_REASONS = [
	"not-object",
	"unsupported-version",
	"unexpected-fields",
	"enabled-not-boolean",
	"text-invalid",
	"enabled-without-h1",
] as const;
export type SeoLlmsTxtCorruptReason = (typeof SEO_LLMS_TXT_CORRUPT_REASONS)[number];

/** The stored llms.txt document and its output switch, with one revision for both. */
export interface SeoAdminLlmsTxt {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	owner: SeoLlmsTxtOwner;
	ownerDetail: string | null;
	hostVersion: string | null;
	/** False when the host has no getVersioned, compareAndSet and compareAndDelete. */
	conditionalStorage: boolean;
	state: "absent" | "stored" | "corrupt" | "unavailable";
	/** Revision of the stored record; present for stored and corrupt records only. */
	revision: string | null;
	enabled: boolean;
	/** The exact stored text; null unless the record is valid. */
	text: string | null;
	bytes: number | null;
	corrupt: {
		reason: SeoLlmsTxtCorruptReason;
		detail: string;
		/** The parsed stored value serialized again as JSON; null when larger than the copy limit. */
		copy: string | null;
		copyBytes: number;
	} | null;
	limits: { documentBytes: number; requestBytes: number };
	path: "/llms.txt";
	cacheControl: string;
}

export type SeoAdminLlmsTxtWriteResult =
	/** `changed` is false when the stored record already had this value; nothing was written then. */
	| { success: true; changed: boolean; llms: SeoAdminLlmsTxt }
	| { success: false; reason: "conflict" | "invalid" | "blocked" | "unavailable"; message: string; field?: "text" };

/** Automatic publisher ownership, as the read route returns it; `check` only for a check request. */
export type SeoAdminPublisherOwnershipReadResult = {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	ownership: PublisherOwnershipView;
	check?: PublisherOwnershipCheck;
};

export type SeoAdminPublisherOwnershipWriteResult = { contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION } & PublisherOwnershipWriteResult;

export interface SeoAdminSitemapPreviewEntry {
	id: string;
	locale: string;
	status: SitemapEntryStatus;
	path: string | null;
	url: string | null;
	lastmod: string | null;
	image: string | null;
	canonical: string | null;
	alternates: number;
}

export interface SeoAdminSitemapPreviewRequest {
	collection: string;
	after: string | null;
	search?: string;
	status?: "all" | "included" | "excluded";
	limit?: 25 | 50;
	cursor?: string | null;
}

export type SeoAdminSitemapPreview =
	| {
			success: true;
			collection: string;
			after: string | null;
			/** Public address of this child file. */
			fileUrl: string | null;
			entries: SeoAdminSitemapPreviewEntry[];
			/** Exact counts for this public file, before the table filter. */
			included: number;
			excluded: number;
			total: number;
			/** Rows matching the search and status within this file. */
			matched: number;
			search: string;
			status: "all" | "included" | "excluded";
			limit: 25 | 50;
			offset: number;
			previousCursor: string | null;
			nextCursor: string | null;
	  }
	| { success: false; errors: { _form: string }; stale?: true };

export type SeoAdminSitemapValidation =
	| { success: true; values: SeoAdminSitemapValues }
	| { success: false; errors: SeoAdminSitemapErrors };

export function defaultSeoAdminSitemapValues(
	collections: readonly string[] = SEO_ADMIN_TEMPLATE_DEFINITIONS.map(
		(definition) => definition.key,
	),
): SeoAdminSitemapValues {
	return {
		contentTypes: Object.fromEntries([
			[SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY, true],
			...collections.map((collection) => [collection, SITEMAP_DEFAULT_COLLECTIONS.includes(collection)] as const),
		]),
		excludedPaths: [],
	};
}

export const SEO_ADMIN_TEMPLATE_DEFINITIONS = [
	{
		key: "posts",
		label: "Posts",
		description: "Defaults for blog posts when an entry has no explicit SEO value.",
	},
	{
		key: "pages",
		label: "Pages",
		description: "Defaults for standard pages and marketing routes backed by page entries.",
	},
	{
		key: "services",
		label: "Services",
		description: "Defaults for individual service entries and their social previews.",
	},
] as const;

export type SeoTemplateCollection = string;
export type SeoAdminTemplateField = "title" | "description" | "socialTitle" | "socialDescription";
export interface SeoAdminTemplateValues {
	title: string;
	description: string;
	socialTitle: string;
	socialDescription: string;
}
export type SeoAdminTemplateSet = Record<string, SeoAdminTemplateValues>;
export type SeoAdminTemplateErrorKey = `${string}.${SeoAdminTemplateField}` | "_form";
export type SeoAdminTemplateErrors = Partial<Record<SeoAdminTemplateErrorKey, string>>;
export type SeoAdminTemplateValidation =
	| { success: true; values: SeoAdminTemplateSet }
	| { success: false; errors: SeoAdminTemplateErrors };
export type SeoAdminTemplateValuesValidation =
	| { success: true; values: SeoAdminTemplateValues }
	| { success: false; errors: SeoAdminTemplateErrors };
export type SeoAdminTemplateSource = "snapshot" | "legacy" | "default";
export type SeoAdminOutputSupportState = "live" | "theme-bridge-required";

export interface SeoAdminOutputSupport {
	htmlTitle: SeoAdminOutputSupportState;
	metaDescription: SeoAdminOutputSupportState;
	openGraph: SeoAdminOutputSupportState;
	twitter: SeoAdminOutputSupportState;
}

export const SEO_ADMIN_OUTPUT_SUPPORT: SeoAdminOutputSupport = {
	htmlTitle: "theme-bridge-required",
	metaDescription: "live",
	openGraph: "live",
	twitter: "live",
};

export type SeoAdminTemplateState = "absent" | "saved" | "corrupt" | "unavailable";

export interface SeoAdminTemplateInheritanceGuard {
	/** Revisions of the collection's four legacy keys; null where a key is absent. */
	fields: Record<SeoAdminTemplateField, string | null>;
	/** Revision of the legacy score-token row; present only while no record exists. */
	revisions?: string | null;
}
/** Who supplies a collection's values: its own override, readable legacy keys or the defaults. */
export type SeoAdminTemplateOwner = "override" | "legacy" | "default";

export interface SeoAdminTemplateItem {
	collection: SeoTemplateCollection;
	label: string;
	description: string;
	source: SeoAdminTemplateOwner;
	values: SeoAdminTemplateValues;
	/**
	 * KV revisions of the legacy rows this collection's inheritance was read
	 * from; a save or reset that depends on inheritance must send them back.
	 */
	inheritanceGuard: SeoAdminTemplateInheritanceGuard;
	/** What the collection inherits without an override, which is what Reset gives. */
	inherited: {
		source: "legacy" | "default";
		values: SeoAdminTemplateValues;
		/** Legacy fields kept in storage but not used because they are invalid. */
		ignoredLegacyFields: SeoAdminTemplateField[];
	};
}

export interface SeoAdminTemplateConfiguration {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	storageVersion: typeof SEO_ADMIN_TEMPLATES_STORAGE_VERSION;
	engineVersion: string;
	state: SeoAdminTemplateState;
	/** KV revision a save or reset must name; null while the record is absent or unreadable. */
	revision: string | null;
	discovery: "available" | "unavailable";
	allowedVariables: string[];
	outputSupport: SeoAdminOutputSupport;
	/** Saved overrides kept for content types that are not template targets now. */
	retainedCollections: string[];
	/** Empty while the record is unreadable or discovery is unavailable. */
	items: SeoAdminTemplateItem[];
}

export type SeoAdminTemplateCommandFailure =
	| "invalid_input"
	| "collection_unavailable"
	| "corrupt"
	| "unavailable"
	| "unconfirmed";

export type SeoAdminTemplatesSaveResult =
	| {
			success: true;
			outcome: "saved" | "unchanged";
			collection: SeoTemplateCollection;
			/** Read after the command; null when that read failed, so the editor reads again. */
			templates: SeoAdminTemplateConfiguration | null;
	  }
	| { success: false; error: "invalid_values"; errors: SeoAdminTemplateErrors }
	| { success: false; error: "conflict"; message: string; templates: SeoAdminTemplateConfiguration | null }
	| { success: false; error: SeoAdminTemplateCommandFailure; message: string };

export interface SeoAdminTemplateExample {
	entryId: string;
	title: string;
	slug: string | null;
	locale: string;
	publishedAt: string | null;
	updatedAt: string | null;
}

export type SeoAdminTemplateExamplesResult =
	| {
			success: true;
			contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
			collection: SeoTemplateCollection;
			/** Published entries only, newest update first. */
			items: SeoAdminTemplateExample[];
			cursor?: string;
			hasMore: boolean;
	  }
	| {
			success: false;
			error: "invalid_input" | "collection_unavailable" | "content_unavailable" | "response_too_large";
			message: string;
	  };

/** Refusals of one exact example after its input was valid; each names that input. */
export type SeoAdminTemplateExampleFailure =
	| "collection_unavailable"
	| "content_unavailable"
	| "not_found"
	| "not_published"
	| "invalid_locale"
	| "response_too_large";

export type SeoAdminTemplateExampleResult =
	| {
			success: true;
			contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
			collection: SeoTemplateCollection;
			entryId: string;
			/** The exact published entry with the fields a listed option shows; its locale is never empty. */
			example: SeoAdminTemplateExample;
	  }
	| { success: false; error: SeoAdminTemplateExampleFailure; collection: SeoTemplateCollection; entryId: string; message: string }
	| { success: false; error: "invalid_input"; message: string };

export interface SeoAdminTemplatePreviewField {
	value: string;
	source: SeoAdminMetadataSource;
}

/** Shipit SEO's predicted tags for the published version of one exact entry. */
export interface SeoAdminTemplatePreview {
	collection: SeoTemplateCollection;
	entryId: string;
	locale: string;
	slug: string;
	status: "published";
	publishedAt: string | null;
	version: number | null;
	/** EmDash's public URL for the entry; the site's route and theme are not checked. */
	publicUrl: string;
	/** `description`; empty means the tag is not emitted. */
	description: SeoAdminTemplatePreviewField;
	/** `og:title` and `twitter:title`. */
	socialTitle: SeoAdminTemplatePreviewField;
	/** `og:description` and `twitter:description`. */
	socialDescription: SeoAdminTemplatePreviewField;
	/** Not applied to the document title, which the theme sets. */
	titleSuggestion: SeoAdminTemplatePreviewField;
	noindex: boolean;
}

export type SeoAdminTemplatePreviewFailure =
	| "invalid_input"
	| "collection_unavailable"
	| "templates_unreadable"
	| "settings_unreadable"
	| "content_unavailable"
	| "not_found"
	| "locale_mismatch"
	| "not_published"
	| "no_public_url"
	| "content_too_large"
	| "stored_value_too_large"
	| "expansion_too_large"
	| "response_too_large"
	| "entry_changed";

export type SeoAdminTemplatePreviewResult =
	| { success: true; preview: SeoAdminTemplatePreview }
	| { success: false; error: "invalid_values"; errors: SeoAdminTemplateErrors }
	| { success: false; error: SeoAdminTemplatePreviewFailure; message: string };

export type SeoAdminMetadataSource =
	| "legacy-override"
	| "plugin-social-override"
	| "core-seo"
	| "template"
	| "content"
	| "site-default"
	| "generated";

export interface SeoAdminEntryPreviewInput {
	ref: string;
	template?: SeoAdminTemplateValues;
}

/** The core SEO fields the published 1.1.0 SEO repository stores, in response order. */
export const SEO_ADMIN_OWNERSHIP_FIELDS = ["title", "description", "canonical", "image", "noIndex"] as const;
export type SeoAdminOwnershipFieldName = (typeof SEO_ADMIN_OWNERSHIP_FIELDS)[number];

/**
 * `conflict`: a legacy record decides the field with a value other than the
 * saved core value (including an empty core value). `equal`: it decides the
 * field with the saved core value. `not-shadowed`: the record holds no value
 * for the field. `unknown`: the facts could not be established.
 */
export type SeoAdminOwnershipFieldState = "conflict" | "equal" | "not-shadowed" | "unknown";

/** Why the whole ownership answer is not current. */
export type SeoAdminOwnershipEntryReason =
	| "saved-version-mismatch"
	| "saved-version-unavailable"
	| "core-seo-unavailable"
	| "core-seo-invalid"
	| "snapshot-seo-mismatch";

/** Why one field is unknown while the entry answer is otherwise current. */
export type SeoAdminOwnershipFieldReason =
	| SeoAdminOwnershipEntryReason
	| "legacy-read-incomplete"
	| "legacy-record-invalid"
	| "legacy-field-invalid"
	| "social-read-incomplete"
	| "social-record-invalid"
	| "effective-source-mismatch";

export type SeoAdminOwnershipValue = string | boolean | null;

export interface SeoAdminOwnershipField {
	field: SeoAdminOwnershipFieldName;
	state: SeoAdminOwnershipFieldState;
	/** The value stored in the host's saved SEO row; null when unset or unknown. */
	core: SeoAdminOwnershipValue;
	/** The value the legacy record holds for this field; null when it holds none or unknown. */
	legacy: SeoAdminOwnershipValue;
	/** The value the preview and Shipit's public contribution use; null when unknown. */
	effective: SeoAdminOwnershipValue;
	effectiveSource: SeoAdminMetadataSource | "site-setting" | "content-type-rule" | null;
	/** Title and description only: the social value, which a social override can decide instead. */
	social: { value: string; source: SeoAdminMetadataSource } | null;
	/** Present only when `state` is `unknown`. */
	reason?: SeoAdminOwnershipFieldReason;
}

export interface SeoAdminOwnershipDirectives {
	/** `present`: the record holds robots directives core SEO cannot store. */
	state: "none" | "present" | "unknown";
	tokens: string[];
}

/**
 * Saved per-field ownership of one entry, from the host's stored SEO row and
 * the legacy record the same preview read. `stale` means the host row is no
 * longer the saved version the request named; neither describes current output.
 */
export interface SeoAdminEntryOwnership {
	status: "current" | "stale" | "unknown";
	reason: SeoAdminOwnershipEntryReason | null;
	/** The host row's saved version these facts describe. */
	sourceVersion: string | null;
	/** The host row's own locale; null when the host stores none. */
	locale: string | null;
	/** The legacy record the preview resolved, with the key it was read under. */
	record: { sourceOverrideId: string; keyKind: "id" | "slug-alias" } | null;
	/** Always the five stored fields, in `SEO_ADMIN_OWNERSHIP_FIELDS` order. */
	fields: SeoAdminOwnershipField[];
	unsupportedDirectives: SeoAdminOwnershipDirectives;
}

/** Feature settings the browser checks need, read from the same module state as the server analysis. */
export interface SeoAdminEntryPreviewAnalysisSettings {
	imageAltChecks: boolean;
	schemaOutput: boolean;
	/** The entry's own robots directive asks for no text snippet. */
	nosnippet: boolean;
	/** The resolved description is the excerpt generated from the body text. */
	descriptionGenerated: boolean;
}

export interface SeoAdminEntryPreview {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	sourceVersion?: string;
	sourceKind?: "saved-snapshot";
	content: {
		ref: string;
		entryId: string;
		collection: SeoTemplateCollection;
		collectionLabel: string;
		title: string;
		slug: string;
	};
	search: {
		title: string;
		description: string;
		/** Resolved title when an entry-level SEO override is cleared. */
		fallbackTitle?: string;
		/** Resolved description when an entry-level SEO override is cleared. */
		fallbackDescription?: string;
		url: string;
		titleLength: number;
		descriptionLength: number;
		/** ISO publish date when the entry is published; drives the SERP date prefix. */
		publishedAt?: string | null;
	};
	social: {
		editing: SeoAdminSocialOverrideEditing;
		title: string;
		description: string;
		image: string | null;
		fallbackTitle: string;
		fallbackDescription: string;
		/** Resolved sharing image when the entry's own SEO image is cleared; null value means none. */
		fallbackImage?: { value: string | null; source: SeoAdminMetadataSource };
		override: {
			title: string | null;
			description: string | null;
			updatedAt: string | null;
		};
	};
	indexable: boolean;
	entryNoindex: boolean;
	/** Every noindex source in precedence order; absent from servers that predate it. */
	noindexSources?: SeoNoindexSource[];
	canonicalValidation: SeoCanonicalValidation;
	localeGraph: SeoLocaleGraphDiagnostic;
	schemaTypes: string[];
	sources: {
		title: SeoAdminMetadataSource;
		description: SeoAdminMetadataSource;
		socialTitle: SeoAdminMetadataSource;
		socialDescription: SeoAdminMetadataSource;
		canonical: SeoAdminMetadataSource;
		image: SeoAdminMetadataSource;
	};
	outputSupport: SeoAdminOutputSupport;
	ownership?: SeoAdminEntryOwnership;
	/** Absent from servers that predate it; browser checks then treat these settings as unknown. */
	analysis?: SeoAdminEntryPreviewAnalysisSettings;
}

export type SeoAdminEntryPreviewResult =
	| { success: true; preview: SeoAdminEntryPreview }
	| {
			success: false;
			error: "invalid_ref" | "content_unavailable" | "not_found" | "invalid_template";
			errors?: SeoAdminTemplateErrors;
	  };

export type SeoAdminMigrationPlanState =
	| "ready"
	| "conflict"
	| "empty"
	| "override-not-found"
	| "invalid-ref"
	| "unsupported-collection"
	| "content-not-found"
	| "identifier-lookup-unavailable"
	| "seo-disabled";

export interface SeoAdminMigrationSummary {
	total: number;
	ready: number;
	conflicts: number;
	empty: number;
	unresolved: number;
}

/** The complete serialized export, measured in UTF-8, is refused above this size. */
export const SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES = 2 * 1024 * 1024;
export const SEO_ADMIN_LEGACY_EXPORT_FORMAT = "shipit-seo-legacy-record-export" as const;
export const SEO_ADMIN_LEGACY_EXPORT_FORMAT_VERSION = 1 as const;

export type SeoAdminJsonValue =
	| null
	| boolean
	| number
	| string
	| SeoAdminJsonValue[]
	| { [key: string]: SeoAdminJsonValue };

/**
 * The document a snapshot carries, parsed. Every field comes from the one
 * resolved plan its fingerprint describes; `record` is the stored value unchanged.
 */
export interface SeoAdminLegacyRecordExport {
	format: typeof SEO_ADMIN_LEGACY_EXPORT_FORMAT;
	formatVersion: typeof SEO_ADMIN_LEGACY_EXPORT_FORMAT_VERSION;
	generatedAt: string;
	migrationVersion: typeof CORE_SEO_MIGRATION_VERSION;
	sourceOverrideId: string;
	/** The reference the plan resolved for the record. */
	reference: string;
	entry: { ref: string; collection: string; entryId: string; locale: string | null };
	conflictPolicy: CoreSeoMigrationConflictPolicy;
	fingerprint: string;
	record: SeoAdminJsonValue;
}

export type SeoAdminLegacyRecordSnapshotRefusal =
	| "not-exact-id"
	| "recovery-pending"
	| "record-missing"
	| "entry-unavailable"
	| "not-json"
	| "too-large";

/**
 * `document` is the exact serialized export and `bytes` its UTF-8 length, so
 * the download is the measured value. A refusal carries no partial record.
 */
export type SeoAdminLegacyRecordSnapshot =
	| { status: "available"; bytes: number; document: string }
	| { status: "refused"; reason: SeoAdminLegacyRecordSnapshotRefusal };

export interface SeoAdminMigrationPlanItem {
	sourceOverrideId: string;
	fingerprint: string;
	ref: string;
	collection?: string;
	entryId?: string;
	title?: string;
	state: SeoAdminMigrationPlanState;
	detail: string;
	plan?: CoreSeoMigrationPlan;
	/** Only on an opt-in request for one exact record with limit 1 and no cursor. */
	snapshot?: SeoAdminLegacyRecordSnapshot;
}

export type SeoAdminLegacyDiscardResult =
	| {
			success: true;
			contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
			engineVersion: string;
			sourceOverrideId: string;
			/** The removed record, so it can be kept outside the plugin. */
			discarded: Record<string, unknown>;
			/** What now supplies the entry's metadata. */
			nextOwner:
				| { kind: "legacy"; sourceOverrideId: string }
				| { kind: "core-seo" }
				| { kind: "plugin-defaults" };
	  }
	| {
			success: false;
			contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
			engineVersion: string;
			error: "invalid_input" | "confirmation_required" | "not_found" | "recovery_pending" | "preview_stale";
	  };

/** The host cannot delete the record conditionally, so the route refuses before reading it. */
export interface SeoAdminLegacyDiscardUnavailable {
	success: false;
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	error: "discard_unavailable";
}

/** Everything the discard route can return. */
export type SeoAdminLegacyDiscardResponse = SeoAdminLegacyDiscardResult | SeoAdminLegacyDiscardUnavailable;

export interface SeoAdminMigrationSelection {
	sourceOverrideId: string;
	fingerprint: string;
}

export interface SeoAdminMigrationPlanResponse {
	success: true;
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	migrationVersion: typeof CORE_SEO_MIGRATION_VERSION;
	writeAvailable: boolean;
	/** Whether this host can delete a reviewed record conditionally; independent of `writeAvailable`. */
	discardAvailable: boolean;
	/** Counts for this page of legacy records only. */
	summary: SeoAdminMigrationSummary;
	items: SeoAdminMigrationPlanItem[];
	/** Opaque token for the next page of legacy records. */
	cursor?: string;
	hasMore: boolean;
}

export type SeoAdminMigrationRecordStatus = "prepared" | "applied" | "rolled-back" | "failed";

export interface SeoAdminMigrationRecord {
	id: string;
	batchId: string;
	migrationVersion: typeof CORE_SEO_MIGRATION_VERSION;
	ref: string;
	collection: string;
	entryId: string;
	sourceOverrideId: string;
	sourceOverride: LegacySeoOverrideSnapshot;
	conflictPolicy: CoreSeoMigrationConflictPolicy;
	before: CoreSeoSnapshot;
	after: CoreSeoSnapshot;
	status: SeoAdminMigrationRecordStatus;
	createdAt: string;
	updatedAt: string;
	error?: string;
}

export interface SeoAdminMigrationStatusResponse {
	success: true;
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	migrationVersion: typeof CORE_SEO_MIGRATION_VERSION;
	writeAvailable: boolean;
	items: SeoAdminMigrationRecord[];
	cursor?: string | null;
	hasMore: boolean;
}

export type SeoAdminMigrationResultStatus =
	| SeoAdminMigrationPlanState
	| "applied"
	| "rolled-back"
	| "failed"
	| "changed-since-preview"
	| "changed-since-migration"
	| "override-conflict"
	| "partial-conflict"
	| "operation-busy"
	| `not-applied:${SeoAdminMigrationRecordStatus}`;

export interface SeoAdminMigrationOperationItem {
	ref: string;
	status: SeoAdminMigrationResultStatus;
	migrationId?: string;
	error?: string;
}

export interface SeoAdminMigrationOperationResponse {
	success: boolean;
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	batchId: string;
	migrationVersion: typeof CORE_SEO_MIGRATION_VERSION;
	summary: Record<string, number>;
	results: SeoAdminMigrationOperationItem[];
}

export type SeoAdminMigrationOperationResult =
	| SeoAdminMigrationOperationResponse
	| {
			success: false;
			contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
			engineVersion: string;
			generatedAt: string;
			migrationVersion: typeof CORE_SEO_MIGRATION_VERSION;
			error: "confirmation_required" | "content_write_unavailable";
			expected?: "MIGRATE_TO_CORE_SEO" | "ROLLBACK_CORE_SEO";
	  };

export type SeoModuleKey =
	| "seoAnalyzer"
	| "schema"
	| "sitemap"
	| "redirections"
	| "monitor404"
	| "analytics"
	| "localSeo"
	| "imageSeo"
	| "contentAi";

export type SeoModuleStatus =
	| "active"
	| "built-in"
	| "configured-elsewhere"
	| "core-managed"
	| "site-integration"
	| "planned";

export interface SeoAdminModuleDefinition {
	key: SeoModuleKey;
	label: string;
	description: string;
	defaultEnabled: boolean;
	status: SeoModuleStatus;
}

export const SEO_ADMIN_MODULE_DEFINITIONS: readonly SeoAdminModuleDefinition[] = [
	{
		key: "seoAnalyzer",
		label: "SEO Analyzer",
		description: "Content checks and site readiness run without a separate module switch.",
		defaultEnabled: false,
		status: "built-in",
	},
	{
		key: "schema",
		label: "Schema",
		description: "Built-in entities, content schema, breadcrumbs, and validated custom JSON-LD.",
		defaultEnabled: true,
		status: "active",
	},
	{
		key: "sitemap",
		label: "Sitemaps",
		description: "Serves /sitemap.xml from the Sitemaps choices on sites installed with the plugin's Astro integration, where it can be turned off to return the file to EmDash core. Elsewhere the setting is only kept.",
		defaultEnabled: true,
		status: "core-managed",
	},
	{
		key: "redirections",
		label: "Redirections",
		description: "EmDash core manages redirect rules; this plugin has no separate redirect switch.",
		defaultEnabled: false,
		status: "core-managed",
	},
	{
		key: "monitor404",
		label: "404 Monitor",
		description: "Records missing public paths that the site forwards to this plugin. Turn this on after connecting that site integration; EmDash does not forward paths automatically.",
		defaultEnabled: false,
		status: "site-integration",
	},
	{
		key: "analytics",
		label: "Analytics",
		description: "Search Console and analytics reporting have no provider connector yet.",
		defaultEnabled: false,
		status: "planned",
	},
	{
		key: "localSeo",
		label: "Local SEO",
		description: "Organization and LocalBusiness schema use Site identity and Schema settings.",
		defaultEnabled: false,
		status: "configured-elsewhere",
	},
	{
		key: "imageSeo",
		label: "Image alt checks",
		description:
			"Find missing alt attributes in saved content. Save, then reanalyze. Image fields stay unchanged.",
		defaultEnabled: true,
		status: "active",
	},
	{
		key: "contentAi",
		label: "Content AI",
		description: "Keyword recommendations and content briefs have no AI provider connector yet.",
		defaultEnabled: false,
		status: "planned",
	},
];

export type SeoAdminModuleValues = Record<SeoModuleKey, boolean>;
export type SeoAdminModuleErrors = Partial<Record<SeoModuleKey | "_form", string>>;
export type SeoAdminModuleValidation =
	| { success: true; values: SeoAdminModuleValues }
	| { success: false; errors: SeoAdminModuleErrors };

export interface SeoAdminModuleState extends SeoAdminModuleDefinition {
	enabled: boolean;
	editable: boolean;
	/**
	 * `native-sitemap`: this installation serves /sitemap.xml through Shipit SEO,
	 * so the Sitemaps module is reported `active` and can be switched.
	 */
	capability?: "native-sitemap";
}

export interface SeoAdminModuleConfiguration {
	storageVersion: typeof SEO_ADMIN_MODULES_STORAGE_VERSION;
	updatedAt: string | null;
	/** Storage revision a save or restore must name; null while no module record is stored. */
	revision: string | null;
	/** False when this host cannot write the module record with a revision check; Save and Restore are then off. */
	writable: boolean;
	items: SeoAdminModuleState[];
}

export type SeoAdminIndexNowQueueStatus = "pending" | "retry" | "delivered" | "failed";
export type SeoAdminIndexNowReason = "publish" | "update" | "unpublish" | "delete" | "manual";
export type SeoAdminIndexNowDeliveryStatus = "accepted" | "retry" | "failed";

export interface SeoAdminIndexNowJob {
	id: string;
	storageVersion: typeof SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION;
	url: string;
	ref: string | null;
	reason: SeoAdminIndexNowReason;
	status: SeoAdminIndexNowQueueStatus;
	attempts: number;
	nextAttemptAt: string | null;
	lastHttpStatus: number | null;
	lastError: string | null;
	lastSubmittedAt: string | null;
	createdAt: string;
	updatedAt: string;
	/** History entry that last queued this URL. Absent on jobs written before history existed. */
	submissionId?: string | null;
}

export interface SeoAdminIndexNowDelivery {
	id: string;
	storageVersion: typeof SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION;
	status: SeoAdminIndexNowDeliveryStatus;
	urlCount: number;
	urls: string[];
	httpStatus: number | null;
	attempt: number;
	detail: string;
	retryAt: string | null;
	createdAt: string;
}

export interface SeoAdminIndexNowStatus {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	protocolVersion: typeof INDEXNOW_PROTOCOL_VERSION;
	storageVersion: typeof SEO_ADMIN_INDEXNOW_STORAGE_VERSION;
	engineVersion: string;
	generatedAt: string;
	updatedAt: string | null;
	endpoint: typeof INDEXNOW_ENDPOINT;
	values: IndexNowSettingsValues;
	contentTypeDiscoveryAvailable: boolean;
	contentTypes: Array<{ collection: string; label: string }>;
	/**
	 * Public content types with a noindex rule in Indexing rules; their entries
	 * are never submitted. Absent while the rule or the content types cannot be read.
	 */
	contentTypeRules?: SeoAdminIndexNowContentTypeRule[];
	keyLocationUrl: string | null;
	manualSubmissionReady: boolean;
	readiness: {
		state: "ready" | "disabled" | "needs-setup" | "unavailable";
		title: string;
		description: string;
	};
	capabilities: {
		network: boolean;
		cron: boolean;
	};
	queue: {
		pending: number;
		retrying: number;
		failed: number;
		delivered: number;
		lastAcceptedAt: string | null;
	};
	jobs: SeoAdminIndexNowJob[];
	deliveries: SeoAdminIndexNowDelivery[];
	setup: SeoAdminIndexNowSetupState;
}

export interface SeoAdminIndexNowContentTypeRule {
	collection: string;
	label: string;
	/** The address pattern manual URLs are matched against, with the host default filled in. */
	urlPattern: string;
}

/** Installation and activation facts; the admin can read them but never widen them. */
export interface SeoAdminIndexNowSetupState {
	/** Origin IndexNow checks and submits for, when one is configured. */
	origin: string | null;
	installation: "astro" | "legacy" | "unknown";
	/** The installation may read the key file on `origin`. Null when the host cannot say. */
	hostPermission: boolean | null;
	keyRoute: IndexNowKeyRoute | null;
	keySaved: boolean;
	verifiedAt: string | null;
	issue: IndexNowSetupIssue | null;
}

export type SeoAdminIndexNowSetupStep = "origin" | "key" | "verify" | "enable";

export type SeoAdminIndexNowSaveResult =
	| { success: true; indexNow: SeoAdminIndexNowStatus }
	| { success: false; errors: IndexNowSettingsErrors; failedStep?: SeoAdminIndexNowSetupStep };

export type SeoAdminIndexNowAutomationAction = "start" | "stop" | "scope";

export interface SeoAdminIndexNowAutomationInput {
	expectedUpdatedAt: string | null;
	action: SeoAdminIndexNowAutomationAction;
	/** Null keeps the legacy all-eligible selection and is accepted only while it is saved. */
	contentTypes?: string[] | null;
}

/**
 * Full URL list of a history entry. `sample`: the entry holds every URL;
 * `pages`: stored detail pages; `expiring`: pages are being removed or were
 * never completed; `expired`: removed by the detail budget.
 */
export type SeoAdminIndexNowSubmissionDetail = "sample" | "pages" | "expiring" | "expired";

/**
 * One history entry per queue operation: a content event or a manual list.
 * Counts, source, event and the first URLs stay after the full list expires.
 */
export interface SeoAdminIndexNowSubmission {
	id: string;
	storageVersion: typeof SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION;
	source: IndexNowSubmissionSource;
	event: IndexNowSubmissionEvent | null;
	ref: string | null;
	urlCount: number;
	sampleUrls: string[];
	/** Positions in `sampleUrls` that were skipped as recently submitted. */
	sampleSkipped: number[];
	detail: SeoAdminIndexNowSubmissionDetail;
	counts: IndexNowSubmissionCounts;
	status: IndexNowSubmissionStatus;
	attempts: number;
	lastAttemptAt: string | null;
	lastHttpStatus: number | null;
	nextAttemptAt: string | null;
	lastDetail: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface SeoAdminIndexNowHistoryPage {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	available: boolean;
	filters: { status: IndexNowSubmissionStatus | null; source: IndexNowSubmissionSource | null };
	pageSize: number;
	total: number;
	items: SeoAdminIndexNowSubmission[];
	/** Continues only the same filters. */
	cursor: string | null;
	hasMore: boolean;
	maxAttempts: number;
	retention: number;
	/** Delivery records older than this predate source and event recording. */
	historyStartedAt: string | null;
}

/** A URL exactly as recorded when its entry was queued. */
export interface SeoAdminIndexNowHistoryUrl {
	url: string;
	/** Not queued because it was submitted within the resubmission interval. */
	skipped: boolean;
}

/** One stored detail page of an entry, never rebuilt from later queue state. */
export interface SeoAdminIndexNowHistoryUrlsPage {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	engineVersion: string;
	generatedAt: string;
	submissionId: string;
	detail: SeoAdminIndexNowSubmissionDetail;
	urlCount: number;
	page: number;
	pageCount: number;
	items: SeoAdminIndexNowHistoryUrl[];
}

export type SeoAdminIndexNowOperationError =
	| "coexistence_paused"
	| "indexnow_disabled"
	| "indexnow_not_configured"
	| "network_unavailable"
	| "no_valid_urls"
	| "no_due_jobs"
	| "delivery_in_progress"
	| "delivery_failed";

/** Whether the history entries of queued URLs were written. */
export type SeoAdminIndexNowHistoryRecording = "recorded" | "partial" | "unavailable";

export type SeoAdminIndexNowHistoryResult =
	| { success: true; history: SeoAdminIndexNowHistoryPage }
	| { success: false; error: "invalid_cursor"; detail: string };

export type SeoAdminIndexNowHistoryUrlsResult =
	| { success: true; urls: SeoAdminIndexNowHistoryUrlsPage }
	| { success: false; error: "not_found"; detail: string };

export type SeoAdminIndexNowOperationResult =
	| {
			success: true;
			enqueued: number;
			skipped: number;
			rejected: string[];
			/** Submitted URLs, as given, left out because a content type noindex rule matches their address. */
			contentTypeNoindexUrls?: string[];
			history?: SeoAdminIndexNowHistoryRecording;
			indexNow: SeoAdminIndexNowStatus;
	  }
	| {
			success: false;
			error: SeoAdminIndexNowOperationError;
			detail: string;
			indexNow?: SeoAdminIndexNowStatus;
	  };

export type SeoSchemaPresetKey = SchemaPresetKey;
export type SeoAdminSchemaPresetGroup = "core" | "content" | "rich";
export type SeoAdminSchemaPresetEmission = "automatic" | "data-required";

export interface SeoAdminSchemaPresetDefinition {
	key: SeoSchemaPresetKey;
	label: string;
	description: string;
	scope: string;
	group: SeoAdminSchemaPresetGroup;
	emission: SeoAdminSchemaPresetEmission;
	defaultEnabled: boolean;
}

export const SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS: readonly SeoAdminSchemaPresetDefinition[] = [
	{
		key: "organization",
		label: "Site publisher",
		description: "The Organization or Person selected in Local SEO.",
		scope: "Site-wide",
		group: "core",
		emission: "automatic",
		defaultEnabled: true,
	},
	{
		key: "website",
		label: "WebSite",
		description: "The canonical website entity for non-article pages.",
		scope: "Site-wide",
		group: "core",
		emission: "automatic",
		defaultEnabled: true,
	},
	{
		key: "webPage",
		label: "WebPage",
		description: "Adds a WebPage graph beside the main graph. Content types whose default is Web page emit it as their main graph without this switch.",
		scope: "Content types without a Web page default",
		group: "core",
		emission: "automatic",
		defaultEnabled: false,
	},
	{
		key: "blogPosting",
		label: "BlogPosting",
		description: "Article, publisher, author, and publication relationships.",
		scope: "Posts",
		group: "content",
		emission: "automatic",
		defaultEnabled: true,
	},
	{
		key: "service",
		label: "Service",
		description: "Service and provider entities for service content.",
		scope: "Services",
		group: "content",
		emission: "automatic",
		defaultEnabled: true,
	},
	{
		key: "breadcrumbList",
		label: "BreadcrumbList",
		description: "Breadcrumb paths when the page context supplies them.",
		scope: "Pages with breadcrumbs",
		group: "content",
		emission: "automatic",
		defaultEnabled: true,
	},
	{
		key: "person",
		label: "Person",
		description: "A named author or person with optional profile relationships.",
		scope: "Entries with person or author data",
		group: "content",
		emission: "data-required",
		defaultEnabled: false,
	},
	{
		key: "faqPage",
		label: "FAQPage",
		description: "Question and answer entities; rich-result eligibility is not implied.",
		scope: "Entries with complete FAQ items",
		group: "content",
		emission: "data-required",
		defaultEnabled: false,
	},
	{
		key: "localBusiness",
		label: "LocalBusiness",
		description: "A physical business entity with a complete postal address.",
		scope: "Entries with local business data",
		group: "rich",
		emission: "data-required",
		defaultEnabled: false,
	},
	{
		key: "product",
		label: "Product",
		description: "A product with image and a complete price offer.",
		scope: "Entries with product and offer data",
		group: "rich",
		emission: "data-required",
		defaultEnabled: false,
	},
	{
		key: "event",
		label: "Event",
		description: "A dated physical event with a named venue and postal address.",
		scope: "Entries with complete event data",
		group: "rich",
		emission: "data-required",
		defaultEnabled: false,
	},
	{
		key: "videoObject",
		label: "VideoObject",
		description: "A searchable video with thumbnail, upload date, and media URL.",
		scope: "Entries with complete video data",
		group: "rich",
		emission: "data-required",
		defaultEnabled: false,
	},
];

if (SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.length !== SCHEMA_PRESET_KEYS.length) {
	throw new Error("SEO schema preset definitions are out of sync with the schema engine.");
}

export type SeoAdminSchemaPresetValues = Record<SeoSchemaPresetKey, boolean>;
export type SeoAdminSchemaPresetErrors = Partial<Record<SeoSchemaPresetKey | "_form", string>>;
export type SeoAdminSchemaPresetValidation =
	| { success: true; values: SeoAdminSchemaPresetValues }
	| { success: false; errors: SeoAdminSchemaPresetErrors };

export interface SeoAdminSchemaPresetState extends SeoAdminSchemaPresetDefinition {
	enabled: boolean;
	/** False only when collection discovery succeeded and no content type is mapped to the preset's role. */
	applicable?: boolean;
}

export interface SeoAdminSchemaPresetConfiguration {
	revision: string | null;
	record: "absent" | "valid" | "invalid" | "unavailable";
	writable: boolean;
	storageVersion: typeof SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION;
	updatedAt: string | null;
	/** True only while presets resolve from a v1 snapshot or legacy preset keys. */
	migrationNeeded: boolean;
	items: SeoAdminSchemaPresetState[];
}

export interface SeoAdminCustomSchemaInput {
	id?: string;
	name: string;
	scope: string;
	json: string;
	enabled: boolean;
}

export type SeoAdminCustomSchemaWriteInput = Omit<SeoAdminCustomSchemaInput, "id"> & {
	id: string;
	expectedRevision: string | null;
};

export type SeoAdminSchemaComposerWriteInput = SeoSchemaComposerInput & {
	id: string;
	expectedRevision: string | null;
};

export interface SeoAdminCustomSchemaDeleteInput {
	id: string;
	expectedRevision: string;
}

export interface SeoAdminSchemaPresetsWriteInput {
	values: SeoAdminSchemaPresetValues;
	expectedRevision: string | null;
	replaceInvalid?: true;
}

export type SeoAdminCustomSchemaField = keyof SeoAdminCustomSchemaInput;
export type SeoAdminCustomSchemaErrors = Partial<
	Record<SeoAdminCustomSchemaField | "_form", string>
>;
export type SeoAdminCustomSchemaValidation =
	| { success: true; values: SeoAdminCustomSchemaInput }
	| { success: false; errors: SeoAdminCustomSchemaErrors };

export interface SeoAdminCustomSchema extends Required<SeoAdminCustomSchemaInput> {
	storageVersion: typeof SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION;
	types: string[];
	valid: boolean;
	validationError: string | null;
	createdAt: string;
	updatedAt: string;
	/** Present when one exact entry owns the record. */
	target?: EntrySchemaTarget;
}

export interface SeoAdminCustomSchemaSnapshot extends SeoAdminCustomSchema {
	revision: string;
}

export type SeoAdminCustomSchemaReadResult =
	| { success: true; id: string; state: "saved"; schema: SeoAdminCustomSchemaSnapshot }
	| { success: true; id: string; state: "absent"; schema: null }
	| { success: true; id: string; state: "invalid"; schema: null; revision: string }
	| { success: false; error: "invalid_input" | "unavailable"; message: string };

export type SeoAdminSchemaCommandError =
	| "invalid_input"
	| "invalid_values"
	| "conflict"
	| "unconfirmed"
	| "unavailable"
	| "not_found"
	| "limit_reached"
	| "invalid_record";

export interface SeoAdminSchemaCommandFailure<Errors, Current> {
	success: false;
	error: SeoAdminSchemaCommandError;
	message: string;
	errors: Errors;
	current?: Current;
}

export type SeoSchemaContentTypeRole = SchemaContentTypeRole;
export { SCHEMA_CONTENT_TYPE_ROLES as SEO_SCHEMA_CONTENT_TYPE_ROLES } from "./lib.ts";

export const SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS: Record<SeoSchemaContentTypeRole, string> = {
	none: "No type-specific schema",
	blogPosting: "Blog posting",
	service: "Service",
	webPage: "Web page",
};

/** Content type role per collection key. */
export type SeoAdminSchemaContentTypeValues = Record<string, SeoSchemaContentTypeRole>;
export type SeoAdminSchemaContentTypeErrors = Partial<Record<string, string>>;

export interface SeoAdminSchemaContentTypeItem {
	collection: string;
	label: string;
	role: SeoSchemaContentTypeRole;
	source: "saved" | "default";
}

/** A saved role this list cannot edit: its content type is not listed. It stays stored. */
export interface SeoAdminSchemaContentTypeUnlistedRole {
	collection: string;
	role: SeoSchemaContentTypeRole;
}

export const SEO_SCHEMA_CONTENT_TYPE_LIST_LIMIT = 100;

export interface SeoAdminSchemaContentTypeConfiguration {
	storageVersion: typeof SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION;
	updatedAt: string | null;
	/** Opaque host revision of the stored mapping; null while none is stored or storage is not versioned. */
	revision: string | null;
	/** "invalid": a record is stored but unreadable, and content pages get no role-owned graph from it. */
	record: "absent" | "valid" | "invalid";
	/** False when storage cannot guard writes by revision; changes are then refused. */
	writable: boolean;
	/** False when the site's content types could not be listed; saved roles are then in `unlisted`. */
	discoveryAvailable: boolean;
	/** Public, non-hidden, routable content types found; `items` holds at most the first 100. */
	discoveredCount: number;
	items: SeoAdminSchemaContentTypeItem[];
	unlisted: SeoAdminSchemaContentTypeUnlistedRole[];
}

export type SeoAdminSchemaContentTypesWriteError = "invalid" | "conflict" | "invalid_stored" | "unavailable" | "unconfirmed";

export type SeoAdminSchemaContentTypesSaveResult =
	| { success: true; contentTypes: SeoAdminSchemaContentTypeConfiguration }
	| {
		success: false;
		error: SeoAdminSchemaContentTypesWriteError;
		errors: SeoAdminSchemaContentTypeErrors;
		/** The stored mapping now, when it was read after a refusal. */
		current?: SeoAdminSchemaContentTypeConfiguration;
	};

/**
 * Whether the stored mapping now matches an operation whose outcome was not
 * confirmed: "applied" it does, "not_applied" the record still has the
 * revision the operation expected, "changed" it was changed otherwise.
 */
export type SeoAdminSchemaContentTypesCheck = "applied" | "not_applied" | "changed";

export interface SeoAdminSchemaContentTypesReadResult {
	contentTypes: SeoAdminSchemaContentTypeConfiguration;
	check?: SeoAdminSchemaContentTypesCheck;
}

export function validateSeoAdminSchemaContentTypeValues(
	input: unknown,
	availableCollections?: readonly string[],
): { success: true; values: SeoAdminSchemaContentTypeValues } | { success: false; errors: SeoAdminSchemaContentTypeErrors } {
	const source = record(input);
	if (!source) return { success: false, errors: { _form: "Content type schema must be an object." } };
	const entries = Object.entries(source);
	if (entries.length > 100) return { success: false, errors: { _form: "Map at most 100 content types." } };
	const available = availableCollections ? new Set(availableCollections) : null;
	const errors: SeoAdminSchemaContentTypeErrors = {};
	const values: SeoAdminSchemaContentTypeValues = {};
	for (const [collection, role] of entries) {
		if (!isSeoContentCollectionKey(collection)) errors._form = "Content type keys must be collection keys.";
		else if (available && !available.has(collection)) errors[collection] = "This content type is not available on this site.";
		else if (!(SCHEMA_CONTENT_TYPE_ROLES as readonly unknown[]).includes(role)) errors[collection] = "Choose a supported schema type.";
		else values[collection] = role as SeoSchemaContentTypeRole;
	}
	if (Object.keys(errors).length) return { success: false, errors };
	return { success: true, values };
}

export interface SeoAdminSchemaConfiguration {
	contentTypes: SeoAdminSchemaContentTypeConfiguration;
	presets: SeoAdminSchemaPresetConfiguration;
	customSchemaStorageVersion: typeof SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION;
	customSchemas: SeoAdminCustomSchema[];
	hasMore: boolean;
}

export interface SeoAdminConfiguration {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	configurationVersion: typeof SEO_ADMIN_CONFIGURATION_VERSION;
	engineVersion: string;
	modules: SeoAdminModuleConfiguration;
	schema: SeoAdminSchemaConfiguration;
}

export type SeoAdminModulesSaveResult =
	| { success: true; modules: SeoAdminModuleConfiguration }
	/** `conflict`: the stored record changed after the named revision; nothing was written. */
	| { success: false; conflict?: true; errors: SeoAdminModuleErrors };

export type SeoAdminSchemaPresetsSaveResult =
	| { success: true; changed: boolean; presets: SeoAdminSchemaPresetConfiguration }
	| SeoAdminSchemaCommandFailure<SeoAdminSchemaPresetErrors, SeoAdminSchemaPresetConfiguration>;

export type SeoAdminCustomSchemaSaveResult =
	| { success: true; changed: boolean; schema: SeoAdminCustomSchemaSnapshot }
	| SeoAdminSchemaCommandFailure<SeoAdminCustomSchemaErrors, SeoAdminCustomSchemaSnapshot | null>;

export type SeoAdminSchemaComposerSaveResult =
	| {
		success: true;
		changed: boolean;
		schema: SeoAdminCustomSchemaSnapshot;
		recipe: SeoSchemaComposerRecipe;
		json: string;
	}
	| SeoAdminSchemaCommandFailure<SeoSchemaComposerErrors | SeoAdminCustomSchemaErrors, SeoAdminCustomSchemaSnapshot | null>;

export type SeoAdminCustomSchemaDeleteResult =
	| { success: true; id: string }
	| SeoAdminSchemaCommandFailure<SeoAdminCustomSchemaErrors, SeoAdminCustomSchemaSnapshot | null>;

export type SeoPortabilityMode = "merge" | "replace";
export type SeoPortabilitySectionKey =
	| "settings"
	| "sitemap"
	| "modules"
	| "schemaPresets"
	| "templates"
	| "customSchemas"
	| "indexNow"
	| "schemaContentTypes"
	| "analysisProfiles";

export interface SeoPortabilityCustomSchema extends Omit<SeoAdminCustomSchemaInput, "id"> {
	id: string;
	target?: EntrySchemaTarget;
}

export interface SeoPortabilityIndexNowPolicy {
	autoSubmit: boolean;
	autoSubmitContentTypes: string[] | null;
	keyLocation: string;
	batchSize: number;
	minIntervalSeconds: number;
	maxAttempts: number;
}

export interface SeoPortabilityBundle {
	format: typeof SEO_PORTABILITY_FORMAT;
	version: typeof SEO_PORTABILITY_VERSION;
	exportedAt: string;
	engineVersion: string;
	source: {
		siteName: string;
		siteUrl: string;
	};
	safeguards: {
		secrets: "omitted";
		excluded: string[];
	};
	configuration: {
		settings: SeoAdminSettingsValues;
		sitemap: SeoAdminSitemapValues;
		modules: SeoAdminModuleValues;
		schemaPresets: SeoAdminSchemaPresetValues;
		templates: SeoAdminTemplateSet;
		customSchemas: SeoPortabilityCustomSchema[];
		indexNow: SeoPortabilityIndexNowPolicy;
		/** Absent in bundles exported before content type schema mapping existed. */
		schemaContentTypes?: SeoAdminSchemaContentTypeValues;
		/** Assessment purpose only; resource-use acknowledgement stays local. */
		analysisProfiles?: Record<string, { profile: "article" | "general"; version: 1 }>;
	};
}

export interface SeoPortabilitySectionPlan {
	key: SeoPortabilitySectionKey;
	label: string;
	changed: boolean;
	added: number;
	updated: number;
	unchanged: number;
	deleted: number;
}

export interface SeoPortabilityImportPlan {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	portabilityVersion: typeof SEO_PORTABILITY_VERSION;
	generatedAt: string;
	mode: SeoPortabilityMode;
	fingerprint: string;
	source: SeoPortabilityBundle["source"];
	target: {
		siteName: string;
		siteUrl: string;
	};
	summary: {
		changedSections: number;
		added: number;
		updated: number;
		unchanged: number;
		deleted: number;
		destructive: boolean;
		indexNowWillBeDisabled: boolean;
	};
	sections: SeoPortabilitySectionPlan[];
	warnings: string[];
	requiresConfirmation: true;
}

export interface SeoPortabilityExportResponse {
	contractVersion: typeof SEO_ADMIN_CONTRACT_VERSION;
	generatedAt: string;
	bundle: SeoPortabilityBundle;
	warnings: string[];
}

export type SeoPortabilityPreviewResult =
	| { success: true; plan: SeoPortabilityImportPlan; bundle: SeoPortabilityBundle }
	| { success: false; error: "invalid_bundle"; errors: string[] };

export type SeoPortabilityApplyResult =
	| {
		success: true;
		appliedAt: string;
		plan: SeoPortabilityImportPlan;
		backup: SeoPortabilityBundle;
	  }
	| {
			success: false;
			error:
				| "invalid_bundle"
				| "confirmation_required"
				| "preview_stale"
				| "apply_failed"
				| "rollback_conflict"
				| "rollback_failed";
			detail: string;
			errors?: string[];
			rollbackPerformed?: boolean;
	  };

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function defaultSeoAdminTemplateSet(
	collections: readonly string[] = SEO_ADMIN_TEMPLATE_DEFINITIONS.map(
		(definition) => definition.key,
	),
): SeoAdminTemplateSet {
	return Object.fromEntries(
		collections.map((collection) => {
			const defaults = DEFAULT_TEMPLATES[collection] ?? DEFAULT_TEMPLATES.pages;
			return [collection, { ...defaults }];
		}),
	);
}

export function isSeoContentCollectionKey(value: unknown): value is string {
	return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}

function validateTemplateText(
	input: Record<string, unknown>,
	collection: string,
	field: SeoAdminTemplateField,
	errors: SeoAdminTemplateErrors,
): string {
	const raw = input[field];
	const errorKey = `${collection}.${field}` as const;
	if (typeof raw !== "string") {
		errors[errorKey] = "Enter a text template.";
		return "";
	}
	const value = raw.trim();
	const required = field === "title" || field === "description";
	const maxLength = field === "title" || field === "socialTitle" ? 300 : 1_000;
	if (required && !value) errors[errorKey] = "This template is required.";
	else if (value.length > maxLength) errors[errorKey] = `Use ${maxLength} characters or fewer.`;
	else if (/[<>]/.test(value)) errors[errorKey] = "Templates must be plain text without markup.";
	else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
		errors[errorKey] = "Templates cannot contain control characters.";
	} else {
		const unknown = unknownTemplateVariables(value);
		if (unknown.length)
			errors[errorKey] = `Unknown variable: ${unknown.map((item) => `{{${item}}}`).join(", ")}.`;
		else {
			const withoutTokens = value.replace(/\{\{\s*[\w.]+\s*\}\}/g, "");
			if (withoutTokens.includes("{{") || withoutTokens.includes("}}")) {
				errors[errorKey] = "Fix the malformed template variable.";
			}
		}
	}
	return value;
}

export function validateSeoAdminTemplateValues(
	input: unknown,
	collection: string,
): SeoAdminTemplateValuesValidation {
	const source = record(input);
	if (!source) return { success: false, errors: { _form: "Template values must be an object." } };
	const errors: SeoAdminTemplateErrors = {};
	const values: SeoAdminTemplateValues = {
		title: validateTemplateText(source, collection, "title", errors),
		description: validateTemplateText(source, collection, "description", errors),
		socialTitle: validateTemplateText(source, collection, "socialTitle", errors),
		socialDescription: validateTemplateText(source, collection, "socialDescription", errors),
	};
	if (Object.keys(errors).length) return { success: false, errors };
	return { success: true, values };
}

export function validateSeoAdminTemplateSet(
	input: unknown,
	allowedCollections?: readonly string[],
): SeoAdminTemplateValidation {
	const source = record(input);
	if (!source) return { success: false, errors: { _form: "Template settings must be an object." } };
	const errors: SeoAdminTemplateErrors = {};
	const keys = allowedCollections ? [...allowedCollections] : Object.keys(source);
	if (
		keys.length === 0 ||
		keys.length > 100 ||
		keys.some((key) => !isSeoContentCollectionKey(key))
	) {
		return { success: false, errors: { _form: "Template collections are invalid." } };
	}
	if (allowedCollections && Object.keys(source).some((key) => !keys.includes(key))) {
		return {
			success: false,
			errors: { _form: "Template settings contain an unknown collection." },
		};
	}
	const values: SeoAdminTemplateSet = {};
	for (const key of keys) {
		const validation = validateSeoAdminTemplateValues(source[key], key);
		if (!validation.success) Object.assign(errors, validation.errors);
		else values[key] = validation.values;
	}
	if (Object.keys(errors).length) return { success: false, errors };
	return { success: true, values };
}

export function seoModuleIsEditable(status: SeoModuleStatus): boolean {
	return status === "active" || status === "site-integration";
}

export function seoModuleCanRun(key: SeoModuleKey): boolean {
	return key === "schema" || key === "sitemap" || key === "monitor404" || key === "imageSeo";
}

export function validateSeoAdminModuleValues(input: unknown): SeoAdminModuleValidation {
	const source = record(input);
	if (!source) return { success: false, errors: { _form: "Module settings must be an object." } };

	const errors: SeoAdminModuleErrors = {};
	const values = {} as SeoAdminModuleValues;
	for (const definition of SEO_ADMIN_MODULE_DEFINITIONS) {
		const value = source[definition.key];
		if (typeof value !== "boolean") {
			errors[definition.key] = "Choose an enabled or disabled state.";
			continue;
		}
		if (value && !seoModuleCanRun(definition.key)) {
			errors[definition.key] = "This module has no separate switch in this EmDash setup.";
		}
		values[definition.key] = value;
	}
	if (Object.keys(errors).length) return { success: false, errors };
	return { success: true, values };
}

export function validateSeoAdminSchemaPresetValues(input: unknown): SeoAdminSchemaPresetValidation {
	const source = record(input);
	if (!source)
		return { success: false, errors: { _form: "Schema preset settings must be an object." } };

	const errors: SeoAdminSchemaPresetErrors = {};
	const values = {} as SeoAdminSchemaPresetValues;
	for (const definition of SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS) {
		const value = source[definition.key];
		if (typeof value !== "boolean") errors[definition.key] = "Choose an enabled or disabled state.";
		else values[definition.key] = value;
	}
	if (Object.keys(errors).length) return { success: false, errors };
	return { success: true, values };
}

export function validateSeoAdminCustomSchemaInput(input: unknown): SeoAdminCustomSchemaValidation {
	const source = record(input);
	if (!source) return { success: false, errors: { _form: "Custom schema must be an object." } };

	const errors: SeoAdminCustomSchemaErrors = {};
	let id: string | undefined;
	if (source.id !== undefined) {
		if (
			typeof source.id !== "string" ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.id.trim())
		) {
			errors.id = "The schema identifier is invalid.";
		} else id = source.id.trim();
	}

	const name = typeof source.name === "string" ? source.name.trim() : "";
	if (!name) errors.name = "Enter a schema name.";
	else if (name.length > 120) errors.name = "Use 120 characters or fewer.";

	const scope = typeof source.scope === "string" ? source.scope.trim() : "";
	if (!isSeoAdminSchemaScope(scope)) {
		errors.scope = "Choose All pages, a content type, or one entry.";
	}

	const json = typeof source.json === "string" ? source.json.trim() : "";
	if (!json) errors.json = "Enter JSON-LD data.";
	else if (json.length > 100_000) errors.json = "Use 100,000 characters or fewer.";
	else {
		try {
			validateCustomJsonLd(json);
		} catch (error: unknown) {
			errors.json = error instanceof Error ? error.message : "Enter valid JSON-LD data.";
		}
	}

	if (typeof source.enabled !== "boolean") errors.enabled = "Choose an enabled or disabled state.";
	if (Object.keys(errors).length) return { success: false, errors };
	return {
		success: true,
		values: {
			...(id ? { id } : {}),
			name,
			scope,
			json,
			enabled: source.enabled as boolean,
		},
	};
}

function textValue(
	input: Record<string, unknown>,
	field: SeoAdminSettingsField,
	maxLength: number,
	errors: SeoAdminSettingsErrors,
	required = false,
): string {
	const raw = input[field];
	if (typeof raw !== "string") {
		errors[field] = "Enter a text value.";
		return "";
	}
	const value = raw.trim();
	if (required && !value) errors[field] = "This field is required.";
	else if (value.length > maxLength) errors[field] = `Use ${maxLength} characters or fewer.`;
	return value;
}

function httpUrl(
	value: string,
	field: SeoAdminSettingsField,
	errors: SeoAdminSettingsErrors,
	originOnly = false,
): string {
	if (!value) return "";
	try {
		const parsed = new URL(value);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
		if (parsed.username || parsed.password) throw new Error("credentials");
		if (originOnly && (parsed.pathname !== "/" || parsed.search || parsed.hash)) {
			errors[field] = "Use the site origin only, for example https://example.com.";
			return value;
		}
		return originOnly ? parsed.origin : parsed.toString();
	} catch {
		errors[field] = "Enter an absolute http(s) URL.";
		return value;
	}
}

function isLocalMediaPath(value: string): boolean {
	const mediaPrefix = "/_emdash/api/media/file/";
	if (!value.startsWith(mediaPrefix) || value.length <= mediaPrefix.length) return false;
	try {
		const parsed = new URL(value, "https://example.invalid");
		return parsed.pathname === value && !parsed.search && !parsed.hash;
	} catch {
		return false;
	}
}

function imageUrl(
	value: string,
	field: "defaultSocialImage" | "organizationLogo",
	errors: SeoAdminSettingsErrors,
): string {
	if (value.startsWith("/")) {
		if (isLocalMediaPath(value)) return value;
		errors[field] = "Choose an image from the media library or enter an absolute http(s) URL.";
		return value;
	}
	return httpUrl(value, field, errors);
}

function profileUrls(
	source: Record<string, unknown>,
	field: "socialProfiles" | "personProfiles",
	errors: SeoAdminSettingsErrors,
): string[] {
	const values: string[] = [];
	const rawProfiles = source[field] ?? (field === "personProfiles" ? [] : null);
	if (!Array.isArray(rawProfiles)) {
		errors[field] = "Provide a list of profile URLs.";
	} else if (rawProfiles.length > 25) {
		errors[field] = "Use no more than 25 profile URLs.";
	} else {
		for (const raw of rawProfiles) {
			if (typeof raw !== "string" || !raw.trim()) continue;
			const candidateErrors: SeoAdminSettingsErrors = {};
			const normalized = httpUrl(raw.trim(), field, candidateErrors);
			if (candidateErrors[field]) {
				errors[field] = "Every profile must be an absolute http(s) URL.";
				continue;
			}
			if (!values.includes(normalized)) values.push(normalized);
		}
	}
	return values;
}

export function validateSeoContentScoringChange(input: unknown): SeoAdminContentScoringValidation {
	const source = record(input);
	const allowed = new Set(["contentScoringEnabled", "expectedContentScoringEnabled", "expectedRevision", "expectedLegacyGuard", "resourceNoticeVersion"]);
	if (!source || Object.keys(source).some((key) => !allowed.has(key))) {
		return { success: false, errors: { _form: "Submit only the content scoring setting and its activation guard." } };
	}
	if (typeof source.contentScoringEnabled !== "boolean" || typeof source.expectedContentScoringEnabled !== "boolean") {
		return { success: false, errors: { contentScoringEnabled: "Choose a valid content scoring state." } };
	}
	const guard = validateSeoAdminSettingsWriteGuard(source);
	if (!guard.success) return guard;
	if (source.contentScoringEnabled && source.resourceNoticeVersion !== CONTENT_SCORING_RESOURCE_NOTICE_VERSION) {
		return { success: false, errors: { contentScoringEnabled: "Review and acknowledge the current resource-use notice before enabling analysis." } };
	}
	if (source.resourceNoticeVersion !== undefined && source.resourceNoticeVersion !== CONTENT_SCORING_RESOURCE_NOTICE_VERSION) {
		return { success: false, errors: { contentScoringEnabled: "The resource-use notice changed. Reload and review it before continuing." } };
	}
	return {
		success: true,
		values: {
			contentScoringEnabled: source.contentScoringEnabled,
			expectedContentScoringEnabled: source.expectedContentScoringEnabled,
			...guard.guard,
			...(source.resourceNoticeVersion === undefined ? {} : { resourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION }),
		},
	};
}

export function validateSeoAdminSettings(input: unknown): SeoAdminSettingsValidation {
	const source = record(input);
	if (!source) return { success: false, errors: { _form: "Settings must be an object." } };

	const errors: SeoAdminSettingsErrors = {};
	const customTags = Object.hasOwn(source, "customVerificationTags")
		? validateCustomVerificationTags(source.customVerificationTags) : null;
	if (customTags && !customTags.success) errors.customVerificationTags = customTags.error;
	const taxonomyArchives = Object.hasOwn(source, "taxonomyArchiveNoindex")
		? validateTaxonomyArchiveNoindex(source.taxonomyArchiveNoindex) : null;
	if (taxonomyArchives && !taxonomyArchives.success) errors.taxonomyArchiveNoindex = taxonomyArchives.error;
	const contentTypes = Object.hasOwn(source, "contentTypeNoindex")
		? validateContentTypeNoindex(source.contentTypeNoindex) : null;
	if (contentTypes && !contentTypes.success) errors.contentTypeNoindex = contentTypes.error;
	const siteName = textValue(source, "siteName", 120, errors, true);
	const siteUrl = httpUrl(textValue(source, "siteUrl", 2048, errors), "siteUrl", errors, true);
	const publisherType = source.publisherType === undefined ? "organization" : source.publisherType;
	if (publisherType !== "organization" && publisherType !== "person") {
		errors.publisherType = "Choose Organization or Person.";
	}
	const organizationNameInput = textValue(source, "organizationName", 160, errors);
	const personName = source.personName === undefined ? "" : textValue(source, "personName", 160, errors);
	if (publisherType === "person" && !personName) errors.personName = "Enter the person's name.";
	const organizationLogo = imageUrl(
		textValue(source, "organizationLogo", 2048, errors),
		"organizationLogo",
		errors,
	);
	const defaultSocialImage = imageUrl(
		textValue(source, "defaultSocialImage", 2048, errors),
		"defaultSocialImage",
		errors,
	);

	const socialProfiles = profileUrls(source, "socialProfiles", errors);
	const personProfiles = profileUrls(source, "personProfiles", errors);

	let twitterHandle = textValue(source, "twitterHandle", 16, errors);
	if (twitterHandle && !twitterHandle.startsWith("@")) twitterHandle = `@${twitterHandle}`;
	if (twitterHandle && !/^@[A-Za-z0-9_]{1,15}$/.test(twitterHandle)) {
		errors.twitterHandle = "Use a valid X handle with up to 15 letters, numbers, or underscores.";
	}

	if (typeof source.noindex !== "boolean") errors.noindex = "Choose an indexing state.";
	const contentScoringEnabled = source.contentScoringEnabled === undefined
		? true
		: source.contentScoringEnabled;
	if (typeof contentScoringEnabled !== "boolean")
		errors.contentScoringEnabled = "Choose whether content scoring is enabled.";

	if (Object.keys(errors).length) return { success: false, errors };
	return {
		success: true,
		values: {
			...(customTags?.success ? { customVerificationTags: customTags.tags } : {}),
			...(taxonomyArchives?.success ? { taxonomyArchiveNoindex: taxonomyArchives.names } : {}),
			...(contentTypes?.success ? { contentTypeNoindex: contentTypes.names } : {}),
			siteName,
			siteUrl,
			publisherType: publisherType as SeoAdminPublisherType,
			organizationName: organizationNameInput || siteName,
			organizationLogo,
			personName,
			socialProfiles,
			personProfiles,
			defaultSocialImage,
			twitterHandle,
			noindex: source.noindex as boolean,
			contentScoringEnabled: contentScoringEnabled as boolean,
		},
	};
}

function normalizeSitemapPath(input: string): string | null {
	const value = input.trim();
	if (!value || value.length > 512 || !value.startsWith("/") || value.startsWith("//")) return null;
	if (
		value.includes("\\") ||
		value.includes("?") ||
		value.includes("#") ||
		value.includes("*") ||
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		return null;
	}
	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return null;
	}
	if (decoded.includes("\\") || decoded.includes("//") || /[\u0000-\u001f\u007f]/.test(decoded))
		return null;
	if (decoded.split("/").some((segment) => segment === "." || segment === "..")) return null;
	return value === "/" ? value : value.replace(/\/+$/, "");
}

export function validateSeoAdminSitemapValues(
	input: unknown,
	requiredContentTypes?: readonly string[],
): SeoAdminSitemapValidation {
	const source = record(input);
	if (!source) return { success: false, errors: { _form: "Sitemap settings must be an object." } };

	const errors: SeoAdminSitemapErrors = {};
	const contentTypesSource = record(source.contentTypes);
	const contentTypes = {} as SeoAdminSitemapValues["contentTypes"];
	if (!contentTypesSource) {
		errors.contentTypes = "Choose which content types belong in the sitemap.";
	} else {
		const keys = requiredContentTypes ? [...requiredContentTypes] : Object.keys(contentTypesSource);
		if (
			keys.length === 0 ||
			keys.length > 101 ||
			keys.some(
				(key) => key !== SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY && !isSeoContentCollectionKey(key),
			)
		) {
			errors.contentTypes = "Sitemap content types are invalid.";
		}
		if (
			requiredContentTypes &&
			Object.keys(contentTypesSource).some((key) => !keys.includes(key))
		) {
			errors.contentTypes = "Sitemap settings contain an unknown content type.";
		}
		for (const key of keys) {
			if (typeof contentTypesSource[key] !== "boolean") {
				errors.contentTypes = "Every sitemap content type must have an enabled or disabled state.";
			} else {
				contentTypes[key] = contentTypesSource[key] as boolean;
			}
		}
	}

	const excludedPaths: string[] = [];
	if (!Array.isArray(source.excludedPaths)) {
		errors.excludedPaths = "Provide a list of exact site paths.";
	} else if (source.excludedPaths.length > 100) {
		errors.excludedPaths = "Use no more than 100 excluded paths.";
	} else {
		for (const raw of source.excludedPaths) {
			if (typeof raw !== "string" || !raw.trim()) continue;
			const normalized = normalizeSitemapPath(raw);
			if (!normalized) {
				errors.excludedPaths =
					"Use exact site paths such as /thank-you. URLs, wildcards, queries and parent segments are not allowed.";
				continue;
			}
			if (!excludedPaths.includes(normalized)) excludedPaths.push(normalized);
		}
	}

	if (Object.keys(errors).length) return { success: false, errors };
	return { success: true, values: { contentTypes, excludedPaths } };
}
