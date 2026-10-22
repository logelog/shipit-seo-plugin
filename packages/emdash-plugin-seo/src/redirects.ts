// Shared redirect rule commands. EmDash owns the records and serves them;
// these commands validate input against how the host matches requests and keep
// every host read bounded. No React, DOM or Node dependencies.

export const REDIRECT_RULE_CREATE_TYPES = Object.freeze([301, 302] as const);
export type RedirectRuleCreateType = (typeof REDIRECT_RULE_CREATE_TYPES)[number];
export const REDIRECT_PATH_MAX_LENGTH = 2_048;
export const REDIRECT_SEARCH_MAX_LENGTH = 200;
export const REDIRECT_GROUP_MAX_LENGTH = 200;
export const REDIRECT_LIST_PAGE_SIZE = 25;
export const REDIRECT_LIST_MAX_PAGE_SIZE = 100;
/** Pages of REDIRECT_LIST_MAX_PAGE_SIZE rules read to find one source path. */
export const REDIRECT_LOOKUP_PAGES = 3;
/** Redirects followed from a new rule's destination before the chain check stops. */
export const REDIRECT_CHAIN_MAX_HOPS = 8;
/** List pages the chain check may read across all of its hops. */
export const REDIRECT_CHAIN_MAX_READS = 9;
export const REDIRECT_ID_MAX_LENGTH = 128;
export const REDIRECT_REVISION_MAX_LENGTH = 1_024;
/** Raw edit form input; longer than the path limit so the command can explain it. */
export const REDIRECT_EDIT_INPUT_MAX_LENGTH = 4_096;
export const REDIRECT_TIMESTAMP_MAX_LENGTH = 128;
export const REDIRECT_CURSOR_MAX_LENGTH = 1_024;
/** UTF-8 size of one host page an edit check inspects. */
export const REDIRECT_PAGE_MAX_BYTES = 4 * 1_024 * 1_024;
/** Enabled patterns one edit check compiles. */
export const REDIRECT_EDIT_MAX_PATTERNS = 900;
/** Covers an edit's reads and checks; the host write itself is never raced against it. */
export const REDIRECT_EDIT_PREFLIGHT_MS = 15_000;

export interface RedirectRule {
	id: string;
	source: string;
	destination: string;
	type: number;
	isPattern: boolean;
	enabled: boolean;
	hits: number;
	lastHitAt: string | null;
	groupName: string | null;
	auto: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface RedirectRuleListQuery {
	search: string | null;
	enabled: boolean | null;
	auto: boolean | null;
	group: string | null;
	limit: number;
	cursor: string | null;
}

export interface RedirectHostListOptions {
	limit: number;
	cursor?: string;
	search?: string;
	group?: string;
	enabled?: boolean;
	auto?: boolean;
}

export interface RedirectHostPage {
	items: RedirectRule[];
	/** Continues the same filters; null on the last page. */
	cursor: string | null;
}

export interface RedirectRuleDraft {
	source: string;
	destination: string;
	type: RedirectRuleCreateType;
}

/** One record and the host's opaque revision of its configuration. */
export interface VersionedRedirectRule {
	rule: RedirectRule;
	/** Passed back unchanged; never decoded or derived from timestamps. */
	revision: string;
}

/** The configuration fields an edit may send. Never empty. */
export interface RedirectRulePatch {
	source?: string;
	destination?: string;
	type?: RedirectRuleCreateType;
	enabled?: boolean;
}

/** The host side of the commands. `create` and `update` are absent on read-only installations. */
export interface RedirectHost {
	list(options: RedirectHostListOptions): Promise<RedirectHostPage>;
	create?(input: RedirectRuleDraft): Promise<RedirectRule>;
	/** Exact-ID read; null when the host has no record with this ID. */
	get?(id: string): Promise<VersionedRedirectRule | null>;
	/**
	 * Writes the patch only while `revision` is still current. Rejects once the
	 * host operation has finished, unless the error is marked `pending`. A
	 * `malformed` rejection means the host call fulfilled with a readback the
	 * adapter could not parse.
	 */
	update?(id: string, patch: RedirectRulePatch, revision: string): Promise<VersionedRedirectRule>;
}

export type RedirectHostErrorCode =
	| "validation"
	| "conflict"
	| "busy"
	| "invalid-cursor"
	| "stale"
	| "precondition"
	| "malformed"
	| "failed";

/**
 * `failed` covers every host error that does not prove the write was rolled
 * back; a create or update that ends with it is reconciled before anything is
 * reported. `pending` marks an error raised while the host operation may still
 * be running, such as a transport timeout: it never proves the write failed.
 */
export class RedirectHostError extends Error {
	readonly code: RedirectHostErrorCode;
	readonly loop: boolean;
	readonly pending: boolean;

	constructor(code: RedirectHostErrorCode, message: string, loop = false, pending = false) {
		super(message);
		this.name = "RedirectHostError";
		this.code = code;
		this.loop = loop;
		this.pending = pending;
	}
}

export type RedirectPathIssue =
	| "required"
	| "too-long"
	| "absolute-url"
	| "not-a-path"
	| "protocol-relative"
	| "backslash"
	| "control-characters"
	| "query"
	| "fragment"
	| "dot-segment"
	| "invalid-encoding"
	| "pattern"
	| "reserved-path"
	| "file-extension";

export interface RedirectFieldError {
	code: RedirectPathIssue | "same-address" | "type";
	message: string;
}

export interface RedirectRuleFieldErrors {
	source?: RedirectFieldError;
	destination?: RedirectFieldError;
	type?: RedirectFieldError;
}

export type RedirectRuleValidation =
	| { valid: true; rule: RedirectRuleDraft }
	| { valid: false; errors: RedirectRuleFieldErrors };

/** What the current user may do with the create form. */
export type RedirectRuleCreateAccess = "available" | "no-permission" | "read-only";

export type RedirectRuleListResult =
	| {
		status: "ok";
		query: RedirectRuleListQuery;
		items: RedirectRule[];
		cursor: string | null;
		hasMore: boolean;
		create: RedirectRuleCreateAccess;
	}
	| { status: "invalid-cursor"; query: RedirectRuleListQuery; message: string }
	| { status: "unavailable"; message: string }
	| { status: "failed"; message: string };

export type RedirectRuleCreateResult =
	| { status: "created"; rule: RedirectRule; confirmedBy: "host" | "lookup" }
	| { status: "invalid"; errors: RedirectRuleFieldErrors }
	| {
		status: "conflict";
		reason: "duplicate" | "trailing-slash" | "loop" | "check-incomplete";
		message: string;
		existing: RedirectRule | null;
	}
	| { status: "failed"; reason: "busy" | "host-rejected" | "not-saved"; message: string; retryable: boolean }
	| { status: "uncertain"; message: string }
	| { status: "unavailable"; reason: "no-access" | "read-only"; message: string };

export type RedirectRuleLookup =
	| { state: "found"; rule: RedirectRule }
	| { state: "absent" }
	| { state: "unknown"; reason: "too-many" | "failed" };

// Mirrors the published EmDash middleware: it never intercepts these prefixes
// or paths ending in what looks like a file extension, and matches the raw
// pathname without its query.
const SKIPPED_PREFIXES = Object.freeze(["/_emdash", "/_image"]);
const ASSET_EXTENSION = /\.\w{1,10}$/;
// Browsers strip tabs and line breaks anywhere in a URL; the host refuses to
// serve a destination containing any control character.
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const PATTERN_SYNTAX = /[[\]]/;
const TERMINAL_STATUSES = Object.freeze([410, 451]);
const NORMALIZE_BASE = "https://redirect.invalid";

const PATH_MESSAGES: Record<RedirectPathIssue, { source: string; destination: string }> = {
	required: {
		source: "Enter the old path, such as /old-page.",
		destination: "Enter the new path, such as /new-page.",
	},
	"too-long": {
		source: `Use at most ${REDIRECT_PATH_MAX_LENGTH.toLocaleString("en-US")} characters.`,
		destination: `Use at most ${REDIRECT_PATH_MAX_LENGTH.toLocaleString("en-US")} characters.`,
	},
	"absolute-url": {
		source: "Enter only the path, such as /old-page, without the domain.",
		destination: "Enter a path on this site, such as /new-page. EmDash 1.1.0 redirects only to paths on this site.",
	},
	"not-a-path": {
		source: "Start the path with /.",
		destination: "Start the path with /.",
	},
	"protocol-relative": {
		source: "A path cannot start with // or a backslash.",
		destination: "A path cannot start with // or a backslash.",
	},
	backslash: {
		source: "Use / instead of a backslash.",
		destination: "Use / instead of a backslash.",
	},
	"control-characters": {
		source: "Remove tabs, line breaks and other control characters.",
		destination: "Remove tabs, line breaks and other control characters.",
	},
	query: {
		source: "Remove the ? part. EmDash matches the path only, so a source with a query string never redirects.",
		destination: "Remove the ? part.",
	},
	fragment: {
		source: "Remove the # part. Browsers never send it to the site.",
		destination: "Remove the # part.",
	},
	"dot-segment": {
		source: "Remove . and .. path segments.",
		destination: "Remove . and .. path segments.",
	},
	"invalid-encoding": {
		source: "Fix the % encoding in this path.",
		destination: "Fix the % encoding in this path.",
	},
	pattern: {
		source: "Patterns such as [slug] are not supported here yet. Create pattern redirects in EmDash Redirects.",
		destination: "Patterns such as [slug] are not supported here yet. Create pattern redirects in EmDash Redirects.",
	},
	"reserved-path": {
		source: "EmDash never redirects /_emdash or /_image paths.",
		destination: "EmDash never redirects /_emdash or /_image paths.",
	},
	"file-extension": {
		source: "EmDash does not redirect paths that end in a file extension, such as .html.",
		destination: "EmDash does not redirect paths that end in a file extension, such as .html.",
	},
};

// Astro 7.3.2 rewrites the request pathname before any middleware runs
// (core/fetch/fetch-state.js): it applies decodeURI until the pathname is stable,
// collapses repeated slashes, writes the result through the URL pathname setter
// (which resolves dot segments, turns backslashes into slashes and re-encodes)
// and collapses again. EmDash's middleware compares sources with that pathname.
const MAX_DECODE_ITERATIONS = 10;
const REPEATED_SLASHES = /\/{2,}/g;

type AstroDecode = { decoded: string } | { error: "invalid" | "multi-level" };

// Mirrors validateAndDecodePathname in astro/dist/core/util/pathname.js.
function decodeLikeAstro(pathname: string): AstroDecode {
	let current = pathname;
	let decoded: string;
	try {
		decoded = decodeURI(current);
	} catch {
		return { error: "invalid" };
	}
	for (let iteration = 0; decoded !== current; iteration += 1) {
		if (iteration >= MAX_DECODE_ITERATIONS) return { error: "multi-level" };
		current = decoded;
		try {
			decoded = decodeURI(current);
		} catch {
			break;
		}
	}
	return { decoded };
}

/**
 * The pathname EmDash's middleware sees for a requested pathname, or null for
 * a request Astro marks as invalid encoding, whose handling is not modelled.
 */
export function redirectRequestPathname(requestPathname: string): string | null {
	const decoding = decodeLikeAstro(requestPathname);
	if ("error" in decoding && decoding.error === "multi-level") return null;
	// A first decode that fails leaves the pathname as it was sent.
	const decoded = "decoded" in decoding ? decoding.decoded : requestPathname;
	const url = new URL(NORMALIZE_BASE);
	url.pathname = decoded.replace(REPEATED_SLASHES, "/");
	return url.pathname.replace(REPEATED_SLASHES, "/");
}

/** The single alternate the host tries: one trailing slash added or removed. */
export function redirectAliasKey(path: string): string {
	return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

type PathResult = { path: string; pathname: string } | { issue: RedirectPathIssue };

function normalizePath(raw: unknown, role: "source" | "destination"): PathResult {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return { issue: "required" };
	if (value.length > REDIRECT_PATH_MAX_LENGTH) return { issue: "too-long" };
	if (CONTROL_CHARACTERS.test(value)) return { issue: "control-characters" };
	if (SCHEME.test(value)) return { issue: "absolute-url" };
	if (value.startsWith("//") || value.startsWith("/\\") || value.startsWith("\\")) return { issue: "protocol-relative" };
	if (!value.startsWith("/")) return { issue: "not-a-path" };
	const queryAt = value.indexOf("?");
	const hashAt = value.indexOf("#");
	if (role === "source" && queryAt !== -1 && (hashAt === -1 || queryAt < hashAt)) return { issue: "query" };
	if (role === "source" && hashAt !== -1) return { issue: "fragment" };
	const ends = [queryAt, hashAt].filter((index) => index !== -1);
	const pathPart = ends.length ? value.slice(0, Math.min(...ends)) : value;
	// URL parsing turns a backslash into a slash, so the stored text would not
	// be the path a browser requests.
	if (pathPart.includes("\\")) return { issue: "backslash" };
	if (PATTERN_SYNTAX.test(pathPart)) return { issue: "pattern" };
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathPart);
	} catch {
		return { issue: "invalid-encoding" };
	}
	// URL parsing also resolves %2e segments, so they are checked decoded.
	if (decoded.split("/").some((segment) => segment === "." || segment === "..")) return { issue: "dot-segment" };
	let url: URL;
	try {
		url = new URL(value, NORMALIZE_BASE);
	} catch {
		return { issue: "invalid-encoding" };
	}
	// The source is stored as the middleware sees it; the destination is sent as
	// typed and normalized by the request that follows it.
	// New input is refused when Astro's decoding would change what it means:
	// the URL setter would resolve dot segments, turn backslashes into slashes
	// or encode control characters, and brackets would make a host pattern.
	const decoding = decodeLikeAstro(url.pathname);
	if ("error" in decoding) return { issue: "invalid-encoding" };
	if (decoding.decoded.split("/").some((segment) => segment === "." || segment === "..") ||
		decoding.decoded.includes("\\") || CONTROL_CHARACTERS.test(decoding.decoded)) return { issue: "invalid-encoding" };
	const pathname = redirectRequestPathname(url.pathname);
	if (pathname === null) return { issue: "invalid-encoding" };
	if (PATTERN_SYNTAX.test(pathname)) return { issue: "pattern" };
	const path = role === "source" ? pathname : `${url.pathname}${url.search}${url.hash}`;
	if (path.length > REDIRECT_PATH_MAX_LENGTH) return { issue: "too-long" };
	if (role === "source") {
		if (SKIPPED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return { issue: "reserved-path" };
		if (ASSET_EXTENSION.test(pathname)) return { issue: "file-extension" };
	}
	return { path, pathname };
}

/**
 * Validates and normalizes one exact-path rule. The source is stored as the
 * pathname EmDash's middleware compares, so `/caf%c3%a9`, `/café` and
 * `/caf%C3%A9` all become `/caf%C3%A9`, the form every such request reaches.
 */
export function validateRedirectRuleDraft(input: unknown): RedirectRuleValidation {
	const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
	const errors: RedirectRuleFieldErrors = {};
	const source = normalizePath(record.source, "source");
	const destination = normalizePath(record.destination, "destination");
	const type = record.type === 301 || record.type === 302 ? record.type : null;
	if ("issue" in source) errors.source = { code: source.issue, message: PATH_MESSAGES[source.issue].source };
	if ("issue" in destination) {
		errors.destination = { code: destination.issue, message: PATH_MESSAGES[destination.issue].destination };
	} else if ("path" in source && redirectAliasKey(source.path) === redirectAliasKey(destination.pathname)) {
		// The host matches the pathname and tries one trailing-slash variant, so
		// a destination that differs only by a slash or a query loops.
		errors.destination = {
			code: "same-address",
			message: "This is the same address as the source, so visitors would be redirected in a loop.",
		};
	}
	if (type === null) errors.type = { code: "type", message: "Choose 301 or 302." };
	if ("issue" in source || "issue" in destination || errors.destination || type === null) return { valid: false, errors };
	return { valid: true, rule: { source: source.path, destination: destination.path, type } };
}

function optionalBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function optionalText(value: unknown, max: number, trim: boolean): string | null {
	if (typeof value !== "string") return null;
	const text = trim ? value.trim() : value;
	return text ? text.slice(0, max) : null;
}

export function normalizeRedirectRuleListQuery(input: unknown): RedirectRuleListQuery {
	const record = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
	const limit = typeof record.limit === "number" && Number.isInteger(record.limit)
		? Math.min(REDIRECT_LIST_MAX_PAGE_SIZE, Math.max(1, record.limit))
		: REDIRECT_LIST_PAGE_SIZE;
	return {
		search: optionalText(record.search, REDIRECT_SEARCH_MAX_LENGTH, true),
		enabled: optionalBoolean(record.enabled),
		auto: optionalBoolean(record.auto),
		// Group names match exactly, surrounding spaces included.
		group: optionalText(record.group, REDIRECT_GROUP_MAX_LENGTH, false),
		limit,
		cursor: typeof record.cursor === "string" && record.cursor ? record.cursor : null,
	};
}

function hostListOptions(query: RedirectRuleListQuery): RedirectHostListOptions {
	return {
		limit: query.limit,
		...(query.cursor ? { cursor: query.cursor } : {}),
		...(query.search ? { search: query.search } : {}),
		...(query.group !== null ? { group: query.group } : {}),
		...(query.enabled !== null ? { enabled: query.enabled } : {}),
		...(query.auto !== null ? { auto: query.auto } : {}),
	};
}

const NO_ACCESS_MESSAGE =
	"This plugin cannot reach EmDash redirects on this site. The installation must grant the redirects:write capability.";
const READ_ONLY_MESSAGE = "This installation lets this plugin read redirects but not create them.";

export async function listRedirectRules(
	host: RedirectHost | null,
	input: unknown,
	options: { canManage: boolean },
): Promise<RedirectRuleListResult> {
	const query = normalizeRedirectRuleListQuery(input);
	if (!host) return { status: "unavailable", message: NO_ACCESS_MESSAGE };
	try {
		const page = await host.list(hostListOptions(query));
		return {
			status: "ok",
			query,
			items: page.items,
			cursor: page.cursor,
			hasMore: page.cursor !== null,
			create: !host.create ? "read-only" : options.canManage ? "available" : "no-permission",
		};
	} catch (error) {
		if (error instanceof RedirectHostError && error.code === "invalid-cursor") {
			return { status: "invalid-cursor", query, message: "This page is no longer valid. Load the first page again." };
		}
		return { status: "failed", message: "EmDash did not return the redirect rules. Try again." };
	}
}

/**
 * Edit-only limits for the shared scan and chain helpers. Without one, the
 * helpers keep the creation contract unchanged.
 */
interface RedirectEditGuard {
	/** The rule being edited: its current edge is replaced by the proposed one. */
	excludeId: string;
	clock: () => number;
	deadline: number;
	/** Why a read was refused; the helpers report it as an incomplete check. */
	stopped: "deadline" | "envelope" | null;
}

// Allowance for the keys, numbers and flags of one serialized record.
const RECORD_OVERHEAD_BYTES = 192;

function utf8Length(text: string): number {
	let bytes = 0;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
			text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
	}
	return bytes;
}

/**
 * Whether an edit may trust a page: an oversized or malformed row could hide
 * the rule that matters, so such a page never proves absence. Every row is
 * bounded before any of its text is walked.
 */
function pageWithinEnvelope(page: RedirectHostPage): boolean {
	if (!Array.isArray(page.items) || page.items.length > REDIRECT_LIST_MAX_PAGE_SIZE) return false;
	if (page.cursor !== null && (typeof page.cursor !== "string" || page.cursor.length > REDIRECT_CURSOR_MAX_LENGTH)) {
		return false;
	}
	if (!page.items.every(withinRecordEnvelope)) return false;
	let bytes = 0;
	for (const rule of page.items) {
		bytes += RECORD_OVERHEAD_BYTES + utf8Length(rule.id) + utf8Length(rule.source) + utf8Length(rule.destination) +
			utf8Length(rule.groupName ?? "") + utf8Length(rule.createdAt) + utf8Length(rule.updatedAt) +
			utf8Length(rule.lastHitAt ?? "");
		if (bytes > REDIRECT_PAGE_MAX_BYTES) return false;
	}
	return true;
}

function stopEdit(edit: RedirectEditGuard, reason: "deadline" | "envelope"): never {
	edit.stopped ??= reason;
	throw new Error(`Redirect edit check stopped: ${reason}`);
}

/**
 * One list read. For an edit it first checks the deadline, then refuses a page
 * outside the envelope and leaves out the edited rule before any caller can
 * match it or end its pagination on it.
 */
async function listPage(host: RedirectHost, options: RedirectHostListOptions, edit?: RedirectEditGuard): Promise<RedirectHostPage> {
	if (!edit) return host.list(options);
	if (edit.clock() >= edit.deadline) stopEdit(edit, "deadline");
	const page = await host.list(options);
	if (!pageWithinEnvelope(page)) stopEdit(edit, "envelope");
	return { items: page.items.filter((rule) => rule.id !== edit.excludeId), cursor: page.cursor };
}

interface SourceScan {
	exact: RedirectRule | null;
	alias: RedirectRule | null;
	complete: boolean;
}

/**
 * Reads at most REDIRECT_LOOKUP_PAGES pages of rules whose source or
 * destination contains the path. The host has no exact-source lookup.
 */
async function scanForSource(host: RedirectHost, source: string, edit?: RedirectEditGuard): Promise<SourceScan> {
	const key = redirectAliasKey(source);
	let exact: RedirectRule | null = null;
	let alias: RedirectRule | null = null;
	let cursor: string | null = null;
	try {
		for (let page = 0; page < REDIRECT_LOOKUP_PAGES; page += 1) {
			const result: RedirectHostPage = await listPage(host, {
				limit: REDIRECT_LIST_MAX_PAGE_SIZE,
				search: key,
				...(cursor ? { cursor } : {}),
			}, edit);
			for (const rule of result.items) {
				if (rule.isPattern) continue;
				if (rule.source === source) exact ??= rule;
				else if (redirectAliasKey(rule.source) === key) alias ??= rule;
			}
			if (exact) return { exact, alias, complete: true };
			if (!result.cursor) return { exact, alias, complete: true };
			cursor = result.cursor;
		}
	} catch {
		return { exact, alias, complete: false };
	}
	return { exact, alias, complete: false };
}

/** Bounded exact-source lookup used to settle an unconfirmed create. */
export async function findRedirectRuleBySource(host: RedirectHost, source: string): Promise<RedirectRuleLookup> {
	let cursor: string | null = null;
	try {
		for (let page = 0; page < REDIRECT_LOOKUP_PAGES; page += 1) {
			const result: RedirectHostPage = await host.list({
				limit: REDIRECT_LIST_MAX_PAGE_SIZE,
				search: source,
				...(cursor ? { cursor } : {}),
			});
			const rule = result.items.find((item) => item.source === source);
			if (rule) return { state: "found", rule };
			if (!result.cursor) return { state: "absent" };
			cursor = result.cursor;
		}
	} catch {
		return { state: "unknown", reason: "failed" };
	}
	return { state: "unknown", reason: "too-many" };
}

type ChainCheck = { state: "ends" } | { state: "loop"; path: string[] } | { state: "incomplete"; pathname: string };

function trailingSlashAlternate(pathname: string): string | null {
	if (pathname.length <= 1) return null;
	return pathname.endsWith("/") ? pathname.slice(0, -1) : `${pathname}/`;
}

/**
 * Where a followed Location leads: "unsafe" when the middleware refuses to
 * serve the destination, "unknown" when Astro's handling is not modelled.
 */
function followedPathname(destination: string): { pathname: string } | { stop: "unsafe" | "unknown" } {
	if (!destination.startsWith("/") || destination.startsWith("//") || destination.startsWith("/\\") ||
		CONTROL_CHARACTERS.test(destination)) return { stop: "unsafe" };
	try {
		const pathname = redirectRequestPathname(new URL(destination, NORMALIZE_BASE).pathname);
		return pathname === null ? { stop: "unknown" } : { pathname };
	} catch {
		return { stop: "unknown" };
	}
}

/**
 * The exact rules the host could apply to a pathname: the rule for the
 * pathname itself and the one for its trailing-slash alternate. Returns null
 * when the read budget runs out first; host errors propagate.
 */
async function rulesForPathname(
	host: RedirectHost,
	pathname: string,
	budget: { reads: number },
	edit?: RedirectEditGuard,
): Promise<{ exact: RedirectRule | null; alternate: RedirectRule | null } | null> {
	const alternatePath = trailingSlashAlternate(pathname);
	let exact: RedirectRule | null = null;
	let alternate: RedirectRule | null = null;
	let cursor: string | null = null;
	for (;;) {
		if (budget.reads <= 0) return null;
		budget.reads -= 1;
		const page: RedirectHostPage = await listPage(host, {
			limit: REDIRECT_LIST_MAX_PAGE_SIZE,
			search: redirectAliasKey(pathname),
			...(cursor ? { cursor } : {}),
		}, edit);
		for (const rule of page.items) {
			if (rule.isPattern) continue;
			if (edit) {
				// Legacy duplicate sources survive: EmDash serves the newest enabled
				// one, and the list is newest first, so the first enabled match stays.
				if (!rule.enabled) continue;
				if (rule.source === pathname) exact ??= rule;
				else if (rule.source === alternatePath) alternate ??= rule;
				continue;
			}
			if (rule.source === pathname) exact = rule;
			else if (rule.source === alternatePath) alternate = rule;
		}
		if (exact?.enabled || !page.cursor) return { exact, alternate };
		cursor = page.cursor;
	}
}

// Pattern semantics copied from the published host (redirects/patterns.ts);
// the SQLite smoke compares them with the host's own functions.
const PATTERN_PLACEHOLDER = /\[(?:\.\.\.)?(\w+)\]/g;
const PATTERN_SPLAT = /\[\.\.\.(\w+)\]/g;
const PATTERN_PARAM = /\[(\w+)\]/g;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

interface CompiledRedirectPattern {
	rule: RedirectRule;
	regex: RegExp;
	names: string[];
}

/** The host skips a pattern that fails these checks instead of serving it. */
function validRedirectPattern(source: string): boolean {
	if (!source.startsWith("/") || /\[[^\]]*\[/.test(source) || source.includes("[]")) return false;
	if ((source.match(/\[/g) ?? []).length !== (source.match(/\]/g) ?? []).length) return false;
	const segments = source.split("/").filter(Boolean);
	const names = new Set<string>();
	for (const [index, segment] of segments.entries()) {
		const placeholders = segment.match(PATTERN_PLACEHOLDER);
		if (!placeholders) continue;
		if (placeholders.length > 1 || placeholders[0] !== segment) return false;
		if (segment.startsWith("[...") && index !== segments.length - 1) return false;
	}
	for (const match of source.matchAll(PATTERN_PLACEHOLDER)) {
		if (names.has(match[1]!)) return false;
		names.add(match[1]!);
	}
	return true;
}

export function compileRedirectPattern(source: string): { regex: RegExp; names: string[] } | null {
	if (!validRedirectPattern(source)) return null;
	const names: string[] = [];
	let expression = "";
	let literalStart = 0;
	for (const match of source.matchAll(PATTERN_PLACEHOLDER)) {
		expression += source.slice(literalStart, match.index).replace(REGEX_SPECIAL, "\\$&");
		names.push(match[1]!);
		expression += match[0].startsWith("[...") ? "(.+)" : "([^/]+)";
		literalStart = match.index! + match[0].length;
	}
	expression += source.slice(literalStart).replace(REGEX_SPECIAL, "\\$&");
	return { regex: new RegExp(`^${expression}$`), names };
}

export function interpolateRedirectDestination(destination: string, params: Record<string, string>): string {
	return destination
		.replace(PATTERN_SPLAT, (_match, name: string) => params[name] ?? "")
		.replace(PATTERN_PARAM, (_match, name: string) => params[name] ?? "");
}

function replaceWithin(text: string, placeholder: RegExp, params: Record<string, string>, maxLength: number): string | null {
	let output = "";
	let literalStart = 0;
	for (const match of text.matchAll(placeholder)) {
		const literal = text.slice(literalStart, match.index);
		const value = String(params[match[1]!] ?? "");
		if (output.length + literal.length + value.length > maxLength) return null;
		output += literal + value;
		literalStart = match.index! + match[0].length;
	}
	const rest = text.slice(literalStart);
	return output.length + rest.length > maxLength ? null : output + rest;
}

/**
 * interpolateRedirectDestination, or null as soon as the result would exceed
 * `maxLength`: repeated placeholders can multiply one capture, so the string
 * is never built past the bound.
 */
export function interpolateRedirectDestinationWithin(
	destination: string,
	params: Record<string, string>,
	maxLength: number,
): string | null {
	const splats = replaceWithin(destination, PATTERN_SPLAT, params, maxLength);
	return splats === null ? null : replaceWithin(splats, PATTERN_PARAM, params, maxLength);
}

/**
 * Enabled pattern rules in the host's precedence order, oldest first. Returns
 * null when they do not fit in the read budget: a missing pattern could be the
 * one that matches.
 */
async function enabledPatterns(
	host: RedirectHost,
	budget: { reads: number },
	edit?: RedirectEditGuard,
): Promise<CompiledRedirectPattern[] | null> {
	const rules: RedirectRule[] = [];
	let cursor: string | null = null;
	for (;;) {
		if (budget.reads <= 0) return null;
		budget.reads -= 1;
		// Every pattern source contains a placeholder bracket.
		const page: RedirectHostPage = await listPage(host, {
			limit: REDIRECT_LIST_MAX_PAGE_SIZE,
			search: "[",
			enabled: true,
			...(cursor ? { cursor } : {}),
		}, edit);
		rules.push(...page.items.filter((rule) => rule.isPattern && rule.enabled));
		if (edit && rules.length > REDIRECT_EDIT_MAX_PATTERNS) return null;
		if (!page.cursor) break;
		cursor = page.cursor;
	}
	return rules
		.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
		.flatMap((rule) => {
			const compiled = compileRedirectPattern(rule.source);
			return compiled ? [{ rule, ...compiled }] : [];
		});
}

/** "too-long" only for an edit, whose interpolated destination stays within the path limit. */
function matchRedirectPattern(
	patterns: CompiledRedirectPattern[],
	pathname: string,
	edit?: RedirectEditGuard,
): { rule: RedirectRule; destination: string } | "too-long" | null {
	for (const pattern of patterns) {
		const match = pathname.match(pattern.regex);
		if (!match) continue;
		const params: Record<string, string> = {};
		pattern.names.forEach((name, index) => {
			const value = match[index + 1];
			if (value !== undefined) params[name] = value;
		});
		if (edit) {
			const destination = interpolateRedirectDestinationWithin(pattern.rule.destination, params, REDIRECT_PATH_MAX_LENGTH);
			return destination === null ? "too-long" : { rule: pattern.rule, destination };
		}
		return { rule: pattern.rule, destination: interpolateRedirectDestination(pattern.rule.destination, params) };
	}
	return null;
}

/**
 * Follows the new rule's destination the way the host middleware serves
 * requests: by pathname without the query; the exact source, then the one
 * trailing-slash alternate, then enabled patterns oldest first. The host's
 * own loop check compares literal strings, so a chain that differs only by a
 * slash or a query passes it. These reads happen before the host's write lock,
 * so a rule another administrator saves in between is not seen. With an edit
 * guard, the edited rule's current edge is left out and `rule` replaces it.
 */
async function checkRedirectChain(host: RedirectHost, rule: RedirectRuleDraft, edit?: RedirectEditGuard): Promise<ChainCheck> {
	const budget = { reads: REDIRECT_CHAIN_MAX_READS };
	const path = [rule.source];
	const visited = new Set<string>();
	let patterns: CompiledRedirectPattern[] | null | undefined;
	let destination = rule.destination;
	for (let hop = 0; hop < REDIRECT_CHAIN_MAX_HOPS; hop += 1) {
		// An edit never follows or normalizes a path beyond the record bounds.
		if (edit && destination.length > REDIRECT_PATH_MAX_LENGTH) return { state: "incomplete", pathname: destination };
		const followed = followedPathname(destination);
		if ("stop" in followed) {
			return followed.stop === "unsafe" ? { state: "ends" } : { state: "incomplete", pathname: destination };
		}
		const pathname = followed.pathname;
		if (edit && pathname.length > REDIRECT_PATH_MAX_LENGTH) return { state: "incomplete", pathname };
		path.push(pathname);
		if (SKIPPED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || ASSET_EXTENSION.test(pathname)) {
			return { state: "ends" };
		}
		if (pathname === rule.source || visited.has(pathname)) return { state: "loop", path };
		visited.add(pathname);
		try {
			const rules = await rulesForPathname(host, pathname, budget, edit);
			if (!rules) return { state: "incomplete", pathname };
			let next: { type: number; destination: string } | null = rules.exact?.enabled ? rules.exact : null;
			if (!next) {
				if (trailingSlashAlternate(pathname) === rule.source) return { state: "loop", path };
				next = rules.alternate?.enabled ? rules.alternate : null;
			}
			if (!next) {
				if (patterns === undefined) patterns = await enabledPatterns(host, budget, edit);
				if (patterns === null) return { state: "incomplete", pathname };
				const matched = matchRedirectPattern(patterns, pathname, edit);
				if (matched === "too-long") return { state: "incomplete", pathname };
				next = matched ? { type: matched.rule.type, destination: matched.destination } : null;
			}
			if (!next || TERMINAL_STATUSES.includes(next.type)) return { state: "ends" };
			destination = next.destination;
		} catch {
			return { state: "incomplete", pathname };
		}
	}
	if (edit && destination.length > REDIRECT_PATH_MAX_LENGTH) return { state: "incomplete", pathname: destination };
	const last = followedPathname(destination);
	return { state: "incomplete", pathname: "pathname" in last ? last.pathname : destination };
}

function sameRule(rule: RedirectRule, draft: RedirectRuleDraft): boolean {
	return rule.source === draft.source && rule.destination === draft.destination &&
		rule.type === draft.type && rule.enabled && !rule.isPattern;
}

function duplicateMessage(existing: RedirectRule | null, source: string): string {
	return existing
		? `A redirect from ${existing.source} already exists. It goes to ${existing.destination} with ${existing.type}.`
		: `A redirect from ${source} already exists.`;
}

function uncertainMessage(source: string): string {
	return `EmDash did not confirm whether the redirect from ${source} was saved, and it could not be found or ruled out. ` +
		"Search for it in EmDash Redirects before trying again.";
}

function changedRecordMessage(rule: RedirectRule): string {
	return `EmDash saved a rule that differs from the request: ${rule.source} to ${rule.destination}, ${rule.type}, ` +
		`${rule.enabled ? "enabled" : "disabled"}${rule.isPattern ? ", as a pattern" : ""}. Review it in EmDash Redirects before saving again.`;
}

/**
 * Settles a create whose outcome is unknown, without writing anything.
 * Absence proves nothing was saved only once the create has finished on the
 * server; a request the admin lost track of may still be running and write
 * later, so its absence stays uncertain.
 */
async function settleCreate(
	host: RedirectHost,
	rule: RedirectRuleDraft,
	createFinished: boolean,
): Promise<RedirectRuleCreateResult> {
	const lookup = await findRedirectRuleBySource(host, rule.source);
	if (lookup.state === "found") {
		return sameRule(lookup.rule, rule)
			? { status: "created", rule: lookup.rule, confirmedBy: "lookup" }
			: { status: "conflict", reason: "duplicate", message: duplicateMessage(lookup.rule, rule.source), existing: lookup.rule };
	}
	if (lookup.state === "absent" && createFinished) {
		return {
			status: "failed",
			reason: "not-saved",
			message: "The redirect was not saved. Your values are kept, so you can save again.",
			retryable: true,
		};
	}
	if (lookup.state === "absent") {
		return {
			status: "uncertain",
			message: `EmDash has no redirect from ${rule.source} yet. The original request may still be running and save it, so check again in a moment or look in EmDash Redirects.`,
		};
	}
	return { status: "uncertain", message: uncertainMessage(rule.source) };
}

export async function createRedirectRule(host: RedirectHost | null, input: unknown): Promise<RedirectRuleCreateResult> {
	if (!host) return { status: "unavailable", reason: "no-access", message: NO_ACCESS_MESSAGE };
	if (!host.create) return { status: "unavailable", reason: "read-only", message: READ_ONLY_MESSAGE };
	const validation = validateRedirectRuleDraft(input);
	if (!validation.valid) return { status: "invalid", errors: validation.errors };
	const rule = validation.rule;
	// The root path has no trailing-slash alias; the host rejects exact duplicates.
	if (rule.source !== "/") {
		const scan = await scanForSource(host, rule.source);
		if (scan.exact) {
			return { status: "conflict", reason: "duplicate", message: duplicateMessage(scan.exact, rule.source), existing: scan.exact };
		}
		if (scan.alias) {
			return {
				status: "conflict",
				reason: "trailing-slash",
				message: `EmDash treats ${rule.source} and ${scan.alias.source} as the same address, and ${scan.alias.source} already redirects to ${scan.alias.destination}.`,
				existing: scan.alias,
			};
		}
		if (!scan.complete) {
			return {
				status: "conflict",
				reason: "check-incomplete",
				message: `Too many rules contain ${redirectAliasKey(rule.source)} to check for a trailing-slash duplicate here. Create this redirect in EmDash Redirects.`,
				existing: null,
			};
		}
	}
	const chain = await checkRedirectChain(host, rule);
	if (chain.state === "loop") {
		return {
			status: "conflict",
			reason: "loop",
			message: `This redirect would send visitors in a loop: ${chain.path.join(" -> ")}. EmDash treats a trailing slash and a query string as the same address.`,
			existing: null,
		};
	}
	if (chain.state === "incomplete") {
		return {
			status: "conflict",
			reason: "check-incomplete",
			message: `This plugin could not finish checking where ${chain.pathname} redirects next, so nothing was saved. Review that chain in EmDash Redirects before creating this rule there.`,
			existing: null,
		};
	}
	try {
		const created = await host.create(rule);
		// A record that differs from the request is not this rule being saved.
		return sameRule(created, rule)
			? { status: "created", rule: created, confirmedBy: "host" }
			: { status: "uncertain", message: changedRecordMessage(created) };
	} catch (error) {
		if (!(error instanceof RedirectHostError) || error.code === "failed" || error.code === "invalid-cursor") {
			return settleCreate(host, rule, true);
		}
		if (error.code === "busy") {
			return {
				status: "failed",
				reason: "busy",
				message: "Another redirect change was in progress, so nothing was saved. Save again.",
				retryable: true,
			};
		}
		if (error.code === "conflict") {
			const lookup = await findRedirectRuleBySource(host, rule.source);
			const existing = lookup.state === "found" ? lookup.rule : null;
			return { status: "conflict", reason: "duplicate", message: duplicateMessage(existing, rule.source), existing };
		}
		if (error.loop) return { status: "conflict", reason: "loop", message: error.message, existing: null };
		return { status: "failed", reason: "host-rejected", message: error.message, retryable: false };
	}
}

/**
 * Recovery for a create request whose response never arrived. Read-only; the
 * original request may still be running, so absence is never final here.
 */
export async function reconcileRedirectRule(host: RedirectHost | null, input: unknown): Promise<RedirectRuleCreateResult> {
	if (!host) return { status: "unavailable", reason: "no-access", message: NO_ACCESS_MESSAGE };
	const validation = validateRedirectRuleDraft(input);
	if (!validation.valid) return { status: "invalid", errors: validation.errors };
	return settleCreate(host, validation.rule, false);
}

export function redirectTypeLabel(type: number): string {
	switch (type) {
		case 301: return "301 Permanent";
		case 302: return "302 Temporary";
		case 307: return "307 Temporary (strict)";
		case 308: return "308 Permanent (strict)";
		case 410: return "410 Gone";
		case 451: return "451 Unavailable";
		default: return String(type);
	}
}

// ---------------------------------------------------------------------------
// Editing one existing exact-path rule by its EmDash ID. The host's revision
// check makes the write conditional for this record only; the duplicate and
// chain checks read other records before the host's write lock.
// ---------------------------------------------------------------------------

/** The configuration a save compares; hits and timestamps are activity, not configuration. */
export interface RedirectRuleConfiguration {
	source: string;
	destination: string;
	type: number;
	enabled: boolean;
	isPattern: boolean;
	groupName: string | null;
	auto: boolean;
}

/** The fields the edit form may change. */
export interface RedirectRuleEditDraft {
	source: string;
	destination: string;
	type: RedirectRuleCreateType;
	enabled: boolean;
}

/** One save: the exact ID, the revision the form loaded and the form fields. */
export interface RedirectRuleUpdateRequest extends RedirectRuleEditDraft {
	id: string;
	revision: string;
}

/** What the browser keeps for a save it could not confirm, and sends to recovery. */
export interface RedirectRuleUpdateSnapshot {
	id: string;
	revision: string;
	baseline: RedirectRuleConfiguration;
	draft: RedirectRuleEditDraft;
}

export interface RedirectRuleEditOptions {
	clock?: () => number;
}

/** What the current user may do with the edit form. */
export type RedirectRuleEditAccess = RedirectRuleCreateAccess;
export type RedirectRuleEditability = "editable" | "pattern" | "type" | "envelope";
export type RedirectRuleUnsupportedReason = Exclude<RedirectRuleEditability, "editable">;

export interface RedirectRuleEditFieldError {
	/** `stored-path`: the saved source is not the form EmDash matches, so it must be retyped. */
	code: RedirectPathIssue | "same-address" | "stored-path";
	message: string;
}

export interface RedirectRuleEditFieldErrors {
	source?: RedirectRuleEditFieldError;
	destination?: RedirectRuleEditFieldError;
}

export type RedirectRuleLoadResult =
	| { status: "loaded"; rule: RedirectRule; revision: string; update: RedirectRuleEditAccess }
	| { status: "unsupported"; reason: RedirectRuleUnsupportedReason; rule: RedirectRule | null; message: string }
	| { status: "missing"; message: string }
	| { status: "invalid"; reason: "input"; message: string }
	| { status: "failed"; message: string; retryable: true }
	| { status: "unavailable"; reason: "no-access"; message: string };

export type RedirectRuleUpdateResult =
	| { status: "updated"; rule: RedirectRule; revision: string; confirmedBy: "host" | "recovery" }
	| { status: "unchanged"; rule: RedirectRule; revision: string }
	| { status: "invalid"; reason: "input"; message: string }
	| { status: "invalid"; reason: "fields"; errors: RedirectRuleEditFieldErrors }
	| {
		status: "conflict";
		reason: "duplicate" | "trailing-slash" | "loop" | "check-incomplete";
		message: string;
		existing: RedirectRule | null;
	}
	| { status: "stale"; reason: "revision" | "changed"; message: string; current: RedirectRule | null }
	| { status: "missing"; message: string }
	| { status: "unsupported"; reason: RedirectRuleUnsupportedReason; rule: RedirectRule | null; message: string }
	| { status: "refused"; reason: "host-validation" | "precondition"; message: string }
	| { status: "busy"; message: string; retryable: true }
	| { status: "not-saved"; reason: "read-failed" | "deadline" | "write-failed"; message: string; retryable: true }
	| { status: "uncertain"; reason: "pending" | "unreadable"; message: string }
	| { status: "unavailable"; reason: "no-access" | "read-only"; message: string };

/** A separate recovery request cannot know whether the original write finished. */
export type RedirectRuleUpdateRecoveryResult = Extract<
	RedirectRuleUpdateResult,
	{ status: "updated" | "unchanged" | "stale" | "missing" | "uncertain" | "invalid" | "unavailable" }
>;

const REDIRECT_STATUSES: readonly number[] = Object.freeze([301, 302, 307, 308, 410, 451]);
const EDIT_DRAFT_KEYS = Object.freeze(["source", "destination", "type", "enabled"]);
const UPDATE_REQUEST_KEYS = Object.freeze(["id", "revision", ...EDIT_DRAFT_KEYS]);
const CONFIGURATION_KEYS = Object.freeze(["source", "destination", "type", "enabled", "isPattern", "groupName", "auto"]);
const SNAPSHOT_KEYS = Object.freeze(["id", "revision", "baseline", "draft"]);
const DISPLAY_PATH_MAX_LENGTH = 160;
const HOST_MESSAGE_MAX_LENGTH = 300;
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL_CHARACTER_RUNS = /[\u0000-\u001f\u007f]+/g;

const EDIT_INPUT_MESSAGE = "This plugin could not read this redirect request. Reload the redirect and try again.";
const EDIT_READ_ONLY_MESSAGE = "This installation lets this plugin read redirects but not change them.";
const EDIT_LOAD_FAILED_MESSAGE = "EmDash did not return this redirect. Try again.";
const EDIT_MISSING_MESSAGE = "EmDash has no redirect with this ID. It may have been deleted, so check EmDash Redirects.";
const EDIT_DELETED_MESSAGE =
	"EmDash no longer has this redirect. This plugin does not recreate it, so check EmDash Redirects.";
const EDIT_STALE_MESSAGE =
	"This redirect changed in EmDash after you opened it, so nothing was saved. Your changes are kept. Reload the redirect and review it before saving again.";
const EDIT_CHANGED_MESSAGE =
	"EmDash now has a different version of this redirect than the one you asked for. Your changes are kept. Reload the redirect and review it before saving again.";
const EDIT_PENDING_MESSAGE =
	"EmDash still has the version you opened, but the save may still be running. Check again in a moment, or review the redirect in EmDash Redirects.";
const EDIT_UNREADABLE_MESSAGE =
	"This plugin could not read this redirect back from EmDash, so it cannot tell whether the change was saved. Check again, or review the redirect in EmDash Redirects.";
const EDIT_READ_FAILED_MESSAGE =
	"EmDash did not return this redirect, so nothing was saved. Your changes are kept, so you can save again.";
const EDIT_DEADLINE_MESSAGE =
	"Checking this change took too long, so nothing was saved. Your changes are kept, so you can save again.";
const EDIT_NOT_SAVED_MESSAGE =
	"EmDash finished the request without saving the change. Your changes are kept, so you can save again.";
const EDIT_BUSY_MESSAGE = "Another redirect change was in progress, so nothing was saved. Save again.";
const EDIT_PRECONDITION_MESSAGE =
	"EmDash did not accept the version this form loaded, so nothing was saved. Reload the redirect and review it before saving again.";

function boundedString(value: unknown, min: number, max: number): value is string {
	return typeof value === "string" && value.length >= min && value.length <= max;
}

/** At most `max` characters for a message. Only that prefix of `text` is ever processed. */
function messageText(text: string, max: number): string {
	const cut = text.length > max;
	let end = cut ? max - 3 : text.length;
	const last = text.charCodeAt(end - 1);
	if (cut && last >= 0xd800 && last <= 0xdbff) end -= 1;
	const shown = text.slice(0, end).replace(CONTROL_CHARACTER_RUNS, " ");
	return cut ? `${shown}...` : shown;
}

/** A path shortened for a message; the stored value itself is never cut. */
function displayPath(path: string): string {
	return messageText(path, DISPLAY_PATH_MAX_LENGTH);
}

function hostMessage(error: unknown, fallback: string): string {
	const text = error instanceof Error && typeof error.message === "string"
		? messageText(error.message, HOST_MESSAGE_MAX_LENGTH).trim()
		: "";
	return text || fallback;
}

/** Whether a host record fits the bounds Shipit exposes. Records are refused, never truncated to fit. */
function withinRecordEnvelope(rule: RedirectRule): boolean {
	return typeof rule === "object" && rule !== null &&
		boundedString(rule.id, 1, REDIRECT_ID_MAX_LENGTH) &&
		boundedString(rule.source, 0, REDIRECT_PATH_MAX_LENGTH) &&
		boundedString(rule.destination, 0, REDIRECT_PATH_MAX_LENGTH) &&
		(rule.groupName === null || boundedString(rule.groupName, 0, REDIRECT_GROUP_MAX_LENGTH)) &&
		boundedString(rule.createdAt, 0, REDIRECT_TIMESTAMP_MAX_LENGTH) &&
		boundedString(rule.updatedAt, 0, REDIRECT_TIMESTAMP_MAX_LENGTH) &&
		(rule.lastHitAt === null || boundedString(rule.lastHitAt, 0, REDIRECT_TIMESTAMP_MAX_LENGTH)) &&
		Number.isSafeInteger(rule.hits) && rule.hits >= 0 && REDIRECT_STATUSES.includes(rule.type) &&
		typeof rule.isPattern === "boolean" && typeof rule.enabled === "boolean" && typeof rule.auto === "boolean";
}

function exposableRule(rule: RedirectRule): RedirectRule | null {
	return withinRecordEnvelope(rule) ? rule : null;
}

/** Whether the edit form may change this record. Guidance only; the commands decide. */
export function redirectRuleEditability(rule: RedirectRule): RedirectRuleEditability {
	if (!withinRecordEnvelope(rule)) return "envelope";
	if (rule.isPattern) return "pattern";
	if (rule.type !== 301 && rule.type !== 302) return "type";
	return "editable";
}

export function redirectRuleConfiguration(rule: RedirectRule): RedirectRuleConfiguration {
	return {
		source: rule.source,
		destination: rule.destination,
		type: rule.type,
		enabled: rule.enabled,
		isPattern: rule.isPattern,
		groupName: rule.groupName,
		auto: rule.auto,
	};
}

function sameConfiguration(left: RedirectRuleConfiguration, right: RedirectRuleConfiguration): boolean {
	return left.source === right.source && left.destination === right.destination && left.type === right.type &&
		left.enabled === right.enabled && left.isPattern === right.isPattern && left.groupName === right.groupName &&
		left.auto === right.auto;
}

function readableVersion(version: VersionedRedirectRule, id: string): boolean {
	return typeof version === "object" && version !== null &&
		boundedString(version.revision, 1, REDIRECT_REVISION_MAX_LENGTH) &&
		withinRecordEnvelope(version.rule) && version.rule.id === id;
}

function versionEditability(version: VersionedRedirectRule, id: string): RedirectRuleEditability {
	return readableVersion(version, id) ? redirectRuleEditability(version.rule) : "envelope";
}

type RedirectRuleUnsupported = Extract<RedirectRuleLoadResult, { status: "unsupported" }>;

/** A record outside the envelope is never returned, so nothing is shown truncated. */
function unsupportedEdit(reason: RedirectRuleUnsupportedReason, rule: RedirectRule | null): RedirectRuleUnsupported {
	if (reason === "envelope" || rule === null) {
		return {
			status: "unsupported",
			reason: "envelope",
			rule: null,
			message: "This redirect has values this plugin cannot show in full. Edit it in EmDash Redirects.",
		};
	}
	return {
		status: "unsupported",
		reason,
		rule,
		message: reason === "pattern"
			? "This is a pattern redirect. Edit pattern redirects in EmDash Redirects."
			: `This plugin edits 301 and 302 redirects. Edit this ${redirectTypeLabel(rule.type)} rule in EmDash Redirects.`,
	};
}

function malformedRead(error: unknown): boolean {
	return error instanceof RedirectHostError && error.code === "malformed";
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const own = Object.keys(value);
	return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
		? value as Record<string, unknown>
		: null;
}

function parseEditDraft(record: Record<string, unknown>): RedirectRuleEditDraft | null {
	const { source, destination, enabled } = record;
	const type = record.type === 301 || record.type === 302 ? record.type : null;
	if (!boundedString(source, 0, REDIRECT_EDIT_INPUT_MAX_LENGTH) ||
		!boundedString(destination, 0, REDIRECT_EDIT_INPUT_MAX_LENGTH) ||
		type === null || typeof enabled !== "boolean") return null;
	return { source, destination, type, enabled };
}

function parseUpdateRequest(input: unknown): RedirectRuleUpdateRequest | null {
	const record = exactRecord(input, UPDATE_REQUEST_KEYS);
	if (!record) return null;
	const { id, revision } = record;
	const draft = parseEditDraft(record);
	if (!draft || !boundedString(id, 1, REDIRECT_ID_MAX_LENGTH) || !boundedString(revision, 1, REDIRECT_REVISION_MAX_LENGTH)) {
		return null;
	}
	return { id, revision, ...draft };
}

// The baseline is the configuration of an editable record, so it carries the
// record envelope and an editable type.
function parseConfiguration(input: unknown): RedirectRuleConfiguration | null {
	const record = exactRecord(input, CONFIGURATION_KEYS);
	if (!record) return null;
	const { source, destination, enabled, auto } = record;
	const type = record.type === 301 || record.type === 302 ? record.type : null;
	const groupName = record.groupName === null || boundedString(record.groupName, 0, REDIRECT_GROUP_MAX_LENGTH)
		? record.groupName
		: undefined;
	if (!boundedString(source, 0, REDIRECT_PATH_MAX_LENGTH) || !boundedString(destination, 0, REDIRECT_PATH_MAX_LENGTH) ||
		type === null || typeof enabled !== "boolean" || record.isPattern !== false || typeof auto !== "boolean" ||
		groupName === undefined) return null;
	return { source, destination, type, enabled, isPattern: false, groupName, auto };
}

function parseUpdateSnapshot(input: unknown): RedirectRuleUpdateSnapshot | null {
	const record = exactRecord(input, SNAPSHOT_KEYS);
	if (!record) return null;
	const { id, revision } = record;
	const baseline = parseConfiguration(record.baseline);
	const draftRecord = exactRecord(record.draft, EDIT_DRAFT_KEYS);
	const draft = draftRecord ? parseEditDraft(draftRecord) : null;
	if (!baseline || !draft || !boundedString(id, 1, REDIRECT_ID_MAX_LENGTH) ||
		!boundedString(revision, 1, REDIRECT_REVISION_MAX_LENGTH)) return null;
	return { id, revision, baseline, draft };
}

function parseLoadRequest(input: unknown): string | null {
	const record = exactRecord(input, ["id"]);
	return record && boundedString(record.id, 1, REDIRECT_ID_MAX_LENGTH) ? record.id : null;
}

type RedirectEditPlan =
	| { kind: "unchanged" }
	| { kind: "invalid"; errors: RedirectRuleEditFieldErrors }
	| { kind: "disable-only"; patch: RedirectRulePatch }
	| {
		kind: "change";
		patch: RedirectRulePatch;
		proposed: RedirectRuleDraft & { enabled: boolean };
		/** The source moves, or the saved rule serves: duplicates and aliases are checked. */
		checkSource: boolean;
		/** The saved rule serves: the chain after replacement is checked. */
		checkChain: boolean;
	};

/**
 * The minimal change from a baseline to the form fields, without host calls.
 * Fields are compared as stored first, so an unchanged legacy path is never
 * rewritten and never blocks turning the rule off; only fields the user
 * changed are normalized, and the patch is recomputed afterwards.
 */
function planRedirectRuleEdit(baseline: RedirectRuleConfiguration, draft: RedirectRuleEditDraft): RedirectEditPlan {
	const sourceTyped = draft.source !== baseline.source;
	const destinationTyped = draft.destination !== baseline.destination;
	const typeChanged = draft.type !== baseline.type;
	if (!sourceTyped && !destinationTyped && !typeChanged) {
		if (draft.enabled === baseline.enabled) return { kind: "unchanged" };
		if (!draft.enabled) return { kind: "disable-only", patch: { enabled: false } };
	}
	const errors: RedirectRuleEditFieldErrors = {};
	let source = baseline.source;
	let destination = baseline.destination;
	if (sourceTyped) {
		const normalized = normalizePath(draft.source, "source");
		if ("issue" in normalized) errors.source = { code: normalized.issue, message: PATH_MESSAGES[normalized.issue].source };
		else source = normalized.path;
	}
	if (destinationTyped) {
		const normalized = normalizePath(draft.destination, "destination");
		if ("issue" in normalized) {
			errors.destination = { code: normalized.issue, message: PATH_MESSAGES[normalized.issue].destination };
		} else destination = normalized.path;
	}
	if (errors.source || errors.destination) return { kind: "invalid", errors };
	const sourceChanged = source !== baseline.source;
	const destinationChanged = destination !== baseline.destination;
	const patch: RedirectRulePatch = {
		...(sourceChanged ? { source } : {}),
		...(destinationChanged ? { destination } : {}),
		...(typeChanged ? { type: draft.type } : {}),
		...(draft.enabled !== baseline.enabled ? { enabled: draft.enabled } : {}),
	};
	if (Object.keys(patch).length === 0) return { kind: "unchanged" };
	// The patch is not empty, so an enabled result saves an active edge, even
	// when only its status changes. Such a rule must be one EmDash can
	// execute, so an unchanged legacy field needs an explicit fix rather than
	// a rewrite.
	const activeEdge = draft.enabled;
	if (activeEdge && !sourceChanged) {
		const stored = normalizePath(baseline.source, "source");
		if ("issue" in stored) {
			errors.source = {
				code: stored.issue,
				message: `Fix the saved source before this redirect can be active. ${PATH_MESSAGES[stored.issue].source}`,
			};
		} else if (stored.path !== baseline.source) {
			errors.source = {
				code: "stored-path",
				message: `EmDash compares requests with ${displayPath(stored.path)}, so the saved source never matches. Enter the path in that form to make this redirect active.`,
			};
		}
	}
	if (activeEdge && !destinationChanged) {
		const stored = normalizePath(baseline.destination, "destination");
		if ("issue" in stored) {
			errors.destination = {
				code: stored.issue,
				message: `Fix the saved destination before this redirect can be active. ${PATH_MESSAGES[stored.issue].destination}`,
			};
		}
	}
	if (sourceChanged || destinationChanged) {
		// The host matches the pathname and tries one trailing-slash variant.
		const followed = followedPathname(destination);
		if ("pathname" in followed && redirectAliasKey(source) === redirectAliasKey(followed.pathname)) {
			if (destinationChanged) {
				errors.destination ??= {
					code: "same-address",
					message: "This is the same address as the source, so visitors would be redirected in a loop.",
				};
			} else {
				errors.source ??= {
					code: "same-address",
					message: "This is the same address as the destination, so visitors would be redirected in a loop.",
				};
			}
		}
	}
	if (errors.source || errors.destination) return { kind: "invalid", errors };
	return {
		kind: "change",
		patch,
		proposed: { source, destination, type: draft.type, enabled: draft.enabled },
		checkSource: sourceChanged || activeEdge,
		checkChain: activeEdge,
	};
}

function deadlineResult(): RedirectRuleUpdateResult {
	return { status: "not-saved", reason: "deadline", message: EDIT_DEADLINE_MESSAGE, retryable: true };
}

/**
 * The bounded duplicate and chain checks for the record after replacement.
 * They run outside EmDash's write lock: a different record saved in between is
 * not seen, so they do not make the graph or alias uniqueness atomic.
 */
async function preflightRedirectEdit(
	host: RedirectHost,
	plan: Extract<RedirectEditPlan, { kind: "change" }>,
	guard: RedirectEditGuard,
): Promise<RedirectRuleUpdateResult | null> {
	const rule = plan.proposed;
	// The root path has no trailing-slash alias; the host rejects exact duplicates.
	if (plan.checkSource && rule.source !== "/") {
		const scan = await scanForSource(host, rule.source, guard);
		if (scan.exact) {
			return {
				status: "conflict",
				reason: "duplicate",
				message: `A redirect from ${displayPath(scan.exact.source)} already exists. It goes to ${displayPath(scan.exact.destination)} with ${scan.exact.type}.`,
				existing: exposableRule(scan.exact),
			};
		}
		if (scan.alias) {
			return {
				status: "conflict",
				reason: "trailing-slash",
				message: `EmDash treats ${displayPath(rule.source)} and ${displayPath(scan.alias.source)} as the same address, and ${displayPath(scan.alias.source)} already redirects to ${displayPath(scan.alias.destination)}.`,
				existing: exposableRule(scan.alias),
			};
		}
		if (!scan.complete) {
			if (guard.stopped === "deadline") return deadlineResult();
			return {
				status: "conflict",
				reason: "check-incomplete",
				message: `This plugin could not finish checking for another redirect from ${displayPath(redirectAliasKey(rule.source))}, so nothing was saved. Edit this redirect in EmDash Redirects.`,
				existing: null,
			};
		}
	}
	if (plan.checkChain) {
		const chain = await checkRedirectChain(host, rule, guard);
		if (chain.state === "loop") {
			return {
				status: "conflict",
				reason: "loop",
				message: `This change would send visitors in a loop: ${chain.path.map(displayPath).join(" -> ")}. EmDash treats a trailing slash and a query string as the same address.`,
				existing: null,
			};
		}
		if (chain.state === "incomplete") {
			if (guard.stopped === "deadline") return deadlineResult();
			return {
				status: "conflict",
				reason: "check-incomplete",
				message: `This plugin could not finish checking where ${displayPath(chain.pathname)} redirects next, so nothing was saved. Review that chain in EmDash Redirects before saving this change there.`,
				existing: null,
			};
		}
	}
	return null;
}

type RedirectEditObservation = Extract<
	RedirectRuleUpdateResult,
	{ status: "updated" | "unchanged" | "stale" | "missing" | "uncertain" | "not-saved" }
>;

interface RedirectEditOperation {
	id: string;
	revision: string;
	baseline: RedirectRuleConfiguration;
	expected: RedirectRuleConfiguration;
}

/**
 * Compares one exact-ID read with the operation, ignoring hits and timestamps.
 * `finished` is true only when this command saw the host's own update promise
 * settle; any other observer of the baseline cannot tell a failed write from
 * one still running.
 */
function classifyEdit(
	observed: VersionedRedirectRule,
	operation: RedirectEditOperation,
	finished: boolean,
	confirmedBy: "host" | "recovery",
): RedirectEditObservation {
	const configuration = redirectRuleConfiguration(observed.rule);
	if (sameConfiguration(configuration, operation.expected)) {
		if (sameConfiguration(operation.expected, operation.baseline)) {
			return { status: "unchanged", rule: observed.rule, revision: observed.revision };
		}
		// Every committed configuration write rotates the revision, so the
		// requested configuration under the baseline revision confirms nothing.
		if (observed.revision === operation.revision) {
			return { status: "uncertain", reason: "unreadable", message: EDIT_UNREADABLE_MESSAGE };
		}
		return { status: "updated", rule: observed.rule, revision: observed.revision, confirmedBy };
	}
	if (observed.revision === operation.revision && sameConfiguration(configuration, operation.baseline)) {
		return finished
			? { status: "not-saved", reason: "write-failed", message: EDIT_NOT_SAVED_MESSAGE, retryable: true }
			: { status: "uncertain", reason: "pending", message: EDIT_PENDING_MESSAGE };
	}
	return { status: "stale", reason: "changed", message: EDIT_CHANGED_MESSAGE, current: observed.rule };
}

/** One exact-ID read and no write. A missing record is reported, never searched for by source or recreated. */
async function settleRedirectEdit(
	host: RedirectHost,
	operation: RedirectEditOperation,
	finished: boolean,
): Promise<RedirectEditObservation> {
	let observed: VersionedRedirectRule | null;
	try {
		observed = await host.get!(operation.id);
	} catch {
		return { status: "uncertain", reason: "unreadable", message: EDIT_UNREADABLE_MESSAGE };
	}
	if (observed === null) return { status: "missing", message: EDIT_DELETED_MESSAGE };
	if (!readableVersion(observed, operation.id)) {
		return { status: "uncertain", reason: "unreadable", message: EDIT_UNREADABLE_MESSAGE };
	}
	return classifyEdit(observed, operation, finished, "recovery");
}

/** Host errors that prove the conditional write was refused before it ran. */
function updateRefusal(error: unknown): RedirectRuleUpdateResult | null {
	if (!(error instanceof RedirectHostError) || error.pending) return null;
	switch (error.code) {
		case "stale":
			return { status: "stale", reason: "revision", message: EDIT_STALE_MESSAGE, current: null };
		case "conflict":
			return {
				status: "conflict",
				reason: "duplicate",
				message: "Another redirect already uses this source, so nothing was saved.",
				existing: null,
			};
		case "busy":
			return { status: "busy", message: EDIT_BUSY_MESSAGE, retryable: true };
		case "precondition":
			return { status: "refused", reason: "precondition", message: EDIT_PRECONDITION_MESSAGE };
		case "validation":
			return error.loop
				? {
					status: "conflict",
					reason: "loop",
					message: hostMessage(error, "EmDash refused this change because it would create a loop."),
					existing: null,
				}
				: {
					status: "refused",
					reason: "host-validation",
					message: hostMessage(error, "EmDash refused this change. Your changes are kept."),
				};
		default:
			return null;
	}
}

async function writeRedirectEdit(
	host: RedirectHost,
	operation: RedirectEditOperation,
	patch: RedirectRulePatch,
): Promise<RedirectRuleUpdateResult> {
	let finished = false;
	try {
		const saved = await host.update!(operation.id, patch, operation.revision);
		// A later administrator's edit can already be in the host's readback. A
		// readback that settles nothing gets the same single recovery read; the
		// host reported success, so it never becomes "not saved".
		if (readableVersion(saved, operation.id)) {
			const result = classifyEdit(saved, operation, false, "host");
			if (result.status !== "uncertain") return result;
		}
	} catch (error) {
		const refusal = updateRefusal(error);
		if (refusal) return refusal;
		// The host can commit and then fail its final read, so the error alone
		// proves nothing. Only a rejection of the settled host call, not a
		// pending transport or a fulfilled call with an unreadable readback,
		// lets an unchanged baseline mean "not saved".
		finished = error instanceof RedirectHostError && !error.pending && error.code !== "malformed";
	}
	return settleRedirectEdit(host, operation, finished);
}

/** Opening the edit form: one exact-ID read. */
export async function loadRedirectRule(
	host: RedirectHost | null,
	input: unknown,
	options: { canManage: boolean },
): Promise<RedirectRuleLoadResult> {
	if (!host || !host.get) return { status: "unavailable", reason: "no-access", message: NO_ACCESS_MESSAGE };
	const id = parseLoadRequest(input);
	if (id === null) return { status: "invalid", reason: "input", message: EDIT_INPUT_MESSAGE };
	let version: VersionedRedirectRule | null;
	try {
		version = await host.get(id);
	} catch (error) {
		if (malformedRead(error)) return unsupportedEdit("envelope", null);
		return { status: "failed", message: EDIT_LOAD_FAILED_MESSAGE, retryable: true };
	}
	if (version === null) return { status: "missing", message: EDIT_MISSING_MESSAGE };
	const editability = versionEditability(version, id);
	if (editability !== "editable") return unsupportedEdit(editability, version.rule);
	return {
		status: "loaded",
		rule: version.rule,
		revision: version.revision,
		update: !host.update ? "read-only" : options.canManage ? "available" : "no-permission",
	};
}

/**
 * Saves the edit form. One command makes at most one read, the bounded
 * duplicate and chain reads, one conditional update and one recovery read.
 * The update patch carries only changed configuration fields; group, origin,
 * hits and timestamps stay with EmDash.
 */
export async function updateRedirectRule(
	host: RedirectHost | null,
	input: unknown,
	options: RedirectRuleEditOptions = {},
): Promise<RedirectRuleUpdateResult> {
	if (!host || !host.get) return { status: "unavailable", reason: "no-access", message: NO_ACCESS_MESSAGE };
	if (!host.update) return { status: "unavailable", reason: "read-only", message: EDIT_READ_ONLY_MESSAGE };
	const request = parseUpdateRequest(input);
	if (!request) return { status: "invalid", reason: "input", message: EDIT_INPUT_MESSAGE };
	const clock = options.clock ?? Date.now;
	const deadline = clock() + REDIRECT_EDIT_PREFLIGHT_MS;
	let current: VersionedRedirectRule | null;
	try {
		current = await host.get(request.id);
	} catch (error) {
		if (malformedRead(error)) return unsupportedEdit("envelope", null);
		return { status: "not-saved", reason: "read-failed", message: EDIT_READ_FAILED_MESSAGE, retryable: true };
	}
	// Nothing was written yet, so a missing record is final for this save.
	if (current === null) return { status: "missing", message: EDIT_MISSING_MESSAGE };
	const editability = versionEditability(current, request.id);
	if (editability !== "editable") return unsupportedEdit(editability, current.rule);
	if (current.revision !== request.revision) {
		return { status: "stale", reason: "revision", message: EDIT_STALE_MESSAGE, current: current.rule };
	}
	const baseline = redirectRuleConfiguration(current.rule);
	const plan = planRedirectRuleEdit(baseline, request);
	if (plan.kind === "unchanged") return { status: "unchanged", rule: current.rule, revision: current.revision };
	if (plan.kind === "invalid") return { status: "invalid", reason: "fields", errors: plan.errors };
	if (plan.kind === "change") {
		const refusal = await preflightRedirectEdit(host, plan, { excludeId: request.id, clock, deadline, stopped: null });
		if (refusal) return refusal;
	}
	if (clock() >= deadline) return deadlineResult();
	return writeRedirectEdit(host, {
		id: request.id,
		revision: current.revision,
		baseline,
		expected: { ...baseline, ...plan.patch },
	}, plan.patch);
}

/**
 * Recovery for a save whose response was lost or uncertain: one exact-ID read
 * and no write. It cannot know whether the original request finished, so an
 * unchanged baseline stays uncertain rather than unlocking another save.
 */
export async function reconcileRedirectRuleUpdate(
	host: RedirectHost | null,
	input: unknown,
): Promise<RedirectRuleUpdateRecoveryResult> {
	if (!host || !host.get) return { status: "unavailable", reason: "no-access", message: NO_ACCESS_MESSAGE };
	const snapshot = parseUpdateSnapshot(input);
	if (!snapshot) return { status: "invalid", reason: "input", message: EDIT_INPUT_MESSAGE };
	const plan = planRedirectRuleEdit(snapshot.baseline, snapshot.draft);
	if (plan.kind === "invalid") return { status: "invalid", reason: "fields", errors: plan.errors };
	const patch = plan.kind === "unchanged" ? {} : plan.patch;
	const result = await settleRedirectEdit(host, {
		id: snapshot.id,
		revision: snapshot.revision,
		baseline: snapshot.baseline,
		expected: { ...snapshot.baseline, ...patch },
	}, false);
	// Unreachable with `finished` false; a recovery read never proves the write failed.
	if (result.status === "not-saved") return { status: "uncertain", reason: "pending", message: EDIT_PENDING_MESSAGE };
	return result;
}
