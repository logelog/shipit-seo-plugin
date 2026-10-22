import {
	SEO_SCORE_VERSION,
	seoScoreDisplay,
	type SeoAdminContentScore,
	type SeoAdminContentScores,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { SEO_EARLIER_ANALYZER_LABEL, SEO_EARLIER_ANALYZER_TEXT } from "../check-presentation.ts";
import { fetchSeoContentScores, type FetchSeoContentScoresOptions } from "./api.ts";
import {
	analysisPresentation,
	entryRef,
	indexContentScores,
} from "./content-extension-model.ts";

const SCORE_QUERY_SCOPE = "shipit-seo-content-scores";
export const SCORE_PAGE_SIZE = 200;

/**
 * The list badge shows a number only for a verified current result that
 * `seoScoreDisplay` scores. A dash, an unverified or stale result and an
 * earlier analyzer never announce one, visibly or in the accessible name.
 */
export function contentScoreColumnPresentation(score: SeoAdminContentScore) {
	const earlier = score.scoreVersion !== SEO_SCORE_VERSION;
	const { label, qualifier, tone } = analysisPresentation(score);
	const stale = score.freshness === "stale" || earlier;
	const freshness = stale ? "stale" : score.freshness ?? "unknown";
	const display = !earlier && score.freshness === "current" ? seoScoreDisplay(score) : null;
	const number = display?.score ?? null;
	const statusText = qualifier ? `${label}. ${qualifier}` : label;
	const description = earlier
		? SEO_EARLIER_ANALYZER_TEXT
		: stale
			? `Last known SEO score. ${statusText}. Refresh analysis to update it.`
			: number !== null
				? `${label}: ${number}/100${qualifier ? `. ${qualifier}` : ""}`
				: score.freshness === "current"
					? `${statusText}. See the saved analysis for its calculation.`
					: `Saved SEO score. ${statusText}.`;
	return {
		tone,
		label,
		qualifier,
		stale,
		freshness,
		badgeText: earlier ? SEO_EARLIER_ANALYZER_LABEL : number !== null ? String(number) : "-",
		description,
	};
}

interface ContentScorePageItem {
	id: string;
}

export type ContentScorePageLoader = (
	options: FetchSeoContentScoresOptions,
) => Promise<SeoAdminContentScores>;

export function visibleContentScoreRefs(
	collection: string,
	item: ContentScorePageItem,
	visibleItems: readonly ContentScorePageItem[],
): readonly string[] {
	return [
		...new Set(
			(visibleItems.length > 0 ? visibleItems : [item]).map((visibleItem) =>
				entryRef(collection, visibleItem.id),
			),
		),
	].slice(0, SCORE_PAGE_SIZE);
}

export function contentScorePageQueryOptions(
	collection: string,
	refs: readonly string[],
	locale?: string,
	loadScores: ContentScorePageLoader = fetchSeoContentScores,
) {
	return {
		queryKey: [SCORE_QUERY_SCOPE, "collection", collection, locale ?? null, refs] as const,
		queryFn: async ({
			signal,
		}: {
			signal: AbortSignal;
		}): Promise<ReadonlyMap<string, SeoAdminContentScore>> => {
			if (refs.length === 0) return new Map();
			const response = await loadScores({
				collection,
				refs,
				limit: Math.min(refs.length, SCORE_PAGE_SIZE),
				storedOnly: true,
				snapshotOnly: true,
				signal,
			});
			return indexContentScores(response.items);
		},
		staleTime: 0,
		retry: 1,
		refetchOnMount: "always" as const,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	};
}
