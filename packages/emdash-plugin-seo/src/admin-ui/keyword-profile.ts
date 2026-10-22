import {
	seoKeywordIdentity,
	type SeoAdminContentScore,
	type SeoAdminFocusKeywordOperationError,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

/**
 * Pure keyword-ownership and save-state helpers for the editor panel.
 *
 * Ownership vocabulary (mirrors the engine contract):
 * - statement `null` — the profile makes no keyword statement; an inherited
 *   content keyword may keep driving analysis.
 * - statement `[]` — the user intentionally cleared analyzer keywords; the
 *   content fallback stays suppressed.
 * - non-empty statement — explicit analyzer keywords, first entry primary.
 */
export type SeoKeywordStatement = string[] | null;

export interface SeoKeywordOwnershipView {
	/** Chips to render — always the list that actually drives analysis. */
	display: string[];
	/** True when the chips are inherited content metadata, not saved profile data. */
	inherited: boolean;
}

export function normaliseKeywordChip(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

export function normaliseKeywordChips(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const keywords: string[] = [];
	for (const value of values) {
		const keyword = normaliseKeywordChip(value);
		const identity = seoKeywordIdentity(keyword);
		if (!keyword || seen.has(identity)) continue;
		seen.add(identity);
		keywords.push(keyword);
	}
	return keywords;
}

export function keywordListsMatch(
	a: readonly string[],
	b: readonly string[],
): boolean {
	if (a.length !== b.length) return false;
	return a.every(
		(keyword, index) =>
			seoKeywordIdentity(keyword) === seoKeywordIdentity(b[index]),
	);
}

export function keywordStatementsMatch(
	a: readonly string[] | null,
	b: readonly string[] | null,
): boolean {
	if (a === null || b === null) return a === b;
	return keywordListsMatch(a, b);
}

/** The saved statement as reported by a current-version score record. */
export function keywordStatementFromScore(
	score: Pick<SeoAdminContentScore, "profileKeywords">,
): SeoKeywordStatement {
	return Array.isArray(score.profileKeywords)
		? normaliseKeywordChips(score.profileKeywords)
		: null;
}

export function scoreMatchesProfile(
	score: Pick<SeoAdminContentScore, "profileKeywords" | "pillar">,
	profile: { keywords: readonly string[] | null; pillar: boolean } | null,
): boolean {
	return keywordStatementsMatch(keywordStatementFromScore(score), profile?.keywords ?? null) &&
		(score.pillar === true) === (profile?.pillar === true);
}

/**
 * What the chip row should show for a given draft statement. While the user
 * has made no statement, inherited content keywords stay visible (they drive
 * the score) but must be identified as inherited, never presented as saved
 * profile data.
 */
export function keywordOwnershipView(
	statement: SeoKeywordStatement,
	score: Pick<SeoAdminContentScore, "keywords" | "focusKeywordSource">,
): SeoKeywordOwnershipView {
	if (statement !== null) {
		return { display: statement, inherited: false };
	}
	if (
		score.focusKeywordSource === "content" &&
		Array.isArray(score.keywords) &&
		score.keywords.length > 0
	) {
		return { display: normaliseKeywordChips(score.keywords), inherited: true };
	}
	return { display: [], inherited: false };
}

// ---------------------------------------------------------------------------
// Save-state machine
// ---------------------------------------------------------------------------

export type SeoProfileSaveErrorKind = "network" | "validation" | "server";

export class SeoProfileSaveError extends Error {
	readonly kind: SeoProfileSaveErrorKind;

	constructor(kind: SeoProfileSaveErrorKind, message: string) {
		super(message);
		this.name = "SeoProfileSaveError";
		this.kind = kind;
	}
}

export interface SeoProfileSaveFailure {
	kind: SeoProfileSaveErrorKind;
	message: string;
	retryable: boolean;
}

export const SEO_PROFILE_OFFLINE_MESSAGE =
	"Could not reach the SEO service. Your changes are still here.";
export const SEO_PROFILE_FAILED_MESSAGE =
	"The keyword profile could not be saved. Your changes are still here.";

/** Route errors a retry cannot fix — bad input or a vanished entry. */
const NON_RETRYABLE_ROUTE_ERRORS: ReadonlySet<string> = new Set([
	"invalid_ref",
	"invalid_keyword",
	"unsupported_collection",
	"keyword_too_long",
	"too_many_keywords",
	"not_found",
]);

export function profileSaveErrorFromRoute(
	error: SeoAdminFocusKeywordOperationError,
	message: string,
): SeoProfileSaveError {
	return new SeoProfileSaveError(
		NON_RETRYABLE_ROUTE_ERRORS.has(error) ? "validation" : "server",
		message,
	);
}

/**
 * Map any thrown save failure onto a user-safe message. Raw transport text
 * ("Failed to fetch") must never reach the panel.
 */
export function classifyProfileSaveFailure(
	error: unknown,
): SeoProfileSaveFailure {
	if (error instanceof SeoProfileSaveError) {
		return {
			kind: error.kind,
			message: error.message,
			retryable: error.kind !== "validation",
		};
	}
	// fetch() also rejects with a TypeError when the connection drops after the
	// request was sent, so the write may already be stored. Only the panel draft
	// is known to be intact, and only the user's Retry may send it again.
	if (error instanceof TypeError) {
		return { kind: "network", message: SEO_PROFILE_OFFLINE_MESSAGE, retryable: true };
	}
	return { kind: "server", message: SEO_PROFILE_FAILED_MESSAGE, retryable: true };
}

export type SeoProfileSaveState =
	| { status: "clean" }
	| { status: "pending" }
	| { status: "saving" }
	| { status: "saved" }
	| { status: "error"; failure: SeoProfileSaveFailure };

/**
 * Truthful status derivation:
 * - a debounce that has not fired is "pending" (unsaved), never "saving";
 * - a failure outranks dirtiness so the Retry action stays visible until the
 *   user edits again (edits reset the mutation and re-arm the autosave);
 * - "saved" is a short-lived confirmation, only shown while clean.
 */
export function deriveProfileSaveState(input: {
	dirty: boolean;
	inFlight: boolean;
	failure: SeoProfileSaveFailure | null;
	recentlySaved: boolean;
}): SeoProfileSaveState {
	if (input.inFlight) return { status: "saving" };
	if (input.failure) return { status: "error", failure: input.failure };
	if (input.dirty) return { status: "pending" };
	if (input.recentlySaved) return { status: "saved" };
	return { status: "clean" };
}
