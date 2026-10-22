import {
	COEXISTENCE_MAX_CONFIGURED,
	COEXISTENCE_MAX_IDS,
	COEXISTENCE_MAX_OBSERVATION_BYTES,
	COEXISTENCE_PROFILES,
	classifyNativePluginInventory,
	type CoexistenceConfiguredPlugin,
	type CoexistenceInventory,
	type CoexistencePeer,
	type CoexistenceStateRow,
	type CoexistenceSurface,
} from "../plugin-coexistence.ts";
import type { SeoAdminView } from "./content-extension-model.ts";

export type PluginCoexistenceObservation = CoexistenceInventory | {
	status: "unsupported";
	scope: "checked-catalog";
	message: string;
};

export type PluginCoexistenceReadState = { status: "loading" } | {
	status: "ready";
	inventory: PluginCoexistenceObservation;
} | {
	status: "error";
	kind: "denied" | "timeout" | "unavailable";
	message: string;
};

export const PLUGIN_COEXISTENCE_SURFACE_LABELS: Record<CoexistenceSurface, string> = {
	metadata: "Search & social", robots: "Robots meta tags", schema: "Schema", indexnow: "IndexNow",
};

/** Pages whose output a paused surface stops; Sitemaps and robots.txt are not coexistence surfaces. */
export const PLUGIN_COEXISTENCE_VIEW_SURFACES: Readonly<Partial<Record<SeoAdminView, readonly CoexistenceSurface[]>>> = {
	social: ["metadata"],
	templates: ["metadata"],
	indexing: ["robots"],
	schema: ["schema"],
	library: ["schema"],
	indexnow: ["indexnow"],
};

export interface PluginOverlapRow {
	profileId: CoexistencePeer["profileId"];
	name: string;
	versions: string[];
	assessment: "observed-overlap" | "potential-overlap";
	versionUnassessed: boolean;
	surfaces: CoexistenceSurface[];
}

/** One row per overlapping plugin; a registry and a configured copy of one profile share it. */
export function pluginOverlapRows(inventory: Pick<CoexistenceInventory, "peers">): PluginOverlapRow[] {
	const rows = new Map<string, PluginOverlapRow>();
	for (const peer of inventory.peers) {
		if (peer.state !== "active" || peer.surfaces.length === 0) continue;
		const row = rows.get(peer.profileId) ?? {
			profileId: peer.profileId, name: peer.name, versions: [], assessment: "potential-overlap",
			versionUnassessed: false, surfaces: [],
		};
		if (peer.version && !row.versions.includes(peer.version)) row.versions.push(peer.version);
		if (peer.assessment === "observed-overlap") row.assessment = "observed-overlap";
		if (peer.versionAssessment === "unassessed") row.versionUnassessed = true;
		for (const surface of peer.surfaces) if (!row.surfaces.includes(surface)) row.surfaces.push(surface);
		rows.set(peer.profileId, row);
	}
	const order = ALL_SURFACES as readonly string[];
	return [...rows.values()].map((row) => ({ ...row, surfaces: [...row.surfaces].sort((a, b) => order.indexOf(a) - order.indexOf(b)) }));
}

/** Only an active overlapping plugin produces a notice; failed or unavailable checks stay in Feature controls. */
export function pluginOverlapForView(
	state: PluginCoexistenceReadState,
	view: SeoAdminView,
): { names: string[]; surfaces: CoexistenceSurface[] } | null {
	if (state.status !== "ready" || state.inventory.status !== "available") return null;
	const viewSurfaces = view === "overview" ? null : PLUGIN_COEXISTENCE_VIEW_SURFACES[view];
	if (view !== "overview" && !viewSurfaces) return null;
	const rows = pluginOverlapRows(state.inventory)
		.filter((row) => !viewSurfaces || row.surfaces.some((surface) => viewSurfaces.includes(surface)));
	if (!rows.length) return null;
	const surfaces = (ALL_SURFACES as CoexistenceSurface[]).filter((surface) =>
		rows.some((row) => row.surfaces.includes(surface)) && (!viewSurfaces || viewSurfaces.includes(surface)));
	return { names: rows.map((row) => row.name), surfaces };
}

const encoder = new TextEncoder();
const ALL_SURFACES = ["metadata", "robots", "schema", "indexnow"];

function record(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) return false;
	const prototype = Object.getPrototypeOf(input);
	return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(input).length === keys.length &&
		keys.every((key) => Object.hasOwn(Object.getOwnPropertyDescriptor(input, key) ?? {}, "value"));
}

function message(input: unknown): input is string {
	return typeof input === "string" && input.trim().length > 0 && encoder.encode(input).byteLength <= 512 &&
		!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(input);
}

function equalList(input: unknown, expected: readonly string[]): boolean {
	return Array.isArray(input) && input.length === expected.length && input.every((value, index) => value === expected[index]);
}

function equalPeer(input: Record<string, unknown>, expected: CoexistencePeer): boolean {
	return input.profileId === expected.profileId && input.id === expected.id && input.name === expected.name &&
		input.state === expected.state && input.version === expected.version && input.versionAssessment === expected.versionAssessment &&
		input.assessment === expected.assessment && equalList(input.surfaces, expected.surfaces);
}

export function parsePluginCoexistenceObservation(input: unknown): PluginCoexistenceObservation | null {
	try {
		if (encoder.encode(JSON.stringify(input)).byteLength > COEXISTENCE_MAX_OBSERVATION_BYTES) return null;
		if (record(input, ["status", "scope", "message"]) && input.status === "unsupported" &&
			input.scope === "checked-catalog" && message(input.message))
			return { status: "unsupported", scope: "checked-catalog", message: input.message };
		if (record(input, ["status", "scope", "reason", "peers", "paused"]) && input.status === "unavailable" &&
			input.scope === "checked-catalog" && message(input.reason) && Array.isArray(input.peers) && input.peers.length === 0 &&
			equalList(input.paused, ALL_SURFACES))
			return { status: "unavailable", scope: "checked-catalog", reason: input.reason, peers: [], paused: ["metadata", "robots", "schema", "indexnow"] };
		if (!record(input, ["status", "scope", "peers", "paused", "uncheckedConfiguredCount"]) || input.status !== "available" ||
			input.scope !== "checked-catalog" || !Array.isArray(input.peers) || input.peers.length < 4 || input.peers.length > COEXISTENCE_MAX_IDS ||
			!Number.isInteger(input.uncheckedConfiguredCount) || (input.uncheckedConfiguredCount as number) < 0 ||
			(input.uncheckedConfiguredCount as number) > COEXISTENCE_MAX_CONFIGURED) return null;
		const rows: CoexistenceStateRow[] = [];
		const configured: CoexistenceConfiguredPlugin[] = [];
		const peers = new Map<string, Record<string, unknown>>();
		const registryIds = new Set(COEXISTENCE_PROFILES.map((profile) => profile.runtimeId));
		for (const item of input.peers) {
			if (!record(item, ["profileId", "id", "name", "state", "version", "versionAssessment", "assessment", "surfaces"]) ||
				typeof item.id !== "string" || peers.has(item.id)) return null;
			const profile = COEXISTENCE_PROFILES.find((candidate) => candidate.id === item.profileId);
			if (!profile || item.name !== profile.name || (item.state !== "active" && item.state !== "inactive" && item.state !== "absent")) return null;
			const registry = registryIds.has(item.id);
			if (registry && item.id !== profile.runtimeId) return null;
			if (item.state === "absent") {
				if (!registry || item.version !== null) return null;
			} else {
				if (typeof item.version !== "string") return null;
				if (!registry) {
					const entrypoint = profile.configuredEntrypoints[0];
					if (!entrypoint) return null;
					configured.push({ id: item.id, entrypoint, version: item.version });
				}
				rows.push({
					id: item.id, source: registry ? "registry" : "config", version: item.version, status: item.state,
					publisherDid: registry ? profile.publisherDid : null, slug: registry ? profile.slug : null,
				});
			}
			peers.set(item.id, item);
		}
		if (configured.length + (input.uncheckedConfiguredCount as number) > COEXISTENCE_MAX_CONFIGURED) return null;
		const expected = classifyNativePluginInventory({ configured, rows });
		if (expected.status !== "available" || peers.size !== expected.peers.length ||
			!expected.peers.every((peer) => equalPeer(peers.get(peer.id) ?? {}, peer)) || !equalList(input.paused, expected.paused)) return null;
		return { ...expected, uncheckedConfiguredCount: input.uncheckedConfiguredCount as number };
	} catch {
		return null;
	}
}

export async function boundedPluginCoexistenceResponse(response: Response, signal: AbortSignal): Promise<Response> {
	if (signal.aborted) throw signal.reason;
	const declaredLength = response.headers.get("content-length");
	if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > COEXISTENCE_MAX_OBSERVATION_BYTES)) {
		await response.body?.cancel();
		throw new Error("The plugin response exceeds its supported size.");
	}
	const reader = response.body?.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	const abort = () => { void reader?.cancel().catch(() => {}); };
	signal.addEventListener("abort", abort, { once: true });
	try {
		if (reader) for (;;) {
			const next = await reader.read();
			if (signal.aborted) throw signal.reason;
			if (next.done) break;
			size += next.value.byteLength;
			if (size > COEXISTENCE_MAX_OBSERVATION_BYTES) {
				await reader.cancel();
				throw new Error("The plugin response exceeds its supported size.");
			}
			chunks.push(next.value);
		}
	} finally {
		signal.removeEventListener("abort", abort);
		reader?.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return new Response(bytes, { status: response.status, statusText: response.statusText, headers: { "content-type": "application/json" } });
}

export interface PluginCoexistenceReader {
	load(): Promise<void>;
	dispose(): void;
}

export function createPluginCoexistenceReader(options: {
	read: (signal: AbortSignal) => Promise<unknown>;
	onState: (state: PluginCoexistenceReadState) => void;
	timeoutMs?: number;
}): PluginCoexistenceReader {
	let generation = 0;
	let disposed = false;
	let pending: AbortController | null = null;
	return {
		async load() {
			if (disposed) return;
			const request = ++generation;
			pending?.abort(new DOMException("A newer check started.", "AbortError"));
			const controller = new AbortController();
			pending = controller;
			options.onState({ status: "loading" });
			const timer = setTimeout(() => controller.abort(new DOMException("The plugin check timed out.", "TimeoutError")),
				Math.min(10000, Math.max(1, options.timeoutMs ?? 10000)));
			let cancel: () => void = () => {};
			const cancelled = new Promise<never>((_, reject) => {
				cancel = () => reject(controller.signal.reason);
				controller.signal.addEventListener("abort", cancel, { once: true });
			});
			try {
				const raw = await Promise.race([Promise.resolve().then(() => {
					if (controller.signal.aborted) throw controller.signal.reason;
					return options.read(controller.signal);
				}), cancelled]);
				if (disposed || generation !== request) return;
				const inventory = parsePluginCoexistenceObservation(raw);
				if (!inventory) throw new Error("The plugin response could not be verified.");
				options.onState({ status: "ready", inventory });
			} catch (error) {
				if (disposed || generation !== request) return;
				const denied = typeof error === "object" && error !== null && "status" in error && error.status === 403;
				const timeout = error instanceof Error && error.name === "TimeoutError";
				options.onState({
					status: "error", kind: denied ? "denied" : timeout ? "timeout" : "unavailable",
					message: denied ? "You need permission to read plugin status." : timeout ? "The check timed out. Try again when ready." :
						"Plugin status could not be verified. Check again when ready.",
				});
			} finally {
				clearTimeout(timer);
				controller.signal.removeEventListener("abort", cancel);
				if (pending === controller) pending = null;
			}
		},
		dispose() {
			disposed = true;
			generation += 1;
			pending?.abort(new DOMException("The plugin check closed.", "AbortError"));
			pending = null;
		},
	};
}
