import type { CoexistenceInventory, CoexistenceSurface } from "./plugin-coexistence.ts";

export interface CoexistenceHost {
	observe(): Promise<CoexistenceInventory>;
}

// Only the host port is retained; every observation reads current activation state.
const hosts = new WeakMap<object, CoexistenceHost>();

export function bindCoexistenceHost(ctx: object, host: CoexistenceHost): void {
	hosts.set(ctx, host);
}

export async function readCoexistenceInventory(ctx: object): Promise<CoexistenceInventory | null> {
	const host = hosts.get(ctx);
	if (!host) return null;
	try {
		return await host.observe();
	} catch {
		return {
			status: "unavailable", scope: "checked-catalog", reason: "Plugin state could not be read.",
			peers: [], paused: ["metadata", "robots", "schema", "indexnow"],
		};
	}
}

export async function coexistenceAdmission(ctx: object, surface: CoexistenceSurface): Promise<boolean> {
	const observation = await readCoexistenceInventory(ctx);
	// The shared sandbox engine has no native inventory port; parity is separate.
	return observation === null || !observation.paused.includes(surface);
}
