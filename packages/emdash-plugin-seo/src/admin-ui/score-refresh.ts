import { seoWorkspaceKeys } from "./workspace-model.ts";

interface ScoreDataQueryClient {
	invalidateQueries(options: { queryKey: readonly unknown[] }): Promise<unknown>;
}

const CONTENT_SCORE_QUERY_SCOPE = "shipit-seo-content-scores";

export async function runScoreRefreshAndInvalidate<T>(
	refresh: () => Promise<T>,
	invalidate: () => Promise<void>,
): Promise<T> {
	try {
		return await refresh();
	} finally {
		await invalidate();
	}
}

export async function invalidateScoreData(queryClient: ScoreDataQueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.overview }),
		queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.workQueue }),
		queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.trendsAll }),
		queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.contentOptions }),
		queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.entryPreviewAll }),
		queryClient.invalidateQueries({ queryKey: [CONTENT_SCORE_QUERY_SCOPE] }),
	]);
}
