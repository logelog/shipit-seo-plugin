// Builds the SEO package's dist with tsdown and TypeScript from the selected
// host graph, which pins the same versions as the package, so a checkout that
// installed only that graph can verify and pack. The options are read from the
// package's own build script; anything this reader does not understand stops
// the build instead of being ignored. `pnpm build` in the package is unchanged.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
import { canonicalPackages, createEnvironment, readManifest, seoPackageName } from "./environment.mjs";
import { preparePackageBuildTypes } from "./prepare-types.mjs";
import { packageBuildOptions, parsePackageBuildMode } from "./package-build-options.mjs";
import { preflightNativeRuntimeRefresh, writeRuntimeAdminEntry } from "./native-runtime-refresh.mjs";

const runtimeOnly = parsePackageBuildMode(process.argv.slice(2)) === "runtime-only";
const root = canonicalPackages.get(seoPackageName);
const script = readManifest(root).scripts?.build;
const options = packageBuildOptions(script, { runtimeOnly });
const environment = createEnvironment();
if (runtimeOnly) {
  await preflightNativeRuntimeRefresh(environment);
  console.log("Runtime-only native development output has no declarations. This is not verification or a release package; full verification restores normal output.");
}

const tsconfig = preparePackageBuildTypes(environment);
await build({ ...options, config: false, cwd: fileURLToPath(root), tsconfig });
if (runtimeOnly) {
  writeRuntimeAdminEntry(root);
  console.log(`Refreshed ${options.entry.length} native runtime entries without declarations; development output only.`);
} else {
  const linked = spawnSync(process.execPath, ["scripts/link-admin-css.mjs"], { cwd: fileURLToPath(root), stdio: "inherit" });
  if (linked.error) throw linked.error;
  if (linked.status !== 0) process.exit(linked.status ?? 1);
  console.log(`Built ${options.entry.length} package entries with the host graph's tsdown.`);
}
