import assert from "node:assert/strict";

import {
	TAXONOMY_ARCHIVE_NOINDEX_LIMIT,
	isStoredTaxonomyArchiveNoindex,
	isTaxonomyArchiveName,
	taxonomyArchiveNoindexApplies,
	validateTaxonomyArchiveNoindex,
} from "./taxonomy-archive-policy.ts";

assert.deepEqual(validateTaxonomyArchiveNoindex(["tag", "category", "tag", "Custom_Type"]), {
	success: true, names: ["Custom_Type", "category", "tag"],
});
assert.deepEqual(validateTaxonomyArchiveNoindex([]), { success: true, names: [] });
const input = ["tag", "category"];
const before = [...input];
validateTaxonomyArchiveNoindex(input);
assert.deepEqual(input, before, "normalization never mutates caller-owned draft values");
for (const invalid of [undefined, null, {}, "category", [""], [" category"], ["category "], ["a/b"],
	["a:b"], ["_private"], ["étiquette"], ["tag\0"], ["x".repeat(65)], [1], [null], Array(1)]) {
	assert.equal(validateTaxonomyArchiveNoindex(invalid).success, false);
	assert.equal(isStoredTaxonomyArchiveNoindex(invalid), false);
}
const maximum = Array.from({ length: TAXONOMY_ARCHIVE_NOINDEX_LIMIT }, (_, index) => "taxonomy_" + String(index).padStart(3, "0"));
assert.deepEqual(validateTaxonomyArchiveNoindex(maximum), { success: true, names: maximum });
assert.equal(validateTaxonomyArchiveNoindex([...maximum, "overflow"]).success, false);
assert.equal(validateTaxonomyArchiveNoindex(Array(TAXONOMY_ARCHIVE_NOINDEX_LIMIT + 1).fill("tag")).success, false,
	"the raw request is bounded before duplicate normalization");
assert.equal(isStoredTaxonomyArchiveNoindex(["category", "tag"]), true);
assert.equal(isStoredTaxonomyArchiveNoindex(["tag", "category"]), false);
assert.equal(isStoredTaxonomyArchiveNoindex(["tag", "tag"]), false);
assert.equal(isStoredTaxonomyArchiveNoindex([]), true);
assert.equal(isTaxonomyArchiveName("x".repeat(64)), true);
assert.equal(isTaxonomyArchiveName("Custom_Type-2"), true);
assert.equal(taxonomyArchiveNoindexApplies(["Custom_Type", "category"], "Custom_Type"), true);
assert.equal(taxonomyArchiveNoindexApplies(["Custom_Type", "category"], "custom_type"), false,
	"host names retain exact case rather than selecting another identifier");
assert.equal(taxonomyArchiveNoindexApplies(["category"], "tag"), false);
assert.equal(taxonomyArchiveNoindexApplies(undefined, "category"), false);
assert.equal(taxonomyArchiveNoindexApplies([], "category"), false);
assert.equal(taxonomyArchiveNoindexApplies(["tag", "category"], "category"), false);
assert.equal(taxonomyArchiveNoindexApplies(["category"], { name: "category" }), false);
console.log("Taxonomy archive policy checks passed.");
