import type {
	SeoAdminContentAudit,
	SeoAdminContentOption,
	SeoAdminContentScore,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

export const SEO_SESSION_AUDIT_BATCH_LIMIT = 25;
export const SEO_SESSION_AUDIT_RETAIN_LIMIT = 200;

export interface SeoSessionAuditEntry {
	ref: string;
	score: SeoAdminContentScore | null;
	error: string | null;
}

export interface SeoSessionAuditState {
	entries: SeoSessionAuditEntry[];
	attemptedRefs: string[];
	analyzedRefs: string[];
	lastBatchRefs: string[];
	lastBatch: { analyzed: number; failed: number } | null;
}

export function createSeoSessionAudit(): SeoSessionAuditState {
	return {
		entries: [],
		attemptedRefs: [],
		analyzedRefs: [],
		lastBatchRefs: [],
		lastBatch: null,
	};
}

export function nextSeoSessionAuditRefs(
	refs: readonly string[],
	attemptedRefs: readonly string[],
): string[] {
	const attempted = new Set(attemptedRefs);
	return Array.from(new Set(refs))
		.filter((ref) => !attempted.has(ref))
		.slice(0, SEO_SESSION_AUDIT_BATCH_LIMIT);
}

export function changedSeoSessionAuditRefs(
	page: readonly Pick<SeoAdminContentOption, "ref" | "updatedAt" | "sourceVersion">[],
	scores: readonly SeoAdminContentScore[],
): string[] {
	const retained = new Map(scores.map((score) => [score.ref, score]));
	return Array.from(new Set(page.slice(0, SEO_SESSION_AUDIT_BATCH_LIMIT)
		.filter((item) => {
			const score = retained.get(item.ref);
			if (!score) return false;
			if (item.sourceVersion !== undefined || score.sourceVersion !== undefined) {
				return item.sourceVersion !== score.sourceVersion;
			}
			return item.updatedAt !== score.sourceUpdatedAt;
		})
		.map((item) => item.ref)));
}

export function mergeSeoSessionAudit(
	previous: SeoSessionAuditState,
	requestedRefs: readonly string[],
	response: Pick<SeoAdminContentAudit, "items" | "failures">,
): SeoSessionAuditState {
	const requested = Array.from(new Set(requestedRefs)).slice(0, SEO_SESSION_AUDIT_BATCH_LIMIT);
	const scores = new Map(response.items.map((score) => [score.ref, score]));
	const failures = new Map(response.failures.map((failure) => [failure.ref, failure.error]));
	const replacements = requested.map((ref): SeoSessionAuditEntry => {
		const score = scores.get(ref);
		const error = failures.get(ref);
		return score && !error
			? { ref, score, error: null }
			: { ref, score: null, error: error ?? "Analysis returned no result. Try rechecking this entry." };
	});
	const replaced = new Set(requested);
	const successfulRefs = replacements.filter((entry) => entry.score).map((entry) => entry.ref);
	const entries = [...previous.entries.filter((entry) => !replaced.has(entry.ref)), ...replacements]
		.slice(-SEO_SESSION_AUDIT_RETAIN_LIMIT);
	const retainedRefs = new Set(entries.map((entry) => entry.ref));
	return {
		...previous,
		// A failed recheck replaces its old score so obsolete issues cannot look current.
		entries,
		attemptedRefs: Array.from(new Set([...previous.attemptedRefs, ...requested])).filter((ref) => retainedRefs.has(ref)),
		analyzedRefs: Array.from(new Set([...previous.analyzedRefs, ...successfulRefs])).filter((ref) => retainedRefs.has(ref)),
		lastBatchRefs: requested,
		lastBatch: { analyzed: successfulRefs.length, failed: requested.length - successfulRefs.length },
	};
}
