import type {
	SeoAdminAnalysisProfile,
	SeoAdminCollectionAnalysisProfileSelection,
	SeoAdminEntryPreview,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	analyzeSeoContent,
	aggregateSeoChecks,
	isScoredSeoCheckBasis,
	type SeoAnalysisResult,
	type SeoContentCheck,
} from "../analysis.ts";
import {
	contentBodyValue,
	contentImageInputs,
	featuredImageFromContentData,
	keywordFromContent,
} from "../content-analysis-inputs.ts";
import { SEO_ADMIN_OWNERSHIP_FIELDS } from "../admin-contract.ts";
import { extractSeoDocumentText } from "../document-signals.ts";
import { focusKeywordsValidationError, normaliseFocusKeywords } from "../focus-keyword.ts";
import { seoSnippetDatePrefix } from "../snippet-fit.ts";
import { savedSnapshotMatches, type SavedContentSnapshot } from "./saved-content-snapshot.ts";

export interface EditorBasicKeywordInput {
	snapshot: SavedContentSnapshot | null;
	ref: string;
	sourceVersion: string;
	profile: SeoAdminAnalysisProfile | null;
	profileReady: boolean;
	/** Undefined uses the saved profile; null retains content inheritance. */
	keywords?: readonly string[] | null;
}

export interface EditorBasicKeywordOwnership {
	display: string[];
	inherited: boolean;
}

export interface EditorBasicAnalysisInput extends EditorBasicKeywordInput {
	preview: SeoAdminEntryPreview | null;
	locale: string | null;
	assessment: SeoAdminCollectionAnalysisProfileSelection | null;
	assessmentReady: boolean;
	publicationStatus: string | null;
	pillar?: boolean;
	/**
	 * Read only when the preview has no `analysis` settings, as from a server
	 * that predates them. Omit when this feature's saved state has not been read.
	 */
	imageSeoEnabled?: boolean;
}

interface EditorBasicAnalysisContext {
	profileSource: "configured" | "default";
	/** The profile names the assessment profile control and stored results use. */
	profileLabel: "Article" | "General content" | null;
	keywordOwnership: EditorBasicKeywordOwnership;
	sourceVersion: string;
	locale: string | null;
}

export type EditorPartialAnalysisResult = Omit<SeoAnalysisResult, "score" | "status" | "grade" | "calculation" | "coverage" | "assessmentProfile"> & {
	assessmentProfile?: SeoAnalysisResult["assessmentProfile"];
};

export type EditorBasicAnalysis =
	| (EditorBasicAnalysisContext & { state: "ready"; result: SeoAnalysisResult })
	| (EditorBasicAnalysisContext & { state: "partial"; result: EditorPartialAnalysisResult; reason: string })
	| { state: "unavailable"; reason: string };

function snapshotMatches(input: EditorBasicKeywordInput): input is EditorBasicKeywordInput & { snapshot: SavedContentSnapshot } {
	return Boolean(input.sourceVersion && input.snapshot?.ref === input.ref &&
		input.snapshot.sourceVersion === input.sourceVersion);
}

/** Null means the saved keyword owner or inherited content could not be read. */
export function resolveEditorBasicKeywordOwnership(input: EditorBasicKeywordInput): EditorBasicKeywordOwnership | null {
	if (!input.profileReady || (input.profile && input.profile.ref !== input.ref)) return null;
	const statement = input.keywords === undefined ? input.profile?.keywords ?? null : input.keywords;
	if (statement !== null) {
		if (focusKeywordsValidationError(statement) !== null) return null;
		return { display: normaliseFocusKeywords(statement), inherited: false };
	}
	if (!snapshotMatches(input)) return null;
	const fallback = keywordFromContent(input.snapshot.data, { seo: input.snapshot.seo });
	const display = normaliseFocusKeywords(fallback);
	return { display, inherited: display.length > 0 };
}

function unavailableEvidence(check: SeoContentCheck, detail: string, source: string): SeoContentCheck {
	const { condition: _condition, ...evidence } = check;
	return {
		...evidence,
		status: "review",
		severity: "info",
		weight: 0,
		basis: "unavailable",
		detail,
		evidence: { actual: null, expected: "readable saved evidence", source },
		recommendation: "Review this setting and the rendered page before relying on this check.",
	};
}

/** Local checks use the verified saved inputs and never read, write or schedule work. */
export function resolveEditorBasicAnalysis(input: EditorBasicAnalysisInput): EditorBasicAnalysis {
	const unavailable = (reason: string): EditorBasicAnalysis => ({ state: "unavailable", reason });
	const preview = input.preview;
	if (!preview || !snapshotMatches(input) || !savedSnapshotMatches(
		{ ...preview, ref: preview.content.ref },
		{ ref: input.ref, sourceVersion: input.sourceVersion },
	)) return unavailable("Reload the saved metadata to run basic checks.");
	const ownership = preview.ownership;
	if (!ownership || ownership.sourceVersion !== input.sourceVersion)
		return unavailable("Saved metadata could not be confirmed. Reload it to try again.");
	const partialMetadata = ownership.status === "unknown" && ownership.reason === "core-seo-unavailable" &&
		input.snapshot.seo === undefined;
	if (!partialMetadata && ownership.status !== "current")
		return unavailable("Saved metadata could not be confirmed. Reload it to try again.");
	if (!partialMetadata && SEO_ADMIN_OWNERSHIP_FIELDS.some((field) =>
		!ownership.fields.some((item) => item.field === field && item.state !== "unknown")))
		return unavailable("Saved metadata could not be read completely. Reload it to try again.");
	if ((input.locale !== null || partialMetadata) && ownership.locale !== input.locale)
		return unavailable("This preview belongs to another locale. Reload this entry.");
	if (!input.assessmentReady || !input.assessment || input.assessment.state === "unavailable")
		return unavailable("Assessment settings could not be read. Reload them to try again.");
	const collection = input.ref.slice(0, input.ref.indexOf(":"));
	if (!collection || input.assessment.collection !== collection || preview.content.collection !== collection)
		return unavailable("The saved settings belong to another content type. Reload this entry.");
	const keywordOwnership = resolveEditorBasicKeywordOwnership(input);
	if (!keywordOwnership) return unavailable("Focus keywords could not be read. Reload them to try again.");
	const configured = input.assessment.state === "configured";
	// Unconfigured posts use editorial checks; pages and custom collections use general checks.
	const assessmentProfile = input.assessment.state === "configured"
		? { profile: input.assessment.profile, version: input.assessment.version }
		: { profile: collection === "posts" ? "article" as const : "general" as const, version: 1 as const };
	const data = input.snapshot.data;
	// Custom field names require a collection definition, which this preview does not carry.
	const document = contentBodyValue(data, null);
	// Settings from the same preview snapshot; undefined means an older server that does not send them.
	const settings = preview.analysis;
	const imageSeoEnabled = settings ? settings.imageAltChecks : input.imageSeoEnabled;
	const result = analyzeSeoContent({
		ref: input.ref,
		collection,
		entryId: preview.content.entryId,
		slug: input.snapshot.slug,
		title: partialMetadata ? "" : preview.search.title,
		titleSource: preview.sources.title,
		description: partialMetadata ? "" : preview.search.description,
		descriptionSource: settings?.descriptionGenerated ? "generated" : preview.sources.description,
		descriptionPrefix: partialMetadata ? "" : seoSnippetDatePrefix(preview.search.publishedAt, input.locale),
		url: partialMetadata ? "" : preview.search.url,
		canonicalStatus: partialMetadata ? undefined : preview.canonicalValidation.status,
		image: partialMetadata ? undefined : preview.social.image ?? undefined,
		...(settings ? { imageSource: preview.sources.image } : {}),
		...(settings ? { nosnippet: settings.nosnippet } : {}),
		featuredImage: featuredImageFromContentData(data),
		noindex: partialMetadata ? false : !preview.indexable,
		noindexSources: partialMetadata ? [] : preview.noindexSources ?? (preview.entryNoindex ? ["entry-seo"] : []),
		publicationStatus: input.publicationStatus,
		body: extractSeoDocumentText(document),
		document,
		contentImages: contentImageInputs(data),
		bodySource: typeof data.body_source === "string" ? data.body_source : undefined,
		focusKeywords: keywordOwnership.display,
		pillar: input.pillar ?? input.profile?.pillar ?? false,
		assessmentProfile,
		schemaEnabled: !partialMetadata && preview.schemaTypes.length > 0,
		schemaPreset: partialMetadata ? "" : preview.schemaTypes.join(", ") || "None",
		// An unknown setting is analyzed as on; only rows that then measured images are withdrawn below.
		imageSeoEnabled: imageSeoEnabled ?? true,
	});
	// The default body field is read before any custom one, so only without it can the server's body differ.
	const bodyUnobserved = !Object.prototype.hasOwnProperty.call(data, "content");
	const checks = result.checks.map((check) => {
		if (partialMetadata && (
			["metadata", "indexability", "social", "schema", "links"].includes(check.category) ||
			["keyword-title", "keyword-title-position", "keyword-description", "secondary-keyword-coverage"].includes(check.id)
		)) return unavailableEvidence(check,
			"Core SEO metadata is unavailable, so this metadata or URL-dependent check is not evaluated.",
			"saved metadata ownership");
		if (check.id === "schema" && !settings && preview.schemaTypes.length === 0) return unavailableEvidence(check,
			"The entry preview reports no schema prediction; missing, disabled and unreadable configuration are not distinguished.",
			"resolved entry preview");
		if (check.category === "images" && check.id !== "featured-image" && (
			(imageSeoEnabled === undefined && isScoredSeoCheckBasis(check.basis)) ||
			(imageSeoEnabled !== false && bodyUnobserved))) return unavailableEvidence(check,
			"Saved image-check settings or body evidence are not available in this preview.",
			"saved feature settings / body");
		if (check.id === "secondary-keyword-coverage" && bodyUnobserved && keywordOwnership.display.length > 1)
			return unavailableEvidence(check, "The saved body is not observed, so whole-page secondary keyword coverage is unavailable.",
				"saved body");
		return check;
	});
	const context: EditorBasicAnalysisContext = {
		profileSource: configured ? "configured" : "default",
		profileLabel: assessmentProfile.profile === "article" ? "Article" : "General content",
		keywordOwnership,
		sourceVersion: input.sourceVersion,
		locale: ownership.locale,
	};
	if (partialMetadata) {
		const { score: _score, status: _status, grade: _grade, calculation: _calculation, coverage: _coverage, assessmentProfile: selectedProfile, ...observed } = result;
		return {
			...context,
			state: "partial",
			result: { ...observed, checks, assessmentProfile: selectedProfile },
			reason: "Core SEO metadata is unavailable. These checks cover observed saved body and keywords.",
		};
	}
	return { ...context, state: "ready", result: { ...result, checks, ...aggregateSeoChecks(checks, assessmentProfile.profile) } };
}
