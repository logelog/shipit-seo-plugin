export const SCORE_SCAN_CANDIDATE_BUDGET = 200;
export const SCORE_SCAN_MATCH_BUDGET = 25;
export const SCORE_SCAN_TERM_PAGE_LIMIT = 50;
export const SCORE_SCAN_TERM_CURSOR_LIMIT = 2048;
export const SCORE_SCAN_TAXONOMY_LIMIT = 8;
export const SCORE_SCAN_SELECTED_TERM_LIMIT = 64;
export const SCORE_SCAN_EXPANDED_TERM_LIMIT = 512;

export class ScoreScanSelectionError extends Error {
	readonly code = "invalid-selection";

	constructor(message: string) {
		super(message);
		this.name = "ScoreScanSelectionError";
	}
}

export type ScoreScanStatus = "all" | "draft" | "published" | "scheduled";

export interface ScoreScanTaxonomySelection {
	taxonomy: string;
	termIds: readonly string[];
	includeDescendants: boolean;
}

export interface ScoreScanSourceRequest {
	collection: string;
	status: ScoreScanStatus;
	locale: string | null;
	taxonomies: readonly ScoreScanTaxonomySelection[];
}

export interface ScoreScanResolvedTaxonomy {
	taxonomy: string;
	termIds: readonly string[];
	termGroups: readonly string[];
	includeDescendants: boolean;
}

export interface ScoreScanSourceScope {
	collection: string;
	status: ScoreScanStatus;
	locale: string | null;
	taxonomies: readonly ScoreScanResolvedTaxonomy[];
	upperId: string | null;
}

export interface ScoreScanReference {
	collection: string;
	id: string;
	locale: string;
	/** Candidate position consumed when this reference is finalized. */
	afterId: string;
}

export interface ScoreScanReferencePage {
	references: readonly ScoreScanReference[];
	nextAfterId: string | null;
	exhausted: boolean;
	fetchedCandidates: number;
	examinedCandidates: number;
	matchedReferences: number;
}

export interface ScoreScanPageBudget {
	candidateBudget: number;
	matchBudget: number;
}

export type ScoreScanRevalidation = "matching" | "missing" | "no-longer-matching";

export interface ScoreScanTermOptionsRequest {
	collection: string;
	taxonomy: string;
	locale: string | null;
	search: string;
	cursor: string | null;
	limit: number;
}

export interface ScoreScanTermOption {
	id: string;
	translationGroup: string;
	label: string;
	locale: string;
}

export interface ScoreScanTermPage {
	terms: readonly ScoreScanTermOption[];
	nextCursor: string | null;
}

/** Scope and cursors are resolved and retained by the server-side job. */
export interface ScoreScanSource {
	resolveScope(request: ScoreScanSourceRequest, allowedCollectionKeys: readonly string[]): Promise<ScoreScanSourceScope>;
	page(scope: ScoreScanSourceScope, afterId: string | null, budget: ScoreScanPageBudget): Promise<ScoreScanReferencePage>;
	revalidate(scope: ScoreScanSourceScope, reference: ScoreScanReference): Promise<ScoreScanRevalidation>;
	termOptions(request: ScoreScanTermOptionsRequest, allowedCollectionKeys: readonly string[]): Promise<ScoreScanTermPage>;
}
