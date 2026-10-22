import assert from "node:assert/strict";

import { parseCoreRedirectPage } from "./redirect-manager.ts";

const rule = {
	id: "redirect-1",
	source: "/old",
	destination: "/new",
	type: 301,
	isPattern: false,
	enabled: true,
	hits: 0,
	lastHitAt: null,
	groupName: null,
	auto: false,
	createdAt: "2026-07-17T10:00:00.000Z",
	updatedAt: "2026-07-17T10:00:00.000Z",
};

const parsed = parseCoreRedirectPage({ items: [rule], nextCursor: "next" });
assert.equal(parsed.items[0]?.source, "/old");
assert.equal(parsed.nextCursor, "next");
assert.deepEqual(parseCoreRedirectPage({ items: [] }), { items: [], nextCursor: null });
assert.throws(() => parseCoreRedirectPage({ items: [{ source: "/old" }] }), /Invalid core redirect response/);
assert.throws(() => parseCoreRedirectPage({ items: [], nextCursor: null }), /Invalid core redirect cursor/);

console.log("SEO redirect inventory self-check passed.");
