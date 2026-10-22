export interface TranslationContentAccess<T extends { id: string }> {
	get(collection: string, id: string): Promise<T | null>;
	getTranslations?: (
		collection: string,
		id: string,
	) => Promise<{ translationGroup: string; translations: Array<{ id: string }> }>;
}

export interface ExactTranslationGroup<T extends { id: string }> {
	translationGroup: string;
	itemsById: Map<string, T>;
}

export async function loadExactTranslationGroup<T extends { id: string }>(
	content: TranslationContentAccess<T>,
	collection: string,
	currentItem: T,
): Promise<ExactTranslationGroup<T> | null> {
	if (typeof content.getTranslations !== "function") return null;
	const result = await content.getTranslations(collection, currentItem.id);
	if (!result.translationGroup || !Array.isArray(result.translations)) {
		throw new Error("The host returned an invalid translation group.");
	}
	const ids = [...new Set(result.translations.map((item) => item.id))];
	if (ids.length > 100 || !ids.includes(currentItem.id) || ids.some((id) => !id)) {
		throw new Error("The host returned an incomplete or oversized translation group.");
	}
	const itemsById = new Map<string, T>([[currentItem.id, currentItem]]);
	for (const id of ids) {
		if (id === currentItem.id) continue;
		const item = await content.get(collection, id);
		if (!item || item.id !== id) {
			throw new Error("A translation could not be resolved by its exact entry ID.");
		}
		itemsById.set(id, item);
	}
	return { translationGroup: result.translationGroup, itemsById };
}
