import type { PublicPageContext } from "emdash";

import { isTaxonomyArchiveName } from "./taxonomy-archive-policy.ts";

const TAXONOMY_ARCHIVE_PAGE_TYPE = "shipit-seo:taxonomy:";

/** Bind an archive the theme has resolved to its exact taxonomy name. */
export function taxonomyArchivePage(page: PublicPageContext, taxonomy: string): PublicPageContext {
	if (!page || typeof page !== "object" || Array.isArray(page) || page.kind !== "custom" || page.content !== undefined) {
		throw new TypeError("A taxonomy archive must be a custom page without a content entry.");
	}
	if (!isTaxonomyArchiveName(taxonomy)) throw new TypeError("Use an exact valid taxonomy name.");
	return { ...page, pageType: TAXONOMY_ARCHIVE_PAGE_TYPE + taxonomy };
}

/** Unbound custom routes and content entries never acquire archive policy. */
export function taxonomyArchiveName(page: unknown): string | null {
	if (!page || typeof page !== "object" || Array.isArray(page)) return null;
	const candidate = page as Partial<PublicPageContext>;
	if (candidate.kind !== "custom" || candidate.content !== undefined ||
		typeof candidate.pageType !== "string" || !candidate.pageType.startsWith(TAXONOMY_ARCHIVE_PAGE_TYPE)) return null;
	const taxonomy = candidate.pageType.slice(TAXONOMY_ARCHIVE_PAGE_TYPE.length);
	return isTaxonomyArchiveName(taxonomy) ? taxonomy : null;
}
