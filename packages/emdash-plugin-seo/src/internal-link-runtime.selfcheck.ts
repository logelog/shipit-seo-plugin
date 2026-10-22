import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { LinkSuggestionPorts } from "./internal-link-source.ts";
import {
	LINK_SUGGESTION_LIMITS,
	acceptLinkSuggestionResponse,
	finalizeLinkSuggestions,
	linkSuggestionOwnerKey,
	rankLinkSuggestions,
	type LinkSuggestionResponse,
} from "./internal-link-suggestions.ts";
import {
	LINK_PAGE_RECEIPT_FORMAT,
	createLinkSuggestionRuntime,
	linkPageRefusalReason,
	validateLinkFindRequest,
	validateLinkNextRequest,
	validateLinkPageReceipt,
	type LinkPageReceipt,
	type LinkPageResult,
} from "./internal-link-runtime.ts";

// ---------------------------------------------------------------------------
// The runtime imports only the pure engine, its ports and shared helpers

{
	const text = readFileSync(new URL("./internal-link-runtime.ts", import.meta.url), "utf8");
	const specifiers = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gmu)].map((match) => match[1]);
	assert.deepEqual([...new Set(specifiers)].sort(), ["./admin-contract.ts", "./internal-link-source.ts", "./internal-link-suggestions.ts", "./lib.ts"]);
	assert.doesNotMatch(text, /\bimport\s*\(|\bfetch\s*\(|insertInto|updateTable|deleteFrom|emdash\/runtime|react/u);
}

// ---------------------------------------------------------------------------
// An in-memory site behind spy ports that expose read methods only

const SITE = "https://example.com";
const SOURCE_ID = "01KSOURCE00000000000000001";
const VERSION = "entry-v1:1:2026-10-04 12:00:00";
const CAP = LINK_SUGGESTION_LIMITS.responseBytes;
const id = (index: number) => "01KG" + String(index).padStart(22, "0");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const span = (key: string, text: string, marks: string[] = []) => ({ _type: "span", _key: key, text, marks });
const block = (key: string, children: unknown[], extra: Record<string, unknown> = {}) =>
	({ _type: "block", _key: key, style: "normal", markDefs: [], children, ...extra });
const paragraph = (key: string, text: string) => block(key, [span(key + "-s", text)]);
const heading = (key: string, text: string) => block(key, [span(key + "-s", text)], { style: "h2" });
const link = (key: string, href: string) => ({ _type: "link", _key: key, href });

const P1 = "Our notes on drip irrigation explain spacing for raised beds.";
function gardenBody(): any[] {
	return [
		heading("h1", "Planning the vegetable garden"),
		paragraph("p1", P1),
		paragraph("p2", "Before planting, compare soil testing kits and try compost tea."),
		paragraph("p3", "Many readers pair mulching strategies with rain barrels."),
		paragraph("p4", "Pruning fruit trees in late winter keeps them productive."),
		paragraph("p5", "Greenhouse ventilation matters on sunny spring days."),
		paragraph("p6", "Seed starting indoors gives tomatoes a head start."),
		block("p7", [span("p7-a", "See also "), span("p7-b", "companion planting", ["l1"]), span("p7-c", ".")], {
			markDefs: [link("l1", "/guides/companion-planting")],
		}),
	];
}

interface Guide {
	id: string;
	title: string;
	slug: string;
	locale?: string;
	status?: string;
	version?: string;
	policy?: string;
	terms?: string[];
}

const GARDEN: Record<number, [string, string, string[]]> = {
	3: ["Drip irrigation", "drip-irrigation", ["t-water"]],
	7: ["Soil testing kits", "soil-testing-kits", ["t-soil"]],
	9: ["Companion planting", "companion-planting", []],
	11: ["Rain barrels", "rain-barrels", ["t-water"]],
	15: ["Pruning fruit trees", "pruning-fruit-trees", []],
	19: ["Greenhouse ventilation", "greenhouse-ventilation", []],
	23: ["Seed starting indoors", "seed-starting-indoors", []],
	30: ["Compost tea", "compost-tea", ["t-soil"]],
};

function gardenGuides(count = 60): Guide[] {
	return Array.from({ length: count }, (_, offset) => {
		const index = offset + 1;
		const garden = GARDEN[index];
		return garden
			? { id: id(index), title: garden[0], slug: garden[1], terms: garden[2] }
			: { id: id(index), title: "Bicycle maintenance log " + index, slug: "bicycle-log-" + index };
	});
}

interface SiteState {
	locale: string;
	sourceVersion: string;
	revisionId: string | null;
	field: string;
	body: unknown;
	/** What the source port itself claims; the runtime must ignore it. */
	sourceRouteUrl: string | null;
	sourceRead?: () => unknown;
	guides: Guide[];
	scopeVersion: string;
	attached: Record<string, string[]>;
	terms: Record<string, { taxonomy: string; locale: string }>;
	resolveOverride?: (request: any, allowed: readonly string[]) => unknown;
	pageOverride?: (scope: any, afterId: string | null, budget: any) => unknown;
	policy: unknown;
	missingTargets: Set<string>;
	failingTargets: Set<string>;
	route?: (ref: any) => unknown;
	/** Holds the chosen target read open, as a pending host URL resolution would. */
	beforeTarget?: () => Promise<void>;
}

function gardenSite(patch: Partial<SiteState> = {}): SiteState {
	return {
		locale: "en", sourceVersion: "v1", revisionId: null, field: "content", body: gardenBody(), sourceRouteUrl: null,
		guides: gardenGuides(), scopeVersion: "scope-1", attached: { topics: ["guides"] },
		terms: { "t-water": { taxonomy: "topics", locale: "en" }, "t-soil": { taxonomy: "topics", locale: "en" }, "t-eau": { taxonomy: "topics", locale: "fr" } },
		policy: { kind: "readable", version: "policy-1" }, missingTargets: new Set(), failingTargets: new Set(),
		...patch,
	};
}

function sourceDocument(state: SiteState) {
	return {
		collection: "posts", entryId: SOURCE_ID, locale: state.locale, sourceVersion: state.sourceVersion, revisionId: state.revisionId,
		field: state.field, body: state.body, siteUrl: SITE, routeUrl: state.sourceRouteUrl,
	};
}

/** The port contract's page: a fixed window, raw rows examined in ID order, at most 25 matches. */
function defaultPage(state: SiteState, scope: any, afterId: string | null, budget: any) {
	const window = state.guides.filter((guide) => scope.upperId !== null && guide.id <= scope.upperId && (afterId === null || guide.id > afterId));
	const rows = window.slice(0, budget.candidateRows);
	const candidates: any[] = [];
	let examinedRows = 0;
	let last: string | null = null;
	for (const row of rows) {
		examinedRows += 1;
		last = row.id;
		if ((row.locale ?? state.locale) !== scope.locale || (row.status ?? "published") !== "published") continue;
		if (scope.taxonomy !== null && !(row.terms ?? []).some((term) => scope.termIds.includes(term))) continue;
		candidates.push({ collection: "guides", entryId: row.id, locale: scope.locale, version: row.version ?? VERSION, title: row.title, excerpt: null, afterId: row.id });
		if (candidates.length === budget.scopeMatches) break;
	}
	const exhausted = examinedRows === window.length;
	return { candidates, examinedRows, nextAfterId: exhausted ? null : last, exhausted };
}

const allForbidden: string[] = [];
let networkCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
	networkCalls += 1;
	throw new Error("Network access is not allowed in the runtime selfcheck");
}) as typeof fetch;

interface Call { port: string; method: string; args: any[]; result?: any }

function harness(state: SiteState) {
	const calls: Call[] = [];
	const spy = (port: string, methods: Record<string, (...args: any[]) => unknown>) => new Proxy({}, {
		get(_target, key) {
			if (typeof key === "string" && Object.prototype.hasOwnProperty.call(methods, key)) {
				return async (...args: unknown[]) => {
					const call: Call = { port, method: key, args: structuredClone(args) };
					calls.push(call);
					const result = await methods[key](...args);
					call.result = structuredClone(result);
					return result;
				};
			}
			// Writes, lists, counts, jobs and anything else a port does not declare.
			allForbidden.push(port + "." + String(key));
			return undefined;
		},
	});
	const ports: Record<string, unknown> = {
		source: spy("source", {
			readSource(ref: any) {
				if (state.sourceRead) return state.sourceRead();
				return ref.collection === "posts" && ref.entryId === SOURCE_ID ? { kind: "found", document: sourceDocument(state) } : { kind: "missing" };
			},
		}),
		candidates: spy("candidates", {
			resolveScope(request: any, allowed: readonly string[]) {
				if (state.resolveOverride) return state.resolveOverride(request, allowed);
				if (request.collection !== "guides" || !allowed.includes("guides")) return { kind: "invalid", reason: "collection-unavailable" };
				let taxonomy: string | null = null;
				let termIds: string[] = [];
				if (request.taxonomy) {
					if (!(state.attached[request.taxonomy.taxonomy] ?? []).includes("guides")) return { kind: "invalid", reason: "taxonomy-not-attached" };
					termIds = [...new Set<string>(request.taxonomy.termIds)].sort();
					if (termIds.length > 8) return { kind: "invalid", reason: "too-many-terms" };
					if (!termIds.every((term) => state.terms[term]?.taxonomy === request.taxonomy.taxonomy && state.terms[term].locale === request.locale)) {
						return { kind: "invalid", reason: "term-unavailable" };
					}
					taxonomy = request.taxonomy.taxonomy;
				}
				const upperId = state.guides.length === 0 ? null : state.guides[state.guides.length - 1].id;
				return { kind: "resolved", scope: { collection: "guides", locale: request.locale, taxonomy, termIds, scopeVersion: state.scopeVersion, upperId } };
			},
			page(scope: any, afterId: string | null, budget: any) {
				return state.pageOverride ? state.pageOverride(scope, afterId, budget) : defaultPage(state, scope, afterId, budget);
			},
		}),
		targets: spy("targets", {
			async readTarget(ref: any, scope: any, globalPolicyVersion: string) {
				if (state.beforeTarget) await state.beforeTarget();
				if (state.failingTargets.has(ref.entryId)) throw new Error("Synthetic target read failure");
				const row = state.guides.find((guide) => guide.id === ref.entryId);
				if (!row || ref.collection !== "guides" || state.missingTargets.has(ref.entryId)) return { kind: "missing" };
				return {
					kind: "found",
					target: {
						collection: "guides", entryId: row.id, locale: row.locale ?? state.locale, status: row.status ?? "published",
						version: row.version ?? VERSION, title: row.title, publicUrl: SITE + "/guides/" + row.slug,
						inScope: scope.taxonomy === null || (row.terms ?? []).some((term) => scope.termIds.includes(term)),
						noindex: false, globalPolicyVersion, targetPolicyVersion: row.policy ?? row.id + ":policy-1",
					},
				};
			},
		}),
		policy: spy("policy", {
			readPolicy() {
				return typeof state.policy === "function" ? (state.policy as () => unknown)() : state.policy;
			},
		}),
	};
	if (state.route) ports.sourceRoute = spy("sourceRoute", { resolveSavedRoute: (ref: any) => state.route?.(ref) });
	return {
		calls,
		count: (port: string, method?: string) => calls.filter((call) => call.port === port && (method === undefined || call.method === method)).length,
		call: (port: string, method: string) => calls.find((call) => call.port === port && call.method === method) as Call,
		methods: () => calls.map((call) => call.port + "." + call.method),
		runtime: (allowedCollections: readonly string[] = ["guides"], responseBytes?: number) => createLinkSuggestionRuntime({
			ports: { kind: "available", ports: ports as unknown as LinkSuggestionPorts },
			allowedCollections,
			...(responseBytes === undefined ? {} : { responseBytes }),
		}),
	};
}

const findRequest = (source: Record<string, unknown> = {}, destination: unknown = { collection: "guides", taxonomy: null }) => ({
	source: { collection: "posts", entryId: SOURCE_ID, locale: "en", sourceVersion: "v1", ...source },
	generation: 7,
	destination,
});
const ownerFor = (afterId: string | null, scope: Record<string, unknown> = {}) => ({
	source: { collection: "posts", entryId: SOURCE_ID, locale: "en", sourceVersion: "v1", revisionId: null, field: "content" },
	scope: { collection: "guides", locale: "en", taxonomy: null, termIds: [], afterId, scopeVersion: "scope-1", ...scope },
	generation: 7,
});

function resultOf(value: LinkPageResult, label: string) {
	if (value.kind !== "result") return assert.fail(label + ": expected a result, got " + JSON.stringify(value));
	return value;
}

function accepted(response: LinkSuggestionResponse, owner: unknown, label: string) {
	const acceptance = acceptLinkSuggestionResponse(response, owner as never);
	assert.equal(acceptance.kind, "accepted", label + ": the client would not accept this response");
}

const noPolicyOrTargets = (h: ReturnType<typeof harness>, label: string) => {
	assert.equal(h.count("policy"), 0, label + ": policy read");
	assert.equal(h.count("targets"), 0, label + ": target read");
};

class LinkCandidatePageRefusal extends Error {
	reason: string;
	constructor(reason: string) {
		super("Synthetic page refusal");
		this.name = "LinkCandidatePageRefusal";
		this.reason = reason;
	}
}

// ---------------------------------------------------------------------------
// Adapter absence and request validation refuse before any read

{
	const absent = createLinkSuggestionRuntime({ ports: { kind: "unavailable", reason: "adapter-absent" }, allowedCollections: ["guides"] });
	for (const result of [await absent.find(findRequest()), await absent.next({}), await absent.verify({}), await absent.checkSaved({})]) {
		assert.deepEqual(result, { kind: "unavailable", reason: "adapter-absent" });
	}

	const valid = findRequest();
	const copy = validateLinkFindRequest(valid);
	assert.deepEqual(copy, valid);
	(valid.source as Record<string, unknown>).sourceVersion = "mutated";
	assert.equal(copy?.source.sourceVersion, "v1", "A validated request must not alias the caller's object");
	for (const request of [
		{ ...findRequest(), extra: true },
		{ source: findRequest().source, destination: findRequest().destination },
		findRequest({ locale: "EN" }),
		findRequest({ locale: "en_US" }),
		findRequest({ collection: "Posts" }),
		findRequest({ entryId: " " + SOURCE_ID }),
		findRequest({ sourceVersion: "v".repeat(513) }),
		{ ...findRequest(), generation: -1 },
		{ ...findRequest(), generation: 1.5 },
		findRequest({}, { collection: "guides" }),
		findRequest({}, { collection: "guides", taxonomy: { taxonomy: "topics", termIds: [] } }),
		findRequest({}, { collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["a", "a"] } }),
		findRequest({}, { collection: "guides", taxonomy: { taxonomy: "topics", termIds: Array.from({ length: 9 }, (_, index) => "t" + index) } }),
		findRequest({}, { collection: "guides", taxonomy: { taxonomy: "", termIds: ["t-water"] } }),
		findRequest({ sourceVersion: "x".repeat(20_000) }),
	]) assert.equal(validateLinkFindRequest(request), null, JSON.stringify(request).slice(0, 120));

	const h = harness(gardenSite());
	const runtime = h.runtime();
	assert.deepEqual(await runtime.find({ ...findRequest(), extra: 1 }), { kind: "invalid", reason: "request" });
	assert.deepEqual(await runtime.next({ generation: 7 }), { kind: "invalid", reason: "receipt" });
	assert.deepEqual(await runtime.verify({ owner: null }), { kind: "invalid", reason: "request" });
	assert.deepEqual(await runtime.checkSaved("request"), { kind: "invalid", reason: "request" });
	assert.deepEqual(await h.runtime(["other"]).find(findRequest()), { kind: "invalid", reason: "collection-unavailable" });
	assert.equal(h.calls.length, 0);
}

// ---------------------------------------------------------------------------
// Find: exact source, fresh scope, one bounded page, one policy, at most five targets

let baselineTargets: string[] = [];
let findResult: Extract<LinkPageResult, { kind: "result" }>;
{
	const h = harness(gardenSite());
	findResult = resultOf(await h.runtime().find(findRequest()), "find");
	assert.deepEqual(h.methods(), [
		"source.readSource", "candidates.resolveScope", "candidates.page", "policy.readPolicy",
		"targets.readTarget", "targets.readTarget", "targets.readTarget", "targets.readTarget", "targets.readTarget",
	]);
	assert.deepEqual(h.calls[0].args, [{ collection: "posts", entryId: SOURCE_ID }]);
	assert.deepEqual(h.call("candidates", "resolveScope").args, [{ collection: "guides", locale: "en", taxonomy: null }, ["guides"]]);
	const pageCall = h.call("candidates", "page");
	assert.deepEqual(pageCall.args, [
		{ collection: "guides", locale: "en", taxonomy: null, termIds: [], scopeVersion: "scope-1", upperId: id(60) },
		null,
		{ candidateRows: 200, scopeMatches: 25 },
	]);
	const pageIds = new Set(pageCall.result.candidates.map((candidate: any) => candidate.entryId));
	const targetCalls = h.calls.filter((call) => call.port === "targets");
	for (const call of targetCalls) {
		assert.ok(pageIds.has(call.args[0].entryId), "A target outside the page was read");
		assert.equal(call.args[2], "policy-1");
		assert.equal(call.args[1].upperId, id(60));
	}
	baselineTargets = targetCalls.map((call) => call.args[0].entryId).sort();
	assert.equal(new Set(baselineTargets).size, 5);

	const { response, next } = findResult;
	accepted(response, ownerFor(null), "find");
	assert.equal(response.suggestions.length, 5);
	assert.equal(response.excluded["display-limit"], 1);
	assert.equal(response.policyVersion, "policy-1");
	assert.deepEqual(response.page, { examinedRows: 25, scopeMatches: 25, nextAfterId: id(25), exhausted: false });
	assert.deepEqual(next, {
		format: LINK_PAGE_RECEIPT_FORMAT,
		source: { collection: "posts", entryId: SOURCE_ID, locale: "en", sourceVersion: "v1", revisionId: null, field: "content" },
		generation: 7,
		scope: { collection: "guides", locale: "en", taxonomy: null, termIds: [], scopeVersion: "scope-1", upperId: id(60) },
		afterId: id(25),
	});
	assert.deepEqual(validateLinkPageReceipt(next), next);
	assert.ok(bytes(findResult) <= CAP);
}

{
	// An excluded displayed target leaves fewer suggestions; nothing replaces it.
	for (const [label, patch, reason] of [
		["missing target", { missingTargets: new Set([id(3)]) }, "target-missing"],
		["failing target read", { failingTargets: new Set([id(3)]) }, "target-unavailable"],
	] as const) {
		const h = harness(gardenSite(patch));
		const { response } = resultOf(await h.runtime().find(findRequest()), label);
		assert.equal(response.suggestions.length, 4, label);
		assert.equal(response.excluded[reason], 1, label);
		assert.deepEqual(h.calls.filter((call) => call.port === "targets").map((call) => call.args[0].entryId).sort(), baselineTargets, label);
	}
}

{
	// Source states end the request at the source read.
	for (const [label, patch, request, expected] of [
		["saved version changed", { sourceVersion: "v2" }, findRequest(), { kind: "stale", reason: "source-version-changed" }],
		["locale changed", { locale: "en-GB" }, findRequest(), { kind: "stale", reason: "source-locale-changed" }],
		["source missing", {}, findRequest({ entryId: "01KSOURCE00000000000000999" }), { kind: "stale", reason: "source-missing" }],
		["unsupported body field", { sourceRead: () => ({ kind: "unsupported", reason: "ambiguous-body-field" }) }, findRequest(), { kind: "unsupported", reason: "ambiguous-body-field" }],
		["source read failure", { sourceRead: () => { throw new Error("Synthetic source failure"); } }, findRequest(), { kind: "unavailable", reason: "source-unavailable" }],
		["unreadable draft", { sourceRead: () => ({ kind: "unavailable" }) }, findRequest(), { kind: "unavailable", reason: "source-unavailable" }],
		["another entry answered", { sourceRead: () => ({ kind: "found", document: { ...sourceDocument(gardenSite()), entryId: "01KOTHER0000000000000000001" } }) }, findRequest(), { kind: "unavailable", reason: "source-unavailable" }],
		["body is not Portable Text", { body: { text: P1 } }, findRequest(), { kind: "refused", reason: "source_body_unsupported" }],
		["oversized body", { body: Array.from({ length: 40 }, (_, index) => paragraph("big" + index, "x".repeat(2_000))) }, findRequest(), { kind: "refused", reason: "source_too_large" }],
	] as const) {
		const h = harness(gardenSite(patch as Partial<SiteState>));
		assert.deepEqual(await h.runtime().find(request), expected, label);
		assert.deepEqual(h.methods(), ["source.readSource"], label);
	}
}

{
	// Only the optional route port names the saved route.
	const body = [...gardenBody(), block("p8", [span("p8-a", "Read "), span("p8-b", "our spring plan", ["rel"])], { markDefs: [link("rel", "spring-plan")] })];
	const claimed = SITE + "/journal/spring/";
	const ignored = harness(gardenSite({ body, sourceRouteUrl: claimed }));
	assert.deepEqual(await ignored.runtime().find(findRequest()), { kind: "refused", reason: "source_route_unavailable" });
	assert.deepEqual(ignored.methods(), ["source.readSource"]);
	for (const route of [() => { throw new Error("Synthetic route failure"); }, () => ({ kind: "unavailable" }), () => ({ kind: "resolved", url: 7 })]) {
		const h = harness(gardenSite({ body, sourceRouteUrl: claimed, route }));
		assert.deepEqual(await h.runtime().find(findRequest()), { kind: "refused", reason: "source_route_unavailable" });
		assert.deepEqual(h.methods(), ["source.readSource", "sourceRoute.resolveSavedRoute"]);
	}
	const routed = harness(gardenSite({ body, route: () => ({ kind: "resolved", url: claimed }) }));
	resultOf(await routed.runtime().find(findRequest()), "routed");
	assert.deepEqual(routed.call("sourceRoute", "resolveSavedRoute").args, [{ collection: "posts", entryId: SOURCE_ID, sourceVersion: "v1" }]);
}

{
	// Scope resolution: named refusals, and a resolution that answers another scope is unavailable.
	const topic = (termIds: string[]) => findRequest({}, { collection: "guides", taxonomy: { taxonomy: "topics", termIds } });
	for (const [label, patch, request, expected] of [
		["detached taxonomy", { attached: { topics: [] } }, topic(["t-water"]), { kind: "invalid", reason: "taxonomy-not-attached" }],
		["term in another locale", {}, topic(["t-eau"]), { kind: "invalid", reason: "term-unavailable" }],
		["resolution failure", { resolveOverride: () => { throw new Error("Synthetic scope failure"); } }, findRequest(), { kind: "unavailable", reason: "scope-unavailable" }],
		["another collection resolved", { resolveOverride: (request: any) => ({ kind: "resolved", scope: { collection: "pages", locale: request.locale, taxonomy: null, termIds: [], scopeVersion: "s", upperId: null } }) }, findRequest(), { kind: "unavailable", reason: "scope-unavailable" }],
		["a selected term dropped", { resolveOverride: (request: any) => ({ kind: "resolved", scope: { collection: "guides", locale: request.locale, taxonomy: "topics", termIds: ["t-soil"], scopeVersion: "s", upperId: id(60) } }) }, topic(["t-soil", "t-water"]), { kind: "unavailable", reason: "scope-unavailable" }],
	] as const) {
		const h = harness(gardenSite(patch as Partial<SiteState>));
		assert.deepEqual(await h.runtime().find(request), expected, label);
		assert.equal(h.count("candidates", "page"), 0, label);
		noPolicyOrTargets(h, label);
	}
	const h = harness(gardenSite());
	const tagged = resultOf(await h.runtime().find(topic(["t-water"])), "taxonomy find");
	accepted(tagged.response, ownerFor(null, { taxonomy: "topics", termIds: ["t-water"] }), "taxonomy find");
	assert.deepEqual(tagged.response.suggestions.map((item) => item.target.entryId).sort(), [id(11), id(3)].sort());
	assert.equal(tagged.next, null);
}

{
	// The page refusal boundary is structural; only a named scope change is stale.
	assert.equal(linkPageRefusalReason(new LinkCandidatePageRefusal("scope-changed")), "scope-changed");
	assert.equal(linkPageRefusalReason({ name: "LinkCandidatePageRefusal", reason: "scope-changed" }), "scope-changed");
	for (const error of [new LinkCandidatePageRefusal("unavailable"), Object.assign(new Error("x"), { reason: "scope-changed" }), null, "scope-changed"]) {
		assert.equal(linkPageRefusalReason(error), "unavailable");
	}
	for (const [label, error, expected] of [
		["scope changed", new LinkCandidatePageRefusal("scope-changed"), { kind: "stale", reason: "scope-changed" }],
		["page unavailable", new LinkCandidatePageRefusal("unavailable"), { kind: "unavailable", reason: "candidates-unavailable" }],
		["other failure", Object.assign(new Error("Synthetic failure"), { reason: "scope-changed" }), { kind: "unavailable", reason: "candidates-unavailable" }],
	] as const) {
		const h = harness(gardenSite({ pageOverride: () => { throw error; } }));
		assert.deepEqual(await h.runtime().find(findRequest()), expected, label);
		noPolicyOrTargets(h, label);
	}
}

{
	// Malformed or out-of-window pages are refused before ranking, policy or target reads.
	const malformed = (label: string, change: (page: any) => unknown) => async () => {
		const state = gardenSite();
		state.pageOverride = (scope, afterId, budget) => change(defaultPage(state, scope, afterId, budget));
		const h = harness(state);
		assert.deepEqual(await h.runtime().find(findRequest()), { kind: "refused", reason: "candidate_page_invalid" }, label);
		noPolicyOrTargets(h, label);
	};
	const cases = [
		malformed("not advancing", (page) => ({ ...page, exhausted: false, nextAfterId: null })),
		malformed("exhausted with a cursor", (page) => ({ ...page, exhausted: true })),
		malformed("cursor at the upper ID", (page) => ({ ...page, nextAfterId: id(60) })),
		malformed("cursor beyond the window", (page) => ({ ...page, nextAfterId: id(70) })),
		malformed("too many examined rows", (page) => ({ ...page, examinedRows: 201 })),
		malformed("an empty advancing page", (page) => ({ ...page, candidates: [], examinedRows: 0 })),
		malformed("more than 25 matches", (page) => ({ ...page, candidates: [...page.candidates, page.candidates[0]] })),
		malformed("more matches than examined rows", (page) => ({ ...page, examinedRows: 3 })),
		malformed("a candidate beyond the upper ID", (page) => ({ ...page, candidates: [{ ...page.candidates[0], entryId: id(61), afterId: id(61) }] })),
		malformed("candidates out of order", (page) => ({ ...page, candidates: [...page.candidates].reverse() })),
		malformed("an entry outside its cursor position", (page) => ({ ...page, candidates: [{ ...page.candidates[0], entryId: id(99) }] })),
		malformed("a candidate without a cursor position", (page) => ({ ...page, candidates: [{ ...page.candidates[0], afterId: undefined }] })),
		malformed("an engine-invalid version", (page) => ({ ...page, candidates: [{ ...page.candidates[0], version: "" }] })),
	];
	for (const run of cases) await run();

	// An empty collection resolves without an upper ID, so any returned match is outside the window.
	const empty = gardenSite();
	empty.resolveOverride = (request) => ({ kind: "resolved", scope: { collection: "guides", locale: request.locale, taxonomy: null, termIds: [], scopeVersion: "scope-1", upperId: null } });
	empty.pageOverride = (scope, afterId, budget) => ({ ...defaultPage(empty, { ...scope, upperId: id(60) }, afterId, budget), exhausted: true, nextAfterId: null });
	const withoutUpper = harness(empty);
	assert.deepEqual(await withoutUpper.runtime().find(findRequest()), { kind: "refused", reason: "candidate_page_invalid" });
	noPolicyOrTargets(withoutUpper, "matches without an upper ID");

	// A Drip irrigation reference outside the window, carried at an in-window cursor, reaches no target read.
	const state = gardenSite();
	state.pageOverride = (scope, afterId, budget) => {
		const page = defaultPage(state, scope, afterId, budget);
		return { ...page, candidates: page.candidates.map((candidate: any) => candidate.entryId === id(3) ? { ...candidate, entryId: id(99) } : candidate) };
	};
	const h = harness(state);
	assert.deepEqual(await h.runtime().find(findRequest()), { kind: "refused", reason: "candidate_page_invalid" });
	noPolicyOrTargets(h, "entry outside the window");
}

{
	// Global policy: one fresh read; unreadable refuses every target read.
	for (const policy of [{ kind: "unreadable" }, { kind: "readable", version: "" }, () => { throw new Error("Synthetic policy failure"); }]) {
		const h = harness(gardenSite({ policy }));
		assert.deepEqual(await h.runtime().find(findRequest()), { kind: "unavailable", reason: "policy-unreadable" });
		assert.equal(h.count("policy"), 1);
		assert.equal(h.count("targets"), 0);
	}
}

// ---------------------------------------------------------------------------
// Next: the receipt binds source, selection and scope; the window never moves

const receipt = findResult.next as LinkPageReceipt;
{
	const state = gardenSite();
	const h = harness(state);
	const runtime = h.runtime();
	// Newer rows beyond the original upper ID must never be read.
	state.guides.push({ id: id(61), title: "Compost tea", slug: "compost-tea-new" }, { id: id(62), title: "Rain barrels", slug: "rain-barrels-new" });
	const second = resultOf(await runtime.next({ generation: 7, receipt }), "next");
	assert.deepEqual(h.methods().slice(0, 4), ["source.readSource", "candidates.resolveScope", "candidates.page", "policy.readPolicy"]);
	assert.equal(h.call("candidates", "resolveScope").result.scope.upperId, id(62));
	assert.deepEqual(h.call("candidates", "page").args.slice(1), [id(25), { candidateRows: 200, scopeMatches: 25 }]);
	assert.equal(h.call("candidates", "page").args[0].upperId, id(60));
	accepted(second.response, ownerFor(id(25)), "next");
	assert.deepEqual(second.response.suggestions.map((item) => item.target.entryId), [id(30)]);
	assert.equal(second.next?.afterId, id(50));
	assert.equal(second.next?.scope.upperId, id(60));
	const third = resultOf(await runtime.next({ generation: 7, receipt: second.next }), "final next");
	assert.equal(third.next, null);
	assert.equal(third.response.page.exhausted, true);
	assert.equal(third.response.page.nextAfterId, null);
	for (const call of h.calls) {
		if (call.method === "page") assert.ok(call.result.candidates.every((candidate: any) => candidate.entryId <= id(60)));
		if (call.port === "targets") assert.ok(call.args[0].entryId <= id(60));
	}
}

{
	// Sparse windows advance without matches and end with no cursor.
	const guides = Array.from({ length: 450 }, (_, offset) => {
		const index = offset + 1;
		if (index === 260) return { id: id(index), title: "Drip irrigation", slug: "drip-irrigation" };
		if (index === 420) return { id: id(index), title: "Rain barrels", slug: "rain-barrels" };
		return { id: id(index), title: "Draft note " + index, slug: "draft-" + index, status: "draft" };
	});
	const h = harness(gardenSite({ guides }));
	const runtime = h.runtime();
	const empty = resultOf(await runtime.find(findRequest()), "sparse find");
	assert.deepEqual(empty.response.suggestions, []);
	assert.deepEqual(empty.response.page, { examinedRows: 200, scopeMatches: 0, nextAfterId: id(200), exhausted: false });
	assert.equal(empty.next?.afterId, id(200));
	assert.equal(h.count("targets"), 0);
	const middle = resultOf(await runtime.next({ generation: 7, receipt: empty.next }), "sparse next");
	assert.deepEqual(middle.response.suggestions.map((item) => item.target.entryId), [id(260)]);
	assert.equal(middle.next?.afterId, id(400));
	const last = resultOf(await runtime.next({ generation: 7, receipt: middle.next }), "sparse final");
	assert.deepEqual(last.response.suggestions.map((item) => item.target.entryId), [id(420)]);
	assert.equal(last.next, null);
	assert.equal(h.count("candidates", "page"), 3);
}

{
	// Receipt and selection mismatches.
	const taxonomyReceipt = { ...receipt, scope: { ...receipt.scope, taxonomy: "topics", termIds: ["t-water"] } };
	const scopeReads = ["source.readSource", "candidates.resolveScope"];
	const mismatches: Array<{ label: string; patch?: Partial<SiteState>; input: unknown; expected: unknown; methods: string[]; allowed?: string[] }> = [
		{ label: "older selection", input: { generation: 8, receipt }, expected: { kind: "stale", reason: "selection-changed" }, methods: [] },
		{ label: "collection no longer allowed", input: { generation: 7, receipt }, expected: { kind: "stale", reason: "scope-changed" }, methods: [], allowed: ["pages"] },
		{ label: "saved version changed", patch: { sourceVersion: "v2" }, input: { generation: 7, receipt }, expected: { kind: "stale", reason: "source-version-changed" }, methods: ["source.readSource"] },
		{ label: "draft revision changed", patch: { revisionId: "rev-2" }, input: { generation: 7, receipt }, expected: { kind: "stale", reason: "source-version-changed" }, methods: ["source.readSource"] },
		{ label: "body field changed", patch: { field: "body" }, input: { generation: 7, receipt }, expected: { kind: "stale", reason: "source-version-changed" }, methods: ["source.readSource"] },
		{ label: "locale changed", patch: { locale: "en-GB" }, input: { generation: 7, receipt }, expected: { kind: "stale", reason: "source-locale-changed" }, methods: ["source.readSource"] },
		{ label: "definitions changed", patch: { scopeVersion: "scope-2" }, input: { generation: 7, receipt }, expected: { kind: "stale", reason: "scope-changed" }, methods: scopeReads },
		{ label: "taxonomy detached", patch: { attached: { topics: [] } }, input: { generation: 7, receipt: taxonomyReceipt }, expected: { kind: "stale", reason: "scope-changed" }, methods: scopeReads },
		{ label: "scope unreadable", patch: { resolveOverride: () => ({ kind: "unavailable" }) }, input: { generation: 7, receipt }, expected: { kind: "unavailable", reason: "scope-unavailable" }, methods: scopeReads },
	];
	for (const { label, patch, input, expected, methods, allowed } of mismatches) {
		const h = harness(gardenSite(patch));
		assert.deepEqual(await h.runtime(allowed ?? ["guides"]).next(input), expected, label);
		assert.deepEqual(h.methods(), methods, label);
	}

	const tampered = (change: (value: any) => unknown) => {
		const value = structuredClone(receipt) as any;
		change(value);
		return value;
	};
	for (const value of [
		tampered((value) => { value.format = "link-page-v0"; }),
		tampered((value) => { value.extra = true; }),
		tampered((value) => { value.afterId = value.scope.upperId; }),
		tampered((value) => { value.afterId = id(61); }),
		tampered((value) => { value.afterId = ""; }),
		tampered((value) => { value.afterId = " " + id(25); }),
		tampered((value) => { value.scope.taxonomy = "topics"; value.scope.termIds = ["t-water", "t-soil"]; }),
		tampered((value) => { value.scope.taxonomy = "topics"; value.scope.termIds = ["t-water", "t-water"]; }),
		tampered((value) => { value.scope.termIds = ["t-water"]; }),
		tampered((value) => { value.scope.locale = "fr"; }),
		tampered((value) => { value.scope.upperId = null; }),
		tampered((value) => { value.source.locale = "EN"; value.scope.locale = "EN"; }),
		tampered((value) => { value.source.revisionId = ""; }),
		tampered((value) => { value.source.sourceVersion = "x".repeat(20_000); }),
		tampered((value) => { value.generation = -1; }),
		tampered((value) => { delete value.scope.scopeVersion; }),
	]) {
		assert.equal(validateLinkPageReceipt(value), null, JSON.stringify(value).slice(0, 160));
		const h = harness(gardenSite());
		assert.deepEqual(await h.runtime().next({ generation: 7, receipt: value }), { kind: "invalid", reason: "receipt" });
		assert.equal(h.calls.length, 0);
	}
	assert.equal(validateLinkNextRequest({ generation: 7, receipt, extra: 1 }), null);

	for (const [label, change] of [
		["a page that does not advance", (page: any, afterId: string | null) => ({ ...page, nextAfterId: afterId })],
		["a candidate before the cursor", (page: any) => ({ ...page, candidates: [{ ...page.candidates[0], entryId: id(20), afterId: id(20) }] })],
	] as const) {
		const state = gardenSite();
		state.pageOverride = (scope, afterId, budget) => change(defaultPage(state, scope, afterId, budget), afterId);
		const h = harness(state);
		assert.deepEqual(await h.runtime().next({ generation: 7, receipt }), { kind: "refused", reason: "candidate_page_invalid" }, label);
		noPolicyOrTargets(h, label);
	}
}

// ---------------------------------------------------------------------------
// Verify: exact source, chosen target, fresh scope and global policy only

const dripSuggestion = findResult.response.suggestions.find((item) => item.target.entryId === id(3));
assert.ok(dripSuggestion, "The garden fixture must suggest Drip irrigation");
const dripRequest = { owner: findResult.response.owner, policyVersion: findResult.response.policyVersion, suggestion: dripSuggestion };
const dripOwnerKey = linkSuggestionOwnerKey(findResult.response.owner);

/** Starts an operation whose exact source read waits until released. */
function gatedSource(state: SiteState) {
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => { release = resolve; });
	state.sourceRead = async () => {
		await gate;
		return { kind: "found", document: sourceDocument(state) };
	};
	return () => release();
}

/** Changes every field of the caller's own request that a late read could pick up. */
function mutateCaller(caller: any): void {
	caller.owner.source.sourceVersion = "v9";
	caller.policyVersion = "policy-9";
	Object.assign(caller.suggestion.target, {
		entryId: id(11), title: "Rain barrels", route: "/guides/rain-barrels", publicUrl: SITE + "/guides/rain-barrels",
		version: "entry-v1:9:2026-10-04 12:00:00", targetPolicyVersion: id(11) + ":policy-1",
	});
	Object.assign(caller.suggestion.anchor, {
		blockKey: "p3", spanKey: "p3-s", text: "Many", paragraph: "Many readers pair mulching strategies with rain barrels.",
		start: 0, end: 4, paragraphStart: 0, paragraphEnd: 4,
	});
	caller.suggestion.anchor.decorators[0].push("strong");
	caller.suggestion.reason.quote = "Rain barrels";
}
{
	const h = harness(gardenSite());
	const verified = await h.runtime().verify(dripRequest);
	assert.equal(verified.kind, "verification");
	if (verified.kind !== "verification") throw new Error("unreachable");
	assert.equal(verified.verification.kind, "verified");
	assert.equal(verified.verification.kind === "verified" && verified.verification.url, SITE + "/guides/drip-irrigation");
	assert.deepEqual(verified.target, { collection: "guides", entryId: id(3) });
	assert.deepEqual(h.methods(), [
		"source.readSource", "candidates.resolveScope", "policy.readPolicy", "targets.readTarget", "source.readSource", "policy.readPolicy",
	], "A verified URL follows one closing source and global policy read");
	assert.deepEqual(h.call("targets", "readTarget").args[0], { collection: "guides", entryId: id(3) });
	assert.equal(h.call("targets", "readTarget").args[2], "policy-1");

	const verify = async (label: string, change: (state: SiteState) => void, expected: unknown, methods?: string[]) => {
		const state = gardenSite();
		change(state);
		const run = harness(state);
		const result = await run.runtime().verify(dripRequest);
		assert.deepEqual(result.kind === "verification" ? result.verification : result, expected, label);
		assert.equal(run.count("candidates", "page"), 0, label);
		assert.ok(run.calls.filter((call) => call.port === "targets").every((call) => call.args[0].entryId === id(3)), label);
		if (methods) assert.deepEqual(run.methods(), methods, label);
	};
	const guide = (state: SiteState) => state.guides.find((item) => item.id === id(3)) as Guide;
	await verify("global policy identity changed", (state) => { state.policy = { kind: "readable", version: "policy-2" }; }, { kind: "stale", reasons: ["policy-changed"] });
	await verify("target policy identity changed", (state) => { guide(state).policy = id(3) + ":policy-2"; }, { kind: "stale", reasons: ["policy-changed"] });
	await verify("target version changed", (state) => { guide(state).version = "entry-v1:2:2026-10-04 13:00:00"; }, { kind: "stale", reasons: ["target-changed"], target: "target-changed" });
	await verify("saved source changed", (state) => { state.sourceVersion = "v2"; }, { kind: "stale", reasons: ["source-version-changed"] });
	await verify("definitions changed", (state) => { state.scopeVersion = "scope-2"; }, { kind: "stale", reasons: ["scope-changed"] });
	await verify("policy unreadable", (state) => { state.policy = { kind: "unreadable" }; }, { kind: "unavailable", reason: "policy-unreadable" },
		["source.readSource", "candidates.resolveScope", "policy.readPolicy"]);
	await verify("scope unreadable", (state) => { state.resolveOverride = () => { throw new Error("Synthetic scope failure"); }; }, { kind: "unavailable", reason: "scope-unavailable" },
		["source.readSource", "candidates.resolveScope", "policy.readPolicy"]);

	// A removed scope never hides an unreadable or unsupported source.
	const taxonomyFind = harness(gardenSite());
	const tagged = resultOf(await taxonomyFind.runtime().find(findRequest({}, { collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["t-water"] } })), "tagged");
	const taggedRequest = { owner: tagged.response.owner, policyVersion: tagged.response.policyVersion, suggestion: tagged.response.suggestions[0] };
	for (const [label, sourceRead, expected] of [
		["unreadable source and removed taxonomy", () => { throw new Error("Synthetic source failure"); }, { kind: "unavailable", reason: "source-unavailable" }],
		["unsupported source and invalid scope", () => ({ kind: "unsupported", reason: "no-portable-text-field" }), { kind: "unavailable", reason: "source-unsupported" }],
		["missing source and invalid scope", () => ({ kind: "missing" }), { kind: "stale", reasons: ["source-missing"] }],
		["readable source and invalid scope", undefined, { kind: "stale", reasons: ["scope-changed"] }],
	] as const) {
		const state = gardenSite({ attached: { topics: [] }, ...(sourceRead ? { sourceRead } : {}) });
		const run = harness(state);
		const result = await run.runtime().verify(taggedRequest);
		assert.deepEqual(result.kind === "verification" ? result.verification : result, expected, label);
		assert.deepEqual(run.methods(), ["source.readSource", "candidates.resolveScope"], label);
	}

	const invalid = harness(gardenSite());
	assert.deepEqual(await invalid.runtime().verify({ ...dripRequest, suggestion: { ...dripSuggestion, target: { ...dripSuggestion.target, title: "" } } }),
		{ kind: "invalid", reason: "request" });
	assert.equal(invalid.calls.length, 0);

	// The caller changes its own request while the exact source read is pending.
	const state = gardenSite();
	const release = gatedSource(state);
	const run = harness(state);
	const caller = structuredClone(dripRequest);
	const pending = run.runtime().verify(caller);
	assert.deepEqual(run.methods(), ["source.readSource"], "The exact source read must be pending");
	mutateCaller(caller);
	release();
	const result = await pending;
	if (result.kind !== "verification") throw new Error("Gated verify: " + JSON.stringify(result));
	assert.equal(result.verification.kind, "verified", "Verify must use the request it validated: " + JSON.stringify(result.verification));
	assert.equal(result.verification.kind === "verified" && result.verification.url, SITE + "/guides/drip-irrigation");
	assert.deepEqual(result.target, { collection: "guides", entryId: id(3) });
	assert.equal(result.ownerKey, dripOwnerKey);
	assert.deepEqual(run.methods(), [
		"source.readSource", "candidates.resolveScope", "policy.readPolicy", "targets.readTarget", "source.readSource", "policy.readPolicy",
	]);
	assert.deepEqual(run.call("targets", "readTarget").args[0], { collection: "guides", entryId: id(3) });
}

{
	// Backing state changes while the chosen target and its URL are pending. The change only edits
	// stored state; nothing in it reads policy, so only the runtime's closing reads can see it.
	const deferredVerify = async (change: (state: SiteState) => void) => {
		const state = gardenSite();
		let reached: () => void = () => {};
		const atTarget = new Promise<void>((resolve) => { reached = resolve; });
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => { release = resolve; });
		state.beforeTarget = async () => {
			reached();
			await gate;
		};
		const run = harness(state);
		const pending = run.runtime().verify(dripRequest);
		await atTarget;
		change(state);
		release();
		const result = await pending;
		if (result.kind !== "verification") throw new Error("Deferred verify: " + JSON.stringify(result));
		return { verification: result.verification, run };
	};
	const closingMethods = ["source.readSource", "candidates.resolveScope", "policy.readPolicy", "targets.readTarget", "source.readSource", "policy.readPolicy"];
	for (const [label, change, expected] of [
		["nothing changed", () => {}, { kind: "verified", url: SITE + "/guides/drip-irrigation", route: undefined }],
		["source saved", (state: SiteState) => { state.sourceVersion = "v2"; }, { kind: "stale", reasons: ["source-version-changed"] }],
		["global noindex written", (state: SiteState) => { state.policy = { kind: "readable", version: "policy-2-noindex" }; }, { kind: "stale", reasons: ["policy-changed"] }],
		["same-value policy rewrite", (state: SiteState) => { state.policy = { kind: "readable", version: "policy-1-revision-2" }; }, { kind: "stale", reasons: ["policy-changed"] }],
		["source saved and policy written", (state: SiteState) => {
			state.sourceVersion = "v2";
			state.policy = { kind: "readable", version: "policy-2" };
		}, { kind: "stale", reasons: ["source-version-changed", "policy-changed"] }],
		["policy unreadable", (state: SiteState) => { state.policy = { kind: "unreadable" }; }, { kind: "unavailable", reason: "policy-unreadable" }],
		["source unreadable", (state: SiteState) => { state.sourceRead = () => { throw new Error("Synthetic source failure"); }; }, { kind: "unavailable", reason: "source-unavailable" }],
		["source unreadable and policy unreadable", (state: SiteState) => {
			state.sourceRead = () => { throw new Error("Synthetic source failure"); };
			state.policy = { kind: "unreadable" };
		}, { kind: "unavailable", reason: "source-unavailable" }],
		["source unsupported", (state: SiteState) => { state.sourceRead = () => ({ kind: "unsupported", reason: "ambiguous-body-field" }); }, { kind: "unavailable", reason: "source-unsupported" }],
		["source deleted", (state: SiteState) => { state.sourceRead = () => ({ kind: "missing" }); }, { kind: "stale", reasons: ["source-missing"] }],
		["source deleted and policy written", (state: SiteState) => {
			state.sourceRead = () => ({ kind: "missing" });
			state.policy = { kind: "readable", version: "policy-2" };
		}, { kind: "stale", reasons: ["source-missing", "policy-changed"] }],
	] as const) {
		const { verification, run } = await deferredVerify(change as (state: SiteState) => void);
		if (expected.kind === "verified") {
			assert.equal(verification.kind, "verified", label + ": " + JSON.stringify(verification));
			assert.equal(verification.kind === "verified" && verification.url, expected.url, label);
		} else assert.deepEqual(verification, expected, label);
		assert.deepEqual(run.methods(), closingMethods, label + ": two source reads, two policy reads, one target");
		assert.equal(run.count("candidates", "page"), 0, label);
		assert.equal(run.count("targets"), 1, label);
	}

	// A paragraph edited in the closing save is checked by the shared engine, never re-anchored.
	const edited = await deferredVerify((state) => {
		state.sourceVersion = "v2";
		state.body = gardenBody().map((item) => item._key === "p1" ? paragraph("p1", "Our notes on drip irrigation explain spacing.") : item);
	});
	assert.deepEqual(edited.verification, { kind: "stale", reasons: ["source-version-changed"] });
}

// ---------------------------------------------------------------------------
// Check saved link: the exact newer saved source only

{
	const withP1 = (children: unknown[], markDefs: unknown[]) =>
		gardenBody().map((item) => item._key === "p1" ? block("p1", children, { markDefs }) : item);
	const tail = " explain spacing for raised beds.";
	const check = async (label: string, patch: Partial<SiteState>, expected: unknown) => {
		const run = harness(gardenSite({ sourceVersion: "v2", ...patch }));
		const result = await run.runtime().checkSaved(dripRequest);
		assert.deepEqual(result.kind === "saved-check" ? result.check : result, expected, label);
		assert.deepEqual(run.methods(), ["source.readSource"], label);
	};
	await check("linked with new span and annotation keys", {
		body: withP1([span("n1", "Our notes on "), span("n2", "drip irrigation", ["lk7"]), span("n3", tail)], [link("lk7", SITE + "/guides/drip-irrigation")]),
	}, { kind: "verified" });
	await check("split across two link annotations", {
		body: withP1([span("m1", "Our notes on "), span("m2", "drip ", ["a1"]), span("m3", "irrigation", ["b2"]), span("m4", tail)],
			[link("a1", "/guides/drip-irrigation"), link("b2", SITE + "/guides/drip-irrigation")]),
	}, { kind: "verified" });
	await check("only part of the anchor linked", {
		body: withP1([span("q1", "Our notes on "), span("q2", "drip ", ["a1"]), span("q3", "irrigation" + tail)], [link("a1", "/guides/drip-irrigation")]),
	}, { kind: "partial" });
	await check("another destination", {
		body: withP1([span("w1", "Our notes on "), span("w2", "drip irrigation", ["a1"]), span("w3", tail)], [link("a1", "/guides/rain-barrels")]),
	}, { kind: "wrong-destination" });
	await check("a used mark without a definition", {
		body: withP1([span("u1", "Our notes on "), span("u2", "drip irrigation", ["zz"]), span("u3", tail)], []),
	}, { kind: "inconclusive", detail: "links-unreadable" });
	await check("not linked yet", {}, { kind: "unlinked" });
	await check("paragraph edited", { body: withP1([span("e1", "Our notes on drip irrigation explain spacing.")], []) }, { kind: "stale", detail: "paragraph-changed" });
	await check("same saved version", { sourceVersion: "v1" }, { kind: "inconclusive", detail: "same-saved-version" });
	await check("unreadable source", { sourceRead: () => { throw new Error("Synthetic source failure"); } }, { kind: "inconclusive", detail: "source-unavailable" });

	// The caller changes its own copied receipt while the newer saved source read is pending.
	const state = gardenSite({
		sourceVersion: "v2",
		body: withP1([span("g1", "Our notes on "), span("g2", "drip irrigation", ["lk7"]), span("g3", tail)], [link("lk7", SITE + "/guides/drip-irrigation")]),
	});
	const release = gatedSource(state);
	const run = harness(state);
	const caller = structuredClone(dripRequest);
	const pending = run.runtime().checkSaved(caller);
	assert.deepEqual(run.methods(), ["source.readSource"], "The exact source read must be pending");
	mutateCaller(caller);
	release();
	const result = await pending;
	if (result.kind !== "saved-check") throw new Error("Gated check: " + JSON.stringify(result));
	assert.deepEqual(result.check, { kind: "verified" }, "Check must use the receipt it validated");
	assert.deepEqual(result.target, { collection: "guides", entryId: id(3) });
	assert.equal(result.ownerKey, dripOwnerKey);
	assert.deepEqual(run.methods(), ["source.readSource"]);
}

// ---------------------------------------------------------------------------
// The 49,152-byte cap covers the whole result, receipt included

{
	const phrases = ["капельный полив томатов", "обрезка яблонь весной", "мульча для клубники", "компост из листьев", "теплица из поликарбоната"];
	const body = phrases.flatMap((phrase, index) => [
		heading("ch" + index, ("раздел " + "заголовок ".repeat(39)).trim()),
		paragraph("cp" + index, (phrase + " " + "длинный пример текста ".repeat(89)).trim()),
	]);
	const site = (pad: number) => gardenSite({
		locale: "ru", body,
		guides: Array.from({ length: 30 }, (_, offset) => offset < 5
			? { id: id(offset + 1), title: (phrases[offset] + " " + "подробное руководство ".repeat(18)).trim(), slug: "g" + offset + "-" + "x".repeat(pad) }
			: { id: id(offset + 1), title: "запись номер " + (offset + 1), slug: "entry-" + (offset + 1) }),
	});
	const request = findRequest({ locale: "ru" });
	const run = async (pad: number, responseBytes?: number) => {
		const state = site(pad);
		const h = harness(state);
		const result = await h.runtime(["guides"], responseBytes).find(request);
		if (result.kind !== "result") return assert.fail("Byte-cap fixture: " + JSON.stringify(result));
		// The frozen engine over the same port answers gives the response before the envelope is counted.
		const ranked = rankLinkSuggestions({ owner: result.response.owner, source: { ...sourceDocument(state), routeUrl: null }, page: h.call("candidates", "page").result });
		if (ranked.kind !== "ranked") return assert.fail("Byte-cap fixture ranking: " + ranked.reason);
		const targets = h.calls.filter((call) => call.port === "targets").map((call) => ({ ...call.args[0], read: call.result }));
		const engine = finalizeLinkSuggestions(ranked, targets, h.call("policy", "readPolicy").result);
		if (engine.kind !== "result") return assert.fail("Byte-cap fixture finalize: " + engine.reason);
		return { result, engine: engine.response, targetReads: targets.length };
	};
	const largest = async (fits: (pad: number) => Promise<boolean>, label: string) => {
		let low = 0;
		let high = 2_000;
		assert.ok(await fits(low), label + ": the byte-cap fixture must start below the budget");
		assert.ok(!(await fits(high)), label + ": the byte-cap fixture must be able to exceed the budget");
		while (high - low > 1) {
			const middle = Math.floor((low + high) / 2);
			if (await fits(middle)) low = middle;
			else high = middle;
		}
		return low;
	};
	const owner = { ...ownerFor(null), source: { ...ownerFor(null).source, locale: "ru" }, scope: { ...ownerFor(null).scope, locale: "ru" } };
	// The search runs against the full envelope without its receipt, so only the receipt can tip it over.
	const withoutReceipt = (engine: LinkSuggestionResponse) => ({ kind: "result", response: engine, next: null });
	const receiptOnly = async (budget: number, label: string) => {
		const option = budget === CAP ? undefined : budget;
		const pad = await largest(async (candidate) => {
			const { engine } = await run(candidate, option);
			return engine.omittedForResponseLimit === 0 && bytes(withoutReceipt(engine)) <= budget;
		}, label);
		const { result, engine, targetReads } = await run(pad, option);
		assert.equal(engine.omittedForResponseLimit, 0, label);
		assert.equal(engine.suggestions.length, 5, label);
		assert.ok(result.next !== null, label + ": the capped page must carry its receipt");
		assert.ok(bytes(withoutReceipt(engine)) <= budget, label + ": without its receipt the untrimmed envelope fits");
		assert.ok(bytes({ ...withoutReceipt(engine), next: result.next }) > budget, label + ": the actual receipt alone must push the untrimmed envelope over the budget");
		assert.ok(result.response.omittedForResponseLimit >= 1, label + ": the receipt must count toward the budget");
		assert.equal(result.response.suggestions.length + result.response.omittedForResponseLimit, 5, label);
		assert.deepEqual(result.response.suggestions, engine.suggestions.slice(0, result.response.suggestions.length), label);
		assert.ok(bytes(result) <= budget, label + ": the whole serialized result exceeded the budget");
		assert.equal(targetReads, 5, label + ": trimming must not read replacement targets");
		accepted(result.response, owner, label);
		return result;
	};
	await receiptOnly(CAP, "default budget");

	// The generic route wraps the result as {success:true,data:result}.
	const wrapped = (value: unknown) => ({ success: true, data: value });
	const reserve = bytes(wrapped(0)) - bytes(0);
	assert.equal(reserve, 24);
	const routeBudget = CAP - reserve;
	const routeReceiptOnly = await receiptOnly(routeBudget, "route budget");
	assert.ok(bytes(wrapped(routeReceiptOnly)) <= CAP);

	// The largest untrimmed result inside the route budget still fits once wrapped; ten more bytes need trimming
	// that the unreserved default would not do, and its wrapped result would pass 49,152 bytes.
	const boundary = await largest(async (candidate) => (await run(candidate, routeBudget)).result.response.omittedForResponseLimit === 0, "wrapped boundary");
	const fitting = await run(boundary, routeBudget);
	assert.equal(fitting.result.response.suggestions.length, 5);
	assert.ok(fitting.result.next !== null);
	assert.ok(bytes(fitting.result) <= routeBudget && bytes(wrapped(fitting.result)) <= CAP);
	assert.equal(fitting.targetReads, 5);
	const trimmed = await run(boundary + 1, routeBudget);
	assert.ok(trimmed.result.response.omittedForResponseLimit >= 1);
	assert.ok(bytes(trimmed.result) <= routeBudget && bytes(wrapped(trimmed.result)) <= CAP);
	assert.equal(trimmed.targetReads, 5);
	const unreserved = await run(boundary + 1);
	assert.equal(unreserved.result.response.omittedForResponseLimit, 0);
	assert.ok(bytes(wrapped(unreserved.result)) > CAP, "Without the reserve the wrapped result would pass the cap");

	// The budget can only lower the cap.
	const absent = { kind: "unavailable", reason: "adapter-absent" } as const;
	for (const responseBytes of [CAP + 1, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "49128"]) {
		assert.throws(() => createLinkSuggestionRuntime({ ports: absent, allowedCollections: [], responseBytes: responseBytes as number }), RangeError, String(responseBytes));
	}
	createLinkSuggestionRuntime({ ports: absent, allowedCollections: [], responseBytes: routeBudget });
}

assert.deepEqual(allForbidden, [], "A port method outside the read contract was touched");
assert.equal(networkCalls, 0, "The runtime reached the network");
globalThis.fetch = realFetch;
console.log("Internal link runtime selfcheck passed");
