import assert from "node:assert/strict";

import type { SeoAdminScoreScanResult, SeoAdminScoreScanView } from "./admin-contract.ts";
import { parseSeoAdminScoreScanResult, parseSeoAdminScoreScanStateResult } from "./admin-ui/contract.ts";
import { SEO_SCORE_VERSION, analyzeSeoContent } from "./analysis.ts";
import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import {
	SCORE_SCAN_FAILURE_STREAK_LIMIT,
	SCORE_SCAN_JOB_ID,
	SCORE_SCAN_OUTCOME_RETENTION,
	SCORE_SCAN_UNIT_LEASE_MS,
	commandScoreScan,
	commandScoreScanRoute,
	parseScoreScanJob,
	readScoreScanState,
	scoreScanStateRoute,
	startScoreScan,
	startScoreScanRoute,
	type ScoreScanAcceptance,
	type ScoreScanDependencies,
} from "./score-scan.ts";
import { ScoreScanSelectionError, type ScoreScanPageBudget, type ScoreScanSource, type ScoreScanSourceScope } from "./score-scan-source.ts";
import { readContentScoringPolicy } from "./settings-runtime.ts";

// ---- Fixture ----

const log: string[] = [];
const casRevisions: Array<{ store: string; revision: string | null }> = [];
let clock = Date.parse("2026-10-04T10:00:00.000Z");
const now = () => new Date(clock);
let ids = 0;
const newId = () => `id-${String(++ids).padStart(8, "0")}`;
let commands = 0;
const commandId = () => `cmd-${String(++commands).padStart(5, "0")}`;

type Row = { value: string; revision: string };

function memoryStore(name: string) {
	let rows = new Map<string, Row>();
	let counter = 0;
	const faults: Array<(operation: string) => void> = [];
	const touch = (operation: string) => {
		log.push(`${name}.${operation}`);
		for (const fault of [...faults]) fault(operation);
	};
	const api = {
		async get(id: string) {
			touch("get");
			const row = rows.get(id);
			return row ? JSON.parse(row.value) : null;
		},
		async getVersioned(id: string) {
			touch("getVersioned");
			const row = rows.get(id);
			return row ? { value: JSON.parse(row.value), revision: row.revision } : null;
		},
		async compareAndSet(id: string, revision: string | null, value: unknown) {
			touch("compareAndSet");
			casRevisions.push({ store: name, revision });
			const row = rows.get(id);
			if ((row?.revision ?? null) !== revision) return { applied: false };
			const next = `${name}-r${++counter}`;
			rows.set(id, { value: JSON.stringify(value), revision: next });
			return { applied: true, revision: next };
		},
		async compareAndDelete(id: string, revision: string) {
			touch("compareAndDelete");
			const row = rows.get(id);
			if (!row || row.revision !== revision) return { applied: false };
			rows.delete(id);
			return { applied: true };
		},
		async put(id: string, value: unknown) {
			touch("put");
			rows.set(id, { value: JSON.stringify(value), revision: `${name}-r${++counter}` });
		},
	};
	return {
		api,
		faults,
		read: (id: string) => (rows.has(id) ? JSON.parse(rows.get(id)!.value) : null),
		snapshot: () => new Map(rows),
		restore: (saved: Map<string, Row>) => { rows = new Map(saved); },
		clear: () => { rows = new Map(); faults.length = 0; },
	};
}

const jobs = memoryStore("jobs");
const scores = memoryStore("scores");
const revisions = memoryStore("revisions");
const stores = [jobs, scores, revisions];

const settings = (enabled: boolean) => ({
	version: 1, updatedAt: "2026-10-01T00:00:00.000Z", siteName: "Example", siteUrl: "https://example.com",
	organizationName: "Example", organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "",
	noindex: false, contentScoringEnabled: enabled, contentScoringResourceNoticeVersion: 1,
});
let policy: { value: unknown; revision: string } | null = null;
let policyRevisions = 0;
let policyUnreadable = false;
let collectionProfileAvailable = true;
let collectionProfile: "article" | "general" = "article";
const setPolicy = (enabled: boolean) => { policy = { value: settings(enabled), revision: `policy-${++policyRevisions}` }; };
const kv = {
	async getVersioned(key: string) {
		log.push("kv.getVersioned");
		if (key === "configuration:analysis-profile:v1:posts") return collectionProfileAvailable ? { value: { version: 1, profile: collectionProfile, updatedAt: "2026-10-15T00:00:00.000Z" }, revision: "collection-profile-1" } : null;
		if (key !== "settings:global:v1") throw new Error(`unexpected key ${key}`);
		if (policyUnreadable) throw new Error("policy unreadable");
		return policy ? structuredClone(policy) : null;
	},
};

interface Entry { status: string; locale: string; groups: Set<string>; version: number; deleted?: boolean }
const entries = new Map<string, Entry>();
const contentRow = (id: string) => {
	const entry = entries.get(id);
	if (!entry || entry.deleted) return null;
	return {
		id, type: "posts", slug: id, status: entry.status, locale: entry.locale, version: entry.version, draftRevisionId: null,
		updatedAt: "2026-10-01T00:00:00.000Z", data: { title: id }, seo: null,
	};
};
const content = {
	async get(collection: string, id: string) {
		log.push("content.get");
		return collection === "posts" ? contentRow(id) : null;
	},
};
const warnings: unknown[] = [];
const pluginLog = { warn: (...args: unknown[]) => { warnings.push(args); }, info() {}, error() {}, debug() {} };
const schema = { listCollections: async () => [{ slug: "posts", label: "Posts", fields: [], routable: true }] };
const ctx: any = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	kv,
	content,
	schema,
	storage: { scoreScanJobs: jobs.api, scores: scores.api, scoreAnalysisRevisions: revisions.api },
	log: pluginLog,
};
const bound: any = {
	plugin: ctx.plugin,
	kv,
	content,
	storage: { scoreScanJobs: jobs.api, scores: scores.api, scoreAnalysisRevisions: revisions.api },
	log: pluginLog,
};

// Source with the adapter's ordering and budgets; `window` makes zero-match windows observable.
let window = 200;
let pageFault: Error | null = null;
let revalidateFault: Error | null = null;
let resolveFault: Error | null = null;
const pageBudgets: ScoreScanPageBudget[] = [];
const matches = (scope: ScoreScanSourceScope, id: string) => {
	const entry = entries.get(id);
	return Boolean(entry && !entry.deleted && (scope.status === "all" || entry.status === scope.status) &&
		(scope.locale === null || entry.locale === scope.locale) &&
		scope.taxonomies.every((selection) => selection.termGroups.some((group) => entry.groups.has(group))));
};
const source: ScoreScanSource = {
	async resolveScope(request, allowed) {
		if (!allowed.includes(request.collection)) throw new ScoreScanSelectionError("Select an eligible collection for the score scan.");
		if (resolveFault) throw resolveFault;
		const sorted = [...entries.keys()].sort();
		return {
			collection: request.collection, status: request.status, locale: request.locale,
			taxonomies: request.taxonomies.map((selection) => ({
				taxonomy: selection.taxonomy, termIds: [...selection.termIds], includeDescendants: selection.includeDescendants,
				termGroups: [...new Set(selection.termIds.map((id) => `g-${id}`))].sort(),
			})),
			upperId: sorted.at(-1) ?? null,
		};
	},
	async page(scope, afterId, budget) {
		pageBudgets.push(budget);
		if (pageFault) throw pageFault;
		if (scope.upperId === null) return { references: [], nextAfterId: afterId, exhausted: true, fetchedCandidates: 0, examinedCandidates: 0, matchedReferences: 0 };
		const remaining = [...entries.keys()].sort().filter((id) => id <= scope.upperId! && (afterId === null || id > afterId));
		const rows = remaining.slice(0, Math.min(window, budget.candidateBudget));
		const references = [];
		let examined = 0;
		let next = afterId;
		for (const id of rows) {
			examined += 1;
			next = id;
			if (!matches(scope, id)) continue;
			references.push({ collection: scope.collection, id, locale: entries.get(id)!.locale, afterId: id });
			if (references.length === budget.matchBudget) break;
		}
		return {
			references, nextAfterId: next, exhausted: examined === rows.length && rows.length === remaining.length,
			fetchedCandidates: rows.length, examinedCandidates: examined, matchedReferences: references.length,
		};
	},
	async revalidate(scope, reference) {
		if (revalidateFault) throw revalidateFault;
		const entry = entries.get(reference.id);
		if (!entry || entry.deleted) return "missing";
		return entry.locale === reference.locale && matches(scope, reference.id) ? "matching" : "no-longer-matching";
	},
	async termOptions() {
		return { terms: [], nextCursor: null };
	},
};

// A rollback-capable transaction over the same stores; the bound context is the only port it hands out.
let commitMode: "normal" | "fail-before-commit" | "lose-response" = "normal";
const acceptance: ScoreScanAcceptance = {
	async transaction(work) {
		log.push("tx.begin");
		const saved = stores.map((store) => store.snapshot());
		let committed = false;
		const mode = commitMode;
		commitMode = "normal";
		try {
			const result = await work({ context: bound });
			if (mode === "fail-before-commit") throw new Error("injected commit failure");
			committed = true;
			log.push("tx.commit");
			if (mode === "lose-response") throw new Error("injected lost commit response");
			return result;
		} catch (error) {
			if (!committed) {
				stores.forEach((store, index) => store.restore(saved[index]!));
				log.push("tx.rollback");
			}
			throw error;
		}
	},
};

// Scripted lifecycle: real policy reads, the job's analyzer wrapper and its terminal boundary.
class Crash extends Error {}
type Plan = "save" | "reuse" | "fail" | "superseded" | "crash" | "crash-after-analysis";
const plans = new Map<string, Plan[]>();
let beforeAccept: (() => Promise<void>) | null = null;
let duringCapture: (() => void) | null = null;
const makeScore = (item: any, analysisRevision: number) => ({
	ref: `posts:${item.id}`, collection: "posts", entryId: item.id, slug: item.id, title: item.id, score: 80, grade: "good",
	status: item.status, checks: [], metrics: {}, url: null, sourceUpdatedAt: item.updatedAt, scoreVersion: 15,
	analysisRevision, sourceVersion: savedContentVersion(item), updatedAt: now().toISOString(), templateUpdatedAt: null,
	modulesUpdatedAt: null, configurationFingerprint: "fixture", metaOverrideUpdatedAt: null,
	inputIdentity: `seo-input-v1-sha256-${"0".repeat(64)}`,
	assessmentProfile: { profile: "article" as const, version: 1 as const }, assessmentProfileRevision: "collection-profile-1",
});
let scoreFor: (item: any, analysisRevision: number) => any = makeScore;
let analyzerRuns = 0;
const steps: any = {
	analyze: async (captured: any, revision: number) => {
		analyzerRuns += 1;
		if (captured.plan === "fail") throw new Error("injected analyzer failure");
		return scoreFor(captured.item, revision);
	},
};
const lifecycle: ScoreScanDependencies["lifecycle"] = async (lifeCtx, request, lifeSteps, terminal) => {
	const plan = plans.get(request.id)?.shift() ?? "save";
	const current = await readContentScoringPolicy(lifeCtx);
	if (current.state === "paused") return { status: "disabled" };
	if (current.state === "pending-confirmation") return { status: "activation_required" };
	if (current.state === "unavailable") return { status: "unavailable", reason: "policy" };
	if (terminal && current.revision !== terminal.policyRevision) return { status: "superseded", reason: "policy-changed" };
	const item = await lifeCtx.content!.get(request.collection, request.id);
	if (!item) return { status: "not-found" };
	if (request.locale !== undefined && (item as any).locale !== request.locale) return { status: "locale-mismatch" };
	if (plan === "crash") throw new Crash("injected crash before analysis");
	if (duringCapture) {
		const hook = duringCapture;
		duringCapture = null;
		hook();
	}
	if (plan === "reuse") return { status: "reused", score: scoreFor(item, 1), history: "not-attempted" };
	if (plan === "superseded") return { status: "superseded", reason: "inputs-changed" };
	const ref = `${request.collection}:${request.id}`;
	const reserved = ((revisions.read(ref) as any)?.revision ?? 0) + 1;
	await revisions.api.put(ref, { id: ref, ref, storageVersion: 1, revision: reserved, updatedAt: now().toISOString() });
	if (!lifeSteps) throw new Error("the job passes its analyzer wrapper");
	let score: any;
	try {
		score = await lifeSteps.analyze({ item, plan } as any, reserved);
	} catch (error: unknown) {
		return { status: "failed", error };
	}
	if (plan === "crash-after-analysis") throw new Crash("injected crash after analysis");
	if (beforeAccept) {
		const hook = beforeAccept;
		beforeAccept = null;
		await hook();
	}
	try {
		const accepted = await terminal!.accept(score, current);
		if (accepted.persisted) return { status: "saved", score, history: "not-attempted" };
		if (accepted.refusal === "scoring-disabled") return { status: "disabled" };
		if (accepted.refusal === "scoring-unavailable") return { status: "unavailable", reason: "policy" };
		return { status: "superseded", reason: accepted.refusal };
	} catch (error: unknown) {
		return { status: "uncertain", error };
	}
};

const historyPlan: Array<"created" | "unchanged" | "failed" | "uncertain" | "crash"> = [];
let retentionRuns = 0;
const deps = (): ScoreScanDependencies => ({
	source, acceptance, now, newId, lifecycle, steps,
	recordHistory: async () => {
		const next = historyPlan.shift() ?? "created";
		if (next === "crash") throw new Crash("injected crash during history");
		return next;
	},
	enforceRetention: async () => { retentionRuns += 1; },
});

function reset(entryCount = 0, make: (index: number) => Partial<Entry> = () => ({})) {
	for (const store of stores) store.clear();
	entries.clear();
	plans.clear();
	historyPlan.length = 0;
	log.length = 0;
	casRevisions.length = 0;
	pageBudgets.length = 0;
	warnings.length = 0;
	window = 200;
	pageFault = revalidateFault = resolveFault = null;
	beforeAccept = null;
	duringCapture = null;
	commitMode = "normal";
	policyUnreadable = false;
	collectionProfileAvailable = true;
	collectionProfile = "article";
	scoreFor = makeScore;
	analyzerRuns = 0;
	retentionRuns = 0;
	setPolicy(true);
	for (let index = 1; index <= entryCount; index += 1)
		entries.set(`e${String(index).padStart(3, "0")}`, { status: "published", locale: "en", groups: new Set(), version: 1, ...make(index) });
}

type Success = Extract<SeoAdminScoreScanResult, { success: true }>;
type Failure = Extract<SeoAdminScoreScanResult, { success: false }>;
const ok = (result: SeoAdminScoreScanResult, label: string): Success => {
	assert.equal(result.success, true, `${label}: ${result.success ? "" : `${result.error} ${result.detail ?? ""}`}`);
	return result as Success;
};
const refused = (result: SeoAdminScoreScanResult, error: Failure["error"], label: string): Failure => {
	assert.equal(result.success, false, label);
	assert.equal((result as Failure).error, error, label);
	return result as Failure;
};

async function start(target: { mode: "count"; count: number } | { mode: "all" }, extra: Record<string, unknown> = {}, replace: SeoAdminScoreScanView | null = null) {
	return startScoreScan(ctx, deps(), {
		commandId: commandId(),
		replace: replace ? { runId: replace.runId, expectedRevision: replace.revision } : null,
		collection: "posts", status: "all", locale: null, taxonomies: [], target,
		...extra,
	} as any);
}

async function send(kind: "continue" | "pause" | "resume" | "stop", view: SeoAdminScoreScanView, id = commandId()) {
	return commandScoreScan(ctx, deps(), { command: kind, runId: view.runId, expectedRevision: view.revision, commandId: id });
}

async function drain(view: SeoAdminScoreScanView, limit = 200): Promise<Success> {
	let result = ok(await send("continue", view), "first continue");
	for (let step = 1; result.decision === "continue"; step += 1) {
		assert.ok(step < limit, "the scan advances to a decision");
		result = ok(await send("continue", result.scan), `continue ${step}`);
	}
	return result;
}

const stored = () => parseScoreScanJob(jobs.read(SCORE_SCAN_JOB_ID));

async function assertAdminReads(result: Success, label: string): Promise<void> {
	assert.equal(parseSeoAdminScoreScanResult(result, { command: result.command, commandId: result.commandId }).success, true, `${label}: command result`);
	assert.equal(parseSeoAdminScoreScanStateResult(await readScoreScanState(ctx, now())).success, true, `${label}: scan state`);
}

// ---- Ports and start validation ----

reset(3);
{
	const unavailable = await scoreScanStateRoute(ctx, null);
	assert.deepEqual([unavailable.success, (unavailable as any).error], [false, "scan_unavailable"]);
	const started = await startScoreScanRoute(ctx, null, { commandId: commandId(), replace: null, collection: "posts", status: "all", locale: null, taxonomies: [], target: { mode: "all" } });
	refused(started, "scan_unavailable", "a host without ports starts nothing");
	const command = await commandScoreScanRoute(ctx, null, { command: "continue", runId: "scan-id-00000000", expectedRevision: 1, commandId: commandId() });
	refused(command, "scan_unavailable", "a host without ports continues nothing");
	assert.equal(jobs.read(SCORE_SCAN_JOB_ID), null);

	setPolicy(false);
	refused(await start({ mode: "all" }), "scoring_disabled", "disabled scoring admits no run");
	setPolicy(true);
	policyUnreadable = true;
	refused(await start({ mode: "all" }), "scoring_unavailable", "unreadable policy admits no run");
	policyUnreadable = false;

	resolveFault = new ScoreScanSelectionError("The selected terms expand beyond 512 term groups. Select fewer terms or turn off descendants.");
	const invalid = refused(await start({ mode: "all" }), "invalid_scope", "a rejected selection is actionable");
	assert.match(invalid.detail ?? "", /512 term groups/);
	resolveFault = new Error("SQLITE_IOERR: disk I/O error");
	const failed = refused(await start({ mode: "all" }), "source_unavailable", "a read failure is never a validation result");
	assert.equal(failed.detail, null, "a read failure message is not shown as a selection problem");
	resolveFault = null;
	refused(await start({ mode: "all" }, { collection: "pages" }), "unsupported_collection", "only eligible collections");
	refused(await start({ mode: "all" }, { taxonomies: [
		{ taxonomy: "category", termIds: ["t1"], includeDescendants: false },
		{ taxonomy: "category", termIds: ["t2"], includeDescendants: false },
	] }), "invalid_scope", "one selection per taxonomy");
	const wide = (taxonomy: string) => ({ taxonomy, termIds: Array.from({ length: 64 }, (_, index) => `${taxonomy}-${"x".repeat(150)}-${index}`), includeDescendants: false });
	refused(await start({ mode: "all" }, { taxonomies: [wide("category"), wide("region")] }),
		"scope_too_large", "a scope that leaves no record room is refused before any write");
	assert.equal(jobs.read(SCORE_SCAN_JOB_ID), null, "refused starts write nothing");
}

// ---- Exact count traversal, reuse, history and replay ----

reset(12, (index) => ({ status: index % 2 === 0 ? "published" : "draft" }));
{
	plans.set("e004", ["reuse"]);
	const started = ok(await start({ mode: "count", count: 3 }, { status: "published" }), "start count");
	assert.deepEqual([started.decision, started.scan.state, started.scan.counters.admitted], ["continue", "running", 0]);
	refused(await start({ mode: "all" }), "run_exists", "a second start never replaces silently");

	const first = ok(await send("continue", started.scan), "first unit");
	assert.deepEqual(pageBudgets[0], { candidateBudget: 200, matchBudget: 3 }, "the page asks for the remaining logical admissions only");
	assert.equal(first.progress, "outcome");
	assert.deepEqual([first.outcome?.status, first.outcome?.history, first.outcome?.computation], ["saved", "created", "confirmed"]);
	assert.equal(first.scan.bufferedReferences, 2, "unconsumed matches stay buffered, never skipped");

	// A lost response is answered from the exact receipt, without work or counter changes.
	const replayId = commandId();
	const second = ok(await send("continue", first.scan, replayId), "second unit");
	assert.equal(second.outcome?.status, "reused");
	assert.equal(second.outcome?.history, "not-attempted", "reuse writes no history");
	const runsBefore = analyzerRuns;
	const replay = ok(await send("continue", first.scan, replayId), "replay");
	assert.deepEqual([replay.replayed, replay.outcome?.attemptId, replay.scan.counters.admitted], [true, second.outcome?.attemptId, 2]);
	assert.equal(analyzerRuns, runsBefore, "a replay recomputes nothing");
	refused(await send("continue", first.scan), "stale_revision", "a duplicate tab with an old view does no work");

	const done = await drain(second.scan);
	assert.deepEqual([done.scan.state, done.scan.completion, done.scan.counters.admitted], ["completed", "target-reached", 3]);
	assert.deepEqual(
		[done.scan.counters.saved, done.scan.counters.reused, done.scan.counters.analyzed, done.scan.counters.historyCreated],
		[2, 1, 2, 2],
	);
	assert.equal(scores.read("posts:e002")?.analysisRevision, 1);
	assert.equal(scores.read("posts:e004"), null, "a reused result writes no score");
	assert.equal(retentionRuns, 1, "global history pruning waits until the run ends");
	refused(await send("continue", done.scan), "not_running", "a completed run admits nothing");
	refused(await send("resume", done.scan), "not_resumable", "a completed run cannot resume");

	// A new run with the same count begins again from the lowest eligible IDs and counts reuse.
	const again = ok(await start({ mode: "count", count: 1 }, { status: "published" }, done.scan), "replacing start");
	plans.set("e002", ["reuse"]);
	const rerun = await drain(again.scan);
	assert.deepEqual([rerun.outcome?.ref, rerun.outcome?.status, rerun.scan.counters.admitted], ["posts:e002", "reused", 1]);
	refused(await send("continue", started.scan), "stale_run", "the replaced run refuses commands");
}

// ---- All mode, zero-match windows, taxonomy groups and membership changes ----

reset(9, (index) => ({ groups: new Set(index % 4 === 0 ? ["g-news", "g-local"] : index % 4 === 1 ? ["g-news"] : []) }));
{
	window = 2;
	const started = ok(await start({ mode: "all" }, { taxonomies: [
		{ taxonomy: "category", termIds: ["news"], includeDescendants: false },
		{ taxonomy: "region", termIds: ["local", "local"], includeDescendants: false },
	] }), "start all");
	assert.deepEqual(stored()?.scope.taxonomies.map((selection) => selection.termGroups), [["g-news"], ["g-local"]], "duplicate terms collapse into one group");
	// e001 matches news only, so the first two-candidate window has no match and still advances.
	const firstWindow = ok(await send("continue", started.scan), "zero-match window");
	assert.deepEqual([firstWindow.progress, firstWindow.outcome, firstWindow.scan.counters.examinedCandidates, firstWindow.scan.counters.admitted], ["window", null, 2, 0]);
	entries.get("e008")!.groups.delete("g-local");
	const done = await drain(firstWindow.scan);
	assert.deepEqual([done.scan.state, done.scan.completion], ["completed", "exhausted"]);
	assert.deepEqual(done.scan.outcomes.map((outcome) => outcome.ref), ["posts:e004"], "taxonomies intersect and a changed assignment applies when encountered");
	assert.equal(done.scan.counters.examinedCandidates, 9);
}

// ---- Revalidation before admission consumes nothing ----

reset(3);
{
	const started = ok(await start({ mode: "count", count: 2 }, { status: "published" }), "start");
	const buffered = ok(await send("continue", started.scan), "first");
	assert.equal(buffered.scan.bufferedReferences, 1, "the second match waits in the buffer");
	entries.get("e002")!.status = "draft";
	const changed = ok(await send("continue", buffered.scan), "no-longer-matching");
	assert.deepEqual([changed.progress, changed.scan.counters.noLongerMatching, changed.scan.counters.admitted], ["no-longer-matching", 1, 1]);
	const done = await drain(changed.scan);
	assert.deepEqual(done.scan.outcomes.map((outcome) => outcome.ref), ["posts:e001", "posts:e003"], "the target counts admissions only");
}

// ---- Scoring off/on, policy revisions and retained slots ----

reset(4);
{
	const started = ok(await start({ mode: "all" }), "start");
	const first = ok(await send("continue", started.scan), "first");
	setPolicy(false);
	setPolicy(true);
	const blocked = ok(await send("continue", first.scan), "changed revision");
	assert.deepEqual([blocked.decision, blocked.scan.pauseReason, blocked.scan.counters.admitted], ["paused", "policy-changed", 1],
		"an off/on change between units pauses without admitting");
	refused(await send("continue", blocked.scan), "not_running", "turning scoring on starts no catch-up work");
	const resumed = ok(await send("resume", blocked.scan), "resume rebinds the current revision");

	// After admission, a policy change refused at acceptance keeps the slot for an explicit retry.
	beforeAccept = async () => { setPolicy(true); };
	const retained = ok(await send("continue", resumed.scan), "refused acceptance");
	assert.deepEqual([retained.outcome?.status, retained.outcome?.reason, retained.scan.pauseReason], ["retry", "policy-changed", "policy-changed"]);
	assert.equal(scores.read("posts:e002"), null, "a refused score is not stored");
	assert.deepEqual(retained.scan.retry, { ref: "posts:e002", admission: 2 });
	const again = ok(await send("resume", retained.scan), "resume retry");
	const retried = ok(await send("continue", again.scan), "retried");
	assert.deepEqual([retried.outcome?.status, retried.outcome?.admission, retried.scan.counters.admitted, retried.scan.counters.attempts], ["saved", 2, 2, 3],
		"the retry keeps its logical slot");

	setPolicy(false);
	const disabled = ok(await send("continue", retried.scan), "disabled");
	assert.equal(disabled.scan.pauseReason, "scoring-disabled");
	refused(await send("resume", disabled.scan), "scoring_disabled", "resume needs enabled scoring");
}

// ---- A policy save during input capture never finalizes a non-score outcome ----

reset(2);
{
	plans.set("e001", ["reuse", "reuse"]);
	const started = ok(await start({ mode: "count", count: 1 }), "start");
	duringCapture = () => { setPolicy(false); setPolicy(true); };
	const raced = ok(await send("continue", started.scan), "reuse raced by a policy save");
	assert.deepEqual([raced.decision, raced.scan.pauseReason, raced.outcome?.status, raced.outcome?.reason], ["paused", "policy-changed", "retry", "policy-changed"],
		"the transaction-bound policy read pauses instead of finalizing");
	assert.deepEqual([raced.scan.counters.admitted, raced.scan.counters.reused, raced.scan.retry], [1, 0, { ref: "posts:e001", admission: 1 }],
		"the admitted slot is retained, not consumed or finalized");
	refused(await send("continue", raced.scan), "not_running", "no continuation before an explicit Resume");
	const resumed = ok(await send("resume", raced.scan), "resume");
	const reused = ok(await send("continue", resumed.scan), "reuse after resume");
	assert.deepEqual([reused.outcome?.status, reused.outcome?.admission, reused.scan.counters.admitted, reused.scan.state, reused.scan.completion],
		["reused", 1, 1, "completed", "target-reached"], "Resume reuses the same slot and completes the selected count once");
	assert.equal(scores.read("posts:e001"), null, "reuse writes no score");

	// The same rule covers other outcomes that write no score.
	reset(1);
	entries.get("e001")!.deleted = false;
	const next = ok(await start({ mode: "all" }), "start");
	plans.set("e001", ["superseded"]);
	duringCapture = () => { setPolicy(false); };
	const off = ok(await send("continue", next.scan), "superseded raced by scoring off");
	assert.deepEqual([off.scan.pauseReason, off.outcome?.status, off.scan.counters.superseded, off.scan.retry?.admission], ["scoring-disabled", "retry", 0, 1]);
}

// ---- Pause, stop and the confirmed stopped state ----

reset(5);
{
	const started = ok(await start({ mode: "all" }), "start");
	const first = ok(await send("continue", started.scan), "first");
	const pausedRun = ok(await send("pause", first.scan), "pause");
	assert.deepEqual([pausedRun.decision, pausedRun.scan.state, pausedRun.scan.pauseReason], ["paused", "paused", "requested"]);
	refused(await send("continue", pausedRun.scan), "not_running", "pause preserves continuation without working");
	refused(await send("pause", pausedRun.scan), "not_running", "a paused run is not paused twice");
	const resumed = ok(await send("resume", pausedRun.scan), "resume");
	const second = ok(await send("continue", resumed.scan), "continues after the saved position");
	assert.equal(second.outcome?.ref, "posts:e002");
	const stopped = ok(await send("stop", second.scan), "stop");
	assert.deepEqual([stopped.decision, stopped.scan.state, stopped.scan.bufferedReferences], ["stopped", "stopped", 0]);
	assert.equal(scores.read("posts:e002")?.ref, "posts:e002", "stopping keeps accepted scores");
	refused(await send("resume", stopped.scan), "not_resumable", "a stopped run needs a new run");
}

// ---- Crash before acceptance, lease, recovery and owner replacement ----

reset(3);
{
	const started = ok(await start({ mode: "all" }), "start");
	plans.set("e001", ["crash-after-analysis"]);
	await assert.rejects(() => send("continue", started.scan), Crash);
	const interrupted = stored()!;
	assert.equal(interrupted.attempt?.reference.id, "e001", "the attempt was persisted before analysis");
	const view = (await readScoreScanState(ctx, now())) as any;
	assert.equal(view.scan.unit.active, true);
	refused(await send("continue", view.scan), "busy", "an active lease blocks another owner");
	clock += SCORE_SCAN_UNIT_LEASE_MS + 1;
	const expired = refused(await send("continue", view.scan), "recovery_required", "an expired lease alone proves nothing");
	const recovered = ok(await send("resume", expired.scan!), "resume fences and recovers");
	assert.deepEqual([recovered.scan.outcomes[0]?.status, recovered.scan.outcomes[0]?.computation, recovered.scan.counters.uncertain], ["uncertain", "unknown", 1]);
	assert.deepEqual(recovered.scan.retry, { ref: "posts:e001", admission: 1 });
	assert.equal(stored()!.generation, interrupted.generation + 1, "recovery changes the owner generation");
	const retried = ok(await send("continue", recovered.scan), "retry");
	assert.deepEqual([retried.outcome?.status, retried.outcome?.admission, retried.scan.counters.admitted], ["saved", 1, 1], "no second target slot");

	// A replaced owner computes but cannot accept its score or progress.
	beforeAccept = async () => {
		const current = (await readScoreScanState(ctx, now())) as any;
		ok(await send("pause", current.scan), "another tab pauses mid-unit");
	};
	const fenced = refused(await send("continue", retried.scan), "stale_revision", "the fenced owner is refused");
	assert.equal(scores.read("posts:e002"), null, "the fenced owner wrote no score");
	assert.equal(fenced.scan?.outcomes.at(-1)?.status, "uncertain");
	assert.equal(fenced.scan?.state, "paused");
}

// ---- The fence write precedes score storage, and its revision carries the receipt ----

reset(1);
{
	const started = ok(await start({ mode: "all" }), "start");
	const admittedLog = log.length;
	ok(await send("continue", started.scan), "saved");
	const transaction = log.slice(log.indexOf("tx.begin", admittedLog), log.indexOf("tx.commit", admittedLog) + 1);
	const firstScoreAccess = transaction.findIndex((entry) => entry.startsWith("scores.") || entry.startsWith("revisions."));
	assert.deepEqual(transaction.slice(1, 3), ["jobs.getVersioned", "jobs.compareAndSet"], "the job fence is written first");
	assert.ok(firstScoreAccess > 2, "score storage follows the fence");
	assert.equal(transaction.filter((entry) => entry === "jobs.compareAndSet").length, 2);
	const jobCas = casRevisions.filter((entry) => entry.store === "jobs");
	const [fence, receipt] = jobCas.slice(-3, -1);
	assert.notEqual(fence!.revision, receipt!.revision, "the receipt write names the fence's fresh revision");
	assert.equal(receipt!.revision, `jobs-r${Number(fence!.revision!.split("-r")[1]) + 1}`);
}

// A failure after the fence rolls back the fence, the score and the receipt together.
reset(2);
{
	const started = ok(await start({ mode: "all" }), "start");
	scores.faults.push((operation) => { if (operation === "compareAndSet") throw new Error("injected score write failure"); });
	const rolledBack = ok(await send("continue", started.scan), "rolled back");
	assert.deepEqual([rolledBack.outcome?.status, rolledBack.outcome?.reason], ["failed", "acceptance-rolled-back"]);
	assert.equal(scores.read("posts:e001"), null);
	assert.ok(log.includes("tx.rollback"));
	assert.equal(rolledBack.scan.counters.saved, 0);
	scores.faults.length = 0;
	const next = ok(await send("continue", rolledBack.scan), "next entry");
	assert.equal(next.outcome?.status, "saved");
}

// ---- Commit and response failures resolve only from the exact receipt ----

reset(4);
{
	const started = ok(await start({ mode: "all" }), "start");
	commitMode = "lose-response";
	const recovered = ok(await send("continue", started.scan), "readback finds the receipt");
	assert.deepEqual([recovered.outcome?.status, recovered.scan.counters.saved, recovered.scan.counters.admitted], ["saved", 1, 1]);
	assert.equal(recovered.outcome?.history, "created", "history still runs after a committed acceptance");

	commitMode = "fail-before-commit";
	const failed = ok(await send("continue", recovered.scan), "rollback proves no acceptance");
	assert.deepEqual([failed.outcome?.status, failed.outcome?.reason], ["failed", "acceptance-rolled-back"]);
	assert.equal(scores.read("posts:e002"), null);

	// Commit applied, but the readback cannot be read: uncertain, then exact recovery without recounting.
	commitMode = "lose-response";
	let armed = false;
	beforeAccept = async () => { armed = true; };
	jobs.faults.push((operation) => {
		if (!armed || operation !== "get" || log.at(-2) !== "tx.commit") return;
		armed = false;
		throw new Error("injected readback failure");
	});
	const uncertain = refused(await send("continue", failed.scan), "uncertain", "an unresolved readback is uncertain");
	jobs.faults.length = 0;
	assert.equal(scores.read("posts:e003")?.ref, "posts:e003");
	const state = (await readScoreScanState(ctx, now())) as any;
	assert.equal(state.scan.counters.saved, 2, "the committed receipt counted once");
	assert.equal(state.scan.unit.phase, "history");
	assert.equal(uncertain.scan?.state, "running");
	clock += SCORE_SCAN_UNIT_LEASE_MS + 1;
	const resumed = ok(await send("resume", state.scan), "recover");
	assert.deepEqual([resumed.scan.counters.saved, resumed.scan.counters.uncertain, resumed.scan.counters.historyUnknown], [2, 0, 1],
		"recovery recomputes nothing and marks the interrupted history unknown");
	assert.equal(resumed.scan.outcomes.at(-1)?.history, "unknown");
}

// ---- Interrupted history is resolved before another unit ----

reset(2);
{
	const started = ok(await start({ mode: "all" }), "start");
	historyPlan.push("crash");
	await assert.rejects(() => send("continue", started.scan), Crash);
	const pending = (await readScoreScanState(ctx, now())) as any;
	assert.deepEqual([pending.scan.unit.phase, pending.scan.counters.saved], ["history", 1]);
	refused(await send("continue", pending.scan), "busy", "history work holds its lease");
	clock += SCORE_SCAN_UNIT_LEASE_MS + 1;
	const writesBefore = log.filter((entry) => entry === "scores.compareAndSet").length;
	const next = ok(await send("continue", pending.scan), "next unit resolves history first");
	assert.deepEqual(next.scan.outcomes.map((outcome) => outcome.history), ["unknown", "created"]);
	assert.equal(next.scan.counters.historyUnknown, 1);
	assert.equal(log.filter((entry) => entry === "scores.compareAndSet").length, writesBefore + 1, "no repair write for the first score");
}

// ---- Failure streak, skipped and superseded outcomes ----

reset(6);
{
	plans.set("e001", ["fail"]);
	plans.set("e002", ["superseded"]);
	plans.set("e003", ["fail"]);
	plans.set("e004", ["fail"]);
	plans.set("e005", ["fail"]);
	entries.get("e002")!.locale = "en";
	const started = ok(await start({ mode: "all" }), "start");
	const first = ok(await send("continue", started.scan), "fail 1");
	assert.deepEqual([first.outcome?.status, first.outcome?.computation, first.scan.failureStreak], ["failed", "incomplete", 1]);
	const second = ok(await send("continue", first.scan), "superseded");
	assert.deepEqual([second.outcome?.status, second.outcome?.reason, second.scan.failureStreak], ["superseded", "inputs-changed", 1]);
	const third = ok(await send("continue", second.scan), "fail 2");
	const fourth = ok(await send("continue", third.scan), "fail 3");
	assert.deepEqual([fourth.decision, fourth.scan.pauseReason, fourth.scan.failureStreak], ["paused", "failure-streak", SCORE_SCAN_FAILURE_STREAK_LIMIT]);
	assert.equal(fourth.scan.counters.admitted, 4, "failed entries consume their admitted slots");
	const resumed = ok(await send("resume", fourth.scan), "resume resets the streak");
	assert.equal(resumed.scan.failureStreak, 0);
	entries.get("e006")!.deleted = true;
	const done = await drain(resumed.scan);
	assert.deepEqual(done.scan.outcomes.slice(-1).map((outcome) => [outcome.ref, outcome.status]), [["posts:e005", "failed"]]);
	assert.equal(done.scan.counters.noLongerMatching, 1, "a deleted entry before admission consumes nothing");
}

// ---- Source failures pause without consuming the target ----

reset(2);
{
	const started = ok(await start({ mode: "count", count: 2 }), "start");
	pageFault = new Error("injected page failure");
	const blocked = ok(await send("continue", started.scan), "page failure");
	assert.deepEqual([blocked.scan.pauseReason, blocked.scan.counters.admitted, blocked.scan.counters.noLongerMatching], ["source-unavailable", 0, 0]);
	pageFault = null;
	const resumed = ok(await send("resume", blocked.scan), "resume");
	const first = ok(await send("continue", resumed.scan), "first");
	revalidateFault = new Error("injected revalidation failure");
	const revalidation = ok(await send("continue", first.scan), "revalidation failure");
	assert.deepEqual([revalidation.scan.pauseReason, revalidation.scan.counters.admitted, revalidation.scan.bufferedReferences], ["source-unavailable", 1, 1],
		"a read failure is never a nonmatching entry");
}

// ---- Receipt horizon and bounded outcomes ----

reset(30);
{
	let view = ok(await start({ mode: "all" }), "start").scan;
	const early = { ...view };
	for (let index = 0; index < 24; index += 1) view = ok(await send("continue", view), `unit ${index}`).scan;
	assert.equal(view.outcomes.length, SCORE_SCAN_OUTCOME_RETENTION, "only the latest outcomes are kept");
	refused(await send("continue", early), "receipt_expired", "a command older than the receipt horizon is refused, not run");
	assert.ok(stored()!.receipts.length <= 20);
}

reset(1);
policy = { value: { ...settings(true), contentScoringResourceNoticeVersion: undefined }, revision: "pending-confirmation" };
refused(await start({ mode: "count", count: 1 }), "activation_required", "pending analysis never starts a scan");
assert.equal(stored(), null);
assert.equal(analyzerRuns, 0);
setPolicy(true);
collectionProfileAvailable = false;
refused(await start({ mode: "count", count: 1 }), "profile_required", "an explicit collection profile is required");
assert.equal(stored(), null);
collectionProfileAvailable = true;
const profileControlledRun = ok(await start({ mode: "count", count: 1 }), "configured scan");
const profilePausedRun = ok(await send("pause", profileControlledRun.scan), "pause");
collectionProfileAvailable = false;
refused(await send("resume", profilePausedRun.scan), "profile_required", "resume cannot bypass the profile choice");
assert.equal(stored()!.revision, profilePausedRun.scan.revision);
assert.equal(analyzerRuns, 0);

// ---- A run that crosses an analyzer upgrade pauses once for a policy change ----

reset(4);
{
	const started = ok(await start({ mode: "all" }), "start");
	assert.equal(stored()!.scoreVersion, SEO_SCORE_VERSION, "a new run records the analyzer that started it");
	const first = ok(await send("continue", started.scan), "first unit");
	const earlierRun = (record: NonNullable<ReturnType<typeof stored>>) => {
		const { scoreVersion: _analyzer, ...legacy } = record;
		return { ...legacy, outcomes: legacy.outcomes.map((outcome) => ({ ...outcome, score: 80 })) };
	};
	await jobs.api.put(SCORE_SCAN_JOB_ID, earlierRun(stored()!));
	assert.equal(stored()!.scoreVersion, undefined, "a run started by analyzer 20 has no recorded analyzer");
	const crossed = ok(await send("continue", first.scan), "continue across the upgrade");
	assert.deepEqual([crossed.decision, crossed.scan.state, crossed.scan.pauseReason, crossed.scan.counters.admitted],
		["paused", "paused", "policy-changed", 1], "the upgrade pauses the run without admitting another entry");
	assert.equal(stored()!.scoreVersion, SEO_SCORE_VERSION, "the pause restamps the current analyzer");
	assert.ok(crossed.scan.outcomes.length > 0 && crossed.scan.outcomes.every((outcome) => outcome.score === null),
		"outcome numbers from the earlier analyzer are dropped");
	await assertAdminReads(crossed, "the admin reads a run paused for the analyzer change");
	const resumed = ok(await send("resume", crossed.scan), "resume after the upgrade pause");
	assert.equal(resumed.scan.state, "running");
	const next = ok(await send("continue", resumed.scan), "continue under the current analyzer");
	assert.deepEqual([next.progress, next.scan.counters.admitted], ["outcome", 2]);

	const paused = ok(await send("pause", next.scan), "pause before the upgrade");
	await jobs.api.put(SCORE_SCAN_JOB_ID, earlierRun(stored()!));
	const resumedAcross = ok(await send("resume", paused.scan), "resume across the upgrade");
	assert.deepEqual([resumedAcross.scan.state, resumedAcross.scan.pauseReason], ["paused", "policy-changed"],
		"a resume across the upgrade pauses once for the policy change");
	assert.equal(stored()!.scoreVersion, SEO_SCORE_VERSION);
	const resumedAgain = ok(await send("resume", resumedAcross.scan), "second resume");
	assert.equal(resumedAgain.scan.state, "running", "the restamped run resumes normally");
}

// ---- Saved and reused results the shared display dashes reach the admin without a number ----

const dashed = (body: string, bodySource?: string) => (item: any, analysisRevision: number) => ({
	...makeScore(item, analysisRevision),
	...analyzeSeoContent({
		ref: `posts:${item.id}`, collection: "posts", entryId: item.id, slug: item.id, title: "Boiler repair guide",
		description: "How to plan a boiler repair visit.", url: `https://example.com/${item.id}`, noindex: false, body,
		document: [{ _type: "block", style: "normal", children: [{ _type: "span", text: body }] }],
		assessmentProfile: { profile: collectionProfile, version: 1 }, bodySource,
		schemaEnabled: true, schemaPreset: "BlogPosting",
	}),
	analysisRevision,
});
reset(3);
{
	scoreFor = dashed("Body text from a template.", "template");
	plans.set("e002", ["reuse"]);
	const started = ok(await start({ mode: "all" }), "start");
	const templateBody = ok(await send("continue", started.scan), "a template body");
	assert.deepEqual([templateBody.outcome?.status, templateBody.outcome?.score, templateBody.outcome?.history], ["saved", null, "created"]);
	await assertAdminReads(templateBody, "a saved result with an unread template body");
	const reused = ok(await send("continue", templateBody.scan), "a reused dashed result");
	assert.deepEqual([reused.outcome?.status, reused.outcome?.score], ["reused", null]);
	await assertAdminReads(reused, "a reused result the display dashes");
}
reset(1);
{
	collectionProfile = "general";
	scoreFor = dashed("Only a few words here.");
	const started = ok(await start({ mode: "all" }), "start a General run");
	const shortGeneral = ok(await send("continue", started.scan), "a short General entry");
	assert.deepEqual([shortGeneral.outcome?.status, shortGeneral.outcome?.reason, shortGeneral.outcome?.score], ["saved", null, null]);
	await assertAdminReads(shortGeneral, "a saved General result under the word minimum");
}

console.log("shipit-seo score scan self-check passed");
