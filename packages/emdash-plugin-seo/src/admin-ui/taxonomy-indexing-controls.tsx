import * as React from "react";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { WarningCircle } from "@phosphor-icons/react";

import { useSeoI18n } from "./i18n/index.ts";
import { IndexingPendingState, IndexingRuleControl, IndexingSavedState } from "./indexing-rule-status.tsx";
import { listedIndexingRuleStatus, type IndexingRuleLists, type IndexingRuleStatus } from "./indexing-rules-model.ts";

/** The settings contract accepts at most this many canonical taxonomy names. */
export const TAXONOMY_ARCHIVE_NOINDEX_LIMIT = 100;

export interface TaxonomyArchiveDefinition {
	name: string;
	label: string;
}

export interface TaxonomyIndexingControlsProps {
	selected: readonly string[];
	/** The stored archive rules the draft started from. */
	saved: readonly string[];
	definitions: readonly TaxonomyArchiveDefinition[] | null;
	loading: boolean;
	error: string | null;
	validationError?: string;
	truncated?: boolean;
	disabled: boolean;
	siteNoindex: boolean;
	savedSiteNoindex: boolean;
	/** True after a save whose outcome is unknown, until the stored settings are read again. */
	unconfirmed?: boolean;
	onChange: (names: string[]) => void;
	onRetry: () => void;
}

export interface TaxonomyIndexingModel {
	/** Listed definitions, first occurrence of each name, in the order received. */
	listed: { name: string; label: string; status: IndexingRuleStatus }[];
	/** Selected names the current list does not contain, in selection order. */
	unlisted: string[];
	/** The selection without duplicates, in its original order. */
	selected: string[];
	atLimit: boolean;
	/** Listed names that Set all to Noindex would add. */
	addable: number;
	fitsLimit: boolean;
	/** False while the draft has site-wide noindex, which keeps every archive rule read-only. */
	editable: boolean;
	canSelectAll: boolean;
	canClear: boolean;
}

export function uniqueTaxonomyNames(names: readonly string[]): string[] {
	return [...new Set(names)];
}

export function sameTaxonomyNames(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

export function taxonomyIndexingModel(
	rules: IndexingRuleLists,
	definitions: readonly TaxonomyArchiveDefinition[] | null,
): TaxonomyIndexingModel {
	const chosen = uniqueTaxonomyNames(rules.selected);
	const lists = { ...rules, selected: chosen };
	const listedNames = new Set<string>();
	const listed: TaxonomyIndexingModel["listed"] = [];
	for (const definition of definitions ?? []) {
		if (listedNames.has(definition.name)) continue;
		listedNames.add(definition.name);
		listed.push({
			name: definition.name,
			label: definition.label.trim() || definition.name,
			status: listedIndexingRuleStatus("archive", lists, definition.name),
		});
	}
	const addable = listed.filter((item) => item.status.own === "index").length;
	const fitsLimit = chosen.length + addable <= TAXONOMY_ARCHIVE_NOINDEX_LIMIT;
	const editable = !rules.siteNoindex;
	return {
		listed,
		unlisted: chosen.filter((name) => !listedNames.has(name)),
		selected: chosen,
		atLimit: chosen.length >= TAXONOMY_ARCHIVE_NOINDEX_LIMIT,
		addable,
		fitsLimit,
		editable,
		canSelectAll: editable && addable > 0 && fitsLimit,
		canClear: editable && listed.some((item) => item.status.own === "noindex"),
	};
}

/** Adding past the limit leaves the selection unchanged. */
export function toggleTaxonomyArchive(selected: readonly string[], name: string, checked: boolean): string[] {
	const chosen = uniqueTaxonomyNames(selected);
	if (!checked) return chosen.filter((item) => item !== name);
	if (chosen.includes(name) || chosen.length >= TAXONOMY_ARCHIVE_NOINDEX_LIMIT) return chosen;
	return [...chosen, name];
}

/** All-or-nothing: a Set all to Noindex that would pass the limit adds nothing. */
export function selectAllTaxonomyArchives(
	selected: readonly string[],
	definitions: readonly Pick<TaxonomyArchiveDefinition, "name">[],
): string[] {
	const chosen = uniqueTaxonomyNames(selected);
	const additions = uniqueTaxonomyNames(definitions.map((item) => item.name)).filter((name) => !chosen.includes(name));
	return chosen.length + additions.length <= TAXONOMY_ARCHIVE_NOINDEX_LIMIT ? [...chosen, ...additions] : chosen;
}

/** Clears listed names only; unlisted selections need their own explicit removal. */
export function clearListedTaxonomyArchives(
	selected: readonly string[],
	definitions: readonly Pick<TaxonomyArchiveDefinition, "name">[],
): string[] {
	const listed = new Set(definitions.map((item) => item.name));
	return uniqueTaxonomyNames(selected).filter((name) => !listed.has(name));
}

export function TaxonomyIndexingControls({
	selected,
	saved,
	definitions,
	loading,
	error,
	validationError,
	truncated = false,
	disabled,
	siteNoindex,
	savedSiteNoindex,
	unconfirmed = false,
	onChange,
	onRetry,
}: TaxonomyIndexingControlsProps) {
	const { t } = useSeoI18n();
	const id = React.useId();
	const headingRef = React.useRef<HTMLHeadingElement>(null);
	const removeButtons = React.useRef(new Map<string, HTMLButtonElement>());
	const model = taxonomyIndexingModel({ selected, saved, siteNoindex, savedSiteNoindex }, definitions);
	const headingId = `${id}-heading`;
	const descriptionId = `${id}-description`;
	const errorId = `${id}-error`;
	const limitId = `${id}-limit`;
	const unlistedId = `${id}-unlisted`;
	const limitMessage = !model.editable ? "" : model.atLimit
		? t("indexing.archives.limit", { limit: TAXONOMY_ARCHIVE_NOINDEX_LIMIT })
		: model.addable > 0 && !model.fitsLimit
			? t("indexing.archives.limitSetAll", { limit: TAXONOMY_ARCHIVE_NOINDEX_LIMIT })
			: "";
	const listDescription = [validationError ? errorId : "", limitMessage ? limitId : ""].filter(Boolean).join(" ");

	const change = (next: string[]) => {
		if (!sameTaxonomyNames(next, selected)) onChange(next);
	};
	// Each of these actions disables or unmounts the focused button, so focus moves
	// before the re-render to the heading, which exists in every state.
	const changeAndKeepFocus = (next: string[]) => {
		change(next);
		headingRef.current?.focus();
	};
	const retry = () => {
		headingRef.current?.focus();
		onRetry();
	};
	const remove = (name: string, index: number) => {
		const neighbour = model.unlisted[index + 1] ?? model.unlisted[index - 1];
		change(toggleTaxonomyArchive(selected, name, false));
		// The neighbour keeps its node across the re-render; the removed button does not.
		const target = neighbour ? removeButtons.current.get(neighbour) : undefined;
		if (target) target.focus();
		else headingRef.current?.focus();
	};

	return (
		<section className="shipit-seo-taxonomy-indexing" aria-labelledby={headingId} aria-describedby={descriptionId}>
			<div className="shipit-seo-taxonomy-indexing__head">
				<div>
					<h3 id={headingId} ref={headingRef} tabIndex={-1}>{t("indexing.archives.title")}</h3>
					<p id={descriptionId}>{t("indexing.archives.effect")}</p>
				</div>
			</div>

			{error ? (
				<Banner
					role="alert"
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={definitions === null ? t("indexing.archives.loadFailed") : t("indexing.archives.refreshFailed")}
					description={error}
					action={
						<Button type="button" size="sm" variant="secondary" disabled={loading} onClick={retry}>
							{t("indexing.archives.retry")}
						</Button>
					}
				/>
			) : null}
			{/* Stays mounted so a screen reader announces the text change. */}
			<p className={definitions === null && loading ? "shipit-seo-taxonomy-indexing__state" : "sr-only"} role="status">
				{definitions === null && loading ? t("indexing.archives.loading") : ""}
			</p>
			{definitions === null && !loading && !error ? (
				<div className="shipit-seo-taxonomy-indexing__state">
					<p>{t("indexing.archives.notLoaded")}</p>
					<Button type="button" size="sm" variant="secondary" onClick={retry}>{t("indexing.archives.load")}</Button>
				</div>
			) : null}
			{definitions !== null && model.listed.length === 0 ? (
				<p className="shipit-seo-taxonomy-indexing__state">{t("indexing.archives.empty")}</p>
			) : null}
			{definitions !== null && truncated ? (
				<p className="shipit-seo-taxonomy-indexing__note shipit-seo-taxonomy-indexing__note--alert" role="note">
					<WarningCircle size={16} aria-hidden="true" />
					<span>{t("indexing.archives.truncated")}</span>
				</p>
			) : null}

			{model.listed.length ? (
				<fieldset className="shipit-seo-indexing-list" aria-describedby={listDescription || undefined}>
					<legend className="sr-only">{t("indexing.archives.legend")}</legend>
					<ul>
						{model.listed.map((item) => (
							<li key={item.name} className="shipit-seo-indexing-row">
								<strong className="shipit-seo-indexing-row__name">{item.label}</strong>
								<div className="shipit-seo-indexing-row__status">
									<IndexingSavedState effect={item.status.saved} />
									<IndexingPendingState effect={item.status.after} unconfirmed={unconfirmed} />
								</div>
								<IndexingRuleControl status={item.status} legend={t("indexing.archives.choiceFor", { taxonomy: item.label })}
									disabled={disabled} atLimit={model.atLimit} unconfirmed={unconfirmed}
									onChange={(choice) => change(toggleTaxonomyArchive(selected, item.name, choice === "noindex"))} />
							</li>
						))}
					</ul>
					<div className="shipit-seo-taxonomy-indexing__actions">
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={disabled || !model.canSelectAll}
							onClick={() => changeAndKeepFocus(selectAllTaxonomyArchives(selected, model.listed))}
						>
							{t("indexing.archives.setAllNoindex")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={disabled || !model.canClear}
							onClick={() => changeAndKeepFocus(clearListedTaxonomyArchives(selected, model.listed))}
						>
							{t("indexing.archives.setAllIndex")}
						</Button>
						<span id={limitId} role="status">{limitMessage}</span>
					</div>
				</fieldset>
			) : null}

			{model.unlisted.length ? (
				<div className="shipit-seo-taxonomy-indexing__unlisted" role="group" aria-labelledby={unlistedId}>
					<strong id={unlistedId}>{definitions === null ? t("indexing.archives.unloadedTitle") : t("indexing.archives.unlistedTitle")}</strong>
					<p>
						{definitions === null
							? t("indexing.archives.unloadedHelp")
							: truncated
								? t("indexing.archives.truncatedHelp")
								: t("indexing.archives.unlistedHelp")}
					</p>
					<ul>
						{model.unlisted.map((name, index) => (
							<li key={name}>
								<code>{name}</code>
								<Button
									ref={(node: HTMLButtonElement | null) => {
										if (node) removeButtons.current.set(name, node);
										else removeButtons.current.delete(name);
									}}
									type="button"
									size="sm"
									variant="ghost"
									aria-label={t("indexing.archives.removeNamed", { taxonomy: name })}
									disabled={disabled}
									onClick={() => remove(name, index)}
								>
									{t("indexing.archives.remove")}
								</Button>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{validationError ? (
				<p id={errorId} className="shipit-seo-form-error" role="alert">{validationError}</p>
			) : null}
		</section>
	);
}
