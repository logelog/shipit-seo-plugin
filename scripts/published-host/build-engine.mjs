import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";
import { canonicalPackages, createEnvironment, outputRoot, readManifest, seoPackageName } from "./environment.mjs";
import { prepareTypes } from "./prepare-types.mjs";

const root = canonicalPackages.get(seoPackageName);
const sourceNames = new Map([[".", "index"], ["./plugin", "native-entry"], ["./sandbox", "sandbox-entry"]]);
const serverEntries = Object.keys(readManifest(root).exports)
  .filter(subpath => subpath !== "./admin")
  .map(subpath => `./src/${sourceNames.get(subpath) ?? subpath.slice(2)}.ts`);
if (serverEntries.some(entry => !existsSync(new URL(entry, root)))) {
  throw new Error("SEO server exports require matching source entrypoints for this build check");
}
const tsconfig = prepareTypes(createEnvironment()).engine;
await build({
  config: false,
  cwd: fileURLToPath(root), entry: serverEntries, format: ["esm"], dts: true, platform: "neutral",
  tsconfig, outDir: fileURLToPath(new URL("engine-dist/", outputRoot)), clean: true,
  external: ["emdash", "emdash/plugin", "astro", "astro/zod", "node:fs"],
});
