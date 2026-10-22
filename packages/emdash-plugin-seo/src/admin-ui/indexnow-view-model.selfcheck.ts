import assert from "node:assert/strict";
import { IndexNowDeliveryTimeoutError } from "../indexnow-delivery.ts";

import { defaultIndexNowSettings } from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	INDEXNOW_MANUAL_TEXT_LIMIT,
	equalIndexNowScope,
	eligibleIndexNowScope,
	finishIndexNowHistoryRequest,
	indexNowContentTypeRuleNote,
	indexNowCountsSummary,
	indexNowDisplayUrl,
	indexNowEventLabel,
	indexNowHistoryRange,
	indexNowHttpResult,
	indexNowScopeRows,
	indexNowSubmissionPresentation,
	indexNowSubmissionSummary,
	indexNowUrlIssueSummary,
	initialIndexNowHistoryState,
	isNewerIndexNowStatus,
	legacyIndexNowDeliveries,
	parseIndexNowUrlList,
	receiveIndexNowStatus,
	reconcileIndexNowFieldDraft,
	remainingIndexNowUrlList,
	startIndexNowHistoryRequest,
	submittableIndexNowTypes,
	toggleIndexNowScope,
	equalIndexNowSettings,
	unavailableIndexNowSelectedTypes,
	reconcileGeneratedIndexNowDraft,
	reconcileIndexNowDraft,
	reconcileSavedIndexNowDraft,
	INDEXNOW_ADVANCED_FIELDS,
} from "./indexnow-view-model.ts";

const persisted = {
	...defaultIndexNowSettings(),
	apiKey: "persisted-key",
};
const dirty = {
	...persisted,
	enabled: true,
	batchSize: 321,
};
const generated = {
	...persisted,
	apiKey: "generated-key",
};
assert.equal(equalIndexNowSettings(persisted, { ...persisted, autoSubmitContentTypes: ["pages"] }), false);
assert.equal(equalIndexNowSettings(
	{ ...persisted, autoSubmitContentTypes: ["pages"] },
	{ ...persisted, autoSubmitContentTypes: ["pages"] },
), true);
assert.deepEqual(unavailableIndexNowSelectedTypes(["pages", "retired"], [{ collection: "pages" }]), ["retired"]);
assert.deepEqual(unavailableIndexNowSelectedTypes(null, [{ collection: "pages" }]), []);
// Null keeps every eligible type, an empty list selects none, and explicit
// lists compare as sets.
assert.equal(equalIndexNowScope(null, null), true);
assert.equal(equalIndexNowScope(null, []), false);
assert.equal(equalIndexNowScope([], []), true);
assert.equal(equalIndexNowScope(["pages", "posts"], ["posts", "pages"]), true);
assert.equal(equalIndexNowScope(["pages"], ["pages", "posts"]), false);
assert.deepEqual(toggleIndexNowScope(null, "guides", false, ["pages", "posts", "guides"]), ["pages", "posts"],
	"changing one box turns the all-eligible selection into the explicit list shown");
assert.deepEqual(toggleIndexNowScope(["pages"], "posts", true, ["pages", "posts"]), ["pages", "posts"]);
assert.deepEqual(toggleIndexNowScope(["pages"], "pages", true, ["pages"]), ["pages"]);
assert.deepEqual(eligibleIndexNowScope(null, ["pages", "guides"]), ["pages", "guides"]);
assert.deepEqual(eligibleIndexNowScope([], ["pages", "guides"]), []);
assert.deepEqual(eligibleIndexNowScope(["pages", "posts"], ["pages", "guides"]), ["pages"], "missing default types are ignored");
const available = [
	{ collection: "pages", label: "Pages" },
	{ collection: "posts", label: "Posts" },
	{ collection: "guides", label: "Guides" },
];
assert.deepEqual(indexNowScopeRows(available, ["pages", "posts"], ["pages", "posts", "guides"]).map((row) => [row.collection, row.checked, row.state]), [
	["pages", true, "saved"], ["posts", true, "saved"], ["guides", true, "unsaved"],
]);
assert.deepEqual(indexNowScopeRows(available, null, null).map((row) => row.state), ["saved", "saved", "saved"]);
assert.deepEqual(indexNowScopeRows(available, ["pages"], []).map((row) => row.state), ["unsaved", null, null]);
// A content type noindex rule marks its row and leaves it out of what automatic submission can use; the choice stays.
{
	const rules = [{ collection: "posts", label: "Posts", urlPattern: "/blog/{slug}" }, { collection: "events", label: "Events", urlPattern: "/events/{slug}" }];
	assert.deepEqual(indexNowScopeRows(available, ["pages", "posts"], ["pages", "posts"], rules).map((row) => [row.collection, row.checked, row.state, row.noindexRule]), [
		["pages", true, "saved", false], ["posts", true, "saved", true], ["guides", false, null, false],
	]);
	assert.deepEqual(indexNowScopeRows(available, null, null).map((row) => row.noindexRule), [false, false, false], "no rules, no marks");
	const names = available.map((item) => item.collection);
	const submittable = submittableIndexNowTypes(names, rules);
	assert.deepEqual(submittable, ["pages", "guides"]);
	assert.deepEqual(submittableIndexNowTypes(names, undefined), names, "an unreadable rule state leaves out nothing");
	assert.deepEqual(eligibleIndexNowScope(["posts"], submittable), [], "a scope of only ruled types submits nothing");
	assert.deepEqual(toggleIndexNowScope(null, "guides", false, names), ["pages", "posts"], "the ruled choice survives turning the default into a list");
	assert.equal(indexNowContentTypeRuleNote(rules),
		"URLs whose address matches a content type with a noindex rule in Indexing rules are not submitted: Posts (/blog/{slug}), Events (/events/{slug}).");
	assert.equal(indexNowContentTypeRuleNote([]), null);
	assert.equal(indexNowContentTypeRuleNote(undefined), null);
}
const persistedSnapshot = {
	values: persisted,
	updatedAt: "2026-08-14T10:00:00.000Z",
};
const generatedSnapshot = {
	values: generated,
	updatedAt: "2026-08-14T10:00:00.001Z",
};
const dirtyState = {
	values: dirty,
	baseUpdatedAt: persistedSnapshot.updatedAt,
};

assert.deepEqual(
	reconcileIndexNowDraft(null, null, persistedSnapshot),
	{ values: persisted, baseUpdatedAt: persistedSnapshot.updatedAt },
	"the initial status must seed the draft",
);
assert.equal(
	reconcileIndexNowDraft(dirtyState, persistedSnapshot, generatedSnapshot),
	dirtyState,
	"status-only responses must preserve the current draft and its base revision",
);
assert.deepEqual(
	reconcileIndexNowDraft(
		{ values: persisted, baseUpdatedAt: "2026-08-14T09:59:59.999Z" },
		persistedSnapshot,
		persistedSnapshot,
	),
	{ values: persisted, baseUpdatedAt: persistedSnapshot.updatedAt },
	"a clean status refresh must advance the draft revision",
);
const externallyChanged = {
	...persisted,
	autoSubmit: !persisted.autoSubmit,
};
const externallyChangedSnapshot = {
	values: externallyChanged,
	updatedAt: "2026-08-14T10:00:00.002Z",
};
assert.deepEqual(
	reconcileIndexNowDraft(
		{ values: persisted, baseUpdatedAt: persistedSnapshot.updatedAt },
		persistedSnapshot,
		externallyChangedSnapshot,
	),
	{ values: externallyChanged, baseUpdatedAt: externallyChangedSnapshot.updatedAt },
	"a clean draft must adopt settings changed by another session",
);
assert.deepEqual(
	reconcileGeneratedIndexNowDraft(dirtyState, dirty, generatedSnapshot),
	{
		values: { ...dirty, apiKey: generated.apiKey },
		baseUpdatedAt: generatedSnapshot.updatedAt,
	},
	"key generation must preserve unrelated unsaved settings",
);
assert.deepEqual(
	reconcileGeneratedIndexNowDraft(
		{ values: persisted, baseUpdatedAt: persistedSnapshot.updatedAt },
		persisted,
		generatedSnapshot,
	),
	{ values: generated, baseUpdatedAt: generatedSnapshot.updatedAt },
	"key generation from a clean draft must adopt the saved settings",
);

const editedDuringRequest = {
	...dirty,
	minIntervalSeconds: 901,
};
assert.deepEqual(
	reconcileGeneratedIndexNowDraft(
		{ values: editedDuringRequest, baseUpdatedAt: persistedSnapshot.updatedAt },
		dirty,
		generatedSnapshot,
	),
	{
		values: { ...editedDuringRequest, apiKey: generated.apiKey },
		baseUpdatedAt: generatedSnapshot.updatedAt,
	},
	"edits made while key generation is in flight must survive its response",
);
const keyEditedDuringRequest = {
	...editedDuringRequest,
	apiKey: "newer-manual-key",
};
assert.equal(
	reconcileGeneratedIndexNowDraft(
		{ values: keyEditedDuringRequest, baseUpdatedAt: persistedSnapshot.updatedAt },
		dirty,
		generatedSnapshot,
	).values.apiKey,
	keyEditedDuringRequest.apiKey,
	"a key typed while generation is in flight must survive its response",
);
assert.equal(
	reconcileIndexNowDraft(
		{ values: editedDuringRequest, baseUpdatedAt: persistedSnapshot.updatedAt },
		persistedSnapshot,
		null,
	)?.values,
	editedDuringRequest,
	"a failed request must leave the draft unchanged",
);
assert.equal(equalIndexNowSettings(persisted, { ...persisted }), true);
assert.deepEqual(
	reconcileSavedIndexNowDraft(
		{ values: persisted, baseUpdatedAt: persistedSnapshot.updatedAt },
		persisted,
		generatedSnapshot,
	),
	{ values: generated, baseUpdatedAt: generatedSnapshot.updatedAt },
	"a completed save must adopt persisted values when the draft has not changed",
);
assert.deepEqual(
	reconcileSavedIndexNowDraft(
		{ values: editedDuringRequest, baseUpdatedAt: persistedSnapshot.updatedAt },
		dirty,
		generatedSnapshot,
	),
	{ values: editedDuringRequest, baseUpdatedAt: generatedSnapshot.updatedAt },
	"edits made while a save is in flight must survive its response",
);

const site = "https://example.com";
assert.deepEqual(parseIndexNowUrlList("\n \t\r\n", null), { urls: [], duplicates: 0, invalid: [], error: null });
assert.deepEqual(parseIndexNowUrlList(" https://EXAMPLE.com/one#section \r\n\r\nhttps://example.com/two\r/one\n/three", site), {
	urls: ["https://example.com/one", "https://example.com/two", "https://example.com/three"], duplicates: 1, invalid: [], error: null,
});
for (const [url, reason] of [
	["relative", "format"], ["javascript:alert(1)", "format"], ["//example.com/x", "format"],
	["https://other.example.com/", "other-site"], ["http://example.com/insecure", "other-site"],
	["https://user:pass@example.com/", "format"], ["https://example.com:8443/", "other-site"],
	["https://example.com/path with spaces", "format"], ["https://example.com/a\\b", "format"],
	[`https://example.com/${"a".repeat(2_048)}`, "too-long"],
] as const) {
	const parsed = parseIndexNowUrlList(`https://example.com/valid\n\n${url}`, site);
	assert.equal(parsed.error, null, "invalid lines do not block the valid ones");
	assert.deepEqual(parsed.urls, ["https://example.com/valid"]);
	assert.deepEqual(parsed.invalid, [{ line: 3, text: url, reason }], url);
}
assert.match(parseIndexNowUrlList("https://example.com/", null).error!, /public address/);
assert.equal(parseIndexNowUrlList(Array.from({ length: 1_000 }, (_, i) => `/${i}`).join("\n"), site).error, null);
assert.match(parseIndexNowUrlList(Array.from({ length: 1_001 }, (_, i) => `/${i}`).join("\n"), site).error!, /1,000/);
assert.match(parseIndexNowUrlList("x".repeat(INDEXNOW_MANUAL_TEXT_LIMIT + 1), site).error!, /too large/);
const manyBad = parseIndexNowUrlList(Array.from({ length: 8 }, () => "bad").join("\n"), site);
assert.equal(manyBad.invalid.length, 8);
assert.match(indexNowUrlIssueSummary(manyBad.invalid)!, /^Line 1: not a complete URL.*And 3 more\.$/);
assert.equal(indexNowUrlIssueSummary([]), null);
const submittedList = "https://example.com/a\nnot a url\nhttps://example.com/b";
const submittedParse = parseIndexNowUrlList(submittedList, site);
assert.equal(remainingIndexNowUrlList(submittedList, submittedList, { success: true, rejected: [] }, submittedParse.invalid), "not a url",
	"lines left out stay for correction");
assert.equal(remainingIndexNowUrlList(submittedList, submittedList, { success: true, rejected: ["https://example.com/b"] }, submittedParse.invalid),
	"not a url\nhttps://example.com/b");
assert.equal(remainingIndexNowUrlList(submittedList, submittedList, { success: false }, submittedParse.invalid), submittedList);
assert.equal(remainingIndexNowUrlList(`${submittedList}\n/c`, submittedList, { success: true, rejected: [] }), `${submittedList}\n/c`,
	"edits made during the request are kept");
assert.match(indexNowSubmissionSummary({ enqueued: 101, skipped: 2, rejected: ["bad"] }, { invalid: 1 }),
	/^101 URLs queued\. 2 URLs skipped because they were submitted recently\. 2 URLs kept in the list for correction\./);
assert.doesNotMatch(indexNowSubmissionSummary({ enqueued: 101, skipped: 0, rejected: [] }), /indexed|delivered/i);
assert.match(indexNowSubmissionSummary({ enqueued: 101, skipped: 0, rejected: [] }, { waiting: 1, background: false }),
	/1 URL wait\. Use Send waiting URLs/);
assert.match(indexNowSubmissionSummary({ enqueued: 101, skipped: 0, rejected: [] }, { waiting: 1, background: true }),
	/1 URL wait for the next batch/);
assert.match(indexNowSubmissionSummary({ enqueued: 1, skipped: 0, rejected: [], history: "unavailable" }), /history is unavailable/);
assert.match(indexNowSubmissionSummary({ enqueued: 1, skipped: 0, rejected: [], history: "partial" }), /could not be fully recorded/);
assert.match(indexNowSubmissionSummary({ enqueued: 1, skipped: 0, rejected: [], contentTypeNoindexUrls: ["/blog/a", "/blog/b"] }),
	/^1 URL queued\. 2 URLs not submitted because their addresses match a content type with a noindex rule in Indexing rules\./);
assert.match(indexNowSubmissionSummary({ enqueued: 0, skipped: 0, rejected: [], contentTypeNoindexUrls: ["/blog/a"] }),
	/^0 URLs queued\. 1 URL not submitted because its address matches a content type with a noindex rule/);
assert.doesNotMatch(indexNowSubmissionSummary({ enqueued: 1, skipped: 0, rejected: [], contentTypeNoindexUrls: [] }), /noindex/);
assert.equal(remainingIndexNowUrlList("/blog/a\n/about", "/blog/a\n/about", { success: true, rejected: [] }), "",
	"withheld URLs leave the list with the queued ones");

// Two drafts share one settings revision: saving one rebases the other only
// when the server left its fields unchanged.
const rev1 = { values: { ...persisted, enabled: true, autoSubmitContentTypes: ["pages"] }, updatedAt: "2026-10-02T09:00:00.000Z" };
const advancedDirty = { values: { ...rev1.values, batchSize: 50 }, baseUpdatedAt: rev1.updatedAt };
const scopeSaved = { values: { ...rev1.values, autoSubmitContentTypes: ["pages", "guides"] }, updatedAt: "2026-10-02T09:00:01.000Z" };
assert.deepEqual(reconcileIndexNowFieldDraft(advancedDirty, rev1, scopeSaved, INDEXNOW_ADVANCED_FIELDS), {
	values: { ...scopeSaved.values, batchSize: 50 }, baseUpdatedAt: scopeSaved.updatedAt,
}, "an advanced edit survives a scope save and moves to its revision");
const scopeDirty = { values: { ...rev1.values, autoSubmitContentTypes: ["pages", "posts"] }, baseUpdatedAt: rev1.updatedAt };
const advancedSaved = { values: { ...rev1.values, maxAttempts: 7 }, updatedAt: "2026-10-02T09:00:02.000Z" };
assert.deepEqual(reconcileIndexNowFieldDraft(scopeDirty, rev1, advancedSaved, ["autoSubmitContentTypes"]).values.autoSubmitContentTypes, ["pages", "posts"]);
const otherSession = { values: { ...rev1.values, batchSize: 75 }, updatedAt: "2026-10-02T09:00:03.000Z" };
assert.equal(reconcileIndexNowFieldDraft(advancedDirty, rev1, otherSession, INDEXNOW_ADVANCED_FIELDS), advancedDirty,
	"a conflicting change keeps the draft and its stale base so the save reports the conflict");
assert.deepEqual(reconcileIndexNowFieldDraft({ values: rev1.values, baseUpdatedAt: rev1.updatedAt }, rev1, otherSession, INDEXNOW_ADVANCED_FIELDS),
	{ values: otherSession.values, baseUpdatedAt: otherSession.updatedAt }, "a clean draft follows the server");

// Responses arrive out of order: history never touches drafts and an older
// status never moves a draft or its base revision backwards.
const status = (snapshot: { values: any; updatedAt: string }, generatedAt: string) => ({ ...snapshot, generatedAt });
let view = receiveIndexNowStatus({ status: null, advanced: null, scope: null }, status(rev1, "2026-10-02T09:00:00.100Z"));
view = { ...view, advanced: { values: { ...view.advanced!.values, batchSize: 40 }, baseUpdatedAt: view.advanced!.baseUpdatedAt } };
const dirtyBefore = view.advanced;
let history = initialIndexNowHistoryState();
const firstRequest = startIndexNowHistoryRequest(history, { kind: "reload" })!;
history = firstRequest.state;
const filterRequest = startIndexNowHistoryRequest(history, { kind: "filters", status: "failed", source: null })!;
history = filterRequest.state;
const historyPage = (items: any[], cursor: string | null) => ({
	contractVersion: 20, engineVersion: "test", generatedAt: "2026-10-02T09:00:05.000Z", available: true,
	filters: { status: null, source: null }, pageSize: 10, total: 25, items, cursor, hasMore: cursor !== null,
	maxAttempts: 5, retention: 500, historyStartedAt: null,
}) as any;
const lateHistory = finishIndexNowHistoryRequest(history, firstRequest.request, { success: true, history: historyPage([], "late") });
assert.equal(lateHistory, history, "a late history response for an older request is ignored");
assert.equal(view.advanced, dirtyBefore, "history responses never reach the settings draft");
view = receiveIndexNowStatus(view, status(scopeSaved, "2026-10-02T09:00:06.000Z"));
assert.equal(view.advanced!.values.batchSize, 40);
assert.equal(view.advanced!.baseUpdatedAt, scopeSaved.updatedAt);
const lateStatus = receiveIndexNowStatus(view, status(rev1, "2026-10-02T09:00:07.000Z"));
assert.equal(lateStatus, view, "an older settings revision arriving late is ignored");
assert.equal(isNewerIndexNowStatus(status(rev1, "b"), status(rev1, "a")), false);
assert.equal(isNewerIndexNowStatus(status(rev1, "a"), status(rev1, "b")), true, "the same revision with fresh queue counts applies");
history = finishIndexNowHistoryRequest(history, filterRequest.request, { success: true, history: historyPage([{ id: "x" }], "page-2") });
assert.equal(history.loading, false);
assert.deepEqual(indexNowHistoryRange(history), { from: 1, to: 1, total: 25 });
const nextRequest = startIndexNowHistoryRequest(history, { kind: "next" })!;
assert.equal(nextRequest.request.cursor, "page-2");
assert.equal(nextRequest.request.status, "failed", "the cursor continues the filter it was issued for");
history = finishIndexNowHistoryRequest(nextRequest.state, nextRequest.request, { success: true, history: historyPage([{ id: "y" }], null) });
assert.deepEqual(indexNowHistoryRange(history), { from: 11, to: 11, total: 25 });
assert.equal(startIndexNowHistoryRequest(history, { kind: "next" }), null, "the final page has no next request");
const previous = startIndexNowHistoryRequest(history, { kind: "previous" })!;
assert.equal(previous.request.cursor, null);
const expired = finishIndexNowHistoryRequest(previous.state, previous.request, { success: false, error: "invalid_cursor", detail: "Load the first page again." });
assert.deepEqual([expired.pageIndex, expired.cursors, expired.page], [0, [null], null]);

// History rows say what was sent; they never claim indexing.
const presentation = (entry: any) => indexNowSubmissionPresentation(entry, 5, (value) => value.slice(11, 16));
assert.deepEqual(presentation({ status: "queued", attempts: 0, nextAttemptAt: null, lastDetail: null }), { label: "Queued", tone: "neutral", detail: "Waiting for the next batch" });
assert.deepEqual(presentation({ status: "retry", attempts: 1, nextAttemptAt: "2026-10-02T08:45:00.000Z", lastDetail: null }),
	{ label: "Retry scheduled", tone: "warning", detail: "Next attempt 08:45, attempt 2 of 5" });
assert.deepEqual(presentation({ status: "accepted", attempts: 1, nextAttemptAt: null, lastDetail: null }), { label: "Accepted", tone: "info", detail: "Key validation pending" });
assert.deepEqual(presentation({ status: "failed", attempts: 5, nextAttemptAt: null, lastDetail: "x" }), { label: "Failed", tone: "error", detail: "Stopped after 5 attempts. x" });
const timeoutDetail = new IndexNowDeliveryTimeoutError().message;
const retryTimeout = presentation({ status: "retry", attempts: 1, nextAttemptAt: "2026-10-02T08:45:00.000Z", lastDetail: timeoutDetail });
assert.equal(retryTimeout.label, "Retry scheduled");
assert.equal(retryTimeout.detail, `Next attempt 08:45, attempt 2 of 5. ${timeoutDetail}`,
	"a pending retry keeps its schedule and the backend's unknown-acceptance explanation");
const finalDetail = `Retry limit reached after 5 attempts. ${timeoutDetail}`;
const finalTimeout = presentation({ status: "failed", attempts: 5, nextAttemptAt: null, lastDetail: finalDetail });
assert.equal(finalTimeout.label, "Failed");
assert.equal(finalTimeout.detail, `Stopped after 5 attempts. ${finalDetail}`,
	"exhausting local attempts never hides the provider's unknown acceptance or duplicate-retry warning");
assert.equal(presentation({ status: "retry", attempts: 2, nextAttemptAt: null, lastDetail: "Provider temporarily unavailable." }).detail,
	"attempt 3 of 5. Provider temporarily unavailable.", "other retry reasons use the same presentation");
assert.equal(presentation({ status: "failed", attempts: 1, nextAttemptAt: null, lastDetail: "The provider refused this request." }).detail,
	"The provider refused this request.");
assert.equal(presentation({ status: "failed", attempts: 5, nextAttemptAt: null, lastDetail: "  " }).detail,
	"Stopped after 5 attempts", "missing reasons retain useful attempt counts");
const oversizedDetail = presentation({ status: "failed", attempts: 1, nextAttemptAt: null, lastDetail: "x".repeat(1_000) }).detail!;
assert.equal(oversizedDetail.length, 500, "one stored explanation cannot expand a history row without a bound");
assert.ok(oversizedDetail.endsWith("..."));
for (const value of ["queued", "retry", "sent", "accepted", "failed", "superseded"])
	assert.doesNotMatch(JSON.stringify(presentation({ status: value, attempts: 1, nextAttemptAt: null, lastDetail: null })), /indexed/i);
assert.equal(indexNowHttpResult({ lastHttpStatus: null, lastAttemptAt: null }), "None yet");
assert.equal(indexNowHttpResult({ lastHttpStatus: null, lastAttemptAt: "2026-10-02T08:00:00.000Z" }), "No response");
assert.equal(indexNowHttpResult({ lastHttpStatus: 202, lastAttemptAt: "2026-10-02T08:00:00.000Z" }), "202");
assert.equal(indexNowEventLabel(null), "Not set");
assert.equal(indexNowEventLabel("url-change"), "Address changed");
assert.equal(indexNowCountsSummary({ urlCount: 3, counts: { queued: 0, retrying: 0, sent: 3, accepted: 0, failed: 0, skipped: 0, superseded: 0 } }), null);
assert.equal(indexNowCountsSummary({ urlCount: 12, counts: { queued: 0, retrying: 0, sent: 10, accepted: 0, failed: 0, skipped: 2, superseded: 0 } }), "10 sent, 2 skipped as recent");
assert.equal(indexNowDisplayUrl("https://example.com/blog/a?x=1", "https://example.com"), "/blog/a?x=1");
assert.equal(indexNowDisplayUrl("https://other.example/a", "https://example.com"), "https://other.example/a");
const deliveries = [{ createdAt: "2026-10-01T00:00:00.000Z" }, { createdAt: "2026-10-03T00:00:00.000Z" }] as any[];
assert.equal(legacyIndexNowDeliveries(deliveries, "2026-10-02T00:00:00.000Z").length, 1, "only records before history are shown as earlier requests");
assert.equal(legacyIndexNowDeliveries(deliveries, null).length, 2);

console.log("IndexNow view model self-check passed.");
