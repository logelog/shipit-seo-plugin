import type { SeoAdminTemplateField } from "@shipitseo/emdash-plugin-seo/admin-contract";

import type { currentTemplatePreview } from "./metadata-templates-model.ts";

/** More content types than this always use the Select, at every width. */
export const TEMPLATE_TYPE_LIST_MAX = 4;

export function templateTypePickerMode(count: number): "list" | "select" {
	return count > TEMPLATE_TYPE_LIST_MAX ? "select" : "list";
}

export function templateTypeLabel(label: string, edited: boolean): string {
	return edited ? `${label} (edited)` : label;
}

/** Variables go to the template field focused last; before any focus, the title field. */
export const TEMPLATE_DEFAULT_INSERT_FIELD: SeoAdminTemplateField = "title";

/** A missing or out-of-range caret inserts at the end; a selection is replaced. */
export function insertTemplateVariable(
	value: string,
	variable: string,
	start: number | null | undefined,
	end: number | null | undefined,
): { value: string; caret: number } {
	const token = `{{${variable}}}`;
	const bound = (position: number | null | undefined) =>
		typeof position === "number" && Number.isInteger(position) && position >= 0 && position <= value.length ? position : value.length;
	const from = bound(start);
	const to = Math.max(from, bound(end ?? start));
	return { value: value.slice(0, from) + token + value.slice(to), caret: from + token.length };
}

/** Examples come only from a settled preview of the current form and example; anything else shows none. */
export function templateFieldExamples(
	view: ReturnType<typeof currentTemplatePreview>,
): Record<SeoAdminTemplateField, string> | null {
	if (view.kind !== "settled" || view.outcome.kind !== "result" || !view.outcome.result.success) return null;
	const preview = view.outcome.result.preview;
	return {
		title: preview.titleSuggestion.value,
		description: preview.description.value,
		socialTitle: preview.socialTitle.value,
		socialDescription: preview.socialDescription.value,
	};
}
