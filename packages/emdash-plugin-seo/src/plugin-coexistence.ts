export const COEXISTENCE_MAX_IDS = 32;
export const COEXISTENCE_MAX_CONFIGURED = 28;
export const COEXISTENCE_MAX_OBSERVATION_BYTES = 24576;
export const COEXISTENCE_MAX_ENTRYPOINT_BYTES = 512;
export const COEXISTENCE_ROBOTS_KEY = "shipit-seo:robots:restrictions:v1";

export type CoexistenceSurface = "metadata" | "robots" | "schema" | "indexnow";
export type CoexistenceProfileId = "moorage-seo" | "seo-suite" | "instant-indexer" | "rendered-seo-inspector";

export interface CoexistenceProfile {
	id: CoexistenceProfileId;
	name: string;
	runtimeId: string;
	publisherDid: string;
	slug: string;
	assessedVersion: string;
	configuredEntrypoints: readonly string[];
	surfaces: readonly CoexistenceSurface[];
	assessment: "observed-overlap" | "potential-overlap" | "inspection-only";
}

export const COEXISTENCE_PROFILES: readonly CoexistenceProfile[] = [
	{
		id: "moorage-seo", name: "Moorage SEO", runtimeId: "r_inbafqkwqvftem5e",
		publisherDid: "did:plc:cus3srdqglppyowqrw3hvjfj", slug: "seo", assessedVersion: "0.1.4",
		configuredEntrypoints: ["@moorage/plugin-seo/sandbox"],
		surfaces: ["robots", "schema"], assessment: "observed-overlap",
	},
	{
		id: "seo-suite", name: "SEO Suite", runtimeId: "r_rl55rozdhl4kvs3b",
		publisherDid: "did:plc:suw5qc22clrlpslfo6qapiu4", slug: "seo-suite", assessedVersion: "0.2.0",
		configuredEntrypoints: [], surfaces: ["metadata", "robots", "schema"], assessment: "potential-overlap",
	},
	{
		id: "instant-indexer", name: "Instant Indexer", runtimeId: "r_zpe24qfq5pr2wkte",
		publisherDid: "did:plc:cmy7eqorxz2blqebuhw2qp7u", slug: "instant-indexer", assessedVersion: "1.0.1",
		configuredEntrypoints: [], surfaces: ["indexnow"], assessment: "potential-overlap",
	},
	{
		id: "rendered-seo-inspector", name: "Page SEO Inspector", runtimeId: "r_v3l5y3ruzcadejvp",
		publisherDid: "did:plc:kgx77rgc2zjjyfls66yvgdj2", slug: "rendered-seo-inspector", assessedVersion: "0.1.1",
		configuredEntrypoints: [], surfaces: [], assessment: "inspection-only",
	},
];

export interface CoexistenceConfiguredPlugin {
	id: string;
	entrypoint: string;
	version: string;
}

export interface CoexistenceStateRow {
	id: string;
	source: "config" | "registry" | "marketplace";
	version: string;
	status: "active" | "inactive";
	publisherDid: string | null;
	slug: string | null;
}

export type CoexistenceInventoryPreparation = {
	status: "ready";
	ids: string[];
	configured: CoexistenceConfiguredPlugin[];
} | { status: "unavailable"; reason: string };

export interface CoexistencePeer {
	profileId: CoexistenceProfileId;
	id: string;
	name: string;
	state: "active" | "inactive" | "absent";
	version: string | null;
	versionAssessment: "assessed" | "unassessed" | "absent";
	assessment: "observed-overlap" | "potential-overlap" | "inspection-only" | "unassessed" | "none";
	surfaces: CoexistenceSurface[];
}

export type CoexistenceInventory = {
	status: "available";
	scope: "checked-catalog";
	peers: CoexistencePeer[];
	paused: CoexistenceSurface[];
	uncheckedConfiguredCount: number;
} | {
	status: "unavailable";
	scope: "checked-catalog";
	reason: string;
	peers: CoexistencePeer[];
	paused: CoexistenceSurface[];
};

const encoder = new TextEncoder();
const SURFACES: readonly CoexistenceSurface[] = ["metadata", "robots", "schema", "indexnow"];
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
const VERSION_PATTERN = /^[A-Za-z0-9.+_-]+$/;

function ownDataRecord(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) return false;
	const prototype = Object.getPrototypeOf(input);
	if (prototype !== Object.prototype && prototype !== null) return false;
	const ownKeys = Reflect.ownKeys(input);
	return ownKeys.length === keys.length && keys.every((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(input, key);
		return descriptor !== undefined && Object.hasOwn(descriptor, "value");
	});
}

function boundedText(input: unknown, maximum: number): input is string {
	return typeof input === "string" && input.length > 0 && input.length <= maximum &&
		encoder.encode(input).byteLength <= maximum && input.trim() === input && !CONTROL_OR_INVISIBLE.test(input);
}

function identifier(input: unknown): input is string {
	return boundedText(input, 128) && ID_PATTERN.test(input);
}

function version(input: unknown): input is string {
	return boundedText(input, 128) && VERSION_PATTERN.test(input);
}

export function prepareCoexistenceInventory(configured: unknown): CoexistenceInventoryPreparation {
	if (!Array.isArray(configured) || configured.length > COEXISTENCE_MAX_CONFIGURED)
		return { status: "unavailable", reason: "Configured plugin inventory exceeds its supported bounds." };
	const ids = COEXISTENCE_PROFILES.map((profile) => profile.runtimeId);
	const seen = new Set(ids);
	const facts: CoexistenceConfiguredPlugin[] = [];
	for (const item of configured) {
		if (!ownDataRecord(item, ["id", "entrypoint", "version"]) || !identifier(item.id) ||
			!boundedText(item.entrypoint, COEXISTENCE_MAX_ENTRYPOINT_BYTES) || !version(item.version) || seen.has(item.id))
			return { status: "unavailable", reason: "Configured plugin identity is malformed or duplicated." };
		seen.add(item.id);
		ids.push(item.id);
		facts.push({ id: item.id, entrypoint: item.entrypoint, version: item.version });
	}
	return { status: "ready", ids, configured: facts };
}

export function unavailableCoexistenceInventory(reason = "Plugin inventory could not be verified."): CoexistenceInventory {
	return { status: "unavailable", scope: "checked-catalog", reason, peers: [], paused: [...SURFACES] };
}

function peerFor(profile: CoexistenceProfile, id: string, state: CoexistencePeer["state"], installedVersion: string | null): CoexistencePeer {
	const assessed = installedVersion === profile.assessedVersion;
	return {
		profileId: profile.id, id, name: profile.name, state, version: installedVersion,
		versionAssessment: installedVersion === null ? "absent" : assessed ? "assessed" : "unassessed",
		assessment: state !== "active" ? "none" : assessed ? profile.assessment :
			profile.surfaces.length > 0 ? "potential-overlap" : "unassessed",
		surfaces: state === "active" ? [...profile.surfaces] : [],
	};
}

export function classifyNativePluginInventory(input: { configured: unknown; rows: unknown }): CoexistenceInventory {
	const preparation = prepareCoexistenceInventory(input.configured);
	if (preparation.status !== "ready") return unavailableCoexistenceInventory(preparation.reason);
	if (!Array.isArray(input.rows) || input.rows.length > COEXISTENCE_MAX_IDS)
		return unavailableCoexistenceInventory("Plugin state inventory exceeds its supported bounds.");
	const configuredById = new Map(preparation.configured.map((item) => [item.id, item]));
	const expectedIds = new Set(preparation.ids);
	const registryById = new Map(COEXISTENCE_PROFILES.map((profile) => [profile.runtimeId, profile]));
	const rows = new Map<string, CoexistenceStateRow>();
	for (const item of input.rows) {
		if (!ownDataRecord(item, ["id", "source", "version", "status", "publisherDid", "slug"]) ||
			!identifier(item.id) || !expectedIds.has(item.id) || rows.has(item.id) || !version(item.version) ||
			(item.status !== "active" && item.status !== "inactive") ||
			(item.source !== "registry" && item.source !== "config" && item.source !== "marketplace"))
			return unavailableCoexistenceInventory("Plugin state identity or status could not be verified.");
		const profile = registryById.get(item.id);
		if (profile) {
			if (item.source !== "registry" || !boundedText(item.publisherDid, 512) || !identifier(item.slug) ||
				item.publisherDid !== profile.publisherDid || item.slug !== profile.slug)
				return unavailableCoexistenceInventory("Registry plugin identity could not be verified.");
		} else {
			const configured = configuredById.get(item.id);
			if (!configured || item.source !== "config" || item.publisherDid !== null || item.slug !== null ||
				item.version !== configured.version)
				return unavailableCoexistenceInventory("Configured plugin state could not be verified.");
		}
		rows.set(item.id, {
			id: item.id, source: item.source, version: item.version, status: item.status,
			publisherDid: item.publisherDid as string | null, slug: item.slug as string | null,
		});
	}
	const factsBytes = encoder.encode(JSON.stringify({ configured: preparation.configured, rows: [...rows.values()] })).byteLength;
	if (factsBytes > COEXISTENCE_MAX_OBSERVATION_BYTES)
		return unavailableCoexistenceInventory("Plugin observation exceeds its supported size.");
	const peers = COEXISTENCE_PROFILES.map((profile) => {
		const row = rows.get(profile.runtimeId);
		return peerFor(profile, profile.runtimeId, row?.status ?? "absent", row?.version ?? null);
	});
	let uncheckedConfiguredCount = 0;
	for (const configured of preparation.configured) {
		const profile = COEXISTENCE_PROFILES.find((candidate) => candidate.configuredEntrypoints.includes(configured.entrypoint));
		if (!profile) {
			uncheckedConfiguredCount += 1;
			continue;
		}
		peers.push(peerFor(profile, configured.id, rows.get(configured.id)?.status ?? "active", configured.version));
	}
	const paused = SURFACES.filter((surface) => peers.some((peer) => peer.surfaces.includes(surface)));
	const result: CoexistenceInventory = { status: "available", scope: "checked-catalog", peers, paused, uncheckedConfiguredCount };
	if (encoder.encode(JSON.stringify(result)).byteLength > COEXISTENCE_MAX_OBSERVATION_BYTES)
		return unavailableCoexistenceInventory("Plugin observation exceeds its supported size.");
	return result;
}

export interface CoexistenceRobotsContribution {
	kind: "meta";
	name: "robots";
	key: typeof COEXISTENCE_ROBOTS_KEY;
	content: string;
}

export interface CoexistenceRobotsInput {
	sources: unknown;
	siteNoindex?: unknown;
}

export interface CoexistenceRobotsProjection {
	status: "preserved" | "unresolved";
	contribution: CoexistenceRobotsContribution | null;
	unresolved: string[];
}

const MAX_ROBOTS_SOURCES = 8;
const MAX_ROBOTS_SOURCE_BYTES = 2048;
const MAX_ROBOTS_BYTES = 8192;
const NEGATIVE_ROBOTS = new Set(["noindex", "nofollow", "noarchive", "nosnippet", "noimageindex", "notranslate"]);
const PERMISSIVE_ROBOTS = new Set(["index", "follow", "all", "indexifembedded"]);

export function projectCoexistenceRobots(input: CoexistenceRobotsInput): CoexistenceRobotsProjection {
	const known = new Set<string>();
	const carried = new Map<string, string>();
	const limits = new Map<string, number>();
	const unresolved: string[] = [];
	const warn = (message: string) => { if (!unresolved.includes(message)) unresolved.push(message); };
	if (input.siteNoindex === true) {
		known.add("noindex");
		known.add("nofollow");
	} else if (input.siteNoindex !== undefined && input.siteNoindex !== false) {
		warn("The saved site indexing rule could not be read.");
	}
	const sources = Array.isArray(input.sources) && input.sources.length <= MAX_ROBOTS_SOURCES ? input.sources : [];
	if (!Array.isArray(input.sources) || input.sources.length > MAX_ROBOTS_SOURCES)
		warn("Robots sources exceed their supported bounds.");
	let totalBytes = 0;
	for (const source of sources) {
		if (source === null || source === undefined || source === "") continue;
		if (typeof source !== "string" || source.length > MAX_ROBOTS_SOURCE_BYTES) {
			warn("A robots source is malformed or exceeds its supported bounds.");
			continue;
		}
		const bytes = encoder.encode(source).byteLength;
		totalBytes += bytes;
		if (bytes > MAX_ROBOTS_SOURCE_BYTES || totalBytes > MAX_ROBOTS_BYTES || CONTROL_OR_INVISIBLE.test(source) || /[<>]/.test(source)) {
			warn("A robots source is malformed or exceeds its supported bounds.");
			continue;
		}
		for (const raw of source.split(",")) {
			const original = raw.trim();
			if (!original) continue;
			const token = original.toLowerCase();
			if (token === "none") {
				known.add("noindex");
				known.add("nofollow");
			} else if (NEGATIVE_ROBOTS.has(token)) {
				known.add(token);
			} else if (PERMISSIVE_ROBOTS.has(token)) {
				continue;
			} else if (/^max-image-preview\s*:\s*(?:none|standard|large)$/.test(token)) {
				const value = token.split(":")[1]!.trim();
				if (value !== "large") {
					const current = limits.get("max-image-preview");
					limits.set("max-image-preview", Math.min(current ?? 1, value === "none" ? 0 : 1));
				}
			} else {
				const match = /^(max-snippet|max-video-preview)\s*:\s*(-1|\d{1,10})$/.exec(token);
				if (match && Number(match[2]) <= 2147483647) {
					const value = Number(match[2]);
					if (value >= 0) limits.set(match[1]!, Math.min(limits.get(match[1]!) ?? value, value));
				} else {
					if (!carried.has(token)) carried.set(token, original);
					warn("Some saved robots rules need manual review; their original values are retained.");
				}
			}
		}
	}
	const tokens = [...known];
	for (const [key, value] of limits) tokens.push(key + ":" + (key === "max-image-preview" ? value === 0 ? "none" : "standard" : value));
	tokens.push(...carried.values());
	return {
		status: unresolved.length === 0 ? "preserved" : "unresolved",
		contribution: tokens.length > 0 ? { kind: "meta", name: "robots", key: COEXISTENCE_ROBOTS_KEY, content: tokens.join(",") } : null,
		unresolved,
	};
}
