import { registerHooks } from "node:module";
import { canonicalExports, canonicalPackages, createEnvironment, fixtureRoot, sourceRoot } from "./environment.mjs";

export { sourceRoot };
export const { target, hostRoot, hostModules, hostPackageRoot, assertVersions } = createEnvironment();
assertVersions();
const exports = canonicalExports();
const sourcePrefixes = [...canonicalPackages.values(), new URL("scripts/published-host/", sourceRoot), fixtureRoot].map(url => url.href);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const canonical = exports.get(specifier);
    if (canonical) return nextResolve(canonical.href, context);
    const bare = !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.includes(":") && !specifier.startsWith("#");
    const parent = context.parentURL ?? "";
    if (!bare || parent.includes("/node_modules/") || !sourcePrefixes.some(prefix => parent.startsWith(prefix))) {
      return nextResolve(specifier, context);
    }
    for (const anchor of [new URL(".published-host.mjs", hostRoot), new URL(".pnpm/node_modules/.published-host.mjs", hostModules)]) {
      try { return nextResolve(specifier, { ...context, parentURL: anchor.href }); }
      catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
    }
    throw new Error(`Cannot resolve ${specifier} in the selected published host dependency graph`);
  },
});
