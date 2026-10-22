import assert from "node:assert/strict";

import { forwardedPathsState } from "./forwarded-paths-model.ts";

const empty = { totalHits: 0, uniquePaths: 0, openPaths: 0, resolvedPaths: 0 };
const item = {
	id: "path-1", path: "/old", hits: 2, firstSeenAt: "2026-10-01T10:00:00.000Z", lastSeenAt: "2026-10-02T10:00:00.000Z",
	status: "open", redirectTarget: null, suggestions: [],
} as never;

assert.deepEqual(forwardedPathsState({ enabled: false, items: [], summary: empty }), { kind: "off-empty" });
assert.deepEqual(forwardedPathsState({ enabled: true, items: [], summary: empty }), { kind: "on-empty" },
	"the capture setting alone is not a connected integration or a success");
assert.deepEqual(forwardedPathsState({ enabled: false, items: [item], summary: { ...empty, totalHits: 2, uniquePaths: 1, openPaths: 1 } }),
	{ kind: "records", captureOff: true }, "stored paths stay visible while capture is off");
assert.deepEqual(forwardedPathsState({ enabled: true, items: [item], summary: { ...empty, totalHits: 2, uniquePaths: 1, openPaths: 1 } }),
	{ kind: "records", captureOff: false });
assert.deepEqual(forwardedPathsState({ enabled: false, items: [], summary: { ...empty, uniquePaths: 3 } }),
	{ kind: "records", captureOff: true }, "a summary of stored paths outside the loaded page still counts as records");

console.log("SEO forwarded paths view model self-check passed.");
