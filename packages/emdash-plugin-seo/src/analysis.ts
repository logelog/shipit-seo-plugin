import {
	extractSeoDocumentSignals,
	type SeoDocumentImageInput,
	type SeoDocumentSignals,
} from "./document-signals.ts";
import type { SeoCanonicalStatus } from "./sitemap-policy.ts";
import {
	normaliseSeoKeywordText,
	seoKeywordOccurrenceCount,
	seoTextContainsKeyword,
} from "./keyword-match.ts";
import {
	isCollectionAnalysisProfileSelection,
	type CollectionAnalysisProfile,
	type CollectionAnalysisProfileSelection,
} from "./collection-analysis-profile.ts";
import {
	SEO_SNIPPET_DEVICE_LABELS,
	SEO_SNIPPET_ESTIMATE_NOTE,
	seoSnippetCutPoint,
	seoSnippetFit,
	type SeoSnippetDeviceFit,
} from "./snippet-fit.ts";

/**
 * Version 22 raises article length guidance and requires a minimum sample for repetition,
 * derives score limits from rows and bands the limited score. Results from
 * earlier versions are legacy snapshots: readable, never current.
 */
export const SEO_SCORE_VERSION = 22 as const;

export type SeoCheckStatus = "pass" | "review" | "fail";
export type SeoCheckSeverity = "info" | "low" | "medium" | "high" | "critical";
export type SeoCheckCategory =
	| "metadata"
	| "indexability"
	| "social"
	| "schema"
	| "content"
	| "keyword"
	| "links"
	| "images"
	| "readability";

/**
 * How a check reached its outcome. `measured` compares a saved or resolved
 * value with a stated rule; `heuristic` applies a directional threshold;
 * `unavailable` lacks the evidence it needs; `not-applicable` does not apply to
 * this entry. The last two carry no weight and are never a pass or failure.
 */
export type SeoCheckBasis = "measured" | "heuristic" | "unavailable" | "not-applicable";
export const SEO_CHECK_BASES = ["measured", "heuristic", "unavailable", "not-applicable"] as const satisfies readonly SeoCheckBasis[];

/** A state shown beside the score and never folded into it. */
export type SeoCheckCondition = "excluded-from-search";
export const SEO_CHECK_CONDITIONS = ["excluded-from-search"] as const satisfies readonly SeoCheckCondition[];

/** Where an effective noindex comes from. Per-entry directives cannot add noindex. */
/** In precedence order: site-wide, content type rule, entry, legacy override. */
export const SEO_NOINDEX_SOURCES = ["site-setting", "content-type-rule", "entry-seo", "legacy-override"] as const;
export type SeoNoindexSource = (typeof SEO_NOINDEX_SOURCES)[number];

/** Where a resolved title or description came from; mirrors the admin metadata sources. */
export type SeoMetadataValueSource =
	| "legacy-override"
	| "plugin-social-override"
	| "core-seo"
	| "template"
	| "content"
	| "site-default"
	| "generated";

const SEO_CHECK_CATEGORIES: readonly SeoCheckCategory[] = [
	"metadata",
	"indexability",
	"social",
	"schema",
	"content",
	"keyword",
	"links",
	"images",
	"readability",
];
const SEO_CHECK_SEVERITIES: readonly SeoCheckSeverity[] = ["info", "low", "medium", "high", "critical"];
const SEO_CHECK_STATUSES: readonly SeoCheckStatus[] = ["pass", "review", "fail"];

export interface SeoCheckEvidence {
	actual: string | number | boolean | null;
	expected: string;
	source: string;
}

export interface SeoContentCheck {
	id: string;
	label: string;
	category: SeoCheckCategory;
	severity: SeoCheckSeverity;
	status: SeoCheckStatus;
	weight: number;
	detail: string;
	evidence: SeoCheckEvidence;
	recommendation: string;
	basis: SeoCheckBasis;
	/** What this result does not establish. */
	limitation: string;
	condition?: SeoCheckCondition;
}

export interface SeoAnalysisInput {
	ref: string;
	collection: string;
	entryId: string;
	slug?: string | null;
	title: string;
	/** Which resolver input produced `title`. */
	titleSource?: SeoMetadataValueSource;
	description: string;
	/** Which resolver input produced `description`; `generated` is an excerpt of the body text. */
	descriptionSource?: SeoMetadataValueSource;
	/** What the preview shows before the description, such as the publication date; it shares the description's lines. */
	descriptionPrefix?: string;
	url: string;
	canonicalStatus?: SeoCanonicalStatus;
	image?: string;
	/** Which resolver input produced `image`; `site-default` means only the site-wide fallback applies. */
	imageSource?: SeoMetadataValueSource;
	featuredImage?: string;
	noindex: boolean;
	/** The inputs that set `noindex`; empty when it is false. */
	noindexSources?: readonly SeoNoindexSource[];
	/** The entry asks search engines to show no text snippet. */
	nosnippet?: boolean;
	publicationStatus?: string | null;
	body: string;
	document?: unknown;
	contentImages?: readonly SeoDocumentImageInput[];
	bodySource?: string;
	focusKeyword?: string;
	/**
	 * The full effective keyword list (primary first). Only the primary drives
	 * the conditional phrase checks; secondary coverage is unweighted advice.
	 */
	focusKeywords?: readonly string[];
	/**
	 * Pillar (cornerstone) intent is retained for context, without a mandatory
	 * word-count or link quota.
	 */
	pillar?: boolean;
	/** Editorial purpose is explicitly selected, independently of schema output. */
	assessmentProfile: CollectionAnalysisProfileSelection;
	schemaEnabled: boolean;
	schemaPreset: string;
	imageSeoEnabled?: boolean;
	sourceUpdatedAt?: string | null;
}

export interface SeoAnalysisMetrics {
	wordCount: number;
	sentenceCount: number;
	averageSentenceWords: number | null;
	paragraphCount: number;
	longestParagraphWords: number;
	headingCount: number;
	h1Count: number;
	internalLinkCount: number;
	externalLinkCount: number;
	genericLinkCount: number;
	imageCount: number;
	imageAltCount: number;
	/** Legacy field name. Counts empty alt values, not verified decorative intent. */
	imageDecorativeCount: number;
	imageMissingAltCount: number;
	structured: boolean;
}

export interface SeoAnalysisResult {
	scoreVersion: typeof SEO_SCORE_VERSION;
	ref: string;
	collection: string;
	entryId: string;
	slug: string | null;
	title: string;
	score: number;
	grade: "excellent" | "good" | "needs-work" | "poor";
	status: SeoCheckStatus;
	checks: SeoContentCheck[];
	metrics: SeoAnalysisMetrics;
	keyword?: string;
	url: string;
	sourceUpdatedAt: string | null;
	assessmentProfile: CollectionAnalysisProfileSelection;
	calculation: SeoScoreCalculation;
	coverage: SeoAnalysisCoverage;
}

/**
 * Earlier names stay in the union so stored results keep parsing. Analyzer 22
 * emits only `missing-title`, `severely-thin-content`, `thin-content`,
 * `keyword-repetition` and `missing-primary-keyword`, each derived from rows.
 */
export type SeoScoreLimitReason =
	| "critical-failure"
	| "high-failure"
	| "missing-primary-keyword"
	| "severely-thin-content"
	| "high-review"
	| "missing-title"
	| "thin-content"
	| "keyword-repetition";
export interface SeoScoreLimit {
	reason: SeoScoreLimitReason;
	cap: number;
	/** Rows that set the limit, in scored mask order. */
	checkIds: string[];
}
export interface SeoScoreCalculation {
	earnedWeight: number;
	totalWeight: number;
	/** The weighted score before any limit. */
	rawScore: number;
	/** `rawScore` capped by `limit`. */
	score: number;
	reviewCredit: 0.35;
	/** The lowest applicable limit, set whether or not it lowers `rawScore`. */
	limit: SeoScoreLimit | null;
	/** Every applicable limit, lowest cap first. */
	limits: SeoScoreLimit[];
}
export interface SeoAnalysisCoverage {
	evaluated: number;
	measured: number;
	heuristic: number;
	unavailable: number;
	notApplicable: number;
	unweighted: number;
}

/** Whether a check may carry weight and count as a pass, review or failure. */
export function isScoredSeoCheckBasis(basis: unknown): boolean {
	return basis !== "unavailable" && basis !== "not-applicable";
}

export type SeoCheckRole = "scored-completeness" | "scored-coaching" | "advisory" | "condition" | "unavailable" | "not-applicable";
interface SeoCheckPolicy {
	role: "scored-completeness" | "scored-coaching" | "advisory" | "condition";
	weight: number;
	severity: SeoCheckSeverity;
	category: SeoCheckCategory;
	basis: "measured" | "heuristic";
	/** The only statuses an evaluated row may carry; the engine coerces others and the validator refuses them. */
	outcomes: readonly SeoCheckStatus[];
}
/** A policy that differs by assessment profile names one policy per profile. */
type SeoCheckPolicyEntry = SeoCheckPolicy | Readonly<Record<CollectionAnalysisProfile, SeoCheckPolicy>>;

const PASS_FAIL: readonly SeoCheckStatus[] = ["pass", "fail"];
const PASS_REVIEW: readonly SeoCheckStatus[] = ["pass", "review"];
const PASS_REVIEW_FAIL: readonly SeoCheckStatus[] = ["pass", "review", "fail"];

function scored(
	role: "scored-completeness" | "scored-coaching",
	weight: number,
	severity: SeoCheckSeverity,
	category: SeoCheckCategory,
	basis: "measured" | "heuristic",
	outcomes: readonly SeoCheckStatus[],
): SeoCheckPolicy {
	return { role, weight, severity, category, basis, outcomes };
}

function advice(category: SeoCheckCategory, basis: "measured" | "heuristic"): SeoCheckPolicy {
	return { role: "advisory", weight: 0, severity: "info", category, basis, outcomes: PASS_REVIEW };
}

const SEO_CHECK_POLICY: Readonly<Record<string, SeoCheckPolicyEntry>> = {
	title: scored("scored-completeness", 14, "high", "metadata", "measured", PASS_FAIL),
	description: scored("scored-completeness", 14, "medium", "metadata", "measured", PASS_FAIL),
	url: scored("scored-completeness", 8, "high", "indexability", "measured", PASS_FAIL),
	"social-image": scored("scored-completeness", 8, "medium", "social", "measured", PASS_REVIEW),
	"image-alt-text": scored("scored-completeness", 6, "medium", "images", "measured", PASS_FAIL),
	"keyword-title": scored("scored-coaching", 4, "low", "keyword", "heuristic", PASS_FAIL),
	"keyword-description": scored("scored-coaching", 3, "low", "keyword", "heuristic", PASS_FAIL),
	"keyword-content": scored("scored-coaching", 3, "low", "keyword", "heuristic", PASS_FAIL),
	"keyword-repetition": scored("scored-coaching", 4, "medium", "keyword", "heuristic", PASS_FAIL),
	"internal-links": {
		article: scored("scored-coaching", 5, "low", "links", "heuristic", PASS_FAIL),
		general: scored("scored-coaching", 5, "low", "links", "heuristic", PASS_REVIEW),
	},
	"descriptive-link-text": scored("scored-coaching", 3, "low", "links", "heuristic", PASS_REVIEW),
	"sentence-readability": scored("scored-coaching", 4, "low", "readability", "heuristic", PASS_REVIEW),
	"paragraph-length": scored("scored-coaching", 3, "low", "readability", "heuristic", PASS_REVIEW),
	"content-depth": {
		article: scored("scored-coaching", 10, "medium", "content", "measured", PASS_REVIEW_FAIL),
		general: advice("content", "measured"),
	},
	"focus-keyword": advice("keyword", "measured"),
	"keyword-url": advice("keyword", "heuristic"),
	"keyword-introduction": advice("keyword", "heuristic"),
	"keyword-heading": advice("keyword", "heuristic"),
	"keyword-title-position": advice("keyword", "heuristic"),
	"secondary-keyword-coverage": advice("keyword", "heuristic"),
	"heading-structure": advice("content", "heuristic"),
	"featured-image": advice("images", "measured"),
	schema: advice("schema", "measured"),
	"image-empty-alt-review": advice("images", "measured"),
	"social-image-fallback": advice("social", "measured"),
	"title-display-length": advice("metadata", "heuristic"),
	"description-display-length": advice("metadata", "heuristic"),
	"canonical-policy-review": advice("indexability", "measured"),
	indexability: { role: "condition", weight: 0, severity: "info", category: "indexability", basis: "measured", outcomes: PASS_REVIEW },
};
const BODY_CHECK_IDS = new Set(["content-depth", "heading-structure", "internal-links", "descriptive-link-text", "sentence-readability", "paragraph-length", "keyword-introduction", "keyword-content", "keyword-heading", "keyword-repetition"]);

/** Every policy a row with this ID may follow, or only the one for `profile`. */
function seoCheckPolicies(id: string, profile?: CollectionAnalysisProfile): readonly SeoCheckPolicy[] {
	if (!Object.hasOwn(SEO_CHECK_POLICY, id)) return [];
	const entry = SEO_CHECK_POLICY[id];
	if ("role" in entry) return [entry];
	return profile ? [entry[profile]] : [entry.article, entry.general];
}

function isScoredRole(role: SeoCheckRole): boolean {
	return role === "scored-completeness" || role === "scored-coaching";
}

/** The largest weight this row can carry under the profile; any profile when it is unknown. */
function seoCheckPolicyWeight(id: string, profile?: CollectionAnalysisProfile): number {
	return Math.max(0, ...seoCheckPolicies(id, profile).map((policy) => policy.weight));
}

/** Names the mask order below; stored comparison contexts with another policy are not compared. */
export const SEO_SCORE_COMPARISON_POLICY = "seo22-scored-v1" as const;

/**
 * Bit order of analyzer 22 scored membership masks. Stored masks are read
 * against this exact list, so adding, removing or reordering an ID needs a new
 * comparison policy version.
 */
const SEO_SCORED_CHECK_MASK_IDS: readonly string[] = [
	"title", "description", "url", "social-image", "image-alt-text",
	"keyword-title", "keyword-description", "keyword-content", "internal-links",
	"descriptive-link-text", "sentence-readability", "paragraph-length", "content-depth",
	"keyword-repetition",
];
const SEO_SCORED_POLICY_IDS = Object.keys(SEO_CHECK_POLICY).filter((id) =>
	seoCheckPolicies(id).some((policy) => isScoredRole(policy.role)));
if (SEO_SCORED_POLICY_IDS.length !== SEO_SCORED_CHECK_MASK_IDS.length ||
	SEO_SCORED_POLICY_IDS.some((id) => !SEO_SCORED_CHECK_MASK_IDS.includes(id)))
	throw new Error("The scored check mask must name exactly the scored policy IDs.");

function allowedOutcome(status: SeoCheckStatus, outcomes: readonly SeoCheckStatus[]): SeoCheckStatus {
	if (outcomes.includes(status)) return status;
	return status === "fail" ? "review" : "fail";
}

function applySeoCheckPolicy(check: SeoContentCheck, profile: CollectionAnalysisProfile): SeoContentCheck {
	if (check.basis === "unavailable" || check.basis === "not-applicable") return { ...check, weight: 0, severity: "info", status: "review" };
	const policy = seoCheckPolicies(check.id, profile)[0];
	if (!policy) return { ...check, weight: 0, severity: "info" };
	return { ...check, weight: policy.weight, severity: policy.severity, basis: policy.basis,
		status: allowedOutcome(check.status, policy.outcomes) };
}

function matchingPolicies(check: Pick<SeoContentCheck, "id" | "weight" | "severity" | "basis">, profile?: CollectionAnalysisProfile): SeoCheckPolicy[] {
	return seoCheckPolicies(check.id, profile).filter((policy) =>
		policy.weight === check.weight && policy.severity === check.severity && policy.basis === check.basis);
}

export function classifySeoContentCheck(check: SeoContentCheck, profile?: CollectionAnalysisProfile): { role: SeoCheckRole; eligible: boolean; issue: boolean; weight: number } {
	const problem = seoContentCheckProblem(check, true, profile);
	if (problem) throw new Error(`Invalid current check ${check.id}: ${problem}`);
	if (check.basis === "unavailable" || check.basis === "not-applicable") return { role: check.basis, eligible: false, issue: false, weight: 0 };
	const role = matchingPolicies(check, profile)[0]?.role ?? "advisory";
	const eligible = isScoredRole(role) && check.weight > 0;
	return { role, eligible, issue: eligible && check.status !== "pass", weight: eligible ? check.weight : 0 };
}

/** Domain of the fixed current policy, including mandatory metadata membership. */
export function isSeoScoredCheckMask(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 &&
		value < 2 ** SEO_SCORED_CHECK_MASK_IDS.length && (value & 0b11) === 0b11;
}

/**
 * Analyzer 22 scored membership as a bit set over SEO_SCORED_CHECK_MASK_IDS,
 * carrying no metadata, URL or keyword text. Null unless every row is valid
 * current evidence with a unique ID and both mandatory metadata rows are scored.
 */
export function seoScoredCheckMask(checks: unknown, profile?: CollectionAnalysisProfile): number | null {
	if (!Array.isArray(checks)) return null;
	const seen = new Set<string>();
	let mask = 0;
	for (const value of checks) {
		if (seoContentCheckProblem(value, true, profile) !== null) return null;
		const check = value as SeoContentCheck;
		if (seen.has(check.id)) return null;
		seen.add(check.id);
		if (!classifySeoContentCheck(check, profile).eligible) continue;
		const bit = SEO_SCORED_CHECK_MASK_IDS.indexOf(check.id);
		if (bit < 0) return null;
		mask |= 1 << bit;
	}
	return isSeoScoredCheckMask(mask) ? mask : null;
}

export function summarizeSeoChecks(checks: readonly SeoContentCheck[], profile?: CollectionAnalysisProfile): SeoAnalysisCoverage & { issues: number; advisories: number; totalWeight: number } {
	const classified = checks.map(check => ({ check, classification: classifySeoContentCheck(check, profile) }));
	return {
		evaluated: classified.filter(item => item.classification.eligible).length,
		measured: checks.filter(check => check.basis === "measured").length,
		heuristic: checks.filter(check => check.basis === "heuristic").length,
		unavailable: checks.filter(check => check.basis === "unavailable").length,
		notApplicable: checks.filter(check => check.basis === "not-applicable").length,
		unweighted: classified.filter(item => !item.classification.eligible && !["unavailable", "not-applicable"].includes(item.classification.role)).length,
		issues: classified.filter(item => item.classification.issue).length,
		advisories: classified.filter(item => item.classification.role === "advisory" && item.check.status === "review").length,
		totalWeight: classified.reduce((total, item) => total + item.classification.weight, 0),
	};
}

export type SeoScoreBand = "good" | "needs-improvement" | "poor";

/** Shipit guidance: 80 and above is good, 50 to 79 needs improvement, under 50 is poor. */
export function seoScoreBand(score: number): SeoScoreBand {
	return score >= 80 ? "good" : score >= 50 ? "needs-improvement" : "poor";
}

export function aggregateSeoChecks(checks: readonly SeoContentCheck[], profile?: CollectionAnalysisProfile) {
	const calculation = calculateSeoScore(checks, profile);
	if (calculation.totalWeight <= 0) throw new Error("No eligible evidence is available for a current numeric assessment.");
	for (const id of ["title", "description"]) {
		const weight = seoCheckPolicyWeight(id);
		if (!checks.some(check => check.id === id && check.basis === "measured" && check.weight === weight))
			throw new Error(`Mandatory metadata evidence is unavailable: ${id}.`);
	}
	const band = seoScoreBand(calculation.score);
	const status: SeoCheckStatus = band === "good" ? "pass" : band === "needs-improvement" ? "review" : "fail";
	const grade: SeoAnalysisResult["grade"] = band === "good" ? "good" : band === "needs-improvement" ? "needs-work" : "poor";
	const summary = summarizeSeoChecks(checks, profile);
	const { issues: _issues, advisories: _advisories, totalWeight: _totalWeight, ...coverage } = summary;
	return { calculation, score: calculation.score, status, grade, coverage };
}

export type SeoScoreDisplayLabel =
	| "Good"
	| "Needs improvement"
	| "Poor"
	| "Partially checked"
	| "Too little text to score"
	| "Earlier analyzer";

/** The one score decision every surface renders: a number and band, or a dash with its reason. */
export interface SeoScoreDisplay {
	score: number | null;
	band: SeoScoreBand | null;
	label: SeoScoreDisplayLabel;
	qualifier: string | null;
	/** The lowest applicable limit of a shown number. */
	limit: SeoScoreLimit | null;
	/** Scored rows that failed or were partly met. */
	issues: number;
	/** Advice rows with a suggestion. */
	suggestions: number;
	/** Rows whose evidence was not observed. */
	notChecked: number;
}

export type SeoScoreDisplayInput = Pick<SeoAnalysisResult, "checks" | "score"> & {
	scoreVersion?: number;
	calculation?: Pick<SeoScoreCalculation, "rawScore" | "limit">;
	assessmentProfile?: CollectionAnalysisProfileSelection;
};

const SEO_SCORE_BAND_LABELS: Readonly<Record<SeoScoreBand, SeoScoreDisplayLabel>> = {
	good: "Good",
	"needs-improvement": "Needs improvement",
	poor: "Poor",
};

const SEO_SCORE_LIMIT_TEXT: Readonly<Record<SeoScoreLimitReason, string>> = {
	"missing-title": "no title",
	"severely-thin-content": "under 50 words of body text",
	"thin-content": "under 600 words of body text",
	"keyword-repetition": "high focus keyword density",
	"missing-primary-keyword": "focus keyword not in title, description or body text",
	"critical-failure": "a critical check failed",
	"high-failure": "a high-severity check failed",
	"high-review": "a high-severity check needs review",
};

export function seoScoreBandLabel(band: SeoScoreBand): SeoScoreDisplayLabel {
	return SEO_SCORE_BAND_LABELS[band];
}

export function seoScoreLimitText(limit: Pick<SeoScoreLimit, "reason" | "cap">): string {
	return `Limited to ${limit.cap}: ${SEO_SCORE_LIMIT_TEXT[limit.reason]}`;
}

/** A General entry below this many words of body text shows no number. */
const GENERAL_SCORE_MINIMUM_WORDS = 50;

export function seoScoreDisplay(result: SeoScoreDisplayInput): SeoScoreDisplay {
	if (result.scoreVersion !== undefined && result.scoreVersion !== SEO_SCORE_VERSION)
		return { score: null, band: null, label: "Earlier analyzer", qualifier: "Analyze again.", limit: null, issues: 0, suggestions: 0, notChecked: 0 };
	const profile = isCollectionAnalysisProfileSelection(result.assessmentProfile) ? result.assessmentProfile.profile : undefined;
	const totals = summarizeSeoChecks(result.checks, profile);
	// The indexing directive is never a checklist row, so it never counts as a row that was not checked.
	const notChecked = result.checks.filter((check) => check.basis === "unavailable" && check.id !== "indexability" && check.condition === undefined).length;
	const counts = { issues: totals.issues, suggestions: totals.advisories, notChecked };
	// An unavailable metadata row is counted with the other unavailable rows below.
	const missingMetadata = ["title", "description"].filter((id) =>
		!result.checks.some((check) => check.id === id && (check.basis === "measured" || check.basis === "unavailable"))).length;
	// Unread body text can hide words in either profile, so it blocks the number even where it carries no weight.
	const unchecked = missingMetadata + result.checks.filter((check) => check.basis === "unavailable" &&
		(check.id === "content-depth" || seoCheckPolicyWeight(check.id, profile) > 0)).length;
	if (unchecked > 0)
		return { score: null, band: null, label: "Partially checked", qualifier: `${unchecked} weighted ${unchecked === 1 ? "check" : "checks"} not checked`, limit: null, ...counts };
	const depth = result.checks.find((check) => check.id === "content-depth");
	const words = depth?.basis === "measured" && typeof depth.evidence.actual === "number" ? depth.evidence.actual : null;
	const general = profile ? profile === "general" : depth?.weight === 0;
	if (general && words !== null && words < GENERAL_SCORE_MINIMUM_WORDS)
		return { score: null, band: null, label: "Too little text to score", qualifier: `${words} ${words === 1 ? "word" : "words"} of body text`, limit: null, ...counts };
	const calculation = result.calculation ?? calculateSeoScore(result.checks, profile);
	const band = seoScoreBand(result.score);
	const limit = calculation.limit;
	const keywordUnset = result.checks.some((check) => check.id === "focus-keyword" && check.basis === "measured" && check.status === "review");
	// A named limit never hides an unset focus keyword: both facts stay in the one qualifier.
	const qualifiers = [
		...(limit && calculation.rawScore > limit.cap ? [seoScoreLimitText(limit)] : []),
		...(keywordUnset ? ["No focus keyword"] : []),
	];
	return { score: result.score, band, label: seoScoreBandLabel(band), qualifier: qualifiers.join(". ") || null, limit, ...counts };
}

export interface SeoAnalysisSummary {
	evaluated: number;
	scoredIssues: number;
	advisorySuggestions: number;
	unavailable: number;
	notApplicable: number;
	/** Body text length was not observed, or a General entry has too little text for a number. */
	bodyLimited: boolean;
	/** Sentence or paragraph length was not evaluated. */
	readabilityLimited: boolean;
	/** The number is shown; the same decision as `seoScoreDisplay(result).score !== null`. */
	numericBadgeAvailable: boolean;
	label: string;
	qualifier: string | null;
	tone: "good" | "review" | "poor" | "neutral";
}

/** Counts and tone over `seoScoreDisplay`, so no surface decides a number on its own. */
export function seoAnalysisSummary(result: SeoScoreDisplayInput): SeoAnalysisSummary {
	const display = seoScoreDisplay(result);
	if (display.label === "Earlier analyzer") {
		return { evaluated: 0, scoredIssues: 0, advisorySuggestions: 0, unavailable: 0, notApplicable: 0, bodyLimited: false,
			readabilityLimited: false, numericBadgeAvailable: false, label: display.label, qualifier: display.qualifier, tone: "neutral" };
	}
	const profile = isCollectionAnalysisProfileSelection(result.assessmentProfile) ? result.assessmentProfile.profile : undefined;
	const totals = summarizeSeoChecks(result.checks, profile);
	const depth = result.checks.find(check => check.id === "content-depth");
	const sentence = result.checks.find(check => check.id === "sentence-readability");
	const paragraph = result.checks.find(check => check.id === "paragraph-length");
	return {
		evaluated: totals.evaluated,
		scoredIssues: display.issues,
		advisorySuggestions: display.suggestions,
		unavailable: display.notChecked,
		notApplicable: totals.notApplicable,
		bodyLimited: depth?.basis !== "measured" || display.label === "Too little text to score",
		readabilityLimited: !sentence || !paragraph || [sentence, paragraph].some(check => !isScoredSeoCheckBasis(check.basis)),
		numericBadgeAvailable: display.score !== null,
		label: display.label,
		qualifier: display.qualifier,
		tone: display.band === "good" ? "good" : display.band === "needs-improvement" ? "review" : display.band === "poor" ? "poor" : "neutral",
	};
}

export function seoAnalysisPresentation(result: SeoScoreDisplayInput): Pick<SeoAnalysisSummary, "label" | "qualifier" | "tone"> {
	const { label, qualifier, tone } = seoAnalysisSummary(result);
	return { label, qualifier, tone };
}

function bodyEvidenceUnavailable(input: SeoAnalysisInput, signals: SeoDocumentSignals): boolean {
	if (input.bodySource?.trim() === "template") return true;
	if (signals.wordCount > 0) return false;
	return signals.bodyFormat === "none" || signals.bodyFormat === "unsupported" || signals.unsupportedBlockCount > 0;
}

/** Presence is a boolean, so a durable score row never copies the resolved metadata text. */
function metadataPresenceCheck(field: "title" | "description", value: string, source: string): SeoContentCheck {
	const present = Boolean(value);
	const name = field === "title" ? "title" : "description";
	return { id: field, label: field === "title" ? "Title" : "Description", category: "metadata", severity: field === "title" ? "high" : "medium", status: present ? "pass" : "fail", weight: 14, basis: "measured",
		detail: present ? `A ${name} resolves for this entry.` : `No ${name} resolves for this entry.`, evidence: { actual: present, expected: "nonempty resolved saved metadata", source },
		limitation: field === "title" ? TITLE_LIMITATION : DESCRIPTION_LIMITATION, recommendation: present ? "Keep it accurate and useful for this entry." : `Add a ${name} that describes this page.` };
}

function keywordSlugCheck(keyword: string | undefined, slugInput: string | null | undefined): SeoContentCheck {
	let slug = slugInput?.trim() ?? "";
	try { slug = decodeURI(slug); } catch { slug = ""; }
	const opaque = /^\d+$/.test(slug) || /^[0-9][A-Z0-9]{24,27}$/.test(slug) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(slug);
	const label = "Focus keyword in URL";
	const limitation = "Literal match in the saved slug. Google says words in the URL have hardly any ranking effect.";
	if (!keyword || !slug || slug === "/" || opaque || /[?#]/.test(slug) || /^[a-z][a-z0-9+.-]*:/i.test(slug))
		return notApplicableCheck("keyword-url", label, "keyword", keyword ? "The saved slug is not readable words." : "No focus keyword is set.", "a meaningful saved slug", "saved slug", limitation);
	const found = seoTextContainsKeyword(slug, keyword);
	return { id: "keyword-url", label, category: "keyword", severity: "info", status: found ? "pass" : "review", weight: 0, basis: "heuristic",
		detail: found ? `The URL contains "${keyword}".` : "The URL does not contain the focus keyword. Google says words in the URL have hardly any ranking effect. Change a published URL only if you redirect the old one.",
		evidence: { actual: found, expected: `"${keyword}" in the slug, when it reads naturally`, source: "saved slug" },
		limitation, recommendation: found ? "Keep the URL short and readable." : "Leave an established URL as it is, or redirect the old URL if you change it." };
}

/** Uses of the primary phrase in body headings and paragraphs, never across block boundaries. */
function bodyKeywordOccurrences(keyword: string, signals: SeoDocumentSignals): number {
	return [...signals.headings.map((heading) => heading.text), ...signals.proseBlocks]
		.reduce((total, text) => total + seoKeywordOccurrenceCount(text, keyword), 0);
}

const REPETITION_MINIMUM_WORDS = 100;
const REPETITION_SHARE_LIMIT = 3.5;
const REPETITION_MINIMUM_USES = 3;

function keywordRepetitionCheck(keyword: string | undefined, signals: SeoDocumentSignals, templateBody: boolean): SeoContentCheck {
	const label = "Focus keyword repetition";
	const limitation = "Counts literal uses of the focus keyword in the saved body. The 3.5% threshold is a checklist guideline; Google sets no keyword density.";
	const expected = "At least 100 body words, then 3.5% or less, or fewer than 3 uses (checklist guideline)";
	if (!keyword) return notApplicableCheck("keyword-repetition", label, "keyword", "No focus keyword is set.", expected, "saved body text", limitation);
	if (templateBody) return unavailableCheck("keyword-repetition", label, "keyword", "Template-managed page; its body text comes from the template and is not observed.", expected, "body source field: template", limitation);
	if (signals.wordCount === 0) return notApplicableCheck("keyword-repetition", label, "keyword", "No body text to check.", expected, "saved body text", limitation);
	if (signals.wordCount < REPETITION_MINIMUM_WORDS) return notApplicableCheck("keyword-repetition", label, "keyword",
		"Keyword density is not assessed below 100 words of body text.", expected, "saved body text", limitation);
	const count = bodyKeywordOccurrences(keyword, signals);
	const share = count * 100 / signals.wordCount;
	const repeated = share > REPETITION_SHARE_LIMIT && count >= REPETITION_MINIMUM_USES;
	const uses = `${count} ${count === 1 ? "time" : "times"}`;
	return { id: "keyword-repetition", label, category: "keyword", severity: "medium", status: repeated ? "fail" : "pass", weight: 4, basis: "heuristic",
		detail: repeated
			? `The focus keyword appears ${uses} in ${signals.wordCount} words (${Math.round(share * 10) / 10}%). This is above the 3.5% checklist guideline. Review whether the wording sounds natural.`
			: `The focus keyword appears ${uses} in ${signals.wordCount} words.`,
		evidence: { actual: count, expected, source: "saved body text" },
		limitation, recommendation: repeated ? "Use natural wording and vary the phrase." : "Keep the wording natural." };
}

/**
 * Why a check is unusable, or null. Shared by the engine and the admin parser
 * so both refuse the same values. A check from the current analyzer needs a
 * known basis and a limitation; an earlier version may omit both and is then a
 * legacy snapshot. Unavailable checks are always reviews and never pass. A
 * current row follows one of its policies, the one for `profile` when given.
 */
export function seoContentCheckProblem(value: unknown, current: boolean, profile?: CollectionAnalysisProfile): string | null {
	if (!isRecord(value) || !isRecord(value.evidence)) return "shape";
	if (typeof value.id !== "string" || !value.id || typeof value.label !== "string") return "identity";
	if (!SEO_CHECK_CATEGORIES.includes(value.category as SeoCheckCategory)) return "category";
	if (!SEO_CHECK_SEVERITIES.includes(value.severity as SeoCheckSeverity)) return "severity";
	if (!SEO_CHECK_STATUSES.includes(value.status as SeoCheckStatus)) return "status";
	if (typeof value.weight !== "number" || !Number.isFinite(value.weight) || value.weight < 0) return "weight";
	if (typeof value.detail !== "string" || typeof value.recommendation !== "string") return "copy";
	const actual = value.evidence.actual;
	if (!(actual === null || typeof actual === "string" || typeof actual === "boolean" ||
		(typeof actual === "number" && Number.isFinite(actual)))) return "evidence";
	if (typeof value.evidence.expected !== "string" || typeof value.evidence.source !== "string") return "evidence";
	const evaluated = value.basis !== undefined || value.limitation !== undefined || value.condition !== undefined;
	if (!evaluated) return current ? "basis" : null;
	if (!SEO_CHECK_BASES.includes(value.basis as SeoCheckBasis)) return "basis";
	if (typeof value.limitation !== "string" || !value.limitation.trim()) return "limitation";
	if (!isScoredSeoCheckBasis(value.basis)) {
		if (value.weight !== 0 || value.severity !== "info" || value.status === "fail") return "unscored";
		if (value.basis === "unavailable" && value.status !== "review") return "unavailable";
	}
	if (value.condition !== undefined &&
		(!SEO_CHECK_CONDITIONS.includes(value.condition as SeoCheckCondition) || value.basis !== "measured" || value.weight !== 0))
		return "condition";
	if (current) {
		const policies = seoCheckPolicies(value.id, profile);
		if (!policies.length) return value.weight === 0 && value.severity === "info" && value.condition === undefined ? null : "unknown-policy";
		if (value.category !== policies[0].category) return "policy-category";
		if (value.condition !== undefined && policies.every((policy) => policy.role !== "condition")) return "policy-condition";
		if (!isScoredSeoCheckBasis(value.basis)) return value.status === "review" ? null : "unscored-status";
		const matching = matchingPolicies(value as Pick<SeoContentCheck, "id" | "weight" | "severity" | "basis">, profile);
		if (!matching.length) return "policy-weight-or-basis";
		if (!matching.some((policy) => policy.outcomes.includes(value.status as SeoCheckStatus))) return "policy-status";
		if (value.id === "title" || value.id === "description") {
			if (typeof actual !== "boolean" || value.status !== (actual ? "pass" : "fail")) return "presence-evidence";
		}
		if (value.id === "url") {
			if (typeof actual !== "string" || !actual.trim() || value.status === "review") return "url-evidence";
			const syntax = canonicalUrlSyntax(actual);
			if (value.status === "pass" && (!syntax.valid || syntax.fragment)) return "url-evidence";
			// A syntactically valid URL can still fail the caller's authoritative site/route validation.
		}
		if (value.id === "image-alt-text" && (!Number.isSafeInteger(actual) || Number(actual) < 0 || value.status !== (actual === 0 ? "pass" : "fail"))) return "alt-evidence";
		// Score limits are derived from these counts, so a stored count must agree with its status.
		if (value.id === "content-depth" && (!Number.isSafeInteger(actual) || Number(actual) < 0 ||
			value.status !== contentDepthStatus(Number(actual), value.weight > 0))) return "depth-evidence";
		if (value.id === "keyword-repetition" && (!Number.isSafeInteger(actual) || Number(actual) < 0 ||
			(value.status === "fail" && Number(actual) < REPETITION_MINIMUM_USES))) return "repetition-evidence";
	}
	return null;
}

const TITLE_LIMITATION =
	"Measures the resolved title suggestion. EmDash leaves the served <title> element to the site template, which this analysis does not observe. Google may show a different title.";
const DESCRIPTION_LIMITATION =
	"Measures the meta description resolved from saved values. The served tag and the snippet a search engine displays are not observed. Google often builds the snippet from page text.";
const SAVED_BODY_LIMITATION = "Only the saved body is analyzed; content added by the site template is not observed.";

export function analyzeSeoContent(input: SeoAnalysisInput): SeoAnalysisResult {
	if (!isCollectionAnalysisProfileSelection(input.assessmentProfile))
		throw new Error("An explicit assessment profile is required for analysis.");
	const profile = input.assessmentProfile.profile;
	const title = input.title.trim();
	const description = input.description.trim();
	const url = input.url.trim();
	const image = input.image?.trim() ?? "";
	const featuredImage = input.featuredImage?.trim() ?? "";
	// A keyword with nothing left to match, such as only symbols or emoji, is no keyword at all.
	const matchable = (keyword: string | undefined) => keyword !== undefined && normaliseSeoKeywordText(keyword) !== "";
	const configuredKeywords = input.focusKeywords?.map((keyword) => keyword.trim()).filter(matchable) ?? [];
	const legacyKeyword = cleanOptional(input.focusKeyword);
	const focusKeyword = configuredKeywords[0] ?? (matchable(legacyKeyword) ? legacyKeyword : undefined);
	const focusKeywords = configuredKeywords.length ? configuredKeywords : focusKeyword ? [focusKeyword] : [];
	const signals = extractSeoDocumentSignals(input.document, input.body, url, input.contentImages);
	const article = profile === "article";
	const templateBody = input.bodySource?.trim() === "template";
	const titleSource = metadataSourceLabel("title", input.titleSource);
	const descriptionSource = metadataSourceLabel("description", input.descriptionSource);
	const titleFit = title ? seoSnippetFit(title, "title") : [];

	const rawChecks: SeoContentCheck[] = [
		metadataPresenceCheck("title", title, titleSource),
		metadataPresenceCheck("description", description, descriptionSource),
		focusKeywordConfiguredCheck(focusKeyword),
		titleFitCheck(title, titleFit, titleSource),
		descriptionFitCheck(description, descriptionSource, input.descriptionSource === "generated", input.nosnippet === true, input.descriptionPrefix ?? ""),
		indexabilityCheck(input.noindex, input.publicationStatus, input.noindexSources ?? []),
		canonicalUrlCheck(url, input.canonicalStatus),
		...canonicalPreferenceChecks(url, input.canonicalStatus),
		socialImageCheck(image, input.imageSource),
		...socialImageFallbackChecks(image, input.imageSource),
		featuredImageCheck(featuredImage, article),
		...imageAltTextChecks(signals, input.imageSeoEnabled === true, templateBody),
		schemaCheck(input.schemaEnabled, input.schemaPreset),
		contentDepthCheck(signals, input, article),
		headingStructureCheck(signals, input.bodySource, article),
		internalLinksCheck(signals, input.bodySource, article),
		descriptiveLinkTextCheck(signals, templateBody),
		sentenceReadabilityCheck(signals, input.bodySource),
		paragraphLengthCheck(signals, input.bodySource),
		keywordCheck(
			"keyword-title",
			"Focus keyword in title",
			focusKeyword,
			title,
			4,
			titleSource,
			"Literal phrase match in the resolved title suggestion; the served <title> set by the template is not observed.",
		),
		keywordVisibleOnPhonesCheck(focusKeyword, title, titleFit, titleSource),
		keywordCheck(
			"keyword-description",
			"Focus keyword in description",
			focusKeyword,
			description,
			3,
			descriptionSource,
			"Literal phrase match in the meta description resolved from saved values; the served tag is not observed.",
		),
		keywordSlugCheck(focusKeyword, input.slug),
		keywordIntroductionCheck(focusKeyword, signals, templateBody),
		keywordBodyCheck(focusKeyword, signals, templateBody),
		keywordRepetitionCheck(focusKeyword, signals, templateBody),
		keywordHeadingCheck(focusKeyword, signals, templateBody),
		secondaryKeywordCoverageCheck(
			focusKeywords,
			title,
			description,
			signals,
			templateBody,
		),
	];

	const bodyUnavailable = bodyEvidenceUnavailable(input, signals);
	const checks = rawChecks.map((check) => {
		if (bodyUnavailable && BODY_CHECK_IDS.has(check.id) &&
			(!check.id.startsWith("keyword-") || Boolean(focusKeyword))) {
			return unavailableCheck(check.id, check.label, check.category,
				"Saved body evidence is not observed for this entry.",
				"observed saved body content", "saved body", SAVED_BODY_LIMITATION);
		}
		return applySeoCheckPolicy(check, profile);
	});
	const { calculation, score, grade, status, coverage } = aggregateSeoChecks(checks, profile);

	return {
		scoreVersion: SEO_SCORE_VERSION,
		ref: input.ref,
		collection: input.collection,
		entryId: input.entryId,
		slug: cleanOptional(input.slug) ?? null,
		title,
		score,
		grade,
		status,
		checks,
		metrics: analysisMetrics(signals),
		...(focusKeyword ? { keyword: focusKeyword } : {}),
		url,
		sourceUpdatedAt: cleanOptional(input.sourceUpdatedAt) ?? null,
		assessmentProfile: { ...input.assessmentProfile },
		calculation,
		coverage,
	};
}

function metadataSourceLabel(field: "title" | "description", source: SeoMetadataValueSource | undefined): string {
	const subject = field === "title" ? "Resolved title suggestion" : "Resolved meta description";
	const origin =
		source === "core-seo"
			? field === "title" ? "entry SEO title" : "entry SEO description"
			: source === "template"
				? "metadata template"
				: source === "content"
					? field === "title" ? "content title" : "content excerpt or body"
					: source === "legacy-override"
						? "legacy SEO override"
						: source === "generated" && field === "description"
							? "generated from body text"
							: null;
	return origin ? `${subject}: ${origin}` : subject;
}

function focusKeywordConfiguredCheck(keyword: string | undefined): SeoContentCheck {
	const limitation = "A focus keyword is optional and used only by these checks; it is not a search engine requirement.";
	const evidence = { actual: keyword ?? null, expected: "an optional focus keyword", source: "SEO keyword profile" };
	return keyword ? {
		id: "focus-keyword", label: "Focus keyword", category: "keyword", severity: "info", status: "pass", weight: 0, basis: "measured",
		detail: `Focus keyword: "${keyword}".`, evidence, limitation, recommendation: "Choose a keyword that reflects the page topic.",
	} : {
		id: "focus-keyword", label: "Focus keyword", category: "keyword", severity: "info", status: "review", weight: 0, basis: "measured",
		detail: "No focus keyword is set, so keyword checks are not part of the score.", evidence, limitation,
		recommendation: "Add a focus keyword to check the title, description and body text for it.",
	};
}

function socialImageCheck(image: string, source: SeoMetadataValueSource | undefined): SeoContentCheck {
	return {
		id: "social-image",
		label: "Social image",
		category: "social",
		severity: "medium",
		status: image ? "pass" : "review",
		weight: 8,
		basis: "measured",
		detail: !image ? "No social image is set for this entry or the site."
			: source === "site-default" ? "This entry shares the site-wide social image."
			: source === "content" ? "This entry shares its featured image."
			: "A social image is set for this entry.",
		evidence: {
			actual: image || null,
			expected: "an entry image or site-wide Open Graph fallback",
			source: "entry SEO image, featured image or site fallback",
		},
		limitation: "Checks that an image URL is set from saved values; reachability, dimensions and crops are not checked.",
		recommendation: image
			? "Verify the image remains readable when cropped to common social preview ratios."
			: "Add a social image for this entry or a site-wide fallback image.",
	};
}

/** Emitted only when the resolver reports that the site-wide image is the only one. */
function socialImageFallbackChecks(image: string, source: SeoMetadataValueSource | undefined): SeoContentCheck[] {
	if (!image || source !== "site-default") return [];
	return [{ id: "social-image-fallback", label: "Page-specific social image", category: "social", severity: "info", status: "review", weight: 0, basis: "measured",
		detail: "This entry uses the site-wide social image.", evidence: { actual: "site-default", expected: "an image chosen for this entry", source: "resolved social image" },
		limitation: "The relevance and quality of the image are not checked.",
		recommendation: "Add an image for this page. A page-specific image is usually more relevant than a site-wide logo or banner." }];
}

function featuredImageCheck(image: string, article: boolean): SeoContentCheck {
	const limitation = "Checks that a featured image is saved; its relevance and quality are not evaluated.";
	if (!article) {
		return notApplicableCheck(
			"featured-image",
			"Featured image",
			"images",
			"A featured image is not required for this content type.",
			"a featured image when the content type uses visual listings",
			"content featured image",
			limitation,
		);
	}

	const available = image.length > 0;
	return {
		id: "featured-image",
		label: "Featured image",
		category: "images",
		severity: "medium",
		status: available ? "pass" : "review",
		weight: 4,
		basis: "measured",
		detail: available
			? "A featured image is saved for post listings and article presentation."
			: "No featured image is configured for this post.",
		evidence: {
			actual: image || null,
			expected: "a relevant featured image for post listings and article presentation",
			source: "saved featured image or image field",
		},
		limitation,
		recommendation: available
			? "Keep the featured image relevant, high quality, and distinct from decorative assets."
			: "Add a relevant featured image; configure a separate social image when the Open Graph crop needs different artwork.",
	};
}

const NOINDEX_SOURCE_LABELS: Record<SeoNoindexSource, string> = {
	"site-setting": "the site-wide noindex setting",
	"content-type-rule": "the content type noindex rule",
	"entry-seo": "the entry's SEO noindex (seo.noIndex)",
	"legacy-override": "a legacy robots override",
};
const ALL_NOINDEX_INPUTS = "site-wide noindex setting, entry SEO noindex and legacy robots override";
/** Detail text is shown to editors, so it names settings rather than stored field names. */
const NOINDEX_SOURCE_TEXT: Record<SeoNoindexSource, string> = {
	"site-setting": "the site-wide noindex setting in Indexing rules",
	"content-type-rule": "the content type rule in Indexing rules",
	"entry-seo": "this entry's SEO settings",
	"legacy-override": "an earlier robots setting",
};

/**
 * Publication comes first: a draft or scheduled entry has no public indexing
 * evidence. A published noindex is an excluded-from-search condition, never a
 * quality failure or a cap; no noindex never proves indexing. No branch carries
 * weight, so the indexing state never changes the score of the same content.
 */
function indexabilityCheck(
	noindex: boolean,
	publicationStatus: string | null | undefined,
	sources: readonly SeoNoindexSource[],
): SeoContentCheck {
	const status = cleanOptional(publicationStatus);
	const directiveSource = noindex
		? sources.length
			? sources.map((source) => NOINDEX_SOURCE_LABELS[source]).join(" and ")
			: "the effective robots setting"
		: ALL_NOINDEX_INPUTS;
	const directiveText = sources.length
		? sources.map((source) => NOINDEX_SOURCE_TEXT[source]).join(" and ")
		: "the effective robots setting";
	if (!status) {
		return unavailableCheck(
			"indexability",
			"Search indexing directive",
			"indexability",
			"The entry's publication status was not readable, so public indexing evidence is not evaluated.",
			"a readable publication status",
			"content status",
			"Without a publication status this analysis cannot tell whether the entry is public.",
			"Reload the entry and analyze it again.",
		);
	}
	if (status !== "published") {
		return {
			id: "indexability",
			label: "Search indexing directive",
			category: "indexability",
			severity: "info",
			status: "review",
			weight: 0,
			basis: "not-applicable",
			detail: `This entry is not published (${status}). Public indexing evidence applies after publication. Saved directive: ${noindex ? `noindex from ${directiveText}` : "no noindex"}.`,
			evidence: {
				actual: status,
				expected: "a published entry",
				source: "content status",
			},
			limitation: "An unpublished entry is not public; this does not predict how the published page will be indexed.",
			recommendation: "Review the indexing directive before publishing this entry.",
		};
	}
	if (noindex) {
		return {
			id: "indexability",
			label: "Excluded from search",
			category: "indexability",
			severity: "info",
			status: "review",
			weight: 0,
			basis: "measured",
			condition: "excluded-from-search",
			detail: `This published entry is marked noindex by ${directiveText}. Search engines are asked not to index it. This condition is not part of the score.`,
			evidence: {
				actual: "noindex",
				expected: "noindex only on pages intentionally kept out of search",
				source: directiveSource,
			},
			limitation: "Reports the directive resolved from saved settings; the served robots tag and search engine behavior are not observed.",
			recommendation: "If the exclusion is intended, no change is needed. Otherwise remove noindex where it is set.",
		};
	}
	return {
		id: "indexability",
		label: "Indexing directive",
		category: "indexability",
		severity: "info",
		status: "pass",
		weight: 0,
		basis: "measured",
		detail: "No noindex directive is set for this published entry.",
		evidence: {
			actual: "no noindex",
			expected: "no noindex on published pages meant for search",
			source: ALL_NOINDEX_INPUTS,
		},
		limitation: "The absence of noindex does not show that search engines can reach, crawl or index the page.",
		recommendation: "Keep noindex off while this entry is intended to appear in search.",
	};
}

/** The neutral base is only a syntax aid; it supplies no site or canonical authority. */
function canonicalUrlSyntax(url: string): { valid: boolean; absolute: boolean; fragment: boolean } {
	let absolute = false;
	try { new URL(url); absolute = true; } catch { /* A runtime-validated canonical may be relative. */ }
	try {
		const parsed = new URL(url, "https://canonical-syntax.invalid/");
		return { valid: ["http:", "https:"].includes(parsed.protocol), absolute, fragment: Boolean(parsed.hash) };
	} catch { return { valid: false, absolute, fragment: false }; }
}

function canonicalUrlCheck(url: string, status: SeoCanonicalStatus | undefined): SeoContentCheck {
	const limitation = "Uses the saved URL and supplied content-runtime validation. A neutral parsing base checks relative syntax only; the real site origin, served canonical, redirects and reachability are not observed here.";
	if (!url) return unavailableCheck("url", "Public URL", "indexability", "No public URL could be observed.", "an observed HTTP(S) URL", "saved canonical / public route", limitation);
	const syntax = canonicalUrlSyntax(url);
	// Only a supplied runtime status compared this URL with the real site origin and public route.
	const siteChecked = status !== undefined;
	if (!syntax.absolute && syntax.valid && !syntax.fragment && !siteChecked)
		return unavailableCheck("url", "Public URL", "indexability", "This relative URL has no observed runtime validation or site base.", "content-runtime validation of the relative canonical", "saved canonical / public route", limitation);
	const valid = syntax.valid && !syntax.fragment && status !== "invalid";
	return { id: "url", label: "Public URL", category: "indexability", severity: "high", status: valid ? "pass" : "fail", weight: 8, basis: "measured",
		detail: !valid
			? syntax.fragment ? "The saved URL contains a fragment." : status === "invalid" ? "The content runtime could not validate this canonical for the site and public route." : "The saved URL has unsupported syntax."
			: siteChecked ? url : "The saved absolute URL uses supported HTTP(S) syntax. Its site origin and public route were not compared.",
		evidence: { actual: url, expected: siteChecked ? "an HTTP(S) URL validated in its real site context, without a fragment" : "a supported absolute HTTP(S) URL without a fragment", source: "saved canonical / public route" },
		limitation: siteChecked ? limitation : "Checks the saved URL's own syntax only. Without runtime site context, its real origin, public route, served canonical, redirects and reachability are not compared.",
		recommendation: !valid ? "Review the saved public URL or canonical." : siteChecked ? "Review the served canonical separately." : "Confirm this URL is the entry's public page; its site context was not available here." };
}

function canonicalPreferenceChecks(url: string, status: SeoCanonicalStatus | undefined): SeoContentCheck[] {
	if (!["different-path", "off-origin"].includes(status ?? "")) return [];
	const syntax = canonicalUrlSyntax(url);
	if (!syntax.valid || syntax.fragment) return [];
	return [{ id: "canonical-policy-review", label: "Canonical preference", category: "indexability", severity: "info", status: "review", weight: 0, basis: "measured",
		detail: "The content runtime reports a canonical preference for a different path or origin.", evidence: { actual: url, expected: "an intentional canonical preference", source: "saved canonical / public route" },
		limitation: "The supplied runtime status carries the real site comparison; parsing does not independently establish origin or path intent. The served page is not observed.", recommendation: "Confirm this consolidation is intentional." }];
}

/** Body image nodes only: an image field, such as the featured image, stores its media alt or an empty string. */
function bodyImages(signals: SeoDocumentSignals): SeoDocumentSignals["images"] {
	return signals.images.filter((image) => image.source === "document" || image.source.startsWith("document[") || image.source.startsWith("document."));
}

function imageAltTextChecks(signals: SeoDocumentSignals, enabled: boolean, templateBody: boolean): SeoContentCheck[] {
	const limitation = "Saved alt attributes of images in the body are observed; image fields such as the featured image, descriptive quality, decorative intent and template-added images are not verified.";
	if (!enabled) return [notApplicableCheck("image-alt-text", "Image alt text", "images", "Image alt checks are turned off.", "saved image metadata when enabled", "saved images", limitation)];
	const images = bodyImages(signals);
	if (!images.length) return [templateBody
		? unavailableCheck("image-alt-text", "Image alt text", "images", "Template images are not observed.", "saved image metadata", "body source field: template", limitation)
		: notApplicableCheck("image-alt-text", "Image alt text", "images", "No images in the body text.", "saved image metadata", "saved body images", limitation)];
	const missing = images.filter(image => image.alt === null);
	const empty = images.filter(image => image.alt === "");
	const imageWord = (count: number) => count === 1 ? "image" : "images";
	const rows: SeoContentCheck[] = [{ id: "image-alt-text", label: "Image alt text", category: "images", severity: "medium", status: missing.length ? "fail" : "pass", weight: 6, basis: "measured",
		detail: missing.length
			? `${missing.length} of ${images.length} body ${imageWord(images.length)} ${missing.length === 1 ? "has" : "have"} no alt attribute.`
			: images.length === 1 ? "The body image has an alt attribute." : `All ${images.length} body images have an alt attribute.`,
		evidence: { actual: missing.length, expected: "an alt attribute, including explicit empty alt where appropriate", source: "saved body image nodes" },
		limitation, recommendation: missing.length ? "Add contextual alt text, or explicit empty alt for a genuinely decorative image." : "Review whether each alt value suits the image and context." }];
	if (empty.length) rows.push({ id: "image-empty-alt-review", label: "Confirm empty-alt image purpose", category: "images", severity: "info", status: "review", weight: 0, basis: "measured",
		detail: `${empty.length} body ${imageWord(empty.length)} ${empty.length === 1 ? "uses" : "use"} explicit empty alt.`, evidence: { actual: empty.length, expected: "author confirmation of decorative purpose", source: "saved body image alt attributes" }, limitation,
		recommendation: "Confirm empty alt is appropriate; do not add keywords automatically." });
	return rows;
}

/** Limits come from evaluated rows only, so an unread row can never cap a score. */
function seoScoreLimits(checks: readonly SeoContentCheck[]): SeoScoreLimit[] {
	const evaluated = (id: string) => checks.find((check) => check.id === id && isScoredSeoCheckBasis(check.basis));
	const limits: SeoScoreLimit[] = [];
	if (evaluated("title")?.status === "fail") limits.push({ reason: "missing-title", cap: 49, checkIds: ["title"] });
	const depth = evaluated("content-depth");
	if (depth && depth.weight > 0 && typeof depth.evidence.actual === "number") {
		if (depth.evidence.actual < 50) limits.push({ reason: "severely-thin-content", cap: 40, checkIds: ["content-depth"] });
		else if (depth.evidence.actual < 600) limits.push({ reason: "thin-content", cap: 70, checkIds: ["content-depth"] });
	}
	if (evaluated("keyword-repetition")?.status === "fail")
		limits.push({ reason: "keyword-repetition", cap: 79, checkIds: ["keyword-repetition"] });
	const keywordRows = ["keyword-title", "keyword-description", "keyword-content"];
	if (keywordRows.every((id) => evaluated(id)?.status === "fail"))
		limits.push({ reason: "missing-primary-keyword", cap: 79, checkIds: keywordRows });
	return limits.sort((left, right) => left.cap - right.cap);
}

export function calculateSeoScore(checks: readonly SeoContentCheck[], profile?: CollectionAnalysisProfile): SeoScoreCalculation {
	const seen = new Set<string>();
	for (const check of checks) {
		const problem = seoContentCheckProblem(check, true, profile);
		if (problem) throw new Error(`Invalid current check ${check.id}: ${problem}`);
		if (seen.has(check.id)) throw new Error(`Duplicate current check: ${check.id}`);
		seen.add(check.id);
	}
	const eligible = checks.filter(check => classifySeoContentCheck(check, profile).eligible);
	const totalWeight = eligible.reduce((sum, check) => sum + check.weight, 0);
	// Hundredths keep the earned share exact, so a half rounds up instead of a float artifact rounding down.
	const earnedHundredths = eligible.reduce((sum, check) => sum + check.weight * (check.status === "pass" ? 100 : check.status === "review" ? 35 : 0), 0);
	const earnedWeight = earnedHundredths / 100;
	const rawScore = totalWeight ? Math.round(earnedHundredths / totalWeight) : 0;
	const limits = seoScoreLimits(checks);
	const limit = limits[0] ?? null;
	return { earnedWeight, totalWeight, rawScore, score: limit ? Math.min(rawScore, limit.cap) : rawScore, reviewCredit: 0.35, limit, limits };
}

function cleanOptional(value: unknown): string | undefined {
	const cleaned = typeof value === "string" ? value.trim() : "";
	return cleaned || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fitEvidence(fits: readonly SeoSnippetDeviceFit[]): string {
	return fits.map((fit) => `${SEO_SNIPPET_DEVICE_LABELS[fit.device]}: ${fit.clipped ? `cut after "${seoSnippetCutPoint(fit.visible)}"` : "fits"}`).join("; ");
}

function cutPlaces(fits: readonly SeoSnippetDeviceFit[]): string {
	return fits.filter((fit) => fit.clipped)
		.map((fit) => `on ${SEO_SNIPPET_DEVICE_LABELS[fit.device]} after "${seoSnippetCutPoint(fit.visible)}"`)
		.join(" and ");
}

function titleFitCheck(title: string, fits: readonly SeoSnippetDeviceFit[], source: string): SeoContentCheck {
	const label = "Title fit";
	const expected = "fits in the phone and desktop previews (estimate)";
	const limitation = `${SEO_SNIPPET_ESTIMATE_NOTE} Google sets no title length limit, shortens titles to fit the screen and may show a different title.`;
	if (!title) return notApplicableCheck("title-display-length", label, "metadata", "No title to fit.", expected, source, limitation);
	const clipped = fits.some((fit) => fit.clipped);
	return { id: "title-display-length", label, category: "metadata", severity: "info", status: clipped ? "review" : "pass", weight: 0, basis: "heuristic",
		detail: clipped ? `Estimate: may be cut off ${cutPlaces(fits)}.` : "Estimate: fits in the phone and desktop previews.",
		evidence: { actual: fitEvidence(fits), expected, source }, limitation,
		recommendation: clipped
			? "Put the words that matter first, or shorten the title. This is a checklist guideline, not a Google limit."
			: "Keep the title unique and specific to this page." };
}

function descriptionFitCheck(description: string, source: string, generated: boolean, nosnippet: boolean, prefix: string): SeoContentCheck {
	const label = "Description fit";
	const expected = "a written description that fits in the phone and desktop previews (estimate)";
	const limitation = `${SEO_SNIPPET_ESTIMATE_NOTE} Google sets no description length limit and often builds the snippet from page text instead.${
		prefix.trim() ? " The publication date the preview shows before the description is measured too." : ""}`;
	if (!description) return notApplicableCheck("description-display-length", label, "metadata", "No description to fit.", expected, source, limitation);
	if (nosnippet) return notApplicableCheck("description-display-length", label, "metadata", "This entry sets nosnippet, so search results show no text snippet.", expected, source, limitation);
	if (generated) {
		return { id: "description-display-length", label, category: "metadata", severity: "info", status: "review", weight: 0, basis: "heuristic",
			detail: "This description is generated from the body text, so its fit is not estimated.",
			evidence: { actual: "generated from body text", expected, source }, limitation,
			recommendation: "Write a description for this page." };
	}
	const fits = seoSnippetFit(description, "description", prefix);
	const clipped = fits.some((fit) => fit.clipped);
	return { id: "description-display-length", label, category: "metadata", severity: "info", status: clipped ? "review" : "pass", weight: 0, basis: "heuristic",
		detail: clipped
			? `Estimate: if Google uses this description, it may be cut off ${cutPlaces(fits)}.`
			: "Estimate: fits in the phone and desktop previews if Google uses it.",
		evidence: { actual: fitEvidence(fits), expected, source }, limitation,
		recommendation: clipped
			? "Keep the main point early. This is a checklist guideline, not a Google limit."
			: "Keep the description unique and specific to this page." };
}

function schemaCheck(enabled: boolean, preset: string): SeoContentCheck {
	return { id: "schema", label: "Schema configuration", category: "schema", severity: "info", status: enabled ? "pass" : "review", weight: 0, basis: "measured",
		detail: enabled ? `Saved settings add ${preset} schema to this page.` : "No schema graph is predicted from saved settings.", evidence: { actual: enabled ? preset : "None", expected: "applicable optional schema configuration", source: "saved schema settings" },
		limitation: "Other schema, served JSON-LD validity and rich-result eligibility are not observed.", recommendation: "Review applicable schema against the visible page; absence of a prediction is not a ranking failure." };
}

/** Shipit guidance: article 600+ words pass, 300-599 partly met, under 300 fail; general under 100 is a suggestion. */
function contentDepthStatus(words: number, article: boolean): SeoCheckStatus {
	if (!article) return words >= 100 ? "pass" : "review";
	return words >= 600 ? "pass" : words >= 300 ? "review" : "fail";
}

function contentDepthCheck(signals: SeoDocumentSignals, input: SeoAnalysisInput, article: boolean): SeoContentCheck {
	const label = "Body text length";
	const limitation = "Counts words in the saved body only; text the site template adds is not observed. Word targets are checklist guidelines.";
	const expected = article
		? "600 or more words of body text (checklist guideline)"
		: "100 or more words of body text (checklist guideline; not scored for general content)";
	if (bodyEvidenceUnavailable(input, signals)) return unavailableCheck("content-depth", label, "content", "Saved body text is not observed.", expected, "saved body", SAVED_BODY_LIMITATION);
	const words = signals.wordCount;
	const status = contentDepthStatus(words, article);
	// Unread blocks can only add words, so they leave a passing count standing.
	if (status !== "pass" && signals.unsupportedBlockCount > 0) {
		return unavailableCheck("content-depth", label, "content",
			`${words} ${words === 1 ? "word" : "words"} read. Some blocks in this body are not read, for example custom blocks, so body text length is not checked.`,
			expected, "saved body text", limitation, "Check the body text length on the rendered page.");
	}
	const count = `${words} ${words === 1 ? "word" : "words"}`;
	const detail = status === "pass"
		? `${count} of body text.`
		: words === 0
			? "No body text was found."
			: article
				? `Body text: ${count}. This checklist suggests at least 600 words for articles.`
				: `Short body text: ${count}. Short pages such as contact or product pages can be fine. Only text saved in this entry's body is counted.`;
	return { id: "content-depth", label, category: "content", severity: article ? "medium" : "info", status, weight: article ? 10 : 0, basis: "measured",
		detail, evidence: { actual: words, expected, source: "saved body text" }, limitation,
		recommendation: status === "pass" ? "Keep the body text focused on what readers need." : "Add text only where it helps readers with this page's topic." };
}

/** No structured data: an empty body has nothing to evaluate, a plain body lacks the evidence. */
function unstructuredBodyCheck(
	signals: SeoDocumentSignals,
	id: string,
	label: string,
	category: SeoCheckCategory,
	subject: string,
	limitation: string,
): SeoContentCheck {
	return signals.wordCount === 0
		? notApplicableCheck(id, label, category, "No saved body text was extracted.", subject, "content body", limitation)
		: unavailableCheck(id, label, category, `Structured ${subject} data is not available for this body.`, `structured ${subject}`, "content body", limitation);
}

/** General content below this many words needs no section headings. */
const SECTION_HEADING_MIN_WORDS = 300;

function headingStructureCheck(
	signals: SeoDocumentSignals,
	bodySource: string | undefined,
	article: boolean,
): SeoContentCheck {
	const limitation =
		"Counts headings in the saved body only. The rendered page's heading structure, including any H1 the template adds, is not observed.";
	if (bodySource?.trim() === "template") {
		return unavailableCheck(
			"heading-structure",
			"Heading structure",
			"content",
			"Template-managed page; its headings come from the template and are not observed.",
			"rendered template headings",
			"body source field: template",
			limitation,
		);
	}
	if (signals.bodyFormat === "plain-text") {
		return notApplicableCheck(
			"heading-structure",
			"Heading structure",
			"content",
			"This body is plain text, which cannot hold headings.",
			"headings in a body format that supports them",
			"content body",
			limitation,
		);
	}
	if (!signals.structured) {
		return unstructuredBodyCheck(signals, "heading-structure", "Heading structure", "content", "heading", limitation);
	}

	const sectionHeadings = signals.headings.filter((heading) => heading.level >= 2).length;
	const needsSections = article || signals.wordCount >= SECTION_HEADING_MIN_WORDS;
	const bodyH1 = signals.h1Count > 0;
	if (!needsSections && !sectionHeadings && !bodyH1) {
		return notApplicableCheck(
			"heading-structure",
			"Heading structure",
			"content",
			`Short general content: under ${SECTION_HEADING_MIN_WORDS} words without section headings.`,
			`section headings from ${SECTION_HEADING_MIN_WORDS} words of general content`,
			"saved body headings",
			limitation,
		);
	}
	const missingSections = needsSections && sectionHeadings === 0;
	const status: SeoCheckStatus = bodyH1 || missingSections ? "review" : "pass";
	const h1Detail = bodyH1
		? `${signals.h1Count} H1 heading${signals.h1Count === 1 ? "" : "s"} in the saved body. Whether the rendered page also shows a title H1 is not observed.`
		: "";
	const sectionDetail = missingSections
		? "No H2-H6 section headings were found."
		: `${sectionHeadings} section heading${sectionHeadings === 1 ? "" : "s"}${bodyH1 ? "." : "; no H1 in the saved body."}`;
	return {
		id: "heading-structure",
		label: "Heading structure",
		category: "content",
		severity: "medium",
		status,
		weight: 6,
		basis: "heuristic",
		detail: [h1Detail, sectionDetail].filter(Boolean).join(" "),
		evidence: {
			actual: `H1 ${signals.h1Count}; H2-H6 ${sectionHeadings}`,
			expected: "descriptive H2-H6 sections for long-form content and one main H1 on the rendered page",
			source: "saved body headings",
		},
		limitation,
		recommendation: bodyH1
			? "Check the rendered page keeps one main H1. If the template already shows the title as H1, change body H1 headings to H2."
			: missingSections
				? "Break the main topic into descriptive H2 sections and use H3 only for nested subsections."
				: "Keep heading levels sequential and describe the section that follows.",
	};
}

function internalLinksCheck(
	signals: SeoDocumentSignals,
	bodySource: string | undefined,
	article: boolean,
): SeoContentCheck {
	const limitation =
		"Counts links in the saved body to other pages on this site. Fragment-only links and links to this entry are excluded; menu, footer and template links are not observed.";
	if (bodySource?.trim() === "template") {
		return unavailableCheck(
			"internal-links",
			"Internal links",
			"links",
			"Template-managed page; its links come from the template and are not observed.",
			"rendered template links",
			"body source field: template",
			limitation,
		);
	}
	if (signals.bodyFormat === "plain-text") {
		return notApplicableCheck(
			"internal-links",
			"Internal links",
			"links",
			"This body is plain text, which cannot hold links.",
			"links in a body format that supports them",
			"content body",
			limitation,
		);
	}
	if (signals.bodyFormat !== "structured") {
		return unstructuredBodyCheck(signals, "internal-links", "Internal links", "links", "link", limitation);
	}

	const count = signals.internalLinkCount;
	const status: SeoCheckStatus = count >= 1 ? "pass" : article ? "fail" : "review";
	return {
		id: "internal-links",
		label: "Internal links",
		category: "links",
		severity: "low",
		status,
		weight: 5,
		basis: "heuristic",
		detail: count >= 1
			? `${count} ${count === 1 ? "link" : "links"} to other pages on this site in the body text.`
			: "No links to other pages on this site in the body text. Links in menus and footers are not counted.",
		evidence: {
			actual: count,
			expected: "at least one link to another page on this site",
			source: "structured content links",
		},
		limitation,
		recommendation: count >= 1
			? "Keep internal links relevant to the reader's next question."
			: "Link to a related page on this site using descriptive link text.",
	};
}

function descriptiveLinkTextCheck(signals: SeoDocumentSignals, templateBody: boolean): SeoContentCheck {
	const limitation =
		"Matches a fixed list of generic phrases such as click here, read more and learn more. Whether other link text describes its destination is not evaluated.";
	if (templateBody) {
		return unavailableCheck(
			"descriptive-link-text",
			"Link text",
			"links",
			"Template-managed page; its links come from the template and are not observed.",
			"link labels on the rendered page",
			"body source field: template",
			limitation,
		);
	}
	if (signals.bodyFormat === "plain-text") {
		return notApplicableCheck(
			"descriptive-link-text",
			"Link text",
			"links",
			"This body is plain text, which cannot hold links.",
			"no generic link labels when links are added",
			"content body",
			limitation,
		);
	}
	if (!signals.structured) {
		return unstructuredBodyCheck(signals, "descriptive-link-text", "Link text", "links", "link", limitation);
	}
	if (signals.links.length === 0) {
		return notApplicableCheck(
			"descriptive-link-text",
			"Link text",
			"links",
			"No links are present to evaluate.",
			"no generic link labels when links are added",
			"structured content links",
			limitation,
		);
	}

	const total = signals.links.length;
	const generic = signals.genericLinkCount;
	const status: SeoCheckStatus = generic === 0 ? "pass" : "review";
	return {
		id: "descriptive-link-text",
		label: "Link text",
		category: "links",
		severity: "low",
		status,
		weight: 3,
		basis: "measured",
		detail: status === "pass"
			? `None of the ${total} saved body link${total === 1 ? "" : "s"} use${total === 1 ? "s" : ""} an empty label or a listed generic phrase.`
			: `${generic} of ${total} saved body link${total === 1 ? "" : "s"} use an empty label or a listed generic phrase.`,
		evidence: {
			actual: generic,
			expected: "no links labelled only with an empty label or a listed generic phrase",
			source: "structured content links",
		},
		limitation,
		recommendation: status === "pass"
			? "Keep anchor text concise and specific to its destination."
			: "Replace generic labels with text that explains the destination or action.",
	};
}

function sentenceReadabilityCheck(signals: SeoDocumentSignals, bodySource: string | undefined): SeoContentCheck {
	const limitation = "Average sentence length is a directional readability signal written for English (checklist guideline); meaning, audience and clarity are not evaluated.";
	if (bodySource?.trim() === "template") {
		return unavailableCheck(
			"sentence-readability",
			"Sentence length",
			"readability",
			"Template-managed page; readability must be reviewed in rendered sections.",
			"at least 60 prose words and three sentence segments",
			"body source field: template",
			limitation,
		);
	}
	if (signals.proseWordCount < 60 || signals.sentenceCount < 3 || signals.averageSentenceWords === null) {
		return notApplicableCheck(
			"sentence-readability",
			"Sentence length",
			"readability",
			"Not enough prose for a reliable directional check; at least 60 prose words and three sentence segments are required.",
			"at least 60 prose words and three sentence segments",
			"body prose paragraphs",
			limitation,
		);
	}

	const average = signals.averageSentenceWords;
	const status: SeoCheckStatus = average <= 25 ? "pass" : "review";
	return {
		id: "sentence-readability",
		label: "Sentence length",
		category: "readability",
		severity: "medium",
		status,
		weight: 4,
		basis: "heuristic",
		detail: `Average sentence length is ${average} words across ${signals.sentenceCount} sentence segments in ${signals.proseWordCount} prose words.`,
		evidence: {
			actual: average,
			expected: "25 words or fewer on average; at least 60 prose words and three sentence segments",
			source: "body prose paragraphs",
		},
		limitation,
		recommendation: status === "pass"
			? "Keep sentence length varied and prioritize clarity over a mechanical target."
			: "Split dense sentences where doing so improves comprehension; do not shorten technical terms or necessary context.",
	};
}

function paragraphLengthCheck(signals: SeoDocumentSignals, bodySource: string | undefined): SeoContentCheck {
	const limitation = "Paragraph length is a directional readability signal written for English (checklist guideline); whether a paragraph is clear is not evaluated.";
	if (bodySource?.trim() === "template") {
		return unavailableCheck(
			"paragraph-length",
			"Paragraph length",
			"readability",
			"Template-managed page; paragraph length must be reviewed in rendered sections.",
			"structured paragraph boundaries",
			"body source field: template",
			limitation,
		);
	}
	if (signals.paragraphCount === 0) {
		return notApplicableCheck(
			"paragraph-length",
			"Paragraph length",
			"readability",
			"The saved body has no paragraphs to evaluate.",
			"structured paragraph boundaries",
			"content body",
			limitation,
		);
	}

	const longest = signals.longestParagraphWords;
	const status: SeoCheckStatus = longest <= 120 ? "pass" : "review";
	return {
		id: "paragraph-length",
		label: "Paragraph length",
		category: "readability",
		severity: "low",
		status,
		weight: 3,
		basis: "heuristic",
		detail: `Longest paragraph is ${longest} words across ${signals.paragraphCount} paragraphs.`,
		evidence: {
			actual: longest,
			expected: "no paragraph longer than 120 words",
			source: signals.structured ? "structured content paragraphs" : "plain-text paragraphs",
		},
		limitation,
		recommendation: status === "pass"
			? "Keep each paragraph focused on one idea."
			: "Split the longest paragraph at a natural idea boundary and add a subheading when the topic changes.",
	};
}

function keywordCheck(
	id: string,
	label: string,
	keyword: string | undefined,
	text: string | readonly string[],
	weight: number,
	source: string,
	limitation: string,
): SeoContentCheck {
	if (!keyword) {
		return notApplicableCheck(
			id,
			label,
			"keyword",
			"No focus keyword is set.",
			"an optional focus keyword",
			source,
			limitation,
		);
	}
	const found = typeof text === "string"
		? seoTextContainsKeyword(text, keyword)
		: text.some((segment) => seoTextContainsKeyword(segment, keyword));
	const missingField = typeof text === "string" && !text.trim()
		? id === "keyword-title" ? "title" : id === "keyword-description" ? "description" : null
		: null;
	return {
		id,
		label,
		category: "keyword",
		severity: "low",
		status: found ? "pass" : "fail",
		weight,
		basis: "measured",
		detail: found
			? `Contains "${keyword}".`
			: missingField ? `No ${missingField} resolves, so it does not contain "${keyword}".` : `Does not contain "${keyword}".`,
		evidence: {
			actual: found,
			expected: `natural use of "${keyword}"`,
			source,
		},
		limitation,
		recommendation: found
			? "Keep the phrase natural and avoid repetition for scoring alone."
			: `Use "${keyword}" naturally only if it accurately reflects the page intent.`,
	};
}

function keywordIntroductionCheck(keyword: string | undefined, signals: SeoDocumentSignals, templateBody: boolean): SeoContentCheck {
	const label = "Focus keyword in introduction";
	const limitation = "Literal phrase match in the first 120 words of the saved body.";
	if (keyword && templateBody) {
		return unavailableCheck(
			"keyword-introduction",
			label,
			"keyword",
			"Template-managed page; its introduction comes from the template and is not observed.",
			`natural use of "${keyword}" in the introduction`,
			"body source field: template",
			limitation,
		);
	}
	if (keyword && signals.proseWordCount === 0) {
		return notApplicableCheck("keyword-introduction", label, "keyword", "No body text to check.",
			`natural use of "${keyword}" in the introduction`, "first 120 content words", limitation);
	}
	return keywordCheck(
		"keyword-introduction",
		label,
		keyword,
		signals.introductionBlocks,
		3,
		"first 120 content words",
		limitation,
	);
}

function keywordVisibleOnPhonesCheck(
	keyword: string | undefined,
	title: string,
	fits: readonly SeoSnippetDeviceFit[],
	titleSource: string,
): SeoContentCheck {
	const label = "Focus keyword visible on phones";
	const expected = keyword ? `"${keyword}" before the phone cut point (estimate)` : "a focus keyword in the title";
	const limitation = `${SEO_SNIPPET_ESTIMATE_NOTE} Google may show a different title.`;
	if (!keyword) return notApplicableCheck("keyword-title-position", label, "keyword", "No focus keyword is set.", expected, titleSource, limitation);
	if (!seoTextContainsKeyword(title, keyword))
		return notApplicableCheck("keyword-title-position", label, "keyword", "The focus keyword is not in the title.", expected, titleSource, limitation);
	const phone = fits.find((fit) => fit.device === "mobile");
	const visible = !phone || seoTextContainsKeyword(phone.visible, keyword);
	return {
		id: "keyword-title-position",
		label,
		category: "keyword",
		severity: "info",
		status: visible ? "pass" : "review",
		weight: 0,
		basis: "heuristic",
		detail: visible
			? `Estimate: "${keyword}" is visible in the title on phones.`
			: `Estimate: phones may cut the title after "${seoSnippetCutPoint(phone?.visible ?? "")}", before the focus keyword.`,
		evidence: {
			actual: visible ? "visible" : "cut before the keyword",
			expected,
			source: titleSource,
		},
		limitation,
		recommendation: visible
			? "Keep the title readable and aligned with the page intent."
			: `Move "${keyword}" earlier only if the title stays natural.`,
	};
}

function keywordBodyCheck(keyword: string | undefined, signals: SeoDocumentSignals, templateBody: boolean): SeoContentCheck {
	const label = "Focus keyword in body text";
	const limitation =
		"Counts literal phrase uses in the saved body text, headings included; presence is coaching, not semantic relevance or a ranking requirement.";
	if (!keyword) {
		return keywordCheck(
			"keyword-content",
			label,
			undefined,
			"",
			3,
			"content body paragraphs",
			limitation,
		);
	}
	if (templateBody) {
		return unavailableCheck(
			"keyword-content",
			label,
			"keyword",
			"Template-managed page; its body copy comes from the template and is not observed.",
			`natural use of "${keyword}" in body copy`,
			"body source field: template",
			limitation,
		);
	}

	const occurrences = bodyKeywordOccurrences(keyword, signals);
	const status: SeoCheckStatus = occurrences === 0 ? "fail" : "pass";

	return {
		id: "keyword-content",
		label,
		category: "keyword",
		severity: "low",
		status,
		weight: 3,
		basis: "heuristic",
		detail: occurrences
			? `The focus keyword appears ${occurrences} ${occurrences === 1 ? "time" : "times"} in the body text.`
			: signals.wordCount === 0 ? "No body text was found." : `The body text does not contain "${keyword}".`,
		evidence: {
			actual: occurrences,
			expected: `natural use of the selected target "${keyword}"`,
			source: "saved body text",
		},
		limitation,
		recommendation: "Use the target naturally where it reflects the intended topic; literal matching does not understand synonyms or relevance.",
	};
}

function keywordHeadingCheck(keyword: string | undefined, signals: SeoDocumentSignals, templateBody: boolean): SeoContentCheck {
	const limitation = "Literal phrase match in saved body section headings; headings added by the template are not observed.";
	if (!keyword) return keywordCheck("keyword-heading", "Focus keyword in subheading", undefined, "", 2, "structured content headings", limitation);
	const expected = `natural use of "${keyword}" in a relevant section heading`;
	if (!templateBody && signals.bodyFormat === "plain-text") {
		return notApplicableCheck(
			"keyword-heading",
			"Focus keyword in subheading",
			"keyword",
			"This body is plain text, which cannot hold headings.",
			expected,
			"content body",
			limitation,
		);
	}
	if (templateBody || (!signals.structured && signals.wordCount > 0)) {
		return unavailableCheck(
			"keyword-heading",
			"Focus keyword in subheading",
			"keyword",
			templateBody
				? "Template-managed page; its headings come from the template and are not observed."
				: "Structured headings are not available for this body.",
			expected,
			templateBody ? "body source field: template" : "structured content headings",
			limitation,
		);
	}
	const sectionHeadings = signals.headings.filter((heading) => heading.level >= 2);
	if (sectionHeadings.length === 0) {
		return notApplicableCheck(
			"keyword-heading",
			"Focus keyword in subheading",
			"keyword",
			"The saved body has no section headings to evaluate.",
			expected,
			"structured content headings",
			limitation,
		);
	}
	return keywordCheck(
		"keyword-heading",
		"Focus keyword in subheading",
		keyword,
		sectionHeadings.map((heading) => heading.text),
		2,
		"structured content headings",
		limitation,
	);
}

/**
 * Secondary keywords give unweighted coverage advice only; they must never
 * multiply the per-keyword checks the primary keyword drives.
 */
function secondaryKeywordCoverageCheck(
	focusKeywords: readonly string[],
	title: string,
	description: string,
	signals: SeoDocumentSignals,
	templateBody: boolean,
): SeoContentCheck {
	const limitation =
		"Literal phrase matches in the title suggestion, meta description and saved body; content added by the template is not observed.";
	const secondaries = focusKeywords.slice(1);
	if (secondaries.length === 0) {
		return notApplicableCheck(
			"secondary-keyword-coverage",
			"Secondary keywords",
			"keyword",
			"No secondary keywords are configured.",
			"optional supporting keywords, each covered somewhere in the page",
			"analysis profile keywords",
			limitation,
		);
	}
	const searchable = [
		title,
		description,
		...(templateBody ? [] : [...signals.proseBlocks, ...signals.headings.map((heading) => heading.text)]),
	];
	const missing = secondaries.filter(
		(keyword) => !searchable.some((segment) => seoTextContainsKeyword(segment, keyword)),
	);
	const covered = secondaries.length - missing.length;
	if (templateBody && missing.length > 0) {
		return unavailableCheck(
			"secondary-keyword-coverage", "Secondary keywords", "keyword",
			`${covered} of ${secondaries.length} secondary keywords appear in saved metadata. The template body is not observed, so whole-page coverage is not evaluated.`,
			"secondary keyword coverage in the rendered page", "resolved metadata / body source field: template", limitation,
			"Review secondary coverage on the rendered page; do not add phrases for scoring alone.",
		);
	}
	return {
		id: "secondary-keyword-coverage",
		label: "Secondary keywords",
		category: "keyword",
		severity: "low",
		status: missing.length === 0 ? "pass" : "review",
		weight: 2,
		basis: "measured",
		detail:
			missing.length === 0
				? `All ${secondaries.length} secondary ${secondaries.length === 1 ? "keyword appears" : "keywords appear"} in ${templateBody ? "resolved metadata" : "the saved content or metadata"}.`
				: `${covered} of ${secondaries.length} secondary keywords appear; missing: ${missing.map((keyword) => `"${keyword}"`).join(", ")}.`,
		evidence: {
			actual: `${covered}/${secondaries.length} covered`,
			expected: "each secondary keyword used naturally somewhere in the title, description, body, or headings",
			source: templateBody ? "analysis profile keywords / resolved metadata" : "analysis profile keywords",
		},
		limitation,
		recommendation:
			missing.length === 0
				? "Keep secondary phrases natural; coverage is feedback, not a ranking target."
				: "Work missing secondary keywords into the copy only where they genuinely fit the page intent, or remove them from the profile.",
	};
}

/** A check that does not apply to this entry: no weight, never a pass or failure in summaries. */
function notApplicableCheck(
	id: string,
	label: string,
	category: SeoCheckCategory,
	detail: string,
	expected: string,
	source: string,
	limitation: string,
): SeoContentCheck {
	return {
		id,
		label,
		category,
		severity: "info",
		status: "review",
		weight: 0,
		basis: "not-applicable",
		detail,
		evidence: { actual: null, expected, source },
		limitation,
		recommendation: "No action is required; add this element only when it improves the reader's path.",
	};
}

/** A check whose evidence was not observed: no weight, always a manual review. */
function unavailableCheck(
	id: string,
	label: string,
	category: SeoCheckCategory,
	detail: string,
	expected: string,
	source: string,
	limitation: string,
	recommendation = "Review this on the rendered page; this analysis cannot observe it.",
): SeoContentCheck {
	return {
		id,
		label,
		category,
		severity: "info",
		status: "review",
		weight: 0,
		basis: "unavailable",
		detail,
		evidence: { actual: null, expected, source },
		limitation,
		recommendation,
	};
}

function analysisMetrics(signals: SeoDocumentSignals): SeoAnalysisMetrics {
	return {
		wordCount: signals.wordCount,
		sentenceCount: signals.sentenceCount,
		averageSentenceWords: signals.averageSentenceWords,
		paragraphCount: signals.paragraphCount,
		longestParagraphWords: signals.longestParagraphWords,
		headingCount: signals.headings.length,
		h1Count: signals.h1Count,
		internalLinkCount: signals.internalLinkCount,
		externalLinkCount: signals.externalLinkCount,
		genericLinkCount: signals.genericLinkCount,
		imageCount: signals.imageCount,
		imageAltCount: signals.imageAltCount,
		imageDecorativeCount: signals.imageDecorativeCount,
		imageMissingAltCount: signals.imageMissingAltCount,
		structured: signals.structured,
	};
}
