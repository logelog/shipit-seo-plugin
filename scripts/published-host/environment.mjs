import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCompatibility, selectCompatibilityTarget } from "../compatibility.mjs";

export const sourceRoot = new URL("../../", import.meta.url);
export const seoPackageRoot = new URL("packages/emdash-plugin-seo/", sourceRoot);
export const seoPackageName = JSON.parse(readFileSync(new URL("package.json", seoPackageRoot), "utf8")).name;
export const canonicalPackages = new Map([
  [seoPackageName, seoPackageRoot],
  // Compatibility fixtures may still use the previous package specifier.
  ["@shipit/emdash-plugin-seo", seoPackageRoot],
]);

// Runtime and tooling select the same current or retained compatibility target.
const compatibility = readCompatibility(sourceRoot);
export const defaultHostTarget = compatibility.currentTarget;

export function selectHostTarget(name = process.env.SHIPIT_HOST_TARGET || defaultHostTarget) {
  if (!Object.hasOwn(compatibility.targets, name)) {
    throw new Error(`Unknown host target ${name}. Select one of: ${Object.keys(compatibility.targets).join(", ")}`);
  }
  const target = selectCompatibilityTarget(compatibility, name);
  return {
    name,
    fixtureRoot: new URL(target.dependencyRoot + "/", sourceRoot),
    stateRoot: new URL(`.dev/native-host-${target.emdash}/`, sourceRoot),
    outputRoot: new URL(`artifacts/native-host-${target.emdash}/`, sourceRoot),
    port: target.port,
    configFile: "astro.native.config.mjs",
    consumerSource: "src-native/",
    versions: new Map(Object.entries(target.versions)),
  };
}

export function assertVerificationMode(target, mode) {
  selectCompatibilityTarget(compatibility, target.name, { mode });
}

export const hostTarget = selectHostTarget();
export const fixtureRoot = hostTarget.fixtureRoot;
export const outputRoot = hostTarget.outputRoot;
export const hostVersions = hostTarget.versions;

export function reviewOutputRoot(target = hostTarget) {
  return target.outputRoot;
}

export function readManifest(root) {
  return JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
}

export function createEnvironment(hostPath = process.env.SHIPIT_PUBLISHED_HOST, target = hostTarget) {
  const hostRoot = hostPath ? pathToFileURL(`${resolve(hostPath)}/`) : target.fixtureRoot;
  const hostModules = new URL("node_modules/", hostRoot);
  function hostPackageRoot(name) {
    for (const prefix of [hostModules, new URL(".pnpm/node_modules/", hostModules)]) {
      const candidate = new URL(`${name}/`, prefix);
      if (existsSync(new URL("package.json", candidate))) {
        return pathToFileURL(`${realpathSync(fileURLToPath(candidate))}/`);
      }
    }
    throw new Error(`Missing published-host dependency ${name}. Install the fixture or select --host PATH.`);
  }
  function assertVersions() {
    for (const [name, expected] of target.versions) {
      const version = readManifest(hostPackageRoot(name)).version;
      if (version !== expected) throw new Error(`${name} must be ${expected} for ${target.name}; found ${version}`);
    }
  }
  return { target, hostRoot, hostModules, hostPackageRoot, assertVersions };
}

export function canonicalExports() {
  const targets = new Map();
  for (const [name, root] of canonicalPackages) {
    for (const [subpath, entry] of Object.entries(readManifest(root).exports)) {
      const target = typeof entry === "string" ? entry : entry.default ?? entry.import ?? entry.types;
      if (typeof target !== "string") throw new Error(`Unsupported canonical export ${name}${subpath}`);
      targets.set(subpath === "." ? name : `${name}/${subpath.slice(2)}`, new URL(target, root));
    }
  }
  return targets;
}

export function runtimeTarget(value) {
  if (typeof value === "string") return /\.d\.[cm]?ts$/.test(value) ? null : value;
  if (!value || typeof value !== "object") return null;
  return runtimeTarget(value.import) ?? runtimeTarget(value.default);
}

export function runtimeExport(environment, name, subpath = ".") {
  const root = environment.hostPackageRoot(name);
  const manifest = readManifest(root);
  const exports = manifest.exports;
  const target = runtimeTarget(typeof exports === "string" ? exports : exports?.[subpath]) ??
    (subpath === "." ? manifest.module ?? manifest.main : null);
  if (typeof target !== "string") throw new Error(`Missing runtime export ${name}:${subpath}`);
  return new URL(target, root);
}

export function parseOptions(args) {
  let hostPath;
  let targetName;
  let quick = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--host" && !hostPath && args[index + 1] && !args[index + 1].startsWith("--")) {
      hostPath = args[++index];
    } else if (args[index] === "--target" && !targetName && args[index + 1] && !args[index + 1].startsWith("--")) {
      targetName = args[++index];
    } else if (args[index] === "--quick" && !quick) {
      quick = true;
    } else {
      throw new Error("Usage: node scripts/published-host/verify.mjs [--target NAME] [--host PATH] [--quick]");
    }
  }
  return { hostPath, quick, target: selectHostTarget(targetName) };
}

export function childEnvironment(environment) {
  return {
    ...process.env,
    SHIPIT_HOST_TARGET: environment.target.name,
    SHIPIT_PUBLISHED_HOST: fileURLToPath(environment.hostRoot),
    ASTRO_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: [process.env.NODE_OPTIONS ?? "", "--max-old-space-size=2048", `--import=${new URL("host-loader.mjs", import.meta.url).href}`].filter(Boolean).join(" "),
  };
}
