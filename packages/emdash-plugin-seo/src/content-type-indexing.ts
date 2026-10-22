import type { PluginContext } from "emdash/plugin";
import { addedContentTypeNoindex } from "./content-type-noindex-policy.ts";
import { resolveContentCollectionSource } from "./entry-analysis-runtime.ts";

/** Retained choices may be removed even when their content type was deleted. */
export async function validateNewContentTypeNoindex(
	ctx: PluginContext, requested: readonly string[] | undefined, current: readonly string[] | undefined,
): Promise<string | null> {
	const added = addedContentTypeNoindex(requested, current);
	if (!added.length) return null;
	const resolution = await resolveContentCollectionSource(ctx);
	if (!resolution.available) return "Content types could not be checked. Your saved rules are unchanged.";
	const known = new Set(resolution.definitions.map((definition) => definition.collection));
	return added.every((name) => known.has(name)) ? null : "Choose available content types. Existing unavailable choices can be kept or removed.";
}
