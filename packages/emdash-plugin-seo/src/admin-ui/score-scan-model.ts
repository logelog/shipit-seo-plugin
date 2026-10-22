import type {
	SeoAdminScoreScanCounters,
	SeoAdminScoreScanFailure,
	SeoAdminScoreScanOutcome,
	SeoAdminScoreScanResult,
	SeoAdminScoreScanStartRequest,
	SeoAdminScoreScanStatus,
	SeoAdminScoreScanTerm,
	SeoAdminScoreScanView,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

export const SCORE_SCAN_COUNT_MAX = 100_000;
export const SCORE_SCAN_TAXONOMY_MAX = 8;
export const SCORE_SCAN_TERMS_PER_TAXONOMY_MAX = 64;
export const SCORE_SCAN_TERM_SEARCH_DEBOUNCE_MS = 300;
export const SCORE_SCAN_TERM_SEARCH_MAX = 100;

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export const scoreScanQueryKeys = {
	state: ["shipit-seo", "score-scan"] as const,
	taxonomies: (collection: string) => ["shipit-seo", "score-scan", "taxonomies", collection] as const,
	terms: (collection: string, taxonomy: string, locale: string | null, search: string, cursor: string | null) =>
		["shipit-seo", "score-scan", "terms", collection, taxonomy, locale, search, cursor] as const,
};

export interface ScoreScanTaxonomyDraft {
	taxonomy: string;
	label: string;
	hierarchical: boolean;
	includeDescendants: boolean;
	terms: SeoAdminScoreScanTerm[];
}

export interface ScoreScanForm {
	collection: string;
	status: SeoAdminScoreScanStatus;
	locale: string;
	mode: "count" | "all";
	count: string;
	taxonomies: ScoreScanTaxonomyDraft[];
}

export function initialScoreScanForm(collection = ""): ScoreScanForm {
	return { collection, status: "all", locale: "", mode: "count", count: "100", taxonomies: [] };
}

/**
 * Keeps the selected collection while it is still offered, otherwise selects
 * the first one. An unchanged selection returns the same form object, so a
 * loading, failed or empty discovery never produces a new state.
 */
export function scoreScanFormForCollections(form: ScoreScanForm, collections: ReadonlyArray<{ collection: string }>): ScoreScanForm {
	if (collections.some((item) => item.collection === form.collection)) return form;
	const collection = collections[0]?.collection ?? "";
	return collection === form.collection ? form : { ...form, collection, taxonomies: [] };
}

export type ScoreScanFormErrors = Partial<Record<"collection" | "locale" | "count" | "taxonomies", string>>;

export function scoreScanFormErrors(form: ScoreScanForm): ScoreScanFormErrors {
	const errors: ScoreScanFormErrors = {};
	if (!form.collection) errors.collection = "Choose a content type.";
	const locale = form.locale.trim();
	if (locale && (locale.length > 35 || !LOCALE_PATTERN.test(locale))) errors.locale = "Enter a locale such as nl or nl-NL.";
	if (form.mode === "count") {
		const count = Number(form.count);
		if (!/^\d+$/.test(form.count.trim()) || !Number.isSafeInteger(count) || count < 1 || count > SCORE_SCAN_COUNT_MAX)
			errors.count = "Choose 1 to 100,000 entries.";
	}
	const selected = form.taxonomies.filter((draft) => draft.terms.length > 0);
	if (selected.length > SCORE_SCAN_TAXONOMY_MAX) errors.taxonomies = `Use at most ${SCORE_SCAN_TAXONOMY_MAX} taxonomies.`;
	else if (selected.some((draft) => draft.terms.length > SCORE_SCAN_TERMS_PER_TAXONOMY_MAX))
		errors.taxonomies = `Select at most ${SCORE_SCAN_TERMS_PER_TAXONOMY_MAX} terms per taxonomy.`;
	return errors;
}

/** The exact start request; taxonomies without selected terms do not restrict the scope. */
export function scoreScanStartRequest(
	form: ScoreScanForm,
	commandId: string,
	current: SeoAdminScoreScanView | null,
): SeoAdminScoreScanStartRequest | null {
	if (Object.keys(scoreScanFormErrors(form)).length > 0) return null;
	const locale = form.locale.trim();
	return {
		commandId,
		replace: current ? { runId: current.runId, expectedRevision: current.revision } : null,
		collection: form.collection,
		status: form.status,
		locale: locale || null,
		taxonomies: form.taxonomies
			.filter((draft) => draft.terms.length > 0)
			.map((draft) => ({
				taxonomy: draft.taxonomy,
				termIds: draft.terms.map((term) => term.id),
				includeDescendants: draft.hierarchical && draft.includeDescendants,
			})),
		target: form.mode === "all" ? { mode: "all" } : { mode: "count", count: Number(form.count) },
	};
}

export function scoreScanTermLimitReached(draft: ScoreScanTaxonomyDraft): boolean {
	return draft.terms.length >= SCORE_SCAN_TERMS_PER_TAXONOMY_MAX;
}

/** Adds one exact term; a term already selected or a full group leaves the draft unchanged. */
export function addScoreScanTerm(draft: ScoreScanTaxonomyDraft, term: SeoAdminScoreScanTerm): ScoreScanTaxonomyDraft {
	if (draft.terms.some((item) => item.id === term.id) || draft.terms.length >= SCORE_SCAN_TERMS_PER_TAXONOMY_MAX) return draft;
	return { ...draft, terms: [...draft.terms, term] };
}

export function removeScoreScanTerm(draft: ScoreScanTaxonomyDraft, termId: string): ScoreScanTaxonomyDraft {
	return { ...draft, terms: draft.terms.filter((term) => term.id !== termId) };
}

// ---- Presentation ----

export type ScoreScanTone = "neutral" | "info" | "success" | "warning" | "error";

export interface ScoreScanPresentation {
	label: string;
	tone: ScoreScanTone;
	detail: string;
}

/** Local Stop and Pause requests, bound to the run they were made for. */
export interface ScoreScanRequests {
	runId: string | null;
	pause: boolean;
	stop: boolean;
}

export const NO_SCORE_SCAN_REQUESTS: ScoreScanRequests = { runId: null, pause: false, stop: false };

/**
 * Keeps only requests the confirmed state of their own run has not answered:
 * a paused, stopped or completed run needs no Pause, and a stopped or
 * completed run needs no Stop. Another run, or no run, clears them.
 */
export function reconcileScoreScanRequests(requests: ScoreScanRequests, view: SeoAdminScoreScanView | null): ScoreScanRequests {
	if (!view || requests.runId !== view.runId) return NO_SCORE_SCAN_REQUESTS;
	const stop = requests.stop && (view.state === "running" || view.state === "paused");
	const pause = requests.pause && !stop && view.state === "running";
	return stop || pause ? { runId: view.runId, pause, stop } : NO_SCORE_SCAN_REQUESTS;
}

/** A request applies only to its own run; a replacement run, from a start or a refresh, never inherits it. */
export function scoreScanRequestsFor(requests: ScoreScanRequests, runId: string | null): Pick<ScoreScanLocal, "pauseRequested" | "stopRequested"> {
	return requests.runId !== null && requests.runId === runId
		? { pauseRequested: requests.pause, stopRequested: requests.stop }
		: { pauseRequested: false, stopRequested: false };
}

/** What this panel is doing locally; the server state alone cannot say whether this panel is driving the run. */
export interface ScoreScanLocal {
	driving: boolean;
	pauseRequested: boolean;
	stopRequested: boolean;
	/** The current scoring switch, or null or absent while the settings are unread. */
	scoringEnabled?: boolean | null;
}

const PAUSE_DETAILS: Record<NonNullable<SeoAdminScoreScanView["pauseReason"]>, string> = {
	"requested": "Paused on request. Resume continues from the saved position.",
	"activation-required": "Review and enable analysis in Feature controls, then select Resume. Existing progress and results are retained.",
	"profile-required": "Choose and save an assessment profile for this run's content type, then select Resume. No fallback score is used.",
	"profile-unavailable": "The assessment profile could not be read. Reload it before resuming; previous results are retained.",
	"scoring-disabled": "Content scoring is paused, so no further entries are processed. Turning it on starts no work; turn it on, then select Resume.",
	"scoring-unavailable": "The scoring settings could not be read, so no further entries are processed. Resume once they can be read.",
	"policy-changed": "The SEO settings changed while this scan was running. Resume to continue under the current settings.",
	"failure-streak": "Three entries in a row failed, so the scan paused instead of using up the selected amount. Check the failures, then Resume.",
	"source-unavailable": "The selected content could not be read. Nothing was skipped; Resume retries the same position.",
	"record-budget": "The scan record reached its size limit. Stop this run and start a narrower one.",
};

export function scoreScanStatePresentation(view: SeoAdminScoreScanView, local: ScoreScanLocal): ScoreScanPresentation {
	if (view.state === "stopped") return { label: "Stopped", tone: "neutral", detail: "This run has ended. Start a new run to analyze more content." };
	if (view.state === "completed")
		return view.completion === "target-reached"
			? { label: "Selected amount processed", tone: "success", detail: "The selected number of matching entries has been processed. A new run starts again from the first matching entries." }
			: { label: "Reached the end of the selection", tone: "success", detail: "The scan reached the last content that existed when it started. Each entry was checked when the scan reached it, so content added after the start, or content that starts matching after its position was scanned, needs a new run." };
	if (local.stopRequested && (view.state === "running" || view.state === "paused"))
		return local.driving
			? { label: "Stopping", tone: "info", detail: "Stop was requested. The run ends after the entry in progress; it is not stopped until confirmed." }
			: { label: "Stop not confirmed", tone: "warning", detail: "Stop was requested, but the last request failed before it could be applied. Select Stop again." };
	if (local.pauseRequested && view.state === "running")
		return local.driving
			? { label: "Pausing", tone: "info", detail: "Pause was requested and takes effect after the entry in progress." }
			: { label: "Pause not confirmed", tone: "warning", detail: "Pause was requested, but the last request failed before it could be applied. Select Pause again." };
	if (view.state === "paused") {
		// Current-off wording needs a confirmed off switch; unread settings only name the earlier pause.
		const detail = view.pauseReason !== "scoring-disabled" || local.scoringEnabled === false
			? PAUSE_DETAILS[view.pauseReason!]
			: local.scoringEnabled === true
				? "This scan paused because content scoring was turned off. Scoring is on again, but the scan stays paused until you select Resume."
				: "This scan paused because content scoring was turned off. The current scoring settings cannot be confirmed, so the scan stays paused until they can be read and you select Resume.";
		return { label: "Paused", tone: view.pauseReason === "requested" ? "neutral" : "warning", detail };
	}
	if (local.driving) return { label: "Analyzing", tone: "info", detail: "Keep this panel open. Closing it schedules no background scan; Resume later continues from the saved position." };
	if (view.unit?.active)
		return { label: "Running elsewhere", tone: "warning", detail: "Another window or request holds the current entry. Resume here takes over and records that entry as uncertain if it has not finished." };
	return {
		label: "Waiting to resume",
		tone: "warning",
		detail: view.unit
			? "An entry was interrupted. Resume recovers it without counting it twice, then continues while this panel stays open."
			: "This run continues only while this panel is open. Resume to continue from the saved position.",
	};
}

/**
 * Progress against the selected amount. Processed means a matching entry was
 * taken for analysis once, whatever its outcome; an unknown total is never a percentage.
 */
export function scoreScanProgressText(view: SeoAdminScoreScanView): string {
	const processed = view.counters.admitted.toLocaleString("en");
	const target = view.target;
	if (target.mode === "count") return `${processed} of ${target.count.toLocaleString("en")} matching entries processed.`;
	if (view.state === "completed") return `${processed} matching entries processed.`;
	return `${processed} matching entries processed. The total is not known until the scan reaches the end.`;
}

export interface ScoreScanCounterRow {
	key: keyof SeoAdminScoreScanCounters;
	label: string;
	value: number;
}

const PRIMARY_COUNTERS: Array<[keyof SeoAdminScoreScanCounters, string]> = [
	["admitted", "Matching entries processed"],
	["saved", "Scores saved"],
	["reused", "Existing scores reused"],
	["failed", "Failures"],
];

const DETAIL_COUNTERS: Array<[keyof SeoAdminScoreScanCounters, string]> = [
	["attempts", "Analysis attempts"],
	["analyzed", "Analyses completed"],
	["superseded", "Superseded by newer changes"],
	["skipped", "Skipped (missing or changed locale)"],
	["retried", "Kept for retry"],
	["uncertain", "Interrupted, not accepted"],
	["noLongerMatching", "No longer matching when reached"],
	["matchedReferences", "Matches found"],
	["examinedCandidates", "Candidates examined"],
	["fetchedCandidates", "Candidates fetched"],
	["historyCreated", "History snapshots recorded"],
	["historyUnchanged", "History unchanged"],
	["historyFailed", "History not recorded"],
	["historyUncertain", "History uncertain"],
	["historyUnknown", "History unknown"],
];

/** The four results a site owner reads first. */
export function scoreScanPrimaryCounters(counters: SeoAdminScoreScanCounters): ScoreScanCounterRow[] {
	return PRIMARY_COUNTERS.map(([key, label]) => ({ key, label, value: counters[key] }));
}

/** Attempt, candidate and history diagnostics kept behind Details. */
export function scoreScanDetailCounters(counters: SeoAdminScoreScanCounters): ScoreScanCounterRow[] {
	return DETAIL_COUNTERS.map(([key, label]) => ({ key, label, value: counters[key] }));
}

/** History is separate from the score: a saved score with a history warning is still saved. */
export function scoreScanHistoryWarning(counters: SeoAdminScoreScanCounters): string | null {
	const failed = counters.historyFailed + counters.historyUncertain + counters.historyUnknown;
	if (failed === 0) return null;
	return `${failed.toLocaleString("en")} saved ${failed === 1 ? "score has" : "scores have"} no confirmed history snapshot (${counters.historyFailed} failed, ${counters.historyUncertain} uncertain, ${counters.historyUnknown} unknown). The scores themselves were saved.`;
}

const OUTCOME_LABELS: Record<SeoAdminScoreScanOutcome["status"], string> = {
	reused: "Reused",
	saved: "Saved",
	superseded: "Superseded",
	skipped: "Skipped",
	failed: "Failed",
	retry: "Kept for retry",
	uncertain: "Uncertain, not accepted",
};

const OUTCOME_TONES: Record<SeoAdminScoreScanOutcome["status"], ScoreScanTone> = {
	reused: "success", saved: "success", superseded: "neutral", skipped: "neutral",
	failed: "error", retry: "warning", uncertain: "warning",
};

const HISTORY_LABELS: Record<SeoAdminScoreScanOutcome["history"], string | null> = {
	"pending": "history pending",
	"created": "history recorded",
	"unchanged": "history unchanged",
	"failed": "history not recorded",
	"uncertain": "history uncertain",
	"unknown": "history unknown",
	"not-attempted": null,
};

export function scoreScanOutcomePresentation(outcome: SeoAdminScoreScanOutcome): ScoreScanPresentation {
	const parts = [
		outcome.score !== null ? `Score ${outcome.score}` : null,
		outcome.reason ? outcome.reason.replaceAll("-", " ") : null,
		HISTORY_LABELS[outcome.history],
		outcome.computation === "unknown" ? "analysis completion unknown" : null,
	].filter((part): part is string => part !== null);
	return { label: OUTCOME_LABELS[outcome.status], tone: OUTCOME_TONES[outcome.status], detail: parts.join(", ") };
}

/**
 * Scans wait for Automatic & bulk analysis only when a successful read says it is paused or awaits
 * review; a pending, failed or unreadable read and an unavailable acknowledgement say nothing about it.
 */
export function scoreScanNeedsAnalysisEnabled(read: { isError: boolean; values: unknown; policyState: string | undefined }): boolean {
	return !read.isError && read.values !== null && read.values !== undefined &&
		(read.policyState === "paused" || read.policyState === "pending-confirmation");
}

/** Refresh only the requested collection after admission or a profile boundary refusal. */
export function scoreScanNeedsProfileRefresh(result: SeoAdminScoreScanResult): boolean {
	if (!result.success)
		return result.error === "profile_required" || result.error === "profile_unavailable";
	return result.command === "start" || result.command === "resume" ||
		result.scan.pauseReason === "profile-required" || result.scan.pauseReason === "profile-unavailable" ||
		result.scan.pauseReason === "policy-changed";
}

const FAILURE_MESSAGES: Record<SeoAdminScoreScanFailure, string> = {
	scan_unavailable: "Scoped scans need the native plugin installation with database access. This installation does not provide them.",
	storage_unavailable: "The scan record could not be read or written. No further entries were processed.",
	source_unavailable: "The selected content could not be read. Nothing was skipped.",
	invalid_command: "That command does not match its earlier request. Reload the scan.",
	invalid_scope: "The selected scope cannot be scanned.",
	unsupported_collection: "Choose an eligible content type.",
	scope_too_large: "The selected scope is too large for one scan record. Select fewer terms.",
	activation_required: "Review resource use and enable analysis in Feature controls before starting or resuming.",
	profile_required: "Choose and save an assessment profile for the selected content type before starting or resuming.",
	profile_unavailable: "The assessment profile could not be read. Previous results are retained.",
	scoring_disabled: "Content scoring is paused. Turn it on before starting or resuming.",
	scoring_unavailable: "The scoring settings could not be read.",
	run_exists: "Another run already exists. Reload to see it before starting a new one.",
	stale_run: "This run was replaced. The current run is shown.",
	stale_revision: "The run changed in another window or request. The current state is shown.",
	receipt_expired: "That earlier command can no longer be confirmed. The current state is shown.",
	not_running: "The run is not running.",
	not_resumable: "This run has ended. Start a new run.",
	busy: "Another window or request is working on this run.",
	recovery_required: "An entry was interrupted. Resume recovers it before continuing.",
	uncertain: "Whether the last entry was accepted could not be confirmed. The run stopped here; Resume recovers it without counting it twice.",
};

export function scoreScanFailureMessage(error: SeoAdminScoreScanFailure, detail: string | null): string {
	return detail && (error === "invalid_scope" || error === "scope_too_large" || error === "uncertain")
		? `${FAILURE_MESSAGES[error]} ${detail}`
		: FAILURE_MESSAGES[error];
}

// ---- Continuation ----

export type ScoreScanLoopStep =
	| { kind: "continue"; view: SeoAdminScoreScanView }
	| { kind: "pause"; view: SeoAdminScoreScanView }
	| { kind: "stop"; view: SeoAdminScoreScanView }
	| {
		kind: "idle";
		view: SeoAdminScoreScanView | null;
		message: string | null;
		error: string | null;
		reload: boolean;
		/** Local requests that were not applied and stay visible. */
		pending: { pause: boolean; stop: boolean };
	};

// These failures carry the stored state read for the refusal; the others carry
// no state, or a state whose acceptance or write outcome is unresolved.
const AUTHORITATIVE_FAILURES: readonly SeoAdminScoreScanFailure[] = [
	"stale_run", "stale_revision", "receipt_expired", "not_running", "busy", "recovery_required",
];

/**
 * The panel's next move after a command answer. Automatic continuation runs
 * one request at a time and only after a fresh `continue` decision; a local
 * pause or stop request is sent before any further entry.
 */
export function nextScoreScanStep(
	result: SeoAdminScoreScanResult,
	local: Pick<ScoreScanLocal, "pauseRequested" | "stopRequested">,
	runId: string | null = result.scan?.runId ?? null,
): ScoreScanLoopStep {
	if (!result.success) {
		const scan = result.scan;
		const sameRun = scan !== null && scan.runId === runId;
		// A queued request applies to a refreshed state of the same run; an uncertain state never continues.
		// Stop dominates: a failed Stop goes idle with Stop pending and never falls through to Pause.
		if (sameRun && AUTHORITATIVE_FAILURES.includes(result.error)) {
			if (local.stopRequested) {
				if (result.command !== "stop" && (scan.state === "running" || scan.state === "paused")) return { kind: "stop", view: scan };
			} else if (local.pauseRequested && result.command !== "pause" && scan.state === "running") {
				return { kind: "pause", view: scan };
			}
		}
		const reload = result.error === "stale_run" || result.error === "stale_revision" || result.error === "receipt_expired" || result.error === "run_exists";
		// A request for a replaced run is dropped; it never applies to the run that replaced it.
		const stop = local.stopRequested && (scan === null || (sameRun && (scan.state === "running" || scan.state === "paused")));
		const pending = {
			stop,
			pause: !stop && local.pauseRequested && (scan === null || (sameRun && scan.state === "running")),
		};
		return { kind: "idle", view: scan, message: null, error: scoreScanFailureMessage(result.error, result.detail), reload, pending };
	}
	// A replay carries the current state, so the next step follows that state.
	const view = result.scan;
	if ((view.state === "running" || view.state === "paused") && local.stopRequested && result.command !== "stop") return { kind: "stop", view };
	if (view.state === "running" && local.pauseRequested && !local.stopRequested && result.command !== "pause") return { kind: "pause", view };
	// An applied Pause ends this panel's drive even when a replay shows another panel resumed the run.
	if (view.state === "running" && result.command === "pause")
		return { kind: "idle", view, message: SCORE_SCAN_PAUSE_RESUMED_ELSEWHERE, error: null, reload: false, pending: { pause: false, stop: false } };
	if (view.state === "running") return { kind: "continue", view };
	return { kind: "idle", view, message: commandMessage(result), error: null, reload: false, pending: { pause: false, stop: false } };
}

export const SCORE_SCAN_PAUSE_RESUMED_ELSEWHERE =
	"Your Pause was applied, and another panel has since resumed this run. This panel sends no further entries until you select Resume here.";

// A replay answers with the current state, so a terminal state is reported before the recorded command.
function commandMessage(result: Extract<SeoAdminScoreScanResult, { success: true }>): string | null {
	if (result.scan.state === "stopped") return "Stopped. Saved scores and history remain.";
	if (result.scan.state === "completed") return result.scan.completion === "target-reached" ? "The selected amount was processed." : "The scan reached the last content that existed when it started.";
	if (result.command === "pause" && result.scan.state === "paused") return "Paused. Resume continues from the saved position.";
	return null;
}

export function scoreScanCommandId(random: () => string = () => crypto.randomUUID()): string {
	return random();
}

/** The scan-limiting explanations the panel always shows next to the form. */
export const SCORE_SCAN_NOTES = {
	panel: "Scans continue only while this panel stays open, one entry at a time. Closing it schedules nothing; reopen it and Resume to continue.",
	count: "A selected count starts again from the first matching entries on every new run and includes reused scores. To work through a larger selection, choose All matching content and use Pause.",
	status: "Scheduled selects entries whose own status is scheduled. A scheduled change to a published entry still has the published status.",
	taxonomy: "Terms within one taxonomy match any of them; separate taxonomies must all match. Child terms are included only when you choose descendants.",
	scope: "Scoring includes drafts, noindex entries and entries without public routes; sitemap exclusions do not apply.",
	processed: "Processed counts each matching entry once, including reused scores and failures, so it is not a count of saved scores.",
	outcomes: "Only the latest 20 outcomes are kept here. There is no complete per-run result archive; stored scores remain in the content health inventory.",
} as const;
