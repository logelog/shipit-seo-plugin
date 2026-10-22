import type { PluginContext } from "emdash/plugin";
import { SEO_ADMIN_CONTRACT_VERSION } from "./admin-contract.ts";
import { isTaxonomyArchiveName } from "./taxonomy-archive-policy.ts";

export const INDEXING_TAXONOMY_LIST_LIMIT = 200;
export interface IndexingTaxonomyDefinition { name: string; label: string }
export interface SeoAdminIndexingTaxonomies {
	contractVersion: number;
	available: boolean;
	items: IndexingTaxonomyDefinition[];
	truncated: boolean;
	message: string | null;
}
const UNAVAILABLE = "Taxonomy definitions could not be loaded. Try again.";

async function readDefinitions(ctx: PluginContext): Promise<IndexingTaxonomyDefinition[] | null> {
	try {
		const taxonomies = ctx.taxonomies;
		if (typeof taxonomies?.getAll !== "function") return null;
		const definitions = await taxonomies.getAll();
		if (!Array.isArray(definitions)) return null;
		const byName = new Map<string, IndexingTaxonomyDefinition>();
		for (const definition of definitions) {
			if (!definition || !isTaxonomyArchiveName(definition.name)) return null;
			if (byName.has(definition.name)) continue;
			const label = typeof definition.label === "string" ? definition.label.trim().slice(0, 200) : "";
			byName.set(definition.name, { name: definition.name, label: label || definition.name });
		}
		return [...byName.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
	} catch { return null; }
}

/** Reads definitions only; it never enumerates terms, assignments or entries. */
export async function listIndexingTaxonomies(ctx: PluginContext): Promise<SeoAdminIndexingTaxonomies> {
	const definitions = await readDefinitions(ctx);
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		available: definitions !== null,
		items: definitions?.slice(0, INDEXING_TAXONOMY_LIST_LIMIT) ?? [],
		truncated: definitions !== null && definitions.length > INDEXING_TAXONOMY_LIST_LIMIT,
		message: definitions === null ? UNAVAILABLE : null,
	};
}

/** Retained choices may be removed even when their definition was deleted. */
export async function validateNewArchiveSelections(
	ctx: PluginContext, requested: readonly string[] | undefined, current: readonly string[] | undefined,
): Promise<string | null> {
	if (requested === undefined) return null;
	const previous = new Set(current ?? []);
	const added = requested.filter((name) => !previous.has(name));
	if (!added.length) return null;
	const definitions = await readDefinitions(ctx);
	if (definitions === null) return "Taxonomy definitions could not be checked. Your saved rules are unchanged.";
	const known = new Set(definitions.map((definition) => definition.name));
	return added.every((name) => known.has(name)) ? null : "Choose available taxonomy archive types. Existing unavailable choices can be kept or removed.";
}
