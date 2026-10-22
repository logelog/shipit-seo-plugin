import type { PluginContext } from "emdash";

export const COLLECTION_ANALYSIS_PROFILE_VERSION = 1 as const;
export const COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX = "configuration:analysis-profile:v1:";
export type CollectionAnalysisProfile = "article" | "general";
export interface CollectionAnalysisProfileSelection {
	profile: CollectionAnalysisProfile;
	version: typeof COLLECTION_ANALYSIS_PROFILE_VERSION;
}
export interface ConfiguredCollectionAnalysisProfile extends CollectionAnalysisProfileSelection {
	state: "configured";
	collection: string;
	revision: string;
}
export type CollectionAnalysisProfileRead =
	| ConfiguredCollectionAnalysisProfile
	| { state: "unconfigured"; collection: string; revision: null }
	| { state: "unavailable"; collection: string; reason: "unreadable" | "corrupt" };

type ProfileContext = Pick<PluginContext, "kv">;

function validCollection(value: unknown): value is string {
	return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export function isCollectionAnalysisProfileSelection(value: unknown): value is CollectionAnalysisProfileSelection {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Partial<CollectionAnalysisProfileSelection>;
	return candidate.version === COLLECTION_ANALYSIS_PROFILE_VERSION &&
		(candidate.profile === "article" || candidate.profile === "general");
}

export function collectionAnalysisProfileKey(collection: string): string {
	if (!validCollection(collection)) throw new Error("Invalid assessment collection.");
	return `${COLLECTION_ANALYSIS_PROFILE_KEY_PREFIX}${collection}`;
}

export async function readCollectionAnalysisProfile(ctx: ProfileContext, collection: string): Promise<CollectionAnalysisProfileRead> {
	if (!validCollection(collection)) return { state: "unavailable", collection, reason: "corrupt" };
	if (typeof ctx.kv?.getVersioned !== "function") return { state: "unavailable", collection, reason: "unreadable" };
	let snapshot: unknown;
	try {
		snapshot = await ctx.kv.getVersioned<unknown>(collectionAnalysisProfileKey(collection));
	} catch {
		return { state: "unavailable", collection, reason: "unreadable" };
	}
	if (snapshot === null) return { state: "unconfigured", collection, revision: null };
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
		return { state: "unavailable", collection, reason: "unreadable" };
	const entry = snapshot as { revision?: unknown; value?: unknown };
	if (!validRevision(entry.revision) || !Object.hasOwn(entry, "value"))
		return { state: "unavailable", collection, reason: "unreadable" };
	const stored = entry.value as { updatedAt?: unknown } | null;
	if (!isCollectionAnalysisProfileSelection(stored) || typeof stored?.updatedAt !== "string" || !Number.isFinite(Date.parse(stored.updatedAt)))
		return { state: "unavailable", collection, reason: "corrupt" };
	return { state: "configured", collection, profile: stored.profile, version: stored.version, revision: entry.revision };
}

export class CollectionAnalysisProfileError extends Error {
	readonly code: "profile_required" | "profile_unavailable";
	readonly collection: string;
	constructor(code: "profile_required" | "profile_unavailable", collection: string) {
		super(code === "profile_required" ? "Choose an assessment profile for this content type." : "The assessment profile could not be read.");
		this.name = "CollectionAnalysisProfileError";
		this.code = code;
		this.collection = collection;
	}
}

export async function requireCollectionAnalysisProfile(ctx: ProfileContext, collection: string): Promise<ConfiguredCollectionAnalysisProfile> {
	const profile = await readCollectionAnalysisProfile(ctx, collection);
	if (profile.state !== "configured")
		throw new CollectionAnalysisProfileError(profile.state === "unconfigured" ? "profile_required" : "profile_unavailable", collection);
	return profile;
}

export async function verifyCollectionAnalysisProfileRevision(ctx: ProfileContext, admitted: ConfiguredCollectionAnalysisProfile): Promise<boolean> {
	const current = await readCollectionAnalysisProfile(ctx, admitted.collection);
	return current.state === "configured" && current.revision === admitted.revision &&
		current.profile === admitted.profile && current.version === admitted.version;
}

export type CollectionAnalysisProfileSaveResult =
	| { success: true; value: ConfiguredCollectionAnalysisProfile }
	| { success: false; error: "conflict" | "unavailable" | "invalid_profile" | "invalid_revision" | "invalid_collection" };

export async function saveCollectionAnalysisProfile(
	ctx: ProfileContext,
	collection: string,
	change: { profile: CollectionAnalysisProfile; expectedRevision: string | null },
): Promise<CollectionAnalysisProfileSaveResult> {
	if (!validCollection(collection)) return { success: false, error: "invalid_collection" };
	if (change.profile !== "article" && change.profile !== "general") return { success: false, error: "invalid_profile" };
	if (change.expectedRevision !== null && !validRevision(change.expectedRevision)) return { success: false, error: "invalid_revision" };
	if (typeof ctx.kv?.compareAndSet !== "function") return { success: false, error: "unavailable" };
	const stored = { version: COLLECTION_ANALYSIS_PROFILE_VERSION, profile: change.profile, updatedAt: new Date().toISOString() };
	try {
		const result = await ctx.kv.compareAndSet(collectionAnalysisProfileKey(collection), change.expectedRevision, stored);
		if (!result || typeof result.applied !== "boolean") return { success: false, error: "unavailable" };
		if (!result.applied) return { success: false, error: "conflict" };
		if (!validRevision(result.revision)) return { success: false, error: "unavailable" };
		return { success: true, value: { state: "configured", collection, profile: stored.profile, version: stored.version, revision: result.revision } };
	} catch {
		return { success: false, error: "unavailable" };
	}
}
