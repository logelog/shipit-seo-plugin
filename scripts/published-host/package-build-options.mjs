export function parsePackageBuildMode(args) {
  if (Array.isArray(args) && args.length === 0) return "full";
  if (Array.isArray(args) && args.length === 1 && args[0] === "--runtime-only") return "runtime-only";
  throw new Error("Usage: build-package.mjs [--runtime-only]");
}

export function packageBuildOptions(script, { runtimeOnly = false } = {}) {
  const [command, postBuild, ...more] = typeof script === "string" ? script.split(" && ") : [];
  if (!command || postBuild !== "node scripts/link-admin-css.mjs" || more.length) {
    throw new Error(`Unexpected package build script: ${script}`);
  }
  const tokens = command.trim().split(/\s+/);
  if (tokens.shift() !== "tsdown") throw new Error(`The package build does not run tsdown: ${script}`);
  const options = { entry: [], external: [] };
  while (tokens.length && !tokens[0].startsWith("--")) options.entry.push(tokens.shift());
  while (tokens.length) {
    const flag = tokens.shift();
    const value = () => {
      const next = tokens.shift();
      if (!next || next.startsWith("--")) throw new Error(`${flag} needs a value in the package build script`);
      return next;
    };
    if (flag === "--out-dir") options.outDir = value();
    else if (flag === "--format") options.format = [value()];
    else if (flag === "--platform") options.platform = value();
    else if (flag === "--external") options.external.push(value());
    else if (flag === "--dts") options.dts = true;
    else if (flag === "--clean") options.clean = true;
    else throw new Error(`Unsupported flag ${flag} in the package build script`);
  }
  if (!options.entry.length || !options.outDir) throw new Error(`The package build script names no entries or output: ${script}`);
  if (runtimeOnly) options.dts = false;
  return options;
}
