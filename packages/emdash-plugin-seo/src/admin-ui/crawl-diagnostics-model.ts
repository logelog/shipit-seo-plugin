export const CRAWL_RESULT_PAGE_SIZE = 25;
export const CRAWL_RESULT_SEARCH_MAX = 200;

export interface CrawlResultFilter {
	query: string;
	type: string;
	page: number;
}

export interface CrawlResultPage<T> {
	items: T[];
	filteredCount: number;
	totalCount: number;
	page: number;
	pageCount: number;
	start: number;
	end: number;
}

export function pageCrawlResults<T>(
	items: readonly T[],
	filter: CrawlResultFilter,
	project: (item: T) => { type: string; text: string },
): CrawlResultPage<T> {
	const query = filter.query.slice(0, CRAWL_RESULT_SEARCH_MAX).trim().toLocaleLowerCase("en");
	const filtered = items.filter((item) => {
		const value = project(item);
		return (!filter.type || value.type === filter.type) && (!query || value.text.toLocaleLowerCase("en").includes(query));
	});
	const pageCount = Math.max(1, Math.ceil(filtered.length / CRAWL_RESULT_PAGE_SIZE));
	const requestedPage = Number.isFinite(filter.page) ? Math.trunc(filter.page) : 1;
	const page = Math.max(1, Math.min(pageCount, requestedPage));
	const offset = (page - 1) * CRAWL_RESULT_PAGE_SIZE;
	const visible = filtered.slice(offset, offset + CRAWL_RESULT_PAGE_SIZE);
	return {
		items: visible,
		filteredCount: filtered.length,
		totalCount: items.length,
		page,
		pageCount,
		start: visible.length ? offset + 1 : 0,
		end: offset + visible.length,
	};
}

export function crawlResultTypes<T>(items: readonly T[], type: (item: T) => string): string[] {
	return [...new Set(items.map(type))].sort((left, right) => left.localeCompare(right, "en"));
}
