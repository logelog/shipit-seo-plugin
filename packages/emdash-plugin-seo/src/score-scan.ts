import { z } from "astro/zod";
import type { PluginContext } from "emdash";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminScoreScanCommand,
	type SeoAdminScoreScanCommandRequest,
	type SeoAdminScoreScanCompletion,
	type SeoAdminScoreScanComputation,
	type SeoAdminScoreScanCounters,
	type SeoAdminScoreScanDecision,
	type SeoAdminScoreScanFailure,
	type SeoAdminScoreScanHistory,
	type SeoAdminScoreScanOutcome,
	type SeoAdminScoreScanOutcomeStatus,
	type SeoAdminScoreScanPauseReason,
	type SeoAdminScoreScanProgress,
	type SeoAdminScoreScanResult,
	type SeoAdminScoreScanStartRequest,
	type SeoAdminScoreScanState,
	type SeoAdminScoreScanStateResult,
	type SeoAdminScoreScanTarget,
	type SeoAdminScoreScanTaxonomiesResult,
	type SeoAdminScoreScanTermsRequest,
	type SeoAdminScoreScanTermsResult,
	type SeoAdminScoreScanView,
} from "./admin-contract.ts";
import { SEO_SCORE_VERSION, seoScoreDisplay } from "./analysis.ts";
import { compareStoredValue, supportsConditionalStorage } from "./conditional-storage.ts";
import { readCollectionAnalysisProfile } from "./collection-analysis-profile.ts";
import { clean, resolveContentCollections, type SeoScoreRecord } from "./entry-analysis-runtime.ts";
import { acceptAnalyzedScore, enforceScoreHistoryRetention, recordAcceptedScoreHistory, type ScoreAcceptance } from "./score-history.ts";
import {
	canonicalJson,
	runSavedScoreLifecycle,
	savedScoreLifecycleSteps,
	type SavedScoreOutcome,
	type SavedScoreTerminalBoundary,
} from "./score-lifecycle.ts";
import {
	SCORE_SCAN_CANDIDATE_BUDGET,
	SCORE_SCAN_EXPANDED_TERM_LIMIT,
	SCORE_SCAN_MATCH_BUDGET,
	SCORE_SCAN_SELECTED_TERM_LIMIT,
	SCORE_SCAN_TAXONOMY_LIMIT,
	SCORE_SCAN_TERM_CURSOR_LIMIT,
	SCORE_SCAN_TERM_PAGE_LIMIT,
	ScoreScanSelectionError,
	type ScoreScanPageBudget,
	type ScoreScanReference,
	type ScoreScanReferencePage,
	type ScoreScanRevalidation,
	type ScoreScanSource,
	type ScoreScanSourceRequest,
	type ScoreScanSourceScope,
} from "./score-scan-source.ts";
import { readContentScoringPolicy, type ContentScoringPolicy } from "./settings-runtime.ts";

export const SCORE_SCAN_JOB_ID = "current";
export const SCORE_SCAN_STORAGE_VERSION = 1 as const;
export const SCORE_SCAN_RECORD_LIMIT_BYTES = 48 * 1024;
/** Room a new run keeps for the buffer, attempt, outcomes and receipts it adds later. */
export const SCORE_SCAN_RECORD_RESERVE_BYTES = 16 * 1024;
export const SCORE_SCAN_OUTCOME_RETENTION = 20;
export const SCORE_SCAN_RECEIPT_RETENTION = 20;
export const SCORE_SCAN_FAILURE_STREAK_LIMIT = 3;
export const SCORE_SCAN_COUNT_LIMIT = 100_000;
export const SCORE_SCAN_UNIT_LEASE_MS = 120_000;
export const SCORE_SCAN_TAXONOMY_LIST_LIMIT = 100;

const COMMAND_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const RUN_ID_PATTERN = /^scan-[A-Za-z0-9-]{8,64}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const TAXONOMY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const COLLECTION_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const TERM_ID_MAX = 256;
const ENTRY_ID_MAX = 256;
const CURSOR_MAX = SCORE_SCAN_TERM_CURSOR_LIMIT;
const SEARCH_MAX = 100;
const LABEL_MAX = 300;
const DETAIL_MAX = 300;

const STATUSES = ["all", "draft", "published", "scheduled"] as const;
const COMMANDS = ["continue", "pause", "resume", "stop"] as const;
const STATES: readonly SeoAdminScoreScanState[] = ["running", "paused", "stopped", "completed"];
const PAUSE_REASONS: readonly SeoAdminScoreScanPauseReason[] = [
	"requested", "scoring-disabled", "activation-required", "profile-required", "profile-unavailable", "scoring-unavailable", "policy-changed", "failure-streak", "source-unavailable", "record-budget",
];
const COMPLETIONS: readonly SeoAdminScoreScanCompletion[] = ["target-reached", "exhausted"];
const OUTCOME_STATUSES: readonly SeoAdminScoreScanOutcomeStatus[] = ["reused", "saved", "superseded", "skipped", "failed", "retry", "uncertain"];
const COMPUTATIONS: readonly SeoAdminScoreScanComputation[] = ["confirmed", "none", "incomplete", "unknown"];
const HISTORY_STATES: readonly SeoAdminScoreScanHistory[] = ["pending", "created", "unchanged", "failed", "uncertain", "unknown", "not-attempted"];
const DECISIONS: readonly SeoAdminScoreScanDecision[] = ["continue", "paused", "stopped", "completed"];
const PROGRESS: readonly SeoAdminScoreScanProgress[] = ["window", "no-longer-matching", "outcome", "state"];
const COUNTER_KEYS = [
	"fetchedCandidates", "examinedCandidates", "matchedReferences", "noLongerMatching", "admitted", "attempts", "analyzed",
	"reused", "saved", "superseded", "skipped", "failed", "retried", "uncertain",
	"historyCreated", "historyUnchanged", "historyFailed", "historyUncertain", "historyUnknown",
] as const satisfies readonly (keyof SeoAdminScoreScanCounters)[];

// ---- Route inputs ----

const commandId = z.string().regex(COMMAND_ID_PATTERN);
const runId = z.string().regex(RUN_ID_PATTERN);
const collectionKey = z.string().regex(COLLECTION_PATTERN);
const localeKey = z.string().min(2).max(35).regex(LOCALE_PATTERN);
const taxonomyName = z.string().regex(TAXONOMY_PATTERN);

/** Exact route bodies; clients submit references to host records only. */
export const scoreScanRouteInputs = {
	state: z.object({}).strict().optional(),
	start: z.object({
		commandId,
		replace: z.object({ runId, expectedRevision: z.number().int().min(1) }).strict().nullable(),
		collection: collectionKey,
		status: z.enum(STATUSES),
		locale: localeKey.nullable(),
		taxonomies: z.array(z.object({
			taxonomy: taxonomyName,
			termIds: z.array(z.string().min(1).max(TERM_ID_MAX)).min(1).max(SCORE_SCAN_SELECTED_TERM_LIMIT),
			includeDescendants: z.boolean(),
		}).strict()).max(SCORE_SCAN_TAXONOMY_LIMIT),
		target: z.discriminatedUnion("mode", [
			z.object({ mode: z.literal("count"), count: z.number().int().min(1).max(SCORE_SCAN_COUNT_LIMIT) }).strict(),
			z.object({ mode: z.literal("all") }).strict(),
		]),
	}).strict(),
	command: z.object({
		command: z.enum(COMMANDS),
		runId,
		expectedRevision: z.number().int().min(1),
		commandId,
	}).strict(),
	taxonomies: z.object({ collection: collectionKey }).strict(),
	terms: z.object({
		collection: collectionKey,
		taxonomy: taxonomyName,
		locale: localeKey.nullable(),
		search: z.string().max(SEARCH_MAX),
		cursor: z.string().min(1).max(CURSOR_MAX).nullable(),
	}).strict(),
};

// ---- Ports ----

/** Ports bound to one open transaction. */
export interface ScoreScanBoundPorts {
	/**
	 * Policy, content and plugin storage bound to the transaction: kv
	 * `settings:global:v1`, the selected collection assessment profile,
	 * `content.get`, and the `scores`,
	 * `scoreAnalysisRevisions` and `scoreScanJobs` collections. Every other
	 * access throws, so nothing in the callback reaches the base connection.
	 */
	readonly context: PluginContext;
}

/** One atomic terminal operation, never a nontransactional fallback. */
export interface ScoreScanAcceptance {
	transaction<T>(work: (ports: ScoreScanBoundPorts) => Promise<T>, scope: { collection: string }): Promise<T>;
}

/** Supplied by the native entry; a host without it gets `scan_unavailable`. */
export interface ScoreScanHost {
	openSource(): Promise<ScoreScanSource>;
	openAcceptance(ctx: PluginContext): Promise<ScoreScanAcceptance>;
}

export interface ScoreScanDependencies {
	source: ScoreScanSource;
	acceptance: ScoreScanAcceptance;
	now?: () => Date;
	newId?: () => string;
	lifecycle?: typeof runSavedScoreLifecycle;
	steps?: typeof savedScoreLifecycleSteps;
	recordHistory?: (ctx: PluginContext, score: SeoScoreRecord) => Promise<Exclude<SeoAdminScoreScanHistory, "pending" | "not-attempted" | "unknown">>;
	enforceRetention?: (ctx: PluginContext) => Promise<void>;
}

// ---- Job record ----

interface ScoreScanAttemptRecord {
	attemptId: string;
	admission: number;
	reference: ScoreScanReference;
	generation: number;
	startedAt: string;
	leaseExpiresAt: string;
}

interface ScoreScanHistoryRecord {
	attemptId: string;
	ref: string;
	leaseExpiresAt: string;
}

interface ScoreScanReceipt {
	commandId: string;
	command: "start" | SeoAdminScoreScanCommand;
	/** The revision the command named; a start names the revision it replaced, or 0. */
	baseRevision: number;
	revision: number;
	decision: SeoAdminScoreScanDecision;
	progress: SeoAdminScoreScanProgress;
	attemptId: string | null;
}

export interface ScoreScanJobRecord {
	id: typeof SCORE_SCAN_JOB_ID;
	storageVersion: typeof SCORE_SCAN_STORAGE_VERSION;
	runId: string;
	revision: number;
	generation: number;
	createdAt: string;
	updatedAt: string;
	scope: ScoreScanSourceScope;
	target: SeoAdminScoreScanTarget;
	policyRevision: string | null;
	/** Analyzer that started or last resumed the run; absent on runs that analyzer 20 started. */
	scoreVersion?: number;
	state: SeoAdminScoreScanState;
	pauseReason: SeoAdminScoreScanPauseReason | null;
	completion: SeoAdminScoreScanCompletion | null;
	/** Where the next source page starts; buffered references precede it. */
	sourceCursor: string | null;
	exhausted: boolean;
	buffer: ScoreScanReference[];
	/** The admitted logical slot, retained until a terminal outcome finalizes it. */
	slot: { admission: number; reference: ScoreScanReference } | null;
	/** The unresolved attempt, persisted before analysis starts. */
	attempt: ScoreScanAttemptRecord | null;
	/** An accepted score whose history has no named outcome yet. */
	history: ScoreScanHistoryRecord | null;
	failureStreak: number;
	counters: SeoAdminScoreScanCounters;
	outcomes: SeoAdminScoreScanOutcome[];
	receipts: ScoreScanReceipt[];
	/** Commands naming an older revision may have had a receipt that was evicted. */
	receiptHorizon: number;
	retentionDue: boolean;
}

function isRecord(value: unknown): value is Record<string, any> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

function count(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function timestamp(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validReference(value: unknown, collection: string): value is ScoreScanReference {
	return isRecord(value) && value.collection === collection && boundedString(value.id, ENTRY_ID_MAX) &&
		typeof value.locale === "string" && LOCALE_PATTERN.test(value.locale) && boundedString(value.afterId, ENTRY_ID_MAX);
}

function validScope(value: unknown): value is ScoreScanSourceScope {
	if (!isRecord(value) || typeof value.collection !== "string" || !COLLECTION_PATTERN.test(value.collection) ||
		!STATUSES.includes(value.status) || !(value.locale === null || (typeof value.locale === "string" && LOCALE_PATTERN.test(value.locale))) ||
		!(value.upperId === null || boundedString(value.upperId, ENTRY_ID_MAX)) ||
		!Array.isArray(value.taxonomies) || value.taxonomies.length > SCORE_SCAN_TAXONOMY_LIMIT)
		return false;
	let groups = 0;
	for (const selection of value.taxonomies) {
		if (!isRecord(selection) || typeof selection.taxonomy !== "string" || !TAXONOMY_PATTERN.test(selection.taxonomy) ||
			typeof selection.includeDescendants !== "boolean" ||
			!Array.isArray(selection.termIds) || selection.termIds.length < 1 || selection.termIds.length > SCORE_SCAN_SELECTED_TERM_LIMIT ||
			!selection.termIds.every((id: unknown) => boundedString(id, TERM_ID_MAX)) ||
			!Array.isArray(selection.termGroups) || selection.termGroups.length < 1 ||
			!selection.termGroups.every((group: unknown) => boundedString(group, TERM_ID_MAX)) ||
			new Set(selection.termGroups).size !== selection.termGroups.length)
			return false;
		groups += selection.termGroups.length;
	}
	return groups <= SCORE_SCAN_EXPANDED_TERM_LIMIT &&
		new Set(value.taxonomies.map((selection: any) => selection.taxonomy)).size === value.taxonomies.length;
}

function validTarget(value: unknown): value is SeoAdminScoreScanTarget {
	return isRecord(value) && (value.mode === "all"
		? Object.keys(value).length === 1
		: value.mode === "count" && Number.isSafeInteger(value.count) && value.count >= 1 && value.count <= SCORE_SCAN_COUNT_LIMIT);
}

function validOutcome(value: unknown): value is SeoAdminScoreScanOutcome {
	return isRecord(value) && boundedString(value.attemptId, 128) && Number.isSafeInteger(value.admission) && value.admission >= 1 &&
		boundedString(value.ref, 512) && typeof value.locale === "string" && timestamp(value.recordedAt) &&
		OUTCOME_STATUSES.includes(value.status) && (value.reason === null || boundedString(value.reason, 64)) &&
		COMPUTATIONS.includes(value.computation) && (value.score === null || (Number.isInteger(value.score) && value.score >= 0 && value.score <= 100)) &&
		HISTORY_STATES.includes(value.history);
}

function validReceipt(value: unknown): value is ScoreScanReceipt {
	return isRecord(value) && typeof value.commandId === "string" && COMMAND_ID_PATTERN.test(value.commandId) &&
		(value.command === "start" || COMMANDS.includes(value.command)) && count(value.baseRevision) &&
		Number.isSafeInteger(value.revision) && value.revision >= 1 && DECISIONS.includes(value.decision) &&
		PROGRESS.includes(value.progress) && (value.attemptId === null || boundedString(value.attemptId, 128));
}

/** The stored job, or null when the record is not a current-version job. */
export function parseScoreScanJob(value: unknown): ScoreScanJobRecord | null {
	if (!isRecord(value) || value.id !== SCORE_SCAN_JOB_ID || value.storageVersion !== SCORE_SCAN_STORAGE_VERSION ||
		typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId) ||
		!Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.generation) || value.generation < 1 ||
		!timestamp(value.createdAt) || !timestamp(value.updatedAt) || !validScope(value.scope) || !validTarget(value.target) ||
		!(value.policyRevision === null || boundedString(value.policyRevision, 128)) ||
		!(value.scoreVersion === undefined || (Number.isSafeInteger(value.scoreVersion) && value.scoreVersion >= 1)) ||
		!STATES.includes(value.state) || !(value.pauseReason === null || PAUSE_REASONS.includes(value.pauseReason)) ||
		!(value.completion === null || COMPLETIONS.includes(value.completion)) ||
		(value.state === "paused") !== (value.pauseReason !== null) || (value.state === "completed") !== (value.completion !== null) ||
		!(value.sourceCursor === null || boundedString(value.sourceCursor, ENTRY_ID_MAX)) || typeof value.exhausted !== "boolean" ||
		!Array.isArray(value.buffer) || value.buffer.length > SCORE_SCAN_MATCH_BUDGET ||
		!value.buffer.every((reference: unknown) => validReference(reference, value.scope.collection)) ||
		!count(value.failureStreak) || !isRecord(value.counters) || !COUNTER_KEYS.every((key) => count(value.counters[key])) ||
		!Array.isArray(value.outcomes) || value.outcomes.length > SCORE_SCAN_OUTCOME_RETENTION || !value.outcomes.every(validOutcome) ||
		!Array.isArray(value.receipts) || value.receipts.length > SCORE_SCAN_RECEIPT_RETENTION || !value.receipts.every(validReceipt) ||
		!count(value.receiptHorizon) || typeof value.retentionDue !== "boolean")
		return null;
	const slot = value.slot;
	if (slot !== null && !(isRecord(slot) && Number.isSafeInteger(slot.admission) && slot.admission >= 1 &&
		validReference(slot.reference, value.scope.collection)))
		return null;
	const attempt = value.attempt;
	if (attempt !== null && !(isRecord(attempt) && slot !== null && boundedString(attempt.attemptId, 128) &&
		attempt.admission === slot.admission && validReference(attempt.reference, value.scope.collection) &&
		Number.isSafeInteger(attempt.generation) && timestamp(attempt.startedAt) && timestamp(attempt.leaseExpiresAt)))
		return null;
	const history = value.history;
	if (history !== null && !(isRecord(history) && boundedString(history.attemptId, 128) && boundedString(history.ref, 512) &&
		timestamp(history.leaseExpiresAt) && attempt === null))
		return null;
	return value as ScoreScanJobRecord;
}

export function scoreScanRecordBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).length;
}

function emptyCounters(): SeoAdminScoreScanCounters {
	return Object.fromEntries(COUNTER_KEYS.map((key) => [key, 0])) as unknown as SeoAdminScoreScanCounters;
}

function referenceRef(reference: ScoreScanReference): string {
	return `${reference.collection}:${reference.id}`;
}

function leaseActive(expiresAt: string, now: Date): boolean {
	return Date.parse(expiresAt) > now.getTime();
}

function decisionOf(job: ScoreScanJobRecord): SeoAdminScoreScanDecision {
	return job.state === "running" ? "continue" : job.state;
}

// ---- Transitions ----

/** What ended an attempt; the lifecycle outcomes plus the job's own terminal facts. */
export type ScoreScanAttemptResult =
	| Exclude<SavedScoreOutcome, { status: "uncertain" }>
	| { status: "rolled-back" }
	| { status: "record-budget" }
	| { status: "no-longer-matching" };

interface Classified {
	status: SeoAdminScoreScanOutcomeStatus;
	reason: string | null;
	retryPause?: SeoAdminScoreScanPauseReason;
	effect: "success" | "failure" | "neutral";
	score?: SeoScoreRecord;
}

function classifyAttempt(result: ScoreScanAttemptResult): Classified {
	switch (result.status) {
		case "saved":
		case "reused":
			return { status: result.status, reason: null, effect: "success", score: result.score };
		case "activation_required":
			return { status: "retry", reason: "activation-required", retryPause: "activation-required", effect: "neutral" };
		case "profile_required":
			return { status: "retry", reason: "profile-required", retryPause: "profile-required", effect: "neutral" };
		case "profile_unavailable":
			return { status: "retry", reason: "profile-unavailable", retryPause: "profile-unavailable", effect: "neutral" };
		case "disabled":
			return { status: "retry", reason: "scoring-disabled", retryPause: "scoring-disabled", effect: "neutral" };
		case "unavailable":
			return result.reason === "policy"
				? { status: "retry", reason: "scoring-unavailable", retryPause: "scoring-unavailable", effect: "neutral" }
				: { status: "failed", reason: `${result.reason}-unavailable`, effect: "failure" };
		case "superseded":
			return result.reason === "policy-changed"
				? { status: "retry", reason: "policy-changed", retryPause: "policy-changed", effect: "neutral" }
				: { status: "superseded", reason: result.reason, effect: "neutral" };
		case "not-found":
		case "locale-mismatch":
		case "no-longer-matching":
			return { status: "skipped", reason: result.status, effect: "neutral" };
		case "failed":
			return { status: "failed", reason: "analysis-failed", effect: "failure" };
		case "rolled-back":
			return { status: "failed", reason: "acceptance-rolled-back", effect: "failure" };
		case "record-budget":
			return { status: "retry", reason: "record-budget", retryPause: "record-budget", effect: "neutral" };
	}
}

const OUTCOME_COUNTERS: Record<SeoAdminScoreScanOutcomeStatus, keyof SeoAdminScoreScanCounters> = {
	reused: "reused", saved: "saved", superseded: "superseded", skipped: "skipped",
	failed: "failed", retry: "retried", uncertain: "uncertain",
};

const HISTORY_COUNTERS: Partial<Record<SeoAdminScoreScanHistory, keyof SeoAdminScoreScanCounters>> = {
	created: "historyCreated", unchanged: "historyUnchanged", failed: "historyFailed",
	uncertain: "historyUncertain", unknown: "historyUnknown",
};

function withOutcome(job: ScoreScanJobRecord, outcome: SeoAdminScoreScanOutcome): ScoreScanJobRecord {
	const counters = { ...job.counters };
	counters[OUTCOME_COUNTERS[outcome.status]] += 1;
	if (outcome.computation === "confirmed") counters.analyzed += 1;
	return { ...job, counters, outcomes: [...job.outcomes, outcome].slice(-SCORE_SCAN_OUTCOME_RETENTION) };
}

function withReceipt(job: ScoreScanJobRecord, receipt: ScoreScanReceipt): ScoreScanJobRecord {
	const receipts = [...job.receipts, receipt];
	let receiptHorizon = job.receiptHorizon;
	while (receipts.length > SCORE_SCAN_RECEIPT_RETENTION) {
		const evicted = receipts.shift()!;
		receiptHorizon = Math.max(receiptHorizon, evicted.baseRevision + 1);
	}
	return { ...job, receipts, receiptHorizon };
}

function bumped(job: ScoreScanJobRecord, at: string): ScoreScanJobRecord {
	return { ...job, revision: job.revision + 1, updatedAt: at };
}

function paused(job: ScoreScanJobRecord, reason: SeoAdminScoreScanPauseReason): ScoreScanJobRecord {
	return { ...job, state: "paused", pauseReason: reason, completion: null };
}

const UNRECORDED_SCAN_SCORE_VERSION = 20;

function scanAnalyzerChanged(job: ScoreScanJobRecord): boolean {
	return (job.scoreVersion ?? UNRECORDED_SCAN_SCORE_VERSION) !== SEO_SCORE_VERSION;
}

/**
 * Pauses a run that crosses an analyzer upgrade once, for a policy change. The
 * restamp lets the next Resume continue, and earlier outcome numbers are
 * dropped because they came from another analyzer.
 */
function pausedForAnalyzerChange(job: ScoreScanJobRecord): ScoreScanJobRecord {
	return paused({
		...job,
		scoreVersion: SEO_SCORE_VERSION,
		outcomes: job.outcomes.map((outcome) => outcome.score === null ? outcome : { ...outcome, score: null }),
	}, "policy-changed");
}

/** Completes a running job whose target is reached or whose traversal is exhausted. */
export function completeScoreScanIfDone(job: ScoreScanJobRecord): ScoreScanJobRecord {
	if (job.state !== "running" || job.slot || job.attempt) return job;
	if (job.target.mode === "count" && job.counters.admitted >= job.target.count)
		return { ...job, state: "completed", pauseReason: null, completion: "target-reached" };
	if (job.exhausted && job.buffer.length === 0)
		return { ...job, state: "completed", pauseReason: null, completion: "exhausted" };
	return job;
}

/** Gives the pending history marker a named outcome, once. */
export function resolveScoreScanHistory(job: ScoreScanJobRecord, history: Exclude<SeoAdminScoreScanHistory, "pending" | "not-attempted">): ScoreScanJobRecord {
	const marker = job.history;
	if (!marker) return job;
	const counters = { ...job.counters };
	const counter = HISTORY_COUNTERS[history];
	if (counter) counters[counter] += 1;
	return {
		...job,
		counters,
		history: null,
		retentionDue: job.retentionDue || history !== "failed",
		outcomes: job.outcomes.map((outcome) => outcome.attemptId === marker.attemptId && outcome.history === "pending" ? { ...outcome, history } : outcome),
	};
}

/**
 * The terminal transition for one attempt: finalizes or retains its logical
 * slot, updates counters and the failure streak, and completes the run when
 * its target or traversal ends.
 */
export function applyScoreScanAttempt(
	job: ScoreScanJobRecord,
	attempt: Pick<ScoreScanAttemptRecord, "attemptId" | "admission" | "reference" | "leaseExpiresAt">,
	result: ScoreScanAttemptResult,
	computation: SeoAdminScoreScanComputation,
	at: string,
): { job: ScoreScanJobRecord; outcome: SeoAdminScoreScanOutcome } {
	const classified = classifyAttempt(result);
	const outcome: SeoAdminScoreScanOutcome = {
		attemptId: attempt.attemptId,
		admission: attempt.admission,
		ref: referenceRef(attempt.reference),
		locale: attempt.reference.locale,
		recordedAt: at,
		status: classified.status,
		reason: classified.reason,
		computation,
		// The shared display decision: no number for a dashed or earlier-analyzer result.
		score: classified.score ? seoScoreDisplay(classified.score).score : null,
		history: classified.status === "saved" ? "pending" : "not-attempted",
	};
	let next: ScoreScanJobRecord = withOutcome({ ...job, attempt: null }, outcome);
	if (classified.retryPause) {
		next = paused({ ...next, slot: { admission: attempt.admission, reference: attempt.reference } }, classified.retryPause);
		return { job: next, outcome };
	}
	next = { ...next, slot: null };
	if (classified.status === "saved")
		next = { ...next, history: { attemptId: attempt.attemptId, ref: outcome.ref, leaseExpiresAt: attempt.leaseExpiresAt } };
	if (classified.effect === "success") next = { ...next, failureStreak: 0 };
	if (classified.effect === "failure") {
		next = { ...next, failureStreak: next.failureStreak + 1 };
		if (next.failureStreak >= SCORE_SCAN_FAILURE_STREAK_LIMIT && next.state === "running")
			return { job: paused(next, "failure-streak"), outcome };
	}
	return { job: completeScoreScanIfDone(next), outcome };
}

/**
 * Fences the previous owner with a generation change. The record comparison
 * that applies this write proves no terminal receipt exists for the pending
 * attempt, so it is recorded as uncertain and cannot be accepted later.
 */
export function fenceScoreScanOwner(job: ScoreScanJobRecord, at: string, keepSlot: boolean): ScoreScanJobRecord {
	let next: ScoreScanJobRecord = { ...resolveScoreScanHistory(job, "unknown"), generation: job.generation + 1 };
	const attempt = next.attempt;
	if (attempt) {
		next = withOutcome({ ...next, attempt: null }, {
			attemptId: attempt.attemptId,
			admission: attempt.admission,
			ref: referenceRef(attempt.reference),
			locale: attempt.reference.locale,
			recordedAt: at,
			status: "uncertain",
			reason: "no-terminal-receipt",
			computation: "unknown",
			score: null,
			history: "not-attempted",
		});
	}
	return keepSlot ? next : { ...next, slot: null };
}

function policyPause(policy: ContentScoringPolicy, admitted: string | null): SeoAdminScoreScanPauseReason | null {
	if (policy.state === "paused") return "scoring-disabled";
	if (policy.state === "pending-confirmation") return "activation-required";
	if (policy.state === "unavailable") return "scoring-unavailable";
	return policy.revision === admitted ? null : "policy-changed";
}

function acceptanceOutcome(acceptance: ScoreAcceptance, score: SeoScoreRecord): ScoreScanAttemptResult {
	if (acceptance.persisted) return { status: "saved", score, history: "not-attempted" };
	if (acceptance.refusal === "scoring-disabled") return { status: "disabled" };
	if (acceptance.refusal === "scoring-unavailable") return { status: "unavailable", reason: "policy" };
	return { status: "superseded", reason: acceptance.refusal };
}

/** The largest terminal record this admitted attempt can produce. */
function worstTerminal(job: ScoreScanJobRecord, attempt: ScoreScanAttemptRecord): ScoreScanJobRecord {
	const outcome: SeoAdminScoreScanOutcome = {
		attemptId: attempt.attemptId, admission: attempt.admission, ref: referenceRef(attempt.reference),
		locale: attempt.reference.locale, recordedAt: attempt.leaseExpiresAt, status: "superseded",
		reason: "reservation-superseded", computation: "incomplete", score: 100, history: "not-attempted",
	};
	const receipt: ScoreScanReceipt = {
		commandId: "x".repeat(64), command: "continue", baseRevision: job.revision, revision: job.revision + 1,
		decision: "continue", progress: "no-longer-matching", attemptId: attempt.attemptId,
	};
	return withReceipt({ ...withOutcome(job, outcome), history: { attemptId: attempt.attemptId, ref: outcome.ref, leaseExpiresAt: attempt.leaseExpiresAt } }, receipt);
}

// ---- View ----

export function scoreScanView(job: ScoreScanJobRecord, now: Date): SeoAdminScoreScanView {
	const unit = job.attempt
		? { phase: "analysis" as const, ref: referenceRef(job.attempt.reference), leaseExpiresAt: job.attempt.leaseExpiresAt, active: leaseActive(job.attempt.leaseExpiresAt, now) }
		: job.history
			? { phase: "history" as const, ref: job.history.ref, leaseExpiresAt: job.history.leaseExpiresAt, active: leaseActive(job.history.leaseExpiresAt, now) }
			: null;
	return {
		runId: job.runId,
		revision: job.revision,
		state: job.state,
		pauseReason: job.pauseReason,
		completion: job.completion,
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
		scope: {
			collection: job.scope.collection,
			status: job.scope.status,
			locale: job.scope.locale,
			taxonomies: job.scope.taxonomies.map((selection) => ({
				taxonomy: selection.taxonomy,
				termIds: [...selection.termIds],
				includeDescendants: selection.includeDescendants,
				termGroupCount: selection.termGroups.length,
			})),
		},
		target: job.target,
		counters: { ...job.counters },
		failureStreak: job.failureStreak,
		unit,
		retry: job.slot && !job.attempt ? { ref: referenceRef(job.slot.reference), admission: job.slot.admission } : null,
		bufferedReferences: job.buffer.length,
		exhausted: job.exhausted,
		outcomes: job.outcomes.map((outcome) => ({ ...outcome })),
		outcomeRetention: SCORE_SCAN_OUTCOME_RETENTION,
	};
}

// ---- Storage ----

class ScoreScanStorageError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ScoreScanStorageError";
	}
}

class ScoreScanFencedError extends Error {
	constructor() {
		super("The score scan changed before its terminal acceptance");
		this.name = "ScoreScanFencedError";
	}
}

class ScoreScanBudgetError extends Error {
	constructor() {
		super(`The score scan record would exceed ${SCORE_SCAN_RECORD_LIMIT_BYTES} bytes`);
		this.name = "ScoreScanBudgetError";
	}
}

/** The transaction-bound job collection, whose revisions carry the fence into the final write. */
function versionedJobStore(ctx: PluginContext): any {
	const store = (ctx.storage as any)?.scoreScanJobs;
	if (!store || typeof store.getVersioned !== "function" || typeof store.compareAndSet !== "function")
		throw new ScoreScanStorageError("Versioned score scan storage is unavailable inside the acceptance transaction");
	return store;
}

function appliedRevision(result: unknown): string {
	if (!isRecord(result) || result.applied !== true || !boundedString(result.revision, 128)) throw new ScoreScanFencedError();
	return result.revision;
}

function jobStore(ctx: PluginContext): any {
	const store = (ctx.storage as any)?.scoreScanJobs;
	if (!store || typeof store.get !== "function" || !supportsConditionalStorage(store))
		throw new ScoreScanStorageError("Conditional score scan storage is unavailable");
	return store;
}

interface LoadedJob {
	raw: unknown;
	job: ScoreScanJobRecord | null;
}

async function loadJob(ctx: PluginContext, store: any): Promise<LoadedJob> {
	const raw: unknown = await store.get(SCORE_SCAN_JOB_ID);
	if (raw == null) return { raw: null, job: null };
	const job = parseScoreScanJob(raw);
	if (!job) ctx.log?.warn?.("seo: stored score scan record is not readable; a new run may replace it");
	return { raw, job };
}

async function writeJob(store: any, expected: unknown, next: ScoreScanJobRecord): Promise<boolean> {
	return compareStoredValue(
		store,
		SCORE_SCAN_JOB_ID,
		expected == null ? { state: "missing" } : { state: "value", value: expected },
		{ action: "put", value: next },
	);
}

// ---- Results ----

function base() {
	return { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION };
}

function failure(
	command: "start" | SeoAdminScoreScanCommand,
	id: string,
	error: SeoAdminScoreScanFailure,
	detail: string | null,
	job: ScoreScanJobRecord | null,
	now: Date,
): SeoAdminScoreScanResult {
	return {
		...base(),
		success: false,
		command,
		commandId: id,
		error,
		detail: detail === null ? null : detail.slice(0, DETAIL_MAX),
		scan: job ? scoreScanView(job, now) : null,
	};
}

function success(
	command: "start" | SeoAdminScoreScanCommand,
	id: string,
	replayed: boolean,
	decision: SeoAdminScoreScanDecision,
	progress: SeoAdminScoreScanProgress,
	outcome: SeoAdminScoreScanOutcome | null,
	job: ScoreScanJobRecord,
	now: Date,
): SeoAdminScoreScanResult {
	return { ...base(), success: true, command, commandId: id, replayed, decision, progress, outcome: outcome ? { ...outcome } : null, scan: scoreScanView(job, now) };
}

function replayed(receipt: ScoreScanReceipt, job: ScoreScanJobRecord, now: Date): SeoAdminScoreScanResult {
	const outcome = receipt.attemptId ? job.outcomes.find((item) => item.attemptId === receipt.attemptId) ?? null : null;
	return success(receipt.command, receipt.commandId, true, receipt.decision, receipt.progress, outcome, job, now);
}

function staleRevision(job: ScoreScanJobRecord, expectedRevision: number): SeoAdminScoreScanFailure {
	return expectedRevision < job.revision && expectedRevision < job.receiptHorizon ? "receipt_expired" : "stale_revision";
}

// ---- Commands ----

interface CommandRun {
	ctx: PluginContext;
	deps: Required<ScoreScanDependencies>;
	store: any;
	command: "start" | SeoAdminScoreScanCommand;
	commandId: string;
	baseRevision: number;
}

function withDefaults(deps: ScoreScanDependencies): Required<ScoreScanDependencies> {
	return {
		source: deps.source,
		acceptance: deps.acceptance,
		now: deps.now ?? (() => new Date()),
		newId: deps.newId ?? (() => crypto.randomUUID()),
		lifecycle: deps.lifecycle ?? runSavedScoreLifecycle,
		steps: deps.steps ?? savedScoreLifecycleSteps,
		// Global pruning waits until the run leaves the running state.
		recordHistory: deps.recordHistory ?? ((ctx, score) => recordAcceptedScoreHistory(ctx, score, { deferGlobalPrune: true })),
		enforceRetention: deps.enforceRetention ?? enforceScoreHistoryRetention,
	};
}

/** Prunes global history once the run has left the running state. */
async function settleRetention(run: CommandRun, job: ScoreScanJobRecord): Promise<ScoreScanJobRecord> {
	if (job.state === "running" || !job.retentionDue || job.history) return job;
	try {
		await run.deps.enforceRetention(run.ctx);
	} catch (error: unknown) {
		run.ctx.log?.warn?.("seo: score scan history retention failed", { error: String(error) });
		return job;
	}
	const next = bumped({ ...job, retentionDue: false }, run.deps.now().toISOString());
	try {
		return await writeJob(run.store, job, next) ? next : job;
	} catch {
		return job;
	}
}

/** The command's final write, carrying its receipt. */
async function finish(
	run: CommandRun,
	expected: unknown,
	next: ScoreScanJobRecord,
	progress: SeoAdminScoreScanProgress,
	outcome: SeoAdminScoreScanOutcome | null,
): Promise<SeoAdminScoreScanResult> {
	const now = run.deps.now();
	const final = withReceipt(bumped(next, now.toISOString()), {
		commandId: run.commandId,
		command: run.command,
		baseRevision: run.baseRevision,
		revision: next.revision + 1,
		decision: decisionOf(next),
		progress,
		attemptId: outcome?.attemptId ?? null,
	});
	let written: boolean;
	try {
		written = await writeJob(run.store, expected, final);
	} catch (error: unknown) {
		run.ctx.log?.warn?.("seo: score scan record write failed", { error: String(error) });
		return failure(run.command, run.commandId, "storage_unavailable", null, parseScoreScanJob(expected), now);
	}
	if (!written) return reloadedFailure(run, "stale_revision");
	const settled = await settleRetention(run, final);
	return success(run.command, run.commandId, false, decisionOf(final), progress, outcome, settled, run.deps.now());
}

/** An intermediate write without a receipt; the stored value is returned for the next comparison. */
async function persist(run: CommandRun, expected: unknown, next: ScoreScanJobRecord): Promise<ScoreScanJobRecord | SeoAdminScoreScanResult> {
	const final = bumped(next, run.deps.now().toISOString());
	try {
		if (await writeJob(run.store, expected, final)) return final;
	} catch (error: unknown) {
		run.ctx.log?.warn?.("seo: score scan record write failed", { error: String(error) });
		return failure(run.command, run.commandId, "storage_unavailable", null, parseScoreScanJob(expected), run.deps.now());
	}
	return reloadedFailure(run, "stale_revision");
}

async function reloadedFailure(run: CommandRun, error: SeoAdminScoreScanFailure, detail: string | null = null): Promise<SeoAdminScoreScanResult> {
	let job: ScoreScanJobRecord | null = null;
	try {
		job = (await loadJob(run.ctx, run.store)).job;
	} catch {
		job = null;
	}
	return failure(run.command, run.commandId, error, detail, job, run.deps.now());
}

function normalizedRequest(input: SeoAdminScoreScanStartRequest): ScoreScanSourceRequest | string {
	const names = input.taxonomies.map((selection) => selection.taxonomy);
	if (new Set(names).size !== names.length) return "Choose each taxonomy once.";
	return {
		collection: input.collection,
		status: input.status,
		locale: input.locale,
		taxonomies: input.taxonomies.map((selection) => ({
			taxonomy: selection.taxonomy,
			termIds: [...new Set(selection.termIds)],
			includeDescendants: selection.includeDescendants,
		})),
	};
}

function scopeMatchesRequest(scope: ScoreScanSourceScope, request: ScoreScanSourceRequest): boolean {
	return validScope(scope) && scope.collection === request.collection && scope.status === request.status &&
		scope.locale === request.locale && scope.taxonomies.length === request.taxonomies.length &&
		request.taxonomies.every((selection, index) => {
			const resolved = scope.taxonomies[index]!;
			return resolved.taxonomy === selection.taxonomy && resolved.includeDescendants === selection.includeDescendants &&
				canonicalJson([...resolved.termIds].sort()) === canonicalJson([...selection.termIds].sort());
		});
}

async function allowedCollections(ctx: PluginContext): Promise<string[]> {
	return (await resolveContentCollections(ctx)).map((definition) => definition.collection);
}

/** Starts a new run with an immutable resolved scope; an existing run is replaced only by name and revision. */
export async function startScoreScan(
	ctx: PluginContext,
	dependencies: ScoreScanDependencies,
	input: SeoAdminScoreScanStartRequest,
): Promise<SeoAdminScoreScanResult> {
	const deps = withDefaults(dependencies);
	const fail = (error: SeoAdminScoreScanFailure, detail: string | null = null, job: ScoreScanJobRecord | null = null) =>
		failure("start", input.commandId, error, detail, job, deps.now());
	const request = normalizedRequest(input);
	if (typeof request === "string") return fail("invalid_scope", request);
	let store: any;
	let loaded: LoadedJob;
	try {
		store = jobStore(ctx);
		loaded = await loadJob(ctx, store);
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: score scan record could not be read", { error: String(error) });
		return fail("storage_unavailable");
	}
	const current = loaded.job;
	const recorded = current?.receipts.find((receipt) => receipt.commandId === input.commandId);
	if (current && recorded)
		return recorded.command === "start" ? replayed(recorded, current, deps.now()) : fail("invalid_command", null, current);
	if (input.replace === null) {
		if (current) return fail("run_exists", null, current);
	} else {
		if (!current || current.runId !== input.replace.runId) return fail("stale_run", null, current);
		if (current.revision !== input.replace.expectedRevision) return fail(staleRevision(current, input.replace.expectedRevision), null, current);
	}
	const allowed = await allowedCollections(ctx);
	if (!allowed.includes(request.collection)) return fail("unsupported_collection", null, current);
	const policy = await readContentScoringPolicy(ctx);
	if (policy.state === "paused") return fail("scoring_disabled", null, current);
	if (policy.state === "pending-confirmation") return fail("activation_required", null, current);
	if (policy.state === "unavailable") return fail("scoring_unavailable", null, current);
	const assessmentProfile = await readCollectionAnalysisProfile(ctx, request.collection);
	if (assessmentProfile.state !== "configured")
		return fail(assessmentProfile.state === "unconfigured" ? "profile_required" : "profile_unavailable", null, current);
	let scope: ScoreScanSourceScope;
	try {
		scope = await deps.source.resolveScope(request, allowed);
	} catch (error: unknown) {
		// Only a rejected selection is shown as invalid; read failures stay unavailable.
		if (error instanceof ScoreScanSelectionError) return fail("invalid_scope", error.message, current);
		ctx.log?.warn?.("seo: score scan scope could not be resolved", { error: String(error) });
		return fail("source_unavailable", null, current);
	}
	if (!scopeMatchesRequest(scope, request)) {
		ctx.log?.warn?.("seo: score scan source returned a scope that does not match the request");
		return fail("source_unavailable", null, current);
	}
	const now = deps.now();
	const at = now.toISOString();
	const run: CommandRun = { ctx, deps, store, command: "start", commandId: input.commandId, baseRevision: input.replace?.expectedRevision ?? 0 };
	const job = withReceipt({
		id: SCORE_SCAN_JOB_ID,
		storageVersion: SCORE_SCAN_STORAGE_VERSION,
		runId: `scan-${deps.newId()}`,
		revision: 1,
		generation: 1,
		createdAt: at,
		updatedAt: at,
		scope: structuredClone(scope),
		target: input.target.mode === "all" ? { mode: "all" } : { mode: "count", count: input.target.count },
		policyRevision: policy.revision,
		scoreVersion: SEO_SCORE_VERSION,
		state: "running",
		pauseReason: null,
		completion: null,
		sourceCursor: null,
		exhausted: false,
		buffer: [],
		slot: null,
		attempt: null,
		history: null,
		failureStreak: 0,
		counters: emptyCounters(),
		outcomes: [],
		receipts: [],
		receiptHorizon: 1,
		retentionDue: Boolean(current?.retentionDue),
	}, { commandId: input.commandId, command: "start", baseRevision: run.baseRevision, revision: 1, decision: "continue", progress: "state", attemptId: null });
	if (!RUN_ID_PATTERN.test(job.runId)) throw new Error("Score scan run IDs must be URL-safe");
	if (scoreScanRecordBytes(job) + SCORE_SCAN_RECORD_RESERVE_BYTES > SCORE_SCAN_RECORD_LIMIT_BYTES)
		return fail("scope_too_large", `The resolved scope leaves too little room in the ${SCORE_SCAN_RECORD_LIMIT_BYTES / 1024} KiB scan record. Select fewer terms.`, current);
	try {
		if (!(await writeJob(store, loaded.raw, job))) return reloadedFailure(run, "stale_revision");
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: score scan record write failed", { error: String(error) });
		return fail("storage_unavailable", null, current);
	}
	return success("start", input.commandId, false, "continue", "state", null, job, deps.now());
}

/** Runs one explicit command against the current run at the named revision. */
export async function commandScoreScan(
	ctx: PluginContext,
	dependencies: ScoreScanDependencies,
	input: SeoAdminScoreScanCommandRequest,
): Promise<SeoAdminScoreScanResult> {
	const deps = withDefaults(dependencies);
	const fail = (error: SeoAdminScoreScanFailure, detail: string | null = null, job: ScoreScanJobRecord | null = null) =>
		failure(input.command, input.commandId, error, detail, job, deps.now());
	let store: any;
	let loaded: LoadedJob;
	try {
		store = jobStore(ctx);
		loaded = await loadJob(ctx, store);
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: score scan record could not be read", { error: String(error) });
		return fail("storage_unavailable");
	}
	const job = loaded.job;
	if (!job || job.runId !== input.runId) return fail("stale_run", null, job);
	const recorded = job.receipts.find((receipt) => receipt.commandId === input.commandId);
	if (recorded)
		return recorded.command === input.command && recorded.baseRevision === input.expectedRevision
			? replayed(recorded, job, deps.now())
			: fail("invalid_command", null, job);
	if (input.expectedRevision !== job.revision) return fail(staleRevision(job, input.expectedRevision), null, job);
	const run: CommandRun = { ctx, deps, store, command: input.command, commandId: input.commandId, baseRevision: input.expectedRevision };
	const at = deps.now().toISOString();
	switch (input.command) {
		case "continue":
			return continueScoreScan(run, loaded.raw, job);
		case "pause":
			if (job.state !== "running") return fail("not_running", null, job);
			return finish(run, loaded.raw, paused(fenceScoreScanOwner(job, at, true), "requested"), "state", null);
		case "stop":
			if (job.state !== "running" && job.state !== "paused") return fail("not_running", null, job);
			return finish(run, loaded.raw, { ...fenceScoreScanOwner(job, at, false), state: "stopped", pauseReason: null, completion: null, buffer: [] }, "state", null);
		case "resume": {
			if (job.state !== "running" && job.state !== "paused") return fail("not_resumable", null, job);
			const policy = await readContentScoringPolicy(ctx);
			if (policy.state === "paused") return fail("scoring_disabled", null, job);
			if (policy.state === "pending-confirmation") return fail("activation_required", null, job);
			if (policy.state === "unavailable") return fail("scoring_unavailable", null, job);
			const assessmentProfile = await readCollectionAnalysisProfile(ctx, job.scope.collection);
			if (assessmentProfile.state !== "configured")
				return fail(assessmentProfile.state === "unconfigured" ? "profile_required" : "profile_unavailable", null, job);
			const resumed: ScoreScanJobRecord = {
				...fenceScoreScanOwner(job, at, true),
				state: "running",
				pauseReason: null,
				completion: null,
				policyRevision: policy.revision,
				failureStreak: 0,
			};
			if (scanAnalyzerChanged(job)) return finish(run, loaded.raw, pausedForAnalyzerChange(resumed), "state", null);
			return finish(run, loaded.raw, completeScoreScanIfDone(resumed), "state", null);
		}
	}
}

function validPage(page: ScoreScanReferencePage, scope: ScoreScanSourceScope, afterId: string | null, budget: ScoreScanPageBudget): ScoreScanReferencePage {
	if (!isRecord(page) || !Array.isArray(page.references) || page.references.length > budget.matchBudget ||
		!page.references.every((reference) => validReference(reference, scope.collection)) ||
		!(page.nextAfterId === null || boundedString(page.nextAfterId, ENTRY_ID_MAX)) || typeof page.exhausted !== "boolean" ||
		!count(page.fetchedCandidates) || !count(page.examinedCandidates) || !count(page.matchedReferences) ||
		page.examinedCandidates > budget.candidateBudget || page.fetchedCandidates > budget.candidateBudget + 1 ||
		page.matchedReferences !== page.references.length)
		throw new Error("The score scan source returned an invalid page");
	if (!page.exhausted && (page.nextAfterId === null || page.nextAfterId === afterId))
		throw new Error("The score scan source did not advance");
	return page;
}

const REVALIDATIONS: readonly ScoreScanRevalidation[] = ["matching", "missing", "no-longer-matching"];

const POLICY_RETRIES: Record<SeoAdminScoreScanPauseReason, ScoreScanAttemptResult | null> = {
	"scoring-disabled": { status: "disabled" },
	"activation-required": { status: "activation_required" },
	"profile-required": { status: "profile_required" },
	"profile-unavailable": { status: "profile_unavailable" },
	"scoring-unavailable": { status: "unavailable", reason: "policy" },
	"policy-changed": { status: "superseded", reason: "policy-changed" },
	"requested": null, "failure-streak": null, "source-unavailable": null, "record-budget": null,
};

/**
 * Finalizes an attempt that wrote no score. Inside one transaction the job is
 * fenced first, then the policy is read through the bound settings port: an
 * admitted entry whose policy changed, was turned off or became unreadable
 * keeps its slot for an explicit Resume instead of being finalized.
 */
async function finalizeAttempt(
	run: CommandRun,
	expected: unknown,
	base: ScoreScanJobRecord,
	attempt: Pick<ScoreScanAttemptRecord, "attemptId" | "admission" | "reference" | "leaseExpiresAt">,
	result: ScoreScanAttemptResult,
	computation: SeoAdminScoreScanComputation,
): Promise<SeoAdminScoreScanResult> {
	const { ctx, deps } = run;
	let committed: { job: ScoreScanJobRecord; outcome: SeoAdminScoreScanOutcome };
	try {
		committed = await deps.acceptance.transaction(async ({ context }) => {
			const jobs = versionedJobStore(context);
			const current: unknown = await jobs.getVersioned(SCORE_SCAN_JOB_ID);
			if (!isRecord(current) || !boundedString(current.revision, 128) || canonicalJson(current.value) !== canonicalJson(expected))
				throw new ScoreScanFencedError();
			const at = deps.now().toISOString();
			const fenced = bumped(base, at);
			const fenceRevision = appliedRevision(await jobs.compareAndSet(SCORE_SCAN_JOB_ID, current.revision, fenced));
			const pause = policyPause(await readContentScoringPolicy(context), base.policyRevision);
			const retry = pause ? POLICY_RETRIES[pause] : null;
			const retained = classifyAttempt(result).retryPause !== undefined;
			const applied = applyScoreScanAttempt(fenced, attempt, retry && !retained ? retry : result, computation, at);
			const final = bumped(applied.job, at);
			const recorded = withReceipt(final, {
				commandId: run.commandId, command: run.command, baseRevision: run.baseRevision, revision: final.revision,
				decision: decisionOf(final), progress: "outcome", attemptId: attempt.attemptId,
			});
			const written: unknown = await jobs.compareAndSet(SCORE_SCAN_JOB_ID, fenceRevision, recorded);
			if (!isRecord(written) || written.applied !== true) throw new Error("The fenced score scan receipt was not written");
			return { job: recorded, outcome: applied.outcome };
		}, { collection: base.scope.collection });
	} catch (error: unknown) {
		if (error instanceof ScoreScanFencedError) return reloadedFailure(run, "stale_revision");
		let back: LoadedJob;
		try {
			back = await loadJob(ctx, run.store);
		} catch {
			return failure(run.command, run.commandId, "uncertain", "The outcome receipt could not be read back. Resume recovers this entry without counting it twice.", parseScoreScanJob(expected), deps.now());
		}
		const receipt = back.job?.outcomes.find((outcome) => outcome.attemptId === attempt.attemptId);
		if (back.job && receipt) return success(run.command, run.commandId, false, decisionOf(back.job), "outcome", receipt, back.job, deps.now());
		ctx.log?.warn?.("seo: score scan outcome could not be recorded", { error: String(error), ref: referenceRef(attempt.reference) });
		return failure(run.command, run.commandId, canonicalJson(back.raw) === canonicalJson(expected) ? "storage_unavailable" : "stale_revision", null, back.job, deps.now());
	}
	const settled = await settleRetention(run, committed.job);
	return success(run.command, run.commandId, false, decisionOf(committed.job), "outcome", committed.outcome, settled, deps.now());
}

/**
 * One continuation unit: at most one zero-match source window or one entry
 * lifecycle. The attempt is persisted before analysis, and a saved score is
 * accepted in the same transaction as its receipt, counters and cursor.
 */
async function continueScoreScan(run: CommandRun, raw: unknown, job: ScoreScanJobRecord): Promise<SeoAdminScoreScanResult> {
	const { ctx, deps } = run;
	const now = deps.now();
	const fail = (error: SeoAdminScoreScanFailure, detail: string | null = null, current: ScoreScanJobRecord | null = job) =>
		failure(run.command, run.commandId, error, detail, current, deps.now());
	if (job.state !== "running") return fail("not_running");
	if (job.attempt) return fail(leaseActive(job.attempt.leaseExpiresAt, now) ? "busy" : "recovery_required");
	if (job.history && leaseActive(job.history.leaseExpiresAt, now)) return fail("busy");

	// A history marker whose owner is gone can no longer be proved either way.
	let expected: unknown = raw;
	let next = resolveScoreScanHistory(job, "unknown");

	if (scanAnalyzerChanged(next)) return finish(run, expected, pausedForAnalyzerChange(next), "state", null);
	const pause = policyPause(await readContentScoringPolicy(ctx), job.policyRevision);
	if (pause) return finish(run, expected, paused(next, pause), "state", null);
	next = completeScoreScanIfDone(next);
	if (next.state !== "running") return finish(run, expected, next, "state", null);

	const retry = next.slot !== null;
	if (!retry && next.buffer.length === 0) {
		const remaining = next.target.mode === "count" ? next.target.count - next.counters.admitted : SCORE_SCAN_MATCH_BUDGET;
		const budget = { candidateBudget: SCORE_SCAN_CANDIDATE_BUDGET, matchBudget: Math.min(SCORE_SCAN_MATCH_BUDGET, remaining) };
		let page: ScoreScanReferencePage;
		try {
			page = validPage(await deps.source.page(next.scope, next.sourceCursor, budget), next.scope, next.sourceCursor, budget);
		} catch (error: unknown) {
			ctx.log?.warn?.("seo: score scan source page failed", { error: String(error) });
			return finish(run, expected, paused(next, "source-unavailable"), "state", null);
		}
		next = {
			...next,
			buffer: [...page.references],
			sourceCursor: page.nextAfterId ?? next.sourceCursor,
			exhausted: page.exhausted,
			counters: {
				...next.counters,
				fetchedCandidates: next.counters.fetchedCandidates + page.fetchedCandidates,
				examinedCandidates: next.counters.examinedCandidates + page.examinedCandidates,
				matchedReferences: next.counters.matchedReferences + page.matchedReferences,
			},
		};
		if (page.references.length === 0) return finish(run, expected, completeScoreScanIfDone(next), "window", null);
		const stored = await persist(run, expected, next);
		if (!("id" in stored)) return stored;
		expected = stored;
		next = stored;
	}

	const reference = retry ? next.slot!.reference : next.buffer[0]!;
	const admission = retry ? next.slot!.admission : next.counters.admitted + 1;
	let membership: ScoreScanRevalidation;
	try {
		membership = await deps.source.revalidate(next.scope, reference);
		if (!REVALIDATIONS.includes(membership)) throw new Error("The score scan source returned an invalid revalidation");
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: score scan revalidation failed", { error: String(error), ref: referenceRef(reference) });
		return finish(run, expected, paused(next, "source-unavailable"), "state", null);
	}
	if (membership !== "matching") {
		if (!retry) {
			next = completeScoreScanIfDone({
				...next,
				buffer: next.buffer.slice(1),
				counters: { ...next.counters, noLongerMatching: next.counters.noLongerMatching + 1 },
			});
			return finish(run, expected, next, "no-longer-matching", null);
		}
		// An admitted entry keeps its slot, so a mismatch on retry finalizes it as skipped.
		return finalizeAttempt(
			run,
			expected,
			{ ...next, counters: { ...next.counters, attempts: next.counters.attempts + 1 } },
			{ attemptId: deps.newId(), admission, reference, leaseExpiresAt: now.toISOString() },
			membership === "missing" ? { status: "not-found" } : { status: "no-longer-matching" },
			"none",
		);
	}

	const attempt: ScoreScanAttemptRecord = {
		attemptId: deps.newId(),
		admission,
		reference,
		generation: next.generation,
		startedAt: now.toISOString(),
		leaseExpiresAt: new Date(now.getTime() + SCORE_SCAN_UNIT_LEASE_MS).toISOString(),
	};
	const admittedDraft: ScoreScanJobRecord = {
		...next,
		buffer: retry ? next.buffer : next.buffer.slice(1),
		slot: { admission, reference },
		attempt,
		counters: { ...next.counters, admitted: retry ? next.counters.admitted : admission, attempts: next.counters.attempts + 1 },
	};
	if (scoreScanRecordBytes(bumped(worstTerminal(admittedDraft, attempt), attempt.startedAt)) > SCORE_SCAN_RECORD_LIMIT_BYTES)
		return finish(run, expected, paused(next, "record-budget"), "state", null);
	const stored = await persist(run, expected, admittedDraft);
	if (!("id" in stored)) return stored;
	const admitted = stored;

	let analysisStarted = false;
	let analysisCompleted = false;
	const steps: typeof savedScoreLifecycleSteps = {
		analyze: async (...args: Parameters<typeof savedScoreLifecycleSteps.analyze>) => {
			analysisStarted = true;
			const score = await deps.steps.analyze(...args);
			analysisCompleted = true;
			return score;
		},
	};
	type Terminal =
		| { kind: "none" }
		| { kind: "committed"; job: ScoreScanJobRecord; outcome: SeoAdminScoreScanOutcome }
		| { kind: "fenced" }
		| { kind: "budget" }
		| { kind: "error"; error: unknown };
	let terminal: Terminal = { kind: "none" };
	let acceptedScore: SeoScoreRecord | null = null;
	const receiptFor = (final: ScoreScanJobRecord): ScoreScanReceipt => ({
		commandId: run.commandId,
		command: run.command,
		baseRevision: run.baseRevision,
		revision: final.revision,
		decision: decisionOf(final),
		progress: "outcome",
		attemptId: attempt.attemptId,
	});
	const boundary: SavedScoreTerminalBoundary = {
		policyRevision: admitted.policyRevision,
		accept: async (score, admissionPolicy) => {
			acceptedScore = score;
			try {
				const committed = await deps.acceptance.transaction(async ({ context }) => {
					const jobs = versionedJobStore(context);
					const current: unknown = await jobs.getVersioned(SCORE_SCAN_JOB_ID);
					if (!isRecord(current) || !boundedString(current.revision, 128) || canonicalJson(current.value) !== canonicalJson(admitted))
						throw new ScoreScanFencedError();
					if (scoreScanRecordBytes(bumped(worstTerminal(admitted, attempt), attempt.startedAt)) > SCORE_SCAN_RECORD_LIMIT_BYTES)
						throw new ScoreScanBudgetError();
					// The owner's conditional job write comes before any score storage, so it
					// holds the write lock and a replaced owner fails here, not after acceptance.
					const fenced = bumped(admitted, deps.now().toISOString());
					const fenceRevision = appliedRevision(await jobs.compareAndSet(SCORE_SCAN_JOB_ID, current.revision, fenced));
					const acceptance = await acceptAnalyzedScore(context, score, { admission: admissionPolicy });
					const at = deps.now().toISOString();
					const applied = applyScoreScanAttempt(fenced, attempt, acceptanceOutcome(acceptance, score), "confirmed", at);
					const final = bumped(applied.job, at);
					const recorded = withReceipt(final, receiptFor(final));
					const written: unknown = await jobs.compareAndSet(SCORE_SCAN_JOB_ID, fenceRevision, recorded);
					// The fence is held, so a refused receipt write is a failure that rolls back the score.
					if (!isRecord(written) || written.applied !== true) throw new Error("The fenced score scan receipt was not written");
					return { acceptance, job: recorded, outcome: applied.outcome };
				}, { collection: reference.collection });
				terminal = { kind: "committed", job: committed.job, outcome: committed.outcome };
				return committed.acceptance;
			} catch (error: unknown) {
				terminal = error instanceof ScoreScanFencedError ? { kind: "fenced" }
					: error instanceof ScoreScanBudgetError ? { kind: "budget" }
					: { kind: "error", error };
				throw error;
			}
		},
	};

	const result = await deps.lifecycle(
		ctx,
		{ collection: reference.collection, id: reference.id, locale: reference.locale, deferGlobalPrune: true },
		steps,
		boundary,
	);
	const computation: SeoAdminScoreScanComputation = analysisCompleted ? "confirmed" : analysisStarted ? "incomplete" : "none";
	// Assigned inside the boundary callback; the declared type is restored for narrowing.
	const settled = terminal as Terminal;

	let committed: { job: ScoreScanJobRecord; outcome: SeoAdminScoreScanOutcome } | null = null;
	let attemptResult: ScoreScanAttemptResult | null = null;
	if (settled.kind === "committed") committed = settled;
	else if (settled.kind === "fenced") return reloadedFailure(run, "stale_revision");
	else if (settled.kind === "budget") attemptResult = { status: "record-budget" };
	else if (settled.kind === "error" || result.status === "uncertain") {
		// A commit or response failure is resolved only by this attempt's exact receipt.
		let back: LoadedJob;
		try {
			back = await loadJob(ctx, run.store);
		} catch (error: unknown) {
			ctx.log?.warn?.("seo: score scan acceptance receipt could not be read back", { error: String(error), ref: referenceRef(reference) });
			return fail("uncertain", "The acceptance receipt could not be read back. Resume recovers this entry without counting it twice.", admitted);
		}
		const receipt = back.job?.outcomes.find((outcome) => outcome.attemptId === attempt.attemptId);
		if (back.job && receipt) committed = { job: back.job, outcome: receipt };
		else if (canonicalJson(back.raw) === canonicalJson(admitted)) attemptResult = { status: "rolled-back" };
		else return failure(run.command, run.commandId, "stale_revision", null, back.job, deps.now());
	} else {
		attemptResult = result as Exclude<SavedScoreOutcome, { status: "uncertain" }>;
	}

	if (!committed) return finalizeAttempt(run, admitted, admitted, attempt, attemptResult!, computation);

	let finalJob = committed.job;
	let outcome = committed.outcome;
	const score = acceptedScore as SeoScoreRecord | null;
	if (outcome.status === "saved" && score && finalJob.history?.attemptId === attempt.attemptId) {
		const history = await deps.recordHistory(ctx, score);
		const resolved = bumped(resolveScoreScanHistory(finalJob, history), deps.now().toISOString());
		try {
			if (await writeJob(run.store, finalJob, resolved)) {
				finalJob = resolved;
				outcome = resolved.outcomes.find((item) => item.attemptId === attempt.attemptId) ?? outcome;
			}
		} catch (error: unknown) {
			ctx.log?.warn?.("seo: score scan history outcome could not be recorded", { error: String(error), ref: outcome.ref });
		}
	}
	finalJob = await settleRetention(run, finalJob);
	return success(run.command, run.commandId, false, decisionOf(committed.job), "outcome", outcome, finalJob, deps.now());
}

// ---- Reads ----

export async function readScoreScanState(ctx: PluginContext, now = new Date()): Promise<SeoAdminScoreScanStateResult> {
	try {
		const loaded = await loadJob(ctx, jobStore(ctx));
		return { ...base(), success: true, checkedAt: now.toISOString(), scan: loaded.job ? scoreScanView(loaded.job, now) : null };
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: score scan record could not be read", { error: String(error) });
		return { ...base(), success: false, error: "storage_unavailable" };
	}
}

/** Taxonomy definitions attached to one eligible collection; terms are never listed here. */
export async function listScoreScanTaxonomies(ctx: PluginContext, collection: string): Promise<SeoAdminScoreScanTaxonomiesResult> {
	const answer = { ...base(), collection };
	if (!(await allowedCollections(ctx)).includes(collection)) return { ...answer, success: false, error: "unsupported_collection" };
	const access = (ctx as any).taxonomies;
	if (!access || typeof access.getAll !== "function") return { ...answer, success: false, error: "taxonomies_unavailable" };
	let definitions: unknown;
	try {
		definitions = await access.getAll();
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: taxonomy definitions could not be read", { error: String(error) });
		return { ...answer, success: false, error: "taxonomies_unavailable" };
	}
	if (!Array.isArray(definitions)) return { ...answer, success: false, error: "taxonomies_unavailable" };
	const byName = new Map<string, { name: string; label: string; hierarchical: boolean }>();
	for (const definition of definitions) {
		if (!isRecord(definition) || typeof definition.name !== "string" || !TAXONOMY_PATTERN.test(definition.name) ||
			!Array.isArray(definition.collections) || !definition.collections.includes(collection) || byName.has(definition.name))
			continue;
		byName.set(definition.name, {
			name: definition.name,
			label: (clean(definition.label) ?? definition.name).slice(0, LABEL_MAX),
			hierarchical: definition.hierarchical === true,
		});
	}
	const taxonomies = [...byName.values()]
		.sort((left, right) => left.label.localeCompare(right.label) || left.name.localeCompare(right.name))
		.slice(0, SCORE_SCAN_TAXONOMY_LIST_LIMIT);
	return { ...answer, success: true, taxonomies };
}

/** One bounded page of term options for the selector; the source owns search and continuation. */
export async function listScoreScanTerms(
	ctx: PluginContext,
	source: ScoreScanSource,
	input: SeoAdminScoreScanTermsRequest,
): Promise<SeoAdminScoreScanTermsResult> {
	const answer = { ...base(), collection: input.collection, taxonomy: input.taxonomy, detail: null };
	const allowed = await allowedCollections(ctx);
	if (!allowed.includes(input.collection)) return { ...answer, success: false, error: "unsupported_collection" };
	try {
		const page = await source.termOptions({
			collection: input.collection,
			taxonomy: input.taxonomy,
			locale: input.locale,
			search: input.search.trim(),
			cursor: input.cursor,
			limit: SCORE_SCAN_TERM_PAGE_LIMIT,
		}, allowed);
		if (!isRecord(page) || !Array.isArray(page.terms) || page.terms.length > SCORE_SCAN_TERM_PAGE_LIMIT ||
			!(page.nextCursor === null || boundedString(page.nextCursor, CURSOR_MAX)) ||
			!page.terms.every((term) => isRecord(term) && boundedString(term.id, TERM_ID_MAX) &&
				boundedString(term.translationGroup, TERM_ID_MAX) && typeof term.label === "string" && typeof term.locale === "string"))
			throw new Error("The score scan source returned an invalid term page");
		return {
			contractVersion: answer.contractVersion,
			engineVersion: answer.engineVersion,
			collection: answer.collection,
			taxonomy: answer.taxonomy,
			success: true,
			terms: page.terms.map((term) => ({ id: term.id, translationGroup: term.translationGroup, label: term.label.slice(0, LABEL_MAX), locale: term.locale })),
			nextCursor: page.nextCursor,
		};
	} catch (error: unknown) {
		if (error instanceof ScoreScanSelectionError) return { ...answer, success: false, error: "invalid_selection", detail: error.message.slice(0, DETAIL_MAX) };
		ctx.log?.warn?.("seo: score scan term options failed", { error: String(error) });
		return { ...answer, success: false, error: "source_unavailable" };
	}
}

// ---- Route handlers ----

async function openDependencies(ctx: PluginContext, host: ScoreScanHost): Promise<ScoreScanDependencies> {
	const [source, acceptance] = await Promise.all([host.openSource(), host.openAcceptance(ctx)]);
	return { source, acceptance };
}

export async function scoreScanStateRoute(ctx: PluginContext, host: ScoreScanHost | null): Promise<SeoAdminScoreScanStateResult> {
	if (!host) return { ...base(), success: false, error: "scan_unavailable" };
	return readScoreScanState(ctx);
}

export async function startScoreScanRoute(ctx: PluginContext, host: ScoreScanHost | null, input: SeoAdminScoreScanStartRequest): Promise<SeoAdminScoreScanResult> {
	if (!host) return failure("start", input.commandId, "scan_unavailable", null, null, new Date());
	let deps: ScoreScanDependencies;
	try {
		deps = await openDependencies(ctx, host);
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: score scan ports could not be opened", { error: String(error) });
		return failure("start", input.commandId, "scan_unavailable", null, null, new Date());
	}
	return startScoreScan(ctx, deps, input);
}

export async function commandScoreScanRoute(ctx: PluginContext, host: ScoreScanHost | null, input: SeoAdminScoreScanCommandRequest): Promise<SeoAdminScoreScanResult> {
	if (!host) return failure(input.command, input.commandId, "scan_unavailable", null, null, new Date());
	let deps: ScoreScanDependencies;
	try {
		deps = await openDependencies(ctx, host);
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: score scan ports could not be opened", { error: String(error) });
		return failure(input.command, input.commandId, "scan_unavailable", null, null, new Date());
	}
	return commandScoreScan(ctx, deps, input);
}

export async function scoreScanTaxonomiesRoute(ctx: PluginContext, host: ScoreScanHost | null, input: { collection: string }): Promise<SeoAdminScoreScanTaxonomiesResult> {
	if (!host) return { ...base(), success: false, collection: input.collection, error: "scan_unavailable" };
	return listScoreScanTaxonomies(ctx, input.collection);
}

export async function scoreScanTermsRoute(ctx: PluginContext, host: ScoreScanHost | null, input: SeoAdminScoreScanTermsRequest): Promise<SeoAdminScoreScanTermsResult> {
	const answer = { ...base(), collection: input.collection, taxonomy: input.taxonomy, detail: null };
	if (!host) return { ...answer, success: false, error: "scan_unavailable" };
	let source: ScoreScanSource;
	try {
		source = await host.openSource();
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: score scan source could not be opened", { error: String(error) });
		return { ...answer, success: false, error: "scan_unavailable" };
	}
	return listScoreScanTerms(ctx, source, input);
}
