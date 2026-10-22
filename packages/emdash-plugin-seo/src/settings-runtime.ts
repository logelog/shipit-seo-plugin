import type { PluginContext, PublicPageContext } from "emdash";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
	type SeoAdminContentScoringPolicy,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	validateSeoAdminSettingsWriteGuard,
	type SeoAdminContentScoringChange,
	type SeoAdminReadableSettings,
	type SeoAdminSettings,
	type SeoAdminSettingsSaveResult,
	type SeoAdminSettingsValues,
	type SeoAdminSettingsWriteGuard,
} from "./admin-contract.ts";
import type { GlobalSeoSettings } from "./lib.ts";
import { validateCustomVerificationTags, type CustomVerificationTag } from "./custom-verification-tags.ts";
import {
	INDEXING_LEGACY_SETTINGS_KEYS,
	LEGACY_SETTINGS_KEYS,
	classifySiteSettings,
	classifyContentScoringPolicy,
	contentScoringPolicyForSnapshot,
	defaultSettingsValues,
	historicalSeedValues,
	isHistoricalSeed,
	isReadableSiteSettings,
	legacySettingsGuard,
	parseStoredSettings,
	storedSettingsValues,
	validSettingsRevision,
	validVersionedEnvelope,
	withoutHistoricalSeedAmbiguity,
	type LegacySettingsEntries,
	type LegacySettingsKey,
	type ReadableSiteSettings,
	type SiteSettingsDefaults,
	type SiteSettingsSnapshot,
	type StoredSeoAdminSettings,
	type VersionedSettingsEntry,
} from "./settings-state.ts";

export const GLOBAL_SETTINGS_KEY = `settings:global:v${SEO_ADMIN_SETTINGS_STORAGE_VERSION}`;

function inheritedSiteName(ctx: PluginContext): string {
	return ctx.site?.name?.trim() || "Website";
}

function inheritedSiteUrl(ctx: PluginContext): string {
	return ctx.site?.url?.trim() || "";
}

function siteDefaults(ctx: PluginContext): SiteSettingsDefaults {
	return { siteName: inheritedSiteName(ctx), siteUrl: inheritedSiteUrl(ctx) };
}

async function readLegacyEntries(
	ctx: PluginContext,
	keys: readonly LegacySettingsKey[],
): Promise<LegacySettingsEntries> {
	const entries = await Promise.all(keys.map((key) => ctx.kv.getVersioned<unknown>(key)));
	return Object.fromEntries(keys.map((key, index) => [key, entries[index] as VersionedSettingsEntry]));
}

/**
 * The global record, and only while it is absent the legacy keys of the
 * requested scope. `indexing` reads the two keys that decide noindex and the
 * site URL; `full` reads all eight for consumers that show or emit them.
 * Never writes.
 */
export async function readSiteSettings(
	ctx: PluginContext,
	scope: "full" | "indexing" = "full",
): Promise<SiteSettingsSnapshot> {
	if (typeof ctx.kv?.getVersioned !== "function") return { state: "unavailable" };
	try {
		const global = await ctx.kv.getVersioned<unknown>(GLOBAL_SETTINGS_KEY);
		const legacy = global === null
			? await readLegacyEntries(ctx, scope === "full" ? LEGACY_SETTINGS_KEYS : INDEXING_LEGACY_SETTINGS_KEYS)
			: undefined;
		return await classifySiteSettings({ site: siteDefaults(ctx), global: global as VersionedSettingsEntry, legacy });
	} catch (error) {
		ctx.log?.warn?.("seo: site settings could not be read", { error: String(error) });
		return { state: "unavailable" };
	}
}

export class SiteSettingsUnreadableError extends Error {
	readonly state: "corrupt" | "unavailable";

	constructor(state: "corrupt" | "unavailable") {
		super(state === "corrupt"
			? "Stored SEO settings are invalid. Restore them before this plugin can use them."
			: "SEO settings could not be read.");
		this.name = "SiteSettingsUnreadableError";
		this.state = state;
	}
}

/** Throws instead of guessing when the settings cannot be classified. */
export async function readReadableSiteSettings(
	ctx: PluginContext,
	scope: "full" | "indexing" = "full",
): Promise<ReadableSiteSettings> {
	const snapshot = await readSiteSettings(ctx, scope);
	if (!isReadableSiteSettings(snapshot)) throw new SiteSettingsUnreadableError(snapshot.state);
	return snapshot;
}

export type SiteIndexingFacts =
	| {
		state: "ok";
		siteUrl: string;
		noindex: boolean;
		/** Content types whose entries all get noindex; empty while none is stored. */
		contentTypeNoindex: string[];
		updatedAt: string | null;
		source: ReadableSiteSettings["state"];
	}
	| { state: "corrupt" | "unavailable" };

/**
 * Site URL and site-wide noindex for consumers that must not read an invalid
 * stored record as the inherited defaults. 1 versioned read with a stored
 * record, 3 without.
 */
export async function readSiteIndexingFacts(ctx: PluginContext): Promise<SiteIndexingFacts> {
	const snapshot = await readSiteSettings(ctx, "indexing");
	if (!isReadableSiteSettings(snapshot)) return { state: snapshot.state };
	return {
		state: "ok",
		siteUrl: snapshot.values.siteUrl,
		noindex: snapshot.values.noindex,
		contentTypeNoindex: [...(snapshot.values.contentTypeNoindex ?? [])],
		updatedAt: snapshot.updatedAt,
		source: snapshot.state,
	};
}

/**
 * Publisher and identity fields for consumers that never decide indexing.
 * Unlike readSiteSettings, an invalid stored record falls back to legacy and
 * host values here, as it always has.
 */
export async function readAdminSettings(
	ctx: PluginContext,
): Promise<{ values: SeoAdminSettingsValues; updatedAt: string | null }> {
	const stored = parseStoredSettings(await ctx.kv.get<unknown>(GLOBAL_SETTINGS_KEY));
	if (stored) {
		if (await isHistoricalSeed(stored)) return { updatedAt: null, values: historicalSeedValues(siteDefaults(ctx), stored.customVerificationTags, stored.taxonomyArchiveNoindex, stored.contentTypeNoindex) };
		return { updatedAt: stored.updatedAt, values: storedSettingsValues(stored) };
	}
	const siteName = (await ctx.kv.get<string>("settings:siteName"))?.trim() || inheritedSiteName(ctx);
	const legacyProfiles = await ctx.kv.get<string[]>("settings:sameAs");
	const legacyNoindex = await ctx.kv.get<unknown>("settings:noindex");
	return {
		updatedAt: null,
		values: {
			siteName,
			siteUrl: (await ctx.kv.get<string>("settings:siteUrl"))?.trim() || inheritedSiteUrl(ctx),
			publisherType: "organization",
			organizationName: (await ctx.kv.get<string>("settings:orgName"))?.trim() || siteName,
			organizationLogo: (await ctx.kv.get<string>("settings:orgLogo")) ?? "",
			personName: "",
			socialProfiles: Array.isArray(legacyProfiles)
				? legacyProfiles.filter((item) => typeof item === "string")
				: [],
			personProfiles: [],
			defaultSocialImage: (await ctx.kv.get<string>("settings:defaultOgImage")) ?? "",
			twitterHandle: (await ctx.kv.get<string>("settings:twitterHandle")) ?? "",
			noindex: legacyNoindex === true,
			contentScoringEnabled: true,
		},
	};
}

/**
 * The importer tracks and rolls back its own writes. Imported scoring intent
 * requires a new local resource-use acknowledgement; indexing ownership is
 * preserved separately from the historical seed marker. The indexing
 * confirmation comes only from `markers`, never from imported values.
 */
export async function persistAdminSettings(
	ctx: PluginContext,
	values: SeoAdminSettingsValues,
	markers: Pick<StoredSeoAdminSettings, "indexingPreferenceConfirmed"> = {},
): Promise<void> {
	const next: StoredSeoAdminSettings = {
		version: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
		updatedAt: new Date().toISOString(),
		...values,
	};
	delete next.contentScoringResourceNoticeVersion;
	delete next.indexingPreferenceConfirmed;
	await ctx.kv.set(GLOBAL_SETTINGS_KEY, await withoutHistoricalSeedAmbiguity({ ...next, ...markers }));
}

/**
 * Removes the resource-use acknowledgement from `stored`, the record the
 * importer fenced, and keeps every other field as stored, so the record still
 * classifies to the same indexing preference. The importer tracks and rolls
 * back this write.
 */
export async function withdrawContentScoringAcknowledgement(
	ctx: PluginContext,
	stored: unknown,
): Promise<void> {
	const record = parseStoredSettings(stored);
	if (!record) throw new Error(`portability_settings_unreadable:${GLOBAL_SETTINGS_KEY}`);
	const next: StoredSeoAdminSettings = { ...record };
	delete next.contentScoringResourceNoticeVersion;
	await ctx.kv.set(GLOBAL_SETTINGS_KEY, next);
}

function readableSettingsResponse(
	ctx: PluginContext,
	snapshot: ReadableSiteSettings,
	legacyGuard: string | null,
): SeoAdminReadableSettings {
	const withoutRecord = snapshot.state === "absent" || snapshot.state === "legacy";
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		storageVersion: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		state: snapshot.state,
		updatedAt: snapshot.updatedAt,
		revision: snapshot.revision,
		legacyGuard: withoutRecord ? legacyGuard : null,
		legacyPresent: withoutRecord ? snapshot.legacyPresent : false,
		indexingPreferenceConfirmed: snapshot.state === "saved" && snapshot.confirmed,
		contentScoring: contentScoringPolicyForSnapshot(snapshot),
		hostSiteUrl: inheritedSiteUrl(ctx),
		values: snapshot.values,
	};
}

function savedSnapshot(record: StoredSeoAdminSettings, revision: string): ReadableSiteSettings {
	return {
		state: "saved",
		revision,
		updatedAt: record.updatedAt,
		values: storedSettingsValues(record),
		record,
		confirmed: record.indexingPreferenceConfirmed === true,
	};
}

async function settingsSnapshotResponse(ctx: PluginContext, snapshot: SiteSettingsSnapshot): Promise<SeoAdminSettings> {
	if (!isReadableSiteSettings(snapshot)) {
		return {
			contractVersion: SEO_ADMIN_CONTRACT_VERSION,
			storageVersion: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
			engineVersion: SEO_ENGINE_VERSION,
			state: snapshot.state,
			updatedAt: null,
			revision: snapshot.state === "corrupt" ? snapshot.revision : null,
			legacyGuard: null,
			legacyPresent: false,
			indexingPreferenceConfirmed: false,
			contentScoring: contentScoringPolicyForSnapshot(snapshot),
			hostSiteUrl: inheritedSiteUrl(ctx),
			values: null,
		};
	}
	return readableSettingsResponse(
		ctx,
		snapshot,
		"legacy" in snapshot ? await legacySettingsGuard(snapshot.legacy) : null,
	);
}

export async function buildAdminSettings(ctx: PluginContext): Promise<SeoAdminSettings> {
	return settingsSnapshotResponse(ctx, await readSiteSettings(ctx, "full"));
}

function conditionalWritesAvailable(ctx: PluginContext): boolean {
	return typeof ctx.kv?.getVersioned === "function" && typeof ctx.kv?.compareAndSet === "function";
}

function assertWriteResult(result: unknown): asserts result is { applied: true; revision: string } | { applied: false } {
	if (!result || typeof result !== "object" || typeof (result as { applied?: unknown }).applied !== "boolean" ||
		((result as { applied: boolean }).applied && !validSettingsRevision((result as { revision?: unknown }).revision))) {
		throw new Error("The host returned an invalid conditional settings write result.");
	}
}

const UNAVAILABLE_SAVE = "SEO settings could not be read, so nothing was saved. Try again later.";
const CORRUPT_SAVE = "Stored SEO settings are invalid. Restore them before saving.";
const CORRUPT_LEGACY_SAVE = "Stored legacy SEO settings are invalid. Restore them before saving.";

/**
 * A deliberate full save. It replaces only the record the caller loaded and,
 * with no stored record, only the legacy keys it loaded. The stored record
 * carries the indexing confirmation marker and preserves analysis intent and
 * acknowledgement. Pass `current` when the operation read the settings in full.
 */
type SettingsWrite =
	| { kind: "settings"; values: SeoAdminSettingsValues }
	| { kind: "custom-verification-tags"; tags: CustomVerificationTag[] };

async function saveSettingsIfCurrent(
	ctx: PluginContext,
	change: SettingsWrite,
	guard: SeoAdminSettingsWriteGuard,
	current?: SiteSettingsSnapshot,
): Promise<SeoAdminSettingsSaveResult> {
	if (!conditionalWritesAvailable(ctx)) {
		return { success: false, errors: { _form: "Conditional settings storage is unavailable." } };
	}
	const snapshot = current ?? await readSiteSettings(ctx, "full");
	if (snapshot.state === "unavailable") return { success: false, errors: { _form: UNAVAILABLE_SAVE } };
	if (snapshot.revision !== guard.expectedRevision) {
		return { success: false, conflict: true, errors: { _form: "SEO settings changed elsewhere. Refresh to review the latest values before saving." } };
	}
	if (snapshot.state === "corrupt") {
		return { success: false, errors: { _form: snapshot.revision === null ? CORRUPT_LEGACY_SAVE : CORRUPT_SAVE } };
	}
	// Legacy keys are separate records: this re-read narrows, but does not
	// close, the window before the create below.
	if (guard.expectedRevision === null &&
		(!("legacy" in snapshot) || await legacySettingsGuard(snapshot.legacy) !== guard.expectedLegacyGuard)) {
		return { success: false, conflict: true, errors: { _form: "Legacy SEO settings changed after this page loaded. Reload to review them before saving." } };
	}
	const updatedAt = new Date().toISOString();
	const next: StoredSeoAdminSettings = change.kind === "custom-verification-tags"
		? await withoutHistoricalSeedAmbiguity(snapshot.state === "saved"
			? { ...snapshot.record, updatedAt, customVerificationTags: change.tags }
			: {
				version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt, ...snapshot.values,
				customVerificationTags: change.tags,
				...("record" in snapshot && snapshot.record.contentScoringResourceNoticeVersion !== undefined
					? { contentScoringResourceNoticeVersion: snapshot.record.contentScoringResourceNoticeVersion } : {}),
			})
		: {
			version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt, ...change.values,
			...(change.values.customVerificationTags === undefined && snapshot.values.customVerificationTags !== undefined
				? { customVerificationTags: snapshot.values.customVerificationTags.map((tag) => ({ ...tag })) } : {}),
			...(change.values.taxonomyArchiveNoindex === undefined && snapshot.values.taxonomyArchiveNoindex !== undefined
				? { taxonomyArchiveNoindex: [...snapshot.values.taxonomyArchiveNoindex] } : {}),
			...(change.values.contentTypeNoindex === undefined && snapshot.values.contentTypeNoindex !== undefined
				? { contentTypeNoindex: [...snapshot.values.contentTypeNoindex] } : {}),
			contentScoringEnabled: snapshot.values.contentScoringEnabled,
			contentScoringResourceNoticeVersion: "record" in snapshot ? snapshot.record.contentScoringResourceNoticeVersion : undefined,
			indexingPreferenceConfirmed: true,
		};
	const result = await ctx.kv.compareAndSet(GLOBAL_SETTINGS_KEY, guard.expectedRevision, next);
	assertWriteResult(result);
	if (!result.applied) {
		return { success: false, conflict: true, errors: { _form: "SEO settings changed during saving. Refresh to review the latest values before retrying." } };
	}
	return { success: true, settings: readableSettingsResponse(ctx, savedSnapshot(next, result.revision), null) };
}

export async function saveAdminSettingsIfCurrent(
	ctx: PluginContext,
	values: SeoAdminSettingsValues,
	guard: SeoAdminSettingsWriteGuard,
	current?: SiteSettingsSnapshot,
): Promise<SeoAdminSettingsSaveResult> {
	return saveSettingsIfCurrent(ctx, { kind: "settings", values }, guard, current);
}

export async function saveCustomVerificationTags(
	ctx: PluginContext,
	input: unknown,
): Promise<SeoAdminSettingsSaveResult> {
	const allowed = new Set(["tags", "expectedRevision", "expectedLegacyGuard"]);
	if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !allowed.has(key))) {
		return { success: false, errors: { _form: "Submit only custom verification tags and the loaded settings guard." } };
	}
	const source = input as Record<string, unknown>;
	const guard = validateSeoAdminSettingsWriteGuard(source);
	if (!guard.success) return guard;
	const validation = validateCustomVerificationTags(source.tags);
	if (!validation.success) return { success: false, errors: { customVerificationTags: validation.error } };
	return saveSettingsIfCurrent(ctx, { kind: "custom-verification-tags", tags: validation.tags }, guard.guard);
}

/**
 * Changes analysis admission under the loaded revision; enabling requires the
 * current resource-use acknowledgement. The indexing preference is kept:
 * a stored record keeps its fields and marker, the historical seed is written
 * with its effective `noindex: true`, and absent or legacy state is adopted
 * only while the legacy keys still match this operation's first read. A
 * retry never adopts legacy keys first seen on a later attempt.
 */
export async function saveContentScoring(
	ctx: PluginContext,
	change: SeoAdminContentScoringChange,
): Promise<SeoAdminSettingsSaveResult> {
	if (!conditionalWritesAvailable(ctx)) {
		return { success: false, errors: { _form: "Conditional settings storage is unavailable." } };
	}
	const legacyChanged: SeoAdminSettingsSaveResult = {
		success: false,
		conflict: true,
		errors: { _form: "Legacy SEO settings changed while content scoring was being changed. Reload and try again." },
	};
	// Guard of the first read's legacy keys; null when the first read found a record.
	let originalLegacyGuard: string | null | undefined;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const snapshot = await readSiteSettings(ctx, "full");
		if (snapshot.state === "unavailable") {
			return { success: false, errors: { _form: "SEO settings could not be read, so content scoring was not changed." } };
		}
		if (originalLegacyGuard === undefined) {
			originalLegacyGuard = "legacy" in snapshot ? await legacySettingsGuard(snapshot.legacy) : null;
		}
		if (snapshot.state === "corrupt") {
			return { success: false, errors: { _form: "Stored SEO settings are invalid. Restore them before changing scoring." } };
		}
		if (snapshot.revision !== change.expectedRevision ||
			("legacy" in snapshot && await legacySettingsGuard(snapshot.legacy) !== change.expectedLegacyGuard)) {
			return { success: false, conflict: true, errors: { _form: "SEO settings changed. Reload before changing saved-content analysis." } };
		}
		if (change.contentScoringEnabled && change.resourceNoticeVersion !== CONTENT_SCORING_RESOURCE_NOTICE_VERSION) {
			return { success: false, errors: { _form: "Review and acknowledge the current resource-use notice before enabling saved-content analysis." } };
		}
		if (snapshot.values.contentScoringEnabled !== change.expectedContentScoringEnabled) {
			return { success: false, conflict: true, errors: { contentScoringEnabled: "Content scoring changed elsewhere. Review the current setting and try again." } };
		}
		const updatedAt = new Date().toISOString();
		const next = await withoutHistoricalSeedAmbiguity(snapshot.state === "saved"
			? { ...snapshot.record, updatedAt, contentScoringEnabled: change.contentScoringEnabled,
					...(change.contentScoringEnabled ? { contentScoringResourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION } : {}) }
			: {
				version: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
				updatedAt,
				...snapshot.values,
				contentScoringEnabled: change.contentScoringEnabled,
				...(change.contentScoringEnabled ? { contentScoringResourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION } : {}),
			});
		if ("legacy" in snapshot) {
			if (originalLegacyGuard === null || await legacySettingsGuard(snapshot.legacy) !== originalLegacyGuard) {
				return legacyChanged;
			}
			// Legacy keys are separate records: this re-read narrows, but does
			// not close, the window before the create below.
			const reread = await readLegacyEntries(ctx, LEGACY_SETTINGS_KEYS);
			if (Object.values(reread).some((entry) => entry !== null && !validVersionedEnvelope(entry))) {
				return { success: false, errors: { _form: "SEO settings could not be read, so content scoring was not changed." } };
			}
			if (await legacySettingsGuard(reread) !== originalLegacyGuard) return legacyChanged;
		}
		const result = await ctx.kv.compareAndSet(GLOBAL_SETTINGS_KEY, snapshot.revision, next);
		assertWriteResult(result);
		if (result.applied) {
			return { success: true, settings: readableSettingsResponse(ctx, savedSnapshot(next, result.revision), null) };
		}
	}
	return { success: false, conflict: true, errors: { _form: "SEO settings changed repeatedly. Reload and try again." } };
}

/**
 * Restores inherited site values and keeps analysis intent, acknowledgement
 * and the loaded indexing preference:
 * the inherited values are stored with the loaded `noindex` and confirmation
 * state under the loaded revision. The record is never removed, because the
 * legacy keys it would hand the decision to can change after they are read.
 * A corrupt record or legacy key is left untouched.
 */
export async function resetAdminSettings(
	ctx: PluginContext,
	expectedRevision: string,
): Promise<SeoAdminSettingsSaveResult> {
	if (!conditionalWritesAvailable(ctx)) {
		return { success: false, errors: { _form: "Conditional settings storage is unavailable." } };
	}
	const snapshot = await readSiteSettings(ctx, "full");
	if (snapshot.state === "unavailable") {
		return { success: false, errors: { _form: "SEO settings could not be read, so nothing was restored. Try again later." } };
	}
	if (snapshot.revision !== expectedRevision) {
		return { success: false, conflict: true, errors: { _form: "SEO settings changed elsewhere. Refresh to review the latest values before restoring." } };
	}
	if (snapshot.state !== "saved" && snapshot.state !== "historical-seed") {
		return { success: false, errors: { _form: "Stored SEO settings are invalid. Restoring inherited settings would not keep the indexing preference, so nothing was changed." } };
	}
	const inherited = await classifySiteSettings({
		site: siteDefaults(ctx),
		global: null,
		legacy: await readLegacyEntries(ctx, LEGACY_SETTINGS_KEYS),
	});
	if (inherited.state === "unavailable") {
		return { success: false, errors: { _form: "SEO settings could not be read, so nothing was restored. Try again later." } };
	}
	if (!isReadableSiteSettings(inherited)) {
		return { success: false, errors: { _form: "Stored legacy SEO settings are invalid. Restoring inherited settings is unavailable until they are repaired." } };
	}
	const next = await withoutHistoricalSeedAmbiguity({
		version: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
		updatedAt: new Date().toISOString(),
		...inherited.values,
		...(snapshot.values.customVerificationTags === undefined ? {}
			: { customVerificationTags: snapshot.values.customVerificationTags.map((tag) => ({ ...tag })) }),
		...(snapshot.values.taxonomyArchiveNoindex === undefined ? {} : { taxonomyArchiveNoindex: [...snapshot.values.taxonomyArchiveNoindex] }),
		...(snapshot.values.contentTypeNoindex === undefined ? {} : { contentTypeNoindex: [...snapshot.values.contentTypeNoindex] }),
		noindex: snapshot.values.noindex,
		contentScoringEnabled: snapshot.values.contentScoringEnabled,
		...(snapshot.record.contentScoringResourceNoticeVersion !== undefined
			? { contentScoringResourceNoticeVersion: snapshot.record.contentScoringResourceNoticeVersion } : {}),
		...(snapshot.state === "saved" && snapshot.confirmed ? { indexingPreferenceConfirmed: true as const } : {}),
	});
	const result = await ctx.kv.compareAndSet(GLOBAL_SETTINGS_KEY, expectedRevision, next);
	assertWriteResult(result);
	if (!result.applied) {
		return { success: false, conflict: true, errors: { _form: "SEO settings changed during restoring. Refresh and try again." } };
	}
	return { success: true, settings: readableSettingsResponse(ctx, savedSnapshot(next, result.revision), null) };
}

/** Host site name and URL only, for display while the stored settings cannot be read. */
export function hostOnlySettingsValues(ctx: PluginContext): SeoAdminSettingsValues {
	return defaultSettingsValues(siteDefaults(ctx));
}

export async function getGlobalSettings(
	ctx: PluginContext,
	page?: PublicPageContext,
	settings?: SeoAdminSettingsValues,
): Promise<GlobalSeoSettings> {
	const values = settings ?? (await readAdminSettings(ctx)).values;
	return {
		siteName: values.siteName || page?.siteName || inheritedSiteName(ctx),
		siteUrl: values.siteUrl || page?.siteUrl || inheritedSiteUrl(ctx),
		publisherType: values.publisherType,
		orgName: values.organizationName || values.siteName,
		orgLogo: values.organizationLogo,
		personName: values.personName,
		sameAs: values.publisherType === "person" ? values.personProfiles : values.socialProfiles,
		defaultOgImage: values.defaultSocialImage,
		twitterHandle: values.twitterHandle,
	};
}

/**
 * Site-wide noindex from values of a readable snapshot, or from a strict read
 * that throws SiteSettingsUnreadableError rather than guessing.
 */
export async function getNoindex(ctx: PluginContext, settings?: SeoAdminSettingsValues): Promise<boolean> {
	return (settings ?? (await readReadableSiteSettings(ctx, "indexing")).values).noindex;
}

export async function getContentScoringEnabled(ctx: PluginContext): Promise<boolean> {
	return (await readContentScoringPolicy(ctx)).state === "enabled";
}

/**
 * Saved intent and acknowledgement share one admission revision. Missing or
 * older acknowledgement requires confirmation, while unreadable policy admits
 * no analysis. These reads never create settings or schedule work.
 */
export type ContentScoringPolicy = SeoAdminContentScoringPolicy;

/** The enabled policy an operation was admitted under. */
export type ContentScoringAdmission = Exclude<ContentScoringPolicy, { state: "unavailable" }> & { state: "enabled" };

export async function readContentScoringPolicy(ctx: PluginContext): Promise<ContentScoringPolicy> {
	if (typeof ctx.kv?.getVersioned !== "function") return { state: "unavailable", reason: "unreadable" };
	let entry: unknown;
	try {
		entry = await ctx.kv.getVersioned<unknown>(GLOBAL_SETTINGS_KEY);
	} catch (error) {
		ctx.log?.warn?.("seo: content scoring policy could not be read", { error: String(error) });
		return { state: "unavailable", reason: "unreadable" };
	}
	if (entry === null) return classifyContentScoringPolicy(null, null);
	if (!validVersionedEnvelope(entry)) return { state: "unavailable", reason: "unreadable" };
	const stored = parseStoredSettings(entry.value);
	if (!stored) return { state: "unavailable", reason: "corrupt" };
	return classifyContentScoringPolicy(stored, entry.revision);
}
