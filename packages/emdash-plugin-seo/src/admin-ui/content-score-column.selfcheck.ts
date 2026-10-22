import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { ArrowsClockwise } from "@phosphor-icons/react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";

import { analyzeSeoContent, seoAnalysisSummary, type SeoAnalysisInput } from "../analysis.ts";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_SCORE_VERSION,
	type SeoAdminContentScore,
	type SeoAdminContentScores,
	type SeoAdminEntryAnalysisIdentity,
	type SeoAdminEntryAnalysisIdentityResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import type { FetchSeoContentScoresOptions } from "./api.ts";
import { createSavedContentSnapshot, hydrateSavedContent, savedContentVersion, savedSnapshotMatches, verifySavedContentVersions } from "./saved-content-snapshot.ts";
import {
	createEditorSessionAnalysis,
	editorSessionScoreForSavedVersion,
	sessionScoreMatchesIdentity,
	type EditorSessionAnalysisOptions,
	type EditorSessionAnalysisState,
} from "./editor-session-analysis.ts";
import {
	contentScoreColumnPresentation,
	contentScorePageQueryOptions,
	SCORE_PAGE_SIZE,
	type ContentScorePageLoader,
	visibleContentScoreRefs,
} from "./content-score-column.ts";

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

function scoreResponse(refs: readonly string[]): SeoAdminContentScores {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		generatedAt: "2026-08-10T00:00:00.000Z",
		engineVersion: "0.4.0-alpha.10",
		scoreVersion: SEO_SCORE_VERSION,
		items: refs.map((ref, index) => {
			const [collection, ...entryIdParts] = ref.split(":");
			return {
				ref,
				collection,
				entryId: entryIdParts.join(":"),
				score: 80 - index,
			} as SeoAdminContentScore;
		}),
		hasMore: false,
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.fail("Timed out waiting for the score query state");
}

const firstPage = [
	{ id: "critical-result" },
	{ id: "high-result" },
	...Array.from({ length: SCORE_PAGE_SIZE }, (_, index) => ({ id: `filtered-${index}` })),
];
const secondPage = [{ id: "low-result" }, { id: "medium-result" }];
const expectedFirstRefs = firstPage.slice(0, SCORE_PAGE_SIZE).map((item) => `posts:${item.id}`);
const expectedSecondRefs = secondPage.map((item) => `posts:${item.id}`);

interface ScoreRequest {
	options: FetchSeoContentScoresOptions;
	result: Deferred<SeoAdminContentScores>;
}

const requests: ScoreRequest[] = [];
const loadScores: ContentScorePageLoader = (options) => {
	const result = deferred<SeoAdminContentScores>();
	requests.push({ options, result });
	return result.promise;
};
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
const queryOptions = (item: { id: string }, visibleItems: readonly { id: string }[]) => {
	const refs = visibleContentScoreRefs("posts", item, visibleItems);
	return contentScorePageQueryOptions("posts", refs, "en", loadScores);
};
assert.equal(queryOptions(firstPage[0], firstPage).refetchOnMount, "always");
const firstObserver = new QueryObserver(queryClient, queryOptions(firstPage[0], firstPage));
const secondObserver = new QueryObserver(queryClient, queryOptions(firstPage[1], firstPage));
const stopFirst = firstObserver.subscribe(() => undefined);
const stopSecond = secondObserver.subscribe(() => undefined);

await waitFor(() => requests.length === 1);
assert.deepEqual(requests[0]?.options.refs, expectedFirstRefs);
assert.equal(requests[0]?.options.limit, SCORE_PAGE_SIZE);
assert.equal(requests[0]?.options.collection, "posts");
assert.equal(requests[0]?.options.storedOnly, true);
assert.equal(requests[0]?.options.snapshotOnly, true);
assert.equal(requests[0]?.options.signal?.aborted, false);

firstObserver.setOptions(queryOptions(secondPage[0], secondPage));
assert.equal(
	requests[0]?.options.signal?.aborted,
	false,
	"the shared request must remain active while an old-page cell still observes it",
);
secondObserver.setOptions(queryOptions(secondPage[1], secondPage));

await waitFor(() => requests.length === 2);
assert.equal(requests[0]?.options.signal?.aborted, true);
assert.deepEqual(requests[1]?.options.refs, expectedSecondRefs);
assert.equal(requests[1]?.options.limit, expectedSecondRefs.length);
assert.equal(requests[1]?.options.storedOnly, true);
assert.equal(requests[1]?.options.snapshotOnly, true);

requests[1]?.result.resolve(scoreResponse(expectedSecondRefs));
await waitFor(
	() =>
		firstObserver.getCurrentResult().isSuccess &&
		firstObserver.getCurrentResult().data?.has("posts:low-result") === true,
);
requests[0]?.result.resolve(scoreResponse(expectedFirstRefs));
await new Promise<void>((resolve) => setImmediate(resolve));

const currentScores = firstObserver.getCurrentResult().data;
assert.equal(currentScores?.has("posts:low-result"), true);
assert.equal(currentScores?.has("posts:critical-result"), false);
assert.deepEqual(firstObserver.getCurrentResult().data, secondObserver.getCurrentResult().data);
assert.equal(requests.length, 2, "each visible page must issue one shared score request");

stopFirst();
stopSecond();
queryClient.clear();

const savedVersions = ["2026-09-09T10:00:00.000Z", "2026-09-09T10:01:00.000Z", "2026-09-09T10:02:00.000Z", "2026-09-09T10:03:00.000Z", "2026-09-09T10:04:00.000Z"];
const sessionRequests: Array<{ ref: string; signal: AbortSignal; result: Deferred<SeoAdminContentScore> }> = [];
const sessionStates: EditorSessionAnalysisState[] = [];
const sessionScore = (sourceUpdatedAt: string): SeoAdminContentScore => ({
	...scoreResponse(["posts:one"]).items[0],
	sourceUpdatedAt,
	persistence: "session",
	analysisRevision: 0,
	freshness: "current",
});
const editorSession = createEditorSessionAnalysis({
	ref: "posts:one",
	savedUpdatedAt: savedVersions[0],
	onChange: (state) => sessionStates.push(state),
	analyze: (ref, signal) => {
		const result = deferred<SeoAdminContentScore>();
		sessionRequests.push({ ref, signal, result });
		return result.promise;
	},
});
await editorSession.updateSavedVersion(savedVersions[1]);
assert.equal(sessionRequests.length, 0, "preparing the editor before start must not issue analysis requests");
const initialAnalysis = editorSession.start();
assert.equal(sessionRequests.length, 1);
assert.equal(editorSession.start(), initialAnalysis, "repeated starts must share the active request");
assert.equal(sessionRequests[0].signal.aborted, false);
sessionRequests[0].result.resolve(sessionScore(savedVersions[1]));
await initialAnalysis;
assert.equal(sessionStates.at(-1)?.score?.freshness, "current");
assert.equal(editorSessionScoreForSavedVersion(sessionStates.at(-1)?.score ?? null, savedVersions[2])?.freshness, "stale");

const changedAnalysis = editorSession.updateSavedVersion(savedVersions[2]);
assert.equal(sessionRequests.length, 2);
assert.equal(sessionStates.at(-1)?.score?.freshness, "stale");
assert.equal(sessionStates.at(-1)?.pending, true);
await editorSession.updateSavedVersion(savedVersions[2]);
assert.equal(sessionRequests.length, 2, "the same saved revision must not trigger another request");
const newerAnalysis = editorSession.updateSavedVersion(savedVersions[3]);
assert.equal(sessionRequests[1].signal.aborted, true);
sessionRequests[1].result.resolve(sessionScore(savedVersions[2]));
await changedAnalysis;
assert.equal(sessionStates.at(-1)?.score?.sourceUpdatedAt, savedVersions[1], "an obsolete response cannot replace the last known result");
sessionRequests[2].result.resolve(sessionScore(savedVersions[3]));
await newerAnalysis;
assert.equal(sessionStates.at(-1)?.score?.sourceUpdatedAt, savedVersions[3]);
assert.equal(sessionStates.at(-1)?.score?.freshness, "current");

const inconsistentAnalysis = editorSession.updateSavedVersion(savedVersions[4]);
sessionRequests[3].result.resolve(sessionScore(savedVersions[3]));
await inconsistentAnalysis;
assert.match(sessionStates.at(-1)?.error ?? "", /Saved content changed/);
assert.equal(sessionStates.at(-1)?.score?.freshness, "stale");
await editorSession.updateSavedVersion(savedVersions[4]);
await editorSession.start();
assert.equal(sessionRequests.length, 4, "failed analysis must not create a background retry loop");

const cancelledAnalysis = editorSession.analyze();
editorSession.cancel();
const notificationsBeforeLateResponse = sessionStates.length;
sessionRequests[4].result.resolve(sessionScore(savedVersions[4]));
await cancelledAnalysis;
assert.equal(sessionRequests[4].signal.aborted, true);
assert.equal(sessionStates.length, notificationsBeforeLateResponse, "unmounted sessions must ignore late responses");
const rawSavedEntry = {
	id: "one", updatedAt: savedVersions[4], slug: "published-slug",
	data: { title: "Published title" },
	draftRevisionId: "draft-2", _rev: btoa(`2:${savedVersions[4]}`),
};
const hydratedEntry = hydrateSavedContent(rawSavedEntry, {
	data: { title: "Saved draft title", _slug: "saved-draft-slug", _private: "excluded" },
});
assert.equal(hydratedEntry.data.title, "Saved draft title");
assert.equal(hydratedEntry.slug, "saved-draft-slug");
assert.equal(hydratedEntry.data._private, undefined);
assert.equal(rawSavedEntry.data.title, "Published title", "draft hydration must preserve the raw saved row");
const savedVersion2 = savedContentVersion(rawSavedEntry);
assert.equal(savedContentVersion(hydratedEntry), savedVersion2, "editor hydration and native inventory share the same saved revision identity");
assert.equal(savedContentVersion({ ...rawSavedEntry, _rev: undefined, version: 2 }), savedVersion2);
const savedVersion3 = savedContentVersion({ ...rawSavedEntry, _rev: btoa(`3:${savedVersions[4]}`), draftRevisionId: "draft-3" });
assert.notEqual(savedVersion2, savedVersion3, "a saved draft can change while the content timestamp stays unchanged");
assert.ok(savedVersion3.length < 2_048);
const matchingRevision = {
	id: "draft-2", collection: "posts", entryId: "one",
	data: { title: "Saved draft title", _slug: "saved-draft-slug" },
};
const savedSnapshot = createSavedContentSnapshot("posts:one", rawSavedEntry, matchingRevision);
assert.equal(savedSnapshot.data.title, "Saved draft title");
assert.equal(savedSnapshot.slug, "saved-draft-slug");
assert.equal(savedSnapshot.sourceVersion, savedVersion2);
assert.equal(savedSnapshot.data._slug, undefined);
assert.throws(() => createSavedContentSnapshot("posts:other", rawSavedEntry, matchingRevision), /Invalid saved content/);
assert.throws(() => createSavedContentSnapshot("posts:one", { ...rawSavedEntry, data: [] }, matchingRevision), /Invalid saved content/);
for (const revision of [
	undefined,
	{ ...matchingRevision, id: "draft-1" },
	{ ...matchingRevision, collection: "pages" },
	{ ...matchingRevision, entryId: "other" },
	{ ...matchingRevision, data: [] },
	{ ...matchingRevision, data: null },
]) {
	assert.throws(() => createSavedContentSnapshot("posts:one", rawSavedEntry, revision), /Invalid saved draft/);
}
const snapshotEcho = { ref: "posts:one", sourceKind: "saved-snapshot", sourceVersion: savedVersion2 };
assert.equal(savedSnapshotMatches(snapshotEcho, savedSnapshot), true);
for (const echo of [
	{ ...snapshotEcho, ref: "posts:other" },
	{ ...snapshotEcho, sourceKind: undefined },
	{ ...snapshotEcho, sourceKind: "stored" },
	{ ...snapshotEcho, sourceVersion: undefined },
	{ ...snapshotEcho, sourceVersion: savedVersion3 },
]) {
	assert.equal(savedSnapshotMatches(echo, savedSnapshot), false, "preview and analysis echoes must match the exact submitted saved version");
}
assert.notEqual(
	savedContentVersion({ updatedAt: savedVersions[4], data: { title: "first" } }),
	savedContentVersion({ updatedAt: savedVersions[4], data: { title: "second" } }),
	"hosts without a version token must still detect saved data changes",
);

await editorSession.updateSavedVersion(savedVersions[4], savedVersion2);
assert.equal(sessionRequests.length, 5, "unmounted controllers must wait for start before resuming");
const versionedAnalysis = editorSession.start();
sessionRequests[5].result.resolve({ ...sessionScore(savedVersions[4]), sourceVersion: savedVersion2, sourceKind: "saved-snapshot" });
await versionedAnalysis;
const sameTimestampAnalysis = editorSession.updateSavedVersion(savedVersions[4], savedVersion3);
assert.equal(sessionStates.at(-1)?.score?.freshness, "stale");
assert.equal(sessionRequests.length, 7, "a different saved revision triggers one analysis despite an unchanged timestamp");
sessionRequests[6].result.resolve({ ...sessionScore(savedVersions[4]), sourceVersion: savedVersion3, sourceKind: "saved-snapshot" });
await sameTimestampAnalysis;
assert.equal(sessionStates.at(-1)?.score?.freshness, "current");
await editorSession.updateSavedVersion(savedVersions[4], savedVersion3);
assert.equal(sessionRequests.length, 7, "unchanged saved revision tokens must not repeat analysis");
assert.deepEqual([...new Set(sessionRequests.map((request) => request.ref))], ["posts:one"], "saving an analyzed entry must never rescan other entries");

const automaticRequests: Array<{
	ref: string;
	signal: AbortSignal;
	analysisOptions: EditorSessionAnalysisOptions;
	result: Deferred<SeoAdminContentScore>;
}> = [];
const automaticStates: EditorSessionAnalysisState[] = [];
// The engine's current identity; every session result records it when analyzed.
const serverIdentity: SeoAdminEntryAnalysisIdentity = {
	scoreVersion: SEO_SCORE_VERSION,
	configurationFingerprint: "seo-config-v1-0000000a",
	templateUpdatedAt: "2026-09-01T00:00:00.000Z",
	modulesUpdatedAt: null,
	metaOverrideUpdatedAt: null,
	sourceVersion: "saved-1",
	locale: null,
	entryInputFingerprint: `sha256-${"a".repeat(64)}`,
};
const identityReads: string[] = [];
const identityAnswer = (ref: string): SeoAdminEntryAnalysisIdentityResult => ({
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: true, ref, identity: { ...serverIdentity },
});
const configurationOf = ({ sourceVersion: _sourceVersion, locale: _locale, ...configuration }: SeoAdminEntryAnalysisIdentity) => configuration;
const automaticScore = (ref = "posts:automatic", version = "saved-1"): SeoAdminContentScore => ({
	...sessionScore(savedVersions[4]), ref, sourceKind: "saved-snapshot", ...configurationOf(serverIdentity), sourceVersion: version,
});
const automaticOptions = {
	ref: "posts:automatic", savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	currentIdentity: async (ref: string) => {
		identityReads.push(ref);
		return identityAnswer(ref);
	},
	onChange: (state: EditorSessionAnalysisState) => automaticStates.push(state),
	analyze: (ref: string, signal: AbortSignal, analysisOptions: EditorSessionAnalysisOptions) => {
		const result = deferred<SeoAdminContentScore>();
		automaticRequests.push({ ref, signal, analysisOptions, result });
		return result.promise;
	},
};
const automatic = createEditorSessionAnalysis(automaticOptions);
const acknowledgedKeywords = ["persisted"];
await automatic.updateAnalysisOptions({ keywords: acknowledgedKeywords, pillar: false });
acknowledgedKeywords.push("edited later");
assert.equal(automaticRequests.length, 0, "loading a profile before start must not trigger an intermediate analysis");
const abandonedStart = automatic.start();
assert.equal(automatic.start(), abandonedStart);
assert.deepEqual(automaticRequests[0].analysisOptions, { keywords: ["persisted"], pillar: false });
automatic.cancel();
const strictModeStart = automatic.start();
assert.equal(automaticRequests.length, 2, "a cancelled StrictMode mount must be able to start again");
assert.equal(automaticRequests[0].signal.aborted, true);
automaticRequests[0].result.resolve(automaticScore());
await abandonedStart;
assert.equal(automaticStates.at(-1)?.pending, true);
assert.equal(automaticStates.at(-1)?.score, null, "a cancelled request cannot populate current state or cache");
automaticRequests[1].result.resolve(automaticScore());
await strictModeStart;
automatic.cancel();
const remounted = createEditorSessionAnalysis({
	...automaticOptions, analysisOptions: { keywords: ["persisted"], pillar: false },
});
const readsBeforeRemount = identityReads.length;
await remounted.start();
assert.equal(automaticRequests.length, 2, "the same saved entry and acknowledged profile must reuse the session cache after remount");
assert.equal(identityReads.length - readsBeforeRemount, 1, "reuse is validated by one exact-entry identity read, not by analysis");
assert.equal(automaticStates.at(-1)?.score?.freshness, "current");
assert.deepEqual(automaticStates.at(-1)?.analysisOptions, { keywords: ["persisted"], pillar: false });
await remounted.updateAnalysisOptions({ keywords: ["persisted"], pillar: false });
assert.equal(automaticRequests.length, 2, "equivalent profile arrays do not restart analysis");
const clearedKeywords = remounted.updateAnalysisOptions({ keywords: [], pillar: false });
assert.equal(automaticRequests.length, 3);
assert.equal(automaticStates.at(-1)?.score?.freshness, "stale", "an earlier profile score must become stale before the new analysis completes");
const inheritedKeywords = remounted.updateAnalysisOptions({ keywords: null, pillar: false });
assert.equal(automaticRequests.length, 4, "explicit empty keywords and inherited keywords are distinct analysis inputs");
assert.equal(automaticRequests[2].signal.aborted, true);
automaticRequests[2].result.resolve(automaticScore());
await clearedKeywords;
assert.equal(automaticStates.at(-1)?.pending, true, "late results for a superseded profile cannot finish the latest analysis");
automaticRequests[3].result.resolve(automaticScore());
await inheritedKeywords;
const changedPillar = remounted.updateAnalysisOptions({ keywords: null, pillar: true });
assert.equal(automaticRequests.length, 5, "changing pillar content changes the analysis inputs");
automaticRequests[4].result.resolve(automaticScore());
await changedPillar;
await remounted.updateAnalysisOptions({ keywords: ["persisted"], pillar: false });
assert.equal(automaticRequests.length, 5, "returning to a previously analyzed profile reuses only its matching cached score");
serverIdentity.sourceVersion = "saved-2";
const changedSavedContent = remounted.updateSavedVersion(savedVersions[4], "saved-2");
assert.equal(automaticRequests.length, 6, "an unchanged timestamp cannot hide a different saved version");
assert.equal(automaticStates.at(-1)?.score?.freshness, "stale");
automaticRequests[5].result.resolve(automaticScore("posts:automatic", "saved-2"));
await changedSavedContent;
const forcedRefresh = remounted.analyze();
assert.equal(automaticRequests.length, 7, "explicit refresh bypasses a matching cached result");
automaticRequests[6].result.resolve(automaticScore("posts:automatic", "saved-2"));
await forcedRefresh;
const orderedKeywords = remounted.updateAnalysisOptions({ keywords: ["primary", "secondary"], pillar: false });
automaticRequests[7].result.resolve(automaticScore("posts:automatic", "saved-2"));
await orderedKeywords;
const promotedKeyword = remounted.updateAnalysisOptions({ keywords: ["secondary", "primary"], pillar: false });
assert.equal(automaticRequests.length, 9, "promoting a keyword changes the ordered analysis input identity");
automaticRequests[8].result.resolve(automaticScore("posts:automatic", "saved-2"));
await promotedKeyword;
remounted.cancel();

let failedStarts = 0;
const failedStates: EditorSessionAnalysisState[] = [];
const failureOptions = {
	ref: "posts:automatic-failure", savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	onChange: (state: EditorSessionAnalysisState) => failedStates.push(state),
	analyze: async () => { failedStarts += 1; throw new Error("Temporary analysis failure"); },
};
const failedSession = createEditorSessionAnalysis(failureOptions);
await failedSession.start();
await failedSession.start();
await failedSession.updateAnalysisOptions({ keywords: null, pillar: null });
assert.equal(failedStarts, 1, "repeated start or unchanged profile effects must not retry a failed request");
assert.equal(failedStates.at(-1)?.error, "Temporary analysis failure");
await failedSession.analyze();
assert.equal(failedStarts, 2, "explicit retry must run after an automatic failure");
failedSession.cancel();
await createEditorSessionAnalysis(failureOptions).start();
assert.equal(failedStarts, 3, "failures must not enter the successful score cache");

serverIdentity.sourceVersion = "saved-1";
let boundedCacheRequests = 0;
const cachedSession = (index: number) => createEditorSessionAnalysis({
	ref: `posts:bounded-cache-${index}`, savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	currentIdentity: async (ref) => identityAnswer(ref),
	onChange: () => {},
	analyze: async (ref) => { boundedCacheRequests += 1; return automaticScore(ref); },
});
for (let index = 0; index < 101; index += 1) await cachedSession(index).start();
await cachedSession(100).start();
assert.equal(boundedCacheRequests, 101, "the most recent successful score must remain cached");
await cachedSession(0).start();
assert.equal(boundedCacheRequests, 102, "the in-memory cache must evict older results once it reaches 100 scores");

// ---- Cached session results after unchanged saved content ----------------
serverIdentity.sourceVersion = "saved-1";
const validationRequests: string[] = [];
const validationStates: EditorSessionAnalysisState[] = [];
let validationIdentity: (ref: string) => Promise<SeoAdminEntryAnalysisIdentityResult> = async (ref) => identityAnswer(ref);
const validationSession = (ref: string) => createEditorSessionAnalysis({
	ref, savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	currentIdentity: (requestedRef) => validationIdentity(requestedRef),
	onChange: (state) => validationStates.push(state),
	analyze: async (requestedRef) => { validationRequests.push(requestedRef); return automaticScore(requestedRef); },
});
const reopened = async (ref: string) => {
	const session = validationSession(ref);
	await session.start();
	session.cancel();
	return validationStates.at(-1);
};
const identityChanges: Array<[string, Partial<SeoAdminEntryAnalysisIdentity>]> = [
	["a site settings or schema change", { configurationFingerprint: "seo-config-v1-0000000b" }],
	["a template change", { templateUpdatedAt: "2026-09-02T00:00:00.000Z" }],
	["a modules change", { modulesUpdatedAt: "2026-09-03T00:00:00.000Z" }],
	["an entry directive change", { metaOverrideUpdatedAt: "2026-09-04T00:00:00.000Z" }],
	["an analyzer version change", { scoreVersion: SEO_SCORE_VERSION + 1 }],
];
for (const [index, [change, update]] of identityChanges.entries()) {
	const ref = `posts:unchanged-${index}`;
	await reopened(ref);
	assert.equal(validationRequests.filter((item) => item === ref).length, 1);
	Object.assign(serverIdentity, update);
	const state = await reopened(ref);
	assert.equal(validationRequests.filter((item) => item === ref).length, 2, `${change} with unchanged content must not reuse the cached result`);
	if (update.scoreVersion) {
		assert.equal(state?.score?.freshness, "stale", "a result from another engine analyzer version is never confirmed");
		assert.match(state?.error ?? "", /could not be confirmed/);
	} else {
		assert.equal(state?.score?.freshness, "current");
		assert.equal(state?.score?.configurationFingerprint, serverIdentity.configurationFingerprint);
	}
	await reopened(ref);
	assert.equal(validationRequests.filter((item) => item === ref).length, 3 - (update.scoreVersion ? 0 : 1),
		update.scoreVersion ? "a result can never match an identity from another analyzer version" : "the fresh result is reused while the identity stays unchanged");
	Object.assign(serverIdentity, {
		scoreVersion: SEO_SCORE_VERSION, configurationFingerprint: "seo-config-v1-0000000a", templateUpdatedAt: "2026-09-01T00:00:00.000Z",
		modulesUpdatedAt: null, metaOverrideUpdatedAt: null, sourceVersion: "saved-1", locale: null,
		entryInputFingerprint: `sha256-${"a".repeat(64)}`,
	});
}
assert.equal(
	sessionScoreMatchesIdentity({ ...automaticScore(), scoreVersion: SEO_SCORE_VERSION - 1 }, { ...serverIdentity, scoreVersion: SEO_SCORE_VERSION - 1 }),
	false,
	"a legacy result never becomes current, even against a matching legacy identity",
);
for (const [failure, reader] of [
	["a thrown identity read", async () => { throw new Error("offline"); }],
	["deleted content", async (ref: string) => ({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: false, ref, error: "content_not_found" })],
	["an unreadable configuration", async (ref: string) => ({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: false, ref, error: "configuration_unreadable" })],
	["scoring turned off", async (ref: string) => ({ contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: "test", success: false, ref, error: "scoring_disabled" })],
] as const) {
	const ref = `posts:validation-${failure}`;
	validationIdentity = async (requestedRef) => identityAnswer(requestedRef);
	await reopened(ref);
	validationIdentity = reader as typeof validationIdentity;
	await reopened(ref);
	assert.equal(validationRequests.filter((item) => item === ref).length, 2, `${failure} never accepts a cached result`);
}
validationIdentity = async (ref) => identityAnswer(ref);
const noValidator = createEditorSessionAnalysis({
	ref: "posts:validation-0", savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	onChange: () => {},
	analyze: async (ref) => { validationRequests.push(ref); return automaticScore(ref); },
});
const beforeNoValidator = validationRequests.length;
await noValidator.start();
assert.equal(validationRequests.length, beforeNoValidator + 1, "without an identity reader a cached result is never reused");
const lateIdentity = deferred<SeoAdminEntryAnalysisIdentityResult>();
const lateRef = "posts:late-identity";
await reopened(lateRef);
validationIdentity = () => lateIdentity.promise;
const lateSession = validationSession(lateRef);
const lateStart = lateSession.start();
validationIdentity = async (ref) => identityAnswer(ref);
const statesBeforeLate = validationStates.length;
const newerRun = lateSession.analyze();
await newerRun;
const newerState = validationStates.at(-1);
lateIdentity.resolve(identityAnswer(lateRef));
await lateStart;
assert.equal(validationStates.at(-1), newerState, "a late identity answer after a newer run changes nothing");
assert.ok(validationStates.length > statesBeforeLate);
lateSession.cancel();
validationIdentity = async (ref) => identityAnswer(ref);

// ---- Warm resume binds the exact saved row and locale; it never analyzes ----
const resumeRequests: string[] = [];
const resumeStates: EditorSessionAnalysisState[] = [];
const resumeSession = (ref: string, locale: string | null = null, savedVersion = "saved-1") => createEditorSessionAnalysis({
	ref, savedUpdatedAt: savedVersions[4], savedVersion, locale,
	currentIdentity: (requestedRef) => validationIdentity(requestedRef),
	onChange: (state) => resumeStates.push(state),
	analyze: async (requestedRef) => { resumeRequests.push(requestedRef); return automaticScore(requestedRef); },
});
const statesBeforeColdResume = resumeStates.length;
await resumeSession("posts:resume-cold").resume();
assert.deepEqual([resumeRequests.length, resumeStates.length], [0, statesBeforeColdResume], "resume without a cached result reads and analyzes nothing");
await resumeSession("posts:resume-warm").start();
assert.equal(resumeRequests.length, 1);
await resumeSession("posts:resume-warm").resume();
assert.equal(resumeRequests.length, 1, "a confirmed cached result is reused without analysis");
assert.equal(resumeStates.at(-1)?.score?.freshness, "current");
serverIdentity.sourceVersion = "saved-from-another-tab";
await resumeSession("posts:resume-warm").resume();
assert.equal(resumeRequests.length, 1, "resume never falls back to analysis");
assert.equal(resumeStates.at(-1)?.score, null, "a remote save after the cached analysis leaves nothing current");
serverIdentity.sourceVersion = "saved-1";
await resumeSession("posts:resume-locale").start();
assert.equal(resumeRequests.length, 2);
serverIdentity.locale = "fr";
await resumeSession("posts:resume-locale", "en").resume();
assert.equal(resumeStates.at(-1)?.score, null, "a result from a row in another locale is never reused");
serverIdentity.locale = null;

// ---- A shown result is unconfirmed while it is checked again ----
const revalidated = resumeSession("posts:revalidate");
await revalidated.start();
assert.equal(resumeStates.at(-1)?.score?.freshness, "current");
const heldIdentity = deferred<SeoAdminEntryAnalysisIdentityResult>();
validationIdentity = () => heldIdentity.promise;
const checking = revalidated.revalidate();
assert.equal(resumeStates.at(-1)?.score?.freshness, "stale", "no current claim while the engine has not answered");
serverIdentity.configurationFingerprint = "seo-config-v1-0000000c";
heldIdentity.resolve(identityAnswer("posts:revalidate"));
await checking;
assert.equal(resumeStates.at(-1)?.score?.freshness, "stale", "a settings change with unchanged content leaves the shown result stale");
validationIdentity = async (ref) => identityAnswer(ref);
serverIdentity.configurationFingerprint = "seo-config-v1-0000000a";
await revalidated.revalidate();
assert.equal(resumeStates.at(-1)?.score?.freshness, "current", "a matching answer confirms it again");
validationIdentity = async () => { throw new Error("offline"); };
await revalidated.revalidate();
assert.equal(resumeStates.at(-1)?.score?.freshness, "stale", "an unreadable identity confirms nothing");
validationIdentity = async (ref) => identityAnswer(ref);
revalidated.cancel();

// ---- Late answers after a configuration change are not accepted as current ----
const heldAnalysis = deferred<SeoAdminContentScore>();
const lateConfigSession = createEditorSessionAnalysis({
	ref: "posts:held-analysis", savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	currentIdentity: (requestedRef) => validationIdentity(requestedRef),
	onChange: (state) => resumeStates.push(state),
	analyze: () => heldAnalysis.promise,
});
const heldRun = lateConfigSession.start();
const analyzedBefore = automaticScore("posts:held-analysis");
serverIdentity.templateUpdatedAt = "2026-09-05T00:00:00.000Z";
heldAnalysis.resolve(analyzedBefore);
await heldRun;
assert.equal(resumeStates.at(-1)?.score?.freshness, "stale", "an answer computed before a template change never becomes current");
assert.match(resumeStates.at(-1)?.error ?? "", /changed during analysis/);
lateConfigSession.cancel();
const reopenedHeld = resumeSession("posts:held-analysis");
const statesBeforeHeldResume = resumeStates.length;
const requestsBeforeHeldResume = resumeRequests.length;
await reopenedHeld.resume();
assert.deepEqual([resumeStates.length, resumeRequests.length], [statesBeforeHeldResume, requestsBeforeHeldResume],
	"an unconfirmed answer never enters the session cache, so resume finds nothing to reuse");
serverIdentity.templateUpdatedAt = "2026-09-01T00:00:00.000Z";

// ---- Cancelling settles the state; identical inputs need no cancellation ----
const cancelStates: EditorSessionAnalysisState[] = [];
const neverAnswers = deferred<SeoAdminContentScore>();
const cancelled = createEditorSessionAnalysis({
	ref: "posts:cancelled-refresh", savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	analysisOptions: { keywords: null, pillar: false },
	onChange: (state) => cancelStates.push(state),
	analyze: () => neverAnswers.promise,
});
void cancelled.analyze();
assert.equal(cancelStates.at(-1)?.pending, true);
cancelled.cancel();
assert.equal(cancelStates.at(-1)?.pending, false, "a cancelled run never leaves Refresh waiting");
assert.equal(cancelled.hasAnalysisOptions({ keywords: null, pillar: false }), true, "a refetch of the same profile is not a change");
assert.equal(cancelled.hasAnalysisOptions({ keywords: [], pillar: false }), false);
assert.equal(cancelled.hasAnalysisOptions({ keywords: null, pillar: true }), false);

// ---- The entry's own plugin records bind a kept result too ----
const entryStates: EditorSessionAnalysisState[] = [];
const entryRequests: string[] = [];
const entrySession = (ref: string) => createEditorSessionAnalysis({
	ref, savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	currentIdentity: (requestedRef) => validationIdentity(requestedRef),
	onChange: (state) => entryStates.push(state),
	analyze: async (requestedRef) => { entryRequests.push(requestedRef); return automaticScore(requestedRef); },
});
for (const change of ["a remote legacy noindex override", "a remote keyword or pillar profile change"]) {
	const ref = `posts:entry-input-${change.length}`;
	await entrySession(ref).start();
	assert.equal(entryStates.at(-1)?.score?.freshness, "current");
	const shown = entrySession(ref);
	await shown.resume();
	assert.equal(entryStates.at(-1)?.score?.freshness, "current", `control before ${change}`);
	serverIdentity.entryInputFingerprint = `sha256-${"b".repeat(64)}`;
	await shown.revalidate();
	assert.equal(entryStates.at(-1)?.score?.freshness, "stale", `${change} after the response leaves the shown result stale`);
	shown.cancel();
	const requestsBeforeReturn = entryRequests.length;
	await entrySession(ref).resume();
	assert.equal(entryRequests.length, requestsBeforeReturn, "returning never analyzes merely to validate");
	assert.equal(entryStates.at(-1)?.score, null, `${change}: the kept result is not reused on return`);
	serverIdentity.entryInputFingerprint = `sha256-${"a".repeat(64)}`;
}
const heldEntryAnalysis = deferred<SeoAdminContentScore>();
const heldEntrySession = createEditorSessionAnalysis({
	ref: "posts:held-entry-input", savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	currentIdentity: (requestedRef) => validationIdentity(requestedRef),
	onChange: (state) => entryStates.push(state),
	analyze: () => heldEntryAnalysis.promise,
});
const heldEntryRun = heldEntrySession.start();
const answeredBeforeMutation = automaticScore("posts:held-entry-input");
serverIdentity.entryInputFingerprint = `sha256-${"c".repeat(64)}`;
heldEntryAnalysis.resolve(answeredBeforeMutation);
await heldEntryRun;
assert.equal(entryStates.at(-1)?.score?.freshness, "stale", "an answer held across a mutation of the entry's records is rejected");
heldEntrySession.cancel();
serverIdentity.entryInputFingerprint = `sha256-${"a".repeat(64)}`;
const { entryInputFingerprint: _token, ...withoutToken } = automaticScore("posts:no-token");
assert.equal(sessionScoreMatchesIdentity(withoutToken as SeoAdminContentScore, serverIdentity), false, "a result without the entry input token is never confirmed");

// ---- One explicit refresh with changed inputs sends exactly one request ----
const refreshCalls: Array<{ options: EditorSessionAnalysisOptions; signal: AbortSignal; result: Deferred<SeoAdminContentScore> }> = [];
const refreshStates: EditorSessionAnalysisState[] = [];
const oneClick = createEditorSessionAnalysis({
	ref: "posts:one-click", savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	analysisOptions: { keywords: ["bread"], pillar: false },
	currentIdentity: (requestedRef) => validationIdentity(requestedRef),
	onChange: (state) => refreshStates.push(state),
	analyze: (_ref, signal, options) => {
		const result = deferred<SeoAdminContentScore>();
		refreshCalls.push({ options, signal, result });
		return result.promise;
	},
});
const firstRun = oneClick.analyze();
refreshCalls[0].result.resolve({ ...automaticScore("posts:one-click"), keywords: ["bread"], profileKeywords: ["bread"] });
await firstRun;
assert.equal(refreshStates.at(-1)?.score?.freshness, "current", "control: an accepted result enables automatic runs");
const changedInputs = oneClick.analyze({ keywords: ["sourdough"], pillar: true });
assert.equal(refreshCalls.length, 2, "one explicit refresh with changed inputs sends one request, not an automatic run plus a forced one");
assert.deepEqual(refreshCalls[1].options, { keywords: ["sourdough"], pillar: true }, "the request uses the newest inputs");
refreshCalls[1].result.resolve(automaticScore("posts:one-click"));
await changedInputs;
const heldFirst = oneClick.analyze();
assert.equal(refreshCalls.length, 3);
const afterHeld = oneClick.analyze({ keywords: ["rye"], pillar: false });
assert.equal(refreshCalls.length, 4, "a refresh while a request is held cancels it and sends one new request");
assert.equal(refreshCalls[2].signal.aborted, true);
assert.deepEqual(refreshCalls[3].options, { keywords: ["rye"], pillar: false });
refreshCalls[2].result.resolve(automaticScore("posts:one-click"));
refreshCalls[3].result.resolve(automaticScore("posts:one-click"));
await Promise.all([heldFirst, afterHeld]);
assert.equal(refreshCalls.length, 4);
assert.equal(oneClick.hasAnalysisOptions({ keywords: ["rye"], pillar: false }), true);
assert.equal(refreshStates.at(-1)?.score?.freshness, "current");
const requestsBeforeInvalidate = refreshCalls.length;
oneClick.invalidate();
assert.equal(refreshStates.at(-1)?.score?.freshness, "stale", "a failed read elsewhere withdraws the current claim");
assert.equal(refreshCalls.length, requestsBeforeInvalidate, "invalidating sends no request");
oneClick.cancel();

// ---- A failed or denied refresh keeps the last result only as stale ----
let refreshFails = false;
const failingRefresh = createEditorSessionAnalysis({
	ref: "posts:failing-refresh", savedUpdatedAt: savedVersions[4], savedVersion: "saved-1",
	currentIdentity: (requestedRef) => validationIdentity(requestedRef),
	onChange: (state) => resumeStates.push(state),
	analyze: async (requestedRef) => {
		if (refreshFails) throw new Error("You do not have permission to analyze this entry.");
		return automaticScore(requestedRef);
	},
});
await failingRefresh.start();
assert.equal(resumeStates.at(-1)?.score?.freshness, "current");
refreshFails = true;
await failingRefresh.analyze();
assert.deepEqual(
	[resumeStates.at(-1)?.score?.freshness, resumeStates.at(-1)?.score?.ref, resumeStates.at(-1)?.error],
	["stale", "posts:failing-refresh", "You do not have permission to analyze this entry."],
	"a failed refresh never shows the earlier result as current beside its error",
);
failingRefresh.cancel();

const verificationReads: string[] = [];
const firstVerification = deferred<string | null>();
const verification = verifySavedContentVersions([
	{ ref: "posts:stable", sourceVersion: "stable-version" },
	{ ref: "posts:changed", sourceVersion: "old-version" },
	{ ref: "posts:deleted", sourceVersion: "deleted-version" },
	{ ref: "posts:unavailable", sourceVersion: "unavailable-version" },
], async (ref) => {
	verificationReads.push(ref);
	if (ref === "posts:stable") return firstVerification.promise;
	if (ref === "posts:changed") return "new-version";
	if (ref === "posts:deleted") return null;
	throw new Error("Temporary read failure");
});
assert.deepEqual(verificationReads, ["posts:stable"], "post-analysis verification must read exact entries sequentially");
firstVerification.resolve("stable-version");
const verified = await verification;
assert.deepEqual(verified.items.map((item) => item.ref), ["posts:stable"]);
assert.deepEqual(verified.failures, [
	{ ref: "posts:changed", error: "saved_content_changed" },
	{ ref: "posts:deleted", error: "content_not_found" },
	{ ref: "posts:unavailable", error: "saved_content_unavailable" },
]);
assert.deepEqual(verificationReads, ["posts:stable", "posts:changed", "posts:deleted", "posts:unavailable"]);
const verificationAbort = new AbortController();
await assert.rejects(verifySavedContentVersions([{ ref: "posts:cancelled", sourceVersion: "same" }], async () => {
	verificationAbort.abort();
	return "same";
}, verificationAbort.signal), { name: "AbortError" });

// The list's accessible name and its visible badge must share assessment scope.
const columnBlock = (text: string, extra: Record<string, unknown> = {}) => ({
	_type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text, marks: [] }], ...extra,
});
const columnControlInput: SeoAnalysisInput = {
	ref: "posts:column-control", collection: "posts", entryId: "column-control", slug: "growth-marketing-strategy",
	title: "Growth marketing strategy for measurable demand",
	description: "A practical growth marketing strategy that connects search, content, paid media and measurement to build qualified demand and sustainable growth.",
	url: "https://example.invalid/blog/growth-marketing-strategy", noindex: false, publicationStatus: "published",
	image: "https://example.invalid/social.jpg", featuredImage: "https://example.invalid/featured.jpg",
	body: Array.from({ length: 750 }, () => "useful").join(" "),
	document: [
		columnBlock("Growth marketing strategy foundations", { style: "h2" }),
		{ _type: "image", asset: { _ref: "media:column-image", mimeType: "image/webp" }, alt: "A search visibility dashboard" },
		columnBlock("", {
			markDefs: [
				{ _key: "internal", _type: "link", href: "/services/search" },
				{ _key: "external", _type: "link", href: "https://developers.google.com/search" },
			],
			children: [
				{ _type: "span", text: "Review our ", marks: [] },
				{ _type: "span", text: "search service", marks: ["internal"] },
				{ _type: "span", text: " alongside ", marks: [] },
				{ _type: "span", text: "search documentation", marks: ["external"] },
				{ _type: "span", text: ".", marks: [] },
			],
		}),
		...Array.from({ length: 60 }, () => columnBlock("Useful audience research connects clear messaging, measurement, channel strategy, and sustained demand.")),
	],
	focusKeywords: [], assessmentProfile: { profile: "article", version: 1 },
	schemaEnabled: true, schemaPreset: "BlogPosting", imageSeoEnabled: true,
};
const asColumnScore = (input: SeoAnalysisInput): SeoAdminContentScore => ({
	...analyzeSeoContent(input), analysisRevision: 1, updatedAt: "2026-10-17T10:00:00.000Z",
	templateUpdatedAt: null, modulesUpdatedAt: null, metaOverrideUpdatedAt: null,
	configurationFingerprint: "seo-config-v1-00000000", freshness: "current",
});
const columnControl = asColumnScore(columnControlInput);
const columnLimited = asColumnScore({
	...columnControlInput, body: "A useful note.", document: [columnBlock("A useful note.")],
	assessmentProfile: { profile: "general", version: 1 }, imageSeoEnabled: false,
});
const columnTemplate = asColumnScore({ ...columnControlInput, document: undefined, body: "", bodySource: "template" });
assert.equal(columnControl.score, 100, "the numeric control must earn its value from the analyzer");
assert.equal(seoAnalysisSummary(columnControl).numericBadgeAvailable, true);
assert.equal(columnLimited.score, 94, "a short General entry keeps its weighted result in details; Internal links is Partly met");
assert.equal(seoAnalysisSummary(columnLimited).numericBadgeAvailable, false);
assert.equal(seoAnalysisSummary(columnLimited).label, "Too little text to score");
assert.equal(seoAnalysisSummary(columnTemplate).label, "Partially checked");
const columnCases = [
	{ name: "too little text", score: columnLimited, prefix: "Too little text to score", qualifier: "3 words of body text", freshness: "current", badge: "-" },
	{ name: "partially checked", score: columnTemplate, prefix: "Partially checked", qualifier: "weighted checks not checked", freshness: "current", badge: "-" },
	{ name: "unverified stored", score: { ...columnControl, freshness: undefined }, prefix: "Saved SEO score", qualifier: "Current content not checked", freshness: "unknown", badge: "-" },
	{ name: "stale", score: { ...columnControl, freshness: "stale" as const }, prefix: "Last known SEO score", qualifier: "Current content not checked", freshness: "stale", badge: "-" },
	{ name: "earlier analyzer", score: { ...columnControl, scoreVersion: SEO_SCORE_VERSION - 1 }, prefix: "Earlier analyzer", qualifier: "Analyze again.", freshness: "stale", badge: "Earlier analyzer" },
];
const columnBefore = JSON.stringify([columnControl, columnLimited, columnCases]);
for (const { name, score, prefix, qualifier, freshness, badge } of columnCases) {
	const presentation = contentScoreColumnPresentation(score);
	assert.ok(presentation.description.startsWith(prefix), name + ": " + presentation.description);
	assert.ok(presentation.description.includes(presentation.label), name);
	assert.ok(presentation.description.includes(qualifier), name);
	assert.doesNotMatch(presentation.description, /\d+\/100/, name + " cannot announce an unavailable numeric badge");
	assert.equal(presentation.badgeText, badge, name);
	assert.equal(presentation.freshness, freshness, name);
}
assert.equal(contentScoreColumnPresentation({ ...columnControl, scoreVersion: SEO_SCORE_VERSION - 1 }).description, "Earlier analyzer. Analyze again.");
const columnNumeric = contentScoreColumnPresentation(columnControl);
assert.equal(columnNumeric.qualifier, "No focus keyword");
assert.equal(columnNumeric.badgeText, "100", "an unset keyword never hides the number");
assert.equal(columnNumeric.description, "Good: 100/100. No focus keyword");
const columnKeyword = contentScoreColumnPresentation(asColumnScore({ ...columnControlInput, focusKeywords: ["growth marketing strategy"] }));
assert.deepEqual([columnKeyword.label, columnKeyword.qualifier, columnKeyword.badgeText], ["Good", null, String(asColumnScore({ ...columnControlInput, focusKeywords: ["growth marketing strategy"] }).score)]);
assert.equal(JSON.stringify([columnControl, columnLimited, columnCases]), columnBefore);

// Extract and render the actual native column pill, rather than a test-only layout.
const columnSource = await readFile(new URL("./content-extensions.tsx", import.meta.url), "utf8");
const columnAst = ts.createSourceFile("content-extensions.tsx", columnSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const columnPills = columnAst.statements.filter((statement): statement is ts.FunctionDeclaration =>
	ts.isFunctionDeclaration(statement) && statement.name?.text === "ScorePill");
assert.equal(columnPills.length, 1, "one production native score pill");
const columnPillSource = columnPills[0].getText(columnAst);
assert.match(columnPillSource, /contentScoreColumnPresentation\(score\)/);
const columnCompiled = ts.transpileModule(columnPillSource + "\nmodule.exports = { ScorePill };", {
	fileName: "content-score-column-probe.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(columnCompiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const columnModule = { exports: {} };
new Function("require", "module", "exports", "React", "ArrowsClockwise", "contentScoreColumnPresentation", columnCompiled.outputText)(
	createRequire(import.meta.resolve("react")), columnModule, columnModule.exports, React, ArrowsClockwise, contentScoreColumnPresentation,
);
const { ScorePill: ColumnPill } = columnModule.exports as { ScorePill: React.ComponentType<{ score: SeoAdminContentScore }> };
for (const { name, score } of columnCases) {
	const expected = contentScoreColumnPresentation(score);
	const html = renderToStaticMarkup(React.createElement(ColumnPill, { score }));
	assert.ok(html.includes('title="' + expected.description + '"'), name + " title");
	assert.ok(html.includes('aria-label="' + expected.description + '"'), name + " accessible name");
	assert.ok(html.includes('data-freshness="' + expected.freshness + '"'), name + " freshness");
	assert.ok(html.endsWith(">" + expected.badgeText + "</span>"), name + " visible badge");
	assert.doesNotMatch(html, /\d+\/100/, name + " cannot reintroduce an unqualified score through markup");
}
const columnNumericHtml = renderToStaticMarkup(React.createElement(ColumnPill, { score: columnControl }));
assert.match(columnNumericHtml, /title="Good: 100\/100. No focus keyword"/);
assert.match(columnNumericHtml, /aria-label="Good: 100\/100. No focus keyword"/);
assert.match(columnNumericHtml, /data-freshness="current"/);
assert.match(columnNumericHtml, />100<\/span>$/);

console.log("SEO content score column self-check passed.");
