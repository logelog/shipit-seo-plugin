import type { SeoTranslate } from "./i18n/messages.ts";

export type IndexingChoice = "index" | "noindex";
export type IndexingRuleSource = "site" | "type" | "archive";
export type IndexingOwnSource = Exclude<IndexingRuleSource, "site">;

export interface IndexingEffect {
	choice: IndexingChoice;
	/** Null exactly when the choice is index. */
	source: IndexingRuleSource | null;
}

export interface IndexingSiteStatus {
	saved: IndexingEffect;
	/** What saving the draft would apply; null while it matches the saved effect, so a pending choice never reads as live. */
	after: IndexingEffect | null;
}

export interface IndexingRuleStatus extends IndexingSiteStatus {
	/** The item's own rule in the draft. Site-wide noindex overrides it but never rewrites it. */
	own: IndexingChoice;
	ownUnsaved: boolean;
	/** False while the draft has site-wide noindex: the own rule is then shown read-only. */
	editable: boolean;
}

/** One list of noindex names (content types or taxonomy archives) with the site-wide rule, saved and in the draft. */
export interface IndexingRuleLists {
	selected: readonly string[];
	saved: readonly string[];
	siteNoindex: boolean;
	savedSiteNoindex: boolean;
}

const INDEX: IndexingEffect = { choice: "index", source: null };

/** Site-wide noindex wins; otherwise the item's own rule decides. */
export function effectiveIndexing(siteNoindex: boolean, ownNoindex: boolean, own: IndexingOwnSource): IndexingEffect {
	if (siteNoindex) return { choice: "noindex", source: "site" };
	return ownNoindex ? { choice: "noindex", source: own } : INDEX;
}

export function sameIndexingEffect(left: IndexingEffect, right: IndexingEffect): boolean {
	return left.choice === right.choice && left.source === right.source;
}

export function siteIndexingStatus(savedNoindex: boolean, draftNoindex: boolean): IndexingSiteStatus {
	const saved: IndexingEffect = savedNoindex ? { choice: "noindex", source: "site" } : INDEX;
	const draft: IndexingEffect = draftNoindex ? { choice: "noindex", source: "site" } : INDEX;
	return { saved, after: sameIndexingEffect(saved, draft) ? null : draft };
}

export function indexingRuleStatus(
	own: IndexingOwnSource,
	saved: { siteNoindex: boolean; noindex: boolean },
	draft: { siteNoindex: boolean; noindex: boolean },
): IndexingRuleStatus {
	const before = effectiveIndexing(saved.siteNoindex, saved.noindex, own);
	const next = effectiveIndexing(draft.siteNoindex, draft.noindex, own);
	return {
		saved: before,
		after: sameIndexingEffect(before, next) ? null : next,
		own: draft.noindex ? "noindex" : "index",
		ownUnsaved: draft.noindex !== saved.noindex,
		editable: !draft.siteNoindex,
	};
}

export function listedIndexingRuleStatus(own: IndexingOwnSource, lists: IndexingRuleLists, name: string): IndexingRuleStatus {
	return indexingRuleStatus(own,
		{ siteNoindex: lists.savedSiteNoindex, noindex: lists.saved.includes(name) },
		{ siteNoindex: lists.siteNoindex, noindex: lists.selected.includes(name) });
}

/** The stored rule lists that an Indexing rules draft holds whole. */
export interface IndexingNameLists {
	contentTypeNoindex?: string[];
	taxonomyArchiveNoindex?: string[];
}

/**
 * A draft holds each rule list whole, so saving it after another editor changed that list would undo
 * the other change. This keeps only the draft's own edits, the names it added to or removed from
 * `base`, the stored lists it started from, applied to `next`, the newer stored lists, in the sorted
 * order lists are stored in. A list that then equals `next` leaves the draft; every other field is
 * returned unchanged.
 */
export function rebaseIndexingNameLists<T extends IndexingNameLists>(draft: T, base: IndexingNameLists, next: IndexingNameLists): T {
	const result = { ...draft };
	const lists: IndexingNameLists = result;
	for (const field of ["contentTypeNoindex", "taxonomyArchiveNoindex"] as const) {
		const names = draft[field];
		if (!names) continue;
		const before = base[field] ?? [];
		const stored = next[field] ?? [];
		const kept = stored.filter((name) => names.includes(name) || !before.includes(name));
		const rebased = [...new Set([...kept, ...names.filter((name) => !before.includes(name))])].sort();
		if (rebased.length === stored.length && rebased.every((name, index) => name === stored[index])) delete lists[field];
		else lists[field] = rebased;
	}
	return result;
}

/** Null until the sitemap configuration is read, so no ownership is claimed from a missing read. */
export function indexingSitemapServing(owner: string | null | undefined): "served" | "not-served" | null {
	if (typeof owner !== "string") return null;
	return owner === "shipit" ? "served" : "not-served";
}

export function indexingChoiceText(choice: IndexingChoice, t: SeoTranslate): string {
	return choice === "index" ? t("indexing.state.index") : t("indexing.state.noindex");
}

/** Index, or Noindex with its source unless the surrounding block already names it. */
export function indexingEffectText(effect: IndexingEffect, t: SeoTranslate, withSource = true): string {
	const state = indexingChoiceText(effect.choice, t);
	if (effect.choice === "index" || !effect.source || !withSource) return state;
	return t("indexing.state.withSource", { state, source: t(`indexing.source.${effect.source}`) });
}
