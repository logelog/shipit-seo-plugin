import assert from "node:assert/strict";

import { seoMigrationFeedback } from "./migration-feedback.ts";

const result = (...statuses: string[]) => ({
	results: statuses.map((status, index) => ({ ref: `posts:${index}`, status })),
});

assert.deepEqual(seoMigrationFeedback(result("applied", "applied"), "apply"), {
	outcome: "complete",
	title: "Migration applied",
});
assert.deepEqual(seoMigrationFeedback(result("applied", "changed-since-preview"), "apply"), {
	outcome: "partial",
	title: "Migration partly applied",
});
assert.equal(seoMigrationFeedback(result("failed"), "apply").outcome, "needs-review");
assert.equal(seoMigrationFeedback(result(), "apply").outcome, "needs-review");
assert.equal(seoMigrationFeedback({ error: "content_write_unavailable" }, "apply").outcome, "needs-review");

assert.deepEqual(seoMigrationFeedback(result("rolled-back", "rolled-back"), "rollback"), {
	outcome: "complete",
	title: "Migration batch rolled back",
});
assert.equal(seoMigrationFeedback(result("rolled-back", "not-applied:rolled-back"), "rollback").outcome, "complete");
assert.deepEqual(seoMigrationFeedback(result("rolled-back", "partial-conflict"), "rollback"), {
	outcome: "partial",
	title: "Migration batch partly rolled back",
});
assert.equal(seoMigrationFeedback(result("operation-busy"), "rollback").outcome, "needs-review");

console.log("shipit-seo migration feedback self-check passed");
