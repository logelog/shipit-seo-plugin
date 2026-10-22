import assert from "node:assert/strict";

import { isSeoContentCollectionKey } from "./admin-contract.ts";
import {
	CONTENT_TYPE_NOINDEX_LIMIT,
	addedContentTypeNoindex,
	contentTypeNoindexApplies,
	isContentTypeNoindexName,
	isStoredContentTypeNoindex,
	validateContentTypeNoindex,
} from "./content-type-noindex-policy.ts";

// Names follow the collection key rule every content route already uses.
for (const name of ["posts", "a", "case_studies", "news-items", "x".repeat(64)]) {
	assert.equal(isContentTypeNoindexName(name), true, name);
	assert.equal(isSeoContentCollectionKey(name), true, "control: the collection key rule accepts " + name);
}
for (const name of ["", "Posts", "9posts", "-posts", "a/b", "posts ", "x".repeat(65), 7, null]) {
	assert.equal(isContentTypeNoindexName(name), false, String(name));
	assert.equal(isSeoContentCollectionKey(name), false, "control: the collection key rule refuses " + String(name));
}

assert.deepEqual(validateContentTypeNoindex(["posts", "events", "posts"]), { success: true, names: ["events", "posts"] });
assert.deepEqual(validateContentTypeNoindex([]), { success: true, names: [] });
assert.equal(CONTENT_TYPE_NOINDEX_LIMIT, 100);
assert.equal(validateContentTypeNoindex(Array.from({ length: 100 }, (_, index) => `t${index}`)).success, true);
for (const input of [undefined, null, "posts", { posts: true }, ["Posts"], Array(101).fill("posts")]) {
	assert.equal(validateContentTypeNoindex(input).success, false, JSON.stringify(input));
}

// Stored lists must already be canonical, so a damaged record never selects a type.
assert.equal(isStoredContentTypeNoindex(["events", "posts"]), true);
assert.equal(isStoredContentTypeNoindex([]), true);
for (const stored of [["posts", "events"], ["posts", "posts"], ["Posts"], "posts", null, undefined]) {
	assert.equal(isStoredContentTypeNoindex(stored), false, JSON.stringify(stored));
}

assert.equal(contentTypeNoindexApplies(["events", "posts"], "posts"), true);
assert.equal(contentTypeNoindexApplies(["events", "posts"], "pages"), false);
assert.equal(contentTypeNoindexApplies(undefined, "posts"), false, "records without the field add no rule");
assert.equal(contentTypeNoindexApplies([], "posts"), false);
assert.equal(contentTypeNoindexApplies(["posts", "events"], "posts"), false, "a non-canonical list applies to nothing");
assert.equal(contentTypeNoindexApplies(["posts"], "Posts"), false, "names match exactly");
assert.equal(contentTypeNoindexApplies(["posts"], undefined), false, "a page without a collection is never covered");

assert.deepEqual(addedContentTypeNoindex(["pages", "posts", "retired"], ["posts", "retired"]), ["pages"]);
assert.deepEqual(addedContentTypeNoindex(["posts"], ["posts", "retired"]), [], "removing a retained name adds nothing");
assert.deepEqual(addedContentTypeNoindex(undefined, ["posts"]), [], "an omitted list adds nothing");
assert.deepEqual(addedContentTypeNoindex(["posts"], undefined), ["posts"]);

console.log("Content type noindex policy self-check passed.");
