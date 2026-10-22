import assert from "node:assert/strict";

import { loadExactTranslationGroup } from "./host-translations.ts";

const current = { id: "page-en", locale: "en" };
const sibling = { id: "page-nl", locale: "nl" };
const exactReads: string[] = [];
const group = await loadExactTranslationGroup({
	get: async (_collection, id) => {
		exactReads.push(id);
		return id === sibling.id ? sibling : null;
	},
	getTranslations: async (collection, id) => {
		assert.equal(collection, "pages");
		assert.equal(id, current.id);
		return {
			translationGroup: "page-group",
			translations: [{ id: current.id }, { id: sibling.id }],
		};
	},
}, "pages", current);
assert.equal(group?.translationGroup, "page-group");
assert.deepEqual([...group!.itemsById.keys()], [current.id, sibling.id]);
assert.deepEqual(exactReads, [sibling.id]);

assert.equal(await loadExactTranslationGroup({
	get: async () => { throw new Error("Unexpected content read"); },
}, "pages", current), null);

await assert.rejects(loadExactTranslationGroup({
	get: async () => null,
	getTranslations: async () => ({
		translationGroup: "page-group",
		translations: [{ id: current.id }, { id: sibling.id }],
	}),
}, "pages", current), /exact entry ID/);

await assert.rejects(loadExactTranslationGroup({
	get: async () => sibling,
	getTranslations: async () => ({
		translationGroup: "page-group",
		translations: [{ id: sibling.id }],
	}),
}, "pages", current), /incomplete or oversized/);

console.log("SEO host translation self-check passed.");
