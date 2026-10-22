import type { SeoAdminEntryPreview } from "../admin-contract.ts";
import {
	createNativeSeoEditorState,
	validateNativeSeoDraft,
	type NativeSeoEditorState,
	type NativeSeoField,
	type NativeSeoSnapshot,
	type NativeSeoTarget,
} from "./native-seo-editor-state.ts";
import type { NativeSeoImageFallback } from "./native-seo-image-fallback.ts";
import { createSerpPreviewModel, type SerpPreviewMetadata, type SerpPreviewModel } from "./serp-preview-model.ts";
import type { SocialEditorPreview } from "./social-editor-preview.ts";
import { buildSocialPreviewModel } from "./social-preview-model.ts";
import type { PreviewField, PreviewFieldInput } from "./snippet-preview.ts";

function coherentState(state: NativeSeoEditorState | null): state is NativeSeoEditorState & { baseline: NonNullable<NativeSeoEditorState["baseline"]> } {
	if (!state?.baseline) return false;
	try {
		return createNativeSeoEditorState(state.target, state.baseline).baseline !== null;
	} catch { return false; }
}

function nativeValue(value: string | null): string | null {
	return value === null || !value.trim() ? null : value;
}

function changedField(
	state: NativeSeoEditorState & { baseline: NonNullable<NativeSeoEditorState["baseline"]> },
	allowedFields: readonly NativeSeoField[],
	field: NativeSeoField,
): boolean {
	return allowedFields.includes(field) && Object.prototype.hasOwnProperty.call(state.draft, field) &&
		!validateNativeSeoDraft(state.draft)[field] &&
		nativeValue(state.draft[field]!) !== state.baseline.values[field];
}

function fieldInput(field: PreviewField): PreviewFieldInput {
	return { value: field.value, source: field.source, unavailable: field.state === "unavailable" };
}

function reviewedSnapshot(state: NativeSeoEditorState): NativeSeoSnapshot | null {
	if (state.phase !== "conflict" || !state.reviewSnapshot) return null;
	try {
		return createNativeSeoEditorState(state.target, state.reviewSnapshot).baseline;
	} catch { return null; }
}

/**
 * Saved text only, never a draft: the baseline stays the write guard until the review choice.
 * A field a legacy record decides, whose facts are not current, or whose reported text already
 * describes the reviewed value keeps that reported text.
 */
function reviewedSearchPreview(
	base: SerpPreviewModel,
	preview: SeoAdminEntryPreview,
	target: NativeSeoTarget,
	reviewed: NativeSeoSnapshot,
	datePrefix: string,
): SerpPreviewModel {
	const ownership = preview.ownership;
	if (ownership?.status !== "current" || ownership.locale !== target.locale) return base;
	const saved: Partial<SerpPreviewMetadata> = {};
	for (const field of ["title", "description"] as const) {
		const facts = ownership.fields.find((item) => item.field === field);
		if (facts?.state !== "not-shadowed" || facts.core === reviewed.values[field]) continue;
		const value = reviewed.values[field];
		const fallback = field === "title" ? preview.search.fallbackTitle : preview.search.fallbackDescription;
		saved[field] = value !== null ? { value, source: "core-seo" }
			: typeof fallback === "string" ? { value: fallback, source: "Native SEO reviewed fallback" }
			: { value: null, source: "Native SEO reviewed fallback unavailable", unavailable: true };
	}
	if (!Object.keys(saved).length) return base;
	const updated = createSerpPreviewModel({
		device: base.device, datePrefix,
		saved: { title: saved.title ?? fieldInput(base.title), description: saved.description ?? fieldInput(base.description),
			permalink: fieldInput(base.permalink), canonical: fieldInput(base.canonical) },
	});
	return {
		...base,
		title: saved.title ? updated.title : base.title,
		description: saved.description ? updated.description : base.description,
		fittedTitle: saved.title ? updated.fittedTitle : base.fittedTitle,
		fittedDescription: saved.description ? updated.fittedDescription : base.fittedDescription,
	};
}

/**
 * Native drafts decorate the card only; stored metadata, URLs and analysis remain separate.
 * An open review describes the saved values under review, as the fields do, whatever is editable.
 */
export function buildNativeSeoSearchPreview(
	base: SerpPreviewModel,
	preview: SeoAdminEntryPreview,
	state: NativeSeoEditorState | null,
	allowedFields: readonly NativeSeoField[],
	datePrefix: string,
): SerpPreviewModel {
	if (!coherentState(state) || state.target.collection !== preview.content.collection ||
		state.target.entryId !== preview.content.entryId ||
		preview.content.ref !== `${state.target.collection}:${state.target.entryId}`) return base;
	const reviewed = reviewedSnapshot(state);
	if (reviewed) return reviewedSearchPreview(base, preview, state.target, reviewed, datePrefix);
	const draft: Partial<SerpPreviewMetadata> = {};
	for (const field of ["title", "description"] as const) {
		if (!changedField(state, allowedFields, field)) continue;
		const value = nativeValue(state.draft[field]!);
		const fallback = field === "title" ? preview.search.fallbackTitle : preview.search.fallbackDescription;
		draft[field] = value !== null ? { value, source: "Native SEO draft" }
			: typeof fallback === "string" ? { value: fallback, source: "Native SEO inherited fallback" }
			: { value: null, source: "Native SEO inherited fallback unavailable", unavailable: true };
	}
	if (!Object.keys(draft).length) return base;
	const updated = createSerpPreviewModel({
		device: base.device, datePrefix,
		saved: { title: fieldInput(base.title), description: fieldInput(base.description),
			permalink: fieldInput(base.permalink), canonical: fieldInput(base.canonical) },
		draft,
	});
	return {
		...base,
		title: draft.title ? updated.title : base.title,
		description: draft.description ? updated.description : base.description,
		fittedTitle: draft.title ? updated.fittedTitle : base.fittedTitle,
		fittedDescription: draft.description ? updated.fittedDescription : base.fittedDescription,
		isDraft: true,
	};
}

function imageCaption(base: SocialEditorPreview): string {
	const basis = [base.fieldBasis.title, base.fieldBasis.description];
	const notes = [
		...(basis.includes("unavailable") ? ["Some sharing text could not be read."] : basis.includes("local") ? ["Sharing text is unsaved."] : []),
		...(base.fieldBasis.url === "unavailable" ? ["The page address could not be read."] : []),
	];
	return ["Unsaved sharing image.", ...notes].join(" ");
}

/**
 * The target is supplied separately because the social presentation carries no entry identity.
 * A cleared image previews the server-reported fallback; without one it stays unavailable.
 * The caption only marks the change: the image field's status line names what sharing uses after saving.
 */
export function buildNativeSeoSocialPreview(
	base: SocialEditorPreview,
	state: NativeSeoEditorState | null,
	allowedFields: readonly NativeSeoField[],
	target: { ref: string; locale: string | null },
	fallback?: NativeSeoImageFallback | null,
): SocialEditorPreview {
	if (!coherentState(state) || base.context.targetMismatch ||
		target.ref !== `${state.target.collection}:${state.target.entryId}` ||
		target.locale !== state.target.locale || !changedField(state, allowedFields, "image")) return base;
	const value = nativeValue(state.draft.image!);
	const image = value !== null ? { value, source: "Native SEO image draft" }
		: fallback ? { value: fallback.value, source: "Native SEO image fallback" }
		: { value: null, source: "Native SEO image clear awaits refreshed metadata", unavailable: true };
	const updated = buildSocialPreviewModel({
		platform: base.model.profile.platform,
		saved: { title: fieldInput(base.model.fields.title), description: fieldInput(base.model.fields.description),
			image: fieldInput(base.model.fields.image), url: fieldInput(base.model.fields.url) },
		draft: { image },
	});
	return {
		...base,
		model: { ...base.model, fields: { ...base.model.fields, image: updated.fields.image },
			imageState: updated.imageState, isDraft: true },
		fieldBasis: { ...base.fieldBasis, image: value === null && !fallback ? "unavailable" : "local" },
		caption: imageCaption(base),
	};
}
