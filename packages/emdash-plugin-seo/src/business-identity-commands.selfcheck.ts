import assert from "node:assert/strict";

import { resolveBusinessIdentityGraphs, type BusinessIdentityCustomRecord, type BusinessIdentityLegacySettings } from "./business-identity.ts";
import {
	buildBusinessIdentityView,
	businessIdentityStoreFor,
	inspectBusinessIdentity,
	listBusinessIdentityPages,
	previewBusinessIdentity,
	readBusinessIdentityRenderState,
	saveBusinessIdentity,
	setBusinessIdentityActive,
	transitionBusinessIdentityEntity,
	type BusinessIdentityHost,
	type BusinessIdentityPublisherChange,
	type BusinessIdentityStore,
	type BusinessIdentityTargetResolution,
} from "./business-identity-commands.ts";

const ORIGIN = "https://shop.example";

interface Row {
	value: unknown;
	revision: string;
}

class MemoryStore implements BusinessIdentityStore {
	row: Row | null = null;
	counter = 0;
	reads = 0;
	writes = 0;
	/** Called inside the next write: "commit-throw" stores then throws, "throw" throws without storing, "refuse" refuses. */
	next: "commit-throw" | "throw" | "refuse" | null = null;
	readFailure: Error | null = null;
	readFailures = 0;

	async getVersioned() {
		this.reads += 1;
		if (this.readFailure && this.readFailures > 0) {
			this.readFailures -= 1;
			throw this.readFailure;
		}
		return this.row ? { value: structuredClone(this.row.value), revision: this.row.revision } : null;
	}

	async compareAndSet(expected: string | null, value: unknown) {
		this.writes += 1;
		const mode = this.next;
		this.next = null;
		if (mode === "throw") throw new Error("network");
		if (mode === "refuse") return { applied: false as const };
		if ((this.row?.revision ?? null) !== expected) return { applied: false as const };
		this.counter += 1;
		this.row = { value: structuredClone(value), revision: `rev-${this.counter}` };
		if (mode === "commit-throw") throw new Error("lost response");
		return { applied: true as const, revision: this.row.revision };
	}

	/** A write from elsewhere: another tab, another editor or a direct database change. */
	external(value: unknown) {
		this.counter += 1;
		this.row = { value: structuredClone(value), revision: `ext-${this.counter}` };
	}
}

function makeHost(overrides: Partial<BusinessIdentityHost> & { settings?: Partial<BusinessIdentityLegacySettings> } = {}) {
	const store = new MemoryStore();
	const customs: BusinessIdentityCustomRecord[] = [];
	const settings: BusinessIdentityLegacySettings = {
		siteName: "Harbour Bakery",
		siteUrl: `${ORIGIN}/`,
		publisherType: "organization",
		organizationName: "Harbour Bakery",
		organizationLogo: "",
		personName: "",
		socialProfiles: [],
		personProfiles: [],
		...overrides.settings,
	};
	const targets = new Map<string, BusinessIdentityTargetResolution>([
		["home", { status: "ok", url: `${ORIGIN}/`, title: "Homepage", locale: null, slug: null, vars: {} }],
		["pages:about-id", { status: "ok", url: `${ORIGIN}/about`, title: "About", locale: null, slug: "about", vars: { canonical: `${ORIGIN}/about`, collection: "pages", slug: "about" } }],
		["pages:draft-id", { status: "unpublished" }],
	]);
	let customReadFails = false;
	const host: BusinessIdentityHost = {
		store,
		async readSettings() {
			return settings;
		},
		async readSwitches() {
			return { moduleEnabled: true, presetEnabled: true, localBusinessPreset: false };
		},
		async listCollections() {
			return { available: true, collections: [{ collection: "pages", label: "Pages" }] };
		},
		async listTargetCandidates(_collection, limit) {
			return {
				items: Array.from({ length: 30 }, (_, i) => ({ entryId: `p${i}`, title: `Page ${i}`, locale: null, slug: `p${i}`, url: `${ORIGIN}/p${i}` })).slice(0, limit),
				cursor: "next",
			};
		},
		async resolveTarget(target) {
			return targets.get(target.kind === "home" ? "home" : `${target.collection}:${target.entryId}`) ?? { status: "missing" };
		},
		async readAllCustomSchemas() {
			if (customReadFails) throw new Error("Repair or reduce custom schemas to 500 records");
			return customs.map((item) => ({ ...item }));
		},
		now: () => "2026-10-02T12:00:00.000Z",
		...overrides,
	};
	return {
		host,
		store,
		customs,
		settings,
		failCustomReads(value: boolean) {
			customReadFails = value;
		},
	};
}

const organization = {
	kind: "Organization",
	name: "Harbour Bakery",
	contactPoints: [],
	sameAs: ["https://social.example/harbour"],
	areaServed: [],
	target: { kind: "home" },
};
const person = {
	kind: "Person",
	name: "Ada",
	contactPoints: [],
	sameAs: [],
	areaServed: [],
	target: { kind: "home" },
};
const publisherChange: BusinessIdentityPublisherChange = {
	confirmed: true,
	fromEntityId: `${ORIGIN}/#organization`,
	fromType: "organization",
};
const restaurant = {
	kind: "LocalBusiness",
	businessType: "Restaurant",
	name: "Harbour Bakery",
	legalName: "Harbour Bakery B.V.",
	logo: { url: "/_emdash/api/media/file/logo.png", width: 200, height: 200 },
	telephone: "+31 20 123 4567",
	contactPoints: [{ contactType: "reservations", telephone: "+31 20 765 4321", availableLanguage: ["nl"], areaServed: ["NL"] }],
	sameAs: [],
	address: { streetAddress: "Kade 1", addressLocality: "Amsterdam", addressCountry: "NL" },
	areaServed: [{ kind: "Country", countryCode: "NL" }],
	location: { geo: { latitude: "52.37403", longitude: "4.88969" }, hours: { mode: "unpublished" } },
	priceRange: "$$",
	restaurant: { servesCuisine: ["Dutch"], acceptsReservations: true },
	target: { kind: "content", collection: "pages", entryId: "about-id", locale: null, title: "About" },
};
const ownedDefinition = (id = `${ORIGIN}/#organization`, enabled = true): BusinessIdentityCustomRecord => ({
	id: `custom-${id.slice(-6)}`,
	name: "Old organization",
	scope: "global",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": id, name: "Old" }),
	enabled,
});

// ---- Store adapter: plugin settings first, the KV alias otherwise ----
{
	const calls: string[] = [];
	const versioned = (label: string) => ({
		getVersioned: async (key: string) => {
			calls.push(`${label}:${key}`);
			return null;
		},
		compareAndSet: async () => ({ applied: true, revision: "r" }),
		compareAndDelete: async () => ({ applied: true }),
	});
	await businessIdentityStoreFor({ settings: versioned("settings"), kv: versioned("kv") })!.getVersioned();
	await businessIdentityStoreFor({ settings: { get: async () => null }, kv: versioned("kv") })!.getVersioned();
	assert.deepEqual(calls, ["settings:business-identity:v1", "kv:settings:business-identity:v1"]);
	assert.equal(businessIdentityStoreFor({ kv: { get: async () => null } }), null, "no versioned methods, no store");
	assert.deepEqual(await readBusinessIdentityRenderState(null), { state: "unavailable" }, "a missing versioned read fails closed, never absent");
	const nullRow = businessIdentityStoreFor({ settings: { ...versioned("s"), getVersioned: async () => ({ value: null, revision: "0" }) } });
	assert.deepEqual(await readBusinessIdentityRenderState(nullRow), { state: "invalid" }, "a stored JSON null is invalid, never absent");
}

// ---- Adoption ----
{
	const { host, store, customs, failCustomReads } = makeHost();
	assert.equal((await saveBusinessIdentity(host, { document: organization })).success, false, "a write without a revision is refused");
	assert.equal(store.writes, 0);
	const view = await buildBusinessIdentityView(host);
	assert.equal(view.state, "absent");
	assert.equal(view.legacy.entityId, `${ORIGIN}/#organization`);
	assert.equal(store.writes, 0, "opening the view never writes");

	customs.push(ownedDefinition(`${ORIGIN}#organization`), ownedDefinition(`${ORIGIN}/#person`), ownedDefinition(`${ORIGIN}/#organization`, false));
	const blocked = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.equal(blocked.success === false && blocked.error, "owned_id_defined");
	assert.deepEqual(blocked.success === false && blocked.definitions?.map((item) => item.ownedIds), [[`${ORIGIN}#organization`]], "only enabled definitions of owned IDs block");
	customs.length = 0;
	failCustomReads(true);
	const incomplete = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.equal(incomplete.success === false && incomplete.error, "collision_check_incomplete");
	failCustomReads(false);
	let deep: Record<string, unknown> = { "@type": "Thing" };
	for (let i = 0; i < 70; i += 1) deep = { "@type": "Thing", about: deep };
	customs.push({ id: "deep", name: "Deep", scope: "posts", json: JSON.stringify({ "@context": "https://schema.org", ...deep }), enabled: true });
	const deepResult = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.equal(deepResult.success === false && deepResult.error, "collision_check_incomplete", "an over-deep record fails closed");
	customs.length = 0;
	customs.push({ id: "other", name: "Branch", scope: "global", json: JSON.stringify({ "@context": "https://schema.org", "@type": "LocalBusiness", "@id": `${ORIGIN}/#branch`, name: "Harbour Bakery" }), enabled: true });

	assert.equal((await saveBusinessIdentity(host, { document: { ...organization, kind: "Person" }, expectedRevision: null })).success, false, "adoption keeps the legacy family");
	const unpublished = await saveBusinessIdentity(host, { document: { ...organization, target: { kind: "content", collection: "pages", entryId: "draft-id", locale: null, title: "Draft" } }, expectedRevision: null });
	assert.equal(unpublished.success === false && unpublished.errors.target !== undefined, true, "an unpublished page cannot be the target");

	const adopted = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.equal(adopted.success, true, "a different business is never blocked by type");
	assert.equal(adopted.success && adopted.record.entityId, `${ORIGIN}/#organization`, "adoption stores the existing publisher ID");
	assert.equal(adopted.success && adopted.record.active, true);
	const again = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.equal(again.success === false && again.error, "conflict", "a create against an existing record is a conflict");

	const withWarning = await buildBusinessIdentityView(host);
	assert.equal(withWarning.ownership?.status === "complete" && withWarning.ownership.sameBusiness[0]?.matched.join(), "name", "the same name is a warning only");
}

// ---- A reviewed first identity can replace the legacy publisher family ----
{
	const { host, store, customs, settings } = makeHost();
	const legacyBefore = structuredClone(settings);
	customs.push(
		{ id: "publisher-ref", name: "Publisher references", scope: "global", enabled: true, json: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", publisher: { "@id": ORIGIN + "/#organization" }, author: { "@id": ORIGIN + "/#person" } }) },
		{ ...ownedDefinition(), id: "old-definition" },
	);
	const customsBefore = structuredClone(customs);
	let customReads = 0;
	const readCustoms = host.readAllCustomSchemas;
	host.readAllCustomSchemas = async () => { customReads += 1; return readCustoms(); };
	const adopted = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(adopted.success, true);
	assert.equal(customReads, 1, "collision and reference checks share one bounded custom-schema read");
	assert.equal(store.writes, 1, "reviewed adoption makes one CAS create");
	assert.deepEqual(settings, legacyBefore, "adoption never edits legacy publisher settings");
	assert.deepEqual(customs, customsBefore, "old definitions and references are not rewritten");
	if (adopted.success) {
		assert.equal(adopted.record.kind, "Person");
		assert.equal(adopted.record.entityId, ORIGIN + "/#person");
		assert.equal(adopted.record.active, true);
		assert.equal(adopted.record.organizationReferenceAliases, undefined, "a reviewed new entity does not inherit the old family's references");
		assert.deepEqual(adopted.usage?.map((item) => [item.id, item.defines, item.references]), [
			["publisher-ref", [], [ORIGIN + "/#organization", ORIGIN + "/#person"]],
			["old-definition", [ORIGIN + "/#organization"], []],
		]);
		const identity = await readBusinessIdentityRenderState(host.store);
		const home = resolveBusinessIdentityGraphs({ identity, siteUrl: settings.siteUrl, page: { path: "/", url: ORIGIN + "/" }, customs: [{ id: "old-definition", graph: JSON.parse(customs[1]!.json) }] });
		assert.equal(home.fullDefinition, true);
		assert.equal(home.publisher?.kind, "identity");
		if (home.publisher?.kind === "identity") {
			assert.equal(home.publisher.graph?.["@type"], "Person");
			assert.equal(home.publisher.graph?.["@id"], ORIGIN + "/#person");
			assert.equal(home.publisher.referenceIds.includes(ORIGIN + "/#organization"), false);
		}
		const otherPage = resolveBusinessIdentityGraphs({ identity, siteUrl: settings.siteUrl, page: { path: "/about", url: ORIGIN + "/about" }, customs: [] });
		assert.equal(otherPage.fullDefinition, false);
		assert.equal(otherPage.publisher?.kind === "identity" && otherPage.publisher.graph?.["@type"], "Person");
	}
}

// ---- Reviewed adoption validates the old publisher and applies only to an absent, different family ----
{
	const { host, store, settings } = makeHost();
	for (const malformed of [null, {}, { ...publisherChange, confirmed: false }, { ...publisherChange, fromType: "LocalBusiness" }, { ...publisherChange, fromEntityId: "" }, { ...publisherChange, fromEntityId: "x".repeat(2049) }, { ...publisherChange, extra: true }]) {
		const result = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange: malformed });
		assert.equal(result.success === false && result.error, "invalid");
	}
	assert.equal((await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange, anotherOption: true })).success, false, "unknown save keys are refused");
	const sameFamily = await saveBusinessIdentity(host, { document: organization, expectedRevision: null, publisherChange });
	assert.equal(sameFamily.success === false && sameFamily.error, "invalid", "ordinary adoption does not use an entity-change confirmation");
	const wrongType = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange: { ...publisherChange, fromType: "person" } });
	assert.equal(wrongType.success === false && wrongType.error, "conflict", "the old type is checked independently of its ID");
	settings.siteUrl = "https://new.example/";
	const moved = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(moved.success === false && moved.error, "conflict", "a changed old publisher ID requires a new review");
	settings.siteUrl = ORIGIN + "/";
	settings.publisherType = "person";
	const changedType = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(changedType.success === false && changedType.error, "conflict", "a stale review is refused even when the selected family now matches settings");
	assert.equal(store.writes, 0);
	assert.equal(store.row, null);

	settings.publisherType = "organization";
	const saved = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.ok(saved.success);
	const before = structuredClone(store.row);
	const nonAbsent = await saveBusinessIdentity(host, { document: person, expectedRevision: saved.revision, publisherChange });
	assert.equal(nonAbsent.success === false && nonAbsent.error, "invalid", "a valid saved record still needs the explicit entity-transition command");
	assert.deepEqual(store.row, before);
	store.row = { value: { version: 1, active: false, entityId: ORIGIN + "/#person", name: 7 }, revision: "invalid-kept" };
	const invalidBefore = structuredClone(store.row);
	const invalid = await saveBusinessIdentity(host, { document: organization, expectedRevision: "invalid-kept", replaceInvalid: true, publisherChange });
	assert.equal(invalid.success === false && invalid.error, "invalid", "reviewed adoption cannot bypass invalid-record replacement rules");
	assert.deepEqual(store.row, invalidBefore);
}

// ---- First adoption checks selected target, collisions and complete bounded reference usage ----
{
	const { host, store, customs, failCustomReads } = makeHost();
	customs.push(ownedDefinition(ORIGIN + "/#person"));
	const collision = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(collision.success === false && collision.error, "owned_id_defined");
	customs.length = 0;
	failCustomReads(true);
	const unreadable = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(unreadable.success === false && unreadable.error, "collision_check_incomplete");
	host.readPublisherOwnership = async () => ({ state: "valid", revision: "manual", mode: "none" });
	const unreadableWithOutputOff = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(unreadableWithOutputOff.success === false && unreadableWithOutputOff.error, "collision_check_incomplete", "old/new reference checks remain required while automatic publisher output is off");
	delete host.readPublisherOwnership;
	failCustomReads(false);
	let deep: Record<string, unknown> = { "@id": ORIGIN + "/#organization" };
	for (let i = 0; i < 70; i += 1) deep = { about: deep };
	customs.push({ id: "deep-reference", name: "Deep reference", scope: "global", enabled: false, json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", ...deep }) });
	const incomplete = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(incomplete.success === false && incomplete.error, "collision_check_incomplete", "old/new reference inspection refuses an incomplete walk even for a disabled record");
	customs.length = 0;
	const unpublished = await saveBusinessIdentity(host, { document: { ...person, target: { kind: "content", collection: "pages", entryId: "draft-id", locale: null, title: "Draft" } }, expectedRevision: null, publisherChange });
	assert.equal(unpublished.success === false && !!unpublished.errors.target, true);
	assert.equal(store.writes, 0);
}

// ---- A first family change uses CAS-null and preserves unknown-result reconciliation ----
{
	const { host, store } = makeHost();
	const compare = store.compareAndSet.bind(store);
	store.compareAndSet = async (expected, value) => {
		assert.equal(expected, null);
		store.external({ ...(value as object), name: "Concurrent owner" });
		return compare(expected, value);
	};
	const raced = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(raced.success === false && raced.error, "conflict");
	assert.equal(store.writes, 1);
	assert.equal((store.row!.value as { name: string }).name, "Concurrent owner", "a concurrent create is never overwritten");
}
{
	const { host, store } = makeHost();
	store.next = "commit-throw";
	const lost = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(lost.success === false && lost.error, "unconfirmed");
	assert.equal(lost.success === false && lost.intended?.entityId, ORIGIN + "/#person", "a lost response carries the selected entity ID for recovery");
	assert.equal(lost.success === false && lost.intended?.organizationReferenceAliases, undefined);
	const check = await inspectBusinessIdentity(host, { check: { intended: lost.success === false ? lost.intended : null, loaded: null } });
	assert.equal(check.check, "matches_requested");
	assert.equal(store.writes, 1, "reconciliation never retries the create");
}
{
	const { host, store } = makeHost();
	store.next = "throw";
	const lost = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(lost.success === false && lost.error, "unconfirmed");
	const check = await inspectBusinessIdentity(host, { check: { intended: lost.success === false ? lost.intended : null, loaded: null } });
	assert.equal(check.check, "matches_loaded", "a failed create that left the row absent unlocks only after an explicit read");
	assert.equal(store.writes, 1);
}
{
	const { host, store } = makeHost();
	store.next = "refuse";
	const uncertain = await saveBusinessIdentity(host, { document: person, expectedRevision: null, publisherChange });
	assert.equal(uncertain.success === false && uncertain.error, "storage_uncertain");
	assert.equal(store.writes, 1);
	assert.equal(store.row, null);
}

// ---- A reviewed first organization or local business does not retain legacy Person aliases ----
for (const document of [organization, restaurant]) {
	const { host, store, settings } = makeHost({ settings: { publisherType: "person", personName: "Ada" } });
	const legacyBefore = structuredClone(settings);
	const adopted = await saveBusinessIdentity(host, { document, expectedRevision: null, publisherChange: { confirmed: true, fromEntityId: ORIGIN + "/#person", fromType: "person" } });
	assert.ok(adopted.success);
	assert.equal(adopted.record.kind, document.kind);
	assert.equal(adopted.record.entityId, ORIGIN + "/#organization");
	assert.equal(adopted.record.organizationReferenceAliases, undefined);
	assert.equal(store.writes, 1);
	assert.deepEqual(settings, legacyBefore);
	const view = await buildBusinessIdentityView(host);
	assert.equal(view.output?.full["@type"], document.kind === "LocalBusiness" ? "Restaurant" : "Organization");
	assert.equal(view.output?.minimal["@type"], "Organization");
}

// ---- Revisions, conflicts, unknown outcomes ----
{
	const { host, store, settings } = makeHost();
	store.row = { value: null, revision: "0" };
	assert.equal((await buildBusinessIdentityView(host)).state, "invalid", "a stored null with a revision is invalid");
	const refused = await saveBusinessIdentity(host, { document: organization, expectedRevision: "0" });
	assert.equal(refused.success === false && refused.error, "invalid_stored");
	const replaced = await saveBusinessIdentity(host, { document: organization, expectedRevision: "0", replaceInvalid: true });
	assert.equal(replaced.success, true, "revision 0 is a valid loaded revision");
	const loadedRevision = replaced.success ? replaced.revision : "";
	const loadedRecord = replaced.success ? replaced.record : null;

	assert.equal((await saveBusinessIdentity(host, { document: restaurant, expectedRevision: "stale" })).success === false, true);

	settings.siteUrl = "https://new.example/";
	const kept = await saveBusinessIdentity(host, { document: restaurant, expectedRevision: loadedRevision });
	assert.equal(kept.success && kept.record.entityId, `${ORIGIN}/#organization`, "a site URL change and a subtype change keep the stored ID");
	const restaurantRevision = kept.success ? kept.revision : "";
	const restaurantRecord = kept.success ? kept.record : null;
	assert.equal((await saveBusinessIdentity(host, { document: { ...organization, kind: "Person" }, expectedRevision: restaurantRevision })).success, false, "a family change needs the transition");

	store.next = "commit-throw";
	const lost = await saveBusinessIdentity(host, { document: { ...restaurant, priceRange: "$$$" }, expectedRevision: restaurantRevision });
	assert.equal(lost.success === false && lost.error, "unconfirmed");
	const intended = lost.success === false ? lost.intended : undefined;
	assert.equal(intended?.priceRange, "$$$", "the unconfirmed result carries the complete intended record");
	const requested = await inspectBusinessIdentity(host, { expectedRevision: restaurantRevision, check: { intended, loaded: restaurantRecord } });
	assert.equal(requested.check, "matches_requested");
	store.external({ ...(store.row!.value as object), name: "Harbour Bakery Two" });
	const changedElsewhere = await inspectBusinessIdentity(host, { expectedRevision: restaurantRevision, check: { intended, loaded: restaurantRecord } });
	assert.equal(changedElsewhere.check, "differs", "another field changed by another writer is never reported as our write");
	assert.equal(changedElsewhere.identity.record?.name, "Harbour Bakery Two", "the check returns the current values");

	store.external(restaurantRecord);
	const sameValuesNewRevision = await inspectBusinessIdentity(host, { check: { intended, loaded: restaurantRecord } });
	assert.equal(sameValuesNewRevision.check, "matches_loaded", "values equal to the loaded record match it whatever the revision");
	const currentRevision = store.row!.revision;
	const currentRecord = sameValuesNewRevision.identity.record;
	store.next = "throw";
	const notApplied = await saveBusinessIdentity(host, { document: { ...restaurant, priceRange: "$$$$" }, expectedRevision: currentRevision });
	assert.equal(notApplied.success === false && notApplied.error, "unconfirmed");
	const unchanged = await inspectBusinessIdentity(host, { expectedRevision: currentRevision, check: { intended: notApplied.success === false ? notApplied.intended : null, loaded: currentRecord } });
	assert.equal(unchanged.check, "matches_loaded", "values still equal to the loaded record match it");
	const writes = store.writes;
	await inspectBusinessIdentity(host, { expectedRevision: currentRevision, check: { intended: null, loaded: currentRecord } });
	assert.equal(store.writes, writes, "a check never writes");

	store.next = "refuse";
	const uncertain = await saveBusinessIdentity(host, { document: restaurant, expectedRevision: currentRevision });
	assert.equal(uncertain.success === false && uncertain.error, "storage_uncertain", "a refusal with the same revision is not called a conflict");
	assert.equal(store.writes, writes + 1, "and is not retried");
}

// ---- Exact entries for page-dependent IDs ----
{
	const entryVars = new Map<string, Record<string, string>>([
		["pages:home-id", { canonical: `${ORIGIN}/`, collection: "pages", slug: "welcome" }],
		["posts:post-1", { canonical: `${ORIGIN}/blog/post-1`, collection: "posts", slug: "post-1" }],
	]);
	let lookups = 0;
	const { host, customs } = makeHost({
		async resolveEntryVars(collection, identifier) {
			lookups += 1;
			if (collection === "secret") return { status: "none" };
			const vars = entryVars.get(`${collection}:${identifier}`);
			return vars ? { status: "ok", vars } : { status: "missing" };
		},
	});
	const canonicalOwner = (scope: string): BusinessIdentityCustomRecord => ({
		id: `c-${scope}`, name: scope, scope, enabled: true,
		json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{canonical}}#organization", name: "x" }),
	});
	customs.push(canonicalOwner("posts:post-1"), canonicalOwner("secret:x"));
	const clean = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.equal(clean.success, true, "an entry whose canonical is not the root defines a different entity");
	assert.equal(lookups, 2, "only page-dependent records with a possible owned ID are looked up");
	customs.push(canonicalOwner("pages:home-id"));
	const view = await buildBusinessIdentityView(host);
	assert.deepEqual(view.ownership?.status === "complete" && view.ownership.definitions.map((item) => item.scope), ["pages:home-id"], "an entry whose canonical is the root defines the identity's ID");
	customs.length = 0;
	customs.push(canonicalOwner("pages:welcome"));
	const bySlug = await buildBusinessIdentityView(host);
	assert.equal(bySlug.ownership?.status, "incomplete", "a scope naming a slug cannot be resolved without a scan");
	customs.length = 0;
	customs.push({ id: "slug-fragment", name: "Slug fragment", scope: "global", enabled: true, json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": "{{siteUrl}}/#{{slug}}", name: "x" }) });
	assert.equal((await buildBusinessIdentityView(host)).ownership?.status, "incomplete", "a fragment built from page values cannot be checked for every page");
	customs.length = 0;
	customs.push({ id: "page-id", name: "Page", scope: "global", enabled: true, json: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", "@id": "{{canonical}}", name: "x" }) });
	assert.equal((await buildBusinessIdentityView(host)).ownership?.status, "complete", "a page ID made of the page URL does not block");
	customs.length = 0;
	for (let i = 0; i < 26; i += 1) customs.push({ ...canonicalOwner(`posts:post-1`), id: `many-${i}` });
	const many = await buildBusinessIdentityView(host);
	assert.equal(many.ownership?.status, "incomplete", "more than 25 entry lookups make the check incomplete");
}

// ---- Replacing an invalid record keeps its usable ID and state ----
{
	const { host, store, settings } = makeHost();
	store.row = { value: { version: 1, updatedAt: "2026-01-01T00:00:00.000Z", active: false, entityId: "https://old.example/#person", organizationReferenceAliases: true, kind: "Person", name: 7 }, revision: "r-invalid" };
	const invalidView = await buildBusinessIdentityView(host);
	assert.equal(invalidView.state, "invalid");
	assert.deepEqual(invalidView.replacement, { entityId: "https://old.example/#person", family: "person", active: false, organizationReferenceAliases: true }, "the view says what a replacement keeps");
	const wrongFamily = await saveBusinessIdentity(host, { document: organization, expectedRevision: "r-invalid", replaceInvalid: true });
	assert.equal(wrongFamily.success === false && wrongFamily.errors.kind !== undefined, true, "the replacement keeps the stored entity family");
	const person = { kind: "Person", name: "Ada", contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } };
	const replaced = await saveBusinessIdentity(host, { document: person, expectedRevision: "r-invalid", replaceInvalid: true });
	assert.equal(replaced.success, true);
	if (replaced.success) {
		assert.equal(replaced.record.entityId, "https://old.example/#person", "the stored ID is kept although the site URL differs");
		assert.equal(replaced.record.active, false, "an inactive record stays inactive");
		assert.equal(replaced.record.organizationReferenceAliases, true);
		assert.equal(replaced.adoptedId, undefined);
	}
	store.row = { value: { version: 1, entityId: 12, active: true }, revision: "r-unusable" };
	const adopted = await saveBusinessIdentity(host, { document: organization, expectedRevision: "r-unusable", replaceInvalid: true });
	assert.equal(adopted.success && adopted.adoptedId, true, "an unusable stored ID is replaced by the current publisher ID and reported");
	assert.equal(adopted.success && adopted.record.entityId, `${settings.siteUrl.replace(/\/$/, "")}/#organization`);
}

// ---- Corrupt and unreadable rows ----
{
	const { host, store } = makeHost();
	store.row = { value: {}, revision: "r" };
	store.readFailure = new SyntaxError("Unexpected token } in JSON");
	store.readFailures = 2;
	const corrupt = await buildBusinessIdentityView(host);
	assert.equal(corrupt.state, "corrupt");
	assert.equal(corrupt.writable, false);
	store.readFailures = 2;
	const save = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.equal(save.success === false && save.error, "unavailable", "a corrupt row has no CAS-safe repair");
	store.readFailure = new Error("database is locked");
	store.readFailures = 1;
	assert.equal((await buildBusinessIdentityView(host)).state, "read_unavailable", "a transient failure is never called corrupt");
	const readOnly = makeHost({ store: null });
	const view = await buildBusinessIdentityView(readOnly.host);
	assert.equal(view.state, "read_unavailable");
	assert.equal(view.writable, false);
	assert.equal((await saveBusinessIdentity(readOnly.host, { document: organization, expectedRevision: null })).success === false, true);
}

// ---- Activation ----
{
	const { host, store, customs } = makeHost();
	const created = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	const revision = created.success ? created.revision : "";
	assert.equal((await setBusinessIdentityActive(host, { active: false, expectedRevision: revision })).success, false, "confirmation is required");
	const off = await setBusinessIdentityActive(host, { active: false, expectedRevision: revision, confirmed: true });
	assert.equal(off.success && off.record.active, false);
	assert.equal(off.success && off.record.name, "Harbour Bakery", "deactivation keeps the facts");
	customs.push(ownedDefinition());
	const on = await setBusinessIdentityActive(host, { active: true, expectedRevision: off.success ? off.revision : "", confirmed: true });
	assert.equal(on.success === false && on.error, "owned_id_defined", "activation reruns the ownership check");
	assert.equal((store.row!.value as { active: boolean }).active, false);
}

// ---- Catalogue subtypes through the commands ----
{
	const { host, store } = makeHost();
	const created = await saveBusinessIdentity(host, { document: restaurant, expectedRevision: null });
	assert.equal(created.success, true);
	const createdRevision = created.success ? created.revision : "";
	const salonWithFood = await saveBusinessIdentity(host, { document: { ...restaurant, businessType: "HairSalon" }, expectedRevision: createdRevision });
	assert.equal(salonWithFood.success === false && salonWithFood.error, "invalid", "food details are refused for a type outside the family");
	assert.match(salonWithFood.success === false ? salonWithFood.errors?.restaurant ?? "" : "", /Only a food establishment/);
	const { restaurant: _food, ...withoutFood } = restaurant;
	const salon = await saveBusinessIdentity(host, { document: { ...withoutFood, businessType: "HairSalon" }, expectedRevision: createdRevision });
	assert.equal(salon.success && salon.record.businessType, "HairSalon");
	assert.equal(salon.success && salon.record.entityId, `${ORIGIN}/#organization`, "a subtype change keeps the entity ID");
	assert.equal((store.row!.value as { businessType: string }).businessType, "HairSalon", "the stored row holds the chosen subtype");
	const stale = await saveBusinessIdentity(host, { document: { ...restaurant, businessType: "Bakery" }, expectedRevision: createdRevision });
	assert.equal(stale.success === false && stale.error, "conflict", "a subtype change still needs the current revision");
	const reloaded = await buildBusinessIdentityView(host);
	assert.equal(reloaded.state, "valid");
	assert.equal(reloaded.record?.businessType, "HairSalon", "the subtype reads back unchanged");
	assert.equal(reloaded.output?.full["@type"], "HairSalon");
	assert.equal(reloaded.output?.minimal["@type"], "Organization");
	const bakery = await saveBusinessIdentity(host, { document: { ...restaurant, businessType: "Bakery" }, expectedRevision: salon.success ? salon.revision : "" });
	assert.equal(bakery.success && bakery.record.businessType, "Bakery");
	const bakeryView = await buildBusinessIdentityView(host);
	assert.equal(bakeryView.output?.full["@type"], "Bakery");
	assert.deepEqual(bakeryView.output?.full.servesCuisine, ["Dutch"]);
	const unknown = await saveBusinessIdentity(host, { document: { ...restaurant, businessType: "Bakeryy" }, expectedRevision: bakery.success ? bakery.revision : "" });
	assert.equal(unknown.success === false && unknown.error, "invalid", "an unknown type is refused");
	assert.equal((store.row!.value as { businessType: string }).businessType, "Bakery", "a refused type leaves the stored record unchanged");
}

// ---- Entity transitions ----
{
	const { host, store, customs, settings } = makeHost();
	const created = await saveBusinessIdentity(host, { document: restaurant, expectedRevision: null });
	assert.equal(created.success, true);
	const off = await setBusinessIdentityActive(host, { active: false, expectedRevision: created.success ? created.revision : "", confirmed: true });
	const revision = off.success ? off.revision : "";
	customs.push(ownedDefinition(`${ORIGIN}/#person`));
	const blocked = await transitionBusinessIdentityEntity(host, { to: "person", expectedRevision: revision, confirmed: true });
	assert.equal(blocked.success === false && blocked.error, "owned_id_defined", "transitions check the new ID even while inactive");
	customs.length = 0;
	customs.push({ id: "ref", name: "Publisher link", scope: "global", enabled: true, json: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", "@id": "{{canonical}}#webpage", publisher: { "@id": "{{siteUrl}}#organization" } }) });
	const view = await buildBusinessIdentityView(host);
	const personOption = view.transitions.find((item) => item.to === "person");
	assert.ok(personOption?.dropped.includes("location") && personOption.dropped.includes("logo"), "the confirmation lists facts a person cannot carry");
	const person = await transitionBusinessIdentityEntity(host, { to: "person", expectedRevision: revision, confirmed: true });
	assert.equal(person.success, true, "a restaurant converts to a valid Person record");
	if (person.success) {
		assert.equal(person.record.entityId, `${ORIGIN}/#person`);
		assert.equal(person.record.kind, "Person");
		for (const key of ["legalName", "logo", "address", "location", "priceRange", "restaurant", "businessType"]) {
			assert.ok(!(key in person.record), `${key} is not kept on a Person`);
		}
		assert.equal(person.record.organizationReferenceAliases, undefined, "a replaced entity does not inherit Organization aliases");
		assert.deepEqual(person.usage?.map((item) => [item.id, item.references]), [["ref", [`${ORIGIN}/#organization`]]], "references to the old ID are reported, not rewritten");
		assert.ok(JSON.stringify(store.row!.value).includes(`"entityId":"${ORIGIN}/#person"`));
	}
	settings.siteUrl = "https://new.example/";
	const moved = await transitionBusinessIdentityEntity(host, { to: "origin", expectedRevision: person.success ? person.revision : "", confirmed: true });
	assert.equal(moved.success && moved.record.entityId, "https://new.example/#person", "the origin transition moves the ID");
}

// ---- No site URL ----
{
	const { host, store } = makeHost({ settings: { siteUrl: "" } });
	const refused = await saveBusinessIdentity(host, { document: organization, expectedRevision: null });
	assert.equal(refused.success === false && refused.error, "invalid", "without a site URL no ID can be formed");
	assert.equal(store.writes, 0);
	assert.equal((await buildBusinessIdentityView(host)).legacy.entityId, "");
}

// ---- Person adoption keeps legacy Organization references ----
{
	const { host } = makeHost({ settings: { publisherType: "person", personName: "Ada" } });
	const adopted = await saveBusinessIdentity(host, { document: { kind: "Person", name: "Ada", contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } }, expectedRevision: null });
	assert.equal(adopted.success && adopted.record.entityId, `${ORIGIN}/#person`);
	assert.equal(adopted.success && adopted.record.organizationReferenceAliases, true);
}

// ---- Preview and pages ----
{
	const { host, store } = makeHost();
	const preview = await previewBusinessIdentity(host, { document: restaurant });
	assert.equal(preview.success && preview.output?.full["@type"], "Restaurant");
	assert.equal(preview.success && preview.target.status, "ok");
	assert.equal(store.writes, 0, "preview never writes");
	assert.equal((await listBusinessIdentityPages(host, { collection: "pages", limit: 26 })).success, false);
	const pages = await listBusinessIdentityPages(host, { collection: "pages", limit: 25 });
	assert.equal(pages.success && pages.items.length, 25);
	assert.equal((await listBusinessIdentityPages(host, { collection: "secret_table", limit: 5 })).success, false, "only listed content types are paged");
}

console.log("business identity commands selfcheck passed");
