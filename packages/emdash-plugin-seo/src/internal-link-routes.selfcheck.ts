import assert from "node:assert/strict";

import type { PluginContext } from "emdash";

import { SEO_ADMIN_API_ROUTES } from "./admin-contract.ts";
import {
	LINK_PAGE_REQUEST_MAX_BYTES,
	LINK_ROUTE_RESPONSE_BYTES,
	LINK_SUGGESTION_REQUEST_MAX_BYTES,
	createLinkCommands,
	linkRouteInputWithinBytes,
	strictLinkSuggestionRequest,
	type LinkCommandHost,
} from "./internal-link-routes.ts";
import { createLinkSuggestionRuntime, type LinkPageResult } from "./internal-link-runtime.ts";
import type { LinkSuggestionPorts } from "./internal-link-source.ts";
import { LINK_SUGGESTION_LIMITS, validateLinkSuggestionRequest } from "./internal-link-suggestions.ts";
import defaultEngine, { createSeoEngine } from "./sandbox-entry.ts";

// ---------------------------------------------------------------------------
// An in-memory site behind recording ports and a context whose only surface is
// the exact collection schema read. One log records both, in order.

const SITE = "https://example.com";
const SOURCE_ID = "01KSOURCE00000000000000001";
const VERSION = "entry-v1:1:2026-10-04 12:00:00";
const CAP = LINK_SUGGESTION_LIMITS.responseBytes;
const id = (index: number) => "01KG" + String(index).padStart(22, "0");
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const paragraph = (key: string, text: string) =>
	({ _type: "block", _key: key, style: "normal", markDefs: [], children: [{ _type: "span", _key: key + "-s", text, marks: [] }] });
const heading = (key: string, text: string) => ({ ...paragraph(key, text), style: "h2" });

interface Guide { id: string; title: string; slug: string }
interface Site {
	locale: string;
	body: unknown[];
	guides: Guide[];
	schema: ((slug: string) => unknown) | null;
	sourceMissing: boolean;
}

function gardenSite(patch: Partial<Site> = {}): Site {
	return {
		locale: "en",
		body: [paragraph("p1", "Our notes on drip irrigation explain spacing for raised beds."), paragraph("p2", "Before planting, compare soil testing kits.")],
		guides: Array.from({ length: 40 }, (_, offset) => offset + 1 === 3
			? { id: id(3), title: "Drip irrigation", slug: "drip-irrigation" }
			: { id: id(offset + 1), title: "Bicycle maintenance log " + (offset + 1), slug: "bicycle-log-" + (offset + 1) }),
		schema: (slug) => ({ slug, label: "Guides", hidden: false, routable: true, hasSeo: true, fields: [] }),
		sourceMissing: false,
		...patch,
	};
}

const forbidden: string[] = [];

function recordingPorts(site: Site, log: string[]): LinkSuggestionPorts {
	const port = <K extends keyof LinkSuggestionPorts>(name: K, methods: Record<string, (...args: any[]) => unknown>): LinkSuggestionPorts[K] => new Proxy({}, {
		get(_target, key) {
			if (typeof key !== "string") return undefined;
			const method = methods[key];
			if (method) return async (...args: unknown[]) => {
				log.push(name + "." + key);
				return method(...args);
			};
			forbidden.push(name + "." + key);
			return undefined;
		},
	}) as LinkSuggestionPorts[K];
	return {
		source: port("source", {
			readSource: (ref: any) => site.sourceMissing || ref.entryId !== SOURCE_ID ? { kind: "missing" } : {
				kind: "found",
				document: { collection: "posts", entryId: SOURCE_ID, locale: site.locale, sourceVersion: "v1", revisionId: null, field: "content", body: site.body, siteUrl: SITE, routeUrl: null },
			},
		}),
		candidates: port("candidates", {
			resolveScope: (request: any, allowed: readonly string[]) => !allowed.includes(request.collection)
				? { kind: "invalid", reason: "collection-unavailable" }
				: { kind: "resolved", scope: { collection: request.collection, locale: request.locale, taxonomy: null, termIds: [], scopeVersion: "scope-1", upperId: site.guides[site.guides.length - 1].id } },
			page: (scope: any, afterId: string | null, budget: any) => {
				const window = site.guides.filter((guide) => guide.id <= scope.upperId && (afterId === null || guide.id > afterId));
				const rows = window.slice(0, budget.candidateRows).slice(0, budget.scopeMatches);
				const exhausted = rows.length === window.length;
				return {
					candidates: rows.map((row) => ({ collection: scope.collection, entryId: row.id, locale: scope.locale, version: VERSION, title: row.title, excerpt: null, afterId: row.id })),
					examinedRows: rows.length,
					nextAfterId: exhausted ? null : rows[rows.length - 1].id,
					exhausted,
				};
			},
		}),
		targets: port("targets", {
			readTarget: (ref: any, scope: any, globalPolicyVersion: string) => {
				const row = site.guides.find((guide) => guide.id === ref.entryId);
				return row ? {
					kind: "found",
					target: {
						collection: scope.collection, entryId: row.id, locale: scope.locale, status: "published", version: VERSION, title: row.title,
						publicUrl: SITE + "/guides/" + row.slug, inScope: true, noindex: false, globalPolicyVersion, targetPolicyVersion: row.id + ":policy-1",
					},
				} : { kind: "missing" };
			},
		}),
		policy: port("policy", { readPolicy: () => ({ kind: "readable", version: "policy-1" }) }),
	};
}

function context(site: Site, log: string[]): PluginContext {
	const parts: Record<string, unknown> = {
		site: { name: "Garden", url: SITE, locale: site.locale },
		log: { warn() {}, info() {}, error() {}, debug() {} },
	};
	if (site.schema) {
		const read = site.schema;
		parts.schema = new Proxy({}, {
			get(_target, key) {
				if (key === "getCollection") return async (slug: string) => {
					log.push("schema.getCollection");
					return read(slug);
				};
				if (typeof key === "string" && key !== "then") forbidden.push("schema." + key);
				return undefined;
			},
		});
	}
	return new Proxy(parts, {
		get(target, key) {
			if (typeof key !== "string" || key === "then") return undefined;
			if (!Object.hasOwn(target, key) && key !== "schema") forbidden.push("ctx." + key);
			return target[key];
		},
	}) as unknown as PluginContext;
}

function recordingHost(site: Site, log: string[]) {
	const opened: LinkSuggestionPorts[] = [];
	const host: LinkCommandHost = {
		open(_ctx) {
			log.push("host.open");
			const ports = recordingPorts(site, log);
			opened.push(ports);
			return ports;
		},
	};
	return { host, opened };
}

function setup(patch: Partial<Site> = {}) {
	const site = gardenSite(patch);
	const log: string[] = [];
	const { host, opened } = recordingHost(site, log);
	return { site, log, opened, ctx: context(site, log), commands: createLinkCommands(host) };
}

const findRequest = (destination: unknown = { collection: "guides", taxonomy: null }) => ({
	source: { collection: "posts", entryId: SOURCE_ID, locale: "en", sourceVersion: "v1" },
	generation: 3,
	destination,
});

function resultOf(value: LinkPageResult, label: string) {
	if (value.kind !== "result") return assert.fail(label + ": expected a result, got " + JSON.stringify(value));
	return value;
}

let networkCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
	networkCalls += 1;
	throw new Error("Network access is not allowed in the link route selfcheck");
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Constants and route names

assert.equal(LINK_PAGE_REQUEST_MAX_BYTES, 16_384);
assert.equal(LINK_SUGGESTION_REQUEST_MAX_BYTES, 49_152, "Verify and Check accept what the shared validator accepts");
assert.equal(LINK_ROUTE_RESPONSE_BYTES, 49_128);
assert.equal(bytes({ success: true, data: 0 }) - bytes(0), CAP - LINK_ROUTE_RESPONSE_BYTES, "The reserve is the host's success wrapper");
for (const route of ["find-link-suggestions", "next-link-suggestions", "verify-link-suggestion", "check-saved-link"]) {
	assert.ok((SEO_ADMIN_API_ROUTES as readonly string[]).includes(route), route);
}
const SIX_DECORATORS = ["em", "strike-through", "strong", "subscript", "superscript", "underline"];
const withExtra = (value: unknown, path: readonly string[]) => {
	const copy = structuredClone(value) as any;
	let target = copy;
	for (const key of path) target = target[key];
	target.unexpected = true;
	return copy;
};

// ---------------------------------------------------------------------------
// Find, Verify and Check through the commands, with the destination gate after the source

let suggestionRequest: any;
let receipt: unknown;
{
	const { log, opened, ctx, commands } = setup();
	const found = resultOf(await commands.find(findRequest(), ctx), "find");
	assert.deepEqual(log.slice(0, 5), ["host.open", "source.readSource", "schema.getCollection", "candidates.resolveScope", "candidates.page"]);
	assert.equal(opened.length, 1);
	const suggestion = found.response.suggestions.find((item) => item.target.entryId === id(3));
	assert.ok(suggestion, "The garden fixture must suggest Drip irrigation");
	assert.ok(found.next, "A non-exhausted page carries its receipt");
	suggestionRequest = { owner: found.response.owner, policyVersion: found.response.policyVersion, suggestion };
	receipt = found.next;

	log.length = 0;
	const verified = await commands.verify(structuredClone(suggestionRequest), ctx);
	assert.equal(verified.kind === "verification" && verified.verification.kind, "verified", JSON.stringify(verified));
	assert.deepEqual(log, [
		"host.open", "source.readSource", "schema.getCollection", "candidates.resolveScope", "policy.readPolicy", "targets.readTarget",
		"source.readSource", "policy.readPolicy",
	]);

	log.length = 0;
	const checked = await commands.checkSaved(structuredClone(suggestionRequest), ctx);
	assert.equal(checked.kind, "saved-check");
	assert.deepEqual(log, ["host.open", "source.readSource"], "Check saved link reads the exact source only");

	log.length = 0;
	const next = resultOf(await commands.next({ generation: 3, receipt }, ctx), "next");
	assert.equal(next.response.owner.scope.afterId, (receipt as { afterId: string }).afterId);
	assert.deepEqual(log.slice(0, 4), ["host.open", "source.readSource", "schema.getCollection", "candidates.resolveScope"]);
	assert.equal(opened.length, 4, "Every command opens fresh ports");
	assert.equal(new Set(opened).size, 4);
}

{
	// Check saved link never needs the schema surface at all.
	const { log, ctx, commands } = setup({ schema: null });
	assert.equal((await commands.checkSaved(structuredClone(suggestionRequest), ctx)).kind, "saved-check");
	assert.deepEqual(log, ["host.open", "source.readSource"]);
}

// ---------------------------------------------------------------------------
// Without a host: an invalid input is still invalid, a valid one is adapter-absent, nothing is read

{
	const site = gardenSite();
	const log: string[] = [];
	const ctx = context(site, log);
	const absent = createLinkCommands(null);
	const adapterAbsent = { kind: "unavailable", reason: "adapter-absent" };
	assert.deepEqual(await absent.find(findRequest(), ctx), adapterAbsent);
	assert.deepEqual(await absent.next({ generation: 3, receipt }, ctx), adapterAbsent);
	assert.deepEqual(await absent.verify(structuredClone(suggestionRequest), ctx), adapterAbsent);
	assert.deepEqual(await absent.checkSaved(structuredClone(suggestionRequest), ctx), adapterAbsent);
	for (const input of [{ unexpected: true }, "not an object", null, [], 7]) {
		assert.deepEqual(await absent.find(input, ctx), { kind: "invalid", reason: "request" }, "find " + JSON.stringify(input));
		assert.deepEqual(await absent.next(input, ctx), { kind: "invalid", reason: "receipt" }, "next " + JSON.stringify(input));
		assert.deepEqual(await absent.verify(input, ctx), { kind: "invalid", reason: "request" }, "verify " + JSON.stringify(input));
		assert.deepEqual(await absent.checkSaved(input, ctx), { kind: "invalid", reason: "request" }, "check " + JSON.stringify(input));
	}
	assert.deepEqual(await absent.find(withExtra(findRequest(), ["destination"]), ctx), { kind: "invalid", reason: "request" });
	assert.deepEqual(await absent.next(withExtra({ generation: 3, receipt }, ["receipt", "scope"]), ctx), { kind: "invalid", reason: "receipt" });
	for (const path of [["suggestion", "target"], ["suggestion", "anchor", "occurrence"], ["owner", "source"]] as const) {
		assert.deepEqual(await absent.verify(withExtra(suggestionRequest, path), ctx), { kind: "invalid", reason: "request" }, path.join("."));
		assert.deepEqual(await absent.checkSaved(withExtra(suggestionRequest, path), ctx), { kind: "invalid", reason: "request" }, path.join("."));
	}
	assert.deepEqual(log, [], "Without a host nothing is opened or read, not even the schema");
}

// ---------------------------------------------------------------------------
// Transport strictness: every object level, before the host is opened

{
	const withoutKey = (value: unknown, path: readonly string[], key: string) => {
		const copy = structuredClone(value) as any;
		let target = copy;
		for (const step of path) target = target[step];
		delete target[key];
		return copy;
	};
	const levels: readonly (readonly string[])[] = [
		[], ["owner"], ["owner", "source"], ["owner", "scope"], ["suggestion"], ["suggestion", "target"],
		["suggestion", "anchor"], ["suggestion", "anchor", "occurrence"], ["suggestion", "reason"],
	];
	const { log, ctx, commands } = setup();
	for (const path of levels) {
		const extra = withExtra(suggestionRequest, path);
		assert.equal(strictLinkSuggestionRequest(extra), null, "extra key at " + path.join("."));
		assert.deepEqual(await commands.verify(extra, ctx), { kind: "invalid", reason: "request" }, "verify " + path.join("."));
		assert.deepEqual(await commands.checkSaved(extra, ctx), { kind: "invalid", reason: "request" }, "check " + path.join("."));
	}
	// The shared validator alone tolerates these nested extras; the transport boundary is what refuses them.
	for (const path of [["suggestion", "target"], ["suggestion", "anchor", "occurrence"], ["owner", "source"]] as const) {
		assert.ok(validateLinkSuggestionRequest(withExtra(suggestionRequest, path)), path.join("."));
	}
	for (const [path, key] of [[["suggestion", "anchor"], "heading"], [["owner", "scope"], "afterId"], [[], "policyVersion"]] as const) {
		assert.deepEqual(await commands.verify(withoutKey(suggestionRequest, path, key), ctx), { kind: "invalid", reason: "request" }, "missing " + key);
	}
	for (const input of [null, [], "request", 7, structuredClone(suggestionRequest).owner]) {
		assert.deepEqual(await commands.verify(input, ctx), { kind: "invalid", reason: "request" });
		assert.deepEqual(await commands.checkSaved(input, ctx), { kind: "invalid", reason: "request" });
	}
	for (const input of [
		{ ...findRequest(), unexpected: true },
		withExtra(findRequest(), ["source"]),
		withExtra(findRequest(), ["destination"]),
		withExtra(findRequest({ collection: "guides", taxonomy: { taxonomy: "topics", termIds: ["t-water"] } }), ["destination", "taxonomy"]),
	]) assert.deepEqual(await commands.find(input, ctx), { kind: "invalid", reason: "request" });
	for (const input of [
		{ generation: 3, receipt, unexpected: true },
		withExtra({ generation: 3, receipt }, ["receipt"]),
		withExtra({ generation: 3, receipt }, ["receipt", "source"]),
		withExtra({ generation: 3, receipt }, ["receipt", "scope"]),
	]) assert.deepEqual(await commands.next(input, ctx), { kind: "invalid", reason: "receipt" });
	assert.deepEqual(log, [], "No invalid input opens the host or reads the schema");
}

// ---------------------------------------------------------------------------
// Per-command bounds count UTF-8 bytes of the parsed JSON input

{
	// Find and Next: 16,384 bytes. Verify and Check: 49,152 bytes.
	assert.ok(linkRouteInputWithinBytes("é".repeat(8_191), LINK_PAGE_REQUEST_MAX_BYTES), "8,191 two-byte characters and two quotes are 16,384 bytes");
	assert.ok(!linkRouteInputWithinBytes("é".repeat(8_191) + "a", LINK_PAGE_REQUEST_MAX_BYTES), "One more byte passes the Find and Next bound");
	assert.ok(linkRouteInputWithinBytes("é".repeat(24_575), LINK_SUGGESTION_REQUEST_MAX_BYTES), "24,575 two-byte characters and two quotes are 49,152 bytes");
	assert.ok(!linkRouteInputWithinBytes("é".repeat(24_575) + "a", LINK_SUGGESTION_REQUEST_MAX_BYTES), "One more byte passes the Verify and Check bound");
	assert.ok(!linkRouteInputWithinBytes(10n, LINK_SUGGESTION_REQUEST_MAX_BYTES), "Values JSON cannot encode are refused");

	const oversizedFind = { ...findRequest(), source: { ...findRequest().source, sourceVersion: "é".repeat(8_200) } };
	const oversizedNext = { generation: 3, receipt: { ...(receipt as object), afterId: "é".repeat(8_200) } };
	const present = setup();
	const absentLog: string[] = [];
	for (const [commands, log, ctx] of [
		[present.commands, present.log, present.ctx],
		[createLinkCommands(null), absentLog, context(gardenSite(), absentLog)],
	] as const) {
		assert.deepEqual(await commands.find(oversizedFind, ctx), { kind: "invalid", reason: "request" });
		assert.deepEqual(await commands.next(oversizedNext, ctx), { kind: "invalid", reason: "receipt" });
		assert.deepEqual(log, [], "An oversized Find or Next input opens and reads nothing");
	}

	// A suggestion request the shared validator accepts, grown to exactly 49,152 bytes with two-byte characters.
	const sized = (length: number, quote: string) => {
		const copy = structuredClone(suggestionRequest);
		const text = "a".repeat(length);
		Object.assign(copy.suggestion.anchor, {
			text, paragraph: text, start: 0, end: length, paragraphStart: 0, paragraphEnd: length,
			decorators: Array.from({ length }, () => [...SIX_DECORATORS]),
		});
		copy.suggestion.reason.quote = quote;
		return copy;
	};
	const perCharacter = bytes(sized(2, "q")) - bytes(sized(1, "q"));
	const length = Math.floor((LINK_SUGGESTION_REQUEST_MAX_BYTES - 1_500 - bytes(sized(0, "q"))) / perCharacter);
	const remaining = LINK_SUGGESTION_REQUEST_MAX_BYTES - bytes(sized(length, ""));
	assert.ok(length > 0 && length <= LINK_SUGGESTION_LIMITS.paragraphChars && remaining > 0 && remaining < 2 * LINK_SUGGESTION_LIMITS.excerptChars, "The sized fixture must fit its limits");
	const quote = "é".repeat(Math.floor(remaining / 2)) + (remaining % 2 === 1 ? "q" : "");
	const exact = sized(length, quote);
	const over = sized(length, quote + "q");
	assert.equal(bytes(exact), LINK_SUGGESTION_REQUEST_MAX_BYTES);
	assert.equal(bytes(over), LINK_SUGGESTION_REQUEST_MAX_BYTES + 1);
	assert.ok(JSON.stringify(exact).length < LINK_SUGGESTION_REQUEST_MAX_BYTES, "The bound is bytes, not UTF-16 units");
	assert.ok(validateLinkSuggestionRequest(exact), "Exactly the bound is valid for the shared validator");
	assert.equal(validateLinkSuggestionRequest(over), null, "The route bound is the shared validator's own limit");

	const { log, ctx, commands } = setup();
	assert.deepEqual(await commands.verify(over, ctx), { kind: "invalid", reason: "request" });
	assert.deepEqual(await commands.checkSaved(over, ctx), { kind: "invalid", reason: "request" });
	assert.deepEqual(log, [], "An oversized input opens nothing");
	assert.equal((await commands.verify(exact, ctx)).kind, "verification");
	assert.equal((await commands.checkSaved(exact, ctx)).kind, "saved-check");
	assert.equal(log.filter((entry) => entry === "host.open").length, 2, "Exactly the bound is accepted");

	const absent = createLinkCommands(null);
	assert.deepEqual(await absent.verify(exact, ctx), { kind: "unavailable", reason: "adapter-absent" });
	assert.deepEqual(await absent.checkSaved(exact, ctx), { kind: "unavailable", reason: "adapter-absent" });
	assert.deepEqual(await absent.verify(over, ctx), { kind: "invalid", reason: "request" });
	assert.deepEqual(await absent.checkSaved(over, ctx), { kind: "invalid", reason: "request" });
}

{
	// A real Find suggestion whose decorated anchor passes 16 KiB is submitted unchanged to Verify and Check.
	const words = [
		"Donaudampfschifffahrtsgesellschaftskapitän", "Rindfleischetikettierungsüberwachungsaufgaben",
		"Grundstücksverkehrsgenehmigungszuständigkeit", "Kraftfahrzeughaftpflichtversicherungsbeiträge",
		"Telekommunikationsüberwachungsverordnungen", "Arbeiterunfallversicherungsgesetzesnovellen",
		"Straßenbahnhaltestellenbeleuchtungsanlagen", "Bundesausbildungsförderungsgesetzesänderung",
	];
	const phrase = words.join(" ");
	const body = [{
		_type: "block", _key: "d1", style: "normal", markDefs: [],
		children: [
			{ _type: "span", _key: "d1-a", text: "Der Bericht über ", marks: [] },
			{ _type: "span", _key: "d1-b", text: phrase, marks: [...SIX_DECORATORS] },
			{ _type: "span", _key: "d1-c", text: " erklärt die Abläufe.", marks: [] },
		],
	}];
	const guides = gardenSite().guides.map((guide) => guide.id === id(3) ? { id: id(3), title: phrase, slug: "lange-woerter" } : guide);
	const { log, ctx, commands } = setup({ locale: "de", body, guides });
	const found = resultOf(await commands.find({ ...findRequest(), source: { ...findRequest().source, locale: "de" } }, ctx), "decorated find");
	assert.ok(bytes(found) <= LINK_ROUTE_RESPONSE_BYTES, "The decorated result fits the route budget");
	const decorated = found.response.suggestions.find((item) => item.target.entryId === id(3));
	assert.ok(decorated, "The decorated phrase must be suggested");
	assert.equal(decorated.anchor.text, phrase);
	assert.ok(decorated.anchor.decorators.length === phrase.length &&
		decorated.anchor.decorators.every((set) => JSON.stringify(set) === JSON.stringify(SIX_DECORATORS)), "Every anchor character carries its saved decorators");
	const chosen = { owner: found.response.owner, policyVersion: found.response.policyVersion, suggestion: decorated };
	assert.ok(bytes(chosen) > LINK_PAGE_REQUEST_MAX_BYTES && bytes(chosen) <= LINK_SUGGESTION_REQUEST_MAX_BYTES, "The chosen request is " + bytes(chosen) + " bytes");
	log.length = 0;
	const verified = await commands.verify(chosen, ctx);
	assert.equal(verified.kind === "verification" && verified.verification.kind, "verified", JSON.stringify(verified).slice(0, 300));
	const checked = await commands.checkSaved(chosen, ctx);
	assert.deepEqual(checked.kind === "saved-check" && checked.check, { kind: "inconclusive", detail: "same-saved-version" });
	assert.equal(log.filter((entry) => entry === "host.open").length, 2, "Both unchanged submissions reached the host");
}

// ---------------------------------------------------------------------------
// The destination gate: fresh exact schema, visible and routable

{
	const gate = async (schema: Site["schema"], label: string, expected: unknown) => {
		const { log, ctx, commands } = setup({ schema });
		assert.deepEqual(await commands.find(findRequest(), ctx), expected, label);
		assert.ok(!log.includes("candidates.resolveScope") && !log.includes("candidates.page") && !log.includes("targets.readTarget"), label + ": no scope, page or target read");
		return log;
	};
	const collectionUnavailable = { kind: "invalid", reason: "collection-unavailable" };
	const scopeUnavailable = { kind: "unavailable", reason: "scope-unavailable" };
	const base = (slug: string) => ({ slug, label: "Guides", hidden: false, routable: true, hasSeo: true, fields: [] });
	assert.deepEqual(await gate(() => null, "missing collection", collectionUnavailable), ["host.open", "source.readSource", "schema.getCollection"]);
	await gate((slug) => ({ ...base(slug), hidden: true }), "hidden collection", collectionUnavailable);
	await gate((slug) => ({ ...base(slug), routable: false }), "unroutable collection", collectionUnavailable);
	await gate((slug) => ({ ...base(slug), hidden: undefined }), "missing hidden flag", scopeUnavailable);
	await gate((slug) => ({ ...base(slug), routable: "yes" }), "malformed routable flag", scopeUnavailable);
	await gate(() => base("pages"), "another collection's schema", scopeUnavailable);
	await gate(() => { throw new Error("Synthetic schema failure"); }, "schema failure", scopeUnavailable);
	await gate(() => "guides", "non-object schema", scopeUnavailable);
	assert.deepEqual(await gate(null, "no schema capability", scopeUnavailable), ["host.open", "source.readSource"]);

	// Core SEO disabled is still an eligible destination; nothing else gates it here.
	const disabled = setup({ schema: (slug) => ({ ...base(slug), hasSeo: false }) });
	resultOf(await disabled.commands.find(findRequest(), disabled.ctx), "core SEO disabled");
	assert.ok(disabled.log.includes("candidates.resolveScope"));

	// The source keeps its precedence over the gate.
	const missing = setup({ sourceMissing: true, schema: (slug) => ({ ...base(slug), hidden: true }) });
	assert.deepEqual(await missing.commands.find(findRequest(), missing.ctx), { kind: "stale", reason: "source-missing" });
	assert.ok(!missing.log.includes("schema.getCollection"));

	// Next and Verify keep the runtime's names for a refused or unreadable destination.
	const hiddenNext = setup({ schema: (slug) => ({ ...base(slug), hidden: true }) });
	assert.deepEqual(await hiddenNext.commands.next({ generation: 3, receipt }, hiddenNext.ctx), { kind: "stale", reason: "scope-changed" });
	assert.ok(!hiddenNext.log.includes("candidates.page"));
	const hiddenVerify = setup({ schema: (slug) => ({ ...base(slug), hidden: true }) });
	const refused = await hiddenVerify.commands.verify(structuredClone(suggestionRequest), hiddenVerify.ctx);
	assert.deepEqual(refused.kind === "verification" && refused.verification, { kind: "stale", reasons: ["scope-changed"] });
	assert.ok(!hiddenVerify.log.includes("targets.readTarget") && !hiddenVerify.log.includes("policy.readPolicy"));
	const unreadableVerify = setup({ schema: () => { throw new Error("Synthetic schema failure"); } });
	const unreadable = await unreadableVerify.commands.verify(structuredClone(suggestionRequest), unreadableVerify.ctx);
	assert.deepEqual(unreadable.kind === "verification" && unreadable.verification, { kind: "unavailable", reason: "scope-unavailable" });
	assert.ok(!unreadableVerify.log.includes("targets.readTarget"));

	// The gate reads fresh metadata on every command; nothing is cached.
	let hidden = false;
	const toggling = setup({ schema: (slug) => ({ ...base(slug), hidden }) });
	resultOf(await toggling.commands.find(findRequest(), toggling.ctx), "visible");
	hidden = true;
	assert.deepEqual(await toggling.commands.find(findRequest(), toggling.ctx), collectionUnavailable);
	assert.equal(toggling.log.filter((entry) => entry === "schema.getCollection").length, 2);
}

// ---------------------------------------------------------------------------
// Per-engine closures through createSeoEngine

{
	const route = (engine: typeof defaultEngine, name: string) => (engine.routes as Record<string, any>)[name];
	const limits: Record<string, number> = {
		"find-link-suggestions": LINK_PAGE_REQUEST_MAX_BYTES,
		"next-link-suggestions": LINK_PAGE_REQUEST_MAX_BYTES,
		"verify-link-suggestion": LINK_SUGGESTION_REQUEST_MAX_BYTES,
		"check-saved-link": LINK_SUGGESTION_REQUEST_MAX_BYTES,
	};
	const validInputs: Record<string, () => unknown> = {
		"find-link-suggestions": () => findRequest(),
		"next-link-suggestions": () => ({ generation: 3, receipt }),
		"verify-link-suggestion": () => structuredClone(suggestionRequest),
		"check-saved-link": () => structuredClone(suggestionRequest),
	};
	const names = Object.keys(limits);
	for (const name of names) {
		const declaration = route(defaultEngine, name);
		assert.equal(declaration.permission, "plugins:manage", name);
		assert.deepEqual(declaration.methods, ["POST"], name);
		assert.deepEqual(declaration.request, { body: "json", maxBytes: limits[name] }, name);
		assert.equal(declaration.public, undefined, name);
	}
	const first = setup();
	const second = setup();
	const engineA = createSeoEngine(undefined, { internalLinks: recordingHost(first.site, first.log).host });
	const engineB = createSeoEngine(undefined, { internalLinks: recordingHost(second.site, second.log).host });
	assert.notEqual(engineA, defaultEngine);
	assert.equal(createSeoEngine(), defaultEngine, "Without injected hosts the default engine is returned");

	const invoke = (engine: typeof defaultEngine, name: string, input: unknown, ctx: PluginContext) => route(engine, name).handler({ input }, ctx);
	resultOf(await invoke(engineA, "find-link-suggestions", findRequest(), first.ctx), "engine A");
	assert.equal(first.log.filter((entry) => entry === "host.open").length, 1);
	assert.equal(second.log.length, 0, "Engine A never reaches engine B's host");
	resultOf(await invoke(engineB, "find-link-suggestions", findRequest(), second.ctx), "engine B");
	assert.equal(first.log.filter((entry) => entry === "host.open").length, 1, "Engine B never reaches engine A's host");
	assert.equal(second.log.filter((entry) => entry === "host.open").length, 1);

	const before = first.log.length + second.log.length;
	for (const name of names) {
		assert.deepEqual(await invoke(defaultEngine, name, validInputs[name](), first.ctx), { kind: "unavailable", reason: "adapter-absent" }, name);
		assert.equal((await invoke(defaultEngine, name, { unexpected: true }, first.ctx)).kind, "invalid", name + ": invalid input is refused without a host");
		assert.equal(route(engineA, name).request.maxBytes, limits[name], name);
	}
	assert.equal(first.log.length + second.log.length, before, "The default engine reads nothing");
}

// ---------------------------------------------------------------------------
// The fixed 49,128-byte budget keeps the wrapped response within 49,152 bytes

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
	const request = { ...findRequest(), source: { ...findRequest().source, locale: "ru" } };
	const viaRoute = async (pad: number) => {
		const fixture = site(pad);
		const log: string[] = [];
		const result = resultOf(await createLinkCommands(recordingHost(fixture, log).host).find(request, context(fixture, log)), "route budget");
		return { result, targetReads: log.filter((entry) => entry === "targets.readTarget").length };
	};
	const viaDefault = async (pad: number) => {
		const fixture = site(pad);
		const runtime = createLinkSuggestionRuntime({ ports: { kind: "available", ports: recordingPorts(fixture, []) }, allowedCollections: ["guides"] });
		return resultOf(await runtime.find(request), "default budget");
	};
	let low = 0;
	let high = 2_000;
	const fits = async (pad: number) => (await viaRoute(pad)).result.response.omittedForResponseLimit === 0;
	assert.ok(await fits(low), "The budget fixture must start below the route budget");
	assert.ok(!(await fits(high)), "The budget fixture must be able to exceed the route budget");
	while (high - low > 1) {
		const middle = Math.floor((low + high) / 2);
		if (await fits(middle)) low = middle;
		else high = middle;
	}
	const fitting = await viaRoute(low);
	assert.ok(bytes(fitting.result) <= LINK_ROUTE_RESPONSE_BYTES && bytes({ success: true, data: fitting.result }) <= CAP);
	assert.equal(fitting.targetReads, 5);
	const trimmed = await viaRoute(low + 1);
	assert.ok(trimmed.result.response.omittedForResponseLimit >= 1, "Ten more bytes trim at the route budget");
	assert.ok(trimmed.result.next !== null, "The receipt is kept");
	assert.ok(bytes({ success: true, data: trimmed.result }) <= CAP);
	assert.equal(trimmed.targetReads, 5, "Trimming reads no replacement target");
	const unreserved = await viaDefault(low + 1);
	assert.equal(unreserved.response.omittedForResponseLimit, 0);
	assert.ok(bytes({ success: true, data: unreserved }) > CAP, "Without the reserve the wrapped response would pass 49,152 bytes");
}

assert.deepEqual(forbidden, [], "A forbidden port, schema or context surface was touched");
assert.equal(networkCalls, 0, "The link routes reached the network");
globalThis.fetch = realFetch;
console.log("Internal link routes selfcheck passed");
