import { compareStoredValue, supportsConditionalStorage } from "./conditional-storage.ts";
import type { PluginContext } from "emdash";
import { matchesIndexNowVerification, type IndexNowVerification } from "./indexnow-verification.ts";
import { IndexNowDeliveryTimeoutError, requestIndexNowDelivery } from "./indexnow-delivery.ts";
import { coexistenceAdmission } from "./plugin-coexistence-runtime.ts";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminIndexNowDelivery,
	type SeoAdminIndexNowHistoryPage,
	type SeoAdminIndexNowHistoryUrl,
	type SeoAdminIndexNowHistoryUrlsPage,
	type SeoAdminIndexNowJob,
	type SeoAdminIndexNowOperationError,
	type SeoAdminIndexNowReason,
	type SeoAdminIndexNowSetupState,
	type SeoAdminIndexNowStatus,
	type SeoAdminIndexNowSubmission,
} from "./admin-contract.ts";
import {
	INDEXNOW_ENDPOINT,
	INDEXNOW_HISTORY_DETAIL_URL_BUDGET,
	INDEXNOW_HISTORY_MAX_PAGE_SIZE,
	INDEXNOW_HISTORY_PAGE_SIZE,
	INDEXNOW_HISTORY_RETENTION,
	INDEXNOW_HISTORY_SAMPLE_URLS,
	INDEXNOW_HISTORY_URL_PAGE_SIZE,
	INDEXNOW_MANUAL_URL_LIMIT,
	INDEXNOW_MAX_URL_LENGTH,
	INDEXNOW_SETTLED_SUBMISSION_STATUSES,
	INDEXNOW_SUBMISSION_BUCKETS,
	INDEXNOW_SUBMISSION_STATUSES,
	UNKNOWN_INDEXNOW_INSTALLATION,
	buildIndexNowPayload,
	classifyIndexNowResponse,
	createIndexNowDeliveryNonce,
	decodeIndexNowHistoryCursor,
	defaultIndexNowSettings,
	emptyIndexNowSubmissionCounts,
	encodeIndexNowHistoryCursor,
	indexNowDeliveryId,
	indexNowHistoryScope,
	indexNowJobId,
	indexNowPublicOrigin,
	indexNowRetryAt,
	indexNowSetupIssue,
	indexNowSubmissionReason,
	indexNowSubmissionStatus,
	normalizeIndexNowUrl,
	resolveIndexNowKeyLocation,
	validateIndexNowSettings,
	type IndexNowInstallation,
	type IndexNowSettingsErrors,
	type IndexNowSettingsValues,
	type IndexNowSetupIssue,
	type IndexNowSubmissionCounts,
	type IndexNowSubmissionEvent,
	type IndexNowSubmissionSource,
	type IndexNowSubmissionStatus,
} from "./indexnow.ts";
import {
	withOperationLease,
	type OperationLeaseOwner,
	type OperationLeaseResult,
} from "./operation-lease.ts";

export const INDEXNOW_SETTINGS_STORAGE_KEY = `settings:indexnow:v${SEO_ADMIN_INDEXNOW_STORAGE_VERSION}`;
const INDEXNOW_DRAIN_TASK_PREFIX = "indexnow-drain-";
const INDEXNOW_DELIVERY_RETENTION = 200;
const INDEXNOW_OPERATION_SCOPE = "indexnow:queue";
const INDEXNOW_SETTINGS_OPERATION_SCOPE = "indexnow:settings";
const INDEXNOW_MAX_QUEUE_SCAN = 10_000;
const INDEXNOW_HISTORY_STARTED_KEY = "state:indexnow-history-started-at";
const INDEXNOW_HISTORY_PRUNE_BATCH = 25;

export interface StoredIndexNowSettings {
	version: typeof SEO_ADMIN_INDEXNOW_STORAGE_VERSION;
	updatedAt: string;
	values: IndexNowSettingsValues;
	verification?: IndexNowVerification;
}

export interface IndexNowUrlCandidate {
	url: string;
	ref?: string | null;
	reason: SeoAdminIndexNowReason;
	/** Defaults to manual for manual reasons and automatic otherwise. */
	source?: IndexNowSubmissionSource;
	/** Defaults to the reason; manual submissions have no event. */
	event?: IndexNowSubmissionEvent | null;
	/** Queue again inside this existing history entry instead of a new one. */
	submissionId?: string;
}

export interface IndexNowEnqueueResult {
	success: boolean;
	enqueued: number;
	skipped: number;
	rejected: string[];
	error?: SeoAdminIndexNowOperationError;
	detail?: string;
	/** Set when URLs were queued: whether their history entries were written. */
	history?: IndexNowHistoryRecording;
}

export interface IndexNowDeliveryRunResult {
	success: boolean;
	enqueued: number;
	skipped: number;
	rejected: string[];
	processed: number;
	error?: SeoAdminIndexNowOperationError;
	detail?: string;
	delivery?: SeoAdminIndexNowDelivery;
	/** Whether the attempt reached the history entries of its jobs. */
	history?: IndexNowHistoryRecording;
}

function cloneSettings(values: IndexNowSettingsValues): IndexNowSettingsValues {
	return { ...values, autoSubmitContentTypes: values.autoSubmitContentTypes?.slice() ?? null };
}

function storedSettings(value: unknown): StoredIndexNowSettings | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredIndexNowSettings>;
	if (candidate.version !== SEO_ADMIN_INDEXNOW_STORAGE_VERSION || typeof candidate.updatedAt !== "string" ||
		!Number.isFinite(Date.parse(candidate.updatedAt))) return null;
	const validation = validateIndexNowSettings(candidate.values);
	if (!validation.success) return null;
	return {
		version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION, updatedAt: candidate.updatedAt, values: validation.values,
		...(candidate.verification && matchesIndexNowVerification(candidate.verification, validation.values, candidate.verification.siteOrigin)
			? { verification: candidate.verification } : {}),
	};
}

interface VersionedSettingsStore {
	getVersioned(key: string): Promise<{ value: unknown; revision: string } | null>;
	compareAndSet(key: string, revision: string | null, value: unknown): Promise<{ applied: boolean; revision?: string }>;
}

export function hasVersionedIndexNowSettings(ctx: PluginContext): boolean {
	const kv = ctx.kv as unknown as Partial<VersionedSettingsStore>;
	return typeof kv.getVersioned === "function" && typeof kv.compareAndSet === "function";
}

export async function readVersionedIndexNowSettings(ctx: PluginContext): Promise<{
	revision: string | null;
	settings: StoredIndexNowSettings | null;
}> {
	if (!hasVersionedIndexNowSettings(ctx)) throw new Error("Automatic setup requires EmDash 0.38 or later with conditional storage.");
	const raw = await (ctx.kv as unknown as VersionedSettingsStore).getVersioned(INDEXNOW_SETTINGS_STORAGE_KEY);
	if (raw === null) return { revision: null, settings: null };
	if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.hasOwn(raw, "value") || !Object.hasOwn(raw, "revision"))
		throw new Error("The host returned invalid versioned settings.");
	const settings = storedSettings(raw.value);
	if (!settings || typeof raw.revision !== "string" || !raw.revision || raw.revision.length > 128)
		throw new Error("Stored IndexNow settings are invalid. Restore a valid configuration before setup.");
	return { revision: raw.revision, settings };
}

export async function writeVersionedIndexNowSettings(
	ctx: PluginContext,
	revision: string | null,
	settings: StoredIndexNowSettings,
): Promise<string | null> {
	const result = await (ctx.kv as unknown as VersionedSettingsStore).compareAndSet(INDEXNOW_SETTINGS_STORAGE_KEY, revision, settings);
	if (!result || typeof result !== "object" || Array.isArray(result) || !Object.hasOwn(result, "applied"))
		throw new Error("The host returned an invalid conditional write result.");
	if (result?.applied === false) return null;
	if (result?.applied !== true || typeof result.revision !== "string" || !result.revision || result.revision.length > 128)
		throw new Error("The host returned an invalid conditional write result.");
	return result.revision;
}

export async function readIndexNowSettings(
	ctx: PluginContext,
): Promise<{ values: IndexNowSettingsValues; updatedAt: string | null; verification?: IndexNowVerification }> {
	const stored = storedSettings(await ctx.kv.get<unknown>(INDEXNOW_SETTINGS_STORAGE_KEY));
	return stored
		? { values: cloneSettings(stored.values), updatedAt: stored.updatedAt, verification: stored.verification }
		: { values: defaultIndexNowSettings(), updatedAt: null };
}

export async function persistIndexNowSettings(
	ctx: PluginContext,
	values: IndexNowSettingsValues,
	previousUpdatedAt: string | null = null,
	verification?: IndexNowVerification,
): Promise<{ values: IndexNowSettingsValues; updatedAt: string; verification?: IndexNowVerification }> {
	const validation = validateIndexNowSettings(values);
	if (!validation.success) throw new Error("Cannot persist invalid IndexNow settings.");
	const updatedAt = nextIndexNowSettingsUpdatedAt(previousUpdatedAt);
	const next: StoredIndexNowSettings = {
		version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
		updatedAt,
		values: validation.values,
		...(verification && matchesIndexNowVerification(verification, validation.values, verification.siteOrigin)
			? { verification } : {}),
	};
	await ctx.kv.set(INDEXNOW_SETTINGS_STORAGE_KEY, next);
	return { values: cloneSettings(validation.values), updatedAt, verification: next.verification };
}

export function nextIndexNowSettingsUpdatedAt(
	previousUpdatedAt: string | null,
	now = new Date(),
): string {
	const previousTime = previousUpdatedAt === null
		? Number.NaN
		: Date.parse(previousUpdatedAt);
	const nextTime = Number.isFinite(previousTime)
		? Math.max(now.valueOf(), previousTime + 1)
		: now.valueOf();
	if (!Number.isFinite(nextTime)) throw new Error("IndexNow settings revision is exhausted.");
	return new Date(nextTime).toISOString();
}

export type IndexNowSettingsUpdateResult =
	| {
			updated: true;
			values: IndexNowSettingsValues;
			updatedAt: string;
			verification?: IndexNowVerification;
	  }
	| {
			updated: false;
			reason: "changed" | "busy" | "saturated" | "unavailable" | "lost";
	  };

export function withIndexNowSettingsLease<T>(
	ctx: PluginContext,
	operation: (owner: OperationLeaseOwner) => Promise<T>,
): Promise<OperationLeaseResult<T>> {
	return withOperationLease(ctx, INDEXNOW_SETTINGS_OPERATION_SCOPE, operation);
}

export function withIndexNowQueueLease<T>(
	ctx: PluginContext,
	operation: (owner: OperationLeaseOwner) => Promise<T>,
): Promise<OperationLeaseResult<T>> {
	return withOperationLease(ctx, INDEXNOW_OPERATION_SCOPE, operation);
}

function indexNowSettingsEqual(
	left: IndexNowSettingsValues,
	right: IndexNowSettingsValues,
): boolean {
	return (
		left.enabled === right.enabled &&
		left.autoSubmit === right.autoSubmit &&
		(left.autoSubmitContentTypes === null
			? right.autoSubmitContentTypes === null
			: right.autoSubmitContentTypes !== null &&
				left.autoSubmitContentTypes.length === right.autoSubmitContentTypes.length &&
				left.autoSubmitContentTypes.every((item, index) => item === right.autoSubmitContentTypes?.[index])) &&
		left.apiKey === right.apiKey &&
		left.keyLocation === right.keyLocation &&
		left.batchSize === right.batchSize &&
		left.minIntervalSeconds === right.minIntervalSeconds &&
		left.maxAttempts === right.maxAttempts
	);
}

async function updateIndexNowSettingsUnlocked(
	ctx: PluginContext,
	update: (
		current: { values: IndexNowSettingsValues; updatedAt: string | null },
	) => IndexNowSettingsValues | Promise<IndexNowSettingsValues>,
	options: { expectedUpdatedAt: string | null } | undefined,
	queueOwner: OperationLeaseOwner,
): Promise<IndexNowSettingsUpdateResult> {
	if (hasVersionedIndexNowSettings(ctx)) {
		const snapshot = await readVersionedIndexNowSettings(ctx);
		const current = snapshot.settings ?? { values: defaultIndexNowSettings(), updatedAt: null };
		if (options && current.updatedAt !== options.expectedUpdatedAt) return { updated: false, reason: "changed" };
		const validation = validateIndexNowSettings(await update(current));
		if (!validation.success) throw new Error("Cannot persist invalid IndexNow settings.");
		const verification = snapshot.settings?.verification;
		const next: StoredIndexNowSettings = {
			version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
			updatedAt: nextIndexNowSettingsUpdatedAt(current.updatedAt), values: validation.values,
			...(verification && matchesIndexNowVerification(verification, validation.values, verification.siteOrigin)
				? { verification } : {}),
		};
		if (!(await retainIndexNowLease(queueOwner))) return { updated: false, reason: "lost" };
		if (await writeVersionedIndexNowSettings(ctx, snapshot.revision, next) === null)
			return { updated: false, reason: "changed" };
		return { updated: true, values: next.values, updatedAt: next.updatedAt, verification: next.verification };
	}
	const leased = await withIndexNowSettingsLease(
		ctx,
		async (): Promise<IndexNowSettingsUpdateResult> => {
			const current = await readIndexNowSettings(ctx);
			if (
				options &&
				current.updatedAt !== options.expectedUpdatedAt
			) {
				return { updated: false, reason: "changed" };
			}
			const values = await update(current);
			if (!(await retainIndexNowLease(queueOwner))) return { updated: false, reason: "lost" };
			return {
				updated: true,
				...(await persistIndexNowSettings(
					ctx,
					values,
					current.updatedAt,
					current.verification,
				)),
			};
		},
	);
	if (leased.acquired) return leased.value;
	if (leased.reason === "lost" && leased.value) {
		if (!leased.value.updated) return leased.value;
		const current = await readIndexNowSettings(ctx);
		if (
			current.updatedAt === leased.value.updatedAt &&
			indexNowSettingsEqual(current.values, leased.value.values)
		) {
			return leased.value;
		}
	}
	return { updated: false, reason: leased.reason };
}

export async function updateIndexNowSettings(
	ctx: PluginContext,
	update: (
		current: { values: IndexNowSettingsValues; updatedAt: string | null },
	) => IndexNowSettingsValues | Promise<IndexNowSettingsValues>,
	options?: { expectedUpdatedAt: string | null },
): Promise<IndexNowSettingsUpdateResult> {
	const leased = await withIndexNowQueueLease(ctx, (owner) =>
		updateIndexNowSettingsUnlocked(ctx, update, options, owner),
	);
	return leased.acquired ? leased.value : { updated: false, reason: leased.reason };
}

class IndexNowAutomationInvalid extends Error {
	readonly errors: IndexNowSettingsErrors;

	constructor(errors: IndexNowSettingsErrors) {
		super("Invalid IndexNow automation change.");
		this.errors = errors;
	}
}

export type IndexNowAutomationResult =
	| IndexNowSettingsUpdateResult
	| { updated: false; reason: "invalid"; errors: IndexNowSettingsErrors };

/**
 * Starts, stops or rescopes automatic submission. A start needs verified
 * delivery, background scheduling and at least one selected public type. Null
 * keeps the legacy all-eligible selection and is accepted only while saved.
 */
export async function updateIndexNowAutomation(
	ctx: PluginContext,
	input: { expectedUpdatedAt: string | null; action: "start" | "stop" | "scope"; contentTypes?: string[] | null },
	context: {
		siteOrigin: string;
		installation: IndexNowInstallation;
		/** `noindex`: content types with a noindex rule, which stay selectable but are never submitted. */
		discovery: { available: boolean; collections: readonly string[]; noindex?: readonly string[] };
	},
): Promise<IndexNowAutomationResult> {
	try {
		return await updateIndexNowSettings(ctx, async (current) => {
			if (input.action === "stop") return { ...current.values, autoSubmit: false };
			const requested = input.contentTypes;
			if (requested === undefined)
				throw new IndexNowAutomationInvalid({ autoSubmitContentTypes: "Choose the content types to submit." });
			if (requested === null && current.values.autoSubmitContentTypes !== null)
				throw new IndexNowAutomationInvalid({ autoSubmitContentTypes: "Choose the content types to submit." });
			if (requested !== null) {
				const validation = validateIndexNowSettings({ ...current.values, autoSubmitContentTypes: requested });
				if (!validation.success)
					throw new IndexNowAutomationInvalid({ autoSubmitContentTypes: validation.errors.autoSubmitContentTypes ?? "Choose up to 100 unique public content types." });
				const saved = new Set(current.values.autoSubmitContentTypes ?? []);
				if (requested.some((collection) => !saved.has(collection) && !context.discovery.collections.includes(collection)))
					throw new IndexNowAutomationInvalid({ autoSubmitContentTypes: "Choose available public content types." });
			}
			const next = { ...current.values, autoSubmitContentTypes: requested === null ? null : [...requested] };
			if (input.action === "scope") return next;
			const verification = (current as { verification?: IndexNowVerification }).verification;
			const issue = indexNowSetupIssue(context.installation, context.siteOrigin);
			if (!next.enabled || issue || !manualSubmissionReady(ctx, next, context.siteOrigin, verification))
				throw new IndexNowAutomationInvalid({ _form: issue?.description ?? "Turn on and verify IndexNow before starting automatic submission." });
			if (!ctx.cron)
				throw new IndexNowAutomationInvalid({ _form: "Automatic submission needs background scheduling, which this host does not provide. Manual submission remains available." });
			if (!context.discovery.available)
				throw new IndexNowAutomationInvalid({ _form: "This site could not list its public content types. Try again later; manual submission remains available." });
			const selected = context.discovery.collections.filter((collection) =>
				next.autoSubmitContentTypes === null || next.autoSubmitContentTypes.includes(collection));
			const eligible = selected.filter((collection) => !context.discovery.noindex?.includes(collection));
			if (!eligible.length)
				throw new IndexNowAutomationInvalid({ autoSubmitContentTypes: selected.length
					? "Every selected content type has a noindex rule in Indexing rules. Choose another content type or change the rule."
					: "Choose at least one public content type to submit automatically." });
			return { ...next, autoSubmit: true };
		}, { expectedUpdatedAt: input.expectedUpdatedAt });
	} catch (error: unknown) {
		if (error instanceof IndexNowAutomationInvalid) return { updated: false, reason: "invalid", errors: error.errors };
		throw error;
	}
}

export async function seedIndexNowSettings(ctx: PluginContext): Promise<void> {
	await withIndexNowQueueLease(ctx, async (owner) => {
		if (hasVersionedIndexNowSettings(ctx)) {
			const current = await readVersionedIndexNowSettings(ctx);
			if (current.settings || !(await retainIndexNowLease(owner))) return;
			await writeVersionedIndexNowSettings(ctx, null, {
				version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION, updatedAt: new Date().toISOString(), values: defaultIndexNowSettings(),
			});
			return;
		}
		if (await ctx.kv.get<unknown>(INDEXNOW_SETTINGS_STORAGE_KEY)) return;
		if (!(await retainIndexNowLease(owner))) return;
		const values = defaultIndexNowSettings();
		await ctx.kv.set(INDEXNOW_SETTINGS_STORAGE_KEY, {
			version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
			updatedAt: new Date().toISOString(),
			values,
		} satisfies StoredIndexNowSettings);
	});
}

function jobs(ctx: PluginContext): any {
	return (ctx.storage as any).indexnowJobs;
}

function deliveries(ctx: PluginContext): any {
	return (ctx.storage as any).indexnowDeliveries;
}

// History is informational. Without these collections the queue keeps working,
// enqueue results report history as unavailable and the history route says so.
function submissions(ctx: PluginContext): any | null {
	const store = (ctx.storage as any)?.indexnowSubmissions;
	return store && typeof store.get === "function" && typeof store.getMany === "function" &&
		typeof store.query === "function" && typeof store.count === "function" &&
		typeof store.deleteMany === "function" && supportsConditionalStorage(store)
		? store
		: null;
}

function submissionUrlPages(ctx: PluginContext): any | null {
	const store = (ctx.storage as any)?.indexnowSubmissionUrls;
	return store && typeof store.get === "function" && typeof store.put === "function" &&
		typeof store.deleteMany === "function"
		? store
		: null;
}

function validJob(id: string, value: unknown): SeoAdminIndexNowJob | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const job = value as SeoAdminIndexNowJob;
	if (
		job.storageVersion !== SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION ||
		job.id !== id ||
		typeof job.url !== "string" ||
		(job.ref !== null && typeof job.ref !== "string") ||
		!(["publish", "update", "unpublish", "delete", "manual"] as string[]).includes(job.reason) ||
		!(["pending", "retry", "delivered", "failed"] as string[]).includes(job.status) ||
		!Number.isInteger(job.attempts) || job.attempts < 0 ||
		(job.nextAttemptAt !== null && typeof job.nextAttemptAt !== "string") ||
		(job.lastHttpStatus !== null && (!Number.isInteger(job.lastHttpStatus) || job.lastHttpStatus < 100 || job.lastHttpStatus > 599)) ||
		(job.lastError !== null && typeof job.lastError !== "string") ||
		(job.lastSubmittedAt !== null && typeof job.lastSubmittedAt !== "string") ||
		typeof job.createdAt !== "string" ||
		typeof job.updatedAt !== "string" ||
		(job.submissionId !== undefined && job.submissionId !== null && typeof job.submissionId !== "string")
	) return null;
	return job;
}

const SUBMISSION_ID_PATTERN = /^submission:[0-9TZ:.-]{20,40}:[a-f0-9]{16}$/;
const SUBMISSION_REF_LIMIT = 512;
const SUBMISSION_DETAIL_LIMIT = 300;
const SUBMISSION_DETAIL_STATES = ["sample", "pages", "expiring", "expired"] as const;

function nonNegativeCount(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function submissionPageCount(urlCount: number): number {
	return Math.ceil(urlCount / INDEXNOW_HISTORY_URL_PAGE_SIZE);
}

function validPositions(value: unknown, length: number): value is number[] {
	return Array.isArray(value) && value.length <= length &&
		value.every((position, index) => Number.isInteger(position) && position >= 0 && position < length &&
			(index === 0 || position > (value[index - 1] as number)));
}

function validSubmission(id: string, value: unknown): SeoAdminIndexNowSubmission | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const item = value as SeoAdminIndexNowSubmission;
	const counts = item.counts as unknown as Record<string, unknown> | undefined;
	if (
		item.storageVersion !== SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION ||
		item.id !== id || !SUBMISSION_ID_PATTERN.test(id) ||
		(item.source !== "automatic" && item.source !== "manual") ||
		(item.event !== null && !(["publish", "update", "unpublish", "delete", "url-change"] as unknown[]).includes(item.event)) ||
		(item.source === "manual") !== (item.event === null) ||
		(item.ref !== null && (typeof item.ref !== "string" || item.ref.length > SUBMISSION_REF_LIMIT)) ||
		!nonNegativeCount(item.urlCount) || item.urlCount < 1 || item.urlCount > INDEXNOW_MANUAL_URL_LIMIT ||
		!Array.isArray(item.sampleUrls) ||
		item.sampleUrls.length !== Math.min(item.urlCount, INDEXNOW_HISTORY_SAMPLE_URLS) ||
		!item.sampleUrls.every((url) => typeof url === "string" && url.length <= INDEXNOW_MAX_URL_LENGTH) ||
		!validPositions(item.sampleSkipped, item.sampleUrls.length) ||
		!(SUBMISSION_DETAIL_STATES as readonly unknown[]).includes(item.detail) ||
		(item.detail === "sample") !== (item.urlCount <= INDEXNOW_HISTORY_SAMPLE_URLS) ||
		!counts || typeof counts !== "object" ||
		!INDEXNOW_SUBMISSION_BUCKETS.every((bucket) => nonNegativeCount(counts[bucket])) ||
		INDEXNOW_SUBMISSION_BUCKETS.reduce((sum, bucket) => sum + (counts[bucket] as number), 0) !== item.urlCount ||
		item.sampleSkipped.length > (counts.skipped as number) ||
		item.status !== indexNowSubmissionStatus(item.counts) ||
		!nonNegativeCount(item.attempts) ||
		(item.lastAttemptAt !== null && typeof item.lastAttemptAt !== "string") ||
		(item.lastHttpStatus !== null && (!Number.isInteger(item.lastHttpStatus) || item.lastHttpStatus < 100 || item.lastHttpStatus > 599)) ||
		(item.nextAttemptAt !== null && typeof item.nextAttemptAt !== "string") ||
		(item.lastDetail !== null && (typeof item.lastDetail !== "string" || item.lastDetail.length > SUBMISSION_DETAIL_LIMIT)) ||
		typeof item.createdAt !== "string" || typeof item.updatedAt !== "string"
	) return null;
	return item;
}

interface StoredSubmissionUrlPage {
	storageVersion: typeof SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION;
	submissionId: string;
	page: number;
	urls: string[];
	/** Positions in `urls` that were skipped as recently submitted. */
	skipped: number[];
}

function submissionUrlPageId(submissionId: string, page: number): string {
	return `${submissionId}:urls:${page}`;
}

function validSubmissionUrlPage(
	submission: SeoAdminIndexNowSubmission,
	page: number,
	value: unknown,
): StoredSubmissionUrlPage | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as StoredSubmissionUrlPage;
	const expected = Math.min(INDEXNOW_HISTORY_URL_PAGE_SIZE, submission.urlCount - page * INDEXNOW_HISTORY_URL_PAGE_SIZE);
	return record.storageVersion === SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION &&
		record.submissionId === submission.id && record.page === page &&
		Array.isArray(record.urls) && record.urls.length === expected &&
		record.urls.every((url) => typeof url === "string" && url.length <= INDEXNOW_MAX_URL_LENGTH) &&
		validPositions(record.skipped, expected)
		? record
		: null;
}

function validDelivery(id: string, value: unknown): SeoAdminIndexNowDelivery | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const delivery = value as SeoAdminIndexNowDelivery;
	if (
		delivery.storageVersion !== SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION ||
		delivery.id !== id ||
		!(["accepted", "retry", "failed"] as string[]).includes(delivery.status) ||
		!Array.isArray(delivery.urls) ||
		!delivery.urls.every((url) => typeof url === "string") ||
		!Number.isInteger(delivery.urlCount) || delivery.urlCount !== delivery.urls.length ||
		(delivery.httpStatus !== null && (!Number.isInteger(delivery.httpStatus) || delivery.httpStatus < 100 || delivery.httpStatus > 599)) ||
		!Number.isInteger(delivery.attempt) || delivery.attempt < 1 ||
		typeof delivery.detail !== "string" ||
		(delivery.retryAt !== null && typeof delivery.retryAt !== "string") ||
		typeof delivery.createdAt !== "string"
	) return null;
	return delivery;
}

async function listJobs(
	ctx: PluginContext,
	options: {
		status?: SeoAdminIndexNowJob["status"];
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
	} = {},
): Promise<SeoAdminIndexNowJob[]> {
	const result = await jobs(ctx).query({
		...(options.status ? { where: { status: options.status } } : {}),
		orderBy: options.orderBy ?? { updatedAt: "desc" },
		limit: Math.min(options.limit ?? 100, 100),
	});
	return (result.items ?? [])
		.map((item: any) => validJob(String(item.id), item.data ?? item))
		.filter(Boolean) as SeoAdminIndexNowJob[];
}

async function listDeliveries(
	ctx: PluginContext,
	options: { status?: SeoAdminIndexNowDelivery["status"]; limit?: number } = {},
): Promise<SeoAdminIndexNowDelivery[]> {
	const result = await deliveries(ctx).query({
		...(options.status ? { where: { status: options.status } } : {}),
		orderBy: { createdAt: "desc" },
		limit: Math.min(options.limit ?? 50, 100),
	});
	return (result.items ?? [])
		.map((item: any) => validDelivery(String(item.id), item.data ?? item))
		.filter(Boolean) as SeoAdminIndexNowDelivery[];
}

async function scanJobsByStatus(
	ctx: PluginContext,
	status: SeoAdminIndexNowJob["status"],
): Promise<SeoAdminIndexNowJob[]> {
	const found: SeoAdminIndexNowJob[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;
	let scanned = 0;
	do {
		const result = await jobs(ctx).query({
			where: { status },
			limit: Math.min(100, INDEXNOW_MAX_QUEUE_SCAN - scanned),
			...(cursor ? { cursor } : {}),
		});
		const page = result.items ?? [];
		if (result.hasMore && page.length === 0) {
			throw new Error(
				"IndexNow queue pagination returned an empty continuing page.",
			);
		}
		scanned += page.length;
		for (const item of page) {
			const job = validJob(
				String((item as any).id),
				(item as any).data ?? item,
			);
			if (job) found.push(job);
		}
		if (!result.hasMore) break;
		if (scanned >= INDEXNOW_MAX_QUEUE_SCAN) {
			throw new Error(
				`IndexNow ${status} queue exceeds the ${INDEXNOW_MAX_QUEUE_SCAN}-record safe scan limit.`,
			);
		}
		const nextCursor = typeof result.cursor === "string" ? result.cursor : "";
		if (!nextCursor || seenCursors.has(nextCursor)) {
			throw new Error("IndexNow queue pagination did not advance.");
		}
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	} while (cursor);
	return found;
}

async function countJobs(ctx: PluginContext, status: SeoAdminIndexNowJob["status"]): Promise<number> {
	return jobs(ctx).count({ status });
}

function readiness(
	ctx: PluginContext,
	settings: IndexNowSettingsValues,
	siteOrigin: string,
	verification: IndexNowVerification | undefined,
	issue: IndexNowSetupIssue | null,
): SeoAdminIndexNowStatus["readiness"] {
	if (!settings.enabled) {
		return { state: "disabled", title: "IndexNow is off", description: "Enable IndexNow to set up and verify this website. No API key is needed from you." };
	}
	if (issue) return { state: "unavailable", title: issue.title, description: issue.description };
	if (!settings.apiKey) {
		return { state: "needs-setup", title: "API key required", description: "Generate or enter an IndexNow API key before sending URLs." };
	}
	const origin = indexNowPublicOrigin(siteOrigin);
	if (!origin.ready) return { state: "needs-setup", title: "Production URL required", description: origin.reason };
	if (!resolveIndexNowKeyLocation(settings.keyLocation, origin.origin)) {
		return { state: "needs-setup", title: "Key location does not match", description: "The verification file must be hosted on the submitted URL host." };
	}
	if (!ctx.http) {
		return { state: "unavailable", title: "Network permission unavailable", description: "The plugin needs host-scoped access to api.indexnow.org." };
	}
	if (!matchesIndexNowVerification(verification, settings, origin.origin))
		return { state: "needs-setup", title: "Verify this website", description: "URL submission is paused until the current key and verification file are checked." };
	if (!manualSubmissionReady(ctx, settings, siteOrigin, verification))
		return { state: "unavailable", title: "Queue storage unavailable", description: "The host must provide conditional storage for IndexNow submissions." };
	if (settings.autoSubmit && !ctx.cron)
		return { state: "unavailable", title: "Background delivery unavailable", description: "The host cannot schedule automatic notifications. Verified manual submission remains available." };
	return {
		state: "ready",
		title: settings.autoSubmit ? "Automatic delivery is ready" : "Manual delivery is ready",
		description: settings.autoSubmit
			? "Published, updated, unpublished, and deleted URLs of selected public content types are queued automatically. Noindex entries are skipped, and so are saves while an entry has unpublished draft changes; publishing the draft sends the URL."
			: "Use manual submission when an important public URL changes.",
	};
}

function manualSubmissionReady(
	ctx: PluginContext,
	settings: IndexNowSettingsValues,
	siteOrigin: string,
	verification?: IndexNowVerification,
): boolean {
	const origin = indexNowPublicOrigin(siteOrigin);
	const queue = (ctx.storage as any)?.indexnowJobs;
	const leases = (ctx.storage as any)?.operationLeases;
	return settings.enabled && Boolean(ctx.http) && origin.ready &&
		Boolean(resolveIndexNowKeyLocation(settings.keyLocation, origin.origin)) &&
		matchesIndexNowVerification(verification, settings, origin.origin) &&
		Boolean(queue && typeof queue.get === "function" && supportsConditionalStorage(queue)) &&
		Boolean(leases && typeof leases.get === "function" && typeof leases.query === "function" && supportsConditionalStorage(leases));
}

function indexNowSetupState(
	installation: IndexNowInstallation,
	siteOrigin: string,
	values: IndexNowSettingsValues,
	verification: IndexNowVerification | undefined,
	issue: IndexNowSetupIssue | null,
): SeoAdminIndexNowSetupState {
	let origin: string | null = null;
	try { origin = siteOrigin ? new URL(siteOrigin).origin : null; } catch { origin = null; }
	let hostPermission: boolean | null = null;
	if (installation.mode !== "unknown") {
		try {
			hostPermission = Boolean(installation.siteUrl && origin &&
				new URL(installation.siteUrl).hostname === new URL(origin).hostname);
		} catch {
			hostPermission = false;
		}
	}
	return {
		origin,
		installation: installation.mode,
		hostPermission,
		keyRoute: installation.keyRoute,
		keySaved: Boolean(values.apiKey),
		verifiedAt: origin && matchesIndexNowVerification(verification, values, origin) ? verification!.checkedAt : null,
		issue,
	};
}

export async function buildAdminIndexNowStatus(
	ctx: PluginContext,
	siteOrigin: string,
	limit = 25,
	settingsSnapshot?: {
		values: IndexNowSettingsValues;
		updatedAt: string;
		verification?: IndexNowVerification;
	},
	installation: IndexNowInstallation = UNKNOWN_INDEXNOW_INSTALLATION,
): Promise<SeoAdminIndexNowStatus> {
	const [
		{ values, updatedAt, verification },
		recentJobs,
		deliveryHistory,
		lastAccepted,
		pending,
		retrying,
		failed,
		delivered,
	] = await Promise.all([
		settingsSnapshot ?? readIndexNowSettings(ctx),
		listJobs(ctx, { limit }),
		listDeliveries(ctx, { limit }),
		listDeliveries(ctx, { status: "accepted", limit: 1 }),
		countJobs(ctx, "pending"),
		countJobs(ctx, "retry"),
		countJobs(ctx, "failed"),
		countJobs(ctx, "delivered"),
	]);
	const origin = indexNowPublicOrigin(siteOrigin);
	const issue = indexNowSetupIssue(installation, siteOrigin);
	const keyLocationUrl = origin.ready && !issue ? resolveIndexNowKeyLocation(values.keyLocation, origin.origin) : null;
	const manualReady = !issue && manualSubmissionReady(ctx, values, siteOrigin, verification);
	let schedulingMissing = false;
	// Manual lists also leave their later batches to background drains.
	if (manualReady && ctx.cron && (pending > 0 || retrying > 0)) {
		try {
			const dueAt = await nextIndexNowDueAt(ctx);
			const tasks = await ctx.cron.list();
			const now = Date.now();
			const latestUsefulRun = Math.max(now + 1_000, dueAt ?? now);
			schedulingMissing = dueAt === null || !tasks.some((task) => {
				const runAt = Date.parse(task.nextRunAt);
				return task.name.startsWith(INDEXNOW_DRAIN_TASK_PREFIX) &&
					Number.isFinite(runAt) && runAt > now && runAt <= latestUsefulRun;
			});
		} catch {
			schedulingMissing = true;
		}
	}
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		protocolVersion: 1,
		storageVersion: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt: new Date().toISOString(),
		updatedAt,
		endpoint: INDEXNOW_ENDPOINT,
		values,
		contentTypeDiscoveryAvailable: false,
		contentTypes: [],
		keyLocationUrl,
		manualSubmissionReady: manualReady,
		readiness: schedulingMissing
			? { state: "unavailable", title: "Background delivery needs attention", description: "Pending URLs are not scheduled. Process the queue manually or verify again to resume automatic delivery." }
			: readiness(ctx, values, siteOrigin, verification, issue),
		capabilities: { network: Boolean(ctx.http), cron: Boolean(ctx.cron) },
		queue: {
			pending,
			retrying,
			failed,
			delivered,
			lastAcceptedAt: lastAccepted[0]?.createdAt ?? null,
		},
		jobs: recentJobs,
		deliveries: deliveryHistory,
		setup: indexNowSetupState(installation, siteOrigin, values, verification, issue),
	};
}

async function scheduleDrain(ctx: PluginContext, runAt: string, currentTask?: string, leaseOwner?: OperationLeaseOwner, strict = false): Promise<boolean> {
	if (!ctx.cron) return coexistenceAdmission(ctx, "indexnow");
	const timestamp = Math.max(Date.now() + 1_000, Date.parse(runAt));
	const name = `${INDEXNOW_DRAIN_TASK_PREFIX}${timestamp}`;
	try {
		const existing = (await ctx.cron.list())
			.filter((task) => task.name.startsWith(INDEXNOW_DRAIN_TASK_PREFIX) && task.name !== currentTask);
		if (!(await coexistenceAdmission(ctx, "indexnow"))) return false;
		const earliest = existing
			.map((task) => ({ task, timestamp: Date.parse(task.nextRunAt) }))
			.filter((item) => Number.isFinite(item.timestamp) && item.timestamp > Date.now())
			.sort((left, right) => left.timestamp - right.timestamp)[0];
		if (earliest && earliest.timestamp <= timestamp) {
			for (const task of existing) {
				if (task.name !== earliest.task.name) {
					if (!(await retainIndexNowLease(leaseOwner))) return true;
					await ctx.cron.cancel(task.name);
				}
			}
			return true;
		}
		for (const task of existing) {
			if (!(await retainIndexNowLease(leaseOwner))) return true;
			await ctx.cron.cancel(task.name);
		}
		if (!(await retainIndexNowLease(leaseOwner))) return true;
		await ctx.cron.schedule(name, { schedule: new Date(timestamp).toISOString() });
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow failed to schedule queue drain", { error: String(error) });
		if (strict) throw error;
	}
	return true;
}

async function cancelDrainTasks(ctx: PluginContext, currentTask?: string, leaseOwner?: OperationLeaseOwner): Promise<boolean> {
	if (!ctx.cron) return coexistenceAdmission(ctx, "indexnow");
	try {
		const tasks = await ctx.cron.list();
		if (!(await coexistenceAdmission(ctx, "indexnow"))) return false;
		for (const task of tasks) {
			if (task.name.startsWith(INDEXNOW_DRAIN_TASK_PREFIX) && task.name !== currentTask) {
				if (!(await retainIndexNowLease(leaseOwner))) return true;
				await ctx.cron.cancel(task.name);
			}
		}
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow failed to clear idle queue tasks", { error: String(error) });
	}
	return true;
}

export function isIndexNowDrainTask(name: string): boolean {
	return name.startsWith(INDEXNOW_DRAIN_TASK_PREFIX);
}

async function retainIndexNowLease(
	owner?: OperationLeaseOwner,
): Promise<boolean> {
	if (!owner) return true;
	if (owner.signal.aborted) return false;
	try {
		return await owner.renew();
	} catch {
		return false;
	}
}

function indexNowEnqueueLeaseLost(
	enqueued = 0,
	skipped = 0,
	rejected: string[] = [],
): IndexNowEnqueueResult {
	return {
		success: false,
		enqueued,
		skipped,
		rejected,
		error: "delivery_in_progress",
		detail:
			"The IndexNow queue lease changed during the operation. Refresh queue status before retrying.",
	};
}

function indexNowCoexistencePaused(
	enqueued = 0,
	skipped = 0,
	rejected: string[] = [],
): IndexNowEnqueueResult {
	return {
		success: false,
		enqueued,
		skipped,
		rejected,
		error: "coexistence_paused",
		detail: "IndexNow is paused while another indexing plugin is active or plugin state is unavailable. Saved settings and pending jobs are kept.",
	};
}

export type IndexNowHistoryRecording = "recorded" | "partial" | "unavailable";

export function indexNowSubmissionId(createdAt: string, nonce = createIndexNowDeliveryNonce()): string {
	return `submission:${createdAt}:${nonce}`;
}

type SubmissionBucket = keyof IndexNowSubmissionCounts;

function jobBucket(job: Pick<SeoAdminIndexNowJob, "status" | "lastHttpStatus">): SubmissionBucket {
	if (job.status === "pending") return "queued";
	if (job.status === "retry") return "retrying";
	if (job.status === "failed") return "failed";
	return job.lastHttpStatus === 202 ? "accepted" : "sent";
}

interface SubmissionAttempt {
	at: string;
	httpStatus: number | null;
	attempts: number;
	/** Set only when one of the entry's URLs was scheduled for retry by this attempt. */
	retryAt: string | null;
	detail: string;
}

interface SubmissionChange {
	moves: Array<[SubmissionBucket, SubmissionBucket]>;
	attempt?: SubmissionAttempt;
}

interface SubmissionDraft {
	id: string;
	createdAt: string;
	source: IndexNowSubmissionSource;
	event: IndexNowSubmissionEvent | null;
	ref: string | null;
	urls: string[];
	skipped: number[];
	queued: number;
}

function addSubmissionMove(
	changes: Map<string, SubmissionChange>,
	id: string,
	from: SubmissionBucket,
	to: SubmissionBucket,
): void {
	if (from === to) return;
	const change = changes.get(id) ?? { moves: [] };
	change.moves.push([from, to]);
	changes.set(id, change);
}

// Moves keep the bucket total equal to urlCount. A move whose source bucket is
// already empty belongs to an update that was missed earlier and is dropped.
function changedSubmission(
	item: SeoAdminIndexNowSubmission,
	change: SubmissionChange,
	now: string,
): SeoAdminIndexNowSubmission {
	const counts = { ...item.counts };
	for (const [from, to] of change.moves) {
		if (counts[from] < 1) continue;
		counts[from] -= 1;
		counts[to] += 1;
	}
	const attempt = change.attempt;
	return {
		...item,
		counts,
		status: indexNowSubmissionStatus(counts),
		...(attempt ? {
			attempts: Math.max(item.attempts, attempt.attempts),
			lastAttemptAt: attempt.at,
			lastHttpStatus: attempt.httpStatus,
			lastDetail: attempt.detail.slice(0, SUBMISSION_DETAIL_LIMIT),
		} : {}),
		nextAttemptAt: counts.retrying > 0 ? attempt?.retryAt ?? item.nextAttemptAt : null,
		updatedAt: now,
	};
}

// Re-reads after a conflict and applies the same relative moves again. A write
// that rejected after committing is recognized by its exact stored value.
async function writeSubmissionChange(
	store: any,
	id: string,
	change: SubmissionChange,
	leaseOwner?: OperationLeaseOwner,
): Promise<boolean> {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		if (!(await retainIndexNowLease(leaseOwner))) return false;
		const raw = await store.get(id);
		const item = validSubmission(id, raw);
		if (!item) return false;
		const next = changedSubmission(item, change, new Date().toISOString());
		let committed = false;
		try {
			committed = await compareStoredValue(store, id, { state: "value", value: raw }, { action: "put", value: next });
		} catch {
			committed = JSON.stringify(await store.get(id)) === JSON.stringify(next);
		}
		if (committed) return true;
	}
	return false;
}

async function updateIndexNowSubmissions(
	ctx: PluginContext,
	changes: Map<string, SubmissionChange>,
	leaseOwner?: OperationLeaseOwner,
): Promise<IndexNowHistoryRecording> {
	if (!changes.size) return "recorded";
	const store = submissions(ctx);
	if (!store) return "unavailable";
	let complete = true;
	try {
		for (const [id, change] of changes) {
			if (!(await writeSubmissionChange(store, id, change, leaseOwner))) complete = false;
		}
	} catch (error: unknown) {
		complete = false;
		ctx.log.warn("seo:indexnow history update failed", { error: String(error) });
	}
	if (!complete) ctx.log.warn("seo:indexnow history counters were not fully updated", { entries: changes.size });
	return complete ? "recorded" : "partial";
}

async function markIndexNowHistoryStarted(ctx: PluginContext, at: string): Promise<void> {
	try {
		const kv = ctx.kv as unknown as Partial<VersionedSettingsStore>;
		if (typeof kv.getVersioned === "function" && typeof kv.compareAndSet === "function") {
			if (!(await kv.getVersioned(INDEXNOW_HISTORY_STARTED_KEY)))
				await kv.compareAndSet(INDEXNOW_HISTORY_STARTED_KEY, null, at);
		} else if (!(await ctx.kv.get<string>(INDEXNOW_HISTORY_STARTED_KEY))) {
			await ctx.kv.set(INDEXNOW_HISTORY_STARTED_KEY, at);
		}
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow history start marker failed", { error: String(error) });
	}
}

// The entry turns `expiring` before its pages are deleted, so readers never use a
// partly deleted list. A failed delete leaves it `expiring` for the next sweep.
async function expireIndexNowSubmissionDetail(
	store: any,
	pages: any,
	raw: unknown,
	entry: SeoAdminIndexNowSubmission,
	leaseOwner?: OperationLeaseOwner,
): Promise<boolean> {
	let current = raw;
	if (entry.detail === "pages") {
		if (!(await retainIndexNowLease(leaseOwner))) return false;
		const expiring = { ...entry, detail: "expiring" as const, updatedAt: new Date().toISOString() };
		if (!(await compareStoredValue(store, entry.id, { state: "value", value: current }, { action: "put", value: expiring })))
			return false;
		current = expiring;
	}
	if (!(await retainIndexNowLease(leaseOwner))) return false;
	await pages.deleteMany(Array.from(
		{ length: submissionPageCount(entry.urlCount) },
		(_, page) => submissionUrlPageId(entry.id, page),
	));
	if (!(await retainIndexNowLease(leaseOwner))) return false;
	return compareStoredValue(store, entry.id, { state: "value", value: current }, {
		action: "put",
		value: { ...(current as SeoAdminIndexNowSubmission), detail: "expired", updatedAt: new Date().toISOString() },
	});
}

const DETAIL_HOLDER_QUERY_PAGES = Math.ceil(
	(INDEXNOW_HISTORY_DETAIL_URL_BUDGET + INDEXNOW_MANUAL_URL_LIMIT) / (INDEXNOW_HISTORY_SAMPLE_URLS + 1) / 100,
) + 2;

// Every entry holding pages has more than INDEXNOW_HISTORY_SAMPLE_URLS URLs, so
// the holders of a full budget fit in DETAIL_HOLDER_QUERY_PAGES reads.
async function reserveIndexNowDetailBudget(
	ctx: PluginContext,
	store: any,
	pages: any,
	needed: number,
	excludeId: string,
	leaseOwner?: OperationLeaseOwner,
): Promise<boolean> {
	const holders: Array<{ raw: unknown; entry: SeoAdminIndexNowSubmission }> = [];
	let held = 0;
	let cursor: string | undefined;
	let complete = false;
	for (let read = 0; read < DETAIL_HOLDER_QUERY_PAGES; read += 1) {
		const result = await store.query({
			where: { detail: { in: ["pages", "expiring"] } },
			orderBy: { createdAt: "asc" },
			limit: 100,
			...(cursor ? { cursor } : {}),
		});
		for (const item of result.items ?? []) {
			const raw = (item as any).data ?? item;
			const entry = validSubmission(String((item as any).id), raw);
			if (!entry || entry.id === excludeId) continue;
			holders.push({ raw, entry });
			held += entry.urlCount;
		}
		if (!result.hasMore) { complete = true; break; }
		if (typeof result.cursor !== "string" || !result.cursor) break;
		cursor = result.cursor;
	}
	if (!complete) {
		ctx.log.warn("seo:indexnow history detail budget could not be verified");
		return false;
	}
	let excess = held + needed - INDEXNOW_HISTORY_DETAIL_URL_BUDGET;
	for (const { raw, entry } of holders) {
		if (excess <= 0) break;
		if (!(await expireIndexNowSubmissionDetail(store, pages, raw, entry, leaseOwner))) return false;
		excess -= entry.urlCount;
	}
	return excess <= 0;
}

async function createIndexNowSubmissions(
	ctx: PluginContext,
	drafts: readonly SubmissionDraft[],
	leaseOwner?: OperationLeaseOwner,
): Promise<IndexNowHistoryRecording> {
	const queued = drafts.filter((draft) => draft.queued > 0);
	if (!queued.length) return "recorded";
	const store = submissions(ctx);
	if (!store) return "unavailable";
	const pages = submissionUrlPages(ctx);
	let complete = true;
	let created = false;
	try {
		for (const draft of queued) {
			if (!(await retainIndexNowLease(leaseOwner))) return "partial";
			const counts = { ...emptyIndexNowSubmissionCounts(), queued: draft.queued, skipped: draft.skipped.length };
			const sampleUrls = draft.urls.slice(0, INDEXNOW_HISTORY_SAMPLE_URLS);
			const withPages = draft.urls.length > INDEXNOW_HISTORY_SAMPLE_URLS;
			const record: SeoAdminIndexNowSubmission = {
				id: draft.id,
				storageVersion: SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION,
				source: draft.source,
				event: draft.event,
				ref: draft.ref,
				urlCount: draft.urls.length,
				sampleUrls,
				sampleSkipped: draft.skipped.filter((position) => position < sampleUrls.length),
				// Pages are written after the entry; until they are complete the
				// sweep treats them as removable.
				detail: withPages ? "expiring" : "sample",
				counts,
				status: indexNowSubmissionStatus(counts),
				attempts: 0,
				lastAttemptAt: null,
				lastHttpStatus: null,
				nextAttemptAt: null,
				lastDetail: null,
				createdAt: draft.createdAt,
				updatedAt: draft.createdAt,
			};
			if (!(await compareStoredValue(store, draft.id, { state: "missing" }, { action: "put", value: record }))) {
				complete = false;
				continue;
			}
			created = true;
			if (!withPages) continue;
			if (!pages || !(await reserveIndexNowDetailBudget(ctx, store, pages, draft.urls.length, draft.id, leaseOwner))) {
				complete = false;
				continue;
			}
			for (let page = 0; page < submissionPageCount(draft.urls.length); page += 1) {
				if (!(await retainIndexNowLease(leaseOwner))) return "partial";
				const start = page * INDEXNOW_HISTORY_URL_PAGE_SIZE;
				const end = start + INDEXNOW_HISTORY_URL_PAGE_SIZE;
				await pages.put(submissionUrlPageId(draft.id, page), {
					storageVersion: SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION,
					submissionId: draft.id,
					page,
					urls: draft.urls.slice(start, end),
					skipped: draft.skipped.filter((position) => position >= start && position < end).map((position) => position - start),
				} satisfies StoredSubmissionUrlPage);
			}
			if (!(await retainIndexNowLease(leaseOwner))) return "partial";
			if (!(await compareStoredValue(store, draft.id, { state: "value", value: record }, {
				action: "put", value: { ...record, detail: "pages" },
			}))) complete = false;
		}
	} catch (error: unknown) {
		complete = false;
		ctx.log.warn("seo:indexnow history entry was not fully recorded", { error: String(error) });
	} finally {
		if (created) await markIndexNowHistoryStarted(ctx, queued[0]!.createdAt);
	}
	return complete ? "recorded" : "partial";
}

/**
 * Bounded upkeep after an enqueue: finishes at most 10 interrupted detail
 * expiries and removes at most INDEXNOW_HISTORY_PRUNE_BATCH settled entries
 * beyond INDEXNOW_HISTORY_RETENTION. Queue jobs and unsettled entries are kept.
 */
async function maintainIndexNowHistory(ctx: PluginContext, leaseOwner?: OperationLeaseOwner): Promise<void> {
	const store = submissions(ctx);
	const pages = submissionUrlPages(ctx);
	if (!store || !pages) return;
	try {
		const expiring = await store.query({ where: { detail: "expiring" }, orderBy: { createdAt: "asc" }, limit: 10 });
		for (const item of expiring.items ?? []) {
			const raw = (item as any).data ?? item;
			const entry = validSubmission(String((item as any).id), raw);
			if (entry && !(await expireIndexNowSubmissionDetail(store, pages, raw, entry, leaseOwner))) return;
		}
		const excess = (await store.count()) - INDEXNOW_HISTORY_RETENTION;
		if (excess <= 0) return;
		const stale = await store.query({
			where: { status: { in: [...INDEXNOW_SETTLED_SUBMISSION_STATUSES] } },
			orderBy: { createdAt: "asc" },
			limit: Math.min(excess, INDEXNOW_HISTORY_PRUNE_BATCH),
		});
		const removable: string[] = [];
		for (const item of stale.items ?? []) {
			const raw = (item as any).data ?? item;
			const entry = validSubmission(String((item as any).id), raw);
			if (!entry) continue;
			if ((entry.detail === "pages" || entry.detail === "expiring") &&
				!(await expireIndexNowSubmissionDetail(store, pages, raw, entry, leaseOwner))) continue;
			removable.push(entry.id);
		}
		if (removable.length && await retainIndexNowLease(leaseOwner)) await store.deleteMany(removable);
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow history retention failed", { error: String(error) });
	}
}

async function enqueueIndexNowUrlsUnlocked(
	ctx: PluginContext,
	siteOrigin: string,
	candidates: readonly IndexNowUrlCandidate[],
	options: { force?: boolean; delayMs?: number } = {},
	leaseOwner?: OperationLeaseOwner,
): Promise<IndexNowEnqueueResult> {
	const jobStore = jobs(ctx);
	if (!supportsConditionalStorage(jobStore)) {
		return {
			success: false,
			enqueued: 0,
			skipped: 0,
			rejected: [],
			error: "delivery_in_progress",
			detail:
				"IndexNow enqueue requires conditional queue writes. No queue job was changed.",
		};
	}
	const putJobIfUnchanged = compareStoredValue.bind(null, jobStore);
	const { values, verification } = await readIndexNowSettings(ctx);
	if (!(await retainIndexNowLease(leaseOwner)))
		return indexNowEnqueueLeaseLost();
	if (!(await coexistenceAdmission(ctx, "indexnow"))) return indexNowCoexistencePaused();
	if (!values.enabled) {
		return {
			success: false,
			enqueued: 0,
			skipped: 0,
			rejected: [],
			error: "indexnow_disabled",
			detail: "Enable IndexNow before queuing URLs.",
		};
	}
	const origin = indexNowPublicOrigin(siteOrigin);
	if (
		!origin.ready ||
		!values.apiKey ||
		!resolveIndexNowKeyLocation(values.keyLocation, origin.origin)
	) {
		return {
			success: false,
			enqueued: 0,
			skipped: 0,
			rejected: [],
			error: "indexnow_not_configured",
			detail: origin.ready
				? "Complete the API key and key location setup."
				: origin.reason,
		};
	}
	if (!matchesIndexNowVerification(verification, values, origin.origin)) {
		return {
			success: false,
			enqueued: 0,
			skipped: 0,
			rejected: [],
			error: "indexnow_not_configured",
			detail: "Verify this website's current IndexNow key before queuing URLs.",
		};
	}
	const now = new Date();
	const nowIso = now.toISOString();
	const dueAt = new Date(
		now.getTime() + Math.max(0, options.delayMs ?? 0),
	).toISOString();
	let enqueued = 0;
	let skipped = 0;
	const rejected: string[] = [];
	const unique = new Map<string, IndexNowUrlCandidate>();
	for (const candidate of candidates) {
		const normalized = normalizeIndexNowUrl(candidate.url, origin.origin);
		if (!normalized) {
			rejected.push(candidate.url);
			continue;
		}
		unique.set(normalized, { ...candidate, url: normalized });
	}
	const historyAvailable = submissions(ctx) !== null;
	const drafts = new Map<string, SubmissionDraft>();
	const changes = new Map<string, SubmissionChange>();
	// One history entry per source, event and content entry; a URL change
	// therefore records its old and new URL as two entries.
	const draftFor = (candidate: IndexNowUrlCandidate): SubmissionDraft => {
		const source = candidate.source ?? (candidate.reason === "manual" ? "manual" : "automatic");
		const event = source === "manual"
			? null
			: candidate.event ?? (candidate.reason === "manual" ? "update" : candidate.reason);
		const ref = source === "manual" || !candidate.ref || candidate.ref.length > SUBMISSION_REF_LIMIT
			? null
			: candidate.ref;
		const key = `${source}\n${event ?? ""}\n${ref ?? ""}`;
		let draft = drafts.get(key);
		if (!draft) {
			draft = { id: indexNowSubmissionId(nowIso), createdAt: nowIso, source, event, ref, urls: [], skipped: [], queued: 0 };
			drafts.set(key, draft);
		}
		return draft;
	};
	const enqueueCandidates = async (): Promise<IndexNowEnqueueResult | null> => {
		for (const candidate of unique.values()) {
			if (!(await retainIndexNowLease(leaseOwner)))
				return indexNowEnqueueLeaseLost(enqueued, skipped, rejected);
			const id = indexNowJobId(candidate.url);
			const existingValue = await jobs(ctx).get(id);
			const existing = validJob(id, existingValue);
			if (existingValue != null && !existing) {
				return {
					success: false,
					enqueued,
					skipped,
					rejected,
					error: "delivery_in_progress",
					detail: "An IndexNow queue key contains an invalid record.",
				};
			}
			if (!(await retainIndexNowLease(leaseOwner)))
				return indexNowEnqueueLeaseLost(enqueued, skipped, rejected);
			const draft = historyAvailable && !candidate.submissionId ? draftFor(candidate) : null;
			const lastSubmitted = existing?.lastSubmittedAt
				? Date.parse(existing.lastSubmittedAt)
				: 0;
			if (
				!options.force &&
				lastSubmitted &&
				now.getTime() - lastSubmitted < values.minIntervalSeconds * 1_000
			) {
				skipped += 1;
				if (draft && draft.urls.length < INDEXNOW_MANUAL_URL_LIMIT) {
					draft.skipped.push(draft.urls.length);
					draft.urls.push(candidate.url);
				}
				continue;
			}
			const submissionId = draft?.id ?? (historyAvailable ? candidate.submissionId ?? null : null);
			const createdAt = existing?.createdAt ?? nowIso;
			const job: SeoAdminIndexNowJob = {
				id,
				storageVersion: SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION,
				url: candidate.url,
				ref: candidate.ref ?? existing?.ref ?? null,
				reason: candidate.reason,
				status: "pending",
				attempts: 0,
				nextAttemptAt: dueAt,
				lastHttpStatus: existing?.lastHttpStatus ?? null,
				lastError: null,
				lastSubmittedAt: existing?.lastSubmittedAt ?? null,
				createdAt,
				updatedAt: nowIso,
				...(submissionId ? { submissionId } : {}),
			};
			if (!(await retainIndexNowLease(leaseOwner)))
				return indexNowEnqueueLeaseLost(enqueued, skipped, rejected);
			let committed = false;
			try {
				committed = await putJobIfUnchanged(
					id,
					existingValue == null
						? { state: "missing" }
						: { state: "value", value: existingValue },
					{ action: "put", value: job },
				);
			} catch (error: unknown) {
				const afterError = await jobs(ctx).get(id);
				if (JSON.stringify(afterError) === JSON.stringify(job)) {
					committed = true;
				} else {
					ctx.log.warn("seo:indexnow enqueue snapshot write failed", {
						jobId: id,
						error: String(error),
					});
				}
			}
			if (!committed) {
				return {
					success: false,
					enqueued,
					skipped,
					rejected,
					error: "delivery_in_progress",
					detail:
						"An IndexNow queue job changed during enqueue. Refresh queue status before retrying.",
				};
			}
			enqueued += 1;
			if (draft) {
				draft.urls.push(candidate.url);
				draft.queued += 1;
			} else if (submissionId && existing?.submissionId === submissionId) {
				addSubmissionMove(changes, submissionId, jobBucket(existing), "queued");
			}
			if (existing?.submissionId && existing.submissionId !== submissionId &&
				(existing.status === "pending" || existing.status === "retry"))
				addSubmissionMove(changes, existing.submissionId, jobBucket(existing), "superseded");
			if (!(await retainIndexNowLease(leaseOwner)))
				return indexNowEnqueueLeaseLost(enqueued, skipped, rejected);
		}
		return null;
	};
	let early: IndexNowEnqueueResult | null = null;
	let failure: { error: unknown } | null = null;
	try {
		early = await enqueueCandidates();
	} catch (error: unknown) {
		failure = { error };
	}
	let history: IndexNowHistoryRecording | undefined;
	if (enqueued) {
		if (await retainIndexNowLease(leaseOwner)) {
			// History is written before the drain is scheduled so a later drain
			// always finds the entries its jobs refer to.
			const recorded = [
				await createIndexNowSubmissions(ctx, [...drafts.values()], leaseOwner),
				await updateIndexNowSubmissions(ctx, changes, leaseOwner),
			];
			history = !historyAvailable
				? "unavailable"
				: recorded.every((value) => value === "recorded") ? "recorded" : "partial";
			await maintainIndexNowHistory(ctx, leaseOwner);
			if (await retainIndexNowLease(leaseOwner) && !(await scheduleDrain(ctx, dueAt, undefined, leaseOwner)))
				early ??= indexNowCoexistencePaused(enqueued, skipped, rejected);
		} else {
			history = historyAvailable ? "partial" : "unavailable";
		}
	}
	if (failure) throw failure.error;
	if (early) return { ...early, ...(history ? { history } : {}) };
	if (enqueued && !(await retainIndexNowLease(leaseOwner)))
		return { ...indexNowEnqueueLeaseLost(enqueued, skipped, rejected), ...(history ? { history } : {}) };
	return {
		success: enqueued > 0 || skipped > 0,
		enqueued,
		skipped,
		rejected,
		...(history ? { history } : {}),
		...(enqueued || skipped
			? {}
			: {
					error: "no_valid_urls" as const,
					detail: "No same-host HTTP(S) URLs were accepted.",
				}),
	};
}

export async function enqueueIndexNowUrls(
	ctx: PluginContext,
	siteOrigin: string,
	candidates: readonly IndexNowUrlCandidate[],
	options: { force?: boolean; delayMs?: number } = {},
): Promise<IndexNowEnqueueResult> {
	if (!(await coexistenceAdmission(ctx, "indexnow"))) return indexNowCoexistencePaused();
	const leased = await withOperationLease(ctx, INDEXNOW_OPERATION_SCOPE, (owner) =>
		enqueueIndexNowUrlsUnlocked(ctx, siteOrigin, candidates, options, owner),
	);
	if (leased.acquired) return leased.value;
	if ("value" in leased && leased.value !== undefined) return leased.value;
	return {
				success: false,
				enqueued: 0,
				skipped: 0,
				rejected: [],
				error: "delivery_in_progress",
				detail:
					"Another IndexNow queue operation owns the durable lease. Retry after it completes.",
			};
}

function dueJobs(allJobs: SeoAdminIndexNowJob[], now: Date, force: boolean): SeoAdminIndexNowJob[] {
	return allJobs.filter((job) => {
		if (job.status !== "pending" && job.status !== "retry") return false;
		if (force || !job.nextAttemptAt) return true;
		const due = Date.parse(job.nextAttemptAt);
		return Number.isNaN(due) || due <= now.getTime();
	}).sort((left, right) => (left.nextAttemptAt ?? "").localeCompare(right.nextAttemptAt ?? ""));
}

async function deliveryCandidates(
	ctx: PluginContext,
	batchSize: number,
	now: Date,
	force: boolean,
): Promise<SeoAdminIndexNowJob[]> {
	const [pending, retrying] = await Promise.all([
		scanJobsByStatus(ctx, "pending"),
		scanJobsByStatus(ctx, "retry"),
	]);
	return dueJobs([...pending, ...retrying], now, force).slice(0, batchSize);
}

async function persistDelivery(
	ctx: PluginContext,
	delivery: SeoAdminIndexNowDelivery,
): Promise<void> {
	let writeError: unknown = null;
	try {
		await deliveries(ctx).put(delivery.id, delivery);
	} catch (error: unknown) {
		writeError = error;
	}
	const stored = validDelivery(
		delivery.id,
		await deliveries(ctx).get(delivery.id),
	);
	if (!stored || JSON.stringify(stored) !== JSON.stringify(delivery))
		throw writeError ?? new Error("IndexNow delivery audit verification failed.");

	try {
		let excess = Math.max(
			0,
			(await deliveries(ctx).count()) - INDEXNOW_DELIVERY_RETENTION,
		);
		while (excess > 0) {
			const result = await deliveries(ctx).query({
				orderBy: { createdAt: "asc" },
				limit: Math.min(excess + 1, 100),
			});
			const staleIds = (result.items ?? [])
				.map((item: any) => String(item.id ?? item.data?.id ?? ""))
				.filter((id: string) => Boolean(id) && id !== delivery.id)
				.slice(0, excess);
			if (!staleIds.length)
				throw new Error("IndexNow delivery retention could not advance.");
			const deleted = await deliveries(ctx).deleteMany(staleIds);
			if (!Number.isInteger(deleted) || deleted !== staleIds.length)
				throw new Error(
					"IndexNow delivery retention did not delete the exact stale records.",
				);
			excess -= deleted;
		}
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow delivery retention failed", {
			deliveryId: delivery.id,
			error: String(error),
		});
	}
	const retained = validDelivery(
		delivery.id,
		await deliveries(ctx).get(delivery.id),
	);
	if (!retained || JSON.stringify(retained) !== JSON.stringify(delivery)) {
		throw new Error("IndexNow delivery retention removed the current audit.");
	}
}

async function nextIndexNowDueAt(ctx: PluginContext): Promise<number | null> {
	const [pending, retrying] = await Promise.all([
		scanJobsByStatus(ctx, "pending"),
		scanJobsByStatus(ctx, "retry"),
	]);
	const dueTimes = [...pending, ...retrying].map((job) => {
		const due = job.nextAttemptAt ? Date.parse(job.nextAttemptAt) : Number.NaN;
		return Number.isFinite(due) ? due : Date.now();
	});
	return dueTimes.length ? Math.min(...dueTimes) : null;
}

async function scheduleNextDue(ctx: PluginContext, currentTask?: string, leaseOwner?: OperationLeaseOwner, strict = false): Promise<boolean> {
	const nextDueAt = await nextIndexNowDueAt(ctx);
	return nextDueAt !== null
		? scheduleDrain(ctx, new Date(nextDueAt).toISOString(), currentTask, leaseOwner, strict)
		: cancelDrainTasks(ctx, currentTask, leaseOwner);
}

export async function resumeVerifiedIndexNowQueue(ctx: PluginContext, owner: OperationLeaseOwner): Promise<void> {
	if (!(await retainIndexNowLease(owner))) throw new Error("IndexNow queue ownership was lost during setup.");
	if (!ctx.cron) return;
	if (!(await scheduleNextDue(ctx, undefined, owner, true)))
		throw new Error(indexNowCoexistencePaused().detail);
	if (!(await retainIndexNowLease(owner))) throw new Error("IndexNow queue ownership was lost during setup.");
}

async function deliverIndexNowQueueUnlocked(
	ctx: PluginContext,
	siteOrigin: string,
	options: { force?: boolean; currentTask?: string } = {},
	leaseOwner?: OperationLeaseOwner,
): Promise<IndexNowDeliveryRunResult> {
	const { values, verification } = await readIndexNowSettings(ctx);
	const empty = {
		enqueued: 0,
		skipped: 0,
		rejected: [] as string[],
		processed: 0,
	};
	const leaseLost = (
		processed = 0,
		state: {
			remoteAttempted?: boolean;
			delivery?: SeoAdminIndexNowDelivery;
			total?: number;
		} = {},
	): IndexNowDeliveryRunResult => ({
		success: false,
		...empty,
		processed,
		error: "delivery_in_progress",
		detail: state.delivery
			? `The delivery attempt was recorded in history. ${processed} of ${state.total ?? state.delivery.urlCount} queue jobs advanced; unchanged jobs may be submitted again.`
			: state.remoteAttempted
				? "The remote request may have completed, but no local delivery audit was stored. Refresh delivery history before retrying."
				: "The IndexNow queue lease changed before a remote request was submitted.",
		...(state.delivery ? { delivery: state.delivery } : {}),
	});
	if (!values.enabled)
		return {
			success: false,
			...empty,
			error: "indexnow_disabled",
			detail: "IndexNow is disabled.",
		};
	if (!ctx.http)
		return {
			success: false,
			...empty,
			error: "network_unavailable",
			detail: "Network access is unavailable.",
		};
	const origin = indexNowPublicOrigin(siteOrigin);
	if (
		!origin.ready ||
		!values.apiKey ||
		!resolveIndexNowKeyLocation(values.keyLocation, origin.origin)
	) {
		return {
			success: false,
			...empty,
			error: "indexnow_not_configured",
			detail: origin.ready ? "Complete IndexNow setup first." : origin.reason,
		};
	}
	if (!matchesIndexNowVerification(verification, values, origin.origin)) {
		return {
			success: false,
			...empty,
			error: "indexnow_not_configured",
			detail: "Verify this website's current IndexNow key before delivery.",
		};
	}

	const now = new Date();
	const selected = await deliveryCandidates(
		ctx,
		values.batchSize,
		now,
		options.force === true,
	);
	if (!selected.length) {
		if (!(await retainIndexNowLease(leaseOwner))) return leaseLost();
		if (!(await scheduleNextDue(ctx, options.currentTask, leaseOwner)))
			return { ...indexNowCoexistencePaused(), processed: 0 };
		if (!(await retainIndexNowLease(leaseOwner))) return leaseLost();
		return {
			success: false,
			...empty,
			error: "no_due_jobs",
			detail: "There are no URLs ready for delivery.",
		};
	}
	const jobStore = jobs(ctx);
	if (!supportsConditionalStorage(jobStore)) {
		return {
			success: false,
			...empty,
			error: "delivery_in_progress",
			detail:
				"IndexNow delivery requires conditional queue writes. No remote request was submitted.",
		};
	}
	const updateJobIfUnchanged = compareStoredValue.bind(null, jobStore);
	let payload;
	try {
		payload = buildIndexNowPayload(
			selected.map((job) => job.url),
			values,
			origin.origin,
		);
	} catch (error: unknown) {
		return {
			success: false,
			...empty,
			error: "indexnow_not_configured",
			detail: String(error),
		};
	}

	const attempt = Math.max(...selected.map((job) => job.attempts + 1));
	let responseStatus: number | null = null;
	let retryAfter: string | null = null;
	let detail = "IndexNow network request failed.";
	let status: SeoAdminIndexNowDelivery["status"] = "retry";
	let remoteAttempted = false;
	let timedOut = false;
	try {
		if (!(await retainIndexNowLease(leaseOwner))) return leaseLost();
		if (!(await coexistenceAdmission(ctx, "indexnow")))
			return { ...indexNowCoexistencePaused(), processed: 0 };
		remoteAttempted = true;
		const response = await requestIndexNowDelivery(ctx, payload, leaseOwner?.signal);
		responseStatus = response.status;
		retryAfter = response.headers.get("Retry-After");
		const disposition = classifyIndexNowResponse(response.status);
		status = disposition.disposition;
		detail = disposition.detail;
	} catch (error: unknown) {
		if (leaseOwner?.signal.aborted)
			return leaseLost(0, { remoteAttempted, total: selected.length });
		if (error instanceof IndexNowDeliveryTimeoutError) {
			timedOut = true;
			detail = error.message;
		} else {
			detail = `Network error: ${String(error)}`.slice(0, 300);
		}
	}
	// The network request is outside durable storage. Its result cannot change
	// queue state until the durable owner is verified again.
	if (!(await retainIndexNowLease(leaseOwner)))
		return leaseLost(0, { remoteAttempted, total: selected.length });

	const retryLimitDetail = `Retry limit reached after ${values.maxAttempts} attempts.${timedOut ? ` ${detail}` : ""}`;
	const retryableJobs =
		status === "retry"
			? selected.filter((job) => job.attempts + 1 < values.maxAttempts)
			: [];
	if (status === "retry" && retryableJobs.length === 0) {
		status = "failed";
		detail = retryLimitDetail;
	}
	const retryAt =
		status === "retry"
			? indexNowRetryAt(attempt, retryAfter, now, values.minIntervalSeconds)
			: null;
	const delivery: SeoAdminIndexNowDelivery = {
		id: indexNowDeliveryId(
			now.toISOString(),
			payload.urlList,
			attempt,
			createIndexNowDeliveryNonce(),
		),
		storageVersion: SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION,
		status,
		urlCount: payload.urlList.length,
		urls: payload.urlList,
		httpStatus: responseStatus,
		attempt,
		detail,
		retryAt,
		createdAt: now.toISOString(),
	};
	try {
		await persistDelivery(ctx, delivery);
	} catch (error: unknown) {
		ctx.log.error("seo:indexnow delivery audit failed", {
			deliveryId: delivery.id,
			error: String(error),
		});
		return {
			success: false,
			...empty,
			error: "delivery_in_progress",
			detail:
				"The remote request may have completed, but its local delivery audit could not be verified. No queue jobs were advanced.",
		};
	}
	if (!(await retainIndexNowLease(leaseOwner)))
		return leaseLost(0, { remoteAttempted, delivery, total: selected.length });

	let persistedJobs = 0;
	let changedJobs = 0;
	const historyChanges = new Map<string, SubmissionChange>();
	for (const job of selected) {
		if (!(await retainIndexNowLease(leaseOwner)))
			return leaseLost(persistedJobs, {
				remoteAttempted,
				delivery,
				total: selected.length,
			});
		const attempts = job.attempts + 1;
		const nextStatus: SeoAdminIndexNowJob["status"] =
			status === "accepted"
				? "delivered"
				: status === "retry" && attempts >= values.maxAttempts
					? "failed"
					: status;
		const jobError =
			nextStatus === "failed" && status === "retry"
				? retryLimitDetail
				: detail;
		const updated: SeoAdminIndexNowJob = {
			...job,
			status: nextStatus,
			attempts,
			nextAttemptAt: nextStatus === "retry" ? retryAt : null,
			lastHttpStatus: responseStatus,
			lastError: nextStatus === "delivered" ? null : jobError,
			lastSubmittedAt: now.toISOString(),
			updatedAt: now.toISOString(),
		};
		let committed = false;
		let commitError: unknown = null;
		try {
			committed = await updateJobIfUnchanged(
				job.id,
				{ state: "value", value: job },
				{ action: "put", value: updated },
			);
		} catch (error: unknown) {
			commitError = error;
			try {
				const stored = validJob(job.id, await jobs(ctx).get(job.id));
				committed =
					Boolean(stored) &&
					JSON.stringify(stored) === JSON.stringify(updated);
			} catch (readError: unknown) {
				ctx.log.warn("seo:indexnow queue snapshot verification failed", {
					jobId: job.id,
					error: String(readError),
				});
				return leaseLost(persistedJobs, {
					remoteAttempted,
					delivery,
					total: selected.length,
				});
			}
		}
		if (committed) {
			persistedJobs += 1;
			if (job.submissionId) {
				addSubmissionMove(historyChanges, job.submissionId, jobBucket(job), jobBucket(updated));
				const change = historyChanges.get(job.submissionId) ?? { moves: [] };
				change.attempt = {
					at: now.toISOString(),
					httpStatus: responseStatus,
					attempts: Math.max(change.attempt?.attempts ?? 0, attempts),
					retryAt: nextStatus === "retry" ? retryAt : change.attempt?.retryAt ?? null,
					detail: jobError ?? detail,
				};
				historyChanges.set(job.submissionId, change);
			}
		} else {
			changedJobs += 1;
			if (commitError) {
				ctx.log.warn("seo:indexnow queue snapshot write failed", {
					jobId: job.id,
					error: String(commitError),
				});
			}
		}
		if (!(await retainIndexNowLease(leaseOwner)))
			return leaseLost(persistedJobs, {
				remoteAttempted,
				delivery,
				total: selected.length,
			});
	}
	const history = await updateIndexNowSubmissions(ctx, historyChanges, leaseOwner);
	if (!(await retainIndexNowLease(leaseOwner)))
		return leaseLost(persistedJobs, {
			remoteAttempted,
			delivery,
			total: selected.length,
		});
	try {
		if (!(await scheduleNextDue(ctx, options.currentTask, leaseOwner))) {
			return {
				...indexNowCoexistencePaused(),
				processed: persistedJobs,
				delivery,
				history,
				detail: "The IndexNow attempt was recorded. Further work is paused while another indexing plugin is active or plugin state is unavailable.",
			};
		}
	} catch (error: unknown) {
		ctx.log.warn("seo:indexnow queue scheduling failed", {
			error: String(error),
		});
		return leaseLost(persistedJobs, {
			remoteAttempted,
			delivery,
			total: selected.length,
		});
	}
	if (!(await retainIndexNowLease(leaseOwner)))
		return leaseLost(persistedJobs, {
			remoteAttempted,
			delivery,
			total: selected.length,
		});
	ctx.log.info("seo:indexnow delivery completed", {
		status,
		httpStatus: responseStatus,
		urlCount: payload.urlList.length,
		retryAt,
	});
	if (changedJobs > 0) {
		return {
			success: false,
			...empty,
			processed: persistedJobs,
			error: "delivery_in_progress",
			detail: `The delivery attempt was recorded in history. ${persistedJobs} of ${selected.length} exact queue snapshots advanced; ${changedJobs} changed job(s) may be submitted again.`,
			delivery,
			history,
		};
	}
	return {
		success: status === "accepted" || status === "retry",
		...empty,
		processed: persistedJobs,
		...(status === "failed"
			? { error: "delivery_failed" as const, detail }
			: {}),
		delivery,
		history,
	};
}

export async function deliverIndexNowQueue(
	ctx: PluginContext,
	siteOrigin: string,
	options: { force?: boolean; currentTask?: string } = {},
): Promise<IndexNowDeliveryRunResult> {
	if (!(await coexistenceAdmission(ctx, "indexnow")))
		return { ...indexNowCoexistencePaused(), processed: 0 };
	const leased = await withOperationLease(
		ctx,
		INDEXNOW_OPERATION_SCOPE,
		(owner) => deliverIndexNowQueueUnlocked(ctx, siteOrigin, options, owner),
	);
	if (leased.acquired) return leased.value;
	if ("value" in leased && leased.value !== undefined) return leased.value;
	return {
				success: false,
				enqueued: 0,
				skipped: 0,
				rejected: [],
				processed: 0,
				error: "delivery_in_progress",
				detail:
					"Another IndexNow queue drain owns the durable lease. Retry after it completes.",
			};
}

async function retryFailedIndexNowJobsUnlocked(
	ctx: PluginContext,
	siteOrigin: string,
	leaseOwner?: OperationLeaseOwner,
): Promise<IndexNowEnqueueResult> {
	if (!(await retainIndexNowLease(leaseOwner)))
		return indexNowEnqueueLeaseLost();
	const failed = (await scanJobsByStatus(ctx, "failed"))
		.sort(
			(left, right) =>
				left.updatedAt.localeCompare(right.updatedAt) ||
				left.id.localeCompare(right.id),
		)
		.slice(0, 1_000);
	if (!(await retainIndexNowLease(leaseOwner)))
		return indexNowEnqueueLeaseLost();
	if (!failed.length) {
		return {
			success: false,
			enqueued: 0,
			skipped: 0,
			rejected: [],
			error: "no_due_jobs",
			detail: "There are no failed URLs to retry.",
		};
	}
	// A failed URL returns to its own history entry. URLs whose entry was
	// removed, or that predate history, form one new manual entry.
	const store = submissions(ctx);
	const entries = new Set<string>();
	const ids = [...new Set(failed.map((job) => job.submissionId).filter((id): id is string => Boolean(id)))];
	for (let offset = 0; store && offset < ids.length; offset += 100) {
		const found: Map<string, unknown> = await store.getMany(ids.slice(offset, offset + 100));
		for (const [id, value] of found) if (validSubmission(id, value)) entries.add(id);
	}
	if (!(await retainIndexNowLease(leaseOwner)))
		return indexNowEnqueueLeaseLost();
	return enqueueIndexNowUrlsUnlocked(
		ctx,
		siteOrigin,
		failed.map((job) => job.submissionId && entries.has(job.submissionId)
			? { url: job.url, ref: job.ref, reason: job.reason, submissionId: job.submissionId }
			: { url: job.url, ref: job.ref, reason: job.reason, source: "manual" as const, event: null }),
		{ force: true },
		leaseOwner,
	);
}

async function retryIndexNowSubmissionUnlocked(
	ctx: PluginContext,
	siteOrigin: string,
	submissionId: string,
	leaseOwner?: OperationLeaseOwner,
): Promise<IndexNowEnqueueResult> {
	const unavailable = (detail: string): IndexNowEnqueueResult => ({
		success: false, enqueued: 0, skipped: 0, rejected: [], error: "no_due_jobs", detail,
	});
	const store = submissions(ctx);
	if (!store) return unavailable("Submission history is unavailable on this site.");
	if (!(await retainIndexNowLease(leaseOwner))) return indexNowEnqueueLeaseLost();
	const entry = validSubmission(submissionId, await store.get(submissionId));
	if (!entry) return unavailable("This history entry is no longer available.");
	if (entry.counts.failed < 1) return unavailable("This history entry has no failed URLs.");
	let urls: string[];
	if (entry.detail === "sample") {
		urls = entry.sampleUrls.filter((_, position) => !entry.sampleSkipped.includes(position));
	} else if (entry.detail === "pages") {
		const pages = submissionUrlPages(ctx);
		urls = [];
		for (let page = 0; pages && page < submissionPageCount(entry.urlCount); page += 1) {
			const record = validSubmissionUrlPage(entry, page, await pages.get(submissionUrlPageId(entry.id, page)));
			if (!record) return unavailable("The full URL list of this entry is no longer available. Use Retry failed URLs to retry every failed URL.");
			urls.push(...record.urls.filter((_, position) => !record.skipped.includes(position)));
		}
	} else {
		return unavailable("The full URL list of this entry expired. Use Retry failed URLs to retry every failed URL.");
	}
	const retry: IndexNowUrlCandidate[] = [];
	for (let offset = 0; offset < urls.length; offset += 100) {
		if (!(await retainIndexNowLease(leaseOwner))) return indexNowEnqueueLeaseLost();
		const batch = urls.slice(offset, offset + 100);
		const found: Map<string, unknown> = await jobs(ctx).getMany(batch.map(indexNowJobId));
		for (const url of batch) {
			const id = indexNowJobId(url);
			const job = validJob(id, found.get(id));
			// A URL that a later entry queued again belongs to that entry now.
			if (job?.status === "failed" && job.submissionId === entry.id)
				retry.push({ url: job.url, ref: job.ref, reason: job.reason, submissionId: entry.id });
		}
	}
	if (!retry.length) return unavailable("No URL of this entry is still failed. A later entry may have queued them again.");
	return enqueueIndexNowUrlsUnlocked(ctx, siteOrigin, retry, { force: true }, leaseOwner);
}

export async function retryIndexNowSubmission(
	ctx: PluginContext,
	siteOrigin: string,
	submissionId: string,
): Promise<IndexNowEnqueueResult> {
	if (!(await coexistenceAdmission(ctx, "indexnow"))) return indexNowCoexistencePaused();
	const leased = await withOperationLease(ctx, INDEXNOW_OPERATION_SCOPE, (owner) =>
		retryIndexNowSubmissionUnlocked(ctx, siteOrigin, submissionId, owner),
	);
	if (leased.acquired) return leased.value;
	if ("value" in leased && leased.value !== undefined) return leased.value;
	return {
		success: false,
		enqueued: 0,
		skipped: 0,
		rejected: [],
		error: "delivery_in_progress",
		detail: "Another IndexNow queue operation owns the durable lease. Retry after it completes.",
	};
}

export async function listIndexNowHistory(
	ctx: PluginContext,
	input: {
		cursor?: string | null;
		limit?: number;
		status?: IndexNowSubmissionStatus | null;
		source?: IndexNowSubmissionSource | null;
	} = {},
): Promise<SeoAdminIndexNowHistoryPage | { error: "invalid_cursor" }> {
	const status = input.status && INDEXNOW_SUBMISSION_STATUSES.includes(input.status) ? input.status : null;
	const source = input.source === "automatic" || input.source === "manual" ? input.source : null;
	const pageSize = Number.isInteger(input.limit)
		? Math.min(Math.max(input.limit as number, 1), INDEXNOW_HISTORY_MAX_PAGE_SIZE)
		: INDEXNOW_HISTORY_PAGE_SIZE;
	const scope = indexNowHistoryScope({ status, source });
	const hostCursor = input.cursor ? decodeIndexNowHistoryCursor(input.cursor, scope) : null;
	if (input.cursor && !hostCursor) return { error: "invalid_cursor" };
	const store = submissions(ctx);
	const [settings, startedAt] = await Promise.all([
		readIndexNowSettings(ctx),
		ctx.kv.get<unknown>(INDEXNOW_HISTORY_STARTED_KEY),
	]);
	const base = {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt: new Date().toISOString(),
		filters: { status, source },
		pageSize,
		maxAttempts: settings.values.maxAttempts,
		retention: INDEXNOW_HISTORY_RETENTION,
		historyStartedAt: typeof startedAt === "string" && Number.isFinite(Date.parse(startedAt)) ? startedAt : null,
	};
	if (!store) return { ...base, available: false, total: 0, items: [], cursor: null, hasMore: false };
	const where = { ...(status ? { status } : {}), ...(source ? { source } : {}) };
	const [result, total] = await Promise.all([
		store.query({ where, orderBy: { createdAt: "desc" }, limit: pageSize, ...(hostCursor ? { cursor: hostCursor } : {}) }),
		store.count(where),
	]);
	const items = (result.items ?? [])
		.map((item: any) => validSubmission(String(item.id), item.data ?? item))
		.filter(Boolean) as SeoAdminIndexNowSubmission[];
	const next = result.hasMore && typeof result.cursor === "string" && result.cursor
		? encodeIndexNowHistoryCursor(scope, result.cursor)
		: null;
	return { ...base, available: true, total: Number.isSafeInteger(total) ? total : items.length, items, cursor: next, hasMore: next !== null };
}

export async function readIndexNowHistoryUrls(
	ctx: PluginContext,
	submissionId: string,
	page: number,
): Promise<SeoAdminIndexNowHistoryUrlsPage | null> {
	const store = submissions(ctx);
	if (!store || !Number.isInteger(page) || page < 0) return null;
	const entry = validSubmission(submissionId, await store.get(submissionId));
	if (!entry) return null;
	const base = {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		generatedAt: new Date().toISOString(),
		submissionId: entry.id,
		urlCount: entry.urlCount,
		page,
	};
	if (entry.detail === "sample") {
		if (page !== 0) return null;
		return {
			...base, detail: "sample", pageCount: 1,
			items: entry.sampleUrls.map((url, position) => ({ url, skipped: entry.sampleSkipped.includes(position) })),
		};
	}
	const pageCount = submissionPageCount(entry.urlCount);
	if (entry.detail !== "pages") return { ...base, detail: entry.detail, pageCount: 0, items: [] };
	if (page >= pageCount) return null;
	const pages = submissionUrlPages(ctx);
	const record = pages
		? validSubmissionUrlPage(entry, page, await pages.get(submissionUrlPageId(entry.id, page)))
		: null;
	// A missing page is reported as incomplete detail, never as an empty list.
	if (!record) return { ...base, detail: "expiring", pageCount: 0, items: [] };
	return {
		...base, detail: "pages", pageCount,
		items: record.urls.map((url, position) => ({ url, skipped: record.skipped.includes(position) })),
	};
}

export async function retryFailedIndexNowJobs(
	ctx: PluginContext,
	siteOrigin: string,
): Promise<IndexNowEnqueueResult> {
	if (!(await coexistenceAdmission(ctx, "indexnow"))) return indexNowCoexistencePaused();
	const leased = await withOperationLease(ctx, INDEXNOW_OPERATION_SCOPE, (owner) =>
		retryFailedIndexNowJobsUnlocked(ctx, siteOrigin, owner),
	);
	if (leased.acquired) return leased.value;
	if ("value" in leased && leased.value !== undefined) return leased.value;
	return {
				success: false,
				enqueued: 0,
				skipped: 0,
				rejected: [],
				error: "delivery_in_progress",
				detail:
					"Another IndexNow queue operation owns the durable lease. Retry after it completes.",
			};
}

export async function publicIndexNowKey(ctx: PluginContext): Promise<{ configured: boolean; key: string | null }> {
	const { values } = await readIndexNowSettings(ctx);
	return { configured: Boolean(values.apiKey), key: values.apiKey || null };
}
