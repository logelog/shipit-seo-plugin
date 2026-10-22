import assert from "node:assert/strict";

import { linkScopeCheck, LINK_PORT_BUDGETS } from "./internal-link-source.ts";
import {
	LINK_PARTIAL_COVERAGE_LIMITATION,
	LINK_SUGGESTION_LIMITS,
	LINK_SUGGESTION_SAVED_SOURCE_NOTICE,
	acceptLinkSuggestionResponse,
	checkSavedLink,
	finalizeLinkSuggestions,
	linkCopyValue,
	linkSiteBase,
	linkSuggestionOwnerKey,
	normalizeLinkHref,
	rankLinkSuggestions,
	validateLinkSuggestionOwner,
	validateLinkSuggestionRequest,
	verifyChosenLinkTarget,
	type LinkRanked,
	type LinkSuggestionOutcome,
	type LinkSuggestionRequest,
	type LinkSuggestionResponse,
	type LinkTargetRead,
} from "./internal-link-suggestions.ts";

const SITE = "https://example.com";
let generatedKey = 0;
const span = (text: string, marks: string[] = [], key = `s${++generatedKey}`): any => ({ _type: "span", _key: key, text, marks });
const block = (key: string, children: any[], extra: Record<string, unknown> = {}): any =>
	({ _type: "block", _key: key, style: "normal", markDefs: [], children, ...extra });
const paragraph = (key: string, text: string, extra: Record<string, unknown> = {}): any => block(key, [span(text)], extra);
const heading = (key: string, text: string): any => block(key, [span(text)], { style: "h2" });
const link = (key: string, href: unknown): any => ({ _type: "link", _key: key, href });

function owner(patch: { source?: Record<string, unknown>; scope?: Record<string, unknown>; generation?: number } = {}): any {
	return {
		source: { collection: "posts", entryId: "src", locale: "en", sourceVersion: "v1", revisionId: null, field: "content", ...patch.source },
		scope: { collection: "guides", locale: "en", taxonomy: null, termIds: [], afterId: null, scopeVersion: "scope-1", ...patch.scope },
		generation: patch.generation ?? 1,
	};
}
const source = (body: unknown, patch: Record<string, unknown> = {}): any => ({
	collection: "posts", entryId: "src", locale: "en", sourceVersion: "v1", revisionId: null, field: "content",
	body, siteUrl: SITE, routeUrl: null, ...patch,
});
const candidate = (entryId: string, title: string, excerpt: string | null = null, patch: Record<string, unknown> = {}): any => ({
	collection: "guides", entryId, locale: "en", version: `${entryId}-v1`, title, excerpt, afterId: entryId, ...patch,
});
const page = (candidates: any[], patch: Record<string, unknown> = {}): any =>
	({ candidates, examinedRows: candidates.length, nextAfterId: null, exhausted: true, ...patch });
const POLICY = { kind: "readable", version: "policy-1" } as const;
const found = (item: any, patch: Record<string, unknown> = {}): LinkTargetRead => ({
	kind: "found",
	target: {
		collection: item.collection, entryId: item.entryId, locale: item.locale, status: "published", version: item.version,
		title: item.title, publicUrl: `${SITE}/guides/${item.entryId}`, inScope: true, noindex: false,
		globalPolicyVersion: "policy-1", targetPolicyVersion: `${item.entryId}-policy-1`,
		...patch,
	} as any,
});

function ranked(body: unknown, candidates: any[], options: { owner?: any; source?: Record<string, unknown>; page?: Record<string, unknown> } = {}): LinkRanked {
	const result = rankLinkSuggestions({ owner: options.owner ?? owner(), source: source(body, options.source), page: page(candidates, options.page) });
	if (result.kind !== "ranked") return assert.fail(`expected a ranked result, got ${result.reason}`);
	return result;
}
function refusal(body: unknown, candidates: any[], options: { owner?: any; source?: Record<string, unknown>; page?: any } = {}): string {
	const result = rankLinkSuggestions({
		owner: options.owner ?? owner(),
		source: source(body, options.source),
		page: options.page ?? page(candidates),
	});
	return result.kind === "refused" ? result.reason : "ranked";
}
function finalize(rank: LinkRanked, reads: Record<string, LinkTargetRead> = {}, policy: any = POLICY): LinkSuggestionOutcome {
	return finalizeLinkSuggestions(rank, rank.provisional.map((item) => ({
		collection: item.candidate.collection,
		entryId: item.candidate.entryId,
		read: reads[item.candidate.entryId] ?? found(item.candidate),
	})), policy);
}
function respond(body: unknown, candidates: any[], reads: Record<string, LinkTargetRead> = {}, options: { owner?: any; source?: Record<string, unknown> } = {}): LinkSuggestionResponse {
	const outcome = finalize(ranked(body, candidates, options), reads);
	if (outcome.kind !== "result") return assert.fail(`expected a response, got ${outcome.reason}`);
	return outcome.response;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

// ---- Shared href normalizer ----
{
	const base = linkSiteBase(SITE, `${SITE}/blog/post/`)!;
	const bare = linkSiteBase(SITE, null)!;
	const route = (href: unknown, on = base) => {
		const result = normalizeLinkHref(href, on);
		return result.kind === "internal" ? result.route : result.kind;
	};
	assert.equal(route("/guides/a"), "/guides/a");
	assert.equal(route("/guides/a/"), "/guides/a", "a trailing slash is the same route");
	assert.equal(route(`${SITE}/guides/a?utm=1#part`), "/guides/a", "query and fragment do not change the destination");
	assert.equal(route("http://example.com/guides/a"), "/guides/a", "http and https on the same host compare equal");
	assert.equal(route("//example.com/guides/a"), "/guides/a");
	assert.equal(route("/gu%c3%bcide"), route("/gu%C3%BCide"), "percent-escape case does not matter");
	assert.equal(route("/ürün"), route("/%c3%bcr%c3%bcn"), "an unencoded path equals its encoded form");
	assert.equal(route("../guides/a"), "/blog/guides/a", "a path-relative href resolves against the saved source route");
	assert.equal(route("guides/a", bare), "relative-unresolved", "without the source route a relative href is never guessed");
	assert.equal(route("?page=2", bare), "relative-unresolved");
	assert.equal(route("/guides/a", bare), "/guides/a", "root-relative hrefs need no source route");
	assert.equal(route("#top"), "same-page");
	assert.equal(route("https://other.example/guides/a"), "foreign");
	assert.equal(route("https://example.com:8443/guides/a"), "foreign", "another port is another origin");
	assert.equal(route("mailto:team@example.com"), "foreign");
	assert.equal(route("javascript:alert(1)"), "foreign");
	assert.equal(route("https://user:secret@example.com/guides/a"), "unreadable");
	assert.equal(route("/guides/\u0001a"), "unreadable");
	assert.equal(route(`/${"x".repeat(LINK_SUGGESTION_LIMITS.urlChars)}`), "unreadable", "an oversized href is refused, not trimmed");
	assert.equal(route(42), "unreadable");
	assert.equal(linkSiteBase(null, null), null, "no site URL, no base");
	assert.equal(linkSiteBase(SITE, "https://other.example/x"), null, "a source route on another host is refused");
	assert.deepEqual(linkCopyValue(`${SITE}/guides/a/`, base), { url: `${SITE}/guides/a/`, route: "/guides/a" }, "the copied value is the exact URL");
	assert.equal(linkCopyValue("/guides/a", base), null, "a copied URL must be absolute");
	assert.equal(linkCopyValue(` ${SITE}/guides/a`, base), null, "surrounding whitespace is not silently trimmed from a copied URL");
	assert.equal(linkCopyValue("https://other.example/a", base), null);
}

// ---- Original offsets survive Unicode; tokens are normalized only for comparison ----
{
	const rank = ranked([block("p1", [span("Intro: ", ["strong"], "s-intro"), span("Read 😀 the Café Guide today.", [], "s-body")])], [candidate("g1", "Café Guide")]);
	const anchor = rank.provisional[0].anchor;
	assert.deepEqual([anchor.blockKey, anchor.spanKey, anchor.start, anchor.end, anchor.text], ["p1", "s-body", 12, 22, "Café Guide"],
		"offsets count the emoji's two UTF-16 code units in the original span");
	assert.deepEqual([anchor.paragraphStart, anchor.paragraphEnd], [19, 29]);
	assert.equal(anchor.paragraph, "Intro: Read 😀 the Café Guide today.");
	assert.equal(anchor.paragraph.slice(anchor.paragraphStart, anchor.paragraphEnd), anchor.text);
	assert.deepEqual(anchor.decorators, Array.from({ length: 10 }, () => []));
	assert.equal(rank.provisional[0].reason.kind, "title");
	assert.equal(rank.provisional[0].reason.quote, "Café Guide");

	const decomposed = ranked([paragraph("p1", "Read the Café Guide.")], [candidate("g1", "Café Guide")]).provisional[0].anchor;
	assert.deepEqual([decomposed.start, decomposed.end, decomposed.text], [9, 20, "Café Guide"],
		"a decomposed accent matches after normalization while the anchor keeps the original eleven code units");

	const fullwidth = ranked([paragraph("p1", "Use the ＳＥＯ Checklist now.")], [candidate("g1", "SEO Checklist")]).provisional[0].anchor;
	assert.deepEqual([fullwidth.start, fullwidth.end, fullwidth.text], [8, 21, "ＳＥＯ Checklist"]);

	const turkish = {
		owner: owner({ source: { locale: "tr" }, scope: { locale: "tr" } }),
		source: { locale: "tr" },
	};
	const istanbul = ranked([paragraph("p1", "Yeni istanbul rehberi yayında.")], [candidate("g1", "İstanbul Rehberi", null, { locale: "tr" })], turkish);
	assert.deepEqual([istanbul.provisional[0].anchor.start, istanbul.provisional[0].anchor.text], [5, "istanbul rehberi"],
		"Turkish dotted capital I lowercases to i under the source locale");
	assert.equal(ranked([paragraph("p1", "Yeni istanbul rehberi yayında.")], [candidate("g1", "İstanbul Rehberi")]).provisional.length, 0,
		"under English rules the same title does not match, so the locale is not ignored");

	assert.equal(ranked([paragraph("p1", "Our launch-plan works.")], [candidate("g1", "Launch Plan")]).provisional[0].anchor.text, "launch-plan",
		"a hyphen joins phrase tokens");
	assert.equal(ranked([paragraph("p1", "We launch. Plan later.")], [candidate("g1", "Launch Plan")]).provisional.length, 0,
		"sentence punctuation never joins phrase tokens");
}

// ---- Repeated phrases keep occurrence identity and the nearest heading as context ----
{
	const linkedFirst = [
		block("p0", [span("Launch Plan", ["l0"])], { markDefs: [link("l0", "https://other.example/plan")] }),
		heading("h1", "Launch Plan details"),
		paragraph("p2", "Again the Launch Plan here."),
	];
	const anchor = ranked(linkedFirst, [candidate("g1", "Launch Plan")]).provisional[0].anchor;
	assert.equal(anchor.blockKey, "p2", "the linked and heading occurrences are skipped as anchors");
	assert.deepEqual(anchor.occurrence, { ordinal: 3, total: 3 }, "the ordinal counts every saved occurrence in document order");
	assert.equal(anchor.heading, "Launch Plan details", "the nearest heading is kept as context");
	assert.equal(anchor.blockKind, "paragraph");

	const plainFirst = [paragraph("pa", "Our Launch Plan matters."), ...linkedFirst];
	const first = ranked(plainFirst, [candidate("g1", "Launch Plan")]).provisional[0].anchor;
	assert.deepEqual([first.blockKey, first.occurrence.ordinal, first.occurrence.total, first.heading], ["pa", 1, 4, null]);

	const twice = ranked([paragraph("p0", "Launch Plan first, Launch Plan second.")], [candidate("g1", "Launch Plan"), candidate("g2", "Launch Plan Review")]);
	assert.deepEqual(twice.provisional.map((item) => [item.candidate.entryId, item.anchor.start, item.anchor.occurrence.ordinal]), [["g1", 0, 1], ["g2", 19, 2]],
		"each destination gets its own occurrence; overlapping anchors are never shared");
}

// ---- Link marks, decorators, annotations and inline objects ----
{
	const plan = [candidate("g1", "Launch Plan")];
	const anchors = (children: any[], extra: Record<string, unknown> = {}) => ranked([block("p1", children, extra)], plan).provisional;
	const decorated = anchors([span("Bold "), span("Launch Plan", ["strong", "em"])]);
	assert.deepEqual(decorated[0].anchor.decorators, Array.from({ length: 11 }, () => ["em", "strong"]), "decorators are kept per code unit, sorted");
	assert.equal(anchors([span("Launch Plan", ["subscript"])]).length, 1, "subscript is a supported decorator");
	assert.equal(anchors([span("Launch Plan", ["superscript"])]).length, 1);
	assert.equal(anchors([span("Launch Plan", ["code"])]).length, 0, "code text never anchors");
	assert.equal(anchors([span("Launch Plan", ["highlight"])]).length, 0, "a mark without a definition is a malformed reference");
	assert.equal(anchors([span("Launch Plan", ["c1"])], { markDefs: [{ _type: "comment", _key: "c1", note: "x" }] }).length, 0,
		"an annotated span is not an anchor, so links never nest");
	assert.equal(anchors([span("Launch Plan", ["l1"])], { markDefs: [link("l1", "/elsewhere")] }).length, 0, "a linked span is not an anchor");
	assert.equal(anchors([span("Launch "), span("Plan", ["strong"])]).length, 0, "an anchor lies inside one original span");
	assert.equal(anchors([span("See "), { _type: "mention", _key: "m1" }, span("Launch Plan here")]).length, 0,
		"an inline object makes its paragraph ineligible instead of being joined around");
	assert.equal(anchors([span("Launch Plan")], { markDefs: [{ _type: "link", href: "/x" }] }).length, 0, "malformed annotation definitions disable the paragraph");
	assert.equal(anchors([span("Launch Plan", [], "dup"), span(" and more", [], "dup")]).length, 0, "duplicate span keys are ambiguous");
	assert.equal(ranked([block("p1", [{ _type: "span", text: "Launch Plan", marks: [] }])], plan).provisional.length, 0, "a span without a key has no identity");
}

// ---- Headings, lists, quotes and custom blocks ----
{
	const plan = [candidate("g1", "Launch Plan")];
	const list = ranked([paragraph("li1", "Read the Launch Plan.", { listItem: "bullet", level: 1 })], plan).provisional[0].anchor;
	assert.equal(list.blockKind, "list-item", "a list item is an anchor location");
	const onlyHeading = ranked([heading("h1", "Launch Plan")], plan);
	assert.deepEqual([onlyHeading.provisional.length, onlyHeading.excluded["no-anchor"]], [0, 1], "a heading is context only");
	assert.equal(ranked([paragraph("q1", "Read the Launch Plan.", { style: "blockquote" })], plan).provisional.length, 0, "a quote is not an anchor location");
	assert.equal(ranked([{ _type: "code", _key: "c1", code: "Launch Plan" }], plan).provisional.length, 0, "a code block is not an anchor location");
	const longParagraph = `${"word ".repeat(410)}Launch Plan`;
	assert.ok(longParagraph.length > LINK_SUGGESTION_LIMITS.paragraphChars);
	assert.equal(ranked([paragraph("p1", longParagraph)], plan).provisional.length, 0, "a paragraph longer than a suggestion carries is not anchored");
	assert.equal(ranked([paragraph("dup", "Launch Plan one."), paragraph("dup", "Launch Plan two.")], plan).provisional.length, 0,
		"blocks sharing a key never anchor");
	assert.equal(ranked([paragraph("dup", "Launch Plan one."), { _type: "image", _key: "dup", asset: { _ref: "a" } }], plan).provisional.length, 0,
		"a custom block sharing the key makes it ambiguous too");
}

// ---- Malformed and oversized sources fail closed ----
{
	const plan = [candidate("g1", "Launch Plan")];
	assert.equal(refusal("Launch Plan", plan), "source_body_unsupported");
	assert.equal(refusal({ blocks: [] }, plan), "source_body_unsupported");
	assert.equal(refusal(["Launch Plan"], plan), "source_body_malformed");
	assert.equal(refusal([{ _type: "block", _key: "p1" }], plan), "source_body_malformed", "a text block without children");
	assert.equal(refusal([block("p1", [{ _type: "span", _key: "s", text: 3 }])], plan), "source_body_malformed");
	assert.equal(refusal([block("p1", [span("x")], { style: 3 })], plan), "source_body_malformed");
	assert.equal(refusal([{ _type: "block", _key: "p1", children: [], toJSON: () => [] }], plan), "source_body_malformed");
	const large = [paragraph("p1", "x".repeat(LINK_SUGGESTION_LIMITS.sourceBodyBytes))];
	assert.equal(refusal(large, plan), "source_too_large", "a body over 64 KiB is refused");
	assert.equal(refusal([paragraph("p1", "ok")], plan, { source: { siteUrl: null } }), "site_url_unavailable");
	assert.equal(refusal([paragraph("p1", "ok")], plan, { source: { routeUrl: "https://other.example/post" } }), "invalid_input");
	assert.equal(refusal([paragraph("p1", "ok")], plan, { source: { locale: "en-us" } }), "invalid_input", "locales must be canonical");
}

// ---- Destination coverage: referenced links, images, tables and opaque content ----
{
	const target = [candidate("g1", "Launch Plan")];
	const anchor = paragraph("p1", "Read the Launch Plan today.");
	const shown = (body: any[], options: { source?: Record<string, unknown> } = {}) => respond(body, target, {}, options);

	const unused = shown([anchor, block("p2", [span("Elsewhere")], { markDefs: [link("l1", "/guides/g1")] })]);
	assert.equal(unused.suggestions.length, 1, "an unused link definition is not an existing link");
	assert.deepEqual(unused.coverage, { kind: "complete" });

	const used = shown([anchor, block("p2", [span("our plan", ["l1"])], { markDefs: [link("l1", "/guides/g1/")] })]);
	assert.deepEqual([used.suggestions.length, used.excluded["already-linked"]], [0, 1], "a referenced link excludes its destination");
	const inHeading = shown([anchor, block("h2", [span("Plan", ["l1"])], { style: "h2", markDefs: [link("l1", `${SITE}/guides/g1`)] })]);
	assert.equal(inHeading.excluded["already-linked"], 1, "links in headings count");
	const inQuote = shown([anchor, block("q2", [span("Plan", ["l1"])], { style: "blockquote", markDefs: [link("l1", "/guides/g1")] })]);
	assert.equal(inQuote.excluded["already-linked"], 1, "links in quotes count");

	const plainImage = shown([anchor, { _type: "image", _key: "i1", asset: { _ref: "a1", url: `${SITE}/guides/g1` }, alt: "Plan" }]);
	assert.deepEqual([plainImage.suggestions.length, plainImage.coverage.kind], [1, "complete"],
		"an image without a link is media, and asset.url is not a hyperlink");
	const linkedImage = shown([anchor, { _type: "image", _key: "i1", asset: { _ref: "a1" }, link: { href: `${SITE}/guides/g1` } }]);
	assert.equal(linkedImage.excluded["already-linked"], 1, "a linked image excludes its destination");
	const legacyImage = shown([anchor, { _type: "image", _key: "i1", asset: { _ref: "a1" }, link: " /guides/g1 " }]);
	assert.equal(legacyImage.excluded["already-linked"], 1, "the legacy string image link counts");
	for (const malformed of [{ href: 42 }, { blank: true }, 7, ["/guides/g1"]]) {
		const image = shown([anchor, { _type: "image", _key: "i1", asset: { _ref: "a1", url: `${SITE}/guides/g1` }, link: malformed }]);
		assert.deepEqual([image.suggestions.length, image.coverage], [1, { kind: "partial", gaps: ["unreadable-link"], limitation: LINK_PARTIAL_COVERAGE_LIMITATION }],
			`a malformed supplied image link ${JSON.stringify(malformed)} is unreadable coverage beside the safe paragraph, never a link`);
	}
	for (const absent of [null, "", { href: "  " }]) {
		const image = shown([anchor, { _type: "image", _key: "i1", asset: { _ref: "a1", url: `${SITE}/guides/g1` }, link: absent }]);
		assert.deepEqual([image.suggestions.length, image.coverage.kind], [1, "complete"], `an image link ${JSON.stringify(absent)} renders no hyperlink`);
	}

	const table = (cellMarkDefs: any[] | undefined, rows?: unknown): any => ({
		_type: "table", _key: "t1", markDefs: [link("L1", "/guides/g1")],
		rows: rows ?? [{ _key: "r1", cells: [{ _key: "c1", content: [span("plan", ["L1"])], ...(cellMarkDefs ? { markDefs: cellMarkDefs } : {}) }] }],
	});
	assert.equal(shown([anchor, table(undefined)]).excluded["already-linked"], 1, "a table cell link resolves through the table's definitions");
	const local = shown([anchor, table([link("L1", "/guides/other")])]);
	assert.deepEqual([local.suggestions.length, local.coverage.kind], [1, "complete"], "a cell definition takes precedence over the table's");
	const brokenTable = shown([anchor, table(undefined, "not rows")]);
	assert.deepEqual(brokenTable.coverage, { kind: "partial", gaps: ["unsupported-content"], limitation: LINK_PARTIAL_COVERAGE_LIMITATION });

	const inlineButton = shown([anchor, block("p2", [span("See "), { _type: "button", _key: "btn", href: "/guides/g1" }, span(" more")])]);
	assert.deepEqual([inlineButton.suggestions.length, inlineButton.coverage], [1, { kind: "partial", gaps: ["unsupported-content"], limitation: LINK_PARTIAL_COVERAGE_LIMITATION }],
		"an unknown inline object keeps coverage partial while the separate safe paragraph is still suggested");
	const opaque = shown([anchor, { _type: "htmlBlock", _key: "h1", html: `<a href="${SITE}/guides/g1">plan</a>` }]);
	assert.equal(opaque.suggestions.length, 1, "safe paragraphs are kept beside opaque content");
	assert.deepEqual(opaque.coverage, { kind: "partial", gaps: ["unsupported-content"], limitation: LINK_PARTIAL_COVERAGE_LIMITATION },
		"opaque content makes no exhaustive already-linked claim");
	const possible = shown([anchor, block("p2", [span("plan", ["b1"])], { markDefs: [{ _type: "button", _key: "b1", href: "/guides/g1" }] })]);
	assert.deepEqual([possible.suggestions.length, possible.coverage.kind === "partial" && possible.coverage.gaps],
		[1, ["possible-destination"]], "href-shaped custom data is at most a possible destination, never a verified link");
	const relative = [anchor, block("p2", [span("plan", ["l1"])], { markDefs: [link("l1", "guides/g1")] })];
	assert.equal(refusal(relative, target), "source_route_unavailable", "a known unresolved relative link refuses Find instead of being ignored");
	assert.equal(refusal([anchor, { _type: "image", _key: "i1", asset: { _ref: "a1" }, link: { href: "guides/g1" } }], target), "source_route_unavailable",
		"a relative image link is a known link too");
	assert.equal(refusal([anchor, { _type: "table", _key: "t1", rows: [{ cells: [{ content: [span("plan", ["L1"])], markDefs: [link("L1", "../g1")] }] }] }], target),
		"source_route_unavailable", "and so is a relative table cell link");
	assert.equal(shown(relative, { source: { routeUrl: `${SITE}/` } }).excluded["already-linked"], 1, "with the saved route it resolves");
	const customRelative = shown([anchor, block("p2", [span("plan", ["b1"])], { markDefs: [{ _type: "button", _key: "b1", href: "guides/g1" }] })]);
	assert.deepEqual(customRelative.coverage.kind === "partial" && customRelative.coverage.gaps, ["possible-destination"],
		"a relative href in custom data stays a possible destination, not a refusal");
	const unreadable = shown([anchor, block("p2", [span("plan", ["l1"])], { markDefs: [link("l1", "/guides/\u0001g1")] })]);
	assert.deepEqual(unreadable.coverage.kind === "partial" && unreadable.coverage.gaps, ["unreadable-link"]);
	assert.deepEqual(shown([anchor, { _type: "code", _key: "c1", code: "x" }, { _type: "break", _key: "b1" }]).coverage, { kind: "complete" },
		"known link-free blocks keep coverage complete");
}

// ---- Ranking reasons, overlap and the display limit ----
{
	const body = [paragraph("p1", "We cover structured data testing in depth.")];
	const overlap = ranked(body, [
		candidate("a", "Data Testing"),
		candidate("b", "Structured Data Testing Guide"),
		candidate("c", "Structured Data"),
	]);
	assert.deepEqual(overlap.provisional.map((item) => item.candidate.entryId), ["c"], "full titles first, then the longer quote; anchors never overlap");
	assert.equal(overlap.excluded["anchor-taken"], 2);
	const excerpt = ranked(body, [candidate("e", "Unrelated Words Here", "This guide explains structured data testing for local businesses.")]);
	assert.deepEqual([excerpt.provisional[0].reason.kind, excerpt.provisional[0].reason.quote], ["excerpt-phrase", "structured data testing"]);
	assert.ok(!("score" in excerpt.provisional[0]) && !("relevance" in excerpt.provisional[0].reason), "no synthetic relevance figure");

	const many = Array.from({ length: 7 }, (_, index) => candidate(`m${index}`, `Topic${index} Notes`));
	const manyBody = many.map((item, index) => paragraph(`p${index}`, `See ${item.title} here.`));
	const limited = ranked(manyBody, many);
	assert.deepEqual([limited.provisional.length, limited.excluded["display-limit"]], [LINK_SUGGESTION_LIMITS.displayed, 2], "at most five suggestions");
	const noBackfill = finalize(limited, { m0: found(many[0], { noindex: true }) });
	assert.ok(noBackfill.kind === "result");
	assert.deepEqual([noBackfill.response.suggestions.length, noBackfill.response.excluded.noindex], [4, 1],
		"an excluded displayed target leaves four; no sixth target is read");
}

// ---- Candidate page bounds and projection-only reads ----
{
	const body = [paragraph("p1", "Read the Launch Plan.")];
	const plan = candidate("g1", "Launch Plan");
	assert.equal(refusal(body, [], { page: page(Array.from({ length: 26 }, (_, index) => candidate(`c${index}`, "x"))) }), "candidate_page_invalid", "more than 25 references");
	assert.equal(refusal(body, [], { page: page([plan], { examinedRows: 201 }) }), "candidate_page_invalid", "more than 200 rows examined");
	assert.equal(refusal(body, [], { page: page([plan, candidate("g2", "y")], { examinedRows: 1 }) }), "candidate_page_invalid");
	assert.equal(refusal(body, [], { page: page([plan], { exhausted: true, nextAfterId: "g1" }) }), "candidate_page_invalid");
	assert.equal(refusal(body, [], { page: page([candidate("g1", "Launch Plan", null, { locale: "fr" })]) }), "candidate_page_invalid", "another locale");
	assert.equal(refusal(body, [], { page: page([candidate("g1", "Launch Plan", null, { collection: "pages" })]) }), "candidate_page_invalid");
	assert.equal(refusal(body, [], { page: page([plan, plan]) }), "candidate_page_invalid", "duplicate references");
	const sparse = ranked(body, [], { page: { exhausted: false, nextAfterId: "after-200", examinedRows: 200 } });
	assert.deepEqual([sparse.provisional.length, sparse.page.nextAfterId], [0, "after-200"], "a sparse empty page can still have a next page");

	const oversized = ranked(body, [
		candidate("t", `Launch Plan ${"x".repeat(LINK_SUGGESTION_LIMITS.titleChars)}`),
		candidate("e", "Launch Plan", "e".repeat(LINK_SUGGESTION_LIMITS.excerptChars + 1)),
		candidate("ok", `Launch Plan ${"😀".repeat(LINK_SUGGESTION_LIMITS.titleChars - 12)}`),
	]);
	assert.equal(oversized.excluded["candidate-malformed"], 2, "oversized titles and excerpts are refused, not trimmed");
	assert.deepEqual(oversized.provisional.map((item) => item.candidate.entryId), ["ok"], "the title limit counts characters, not UTF-16 code units");

	const touched: string[] = [];
	const guarded = new Proxy(candidate("g1", "Launch Plan", null, { body: [paragraph("x", "secret")], data: { content: [] } }), {
		get(target, property) {
			if (typeof property === "string") touched.push(property);
			if (property === "body" || property === "data") throw new Error("candidate bodies are never read");
			return Reflect.get(target, property);
		},
	});
	assert.equal(ranked(body, [guarded]).provisional.length, 1);
	assert.ok(!touched.includes("body") && !touched.includes("data"), "only projected fields are read");
	assert.deepEqual([LINK_PORT_BUDGETS.candidateRows, LINK_PORT_BUDGETS.scopeMatches, LINK_PORT_BUDGETS.displayedTargetReads], [200, 25, 5]);
}

// ---- Displayed targets: exact reads, policy, self and eligibility ----
{
	const plan = candidate("g1", "Launch Plan");
	const body = [paragraph("p1", "Read the Launch Plan.")];
	const rank = ranked(body, [plan]);
	const excludedBy = (read: LinkTargetRead) => {
		const outcome = finalize(rank, { g1: read });
		assert.ok(outcome.kind === "result");
		assert.equal(outcome.response.suggestions.length, 0);
		return Object.entries(outcome.response.excluded).filter(([, count]) => count > 0).map(([reason]) => reason);
	};
	assert.deepEqual(excludedBy({ kind: "missing" }), ["target-missing"]);
	assert.deepEqual(excludedBy({ kind: "unavailable" }), ["target-unavailable"]);
	assert.deepEqual(excludedBy(found(plan, { status: "draft" })), ["not-published"]);
	assert.deepEqual(excludedBy(found(plan, { version: "g1-v2" })), ["target-changed"]);
	assert.deepEqual(excludedBy(found(plan, { title: "Launch Plan v2" })), ["target-changed"], "the published title must match its projection");
	assert.deepEqual(excludedBy(found(plan, { inScope: false })), ["out-of-scope"]);
	assert.deepEqual(excludedBy(found(plan, { inScope: null })), ["scope-unverifiable"]);
	assert.deepEqual(excludedBy(found(plan, { noindex: true })), ["noindex"]);
	assert.deepEqual(excludedBy(found(plan, { noindex: null })), ["policy-unverifiable"]);
	assert.deepEqual(excludedBy(found(plan, { globalPolicyVersion: "policy-0" })), ["policy-unverifiable"], "noindex evaluated under another global policy is not trusted");
	assert.deepEqual(excludedBy(found(plan, { targetPolicyVersion: null })), ["policy-unverifiable"], "a target without its own policy identity is unverifiable");
	assert.deepEqual(excludedBy(found(plan, { publicUrl: "https://other.example/guides/g1" })), ["route-unavailable"]);
	assert.deepEqual(excludedBy(found(plan, { publicUrl: null })), ["route-unavailable"]);
	const selfRoute = finalize(ranked(body, [plan], { source: { routeUrl: `${SITE}/guides/g1/` } }));
	assert.ok(selfRoute.kind === "result" && selfRoute.response.excluded.self === 1, "a destination on the source's own route is the source");
	const sameEntry = ranked(body, [candidate("src", "Launch Plan", null, { collection: "posts" })], { owner: owner({ scope: { collection: "posts" } }) });
	assert.equal(sameEntry.excluded.self, 1, "the source entry itself is never a candidate");
	assert.deepEqual(finalize(rank, {}, { kind: "unreadable" }), { kind: "refused", reason: "policy_unreadable" });
	assert.deepEqual(finalizeLinkSuggestions(rank, [], POLICY), { kind: "refused", reason: "target_reads_invalid" }, "every displayed target needs its exact read");

	const response = respond(body, [plan]);
	assert.equal(response.status, "editorial-heuristic");
	assert.equal(response.notice, LINK_SUGGESTION_SAVED_SOURCE_NOTICE);
	assert.equal(response.policyVersion, "policy-1");
	assert.deepEqual(response.suggestions[0].target, {
		collection: "guides", entryId: "g1", locale: "en", title: "Launch Plan", publicUrl: `${SITE}/guides/g1`, route: "/guides/g1", version: "g1-v1",
		targetPolicyVersion: "g1-policy-1",
	}, "each suggestion carries its own target policy identity beside the response's global one");
}

// ---- Response byte limit ----
{
	const items = Array.from({ length: 5 }, (_, index) => candidate(`b${index}`, `Alpha${index} Guide ${"€".repeat(498)}`));
	const body = items.flatMap((item, index) => [
		heading(`h${index}`, "€".repeat(500)),
		paragraph(`p${index}`, `Alpha${index} Guide ${"€".repeat(2_000)}`),
	]);
	const rank = ranked(body, items);
	assert.equal(rank.provisional.length, 5);
	const longUrl = (entryId: string) => `${SITE}/guides/${"x".repeat(1_500)}${entryId}`;
	const outcome = finalize(rank, Object.fromEntries(items.map((item) => [item.entryId, found(item, { publicUrl: longUrl(item.entryId) })])));
	assert.ok(outcome.kind === "result");
	assert.ok(outcome.response.omittedForResponseLimit >= 1, "the lowest-ordered suggestions are omitted and counted");
	assert.equal(outcome.response.suggestions.length + outcome.response.omittedForResponseLimit, 5);
	assert.ok(bytes(outcome.response) <= LINK_SUGGESTION_LIMITS.responseBytes, "the response stays within 48 KiB");
}

// ---- Ownership: owners, late responses and requests ----
{
	assert.equal(validateLinkSuggestionOwner(owner({ scope: { taxonomy: "topics", termIds: ["b", "a"] } })), null, "terms must be sorted and unique");
	assert.equal(validateLinkSuggestionOwner(owner({ scope: { taxonomy: "topics", termIds: Array.from({ length: 9 }, (_, index) => `t${index}`) } })), null,
		"at most eight terms");
	assert.equal(validateLinkSuggestionOwner(owner({ scope: { taxonomy: null, termIds: ["a"] } })), null);
	assert.equal(validateLinkSuggestionOwner(owner({ scope: { locale: "fr" } })), null, "scope stays in the source locale");
	assert.equal(validateLinkSuggestionOwner({ ...owner(), generation: -1 }), null);
	assert.ok(validateLinkSuggestionOwner(owner({ scope: { taxonomy: "topics", termIds: ["a", "b"] } })));
	assert.notEqual(linkSuggestionOwnerKey(owner()), linkSuggestionOwnerKey(owner({ generation: 2 })));
	assert.notEqual(linkSuggestionOwnerKey(owner()), linkSuggestionOwnerKey(owner({ scope: { afterId: "next" } })));
	assert.equal(refusal([paragraph("p1", "x")], [], { owner: owner({ source: { sourceVersion: "v0" } }) }), "owner_mismatch",
		"a result is bound to the exact saved version it read");
	assert.equal(refusal([paragraph("p1", "x")], [], { owner: owner({ source: { revisionId: "r1" } }) }), "owner_mismatch");

	const response = respond([paragraph("p1", "Read the Launch Plan.")], [candidate("g1", "Launch Plan")]);
	const wire = JSON.parse(JSON.stringify(response));
	assert.equal(acceptLinkSuggestionResponse(wire, owner()).kind, "accepted");
	assert.equal(acceptLinkSuggestionResponse(wire, owner({ generation: 2 })).kind, "stale", "a late response for an older selection is never shown");
	assert.equal(acceptLinkSuggestionResponse(wire, owner({ source: { sourceVersion: "v2" } })).kind, "stale");
	const tampered = JSON.parse(JSON.stringify(response));
	tampered.suggestions[0].anchor.text = "Launch";
	assert.equal(acceptLinkSuggestionResponse(tampered, owner()).kind, "invalid");
	const badCoverage = { ...JSON.parse(JSON.stringify(response)), coverage: { kind: "partial", gaps: [], limitation: LINK_PARTIAL_COVERAGE_LIMITATION } };
	assert.equal(acceptLinkSuggestionResponse(badCoverage, owner()).kind, "invalid");
	const padded = { ...JSON.parse(JSON.stringify(response)), padding: "x".repeat(LINK_SUGGESTION_LIMITS.responseBytes) };
	assert.equal(acceptLinkSuggestionResponse(padded, owner()).kind, "invalid", "an oversized response is refused");

	const request = { owner: owner(), policyVersion: "policy-1", suggestion: wire.suggestions[0] };
	assert.ok(validateLinkSuggestionRequest(request));
	assert.equal(validateLinkSuggestionRequest({ ...request, suggestion: tampered.suggestions[0] }), null);
	assert.equal(validateLinkSuggestionRequest({ ...request, owner: owner({ scope: { collection: "pages" } }) }), null, "the suggestion must belong to its scope");
}

// ---- Chosen-target verification ----
{
	const plan = candidate("g1", "Launch Plan");
	const body = [paragraph("p1", "Read the Launch Plan.")];
	const response = respond(body, [plan]);
	const request = validateLinkSuggestionRequest({ owner: owner(), policyVersion: response.policyVersion, suggestion: response.suggestions[0] }) as LinkSuggestionRequest;
	const scope = owner().scope;
	const fresh = (patch: Record<string, unknown> = {}) => ({
		request,
		source: { kind: "found", document: source(body) },
		target: found(plan),
		policy: POLICY,
		scope: linkScopeCheck(scope, { kind: "resolved", scope: { collection: "guides", locale: "en", taxonomy: null, termIds: [], scopeVersion: "scope-1", upperId: null } }),
		...patch,
	}) as any;
	assert.deepEqual(verifyChosenLinkTarget(fresh()), { kind: "verified", url: `${SITE}/guides/g1`, route: "/guides/g1" });
	assert.deepEqual(verifyChosenLinkTarget(fresh({ target: found(plan, { publicUrl: `${SITE}/guides/g1/` }) })),
		{ kind: "verified", url: `${SITE}/guides/g1/`, route: "/guides/g1" }, "the freshly resolved exact URL is returned");
	const stale = (patch: Record<string, unknown>) => {
		const result = verifyChosenLinkTarget(fresh(patch));
		return result.kind === "stale" ? result.reasons : result.kind;
	};
	assert.deepEqual(stale({ source: { kind: "found", document: source(body, { sourceVersion: "v2" }) } }), ["source-version-changed"]);
	assert.deepEqual(stale({ source: { kind: "found", document: source([paragraph("p1", "Read the new Launch Plan.")]) } }), ["anchor-changed"],
		"the saved paragraph is rechecked even under the same version identity");
	assert.deepEqual(stale({ source: { kind: "missing" } }), ["source-missing"]);
	assert.deepEqual(stale({ policy: { kind: "readable", version: "policy-2" }, target: found(plan, { globalPolicyVersion: "policy-2" }) }), ["policy-changed"],
		"a changed global noindex policy refuses the earlier result");
	assert.deepEqual(stale({ target: found(plan, { targetPolicyVersion: "g1-policy-2" }) }), ["policy-changed"],
		"a changed target policy is stale even while noindex stays false and the content version is unchanged");
	assert.equal(stale({ target: found(plan, { targetPolicyVersion: null }) }), "unavailable", "a missing target policy identity refuses");
	assert.equal(stale({ target: found(plan, { globalPolicyVersion: "policy-0" }) }), "unavailable", "a target evaluated under another global policy refuses");
	assert.equal(stale({ target: found(plan, { noindex: null }) }), "unavailable");
	assert.deepEqual(stale({ scope: linkScopeCheck(scope, { kind: "invalid", reason: "taxonomy-not-attached" }) }), ["scope-changed"]);
	assert.deepEqual(stale({ scope: linkScopeCheck(scope, { kind: "resolved", scope: { collection: "guides", locale: "en", taxonomy: null, termIds: [], scopeVersion: "scope-2", upperId: null } }) }),
		["scope-changed"]);
	assert.deepEqual(stale({ target: found(plan, { publicUrl: `${SITE}/guides/renamed` }) }), ["target-changed"], "a changed route is never silently replaced");
	assert.deepEqual(stale({ target: found(plan, { version: "g1-v2" }) }), ["target-changed"]);
	const missing = verifyChosenLinkTarget(fresh({ target: { kind: "missing" } }));
	assert.deepEqual(missing, { kind: "stale", reasons: ["target-changed"], target: "target-missing" });
	assert.deepEqual(verifyChosenLinkTarget(fresh({ target: found(plan, { noindex: true }) })), { kind: "stale", reasons: ["target-changed"], target: "noindex" });
	assert.equal(stale({ policy: { kind: "unreadable" } }), "unavailable", "unreadable policy refuses verification");
	assert.equal(stale({ source: { kind: "unavailable" } }), "unavailable", "an unreadable draft is never replaced by live content");
	assert.equal(stale({ target: { kind: "unavailable" } }), "unavailable");
	assert.equal(stale({ scope: linkScopeCheck(scope, { kind: "unavailable" }) }), "unavailable");
	const relativeLink = block("p9", [span("plan", ["l1"])], { markDefs: [link("l1", "guides/g1")] });
	assert.deepEqual(verifyChosenLinkTarget(fresh({ source: { kind: "found", document: source([...body, relativeLink]) } })),
		{ kind: "unavailable", reason: "source-route-unavailable" }, "Verify refuses a known unresolved relative link");
	assert.deepEqual(verifyChosenLinkTarget(fresh({ source: { kind: "found", document: source([...body, relativeLink], { routeUrl: `${SITE}/blog/` }) } })),
		{ kind: "verified", url: `${SITE}/guides/g1`, route: "/guides/g1" }, "with the saved route it resolves elsewhere and Verify proceeds");
}

// ---- Saved-link recheck ----
{
	const plan = candidate("g1", "Launch Plan");
	const original = [block("p1", [span("Read the ", [], "a"), span("Launch Plan", ["strong"], "b"), span(" today.", [], "c")]), paragraph("p2", "Other text.")];
	const response = respond(original, [plan]);
	const request = validateLinkSuggestionRequest({ owner: owner(), policyVersion: "policy-1", suggestion: response.suggestions[0] }) as LinkSuggestionRequest;
	const newer = (body: unknown, patch: Record<string, unknown> = {}) =>
		checkSavedLink({ request, source: { kind: "found", document: source(body, { sourceVersion: "v2", ...patch }) } as any });
	const linked = (children: any[], markDefs: any[], rest: any[] = [paragraph("p2", "Other text.")]) => [block("p1", children, { markDefs }), ...rest];

	assert.deepEqual(checkSavedLink({ request, source: { kind: "found", document: source(original) } as any }), { kind: "inconclusive", detail: "same-saved-version" },
		"an unchanged saved version cannot show whether an unsaved insertion happened");
	assert.deepEqual(newer(linked([span("Read the ", [], "x1"), span("Launch Plan", ["strong", "k9"], "x2"), span(" today.", [], "x3")], [link("k9", `${SITE}/guides/g1/`)])),
		{ kind: "verified" }, "new span and annotation keys are expected; the original range carries one link with its decorators");
	assert.deepEqual(newer(linked([span("Read the ", [], "x1"), span("Launch Plan", ["strong", "k9"], "x2"), span(" today.", ["k9"], "x3")], [link("k9", "/guides/g1")])),
		{ kind: "verified" }, "a link extending past the anchor still covers every anchor code unit");
	assert.deepEqual(newer(linked([span("Read the ", [], "x1"), span("Launch Plan", ["strong"], "x2"), span(" today.", [], "x3")], [])), { kind: "unlinked" });
	assert.deepEqual(newer(linked([span("Read the "), span("Launch", ["strong", "k9"]), span(" Plan", ["strong"]), span(" today.")], [link("k9", "/guides/g1")])),
		{ kind: "partial" });
	assert.deepEqual(newer(linked([span("Read the "), span("Launch", ["strong", "k1"]), span(" Plan", ["strong", "k2"]), span(" today.")], [link("k1", "/guides/g1"), link("k2", `${SITE}/guides/g1/`)])),
		{ kind: "verified" }, "adjacent spans may use differently keyed annotations for the same destination");
	assert.deepEqual(newer(linked([span("Read the "), span("Laun", ["k2", "strong"]), span("ch Pl", ["strong", "k1"]), span("an", ["k3", "strong"]), span(" today.")],
		[link("k3", "/guides/g1"), link("k1", "/guides/g1"), link("k2", "/guides/g1")])),
		{ kind: "verified" }, "annotation keys, their order and the span count are ignored");
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k9"]), span(" today.")], [link("k9", "/guides/other")])), { kind: "wrong-destination" });
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k1", "k2"]), span(" today.")], [link("k1", "/guides/g1"), link("k2", "/guides/x")])),
		{ kind: "wrong-destination" }, "nested links are never verified");
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["k9"]), span(" today.")], [link("k9", "/guides/g1")])),
		{ kind: "inconclusive", detail: "decorators-changed" }, "the original formatting must be preserved");
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k9"]), span(" today.")], [{ _type: "comment", _key: "k9", href: "/guides/g1" }])),
		{ kind: "unlinked" }, "href-shaped data on another annotation is not a link");
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k9"]), span(" today.")], [link("k9", "guides/g1")])),
		{ kind: "inconclusive", detail: "source-route-unavailable" });
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k9"]), span(" today.")], [link("k9", "/guides/\u0001")])),
		{ kind: "inconclusive", detail: "links-unreadable" });
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k9"]), span(" today.")], [link("k9", "/guides/g1"), link("k9", "/guides/g1")])),
		{ kind: "inconclusive", detail: "links-unreadable" }, "ambiguous definitions decide nothing");
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k9"]), span(" today.")], [{ _key: "k9", href: "/guides/g1" }])),
		{ kind: "inconclusive", detail: "links-unreadable" }, "a used annotation whose definition lacks its type is unreadable, not absent");
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k8"]), span(" today.")], [])),
		{ kind: "inconclusive", detail: "links-unreadable" }, "a used mark without a definition is unreadable, not absent");
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "k9"]), span(" today.")], [{ _key: "zz" }, link("k9", "/guides/g1")])),
		{ kind: "verified" }, "an unused malformed definition is ignored once every used mark is classified");
	assert.deepEqual(newer(linked([span("Read the "), span("Launch Plan", ["strong", "code", "k9"]), span(" today.")], [link("k9", "/guides/g1")])),
		{ kind: "inconclusive", detail: "decorators-changed" }, "code is a host decorator; adding it changes the original formatting");

	assert.deepEqual(newer([block("p1", [span("Read the "), span("Launch Plan", ["strong"]), span(" now.")]), paragraph("p2", "Other text.")]),
		{ kind: "stale", detail: "paragraph-changed" });
	assert.deepEqual(newer([block("p1", [span("Read the "), { _type: "mention", _key: "m" }, span("Launch Plan", ["strong"]), span(" today.")]), paragraph("p2", "Other text.")]),
		{ kind: "stale", detail: "paragraph-changed" }, "an inserted inline object changes the paragraph");
	assert.deepEqual(newer([paragraph("p2", "Other text.")]), { kind: "stale", detail: "paragraph-missing" });
	assert.deepEqual(newer([...original, paragraph("p1", "Read the Launch Plan today.")]), { kind: "inconclusive", detail: "duplicate-paragraph" });
	assert.deepEqual(newer([original[0], paragraph("p2", "Other text changed freely.")]), { kind: "unlinked" }, "other paragraphs may change");
	assert.deepEqual(newer([
		original[0],
		block("p3", [span("Launch Plan", ["k9"])], { markDefs: [link("k9", "/guides/g1")] }),
	]), { kind: "unlinked" }, "a matching link elsewhere is not re-anchored to the chosen anchor");

	assert.deepEqual(checkSavedLink({ request, source: { kind: "unavailable" } }), { kind: "inconclusive", detail: "source-unavailable" },
		"an unreadable source is not an absent link");
	assert.deepEqual(checkSavedLink({ request, source: { kind: "missing" } }), { kind: "inconclusive", detail: "source-missing" });
	assert.deepEqual(newer("not a body"), { kind: "inconclusive", detail: "source-unreadable" });
	assert.deepEqual(newer([paragraph("p1", "x".repeat(LINK_SUGGESTION_LIMITS.sourceBodyBytes))]), { kind: "inconclusive", detail: "source-unreadable" });
}

console.log("internal link suggestions selfcheck passed");
