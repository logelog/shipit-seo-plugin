import {
	classifyNativePluginInventory,
	prepareCoexistenceInventory,
	type CoexistenceInventory,
} from "./plugin-coexistence.ts";
import { readNativePluginStates } from "./plugin-coexistence-native-source.ts";
import type { CoexistenceHost } from "./plugin-coexistence-runtime.ts";

export function createNativeCoexistenceHost(options: {
	openDatabase: () => Promise<unknown>;
	configured: unknown;
}): CoexistenceHost {
	const prepared = prepareCoexistenceInventory(options.configured);
	return {
		async observe(): Promise<CoexistenceInventory> {
			if (prepared.status !== "ready") return {
				status: "unavailable", scope: "checked-catalog", reason: prepared.reason,
				peers: [], paused: ["metadata", "robots", "schema", "indexnow"],
			};
			try {
				const rows = await readNativePluginStates(await options.openDatabase(), prepared.ids);
				return classifyNativePluginInventory({ configured: prepared.configured, rows });
			} catch {
				return {
					status: "unavailable", scope: "checked-catalog", reason: "Plugin state could not be read.",
					peers: [], paused: ["metadata", "robots", "schema", "indexnow"],
				};
			}
		},
	};
}
