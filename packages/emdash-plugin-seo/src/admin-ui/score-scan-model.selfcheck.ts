import assert from "node:assert/strict";

import type { SeoAdminScoreScanCounters, SeoAdminScoreScanResult, SeoAdminScoreScanView } from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	SCORE_SCAN_TERMS_PER_TAXONOMY_MAX,
	addScoreScanTerm,
	initialScoreScanForm,
	SCORE_SCAN_PAUSE_RESUMED_ELSEWHERE,
	nextScoreScanStep,
	reconcileScoreScanRequests,
	scoreScanDetailCounters,
	scoreScanFailureMessage,
	scoreScanFormErrors,
	scoreScanFormForCollections,
	scoreScanHistoryWarning,
	scoreScanNeedsAnalysisEnabled,
	scoreScanNeedsProfileRefresh,
	scoreScanPrimaryCounters,
	scoreScanProgressText,
	scoreScanRequestsFor,
	scoreScanStartRequest,
	scoreScanStatePresentation,
	scoreScanTermLimitReached,
	type ScoreScanTaxonomyDraft,
} from "./score-scan-model.ts";

const counters = (values: Partial<SeoAdminScoreScanCounters> = {}): SeoAdminScoreScanCounters => ({
	fetchedCandidates: 0, examinedCandidates: 0, matchedReferences: 0, noLongerMatching: 0, admitted: 0, attempts: 0, analyzed: 0,
	reused: 0, saved: 0, superseded: 0, skipped: 0, failed: 0, retried: 0, uncertain: 0,
	historyCreated: 0, historyUnchanged: 0, historyFailed: 0, historyUncertain: 0, historyUnknown: 0,
	...values,
});

const view = (values: Partial<SeoAdminScoreScanView> = {}): SeoAdminScoreScanView => ({
	runId: "scan-run-00000001", revision: 4, state: "running", pauseReason: null, completion: null,
	createdAt: "2026-10-04T10:00:00.000Z", updatedAt: "2026-10-04T10:01:00.000Z",
	scope: { collection: "posts", status: "published", locale: null, taxonomies: [] },
	target: { mode: "count", count: 100 }, counters: counters({ admitted: 12, saved: 7, reused: 3, failed: 2 }),
	failureStreak: 0, unit: null, retry: null, bufferedReferences: 3, exhausted: false, outcomes: [], outcomeRetention: 20,
	...values,
});

const success = (scan: SeoAdminScoreScanView, extra: Record<string, unknown> = {}): SeoAdminScoreScanResult => ({
	contractVersion: 33 as never, engineVersion: "test", success: true, command: "continue", commandId: "cmd-00000001",
	replayed: false, decision: scan.state === "running" ? "continue" : scan.state, progress: "outcome", outcome: null, scan,
	...extra,
} as SeoAdminScoreScanResult);

const failure = (error: string, scan: SeoAdminScoreScanView | null, extra: Record<string, unknown> = {}): SeoAdminScoreScanResult => ({
	contractVersion: 33 as never, engineVersion: "test", success: false, command: "continue", commandId: "cmd-00000002",
	error, detail: null, scan,
	...extra,
} as SeoAdminScoreScanResult);

// ---- Collection discovery never loops while loading, failed or empty ----

{
	const loading = initialScoreScanForm();
	assert.equal(scoreScanFormForCollections(loading, []), loading, "an empty or pending discovery keeps the same state object");
	assert.equal(scoreScanFormForCollections(scoreScanFormForCollections(loading, []), []), loading, "repeated empty renders stay stable");
	const discovered = scoreScanFormForCollections(loading, [{ collection: "posts" }, { collection: "pages" }]);
	assert.notEqual(discovered, loading);
	assert.equal(discovered.collection, "posts");
	assert.equal(scoreScanFormForCollections(discovered, [{ collection: "pages" }, { collection: "posts" }]), discovered, "an offered selection is kept");
	const withTerms = { ...discovered, collection: "gone", taxonomies: [{ taxonomy: "category", label: "Category", hierarchical: false, includeDescendants: false, terms: [] }] };
	assert.deepEqual(scoreScanFormForCollections(withTerms, [{ collection: "posts" }]).taxonomies, [], "a replaced collection drops its term selection");
	const emptied = scoreScanFormForCollections(discovered, []);
	assert.equal(emptied.collection, "");
	assert.equal(scoreScanFormForCollections(emptied, []), emptied);
}

// ---- Form validation and the exact start request ----

{
	const form = { ...initialScoreScanForm("posts"), locale: " nl-NL " };
	for (const count of ["0", "100001", "1.5", "abc", ""])
		assert.ok(scoreScanFormErrors({ ...form, count }).count, `count ${count} is refused`);
	assert.equal(scoreScanFormErrors({ ...form, mode: "all", count: "abc" }).count, undefined, "all mode has no fixed entry target");
	assert.ok(scoreScanFormErrors({ ...form, locale: "nl_NL" }).locale);
	const draft = (taxonomy: string, terms: number, hierarchical = false): ScoreScanTaxonomyDraft => ({
		taxonomy, label: taxonomy, hierarchical, includeDescendants: true,
		terms: Array.from({ length: terms }, (_, index) => ({ id: `${taxonomy}-${index}`, translationGroup: `g-${index}`, label: `T${index}`, locale: "en" })),
	});
	assert.ok(scoreScanFormErrors({ ...form, taxonomies: Array.from({ length: 9 }, (_, index) => draft(`t${index}`, 1)) }).taxonomies);
	const request = scoreScanStartRequest({ ...form, count: "25", taxonomies: [draft("category", 2, true), draft("tag", 1), draft("unused", 0)] }, "cmd-00000003", view());
	assert.deepEqual(request, {
		commandId: "cmd-00000003",
		replace: { runId: "scan-run-00000001", expectedRevision: 4 },
		collection: "posts", status: "all", locale: "nl-NL",
		taxonomies: [
			{ taxonomy: "category", termIds: ["category-0", "category-1"], includeDescendants: true },
			{ taxonomy: "tag", termIds: ["tag-0"], includeDescendants: false },
		],
		target: { mode: "count", count: 25 },
	}, "only selected terms restrict the scope, and descendants need a hierarchy");
	assert.equal(scoreScanStartRequest({ ...form, count: "0" }, "cmd-00000004", null), null);
	assert.equal(scoreScanStartRequest({ ...form, locale: "" }, "cmd-00000005", null)?.replace, null);

	const full = draft("category", SCORE_SCAN_TERMS_PER_TAXONOMY_MAX);
	assert.equal(scoreScanTermLimitReached(full), true, "the picker disables Add at the shared limit");
	assert.equal(addScoreScanTerm(full, { id: "extra", translationGroup: "g-extra", label: "Extra", locale: "en" }), full);
	const one = draft("category", 1);
	assert.equal(addScoreScanTerm(one, one.terms[0]!), one, "a selected term is not added twice");
}

// ---- Owner-facing presentation ----

{
	const progress = scoreScanProgressText(view());
	assert.equal(progress, "12 of 100 matching entries processed.");
	const all = scoreScanProgressText(view({ target: { mode: "all" } }));
	assert.match(all, /not known/);
	const finished = scoreScanProgressText(view({ target: { mode: "all" }, state: "completed", completion: "exhausted" }));
	assert.equal(finished, "12 matching entries processed.", "a completed All run reports the observed count without the unknown-total note");
	const reachedEnd = scoreScanStatePresentation(view({ target: { mode: "all" }, state: "completed", completion: "exhausted" }), { driving: false, pauseRequested: false, stopRequested: false });
	assert.match(reachedEnd.detail, /added after the start/);
	assert.match(reachedEnd.detail, /starts matching after its position was scanned/);
	assert.doesNotMatch(reachedEnd.detail, /snapshot|frozen/i, "membership is live, not a frozen snapshot");
	const scoringPaused = view({ state: "paused", pauseReason: "scoring-disabled" });
	const stillOff = scoreScanStatePresentation(scoringPaused, { driving: false, pauseRequested: false, stopRequested: false, scoringEnabled: false });
	assert.match(stillOff.detail, /^Content scoring is paused/);
	const backOn = scoreScanStatePresentation(scoringPaused, { driving: false, pauseRequested: false, stopRequested: false, scoringEnabled: true });
	assert.match(backOn.detail, /was turned off/);
	assert.match(backOn.detail, /select Resume/);
	assert.doesNotMatch(backOn.detail, /scoring is paused/i, "an enabled policy is never described as paused");
	for (const scoringEnabled of [null, undefined])
		assert.match(scoreScanStatePresentation(scoringPaused, { driving: false, pauseRequested: false, stopRequested: false, scoringEnabled }).detail,
			/^This scan paused because content scoring was turned off\. The current scoring settings cannot be confirmed/, "unread settings are never described as currently off");
	assert.ok(![progress, all].some((text) => /%|admitted|cursor|traversal/.test(text)), "progress has no percentage or internal terms");
	assert.deepEqual(scoreScanPrimaryCounters(view().counters).map((row) => [row.label, row.value]), [
		["Matching entries processed", 12], ["Scores saved", 7], ["Existing scores reused", 3], ["Failures", 2],
	]);
	const primaryKeys = new Set(scoreScanPrimaryCounters(view().counters).map((row) => row.key));
	assert.ok(scoreScanDetailCounters(view().counters).every((row) => !primaryKeys.has(row.key)), "diagnostics stay behind Details");
	assert.equal(scoreScanHistoryWarning(counters({ historyCreated: 3 })), null);
	assert.match(scoreScanHistoryWarning(counters({ historyFailed: 1, historyUnknown: 1 }))!, /2 saved scores have no confirmed history snapshot \(1 failed, 0 uncertain, 1 unknown\)/);

	const idle = { driving: false, pauseRequested: false, stopRequested: false };
	assert.equal(scoreScanStatePresentation(view(), { ...idle, driving: true }).label, "Analyzing");
	assert.equal(scoreScanStatePresentation(view(), idle).label, "Waiting to resume", "a reopened panel offers Resume and never continues by itself");
	assert.equal(scoreScanStatePresentation(view({ unit: { phase: "analysis", ref: "posts:a", leaseExpiresAt: "2026-10-04T10:03:00.000Z", active: true } }), idle).label, "Running elsewhere");
	assert.equal(scoreScanStatePresentation(view(), { ...idle, driving: true, stopRequested: true }).label, "Stopping", "requested stopping is not stopped");
	assert.equal(scoreScanStatePresentation(view(), { ...idle, stopRequested: true }).label, "Stop not confirmed");
	assert.equal(scoreScanStatePresentation(view({ state: "stopped" }), { ...idle, stopRequested: true }).label, "Stopped", "only the server confirms Stopped");
	assert.match(scoreScanFailureMessage("invalid_scope", "Select fewer terms."), /Select fewer terms\.$/);
	assert.doesNotMatch(scoreScanFailureMessage("source_unavailable", "SQLITE_IOERR"), /SQLITE/, "read failure details are not shown as selection advice");
}

// ---- Explicit profile recovery, without one profile request per analyzed entry ----
{
	for (const command of ["start", "resume"])
		assert.equal(scoreScanNeedsProfileRefresh(success(view(), { command })), true);
	for (const pauseReason of ["profile-required", "profile-unavailable", "policy-changed"])
		assert.equal(scoreScanNeedsProfileRefresh(success(view({ state: "paused", pauseReason: pauseReason as never }))), true);
	for (const error of ["profile_required", "profile_unavailable"])
		assert.equal(scoreScanNeedsProfileRefresh(failure(error, null)), true);
	assert.equal(scoreScanNeedsProfileRefresh(success(view())), false, "ordinary continuation adds no profile polling");
	assert.equal(scoreScanNeedsProfileRefresh(failure("busy", view())), false);
	assert.equal(scoreScanNeedsProfileRefresh(success(view({ state: "paused", pauseReason: "requested" }), { command: "pause" })), false);
}

// ---- Continuation: one request at a time, queued Stop and Pause, never after uncertainty ----

{
	const none = { pauseRequested: false, stopRequested: false };
	assert.equal(nextScoreScanStep(success(view()), none).kind, "continue");
	assert.equal(nextScoreScanStep(success(view({ state: "paused", pauseReason: "policy-changed" })), none).kind, "idle");
	for (const [pauseReason, error] of [
		["activation-required", "activation_required"],
		["profile-required", "profile_required"],
		["profile-unavailable", "profile_unavailable"],
	] as const) {
		const paused = view({ state: "paused", pauseReason });
		assert.equal(nextScoreScanStep(success(paused), none).kind, "idle", "restoring admission never resumes a scan automatically");
		assert.match(scoreScanStatePresentation(paused, { driving: false, ...none }).detail, /Resume|resuming/);
		assert.ok(scoreScanFailureMessage(error, null).length > 0);
	}

	assert.equal(nextScoreScanStep(success(view()), { ...none, stopRequested: true }).kind, "stop");
	assert.equal(nextScoreScanStep(success(view()), { ...none, pauseRequested: true }).kind, "pause");
	assert.equal(nextScoreScanStep(success(view({ state: "paused", pauseReason: "requested" }), { command: "pause", decision: "paused" }), { ...none, pauseRequested: true }).kind, "idle");

	const uncertain = nextScoreScanStep(failure("uncertain", view(), { detail: "The acceptance receipt could not be read back." }), { ...none, stopRequested: true });
	assert.equal(uncertain.kind, "idle", "an uncertain answer never continues or sends another command");
	assert.deepEqual(uncertain.kind === "idle" && uncertain.pending, { pause: false, stop: true }, "the queued Stop stays visible");
	const uncertainAlone = nextScoreScanStep(failure("uncertain", view()), none);
	assert.equal(uncertainAlone.kind, "idle");

	const unavailable = nextScoreScanStep(failure("storage_unavailable", view()), { ...none, stopRequested: true, pauseRequested: true });
	assert.deepEqual(unavailable.kind === "idle" && unavailable.pending, { pause: false, stop: true }, "an unresolved write keeps the dominant Stop visible");
	const pauseOnly = nextScoreScanStep(failure("storage_unavailable", view()), { ...none, pauseRequested: true });
	assert.deepEqual(pauseOnly.kind === "idle" && pauseOnly.pending, { pause: true, stop: false }, "an unresolved write keeps a lone Pause visible");

	const refreshed = view({ revision: 9 });
	const stale = nextScoreScanStep(failure("stale_revision", refreshed), { ...none, stopRequested: true }, refreshed.runId);
	assert.deepEqual([stale.kind, stale.view?.revision], ["stop", 9], "a queued Stop applies to the refreshed state of the same run");
	const busy = nextScoreScanStep(failure("busy", refreshed), { ...none, pauseRequested: true }, refreshed.runId);
	assert.equal(busy.kind, "pause");
	const busyAlone = nextScoreScanStep(failure("busy", refreshed), none, refreshed.runId);
	assert.equal(busyAlone.kind, "idle", "busy never continues without a request");

	const replaced = nextScoreScanStep(failure("stale_run", view({ runId: "scan-run-00000002" })), { ...none, stopRequested: true }, "scan-run-00000001");
	assert.equal(replaced.kind, "idle", "a queued Stop never applies to the run that replaced its own");
	assert.deepEqual(replaced.kind === "idle" && replaced.pending, { pause: false, stop: false });
	const stoppedElsewhere = nextScoreScanStep(failure("not_running", view({ state: "stopped" })), { ...none, stopRequested: true }, "scan-run-00000001");
	assert.deepEqual(stoppedElsewhere.kind === "idle" && stoppedElsewhere.pending, { pause: false, stop: false }, "an already stopped run needs no queued Stop");
}

// ---- Requests belong to the run they were made for ----

{
	const runA = "scan-run-00000001";
	const runB = "scan-run-00000002";
	// A Stop sent during a request that ended uncertain stays pending for run A only.
	const failedStop = nextScoreScanStep(failure("uncertain", view({ runId: runA })), scoreScanRequestsFor({ runId: runA, pause: false, stop: true }, runA), runA);
	assert.equal(failedStop.kind, "idle");
	const pending = { runId: runA, ...(failedStop.kind === "idle" ? failedStop.pending : { pause: false, stop: false }) };
	assert.deepEqual(scoreScanRequestsFor(pending, runA), { pauseRequested: false, stopRequested: true });

	// Replacing run A with a successful start must not stop or pause run B.
	const started = success(view({ runId: runB, revision: 1, counters: counters() }), { command: "start", progress: "state" });
	assert.deepEqual(scoreScanRequestsFor(pending, runB), { pauseRequested: false, stopRequested: false });
	assert.equal(nextScoreScanStep(started, scoreScanRequestsFor(pending, runB), runB).kind, "continue", "the new run continues");
	const pausedPending = { runId: runA, pause: true, stop: false };
	assert.equal(nextScoreScanStep(started, scoreScanRequestsFor(pausedPending, runB), runB).kind, "continue");

	// A refresh that shows another run never displays or retries run A's request.
	const replacedView = view({ runId: runB });
	assert.equal(scoreScanStatePresentation(replacedView, { driving: false, ...scoreScanRequestsFor(pending, replacedView.runId) }).label, "Waiting to resume");
	assert.equal(scoreScanStatePresentation(view({ runId: runA }), { driving: false, ...scoreScanRequestsFor(pending, runA) }).label, "Stop not confirmed",
		"control: the original run still shows its unconfirmed Stop");
	assert.deepEqual(scoreScanRequestsFor({ runId: null, pause: true, stop: true }, runA), { pauseRequested: false, stopRequested: false });
}

// ---- Stop dominates queued requests, and confirmed state answers them ----

{
	const runA = "scan-run-00000001";
	const both = { pauseRequested: true, stopRequested: true };
	const busyView = view({ runId: runA, revision: 7 });
	const failedStop = nextScoreScanStep(failure("busy", busyView, { command: "stop" }), both, runA);
	assert.equal(failedStop.kind, "idle", "a failed Stop never falls through to Pause");
	assert.deepEqual(failedStop.kind === "idle" && failedStop.pending, { pause: false, stop: true });
	const failedPause = nextScoreScanStep(failure("busy", busyView, { command: "pause" }), both, runA);
	assert.equal(failedPause.kind, "stop", "a failed Pause with a queued Stop sends Stop once");
	assert.equal(nextScoreScanStep(success(busyView), both, runA).kind, "stop", "a queued Stop is sent before Pause");

	// The panel's loop over repeated busy and stale answers ends after a single Stop.
	let command: "continue" | "pause" | "stop" = "pause";
	const sent: string[] = [];
	for (let round = 0; round < 6; round += 1) {
		sent.push(command);
		const step = nextScoreScanStep(failure(round % 2 ? "stale_revision" : "busy", busyView, { command }), both, runA);
		if (step.kind === "idle") break;
		command = step.kind;
	}
	assert.deepEqual(sent, ["pause", "stop"], "busy or stale answers cannot alternate Stop and Pause automatically");

	// A Pause that succeeded on the server but lost its response is answered by the refreshed state.
	const pausedReadback = view({ runId: runA, state: "paused", pauseReason: "requested" });
	assert.deepEqual(reconcileScoreScanRequests({ runId: runA, pause: true, stop: false }, pausedReadback), { runId: null, pause: false, stop: false });
	assert.equal(scoreScanStatePresentation(pausedReadback, { driving: false, ...scoreScanRequestsFor(reconcileScoreScanRequests({ runId: runA, pause: true, stop: false }, pausedReadback), runA) }).label,
		"Paused", "a confirmed pause is shown as paused, not as an unconfirmed request");
	assert.equal(scoreScanStatePresentation(pausedReadback, { driving: false, pauseRequested: true, stopRequested: false }).label, "Paused",
		"presentation never asks to repeat a Pause the state already confirms");
	assert.deepEqual(reconcileScoreScanRequests({ runId: runA, pause: true, stop: true }, pausedReadback), { runId: runA, pause: false, stop: true },
		"a genuine unconfirmed Stop survives a paused readback");
	for (const ended of [view({ runId: runA, state: "stopped" }), view({ runId: runA, state: "completed", completion: "exhausted" })])
		assert.deepEqual(reconcileScoreScanRequests({ runId: runA, pause: true, stop: true }, ended), { runId: null, pause: false, stop: false });
	assert.deepEqual(reconcileScoreScanRequests({ runId: runA, pause: true, stop: false }, view({ runId: runA })), { runId: runA, pause: true, stop: false },
		"a running readback keeps an unconfirmed Pause");
	assert.deepEqual(reconcileScoreScanRequests({ runId: runA, pause: false, stop: true }, view({ runId: "scan-run-00000009" })), { runId: null, pause: false, stop: false });
	assert.deepEqual(reconcileScoreScanRequests({ runId: runA, pause: false, stop: true }, null), { runId: null, pause: false, stop: false });

	// A replayed Pause whose current state is running: Pause was applied, then another panel resumed.
	// The panel clears its own Pause before this call and keeps a queued Stop.
	const resumedElsewhere = success(view({ runId: runA }), { command: "pause", replayed: true, decision: "paused" });
	const ended = nextScoreScanStep(resumedElsewhere, { pauseRequested: false, stopRequested: false }, runA);
	assert.deepEqual([ended.kind, ended.kind === "idle" && ended.message, ended.kind === "idle" && ended.pending], ["idle", SCORE_SCAN_PAUSE_RESUMED_ELSEWHERE, { pause: false, stop: false }],
		"an applied Pause ends this panel's drive without claiming the shared run is paused");
	assert.doesNotMatch(SCORE_SCAN_PAUSE_RESUMED_ELSEWHERE, /remains paused|is paused/i);
	assert.equal(nextScoreScanStep(resumedElsewhere, { pauseRequested: false, stopRequested: true }, runA).kind, "stop", "a queued Stop still dominates");
	assert.equal(nextScoreScanStep(success(view({ runId: runA }), { command: "resume" }), { pauseRequested: false, stopRequested: false }, runA).kind, "continue",
		"control: a normal resumed command continues");
	// A Pause replayed after the run was stopped or completed reports the current terminal state, never Paused or Resume.
	for (const [ended, message] of [
		[view({ runId: runA, state: "stopped" }), "Stopped. Saved scores and history remain."],
		[view({ runId: runA, state: "completed", completion: "target-reached" }), "The selected amount was processed."],
		[view({ runId: runA, state: "completed", completion: "exhausted" }), "The scan reached the last content that existed when it started."],
	] as const) {
		const replayed = nextScoreScanStep(success(ended, { command: "pause", replayed: true, decision: "paused" }), { pauseRequested: false, stopRequested: false }, runA);
		assert.deepEqual([replayed.kind, replayed.kind === "idle" && replayed.message], ["idle", message], `a replayed Pause reports the ${ended.state} state`);
		assert.doesNotMatch(replayed.kind === "idle" ? replayed.message ?? "" : "", /Resume|Paused/);
	}

	// Uncertainty still never continues or retries by itself.
	const uncertain = nextScoreScanStep(failure("uncertain", busyView, { command: "continue" }), both, runA);
	assert.deepEqual([uncertain.kind, uncertain.kind === "idle" && uncertain.pending], ["idle", { pause: false, stop: true }]);
}

// Only a successful read that says analysis is paused or awaits review asks the person to enable it.
{
	const read = (policyState: string | undefined, values: unknown = {}, isError = false) => scoreScanNeedsAnalysisEnabled({ isError, values, policyState });
	assert.equal(read("paused"), true);
	assert.equal(read("pending-confirmation"), true);
	assert.equal(read("enabled"), false);
	assert.equal(read("unavailable"), false, "An unavailable acknowledgement is not reported as switched off");
	assert.equal(read(undefined, undefined), false, "A pending read is not reported as switched off");
	assert.equal(read("paused", null), false, "Unreadable settings are not reported as switched off");
	assert.equal(read("paused", {}, true), false, "A failed refresh is not reported as switched off");
}

console.log("shipit-seo score scan model self-check passed");
