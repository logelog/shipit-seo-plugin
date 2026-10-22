import { adaptSandboxEntry } from "emdash";
import { seoInstallation, seoPlugin } from "../../packages/emdash-plugin-seo/src/index.ts";
import { createNativeCoexistenceHost } from "../../packages/emdash-plugin-seo/src/plugin-coexistence-native-host.ts";
import { createSeoEngine } from "../../packages/emdash-plugin-seo/src/sandbox-entry.ts";

// Standalone SQLite contexts have no Astro loader; their native reads share the supplied database.
export function createSqliteSeoFixture(database, options = {}) {
  return adaptSandboxEntry(createSeoEngine(seoInstallation(options), {
    coexistence: createNativeCoexistenceHost({
      openDatabase: async () => database,
      configured: options.installation?.configuredPlugins === undefined ? [] : options.installation.configuredPlugins,
    }),
  }), seoPlugin(options));
}
