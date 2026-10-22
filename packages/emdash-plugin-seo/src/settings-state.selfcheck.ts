import assert from "node:assert/strict";

import { SEO_ADMIN_LEGACY_SETTINGS_GUARD_PATTERN } from "./admin-contract.ts";
import {
	INDEXING_LEGACY_SETTINGS_KEYS,
	LEGACY_SETTINGS_KEYS,
	classifySiteSettings,
	isReadableSiteSettings,
	legacySettingsGuard,
	withoutHistoricalSeedAmbiguity,
	type LegacySettingsEntries,
	type SiteSettingsSnapshot,
	type StoredSeoAdminSettings,
	type VersionedSettingsEntry,
} from "./settings-state.ts";

const site = { siteName: "Host Site", siteUrl: "https://host.example" };
const entry = (value: unknown, revision = "r1"): VersionedSettingsEntry => ({ value, revision });

const record = (overrides: Record<string, unknown> = {}) => ({
	version: 1,
	updatedAt: "2026-09-01T00:00:00.000Z",
	siteName: "Example",
	siteUrl: "https://example.com",
	publisherType: "organization",
	organizationName: "Example",
	organizationLogo: "",
	personName: "",
	socialProfiles: [],
	personProfiles: [],
	defaultSocialImage: "",
	twitterHandle: "",
	noindex: false,
	contentScoringEnabled: true,
	...overrides,
});

// The exact settings an early alpha stored on install, as found in real records.
const historicalSeed = {
	version: 1,
	updatedAt: "2026-08-01T00:00:00.000Z",
	siteName: "Shipit Digital",
	siteUrl: "",
	organizationName: "Shipit Digital",
	organizationLogo: "",
	socialProfiles: [
		"https://www.instagram.com/shipitdigital.nl/",
		"https://www.linkedin.com/company/shipitdigital/",
		"https://www.tiktok.com/@shipit.digital",
		"https://www.facebook.com/profile.php?id=61580257498746",
	],
	defaultSocialImage: "",
	twitterHandle: "",
	noindex: false,
};

const fromGlobal = (value: unknown, revision = "g1") => classifySiteSettings({ site, global: entry(value, revision) });
const fromLegacy = (legacy: LegacySettingsEntries) => classifySiteSettings({ site, global: null, legacy });
const noindexOf = (snapshot: SiteSettingsSnapshot) => isReadableSiteSettings(snapshot) ? snapshot.values.noindex : snapshot.state;

// Absence: no stored preference and no legacy noindex means no plugin restriction.
const absent = await fromLegacy({});
assert.equal(absent.state, "absent");
assert.equal(noindexOf(absent), false, "clean absence adds no site-wide noindex");
assert.ok(absent.state === "absent" && absent.values.siteName === "Host Site" && absent.values.siteUrl === "https://host.example");
assert.ok(absent.state === "absent" && absent.legacyPresent === false && absent.revision === null && absent.updatedAt === null);
const absentWithOtherLegacy = await fromLegacy({ "settings:siteName": entry(" Legacy Name "), "settings:noindex": null });
assert.ok(absentWithOtherLegacy.state === "absent" && absentWithOtherLegacy.legacyPresent, "other legacy keys do not decide indexing");
assert.ok(absentWithOtherLegacy.state === "absent" && absentWithOtherLegacy.values.siteName === "Legacy Name" && absentWithOtherLegacy.values.noindex === false);

// A legacy Boolean is kept exactly while no record exists.
assert.equal(noindexOf(await fromLegacy({ "settings:noindex": entry(true) })), true);
assert.equal(noindexOf(await fromLegacy({ "settings:noindex": entry(false) })), false);
assert.equal((await fromLegacy({ "settings:noindex": entry(false) })).state, "legacy");

// Wrong legacy types and present nulls of the indexing keys are corrupt.
for (const [label, legacy] of [
	["string noindex", { "settings:noindex": entry("false") }],
	["numeric noindex", { "settings:noindex": entry(0) }],
	["null noindex", { "settings:noindex": entry(null) }],
	["numeric site URL", { "settings:siteUrl": entry(42) }],
	["null site URL", { "settings:siteUrl": entry(null) }],
	["object site name", { "settings:siteName": entry({ name: "x" }) }],
	["numeric logo", { "settings:orgLogo": entry(7) }],
] as const) {
	const snapshot = await fromLegacy(legacy as LegacySettingsEntries);
	assert.deepEqual(snapshot, { state: "corrupt", revision: null }, label);
}
assert.equal((await fromLegacy({ "settings:twitterHandle": entry(null) })).state, "absent", "a stored null text key means not set");

// Ordinary stored records keep their preference exactly.
assert.deepEqual(
	[await fromGlobal(record({ noindex: true })), await fromGlobal(record({ noindex: false }))].map(noindexOf),
	[true, false],
);
const earlierSeededTrue = await fromGlobal(record({ siteName: "Host Site", siteUrl: "https://host.example", organizationName: "Host Site", noindex: true }));
assert.ok(earlierSeededTrue.state === "saved" && earlierSeededTrue.values.noindex === true && !earlierSeededTrue.confirmed, "an earlier automatic true seed stays a saved true");
const oldShape = await fromGlobal({ ...record(), publisherType: undefined, personName: undefined, personProfiles: undefined, contentScoringEnabled: undefined });
assert.ok(oldShape.state === "saved" && oldShape.values.contentScoringEnabled === true && oldShape.values.publisherType === "organization");

// A present global record never falls through to legacy keys.
const storedWithLegacy = await classifySiteSettings({ site, global: entry(record({ noindex: false })), legacy: { "settings:noindex": entry(true) } });
assert.equal(noindexOf(storedWithLegacy), false, "legacy keys are ignored once a record exists");

// The exact historical seed keeps its effective restriction.
const seed = await fromGlobal(historicalSeed);
assert.equal(seed.state, "historical-seed");
assert.ok(seed.state === "historical-seed" && seed.values.noindex === true && seed.updatedAt === null && seed.values.siteName === "Host Site" && seed.values.socialProfiles.length === 0);
assert.ok(seed.state === "historical-seed" && seed.revision === "g1", "the seed keeps its record revision for later writes");
for (const [label, change] of [
	["site URL", { siteUrl: "https://example.com" }],
	["logo", { organizationLogo: "https://example.com/logo.svg" }],
	["social image", { defaultSocialImage: "https://example.com/a.jpg" }],
	["X handle", { twitterHandle: "@shipit" }],
	["noindex true", { noindex: true }],
	["scoring off", { contentScoringEnabled: false }],
	["person publisher", { publisherType: "person", personName: "Ada" }],
	["person profiles", { personProfiles: ["https://social.example/a"] }],
	["site name", { siteName: "Shipit Digital B.V." }],
	["one fewer profile", { socialProfiles: historicalSeed.socialProfiles.slice(1) }],
] as const) {
	const snapshot = await fromGlobal({ ...historicalSeed, ...change });
	assert.equal(snapshot.state, "saved", `near-match (${label}) is an ordinary record`);
	assert.equal(noindexOf(snapshot), (change as { noindex?: boolean }).noindex ?? false, `near-match (${label}) keeps its own preference`);
}

// Archive policy keeps omission distinct from an explicit empty preference.
assert.ok(isReadableSiteSettings(absent) && !Object.hasOwn(absent.values, "taxonomyArchiveNoindex"));
const archivePolicyValues = ["category", "custom_type"];
const archiveRecord = record({ taxonomyArchiveNoindex: archivePolicyValues });
const archiveSnapshot = await fromGlobal(archiveRecord);
assert.ok(archiveSnapshot.state === "saved");
if (archiveSnapshot.state === "saved") {
	assert.deepEqual(archiveSnapshot.values.taxonomyArchiveNoindex, ["category", "custom_type"]);
	archiveSnapshot.values.taxonomyArchiveNoindex!.push("tag");
	assert.deepEqual(archivePolicyValues, ["category", "custom_type"], "read values do not alias the stored policy");
}
const emptyArchivePolicy = await fromGlobal(record({ taxonomyArchiveNoindex: [] }));
assert.ok(emptyArchivePolicy.state === "saved" && Object.hasOwn(emptyArchivePolicy.values, "taxonomyArchiveNoindex"));
assert.ok(emptyArchivePolicy.state === "saved" && emptyArchivePolicy.values.taxonomyArchiveNoindex?.length === 0);
const archiveSeed = await fromGlobal({ ...historicalSeed, taxonomyArchiveNoindex: ["category", "custom_type"] });
assert.ok(archiveSeed.state === "historical-seed" && archiveSeed.values.noindex === true,
	"adding archive policy does not reinterpret the historical global restriction");
assert.ok(archiveSeed.state === "historical-seed" && archiveSeed.revision === "g1");
assert.deepEqual(isReadableSiteSettings(archiveSeed) && archiveSeed.values.taxonomyArchiveNoindex, ["category", "custom_type"]);
for (const taxonomyArchiveNoindex of [undefined, null, "category", ["tag", "category"], ["tag", "tag"], ["a/b"], Array(101).fill("category")]) {
	assert.deepEqual(await fromGlobal(record({ taxonomyArchiveNoindex })), { state: "corrupt", revision: "g1" },
		"a present invalid policy cannot become editable empty settings");
}

// Content type rules follow the same presence rules as archive policy.
assert.ok(isReadableSiteSettings(absent) && !Object.hasOwn(absent.values, "contentTypeNoindex"));
const typeValues = ["events", "posts"];
const typeSnapshot = await fromGlobal(record({ contentTypeNoindex: typeValues }));
assert.ok(typeSnapshot.state === "saved");
if (typeSnapshot.state === "saved") {
	assert.deepEqual(typeSnapshot.values.contentTypeNoindex, ["events", "posts"]);
	typeSnapshot.values.contentTypeNoindex!.push("pages");
	assert.deepEqual(typeValues, ["events", "posts"], "read values do not alias the stored rules");
}
const emptyTypes = await fromGlobal(record({ contentTypeNoindex: [] }));
assert.ok(emptyTypes.state === "saved" && emptyTypes.values.contentTypeNoindex?.length === 0);
const typeSeed = await fromGlobal({ ...historicalSeed, contentTypeNoindex: ["posts"] });
assert.ok(typeSeed.state === "historical-seed" && typeSeed.values.noindex === true, "rules do not reinterpret the historical restriction");
assert.deepEqual(isReadableSiteSettings(typeSeed) && typeSeed.values.contentTypeNoindex, ["posts"]);
for (const contentTypeNoindex of [undefined, null, "posts", ["posts", "events"], ["posts", "posts"], ["Posts"], Array(101).fill("posts")]) {
	assert.deepEqual(await fromGlobal(record({ contentTypeNoindex })), { state: "corrupt", revision: "g1" },
		"a present invalid rule list cannot become editable empty settings");
}

// The confirmation marker exits the fingerprint; any other marker value is corrupt.
const confirmed = await fromGlobal({ ...historicalSeed, indexingPreferenceConfirmed: true });
assert.ok(confirmed.state === "saved" && confirmed.confirmed && confirmed.values.noindex === false);
for (const marker of [false, "true", 1, null, {}]) {
	assert.deepEqual(await fromGlobal({ ...historicalSeed, indexingPreferenceConfirmed: marker }), { state: "corrupt", revision: "g1" }, `marker ${JSON.stringify(marker)}`);
}

// Corrupt global records keep their revision and never use legacy values.
for (const [label, value] of [
	["present null", null],
	["array", [record()]],
	["unsupported version", record({ version: 2 })],
	["missing updatedAt", { ...record(), updatedAt: undefined }],
	["string noindex", record({ noindex: "true" })],
	["missing noindex", { ...record(), noindex: undefined }],
	["non-array profiles", record({ socialProfiles: "https://x.example" })],
	["unknown publisher", record({ publisherType: "LocalBusiness" })],
] as const) {
	const snapshot = await classifySiteSettings({ site, global: entry(value, "bad"), legacy: { "settings:noindex": entry(false) } });
	assert.deepEqual(snapshot, { state: "corrupt", revision: "bad" }, label);
}

// Revision envelope anomalies are unavailable, never a Boolean.
for (const [label, global] of [
	["missing revision", { value: record() }],
	["empty revision", { value: record(), revision: "" }],
	["long revision", { value: record(), revision: "r".repeat(129) }],
	["numeric revision", { value: record(), revision: 7 }],
	["missing value", { revision: "g1" }],
	["array envelope", [record()]],
	["undefined envelope", undefined],
] as const) {
	assert.deepEqual(await classifySiteSettings({ site, global: global as VersionedSettingsEntry }), { state: "unavailable" }, label);
}
for (const [label, legacyEntry] of [
	["legacy without revision", { value: true }],
	["legacy without value", { revision: "r1" }],
	["legacy undefined", undefined],
] as const) {
	assert.deepEqual(
		await fromLegacy({ "settings:noindex": legacyEntry as VersionedSettingsEntry }),
		{ state: "unavailable" },
		label,
	);
}

// The narrow indexing scope reaches the same noindex decision as the full scope.
for (const legacy of [
	{},
	{ "settings:noindex": entry(true) },
	{ "settings:noindex": entry(false), "settings:siteUrl": entry("https://legacy.example ") },
	{ "settings:siteUrl": entry("https://legacy.example"), "settings:siteName": entry("Legacy") },
] as LegacySettingsEntries[]) {
	const full = await fromLegacy(Object.fromEntries(LEGACY_SETTINGS_KEYS.map((key) => [key, legacy[key] ?? null])));
	const narrow = await fromLegacy(Object.fromEntries(INDEXING_LEGACY_SETTINGS_KEYS.map((key) => [key, legacy[key] ?? null])));
	assert.equal(noindexOf(narrow), noindexOf(full));
	assert.equal(narrow.state, full.state);
	assert.ok(isReadableSiteSettings(narrow) && isReadableSiteSettings(full) && narrow.values.siteUrl === full.values.siteUrl);
}

// The legacy guard tracks presence and revision of every legacy key, in a fixed order.
const guardA = await legacySettingsGuard({ "settings:noindex": entry(false, "r1"), "settings:siteName": entry("A", "r2") });
assert.match(guardA, SEO_ADMIN_LEGACY_SETTINGS_GUARD_PATTERN);
assert.equal(guardA, await legacySettingsGuard({ "settings:siteName": entry("other value", "r2"), "settings:noindex": entry(true, "r1") }), "only presence and revisions count");
assert.notEqual(guardA, await legacySettingsGuard({ "settings:noindex": entry(false, "r3"), "settings:siteName": entry("A", "r2") }), "a rewritten key changes the guard");
assert.notEqual(guardA, await legacySettingsGuard({ "settings:noindex": entry(false, "r1") }), "a removed key changes the guard");
assert.notEqual(guardA, await legacySettingsGuard({ "settings:noindex": entry(false, "r1"), "settings:siteName": entry("A", "r2"), "settings:sameAs": entry([], "r4") }), "a created key changes the guard");
assert.equal(await legacySettingsGuard({}), await legacySettingsGuard(Object.fromEntries(LEGACY_SETTINGS_KEYS.map((key) => [key, null]))));

// Records this version writes keep the noindex they hold.
const seedShaped = { ...historicalSeed, contentScoringEnabled: true } as StoredSeoAdminSettings;
const disambiguated = await withoutHistoricalSeedAmbiguity(seedShaped);
assert.equal(disambiguated.indexingPreferenceConfirmed, true, "a written false matching the fingerprint gets the marker");
assert.equal(noindexOf(await fromGlobal(disambiguated)), false);
const restricted = { ...seedShaped, noindex: true } as StoredSeoAdminSettings;
assert.equal(await withoutHistoricalSeedAmbiguity(restricted), restricted, "a true record is never the seed and is unchanged");
const ordinary = record() as StoredSeoAdminSettings;
assert.equal(await withoutHistoricalSeedAmbiguity(ordinary), ordinary, "an ordinary record is unchanged");

console.log("settings-state selfcheck passed");
