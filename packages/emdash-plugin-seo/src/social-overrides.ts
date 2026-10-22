import type { PluginContext } from "emdash";

import {
	SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH,
	SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
	SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH,
	type SeoAdminSocialOverride,
	type SeoAdminSocialOverrideValues,
	type SeoAdminSocialOverrideSnapshot,
	type SeoAdminSocialOverrideEditing,
	type SeoAdminSocialOverrideOperationError,
} from "./admin-contract.ts";

interface SocialOverrideStore {
	get(id: string): Promise<unknown>;
	put(id: string, value: SeoAdminSocialOverride): Promise<unknown>;
	delete(id: string): Promise<unknown>;
}

function storeFor(ctx: PluginContext): SocialOverrideStore | null {
	const store = (ctx.storage as any)?.socialOverrides;
	return store &&
		typeof store.get === "function" &&
		typeof store.put === "function" &&
		typeof store.delete === "function"
		? (store as SocialOverrideStore)
		: null;
}

export function normaliseSocialOverrideText(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().replace(/\s+/g, " ");
	return normalized || null;
}

export function isSeoAdminSocialOverride(
	ref: string,
	value: unknown,
): value is SeoAdminSocialOverride {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const title = normaliseSocialOverrideText(record.title);
	const description = normaliseSocialOverrideText(record.description);
	return (
		record.storageVersion === SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION &&
		record.ref === ref &&
		(title !== null || description !== null) &&
		(title === null || title.length <= SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH) &&
		(description === null ||
			description.length <= SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH) &&
		typeof record.updatedAt === "string" &&
		!Number.isNaN(Date.parse(record.updatedAt))
	);
}

/**
 * `inspect` sees each stored value as read, before it is validated or
 * trimmed; what it throws propagates, unlike a failed read.
 */
export async function readSocialOverride(
	ctx: PluginContext,
	refs: readonly string[],
	inspect?: (value: unknown) => void,
): Promise<SeoAdminSocialOverride | null> {
	const store = storeFor(ctx);
	if (!store) return null;
	for (const ref of refs) {
		let value: unknown;
		try {
			value = await store.get(ref);
		} catch (error: unknown) {
			ctx.log?.warn?.("seo: social override read failed", {
				error: String(error),
			});
			return null;
		}
		inspect?.(value);
		if (isSeoAdminSocialOverride(ref, value)) return value;
	}
	return null;
}

interface ConditionalSocialOverrideStore {
	getVersioned(id: string): Promise<unknown>;
	compareAndSet(id: string, revision: string | null, value: SeoAdminSocialOverride): Promise<unknown>;
	compareAndDelete(id: string, revision: string): Promise<unknown>;
}

function conditionalStoreFor(ctx: PluginContext): ConditionalSocialOverrideStore | null {
	const store = (ctx.storage as any)?.socialOverrides;
	return store &&
		typeof store.getVersioned === "function" &&
		typeof store.compareAndSet === "function" &&
		typeof store.compareAndDelete === "function"
		? store as ConditionalSocialOverrideStore
		: null;
}

function isRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function strictOverride(ref: string, value: unknown): SeoAdminSocialOverride | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		(record.title !== null && typeof record.title !== "string") ||
		(record.description !== null && typeof record.description !== "string") ||
		(typeof record.title === "string" && record.title.length > SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH) ||
		(typeof record.description === "string" &&
			record.description.length > SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH) ||
		typeof record.updatedAt !== "string" || record.updatedAt.length > 128 ||
		!isSeoAdminSocialOverride(ref, value)
	) return null;
	return {
		storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
		ref,
		title: normaliseSocialOverrideText(record.title),
		description: normaliseSocialOverrideText(record.description),
		updatedAt: record.updatedAt,
	};
}

type SnapshotRead =
	| { success: true; snapshot: SeoAdminSocialOverrideSnapshot; raw: unknown }
	| { success: false; error: "storage_unavailable" | "record_invalid" };

/** Read the canonical row strictly; failed reads never establish absence. */
export async function readSocialOverrideSnapshot(
	ctx: PluginContext,
	ref: string,
): Promise<SnapshotRead> {
	const store = conditionalStoreFor(ctx);
	if (!store) return { success: false, error: "storage_unavailable" };
	let row: unknown;
	try {
		row = await store.getVersioned(ref);
	} catch {
		return { success: false, error: "storage_unavailable" };
	}
	if (row === null) {
		return { success: true, snapshot: { ref, revision: null, override: null }, raw: null };
	}
	if (!row || typeof row !== "object" || Array.isArray(row)) {
		return { success: false, error: "record_invalid" };
	}
	const versioned = row as Record<string, unknown>;
	const override = strictOverride(ref, versioned.value);
	if (!isRevision(versioned.revision) || !override) {
		return { success: false, error: "record_invalid" };
	}
	return {
		success: true,
		snapshot: { ref, revision: versioned.revision, override },
		raw: versioned.value,
	};
}

/** A write baseline must describe the same canonical value used by the preview. */
export async function readSocialOverrideEditing(
	ctx: PluginContext,
	ref: string,
	observed: { present: boolean; value?: unknown },
): Promise<SeoAdminSocialOverrideEditing> {
	if (!observed.present) return { state: "unavailable", reason: "storage_unavailable" };
	const result = await readSocialOverrideSnapshot(ctx, ref);
	if (!result.success) return { state: "unavailable", reason: result.error };
	try {
		if (observed.value === null) {
			if (result.snapshot.override !== null) return { state: "unavailable", reason: "snapshot_changed" };
		} else {
			if (!strictOverride(ref, observed.value)) return { state: "unavailable", reason: "record_invalid" };
			if (result.snapshot.override === null) return { state: "unavailable", reason: "snapshot_changed" };
			const current = result.raw as SeoAdminSocialOverride;
			const previous = observed.value as SeoAdminSocialOverride;
			// Compare only the bounded fields metadata resolution consumes, preserving raw whitespace.
			if (current.title !== previous.title || current.description !== previous.description ||
				current.updatedAt !== previous.updatedAt) {
				return { state: "unavailable", reason: "snapshot_changed" };
			}
		}
	} catch {
		return { state: "unavailable", reason: "record_invalid" };
	}
	return { state: "ready", snapshot: result.snapshot };
}

type SocialOverrideWrite =
	| { success: true; outcome: "saved" | "unchanged"; snapshot: SeoAdminSocialOverrideSnapshot }
	| { success: false; outcome: "rejected" | "unconfirmed"; error: SeoAdminSocialOverrideOperationError };

function matchesValues(
	snapshot: SeoAdminSocialOverrideSnapshot,
	title: string | null,
	description: string | null,
): boolean {
	return (snapshot.override?.title ?? null) === title &&
		(snapshot.override?.description ?? null) === description;
}

export async function persistSocialOverride(
	ctx: PluginContext,
	ref: string,
	values: SeoAdminSocialOverrideValues,
	expectedRevision: string | null,
): Promise<SocialOverrideWrite> {
	const rejected = (error: SeoAdminSocialOverrideOperationError): SocialOverrideWrite =>
		({ success: false, outcome: "rejected", error });
	if (
		!values || typeof values.title !== "string" || typeof values.description !== "string" ||
		(expectedRevision !== null && !isRevision(expectedRevision))
	) return rejected("invalid_values");
	const title = normaliseSocialOverrideText(values.title);
	const description = normaliseSocialOverrideText(values.description);
	if (title && title.length > SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH) return rejected("title_too_long");
	if (description && description.length > SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH) {
		return rejected("description_too_long");
	}
	const store = conditionalStoreFor(ctx);
	if (!store) return rejected("storage_unavailable");
	const current = await readSocialOverrideSnapshot(ctx, ref);
	if (!current.success) return rejected(current.error);
	if (current.snapshot.revision !== expectedRevision) return rejected("conflict");
	if (matchesValues(current.snapshot, title, description)) {
		return { success: true, outcome: "unchanged", snapshot: current.snapshot };
	}
	const override: SeoAdminSocialOverride | null = title || description ? {
		storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
		ref,
		title,
		description,
		updatedAt: new Date().toISOString(),
	} : null;
	try {
		// Use the client's observed revision directly, including null for an absent row.
		const result = override
			? await store.compareAndSet(ref, expectedRevision, override)
			: await store.compareAndDelete(ref, expectedRevision as string);
		if (result && typeof result === "object" && !Array.isArray(result)) {
			const acknowledgement = result as Record<string, unknown>;
			if (acknowledgement.applied === false) return rejected("conflict");
			if (acknowledgement.applied === true &&
				(!override || isRevision(acknowledgement.revision))) {
				return {
					success: true,
					outcome: "saved",
					snapshot: {
						ref,
						revision: override ? acknowledgement.revision as string : null,
						override,
					},
				};
			}
		}
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: social override write was not confirmed", { error: String(error) });
	}
	// A lost acknowledgement permits one read, never another write.
	const recovery = await readSocialOverrideSnapshot(ctx, ref);
	if (recovery.success && matchesValues(recovery.snapshot, title, description)) {
		return { success: true, outcome: "saved", snapshot: recovery.snapshot };
	}
	return { success: false, outcome: "unconfirmed", error: "unconfirmed" };
}

export async function deleteSocialOverride(
	ctx: PluginContext,
	ref: string,
): Promise<void> {
	await storeFor(ctx)?.delete(ref);
}
