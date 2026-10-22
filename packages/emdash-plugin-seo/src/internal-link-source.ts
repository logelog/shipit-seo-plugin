// Read-only ports the internal-link suggestion engine needs from a host
// adapter. They are shapes and budgets only: no adapter lives here. No port
// writes, creates a scan job, touches score acceptance, hydrates a candidate
// body for projection or calls the network.

import {
	LINK_SUGGESTION_LIMITS,
	type LinkCandidatePage,
	type LinkPolicyRead,
	type LinkScopeCheck,
	type LinkScopeIdentity,
	type LinkSourceRead,
	type LinkTargetRead,
} from "./internal-link-suggestions.ts";

/** Reads one explicit user action may make. */
export const LINK_PORT_BUDGETS = Object.freeze({
	/** Find or Next page: raw projected rows examined. */
	candidateRows: LINK_SUGGESTION_LIMITS.candidateRows,
	/** Find or Next page: scoped references projected, scalar title and excerpt only. */
	scopeMatches: LINK_SUGGESTION_LIMITS.scopeMatches,
	/**
	 * Find or Next page: exact target, public URL and noindex reads, only for
	 * displayed suggestions. Published 1.1.0 `content.getPublicUrl` itself
	 * selects and deserializes a full target row, so this call count is not a
	 * byte, memory or Cloudflare bound.
	 */
	displayedTargetReads: LINK_SUGGESTION_LIMITS.displayed,
	/**
	 * Verify: the exact source before the chosen target and once more after it,
	 * before a verified URL is exposed. Each may include the optional route port.
	 */
	verificationSourceReads: 2,
	/** Verify: the global indexing policy before the chosen target and once more after it. */
	verificationPolicyReads: 2,
	/** Verify only: the chosen target. Check saved link reads no target. */
	verificationTargetReads: 1,
	/** Check saved link: the exact newer saved source only, with its optional route port. */
	savedLinkSourceReads: 1,
});

export interface LinkScopeRequest {
	collection: string;
	/** The source locale. */
	locale: string;
	/** One attached taxonomy and at most eight exact same-locale terms, without descendants. */
	taxonomy: { taxonomy: string; termIds: readonly string[] } | null;
}

export interface LinkResolvedScope extends Omit<LinkScopeIdentity, "afterId"> {
	/** The upper ID window fixed when Find starts; Next page keeps it. */
	upperId: string | null;
}

export type LinkScopeResolution =
	| { kind: "resolved"; scope: LinkResolvedScope }
	| { kind: "invalid"; reason: "collection-unavailable" | "taxonomy-not-attached" | "term-unavailable" | "too-many-terms" }
	| { kind: "unavailable" };

export interface LinkCandidatePort {
	/**
	 * Reads the selected definitions fresh: a visible, routable collection, a
	 * taxonomy currently attached to it and exact terms in the source locale.
	 * The score scan source's `revalidate` only rechecks one reference inside
	 * an already resolved scope; it does not rediscover attachments and cannot
	 * stand in for this.
	 */
	resolveScope(request: LinkScopeRequest, allowedCollections: readonly string[]): Promise<LinkScopeResolution>;
	/**
	 * One bounded page of published, non-deleted references in exactly that
	 * collection and locale, each with its schema-validated scalar title and
	 * excerpt columns. It may reuse the count-free scan selection, but never an
	 * SDK list, a collection count, a body or data document, a target-body
	 * fallback or an automatic next page. A sparse empty page may still have a
	 * next page.
	 */
	page(scope: LinkResolvedScope, afterId: string | null, budget: { candidateRows: number; scopeMatches: number }): Promise<LinkCandidatePage>;
}

export interface LinkSourcePort {
	/**
	 * The exact saved source: the live row or, when it has a saved draft
	 * revision, that revision once its collection, entry ID and revision ID
	 * match. An unreadable draft is unavailable; live content is never read in
	 * its place. A missing, unsupported or ambiguous Portable Text field is
	 * named. `routeUrl` stays null unless `LinkSourceRoutePort` supplied it.
	 */
	readSource(ref: { collection: string; entryId: string }): Promise<LinkSourceRead>;
}

export interface LinkSourceRoutePort {
	/**
	 * Optional: the public route of that exact saved version. Published 1.1.0
	 * `content.getPublicUrl` refuses unpublished drafts and exports no
	 * locale-aware formatter, so without this adapter the route is unavailable.
	 * Never an admin URL, canonical, an older live URL after a staged slug
	 * change or a hand-built pattern.
	 */
	resolveSavedRoute(ref: { collection: string; entryId: string; sourceVersion: string }): Promise<{ kind: "resolved"; url: string } | { kind: "unavailable" }>;
}

export interface LinkTargetPort {
	/**
	 * One target's published row, never its pending revision: status, locale,
	 * version and title, its `content.getPublicUrl` route, fresh collection and
	 * taxonomy membership for the scope, and effective noindex evaluated under
	 * exactly `globalPolicyVersion`. The answer names that global identity and
	 * the target's own policy identity: its reference, locale and slug, core
	 * SEO enablement and noIndex, and the exact override observations (ID
	 * first, slug fallback). Either missing makes the target unverifiable.
	 */
	readTarget(ref: { collection: string; entryId: string }, scope: LinkResolvedScope, globalPolicyVersion: string): Promise<LinkTargetRead>;
}

export interface LinkPolicyPort {
	/**
	 * A fresh read of every global site and plugin setting that decides
	 * effective noindex. Entry versions do not identify it, and it does not
	 * identify any one target's policy, so Verify rereads it together with the
	 * chosen target's own identity; a change in either is stale and an
	 * unreadable one refuses.
	 */
	readPolicy(): Promise<LinkPolicyRead>;
}

export interface LinkSuggestionPorts {
	candidates: LinkCandidatePort;
	source: LinkSourcePort;
	targets: LinkTargetPort;
	policy: LinkPolicyPort;
	sourceRoute?: LinkSourceRoutePort;
}

/** A host without the adapter answers a named unavailable state instead of partial work. */
export type LinkSuggestionPortsAvailability =
	| { kind: "available"; ports: LinkSuggestionPorts }
	| { kind: "unavailable"; reason: "adapter-absent" };

/** Compares a fresh scope resolution with the one a result was produced under. */
export function linkScopeCheck(original: LinkScopeIdentity, fresh: LinkScopeResolution): LinkScopeCheck {
	if (fresh.kind === "unavailable") return { kind: "unavailable" };
	if (fresh.kind === "invalid") return { kind: "changed" };
	const scope = fresh.scope;
	const sameTerms = scope.termIds.length === original.termIds.length && scope.termIds.every((term, index) => term === original.termIds[index]);
	if (scope.collection !== original.collection || scope.locale !== original.locale || scope.taxonomy !== original.taxonomy || !sameTerms) {
		return { kind: "changed" };
	}
	return { kind: "current", scopeVersion: scope.scopeVersion };
}
