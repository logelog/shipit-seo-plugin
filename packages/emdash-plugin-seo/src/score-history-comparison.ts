import { SEO_SCORE_COMPARISON_POLICY, SEO_SCORE_VERSION, isSeoScoredCheckMask, seoScoreDisplay, seoScoredCheckMask } from "./analysis.ts";
import { isCollectionAnalysisProfileSelection } from "./collection-analysis-profile.ts";
import type {
	SeoAdminContentScore,
	SeoAdminScoreComparison,
	SeoAdminScoreSnapshot,
	SeoAdminScoreTrendChange,
	SeoAdminScoreTrends,
	SeoScoreComparisonContext,
} from "./admin-contract.ts";

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Qualification is separate from raw snapshot validity. */
export function scoreComparisonContextProblem(value: unknown): "missingContext" | "invalidContext" | null {
	if (value === undefined) return "missingContext";
	if (!record(value) || Object.keys(value).length !== 4 ||
		!Object.keys(value).every((key) => ["version", "policy", "assessmentProfile", "eligibleMask"].includes(key)) ||
		value.version !== 1 || value.policy !== SEO_SCORE_COMPARISON_POLICY ||
		!isCollectionAnalysisProfileSelection(value.assessmentProfile) ||
		Object.keys(value.assessmentProfile).length !== 2 ||
		!Object.keys(value.assessmentProfile).every((key) => key === "version" || key === "profile") ||
		!isSeoScoredCheckMask(value.eligibleMask))
		return "invalidContext";
	return null;
}

/** Only a current score with a shown number can be compared; earlier analyzers and dashes get no context. */
export function createScoreComparisonContext(score: SeoAdminContentScore): SeoScoreComparisonContext | undefined {
	if (score.scoreVersion !== SEO_SCORE_VERSION || !isCollectionAnalysisProfileSelection(score.assessmentProfile)) return undefined;
	const eligibleMask = seoScoredCheckMask(score.checks, score.assessmentProfile.profile);
	if (eligibleMask === null || seoScoreDisplay(score).score === null) return undefined;
	return {
		version: 1,
		policy: SEO_SCORE_COMPARISON_POLICY,
		assessmentProfile: { version: score.assessmentProfile.version, profile: score.assessmentProfile.profile },
		eligibleMask,
	};
}

function differenceSize(left: Set<string>, right: Set<string>): number {
	let count = 0;
	for (const value of left) if (!right.has(value)) count += 1;
	return count;
}

function textOrder(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/** One selected-window pair per ref; no cohort is inferred from a capped list. */
export function buildScoreHistoryComparison(
	snapshots: readonly SeoAdminScoreSnapshot[],
	windowStart: number,
	windowEnd: number,
): Pick<SeoAdminScoreTrends, "comparison" | "changes"> {
	if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowStart > windowEnd)
		throw new RangeError("Invalid score comparison range.");
	const comparison: SeoAdminScoreComparison = {
		policy: "same-ref-window-v1",
		range: { start: new Date(windowStart).toISOString(), end: new Date(windowEnd).toISOString() },
		observedEntries: 0,
		pairedEntries: 0,
		singleSampleEntries: 0,
		excludedEntries: 0,
		exclusions: { missingContext: 0, invalidContext: 0, changedProfile: 0, ambiguousTime: 0 },
		scopeChangedPairs: 0,
		baselineAverage: null,
		currentAverage: null,
		scoreDelta: null,
		direction: "insufficient-data",
		openedIssues: null,
		resolvedIssues: null,
		improvedEntries: 0,
		declinedEntries: 0,
		unchangedEntries: 0,
	};
	const byRef = new Map<string, SeoAdminScoreSnapshot[]>();
	for (const snapshot of snapshots) {
		const capturedAt = Date.parse(snapshot.capturedAt);
		if (snapshot.scoreVersion !== SEO_SCORE_VERSION || !Number.isFinite(capturedAt) || capturedAt > windowEnd) continue;
		const group = byRef.get(snapshot.ref) ?? [];
		group.push(snapshot);
		byRef.set(snapshot.ref, group);
	}
	let previousTotal = 0;
	let currentTotal = 0;
	let openedTotal = 0;
	let resolvedTotal = 0;
	const changes: SeoAdminScoreTrendChange[] = [];
	for (const group of byRef.values()) {
		group.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || textOrder(left.id, right.id));
		const inWindow = group.filter((snapshot) => Date.parse(snapshot.capturedAt) >= windowStart);
		if (!inWindow.length) continue;
		comparison.observedEntries += 1;
		const current = inWindow[inWindow.length - 1];
		const before = group.filter((snapshot) => Date.parse(snapshot.capturedAt) < windowStart);
		const previous = before.length ? before[before.length - 1] : inWindow[0];
		if (previous === current) {
			comparison.singleSampleEntries += 1;
			continue;
		}
		const currentTime = Date.parse(current.capturedAt);
		const previousTime = Date.parse(previous.capturedAt);
		const ambiguous = group.filter((snapshot) => Date.parse(snapshot.capturedAt) === currentTime).length > 1 ||
			group.filter((snapshot) => Date.parse(snapshot.capturedAt) === previousTime).length > 1;
		const previousProblem = scoreComparisonContextProblem(previous.comparisonContext);
		const currentProblem = scoreComparisonContextProblem(current.comparisonContext);
		const contextProblem = previousProblem === "invalidContext" || currentProblem === "invalidContext"
			? "invalidContext" : previousProblem ?? currentProblem;
		if (ambiguous || contextProblem) {
			comparison.excludedEntries += 1;
			comparison.exclusions[ambiguous ? "ambiguousTime" : contextProblem!] += 1;
			continue;
		}
		const previousContext = previous.comparisonContext as SeoScoreComparisonContext;
		const currentContext = current.comparisonContext as SeoScoreComparisonContext;
		if (previousContext.assessmentProfile.version !== currentContext.assessmentProfile.version ||
			previousContext.assessmentProfile.profile !== currentContext.assessmentProfile.profile) {
			comparison.excludedEntries += 1;
			comparison.exclusions.changedProfile += 1;
			continue;
		}
		if (previous.id === current.id || previousTime >= currentTime) {
			comparison.excludedEntries += 1;
			comparison.exclusions.ambiguousTime += 1;
			continue;
		}
		comparison.pairedEntries += 1;
		previousTotal += previous.score;
		currentTotal += current.score;
		const scopeChanged = previousContext.eligibleMask !== currentContext.eligibleMask;
		if (scopeChanged) comparison.scopeChangedPairs += 1;
		const delta = current.score - previous.score;
		if (delta > 0) comparison.improvedEntries += 1;
		else if (delta < 0) comparison.declinedEntries += 1;
		else comparison.unchangedEntries += 1;
		const previousIssues = new Set(previous.issues.map((issue) => issue.id));
		const currentIssues = new Set(current.issues.map((issue) => issue.id));
		const openedIssues = differenceSize(currentIssues, previousIssues);
		const resolvedIssues = differenceSize(previousIssues, currentIssues);
		openedTotal += openedIssues;
		resolvedTotal += resolvedIssues;
		if (delta === 0 && openedIssues === 0 && resolvedIssues === 0) continue;
		changes.push({
			ref: current.ref,
			collection: current.collection,
			entryId: current.entryId,
			title: current.title,
			previousSnapshotId: previous.id,
			currentSnapshotId: current.id,
			previousCapturedAt: previous.capturedAt,
			capturedAt: current.capturedAt,
			baselineBasis: before.length ? "before-window" : "first-in-window",
			scopeChanged,
			previousScore: previous.score,
			currentScore: current.score,
			delta,
			openedIssues,
			resolvedIssues,
		});
	}
	if (comparison.pairedEntries) {
		comparison.baselineAverage = Math.round(previousTotal / comparison.pairedEntries);
		comparison.currentAverage = Math.round(currentTotal / comparison.pairedEntries);
		comparison.scoreDelta = comparison.currentAverage - comparison.baselineAverage;
		comparison.direction = comparison.scoreDelta > 0 ? "improved" : comparison.scoreDelta < 0 ? "declined" : "stable";
		comparison.openedIssues = openedTotal;
		comparison.resolvedIssues = resolvedTotal;
	}
	changes.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt) ||
		Math.abs(right.delta) - Math.abs(left.delta) || textOrder(left.ref, right.ref));
	return {
		comparison,
		changes: { items: changes.slice(0, 20), total: changes.length, hasMore: changes.length > 20 },
	};
}
