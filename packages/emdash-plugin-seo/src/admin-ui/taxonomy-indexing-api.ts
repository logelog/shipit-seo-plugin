import { apiFetch, parseApiResponse } from "@emdash-cms/admin";
import type { SeoAdminIndexingTaxonomies } from "../taxonomy-indexing.ts";
import { seoAdminApiUrl } from "./api-routes.ts";
import { parseIndexingTaxonomies } from "./taxonomy-indexing-model.ts";

export async function fetchIndexingTaxonomies(signal?: AbortSignal): Promise<SeoAdminIndexingTaxonomies> {
	const response = await apiFetch(seoAdminApiUrl("admin-indexing-taxonomies"), { ...(signal ? { signal } : {}) });
	return parseIndexingTaxonomies(await parseApiResponse<unknown>(response, "Taxonomy definitions could not be loaded."));
}
