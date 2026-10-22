import assert from "node:assert/strict";

import { SEO_ENGINE_PLUGIN_ID } from "../admin-contract.ts";
import {
	LINK_PARTIAL_COVERAGE_LIMITATION,
	finalizeLinkSuggestions,
	linkSuggestionOwnerKey,
	rankLinkSuggestions,
	type LinkSuggestionOwner,
} from "../internal-link-suggestions.ts";
import {
	LINK_PAGE_RECEIPT_MAX_BYTES,
	LINK_RESULT_MAX_BYTES,
	createLinkSuggestionApi,
	linkApiUrl,
	linkResultWithinBytes,
	loadAdminLinkApiClient,
	parseLinkCheckResult,
	parseLinkFindResult,
	parseLinkNextResult,
	parseLinkVerifyResult,
	prepareLinkSubmission,
	type LinkApiClient,
	type LinkSubmission,
} from "./internal-link-api.ts";

// ---------------------------------------------------------------------------
// Wire fixtures from the real pure engine

const SITE = "https://example.com";
const SOURCE_ID = "01KSOURCE00000000000000001";
const id = (index: number) => "01KG" + String(index).padStart(22, "0");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const P1 = "Our notes on drip irrigation explain spacing for raised beds.";
const BODY = [{ _type: "block", _key: "p1", style: "normal", markDefs: [], children: [{ _type: "span", _key: "p1-s", text: P1, marks: [] }] }];

function ownerOf(afterId: string | null, scope: Partial<LinkSuggestionOwner["scope"]> = {}, generation = 4): LinkSuggestionOwner {
	return {
		source: { collection: "posts", entryId: SOURCE_ID, locale: "en", sourceVersion: "v1", revisionId: null, field: "content" },
		scope: { collection: "guides", locale: "en", taxonomy: null, termIds: [], afterId, scopeVersion: "scope-1", ...scope },
		generation,
	};
}

function responseFor(
	owner: LinkSuggestionOwner,
	page: { nextAfterId: string | null; exhausted: boolean },
	candidateId = id(3),
	options: { body?: unknown[]; publicUrl?: string } = {},
): any {
	const publicUrl = options.publicUrl ?? SITE + "/guides/drip-irrigation";
	const candidate = { collection: owner.scope.collection, entryId: candidateId, locale: owner.scope.locale, version: "entry-v1:1:2026-10-04 12:00:00", title: "Drip irrigation", excerpt: null, afterId: candidateId };
	const ranked = rankLinkSuggestions({ owner, source: { ...owner.source, body: options.body ?? BODY, siteUrl: SITE, routeUrl: null }, page: { candidates: [candidate], examinedRows: 25, ...page } });
	if (ranked.kind !== "ranked") throw new Error("Fixture ranking refused: " + ranked.reason);
	const outcome = finalizeLinkSuggestions(ranked, ranked.provisional.map((item) => ({
		collection: item.candidate.collection,
		entryId: item.candidate.entryId,
		read: {
			kind: "found",
			target: {
				collection: item.candidate.collection, entryId: item.candidate.entryId, locale: item.candidate.locale, status: "published",
				version: item.candidate.version, title: item.candidate.title, publicUrl,
				inScope: true, noindex: false, globalPolicyVersion: "policy-1", targetPolicyVersion: "target-policy-1",
			},
		},
	})), { kind: "readable", version: "policy-1" });
	if (outcome.kind !== "result") throw new Error("Fixture finalize refused: " + outcome.reason);
	assert.equal(outcome.response.suggestions.length, 1, "The fixture must carry one suggestion");
	return outcome.response;
}

/** Holds a promise open until released, to change caller objects while a command waits. */
function gate() {
	let release: () => void = () => {};
	const opened = new Promise<void>((resolve) => { release = resolve; });
	return { opened, release: () => release() };
}

function receiptFor(owner: LinkSuggestionOwner, afterId: string, upperId = id(60)): any {
	return {
		format: "link-page-v1",
		source: { ...owner.source },
		generation: owner.generation,
		scope: { collection: owner.scope.collection, locale: owner.scope.locale, taxonomy: owner.scope.taxonomy, termIds: [...owner.scope.termIds], scopeVersion: owner.scope.scopeVersion, upperId },
		afterId,
	};
}

const findRequest = (patch: Record<string, unknown> = {}): any => ({
	source: { collection: "posts", entryId: SOURCE_ID, locale: "en", sourceVersion: "v1" },
	generation: 4,
	destination: { collection: "guides", taxonomy: null },
	...patch,
});
const firstResult = (): any => {
	const owner = ownerOf(null);
	return { kind: "result", response: responseFor(owner, { nextAfterId: id(25), exhausted: false }), next: receiptFor(owner, id(25)) };
};
const nextRequest = (): any => ({ generation: 4, receipt: receiptFor(ownerOf(null), id(25)) });
const secondResult = (page = { nextAfterId: id(50) as string | null, exhausted: false }, upperId = id(60)): any => {
	const owner = ownerOf(id(25));
	return { kind: "result", response: responseFor(owner, page, id(30)), next: page.exhausted ? null : receiptFor(owner, page.nextAfterId as string, upperId) };
};
const edit = (value: unknown, change: (copy: any) => void): any => {
	const copy = structuredClone(value);
	change(copy);
	return copy;
};

// ---------------------------------------------------------------------------
// An injected admin client that behaves like the published one

const realFetch = globalThis.fetch;
let rawFetches = 0;
globalThis.fetch = (async () => {
	rawFetches += 1;
	throw new Error("Raw fetch must not be used");
}) as typeof fetch;

function ok(data: unknown): Response {
	return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function failed(status: number, code: string): Response {
	return new Response(JSON.stringify({ success: false, error: { code, message: code } }), { status, headers: { "Content-Type": "application/json" } });
}

function injected(respond: (input: string, init: RequestInit | undefined) => Response | Promise<Response>) {
	const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
	const parses: string[] = [];
	let loads = 0;
	const client: LinkApiClient = {
		async apiFetch(input, init) {
			calls.push({ input, init });
			return respond(input, init);
		},
		async parseApiResponse<T>(response: Response, fallback?: string): Promise<T> {
			parses.push(String(fallback));
			if (!response.ok) {
				const body = await response.json() as { error?: { code?: string; message?: string } };
				throw Object.assign(new Error(body.error?.message ?? String(fallback)), { name: "ApiResponseError", status: response.status, code: body.error?.code });
			}
			return (await response.json() as { data: T }).data;
		},
	};
	return { calls, parses, loads: () => loads, api: createLinkSuggestionApi(async () => { loads += 1; return client; }) };
}

const groups: string[] = [];

// ---------------------------------------------------------------------------
// Exact routes, JSON bodies, signals, cancellation and HTTP failures

{
	assert.equal(SEO_ENGINE_PLUGIN_ID, "shipit-seo");
	assert.equal(linkApiUrl("find"), "/_emdash/api/plugins/shipit-seo/find-link-suggestions");
	assert.equal(linkApiUrl("next"), "/_emdash/api/plugins/shipit-seo/next-link-suggestions");
	assert.equal(linkApiUrl("verify"), "/_emdash/api/plugins/shipit-seo/verify-link-suggestion");
	assert.equal(linkApiUrl("checkSaved"), "/_emdash/api/plugins/shipit-seo/check-saved-link");
	assert.equal(typeof loadAdminLinkApiClient, "function");

	const first = firstResult();
	const submission = prepareLinkSubmission({ owner: first.response.owner, policyVersion: first.response.policyVersion, suggestion: first.response.suggestions[0] }) as LinkSubmission;
	const replies: Record<string, unknown> = {
		[linkApiUrl("find")]: first,
		[linkApiUrl("next")]: secondResult(),
		[linkApiUrl("verify")]: { kind: "verification", ownerKey: submission.ownerKey, target: submission.target, verification: { kind: "verified", url: SITE + "/guides/drip-irrigation", route: "/guides/drip-irrigation" } },
		[linkApiUrl("checkSaved")]: { kind: "saved-check", ownerKey: submission.ownerKey, target: submission.target, check: { kind: "verified" } },
	};
	const { calls, parses, loads, api } = injected((input) => ok(replies[input]));
	assert.equal(loads(), 0, "The client is loaded only when a command is sent");
	const signal = new AbortController().signal;
	const request = findRequest();
	assert.equal((await api.find(request, signal)).kind, "result");
	assert.equal((await api.next(nextRequest(), signal)).kind, "result");
	assert.equal((await api.verify(submission, signal)).kind, "verification");
	assert.equal((await api.checkSaved(submission)).kind, "saved-check");
	assert.deepEqual(calls.map((call) => call.input), [linkApiUrl("find"), linkApiUrl("next"), linkApiUrl("verify"), linkApiUrl("checkSaved")]);
	for (const call of calls) {
		assert.equal(call.init?.method, "POST");
		assert.deepEqual(call.init?.headers, { "Content-Type": "application/json" });
	}
	assert.deepEqual(JSON.parse(String(calls[0].init?.body)), request);
	assert.deepEqual(JSON.parse(String(calls[1].init?.body)), nextRequest());
	assert.deepEqual(JSON.parse(String(calls[2].init?.body)), JSON.parse(JSON.stringify(submission.request)));
	assert.deepEqual(JSON.parse(String(calls[3].init?.body)), JSON.parse(JSON.stringify(submission.request)));
	assert.equal(calls[0].init?.signal, signal, "The caller's signal reaches the admin fetch");
	assert.equal(calls[3].init?.signal, undefined);
	assert.equal(parses.length, 4, "Every response goes through the admin envelope parser");
	assert.equal(loads(), 4);

	// An abort and HTTP failures surface unchanged, with one request and no retry.
	const aborting = injected((_input, init) => {
		if (init?.signal?.aborted) throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
		return ok(first);
	});
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(() => aborting.api.find(request, controller.signal), (error: unknown) => (error as Error).name === "AbortError");
	assert.equal(aborting.calls.length, 1);
	assert.equal(aborting.parses.length, 0);
	for (const [status, code] of [[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [413, "PAYLOAD_TOO_LARGE"], [500, "INTERNAL_ERROR"]] as const) {
		const failing = injected(() => failed(status, code));
		await assert.rejects(() => failing.api.verify(submission), (error: unknown) => (error as { status?: number }).status === status && (error as Error).name === "ApiResponseError");
		assert.equal(failing.calls.length, 1, "HTTP " + status + " is not retried");
	}
	const refusing = injected(() => ok(secondResult()));
	for (const unusable of [
		{ generation: 4, receipt: edit(nextRequest().receipt, (receipt) => { receipt.afterId = id(60); }) },
		{ generation: 4, receipt: edit(nextRequest().receipt, (receipt) => { receipt.afterId = null; }) },
		{ generation: 5, receipt: nextRequest().receipt },
		{ ...nextRequest(), extra: true },
	]) assert.deepEqual(await refusing.api.next(unusable as never), { kind: "unusable", reason: "request-invalid" }, JSON.stringify(unusable).slice(0, 80));
	assert.deepEqual(await refusing.api.verify({ ...submission, ownerKey: "another owner" }), { kind: "unusable", reason: "request-invalid" });
	assert.deepEqual(await refusing.api.checkSaved({ ...submission, target: { collection: "guides", entryId: id(4) } }), { kind: "unusable", reason: "request-invalid" });
	assert.equal(refusing.calls.length, 0, "An unusable request is never sent");
	assert.equal(rawFetches, 0);
	groups.push("transport");
}

// ---------------------------------------------------------------------------
// Each method captures its body and expected ownership before any await

{
	const first = firstResult();
	const submission = prepareLinkSubmission({ owner: first.response.owner, policyVersion: first.response.policyVersion, suggestion: first.response.suggestions[0] }) as LinkSubmission;
	const replies: Record<string, unknown> = {
		[linkApiUrl("find")]: first,
		[linkApiUrl("next")]: secondResult(),
		[linkApiUrl("verify")]: { kind: "verification", ownerKey: submission.ownerKey, target: submission.target, verification: { kind: "verified", url: SITE + "/guides/drip-irrigation", route: "/guides/drip-irrigation" } },
		[linkApiUrl("checkSaved")]: { kind: "saved-check", ownerKey: submission.ownerKey, target: submission.target, check: { kind: "unlinked" } },
	};

	// The client loader is still pending while the caller changes every object it passed.
	const loading = gate();
	const calls: Array<{ input: string; body: string }> = [];
	const client: LinkApiClient = {
		async apiFetch(input, init) {
			calls.push({ input, body: String(init?.body) });
			return ok(replies[input]);
		},
		async parseApiResponse<T>(response: Response): Promise<T> {
			return (await response.json() as { data: T }).data;
		},
	};
	const api = createLinkSuggestionApi(async () => {
		await loading.opened;
		return client;
	});
	const find = findRequest();
	const next = nextRequest();
	const mutable = (): any => ({ request: structuredClone(submission.request), ownerKey: submission.ownerKey, target: { ...submission.target } });
	const verifying = mutable();
	const checking = mutable();
	const pending = [api.find(find), api.next(next), api.verify(verifying), api.checkSaved(checking)];
	find.source.sourceVersion = "v9";
	find.generation = 99;
	find.destination.collection = "pages";
	next.generation = 9;
	next.receipt.afterId = id(26);
	next.receipt.scope.upperId = id(70);
	for (const changed of [verifying, checking]) {
		changed.request.suggestion.target.route = "/guides/other";
		changed.request.owner.source.sourceVersion = "v9";
		changed.ownerKey = "changed";
		changed.target.entryId = id(4);
	}
	loading.release();
	const [found, paged, verified, checked] = await Promise.all(pending);
	assert.equal(found.kind, "result", "Find is checked against the request as it was sent");
	assert.equal(paged.kind, "result", "Next is checked against the receipt as it was sent");
	assert.equal(verified.kind === "verification" && verified.verification.kind, "verified", "Verify is checked against the submission as it was sent");
	assert.equal(checked.kind, "saved-check");
	const sent = (command: "find" | "next" | "verify" | "checkSaved") => JSON.parse(String(calls.find((call) => call.input === linkApiUrl(command))?.body));
	assert.equal(calls.length, 4);
	assert.deepEqual(sent("find"), findRequest());
	assert.deepEqual(sent("next"), nextRequest());
	assert.deepEqual(sent("verify"), JSON.parse(JSON.stringify(submission.request)));
	assert.deepEqual(sent("checkSaved"), JSON.parse(JSON.stringify(submission.request)));

	// The same holds while the fetch itself is pending.
	const fetching = gate();
	const slow = createLinkSuggestionApi(async () => ({
		async apiFetch() {
			await fetching.opened;
			return ok(first);
		},
		async parseApiResponse<T>(response: Response): Promise<T> {
			return (await response.json() as { data: T }).data;
		},
	}));
	const request = findRequest();
	const answer = slow.find(request);
	request.source.sourceVersion = "v9";
	request.destination.taxonomy = { taxonomy: "topics", termIds: ["t-water"] };
	fetching.release();
	assert.equal((await answer).kind, "result");
	groups.push("synchronous capture");
}

// ---------------------------------------------------------------------------
// First Find: captured ownership, learned server observations

{
	const result = firstResult();
	const outcome = parseLinkFindResult(result, findRequest());
	if (outcome.kind !== "result") throw new Error("First Find: " + JSON.stringify(outcome));
	assert.equal(outcome.response.owner.source.field, "content", "The field is learned from the response");
	assert.equal(outcome.response.owner.source.revisionId, null);
	assert.equal(outcome.response.owner.scope.scopeVersion, "scope-1", "The scope version is learned from the response");
	assert.deepEqual(outcome.next, result.next);
	assert.notEqual(outcome.response, result.response, "The accepted page is detached from the wire object");

	for (const [label, request] of [
		["saved version", findRequest({ source: { ...findRequest().source, sourceVersion: "v2" } })],
		["locale", findRequest({ source: { ...findRequest().source, locale: "en-GB" } })],
		["non-canonical locale", findRequest({ source: { ...findRequest().source, locale: "EN" } })],
		["entry", findRequest({ source: { ...findRequest().source, entryId: "01KSOURCE00000000000000002" } })],
		["source collection", findRequest({ source: { ...findRequest().source, collection: "pages" } })],
		["generation", findRequest({ generation: 5 })],
		["destination", findRequest({ destination: { collection: "pages", taxonomy: null } })],
		["taxonomy", findRequest({ destination: { collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["t-water"] } } })],
	] as const) assert.deepEqual(parseLinkFindResult(result, request), { kind: "unusable", reason: "owner-mismatch" }, label);
	const cursorOwner = ownerOf(id(10));
	assert.deepEqual(parseLinkFindResult({ kind: "result", response: responseFor(cursorOwner, { nextAfterId: id(25), exhausted: false }), next: receiptFor(cursorOwner, id(25)) }, findRequest()),
		{ kind: "unusable", reason: "owner-mismatch" }, "A first page has no cursor");

	// Terms compare sorted and unique; the request may list them in any order.
	const tagged = ownerOf(null, { taxonomy: "topics", termIds: ["t-soil", "t-water"] });
	const taggedResult = { kind: "result", response: responseFor(tagged, { nextAfterId: null, exhausted: true }), next: null };
	const taggedRequest = findRequest({ destination: { collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["t-water", "t-soil"] } } });
	assert.equal(parseLinkFindResult(taggedResult, taggedRequest).kind, "result");
	assert.deepEqual(parseLinkFindResult(taggedResult, findRequest({ destination: { collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["t-water"] } } })),
		{ kind: "unusable", reason: "owner-mismatch" });
	groups.push("first Find ownership");
}

// ---------------------------------------------------------------------------
// Exact envelopes, known reasons, byte bounds and receipts

{
	const request = findRequest();
	const malformed = { kind: "unusable", reason: "malformed" };
	for (const [label, value] of [
		["extra envelope key", { ...firstResult(), extra: true }],
		["extra response key", edit(firstResult(), (copy) => { copy.response.extra = true; })],
		["extra page key", edit(firstResult(), (copy) => { copy.response.page.extra = true; })],
		["extra owner key", edit(firstResult(), (copy) => { copy.response.owner.source.extra = true; })],
		["extra anchor key", edit(firstResult(), (copy) => { copy.response.suggestions[0].anchor.extra = true; })],
		["extra occurrence key", edit(firstResult(), (copy) => { copy.response.suggestions[0].anchor.occurrence.extra = true; })],
		["changed notice", edit(firstResult(), (copy) => { copy.response.notice = "Suggestions use saved content."; })],
		["inconsistent route", edit(firstResult(), (copy) => { copy.response.suggestions[0].target.route = "/guides/other"; })],
		["unknown kind", { kind: "page", reason: "x" }],
		["unknown reason", { kind: "stale", reason: "target-changed" }],
		["failure with extra key", { kind: "invalid", reason: "request", detail: "x" }],
		["not an object", "result"],
		["null", null],
	] as const) assert.deepEqual(parseLinkFindResult(value, request), malformed, label);
	for (const failure of [
		{ kind: "invalid", reason: "collection-unavailable" }, { kind: "stale", reason: "source-version-changed" },
		{ kind: "unavailable", reason: "adapter-absent" }, { kind: "unsupported", reason: "ambiguous-body-field" },
		{ kind: "refused", reason: "response_too_large" }, { kind: "refused", reason: "source_route_unavailable" },
	]) assert.deepEqual(parseLinkFindResult(failure, request), failure, failure.reason);

	// The whole payload, receipt included, is bounded before anything else.
	assert.ok(linkResultWithinBytes("é".repeat(24_563)), "24,563 two-byte characters and two quotes are 49,128 bytes");
	assert.ok(!linkResultWithinBytes("é".repeat(24_563) + "a"));
	assert.equal(LINK_RESULT_MAX_BYTES, 49_128);
	assert.deepEqual(parseLinkFindResult({ ...firstResult(), pad: "é".repeat(25_000) }, request), { kind: "unusable", reason: "oversized" });

	const receiptInvalid = { kind: "unusable", reason: "receipt-invalid" };
	for (const [label, value] of [
		["receipt on an exhausted page", edit(firstResult(), (copy) => { copy.response.page.exhausted = true; copy.response.page.nextAfterId = null; })],
		["no receipt while pages remain", { ...firstResult(), next: null }],
		["wrong format", edit(firstResult(), (copy) => { copy.next.format = "link-page-v2"; })],
		["extra receipt key", edit(firstResult(), (copy) => { copy.next.extra = true; })],
		["extra receipt scope key", edit(firstResult(), (copy) => { copy.next.scope.extra = true; })],
		["cursor other than the page cursor", edit(firstResult(), (copy) => { copy.next.afterId = id(24); })],
		["cursor at the upper ID", edit(firstResult(), (copy) => { copy.next.scope.upperId = id(25); })],
		["receipt for another saved version", edit(firstResult(), (copy) => { copy.next.source.sourceVersion = "v2"; })],
		["receipt for another generation", edit(firstResult(), (copy) => { copy.next.generation = 5; })],
		["receipt for another scope version", edit(firstResult(), (copy) => { copy.next.scope.scopeVersion = "scope-2"; })],
		["upper ID outside identity rules", edit(firstResult(), (copy) => { copy.next.scope.upperId = " " + id(60); })],
		["oversized receipt", edit(firstResult(), (copy) => { copy.next.source.field = "f".repeat(LINK_PAGE_RECEIPT_MAX_BYTES); })],
		["null cursor", edit(firstResult(), (copy) => { copy.next.afterId = null; })],
		["numeric cursor", edit(firstResult(), (copy) => { copy.next.afterId = 25; })],
		["null upper ID", edit(firstResult(), (copy) => { copy.next.scope.upperId = null; })],
		// "-1" < null is true after numeric coercion, so only the string checks refuse this one.
		["null upper ID above a coercible cursor", edit(firstResult(), (copy) => {
			copy.response.page.nextAfterId = "-1";
			copy.next.afterId = "-1";
			copy.next.scope.upperId = null;
		})],
	] as const) assert.deepEqual(parseLinkFindResult(value, request), receiptInvalid, label);
	assert.equal(parseLinkFindResult(edit(firstResult(), (copy) => { copy.response.page.nextAfterId = "-1"; copy.next.afterId = "-1"; }), request).kind, "result",
		"The coercible cursor is a valid identity below a string upper ID");
	groups.push("envelopes, reasons, bounds and receipts");
}

// ---------------------------------------------------------------------------
// Coverage carries exactly its own keys

{
	const request = findRequest();
	const owner = ownerOf(null);
	const partial = (): any => ({
		kind: "result",
		response: responseFor(owner, { nextAfterId: id(25), exhausted: false }, id(3), { body: [...BODY, { _type: "custom-widget", _key: "w1" }] }),
		next: receiptFor(owner, id(25)),
	});
	const accepted = parseLinkFindResult(partial(), request);
	if (accepted.kind !== "result") throw new Error("Partial coverage: " + JSON.stringify(accepted));
	assert.deepEqual(accepted.response.coverage, { kind: "partial", gaps: ["unsupported-content"], limitation: LINK_PARTIAL_COVERAGE_LIMITATION });
	const complete = parseLinkFindResult(firstResult(), request);
	assert.deepEqual(complete.kind === "result" && complete.response.coverage, { kind: "complete" });
	const malformed = { kind: "unusable", reason: "malformed" };
	for (const [label, value] of [
		["extra partial coverage key", edit(partial(), (copy) => { copy.response.coverage.extra = true; })],
		["partial coverage without its limitation", edit(partial(), (copy) => { delete copy.response.coverage.limitation; })],
		["partial coverage without gaps", edit(partial(), (copy) => { delete copy.response.coverage.gaps; })],
		["extra complete coverage key", edit(firstResult(), (copy) => { copy.response.coverage.extra = true; })],
		["complete coverage with gaps", edit(firstResult(), (copy) => { copy.response.coverage.gaps = ["unsupported-content"]; })],
		["complete coverage with a limitation", edit(firstResult(), (copy) => { copy.response.coverage.limitation = LINK_PARTIAL_COVERAGE_LIMITATION; })],
	] as const) assert.deepEqual(parseLinkFindResult(value, request), malformed, label);
	groups.push("exact coverage keys");
}

// ---------------------------------------------------------------------------
// Next: the submitted receipt's owner, forward progress, original window

{
	const request = nextRequest();
	const outcome = parseLinkNextResult(secondResult(), request);
	if (outcome.kind !== "result") throw new Error("Next: " + JSON.stringify(outcome));
	assert.equal(outcome.response.owner.scope.afterId, id(25));
	assert.equal(outcome.next?.afterId, id(50));
	assert.equal(outcome.next?.scope.upperId, id(60), "The original upper window is kept");
	const last = parseLinkNextResult(secondResult({ nextAfterId: null, exhausted: true }), request);
	assert.equal(last.kind === "result" && last.next, null, "An exhausted page has no receipt");

	const mismatch = { kind: "unusable", reason: "owner-mismatch" };
	assert.deepEqual(parseLinkNextResult(firstResult(), request), mismatch, "A first-page owner does not answer Next");
	const otherGeneration = ownerOf(id(25), {}, 5);
	assert.deepEqual(parseLinkNextResult({ kind: "result", response: responseFor(otherGeneration, { nextAfterId: id(50), exhausted: false }, id(30)), next: receiptFor(otherGeneration, id(50)) }, request), mismatch);
	const otherScope = ownerOf(id(25), { scopeVersion: "scope-2" });
	assert.deepEqual(parseLinkNextResult({ kind: "result", response: responseFor(otherScope, { nextAfterId: id(50), exhausted: false }, id(30)), next: receiptFor(otherScope, id(50)) }, request), mismatch);
	assert.deepEqual(parseLinkNextResult(secondResult({ nextAfterId: id(20), exhausted: false }), request), { kind: "unusable", reason: "receipt-invalid" }, "Paging only moves forward");
	assert.deepEqual(parseLinkNextResult(secondResult({ nextAfterId: id(25), exhausted: false }), request), { kind: "unusable", reason: "receipt-invalid" });
	assert.deepEqual(parseLinkNextResult(secondResult({ nextAfterId: id(50), exhausted: false }, id(70)), request), { kind: "unusable", reason: "receipt-invalid" }, "A new upper window is refused");
	const requestInvalid = { kind: "unusable", reason: "request-invalid" };
	for (const [label, submitted] of [
		["extra receipt key", { generation: 4, receipt: edit(request.receipt, (receipt) => { receipt.extra = 1; }) }],
		["null receipt cursor", { generation: 4, receipt: edit(request.receipt, (receipt) => { receipt.afterId = null; }) }],
		["null upper ID", { generation: 4, receipt: edit(request.receipt, (receipt) => { receipt.scope.upperId = null; }) }],
		["null upper ID above a coercible cursor", { generation: 4, receipt: edit(request.receipt, (receipt) => { receipt.afterId = "-1"; receipt.scope.upperId = null; }) }],
		["outer generation newer than the receipt", { generation: 5, receipt: request.receipt }],
		["outer generation older than the receipt", { generation: 3, receipt: request.receipt }],
		["outer generation missing", { receipt: request.receipt }],
	] as const) assert.deepEqual(parseLinkNextResult(secondResult(), submitted as never), requestInvalid, label);
	groups.push("Next ownership and paging");
}

// ---------------------------------------------------------------------------
// Verify and Check: immutable submissions, exact identities, known verdicts

{
	const first = firstResult();
	const chosen = { owner: first.response.owner, policyVersion: first.response.policyVersion, suggestion: first.response.suggestions[0] };
	const submission = prepareLinkSubmission(chosen) as LinkSubmission;
	assert.ok(submission);
	chosen.suggestion.target.title = "Changed after choosing";
	assert.equal(submission.request.suggestion.target.title, "Drip irrigation", "The submission is a clone");
	assert.ok(Object.isFrozen(submission.request.suggestion.target) && Object.isFrozen(submission.request.suggestion.anchor.decorators));
	assert.equal(submission.ownerKey, linkSuggestionOwnerKey(first.response.owner));
	assert.deepEqual(submission.target, { collection: "guides", entryId: id(3) });
	assert.equal(prepareLinkSubmission({ ...chosen, extra: true }), null);
	assert.equal(prepareLinkSubmission(edit(chosen, (copy) => { copy.suggestion.anchor.extra = true; })), null);
	assert.equal(prepareLinkSubmission({ owner: chosen.owner, policyVersion: chosen.policyVersion }), null);

	const verdict = (verification: unknown, patch: Record<string, unknown> = {}) =>
		({ kind: "verification", ownerKey: submission.ownerKey, target: { ...submission.target }, verification, ...patch });
	const verified = (url: string, route = "/guides/drip-irrigation") => verdict({ kind: "verified", url, route });
	assert.deepEqual(parseLinkVerifyResult(verified(SITE + "/guides/drip-irrigation"), submission), verified(SITE + "/guides/drip-irrigation"));
	const differing = "http://example.com/guides/drip-irrigation/?ref=email#context";
	const accepted = parseLinkVerifyResult(verified(differing), submission);
	assert.equal(accepted.kind === "verification" && accepted.verification.kind === "verified" && accepted.verification.url, differing,
		"A same-host verified URL with another scheme, query or fragment is kept exactly");
	for (const [label, value] of [
		["another route", verified(SITE + "/guides/rain-barrels", "/guides/rain-barrels")],
		["another host", verified("https://other.example/guides/drip-irrigation")],
		["route disagreeing with its URL", verified(SITE + "/guides/rain-barrels")],
		["relative URL", verified("/guides/drip-irrigation")],
	] as const) assert.deepEqual(parseLinkVerifyResult(value, submission), { kind: "unusable", reason: "url-mismatch" }, label);
	assert.deepEqual(parseLinkVerifyResult(verified(SITE + "/guides/drip-irrigation", "/guides/drip-irrigation"), { ...submission, ownerKey: "other" }), { kind: "unusable", reason: "owner-mismatch" });
	assert.deepEqual(parseLinkVerifyResult(verdict({ kind: "verified", url: SITE + "/guides/drip-irrigation", route: "/guides/drip-irrigation" }, { target: { collection: "guides", entryId: id(4) } }), submission),
		{ kind: "unusable", reason: "target-mismatch" });
	assert.deepEqual(parseLinkVerifyResult(verdict({ kind: "verified", url: SITE + "/guides/drip-irrigation", route: "/guides/drip-irrigation" }, { target: { ...submission.target, extra: 1 } }), submission),
		{ kind: "unusable", reason: "target-mismatch" });
	for (const known of [
		{ kind: "stale", reasons: ["policy-changed"] }, { kind: "stale", reasons: ["source-version-changed", "target-changed"], target: "target-changed" },
		{ kind: "unavailable", reason: "policy-unreadable" },
	]) assert.deepEqual(parseLinkVerifyResult(verdict(known), submission), verdict(known));
	for (const unknown of [
		{ kind: "stale", reasons: [] }, { kind: "stale", reasons: ["policy-changed", "policy-changed"] }, { kind: "stale", reasons: ["changed"] },
		{ kind: "stale", reasons: ["policy-changed"], target: "gone" }, { kind: "unavailable", reason: "offline" }, { kind: "verified", url: SITE, route: "/", extra: 1 },
		{ kind: "approved" },
	]) assert.deepEqual(parseLinkVerifyResult(verdict(unknown), submission), { kind: "unusable", reason: "malformed" }, JSON.stringify(unknown));
	assert.deepEqual(parseLinkVerifyResult({ ...verified(SITE + "/guides/drip-irrigation"), extra: 1 }, submission), { kind: "unusable", reason: "malformed" });
	assert.deepEqual(parseLinkVerifyResult({ kind: "unavailable", reason: "adapter-absent" }, submission), { kind: "unavailable", reason: "adapter-absent" });
	assert.deepEqual(parseLinkVerifyResult({ kind: "invalid", reason: "receipt" }, submission), { kind: "unusable", reason: "malformed" });
	assert.deepEqual(parseLinkVerifyResult({ ...verified(SITE + "/guides/drip-irrigation"), pad: "x".repeat(LINK_RESULT_MAX_BYTES) }, submission), { kind: "unusable", reason: "oversized" });

	const check = (value: unknown, patch: Record<string, unknown> = {}) => ({ kind: "saved-check", ownerKey: submission.ownerKey, target: { ...submission.target }, check: value, ...patch });
	for (const known of [
		{ kind: "verified" }, { kind: "unlinked" }, { kind: "partial" }, { kind: "wrong-destination" },
		{ kind: "stale", detail: "paragraph-changed" }, { kind: "inconclusive", detail: "same-saved-version" }, { kind: "inconclusive", detail: "links-unreadable" },
	]) assert.deepEqual(parseLinkCheckResult(check(known), submission), check(known));
	for (const unknown of [{ kind: "verified", detail: "x" }, { kind: "stale", detail: "moved" }, { kind: "inconclusive", detail: "maybe" }, { kind: "linked" }]) {
		assert.deepEqual(parseLinkCheckResult(check(unknown), submission), { kind: "unusable", reason: "malformed" }, JSON.stringify(unknown));
	}
	assert.deepEqual(parseLinkCheckResult(check({ kind: "verified" }, { ownerKey: "other" }), submission), { kind: "unusable", reason: "owner-mismatch" });
	assert.deepEqual(parseLinkCheckResult(check({ kind: "verified" }, { target: { collection: "pages", entryId: id(3) } }), submission), { kind: "unusable", reason: "target-mismatch" });
	assert.deepEqual(parseLinkCheckResult({ kind: "invalid", reason: "request" }, submission), { kind: "invalid", reason: "request" });
	assert.deepEqual(parseLinkCheckResult({ ...check({ kind: "verified" }), pad: "x".repeat(LINK_RESULT_MAX_BYTES) }, submission), { kind: "unusable", reason: "oversized" });
	groups.push("Verify and Check identities and verdicts");
}

// ---------------------------------------------------------------------------
// A long Unicode public URL survives Find, submission, Verify and Check

{
	// 1,927 UTF-16 units, inside the URL limit; its percent-encoded route alone is over 17,000 characters.
	const publicUrl = SITE + "/guides/" + "語".repeat(1_900);
	const route = "/guides/" + "%E8%AA%9E".repeat(1_900);
	const owner = ownerOf(null);
	const wire = { kind: "result", response: responseFor(owner, { nextAfterId: id(25), exhausted: false }, id(3), { publicUrl }), next: receiptFor(owner, id(25)) };
	assert.ok(publicUrl.length <= 2_048);
	assert.ok(bytes(wire) > 16_384 && bytes(wire) <= LINK_RESULT_MAX_BYTES, "The page is over 16 KiB and inside the result bound");
	const page = parseLinkFindResult(wire, findRequest());
	if (page.kind !== "result") throw new Error("Long URL page: " + JSON.stringify(page).slice(0, 200));
	assert.equal(page.response.suggestions[0].target.publicUrl, publicUrl);
	assert.equal(page.response.suggestions[0].target.route, route);

	const submission = prepareLinkSubmission({ owner: page.response.owner, policyVersion: page.response.policyVersion, suggestion: page.response.suggestions[0] }) as LinkSubmission;
	assert.ok(submission, "The long URL submission is prepared");
	const verdict = { kind: "verification", ownerKey: submission.ownerKey, target: { ...submission.target }, verification: { kind: "verified", url: publicUrl, route } };
	const saved = { kind: "saved-check", ownerKey: submission.ownerKey, target: { ...submission.target }, check: { kind: "verified" } };
	assert.ok(bytes(verdict) > 16_384 && bytes(verdict) <= LINK_RESULT_MAX_BYTES, "The verdict is over 16 KiB and inside the result bound");
	assert.deepEqual(parseLinkVerifyResult(verdict, submission), verdict);

	const { calls, api } = injected((input) => ok(input === linkApiUrl("verify") ? verdict : saved));
	const answered = await api.verify(submission);
	assert.equal(answered.kind === "verification" && answered.verification.kind === "verified" && answered.verification.url, publicUrl, "The verified long URL is kept exactly");
	assert.deepEqual(await api.checkSaved(submission), saved);
	assert.deepEqual(JSON.parse(String(calls[0].init?.body)).suggestion.target.publicUrl, publicUrl);
	assert.deepEqual(parseLinkVerifyResult({ ...verdict, verification: { kind: "verified", url: publicUrl, route: route.slice(0, -9) } }, submission),
		{ kind: "unusable", reason: "url-mismatch" }, "A shortened route still disagrees");
	groups.push("long Unicode URL roundtrip");
}

assert.equal(rawFetches, 0, "No raw fetch was attempted");
globalThis.fetch = realFetch;
console.log("Internal link API selfcheck passed: " + groups.length + " groups");
