import type { PluginContext } from "emdash";

import {
	SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH,
	type SeoAdminAnalysisProfile,
} from "./admin-contract.ts";
import { seoKeywordIdentity } from "./keyword-match.ts";

interface AnalysisProfileStore {
	get(id: string): Promise<unknown>;
	put(id: string, value: SeoAdminAnalysisProfile): Promise<unknown>;
	delete(id: string): Promise<unknown>;
}

interface LegacyAnalysisProfileV1 {
	storageVersion: 1;
	ref: string;
	keyword: string;
	updatedAt: string;
}

interface LegacyAnalysisProfileV2 {
	storageVersion: 2;
	ref: string;
	keyword: string;
	keywords: string[];
	updatedAt: string;
}

interface LegacyAnalysisProfileV3 {
	storageVersion: 3;
	ref: string;
	keyword: string;
	keywords: string[];
	pillar: boolean;
	updatedAt: string;
}

/**
 * Where the effective analyzer keyword list came from. "profile" and
 * "transient" are explicit statements; "content" is a legacy keyword inherited
 * from content/core SEO fields that the user has never confirmed; "none" means
 * nothing drives keyword analysis (including an intentionally cleared profile).
 */
export interface FocusKeywordOwnership {
	/** Effective analyzer keywords (primary first). */
	keywords: string[];
	source: "profile" | "content" | "transient" | "none";
	/** The stored explicit statement; null when the profile makes none. */
	profileKeywords: string[] | null;
	pillar: boolean;
}

export type FocusKeywordsValidationError =
	| "invalid_keyword"
	| "keyword_too_long"
	| "too_many_keywords";

function storeFor(ctx: PluginContext): AnalysisProfileStore | null {
	const store = (ctx.storage as any)?.analysisProfiles;
	return store &&
		typeof store.get === "function" &&
		typeof store.put === "function" &&
		typeof store.delete === "function"
		? (store as AnalysisProfileStore)
		: null;
}

export function normaliseFocusKeyword(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const keyword = value.trim().replace(/\s+/g, " ");
	return keyword || undefined;
}

export function normaliseFocusKeywords(value: unknown): string[] {
	const values = Array.isArray(value) ? value : [value];
	const seen = new Set<string>();
	const keywords: string[] = [];
	for (const candidate of values) {
		const keyword = normaliseFocusKeyword(candidate);
		if (!keyword) continue;
		const identity = seoKeywordIdentity(keyword);
		if (seen.has(identity)) continue;
		seen.add(identity);
		keywords.push(keyword);
	}
	return keywords;
}

export function focusKeywordsValidationError(
	value: unknown,
): FocusKeywordsValidationError | null {
	if (
		typeof value !== "string" &&
		(!Array.isArray(value) || value.some((candidate) => typeof candidate !== "string"))
	) {
		return "invalid_keyword";
	}
	const values = Array.isArray(value) ? value : [value];
	if (
		values.some(
			(candidate) =>
				(normaliseFocusKeyword(candidate)?.length ?? 0) >
				SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH,
		)
	) {
		return "keyword_too_long";
	}
	if (normaliseFocusKeywords(values).length > SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT) {
		return "too_many_keywords";
	}
	return null;
}

export function focusKeywordIsValid(value: unknown): boolean {
	return value === undefined || focusKeywordsValidationError(value) === null;
}

export function focusKeywordsAreValid(value: unknown): boolean {
	return focusKeywordsValidationError(value) === null;
}

function validKeywordStatement(rawKeywords: unknown): rawKeywords is string[] {
	if (!Array.isArray(rawKeywords)) return false;
	const keywords = normaliseFocusKeywords(rawKeywords);
	return (
		rawKeywords.length === keywords.length &&
		keywords.length <= SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT &&
		keywords.every(
			(keyword, index) =>
				keyword === rawKeywords[index] &&
				keyword.length <= SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH,
		)
	);
}

export function isSeoAdminAnalysisProfile(
	ref: string,
	value: unknown,
): value is SeoAdminAnalysisProfile {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const profile = value as Record<string, unknown>;
	const rawKeywords = profile.keywords;
	// `keywords: null` is a valid v4 statement ("no explicit keywords; the
	// content fallback may keep applying") and always pairs with keyword "".
	if (rawKeywords !== null && !validKeywordStatement(rawKeywords)) {
		return false;
	}
	const expectedPrimary = rawKeywords === null ? "" : (rawKeywords[0] ?? "");
	return (
		profile.storageVersion === SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION &&
		profile.ref === ref &&
		profile.keyword === expectedPrimary &&
		typeof profile.pillar === "boolean" &&
		typeof profile.updatedAt === "string" &&
		!Number.isNaN(Date.parse(profile.updatedAt))
	);
}

function isLegacyAnalysisProfileV1(
	ref: string,
	value: unknown,
): value is LegacyAnalysisProfileV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const profile = value as Record<string, unknown>;
	const keyword = normaliseFocusKeyword(profile.keyword);
	return (
		profile.storageVersion === 1 &&
		profile.ref === ref &&
		keyword !== undefined &&
		keyword === profile.keyword &&
		keyword.length <= SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH &&
		typeof profile.updatedAt === "string" &&
		!Number.isNaN(Date.parse(profile.updatedAt))
	);
}

function isLegacyAnalysisProfileV2(
	ref: string,
	value: unknown,
): value is LegacyAnalysisProfileV2 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const profile = value as Record<string, unknown>;
	const rawKeywords = profile.keywords;
	const keywords = normaliseFocusKeywords(rawKeywords);
	return (
		profile.storageVersion === 2 &&
		profile.ref === ref &&
		Array.isArray(rawKeywords) &&
		rawKeywords.length === keywords.length &&
		keywords.length > 0 &&
		keywords.length <= SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT &&
		keywords.every(
			(keyword, index) =>
				keyword === rawKeywords[index] &&
				keyword.length <= SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH,
		) &&
		profile.keyword === keywords[0] &&
		typeof profile.updatedAt === "string" &&
		!Number.isNaN(Date.parse(profile.updatedAt))
	);
}

function isLegacyAnalysisProfileV3(
	ref: string,
	value: unknown,
): value is LegacyAnalysisProfileV3 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const profile = value as Record<string, unknown>;
	return (
		profile.storageVersion === 3 &&
		profile.ref === ref &&
		validKeywordStatement(profile.keywords) &&
		profile.keyword === ((profile.keywords as string[])[0] ?? "") &&
		typeof profile.pillar === "boolean" &&
		typeof profile.updatedAt === "string" &&
		!Number.isNaN(Date.parse(profile.updatedAt))
	);
}

export async function readAnalysisProfile(
	ctx: PluginContext,
	ref: string,
	options: { persistMigration?: boolean; requireReadable?: boolean } = {},
): Promise<SeoAdminAnalysisProfile | null> {
	const store = storeFor(ctx);
	if (!store) {
		if (options.requireReadable) throw new Error("analysis_profile_storage_unavailable");
		return null;
	}
	const value = await store.get(ref);
	if (value === null || value === undefined) return null;
	if (isSeoAdminAnalysisProfile(ref, value)) return value;

	// Lazy storage migration. v3 keyword arrays keep their meaning verbatim —
	// an empty v3 array was an intentional clear and stays `[]`, never `null`.
	// v1/v2 always carried at least one keyword.
	let migrated: SeoAdminAnalysisProfile | null = null;
	if (isLegacyAnalysisProfileV3(ref, value)) {
		migrated = {
			storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
			ref,
			keyword: value.keyword,
			keywords: value.keywords,
			pillar: value.pillar,
			updatedAt: value.updatedAt,
		};
	} else if (isLegacyAnalysisProfileV2(ref, value)) {
		migrated = {
			storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
			ref,
			keyword: value.keyword,
			keywords: value.keywords,
			pillar: false,
			updatedAt: value.updatedAt,
		};
	} else if (isLegacyAnalysisProfileV1(ref, value)) {
		migrated = {
			storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
			ref,
			keyword: value.keyword,
			keywords: [value.keyword],
			pillar: false,
			updatedAt: value.updatedAt,
		};
	}
	if (!migrated) {
		if (options.requireReadable) throw new Error("analysis_profile_unreadable");
		return null;
	}
	if (options.persistMigration !== false) await store.put(ref, migrated);
	return migrated;
}

export async function resolveFocusKeywordOwnership(
	ctx: PluginContext,
	ref: string,
	explicit: unknown,
	contentFallback: unknown,
	options: { persistMigration?: boolean } = {},
): Promise<FocusKeywordOwnership> {
	const profile = await readAnalysisProfile(ctx, ref, options);
	const profileKeywords = profile ? profile.keywords : null;
	const pillar = profile?.pillar === true;
	if (focusKeywordsValidationError(explicit) === null) {
		const transient = normaliseFocusKeywords(explicit);
		if (transient.length > 0) {
			return { keywords: transient, source: "transient", profileKeywords, pillar };
		}
	}
	if (profileKeywords !== null) {
		// An empty statement is meaningful: the user explicitly cleared analyzer
		// keywords, so do not resurrect a legacy content fallback.
		return {
			keywords: profileKeywords,
			source: profileKeywords.length > 0 ? "profile" : "none",
			profileKeywords,
			pillar,
		};
	}
	const fallback = normaliseFocusKeyword(contentFallback);
	return fallback
		? { keywords: [fallback], source: "content", profileKeywords, pillar }
		: { keywords: [], source: "none", profileKeywords, pillar };
}

export async function resolveEffectiveFocusKeywords(
	ctx: PluginContext,
	ref: string,
	explicit: unknown,
	contentFallback: unknown,
): Promise<string[]> {
	// A valid transient keyword answers without touching storage; only the
	// ownership resolver (which must also report the stored statement and
	// pillar flag) reads the profile unconditionally.
	if (focusKeywordsValidationError(explicit) === null) {
		const transient = normaliseFocusKeywords(explicit);
		if (transient.length > 0) return transient;
	}
	return (
		await resolveFocusKeywordOwnership(ctx, ref, "", contentFallback)
	).keywords;
}

export async function resolveEffectiveFocusKeyword(
	ctx: PluginContext,
	ref: string,
	explicit: unknown,
	contentFallback: unknown,
): Promise<string | undefined> {
	return (
		await resolveEffectiveFocusKeywords(ctx, ref, explicit, contentFallback)
	)[0];
}

export async function persistAnalysisProfile(
	ctx: PluginContext,
	ref: string,
	value: unknown,
	options: { pillar?: boolean } = {},
): Promise<SeoAdminAnalysisProfile | null> {
	const store = storeFor(ctx);
	if (!store) throw new Error("analysis_profile_storage_unavailable");
	// `null` preserves the existing keyword statement (array stays the array,
	// no statement stays `null`) so a pillar-only toggle can never silently
	// adopt an inherited content keyword into the profile.
	const existing = await readAnalysisProfile(ctx, ref, { persistMigration: false, requireReadable: true });
	let keywords: string[] | null;
	if (value === null) {
		keywords = existing?.keywords ?? null;
	} else {
		const validationError = focusKeywordsValidationError(value);
		if (validationError === "invalid_keyword") {
			throw new TypeError("invalid_focus_keyword");
		}
		if (validationError === "keyword_too_long") {
			throw new RangeError("focus_keyword_too_long");
		}
		if (validationError === "too_many_keywords") {
			throw new RangeError("too_many_focus_keywords");
		}
		keywords = normaliseFocusKeywords(value);
	}
	const pillar = options.pillar ?? existing?.pillar ?? false;
	const profile: SeoAdminAnalysisProfile = {
		storageVersion: SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
		ref,
		keyword: keywords?.[0] ?? "",
		keywords,
		pillar,
		updatedAt: new Date().toISOString(),
	};
	await store.put(ref, profile);
	return profile;
}

export async function deleteAnalysisProfile(
	ctx: PluginContext,
	ref: string,
): Promise<void> {
	const store = storeFor(ctx);
	if (!store) throw new Error("analysis_profile_storage_unavailable");
	await store.delete(ref);
}
