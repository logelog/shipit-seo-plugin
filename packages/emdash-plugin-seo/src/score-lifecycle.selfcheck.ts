import assert from "node:assert/strict";

import { SEO_SCORE_INPUT_IDENTITY_TAG } from "./admin-contract.ts";
import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import { LEGACY_TEMPLATE_REVISIONS_KEY, METADATA_TEMPLATES_KEY } from "./metadata-templates.ts";
import { readAdminTemplates, readStoredScoreSnapshot } from "./entry-analysis-runtime.ts";
import {
	canonicalJson,
	runManualSavedScoreLifecycle,
	runSavedScoreLifecycle,
	savedScoreLifecycleSteps,
	verifyStoredScoreFreshness,
	type SavedScoreOutcome,
} from "./score-lifecycle.ts";
import seoRuntime from "./sandbox-entry.ts";
import { acceptAnalyzedScore } from "./score-history.ts";
import { GLOBAL_SETTINGS_KEY } from "./settings-runtime.ts";

// ---- A host with the plugin's declared stores, revision-checked KV and saved drafts ----

let writes = 0;
let reads = 0;
let policyReads = 0;
let onPolicyRead: ((count: number) => void) | null = null;
const failures = new Map<string, Error>();
const failedAttempts = new Map<string, number>();
const failure = (key: string) => {
	const error = failures.get(key);
	if (error) failedAttempts.set(key, (failedAttempts.get(key) ?? 0) + 1);
	return error;
};

function matches(data: any, where: Record<string, unknown> | undefined): boolean {
	return Object.entries(where ?? {}).every(([key, condition]) => {
		if (condition === null) return data?.[key] == null;
		if (condition && typeof condition === "object" && Array.isArray((condition as any).in))
			return (condition as any).in.includes(data?.[key]);
		return data?.[key] === condition;
	});
}

function memoryCollection(name: string) {
	const records = new Map<string, any>();
	const queries: unknown[] = [];
	const api: any = {
		get: async (id: string) => {
			reads += 1;
			const error = failure(`${name}.get:${id}`);
			if (error) throw error;
			return structuredClone(records.get(id) ?? null);
		},
		put: async (id: string, value: unknown) => {
			writes += 1;
			const error = failure(`${name}.put`);
			if (error) throw error;
			records.set(id, structuredClone(value));
		},
		delete: async (id: string) => {
			writes += 1;
			return records.delete(id);
		},
		deleteMany: async (ids: string[]) => {
			writes += 1;
			let deleted = 0;
			for (const id of ids) if (records.delete(id)) deleted += 1;
			return deleted;
		},
		count: async () => records.size,
		compareAndSet: async (id: string, expected: any, next: any) => {
			writes += 1;
			const error = failure(`${name}.compareAndSet`);
			if (error) throw error;
			const present = records.has(id);
			if (expected.state === "missing" ? present : !present) return false;
			if (expected.state === "value" && JSON.stringify(records.get(id)) !== JSON.stringify(expected.value)) return false;
			if (next.action === "delete") return records.delete(id);
			records.set(id, structuredClone(next.value));
			return true;
		},
		query: async (options: any = {}) => {
			reads += 1;
			const error = failure(`${name}.query`);
			if (error) throw error;
			queries.push(structuredClone(options));
			let items = [...records.entries()].map(([id, data]) => ({ id, data: structuredClone(data) }))
				.filter((item) => matches(item.data, options.where));
			const [orderKey, direction] = Object.entries(options.orderBy ?? { id: "asc" })[0] as [string, string];
			items.sort((left: any, right: any) =>
				String(left.data[orderKey] ?? left.id).localeCompare(String(right.data[orderKey] ?? right.id)) * (direction === "desc" ? -1 : 1));
			const start = Number.parseInt(options.cursor ?? "0", 10) || 0;
			const limit = Math.min(options.limit ?? 50, 100);
			const page = items.slice(start, start + limit);
			const hasMore = start + limit < items.length;
			return { items: page, hasMore, cursor: hasMore ? String(start + limit) : undefined };
		},
	};
	return { records, queries, api };
}

const kvValues = new Map<string, { value: unknown; revision: string }>();
const malformedEnvelopes = new Set<string>();
let kvRevision = 0;
const kv = {
	get: async (key: string) => {
		reads += 1;
		const error = failure(`kv.get:${key}`);
		if (error) throw error;
		return structuredClone(kvValues.get(key)?.value ?? null);
	},
	getVersioned: async (key: string) => {
		reads += 1;
		if (key === GLOBAL_SETTINGS_KEY) onPolicyRead?.(++policyReads);
		const error = failure(`kv.getVersioned:${key}`);
		if (error) throw error;
		const entry = kvValues.get(key);
		if (entry && malformedEnvelopes.has(key)) return { value: structuredClone(entry.value) };
		return entry ? structuredClone(entry) : null;
	},
	set: async (key: string, value: unknown) => {
		writes += 1;
		kvValues.set(key, { value: structuredClone(value), revision: `r${++kvRevision}` });
	},
	delete: async (key: string) => {
		writes += 1;
		return kvValues.delete(key);
	},
	compareAndSet: async (key: string, expectedRevision: string | null, value: unknown) => {
		writes += 1;
		if ((kvValues.get(key)?.revision ?? null) !== expectedRevision) return { applied: false };
		const revision = `r${++kvRevision}`;
		kvValues.set(key, { value: structuredClone(value), revision });
		return { applied: true, revision };
	},
};
const setSetting = (key: string, value: unknown) => kvValues.set(key, { value: structuredClone(value), revision: `r${++kvRevision}` });
const settingsRecord = (contentScoringEnabled: boolean) => ({
	version: 1, updatedAt: "2026-10-01T00:00:00.000Z", siteName: "Harbour Bakery", siteUrl: "https://example.com",
	organizationName: "Harbour Bakery", organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "",
	noindex: false, contentScoringEnabled, contentScoringResourceNoticeVersion: 1,
});

const stores = Object.fromEntries([
	"analysisProfiles", "metaOverrides", "overrides", "socialOverrides", "schemas",
	"scores", "scoreHistory", "scoreAnalysisRevisions", "operationLeases",
].map((name) => [name, memoryCollection(name)]));

const span = (text: string) => ({ _type: "span", _key: `s${text.length}`, text, marks: [] });
const block = (text: string, style = "normal") => ({ _type: "block", _key: `b${style}${text.length}`, style, markDefs: [], children: [span(text)] });
const body = (word: string) => [block(`${word} at Harbour Bakery`, "h1"),
	...Array.from({ length: 6 }, (_, index) => block(`Fresh ${word} is shaped by hand every morning and baked in small batches for day ${index + 1}.`))];

const entries = new Map<string, any>();
const revisions = new Map<string, any>();
let contentGets = 0;
let onContentGet: ((count: number) => void) | null = null;
function entry(id: string, keyword: string, extra: Record<string, unknown> = {}) {
	entries.set(id, {
		id, type: "posts", slug: `${id}-loaf`, status: "published", locale: "en", version: 1,
		draftRevisionId: null, liveRevisionId: `live-${id}`, updatedAt: "2026-10-01T10:00:00.000Z",
		seo: { title: null, description: null, canonical: null, image: null, noIndex: false },
		data: { title: `${keyword} baked every morning by hand`, excerpt: "Fresh sourdough and pastries baked every morning at Harbour Bakery, shaped by hand and sold the same day.", content: body(keyword), focus_keyword: keyword },
		...extra,
	});
}
function saveContent(id: string, data: Record<string, unknown>) {
	const row = entries.get(id);
	row.data = { ...row.data, ...data };
	row.version += 1;
	row.updatedAt = new Date(Date.parse(row.updatedAt) + 60_000).toISOString();
}
function saveDraft(id: string, data: Record<string, unknown>) {
	const row = entries.get(id);
	const revisionId = `draft-${id}-${row.version + 1}`;
	revisions.set(revisionId, { id: revisionId, collection: "posts", entryId: id, data: { ...row.data, ...data } });
	row.draftRevisionId = revisionId;
	row.version += 1;
}

const collections: any[] = [
	{ slug: "posts", label: "Posts", labelSingular: "Post", hasSeo: true, urlPattern: "/posts/{slug}", routable: true, hidden: false,
		fields: [{ slug: "content", type: "portableText" }] },
	{ slug: "pages", label: "Pages", labelSingular: "Page", hasSeo: true, urlPattern: "/{slug}", routable: true, hidden: false,
		fields: [{ slug: "content", type: "portableText" }] },
];
const site: Record<string, unknown> = { name: "Harbour Bakery", url: "https://example.com", locale: "en" };
const warnings: unknown[] = [];
const ctx: any = {
	plugin: { id: "shipit-seo", version: "test" },
	site,
	url: (path: string) => `https://example.com${path}`,
	kv,
	storage: Object.fromEntries(Object.entries(stores).map(([name, store]) => [name, store.api])),
	schema: { listCollections: async () => {
		reads += 1;
		return structuredClone(collections);
	} },
	content: {
		get: async (collection: string, id: string) => {
			reads += 1;
			contentGets += 1;
			onContentGet?.(contentGets);
			return collection === "posts" && entries.has(id) ? structuredClone(entries.get(id)) : null;
		},
		getRevision: async (collection: string, id: string, revisionId: string) => {
			reads += 1;
			const revision = revisions.get(revisionId);
			return revision && revision.collection === collection && revision.entryId === id ? structuredClone(revision) : null;
		},
		getPublicUrl: async (collection: string, id: string) => {
			reads += 1;
			const row = entries.get(id);
			return collection === "posts" && row?.status === "published" ? `https://example.com/posts/${row.slug}` : null;
		},
	},
	log: { warn: (...args: unknown[]) => warnings.push(args), info() {}, error() {}, debug() {} },
};

// Analyzer runs are counted through the lifecycle's step parameter, not a global hook.
let analyzerRuns = 0;
const countingSteps = {
	analyze: (...args: Parameters<typeof savedScoreLifecycleSteps.analyze>) => {
		analyzerRuns += 1;
		return savedScoreLifecycleSteps.analyze(...args);
	},
};
const measured = async (action: () => Promise<SavedScoreOutcome>) => {
	const [readsBefore, writesBefore, analyzedBefore] = [reads, writes, analyzerRuns];
	const value = await action();
	return { value, reads: reads - readsBefore, writes: writes - writesBefore, analyzed: analyzerRuns - analyzedBefore };
};
const run = (id: string, extra: Record<string, unknown> = {}) =>
	measured(() => runSavedScoreLifecycle(ctx, { collection: "posts", id, locale: "en", ...extra }, countingSteps));
const stored = (id: string) => stores.scores.records.get(`posts:${id}`);
const historyFor = (id: string) => [...stores.scoreHistory.records.values()].filter((item) => item.ref === `posts:${id}`);
const report: Record<string, unknown> = {};

setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(true));
setSetting("configuration:analysis-profile:v1:posts", { version: 1, profile: "article", updatedAt: "2026-10-15T00:00:00.000Z" });

// ---- First score and strict reuse ----

entry("first", "sourdough");
const firstRun = await run("first");
assert.equal(firstRun.value.status, "saved");
assert.equal(firstRun.analyzed, 1);
assert.equal(firstRun.value.status === "saved" && firstRun.value.history, "created");
const firstStored = stored("first");
assert.match(firstStored.inputIdentity, new RegExp(`^${SEO_SCORE_INPUT_IDENTITY_TAG}-sha256-[0-9a-f]{64}$`));
assert.equal(firstStored.sourceVersion, savedContentVersion(entries.get("first")));
assert.equal(firstStored.analysisRevision, 1);
assert.equal(historyFor("first").length, 1);
report.firstScore = { reads: firstRun.reads, writes: firstRun.writes };

const reuseRun = await run("first");
assert.equal(reuseRun.value.status, "reused");
assert.equal(reuseRun.analyzed, 0, "the identity comparison never runs the analyzer");
assert.equal(reuseRun.writes, 0, "unchanged inputs reserve nothing and write no score, history or profile");
assert.equal(reuseRun.value.status === "reused" && reuseRun.value.score.updatedAt, firstStored.updatedAt, "the stored result is returned, not recomputed");
assert.equal(stores.scoreAnalysisRevisions.records.get("posts:first").revision, 1, "no revision was reserved");
assert.equal(historyFor("first").length, 1);
assert.ok(reuseRun.reads > 0, "the identity comparison reads its inputs");
report.unchangedReuse = { reads: reuseRun.reads, writes: reuseRun.writes, analyzerRuns: reuseRun.analyzed };

// An old stored score without an identity stays readable but is never strictly reused.
const { inputIdentity: _identity, ...withoutIdentity } = firstStored;
stores.scores.records.set("posts:first", withoutIdentity);
assert.equal((await readStoredScoreSnapshot(ctx, "posts:first"))?.ref, "posts:first", "the old record stays readable");
const oldRecordRun = await run("first");
assert.equal(oldRecordRun.value.status, "saved", "an old record without identity is recomputed");
assert.ok(stored("first").inputIdentity);

// ---- Changed saved source ----

saveContent("first", { excerpt: "A changed saved excerpt describing the morning bake at Harbour Bakery in more detail." });
const changedRun = await run("first");
assert.equal(changedRun.value.status, "saved");
assert.equal(changedRun.analyzed, 1);
assert.equal(stored("first").sourceVersion, savedContentVersion(entries.get("first")));
assert.notEqual(stored("first").inputIdentity, firstStored.inputIdentity);
report.changedSource = { reads: changedRun.reads, writes: changedRun.writes };

// ---- Saved drafts: keywords and slug come from the hydrated draft ----

entry("drafted", "live loaf");
const draftUpdatedAt = entries.get("drafted").updatedAt;
saveDraft("drafted", { focus_keyword: "draft loaf", _slug: "draft-slug" });
assert.equal(entries.get("drafted").updatedAt, draftUpdatedAt, "control: a draft save keeps updatedAt");
const draftRun = await run("drafted");
assert.equal(draftRun.value.status, "saved");
assert.deepEqual([stored("drafted").keywords, stored("drafted").focusKeywordSource, stored("drafted").slug], [["draft loaf"], "content", "draft-slug"]);
saveDraft("drafted", { focus_keyword: "second draft loaf", _slug: "draft-slug" });
assert.equal((await run("drafted")).value.status, "saved", "a draft save with an unchanged timestamp is a changed source");
assert.deepEqual(stored("drafted").keywords, ["second draft loaf"]);

// Policy acknowledgement and revision are admission data, not content changes.
setSetting(GLOBAL_SETTINGS_KEY, { ...settingsRecord(false), updatedAt: "2026-10-15T01:00:00.000Z" });
assert.equal(await verifyStoredScoreFreshness(ctx, stored("first")), "current", "pausing preserves semantic score freshness");
setSetting(GLOBAL_SETTINGS_KEY, { ...settingsRecord(true), updatedAt: "2026-10-15T02:00:00.000Z" });
const reactivatedReuse = await run("first");
assert.deepEqual([reactivatedReuse.value.status, reactivatedReuse.analyzed, reactivatedReuse.writes], ["reused", 0, 0]);
// Archive-only restrictions do not change a saved post's analysis inputs.
const archiveScoreBefore = structuredClone(stored("first"));
const archiveHistoryBefore = structuredClone(historyFor("first"));
const archiveReservationBefore = structuredClone(stores.scoreAnalysisRevisions.records.get("posts:first"));
assert.equal(Object.hasOwn(kvValues.get(GLOBAL_SETTINGS_KEY)!.value as object, "taxonomyArchiveNoindex"), false);
const archiveReuseMeasurements: Array<{ reads: number; writes: number; analyzed: number }> = [];
for (const taxonomyArchiveNoindex of [["category"], ["custom_type", "tag"], [], undefined]) {
	const previousRevision = kvValues.get(GLOBAL_SETTINGS_KEY)!.revision;
	setSetting(GLOBAL_SETTINGS_KEY, {
		...settingsRecord(true), updatedAt: "2026-10-15T02:30:00.000Z",
		...(taxonomyArchiveNoindex === undefined ? {} : { taxonomyArchiveNoindex }),
	});
	assert.notEqual(kvValues.get(GLOBAL_SETTINGS_KEY)!.revision, previousRevision,
		"control: each archive policy save changes the global record revision");
	assert.equal(Object.hasOwn(kvValues.get(GLOBAL_SETTINGS_KEY)!.value as object, "taxonomyArchiveNoindex"), taxonomyArchiveNoindex !== undefined);
	assert.equal(await verifyStoredScoreFreshness(ctx, stored("first")), "current",
		"adding, changing, clearing or omitting archive restrictions keeps post analysis current");
	const archiveReuse = await run("first");
	assert.deepEqual([archiveReuse.value.status, archiveReuse.analyzed, archiveReuse.writes], ["reused", 0, 0]);
	assert.equal(archiveReuse.value.status === "reused" && archiveReuse.value.history, "not-attempted");
	assert.deepEqual(stored("first"), archiveScoreBefore, "archive selection does not replace a saved post score or identity");
	assert.deepEqual(historyFor("first"), archiveHistoryBefore, "archive selection adds no post history");
	assert.deepEqual(stores.scoreAnalysisRevisions.records.get("posts:first"), archiveReservationBefore,
		"archive selection reserves no analysis revision");
	archiveReuseMeasurements.push({ reads: archiveReuse.reads, writes: archiveReuse.writes, analyzed: archiveReuse.analyzed });
}
report.archivePolicyReuse = archiveReuseMeasurements;
// Content type rules change a saved analysis only for the type they name.
const typeScoreBefore = structuredClone(stored("first"));
for (const contentTypeNoindex of [["pages"], [], undefined, ["events", "pages"]]) {
	setSetting(GLOBAL_SETTINGS_KEY, {
		...settingsRecord(true), updatedAt: "2026-10-15T02:40:00.000Z",
		...(contentTypeNoindex === undefined ? {} : { contentTypeNoindex }),
	});
	assert.equal(await verifyStoredScoreFreshness(ctx, stored("first")), "current",
		"a rule for other types, an empty list or no field keeps post analysis current");
	const typeReuse = await run("first");
	assert.deepEqual([typeReuse.value.status, typeReuse.analyzed, typeReuse.writes], ["reused", 0, 0]);
	assert.deepEqual(stored("first"), typeScoreBefore);
}
setSetting(GLOBAL_SETTINGS_KEY, { ...settingsRecord(true), updatedAt: "2026-10-15T02:45:00.000Z", contentTypeNoindex: ["posts"] });
assert.equal(await verifyStoredScoreFreshness(ctx, stored("first")), "stale", "a rule naming posts changes a saved post's analysis inputs");
assert.deepEqual(stored("first"), typeScoreBefore, "checking freshness writes nothing");
setSetting(GLOBAL_SETTINGS_KEY, { ...settingsRecord(true), updatedAt: "2026-10-15T02:50:00.000Z" });
assert.equal(await verifyStoredScoreFreshness(ctx, stored("first")), "current", "removing the rule restores the earlier inputs");

const profileKey = "configuration:analysis-profile:v1:posts";
const originalCollectionProfile = structuredClone(kvValues.get(profileKey)!);
setSetting(profileKey, { version: 1, profile: "article", updatedAt: "2026-10-15T03:00:00.000Z" });
const sameProfileReuse = await run("first");
assert.deepEqual([sameProfileReuse.value.status, sameProfileReuse.analyzed, sameProfileReuse.writes], ["reused", 0, 0],
	"saving the same semantic profile does not force reanalysis");
kvValues.set(profileKey, originalCollectionProfile);

entry("assessment-race", "rye");
const profileRaceGets = contentGets;
onContentGet = (count) => {
	if (count === profileRaceGets + 1)
		setSetting(profileKey, { version: 1, profile: "article", updatedAt: "2026-10-15T04:00:00.000Z" });
};
const profileRace = await run("assessment-race");
onContentGet = null;
assert.deepEqual(profileRace.value, { status: "superseded", reason: "inputs-changed" });
assert.equal(stored("assessment-race"), undefined, "a concurrent profile revision cannot persist a score");
assert.equal(historyFor("assessment-race").length, 0);
kvValues.set(profileKey, originalCollectionProfile);

// ---- Keyword profile add, change, clear, explicit empty and pillar ----

entry("profiled", "crust");
const profile = (keywords: string[] | null, pillar = false) => stores.analysisProfiles.records.set("posts:profiled", {
	storageVersion: 4, ref: "posts:profiled", keyword: keywords?.[0] ?? "", keywords, pillar, updatedAt: new Date().toISOString(),
});
assert.equal((await run("profiled")).value.status, "saved");
assert.deepEqual([stored("profiled").keywords, stored("profiled").focusKeywordSource], [["crust"], "content"]);
profile(["alpha", "beta"]);
assert.equal((await run("profiled")).value.status, "saved", "an added profile keyword changes the identity");
assert.deepEqual([stored("profiled").keywords, stored("profiled").focusKeywordSource, stored("profiled").profileKeywords], [["alpha", "beta"], "profile", ["alpha", "beta"]]);
profile(["gamma"]);
assert.equal((await run("profiled")).value.status, "saved");
assert.deepEqual(stored("profiled").keywords, ["gamma"]);
profile([]);
assert.equal((await run("profiled")).value.status, "saved");
assert.deepEqual([stored("profiled").keywords, stored("profiled").focusKeywordSource, stored("profiled").profileKeywords], [[], "none", []],
	"an explicit empty statement suppresses the content keyword");
profile(null, true);
assert.equal((await run("profiled")).value.status, "saved");
assert.deepEqual([stored("profiled").keywords, stored("profiled").focusKeywordSource, stored("profiled").profileKeywords, stored("profiled").pillar],
	[["crust"], "content", null, true], "no statement inherits the content keyword and keeps the saved pillar");
assert.equal((await run("profiled")).value.status, "reused");
// A legacy v3 profile is read with its meaning and never migrated by reuse or analysis.
stores.analysisProfiles.records.set("posts:profiled", { storageVersion: 3, ref: "posts:profiled", keyword: "legacy", keywords: ["legacy"], pillar: false, updatedAt: "2026-01-01T00:00:00.000Z" });
assert.equal((await run("profiled")).value.status, "saved");
assert.deepEqual(stored("profiled").keywords, ["legacy"]);
const legacyReuse = await run("profiled");
assert.deepEqual([legacyReuse.value.status, legacyReuse.writes, stores.analysisProfiles.records.get("posts:profiled").storageVersion], ["reused", 0, 3]);

// ---- Exact entry and locale ----

const localeRun = await run("first", { locale: "fr" });
assert.deepEqual([localeRun.value.status, localeRun.writes, localeRun.analyzed], ["locale-mismatch", 0, 0]);
const missingRun = await run("missing");
assert.equal(missingRun.value.status, "not-found");
assert.deepEqual([stored("missing"), historyFor("missing").length], [undefined, 0], "only the revision is reserved before the read");

// ---- Inputs and reservations that change during analysis ----

entry("raced", "rye");
assert.equal((await run("raced")).value.status, "saved");
saveContent("raced", { excerpt: "Rye bread baked slowly with a long fermentation at Harbour Bakery every single morning." });
const getsBeforeRace = contentGets;
onContentGet = (count) => {
	if (count === getsBeforeRace + 3) profileForRaced();
};
const profileForRaced = () => stores.analysisProfiles.records.set("posts:raced", {
	storageVersion: 4, ref: "posts:raced", keyword: "changed", keywords: ["changed"], pillar: false, updatedAt: new Date().toISOString(),
});
const racedBefore = structuredClone(stored("raced"));
const inputsChanged = await run("raced");
onContentGet = null;
assert.deepEqual(inputsChanged.value, { status: "superseded", reason: "inputs-changed" });
assert.equal(inputsChanged.analyzed, 1, "an admitted entry finishes computing before the recheck refuses it");
assert.deepEqual(stored("raced"), racedBefore, "a result whose inputs changed before persistence is not saved");

// The fixture bumps the stored reservation before persistence; this checks the
// reservation guard, not two overlapping lifecycle operations.
saveContent("raced", { excerpt: "Rye bread again, with a different saved description for the reservation race check." });
const getsBeforeReservation = contentGets;
onContentGet = (count) => {
	if (count !== getsBeforeReservation + 3) return;
	const record = stores.scoreAnalysisRevisions.records.get("posts:raced");
	stores.scoreAnalysisRevisions.records.set("posts:raced", { ...record, revision: record.revision + 1 });
};
const newerReservation = await run("raced");
onContentGet = null;
assert.deepEqual(newerReservation.value, { status: "superseded", reason: "reservation-superseded" });

const newerResult = structuredClone(stored("raced"));
stores.scores.records.set("posts:raced", { ...newerResult, sourceUpdatedAt: "2999-01-01T00:00:00.000Z" });
const olderSource = await run("raced");
assert.deepEqual(olderSource.value, { status: "superseded", reason: "newer-result" }, "a refused persistence is never a saved score");
stores.scores.records.set("posts:raced", newerResult);

failures.set("scores.compareAndSet", new Error("write response lost"));
const uncertainRun = await run("raced");
failures.delete("scores.compareAndSet");
assert.equal(uncertainRun.value.status, "uncertain", "a failed conditional score write is uncertain, not saved");

// Failures before any score write are failures; after one the outcome stays uncertain.
entry("prewrite", "farl");
const getsBeforePersistence = contentGets;
onContentGet = (count) => {
	if (count === getsBeforePersistence + 3) throw new Error("database is locked");
};
const prewriteFailure = await run("prewrite");
onContentGet = null;
assert.deepEqual([prewriteFailure.value.status, prewriteFailure.analyzed], ["failed", 1],
	"a source read that fails before the score write is a failure, not uncertain");
assert.deepEqual([stored("prewrite"), historyFor("prewrite").length], [undefined, 0]);
entry("landed", "cob");
const landedCompareAndSet = stores.scores.api.compareAndSet;
stores.scores.api.compareAndSet = async (id: string, expected: any, next: any) => {
	const applied = await landedCompareAndSet(id, expected, next);
	if (applied && next.action === "put") failures.set("scoreAnalysisRevisions.get:posts:landed", new Error("reservation read failed"));
	return applied;
};
const afterLanded = await run("landed");
stores.scores.api.compareAndSet = landedCompareAndSet;
failures.delete("scoreAnalysisRevisions.get:posts:landed");
assert.equal(afterLanded.value.status, "uncertain", "a read that fails after a landed score write stays uncertain");

// ---- History outcomes after an accepted score ----

// The fixture history put throws before storing anything; the engine cannot
// tell, so it reports uncertain. Landed writes with lost responses are covered
// by the score history selfcheck.
entry("history", "barley");
failures.set("scoreHistory.put", new Error("history connection reset"));
const historyUncertain = await run("history");
failures.delete("scoreHistory.put");
assert.equal(historyUncertain.value.status, "saved", "the accepted score stays saved");
assert.equal(historyUncertain.value.status === "saved" && historyUncertain.value.history, "uncertain");
assert.equal(stored("history").analysisRevision, 1);
const historyReuse = await run("history");
assert.deepEqual([historyReuse.value.status, historyReuse.writes], ["reused", 0], "reuse performs no history repair write");
entry("history-failed", "malt");
failures.set("scoreHistory.query", new Error("history storage offline"));
const historyFailed = await run("history-failed");
failures.delete("scoreHistory.query");
assert.deepEqual([historyFailed.value.status, historyFailed.value.status === "saved" && historyFailed.value.history], ["saved", "failed"],
	"a history failure before its write keeps the score saved with a separate failed history outcome");
assert.equal(stored("history-failed")?.analysisRevision, 1);

// ---- Scoring policy ----

entry("policy", "oat");
const contentBeforePending = contentGets;
const pendingRecord = { ...settingsRecord(true), contentScoringResourceNoticeVersion: undefined };
setSetting(GLOBAL_SETTINGS_KEY, pendingRecord);
const pendingRun = await run("policy");
assert.deepEqual([pendingRun.value.status, pendingRun.writes, pendingRun.analyzed, contentGets], ["activation_required", 0, 0, contentBeforePending]);
setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(true));
const selectedProfile = kvValues.get("configuration:analysis-profile:v1:posts")!;
kvValues.delete("configuration:analysis-profile:v1:posts");
const profileRequiredRun = await run("policy");
assert.deepEqual([profileRequiredRun.value.status, profileRequiredRun.writes, profileRequiredRun.analyzed, contentGets], ["profile_required", 0, 0, contentBeforePending]);
kvValues.set("configuration:analysis-profile:v1:posts", selectedProfile);
setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(false));
const offRun = await run("policy");
assert.deepEqual([offRun.value.status, offRun.writes, offRun.analyzed], ["disabled", 0, 0]);
assert.equal(stored("policy"), undefined);
assert.equal((await readStoredScoreSnapshot(ctx, "posts:first"))?.ref, "posts:first", "stored scores stay readable while scoring is off");
setSetting(GLOBAL_SETTINGS_KEY, { version: 1, contentScoringEnabled: true });
const corruptRun = await run("policy");
assert.deepEqual([corruptRun.value.status, corruptRun.writes], ["unavailable", 0], "a corrupt policy admits no analysis");
assert.equal(corruptRun.value.status === "unavailable" && corruptRun.value.reason, "policy");
setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(true));
failures.set(`kv.getVersioned:${GLOBAL_SETTINGS_KEY}`, new Error("database is locked"));
const unreadablePolicy = await run("policy");
failures.delete(`kv.getVersioned:${GLOBAL_SETTINGS_KEY}`);
assert.deepEqual([unreadablePolicy.value.status, unreadablePolicy.writes], ["unavailable", 0]);
assert.equal((await run("policy")).value.status, "saved", "control: a readable enabled record admits analysis");

// Off then on during one admitted operation refuses it: seen by the input
// recheck while capturing, or by the policy revision just before persistence.
saveContent("policy", { excerpt: "Oat bread with a changed saved excerpt for the off and on policy race at Harbour Bakery." });
const policyBefore = structuredClone(stored("policy"));
const getsBeforeToggle = contentGets;
onContentGet = (count) => {
	if (count !== getsBeforeToggle + 3) return;
	setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(false));
	setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(true));
};
const toggledDuringCapture = await run("policy");
onContentGet = null;
assert.deepEqual(toggledDuringCapture.value, { status: "superseded", reason: "policy-changed" });
// Admission, probe, snapshot and recheck read the policy record; the fifth read is persistence.
const toggleBeforePersistence = (change: () => void) => {
	policyReads = 0;
	onPolicyRead = (count) => {
		if (count === 5) change();
	};
};
toggleBeforePersistence(() => {
	setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(false));
	setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(true));
});
const toggled = await run("policy");
onPolicyRead = null;
assert.deepEqual(toggled.value, { status: "superseded", reason: "policy-changed" });
assert.deepEqual(stored("policy"), policyBefore, "an operation admitted before off/on is not saved");
assert.equal(historyFor("policy").length, 1);
toggleBeforePersistence(() => setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(false)));
const turnedOff = await run("policy");
onPolicyRead = null;
assert.deepEqual(turnedOff.value, { status: "disabled" }, "an admitted entry may finish computing but is not saved once off");
assert.equal(turnedOff.analyzed, 1);
assert.deepEqual(stored("policy"), policyBefore);
setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(true));

// ---- Unreadable configuration is a barrier, even when a reader swallows the failure ----

entry("offline", "spelt");
assert.notEqual((await run("first")).value.status, "unavailable", "control: a baseline under the current configuration");
assert.equal((await run("first")).value.status, "reused");
failures.set(`kv.getVersioned:${METADATA_TEMPLATES_KEY}`, new Error("templates storage offline"));
const offlineRun = await run("offline");
assert.equal(offlineRun.value.status, "unavailable");
assert.equal(offlineRun.value.status === "unavailable" && offlineRun.value.reason, "configuration");
assert.equal(stored("offline"), undefined);
assert.equal(historyFor("offline").length, 0);
const reuseBlocked = await run("first");
assert.deepEqual([reuseBlocked.value.status, reuseBlocked.writes], ["unavailable", 0], "unknown configuration never qualifies for strict reuse");
failures.delete(`kv.getVersioned:${METADATA_TEMPLATES_KEY}`);
assert.equal((await run("offline")).value.status, "saved", "control: readable templates allow the same entry");
assert.equal((await run("first")).value.status, "reused");

// ---- An unreadable stored score is refused, never deleted ----

const keptScore = structuredClone(stored("first"));
failures.set("scores.get:posts:first", new SyntaxError("Bad control character in string literal in JSON"));
const unreadableScore = await run("first");
failures.delete("scores.get:posts:first");
assert.deepEqual([unreadableScore.value.status, unreadableScore.writes], ["unavailable", 0]);
assert.equal(unreadableScore.value.status === "unavailable" && unreadableScore.value.reason, "storage");
assert.deepEqual(stored("first"), keptScore);
assert.equal((await run("first")).value.status, "reused", "the preserved score is reused on retry");

// ---- Site values: one clone per capture ----

entry("site", "brioche");
setSetting(GLOBAL_SETTINGS_KEY, { ...settingsRecord(true), siteName: "", organizationName: "", siteUrl: "" });
assert.equal((await run("site")).value.status, "saved");
site.name = "Harbour Bakery and Cafe";
assert.equal((await run("site")).value.status, "saved", "an inherited site name is part of the identity");
const siteBefore = structuredClone(stored("site"));
const getsBeforeRename = contentGets;
onContentGet = (count) => {
	if (count === getsBeforeRename + 2) site.name = "Renamed during analysis";
};
saveContent("site", { excerpt: "Brioche with a changed saved excerpt while the shared site name changes mid analysis." });
const renamed = await run("site");
onContentGet = null;
assert.deepEqual(renamed.value, { status: "superseded", reason: "inputs-changed" }, "a site change during analysis is never saved under the older name");
assert.deepEqual(stored("site"), siteBefore);
// The shared site object changes after a capture cloned it and is restored before
// the recheck; every reader of that capture must use the clone the identity hashed.
saveContent("site", { excerpt: "Brioche saved again so the clone check reaches analysis instead of reuse." });
const capturedSiteName = site.name;
const getsBeforeClone = contentGets;
onContentGet = (count) => {
	if (count === getsBeforeClone + 2) site.name = "Renamed after the clone";
};
const cloneRename = await measured(() => runSavedScoreLifecycle(ctx, { collection: "posts", id: "site", locale: "en" }, {
	analyze: async (captured, revision) => {
		site.name = capturedSiteName;
		return savedScoreLifecycleSteps.analyze(captured, revision);
	},
}));
onContentGet = null;
assert.equal(cloneRename.value.status, "saved");
assert.equal(JSON.stringify(stored("site")).includes("Renamed after the clone"), false, "readers used the site values the identity hashed");
assert.ok(JSON.stringify(stored("site")).includes(String(capturedSiteName)), "control: the captured site name reaches the result");
setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(true));

// ---- Templates: only this collection's template and score token ----

entry("templated", "rye roll");
assert.equal(kvValues.has(METADATA_TEMPLATES_KEY), false, "control: no template record has been saved yet");
assert.equal((await run("templated")).value.status, "saved");
const pagesLegacyKeys = ["kv.getVersioned:tpl:pages:title", "kv.get:tpl:pages:title"];
for (const key of pagesLegacyKeys) failures.set(key, new Error("legacy pages key offline"));
const attempts = () => pagesLegacyKeys.reduce((sum, key) => sum + (failedAttempts.get(key) ?? 0), 0);
const unrelatedLegacyFailure = await run("templated");
assert.deepEqual([unrelatedLegacyFailure.value.status, unrelatedLegacyFailure.writes, attempts()], ["reused", 0, 0],
	"another collection's unreadable legacy key is never read for this entry");
await readAdminTemplates(ctx).catch(() => null);
assert.ok(attempts() > 0, "control: the all-collection template reader does read that failing key");
for (const key of pagesLegacyKeys) failures.delete(key);
const templateRoute = (name: string, input: unknown) => (seoRuntime as any).routes[name].handler({ input }, ctx);
const pagesTemplateSave = async (title: string) => {
	const state = await templateRoute("admin-templates", {});
	const pages = state.items.find((item: any) => item.collection === "pages");
	const result = await templateRoute("save-admin-templates", {
		collection: "pages", expectedRevision: state.revision, inheritanceGuard: pages.inheritanceGuard,
		values: { title, description: "{{description}}", socialTitle: "", socialDescription: "" },
	});
	assert.equal(result.success, true, JSON.stringify(result));
};
await pagesTemplateSave("{{title}} | Pages");
assert.equal(kvValues.has(METADATA_TEMPLATES_KEY), true, "control: the first unrelated save created the shared record");
const afterUnrelatedTemplate = await run("templated");
assert.deepEqual([afterUnrelatedTemplate.value.status, afterUnrelatedTemplate.writes], ["reused", 0],
	"another collection's first template save leaves this entry's inputs unchanged");
await pagesTemplateSave("{{title}} | More pages");
assert.equal((await run("templated")).value.status, "reused");
collections[1] = { ...collections[1], label: "Site pages", fields: [...collections[1].fields, { slug: "summary", type: "string" }] };
const unrelatedDefinition = await run("templated");
assert.deepEqual([unrelatedDefinition.value.status, unrelatedDefinition.writes], ["reused", 0],
	"another collection's label and fields are not inputs of this entry");
collections[0] = { ...collections[0], urlPattern: "/journal/{slug}" };
assert.equal((await run("templated")).value.status, "saved", "this collection's URL definition is an input");

// A template record that reads but cannot be decoded leaves the template unknown.
entry("unknown-template", "bagel");
const savedTemplates = kvValues.get(METADATA_TEMPLATES_KEY)!;
const refusedTemplate = async (label: string) => {
	const result = await run("unknown-template");
	assert.deepEqual([result.value.status, result.value.status === "unavailable" && result.value.reason], ["unavailable", "configuration"], label);
	assert.deepEqual([stored("unknown-template"), historyFor("unknown-template").length], [undefined, 0], `${label}: no score or history`);
	assert.equal((await run("templated")).value.status, "unavailable", `${label}: no strict reuse either`);
};
kvValues.set(METADATA_TEMPLATES_KEY, { value: { version: 1, values: "not templates" }, revision: savedTemplates.revision });
await refusedTemplate("a corrupt template record");
kvValues.set(METADATA_TEMPLATES_KEY, savedTemplates);
malformedEnvelopes.add(METADATA_TEMPLATES_KEY);
await refusedTemplate("a template envelope without a revision");
malformedEnvelopes.delete(METADATA_TEMPLATES_KEY);
kvValues.delete(METADATA_TEMPLATES_KEY);
setSetting(LEGACY_TEMPLATE_REVISIONS_KEY, {
	collectionUpdatedAt: Object.fromEntries(Array.from({ length: 1_001 }, (_, index) => [`collection-${index}`, `r${index}`])),
});
await refusedTemplate("an oversized legacy template token map");
kvValues.delete(LEGACY_TEMPLATE_REVISIONS_KEY);
kvValues.set(METADATA_TEMPLATES_KEY, savedTemplates);
assert.equal((await run("unknown-template")).value.status, "saved", "control: a readable template record");
assert.equal((await run("templated")).value.status, "reused");

// ---- Custom schemas: only this entry's scoped queries ----

entry("schema", "focaccia");
assert.equal((await run("schema")).value.status, "saved");
stores.schemas.queries.length = 0;
stores.schemas.records.set("other-entry", { storageVersion: 1, name: "Other entry", scope: "posts:another", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Other" }), enabled: true, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
const unrelatedSchema = await run("schema");
assert.deepEqual([unrelatedSchema.value.status, unrelatedSchema.writes], ["reused", 0], "another entry's schema does not affect this identity");
assert.ok(stores.schemas.queries.length > 0 && stores.schemas.queries.every((query: any) =>
	query.cursor === undefined && (canonicalJson(query.where) === canonicalJson({ scope: null }) ||
		canonicalJson(query.where) === canonicalJson({ scope: { in: ["global", "posts", "posts:schema", "posts:schema-loaf", ""] } }))),
	JSON.stringify(stores.schemas.queries));
// ---- Stored freshness verification: read-only, per returned row ----

const verify = async (id: string) => {
	const [readsBefore, writesBefore, analyzedBefore] = [reads, writes, analyzerRuns];
	const freshness = await verifyStoredScoreFreshness(ctx, structuredClone(stored(id)));
	return { freshness, reads: reads - readsBefore, writes: writes - writesBefore, analyzed: analyzerRuns - analyzedBefore };
};
const currentVerification = await verify("schema");
assert.deepEqual([currentVerification.freshness, currentVerification.writes, currentVerification.analyzed], ["current", 0, 0]);
report.storedFreshnessVerification = { reads: currentVerification.reads, writes: currentVerification.writes };
stores.schemas.records.set("other-entry-2", { storageVersion: 1, name: "Other entry two", scope: "posts:another", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Event", name: "Other" }), enabled: true, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
assert.equal((await verify("schema")).freshness, "current", "another entry's schema leaves this stored score current");
failures.set(`kv.getVersioned:${METADATA_TEMPLATES_KEY}`, new Error("templates storage offline"));
await assert.rejects(verify("schema"), /could not be read/, "unknown inputs fail visibly, never current or stale");
failures.delete(`kv.getVersioned:${METADATA_TEMPLATES_KEY}`);
const { inputIdentity: _schemaIdentity, ...untagged } = stored("schema");
assert.equal(await verifyStoredScoreFreshness(ctx, untagged), "stale", "a record without an input identity is never verified current");
assert.equal(await verifyStoredScoreFreshness(ctx, { ...stored("schema"), scoreVersion: stored("schema").scoreVersion - 1 }), "stale");
assert.equal(await verifyStoredScoreFreshness(ctx, { ...stored("schema"), templateUpdatedAt: "unreadable-templates" }), "stale",
	"a score recorded while templates were unreadable is never verified current");
entry("deleted", "pretzel");
assert.equal((await run("deleted")).value.status, "saved");
const deletedScore = structuredClone(stored("deleted"));
entries.delete("deleted");
assert.equal(await verifyStoredScoreFreshness(ctx, deletedScore), "stale", "a deleted entry's stored score is stale");

stores.schemas.records.set("collection-wide", { storageVersion: 1, name: "Posts", scope: "posts", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "{{title}}" }), enabled: true, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
const relevantVerification = await verify("schema");
assert.deepEqual([relevantVerification.freshness, relevantVerification.writes], ["stale", 0], "a schema in this entry's scope makes it stale");
assert.equal((await run("schema")).value.status, "saved", "a schema in this entry's scope changes the identity");
assert.equal((await verify("schema")).freshness, "current");
saveContent("schema", { excerpt: "Focaccia with a changed saved excerpt after its last stored analysis at Harbour Bakery." });
assert.equal((await verify("schema")).freshness, "stale", "a changed saved source makes the stored score stale");

// The scoped rule query is capped at 100 matching rows, disabled rules included;
// one more refuses analysis instead of reading a partial list.
entry("crowded", "ciabatta");
const crowdedRules = Array.from({ length: 101 }, (_, index) => `crowded-${index}`);
for (const id of crowdedRules) stores.schemas.records.set(id, { storageVersion: 1, name: id, scope: "global", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", name: id }), enabled: false, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
stores.schemas.records.delete("collection-wide");
const crowded = await run("crowded");
assert.equal(crowded.value.status, "failed", "101 matching rules refuse analysis");
assert.deepEqual([stored("crowded"), historyFor("crowded").length, crowded.analyzed], [undefined, 0, 0]);
stores.schemas.records.delete(crowdedRules[0]);
assert.equal((await run("crowded")).value.status, "saved", "control: 100 matching rules are read and analyzed");
for (const id of crowdedRules) stores.schemas.records.delete(id);

// ---- Save hook payloads only identify and gate the reread ----

const hook = (eventContent: any) => measured(() => runSavedScoreLifecycle(ctx, {
	collection: "posts", id: eventContent.id, locale: eventContent.locale,
	gate: (current) => savedContentVersion(current) === savedContentVersion(eventContent),
}));
const staleEvent = structuredClone(entries.get("first"));
saveContent("first", { excerpt: "A newer save after the event payload was taken, so the event is out of date now." });
const staleHook = await hook(staleEvent);
assert.deepEqual([staleHook.value, staleHook.writes], [{ status: "superseded", reason: "source-changed" }, 0]);
const currentEvent = { ...structuredClone(entries.get("first")), data: { ...entries.get("first").data, title: "Event body that is never analyzed" } };
const currentHook = await hook(currentEvent);
assert.equal(currentHook.value.status, "saved");
assert.notEqual(stored("first").title, "Event body that is never analyzed", "analysis rereads the saved row, not the event body");

// Control: a read outside the captured inputs that a reader swallows still fails the analysis.
const outsideWarning = (warning: unknown) =>
	String(((warning as unknown[])[1] as { error?: unknown } | undefined)?.error ?? "").includes("outside its saved entry inputs");
assert.equal(warnings.some(outsideWarning), false, "no analysis read fell outside its captured inputs");
saveContent("first", { excerpt: "A saved change so the control reaches analysis instead of reuse." });
const leaking = await measured(() => runSavedScoreLifecycle(ctx, { collection: "posts", id: "first", locale: "en" }, {
	analyze: async (captured, revision) => {
		const replay = (captured as any).reads.replay();
		try {
			await replay.context().storage.overrides.get("posts:unrelated");
		} catch {
			// A reader that swallows its own read failure.
		}
		replay.assertWithinScope();
		return savedScoreLifecycleSteps.analyze(captured, revision);
	},
}));
assert.equal(leaking.value.status, "failed");
assert.equal(warnings.some(outsideWarning), true, "control: the sentinel reports the swallowed outside read");
// ---- Optional caller-owned terminal boundary ----

saveContent("first", { excerpt: "A saved change for the caller-owned terminal boundary at Harbour Bakery." });
const boundaryBefore = structuredClone(stored("first"));
const boundaryHistory = historyFor("first").length;
const currentRevision = ((await ctx.kv.getVersioned(GLOBAL_SETTINGS_KEY)) as { revision: string } | null)?.revision ?? null;
const boundaryRun = (accept: (score: any, admission: any) => Promise<any>, policyRevision: string | null = currentRevision) =>
	measured(() => runSavedScoreLifecycle(ctx, { collection: "posts", id: "first", locale: "en" }, countingSteps, { policyRevision, accept }));

const otherRevision = await boundaryRun(async () => { throw new Error("not reached"); }, "another-revision");
assert.deepEqual([otherRevision.value, otherRevision.analyzed, otherRevision.writes], [{ status: "superseded", reason: "policy-changed" }, 0, 0],
	"a boundary bound to another policy revision admits nothing");
const refusedByBoundary = await boundaryRun(async () => ({ persisted: false, refusal: "newer-result" }));
assert.deepEqual(refusedByBoundary.value, { status: "superseded", reason: "newer-result" });
assert.deepEqual(stored("first"), boundaryBefore, "a refusal from the boundary stores nothing");
const thrownByBoundary = await boundaryRun(async () => { throw new Error("injected terminal failure"); });
assert.equal(thrownByBoundary.value.status, "uncertain", "a throwing boundary is never reported as saved or failed");
const admissions: unknown[] = [];
const acceptedByBoundary = await boundaryRun(async (score, admission) => {
	admissions.push(admission);
	return acceptAnalyzedScore(ctx, score, { admission });
});
assert.equal(acceptedByBoundary.value.status, "saved");
assert.equal(acceptedByBoundary.value.status === "saved" && acceptedByBoundary.value.history, "not-attempted", "the caller owns history");
assert.equal(historyFor("first").length, boundaryHistory, "the lifecycle records no history through a boundary");
assert.equal(admissions.length, 1);
assert.equal((admissions[0] as any).state, "enabled");
assert.equal((admissions[0] as any).revision, currentRevision);
assert.ok(stored("first").analysisRevision > boundaryBefore.analysisRevision);
const ordinary = await run("first");
assert.equal(ordinary.value.status, "reused", "control: the ordinary path reuses the boundary-accepted score");

// ---- Explicit single-entry admission never opts into automatic work or history ----

let optionalTouches = 0;
const currentOnlyContext = {
	...ctx,
	storage: new Proxy(ctx.storage, { get(target, name, receiver) {
		if (["scoreHistory", "operationLeases", "scoreScanJobs"].includes(String(name))) {
			optionalTouches += 1;
			throw new Error("Manual current-score-only analysis touched optional storage.");
		}
		return Reflect.get(target, name, receiver);
	} }),
	content: { ...ctx.content, list: async () => { throw new Error("Manual analysis enumerated entries."); } },
	http: { fetch: async () => { throw new Error("Manual analysis requested a provider."); } },
};
const manualRun = (id: string, locale: string | null = "en", steps = countingSteps) =>
	measured(() => runManualSavedScoreLifecycle(currentOnlyContext, { collection: "posts", id, locale }, steps));
const optionalBefore = structuredClone([...stores.scoreHistory.records]);
const leasesBefore = structuredClone([...stores.operationLeases.records]);
for (const state of ["absent", "pending", "paused"] as const) {
	if (state === "absent") kvValues.delete(GLOBAL_SETTINGS_KEY);
	else setSetting(GLOBAL_SETTINGS_KEY, state === "pending" ? pendingRecord : settingsRecord(false));
	entry(`manual-${state}`, "sourdough");
	const settingsBefore = structuredClone([...kvValues]);
	const result = await manualRun(`manual-${state}`);
	assert.deepEqual([result.value.status, result.analyzed, result.value.status === "saved" && result.value.history], ["saved", 1, "not-attempted"], state);
	assert.deepEqual([...kvValues], settingsBefore, "manual analysis neither acknowledges nor edits settings or the selected profile");
	assert.equal(entries.get(`manual-${state}`).locale, "en");
	assert.equal(stored(`manual-${state}`).sourceVersion, savedContentVersion(entries.get(`manual-${state}`)));
	const reused = await manualRun(`manual-${state}`);
	assert.deepEqual([reused.value.status, reused.writes, reused.analyzed], ["reused", 0, 0], "manual reuse has no reservation or history repair");
	assert.deepEqual([(await run(`manual-${state}`)).value.status], [state === "paused" ? "disabled" : "activation_required"], "the same default caller remains automatic");
}
assert.deepEqual([...stores.scoreHistory.records], optionalBefore, "manual-only actions preserve every prior history record");
assert.deepEqual([...stores.operationLeases.records], leasesBefore, "manual-only actions acquire no global history lease");
assert.equal(optionalTouches, 0);
const wrongManualLocale = await manualRun("manual-paused", "fr");
assert.deepEqual([wrongManualLocale.value.status, wrongManualLocale.analyzed, wrongManualLocale.writes], ["locale-mismatch", 0, 0]);
const boundPolicy = await ctx.kv.getVersioned(GLOBAL_SETTINGS_KEY);
const boundManualPolicy = { state: "paused" as const, revision: boundPolicy.revision, intentEnabled: false, acknowledgedNoticeVersion: 1, currentNoticeVersion: 1 };
for (const binding of [{ ref: "posts:another", locale: "en" }, { ref: "posts:manual-paused", locale: "fr" }]) {
	const before = writes;
	assert.deepEqual(await acceptAnalyzedScore(currentOnlyContext, stored("manual-paused"), { manualEntryAdmission: { ...binding, policy: boundManualPolicy } }),
		{ persisted: false, refusal: binding.ref === "posts:manual-paused" ? "source-changed" : "policy-changed" }, "a manual admission cannot be used for another entry or locale");
	assert.equal(writes, before);
}
const profileBeforeManual = kvValues.get("configuration:analysis-profile:v1:posts")!;
kvValues.delete("configuration:analysis-profile:v1:posts");
const manualProfileRequired = await manualRun("manual-paused");
assert.deepEqual([manualProfileRequired.value.status, manualProfileRequired.writes, manualProfileRequired.analyzed], ["profile_required", 0, 0]);
kvValues.set("configuration:analysis-profile:v1:posts", profileBeforeManual);
for (const unavailable of ["corrupt", "throw"] as const) {
	if (unavailable === "corrupt") setSetting(GLOBAL_SETTINGS_KEY, { version: 9 });
	else failures.set(`kv.getVersioned:${GLOBAL_SETTINGS_KEY}`, new Error("Policy unavailable"));
	const refused = await manualRun("manual-paused");
	assert.deepEqual([refused.value.status, refused.writes, refused.analyzed], ["unavailable", 0, 0]);
	failures.delete(`kv.getVersioned:${GLOBAL_SETTINGS_KEY}`);
}
setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(false));
for (const mutation of ["source", "policy", "reservation"] as const) {
	const id = `manual-race-${mutation}`;
	entry(id, "rye");
	const raced = await manualRun(id, "en", { analyze: async (...args: Parameters<typeof savedScoreLifecycleSteps.analyze>) => {
		const result = await countingSteps.analyze(...args);
		if (mutation === "source") saveContent(id, { excerpt: "A changed saved source during manual analysis." });
		else if (mutation === "policy") setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(false));
		else {
			const reserved = stores.scoreAnalysisRevisions.records.get(`posts:${id}`);
			stores.scoreAnalysisRevisions.records.set(`posts:${id}`, { ...reserved, revision: reserved.revision + 1 });
		}
		return result;
	} });
	assert.equal(raced.value.status, "superseded", mutation);
	assert.equal(stored(id), undefined, "raced manual results are never saved");
}
entry("manual-postwrite-policy", "rye");
const manualScoreCas = stores.scores.api.compareAndSet;
stores.scores.api.compareAndSet = async (id: string, expected: any, next: any) => {
	const applied = await manualScoreCas(id, expected, next);
	if (id === "posts:manual-postwrite-policy" && applied && next.action === "put") setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(false));
	return applied;
};
const manualPostwrite = await manualRun("manual-postwrite-policy");
stores.scores.api.compareAndSet = manualScoreCas;
assert.deepEqual(manualPostwrite.value, { status: "superseded", reason: "policy-changed" });
assert.equal(stored("manual-postwrite-policy"), undefined, "a policy change during CAS rolls back the manual score");
entry("manual-uncertain", "rye");
failures.set("scores.compareAndSet", new Error("Manual score response lost"));
assert.equal((await manualRun("manual-uncertain")).value.status, "uncertain");
failures.delete("scores.compareAndSet");
assert.equal(optionalTouches, 0, "refused and unknown manual writes also avoid optional history, scan and lease stores");
assert.deepEqual([...stores.scoreHistory.records], optionalBefore);
entry("manual-route", "rye");
const manualRoute = (name: string, input: unknown) => (seoRuntime as any).routes[name].handler({ input }, currentOnlyContext);
const routeSettingsBefore = structuredClone([...kvValues]);
const manualRouteResult = await manualRoute("analyze-saved-content", { ref: "posts:manual-route", locale: "en" });
assert.deepEqual([manualRouteResult.success, manualRouteResult.outcome, manualRouteResult.history], [true, "saved", "not-attempted"]);
const routeReadback = await manualRoute("scores", { ref: "posts:manual-route", storedOnly: true });
assert.equal(routeReadback.items.length, 1);
assert.equal(routeReadback.items[0].ref, "posts:manual-route");
assert.equal(routeReadback.items[0].freshness, "current", "manual score readback verifies exact current inputs while automatic analysis stays paused");
const manualIdentity = await manualRoute("entry-analysis-identity", { ref: "posts:manual-route" });
assert.equal(manualIdentity.success, true, "the manual result can be validated without enabling automatic analysis");
const beforeSessionWrites = writes;
const automaticSession = await manualRoute("audit-content", { refs: ["posts:manual-route"] });
assert.equal(automaticSession.items.length, 0);
assert.equal(automaticSession.failures[0].error, "scoring_disabled", "even one-ref legacy session analysis keeps its automatic admission");
assert.equal(writes, beforeSessionWrites);
assert.equal((await manualRoute("audit-content", { refs: ["posts:manual-route", "posts:manual-paused"] })).failures[0].error, "scoring_disabled");
assert.equal((await manualRoute("analyze-content", { collection: "posts", id: "manual-route" })).error, "scoring_disabled", "legacy calls do not receive manual admission");
assert.deepEqual([...kvValues], routeSettingsBefore);
assert.equal(optionalTouches, 0);
setSetting(GLOBAL_SETTINGS_KEY, settingsRecord(true));
entry("manual-history-admitted", "rye");
const admittedManual = await runManualSavedScoreLifecycle(ctx, { collection: "posts", id: "manual-history-admitted", locale: "en" }, countingSteps);
assert.deepEqual([admittedManual.status, admittedManual.status === "saved" && admittedManual.history, historyFor("manual-history-admitted").length], ["saved", "created", 1],
	"already admitted automatic/history behavior is preserved");
report.manualEntry = { states: ["absent", "pending", "paused"], optionalTouches, admittedHistory: "created" };

console.log(JSON.stringify({ check: "score-lifecycle", measured: report }));
console.log("shipit-seo saved score lifecycle self-check passed");
