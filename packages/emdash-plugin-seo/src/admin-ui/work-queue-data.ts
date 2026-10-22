import type { SeoAdminContentScores } from "@shipitseo/emdash-plugin-seo/admin-contract";

export const SEO_WORK_QUEUE_PAGE_LIMIT = 100;

interface ContentScoreQuery {
	collection?: string;
	limit?: number;
	cursor?: string;
	storedOnly?: boolean;
}

interface WorkQueueDataDependencies {
	collection: string;
	cursor?: string;
	fetchContentScores: (options?: ContentScoreQuery) => Promise<SeoAdminContentScores>;
}

export async function loadSeoWorkQueueScores({
	collection,
	cursor,
	fetchContentScores,
}: WorkQueueDataDependencies): Promise<SeoAdminContentScores> {
	if (!collection || collection === "all") throw new Error("Choose a content type for the work queue.");
	const page = await fetchContentScores({
		collection,
		limit: SEO_WORK_QUEUE_PAGE_LIMIT,
		storedOnly: true,
		...(cursor ? { cursor } : {}),
	});
	if (page.items.length > SEO_WORK_QUEUE_PAGE_LIMIT || (page.hasMore &&
		(!page.cursor || page.cursor === cursor)))
		throw new Error("Content score pagination did not advance within its limit.");
	return page;
}
