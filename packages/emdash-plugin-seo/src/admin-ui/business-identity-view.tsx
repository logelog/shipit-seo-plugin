import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { CodeBlock } from "@cloudflare/kumo/components/code";
import { Combobox } from "@cloudflare/kumo/components/combobox";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Input, InputArea } from "@cloudflare/kumo/components/input";
import { Radio } from "@cloudflare/kumo/components/radio";
import { Select } from "@cloudflare/kumo/components/select";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { MediaPickerModal } from "@emdash-cms/admin";
import { ArrowLeft, ArrowRight, Buildings, CheckCircle, FloppyDisk, ImageSquare, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import * as React from "react";

import {
	BUSINESS_IDENTITY_CONTACT_TYPES,
	BUSINESS_IDENTITY_DAYS,
	BUSINESS_IDENTITY_GEO_DECIMALS,
	BUSINESS_IDENTITY_LIMITS,
	BUSINESS_IDENTITY_LOGO_MIN_PIXELS,
	ISO_3166_ALPHA2_CODES,
	decimalPlaces,
	businessIdentityFamily,
	type BusinessIdentityContactType,
	type BusinessIdentityDay,
	type BusinessIdentityKind,
	type BusinessIdentityMediaRef,
	type BusinessIdentityRecord,
} from "../business-identity.ts";
import type { BusinessIdentityPageCandidate, BusinessIdentityView, BusinessIdentityWriteResult } from "../business-identity-commands.ts";
import { sitePublisherSchema } from "../lib.ts";
import {
	LOCAL_BUSINESS_CATALOGUE_SOURCE,
	LOCAL_BUSINESS_TYPES,
	isFoodEstablishmentType,
	isPublisherSchemaType,
	localBusinessAncestors,
	localBusinessClassLabel,
	localBusinessTypeExclusion,
	localBusinessTypeInfo,
	localBusinessTypeMatches,
	type LocalBusinessTypeInfo,
} from "../local-business-catalogue.ts";
import { LOCAL_BUSINESS_EXCLUDED_TYPES } from "../local-business-types.ts";
import {
	fetchSeoAdminBusinessIdentity,
	fetchSeoAdminBusinessIdentityPages,
	fetchSeoAdminSettings,
	previewSeoAdminBusinessIdentity,
	saveSeoAdminBusinessIdentity,
	setSeoAdminBusinessIdentityActive,
	transitionSeoAdminBusinessIdentityEntity,
} from "./api.ts";
import {
	IDENTITY_STEPS,
	IDENTITY_STEP_LABELS,
	createIdentityEditorStore,
	documentFromDraft,
	draftErrors,
	entityIdBreakParts,
	foodDetailsLeftOut,
	identityConflictDifferences,
	identityAdoptionReview,
	identityDirty,
	identityDraftTouched,
	identityLocked,
	identitySaveLabel,
	identityStepCompletion,
	intendedIdentityRecord,
	legacyPublisherEditable,
	publisherProfileDestination,
	publisherSourceSummary,
	stepForField,
	type AreaDraft,
	type ContactPointDraft,
	type DayState,
	type IdentityDraft,
	type IdentityEditorState,
	type IdentityStep,
	type IdentityWriteIntent,
	type PublisherProfileDestination,
	type PublisherSourceSummary,
} from "./business-identity-model.ts";
import type { SeoAdminBusinessIdentityPreview } from "./contract.ts";
import { classifyEntrySchemaRequestError, withEntrySchemaDeadline } from "./entry-schema-model.ts";
import { LOCAL_MEDIA_PREFIX, selectedLocalMediaUrl } from "./local-media.ts";
import { useSeoI18n } from "./i18n/index.ts";
import { WRAPPING_UNDERLINE_TABS, useTablistName } from "./workspace-tabs.ts";

const identityStore = createIdentityEditorStore();
const WRITE_DEADLINE_MS = 20_000;
const PAGE_SIZE = 25;

function useIdentityEditor(): IdentityEditorState {
	return React.useSyncExternalStore(identityStore.subscribe, identityStore.get, identityStore.get);
}

let loading: Promise<void> | null = null;

/** Reads the identity again; the store decides whether the draft follows. Safe to call from other views. */
export function refreshBusinessIdentity(): Promise<void> {
	if (!loading) identityStore.dispatch({ type: "load-start" });
	loading ??= fetchSeoAdminBusinessIdentity()
		.then((result) => identityStore.dispatch({ type: "receive", view: result.identity }))
		.catch((error: unknown) => {
			identityStore.dispatch({
				type: "request-failed",
				intent: "load",
				failure: classifyEntrySchemaRequestError(error),
				message: error instanceof Error ? error.message : "The business identity could not be loaded.",
			});
		})
		.finally(() => {
			loading = null;
		});
	return loading;
}

/**
 * The selected publisher source for Site identity, from the newest read and the
 * live identity draft, and whether the site settings may edit the legacy
 * publisher now.
 */
export function usePublisherSource(): {
	summary: PublisherSourceSummary;
	legacyEditable: boolean;
	publisherOutput: BusinessIdentityView["publisherOutput"] | null;
	profileDestination: PublisherProfileDestination | null;
} {
	const state = useIdentityEditor();
	return {
		summary: publisherSourceSummary(state),
		legacyEditable: legacyPublisherEditable(state),
		publisherOutput: state.latest?.publisherOutput ?? null,
		profileDestination: publisherProfileDestination(state),
	};
}

/** Current owner for an immediate focus attempt; a pending read never supplies a guessed destination. */
export function publisherProfileDestinationNow(): PublisherProfileDestination | null {
	return publisherProfileDestination(identityStore.get());
}

export const IDENTITY_PUBLIC_NAME_ID = "shipit-seo-identity-public-name";
const IDENTITY_PROFILES_CONTROL_ID = "shipit-seo-identity-profiles-control";

/** Shows the requested publisher field in its existing editor, keeping the draft. */
export function requestBusinessIdentityFocus(target: "public-name" | "profiles" = "public-name"): void {
	identityStore.dispatch({ type: "edit-publisher", target });
}

/** Leaving Site identity consumes an unfinished profile intent instead of replaying it on a later visit. */
export function cancelBusinessIdentityProfileFocus(): void {
	const focus = identityStore.get().focus;
	if (focus?.target === "profiles") identityStore.dispatch({ type: "focus-handled", request: focus.request });
}

const KIND_LABELS: Record<BusinessIdentityKind, string> = {
	Person: "Person",
	Organization: "Organization",
	LocalBusiness: "Local business",
};
const CONTACT_TYPE_LABELS: Record<BusinessIdentityContactType, string> = {
	"customer service": "Customer service",
	"technical support": "Technical support",
	"billing support": "Billing support",
	sales: "Sales",
	reservations: "Reservations",
	emergency: "Emergency",
};
const DAY_STATE_LABELS: Record<DayState, string> = {
	unknown: "Not published",
	closed: "Closed",
	open24: "Open 24 hours",
	periods: "Open",
};
const AREA_KIND_LABELS: Record<AreaDraft["kind"], string> = { Country: "Country", State: "Region or state", City: "City", Place: "Place" };
const LANGUAGE_CODES = [
	"ar", "bg", "bn", "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fr", "ga", "gl", "he", "hi",
	"hr", "hu", "id", "is", "it", "ja", "ko", "lt", "lv", "mk", "ms", "mt", "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sl",
	"sq", "sr", "sv", "sw", "ta", "th", "tr", "uk", "ur", "vi", "zh",
];

interface Choice {
	value: string;
	label: string;
}

function displayNames(type: "region" | "language"): (code: string) => string {
	try {
		const names = new Intl.DisplayNames(undefined, { type });
		return (code) => names.of(code) ?? code;
	} catch {
		return (code) => code;
	}
}

let countryChoices: Choice[] | null = null;
let languageChoices: Choice[] | null = null;

function countries(): Choice[] {
	if (!countryChoices) {
		const name = displayNames("region");
		countryChoices = ISO_3166_ALPHA2_CODES.map((code) => ({ value: code, label: `${name(code)} (${code})` })).sort((left, right) =>
			left.label.localeCompare(right.label),
		);
	}
	return countryChoices;
}

function languages(): Choice[] {
	if (!languageChoices) {
		const name = displayNames("language");
		languageChoices = LANGUAGE_CODES.map((code) => ({ value: code, label: `${name(code)} (${code})` })).sort((left, right) =>
			left.label.localeCompare(right.label),
		);
	}
	return languageChoices;
}

function choicesFor(values: readonly string[], items: Choice[]): Choice[] {
	return values.map((value) => items.find((item) => item.value === value) ?? { value, label: value });
}

function SingleChoice({
	label,
	items,
	value,
	error,
	disabled,
	placeholder,
	onChange,
}: {
	label: string;
	items: Choice[];
	value: string;
	error?: string;
	disabled: boolean;
	placeholder: string;
	onChange: (value: string) => void;
}) {
	const selected = items.find((item) => item.value === value) ?? null;
	return (
		<Combobox<Choice>
			autoHighlight
			items={items}
			value={selected}
			disabled={disabled}
			label={label}
			error={error}
			itemToStringLabel={(item: Choice) => item.label}
			isItemEqualToValue={(item: Choice, other: Choice) => item.value === other.value}
			onValueChange={(item: Choice | null) => onChange(item ? item.value : "")}
		>
			<Combobox.TriggerInput placeholder={placeholder} />
			<Combobox.Content>
				<Combobox.Empty>Nothing matches.</Combobox.Empty>
				<Combobox.List>
					{(item: Choice) => (
						<Combobox.Item key={item.value} value={item}>
							{item.label}
						</Combobox.Item>
					)}
				</Combobox.List>
			</Combobox.Content>
		</Combobox>
	);
}

let businessTypeChoices: LocalBusinessTypeInfo[] | null = null;

function businessTypes(): LocalBusinessTypeInfo[] {
	businessTypeChoices ??= [...LOCAL_BUSINESS_TYPES].sort((left, right) => left.label.localeCompare(right.label, "en"));
	return businessTypeChoices;
}

function classList(names: readonly string[]): string {
	return names.map(localBusinessClassLabel).join(", ");
}

/**
 * The selected type stays in its own summary, so it remains visible while the
 * search text changes or matches nothing. Searching never sends a request.
 */
function BusinessTypePicker({ value, error, disabled }: { value: string; error?: string; disabled: boolean }) {
	const items = businessTypes();
	const selected = localBusinessTypeInfo(value);
	const ancestors = selected ? localBusinessAncestors(selected.id).filter((name) => !selected.parents.includes(name)) : [];
	const excluded = localBusinessTypeExclusion(value);
	// Null while the list is closed: the input then shows the chosen type again.
	const [query, setQuery] = React.useState<string | null>(null);
	return (
		<div className="shipit-seo-identity-type">
			<Combobox<LocalBusinessTypeInfo>
				autoHighlight
				items={items}
				value={selected}
				disabled={disabled}
				label="Business type"
				description={`Search ${items.length} Schema.org types by name or identifier, for example hair salon or HairSalon. Choose the most specific type that is true.`}
				error={error}
				inputValue={query ?? selected?.label ?? ""}
				onInputValueChange={(next: string) => setQuery(next)}
				onOpenChange={(open: boolean) => {
					if (!open) setQuery(null);
				}}
				filter={(item: LocalBusinessTypeInfo, text: string) => query === null || localBusinessTypeMatches(item, text)}
				itemToStringLabel={(item: LocalBusinessTypeInfo) => item.label}
				itemToStringValue={(item: LocalBusinessTypeInfo) => item.id}
				isItemEqualToValue={(item: LocalBusinessTypeInfo, other: LocalBusinessTypeInfo) => item.id === other.id}
				onValueChange={(item: LocalBusinessTypeInfo | null, details: { reason: string }) => {
					// The combobox also reports null when the query is erased or Escape is
					// pressed; only the clear button removes the chosen type.
					if (item || details.reason === "clear-press") {
						edit((current) => ({ ...current, businessType: item ? item.id : "" }));
						setQuery(null);
					}
				}}
			>
				<Combobox.TriggerInput placeholder="Search business types" clearLabel="Clear business type" />
				<Combobox.Content align="start">
					<Combobox.Empty>No type matches. Try a broader word.</Combobox.Empty>
					<Combobox.List>
						{(item: LocalBusinessTypeInfo) => (
							<Combobox.Item key={item.id} value={item}>
								<span className="shipit-seo-identity-type-option">
									<span>
										{item.label} <code>{item.id}</code>
									</span>
									<span className="shipit-seo-muted">Kind of {classList(item.parents)}</span>
								</span>
							</Combobox.Item>
						)}
					</Combobox.List>
				</Combobox.Content>
			</Combobox>
			<div className="shipit-seo-identity-type-summary" aria-live="polite">
				{selected ? (
					<>
						<p>
							<strong>Selected:</strong> {selected.label} <code>{selected.id}</code>
						</p>
						<p className="shipit-seo-muted">
							A kind of {classList(selected.parents)}
							{ancestors.length ? `, and so also ${classList(ancestors)}` : ""}.
							{selected.extension === "health-lifesci" ? " From the Schema.org health and life sciences extension, which is part of the release." : ""}
							{isFoodEstablishmentType(selected.id) ? " Food establishments also get cuisine, menu and reservation fields on the Location step." : ""}
						</p>
					</>
				) : value ? (
					<p>
						<strong>Saved type {value} is not in this list.</strong> {excluded ? `${excluded} ` : ""}Choose a current type; nothing changes until you save.
					</p>
				) : (
					<p>
						<strong>No type selected.</strong> Choose one before saving.
					</p>
				)}
			</div>
			<p className="shipit-seo-muted">In Schema.org a local business is both an Organization and a Place.</p>
			<details className="shipit-seo-identity-sources">
				<summary>About this list</summary>
				<p>
					The type describes this one business: the selected page publishes one node of that type under the business's ID, other
					pages name the same ID as an Organization, and no second organization is added. Every type gets the same common fields
					here; specialised properties, for example of a Hotel or a MedicalBusiness, are not added.
				</p>
				<p>
					The {items.length} types are the LocalBusiness classes of Schema.org {LOCAL_BUSINESS_CATALOGUE_SOURCE.release} (released{" "}
					{LOCAL_BUSINESS_CATALOGUE_SOURCE.released}), including the health and life sciences types in that release.{" "}
					{LOCAL_BUSINESS_EXCLUDED_TYPES.map((item) => `${item.id}: ${item.reason}`).join(" ")} They are not offered.
				</p>
				<p>
					A Schema.org type is not a Google rich result category. Google's local business guidelines ask for at least a name and an
					address, and every fact must match what the page visibly shows.
				</p>
				<p>
					Type names and their hierarchy are derived from the{" "}
					<a href="https://schema.org" target="_blank" rel="noreferrer">
						Schema.org vocabulary
					</a>
					, licensed under{" "}
					<a href={LOCAL_BUSINESS_CATALOGUE_SOURCE.licenceUrl} target="_blank" rel="noreferrer">
						{LOCAL_BUSINESS_CATALOGUE_SOURCE.licence}
					</a>
					.
				</p>
			</details>
		</div>
	);
}

function MultiChoice({
	label,
	items,
	values,
	error,
	disabled,
	placeholder,
	max,
	onChange,
}: {
	label: string;
	items: Choice[];
	values: string[];
	error?: string;
	disabled: boolean;
	placeholder: string;
	max: number;
	onChange: (values: string[]) => void;
}) {
	const selected = choicesFor(values, items);
	return (
		<Combobox<Choice, true>
			multiple
			autoHighlight
			items={items}
			value={selected}
			disabled={disabled}
			label={label}
			error={error}
			description={`Up to ${max}.`}
			itemToStringLabel={(item: Choice) => item.label}
			isItemEqualToValue={(item: Choice, other: Choice) => item.value === other.value}
			onValueChange={(next: Choice[]) => onChange(next.slice(0, max).map((item) => item.value))}
		>
			<Combobox.TriggerMultipleWithInput<Choice>
				placeholder={placeholder}
				value={selected}
				renderItem={(item) => (
					<Combobox.Chip key={item.value} removeLabel={`Remove ${item.label}`}>
						{item.label}
					</Combobox.Chip>
				)}
			/>
			<Combobox.Content>
				<Combobox.Empty>Nothing matches.</Combobox.Empty>
				<Combobox.List>
					{(item: Choice) => (
						<Combobox.Item key={item.value} value={item}>
							{item.label}
						</Combobox.Item>
					)}
				</Combobox.List>
			</Combobox.Content>
		</Combobox>
	);
}

function edit(update: (draft: IdentityDraft) => IdentityDraft) {
	identityStore.dispatch({ type: "edit", update });
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
	return items.map((item, position) => (position === index ? value : item));
}

function removeAt<T>(items: readonly T[], index: number): T[] {
	return items.filter((_, position) => position !== index);
}

function failureMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

async function runWrite(
	intent: IdentityWriteIntent,
	intended: BusinessIdentityRecord | null,
	request: (signal: AbortSignal) => Promise<BusinessIdentityWriteResult>,
	transitionKind?: BusinessIdentityKind,
): Promise<void> {
	identityStore.dispatch({
		type: "start",
		pending: intent === "save" ? "save" : intent === "replace" ? "replace" : intent === "transition" ? "transition" : intent === "activate" ? "activate" : "deactivate",
		...(transitionKind ? { transitionKind } : {}),
	});
	try {
		const result = await withEntrySchemaDeadline(request, WRITE_DEADLINE_MS);
		identityStore.dispatch({ type: "write-result", intent, result, intended });
		if (result.success) await refreshBusinessIdentity();
	} catch (error: unknown) {
		identityStore.dispatch({
			type: "request-failed",
			intent,
			failure: classifyEntrySchemaRequestError(error),
			message: failureMessage(error, "The request failed. Nothing is known to have changed."),
			intended,
		});
	}
}

async function checkSavedRecord(): Promise<void> {
	const state = identityStore.get();
	if (state.notice?.kind !== "unconfirmed" && state.notice?.kind !== "uncertain") return;
	const notice = state.notice;
	identityStore.dispatch({ type: "start", pending: "check" });
	try {
		const result = await fetchSeoAdminBusinessIdentity(
			notice.kind === "unconfirmed" ? { check: { intended: notice.intended, loaded: notice.loaded } } : {},
		);
		if (notice.kind === "uncertain") {
			identityStore.dispatch({ type: "receive", view: result.identity });
			identityStore.dispatch({ type: "check-result", check: undefined, view: result.identity });
			return;
		}
		identityStore.dispatch({ type: "check-result", check: result.check, view: result.identity });
	} catch (error: unknown) {
		identityStore.dispatch({
			type: "request-failed",
			intent: "check",
			failure: classifyEntrySchemaRequestError(error),
			message: failureMessage(error, "The saved record could not be read."),
		});
	}
}

function errorFor(errors: Record<string, string>, path: string): string | undefined {
	return errors[path];
}

/** Errors under a path prefix that no single control shows, such as a list-level limit. */
function groupError(errors: Record<string, string>, path: string): string | undefined {
	return errors[path];
}

function MediaField({
	label,
	description,
	value,
	siteUrl,
	disabled,
	error,
	onChoose,
	onRemove,
}: {
	label: string;
	description: string;
	value: BusinessIdentityMediaRef | null;
	siteUrl: string;
	disabled: boolean;
	error?: string;
	onChoose: () => void;
	onRemove: () => void;
}) {
	const preview = value
		? value.url.startsWith(LOCAL_MEDIA_PREFIX) && typeof window !== "undefined"
			? new URL(value.url, window.location.origin).href
			: value.url
		: "";
	const size = value?.width && value?.height ? `${value.width} by ${value.height} pixels` : "size unknown";
	return (
		<div className="shipit-seo-identity-media">
			<span className="shipit-seo-field-label">{label}</span>
			<p>{description}</p>
			{value ? (
				<div className="shipit-seo-identity-media-preview">
					<img src={preview} alt="" width={64} height={64} />
					<span>
						{value.url.startsWith(LOCAL_MEDIA_PREFIX) ? "Media library image" : value.url}, {size}
						{siteUrl ? "" : ""}
					</span>
				</div>
			) : (
				<p className="shipit-seo-muted">Not set.</p>
			)}
			<div className="shipit-seo-identity-row-actions">
				<Button type="button" variant="secondary" icon={ImageSquare} disabled={disabled} onClick={onChoose}>
					{value ? `Change ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}
				</Button>
				{value ? (
					<Button type="button" variant="secondary" icon={Trash} disabled={disabled} onClick={onRemove}>
						Remove
					</Button>
				) : null}
			</div>
			{error ? (
				<p className="shipit-seo-form-error" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}

function IdentityStepView({ draft, errors, disabled, adopted, legacyFamily, keptFamily, allowNewFamily, siteUrl, onPickMedia }: StepProps & { onPickMedia: (field: "logo" | "image") => void }) {
	const person = draft.kind === "Person";
	const requiredFamily = keptFamily ?? legacyFamily;
	const familyLocked = (kind: BusinessIdentityKind) => !adopted && !allowNewFamily && businessIdentityFamily(kind) !== requiredFamily;
	return (
		<div className="shipit-seo-form-grid">
			<Radio.Group
				legend="Who publishes this site"
				value={draft.kind}
				error={errorFor(errors, "kind")}
				description={
					adopted
						? "Choosing a different entity family opens a review before its ID changes. Your form edits are kept separately."
						: allowNewFamily
							? "Choose who publishes this site. A change from the existing publisher's family is reviewed before saving."
						: keptFamily
							? `The saved record's ID names ${keptFamily === "person" ? "a person" : "an organization"}, so the replacement keeps that entity. Change it afterwards if needed.`
							: legacyFamily === "person"
							? "Repair this record as a person first, then review an entity change in this form."
							: "Repair this record as an organization first, then review an entity change in this form."
				}
				onValueChange={(value) => identityStore.dispatch({ type: "select-kind", kind: value as BusinessIdentityKind })}
				disabled={disabled}
			>
				{(Object.keys(KIND_LABELS) as BusinessIdentityKind[]).map((kind) => (
					<Radio.Item key={kind} value={kind} label={KIND_LABELS[kind]} disabled={familyLocked(kind)} />
				))}
			</Radio.Group>
			{draft.kind === "LocalBusiness" ? <BusinessTypePicker value={draft.businessType} error={errorFor(errors, "businessType")} disabled={disabled} /> : null}
			<Input
				id={IDENTITY_PUBLIC_NAME_ID}
				label="Public name"
				value={draft.name}
				required
				maxLength={BUSINESS_IDENTITY_LIMITS.name + 20}
				disabled={disabled}
				error={errorFor(errors, "name")}
				onChange={(event) => {
					const value = event.target.value;
					edit((current) => ({ ...current, name: value }));
				}}
			/>
			<Input
				label="Alternate name"
				value={draft.alternateName}
				disabled={disabled}
				description="Another name people use, for example a shorter brand name."
				error={errorFor(errors, "alternateName")}
				onChange={(event) => {
					const value = event.target.value;
					edit((current) => ({ ...current, alternateName: value }));
				}}
			/>
			{person ? null : (
				<Input
					label="Legal name"
					value={draft.legalName}
					disabled={disabled}
					error={errorFor(errors, "legalName")}
					onChange={(event) => {
						const value = event.target.value;
						edit((current) => ({ ...current, legalName: value }));
					}}
				/>
			)}
			<InputArea
				label="Description"
				value={draft.description}
				rows={3}
				disabled={disabled}
				description={`Up to ${BUSINESS_IDENTITY_LIMITS.description} characters.`}
				error={errorFor(errors, "description")}
				onValueChange={(value) => edit((current) => ({ ...current, description: value }))}
			/>
			{person ? null : (
				<MediaField
					label="Logo"
					description={`Square image, at least ${BUSINESS_IDENTITY_LOGO_MIN_PIXELS} x ${BUSINESS_IDENTITY_LOGO_MIN_PIXELS} px.`}
					value={draft.logo}
					siteUrl={siteUrl}
					disabled={disabled}
					error={errorFor(errors, "logo.url") ?? errorFor(errors, "logo")}
					onChoose={() => onPickMedia("logo")}
					onRemove={() => edit((current) => ({ ...current, logo: null }))}
				/>
			)}
			<MediaField
				label="Image"
				description={person ? "A photo of this person." : "A photo of the business, such as its storefront."}
				value={draft.image}
				siteUrl={siteUrl}
				disabled={disabled}
				error={errorFor(errors, "image.url") ?? errorFor(errors, "image")}
				onChoose={() => onPickMedia("image")}
				onRemove={() => edit((current) => ({ ...current, image: null }))}
			/>
		</div>
	);
}

interface StepProps {
	draft: IdentityDraft;
	errors: Record<string, string>;
	disabled: boolean;
	/** The saved kind, once adopted. */
	adopted: BusinessIdentityKind | null;
	legacyFamily: "person" | "organization";
	/** The family an invalid record's replacement keeps. */
	keptFamily: "person" | "organization" | null;
	allowNewFamily: boolean;
	siteUrl: string;
}

function ContactStepView({ draft, errors, disabled }: StepProps) {
	const person = draft.kind === "Person";
	const updatePoint = (index: number, patch: Partial<ContactPointDraft>) =>
		edit((current) => ({ ...current, contactPoints: replaceAt(current.contactPoints, index, { ...current.contactPoints[index], ...patch }) }));
	return (
		<div className="shipit-seo-identity-stack">
			<div className="shipit-seo-form-grid">
				<Input
					label="Main phone number"
					type="tel"
					value={draft.telephone}
					disabled={disabled}
					placeholder="+31 20 123 4567"
					description="International format with the country code."
					error={errorFor(errors, "telephone")}
					onChange={(event) => {
						const value = event.target.value;
						edit((current) => ({ ...current, telephone: value }));
					}}
				/>
				<Input
					label="Main email address"
					type="email"
					value={draft.email}
					disabled={disabled}
					error={errorFor(errors, "email")}
					onChange={(event) => {
						const value = event.target.value;
						edit((current) => ({ ...current, email: value }));
					}}
				/>
			</div>
			<fieldset className="shipit-seo-identity-rows">
				<legend>Contact points</legend>
				<p>Departments people can reach, such as reservations or support. Each needs a phone number or an email address.</p>
				{draft.contactPoints.map((point, index) => (
					<div className="shipit-seo-identity-row" key={index}>
						<Select<BusinessIdentityContactType>
							label={`Contact point ${index + 1} type`}
							items={CONTACT_TYPE_LABELS}
							value={point.contactType}
							disabled={disabled}
							error={errorFor(errors, `contactPoints.${index}.contactType`)}
							onValueChange={(value) => {
								if (value) updatePoint(index, { contactType: value });
							}}
						/>
						<Input
							label="Phone"
							type="tel"
							value={point.telephone}
							disabled={disabled}
							error={errorFor(errors, `contactPoints.${index}.telephone`)}
							onChange={(event) => updatePoint(index, { telephone: event.target.value })}
						/>
						<Input
							label="Email"
							type="email"
							value={point.email}
							disabled={disabled}
							error={errorFor(errors, `contactPoints.${index}.email`)}
							onChange={(event) => updatePoint(index, { email: event.target.value })}
						/>
						<MultiChoice
							label="Languages spoken"
							items={languages()}
							values={point.availableLanguage}
							max={BUSINESS_IDENTITY_LIMITS.contactLanguages}
							disabled={disabled}
							placeholder="Add a language"
							error={Object.entries(errors).find(([key]) => key.startsWith(`contactPoints.${index}.availableLanguage`))?.[1]}
							onChange={(values) => updatePoint(index, { availableLanguage: values })}
						/>
						{person ? null : (
							<MultiChoice
								label="Countries served"
								items={countries()}
								values={point.areaServed}
								max={BUSINESS_IDENTITY_LIMITS.contactCountries}
								disabled={disabled}
								placeholder="Add a country"
								error={Object.entries(errors).find(([key]) => key.startsWith(`contactPoints.${index}.areaServed`))?.[1]}
								onChange={(values) => updatePoint(index, { areaServed: values })}
							/>
						)}
						<div className="shipit-seo-identity-row-actions">
							<Button
								type="button"
								variant="secondary"
								icon={Trash}
								disabled={disabled}
								aria-label={`Remove contact point ${index + 1}`}
								onClick={() => edit((current) => ({ ...current, contactPoints: removeAt(current.contactPoints, index) }))}
							>
								Remove
							</Button>
						</div>
					</div>
				))}
				<Button
					type="button"
					variant="secondary"
					icon={Plus}
					disabled={disabled || draft.contactPoints.length >= BUSINESS_IDENTITY_LIMITS.contactPoints}
					onClick={() =>
						edit((current) => ({
							...current,
							contactPoints: [
								...current.contactPoints,
								{ contactType: "customer service", telephone: "", email: "", availableLanguage: [], areaServed: [] },
							],
						}))
					}
				>
					Add contact point
				</Button>
				{groupError(errors, "contactPoints") ? <p className="shipit-seo-form-error" role="alert">{errors.contactPoints}</p> : null}
			</fieldset>

		</div>
	);
}

function SocialStepView({ draft, errors, disabled }: StepProps) {
	const person = draft.kind === "Person";
	return (
		<div className="shipit-seo-identity-stack">
			<fieldset className="shipit-seo-identity-rows">
				<legend>Official profiles</legend>
				<p>Full https addresses of profiles this {person ? "person" : "business"} runs, such as a social or review platform page.</p>
				{draft.sameAs.map((url, index) => (
					<div className="shipit-seo-profile-editor-row" key={index}>
						<Input
							id={index === 0 ? IDENTITY_PROFILES_CONTROL_ID : undefined}
							label={`Profile ${index + 1}`}
							type="url"
							value={url}
							disabled={disabled}
							placeholder="https://"
							error={errorFor(errors, `sameAs.${index}`)}
							onChange={(event) => {
								const value = event.target.value;
								edit((current) => ({ ...current, sameAs: replaceAt(current.sameAs, index, value) }));
							}}
						/>
						<Button
							type="button"
							variant="secondary"
							icon={Trash}
							disabled={disabled}
							aria-label={`Remove profile ${index + 1}`}
							onClick={() => edit((current) => ({ ...current, sameAs: removeAt(current.sameAs, index) }))}
						>
							Remove
						</Button>
					</div>
				))}
				<Button
					type="button"
					variant="secondary"
					icon={Plus}
					id={draft.sameAs.length === 0 ? IDENTITY_PROFILES_CONTROL_ID : undefined}
					disabled={disabled || draft.sameAs.length >= BUSINESS_IDENTITY_LIMITS.sameAs}
					onClick={() => edit((current) => ({ ...current, sameAs: [...current.sameAs, ""] }))}
				>
					Add profile
				</Button>
				{groupError(errors, "sameAs") ? <p className="shipit-seo-form-error" role="alert">{errors.sameAs}</p> : null}
			</fieldset>
		</div>
	);
}

function AddressStepView({ draft, errors, disabled }: StepProps) {
	if (draft.kind === "Person") {
		return <p>A person's address and service area are not published by this workflow. Choose an organization or a local business to add them.</p>;
	}
	const updateArea = (index: number, patch: Partial<AreaDraft>) =>
		edit((current) => ({ ...current, areaServed: replaceAt(current.areaServed, index, { ...current.areaServed[index], ...patch }) }));
	return (
		<div className="shipit-seo-identity-stack">
			<Switch
				label="Publish a street address"
				checked={draft.publishAddress}
				disabled={disabled}
				onCheckedChange={(checked) => edit((current) => ({ ...current, publishAddress: checked }))}
			/>
			<p>
				Leave this off when customers are not served at an address, for example a business that travels to them. Nothing is invented in
				its place.{draft.kind === "LocalBusiness" ? " Google's local business structured data requires an address, so Review will say that it is missing." : ""}
			</p>
			{draft.publishAddress ? (
				<div className="shipit-seo-form-grid">
					<Input
						label="Street and number"
						value={draft.address.streetAddress}
						required
						disabled={disabled}
						error={errorFor(errors, "address.streetAddress")}
						onChange={(event) => {
							const value = event.target.value;
							edit((current) => ({ ...current, address: { ...current.address, streetAddress: value } }));
						}}
					/>
					<Input
						label="City"
						value={draft.address.addressLocality}
						required
						disabled={disabled}
						error={errorFor(errors, "address.addressLocality")}
						onChange={(event) => {
							const value = event.target.value;
							edit((current) => ({ ...current, address: { ...current.address, addressLocality: value } }));
						}}
					/>
					<Input
						label="Region or state"
						value={draft.address.addressRegion}
						disabled={disabled}
						error={errorFor(errors, "address.addressRegion")}
						onChange={(event) => {
							const value = event.target.value;
							edit((current) => ({ ...current, address: { ...current.address, addressRegion: value } }));
						}}
					/>
					<Input
						label="Postal code"
						value={draft.address.postalCode}
						disabled={disabled}
						error={errorFor(errors, "address.postalCode")}
						onChange={(event) => {
							const value = event.target.value;
							edit((current) => ({ ...current, address: { ...current.address, postalCode: value } }));
						}}
					/>
					<SingleChoice
						label="Country"
						items={countries()}
						value={draft.address.addressCountry}
						disabled={disabled}
						placeholder="Search countries"
						error={errorFor(errors, "address.addressCountry")}
						onChange={(value) => edit((current) => ({ ...current, address: { ...current.address, addressCountry: value } }))}
					/>
				</div>
			) : null}
			<fieldset className="shipit-seo-identity-rows">
				<legend>Service area</legend>
				<p>Places this business serves. Add only areas it really serves.</p>
				{draft.areaServed.map((area, index) => (
					<div className="shipit-seo-identity-row" key={index}>
						<Select<AreaDraft["kind"]>
							label={`Area ${index + 1} kind`}
							items={AREA_KIND_LABELS}
							value={area.kind}
							disabled={disabled}
							onValueChange={(value) => {
								if (value) updateArea(index, { kind: value });
							}}
						/>
						{area.kind === "Country" ? null : (
							<Input
								label="Name"
								value={area.name}
								disabled={disabled}
								error={errorFor(errors, `areaServed.${index}.name`)}
								onChange={(event) => updateArea(index, { name: event.target.value })}
							/>
						)}
						<SingleChoice
							label={area.kind === "Country" ? "Country" : "Country (optional)"}
							items={countries()}
							value={area.countryCode}
							disabled={disabled}
							placeholder="Search countries"
							error={errorFor(errors, `areaServed.${index}.countryCode`) ?? errorFor(errors, `areaServed.${index}.kind`)}
							onChange={(value) => updateArea(index, { countryCode: value })}
						/>
						<div className="shipit-seo-identity-row-actions">
							<Button
								type="button"
								variant="secondary"
								icon={Trash}
								disabled={disabled}
								aria-label={`Remove area ${index + 1}`}
								onClick={() => edit((current) => ({ ...current, areaServed: removeAt(current.areaServed, index) }))}
							>
								Remove
							</Button>
						</div>
					</div>
				))}
				<Button
					type="button"
					variant="secondary"
					icon={Plus}
					disabled={disabled || draft.areaServed.length >= BUSINESS_IDENTITY_LIMITS.areaServed}
					onClick={() => edit((current) => ({ ...current, areaServed: [...current.areaServed, { kind: "City", name: "", countryCode: "" }] }))}
				>
					Add area
				</Button>
				{groupError(errors, "areaServed") ? <p className="shipit-seo-form-error" role="alert">{errors.areaServed}</p> : null}
			</fieldset>
		</div>
	);
}

function precisionNote(value: string): string {
	if (!value.trim()) return "";
	const places = decimalPlaces(value.trim());
	return places < BUSINESS_IDENTITY_GEO_DECIMALS
		? `${places} decimal place${places === 1 ? "" : "s"} entered. Google asks for at least ${BUSINESS_IDENTITY_GEO_DECIMALS}; nothing is added for you.`
		: `${places} decimal places entered.`;
}

function HoursEditor({ draft, errors, disabled }: StepProps) {
	const updateDay = (day: BusinessIdentityDay, update: (value: IdentityDraft["days"][BusinessIdentityDay]) => IdentityDraft["days"][BusinessIdentityDay]) =>
		edit((current) => ({ ...current, days: { ...current.days, [day]: update(current.days[day]) } }));
	return (
		<div className="shipit-seo-identity-hours">
			{BUSINESS_IDENTITY_DAYS.map((day) => {
				const value = draft.days[day];
				return (
					<fieldset key={day} className="shipit-seo-identity-day">
						<legend>{day}</legend>
						<Select<DayState>
							label={`${day} hours`}
							items={DAY_STATE_LABELS}
							value={value.state}
							disabled={disabled}
							error={errorFor(errors, `location.hours.days.${day}.state`)}
							onValueChange={(state) => {
								if (!state) return;
								updateDay(day, (current) => ({
									state,
									periods: state === "periods" && !current.periods.length ? [{ opens: "09:00", closes: "17:00" }] : current.periods,
								}));
							}}
						/>
						{value.state === "periods" ? (
							<div className="shipit-seo-identity-periods">
								{value.periods.map((period, index) => (
									<div className="shipit-seo-identity-period" key={index}>
										<Input
											label={`${day} opens`}
											type="time"
											step={60}
											value={period.opens}
											disabled={disabled}
											error={errorFor(errors, `location.hours.days.${day}.periods.${index}.opens`)}
											onChange={(event) => {
												const opens = event.target.value;
												updateDay(day, (current) => ({ ...current, periods: replaceAt(current.periods, index, { ...current.periods[index], opens }) }));
											}}
										/>
										<Input
											label={`${day} closes`}
											type="time"
											step={60}
											value={period.closes}
											disabled={disabled}
											description={period.opens && period.closes && period.closes < period.opens ? "Closes after midnight." : undefined}
											error={errorFor(errors, `location.hours.days.${day}.periods.${index}.closes`)}
											onChange={(event) => {
												const closes = event.target.value;
												updateDay(day, (current) => ({ ...current, periods: replaceAt(current.periods, index, { ...current.periods[index], closes }) }));
											}}
										/>
										<Button
											type="button"
											variant="secondary"
											icon={Trash}
											disabled={disabled || value.periods.length <= 1}
											aria-label={`Remove ${day} period ${index + 1}`}
											onClick={() => updateDay(day, (current) => ({ ...current, periods: removeAt(current.periods, index) }))}
										>
											Remove
										</Button>
									</div>
								))}
								<Button
									type="button"
									variant="secondary"
									icon={Plus}
									disabled={disabled || value.periods.length >= BUSINESS_IDENTITY_LIMITS.periodsPerDay}
									onClick={() => updateDay(day, (current) => ({ ...current, periods: [...current.periods, { opens: "", closes: "" }] }))}
								>
									Add {day} period
								</Button>
								{errorFor(errors, `location.hours.days.${day}.periods`) ? (
									<p className="shipit-seo-form-error" role="alert">{errors[`location.hours.days.${day}.periods`]}</p>
								) : null}
							</div>
						) : null}
					</fieldset>
				);
			})}
			{errorFor(errors, "location.hours.days") ? <p className="shipit-seo-form-error" role="alert">{errors["location.hours.days"]}</p> : null}
		</div>
	);
}

function LocationStepView(props: StepProps) {
	const { draft, errors, disabled } = props;
	if (draft.kind !== "LocalBusiness") {
		return <p>Coordinates, opening hours and price range apply to a local business. Choose Local business on the Identity step to add them.</p>;
	}
	return (
		<div className="shipit-seo-identity-stack">
			<div className="shipit-seo-form-grid">
				<Input
					label="Latitude"
					inputMode="decimal"
					value={draft.latitude}
					disabled={disabled}
					placeholder="52.37403"
					description={precisionNote(draft.latitude) || "Decimal degrees, from -90 to 90."}
					error={errorFor(errors, "location.geo.latitude")}
					onChange={(event) => {
						const value = event.target.value;
						edit((current) => ({ ...current, latitude: value }));
					}}
				/>
				<Input
					label="Longitude"
					inputMode="decimal"
					value={draft.longitude}
					disabled={disabled}
					placeholder="4.88969"
					description={precisionNote(draft.longitude) || "Decimal degrees, from -180 to 180."}
					error={errorFor(errors, "location.geo.longitude")}
					onChange={(event) => {
						const value = event.target.value;
						edit((current) => ({ ...current, longitude: value }));
					}}
				/>
				<Input
					label="Map link"
					type="url"
					value={draft.mapUrl}
					disabled={disabled}
					placeholder="https://"
					description="Optional. A link to this location on a map you choose."
					error={errorFor(errors, "location.mapUrl")}
					onChange={(event) => {
						const value = event.target.value;
						edit((current) => ({ ...current, mapUrl: value }));
					}}
				/>
				<Input
					label="Price range"
					value={draft.priceRange}
					disabled={disabled}
					placeholder="$$"
					description="Under 100 characters, for example $$ or 10 to 25 EUR."
					error={errorFor(errors, "priceRange")}
					onChange={(event) => {
						const value = event.target.value;
						edit((current) => ({ ...current, priceRange: value }));
					}}
				/>
			</div>
			<Select<"unpublished" | "weekly">
				label="Opening hours"
				items={{ unpublished: "Not published", weekly: "Weekly hours" }}
				value={draft.hoursMode}
				disabled={disabled}
				description="Weekly hours only. Holidays and seasonal changes cannot be expressed here."
				error={errorFor(errors, "location.hours.mode")}
				onValueChange={(value) => {
					if (value) edit((current) => ({ ...current, hoursMode: value }));
				}}
			/>
			{draft.hoursMode === "weekly" ? <HoursEditor {...props} /> : null}
			{isFoodEstablishmentType(draft.businessType) ? (
				<fieldset className="shipit-seo-identity-rows">
					<legend>Food establishment</legend>
					{draft.servesCuisine.map((cuisine, index) => (
						<div className="shipit-seo-profile-editor-row" key={index}>
							<Input
								label={`Cuisine ${index + 1}`}
								value={cuisine}
								disabled={disabled}
								error={errorFor(errors, `restaurant.servesCuisine.${index}`)}
								onChange={(event) => {
									const value = event.target.value;
									edit((current) => ({ ...current, servesCuisine: replaceAt(current.servesCuisine, index, value) }));
								}}
							/>
							<Button
								type="button"
								variant="secondary"
								icon={Trash}
								disabled={disabled}
								aria-label={`Remove cuisine ${index + 1}`}
								onClick={() => edit((current) => ({ ...current, servesCuisine: removeAt(current.servesCuisine, index) }))}
							>
								Remove
							</Button>
						</div>
					))}
					<Button
						type="button"
						variant="secondary"
						icon={Plus}
						disabled={disabled || draft.servesCuisine.length >= BUSINESS_IDENTITY_LIMITS.cuisines}
						onClick={() => edit((current) => ({ ...current, servesCuisine: [...current.servesCuisine, ""] }))}
					>
						Add cuisine
					</Button>
					<Input
						label="Menu link"
						type="url"
						value={draft.menuUrl}
						disabled={disabled}
						placeholder="https://"
						error={errorFor(errors, "restaurant.menuUrl")}
						onChange={(event) => {
							const value = event.target.value;
							edit((current) => ({ ...current, menuUrl: value }));
						}}
					/>
					<Select<"unset" | "yes" | "no">
						label="Reservations"
						items={{ unset: "Not stated", yes: "Accepted", no: "Not accepted" }}
						value={draft.acceptsReservations}
						disabled={disabled}
						onValueChange={(value) => {
							if (value) edit((current) => ({ ...current, acceptsReservations: value }));
						}}
					/>
				</fieldset>
			) : null}
		</div>
	);
}

function TargetPicker({ draft, view, disabled, error }: { draft: IdentityDraft; view: BusinessIdentityView; disabled: boolean; error?: string }) {
	const collectionItems = Object.fromEntries(view.collections.items.map((item) => [item.collection, item.label]));
	const firstCollection = draft.target.kind === "content" ? draft.target.collection : view.collections.items[0]?.collection ?? "";
	const [collection, setCollection] = React.useState(firstCollection);
	const [cursors, setCursors] = React.useState<string[]>([]);
	const [page, setPage] = React.useState<{ items: BusinessIdentityPageCandidate[]; next?: string } | null>(null);
	const [status, setStatus] = React.useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
	const mode = draft.target.kind;

	const load = React.useCallback(async (selected: string, cursor: string | undefined) => {
		setStatus({ loading: true, error: null });
		try {
			const result = await fetchSeoAdminBusinessIdentityPages({ collection: selected, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
			if (!result.success) {
				setPage(null);
				setStatus({ loading: false, error: result.error });
				return;
			}
			setPage({ items: result.items, ...(result.cursor ? { next: result.cursor } : {}) });
			setStatus({ loading: false, error: null });
		} catch (failure: unknown) {
			setStatus({ loading: false, error: failureMessage(failure, "The pages could not be listed.") });
		}
	}, []);

	React.useEffect(() => {
		if (mode === "content" && collection && !page && !status.loading && !status.error) void load(collection, undefined);
	}, [mode, collection, page, status.loading, status.error, load]);

	return (
		<fieldset className="shipit-seo-identity-rows">
			<legend>Publication page</legend>
			<p>The full details, including address and hours, appear only on this page. It should show those details visibly. Other pages carry only the name, logo and profiles.</p>
			<Radio.Group
				legend="Page type"
				value={mode}
				disabled={disabled}
				error={error}
				onValueChange={(value) => {
					if (value === "home") edit((current) => ({ ...current, target: { kind: "home" } }));
					else if (value === "content" && draft.target.kind !== "content") {
						edit((current) => ({ ...current, target: { kind: "content", collection: "", entryId: "", locale: null, title: "" } }));
					}
				}}
			>
				<Radio.Item value="home" label="Homepage" />
				<Radio.Item value="content" label="A content page" disabled={!view.collections.available || !view.collections.items.length} />
			</Radio.Group>
			{mode === "content" ? (
				<div className="shipit-seo-identity-stack">
					<Select<string>
						label="Content type"
						items={collectionItems}
						value={collection}
						disabled={disabled}
						onValueChange={(value) => {
							if (!value) return;
							setCollection(value);
							setCursors([]);
							setPage(null);
							setStatus({ loading: false, error: null });
						}}
					/>
					{draft.target.kind === "content" && draft.target.entryId ? (
						<p>
							Selected: <strong>{draft.target.title || draft.target.entryId}</strong>
							{draft.target.locale ? ` (${draft.target.locale})` : ""}
						</p>
					) : (
						<p>No page selected yet.</p>
					)}
					{status.loading ? <p aria-live="polite">Loading pages</p> : null}
					{status.error ? (
						<p className="shipit-seo-form-error" role="alert">
							{status.error}
						</p>
					) : null}
					{page ? (
						page.items.length ? (
							<Radio.Group
								legend={`Published pages in ${collectionItems[collection] ?? collection}`}
								value={draft.target.kind === "content" && draft.target.collection === collection ? draft.target.entryId : ""}
								disabled={disabled}
								onValueChange={(entryId) => {
									const item = page.items.find((candidate) => candidate.entryId === entryId);
									if (!item) return;
									edit((current) => ({
										...current,
										target: { kind: "content", collection, entryId: item.entryId, locale: item.locale, title: item.title },
									}));
								}}
							>
								{page.items.map((item) => (
									<Radio.Item
										key={item.entryId}
										value={item.entryId}
										disabled={!item.url}
										label={`${item.title}${item.locale ? ` (${item.locale})` : ""}${item.url ? `, ${new URL(item.url).pathname}` : ", no public address"}`}
									/>
								))}
							</Radio.Group>
						) : (
							<p>This content type has no published pages.</p>
						)
					) : null}
					<div className="shipit-seo-identity-row-actions">
						<Button
							type="button"
							variant="secondary"
							icon={ArrowLeft}
							disabled={!cursors.length || status.loading}
							onClick={() => {
								const previous = cursors.slice(0, -1);
								setCursors(previous);
								void load(collection, previous[previous.length - 1]);
							}}
						>
							Previous
						</Button>
						<Button
							type="button"
							variant="secondary"
							icon={ArrowRight}
							disabled={!page?.next || status.loading}
							onClick={() => {
								if (!page?.next) return;
								setCursors([...cursors, page.next]);
								void load(collection, page.next);
							}}
						>
							Next
						</Button>
					</div>
				</div>
			) : null}
		</fieldset>
	);
}

interface Inspection {
	url: string;
	at: string;
	status: "ok" | "cross-origin" | "failed";
	message?: string;
	visible?: Array<{ fact: string; value: string; found: boolean }>;
	nodes?: Array<{ id: string; types: string; attribution: string }>;
}


function sameJson(left: unknown, right: unknown): boolean {
	const canonical = (value: unknown): string =>
		Array.isArray(value)
			? `[${value.map(canonical).join(",")}]`
			: value && typeof value === "object"
				? `{${Object.keys(value as Record<string, unknown>)
						.filter((key) => key !== "@context")
						.sort()
						.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
						.join(",")}}`
				: JSON.stringify(value);
	return canonical(left) === canonical(right);
}

/**
 * Fetches the one selected page in the browser and reports what it shows.
 * Attribution compares nodes with the saved Shipit output; it is inferred,
 * because the page does not say which source emitted a graph.
 */
async function inspectPublicPage(url: string, record: BusinessIdentityRecord, output: BusinessIdentityView["output"]): Promise<Inspection> {
	const at = new Date().toISOString();
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return { url, at, status: "failed", message: "The page address is not valid." };
	}
	if (typeof window === "undefined" || target.origin !== window.location.origin) {
		return { url, at, status: "cross-origin", message: "This page is on another address than this admin, so the browser cannot read it from here. Open it and check its source instead." };
	}
	let html: string;
	try {
		const response = await fetch(target.href, { credentials: "same-origin", headers: { Accept: "text/html" } });
		if (!response.ok) return { url, at, status: "failed", message: `The page answered with status ${response.status}.` };
		html = await response.text();
	} catch (error: unknown) {
		return { url, at, status: "failed", message: failureMessage(error, "The page could not be fetched.") };
	}
	const page = new DOMParser().parseFromString(html, "text/html");
	const graphs: unknown[] = [];
	for (const script of page.querySelectorAll('script[type="application/ld+json"]')) {
		try {
			graphs.push(JSON.parse(script.textContent ?? ""));
		} catch {
			graphs.push(null);
		}
	}
	for (const element of page.querySelectorAll("script, style, noscript, template")) element.remove();
	const text = (page.body?.textContent ?? "").replace(/\s+/g, " ").toLocaleLowerCase();
	const facts: Array<[string, string | undefined]> = [
		["Name", record.name],
		["Phone", record.telephone],
		["Street", record.address?.streetAddress],
		["City", record.address?.addressLocality],
	];
	const visible = facts
		.filter((entry): entry is [string, string] => Boolean(entry[1]))
		.map(([fact, value]) => ({ fact, value, found: text.includes(value.replace(/\s+/g, " ").toLocaleLowerCase()) }));
	const nodes: Array<{ id: string; types: string; attribution: string }> = [];
	const visit = (value: unknown, depth: number) => {
		if (depth > 32 || !value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item, depth + 1);
			return;
		}
		const node = value as Record<string, unknown>;
		const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).filter((item): item is string => typeof item === "string");
		const id = typeof node["@id"] === "string" ? node["@id"] : "";
		if (types.some(isPublisherSchemaType)) {
			const attribution =
				id === record.entityId
					? output && (sameJson(node, output.full) || sameJson(node, output.minimal))
						? "Matches this plugin's saved output"
						: "Uses this identity's ID but differs from this plugin's saved output (another source, or a change not yet saved)"
					: id
						? "Another entity"
						: "An entity without an ID";
			nodes.push({ id: id || "No ID", types: types.join(", "), attribution });
		}
		for (const [key, child] of Object.entries(node)) {
			if (key !== "@context") visit(child, depth + 1);
		}
	};
	for (const graph of graphs) visit(graph, 0);
	return { url, at, status: "ok", visible, nodes };
}

function GraphBlock({ label, graph }: { label: string; graph: unknown }) {
	return (
		<details className="shipit-seo-identity-graph">
			<summary>{label}</summary>
			<CodeBlock lang="jsonc" code={JSON.stringify(graph, null, 2)} />
		</details>
	);
}

/** Status and entity changes; each opens its confirmation with the draft's base revision. */
function IdentityStatusActions({ state, view, disabled, dirty }: {
	state: IdentityEditorState;
	view: BusinessIdentityView;
	disabled: boolean;
	dirty: boolean;
}) {
	const record = state.base?.record ?? null;
	const revision = state.base?.revision ?? null;
	if (!record || !revision) return null;
	return (
		<section className="shipit-seo-identity-status-actions" aria-labelledby="business-identity-status-actions">
			<h3 id="business-identity-status-actions">Status and entity</h3>
			<p>
				{record.active
					? "Turning off keeps the details saved; pages then use the publisher from the site settings where this plugin adds one."
					: "Turning on makes the saved details the active publisher record again. Save or discard draft changes first."}
				{view.transitions.length ? " An entity change reviews the new ID before anything is saved." : ""}
			</p>
			<div className="shipit-seo-identity-row-actions">
				{record.active ? (
					<Button
						type="button"
						variant="secondary"
						disabled={disabled}
						onClick={() => identityStore.dispatch({ type: "confirm-open", confirmation: { action: "deactivate", expectedRevision: revision } })}
					>
						Turn off
					</Button>
				) : (
					<Button
						type="button"
						variant="secondary"
						disabled={disabled || dirty}
						onClick={() => identityStore.dispatch({ type: "confirm-open", confirmation: { action: "reactivate", expectedRevision: revision } })}
					>
						Turn on
					</Button>
				)}
				{view.transitions.map((option) => (
					<Button
						key={option.to}
						type="button"
						variant="secondary"
						disabled={disabled || dirty}
						onClick={() =>
							identityStore.dispatch({
								type: "confirm-open",
								confirmation: {
									action: "transition",
									to: option.to,
									expectedRevision: revision,
									entityId: option.entityId,
									dropped: option.dropped,
									usage: option.usage,
									usageComplete: option.usageComplete,
								},
							})
						}
					>
						{option.to === "origin" ? "Move ID to site address" : option.to === "person" ? "Change entity to a person" : "Change entity to an organization"}
					</Button>
				))}
			</div>
		</section>
	);
}

function ReviewStepView({
	state,
	view,
	draft,
	errors,
	disabled,
	statusActions,
}: {
	state: IdentityEditorState;
	view: BusinessIdentityView;
	draft: IdentityDraft;
	errors: Record<string, string>;
	disabled: boolean;
	statusActions?: React.ReactNode;
}) {
	const [tab, setTab] = React.useState<"draft" | "saved" | "inspection">("draft");
	const outputTabsRef = useTablistName<HTMLElement>({ labelledBy: "business-identity-output" });
	const [preview, setPreview] = React.useState<{ loading: boolean; result: SeoAdminBusinessIdentityPreview | null; error: string | null; document: string }>({
		loading: false,
		result: null,
		error: null,
		document: "",
	});
	// An inspection belongs to one saved revision, target and output; after any
	// of them changes its findings no longer describe the current record.
	const inspectionKey = JSON.stringify([view.revision, view.target, view.output]);
	const inspectionKeyRef = React.useRef(inspectionKey);
	inspectionKeyRef.current = inspectionKey;
	const [inspection, setInspection] = React.useState<{ loading: boolean; result: Inspection | null; key: string }>({
		loading: false,
		result: null,
		key: "",
	});
	const inspectionCurrent = inspection.result !== null && inspection.key === inspectionKey;
	const requestDocument = documentFromDraft(draft);
	const documentKey = JSON.stringify(requestDocument);
	const stale = preview.document !== documentKey;
	const errorEntries = Object.entries(errors);
	const food = foodDetailsLeftOut(draft, view.record);
	const draftBehind = state.base?.revision !== view.revision && view.state === "valid";

	const runPreview = async () => {
		setPreview((current) => ({ ...current, loading: true, error: null }));
		try {
			const result = await previewSeoAdminBusinessIdentity(requestDocument);
			setPreview({
				loading: false,
				result: result.success ? result.preview : null,
				error: result.success ? null : "Fix the fields listed above to preview the draft output.",
				document: documentKey,
			});
		} catch (error: unknown) {
			setPreview({ loading: false, result: null, error: failureMessage(error, "The draft output could not be previewed."), document: documentKey });
		}
	};
	const notices = preview.result && !stale ? preview.result.notices : view.notices;
	const ownership = preview.result && !stale ? preview.result.ownership : view.ownership;
	// Saved state, output, target and inspection all come from one read of the
	// record; the draft's own base may be older while edits are kept.
	const saved = view.record;
	const target = view.target;

	return (
		<div className="shipit-seo-identity-stack">
			<dl className="shipit-seo-details">
				<div>
					<dt>Status</dt>
					<dd>
						{!saved ? (
							<Badge variant="secondary">Not saved</Badge>
						) : saved.active ? (
							<Badge variant="success">Active</Badge>
						) : (
							<Badge variant="warning">Inactive</Badge>
						)}
					</dd>
				</div>
				<div>
					<dt>Entity ID</dt>
					<dd>
						<code>{entityIdBreakParts(saved?.entityId ?? view.replacement?.entityId ?? (view.legacy.entityId || "Set the site URL first"))
							.map((part, index) => <React.Fragment key={index}>{index ? <wbr /> : null}{part}</React.Fragment>)}</code>
						{saved ? null : view.replacement ? (
							<span className="shipit-seo-muted shipit-seo-details__note">Kept from the saved record that is being replaced.</span>
						) : (
							<span className="shipit-seo-muted shipit-seo-details__note">Kept from the publisher pages use today.</span>
						)}
					</dd>
				</div>
				<div>
					<dt>Page output</dt>
					<dd>
						{!saved
							? "Nothing is added to pages until the details are saved."
							: !saved.active
								? "Saved as inactive. Pages get the publisher from the site settings where this plugin adds one."
								: !view.switches.moduleEnabled
									? "Saved as active, but Structured data is off, so no page gets it."
									: !view.switches.presetEnabled
										? "Saved as active, but the Site publisher schema is off, so no page gets the separate publisher graph; website, article and service schema still name it inline."
										: "Saved as active. A page gets the publisher graph unless that entry turns it off or a custom schema on that page defines this ID; website, article and service schema then name it inline. Public inspection shows what one page actually contains."}
					</dd>
				</div>
				{draftBehind ? (
					<div>
						<dt>Your draft</dt>
						<dd>Started from an earlier saved version. Saving compares it with that version first.</dd>
					</div>
				) : null}
				{target ? (
					<div>
						<dt>Saved publication page</dt>
						<dd>{target.status === "ok" ? `${target.title}, ${target.url}` : target.message}</dd>
					</div>
				) : null}
			</dl>
			{statusActions}
			<TargetPicker draft={draft} view={view} disabled={disabled} error={errors.target} />
			{errorEntries.length ? (
				<div className="shipit-seo-identity-error-summary" role="alert" tabIndex={-1} id="business-identity-errors">
					<h3>Fix these before saving</h3>
					<ul>
						{errorEntries.map(([field, message]) => (
							<li key={field}>
								<Button
									type="button"
									variant="ghost"
									onClick={() => identityStore.dispatch({ type: "step", step: stepForField(field) })}
								>
									{IDENTITY_STEP_LABELS[stepForField(field)]}: {message}
								</Button>
							</li>
						))}
					</ul>
				</div>
			) : null}
			{food.saved || food.draft ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={food.saved ? "Saving removes the saved food details" : "Food details are not saved"}
					description="Cuisine, menu and reservations apply only to food establishments. The draft keeps them while you edit, so choosing a food type again restores them; saving, discarding or reloading the admin replaces the draft, and saving with this type leaves them out of the record."
				/>
			) : null}
			{notices.length ? (
				<section aria-labelledby="business-identity-notices">
					<h3 id="business-identity-notices">Notes</h3>
					<ul className="shipit-seo-identity-notices">
						{notices.map((notice) => (
							<li key={notice.code}>{notice.message}</li>
						))}
					</ul>
				</section>
			) : null}
			{ownership ? (
				ownership.status === "incomplete" ? (
					<Banner variant="alert" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />} title="Custom schemas could not all be checked" description={ownership.message} />
				) : (
					<>
						{ownership.definitions.length ? (
							<section aria-labelledby="business-identity-owned">
								<h3 id="business-identity-owned">Custom schemas that define this identity</h3>
								<p>
									These enabled schemas define {saved?.entityId ?? view.legacy.entityId}. Change them on the Schema page to reference
									{" "}{`{"@id": "${saved?.entityId ?? view.legacy.entityId}"}`} instead, remove that definition or turn them off.
								</p>
								<ul>
									{ownership.definitions.map((item) => (
										<li key={item.id}>
											{item.name} ({item.scope})
										</li>
									))}
								</ul>
							</section>
						) : null}
						{ownership.sameBusiness.length ? (
							<section aria-labelledby="business-identity-same">
								<h3 id="business-identity-same">May describe the same business</h3>
								<p>These definitions on the selected page repeat this business's details. Nothing is blocked or changed; decide whether both should stay.</p>
								<ul>
									{ownership.sameBusiness.map((item) => (
										<li key={`${item.source}:${item.id}`}>
											{item.name} ({item.scope}): {item.types.join(", ")}, same {item.matched.join(" and ")}
											{item.deprecatedType ? ". ProfessionalService is a deprecated Schema.org type; choose a specific type for it." : ""}
										</li>
									))}
								</ul>
							</section>
						) : null}
					</>
				)
			) : null}
			<section ref={outputTabsRef} aria-labelledby="business-identity-output">
				<h3 id="business-identity-output">Output</h3>
				<Tabs
					variant="underline"
					{...WRAPPING_UNDERLINE_TABS}
					tabs={[
						{ value: "draft", label: "Draft output" },
						{ value: "saved", label: "Saved output" },
						{ value: "inspection", label: "Public inspection" },
					]}
					value={tab}
					onValueChange={(value) => {
						if (value === "draft" || value === "saved" || value === "inspection") setTab(value);
					}}
				/>
				{tab === "draft" ? (
					<div className="shipit-seo-identity-stack">
						<p>What these unsaved details would produce. Nothing is saved or published by previewing.</p>
						<Button type="button" variant="secondary" loading={preview.loading} onClick={() => void runPreview()}>
							{preview.result && !stale ? "Refresh draft output" : "Preview draft output"}
						</Button>
						{preview.error ? <p className="shipit-seo-form-error" role="alert">{preview.error}</p> : null}
						{preview.result?.output && !stale ? (
							<>
								<GraphBlock label="Selected page (full details)" graph={preview.result.output.full} />
								<GraphBlock label="Every other page (name, logo and profiles)" graph={preview.result.output.minimal} />
							</>
						) : null}
						{preview.result && stale ? <p>The draft changed after this preview. Preview it again.</p> : null}
					</div>
				) : null}
				{tab === "saved" ? (
					view.output ? (
						<div className="shipit-seo-identity-stack">
							<p>
								What the saved record produces{saved?.active ? "" : " once it is turned on"}. Public output also depends on the Structured data
								module and the Site publisher schema switch.
							</p>
							<GraphBlock label="Selected page (full details)" graph={view.output.full} />
							<GraphBlock label="Every other page (name, logo and profiles)" graph={view.output.minimal} />
						</div>
					) : (
						<p>Nothing is saved yet.</p>
					)
				) : null}
				{tab === "inspection" ? (
					<div className="shipit-seo-identity-stack">
						<p>
							Reads the saved publication page once, now, and reports which details its text shows and which organization nodes its structured
							data contains. It cannot prove how search engines read the page.
						</p>
						<Button
							type="button"
							variant="secondary"
							loading={inspection.loading}
							disabled={!saved || target?.status !== "ok"}
							onClick={async () => {
								if (!saved || target?.status !== "ok") return;
								const key = inspectionKey;
								setInspection({ loading: true, result: null, key });
								const result = await inspectPublicPage(target.url, saved, view.output);
								// A result that arrives after the saved record changed is kept only as outdated.
								setInspection({ loading: false, result, key: inspectionKeyRef.current === key ? key : "" });
							}}
						>
							Inspect public page
						</Button>
						{!saved || target?.status !== "ok" ? <p>Save the identity with a published page to inspect it.</p> : null}
						{inspection.result && !inspectionCurrent ? (
							<p role="status">The saved record changed after the last inspection, so its findings are not shown. Inspect the page again.</p>
						) : null}
						{inspection.result && inspectionCurrent ? (
							<div className="shipit-seo-identity-stack shipit-seo-identity-inspection" aria-live="polite">
								<p>
									Inspected {inspection.result.url} at {new Date(inspection.result.at).toLocaleString()}.
								</p>
								{inspection.result.status !== "ok" ? (
									<p className="shipit-seo-form-error">{inspection.result.message}</p>
								) : (
									<>
										<h4>Visible text</h4>
										<ul>
											{inspection.result.visible?.map((item) => (
												<li key={item.fact}>
													{item.fact} "{item.value}": {item.found ? "shown on the page" : "not found in the page text"}
												</li>
											))}
										</ul>
										<h4>Organization and person nodes</h4>
										{inspection.result.nodes?.length ? (
											<ul>
												{inspection.result.nodes.map((node, index) => (
													<li key={`${node.id}:${index}`}>
														{node.types} {node.id}: {node.attribution}
													</li>
												))}
											</ul>
										) : (
											<p>None found.</p>
										)}
									</>
								)}
							</div>
						) : null}
					</div>
				) : null}
			</section>
		</div>
	);
}

function legacySummary(publisher: Record<string, unknown> | null): string {
	if (!publisher) return "No publisher can be built from the site settings.";
	return `${String(publisher["@type"])} "${String(publisher.name ?? "")}"${publisher["@id"] ? ` with ID ${String(publisher["@id"])}` : ""}`;
}

function Confirmations({ state }: { state: IdentityEditorState }) {
	const confirming = state.confirming;
	const [legacy, setLegacy] = React.useState<{ loading: boolean; text: string }>({ loading: false, text: "" });
	React.useEffect(() => {
		if (confirming?.action !== "deactivate") return;
		let cancelled = false;
		setLegacy({ loading: true, text: "" });
		fetchSeoAdminSettings()
			.then((settings) => {
				if (cancelled) return;
				const values = settings.values;
				if (!values) throw new Error("unreadable settings");
				setLegacy({
					loading: false,
					text: legacySummary(
						sitePublisherSchema({
							siteName: values.siteName,
							siteUrl: values.siteUrl || settings.hostSiteUrl || "",
							publisherType: values.publisherType,
							orgName: values.organizationName || values.siteName,
							orgLogo: values.organizationLogo,
							personName: values.personName,
							sameAs: values.publisherType === "person" ? values.personProfiles : values.socialProfiles,
							defaultOgImage: values.defaultSocialImage,
							twitterHandle: values.twitterHandle,
						}),
					),
				});
			})
			.catch(() => {
				if (!cancelled) setLegacy({ loading: false, text: "The site settings could not be read, so the publisher that resumes cannot be shown." });
			});
		return () => {
			cancelled = true;
		};
	}, [confirming]);
	if (!confirming) return null;
	const close = () => identityStore.dispatch({ type: "confirm-close" });
	let title = "";
	let body: React.ReactNode = null;
	let confirmLabel = "";
	let confirm: () => void = close;
	if (confirming.action === "deactivate") {
		const output = state.latest?.publisherOutput ?? "unknown";
		title = "Turn off the business identity?";
		confirmLabel = "Turn off";
		body = (
			<>
				<p>
					The record is saved as inactive and its details stay saved, so you can turn it on again.{" "}
					{output === "automatic"
						? "This plugin then uses the saved publisher from the site settings wherever it adds a publisher."
						: output === "none"
							? "Automatic publisher output is off, so no page changes now. If it is turned back on, the saved publisher from the site settings is used."
							: "The publisher output setting cannot be read, so this plugin adds no automatic publisher until it is repaired."}
				</p>
				<p aria-live="polite">{legacy.loading ? "Reading the site settings" : `Saved site settings publisher: ${legacy.text}`}</p>
				<p>
					This does not stop publisher schema. To stop the automatic publisher entirely, turn off automatic publisher output instead; that
					keeps these details saved.
				</p>
			</>
		);
		confirm = () => {
			const intended = intendedIdentityRecord(identityStore.get(), { action: "active", active: false });
			void runWrite("deactivate", intended, (signal) => setSeoAdminBusinessIdentityActive({ active: false, expectedRevision: confirming.expectedRevision }, signal));
		};
	} else if (confirming.action === "reactivate") {
		title = "Turn on the business identity?";
		confirmLabel = "Turn on";
		body = (
			<p>
				The saved details become the active publisher record. Custom schemas are checked for this identity's ID first. Whether a page shows
				it still depends on automatic publisher output, the Schema switch, the Site publisher schema and that page's own settings.
			</p>
		);
		confirm = () => {
			const intended = intendedIdentityRecord(identityStore.get(), { action: "active", active: true });
			void runWrite("activate", intended, (signal) => setSeoAdminBusinessIdentityActive({ active: true, expectedRevision: confirming.expectedRevision }, signal));
		};
	} else if (confirming.action === "replace") {
		title = "Replace the saved record?";
		confirmLabel = "Replace";
		const kept = identityStore.get().latest?.replacement;
		body = (
			<p>
				The saved business identity cannot be read. Saving replaces it with these details
				{kept
					? `, keeping its ID ${kept.entityId} and leaving it ${kept.active ? "turned on" : "turned off"}`
					: ", with the ID of the publisher pages use today"}
				. A copy of the unreadable value is not kept by this workflow.
			</p>
		);
		confirm = () => {
			const intended = intendedIdentityRecord({ ...identityStore.get(), base: null }, { action: "save", document: confirming.document });
			void runWrite("replace", intended, (signal) =>
				saveSeoAdminBusinessIdentity({ document: confirming.document, expectedRevision: confirming.expectedRevision, replaceInvalid: true }, signal),
			);
		};
	} else if (confirming.action === "adopt") {
		title = "Set up a different publisher entity?";
		confirmLabel = "Save new publisher";
		body = (
			<>
				<p>The publisher ID changes from <code>{confirming.publisherChange.fromEntityId}</code> to <code>{confirming.entityId}</code>.</p>
				<p>Custom schemas are not rewritten. References to the old ID will not point to this identity. Saving checks ID ownership and references again; this review does not list every reference.</p>
			</>
		);
		confirm = () => {
			const intended = intendedIdentityRecord(identityStore.get(), { action: "save", document: confirming.document, publisherChange: confirming.publisherChange });
			void runWrite("save", intended, (signal) => saveSeoAdminBusinessIdentity({ document: confirming.document, expectedRevision: null, publisherChange: confirming.publisherChange }, signal));
		};
	} else if (confirming.action === "transition") {
		const target = confirming.to;
		title = target === "origin" ? "Move the entity ID to the current site address?" : `Change the entity to ${target === "person" ? "a person" : "an organization"}?`;
		confirmLabel = "Change entity";
		body = (
			<>
				<p>
					The ID becomes <code>{confirming.entityId}</code>. Custom schemas are not rewritten; references to the old ID stop pointing at this identity.
				</p>
				<p>This changes the saved entity using its saved details. Your form values are kept for a later Save; unsaved edits are not included in this change.</p>
				{confirming.requestedKind === "LocalBusiness" ? <p>The saved entity first becomes an Organization. The form then keeps Local business selected so you can review its details and save them separately.</p> : null}
				{confirming.dropped.length ? <p>A person cannot carry these saved details, so they are left out of the record: {confirming.dropped.join(", ")}. Your draft keeps them.</p> : null}
				{confirming.usageComplete ? (
					confirming.usage.length ? (
						<>
							<p>Custom schemas that name the old or new ID:</p>
							<ul>
								{confirming.usage.map((item) => (
									<li key={item.id}>
										{item.name} ({item.scope}): {[...item.defines.map((id) => `defines ${id}`), ...item.references.map((id) => `references ${id}`)].join(", ")}
									</li>
								))}
							</ul>
						</>
					) : (
						<p>No custom schema names the old or new ID.</p>
					)
				) : (
					<p>Custom schemas could not all be checked. The change will be refused until they can be.</p>
				)}
			</>
		);
		confirm = () => {
			const intended = intendedIdentityRecord(identityStore.get(), { action: "transition", to: target, entityId: confirming.entityId });
			void runWrite("transition", intended, (signal) =>
				transitionSeoAdminBusinessIdentityEntity({ to: target, expectedRevision: confirming.expectedRevision }, signal),
				confirming.requestedKind ?? (target === "origin" ? state.draft?.kind : target === "person" ? "Person" : "Organization"),
			);
		};
	}
	return (
		<Dialog.Root role="alertdialog" open onOpenChange={(open) => (open ? undefined : close())}>
			<Dialog size="sm" className="shipit-seo-delete-dialog">
				<Dialog.Title>{title}</Dialog.Title>
				<Dialog.Description render={<div />}>{body}</Dialog.Description>
				<div className="shipit-seo-dialog-actions">
					<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Cancel</Button>} />
					<Button type="button" variant="primary" disabled={confirming.action === "deactivate" && legacy.loading} onClick={confirm}>
						{confirmLabel}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

function NoticeBanner({ state }: { state: IdentityEditorState }) {
	const notice = state.notice;
	const headingRef = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		if (notice && notice.kind !== "info") headingRef.current?.focus();
	}, [notice]);
	if (!notice) return null;
	const pending = state.pending !== null;
	const differences = identityConflictDifferences(state);
	const icon = <WarningCircle size={20} weight="fill" aria-hidden="true" />;
	return (
		<div ref={headingRef} tabIndex={-1} className="shipit-seo-identity-notice">
			{notice.kind === "info" ? (
				<Banner
					variant="default"
					title={notice.message}
					description={
						notice.usage?.length
							? `Custom schemas that name the old or new ID: ${notice.usage.map((item) => `${item.name} (${item.scope})`).join(", ")}. They were not rewritten.`
							: undefined
					}
					action={<Button type="button" variant="secondary" onClick={() => identityStore.dispatch({ type: "dismiss" })}>Dismiss</Button>}
				/>
			) : notice.kind === "unconfirmed" ? (
				<Banner
					variant="alert"
					icon={icon}
					title="The change could not be confirmed"
					description={`${notice.message} Editing is paused until then.`}
					action={
						<Button type="button" variant="primary" loading={state.pending === "check"} onClick={() => void checkSavedRecord()}>
							Check saved record
						</Button>
					}
				/>
			) : notice.kind === "uncertain" ? (
				<Banner
					variant="alert"
					icon={icon}
					title="Storage refused the change"
					description={notice.message}
					action={
						<Button type="button" variant="secondary" loading={state.pending === "check"} onClick={() => void checkSavedRecord()}>
							Read saved record
						</Button>
					}
				/>
			) : notice.kind === "conflict" ? (
				<div className="shipit-seo-identity-stack">
					<Banner variant="alert" icon={icon} title="Changed elsewhere" description={notice.message} />
					{differences.length ? (
						<table className="shipit-seo-identity-differences">
							<caption>Saved now compared with your draft</caption>
							<thead>
								<tr>
									<th scope="col">Field</th>
									<th scope="col">Saved now</th>
									<th scope="col">Yours</th>
								</tr>
							</thead>
							<tbody>
								{differences.map((item) => (
									<tr key={item.field}>
										<th scope="row">{item.field}</th>
										<td>{item.saved}</td>
										<td>{item.draft}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : null}
					<div className="shipit-seo-identity-row-actions">
						<Button type="button" variant="secondary" disabled={pending} onClick={() => identityStore.dispatch({ type: "use-latest" })}>
							Use saved version
						</Button>
						<Button type="button" variant="secondary" disabled={pending || !state.latest?.writable} onClick={() => identityStore.dispatch({ type: "keep-edits" })}>
							Keep my edits
						</Button>
					</div>
				</div>
			) : notice.kind === "owned" ? (
				<Banner
					variant="error"
					icon={icon}
					title="Custom schemas define this identity's ID"
					description={`${notice.message} ${notice.definitions.map((item) => `${item.name} (${item.scope})`).join(", ")}`}
				/>
			) : (
				<Banner
					variant={notice.kind === "invalid_stored" ? "alert" : "error"}
					icon={icon}
					title={notice.kind === "denied" ? "Permission needed" : notice.kind === "incomplete" ? "Could not check custom schemas" : notice.kind === "invalid_stored" ? "The saved record is invalid" : "Not saved"}
					description={notice.message}
					action={
						notice.kind === "invalid_stored" ? null : (
							<Button type="button" variant="secondary" onClick={() => identityStore.dispatch({ type: "dismiss" })}>
								Dismiss
							</Button>
						)
					}
				/>
			)}
		</div>
	);
}

/**
 * The identity steps of the one Local SEO draft. Website is a separate record
 * with its own save, reached from the Identity step, so it is not a step.
 */
export function LocalSeoNavigation() {
	const state = useIdentityEditor();
	const { t } = useSeoI18n();
	const steps: readonly IdentityStep[] = state.draft ? IDENTITY_STEPS : ["identity"];
	const selected = state.draft ? state.step : "identity";
	const completion = state.draft ? identityStepCompletion(state.draft, state.errors) : null;
	const selectStep = (value: IdentityStep) => {
		if (!steps.includes(value) || value === state.step) return;
		identityStore.dispatch({ type: "step", step: value });
	};
	const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button[data-local-seo-view]") ?? []);
		const current = buttons.indexOf(event.currentTarget);
		const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
			: (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
		buttons[next]?.focus();
	};
	return <nav className="shipit-seo-local-navigation" data-destination-count={steps.length} aria-label={t("nav.view.identity")}>
		{steps.map((step, index) => {
			const marker = completion?.[step] ?? null;
			return <button key={step} type="button"
				data-local-seo-view={step} data-step-state={marker ?? undefined} aria-current={selected === step ? "step" : undefined}
				onClick={() => selectStep(step)} onKeyDown={handleKeyDown}>
				<span className="shipit-seo-local-navigation__number">{index + 1}</span>
				<span>{IDENTITY_STEP_LABELS[step]}</span>
				{marker === "done" ? <CheckCircle size={16} weight="fill" aria-hidden="true" />
					: marker === "attention" ? <WarningCircle size={16} weight="fill" aria-hidden="true" /> : null}
				{marker ? <span className="sr-only">{`, ${t(marker === "done" ? "localSeo.step.done" : "localSeo.step.attention")}`}</span> : null}
			</button>;
		})}
	</nav>;
}

/** The Local SEO form has its own saved record, draft and Save. */
export function BusinessIdentitySection({ onOpenSiteSettings, showStepNavigation = true, websiteSummary = null }: {
	onOpenSiteSettings?: () => void;
	showStepNavigation?: boolean;
	/** Read-only Website summary shown on the Identity step; Website keeps its own form and save. */
	websiteSummary?: React.ReactNode;
} = {}) {
	const state = useIdentityEditor();
	const [picker, setPicker] = React.useState<"logo" | "image" | null>(null);
	const [pickerError, setPickerError] = React.useState<string | null>(null);
	const headingId = React.useId();

	React.useEffect(() => {
		void refreshBusinessIdentity();
	}, []);

	// One request, one focus move, after the requested step has rendered.
	const focus = state.focus;
	React.useEffect(() => {
		if (!focus) return;
		const timer = window.setTimeout(() => {
			const field = focus.target === "status" ? null : document.getElementById(focus.target === "profiles" ? IDENTITY_PROFILES_CONTROL_ID : IDENTITY_PUBLIC_NAME_ID);
			// A disabled field cannot take focus; the heading then names where editing is.
			const target = field && !(field as HTMLInputElement).disabled ? field : document.getElementById(headingId);
			target?.scrollIntoView({ block: "center" });
			target?.focus({ preventScroll: true });
			identityStore.dispatch({ type: "focus-handled", request: focus.request });
		}, 0);
		return () => window.clearTimeout(timer);
	}, [focus, headingId]);

	const view = state.latest;
	if (!view) {
		return (
			<section className="shipit-seo-panel shipit-seo-identity-business" aria-labelledby={headingId} aria-busy={state.loadError ? undefined : true}>
				<h2 id={headingId} tabIndex={-1}>Business identity and Local SEO</h2>
				{state.loadError ? (
					<Banner variant="error" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />} title="The business identity could not be loaded" description={state.loadError} />
				) : (
					<p aria-live="polite">Loading business identity</p>
				)}
				{state.loadError ? (
					<Button type="button" variant="secondary" onClick={() => void refreshBusinessIdentity()}>
						Try again
					</Button>
				) : null}
			</section>
		);
	}
	const draft = state.draft;
	const record = state.base?.record ?? null;
	const locked = identityLocked(state);
	const busy = state.pending !== null;
	const writable = view.writable && view.state !== "corrupt" && view.state !== "read_unavailable";
	const disabled = busy || locked || !writable;
	const clientErrors = draft && state.showErrors ? draftErrors(draft) : {};
	const errors = { ...clientErrors, ...state.errors };
	const dirty = identityDirty(state);
	const noSiteUrl = !record && !view.replacement && !view.legacy.entityId;

	const save = () => {
		if (!draft || disabled) return;
		// Writing happens only from Review, after the owner has seen the output
		// notes; an earlier submit, including Enter in a field, goes there instead.
		if (state.step !== "review") {
			identityStore.dispatch({ type: "step", step: "review" });
			return;
		}
		const validation = draftErrors(draft);
		if (Object.keys(validation).length) {
			identityStore.dispatch({ type: "show-errors" });
			identityStore.dispatch({ type: "step", step: "review" });
			window.setTimeout(() => document.getElementById("business-identity-errors")?.focus(), 0);
			return;
		}
		const requestDocument = documentFromDraft(draft);
		if (state.base?.state === "invalid" && state.base.revision) {
			identityStore.dispatch({ type: "confirm-open", confirmation: { action: "replace", expectedRevision: state.base.revision, document: requestDocument } });
			return;
		}
		const adoption = identityAdoptionReview(state, requestDocument);
		if (adoption) {
			identityStore.dispatch({ type: "confirm-open", confirmation: adoption });
			return;
		}
		const expectedRevision = state.base?.state === "valid" ? state.base.revision : null;
		const intended = intendedIdentityRecord(state, { action: "save", document: requestDocument });
		void runWrite("save", intended, (signal) => saveSeoAdminBusinessIdentity({ document: requestDocument, expectedRevision }, signal));
	};

	const stepProps: StepProps | null = draft
		? {
				draft,
				errors,
				disabled,
				adopted: record?.kind ?? null,
				legacyFamily: view.legacy.publisherType,
				keptFamily: view.state === "invalid" ? view.replacement?.family ?? null : null,
				allowNewFamily: view.state === "absent",
				siteUrl: view.siteUrl,
			}
		: null;
	const stepIndex = IDENTITY_STEPS.indexOf(state.step);

	return (
		<section className="shipit-seo-panel shipit-seo-identity-business" aria-labelledby={headingId}>
			<div className="shipit-seo-section-heading">
				<div>
					<span className="shipit-seo-eyebrow">Local SEO</span>
					<h2 id={headingId} tabIndex={-1}>Business identity and Local SEO</h2>
				</div>
				{view.record ? (
					view.record.active ? <Badge variant="success">Active</Badge> : <Badge variant="warning">Inactive</Badge>
				) : view.state === "absent" ? (
					<Badge variant="secondary">Not set up</Badge>
				) : (
					<Badge variant="error">Needs attention</Badge>
				)}
			</div>
			<p>
				Describe who publishes this site and, for a local business, one location. The full details are added to one page you choose; other
				pages link to the same publisher by name, logo and profiles.
			</p>
			{state.loadError ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="The latest version could not be read"
					description={`${state.loadError} The form keeps what was loaded before.`}
					action={<Button type="button" variant="secondary" onClick={() => void refreshBusinessIdentity()}>Try again</Button>}
				/>
			) : null}
			{!view.writable && view.message && view.state !== "corrupt" && view.state !== "read_unavailable" ? (
				<Banner variant="alert" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />} title="Read only on this site" description={view.message} />
			) : null}
			{view.state === "corrupt" || view.state === "read_unavailable" ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={view.state === "corrupt" ? "The saved record is damaged" : "The saved record could not be read"}
					description={`${view.message ?? ""} Until it can be read, pages get no publisher from this plugin and publisher links are left out.`}
				/>
			) : null}
			{view.state === "invalid" ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="The saved record is invalid"
					description="Pages get no publisher from this plugin until it is replaced. Set up the details below and save to replace it after confirming."
				/>
			) : null}
			{noSiteUrl ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Set the site URL first"
					description="The identity's ID is built from the site address. Save a production site URL in Local SEO's Website settings first."
						action={onOpenSiteSettings ? <Button type="button" variant="secondary" onClick={onOpenSiteSettings}>Edit website</Button> : undefined}
				/>
			) : null}
			{!view.switches.moduleEnabled ? (
				<Banner
					variant="secondary"
					title="No structured data right now"
					description="The Schema switch in Feature controls is off, so this plugin adds no structured data, including custom schema."
				/>
			) : view.publisherOutput !== "automatic" ? (
				<Banner
					variant={view.publisherOutput === "unknown" ? "error" : "secondary"}
					title={view.publisherOutput === "unknown" ? "Publisher ownership is unknown" : "Automatic publisher output is off"}
					description={
						view.publisherOutput === "unknown"
							? "The publisher output setting cannot be read, so this plugin adds no automatic publisher. These details stay saved."
							: "This plugin adds no publisher from these details, and no publisher links or inline publisher facts. Editing and saving still work, and custom schema may define this ID while output is off."
					}
				/>
			) : !view.switches.presetEnabled ? (
				<Banner
					variant="secondary"
					title="No separate publisher graph right now"
					description="The Site publisher schema is turned off on the Schema page, so pages get no separate publisher graph. Website, article and service schema still name the publisher inline."
				/>
			) : null}
			<NoticeBanner state={state} />
			{!draft ? websiteSummary : null}
			{!draft ? (
				view.state === "absent" || view.state === "invalid" ? (
					<div className="shipit-seo-identity-stack">
						<p>
							Nothing is saved yet{view.state === "invalid" ? " that can be read" : ""}. Setting up starts from the saved site settings publisher;
							nothing changes until you save.
						</p>
						<div>
							<Button type="button" variant="primary" icon={Buildings} disabled={!writable || noSiteUrl || busy} onClick={() => identityStore.dispatch({ type: "setup" })}>
								Set up business identity
							</Button>
						</div>
					</div>
				) : null
			) : (
				<form
					className="shipit-seo-identity-form"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						save();
					}}
				>
					{showStepNavigation ? <Tabs
						className="shipit-seo-identity-tabs"
						variant="underline"
						tabs={IDENTITY_STEPS.map((step) => ({ value: step, label: IDENTITY_STEP_LABELS[step] }))}
						value={state.step}
						onValueChange={(value) => {
							if ((IDENTITY_STEPS as readonly string[]).includes(value)) identityStore.dispatch({ type: "step", step: value as IdentityStep });
						}}
					/> : null}
					<div className="shipit-seo-identity-step">
						{stepProps && state.step === "identity" ? websiteSummary : null}
						{stepProps && state.step === "identity" ? (
							<IdentityStepView
								{...stepProps}
								onPickMedia={(field) => {
									setPickerError(null);
									setPicker(field);
								}}
							/>
						) : null}
						{stepProps && state.step === "contact" ? <ContactStepView {...stepProps} /> : null}
						{stepProps && state.step === "social" ? <SocialStepView {...stepProps} /> : null}
						{stepProps && state.step === "address" ? <AddressStepView {...stepProps} /> : null}
						{stepProps && state.step === "location" ? <LocationStepView {...stepProps} /> : null}
						{stepProps && state.step === "review" ? (
							<ReviewStepView state={state} view={view} draft={draft} errors={errors} disabled={disabled}
								statusActions={<IdentityStatusActions state={state} view={view} disabled={disabled} dirty={dirty} />} />
						) : null}
						{pickerError ? <p className="shipit-seo-form-error" role="alert">{pickerError}</p> : null}
					</div>
					{/* Enter in a field on steps 1 to 5 opens Review through the same save path. */}
					{state.step !== "review" ? <button type="submit" hidden tabIndex={-1} aria-hidden="true" /> : null}
					<div className="shipit-seo-identity-footer">
						<div className="shipit-seo-identity-row-actions">
							<Button
								type="button"
								variant="secondary"
								icon={ArrowLeft}
								disabled={stepIndex <= 0}
								onClick={() => identityStore.dispatch({ type: "step", step: IDENTITY_STEPS[stepIndex - 1] })}
							>
								Previous
							</Button>
						</div>
						<p aria-live="polite">{busy ? "Working" : dirty ? "Unsaved changes" : record ? "Saved" : "Not saved"}</p>
						<div className="shipit-seo-identity-row-actions">
							<Button type="button" variant="secondary" disabled={busy || locked || (!identityDraftTouched(state) && !!record)} onClick={() => identityStore.dispatch({ type: "discard" })}>
								Discard changes
							</Button>
							{state.step === "review" ? (
								<Button type="submit" variant="primary" icon={FloppyDisk} loading={state.pending === "save" || state.pending === "replace"} disabled={disabled || (!dirty && !!record)}>
									{identitySaveLabel(state)}
								</Button>
							) : (
								<Button
									type="button"
									variant="primary"
									icon={ArrowRight}
									disabled={stepIndex >= IDENTITY_STEPS.length - 1}
									onClick={() => identityStore.dispatch({ type: "step", step: IDENTITY_STEPS[stepIndex + 1] })}
								>
									Next
								</Button>
							)}
						</div>
					</div>
				</form>
			)}
			<Confirmations state={state} />
			<MediaPickerModal
				open={picker !== null}
				onOpenChange={(open) => {
					if (!open) setPicker(null);
				}}
				mediaKind="image"
				mimeTypeFilters={["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"]}
				localOnly
				title={picker === "logo" ? "Choose logo" : "Choose image"}
				onSelect={(item) => {
					const url = selectedLocalMediaUrl(item.url);
					const field = picker;
					setPicker(null);
					if (!url || !field) {
						setPickerError("This image could not be used. Choose another image.");
						return;
					}
					setPickerError(null);
					const media: BusinessIdentityMediaRef = {
						url,
						...(typeof item.width === "number" && item.width > 0 ? { width: Math.round(item.width) } : {}),
						...(typeof item.height === "number" && item.height > 0 ? { height: Math.round(item.height) } : {}),
					};
					edit((current) => ({ ...current, [field]: media }));
				}}
			/>
		</section>
	);
}
