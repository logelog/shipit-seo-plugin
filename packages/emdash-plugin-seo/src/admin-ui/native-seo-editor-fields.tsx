import { Button } from "@cloudflare/kumo/components/button";
import { MediaPickerModal } from "@emdash-cms/admin";
import { ArrowCounterClockwise, FloppyDisk, ImageSquare, Trash } from "@phosphor-icons/react";
import type { SeoAdminEntryPreview } from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as React from "react";

import { seoSnippetCutPoint, seoSnippetFit, type SeoSnippetDeviceFit } from "../snippet-fit.ts";
import { selectedLocalMediaUrl } from "./local-media.ts";
import { nativeSeoImageFallbackSentence } from "./native-seo-image-fallback.ts";
import {
	canCloseNativeSeoEditor,
	canSaveNativeSeoValues,
	nativeSeoChangedFields,
	NATIVE_SEO_DESCRIPTION_MAX_LENGTH,
	NATIVE_SEO_IMAGE_MAX_LENGTH,
	NATIVE_SEO_TITLE_MAX_LENGTH,
	type NativeSeoDraft,
	type NativeSeoEditorState,
	type NativeSeoField,
} from "./native-seo-editor-state.ts";

export interface NativeSeoEditorController {
	state: NativeSeoEditorState | null;
	loading: boolean;
	unavailable: boolean;
	allowedFields?: readonly NativeSeoField[];
	/** The preview still describes older saved values than the editor holds; fields wait for it. */
	previewUpdating?: boolean;
	/** Unsaved edits kept from an earlier visit to this entry in this page session. */
	restoredDraft?: boolean;
	change(patch: NativeSeoDraft): void;
	save(): void;
	read(): void;
	review(keep: boolean): void;
	discard(): void;
}

interface NativeSeoFieldsProps {
	controller: NativeSeoEditorController;
	preview: SeoAdminEntryPreview;
	/** Shown on a field a current legacy record decides; names the brand's Migration page. */
	legacyGuidance?: string | null;
}

interface NativeSeoTextFieldsProps extends NativeSeoFieldsProps {
	/** The date the search preview shows before the description; the estimate measures it too. */
	datePrefix?: string;
}

export interface NativeSeoImageFieldProps extends NativeSeoFieldsProps {
	pickerOpen: boolean;
	onPickerOpenChange(open: boolean): void;
	pickerError?: string | null;
	onPickerError(error: string | null): void;
}

function permitted(controller: NativeSeoEditorController, field: NativeSeoField): boolean {
	return controller.allowedFields?.includes(field) === true;
}

function editable(controller: NativeSeoEditorController, field: NativeSeoField): boolean {
	const { state } = controller;
	return !controller.loading && !controller.unavailable && Boolean(state?.baseline) &&
		!state?.writePending && !state?.readback && permitted(controller, field);
}

function fieldValue(state: NativeSeoEditorState | null, field: NativeSeoField): string {
	// Until the review choice the baseline stays the write guard, while fields show the saved values under review.
	const saved = state?.phase === "conflict" && state.reviewSnapshot ? state.reviewSnapshot : state?.baseline;
	return Object.prototype.hasOwnProperty.call(state?.draft ?? {}, field)
		? state!.draft[field] ?? "" : saved?.values[field] ?? "";
}

function fieldId(controller: NativeSeoEditorController, field: NativeSeoField): string {
	const target = controller.state?.target;
	const identity = target ? [target.collection, target.entryId, target.locale ?? ""].map(encodeURIComponent).join("-") : "unavailable";
	return `shipit-native-seo-${identity}-${field}`;
}

function FieldError({ state, field }: { state: NativeSeoEditorState | null; field: NativeSeoField }) {
	const error = state?.errors[field];
	if (!error) return null;
	return <p className="shipit-seo-native-social__field-help" role="alert">
		{error === "too_long" ? "This value exceeds the input limit." : field === "image" ? "Choose a supported local image." : "Enter a valid text value."}
	</p>;
}

const FIELD_NAMES: Readonly<Record<NativeSeoField, string>> = { title: "SEO title", description: "Meta description", image: "Sharing image" };
const OTHER_CHANGES_NOTE = "Save other changes first so EmDash does not ask you to confirm them.";
/**
 * EmDash stores SEO fields beside the entry, outside its drafts: a save reaches a
 * published page at once. The host exposes no dirty-draft signal, so the note
 * never depends on other unsaved changes.
 */
export function nativeSeoSaveScope(publicationStatus: string | null | undefined): string {
	if (publicationStatus === "published") return `Updates the live page now, even while other changes are still a draft. ${OTHER_CHANGES_NOTE}`;
	if (publicationStatus === "draft" || publicationStatus === "scheduled")
		return `Saves now with this unpublished entry. Visitors see these fields once it is published. ${OTHER_CHANGES_NOTE}`;
	return `Saves SEO fields now. ${OTHER_CHANGES_NOTE}`;
}
const FIT_DEVICE_NAMES: Readonly<Record<SeoSnippetDeviceFit["device"], string>> = { mobile: "phone", desktop: "desktop" };
/** The input limit is named only once a value reaches this share of it. */
const INPUT_LIMIT_NOTICE_SHARE = 0.9;

/** One counter format for native and Social fields: code points, with the limit named only near it. */
export function nativeSeoCharacterCount(value: string, limit: number): string {
	const count = [...value].length;
	return count >= limit * INPUT_LIMIT_NOTICE_SHARE ? `${count} characters, input limit ${limit}` : `${count} characters`;
}

/** The same estimate the Title fit and Description fit rows make; a blank value inherits and has none. */
function snippetFitEstimate(value: string, field: "title" | "description", datePrefix: string): { fits: SeoSnippetDeviceFit[]; text: string } | null {
	if (!value.trim()) return null;
	const fits = seoSnippetFit(value, field, datePrefix);
	const cut = fits.filter((fit) => fit.clipped);
	return {
		fits,
		text: cut.length
			? `May be cut on ${cut.map((fit) => `${FIT_DEVICE_NAMES[fit.device]} after "${seoSnippetCutPoint(fit.visible)}"`).join(" and ")} (estimate)`
			: "Fits phone and desktop (estimate)",
	};
}

export function NativeSeoTextFields({ controller, preview, legacyGuidance = null, datePrefix = "" }: NativeSeoTextFieldsProps) {
	return <div className="shipit-seo-native-social__fields" data-native-seo-fields>
		{(["title", "description"] as const).map((field) => {
			const value = fieldValue(controller.state, field);
			const id = fieldId(controller, field);
			const canEdit = editable(controller, field);
			const limit = field === "title" ? NATIVE_SEO_TITLE_MAX_LENGTH : NATIVE_SEO_DESCRIPTION_MAX_LENGTH;
			const estimate = canEdit ? snippetFitEstimate(value, field, datePrefix) : null;
			const placeholder = canEdit ? field === "title"
				? preview.search.fallbackTitle ?? ""
				: preview.search.fallbackDescription ?? "" : "";
			const common = {
				id, dir: "auto" as const, value, disabled: !canEdit, maxLength: limit, placeholder,
				"aria-describedby": `${id}-limit${estimate ? ` ${id}-fit` : ""} ${id}-help`,
				"aria-invalid": Boolean(controller.state?.errors[field]) || undefined,
				onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
					if (field === "title" && event.key === "Enter") event.preventDefault();
				},
				onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
					if (canEdit) controller.change({ [field]: event.target.value });
				},
			};
			return <div key={field} className="shipit-seo-native-social__field">
				<div className="shipit-seo-native-social__field-heading">
					<label htmlFor={id}>{field === "title" ? "SEO title" : "Meta description"}</label>
					<span id={`${id}-limit`}>{nativeSeoCharacterCount(value, limit)}</span>
				</div>
				{field === "title" ? <input {...common} type="text" /> : <textarea {...common} rows={3} />}
				{estimate ? <div className="shipit-seo-native-fit" data-fit={estimate.fits.some((fit) => fit.clipped) ? "cut" : "fits"}>
					<span className="shipit-seo-native-fit__meter" aria-hidden="true">
						{estimate.fits.map((fit) => <span key={fit.device} data-device={fit.device} data-fit={fit.clipped ? "cut" : "fits"} />)}
					</span>
					<span id={`${id}-fit`}>{estimate.text}</span>
				</div> : null}
				<p className="shipit-seo-native-social__field-help" id={`${id}-help`}>
					{ownerHelp(controller, field, recordHolder(preview, field, legacyGuidance)) ?? "Leave blank to inherit."}
				</p>
				<FieldError state={controller.state} field={field} />
			</div>;
		})}
	</div>;
}

export function NativeSeoImageField({
	controller, preview, legacyGuidance = null, pickerOpen, onPickerOpenChange, pickerError, onPickerError,
}: NativeSeoImageFieldProps) {
	const { state } = controller;
	const imageHelp = ownerHelp(controller, "image", recordHolder(preview, "image", legacyGuidance));
	const canEdit = editable(controller, "image");
	const value = fieldValue(state, "image");
	const imageChanged = Object.prototype.hasOwnProperty.call(state?.draft ?? {}, "image") &&
		(value.trim() ? value : null) !== (state?.baseline?.values.image ?? null);
	const cleared = imageChanged && !value.trim();
	const inherited = !preview.social.image ? null
		: preview.sources.image === "content" ? "the featured image"
		: preview.sources.image === "site-default" ? "the site sharing image" : "an inherited image";
	const message = !state?.baseline ? "No saved image value is available."
		: cleared ? `Custom image cleared. ${nativeSeoImageFallbackSentence(preview.social.fallbackImage)}`
		: imageChanged ? "Unsaved custom image."
		: value ? "Saved custom image."
		: inherited ? `No custom image. Sharing uses ${inherited}.` : "No custom sharing image.";
	return <section className="shipit-seo-native-social__field" aria-label="Sharing image" data-native-seo-image>
		<div className="shipit-seo-native-social__field-heading"><strong>Sharing image</strong></div>
		<p className="shipit-seo-native-social__field-help">Use a landscape image, for example 1200 x 630 px.</p>
		<p className="shipit-seo-native-social__field-help" role="status">{message}</p>
		{value ? <span className="sr-only">Custom image: {value}</span> : null}
		<div className="shipit-seo-snippet-dialog__view-tools">
			<Button type="button" variant="secondary" disabled={!canEdit} onClick={() => {
				if (!canEdit) return;
				onPickerError(null);
				onPickerOpenChange(true);
			}}><ImageSquare size={14} aria-hidden="true" />{value ? "Replace image" : "Choose image"}</Button>
			{value ? <Button type="button" variant="secondary" disabled={!canEdit} onClick={() => {
				if (!canEdit) return;
				onPickerError(null);
				controller.change({ image: null });
			}}><Trash size={14} aria-hidden="true" />Clear custom image</Button> : null}
		</div>
		{imageHelp ? <p className="shipit-seo-native-social__field-help">{imageHelp}</p> : null}
		{pickerError ? <p className="shipit-seo-native-social__field-help" role="alert">{pickerError}</p> : null}
		<FieldError state={state} field="image" />
		<MediaPickerModal open={pickerOpen && canEdit} onOpenChange={(open) => {
			if (!open || canEdit) onPickerOpenChange(open);
		}} localOnly mediaKind="image" mimeTypeFilters={["image/jpeg", "image/png", "image/webp", "image/gif"]}
			title="Choose sharing image" onSelect={(item) => {
				onPickerOpenChange(false);
				if (!canEdit) return;
				const url = selectedLocalMediaUrl(item.url);
				if (!url || url.length > NATIVE_SEO_IMAGE_MAX_LENGTH) {
					onPickerError("This image could not be used. Choose another image.");
					return;
				}
				onPickerError(null);
				controller.change({ image: url });
			}} />
	</section>;
}

const PREVIEW_UPDATING = "Updating the preview to the saved values...";

/** The guidance when a current legacy record decides the field, else null. */
function recordHolder(preview: SeoAdminEntryPreview, field: NativeSeoField, guidance: string | null): string | null {
	const ownership = preview.ownership;
	return guidance && ownership?.status === "current" && ownership.fields.some((value) =>
		value.field === field && (value.state === "conflict" || value.state === "equal")) ? guidance : null;
}

/** Why a loaded field is read-only, or null while it can be edited. */
function ownerHelp(controller: NativeSeoEditorController, field: NativeSeoField, holder: string | null = null): string | null {
	if (controller.loading || controller.unavailable || !controller.state?.baseline || permitted(controller, field)) return null;
	if (controller.state.phase === "conflict") return "Choose Keep my edits or Use saved values to edit again.";
	return controller.previewUpdating ? PREVIEW_UPDATING : holder ?? "Edit this field in its current owner.";
}

function draftIsPermitted(controller: NativeSeoEditorController): boolean {
	return Object.keys(controller.state?.draft ?? {}).every((field) => permitted(controller, field as NativeSeoField));
}

function saveNotice(controller: NativeSeoEditorController): string | null {
	const { state } = controller;
	if (controller.loading) return "Loading SEO fields...";
	if (controller.unavailable || !state) return "SEO fields are unavailable.";
	if (state.writePending) return "Saving SEO fields...";
	if (state.readback) return "Checking saved SEO values...";
	if (state.phase === "conflict") return "Saved SEO values changed. Your edits are kept.";
	if (state.phase === "unknown") return state.attempt
		? "Save not confirmed. Your edits are kept." : "Check saved SEO values before editing.";
	if (Object.keys(state.errors).length) return "Review the highlighted SEO fields.";
	if (state.problem === "rejected") return "SEO changes could not be saved. Your edits are kept.";
	if (state.problem === "locked") return "Another editor is holding this entry. Take over in EmDash before saving. Your edits are kept.";
	if (controller.previewUpdating) {
		if (nativeSeoChangedFields(state).length) return `${PREVIEW_UPDATING} Your edits are kept.`;
		return state.phase === "confirmed" ? `SEO values saved and checked. ${PREVIEW_UPDATING}` : PREVIEW_UPDATING;
	}
	if (!draftIsPermitted(controller)) return "Edit this field in its current owner. Your edits are kept.";
	if (state.problem === "not_saved") return "The saved SEO fields are unchanged, so the save did not complete. Your edits are kept; save again when ready.";
	if (controller.restoredDraft) return "Your unsaved SEO edits from earlier in this session are kept. Save or discard them.";
	if (canSaveNativeSeoValues(state)) return "Unsaved SEO changes.";
	if (state.phase === "confirmed") return "SEO values saved and checked.";
	return null;
}

function controlState(controller: NativeSeoEditorController) {
	const { state } = controller;
	const available = Boolean(state) && !controller.loading && !controller.unavailable;
	const busy = !available || Boolean(state?.writePending || state?.readback);
	const changed = state ? nativeSeoChangedFields(state) : [];
	return {
		state, busy, changed,
		canSave: Boolean(state && available && draftIsPermitted(controller) && canSaveNativeSeoValues(state)),
		canDiscard: Boolean(state && available && canCloseNativeSeoEditor(state) &&
			!state.attempt && state.phase !== "unknown" && state.phase !== "conflict" && Object.keys(state.draft).length),
	};
}

/**
 * A change, an attempt, a conflict or a field error keeps the native footer
 * controls on every tab; otherwise only the tabs that edit native fields show them.
 */
export function nativeSeoSaveOutstanding(controller: NativeSeoEditorController): boolean {
	const { state, changed } = controlState(controller);
	return Boolean(state && (changed.length || state.attempt || state.phase === "conflict" || Object.keys(state.errors).length));
}

/** True while native fields differ from their saved values; the native save is then the one primary action. */
export function nativeSeoHasChanges(controller: NativeSeoEditorController): boolean {
	return controlState(controller).changed.length > 0;
}

export function NativeSeoSaveStatus({ controller, publicationStatus }: {
	controller: NativeSeoEditorController;
	/** The saved entry's status, which decides when a save reaches visitors. */
	publicationStatus?: string | null;
}) {
	const { state, busy, changed } = controlState(controller);
	const reviewSnapshot = state?.phase === "conflict" ? state.reviewSnapshot : null;
	const notice = saveNotice(controller);
	if (!notice && !changed.length && !reviewSnapshot) return null;
	return <section data-native-seo-save aria-label="SEO field changes">
		{/* Focus lands here when a focused save control disables or unmounts. */}
		{notice ? <p className="shipit-seo-native-social__status" role="status" tabIndex={-1} data-native-seo-status>{notice}</p> : null}
		{changed.length ? <p className="shipit-seo-native-save__changed">Changed: {changed.map((field) => FIELD_NAMES[field]).join(", ")}</p> : null}
		{/* The scope note belongs to an enabled Save, which an open review keeps off. */}
		{changed.length && !reviewSnapshot ? <p className="shipit-seo-native-save__scope">{nativeSeoSaveScope(publicationStatus)}</p> : null}
		{reviewSnapshot ? <section className="shipit-seo-social-recovery shipit-seo-native-save__review" aria-label="Saved SEO values to review">
			<div className="shipit-seo-native-save__review-head">
				<strong>Last checked saved values</strong>
				<div className="shipit-seo-snippet-dialog__view-tools">
					<Button type="button" variant="secondary" disabled={busy} onClick={() => { if (!busy) controller.review(true); }}>Keep my edits</Button>
					<Button type="button" variant="secondary" disabled={busy} onClick={() => { if (!busy) controller.review(false); }}>Use saved values</Button>
				</div>
			</div>
			<dl>{(["title", "description", "image"] as const).map((field) => <React.Fragment key={field}>
				<dt>{field === "image" ? "Custom image" : FIELD_NAMES[field]}</dt>
				<dd dir="auto">{field !== "image" ? reviewSnapshot.values[field] || "No entry override"
					: !reviewSnapshot.values.image ? "No custom image"
					: reviewSnapshot.values.image === state?.baseline?.values.image ? "Same custom image as before" : "A different custom image"}</dd>
			</React.Fragment>)}</dl>
		</section> : null}
	</section>;
}

export function NativeSeoRecoveryActions({ controller }: { controller: NativeSeoEditorController }) {
	const { state, busy, canDiscard } = controlState(controller);
	return <>
		<Button type="button" variant="secondary" disabled={busy} onClick={() => { if (!busy) controller.read(); }}>
			<ArrowCounterClockwise size={14} aria-hidden="true" />Check saved SEO fields
		</Button>
		{Object.keys(state?.draft ?? {}).length ? <Button type="button" variant="secondary" disabled={!canDiscard} onClick={() => {
			if (canDiscard) controller.discard();
		}}>Discard SEO edits</Button> : null}
	</>;
}

/** Shown only while native fields differ from their saved values or a save is pending. */
export function NativeSeoSaveButton({ controller, primary }: { controller: NativeSeoEditorController; primary: boolean }) {
	const { state, changed, canSave } = controlState(controller);
	if (!changed.length && !state?.writePending) return null;
	return <Button type="button" variant={primary ? "primary" : "secondary"} disabled={!canSave} onClick={() => { if (canSave) controller.save(); }}>
		<FloppyDisk size={14} aria-hidden="true" />Save SEO fields
	</Button>;
}
