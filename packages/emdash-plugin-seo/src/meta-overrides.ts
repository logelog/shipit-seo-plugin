import { compareStoredValue, supportsConditionalStorage } from "./conditional-storage.ts";
import type { PluginContext } from "emdash";

import {
	SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
	type SeoAdminMetaOverride,
	type SeoAdminRobotsDirectives,
} from "./admin-contract.ts";

interface MetaOverrideStore {
	get(id: string): Promise<unknown>;
	put(id: string, value: SeoAdminMetaOverride): Promise<unknown>;
	delete(id: string): Promise<unknown>;
}

export interface MetaOverrideUpdate {
	robots?: SeoAdminRobotsDirectives;
	disabledPresets?: readonly string[];
}

export const SEO_ROBOTS_DIRECTIVE_KEYS = [
	"nofollow",
	"noarchive",
	"nosnippet",
	"noimageindex",
	"notranslate",
] as const satisfies readonly (keyof SeoAdminRobotsDirectives)[];

function storeFor(ctx: PluginContext): MetaOverrideStore | null {
	const store = (ctx.storage as any)?.metaOverrides;
	return store &&
		typeof store.get === "function" &&
		typeof store.put === "function" &&
		typeof store.delete === "function"
		? (store as MetaOverrideStore)
		: null;
}

export function normaliseRobotsDirectives(
	value: unknown,
): SeoAdminRobotsDirectives | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const directives = {} as SeoAdminRobotsDirectives;
	for (const key of SEO_ROBOTS_DIRECTIVE_KEYS) {
		const flag = record[key];
		if (flag !== undefined && typeof flag !== "boolean") return null;
		directives[key] = flag === true;
	}
	return directives;
}

export function robotsDirectivesActive(
	directives: SeoAdminRobotsDirectives | null | undefined,
): boolean {
	if (!directives) return false;
	return SEO_ROBOTS_DIRECTIVE_KEYS.some((key) => directives[key]);
}

/** Normalise a per-entry disabled-preset list: known-string keys, deduped. */
export function normaliseDisabledPresets(value: unknown): string[] | null {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) return null;
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string") return null;
		const key = entry.trim();
		if (!key || key.length > 64) return null;
		seen.add(key);
	}
	return [...seen].sort();
}

export function isSeoAdminMetaOverride(
	ref: string,
	value: unknown,
): value is SeoAdminMetaOverride {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const robots = normaliseRobotsDirectives(record.robots);
	const disabledPresets = normaliseDisabledPresets(record.disabledPresets);
	return (
		record.storageVersion === SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION &&
		record.ref === ref &&
		robots !== null &&
		disabledPresets !== null &&
		(robotsDirectivesActive(robots) || disabledPresets.length > 0) &&
		typeof record.updatedAt === "string" &&
		!Number.isNaN(Date.parse(record.updatedAt))
	);
}

export async function readMetaOverride(
	ctx: PluginContext,
	ref: string,
): Promise<SeoAdminMetaOverride | null> {
	const store = storeFor(ctx);
	if (!store) return null;
	const value = await store.get(ref);
	if (!isSeoAdminMetaOverride(ref, value)) return null;
	// Records written before disabledPresets existed normalise to an empty list.
	return { ...value, disabledPresets: value.disabledPresets ?? [] };
}

export async function readMetaOverrideStrict(
	ctx: PluginContext,
	ref: string,
): Promise<SeoAdminMetaOverride | null> {
	const store = storeFor(ctx);
	if (!store) throw new Error("meta_override_storage_unavailable");
	const value = await store.get(ref);
	if (value == null) return null;
	if (!isSeoAdminMetaOverride(ref, value)) {
		throw new Error("meta_override_storage_contains_invalid_record");
	}
	return { ...value, disabledPresets: value.disabledPresets ?? [] };
}

export async function persistMetaOverride(
	ctx: PluginContext,
	ref: string,
	robots: SeoAdminRobotsDirectives,
	disabledPresets: readonly string[] = [],
): Promise<SeoAdminMetaOverride | null> {
	const store = storeFor(ctx);
	if (!store) throw new Error("meta_override_storage_unavailable");
	const presets = [...new Set(disabledPresets)].sort();
	if (!robotsDirectivesActive(robots) && presets.length === 0) {
		await store.delete(ref);
		return null;
	}
	const record: SeoAdminMetaOverride = {
		storageVersion: SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
		ref,
		robots,
		disabledPresets: presets,
		updatedAt: new Date().toISOString(),
	};
	await store.put(ref, record);
	return record;
}

export async function updateMetaOverride(
	ctx: PluginContext,
	ref: string,
	update: MetaOverrideUpdate,
): Promise<SeoAdminMetaOverride | null> {
	const store = storeFor(ctx);
	if (!store || !supportsConditionalStorage(store)) {
		throw new Error("conditional_meta_override_storage_unavailable");
	}
	const changesRobots = Object.prototype.hasOwnProperty.call(update, "robots");
	const changesPresets = Object.prototype.hasOwnProperty.call(update, "disabledPresets");
	if (!changesRobots && !changesPresets) return readMetaOverride(ctx, ref);
	if (changesRobots && !update.robots) throw new Error("invalid_meta_override_update");

	for (let attempt = 0; attempt < 8; attempt += 1) {
		const currentRaw = await store.get(ref);
		const current =
			currentRaw == null
				? null
				: isSeoAdminMetaOverride(ref, currentRaw)
					? ({
							...currentRaw,
							disabledPresets: currentRaw.disabledPresets ?? [],
						} satisfies SeoAdminMetaOverride)
					: null;
		if (currentRaw != null && !current) {
			throw new Error("meta_override_storage_contains_invalid_record");
		}
		const robots = changesRobots
			? update.robots!
			: (current?.robots ?? normaliseRobotsDirectives({})!);
		const disabledPresets = changesPresets
			? [...new Set(update.disabledPresets ?? [])].sort()
			: (current?.disabledPresets ?? []);
		const next =
			!robotsDirectivesActive(robots) && disabledPresets.length === 0
				? null
				: ({
						storageVersion: SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
						ref,
						robots,
						disabledPresets,
						updatedAt: new Date().toISOString(),
					} satisfies SeoAdminMetaOverride);
		if (currentRaw == null && next === null) return null;
		try {
			const committed = await compareStoredValue(
				store,
				ref,
				currentRaw == null
					? { state: "missing" }
					: { state: "value", value: currentRaw },
				next === null ? { action: "delete" } : { action: "put", value: next },
			);
			if (committed) return next;
		} catch (error: unknown) {
			const afterError = await store.get(ref);
			if (
				(next === null && afterError == null) ||
				(next !== null && JSON.stringify(afterError) === JSON.stringify(next))
			) {
				return next;
			}
			if (attempt === 7) throw error;
		}
	}
	throw new Error("meta_override_changed_during_update");
}

export async function deleteMetaOverride(
	ctx: PluginContext,
	ref: string,
): Promise<void> {
	const store = storeFor(ctx);
	if (!store) return;
	await store.delete(ref);
}

/**
 * Merge per-entry robots directives into the base robots value that the
 * metadata resolver computed (core noIndex stays the owner of index/noindex).
 * Deduplicates tokens, keeps the base order stable, and removes the positive
 * counterpart of every enabled directive so a legacy free-form base like
 * "index, follow" can never yield a contradictory "follow,nofollow".
 */
export function mergeRobotsDirectives(
	base: string,
	directives: SeoAdminRobotsDirectives | null | undefined,
): string {
	let tokens = base
		.split(",")
		.map((token) => token.trim().toLowerCase())
		.filter(Boolean);
	if (directives) {
		for (const key of SEO_ROBOTS_DIRECTIVE_KEYS) {
			if (!directives[key]) continue;
			const positive = key.slice(2);
			tokens = tokens.filter((token) => token !== positive);
			if (!tokens.includes(key)) tokens.push(key);
		}
	}
	return tokens.join(",");
}
