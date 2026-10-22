import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const compatibilityRoot = fileURLToPath(new URL("../", import.meta.url));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const hashPattern = /^[a-f0-9]{64}$/;

function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`Invalid ${label} fields.`);
  }
}

function version(value, label) {
  if (typeof value !== "string" || !versionPattern.test(value)) throw new Error(`${label} must be an exact version.`);
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function validateCompatibility(policy) {
  object(policy, ["schemaVersion", "currentTarget", "retainedTargets", "toolchain", "targets"], "compatibility policy");
  if (policy.schemaVersion !== 1) throw new Error("Unsupported compatibility schema version.");
  object(policy.toolchain, ["node", "nodeRange", "pnpm", "astro"], "toolchain");
  for (const name of ["node", "pnpm", "astro"]) version(policy.toolchain[name], name);
  const nextNodeMajor = Number(policy.toolchain.node.split(".")[0]) + 1;
  if (policy.toolchain.nodeRange !== `>=${policy.toolchain.node} <${nextNodeMajor}`) {
    throw new Error("nodeRange must start at the pinned Node version and end before the next major.");
  }
  if (!policy.targets || typeof policy.targets !== "object" || Array.isArray(policy.targets) || !Object.keys(policy.targets).length) {
    throw new Error("At least one compatibility target is required.");
  }
  const ports = new Set();
  for (const [name, target] of Object.entries(policy.targets)) {
    object(target, ["emdash", "admin", "dependencyRoot", "port", "verifyModes", "reviewedLockSha256"], `target ${name}`);
    version(target.emdash, `${name} EmDash`);
    version(target.admin, `${name} admin`);
    if (name !== `native-${target.emdash}`) throw new Error(`Target ${name} must match its EmDash version.`);
    if (target.dependencyRoot !== `integration/emdash/published-host-${target.emdash}`) {
      throw new Error(`Unexpected dependency root for ${name}.`);
    }
    if (!Number.isSafeInteger(target.port) || target.port < 1024 || target.port > 65535 || ports.has(target.port)) {
      throw new Error(`Invalid or duplicate port for ${name}.`);
    }
    ports.add(target.port);
    if (!Array.isArray(target.verifyModes) || !target.verifyModes.length ||
        target.verifyModes.some(mode => !["quick", "full"].includes(mode)) || new Set(target.verifyModes).size !== target.verifyModes.length) {
      throw new Error(`Invalid verification modes for ${name}.`);
    }
    if (target.reviewedLockSha256 !== null && (typeof target.reviewedLockSha256 !== "string" || !hashPattern.test(target.reviewedLockSha256))) {
      throw new Error(`Invalid reviewed lock hash for ${name}.`);
    }
  }
  if (typeof policy.currentTarget !== "string" || !Object.hasOwn(policy.targets, policy.currentTarget)) {
    throw new Error("The current target is not defined.");
  }
  if (!Array.isArray(policy.retainedTargets) || policy.retainedTargets.some(name => typeof name !== "string" ||
      name === policy.currentTarget || !Object.hasOwn(policy.targets, name)) || new Set(policy.retainedTargets).size !== policy.retainedTargets.length) {
    throw new Error("Invalid retained compatibility targets.");
  }
  return freeze(policy);
}

export function readCompatibility(root = compatibilityRoot) {
  const directory = root instanceof URL ? fileURLToPath(root) : root;
  return validateCompatibility(JSON.parse(readFileSync(path.join(directory, "compatibility.json"), "utf8")));
}

export function expectedPackagePins(policy, name = policy.currentTarget) {
  const target = policy.targets[name];
  if (!Object.hasOwn(policy.targets, name)) throw new Error(`Unknown compatibility target ${name}.`);
  return { emdash: target.emdash, "@emdash-cms/admin": target.admin, astro: policy.toolchain.astro };
}

export function selectCompatibilityTarget(policy, name = policy.currentTarget, { mode, requireReviewedLock = false } = {}) {
  if (!Object.hasOwn(policy.targets, name)) throw new Error(`Unknown compatibility target ${name}.`);
  const target = policy.targets[name];
  if (mode !== undefined && !target.verifyModes.includes(mode)) {
    throw new Error(`${mode} verification is not implemented for ${name}. Available modes: ${target.verifyModes.join(", ")}.`);
  }
  if (requireReviewedLock && target.reviewedLockSha256 === null) throw new Error(`The fixture lock for ${name} is not reviewed.`);
  return { ...target, name, versions: expectedPackagePins(policy, name) };
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function hostPeerRange(policy, packageName = "emdash") {
  if (!["emdash", "@emdash-cms/admin"].includes(packageName)) throw new Error("Only EmDash and admin peer ranges are managed.");
  const key = packageName === "emdash" ? "emdash" : "admin";
  const versions = [policy.currentTarget, ...policy.retainedTargets].map(name => policy.targets[name][key]);
  return [...new Set(versions)].sort(compareVersions).join(" || ");
}

export function compatibilityCli(args, root = compatibilityRoot) {
  const policy = readCompatibility(root);
  const target = selectCompatibilityTarget(policy);
  if (args.length === 1 && args[0] === "--ci-json") {
    selectCompatibilityTarget(policy, policy.currentTarget, { mode: "quick", requireReviewedLock: true });
    return JSON.stringify({ target: target.name, dependencyRoot: target.dependencyRoot, port: target.port,
      reviewedLockSha256: target.reviewedLockSha256, toolchain: policy.toolchain, packages: target.versions });
  }
  if (args.length === 2 && args[0] === "--field") {
    const fields = { currentTarget: policy.currentTarget, node: policy.toolchain.node, pnpm: policy.toolchain.pnpm,
      astro: policy.toolchain.astro, peerRange: hostPeerRange(policy), dependencyRoot: target.dependencyRoot,
      lockSha256: target.reviewedLockSha256 };
    if (Object.hasOwn(fields, args[1]) && fields[args[1]] !== null) return String(fields[args[1]]);
  }
  throw new Error("Usage: node scripts/compatibility.mjs --ci-json | --field currentTarget|node|pnpm|astro|peerRange|dependencyRoot|lockSha256");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(compatibilityCli(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
