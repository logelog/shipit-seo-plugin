import {
	fitSnippetPreviewText, resolvePreviewField, SNIPPET_PREVIEW_PROFILES,
} from "./snippet-preview.ts";
import type {
	FittedSnippetText, PreviewField, PreviewFieldInput, MeasuredSnippetPreviewProfile,
} from "./snippet-preview.ts";

export type SerpPreviewDevice = keyof typeof SNIPPET_PREVIEW_PROFILES;

export interface SerpPreviewMetadata {
	title: PreviewFieldInput;
	description: PreviewFieldInput;
	permalink: PreviewFieldInput;
	canonical: PreviewFieldInput;
}

export interface SerpPreviewInput {
	device: SerpPreviewDevice;
	saved: SerpPreviewMetadata;
	// Only fields changed under the host draft contract belong here.
	draft?: Partial<SerpPreviewMetadata>;
	datePrefix?: string;
}

export interface SerpPreviewModel {
	device: SerpPreviewDevice;
	profile: MeasuredSnippetPreviewProfile;
	title: PreviewField;
	description: PreviewField;
	permalink: PreviewField;
	canonical: PreviewField;
	displayUrl: string | null;
	fittedTitle: FittedSnippetText;
	fittedDescription: FittedSnippetText;
	isDraft: boolean;
	approximation: string;
}

// The host/resolver supplies permalink and canonical separately; neither is inferred from a slug.
export function createSerpPreviewModel(input: SerpPreviewInput): SerpPreviewModel {
	const profile = SNIPPET_PREVIEW_PROFILES[input.device];
	const title = resolvePreviewField(input.saved.title, input.draft?.title);
	const description = resolvePreviewField(input.saved.description, input.draft?.description);
	const permalink = resolvePreviewField(input.saved.permalink, input.draft?.permalink);
	const canonical = resolvePreviewField(input.saved.canonical, input.draft?.canonical);
	return {
		device: input.device, profile, title, description, permalink, canonical,
		displayUrl: canonical.value,
		fittedTitle: fitSnippetPreviewText(title.value ?? "", profile.title),
		fittedDescription: fitSnippetPreviewText(description.value ?? "", profile.description, input.datePrefix),
		isDraft: [input.draft?.title, input.draft?.description, input.draft?.permalink, input.draft?.canonical]
			.some((field) => field !== undefined),
		approximation: "Approximate preview. Google may choose different titles, snippets and URLs.",
	};
}
