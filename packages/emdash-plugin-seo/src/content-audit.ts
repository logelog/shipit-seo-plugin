import type { SeoAdminContentAudit, SeoAdminContentScore } from "./admin-contract.ts";

export const CONTENT_AUDIT_BATCH_LIMIT = 25;

export function contentAuditRefs(input: unknown): string[] {
	if (!Array.isArray(input) || input.length < 1 || input.length > CONTENT_AUDIT_BATCH_LIMIT)
		throw new Error("Select between 1 and 25 entries to analyze.");
	if (input.some((ref) => typeof ref !== "string" || ref.length > 512 || !/^[^\s:]+:[^\s]+$/.test(ref)))
		throw new Error("Content analysis requires valid entry references.");
	return [...new Set(input as string[])];
}

export async function runContentAudit(
	refs: readonly string[],
	analyze: (ref: string) => Promise<SeoAdminContentScore | string>,
): Promise<Pick<SeoAdminContentAudit, "items" | "failures">> {
	const selected = contentAuditRefs(refs);
	const items: SeoAdminContentScore[] = [];
	const failures: SeoAdminContentAudit["failures"] = [];
	for (const ref of selected) {
		try {
			const result = await analyze(ref);
			if (typeof result === "string") failures.push({ ref, error: result });
			else if (result.ref !== ref || result.persistence !== "session" || result.analysisRevision !== 0)
				failures.push({ ref, error: "invalid_analysis" });
			else items.push(result);
		} catch {
			failures.push({ ref, error: "analysis_failed" });
		}
	}
	return { items, failures };
}
