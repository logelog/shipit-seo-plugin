import seoRuntime from "./sandbox-entry.ts";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	validateSeoAdminSettings,
} from "./admin-contract.ts";
import {
	getGlobalSettings,
	readAdminSettings,
	readContentScoringPolicy,
	resetAdminSettings,
	saveAdminSettingsIfCurrent,
} from "./settings-runtime.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

const GLOBAL_KEY = `settings:global:v${SEO_ADMIN_SETTINGS_STORAGE_VERSION}`;
const LEGACY_VALUES: Array<[string, unknown]> = [
	["settings:siteName", "Legacy Site"],
	["settings:siteUrl", ""],
	["settings:orgName", "Legacy Organization"],
	["settings:orgLogo", ""],
	["settings:sameAs", ["https://social.example/legacy"]],
	["settings:defaultOgImage", ""],
	["settings:twitterHandle", ""],
	["settings:noindex", false],
];
const HISTORICAL_SEED = {
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
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

type Hook = (key: string) => void;

const emptyCollection = {
	get: async () => null,
	query: async () => ({ items: [], hasMore: false }),
	count: async () => 0,
	put: async () => { throw new Error("this harness stores nothing in collections"); },
	delete: async () => false,
};

/**
 * A plugin KV with per-key revisions, like the published hosts. `onRead` runs
 * after each versioned read and `beforeWrite` before each conditional write,
 * so a check can change storage inside an operation's window.
 */
function createContext(options: { legacy?: boolean; versioned?: boolean } = {}) {
	const values = new Map<string, unknown>(options.legacy === false ? [] : LEGACY_VALUES);
	const revisions = new Map<string, string>();
	let revision = 0;
	for (const key of values.keys()) revisions.set(key, `r${++revision}`);
	let setCount = 0;
	let casCount = 0;
	const hooks: { onRead?: Hook; beforeWrite?: Hook } = {};
	const write = (key: string, value: unknown) => {
		values.set(key, structuredClone(value));
		revisions.set(key, `r${++revision}`);
	};
	const remove = (key: string) => {
		values.delete(key);
		revisions.delete(key);
	};
	const kv: Record<string, unknown> = {
		get: async (key: string) => structuredClone(values.get(key) ?? null),
		set: async (key: string, value: unknown) => {
			setCount += 1;
			write(key, value);
		},
		delete: async (key: string) => remove(key),
		list: async () => [],
	};
	if (options.versioned !== false) {
		kv.getVersioned = async (key: string) => {
			const snapshot = values.has(key) ? { value: structuredClone(values.get(key)), revision: revisions.get(key)! } : null;
			hooks.onRead?.(key);
			return snapshot;
		};
		kv.compareAndSet = async (key: string, expected: string | null, value: unknown) => {
			hooks.beforeWrite?.(key);
			casCount += 1;
			if ((revisions.get(key) ?? null) !== expected) return { applied: false };
			write(key, value);
			return { applied: true, revision: revisions.get(key) };
		};
		kv.compareAndDelete = async (key: string, expected: string) => {
			hooks.beforeWrite?.(key);
			if ((revisions.get(key) ?? null) !== expected) return { applied: false };
			remove(key);
			return { applied: true };
		};
	}
	return {
		context: {
			plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
			site: { name: "Host Site", url: "https://host.example", locale: "en" },
			url: (path: string) => new URL(path, "https://host.example").toString(),
			// Current hosts expose versioned plugin settings; no business identity is stored here.
			settings: {
				get: async () => null,
				getVersioned: async () => null,
				compareAndSet: async () => ({ applied: false }),
				compareAndDelete: async () => ({ applied: false }),
			},
			kv,
			// Empty plugin collections: enough for Overview's counts and score sample.
			storage: new Proxy({}, { get: () => emptyCollection }),
			log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
		},
		values,
		revisions,
		hooks,
		write,
		remove,
		get setCount() {
			return setCount;
		},
		get casCount() {
			return casCount;
		},
	};
}

function storedRecordForMalformed() {
	return { version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-09-01T00:00:00.000Z" };
}

function handler(name: string) {
	return (seoRuntime as any).routes[name].handler as (routeContext: any, context: any) => Promise<any>;
}

function route(input: unknown = {}) {
	return {
		input,
		request: {
			url: "https://shipitdigital.nl/_emdash/api/plugins/shipit-seo/settings",
			method: "POST",
			headers: {},
		},
	};
}

async function acknowledgedScoringRoute(input: Record<string, unknown>, context: any) {
	const settings = await handler("admin-settings")(route(), context);
	return route({
		...input, expectedRevision: settings.revision,
		expectedLegacyGuard: settings.legacyGuard,
		...(input.contentScoringEnabled === true ? { resourceNoticeVersion: 1 } : {}),
	});
}

function loadedGuard(settings: { revision: string | null; legacyGuard: string | null }) {
	return settings.revision === null
		? { expectedRevision: null, expectedLegacyGuard: settings.legacyGuard }
		: { expectedRevision: settings.revision };
}

const harness = createContext();
const initial = await handler("admin-settings")(route(), harness.context);
check("legacy settings remain readable", initial.values.siteName === "Legacy Site");
check("legacy settings report no stored revision", initial.updatedAt === null && initial.revision === null);
check("a legacy noindex Boolean is the preference source", initial.state === "legacy" && initial.values.noindex === false);
check("legacy snapshots carry a bounded legacy guard", /^legacy-v1:[0-9a-f]{64}$/.test(initial.legacyGuard) && initial.legacyPresent === true);
check("settings contract version is explicit", initial.contractVersion === SEO_ADMIN_CONTRACT_VERSION);

const freshHarness = createContext({ legacy: false });
const fresh = await handler("admin-settings")(route(), freshHarness.context);
check("fresh settings inherit the host site name", fresh.values.siteName === "Host Site");
check("fresh settings inherit the host canonical URL", fresh.values.siteUrl === "https://host.example");
check("settings expose the host URL for identity previews", fresh.hostSiteUrl === "https://host.example");
check("fresh settings use an Organization publisher", fresh.values.publisherType === "organization");
check("fresh settings assume no social profiles", fresh.values.socialProfiles.length === 0);
check("fresh settings add no site-wide noindex", fresh.state === "absent" && fresh.values.noindex === false);
check("fresh settings retain automatic scoring by default", fresh.values.contentScoringEnabled === true);
check("reading fresh settings writes nothing", freshHarness.setCount === 0 && freshHarness.casCount === 0 && freshHarness.values.size === 0);

freshHarness.write(GLOBAL_KEY, HISTORICAL_SEED);
const migratedSeed = await handler("admin-settings")(route(), freshHarness.context);
check("historical branded seeds are their own state", migratedSeed.state === "historical-seed" && migratedSeed.updatedAt === null);
check("historical branded seeds inherit the current host", migratedSeed.values.siteName === "Host Site");
check("historical branded seeds keep their effective site-wide noindex", migratedSeed.values.noindex === true);
check("historical branded seeds no longer assume social profiles", migratedSeed.values.socialProfiles.length === 0);
check("historical settings retain scoring by default", migratedSeed.values.contentScoringEnabled === true);
freshHarness.write(GLOBAL_KEY, { ...HISTORICAL_SEED, indexingPreferenceConfirmed: true });
const confirmedSeed = await handler("admin-settings")(route(), freshHarness.context);
check("a confirmed record matching the fingerprint is an ordinary saved false", confirmedSeed.state === "saved" && confirmedSeed.values.noindex === false && confirmedSeed.indexingPreferenceConfirmed === true);
freshHarness.write(GLOBAL_KEY, { ...HISTORICAL_SEED, twitterHandle: "@shipit" });
const nearSeed = await handler("admin-settings")(route(), freshHarness.context);
check("a near-match of the historical seed is an ordinary saved false", nearSeed.state === "saved" && nearSeed.values.noindex === false);
freshHarness.write(GLOBAL_KEY, { ...HISTORICAL_SEED, indexingPreferenceConfirmed: false });
const malformedMarker = await handler("admin-settings")(route(), freshHarness.context);
check("a malformed confirmation marker is corrupt", malformedMarker.state === "corrupt" && malformedMarker.values === null);
freshHarness.write(GLOBAL_KEY, {
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	updatedAt: "2026-08-02T00:00:00.000Z",
	siteName: "Existing Site",
	siteUrl: "https://existing.example",
	organizationName: "Existing Site",
	organizationLogo: "",
	socialProfiles: [],
	defaultSocialImage: "",
	twitterHandle: "",
	noindex: false,
});
const oldSnapshot = await handler("admin-settings")(route(), freshHarness.context);
check("old v1 settings snapshots remain readable", oldSnapshot.values.siteName === "Existing Site");
check("old v1 settings snapshots inherit enabled scoring", oldSnapshot.values.contentScoringEnabled === true);
check("old v1 settings snapshots are unconfirmed saved records", oldSnapshot.state === "saved" && oldSnapshot.indexingPreferenceConfirmed === false);
freshHarness.remove(GLOBAL_KEY);

const invalid = await handler("save-admin-settings")(
	route({
		siteName: "",
		siteUrl: "javascript:alert(1)",
		organizationName: "",
		organizationLogo: "",
		socialProfiles: ["not-a-url"],
		defaultSocialImage: "",
		twitterHandle: "bad handle!",
		noindex: false,
		...loadedGuard(initial),
	}),
	harness.context,
);
check("invalid settings are rejected", invalid.success === false);
check("invalid settings expose field errors", Boolean(invalid.errors.siteName && invalid.errors.siteUrl && invalid.errors.socialProfiles));
check("invalid settings perform no writes", harness.setCount === 0 && harness.casCount === 0);

const validInput = {
	siteName: "  Example Site  ",
	siteUrl: "https://example.com/",
	organizationName: "",
	organizationLogo: "https://example.com/logo.svg",
	socialProfiles: [
		" https://social.example/example ",
		"https://social.example/example",
	],
	defaultSocialImage: "https://example.com/social.jpg",
	twitterHandle: "example_site",
	noindex: true,
};
const unguarded = await handler("save-admin-settings")(route(validInput), harness.context);
check("a full save without the loaded revision is refused", unguarded.success === false && Boolean(unguarded.errors._form));
const unguardedFirst = await handler("save-admin-settings")(route({ ...validInput, expectedRevision: null }), harness.context);
check("a first save without the loaded legacy guard is refused", unguardedFirst.success === false && Boolean(unguardedFirst.errors._form));
const wrongGuard = await handler("save-admin-settings")(
	route({ ...validInput, expectedRevision: null, expectedLegacyGuard: `legacy-v1:${"0".repeat(64)}` }),
	harness.context,
);
check("a first save against other legacy state is a conflict", wrongGuard.success === false && wrongGuard.conflict === true);
check("refused saves perform no writes", harness.setCount === 0 && harness.casCount === 0);

const saved = await handler("save-admin-settings")(route({ ...validInput, ...loadedGuard(initial) }), harness.context);
check("valid settings are persisted", saved.success === true);
check("settings use one conditional create", harness.casCount === 1 && harness.setCount === 0);
check("saved settings keep the host URL for identity previews", saved.settings.hostSiteUrl === "https://host.example");
check("settings use the declared versioned key", harness.values.has(GLOBAL_KEY));
check("a deliberate save stores the confirmation marker", (harness.values.get(GLOBAL_KEY) as any).indexingPreferenceConfirmed === true && saved.settings.indexingPreferenceConfirmed === true);
check("legacy keys remain untouched", harness.values.get("settings:siteName") === "Legacy Site" && harness.values.get("settings:noindex") === false);
check("legacy saves retain an Organization publisher", saved.settings.values.publisherType === "organization");
check("site origin is normalized", saved.settings.values.siteUrl === "https://example.com");
check("blank organization falls back to the site name", saved.settings.values.organizationName === "Example Site");
check("social profiles are deduplicated", saved.settings.values.socialProfiles.length === 1);
check("X handle is normalized", saved.settings.values.twitterHandle === "@example_site");
check("indexing state is persisted", saved.settings.values.noindex === true);
check("older settings submissions retain scoring by default", saved.settings.values.contentScoringEnabled === true);
check("storage version is explicit", saved.settings.storageVersion === SEO_ADMIN_SETTINGS_STORAGE_VERSION);
check("a saved record has no legacy guard", saved.settings.state === "saved" && saved.settings.legacyGuard === null);

const reread = await handler("admin-settings")(route(), harness.context);
check("saved settings round-trip", reread.values.defaultSocialImage === "https://example.com/social.jpg");
check("saved settings include a revision timestamp", typeof reread.updatedAt === "string");
const paused = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: reread.values.contentScoringEnabled }, harness.context),
	harness.context,
);
check("content scoring can be paused", paused.success && paused.settings.values.contentScoringEnabled === false);
check("paused scoring survives a reread", (await handler("admin-settings")(route(), harness.context)).values.contentScoringEnabled === false);
const pausedRefresh = await handler("refresh-scores")(route({ collection: "posts", limit: 25 }), harness.context);
check("paused scoring rejects manual collection refresh", pausedRefresh.success === false && pausedRefresh.error === "scoring_disabled");
const pausedAnalysis = await handler("analyze-content")(route({ collection: "posts", id: "post-1" }), harness.context);
check("paused scoring rejects persisted entry analysis", pausedAnalysis.success === false && pausedAnalysis.error === "scoring_disabled");
const pausedAudit = await handler("audit-content")(route({ refs: ["posts:post-1"] }), harness.context);
check("paused scoring rejects session analysis without reads", pausedAudit.items.length === 0 && pausedAudit.failures[0]?.error === "scoring_disabled");
const pausedIdentity = await handler("entry-analysis-identity")(route({ ref: "posts:post-1" }), harness.context);
check("manual cache validation still validates the supported content type", pausedIdentity.success === false && pausedIdentity.error === "unsupported_collection");
const invalidScoring = validateSeoAdminSettings({ ...reread.values, contentScoringEnabled: "false" });
check("non-boolean scoring policy is rejected", !invalidScoring.success && Boolean(invalidScoring.errors.contentScoringEnabled));

const invalidPerson = validateSeoAdminSettings({ ...reread.values, publisherType: "person", personName: "" });
check("Person publisher needs an explicit name", !invalidPerson.success && Boolean(invalidPerson.errors.personName));
const invalidPublisher = validateSeoAdminSettings({ ...reread.values, publisherType: "LocalBusiness" });
check("unsupported publisher types cannot be saved", !invalidPublisher.success && Boolean(invalidPublisher.errors.publisherType));
const beforePerson = await handler("admin-settings")(route(), harness.context);
const savedPerson = await handler("save-admin-settings")(
	route({ ...reread.values, publisherType: "person", personName: "Ada Example", ...loadedGuard(beforePerson) }),
	harness.context,
);
check("Person identity is saved", savedPerson.success && savedPerson.settings.values.publisherType === "person");
const personReread = await handler("admin-settings")(route(), harness.context);
check("Person identity survives a reread", personReread.values.personName === "Ada Example");
check("Organization identity remains available", personReread.values.organizationName === "Example Site");
check("Organization profiles remain separate", personReread.values.socialProfiles.length === 1);
check("switching to Person starts with no Person profiles", personReread.values.personProfiles.length === 0);
check("Organization profiles do not become Person sameAs", (await getGlobalSettings(harness.context as any)).sameAs.length === 0);
const savedPersonProfiles = await handler("save-admin-settings")(
	route({ ...personReread.values, personProfiles: ["https://social.example/ada"], ...loadedGuard(personReread) }),
	harness.context,
);
check("Person profiles are saved separately", savedPersonProfiles.success && savedPersonProfiles.settings.values.personProfiles.length === 1);
check("Person output uses only Person profiles", (await getGlobalSettings(harness.context as any)).sameAs[0] === "https://social.example/ada");

const localMediaPath = "/_emdash/api/media/file/01JTESTSOCIALIMAGE.png";
const localImageSettings = validateSeoAdminSettings({
	...personReread.values,
	defaultSocialImage: localMediaPath,
	organizationLogo: localMediaPath,
});
check(
	"selected social image and logo paths remain portable",
	localImageSettings.success &&
		localImageSettings.values.defaultSocialImage === localMediaPath &&
		localImageSettings.values.organizationLogo === localMediaPath,
);
for (const invalidMediaPath of [
	"//other.example/_emdash/api/media/file/image.png",
	"/_emdash/api/media/file/%2e%2e/private.png",
	"/_emdash/api/media/file/image.png?redirect=other.example",
]) {
	const result = validateSeoAdminSettings({
		...reread.values,
		defaultSocialImage: invalidMediaPath,
	});
	check(
		`unsafe media path rejected: ${invalidMediaPath}`,
		!result.success && Boolean(result.errors.defaultSocialImage),
	);
	const logoResult = validateSeoAdminSettings({
		...reread.values,
		organizationLogo: invalidMediaPath,
	});
	check(
		`unsafe logo path rejected: ${invalidMediaPath}`,
		!logoResult.success && Boolean(logoResult.errors.organizationLogo),
	);
}

const publicConfig = await handler("public-config")(route(), harness.context);
check("public config reads the versioned site name", publicConfig.siteName === "Example Site");
check("public config reads the versioned indexing state", publicConfig.noindex === true);

// Restore keeps the loaded restriction even though the legacy noindex is false.
const beforeReset = await handler("admin-settings")(route(), harness.context);
const beforeStale = {
	value: JSON.stringify(harness.values.get(GLOBAL_KEY)),
	revision: harness.revisions.get(GLOBAL_KEY),
	sets: harness.setCount,
	writes: harness.casCount,
};
const staleReset = await handler("reset-admin-settings")(route({ expectedRevision: "r0" }), harness.context);
check("a stale restore is a conflict", staleReset.success === false && staleReset.conflict === true);
check(
	"a stale restore keeps the record, its revision and the write counts",
	JSON.stringify(harness.values.get(GLOBAL_KEY)) === beforeStale.value &&
		harness.revisions.get(GLOBAL_KEY) === beforeStale.revision &&
		harness.setCount === beforeStale.sets &&
		harness.casCount === beforeStale.writes,
);
const reset = await handler("reset-admin-settings")(route({ expectedRevision: beforeReset.revision }), harness.context);
check("settings can be restored to inherited values", reset.success === true && reset.settings.values.siteName === "Legacy Site");
check("restoring keeps the loaded site-wide noindex", reset.success === true && reset.settings.values.noindex === true);
check("restoring stores a record instead of deleting it", (harness.values.get(GLOBAL_KEY) as any)?.noindex === true && reset.settings.state === "saved");
check("restoring keeps the confirmation state", (harness.values.get(GLOBAL_KEY) as any)?.indexingPreferenceConfirmed === true);
check("restoring settings preserves paused analysis", reset.success === true && reset.settings.values.contentScoringEnabled === false && reset.settings.contentScoring.state === "paused");
check("restoring leaves legacy keys untouched", harness.values.get("settings:noindex") === false);
const publicConfigAfterReset = await handler("public-config")(route(), harness.context);
check("public config returns to inherited site identity", publicConfigAfterReset.siteName === "Legacy Site");
check("public config keeps the loaded indexing state after restoring", publicConfigAfterReset.noindex === true);

// A global update just before the restore's write wins; the restore changes nothing.
const raceGlobal = createContext();
raceGlobal.write(GLOBAL_KEY, { ...(harness.values.get(GLOBAL_KEY) as object), noindex: true });
const raceGlobalLoaded = await handler("admin-settings")(route(), raceGlobal.context);
raceGlobal.hooks.beforeWrite = (key) => {
	if (key !== GLOBAL_KEY || raceGlobal.casCount > 0) return;
	raceGlobal.write(key, { ...(raceGlobal.values.get(key) as object), siteName: "Concurrent Site", noindex: false });
};
const raceGlobalReset = await handler("reset-admin-settings")(route({ expectedRevision: raceGlobalLoaded.revision }), raceGlobal.context);
raceGlobal.hooks.beforeWrite = undefined;
const afterRaceGlobal = raceGlobal.values.get(GLOBAL_KEY) as any;
check("a restore racing a global update is a conflict", raceGlobalReset.success === false && raceGlobalReset.conflict === true);
check(
	"a restore racing a global update keeps the other writer's record",
	afterRaceGlobal.siteName === "Concurrent Site" && afterRaceGlobal.noindex === false && raceGlobal.casCount === 1,
);

// Loaded true with legacy true: legacy switching to false after its read must not lift it.
const raceTrue = createContext();
raceTrue.write("settings:noindex", true);
raceTrue.write(GLOBAL_KEY, { ...(harness.values.get(GLOBAL_KEY) as object), noindex: true });
const raceTrueLoaded = await handler("admin-settings")(route(), raceTrue.context);
raceTrue.hooks.onRead = (key) => {
	if (key === "settings:noindex") raceTrue.write("settings:noindex", false);
};
const raceTrueReset = await handler("reset-admin-settings")(route({ expectedRevision: raceTrueLoaded.revision }), raceTrue.context);
raceTrue.hooks.onRead = undefined;
const afterRaceTrue = await handler("admin-settings")(route(), raceTrue.context);
check("restore keeps true when legacy noindex changes after its read", raceTrueReset.success && afterRaceTrue.values.noindex === true && afterRaceTrue.state === "saved");

// Loaded false with no legacy keys: a legacy true created after the read must not add one.
const raceFalse = createContext({ legacy: false });
raceFalse.write(GLOBAL_KEY, { ...(harness.values.get(GLOBAL_KEY) as object), noindex: false });
const raceFalseLoaded = await handler("admin-settings")(route(), raceFalse.context);
raceFalse.hooks.onRead = (key) => {
	if (key === "settings:noindex" && !raceFalse.values.has("settings:noindex")) raceFalse.write("settings:noindex", true);
};
const raceFalseReset = await handler("reset-admin-settings")(route({ expectedRevision: raceFalseLoaded.revision }), raceFalse.context);
raceFalse.hooks.onRead = undefined;
const afterRaceFalse = await handler("admin-settings")(route(), raceFalse.context);
check("restore keeps false when a legacy noindex true appears after the read", raceFalseReset.success && afterRaceFalse.values.noindex === false && afterRaceFalse.state === "saved");
check("restore leaves the concurrent legacy key untouched", raceFalse.values.get("settings:noindex") === true);

// The historical seed is restored with its effective true, never its raw false.
const seedReset = createContext({ legacy: false });
seedReset.write(GLOBAL_KEY, HISTORICAL_SEED);
const seedLoaded = await handler("admin-settings")(route(), seedReset.context);
const seedResetResult = await handler("reset-admin-settings")(route({ expectedRevision: seedLoaded.revision }), seedReset.context);
check("restoring the historical seed materializes true", seedResetResult.success && (seedReset.values.get(GLOBAL_KEY) as any).noindex === true);
check("restoring the historical seed adds no confirmation marker", !Object.hasOwn(seedReset.values.get(GLOBAL_KEY) as object, "indexingPreferenceConfirmed"));

const corruptReset = createContext({ legacy: false });
corruptReset.write(GLOBAL_KEY, null);
const corruptLoaded = await handler("admin-settings")(route(), corruptReset.context);
const corruptResetResult = await handler("reset-admin-settings")(route({ expectedRevision: corruptLoaded.revision }), corruptReset.context);
check("a present null record is corrupt", corruptLoaded.state === "corrupt" && typeof corruptLoaded.revision === "string");
check("restore refuses a corrupt record and keeps it", !corruptResetResult.success && corruptReset.values.get(GLOBAL_KEY) === null && corruptReset.casCount === 0);
const corruptSave = await handler("save-admin-settings")(
	route({ ...fresh.values, expectedRevision: corruptLoaded.revision }),
	corruptReset.context,
);
check("a full save refuses a corrupt record and keeps it", !corruptSave.success && corruptReset.values.get(GLOBAL_KEY) === null && corruptReset.casCount === 0);
const corruptScoring = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, corruptReset.context),
	corruptReset.context,
);
check("a scoring change refuses a corrupt record", !corruptScoring.success && corruptReset.casCount === 0);

const wrongLegacy = createContext({ legacy: false });
wrongLegacy.write("settings:noindex", "false");
const wrongLegacyLoaded = await handler("admin-settings")(route(), wrongLegacy.context);
check("a wrong legacy noindex type is corrupt", wrongLegacyLoaded.state === "corrupt" && wrongLegacyLoaded.revision === null);

const noCasHarness = createContext({ legacy: false, versioned: false });
const noCasRead = await handler("admin-settings")(route(), noCasHarness.context);
check("settings without versioned storage are unavailable, not defaults", noCasRead.state === "unavailable" && noCasRead.values === null);
const noCasChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, noCasHarness.context),
	noCasHarness.context,
);
check("scoring change fails closed without conditional storage", noCasChange.success === false && noCasHarness.setCount === 0);

// A malformed stored row fails both reads of that key; other keys stay readable.
const malformed = createContext({ legacy: false });
malformed.write(GLOBAL_KEY, storedRecordForMalformed());
const malformedKv = malformed.context.kv as any;
const malformedRead = (read: (key: string) => Promise<unknown>) => async (key: string) => {
	if (key === GLOBAL_KEY) throw new SyntaxError("Unexpected token } in JSON");
	return read(key);
};
malformedKv.get = malformedRead(malformedKv.get);
malformedKv.getVersioned = malformedRead(malformedKv.getVersioned);
const malformedOverview = await handler("admin-overview")(route({ limit: 6 }), malformed.context);
check(
	"a malformed settings row leaves Overview readable with an unknown indexing state",
	malformedOverview.site.indexable === null && malformedOverview.site.settingsState === "unavailable" &&
		malformedOverview.summary.sampleSize === 0 && malformedOverview.site.name === "Host Site",
);
check("a malformed settings row is never rewritten", malformed.setCount === 0 && malformed.casCount === 0);
const corruptOverviewHarness = createContext({ legacy: false });
corruptOverviewHarness.write(GLOBAL_KEY, { version: 9 });
const corruptOverview = await handler("admin-overview")(route({ limit: 6 }), corruptOverviewHarness.context);
check(
	"a corrupt record leaves Overview readable and reports it as corrupt",
	corruptOverview.site.indexable === null && corruptOverview.site.settingsState === "corrupt" &&
		corruptOverview.checks.find((item: any) => item.check === "Search visibility")?.status === "fail",
);

// Unreadable storage: every settings mutation is refused and nothing is written.
const storedRecord = { ...(harness.values.get(GLOBAL_KEY) as object) };
const validGuard = `legacy-v1:${"a".repeat(64)}`;
for (const [label, global, getVersioned] of [
	["a thrown settings read", true, async (key: string) => {
		if (key === GLOBAL_KEY || LEGACY_VALUES.some(([legacy]) => legacy === key)) throw new Error("database is locked");
		return null;
	}],
	["a global envelope without a revision", true, async (key: string) => key === GLOBAL_KEY ? { value: structuredClone(storedRecord) } : null],
	["a global envelope with an empty revision", true, async (key: string) => key === GLOBAL_KEY ? { value: structuredClone(storedRecord), revision: "" } : null],
	["a legacy envelope without its value", false, async (key: string) => key === "settings:noindex" ? { revision: "r9" } : null],
] as const) {
	const unreadable = createContext({ legacy: false });
	if (global) unreadable.write(GLOBAL_KEY, storedRecord);
	const before = JSON.stringify([...unreadable.values]);
	(unreadable.context.kv as any).getVersioned = getVersioned;
	const read = await handler("admin-settings")(route(), unreadable.context);
	check(`${label}: settings are unavailable, not defaults`, read.state === "unavailable" && read.values === null && read.revision === null);
	const revisionGuard = global ? { expectedRevision: "r1" } : { expectedRevision: null, expectedLegacyGuard: validGuard };
	const save = await handler("save-admin-settings")(route({ ...fresh.values, ...revisionGuard }), unreadable.context);
	const scoring = await handler("save-content-scoring")(
		await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, unreadable.context),
		unreadable.context,
	);
	const restore = await handler("reset-admin-settings")(route({ expectedRevision: "r1" }), unreadable.context);
	let publicConfigRefused = false;
	try {
		await handler("public-config")(route(), unreadable.context);
	} catch {
		publicConfigRefused = true;
	}
	check(`${label}: save, scoring and restore are refused`, !save.success && !scoring.success && !restore.success);
	const overview = await handler("admin-overview")(route({ limit: 6 }), unreadable.context);
	check(
		`${label}: Overview reports an unknown indexing state with host identity only`,
		overview.site.indexable === null && overview.site.robotsMode === "unknown" && overview.site.settingsState === "unavailable" &&
			overview.readiness.state === "blocked" && overview.readiness.title === "SEO settings cannot be read" &&
			overview.site.name === "Host Site" && overview.site.url === "https://host.example",
	);
	check(`${label}: public config refuses instead of guessing`, publicConfigRefused);
	check(
		`${label}: nothing is written`,
		unreadable.setCount === 0 && unreadable.casCount === 0 && JSON.stringify([...unreadable.values]) === before,
	);
}

const scoringHarness = createContext({ legacy: false });
const initialScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, scoringHarness.context),
	scoringHarness.context,
);
check("scoring change creates one settings record", initialScoringChange.success && scoringHarness.casCount === 1);
check("scoring change preserves inherited site identity", initialScoringChange.settings.values.siteName === "Host Site");
check("scoring adoption of an absent preference stores no restriction", (scoringHarness.values.get(GLOBAL_KEY) as any).noindex === false);

const invalidScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: "true", expectedContentScoringEnabled: false }, scoringHarness.context),
	scoringHarness.context,
);
check("scoring change rejects non-boolean input", !invalidScoringChange.success && scoringHarness.casCount === 1);
const fullSnapshotChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: true, expectedContentScoringEnabled: false, siteName: "Stale Site" }, scoringHarness.context),
	scoringHarness.context,
);
check("scoring route rejects full settings payloads", !fullSnapshotChange.success && scoringHarness.casCount === 1);

let injectedUnrelatedEdit = false;
scoringHarness.hooks.beforeWrite = (key) => {
	if (injectedUnrelatedEdit) return;
	injectedUnrelatedEdit = true;
	scoringHarness.write(key, { ...(scoringHarness.values.get(key) as Record<string, unknown>), siteName: "Latest Site", noindex: false });
};
let mergedScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: true, expectedContentScoringEnabled: false }, scoringHarness.context),
	scoringHarness.context,
);
check("scoring activation refuses a concurrent settings edit", !mergedScoringChange.success && mergedScoringChange.conflict === true && scoringHarness.casCount === 2);
scoringHarness.hooks.beforeWrite = undefined;
mergedScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: true, expectedContentScoringEnabled: false }, scoringHarness.context),
	scoringHarness.context,
);
check("a fresh explicit activation keeps the concurrent edit", mergedScoringChange.success && scoringHarness.casCount === 3);
check("scoring change preserves the concurrent settings edit", mergedScoringChange.settings.values.siteName === "Latest Site" && mergedScoringChange.settings.values.noindex === false);
check("scoring change persists only the requested field", (await handler("admin-settings")(route(), scoringHarness.context)).values.siteName === "Latest Site");
scoringHarness.hooks.beforeWrite = undefined;

const staleScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: false }, scoringHarness.context),
	scoringHarness.context,
);
check("stale scoring change reports a conflict", !staleScoringChange.success && Boolean(staleScoringChange.errors.contentScoringEnabled));
check("stale scoring change leaves settings untouched", scoringHarness.casCount === 3 && (await handler("admin-settings")(route(), scoringHarness.context)).values.contentScoringEnabled === true);

let injectedScoringEdit = false;
scoringHarness.hooks.beforeWrite = (key) => {
	if (injectedScoringEdit) return;
	injectedScoringEdit = true;
	scoringHarness.write(key, { ...(scoringHarness.values.get(key) as Record<string, unknown>), contentScoringEnabled: false });
};
const racedScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, scoringHarness.context),
	scoringHarness.context,
);
check("concurrent scoring change reports a conflict", !racedScoringChange.success && racedScoringChange.conflict === true);
check("concurrent scoring change keeps the other writer's value", scoringHarness.casCount === 4 && (await handler("admin-settings")(route(), scoringHarness.context)).values.contentScoringEnabled === false);
scoringHarness.hooks.beforeWrite = undefined;

const beforeLatestScoringChange = await handler("admin-settings")(route(), scoringHarness.context);
check("settings reads include the storage revision", typeof beforeLatestScoringChange.revision === "string");
const latestScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: true, expectedContentScoringEnabled: false }, scoringHarness.context),
	scoringHarness.context,
);
check("scoring writes return the new storage revision", latestScoringChange.success && latestScoringChange.settings.revision !== beforeLatestScoringChange.revision);
const staleFullSave = await handler("save-admin-settings")(
	route({ ...beforeLatestScoringChange.values, organizationName: "Stale publisher", expectedRevision: beforeLatestScoringChange.revision }),
	scoringHarness.context,
);
check("stale full settings save reports a revision conflict", !staleFullSave.success && staleFullSave.conflict === true);
const afterStaleFullSave = await handler("admin-settings")(route(), scoringHarness.context);
check("stale full settings save cannot revert scoring", afterStaleFullSave.values.contentScoringEnabled === true);
check("stale full settings save cannot change unrelated values", afterStaleFullSave.values.organizationName !== "Stale publisher");
const currentFullSave = await handler("save-admin-settings")(
	route({ ...afterStaleFullSave.values, organizationName: "Current publisher", expectedRevision: afterStaleFullSave.revision }),
	scoringHarness.context,
);
check("current full settings save succeeds", currentFullSave.success && currentFullSave.settings.values.organizationName === "Current publisher");
check("current full settings save returns a new revision", currentFullSave.success && currentFullSave.settings.revision !== afterStaleFullSave.revision);

let injectedFullSaveEdit = false;
scoringHarness.hooks.beforeWrite = (key) => {
	if (injectedFullSaveEdit) return;
	injectedFullSaveEdit = true;
	scoringHarness.write(key, { ...(scoringHarness.values.get(key) as Record<string, unknown>), noindex: true });
};
const racedFullSave = await handler("save-admin-settings")(
	route({ ...currentFullSave.settings.values, organizationName: "Overwriting publisher", expectedRevision: currentFullSave.settings.revision }),
	scoringHarness.context,
);
check("full settings save rejects a write race", !racedFullSave.success && racedFullSave.conflict === true);
const afterRacedFullSave = await handler("admin-settings")(route(), scoringHarness.context);
check("full settings save preserves the racing writer", afterRacedFullSave.values.noindex === true && afterRacedFullSave.values.organizationName === "Current publisher");
scoringHarness.hooks.beforeWrite = undefined;

// Scoring adoption keeps legacy and historical restrictions.
const legacyTrueScoring = createContext();
legacyTrueScoring.write("settings:noindex", true);
const legacyTrueChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, legacyTrueScoring.context),
	legacyTrueScoring.context,
);
check("scoring adoption keeps a legacy true", legacyTrueChange.success && (legacyTrueScoring.values.get(GLOBAL_KEY) as any).noindex === true);
const seedScoring = createContext({ legacy: false });
seedScoring.write(GLOBAL_KEY, HISTORICAL_SEED);
const seedScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, seedScoring.context),
	seedScoring.context,
);
check("scoring on the historical seed materializes true", seedScoringChange.success && (seedScoring.values.get(GLOBAL_KEY) as any).noindex === true);
const confirmedScoring = createContext({ legacy: false });
confirmedScoring.write(GLOBAL_KEY, { ...HISTORICAL_SEED, contentScoringEnabled: false, indexingPreferenceConfirmed: true });
const confirmedScoringChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: true, expectedContentScoringEnabled: false }, confirmedScoring.context),
	confirmedScoring.context,
);
check("scoring keeps the confirmation marker and false", confirmedScoringChange.success && (confirmedScoring.values.get(GLOBAL_KEY) as any).indexingPreferenceConfirmed === true && confirmedScoringChange.settings.values.noindex === false);
const unconfirmedFalse = createContext({ legacy: false });
unconfirmedFalse.write(GLOBAL_KEY, { ...HISTORICAL_SEED, contentScoringEnabled: false });
check("a scoring-off branded false is not the seed", (await handler("admin-settings")(route(), unconfirmedFalse.context)).state === "saved");
const unconfirmedFalseChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: true, expectedContentScoringEnabled: false }, unconfirmedFalse.context),
	unconfirmedFalse.context,
);
check("enabling scoring cannot turn a saved false into the seed", unconfirmedFalseChange.success && unconfirmedFalseChange.settings.values.noindex === false && (await handler("admin-settings")(route(), unconfirmedFalse.context)).values.noindex === false);

// Adoption preflight: a legacy change between the read and the create is a conflict.
const preflight = createContext();
let preflightReads = 0;
preflight.hooks.onRead = (key) => {
	if (key === "settings:noindex" && ++preflightReads === 1) preflight.write("settings:noindex", true);
};
const preflightChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, preflight.context),
	preflight.context,
);
check("scoring adoption rejects a legacy change before the create", !preflightChange.success && preflightChange.conflict === true && !preflight.values.has(GLOBAL_KEY));

// A failed absent create must not let a retry adopt legacy keys first seen later.
const retryRace = createContext();
let retryWrites = 0;
retryRace.hooks.beforeWrite = (key) => {
	// Another writer creates the record first, so this create fails.
	if (++retryWrites === 1) retryRace.write(key, { ...HISTORICAL_SEED, siteName: "Other", indexingPreferenceConfirmed: true });
};
const retryCas = retryRace.context.kv.compareAndSet as (key: string, expected: string | null, value: unknown) => Promise<any>;
retryRace.context.kv.compareAndSet = async (key: string, expected: string | null, value: unknown) => {
	const result = await retryCas(key, expected, value);
	if (retryWrites === 1 && !result.applied) {
		// The other writer then removes its record and changes the legacy keys.
		retryRace.remove(key);
		retryRace.write("settings:noindex", true);
	}
	return result;
};
const retryChange = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, retryRace.context),
	retryRace.context,
);
check("a retry after a failed create rejects changed legacy state", !retryChange.success && retryChange.conflict === true && !retryRace.values.has(GLOBAL_KEY));
check("the changed legacy restriction is untouched", retryRace.values.get("settings:noindex") === true);

const noCasFullSave = await handler("save-admin-settings")(
	route({ ...fresh.values, expectedRevision: null, expectedLegacyGuard: fresh.legacyGuard }),
	noCasHarness.context,
);
check("revision-fenced full save fails closed without conditional storage", !noCasFullSave.success && noCasHarness.setCount === 0);

// Existing settings writers keep the archive policy under the same record revision.
const archiveValidated = validateSeoAdminSettings({ ...validInput, taxonomyArchiveNoindex: ["tag", "category", "tag"] });
check("full validation canonicalizes an explicit archive selection", archiveValidated.success &&
	JSON.stringify(archiveValidated.values.taxonomyArchiveNoindex) === JSON.stringify(["category", "tag"]));
const oldArchiveInput = validateSeoAdminSettings(validInput);
check("old clients omit archive policy without acquiring a preference", oldArchiveInput.success &&
	!Object.hasOwn(oldArchiveInput.values, "taxonomyArchiveNoindex"));
for (const taxonomyArchiveNoindex of [undefined, null, "category", ["a/b"], Array(101).fill("category")]) {
	const invalidArchiveInput = validateSeoAdminSettings({ ...validInput, taxonomyArchiveNoindex });
	check("invalid explicit archive policy is a field error", !invalidArchiveInput.success && Boolean(invalidArchiveInput.errors.taxonomyArchiveNoindex));
}
const archiveHarness = createContext({ legacy: false });
archiveHarness.write(GLOBAL_KEY, {
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-01T00:00:00.000Z",
	...fresh.values, siteName: "Archive site", noindex: true, contentScoringEnabled: false,
	customVerificationTags: [{ name: "yandex-verification", content: "preserved-code" }],
	taxonomyArchiveNoindex: ["category", "custom_type"], indexingPreferenceConfirmed: true,
});
const archiveLoaded = await handler("admin-settings")(route(), archiveHarness.context);
const archiveOldClientValues = { ...archiveLoaded.values };
delete archiveOldClientValues.taxonomyArchiveNoindex;
const archiveOmissionSave = await saveAdminSettingsIfCurrent(archiveHarness.context as any,
	{ ...archiveOldClientValues, siteName: "Renamed archive site" }, { expectedRevision: archiveLoaded.revision, expectedLegacyGuard: null });
check("an unrelated old-client save keeps archive policy with one conditional write", archiveOmissionSave.success &&
	JSON.stringify(archiveOmissionSave.settings.values?.taxonomyArchiveNoindex) === JSON.stringify(["category", "custom_type"]) &&
	archiveHarness.casCount === 1 && archiveHarness.setCount === 0);
check("archive preservation keeps global indexing and custom verification neighbors", archiveOmissionSave.success &&
	archiveOmissionSave.settings.values?.noindex === true && archiveOmissionSave.settings.values?.customVerificationTags?.[0]?.content === "preserved-code");
const archiveStaleClear = await saveAdminSettingsIfCurrent(archiveHarness.context as any,
	{ ...archiveOldClientValues, taxonomyArchiveNoindex: [] }, { expectedRevision: archiveLoaded.revision, expectedLegacyGuard: null });
check("a stale archive clear conflicts before writing", !archiveStaleClear.success && archiveStaleClear.conflict === true && archiveHarness.casCount === 1);
const archiveCurrent = await handler("admin-settings")(route(), archiveHarness.context);
const archiveClear = await saveAdminSettingsIfCurrent(archiveHarness.context as any,
	{ ...archiveCurrent.values, taxonomyArchiveNoindex: [] }, { expectedRevision: archiveCurrent.revision, expectedLegacyGuard: null });
check("an explicit empty list clears only the archive restriction", archiveClear.success &&
	Object.hasOwn(archiveClear.settings.values!, "taxonomyArchiveNoindex") && archiveClear.settings.values?.taxonomyArchiveNoindex?.length === 0 &&
	archiveClear.settings.values?.noindex === true);
archiveHarness.write(GLOBAL_KEY, { ...(archiveHarness.values.get(GLOBAL_KEY) as Record<string, unknown>), taxonomyArchiveNoindex: ["category", "custom_type"] });
const archiveBeforeTags = await handler("admin-settings")(route(), archiveHarness.context);
const archiveTags = await handler("save-custom-verification-tags")(
	route({ tags: [], expectedRevision: archiveBeforeTags.revision }), archiveHarness.context);
check("narrow custom-tag save keeps archive restrictions and the global marker", archiveTags.success &&
	JSON.stringify(archiveTags.settings.values.taxonomyArchiveNoindex) === JSON.stringify(["category", "custom_type"]) &&
	archiveTags.settings.values.noindex === true && archiveTags.settings.indexingPreferenceConfirmed === true);
const archiveScoring = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: true, expectedContentScoringEnabled: false }, archiveHarness.context), archiveHarness.context);
check("scoring activation keeps the archive policy", archiveScoring.success &&
	JSON.stringify(archiveScoring.settings.values.taxonomyArchiveNoindex) === JSON.stringify(["category", "custom_type"]) &&
	archiveScoring.settings.values.noindex === true);
const archiveBeforeReset = await handler("admin-settings")(route(), archiveHarness.context);
const archiveReset = await resetAdminSettings(archiveHarness.context as any, archiveBeforeReset.revision);
check("restoring inherited website values preserves archive and global indexing choices", archiveReset.success &&
	archiveReset.settings.values?.siteName === "Host Site" && archiveReset.settings.values?.noindex === true &&
	JSON.stringify(archiveReset.settings.values?.taxonomyArchiveNoindex) === JSON.stringify(["category", "custom_type"]));
check("restoring website values preserves scoring acknowledgement", archiveReset.success &&
	(archiveHarness.values.get(GLOBAL_KEY) as any).contentScoringResourceNoticeVersion === 1);
const archiveBeforeRace = await handler("admin-settings")(route(), archiveHarness.context);
archiveHarness.hooks.beforeWrite = (key) => {
	archiveHarness.hooks.beforeWrite = undefined;
	archiveHarness.write(key, { ...(archiveHarness.values.get(key) as Record<string, unknown>), taxonomyArchiveNoindex: ["tag"] });
};
const archiveRace = await saveAdminSettingsIfCurrent(archiveHarness.context as any,
	{ ...archiveBeforeRace.values, taxonomyArchiveNoindex: [] }, { expectedRevision: archiveBeforeRace.revision, expectedLegacyGuard: null });
check("a competing archive update wins over an in-flight clear", !archiveRace.success && archiveRace.conflict === true &&
	JSON.stringify((archiveHarness.values.get(GLOBAL_KEY) as any).taxonomyArchiveNoindex) === JSON.stringify(["tag"]));

const archiveSeedHarness = createContext({ legacy: false });
archiveSeedHarness.write(GLOBAL_KEY, { ...HISTORICAL_SEED, taxonomyArchiveNoindex: ["category"] });
const archiveSeedRead = await readAdminSettings(archiveSeedHarness.context as any);
check("publisher-only historical reads retain archive policy and effective global noindex", archiveSeedRead.values.noindex === true &&
	JSON.stringify(archiveSeedRead.values.taxonomyArchiveNoindex) === JSON.stringify(["category"]));
const archiveSeedLoaded = await handler("admin-settings")(route(), archiveSeedHarness.context);
const archiveSeedTags = await handler("save-custom-verification-tags")(
	route({ tags: [], expectedRevision: archiveSeedLoaded.revision }), archiveSeedHarness.context);
check("narrow adoption of a historical seed preserves both indexing restrictions", archiveSeedTags.success &&
	archiveSeedTags.settings.values.noindex === true && JSON.stringify(archiveSeedTags.settings.values.taxonomyArchiveNoindex) === JSON.stringify(["category"]));
const archiveAckHarness = createContext({ legacy: false });
archiveAckHarness.write(GLOBAL_KEY, structuredClone(archiveHarness.values.get(GLOBAL_KEY)));
const archiveAckLoaded = await handler("admin-settings")(route(), archiveAckHarness.context);
const archiveRealCas = archiveAckHarness.context.kv.compareAndSet as (key: string, expected: string | null, value: unknown) => Promise<unknown>;
archiveAckHarness.context.kv.compareAndSet = async (key: string, expected: string | null, value: unknown) => {
	await archiveRealCas(key, expected, value);
	return undefined;
};
let archiveAcknowledgementRejected = false;
try {
	await saveAdminSettingsIfCurrent(archiveAckHarness.context as any,
		{ ...archiveAckLoaded.values, taxonomyArchiveNoindex: ["category"] }, { expectedRevision: archiveAckLoaded.revision, expectedLegacyGuard: null });
} catch {
	archiveAcknowledgementRejected = true;
}
const archiveAckReadback = await handler("admin-settings")(route(), archiveAckHarness.context);
check("a lost write acknowledgement needs an authoritative policy readback", archiveAcknowledgementRejected &&
	archiveAckHarness.casCount === 1 && archiveAckReadback.revision !== archiveAckLoaded.revision &&
	JSON.stringify(archiveAckReadback.values.taxonomyArchiveNoindex) === JSON.stringify(["category"]) && archiveAckReadback.values.noindex === true);
const archiveAckReplay = await saveAdminSettingsIfCurrent(archiveAckHarness.context as any,
	{ ...archiveAckLoaded.values, taxonomyArchiveNoindex: [] }, { expectedRevision: archiveAckLoaded.revision, expectedLegacyGuard: null });
check("the pre-acknowledgement guard cannot replay over the accepted policy", !archiveAckReplay.success &&
	archiveAckReplay.conflict === true && archiveAckHarness.casCount === 1);

// A stale owner receives a conflict before retained choices become new additions.
const staleArchiveHarness = createContext({ legacy: false });
staleArchiveHarness.write(GLOBAL_KEY, {
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-01T00:00:00.000Z",
	...fresh.values, taxonomyArchiveNoindex: ["deletedold"], indexingPreferenceConfirmed: true,
});
let staleArchiveDefinitionReads = 0;
let staleArchiveDefinitionsUnavailable = false;
let staleArchiveDefinitionHook: (() => void) | undefined;
const staleArchiveContext = {
	...staleArchiveHarness.context,
	taxonomies: { getAll: async () => {
		staleArchiveDefinitionReads += 1;
		if (staleArchiveDefinitionsUnavailable) throw new Error("taxonomy definitions unavailable");
		staleArchiveDefinitionHook?.();
		return [{ name: "category", label: "Categories" }];
	} },
};
const staleArchiveLoaded = await handler("admin-settings")(route(), staleArchiveContext);
staleArchiveHarness.write(GLOBAL_KEY, {
	...(staleArchiveHarness.values.get(GLOBAL_KEY) as Record<string, unknown>), taxonomyArchiveNoindex: [],
});
for (const unavailable of [false, true]) {
	staleArchiveDefinitionsUnavailable = unavailable;
	const staleArchiveRetained = await handler("save-admin-settings")(
		route({ ...staleArchiveLoaded.values, expectedRevision: staleArchiveLoaded.revision }), staleArchiveContext);
	check(unavailable ? "unavailable taxonomy definitions do not mask a stale settings conflict" : "a stale retained deleted taxonomy reports the settings conflict",
		!staleArchiveRetained.success && staleArchiveRetained.conflict === true &&
		typeof staleArchiveRetained.errors._form === "string" && !staleArchiveRetained.errors.taxonomyArchiveNoindex);
}
check("stale archive saves never query taxonomy definitions or attempt a write", staleArchiveDefinitionReads === 0 &&
	staleArchiveHarness.casCount === 0 && staleArchiveHarness.setCount === 0 &&
	JSON.stringify((staleArchiveHarness.values.get(GLOBAL_KEY) as any).taxonomyArchiveNoindex) === "[]");
const staleLegacyArchiveHarness = createContext();
const staleLegacyArchiveLoaded = await handler("admin-settings")(route(), staleLegacyArchiveHarness.context);
staleLegacyArchiveHarness.write("settings:noindex", true);
let staleLegacyDefinitionReads = 0;
const staleLegacyArchiveContext = {
	...staleLegacyArchiveHarness.context,
	taxonomies: { getAll: async () => { staleLegacyDefinitionReads += 1; throw new Error("taxonomy definitions unavailable"); } },
};
const staleLegacyArchiveSave = await handler("save-admin-settings")(
	route({ ...staleLegacyArchiveLoaded.values, taxonomyArchiveNoindex: ["category"], ...loadedGuard(staleLegacyArchiveLoaded) }),
	staleLegacyArchiveContext);
check("a stale legacy guard conflicts before new archive choices are checked", !staleLegacyArchiveSave.success &&
	staleLegacyArchiveSave.conflict === true && typeof staleLegacyArchiveSave.errors._form === "string" &&
	!staleLegacyArchiveSave.errors.taxonomyArchiveNoindex && staleLegacyDefinitionReads === 0 &&
	staleLegacyArchiveHarness.casCount === 0 && !staleLegacyArchiveHarness.values.has(GLOBAL_KEY));
staleArchiveDefinitionsUnavailable = false;
const archiveBeforeDefinitionRace = await handler("admin-settings")(route(), staleArchiveContext);
staleArchiveDefinitionHook = () => staleArchiveHarness.write(GLOBAL_KEY, {
	...(staleArchiveHarness.values.get(GLOBAL_KEY) as Record<string, unknown>), noindex: true,
});
const archiveDefinitionRace = await handler("save-admin-settings")(
	route({ ...archiveBeforeDefinitionRace.values, taxonomyArchiveNoindex: ["category"], expectedRevision: archiveBeforeDefinitionRace.revision }),
	staleArchiveContext);
check("the final CAS still rejects a settings write during taxonomy validation", !archiveDefinitionRace.success &&
	archiveDefinitionRace.conflict === true && staleArchiveDefinitionReads === 1 && staleArchiveHarness.casCount === 1 &&
	(staleArchiveHarness.values.get(GLOBAL_KEY) as any).noindex === true &&
	JSON.stringify((staleArchiveHarness.values.get(GLOBAL_KEY) as any).taxonomyArchiveNoindex) === "[]");

// Content type rules: an additive list in the same record, kept by every narrower writer.
const typeValidated = validateSeoAdminSettings({ ...validInput, contentTypeNoindex: ["posts", "events", "posts"] });
check("full validation canonicalizes an explicit content type rule list", typeValidated.success &&
	JSON.stringify(typeValidated.values.contentTypeNoindex) === JSON.stringify(["events", "posts"]));
check("old clients omit content type rules without acquiring one", oldArchiveInput.success &&
	!Object.hasOwn(oldArchiveInput.values, "contentTypeNoindex"));
for (const contentTypeNoindex of [undefined, null, "posts", ["Posts"], ["a/b"], ["9posts"], Array(101).fill("posts")]) {
	const invalidTypeInput = validateSeoAdminSettings({ ...validInput, contentTypeNoindex });
	check("invalid explicit content type rules are a field error", !invalidTypeInput.success && Boolean(invalidTypeInput.errors.contentTypeNoindex));
}
let typeDefinitionReads = 0;
let typeDefinitionsUnavailable = false;
const typeHarness = createContext({ legacy: false });
const typeContext = () => ({
	...typeHarness.context,
	// A fresh discovery object per request, as hosts create one per invocation.
	schema: { listCollections: async () => {
		typeDefinitionReads += 1;
		if (typeDefinitionsUnavailable) throw new Error("collections unavailable");
		return [{ slug: "pages", label: "Pages" }, { slug: "posts", label: "Posts" }];
	} },
});
typeHarness.write(GLOBAL_KEY, {
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-01T00:00:00.000Z",
	...fresh.values, noindex: false, customVerificationTags: [{ name: "yandex-verification", content: "kept" }],
	taxonomyArchiveNoindex: ["category"], contentTypeNoindex: ["retired"], indexingPreferenceConfirmed: true,
});
const typeLoaded = await handler("admin-settings")(route(), typeContext());
check("a stored rule list reads back exactly", JSON.stringify(typeLoaded.values.contentTypeNoindex) === JSON.stringify(["retired"]));
const typeAdd = await handler("save-admin-settings")(
	route({ ...typeLoaded.values, contentTypeNoindex: ["posts", "retired"], expectedRevision: typeLoaded.revision }), typeContext());
check("adding a current content type keeps a removed type's retained rule", typeAdd.success &&
	JSON.stringify(typeAdd.settings.values.contentTypeNoindex) === JSON.stringify(["posts", "retired"]) && typeDefinitionReads === 1);
check("a rule save keeps archive, verification and site-wide neighbours", typeAdd.success &&
	JSON.stringify(typeAdd.settings.values.taxonomyArchiveNoindex) === JSON.stringify(["category"]) &&
	typeAdd.settings.values.customVerificationTags?.[0]?.content === "kept" && typeAdd.settings.values.noindex === false);
const typeAfterAdd = await handler("admin-settings")(route(), typeContext());
const typeUnknown = await handler("save-admin-settings")(
	route({ ...typeAfterAdd.values, contentTypeNoindex: ["missing", "posts", "retired"], expectedRevision: typeAfterAdd.revision }), typeContext());
check("a new rule for a type that does not exist is refused without a write", !typeUnknown.success &&
	typeof typeUnknown.errors.contentTypeNoindex === "string" && typeHarness.casCount === 1);
typeDefinitionsUnavailable = true;
const typeUnavailable = await handler("save-admin-settings")(
	route({ ...typeAfterAdd.values, contentTypeNoindex: ["pages", "posts", "retired"], expectedRevision: typeAfterAdd.revision }), typeContext());
check("unlisted content types refuse a new rule instead of guessing", !typeUnavailable.success &&
	/could not be checked/.test(typeUnavailable.errors.contentTypeNoindex ?? "") && typeHarness.casCount === 1);
const typeReadsBeforeRemoval = typeDefinitionReads;
const typeRemoval = await handler("save-admin-settings")(
	route({ ...typeAfterAdd.values, contentTypeNoindex: ["posts"], expectedRevision: typeAfterAdd.revision }), typeContext());
check("removing a retained rule needs no content type listing", typeRemoval.success &&
	JSON.stringify(typeRemoval.settings.values.contentTypeNoindex) === JSON.stringify(["posts"]) && typeDefinitionReads === typeReadsBeforeRemoval);
typeDefinitionsUnavailable = false;
const typeBeforeOmission = await handler("admin-settings")(route(), typeContext());
const typeOldClientValues = { ...typeBeforeOmission.values };
delete typeOldClientValues.contentTypeNoindex;
const typeOmission = await saveAdminSettingsIfCurrent(typeHarness.context as any,
	{ ...typeOldClientValues, siteName: "Renamed" }, { expectedRevision: typeBeforeOmission.revision, expectedLegacyGuard: null });
check("a save from a client without the field keeps the stored rules", typeOmission.success &&
	JSON.stringify(typeOmission.settings.values?.contentTypeNoindex) === JSON.stringify(["posts"]));
const typeBeforeTags = await handler("admin-settings")(route(), typeContext());
const typeTags = await handler("save-custom-verification-tags")(route({ tags: [], expectedRevision: typeBeforeTags.revision }), typeContext());
check("a custom-tag save keeps the rules", typeTags.success && JSON.stringify(typeTags.settings.values.contentTypeNoindex) === JSON.stringify(["posts"]));
const typeScoring = await handler("save-content-scoring")(
	await acknowledgedScoringRoute({ contentScoringEnabled: false, expectedContentScoringEnabled: true }, typeContext()), typeContext());
check("a scoring change keeps the rules", typeScoring.success && JSON.stringify(typeScoring.settings.values.contentTypeNoindex) === JSON.stringify(["posts"]));
const typeBeforeReset = await handler("admin-settings")(route(), typeContext());
const typeReset = await resetAdminSettings(typeHarness.context as any, typeBeforeReset.revision);
check("restoring inherited website values keeps the rules", typeReset.success &&
	JSON.stringify(typeReset.settings.values?.contentTypeNoindex) === JSON.stringify(["posts"]) && typeReset.settings.values?.siteName === "Host Site");
const typeBeforeRace = await handler("admin-settings")(route(), typeContext());
typeHarness.hooks.beforeWrite = (key) => {
	typeHarness.hooks.beforeWrite = undefined;
	typeHarness.write(key, { ...(typeHarness.values.get(key) as Record<string, unknown>), contentTypeNoindex: ["pages"] });
};
const typeRace = await saveAdminSettingsIfCurrent(typeHarness.context as any,
	{ ...typeBeforeRace.values, contentTypeNoindex: [] }, { expectedRevision: typeBeforeRace.revision, expectedLegacyGuard: null });
check("the revision guard keeps a competing rule update", !typeRace.success && typeRace.conflict === true &&
	JSON.stringify((typeHarness.values.get(GLOBAL_KEY) as any).contentTypeNoindex) === JSON.stringify(["pages"]));
const typeSeed = createContext({ legacy: false });
typeSeed.write(GLOBAL_KEY, { ...HISTORICAL_SEED, contentTypeNoindex: ["posts"] });
const typeSeedRead = await readAdminSettings(typeSeed.context as any);
check("a historical seed keeps its content type rules", typeSeedRead.values.noindex === true &&
	JSON.stringify(typeSeedRead.values.contentTypeNoindex) === JSON.stringify(["posts"]));
for (const malformed of [["posts", "pages"], ["posts", "posts"], ["Posts"], "posts", null]) {
	const corruptHarness = createContext({ legacy: false });
	corruptHarness.write(GLOBAL_KEY, { ...HISTORICAL_SEED, indexingPreferenceConfirmed: true, contentTypeNoindex: malformed });
	const corruptRead = await handler("admin-settings")(route(), corruptHarness.context);
	check("a malformed stored rule list makes the record corrupt instead of guessed", corruptRead.state === "corrupt" && corruptRead.values === null);
}

// The scoring policy is one versioned read: absent settings need confirmation,
// and a record that cannot be read or parsed admits no analysis.
const policyContext = (getVersioned: unknown) => ({ kv: { getVersioned }, log: { warn() {} } }) as any;
const storedPolicy = (value: unknown) => policyContext(async () => ({ value, revision: "r7" }));
const scoringRecord = { ...HISTORICAL_SEED, siteName: "Policy Site", socialProfiles: [] };
const policies = {
	absent: await readContentScoringPolicy(policyContext(async () => null)),
	inherited: await readContentScoringPolicy(storedPolicy(scoringRecord)),
	enabled: await readContentScoringPolicy(storedPolicy({ ...scoringRecord, contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1 })),
	disabled: await readContentScoringPolicy(storedPolicy({ ...scoringRecord, contentScoringEnabled: false })),
	corrupt: await readContentScoringPolicy(storedPolicy({ version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, contentScoringEnabled: false })),
	envelope: await readContentScoringPolicy(policyContext(async () => ({ value: scoringRecord }))),
	unreadable: await readContentScoringPolicy(policyContext(async () => { throw new Error("database is locked"); })),
	unsupported: await readContentScoringPolicy({ kv: { get: async () => null } } as any),
};
check("absent settings require confirmation with no revision", policies.absent.state === "pending-confirmation" && policies.absent.revision === null);
check("a stored record without acknowledgement requires confirmation", policies.inherited.state === "pending-confirmation" && policies.inherited.revision === "r7");
check("an acknowledged enabled switch keeps its revision", policies.enabled.state === "enabled" && policies.enabled.revision === "r7");
check("an explicit pause keeps its revision", policies.disabled.state === "paused" && policies.disabled.revision === "r7");
check("a corrupt record that says off is unavailable, never enabled", JSON.stringify(policies.corrupt) === JSON.stringify({ state: "unavailable", reason: "corrupt" }));
check("an envelope without a revision is unreadable", JSON.stringify(policies.envelope) === JSON.stringify({ state: "unavailable", reason: "unreadable" }));
check("a failed read is unreadable", JSON.stringify(policies.unreadable) === JSON.stringify({ state: "unavailable", reason: "unreadable" }));
check("a host without versioned reads is unreadable", JSON.stringify(policies.unsupported) === JSON.stringify({ state: "unavailable", reason: "unreadable" }));

if (failures) {
	console.error(`\n${failures} SEO settings self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nALL SEO SETTINGS CHECKS PASSED");
}
