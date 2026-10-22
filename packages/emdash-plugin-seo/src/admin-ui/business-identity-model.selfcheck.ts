import assert from "node:assert/strict";

import { validateBusinessIdentityFacts, validateBusinessIdentityRecord, type BusinessIdentityRecord } from "../business-identity.ts";
import type { BusinessIdentityView } from "../business-identity-commands.ts";
import {
	INITIAL_IDENTITY_EDITOR,
	IDENTITY_STEPS,
	IDENTITY_STEP_LABELS,
	identityAdoptionReview,
	selectIdentityKind,
	documentFromDraft,
	draftErrors,
	draftFromFacts,
	entityIdBreakParts,
	foodDetailsLeftOut,
	identityConflictDifferences,
	identityDirty,
	identityDraftTouched,
	identityEditorReducer,
	identityLocked,
	intendedIdentityRecord,
	legacyPublisherEditable,
	legacyPublisherLocked,
	publisherProfileDestination,
	publisherSourceSummary,
	stepForField,
	type IdentityEditorEvent,
	type IdentityEditorState,
} from "./business-identity-model.ts";

const ORIGIN = "https://shop.example";
const organization: BusinessIdentityRecord = {
	version: 1,
	updatedAt: "2026-10-02T10:00:00.000Z",
	active: true,
	entityId: `${ORIGIN}/#organization`,
	kind: "Organization",
	name: "Harbour Bakery",
	contactPoints: [],
	sameAs: ["https://social.example/harbour"],
	areaServed: [],
	target: { kind: "home" },
};
assert.equal(validateBusinessIdentityRecord(organization).success, true);

function view(record: BusinessIdentityRecord | null, revision: string | null, state: BusinessIdentityView["state"] = record ? "valid" : "absent"): BusinessIdentityView {
	return {
		storageVersion: 1,
		state,
		revision,
		record,
		issues: {},
		writable: true,
		message: null,
		siteName: "Harbour Bakery",
		siteUrl: `${ORIGIN}/`,
		legacy: { publisherType: "organization", entityId: `${ORIGIN}/#organization`, draft: { kind: "Organization", name: "Harbour Bakery", contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } }, issues: {} },
		replacement: null,
		switches: { moduleEnabled: true, presetEnabled: true },
		publisherOutput: "automatic",
		collections: { available: true, items: [{ collection: "pages", label: "Pages" }] },
		target: null,
		ownership: null,
		notices: [],
		output: null,
		usage: null,
		transitions: [],
	};
}

const run = (state: IdentityEditorState, ...events: IdentityEditorEvent[]) => events.reduce(identityEditorReducer, state);

// ---- Hidden values survive a refresh ----
{
	let state = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(organization, "r1") });
	assert.equal(identityDraftTouched(state), false);
	state = run(
		state,
		{ type: "edit", update: (draft) => ({ ...draft, kind: "LocalBusiness" }) },
		{ type: "edit", update: (draft) => ({ ...draft, hoursMode: "weekly", days: { ...draft.days, Monday: { state: "periods", periods: [{ opens: "09:07", closes: "17:00" }] } } }) },
		{ type: "edit", update: (draft) => ({ ...draft, kind: "Organization" }) },
	);
	assert.equal(identityDirty(state), false, "the published document is unchanged once the kind is back");
	assert.equal(identityDraftTouched(state), true, "but the editor holds a value the owner typed");
	const refreshed = run(state, { type: "receive", view: view(organization, "r1") });
	assert.equal(refreshed.draft?.days.Monday.periods[0]?.opens, "09:07", "a refresh does not erase hidden hours");
	assert.equal(refreshed.draft?.hoursMode, "weekly");
	const switchedBack = run(refreshed, { type: "edit", update: (draft) => ({ ...draft, kind: "LocalBusiness" }) });
	assert.equal((documentFromDraft(switchedBack.draft!).location as any)?.hours?.days?.Monday?.periods?.[0]?.opens, "09:07", "switching the kind back restores them");
	const newer = run(state, { type: "receive", view: view({ ...organization, name: "Harbour Bakery NL", updatedAt: "2026-10-02T11:00:00.000Z" }, "r2") });
	assert.equal(newer.base?.revision, "r1", "a touched draft keeps the revision it was loaded from");
	assert.equal(newer.notice?.kind, "conflict");
	assert.deepEqual(identityConflictDifferences(newer).map((item) => item.field), ["name"]);
	const kept = run(newer, { type: "keep-edits" });
	assert.equal(kept.base?.revision, "r2", "keeping edits applies them over the reviewed version");
}

// ---- Untouched drafts follow the server ----
{
	const state = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(organization, "r1") }, { type: "receive", view: view({ ...organization, name: "New" }, "r2") });
	assert.equal(state.base?.revision, "r2");
	assert.equal(state.draft?.name, "New");
	assert.equal(state.notice, null);
}

// ---- Recovery locks survive background load failures ----
{
	let state = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(organization, "r1") }, { type: "edit", update: (draft) => ({ ...draft, name: "Harbour Bakery Amsterdam" }) }, { type: "start", pending: "save" });
	const intended = intendedIdentityRecord(state, { action: "save", document: documentFromDraft(state.draft!) });
	assert.equal(intended?.entityId, organization.entityId, "the rebuilt intended record keeps the stored ID");
	assert.equal(intended?.active, true);
	assert.equal(intended && validateBusinessIdentityRecord(intended).success, true, "the rebuilt record is a complete valid record");
	state = run(state, { type: "request-failed", intent: "save", failure: "unknown", message: "timeout", intended });
	assert.equal(identityLocked(state), true);
	assert.equal(state.notice?.kind === "unconfirmed" && state.notice.intended?.name, "Harbour Bakery Amsterdam");
	state = run(state, { type: "request-failed", intent: "load", failure: "unknown", message: "network down" });
	assert.equal(identityLocked(state), true, "a failed background read keeps the recovery lock");
	assert.equal(state.loadError, "network down");
	state = run(state, { type: "edit", update: (draft) => ({ ...draft, name: "x" }) });
	assert.equal(state.draft?.name, "Harbour Bakery Amsterdam", "edits stay paused");
	state = run(state, { type: "receive", view: view({ ...organization, name: "Harbour Bakery Amsterdam" }, "r2") });
	assert.equal(identityLocked(state), true, "a refresh does not settle an unconfirmed write");
	const requested = run(state, { type: "start", pending: "check" }, { type: "check-result", check: "matches_requested", view: view({ ...organization, name: "Harbour Bakery Amsterdam" }, "r2") });
	assert.equal(identityLocked(requested), false);
	assert.match(requested.notice?.message ?? "", /does not show which request/);
	const loaded = run(state, { type: "start", pending: "check" }, { type: "check-result", check: "matches_loaded", view: view(organization, "r3") });
	assert.equal(loaded.draft?.name, "Harbour Bakery Amsterdam", "matching the loaded values keeps the edits");
	assert.equal(loaded.base?.revision, "r3");
	const differs = run(state, { type: "start", pending: "check" }, { type: "check-result", check: "differs", view: view({ ...organization, name: "Other" }, "r4") });
	assert.equal(differs.notice?.kind, "conflict", "different values are a conflict to review, never a success");
}

// ---- Server results ----
{
	const base = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(null, null) }, { type: "setup" });
	assert.equal(base.draft?.name, "Harbour Bakery", "setup starts from the legacy publisher");
	assert.equal(identityDirty(base), true);
	const lost = run(base, { type: "start", pending: "save" }, { type: "write-result", intent: "save", intended: null, result: { success: false, error: "unconfirmed", errors: { _form: "x" }, intended: organization } });
	assert.equal(lost.notice?.kind === "unconfirmed" && lost.notice.intended?.entityId, organization.entityId, "the server's intended record is kept for the check");
	assert.equal(lost.notice?.kind === "unconfirmed" && lost.notice.loaded, null);
	const invalid = run(base, { type: "start", pending: "save" }, { type: "write-result", intent: "save", intended: null, result: { success: false, error: "invalid", errors: { "contactPoints.0.telephone": "bad" } } });
	assert.equal(invalid.errors["contactPoints.0.telephone"], "bad");
	assert.equal(stepForField("contactPoints.0.telephone"), "contact");
	assert.equal(stepForField("location.hours.days.Monday.periods.0.opens"), "location");
	const uncertain = run(base, { type: "start", pending: "save" }, { type: "write-result", intent: "save", intended: null, result: { success: false, error: "storage_uncertain", errors: { _form: "refused" } } });
	assert.equal(identityLocked(uncertain), true, "an unexplained refusal pauses writes until the record is read");
	const activated = run(base, { type: "start", pending: "activate" }, { type: "write-result", intent: "activate", intended: null, result: { success: true, record: organization, revision: "r9" } });
	assert.doesNotMatch(activated.notice?.message ?? "", /publish|Google|verified|pages now/i, "a saved state is not described as page output");
}

// ---- Request documents per kind ----
{
	const draft = draftFromFacts({
		...organization,
		kind: "Person",
		legalName: "Harbour Bakery B.V.",
		address: { streetAddress: "Kade 1", addressLocality: "Amsterdam", addressCountry: "NL" },
	});
	const document = documentFromDraft(draft);
	assert.ok(!("legalName" in document) && !("address" in document), "values a person cannot carry stay in the draft only");
	assert.equal(draft.legalName, "Harbour Bakery B.V.");
	assert.equal(validateBusinessIdentityFacts(document).success, true);
}

// ---- Catalogue types and the food family ----
{
	const bakery: BusinessIdentityRecord = {
		...organization,
		kind: "LocalBusiness",
		businessType: "Bakery",
		address: { streetAddress: "Kade 1", addressLocality: "Amsterdam", addressCountry: "NL" },
		location: { hours: { mode: "unpublished" } },
		restaurant: { servesCuisine: ["Dutch"], menuUrl: "https://shop.example/menu", acceptsReservations: false },
	};
	assert.equal(validateBusinessIdentityRecord(bakery).success, true);
	const draft = draftFromFacts(bakery);
	assert.equal(draft.businessType, "Bakery");
	const bakeryDocument = documentFromDraft(draft);
	assert.deepEqual(bakeryDocument.restaurant, { servesCuisine: ["Dutch"], menuUrl: "https://shop.example/menu", acceptsReservations: false });
	assert.deepEqual(foodDetailsLeftOut(draft, bakery), { draft: false, saved: false });
	const salon = { ...draft, businessType: "HairSalon" };
	const salonDocument = documentFromDraft(salon);
	assert.equal(salonDocument.businessType, "HairSalon");
	assert.ok(!("restaurant" in salonDocument), "leaving the food family leaves the food details out of the request");
	assert.equal(validateBusinessIdentityFacts(salonDocument).success, true);
	assert.deepEqual(foodDetailsLeftOut(salon, bakery), { draft: true, saved: true }, "Review can say that saving removes them");
	assert.equal(salon.menuUrl, "https://shop.example/menu", "the draft keeps them");
	assert.deepEqual(documentFromDraft({ ...salon, businessType: "CafeOrCoffeeShop" }).restaurant, bakeryDocument.restaurant, "another food type restores them");
	assert.deepEqual(foodDetailsLeftOut({ ...salon, kind: "Organization" }, null), { draft: true, saved: false });
	const emptyFood = { ...bakery, restaurant: { servesCuisine: [] } };
	assert.deepEqual(foodDetailsLeftOut(draftFromFacts({ ...emptyFood, businessType: "HairSalon" }), emptyFood), { draft: false, saved: false }, "empty food details remove nothing worth a warning");
	const unknown = draftFromFacts({ ...bakery, businessType: "Bakeryy" });
	assert.equal(unknown.businessType, "Bakeryy", "a type outside the catalogue is shown, never replaced");
	assert.match(draftErrors(unknown).businessType ?? "", /not a business type this version supports/);
	assert.match(draftErrors({ ...salon, businessType: "" }).businessType ?? "", /Choose a business type/, "a cleared choice cannot be saved");
	assert.equal(stepForField("businessType"), "identity");
}

// ---- Replacing an invalid record keeps its entity ----
{
	const invalid = { ...view(null, "r-bad", "invalid"), replacement: { entityId: `${ORIGIN}/#person`, family: "person" as const, active: false, organizationReferenceAliases: true } };
	const state = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: invalid }, { type: "setup" });
	assert.equal(state.draft?.kind, "Person", "setup starts in the family the replacement keeps");
	const intended = intendedIdentityRecord(state, { action: "save", document: documentFromDraft(state.draft!) });
	assert.equal(intended?.entityId, `${ORIGIN}/#person`);
	assert.equal(intended?.active, false);
	assert.equal(intended?.organizationReferenceAliases, true);
}

assert.equal(legacyPublisherLocked(view(null, null)), false);
assert.equal(legacyPublisherLocked(view(organization, "r1")), true);
assert.equal(legacyPublisherLocked(view({ ...organization, active: false }, "r1")), false);
assert.equal(legacyPublisherLocked(view(null, "r1", "invalid")), true);
assert.equal(legacyPublisherLocked(view(null, null, "read_unavailable")), true);

// ---- Selected publisher source and legacy editing ----
{
	assert.deepEqual(publisherSourceSummary(INITIAL_IDENTITY_EDITOR), { kind: "loading" });
	assert.equal(legacyPublisherEditable(INITIAL_IDENTITY_EDITOR), false, "nothing is editable before the first read");
	const firstFailed = run(INITIAL_IDENTITY_EDITOR, { type: "load-start" }, { type: "request-failed", intent: "load", failure: "unknown", message: "offline" });
	assert.deepEqual(publisherSourceSummary(firstFailed), { kind: "unavailable", message: "offline" });
	assert.equal(firstFailed.reading, false);
	assert.equal(legacyPublisherEditable(firstFailed), false);

	const legacy = run(INITIAL_IDENTITY_EDITOR, { type: "load-start" }, { type: "receive", view: view(null, null) });
	assert.equal(legacy.reading, false);
	assert.equal(publisherSourceSummary(legacy).kind, "legacy");
	assert.equal(legacyPublisherEditable(legacy), true, "a completed read showing no identity makes the legacy fields the editor");
	assert.equal(legacyPublisherEditable(run(legacy, { type: "load-start" })), false, "not while a newer read is in flight");
	const refreshFailed = run(legacy, { type: "load-start" }, { type: "request-failed", intent: "load", failure: "unknown", message: "timeout" });
	assert.equal(legacyPublisherEditable(refreshFailed), false, "not after a failed refresh");
	const failedSummary = publisherSourceSummary(refreshFailed);
	assert.ok(failedSummary.kind === "legacy" && failedSummary.refreshError === "timeout", "the failed refresh is reported with the last read");

	const inactive = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view({ ...organization, active: false }, "r1") });
	assert.equal(legacyPublisherEditable(inactive), true);
	assert.equal(legacyPublisherEditable(run(inactive, { type: "start", pending: "activate" })), false, "not while activation is pending");
	const lostActivation = run(inactive, { type: "start", pending: "activate" }, { type: "request-failed", intent: "activate", failure: "unknown", message: "reset", intended: { ...organization, active: true } });
	assert.equal(identityLocked(lostActivation), true);
	assert.equal(legacyPublisherEditable(lostActivation), false, "an inactive snapshot after a lost activation does not show the legacy publisher is selected");
	const pendingSummary = publisherSourceSummary(run(inactive, { type: "start", pending: "activate" }));
	assert.ok(pendingSummary.kind === "legacy" && pendingSummary.selection === "pending", "while activation is in flight the selection is pending");
	const lostSummary = publisherSourceSummary(lostActivation);
	assert.ok(lostSummary.kind === "legacy" && lostSummary.identity === "inactive", "the facts are still the last read");
	assert.equal(lostSummary.kind === "legacy" && lostSummary.selection, "unknown", "after a lost activation the selection is unknown, not the inactive snapshot");
	const recovered = run(lostActivation, { type: "start", pending: "check" }, { type: "check-result", check: "matches_requested", view: view(organization, "r2") });
	const recoveredSummary = publisherSourceSummary(recovered);
	assert.ok(recoveredSummary.kind === "business" && recoveredSummary.selection === "settled", "the explicit check settles it");
	assert.equal((publisherSourceSummary(legacy) as { selection?: string }).selection, "settled");

	let business = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(organization, "r1") });
	let summary = publisherSourceSummary(business);
	assert.ok(summary.kind === "business" && summary.draft === null && summary.saved.name === "Harbour Bakery");
	business = run(business, { type: "edit", update: (draft) => ({ ...draft, name: "Harbour Bakery Amsterdam" }) });
	summary = publisherSourceSummary(business);
	assert.ok(summary.kind === "business" && summary.draft?.name === "Harbour Bakery Amsterdam" && summary.saved.name === "Harbour Bakery", "the summary follows the draft as a draft");
	assert.equal(legacyPublisherEditable(business), false);
	const behind = run(business, { type: "receive", view: view({ ...organization, name: "Changed elsewhere" }, "r2") });
	summary = publisherSourceSummary(behind);
	assert.ok(summary.kind === "business" && summary.draftBehind && summary.saved.name === "Changed elsewhere", "a kept draft is marked as based on an older version");
	const switchedOff = run(business, { type: "receive", view: view({ ...organization, active: false }, "r3") });
	assert.equal(publisherSourceSummary(switchedOff).kind, "legacy", "a kept draft never makes the identity look selected");
	assert.equal(publisherSourceSummary(run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(null, "r1", "corrupt") })).kind, "unknown");

	// One request, one focus move; Public name only when it can be edited.
	let focus = run(business, { type: "step", step: "contact" }, { type: "edit-publisher" });
	assert.equal(focus.step, "identity");
	assert.deepEqual(focus.focus, { request: 1, target: "public-name" });
	assert.equal(focus.draft?.name, "Harbour Bakery Amsterdam", "the draft is kept");
	assert.equal(run(focus, { type: "focus-handled", request: 2 }).focus?.request, 1, "another request's completion does not consume it");
	focus = run(focus, { type: "focus-handled", request: 1 });
	assert.equal(focus.focus, null);
	assert.equal(run(focus, { type: "edit-publisher" }).focus?.request, 1, "each ask is one new request");
	const readOnly = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: { ...view(organization, "r1"), writable: false } }, { type: "step", step: "contact" }, { type: "edit-publisher" });
	assert.deepEqual([readOnly.focus?.target, readOnly.step], ["status", "contact"], "without write access the status heading takes focus");
	assert.equal(run(business, { type: "start", pending: "save" }, { type: "edit-publisher" }).focus?.target, "status", "not while a write is pending");
	assert.equal(run(lostActivation, { type: "edit-publisher" }).focus?.target, "status", "not while an outcome is unsettled");
	assert.equal(run(legacy, { type: "edit-publisher" }).focus?.target, "status", "no identity editor for the legacy source");
}

// Profile navigation uses only a known editable owner and never changes the draft or creates a record.
{
	const business = run(INITIAL_IDENTITY_EDITOR,
		{ type: "receive", view: view(organization, "r1") },
		{ type: "edit", update: (draft) => ({ ...draft, name: "Unsaved business", sameAs: [...draft.sameAs, "https://review.example/harbour"] }) },
	);
	assert.equal(publisherProfileDestination(business), "business");
	const before = documentFromDraft(business.draft!);
	const requested = run(business, { type: "edit-publisher", target: "profiles" });
	assert.equal(requested.step, "social");
	assert.deepEqual(requested.focus, { request: 1, target: "profiles" });
	assert.deepEqual(documentFromDraft(requested.draft!), before);
	assert.equal(requested.base, business.base);
	assert.equal(requested.pending, null);
	const consumed = run(requested, { type: "focus-handled", request: 1 });
	assert.equal(consumed.focus, null);
	assert.equal(run(consumed, { type: "receive", view: view(organization, "r1") }).focus, null, "a later read never replays the request");
	const absent = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(null, null) });
	const inactive = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view({ ...organization, active: false }, "r1") });
	const personView = view(null, null);
	personView.legacy = { ...personView.legacy, publisherType: "person" };
	const person = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: personView });
	for (const fallback of [absent, person]) {
		assert.equal(publisherProfileDestination(fallback), "legacy");
		const refused = run(fallback, { type: "edit-publisher", target: "profiles" });
		assert.equal(refused.focus, null, "navigation does not start an absent identity draft");
		assert.equal(refused.draft, fallback.draft, "navigation never starts setup");
	}
	const inactiveProfiles = run(inactive, { type: "edit-publisher", target: "profiles" });
	assert.equal(inactiveProfiles.step, "social", "the saved inactive identity keeps its own profile editor");
	assert.equal(publisherProfileDestination(inactiveProfiles), "legacy", "focusing the inactive form does not change the selected publisher");
	assert.equal(inactiveProfiles.base?.record?.active, false);
	const setupProfiles = run(absent, { type: "setup" }, { type: "edit-publisher", target: "profiles" });
	assert.equal(setupProfiles.step, "social", "an explicitly started setup draft has the same Social owner");
	const failed = run(business, { type: "load-start" }, { type: "request-failed", intent: "load", failure: "unknown", message: "offline" });
	const corrupt = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(null, "r1", "corrupt") });
	const invalid = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(null, "r1", "invalid") });
	const unavailable = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(null, null, "read_unavailable") });
	const readOnly = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: { ...view(organization, "r1"), writable: false } });
	const saving = run(business, { type: "start", pending: "save" });
	const unconfirmed = run(saving, { type: "request-failed", intent: "save", failure: "unknown", message: "timeout" });
	for (const blocked of [INITIAL_IDENTITY_EDITOR, failed, corrupt, invalid, unavailable, readOnly, saving, unconfirmed, run(business, { type: "load-start" })]) {
		assert.equal(publisherProfileDestination(blocked), null);
		const refused = run(blocked, { type: "edit-publisher", target: "profiles" });
		assert.equal(refused.focus, null);
		assert.equal(refused.step, blocked.step);
		assert.equal(run(refused, { type: "receive", view: view(organization, "r2") }).focus, null, "unknown owners cannot queue a request for a later read");
	}
	assert.equal(run(requested, { type: "receive", view: view({ ...organization, active: false }, "r2") }).focus, null, "a changed owner cancels an unconsumed request");
	assert.equal(run(requested, { type: "request-failed", intent: "load", failure: "unknown", message: "offline" }).focus, null, "a failed refresh cancels an unconsumed request");
}

assert.deepEqual(IDENTITY_STEPS, ["identity", "contact", "social", "address", "location", "review"]);
assert.equal(IDENTITY_STEP_LABELS.social, "Social");
assert.equal(stepForField("sameAs.0"), "social");
assert.equal(stepForField("contactPoints.0.telephone"), "contact");

// A first cross-family selection is a local draft until the reviewed existing save runs.
{
	const absent = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(null, null) }, { type: "setup" });
	const chosen = selectIdentityKind(absent, "Person");
	assert.equal(chosen.draft?.kind, "Person");
	assert.equal(chosen.base?.record, null);
	assert.equal(chosen.pending, null);
	assert.equal(chosen.confirming, null, "radio selection itself does not save or confirm");
	const document = documentFromDraft(chosen.draft!);
	assert.equal(intendedIdentityRecord(chosen, { action: "save", document }), null, "a cross-family save needs its captured confirmation");
	const review = identityAdoptionReview(chosen, document)!;
	assert.equal(review.entityId, `${ORIGIN}/#person`);
	assert.deepEqual(review.publisherChange, { confirmed: true, fromEntityId: organization.entityId, fromType: "organization" });
	assert.deepEqual(review.document, document);
	const cancelled = run(chosen, { type: "confirm-open", confirmation: review }, { type: "confirm-close" });
	assert.equal(cancelled.draft, chosen.draft);
	assert.equal(cancelled.base, absent.base);
	const intended = intendedIdentityRecord(chosen, { action: "save", document, publisherChange: review.publisherChange })!;
	assert.equal(intended.entityId, review.entityId);
	assert.equal(intended.organizationReferenceAliases, undefined, "an explicit new entity does not inherit old reference aliases");
	assert.equal(validateBusinessIdentityRecord(intended).success, true);
	const newerSite = view(null, null); newerSite.siteUrl = "https://changed.example/"; newerSite.legacy.entityId = "https://changed.example/#organization";
	const duringReview = run(chosen, { type: "confirm-open", confirmation: review }, { type: "receive", view: newerSite });
	assert.equal(duringReview.confirming, review, "a newer read cannot rewrite the review the owner sees");
	assert.equal(intendedIdentityRecord(duringReview, { action: "save", document, publisherChange: review.publisherChange })?.entityId, review.entityId, "timeout recovery describes the captured requested ID, not a newer site origin");
	const unknown = run(chosen, { type: "start", pending: "save" }, { type: "request-failed", intent: "save", failure: "unknown", message: "timeout", intended });
	assert.equal(identityLocked(unknown), true);
	assert.equal(unknown.draft, chosen.draft);
	assert.equal(unknown.notice?.kind === "unconfirmed" && unknown.notice.intended?.entityId, review.entityId);
	assert.equal(identityAdoptionReview(run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(null, "bad", "invalid") }, { type: "setup" }), document), null, "invalid replacement is not absent adoption");
	assert.equal(identityAdoptionReview(run(chosen, { type: "start", pending: "save" }), document), null);
}

// Existing records review an ID transition; dirty and hidden form values survive its result and recovery.
{
	const person: BusinessIdentityRecord = { version: 1, updatedAt: organization.updatedAt, active: true, entityId: `${ORIGIN}/#person`, kind: "Person", name: organization.name, contactPoints: [], sameAs: organization.sameAs, areaServed: [], target: { kind: "home" } };
	const loaded = view(organization, "r1");
	loaded.transitions = [{ to: "person", entityId: person.entityId, dropped: ["legalName"], usage: [{ id: "custom", name: "Reference", scope: "global", defines: [], references: [organization.entityId] }], usageComplete: true }];
	const dirty = run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: loaded }, { type: "edit", update: draft => ({ ...draft, name: "Unsaved name", legalName: "Kept B.V." }) });
	const review = selectIdentityKind(dirty, "Person");
	assert.equal(review.draft, dirty.draft, "opening review does not replace dirty edits");
	assert.equal(review.confirming?.action, "transition");
	assert.equal(review.confirming?.action === "transition" && review.confirming.requestedKind, "Person");
	assert.equal(review.confirming?.action === "transition" && review.confirming.expectedRevision, "r1");
	assert.equal(run(review, { type: "confirm-close" }).draft, dirty.draft);
	const pending = run(review, { type: "start", pending: "transition", transitionKind: "Person" });
	const result = run(pending, { type: "write-result", intent: "transition", intended: person, result: { success: true, record: person, revision: "r2" } });
	assert.equal(result.base?.record?.name, organization.name, "the transition changes saved facts, not unsaved form edits");
	assert.equal(result.draft?.name, "Unsaved name");
	assert.equal(result.draft?.legalName, "Kept B.V.");
	assert.equal(result.draft?.kind, "Person");
	assert.equal("legalName" in documentFromDraft(result.draft!), false, "inapplicable values stay hidden in the draft, outside the Person document");
	assert.equal(identityDirty(result), true);
	const unknown = run(pending, { type: "request-failed", intent: "transition", failure: "unknown", message: "timeout", intended: person });
	assert.equal(identityLocked(unknown), true);
	const checked = run(unknown, { type: "start", pending: "check" }, { type: "check-result", check: "matches_requested", view: view(person, "r2") });
	assert.equal(checked.draft?.name, "Unsaved name");
	assert.equal(checked.draft?.legalName, "Kept B.V.");
	assert.equal(checked.draft?.kind, "Person");
	assert.equal(identityLocked(checked), false);
	const personView = view(person, "p1");
	personView.transitions = [{ to: "organization", entityId: organization.entityId, dropped: [], usage: [], usageComplete: true }];
	const local = selectIdentityKind(run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: personView }), "LocalBusiness");
	assert.equal(local.confirming?.action === "transition" && local.confirming.to, "organization");
	const transitioned = run(local, { type: "start", pending: "transition", transitionKind: "LocalBusiness" }, { type: "write-result", intent: "transition", intended: organization, result: { success: true, record: organization, revision: "p2" } });
	assert.equal(transitioned.base?.record?.kind, "Organization");
	assert.equal(transitioned.draft?.kind, "LocalBusiness", "the requested local kind remains an unsaved draft after the ordinary entity transition");
	assert.equal(identityDirty(transitioned), true);
	assert.equal(transitioned.pending, null, "no second write starts automatically");
	const sameFamily = selectIdentityKind(run(INITIAL_IDENTITY_EDITOR, { type: "receive", view: view(organization, "r1") }), "LocalBusiness");
	assert.equal(sameFamily.confirming, null);
	assert.equal(sameFamily.base?.record?.entityId, organization.entityId);
	for (const blocked of [run(dirty, { type: "start", pending: "save" }), unknown, { ...dirty, reading: true }, { ...dirty, latest: { ...loaded, writable: false } }]) {
		assert.equal(selectIdentityKind(blocked, "Person"), blocked, "pending, uncertain and unreadable owners cannot start an entity change");
	}
}

// An entity ID breaks after a slash or before its fragment before it breaks inside a word.
assert.deepEqual(entityIdBreakParts("https://example.com/#organization"), ["https://", "example.com/", "#organization"]);
assert.deepEqual(entityIdBreakParts("https://example.com/practice/#localbusiness"), ["https://", "example.com/", "practice/", "#localbusiness"]);
assert.deepEqual(entityIdBreakParts("Set the site URL first"), ["Set the site URL first"]);
for (const value of ["https://example.com/#organization", "#org", "a/b//c#d#e", ""]) assert.equal(entityIdBreakParts(value).join(""), value);

console.log("business identity editor model selfcheck passed");
