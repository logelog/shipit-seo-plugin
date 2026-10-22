import { Radio } from "@cloudflare/kumo/components/radio";
import { Eye, EyeSlash, LockSimple, PencilSimple } from "@phosphor-icons/react";

import { useSeoI18n } from "./i18n/index.ts";
import {
	indexingChoiceText,
	indexingEffectText,
	type IndexingChoice,
	type IndexingEffect,
	type IndexingRuleStatus,
} from "./indexing-rules-model.ts";

export function IndexingSavedState({ effect, withSource = true }: { effect: IndexingEffect; withSource?: boolean }) {
	const { t } = useSeoI18n();
	const Icon = effect.choice === "index" ? Eye : EyeSlash;
	return (
		<p className="shipit-seo-indexing-state" data-choice={effect.choice}>
			<Icon size={16} aria-hidden="true" />
			<span>{indexingEffectText(effect, t, withSource)}</span>
		</p>
	);
}

/** While a save is not confirmed the stored settings may already hold the draft, so the tag never says Unsaved. */
function pendingTag(t: ReturnType<typeof useSeoI18n>["t"], unconfirmed: boolean): string {
	return unconfirmed ? t("indexing.status.unconfirmed") : t("indexing.pending.tag");
}

export function IndexingPendingState({ effect, withSource = true, unconfirmed = false }: {
	effect: IndexingEffect | null;
	withSource?: boolean;
	unconfirmed?: boolean;
}) {
	const { t } = useSeoI18n();
	if (!effect) return null;
	return (
		<p className="shipit-seo-indexing-pending">
			<PencilSimple size={14} aria-hidden="true" />
			<span>{t("indexing.pending.after", { state: indexingEffectText(effect, t, withSource) })}</span>
			<span className="shipit-seo-indexing-tag">{pendingTag(t, unconfirmed)}</span>
		</p>
	);
}

export function IndexingChoiceGroup({ legend, value, disabled, noindexDisabled = false, onChange }: {
	legend: string;
	value: IndexingChoice;
	disabled: boolean;
	noindexDisabled?: boolean;
	onChange: (choice: IndexingChoice) => void;
}) {
	const { t } = useSeoI18n();
	return (
		<Radio.Group orientation="horizontal" value={value} disabled={disabled} className="shipit-seo-indexing-choice"
			onValueChange={(next) => { if ((next === "index" || next === "noindex") && next !== value) onChange(next); }}>
			<Radio.Legend className="sr-only">{legend}</Radio.Legend>
			<Radio.Item value="index" label={t("indexing.state.index")} />
			<Radio.Item value="noindex" label={t("indexing.state.noindex")} disabled={noindexDisabled} />
		</Radio.Group>
	);
}

/** While the draft has site-wide noindex the own rule is shown, not offered: it is kept for when site-wide is Index again. */
export function IndexingRuleControl({ status, legend, disabled, atLimit, unconfirmed = false, onChange }: {
	status: IndexingRuleStatus;
	legend: string;
	disabled: boolean;
	atLimit: boolean;
	unconfirmed?: boolean;
	onChange: (choice: IndexingChoice) => void;
}) {
	const { t } = useSeoI18n();
	if (status.editable) {
		return <IndexingChoiceGroup legend={legend} value={status.own} disabled={disabled}
			noindexDisabled={atLimit && status.own === "index"} onChange={onChange} />;
	}
	return (
		<p className="shipit-seo-indexing-kept">
			<LockSimple size={14} aria-hidden="true" />
			<span>{t("indexing.kept", { state: indexingChoiceText(status.own, t) })}</span>
			{status.ownUnsaved ? <span className="shipit-seo-indexing-tag">{pendingTag(t, unconfirmed)}</span> : null}
		</p>
	);
}
