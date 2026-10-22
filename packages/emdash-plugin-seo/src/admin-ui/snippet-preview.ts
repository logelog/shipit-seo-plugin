export {
	SNIPPET_PREVIEW_INPUT_LIMIT,
	SNIPPET_PREVIEW_PROFILES,
	fitSnippetPreviewText,
	measureSnippetPreviewText,
	snippetTextProfile,
	truncateSnippetPreviewText,
} from "../snippet-metrics.ts";
export type {
	FittedSnippetText,
	MeasuredSnippetPreviewProfile,
	SnippetPreviewProfile,
	SnippetTextProfile,
} from "../snippet-metrics.ts";

export interface PreviewFieldInput {
	value: string | null;
	source: string;
	unavailable?: boolean;
}

export interface PreviewField {
	value: string | null;
	source: string;
	state: "saved" | "draft" | "unavailable";
}

// A patch contains a resolved value, including the source of any cleared-field fallback.
export function resolvePreviewField(saved: PreviewFieldInput, changed?: PreviewFieldInput): PreviewField {
	const field = changed ?? saved;
	return {
		value: field.unavailable ? null : field.value,
		source: field.source,
		state: field.unavailable ? "unavailable" : changed === undefined ? "saved" : "draft",
	};
}
