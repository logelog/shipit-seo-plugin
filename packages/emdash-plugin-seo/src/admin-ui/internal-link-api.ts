// Browser transport for the four private internal-link commands. Each call
// posts the captured JSON through the admin client's CSRF-aware fetch and
// envelope parser, keeps its AbortSignal and lets HTTP failures and aborts
// surface unchanged. A response becomes usable only after exact wire,
// ownership, receipt and URL checks against the request that produced it.

import {
	SEO_ENGINE_PLUGIN_ID,
	type LinkFindRequest,
	type LinkNextRequest,
	type LinkPageReceipt,
	type LinkPageResult,
	type LinkSavedLinkResult,
	type LinkSuggestionRequest,
	type LinkVerifyResult,
} from "../admin-contract.ts";
import {
	LINK_EXCLUSION_REASONS,
	LINK_SUGGESTION_LIMITS,
	acceptLinkSuggestionResponse,
	canonicalLinkLocale,
	linkCopyValue,
	linkSiteBase,
	linkSuggestionOwnerKey,
	validateLinkSuggestionOwner,
	validateLinkSuggestionRequest,
	type LinkSuggestionOwner,
} from "../internal-link-suggestions.ts";
import { jsonUtf8LengthWithin } from "../lib.ts";

export const LINK_API_COMMANDS = Object.freeze({
	find: "find-link-suggestions",
	next: "next-link-suggestions",
	verify: "verify-link-suggestion",
	checkSaved: "check-saved-link",
} as const);
export type LinkApiCommand = keyof typeof LINK_API_COMMANDS;

/**
 * Every command result: 49,152 bytes less the host's 24-byte success wrapper.
 * A Find/Next page counts its receipt; a verified URL and its percent-encoded
 * route can themselves pass 16 KiB.
 */
export const LINK_RESULT_MAX_BYTES = 49_128;
export const LINK_PAGE_RECEIPT_MAX_BYTES = 16_384;
const RECEIPT_FORMAT = "link-page-v1";

export function linkApiUrl(command: LinkApiCommand): string {
	return `/_emdash/api/plugins/${SEO_ENGINE_PLUGIN_ID}/${LINK_API_COMMANDS[command]}`;
}

// ---------------------------------------------------------------------------
// Transport

/** The two published admin client functions this module uses. */
export interface LinkApiClient {
	apiFetch(input: string, init?: RequestInit): Promise<Response>;
	parseApiResponse<T>(response: Response, fallbackMessage?: string): Promise<T>;
}

export type LinkApiClientLoader = () => Promise<LinkApiClient>;

/** The published admin client, loaded only when a command is sent. */
export const loadAdminLinkApiClient: LinkApiClientLoader = async () => {
	const admin = await import("@emdash-cms/admin");
	return { apiFetch: admin.apiFetch, parseApiResponse: admin.parseApiResponse };
};

export type LinkUnusableReason =
	| "oversized"
	| "malformed"
	| "owner-mismatch"
	| "receipt-invalid"
	| "target-mismatch"
	| "url-mismatch"
	| "request-invalid";

/** A response that answered but cannot be used; it never becomes suggestions or eligibility. */
export interface LinkUnusable { kind: "unusable"; reason: LinkUnusableReason }

export type LinkPageOutcome = LinkPageResult | LinkUnusable;
export type LinkVerifyOutcome = LinkVerifyResult | LinkUnusable;
export type LinkCheckOutcome = LinkSavedLinkResult | LinkUnusable;

/** An immutable chosen request with the identities its Verify and Check answers must repeat. */
export interface LinkSubmission {
	readonly request: LinkSuggestionRequest;
	readonly ownerKey: string;
	readonly target: { readonly collection: string; readonly entryId: string };
}

export interface LinkSuggestionApi {
	find(request: LinkFindRequest, signal?: AbortSignal): Promise<LinkPageOutcome>;
	next(request: LinkNextRequest, signal?: AbortSignal): Promise<LinkPageOutcome>;
	verify(submission: LinkSubmission, signal?: AbortSignal): Promise<LinkVerifyOutcome>;
	checkSaved(submission: LinkSubmission, signal?: AbortSignal): Promise<LinkCheckOutcome>;
}

const unusable = (reason: LinkUnusableReason): LinkUnusable => ({ kind: "unusable", reason });

/** The exact JSON body and a frozen copy of it, or null for a value JSON cannot carry. */
function snapshot<T>(value: T): { body: string; value: T } | null {
	try {
		const body = JSON.stringify(value);
		return typeof body === "string" ? { body, value: deepFreeze(JSON.parse(body) as T) } : null;
	} catch {
		return null;
	}
}

/**
 * The submission as it is at call time: its request is cloned, validated and
 * frozen again, and its identities must agree with that request.
 */
function capturedSubmission(submission: LinkSubmission): LinkSubmission | null {
	const captured = prepareLinkSubmission(submission?.request);
	return captured && submission.ownerKey === captured.ownerKey && submission.target?.collection === captured.target.collection &&
		submission.target?.entryId === captured.target.entryId ? captured : null;
}

/**
 * One request per call through the given client. Each method captures its
 * body and the ownership its answer must match before the first await, so a
 * later change to the caller's objects reaches neither. No raw fetch
 * fallback, no retry and no empty page in place of a failure.
 */
export function createLinkSuggestionApi(load: LinkApiClientLoader = loadAdminLinkApiClient): LinkSuggestionApi {
	const post = async (command: LinkApiCommand, body: string, signal: AbortSignal | undefined, fallback: string) => {
		const client = await load();
		const response = await client.apiFetch(linkApiUrl(command), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			...(signal ? { signal } : {}),
		});
		return client.parseApiResponse<unknown>(response, fallback);
	};
	return {
		async find(request, signal) {
			const captured = snapshot(request);
			if (!captured) return unusable("request-invalid");
			return parseLinkFindResult(await post("find", captured.body, signal, "Link suggestions could not be loaded."), captured.value);
		},
		async next(request, signal) {
			const captured = snapshot(request);
			if (!captured || !nextOwner(captured.value)) return unusable("request-invalid");
			return parseLinkNextResult(await post("next", captured.body, signal, "The next link suggestions could not be loaded."), captured.value);
		},
		async verify(submission, signal) {
			const captured = capturedSubmission(submission);
			if (!captured) return unusable("request-invalid");
			return parseLinkVerifyResult(await post("verify", JSON.stringify(captured.request), signal, "The link target could not be verified."), captured);
		},
		async checkSaved(submission, signal) {
			const captured = capturedSubmission(submission);
			if (!captured) return unusable("request-invalid");
			return parseLinkCheckResult(await post("checkSaved", JSON.stringify(captured.request), signal, "The saved link could not be checked."), captured);
		},
	};
}

// ---------------------------------------------------------------------------
// Exact wire shapes

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withinBytes(value: unknown, limit: number): boolean {
	try {
		return jsonUtf8LengthWithin(value, limit) !== null;
	} catch {
		return false;
	}
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const own = Object.keys(value);
	return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

interface Shape {
	keys: readonly string[];
	nested?: Record<string, Shape>;
}

function hasShape(value: unknown, shape: Shape): boolean {
	return isRecord(value) && exactKeys(value, shape.keys) &&
		Object.entries(shape.nested ?? {}).every(([key, inner]) => hasShape(value[key], inner));
}

const OWNER: Shape = {
	keys: ["source", "scope", "generation"],
	nested: {
		source: { keys: ["collection", "entryId", "locale", "sourceVersion", "revisionId", "field"] },
		scope: { keys: ["collection", "locale", "taxonomy", "termIds", "afterId", "scopeVersion"] },
	},
};
const SUGGESTION: Shape = {
	keys: ["target", "anchor", "reason"],
	nested: {
		target: { keys: ["collection", "entryId", "locale", "title", "publicUrl", "route", "version", "targetPolicyVersion"] },
		anchor: {
			keys: ["blockKey", "spanKey", "blockKind", "start", "end", "text", "paragraph", "paragraphStart", "paragraphEnd", "decorators", "occurrence", "heading"],
			nested: { occurrence: { keys: ["ordinal", "total"] } },
		},
		reason: { keys: ["kind", "field", "quote", "tokens"] },
	},
};
const RESPONSE: Shape = {
	keys: ["status", "notice", "owner", "policyVersion", "coverage", "suggestions", "excluded", "omittedForResponseLimit", "page"],
	nested: { owner: OWNER, page: { keys: ["examinedRows", "scopeMatches", "nextAfterId", "exhausted"] } },
};
const RECEIPT: Shape = {
	keys: ["format", "source", "generation", "scope", "afterId"],
	nested: {
		source: { keys: ["collection", "entryId", "locale", "sourceVersion", "revisionId", "field"] },
		scope: { keys: ["collection", "locale", "taxonomy", "termIds", "scopeVersion", "upperId"] },
	},
};

const PAGE_FAILURES: Readonly<Record<string, readonly string[]>> = {
	invalid: ["request", "receipt", "collection-unavailable", "taxonomy-not-attached", "term-unavailable", "too-many-terms"],
	stale: ["source-missing", "source-version-changed", "source-locale-changed", "scope-changed", "selection-changed"],
	unavailable: ["adapter-absent", "source-unavailable", "scope-unavailable", "candidates-unavailable", "policy-unreadable"],
	unsupported: ["no-portable-text-field", "ambiguous-body-field"],
	refused: [
		"source_body_unsupported", "source_body_malformed", "source_too_large", "invalid_input", "owner_mismatch",
		"site_url_unavailable", "source_route_unavailable", "candidate_page_invalid",
		"policy_unreadable", "target_reads_invalid", "response_too_large",
	],
};
const COMMAND_FAILURES: Readonly<Record<string, readonly string[]>> = { invalid: ["request"], unavailable: ["adapter-absent"] };
const VERIFY_STALE = ["source-missing", "source-version-changed", "anchor-changed", "scope-changed", "policy-changed", "target-changed"];
const VERIFY_UNAVAILABLE = [
	"source-unavailable", "source-unsupported", "target-unavailable", "policy-unreadable", "scope-unavailable",
	"site-url-unavailable", "source-route-unavailable",
];
const CHECK_STALE = ["paragraph-missing", "paragraph-changed"];
const CHECK_INCONCLUSIVE = [
	"same-saved-version", "duplicate-paragraph", "decorators-changed", "source-missing", "source-unavailable",
	"source-unsupported", "source-unreadable", "site-url-unavailable", "source-route-unavailable", "links-unreadable",
];

/** A `{kind, reason}` failure with a reason this command can return; null for anything else. */
function knownFailure<T>(value: Record<string, unknown>, known: Readonly<Record<string, readonly string[]>>): T | null {
	if (!exactKeys(value, ["kind", "reason"]) || typeof value.kind !== "string" || !Object.hasOwn(known, value.kind)) return null;
	return typeof value.reason === "string" && known[value.kind].includes(value.reason) ? { kind: value.kind, reason: value.reason } as T : null;
}

const clone = <T>(value: T): T => structuredClone(value);

// ---------------------------------------------------------------------------
// Find and Next

/**
 * The receipt owner: the submitted receipt's identity at its cursor. The pure
 * owner validator applies the identity rules, so a second owner at the upper
 * ID checks that bound the same way.
 */
function receiptOwner(value: unknown): LinkSuggestionOwner | null {
	if (!withinBytes(value, LINK_PAGE_RECEIPT_MAX_BYTES) || !hasShape(value, RECEIPT) || (value as Record<string, unknown>).format !== RECEIPT_FORMAT) {
		return null;
	}
	const receipt = value as unknown as LinkPageReceipt;
	const { scope } = receipt;
	// The owner validator accepts a null cursor and comparison would coerce one; a receipt has neither.
	if (typeof receipt.afterId !== "string" || typeof scope.upperId !== "string") return null;
	const at = (afterId: string) => validateLinkSuggestionOwner({
		source: receipt.source,
		scope: { collection: scope.collection, locale: scope.locale, taxonomy: scope.taxonomy, termIds: scope.termIds, afterId, scopeVersion: scope.scopeVersion },
		generation: receipt.generation,
	});
	const owner = at(receipt.afterId);
	if (!owner || !at(scope.upperId) || !(receipt.afterId < scope.upperId)) return null;
	return owner;
}

/** A Next request's owner: a usable receipt whose generation the request repeats. */
function nextOwner(request: LinkNextRequest): LinkSuggestionOwner | null {
	if (!isRecord(request) || !exactKeys(request, ["generation", "receipt"])) return null;
	const owner = receiptOwner(request.receipt);
	return owner && request.generation === request.receipt.generation ? owner : null;
}

/** The first page's owner: everything the request named, with field, revision and scope version learned from the response. */
function firstFindOwner(owner: LinkSuggestionOwner, request: LinkFindRequest): boolean {
	if (!isRecord(request) || !isRecord(request.source) || !isRecord(request.destination) ||
		(request.destination.taxonomy !== null && !Array.isArray(request.destination.taxonomy?.termIds))) return false;
	const { source, destination } = request;
	const terms = destination.taxonomy === null ? [] : [...new Set(destination.taxonomy.termIds)].sort();
	return canonicalLinkLocale(source.locale) === source.locale && owner.source.locale === source.locale &&
		owner.source.collection === source.collection && owner.source.entryId === source.entryId &&
		owner.source.sourceVersion === source.sourceVersion && owner.generation === request.generation &&
		owner.scope.collection === destination.collection &&
		owner.scope.taxonomy === (destination.taxonomy === null ? null : destination.taxonomy.taxonomy) &&
		owner.scope.termIds.length === terms.length && owner.scope.termIds.every((term, index) => term === terms[index]) &&
		owner.scope.afterId === null;
}

type PageExpectation =
	| { kind: "find"; request: LinkFindRequest }
	| { kind: "next"; owner: LinkSuggestionOwner; upperId: string };

function parsePage(value: unknown, expectation: PageExpectation): LinkPageOutcome {
	if (!withinBytes(value, LINK_RESULT_MAX_BYTES)) return unusable("oversized");
	if (!isRecord(value)) return unusable("malformed");
	if (value.kind !== "result") return knownFailure<LinkPageResult>(value, PAGE_FAILURES) ?? unusable("malformed");
	if (!exactKeys(value, ["kind", "response", "next"]) || !hasShape(value.response, RESPONSE)) return unusable("malformed");
	const response = value.response as Record<string, unknown>;
	if (!Array.isArray(response.suggestions) || !response.suggestions.every((item) => hasShape(item, SUGGESTION))) return unusable("malformed");
	// The shared validator checks coverage values; partial coverage may still carry extra keys there.
	const coverage = response.coverage;
	if (!isRecord(coverage) || !exactKeys(coverage, coverage.kind === "partial" ? ["kind", "gaps", "limitation"] : ["kind"])) return unusable("malformed");
	const owner = validateLinkSuggestionOwner(response.owner);
	if (!owner) return unusable("malformed");
	const owned = expectation.kind === "find"
		? firstFindOwner(owner, expectation.request)
		: linkSuggestionOwnerKey(owner) === linkSuggestionOwnerKey(expectation.owner);
	if (!owned) return unusable("owner-mismatch");
	const acceptance = acceptLinkSuggestionResponse(response, owner);
	if (acceptance.kind !== "accepted") return unusable("malformed");
	const page = acceptance.response.page;

	// A receipt exists exactly while the page is not exhausted, and names this owner at the page cursor.
	if (page.exhausted || page.nextAfterId === null) {
		return page.exhausted && page.nextAfterId === null && value.next === null
			? { kind: "result", response: clone(acceptance.response), next: null }
			: unusable("receipt-invalid");
	}
	const next = receiptOwner(value.next);
	const advanced = { ...owner, scope: { ...owner.scope, afterId: page.nextAfterId } };
	const receipt = value.next as LinkPageReceipt;
	if (!next || linkSuggestionOwnerKey(next) !== linkSuggestionOwnerKey(advanced) || receipt.afterId !== page.nextAfterId ||
		(owner.scope.afterId !== null && !(page.nextAfterId > owner.scope.afterId)) ||
		(expectation.kind === "next" && receipt.scope.upperId !== expectation.upperId)) return unusable("receipt-invalid");
	return { kind: "result", response: clone(acceptance.response), next: clone(receipt) };
}

/** A first Find answer, owned by exactly the captured request. */
export function parseLinkFindResult(value: unknown, request: LinkFindRequest): LinkPageOutcome {
	return parsePage(value, { kind: "find", request });
}

/** A Next answer, owned by the submitted receipt's owner and kept inside its original upper window. */
export function parseLinkNextResult(value: unknown, request: LinkNextRequest): LinkPageOutcome {
	const owner = nextOwner(request);
	if (!owner) return unusable("request-invalid");
	return parsePage(value, { kind: "next", owner, upperId: request.receipt.scope.upperId });
}

// ---------------------------------------------------------------------------
// Verify and Check

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const item of Object.values(value)) deepFreeze(item);
		Object.freeze(value);
	}
	return value;
}

/**
 * A chosen suggestion as an immutable submission. The payload is cloned
 * before validation because the shared validator keeps the suggestion object
 * it was given.
 */
export function prepareLinkSubmission(chosen: unknown): LinkSubmission | null {
	if (!withinBytes(chosen, LINK_SUGGESTION_LIMITS.responseBytes)) return null;
	let copy: unknown;
	try {
		copy = JSON.parse(JSON.stringify(chosen));
	} catch {
		return null;
	}
	if (!isRecord(copy) || !exactKeys(copy, ["owner", "policyVersion", "suggestion"]) || !hasShape(copy.owner, OWNER) || !hasShape(copy.suggestion, SUGGESTION)) {
		return null;
	}
	const request = validateLinkSuggestionRequest(copy);
	if (!request) return null;
	return deepFreeze({
		request,
		ownerKey: linkSuggestionOwnerKey(request.owner),
		target: { collection: request.suggestion.target.collection, entryId: request.suggestion.target.entryId },
	});
}

/** The answer's own identity: the submitted owner key, then exactly the submitted target reference. */
function ownedVerdict(value: Record<string, unknown>, submission: LinkSubmission, verdictKey: string): LinkUnusable | null {
	if (!exactKeys(value, ["kind", "ownerKey", "target", verdictKey])) return unusable("malformed");
	if (value.ownerKey !== submission.ownerKey) return unusable("owner-mismatch");
	const target = value.target;
	if (!isRecord(target) || !exactKeys(target, ["collection", "entryId"]) || target.collection !== submission.target.collection ||
		target.entryId !== submission.target.entryId) return unusable("target-mismatch");
	return null;
}

const uniqueKnown = (values: unknown, known: readonly string[]) => Array.isArray(values) && values.length > 0 &&
	values.every((item) => typeof item === "string" && known.includes(item)) && new Set(values).size === values.length;

/**
 * A verified URL may differ from the provisional literal in scheme, query or
 * fragment, but it must be an absolute URL on the original target's host
 * with the chosen route.
 */
function verifiedUrlMatches(url: unknown, route: unknown, submission: LinkSubmission): boolean {
	const original = submission.request.suggestion.target;
	const base = linkSiteBase(original.publicUrl, null);
	const copy = base ? linkCopyValue(url, base) : null;
	return copy !== null && copy.url === url && copy.route === route && route === original.route;
}

/** Why a nested verdict cannot be used, or null for a known one. */
function verificationProblem(value: unknown, submission: LinkSubmission): LinkUnusable | null {
	if (!isRecord(value)) return unusable("malformed");
	if (value.kind === "verified") {
		if (!exactKeys(value, ["kind", "url", "route"])) return unusable("malformed");
		return verifiedUrlMatches(value.url, value.route, submission) ? null : unusable("url-mismatch");
	}
	if (value.kind === "stale") {
		const withTarget = Object.hasOwn(value, "target");
		return exactKeys(value, withTarget ? ["kind", "reasons", "target"] : ["kind", "reasons"]) && uniqueKnown(value.reasons, VERIFY_STALE) &&
			(!withTarget || (LINK_EXCLUSION_REASONS as readonly unknown[]).includes(value.target)) ? null : unusable("malformed");
	}
	if (value.kind === "unavailable") {
		return exactKeys(value, ["kind", "reason"]) && VERIFY_UNAVAILABLE.includes(value.reason as string) ? null : unusable("malformed");
	}
	return unusable("malformed");
}

/** A Verify answer for exactly this submission, with a known nested verdict. */
export function parseLinkVerifyResult(value: unknown, submission: LinkSubmission): LinkVerifyOutcome {
	if (!withinBytes(value, LINK_RESULT_MAX_BYTES)) return unusable("oversized");
	if (!isRecord(value)) return unusable("malformed");
	if (value.kind !== "verification") return knownFailure<LinkVerifyResult>(value, COMMAND_FAILURES) ?? unusable("malformed");
	const refused = ownedVerdict(value, submission, "verification") ?? verificationProblem(value.verification, submission);
	return refused ?? clone(value as unknown as LinkVerifyResult);
}

function knownSavedCheck(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (["verified", "unlinked", "partial", "wrong-destination"].includes(value.kind as string)) return exactKeys(value, ["kind"]);
	if (value.kind === "stale") return exactKeys(value, ["kind", "detail"]) && CHECK_STALE.includes(value.detail as string);
	if (value.kind === "inconclusive") return exactKeys(value, ["kind", "detail"]) && CHECK_INCONCLUSIVE.includes(value.detail as string);
	return false;
}

/**
 * A saved-link answer for exactly this submission. It says nothing about the
 * target's current eligibility or reachability, and it does not report which
 * newer saved version the host examined.
 */
export function parseLinkCheckResult(value: unknown, submission: LinkSubmission): LinkCheckOutcome {
	if (!withinBytes(value, LINK_RESULT_MAX_BYTES)) return unusable("oversized");
	if (!isRecord(value)) return unusable("malformed");
	if (value.kind !== "saved-check") return knownFailure<LinkSavedLinkResult>(value, COMMAND_FAILURES) ?? unusable("malformed");
	const refused = ownedVerdict(value, submission, "check");
	if (refused) return refused;
	return knownSavedCheck(value.check) ? clone(value as unknown as LinkSavedLinkResult) : unusable("malformed");
}

/** The exact byte measure every result parser applies first. */
export function linkResultWithinBytes(value: unknown): boolean {
	return withinBytes(value, LINK_RESULT_MAX_BYTES);
}
