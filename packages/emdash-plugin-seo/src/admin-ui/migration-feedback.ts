export type SeoMigrationAction = "apply" | "rollback";
export type SeoMigrationOutcome = "complete" | "partial" | "needs-review";

const OPERATION_TITLES: Record<SeoMigrationAction, Record<SeoMigrationOutcome, string>> = {
	apply: {
		complete: "Migration applied",
		partial: "Migration partly applied",
		"needs-review": "Migration needs review",
	},
	rollback: {
		complete: "Migration batch rolled back",
		partial: "Migration batch partly rolled back",
		"needs-review": "Rollback needs review",
	},
};

export function seoMigrationFeedback(
	result: { results: readonly { status: string }[] } | { error: string },
	action: SeoMigrationAction,
): { outcome: SeoMigrationOutcome; title: string } {
	let outcome: SeoMigrationOutcome = "needs-review";
	if (!("error" in result) && result.results.length > 0) {
		const completed = action === "apply" ? "applied" : "rolled-back";
		if (result.results.some((item) => item.status === completed)) {
			outcome = result.results.every((item) =>
				item.status === completed ||
				(action === "rollback" && item.status === "not-applied:rolled-back"),
			) ? "complete" : "partial";
		}
	}
	return { outcome, title: OPERATION_TITLES[action][outcome] };
}
