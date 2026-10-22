import assert from "node:assert/strict";

import { parseCore404Summary } from "./core-404-summary.ts";

assert.deepEqual(
	parseCore404Summary({
		items: [{ path: "/missing", count: 3, lastSeen: "2026-09-25T10:00:00.000Z", topReferrer: "https://example.com/" }],
	}),
	[{ path: "/missing", count: 3, lastSeen: "2026-09-25T10:00:00.000Z" }],
);
assert.deepEqual(parseCore404Summary({ items: [] }), []);
assert.throws(() => parseCore404Summary({ count: 0 }), /Invalid EmDash 404 summary response/);
assert.throws(
	() => parseCore404Summary({ items: [{ path: "/missing", count: "3", lastSeen: "today" }] }),
	/Invalid EmDash 404 summary item/,
);

console.log("Core 404 summary self-check passed.");
