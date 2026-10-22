const CONTENT_ADMIN_PATH = "/_emdash/admin/content";

function contentPathSegment(value: string): string | null {
	const segment = value.trim();
	if (!segment || segment === "." || segment === "..") return null;
	return encodeURIComponent(segment);
}

export function contentEditorUrl(collection: string, entryId: string): string {
	const collectionSegment = contentPathSegment(collection);
	const entrySegment = contentPathSegment(entryId);
	if (!collectionSegment || !entrySegment) return CONTENT_ADMIN_PATH;
	return `${CONTENT_ADMIN_PATH}/${collectionSegment}/${entrySegment}`;
}
