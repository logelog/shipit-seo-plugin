// Registry manifest fields owned by the product. Publisher, license, author and
// security contacts are release decisions and are supplied at bundle time.
import { SEO_ENGINE_PLUGIN_ID, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import { seoPlugin } from "./index.ts";
import { SEO_OVERVIEW_PANEL, SEO_REGISTRY_STORAGE } from "./registry-panel.ts";

// Indexes must match the native descriptor: the host drops tracked indexes a
// declaration no longer lists. The plugin CLI only accepts collection names
// matching REGISTRY_STORAGE_NAME, so the camelCase analysisProfiles,
// metaOverrides and socialOverrides collections read as empty in this build.
const REGISTRY_STORAGE_NAME = /^[a-z][a-z0-9_]*$/;

export function seoRegistryManifest() {
	const storage = seoPlugin().storage ?? {};
	return {
		slug: SEO_ENGINE_PLUGIN_ID,
		version: SEO_ENGINE_VERSION,
		capabilities: ["content:read", "content:revisions:read", "schema:read"],
		allowedHosts: [] as string[],
		storage: Object.fromEntries(SEO_REGISTRY_STORAGE.map((name) => {
			const declared = storage[name];
			if (!declared) throw new Error(`Native descriptor has no ${name} storage`);
			if (!REGISTRY_STORAGE_NAME.test(name)) throw new Error(`${name} is not a valid registry storage name`);
			return [name, { indexes: declared.indexes }];
		})),
		admin: { editorPanels: [{ ...SEO_OVERVIEW_PANEL, collections: [...SEO_OVERVIEW_PANEL.collections] }] },
	};
}
