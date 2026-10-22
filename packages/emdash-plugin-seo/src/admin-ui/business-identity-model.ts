// Editor state for the business identity. The draft keeps every value the
// owner typed, including values that do not apply to the chosen kind, and the
// revision it was loaded from until the owner saves, discards or chooses a
// newer version. A background refresh never replaces either. A request whose
// outcome is unknown locks writes until the stored record is checked.

import {
	BUSINESS_IDENTITY_DAYS,
	businessIdentityFactsForKind,
	businessIdentityFamily,
	businessIdentityEntityIdFor,
	businessIdentityEntityOrigin,
	businessIdentityEntityFamily,
	validateBusinessIdentityFacts,
	type BusinessIdentityAreaServed,
	type BusinessIdentityContactType,
	type BusinessIdentityDay,
	type BusinessIdentityKind,
	type BusinessIdentityMediaRef,
	type BusinessIdentityRecord,
	type BusinessIdentityTarget,
} from "../business-identity.ts";
import { isFoodEstablishmentType } from "../local-business-catalogue.ts";
import type { BusinessIdentityOwnedDefinition } from "../business-identity.ts";
import type {
	BusinessIdentityCheck,
	BusinessIdentityIdUsage,
	BusinessIdentityPublisherChange,
	BusinessIdentityView,
	BusinessIdentityWriteResult,
} from "../business-identity-commands.ts";

export type DayState = "unknown" | "closed" | "open24" | "periods";

export interface DayDraft {
	state: DayState;
	periods: Array<{ opens: string; closes: string }>;
}

export interface ContactPointDraft {
	contactType: BusinessIdentityContactType;
	telephone: string;
	email: string;
	availableLanguage: string[];
	areaServed: string[];
}

export interface AreaDraft {
	kind: BusinessIdentityAreaServed["kind"];
	name: string;
	countryCode: string;
}

/** Form values as typed. Nothing here is validated; `documentFromDraft` builds the request. */
export interface IdentityDraft {
	kind: BusinessIdentityKind;
	/** As stored or chosen; a name outside the catalogue is kept so its error can be shown. */
	businessType: string;
	name: string;
	alternateName: string;
	legalName: string;
	description: string;
	logo: BusinessIdentityMediaRef | null;
	image: BusinessIdentityMediaRef | null;
	telephone: string;
	email: string;
	contactPoints: ContactPointDraft[];
	sameAs: string[];
	publishAddress: boolean;
	address: { streetAddress: string; addressLocality: string; addressRegion: string; postalCode: string; addressCountry: string };
	areaServed: AreaDraft[];
	latitude: string;
	longitude: string;
	mapUrl: string;
	hoursMode: "unpublished" | "weekly";
	days: Record<BusinessIdentityDay, DayDraft>;
	priceRange: string;
	servesCuisine: string[];
	menuUrl: string;
	acceptsReservations: "unset" | "yes" | "no";
	target: BusinessIdentityTarget;
}

export const IDENTITY_STEPS = ["identity", "contact", "social", "address", "location", "review"] as const;
export type IdentityStep = (typeof IDENTITY_STEPS)[number];
export const IDENTITY_STEP_LABELS: Record<IdentityStep, string> = {
	identity: "Identity",
	contact: "Contact",
	social: "Social",
	address: "Address and area",
	location: "Location and hours",
	review: "Review and save",
};

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function media(value: unknown): BusinessIdentityMediaRef | null {
	const source = record(value);
	if (typeof source.url !== "string" || !source.url) return null;
	return {
		url: source.url,
		...(typeof source.width === "number" ? { width: source.width } : {}),
		...(typeof source.height === "number" ? { height: source.height } : {}),
	};
}

/** An entity ID split after each slash outside "//" and before "#", so a narrow column breaks there before inside a word. */
export function entityIdBreakParts(value: string): string[] {
	return value.split(/(?<=\/)(?!\/)|(?=#)/).filter(Boolean);
}

export function emptyDays(): Record<BusinessIdentityDay, DayDraft> {
	return Object.fromEntries(BUSINESS_IDENTITY_DAYS.map((day) => [day, { state: "unknown", periods: [] }])) as unknown as Record<
		BusinessIdentityDay,
		DayDraft
	>;
}

/** A draft from a stored record or the legacy prefill. Out-of-bound values are kept so their errors can be shown. */
export function draftFromFacts(source: unknown): IdentityDraft {
	const facts = record(source);
	const kind = (["Person", "Organization", "LocalBusiness"] as const).find((item) => item === facts.kind) ?? "Organization";
	const businessType = typeof facts.businessType === "string" ? facts.businessType : "LocalBusiness";
	const address = record(facts.address);
	const location = record(facts.location);
	const geo = record(location.geo);
	const hours = record(location.hours);
	const days = emptyDays();
	const storedDays = record(hours.days);
	for (const day of BUSINESS_IDENTITY_DAYS) {
		const value = record(storedDays[day]);
		const state = (["unknown", "closed", "open24", "periods"] as const).find((item) => item === value.state) ?? "unknown";
		days[day] = {
			state,
			periods: list(value.periods).map((period) => ({ opens: text(record(period).opens), closes: text(record(period).closes) })),
		};
	}
	const restaurant = record(facts.restaurant);
	const target = record(facts.target);
	return {
		kind,
		businessType,
		name: text(facts.name),
		alternateName: text(facts.alternateName),
		legalName: text(facts.legalName),
		description: text(facts.description),
		logo: media(facts.logo),
		image: media(facts.image),
		telephone: text(facts.telephone),
		email: text(facts.email),
		contactPoints: list(facts.contactPoints).map((item) => {
			const point = record(item);
			return {
				contactType: (text(point.contactType) || "customer service") as BusinessIdentityContactType,
				telephone: text(point.telephone),
				email: text(point.email),
				availableLanguage: list(point.availableLanguage).map(text).filter(Boolean),
				areaServed: list(point.areaServed).map(text).filter(Boolean),
			};
		}),
		sameAs: list(facts.sameAs).map(text),
		publishAddress: Object.keys(address).length > 0,
		address: {
			streetAddress: text(address.streetAddress),
			addressLocality: text(address.addressLocality),
			addressRegion: text(address.addressRegion),
			postalCode: text(address.postalCode),
			addressCountry: text(address.addressCountry),
		},
		areaServed: list(facts.areaServed).map((item) => {
			const area = record(item);
			return {
				kind: (["Country", "State", "City", "Place"] as const).find((value) => value === area.kind) ?? "City",
				name: text(area.name),
				countryCode: text(area.countryCode),
			};
		}),
		latitude: text(geo.latitude),
		longitude: text(geo.longitude),
		mapUrl: text(location.mapUrl),
		hoursMode: hours.mode === "weekly" ? "weekly" : "unpublished",
		days,
		priceRange: text(facts.priceRange),
		servesCuisine: list(restaurant.servesCuisine).map(text),
		menuUrl: text(restaurant.menuUrl),
		acceptsReservations: restaurant.acceptsReservations === true ? "yes" : restaurant.acceptsReservations === false ? "no" : "unset",
		target:
			target.kind === "content"
				? {
						kind: "content",
						collection: text(target.collection),
						entryId: text(target.entryId),
						locale: typeof target.locale === "string" ? target.locale : null,
						title: text(target.title),
					}
				: { kind: "home" },
	};
}

function optional(key: string, value: string): Record<string, string> {
	return value.trim() ? { [key]: value } : {};
}

/**
 * The request document: only the fields the chosen kind can carry, without
 * empty optional values. Values for other kinds stay in the draft, so
 * switching back restores them.
 */
export function documentFromDraft(draft: IdentityDraft): Record<string, unknown> {
	const person = draft.kind === "Person";
	const local = draft.kind === "LocalBusiness";
	const document: Record<string, unknown> = {
		kind: draft.kind,
		...(local ? { businessType: draft.businessType } : {}),
		name: draft.name,
		...optional("alternateName", draft.alternateName),
		...(person ? {} : optional("legalName", draft.legalName)),
		...optional("description", draft.description),
		...(!person && draft.logo ? { logo: draft.logo } : {}),
		...(draft.image ? { image: draft.image } : {}),
		...optional("telephone", draft.telephone),
		...optional("email", draft.email),
		contactPoints: draft.contactPoints.map((point) => ({
			contactType: point.contactType,
			...optional("telephone", point.telephone),
			...optional("email", point.email),
			availableLanguage: point.availableLanguage,
			areaServed: person ? [] : point.areaServed,
		})),
		sameAs: draft.sameAs.filter((url) => url.trim()),
		areaServed: person
			? []
			: draft.areaServed.map((area) =>
					area.kind === "Country"
						? { kind: "Country", countryCode: area.countryCode }
						: { kind: area.kind, name: area.name, ...optional("countryCode", area.countryCode) },
				),
		target: draft.target,
	};
	if (!person && draft.publishAddress) {
		document.address = {
			streetAddress: draft.address.streetAddress,
			addressLocality: draft.address.addressLocality,
			...optional("addressRegion", draft.address.addressRegion),
			...optional("postalCode", draft.address.postalCode),
			addressCountry: draft.address.addressCountry,
		};
	}
	if (local) {
		const hours =
			draft.hoursMode === "weekly"
				? {
						mode: "weekly",
						days: Object.fromEntries(
							BUSINESS_IDENTITY_DAYS.map((day) => {
								const value = draft.days[day];
								return [day, value.state === "periods" ? { state: "periods", periods: value.periods } : { state: value.state }];
							}),
						),
					}
				: { mode: "unpublished" };
		document.location = {
			...(draft.latitude.trim() || draft.longitude.trim() ? { geo: { latitude: draft.latitude, longitude: draft.longitude } } : {}),
			...optional("mapUrl", draft.mapUrl),
			hours,
		};
		Object.assign(document, optional("priceRange", draft.priceRange));
		if (isFoodEstablishmentType(draft.businessType)) {
			document.restaurant = {
				servesCuisine: draft.servesCuisine.filter((item) => item.trim()),
				...optional("menuUrl", draft.menuUrl),
				...(draft.acceptsReservations === "unset" ? {} : { acceptsReservations: draft.acceptsReservations === "yes" }),
			};
		}
	}
	return document;
}

/**
 * Food details that the chosen kind and type cannot carry. They stay in the
 * draft, so choosing a food type again restores them, but saving leaves them
 * out of the request and so removes them from the stored record.
 */
export function foodDetailsLeftOut(draft: IdentityDraft, saved: BusinessIdentityRecord | null): { draft: boolean; saved: boolean } {
	if (draft.kind === "LocalBusiness" && isFoodEstablishmentType(draft.businessType)) return { draft: false, saved: false };
	const stored = saved?.restaurant;
	return {
		draft: draft.servesCuisine.some((item) => item.trim()) || Boolean(draft.menuUrl.trim()) || draft.acceptsReservations !== "unset",
		saved: Boolean(stored && (stored.servesCuisine.length || stored.menuUrl || stored.acceptsReservations !== undefined)),
	};
}

/** Field errors for the request this draft would send. */
export function draftErrors(draft: IdentityDraft): Record<string, string> {
	const validation = validateBusinessIdentityFacts(documentFromDraft(draft));
	return validation.success ? {} : validation.errors;
}

/** The step that shows a field path, for error navigation. */
export function stepForField(path: string): IdentityStep {
	const head = path.split(".", 1)[0];
	if (["telephone", "email", "contactPoints"].includes(head)) return "contact";
	if (head === "sameAs") return "social";
	if (["address", "areaServed"].includes(head)) return "address";
	if (["location", "priceRange", "restaurant"].includes(head)) return "location";
	if (["target", "_form"].includes(head)) return "review";
	return "identity";
}

export type IdentityStepCompletion = "done" | "attention";

/**
 * Each step's marker, from the same validation as the Review error summary
 * plus the server's field errors from the last refused write.
 */
export function identityStepCompletion(
	draft: IdentityDraft,
	serverErrors: Readonly<Record<string, string>> = {},
): Record<IdentityStep, IdentityStepCompletion> {
	const completion = Object.fromEntries(IDENTITY_STEPS.map((step) => [step, "done"])) as Record<IdentityStep, IdentityStepCompletion>;
	for (const field of [...Object.keys(draftErrors(draft)), ...Object.keys(serverErrors)]) completion[stepForField(field)] = "attention";
	return completion;
}

export type IdentityPending = "load" | "save" | "replace" | "activate" | "deactivate" | "transition" | "check" | null;

export type IdentityNotice =
	| { kind: "conflict"; message: string }
	| { kind: "unconfirmed"; intended: BusinessIdentityRecord | null; loaded: BusinessIdentityRecord | null; message: string }
	| { kind: "uncertain"; message: string }
	| { kind: "owned"; message: string; definitions: BusinessIdentityOwnedDefinition[] }
	| { kind: "invalid_stored" | "incomplete" | "failed" | "denied"; message: string }
	| { kind: "info"; message: string; usage?: BusinessIdentityIdUsage[] };

export type IdentityConfirmation =
	| { action: "deactivate" | "reactivate"; expectedRevision: string }
	| { action: "transition"; to: "origin" | "person" | "organization"; expectedRevision: string; entityId: string; dropped: string[]; usage: BusinessIdentityIdUsage[]; usageComplete: boolean; requestedKind?: BusinessIdentityKind }
	| { action: "replace"; expectedRevision: string; document: Record<string, unknown> }
	| { action: "adopt"; document: Record<string, unknown>; publisherChange: BusinessIdentityPublisherChange; entityId: string };

export interface IdentityBase {
	state: BusinessIdentityView["state"];
	revision: string | null;
	record: BusinessIdentityRecord | null;
}

export interface IdentityEditorState {
	latest: BusinessIdentityView | null;
	/** What the draft was loaded from; its revision guards the next write. */
	base: IdentityBase | null;
	/** Null until the owner starts setup or a saved record is loaded. */
	draft: IdentityDraft | null;
	pending: IdentityPending;
	notice: IdentityNotice | null;
	/** Server field errors from the last refused write. */
	errors: Record<string, string>;
	/** Show client validation after the first save attempt or a visit to Review. */
	showErrors: boolean;
	confirming: IdentityConfirmation | null;
	step: IdentityStep;
	/** Keeps the requested kind and all form values across a reviewed entity transition. */
	transitionKind: BusinessIdentityKind | null;
	/** A failed background read; it never replaces a notice or unlocks writes. */
	loadError: string | null;
	/** A background read is in flight, so `latest` may be older than the stored record. */
	reading: boolean;
	/** A one-use request to move focus to the publisher editor; `request` grows with each ask. */
	focus: { request: number; target: "public-name" | "profiles" | "status" } | null;
}

export const INITIAL_IDENTITY_EDITOR: IdentityEditorState = Object.freeze({
	latest: null,
	base: null,
	draft: null,
	pending: null,
	notice: null,
	errors: {},
	showErrors: false,
	confirming: null,
	step: "identity",
	transitionKind: null,
	loadError: null,
	reading: false,
	focus: null,
}) as IdentityEditorState;

export type IdentityWriteIntent = "save" | "replace" | "activate" | "deactivate" | "transition";

export type IdentityEditorEvent =
	| { type: "receive"; view: BusinessIdentityView }
	| { type: "setup" }
	| { type: "edit"; update: (draft: IdentityDraft) => IdentityDraft }
	| { type: "step"; step: IdentityStep }
	| { type: "select-kind"; kind: BusinessIdentityKind }
	| { type: "discard" }
	| { type: "show-errors" }
	| { type: "confirm-open"; confirmation: IdentityConfirmation }
	| { type: "confirm-close" }
	| { type: "start"; pending: Exclude<IdentityPending, null>; transitionKind?: BusinessIdentityKind }
	| { type: "write-result"; intent: IdentityWriteIntent; result: BusinessIdentityWriteResult; intended: BusinessIdentityRecord | null }
	| {
			type: "request-failed";
			intent: IdentityWriteIntent | "load" | "check";
			failure: "denied" | "rejected" | "unknown";
			message: string;
			/** The record the write would store, rebuilt in the browser, for the recovery check. */
			intended?: BusinessIdentityRecord | null;
	  }
	| { type: "check-result"; check: BusinessIdentityCheck | undefined; view: BusinessIdentityView }
	| { type: "use-latest" }
	| { type: "keep-edits" }
	| { type: "dismiss" }
	| { type: "load-start" }
	| { type: "edit-publisher"; target?: "public-name" | "profiles" }
	| { type: "focus-handled"; request: number };

export const IDENTITY_DENIED_MESSAGE =
	"Changing the business identity needs the plugin administrator permission (plugins:manage). Nothing was changed.";
const UNCONFIRMED_MESSAGE =
	"The change could not be confirmed. It may or may not have been stored. Check the saved record before editing again.";

function baseOf(view: BusinessIdentityView): IdentityBase {
	return { state: view.state, revision: view.revision, record: view.record };
}

function adopt(state: IdentityEditorState, view: BusinessIdentityView, notice: IdentityNotice | null): IdentityEditorState {
	return {
		...state,
		latest: view,
		base: baseOf(view),
		draft: view.record ? draftFromFacts(view.record) : null,
		pending: null,
		notice,
		errors: {},
		showErrors: false,
		confirming: null,
		transitionKind: null,
		loadError: null,
	};
}

/** Whether saving would change what is stored: only the fields the chosen kind carries count. */
export function identityDirty(state: IdentityEditorState): boolean {
	if (!state.draft) return false;
	if (!state.base?.record) return true;
	return JSON.stringify(documentFromDraft(state.draft)) !== JSON.stringify(documentFromDraft(draftFromFacts(state.base.record)));
}

/**
 * Whether any editor value differs from the loaded record, including values
 * kept for another kind. Only an untouched draft may follow a refresh.
 */
export function identityDraftTouched(state: IdentityEditorState): boolean {
	if (!state.draft) return false;
	if (!state.base?.record) return true;
	return JSON.stringify(state.draft) !== JSON.stringify(draftFromFacts(state.base.record));
}

/** Writes wait for a recovery read after an unknown outcome or a refusal that could not be explained. */
export function identityLocked(state: IdentityEditorState): boolean {
	return state.notice?.kind === "unconfirmed" || state.notice?.kind === "uncertain";
}

function successMessage(intent: IdentityWriteIntent): string {
	switch (intent) {
		case "save":
		case "replace":
			return "Business identity saved.";
		case "activate":
			return "Business identity saved as active.";
		case "deactivate":
			return "Business identity saved as inactive. The details stay saved.";
		case "transition":
			return "The entity ID changed. Custom schemas were not rewritten.";
	}
}

/** Captures the existing publisher binding and requested document for an explicit first-entity review. */
export function identityAdoptionReview(state: IdentityEditorState, document: Record<string, unknown>): Extract<IdentityConfirmation, { action: "adopt" }> | null {
	if (state.base?.state !== "absent" || state.latest?.state !== "absent" || state.pending || identityLocked(state) || !state.latest.writable) return null;
	const facts = validateBusinessIdentityFacts(document);
	if (!facts.success || businessIdentityFamily(facts.value.kind) === state.latest.legacy.publisherType) return null;
	const previous = state.latest.legacy;
	if (businessIdentityEntityFamily(previous.entityId) !== previous.publisherType) return null;
	const entityId = businessIdentityEntityIdFor(state.latest.siteUrl, businessIdentityFamily(facts.value.kind));
	if (!entityId) return null;
	return { action: "adopt", document,
		publisherChange: { confirmed: true, fromEntityId: previous.entityId, fromType: previous.publisherType }, entityId };
}

/** Focus stays within the loaded form; selecting a profile field never creates or activates a record. */
function identityDraftFocusable(state: IdentityEditorState): boolean {
	return state.draft !== null && state.latest?.writable === true && !state.reading && state.loadError === null &&
		state.pending === null && !identityLocked(state);
}

/** A family change reviews the saved entity; an ordinary kind change edits only this draft. */
export function selectIdentityKind(state: IdentityEditorState, kind: BusinessIdentityKind): IdentityEditorState {
	if (!identityDraftFocusable(state) || state.notice?.kind === "conflict" || state.confirming || !state.draft) return state;
	const saved = state.base?.record;
	if (saved && businessIdentityFamily(saved.kind) !== businessIdentityFamily(kind)) {
		if (state.latest?.state !== "valid" || state.latest.revision !== state.base?.revision) return state;
		const option = state.latest.transitions.find((item) => item.to === businessIdentityFamily(kind));
		if (!option || !state.base?.revision) return state;
		return { ...state, confirming: { action: "transition", ...option, expectedRevision: state.base.revision, requestedKind: kind } };
	}
	if (state.latest?.state === "invalid") {
		const family = state.latest.replacement?.family ?? state.latest.legacy.publisherType;
		if (businessIdentityFamily(kind) !== family) return state;
	}
	return { ...state, draft: { ...state.draft, kind } };
}

export function identityEditorReducer(state: IdentityEditorState, event: IdentityEditorEvent): IdentityEditorState {
	switch (event.type) {
		case "load-start":
			return state.reading ? state : { ...state, reading: true };
		case "edit-publisher": {
			const target = event.target ?? "public-name";
			// A profile request is consumed at the current owner, never replayed after a failed or unfinished read.
			if (target === "profiles" && !identityDraftFocusable(state)) return { ...state, focus: null };
			const editable = identityDraftFocusable(state);
			return {
				...state,
				step: editable ? target === "profiles" ? "social" : "identity" : state.step,
				focus: { request: (state.focus?.request ?? 0) + 1, target: editable ? target : "status" },
			};
		}
		case "focus-handled":
			return state.focus?.request === event.request ? { ...state, focus: null } : state;
		case "receive":
		case "request-failed": {
			const next = reduceIdentityEditor(state, event);
			if (event.type === "request-failed" && event.intent !== "load") return next;
			const settled = next.reading ? { ...next, reading: false } : next;
			return settled.focus?.target === "profiles" && (!identityDraftFocusable(settled) || publisherProfileDestination(settled) !== publisherProfileDestination(state))
				? { ...settled, focus: null } : settled;
		}
		default:
			return reduceIdentityEditor(state, event);
	}
}

function reduceIdentityEditor(state: IdentityEditorState, event: IdentityEditorEvent): IdentityEditorState {
	switch (event.type) {
		case "receive": {
			if (!state.base) return adopt(state, event.view, null);
			// An open confirmation keeps what it shows; the write then meets the newer version as a conflict.
			if (state.confirming) return { ...state, latest: event.view, loadError: null };
			const unsettled = identityLocked(state) || state.notice?.kind === "conflict" || state.pending !== null;
			if (!identityDraftTouched(state) && !unsettled) return { ...adopt(state, event.view, state.notice), step: state.step };
			const changedElsewhere = !state.pending && !state.notice && event.view.revision !== state.base.revision;
			return {
				...state,
				latest: event.view,
				loadError: null,
				notice: changedElsewhere
					? { kind: "conflict", message: "The business identity was changed elsewhere while you were editing. Review it before saving." }
					: state.notice,
			};
		}
		case "setup": {
			if (state.draft || !state.latest || state.pending) return state;
			const draft = draftFromFacts(state.latest.legacy.draft);
			// Replacing an invalid record keeps its entity, so the draft starts in that family.
			const family = state.latest.replacement?.family;
			if (family === "person" && draft.kind !== "Person") draft.kind = "Person";
			if (family === "organization" && draft.kind === "Person") draft.kind = "Organization";
			return { ...state, draft, step: "identity", showErrors: false, errors: {} };
		}
		case "select-kind":
			return selectIdentityKind(state, event.kind);
		case "edit":
			if (!state.draft || state.pending || identityLocked(state)) return state;
			return { ...state, draft: event.update(state.draft) };
		case "step":
			return { ...state, step: event.step, showErrors: state.showErrors || event.step === "review" };
		case "discard":
			if (state.pending || identityLocked(state) || !state.latest) return state;
			return { ...adopt(state, state.latest, null), step: "identity" };
		case "show-errors":
			return { ...state, showErrors: true };
		case "confirm-open":
			if (state.pending || identityLocked(state) || state.notice?.kind === "conflict") return state;
			return { ...state, confirming: event.confirmation };
		case "confirm-close":
			return state.confirming ? { ...state, confirming: null } : state;
		case "start":
			return { ...state, pending: event.pending, confirming: null,
				transitionKind: event.pending === "transition" ? event.transitionKind ?? state.draft?.kind ?? null : event.pending === "check" ? state.transitionKind : null,
				errors: event.pending === "check" ? state.errors : {} };
		case "write-result": {
			const { result } = event;
			if (result.success) {
				const view = state.latest;
				const next: IdentityEditorState = {
					...state,
					base: { state: "valid", revision: result.revision, record: result.record },
					draft: event.intent === "transition" && state.draft ? { ...state.draft, kind: state.transitionKind ?? result.record.kind } : draftFromFacts(result.record),
					transitionKind: null,
					pending: null,
					errors: {},
					showErrors: false,
					confirming: null,
					notice: { kind: "info", message: successMessage(event.intent), ...(result.usage?.length ? { usage: result.usage } : {}) },
				};
				return view ? { ...next, latest: { ...view, state: "valid", revision: result.revision, record: result.record } } : next;
			}
			const message = result.errors._form ?? "Nothing was saved.";
			switch (result.error) {
				case "conflict":
					return { ...state, pending: null, notice: { kind: "conflict", message } };
				case "unconfirmed":
					return {
						...state,
						pending: null,
						notice: {
							kind: "unconfirmed",
							intended: result.intended ?? event.intended,
							loaded: state.base?.record ?? null,
							message: UNCONFIRMED_MESSAGE,
						},
					};
				case "storage_uncertain":
					return { ...state, pending: null, notice: { kind: "uncertain", message } };
				case "owned_id_defined":
					return { ...state, pending: null, notice: { kind: "owned", message, definitions: result.definitions ?? [] } };
				case "collision_check_incomplete":
					return { ...state, pending: null, notice: { kind: "incomplete", message } };
				case "invalid_stored":
					return { ...state, pending: null, notice: { kind: "invalid_stored", message } };
				case "invalid": {
					const errors = Object.fromEntries(Object.entries(result.errors).filter(([key]) => key !== "_form"));
					return {
						...state,
						pending: null,
						errors,
						showErrors: true,
						notice: result.errors._form ? { kind: "failed", message: result.errors._form } : null,
					};
				}
				default:
					return { ...state, pending: null, notice: { kind: "failed", message } };
			}
		}
		case "request-failed": {
			if (event.intent === "load") {
				return {
					...state,
					loadError: event.failure === "denied" ? IDENTITY_DENIED_MESSAGE : event.message,
				};
			}
			if (event.failure === "unknown" && event.intent !== "check") {
				return {
					...state,
					pending: null,
					notice: { kind: "unconfirmed", intended: event.intended ?? null, loaded: state.base?.record ?? null, message: UNCONFIRMED_MESSAGE },
				};
			}
			if (identityLocked(state) && event.intent === "check") {
				return { ...state, pending: null, notice: { ...state.notice!, message: `${UNCONFIRMED_MESSAGE} ${event.message}` } as IdentityNotice };
			}
			return {
				...state,
				pending: null,
				notice: event.failure === "denied" ? { kind: "denied", message: IDENTITY_DENIED_MESSAGE } : { kind: "failed", message: event.message },
			};
		}
		case "check-result": {
			if (!identityLocked(state)) return { ...state, pending: null, latest: event.view };
			if (event.check === "matches_requested") {
				const resolved = adopt(state, event.view, {
					kind: "info",
					message: "The saved record now has the values you asked for. This does not show which request stored them.",
				});
				return state.transitionKind && state.draft ? { ...resolved, draft: { ...state.draft, kind: state.transitionKind } } : resolved;
			}
			if (event.check === "matches_loaded") {
				return {
					...state,
					latest: event.view,
					base: baseOf(event.view),
					pending: null,
					notice: { kind: "info", message: "The saved record still has the values you loaded. Your edits are kept; you can save again." },
				};
			}
			return {
				...state,
				latest: event.view,
				pending: null,
				notice: { kind: "conflict", message: "The saved record differs from both your request and the version you loaded. Review it before saving again." },
			};
		}
		case "use-latest":
			if (state.pending || !state.latest || identityLocked(state)) return state;
			return { ...adopt(state, state.latest, null), step: state.step };
		case "keep-edits":
			// The owner reviewed the newer version and applies the draft over it.
			if (state.pending || !state.latest || state.notice?.kind !== "conflict") return state;
			return { ...state, base: baseOf(state.latest), notice: null };
		case "dismiss":
			if (identityLocked(state) || state.notice?.kind === "conflict") return state;
			return { ...state, notice: null };
		default:
			return state;
	}
}

/** Top-level fields whose newer saved value differs from the kept draft, for review before keeping edits. */
export function identityConflictDifferences(state: IdentityEditorState): Array<{ field: string; saved: string; draft: string }> {
	if (state.notice?.kind !== "conflict" || !state.latest || !state.draft) return [];
	const saved = state.latest.record ? documentFromDraft(draftFromFacts(state.latest.record)) : {};
	const draft = documentFromDraft(state.draft);
	const keys = [...new Set([...Object.keys(saved), ...Object.keys(draft)])];
	return keys.flatMap((field) => {
		const left = JSON.stringify(saved[field] ?? null);
		const right = JSON.stringify(draft[field] ?? null);
		return left === right ? [] : [{ field, saved: left === "null" ? "Not set" : left, draft: right === "null" ? "Not set" : right }];
	});
}

export interface IdentityEditorStore {
	get(): IdentityEditorState;
	dispatch(event: IdentityEditorEvent): void;
	subscribe(listener: () => void): () => void;
}

/** Outlives the view, so leaving Site identity keeps the draft, its revision, a pending request and its recovery. */
export function createIdentityEditorStore(initial: IdentityEditorState = INITIAL_IDENTITY_EDITOR): IdentityEditorStore {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		dispatch(event) {
			const next = identityEditorReducer(state, event);
			if (next === state) return;
			state = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const PLACEHOLDER_TIME = "1970-01-01T00:00:00.000Z";

/**
 * The complete record a write would store, rebuilt from what the editor
 * loaded, for the recovery check after a request that returned nothing.
 * The update time is ignored by that comparison.
 */
export function intendedIdentityRecord(
	state: IdentityEditorState,
	intent:
		| { action: "save"; document: Record<string, unknown>; publisherChange?: BusinessIdentityPublisherChange }
		| { action: "active"; active: boolean }
		| { action: "transition"; to: "origin" | "person" | "organization"; entityId: string },
): BusinessIdentityRecord | null {
	const base = state.base?.record ?? null;
	if (intent.action === "save") {
		const facts = validateBusinessIdentityFacts(intent.document);
		if (!facts.success) return null;
		if (base) {
			return {
				...facts.value,
				version: 1,
				updatedAt: PLACEHOLDER_TIME,
				active: base.active,
				entityId: base.entityId,
				...(base.organizationReferenceAliases ? { organizationReferenceAliases: true as const } : {}),
			};
		}
		const replacement = state.latest?.state === "invalid" ? state.latest.replacement : null;
		if (replacement) {
			return {
				...facts.value,
				version: 1,
				updatedAt: PLACEHOLDER_TIME,
				active: replacement.active,
				entityId: replacement.entityId,
				...(replacement.organizationReferenceAliases ? { organizationReferenceAliases: true as const } : {}),
			};
		}
		const legacy = state.latest?.legacy;
		if (!legacy?.entityId) return null;
		if (state.base?.state === "absent" && intent.publisherChange) {
			const change = intent.publisherChange;
			if (!change.confirmed || businessIdentityEntityFamily(change.fromEntityId) !== change.fromType || change.fromType === businessIdentityFamily(facts.value.kind)) return null;
			return { ...facts.value, version: 1, updatedAt: PLACEHOLDER_TIME, active: true,
				entityId: businessIdentityEntityIdFor(businessIdentityEntityOrigin(change.fromEntityId), businessIdentityFamily(facts.value.kind)) };
		}
		if (state.base?.state === "absent" && businessIdentityFamily(facts.value.kind) !== legacy.publisherType) return null;
		return {
			...facts.value,
			version: 1,
			updatedAt: PLACEHOLDER_TIME,
			active: true,
			entityId: legacy.entityId,
			...(legacy.publisherType === "person" ? { organizationReferenceAliases: true as const } : {}),
		};
	}
	if (!base) return null;
	if (intent.action === "active") return { ...base, active: intent.active, updatedAt: PLACEHOLDER_TIME };
	const { version: _version, updatedAt: _updatedAt, active, entityId: _entityId, organizationReferenceAliases, ...facts } = base;
	const converted = intent.to === "origin"
		? facts
		: businessIdentityFactsForKind(facts, intent.to === "person" ? "Person" : "Organization").facts;
	return {
		...converted,
		version: 1,
		updatedAt: PLACEHOLDER_TIME,
		active,
		entityId: intent.entityId,
		...(intent.to === "origin" && organizationReferenceAliases ? { organizationReferenceAliases: true as const } : {}),
	};
}

/** Whether the legacy publisher fields in the site settings are read-only now. */
export function legacyPublisherLocked(view: BusinessIdentityView | null): boolean {
	if (!view) return false;
	if (view.state === "absent") return false;
	if (view.state === "valid") return view.record?.active === true;
	return true;
}

/**
 * Legacy publisher fields are editable only after a read that completed
 * without a later failure shows no active identity. Before the first read,
 * while a read or an identity write is in flight, after a failed refresh and
 * while a write outcome is unsettled they stay read-only: an inactive snapshot
 * then cannot show that the legacy publisher is selected.
 */
export function legacyPublisherEditable(state: IdentityEditorState): boolean {
	return state.latest !== null && !state.reading && state.loadError === null && state.pending === null &&
		!identityLocked(state) && !legacyPublisherLocked(state.latest);
}

export type PublisherProfileDestination = "business" | "legacy";

/** The editable owner established by the last completed read; navigation never starts setup or a write. */
export function publisherProfileDestination(state: IdentityEditorState): PublisherProfileDestination | null {
	if (!state.latest || state.reading || state.loadError !== null || state.pending !== null || identityLocked(state)) return null;
	if (legacyPublisherEditable(state)) return "legacy";
	return state.latest.state === "valid" && state.latest.record?.active === true && state.latest.writable && state.draft !== null
		? "business" : null;
}

/** The publisher facts a summary shows: type, public name, logo and profiles. */
export interface PublisherSummaryFacts {
	kind: BusinessIdentityKind;
	businessType: string;
	name: string;
	logo: string | null;
	profiles: string[];
}

function summaryFacts(draft: IdentityDraft): PublisherSummaryFacts {
	return {
		kind: draft.kind,
		businessType: draft.kind === "LocalBusiness" ? draft.businessType : "",
		name: draft.name.trim(),
		logo: draft.kind !== "Person" && draft.logo?.url ? draft.logo.url : null,
		profiles: draft.sameAs.map((url) => url.trim()).filter(Boolean),
	};
}

/**
 * `settled`: the last read describes the current selection. `pending`: an
 * identity write is in flight. `unknown`: a write's outcome is unconfirmed or
 * unexplained until an explicit reload. Only `settled` describes live ownership.
 */
export type PublisherSelection = "settled" | "pending" | "unknown";

/**
 * The selected publisher source. Selection comes from the newest successful
 * read (`latest`) only, never from a draft kept after a conflict or a failed
 * refresh. For an active identity the facts follow the editor's draft, marked
 * as a draft while they differ from the saved record.
 */
export type PublisherSourceSummary =
	| { kind: "loading" }
	| { kind: "unavailable"; message: string }
	| { kind: "unknown"; state: "invalid" | "corrupt" | "read_unavailable"; refreshError: string | null; reading: boolean; selection: PublisherSelection }
	| {
			kind: "business";
			saved: PublisherSummaryFacts;
			/** Unsaved editor values, when they differ from the saved record. */
			draft: PublisherSummaryFacts | null;
			/** The draft was loaded from an older revision than the one read last. */
			draftBehind: boolean;
			refreshError: string | null;
			reading: boolean;
			selection: PublisherSelection;
	  }
	| { kind: "legacy"; identity: "absent" | "inactive"; refreshError: string | null; reading: boolean; selection: PublisherSelection };

export function publisherSourceSummary(state: IdentityEditorState): PublisherSourceSummary {
	const latest = state.latest;
	if (!latest) return state.loadError ? { kind: "unavailable", message: state.loadError } : { kind: "loading" };
	const refreshError = state.loadError;
	const reading = state.reading;
	const selection: PublisherSelection = identityLocked(state) ? "unknown" : state.pending !== null && state.pending !== "check" ? "pending" : "settled";
	if (latest.state === "valid" && latest.record) {
		if (!latest.record.active) return { kind: "legacy", identity: "inactive", refreshError, reading, selection };
		const saved = summaryFacts(draftFromFacts(latest.record));
		const draft = state.draft && state.base?.state === "valid" ? summaryFacts(state.draft) : null;
		return {
			kind: "business",
			saved,
			draft: draft && JSON.stringify(draft) !== JSON.stringify(saved) ? draft : null,
			draftBehind: state.base?.revision !== latest.revision,
			refreshError,
			reading,
			selection,
		};
	}
	if (latest.state === "absent") return { kind: "legacy", identity: "absent", refreshError, reading, selection };
	return { kind: "unknown", state: latest.state as "invalid" | "corrupt" | "read_unavailable", refreshError, reading, selection };
}

/** The facts of an inactive or absent identity that would change on saving the draft, for the save label. */
export function identitySaveLabel(state: IdentityEditorState): string {
	if (!state.base || state.base.state === "absent") return "Save as active";
	if (state.base.state === "invalid") return "Replace saved record";
	return state.base.record?.active ? "Save changes" : "Save details";
}
