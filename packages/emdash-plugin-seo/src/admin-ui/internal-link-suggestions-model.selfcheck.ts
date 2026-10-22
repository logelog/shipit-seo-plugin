import assert from "node:assert/strict";

import type { LinkFindRequest, LinkNextRequest, LinkPageReceipt } from "../admin-contract.ts";
import { finalizeLinkSuggestions, rankLinkSuggestions, type LinkSuggestionOwner } from "../internal-link-suggestions.ts";
import {
	parseLinkCheckResult,
	parseLinkFindResult,
	parseLinkNextResult,
	parseLinkVerifyResult,
	type LinkCheckOutcome,
	type LinkPageOutcome,
	type LinkSubmission,
	type LinkVerifyOutcome,
} from "./internal-link-api.ts";
import {
	beginLinkCheck,
	beginLinkCopy,
	beginLinkFind,
	beginLinkNext,
	beginLinkVerify,
	chooseLinkSuggestion,
	createLinkSession,
	isLinkPageReferenceOnly,
	settleLinkCheck,
	settleLinkCopy,
	settleLinkPaging,
	settleLinkVerify,
	updateLinkSessionContext,
	type LinkSessionContext,
	type LinkSessionState,
} from "./internal-link-suggestions-model.ts";
import { linkPageSummaryText } from "./internal-link-suggestions-presentation.ts";

// ---------------------------------------------------------------------------
// Answers built by the real pure engine for exactly the request the model issued

const SITE = "https://example.com";
const id = (index: number) => "01KG" + String(index).padStart(22, "0");
const P1 = "Our notes on drip irrigation explain spacing for raised beds.";
const BODY = [{ _type: "block", _key: "p1", style: "normal", markDefs: [], children: [{ _type: "span", _key: "p1-s", text: P1, marks: [] }] }];

function ownerFor(request: LinkFindRequest, afterId: string | null): LinkSuggestionOwner {
	const taxonomy = request.destination.taxonomy;
	return {
		source: { ...request.source, revisionId: null, field: "content" },
		scope: {
			collection: request.destination.collection, locale: request.source.locale, taxonomy: taxonomy === null ? null : taxonomy.taxonomy,
			termIds: taxonomy === null ? [] : [...new Set(taxonomy.termIds)].sort(), afterId, scopeVersion: "scope-1",
		},
		generation: request.generation,
	};
}

interface FixtureTarget { entryId: string; title: string; route: string }

function pageWire(owner: LinkSuggestionOwner, nextAfterId: string | null, candidateId: string): unknown {
	return pageWireFor(owner, nextAfterId, [{ entryId: candidateId, title: "Drip irrigation", route: "/guides/drip-irrigation" }]);
}

function pageWireFor(owner: LinkSuggestionOwner, nextAfterId: string | null, targets: readonly FixtureTarget[]): unknown {
	const candidates = targets.map((target) => ({ collection: owner.scope.collection, entryId: target.entryId, locale: owner.scope.locale, version: "entry-v1:1:2026-10-04 12:00:00", title: target.title, excerpt: null, afterId: target.entryId }));
	const routes = new Map(targets.map((target) => [target.entryId, target.route]));
	const exhausted = nextAfterId === null;
	const ranked = rankLinkSuggestions({ owner, source: { ...owner.source, body: BODY, siteUrl: SITE, routeUrl: null }, page: { candidates, examinedRows: 25, nextAfterId, exhausted } });
	if (ranked.kind !== "ranked") throw new Error("Fixture ranking refused: " + ranked.reason);
	const outcome = finalizeLinkSuggestions(ranked, ranked.provisional.map((item) => ({
		collection: item.candidate.collection, entryId: item.candidate.entryId,
		read: {
			kind: "found",
			target: {
				collection: item.candidate.collection, entryId: item.candidate.entryId, locale: item.candidate.locale, status: "published",
				version: item.candidate.version, title: item.candidate.title, publicUrl: SITE + routes.get(item.candidate.entryId),
				inScope: true, noindex: false, globalPolicyVersion: "policy-1", targetPolicyVersion: "target-policy-1",
			},
		},
	})), { kind: "readable", version: "policy-1" });
	if (outcome.kind !== "result") throw new Error("Fixture finalize refused: " + outcome.reason);
	const next = exhausted ? null : {
		format: "link-page-v1", source: { ...owner.source }, generation: owner.generation,
		scope: { collection: owner.scope.collection, locale: owner.scope.locale, taxonomy: owner.scope.taxonomy, termIds: [...owner.scope.termIds], scopeVersion: owner.scope.scopeVersion, upperId: id(60) },
		afterId: nextAfterId,
	};
	return { kind: "result", response: outcome.response, next };
}

const firstPage = (request: LinkFindRequest): LinkPageOutcome => parseLinkFindResult(pageWire(ownerFor(request, null), id(25), id(3)), request);
function secondPage(request: LinkNextRequest): LinkPageOutcome {
	const receipt = request.receipt;
	const owner: LinkSuggestionOwner = {
		source: receipt.source,
		scope: { collection: receipt.scope.collection, locale: receipt.scope.locale, taxonomy: receipt.scope.taxonomy, termIds: [...receipt.scope.termIds], afterId: receipt.afterId, scopeVersion: receipt.scope.scopeVersion },
		generation: receipt.generation,
	};
	return parseLinkNextResult(pageWire(owner, id(50), id(30)), request);
}
const verifiedAt = (submission: LinkSubmission, url: string): LinkVerifyOutcome => parseLinkVerifyResult({
	kind: "verification", ownerKey: submission.ownerKey, target: { ...submission.target }, verification: { kind: "verified", url, route: "/guides/drip-irrigation" },
}, submission);
const checkedAs = (submission: LinkSubmission, check: unknown): LinkCheckOutcome =>
	parseLinkCheckResult({ kind: "saved-check", ownerKey: submission.ownerKey, target: { ...submission.target }, check }, submission);

const context = (patch: Partial<LinkSessionContext> = {}): LinkSessionContext => ({
	collection: "posts", entryId: "01KSOURCE00000000000000001", locale: "en", savedVersion: "v1",
	destination: { collection: "guides", taxonomy: null }, ...patch,
});
const ok = <T>(value: T) => ({ ok: true as const, value });
const fail = (error: unknown) => ({ ok: false as const, error });

function started<T>(begin: { state: LinkSessionState; operation: T | null }, label: string): { state: LinkSessionState; operation: T } {
	if (begin.operation === null) throw new Error(label + ": the operation must start");
	return begin as { state: LinkSessionState; operation: T };
}

/** A session with a current first page for the default context. */
function withPage(patch: Partial<LinkSessionContext> = {}) {
	const find = started(beginLinkFind(updateLinkSessionContext(createLinkSession(), context(patch))), "find");
	const state = settleLinkPaging(find.state, find.operation, ok(firstPage(find.operation.request)));
	assert.ok(state.page, "The fixture page must be accepted");
	return state;
}

/** A session with copy eligibility for the default context. */
function withVerified(url = SITE + "/guides/drip-irrigation") {
	const chosen = chooseLinkSuggestion(withPage(), id(3));
	const verify = started(beginLinkVerify(chosen), "verify");
	const state = settleLinkVerify(verify.state, verify.operation, ok(verifiedAt(verify.operation.submission, url)));
	assert.ok(state.verified, "The fixture must be verified");
	return state;
}

const TWO_TARGETS: readonly FixtureTarget[] = [
	{ entryId: id(3), title: "Drip irrigation", route: "/guides/drip-irrigation" },
	{ entryId: id(4), title: "Raised beds", route: "/guides/raised-beds" },
];

function withTwoSuggestions() {
	const find = started(beginLinkFind(updateLinkSessionContext(createLinkSession(), context())), "find");
	const state = settleLinkPaging(find.state, find.operation, ok(parseLinkFindResult(pageWireFor(ownerFor(find.operation.request, null), id(25), TWO_TARGETS), find.operation.request)));
	assert.equal(state.page?.response.suggestions.length, 2, "The fixture page must offer two suggestions");
	return state;
}

/** Verifies the chosen suggestion at the URL its page offered. */
function verifyChosen(state: LinkSessionState): LinkSessionState {
	const verify = started(beginLinkVerify(state), "verify");
	const { submission } = verify.operation;
	const target = submission.request.suggestion.target;
	const verified = settleLinkVerify(verify.state, verify.operation, ok(parseLinkVerifyResult({
		kind: "verification", ownerKey: submission.ownerKey, target: { ...submission.target },
		verification: { kind: "verified", url: target.publicUrl, route: target.route },
	}, submission)));
	assert.ok(verified.verified, "The fixture must be verified");
	return verified;
}

/** Every object and array reachable from the value is frozen. */
function deeplyFrozen(value: unknown, path: string): void {
	if (value === null || typeof value !== "object") return;
	assert.ok(Object.isFrozen(value), path + " must be frozen");
	for (const [key, child] of Object.entries(value)) deeplyFrozen(child, path + "." + key);
}

const groups: string[] = [];

// ---------------------------------------------------------------------------
// Context: saves advance the generation, identity and scope changes the epoch

{
	const empty = createLinkSession();
	const first = updateLinkSessionContext(empty, context({ destination: { collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["t-water", "t-soil", "t-water"] } } }));
	assert.equal(first.epoch, 1);
	assert.equal(first.generation, 1);
	assert.deepEqual(first.context?.destination?.taxonomy?.termIds, ["t-soil", "t-water"], "Selected terms are sorted and unique");
	assert.equal(updateLinkSessionContext(first, { ...first.context as LinkSessionContext }), first, "An unchanged context changes nothing");
	const saved = updateLinkSessionContext(first, { ...first.context as LinkSessionContext, savedVersion: "v2" });
	assert.equal(saved.epoch, 1);
	assert.equal(saved.generation, 2);
	for (const [label, patch] of [
		["entry", { entryId: "01KSOURCE00000000000000002" }], ["collection", { collection: "pages" }], ["locale", { locale: "fr" }],
		["destination", { destination: { collection: "pages", taxonomy: null } }], ["terms", { destination: { collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["t-water"] } } }],
	] as const) {
		const changed = updateLinkSessionContext(saved, { ...saved.context as LinkSessionContext, ...patch });
		assert.equal(changed.epoch, 2, label);
		assert.equal(changed.generation, 3, label);
	}
	assert.equal(saved.paging, null, "A context change never starts an operation");
	assert.equal(saved.lastOperationId, 0);
	groups.push("context epochs and generations");
}

// ---------------------------------------------------------------------------
// Find and Next: captured requests, stale successes and stale errors

{
	for (const [label, patch] of [
		["no saved version", { savedVersion: null }], ["no destination", { destination: null }], ["non-canonical locale", { locale: "EN" }],
	] as const) assert.equal(beginLinkFind(updateLinkSessionContext(createLinkSession(), context(patch))).operation, null, label);
	assert.equal(beginLinkFind(createLinkSession()).operation, null);

	const ready = updateLinkSessionContext(createLinkSession(), context());
	const find = started(beginLinkFind(ready), "find");
	assert.deepEqual(find.operation.request, {
		source: { collection: "posts", entryId: "01KSOURCE00000000000000001", locale: "en", sourceVersion: "v1" },
		generation: ready.generation,
		destination: { collection: "guides", taxonomy: null },
	});
	assert.equal(find.operation.id, 1);
	assert.ok(Object.isFrozen(find.operation));
	const paged = settleLinkPaging(find.state, find.operation, ok(firstPage(find.operation.request)));
	assert.equal(paged.page?.response.suggestions[0].target.entryId, id(3));
	assert.equal(paged.page?.receipt?.afterId, id(25));

	// A save while Find is in flight discards its success and its error alike.
	const savedDuring = updateLinkSessionContext(find.state, context({ savedVersion: "v2" }));
	assert.equal(settleLinkPaging(savedDuring, find.operation, ok(firstPage(find.operation.request))), savedDuring);
	assert.equal(settleLinkPaging(savedDuring, find.operation, fail(Object.assign(new Error("x"), { status: 500 }))), savedDuring);
	// A newer Find supersedes an older one.
	const older = started(beginLinkFind(ready), "older");
	const newer = started(beginLinkFind(older.state), "newer");
	assert.ok(newer.operation.id > older.operation.id, "Operation IDs are monotonic");
	assert.equal(settleLinkPaging(newer.state, older.operation, ok(firstPage(older.operation.request))), newer.state);
	assert.ok(settleLinkPaging(newer.state, newer.operation, ok(firstPage(newer.operation.request))).page);

	const forbidden = settleLinkPaging(find.state, find.operation, fail(Object.assign(new Error("Forbidden"), { name: "ApiResponseError", status: 403 })));
	assert.deepEqual(forbidden.pageFailure, { aborted: false, status: 403 });
	assert.equal(forbidden.page, null);
	const aborted = settleLinkPaging(find.state, find.operation, fail(Object.assign(new Error("aborted"), { name: "AbortError" })));
	assert.deepEqual(aborted.pageFailure, { aborted: true, status: null });
	const stale = settleLinkPaging(find.state, find.operation, ok({ kind: "stale", reason: "source-version-changed" }));
	assert.deepEqual(stale.pageOutcome, { kind: "stale", reason: "source-version-changed" });
	assert.equal(stale.page, null);
	const mismatched = settleLinkPaging(find.state, find.operation, ok(parseLinkFindResult(pageWire(ownerFor({ ...find.operation.request, generation: 99 }, null), id(25), id(3)), find.operation.request)));
	assert.deepEqual(mismatched.pageOutcome, { kind: "unusable", reason: "owner-mismatch" });
	assert.equal(mismatched.page, null, "A mismatched answer never becomes suggestions");

	// Next continues from the receipt and keeps its window; a failed Next ends paging without refetching.
	const next = started(beginLinkNext(paged), "next");
	assert.deepEqual(next.operation.request, { generation: paged.page?.receipt?.generation, receipt: paged.page?.receipt });
	const second = settleLinkPaging(next.state, next.operation, ok(secondPage(next.operation.request)));
	assert.equal(second.page?.response.owner.scope.afterId, id(25));
	assert.equal(second.page?.receipt?.scope.upperId, id(60));
	const failedNext = settleLinkPaging(next.state, next.operation, ok({ kind: "unusable", reason: "receipt-invalid" }));
	assert.equal(failedNext.page?.response, paged.page?.response);
	assert.equal(failedNext.page?.receipt, null);
	assert.equal(beginLinkNext(failedNext).operation, null, "Nothing pages onward after a failed Next");
	const scopeChanged = updateLinkSessionContext(next.state, context({ destination: { collection: "pages", taxonomy: null } }));
	assert.equal(settleLinkPaging(scopeChanged, next.operation, ok(secondPage(next.operation.request))), scopeChanged);
	groups.push("Find and Next ownership, stale success and stale error");
}

// ---------------------------------------------------------------------------
// Issued Find and Next requests are detached and frozen at every level

{
	const terms = updateLinkSessionContext(createLinkSession(), context({ destination: { collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["t-water", "t-soil"] } } }));
	const find = started(beginLinkFind(terms), "find");
	const sent = structuredClone(find.operation.request);
	deeplyFrozen(find.operation.request, "find.request");
	assert.throws(() => { (find.operation.request.source as { sourceVersion: string }).sourceVersion = "v9"; }, TypeError);
	assert.throws(() => { (find.operation.request.destination as { collection: string }).collection = "pages"; }, TypeError);
	assert.throws(() => { (find.operation.request.destination.taxonomy?.termIds as string[]).push("t-late"); }, TypeError);
	assert.throws(() => { (find.operation.request as { generation: number }).generation = 99; }, TypeError);
	// The session context it was built from stays separate.
	const contextTerms = terms.context?.destination?.taxonomy?.termIds as string[];
	assert.notEqual(find.operation.request.destination.taxonomy?.termIds, contextTerms);
	contextTerms.push("t-late");
	assert.deepEqual(find.operation.request, sent, "Changing the session context never changes an issued Find");
	assert.equal(settleLinkPaging(find.state, find.operation, ok(firstPage(find.operation.request))).page?.receipt?.afterId, id(25));

	// Next never shares the receipt object the current page holds.
	const paged = withPage();
	assert.ok(paged.page?.receipt);
	const held: LinkPageReceipt = structuredClone(paged.page.receipt);
	const mutable: LinkSessionState = { ...paged, page: { response: paged.page.response, receipt: held } };
	const next = started(beginLinkNext(mutable), "next");
	const issuedNext = structuredClone(next.operation.request);
	assert.notEqual(next.operation.request.receipt, held, "The issued receipt is a copy");
	deeplyFrozen(next.operation.request, "next.request");
	assert.throws(() => { (next.operation.request.receipt as { afterId: string }).afterId = id(26); }, TypeError);
	assert.throws(() => { (next.operation.request.receipt.scope as { upperId: string }).upperId = id(70); }, TypeError);
	assert.throws(() => { (next.operation.request.receipt.scope.termIds as string[]).push("t-late"); }, TypeError);
	assert.throws(() => { (next.operation.request.receipt.source as { sourceVersion: string }).sourceVersion = "v9"; }, TypeError);
	assert.throws(() => { (next.operation.request as { generation: number }).generation = 9; }, TypeError);
	held.afterId = id(26);
	held.scope.upperId = id(70);
	held.source.sourceVersion = "v9";
	assert.deepEqual(next.operation.request, issuedNext, "Changing the held receipt never changes an issued Next");
	const second = settleLinkPaging(next.state, next.operation, ok(secondPage(next.operation.request)));
	assert.equal(second.page?.response.owner.scope.afterId, id(25), "The answer is checked against the receipt as issued");
	assert.notEqual(started(beginLinkNext(mutable), "again").operation.request.receipt, next.operation.request.receipt, "Each Next issues its own receipt copy");
	groups.push("issued request immutability");
}

// ---------------------------------------------------------------------------
// Choose and Verify: immutable submission, exact verified URL, no stale eligibility

{
	const page = withPage();
	assert.equal(chooseLinkSuggestion(page, id(99)), page, "Only a suggestion of the current page can be chosen");
	const chosen = chooseLinkSuggestion(page, id(3));
	assert.ok(chosen.chosen && Object.isFrozen(chosen.chosen.request.suggestion.target));
	(page.page?.response.suggestions[0].target as { title: string }).title = "Changed after choosing";
	assert.equal(chosen.chosen.request.suggestion.target.title, "Drip irrigation", "The chosen request is a clone");

	const verify = started(beginLinkVerify(chosen), "verify");
	const differing = "http://example.com/guides/drip-irrigation?ref=editor#paragraph";
	const verified = settleLinkVerify(verify.state, verify.operation, ok(verifiedAt(verify.operation.submission, differing)));
	assert.equal(verified.verified?.url, differing, "The returned verified URL is what Copy will use");

	const mismatch = parseLinkVerifyResult({
		kind: "verification", ownerKey: verify.operation.submission.ownerKey, target: { collection: "guides", entryId: id(4) },
		verification: { kind: "verified", url: SITE + "/guides/drip-irrigation", route: "/guides/drip-irrigation" },
	}, verify.operation.submission);
	assert.deepEqual(mismatch, { kind: "unusable", reason: "target-mismatch" });
	const refused = settleLinkVerify(verify.state, verify.operation, ok(mismatch));
	assert.equal(refused.verified, null, "A target mismatch grants no copy eligibility");
	assert.deepEqual(refused.verdict, mismatch);
	const staleVerdict = settleLinkVerify(verify.state, verify.operation, ok(parseLinkVerifyResult({
		kind: "verification", ownerKey: verify.operation.submission.ownerKey, target: { ...verify.operation.submission.target },
		verification: { kind: "stale", reasons: ["policy-changed"] },
	}, verify.operation.submission)));
	assert.equal(staleVerdict.verified, null);
	const unauthorized = settleLinkVerify(verify.state, verify.operation, fail(Object.assign(new Error("Unauthorized"), { status: 401 })));
	assert.deepEqual(unauthorized.verifyFailure, { aborted: false, status: 401 });
	assert.equal(unauthorized.verified, null);

	const savedDuring = updateLinkSessionContext(verify.state, context({ savedVersion: "v2" }));
	assert.equal(savedDuring.chosen, null);
	assert.equal(settleLinkVerify(savedDuring, verify.operation, ok(verifiedAt(verify.operation.submission, differing))), savedDuring);
	assert.equal(settleLinkVerify(savedDuring, verify.operation, fail(new Error("late"))), savedDuring);
	const rechosen = chooseLinkSuggestion(verify.state, id(3));
	assert.equal(settleLinkVerify(rechosen, verify.operation, ok(verifiedAt(verify.operation.submission, differing))), rechosen,
		"A Verify for an earlier choice is discarded");
	assert.equal(chooseLinkSuggestion(verified, id(3)).verified, null, "Choosing again clears copy eligibility");
	groups.push("Verify eligibility and target mismatch");
}

// ---------------------------------------------------------------------------
// Copy: explicit, serialized, immutable while issued

{
	assert.equal(beginLinkCopy(withPage()).operation, null, "Copy needs a verified URL");
	const verified = withVerified("http://example.com/guides/drip-irrigation#top");
	const copy = started(beginLinkCopy(verified), "copy");
	assert.equal(copy.operation.url, "http://example.com/guides/drip-irrigation#top");
	assert.equal(beginLinkCopy(copy.state).operation, null, "Only one Copy at a time");

	const failed = settleLinkCopy(copy.state, copy.operation, false);
	assert.equal(failed.copied, null, "A clipboard failure records no receipt");
	assert.equal(failed.copyFailed, true);
	const copied = settleLinkCopy(copy.state, copy.operation, true);
	assert.deepEqual({ id: copied.copied?.id, url: copied.copied?.url, submission: copied.copied?.submission }, { id: copy.operation.id, url: copy.operation.url, submission: copy.operation.submission });

	// A save while the clipboard write is pending: candidates stay cleared, but the issued Copy may still record its receipt.
	const savedDuring = updateLinkSessionContext(copy.state, context({ savedVersion: "v2" }));
	assert.equal(savedDuring.page, null);
	assert.equal(savedDuring.verified, null);
	const afterSave = settleLinkCopy(savedDuring, copy.operation, true);
	assert.equal(afterSave.copied?.url, copy.operation.url);
	assert.equal(afterSave.copied?.submission, copy.operation.submission);
	assert.equal(afterSave.page, null, "Old suggestions are not restored");
	assert.equal(afterSave.verified, null, "Copy eligibility is not restored");
	assert.equal(beginLinkCopy(afterSave).operation, null);

	// A scope or identity change while it is pending discards the late result.
	const scopeChanged = updateLinkSessionContext(copy.state, context({ destination: { collection: "pages", taxonomy: null } }));
	assert.equal(settleLinkCopy(scopeChanged, copy.operation, true), scopeChanged);
	assert.equal(scopeChanged.copied, null);
	const entryChanged = updateLinkSessionContext(copy.state, context({ entryId: "01KSOURCE00000000000000002" }));
	assert.equal(settleLinkCopy(entryChanged, copy.operation, true), entryChanged);

	// The copied receipt survives later saves in the same scope and nothing else.
	const resaved = updateLinkSessionContext(copied, context({ savedVersion: "v3" }));
	assert.equal(resaved.copied, copied.copied);
	assert.equal(updateLinkSessionContext(copied, context({ locale: "fr" })).copied, null);
	groups.push("Copy serialization, failure, save and scope change");
}

// ---------------------------------------------------------------------------
// Check: the copied request, guarded by receipt, epoch, operation and saved version

{
	assert.equal(beginLinkCheck(withVerified()).operation, null, "Check needs a copied receipt");
	const copy = started(beginLinkCopy(withVerified()), "copy");
	const copied = updateLinkSessionContext(settleLinkCopy(copy.state, copy.operation, true), context({ savedVersion: "v2" }));
	const check = started(beginLinkCheck(copied), "check");
	assert.equal(check.operation.submission, copy.operation.submission, "Check sends the original copied request");
	assert.equal(check.operation.receiptId, copied.copied?.id);
	assert.equal(check.operation.savedVersion, "v2");

	const linked = checkedAs(check.operation.submission, { kind: "verified" });
	const recorded = settleLinkCheck(check.state, check.operation, ok(linked));
	assert.deepEqual(recorded.checked, { receiptId: check.operation.receiptId, outcome: linked });
	assert.deepEqual(Object.keys(recorded.checked ?? {}).sort(), ["outcome", "receiptId"], "No examined version is claimed");

	const savedDuring = updateLinkSessionContext(check.state, context({ savedVersion: "v3" }));
	assert.equal(settleLinkCheck(savedDuring, check.operation, ok(linked)), savedDuring, "A save during Check discards its answer");
	assert.equal(settleLinkCheck(savedDuring, check.operation, fail(new Error("late"))), savedDuring);
	assert.equal(savedDuring.copied, copied.copied);
	const scopeChanged = updateLinkSessionContext(check.state, context({ destination: { collection: "pages", taxonomy: null } }));
	assert.equal(settleLinkCheck(scopeChanged, check.operation, ok(linked)), scopeChanged);
	const recheck = started(beginLinkCheck(check.state), "recheck");
	assert.equal(settleLinkCheck(recheck.state, check.operation, ok(linked)), recheck.state, "An older Check is superseded");
	const failure = settleLinkCheck(check.state, check.operation, fail(Object.assign(new Error("Forbidden"), { status: 403 })));
	assert.deepEqual(failure.checkFailure, { aborted: false, status: 403 });
	assert.equal(failure.checked, null);
	groups.push("Check guards and no version claim");
}

{
	const paged = withPage();
	assert.ok(paged.page);
	const counts = "This page examined 25 destination rows; 1 matched the selected scope.";
	assert.equal(isLinkPageReferenceOnly(paged), false);
	assert.equal(linkPageSummaryText(paged.page.response.page, isLinkPageReferenceOnly(paged)), counts + " More entries remain in this search; Next page continues it.");

	const next = started(beginLinkNext(paged), "next");
	const denied = settleLinkPaging(next.state, next.operation, fail(Object.assign(new Error("Forbidden"), { name: "ApiResponseError", status: 403 })));
	assert.equal(denied.page?.response, paged.page.response, "A failed Next keeps the page it started from");
	assert.ok(denied.page?.receipt, "A transport failure keeps the receipt");
	const refused = settleLinkPaging(next.state, next.operation, ok({ kind: "stale", reason: "scope-changed" }));
	assert.equal(refused.page?.response, paged.page.response);
	assert.equal(refused.page?.receipt, null);
	for (const [label, state] of [["failed", denied], ["refused", refused]] as const) {
		assert.equal(isLinkPageReferenceOnly(state), true, label);
		assert.ok(state.page);
		assert.equal(
			linkPageSummaryText(state.page.response.page, isLinkPageReferenceOnly(state)),
			counts + " This search cannot continue from this page. Run Find link suggestions again to start a fresh search from the first page.",
			label + " Next keeps the counts, requires a fresh Find and promises no Next",
		);
	}

	const second = settleLinkPaging(next.state, next.operation, ok(secondPage(next.operation.request)));
	assert.equal(isLinkPageReferenceOnly(second), false);
	assert.ok(second.page);
	assert.equal(linkPageSummaryText(second.page.response.page, isLinkPageReferenceOnly(second)), counts + " More entries remain in this search; Next page continues it.");
	const refind = started(beginLinkFind(denied), "refind");
	assert.equal(isLinkPageReferenceOnly(settleLinkPaging(refind.state, refind.operation, ok(firstPage(refind.operation.request)))), false,
		"Only a fresh Find makes a reference-only page usable again");
	groups.push("reference-only pages after a failed or refused Next");
}

{
	const page = withTwoSuggestions();
	const verifiedA = verifyChosen(chooseLinkSuggestion(page, id(3)));
	const copyA = started(beginLinkCopy(verifiedA), "copy A");
	const failedA = settleLinkCopy(copyA.state, copyA.operation, false);
	assert.equal(failedA.copyFailed, true);
	assert.equal(chooseLinkSuggestion(failedA, id(99)), failedA, "An invalid choice changes nothing, the Copy failure included");

	const chosenB = chooseLinkSuggestion(failedA, id(4));
	assert.equal(chosenB.chosen?.target.entryId, id(4));
	assert.equal(chosenB.copyFailed, false, "A new choice does not inherit the failure of an earlier Copy");
	assert.equal(chosenB.copied, null, "No receipt exists for a Copy that failed");
	const verifiedB = verifyChosen(chosenB);
	assert.equal(verifiedB.verified?.url, SITE + "/guides/raised-beds");
	assert.equal(verifiedB.copyFailed, false);
	assert.equal(verifiedB.copied, null);

	const refind = started(beginLinkFind(failedA), "refind");
	assert.equal(refind.state.copyFailed, true, "Starting a Find leaves the failure");
	assert.equal(settleLinkPaging(refind.state, refind.operation, fail(Object.assign(new Error("Unavailable"), { status: 503 }))).copyFailed, true,
		"A failed Find leaves the failure");
	const refound = settleLinkPaging(refind.state, refind.operation, ok(firstPage(refind.operation.request)));
	assert.equal(refound.copyFailed, false, "A fresh Find page ends the failure");
	assert.equal(refound.copied, null);

	// An issued Copy keeps its ownership through a new choice and a fresh Find.
	const pending = started(beginLinkCopy(verifiedA), "pending copy");
	const choseDuring = chooseLinkSuggestion(pending.state, id(4));
	assert.equal(choseDuring.copying, pending.operation);
	const landed = settleLinkCopy(choseDuring, pending.operation, true);
	assert.equal(landed.copied?.url, SITE + "/guides/drip-irrigation", "The receipt is the URL the issued Copy wrote");
	assert.equal(landed.copied?.submission, pending.operation.submission);
	assert.equal(landed.chosen?.target.entryId, id(4), "The receipt does not restore the earlier choice");
	const findDuring = started(beginLinkFind(pending.state), "find during copy");
	const foundDuring = settleLinkPaging(findDuring.state, findDuring.operation, ok(firstPage(findDuring.operation.request)));
	assert.equal(foundDuring.copying, pending.operation);
	assert.equal(settleLinkCopy(foundDuring, pending.operation, true).copied?.url, pending.operation.url);

	// A receipt the owner already copied is independent of a later failed Copy.
	const copyB = started(beginLinkCopy(verifyChosen(landed)), "copy B");
	const failedB = settleLinkCopy(copyB.state, copyB.operation, false);
	assert.equal(failedB.copyFailed, true);
	assert.equal(failedB.copied, landed.copied);
	const rechosen = chooseLinkSuggestion(failedB, id(3));
	assert.equal(rechosen.copyFailed, false);
	assert.equal(rechosen.copied, landed.copied);
	const again = started(beginLinkFind(failedB), "find again");
	const refreshed = settleLinkPaging(again.state, again.operation, ok(firstPage(again.operation.request)));
	assert.equal(refreshed.copyFailed, false);
	assert.equal(refreshed.copied, landed.copied);
	groups.push("Copy failure ends with a new choice or a fresh Find");
}

console.log("Internal link suggestions model selfcheck passed: " + groups.length + " groups");
