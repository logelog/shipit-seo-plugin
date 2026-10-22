import assert from "node:assert/strict";

import {
	SEO_PROFILE_FAILED_MESSAGE,
	SEO_PROFILE_OFFLINE_MESSAGE,
	SeoProfileSaveError,
	classifyProfileSaveFailure,
	deriveProfileSaveState,
	keywordListsMatch,
	keywordOwnershipView,
	keywordStatementFromScore,
	keywordStatementsMatch,
	profileSaveErrorFromRoute,
	scoreMatchesProfile,
} from "./keyword-profile.ts";
import * as keywordProfile from "./keyword-profile.ts";

// --- Statements -------------------------------------------------------------

assert.equal(keywordStatementsMatch(null, null), true);
assert.equal(keywordStatementsMatch(null, []), false, "null is not an empty statement");
assert.equal(keywordStatementsMatch([], null), false);
assert.equal(keywordStatementsMatch([], []), true);
assert.equal(keywordStatementsMatch(["A B"], ["a  b"]), true, "identity comparison tolerates case/spacing");
assert.equal(keywordStatementsMatch(["a"], ["a", "b"]), false);
assert.equal(keywordListsMatch(["kw"], ["KW"]), true);
assert.equal(scoreMatchesProfile({ profileKeywords: ["kw"], pillar: false }, { keywords: ["KW"], pillar: false }), true);
assert.equal(scoreMatchesProfile({ profileKeywords: ["old"], pillar: false }, { keywords: ["new"], pillar: false }), false);
assert.equal(scoreMatchesProfile({ profileKeywords: null, pillar: false }, { keywords: null, pillar: true }), false);

assert.deepEqual(keywordStatementFromScore({ profileKeywords: ["kw", "kw two"] }), ["kw", "kw two"]);
assert.equal(keywordStatementFromScore({ profileKeywords: null }), null);
assert.equal(
	keywordStatementFromScore({ profileKeywords: undefined }),
	null,
	"stale records without ownership metadata read as no statement",
);

// --- Ownership view ---------------------------------------------------------

// Explicit draft wins, even over inherited content keywords.
assert.deepEqual(
	keywordOwnershipView(["mine"], { keywords: ["legacy"], focusKeywordSource: "content" }),
	{ display: ["mine"], inherited: false },
);
// No statement + content source: chips shown but identified as inherited.
assert.deepEqual(
	keywordOwnershipView(null, { keywords: ["legacy kw"], focusKeywordSource: "content" }),
	{ display: ["legacy kw"], inherited: true },
);
// No statement + no content fallback: nothing to show.
assert.deepEqual(
	keywordOwnershipView(null, { keywords: [], focusKeywordSource: "none" }),
	{ display: [], inherited: false },
);
// Cleared statement suppresses the fallback: empty display, not inherited.
assert.deepEqual(
	keywordOwnershipView([], { keywords: [], focusKeywordSource: "none" }),
	{ display: [], inherited: false },
);

// --- Error classification ----------------------------------------------------

const validation = profileSaveErrorFromRoute("keyword_too_long", "Too long.");
assert.equal(validation.kind, "validation");
assert.equal(classifyProfileSaveFailure(validation).retryable, false, "validation never auto-retries");

const gone = profileSaveErrorFromRoute("not_found", "Entry gone.");
assert.equal(classifyProfileSaveFailure(gone).retryable, false, "a vanished entry is not retryable");

const storage = profileSaveErrorFromRoute("storage_unavailable", "Storage down.");
assert.equal(storage.kind, "server");
assert.equal(classifyProfileSaveFailure(storage).retryable, true);

// fetch() network failures surface the friendly offline copy, never the raw
// transport text.
const network = classifyProfileSaveFailure(new TypeError("Failed to fetch"));
assert.equal(network.kind, "network");
assert.equal(network.message, SEO_PROFILE_OFFLINE_MESSAGE);
assert.equal(network.retryable, true);
assert.doesNotMatch(network.message, /Failed to fetch/);

// Unknown failures (contract errors, HTTP failures) fall back to safe copy.
const unknown = classifyProfileSaveFailure(new Error("Invalid SEO admin response: focusKeyword.result"));
assert.equal(unknown.kind, "server");
assert.equal(unknown.message, SEO_PROFILE_FAILED_MESSAGE);

// --- No automatic retry ------------------------------------------------------

// A transport failure or a 5xx may follow a stored write, and the profile write
// carries no revision. Neither may be resent without the user's Retry.
assert.deepEqual(
	Object.keys(keywordProfile).filter((name) => /retr(y|ies)/i.test(name)),
	[],
	"the keyword profile exposes no automatic retry policy",
);
for (const uncertain of [
	new TypeError("Failed to fetch"),
	new TypeError("network error"),
	profileSaveErrorFromRoute("storage_unavailable", "Storage down."),
	new SeoProfileSaveError("server", "HTTP 503"),
	new Error("SEO admin request failed with 500"),
]) {
	const classified = classifyProfileSaveFailure(uncertain);
	assert.notEqual(classified.kind, "validation", String(uncertain));
	assert.equal(classified.retryable, true, "the manual Retry stays available: " + String(uncertain));
}

// --- Save-state machine ------------------------------------------------------

const failure = classifyProfileSaveFailure(network);

assert.deepEqual(
	deriveProfileSaveState({ dirty: false, inFlight: false, failure: null, recentlySaved: false }),
	{ status: "clean" },
);
// A pending debounce is "unsaved", never "saving".
assert.deepEqual(
	deriveProfileSaveState({ dirty: true, inFlight: false, failure: null, recentlySaved: false }),
	{ status: "pending" },
);
assert.deepEqual(
	deriveProfileSaveState({ dirty: true, inFlight: true, failure: null, recentlySaved: false }),
	{ status: "saving" },
);
// A failure outranks dirtiness so Retry stays visible with the retained draft.
assert.deepEqual(
	deriveProfileSaveState({ dirty: true, inFlight: false, failure, recentlySaved: false }),
	{ status: "error", failure },
);
// The saved confirmation only shows while clean.
assert.deepEqual(
	deriveProfileSaveState({ dirty: false, inFlight: false, failure: null, recentlySaved: true }),
	{ status: "saved" },
);
assert.deepEqual(
	deriveProfileSaveState({ dirty: true, inFlight: false, failure: null, recentlySaved: true }),
	{ status: "pending" },
);

console.log("SEO keyword profile self-check passed.");
