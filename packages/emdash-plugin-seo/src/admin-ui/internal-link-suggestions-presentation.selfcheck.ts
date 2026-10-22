import assert from "node:assert/strict";

import {
	LINK_SUGGESTION_LIMITS,
	finalizeLinkSuggestions,
	rankLinkSuggestions,
	validateLinkSuggestionRequest,
	verifyChosenLinkTarget,
	type LinkResolvedTarget,
	type LinkSuggestionOwner,
	type LinkSuggestionResponse,
	type LinkTargetRead,
} from "../internal-link-suggestions.ts";
import { linkExclusionRows, linkPageSummaryText, linkStaleVerdictMessages } from "./internal-link-suggestions-presentation.ts";

const SITE = "https://example.com";
const VERSION = "entry-v1:1:2026-10-04 12:00:00";
const id = (index: number) => "01KG" + String(index).padStart(22, "0");
const OWNER: LinkSuggestionOwner = {
	source: { collection: "posts", entryId: "01KSOURCE00000000000000001", locale: "en", sourceVersion: "v1", revisionId: null, field: "content" },
	scope: { collection: "guides", locale: "en", taxonomy: null, termIds: [], afterId: null, scopeVersion: "scope-1" },
	generation: 1,
};
const TEXT = "Read about drip irrigation, raised beds, compost tea, cover crops, seed saving and soil testing.";
const TITLES = ["Drip irrigation", "Raised beds", "Compost tea", "Cover crops", "Seed saving", "Soil testing"];
const SOURCE = {
	...OWNER.source,
	body: [{ _type: "block", _key: "p1", style: "normal", markDefs: [], children: [{ _type: "span", _key: "p1-s", text: TEXT, marks: [] }] }],
	siteUrl: SITE,
	routeUrl: null,
};

function found(entryId: string, title: string, patch: Partial<LinkResolvedTarget> = {}): LinkTargetRead {
	return {
		kind: "found",
		target: {
			collection: "guides", entryId, locale: "en", status: "published", version: VERSION, title,
			publicUrl: `${SITE}/guides/${title.toLowerCase().replace(/ /gu, "-")}`,
			inScope: true, noindex: false, globalPolicyVersion: "policy-1", targetPolicyVersion: "target-policy-1", ...patch,
		},
	};
}

function respond(titles: readonly string[], nextAfterId: string | null, noindex: ReadonlySet<string> = new Set()): LinkSuggestionResponse {
	const candidates = titles.map((title, index) => ({ collection: "guides", entryId: id(index + 1), locale: "en", version: VERSION, title, excerpt: null, afterId: id(index + 1) }));
	const ranked = rankLinkSuggestions({ owner: OWNER, source: SOURCE, page: { candidates, examinedRows: 40, nextAfterId, exhausted: nextAfterId === null } });
	if (ranked.kind !== "ranked") throw new Error("Fixture ranking refused: " + ranked.reason);
	const outcome = finalizeLinkSuggestions(ranked, ranked.provisional.map(({ candidate }) => ({
		collection: candidate.collection, entryId: candidate.entryId,
		read: found(candidate.entryId, candidate.title, { noindex: noindex.has(candidate.title) }),
	})), { kind: "readable", version: "policy-1" });
	if (outcome.kind !== "result") throw new Error("Fixture finalize refused: " + outcome.reason);
	return outcome.response;
}

const groups: string[] = [];

{
	const counts = "This page examined 40 destination rows; 1 matched the selected scope.";
	const open = respond(TITLES.slice(0, 1), id(40));
	const complete = respond(TITLES.slice(0, 1), null);
	assert.equal(linkPageSummaryText(open.page, false), counts + " More entries remain in this search; Next page continues it.");
	assert.equal(linkPageSummaryText(complete.page, false), counts + " This search is complete. Run Find again to include newer content.");
	const reference = counts + " This search cannot continue from this page. Run Find link suggestions again to start a fresh search from the first page.";
	assert.equal(linkPageSummaryText(open.page, true), reference);
	assert.equal(linkPageSummaryText(complete.page, true), reference, "Even a complete page asks for a fresh Find once it is reference-only");
	groups.push("page summaries");
}

{
	const response = respond(TITLES, id(40), new Set(["Drip irrigation"]));
	assert.equal(response.suggestions.length, LINK_SUGGESTION_LIMITS.displayed - 1, "A destination read excluded a candidate inside the limit");
	assert.deepEqual(linkExclusionRows(response.excluded), [
		{ reason: "display-limit", label: `Over the limit of ${LINK_SUGGESTION_LIMITS.displayed} candidates per page`, count: 1 },
		{ reason: "noindex", label: "Excluded from search", count: 1 },
	]);
	groups.push("display limit wording when fewer suggestions are shown");
}

{
	const response = respond(TITLES.slice(0, 1), id(40));
	const suggestion = response.suggestions[0];
	const request = validateLinkSuggestionRequest({ owner: response.owner, policyVersion: response.policyVersion, suggestion });
	if (!request) throw new Error("The fixture request must validate");
	const verify = (target: LinkTargetRead) => verifyChosenLinkTarget({
		request, source: { kind: "found", document: SOURCE }, target,
		policy: { kind: "readable", version: "policy-1" }, scope: { kind: "current", scopeVersion: "scope-1" },
	});
	const stale = (target: LinkTargetRead) => {
		const verification = verify(target);
		if (verification.kind !== "stale") throw new Error("The fixture must be stale, not " + verification.kind);
		return verification;
	};
	const restart = "Nothing was verified. Run Find link suggestions again.";
	assert.equal(verify(found(suggestion.target.entryId, "Drip irrigation")).kind, "verified");

	const revised = stale(found(suggestion.target.entryId, "Drip irrigation", { title: "Drip irrigation guide", version: "entry-v1:2:2026-10-04 12:05:00" }));
	assert.deepEqual(revised, { kind: "stale", reasons: ["target-changed"], target: "target-changed" });
	assert.deepEqual(linkStaleVerdictMessages(revised), ["The destination changed.", restart]);

	const hidden = stale(found(suggestion.target.entryId, "Drip irrigation", { noindex: true, targetPolicyVersion: "target-policy-2" }));
	assert.deepEqual(hidden, { kind: "stale", reasons: ["policy-changed", "target-changed"], target: "noindex" });
	assert.deepEqual(linkStaleVerdictMessages(hidden), ["Search indexing settings changed.", "The destination changed.", "Destination: Excluded from search.", restart]);

	const missing = stale({ kind: "missing" });
	assert.deepEqual(missing, { kind: "stale", reasons: ["target-changed"], target: "target-missing" });
	assert.deepEqual(linkStaleVerdictMessages(missing), ["The destination changed.", "Destination: Destination missing.", restart]);
	groups.push("one destination-changed explanation with distinct details kept");
}

console.log("Internal link suggestions presentation selfcheck passed: " + groups.length + " groups");
