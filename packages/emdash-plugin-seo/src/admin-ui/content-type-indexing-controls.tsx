import * as React from "react";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { TreeStructure, WarningCircle } from "@phosphor-icons/react";
import type { SeoAdminSitemapConfiguration } from "@shipitseo/emdash-plugin-seo/admin-contract";

import { CONTENT_TYPE_NOINDEX_LIMIT } from "../content-type-noindex-policy.ts";
import { useSeoI18n } from "./i18n/index.ts";
import { IndexingPendingState, IndexingRuleControl, IndexingSavedState } from "./indexing-rule-status.tsx";
import { listedIndexingRuleStatus, type IndexingRuleLists, type IndexingRuleStatus } from "./indexing-rules-model.ts";

export type ContentTypeSitemapFacts = Pick<SeoAdminSitemapConfiguration, "groups">;

export interface ContentTypeIndexingRow {
	key: string;
	label: string;
	status: IndexingRuleStatus;
}

export interface ContentTypeIndexingModel {
	rows: ContentTypeIndexingRow[];
	/** Draft rules for names the loaded list does not contain, in draft order. */
	unlisted: string[];
	selected: string[];
	atLimit: boolean;
}

function unique(names: readonly string[]): string[] {
	return [...new Set(names)];
}

export function contentTypeIndexingModel(rules: IndexingRuleLists, sitemap: ContentTypeSitemapFacts | null): ContentTypeIndexingModel {
	const chosen = unique(rules.selected);
	const lists = { ...rules, selected: chosen };
	const listed = new Set<string>();
	const rows: ContentTypeIndexingRow[] = [];
	for (const group of sitemap?.groups ?? []) {
		if (listed.has(group.key)) continue;
		listed.add(group.key);
		rows.push({ key: group.key, label: group.label.trim() || group.key, status: listedIndexingRuleStatus("type", lists, group.key) });
	}
	return {
		rows,
		unlisted: chosen.filter((name) => !listed.has(name)),
		selected: chosen,
		atLimit: chosen.length >= CONTENT_TYPE_NOINDEX_LIMIT,
	};
}

/** Noindex adds the type's rule; adding past the limit leaves the draft unchanged. */
export function toggleContentTypeNoindex(selected: readonly string[], key: string, shown: boolean): string[] {
	const chosen = unique(selected);
	if (shown) return chosen.filter((name) => name !== key);
	if (chosen.includes(key) || chosen.length >= CONTENT_TYPE_NOINDEX_LIMIT) return chosen;
	return [...chosen, key].sort();
}

export function sameContentTypeNames(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

export interface ContentTypeIndexingControlsProps {
	selected: readonly string[];
	/** The stored rules the draft started from. */
	saved: readonly string[];
	sitemap: ContentTypeSitemapFacts | null;
	loading: boolean;
	error: string | null;
	validationError?: string;
	disabled: boolean;
	siteNoindex: boolean;
	savedSiteNoindex: boolean;
	/** True after a save whose outcome is unknown, until the stored settings are read again. */
	unconfirmed?: boolean;
	onChange: (names: string[]) => void;
	onRetry: () => void;
	onOpenSitemaps?: () => void;
}

export function ContentTypeIndexingControls({
	selected, saved, sitemap, loading, error, validationError, disabled, siteNoindex, savedSiteNoindex, unconfirmed = false, onChange, onRetry, onOpenSitemaps,
}: ContentTypeIndexingControlsProps) {
	const { t } = useSeoI18n();
	const id = React.useId();
	const headingRef = React.useRef<HTMLHeadingElement>(null);
	const model = contentTypeIndexingModel({ selected, saved, siteNoindex, savedSiteNoindex }, sitemap);
	const headingId = `${id}-heading`;
	const descriptionId = `${id}-description`;
	const errorId = `${id}-error`;
	const unlistedId = `${id}-unlisted`;
	const change = (next: string[]) => {
		if (!sameContentTypeNames(next, selected)) onChange(next);
	};
	// Removing a name unmounts its button, and Retry turns off and then leaves with its banner,
	// so focus moves to the heading first.
	const remove = (name: string) => {
		headingRef.current?.focus();
		change(toggleContentTypeNoindex(selected, name, true));
	};
	const retry = () => {
		headingRef.current?.focus();
		onRetry();
	};

	return (
		<section className="shipit-seo-type-indexing" aria-labelledby={headingId} aria-describedby={descriptionId}>
			<div className="shipit-seo-taxonomy-indexing__head">
				<div>
					<h3 id={headingId} ref={headingRef} tabIndex={-1}>{t("indexing.types.title")}</h3>
					<p id={descriptionId}>{t("indexing.types.effect")}</p>
				</div>
				{onOpenSitemaps ? (
					<Button type="button" size="sm" variant="secondary" icon={TreeStructure} onClick={onOpenSitemaps}>
						{t("indexing.types.editSitemap")}
					</Button>
				) : null}
			</div>
			{error ? (
				<Banner
					role="alert"
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={t("indexing.types.loadFailed")}
					description={error}
					action={<Button type="button" size="sm" variant="secondary" disabled={loading} onClick={retry}>{t("indexing.types.retry")}</Button>}
				/>
			) : null}
			<p className={sitemap === null && loading ? "shipit-seo-taxonomy-indexing__state" : "sr-only"} role="status">
				{sitemap === null && loading ? t("indexing.types.loading") : ""}
			</p>
			{sitemap !== null && model.rows.length === 0 ? (
				<p className="shipit-seo-taxonomy-indexing__state">{t("indexing.types.empty")}</p>
			) : null}
			{model.rows.length ? (
				<fieldset className="shipit-seo-indexing-list" aria-describedby={validationError ? errorId : undefined}>
					<legend className="sr-only">{t("indexing.types.legend")}</legend>
					<ul>
						{model.rows.map((row) => (
							<li key={row.key} className="shipit-seo-indexing-row">
								<strong className="shipit-seo-indexing-row__name">{row.label}</strong>
								<div className="shipit-seo-indexing-row__status">
									<IndexingSavedState effect={row.status.saved} />
									<IndexingPendingState effect={row.status.after} unconfirmed={unconfirmed} />
								</div>
								<IndexingRuleControl status={row.status} legend={t("indexing.types.choiceFor", { type: row.label })}
									disabled={disabled} atLimit={model.atLimit} unconfirmed={unconfirmed}
									onChange={(choice) => change(toggleContentTypeNoindex(selected, row.key, choice === "index"))} />
							</li>
						))}
					</ul>
					{model.atLimit ? <p className="shipit-seo-taxonomy-indexing__note" role="status">{t("indexing.types.limit", { limit: CONTENT_TYPE_NOINDEX_LIMIT })}</p> : null}
				</fieldset>
			) : null}
			{model.unlisted.length ? (
				<div className="shipit-seo-taxonomy-indexing__unlisted" role="group" aria-labelledby={unlistedId}>
					<strong id={unlistedId}>{t("indexing.types.unlistedTitle")}</strong>
					<p>{sitemap === null ? t("indexing.types.unloadedHelp") : t("indexing.types.unlistedHelp")}</p>
					<ul>
						{model.unlisted.map((name) => (
							<li key={name}>
								<code>{name}</code>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									aria-label={t("indexing.types.removeNamed", { type: name })}
									disabled={disabled}
									onClick={() => remove(name)}
								>
									{t("indexing.types.remove")}
								</Button>
							</li>
						))}
					</ul>
				</div>
			) : null}
			{validationError ? <p id={errorId} className="shipit-seo-form-error" role="alert">{validationError}</p> : null}
		</section>
	);
}
