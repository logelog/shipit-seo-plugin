import { SEO_ENGINE_PLUGIN_ID } from "@shipitseo/emdash-plugin-seo/admin-contract";

/** EmDash's plugins manager, where a disabled plugin is enabled again. */
export const SEO_PLUGINS_MANAGER_URL = "/_emdash/admin/plugins-manager";

/** EmDash caches its admin manifest under this key before any plugin page renders. */
export const SEO_HOST_MANIFEST_KEY = ["manifest"] as const;

export type SeoPluginManifestState = "enabled" | "disabled" | "unknown";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The plugin's `enabled` flag in the EmDash admin manifest. */
export function seoPluginManifestState(manifest: unknown): SeoPluginManifestState {
	if (!isRecord(manifest) || !isRecord(manifest.plugins) || !Object.hasOwn(manifest.plugins, SEO_ENGINE_PLUGIN_ID)) return "unknown";
	const entry = manifest.plugins[SEO_ENGINE_PLUGIN_ID];
	if (!isRecord(entry) || typeof entry.enabled !== "boolean") return "unknown";
	return entry.enabled ? "enabled" : "disabled";
}

/**
 * EmDash's answer for a plugin route it has not registered. A disabled plugin
 * registers none, so every one of its routes answers this way; a not-found
 * result from the plugin itself carries its own message.
 */
export function isSeoPluginRouteMissing(error: unknown): boolean {
	return isRecord(error) && error.status === 404 && error.code === "NOT_FOUND" && error.message === "Plugin route not found";
}

/** A manifest that says enabled outweighs a missing route; an unknown manifest does not. */
export function seoPluginDisabled(manifest: SeoPluginManifestState, routeMissing: boolean): boolean {
	return manifest === "disabled" || (routeMissing && manifest !== "enabled");
}

export interface SeoPluginAvailabilityWatch {
	/** Records a failed plugin request. Only the first missing route asks EmDash to read its manifest again. */
	report: (error: unknown) => void;
	routeMissing: () => boolean;
	subscribe: (listener: () => void) => () => void;
}

export function createSeoPluginAvailabilityWatch(refreshManifest: () => void): SeoPluginAvailabilityWatch {
	let missing = false;
	const listeners = new Set<() => void>();
	return {
		report(error) {
			if (missing || !isSeoPluginRouteMissing(error)) return;
			missing = true;
			refreshManifest();
			for (const listener of listeners) listener();
		},
		routeMissing: () => missing,
		subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
	};
}
