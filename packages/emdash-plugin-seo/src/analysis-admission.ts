import type { ContentScoringPolicy } from "./settings-runtime.ts";

/** Chosen by trusted callers, never from an analysis request payload. */
export type EntryAnalysisPurpose = "automatic" | "manual-entry";

export type ReadableContentScoringPolicy = Exclude<ContentScoringPolicy, { state: "unavailable" }>;

export interface ManualEntryScoreAdmission {
	readonly ref: string;
	readonly locale: string | null;
	readonly policy: ReadableContentScoringPolicy;
}

export function entryAnalysisPolicyAdmits(
	policy: ContentScoringPolicy,
	purpose: EntryAnalysisPurpose,
): policy is ReadableContentScoringPolicy {
	return policy.state !== "unavailable" && (purpose === "manual-entry" || policy.state === "enabled");
}
