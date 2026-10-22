import { compareStoredValue, supportsConditionalStorage } from "./conditional-storage.ts";
import type { PluginContext } from "emdash";

import { readContentScoringPolicy, type ContentScoringAdmission } from "./settings-runtime.ts";
import type { ManualEntryScoreAdmission } from "./analysis-admission.ts";
import { readCollectionAnalysisProfile } from "./collection-analysis-profile.ts";
import { classifySeoContentCheck, seoScoreDisplay } from "./analysis.ts";
import { buildScoreHistoryComparison, createScoreComparisonContext } from "./score-history-comparison.ts";
import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	SEO_SCORE_VERSION,
	type SeoAdminContentScore,
	type SeoAdminScoreHistoryIssue,
	type SeoAdminScoreSnapshot,
	type SeoAdminScoreSnapshotUnscored,
	type SeoAdminScoreTrendIssue,
	type SeoAdminScoreTrendPoint,
	type SeoAdminScoreTrends,
} from "./admin-contract.ts";
import {
	withOperationLease,
	type OperationLeaseOwner,
	type OperationLeaseResult,
} from "./operation-lease.ts";

const SCORE_HISTORY_MUTATION_SCOPE = "score-history:mutation";
const SCORE_ANALYSIS_REVISION_STORAGE_VERSION = 1;

export const SEO_SCORE_HISTORY_PER_ENTRY_RETENTION = 30;
export const SEO_SCORE_HISTORY_GLOBAL_RETENTION = 2_000;

interface ScoreTrendOptions {
	days?: number;
	collection?: string | null;
	ref?: string | null;
	now?: Date;
}

interface ListScoreHistoryOptions {
	collection?: string | null;
	ref?: string | null;
	limit?: number;
}

interface PersistScoreHistoryOptions {
	deferGlobalPrune?: boolean;
	/** The enabled policy that admitted the operation; persistence needs the same revision. */
	admission?: ContentScoringAdmission;
	/** The exact entry and real policy admitted by an explicit single-entry action. */
	manualEntryAdmission?: ManualEntryScoreAdmission;
}

export type ScorePersistenceRefusal =
	| "scoring-disabled"
	| "scoring-unavailable"
	| "policy-changed"
	| "source-changed"
	| "newer-result"
	| "reservation-superseded";

/**
 * `unchanged` keeps an equal latest snapshot, `failed` stopped before the
 * snapshot write and `uncertain` failed during it. A saved score is never
 * written again to repair its history.
 */
export type ScoreHistoryOutcome = "created" | "unchanged" | "failed" | "uncertain" | "not-attempted";

export interface ScorePersistenceResult {
	persisted: boolean;
	refusal?: ScorePersistenceRefusal;
	history: ScoreHistoryOutcome;
	historyCreated: boolean;
}

export type ScoreHistoryWritePhase = "before-write" | "writing" | "written";

/**
 * History outcome from the lease result and how far the snapshot write got.
 * A lost or failed lease after the put started never reports the snapshot as absent.
 */
export function scoreHistoryAfterLease(
	result: OperationLeaseResult<"created" | "unchanged"> | { thrown: unknown },
	phase: ScoreHistoryWritePhase,
): "created" | "unchanged" | "failed" | "uncertain" {
	if ("acquired" in result && result.acquired) return result.value;
	if ("reason" in result && result.reason === "lost" && result.value !== undefined) return result.value;
	return phase === "written" ? "created" : phase === "writing" ? "uncertain" : "failed";
}

/**
 * A failed score persistence and whether any conditional score write had been
 * attempted. Before one nothing was written; after one the stored score is
 * unknown, including when a later readback, reservation check or rollback fails.
 */
export class ScorePersistenceError extends Error {
	readonly scoreWriteAttempted: boolean;
	readonly storageUnavailable: boolean;

	constructor(cause: unknown, scoreWriteAttempted: boolean, storageUnavailable = false) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = "ScorePersistenceError";
		this.scoreWriteAttempted = scoreWriteAttempted;
		this.storageUnavailable = storageUnavailable;
	}
}

class ScoreHistoryWriteError extends Error {
	readonly outcome: "failed" | "uncertain";

	constructor(outcome: "failed" | "uncertain", cause: unknown) {
		super(`SEO score history snapshot ${outcome === "failed" ? "was not written" : "may not have been written"}: ${String(cause)}`);
		this.name = "ScoreHistoryWriteError";
		this.outcome = outcome;
	}
}

function historyStorage(ctx: PluginContext): any {
	return (ctx.storage as any).scoreHistory;
}

function timestamp(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hashText(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36).padStart(7, "0");
}

function normalizedIssues(score: SeoAdminContentScore): SeoAdminScoreHistoryIssue[] {
	return score.checks
		.filter((check) => score.scoreVersion === SEO_SCORE_VERSION
			? classifySeoContentCheck(check, score.assessmentProfile?.profile).issue
			: check.weight > 0 && check.status !== "pass")
		.map((check) => ({
			id: check.id,
			label: check.label,
			category: check.category,
			severity: check.severity,
			status: check.status as SeoAdminScoreHistoryIssue["status"],
			weight: check.weight,
		}))
		.sort((left, right) => left.id.localeCompare(right.id) || left.status.localeCompare(right.status));
}

/** Why a current score showed no number; earlier analyzers are excluded by version instead. */
function unscoredReason(score: SeoAdminContentScore): SeoAdminScoreSnapshotUnscored | undefined {
	if (score.scoreVersion !== SEO_SCORE_VERSION) return undefined;
	const display = seoScoreDisplay(score);
	if (display.score !== null) return undefined;
	return display.label === "Too little text to score" ? "too-little-text" : "partially-checked";
}

export function scoreSnapshotFingerprint(score: SeoAdminContentScore): string {
	const comparisonContext = createScoreComparisonContext(score);
	const unscored = unscoredReason(score);
	return hashText(JSON.stringify({
		scoreVersion: score.scoreVersion,
		score: score.score,
		grade: score.grade,
		sourceUpdatedAt: score.sourceUpdatedAt,
		sourceVersion: score.sourceVersion ?? null,
		templateUpdatedAt: score.templateUpdatedAt,
		modulesUpdatedAt: score.modulesUpdatedAt,
		configurationFingerprint: score.configurationFingerprint,
		metaOverrideUpdatedAt: score.metaOverrideUpdatedAt,
		keyword: score.keyword?.trim().toLocaleLowerCase("en") ?? "",
		issues: normalizedIssues(score).map((issue) => [issue.id, issue.status, issue.weight]),
		...(comparisonContext ? { comparisonContext } : {}),
		...(unscored ? { unscored } : {}),
	}));
}

export function createScoreSnapshot(score: SeoAdminContentScore): SeoAdminScoreSnapshot {
	const capturedAt = score.updatedAt;
	const fingerprint = scoreSnapshotFingerprint(score);
	const comparisonContext = createScoreComparisonContext(score);
	const unscored = unscoredReason(score);
	const compactTime = capturedAt.replace(/[^0-9]/g, "");
	return {
		id: `score-history:${hashText(score.ref)}:${compactTime}:${fingerprint}`,
		storageVersion: SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION,
		fingerprint,
		ref: score.ref,
		collection: score.collection,
		entryId: score.entryId,
		title: score.title,
		score: score.score,
		grade: score.grade,
		scoreVersion: score.scoreVersion,
		analysisRevision: score.analysisRevision,
		sourceUpdatedAt: score.sourceUpdatedAt,
		...(score.sourceVersion ? { sourceVersion: score.sourceVersion } : {}),
		templateUpdatedAt: score.templateUpdatedAt,
		modulesUpdatedAt: score.modulesUpdatedAt,
		configurationFingerprint: score.configurationFingerprint,
		metaOverrideUpdatedAt: score.metaOverrideUpdatedAt,
		capturedAt,
		issues: normalizedIssues(score),
		...(comparisonContext ? { comparisonContext } : {}),
		...(unscored ? { unscored } : {}),
	};
}

function validIssue(value: unknown): value is SeoAdminScoreHistoryIssue {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const issue = value as Partial<SeoAdminScoreHistoryIssue>;
	return (
		typeof issue.id === "string" &&
		typeof issue.label === "string" &&
		["metadata", "indexability", "social", "schema", "content", "keyword", "links", "images", "readability"].includes(String(issue.category)) &&
		["info", "low", "medium", "high", "critical"].includes(String(issue.severity)) &&
		(issue.status === "review" || issue.status === "fail") &&
		typeof issue.weight === "number" &&
		Number.isFinite(issue.weight) &&
		issue.weight > 0
	);
}

export function isScoreSnapshot(id: string, value: unknown): value is SeoAdminScoreSnapshot {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const snapshot = value as Partial<SeoAdminScoreSnapshot>;
	return (
		snapshot.id === id &&
		snapshot.storageVersion === SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION &&
		typeof snapshot.fingerprint === "string" &&
		typeof snapshot.ref === "string" &&
		typeof snapshot.collection === "string" &&
		typeof snapshot.entryId === "string" &&
		typeof snapshot.title === "string" &&
		typeof snapshot.score === "number" &&
		Number.isInteger(snapshot.score) &&
		snapshot.score >= 0 &&
		snapshot.score <= 100 &&
		["excellent", "good", "needs-work", "poor"].includes(String(snapshot.grade)) &&
		typeof snapshot.scoreVersion === "number" &&
		Number.isInteger(snapshot.scoreVersion) &&
		snapshot.scoreVersion > 0 &&
		(snapshot.analysisRevision === undefined ||
			(Number.isSafeInteger(snapshot.analysisRevision) &&
				snapshot.analysisRevision > 0)) &&
		(snapshot.sourceUpdatedAt === null || timestamp(snapshot.sourceUpdatedAt)) &&
		(snapshot.sourceVersion === undefined ||
			(typeof snapshot.sourceVersion === "string" && snapshot.sourceVersion.length > 0 &&
				snapshot.sourceVersion.length <= 2_048)) &&
		(snapshot.templateUpdatedAt === null || timestamp(snapshot.templateUpdatedAt)) &&
		(snapshot.modulesUpdatedAt === undefined || snapshot.modulesUpdatedAt === null || timestamp(snapshot.modulesUpdatedAt)) &&
		(snapshot.configurationFingerprint === undefined || typeof snapshot.configurationFingerprint === "string") &&
		(snapshot.metaOverrideUpdatedAt === undefined || snapshot.metaOverrideUpdatedAt === null || timestamp(snapshot.metaOverrideUpdatedAt)) &&
		timestamp(snapshot.capturedAt) &&
		Array.isArray(snapshot.issues) &&
		snapshot.issues.every(validIssue) &&
		(snapshot.unscored === undefined || snapshot.unscored === "partially-checked" || snapshot.unscored === "too-little-text")
	);
}

function unwrapSnapshot(item: any): SeoAdminScoreSnapshot | null {
	const value = item?.data ?? item;
	const id = String(item?.id ?? value?.id ?? "");
	return isScoreSnapshot(id, value) ? value : null;
}

async function scanScoreHistory(
	store: any,
	where?: Record<string, string>,
): Promise<any[]> {
	const items: any[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;
	do {
		const remaining = SEO_SCORE_HISTORY_GLOBAL_RETENTION - items.length;
		if (remaining <= 0) break;
		const result = await store.query({
			...(where ? { where } : {}),
			limit: Math.min(remaining, 100),
			...(cursor ? { cursor } : {}),
		});
		items.push(...(result.items ?? []));
		if (!result.hasMore) break;
		if (items.length >= SEO_SCORE_HISTORY_GLOBAL_RETENTION) {
			throw new Error(
				`SEO score history exceeds the ${SEO_SCORE_HISTORY_GLOBAL_RETENTION}-record retention cap`,
			);
		}
		const nextCursor = typeof result.cursor === "string" ? result.cursor : "";
		if (!nextCursor || seenCursors.has(nextCursor)) {
			throw new Error("SEO score history pagination did not advance");
		}
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	} while (cursor);
	return items;
}

function scoreHistoryTime(item: any): string {
	return String((item?.data ?? item)?.capturedAt ?? "");
}

function scoreHistoryId(item: any): string {
	return String(item?.id ?? item?.data?.id ?? "");
}

export async function listScoreSnapshots(
	ctx: PluginContext,
	options: ListScoreHistoryOptions = {},
): Promise<SeoAdminScoreSnapshot[]> {
	const store = historyStorage(ctx);
	if (!store?.query) throw new Error("SEO score history storage is unavailable");
	const where: Record<string, string> | undefined = options.ref
		? { ref: options.ref }
		: options.collection
			? { collection: options.collection }
			: undefined;
	const limit = Math.min(Math.max(Math.trunc(options.limit ?? SEO_SCORE_HISTORY_GLOBAL_RETENTION), 1), 2_000);
	const snapshots = (await scanScoreHistory(store, where))
		.map(unwrapSnapshot)
		.filter(Boolean) as SeoAdminScoreSnapshot[];
	return snapshots
		.sort(
			(left, right) =>
				left.capturedAt.localeCompare(right.capturedAt) ||
				left.id.localeCompare(right.id),
		)
		.slice(0, limit);
}

async function pruneEntryHistory(
	ctx: PluginContext,
	ref: string,
	owner: OperationLeaseOwner,
): Promise<void> {
	const store = historyStorage(ctx);
	const items = await scanScoreHistory(store, { ref });
	items.sort(
		(left, right) =>
			scoreHistoryTime(right).localeCompare(scoreHistoryTime(left)) ||
			scoreHistoryId(right).localeCompare(scoreHistoryId(left)),
	);
	const staleIds = items
		.slice(SEO_SCORE_HISTORY_PER_ENTRY_RETENTION)
		.map(scoreHistoryId)
		.filter(Boolean);
	if (staleIds.length) {
		if (owner.signal.aborted || !(await owner.renew()))
			throw new Error("SEO score history lease was lost before entry retention");
		const deleted = await store.deleteMany(staleIds);
		if (!Number.isInteger(deleted) || deleted !== staleIds.length) {
			throw new Error(
				`SEO score history retention did not delete the exact ${staleIds.length} stale records`,
			);
		}
		if (owner.signal.aborted || !(await owner.renew()))
			throw new Error("SEO score history lease was lost during entry retention");
	}
}

async function pruneGlobalHistory(
	ctx: PluginContext,
	owner: OperationLeaseOwner,
): Promise<void> {
	const store = historyStorage(ctx);
	let total = await store.count();
	while (total > SEO_SCORE_HISTORY_GLOBAL_RETENTION) {
		const removeCount = Math.min(
			total - SEO_SCORE_HISTORY_GLOBAL_RETENTION,
			100,
		);
		const result = await store.query({ orderBy: { capturedAt: "asc" }, limit: removeCount });
		const staleIds = (result.items ?? [])
			.map((item: any) => String(item.id ?? item.data?.id ?? ""))
			.filter(Boolean);
		if (!staleIds.length) {
			throw new Error("SEO score history retention made no progress");
		}
		if (owner.signal.aborted || !(await owner.renew()))
			throw new Error("SEO score history lease was lost before global retention");
		const deleted = await store.deleteMany(staleIds);
		if (!Number.isInteger(deleted) || deleted !== staleIds.length) {
			throw new Error(
				`SEO score history retention did not delete the exact ${staleIds.length} stale records`,
			);
		}
		if (owner.signal.aborted || !(await owner.renew()))
			throw new Error("SEO score history lease was lost during global retention");
		const remaining = await store.count();
		if (!Number.isInteger(remaining) || remaining >= total) {
			throw new Error("SEO score history retention made no progress");
		}
		total = remaining;
	}
}

export async function enforceScoreHistoryRetention(ctx: PluginContext): Promise<void> {
	const store = historyStorage(ctx);
	if (!store?.query || !store?.count || !store?.deleteMany) {
		throw new Error("SEO score history storage is unavailable");
	}
	const result = await withOperationLease(
		ctx,
		SCORE_HISTORY_MUTATION_SCOPE,
		(owner) => pruneGlobalHistory(ctx, owner),
	);
	if (!result.acquired)
		throw new Error("SEO score history retention is already running");
}

async function persistScoreSnapshot(
	ctx: PluginContext,
	score: SeoAdminContentScore,
	options: PersistScoreHistoryOptions,
): Promise<"created" | "unchanged"> {
	const store = historyStorage(ctx);
	if (!store?.query || !store?.put || !store?.count || !store?.deleteMany) {
		throw new ScoreHistoryWriteError("failed", "SEO score history storage is unavailable");
	}
	const snapshot = createScoreSnapshot(score);
	// Once the put started, a failure or a lost lease cannot say the snapshot is absent.
	let phase = "before-write" as ScoreHistoryWritePhase;
	let result: OperationLeaseResult<"created" | "unchanged">;
	try {
		result = await withOperationLease(
			ctx,
			SCORE_HISTORY_MUTATION_SCOPE,
			async (owner) => {
				const latestResult = await store.query({
					where: { ref: snapshot.ref },
					orderBy: { capturedAt: "desc" },
					limit: 1,
				});
				const latest = unwrapSnapshot(latestResult.items?.[0]);
				if (latest?.fingerprint === snapshot.fingerprint) return "unchanged" as const;

				if (owner.signal.aborted || !(await owner.renew()))
					throw new Error("SEO score history lease was lost before snapshot persistence");
				phase = "writing";
				await store.put(snapshot.id, snapshot);
				phase = "written";
				try {
					if (owner.signal.aborted || !(await owner.renew()))
						throw new Error("SEO score history lease was lost during snapshot persistence");
					await pruneEntryHistory(ctx, snapshot.ref, owner);
					if (!options.deferGlobalPrune) await pruneGlobalHistory(ctx, owner);
				} catch (error: unknown) {
					ctx.log?.warn?.("seo: score history retention failed after a snapshot", { error: String(error), ref: snapshot.ref });
				}
				return "created" as const;
			},
		);
	} catch (error: unknown) {
		const outcome = scoreHistoryAfterLease({ thrown: error }, phase);
		if (outcome === "failed" || outcome === "uncertain") throw new ScoreHistoryWriteError(outcome, error);
		ctx.log?.warn?.("seo: score history lease failed after a snapshot", { error: String(error), ref: snapshot.ref });
		return outcome;
	}
	const outcome = scoreHistoryAfterLease(result, phase);
	if (outcome === "failed" || outcome === "uncertain") {
		throw new ScoreHistoryWriteError(
			outcome,
			!result.acquired && result.reason === "lost" ? "SEO score history lease was lost" : "SEO score history mutation is already running",
		);
	}
	if (!result.acquired) ctx.log?.warn?.("seo: score history lease was lost after a snapshot", { ref: snapshot.ref });
	return outcome;
}

function scoreSourceTime(value: unknown): number | null {
	if (value === null) return Number.NEGATIVE_INFINITY;
	if (typeof value !== "string") return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

async function scoreReservationMatches(ctx: PluginContext, score: SeoAdminContentScore): Promise<boolean> {
	const store = (ctx.storage as any)?.scoreAnalysisRevisions;
	if (!store || typeof store.get !== "function")
		throw new Error("Score analysis revision storage is unavailable");
	const record = await store.get(score.ref);
	if (!record || typeof record !== "object" || Array.isArray(record) ||
		record.id !== score.ref || record.ref !== score.ref ||
		record.storageVersion !== SCORE_ANALYSIS_REVISION_STORAGE_VERSION ||
		!Number.isSafeInteger(record.revision) || record.revision < 1)
		throw new Error("Score analysis revision was not reserved");
	return record.revision === score.analysisRevision;
}

async function rollbackRejectedScore(
	store: any,
	score: SeoAdminContentScore,
	previous: unknown,
): Promise<void> {
	const next = previous == null
		? { action: "delete" as const }
		: { action: "put" as const, value: previous };
	try {
		if (await compareStoredValue(store, score.ref, { state: "value", value: score }, next)) return;
	} catch (error: unknown) {
		if (JSON.stringify(await store.get(score.ref)) === JSON.stringify(score)) throw error;
		return;
	}
	if (JSON.stringify(await store.get(score.ref)) === JSON.stringify(score))
		throw new Error("Stale score could not be rolled back");
}

async function committedScoreReservationStillCurrent(
	ctx: PluginContext,
	score: SeoAdminContentScore,
	previous: unknown,
): Promise<boolean> {
	const store = (ctx.storage as any).scores;
	let matches: boolean;
	try {
		matches = await scoreReservationMatches(ctx, score);
	} catch (error: unknown) {
		await rollbackRejectedScore(store, score, previous);
		throw error;
	}
	if (matches) return true;
	await rollbackRejectedScore(store, score, previous);
	return false;
}

type CurrentScoreWrite = { persisted: false; refusal: ScorePersistenceRefusal } | { persisted: true; previous: unknown };

async function persistCurrentScoreIfFresh(
	ctx: PluginContext,
	score: SeoAdminContentScore,
	manual?: ManualEntryScoreAdmission,
): Promise<CurrentScoreWrite> {
	const store = (ctx.storage as any)?.scores;
	if (
		!store ||
		typeof store.get !== "function" ||
		!supportsConditionalStorage(store)
	) {
		throw new ScorePersistenceError(new Error("Conditional score writes are unavailable"), false, true);
	}
	const write = { attempted: false };
	try {
		return await writeCurrentScoreIfFresh(ctx, score, store, write, manual);
	} catch (error: unknown) {
		throw new ScorePersistenceError(error, write.attempted);
	}
}

async function writeCurrentScoreIfFresh(
	ctx: PluginContext,
	score: SeoAdminContentScore,
	store: any,
	write: { attempted: boolean },
	manual?: ManualEntryScoreAdmission,
): Promise<CurrentScoreWrite> {
	const incomingSourceTime = scoreSourceTime(score.sourceUpdatedAt);
	if (incomingSourceTime === null)
		throw new Error("Current score has an invalid source revision");
	if (!Number.isSafeInteger(score.analysisRevision) || score.analysisRevision < 1)
		throw new Error("Current score has an invalid analysis revision");

	for (let attempt = 0; attempt < 5; attempt += 1) {
		if (score.sourceVersion) {
			if (!ctx.content) throw new Error("Content read access is unavailable for score persistence");
			const saved = await ctx.content.get(score.collection, score.entryId);
			if (!saved || savedContentVersion(saved) !== score.sourceVersion ||
				(manual && (String(saved.id) !== score.entryId || (typeof saved.locale === "string" ? saved.locale.trim() || null : null) !== manual.locale)))
				return { persisted: false, refusal: "source-changed" };
		}
		const current = await store.get(score.ref);
		if (current != null) {
			if (
				typeof current !== "object" ||
				Array.isArray(current) ||
				(current as any).ref !== score.ref
			) {
				throw new Error("Current score storage key contains an invalid record");
			}
			const currentSourceTime = scoreSourceTime((current as any).sourceUpdatedAt);
			if (currentSourceTime === null)
				throw new Error("Stored score has an invalid source revision");
			if (currentSourceTime > incomingSourceTime) return { persisted: false, refusal: "newer-result" };
			const currentAnalysisRevision = (current as any).analysisRevision;
			if (
				currentAnalysisRevision !== undefined &&
				(!Number.isSafeInteger(currentAnalysisRevision) ||
					currentAnalysisRevision < 1)
			)
				throw new Error("Stored score has an invalid analysis revision");
			if ((currentAnalysisRevision ?? 0) > score.analysisRevision) return { persisted: false, refusal: "newer-result" };
		}
		if (!(await scoreReservationMatches(ctx, score))) return { persisted: false, refusal: "reservation-superseded" };

		let committed = false;
		write.attempted = true;
		try {
			committed = await compareStoredValue(
				store,
				score.ref,
				current == null
					? { state: "missing" }
					: { state: "value", value: current },
				{ action: "put", value: score },
			);
		} catch (error: unknown) {
			const afterError = await store.get(score.ref);
			if (JSON.stringify(afterError) === JSON.stringify(score)) committed = true;
			else if (attempt === 4) throw error;
			else continue;
		}
		if (committed) {
			// A newer reservation may land while the score CAS is in flight.
			return await committedScoreReservationStillCurrent(ctx, score, current)
				? { persisted: true, previous: current }
				: { persisted: false, refusal: "reservation-superseded" };
		}
	}
	throw new Error("Current score changed during conditional persistence");
}

export type ScoreAcceptance = { persisted: true } | { persisted: false; refusal: ScorePersistenceRefusal };

async function postWriteAdmissionRefusal(
	ctx: PluginContext,
	score: SeoAdminContentScore,
	policyRevision: string | null,
	manualEntry: boolean,
): Promise<ScorePersistenceRefusal | null> {
	const policy = await readContentScoringPolicy(ctx);
	if (policy.state === "unavailable") throw new Error("Content analysis policy could not be verified after the score write");
	if (!manualEntry && (policy.state === "paused" || policy.state === "pending-confirmation")) return "scoring-disabled";
	if (policy.revision !== policyRevision) return "policy-changed";
	const profile = await readCollectionAnalysisProfile(ctx, score.collection);
	if (profile.state === "unavailable") throw new Error("Assessment profile could not be verified after the score write");
	if (profile.state !== "configured" || profile.revision !== score.assessmentProfileRevision ||
		profile.profile !== score.assessmentProfile?.profile || profile.version !== score.assessmentProfile?.version)
		return "policy-changed";
	return null;
}

/**
 * The final acceptance of an analyzed score: admitting policy revision,
 * conditional write, post-write reservation check and rollback. It takes no
 * history lease, so a caller may run it inside its own transaction as long as
 * every context port it passes is bound to that transaction.
 */
export async function acceptAnalyzedScore(
	ctx: PluginContext,
	score: SeoAdminContentScore,
	options: Pick<PersistScoreHistoryOptions, "admission" | "manualEntryAdmission"> = {},
): Promise<ScoreAcceptance> {
	if (score.persistence === "session")
		throw new Error("Session analysis cannot be persisted.");
	const manual = options.manualEntryAdmission;
	if (manual && (options.admission || manual.ref !== score.ref || score.ref !== `${score.collection}:${score.entryId}` || !score.sourceVersion))
		return { persisted: false, refusal: "policy-changed" };
	// Manual actions retain the real automatic policy and its revision fence.
	const policy = await readContentScoringPolicy(ctx);
	if (!manual && (policy.state === "paused" || policy.state === "pending-confirmation")) return { persisted: false, refusal: "scoring-disabled" };
	if (policy.state === "unavailable") return { persisted: false, refusal: "scoring-unavailable" };
	const admittingPolicy = manual?.policy ?? options.admission;
	if (admittingPolicy && policy.revision !== admittingPolicy.revision) return { persisted: false, refusal: "policy-changed" };
	const profile = await readCollectionAnalysisProfile(ctx, score.collection);
	if (profile.state !== "configured" || profile.revision !== score.assessmentProfileRevision ||
		profile.profile !== score.assessmentProfile?.profile || profile.version !== score.assessmentProfile?.version)
		return { persisted: false, refusal: "policy-changed" };
	const current = await persistCurrentScoreIfFresh(ctx, score, manual);
	if (!current.persisted) return { persisted: false, refusal: current.refusal };
	try {
		// Fence changes observed while the score CAS was in flight. Separate KV
		// and score ports cannot serialize later changes; a bound host transaction can.
		const refusal = await postWriteAdmissionRefusal(ctx, score, policy.revision, Boolean(manual));
		if (refusal) {
			await rollbackRejectedScore((ctx.storage as any).scores, score, current.previous);
			return { persisted: false, refusal };
		}
		return await committedScoreReservationStillCurrent(ctx, score, current.previous)
			? { persisted: true }
			: { persisted: false, refusal: "reservation-superseded" };
	} catch (error: unknown) {
		try {
			await rollbackRejectedScore((ctx.storage as any).scores, score, current.previous);
		} catch (rollbackError: unknown) {
			throw new ScorePersistenceError(rollbackError, true);
		}
		throw new ScorePersistenceError(error, true);
	}
}

/** History of an accepted score. It never throws and never writes the score again. */
export async function recordAcceptedScoreHistory(
	ctx: PluginContext,
	score: SeoAdminContentScore,
	options: Pick<PersistScoreHistoryOptions, "deferGlobalPrune"> = {},
): Promise<Exclude<ScoreHistoryOutcome, "not-attempted">> {
	try {
		return await persistScoreSnapshot(ctx, score, options);
	} catch (error: unknown) {
		const history = error instanceof ScoreHistoryWriteError ? error.outcome : "failed";
		ctx.log?.warn?.("seo: score history snapshot failed", { error: String(error), ref: score.ref, history });
		return history;
	}
}

export async function persistScoreWithHistory(
	ctx: PluginContext,
	score: SeoAdminContentScore,
	options: PersistScoreHistoryOptions = {},
): Promise<ScorePersistenceResult> {
	const accepted = await acceptAnalyzedScore(ctx, score, options);
	if (!accepted.persisted)
		return { persisted: false, refusal: accepted.refusal, history: "not-attempted", historyCreated: false };
	if (options.manualEntryAdmission && options.manualEntryAdmission.policy.state !== "enabled")
		return { persisted: true, history: "not-attempted", historyCreated: false };
	const history = await recordAcceptedScoreHistory(ctx, score, options);
	return { persisted: true, history, historyCreated: history === "created" };
}

function utcDay(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function average(items: Iterable<SeoAdminScoreSnapshot>): number | null {
	const values = [...items];
	if (!values.length) return null;
	return Math.round(values.reduce((sum, item) => sum + item.score, 0) / values.length);
}

function openIssueKeys(state: Map<string, SeoAdminScoreSnapshot>): Set<string> {
	return new Set(
		[...state.values()].flatMap((snapshot) => snapshot.issues.map((issue) => `${snapshot.ref}:${issue.id}`)),
	);
}

/** Latest snapshots that showed a number; a later dash replaces an earlier number but counts for nothing. */
function numericSnapshots(state: Map<string, SeoAdminScoreSnapshot>): Map<string, SeoAdminScoreSnapshot> {
	return new Map([...state].filter(([, snapshot]) => snapshot.unscored === undefined));
}

function pointForDay(date: string, latest: Map<string, SeoAdminScoreSnapshot>): SeoAdminScoreTrendPoint {
	const state = numericSnapshots(latest);
	let failingIssues = 0;
	let reviewIssues = 0;
	for (const snapshot of state.values()) {
		for (const issue of snapshot.issues) {
			if (issue.status === "fail") failingIssues += 1;
			else reviewIssues += 1;
		}
	}
	return {
		date,
		averageScore: average(state.values()),
		trackedEntries: state.size,
		failingIssues,
		reviewIssues,
	};
}

const SEVERITY_ORDER: Record<SeoAdminScoreHistoryIssue["severity"], number> = {
	critical: 5,
	high: 4,
	medium: 3,
	low: 2,
	info: 1,
};

function topIssues(state: Map<string, SeoAdminScoreSnapshot>): SeoAdminScoreTrendIssue[] {
	const groups = new Map<string, SeoAdminScoreTrendIssue>();
	for (const snapshot of state.values()) {
		for (const issue of snapshot.issues) {
			const existing = groups.get(issue.id);
			if (!existing) {
				groups.set(issue.id, { ...issue, affectedEntries: 1 });
				continue;
			}
			existing.affectedEntries += 1;
			if (issue.status === "fail") existing.status = "fail";
			if (SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[existing.severity]) {
				existing.severity = issue.severity;
			}
		}
	}
	return [...groups.values()]
		.sort((left, right) =>
			right.affectedEntries - left.affectedEntries ||
			Number(right.status === "fail") - Number(left.status === "fail") ||
			SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity] ||
			left.label.localeCompare(right.label),
		)
		.slice(0, 10);
}

export function buildScoreTrends(
	snapshots: readonly SeoAdminScoreSnapshot[],
	options: ScoreTrendOptions = {},
): SeoAdminScoreTrends {
	const now = options.now && Number.isFinite(options.now.valueOf()) ? options.now : new Date();
	const days = Math.min(Math.max(Math.trunc(options.days ?? 30), 7), 90);
	const endDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const windowStart = endDay - (days - 1) * 86_400_000;
	const scoped = snapshots
		.filter((snapshot) =>
			isScoreSnapshot(snapshot.id, snapshot) &&
			(!options.collection || snapshot.collection === options.collection) &&
			(!options.ref || snapshot.ref === options.ref) &&
			Date.parse(snapshot.capturedAt) <= now.valueOf(),
		)
		.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || left.id.localeCompare(right.id));
	const withinWindow = scoped.filter((snapshot) => Date.parse(snapshot.capturedAt) >= windowStart);
	const currentGeneration = scoped.filter((snapshot) => snapshot.scoreVersion === SEO_SCORE_VERSION);

	const state = new Map<string, SeoAdminScoreSnapshot>();
	let cursor = 0;
	const points: SeoAdminScoreTrendPoint[] = [];
	for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
		const dayStart = windowStart + dayIndex * 86_400_000;
		const dayEnd = dayStart + 86_400_000 - 1;
		while (cursor < currentGeneration.length && Date.parse(currentGeneration[cursor].capturedAt) <= dayEnd) {
			state.set(currentGeneration[cursor].ref, currentGeneration[cursor]);
			cursor += 1;
		}
		points.push(pointForDay(utcDay(new Date(dayStart)), state));
	}

	const currentState = numericSnapshots(state);
	const currentAverage = average(currentState.values());
	const currentIssues = openIssueKeys(currentState);
	const { comparison, changes } = buildScoreHistoryComparison(currentGeneration, windowStart, now.valueOf());

	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		storageVersion: SEO_ADMIN_SCORE_HISTORY_STORAGE_VERSION,
		generatedAt: now.toISOString(),
		engineVersion: SEO_ENGINE_VERSION,
		scoreVersion: SEO_SCORE_VERSION,
		scope: {
			days,
			collection: options.collection ?? null,
			ref: options.ref ?? null,
		},
		summary: {
			snapshotCount: withinWindow.length,
			trackedEntries: currentState.size,
			currentAverage,
			openIssues: currentIssues.size,
		},
		comparison,
		points,
		topIssues: topIssues(currentState),
		changes,
		items: [...withinWindow]
			.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))
			.slice(0, 100),
	};
}
