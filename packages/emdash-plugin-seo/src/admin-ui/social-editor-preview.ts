import type { SeoAdminEntryPreview, SeoAdminSocialOverrideSnapshot } from "../admin-contract.ts";
import { normaliseSocialSaveValues, type SocialSaveState, type SocialSaveTarget } from "./social-save-state.ts";
import {
	buildSocialPreviewModel,
	type SocialPreviewFields,
	type SocialPreviewFieldBasis,
	type SocialPreviewModel,
	type SocialPreviewPlatform,
} from "./social-preview-model.ts";
import type { PreviewFieldInput } from "./snippet-preview.ts";

export interface SocialEditorPreviewDraft {
	customizing: boolean;
	title?: string;
	description?: string;
}

export interface SocialEditorPreviewLoaded {
	target: SocialSaveTarget;
	preview: Pick<SeoAdminEntryPreview, "content" | "social" | "search" | "sources">;
	/** A metadata read that follows the latest canonical acknowledgement/readback. */
	receivedAfterCanonicalChange?: boolean;
}

export interface SocialEditorPreviewInput {
	target: SocialSaveTarget;
	state: SocialSaveState;
	draft: SocialEditorPreviewDraft | null;
	loaded: SocialEditorPreviewLoaded | null;
	platform: SocialPreviewPlatform;
	previewError?: boolean;
}

export interface SocialEditorPreview {
	model: SocialPreviewModel;
	fieldBasis: Record<keyof SocialPreviewFields, SocialPreviewFieldBasis>;
	caption: string;
	context: {
		metadataCurrent: boolean;
		metadataNeedsRefresh: boolean;
		hasLocalChanges: boolean;
		persistenceUncertain: boolean;
		clearMayRevealAlias: boolean;
		targetMismatch: boolean;
	};
}

function sameTarget(left: SocialSaveTarget, right: SocialSaveTarget): boolean {
	return left.ref === right.ref && left.locale === right.locale;
}

function snapshotValues(snapshot: SeoAdminSocialOverrideSnapshot | null) {
	return normaliseSocialSaveValues({
		title: snapshot?.override?.title ?? "",
		description: snapshot?.override?.description ?? "",
	});
}

function sameSnapshot(left: SeoAdminSocialOverrideSnapshot, right: SeoAdminSocialOverrideSnapshot): boolean {
	const a = snapshotValues(left);
	const b = snapshotValues(right);
	return left.ref === right.ref && left.revision === right.revision &&
		a.title === b.title && a.description === b.description;
}

const unavailable = (): PreviewFieldInput => ({
	value: null, source: "Unresolved sharing metadata", unavailable: true,
});

/** Cards describe available field evidence; persistence state never hides the card. */
export function buildSocialEditorPreview(input: SocialEditorPreviewInput): SocialEditorPreview {
	const stateMatches = sameTarget(input.target, input.state.target);
	const baseline = stateMatches && input.state.baseline?.ref === input.target.ref
		? input.state.baseline : null;
	const loadedMatches = Boolean(input.loaded && sameTarget(input.target, input.loaded.target) &&
		input.loaded.preview.content.ref === input.target.ref);
	const loaded = loadedMatches ? input.loaded!.preview : null;
	const loadedSnapshot = loaded?.social.editing.state === "ready" ? loaded.social.editing.snapshot : null;
	const observedAbsence = baseline?.override === null && input.state.sequence > 0;
	// Absence has no unique revision; matching null cannot order a create/delete cycle.
	const metadataCurrent = Boolean(baseline && loadedSnapshot && !input.previewError &&
		input.state.editing.state === "ready" &&
		(!input.state.reviewSnapshot || sameSnapshot(baseline, input.state.reviewSnapshot)) &&
		sameSnapshot(baseline, loadedSnapshot) &&
		(!observedAbsence || input.loaded?.receivedAfterCanonicalChange === true));
	const baselineValues = snapshotValues(baseline);
	const draft = stateMatches ? input.draft : null;
	const values = draft ? normaliseSocialSaveValues(draft.customizing ? {
		title: draft.title ?? baselineValues.title,
		description: draft.description ?? baselineValues.description,
	} : { title: "", description: "" }) : baselineValues;
	const hasLocalChanges = Boolean(draft && (
		values.title !== baselineValues.title || values.description !== baselineValues.description
	));
	const recordPresent = Boolean(values.title || values.description);
	const clearingRecord = Boolean(draft && baseline?.override && !recordPresent);
	const clearMayRevealAlias = clearingRecord || Boolean(observedAbsence && !recordPresent && !metadataCurrent);
	const persistenceUncertain = stateMatches && input.state.phase !== "idle";
	const fieldBasis: SocialEditorPreview["fieldBasis"] = {
		title: "unavailable", description: "unavailable", image: "unavailable", url: "unavailable",
	};
	const saved: SocialPreviewFields = {
		title: unavailable(), description: unavailable(), image: unavailable(), url: unavailable(),
	};
	const local: Partial<SocialPreviewFields> = {};
	const fallback = (field: "title" | "description"): PreviewFieldInput => loaded
		? { value: field === "title" ? loaded.social.fallbackTitle : loaded.social.fallbackDescription,
			source: "Social fallback source not reported" }
		: unavailable();

	for (const field of ["title", "description"] as const) {
		const changed = Boolean(draft && values[field] !== baselineValues[field]);
		if (clearMayRevealAlias || (draft && !baseline && !recordPresent)) {
			if (draft) local[field] = unavailable();
			continue;
		}
		if (draft && values[field] && (changed || persistenceUncertain || !baseline)) {
			local[field] = { value: values[field], source: "plugin-social-override" };
			fieldBasis[field] = "local";
		} else if (baselineValues[field] && !changed) {
			saved[field] = { value: baselineValues[field], source: "plugin-social-override" };
			fieldBasis[field] = "confirmed";
		} else if (baseline?.override || (draft && recordPresent)) {
			saved[field] = fallback(field);
			fieldBasis[field] = loaded ? "loaded" : "unavailable";
			if (changed) local[field] = saved[field];
		} else if (loaded) {
			saved[field] = { value: loaded.social[field],
				source: field === "title" ? loaded.sources.socialTitle : loaded.sources.socialDescription };
			fieldBasis[field] = "loaded";
		}
	}
	if (loaded) {
		saved.image = { value: loaded.social.image, source: loaded.sources.image };
		saved.url = { value: loaded.search.url, source: loaded.sources.canonical };
		fieldBasis.image = "loaded";
		fieldBasis.url = "loaded";
	}
	const hasUnavailableText = fieldBasis.title === "unavailable" || fieldBasis.description === "unavailable";
	const hasLocalText = fieldBasis.title === "local" || fieldBasis.description === "local";
	const hasConfirmedText = fieldBasis.title === "confirmed" || fieldBasis.description === "confirmed";
	const caption = hasUnavailableText
		? hasLocalText || hasLocalChanges
			? "Local preview. Some sharing text awaits refreshed metadata."
			: hasConfirmedText
				? "Confirmed sharing text. Some inherited text awaits refreshed metadata."
				: "Sharing text awaits refreshed metadata."
		: hasLocalText
			? `${persistenceUncertain ? "Sharing text not confirmed yet." : "Unsaved sharing text."}${loaded ? "" : " The image and URL are unavailable."}`
			: hasConfirmedText
				? loaded ? "Saved sharing text." : "Saved sharing text. The image and URL are unavailable."
				: "Saved values";
	return {
		model: buildSocialPreviewModel({ platform: input.platform, saved, draft: local }),
		fieldBasis,
		caption,
		context: {
			metadataCurrent, metadataNeedsRefresh: !metadataCurrent, hasLocalChanges,
			persistenceUncertain, clearMayRevealAlias,
			targetMismatch: !stateMatches || Boolean(input.loaded && !loadedMatches),
		},
	};
}
