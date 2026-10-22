export const TAXONOMY_ARCHIVE_NOINDEX_LIMIT = 100;
const TAXONOMY_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isTaxonomyArchiveName(input: unknown): input is string {
	return typeof input === "string" && TAXONOMY_NAME.test(input);
}

export function validateTaxonomyArchiveNoindex(input: unknown):
	{ success: true; names: string[] } | { success: false; error: string } {
	if (!Array.isArray(input)) return { success: false, error: "Choose taxonomy archive names as a list." };
	if (input.length > TAXONOMY_ARCHIVE_NOINDEX_LIMIT) {
		return { success: false, error: "Choose no more than 100 taxonomy archive types." };
	}
	const names = Array.from(input);
	if (!names.every(isTaxonomyArchiveName)) {
		return { success: false, error: "Use exact taxonomy names with up to 64 ASCII letters, numbers, underscores or hyphens, starting with a letter or number." };
	}
	return { success: true, names: [...new Set(names)].sort() };
}

/** Stored policy is canonical; malformed data never selects a taxonomy. */
export function isStoredTaxonomyArchiveNoindex(input: unknown): input is string[] {
	const validated = validateTaxonomyArchiveNoindex(input);
	return validated.success && Array.isArray(input) && input.length === validated.names.length &&
		validated.names.every((name, index) => name === input[index]);
}

export function taxonomyArchiveNoindexApplies(policy: unknown, taxonomy: unknown): boolean {
	return isTaxonomyArchiveName(taxonomy) && isStoredTaxonomyArchiveNoindex(policy) && policy.includes(taxonomy);
}
