import {
	LINK_EXCLUSION_REASONS,
	LINK_SUGGESTION_LIMITS,
	type LinkExclusionCounts,
	type LinkExclusionReason,
	type LinkStaleReason,
	type LinkSuggestionResponse,
	type LinkVerification,
} from "../internal-link-suggestions.ts";

export function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

const EXCLUSION_LABELS: Readonly<Record<LinkExclusionReason, string>> = {
	self: "This entry itself",
	"already-linked": "Already linked from this entry",
	"candidate-malformed": "Unreadable title or excerpt",
	"no-anchor": "No matching phrase in the saved body",
	"anchor-taken": "Matching phrase used by another suggestion",
	// Counted before destination reads, which can still exclude candidates inside the limit.
	"display-limit": `Over the limit of ${LINK_SUGGESTION_LIMITS.displayed} candidates per page`,
	"target-missing": "Destination missing",
	"target-unavailable": "Destination could not be read",
	"target-changed": "Destination changed",
	"not-published": "Not published",
	"out-of-scope": "Outside the selected scope",
	"scope-unverifiable": "Scope could not be confirmed",
	noindex: "Excluded from search",
	"policy-unverifiable": "Search setting could not be confirmed",
	"route-unavailable": "No public URL",
};

const VERIFY_STALE_MESSAGES: Readonly<Record<LinkStaleReason, string>> = {
	"source-missing": "This entry's saved version is no longer available.",
	"source-version-changed": "This entry was saved again after the suggestion was found.",
	"anchor-changed": "The anchor text in the saved paragraph changed.",
	"scope-changed": "The destination scope changed.",
	"policy-changed": "Search indexing settings changed.",
	"target-changed": "The destination changed.",
};

export function linkPageSummaryText(
	page: Pick<LinkSuggestionResponse["page"], "examinedRows" | "scopeMatches" | "exhausted">,
	referenceOnly: boolean,
): string {
	const counts = `This page examined ${plural(page.examinedRows, "destination row", "destination rows")}; ${page.scopeMatches} matched the selected scope.`;
	const progress = referenceOnly
		? "This search cannot continue from this page. Run Find link suggestions again to start a fresh search from the first page."
		: page.exhausted
			? "This search is complete. Run Find again to include newer content."
			: "More entries remain in this search; Next page continues it.";
	return `${counts} ${progress}`;
}

export function linkExclusionRows(excluded: LinkExclusionCounts): Array<{ reason: LinkExclusionReason; label: string; count: number }> {
	return LINK_EXCLUSION_REASONS.filter((reason) => excluded[reason] > 0)
		.map((reason) => ({ reason, label: EXCLUSION_LABELS[reason], count: excluded[reason] }));
}

// The engine reports every destination refusal as the target-changed reason
// plus a detail, so only a detail that repeats that reason may be dropped.
export function linkStaleVerdictMessages(verification: Extract<LinkVerification, { kind: "stale" }>): string[] {
	const { reasons, target } = verification;
	const repeated = target === "target-changed" && reasons.includes("target-changed");
	return [
		...reasons.map((reason) => VERIFY_STALE_MESSAGES[reason]),
		...(target && !repeated ? [`Destination: ${EXCLUSION_LABELS[target]}.`] : []),
		"Nothing was verified. Run Find link suggestions again.",
	];
}
