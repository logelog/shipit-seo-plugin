import assert from "node:assert/strict";

import { contentEditorUrl } from "./content-editor-url.ts";

assert.equal(
	contentEditorUrl("posts", "entry-1"),
	"/_emdash/admin/content/posts/entry-1",
);
assert.equal(
	contentEditorUrl("case studies", "naive/%?#"),
	"/_emdash/admin/content/case%20studies/naive%2F%25%3F%23",
);
assert.equal(contentEditorUrl("posts", ".."), "/_emdash/admin/content");
assert.equal(contentEditorUrl("..", "entry-1"), "/_emdash/admin/content");
assert.equal(contentEditorUrl("posts", "."), "/_emdash/admin/content");
assert.equal(contentEditorUrl(".", "entry-1"), "/_emdash/admin/content");
assert.equal(contentEditorUrl("posts", " "), "/_emdash/admin/content");
assert.equal(
	contentEditorUrl("posts", "javascript:alert(1)"),
	"/_emdash/admin/content/posts/javascript%3Aalert(1)",
);

console.log("SEO content editor URL self-check passed.");
