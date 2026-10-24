import { validSeoBodyMapping } from "../content-body-mapping.ts";
import { isStoredCustomVerificationTags } from "../custom-verification-tags.ts";
import { isStoredTaxonomyArchiveNoindex } from "../taxonomy-archive-policy.ts";
import { isStoredContentTypeNoindex } from "../content-type-noindex-policy.ts";
import { SEO_NOINDEX_SOURCES } from "../analysis.ts";
import { composeSeoSchema } from "../schema-composer.ts";
import {
	CORE_SEO_MIGRATION_VERSION,
	CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
	INDEXNOW_ENDPOINT,
	INDEXNOW_HISTORY_MAX_PAGE_SIZE,
	INDEXNOW_HISTORY_SAMPLE_URLS,
	INDEXNOW_HISTORY_URL_PAGE_SIZE,
	INDEXNOW_MANUAL_URL_LIMIT,
	INDEXNOW_PROTOCOL_VERSION,
	INDEXNOW_SUBMISSION_BUCKETS,
	INDEXNOW_SUBMISSION_STATUSES,
	indexNowSubmissionStatus,
	SEO_ADMIN_CONFIGURATION_VERSION,
	SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_LEGACY_EXPORT_FORMAT,
	SEO_ADMIN_LEGACY_EXPORT_FORMAT_VERSION,
	SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES,
	SEO_ADMIN_OWNERSHIP_FIELDS,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH,
	SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION,
	SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
	SEO_ADMIN_MODULES_STORAGE_VERSION,
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	SEO_SCHEMA_CONTENT_TYPE_LIST_LIMIT,
	SEO_SCHEMA_CONTENT_TYPE_ROLES,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION,
	SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH,
	SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
	SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH,
	SEO_ADMIN_LEGACY_SETTINGS_GUARD_PATTERN,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY,
	SEO_ADMIN_SITEMAP_STORAGE_VERSION,
	SEO_SITEMAP_AVAILABILITY,
	SEO_LLMS_TXT_CORRUPT_REASONS,
	SEO_LLMS_TXT_OWNERS,
	SEO_ROBOTS_TXT_OWNERS,
	SEO_SITEMAP_OWNERS,
	SITEMAP_ENTRY_STATUSES,
	SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	SEO_SCORE_VERSION,
	SEO_PORTABILITY_FORMAT,
	SEO_PORTABILITY_VERSION,
	SEO_CANONICAL_STATUSES,
	SEO_LOCALE_GRAPH_ISSUE_CODES,
	SEO_LOCALE_GRAPH_STATUSES,
	SEO_CRAWL_DIAGNOSTICS_VERSION,
	isSeoContentCollectionKey,
	isSeoSchemaComposerRecipe,
	seoKeywordIdentity,
	seoContentCheckProblem,
	currentSeoScoreAssessmentProblem,
	seoScoreBand,
	seoScoreBandLabel,
	seoModuleCanRun,
	seoModuleIsEditable,
	type SeoAdminConfiguration,
	type SeoAdmin404Monitor,
	type SeoAdmin404TriageResult,
	type SeoAdminCrawlDiagnostics,
	type SeoAdminContentOptions,
	type SeoAdminContentAudit,
	type SeoAdminContentAuditOptions,
	type SeoAdminContentScore,
	type SeoAdminContentScores,
	type SeoAdminEntryAnalysisIdentityResult,
	type SeoAdminSavedAnalysisResult,
	type SeoAdminScoreScanCommand,
	type SeoAdminScoreScanResult,
	type SeoAdminScoreScanStateResult,
	type SeoAdminScoreScanTaxonomiesResult,
	type SeoAdminScoreScanTermsResult,
	type SeoAdminEntryDirectivesResult,
	type SeoAdminEntrySchemaPreviewResult,
	type SeoAdminFocusKeywordSaveResult,
	type SeoAdminAnalysisProfileResult,
	type SeoAdminCustomSchema,
	type SeoAdminCustomSchemaSnapshot,
	type SeoAdminCustomSchemaReadResult,
	type SeoAdminCustomSchemaWriteInput,
	type SeoAdminSchemaComposerWriteInput,
	type SeoAdminSchemaPresetsWriteInput,
	type SeoAdminSchemaCommandError,
	validateSeoAdminCustomSchemaInput,
	type SeoAdminCustomSchemaDeleteResult,
	type SeoAdminCustomSchemaSaveResult,
	type SeoAdminModuleConfiguration,
	type SeoAdminLegacyDiscardResponse,
	type SeoAdminLegacyDiscardResult,
	type SeoAdminMigrationOperationResult,
	type SeoAdminMigrationPlanResponse,
	type SeoAdminMigrationStatusResponse,
	type SeoAdminModulesSaveResult,
	type SeoAdminOverview,
	type SeoAdminRefreshResult,
	type SeoAdminSchemaPresetConfiguration,
	type SeoAdminSchemaPresetsSaveResult,
	type SeoAdminSchemaContentTypeConfiguration,
	type SeoAdminSchemaContentTypesCheck,
	type SeoAdminSchemaContentTypesReadResult,
	type SeoAdminSchemaContentTypesSaveResult,
	type SeoAdminSchemaContentTypesWriteError,
	type SeoAdminSchemaComposerSaveResult,
	type SeoAdminScoreTrends,
	type SeoAdminSettings,
	type SeoAdminContentScoringPolicy,
	type SeoAdminCollectionAnalysisProfileSelection,
	type SeoAdminCollectionAnalysisProfileResult,
	type SeoAdminCollectionAnalysisProfileSaveResult,
	type SeoAdminSettingsSaveResult,
	type SeoAdminSettingsValues,
	type SeoAdminLlmsTxt,
	type SeoAdminLlmsTxtWriteResult,
	type SeoAdminRobotsTxtFacts,
	type SeoAdminSitemapConfiguration,
	type SeoAdminSitemapPreview,
	type SeoAdminSitemapSaveResult,
	type SeoAdminSitemapValues,
	type SeoAdminEntryPreview,
	type SeoAdminEntryPreviewResult,
	type SeoAdminSocialOverrideSaveResult,
	type SeoAdminSocialOverrideReadResult,
	type SeoAdminSocialOverrideSnapshot,
	type SeoAdminIndexNowHistoryResult,
	type SeoAdminIndexNowHistoryUrlsResult,
	type SeoAdminIndexNowOperationResult,
	type SeoAdminIndexNowSaveResult,
	type SeoAdminIndexNowStatus,
	type SeoAdminIndexNowSubmission,
	type SeoAdminOutputSupport,
	type SeoAdminTemplateConfiguration,
	type SeoAdminTemplateExampleResult,
	type SeoAdminTemplateExamplesResult,
	type SeoAdminTemplateInheritanceGuard,
	type SeoAdminTemplatePreviewResult,
	type SeoAdminTemplatesSaveResult,
	type SeoAdminTemplateValues,
	type SeoPortabilityApplyResult,
	type SeoPortabilityBundle,
	type SeoPortabilityExportResponse,
	type SeoPortabilityImportPlan,
	type SeoPortabilityPreviewResult,
	type IndexNowSettingsValues,
	REDIRECT_GROUP_MAX_LENGTH,
	REDIRECT_LIST_MAX_PAGE_SIZE,
	REDIRECT_SEARCH_MAX_LENGTH,
	type RedirectRule,
	type RedirectRuleFieldErrors,
	type RedirectRuleListQuery,
	type SeoAdminRedirectRuleCreateResult,
	type SeoAdminRedirectRuleListResult,
	type EntryCustomSchema,
	type EntryCustomSchemaSummary,
	type EntryInheritedSchema,
	type SeoAdminEntrySchemaListResult,
	type SeoAdminEntrySchemaRemoveResult,
	type SeoAdminEntrySchemaSaveResult,
	ENTRY_SCHEMA_CANDIDATE_MAX_BYTES,
	ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES,
	SEO_ADMIN_SCHEMA_LIBRARY_LIMITS,
	parseSchemaLibraryRecord,
	type SeoAdminEntrySchemaCandidateFailure,
	type SeoAdminEntrySchemaCandidatePreviewResult,
	type SeoAdminSchemaLibrary,
	type SeoAdminSchemaLibraryWriteResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

const SCORE_REFRESH_REVISION_PATTERN = /^sha256-[a-f0-9]{64}$/;

import {
	BUSINESS_IDENTITY_STORAGE_VERSION,
	validateBusinessIdentityRecord,
	type BusinessIdentityRecord,
} from "../business-identity.ts";
import {
	LLMS_TXT_DOCUMENT_MAX_BYTES,
	LLMS_TXT_STORED_COPY_MAX_BYTES,
	LLMS_TXT_WRITE_REQUEST_MAX_BYTES,
	checkLlmsTxtActivation,
	checkLlmsTxtDocument,
	llmsTxtUtf8Bytes,
} from "../llms-txt-document.ts";
import {
	PUBLISHER_OWNERSHIP_LISTED_DEFINITIONS,
	PUBLISHER_OWNERSHIP_MODES,
	PUBLISHER_OWNERSHIP_STORAGE_VERSION,
	type PublisherOwnershipCheck,
	type PublisherOwnershipEffective,
	type PublisherOwnershipPreflight,
	type PublisherOwnershipView,
	type PublisherOwnershipWriteError,
	type PublisherOwnershipWriteResult,
} from "../publisher-ownership.ts";
import type {
	BusinessIdentityCheck,
	BusinessIdentityPageCandidate,
	BusinessIdentityTargetStatus,
	BusinessIdentityView,
	BusinessIdentityWriteError,
	BusinessIdentityWriteResult,
} from "../business-identity-commands.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractError(field: string): never {
	throw new Error(`Invalid SEO admin response: ${field}`);
}

function assertContractVersion(value: Record<string, unknown>, field: string): void {
	if (value.contractVersion === SEO_ADMIN_CONTRACT_VERSION) return;
	const received =
		typeof value.contractVersion === "number" || typeof value.contractVersion === "string"
			? String(value.contractVersion)
			: "missing";
	throw new Error(
		`SEO engine/admin mismatch: expected contract ${SEO_ADMIN_CONTRACT_VERSION}, received ${received}. ` +
			`Restart EmDash after rebuilding plugins, or install matching SEO engine and admin versions. (${field})`,
	);
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
	return (
		typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
	);
}

function nonNegativeInteger(value: unknown): value is number {
	return integerInRange(value, 0, Number.MAX_SAFE_INTEGER);
}

function parseLocaleGraph(value: unknown, field: string): void {
	if (
		!isRecord(value) ||
		value.owner !== "emdash-core" ||
		value.emitsMarkup !== false ||
		!(SEO_LOCALE_GRAPH_STATUSES as readonly unknown[]).includes(value.status) ||
		typeof value.hostSupportsTranslationGroups !== "boolean" ||
		(value.currentLocale !== null && typeof value.currentLocale !== "string") ||
		(value.defaultLocale !== null && typeof value.defaultLocale !== "string") ||
		(value.translationGroup !== null && typeof value.translationGroup !== "string") ||
		!Array.isArray(value.discoveredLocales) ||
		!value.discoveredLocales.every((locale) => typeof locale === "string") ||
		(value.xDefaultLocale !== null && typeof value.xDefaultLocale !== "string") ||
		!Array.isArray(value.alternates) ||
		!Array.isArray(value.issues)
	)
		contractError(field);

	for (const alternate of value.alternates) {
		if (
			!isRecord(alternate) ||
			typeof alternate.entryId !== "string" ||
			typeof alternate.locale !== "string" ||
			(alternate.url !== null && typeof alternate.url !== "string") ||
			typeof alternate.isCurrent !== "boolean" ||
			typeof alternate.isDefault !== "boolean"
		)
			contractError(`${field}.alternates`);
	}

	for (const issue of value.issues) {
		if (
			!isRecord(issue) ||
			!(SEO_LOCALE_GRAPH_ISSUE_CODES as readonly unknown[]).includes(issue.code) ||
			!(["info", "warning", "error"] as readonly unknown[]).includes(issue.severity) ||
			typeof issue.message !== "string" ||
			(issue.locale !== null && typeof issue.locale !== "string")
		)
			contractError(`${field}.issues`);
	}
}

export function parseSeoAdminCrawlDiagnostics(value: unknown): SeoAdminCrawlDiagnostics {
	if (!isRecord(value)) contractError("crawlDiagnostics.root");
	assertContractVersion(value, "crawlDiagnostics.contractVersion");
	if (
		typeof value.engineVersion !== "string" ||
		!validTimestamp(value.generatedAt) ||
		value.diagnosticsVersion !== SEO_CRAWL_DIAGNOSTICS_VERSION ||
		!(value.coverage === "complete" || value.coverage === "partial") ||
		!isRecord(value.summary) ||
		!nonNegativeInteger(value.summary.scannedEntries) ||
		!nonNegativeInteger(value.summary.indexableEntries) ||
		!nonNegativeInteger(value.summary.knownRoutes) ||
		!nonNegativeInteger(value.summary.scannedLinks) ||
		!nonNegativeInteger(value.summary.matchedInternalLinks) ||
		!nonNegativeInteger(value.summary.unresolvedInternalLinks) ||
		!nonNegativeInteger(value.summary.possibleOrphans) ||
		!nonNegativeInteger(value.summary.structuredSources) ||
		!nonNegativeInteger(value.summary.partialSources) ||
		!Array.isArray(value.unresolvedLinks) ||
		!Array.isArray(value.orphanEntries)
	)
		contractError("crawlDiagnostics");
	for (const item of value.unresolvedLinks) {
		if (
			!isRecord(item) ||
			typeof item.id !== "string" ||
			typeof item.sourceRef !== "string" ||
			typeof item.sourceCollection !== "string" ||
			typeof item.sourceEntryId !== "string" ||
			typeof item.sourceTitle !== "string" ||
			typeof item.sourcePath !== "string" ||
			typeof item.href !== "string" ||
			typeof item.targetPath !== "string" ||
			typeof item.anchorText !== "string"
		)
			contractError("crawlDiagnostics.unresolvedLinks");
	}
	for (const item of value.orphanEntries) {
		if (
			!isRecord(item) ||
			typeof item.ref !== "string" ||
			typeof item.collection !== "string" ||
			typeof item.entryId !== "string" ||
			typeof item.title !== "string" ||
			typeof item.path !== "string" ||
			!nonNegativeInteger(item.incomingLinks) ||
			!(item.confidence === "high" || item.confidence === "review")
		)
			contractError("crawlDiagnostics.orphanEntries");
	}
	if (
		value.summary.indexableEntries > value.summary.scannedEntries ||
		value.summary.structuredSources + value.summary.partialSources !==
			value.summary.scannedEntries ||
		value.summary.matchedInternalLinks + value.summary.unresolvedInternalLinks >
			value.summary.scannedLinks ||
		!isRecord(value.limits) ||
		value.limits.maxEntries !== 1_000 || value.limits.maxLinks !== 20_000 ||
		value.limits.maxFindingsPerType !== 250 || value.limits.maxDocumentNodes !== 5_000 ||
		value.limits.maxTotalDocumentNodes !== 100_000 ||
		![value.limits.inspectedRecords, value.limits.scannedDocumentNodes, value.limits.unresolvedLinksOmitted, value.limits.orphanEntriesOmitted].every(nonNegativeInteger) ||
		typeof value.limits.reachedEntryLimit !== "boolean" || typeof value.limits.reachedLinkLimit !== "boolean" || typeof value.limits.reachedDocumentLimit !== "boolean" ||
		Number(value.limits.inspectedRecords) > 1_000 || Number(value.limits.scannedDocumentNodes) > 100_000 ||
		value.summary.scannedEntries > Number(value.limits.inspectedRecords) ||
		value.summary.scannedLinks > 20_000 || value.unresolvedLinks.length > 250 || value.orphanEntries.length > 250 ||
		value.summary.unresolvedInternalLinks !== value.unresolvedLinks.length + Number(value.limits.unresolvedLinksOmitted) ||
		value.summary.possibleOrphans !== value.orphanEntries.length + Number(value.limits.orphanEntriesOmitted) ||
		((value.limits.reachedEntryLimit || value.limits.reachedLinkLimit || value.limits.reachedDocumentLimit ||
			Number(value.limits.unresolvedLinksOmitted) > 0 || Number(value.limits.orphanEntriesOmitted) > 0) && value.coverage !== "partial")
	)
		contractError("crawlDiagnostics.summary.integrity");
	return value as unknown as SeoAdminCrawlDiagnostics;
}

export function parseSeoAdmin404Monitor(value: unknown): SeoAdmin404Monitor {
	if (!isRecord(value)) contractError("404Monitor.root");
	assertContractVersion(value, "404Monitor.contractVersion");
	if (
		typeof value.engineVersion !== "string" ||
		typeof value.generatedAt !== "string" ||
		typeof value.enabled !== "boolean" ||
		!isRecord(value.summary) ||
		!nonNegativeInteger(value.summary.totalHits) ||
		!nonNegativeInteger(value.summary.uniquePaths) ||
		!nonNegativeInteger(value.summary.openPaths) ||
		!nonNegativeInteger(value.summary.resolvedPaths) ||
		!Array.isArray(value.items)
	)
		contractError("404Monitor");
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			typeof item.id !== "string" ||
			typeof item.path !== "string" ||
			!nonNegativeInteger(item.hits) ||
			typeof item.firstSeenAt !== "string" ||
			typeof item.lastSeenAt !== "string" ||
			!(item.status === "open" || item.status === "ignored" || item.status === "resolved") ||
			!(item.redirectTarget === null || typeof item.redirectTarget === "string") ||
			!Array.isArray(item.suggestions)
		)
			contractError("404Monitor.items");
		for (const suggestion of item.suggestions) {
			if (
				!isRecord(suggestion) ||
				typeof suggestion.path !== "string" ||
				typeof suggestion.title !== "string" ||
				!(suggestion.collection === null || typeof suggestion.collection === "string") ||
				typeof suggestion.score !== "number" ||
				suggestion.score < 0 ||
				suggestion.score > 1
			)
				contractError("404Monitor.items.suggestions");
		}
	}
	return value as unknown as SeoAdmin404Monitor;
}

export function parseSeoAdmin404TriageResult(value: unknown): SeoAdmin404TriageResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("404Triage.root");
	if (value.success) {
		parseSeoAdmin404Monitor(value.monitor);
		return value as unknown as SeoAdmin404TriageResult;
	}
	if (
		!(
			value.error === "not_found" ||
			value.error === "invalid_target" ||
			value.error === "storage_unavailable"
		)
	) {
		contractError("404Triage.error");
	}
	return value as unknown as SeoAdmin404TriageResult;
}

const SCORE_LIMIT_QUALIFIER = /^Limited to ([1-9]?[0-9]): \S.*$/;
const UNSET_KEYWORD_SUFFIX = ". No focus keyword";

/**
 * The qualifiers `seoScoreDisplay` composes. A named limit is shown only when
 * it lowered the score, so it names that score; an unset focus keyword always
 * holds the score below Good.
 */
function validScoreQualifier(qualifier: string, score: number): boolean {
	const belowGood = seoScoreBand(score) !== "good";
	if (qualifier === "Add a focus keyword" || qualifier === "No focus keyword") return belowGood;
	const keywordUnset = qualifier.endsWith(UNSET_KEYWORD_SUFFIX);
	const limit = SCORE_LIMIT_QUALIFIER.exec(keywordUnset ? qualifier.slice(0, -UNSET_KEYWORD_SUFFIX.length) : qualifier);
	return limit !== null && Number(limit[1]) === score && (!keywordUnset || belowGood);
}

/**
 * An Overview row is a numbered result of the current analyzer, or a saved
 * result whose content was not re-checked. Dashed and earlier-analyzer
 * results never reach it. A band row's label and tone follow its own score.
 */
function validScorePresentation(value: unknown, score: unknown): boolean {
	if (value === null) return true;
	if (!isRecord(value) || !["good", "review", "poor", "neutral"].includes(String(value.tone)) ||
		!(value.qualifier === null || typeof value.qualifier === "string" && value.qualifier.length > 0)) return false;
	if (value.label === "Saved analysis") return value.tone === "neutral" && value.qualifier === "Current content not checked";
	if (!integerInRange(score, 0, 100)) return false;
	const band = seoScoreBand(score as number);
	return value.label === seoScoreBandLabel(band) &&
		value.tone === (band === "good" ? "good" : band === "needs-improvement" ? "review" : "poor") &&
		(value.qualifier === null || validScoreQualifier(value.qualifier as string, score as number));
}

/** Every score below the Good band has a Failed or Partly met row or an unset focus keyword, so it always needs attention. */
function validNeedsAttention(presentation: unknown, needsAttention: unknown): boolean {
	if (presentation === null) return needsAttention === null;
	if (typeof needsAttention !== "boolean") return false;
	const tone = isRecord(presentation) ? presentation.tone : undefined;
	return tone === "review" || tone === "poor" ? needsAttention : true;
}

export function parseSeoAdminOverview(value: unknown): SeoAdminOverview {
	if (!isRecord(value)) contractError("root");
	assertContractVersion(value, "contractVersion");
	if (typeof value.generatedAt !== "string") contractError("generatedAt");
	if (typeof value.engineVersion !== "string") contractError("engineVersion");
	if (!isRecord(value.readiness) || typeof value.readiness.score !== "number") {
		contractError("readiness");
	}
	if (!isRecord(value.site) || typeof value.site.name !== "string") contractError("site");
	const unknownIndexing = value.site.indexable === null;
	if ((!unknownIndexing && typeof value.site.indexable !== "boolean") ||
		value.site.robotsMode !== (unknownIndexing ? "unknown" : value.site.indexable ? "none" : "noindex,nofollow") ||
		(unknownIndexing !== (value.site.settingsState === "corrupt" || value.site.settingsState === "unavailable")) ||
		!["absent", "saved", "legacy", "historical-seed", "corrupt", "unavailable"].includes(value.site.settingsState as string)) {
		contractError("site.indexing");
	}
	if (!isRecord(value.summary) || !nonNegativeInteger(value.summary.totalScored) ||
		!nonNegativeInteger(value.summary.sampleSize) || !nonNegativeInteger(value.summary.needsAttention) ||
		value.summary.needsAttention > value.summary.sampleSize) {
		contractError("summary");
	}
	if (!Array.isArray(value.priorities)) contractError("priorities");
	if (!Array.isArray(value.checks)) contractError("checks");
	if (!Array.isArray(value.content)) contractError("content");
	if (value.content.length !== value.summary.sampleSize || value.content.some((item) =>
		!isRecord(item) || typeof item.ref !== "string" || typeof item.collection !== "string" ||
		!integerInRange(item.score, 0, 100) || !validScorePresentation(item.presentation, item.score) ||
		!validNeedsAttention(item.presentation, item.needsAttention))) {
		contractError("content item");
	}
	if (value.summary.needsAttention !== value.content.filter((item) => isRecord(item) && item.needsAttention === true).length)
		contractError("summary.needsAttention");
	return value as unknown as SeoAdminOverview;
}

export function parseSeoAdminRefreshResult(value: unknown): SeoAdminRefreshResult {
	if (
		!isRecord(value) ||
		value.success !== true ||
		!isSeoContentCollectionKey(value.collection) ||
		(value.processed !== undefined && (!Number.isInteger(value.processed) || (value.processed as number) < 0 || (value.processed as number) > 100)) ||
		!Number.isInteger(value.updated) ||
		(value.updated as number) < 0 ||
		(value.updated as number) > 100 ||
		value.scoreVersion !== SEO_SCORE_VERSION ||
		typeof value.revision !== "string" ||
		!SCORE_REFRESH_REVISION_PATTERN.test(value.revision) ||
		!(value.cursor === null || typeof value.cursor === "string") ||
		typeof value.hasMore !== "boolean" ||
		(value.hasMore && typeof value.cursor !== "string")
	) {
		contractError("scoreRefresh.root");
	}
	return value as unknown as SeoAdminRefreshResult;
}

export function parseSeoAdminContentOptions(value: unknown): SeoAdminContentOptions {
	if (!isRecord(value)) contractError("contentOptions.root");
	assertContractVersion(value, "contentOptions.contractVersion");
	if (typeof value.generatedAt !== "string" || typeof value.engineVersion !== "string") {
		contractError("contentOptions.metadata");
	}
	if (!Array.isArray(value.collections) || !Array.isArray(value.items))
		contractError("contentOptions.items");
	if ((value.hasMore !== undefined || value.cursor !== undefined) && (
		typeof value.hasMore !== "boolean" ||
		(value.cursor !== undefined && (typeof value.cursor !== "string" || !value.cursor.trim() || value.cursor.length > 2_048)) ||
		value.hasMore !== (value.cursor !== undefined)
	)) contractError("contentOptions.page");
	const collectionKeys = new Set<string>();
	for (const collection of value.collections) {
	if (
			!isRecord(collection) ||
			!isSeoContentCollectionKey(collection.collection) ||
			typeof collection.label !== "string" ||
			typeof collection.labelSingular !== "string" ||
			typeof collection.hasSeo !== "boolean" ||
			!(collection.urlPattern === null || typeof collection.urlPattern === "string") ||
			typeof collection.routable !== "boolean" ||
			collectionKeys.has(collection.collection)
		) {
			contractError("contentOptions.collection");
		}
		collectionKeys.add(collection.collection);
	}
	if (
		value.items.some(
			(item) =>
				!isRecord(item) ||
				typeof item.ref !== "string" ||
				typeof item.entryId !== "string" ||
				typeof item.collection !== "string" ||
				typeof item.collectionLabel !== "string" ||
				typeof item.title !== "string" ||
				(item.updatedAt !== null && typeof item.updatedAt !== "string"),
		)
	) {
		contractError("contentOptions.item");
	}
	if (
		value.items.some(
			(item) => !collectionKeys.has((item as Record<string, unknown>).collection as string),
		)
	) {
		contractError("contentOptions.itemCollection");
	}
	return value as unknown as SeoAdminContentOptions;
}

export function parseSeoAdminContentAuditOptions(value: unknown): SeoAdminContentAuditOptions {
	const options = parseSeoAdminContentOptions(value);
	const page = value as Record<string, unknown>;
	if (
		!validTimestamp(options.generatedAt) ||
		typeof page.hasMore !== "boolean" ||
		(page.cursor !== undefined &&
			(typeof page.cursor !== "string" || !page.cursor.trim() || page.cursor.length > 2_048)) ||
		page.hasMore !== (page.cursor !== undefined) ||
		options.items.length > 25
	) contractError("contentAuditOptions.page");
	const refs = new Set<string>();
	for (const item of options.items) {
		if (
			!item.entryId || item.ref !== `${item.collection}:${item.entryId}` ||
			refs.has(item.ref) ||
			(item.sourceVersion !== undefined && (typeof item.sourceVersion !== "string" || !item.sourceVersion || item.sourceVersion.length > 2_048)) ||
			(item.updatedAt !== null && !validTimestamp(item.updatedAt))
		) contractError("contentAuditOptions.item");
		refs.add(item.ref);
	}
	return value as SeoAdminContentAuditOptions;
}

function finiteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validTimestamp(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validFocusKeywords(value: unknown): value is string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT
	) {
		return false;
	}
	const seen = new Set<string>();
	return value.every((candidate) => {
		if (typeof candidate !== "string") return false;
		const keyword = candidate.trim().replace(/\s+/g, " ");
		const identity = seoKeywordIdentity(keyword);
		if (
			!keyword ||
			keyword !== candidate ||
			keyword.length > SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH ||
			seen.has(identity)
		) {
			return false;
		}
		seen.add(identity);
		return true;
	});
}

function validContentScoreMetrics(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		nonNegativeInteger(value.wordCount) &&
		nonNegativeInteger(value.sentenceCount) &&
		(value.averageSentenceWords === null || finiteNonNegative(value.averageSentenceWords)) &&
		nonNegativeInteger(value.paragraphCount) &&
		nonNegativeInteger(value.longestParagraphWords) &&
		nonNegativeInteger(value.headingCount) &&
		nonNegativeInteger(value.h1Count) &&
		nonNegativeInteger(value.internalLinkCount) &&
		nonNegativeInteger(value.externalLinkCount) &&
		nonNegativeInteger(value.genericLinkCount) &&
		nonNegativeInteger(value.imageCount) &&
		nonNegativeInteger(value.imageAltCount) &&
		nonNegativeInteger(value.imageDecorativeCount) &&
		nonNegativeInteger(value.imageMissingAltCount) &&
		typeof value.structured === "boolean"
	);
}

function validKeywordStatement(value: unknown): boolean {
	return Array.isArray(value) && (value.length === 0 || validFocusKeywords(value));
}

const FOCUS_KEYWORD_SOURCES = ["profile", "content", "transient", "none"];

function validAssessmentProfile(value: unknown): boolean {
	return isRecord(value) && value.version === 1 && (value.profile === "article" || value.profile === "general");
}

function validScoreExplanation(value: Record<string, unknown>): boolean {
	return validAssessmentProfile(value.assessmentProfile) &&
		typeof value.assessmentProfileRevision === "string" &&
		value.assessmentProfileRevision.length > 0 && value.assessmentProfileRevision.length <= 128 &&
		currentSeoScoreAssessmentProblem(value) === null;
}

function validContentScore(
	value: unknown,
	persistence: "stored" | "session" = "stored",
): value is SeoAdminContentScore {
	if (!isRecord(value)) return false;
	if (persistence === "session") {
		if (
			value.persistence !== "session" ||
			value.freshness !== "current" ||
			value.scoreVersion !== SEO_SCORE_VERSION
		) return false;
	} else if (value.persistence !== undefined) return false;
	const validKeywordProfile =
		value.keywords === undefined ||
		(Array.isArray(value.keywords) && value.keywords.length === 0
			? value.keyword === undefined
			: validFocusKeywords(value.keywords) && value.keyword === value.keywords[0]);
	// Current-version scores always carry keyword ownership; only stale
	// last-known records (older scoreVersion) may omit it.
	const validOwnership =
		value.scoreVersion === SEO_SCORE_VERSION
			? (value.profileKeywords === null || validKeywordStatement(value.profileKeywords)) &&
				FOCUS_KEYWORD_SOURCES.includes(String(value.focusKeywordSource))
			: (value.profileKeywords === undefined ||
					value.profileKeywords === null ||
					validKeywordStatement(value.profileKeywords)) &&
				(value.focusKeywordSource === undefined ||
					FOCUS_KEYWORD_SOURCES.includes(String(value.focusKeywordSource)));
	const validAnalysisRevision =
		persistence === "session"
			? value.analysisRevision === 0
			: value.scoreVersion === SEO_SCORE_VERSION
				? nonNegativeInteger(value.analysisRevision) && value.analysisRevision > 0
				: value.analysisRevision === undefined ||
					(nonNegativeInteger(value.analysisRevision) && value.analysisRevision > 0);
	return (
		validOwnership &&
		validAnalysisRevision &&
		(value.scoreVersion !== SEO_SCORE_VERSION || validScoreExplanation(value)) &&
		nonNegativeInteger(value.scoreVersion) &&
		value.scoreVersion > 0 &&
		(value.freshness === undefined ||
			value.freshness === "current" ||
			value.freshness === "stale") &&
		(value.scoreVersion === SEO_SCORE_VERSION || value.freshness === "stale") &&
		typeof value.ref === "string" &&
		typeof value.collection === "string" &&
		typeof value.entryId === "string" &&
		(value.slug === null || typeof value.slug === "string") &&
		typeof value.title === "string" &&
		integerInRange(value.score, 0, 100) &&
		["excellent", "good", "needs-work", "poor"].includes(String(value.grade)) &&
		["pass", "review", "fail"].includes(String(value.status)) &&
		Array.isArray(value.checks) &&
		// The engine's own rule: current checks need a known basis, legacy ones may omit it.
		value.checks.every((check) => seoContentCheckProblem(check, value.scoreVersion === SEO_SCORE_VERSION) === null) &&
		validContentScoreMetrics(value.metrics) &&
		(value.keyword === undefined || typeof value.keyword === "string") &&
		validKeywordProfile &&
		(value.pillar === undefined || typeof value.pillar === "boolean") &&
		typeof value.url === "string" &&
		(value.sourceUpdatedAt === null || validTimestamp(value.sourceUpdatedAt)) &&
		(value.sourceVersion === undefined ||
			(typeof value.sourceVersion === "string" && value.sourceVersion.length > 0 &&
				value.sourceVersion.length <= 2_048)) &&
		(value.sourceKind === undefined || (persistence === "session" && value.sourceKind === "saved-snapshot" && typeof value.sourceVersion === "string")) &&
		(value.entryInputFingerprint === undefined ||
			(persistence === "session" && typeof value.entryInputFingerprint === "string" && ENTRY_INPUT_FINGERPRINT_PATTERN.test(value.entryInputFingerprint))) &&
		// Any identity tag stays readable; only the engine decides which tag it reuses.
		(value.inputIdentity === undefined ||
			(persistence !== "session" && typeof value.inputIdentity === "string" && INPUT_IDENTITY_PATTERN.test(value.inputIdentity))) &&
		validTimestamp(value.updatedAt) &&
		(value.templateUpdatedAt === null || validTimestamp(value.templateUpdatedAt) ||
			(persistence !== "session" && value.templateUpdatedAt === UNREADABLE_TEMPLATES_TOKEN && value.freshness !== "current")) &&
		(value.modulesUpdatedAt === null || validTimestamp(value.modulesUpdatedAt)) &&
		typeof value.configurationFingerprint === "string" &&
		value.configurationFingerprint.length > 0 &&
		(value.metaOverrideUpdatedAt === null || validTimestamp(value.metaOverrideUpdatedAt))
	);
}

export function parseSeoAdminContentScores(value: unknown): SeoAdminContentScores {
	if (!isRecord(value)) contractError("contentScores.root");
	assertContractVersion(value, "contentScores.contractVersion");
	if (
		!validTimestamp(value.generatedAt) ||
		typeof value.engineVersion !== "string" ||
		value.scoreVersion !== SEO_SCORE_VERSION ||
		value.persistence !== undefined
	) {
		contractError("contentScores.metadata");
	}
	if (!Array.isArray(value.items) || !value.items.every((item) => validContentScore(item))) {
		contractError("contentScores.items");
	}
	if (value.cursor !== undefined && typeof value.cursor !== "string") {
		contractError("contentScores.cursor");
	}
	if (typeof value.hasMore !== "boolean") contractError("contentScores.hasMore");
	return value as unknown as SeoAdminContentScores;
}

export function parseSeoAdminContentAudit(value: unknown): SeoAdminContentAudit {
	if (!isRecord(value)) contractError("contentAudit.root");
	assertContractVersion(value, "contentAudit.contractVersion");
	if (
		!validTimestamp(value.generatedAt) ||
		typeof value.engineVersion !== "string" ||
		value.scoreVersion !== SEO_SCORE_VERSION ||
		value.persistence !== "session" ||
		value.hasMore !== false ||
		value.cursor !== undefined
	) contractError("contentAudit.metadata");
	if (
		!Array.isArray(value.items) ||
		!value.items.every((item) => validContentScore(item, "session"))
	) {
		contractError("contentAudit.items");
	}
	if (
		!Array.isArray(value.failures) ||
		!value.failures.every((failure) =>
			isRecord(failure) && typeof failure.ref === "string" &&
			typeof failure.error === "string" && failure.error.trim().length > 0)
	) {
		contractError("contentAudit.failures");
	}
	const refs = [...value.items, ...value.failures].map((item) => item.ref);
	if (
		refs.length < 1 || refs.length > 25 || new Set(refs).size !== refs.length ||
		refs.some((ref) => typeof ref !== "string" || ref.length > 512 || !/^[^\s:]+:[^\s]+$/.test(ref))
	) {
		contractError("contentAudit.refs");
	}
	if (value.items.some((item) => item.ref !== `${item.collection}:${item.entryId}`)) {
		contractError("contentAudit.items.ref");
	}
	return value as unknown as SeoAdminContentAudit;
}

const ENTRY_INPUT_FINGERPRINT_PATTERN = /^sha256-[0-9a-f]{64}$/;
// The engine's template token for a record it could not read; such a stored
// score stays readable history and is never a current or reusable result.
const UNREADABLE_TEMPLATES_TOKEN = "unreadable-templates";
const INPUT_IDENTITY_PATTERN = /^seo-input-v[1-9][0-9]{0,3}-sha256-[0-9a-f]{64}$/;

const SAVED_ANALYSIS_FAILURES = [
	"invalid_ref",
	"unsupported_collection",
	"content_unavailable",
	"content_not_found",
	"locale_mismatch",
	"scoring_disabled",
	"activation_required",
	"profile_required",
	"profile_unavailable",
	"scoring_unavailable",
	"superseded",
	"uncertain",
	"analysis_failed",
];
const SAVED_ANALYSIS_HISTORY = ["created", "unchanged", "failed", "uncertain", "not-attempted"];

/** A durable result for exactly the requested entry; manual-only saves and reused results write no history. */
export function parseSeoAdminSavedAnalysisResult(value: unknown, expectedRef: string): SeoAdminSavedAnalysisResult {
	if (!isRecord(value)) contractError("savedAnalysis.root");
	assertContractVersion(value, "savedAnalysis.contractVersion");
	if (typeof value.engineVersion !== "string" || value.ref !== expectedRef || typeof value.success !== "boolean")
		contractError("savedAnalysis.metadata");
	if (!value.success) {
		if (!SAVED_ANALYSIS_FAILURES.includes(String(value.error))) contractError("savedAnalysis.error");
		return value as unknown as SeoAdminSavedAnalysisResult;
	}
	if (
		typeof value.history !== "string" ||
		(value.outcome === "reused" ? value.history !== "not-attempted"
			: value.outcome !== "saved" || !SAVED_ANALYSIS_HISTORY.includes(value.history))
	) contractError("savedAnalysis.outcome");
	const item = value.item;
	if (
		!validContentScore(item) || !isRecord(item) || item.ref !== expectedRef ||
		item.ref !== `${item.collection}:${item.entryId}` || item.scoreVersion !== SEO_SCORE_VERSION ||
		item.freshness !== undefined || typeof item.sourceVersion !== "string" ||
		item.templateUpdatedAt === UNREADABLE_TEMPLATES_TOKEN ||
		typeof item.inputIdentity !== "string" || !INPUT_IDENTITY_PATTERN.test(item.inputIdentity)
	) contractError("savedAnalysis.item");
	return value as unknown as SeoAdminSavedAnalysisResult;
}

const SCORE_SCAN_STATES = ["running", "paused", "stopped", "completed"];
const SCORE_SCAN_PAUSE_REASONS = [
	"requested", "activation-required", "profile-required", "profile-unavailable", "scoring-disabled", "scoring-unavailable", "policy-changed", "failure-streak", "source-unavailable", "record-budget",
];
const SCORE_SCAN_COMPLETIONS = ["target-reached", "exhausted"];
const SCORE_SCAN_OUTCOMES = ["reused", "saved", "superseded", "skipped", "failed", "retry", "uncertain"];
const SCORE_SCAN_COMPUTATIONS = ["confirmed", "none", "incomplete", "unknown"];
const SCORE_SCAN_HISTORY = ["pending", "created", "unchanged", "failed", "uncertain", "unknown", "not-attempted"];
const SCORE_SCAN_DECISIONS = ["continue", "paused", "stopped", "completed"];
const SCORE_SCAN_PROGRESS = ["window", "no-longer-matching", "outcome", "state"];
const SCORE_SCAN_STATUSES = ["all", "draft", "published", "scheduled"];
const SCORE_SCAN_COUNTERS = [
	"fetchedCandidates", "examinedCandidates", "matchedReferences", "noLongerMatching", "admitted", "attempts", "analyzed",
	"reused", "saved", "superseded", "skipped", "failed", "retried", "uncertain",
	"historyCreated", "historyUnchanged", "historyFailed", "historyUncertain", "historyUnknown",
];
const SCORE_SCAN_FAILURES = [
	"scan_unavailable", "storage_unavailable", "source_unavailable", "invalid_command", "invalid_scope", "unsupported_collection",
	"scope_too_large", "activation_required", "profile_required", "profile_unavailable", "scoring_disabled", "scoring_unavailable", "run_exists", "stale_run", "stale_revision", "receipt_expired",
	"not_running", "not_resumable", "busy", "recovery_required", "uncertain",
];
const SCORE_SCAN_MAX_BUFFER = 25;
const SCORE_SCAN_MAX_COUNT = 100_000;

function scoreScanTimestamp(value: unknown): boolean {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * A saved outcome carries history; every other outcome attempted none. Only
 * saved or reused results carry a score, and either may carry null when the
 * shared score display shows a dash for that result.
 */
function validScoreScanOutcome(value: unknown): boolean {
	if (!isRecord(value) || typeof value.attemptId !== "string" || !integerInRange(value.admission, 1, Number.MAX_SAFE_INTEGER) ||
		typeof value.ref !== "string" || typeof value.locale !== "string" || !scoreScanTimestamp(value.recordedAt) ||
		!SCORE_SCAN_OUTCOMES.includes(String(value.status)) || !(value.reason === null || typeof value.reason === "string") ||
		!SCORE_SCAN_COMPUTATIONS.includes(String(value.computation)) || !SCORE_SCAN_HISTORY.includes(String(value.history)))
		return false;
	const scored = value.status === "saved" || value.status === "reused";
	if (scored ? !(value.score === null || integerInRange(value.score, 0, 100)) : value.score !== null) return false;
	return value.status === "saved" ? value.history !== "not-attempted" : value.history === "not-attempted";
}

function parseScoreScanView(value: unknown, field: string): void {
	if (!isRecord(value) || typeof value.runId !== "string" || !/^scan-[A-Za-z0-9-]{8,64}$/.test(value.runId) ||
		!integerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER) || !SCORE_SCAN_STATES.includes(String(value.state)) ||
		!(value.pauseReason === null || SCORE_SCAN_PAUSE_REASONS.includes(String(value.pauseReason))) ||
		!(value.completion === null || SCORE_SCAN_COMPLETIONS.includes(String(value.completion))) ||
		(value.state === "paused") !== (value.pauseReason !== null) || (value.state === "completed") !== (value.completion !== null) ||
		!scoreScanTimestamp(value.createdAt) || !scoreScanTimestamp(value.updatedAt) || !nonNegativeInteger(value.failureStreak) ||
		!integerInRange(value.bufferedReferences, 0, SCORE_SCAN_MAX_BUFFER) || typeof value.exhausted !== "boolean" ||
		!integerInRange(value.outcomeRetention, 1, 100))
		contractError(`${field}.root`);
	const scope = value.scope;
	if (!isRecord(scope) || !isSeoContentCollectionKey(scope.collection) || !SCORE_SCAN_STATUSES.includes(String(scope.status)) ||
		!(scope.locale === null || typeof scope.locale === "string") || !Array.isArray(scope.taxonomies) || scope.taxonomies.length > 8 ||
		!scope.taxonomies.every((selection) => isRecord(selection) && typeof selection.taxonomy === "string" &&
			Array.isArray(selection.termIds) && selection.termIds.length > 0 && selection.termIds.every((id) => typeof id === "string") &&
			typeof selection.includeDescendants === "boolean" && integerInRange(selection.termGroupCount, 1, 512)))
		contractError(`${field}.scope`);
	const target = value.target;
	if (!isRecord(target) || !(target.mode === "all" || (target.mode === "count" && integerInRange(target.count, 1, SCORE_SCAN_MAX_COUNT))))
		contractError(`${field}.target`);
	const counters = value.counters;
	if (!isRecord(counters) || !SCORE_SCAN_COUNTERS.every((key) => nonNegativeInteger(counters[key])))
		contractError(`${field}.counters`);
	const unit = value.unit;
	if (!(unit === null || (isRecord(unit) && (unit.phase === "analysis" || unit.phase === "history") && typeof unit.ref === "string" &&
		scoreScanTimestamp(unit.leaseExpiresAt) && typeof unit.active === "boolean")))
		contractError(`${field}.unit`);
	const retry = value.retry;
	if (!(retry === null || (isRecord(retry) && typeof retry.ref === "string" && integerInRange(retry.admission, 1, Number.MAX_SAFE_INTEGER))))
		contractError(`${field}.retry`);
	if (!Array.isArray(value.outcomes) || value.outcomes.length > (value.outcomeRetention as number) || !value.outcomes.every(validScoreScanOutcome))
		contractError(`${field}.outcomes`);
}

/** The current scan, or null when no readable run exists. */
export function parseSeoAdminScoreScanStateResult(value: unknown): SeoAdminScoreScanStateResult {
	if (!isRecord(value)) contractError("scoreScan.state.root");
	assertContractVersion(value, "scoreScan.state.contractVersion");
	if (typeof value.engineVersion !== "string" || typeof value.success !== "boolean") contractError("scoreScan.state.metadata");
	if (!value.success) {
		if (value.error !== "scan_unavailable" && value.error !== "storage_unavailable") contractError("scoreScan.state.error");
		return value as unknown as SeoAdminScoreScanStateResult;
	}
	if (!scoreScanTimestamp(value.checkedAt)) contractError("scoreScan.state.checkedAt");
	if (value.scan !== null) parseScoreScanView(value.scan, "scoreScan.state.scan");
	return value as unknown as SeoAdminScoreScanStateResult;
}

/**
 * The answer to exactly the sent command. A fresh answer's decision matches
 * the returned state; a replay returns the recorded decision with the current state.
 */
export function parseSeoAdminScoreScanResult(
	value: unknown,
	expected: { command: "start" | SeoAdminScoreScanCommand; commandId: string },
): SeoAdminScoreScanResult {
	if (!isRecord(value)) contractError("scoreScan.result.root");
	assertContractVersion(value, "scoreScan.result.contractVersion");
	if (typeof value.engineVersion !== "string" || typeof value.success !== "boolean" ||
		value.command !== expected.command || value.commandId !== expected.commandId)
		contractError("scoreScan.result.metadata");
	if (!value.success) {
		if (!SCORE_SCAN_FAILURES.includes(String(value.error)) || !(value.detail === null || typeof value.detail === "string"))
			contractError("scoreScan.result.error");
		if (value.scan !== null) parseScoreScanView(value.scan, "scoreScan.result.scan");
		return value as unknown as SeoAdminScoreScanResult;
	}
	if (typeof value.replayed !== "boolean" || !SCORE_SCAN_DECISIONS.includes(String(value.decision)) ||
		!SCORE_SCAN_PROGRESS.includes(String(value.progress)))
		contractError("scoreScan.result.decision");
	if (value.outcome !== null && (value.progress !== "outcome" || !validScoreScanOutcome(value.outcome)))
		contractError("scoreScan.result.outcome");
	parseScoreScanView(value.scan, "scoreScan.result.scan");
	const state = (value.scan as Record<string, unknown>).state;
	if (!value.replayed && value.decision !== (state === "running" ? "continue" : state))
		contractError("scoreScan.result.decision");
	return value as unknown as SeoAdminScoreScanResult;
}

export function parseSeoAdminScoreScanTaxonomiesResult(value: unknown, collection: string): SeoAdminScoreScanTaxonomiesResult {
	if (!isRecord(value)) contractError("scoreScan.taxonomies.root");
	assertContractVersion(value, "scoreScan.taxonomies.contractVersion");
	if (typeof value.engineVersion !== "string" || typeof value.success !== "boolean" || value.collection !== collection)
		contractError("scoreScan.taxonomies.metadata");
	if (!value.success) {
		if (!["scan_unavailable", "unsupported_collection", "taxonomies_unavailable"].includes(String(value.error)))
			contractError("scoreScan.taxonomies.error");
		return value as unknown as SeoAdminScoreScanTaxonomiesResult;
	}
	if (!Array.isArray(value.taxonomies) || value.taxonomies.length > 100 ||
		!value.taxonomies.every((taxonomy) => isRecord(taxonomy) && typeof taxonomy.name === "string" && taxonomy.name.length > 0 &&
			typeof taxonomy.label === "string" && typeof taxonomy.hierarchical === "boolean") ||
		new Set(value.taxonomies.map((taxonomy) => (taxonomy as Record<string, unknown>).name)).size !== value.taxonomies.length)
		contractError("scoreScan.taxonomies.items");
	return value as unknown as SeoAdminScoreScanTaxonomiesResult;
}

/** One bounded page of term options for exactly the requested taxonomy. */
export function parseSeoAdminScoreScanTermsResult(
	value: unknown,
	request: { collection: string; taxonomy: string },
): SeoAdminScoreScanTermsResult {
	if (!isRecord(value)) contractError("scoreScan.terms.root");
	assertContractVersion(value, "scoreScan.terms.contractVersion");
	if (typeof value.engineVersion !== "string" || typeof value.success !== "boolean" ||
		value.collection !== request.collection || value.taxonomy !== request.taxonomy)
		contractError("scoreScan.terms.metadata");
	if (!value.success) {
		if (!["scan_unavailable", "unsupported_collection", "invalid_selection", "source_unavailable"].includes(String(value.error)) ||
			!(value.detail === null || typeof value.detail === "string"))
			contractError("scoreScan.terms.error");
		return value as unknown as SeoAdminScoreScanTermsResult;
	}
	if (!Array.isArray(value.terms) || value.terms.length > 50 ||
		!value.terms.every((term) => isRecord(term) && typeof term.id === "string" && term.id.length > 0 &&
			typeof term.translationGroup === "string" && typeof term.label === "string" && typeof term.locale === "string") ||
		!(value.nextCursor === null || (typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 2_048)))
		contractError("scoreScan.terms.items");
	return value as unknown as SeoAdminScoreScanTermsResult;
}

const ENTRY_ANALYSIS_IDENTITY_FAILURES = [
	"scoring_disabled",
	"activation_required",
	"profile_required",
	"profile_unavailable",
	"invalid_ref",
	"unsupported_collection",
	"content_unavailable",
	"content_not_found",
	"configuration_unreadable",
];

export function parseSeoAdminEntryAnalysisIdentityResult(
	value: unknown,
	expectedRef: string,
): SeoAdminEntryAnalysisIdentityResult {
	if (!isRecord(value)) contractError("entryAnalysisIdentity.root");
	assertContractVersion(value, "entryAnalysisIdentity.contractVersion");
	if (typeof value.engineVersion !== "string" || value.ref !== expectedRef || typeof value.success !== "boolean")
		contractError("entryAnalysisIdentity.metadata");
	if (!value.success) {
		if (!ENTRY_ANALYSIS_IDENTITY_FAILURES.includes(String(value.error))) contractError("entryAnalysisIdentity.error");
		return value as unknown as SeoAdminEntryAnalysisIdentityResult;
	}
	const identity = value.identity;
	if (
		!isRecord(identity) ||
		!nonNegativeInteger(identity.scoreVersion) ||
		identity.scoreVersion < 1 ||
		typeof identity.configurationFingerprint !== "string" ||
		!identity.configurationFingerprint ||
		!(identity.templateUpdatedAt === null || typeof identity.templateUpdatedAt === "string") ||
		!(identity.modulesUpdatedAt === null || validTimestamp(identity.modulesUpdatedAt)) ||
		!(identity.metaOverrideUpdatedAt === null || validTimestamp(identity.metaOverrideUpdatedAt)) ||
		!(identity.sourceVersion === null || (typeof identity.sourceVersion === "string" && identity.sourceVersion.length > 0 && identity.sourceVersion.length <= 2_048)) ||
		!(identity.locale === null || (typeof identity.locale === "string" && identity.locale.length > 0 && identity.locale.length <= 64)) ||
		typeof identity.entryInputFingerprint !== "string" || !ENTRY_INPUT_FINGERPRINT_PATTERN.test(identity.entryInputFingerprint)
	) contractError("entryAnalysisIdentity.identity");
	return value as unknown as SeoAdminEntryAnalysisIdentityResult;
}

function validAnalysisProfile(value: unknown): boolean {
	if (
		!isRecord(value) ||
		value.storageVersion !== SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION ||
		typeof value.ref !== "string" ||
		typeof value.pillar !== "boolean" ||
		!validTimestamp(value.updatedAt)
	) {
		return false;
	}
	// `keywords: null` is a profile without an explicit keyword statement (it
	// stores pillar alone); empty arrays preserve an explicit user choice to
	// disable analyzer keywords — otherwise a legacy content fallback would
	// reappear on reload.
	if (value.keywords === null) return value.keyword === "";
	if (Array.isArray(value.keywords) && value.keywords.length === 0) {
		return value.keyword === "";
	}
	return validFocusKeywords(value.keywords) && value.keyword === (value.keywords as string[])[0];
}

export function parseSeoAdminFocusKeywordSaveResult(
	value: unknown,
): SeoAdminFocusKeywordSaveResult {
	if (!isRecord(value)) contractError("focusKeyword.root");
	assertContractVersion(value, "focusKeyword.contractVersion");
	if (typeof value.engineVersion !== "string" || typeof value.success !== "boolean") {
		contractError("focusKeyword.metadata");
	}
	if (value.success) {
		if (
			typeof value.ref !== "string" || !/^[^\s:]+:[^\s]+$/.test(value.ref) ||
			(value.profile !== null && (!isRecord(value.profile) || !validAnalysisProfile(value.profile) || value.profile.ref !== value.ref)) ||
			(value.item !== null && (!isRecord(value.item) || !validContentScore(value.item) || value.item.ref !== value.ref))
		) {
			contractError("focusKeyword.result");
		}
	} else if (
		![
		"invalid_ref",
		"invalid_keyword",
		"unsupported_collection",
		"content_unavailable",
		"not_found",
		"keyword_too_long",
		"too_many_keywords",
		"storage_unavailable",
		].includes(String(value.error))
	) {
		contractError("focusKeyword.error");
	}
	return value as unknown as SeoAdminFocusKeywordSaveResult;
}

export function parseSeoAdminAnalysisProfileResult(value: unknown): SeoAdminAnalysisProfileResult {
	if (!isRecord(value)) contractError("analysisProfile.root");
	assertContractVersion(value, "analysisProfile.contractVersion");
	if (typeof value.engineVersion !== "string" || typeof value.success !== "boolean") contractError("analysisProfile.metadata");
	if (value.success) {
		if (typeof value.ref !== "string" || !/^[^\s:]+:[^\s]+$/.test(value.ref) ||
			(value.profile !== null && (!isRecord(value.profile) || !validAnalysisProfile(value.profile) || value.profile.ref !== value.ref))) {
			contractError("analysisProfile.result");
		}
	} else if (!["invalid_ref", "content_unavailable", "not_found", "unsupported_collection", "storage_unavailable"].includes(String(value.error))) {
		contractError("analysisProfile.error");
	}
	return value as unknown as SeoAdminAnalysisProfileResult;
}

const SEO_ROBOTS_DIRECTIVE_FIELDS = [
	"nofollow",
	"noarchive",
	"nosnippet",
	"noimageindex",
	"notranslate",
] as const;

function validRobotsDirectives(value: unknown): boolean {
	return (
		isRecord(value) &&
		SEO_ROBOTS_DIRECTIVE_FIELDS.every((field) => typeof value[field] === "boolean")
	);
}

function validMetaOverride(value: unknown): boolean {
	return (
		isRecord(value) &&
		value.storageVersion === SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION &&
		typeof value.ref === "string" &&
		validRobotsDirectives(value.robots) &&
		(value.disabledPresets === undefined ||
			(Array.isArray(value.disabledPresets) &&
				value.disabledPresets.every((entry) => typeof entry === "string"))) &&
		validTimestamp(value.updatedAt)
	);
}

export function parseSeoAdminEntryDirectivesResult(value: unknown): SeoAdminEntryDirectivesResult {
	if (!isRecord(value)) contractError("entryDirectives.root");
	assertContractVersion(value, "entryDirectives.contractVersion");
	if (typeof value.engineVersion !== "string" || typeof value.success !== "boolean") {
		contractError("entryDirectives.metadata");
	}
	if (value.success) {
		if (value.item !== null && !validMetaOverride(value.item)) {
			contractError("entryDirectives.item");
		}
	} else if (
		![
		"invalid_ref",
		"invalid_values",
		"unsupported_collection",
		"content_unavailable",
		"not_found",
		"storage_unavailable",
		].includes(String(value.error))
	) {
		contractError("entryDirectives.error");
	}
	return value as unknown as SeoAdminEntryDirectivesResult;
}

function validEntrySchemaGraph(item: unknown): boolean {
	return (
		isRecord(item) &&
		typeof item.id === "string" &&
		(item.source === "preset" || item.source === "custom") &&
		(item.presetKey === null || typeof item.presetKey === "string") &&
		typeof item.name === "string" &&
		Array.isArray(item.types) &&
		item.types.every((t) => typeof t === "string") &&
		typeof item.disabled === "boolean" &&
		typeof item.emitted === "boolean" &&
		(item.suppressedReason === null ||
			[
				"disabled",
				"invalid",
				"duplicate-definition",
				"entity-conflict",
				"duplicate-contribution",
			].includes(String(item.suppressedReason))) &&
		(item.conflictId === null || typeof item.conflictId === "string") &&
		typeof item.replacesCore === "boolean"
	);
}

export function parseSeoAdminEntrySchemaPreviewResult(
	value: unknown,
): SeoAdminEntrySchemaPreviewResult {
	if (!isRecord(value)) contractError("entrySchemaPreview.root");
	assertContractVersion(value, "entrySchemaPreview.contractVersion");
	if (typeof value.engineVersion !== "string" || typeof value.success !== "boolean") {
		contractError("entrySchemaPreview.metadata");
	}
	if (value.success) {
		if (!validTimestamp(value.generatedAt)) {
			contractError("entrySchemaPreview.generatedAt");
		}
		if (!Array.isArray(value.items) || !value.items.every(validEntrySchemaGraph)) {
			contractError("entrySchemaPreview.items");
		}
	} else if (
		![
		"invalid_ref",
		"invalid_values",
		"unsupported_collection",
		"content_unavailable",
		"not_found",
		"storage_unavailable",
		].includes(String(value.error))
	) {
		contractError("entrySchemaPreview.error");
	}
	return value as unknown as SeoAdminEntrySchemaPreviewResult;
}

function nullableScore(value: unknown): boolean {
	return value === null || integerInRange(value, 0, 100);
}

function validScoreHistoryIssue(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.label === "string" &&
		[
			"metadata",
			"indexability",
			"social",
			"schema",
			"content",
			"keyword",
			"links",
			"images",
			"readability",
		].includes(String(value.category)) &&
		["info", "low", "medium", "high", "critical"].includes(String(value.severity)) &&
		(value.status === "review" || value.status === "fail") &&
		finiteNonNegative(value.weight) &&
		value.weight > 0
	);
}

function validScoreSnapshot(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		value.storageVersion === SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION &&
		typeof value.fingerprint === "string" &&
		typeof value.ref === "string" &&
		typeof value.collection === "string" &&
		typeof value.entryId === "string" &&
		typeof value.title === "string" &&
		integerInRange(value.score, 0, 100) &&
		["excellent", "good", "needs-work", "poor"].includes(String(value.grade)) &&
		nonNegativeInteger(value.scoreVersion) &&
		value.scoreVersion > 0 &&
		(value.analysisRevision === undefined ||
			(nonNegativeInteger(value.analysisRevision) && value.analysisRevision > 0)) &&
		(value.sourceUpdatedAt === null || validTimestamp(value.sourceUpdatedAt)) &&
		(value.sourceVersion === undefined || (typeof value.sourceVersion === "string" && value.sourceVersion.length > 0 && value.sourceVersion.length <= 2_048)) &&
		(value.templateUpdatedAt === null || validTimestamp(value.templateUpdatedAt)) &&
		(value.modulesUpdatedAt === undefined ||
			value.modulesUpdatedAt === null ||
			validTimestamp(value.modulesUpdatedAt)) &&
		(value.configurationFingerprint === undefined ||
			typeof value.configurationFingerprint === "string") &&
		(value.metaOverrideUpdatedAt === undefined ||
			value.metaOverrideUpdatedAt === null ||
			validTimestamp(value.metaOverrideUpdatedAt)) &&
		validTimestamp(value.capturedAt) &&
		Array.isArray(value.issues) &&
		value.issues.every(validScoreHistoryIssue)
	);
}

function validTrendPoint(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		typeof value.date === "string" &&
		/^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
		nullableScore(value.averageScore) &&
		nonNegativeInteger(value.trackedEntries) &&
		nonNegativeInteger(value.failingIssues) &&
		nonNegativeInteger(value.reviewIssues)
	);
}

function validTrendIssue(value: unknown): boolean {
	return (
		isRecord(value) &&
		validScoreHistoryIssue({ ...value, weight: 1 }) &&
		nonNegativeInteger(value.affectedEntries) &&
		value.affectedEntries > 0
	);
}

function validTrendChange(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return typeof value.ref === "string" && typeof value.collection === "string" &&
		typeof value.entryId === "string" && typeof value.title === "string" &&
		typeof value.previousSnapshotId === "string" && value.previousSnapshotId.length > 0 &&
		typeof value.currentSnapshotId === "string" && value.currentSnapshotId.length > 0 &&
		value.previousSnapshotId !== value.currentSnapshotId &&
		validTimestamp(value.previousCapturedAt) && validTimestamp(value.capturedAt) &&
		Date.parse(value.previousCapturedAt) < Date.parse(value.capturedAt) &&
		(value.baselineBasis === "before-window" || value.baselineBasis === "first-in-window") &&
		typeof value.scopeChanged === "boolean" &&
		integerInRange(value.previousScore, 0, 100) && integerInRange(value.currentScore, 0, 100) &&
		value.delta === value.currentScore - value.previousScore &&
		nonNegativeInteger(value.openedIssues) && nonNegativeInteger(value.resolvedIssues) &&
		(value.delta !== 0 || value.openedIssues > 0 || value.resolvedIssues > 0);
}

function validScoreComparison(value: unknown): boolean {
	if (!isRecord(value) || value.policy !== "same-ref-window-v1" || !isRecord(value.range) ||
		!validTimestamp(value.range.start) || !validTimestamp(value.range.end) ||
		Date.parse(value.range.start) > Date.parse(value.range.end) || !isRecord(value.exclusions)) return false;
	for (const key of ["observedEntries", "pairedEntries", "singleSampleEntries", "excludedEntries", "scopeChangedPairs",
		"improvedEntries", "declinedEntries", "unchangedEntries"] as const) {
		if (!integerInRange(value[key], 0, 2_000)) return false;
	}
	const exclusions = value.exclusions;
	for (const key of ["missingContext", "invalidContext", "changedProfile", "ambiguousTime"] as const) {
		if (!integerInRange(exclusions[key], 0, 2_000)) return false;
	}
	const comparison = value as unknown as SeoAdminScoreTrends["comparison"];
	if (comparison.observedEntries !== comparison.pairedEntries + comparison.singleSampleEntries + comparison.excludedEntries ||
		comparison.excludedEntries !== comparison.exclusions.missingContext + comparison.exclusions.invalidContext +
			comparison.exclusions.changedProfile + comparison.exclusions.ambiguousTime ||
		comparison.scopeChangedPairs > comparison.pairedEntries ||
		comparison.improvedEntries + comparison.declinedEntries + comparison.unchangedEntries !== comparison.pairedEntries) return false;
	if (!comparison.pairedEntries) return comparison.baselineAverage === null && comparison.currentAverage === null &&
		comparison.scoreDelta === null && comparison.direction === "insufficient-data" &&
		comparison.openedIssues === null && comparison.resolvedIssues === null;
	return integerInRange(comparison.baselineAverage, 0, 100) && integerInRange(comparison.currentAverage, 0, 100) &&
		comparison.scoreDelta === comparison.currentAverage - comparison.baselineAverage &&
		comparison.direction === (comparison.scoreDelta > 0 ? "improved" : comparison.scoreDelta < 0 ? "declined" : "stable") &&
		integerInRange(comparison.openedIssues, 0, 26_000) && integerInRange(comparison.resolvedIssues, 0, 26_000);
}

export function parseSeoAdminScoreTrends(value: unknown): SeoAdminScoreTrends {
	if (!isRecord(value)) contractError("scoreTrends.root");
	assertContractVersion(value, "scoreTrends.contractVersion");
	if (value.storageVersion !== SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION) contractError("scoreTrends.storageVersion");
	if (!validTimestamp(value.generatedAt) || typeof value.engineVersion !== "string") contractError("scoreTrends.metadata");
	if (value.scoreVersion !== SEO_SCORE_VERSION) contractError("scoreTrends.scoreVersion");
	if (!isRecord(value.scope) || !integerInRange(value.scope.days, 7, 90) ||
		(value.scope.collection !== null && typeof value.scope.collection !== "string") ||
		(value.scope.ref !== null && typeof value.scope.ref !== "string")) contractError("scoreTrends.scope");
	if (!isRecord(value.summary) || !nonNegativeInteger(value.summary.snapshotCount) ||
		!nonNegativeInteger(value.summary.trackedEntries) || !nullableScore(value.summary.currentAverage) ||
		!nonNegativeInteger(value.summary.openIssues) ||
		(value.summary.trackedEntries === 0) !== (value.summary.currentAverage === null) ||
		(value.summary.trackedEntries === 0 && value.summary.openIssues !== 0)) contractError("scoreTrends.summary");
	if (!validScoreComparison(value.comparison)) contractError("scoreTrends.comparison");
	const result = value as unknown as SeoAdminScoreTrends;
	const comparison = result.comparison;
	const now = new Date(result.generatedAt);
	const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (result.scope.days - 1) * 86_400_000;
	const end = now.valueOf();
	// A later dashed snapshot keeps its entry observed but no longer tracked, so observed may exceed tracked.
	if (Date.parse(comparison.range.start) !== start || comparison.range.end !== result.generatedAt ||
		comparison.observedEntries > result.summary.snapshotCount)
		contractError("scoreTrends.comparison.range");
	if (!Array.isArray(value.points) || value.points.length !== result.scope.days || !value.points.every(validTrendPoint))
		contractError("scoreTrends.points");
	for (const [index, point] of result.points.entries()) {
		if (point.date !== new Date(start + index * 86_400_000).toISOString().slice(0, 10) ||
			(point.trackedEntries === 0) !== (point.averageScore === null) ||
			(point.trackedEntries === 0 && (point.failingIssues !== 0 || point.reviewIssues !== 0)))
			contractError("scoreTrends.points.state");
	}
	const finalPoint = result.points[result.points.length - 1];
	if (finalPoint.averageScore !== result.summary.currentAverage || finalPoint.trackedEntries !== result.summary.trackedEntries ||
		finalPoint.failingIssues + finalPoint.reviewIssues !== result.summary.openIssues) contractError("scoreTrends.summary.state");
	if (!Array.isArray(value.topIssues) || value.topIssues.length > 10 || !value.topIssues.every(validTrendIssue) ||
		new Set(result.topIssues.map((issue) => issue.id)).size !== result.topIssues.length ||
		result.topIssues.some((issue) => issue.affectedEntries > result.summary.trackedEntries)) contractError("scoreTrends.topIssues");
	if (!isRecord(value.changes) || !Array.isArray(value.changes.items) ||
		!value.changes.items.every(validTrendChange) || !nonNegativeInteger(value.changes.total) ||
		value.changes.total > comparison.pairedEntries || value.changes.items.length !== Math.min(value.changes.total, 20) ||
		value.changes.hasMore !== (value.changes.total > 20) ||
		value.changes.total < comparison.improvedEntries + comparison.declinedEntries) contractError("scoreTrends.changes");
	const refs = new Set<string>();
	let opened = 0, resolved = 0, improved = 0, declined = 0, scopeChanged = 0;
	for (const change of result.changes.items) {
		const capturedAt = Date.parse(change.capturedAt);
		const previousAt = Date.parse(change.previousCapturedAt);
		if (refs.has(change.ref) || capturedAt < start || capturedAt > end ||
			(change.baselineBasis === "before-window" ? previousAt >= start : previousAt < start) ||
			(result.scope.collection !== null && change.collection !== result.scope.collection) ||
			(result.scope.ref !== null && change.ref !== result.scope.ref)) contractError("scoreTrends.changes.provenance");
		refs.add(change.ref);
		opened += change.openedIssues; resolved += change.resolvedIssues;
		improved += Number(change.delta > 0); declined += Number(change.delta < 0); scopeChanged += Number(change.scopeChanged);
	}
	if (opened > (comparison.openedIssues ?? 0) || resolved > (comparison.resolvedIssues ?? 0) ||
		improved > comparison.improvedEntries || declined > comparison.declinedEntries || scopeChanged > comparison.scopeChangedPairs ||
		(!result.changes.hasMore && (opened !== (comparison.openedIssues ?? 0) || resolved !== (comparison.resolvedIssues ?? 0) ||
			improved !== comparison.improvedEntries || declined !== comparison.declinedEntries))) contractError("scoreTrends.changes.counts");
	if (!Array.isArray(value.items) || !value.items.every(validScoreSnapshot) ||
		value.items.length !== Math.min(result.summary.snapshotCount, 100) ||
		new Set(result.items.map((item) => item.id)).size !== result.items.length) contractError("scoreTrends.items");
	let previousTime = Infinity;
	for (const item of result.items) {
		const capturedAt = Date.parse(item.capturedAt);
		if (capturedAt < start || capturedAt > end || capturedAt > previousTime ||
			(result.scope.collection !== null && item.collection !== result.scope.collection) ||
			(result.scope.ref !== null && item.ref !== result.scope.ref)) contractError("scoreTrends.items.scope");
		previousTime = capturedAt;
		for (const change of result.changes.items) {
			const current = item.id === change.currentSnapshotId;
			if (!current && item.id !== change.previousSnapshotId) continue;
			if (item.scoreVersion !== SEO_SCORE_VERSION || item.ref !== change.ref || item.collection !== change.collection ||
				item.entryId !== change.entryId || item.score !== (current ? change.currentScore : change.previousScore) ||
				item.capturedAt !== (current ? change.capturedAt : change.previousCapturedAt)) contractError("scoreTrends.changes.snapshot");
		}
	}
	return result;
}

function parseSettingsValues(value: unknown): SeoAdminSettingsValues {
	if (!isRecord(value)) contractError("settings.values");
	if (Object.hasOwn(value, "customVerificationTags") && !isStoredCustomVerificationTags(value.customVerificationTags))
		contractError("settings.values.customVerificationTags");
	if (Object.hasOwn(value, "taxonomyArchiveNoindex") && !isStoredTaxonomyArchiveNoindex(value.taxonomyArchiveNoindex))
		contractError("settings.values.taxonomyArchiveNoindex");
	if (Object.hasOwn(value, "contentTypeNoindex") && !isStoredContentTypeNoindex(value.contentTypeNoindex))
		contractError("settings.values.contentTypeNoindex");
	if (
		typeof value.siteName !== "string" ||
		typeof value.siteUrl !== "string" ||
		typeof value.organizationName !== "string" ||
		typeof value.organizationLogo !== "string" ||
		!Array.isArray(value.socialProfiles) ||
		!value.socialProfiles.every((item) => typeof item === "string") ||
		typeof value.defaultSocialImage !== "string" ||
		typeof value.twitterHandle !== "string" ||
		typeof value.noindex !== "boolean" ||
		(value.contentScoringEnabled !== undefined && typeof value.contentScoringEnabled !== "boolean")
	)
		contractError("settings.values");
	if (value.publisherType !== undefined && value.publisherType !== "organization" && value.publisherType !== "person")
		contractError("settings.values.publisherType");
	if (value.personName !== undefined && typeof value.personName !== "string")
		contractError("settings.values.personName");
	if (value.personProfiles !== undefined &&
		(!Array.isArray(value.personProfiles) || !value.personProfiles.every((item) => typeof item === "string")))
		contractError("settings.values.personProfiles");
	return {
		...value,
		publisherType: value.publisherType ?? "organization",
		personName: value.personName ?? "",
		personProfiles: value.personProfiles ?? [],
		contentScoringEnabled: value.contentScoringEnabled ?? true,
	} as SeoAdminSettingsValues;
}

function parseContentScoringPolicy(value: unknown): SeoAdminContentScoringPolicy {
	if (!isRecord(value)) contractError("settings.contentScoring");
	if (value.state === "unavailable") {
		if (value.reason !== "unreadable" && value.reason !== "corrupt") contractError("settings.contentScoring.reason");
		return value as unknown as SeoAdminContentScoringPolicy;
	}
	if (!["enabled", "paused", "pending-confirmation"].includes(String(value.state)) ||
		(value.revision !== null && (typeof value.revision !== "string" || !value.revision || value.revision.length > 128)) ||
		typeof value.intentEnabled !== "boolean" || value.currentNoticeVersion !== CONTENT_SCORING_RESOURCE_NOTICE_VERSION ||
		(value.acknowledgedNoticeVersion !== null && !integerInRange(value.acknowledgedNoticeVersion, 1, Number.MAX_SAFE_INTEGER)) ||
		(value.state === "paused") !== !value.intentEnabled ||
		(value.state === "enabled") !== (value.intentEnabled && value.acknowledgedNoticeVersion === value.currentNoticeVersion))
		contractError("settings.contentScoring.state");
	return value as unknown as SeoAdminContentScoringPolicy;
}

function parseCollectionAnalysisProfileSelection(value: unknown, collection: string): SeoAdminCollectionAnalysisProfileSelection {
	if (!isRecord(value) || value.collection !== collection) contractError("collectionAnalysisProfile.selection");
	if (value.state === "configured") {
		if (!validAssessmentProfile(value) || typeof value.revision !== "string" || !value.revision || value.revision.length > 128)
			contractError("collectionAnalysisProfile.configured");
	} else if (value.state === "unconfigured") {
		if (value.revision !== null) contractError("collectionAnalysisProfile.unconfigured");
	} else if (value.state === "unavailable") {
		if (value.reason !== undefined && typeof value.reason !== "string") contractError("collectionAnalysisProfile.unavailable");
	} else contractError("collectionAnalysisProfile.state");
	return value as unknown as SeoAdminCollectionAnalysisProfileSelection;
}

export function parseSeoCollectionAnalysisProfileResult(value: unknown, collection: string): SeoAdminCollectionAnalysisProfileResult {
	if (!isRecord(value)) contractError("collectionAnalysisProfile.root");
	assertContractVersion(value, "collectionAnalysisProfile.contractVersion");
	if (!isSeoContentCollectionKey(collection) || value.collection !== collection || typeof value.engineVersion !== "string")
		contractError("collectionAnalysisProfile.metadata");
	parseCollectionAnalysisProfileSelection(value.selection, collection);
	return value as unknown as SeoAdminCollectionAnalysisProfileResult;
}

export function parseSeoCollectionAnalysisProfileSaveResult(value: unknown, collection: string): SeoAdminCollectionAnalysisProfileSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("collectionAnalysisProfile.save");
	assertContractVersion(value, "collectionAnalysisProfile.contractVersion");
	if (typeof value.engineVersion !== "string") contractError("collectionAnalysisProfile.engineVersion");
	if (value.success) {
		const result = parseSeoCollectionAnalysisProfileResult(value, collection);
		if (result.selection.state !== "configured") contractError("collectionAnalysisProfile.saved");
	} else if (typeof value.error !== "string" || !value.error ||
		(value.conflict !== undefined && typeof value.conflict !== "boolean")) contractError("collectionAnalysisProfile.error");
	return value as unknown as SeoAdminCollectionAnalysisProfileSaveResult;
}

const READABLE_SETTINGS_STATES = new Set(["absent", "saved", "legacy", "historical-seed"]);

/**
 * The source state, revision and legacy guard decide which writes the view
 * may offer, so each combination is checked rather than defaulted.
 */
export function parseSeoAdminSettings(value: unknown): SeoAdminSettings {
	if (!isRecord(value)) contractError("settings.root");
	assertContractVersion(value, "settings.contractVersion");
	if (value.storageVersion !== SEO_ADMIN_SETTINGS_STORAGE_VERSION)
		contractError("settings.storageVersion");
	if (typeof value.engineVersion !== "string") contractError("settings.engineVersion");
	if (value.updatedAt !== null && typeof value.updatedAt !== "string")
		contractError("settings.updatedAt");
	if (value.revision !== null &&
		(typeof value.revision !== "string" || !value.revision || value.revision.length > 128))
		contractError("settings.revision");
	const contentScoring = parseContentScoringPolicy(value.contentScoring);
	if (value.hostSiteUrl !== undefined && typeof value.hostSiteUrl !== "string")
		contractError("settings.hostSiteUrl");
	if (typeof value.legacyPresent !== "boolean" || typeof value.indexingPreferenceConfirmed !== "boolean")
		contractError("settings.source");
	if (value.state === "corrupt" || value.state === "unavailable") {
		if (contentScoring.state !== "unavailable" || value.values !== null || value.updatedAt !== null || value.legacyGuard !== null ||
			value.legacyPresent || value.indexingPreferenceConfirmed ||
			(value.state === "unavailable" && value.revision !== null))
			contractError("settings.state");
		return value as unknown as SeoAdminSettings;
	}
	if (typeof value.state !== "string" || !READABLE_SETTINGS_STATES.has(value.state)) contractError("settings.state");
	const stored = value.state === "saved" || value.state === "historical-seed";
	if (stored !== (value.revision !== null)) contractError("settings.revision");
	if (stored
		? value.legacyGuard !== null || value.legacyPresent
		: typeof value.legacyGuard !== "string" || !SEO_ADMIN_LEGACY_SETTINGS_GUARD_PATTERN.test(value.legacyGuard))
		contractError("settings.legacyGuard");
	if (value.indexingPreferenceConfirmed && value.state !== "saved") contractError("settings.source");
	if ((value.state === "saved") !== (typeof value.updatedAt === "string")) contractError("settings.updatedAt");
	const values = parseSettingsValues(value.values);
	if (contentScoring.state !== "unavailable" && (contentScoring.revision !== value.revision || contentScoring.intentEnabled !== values.contentScoringEnabled))
		contractError("settings.contentScoring.source");
	if (value.state === "historical-seed" && !values.noindex) contractError("settings.values.noindex");
	return { ...value, values } as SeoAdminSettings;
}

export function parseSeoAdminSettingsSaveResult(value: unknown): SeoAdminSettingsSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("settings.save");
	if (value.success) {
		const settings = parseSeoAdminSettings(value.settings);
		if (settings.values === null) contractError("settings.save.state");
		return { success: true, settings };
	}
	if (
		!isRecord(value.errors) ||
		Object.values(value.errors).some((item) => typeof item !== "string") ||
		(value.conflict !== undefined && typeof value.conflict !== "boolean")
	) {
		contractError("settings.errors");
	}
	return value as unknown as SeoAdminSettingsSaveResult;
}

function parseSitemapValues(value: unknown, keys: readonly string[]): SeoAdminSitemapValues {
	if (!isRecord(value) || !isRecord(value.contentTypes)) contractError("sitemap.values");
	if (Object.keys(value.contentTypes).length !== keys.length)
		contractError("sitemap.values.contentTypes");
	for (const contentType of keys) {
		if (typeof value.contentTypes[contentType] !== "boolean")
			contractError(`sitemap.values.contentTypes.${contentType}`);
	}
	if (
		!Array.isArray(value.excludedPaths) ||
		!value.excludedPaths.every((item) => typeof item === "string")
	) {
		contractError("sitemap.values.excludedPaths");
	}
	return value as unknown as SeoAdminSitemapValues;
}

function parsePublicFiles(value: unknown, path: string): void {
	if (!isRecord(value)) contractError(path);
	const origin = value.origin;
	if (origin !== null && (typeof origin !== "string" || !/^https?:\/\/[^/?#]+$/.test(origin)))
		contractError(`${path}.origin`);
	if (value.source !== null && value.source !== "site-identity" && value.source !== "emdash-site" && value.source !== "astro-site")
		contractError(`${path}.source`);
	if ((origin === null) !== (value.source === null)) contractError(`${path}.source`);
	for (const [field, file] of [["sitemapUrl", "/sitemap.xml"], ["robotsUrl", "/robots.txt"]] as const) {
		if (value[field] !== (origin === null ? null : `${origin}${file}`)) contractError(`${path}.${field}`);
	}
}

const SITEMAP_SETTINGS_STATES = ["default", "saved", "corrupt", "unavailable"];
const SITEMAP_COLLECTION_KEY = /^[a-z][a-z0-9_]{0,62}$/;

function isSitemapCursorValue(value: unknown): boolean {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function parseSeoAdminSitemap(value: unknown): SeoAdminSitemapConfiguration {
	if (!isRecord(value)) contractError("sitemap.root");
	assertContractVersion(value, "sitemap.contractVersion");
	if (value.storageVersion !== SEO_ADMIN_SITEMAP_STORAGE_VERSION)
		contractError("sitemap.storageVersion");
	if (typeof value.engineVersion !== "string") contractError("sitemap.engineVersion");
	if (value.updatedAt !== null && typeof value.updatedAt !== "string")
		contractError("sitemap.updatedAt");
	if (value.revision !== null && (typeof value.revision !== "string" || !value.revision || value.revision.length > 128))
		contractError("sitemap.revision");
	if (!SITEMAP_SETTINGS_STATES.includes(value.settings as string)) contractError("sitemap.settings");
	if (typeof value.writable !== "boolean" || typeof value.moduleEnabled !== "boolean") contractError("sitemap.flags");
	if (!(SEO_SITEMAP_OWNERS as readonly unknown[]).includes(value.owner)) contractError("sitemap.owner");
	if (value.ownerDetail !== null && typeof value.ownerDetail !== "string") contractError("sitemap.ownerDetail");
	if (!(SEO_SITEMAP_AVAILABILITY as readonly unknown[]).includes(value.availability)) contractError("sitemap.availability");
	if (!Array.isArray(value.groups)) contractError("sitemap.groups");
	const keys = new Set<string>();
	for (const group of value.groups) {
		if (
			!isRecord(group) ||
			typeof group.key !== "string" ||
			!SITEMAP_COLLECTION_KEY.test(group.key) ||
			typeof group.label !== "string" ||
			(group.source !== "saved" && group.source !== "default") ||
			(group.urlPattern !== null && typeof group.urlPattern !== "string") ||
			typeof group.unique !== "boolean" ||
			keys.has(group.key)
		)
			contractError("sitemap.group");
		keys.add(group.key);
	}
	if (!Array.isArray(value.preservedKeys) || !value.preservedKeys.every((key) => typeof key === "string" && !keys.has(key)))
		contractError("sitemap.preservedKeys");
	if (value.noindexContentTypes !== undefined && !(Array.isArray(value.noindexContentTypes) &&
		value.noindexContentTypes.every((key, index, list) => typeof key === "string" && keys.has(key) && list.indexOf(key) === index)))
		contractError("sitemap.noindexContentTypes");
	parseSitemapValues(value.values, [...keys, ...value.preservedKeys]);
	if (!Array.isArray(value.overlaps) || !value.overlaps.every((item) =>
		isRecord(item) && Array.isArray(item.collections) && item.collections.length === 2 &&
		item.collections.every((key) => typeof key === "string" && keys.has(key))))
		contractError("sitemap.overlaps");
	if (value.plan !== null) {
		if (!Array.isArray(value.plan)) contractError("sitemap.plan");
		for (const plan of value.plan) {
			if (!isRecord(plan) || typeof plan.collection !== "string" || !keys.has(plan.collection) ||
				typeof plan.label !== "string" || !Number.isInteger(plan.candidates) || (plan.candidates as number) < 0 ||
				!Array.isArray(plan.files) || plan.files.some((cursor, index) => index === 0 ? cursor !== null : !isSitemapCursorValue(cursor)) ||
				(plan.candidates === 0) !== (plan.files.length === 0))
				contractError("sitemap.plan.item");
		}
	}
	if (!Number.isInteger(value.pageSize) || (value.pageSize as number) < 1) contractError("sitemap.pageSize");
	parsePublicFiles(value.publicFiles, "sitemap.publicFiles");
	return value as unknown as SeoAdminSitemapConfiguration;
}

function isPlainOrigin(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 2048) return false;
	try {
		const parsed = new URL(value);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value;
	} catch {
		return false;
	}
}

export function parseSeoAdminRobotsTxtFacts(value: unknown): SeoAdminRobotsTxtFacts {
	if (!isRecord(value)) contractError("robotsTxt.root");
	assertContractVersion(value, "robotsTxt.contractVersion");
	if (typeof value.engineVersion !== "string") contractError("robotsTxt.engineVersion");
	if (!(SEO_ROBOTS_TXT_OWNERS as readonly unknown[]).includes(value.owner)) contractError("robotsTxt.owner");
	if (value.ownerDetail !== null && (typeof value.ownerDetail !== "string" || value.ownerDetail.length > 300))
		contractError("robotsTxt.ownerDetail");
	if (value.hostVersion !== null && (typeof value.hostVersion !== "string" || value.hostVersion.length > 64))
		contractError("robotsTxt.hostVersion");
	if (typeof value.configuredOriginKnown !== "boolean") contractError("robotsTxt.configuredOriginKnown");
	const configured = value.configuredOrigin;
	if (configured !== null && (
		!isRecord(configured) || !isPlainOrigin(configured.origin) ||
		(configured.source !== "emdash-config" && configured.source !== "environment")
	)) contractError("robotsTxt.configuredOrigin");
	if (!value.configuredOriginKnown && configured !== null) contractError("robotsTxt.configuredOrigin");
	return value as unknown as SeoAdminRobotsTxtFacts;
}

const LLMS_TXT_STATES = ["absent", "stored", "corrupt", "unavailable"];
const LLMS_TXT_WRITE_REASONS = ["conflict", "invalid", "blocked", "unavailable"];

function validLlmsRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/** Strict reading of the llms.txt state; a stored text must be a valid document with its exact byte count. */
export function parseSeoAdminLlmsTxt(value: unknown): SeoAdminLlmsTxt {
	if (!isRecord(value)) contractError("llmsTxt.root");
	assertContractVersion(value, "llmsTxt.contractVersion");
	if (typeof value.engineVersion !== "string") contractError("llmsTxt.engineVersion");
	if (!(SEO_LLMS_TXT_OWNERS as readonly unknown[]).includes(value.owner)) contractError("llmsTxt.owner");
	if (value.ownerDetail !== null && (typeof value.ownerDetail !== "string" || value.ownerDetail.length > 300))
		contractError("llmsTxt.ownerDetail");
	if (value.hostVersion !== null && (typeof value.hostVersion !== "string" || value.hostVersion.length > 64))
		contractError("llmsTxt.hostVersion");
	if (typeof value.conditionalStorage !== "boolean") contractError("llmsTxt.conditionalStorage");
	if (!LLMS_TXT_STATES.includes(value.state as string)) contractError("llmsTxt.state");
	const hasRecord = value.state === "stored" || value.state === "corrupt";
	if (hasRecord ? !validLlmsRevision(value.revision) : value.revision !== null) contractError("llmsTxt.revision");
	if (typeof value.enabled !== "boolean" || (value.state !== "stored" && value.enabled)) contractError("llmsTxt.enabled");
	if (value.state === "stored") {
		if (!checkLlmsTxtDocument(value.text).ok) contractError("llmsTxt.text");
		if (value.enabled && !checkLlmsTxtActivation(value.text).ok) contractError("llmsTxt.text");
		if (value.bytes !== llmsTxtUtf8Bytes(value.text as string)) contractError("llmsTxt.bytes");
	} else if (value.text !== null || value.bytes !== null) contractError("llmsTxt.text");
	const corrupt = value.corrupt;
	if (value.state === "corrupt") {
		if (!isRecord(corrupt) || !(SEO_LLMS_TXT_CORRUPT_REASONS as readonly unknown[]).includes(corrupt.reason) ||
			typeof corrupt.detail !== "string" || corrupt.detail.length > 500 ||
			!Number.isInteger(corrupt.copyBytes) || (corrupt.copyBytes as number) < 0 ||
			(corrupt.copy !== null && (typeof corrupt.copy !== "string" || llmsTxtUtf8Bytes(corrupt.copy) !== corrupt.copyBytes ||
				(corrupt.copyBytes as number) > LLMS_TXT_STORED_COPY_MAX_BYTES))) contractError("llmsTxt.corrupt");
	} else if (corrupt !== null) contractError("llmsTxt.corrupt");
	if (!isRecord(value.limits) || value.limits.documentBytes !== LLMS_TXT_DOCUMENT_MAX_BYTES ||
		value.limits.requestBytes !== LLMS_TXT_WRITE_REQUEST_MAX_BYTES) contractError("llmsTxt.limits");
	if (value.path !== "/llms.txt" || typeof value.cacheControl !== "string") contractError("llmsTxt.path");
	return value as unknown as SeoAdminLlmsTxt;
}

export function parseSeoAdminLlmsTxtWriteResult(value: unknown): SeoAdminLlmsTxtWriteResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("llmsTxt.write");
	if (value.success) {
		if (typeof value.changed !== "boolean") contractError("llmsTxt.write.changed");
		return { success: true, changed: value.changed, llms: parseSeoAdminLlmsTxt(value.llms) };
	}
	if (!LLMS_TXT_WRITE_REASONS.includes(value.reason as string) || typeof value.message !== "string" ||
		value.message.length > 1000 || (value.field !== undefined && value.field !== "text")) contractError("llmsTxt.write.reason");
	return value as unknown as SeoAdminLlmsTxtWriteResult;
}

export function parseSeoAdminSitemapSaveResult(value: unknown): SeoAdminSitemapSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("sitemap.save");
	if (value.success) return { success: true, sitemap: parseSeoAdminSitemap(value.sitemap) };
	if (
		!isRecord(value.errors) ||
		Object.values(value.errors).some((item) => typeof item !== "string") ||
		(value.conflict !== undefined && value.conflict !== true)
	) {
		contractError("sitemap.errors");
	}
	return value as unknown as SeoAdminSitemapSaveResult;
}

export function parseSeoAdminSitemapPreview(value: unknown): SeoAdminSitemapPreview {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("sitemap.preview");
	if (!value.success) {
		if (!isRecord(value.errors) || typeof value.errors._form !== "string" ||
			(value.stale !== undefined && value.stale !== true)) contractError("sitemap.preview.errors");
		return value as unknown as SeoAdminSitemapPreview;
	}
	const cursorValid = (cursor: unknown) => cursor === null ||
		(typeof cursor === "string" && cursor.length > 0 && cursor.length <= 192);
	if (typeof value.collection !== "string" || !SITEMAP_COLLECTION_KEY.test(value.collection) ||
		(value.after !== null && !isSitemapCursorValue(value.after)) ||
		(value.fileUrl !== null && typeof value.fileUrl !== "string") ||
		typeof value.search !== "string" || value.search.length > 160 ||
		!(value.status === "all" || value.status === "included" || value.status === "excluded") ||
		(value.limit !== 25 && value.limit !== 50) ||
		![value.included, value.excluded, value.total, value.matched, value.offset].every(nonNegativeInteger) ||
		!cursorValid(value.previousCursor) || !cursorValid(value.nextCursor) ||
		!Array.isArray(value.entries) || value.entries.length > value.limit)
		contractError("sitemap.preview.file");
	for (const entry of value.entries) {
		if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.locale !== "string" ||
			!(SITEMAP_ENTRY_STATUSES as readonly unknown[]).includes(entry.status) ||
			[entry.path, entry.url, entry.lastmod, entry.image, entry.canonical].some((item) => item !== null && typeof item !== "string") ||
			!nonNegativeInteger(entry.alternates))
			contractError("sitemap.preview.entry");
	}
	const { included, excluded, total, matched, offset, limit } = value as {
		included: number; excluded: number; total: number; matched: number; offset: number; limit: number;
	};
	if (included + excluded !== total || matched > total || offset > matched ||
		(offset > 0 && offset >= matched) || offset % limit !== 0 || value.entries.length !== Math.min(limit, matched - offset) ||
		(offset === 0) !== (value.previousCursor === null) ||
		(offset + value.entries.length === matched) !== (value.nextCursor === null))
		contractError("sitemap.preview.counts");
	return value as unknown as SeoAdminSitemapPreview;
}

function parseIndexNowValues(value: unknown): IndexNowSettingsValues {
	if (
		!isRecord(value) ||
		typeof value.enabled !== "boolean" ||
		typeof value.autoSubmit !== "boolean" ||
		!(value.autoSubmitContentTypes === null ||
			(Array.isArray(value.autoSubmitContentTypes) && value.autoSubmitContentTypes.length <= 100 &&
				value.autoSubmitContentTypes.every(isSeoContentCollectionKey) &&
				new Set(value.autoSubmitContentTypes).size === value.autoSubmitContentTypes.length)) ||
		typeof value.apiKey !== "string" ||
		typeof value.keyLocation !== "string" ||
		!Number.isInteger(value.batchSize) ||
		!Number.isInteger(value.minIntervalSeconds) ||
		!Number.isInteger(value.maxAttempts)
	)
		contractError("indexNow.values");
	return value as unknown as IndexNowSettingsValues;
}

function parseIndexNowJob(value: unknown): void {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		value.storageVersion !== SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION ||
		typeof value.url !== "string" ||
		(value.ref !== null && typeof value.ref !== "string") ||
		!("publish,update,unpublish,delete,manual".split(",") as unknown[]).includes(value.reason) ||
		!("pending,retry,delivered,failed".split(",") as unknown[]).includes(value.status) ||
		!nonNegativeInteger(value.attempts) ||
		(value.nextAttemptAt !== null && typeof value.nextAttemptAt !== "string") ||
		(value.lastHttpStatus !== null &&
			(typeof value.lastHttpStatus !== "number" ||
			!Number.isInteger(value.lastHttpStatus) ||
			value.lastHttpStatus < 100 ||
				value.lastHttpStatus > 599)) ||
		(value.lastError !== null && typeof value.lastError !== "string") ||
		(value.lastSubmittedAt !== null && typeof value.lastSubmittedAt !== "string") ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string" ||
		(value.submissionId !== undefined && value.submissionId !== null && typeof value.submissionId !== "string")
	)
		contractError("indexNow.job");
}

function parseIndexNowDelivery(value: unknown): void {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		value.storageVersion !== SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION ||
		!("accepted,retry,failed".split(",") as unknown[]).includes(value.status) ||
		!nonNegativeInteger(value.urlCount) ||
		!Array.isArray(value.urls) ||
		!value.urls.every((item) => typeof item === "string") ||
		value.urlCount !== value.urls.length ||
		(value.httpStatus !== null &&
			(typeof value.httpStatus !== "number" ||
			!Number.isInteger(value.httpStatus) ||
			value.httpStatus < 100 ||
				value.httpStatus > 599)) ||
		typeof value.attempt !== "number" ||
		!Number.isInteger(value.attempt) ||
		value.attempt < 1 ||
		typeof value.detail !== "string" ||
		(value.retryAt !== null && typeof value.retryAt !== "string") ||
		typeof value.createdAt !== "string"
	)
		contractError("indexNow.delivery");
}

export function parseSeoAdminIndexNowStatus(value: unknown): SeoAdminIndexNowStatus {
	if (!isRecord(value)) contractError("indexNow.root");
	assertContractVersion(value, "indexNow.contractVersion");
	if (value.protocolVersion !== INDEXNOW_PROTOCOL_VERSION)
		contractError("indexNow.protocolVersion");
	if (value.storageVersion !== SEO_ADMIN_INDEXNOW_STORAGE_VERSION)
		contractError("indexNow.storageVersion");
	if (value.endpoint !== INDEXNOW_ENDPOINT) contractError("indexNow.endpoint");
	if (typeof value.engineVersion !== "string" || typeof value.generatedAt !== "string")
		contractError("indexNow.metadata");
	if (value.updatedAt !== null && typeof value.updatedAt !== "string")
		contractError("indexNow.updatedAt");
	if (value.keyLocationUrl !== null && typeof value.keyLocationUrl !== "string")
		contractError("indexNow.keyLocationUrl");
	if (typeof value.manualSubmissionReady !== "boolean")
		contractError("indexNow.manualSubmissionReady");
	parseIndexNowValues(value.values);
	if (typeof value.contentTypeDiscoveryAvailable !== "boolean" ||
		!Array.isArray(value.contentTypes) ||
		value.contentTypes.some((item) => !isRecord(item) ||
			!isSeoContentCollectionKey(item.collection) || typeof item.label !== "string") ||
		new Set(value.contentTypes.map((item) => item.collection)).size !== value.contentTypes.length)
		contractError("indexNow.contentTypes");
	if (value.contentTypeRules !== undefined && !(Array.isArray(value.contentTypeRules) &&
		value.contentTypeRules.every((item) => isRecord(item) && isSeoContentCollectionKey(item.collection) &&
			typeof item.label === "string" && typeof item.urlPattern === "string" && item.urlPattern.length > 0) &&
		new Set(value.contentTypeRules.map((item) => item.collection)).size === value.contentTypeRules.length))
		contractError("indexNow.contentTypeRules");
	if (
		!isRecord(value.readiness) ||
		!("ready,disabled,needs-setup,unavailable".split(",") as unknown[]).includes(
			value.readiness.state,
		) ||
		typeof value.readiness.title !== "string" ||
		typeof value.readiness.description !== "string"
	)
		contractError("indexNow.readiness");
	if (
		!isRecord(value.capabilities) ||
		typeof value.capabilities.network !== "boolean" ||
		typeof value.capabilities.cron !== "boolean"
	) {
		contractError("indexNow.capabilities");
	}
	if (
		!isRecord(value.queue) ||
		![value.queue.pending, value.queue.retrying, value.queue.failed, value.queue.delivered].every(
			nonNegativeInteger,
		) ||
		(value.queue.lastAcceptedAt !== null && typeof value.queue.lastAcceptedAt !== "string")
	)
		contractError("indexNow.queue");
	if (!Array.isArray(value.jobs) || !Array.isArray(value.deliveries))
		contractError("indexNow.history");
	value.jobs.forEach(parseIndexNowJob);
	value.deliveries.forEach(parseIndexNowDelivery);
	parseIndexNowSetup(value.setup);
	return value as unknown as SeoAdminIndexNowStatus;
}

const INDEXNOW_SETUP_ISSUES = ["missing-site", "local-site", "invalid-site", "permission", "key-route"] as unknown[];
const INDEXNOW_KEY_ROUTES = ["injected", "existing", "unavailable"] as unknown[];
const INDEXNOW_SETUP_STEPS = ["origin", "key", "verify", "enable"] as unknown[];
const INDEXNOW_HISTORY_RECORDINGS = ["recorded", "partial", "unavailable"] as unknown[];
const INDEXNOW_SUBMISSION_EVENTS = ["publish", "update", "unpublish", "delete", "url-change"] as unknown[];
const INDEXNOW_SUBMISSION_DETAILS = ["sample", "pages", "expiring", "expired"] as unknown[];

function nullableString(value: unknown): boolean {
	return value === null || typeof value === "string";
}

function parseIndexNowSetup(value: unknown): void {
	if (
		!isRecord(value) ||
		!nullableString(value.origin) ||
		!(["astro", "legacy", "unknown"] as unknown[]).includes(value.installation) ||
		!(value.hostPermission === null || typeof value.hostPermission === "boolean") ||
		(value.installation === "unknown") !== (value.hostPermission === null) ||
		!(value.keyRoute === null || INDEXNOW_KEY_ROUTES.includes(value.keyRoute)) ||
		typeof value.keySaved !== "boolean" ||
		!nullableString(value.verifiedAt) ||
		!(value.issue === null || (isRecord(value.issue) &&
			INDEXNOW_SETUP_ISSUES.includes(value.issue.code) &&
			typeof value.issue.title === "string" && typeof value.issue.description === "string"))
	)
		contractError("indexNow.setup");
}

function ascendingPositions(value: unknown, length: number): boolean {
	return Array.isArray(value) && value.length <= length && value.every((position, index) =>
		integerInRange(position, 0, length - 1) && (index === 0 || position > (value[index - 1] as number)));
}

// History rows are their own type: a bounded URL sample with the original
// count. They never pass through the delivery parser.
function parseIndexNowSubmission(value: unknown): SeoAdminIndexNowSubmission {
	if (!isRecord(value) || !isRecord(value.counts)) contractError("indexNow.submission");
	const counts = value.counts;
	const sampleUrls = value.sampleUrls;
	if (
		typeof value.id !== "string" || !value.id ||
		value.storageVersion !== SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION ||
		(value.source !== "automatic" && value.source !== "manual") ||
		!(value.event === null || INDEXNOW_SUBMISSION_EVENTS.includes(value.event)) ||
		(value.source === "manual") !== (value.event === null) ||
		!nullableString(value.ref) ||
		!integerInRange(value.urlCount, 1, INDEXNOW_MANUAL_URL_LIMIT) ||
		!Array.isArray(sampleUrls) ||
		sampleUrls.length !== Math.min(value.urlCount as number, INDEXNOW_HISTORY_SAMPLE_URLS) ||
		!sampleUrls.every((url) => typeof url === "string") ||
		!ascendingPositions(value.sampleSkipped, sampleUrls.length) ||
		!INDEXNOW_SUBMISSION_DETAILS.includes(value.detail) ||
		(value.detail === "sample") !== ((value.urlCount as number) <= INDEXNOW_HISTORY_SAMPLE_URLS) ||
		!INDEXNOW_SUBMISSION_BUCKETS.every((bucket) => nonNegativeInteger(counts[bucket])) ||
		Object.keys(counts).length !== INDEXNOW_SUBMISSION_BUCKETS.length ||
		INDEXNOW_SUBMISSION_BUCKETS.reduce((sum, bucket) => sum + (counts[bucket] as number), 0) !== value.urlCount ||
		(value.sampleSkipped as number[]).length > (counts.skipped as number) ||
		!INDEXNOW_SUBMISSION_STATUSES.includes(value.status as never) ||
		value.status !== indexNowSubmissionStatus(counts as never) ||
		!nonNegativeInteger(value.attempts) ||
		!nullableString(value.lastAttemptAt) ||
		(value.lastHttpStatus !== null && !integerInRange(value.lastHttpStatus, 100, 599)) ||
		!nullableString(value.nextAttemptAt) ||
		!nullableString(value.lastDetail) ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string"
	)
		contractError("indexNow.submission");
	return value as unknown as SeoAdminIndexNowSubmission;
}

export function parseSeoAdminIndexNowHistoryResult(value: unknown): SeoAdminIndexNowHistoryResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("indexNow.historyResult");
	if (!value.success) {
		if (value.error !== "invalid_cursor" || typeof value.detail !== "string")
			contractError("indexNow.historyResult.error");
		return value as unknown as SeoAdminIndexNowHistoryResult;
	}
	const page = value.history;
	if (!isRecord(page)) contractError("indexNow.historyPage");
	assertContractVersion(page, "indexNow.historyPage.contractVersion");
	if (
		typeof page.engineVersion !== "string" ||
		typeof page.generatedAt !== "string" ||
		typeof page.available !== "boolean" ||
		!isRecord(page.filters) ||
		!(page.filters.status === null || INDEXNOW_SUBMISSION_STATUSES.includes(page.filters.status as never)) ||
		!(page.filters.source === null || page.filters.source === "automatic" || page.filters.source === "manual") ||
		!integerInRange(page.pageSize, 1, INDEXNOW_HISTORY_MAX_PAGE_SIZE) ||
		!nonNegativeInteger(page.total) ||
		!Array.isArray(page.items) ||
		page.items.length > (page.pageSize as number) ||
		!nullableString(page.cursor) ||
		page.hasMore !== (page.cursor !== null) ||
		!integerInRange(page.maxAttempts, 1, 10) ||
		!nonNegativeInteger(page.retention) ||
		!nullableString(page.historyStartedAt) ||
		(!page.available && (page.items.length > 0 || page.total !== 0 || page.cursor !== null))
	)
		contractError("indexNow.historyPage");
	const ids = new Set<string>();
	for (const item of page.items) {
		const submission = parseIndexNowSubmission(item);
		if (ids.has(submission.id) ||
			(page.filters.status !== null && submission.status !== page.filters.status) ||
			(page.filters.source !== null && submission.source !== page.filters.source))
			contractError("indexNow.historyPage.items");
		ids.add(submission.id);
	}
	return value as unknown as SeoAdminIndexNowHistoryResult;
}

export function parseSeoAdminIndexNowHistoryUrlsResult(value: unknown): SeoAdminIndexNowHistoryUrlsResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("indexNow.historyUrls");
	if (!value.success) {
		if (value.error !== "not_found" || typeof value.detail !== "string")
			contractError("indexNow.historyUrls.error");
		return value as unknown as SeoAdminIndexNowHistoryUrlsResult;
	}
	const page = value.urls;
	if (!isRecord(page)) contractError("indexNow.historyUrls.page");
	assertContractVersion(page, "indexNow.historyUrls.contractVersion");
	const maxPages = Math.ceil(INDEXNOW_MANUAL_URL_LIMIT / INDEXNOW_HISTORY_URL_PAGE_SIZE);
	if (
		typeof page.engineVersion !== "string" ||
		typeof page.generatedAt !== "string" ||
		typeof page.submissionId !== "string" || !page.submissionId ||
		!INDEXNOW_SUBMISSION_DETAILS.includes(page.detail) ||
		!integerInRange(page.urlCount, 1, INDEXNOW_MANUAL_URL_LIMIT) ||
		!integerInRange(page.page, 0, maxPages - 1) ||
		!integerInRange(page.pageCount, 0, maxPages) ||
		!Array.isArray(page.items) ||
		!page.items.every((item) => isRecord(item) && typeof item.url === "string" && typeof item.skipped === "boolean") ||
		((page.detail === "expired" || page.detail === "expiring") && (page.pageCount !== 0 || page.items.length !== 0)) ||
		(page.detail === "sample" && ((page.urlCount as number) > INDEXNOW_HISTORY_SAMPLE_URLS ||
			page.pageCount !== 1 || page.page !== 0 || page.items.length !== page.urlCount)) ||
		(page.detail !== "sample" && (page.urlCount as number) <= INDEXNOW_HISTORY_SAMPLE_URLS) ||
		(page.detail === "pages" && (
			page.pageCount !== Math.ceil((page.urlCount as number) / INDEXNOW_HISTORY_URL_PAGE_SIZE) ||
			(page.page as number) >= (page.pageCount as number) ||
			page.items.length !== Math.min(INDEXNOW_HISTORY_URL_PAGE_SIZE, (page.urlCount as number) - (page.page as number) * INDEXNOW_HISTORY_URL_PAGE_SIZE)))
	)
		contractError("indexNow.historyUrls.page");
	return value as unknown as SeoAdminIndexNowHistoryUrlsResult;
}

export function parseSeoAdminIndexNowSaveResult(value: unknown): SeoAdminIndexNowSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("indexNow.save");
	if (value.success)
		return { success: true, indexNow: parseSeoAdminIndexNowStatus(value.indexNow) };
	if (
		!isRecord(value.errors) ||
		Object.values(value.errors).some((item) => typeof item !== "string") ||
		(value.failedStep !== undefined && !INDEXNOW_SETUP_STEPS.includes(value.failedStep))
	) {
		contractError("indexNow.save.errors");
	}
	return value as unknown as SeoAdminIndexNowSaveResult;
}

export function parseSeoAdminIndexNowOperationResult(
	value: unknown,
): SeoAdminIndexNowOperationResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("indexNow.operation");
	if (value.success) {
		if (
			!nonNegativeInteger(value.enqueued) ||
			!nonNegativeInteger(value.skipped) ||
			!Array.isArray(value.rejected) ||
			!value.rejected.every((item) => typeof item === "string") ||
			(value.contentTypeNoindexUrls !== undefined && !(Array.isArray(value.contentTypeNoindexUrls) &&
				value.contentTypeNoindexUrls.every((item) => typeof item === "string"))) ||
			(value.history !== undefined && !INDEXNOW_HISTORY_RECORDINGS.includes(value.history))
		)
			contractError("indexNow.operation.summary");
		parseSeoAdminIndexNowStatus(value.indexNow);
		return value as unknown as SeoAdminIndexNowOperationResult;
	}
	if (
		!(
			"coexistence_paused,indexnow_disabled,indexnow_not_configured,network_unavailable,no_valid_urls,no_due_jobs,delivery_in_progress,delivery_failed".split(
				",",
			) as unknown[]
		).includes(value.error) ||
		typeof value.detail !== "string"
	)
		contractError("indexNow.operation.error");
	if (value.indexNow !== undefined) parseSeoAdminIndexNowStatus(value.indexNow);
	return value as unknown as SeoAdminIndexNowOperationResult;
}

function parseTemplateValues(value: unknown, field: string): SeoAdminTemplateValues {
	if (
		!isRecord(value) ||
		typeof value.title !== "string" ||
		typeof value.description !== "string" ||
		typeof value.socialTitle !== "string" ||
		typeof value.socialDescription !== "string"
	)
		contractError(field);
	return value as unknown as SeoAdminTemplateValues;
}

function parseOutputSupport(value: unknown, field: string): SeoAdminOutputSupport {
	if (!isRecord(value)) contractError(field);
	for (const key of ["htmlTitle", "metaDescription", "openGraph", "twitter"] as const) {
		if (value[key] !== "live" && value[key] !== "theme-bridge-required")
			contractError(`${field}.${key}`);
	}
	return value as unknown as SeoAdminOutputSupport;
}

const TEMPLATE_FIELDS = ["title", "description", "socialTitle", "socialDescription"] as const;
const TEMPLATE_REVISION_MAX_LENGTH = 256;

function templateRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= TEMPLATE_REVISION_MAX_LENGTH;
}

function parseTemplateGuard(value: unknown, field: string, absent: boolean): SeoAdminTemplateInheritanceGuard {
	if (!isRecord(value) || !isRecord(value.fields) || Object.keys(value.fields).length !== TEMPLATE_FIELDS.length) contractError(field);
	for (const key of TEMPLATE_FIELDS) {
		const revision = value.fields[key];
		if (revision !== null && !templateRevision(revision)) contractError(`${field}.fields.${key}`);
	}
	// The legacy token row is guarded only while no record exists.
	if (Object.hasOwn(value, "revisions") !== absent) contractError(`${field}.revisions`);
	if (absent && value.revisions !== null && !templateRevision(value.revisions)) contractError(`${field}.revisions`);
	return value as unknown as SeoAdminTemplateInheritanceGuard;
}

export function parseSeoAdminTemplateConfiguration(value: unknown): SeoAdminTemplateConfiguration {
	if (!isRecord(value)) contractError("templates.root");
	assertContractVersion(value, "templates.contractVersion");
	if (value.storageVersion !== SEO_ADMIN_TEMPLATES_STORAGE_VERSION)
		contractError("templates.storageVersion");
	if (typeof value.engineVersion !== "string") contractError("templates.engineVersion");
	const state = value.state;
	if (state !== "absent" && state !== "saved" && state !== "corrupt" && state !== "unavailable") contractError("templates.state");
	const revisioned = state === "saved" || state === "corrupt";
	if (revisioned ? !templateRevision(value.revision) : value.revision !== null) contractError("templates.revision");
	if (value.discovery !== "available" && value.discovery !== "unavailable") contractError("templates.discovery");
	if (
		!Array.isArray(value.allowedVariables) ||
		!value.allowedVariables.every((item) => typeof item === "string")
	) {
		contractError("templates.allowedVariables");
	}
	parseOutputSupport(value.outputSupport, "templates.outputSupport");
	if (
		!Array.isArray(value.retainedCollections) ||
		value.retainedCollections.length > 100 ||
		!value.retainedCollections.every((item) => isSeoContentCollectionKey(item))
	) {
		contractError("templates.retainedCollections");
	}
	if (!Array.isArray(value.items) || value.items.length > 100) contractError("templates.items");
	const listable = (state === "absent" || state === "saved") && value.discovery === "available";
	if (!listable && value.items.length > 0) contractError("templates.items");
	const keys = new Set<string>();
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			!isSeoContentCollectionKey(item.collection) ||
			keys.has(item.collection) ||
			typeof item.label !== "string" ||
			typeof item.description !== "string" ||
			!(["override", "legacy", "default"] as unknown[]).includes(item.source) ||
			!isRecord(item.inherited) ||
			(item.inherited.source !== "legacy" && item.inherited.source !== "default") ||
			!Array.isArray(item.inherited.ignoredLegacyFields) ||
			!item.inherited.ignoredLegacyFields.every((field) => (TEMPLATE_FIELDS as readonly unknown[]).includes(field))
		)
			contractError("templates.item");
		if (state === "absent" && item.source === "override") contractError("templates.item.source");
		keys.add(item.collection);
		parseTemplateValues(item.values, `templates.${item.collection}.values`);
		parseTemplateValues(item.inherited.values, `templates.${item.collection}.inherited`);
		parseTemplateGuard(item.inheritanceGuard, `templates.${item.collection}.inheritanceGuard`, state === "absent");
	}
	return value as unknown as SeoAdminTemplateConfiguration;
}

const TEMPLATE_COMMAND_FAILURES = ["invalid_input", "collection_unavailable", "corrupt", "unavailable", "unconfirmed"];

/** A command answer, bound to the collection it was sent for. */
export function parseSeoAdminTemplatesSaveResult(value: unknown, request: { collection: string }): SeoAdminTemplatesSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("templates.command");
	if (value.success) {
		if (value.outcome !== "saved" && value.outcome !== "unchanged") contractError("templates.command.outcome");
		if (value.collection !== request.collection) contractError("templates.command.collection");
		if (value.templates !== null) parseSeoAdminTemplateConfiguration(value.templates);
		return value as unknown as SeoAdminTemplatesSaveResult;
	}
	if (value.error === "invalid_values") {
		parseErrors(value.errors, "templates.command.errors");
		return value as unknown as SeoAdminTemplatesSaveResult;
	}
	if (typeof value.message !== "string") contractError("templates.command.message");
	if (value.error === "conflict") {
		if (value.templates !== null) parseSeoAdminTemplateConfiguration(value.templates);
		return value as unknown as SeoAdminTemplatesSaveResult;
	}
	if (!TEMPLATE_COMMAND_FAILURES.includes(value.error as string)) contractError("templates.command.error");
	return value as unknown as SeoAdminTemplatesSaveResult;
}

function nullableTemplateText(value: unknown): boolean {
	return value === null || typeof value === "string";
}

/** One examples page, bound to the collection, limit and cursor it answers. */
export function parseSeoAdminTemplateExamplesResult(
	value: unknown,
	request: { collection: string; limit: number; cursor?: string },
): SeoAdminTemplateExamplesResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("templates.examples");
	if (!value.success) {
		if (
			!(["invalid_input", "collection_unavailable", "content_unavailable", "response_too_large"] as unknown[]).includes(value.error) ||
			typeof value.message !== "string"
		)
			contractError("templates.examples.error");
		return value as unknown as SeoAdminTemplateExamplesResult;
	}
	assertContractVersion(value, "templates.examples.contractVersion");
	if (value.collection !== request.collection) contractError("templates.examples.collection");
	if (!Array.isArray(value.items) || value.items.length > request.limit) contractError("templates.examples.items");
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			typeof item.entryId !== "string" || !item.entryId || item.entryId.length > 128 ||
			typeof item.title !== "string" ||
			!nullableTemplateText(item.slug) ||
			typeof item.locale !== "string" ||
			!nullableTemplateText(item.publishedAt) ||
			!nullableTemplateText(item.updatedAt)
		)
			contractError("templates.examples.item");
	}
	if (typeof value.hasMore !== "boolean") contractError("templates.examples.hasMore");
	if (value.hasMore && (typeof value.cursor !== "string" || !value.cursor || value.cursor === request.cursor)) {
		contractError("templates.examples.cursor");
	}
	if (!value.hasMore && value.cursor !== undefined) contractError("templates.examples.cursor");
	return value as unknown as SeoAdminTemplateExamplesResult;
}

const TEMPLATE_EXAMPLE_FAILURES = [
	"collection_unavailable",
	"content_unavailable",
	"not_found",
	"not_published",
	"invalid_locale",
	"response_too_large",
];

/** One exact example, bound to the collection and entry it was requested for, refusals included. */
export function parseSeoAdminTemplateExampleResult(
	value: unknown,
	request: { collection: string; entryId: string },
): SeoAdminTemplateExampleResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("templates.example");
	if (!value.success) {
		if (typeof value.message !== "string") contractError("templates.example.error");
		if (value.error === "invalid_input") return value as unknown as SeoAdminTemplateExampleResult;
		if (!TEMPLATE_EXAMPLE_FAILURES.includes(value.error as string)) contractError("templates.example.error");
		if (value.collection !== request.collection || value.entryId !== request.entryId) contractError("templates.example.request");
		return value as unknown as SeoAdminTemplateExampleResult;
	}
	assertContractVersion(value, "templates.example.contractVersion");
	if (value.collection !== request.collection || value.entryId !== request.entryId) contractError("templates.example.request");
	const example = value.example;
	if (
		!isRecord(example) ||
		example.entryId !== request.entryId ||
		typeof example.title !== "string" ||
		!nullableTemplateText(example.slug) ||
		typeof example.locale !== "string" || !example.locale || example.locale.length > 35 ||
		!nullableTemplateText(example.publishedAt) ||
		!nullableTemplateText(example.updatedAt)
	)
		contractError("templates.example.example");
	return value as unknown as SeoAdminTemplateExampleResult;
}

const TEMPLATE_PREVIEW_SOURCES = [
	"legacy-override",
	"plugin-social-override",
	"core-seo",
	"template",
	"content",
	"site-default",
	"generated",
];
const TEMPLATE_PREVIEW_FAILURES = [
	"invalid_input",
	"collection_unavailable",
	"templates_unreadable",
	"settings_unreadable",
	"content_unavailable",
	"not_found",
	"locale_mismatch",
	"not_published",
	"no_public_url",
	"content_too_large",
	"stored_value_too_large",
	"expansion_too_large",
	"response_too_large",
	"entry_changed",
];

function parsePreviewField(value: unknown, field: string): void {
	if (!isRecord(value) || typeof value.value !== "string" || !TEMPLATE_PREVIEW_SOURCES.includes(value.source as string)) {
		contractError(field);
	}
}

/** A metadata preview, bound to the exact entry and locale it was requested for. */
export function parseSeoAdminTemplatePreviewResult(
	value: unknown,
	request: { collection: string; entryId: string; locale: string },
): SeoAdminTemplatePreviewResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("templates.preview");
	if (!value.success) {
		if (value.error === "invalid_values") {
			parseErrors(value.errors, "templates.preview.errors");
			return value as unknown as SeoAdminTemplatePreviewResult;
		}
		if (!TEMPLATE_PREVIEW_FAILURES.includes(value.error as string) || typeof value.message !== "string") {
			contractError("templates.preview.error");
		}
		return value as unknown as SeoAdminTemplatePreviewResult;
	}
	const preview = value.preview;
	if (
		!isRecord(preview) ||
		preview.collection !== request.collection ||
		preview.entryId !== request.entryId ||
		preview.locale !== request.locale ||
		typeof preview.slug !== "string" ||
		preview.status !== "published" ||
		!nullableTemplateText(preview.publishedAt) ||
		(preview.version !== null && typeof preview.version !== "number") ||
		typeof preview.publicUrl !== "string" ||
		!/^https?:\/\//i.test(preview.publicUrl) ||
		typeof preview.noindex !== "boolean"
	)
		contractError("templates.preview.entry");
	for (const field of ["description", "socialTitle", "socialDescription", "titleSuggestion"] as const) {
		parsePreviewField(preview[field], `templates.preview.${field}`);
	}
	return value as unknown as SeoAdminTemplatePreviewResult;
}

export function parseSeoAdminEntryPreviewResult(value: unknown): SeoAdminEntryPreviewResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("preview.result");
	if (!value.success) {
		if (
			!(
				["invalid_ref", "content_unavailable", "not_found", "invalid_template"] as unknown[]
			).includes(value.error)
		) {
			contractError("preview.error");
		}
		if (
			value.errors !== undefined &&
			(!isRecord(value.errors) ||
				Object.values(value.errors).some((item) => typeof item !== "string"))
		) {
			contractError("preview.errors");
		}
		return value as unknown as SeoAdminEntryPreviewResult;
	}
	if (!isRecord(value.preview)) contractError("preview");
	const preview = value.preview;
	assertContractVersion(preview, "preview.contractVersion");
	if ((preview.sourceKind !== undefined || preview.sourceVersion !== undefined) &&
		(preview.sourceKind !== "saved-snapshot" || typeof preview.sourceVersion !== "string" ||
			!preview.sourceVersion || preview.sourceVersion.length > 2_048)) {
		contractError("preview.savedSnapshot");
	}
	if (
		typeof preview.engineVersion !== "string" ||
		typeof preview.generatedAt !== "string" ||
		!isRecord(preview.content) ||
		typeof preview.content.ref !== "string" ||
		typeof preview.content.collection !== "string" ||
		typeof preview.content.entryId !== "string" ||
		!preview.content.entryId ||
		preview.content.ref !== `${preview.content.collection}:${preview.content.entryId}` ||
		!isRecord(preview.search) ||
		typeof preview.search.title !== "string" ||
		typeof preview.search.description !== "string" ||
		(preview.search.fallbackTitle !== undefined &&
			typeof preview.search.fallbackTitle !== "string") ||
		(preview.search.fallbackDescription !== undefined &&
			typeof preview.search.fallbackDescription !== "string") ||
		typeof preview.search.url !== "string" ||
		typeof preview.search.titleLength !== "number" ||
		typeof preview.search.descriptionLength !== "number" ||
		!isRecord(preview.social) ||
		typeof preview.social.title !== "string" ||
		typeof preview.social.description !== "string" ||
		(preview.social.image !== null && typeof preview.social.image !== "string") ||
		typeof preview.social.fallbackTitle !== "string" ||
		typeof preview.social.fallbackDescription !== "string" ||
		!isRecord(preview.social.override) ||
		(preview.social.override.title !== null && typeof preview.social.override.title !== "string") ||
		(preview.social.override.description !== null &&
			typeof preview.social.override.description !== "string") ||
		(preview.social.override.updatedAt !== null &&
			typeof preview.social.override.updatedAt !== "string") ||
		typeof preview.indexable !== "boolean" ||
		typeof preview.entryNoindex !== "boolean" ||
		!isRecord(preview.canonicalValidation) ||
		!(SEO_CANONICAL_STATUSES as readonly unknown[]).includes(preview.canonicalValidation.status) ||
		typeof preview.canonicalValidation.canonical !== "string" ||
		(preview.canonicalValidation.expectedPath !== null &&
			typeof preview.canonicalValidation.expectedPath !== "string") ||
		!Array.isArray(preview.schemaTypes) ||
		!preview.schemaTypes.every((item) => typeof item === "string") ||
		!isRecord(preview.sources)
	)
		contractError("preview.shape");
	const editing = preview.social.editing;
	if (!isRecord(editing)) contractError("preview.social.editing");
	if (editing.state === "ready") {
		const snapshot = parseSocialOverrideSnapshot(editing.snapshot, "preview.social.editing");
		if (snapshot.ref !== preview.content.ref) contractError("preview.social.editing");
	} else if (editing.state !== "unavailable" ||
		!(["storage_unavailable", "record_invalid", "snapshot_changed"] as unknown[]).includes(editing.reason)) {
		contractError("preview.social.editing");
	}
	parseLocaleGraph(preview.localeGraph, "preview.localeGraph");
	for (const source of Object.values(preview.sources)) {
		if (
			!(
				[
					"legacy-override",
					"plugin-social-override",
					"core-seo",
					"template",
					"content",
					"site-default",
					"generated",
				] as unknown[]
			).includes(source)
		) {
			contractError("preview.sources");
		}
	}
	const fallbackImage = preview.social.fallbackImage;
	if (fallbackImage !== undefined && !(isRecord(fallbackImage) &&
		(fallbackImage.value === null || typeof fallbackImage.value === "string") &&
		(METADATA_SOURCES as readonly unknown[]).includes(fallbackImage.source)))
		contractError("preview.social.fallbackImage");
	parseOutputSupport(preview.outputSupport, "preview.outputSupport");
	if (preview.ownership !== undefined) parseEntryOwnership(preview.ownership, preview);
	if (preview.noindexSources !== undefined && !(Array.isArray(preview.noindexSources) &&
		preview.noindexSources.every((source, index, list) => (SEO_NOINDEX_SOURCES as readonly unknown[]).includes(source) &&
			list.indexOf(source) === index) &&
		(preview.noindexSources.length === 0) === preview.indexable))
		contractError("preview.noindexSources");
	if (preview.bodyAnalysis !== undefined) {
		const body = preview.bodyAnalysis;
		if (!isRecord(body) || body.version !== 1 || !(body.bodyField === null || typeof body.bodyField === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(body.bodyField) && !["constructor", "prototype", "__proto__"].includes(body.bodyField)) ||
			(body.mapping !== undefined && (!validSeoBodyMapping(body.mapping) || JSON.stringify(body.mapping).length > 65_536 || body.mapping.bodyField !== body.bodyField || body.mapping.collection !== preview.content.collection))) contractError("preview.bodyAnalysis");
	}
	if (preview.analysis !== undefined && !(isRecord(preview.analysis) &&
		(["imageAltChecks", "schemaOutput", "nosnippet", "descriptionGenerated"] as const)
			.every((key) => typeof (preview.analysis as Record<string, unknown>)[key] === "boolean")))
		contractError("preview.analysis");
	return value as unknown as { success: true; preview: SeoAdminEntryPreview };
}

const METADATA_SOURCES = [
	"legacy-override",
	"plugin-social-override",
	"core-seo",
	"template",
	"content",
	"site-default",
	"generated",
] as const;
const OWNERSHIP_ENTRY_REASONS = [
	"saved-version-mismatch",
	"saved-version-unavailable",
	"core-seo-unavailable",
	"core-seo-invalid",
	"snapshot-seo-mismatch",
] as const;
const OWNERSHIP_FIELD_REASONS = [
	...OWNERSHIP_ENTRY_REASONS,
	"legacy-read-incomplete",
	"legacy-record-invalid",
	"legacy-field-invalid",
	"social-read-incomplete",
	"social-record-invalid",
	"effective-source-mismatch",
] as const;

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const keys = Object.keys(value);
	return required.every((key) => Object.hasOwn(value, key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key));
}

/** One answer per stored field; unknown carries no values, and a non-current answer carries no facts at all. */
function parseEntryOwnership(value: unknown, preview: Record<string, unknown>): void {
	const field = "preview.ownership";
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["status", "reason", "sourceVersion", "locale", "record", "fields", "unsupportedDirectives"]) ||
		!(["current", "stale", "unknown"] as unknown[]).includes(value.status) ||
		(value.sourceVersion !== null &&
			(typeof value.sourceVersion !== "string" || !value.sourceVersion || value.sourceVersion.length > 2_048)) ||
		(value.locale !== null && typeof value.locale !== "string") ||
		!Array.isArray(value.fields) ||
		value.fields.length !== SEO_ADMIN_OWNERSHIP_FIELDS.length
	)
		contractError(field);
	const current = value.status === "current";
	if (
		(current && value.reason !== null) ||
		(value.status === "stale" && value.reason !== "saved-version-mismatch") ||
		(value.status === "unknown" &&
			(!(OWNERSHIP_ENTRY_REASONS as readonly unknown[]).includes(value.reason) || value.reason === "saved-version-mismatch")) ||
		(value.status !== "unknown" && value.sourceVersion === null) ||
		(!current && value.record !== null)
	)
		contractError(`${field}.status`);
	// A current answer for a saved snapshot describes exactly that saved version.
	if (current && preview.sourceKind === "saved-snapshot" && value.sourceVersion !== preview.sourceVersion)
		contractError(`${field}.sourceVersion`);
	const record = value.record;
	const content = isRecord(preview.content) ? preview.content : {};
	if (
		record !== null &&
		(!isRecord(record) ||
			!hasExactKeys(record, ["sourceOverrideId", "keyKind"]) ||
			typeof record.sourceOverrideId !== "string" ||
			// The exact-ID key is the entry's own reference; an alias key shares only its collection.
			(record.keyKind === "id"
				? record.sourceOverrideId !== content.ref
				: record.keyKind !== "slug-alias" ||
					!record.sourceOverrideId.startsWith(`${String(content.collection)}:`) ||
					record.sourceOverrideId.length <= String(content.collection).length + 1))
	)
		contractError(`${field}.record`);
	value.fields.forEach((item, index) => {
		const name = SEO_ADMIN_OWNERSHIP_FIELDS[index];
		const path = `${field}.fields.${name}`;
		if (
			!isRecord(item) ||
			!hasExactKeys(item, ["field", "state", "core", "legacy", "effective", "effectiveSource", "social"], ["reason"]) ||
			item.field !== name ||
			!(["conflict", "equal", "not-shadowed", "unknown"] as unknown[]).includes(item.state)
		)
			contractError(path);
		if (item.state === "unknown") {
			if (
				!(OWNERSHIP_FIELD_REASONS as readonly unknown[]).includes(item.reason) ||
				(!current && item.reason !== value.reason) ||
				item.core !== null || item.legacy !== null || item.effective !== null ||
				item.effectiveSource !== null || item.social !== null
			)
				contractError(path);
			return;
		}
		if (!current || item.reason !== undefined) contractError(path);
		const valueType = name === "noIndex" ? "boolean" : "string";
		const typed = (candidate: unknown, nullable: boolean) =>
			typeof candidate === valueType || (nullable && candidate === null);
		const shadowed = item.state === "conflict" || item.state === "equal";
		if (
			!typed(item.core, name !== "noIndex") ||
			!typed(item.effective, name !== "noIndex") ||
			(shadowed ? !typed(item.legacy, false) || record === null : item.legacy !== null) ||
			!(item.effectiveSource === "site-setting" || item.effectiveSource === "content-type-rule" ||
				(METADATA_SOURCES as readonly unknown[]).includes(item.effectiveSource)) ||
			(shadowed ? item.effectiveSource !== "legacy-override" : item.effectiveSource === "legacy-override") ||
			// Text values are compared as stored; canonical and image only after URL resolution.
			((name === "title" || name === "description") && shadowed &&
				(item.legacy === item.core) !== (item.state === "equal")) ||
			(name === "noIndex" && shadowed && (item.legacy !== true || item.core !== (item.state === "equal"))) ||
			(name === "noIndex" && item.effectiveSource !== "site-setting" && item.effectiveSource !== "content-type-rule" &&
				item.effectiveSource !== "core-seo" && item.effectiveSource !== "legacy-override") ||
			(name !== "noIndex" && (item.effectiveSource === "site-setting" || item.effectiveSource === "content-type-rule"))
		)
			contractError(path);
		if (name === "title" || name === "description") {
			const social = item.social;
			if (
				!isRecord(social) ||
				!hasExactKeys(social, ["value", "source"]) ||
				typeof social.value !== "string" ||
				!(METADATA_SOURCES as readonly unknown[]).includes(social.source)
			)
				contractError(`${path}.social`);
		} else if (item.social !== null) contractError(`${path}.social`);
	});
	const directives = value.unsupportedDirectives;
	if (
		!isRecord(directives) ||
		!hasExactKeys(directives, ["state", "tokens"]) ||
		!(["none", "present", "unknown"] as unknown[]).includes(directives.state) ||
		!Array.isArray(directives.tokens) ||
		!directives.tokens.every((token) => typeof token === "string" && token.length > 0) ||
		(directives.state === "present") !== (directives.tokens.length > 0) ||
		(!current && directives.state !== "unknown") ||
		(directives.state === "present" && record === null)
	)
		contractError(`${field}.unsupportedDirectives`);
}

const SOCIAL_OVERRIDE_ERRORS = [
	"invalid_ref", "invalid_values", "unsupported_collection", "content_unavailable",
	"not_found", "title_too_long", "description_too_long", "storage_unavailable",
	"record_invalid", "conflict", "unconfirmed",
] as const;

function parseSocialOverrideSnapshot(value: unknown, field: string): SeoAdminSocialOverrideSnapshot {
	if (!isRecord(value) || typeof value.ref !== "string" || !value.ref || value.ref.length > 194 ||
		(value.revision !== null && (typeof value.revision !== "string" || !value.revision || value.revision.length > 128)))
		contractError(field);
	if (value.override === null) {
		if (value.revision !== null) contractError(field);
	} else {
		const override = value.override;
		if (!isRecord(override) || value.revision === null ||
			override.storageVersion !== SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION ||
			override.ref !== value.ref ||
			(override.title !== null && (typeof override.title !== "string" || !override.title.trim() || override.title.length > SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH)) ||
			(override.description !== null && (typeof override.description !== "string" || !override.description.trim() || override.description.length > SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH)) ||
			(override.title === null && override.description === null) ||
			typeof override.updatedAt !== "string" || Number.isNaN(Date.parse(override.updatedAt)))
			contractError(field);
	}
	return value as unknown as SeoAdminSocialOverrideSnapshot;
}

function assertSocialOverrideResult(value: unknown): asserts value is Record<string, unknown> & { success: boolean } {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("socialOverride.result");
	assertContractVersion(value, "socialOverride.contractVersion");
	if (typeof value.engineVersion !== "string" ||
		(value.ref !== null && (typeof value.ref !== "string" || !value.ref || value.ref.length > 194)))
		contractError("socialOverride.identity");
	if (!value.success && !(SOCIAL_OVERRIDE_ERRORS as readonly unknown[]).includes(value.error))
		contractError("socialOverride.error");
}

export function parseSeoAdminSocialOverrideReadResult(value: unknown, requestedRef?: string): SeoAdminSocialOverrideReadResult {
	assertSocialOverrideResult(value);
	if (requestedRef !== undefined && value.ref !== requestedRef) contractError("socialOverride.requestedRef");
	if (!value.success && (["invalid_values", "title_too_long", "description_too_long", "conflict", "unconfirmed"] as unknown[]).includes(value.error))
		contractError("socialOverride.error");
	if (value.success) {
		const snapshot = parseSocialOverrideSnapshot(value.snapshot, "socialOverride.snapshot");
		if (typeof value.ref !== "string" || snapshot.ref !== value.ref) contractError("socialOverride.identity");
	}
	return value as unknown as SeoAdminSocialOverrideReadResult;
}

export function parseSeoAdminSocialOverrideSaveResult(
	value: unknown, requested?: { ref: string; title: string; description: string },
): SeoAdminSocialOverrideSaveResult {
	assertSocialOverrideResult(value);
	if (requested && value.ref !== requested.ref) contractError("socialOverride.requestedRef");
	if (!value.success) {
		if (value.outcome !== "rejected" && value.outcome !== "unconfirmed") contractError("socialOverride.outcome");
		if ((value.outcome === "unconfirmed") !== (value.error === "unconfirmed")) contractError("socialOverride.outcome");
	} else {
		if (value.outcome !== "saved" && value.outcome !== "unchanged") contractError("socialOverride.outcome");
		const snapshot = parseSocialOverrideSnapshot(value.snapshot, "socialOverride.snapshot");
		if (typeof value.ref !== "string" || snapshot.ref !== value.ref) contractError("socialOverride.identity");
		if (requested && ((snapshot.override?.title ?? "") !== requested.title ||
			(snapshot.override?.description ?? "") !== requested.description)) contractError("socialOverride.submittedValues");
	}
	return value as unknown as SeoAdminSocialOverrideSaveResult;
}

const MIGRATION_PLAN_STATES = [
	"ready",
	"conflict",
	"empty",
	"override-not-found",
	"invalid-ref",
	"unsupported-collection",
	"content-not-found",
	"identifier-lookup-unavailable",
	"seo-disabled",
] as const;

const MIGRATION_RECORD_STATUSES = ["prepared", "applied", "rolled-back", "failed"] as const;
const MIGRATION_FIELDS = ["title", "description", "image", "canonical", "noIndex"] as const;
const MIGRATION_FIELD_ACTIONS = [
	"ignore",
	"copy",
	"same",
	"conflict",
	"keep-core",
	"overwrite-core",
] as const;
const MIGRATION_POLICIES = ["skip", "prefer-core", "prefer-legacy"] as const;

function parseMigrationEnvelope(
	value: unknown,
	field: string,
): asserts value is Record<string, unknown> {
	if (!isRecord(value)) contractError(field);
	assertContractVersion(value, `${field}.contractVersion`);
	if (value.migrationVersion !== CORE_SEO_MIGRATION_VERSION)
		contractError(`${field}.migrationVersion`);
	if (typeof value.engineVersion !== "string" || typeof value.generatedAt !== "string") {
		contractError(`${field}.metadata`);
	}
}

function parseMigrationSnapshot(value: unknown, field: string): void {
	if (
		!isRecord(value) ||
		(value.title !== null && typeof value.title !== "string") ||
		(value.description !== null && typeof value.description !== "string") ||
		(value.image !== null && typeof value.image !== "string") ||
		(value.canonical !== null && typeof value.canonical !== "string") ||
		typeof value.noIndex !== "boolean"
	)
		contractError(field);
}

function isMigrationValue(value: unknown): boolean {
	return value === null || typeof value === "string" || typeof value === "boolean";
}

function parseMigrationPlan(value: unknown, field: string): void {
	if (
		!isRecord(value) ||
		value.migrationVersion !== CORE_SEO_MIGRATION_VERSION ||
		typeof value.ref !== "string" ||
		!(MIGRATION_POLICIES as readonly unknown[]).includes(value.conflictPolicy) ||
		!(MIGRATION_PLAN_STATES.slice(0, 3) as readonly unknown[]).includes(value.status) ||
		!Array.isArray(value.fields) ||
		!Array.isArray(value.conflicts) ||
		!Array.isArray(value.mappedFields) ||
		(value.unmappedRobots !== undefined &&
			(!Array.isArray(value.unmappedRobots) ||
				!value.unmappedRobots.every((token) => typeof token === "string" && token.length > 0)))
	)
		contractError(field);
	parseMigrationSnapshot(value.before, `${field}.before`);
	parseMigrationSnapshot(value.target, `${field}.target`);
	for (const item of value.fields) {
		if (
			!isRecord(item) ||
			!(MIGRATION_FIELDS as readonly unknown[]).includes(item.field) ||
			!(MIGRATION_FIELD_ACTIONS as readonly unknown[]).includes(item.action) ||
			!isMigrationValue(item.legacy) ||
			!isMigrationValue(item.current) ||
			!isMigrationValue(item.target) ||
			typeof item.conflict !== "boolean"
		)
			contractError(`${field}.field`);
	}
	if (
		!value.conflicts.every((item) => (MIGRATION_FIELDS as readonly unknown[]).includes(item)) ||
		!value.mappedFields.every((item) => (MIGRATION_FIELDS as readonly unknown[]).includes(item))
	)
		contractError(`${field}.fields`);
}

function parseMigrationSummary(value: unknown, field: string): void {
	if (!isRecord(value)) contractError(field);
	for (const key of ["total", "ready", "conflicts", "empty", "unresolved"] as const) {
		if (typeof value[key] !== "number" || value[key] < 0) contractError(`${field}.${key}`);
	}
}

export function parseSeoAdminMigrationPlan(value: unknown): SeoAdminMigrationPlanResponse {
	parseMigrationEnvelope(value, "migration.plan");
	if (value.success !== true) contractError("migration.plan.success");
	if (typeof value.writeAvailable !== "boolean") contractError("migration.plan.writeAvailable");
	if (typeof value.discardAvailable !== "boolean") contractError("migration.plan.discardAvailable");
	if (typeof value.hasMore !== "boolean") contractError("migration.plan.hasMore");
	if (value.cursor !== undefined && (typeof value.cursor !== "string" || !value.cursor)) {
		contractError("migration.plan.cursor");
	}
	if (value.hasMore && value.cursor === undefined) contractError("migration.plan.cursor");
	parseMigrationSummary(value.summary, "migration.plan.summary");
	if (!Array.isArray(value.items)) contractError("migration.plan.items");
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			typeof item.sourceOverrideId !== "string" ||
			typeof item.fingerprint !== "string" ||
			!/^sha256-[a-f0-9]{64}$/.test(item.fingerprint) ||
			typeof item.ref !== "string" ||
			!(MIGRATION_PLAN_STATES as readonly unknown[]).includes(item.state) ||
			typeof item.detail !== "string" ||
			(item.collection !== undefined && typeof item.collection !== "string") ||
			(item.entryId !== undefined && typeof item.entryId !== "string") ||
			(item.title !== undefined && typeof item.title !== "string")
		)
			contractError("migration.plan.item");
		if (item.plan !== undefined) parseMigrationPlan(item.plan, "migration.plan.item.plan");
		if (["ready", "conflict", "empty"].includes(String(item.state)) && item.plan === undefined) {
			contractError("migration.plan.item.missingPlan");
		}
		if (item.snapshot !== undefined) {
			// A snapshot belongs to one exact plan, never to a page of them.
			if (value.items.length !== 1 || value.hasMore || value.cursor !== undefined) contractError("migration.plan.snapshot.scope");
			parseLegacyRecordSnapshot(item.snapshot, item, value.generatedAt);
		}
	}
	return value as unknown as SeoAdminMigrationPlanResponse;
}

const LEGACY_SNAPSHOT_REFUSALS = ["not-exact-id", "recovery-pending", "record-missing", "entry-unavailable", "not-json", "too-large"] as const;

/** The document must be the complete export of this item's own record, entry and fingerprint. */
function parseLegacyRecordSnapshot(value: unknown, item: Record<string, unknown>, generatedAt: unknown): void {
	const field = "migration.plan.snapshot";
	if (!isRecord(value)) contractError(field);
	if (value.status === "refused") {
		if (!hasExactKeys(value, ["status", "reason"]) || !(LEGACY_SNAPSHOT_REFUSALS as readonly unknown[]).includes(value.reason))
			contractError(field);
		return;
	}
	if (
		value.status !== "available" ||
		!hasExactKeys(value, ["status", "bytes", "document"]) ||
		typeof value.document !== "string" ||
		!integerInRange(value.bytes, 1, SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES) ||
		new TextEncoder().encode(value.document).byteLength !== value.bytes ||
		typeof item.collection !== "string" ||
		typeof item.entryId !== "string"
	)
		contractError(field);
	let exported: unknown;
	try {
		exported = JSON.parse(value.document);
	} catch {
		contractError(`${field}.document`);
	}
	const entryRef = `${item.collection}:${item.entryId}`;
	if (
		!isRecord(exported) ||
		!hasExactKeys(exported, [
			"format", "formatVersion", "generatedAt", "migrationVersion", "sourceOverrideId",
			"reference", "entry", "conflictPolicy", "fingerprint", "record",
		]) ||
		exported.format !== SEO_ADMIN_LEGACY_EXPORT_FORMAT ||
		exported.formatVersion !== SEO_ADMIN_LEGACY_EXPORT_FORMAT_VERSION ||
		exported.migrationVersion !== CORE_SEO_MIGRATION_VERSION ||
		exported.generatedAt !== generatedAt ||
		exported.sourceOverrideId !== item.sourceOverrideId ||
		exported.sourceOverrideId !== entryRef ||
		exported.reference !== item.ref ||
		exported.fingerprint !== item.fingerprint ||
		!(MIGRATION_POLICIES as readonly unknown[]).includes(exported.conflictPolicy) ||
		!isRecord(exported.entry) ||
		!hasExactKeys(exported.entry, ["ref", "collection", "entryId", "locale"]) ||
		exported.entry.ref !== entryRef ||
		exported.entry.collection !== item.collection ||
		exported.entry.entryId !== item.entryId ||
		(exported.entry.locale !== null && typeof exported.entry.locale !== "string") ||
		(isRecord(item.plan) && exported.conflictPolicy !== item.plan.conflictPolicy) ||
		!finiteJson(exported)
	)
		contractError(`${field}.document`);
}

/** JSON.parse turns 1e400 into Infinity and keeps -0, which the export never contains. */
function finiteJson(root: unknown): boolean {
	const stack: unknown[] = [root];
	while (stack.length) {
		const value = stack.pop();
		if (typeof value === "number") {
			if (!Number.isFinite(value) || Object.is(value, -0)) return false;
		} else if (Array.isArray(value) || isRecord(value)) {
			// Pushed one at a time; spreading a large array would exceed the argument limit.
			for (const child of Object.values(value)) stack.push(child);
		}
	}
	return true;
}

export function parseSeoAdminMigrationStatus(value: unknown): SeoAdminMigrationStatusResponse {
	parseMigrationEnvelope(value, "migration.status");
	if (value.success !== true || typeof value.writeAvailable !== "boolean" ||
		!Array.isArray(value.items) || typeof value.hasMore !== "boolean") {
		contractError("migration.status.shape");
	}
	if (value.cursor !== undefined && value.cursor !== null && typeof value.cursor !== "string") {
		contractError("migration.status.cursor");
	}
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			typeof item.id !== "string" ||
			typeof item.batchId !== "string" ||
			item.migrationVersion !== CORE_SEO_MIGRATION_VERSION ||
			typeof item.ref !== "string" ||
			typeof item.collection !== "string" ||
			typeof item.entryId !== "string" ||
			typeof item.sourceOverrideId !== "string" ||
			!isRecord(item.sourceOverride) ||
			typeof item.sourceOverride.ref !== "string" ||
			!(MIGRATION_POLICIES as readonly unknown[]).includes(item.conflictPolicy) ||
			!(MIGRATION_RECORD_STATUSES as readonly unknown[]).includes(item.status) ||
			typeof item.createdAt !== "string" ||
			typeof item.updatedAt !== "string" ||
			(item.error !== undefined && typeof item.error !== "string")
		)
			contractError("migration.status.item");
		parseMigrationSnapshot(item.before, "migration.status.item.before");
		parseMigrationSnapshot(item.after, "migration.status.item.after");
	}
	return value as unknown as SeoAdminMigrationStatusResponse;
}

function validMigrationResultStatus(value: unknown): boolean {
	return (
		(MIGRATION_PLAN_STATES as readonly unknown[]).includes(value) ||
		[
			"applied",
			"rolled-back",
			"failed",
			"changed-since-preview",
			"changed-since-migration",
			"override-conflict",
			"partial-conflict",
			"operation-busy",
		].includes(String(value)) ||
		(typeof value === "string" && /^not-applied:(prepared|applied|rolled-back|failed)$/.test(value))
	);
}

const LEGACY_DISCARD_ERRORS = ["invalid_input", "confirmation_required", "not_found", "recovery_pending", "preview_stale"] as const;

export function parseSeoAdminLegacyDiscardResult(value: unknown): SeoAdminLegacyDiscardResult {
	if (
		!isRecord(value) ||
		typeof value.success !== "boolean" ||
		value.contractVersion !== SEO_ADMIN_CONTRACT_VERSION ||
		typeof value.engineVersion !== "string"
	)
		contractError("migration.discard");
	if (value.success) {
		const next = value.nextOwner;
		if (
			typeof value.sourceOverrideId !== "string" ||
			!isRecord(value.discarded) ||
			!isRecord(next) ||
			!(
				(next.kind === "legacy" && typeof next.sourceOverrideId === "string") ||
				next.kind === "core-seo" ||
				next.kind === "plugin-defaults"
			)
		)
			contractError("migration.discard.item");
		return value as unknown as SeoAdminLegacyDiscardResult;
	}
	if (!(LEGACY_DISCARD_ERRORS as readonly unknown[]).includes(value.error)) contractError("migration.discard.error");
	return value as unknown as SeoAdminLegacyDiscardResult;
}

/** The discard route's full answer, including a host that cannot delete conditionally. */
export function parseSeoAdminLegacyDiscardResponse(value: unknown): SeoAdminLegacyDiscardResponse {
	if (isRecord(value) && value.success === false && value.error === "discard_unavailable") {
		if (
			!hasExactKeys(value, ["success", "contractVersion", "engineVersion", "error"]) ||
			value.contractVersion !== SEO_ADMIN_CONTRACT_VERSION ||
			typeof value.engineVersion !== "string"
		)
			contractError("migration.discard");
		return value as unknown as SeoAdminLegacyDiscardResponse;
	}
	return parseSeoAdminLegacyDiscardResult(value);
}

export function parseSeoAdminMigrationOperationResult(
	value: unknown,
): SeoAdminMigrationOperationResult {
	parseMigrationEnvelope(value, "migration.operation");
	if (typeof value.success !== "boolean") contractError("migration.operation.success");
	if (typeof value.error === "string") {
		if (value.error !== "confirmation_required" && value.error !== "content_write_unavailable") {
			contractError("migration.operation.error");
		}
		if (
			value.expected !== undefined &&
			value.expected !== "MIGRATE_TO_CORE_SEO" &&
			value.expected !== "ROLLBACK_CORE_SEO"
		) {
			contractError("migration.operation.expected");
		}
		return value as unknown as SeoAdminMigrationOperationResult;
	}
	if (
		typeof value.batchId !== "string" ||
		!isRecord(value.summary) ||
		Object.values(value.summary).some((item) => typeof item !== "number" || item < 0) ||
		!Array.isArray(value.results)
	)
		contractError("migration.operation.shape");
	for (const item of value.results) {
		if (
			!isRecord(item) ||
			typeof item.ref !== "string" ||
			!validMigrationResultStatus(item.status) ||
			(item.migrationId !== undefined && typeof item.migrationId !== "string") ||
			(item.error !== undefined && typeof item.error !== "string")
		)
			contractError("migration.operation.item");
	}
	return value as unknown as SeoAdminMigrationOperationResult;
}

function validUpdatedAt(value: unknown): boolean {
	return value === null || typeof value === "string";
}

export function parseSeoAdminModuleConfiguration(value: unknown): SeoAdminModuleConfiguration {
	if (!isRecord(value)) contractError("configuration.modules");
	if (value.storageVersion !== SEO_ADMIN_MODULES_STORAGE_VERSION)
		contractError("configuration.modules.storageVersion");
	if (!validUpdatedAt(value.updatedAt)) contractError("configuration.modules.updatedAt");
	const revision = parseRevision(value.revision, "configuration.modules.revision");
	if (typeof value.writable !== "boolean" || (!value.writable && revision !== null)) contractError("configuration.modules.writable");
	if (!Array.isArray(value.items) || value.items.length !== SEO_ADMIN_MODULE_DEFINITIONS.length) {
		contractError("configuration.modules.items");
	}
	const definitions = new Map(SEO_ADMIN_MODULE_DEFINITIONS.map((definition) => [definition.key, definition]));
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			typeof item.key !== "string" ||
			!definitions.has(item.key as never) ||
			typeof item.label !== "string" ||
			typeof item.description !== "string" ||
			(item.capability !== undefined && (item.key !== "sitemap" || item.capability !== "native-sitemap")) ||
			item.status !== (item.capability === "native-sitemap" ? "active" : definitions.get(item.key as never)?.status) ||
			typeof item.defaultEnabled !== "boolean" ||
			typeof item.enabled !== "boolean" ||
			item.editable !== seoModuleIsEditable(item.status as never) ||
			(!item.editable && item.enabled && !seoModuleCanRun(item.key as never))
		)
			contractError("configuration.modules.item");
	}
	return value as unknown as SeoAdminModuleConfiguration;
}

export function parseSeoAdminSchemaPresetConfiguration(
	value: unknown,
): SeoAdminSchemaPresetConfiguration {
	if (!isRecord(value)) contractError("configuration.schema.presets");
	if (value.storageVersion !== SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION) {
		contractError("configuration.schema.presets.storageVersion");
	}
	if (!validUpdatedAt(value.updatedAt)) contractError("configuration.schema.presets.updatedAt");
	const revision = parseRevision(value.revision, "configuration.schema.presets.revision");
	if (!["absent", "valid", "invalid", "unavailable"].includes(value.record as string) ||
		typeof value.writable !== "boolean" ||
		((value.record === "valid" || value.record === "invalid") ? revision === null : revision !== null) ||
		(value.record === "unavailable" && value.writable)) contractError("configuration.schema.presets.record");
	if (typeof value.migrationNeeded !== "boolean")
		contractError("configuration.schema.presets.migrationNeeded");
	if (
		!Array.isArray(value.items) ||
		value.items.length !== SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.length
	) {
		contractError("configuration.schema.presets.items");
	}
	const keys = new Set(SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => definition.key));
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			typeof item.key !== "string" ||
			!keys.has(item.key as never) ||
			typeof item.label !== "string" ||
			typeof item.description !== "string" ||
			typeof item.scope !== "string" ||
			!(["core", "content", "rich"] as unknown[]).includes(item.group) ||
			!(["automatic", "data-required"] as unknown[]).includes(item.emission) ||
			typeof item.defaultEnabled !== "boolean" ||
			typeof item.enabled !== "boolean" ||
			(item.applicable !== undefined && typeof item.applicable !== "boolean")
		)
			contractError("configuration.schema.presets.item");
		keys.delete(item.key as never);
	}
	return value as unknown as SeoAdminSchemaPresetConfiguration;
}

function parseSeoAdminCustomSchema(value: unknown): SeoAdminCustomSchema {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		value.storageVersion !== SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION ||
		typeof value.name !== "string" ||
		typeof value.scope !== "string" ||
		typeof value.json !== "string" ||
		typeof value.enabled !== "boolean" ||
		!Array.isArray(value.types) ||
		!value.types.every((item) => typeof item === "string") ||
		typeof value.valid !== "boolean" ||
		(value.validationError !== null && typeof value.validationError !== "string") ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string" ||
		(value.target !== undefined && !isEntrySchemaTarget(value.target))
	)
		contractError("configuration.schema.customSchema");
	return value as unknown as SeoAdminCustomSchema;
}

export function parseSeoAdminConfiguration(value: unknown): SeoAdminConfiguration {
	if (!isRecord(value)) contractError("configuration.root");
	assertContractVersion(value, "configuration.contractVersion");
	if (value.configurationVersion !== SEO_ADMIN_CONFIGURATION_VERSION) {
		contractError("configuration.configurationVersion");
	}
	if (typeof value.engineVersion !== "string") contractError("configuration.engineVersion");
	parseSeoAdminModuleConfiguration(value.modules);
	if (!isRecord(value.schema)) contractError("configuration.schema");
	parseSeoAdminSchemaContentTypeConfiguration(value.schema.contentTypes);
	parseSeoAdminSchemaPresetConfiguration(value.schema.presets);
	if (value.schema.customSchemaStorageVersion !== SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION) {
		contractError("configuration.schema.customSchemaStorageVersion");
	}
	if (!Array.isArray(value.schema.customSchemas))
		contractError("configuration.schema.customSchemas");
	for (const item of value.schema.customSchemas) parseSeoAdminCustomSchema(item);
	if (typeof value.schema.hasMore !== "boolean") contractError("configuration.schema.hasMore");
	return value as unknown as SeoAdminConfiguration;
}

function parseErrors(value: unknown, field: string): Record<string, string> {
	if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string"))
		contractError(field);
	return value as Record<string, string>;
}

export function parseSeoAdminModulesSaveResult(value: unknown): SeoAdminModulesSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean")
		contractError("configuration.modules.save");
	if (value.success)
		return { success: true, modules: parseSeoAdminModuleConfiguration(value.modules) };
	if (value.conflict !== undefined && value.conflict !== true) contractError("configuration.modules.conflict");
	return {
		success: false,
		...(value.conflict === true ? { conflict: true } : {}),
		errors: parseErrors(value.errors, "configuration.modules.errors"),
	} as SeoAdminModulesSaveResult;
}

function isSchemaContentTypeRole(value: unknown): boolean {
	return (SEO_SCHEMA_CONTENT_TYPE_ROLES as readonly unknown[]).includes(value);
}

export function parseSeoAdminSchemaContentTypeConfiguration(
	value: unknown,
): SeoAdminSchemaContentTypeConfiguration {
	if (!isRecord(value)) contractError("configuration.schema.contentTypes");
	if (value.storageVersion !== SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION)
		contractError("configuration.schema.contentTypes.storageVersion");
	if (value.updatedAt !== null && typeof value.updatedAt !== "string")
		contractError("configuration.schema.contentTypes.updatedAt");
	if (value.revision !== null && (typeof value.revision !== "string" || !value.revision || value.revision.length > 128))
		contractError("configuration.schema.contentTypes.revision");
	if (value.record !== "absent" && value.record !== "valid" && value.record !== "invalid")
		contractError("configuration.schema.contentTypes.record");
	if (typeof value.writable !== "boolean") contractError("configuration.schema.contentTypes.writable");
	if (typeof value.discoveryAvailable !== "boolean")
		contractError("configuration.schema.contentTypes.discoveryAvailable");
	if (!Number.isSafeInteger(value.discoveredCount) || (value.discoveredCount as number) < 0)
		contractError("configuration.schema.contentTypes.discoveredCount");
	if (!Array.isArray(value.items) || value.items.length > SEO_SCHEMA_CONTENT_TYPE_LIST_LIMIT)
		contractError("configuration.schema.contentTypes.items");
	const keys = new Set<string>();
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			!isSeoContentCollectionKey(item.collection) ||
			keys.has(item.collection) ||
			typeof item.label !== "string" ||
			!isSchemaContentTypeRole(item.role) ||
			(item.source !== "saved" && item.source !== "default")
		)
			contractError("configuration.schema.contentTypes.item");
		keys.add(item.collection);
	}
	if (!Array.isArray(value.unlisted) || value.unlisted.length > SEO_SCHEMA_CONTENT_TYPE_LIST_LIMIT)
		contractError("configuration.schema.contentTypes.unlisted");
	for (const item of value.unlisted) {
		if (!isRecord(item) || !isSeoContentCollectionKey(item.collection) || keys.has(item.collection) || !isSchemaContentTypeRole(item.role))
			contractError("configuration.schema.contentTypes.unlisted");
		keys.add(item.collection);
	}
	return value as unknown as SeoAdminSchemaContentTypeConfiguration;
}

const SCHEMA_CONTENT_TYPE_WRITE_ERRORS: readonly SeoAdminSchemaContentTypesWriteError[] = [
	"invalid",
	"conflict",
	"invalid_stored",
	"unavailable",
	"unconfirmed",
];

export function parseSeoAdminSchemaContentTypesReadResult(value: unknown): SeoAdminSchemaContentTypesReadResult {
	if (!isRecord(value)) contractError("configuration.schema.contentTypes.read");
	if (value.check !== undefined && value.check !== "applied" && value.check !== "not_applied" && value.check !== "changed")
		contractError("configuration.schema.contentTypes.check");
	return {
		contentTypes: parseSeoAdminSchemaContentTypeConfiguration(value.contentTypes),
		...(value.check === undefined ? {} : { check: value.check as SeoAdminSchemaContentTypesCheck }),
	};
}

export function parseSeoAdminSchemaContentTypesSaveResult(
	value: unknown,
): SeoAdminSchemaContentTypesSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean")
		contractError("configuration.schema.contentTypes.save");
	if (value.success) {
		return {
			success: true,
			contentTypes: parseSeoAdminSchemaContentTypeConfiguration(value.contentTypes),
		};
	}
	if (!SCHEMA_CONTENT_TYPE_WRITE_ERRORS.includes(value.error as SeoAdminSchemaContentTypesWriteError))
		contractError("configuration.schema.contentTypes.error");
	return {
		success: false,
		error: value.error as SeoAdminSchemaContentTypesWriteError,
		errors: parseErrors(value.errors, "configuration.schema.contentTypes.errors"),
		...(value.current === undefined ? {} : { current: parseSeoAdminSchemaContentTypeConfiguration(value.current) }),
	};
}

const SCHEMA_COMMAND_ERRORS: readonly SeoAdminSchemaCommandError[] = [
	"invalid_input", "invalid_values", "conflict", "unconfirmed", "unavailable", "not_found", "limit_reached", "invalid_record",
];

function parseCustomSchemaSnapshot(value: unknown): SeoAdminCustomSchemaSnapshot {
	parseSeoAdminCustomSchema(value);
	if (!isRecord(value) || parseRevision(value.revision, "configuration.schema.custom.revision") === null)
		contractError("configuration.schema.custom.revision");
	return value as unknown as SeoAdminCustomSchemaSnapshot;
}

function parseSchemaCommandFailure(value: Record<string, unknown>, field: string) {
	if (value.success !== false || !SCHEMA_COMMAND_ERRORS.includes(value.error as SeoAdminSchemaCommandError) ||
		!nonEmptyText(value.message)) contractError(field + ".error");
	return {
		success: false as const,
		error: value.error as SeoAdminSchemaCommandError,
		message: value.message as string,
		errors: parseErrors(value.errors, field + ".errors"),
	};
}

export function parseSeoAdminCustomSchemaReadResult(value: unknown, expectedId?: string): SeoAdminCustomSchemaReadResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("configuration.schema.custom.read");
	if (!value.success) {
		if (!["invalid_input", "unavailable"].includes(value.error as string) || !nonEmptyText(value.message))
			contractError("configuration.schema.custom.read.failure");
	} else {
		if (!nonEmptyText(value.id) || (expectedId !== undefined && value.id !== expectedId))
			contractError("configuration.schema.custom.read.id");
		if (value.state === "saved") {
			const schema = parseCustomSchemaSnapshot(value.schema);
			if (schema.id !== value.id) contractError("configuration.schema.custom.read.target");
		} else if (value.state === "absent") {
			if (value.schema !== null) contractError("configuration.schema.custom.read.absent");
		} else if (value.state === "invalid") {
			if (value.schema !== null || parseRevision(value.revision, "configuration.schema.custom.read.revision") === null)
				contractError("configuration.schema.custom.read.invalid");
		} else contractError("configuration.schema.custom.read.state");
	}
	return value as unknown as SeoAdminCustomSchemaReadResult;
}

export function parseSeoAdminSchemaPresetsSaveResult(
	value: unknown,
	expected?: SeoAdminSchemaPresetsWriteInput | { expectedRevision: string; operation: "reset" },
): SeoAdminSchemaPresetsSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("configuration.schema.presets.save");
	if (value.success) {
		if (typeof value.changed !== "boolean") contractError("configuration.schema.presets.changed");
		const presets = parseSeoAdminSchemaPresetConfiguration(value.presets);
		if (!presets.writable) contractError("configuration.schema.presets.saved");
		if (expected) {
			if ("operation" in expected) {
				if (presets.record !== "absent" || presets.revision !== null || !value.changed)
					contractError("configuration.schema.presets.reset");
			} else if (presets.record !== "valid" || presets.items.some(item => item.enabled !== expected.values[item.key]) ||
				(value.changed ? presets.revision === expected.expectedRevision : presets.revision !== expected.expectedRevision)) {
				contractError("configuration.schema.presets.saved");
			}
		}
		return { success: true, changed: value.changed, presets };
	}
	return {
		...parseSchemaCommandFailure(value, "configuration.schema.presets"),
		...(value.current === undefined ? {} : { current: parseSeoAdminSchemaPresetConfiguration(value.current) }),
	};
}

function parseCustomSchemaWrite(value: unknown, expected?: SeoAdminCustomSchemaWriteInput): SeoAdminCustomSchemaSaveResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("configuration.schema.custom.save");
	if (value.success) {
		if (typeof value.changed !== "boolean") contractError("configuration.schema.custom.changed");
		const schema = parseCustomSchemaSnapshot(value.schema);
		if (expected) {
			const validated = validateSeoAdminCustomSchemaInput(expected);
			if (!validated.success || schema.id !== expected.id || schema.name !== validated.values.name ||
				schema.scope !== validated.values.scope || schema.json !== validated.values.json ||
				schema.enabled !== validated.values.enabled || !schema.valid ||
				(value.changed ? schema.revision === expected.expectedRevision : schema.revision !== expected.expectedRevision))
				contractError("configuration.schema.custom.saved");
		}
		return { success: true, changed: value.changed, schema };
	}
	const current = value.current === undefined ? undefined : value.current === null ? null : parseCustomSchemaSnapshot(value.current);
	if (current && expected && current.id !== expected.id) contractError("configuration.schema.custom.current.id");
	return { ...parseSchemaCommandFailure(value, "configuration.schema.custom"), ...(current === undefined ? {} : { current }) };
}

export function parseSeoAdminCustomSchemaSaveResult(
	value: unknown, expected?: SeoAdminCustomSchemaWriteInput,
): SeoAdminCustomSchemaSaveResult {
	return parseCustomSchemaWrite(value, expected);
}

export function parseSeoAdminSchemaComposerSaveResult(
	value: unknown, expected?: SeoAdminSchemaComposerWriteInput,
): SeoAdminSchemaComposerSaveResult {
	if (!isRecord(value)) contractError("configuration.schema.composer.save");
	let custom: SeoAdminCustomSchemaWriteInput | undefined;
	if (expected) {
		const composed = composeSeoSchema(expected);
		if (value.success && !composed.success) contractError("configuration.schema.composer.input");
		if (composed.success) custom = { id: expected.id, expectedRevision: expected.expectedRevision,
			name: composed.output.schemaName, scope: composed.output.scope, json: composed.output.json, enabled: composed.output.enabled };
	}
	const result = parseCustomSchemaWrite(value, custom);
	if (!result.success) return result;
	if (!isSeoSchemaComposerRecipe(value.recipe) || (expected && value.recipe !== expected.recipe))
		contractError("configuration.schema.composer.recipe");
	if (typeof value.json !== "string" || value.json !== result.schema.json) contractError("configuration.schema.composer.json");
	return { ...result, recipe: value.recipe, json: value.json };
}

export function parseSeoAdminCustomSchemaDeleteResult(value: unknown, expectedId?: string): SeoAdminCustomSchemaDeleteResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("configuration.schema.custom.delete");
	if (value.success) {
		if (!nonEmptyText(value.id) || (expectedId !== undefined && value.id !== expectedId))
			contractError("configuration.schema.custom.delete.id");
		return { success: true, id: value.id as string };
	}
	const current = value.current === undefined ? undefined : value.current === null ? null : parseCustomSchemaSnapshot(value.current);
	if (current && expectedId !== undefined && current.id !== expectedId) contractError("configuration.schema.custom.delete.current.id");
	return { ...parseSchemaCommandFailure(value, "configuration.schema.custom.delete"), ...(current === undefined ? {} : { current }) };
}

function parseSeoPortabilityBundle(value: unknown): SeoPortabilityBundle {
	if (!isRecord(value)) contractError("portability.bundle");
	if (value.format !== SEO_PORTABILITY_FORMAT || value.version !== SEO_PORTABILITY_VERSION) {
		contractError("portability.bundle.version");
	}
	if (
		typeof value.exportedAt !== "string" ||
		typeof value.engineVersion !== "string" ||
		!isRecord(value.source) ||
		typeof value.source.siteName !== "string" ||
		typeof value.source.siteUrl !== "string" ||
		!isRecord(value.safeguards) ||
		value.safeguards.secrets !== "omitted" ||
		!Array.isArray(value.safeguards.excluded) ||
		!value.safeguards.excluded.every((item) => typeof item === "string") ||
		!isRecord(value.configuration)
	)
		contractError("portability.bundle.metadata");
	parseSettingsValues(value.configuration.settings);
	if (value.configuration.analysisProfiles !== undefined && (!isRecord(value.configuration.analysisProfiles) ||
		!Object.entries(value.configuration.analysisProfiles).every(([collection, profile]) => isSeoContentCollectionKey(collection) && validAssessmentProfile(profile))))
		contractError("portability.bundle.analysisProfiles");
	if (
		!isRecord(value.configuration.sitemap) ||
		!isRecord(value.configuration.sitemap.contentTypes)
	) {
		contractError("portability.bundle.sitemap");
	}
	const sitemapKeys = Object.keys(value.configuration.sitemap.contentTypes);
	if (!sitemapKeys.includes(SEO_ADMIN_SITEMAP_STATIC_ROUTES_KEY)) {
		contractError("portability.bundle.sitemap.staticRoutes");
	}
	parseSitemapValues(value.configuration.sitemap, sitemapKeys);
	if (!isRecord(value.configuration.modules)) contractError("portability.bundle.modules");
	for (const definition of SEO_ADMIN_MODULE_DEFINITIONS) {
		if (typeof value.configuration.modules[definition.key] !== "boolean")
			contractError(`portability.bundle.modules.${definition.key}`);
	}
	if (!isRecord(value.configuration.schemaPresets))
		contractError("portability.bundle.schemaPresets");
	for (const definition of SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS) {
		if (typeof value.configuration.schemaPresets[definition.key] !== "boolean") {
			contractError(`portability.bundle.schemaPresets.${definition.key}`);
		}
	}
	if (!isRecord(value.configuration.templates)) contractError("portability.bundle.templates");
	const templateEntries = Object.entries(value.configuration.templates);
	if (templateEntries.length === 0 || templateEntries.length > 100) {
		contractError("portability.bundle.templates");
	}
	for (const [collection, template] of templateEntries) {
		if (!isSeoContentCollectionKey(collection)) {
			contractError(`portability.bundle.templates.${collection}`);
		}
		parseTemplateValues(template, `portability.bundle.templates.${collection}`);
	}
	const roles = value.configuration.schemaContentTypes;
	if (roles !== undefined) {
		if (!isRecord(roles)) contractError("portability.bundle.schemaContentTypes");
		for (const [collection, role] of Object.entries(roles)) {
			if (!isSeoContentCollectionKey(collection) || !isSchemaContentTypeRole(role))
				contractError(`portability.bundle.schemaContentTypes.${collection}`);
		}
	}
	if (!Array.isArray(value.configuration.customSchemas))
		contractError("portability.bundle.customSchemas");
	for (const schema of value.configuration.customSchemas) {
		if (
			!isRecord(schema) ||
			typeof schema.id !== "string" ||
			typeof schema.name !== "string" ||
			typeof schema.scope !== "string" ||
			typeof schema.json !== "string" ||
			typeof schema.enabled !== "boolean" ||
			(schema.target !== undefined && !isEntrySchemaTarget(schema.target))
		)
			contractError("portability.bundle.customSchema");
	}
	const indexNow = value.configuration.indexNow;
	if (
		!isRecord(indexNow) ||
		"apiKey" in indexNow ||
		"enabled" in indexNow ||
		typeof indexNow.autoSubmit !== "boolean" ||
		!(indexNow.autoSubmitContentTypes === undefined || indexNow.autoSubmitContentTypes === null ||
			(Array.isArray(indexNow.autoSubmitContentTypes) && indexNow.autoSubmitContentTypes.length <= 100 &&
				indexNow.autoSubmitContentTypes.every(isSeoContentCollectionKey))) ||
		typeof indexNow.keyLocation !== "string" ||
		!Number.isInteger(indexNow.batchSize) ||
		!Number.isInteger(indexNow.minIntervalSeconds) ||
		!Number.isInteger(indexNow.maxAttempts)
	)
		contractError("portability.bundle.indexNow");
	return value as unknown as SeoPortabilityBundle;
}

function parseSeoPortabilityPlan(value: unknown): SeoPortabilityImportPlan {
	if (!isRecord(value)) contractError("portability.plan");
	assertContractVersion(value, "portability.plan.contractVersion");
	if (
		value.portabilityVersion !== SEO_PORTABILITY_VERSION ||
		typeof value.generatedAt !== "string" ||
		(value.mode !== "merge" && value.mode !== "replace") ||
		typeof value.fingerprint !== "string" ||
		!isRecord(value.source) ||
		typeof value.source.siteName !== "string" ||
		typeof value.source.siteUrl !== "string" ||
		!isRecord(value.target) ||
		typeof value.target.siteName !== "string" ||
		typeof value.target.siteUrl !== "string" ||
		!isRecord(value.summary) ||
		!nonNegativeInteger(value.summary.changedSections) ||
		!nonNegativeInteger(value.summary.added) ||
		!nonNegativeInteger(value.summary.updated) ||
		!nonNegativeInteger(value.summary.unchanged) ||
		!nonNegativeInteger(value.summary.deleted) ||
		typeof value.summary.destructive !== "boolean" ||
		typeof value.summary.indexNowWillBeDisabled !== "boolean" ||
		!Array.isArray(value.sections) ||
		!Array.isArray(value.warnings) ||
		!value.warnings.every((item) => typeof item === "string") ||
		value.requiresConfirmation !== true
	)
		contractError("portability.plan.shape");
	const sectionKeys = [
		"settings",
		"sitemap",
		"modules",
		"schemaPresets",
		"templates",
		"customSchemas",
		"indexNow",
		"schemaContentTypes",
		"analysisProfiles",
	];
	for (const section of value.sections) {
		if (
			!isRecord(section) ||
			!sectionKeys.includes(String(section.key)) ||
			typeof section.label !== "string" ||
			typeof section.changed !== "boolean" ||
			!nonNegativeInteger(section.added) ||
			!nonNegativeInteger(section.updated) ||
			!nonNegativeInteger(section.unchanged) ||
			!nonNegativeInteger(section.deleted)
		)
			contractError("portability.plan.section");
	}
	return value as unknown as SeoPortabilityImportPlan;
}

export function parseSeoPortabilityExportResponse(value: unknown): SeoPortabilityExportResponse {
	if (!isRecord(value)) contractError("portability.export");
	assertContractVersion(value, "portability.export.contractVersion");
	if (
		typeof value.generatedAt !== "string" ||
		!Array.isArray(value.warnings) ||
		!value.warnings.every((item) => typeof item === "string")
	)
		contractError("portability.export");
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		generatedAt: value.generatedAt,
		bundle: parseSeoPortabilityBundle(value.bundle),
		warnings: value.warnings as string[],
	};
}

export function parseSeoPortabilityPreviewResult(value: unknown): SeoPortabilityPreviewResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("portability.preview");
	if (value.success) {
		return {
			success: true,
			plan: parseSeoPortabilityPlan(value.plan),
			bundle: parseSeoPortabilityBundle(value.bundle),
		};
	}
	if (
		value.error !== "invalid_bundle" ||
		!Array.isArray(value.errors) ||
		!value.errors.every((item) => typeof item === "string")
	) {
		contractError("portability.preview.error");
	}
	return value as unknown as SeoPortabilityPreviewResult;
}

export function parseSeoPortabilityApplyResult(value: unknown): SeoPortabilityApplyResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("portability.apply");
	if (value.success) {
		if (typeof value.appliedAt !== "string") contractError("portability.apply.appliedAt");
		return {
			success: true,
			appliedAt: value.appliedAt,
			plan: parseSeoPortabilityPlan(value.plan),
			backup: parseSeoPortabilityBundle(value.backup),
		};
	}
	if (
		![
			"invalid_bundle",
			"confirmation_required",
			"preview_stale",
			"apply_failed",
			"rollback_conflict",
			"rollback_failed",
		].includes(String(value.error)) ||
		typeof value.detail !== "string" ||
		(value.errors !== undefined &&
			(!Array.isArray(value.errors) || !value.errors.every((item) => typeof item === "string"))) ||
		(value.rollbackPerformed !== undefined && typeof value.rollbackPerformed !== "boolean")
	)
		contractError("portability.apply.error");
	return value as unknown as SeoPortabilityApplyResult;
}

const REDIRECT_FIELD_CODES = [
	"required", "too-long", "absolute-url", "not-a-path", "protocol-relative", "backslash",
	"control-characters", "query", "fragment", "dot-segment", "invalid-encoding", "pattern",
	"reserved-path", "file-extension", "same-address", "type",
] as unknown[];
const REDIRECT_CREATE_ACCESS = ["available", "no-permission", "read-only"] as unknown[];
const REDIRECT_CONFLICT_REASONS = ["duplicate", "trailing-slash", "loop", "check-incomplete"] as unknown[];
const REDIRECT_FAILURE_REASONS = ["busy", "host-rejected", "not-saved"] as unknown[];

function nullableBoolean(value: unknown): boolean {
	return value === null || typeof value === "boolean";
}

function nonEmptyText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

// Rule records come from EmDash; every field the table renders is checked.
function parseRedirectRule(value: unknown, field: string): RedirectRule {
	if (
		!isRecord(value) || !nonEmptyText(value.id) || typeof value.source !== "string" ||
		typeof value.destination !== "string" || !Number.isInteger(value.type) ||
		typeof value.isPattern !== "boolean" || typeof value.enabled !== "boolean" ||
		!nonNegativeInteger(value.hits) || !nullableString(value.lastHitAt) || !nullableString(value.groupName) ||
		typeof value.auto !== "boolean" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
	)
		contractError(field);
	return value as unknown as RedirectRule;
}

function parseRedirectListQuery(value: unknown): RedirectRuleListQuery {
	if (
		!isRecord(value) ||
		!(value.search === null || (typeof value.search === "string" && value.search.length <= REDIRECT_SEARCH_MAX_LENGTH)) ||
		!nullableBoolean(value.enabled) || !nullableBoolean(value.auto) ||
		!(value.group === null || (typeof value.group === "string" && value.group.length <= REDIRECT_GROUP_MAX_LENGTH)) ||
		!integerInRange(value.limit, 1, REDIRECT_LIST_MAX_PAGE_SIZE) || !nullableString(value.cursor)
	)
		contractError("redirects.list.query");
	return value as unknown as RedirectRuleListQuery;
}

export function parseSeoAdminRedirectRuleListResult(value: unknown): SeoAdminRedirectRuleListResult {
	if (!isRecord(value)) contractError("redirects.list");
	assertContractVersion(value, "redirects.list.contractVersion");
	if (value.status === "ok") {
		const query = parseRedirectListQuery(value.query);
		if (
			!Array.isArray(value.items) || value.items.length > query.limit || !nullableString(value.cursor) ||
			value.hasMore !== (value.cursor !== null) || !REDIRECT_CREATE_ACCESS.includes(value.create)
		)
			contractError("redirects.list.page");
		const ids = new Set(value.items.map((item, index) => parseRedirectRule(item, `redirects.list.items.${index}`).id));
		if (ids.size !== value.items.length) contractError("redirects.list.items");
	} else if (value.status === "invalid-cursor") {
		parseRedirectListQuery(value.query);
		if (!nonEmptyText(value.message)) contractError("redirects.list.message");
	} else if (value.status === "unavailable" || value.status === "failed") {
		if (!nonEmptyText(value.message)) contractError("redirects.list.message");
	} else {
		contractError("redirects.list.status");
	}
	return value as unknown as SeoAdminRedirectRuleListResult;
}

function parseRedirectFieldErrors(value: unknown): RedirectRuleFieldErrors {
	if (!isRecord(value)) contractError("redirects.create.errors");
	const keys = Object.keys(value);
	if (!keys.length || keys.some((key) => key !== "source" && key !== "destination" && key !== "type")) {
		contractError("redirects.create.errors");
	}
	for (const key of keys) {
		const error = value[key];
		if (!isRecord(error) || !REDIRECT_FIELD_CODES.includes(error.code) || !nonEmptyText(error.message)) {
			contractError(`redirects.create.errors.${key}`);
		}
	}
	return value as unknown as RedirectRuleFieldErrors;
}

/** Shared by create and its read-only reconciliation, which return the same union. */
export function parseSeoAdminRedirectRuleCreateResult(value: unknown): SeoAdminRedirectRuleCreateResult {
	if (!isRecord(value)) contractError("redirects.create");
	assertContractVersion(value, "redirects.create.contractVersion");
	switch (value.status) {
		case "created": {
			// Only the requested kind of rule counts as created: enabled, exact, 301 or 302.
			const rule = parseRedirectRule(value.rule, "redirects.create.rule");
			if (!rule.enabled || rule.isPattern || (rule.type !== 301 && rule.type !== 302)) contractError("redirects.create.rule");
			if (value.confirmedBy !== "host" && value.confirmedBy !== "lookup") contractError("redirects.create.confirmedBy");
			break;
		}
		case "invalid":
			parseRedirectFieldErrors(value.errors);
			break;
		case "conflict":
			if (!REDIRECT_CONFLICT_REASONS.includes(value.reason) || !nonEmptyText(value.message)) contractError("redirects.create.conflict");
			if (value.existing !== null) parseRedirectRule(value.existing, "redirects.create.existing");
			break;
		case "failed":
			if (!REDIRECT_FAILURE_REASONS.includes(value.reason) || !nonEmptyText(value.message) || typeof value.retryable !== "boolean") {
				contractError("redirects.create.failed");
			}
			break;
		case "uncertain":
			if (!nonEmptyText(value.message)) contractError("redirects.create.uncertain");
			break;
		case "unavailable":
			if ((value.reason !== "no-access" && value.reason !== "read-only") || !nonEmptyText(value.message)) {
				contractError("redirects.create.unavailable");
			}
			break;
		default:
			contractError("redirects.create.status");
	}
	return value as unknown as SeoAdminRedirectRuleCreateResult;
}

function isEntrySchemaTarget(value: unknown): boolean {
	return (
		isRecord(value) &&
		nonEmptyText(value.collection) &&
		nonEmptyText(value.entryId) &&
		(value.locale === null || nonEmptyText(value.locale))
	);
}

const ENTRY_SCHEMA_FAILURES = ["invalid_input", "entry_not_found", "entry_mismatch", "too_many_applicable", "storage_unavailable"];
const ENTRY_SCHEMA_WRITE_FAILURES = [...ENTRY_SCHEMA_FAILURES, "not_found", "scope_mismatch", "id_in_use", "limit_reached", "unconfirmed"];
const ENTRY_SCHEMA_OWNERS = ["site", "collection", "legacy-slug", "legacy-entry", "wrong-locale"];

function parseEntryCustomSchemaFields(value: unknown, field: string): EntryCustomSchemaSummary {
	if (
		!isRecord(value) ||
		!nonEmptyText(value.id) ||
		typeof value.name !== "string" ||
		typeof value.json !== "string" ||
		typeof value.enabled !== "boolean" ||
		!Array.isArray(value.types) ||
		!value.types.every((type) => typeof type === "string") ||
		typeof value.valid !== "boolean" ||
		(value.validationError !== null && typeof value.validationError !== "string") ||
		typeof value.createdAt !== "string" ||
		typeof value.updatedAt !== "string"
	)
		contractError(field);
	return value as unknown as EntryCustomSchemaSummary;
}

function parseEntryCustomSchemaSummary(value: unknown, field: string): EntryCustomSchemaSummary {
	const summary = parseEntryCustomSchemaFields(value, field);
	if (Object.hasOwn(summary, "revision")) contractError(field);
	return summary;
}

function parseEntryCustomSchema(value: unknown, field: string): EntryCustomSchema {
	parseEntryCustomSchemaFields(value, field);
	if (!isRecord(value) || !nonEmptyText(value.revision)) contractError(field);
	return value as unknown as EntryCustomSchema;
}

function parseEntryInheritedSchema(value: unknown, field: string): EntryInheritedSchema {
	if (
		!isRecord(value) ||
		!nonEmptyText(value.id) ||
		typeof value.name !== "string" ||
		!ENTRY_SCHEMA_OWNERS.includes(value.owner as string) ||
		typeof value.scope !== "string" ||
		typeof value.enabled !== "boolean" ||
		!Array.isArray(value.types) ||
		!value.types.every((type) => typeof type === "string") ||
		typeof value.valid !== "boolean" ||
		!(value.targetLocale === undefined || value.targetLocale === null || nonEmptyText(value.targetLocale))
	)
		contractError(field);
	return value as unknown as EntryInheritedSchema;
}

function parseEntrySchemaFailure(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
	if (!allowed.includes(value.error as string) || !nonEmptyText(value.message)) contractError(field);
}

export function parseSeoAdminEntrySchemaListResult(value: unknown): SeoAdminEntrySchemaListResult {
	if (!isRecord(value)) contractError("entrySchemas.list");
	assertContractVersion(value, "entrySchemas.list.contractVersion");
	if (value.success === true) {
		const entry = value.entry;
		const limits = value.limits;
		if (
			!isRecord(entry) ||
			!nonEmptyText(entry.collection) ||
			!nonEmptyText(entry.entryId) ||
			!(entry.locale === null || nonEmptyText(entry.locale)) ||
			!(entry.slug === null || typeof entry.slug === "string") ||
			!nonEmptyText(entry.status) ||
			typeof value.outputEnabled !== "boolean" ||
			!Array.isArray(value.items) ||
			!Array.isArray(value.inherited) ||
			!isRecord(limits) ||
			!Number.isInteger(limits.perEntry) ||
			!Number.isInteger(limits.applicable)
		)
			contractError("entrySchemas.list.success");
		value.items.forEach((item, index) => parseEntryCustomSchemaSummary(item, `entrySchemas.list.items.${index}`));
		if (value.inspected !== undefined) {
			const inspected = value.inspected;
			if (!isRecord(inspected) || !nonEmptyText(inspected.id) || !["absent", "owned", "elsewhere"].includes(inspected.state as string))
				contractError("entrySchemas.list.inspected");
			if (inspected.state === "owned") {
				const schema = parseEntryCustomSchema(inspected.schema, "entrySchemas.list.inspected.schema");
				if (schema.id !== inspected.id) contractError("entrySchemas.list.inspected.id");
			}
		}
		value.inherited.forEach((item, index) => parseEntryInheritedSchema(item, `entrySchemas.list.inherited.${index}`));
	} else if (value.success === false) {
		parseEntrySchemaFailure(value, ENTRY_SCHEMA_FAILURES, "entrySchemas.list.failure");
	} else contractError("entrySchemas.list.success");
	return value as unknown as SeoAdminEntrySchemaListResult;
}

export function parseSeoAdminEntrySchemaSaveResult(value: unknown): SeoAdminEntrySchemaSaveResult {
	if (!isRecord(value)) contractError("entrySchemas.save");
	assertContractVersion(value, "entrySchemas.save.contractVersion");
	if (value.success === true) {
		parseEntryCustomSchema(value.schema, "entrySchemas.save.schema");
		if (typeof value.alreadySaved !== "boolean") contractError("entrySchemas.save.alreadySaved");
	} else if (value.success === false && value.error === "invalid_values") {
		const errors = value.errors;
		if (
			!isRecord(errors) ||
			!Object.keys(errors).length ||
			!Object.entries(errors).every(([key, message]) => ["name", "json", "enabled"].includes(key) && nonEmptyText(message))
		)
			contractError("entrySchemas.save.errors");
	} else if (value.success === false && value.error === "conflict") {
		if (!nonEmptyText(value.message)) contractError("entrySchemas.save.conflict");
		if (value.current !== null) parseEntryCustomSchema(value.current, "entrySchemas.save.current");
	} else if (value.success === false) {
		parseEntrySchemaFailure(value, ENTRY_SCHEMA_WRITE_FAILURES, "entrySchemas.save.failure");
	} else contractError("entrySchemas.save.success");
	return value as unknown as SeoAdminEntrySchemaSaveResult;
}

export function parseSeoAdminEntrySchemaRemoveResult(value: unknown): SeoAdminEntrySchemaRemoveResult {
	if (!isRecord(value)) contractError("entrySchemas.remove");
	assertContractVersion(value, "entrySchemas.remove.contractVersion");
	if (value.success === true) {
		if (!nonEmptyText(value.id)) contractError("entrySchemas.remove.id");
	} else if (value.success === false && value.error === "conflict") {
		if (!nonEmptyText(value.message)) contractError("entrySchemas.remove.conflict");
		parseEntryCustomSchema(value.current, "entrySchemas.remove.current");
	} else if (value.success === false) {
		parseEntrySchemaFailure(value, ENTRY_SCHEMA_WRITE_FAILURES, "entrySchemas.remove.failure");
	} else contractError("entrySchemas.remove.success");
	return value as unknown as SeoAdminEntrySchemaRemoveResult;
}

const ENTRY_SCHEMA_CANDIDATE_FAILURES: readonly SeoAdminEntrySchemaCandidateFailure[] = [
	"invalid_input",
	"entry_not_found",
	"entry_mismatch",
	"too_many_applicable",
	"storage_unavailable",
	"not_found",
	"scope_mismatch",
	"id_in_use",
	"schemas_too_large",
	"content_too_large",
	"expansion_too_large",
	"response_too_large",
	"content_changed",
	"snapshot_mismatch",
	"settings_unreadable",
	"canonical_unresolved",
];

/** The request a candidate preview must answer. */
export interface SeoEntrySchemaCandidateExpectation {
	requestId: string;
	collection: string;
	entryId: string;
	locale: string | null;
	id: string;
	expectedRevision: string | null;
	name: string;
	enabled: boolean;
	/** The saved content version sent with the request, or null for the stored entry. */
	sourceVersion: string | null;
}

// Every resolved graph is shown as the prediction, so a success must carry it.
function validCandidateGraph(item: unknown): boolean {
	if (!isRecord(item) || !Object.hasOwn(item, "graph")) return false;
	const graph = item.graph;
	if (graph !== null && typeof graph !== "object") return false;
	return item.emitted !== true || graph !== null;
}

/** Checks the candidate preview and that it answers exactly the submitted request. */
export function parseSeoAdminEntrySchemaCandidatePreviewResult(
	value: unknown,
	expected: SeoEntrySchemaCandidateExpectation,
): SeoAdminEntrySchemaCandidatePreviewResult {
	if (!isRecord(value)) contractError("entrySchemaCandidate.root");
	assertContractVersion(value, "entrySchemaCandidate.contractVersion");
	if (typeof value.engineVersion !== "string" || value.requestId !== expected.requestId) contractError("entrySchemaCandidate.requestId");
	if (value.success === true) {
		const entry = value.entry;
		const content = value.content;
		const candidate = value.candidate;
		const saveCheck = value.saveCheck;
		const limits = value.limits;
		if (
			!validTimestamp(value.generatedAt) ||
			value.scope !== "plugin-contribution" ||
			!isRecord(entry) ||
			entry.collection !== expected.collection ||
			entry.entryId !== expected.entryId ||
			entry.locale !== expected.locale ||
			!(entry.slug === null || typeof entry.slug === "string") ||
			!nonEmptyText(entry.status) ||
			!isRecord(content) ||
			!(expected.sourceVersion === null
				? content.sourceKind === "stored-entry" && content.sourceVersion === null
				: content.sourceKind === "saved-snapshot" && content.sourceVersion === expected.sourceVersion) ||
			!isRecord(candidate) ||
			candidate.mode !== (expected.expectedRevision === null ? "add" : "edit") ||
			candidate.id !== expected.id ||
			candidate.expectedRevision !== expected.expectedRevision ||
			candidate.name !== expected.name.trim() ||
			candidate.enabled !== expected.enabled ||
			candidate.graphId !== `custom:${expected.id}` ||
			!(candidate.resolvedBytes === null || integerInRange(candidate.resolvedBytes, 0, ENTRY_SCHEMA_CANDIDATE_MAX_BYTES)) ||
			typeof value.outputEnabled !== "boolean" ||
			!(value.canonicalSource === "entry" || value.canonicalSource === "page") ||
			!isRecord(saveCheck) ||
			!(saveCheck.ok === true ||
				(saveCheck.ok === false && ["identity", "limit", "unavailable"].includes(saveCheck.reason as string) && nonEmptyText(saveCheck.message))) ||
			!Array.isArray(value.items) ||
			!value.items.every((item) => validEntrySchemaGraph(item) && validCandidateGraph(item)) ||
			value.items.filter((item) => isRecord(item) && item.id === candidate.graphId).length > 1 ||
			!isRecord(limits) ||
			limits.candidateBytes !== ENTRY_SCHEMA_CANDIDATE_MAX_BYTES ||
			limits.responseBytes !== ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES
		)
			contractError("entrySchemaCandidate.success");
		const resolved = value.items.find((item) => isRecord(item) && item.id === candidate.graphId) as Record<string, unknown> | undefined;
		if ((candidate.resolvedBytes === null) !== (resolved === undefined || resolved.graph === null)) contractError("entrySchemaCandidate.resolvedBytes");
	} else if (value.success === false && value.error === "invalid_values") {
		const errors = value.errors;
		if (
			!isRecord(errors) ||
			!Object.keys(errors).length ||
			!Object.entries(errors).every(([key, message]) => ["name", "json", "enabled"].includes(key) && nonEmptyText(message))
		)
			contractError("entrySchemaCandidate.errors");
	} else if (value.success === false && value.error === "conflict") {
		if (!nonEmptyText(value.message) || expected.expectedRevision === null) contractError("entrySchemaCandidate.conflict");
		const current = parseEntryCustomSchema(value.current, "entrySchemaCandidate.current");
		if (current.id !== expected.id) contractError("entrySchemaCandidate.current");
	} else if (value.success === false) {
		parseEntrySchemaFailure(value, ENTRY_SCHEMA_CANDIDATE_FAILURES, "entrySchemaCandidate.failure");
	} else contractError("entrySchemaCandidate.success");
	return value as unknown as SeoAdminEntrySchemaCandidatePreviewResult;
}

// ---------------------------------------------------------------------------
// Schema library
// ---------------------------------------------------------------------------

const SCHEMA_LIBRARY_CORRUPT_REASONS = ["not-object", "unsupported-version", "unexpected-fields", "invalid-templates", "too-large"];
const SCHEMA_LIBRARY_WRITE_FAILURES = ["invalid_input", "conflict", "id_in_use", "limit_reached", "corrupt", "unavailable", "unconfirmed"];

export function parseSeoAdminSchemaLibrary(value: unknown): SeoAdminSchemaLibrary {
	if (!isRecord(value)) contractError("schemaLibrary.root");
	assertContractVersion(value, "schemaLibrary.contractVersion");
	const limits = value.limits;
	if (
		typeof value.engineVersion !== "string" ||
		typeof value.conditionalStorage !== "boolean" ||
		!Array.isArray(value.templates) ||
		!isRecord(limits) ||
		Object.keys(limits).length !== Object.keys(SEO_ADMIN_SCHEMA_LIBRARY_LIMITS).length ||
		Object.entries(SEO_ADMIN_SCHEMA_LIBRARY_LIMITS).some(([key, limit]) => limits[key] !== limit)
	)
		contractError("schemaLibrary.metadata");
	switch (value.state) {
		case "absent":
			if (value.revision !== null || value.templates.length || value.bytes !== 0 || value.corrupt !== null) contractError("schemaLibrary.absent");
			break;
		case "saved": {
			// The engine's own storage rules, applied to the record the templates make up.
			const record = parseSchemaLibraryRecord({ version: 1, templates: value.templates });
			if (!nonEmptyText(value.revision) || !record.ok || record.bytes !== value.bytes || value.corrupt !== null) contractError("schemaLibrary.saved");
			break;
		}
		case "corrupt":
			if (
				!nonEmptyText(value.revision) ||
				value.templates.length ||
				value.bytes !== null ||
				!isRecord(value.corrupt) ||
				!SCHEMA_LIBRARY_CORRUPT_REASONS.includes(value.corrupt.reason as string) ||
				!nonEmptyText(value.corrupt.detail)
			)
				contractError("schemaLibrary.corrupt");
			break;
		case "unavailable":
			if (value.revision !== null || value.templates.length || value.bytes !== null || value.corrupt !== null) contractError("schemaLibrary.unavailable");
			break;
		default:
			contractError("schemaLibrary.state");
	}
	return value as unknown as SeoAdminSchemaLibrary;
}

/** The write a library response must answer. */
export type SeoSchemaLibraryWriteExpectation =
	| { operation: "save"; mode: "create" | "update"; id: string; expectedRevision: string | null; name: string; json: string }
	| { operation: "delete"; id: string; expectedRevision: string };

export function parseSeoAdminSchemaLibraryWriteResult(
	value: unknown,
	expected: SeoSchemaLibraryWriteExpectation,
): SeoAdminSchemaLibraryWriteResult {
	if (!isRecord(value)) contractError("schemaLibrary.write");
	assertContractVersion(value, "schemaLibrary.write.contractVersion");
	if (value.success === true) {
		if (typeof value.changed !== "boolean") contractError("schemaLibrary.write.changed");
		const library = parseSeoAdminSchemaLibrary(value.library);
		if (library.state !== "saved") contractError("schemaLibrary.write.library");
		// A write moves the revision; only an unchanged update answers with the one it sent.
		const unchanged = expected.operation === "save" && expected.mode === "update" && value.changed === false;
		if (unchanged ? library.revision !== expected.expectedRevision : value.changed !== true || library.revision === expected.expectedRevision) {
			contractError("schemaLibrary.write.revision");
		}
		const stored = library.templates.find((item) => item.id === expected.id);
		if (expected.operation === "delete") {
			if (value.template !== null || stored) contractError("schemaLibrary.write.deleted");
		} else {
			const template = value.template;
			if (
				!isRecord(template) ||
				!stored ||
				Object.keys(template).length !== 5 ||
				template.id !== expected.id ||
				template.name !== expected.name.trim() ||
				template.json !== expected.json.trim() ||
				(["id", "name", "json", "createdAt", "updatedAt"] as const).some((key) => template[key] !== stored[key])
			)
				contractError("schemaLibrary.write.template");
		}
	} else if (value.success === false && value.error === "invalid_values") {
		const errors = value.errors;
		if (
			!isRecord(errors) ||
			!Object.keys(errors).length ||
			!Object.entries(errors).every(([key, message]) => ["name", "json"].includes(key) && nonEmptyText(message))
		)
			contractError("schemaLibrary.write.errors");
	} else if (value.success === false) {
		if (!SCHEMA_LIBRARY_WRITE_FAILURES.includes(value.error as string) || !nonEmptyText(value.message)) contractError("schemaLibrary.write.failure");
	} else contractError("schemaLibrary.write.success");
	return value as unknown as SeoAdminSchemaLibraryWriteResult;
}

// ---------------------------------------------------------------------------
// Business identity
// ---------------------------------------------------------------------------

const BUSINESS_IDENTITY_STATES = ["absent", "valid", "invalid", "corrupt", "read_unavailable"] as const;
const BUSINESS_IDENTITY_WRITE_ERRORS: readonly BusinessIdentityWriteError[] = [
	"invalid",
	"owned_id_defined",
	"collision_check_incomplete",
	"conflict",
	"invalid_stored",
	"unavailable",
	"unconfirmed",
	"storage_uncertain",
];
const TARGET_STATES = ["ok", "missing", "unpublished", "no_url", "unavailable"] as const;

function parseRevision(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || !value || value.length > 128) contractError(field);
	return value;
}

function parseIdentityRecord(value: unknown, field: string): BusinessIdentityRecord {
	const validation = validateBusinessIdentityRecord(value);
	if (!validation.success) contractError(field);
	return validation.value;
}

function parseGraph(value: unknown, field: string): Record<string, unknown> {
	if (!isRecord(value)) contractError(field);
	return value;
}

function parseTargetStatus(value: unknown, field: string): BusinessIdentityTargetStatus {
	if (!isRecord(value) || !(TARGET_STATES as readonly unknown[]).includes(value.status)) contractError(field);
	if (value.status === "ok") {
		if (typeof value.url !== "string" || typeof value.title !== "string" || (value.locale !== null && typeof value.locale !== "string"))
			contractError(field);
	} else if (typeof value.message !== "string") contractError(field);
	return value as unknown as BusinessIdentityTargetStatus;
}

function parseStringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) contractError(field);
	return value as string[];
}

function parseOwnership(value: unknown, field: string): BusinessIdentityView["ownership"] {
	if (value === null) return null;
	if (!isRecord(value)) contractError(field);
	if (value.status === "incomplete") {
		if (typeof value.message !== "string") contractError(field);
		return { status: "incomplete", message: value.message };
	}
	if (value.status !== "complete" || !Array.isArray(value.definitions) || !Array.isArray(value.sameBusiness)) contractError(field);
	for (const item of value.definitions) {
		if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.scope !== "string")
			contractError(`${field}.definitions`);
		parseStringList(item.ownedIds, `${field}.definitions.ownedIds`);
	}
	for (const item of value.sameBusiness) {
		if (
			!isRecord(item) ||
			(item.source !== "custom" && item.source !== "entry-data") ||
			typeof item.id !== "string" ||
			typeof item.name !== "string" ||
			typeof item.scope !== "string" ||
			typeof item.deprecatedType !== "boolean"
		)
			contractError(`${field}.sameBusiness`);
		parseStringList(item.types, `${field}.sameBusiness.types`);
		parseStringList(item.matched, `${field}.sameBusiness.matched`);
	}
	return value as unknown as BusinessIdentityView["ownership"];
}

function parseUsage(value: unknown, field: string): BusinessIdentityView["usage"] {
	if (value === null) return null;
	if (!Array.isArray(value)) contractError(field);
	for (const item of value) {
		if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.scope !== "string")
			contractError(field);
		parseStringList(item.defines, `${field}.defines`);
		parseStringList(item.references, `${field}.references`);
	}
	return value as NonNullable<BusinessIdentityView["usage"]>;
}

function parseNotices(value: unknown, field: string): BusinessIdentityView["notices"] {
	if (!Array.isArray(value) || value.some((item) => !isRecord(item) || typeof item.code !== "string" || typeof item.message !== "string"))
		contractError(field);
	return value as BusinessIdentityView["notices"];
}

const PUBLISHER_OUTPUT_STATES: readonly PublisherOwnershipEffective[] = ["automatic", "none", "unknown"];

function parsePublisherOutput(value: unknown, field: string): PublisherOwnershipEffective {
	if (!(PUBLISHER_OUTPUT_STATES as readonly unknown[]).includes(value)) contractError(field);
	return value as PublisherOwnershipEffective;
}

const PUBLISHER_OWNERSHIP_WRITE_ERRORS: readonly PublisherOwnershipWriteError[] = [
	"invalid", "unsupported", "unreadable", "conflict", "preflight", "unconfirmed", "storage_uncertain",
];

/** Strict reading: the effective mode must follow from the stored state, never be guessed. */
function parsePublisherOwnershipView(value: unknown, field: string): PublisherOwnershipView {
	if (!isRecord(value) || value.storageVersion !== PUBLISHER_OWNERSHIP_STORAGE_VERSION) contractError(`${field}.storageVersion`);
	const state = value.state;
	if (state !== "absent" && state !== "valid" && state !== "corrupt" && state !== "unavailable") contractError(`${field}.state`);
	const revision = parseRevision(value.revision, `${field}.revision`);
	if (state === "valid" ? revision === null : state !== "corrupt" && revision !== null) contractError(`${field}.revision`);
	if (state === "valid" ? !(PUBLISHER_OWNERSHIP_MODES as readonly unknown[]).includes(value.mode) : value.mode !== null) contractError(`${field}.mode`);
	const effective = parsePublisherOutput(value.effective, `${field}.effective`);
	const expected = state === "absent" ? "automatic" : state === "valid" ? value.mode : "unknown";
	if (effective !== expected) contractError(`${field}.effective`);
	if (typeof value.writable !== "boolean" || (value.writable && state !== "absent" && state !== "valid")) contractError(`${field}.writable`);
	const gates = value.gates;
	if (gates !== null && (!isRecord(gates) || typeof gates.schemaModule !== "boolean" || typeof gates.sitePublisherPreset !== "boolean"))
		contractError(`${field}.gates`);
	if (value.message !== null && typeof value.message !== "string") contractError(`${field}.message`);
	return {
		storageVersion: PUBLISHER_OWNERSHIP_STORAGE_VERSION,
		state,
		mode: value.mode as PublisherOwnershipView["mode"],
		effective,
		revision,
		writable: value.writable,
		gates: gates === null ? null : { schemaModule: gates.schemaModule as boolean, sitePublisherPreset: gates.sitePublisherPreset as boolean },
		message: value.message as string | null,
	};
}

function preflightCount(value: unknown, field: string): number {
	if (!nonNegativeInteger(value)) contractError(field);
	return value;
}

function parsePublisherOwnershipPreflight(value: unknown, field: string): PublisherOwnershipPreflight {
	if (!isRecord(value)) contractError(field);
	const source = value.source;
	if (source !== "business" && source !== "legacy" && !(value.status === "refused" && source === null)) contractError(`${field}.source`);
	const checked = preflightCount(value.checked, `${field}.checked`);
	if (value.status === "clear") {
		if (typeof value.entityId !== "string") contractError(`${field}.entityId`);
		return { status: "clear", source: source as "business" | "legacy", entityId: value.entityId, checked };
	}
	if (value.status !== "refused") contractError(`${field}.status`);
	const reason = value.reason;
	if (reason !== "collision" && reason !== "incomplete" && reason !== "overflow" && reason !== "read_failed" && reason !== "publisher_unknown")
		contractError(`${field}.reason`);
	if (value.entityId !== null && typeof value.entityId !== "string") contractError(`${field}.entityId`);
	if (!Array.isArray(value.definitions) || value.definitions.length > PUBLISHER_OWNERSHIP_LISTED_DEFINITIONS) contractError(`${field}.definitions`);
	const definitions = value.definitions.map((item, index) => {
		if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.scope !== "string")
			contractError(`${field}.definitions.${index}`);
		return { id: item.id, name: item.name, scope: item.scope, ownedIds: parseStringList(item.ownedIds, `${field}.definitions.${index}.ownedIds`) };
	});
	if (typeof value.message !== "string") contractError(`${field}.message`);
	return {
		status: "refused",
		reason,
		source: source as "business" | "legacy" | null,
		entityId: value.entityId as string | null,
		checked,
		definitions,
		more: preflightCount(value.more, `${field}.more`),
		message: value.message,
	};
}

export function parseSeoAdminPublisherOwnershipReadResult(value: unknown): { ownership: PublisherOwnershipView; check?: PublisherOwnershipCheck } {
	if (!isRecord(value)) contractError("publisherOwnership.read");
	assertContractVersion(value, "publisherOwnership.contractVersion");
	if (value.check !== undefined && value.check !== "matches_requested" && value.check !== "matches_loaded" && value.check !== "differs")
		contractError("publisherOwnership.check");
	return {
		ownership: parsePublisherOwnershipView(value.ownership, "publisherOwnership"),
		...(value.check === undefined ? {} : { check: value.check as PublisherOwnershipCheck }),
	};
}

export function parseSeoAdminPublisherOwnershipWriteResult(value: unknown): PublisherOwnershipWriteResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("publisherOwnership.write");
	assertContractVersion(value, "publisherOwnership.write.contractVersion");
	if (value.success) {
		if (typeof value.changed !== "boolean") contractError("publisherOwnership.write.changed");
		const preflight = value.preflight === undefined ? undefined : parsePublisherOwnershipPreflight(value.preflight, "publisherOwnership.write.preflight");
		if (preflight && preflight.status !== "clear") contractError("publisherOwnership.write.preflight");
		return {
			success: true,
			changed: value.changed,
			ownership: parsePublisherOwnershipView(value.ownership, "publisherOwnership.write.ownership"),
			...(preflight ? { preflight: preflight as Extract<PublisherOwnershipPreflight, { status: "clear" }> } : {}),
		};
	}
	if (!PUBLISHER_OWNERSHIP_WRITE_ERRORS.includes(value.error as PublisherOwnershipWriteError)) contractError("publisherOwnership.write.error");
	if (typeof value.message !== "string") contractError("publisherOwnership.write.message");
	const preflight = value.preflight === undefined ? undefined : parsePublisherOwnershipPreflight(value.preflight, "publisherOwnership.write.preflight");
	if (preflight && preflight.status !== "refused") contractError("publisherOwnership.write.preflight");
	if (value.intended !== undefined && !(PUBLISHER_OWNERSHIP_MODES as readonly unknown[]).includes(value.intended))
		contractError("publisherOwnership.write.intended");
	return {
		success: false,
		error: value.error as PublisherOwnershipWriteError,
		message: value.message,
		...(value.ownership === undefined ? {} : { ownership: parsePublisherOwnershipView(value.ownership, "publisherOwnership.write.ownership") }),
		...(preflight ? { preflight: preflight as Extract<PublisherOwnershipPreflight, { status: "refused" }> } : {}),
		...(value.intended === undefined ? {} : { intended: value.intended as "automatic" | "none" }),
	};
}

function parseOutput(value: unknown, field: string): BusinessIdentityView["output"] {
	if (value === null) return null;
	if (!isRecord(value)) contractError(field);
	return { full: parseGraph(value.full, `${field}.full`), minimal: parseGraph(value.minimal, `${field}.minimal`) };
}

export function parseSeoAdminBusinessIdentityView(value: unknown): BusinessIdentityView {
	const field = "businessIdentity";
	if (!isRecord(value) || value.storageVersion !== BUSINESS_IDENTITY_STORAGE_VERSION) contractError(`${field}.storageVersion`);
	if (!(BUSINESS_IDENTITY_STATES as readonly unknown[]).includes(value.state)) contractError(`${field}.state`);
	const revision = parseRevision(value.revision, `${field}.revision`);
	const record = value.record === null ? null : parseIdentityRecord(value.record, `${field}.record`);
	if ((value.state === "valid") !== (record !== null)) contractError(`${field}.record`);
	if (typeof value.writable !== "boolean") contractError(`${field}.writable`);
	if (value.message !== null && typeof value.message !== "string") contractError(`${field}.message`);
	if (typeof value.siteName !== "string" || typeof value.siteUrl !== "string") contractError(`${field}.site`);
	const legacy = value.legacy;
	if (
		!isRecord(legacy) ||
		(legacy.publisherType !== "organization" && legacy.publisherType !== "person") ||
		typeof legacy.entityId !== "string" ||
		!isRecord(legacy.draft)
	)
		contractError(`${field}.legacy`);
	const replacement = value.replacement;
	if (
		replacement !== null &&
		(!isRecord(replacement) ||
			typeof replacement.entityId !== "string" ||
			(replacement.family !== "person" && replacement.family !== "organization") ||
			typeof replacement.active !== "boolean" ||
			typeof replacement.organizationReferenceAliases !== "boolean")
	)
		contractError(`${field}.replacement`);
	const switches = value.switches;
	if (!isRecord(switches) || typeof switches.moduleEnabled !== "boolean" || typeof switches.presetEnabled !== "boolean")
		contractError(`${field}.switches`);
	const collections = value.collections;
	if (!isRecord(collections) || typeof collections.available !== "boolean" || !Array.isArray(collections.items))
		contractError(`${field}.collections`);
	for (const item of collections.items) {
		if (!isRecord(item) || !isSeoContentCollectionKey(item.collection) || typeof item.label !== "string")
			contractError(`${field}.collections.item`);
	}
	if (!Array.isArray(value.transitions)) contractError(`${field}.transitions`);
	for (const item of value.transitions) {
		if (
			!isRecord(item) ||
			(item.to !== "origin" && item.to !== "person" && item.to !== "organization") ||
			typeof item.entityId !== "string" ||
			typeof item.usageComplete !== "boolean"
		)
			contractError(`${field}.transitions.item`);
		parseStringList(item.dropped, `${field}.transitions.dropped`);
		parseUsage(item.usage, `${field}.transitions.usage`);
	}
	return {
		storageVersion: BUSINESS_IDENTITY_STORAGE_VERSION,
		state: value.state as BusinessIdentityView["state"],
		revision,
		record,
		issues: parseErrors(value.issues, `${field}.issues`),
		writable: value.writable,
		message: value.message as string | null,
		siteName: value.siteName,
		siteUrl: value.siteUrl,
		legacy: {
			publisherType: legacy.publisherType as "organization" | "person",
			entityId: legacy.entityId as string,
			draft: legacy.draft as Record<string, unknown>,
			issues: parseErrors(legacy.issues, `${field}.legacy.issues`),
		},
		replacement: replacement as BusinessIdentityView["replacement"],
		switches: { moduleEnabled: switches.moduleEnabled as boolean, presetEnabled: switches.presetEnabled as boolean },
		publisherOutput: parsePublisherOutput(value.publisherOutput, `${field}.publisherOutput`),
		collections: collections as unknown as BusinessIdentityView["collections"],
		target: value.target === null ? null : parseTargetStatus(value.target, `${field}.target`),
		ownership: parseOwnership(value.ownership, `${field}.ownership`),
		notices: parseNotices(value.notices, `${field}.notices`),
		output: parseOutput(value.output, `${field}.output`),
		usage: parseUsage(value.usage, `${field}.usage`),
		transitions: value.transitions as BusinessIdentityView["transitions"],
	};
}

export function parseSeoAdminBusinessIdentityReadResult(value: unknown): { identity: BusinessIdentityView; check?: BusinessIdentityCheck } {
	if (!isRecord(value)) contractError("businessIdentity.read");
	if (value.check !== undefined && value.check !== "matches_requested" && value.check !== "matches_loaded" && value.check !== "differs")
		contractError("businessIdentity.check");
	return {
		identity: parseSeoAdminBusinessIdentityView(value.identity),
		...(value.check === undefined ? {} : { check: value.check as BusinessIdentityCheck }),
	};
}

export function parseSeoAdminBusinessIdentityWriteResult(value: unknown): BusinessIdentityWriteResult {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("businessIdentity.write");
	if (value.success) {
		const revision = parseRevision(value.revision, "businessIdentity.write.revision");
		if (revision === null) contractError("businessIdentity.write.revision");
		return {
			success: true,
			record: parseIdentityRecord(value.record, "businessIdentity.write.record"),
			revision,
			...(value.usage === undefined ? {} : { usage: parseUsage(value.usage, "businessIdentity.write.usage") ?? [] }),
			...(value.dropped === undefined ? {} : { dropped: parseStringList(value.dropped, "businessIdentity.write.dropped") }),
		};
	}
	if (!BUSINESS_IDENTITY_WRITE_ERRORS.includes(value.error as BusinessIdentityWriteError)) contractError("businessIdentity.write.error");
	const current = value.current;
	if (current !== undefined) {
		if (!isRecord(current) || !(BUSINESS_IDENTITY_STATES as readonly unknown[]).includes(current.state)) contractError("businessIdentity.write.current");
		parseRevision(current.revision, "businessIdentity.write.current.revision");
		if (current.record !== null) parseIdentityRecord(current.record, "businessIdentity.write.current.record");
	}
	return {
		success: false,
		error: value.error as BusinessIdentityWriteError,
		errors: parseErrors(value.errors, "businessIdentity.write.errors"),
		...(value.definitions === undefined ? {} : { definitions: value.definitions as never }),
		...(current === undefined ? {} : { current: current as never }),
		...(value.intended === undefined ? {} : { intended: parseIdentityRecord(value.intended, "businessIdentity.write.intended") }),
	};
}

export interface SeoAdminBusinessIdentityPreview {
	entityId: string;
	output: { full: Record<string, unknown>; minimal: Record<string, unknown> } | null;
	publisherOutput: PublisherOwnershipEffective;
	target: BusinessIdentityTargetStatus;
	ownership: BusinessIdentityView["ownership"];
	notices: BusinessIdentityView["notices"];
}

export function parseSeoAdminBusinessIdentityPreview(
	value: unknown,
): { success: true; preview: SeoAdminBusinessIdentityPreview } | { success: false; errors: Record<string, string> } {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("businessIdentity.preview");
	if (!value.success) return { success: false, errors: parseErrors(value.errors, "businessIdentity.preview.errors") };
	if (typeof value.entityId !== "string") contractError("businessIdentity.preview.entityId");
	return {
		success: true,
		preview: {
			entityId: value.entityId,
			output: parseOutput(value.output, "businessIdentity.preview.output"),
			publisherOutput: parsePublisherOutput(value.publisherOutput, "businessIdentity.preview.publisherOutput"),
			target: parseTargetStatus(value.target, "businessIdentity.preview.target"),
			ownership: parseOwnership(value.ownership, "businessIdentity.preview.ownership"),
			notices: parseNotices(value.notices, "businessIdentity.preview.notices"),
		},
	};
}

export function parseSeoAdminBusinessIdentityPages(
	value: unknown,
): { success: true; items: BusinessIdentityPageCandidate[]; cursor?: string } | { success: false; error: string } {
	if (!isRecord(value) || typeof value.success !== "boolean") contractError("businessIdentity.pages");
	if (!value.success) {
		if (typeof value.error !== "string") contractError("businessIdentity.pages.error");
		return { success: false, error: value.error };
	}
	if (!Array.isArray(value.items) || value.items.length > 25) contractError("businessIdentity.pages.items");
	for (const item of value.items) {
		if (
			!isRecord(item) ||
			typeof item.entryId !== "string" ||
			typeof item.title !== "string" ||
			typeof item.url !== "string" ||
			(item.locale !== null && typeof item.locale !== "string") ||
			(item.slug !== null && typeof item.slug !== "string")
		)
			contractError("businessIdentity.pages.item");
	}
	if (value.cursor !== undefined && (typeof value.cursor !== "string" || !value.cursor)) contractError("businessIdentity.pages.cursor");
	return {
		success: true,
		items: value.items as BusinessIdentityPageCandidate[],
		...(value.cursor ? { cursor: value.cursor as string } : {}),
	};
}
