import {
	fitSnippetPreviewText,
	resolvePreviewField,
	snippetTextProfile,
	type FittedSnippetText,
	type PreviewField,
	type PreviewFieldInput,
	type SnippetTextProfile,
} from "./snippet-preview.ts";

export type SocialPreviewPlatform = "facebook" | "x";
export type SocialPreviewImageState = "available" | "missing" | "unavailable";
export type SocialPreviewFieldBasis = "local" | "confirmed" | "loaded" | "unavailable";

export interface SocialPreviewProfile {
	readonly platform: SocialPreviewPlatform;
	readonly approximate: true;
	readonly title: SnippetTextProfile;
	readonly description: SnippetTextProfile;
	readonly imageAspectRatio: number;
	readonly caveat: string;
}

export const SOCIAL_PREVIEW_PROFILES: Readonly<Record<SocialPreviewPlatform, SocialPreviewProfile>> = Object.freeze({
	facebook: Object.freeze({
		platform: "facebook",
		approximate: true,
		title: Object.freeze(snippetTextProfile(500, 18, 2, "bold")),
		description: Object.freeze(snippetTextProfile(500, 14, 2)),
		imageAspectRatio: 1.91,
		caveat: "Approximate layout. Meta can change the displayed text and card presentation.",
	}),
	x: Object.freeze({
		platform: "x",
		approximate: true,
		title: Object.freeze(snippetTextProfile(500, 16, 2, "bold")),
		description: Object.freeze(snippetTextProfile(500, 14, 2)),
		imageAspectRatio: 1.91,
		caveat: "Approximate layout. Current X presentation is unverified and may differ from this profile.",
	}),
});

export interface SocialPreviewFields {
	title: PreviewFieldInput;
	description: PreviewFieldInput;
	image: PreviewFieldInput;
	url: PreviewFieldInput;
}

export interface SocialPreviewModel {
	fields: {
		title: PreviewField;
		description: PreviewField;
		image: PreviewField;
		url: PreviewField;
	};
	fittedTitle: FittedSnippetText;
	fittedDescription: FittedSnippetText;
	imageState: SocialPreviewImageState;
	profile: SocialPreviewProfile;
	isDraft: boolean;
}

/** Draft patches contain resolved social fields, never a generic search dirty flag. */
export function buildSocialPreviewModel(input: {
	platform: SocialPreviewPlatform;
	saved: SocialPreviewFields;
	draft?: Partial<SocialPreviewFields>;
}): SocialPreviewModel {
	const profile = SOCIAL_PREVIEW_PROFILES[input.platform];
	const fields = {
		title: resolvePreviewField(input.saved.title, input.draft?.title),
		description: resolvePreviewField(input.saved.description, input.draft?.description),
		image: resolvePreviewField(input.saved.image, input.draft?.image),
		url: resolvePreviewField(input.saved.url, input.draft?.url),
	};
	const imageState = fields.image.state === "unavailable"
		? "unavailable"
		: fields.image.value?.trim()
			? "available"
			: "missing";
	return {
		fields,
		fittedTitle: fitSnippetPreviewText(fields.title.value ?? "", profile.title),
		fittedDescription: fitSnippetPreviewText(fields.description.value ?? "", profile.description),
		imageState,
		profile,
		isDraft: [input.draft?.title, input.draft?.description, input.draft?.image, input.draft?.url]
			.some((field) => field !== undefined),
	};
}
