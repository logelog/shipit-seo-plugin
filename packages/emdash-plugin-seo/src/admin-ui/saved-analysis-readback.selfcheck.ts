import assert from "node:assert/strict";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ENGINE_VERSION,
	SEO_SCORE_VERSION,
	type SeoAdminContentScore,
	type SeoAdminSavedAnalysisResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	createSavedAnalysisReadback,
	savedAnalysisReadbackWarning,
	verifiedSavedAnalysisForTarget,
	type SavedAnalysisReadbackState,
	type SavedAnalysisReadbackTarget,
} from "./saved-analysis-readback.ts";

const target: SavedAnalysisReadbackTarget = { ref: "pages:dental", locale: "en", savedVersion: "saved-v1" };
const score = {
	ref: target.ref,
	collection: "pages",
	entryId: "dental",
	scoreVersion: SEO_SCORE_VERSION,
	analysisRevision: 3,
	inputIdentity: `seo-input-v1-sha256-${"a".repeat(64)}`,
	sourceVersion: target.savedVersion,
	freshness: "current",
	score: 94,
} as SeoAdminContentScore;
const accepted = (outcome: "saved" | "reused" = "saved") => {
	const { freshness: _freshness, ...item } = score;
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		success: true,
		ref: target.ref,
		outcome,
		history: outcome === "saved" ? "created" : "not-attempted",
		item,
	} as Extract<SeoAdminSavedAnalysisResult, { success: true }>;
};
const emptyState = (): SavedAnalysisReadbackState => ({ target: null, score: null, pending: false, failure: null });
const harness = (read: (ref: string, signal: AbortSignal) => Promise<SeoAdminContentScore | null>, deadlineMs?: number) => {
	let state = emptyState();
	const changes: SavedAnalysisReadbackState[] = [];
	const controller = createSavedAnalysisReadback({
		read,
		deadlineMs,
		onChange: (next) => { state = next; changes.push(next); },
	});
	return { controller, changes, get state() { return state; } };
};

for (const outcome of ["saved", "reused"] as const) {
	let requests = 0;
	const run = harness(async (ref) => { requests += 1; assert.equal(ref, target.ref); return score; });
	assert.equal(requests, 0, "mounting the controller starts no read");
	assert.equal(await run.controller.verify(accepted(outcome), target, run.controller.begin()), "verified");
	assert.equal(requests, 1, "one explicit durable success makes one read without retry");
	assert.equal(verifiedSavedAnalysisForTarget(run.state, target), score);
	assert.equal(run.state.score?.persistence, undefined, "verified durable output is never converted into a session result");
	assert.equal(run.changes[1]?.pending, true);
	run.controller.invalidate();
	assert.equal(verifiedSavedAnalysisForTarget(run.state, target), null);
	assert.equal(requests, 1, "invalidation makes no request");
}

for (const patch of [
	{ freshness: undefined },
	{ freshness: "stale" },
	{ ref: "pages:other" },
	{ entryId: "other" },
	{ sourceVersion: "saved-v2" },
	{ scoreVersion: SEO_SCORE_VERSION - 1 },
	{ persistence: "session", entryInputFingerprint: `sha256-${"b".repeat(64)}` },
	{ inputIdentity: undefined },
	{ inputIdentity: `seo-input-v2-sha256-${"a".repeat(64)}` },
	{ inputIdentity: `seo-input-v1-sha256-${"b".repeat(64)}` },
	{ analysisRevision: 4 },
	{ analysisRevision: 0 },
]) {
	const run = harness(async () => ({ ...score, ...patch }) as SeoAdminContentScore);
	assert.equal(await run.controller.verify(accepted(), target, run.controller.begin()), "changed", JSON.stringify(patch));
	assert.equal(run.state.score, null, "a mismatched or unverified readback cannot become current");
	assert.equal(run.state.failure, "changed");
}

const missing = harness(async () => null);
assert.equal(await missing.controller.verify(accepted(), target, missing.controller.begin()), "changed");
assert.equal(missing.state.score, null);
let failedRequests = 0;
const unavailable = harness(async () => { failedRequests += 1; throw new Error("settings unreadable"); });
assert.equal(await unavailable.controller.verify(accepted(), target, unavailable.controller.begin()), "unavailable");
assert.equal(failedRequests, 1, "a failed verification does not retry the read or repeat the durable action");
assert.equal(unavailable.state.failure, "unavailable");
assert.match(savedAnalysisReadbackWarning("unavailable")!, /stored result.*could not be checked/i);
assert.match(savedAnalysisReadbackWarning("unavailable")!, /unconfirmed/i);
assert.match(savedAnalysisReadbackWarning("changed")!, /could not be confirmed/i);
assert.equal(savedAnalysisReadbackWarning("verified"), null);
assert.equal(savedAnalysisReadbackWarning("superseded"), null);

let timeoutResolve!: (score: SeoAdminContentScore) => void;
let timeoutSignal!: AbortSignal;
const timedOut = harness((_ref, signal) => {
	timeoutSignal = signal;
	return new Promise((resolve) => { timeoutResolve = resolve; });
}, 5);
assert.equal(await timedOut.controller.verify(accepted(), target, timedOut.controller.begin()), "unavailable",
	"a hung read ends with unconfirmed freshness after the bounded deadline");
assert.equal(timeoutSignal.aborted, true);
assert.equal(timedOut.state.failure, "unavailable");
timeoutResolve(score);
await Promise.resolve();
assert.equal(timedOut.state.score, null, "a late response after the deadline never restores current checks");

let invalidRequests = 0;
const invalid = harness(async () => { invalidRequests += 1; return score; });
assert.equal(await invalid.controller.verify(accepted(), { ...target, savedVersion: "saved-v2" }, invalid.controller.begin()), "changed");
assert.equal(await invalid.controller.verify({ ...accepted(), ref: "pages:other" }, target, invalid.controller.begin()), "changed");
assert.equal(await invalid.controller.verify({ ...accepted(), item: { ...score, persistence: "session" } }, target, invalid.controller.begin()), "changed");
assert.equal(invalidRequests, 0, "invalid or older mutation payloads do not start a freshness read");

const complete = harness(async () => score);
await complete.controller.verify(accepted(), target, complete.controller.begin());
for (const changed of [
	{ ...target, ref: "pages:other" },
	{ ...target, locale: "tr" },
	{ ...target, savedVersion: "saved-v2" },
]) assert.equal(verifiedSavedAnalysisForTarget(complete.state, changed), null, "proof is bound to the ref, locale and saved version");

let afterBoundaryRequests = 0;
const afterBoundary = harness(async () => { afterBoundaryRequests += 1; return score; });
const beforeBoundary = afterBoundary.controller.begin();
afterBoundary.controller.invalidate();
let newerSessionInvalidated = false;
if (afterBoundary.controller.isCurrent(beforeBoundary)) newerSessionInvalidated = true;
assert.equal(newerSessionInvalidated, false, "a late durable callback cannot invalidate a newer session result");
assert.equal(await afterBoundary.controller.verify(accepted(), target, beforeBoundary), "superseded");
assert.equal(afterBoundaryRequests, 0, "a mutation response held across an invalidation cannot start a later readback");
assert.deepEqual(afterBoundary.state, emptyState());

let resolveLate!: (score: SeoAdminContentScore) => void;
let lateSignal!: AbortSignal;
const late = harness((_ref, signal) => {
	lateSignal = signal;
	return new Promise((resolve) => { resolveLate = resolve; });
});
const pending = late.controller.verify(accepted(), target, late.controller.begin());
late.controller.invalidate();
assert.equal(lateSignal.aborted, true);
resolveLate(score);
assert.equal(await pending, "superseded", "a read held across focus/save/profile/settings invalidation is ignored");
assert.deepEqual(late.state, emptyState(), "a late response cannot restore current checks");

let firstResolve!: (score: SeoAdminContentScore) => void;
let started = 0;
const replaced = harness(async () => {
	started += 1;
	return started === 1 ? new Promise((resolve) => { firstResolve = resolve; }) : score;
});
const first = replaced.controller.verify(accepted(), target, replaced.controller.begin());
assert.equal(await replaced.controller.verify(accepted("reused"), target, replaced.controller.begin()), "verified");
firstResolve({ ...score, freshness: "stale" });
assert.equal(await first, "superseded");
assert.equal(replaced.state.score, score, "an older read cannot replace the newer confirmed result");

// After a reload, the stored result for this saved version is shown once one freshness read confirms it.
{
	const { freshness: _freshness, ...stored } = score;
	const snapshot = stored as SeoAdminContentScore;
	let reads = 0;
	const reloaded = harness(async () => { reads += 1; return score; });
	assert.equal(await reloaded.controller.confirmStored(snapshot, target, reloaded.controller.begin()), "verified");
	assert.equal(reads, 1, "one read, never an analysis or a retry");
	assert.equal(verifiedSavedAnalysisForTarget(reloaded.state, target), score);
	const changed = harness(async () => ({ ...score, freshness: "stale" as const }));
	assert.equal(await changed.controller.confirmStored(snapshot, target, changed.controller.begin()), "changed",
		"inputs that changed since the result was stored keep the browser checks");
	assert.equal(verifiedSavedAnalysisForTarget(changed.state, target), null);
	const otherVersion = harness(async () => score);
	assert.equal(await otherVersion.controller.confirmStored(snapshot, { ...target, savedVersion: "saved-v2" }, otherVersion.controller.begin()), "changed",
		"a result for another saved version is not confirmed or read");
	const replacedIdentity = harness(async () => ({ ...score, inputIdentity: `seo-input-v1-sha256-${"b".repeat(64)}` }));
	assert.equal(await replacedIdentity.controller.confirmStored(snapshot, target, replacedIdentity.controller.begin()), "changed");
}

console.log("Saved analysis readback self-checks passed.");
