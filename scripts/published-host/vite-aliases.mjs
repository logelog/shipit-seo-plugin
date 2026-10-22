import { fileURLToPath } from "node:url";
import { canonicalExports, fixtureRoot, readManifest, runtimeExport, runtimeTarget } from "./environment.mjs";

const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function viteAliases(environment, { canonical = true, exclude = [] } = {}) {
  const aliases = [];
  if (canonical) {
    for (const [name, target] of canonicalExports()) {
      aliases.push({ find: new RegExp(`^${escape(name)}$`), replacement: fileURLToPath(target) });
    }
  }
  for (const name of Object.keys(readManifest(fixtureRoot).dependencies)) {
    if (exclude.includes(name)) continue;
    // Bare React imports retain Vite's platform exports and CommonJS externalization.
    if (name === "react" || name === "react-dom") continue;
    const root = environment.hostPackageRoot(name);
    const manifest = readManifest(root);
    const exports = typeof manifest.exports === "object" ? manifest.exports : { ".": manifest.exports };
    aliases.push({ find: new RegExp(`^${escape(name)}$`), replacement: fileURLToPath(runtimeExport(environment, name)) });
    for (const [subpath, value] of Object.entries(exports ?? {})) {
      if (subpath === "." || !subpath.startsWith("./")) continue;
      const target = runtimeTarget(value);
      if (!target) continue;
      const specifier = `${name}/${subpath.slice(2)}`;
      aliases.push({
        find: new RegExp(`^${specifier.split("*").map(escape).join("(.*)")}$`),
        replacement: fileURLToPath(new URL(target, root)).replace("*", "$1"),
      });
    }
  }
  return aliases;
}
