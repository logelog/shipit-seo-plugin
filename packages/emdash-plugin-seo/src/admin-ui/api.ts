import type { CustomVerificationTag } from "../custom-verification-tags.ts";
import { apiFetch, parseApiResponse, type AdminManifest } from "@emdash-cms/admin";
import {
	isSeoContentCollectionKey,
	type SeoAdminConfiguration,
	type SeoAdminCrawlDiagnostics,
	type SeoAdmin404Monitor,
	type SeoAdmin404TriageResult,
	type SeoNotFoundStatus,
	type SeoAdminContentOptions,
	type SeoAdminContentAudit,
	type SeoAdminEntryAnalysisIdentityResult,
	type SeoAdminSavedAnalysisResult,
	type SeoAdminScoreScanCommandRequest,
	type SeoAdminScoreScanResult,
	type SeoAdminScoreScanStartRequest,
	type SeoAdminScoreScanStateResult,
	type SeoAdminScoreScanTaxonomiesResult,
	type SeoAdminScoreScanTermsRequest,
	type SeoAdminScoreScanTermsResult,
	type SeoAdminContentAuditOptions,
	type SeoAdminContentScore,
	type SeoAdminContentScores,
	type SeoAdminEntryDirectivesResult,
	type SeoAdminEntrySchemaPreviewResult,
	type SeoAdminEntrySchemaCandidatePreviewResult,
	type SeoAdminSchemaLibrary,
	type SeoAdminSchemaLibraryWriteResult,
	type SeoAdminFocusKeywordSaveResult,
	type SeoAdminAnalysisProfileResult,
	type SeoAdminRobotsDirectives,
	type SeoAdminCustomSchemaDeleteResult,
	type SeoAdminCustomSchemaWriteInput,
	type SeoAdminCustomSchemaReadResult,
	type SeoAdminCustomSchemaDeleteInput,
	type SeoAdminSchemaComposerWriteInput,
	type SeoAdminSchemaPresetsWriteInput,
	type SeoAdminSchemaPresetConfiguration,
	type SeoAdminCustomSchemaSaveResult,
	type SeoAdminModulesSaveResult,
	type SeoAdminModuleValues,
	type CoreSeoMigrationConflictPolicy,
	type SeoAdminLegacyDiscardResult,
	type SeoAdminMigrationOperationResult,
	type SeoAdminMigrationPlanResponse,
	type SeoAdminMigrationSelection,
	type SeoAdminMigrationRecordStatus,
	type SeoAdminMigrationStatusResponse,
	type SeoAdminOverview,
	type SeoAdminRefreshCollection,
	type SeoAdminRefreshResult,
	type SeoAdminSchemaContentTypesReadResult,
	type SeoAdminSchemaContentTypesSaveResult,
	type SeoAdminSchemaContentTypeValues,
	type SeoAdminSchemaPresetsSaveResult,
	type SeoAdminSchemaComposerSaveResult,
	type SeoAdminScoreTrends,
	type SeoAdminReadableSettings,
	type SeoAdminSettings,
	type SeoAdminCollectionAnalysisProfileResult,
	type SeoAdminCollectionAnalysisProfileChange,
	type SeoAdminCollectionAnalysisProfileSaveResult,
	type SeoAdminContentScoringChange,
	type SeoAdminSettingsSaveResult,
	type SeoAdminSettingsValues,
	type SeoAdminLlmsTxt,
	type SeoAdminLlmsTxtWriteResult,
	type SeoAdminRobotsTxtFacts,
	type SeoAdminSitemapConfiguration,
	type SeoAdminSitemapSaveResult,
	type SeoAdminSitemapPreview,
	type SeoAdminSitemapValues,
	type SeoAdminEntryPreviewResult,
	type SeoAdminSocialOverrideSaveResult,
	type SeoAdminSocialOverrideReadResult,
	type IndexNowSubmissionSource,
	type IndexNowSubmissionStatus,
	type SeoAdminIndexNowAutomationInput,
	type SeoAdminIndexNowHistoryResult,
	type SeoAdminIndexNowHistoryUrlsResult,
	type SeoAdminIndexNowOperationResult,
	type SeoAdminIndexNowSaveResult,
	type SeoAdminIndexNowStatus,
	type SeoAdminRedirectRuleCreateResult,
	type SeoAdminEntrySchemaListResult,
	type SeoAdminEntrySchemaRemoveResult,
	type SeoAdminEntrySchemaSaveResult,
	type SeoAdminRedirectRuleListResult,
	type SeoAdminTemplateConfiguration,
	type SeoAdminTemplateExampleResult,
	type SeoAdminTemplateExamplesResult,
	type SeoAdminTemplateInheritanceGuard,
	type SeoAdminTemplatePreviewResult,
	type SeoAdminTemplateSet,
	type SeoAdminTemplatesSaveResult,
	type SeoAdminTemplateValues,
	type IndexNowSettingsValues,
	type SeoPortabilityApplyResult,
	type SeoPortabilityBundle,
	type SeoPortabilityExportResponse,
	type SeoPortabilityMode,
	type SeoPortabilityPreviewResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import type { BusinessIdentityRecord } from "../business-identity.ts";
import type { BusinessIdentityPublisherChange } from "../business-identity-commands.ts";
import { seoAdminApiUrl } from "./api-routes.ts";
import { runSocialRequest } from "./social-request.ts";
import {
	core404ListUrl,
	core404PageResult,
	core404SummaryUrl,
	parseCore404Summary,
	type Core404SummaryItem,
	type Core404PageResult,
	type Core404PageRequest,
} from "../core-404-activity.ts";
import {
	createSavedContentSnapshot,
	isSavedContentItem,
	savedContentVersion,
	savedSnapshotMatches,
	verifySavedContentVersions,
	type SavedContentSnapshot,
} from "./saved-content-snapshot.ts";
import {
	parseSeoAdmin404Monitor,
	parseSeoAdmin404TriageResult,
	parseSeoAdminConfiguration,
	parseSeoAdminCrawlDiagnostics,
	parseSeoAdminContentOptions,
	parseSeoAdminContentAudit,
	parseSeoAdminEntryAnalysisIdentityResult,
	parseSeoAdminSavedAnalysisResult,
	parseSeoAdminContentAuditOptions,
	parseSeoAdminContentScores,
	parseSeoAdminEntryDirectivesResult,
	parseSeoAdminEntrySchemaPreviewResult,
	parseSeoAdminFocusKeywordSaveResult,
	parseSeoAdminAnalysisProfileResult,
	parseSeoAdminCustomSchemaReadResult,
	parseSeoAdminSchemaPresetConfiguration,
	parseSeoAdminCustomSchemaDeleteResult,
	parseSeoAdminCustomSchemaSaveResult,
	parseSeoAdminModulesSaveResult,
	parseSeoAdminLegacyDiscardResponse,
	parseSeoAdminMigrationOperationResult,
	parseSeoAdminMigrationPlan,
	parseSeoAdminMigrationStatus,
	parseSeoAdminOverview,
	parseSeoAdminRefreshResult,
	parseSeoAdminScoreScanResult,
	parseSeoAdminScoreScanStateResult,
	parseSeoAdminScoreScanTaxonomiesResult,
	parseSeoAdminScoreScanTermsResult,
	parseSeoAdminSchemaContentTypesReadResult,
	parseSeoAdminSchemaContentTypesSaveResult,
	parseSeoAdminBusinessIdentityPages,
	parseSeoAdminBusinessIdentityPreview,
	parseSeoAdminBusinessIdentityReadResult,
	parseSeoAdminBusinessIdentityWriteResult,
	parseSeoAdminPublisherOwnershipReadResult,
	parseSeoAdminPublisherOwnershipWriteResult,
	parseSeoAdminSchemaPresetsSaveResult,
	parseSeoAdminSchemaComposerSaveResult,
	parseSeoAdminScoreTrends,
	parseSeoAdminSettings,
	parseSeoCollectionAnalysisProfileResult,
	parseSeoCollectionAnalysisProfileSaveResult,
	parseSeoAdminSettingsSaveResult,
	parseSeoAdminLlmsTxt,
	parseSeoAdminLlmsTxtWriteResult,
	parseSeoAdminRobotsTxtFacts,
	parseSeoAdminSitemap,
	parseSeoAdminSitemapPreview,
	parseSeoAdminSitemapSaveResult,
	parseSeoAdminEntryPreviewResult,
	parseSeoAdminSocialOverrideSaveResult,
	parseSeoAdminSocialOverrideReadResult,
	parseSeoAdminIndexNowHistoryResult,
	parseSeoAdminIndexNowHistoryUrlsResult,
	parseSeoAdminIndexNowOperationResult,
	parseSeoAdminIndexNowSaveResult,
	parseSeoAdminIndexNowStatus,
	parseSeoAdminRedirectRuleCreateResult,
	parseSeoAdminEntrySchemaListResult,
	parseSeoAdminEntrySchemaRemoveResult,
	parseSeoAdminEntrySchemaCandidatePreviewResult,
	parseSeoAdminSchemaLibrary,
	parseSeoAdminSchemaLibraryWriteResult,
	parseSeoAdminEntrySchemaSaveResult,
	parseSeoAdminRedirectRuleListResult,
	parseSeoAdminTemplateConfiguration,
	parseSeoAdminTemplateExampleResult,
	parseSeoAdminTemplateExamplesResult,
	parseSeoAdminTemplatePreviewResult,
	parseSeoAdminTemplatesSaveResult,
	parseSeoPortabilityApplyResult,
	parseSeoPortabilityExportResponse,
	parseSeoPortabilityPreviewResult,
} from "./contract.ts";
import {
	parseCoreRedirectPage,
	type CoreRedirectInventory,
	type CoreRedirectRule,
} from "./redirect-manager.ts";

export async function fetchSeoAdminCrawlDiagnostics(): Promise<SeoAdminCrawlDiagnostics> {
	const response = await apiFetch(seoAdminApiUrl("admin-crawl-diagnostics"));
	return parseSeoAdminCrawlDiagnostics(
		await parseApiResponse<unknown>(
			response,
			"Failed to load crawl diagnostics",
		),
	);
}

export async function fetchSeoAdmin404Monitor(
	limit = 100,
): Promise<SeoAdmin404Monitor> {
	const response = await apiFetch(
		`${seoAdminApiUrl("admin-404-monitor")}?limit=${limit}`,
	);
	return parseSeoAdmin404Monitor(
		await parseApiResponse<unknown>(response, "Failed to load the 404 monitor"),
	);
}

export async function fetchCore404Summary(limit = 50, signal?: AbortSignal): Promise<Core404SummaryItem[]> {
	const response = await apiFetch(core404SummaryUrl(limit), { signal });
	return parseCore404Summary(
		await parseApiResponse<unknown>(response, "Failed to load EmDash 404 activity"),
		limit,
	);
}

export async function fetchCore404Records(
	request: Core404PageRequest,
	signal?: AbortSignal,
): Promise<Core404PageResult> {
	const snapshot = { ...request };
	const response = await apiFetch(core404ListUrl(snapshot), { signal });
	return core404PageResult(snapshot,
		await parseApiResponse<unknown>(response, "Failed to load EmDash retained paths"),
	);
}

export async function triageSeoAdmin404(input: {
	id: string;
	status: SeoNotFoundStatus;
	redirectTarget?: string | null;
	limit?: number;
}): Promise<SeoAdmin404TriageResult> {
	const response = await apiFetch(seoAdminApiUrl("triage-admin-404"), {
		method: "POST",
		body: JSON.stringify(input),
	});
	return parseSeoAdmin404TriageResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to update the 404 monitor",
		),
	);
}

export interface SeoAdminRedirectRuleRequest {
	search?: string | null;
	enabled?: boolean | null;
	auto?: boolean | null;
	group?: string | null;
	limit?: number;
	cursor?: string | null;
}

export interface SeoAdminRedirectRuleInput {
	source: string;
	destination: string;
	type: 301 | 302;
}

export async function fetchSeoAdminRedirectRules(
	query: SeoAdminRedirectRuleRequest,
): Promise<SeoAdminRedirectRuleListResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-redirect-rules"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(query),
	});
	return parseSeoAdminRedirectRuleListResult(
		await parseApiResponse<unknown>(response, "Failed to load redirect rules"),
	);
}

export async function createSeoAdminRedirectRule(
	input: SeoAdminRedirectRuleInput,
	signal?: AbortSignal,
): Promise<SeoAdminRedirectRuleCreateResult> {
	const response = await apiFetch(seoAdminApiUrl("create-admin-redirect-rule"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		...(signal ? { signal } : {}),
	});
	return parseSeoAdminRedirectRuleCreateResult(
		await parseApiResponse<unknown>(response, "Failed to create the redirect"),
	);
}

/** Read-only: settles a create whose response never arrived. */
export async function reconcileSeoAdminRedirectRule(
	input: SeoAdminRedirectRuleInput,
	signal?: AbortSignal,
): Promise<SeoAdminRedirectRuleCreateResult> {
	const response = await apiFetch(seoAdminApiUrl("reconcile-admin-redirect-rule"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		...(signal ? { signal } : {}),
	});
	return parseSeoAdminRedirectRuleCreateResult(
		await parseApiResponse<unknown>(response, "Failed to check the redirect"),
	);
}

export async function fetchCoreRedirectInventory(
	maxRules = 1_000,
): Promise<CoreRedirectInventory> {
	const boundedMax = Math.min(2_000, Math.max(1, Math.trunc(maxRules)));
	const rules = new Map<string, CoreRedirectRule>();
	const visitedCursors = new Set<string>();
	let cursor: string | null = null;
	let complete = true;

	do {
		const params = new URLSearchParams({
			limit: String(Math.min(100, boundedMax - rules.size)),
		});
		if (cursor) params.set("cursor", cursor);
		const response = await apiFetch(
			`/_emdash/api/redirects?${params.toString()}`,
		);
		const page = parseCoreRedirectPage(
			await parseApiResponse<unknown>(
				response,
				"Failed to load EmDash redirects",
			),
		);
		for (const rule of page.items) rules.set(rule.id, rule);
		cursor = page.nextCursor;
		if (cursor && visitedCursors.has(cursor))
			throw new Error(
				"EmDash redirects returned a repeated pagination cursor.",
			);
		if (cursor) visitedCursors.add(cursor);
		if (cursor && rules.size >= boundedMax) complete = false;
	} while (cursor && complete);

	const values = [...rules.values()];
	return {
		rules: values,
		complete,
	};
}

export async function fetchSeoAdminIndexNow(
	limit = 25,
): Promise<SeoAdminIndexNowStatus> {
	const response = await apiFetch(
		`${seoAdminApiUrl("admin-indexnow")}?limit=${limit}`,
	);
	return parseSeoAdminIndexNowStatus(
		await parseApiResponse<unknown>(response, "Failed to load IndexNow status"),
	);
}

export async function saveSeoAdminIndexNow(
	values: IndexNowSettingsValues,
	expectedUpdatedAt?: string | null,
): Promise<SeoAdminIndexNowSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-admin-indexnow"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...values, expectedUpdatedAt }),
	});
	return parseSeoAdminIndexNowSaveResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to save IndexNow settings",
		),
	);
}

export async function generateSeoAdminIndexNowKey(
	expectedUpdatedAt: string | null,
): Promise<SeoAdminIndexNowSaveResult> {
	const response = await apiFetch(
		seoAdminApiUrl("generate-admin-indexnow-key"),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ expectedUpdatedAt }),
		},
	);
	return parseSeoAdminIndexNowSaveResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to generate an IndexNow key",
		),
	);
}

export async function setupSeoAdminIndexNow(
	expectedUpdatedAt: string | null,
): Promise<SeoAdminIndexNowSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("setup-admin-indexnow"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ expectedUpdatedAt }),
	});
	return parseSeoAdminIndexNowSaveResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to set up IndexNow",
		),
	);
}

export async function saveSeoAdminIndexNowAutomation(
	input: SeoAdminIndexNowAutomationInput,
): Promise<SeoAdminIndexNowSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-admin-indexnow-automation"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	return parseSeoAdminIndexNowSaveResult(
		await parseApiResponse<unknown>(response, "Failed to save automatic submission"),
	);
}

export async function fetchSeoAdminIndexNowHistory(query: {
	cursor?: string | null;
	limit?: number;
	status?: IndexNowSubmissionStatus | null;
	source?: IndexNowSubmissionSource | null;
}): Promise<SeoAdminIndexNowHistoryResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-indexnow-history"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(query),
	});
	return parseSeoAdminIndexNowHistoryResult(
		await parseApiResponse<unknown>(response, "Failed to load submission history"),
	);
}

export async function fetchSeoAdminIndexNowHistoryUrls(
	submissionId: string,
	page: number,
): Promise<SeoAdminIndexNowHistoryUrlsResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-indexnow-history-urls"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ submissionId, page }),
	});
	return parseSeoAdminIndexNowHistoryUrlsResult(
		await parseApiResponse<unknown>(response, "Failed to load submitted URLs"),
	);
}

export async function retrySeoAdminIndexNowSubmission(
	submissionId: string,
): Promise<SeoAdminIndexNowOperationResult> {
	const response = await apiFetch(seoAdminApiUrl("retry-admin-indexnow-submission"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ submissionId, deliverNow: true }),
	});
	return parseSeoAdminIndexNowOperationResult(
		await parseApiResponse<unknown>(response, "Failed to retry this submission"),
	);
}

export async function submitSeoAdminIndexNow(
	urls: string[],
	options: { force?: boolean; deliverNow?: boolean } = {},
): Promise<SeoAdminIndexNowOperationResult> {
	const response = await apiFetch(seoAdminApiUrl("submit-admin-indexnow"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			urls,
			force: options.force ?? false,
			deliverNow: options.deliverNow ?? true,
		}),
	});
	return parseSeoAdminIndexNowOperationResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to submit URLs to IndexNow",
		),
	);
}

export async function drainSeoAdminIndexNow(
	force = false,
): Promise<SeoAdminIndexNowOperationResult> {
	const response = await apiFetch(seoAdminApiUrl("drain-admin-indexnow"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ force }),
	});
	return parseSeoAdminIndexNowOperationResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to process the IndexNow queue",
		),
	);
}

export async function retrySeoAdminIndexNow(): Promise<SeoAdminIndexNowOperationResult> {
	const response = await apiFetch(seoAdminApiUrl("retry-admin-indexnow"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ deliverNow: true }),
	});
	return parseSeoAdminIndexNowOperationResult(
		await parseApiResponse<unknown>(response, "Failed to retry IndexNow URLs"),
	);
}

export async function fetchSeoAdminOverview(
	limit = 50,
): Promise<SeoAdminOverview> {
	const response = await apiFetch(
		`${seoAdminApiUrl("admin-overview")}?limit=${limit}`,
	);
	return parseSeoAdminOverview(
		await parseApiResponse<unknown>(response, "Failed to load SEO overview"),
	);
}

export async function fetchSeoAdminContentOptions(
	options: { collection?: string; limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<SeoAdminContentOptions> {
	const params = new URLSearchParams();
	if (options.collection) {
		params.set("collection", options.collection);
		params.set("limit", String(options.limit ?? 25));
	}
	if (options.cursor) params.set("cursor", options.cursor);
	const response = await apiFetch(
		`${seoAdminApiUrl("admin-content-options")}${params.size ? `?${params.toString()}` : ""}`,
		{ signal: options.signal },
	);
	const page = parseSeoAdminContentOptions(
		await parseApiResponse<unknown>(
			response,
			"Failed to load SEO content options",
		),
	);
	if (!options.collection) {
		if (page.items.length || page.hasMore || page.cursor !== undefined)
			throw new Error("Invalid SEO admin response: contentOptions.metadataOnly");
	} else if (
		page.items.length > (options.limit ?? 25) ||
		page.items.some((item) => item.collection !== options.collection) ||
		page.hasMore === undefined
	) {
		throw new Error("Invalid SEO admin response: contentOptions.page");
	}
	return page;
}

export async function fetchSeoAuditContentOptions(
	options: { collection?: string; cursor?: string; signal?: AbortSignal } = {},
): Promise<SeoAdminContentAuditOptions> {
	const response = await apiFetch(
		seoAdminApiUrl("audit-content-options"),
		{ signal: options.signal },
	);
	const metadata = parseSeoAdminContentAuditOptions(
		await parseApiResponse<unknown>(response, "Failed to load content for analysis"),
	);
	if (metadata.items.length || metadata.hasMore || metadata.cursor !== undefined) {
		throw new Error("Invalid SEO admin response: contentAuditOptions.metadataOnly");
	}
	const manifestResponse = await apiFetch("/_emdash/api/manifest", { signal: options.signal });
	const manifest = await parseApiResponse<AdminManifest>(manifestResponse, "Failed to load content types");
	if (!manifest.collections || typeof manifest.collections !== "object" || Array.isArray(manifest.collections)) throw new Error("Invalid content type metadata.");
	metadata.collections = metadata.collections.flatMap((definition) => {
		const collection = manifest.collections[definition.collection];
		if (!collection || collection.hidden || collection.routable === false) return [];
		return [{
			...definition,
			label: collection.label,
			labelSingular: collection.labelSingular,
			hasSeo: collection.hasSeo,
			urlPattern: collection.urlPattern ?? null,
		}];
	});
	if (!options.collection) {
		return metadata;
	}
	const collection = metadata.collections.find((item) => item.collection === options.collection);
	if (!collection) throw new Error("Select an available content type.");
	const params = new URLSearchParams({ limit: "25", orderBy: "updatedAt", order: "desc" });
	if (options.cursor) params.set("cursor", options.cursor);
	const pageResponse = await apiFetch(
		`/_emdash/api/content/${encodeURIComponent(collection.collection)}?${params.toString()}`,
		{ signal: options.signal },
	);
	const page = await parseApiResponse<{ items: unknown[]; nextCursor?: string }>(pageResponse, "Failed to load saved content");
	if (!Array.isArray(page.items) || page.items.length > 25 || !page.items.every(isSavedContentItem) ||
		(page.nextCursor !== undefined && (typeof page.nextCursor !== "string" || !page.nextCursor ||
			page.nextCursor === options.cursor || !page.items.length))) {
		throw new Error("Invalid SEO admin response: contentAuditOptions.page");
	}
	return parseSeoAdminContentAuditOptions({
		...metadata,
		items: page.items.map((item) => ({
			ref: `${collection.collection}:${item.id}`, entryId: item.id,
			collection: collection.collection, collectionLabel: collection.label,
			title: typeof item.data.title === "string" ? item.data.title : typeof item.data.name === "string" ? item.data.name : item.slug ?? item.id,
			updatedAt: item.updatedAt, sourceVersion: savedContentVersion(item),
		})),
		hasMore: page.nextCursor !== undefined,
		...(page.nextCursor !== undefined ? { cursor: page.nextCursor } : {}),
	});
}

export interface FetchSeoScoreTrendsOptions {
	days?: number;
	collection?: string;
	ref?: string;
}

export async function fetchSeoScoreTrends(
	options: FetchSeoScoreTrendsOptions = {},
): Promise<SeoAdminScoreTrends> {
	const params = new URLSearchParams();
	params.set(
		"days",
		String(Math.min(Math.max(Math.trunc(options.days ?? 30), 7), 90)),
	);
	if (options.collection) params.set("collection", options.collection);
	if (options.ref) params.set("ref", options.ref);
	const response = await apiFetch(
		`${seoAdminApiUrl("score-trends")}?${params.toString()}`,
	);
	return parseSeoAdminScoreTrends(
		await parseApiResponse<unknown>(
			response,
			"Failed to load SEO score trends",
		),
	);
}

export interface FetchSeoContentScoresOptions {
	collection?: string;
	ref?: string;
	refs?: readonly string[];
	limit?: number;
	cursor?: string;
	refresh?: boolean;
	/** Read only persisted analyzer snapshots. Never analyze or write content. */
	storedOnly?: boolean;
	snapshotOnly?: boolean;
	keyword?: string;
	signal?: AbortSignal;
}

export async function fetchSeoContentScores(
	options: FetchSeoContentScoresOptions = {},
): Promise<SeoAdminContentScores> {
	const params = new URLSearchParams();
	if (options.collection) params.set("collection", options.collection);
	if (options.ref) params.set("ref", options.ref);
	if (options.refs?.length) {
		params.set(
			"refs",
			JSON.stringify(
				[
					...new Set(options.refs.map((ref) => ref.trim()).filter(Boolean)),
				].slice(0, 200),
			),
		);
	}
	if (options.cursor) params.set("cursor", options.cursor);
	if (options.keyword) params.set("keyword", options.keyword);
	if (options.refresh) params.set("refresh", "true");
	if (options.storedOnly) params.set("storedOnly", "true");
	if (options.snapshotOnly) params.set("snapshotOnly", "true");
	params.set(
		"limit",
		String(Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 200)),
	);
	const response = await apiFetch(
		`${seoAdminApiUrl("scores")}?${params.toString()}`,
		{
			signal: options.signal,
		},
	);
	return parseSeoAdminContentScores(
		await parseApiResponse<unknown>(
			response,
			"Failed to load SEO content scores",
		),
	);
}

export async function fetchSeoContentScore(
	ref: string,
	options: Pick<
		FetchSeoContentScoresOptions,
		"keyword" | "refresh" | "storedOnly" | "snapshotOnly" | "signal"
	> = {},
): Promise<SeoAdminContentScore | null> {
	const response = await fetchSeoContentScores({ ...options, ref, limit: 1 });
	return response.items[0] ?? null;
}

async function fetchSavedContentItem(ref: string, options: { signal?: AbortSignal } = {}) {
	options.signal?.throwIfAborted();
	const separator = ref.indexOf(":");
	const collection = ref.slice(0, separator);
	const id = ref.slice(separator + 1);
	if (separator < 1 || !isSeoContentCollectionKey(collection) || !id.trim()) throw new Error("Invalid content reference.");
	const response = await apiFetch(`/_emdash/api/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { signal: options.signal });
	if (response.status === 404) return null;
	const result = await parseApiResponse<{ item: unknown }>(response, "Failed to load saved content");
	if (!isSavedContentItem(result.item) || result.item.id !== id) throw new Error("Invalid saved content response.");
	return result.item;
}

/** The saved entry is newer than the version the caller showed; `sourceVersion` is the newer one. */
export class SavedContentChangedError extends Error {
	readonly sourceVersion: string;
	constructor(sourceVersion: string) {
		super("Saved content changed. Reload the entry preview.");
		this.name = "SavedContentChangedError";
		this.sourceVersion = sourceVersion;
	}
}

export async function fetchSavedContentSnapshot(
	ref: string,
	options: { signal?: AbortSignal } = {},
): Promise<SavedContentSnapshot | null> {
	const item = await fetchSavedContentItem(ref, options);
	if (!item) return null;
	let revision: unknown;
	if (item.draftRevisionId) {
		const response = await apiFetch(`/_emdash/api/revisions/${encodeURIComponent(item.draftRevisionId)}`, { signal: options.signal });
		const result = await parseApiResponse<{ item: unknown }>(response, "Failed to load the saved draft");
		revision = result.item;
	}
	options.signal?.throwIfAborted();
	return createSavedContentSnapshot(ref, item, revision);
}

export async function fetchSavedContentVersion(ref: string, options: { signal?: AbortSignal } = {}) {
	const item = await fetchSavedContentItem(ref, options);
	return item ? savedContentVersion(item) : null;
}

export async function auditSeoContent(
	refs: readonly string[],
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminContentAudit> {
	if (!refs.length || refs.length > 25) throw new Error("Select between 1 and 25 entries to analyze.");
	const requested = new Set(refs);
	const snapshots: SavedContentSnapshot[] = [];
	for (const ref of requested) {
		const snapshot = await fetchSavedContentSnapshot(ref, options);
		if (snapshot) snapshots.push(snapshot);
	}
	const response = await apiFetch(seoAdminApiUrl("audit-content"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ refs: [...requested], snapshots }),
		signal: options.signal,
	});
	const result = parseSeoAdminContentAudit(
		await parseApiResponse<unknown>(response, "Failed to analyze saved content"),
	);
	const returned = [...result.items, ...result.failures].map((item) => item.ref);
	if (returned.length !== requested.size || returned.some((ref) => !requested.has(ref))) {
		throw new Error("Invalid SEO admin response: contentAudit.requestedRefs");
	}
	const submitted = new Map(snapshots.map((snapshot) => [snapshot.ref, snapshot.sourceVersion]));
	if (result.items.some((item) => !savedSnapshotMatches(item, { ref: item.ref, sourceVersion: submitted.get(item.ref) ?? "" }))) {
		throw new Error("Invalid SEO admin response: contentAudit.savedSnapshot");
	}
	const verified = await verifySavedContentVersions(result.items, (ref) => fetchSavedContentVersion(ref, options), options.signal);
	return { ...result, items: verified.items, failures: [...result.failures, ...verified.failures] };
}

/** The current analyzer and scoped configuration identity for one exact entry, read without analyzing. */
export async function fetchSeoEntryAnalysisIdentity(
	ref: string,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminEntryAnalysisIdentityResult> {
	const response = await apiFetch(seoAdminApiUrl("entry-analysis-identity"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ref }),
		signal: options.signal,
	});
	return parseSeoAdminEntryAnalysisIdentityResult(
		await parseApiResponse<unknown>(response, "Failed to read the SEO analysis identity"),
		ref,
	);
}

/**
 * Durable analysis of the exact saved entry and its locale. Only the reference
 * is sent; unsaved editor values and trial keywords are never stored by it.
 */
export async function analyzeSavedSeoContent(
	ref: string,
	locale: string | null,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminSavedAnalysisResult> {
	const response = await apiFetch(seoAdminApiUrl("analyze-saved-content"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ref, locale }),
		signal: options.signal,
	});
	return parseSeoAdminSavedAnalysisResult(
		await parseApiResponse<unknown>(response, "Failed to analyze the saved content"),
		ref,
	);
}

export async function saveSeoFocusKeywords(
	ref: string,
	// `null` updates pillar alone and preserves the stored keyword statement —
	// it never adopts an inherited content keyword into the profile.
	keywords: readonly string[] | null,
	options: { pillar?: boolean; profileOnly?: boolean } = {},
): Promise<SeoAdminFocusKeywordSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-focus-keyword"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			ref,
			keywords,
			...(options.profileOnly ? { profileOnly: true } : {}),
			...(options.pillar === undefined ? {} : { pillar: options.pillar }),
		}),
	});
	const result = parseSeoAdminFocusKeywordSaveResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to save the focus keywords",
		),
	);
	if (result.success && (result.ref !== ref || (options.profileOnly && result.item !== null))) {
		throw new Error("Invalid SEO admin response: focusKeyword.requestedRef");
	}
	return result;
}

export async function fetchSeoAnalysisProfile(ref: string, options: { signal?: AbortSignal } = {}): Promise<SeoAdminAnalysisProfileResult> {
	const response = await apiFetch(seoAdminApiUrl("analysis-profile"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ref }),
		signal: options.signal,
	});
	const result = parseSeoAdminAnalysisProfileResult(await parseApiResponse<unknown>(response, "Failed to load the analysis settings"));
	if (result.success && result.ref !== ref) throw new Error("Invalid SEO admin response: analysisProfile.requestedRef");
	return result;
}

export async function fetchSeoEntryDirectives(
	ref: string,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminEntryDirectivesResult> {
	const response = await apiFetch(seoAdminApiUrl("entry-directives"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ref }),
		signal: options.signal,
	});
	return parseSeoAdminEntryDirectivesResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to load robots directives",
		),
	);
}

export async function saveSeoEntryDirectives(
	ref: string,
	robots: SeoAdminRobotsDirectives | undefined,
	options: { disabledPresets?: readonly string[] } = {},
): Promise<SeoAdminEntryDirectivesResult> {
	const response = await apiFetch(seoAdminApiUrl("save-entry-directives"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			ref,
			...(robots === undefined ? {} : { robots }),
			...(options.disabledPresets === undefined
				? {}
				: { disabledPresets: options.disabledPresets }),
		}),
	});
	return parseSeoAdminEntryDirectivesResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to save robots directives",
		),
	);
}

export async function fetchSeoEntrySchemaPreview(
	ref: string,
	options: { signal?: AbortSignal; snapshot?: SavedContentSnapshot | null; savedVersion?: string; locale?: string | null } = {},
): Promise<SeoAdminEntrySchemaPreviewResult> {
	options.signal?.throwIfAborted();
	const snapshot = options.snapshot;
	if (!snapshot || snapshot.ref !== ref || !snapshot.sourceVersion ||
		options.savedVersion !== snapshot.sourceVersion || options.locale === undefined) {
		throw new Error("Confirm the saved entry before loading its schema prediction.");
	}
	const sourceVersion = snapshot.sourceVersion;
	const locale = options.locale;
	const response = await apiFetch(seoAdminApiUrl("entry-schema-preview"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		// Reuse the input already read and verified for the entry preview.
		body: JSON.stringify({ ref, entryOnly: true, snapshot }),
		signal: options.signal,
	});
	const result = parseSeoAdminEntrySchemaPreviewResult(
		await parseApiResponse<unknown>(response, "Failed to load resolved schema"),
	);
	if (result.success) {
		const latest = await fetchSavedContentItem(ref, options);
		const latestLocale = latest && "locale" in latest && typeof latest.locale === "string" ? latest.locale : null;
		if (!latest || savedContentVersion(latest) !== sourceVersion || latestLocale !== locale) {
			throw new Error("Saved content changed or could not be verified. Reload the schema prediction.");
		}
	}
	options.signal?.throwIfAborted();
	return result;
}

/** Backwards-compatible single-keyword client for older integrations. */
export async function saveSeoFocusKeyword(
	ref: string,
	keyword: string,
): Promise<SeoAdminFocusKeywordSaveResult> {
	return saveSeoFocusKeywords(ref, keyword.trim() ? [keyword] : []);
}

export async function refreshSeoScores(options: {
	collection: SeoAdminRefreshCollection;
	cursor?: string;
	revision?: string;
	limit?: number;
	status?: "draft" | "published" | "scheduled";
	locale?: string;
}): Promise<SeoAdminRefreshResult> {
	const response = await apiFetch(seoAdminApiUrl("refresh-scores"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(options),
	});
	return parseSeoAdminRefreshResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to refresh SEO scores",
		),
	);
}

/**
 * With `snapshot`, the plan is one exact record's (one ref, limit 1, no
 * cursor) and its export is bound to that plan's fingerprint and policy.
 */
export async function fetchSeoAdminMigrationPlan(
	conflictPolicy: CoreSeoMigrationConflictPolicy = "skip",
	refs?: string[],
	cursor?: string,
	options: { snapshot?: boolean } = {},
): Promise<SeoAdminMigrationPlanResponse> {
	if (options.snapshot && (refs?.length !== 1 || cursor !== undefined)) {
		throw new Error("A record export needs exactly one legacy record and no cursor.");
	}
	const response = await apiFetch(seoAdminApiUrl("core-seo-migration-plan"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(
			options.snapshot
				? { conflictPolicy, limit: 1, refs, snapshot: true }
				: {
					conflictPolicy,
					limit: 100,
					...(refs?.length ? { refs } : {}),
					...(cursor ? { cursor } : {}),
				},
		),
	});
	const plan = parseSeoAdminMigrationPlan(
		await parseApiResponse<unknown>(
			response,
			"Failed to build the SEO migration plan",
		),
	);
	if (options.snapshot) {
		const [item] = plan.items;
		if (plan.items.length !== 1 || item.sourceOverrideId !== refs![0] || !item.snapshot) {
			throw new Error("Invalid SEO admin response: migration.plan.snapshot.request");
		}
		if (item.snapshot.status === "available" &&
			(JSON.parse(item.snapshot.document) as { conflictPolicy?: unknown }).conflictPolicy !== conflictPolicy) {
			throw new Error("Invalid SEO admin response: migration.plan.snapshot.policy");
		}
	}
	return plan;
}

export async function applySeoAdminMigration(
	plans: SeoAdminMigrationSelection[],
	conflictPolicy: CoreSeoMigrationConflictPolicy,
	confirm: string,
): Promise<SeoAdminMigrationOperationResult> {
	const response = await apiFetch(seoAdminApiUrl("core-seo-migration-apply"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ plans, conflictPolicy, confirm }),
	});
	return parseSeoAdminMigrationOperationResult(
		await parseApiResponse<unknown>(response, "Failed to migrate SEO records"),
	);
}

export async function discardSeoAdminLegacyOverride(
	selection: SeoAdminMigrationSelection,
	conflictPolicy: CoreSeoMigrationConflictPolicy,
	confirm: string,
): Promise<SeoAdminLegacyDiscardResult> {
	const response = await apiFetch(seoAdminApiUrl("discard-admin-legacy-override"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...selection, conflictPolicy, confirm }),
	});
	const result = parseSeoAdminLegacyDiscardResponse(
		await parseApiResponse<unknown>(response, "Failed to discard the legacy SEO record"),
	);
	if (!result.success && result.error === "discard_unavailable") {
		throw new Error("This site cannot remove the record with a guarded delete, so it was not removed.");
	}
	return result;
}

export async function fetchSeoAdminMigrationStatus(
	options: {
		batchId?: string;
		status?: SeoAdminMigrationRecordStatus;
		limit?: number;
		cursor?: string;
		latest?: boolean;
	} = {},
): Promise<SeoAdminMigrationStatusResponse> {
	const response = await apiFetch(seoAdminApiUrl("core-seo-migration-status"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...options, limit: options.limit ?? 100 }),
	});
	return parseSeoAdminMigrationStatus(
		await parseApiResponse<unknown>(
			response,
			"Failed to load SEO migration history",
		),
	);
}

export async function rollbackSeoAdminMigration(
	batchId: string,
	confirm: string,
): Promise<SeoAdminMigrationOperationResult> {
	const response = await apiFetch(
		seoAdminApiUrl("core-seo-migration-rollback"),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ batchId, confirm }),
		},
	);
	return parseSeoAdminMigrationOperationResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to roll back the SEO migration",
		),
	);
}

export async function fetchSeoAdminSettings(): Promise<SeoAdminSettings> {
	const response = await apiFetch(seoAdminApiUrl("admin-settings"));
	return parseSeoAdminSettings(
		await parseApiResponse<unknown>(response, "Failed to load SEO settings"),
	);
}

/** `loaded` is the readable snapshot the edited values came from. */
export async function saveSeoAdminSettings(
	values: SeoAdminSettingsValues,
	loaded: Pick<SeoAdminReadableSettings, "revision" | "legacyGuard">,
): Promise<SeoAdminSettingsSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-admin-settings"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...values,
			expectedRevision: loaded.revision,
			...(loaded.revision === null ? { expectedLegacyGuard: loaded.legacyGuard } : {}),
		}),
	});
	return parseSeoAdminSettingsSaveResult(
		await parseApiResponse<unknown>(response, "Failed to save SEO settings"),
	);
}

export async function saveSeoCustomVerificationTags(
	tags: CustomVerificationTag[],
	loaded: Pick<SeoAdminReadableSettings, "revision" | "legacyGuard">,
): Promise<SeoAdminSettingsSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-custom-verification-tags"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			tags,
			expectedRevision: loaded.revision,
			...(loaded.revision === null ? { expectedLegacyGuard: loaded.legacyGuard } : {}),
		}),
	});
	return parseSeoAdminSettingsSaveResult(
		await parseApiResponse<unknown>(response, "Failed to save custom verification tags"),
	);
}

async function postScoreScan(route: "score-scan" | "start-score-scan" | "command-score-scan" | "score-scan-taxonomies" | "score-scan-terms", body: unknown, failure: string, signal?: AbortSignal): Promise<unknown> {
	const response = await apiFetch(seoAdminApiUrl(route), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	return parseApiResponse<unknown>(response, failure);
}

/** The current durable scan; reading it never continues or recovers work. */
export async function fetchSeoScoreScan(options: { signal?: AbortSignal } = {}): Promise<SeoAdminScoreScanStateResult> {
	return parseSeoAdminScoreScanStateResult(await postScoreScan("score-scan", {}, "Failed to load the score scan", options.signal));
}

export async function startSeoScoreScan(request: SeoAdminScoreScanStartRequest): Promise<SeoAdminScoreScanResult> {
	return parseSeoAdminScoreScanResult(
		await postScoreScan("start-score-scan", request, "Failed to start the score scan"),
		{ command: "start", commandId: request.commandId },
	);
}

/** One explicit command; `continue` runs at most one source window or one entry. */
export async function commandSeoScoreScan(request: SeoAdminScoreScanCommandRequest): Promise<SeoAdminScoreScanResult> {
	return parseSeoAdminScoreScanResult(
		await postScoreScan("command-score-scan", request, "Failed to update the score scan"),
		{ command: request.command, commandId: request.commandId },
	);
}

export async function fetchSeoScoreScanTaxonomies(collection: string, options: { signal?: AbortSignal } = {}): Promise<SeoAdminScoreScanTaxonomiesResult> {
	return parseSeoAdminScoreScanTaxonomiesResult(
		await postScoreScan("score-scan-taxonomies", { collection }, "Failed to load taxonomies", options.signal),
		collection,
	);
}

export async function fetchSeoScoreScanTerms(request: SeoAdminScoreScanTermsRequest, options: { signal?: AbortSignal } = {}): Promise<SeoAdminScoreScanTermsResult> {
	return parseSeoAdminScoreScanTermsResult(
		await postScoreScan("score-scan-terms", request, "Failed to load terms", options.signal),
		request,
	);
}

export async function fetchSeoCollectionAnalysisProfile(
	collection: string,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminCollectionAnalysisProfileResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-analysis-profile"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ collection }),
		signal: options.signal,
	});
	return parseSeoCollectionAnalysisProfileResult(
		await parseApiResponse<unknown>(response, "Failed to load the assessment profile"), collection,
	);
}

export async function saveSeoCollectionAnalysisProfile(
	change: SeoAdminCollectionAnalysisProfileChange,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminCollectionAnalysisProfileSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-analysis-profile"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(change),
		signal: options.signal,
	});
	return parseSeoCollectionAnalysisProfileSaveResult(
		await parseApiResponse<unknown>(response, "Failed to save the assessment profile"), change.collection,
	);
}

export async function saveSeoContentScoring(
	change: SeoAdminContentScoringChange,
): Promise<SeoAdminSettingsSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-content-scoring"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(change),
	});
	return parseSeoAdminSettingsSaveResult(
		await parseApiResponse<unknown>(response, "Failed to change content scoring"),
	);
}

export async function resetSeoAdminSettings(expectedRevision: string): Promise<SeoAdminSettingsSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("reset-admin-settings"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ expectedRevision }),
	});
	return parseSeoAdminSettingsSaveResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to restore inherited SEO settings",
		),
	);
}

export async function fetchSeoAdminSitemap(): Promise<SeoAdminSitemapConfiguration> {
	const response = await apiFetch(seoAdminApiUrl("admin-sitemap"));
	return parseSeoAdminSitemap(
		await parseApiResponse<unknown>(
			response,
			"Failed to load sitemap settings",
		),
	);
}

export async function fetchSeoAdminRobotsTxtFacts(): Promise<SeoAdminRobotsTxtFacts> {
	const response = await apiFetch(seoAdminApiUrl("admin-robots-txt"));
	return parseSeoAdminRobotsTxtFacts(
		await parseApiResponse<unknown>(
			response,
			"Failed to load robots.txt ownership",
		),
	);
}

export async function fetchSeoAdminLlmsTxt(): Promise<SeoAdminLlmsTxt> {
	const response = await apiFetch(seoAdminApiUrl("admin-llms-txt"));
	return parseSeoAdminLlmsTxt(await parseApiResponse<unknown>(response, "Failed to load llms.txt"));
}

async function postSeoAdminLlmsTxt(route: Parameters<typeof seoAdminApiUrl>[0], body: string, failure: string): Promise<SeoAdminLlmsTxtWriteResult> {
	const response = await apiFetch(seoAdminApiUrl(route), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});
	return parseSeoAdminLlmsTxtWriteResult(await parseApiResponse<unknown>(response, failure));
}

/** `body` is the exact JSON the editor measured against the request limit. */
export function saveSeoAdminLlmsTxt(body: string): Promise<SeoAdminLlmsTxtWriteResult> {
	return postSeoAdminLlmsTxt("save-admin-llms-txt", body, "Failed to save llms.txt");
}

export function setSeoAdminLlmsTxtEnabled(expectedRevision: string, enabled: boolean): Promise<SeoAdminLlmsTxtWriteResult> {
	return postSeoAdminLlmsTxt("set-admin-llms-txt-enabled", JSON.stringify({ expectedRevision, enabled }), "Failed to change llms.txt output");
}

export function resetSeoAdminLlmsTxt(expectedRevision: string): Promise<SeoAdminLlmsTxtWriteResult> {
	return postSeoAdminLlmsTxt("reset-admin-llms-txt", JSON.stringify({ expectedRevision, confirm: true }), "Failed to reset llms.txt");
}

export async function saveSeoAdminSitemap(
	values: SeoAdminSitemapValues,
	expectedRevision: string | null,
	replaceInvalid = false,
): Promise<SeoAdminSitemapSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-admin-sitemap"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			contentTypes: values.contentTypes,
			excludedPaths: values.excludedPaths,
			expectedRevision,
			...(replaceInvalid ? { replaceInvalid: true } : {}),
		}),
	});
	return parseSeoAdminSitemapSaveResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to save sitemap settings",
		),
	);
}

export async function resetSeoAdminSitemap(expectedRevision: string | null): Promise<SeoAdminSitemapSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("reset-admin-sitemap"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ expectedRevision }),
	});
	return parseSeoAdminSitemapSaveResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to restore default sitemap settings",
		),
	);
}

export async function previewSeoAdminSitemap(input: import("@shipitseo/emdash-plugin-seo/admin-contract").SeoAdminSitemapPreviewRequest, options: { signal?: AbortSignal } = {}): Promise<SeoAdminSitemapPreview> {
	const response = await apiFetch(seoAdminApiUrl("preview-admin-sitemap"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		signal: options.signal,
	});
	return parseSeoAdminSitemapPreview(
		await parseApiResponse<unknown>(
			response,
			"Failed to preview the sitemap file",
		),
	);
}

export async function fetchSeoAdminTemplates(options: { signal?: AbortSignal } = {}): Promise<SeoAdminTemplateConfiguration> {
	const response = await apiFetch(seoAdminApiUrl("admin-templates"), { signal: options.signal });
	return parseSeoAdminTemplateConfiguration(
		await parseApiResponse<unknown>(response, "Failed to load SEO templates"),
	);
}

export interface SeoAdminTemplateCommandRequest {
	collection: string;
	expectedRevision: string | null;
	inheritanceGuard: SeoAdminTemplateInheritanceGuard;
}

export async function saveSeoAdminTemplate(
	request: SeoAdminTemplateCommandRequest & { values: SeoAdminTemplateValues },
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminTemplatesSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-admin-templates"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
		signal: options.signal,
	});
	return parseSeoAdminTemplatesSaveResult(
		await parseApiResponse<unknown>(response, "Failed to save SEO templates"),
		request,
	);
}

export async function resetSeoAdminTemplate(
	request: SeoAdminTemplateCommandRequest,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminTemplatesSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("reset-admin-templates"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
		signal: options.signal,
	});
	return parseSeoAdminTemplatesSaveResult(
		await parseApiResponse<unknown>(response, "Failed to restore the inherited SEO template"),
		request,
	);
}

export async function fetchSeoAdminTemplateExamples(
	request: { collection: string; limit: number; cursor?: string },
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminTemplateExamplesResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-template-examples"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
		signal: options.signal,
	});
	return parseSeoAdminTemplateExamplesResult(
		await parseApiResponse<unknown>(response, "Failed to list published examples"),
		request,
	);
}

export async function fetchSeoAdminTemplateExample(
	request: { collection: string; entryId: string },
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminTemplateExampleResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-template-example"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ collection: request.collection, entryId: request.entryId }),
		signal: options.signal,
	});
	return parseSeoAdminTemplateExampleResult(
		await parseApiResponse<unknown>(response, "Failed to read the requested example"),
		request,
	);
}

export async function previewSeoAdminTemplate(
	request: { collection: string; entryId: string; locale: string; values: SeoAdminTemplateValues },
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminTemplatePreviewResult> {
	const response = await apiFetch(seoAdminApiUrl("preview-admin-template"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
		signal: options.signal,
	});
	return parseSeoAdminTemplatePreviewResult(
		await parseApiResponse<unknown>(response, "Failed to preview the template"),
		request,
	);
}

export type SeoAdminEntryPreviewClientResult =
	| Exclude<SeoAdminEntryPreviewResult, { success: true }>
	| (Extract<SeoAdminEntryPreviewResult, { success: true }> & {
		/** Client-only saved input retained after the preview's version checks. */
		savedSnapshot?: SavedContentSnapshot;
	});

export async function fetchSeoAdminEntryPreview(
	ref: string,
	template?: SeoAdminTemplateValues,
	options: { signal?: AbortSignal; entryOnly?: boolean; savedVersion?: string } = {},
): Promise<SeoAdminEntryPreviewClientResult> {
	const snapshot = options.entryOnly ? await fetchSavedContentSnapshot(ref, options) : null;
	if (options.entryOnly && !snapshot) return { success: false, error: "not_found" };
	if (snapshot && options.savedVersion !== undefined && snapshot.sourceVersion !== options.savedVersion) {
		throw new SavedContentChangedError(snapshot.sourceVersion);
	}
	const response = await apiFetch(seoAdminApiUrl("admin-entry-preview"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ref, ...(template ? { template } : {}), ...(snapshot ? { entryOnly: true, snapshot } : {}) }),
		signal: options.signal,
	});
	const result = parseSeoAdminEntryPreviewResult(
		await parseApiResponse<unknown>(response, "Failed to load entry preview"),
	);
	if (result.success && result.preview.content.ref !== ref) throw new Error("Invalid SEO admin response: preview.requestedRef");
	if (snapshot && result.success) {
		if (!savedSnapshotMatches({ ...result.preview, ref: result.preview.content.ref }, snapshot)) {
			throw new Error("Invalid SEO admin response: preview.savedSnapshot");
		}
		const verified = await verifySavedContentVersions([snapshot], (requestedRef) => fetchSavedContentVersion(requestedRef, options), options.signal);
		if (!verified.items.length) throw new Error("Saved content changed or could not be verified. Reload the entry preview.");
	}
	options.signal?.throwIfAborted();
	return snapshot && result.success ? { ...result, savedSnapshot: snapshot } : result;
}

export async function fetchSeoAdminEntrySocial(
	ref: string,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminSocialOverrideReadResult> {
	return runSocialRequest(async (signal) => {
		const response = await apiFetch(seoAdminApiUrl("admin-entry-social"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ref }),
			signal,
		});
		const result = parseSeoAdminSocialOverrideReadResult(
			await parseApiResponse<unknown>(response, "Could not check saved social values"), ref,
		);
		signal.throwIfAborted();
		return result;
	}, options.signal);
}

export async function saveSeoAdminEntrySocial(
	ref: string,
	values: { title: string; description: string; expectedRevision: string | null },
): Promise<SeoAdminSocialOverrideSaveResult> {
	return runSocialRequest(async (signal) => {
		const response = await apiFetch(seoAdminApiUrl("save-admin-entry-social"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ref, ...values }),
			signal,
		});
		const result = parseSeoAdminSocialOverrideSaveResult(
			await parseApiResponse<unknown>(response, "The social save result could not be confirmed"),
			{ ref, title: values.title, description: values.description },
		);
		signal.throwIfAborted();
		return result;
	});
}

export async function fetchSeoAdminConfiguration(
	limit = 100,
): Promise<SeoAdminConfiguration> {
	const response = await apiFetch(
		`${seoAdminApiUrl("admin-configuration")}?limit=${limit}`,
	);
	return parseSeoAdminConfiguration(
		await parseApiResponse<unknown>(
			response,
			"Failed to load SEO configuration",
		),
	);
}

export async function saveSeoAdminModules(
	values: SeoAdminModuleValues,
	expectedRevision: string | null,
): Promise<SeoAdminModulesSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-admin-modules"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...values, expectedRevision }),
	});
	return parseSeoAdminModulesSaveResult(
		await parseApiResponse<unknown>(response, "Failed to save SEO modules"),
	);
}

export async function resetSeoAdminModules(expectedRevision: string | null): Promise<SeoAdminModulesSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("reset-admin-modules"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ expectedRevision }),
	});
	return parseSeoAdminModulesSaveResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to restore inherited SEO modules",
		),
	);
}

export async function fetchSeoAdminSchemaPresets(options: { signal?: AbortSignal } = {}): Promise<SeoAdminSchemaPresetConfiguration> {
	const response = await apiFetch(seoAdminApiUrl("admin-schema-presets"), { signal: options.signal });
	return parseSeoAdminSchemaPresetConfiguration(await parseApiResponse<unknown>(response, "Failed to load schema presets"));
}

export async function saveSeoAdminSchemaPresets(
	input: SeoAdminSchemaPresetsWriteInput,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminSchemaPresetsSaveResult> {
	const command = structuredClone(input);
	const response = await apiFetch(seoAdminApiUrl("save-admin-schema-presets"), {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: options.signal,
	});
	return parseSeoAdminSchemaPresetsSaveResult(await parseApiResponse<unknown>(response, "Failed to save schema presets"), command);
}

/** Read-only. With `check`, compares the stored mapping with an unconfirmed save or reset. */
export async function fetchSeoAdminSchemaContentTypes(
	input: {
		expectedRevision?: string | null;
		check?: { action: "save"; values: SeoAdminSchemaContentTypeValues; replaceInvalid?: true } | { action: "reset" };
	} = {},
	signal?: AbortSignal,
): Promise<SeoAdminSchemaContentTypesReadResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-schema-content-types"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		...(signal ? { signal } : {}),
	});
	return parseSeoAdminSchemaContentTypesReadResult(
		await parseApiResponse<unknown>(response, "Failed to load content type schema"),
	);
}

export async function saveSeoAdminSchemaContentTypes(
	input: { values: SeoAdminSchemaContentTypeValues; expectedRevision: string | null; replaceInvalid?: boolean },
	signal?: AbortSignal,
): Promise<SeoAdminSchemaContentTypesSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("save-admin-schema-content-types"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		...(signal ? { signal } : {}),
	});
	return parseSeoAdminSchemaContentTypesSaveResult(
		await parseApiResponse<unknown>(response, "Failed to save content type schema"),
	);
}

export async function resetSeoAdminSchemaContentTypes(
	expectedRevision: string,
	signal?: AbortSignal,
): Promise<SeoAdminSchemaContentTypesSaveResult> {
	const response = await apiFetch(seoAdminApiUrl("reset-admin-schema-content-types"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ expectedRevision, confirmed: true }),
		...(signal ? { signal } : {}),
	});
	return parseSeoAdminSchemaContentTypesSaveResult(
		await parseApiResponse<unknown>(response, "Failed to restore default content type schema"),
	);
}

async function postBusinessIdentity(route: Parameters<typeof seoAdminApiUrl>[0], body: unknown, failure: string, signal?: AbortSignal) {
	const response = await apiFetch(seoAdminApiUrl(route), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		...(signal ? { signal } : {}),
	});
	return parseApiResponse<unknown>(response, failure);
}

/** Read-only. With `check`, compares the current record with an unconfirmed write's intended and loaded records. */
export async function fetchSeoAdminBusinessIdentity(
	input: { check?: { intended: BusinessIdentityRecord | null; loaded: BusinessIdentityRecord | null } } = {},
	signal?: AbortSignal,
) {
	return parseSeoAdminBusinessIdentityReadResult(
		await postBusinessIdentity("admin-business-identity", input, "Failed to load the business identity", signal),
	);
}

export async function previewSeoAdminBusinessIdentity(document: Record<string, unknown>, signal?: AbortSignal) {
	return parseSeoAdminBusinessIdentityPreview(
		await postBusinessIdentity("preview-business-identity", { document }, "Failed to preview the business identity", signal),
	);
}

export async function saveSeoAdminBusinessIdentity(
	input: { document: Record<string, unknown>; expectedRevision: string | null; replaceInvalid?: true; publisherChange?: BusinessIdentityPublisherChange },
	signal?: AbortSignal,
) {
	return parseSeoAdminBusinessIdentityWriteResult(
		await postBusinessIdentity("save-business-identity", input, "Failed to save the business identity", signal),
	);
}

export async function setSeoAdminBusinessIdentityActive(
	input: { active: boolean; expectedRevision: string },
	signal?: AbortSignal,
) {
	return parseSeoAdminBusinessIdentityWriteResult(
		await postBusinessIdentity("set-business-identity-active", { ...input, confirmed: true }, "Failed to change the business identity state", signal),
	);
}

export async function transitionSeoAdminBusinessIdentityEntity(
	input: { to: "origin" | "person" | "organization"; expectedRevision: string },
	signal?: AbortSignal,
) {
	return parseSeoAdminBusinessIdentityWriteResult(
		await postBusinessIdentity("transition-business-identity-entity", { ...input, confirmed: true }, "Failed to change the business identity entity", signal),
	);
}

export async function fetchSeoAdminBusinessIdentityPages(
	input: { collection: string; limit: number; cursor?: string },
	signal?: AbortSignal,
) {
	return parseSeoAdminBusinessIdentityPages(
		await postBusinessIdentity("admin-business-identity-pages", input, "Failed to list pages", signal),
	);
}

/** Read-only. With `check`, compares the stored setting with an unconfirmed write. */
export async function fetchSeoAdminPublisherOwnership(
	input: { check?: { mode: "automatic" | "none"; expectedRevision: string | null } } = {},
	signal?: AbortSignal,
) {
	return parseSeoAdminPublisherOwnershipReadResult(
		await postBusinessIdentity("admin-publisher-ownership", input, "Failed to load the publisher output setting", signal),
	);
}

export async function saveSeoAdminPublisherOwnership(
	input: { mode: "automatic" | "none"; expectedRevision: string | null },
	signal?: AbortSignal,
) {
	return parseSeoAdminPublisherOwnershipWriteResult(
		await postBusinessIdentity("save-admin-publisher-ownership", input, "Failed to change the publisher output setting", signal),
	);
}

export async function resetSeoAdminSchemaPresets(
	input: { expectedRevision: string }, options: { signal?: AbortSignal } = {},
): Promise<SeoAdminSchemaPresetsSaveResult> {
	const command = structuredClone(input);
	const response = await apiFetch(seoAdminApiUrl("reset-admin-schema-presets"), {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: options.signal,
	});
	return parseSeoAdminSchemaPresetsSaveResult(await parseApiResponse<unknown>(response, "Failed to restore inherited schema presets"), { ...command, operation: "reset" });
}

export interface SeoEntrySchemaRef {
	collection: string;
	entryId: string;
	locale?: string | null;
}

export interface SeoEntrySchemaSaveInput extends SeoEntrySchemaRef {
	id: string;
	/** Null creates only when the identifier is still absent. */
	expectedRevision: string | null;
	name: string;
	json: string;
	enabled: boolean;
}

async function postEntrySchemaRoute(
	route: "entry-custom-schemas" | "save-entry-custom-schema" | "remove-entry-custom-schema",
	body: unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	const response = await apiFetch(seoAdminApiUrl(route), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	return parseApiResponse<unknown>(response, "The entry schema request failed");
}

export async function fetchSeoEntryCustomSchemas(
	ref: SeoEntrySchemaRef & { inspectId?: string },
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminEntrySchemaListResult> {
	return parseSeoAdminEntrySchemaListResult(await postEntrySchemaRoute("entry-custom-schemas", ref, options.signal));
}

export async function saveSeoEntryCustomSchema(
	input: SeoEntrySchemaSaveInput,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminEntrySchemaSaveResult> {
	return parseSeoAdminEntrySchemaSaveResult(await postEntrySchemaRoute("save-entry-custom-schema", input, options.signal));
}

export async function removeSeoEntryCustomSchema(
	input: SeoEntrySchemaRef & { id: string; expectedRevision: string },
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminEntrySchemaRemoveResult> {
	return parseSeoAdminEntrySchemaRemoveResult(await postEntrySchemaRoute("remove-entry-custom-schema", input, options.signal));
}

export interface SeoEntrySchemaCandidateInput extends SeoEntrySchemaSaveInput {
	/** Correlates the answer with the draft it was asked for. */
	requestId: string;
	snapshot?: SavedContentSnapshot;
}

/** One explicit preview request; nothing calls this on its own. */
export async function previewSeoEntrySchemaCandidate(
	input: SeoEntrySchemaCandidateInput,
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminEntrySchemaCandidatePreviewResult> {
	const response = await apiFetch(seoAdminApiUrl("preview-entry-schema-candidate"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		signal: options.signal,
	});
	return parseSeoAdminEntrySchemaCandidatePreviewResult(
		await parseApiResponse<unknown>(response, "The schema preview request failed"),
		{
			requestId: input.requestId,
			collection: input.collection,
			entryId: input.entryId,
			locale: input.locale ?? null,
			id: input.id,
			expectedRevision: input.expectedRevision,
			name: input.name,
			enabled: input.enabled,
			sourceVersion: input.snapshot?.sourceVersion ?? null,
		},
	);
}

export async function fetchSeoSchemaLibrary(options: { signal?: AbortSignal } = {}): Promise<SeoAdminSchemaLibrary> {
	const response = await apiFetch(seoAdminApiUrl("schema-library"), { signal: options.signal });
	return parseSeoAdminSchemaLibrary(await parseApiResponse<unknown>(response, "Failed to load the schema library"));
}

export async function saveSeoSchemaLibraryTemplate(
	input: { mode: "create" | "update"; expectedRevision: string | null; id: string; name: string; json: string },
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminSchemaLibraryWriteResult> {
	const response = await apiFetch(seoAdminApiUrl("save-schema-library-template"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		signal: options.signal,
	});
	return parseSeoAdminSchemaLibraryWriteResult(await parseApiResponse<unknown>(response, "The template could not be saved"), { operation: "save", ...input });
}

export async function deleteSeoSchemaLibraryTemplate(
	input: { expectedRevision: string; id: string },
	options: { signal?: AbortSignal } = {},
): Promise<SeoAdminSchemaLibraryWriteResult> {
	const response = await apiFetch(seoAdminApiUrl("delete-schema-library-template"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		signal: options.signal,
	});
	return parseSeoAdminSchemaLibraryWriteResult(await parseApiResponse<unknown>(response, "The template could not be deleted"), { operation: "delete", ...input });
}

export async function fetchSeoAdminCustomSchema(
	id: string, options: { signal?: AbortSignal } = {},
): Promise<SeoAdminCustomSchemaReadResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-custom-schema"), {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }), signal: options.signal,
	});
	return parseSeoAdminCustomSchemaReadResult(await parseApiResponse<unknown>(response, "Failed to load this schema"), id);
}

export async function saveSeoAdminCustomSchema(
	input: SeoAdminCustomSchemaWriteInput, options: { signal?: AbortSignal } = {},
): Promise<SeoAdminCustomSchemaSaveResult> {
	const command = structuredClone(input);
	const response = await apiFetch(seoAdminApiUrl("save-admin-custom-schema"), {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: options.signal,
	});
	return parseSeoAdminCustomSchemaSaveResult(await parseApiResponse<unknown>(response, "Failed to save custom schema"), command);
}

export async function composeSeoAdminSchema(
	input: SeoAdminSchemaComposerWriteInput, options: { signal?: AbortSignal } = {},
): Promise<SeoAdminSchemaComposerSaveResult> {
	const command = structuredClone(input);
	const response = await apiFetch(seoAdminApiUrl("compose-admin-schema"), {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: options.signal,
	});
	return parseSeoAdminSchemaComposerSaveResult(await parseApiResponse<unknown>(response, "Failed to compose schema"), command);
}

export async function deleteSeoAdminCustomSchema(
	input: SeoAdminCustomSchemaDeleteInput, options: { signal?: AbortSignal } = {},
): Promise<SeoAdminCustomSchemaDeleteResult> {
	const command = structuredClone(input);
	const response = await apiFetch(seoAdminApiUrl("delete-admin-custom-schema"), {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal: options.signal,
	});
	return parseSeoAdminCustomSchemaDeleteResult(await parseApiResponse<unknown>(response, "Failed to delete custom schema"), command.id);
}

export async function fetchSeoPortabilityExport(): Promise<SeoPortabilityExportResponse> {
	const response = await apiFetch(seoAdminApiUrl("admin-portability-export"));
	return parseSeoPortabilityExportResponse(
		await parseApiResponse<unknown>(
			response,
			"Failed to export SEO configuration",
		),
	);
}

export async function previewSeoPortabilityImport(
	bundle: unknown,
	mode: SeoPortabilityMode,
): Promise<SeoPortabilityPreviewResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-portability-preview"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ bundle, mode }),
	});
	return parseSeoPortabilityPreviewResult(
		await parseApiResponse<unknown>(response, "Failed to preview SEO import"),
	);
}

export async function applySeoPortabilityImport(
	bundle: SeoPortabilityBundle,
	mode: SeoPortabilityMode,
	planFingerprint: string,
	confirmation: string,
): Promise<SeoPortabilityApplyResult> {
	const response = await apiFetch(seoAdminApiUrl("admin-portability-apply"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ bundle, mode, planFingerprint, confirmation }),
	});
	return parseSeoPortabilityApplyResult(
		await parseApiResponse<unknown>(
			response,
			"Failed to import SEO configuration",
		),
	);
}
