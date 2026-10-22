import assert from "node:assert/strict";
import type { SeoAdminContentScore } from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	createSeoSessionAudit,
	changedSeoSessionAuditRefs,
	mergeSeoSessionAudit,
	nextSeoSessionAuditRefs,
	SEO_SESSION_AUDIT_RETAIN_LIMIT,
} from "./session-audit-model.ts";

function score(ref: string, checks: unknown[] = []): SeoAdminContentScore {
	return { ref, score: 80, checks, freshness: "current" } as SeoAdminContentScore;
}

const inventory = Array.from({ length: 500 }, (_, index) => `posts:${index}`);
assert.deepEqual(nextSeoSessionAuditRefs(["posts:0", ...inventory], []), inventory.slice(0, 25));
assert.deepEqual(nextSeoSessionAuditRefs(inventory, inventory.slice(0, 25)), inventory.slice(25, 50));

const retained = [
	{ ...score("posts:0"), sourceUpdatedAt: "2026-09-09T10:00:00.000Z" },
	{ ...score("posts:1"), sourceUpdatedAt: "2026-09-09T10:00:00.000Z" },
	{ ...score("posts:2"), sourceUpdatedAt: null },
	{ ...score("posts:3"), sourceUpdatedAt: "2026-09-09T10:00:00.000Z" },
];
assert.deepEqual(changedSeoSessionAuditRefs([
	{ ref: "posts:0", updatedAt: "2026-09-09T10:00:00.000Z" },
	{ ref: "posts:1", updatedAt: "2026-09-09T10:01:00.000Z" },
	{ ref: "posts:1", updatedAt: "2026-09-09T10:01:00.000Z" },
	{ ref: "posts:2", updatedAt: null },
	{ ref: "posts:999", updatedAt: "2026-09-09T10:01:00.000Z" },
], retained), ["posts:1"]);
assert.deepEqual(changedSeoSessionAuditRefs([], retained), []);
const savedAt = "2026-09-09T10:00:00.000Z";
assert.deepEqual(changedSeoSessionAuditRefs([
	{ ref: "posts:0", updatedAt: savedAt, sourceVersion: "draft:2" },
	{ ref: "posts:1", updatedAt: savedAt, sourceVersion: "draft:1" },
	{ ref: "posts:2", updatedAt: savedAt, sourceVersion: "draft:1" },
	{ ref: "posts:3", updatedAt: savedAt },
	{ ref: "posts:4", updatedAt: savedAt, sourceVersion: "draft:1" },
], [
	{ ...score("posts:0"), sourceUpdatedAt: savedAt, sourceVersion: "draft:1" },
	{ ...score("posts:1"), sourceUpdatedAt: savedAt, sourceVersion: "draft:1" },
	{ ...score("posts:2"), sourceUpdatedAt: savedAt },
	{ ...score("posts:3"), sourceUpdatedAt: savedAt, sourceVersion: "draft:1" },
]), ["posts:0", "posts:2", "posts:3"]);
assert.deepEqual(changedSeoSessionAuditRefs(
	inventory.slice(0, 30).map((ref) => ({ ref, updatedAt: "new" })),
	inventory.slice(0, 30).map((ref) => ({ ...score(ref), sourceUpdatedAt: "old" })),
), inventory.slice(0, 25));

let session = mergeSeoSessionAudit(createSeoSessionAudit(), ["posts:0", "posts:1"], {
	items: [score("posts:0", [{ id: "missing-alt" }])],
	failures: [{ ref: "posts:1", error: "Entry could not be read." }],
});
assert.deepEqual(session.lastBatch, { analyzed: 1, failed: 1 });
assert.deepEqual(session.analyzedRefs, ["posts:0"]);

session = mergeSeoSessionAudit(session, ["posts:0"], { items: [score("posts:0")], failures: [] });
assert.equal(session.entries.filter((entry) => entry.ref === "posts:0").length, 1);
assert.deepEqual(session.entries.find((entry) => entry.ref === "posts:0")?.score?.checks, []);
assert.deepEqual(session.analyzedRefs, ["posts:0"]);

session = mergeSeoSessionAudit(session, ["posts:0"], {
	items: [],
	failures: [{ ref: "posts:0", error: "Temporarily unavailable." }],
});
assert.equal(session.entries.find((entry) => entry.ref === "posts:0")?.score, null);
assert.equal(session.entries.find((entry) => entry.ref === "posts:0")?.error, "Temporarily unavailable.");

session = mergeSeoSessionAudit(session, ["posts:0"], { items: [score("posts:0")], failures: [] });
assert.equal(session.entries.find((entry) => entry.ref === "posts:0")?.error, null);

const missing = mergeSeoSessionAudit(session, ["posts:2"], {
	items: [score("posts:999")],
	failures: [],
});
assert.equal(missing.entries.some((entry) => entry.ref === "posts:999"), false);
assert.match(missing.entries.find((entry) => entry.ref === "posts:2")?.error ?? "", /no result/);

for (let offset = 0; offset < inventory.length; offset += 25) {
	const refs = inventory.slice(offset, offset + 25);
	session = mergeSeoSessionAudit(session, refs, {
		items: refs.filter((_, index) => index % 2 === 0).map((ref) => score(ref)),
		failures: refs.filter((_, index) => index % 2 !== 0).map((ref) => ({ ref, error: "Retry needed." })),
	});
	assert.ok(session.entries.length <= SEO_SESSION_AUDIT_RETAIN_LIMIT);
	assert.ok(session.attemptedRefs.length <= SEO_SESSION_AUDIT_RETAIN_LIMIT);
	assert.ok(session.analyzedRefs.length <= SEO_SESSION_AUDIT_RETAIN_LIMIT);
}
assert.equal(session.entries.length, SEO_SESSION_AUDIT_RETAIN_LIMIT);
assert.deepEqual(session.entries.map((entry) => entry.ref), inventory.slice(-200));
assert.deepEqual(nextSeoSessionAuditRefs(inventory.slice(-200), session.attemptedRefs), []);
assert.deepEqual(createSeoSessionAudit().entries, []);

console.log("Session audit model selfcheck passed.");
