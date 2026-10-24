import assert from "node:assert/strict";
import { analyzeSeoContent } from "./analysis.ts";
import { currentSeoScoreAssessmentProblem } from "./score-result-validation.ts";

import {
	SEO_SCORE_VERSION,
	type SeoAdminContentScore,
} from "./admin-contract.ts";
import {
	SEO_SCORE_HISTORY_PER_ENTRY_RETENTION,
	acceptAnalyzedScore,
	buildScoreTrends,
	createScoreSnapshot,
	enforceScoreHistoryRetention,
	isScoreSnapshot,
	listScoreSnapshots,
	ScorePersistenceError,
	persistScoreWithHistory,
	recordAcceptedScoreHistory,
	scoreHistoryAfterLease,
	scoreSnapshotFingerprint,
} from "./score-history.ts";

function score(input: {
	ref: string;
	title: string;
	capturedAt: string;
	sourceUpdatedAt: string;
	analysisRevision?: number;
	missingMetadata?: readonly ("title" | "description")[];
	focusKeyword?: string;
	/** A saved Portable Text body; without one the entry is template-managed and shows no number. */
	document?: unknown;
}): SeoAdminContentScore {
	const [collection, entryId] = input.ref.split(":");
	const result: SeoAdminContentScore = {
		...analyzeSeoContent({
			ref: input.ref, collection, entryId, slug: entryId,
			title: input.missingMetadata?.includes("title") ? "" : input.title,
			description: input.missingMetadata?.includes("description") ? "" : `Saved description for ${input.title}.`,
			url: `https://example.com/${entryId}`,
			canonicalStatus: "matches",
			image: "https://example.com/share.webp",
			noindex: false,
			publicationStatus: "published",
			body: "",
			...(input.document === undefined ? { bodySource: "template" } : { document: input.document }),
			focusKeyword: input.focusKeyword,
			assessmentProfile: { profile: "article", version: 1 },
			schemaEnabled: false,
			schemaPreset: "WebPage",
			sourceUpdatedAt: input.sourceUpdatedAt,
		}),
		assessmentProfileRevision: "profile-1",
		analysisRevision: input.analysisRevision ?? 1,
		profileKeywords: input.focusKeyword ? [input.focusKeyword] : null,
		focusKeywordSource: input.focusKeyword ? "profile" : "none",
		keywords: input.focusKeyword ? [input.focusKeyword] : [],
		updatedAt: input.capturedAt,
		templateUpdatedAt: "2026-07-01T00:00:00.000Z",
		modulesUpdatedAt: "2026-07-01T00:00:00.000Z",
		configurationFingerprint: "seo-config-v1-fixture",
		metaOverrideUpdatedAt: null,
	};
	assert.equal(result.scoreVersion, SEO_SCORE_VERSION);
	assert.equal(currentSeoScoreAssessmentProblem(result), null, "history persistence fixtures must be consistent current assessments");
	return result;
}

function memoryCollection() {
	const records = new Map<string, any>();
	const calls = { count: 0 };
	return {
		records,
		calls,
		api: {
			put: async (id: string, value: unknown) => records.set(id, structuredClone(value)),
			get: async (id: string) => structuredClone(records.get(id) ?? null),
			compareAndSet: async (id: string, expected: any, next: any) => {
				const present = records.has(id);
				if (expected.state === "missing" ? present : !present) return false;
				if (
					expected.state === "value" &&
					JSON.stringify(records.get(id)) !== JSON.stringify(expected.value)
				)
					return false;
				if (next.action === "delete") return records.delete(id);
				records.set(id, structuredClone(next.value));
				return true;
			},
			count: async () => {
				calls.count += 1;
				return records.size;
			},
			deleteMany: async (ids: string[]) => {
				let deleted = 0;
				for (const id of ids) if (records.delete(id)) deleted += 1;
				return deleted;
			},
			query: async (options: any = {}) => {
				let items = [...records.entries()].map(([id, data]) => ({ id, data: structuredClone(data) }));
				if (options.where) {
					items = items.filter((item) => Object.entries(options.where).every(([key, value]) => item.data[key] === value));
				}
				const [orderKey, direction] = Object.entries(options.orderBy ?? { capturedAt: "asc" })[0] as [string, string];
				if (options.orderBy) {
					items.sort(
						(left, right) =>
							String(left.data[orderKey] ?? "").localeCompare(
								String(right.data[orderKey] ?? ""),
							) * (direction === "desc" ? -1 : 1),
					);
				}
				const start = Number.parseInt(options.cursor ?? "0", 10) || 0;
				const limit = Math.min(options.limit ?? 50, 100);
				const page = items.slice(start, start + limit);
				const hasMore = start + limit < items.length;
				return {
					items: page,
					hasMore,
					cursor: hasMore ? String(start + limit) : undefined,
				};
			},
		},
	};
}

const fixtureAnalysisRevisions = new Map<string, number>();
const fixtureReservationStore = {
	get: async (ref: string) => ({
		id: ref,
		ref,
		storageVersion: 1,
		revision: fixtureAnalysisRevisions.get(ref) ?? 1,
		updatedAt: "2026-07-01T00:00:00.000Z",
	}),
};

async function waitForRaceSignal(signal: Promise<void>, label: string): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			signal,
			new Promise<void>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(`${label} was not reached`)), 5_000);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

const first = score({
	ref: "posts:alpha",
	title: "Alpha",
	capturedAt: "2026-07-10T09:00:00.000Z",
	sourceUpdatedAt: "2026-07-10T08:00:00.000Z",
	missingMetadata: ["title"],
});
const repeated = { ...first, updatedAt: "2026-07-10T10:00:00.000Z" };
assert.equal(scoreSnapshotFingerprint(first), scoreSnapshotFingerprint(repeated));
assert.notEqual(
	scoreSnapshotFingerprint({ ...first, sourceVersion: "draft-revision-1" }),
	scoreSnapshotFingerprint({ ...first, sourceVersion: "draft-revision-2" }),
	"draft changes with an unchanged timestamp must have distinct score history fingerprints",
);
assert.notEqual(
	scoreSnapshotFingerprint(first),
	scoreSnapshotFingerprint({ ...first, modulesUpdatedAt: "2026-07-02T00:00:00.000Z" }),
	"module revisions must invalidate score history fingerprints",
);

const snapshot = createScoreSnapshot(first);
assert.equal(isScoreSnapshot(snapshot.id, snapshot), true);
const revisionSnapshot = createScoreSnapshot({ ...first, sourceVersion: "draft-revision-2" });
assert.equal(revisionSnapshot.sourceVersion, "draft-revision-2");
assert.equal(isScoreSnapshot(revisionSnapshot.id, revisionSnapshot), true);
assert.equal(isScoreSnapshot(revisionSnapshot.id, { ...revisionSnapshot, sourceVersion: "" }), false);
assert.equal(snapshot.issues.length, 1);
assert.equal(isScoreSnapshot(snapshot.id, { ...snapshot, score: 101 }), false);
const { modulesUpdatedAt: _legacyModulesRevision, ...legacySnapshot } = snapshot;
assert.equal(isScoreSnapshot(snapshot.id, legacySnapshot), true, "storage-v1 history without a module revision stays readable");
const { comparisonContext: _oldContext, ...beforeComparisonContext } = legacySnapshot;
assert.equal(isScoreSnapshot(snapshot.id, { ...beforeComparisonContext, scoreVersion: 19 }), true,
	"earlier analyzer history stays readable without comparison context or a module revision");

const scores = memoryCollection();
const history = memoryCollection();
const warnings: unknown[] = [];
const profileRead = { value: { profile: "article", version: 1, updatedAt: "2026-10-15T00:00:00.000Z" }, revision: "profile-1" };
const scoringKv = {
	get: async () => null,
	getVersioned: async (key: string) => key.startsWith("configuration:analysis-profile:")
		? structuredClone(profileRead) : { value: settingsRecord(true), revision: "r1" },
};
const admission = (revision: string | null) => ({
	state: "enabled" as const, revision, intentEnabled: true,
	acknowledgedNoticeVersion: 1, currentNoticeVersion: 1,
});
const ctx = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	kv: scoringKv,
	storage: {
		scores: scores.api,
		scoreAnalysisRevisions: fixtureReservationStore,
		scoreHistory: history.api,
		operationLeases: memoryCollection().api,
	},
	log: { warn: (...args: unknown[]) => warnings.push(args) },
} as any;

assert.deepEqual(await persistScoreWithHistory(ctx, first), { persisted: true, history: "created", historyCreated: true });
assert.deepEqual(await persistScoreWithHistory(ctx, repeated), { persisted: true, history: "unchanged", historyCreated: false },
	"an equal latest snapshot is reported as kept, not as a failed history write");
assert.equal(history.records.size, 1);
assert.equal(warnings.length, 0);

// The extracted acceptance takes no lease and touches no history, so a caller's
// transaction can hold it; the composed path above still records history.
const acceptedOnly = memoryCollection();
const forbidden = (name: string) => new Proxy({}, { get: () => { throw new Error(`${name} used during acceptance`); } });
const acceptanceCtx = {
	...ctx,
	storage: { scores: acceptedOnly.api, scoreAnalysisRevisions: fixtureReservationStore, scoreHistory: forbidden("score history"), operationLeases: forbidden("operation leases") },
} as any;
assert.deepEqual(await acceptAnalyzedScore(acceptanceCtx, first), { persisted: true });
assert.equal(acceptedOnly.records.size, 1);
const missingHistory = { ...ctx, storage: { ...ctx.storage, scoreHistory: undefined }, log: { warn: () => undefined } } as any;
assert.equal(await recordAcceptedScoreHistory(missingHistory, first), "failed", "a history failure is a named outcome, never a throw");

const pausedScores = memoryCollection();
const pausedHistory = memoryCollection();
function settingsRecord(contentScoringEnabled: boolean) { return {
	version: 1,
	updatedAt: "2026-07-10T10:00:00.000Z",
	siteName: "Example",
	siteUrl: "https://example.com",
	organizationName: "Example",
	organizationLogo: "",
	socialProfiles: [],
	defaultSocialImage: "",
	twitterHandle: "",
	noindex: false,
	contentScoringEnabled,
	contentScoringResourceNoticeVersion: 1,
}; }
const pausedContext = {
	...ctx,
	kv: {
		get: async () => settingsRecord(false),
		getVersioned: async () => ({ value: settingsRecord(false), revision: "r1" }),
	},
	storage: { ...ctx.storage, scores: pausedScores.api, scoreHistory: pausedHistory.api },
} as any;
assert.deepEqual(await persistScoreWithHistory(pausedContext, first), {
	persisted: false, refusal: "scoring-disabled", history: "not-attempted", historyCreated: false,
});
assert.equal(pausedScores.records.size, 0, "paused scoring must not write the current score");
assert.equal(pausedHistory.records.size, 0, "paused scoring must not append history");

// The admitting policy revision must still be current: an off/on change in
// between, or a policy that cannot be read, refuses the older operation.
for (const [label, kv, refusal] of [
	["a re-enabled policy at a new revision", { getVersioned: async () => ({ value: settingsRecord(true), revision: "r2" }) }, "policy-changed"],
	["an unreadable policy", { getVersioned: async () => { throw new Error("database is locked"); } }, "scoring-unavailable"],
	["a corrupt policy record", { getVersioned: async () => ({ value: { version: 1, contentScoringEnabled: true }, revision: "r1" }) }, "scoring-unavailable"],
] as const) {
	const policyScores = memoryCollection();
	const policyHistory = memoryCollection();
	const result = await persistScoreWithHistory({
		...ctx, kv, storage: { ...ctx.storage, scores: policyScores.api, scoreHistory: policyHistory.api },
	} as any, first, { admission: admission("r1") });
	assert.deepEqual(result, { persisted: false, refusal, history: "not-attempted", historyCreated: false }, label);
	assert.equal(policyScores.records.size + policyHistory.records.size, 0, `${label} writes nothing`);
}
const admittedScores = memoryCollection();
assert.equal((await persistScoreWithHistory({
	...ctx,
	kv: scoringKv,
	storage: { ...ctx.storage, scores: admittedScores.api, scoreHistory: memoryCollection().api },
} as any, first, { admission: admission("r1") })).persisted, true, "control: the same enabled revision persists");
assert.equal((await persistScoreWithHistory({
	...ctx,
	kv: { getVersioned: async () => null },
	storage: { ...ctx.storage, scores: memoryCollection().api, scoreHistory: memoryCollection().api },
} as any, first, { admission: admission(null) })).persisted, false, "absent settings cannot authorize score persistence");

const profileChangedScores = memoryCollection();
const profileChangedHistory = memoryCollection();
const changedProfileKv = {
	getVersioned: async (key: string) => key.startsWith("configuration:analysis-profile:")
		? { ...profileRead, revision: "profile-2" } : scoringKv.getVersioned(key),
};
const profileChanged = await persistScoreWithHistory({
	...ctx, kv: changedProfileKv, storage: { ...ctx.storage, scores: profileChangedScores.api, scoreHistory: profileChangedHistory.api },
} as any, first, { admission: admission("r1") });
assert.deepEqual(profileChanged, { persisted: false, refusal: "policy-changed", history: "not-attempted", historyCreated: false });
assert.equal(profileChangedScores.records.size + profileChangedHistory.records.size, 0,
	"a same-value profile revision race is refused at the final score acceptance boundary");

// Policy/profile revisions can change while the score CAS is in flight.
// Refusal must restore the prior score before any history is appended.
for (const change of ["pause", "policy-revision", "profile-revision", "profile-removed"] as const) {
	const racedScores = memoryCollection();
	const racedHistory = memoryCollection();
	const previous = score({
		ref: first.ref, title: "Prior saved content",
		capturedAt: "2026-07-10T08:30:00.000Z", sourceUpdatedAt: "2026-07-10T08:00:00.000Z",
		missingMetadata: ["title", "description"],
	});
	racedScores.records.set(first.ref, structuredClone(previous));
	let changed = false;
	const compareAndSet = racedScores.api.compareAndSet;
	racedScores.api.compareAndSet = async (id, expected, next) => {
		if (next.action === "put" && JSON.stringify(next.value) === JSON.stringify(first)) changed = true;
		return compareAndSet(id, expected, next);
	};
	const racedKv = {
		getVersioned: async (key: string) => {
			if (key.startsWith("configuration:analysis-profile:")) {
				if (changed && change === "profile-removed") return null;
				return { ...structuredClone(profileRead), revision: changed && change === "profile-revision" ? "profile-2" : "profile-1" };
			}
			return { value: settingsRecord(!(changed && change === "pause")), revision: changed && change === "policy-revision" ? "r2" : "r1" };
		},
	};
	const outcome = await persistScoreWithHistory({
		...ctx, kv: racedKv, storage: { ...ctx.storage, scores: racedScores.api, scoreHistory: racedHistory.api },
	} as any, first, { admission: admission("r1") });
	assert.deepEqual(outcome, {
		persisted: false, refusal: change === "pause" ? "scoring-disabled" : "policy-changed",
		history: "not-attempted", historyCreated: false,
	}, `${change} inside the score CAS refuses acceptance`);
	assert.deepEqual(racedScores.records.get(first.ref), previous, `${change} restores the preceding score`);
	assert.equal(racedHistory.records.size, 0, `${change} writes no history`);
}

// Post-write read/rollback failures remain uncertain; a conditional rollback
// must never replace a newer score written by another operation.
for (const failure of ["policy-unreadable", "profile-unreadable", "rollback-failed", "newer-score"] as const) {
	const racedScores = memoryCollection();
	const racedHistory = memoryCollection();
	const previous = score({
		ref: first.ref, title: "Prior saved content",
		capturedAt: "2026-07-10T08:30:00.000Z", sourceUpdatedAt: "2026-07-10T08:00:00.000Z",
		missingMetadata: ["title", "description"],
	});
	const newer = score({
		ref: first.ref, title: "Concurrent newer content", analysisRevision: 2,
		capturedAt: "2026-07-10T09:30:00.000Z", sourceUpdatedAt: "2026-07-10T09:00:00.000Z",
	});
	racedScores.records.set(first.ref, structuredClone(previous));
	let changed = false;
	const compareAndSet = racedScores.api.compareAndSet;
	racedScores.api.compareAndSet = async (id, expected, next) => {
		if (next.action === "put" && JSON.stringify(next.value) === JSON.stringify(first)) {
			changed = true;
			const committed = await compareAndSet(id, expected, next);
			if (failure === "newer-score" && committed) racedScores.records.set(id, structuredClone(newer));
			return committed;
		}
		if (failure === "rollback-failed") throw new Error("rollback storage unavailable");
		return compareAndSet(id, expected, next);
	};
	const racedKv = {
		getVersioned: async (key: string) => {
			if (key.startsWith("configuration:analysis-profile:")) {
				if (changed && failure === "profile-unreadable") throw new Error("profile read unavailable");
				return { ...structuredClone(profileRead), revision: changed ? "profile-2" : "profile-1" };
			}
			if (changed && failure === "policy-unreadable") throw new Error("policy read unavailable");
			return { value: settingsRecord(true), revision: "r1" };
		},
	};
	const persist = () => persistScoreWithHistory({
		...ctx, kv: racedKv, storage: { ...ctx.storage, scores: racedScores.api, scoreHistory: racedHistory.api },
	} as any, first, { admission: admission("r1") });
	if (failure === "newer-score") {
		assert.deepEqual(await persist(), { persisted: false, refusal: "policy-changed", history: "not-attempted", historyCreated: false });
		assert.deepEqual(racedScores.records.get(first.ref), newer, "rollback preserves a concurrently newer score");
	} else {
		await assert.rejects(persist, (error) => error instanceof ScorePersistenceError && error.scoreWriteAttempted,
			`${failure} after CAS reports uncertainty`);
		assert.deepEqual(racedScores.records.get(first.ref), failure === "rollback-failed" ? first : previous,
			`${failure} retains the actual rollback outcome`);
	}
	assert.equal(racedHistory.records.size, 0, `${failure} appends no history`);
}

const concurrentScores = memoryCollection();
const concurrentHistory = memoryCollection();
const concurrentLatestQuery = concurrentHistory.api.query;
let concurrentLatestReads = 0;
let releaseConcurrentLatestReads!: () => void;
const concurrentLatestBarrier = new Promise<void>((resolve) => {
	releaseConcurrentLatestReads = resolve;
});
concurrentHistory.api.query = async (options: any = {}) => {
	const result = await concurrentLatestQuery(options);
	if (options.where?.ref === first.ref && options.limit === 1) {
		concurrentLatestReads += 1;
		if (concurrentLatestReads === 2) releaseConcurrentLatestReads();
		else {
			await Promise.race([
				concurrentLatestBarrier,
				new Promise<void>((resolve) => setTimeout(resolve, 25)),
			]);
		}
	}
	return result;
};
const concurrentScoreContext = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	kv: scoringKv,
	storage: {
		scores: concurrentScores.api,
		scoreAnalysisRevisions: fixtureReservationStore,
		scoreHistory: concurrentHistory.api,
		operationLeases: memoryCollection().api,
	},
	log: { warn: (...args: unknown[]) => warnings.push(args) },
} as any;
await Promise.all([
	persistScoreWithHistory(concurrentScoreContext, first),
	persistScoreWithHistory(concurrentScoreContext, repeated),
]);
assert.equal(
	concurrentHistory.records.size,
	1,
	"concurrent identical fingerprints must create one history snapshot",
);

const freshnessScores = memoryCollection();
const freshnessHistory = memoryCollection();
const olderScore = score({
	ref: "posts:freshness",
	title: "Older source",
	capturedAt: "2026-07-16T12:00:00.000Z",
	sourceUpdatedAt: "2026-07-15T08:00:00.000Z",
	analysisRevision: 1,
});
const newerScore = score({
	ref: "posts:freshness",
	title: "Newer source",
	capturedAt: "2026-07-16T11:00:00.000Z",
	sourceUpdatedAt: "2026-07-16T08:00:00.000Z",
	analysisRevision: 2,
});
const freshnessCas = freshnessScores.api.compareAndSet;
let releaseOlderWrite!: () => void;
let markOlderWriteStarted!: () => void;
const olderWriteGate = new Promise<void>((resolve) => {
	releaseOlderWrite = resolve;
});
const olderWriteStarted = new Promise<void>((resolve) => {
	markOlderWriteStarted = resolve;
});
let olderWriteBlocked = false;
freshnessScores.api.compareAndSet = async (
	id: string,
	expected: any,
	next: any,
) => {
	if (
		!olderWriteBlocked &&
		next.action === "put" &&
		next.value.sourceUpdatedAt === olderScore.sourceUpdatedAt
	) {
		olderWriteBlocked = true;
		markOlderWriteStarted();
		await olderWriteGate;
	}
	return freshnessCas(id, expected, next);
};
const freshnessContext = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	kv: scoringKv,
	storage: {
		scores: freshnessScores.api,
		scoreAnalysisRevisions: fixtureReservationStore,
		scoreHistory: freshnessHistory.api,
		operationLeases: memoryCollection().api,
	},
	log: { warn: (...args: unknown[]) => warnings.push(args) },
} as any;
const olderWrite = persistScoreWithHistory(freshnessContext, olderScore);
await olderWriteStarted;
fixtureAnalysisRevisions.set(newerScore.ref, newerScore.analysisRevision);
await persistScoreWithHistory(freshnessContext, newerScore);
releaseOlderWrite();
await olderWrite;
assert.equal(
	freshnessScores.records.get(olderScore.ref)?.sourceUpdatedAt,
	newerScore.sourceUpdatedAt,
	"an older source analysis finishing last must not replace the current score",
);
assert.equal(
	[...freshnessHistory.records.values()].every(
		(item) => item.sourceUpdatedAt === newerScore.sourceUpdatedAt,
	),
	true,
	"a rejected stale current score must not create history",
);

const configurationRaceScores = memoryCollection();
const configurationRaceHistory = memoryCollection();
const oldConfigurationScore = {
	...score({
		ref: "posts:configuration-race",
		title: "Old configuration",
		capturedAt: "2026-07-16T12:00:00.000Z",
		sourceUpdatedAt: "2026-07-16T08:00:00.000Z",
		analysisRevision: 1,
	}),
	templateUpdatedAt: "2026-07-15T09:00:00.000Z",
	modulesUpdatedAt: "2026-07-15T09:00:00.000Z",
	configurationFingerprint: "seo-config-old",
	metaOverrideUpdatedAt: "2026-07-15T09:00:00.000Z",
};
const newConfigurationScore = {
	...score({
		ref: oldConfigurationScore.ref, title: "New configuration", analysisRevision: 2,
		capturedAt: "2026-07-16T11:00:00.000Z", sourceUpdatedAt: "2026-07-16T08:00:00.000Z",
	}),
	templateUpdatedAt: "2026-07-16T09:00:00.000Z",
	modulesUpdatedAt: "2026-07-16T09:00:00.000Z",
	configurationFingerprint: "seo-config-new",
	metaOverrideUpdatedAt: "2026-07-16T09:00:00.000Z",
};
const configurationRaceCas = configurationRaceScores.api.compareAndSet;
let releaseOldConfigurationWrite!: () => void;
let markOldConfigurationWriteStarted!: () => void;
const oldConfigurationGate = new Promise<void>((resolve) => {
	releaseOldConfigurationWrite = resolve;
});
const oldConfigurationStarted = new Promise<void>((resolve) => {
	markOldConfigurationWriteStarted = resolve;
});
configurationRaceScores.api.compareAndSet = async (
	id: string,
	expected: any,
	next: any,
) => {
	if (
		next.action === "put" &&
		next.value.analysisRevision === oldConfigurationScore.analysisRevision
	) {
		markOldConfigurationWriteStarted();
		await oldConfigurationGate;
	}
	return configurationRaceCas(id, expected, next);
};
const configurationRaceContext = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	kv: scoringKv,
	storage: {
		scores: configurationRaceScores.api,
		scoreAnalysisRevisions: fixtureReservationStore,
		scoreHistory: configurationRaceHistory.api,
		operationLeases: memoryCollection().api,
	},
	log: { warn: (...args: unknown[]) => warnings.push(args) },
} as any;
const oldConfigurationWrite = persistScoreWithHistory(
	configurationRaceContext,
	oldConfigurationScore,
);
await oldConfigurationStarted;
fixtureAnalysisRevisions.set(newConfigurationScore.ref, newConfigurationScore.analysisRevision);
await persistScoreWithHistory(configurationRaceContext, newConfigurationScore);
releaseOldConfigurationWrite();
await oldConfigurationWrite;
assert.equal(
	configurationRaceScores.records.get(oldConfigurationScore.ref)
		?.analysisRevision,
	2,
	"an older equal-source configuration analysis finishing last must be fenced",
);
assert.equal(
	configurationRaceScores.records.get(oldConfigurationScore.ref)
		?.configurationFingerprint,
	"seo-config-new",
);
assert.equal(
	[...configurationRaceHistory.records.values()].every(
		(item) => item.analysisRevision === 2,
	),
	true,
	"a fenced configuration analysis must not create stale history",
);

async function checkReservationRace(newerWritesScore: boolean): Promise<void> {
	const ref = newerWritesScore ? "posts:reservation-overlap" : "posts:reservation-abandoned";
	const scores = memoryCollection();
	const history = memoryCollection();
	const revisions = memoryCollection();
	const baseline = score({
		ref, title: "Baseline",
		capturedAt: "2026-07-16T09:00:00.000Z",
		sourceUpdatedAt: "2026-07-16T08:00:00.000Z",
		analysisRevision: 1,
	});
	const older = {
		...score({
			ref, title: "Old settings", analysisRevision: 2, missingMetadata: ["description"],
			capturedAt: "2026-07-16T10:00:00.000Z", sourceUpdatedAt: "2026-07-16T08:00:00.000Z",
		}),
		configurationFingerprint: "seo-config-old",
	};
	const newer = {
		...score({
			ref, title: "New settings", analysisRevision: 3,
			capturedAt: "2026-07-16T11:00:00.000Z", sourceUpdatedAt: "2026-07-16T08:00:00.000Z",
		}),
		configurationFingerprint: "seo-config-new",
	};
	const reservation = (revision: number) => ({
		id: ref, ref, storageVersion: 1, revision,
		updatedAt: "2026-07-16T10:00:00.000Z",
	});
	scores.records.set(ref, baseline);
	revisions.records.set(ref, reservation(2));
	const originalCompareAndSet = scores.api.compareAndSet;
	let releaseOlderCas!: () => void;
	let markOlderCasStarted!: () => void;
	const olderCasGate = new Promise<void>((resolve) => { releaseOlderCas = resolve; });
	const olderCasStarted = new Promise<void>((resolve) => { markOlderCasStarted = resolve; });
	let releaseRollback!: () => void;
	let markRollbackStarted!: () => void;
	const rollbackGate = new Promise<void>((resolve) => { releaseRollback = resolve; });
	const rollbackStarted = new Promise<void>((resolve) => { markRollbackStarted = resolve; });
	scores.api.compareAndSet = async (id: string, expected: any, next: any) => {
		if (next.action === "put" && next.value.analysisRevision === 2) {
			markOlderCasStarted();
			await olderCasGate;
		}
		if (newerWritesScore && next.action === "put" && next.value.analysisRevision === 1 &&
			expected.state === "value" && expected.value.analysisRevision === 2) {
			markRollbackStarted();
			await rollbackGate;
		}
		return originalCompareAndSet(id, expected, next);
	};
	const context = {
		plugin: { id: "shipit-seo", version: "test" },
		site: { url: "https://example.com" },
		kv: scoringKv,
		storage: {
			scores: scores.api,
			scoreAnalysisRevisions: revisions.api,
			scoreHistory: history.api,
			operationLeases: memoryCollection().api,
		},
		log: { warn: (...args: unknown[]) => warnings.push(args) },
	} as any;
	const olderWrite = persistScoreWithHistory(context, older);
	await waitForRaceSignal(olderCasStarted, "older score CAS");
	assert.equal(await revisions.api.compareAndSet(ref, { state: "value", value: reservation(2) },
		{ action: "put", value: reservation(3) }), true);
	releaseOlderCas();
	if (newerWritesScore) {
		await waitForRaceSignal(rollbackStarted, "stale score rollback");
		assert.equal((await persistScoreWithHistory(context, newer)).persisted, true);
		releaseRollback();
	}
	assert.deepEqual(await olderWrite, { persisted: false, refusal: "reservation-superseded", history: "not-attempted", historyCreated: false });
	assert.equal(scores.records.get(ref)?.analysisRevision, newerWritesScore ? 3 : 1,
		"a rejected analysis must not replace the baseline or a newer score");
	assert.equal(history.records.size, newerWritesScore ? 1 : 0);
	assert.equal([...history.records.values()].some((item) => item.analysisRevision === 2), false,
		"a rejected analysis must not enter durable history");
}
await checkReservationRace(false);
await checkReservationRace(true);

const lostSnapshotScores = memoryCollection();
const lostSnapshotHistory = memoryCollection();
const lostSnapshotLeases = memoryCollection();
const lostSnapshotPut = lostSnapshotHistory.api.put;
let lostSnapshotOwnerRemoved = false;
lostSnapshotHistory.api.put = async (id: string, value: unknown) => {
	const result = await lostSnapshotPut(id, value);
	const owner = [...lostSnapshotLeases.records.entries()].find(
		([, lease]) => lease.scope === "score-history:mutation",
	);
	if (owner) {
		lostSnapshotOwnerRemoved = true;
		lostSnapshotLeases.records.delete(owner[0]);
	}
	return result;
};
const lostSnapshotContext = {
	plugin: { id: "shipit-seo-history-isolate-a", version: "test" },
	site: { url: "https://example.com" },
	kv: scoringKv,
	storage: {
		scores: lostSnapshotScores.api,
		scoreAnalysisRevisions: fixtureReservationStore,
		scoreHistory: lostSnapshotHistory.api,
		operationLeases: lostSnapshotLeases.api,
	},
	log: { warn: (...args: unknown[]) => warnings.push(args) },
} as any;
const lostSnapshotScore = score({
	ref: "posts:lost-history-owner",
	title: "Lost owner",
	capturedAt: "2026-07-17T10:00:00.000Z",
	sourceUpdatedAt: "2026-07-17T09:00:00.000Z",
	analysisRevision: 1,
});
const lostSnapshotResult = await persistScoreWithHistory(
	lostSnapshotContext,
	lostSnapshotScore,
);
assert.equal(lostSnapshotOwnerRemoved, true);
assert.deepEqual(
	[lostSnapshotResult.persisted, lostSnapshotResult.history],
	[true, "created"],
	"a snapshot written before its owner was lost exists, so it is never reported as absent",
);
assert.equal([...lostSnapshotHistory.records.values()].filter((item) => item.ref === lostSnapshotScore.ref).length, 1);
lostSnapshotHistory.api.put = lostSnapshotPut;
fixtureAnalysisRevisions.set(lostSnapshotScore.ref, 2);
const recoveredSnapshotResult = await persistScoreWithHistory(
	{
		...lostSnapshotContext,
		plugin: { id: "shipit-seo-history-isolate-b", version: "test" },
	} as any,
	{
		...lostSnapshotScore,
		analysisRevision: 2,
		updatedAt: "2026-07-17T10:01:00.000Z",
		sourceUpdatedAt: "2026-07-17T09:01:00.000Z",
	},
);
assert.equal(
	recoveredSnapshotResult.historyCreated,
	true,
	"a separate isolate can safely continue after the lost owner is fenced",
);

// The owner is removed and the put then fails, so the write may or may not exist.
const uncertainHistory = memoryCollection();
const uncertainLeases = memoryCollection();
const uncertainPut = uncertainHistory.api.put;
uncertainHistory.api.put = async (id: string, value: unknown) => {
	await uncertainPut(id, value);
	for (const [leaseId, lease] of [...uncertainLeases.records.entries()])
		if (lease.scope === "score-history:mutation") uncertainLeases.records.delete(leaseId);
	throw new Error("connection reset after the write was sent");
};
const uncertainResult = await persistScoreWithHistory({
	...lostSnapshotContext,
	plugin: { id: "shipit-seo-history-isolate-c", version: "test" },
	storage: {
		scores: memoryCollection().api,
		scoreAnalysisRevisions: fixtureReservationStore,
		scoreHistory: uncertainHistory.api,
		operationLeases: uncertainLeases.api,
	},
} as any, score({
	ref: "posts:uncertain-history", title: "Uncertain history", missingMetadata: ["title"],
	capturedAt: "2026-07-10T09:00:00.000Z", sourceUpdatedAt: "2026-07-10T08:00:00.000Z",
}));
assert.deepEqual([uncertainResult.persisted, uncertainResult.history], [true, "uncertain"],
	"a failed put response with a lost owner keeps the saved score and reports uncertain history");
assert.equal([...uncertainHistory.records.values()].filter((item) => item.ref === "posts:uncertain-history").length, 1,
	"control: the write landed before its response failed, so absent would have been false");

// Every lease result and write phase, including a lost lease the callback did not finish.
const lostLease = { acquired: false as const, reason: "lost" as const };
assert.deepEqual(
	(["before-write", "writing", "written"] as const).map((phase) => [
		scoreHistoryAfterLease(lostLease, phase),
		scoreHistoryAfterLease({ thrown: new Error("x") }, phase),
		scoreHistoryAfterLease({ acquired: false, reason: "busy" }, phase),
	]),
	[["failed", "failed", "failed"], ["uncertain", "uncertain", "uncertain"], ["created", "created", "created"]],
);
assert.equal(scoreHistoryAfterLease({ ...lostLease, value: "unchanged" }, "before-write"), "unchanged");
assert.equal(scoreHistoryAfterLease({ acquired: true, value: "created" }, "written"), "created");

const currentOnlyScores = memoryCollection();
const missingStorageWarnings: unknown[] = [];
const currentOnlyResult = await persistScoreWithHistory({
	kv: scoringKv,
	storage: { scores: currentOnlyScores.api, scoreAnalysisRevisions: fixtureReservationStore },
	log: { warn: (...args: unknown[]) => missingStorageWarnings.push(args) },
} as any, first);
assert.deepEqual([currentOnlyResult.persisted, currentOnlyResult.history], [true, "failed"],
	"missing history storage fails before any write and keeps the saved score");
assert.equal(currentOnlyScores.records.has(first.ref), true);
assert.equal(missingStorageWarnings.length, 1);

// Persistence errors say whether any conditional score write was attempted.
const attemptContext = (scoresApi: any, reservations: any = fixtureReservationStore) => ({
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	kv: scoringKv,
	storage: { scores: scoresApi, scoreAnalysisRevisions: reservations, scoreHistory: memoryCollection().api, operationLeases: memoryCollection().api },
	log: { warn: () => undefined },
}) as any;
const persistenceError = async (context: any): Promise<ScorePersistenceError | null> => {
	try {
		await persistScoreWithHistory(context, first);
	} catch (error: unknown) {
		assert.ok(error instanceof ScorePersistenceError, String(error));
		return error;
	}
	return null;
};
const prewriteScores = memoryCollection();
prewriteScores.api.get = async () => { throw new Error("database is locked"); };
const prewriteRead = await persistenceError(attemptContext(prewriteScores.api));
assert.deepEqual([prewriteRead?.scoreWriteAttempted, prewriteRead?.storageUnavailable, prewriteScores.records.size], [false, false, 0],
	"a read that fails before the score write wrote nothing");
const invalidRow = { ...first, sourceUpdatedAt: 42 };
const invalidRowScores = memoryCollection();
invalidRowScores.records.set(first.ref, invalidRow);
const invalidLegacyRow = await persistenceError(attemptContext(invalidRowScores.api));
assert.equal(invalidLegacyRow?.scoreWriteAttempted, false, "an invalid stored row is refused before any write");
assert.match(String(invalidLegacyRow?.message), /invalid source revision/);
assert.deepEqual(invalidRowScores.records.get(first.ref), invalidRow);
const attemptedScores = memoryCollection();
attemptedScores.api.compareAndSet = async () => { throw new Error("connection reset"); };
assert.equal((await persistenceError(attemptContext(attemptedScores.api)))?.scoreWriteAttempted, true,
	"a write whose response and readback fail may have been applied");
const landedScores = memoryCollection();
const landedCompareAndSet = landedScores.api.compareAndSet;
let scoreWriteLanded = false;
landedScores.api.compareAndSet = async (id: string, expected: any, next: any) => {
	const applied = await landedCompareAndSet(id, expected, next);
	scoreWriteLanded ||= applied && next.action === "put";
	return applied;
};
const landedReservations = {
	get: async (ref: string) => {
		if (scoreWriteLanded) throw new Error("reservation read failed after the write");
		return fixtureReservationStore.get(ref);
	},
};
const afterLandedWrite = await persistenceError(attemptContext(landedScores.api, landedReservations));
assert.deepEqual([scoreWriteLanded, afterLandedWrite?.scoreWriteAttempted], [true, true],
	"a reservation read that fails after a landed write leaves the stored score unknown");

const missingCurrentCas = memoryCollection();
missingCurrentCas.api.compareAndSet = undefined as any;
await assert.rejects(
	() =>
		persistScoreWithHistory(
			{
				kv: scoringKv,
				storage: { scores: missingCurrentCas.api, scoreAnalysisRevisions: fixtureReservationStore },
				log: { warn: () => undefined },
			} as any,
			first,
		),
	/conditional score writes/i,
	"current score persistence must fail closed without storage CAS",
);
assert.deepEqual(
	await persistScoreWithHistory({ kv: scoringKv, storage: { scores: missingCurrentCas.api, scoreAnalysisRevisions: fixtureReservationStore }, log: { warn: () => undefined } } as any, first)
		.then(() => null, (error: ScorePersistenceError) => [error.scoreWriteAttempted, error.storageUnavailable]),
	[false, true],
	"missing conditional storage is unavailable storage, before any write",
);
assert.equal(missingCurrentCas.records.size, 0);

const deferredScores = memoryCollection();
const deferredHistory = memoryCollection();
await persistScoreWithHistory({
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	kv: scoringKv,
	storage: {
		scores: deferredScores.api,
		scoreAnalysisRevisions: fixtureReservationStore,
		scoreHistory: deferredHistory.api,
		operationLeases: memoryCollection().api,
	},
} as any, first, { deferGlobalPrune: true });
assert.equal(deferredHistory.calls.count, 0, "batch writes must defer global count maintenance");
await enforceScoreHistoryRetention({
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	storage: {
		scoreHistory: deferredHistory.api,
		operationLeases: memoryCollection().api,
	},
} as any);
assert.equal(deferredHistory.calls.count, 1, "batch maintenance should run once after writes");

await assert.rejects(
	() => listScoreSnapshots({ storage: {} } as any),
	/score history storage is unavailable/i,
	"missing storage must not be presented as an empty history",
);

for (let index = 0; index < SEO_SCORE_HISTORY_PER_ENTRY_RETENTION + 4; index += 1) {
	const capturedAt = new Date(Date.UTC(2026, 7, index + 1, 12)).toISOString();
	const sourceUpdatedAt = new Date(Date.UTC(2026, 7, index + 1, 11)).toISOString();
	await persistScoreWithHistory(ctx, score({
		ref: "posts:alpha",
		title: "Alpha",
		capturedAt,
		sourceUpdatedAt,
		missingMetadata: ["description"],
	}));
}
assert.equal(history.records.size, SEO_SCORE_HISTORY_PER_ENTRY_RETENTION);

const legacyScores = memoryCollection();
const legacyHistory = memoryCollection();
for (let index = 0; index < 1_005; index += 1) {
	const capturedAt = new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString();
	legacyHistory.records.set(`legacy-${index}`, {
		id: `legacy-${index}`,
		ref: "posts:legacy",
		capturedAt,
	});
}
const legacyCtx = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	kv: scoringKv,
	storage: {
		scores: legacyScores.api,
		scoreAnalysisRevisions: fixtureReservationStore,
		scoreHistory: legacyHistory.api,
		operationLeases: memoryCollection().api,
	},
	log: { warn: (...args: unknown[]) => warnings.push(args) },
} as any;
await persistScoreWithHistory(legacyCtx, score({
	ref: "posts:legacy",
	title: "Legacy",
	capturedAt: "2026-07-15T10:00:00.000Z",
	sourceUpdatedAt: "2026-07-15T09:00:00.000Z",
}));
assert.equal(
	[...legacyHistory.records.values()].filter((item) => item.ref === "posts:legacy").length,
	SEO_SCORE_HISTORY_PER_ENTRY_RETENTION,
	"legacy stores spanning more than ten host-capped pages must still enforce the per-entry cap",
);

const pagedHistory = memoryCollection();
const pagedSnapshots = Array.from({ length: 150 }, (_, index) =>
	createScoreSnapshot(
		score({
			ref: `posts:paged-${index % 3}`,
			title: `Paged ${index}`,
			capturedAt: new Date(Date.UTC(2026, 2, 1, 0, 149 - index)).toISOString(),
			sourceUpdatedAt: new Date(
				Date.UTC(2026, 2, 1, 0, 149 - index, -1),
			).toISOString(),
		}),
	),
);
for (const item of pagedSnapshots) pagedHistory.records.set(item.id, item);
const listedPagedSnapshots = await listScoreSnapshots(
	{
		storage: { scoreHistory: pagedHistory.api },
	} as any,
	{ limit: 150 },
);
assert.equal(
	listedPagedSnapshots.length,
	150,
	"history reads must cross the host's 100-record page cap",
);
assert.deepEqual(
	listedPagedSnapshots.map((item) => item.capturedAt),
	[...pagedSnapshots].map((item) => item.capturedAt).sort(),
	"fully paged history must be sorted by capture time in memory",
);

const globalHistory = memoryCollection();
for (let index = 0; index < 2_005; index += 1) {
	globalHistory.records.set(`global-${index}`, {
		id: `global-${index}`,
		ref: `posts:${index}`,
		capturedAt: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
	});
}
await enforceScoreHistoryRetention({
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	storage: {
		scoreHistory: globalHistory.api,
		operationLeases: memoryCollection().api,
	},
} as any);
assert.equal(globalHistory.records.size, 2_000, "global maintenance must enforce the declared cap");

const noProgressHistory = memoryCollection();
for (let index = 0; index < 2_001; index += 1) {
	noProgressHistory.records.set(`no-progress-${index}`, {
		id: `no-progress-${index}`,
		ref: `posts:no-progress-${index}`,
		capturedAt: new Date(Date.UTC(2025, 0, 2, 0, index)).toISOString(),
	});
}
noProgressHistory.api.deleteMany = async () => 0;
await assert.rejects(
	() =>
		enforceScoreHistoryRetention({
			plugin: { id: "shipit-seo", version: "test" },
			site: { url: "https://example.com" },
			storage: {
				scoreHistory: noProgressHistory.api,
				operationLeases: memoryCollection().api,
			},
		} as any),
	/no progress|did not delete the exact/i,
	"retention must reject a delete that makes no progress",
);
assert.equal(noProgressHistory.records.size, 2_001);

const partialDeleteHistory = memoryCollection();
for (let index = 0; index < 2_005; index += 1) {
	partialDeleteHistory.records.set(`partial-delete-${index}`, {
		id: `partial-delete-${index}`,
		ref: `posts:partial-delete-${index}`,
		capturedAt: new Date(Date.UTC(2025, 0, 3, 0, index)).toISOString(),
	});
}
const partialDeleteMany = partialDeleteHistory.api.deleteMany;
partialDeleteHistory.api.deleteMany = async (ids: string[]) =>
	partialDeleteMany(ids.slice(0, 2));
await assert.rejects(
	() =>
		enforceScoreHistoryRetention({
			plugin: { id: "shipit-seo", version: "test" },
			site: { url: "https://example.com" },
			storage: {
				scoreHistory: partialDeleteHistory.api,
				operationLeases: memoryCollection().api,
			},
		} as any),
	/did not delete the exact/i,
	"retention must surface partial destructive mutations",
);
assert.equal(partialDeleteHistory.records.size, 2_003);

const lostRetentionHistory = memoryCollection();
const lostRetentionLeases = memoryCollection();
for (let index = 0; index < 2_001; index += 1) {
	lostRetentionHistory.records.set(`lost-retention-${index}`, {
		id: `lost-retention-${index}`,
		ref: `posts:lost-retention-${index}`,
		capturedAt: new Date(Date.UTC(2025, 0, 4, 0, index)).toISOString(),
	});
}
const lostRetentionDeleteMany = lostRetentionHistory.api.deleteMany;
lostRetentionHistory.api.deleteMany = async (ids: string[]) => {
	const deleted = await lostRetentionDeleteMany(ids);
	const owner = [...lostRetentionLeases.records.entries()].find(
		([, lease]) => lease.scope === "score-history:mutation",
	);
	if (owner) lostRetentionLeases.records.delete(owner[0]);
	return deleted;
};
await assert.rejects(
	() =>
		enforceScoreHistoryRetention({
			plugin: { id: "shipit-seo-retention-isolate", version: "test" },
			site: { url: "https://example.com" },
			storage: {
				scoreHistory: lostRetentionHistory.api,
				operationLeases: lostRetentionLeases.api,
			},
			log: { warn: () => undefined },
		} as any),
	/already running|lease was lost/i,
	"a void retention callback must surface ownership lost after a committed delete",
);
assert.equal(lostRetentionHistory.records.size, 2_000);

const concurrentGlobalHistory = memoryCollection();
for (let index = 0; index < 2_001; index += 1) {
	concurrentGlobalHistory.records.set(`concurrent-global-${index}`, {
		id: `concurrent-global-${index}`,
		ref: `posts:concurrent-${index}`,
		capturedAt: new Date(Date.UTC(2025, 1, 1, 0, index)).toISOString(),
	});
}
const concurrentApi = concurrentGlobalHistory.api;
const query = concurrentApi.query;
const deleteMany = concurrentApi.deleteMany;
let queryCount = 0;
let releaseSecondQuery!: () => void;
const firstDelete = new Promise<void>((resolve) => {
	releaseSecondQuery = resolve;
});
concurrentApi.query = async (options: any = {}) => {
	queryCount += 1;
	if (queryCount === 2) await firstDelete;
	return query(options);
};
concurrentApi.deleteMany = async (ids: string[]) => {
	const result = await deleteMany(ids);
	releaseSecondQuery();
	return result;
};
const concurrentRetentionContext = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { url: "https://example.com" },
	storage: {
		scoreHistory: concurrentApi,
		operationLeases: memoryCollection().api,
	},
	log: { warn: () => undefined },
} as any;
await Promise.all([
	enforceScoreHistoryRetention(concurrentRetentionContext),
	enforceScoreHistoryRetention(concurrentRetentionContext),
]);
assert.equal(
	concurrentGlobalHistory.records.size,
	2_000,
	"concurrent global maintenance must not prune below the declared cap",
);

await assert.rejects(
	() => listScoreSnapshots({
		storage: {
			scoreHistory: {
				query: async () => {
					throw new Error("storage unavailable");
				},
			},
		},
	} as any),
	/storage unavailable/,
	"storage failures must not be presented as an empty history",
);

const trendParagraph = (text: string, markDefs: unknown[] = [], children?: unknown[]) => ({
	_type: "block", style: "normal", markDefs, children: children ?? [{ _type: "span", text, marks: [] }],
});
const trendBody = [
	trendParagraph("", [{ _key: "guide", _type: "link", href: "/guides/planning" }], [
		{ _type: "span", text: "Read the ", marks: [] },
		{ _type: "span", text: "planning guide", marks: ["guide"] },
		{ _type: "span", text: " first.", marks: [] },
	]),
	...Array.from({ length: 60 }, () => trendParagraph("Small teams review their goals each week and keep notes.")),
];
const trendKeyword = "planning";
const alphaBaseline = score({
	ref: "posts:alpha", title: "Alpha planning", focusKeyword: trendKeyword, missingMetadata: ["title"], document: trendBody,
	capturedAt: "2026-07-10T09:00:00.000Z", sourceUpdatedAt: "2026-07-10T08:00:00.000Z",
});
const betaBaseline = score({
	ref: "posts:beta", title: "Beta planning", focusKeyword: trendKeyword, document: trendBody,
	capturedAt: "2026-07-10T10:00:00.000Z", sourceUpdatedAt: "2026-07-10T09:00:00.000Z",
});
const alphaCurrent = score({
	ref: "posts:alpha", title: "Alpha planning", focusKeyword: trendKeyword, document: trendBody,
	capturedAt: "2026-07-14T09:00:00.000Z", sourceUpdatedAt: "2026-07-14T08:00:00.000Z",
});
const betaCurrent = score({
	ref: "posts:beta", title: "Beta planning", focusKeyword: trendKeyword, missingMetadata: ["description"], document: trendBody,
	capturedAt: "2026-07-14T10:00:00.000Z", sourceUpdatedAt: "2026-07-14T09:00:00.000Z",
});
const trendSnapshots = [alphaBaseline, betaBaseline, alphaCurrent, betaCurrent].map(createScoreSnapshot);
assert.ok(trendSnapshots.every((item) => item.unscored === undefined && item.comparisonContext !== undefined),
	"a fully observed body gives numbered, comparable snapshots");
assert.ok(alphaCurrent.score > alphaBaseline.score, "adding missing title metadata improves the computed saved checks");
assert.ok(betaBaseline.score > betaCurrent.score, "removing description metadata declines the computed saved checks");
for (const item of [alphaBaseline, betaBaseline, alphaCurrent, betaCurrent]) {
	assert.equal(item.keyword, trendKeyword);
	assert.equal(item.checks.find(check => check.id === "keyword-content")?.status, "pass",
		"the saved planning-guide link supports the selected target");
	assert.equal(item.calculation?.totalWeight, 83);
}
assert.equal(alphaBaseline.calculation?.earnedWeight, 65, "missing title and keyword-in-title lose 18 of 83 points");
assert.equal(alphaBaseline.calculation?.rawScore, 78);
assert.equal(alphaBaseline.score, 49, "a missing title limits the score to 49");
assert.equal(betaCurrent.calculation?.earnedWeight, 66, "missing description and keyword-in-description lose 17 of 83 points");
assert.equal(betaCurrent.score, 80, "missing description checks decline the score without a readiness cap");
assert.equal(alphaCurrent.score, betaBaseline.score);
assert.equal(alphaCurrent.score, 100);
const trends = buildScoreTrends(trendSnapshots, {
	days: 7,
	collection: "posts",
	now: new Date("2026-07-15T12:00:00.000Z"),
});

assert.equal(trends.summary.snapshotCount, 4);
assert.equal(trends.summary.trackedEntries, 2);
assert.equal(trends.comparison.baselineAverage, Math.round((alphaBaseline.score + betaBaseline.score) / 2));
assert.equal(trends.comparison.baselineAverage, 75);
assert.equal(trends.summary.currentAverage, Math.round((alphaCurrent.score + betaCurrent.score) / 2));
assert.equal(trends.summary.currentAverage, 90);
assert.equal(trends.comparison.scoreDelta, 15);
assert.equal(trends.comparison.direction, "improved");
assert.equal(trends.summary.openIssues, 2, "description presence and keyword placement both remain unresolved");
assert.equal(trends.comparison.resolvedIssues, 2, "title presence and keyword placement improve together");
assert.equal(trends.comparison.openedIssues, 2, "description presence and keyword placement decline together");
assert.equal(trends.comparison.improvedEntries, 1);
assert.equal(trends.comparison.declinedEntries, 1);
assert.equal(trends.topIssues[0]?.id, "description");
assert.equal(trends.topIssues[0]?.status, "fail");
assert.equal(trends.changes.items.length, 2);
assert.equal(trends.points.length, 7);
assert.equal(trends.items.length, 4);

const templateSnapshot = createScoreSnapshot(first);
assert.equal(templateSnapshot.unscored, "partially-checked", "a template body shows a dash, so its snapshot is marked unscored");
assert.equal(Object.hasOwn(templateSnapshot, "comparisonContext"), false);
const withTemplateEntry = buildScoreTrends([templateSnapshot, createScoreSnapshot(betaBaseline)], {
	days: 7,
	collection: "posts",
	now: new Date("2026-07-15T12:00:00.000Z"),
});
assert.equal(withTemplateEntry.summary.snapshotCount, 2, "the dashed snapshot stays in raw history");
assert.equal(withTemplateEntry.summary.trackedEntries, 1, "the dashed snapshot is excluded from averages");
assert.equal(withTemplateEntry.summary.currentAverage, betaBaseline.score);
assert.equal(withTemplateEntry.summary.openIssues, 0, "issues of a dashed result do not count as open trend issues");
assert.ok(withTemplateEntry.points.every((point) => point.averageScore === null || point.averageScore === betaBaseline.score));

const empty = buildScoreTrends([], { days: 30, now: new Date("2026-07-15T12:00:00.000Z") });
assert.equal(empty.comparison.direction, "insufficient-data");
assert.equal(empty.summary.currentAverage, null);
assert.equal(empty.points.length, 30);

console.log("shipit-seo score history self-check passed");
