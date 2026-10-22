// Request orchestration for contextual internal-link suggestions over the
// read-only ports. Find and Next read the exact saved source once, fresh scope
// definitions, one bounded candidate page, one global policy identity and at
// most the five displayed targets. Verify rereads the exact source, scope,
// policy and the chosen target only. Check saved link rereads the exact source
// only. Nothing here writes, lists, counts, scans onward or retries.

import { isSeoContentCollectionKey } from "./admin-contract.ts";
import { jsonUtf8LengthWithin } from "./lib.ts";
import {
	LINK_PORT_BUDGETS,
	linkScopeCheck,
	type LinkResolvedScope,
	type LinkScopeRequest,
	type LinkSuggestionPorts,
	type LinkSuggestionPortsAvailability,
} from "./internal-link-source.ts";
import {
	LINK_SUGGESTION_LIMITS,
	canonicalLinkLocale,
	checkSavedLink,
	finalizeLinkSuggestions,
	linkSuggestionOwnerKey,
	rankLinkSuggestions,
	validateLinkSourceDocument,
	validateLinkSuggestionRequest,
	verifyChosenLinkTarget,
	type LinkCandidatePage,
	type LinkFinalizeRefusal,
	type LinkPolicyRead,
	type LinkRankRefusal,
	type LinkResolvedTarget,
	type LinkSavedCheck,
	type LinkScopeCheck,
	type LinkSourceDocument,
	type LinkSourceRead,
	type LinkStaleReason,
	type LinkSuggestionOwner,
	type LinkSuggestionRequest,
	type LinkSuggestionResponse,
	type LinkTargetRead,
	type LinkVerification,
} from "./internal-link-suggestions.ts";

const PAGE_BUDGET = Object.freeze({
	candidateRows: LINK_PORT_BUDGETS.candidateRows,
	scopeMatches: LINK_PORT_BUDGETS.scopeMatches,
});
const REQUEST_BYTES = 16_384;

export const LINK_PAGE_RECEIPT_FORMAT = "link-page-v1";
/** Covers every field at its identity and version limit in four-byte UTF-8. */
export const LINK_PAGE_RECEIPT_BYTES = 16_384;

// ---------------------------------------------------------------------------
// Requests, receipts and results

export interface LinkFindRequest {
	/** The exact saved source the editor shows, with the saved version it expects. */
	source: { collection: string; entryId: string; locale: string; sourceVersion: string };
	/** The client's local selection generation. */
	generation: number;
	/** One destination collection and optional exact terms of one taxonomy. */
	destination: { collection: string; taxonomy: { taxonomy: string; termIds: readonly string[] } | null };
}

/** Plain, bounded state for one explicit Next; never a database or definition object. */
export interface LinkPageReceipt {
	format: typeof LINK_PAGE_RECEIPT_FORMAT;
	source: { collection: string; entryId: string; locale: string; sourceVersion: string; revisionId: string | null; field: string };
	generation: number;
	scope: { collection: string; locale: string; taxonomy: string | null; termIds: readonly string[]; scopeVersion: string; upperId: string };
	afterId: string;
}

export interface LinkNextRequest {
	/** The client's current generation; a receipt from an older selection is stale. */
	generation: number;
	receipt: LinkPageReceipt;
}

export type LinkRuntimeInvalid = "request" | "receipt" | "collection-unavailable" | "taxonomy-not-attached" | "term-unavailable" | "too-many-terms";
export type LinkRuntimeStale = "source-missing" | "source-version-changed" | "source-locale-changed" | "scope-changed" | "selection-changed";
export type LinkRuntimeUnavailable = "adapter-absent" | "source-unavailable" | "scope-unavailable" | "candidates-unavailable" | "policy-unreadable";

export type LinkPageResult =
	| { kind: "result"; response: LinkSuggestionResponse; next: LinkPageReceipt | null }
	| { kind: "invalid"; reason: LinkRuntimeInvalid }
	| { kind: "stale"; reason: LinkRuntimeStale }
	| { kind: "unavailable"; reason: LinkRuntimeUnavailable }
	| { kind: "unsupported"; reason: "no-portable-text-field" | "ambiguous-body-field" }
	| { kind: "refused"; reason: LinkRankRefusal | LinkFinalizeRefusal };

export type LinkVerifyResult =
	| { kind: "verification"; ownerKey: string; target: { collection: string; entryId: string }; verification: LinkVerification }
	| { kind: "invalid"; reason: "request" }
	| { kind: "unavailable"; reason: "adapter-absent" };

export type LinkSavedLinkResult =
	| { kind: "saved-check"; ownerKey: string; target: { collection: string; entryId: string }; check: LinkSavedCheck }
	| { kind: "invalid"; reason: "request" }
	| { kind: "unavailable"; reason: "adapter-absent" };

export interface LinkSuggestionRuntime {
	find(input: unknown): Promise<LinkPageResult>;
	next(input: unknown): Promise<LinkPageResult>;
	verify(input: unknown): Promise<LinkVerifyResult>;
	checkSaved(input: unknown): Promise<LinkSavedLinkResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentity(value: unknown, max: number = LINK_SUGGESTION_LIMITS.identityChars): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value &&
		!/[\u0000-\u001f\u007f]/u.test(value);
}

function isCount(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const own = Object.keys(value);
	return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function withinBytes(value: unknown, limit: number): boolean {
	try {
		return jsonUtf8LengthWithin(value, limit) !== null;
	} catch {
		return false;
	}
}

function isCanonicalLocale(value: unknown): value is string {
	return typeof value === "string" && canonicalLinkLocale(value) === value;
}

function sortedTerms(value: unknown): value is string[] {
	return Array.isArray(value) && value.length <= LINK_SUGGESTION_LIMITS.taxonomyTerms &&
		value.every((term, index) => isIdentity(term) && (index === 0 || String(value[index - 1]) < term));
}

export function validateLinkFindRequest(value: unknown): LinkFindRequest | null {
	if (!withinBytes(value, REQUEST_BYTES) || !isRecord(value) || !exactKeys(value, ["source", "generation", "destination"])) return null;
	const { source, generation, destination } = value;
	if (!isRecord(source) || !exactKeys(source, ["collection", "entryId", "locale", "sourceVersion"]) ||
		!isSeoContentCollectionKey(source.collection) || !isIdentity(source.entryId) || !isCanonicalLocale(source.locale) ||
		!isIdentity(source.sourceVersion, LINK_SUGGESTION_LIMITS.versionChars) || !isCount(generation)) return null;
	if (!isRecord(destination) || !exactKeys(destination, ["collection", "taxonomy"]) || !isSeoContentCollectionKey(destination.collection)) return null;
	const taxonomy = destination.taxonomy;
	let selected: LinkFindRequest["destination"]["taxonomy"] = null;
	if (taxonomy !== null) {
		if (!isRecord(taxonomy) || !exactKeys(taxonomy, ["taxonomy", "termIds"]) || !isIdentity(taxonomy.taxonomy)) return null;
		const termIds = taxonomy.termIds;
		if (!Array.isArray(termIds) || termIds.length === 0 || termIds.length > LINK_SUGGESTION_LIMITS.taxonomyTerms ||
			!termIds.every((term) => isIdentity(term)) || new Set(termIds).size !== termIds.length) return null;
		selected = { taxonomy: taxonomy.taxonomy, termIds: [...(termIds as string[])] };
	}
	return {
		source: { collection: source.collection, entryId: source.entryId, locale: source.locale, sourceVersion: source.sourceVersion },
		generation,
		destination: { collection: destination.collection, taxonomy: selected },
	};
}

export function validateLinkPageReceipt(value: unknown): LinkPageReceipt | null {
	if (!withinBytes(value, LINK_PAGE_RECEIPT_BYTES) || !isRecord(value) ||
		!exactKeys(value, ["format", "source", "generation", "scope", "afterId"]) || value.format !== LINK_PAGE_RECEIPT_FORMAT) return null;
	const { source, scope, afterId } = value;
	if (!isRecord(source) || !exactKeys(source, ["collection", "entryId", "locale", "sourceVersion", "revisionId", "field"]) ||
		!isSeoContentCollectionKey(source.collection) || !isIdentity(source.entryId) || !isCanonicalLocale(source.locale) ||
		!isIdentity(source.sourceVersion, LINK_SUGGESTION_LIMITS.versionChars) ||
		(source.revisionId !== null && !isIdentity(source.revisionId)) || !isIdentity(source.field) || !isCount(value.generation)) return null;
	if (!isRecord(scope) || !exactKeys(scope, ["collection", "locale", "taxonomy", "termIds", "scopeVersion", "upperId"]) ||
		!isSeoContentCollectionKey(scope.collection) || scope.locale !== source.locale ||
		(scope.taxonomy !== null && !isIdentity(scope.taxonomy)) || !sortedTerms(scope.termIds) ||
		(scope.taxonomy === null) !== (scope.termIds.length === 0) ||
		!isIdentity(scope.scopeVersion, LINK_SUGGESTION_LIMITS.versionChars) || !isIdentity(scope.upperId)) return null;
	// A receipt exists only while rows remain inside its fixed window.
	if (!isIdentity(afterId) || !(afterId < scope.upperId)) return null;
	return {
		format: LINK_PAGE_RECEIPT_FORMAT,
		source: {
			collection: source.collection as string, entryId: source.entryId as string, locale: source.locale as string,
			sourceVersion: source.sourceVersion as string, revisionId: source.revisionId as string | null, field: source.field as string,
		},
		generation: value.generation as number,
		scope: {
			collection: scope.collection as string, locale: source.locale as string, taxonomy: scope.taxonomy as string | null,
			termIds: [...(scope.termIds as string[])], scopeVersion: scope.scopeVersion as string, upperId: scope.upperId as string,
		},
		afterId,
	};
}

export function validateLinkNextRequest(value: unknown): LinkNextRequest | null {
	if (!isRecord(value) || !exactKeys(value, ["generation", "receipt"]) || !isCount(value.generation)) return null;
	const receipt = validateLinkPageReceipt(value.receipt);
	return receipt ? { generation: value.generation, receipt } : null;
}

// ---------------------------------------------------------------------------
// The candidate page refusal boundary

export type LinkPageRefusalReason = "scope-changed" | "unavailable";

/**
 * Reads a candidate port's refusal by its name and reason, so no adapter
 * class is imported. Every other failure is unavailable, never an empty page.
 */
export function linkPageRefusalReason(error: unknown): LinkPageRefusalReason {
	return isRecord(error) && error.name === "LinkCandidatePageRefusal" && error.reason === "scope-changed" ? "scope-changed" : "unavailable";
}

// ---------------------------------------------------------------------------
// Guarded reads

const INVALID_SCOPE_REASONS: readonly string[] = ["collection-unavailable", "taxonomy-not-attached", "term-unavailable", "too-many-terms"];

type ScopeState =
	| { kind: "resolved"; scope: LinkResolvedScope }
	| { kind: "invalid"; reason: "collection-unavailable" | "taxonomy-not-attached" | "term-unavailable" | "too-many-terms" }
	| { kind: "unavailable" };

async function readExactSource(ports: LinkSuggestionPorts, ref: { collection: string; entryId: string }): Promise<LinkSourceRead> {
	let read: unknown;
	try {
		read = await ports.source.readSource({ collection: ref.collection, entryId: ref.entryId });
	} catch {
		return { kind: "unavailable" };
	}
	if (!isRecord(read)) return { kind: "unavailable" };
	if (read.kind === "missing") return { kind: "missing" };
	if (read.kind === "unsupported" && (read.reason === "no-portable-text-field" || read.reason === "ambiguous-body-field")) {
		return { kind: "unsupported", reason: read.reason };
	}
	if (read.kind !== "found") return { kind: "unavailable" };
	const document = validateLinkSourceDocument(read.document);
	if (!document || document.collection !== ref.collection || document.entryId !== ref.entryId) return { kind: "unavailable" };
	// Only the optional route port may name the saved route; a source port's own value is never trusted.
	let routeUrl: string | null = null;
	if (ports.sourceRoute) {
		try {
			const route: unknown = await ports.sourceRoute.resolveSavedRoute({
				collection: document.collection, entryId: document.entryId, sourceVersion: document.sourceVersion,
			});
			if (isRecord(route) && route.kind === "resolved" && typeof route.url === "string" && route.url.length <= LINK_SUGGESTION_LIMITS.urlChars) {
				routeUrl = route.url;
			}
		} catch {
			// An unreadable route is no route.
		}
	}
	return { kind: "found", document: { ...document, routeUrl } };
}

function scopeRequest(collection: string, locale: string, taxonomy: string | null, termIds: readonly string[]): LinkScopeRequest {
	return { collection, locale, taxonomy: taxonomy === null ? null : { taxonomy, termIds: [...termIds] } };
}

async function resolveFreshScope(ports: LinkSuggestionPorts, allowed: readonly string[], request: LinkScopeRequest): Promise<ScopeState> {
	let resolution: unknown;
	try {
		resolution = await ports.candidates.resolveScope(request, [...allowed]);
	} catch {
		return { kind: "unavailable" };
	}
	if (!isRecord(resolution)) return { kind: "unavailable" };
	if (resolution.kind === "invalid" && typeof resolution.reason === "string" && INVALID_SCOPE_REASONS.includes(resolution.reason)) {
		return { kind: "invalid", reason: resolution.reason as Extract<ScopeState, { kind: "invalid" }>["reason"] };
	}
	if (resolution.kind !== "resolved" || !isRecord(resolution.scope)) return { kind: "unavailable" };
	const { collection, locale, taxonomy, termIds, scopeVersion, upperId } = resolution.scope;
	const expectedTaxonomy = request.taxonomy === null ? null : request.taxonomy.taxonomy;
	const expectedTerms = request.taxonomy === null ? [] : [...new Set(request.taxonomy.termIds)].sort();
	if (
		collection !== request.collection || !allowed.includes(request.collection) || locale !== request.locale ||
		taxonomy !== expectedTaxonomy || !sortedTerms(termIds) || termIds.length !== expectedTerms.length ||
		!termIds.every((term, index) => term === expectedTerms[index]) ||
		!isIdentity(scopeVersion, LINK_SUGGESTION_LIMITS.versionChars) || (upperId !== null && !isIdentity(upperId))
	) return { kind: "unavailable" };
	return {
		kind: "resolved",
		scope: { collection: request.collection, locale: request.locale, taxonomy: expectedTaxonomy, termIds: expectedTerms, scopeVersion, upperId: upperId as string | null },
	};
}

type PageState = { kind: "page"; page: LinkCandidatePage } | { kind: "scope-changed" } | { kind: "unavailable" } | { kind: "malformed" };

/**
 * One bounded page inside the fixed window. A page that does not advance,
 * leaves the window or claims rows beyond its budget is malformed; the rest
 * of its shape is the engine's to validate.
 */
async function readCandidatePage(ports: LinkSuggestionPorts, scope: LinkResolvedScope, afterId: string | null): Promise<PageState> {
	let page: unknown;
	try {
		page = await ports.candidates.page({ ...scope, termIds: [...scope.termIds] }, afterId, { ...PAGE_BUDGET });
	} catch (error) {
		return { kind: linkPageRefusalReason(error) };
	}
	if (!isRecord(page) || !Array.isArray(page.candidates) || typeof page.exhausted !== "boolean") return { kind: "malformed" };
	const { candidates, examinedRows, nextAfterId, exhausted } = page;
	const upperId = scope.upperId;
	if (candidates.length > PAGE_BUDGET.scopeMatches || !isCount(examinedRows) || examinedRows > PAGE_BUDGET.candidateRows ||
		candidates.length > examinedRows) return { kind: "malformed" };
	if (exhausted) {
		if (nextAfterId !== null) return { kind: "malformed" };
	} else if (!isIdentity(nextAfterId) || upperId === null || examinedRows === 0 || (afterId !== null && !(nextAfterId > afterId)) ||
		!(nextAfterId < upperId)) {
		return { kind: "malformed" };
	}
	if (upperId === null && (candidates.length > 0 || examinedRows > 0)) return { kind: "malformed" };
	let previous = afterId;
	for (const candidate of candidates) {
		// The reference is its own cursor position, so a target read can never leave the window.
		const position = isRecord(candidate) && candidate.entryId === candidate.afterId ? candidate.afterId : undefined;
		if (!isIdentity(position) || upperId === null || position > upperId || (previous !== null && !(position > previous)) ||
			(typeof nextAfterId === "string" && position > nextAfterId)) return { kind: "malformed" };
		previous = position;
	}
	return { kind: "page", page: page as unknown as LinkCandidatePage };
}

async function readPolicy(ports: LinkSuggestionPorts): Promise<LinkPolicyRead> {
	try {
		const policy: unknown = await ports.policy.readPolicy();
		if (isRecord(policy) && policy.kind === "readable" && isIdentity(policy.version, LINK_SUGGESTION_LIMITS.versionChars)) {
			return { kind: "readable", version: policy.version };
		}
	} catch {
		// Unreadable below.
	}
	return { kind: "unreadable" };
}

async function readTarget(
	ports: LinkSuggestionPorts,
	ref: { collection: string; entryId: string },
	scope: LinkResolvedScope,
	globalPolicyVersion: string,
): Promise<LinkTargetRead> {
	try {
		const read: unknown = await ports.targets.readTarget({ ...ref }, { ...scope, termIds: [...scope.termIds] }, globalPolicyVersion);
		if (isRecord(read) && (read.kind === "missing" || read.kind === "unavailable")) return { kind: read.kind };
		if (isRecord(read) && read.kind === "found" && isRecord(read.target)) return { kind: "found", target: read.target as unknown as LinkResolvedTarget };
	} catch {
		// Unavailable below.
	}
	return { kind: "unavailable" };
}

// ---------------------------------------------------------------------------
// One suggestion page

function ownerOf(document: LinkSourceDocument, generation: number, scope: Omit<LinkResolvedScope, "upperId">, afterId: string | null): LinkSuggestionOwner {
	return {
		source: {
			collection: document.collection, entryId: document.entryId, locale: document.locale,
			sourceVersion: document.sourceVersion, revisionId: document.revisionId, field: document.field,
		},
		scope: {
			collection: scope.collection, locale: scope.locale, taxonomy: scope.taxonomy, termIds: [...scope.termIds],
			afterId, scopeVersion: scope.scopeVersion,
		},
		generation,
	};
}

/**
 * The engine's own ranking over an empty page is its source identity, body
 * and route validation; it reads nothing and runs before any scope read.
 */
function sourceRefusal(document: LinkSourceDocument, generation: number, collection: string, taxonomy: string | null, termIds: readonly string[]): LinkRankRefusal | null {
	const owner = ownerOf(document, generation, {
		collection, locale: document.locale, taxonomy, termIds: [...termIds].sort(), scopeVersion: "unresolved",
	}, null);
	const ranked = rankLinkSuggestions({ owner, source: document, page: { candidates: [], examinedRows: 0, nextAfterId: null, exhausted: true } });
	return ranked.kind === "refused" ? ranked.reason : null;
}

function sourceState(read: LinkSourceRead): Exclude<LinkPageResult, { kind: "result" }> | null {
	if (read.kind === "missing") return { kind: "stale", reason: "source-missing" };
	if (read.kind === "unsupported") return { kind: "unsupported", reason: read.reason };
	if (read.kind === "unavailable") return { kind: "unavailable", reason: "source-unavailable" };
	return null;
}

/** The whole serialized result, receipt included, within the response budget; the lowest suggestions go first. */
function withinResponseCap(result: Extract<LinkPageResult, { kind: "result" }>, responseBytes: number): LinkPageResult {
	let response = result.response;
	while (!withinBytes({ ...result, response }, responseBytes)) {
		if (response.suggestions.length === 0) return { kind: "refused", reason: "response_too_large" };
		response = {
			...response,
			suggestions: response.suggestions.slice(0, -1),
			omittedForResponseLimit: response.omittedForResponseLimit + 1,
		};
	}
	return { ...result, response };
}

async function suggestionPage(
	ports: LinkSuggestionPorts,
	document: LinkSourceDocument,
	generation: number,
	scope: LinkResolvedScope,
	afterId: string | null,
	responseBytes: number,
): Promise<LinkPageResult> {
	const read = await readCandidatePage(ports, scope, afterId);
	if (read.kind === "scope-changed") return { kind: "stale", reason: "scope-changed" };
	if (read.kind === "unavailable") return { kind: "unavailable", reason: "candidates-unavailable" };
	if (read.kind === "malformed") return { kind: "refused", reason: "candidate_page_invalid" };
	const owner = ownerOf(document, generation, scope, afterId);
	const ranked = rankLinkSuggestions({ owner, source: document, page: read.page });
	if (ranked.kind === "refused") return { kind: "refused", reason: ranked.reason };
	if (ranked.provisional.length > LINK_PORT_BUDGETS.displayedTargetReads) return { kind: "refused", reason: "target_reads_invalid" };

	const policy = await readPolicy(ports);
	if (policy.kind !== "readable") return { kind: "unavailable", reason: "policy-unreadable" };
	// Only the provisional suggestions are read; an excluded target is never replaced.
	const targets: { collection: string; entryId: string; read: LinkTargetRead }[] = [];
	for (const item of ranked.provisional) {
		const ref = { collection: item.candidate.collection, entryId: item.candidate.entryId };
		targets.push({ ...ref, read: await readTarget(ports, ref, scope, policy.version) });
	}
	const outcome = finalizeLinkSuggestions(ranked, targets, policy);
	if (outcome.kind === "refused") return { kind: "refused", reason: outcome.reason };
	const response = outcome.response;
	const nextAfterId = response.page.nextAfterId;
	const next: LinkPageReceipt | null = response.page.exhausted || nextAfterId === null || scope.upperId === null ? null : {
		format: LINK_PAGE_RECEIPT_FORMAT,
		source: { ...owner.source },
		generation,
		scope: {
			collection: scope.collection, locale: scope.locale, taxonomy: scope.taxonomy, termIds: [...scope.termIds],
			scopeVersion: scope.scopeVersion, upperId: scope.upperId,
		},
		afterId: nextAfterId,
	};
	return withinResponseCap({ kind: "result", response, next }, responseBytes);
}

// ---------------------------------------------------------------------------
// The runtime

function allowedList(value: readonly string[]): string[] {
	return Array.isArray(value) ? value.filter((collection) => isSeoContentCollectionKey(collection)) : [];
}

/**
 * A private plain copy of a Verify or Check request, taken before validation
 * and before the first await. The frozen request validator keeps `suggestion`
 * by reference, so the copy is what it validates and what every later step
 * reads; a caller's later change to its own object cannot reach the result.
 */
function privateRequest(value: unknown): LinkSuggestionRequest | null {
	if (!withinBytes(value, LINK_SUGGESTION_LIMITS.responseBytes)) return null;
	let copy: unknown;
	try {
		copy = JSON.parse(JSON.stringify(value));
	} catch {
		return null;
	}
	return validateLinkSuggestionRequest(copy);
}

function targetOf(request: { suggestion: { target: { collection: string; entryId: string } } }) {
	return { collection: request.suggestion.target.collection, entryId: request.suggestion.target.entryId };
}

const STALE_ORDER: readonly LinkStaleReason[] = ["source-missing", "source-version-changed", "anchor-changed", "scope-changed", "policy-changed", "target-changed"];

/**
 * The verified result once more against a closing read of the exact source
 * and the global policy, both taken after the chosen-target read. The target
 * was evaluated under the opening policy, so the engine checks the closing
 * source against that policy and a readable closing identity change is named
 * stale here. No transaction spans the reads.
 */
function closingVerification(
	request: LinkSuggestionRequest,
	target: LinkTargetRead,
	scope: LinkScopeCheck,
	opening: Extract<LinkPolicyRead, { kind: "readable" }>,
	source: LinkSourceRead,
	policy: LinkPolicyRead,
): LinkVerification {
	const closed = verifyChosenLinkTarget({ request, source, target, policy: opening, scope });
	if (closed.kind === "unavailable") return closed;
	if (policy.kind !== "readable") return { kind: "unavailable", reason: "policy-unreadable" };
	if (policy.version === opening.version) return closed;
	const reasons = new Set<LinkStaleReason>(closed.kind === "stale" ? closed.reasons : []);
	reasons.add("policy-changed");
	return {
		kind: "stale",
		reasons: STALE_ORDER.filter((reason) => reasons.has(reason)),
		...(closed.kind === "stale" && closed.target ? { target: closed.target } : {}),
	};
}

/**
 * `responseBytes` bounds the whole serialized Find or Next result. It may
 * only lower the 49,152-byte default, for a caller that wraps the result.
 */
export function createLinkSuggestionRuntime(options: {
	ports: LinkSuggestionPortsAvailability;
	allowedCollections: readonly string[];
	responseBytes?: number;
}): LinkSuggestionRuntime {
	const availability = options.ports;
	const allowed = allowedList(options.allowedCollections);
	const ports = availability.kind === "available" ? availability.ports : null;
	const responseBytes = options.responseBytes ?? LINK_SUGGESTION_LIMITS.responseBytes;
	if (!Number.isSafeInteger(responseBytes) || responseBytes < 1 || responseBytes > LINK_SUGGESTION_LIMITS.responseBytes) {
		throw new RangeError("The link response budget must be a whole number of bytes, at most " + LINK_SUGGESTION_LIMITS.responseBytes + ".");
	}

	return {
		async find(input) {
			if (!ports) return { kind: "unavailable", reason: "adapter-absent" };
			const request = validateLinkFindRequest(input);
			if (!request) return { kind: "invalid", reason: "request" };
			const { source, destination } = request;
			if (!allowed.includes(destination.collection)) return { kind: "invalid", reason: "collection-unavailable" };

			const read = await readExactSource(ports, source);
			const state = sourceState(read);
			if (state || read.kind !== "found") return state ?? { kind: "unavailable", reason: "source-unavailable" };
			const document = read.document;
			if (document.locale !== source.locale) return { kind: "stale", reason: "source-locale-changed" };
			if (document.sourceVersion !== source.sourceVersion) return { kind: "stale", reason: "source-version-changed" };
			const taxonomy = destination.taxonomy;
			const refusal = sourceRefusal(document, request.generation, destination.collection, taxonomy?.taxonomy ?? null, taxonomy?.termIds ?? []);
			if (refusal) return { kind: "refused", reason: refusal };

			const fresh = await resolveFreshScope(ports, allowed,
				scopeRequest(destination.collection, document.locale, taxonomy?.taxonomy ?? null, taxonomy?.termIds ?? []));
			if (fresh.kind === "invalid") return { kind: "invalid", reason: fresh.reason };
			if (fresh.kind === "unavailable") return { kind: "unavailable", reason: "scope-unavailable" };
			return suggestionPage(ports, document, request.generation, fresh.scope, null, responseBytes);
		},

		async next(input) {
			if (!ports) return { kind: "unavailable", reason: "adapter-absent" };
			const request = validateLinkNextRequest(input);
			if (!request) return { kind: "invalid", reason: "receipt" };
			const { receipt } = request;
			if (request.generation !== receipt.generation) return { kind: "stale", reason: "selection-changed" };
			if (!allowed.includes(receipt.scope.collection)) return { kind: "stale", reason: "scope-changed" };

			const read = await readExactSource(ports, receipt.source);
			const state = sourceState(read);
			if (state || read.kind !== "found") return state ?? { kind: "unavailable", reason: "source-unavailable" };
			const document = read.document;
			if (document.locale !== receipt.source.locale) return { kind: "stale", reason: "source-locale-changed" };
			if (document.sourceVersion !== receipt.source.sourceVersion || document.revisionId !== receipt.source.revisionId ||
				document.field !== receipt.source.field) return { kind: "stale", reason: "source-version-changed" };
			const original = receipt.scope;
			const refusal = sourceRefusal(document, receipt.generation, original.collection, original.taxonomy, original.termIds);
			if (refusal) return { kind: "refused", reason: refusal };

			const fresh = await resolveFreshScope(ports, allowed, scopeRequest(original.collection, original.locale, original.taxonomy, original.termIds));
			if (fresh.kind === "invalid") return { kind: "stale", reason: "scope-changed" };
			if (fresh.kind === "unavailable") return { kind: "unavailable", reason: "scope-unavailable" };
			const check = linkScopeCheck({ ...original, termIds: [...original.termIds], afterId: receipt.afterId }, { kind: "resolved", scope: fresh.scope });
			if (check.kind !== "current" || check.scopeVersion !== original.scopeVersion) return { kind: "stale", reason: "scope-changed" };
			// The window stays the one fixed at Find, even when newer rows now exist.
			return suggestionPage(ports, document, receipt.generation, { ...fresh.scope, upperId: original.upperId }, receipt.afterId, responseBytes);
		},

		async verify(input) {
			if (!ports) return { kind: "unavailable", reason: "adapter-absent" };
			const request = privateRequest(input);
			if (!request) return { kind: "invalid", reason: "request" };
			const { owner } = request;
			const target = targetOf(request);
			const ownerKey = linkSuggestionOwnerKey(owner);

			const source = await readExactSource(ports, owner.source);
			const fresh = await resolveFreshScope(ports, allowed,
				scopeRequest(owner.scope.collection, owner.scope.locale, owner.scope.taxonomy, owner.scope.termIds));
			// A scope that no longer resolves is stale before any policy or target read, but an
			// unreadable, unsupported or missing source keeps the engine's precedence.
			if (fresh.kind === "invalid") {
				const verification: LinkVerification =
					source.kind === "unavailable" ? { kind: "unavailable", reason: "source-unavailable" }
					: source.kind === "unsupported" ? { kind: "unavailable", reason: "source-unsupported" }
					: source.kind === "missing" ? { kind: "stale", reasons: ["source-missing"] }
					: { kind: "stale", reasons: ["scope-changed"] };
				return { kind: "verification", ownerKey, target, verification };
			}
			const policy = await readPolicy(ports);
			const targetRead: LinkTargetRead = fresh.kind === "resolved" && policy.kind === "readable"
				? await readTarget(ports, target, fresh.scope, policy.version)
				: { kind: "unavailable" };
			const scope: LinkScopeCheck = fresh.kind === "resolved"
				? linkScopeCheck(owner.scope, { kind: "resolved", scope: fresh.scope })
				: { kind: "unavailable" };
			const opening = verifyChosenLinkTarget({ request, source, target: targetRead, policy, scope });
			if (opening.kind !== "verified" || policy.kind !== "readable") return { kind: "verification", ownerKey, target, verification: opening };
			// A save or settings write while the target and its URL were read is invisible to them.
			const closingSource = await readExactSource(ports, owner.source);
			const closingPolicy = await readPolicy(ports);
			return {
				kind: "verification", ownerKey, target,
				verification: closingVerification(request, targetRead, scope, policy, closingSource, closingPolicy),
			};
		},

		async checkSaved(input) {
			if (!ports) return { kind: "unavailable", reason: "adapter-absent" };
			const request = privateRequest(input);
			if (!request) return { kind: "invalid", reason: "request" };
			// The saved source alone: target eligibility, policy and candidates are not reread.
			const source = await readExactSource(ports, request.owner.source);
			return { kind: "saved-check", ownerKey: linkSuggestionOwnerKey(request.owner), target: targetOf(request), check: checkSavedLink({ request, source }) };
		},
	};
}
