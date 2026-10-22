import {
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
	type SeoAdminContentScoringPolicy,
	type SeoAdminSettingsValues,
} from "./admin-contract.ts";
import { isStoredCustomVerificationTags } from "./custom-verification-tags.ts";
import { isStoredTaxonomyArchiveNoindex } from "./taxonomy-archive-policy.ts";
import { isStoredContentTypeNoindex } from "./content-type-noindex-policy.ts";

/**
 * Classification of the stored global settings. No storage, React or Node
 * access: callers read the records with versioned reads and pass them in, so
 * native and sandboxed runtimes reach the same indexing decision.
 */

export const LEGACY_SETTINGS_KEYS = [
	"settings:siteName",
	"settings:siteUrl",
	"settings:orgName",
	"settings:orgLogo",
	"settings:sameAs",
	"settings:defaultOgImage",
	"settings:twitterHandle",
	"settings:noindex",
] as const;
export type LegacySettingsKey = (typeof LEGACY_SETTINGS_KEYS)[number];

/** The legacy keys that decide the indexing preference and the site URL. */
export const INDEXING_LEGACY_SETTINGS_KEYS = ["settings:siteUrl", "settings:noindex"] as const satisfies readonly LegacySettingsKey[];

export interface StoredSeoAdminSettings extends Omit<SeoAdminSettingsValues, "publisherType" | "personName" | "personProfiles" | "contentScoringEnabled"> {
	version: typeof SEO_ADMIN_SETTINGS_STORAGE_VERSION;
	updatedAt: string;
	publisherType?: SeoAdminSettingsValues["publisherType"];
	personName?: string;
	personProfiles?: string[];
	contentScoringEnabled?: boolean;
	/** Server-owned acknowledgement; saved intent alone never admits analysis. */
	contentScoringResourceNoticeVersion?: number;
	/**
	 * Server-owned. Only `true` is valid: the stored `noindex` is the owner's
	 * preference and the record is never read as the historical seed.
	 */
	indexingPreferenceConfirmed?: true;
}

/** A versioned read: `null` when the key is absent. */
export type VersionedSettingsEntry = { value: unknown; revision: string } | null;
export type LegacySettingsEntries = Partial<Record<LegacySettingsKey, VersionedSettingsEntry>>;

export interface SiteSettingsDefaults {
	siteName: string;
	siteUrl: string;
}

export type ReadableSiteSettings =
	| {
		state: "saved" | "historical-seed";
		revision: string;
		updatedAt: string | null;
		values: SeoAdminSettingsValues;
		record: StoredSeoAdminSettings;
		confirmed: boolean;
	}
	| {
		state: "absent" | "legacy";
		revision: null;
		updatedAt: null;
		values: SeoAdminSettingsValues;
		legacy: LegacySettingsEntries;
		legacyPresent: boolean;
	};

export type SiteSettingsSnapshot =
	| ReadableSiteSettings
	| { state: "corrupt"; revision: string | null }
	| { state: "unavailable" };

// SHA-256 of [siteName, organizationName, socialProfiles] in the settings an
// early alpha seeded on install. Matching unconfirmed records keep the
// effective site-wide noindex that early alpha applied to them.
const HISTORICAL_SEED_FINGERPRINT = "03098bf32fc81a65c343862e6899c66958ff1fb0757e37e5a1005a02e69f20b1";

export function validSettingsRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/** A host snapshot must carry its own `value` and a usable revision. */
export function validVersionedEnvelope(snapshot: unknown): snapshot is { value: unknown; revision: string } {
	return Boolean(snapshot) && typeof snapshot === "object" && !Array.isArray(snapshot) &&
		Object.hasOwn(snapshot as object, "value") &&
		validSettingsRevision((snapshot as { revision?: unknown }).revision);
}

export function parseStoredSettings(value: unknown): StoredSeoAdminSettings | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredSeoAdminSettings> & { indexingPreferenceConfirmed?: unknown };
	if (
		candidate.version !== SEO_ADMIN_SETTINGS_STORAGE_VERSION ||
		typeof candidate.updatedAt !== "string" ||
		(Object.hasOwn(candidate, "indexingPreferenceConfirmed") && candidate.indexingPreferenceConfirmed !== true)
	)
		return null;
	if (
		typeof candidate.siteName !== "string" ||
		typeof candidate.siteUrl !== "string" ||
		typeof candidate.organizationName !== "string" ||
		typeof candidate.organizationLogo !== "string" ||
		(candidate.publisherType !== undefined && candidate.publisherType !== "organization" && candidate.publisherType !== "person") ||
		(candidate.personName !== undefined && typeof candidate.personName !== "string") ||
		!Array.isArray(candidate.socialProfiles) ||
		!candidate.socialProfiles.every((item) => typeof item === "string") ||
		(candidate.personProfiles !== undefined &&
			(!Array.isArray(candidate.personProfiles) || !candidate.personProfiles.every((item) => typeof item === "string"))) ||
		typeof candidate.defaultSocialImage !== "string" ||
		typeof candidate.twitterHandle !== "string" ||
		typeof candidate.noindex !== "boolean" ||
		(candidate.contentScoringEnabled !== undefined && typeof candidate.contentScoringEnabled !== "boolean") ||
		(Object.hasOwn(candidate, "customVerificationTags") && !isStoredCustomVerificationTags(candidate.customVerificationTags)) ||
		(Object.hasOwn(candidate, "taxonomyArchiveNoindex") && !isStoredTaxonomyArchiveNoindex(candidate.taxonomyArchiveNoindex)) ||
		(Object.hasOwn(candidate, "contentTypeNoindex") && !isStoredContentTypeNoindex(candidate.contentTypeNoindex))
	)
		return null;
	return candidate as StoredSeoAdminSettings;
}

export function storedSettingsValues(stored: StoredSeoAdminSettings): SeoAdminSettingsValues {
	return {
		siteName: stored.siteName,
		siteUrl: stored.siteUrl,
		publisherType: stored.publisherType ?? "organization",
		organizationName: stored.organizationName,
		organizationLogo: stored.organizationLogo,
		personName: stored.personName ?? "",
		socialProfiles: [...stored.socialProfiles],
		personProfiles: [...(stored.personProfiles ?? [])],
		defaultSocialImage: stored.defaultSocialImage,
		twitterHandle: stored.twitterHandle,
		noindex: stored.noindex,
		contentScoringEnabled: stored.contentScoringEnabled ?? true,
		...(stored.customVerificationTags === undefined ? {} : { customVerificationTags: stored.customVerificationTags.map((tag) => ({ ...tag })) }),
		...(stored.taxonomyArchiveNoindex === undefined ? {} : { taxonomyArchiveNoindex: [...stored.taxonomyArchiveNoindex] }),
		...(stored.contentTypeNoindex === undefined ? {} : { contentTypeNoindex: [...stored.contentTypeNoindex] }),
	};
}

/** Host-derived values with no owner preference: no plugin restriction. */
export function defaultSettingsValues(site: SiteSettingsDefaults): SeoAdminSettingsValues {
	return {
		siteName: site.siteName,
		siteUrl: site.siteUrl,
		publisherType: "organization",
		organizationName: site.siteName,
		organizationLogo: "",
		personName: "",
		socialProfiles: [],
		personProfiles: [],
		defaultSocialImage: "",
		twitterHandle: "",
		noindex: false,
		contentScoringEnabled: true,
	};
}

/** What the exact historical seed means today: host values and site-wide noindex. */
export function historicalSeedValues(
	site: SiteSettingsDefaults,
	customVerificationTags?: SeoAdminSettingsValues["customVerificationTags"],
	taxonomyArchiveNoindex?: SeoAdminSettingsValues["taxonomyArchiveNoindex"],
	contentTypeNoindex?: SeoAdminSettingsValues["contentTypeNoindex"],
): SeoAdminSettingsValues {
	return {
		...defaultSettingsValues(site), noindex: true,
		...(customVerificationTags === undefined ? {} : { customVerificationTags: customVerificationTags.map((tag) => ({ ...tag })) }),
		...(taxonomyArchiveNoindex === undefined ? {} : { taxonomyArchiveNoindex: [...taxonomyArchiveNoindex] }),
		...(contentTypeNoindex === undefined ? {} : { contentTypeNoindex: [...contentTypeNoindex] }),
	};
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function isHistoricalSeed(stored: StoredSeoAdminSettings): Promise<boolean> {
	if (
		stored.indexingPreferenceConfirmed === true ||
		stored.publisherType === "person" ||
		stored.personName ||
		stored.personProfiles?.length ||
		stored.siteUrl !== "" ||
		stored.organizationLogo !== "" ||
		stored.defaultSocialImage !== "" ||
		stored.twitterHandle !== "" ||
		stored.noindex !== false ||
		stored.contentScoringEnabled === false ||
		!Array.isArray(stored.socialProfiles)
	)
		return false;
	const payload = JSON.stringify([stored.siteName, stored.organizationName, stored.socialProfiles]);
	return (await sha256Hex(payload)) === HISTORICAL_SEED_FINGERPRINT;
}

/**
 * Every record this version writes must classify to the `noindex` it holds.
 * A record that would match the historical fingerprint gets the marker, so
 * its `false` is not read as the seed's inherited restriction.
 */
export async function withoutHistoricalSeedAmbiguity(record: StoredSeoAdminSettings): Promise<StoredSeoAdminSettings> {
	return await isHistoricalSeed(record) ? { ...record, indexingPreferenceConfirmed: true } : record;
}

/**
 * Presence and revision of every legacy key, as loaded. Equal guards mean no
 * legacy key was created, removed or rewritten between the two reads.
 */
export async function legacySettingsGuard(legacy: LegacySettingsEntries): Promise<string> {
	const payload = JSON.stringify(LEGACY_SETTINGS_KEYS.map((key) => [key, legacy[key]?.revision ?? null]));
	return `legacy-v1:${await sha256Hex(payload)}`;
}

const LEGACY_TEXT_KEYS = [
	"settings:siteName",
	"settings:orgName",
	"settings:orgLogo",
	"settings:defaultOgImage",
	"settings:twitterHandle",
] as const satisfies readonly LegacySettingsKey[];

function legacyText(entry: VersionedSettingsEntry | undefined): string | undefined {
	return (entry?.value as string | null | undefined)?.trim();
}

/**
 * The single indexing decision. A present global record is authoritative and
 * never falls through to legacy keys. While it is absent, a legacy Boolean is
 * kept exactly and its absence means no plugin restriction.
 */
export async function classifySiteSettings(input: {
	site: SiteSettingsDefaults;
	global: VersionedSettingsEntry;
	legacy?: LegacySettingsEntries;
}): Promise<SiteSettingsSnapshot> {
	const { site, global } = input;
	if (global !== null) {
		if (!validVersionedEnvelope(global)) return { state: "unavailable" };
		const record = parseStoredSettings(global.value);
		if (!record) return { state: "corrupt", revision: global.revision };
		if (await isHistoricalSeed(record)) {
			return {
				state: "historical-seed",
				revision: global.revision,
				updatedAt: null,
				values: historicalSeedValues(site, record.customVerificationTags, record.taxonomyArchiveNoindex, record.contentTypeNoindex),
				record,
				confirmed: false,
			};
		}
		return {
			state: "saved",
			revision: global.revision,
			updatedAt: record.updatedAt,
			values: storedSettingsValues(record),
			record,
			confirmed: record.indexingPreferenceConfirmed === true,
		};
	}
	const legacy = input.legacy ?? {};
	for (const entry of Object.values(legacy)) {
		if (entry !== null && !validVersionedEnvelope(entry)) return { state: "unavailable" };
	}
	const noindexEntry = legacy["settings:noindex"] ?? null;
	const siteUrlEntry = legacy["settings:siteUrl"] ?? null;
	// A stored null for the other text keys has always meant "not set".
	if ((noindexEntry !== null && typeof noindexEntry.value !== "boolean") ||
		(siteUrlEntry !== null && typeof siteUrlEntry.value !== "string") ||
		LEGACY_TEXT_KEYS.some((key) => {
			const value = legacy[key]?.value;
			return value !== undefined && value !== null && typeof value !== "string";
		})) {
		return { state: "corrupt", revision: null };
	}
	const defaults = defaultSettingsValues(site);
	const siteName = legacyText(legacy["settings:siteName"]) || defaults.siteName;
	const sameAs = legacy["settings:sameAs"]?.value;
	const values: SeoAdminSettingsValues = {
		siteName,
		siteUrl: (siteUrlEntry?.value as string | undefined)?.trim() || defaults.siteUrl,
		publisherType: "organization",
		organizationName: legacyText(legacy["settings:orgName"]) || siteName,
		organizationLogo: (legacy["settings:orgLogo"]?.value as string | null | undefined) ?? "",
		personName: "",
		socialProfiles: Array.isArray(sameAs) ? sameAs.filter((item): item is string => typeof item === "string") : [],
		personProfiles: [],
		defaultSocialImage: (legacy["settings:defaultOgImage"]?.value as string | null | undefined) ?? "",
		twitterHandle: (legacy["settings:twitterHandle"]?.value as string | null | undefined) ?? "",
		noindex: noindexEntry ? noindexEntry.value as boolean : false,
		contentScoringEnabled: true,
	};
	return {
		state: noindexEntry ? "legacy" : "absent",
		revision: null,
		updatedAt: null,
		values,
		legacy,
		legacyPresent: Object.values(legacy).some((entry) => entry !== null && entry !== undefined),
	};
}

export { CONTENT_SCORING_RESOURCE_NOTICE_VERSION } from "./admin-contract.ts";

export function classifyContentScoringPolicy(
	record: StoredSeoAdminSettings | null,
	revision: string | null,
): SeoAdminContentScoringPolicy {
	const intentEnabled = record?.contentScoringEnabled ?? true;
	const rawVersion: unknown = record?.contentScoringResourceNoticeVersion;
	const acknowledgedNoticeVersion = typeof rawVersion === "number" && Number.isSafeInteger(rawVersion) && rawVersion > 0
		? rawVersion : null;
	if (intentEnabled && rawVersion !== undefined && acknowledgedNoticeVersion === null)
		return { state: "unavailable", reason: "corrupt" };
	return {
		state: !intentEnabled ? "paused" : acknowledgedNoticeVersion === CONTENT_SCORING_RESOURCE_NOTICE_VERSION ? "enabled" : "pending-confirmation",
		revision,
		intentEnabled,
		acknowledgedNoticeVersion,
		currentNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
	};
}

export function contentScoringPolicyForSnapshot(snapshot: SiteSettingsSnapshot): SeoAdminContentScoringPolicy {
	if (!isReadableSiteSettings(snapshot))
		return { state: "unavailable", reason: snapshot.state === "corrupt" ? "corrupt" : "unreadable" };
	return classifyContentScoringPolicy("record" in snapshot ? snapshot.record : null, snapshot.revision);
}

export function isReadableSiteSettings(snapshot: SiteSettingsSnapshot): snapshot is ReadableSiteSettings {
	return snapshot.state !== "corrupt" && snapshot.state !== "unavailable";
}
