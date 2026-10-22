// Retained 404 path records from EmDash core. EmDash owns capture, dedupe,
// retention and the REST routes; this module bounds each read, projects the
// responses and sequences cursor pages. No React, DOM or Node dependencies.
//
// The list is a live view in the host's record creation order. Capture and
// scheduled retention can change later pages between reads, so a page is never
// a snapshot and there is no total. The plugin SDK has no reader for these
// records: requests run in the signed-in user's admin session, not a sandbox.

export const CORE_404_LIST_PATH = "/_emdash/api/redirects/404s";
export const CORE_404_SUMMARY_PATH = "/_emdash/api/redirects/404s/summary";
export const CORE_404_PAGE_SIZE = 50;
export const CORE_404_SUMMARY_LIMIT = 50;
/** Counted in UTF-16 code units, as an input's maxLength counts them. */
export const CORE_404_SEARCH_MAX_LENGTH = 200;
/** The host rejects longer cursors. */
export const CORE_404_CURSOR_MAX_LENGTH = 2_048;
/** Product read budget for a single retained path. */
export const CORE_404_PATH_MAX_LENGTH = 16_384;
/** Further attempts after a transient failure; every other failure is final. */
export const CORE_404_READ_RETRIES = 1;

export const CORE_404_RECORDED_LABEL = "Recorded";
export const CORE_404_RECORDED_HELP =
	"When EmDash created the retained record for this path. Repeat visits do not change it, so it is not the latest visit, and it can be later than the first visit when retention removed an earlier record.";

export type Core404Mode = "records" | "top";

/** The only fields kept from a host row; referrer, user agent and IP are dropped. */
export interface Core404Record {
	id: string;
	path: string;
	createdAt: string;
}

export interface Core404Page {
	items: Core404Record[];
	/** Opaque; continues the same search. Null when the host sent none. */
	nextCursor: string | null;
}

/** One row of the top-by-hits summary; the host's top referrer is dropped. */
export interface Core404SummaryItem {
	path: string;
	count: number;
	lastSeen: string;
}

export interface Core404Paging {
	/** Normalized search; empty reads the whole retained log. */
	search: string;
	/** Cursor that opened each visited page; the first page has none. */
	cursors: Array<string | null>;
	page: number;
	/** Grows with every explicit first-page read, so its response is never taken for an earlier one. */
	revision: number;
}

export interface Core404PageRequest {
	search: string;
	cursor: string | null;
	page: number;
	revision: number;
	limit: number;
}

export interface Core404PageResult extends Core404Page {
	/** Frozen copy of the request this page answers. */
	readonly request: Readonly<Core404PageRequest>;
}

export type Core404SearchProblem = "too-long" | "unpaired-surrogate";

export type Core404SearchResult =
	| { valid: true; search: string }
	| { valid: false; problem: Core404SearchProblem };

export type Core404SearchUpdate =
	| { valid: true; paging: Core404Paging }
	| { valid: false; problem: Core404SearchProblem };

export type Core404PageState = "records" | "empty-log" | "no-matches" | "page-emptied" | "empty-continues";

export type Core404ReadFailure = "denied" | "rejected" | "malformed" | "unavailable" | "aborted";

export interface Core404FailureNotice {
	title: string;
	message: string;
	/** Repeating the same request can change the outcome. */
	retry: boolean;
	/** The page cursor may be stale; reading the first page again is the way forward. */
	firstPage: boolean;
}

export class Core404ResponseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "Core404ResponseError";
	}
}

export class Core404ReadError extends Error {
	readonly failure: Core404ReadFailure;
	readonly status: number | null;

	constructor(failure: Core404ReadFailure, status: number | null, message: string) {
		super(message);
		this.name = "Core404ReadError";
		this.failure = failure;
		this.status = status;
	}
}

const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** The host creates every row id with `ulid()`. */
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/** `Date.prototype.toISOString()` and other zoned ISO 8601 times. */
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
/** SQLite `CURRENT_TIMESTAMP` text: no zone, and always UTC. */
const SQLITE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/;

/**
 * Trims and nothing else: percent signs, underscores, backslashes and other
 * Unicode reach the host exactly as typed.
 */
export function normalizeCore404Search(input: string): Core404SearchResult {
	const search = input.trim();
	if (search.length > CORE_404_SEARCH_MAX_LENGTH) return { valid: false, problem: "too-long" };
	// URLSearchParams would send U+FFFD in place of a lone surrogate.
	if (UNPAIRED_SURROGATE.test(search)) return { valid: false, problem: "unpaired-surrogate" };
	return { valid: true, search };
}

export function isCore404Cursor(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= CORE_404_CURSOR_MAX_LENGTH && !UNPAIRED_SURROGATE.test(value);
}

export function isCore404RecordId(value: unknown): value is string {
	return typeof value === "string" && ULID.test(value);
}

export function isCore404Path(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("/") && value.length <= CORE_404_PATH_MAX_LENGTH;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Epoch milliseconds for a host timestamp, or null when it is unreadable. A
 * zoneless SQLite timestamp is read as UTC; browsers would read it as local
 * time or reject it.
 */
export function core404TimestampMs(value: string): number | null {
	const match = ISO_TIMESTAMP.exec(value) ?? SQLITE_TIMESTAMP.exec(value);
	if (!match) return null;
	const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone = "Z"] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText);
	// Date.UTC maps years below 100 to the 1900s; no retained record predates 1970.
	if (year < 1970 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
	if (hour > 23 || minute > 59 || second > 59) return null;
	let offsetMinutes = 0;
	if (zone !== "Z") {
		const offsetHours = Number(zone.slice(1, 3));
		const offsetRest = Number(zone.slice(4, 6));
		if (offsetHours > 23 || offsetRest > 59) return null;
		offsetMinutes = (zone.startsWith("-") ? -1 : 1) * (offsetHours * 60 + offsetRest);
	}
	const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
	return Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) - offsetMinutes * 60_000;
}

export function isCore404Timestamp(value: unknown): value is string {
	return typeof value === "string" && core404TimestampMs(value) !== null;
}

export function initialCore404Paging(): Core404Paging {
	return { search: "", cursors: [null], page: 0, revision: 0 };
}

/** Every submitted search reads its first page again; cursors never cross searches. */
export function searchCore404Paging(paging: Core404Paging, input: string): Core404SearchUpdate {
	const normalized = normalizeCore404Search(input);
	if (!normalized.valid) return normalized;
	return {
		valid: true,
		paging: { search: normalized.search, cursors: [null], page: 0, revision: paging.revision + 1 },
	};
}

export function refreshCore404Paging(paging: Core404Paging): Core404Paging {
	return { search: paging.search, cursors: [null], page: 0, revision: paging.revision + 1 };
}

export function previousCore404Paging(paging: Core404Paging): Core404Paging {
	return paging.page > 0 ? { ...paging, page: paging.page - 1 } : paging;
}

export function core404PageRequest(paging: Core404Paging): Core404PageRequest {
	return {
		search: paging.search,
		cursor: paging.cursors[paging.page] ?? null,
		page: paging.page,
		revision: paging.revision,
		limit: CORE_404_PAGE_SIZE,
	};
}

export function sameCore404Request(a: Readonly<Core404PageRequest>, b: Readonly<Core404PageRequest>): boolean {
	return a.search === b.search
		&& a.cursor === b.cursor
		&& a.page === b.page
		&& a.revision === b.revision
		&& a.limit === b.limit;
}

/** A response is shown, and its cursor followed, only for the exact request it answers. */
export function core404ResultOwned(paging: Core404Paging, result: Core404PageResult): boolean {
	return sameCore404Request(core404PageRequest(paging), result.request);
}

/**
 * Follows only the cursor of the response that answers the current page. Null
 * when that response belongs to another request, has no cursor, or repeats a
 * cursor already visited, which would show an earlier page as a later one.
 */
export function nextCore404Paging(paging: Core404Paging, result: Core404PageResult): Core404Paging | null {
	if (!core404ResultOwned(paging, result)) return null;
	const cursor = result.nextCursor;
	const visited = paging.cursors.slice(0, paging.page + 1);
	if (cursor === null || visited.includes(cursor)) return null;
	return { ...paging, cursors: [...visited, cursor], page: paging.page + 1 };
}

/** One cache entry per search, page, cursor and explicit read. */
export function core404RequestKey(request: Readonly<Core404PageRequest>) {
	return ["core-404", "records", request.search, request.page, request.cursor, request.revision, request.limit] as const;
}

function assertLimit(limit: number, max: number, subject: string): void {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) {
		throw new RangeError(`${subject} holds 1 to ${max} rows.`);
	}
}

/** Throws before dispatch instead of sending a request outside the bounds. */
export function assertCore404Request(request: Readonly<Core404PageRequest>): void {
	assertLimit(request.limit, CORE_404_PAGE_SIZE, "A 404 page");
	const search = typeof request.search === "string" ? normalizeCore404Search(request.search) : null;
	if (search === null || !search.valid || search.search !== request.search) {
		throw new RangeError(`The 404 search must be trimmed, well formed and at most ${CORE_404_SEARCH_MAX_LENGTH} characters.`);
	}
	if (!Number.isSafeInteger(request.page) || request.page < 0) {
		throw new RangeError("The 404 page index must be a whole number from 0.");
	}
	if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
		throw new RangeError("The 404 read revision must be a whole number from 0.");
	}
	if (request.page === 0 ? request.cursor !== null : !isCore404Cursor(request.cursor)) {
		throw new RangeError(`Only a later 404 page carries a cursor, and it must be 1 to ${CORE_404_CURSOR_MAX_LENGTH} characters.`);
	}
}

export function core404ListUrl(request: Readonly<Core404PageRequest>): string {
	assertCore404Request(request);
	const params = new URLSearchParams({ limit: String(request.limit) });
	if (request.search) params.set("search", request.search);
	if (request.cursor !== null) params.set("cursor", request.cursor);
	return `${CORE_404_LIST_PATH}?${params.toString()}`;
}

export function core404SummaryUrl(limit: number = CORE_404_SUMMARY_LIMIT): string {
	assertLimit(limit, CORE_404_SUMMARY_LIMIT, "The 404 summary");
	return `${CORE_404_SUMMARY_PATH}?${new URLSearchParams({ limit: String(limit) }).toString()}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Takes the host data after the envelope is removed. An empty page that still
 * carries a cursor is accepted: the log is live and later pages may hold rows.
 * Timestamps are kept as sent.
 */
export function parseCore404Page(value: unknown, limit: number = CORE_404_PAGE_SIZE): Core404Page {
	assertLimit(limit, CORE_404_PAGE_SIZE, "A 404 page");
	if (!isPlainObject(value)) throw new Core404ResponseError("Invalid EmDash 404 list response");
	const rows = value.items;
	if (!Array.isArray(rows)) throw new Core404ResponseError("Invalid EmDash 404 list response");
	if (rows.length > limit) throw new Core404ResponseError("EmDash returned more 404 records than requested");
	const ids = new Set<string>();
	const items = rows.map((row: unknown): Core404Record => {
		if (!isPlainObject(row)) throw new Core404ResponseError("Invalid EmDash 404 record");
		const { id, path, createdAt } = row;
		if (!isCore404RecordId(id) || !isCore404Path(path) || !isCore404Timestamp(createdAt)) {
			throw new Core404ResponseError("Invalid EmDash 404 record");
		}
		if (ids.has(id)) throw new Core404ResponseError("EmDash returned a 404 record twice");
		ids.add(id);
		return { id, path, createdAt };
	});
	const next = value.nextCursor;
	let nextCursor: string | null = null;
	if (isCore404Cursor(next)) nextCursor = next;
	else if (next !== undefined && next !== null) throw new Core404ResponseError("Invalid EmDash 404 list cursor");
	return { items, nextCursor };
}

/** Validates and freezes a copy of the request first, so later changes to the caller's object cannot move the result. */
export function core404PageResult(request: Readonly<Core404PageRequest>, value: unknown): Core404PageResult {
	const snapshot: Readonly<Core404PageRequest> = Object.freeze({
		search: request.search,
		cursor: request.cursor,
		page: request.page,
		revision: request.revision,
		limit: request.limit,
	});
	assertCore404Request(snapshot);
	return { ...parseCore404Page(value, snapshot.limit), request: snapshot };
}

/** The host groups by path, so each path appears once; counts and dates are kept as sent. */
export function parseCore404Summary(value: unknown, limit: number = CORE_404_SUMMARY_LIMIT): Core404SummaryItem[] {
	assertLimit(limit, CORE_404_SUMMARY_LIMIT, "The 404 summary");
	if (!isPlainObject(value)) throw new Core404ResponseError("Invalid EmDash 404 summary response");
	const rows = value.items;
	if (!Array.isArray(rows)) throw new Core404ResponseError("Invalid EmDash 404 summary response");
	if (rows.length > limit) throw new Core404ResponseError("EmDash returned more 404 summary paths than requested");
	const paths = new Set<string>();
	return rows.map((row: unknown): Core404SummaryItem => {
		if (!isPlainObject(row)) throw new Core404ResponseError("Invalid EmDash 404 summary item");
		const { path, count, lastSeen } = row;
		if (
			!isCore404Path(path)
			|| typeof count !== "number"
			|| !Number.isSafeInteger(count)
			|| count < 0
			|| !isCore404Timestamp(lastSeen)
		) {
			throw new Core404ResponseError("Invalid EmDash 404 summary item");
		}
		if (paths.has(path)) throw new Core404ResponseError("EmDash returned a 404 summary path twice");
		paths.add(path);
		return { path, count, lastSeen };
	});
}

/**
 * An empty later page says nothing about the whole log: retention may have
 * removed its rows after the earlier pages were read.
 */
export function core404PageState(result: Core404PageResult): Core404PageState {
	if (result.items.length) return "records";
	if (result.nextCursor !== null) return "empty-continues";
	if (result.request.page > 0) return "page-emptied";
	return result.request.search ? "no-matches" : "empty-log";
}

/** For a read that did not yield a page. */
export function core404FailureForStatus(status: number): Core404ReadFailure {
	if (status === 401 || status === 403) return "denied";
	if (status === 408 || status === 429 || status >= 500) return "unavailable";
	if (status >= 400) return "rejected";
	return "malformed";
}

export function classifyCore404ReadError(error: unknown): Core404ReadFailure {
	if (error instanceof Core404ReadError) return error.failure;
	if (error instanceof Core404ResponseError) return "malformed";
	if (typeof error !== "object" || error === null) return "unavailable";
	const { name, status } = error as { name?: unknown; status?: unknown };
	if (name === "AbortError") return "aborted";
	if (name === "SyntaxError") return "malformed";
	if (typeof status === "number") return core404FailureForStatus(status);
	return "unavailable";
}

/**
 * `earlierFailures` counts the failed attempts before this one, so it is 0
 * after the first failure. Only transient failures are retried.
 */
export function shouldRetryCore404Read(earlierFailures: number, error: unknown): boolean {
	return earlierFailures < CORE_404_READ_RETRIES && classifyCore404ReadError(error) === "unavailable";
}

const EARLIER_ROWS = " Rows still shown are from the earlier successful read, not from this request.";

function core404FailureBase(failure: Core404ReadFailure, page: number): Core404FailureNotice {
	switch (failure) {
		case "denied":
			return {
				title: "You cannot view 404 activity",
				message: "Reading the EmDash 404 log needs the redirects:read permission.",
				retry: false,
				firstPage: false,
			};
		case "rejected":
			return page > 0
				? {
					title: "This page can no longer be read",
					message: "EmDash refused the request for this page. Its cursor may no longer be valid because the log changed after the earlier pages were read.",
					retry: false,
					firstPage: true,
				}
				: {
					title: "EmDash refused the 404 activity request",
					message: "Open EmDash Redirects to review missing paths there.",
					retry: false,
					firstPage: false,
				};
		case "malformed":
			return {
				title: "404 activity could not be read",
				message: "EmDash returned a response this screen does not recognize, so nothing from it is shown.",
				retry: true,
				firstPage: false,
			};
		case "unavailable":
			return {
				title: "404 activity could not be loaded",
				message: "EmDash did not return the requested page.",
				retry: true,
				firstPage: false,
			};
		case "aborted":
			return {
				title: "The 404 activity request was cancelled",
				message: "The requested page was not loaded.",
				retry: true,
				firstPage: false,
			};
	}
}

/** A failed read never reads as an empty log, and rows kept from before are labelled as such. */
export function core404FailureNotice(
	failure: Core404ReadFailure,
	context: { page: number; earlierRows: boolean },
): Core404FailureNotice {
	const notice = core404FailureBase(failure, context.page);
	return context.earlierRows ? { ...notice, message: `${notice.message}${EARLIER_ROWS}` } : notice;
}
