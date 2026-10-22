// Exact-ID plugin-state observation for the native EmDash 1.3 host.
// Read only projected state; display names and declared hooks are not identities.

const STATE_COLUMNS = [
	["plugin_id", "id", 128],
	["source", "source", 16],
	["status", "status", 16],
	["version", "version", 128],
	["registry_publisher_did", "publisherDid", 512],
	["registry_slug", "slug", 128],
] as const;

export const COEXISTENCE_NATIVE_ID_LIMIT = 32;

export async function readNativePluginStates(database: unknown, ids: readonly string[]): Promise<unknown[]> {
	if (!Array.isArray(ids) || ids.length > COEXISTENCE_NATIVE_ID_LIMIT ||
		ids.some((id) => typeof id !== "string" || id.length > 128 || !/^[a-z][a-z0-9_-]*$/.test(id)) ||
		new Set(ids).size !== ids.length) {
		throw new TypeError("Plugin-state observation needs at most 32 unique plugin IDs.");
	}
	if (ids.length === 0) return [];
	// The host owns the Kysely connection and its lifetime.
	const db = database as any;
	if (!db || typeof db.selectFrom !== "function") throw new TypeError("Plugin-state observation needs the host database.");
	const rows = await db.selectFrom("_plugin_state")
		.select((expression: any) => STATE_COLUMNS.map(([name, alias, maximum]) =>
			expression.fn("substr", [expression.ref(name), expression.val(1), expression.val(maximum + 1)]).as(alias)))
		.where("plugin_id", "in", [...ids])
		.limit(COEXISTENCE_NATIVE_ID_LIMIT)
		.execute();
	if (!Array.isArray(rows) || rows.length > COEXISTENCE_NATIVE_ID_LIMIT) {
		throw new Error("Plugin-state observation exceeded its row limit.");
	}
	return rows;
}
