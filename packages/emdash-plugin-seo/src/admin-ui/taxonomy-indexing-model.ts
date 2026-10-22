import { SEO_ADMIN_CONTRACT_VERSION } from "../admin-contract.ts";
import { isTaxonomyArchiveName } from "../taxonomy-archive-policy.ts";
import { INDEXING_TAXONOMY_LIST_LIMIT, type SeoAdminIndexingTaxonomies } from "../taxonomy-indexing.ts";

export function parseIndexingTaxonomies(input: unknown): SeoAdminIndexingTaxonomies {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid SEO admin response: indexing.taxonomies");
	const value = input as Record<string, unknown>;
	if (value.contractVersion !== SEO_ADMIN_CONTRACT_VERSION) {
		throw new Error(`SEO engine/admin mismatch: expected contract ${SEO_ADMIN_CONTRACT_VERSION}, received ${String(value.contractVersion ?? "missing")}. Restart EmDash with matching plugin packages. (indexing.taxonomies)`);
	}
	const invalid = () => { throw new Error("Invalid SEO admin response: indexing.taxonomies"); };
	if (typeof value.available !== "boolean" || typeof value.truncated !== "boolean" ||
		!Array.isArray(value.items) || value.items.length > INDEXING_TAXONOMY_LIST_LIMIT ||
		(value.available ? value.message !== null : typeof value.message !== "string" || !value.message.trim() || value.message.length > 500)) return invalid();
	if (!value.available && (value.items.length || value.truncated)) return invalid();
	if (value.truncated && value.items.length !== INDEXING_TAXONOMY_LIST_LIMIT) return invalid();
	let previous = "";
	for (const item of value.items) {
		if (!item || typeof item !== "object" || Array.isArray(item) || !isTaxonomyArchiveName(item.name) ||
			typeof item.label !== "string" || !item.label.trim() || item.label.length > 200 || (previous && item.name <= previous)) return invalid();
		previous = item.name;
	}
	return { contractVersion: SEO_ADMIN_CONTRACT_VERSION, available: value.available,
		items: value.items.map((item) => ({ name: item.name, label: item.label })),
		truncated: value.truncated, message: value.message as string | null };
}
