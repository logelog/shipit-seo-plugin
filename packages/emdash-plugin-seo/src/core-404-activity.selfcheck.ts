import assert from "node:assert/strict";

import {
	CORE_404_CURSOR_MAX_LENGTH,
	CORE_404_LIST_PATH,
	CORE_404_PAGE_SIZE,
	CORE_404_PATH_MAX_LENGTH,
	CORE_404_READ_RETRIES,
	CORE_404_RECORDED_HELP,
	CORE_404_RECORDED_LABEL,
	CORE_404_SEARCH_MAX_LENGTH,
	CORE_404_SUMMARY_LIMIT,
	Core404ReadError,
	Core404ResponseError,
	assertCore404Request,
	classifyCore404ReadError,
	core404FailureForStatus,
	core404FailureNotice,
	core404ListUrl,
	core404PageRequest,
	core404PageResult,
	core404PageState,
	core404RequestKey,
	core404ResultOwned,
	core404SummaryUrl,
	core404TimestampMs,
	initialCore404Paging,
	isCore404Cursor,
	isCore404Path,
	isCore404RecordId,
	isCore404Timestamp,
	nextCore404Paging,
	normalizeCore404Search,
	parseCore404Page,
	parseCore404Summary,
	previousCore404Paging,
	refreshCore404Paging,
	sameCore404Request,
	searchCore404Paging,
	shouldRetryCore404Read,
	type Core404PageRequest,
	type Core404Paging,
	type Core404ReadFailure,
} from "./core-404-activity.ts";

// En dash, em dash and ellipsis, built from code points so this file stays ASCII.
const DECORATIVE_MARKS = [0x2013, 0x2014, 0x2026].map((code) => String.fromCodePoint(code));

function assertPlainPunctuation(text: string, label: string): void {
	for (const mark of DECORATIVE_MARKS) assert.equal(text.includes(mark), false, label);
}

function sent(url: string): URLSearchParams {
	const parsed = new URL(url, "https://site.test");
	assert.equal(parsed.pathname, CORE_404_LIST_PATH);
	return parsed.searchParams;
}

function searched(paging: Core404Paging, input: string): Core404Paging {
	const update = searchCore404Paging(paging, input);
	if (!update.valid) throw new Error(`Search ${JSON.stringify(input)} should be accepted`);
	return update.paging;
}

function present<T>(value: T | null, label: string): T {
	if (value === null) throw new Error(`${label} should exist`);
	return value;
}

function recordId(index: number): string {
	return `01J9ZQ4V6M8K3T5R7W2X40${String(index).padStart(4, "0")}`;
}

function hostRow(index: number) {
	return {
		id: recordId(index),
		path: `/missing/${index}`,
		referrer: "https://referrer.example/from",
		userAgent: "Mozilla/5.0 (diagnostic)",
		ip: "203.0.113.7",
		createdAt: `2026-10-04T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
	};
}

function summaryRow(index: number) {
	return {
		path: `/missing/${index}`,
		count: 100 - index,
		lastSeen: `2026-10-04T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
		topReferrer: "https://referrer.example/top",
	};
}

function label(value: unknown): string {
	return String(JSON.stringify(value)).slice(0, 80);
}

// Request bounds.
assert.equal(CORE_404_PAGE_SIZE, 50);
assert.equal(CORE_404_SUMMARY_LIMIT, 50);
assert.equal(CORE_404_SEARCH_MAX_LENGTH, 200);
assert.equal(CORE_404_CURSOR_MAX_LENGTH, 2_048);
assert.equal(CORE_404_PATH_MAX_LENGTH, 16_384);
assert.equal(CORE_404_READ_RETRIES, 1);

// Search is trimmed only; literal LIKE characters, encodings and Unicode survive.
const literal = "/50%_off\\deal";
const unicode = "/café/日本語/\u{1F600}";
assert.deepEqual(normalizeCore404Search("  /old page\t"), { valid: true, search: "/old page" });
assert.deepEqual(normalizeCore404Search(" /x　"), { valid: true, search: "/x" });
assert.deepEqual(normalizeCore404Search(literal), { valid: true, search: literal });
assert.deepEqual(normalizeCore404Search("%2Fencoded"), { valid: true, search: "%2Fencoded" });
assert.deepEqual(normalizeCore404Search(unicode), { valid: true, search: unicode });
assert.deepEqual(normalizeCore404Search("   "), { valid: true, search: "" });
assert.deepEqual(normalizeCore404Search("x".repeat(200)), { valid: true, search: "x".repeat(200) });
assert.deepEqual(normalizeCore404Search(`  ${"x".repeat(200)}  `), { valid: true, search: "x".repeat(200) });
assert.deepEqual(normalizeCore404Search("x".repeat(201)), { valid: false, problem: "too-long" });
assert.deepEqual(normalizeCore404Search("/a\uD800b"), { valid: false, problem: "unpaired-surrogate" });
assert.deepEqual(normalizeCore404Search("/a\uDC00"), { valid: false, problem: "unpaired-surrogate" });

// The first request carries no cursor and no empty search parameter.
const initial = initialCore404Paging();
const firstRequest = core404PageRequest(initial);
assert.deepEqual(firstRequest, { search: "", cursor: null, page: 0, revision: 0, limit: 50 });
assert.equal(core404ListUrl(firstRequest), "/_emdash/api/redirects/404s?limit=50");

for (const text of [literal, unicode, "/a b+c&d=e#f?g", "%25", "%2Fencoded"]) {
	const params = sent(core404ListUrl(core404PageRequest(searched(initial, text))));
	assert.equal(params.get("search"), text);
	assert.equal(params.get("limit"), "50");
	assert.equal(params.has("cursor"), false);
}
assert.match(core404ListUrl(core404PageRequest(searched(initial, literal))), /search=%2F50%25_off%5Cdeal/);

// Cursors are opaque: sent unchanged, never decoded or trimmed.
const opaque = "eyJpZCI6IjAxSiJ9+/= %_\\";
const opaqueRequest: Core404PageRequest = { ...firstRequest, page: 1, cursor: opaque };
assert.equal(sent(core404ListUrl(opaqueRequest)).get("cursor"), opaque);
assert.doesNotThrow(() => core404ListUrl({ ...firstRequest, page: 1, cursor: "c".repeat(2_048) }));
assert.equal(isCore404Cursor("c"), true);
assert.equal(isCore404Cursor(""), false);
assert.equal(isCore404Cursor("c".repeat(2_049)), false);
assert.equal(isCore404Cursor(42), false);
assert.equal(isCore404Cursor("\uD800"), false);
assert.equal(isCore404Cursor("\uDC00"), false);
assert.equal(isCore404Cursor("opaque-\uD83D\uDE00"), true);
assert.throws(() => core404ListUrl({ ...firstRequest, cursor: "\uD800", page: 1 }), RangeError);

const outOfBounds: Array<[string, Core404PageRequest]> = [
	["limit 0", { ...firstRequest, limit: 0 }],
	["limit 51", { ...firstRequest, limit: 51 }],
	["fractional limit", { ...firstRequest, limit: 2.5 }],
	["NaN limit", { ...firstRequest, limit: Number.NaN }],
	["untrimmed search", { ...firstRequest, search: " /a" }],
	["overlong search", { ...firstRequest, search: "x".repeat(201) }],
	["lone surrogate", { ...firstRequest, search: "/a\uD800" }],
	["non-string search", { ...firstRequest, search: 42 as unknown as string }],
	["first page with cursor", { ...firstRequest, cursor: "c" }],
	["later page without cursor", { ...firstRequest, page: 1 }],
	["empty cursor", { ...firstRequest, page: 1, cursor: "" }],
	["overlong cursor", { ...firstRequest, page: 1, cursor: "c".repeat(2_049) }],
	["negative page", { ...firstRequest, page: -1 }],
	["fractional page", { ...firstRequest, page: 0.5 }],
	["negative revision", { ...firstRequest, revision: -1 }],
	["fractional revision", { ...firstRequest, revision: 1.5 }],
	["NaN revision", { ...firstRequest, revision: Number.NaN }],
	["unsafe revision", { ...firstRequest, revision: Number.MAX_SAFE_INTEGER + 1 }],
];
for (const [name, request] of outOfBounds) {
	assert.throws(() => assertCore404Request(request), RangeError, name);
	assert.throws(() => core404ListUrl(request), RangeError, name);
	assert.throws(() => core404PageResult(request, { items: [] }), RangeError, name);
}
assert.doesNotThrow(() => assertCore404Request({ ...firstRequest, revision: Number.MAX_SAFE_INTEGER }));

assert.equal(core404SummaryUrl(), "/_emdash/api/redirects/404s/summary?limit=50");
assert.equal(core404SummaryUrl(10), "/_emdash/api/redirects/404s/summary?limit=10");
for (const limit of [0, 51, 1.5, Number.NaN]) assert.throws(() => core404SummaryUrl(limit), RangeError);

// Host timestamps: ISO and legacy SQLite text are readable, anything else is not.
const sameInstant = Date.UTC(2026, 9, 4, 10, 1, 0);
for (const value of [
	"2026-10-04T10:01:00.000Z",
	"2026-10-04T10:01:00Z",
	"2026-10-04T12:01:00+02:00",
	"2026-10-04T08:01:00-02:00",
	"2026-10-04 10:01:00",
	"2026-10-04 10:01:00.000",
]) {
	assert.equal(isCore404Timestamp(value), true, value);
	assert.equal(core404TimestampMs(value), sameInstant, value);
}
assert.equal(core404TimestampMs("2026-10-04T10:01:00.5Z"), sameInstant + 500);
assert.equal(core404TimestampMs("2026-10-04T10:01:00.123456789Z"), sameInstant + 123);
assert.equal(isCore404Timestamp("2024-02-29T00:00:00.000Z"), true);

const unreadableTimes: unknown[] = [
	"",
	"today",
	"2026-10-04",
	"10:01:00",
	"2026-10-04T10:01:00",
	"2026-10-04 10:01:00Z",
	"2026-10-04t10:01:00z",
	"2026-13-01T00:00:00Z",
	"2026-00-10T00:00:00Z",
	"2026-10-00T00:00:00Z",
	"2026-02-30 10:00:00",
	"2025-02-29T00:00:00Z",
	"2026-10-04T24:00:00Z",
	"2026-10-04T10:60:00Z",
	"2026-10-04T10:00:60Z",
	"2026-10-04T10:00:00+24:00",
	"2026-10-04T10:00:00+02:60",
	"2026-10-04T10:00:00.1234567890Z",
	"1969-12-31T23:59:59Z",
	" 2026-10-04 10:00:00",
	"2026-10-04 10:00:00\n",
	"Sun, 04 Oct 2026 10:01:00 GMT",
	1_791_000_000_000,
	null,
];
for (const value of unreadableTimes) assert.equal(isCore404Timestamp(value), false, label(value));
assert.equal(core404TimestampMs("2026-02-30 10:00:00"), null);

// Ids and paths match what the host writes: ulid() ids and URL.pathname values.
assert.equal(isCore404RecordId(recordId(1)), true);
for (const id of [
	"",
	"01J4040001",
	`${recordId(1)}1`,
	recordId(1).toLowerCase(),
	`${recordId(1).slice(0, 25)}I`,
	`8${recordId(1).slice(1)}`,
	7,
]) {
	assert.equal(isCore404RecordId(id), false, label(id));
}
assert.equal(isCore404Path("/"), true);
assert.equal(isCore404Path(`/${"a".repeat(CORE_404_PATH_MAX_LENGTH - 1)}`), true);
assert.equal(isCore404Path(`/${"a".repeat(CORE_404_PATH_MAX_LENGTH)}`), false);
assert.equal(isCore404Path("missing"), false);
assert.equal(isCore404Path(""), false);
assert.equal(isCore404Path(42), false);

// Host-shaped rows keep id, path and createdAt; referrer, user agent and IP never leave the parser.
const hostPage = { items: [hostRow(1), hostRow(2)], nextCursor: "opaque-next" };
const parsed = parseCore404Page(hostPage);
assert.deepEqual(parsed, {
	items: [
		{ id: recordId(1), path: "/missing/1", createdAt: "2026-10-04T10:01:00.000Z" },
		{ id: recordId(2), path: "/missing/2", createdAt: "2026-10-04T10:02:00.000Z" },
	],
	nextCursor: "opaque-next",
});
for (const item of parsed.items) assert.deepEqual(Object.keys(item).sort(), ["createdAt", "id", "path"]);
const serialized = JSON.stringify(parsed);
for (const hidden of ["203.0.113.7", "Mozilla", "referrer.example"]) assert.equal(serialized.includes(hidden), false);

// The projection is a copy: later changes to the host value do not reach it.
hostPage.items[0].path = "/changed";
hostPage.nextCursor = "changed";
assert.equal(parsed.items[0]?.path, "/missing/1");
assert.equal(parsed.nextCursor, "opaque-next");

assert.equal(parseCore404Page({ items: [hostRow(3)] }).nextCursor, null);
assert.equal(parseCore404Page({ items: [hostRow(3)], nextCursor: null }).nextCursor, null);
assert.equal(
	parseCore404Page({ items: [{ ...hostRow(4), createdAt: "2026-10-04 10:04:00" }] }).items[0]?.createdAt,
	"2026-10-04 10:04:00",
);
const unicodePath = "/café/%E2%9C%93/日本";
assert.equal(parseCore404Page({ items: [{ ...hostRow(5), path: unicodePath }] }).items[0]?.path, unicodePath);
assert.deepEqual(parseCore404Page({ items: [], nextCursor: "later" }), { items: [], nextCursor: "later" });
assert.equal(parseCore404Page({ items: Array.from({ length: 50 }, (_, index) => hostRow(index)) }).items.length, 50);
assert.equal(parseCore404Page({ items: [hostRow(1)] }, 1).items.length, 1);
assert.throws(() => parseCore404Page({ items: [hostRow(1), hostRow(2)] }, 1), Core404ResponseError);
for (const limit of [0, 51, 1.5, Number.NaN]) assert.throws(() => parseCore404Page({ items: [] }, limit), RangeError);

const malformedPages: unknown[] = [
	null,
	[],
	"items",
	{ nextCursor: "x" },
	{ items: {} },
	{ items: [null] },
	{ items: [[]] },
	{ items: [{ ...hostRow(1), id: "" }] },
	{ items: [{ ...hostRow(1), id: 7 }] },
	{ items: [{ ...hostRow(1), id: "01J4040001" }] },
	{ items: [{ ...hostRow(1), path: 7 }] },
	{ items: [{ ...hostRow(1), path: "" }] },
	{ items: [{ ...hostRow(1), path: "missing" }] },
	{ items: [{ ...hostRow(1), path: `/${"a".repeat(CORE_404_PATH_MAX_LENGTH)}` }] },
	{ items: [{ ...hostRow(1), createdAt: "yesterday" }] },
	{ items: [{ ...hostRow(1), createdAt: "2026-02-30 10:00:00" }] },
	{ items: [{ ...hostRow(1), createdAt: 1_791_000_000_000 }] },
	{ items: [{ id: recordId(1), path: "/a" }] },
	{ items: [hostRow(1), hostRow(1)] },
	{ items: [], nextCursor: 42 },
	{ items: [], nextCursor: "" },
	{ items: [], nextCursor: "c".repeat(2_049) },
	{ items: [], nextCursor: "\uD800" },
	{ items: Array.from({ length: 51 }, (_, index) => hostRow(index)) },
];
for (const value of malformedPages) {
	assert.throws(() => parseCore404Page(value), Core404ResponseError, label(value));
}

// Top by hits keeps path, count and lastSeen; the top referrer is dropped.
const summary = parseCore404Summary({ items: [summaryRow(1), { ...summaryRow(2), lastSeen: "2026-10-04 11:02:00" }] });
assert.deepEqual(summary, [
	{ path: "/missing/1", count: 99, lastSeen: "2026-10-04T11:01:00.000Z" },
	{ path: "/missing/2", count: 98, lastSeen: "2026-10-04 11:02:00" },
]);
for (const item of summary) assert.deepEqual(Object.keys(item).sort(), ["count", "lastSeen", "path"]);
assert.equal(JSON.stringify(summary).includes("referrer.example"), false);
assert.deepEqual(parseCore404Summary({ items: [] }), []);
assert.equal(parseCore404Summary({ items: [{ ...summaryRow(1), count: 0 }] })[0]?.count, 0);
assert.equal(parseCore404Summary({ items: Array.from({ length: 50 }, (_, index) => summaryRow(index)) }).length, 50);
assert.equal(parseCore404Summary({ items: [summaryRow(1)] }, 1).length, 1);
assert.throws(() => parseCore404Summary({ items: [summaryRow(1), summaryRow(2)] }, 1), Core404ResponseError);
for (const limit of [0, 51, 1.5, Number.NaN]) assert.throws(() => parseCore404Summary({ items: [] }, limit), RangeError);

const malformedSummaries: unknown[] = [
	null,
	[],
	{ count: 0 },
	{ items: {} },
	{ items: [null] },
	{ items: [{ ...summaryRow(1), path: "" }] },
	{ items: [{ ...summaryRow(1), path: "missing" }] },
	{ items: [{ ...summaryRow(1), path: `/${"a".repeat(CORE_404_PATH_MAX_LENGTH)}` }] },
	{ items: [{ ...summaryRow(1), count: -1 }] },
	{ items: [{ ...summaryRow(1), count: 1.5 }] },
	{ items: [{ ...summaryRow(1), count: "3" }] },
	{ items: [{ ...summaryRow(1), count: Number.NaN }] },
	{ items: [{ ...summaryRow(1), count: Number.MAX_SAFE_INTEGER + 1 }] },
	{ items: [{ ...summaryRow(1), lastSeen: "today" }] },
	{ items: [{ ...summaryRow(1), lastSeen: "2026-02-30T00:00:00Z" }] },
	{ items: [{ path: "/a", count: 1 }] },
	{ items: [summaryRow(1), { ...summaryRow(2), path: "/missing/1" }] },
	{ items: Array.from({ length: 51 }, (_, index) => summaryRow(index)) },
];
for (const value of malformedSummaries) {
	assert.throws(() => parseCore404Summary(value), Core404ResponseError, label(value));
}

// A search resets cursor history and opens a new first-page read.
const pageA0 = searched(initial, "  /shop%_ ");
assert.deepEqual(pageA0, { search: "/shop%_", cursors: [null], page: 0, revision: 1 });
const requestA0 = core404PageRequest(pageA0);
const resultA0 = core404PageResult(requestA0, { items: [hostRow(1)], nextCursor: "cursor-a1" });
assert.equal(core404ResultOwned(pageA0, resultA0), true);
assert.equal(core404PageState(resultA0), "records");

// A result keeps a frozen copy of its request; the caller's object can change afterwards.
const callerRequest: Core404PageRequest = { ...requestA0 };
const copied = core404PageResult(callerRequest, { items: [hostRow(1)], nextCursor: "cursor-a1" });
callerRequest.search = "/other";
callerRequest.page = 4;
callerRequest.cursor = "moved";
callerRequest.revision = 99;
assert.deepEqual(copied.request, requestA0);
assert.notEqual(copied.request, callerRequest);
assert.equal(Object.isFrozen(copied.request), true);
assert.throws(() => {
	(copied.request as Core404PageRequest).revision = 7;
}, TypeError);
assert.equal(core404ResultOwned(pageA0, copied), true);
assert.deepEqual(present(nextCore404Paging(pageA0, copied), "page after a copied request").cursors, [null, "cursor-a1"]);

// Next follows only the current response's cursor.
const pageA1 = present(nextCore404Paging(pageA0, resultA0), "second page");
assert.deepEqual(pageA1, { search: "/shop%_", cursors: [null, "cursor-a1"], page: 1, revision: 1 });
const requestA1 = core404PageRequest(pageA1);
assert.equal(sent(core404ListUrl(requestA1)).get("cursor"), "cursor-a1");
assert.equal(sent(core404ListUrl(requestA1)).get("search"), "/shop%_");
assert.equal(core404ResultOwned(pageA1, resultA0), false);
assert.equal(nextCore404Paging(pageA1, resultA0), null);

const resultA1 = core404PageResult(requestA1, { items: [hostRow(51)], nextCursor: "cursor-a2" });
const pageA2 = present(nextCore404Paging(pageA1, resultA1), "third page");
assert.deepEqual(pageA2.cursors, [null, "cursor-a1", "cursor-a2"]);

// Previous returns to the visited page with the cursor that opened it.
const backToA1 = previousCore404Paging(pageA2);
assert.deepEqual(core404PageRequest(backToA1), requestA1);
assert.equal(core404ResultOwned(backToA1, resultA1), true);
const backToA0 = previousCore404Paging(backToA1);
assert.deepEqual(core404PageRequest(backToA0), requestA0);
assert.equal(previousCore404Paging(backToA0), backToA0);

// A live first page can hand out a different cursor; following it drops the stale forward history.
const freshA0 = core404PageResult(requestA0, { items: [hostRow(1)], nextCursor: "cursor-a1-live" });
assert.deepEqual(present(nextCore404Paging(backToA0, freshA0), "live second page").cursors, [null, "cursor-a1-live"]);

// No cursor, or a cursor already visited, ends the walk.
assert.equal(nextCore404Paging(pageA0, core404PageResult(requestA0, { items: [hostRow(1)] })), null);
assert.equal(nextCore404Paging(pageA1, core404PageResult(requestA1, { items: [], nextCursor: "cursor-a1" })), null);
assert.equal(nextCore404Paging(pageA1, core404PageResult(requestA1, { items: [], nextCursor: null })), null);

// An empty page with a cursor is live retention, not an error, and can still be followed.
const emptyContinues = core404PageResult(requestA0, { items: [], nextCursor: "more" });
assert.equal(core404PageState(emptyContinues), "empty-continues");
assert.equal(present(nextCore404Paging(pageA0, emptyContinues), "page after an empty one").page, 1);

// Late responses stay attached to their search, cursor and read.
const pageB0 = searched(pageA2, "/blog");
assert.deepEqual(pageB0, { search: "/blog", cursors: [null], page: 0, revision: 2 });
assert.equal(core404ResultOwned(pageB0, resultA0), false);
assert.equal(core404ResultOwned(pageB0, resultA1), false);
assert.equal(nextCore404Paging(pageB0, resultA0), null);

const pageB0Again = searched(pageB0, " /blog ");
assert.equal(pageB0Again.revision, 3);
assert.equal(sameCore404Request(core404PageRequest(pageB0), core404PageRequest(pageB0Again)), false);

const cleared = searched(pageB0Again, "   ");
assert.equal(cleared.search, "");
assert.equal(sent(core404ListUrl(core404PageRequest(cleared))).has("search"), false);

assert.deepEqual(searchCore404Paging(pageA2, "x".repeat(201)), { valid: false, problem: "too-long" });

// Refresh returns to the first page of the current search as a new read.
const refreshed = refreshCore404Paging(pageA2);
assert.deepEqual(refreshed, { search: "/shop%_", cursors: [null], page: 0, revision: 2 });
assert.equal(core404ResultOwned(refreshed, resultA0), false);
assert.notDeepEqual(core404RequestKey(core404PageRequest(refreshed)), core404RequestKey(requestA0));
assert.deepEqual(core404RequestKey(requestA1), ["core-404", "records", "/shop%_", 1, "cursor-a1", 1, 50]);

// Empty states stay distinct.
assert.equal(core404PageState(core404PageResult(firstRequest, { items: [] })), "empty-log");
assert.equal(core404PageState(core404PageResult(core404PageRequest(pageB0), { items: [] })), "no-matches");
assert.equal(core404PageState(core404PageResult(requestA1, { items: [] })), "page-emptied");

// Failures are classified without guessing an empty log.
assert.equal(core404FailureForStatus(401), "denied");
assert.equal(core404FailureForStatus(403), "denied");
assert.equal(core404FailureForStatus(400), "rejected");
assert.equal(core404FailureForStatus(404), "rejected");
assert.equal(core404FailureForStatus(408), "unavailable");
assert.equal(core404FailureForStatus(429), "unavailable");
assert.equal(core404FailureForStatus(500), "unavailable");
assert.equal(core404FailureForStatus(503), "unavailable");

const denied = new Core404ReadError("denied", 403, "Forbidden");
const rejectedCursor = new Core404ReadError("rejected", 400, "Invalid cursor");
const transient = new Core404ReadError("unavailable", 503, "Service unavailable");
const unreadable = new Core404ResponseError("Invalid EmDash 404 list response");
const aborted = new DOMException("The operation was aborted.", "AbortError");
assert.equal(denied.status, 403);
assert.equal(classifyCore404ReadError(denied), "denied");
assert.equal(classifyCore404ReadError(rejectedCursor), "rejected");
assert.equal(classifyCore404ReadError(transient), "unavailable");
assert.equal(classifyCore404ReadError(unreadable), "malformed");
assert.equal(classifyCore404ReadError(aborted), "aborted");
assert.equal(classifyCore404ReadError(new DOMException("The operation timed out.", "TimeoutError")), "unavailable");
assert.equal(classifyCore404ReadError(new TypeError("Failed to fetch")), "unavailable");
assert.equal(classifyCore404ReadError(new SyntaxError("Unexpected token <")), "malformed");
assert.equal(classifyCore404ReadError(Object.assign(new Error("Forbidden"), { status: 403 })), "denied");
assert.equal(classifyCore404ReadError(Object.assign(new Error("Bad gateway"), { status: 502 })), "unavailable");
assert.equal(classifyCore404ReadError("unexpected"), "unavailable");

// One bounded retry, and only for a transient failure.
assert.equal(shouldRetryCore404Read(0, transient), true);
assert.equal(shouldRetryCore404Read(1, transient), false);
for (const error of [denied, rejectedCursor, unreadable, aborted, Object.assign(new Error("Unauthorized"), { status: 401 })]) {
	assert.equal(shouldRetryCore404Read(0, error), false);
}
let attempts = 0;
let failures = 0;
for (;;) {
	attempts += 1;
	if (!shouldRetryCore404Read(failures, transient)) break;
	failures += 1;
}
assert.equal(attempts, 2);

// Notices never present a failure as an empty log and disclose rows kept from an earlier read.
const deniedNotice = core404FailureNotice("denied", { page: 0, earlierRows: false });
assert.equal(deniedNotice.retry, false);
assert.match(deniedNotice.message, /redirects:read/);
const laterRejected = core404FailureNotice("rejected", { page: 2, earlierRows: false });
assert.equal(laterRejected.firstPage, true);
assert.equal(laterRejected.retry, false);
assert.equal(core404FailureNotice("rejected", { page: 0, earlierRows: false }).firstPage, false);
assert.match(core404FailureNotice("unavailable", { page: 0, earlierRows: true }).message, /earlier successful read/);
assert.doesNotMatch(core404FailureNotice("unavailable", { page: 0, earlierRows: false }).message, /earlier successful read/);
assert.equal(core404FailureNotice("malformed", { page: 0, earlierRows: false }).retry, true);

const failureKinds: Core404ReadFailure[] = ["denied", "rejected", "malformed", "unavailable", "aborted"];
for (const failure of failureKinds) {
	for (const earlierRows of [false, true]) {
		const notice = core404FailureNotice(failure, { page: 1, earlierRows });
		const text = `${notice.title} ${notice.message}`;
		assert.doesNotMatch(text, /no missing paths|no 404|empty/i, failure);
		assertPlainPunctuation(text, failure);
	}
}

// createdAt is labelled as the record's creation, never a visit or event time.
assert.equal(CORE_404_RECORDED_LABEL, "Recorded");
assert.match(CORE_404_RECORDED_HELP, /not the latest visit/);
assertPlainPunctuation(CORE_404_RECORDED_HELP, "recorded help");

console.log("Core 404 activity self-check passed.");
