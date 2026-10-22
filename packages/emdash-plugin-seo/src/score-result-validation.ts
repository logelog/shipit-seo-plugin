import {
	SEO_SCORE_VERSION,
	aggregateSeoChecks,
	seoContentCheckProblem,
	type SeoContentCheck,
	type SeoScoreLimit,
} from "./analysis.ts";
import { isCollectionAnalysisProfileSelection } from "./collection-analysis-profile.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Limits are objects, so a stored limit is compared field by field, never by identity. */
function sameLimit(stored: unknown, expected: SeoScoreLimit | null): boolean {
	if (expected === null) return stored === null;
	return isRecord(stored) && Object.keys(stored).length === 3 && stored.reason === expected.reason && stored.cap === expected.cap &&
		Array.isArray(stored.checkIds) && stored.checkIds.length === expected.checkIds.length &&
		stored.checkIds.every((id, index) => id === expected.checkIds[index]);
}

/** Assessment consistency only; callers retain their identity, metrics and revision checks. */
export function currentSeoScoreAssessmentProblem(value: unknown): string | null {
	if (!isRecord(value)) return "assessment";
	if (value.scoreVersion !== SEO_SCORE_VERSION) return "scoreVersion";
	if (!Array.isArray(value.checks)) return "checks";
	const profile = isCollectionAnalysisProfileSelection(value.assessmentProfile) ? value.assessmentProfile.profile : undefined;
	if (value.checks.some((check) => seoContentCheckProblem(check, true, profile) !== null)) return "checks.row";
	let aggregate: ReturnType<typeof aggregateSeoChecks>;
	try {
		aggregate = aggregateSeoChecks(value.checks as SeoContentCheck[], profile);
	} catch {
		return "checks.aggregate";
	}
	if (value.score !== aggregate.score) return "score";
	if (value.status !== aggregate.status) return "status";
	if (value.grade !== aggregate.grade) return "grade";
	const calculation = value.calculation;
	if (!isRecord(calculation)) return "calculation";
	for (const key of ["earnedWeight", "totalWeight", "rawScore", "score", "reviewCredit"] as const) {
		if (calculation[key] !== aggregate.calculation[key]) return "calculation." + key;
	}
	if (!sameLimit(calculation.limit, aggregate.calculation.limit)) return "calculation.limit";
	const limits = calculation.limits;
	if (!Array.isArray(limits) || limits.length !== aggregate.calculation.limits.length ||
		!aggregate.calculation.limits.every((limit, index) => sameLimit(limits[index], limit)))
		return "calculation.limits";
	const coverage = value.coverage;
	if (!isRecord(coverage)) return "coverage";
	for (const key of ["evaluated", "measured", "heuristic", "unavailable", "notApplicable", "unweighted"] as const) {
		if (coverage[key] !== aggregate.coverage[key]) return "coverage." + key;
	}
	return null;
}
