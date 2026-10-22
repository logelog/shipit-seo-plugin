import assert from "node:assert/strict";

import {
	BUSINESS_IDENTITY_SCAN_MAX_DEPTH,
	ISO_3166_ALPHA2_CODES,
	businessIdentityFactsForKind,
	businessIdentityFullGraph,
	businessIdentityMinimalGraph,
	businessIdentityOwnedIds,
	businessIdentityReferenceIds,
	businessIdentityTargetMatches,
	businessIdentityTemplateContexts,
	customRecordOwnedDefinitions,
	legacyBusinessIdentityDraft,
	ownedIdDependsOnPage,
	resolveBusinessIdentityGraphs,
	scanOwnedDefinitions,
	validateBusinessIdentityFacts,
	validateBusinessIdentityRecord,
	type BusinessIdentityFacts,
	type BusinessIdentityRecord,
} from "./business-identity.ts";
import {
	buildSchemaPresetGraphs,
	resolveSchemaOrganizationReferences,
	type GlobalSeoSettings,
	type SchemaPresetValues,
} from "./lib.ts";

const ORIGIN = "https://shop.example";
const settings: GlobalSeoSettings = {
	siteName: "Harbour Bakery",
	siteUrl: `${ORIGIN}/`,
	publisherType: "organization",
	orgName: "Harbour Bakery",
	orgLogo: "",
	personName: "",
	sameAs: [],
	defaultOgImage: "",
	twitterHandle: "",
};

const closedWeek = {
	Monday: { state: "periods", periods: [{ opens: "09:07", closes: "17:30" }] },
	Tuesday: { state: "periods", periods: [{ opens: "09:00", closes: "12:00" }, { opens: "13:00", closes: "17:30" }] },
	Wednesday: { state: "open24" },
	Thursday: { state: "unknown" },
	Friday: { state: "periods", periods: [{ opens: "18:00", closes: "02:00" }] },
	Saturday: { state: "periods", periods: [{ opens: "02:00", closes: "04:00" }] },
	Sunday: { state: "closed" },
};

function restaurantFacts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		kind: "LocalBusiness",
		businessType: "Restaurant",
		name: "Harbour Bakery",
		legalName: "Harbour Bakery B.V.",
		telephone: "+31 20 123 4567",
		email: "hello@shop.example",
		logo: { url: "/_emdash/api/media/file/logo.png", width: 96, height: 96 },
		contactPoints: [{ contactType: "reservations", telephone: "+31 20 765 4321", availableLanguage: ["nl", "en"], areaServed: ["NL"] }],
		sameAs: ["https://social.example/harbour"],
		address: { streetAddress: "Kade 1", addressLocality: "Amsterdam", postalCode: "1011 AA", addressCountry: "NL" },
		areaServed: [{ kind: "City", name: "Amsterdam", countryCode: "NL" }],
		location: {
			geo: { latitude: "52.12000", longitude: "4.90000" },
			mapUrl: "https://maps.example/harbour",
			hours: { mode: "weekly", days: closedWeek },
		},
		priceRange: "$$",
		restaurant: { servesCuisine: ["Dutch"], menuUrl: "https://shop.example/menu", acceptsReservations: true },
		target: { kind: "content", collection: "pages", entryId: "about-id", locale: null, title: "About us" },
		...overrides,
	};
}

function valid(input: unknown): BusinessIdentityFacts {
	const result = validateBusinessIdentityFacts(input);
	if (!result.success) assert.fail(`expected valid facts: ${JSON.stringify(result.errors)}`);
	return result.value;
}

function errorsOf(input: unknown): Record<string, string> {
	const result = validateBusinessIdentityFacts(input);
	assert.equal(result.success, false, "expected invalid facts");
	return result.success ? {} : result.errors;
}

function record(facts: BusinessIdentityFacts, extra: Partial<BusinessIdentityRecord> = {}): BusinessIdentityRecord {
	return {
		...facts,
		version: 1,
		updatedAt: "2026-10-02T10:00:00.000Z",
		active: true,
		entityId: `${ORIGIN}/#${facts.kind === "Person" ? "person" : "organization"}`,
		...extra,
	};
}

// ---- Validation ----
assert.equal(ISO_3166_ALPHA2_CODES.length, 249, "the full assigned ISO 3166-1 alpha-2 list");
assert.equal(new Set(ISO_3166_ALPHA2_CODES).size, 249);
const restaurant = valid(restaurantFacts());
assert.equal(restaurant.location?.hours.mode, "weekly");
assert.equal(
	restaurant.location?.hours.mode === "weekly" && restaurant.location.hours.days.Monday.state === "periods"
		? restaurant.location.hours.days.Monday.periods[0].opens
		: "",
	"09:07",
	"times are stored exactly as entered",
);
assert.ok("address.addressCountry" in errorsOf(restaurantFacts({ address: { streetAddress: "Kade 1", addressLocality: "Amsterdam", addressCountry: "ZZ" } })), "ZZ is not a country");
assert.ok("areaServed.0.countryCode" in errorsOf(restaurantFacts({ areaServed: [{ kind: "Country", countryCode: "QQ" }] })));
assert.ok("contactPoints.0.areaServed.0" in errorsOf(restaurantFacts({ contactPoints: [{ contactType: "sales", email: "a@b.example", availableLanguage: [], areaServed: ["XK"] }] })), "XK is user-assigned, not ISO");
assert.ok("unknownKey" in errorsOf(restaurantFacts({ unknownKey: 1 })), "unknown keys are rejected");
assert.ok("description" in errorsOf(restaurantFacts({ description: null })), "null is not an absent value");
assert.ok("name" in errorsOf(restaurantFacts({ name: "x".repeat(121) })), "oversize is rejected, not truncated");
assert.ok("telephone" in errorsOf(restaurantFacts({ telephone: "020 123 4567" })), "a phone number needs a country code");
assert.ok("logo" in errorsOf({ kind: "Person", name: "Ada", logo: { url: "https://x.example/a.png" }, contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } }));
assert.ok("areaServed" in errorsOf({ kind: "Person", name: "Ada", contactPoints: [], sameAs: [], areaServed: "NL", target: { kind: "home" } }), "a non-array Person service area is rejected");
assert.ok("areaServed" in errorsOf({ kind: "Person", name: "Ada", contactPoints: [], sameAs: [], areaServed: [{ kind: "Country", countryCode: "NL" }], target: { kind: "home" } }));
assert.ok("location" in errorsOf(restaurantFacts({ kind: "Organization", businessType: undefined, restaurant: undefined, priceRange: undefined })), "only a local business has a location");

const withGeo = (latitude: unknown, longitude: unknown) =>
	restaurantFacts({ location: { geo: { latitude, longitude }, hours: { mode: "unpublished" } } });
for (const [latitude, longitude] of [["52.12000", "4.90000"], ["0", "0"], ["-0.00001", "4.9"], ["52.1", "4.9"]]) {
	assert.equal(validateBusinessIdentityFacts(withGeo(latitude, longitude)).success, true, `geo ${latitude},${longitude} is valid`);
}
assert.ok("location.geo.latitude" in errorsOf(withGeo("91", "4.9")));
assert.ok("location.geo.longitude" in errorsOf(withGeo("52.1", "181")));
assert.ok("location.geo.latitude" in errorsOf(withGeo("NaN", "4.9")));
assert.ok("location.geo.longitude" in errorsOf(withGeo("52.1", "")), "an unpaired coordinate is rejected");
assert.ok("location.geo.latitude" in errorsOf(withGeo(91, 181)), "numeric coordinates are rejected, not dropped");
assert.ok("location.geo.longitude" in errorsOf(withGeo(91, 181)));
assert.ok("location.hours" in errorsOf(restaurantFacts({ location: { geo: { latitude: "52.1", longitude: "4.9" } } })) ||
	"location.hours.mode" in errorsOf(restaurantFacts({ location: { geo: { latitude: "52.1", longitude: "4.9" } } })), "hours must be stated");

const withDays = (days: Record<string, unknown>) =>
	restaurantFacts({ location: { hours: { mode: "weekly", days: { ...closedWeek, ...days } } } });
assert.ok("location.hours.days.Saturday.state" in errorsOf(withDays({ Saturday: { state: "closed" } })), "a day after an overnight period cannot be closed");
assert.ok("location.hours.days.Saturday.state" in errorsOf(withDays({ Saturday: { state: "open24" } })));
assert.ok("location.hours.days.Saturday.periods.0.opens" in errorsOf(withDays({ Saturday: { state: "periods", periods: [{ opens: "01:00", closes: "04:00" }] } })));
assert.ok("location.hours.days.Monday.state" in errorsOf(withDays({ Sunday: { state: "periods", periods: [{ opens: "20:00", closes: "01:00" }] }, Monday: { state: "closed" } })), "Sunday wraps to Monday");
assert.ok("location.hours.days.Tuesday.periods.1.opens" in errorsOf(withDays({ Tuesday: { state: "periods", periods: [{ opens: "09:00", closes: "13:30" }, { opens: "13:00", closes: "17:30" }] } })), "overlapping periods are rejected");
assert.ok("location.hours.days.Monday.periods.0.closes" in errorsOf(withDays({ Monday: { state: "periods", periods: [{ opens: "09:00", closes: "09:00" }] } })));
assert.ok("location.hours.days.Monday.periods.0.opens" in errorsOf(withDays({ Monday: { state: "periods", periods: [{ opens: "9:00", closes: "17:00" }] } })), "HH:MM is required, never rounded");
const fourEveryDay = Object.fromEntries(
	["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => [day, {
		state: "periods",
		periods: [{ opens: "01:00", closes: "02:00" }, { opens: "03:00", closes: "04:00" }, { opens: "05:00", closes: "06:00" }, { opens: "07:00", closes: "08:00" }],
	}]),
);
assert.equal(validateBusinessIdentityFacts(withDays(fourEveryDay)).success, true, "28 weekly periods fit");
assert.ok("location.hours.days.Monday.periods" in errorsOf(withDays({ Monday: { state: "periods", periods: Array.from({ length: 5 }, (_, i) => ({ opens: `0${i}:00`, closes: `0${i}:30` })) } })));
assert.ok("_form" in errorsOf(restaurantFacts({ description: "x".repeat(500), sameAs: Array.from({ length: 10 }, (_, i) => `https://social.example/${"p".repeat(1500)}${i}`) })), "the 16 KiB cap is enforced");

for (const url of ["https:social.example/acme", "https://social.example/ac\tme", "https:\\\\social.example\\acme", "https:///social.example"]) {
	assert.ok("sameAs.0" in errorsOf(restaurantFacts({ sameAs: [url] })), `${JSON.stringify(url)} is not an https URL as written`);
}
assert.ok("sameAs.1" in errorsOf(restaurantFacts({ sameAs: ["https://social.example", "https://social.example/"] })), "two spellings of one profile count once");
assert.ok("location.mapUrl" in errorsOf(restaurantFacts({ location: { mapUrl: "https:maps.example", hours: { mode: "unpublished" } } })));
for (const url of ["/_emdash/api/media/file/../../../admin/settings", "/_emdash/api/media/file/", "/_emdash/api/media/file/a b.png", "/_emdash/api/media/file/%2e%2e/x"]) {
	assert.ok("logo.url" in errorsOf(restaurantFacts({ logo: { url } })), `${url} is not a media library path`);
}
for (const title of [null, 42, undefined]) {
	assert.ok("target" in errorsOf(restaurantFacts({ target: { kind: "content", collection: "pages", entryId: "about-id", locale: null, ...(title === undefined ? {} : { title }) } })), `target title ${String(title)} is rejected`);
}
assert.ok("location.geo.latitude" in errorsOf(withGeo("90.0000000000000001", "4.9")), "just past the limit is not rounded into range");
assert.equal(validateBusinessIdentityFacts(withGeo("52.1234567890123456789", "4.9")).success, true, "more decimals than a double keeps are accepted as text");
assert.equal(validateBusinessIdentityFacts(withGeo("-90", "180.000")).success, true, "the limits themselves are valid");

// ---- Stored records ----
const stored = record(restaurant);
assert.equal(validateBusinessIdentityRecord(stored).success, true);
assert.equal(validateBusinessIdentityRecord(JSON.parse(JSON.stringify(stored))).success, true, "a JSON round trip stays valid");
assert.equal(validateBusinessIdentityRecord(null).success, false, "a stored JSON null is invalid");
assert.equal(validateBusinessIdentityRecord({ ...stored, name: " Harbour Bakery " }).success, false, "an untrimmed stored value is invalid");
assert.equal(validateBusinessIdentityRecord({ ...stored, description: null }).success, false, "a stored null is invalid");
assert.equal(
	validateBusinessIdentityRecord({ ...stored, location: { ...stored.location, geo: { latitude: 52.12, longitude: 4.9 } } }).success,
	false,
	"stored numeric coordinates are invalid",
);
assert.equal(validateBusinessIdentityRecord({ ...stored, entityId: `${ORIGIN}/#person` }).success, false, "the ID family must match the kind");
assert.equal(validateBusinessIdentityRecord({ ...stored, entityId: `${ORIGIN}/about#organization` }).success, false, "the ID path is the root");
assert.equal(validateBusinessIdentityRecord({ ...stored, organizationReferenceAliases: true }).success, false, "only a Person keeps Organization aliases");
for (const updatedAt of ["1", "October 3", "2026-10-02T10:00:00Z", "2026-10-02 10:00:00.000Z"]) {
	assert.equal(validateBusinessIdentityRecord({ ...stored, updatedAt }).success, false, `updatedAt ${updatedAt} is not the written form`);
}

// ---- Output ----
const full = businessIdentityFullGraph(stored, settings.siteUrl);
assert.equal(full["@type"], "Restaurant");
assert.equal(full["@id"], `${ORIGIN}/#organization`);
assert.equal(full.logo, `${ORIGIN}/_emdash/api/media/file/logo.png`, "media paths become absolute");
assert.deepEqual(full.geo, { "@type": "GeoCoordinates", latitude: 52.12, longitude: 4.9 }, "coordinates are JSON numbers");
assert.equal(full.menu, "https://shop.example/menu");
assert.equal(full.hasMenu, "https://shop.example/menu", "a Restaurant gets the same pair as every food type");
assert.equal(full.acceptsReservations, true);
const hours = full.openingHoursSpecification as Array<Record<string, unknown>>;
const spec = (opens: string, closes: string) => hours.find((item) => item.opens === opens && item.closes === closes);
assert.deepEqual(spec("09:07:00", "17:30:00")?.dayOfWeek, ["Monday"]);
assert.deepEqual(spec("00:00:00", "23:59:00")?.dayOfWeek, ["Wednesday"], "open 24 hours");
assert.deepEqual(spec("00:00:00", "00:00:00")?.dayOfWeek, ["Sunday"], "closed all day");
assert.deepEqual(spec("18:00:00", "02:00:00")?.dayOfWeek, ["Friday"], "an overnight period is one specification");
assert.ok(!hours.some((item) => (item.dayOfWeek as string[]).includes("Thursday")), "unknown days are omitted");
const minimal = businessIdentityMinimalGraph(stored, settings.siteUrl);
assert.equal(minimal["@type"], "Organization", "other pages type a local business as its organization");
assert.deepEqual(Object.keys(minimal).sort(), ["@context", "@id", "@type", "logo", "name", "sameAs", "url"]);
const dentist = businessIdentityFullGraph(record(valid(restaurantFacts({ businessType: "Dentist", restaurant: undefined }))), settings.siteUrl);
assert.equal(dentist["@type"], "Dentist");
assert.ok(!("servesCuisine" in dentist) && !("menu" in dentist) && !("medicalSpecialty" in dentist));
const person = record(valid({ kind: "Person", name: "Ada Baker", telephone: "+31 6 1234 5678", contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } }));
assert.equal(businessIdentityFullGraph(person, settings.siteUrl)["@type"], "Person");
assert.equal(businessIdentityMinimalGraph(person, settings.siteUrl)["@type"], "Person", "a Person stays a Person on every page");
assert.ok(!("telephone" in businessIdentityMinimalGraph(person, settings.siteUrl)));

// ---- Target matching ----
const home = { kind: "home" } as const;
assert.equal(businessIdentityTargetMatches(home, { path: "/", url: `${ORIGIN}/` }), true);
assert.equal(businessIdentityTargetMatches(home, { path: "/?ref=x", url: `${ORIGIN}/?ref=x` }), true);
assert.equal(businessIdentityTargetMatches(home, { path: "/en/", url: `${ORIGIN}/en/` }), false, "a locale-prefixed homepage is not the home target");
assert.equal(businessIdentityTargetMatches(restaurant.target, { path: "/about", url: "", content: { collection: "pages", id: "about-id", slug: "about" } }), true);
assert.equal(businessIdentityTargetMatches(restaurant.target, { path: "/fr/about", url: "", content: { collection: "pages", id: "about-fr-id", slug: "about" } }), false, "another translation row does not match");

// ---- Owned definitions, @context and completeness ----
const owned = businessIdentityOwnedIds(stored.entityId);
assert.deepEqual(owned, [`${ORIGIN}/#organization`, `${ORIGIN}#organization`, `${ORIGIN}//#organization`]);
assert.deepEqual(businessIdentityReferenceIds({ entityId: `${ORIGIN}/#person`, organizationReferenceAliases: true }).slice(3), [
	`${ORIGIN}/#organization`, `${ORIGIN}#organization`, `${ORIGIN}//#organization`,
]);
const literalOwner = { "@context": "https://schema.org", "@type": "Organization", "@id": `${ORIGIN}#organization`, name: "Old name" };
assert.deepEqual(scanOwnedDefinitions(literalOwner, owned), { ids: [`${ORIGIN}#organization`], complete: true });
const employeeOwner = { "@type": "Organization", "@id": `${ORIGIN}/#organization`, employee: { "@type": "Person", name: "Jane" } };
const personIds = businessIdentityOwnedIds(`${ORIGIN}/#person`);
const nestedOwners = { "@context": "https://schema.org", "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "Harbour", founder: { "@type": "Person", "@id": `${ORIGIN}/#person`, name: "Jane" } };
assert.deepEqual(scanOwnedDefinitions(nestedOwners, [...owned, ...personIds]).ids, [`${ORIGIN}/#organization`, `${ORIGIN}/#person`], "a definition nested in another owned definition is found too");
assert.equal(ownedIdDependsOnPage({ "@type": "Organization", "@id": "{{canonical}}#organization", name: "x" }, owned, "Site", `${ORIGIN}/`).possible, true);
assert.equal(ownedIdDependsOnPage({ "@type": "WebPage", "@id": "{{canonical}}#webpage", name: "x" }, owned, "Site", `${ORIGIN}/`).possible, false, "an ID that can never be owned needs no page lookup");
assert.equal(ownedIdDependsOnPage({ "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "x" }, owned, "Site", `${ORIGIN}/`).possible, false, "site variables are resolved without a lookup");
const contextMapped = {
	"@context": ["https://schema.org", { org: { "@id": `${ORIGIN}/#organization`, "@type": "@id" }, owner: { "@id": `${ORIGIN}/#organization` } }],
	"@type": "WebPage",
	"@id": `${ORIGIN}/about#webpage`,
	name: "About",
};
assert.deepEqual(scanOwnedDefinitions(contextMapped, owned), { ids: [], complete: true }, "@context term mappings are not entities");
const scopedEmployee = {
	"@context": { employee: { "@id": "https://schema.org/employee", "@type": "@id" } },
	"@type": "Organization",
	"@id": `${ORIGIN}/#organization`,
	employee: "https://example.test/jane",
};
const scopedDefinition = resolveBusinessIdentityGraphs({
	identity: { state: "valid", record: record(valid(restaurantFacts())) },
	siteUrl: settings.siteUrl,
	page: { path: "/posts/x", url: `${ORIGIN}/posts/x`, content: { collection: "posts", id: "x", slug: "x" } },
	customs: [{ id: "ctx", graph: { "@context": "https://schema.org", "@graph": [scopedEmployee] } }],
});
assert.deepEqual(scopedDefinition.publisher, { kind: "none" }, "a custom definition under any context leaves the identity publisher off");
let deep: Record<string, unknown> = { "@type": "Thing", name: "leaf" };
for (let i = 0; i < BUSINESS_IDENTITY_SCAN_MAX_DEPTH + 2; i += 1) deep = { "@type": "Thing", about: deep };
assert.equal(scanOwnedDefinitions(deep, owned).complete, false, "an over-deep graph is reported as incomplete");

// ---- Page resolution ----
const aboutPage = { path: "/about", url: `${ORIGIN}/about`, content: { collection: "pages", id: "about-id", slug: "about" } };
const postPage = { path: "/posts/hello", url: `${ORIGIN}/posts/hello`, content: { collection: "posts", id: "post-id", slug: "hello" } };
const resolve = (identity: Parameters<typeof resolveBusinessIdentityGraphs>[0]["identity"], page = aboutPage, customs: Array<{ id: string; graph: unknown }> = []) =>
	resolveBusinessIdentityGraphs({ identity, siteUrl: settings.siteUrl, page, customs });
assert.equal(resolve({ state: "absent" }).publisher, undefined, "absent keeps the legacy path");
assert.equal(resolve({ state: "valid", record: { ...stored, active: false } }).publisher, undefined, "inactive keeps the legacy path");
assert.deepEqual(resolve({ state: "invalid" }).publisher, { kind: "none" }, "invalid fails closed");
assert.deepEqual(resolve({ state: "unavailable" }).publisher, { kind: "none" }, "unreadable fails closed");
const onTarget = resolve({ state: "valid", record: stored });
assert.equal(onTarget.fullDefinition, true);
assert.equal(onTarget.publisher?.kind === "identity" && onTarget.publisher.graph?.["@type"], "Restaurant");
const offTarget = resolve({ state: "valid", record: stored }, postPage);
assert.equal(offTarget.publisher?.kind === "identity" && offTarget.publisher.graph?.["@type"], "Organization");
assert.ok(offTarget.publisher?.kind === "identity" && !("telephone" in (offTarget.publisher.graph ?? {})), "no contact facts off the target");
const literalDefinition = { "@context": "https://schema.org", "@graph": [literalOwner, { "@type": "Course", "@id": `${ORIGIN}/c#course`, provider: { "@id": `${ORIGIN}#organization` } }] };
const literalCollision = resolve({ state: "valid", record: stored }, postPage, [{ id: "a", graph: literalDefinition }]);
assert.deepEqual(literalCollision.publisher, { kind: "none" }, "even a definition of owner facts only is kept and leaves the publisher off");
assert.deepEqual(literalCollision.conflicts, [{ customId: "a", ownedIds: [`${ORIGIN}#organization`], outcome: "publisher_omitted" }]);
assert.equal(literalCollision.fullDefinition, false);
const employeeGraph = { "@context": "https://schema.org", ...employeeOwner };
const omitted = resolve({ state: "valid", record: stored }, postPage, [{ id: "b", graph: employeeGraph }]);
assert.deepEqual(omitted.publisher, { kind: "none" }, "a custom definition leaves the identity publisher off that page");
assert.equal(omitted.conflicts[0].outcome, "publisher_omitted");
const deepOmitted = resolve({ state: "valid", record: stored }, postPage, [{ id: "d", graph: deep }]);
assert.deepEqual(deepOmitted.publisher, { kind: "none" }, "an incomplete scan leaves the identity publisher off");
assert.equal(deepOmitted.conflicts[0].outcome, "incomplete");
const aliasRecord = { ...stored, entityId: `${ORIGIN}/#person`, kind: "Person" as const, organizationReferenceAliases: true as const };
assert.deepEqual(
	resolve({ state: "valid", record: aliasRecord }, postPage, [{ id: "alias", graph: { "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "Old" } }]).publisher,
	{ kind: "none" },
	"a definition of an alias the identity answers to also leaves it off",
);
const eventReference = { "@context": "https://schema.org", "@type": "Event", "@id": `${ORIGIN}/e#event`, name: "Tasting", organizer: { "@id": `${ORIGIN}#organization` } };
const definingAndReferencing = resolve({ state: "valid", record: stored }, postPage, [{ id: "b", graph: employeeGraph }, { id: "c", graph: eventReference }]);
assert.deepEqual(
	resolveSchemaOrganizationReferences(eventReference, settings, false, definingAndReferencing.publisher),
	eventReference,
	"on a collision page an authored reference stays exactly as written",
);
const presetOff = resolve({ state: "valid", record: stored }, postPage, [{ id: "b", graph: employeeGraph }]);
assert.deepEqual(presetOff.publisher, { kind: "none" }, "the check does not depend on the Site publisher preset, because inline facts would still be added");
const noCollision = buildSchemaPresetGraphs({ page: { ...postPage, kind: "content", pageType: "article", title: "x", pageTitle: "x", locale: null } as any, settings, presets: { organization: false, website: true } as any, publisher: omitted.publisher });
assert.ok(!noCollision.some((item) => "publisher" in item.graph), "with the publisher off no preset carries publisher facts, inline or linked");

// ---- Preset graphs and references ----
const allPresets = Object.fromEntries(
	["organization", "website", "webPage", "blogPosting", "service", "breadcrumbList", "person", "faqPage", "localBusiness", "product", "event", "videoObject"].map((key) => [key, true]),
) as unknown as SchemaPresetValues;
const servicePage = { ...postPage, kind: "content", pageType: "article", title: "Repairs", pageTitle: "Repairs", content: { collection: "services", id: "svc", slug: "repairs" }, path: "/services/repairs", url: `${ORIGIN}/services/repairs`, locale: null } as any;
const serviceRoles = { services: "service" } as any;
const none = buildSchemaPresetGraphs({ page: servicePage, settings, presets: allPresets, contentTypeRoles: serviceRoles, publisher: { kind: "none" } });
assert.ok(!none.some((item) => item.key === "organization"), "fail closed emits no publisher");
const noneService = none.find((item) => item.key === "service")?.graph ?? {};
assert.ok(!("provider" in noneService), "fail closed omits the service provider");
const identityService = buildSchemaPresetGraphs({ page: servicePage, settings, presets: allPresets, contentTypeRoles: serviceRoles, publisher: offTarget.publisher });
assert.deepEqual(identityService.find((item) => item.key === "service")?.graph.provider, { "@id": `${ORIGIN}/#organization` });
const entryDisabled = buildSchemaPresetGraphs({ page: servicePage, settings, presets: allPresets, contentTypeRoles: serviceRoles, publisher: offTarget.publisher, disabledPresets: ["organization"] });
const inlineProvider = entryDisabled.find((item) => item.key === "service")?.graph.provider as Record<string, unknown>;
assert.equal(inlineProvider["@type"], "Organization");
assert.ok(!("@id" in inlineProvider) && !("telephone" in inlineProvider) && !("address" in inlineProvider), "inline links use the minimal shape");
const identityPublisher = offTarget.publisher!;
assert.deepEqual(
	resolveSchemaOrganizationReferences({ provider: { "@id": `${ORIGIN}#organization` } }, settings, true, identityPublisher),
	{ provider: { "@id": `${ORIGIN}/#organization` } },
);
const expanded = resolveSchemaOrganizationReferences({ provider: { "@id": `${ORIGIN}/#organization` } }, settings, false, identityPublisher).provider as Record<string, unknown>;
assert.equal(expanded.name, "Harbour Bakery");
assert.ok(!("telephone" in expanded) && !("openingHoursSpecification" in expanded), "expansion uses the minimal shape");
const suppressedContext = resolveSchemaOrganizationReferences(contextMapped, settings, false, identityPublisher);
assert.deepEqual(suppressedContext["@context"], contextMapped["@context"], "@context mappings stay verbatim while the publisher is suppressed");
assert.deepEqual(resolveSchemaOrganizationReferences({ provider: { "@id": `${ORIGIN}/#organization` } }, settings, false, { kind: "none" }), {
	provider: { "@id": `${ORIGIN}/#organization` },
}, "fail closed leaves references bare");

// ---- Template contexts for the blocking check ----
const custom = (json: unknown, scope = "global", target: any = null) => ({ id: "x", name: "x", scope, json: JSON.stringify(json), enabled: true, target });
const contextsFor = (item: ReturnType<typeof custom>, targetEntry: any = null) =>
	businessIdentityTemplateContexts({ record: item, siteName: settings.siteName, siteUrl: settings.siteUrl, target: targetEntry });
const siteUrlOwner = custom({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "x" });
assert.deepEqual(customRecordOwnedDefinitions(siteUrlOwner, owned, contextsFor(siteUrlOwner)).ids, [`${ORIGIN}//#organization`], "{{siteUrl}} with a trailing slash still resolves to an owned ID");
const canonicalGlobal = custom({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{canonical}}#organization", name: "x" });
assert.deepEqual(customRecordOwnedDefinitions(canonicalGlobal, owned, contextsFor(canonicalGlobal)).ids, [`${ORIGIN}/#organization`], "a site-wide record resolves on the homepage");
const canonicalPosts = custom({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{canonical}}#organization", name: "x" }, "posts");
assert.deepEqual(customRecordOwnedDefinitions(canonicalPosts, owned, contextsFor(canonicalPosts)).ids, [], "a per-post entity is a different entity");
const otherBusiness = custom({ "@context": "https://schema.org", "@type": "LocalBusiness", "@id": `${ORIGIN}/#local-business`, name: "Harbour Bakery" });
assert.deepEqual(customRecordOwnedDefinitions(otherBusiness, owned, contextsFor(otherBusiness)).ids, [], "other businesses are never owned");
assert.equal(customRecordOwnedDefinitions(custom(deep), owned, contextsFor(custom(deep))).complete, false);
assert.equal(ownedIdDependsOnPage({ "@type": "Thing", "@id": "{{siteUrl}}/#{{slug}}", name: "x" }, owned, "Site", `${ORIGIN}/`).fragmentFromPage, true, "a slug can supply the fragment");
assert.equal(ownedIdDependsOnPage({ "@type": "WebPage", "@id": "{{canonical}}", name: "x" }, owned, "Site", `${ORIGIN}/`).fragmentFromPage, false, "a page URL supplies only the address");

// ---- Catalogue types ----
for (const businessType of ["LocalBusiness", "Store", "Restaurant", "Dentist"]) {
	const facts = valid(restaurantFacts({ businessType, ...(businessType === "Restaurant" ? {} : { restaurant: undefined }) }));
	assert.equal(validateBusinessIdentityRecord(record(facts)).success, true, `a stored ${businessType} record stays valid`);
}
for (const [businessType, message] of [
	["Bakeryy", /not a business type this version supports/],
	["Attorney", /Deprecated by Schema.org/],
	["ProfessionalService", /Deprecated by Schema.org/],
	["Dermatology", /not a business type this version supports/],
	["", /Choose a business type/],
] as const) {
	assert.match(errorsOf(restaurantFacts({ businessType, restaurant: undefined })).businessType ?? "", message, `${businessType || "an empty type"} is refused`);
}
const storedUnknown = { ...record(valid(restaurantFacts({ restaurant: undefined }))), businessType: "Bakeryy" };
assert.equal(validateBusinessIdentityRecord(storedUnknown).success, false, "a stored type outside the catalogue makes the record invalid, never another type");
const hairSalon = record(valid(restaurantFacts({ businessType: "HairSalon", restaurant: undefined })));
const hairSalonRead = validateBusinessIdentityRecord(JSON.parse(JSON.stringify(hairSalon)));
assert.ok(hairSalonRead.success && hairSalonRead.value.businessType === "HairSalon", "a new subtype reads back unchanged");
assert.deepEqual(hairSalonRead.success ? hairSalonRead.value : null, hairSalon);
const salonFull = businessIdentityFullGraph(hairSalon, settings.siteUrl);
assert.equal(salonFull["@type"], "HairSalon", "the selected page carries the one most-specific type");
assert.equal(salonFull["@id"], `${ORIGIN}/#organization`, "the type does not change the entity ID");
assert.ok(!("additionalType" in salonFull) && !("servesCuisine" in salonFull) && !("menu" in salonFull) && !("hasMenu" in salonFull));
assert.equal(salonFull.telephone, "+31 20 123 4567");
let typedNodes = 0;
const countTyped = (value: unknown) => {
	if (Array.isArray(value)) value.forEach(countTyped);
	else if (value && typeof value === "object") {
		const node = value as Record<string, unknown>;
		if (["HairSalon", "HealthAndBeautyBusiness", "LocalBusiness", "Organization", "Place"].includes(node["@type"] as string)) typedNodes++;
		for (const [key, child] of Object.entries(node)) if (key !== "@context") countTyped(child);
	}
};
countTyped(salonFull);
assert.equal(typedNodes, 1, "inheritance adds no parent entity");
const salonMinimal = businessIdentityMinimalGraph(hairSalon, settings.siteUrl);
assert.equal(salonMinimal["@type"], "Organization", "other pages name the same ID as an Organization");
assert.equal(salonMinimal["@id"], salonFull["@id"]);
assert.ok(!("telephone" in salonMinimal) && !("address" in salonMinimal));
assert.match(
	errorsOf(restaurantFacts({ businessType: "HairSalon" })).restaurant ?? "",
	/Only a food establishment/,
	"food details are refused outside the FoodEstablishment family",
);
const bakery = record(valid(restaurantFacts({ businessType: "Bakery" })));
const bakeryFull = businessIdentityFullGraph(bakery, settings.siteUrl);
assert.equal(bakeryFull["@type"], "Bakery");
assert.deepEqual(bakeryFull.servesCuisine, ["Dutch"], "food fields apply to every FoodEstablishment descendant");
assert.equal(bakeryFull.hasMenu, "https://shop.example/menu", "the current Schema.org property carries the menu");
assert.equal(bakeryFull.menu, "https://shop.example/menu", "the superseded name Google documents stays as an alias");
assert.equal(bakeryFull.acceptsReservations, true);
assert.equal(valid(restaurantFacts({ businessType: "FoodEstablishment" })).restaurant?.servesCuisine[0], "Dutch");
const noMenu = businessIdentityFullGraph(record(valid(restaurantFacts({ businessType: "Bakery", restaurant: { servesCuisine: ["Dutch"] } }))), settings.siteUrl);
assert.ok(!("menu" in noMenu) && !("hasMenu" in noMenu), "no menu property without a menu link");
const optician = businessIdentityFullGraph(record(valid(restaurantFacts({ businessType: "Optician", restaurant: undefined }))), settings.siteUrl);
assert.equal(optician["@type"], "Optician");
assert.ok(!("medicalSpecialty" in optician), "catalogue membership adds no specialised fields");
const bakeryAsOrganization = businessIdentityFactsForKind(bakery, "Organization");
assert.ok(bakeryAsOrganization.dropped.includes("restaurant") && bakeryAsOrganization.dropped.includes("businessType"));

// ---- Kind conversion ----
const asPerson = businessIdentityFactsForKind(restaurant, "Person");
assert.deepEqual(asPerson.dropped.sort(), ["address", "areaServed", "businessType", "contactPoints.areaServed", "legalName", "location", "logo", "priceRange", "restaurant"]);
assert.equal(validateBusinessIdentityFacts(asPerson.facts).success, true, "a Restaurant converted to a Person validates");

// ---- Legacy draft ----
const draft = legacyBusinessIdentityDraft({
	siteName: "Harbour Bakery",
	siteUrl: `${ORIGIN}/`,
	publisherType: "organization",
	organizationName: "x".repeat(130),
	organizationLogo: "",
	personName: "",
	socialProfiles: ["http://insecure.example/profile"],
	personProfiles: [],
});
assert.ok("name" in draft.issues && "sameAs.0" in draft.issues, "out-of-bound legacy values stay in the draft with field errors");
assert.equal((draft.draft.name as string).length, 130);

console.log("business identity engine selfcheck passed");
