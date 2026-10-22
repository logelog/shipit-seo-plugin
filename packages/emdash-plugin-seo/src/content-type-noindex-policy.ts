export const CONTENT_TYPE_NOINDEX_LIMIT = 100;
const CONTENT_TYPE_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

export function isContentTypeNoindexName(input: unknown): input is string {
	return typeof input === "string" && CONTENT_TYPE_NAME.test(input);
}

export function validateContentTypeNoindex(input: unknown):
	{ success: true; names: string[] } | { success: false; error: string } {
	if (!Array.isArray(input)) return { success: false, error: "Choose content types as a list." };
	if (input.length > CONTENT_TYPE_NOINDEX_LIMIT) {
		return { success: false, error: "Choose no more than 100 content types." };
	}
	const names = Array.from(input);
	if (!names.every(isContentTypeNoindexName)) {
		return { success: false, error: "Use exact content type names with up to 64 lowercase letters, numbers, underscores or hyphens, starting with a letter." };
	}
	return { success: true, names: [...new Set(names)].sort() };
}

/** Stored policy is canonical; malformed data never selects a content type. */
export function isStoredContentTypeNoindex(input: unknown): input is string[] {
	const validated = validateContentTypeNoindex(input);
	return validated.success && Array.isArray(input) && input.length === validated.names.length &&
		validated.names.every((name, index) => name === input[index]);
}

export function contentTypeNoindexApplies(policy: unknown, collection: unknown): boolean {
	return isContentTypeNoindexName(collection) && isStoredContentTypeNoindex(policy) && policy.includes(collection);
}

/** Kept names may be removed after their content type was deleted; only additions must exist now. */
export function addedContentTypeNoindex(
	requested: readonly string[] | undefined,
	current: readonly string[] | undefined,
): string[] {
	if (requested === undefined) return [];
	const previous = new Set(current ?? []);
	return requested.filter((name) => !previous.has(name));
}
