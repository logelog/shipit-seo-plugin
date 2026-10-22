import type {
	SeoAdminContentScore,
	SeoAdminEntryOwnership,
	SeoAdminEntryPreview,
	SeoAdminMetadataSource,
	SeoAdminOwnershipEntryReason,
	SeoAdminOwnershipField,
	SeoAdminOwnershipFieldName,
	SeoAdminOwnershipFieldReason,
	SeoAdminSavedAnalysisResult,
	SeoCheckBasis,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	SEO_CHECK_BASES,
	SEO_SCORE_VERSION,
	classifySeoContentCheck,
	seoAnalysisPresentation,
	seoKeywordIdentity,
	seoScoreDisplay,
	seoTextContainsKeyword,
	summarizeSeoChecks,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	SEO_CHECK_ACTION_VERBS,
	SEO_EARLIER_ANALYZER_LABEL,
	SEO_EARLIER_ANALYZER_TEXT,
	cleanStoredSeoCheck,
	isEarlierAnalyzerResult,
	presentSeoChecks,
	seoCheckActionTarget,
	seoCheckTotalsText,
	seoGradeBandLabel,
	type SeoCheckActionTarget,
	type SeoCheckGroupId,
	type SeoCheckGroupPresentation,
	type SeoCheckPillTone,
	type SeoCheckPresentation,
	type SeoCheckPresentationInput,
} from "../check-presentation.ts";

import {
	createSerpPreviewModel,
	type SerpPreviewDevice,
	type SerpPreviewModel,
} from "./serp-preview-model.ts";
import {
	buildSocialPreviewModel,
	type SocialPreviewPlatform,
	type SocialPreviewModel,
} from "./social-preview-model.ts";
import type { PreviewFieldInput } from "./snippet-preview.ts";

export type SeoScoreTone = "good" | "review" | "poor" | "neutral";
export type SeoContentCheck = SeoAdminContentScore["checks"][number];
export type { SeoCheckGroupId };
/** A check's evaluation basis, or `legacy` for a score from an earlier analyzer. */
export type SeoCheckEvidenceBasis = SeoCheckBasis | "legacy";
export type SeoCheckGroupTone = SeoCheckPillTone;

/**
 * A shared group presentation with the count fields the editor checklist
 * reads. `checks` holds the visible rows in row order; not-applicable rows
 * are only in `notApplicable`.
 */
export interface SeoContentCheckGroup extends SeoCheckGroupPresentation {
	checks: SeoContentCheck[];
	issueCount: number;
	/** Checks eligible under the shared analyzer policy. */
	scoredCount: number;
	/** Suggestion rows. */
	reviewCount: number;
	/** Not checked rows. */
	manualCount: number;
	notApplicableCount: number;
	/** The group reads All good: a row applies and nothing is open or not checked. */
	complete: boolean;
	summary: { label: string; tone: SeoCheckGroupTone };
	/** The collapsed not-applicable list as one sentence. */
	note?: string;
}

export const SEO_ADMIN_VIEWS = [
	"overview",
	"content",
	"queue",
	"trends",
	"crawl",
	"monitor404",
	"templates",
	"identity",
	"site",
	"social",
	"modules",
	"schema",
	"library",
	"sitemap",
	"robots",
	"llms",
	"indexnow",
	"indexing",
	"verification",
	"migration",
	"portability",
] as const;

export type SeoAdminView = (typeof SEO_ADMIN_VIEWS)[number];
export type SeoWorkQueueScope = "all" | "images";

export interface SeoWorkQueueItem {
	id: string;
	ref: string;
	entryId: string;
	collection: string;
	title: string;
	score: number;
	grade: SeoAdminContentScore["grade"];
	presentation: ReturnType<typeof analysisPresentation>;
	updatedAt: string;
	check: SeoContentCheck;
}

export interface SeoWorkQueueSummary {
	totalIssues: number;
	affectedContent: number;
	failing: number;
	review: number;
	highPriority: number;
}

export interface SeoAdminLocationState {
	view: SeoAdminView;
	ref: string | null;
	queueScope: SeoWorkQueueScope;
}

export interface SeoEditorDraftSnapshot {
	data?: Readonly<Record<string, unknown>>;
	slug?: string | null;
	seo?: {
		title?: string | null;
		description?: string | null;
		image?: string | null;
		canonical?: string | null;
		noIndex?: boolean;
	} | null;
	isDirty?: boolean;
}

export interface SeoLiveSearchPreview {
	title: string;
	slug: string;
	description: string;
	isDirty: boolean;
}

export interface SeoDraftIndexability {
	entryIndexable: boolean;
	effectiveIndexable: boolean;
	pending: boolean;
}

export interface SeoCanonicalDraftValidation {
	valid: boolean;
	value: string;
	message: string | null;
}

export interface SeoSlugDraftValidation {
	valid: boolean;
	value: string;
	message: string | null;
}

export type SeoSnippetDraft = Pick<
	SeoLiveSearchPreview,
	"title" | "slug" | "description"
>;

/**
 * Whether a panel query may render its children. The first successful read
 * after this mount is required; afterwards a background refetch or a failed
 * refresh keeps the confirmed data mounted, because replacing the panel with a
 * loading state also unmounts its open dialog and unsaved input.
 */
export function readAfterMountConfirmed(
	confirmed: boolean,
	query: { isFetchedAfterMount: boolean; isSuccess: boolean; data: unknown },
): boolean {
	return confirmed || (query.isFetchedAfterMount && query.isSuccess && query.data !== undefined);
}

export interface RetainedEntryPreview<T> {
	readonly identity: string;
	readonly value: T;
}

/**
 * The preview stays shown while a newer saved version of the same entry and
 * locale loads. Its identity never includes the saved version: an autosave
 * that cleared it would unmount the open SEO dialog and its unsaved draft.
 */
/** Elements that take Tab focus, before visibility and `tabIndex` filtering. */
export const DIALOG_TABBABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
	'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * The element Tab moves to when focus would leave either end of a modal dialog, or null when the
 * browser's own order applies. Wrapping here keeps focus off the dialog's empty focus guards.
 */
export function dialogTabWrapTarget<T>(tabbables: readonly T[], active: unknown, backward: boolean): T | null {
	const first = tabbables[0];
	const last = tabbables[tabbables.length - 1];
	if (first === undefined || last === undefined) return null;
	if (backward) return active === first ? last : null;
	return active === last ? first : null;
}

export function retainEntryPreview<T>(
	retained: RetainedEntryPreview<T> | null,
	identity: string,
	current: T | null,
): { retained: RetainedEntryPreview<T> | null; shown: T | null; earlier: boolean } {
	if (current !== null) return { retained: { identity, value: current }, shown: current, earlier: false };
	if (retained?.identity === identity) return { retained, shown: retained.value, earlier: true };
	return { retained: null, shown: null, earlier: false };
}

export function normalizeSeoSnippetDraft(
	draft: SeoSnippetDraft,
): SeoSnippetDraft {
	return {
		title: draft.title.trim(),
		slug: draft.slug.trim(),
		description: draft.description.trim(),
	};
}

export function validateSeoSlugDraft(value: string): SeoSlugDraftValidation {
	const trimmed = value.trim();
	if (!trimmed) {
		return {
			valid: false,
			value: trimmed,
			message: "Enter a slug before applying this snippet.",
		};
	}

	return { valid: true, value: trimmed, message: null };
}

export type SeoSnippetField = keyof SeoSnippetDraft | "image";

export interface SeoSnippetImageChange {
	baseline: string | null;
	next: string | null;
}

export interface SeoSnippetApplyPlan {
	seo: {
		title?: string | null;
		description?: string | null;
		image?: string | null;
	} | null;
	slug: string | null;
	changedFields: SeoSnippetField[];
}

export interface SeoSnippetApplyAdapter {
	applySeo(value: NonNullable<SeoSnippetApplyPlan["seo"]>): void | Promise<void>;
	rollbackSeo(value: NonNullable<SeoSnippetApplyPlan["seo"]>): void | Promise<void>;
	applySlug(value: string): void | Promise<void>;
	rollbackSlug(value: string): void | Promise<void>;
}

export interface SeoSnippetApplyResult {
	success: boolean;
	failedStep: "seo" | "slug" | null;
	rollbackFailed: boolean;
}

export type SeoKeywordCoverageTone = "good" | "review" | "poor";

export interface SeoKeywordCoverage {
	tone: SeoKeywordCoverageTone;
	label: `Preview text coverage: ${number}/3 fields`;
	matches: Array<"title" | "description" | "slug">;
}

export interface SeoSocialOverrideDraft {
	enabled: boolean;
	title?: string | null;
	description?: string | null;
}

export function buildSavedSearchPreviewModel(
	preview: SeoAdminEntryPreview,
	device: SerpPreviewDevice,
	datePrefix?: string,
): SerpPreviewModel {
	// A generated canonical is the resolver's public URL; overrides do not expose it.
	const permalink: PreviewFieldInput = preview.sources.canonical === "generated" && preview.search.url
		? { value: preview.search.url, source: "generated" }
		: { value: null, source: "Permalink not provided by the saved preview", unavailable: true };
	return createSerpPreviewModel({
		device,
		saved: {
			title: { value: preview.search.title, source: preview.sources.title },
			description: { value: preview.search.description, source: preview.sources.description },
			permalink,
			canonical: { value: preview.search.url, source: preview.sources.canonical },
		},
		datePrefix,
	});
}

export function buildSavedSocialPreviewModel(
	preview: SeoAdminEntryPreview,
	platform: SocialPreviewPlatform,
	override?: SeoSocialOverrideDraft,
): SocialPreviewModel {
	const patch = (field: "title" | "description"): PreviewFieldInput | undefined => {
		if (!override) return undefined;
		const baseline = draftText(preview.social.override[field]).replace(/\s+/g, " ");
		const candidate = override.enabled
			? override[field] === undefined ? baseline : draftText(override[field]).replace(/\s+/g, " ")
			: "";
		if (candidate === baseline) return undefined;
		return candidate
			? { value: candidate, source: "plugin-social-override" }
			: {
				value: field === "title" ? preview.social.fallbackTitle : preview.social.fallbackDescription,
				source: "Saved social fallback (source not reported)",
			};
	};
	return buildSocialPreviewModel({
		platform,
		saved: {
			title: { value: preview.social.title, source: preview.sources.socialTitle },
			description: { value: preview.social.description, source: preview.sources.socialDescription },
			image: { value: preview.social.image, source: preview.sources.image },
			url: { value: preview.search.url, source: preview.sources.canonical },
		},
		draft: { title: patch("title"), description: patch("description") },
	});
}

export type SeoLiveSocialPreview = SeoLiveSearchPreview;

const SEVERITY_PRIORITY: Record<SeoContentCheck["severity"], number> = {
	critical: 5,
	high: 4,
	medium: 3,
	low: 2,
	info: 1,
};

const STATUS_PRIORITY: Record<SeoContentCheck["status"], number> = {
	fail: 2,
	review: 1,
	pass: 0,
};

/**
 * A number only beside a band. Qualifiers such as "No focus keyword" or a
 * named limit never hide it; a dash, an unverified or stale result and an
 * earlier analyzer never show one.
 */
export function scorePresentationBadgeText(score: number, presentation: { label?: string; qualifier: string | null; tone: SeoScoreTone } | null | undefined): string {
	if (presentation?.label === SEO_EARLIER_ANALYZER_LABEL) return SEO_EARLIER_ANALYZER_LABEL;
	return presentation && presentation.tone !== "neutral" ? String(score) : "-";
}

export function scoreBadgeVariant(presentation: { tone: SeoScoreTone } | null | undefined): "success" | "warning" | "error" | "secondary" {
	const tone = presentation?.tone;
	return tone === "good" ? "success" : tone === "review" ? "warning" : tone === "poor" ? "error" : "secondary";
}

/** Only verified current evidence can describe the current entry. */
export function analysisPresentation(score: SeoAdminContentScore): ReturnType<typeof seoAnalysisPresentation> {
	if (isLegacyScore(score)) return { label: SEO_EARLIER_ANALYZER_LABEL, qualifier: "Analyze again.", tone: "neutral" };
	if (score.freshness !== "current") return {
		label: score.freshness === "stale" ? "Analysis needs refreshing" : "Saved analysis",
		qualifier: "Current content not checked",
		tone: "neutral",
	};
	return seoAnalysisPresentation(score);
}

export function analysisTone(score: SeoAdminContentScore): SeoScoreTone {
	return analysisPresentation(score).tone;
}

/** Band words for a current grade; an earlier analyzer's grade is never shown as a band. */
export function gradeLabel(grade: SeoAdminContentScore["grade"]): string {
	return seoGradeBandLabel(grade);
}

export function analysisStatusLabel(score: SeoAdminContentScore): string {
	return analysisPresentation(score).label;
}

/** The header counts line: the sums of the group counts. */
export function analysisSummary(score: SeoCheckPresentationInput): string {
	if (isEarlierAnalyzerResult(score)) return SEO_EARLIER_ANALYZER_TEXT;
	return seoCheckTotalsText(presentSeoChecks(score).totals);
}

/**
 * Current scores report each check's own basis; any check of a score from an
 * earlier analyzer is legacy, whatever fields it carries.
 */
export function checkEvidenceBasis(
	score: Pick<SeoAdminContentScore, "scoreVersion">,
	check: SeoContentCheck,
): SeoCheckEvidenceBasis {
	if (score.scoreVersion !== SEO_SCORE_VERSION) return "legacy";
	return (SEO_CHECK_BASES as readonly unknown[]).includes(check.basis) ? check.basis : "legacy";
}

export function groupCheckBasis(group: Pick<SeoContentCheckGroup, "legacy">, check: SeoContentCheck): SeoCheckEvidenceBasis {
	return checkEvidenceBasis({ scoreVersion: group.legacy ? 0 : SEO_SCORE_VERSION }, check);
}

export const SEO_CHECK_BASIS_LABELS: Record<SeoCheckEvidenceBasis, string> = {
	measured: "Measured",
	heuristic: "Heuristic guidance",
	unavailable: "Not checked",
	"not-applicable": "Not applicable",
	legacy: "Earlier result",
};

export function hasCurrentEditorAnalysis(
	score: Pick<SeoAdminContentScore, "freshness" | "scoreVersion">,
): boolean {
	return score.freshness === "current" && score.scoreVersion === SEO_SCORE_VERSION;
}

/**
 * The editor shows confirmed session checks or an explicitly verified stored
 * result. Ordinary stored snapshots stay historical: their input identity has
 * not been checked. `storedOutOfDate` distinguishes a known mismatch from an
 * unconfirmed snapshot.
 */
export function selectEditorScore(input: {
	sessionScore: SeoAdminContentScore | null;
	storedSnapshot: SeoAdminContentScore | null;
	verifiedStoredScore?: SeoAdminContentScore | null;
	storedProfileChanged: boolean;
}): { score: SeoAdminContentScore | null; storedOutOfDate: boolean } {
	const { sessionScore, storedSnapshot } = input;
	if (sessionScore?.freshness === "current") return { score: sessionScore, storedOutOfDate: false };
	const verified = input.verifiedStoredScore;
	if (verified && verified.persistence !== "session" && hasCurrentEditorAnalysis(verified) && !input.storedProfileChanged)
		return { score: verified, storedOutOfDate: false };
	if (!storedSnapshot) return { score: sessionScore, storedOutOfDate: false };
	const storedOutOfDate = storedSnapshot.freshness === "stale" || input.storedProfileChanged;
	return {
		score: { ...storedSnapshot, freshness: storedOutOfDate ? "stale" : undefined },
		storedOutOfDate,
	};
}

export interface SeoSavedAnalysisNotice {
	tone: "success" | "warning" | "error";
	message: string;
}

const SAVED_ANALYSIS_FAILURE_MESSAGES: Record<Extract<SeoAdminSavedAnalysisResult, { success: false }>["error"], string> = {
	invalid_ref: "This saved entry could not be found in this language, so no analysis result was stored.",
	unsupported_collection: "This content type is not analyzed by this plugin.",
	content_unavailable: "Saved content could not be read, so no analysis result was stored.",
	content_not_found: "This saved entry could not be found in this language, so no analysis result was stored.",
	locale_mismatch: "This saved entry could not be found in this language, so no analysis result was stored.",
	scoring_disabled: "Content scoring is off, so no analysis result was stored.",
	activation_required: "Review and enable saved-content analysis in Feature controls before analyzing. No result was stored.",
	profile_required: "Choose and save an assessment profile for this content type before analyzing. No result was stored.",
	profile_unavailable: "The assessment profile could not be read, so no analysis result was stored.",
	scoring_unavailable: "Scoring settings or storage could not be read, so no analysis result was stored.",
	superseded: "The saved content or SEO settings changed during analysis, so no analysis result was stored. Analyze again.",
	uncertain: "The result could not be confirmed as stored. Reload this entry before analyzing again.",
	analysis_failed: "The saved content could not be analyzed, so no analysis result was stored.",
};

/**
 * What a durable analysis of the saved entry did: stored, reused or refused,
 * with history apart. A result for another saved version than the one this
 * editor requested is never presented as this version's result.
 */
export function savedAnalysisNotice(result: SeoAdminSavedAnalysisResult, requestedSavedVersion?: string): SeoSavedAnalysisNotice {
	if (!result.success) return { tone: "error", message: SAVED_ANALYSIS_FAILURE_MESSAGES[result.error] };
	const history = result.history === "failed"
		? " Its score history entry could not be recorded."
		: result.history === "uncertain" ? " Its score history entry could not be confirmed." : "";
	if (requestedSavedVersion !== undefined && result.item.sourceVersion !== requestedSavedVersion) {
		return {
			tone: "warning",
			message: `This entry was saved again elsewhere, and that newer saved version was analyzed.${history} Reload to see it.`,
		};
	}
	if (result.outcome === "reused")
		return { tone: "success", message: "The saved content and settings are unchanged, so the stored analysis was reused." };
	const historyNote = result.history === "not-attempted" ? " Score history was not updated." : history;
	return { tone: history ? "warning" : "success", message: `Analysis of the saved content was stored.${historyNote}` };
}

/** A request that returned no result. It is not retried automatically; the outcome is unknown. */
export function savedAnalysisRequestFailureNotice(permissionDenied: boolean): SeoSavedAnalysisNotice {
	return {
		tone: "error",
		message: permissionDenied
			? "Analyzing saved content needs administrator access."
			: "The request did not complete, so it is unknown whether a result was stored. Reload this entry before analyzing again.",
	};
}

/** Readiness for one deliberate analysis of the exact saved entry. */
export function editorManualAnalysisState(state: {
	settingsReady: boolean;
	assessmentReady: boolean;
	assessmentConfigured: boolean;
	assessmentDirty: boolean;
	profileReady: boolean;
	keywordDirty: boolean;
	keywordSaving: boolean;
	keywordUnconfirmed?: boolean;
	savedTargetReady: boolean;
}): { admitted: boolean; detail: string | null } {
	if (!state.savedTargetReady) return { admitted: false, detail: "Save this entry in the current language before analyzing." };
	if (!state.settingsReady) return { admitted: false, detail: "Load the saved SEO settings before analyzing." };
	if (!state.assessmentReady) return { admitted: false, detail: "Load the assessment profile before analyzing." };
	if (!state.assessmentConfigured) return { admitted: false, detail: "Choose and save an assessment profile before analyzing." };
	if (state.assessmentDirty) return { admitted: false, detail: "Save or reset the assessment profile changes before analyzing." };
	if (!state.profileReady) return { admitted: false, detail: "Load the saved focus keywords before analyzing." };
	if (state.keywordSaving) return { admitted: false, detail: "Wait for focus keyword changes to save, or retry their save." };
	if (state.keywordUnconfirmed) return { admitted: false, detail: "Reload saved focus keywords before analyzing." };
	if (state.keywordDirty) return { admitted: false, detail: "Wait for focus keyword changes to save, or retry their save." };
	return { admitted: true, detail: null };
}

/** Heading and detail of the editor panel while no score is shown. */
export function editorScoreStateCopy(state: {
	scoringEnabled: boolean;
	scoringUnknown: boolean;
	storedUnavailable: boolean;
	settingsUnavailable?: boolean;
	profileRequired?: boolean;
	profileUnavailable?: boolean;
	profileLoading?: boolean;
}): { heading: string; detail: string } {
	if (state.settingsUnavailable ?? state.scoringUnknown) return { heading: "SEO settings unavailable", detail: "The saved SEO settings could not be read. Retry before analyzing." };
	if (state.profileUnavailable) return { heading: "Assessment profile unavailable", detail: "The profile could not be read. Previous results remain available; retry before analyzing." };
	if (state.profileLoading) return { heading: "Loading assessment profile", detail: "The saved assessment profile must be loaded before analyzing." };
	if (state.profileRequired) return { heading: "Choose an assessment profile", detail: "Select and save Article or General content for this content type. Schema settings do not choose its checks." };
	if (state.storedUnavailable) return { heading: "Saved score unavailable", detail: "The saved SEO score could not be read, so whether this entry has a saved analysis is unknown." };
	return { heading: "Not analyzed", detail: state.scoringEnabled
		? "Analyze this entry to store a result. Saved changes can also update analysis."
		: "Analyze this entry to store a result. Automatic analysis stays paused." };
}

/** A stored score shown without analysis, with the keywords recorded alongside it. */
export function storedScoreSummary(score: SeoAdminContentScore): { label: string; keywords: string } {
	const keywords = score.keywords ?? [];
	const display = seoScoreDisplay(score);
	return {
		label: isLegacyScore(score) ? `Last saved SEO result: ${SEO_EARLIER_ANALYZER_TEXT}`
			: display.score !== null ? `Last saved SEO score: ${display.score}/100, ${display.label}.`
				: `Last saved SEO result: ${display.label}.`,
		keywords: `${keywords.length ? `Keywords saved with this score: ${keywords.join(", ")}.` : "No keywords were saved with this score."}${score.pillar ? " Saved as pillar content." : ""}`,
	};
}

export function isLegacyScore(score: Pick<SeoAdminContentScore, "scoreVersion">): boolean {
	return score.scoreVersion !== SEO_SCORE_VERSION;
}

/** The excluded-from-search condition of a current score, shown apart from the score. */
export function searchExclusionCheck(score: SeoAdminContentScore): SeoContentCheck | null {
	if (isLegacyScore(score)) return null;
	const check = score.checks.find((item) => item.condition === "excluded-from-search");
	return check ? cleanStoredSeoCheck(check) : null;
}

export function manualCheckCount(score: SeoAdminContentScore): number {
	return isLegacyScore(score) ? 0 : summarizeSeoChecks(score.checks).unavailable;
}

export function entryRef(collection: string, entryId: string): string {
	return `${collection}:${entryId}`;
}

function draftText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve the visible search snippet from host-owned editor state without
 * treating unsaved values as persisted analyzer input.
 */
export function resolveSeoLiveSearchPreview(
	preview: SeoAdminEntryPreview,
	draft?: SeoEditorDraftSnapshot,
): SeoLiveSearchPreview {
	if (!draft) {
		return {
			title: preview.search.title,
			slug: preview.content.slug,
			description: preview.search.description,
			isDirty: false,
		};
	}

	return {
		title:
			draftText(draft.seo?.title) ||
			draftText(draft.data?.title) ||
			preview.search.fallbackTitle ||
			preview.content.title ||
			preview.search.title,
		slug: draftText(draft.slug) || preview.content.slug,
		description:
			draftText(draft.seo?.description) ||
			draftText(draft.data?.excerpt) ||
			preview.search.fallbackDescription ||
			preview.search.description,
		isDirty: Boolean(draft.isDirty),
	};
}

export interface SeoResolvedPreviewUrl {
	url: string;
	hostname: string;
	/** True when the resolved origin is a local development loopback. */
	development: boolean;
	source: "configured" | "entry";
}

function validPublicSiteUrl(value: string): URL | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

export function isDevelopmentHostname(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase("en");
	if (!host) return false;
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	// IPv6 loopback, with and without URL brackets or zero-compression.
	if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
	// Whole 127.0.0.0/8 IPv4 loopback block.
	return /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Search-preview URL resolution order:
 * 1. the configured public site URL, when it parses as http(s) — used even
 *    while the admin itself runs on localhost;
 * 2. the entry URL from the engine's site context (which is the local
 *    development origin only when no public context exists).
 * A relative entry path with no configured base stays relative rather than
 * inventing an origin.
 */
export function resolveSeoPreviewUrl(
	entryUrl: string,
	configuredSiteUrl: string | null | undefined,
): SeoResolvedPreviewUrl {
	const configured = validPublicSiteUrl(configuredSiteUrl?.trim() ?? "");
	if (configured) {
		try {
			const entry = new URL(entryUrl || "/", configured);
			const url = new URL(
				`${entry.pathname}${entry.search}${entry.hash}`,
				configured,
			);
			return {
				url: url.toString(),
				hostname: url.hostname,
				development: isDevelopmentHostname(url.hostname),
				source: "configured",
			};
		} catch {
			// Fall through to the entry URL.
		}
	}
	try {
		const url = new URL(entryUrl);
		return {
			url: url.toString(),
			hostname: url.hostname,
			development: isDevelopmentHostname(url.hostname),
			source: "entry",
		};
	} catch {
		return {
			url: entryUrl,
			hostname: "",
			development: false,
			source: "entry",
		};
	}
}

/** A changed noindex draft is unresolved until the host saves and re-analyzes the entry. */
export function resolveSeoDraftIndexability(
	preview: SeoAdminEntryPreview,
	draft?: SeoEditorDraftSnapshot,
): SeoDraftIndexability {
	const savedNoIndex = preview.entryNoindex;
	const draftNoIndex = draft?.seo?.noIndex;
	if (draftNoIndex === undefined || draftNoIndex === savedNoIndex) {
		return {
			entryIndexable: !savedNoIndex,
			effectiveIndexable: preview.indexable,
			pending: false,
		};
	}

	return {
		entryIndexable: !draftNoIndex,
		effectiveIndexable: false,
		pending: true,
	};
}

export function localeGraphDiagnosticLabel(graph: SeoAdminEntryPreview["localeGraph"]): string {
	if (
		graph.status === "incomplete" &&
		graph.issues.length > 0 &&
		graph.issues.every((issue) => issue.code === "translation-context-unavailable" && issue.severity === "info")
	) return "Not checked in this preview";
	const labels: Record<SeoAdminEntryPreview["localeGraph"]["status"], string> = {
		"single-locale": "Single-language entry",
		complete: "Translation set complete",
		incomplete: "Translation set needs review",
		"not-indexable": "Excluded from hreflang",
		"host-upgrade-required": "Host update required",
	};
	return labels[graph.status];
}

export function validateSeoCanonicalDraft(
	value: string,
): SeoCanonicalDraftValidation {
	const trimmed = value.trim();
	if (!trimmed) return { valid: true, value: "", message: null };

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return {
			valid: false,
			value: trimmed,
			message: "Enter a complete absolute URL, including https://.",
		};
	}

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		return {
			valid: false,
			value: trimmed,
			message: "Canonical URLs must use http:// or https://.",
		};
	}
	if (parsed.username || parsed.password) {
		return {
			valid: false,
			value: trimmed,
			message: "Canonical URLs cannot contain credentials.",
		};
	}
	if (parsed.search || parsed.hash) {
		return {
			valid: false,
			value: trimmed,
			message: "Remove query parameters and fragments from the canonical URL.",
		};
	}

	return { valid: true, value: trimmed, message: null };
}

/**
 * Build one atomic host update plan for the snippet editor. SEO title and
 * description are intentionally grouped so typing in the dialog never writes
 * into the host form and applying does not create one update per field.
 */
export function buildSeoSnippetApplyPlan(
	baseline: SeoSnippetDraft,
	draft: SeoSnippetDraft,
	image?: SeoSnippetImageChange,
): SeoSnippetApplyPlan {
	const normalizedBaseline = normalizeSeoSnippetDraft(baseline);
	const normalizedDraft = normalizeSeoSnippetDraft(draft);
	const titleChanged = normalizedDraft.title !== normalizedBaseline.title;
	const descriptionChanged =
		normalizedDraft.description !== normalizedBaseline.description;
	const slugChanged = normalizedDraft.slug !== normalizedBaseline.slug;
	const nextImage = draftText(image?.next) || null;
	const imageChanged = image !== undefined && nextImage !== (draftText(image.baseline) || null);
	const changedFields: SeoSnippetField[] = [];

	if (titleChanged) changedFields.push("title");
	if (slugChanged) changedFields.push("slug");
	if (descriptionChanged) changedFields.push("description");
	if (imageChanged) changedFields.push("image");

	return {
		seo:
			titleChanged || descriptionChanged || imageChanged
				? {
						...(titleChanged
							? { title: normalizedDraft.title || null }
							: {}),
						...(descriptionChanged
							? { description: normalizedDraft.description || null }
							: {}),
						...(imageChanged ? { image: nextImage } : {}),
					}
				: null,
		slug: slugChanged ? normalizedDraft.slug : null,
		changedFields,
	};
}

export function changedHostSnippetFields(
	baseline: SeoSnippetDraft,
	current: SeoSnippetDraft,
	fields: readonly SeoSnippetField[],
): Array<keyof SeoSnippetDraft> {
	const initial = normalizeSeoSnippetDraft(baseline);
	const latest = normalizeSeoSnippetDraft(current);
	return fields.filter((field): field is keyof SeoSnippetDraft =>
		field !== "image" && initial[field] !== latest[field]);
}

export type SeoSocialImagePreviewState = "saved" | "draft" | "selected" | "removed";

export interface SeoSocialImagePreview {
	url: string | null;
	state: SeoSocialImagePreviewState;
	/** Whether an explicit entry image exists that Remove would clear. */
	removable: boolean;
}

/**
 * Resolve the share image shown while editing. A host draft without an image
 * only means "removed" when the saved image came from the entry's own SEO
 * field; otherwise the saved image is a featured-image or site fallback.
 */
export function resolveSeoSocialImagePreview(input: {
	savedImage: string | null;
	savedSource: string;
	hostImage: string | null | undefined;
	pendingImage: string | null | undefined;
}): SeoSocialImagePreview {
	if (input.pendingImage !== undefined) {
		const pending = draftText(input.pendingImage);
		return pending
			? { url: pending, state: "selected", removable: true }
			: { url: null, state: "removed", removable: false };
	}
	if (input.hostImage === undefined) {
		return { url: input.savedImage, state: "saved", removable: input.savedSource === "core-seo" };
	}
	const host = draftText(input.hostImage);
	if (host) return { url: host, state: "draft", removable: true };
	return input.savedSource === "core-seo"
		? { url: null, state: "removed", removable: false }
		: { url: input.savedImage, state: "saved", removable: false };
}

export function seoSocialImageChange(
	hostImage: string | null | undefined,
	pendingImage: string | null | undefined,
): { changed: boolean; next: string | null } {
	if (pendingImage === undefined) return { changed: false, next: null };
	const next = draftText(pendingImage) || null;
	return { changed: next !== (draftText(hostImage) || null), next };
}

export function seoSnippetDialogPrimaryAction(changes: {
	general: boolean;
	social: boolean;
	image: boolean;
}): "apply" | "close" {
	return changes.general || changes.social || changes.image ? "apply" : "close";
}

/**
 * Apply the host-owned SEO and slug updates as one coordinated operation.
 * EmDash currently exposes separate editor actions, so a later failure is
 * compensated in reverse order instead of leaving a silent partial update.
 */
export async function executeSeoSnippetApplyPlan(
	plan: SeoSnippetApplyPlan,
	rollback: SeoSnippetApplyPlan,
	adapter: SeoSnippetApplyAdapter,
): Promise<SeoSnippetApplyResult> {
	let seoAttempted = false;
	let slugAttempted = false;
	let failedStep: SeoSnippetApplyResult["failedStep"] = null;

	try {
		if (plan.seo) {
			seoAttempted = true;
			failedStep = "seo";
			await adapter.applySeo(plan.seo);
		}
		if (plan.slug !== null) {
			slugAttempted = true;
			failedStep = "slug";
			await adapter.applySlug(plan.slug);
		}
		return { success: true, failedStep: null, rollbackFailed: false };
	} catch {
		let rollbackFailed = false;
		if (slugAttempted && rollback.slug !== null) {
			try {
				await adapter.rollbackSlug(rollback.slug);
			} catch {
				rollbackFailed = true;
			}
		}
		if (seoAttempted && rollback.seo) {
			try {
				await adapter.rollbackSeo(rollback.seo);
			} catch {
				rollbackFailed = true;
			}
		}
		return { success: false, failedStep, rollbackFailed };
	}
}

/**
 * Report literal preview-text coverage only. This deliberately avoids implying
 * search demand, competition, or ranking suitability without external data.
 */
export function seoKeywordCoverage(
	keyword: string,
	preview: Pick<SeoLiveSearchPreview, "title" | "description" | "slug">,
): SeoKeywordCoverage {
	const matches = keyword.trim()
		? (["title", "description", "slug"] as const).filter((field) =>
				seoTextContainsKeyword(preview[field], keyword),
			)
		: [];
	return {
		tone: matches.length === 3 ? "good" : matches.length > 0 ? "review" : "poor",
		label: `Preview text coverage: ${matches.length}/3 fields`,
		matches,
	};
}

/**
 * Resolve a share card from the live search snippet while keeping social-only
 * overrides opt-in and independent from the host SEO fields.
 */
export function resolveSeoLiveSocialPreview(
	preview: SeoAdminEntryPreview,
	liveSearchPreview?: SeoLiveSearchPreview,
	override?: SeoSocialOverrideDraft,
): SeoLiveSocialPreview {
	const liveFallbackActive = Boolean(
		liveSearchPreview &&
			(liveSearchPreview.isDirty ||
				liveSearchPreview.title !== preview.search.title ||
				liveSearchPreview.description !== preview.search.description ||
				liveSearchPreview.slug !== preview.content.slug),
	);
	const fallbackTitle = liveFallbackActive
		? draftText(liveSearchPreview?.title) || preview.social.fallbackTitle
		: preview.social.fallbackTitle;
	const fallbackDescription = liveFallbackActive
		? draftText(liveSearchPreview?.description) ||
			preview.social.fallbackDescription
		: preview.social.fallbackDescription;
	const overrideTitle = override?.enabled ? draftText(override.title) : "";
	const overrideDescription = override?.enabled
		? draftText(override.description)
		: "";

	return {
		title: overrideTitle || fallbackTitle,
		slug: liveFallbackActive
			? draftText(liveSearchPreview?.slug) || preview.content.slug
			: preview.content.slug,
		description: overrideDescription || fallbackDescription,
		isDirty: liveFallbackActive,
	};
}

export interface CancellableDebounce<T> {
	schedule(value: T): void;
	flush(): void;
	cancel(): void;
	pending(): boolean;
}

/**
 * Debounce with explicit cancellation for autosave flows: a newer schedule
 * always supersedes the pending one, so a stale payload can never fire after
 * fresher input arrived. Injectable timers keep it testable without fake
 * global clocks.
 */
export function createCancellableDebounce<T>(
	run: (value: T) => void,
	delayMs: number,
	timers: {
		set: (fn: () => void, ms: number) => unknown;
		clear: (handle: unknown) => void;
	} = {
		set: (fn, ms) => setTimeout(fn, ms),
		clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	},
): CancellableDebounce<T> {
	let handle: unknown = null;
	let latest: T | undefined;
	const cancel = () => {
		if (handle !== null) timers.clear(handle);
		handle = null;
		latest = undefined;
	};
	return {
		schedule(value: T) {
			if (handle !== null) timers.clear(handle);
			latest = value;
			handle = timers.set(() => {
				const payload = latest as T;
				handle = null;
				latest = undefined;
				run(payload);
			}, delayMs);
		},
		flush() {
			if (handle === null) return;
			const payload = latest as T;
			cancel();
			run(payload);
		},
		cancel,
		pending() {
			return handle !== null;
		},
	};
}

/**
 * Value equality for live search previews. State setters use this so an
 * equal-valued snapshot never replaces the current object — object-identity
 * churn between the host draft echo and the snippet dialog is what previously
 * risked a setState ping-pong loop.
 */
export function searchPreviewValuesMatch(
	left: SeoLiveSearchPreview | null,
	right: SeoLiveSearchPreview | null,
): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return (
		left.title === right.title &&
		left.slug === right.slug &&
		left.description === right.description &&
		left.isDirty === right.isDirty
	);
}

export type SeoCheckFixTarget =
	| { kind: "dialog"; view: "general" | "social"; field?: "title" | "slug" | "description" }
	| { kind: "keyword" }
	| { kind: "advanced" };

const FIX_TARGETS: Readonly<Record<SeoCheckActionTarget, SeoCheckFixTarget>> = {
	keyword: { kind: "keyword" },
	title: { kind: "dialog", view: "general", field: "title" },
	description: { kind: "dialog", view: "general", field: "description" },
	slug: { kind: "dialog", view: "general", field: "slug" },
	image: { kind: "dialog", view: "social" },
	advanced: { kind: "advanced" },
};

export function checkFixTargetFor(target: SeoCheckActionTarget): SeoCheckFixTarget {
	return { ...FIX_TARGETS[target] };
}

/** The action label for a target, such as "Add keyword"; its accessible name is `"{verb}: {row label}"`. */
export function checkActionVerb(target: SeoCheckActionTarget): string {
	return SEO_CHECK_ACTION_VERBS[target];
}

export function resolveCheckFixTarget(
	check: SeoContentCheck,
): SeoCheckFixTarget | null {
	if (check.status === "pass" || check.basis === "unavailable" || check.basis === "not-applicable") return null;
	// Current checks name their real metadata source, so the field follows the check.
	if (check.basis !== undefined) {
		// The excluded-from-search condition is shown as a banner whose review lives in Advanced.
		if (check.id === "indexability") return { kind: "advanced" };
		const target = seoCheckActionTarget(check);
		return target ? checkFixTargetFor(target) : null;
	}
	if (check.category === "keyword") return null;
	const source = check.evidence.source.toLowerCase();
	if (source.includes("seo.title")) {
		return { kind: "dialog", view: "general", field: "title" };
	}
	if (source.includes("seo.description")) {
		return { kind: "dialog", view: "general", field: "description" };
	}
	if (source.includes("seo.image")) return { kind: "dialog", view: "social" };
	if (
		source.includes("seo.noindex") ||
		source.includes("robots") ||
		source.includes("seo.canonical") ||
		source.includes("public route")
	) {
		return { kind: "advanced" };
	}
	return null;
}

export function parseEntryRef(
	ref: string,
): { collection: string; entryId: string } | null {
	const separator = ref.indexOf(":");
	if (separator <= 0 || separator === ref.length - 1) return null;
	return {
		collection: ref.slice(0, separator),
		entryId: ref.slice(separator + 1),
	};
}

export function parseSeoAdminLocation(search: string): SeoAdminLocationState {
	const params = new URLSearchParams(search);
	const requestedView = params.get("view");
	const view = SEO_ADMIN_VIEWS.includes(requestedView as SeoAdminView)
		? (requestedView as SeoAdminView)
		: "overview";
	const requestedRef = params.get("ref")?.trim() || null;
	return {
		view,
		ref:
			view === "content" && requestedRef && parseEntryRef(requestedRef)
				? requestedRef
				: null,
		queueScope:
			view === "queue" && params.get("scope") === "images" ? "images" : "all",
	};
}

export function buildSeoAdminSearch(
	currentSearch: string,
	view: SeoAdminView,
	ref?: string | null,
	queueScope: SeoWorkQueueScope = "all",
): string {
	const params = new URLSearchParams(currentSearch);
	params.set("view", view);
	if (view === "content" && ref && parseEntryRef(ref)) params.set("ref", ref);
	else params.delete("ref");
	if (view === "queue" && queueScope === "images") params.set("scope", "images");
	else params.delete("scope");
	const serialized = params.toString();
	return serialized ? `?${serialized}` : "";
}

export function indexContentScores(
	items: readonly SeoAdminContentScore[],
): ReadonlyMap<string, SeoAdminContentScore> {
	const index = new Map<string, SeoAdminContentScore>();
	for (const item of items) {
		index.set(item.ref, item);
		index.set(entryRef(item.collection, item.entryId), item);
		if (item.slug) index.set(`${item.collection}:${item.slug}`, item);
	}
	return index;
}

export function selectPriorityChecks(
	score: SeoAdminContentScore,
	limit = 3,
): SeoContentCheck[] {
	const boundedLimit = Math.max(0, Math.trunc(limit));
	if (isLegacyScore(score)) return [];
	return score.checks
		.filter(isActionableCheck)
		.slice()
		.sort(
			(left, right) =>
				STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status] ||
				SEVERITY_PRIORITY[right.severity] - SEVERITY_PRIORITY[left.severity] ||
				right.weight - left.weight ||
				left.id.localeCompare(right.id),
		)
		.slice(0, boundedLimit);
}

export function priorityCheckCount(score: SeoAdminContentScore): number {
	return isLegacyScore(score) ? 0 : summarizeSeoChecks(score.checks).issues;
}

export function passingCheckCount(score: SeoAdminContentScore): number {
	if (isLegacyScore(score)) return 0;
	return score.checks.filter(
		(check) => check.status === "pass" && classifySeoContentCheck(check).eligible,
	).length;
}

export function scoredCheckCount(score: SeoAdminContentScore): number {
	return isLegacyScore(score) ? 0 : summarizeSeoChecks(score.checks).evaluated;
}

/** The summary and every group use the engine's eligible population. */
export function evaluatedCheckCount(score: SeoAdminContentScore): number {
	return scoredCheckCount(score);
}

/** The checks a summary denominator counts; unavailable and not-applicable never do. */
export function isEvaluatedCheck(check: SeoContentCheck): boolean {
	return classifySeoContentCheck(check).eligible;
}

/**
 * A measured or heuristic finding that stays open but carries no weight, such
 * as an empty alt value to confirm. It never changes the score or the issue
 * count, yet a group holding one is not complete.
 */
export function isOpenReviewNote(check: SeoContentCheck): boolean {
	return classifySeoContentCheck(check).role === "advisory" && check.status === "review";
}

export function isActionableCheck(check: SeoContentCheck): boolean {
	return classifySeoContentCheck(check).issue;
}

function compatibleGroup(group: SeoCheckGroupPresentation): SeoContentCheckGroup {
	const checks = group.rows.map((row) => row.check);
	const scoredCount = group.legacy ? 0 : checks.filter((check) => classifySeoContentCheck(check).eligible).length;
	const note = group.notApplicable.length
		? `${group.notApplicableLabel}: ${group.notApplicable.map((item) => item.text).join(" ")}`
		: undefined;
	return {
		...group,
		checks,
		issueCount: group.counts.issues,
		scoredCount,
		reviewCount: group.counts.suggestions,
		manualCount: group.counts.notChecked,
		notApplicableCount: group.counts.notApplicable,
		complete: !group.legacy && group.rows.length > 0 && group.counts.issues === 0 && group.counts.suggestions === 0 && group.counts.notChecked === 0,
		summary: { label: group.pill.text, tone: group.pill.tone },
		...(note ? { note } : {}),
	};
}

export interface SeoContentCheckPresentation extends Omit<SeoCheckPresentation, "groups"> {
	groups: SeoContentCheckGroup[];
}

/** Groups and header totals from the shared presentation; the header shows `totals`, never its own count. */
export function contentCheckPresentation(score: SeoCheckPresentationInput): SeoContentCheckPresentation {
	const presentation = presentSeoChecks(score);
	return { ...presentation, groups: presentation.groups.map(compatibleGroup) };
}

export function groupContentChecks(score: SeoCheckPresentationInput): SeoContentCheckGroup[] {
	return contentCheckPresentation(score).groups;
}

export type SeoKeywordCheckField = "title" | "description" | "body";

export interface SeoKeywordCheckCoverage {
	tone: SeoKeywordCoverageTone;
	/** Primary: `found/checked`; secondary: null. */
	count: string | null;
	label: string;
	/** Primary only: the fields whose keyword check passed or failed. */
	found: SeoKeywordCheckField[];
	missing: SeoKeywordCheckField[];
}

const PRIMARY_KEYWORD_CHECKS: ReadonlyArray<{ id: string; field: SeoKeywordCheckField }> = [
	{ id: "keyword-title", field: "title" },
	{ id: "keyword-description", field: "description" },
	{ id: "keyword-content", field: "body" },
];
const KEYWORD_FIELD_WORDS: Readonly<Record<SeoKeywordCheckField, string>> = { title: "title", description: "description", body: "body text" };

function fieldList(fields: readonly SeoKeywordCheckField[], conjunction: "and" | "or"): string {
	const words = fields.map((field) => KEYWORD_FIELD_WORDS[field]);
	return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} ${conjunction} ${words.at(-1)}`;
}

/**
 * A keyword chip's coverage, read from the same analysis rows the checklist
 * shows. The primary keyword follows Focus keyword in title, description and
 * body text; a secondary keyword follows Secondary keywords. Null when the
 * analysis did not check this keyword in that role.
 */
export function keywordCheckCoverage(
	keyword: string,
	role: "primary" | "secondary",
	analysis: {
		keyword?: string;
		/** The analyzed keyword list, primary first, when the result records it. */
		keywords?: readonly string[];
		checks: readonly SeoContentCheck[];
		scoreVersion?: number;
	} | null | undefined,
): SeoKeywordCheckCoverage | null {
	const identity = seoKeywordIdentity(keyword);
	if (!analysis || !identity || isEarlierAnalyzerResult(analysis)) return null;
	const evaluated = (check: SeoContentCheck | undefined): check is SeoContentCheck =>
		check !== undefined && (check.basis === "measured" || check.basis === "heuristic");
	if (role === "primary") {
		if (!analysis.keyword || seoKeywordIdentity(analysis.keyword) !== identity) return null;
		const rows = PRIMARY_KEYWORD_CHECKS.flatMap(({ id, field }) => {
			const check = analysis.checks.find((item) => item.id === id);
			return evaluated(check) ? [{ field, found: check.status === "pass" }] : [];
		});
		if (rows.length === 0) return null;
		const found = rows.filter((row) => row.found).map((row) => row.field);
		const missing = rows.filter((row) => !row.found).map((row) => row.field);
		return {
			tone: missing.length === 0 ? "good" : found.length > 0 ? "review" : "poor",
			count: `${found.length}/${rows.length}`,
			label: missing.length === 0 ? `In the ${fieldList(found, "and")}`
				: found.length === 0 ? `Not in the ${fieldList(missing, "or")}`
					: `In the ${fieldList(found, "and")}; not in the ${fieldList(missing, "or")}`,
			found,
			missing,
		};
	}
	if (analysis.keywords && !analysis.keywords.slice(1).some((item) => seoKeywordIdentity(item) === identity)) return null;
	const secondary = analysis.checks.find((item) => item.id === "secondary-keyword-coverage");
	if (!evaluated(secondary)) return null;
	// The engine lists missing phrases verbatim after the first `missing: ` as `"a", "b".`; a passing row has none.
	// A phrase may itself contain quotes or `missing: `, so a known analyzed spelling is matched as one whole entry.
	const marker = secondary.detail.indexOf("missing: ");
	const missingList = secondary.status === "pass" || marker < 0 ? "" : secondary.detail.slice(marker + "missing: ".length);
	if (secondary.status !== "pass" && !missingList) return null;
	const analyzed = analysis.keywords?.slice(1).find((item) => seoKeywordIdentity(item) === identity)?.trim();
	const absent = missingList !== "" && (analyzed !== undefined
		? [`, "${analyzed}", `, `, "${analyzed}".`].some((entry) => `, ${missingList}`.includes(entry))
		: [...missingList.matchAll(/"([^"]*)"/g)].some((match) => seoKeywordIdentity(match[1]) === identity));
	return absent
		? { tone: "poor", count: null, label: "Not in the title, description or body text", found: [], missing: [] }
		: { tone: "good", count: null, label: "In the title, description or body text", found: [], missing: [] };
}

export function buildSeoWorkQueue(
	scores: readonly SeoAdminContentScore[],
	scope: SeoWorkQueueScope = "all",
	imageAvailability: SeoImageQueueAvailability = "enabled",
): SeoWorkQueueItem[] {
	if (scope === "images" && imageAvailability !== "enabled") return [];
	const queue: SeoWorkQueueItem[] = [];
	for (const score of currentSeoWorkQueueScores(scores)) {
		for (const check of score.checks) {
			const included = scope === "images"
				? check.category === "images" && isActionableCheck(check)
				: isActionableCheck(check);
			if (!included) continue;
			queue.push({
				id: `${score.ref}:${check.id}`,
				ref: score.ref,
				entryId: score.entryId,
				collection: score.collection,
				title: score.title,
				score: score.score,
				grade: score.grade,
				presentation: analysisPresentation(score),
				updatedAt: score.updatedAt,
				check: cleanStoredSeoCheck(check),
			});
		}
	}

	return queue.sort(
		(left, right) =>
			STATUS_PRIORITY[right.check.status] -
				STATUS_PRIORITY[left.check.status] ||
			SEVERITY_PRIORITY[right.check.severity] -
				SEVERITY_PRIORITY[left.check.severity] ||
			right.check.weight - left.check.weight ||
			left.score - right.score ||
			left.ref.localeCompare(right.ref) ||
			left.check.id.localeCompare(right.check.id),
	);
}

export function currentSeoWorkQueueScores(
	scores: readonly SeoAdminContentScore[],
): SeoAdminContentScore[] {
	return scores.filter((score) => !isLegacyScore(score) && score.freshness !== "stale");
}

export type SeoWorkQueueAnalysisState =
	| "none"
	| "current"
	| "stale"
	| "mixed";

export interface SeoWorkQueueScoreCoverage {
	currentScores: SeoAdminContentScore[];
	staleCount: number;
	state: SeoWorkQueueAnalysisState;
}

export function seoWorkQueueScoreCoverage(
	scores: readonly SeoAdminContentScore[],
): SeoWorkQueueScoreCoverage {
	const currentScores = currentSeoWorkQueueScores(scores);
	const staleCount = scores.length - currentScores.length;
	return {
		currentScores,
		staleCount,
		state:
			currentScores.length > 0
				? staleCount > 0
					? "mixed"
					: "current"
				: staleCount > 0
					? "stale"
					: "none",
	};
}

export type SeoImageQueueAvailability =
	| "enabled"
	| "disabled"
	| "loading"
	| "unavailable";

export function summarizeSeoWorkQueue(
	items: readonly SeoWorkQueueItem[],
): SeoWorkQueueSummary {
	return {
		totalIssues: items.length,
		affectedContent: new Set(items.map((item) => item.ref)).size,
		failing: items.filter((item) => item.check.status === "fail").length,
		review: items.filter((item) => item.check.status === "review").length,
		highPriority: items.filter(
			(item) =>
				item.check.severity === "critical" || item.check.severity === "high",
		).length,
	};
}

export function seoWorkQueueEmptyState(
	queueLength: number,
	analysisState: SeoWorkQueueAnalysisState,
	scope: SeoWorkQueueScope,
	imageAvailability: SeoImageQueueAvailability = "enabled",
): { title: string; description: string } {
	if (scope === "images") {
		if (imageAvailability === "disabled") {
			return {
				title: "Image alt checks are off",
				description:
					"Turn on Image alt checks in Feature controls, save, then reanalyze saved content.",
			};
		}
		if (imageAvailability === "loading") {
			return {
				title: "Checking image alt check status",
				description: "The image triage queue will appear when the module status is ready.",
			};
		}
		if (imageAvailability === "unavailable") {
			return {
				title: "Image alt check status unavailable",
				description: "Reload the module status before using image triage.",
			};
		}
	}
	if (queueLength > 0) {
		return {
			title: "No matching issues",
			description: "Adjust the queue filters.",
		};
	}
	if (analysisState === "stale") {
		return {
			title: "Analysis is out of date",
			description:
				"Refresh scores for a content type before using this work queue.",
		};
	}
	if (analysisState === "none") {
		return {
			title: "No analysis to show",
			description: "Refresh scores for a content type to populate this work queue.",
		};
	}
	if (analysisState === "mixed") {
		return {
			title: "Analysis is incomplete",
			description:
				"Some stored scores are out of date. Refresh scores before treating this queue as clear.",
		};
	}
	return scope === "images"
		? {
				title: "No missing-alt issues found",
				description: "No missing-alt issues were found in the analyzed saved content. Empty-alt intent and image quality still need review.",
			}
		: {
				title: "Queue is clear",
				description: "No weighted issues were found in the analyzed content.",
			};
}

// ---- Saved SEO field ownership ----

/** The title fact covers the social title and Shipit's title suggestion; the theme decides the page title. */
export const SEO_OWNERSHIP_FIELD_LABELS: Record<SeoAdminOwnershipFieldName, string> = {
	title: "Social title and title suggestion",
	description: "Meta description",
	canonical: "Canonical URL",
	image: "Social image",
	noIndex: "Search indexing",
};

export const SEO_OWNERSHIP_SOURCE_LABELS: Record<SeoAdminMetadataSource | "site-setting" | "content-type-rule", string> = {
	"legacy-override": "Legacy SEO record",
	"plugin-social-override": "Social override",
	"core-seo": "EmDash SEO",
	template: "Metadata template",
	content: "Entry content",
	"site-default": "Site default",
	generated: "Generated from the entry",
	"site-setting": "Site-wide noindex setting",
	"content-type-rule": "Content type noindex rule",
};

export const SEO_OWNERSHIP_REASON_LABELS: Record<SeoAdminOwnershipFieldReason, string> = {
	"saved-version-mismatch": "The entry was saved again, so these facts describe an earlier save.",
	"saved-version-unavailable": "The entry's saved version could not be read.",
	"core-seo-unavailable": "EmDash SEO fields are off for this content type.",
	"core-seo-invalid": "EmDash's saved SEO values could not be read.",
	"snapshot-seo-mismatch": "The saved SEO this editor sent does not match the stored values.",
	"legacy-read-incomplete": "The legacy record could not be read completely.",
	"legacy-record-invalid": "The legacy record is not valid data.",
	"legacy-field-invalid": "The legacy record's value for this field is not valid.",
	"social-read-incomplete": "Social overrides could not be read.",
	"social-record-invalid": "A stored social override is not valid.",
	"effective-source-mismatch": "The resolved value does not match the stored records.",
};

/** An administrator-only request refused for the signed-in user. */
export function isPermissionDenied(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 403;
}

/** The last current answer this panel received, for one entry in one actual locale. */
export interface SeoOwnershipRetention {
	ref: string;
	locale: string | null;
	sourceVersion: string;
	ownership: SeoAdminEntryOwnership;
}

export interface SeoOwnershipObservation {
	/** The preview for the editor's saved version, if the query holds one. */
	preview: SeoAdminEntryPreview | null;
	/** Cached data from before this panel mounted is never current. */
	fetchedAfterMount: boolean;
	fetching: boolean;
	error: unknown;
}

export type SeoOwnershipNotice =
	| { kind: "permission-denied" }
	| { kind: "loading" }
	| { kind: "unavailable"; cause: "failed" | "not-current"; reason: SeoAdminOwnershipEntryReason | null }
	| { kind: "current"; ownership: SeoAdminEntryOwnership }
	| {
		kind: "stale";
		ownership: SeoAdminEntryOwnership;
		cause: "refreshing" | "failed" | "not-current";
		/** The editor saved again after these facts were verified. */
		savedVersionChanged: boolean;
		reason: SeoAdminOwnershipEntryReason | null;
	};

/**
 * Current only for an answer fetched after mount, settled, without an error,
 * and describing the editor's saved version of this entry. A failed refetch
 * keeps its earlier data in the query, so an error outranks any preview held
 * with it. Otherwise the facts last verified for the same entry and actual
 * locale stay visible, marked stale; they are dropped for another entry,
 * another actual locale or a permission refusal.
 */
export function resolveSeoOwnershipNotice(input: {
	ref: string;
	savedVersion: string;
	retained: SeoOwnershipRetention | null;
	observation: SeoOwnershipObservation;
}): { notice: SeoOwnershipNotice; retained: SeoOwnershipRetention | null } {
	const { ref, savedVersion, observation } = input;
	if (isPermissionDenied(observation.error)) return { notice: { kind: "permission-denied" }, retained: null };
	let retained = input.retained?.ref === ref ? input.retained : null;
	const failed = observation.error !== null && observation.error !== undefined;
	const answer = !failed && observation.fetchedAfterMount && !observation.fetching && observation.preview?.content.ref === ref
		? observation.preview
		: null;
	const ownership = answer?.ownership ?? null;
	if (
		answer && ownership && ownership.status === "current" &&
		ownership.sourceVersion === savedVersion && answer.sourceVersion === savedVersion
	) {
		retained = { ref, locale: ownership.locale, sourceVersion: savedVersion, ownership };
		return { notice: { kind: "current", ownership }, retained };
	}
	if (ownership && retained && ownership.locale !== retained.locale) retained = null;
	const stale = (cause: "refreshing" | "failed" | "not-current", reason: SeoAdminOwnershipEntryReason | null) => ({
		notice: {
			kind: "stale" as const,
			ownership: retained!.ownership,
			cause,
			savedVersionChanged: retained!.sourceVersion !== savedVersion,
			reason,
		},
		retained,
	});
	if (answer) {
		const reason = ownership?.reason ?? null;
		return retained ? stale("not-current", reason) : { notice: { kind: "unavailable", cause: "not-current", reason }, retained };
	}
	if (failed) {
		return retained ? stale("failed", null) : { notice: { kind: "unavailable", cause: "failed", reason: null }, retained };
	}
	return retained ? stale("refreshing", null) : { notice: { kind: "loading" }, retained };
}

export interface SeoOwnershipFieldView {
	field: SeoAdminOwnershipFieldName;
	label: string;
	state: SeoAdminOwnershipField["state"];
	core: string;
	legacy: string;
	effective: string;
	source: string | null;
	/** Title and description: who decides the social value when it is not the legacy record. */
	social: string | null;
	reason: string | null;
}

export function seoOwnershipValueText(field: SeoAdminOwnershipFieldName, value: string | boolean | null): string {
	if (field === "noIndex") return value === true ? "noindex" : value === false ? "Indexable" : "Unknown";
	return typeof value === "string" && value ? value : "Not set";
}

export function seoOwnershipFieldViews(ownership: SeoAdminEntryOwnership): SeoOwnershipFieldView[] {
	return ownership.fields.map((item) => ({
		field: item.field,
		label: SEO_OWNERSHIP_FIELD_LABELS[item.field],
		state: item.state,
		core: seoOwnershipValueText(item.field, item.core),
		legacy: seoOwnershipValueText(item.field, item.legacy),
		effective: seoOwnershipValueText(item.field, item.effective),
		source: item.effectiveSource ? SEO_OWNERSHIP_SOURCE_LABELS[item.effectiveSource] : null,
		social: item.social && item.social.source !== "legacy-override"
			? `${SEO_OWNERSHIP_SOURCE_LABELS[item.social.source]} decides the social value.`
			: null,
		reason: item.state === "unknown" && item.reason ? SEO_OWNERSHIP_REASON_LABELS[item.reason] : null,
	}));
}

export function seoOwnershipSummary(ownership: SeoAdminEntryOwnership): {
	conflicts: number;
	equal: number;
	unknown: number;
	/** Every field is known and no legacy record decides any of them. */
	coreOnly: boolean;
} {
	const count = (state: SeoAdminOwnershipField["state"]) => ownership.fields.filter((item) => item.state === state).length;
	return {
		conflicts: count("conflict"),
		equal: count("equal"),
		unknown: count("unknown"),
		coreOnly: ownership.status === "current" && ownership.record === null &&
			count("not-shadowed") === ownership.fields.length && ownership.unsupportedDirectives.state === "none",
	};
}
