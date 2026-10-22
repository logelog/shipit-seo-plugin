import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as scoreRefresh from "./score-refresh.ts";

const { invalidateScoreData, runScoreRefreshAndInvalidate } = scoreRefresh;

// Durable scans replaced the manual first-100 batches; no batch helper or page cap remains.
assert.deepEqual(Object.keys(scoreRefresh).sort(), ["invalidateScoreData", "runScoreRefreshAndInvalidate"]);
const controls = readFileSync(new URL("./content-scoring-controls.tsx", import.meta.url), "utf8");
for (const retired of ["runBoundedScoreScan", "SCORE_SCAN_PAGE_SIZE", "SCORE_SCAN_MAX_PAGES_PER_RUN", "refreshSeoScores", "manual batches"])
	assert.ok(!controls.includes(retired), `Content health no longer uses ${retired}`);
assert.match(controls, /commandSeoScoreScan/, "Content health continues through the durable scan command");

let invalidations = 0;
await assert.rejects(
	() =>
		runScoreRefreshAndInvalidate(
			async () => {
				throw new Error("Injected refresh failure");
			},
			async () => {
				invalidations += 1;
			},
		),
	/Injected refresh failure/,
);
assert.equal(
	invalidations,
	1,
	"a saved configuration must invalidate cached score data even when refresh fails",
);

const invalidatedKeys: Array<readonly unknown[]> = [];
await invalidateScoreData({
	invalidateQueries: async ({ queryKey }: { queryKey: readonly unknown[] }) => {
		invalidatedKeys.push(queryKey);
	},
});
assert.ok(
	invalidatedKeys.some((queryKey) => queryKey[0] === "shipit-seo-content-scores"),
	"template refresh invalidation must evict content editor score caches",
);
assert.ok(
	invalidatedKeys.some(
		(queryKey) => queryKey[0] === "shipit-seo-workspace" && queryKey[1] === "overview",
	),
	"template refresh invalidation must evict workspace score summaries",
);

console.log("shipit-seo score refresh self-check passed");
