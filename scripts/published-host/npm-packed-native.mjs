import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createEnvironment } from "./environment.mjs";

const environment = createEnvironment();
assert.ok(["native-1.2.0", "native-1.3.0"].includes(environment.target.name), "npm verification requires a supported full native target");
const directory = new URL("package-candidate/", environment.target.outputRoot);
const receipt = JSON.parse(readFileSync(new URL("receipt.json", directory), "utf8"));
assert.equal(receipt.status, "packed-consumer-verified");
assert.equal(receipt.target, environment.target.name);
assert.equal(receipt.emdash, environment.target.versions.get("emdash"));
assert.match(receipt.tarball.file, /^[a-z0-9][a-z0-9._-]*\.tgz$/);
assert.match(receipt.tarball.sha256, /^[a-f0-9]{64}$/);
const artifact = new URL(receipt.tarball.file, directory);
const checksum = () => createHash("sha256").update(readFileSync(artifact)).digest("hex");
assert.equal(checksum(), receipt.tarball.sha256, "npm must consume the exact pnpm-verified artifact");
const version = spawnSync("npm", ["--version"], { encoding: "utf8", timeout: 15_000, maxBuffer: 16_384 });
assert.equal(version.status, 0, version.stderr);
assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

// Verification never reaches the registry. Without a prepared npm cache the npm consumer cannot run;
// its receipt says so, and that is a tooling limit, not a passed check.
const offlineCache = process.env.SHIPIT_NPM_OFFLINE_CACHE ?? "";
if (!offlineCache || !existsSync(offlineCache)) {
  writeFileSync(new URL("npm-consumer.json", directory), JSON.stringify({
    schemaVersion: 1,
    status: "not-run",
    reason: "No offline npm cache (SHIPIT_NPM_OFFLINE_CACHE) holds this consumer's packages; verification does not use the registry.",
    finishedAt: new Date().toISOString(),
    target: environment.target.name,
    npm: version.stdout.trim(),
    tarball: receipt.tarball,
  }, null, 2) + "\n");
  if (process.env.SHIPIT_VERIFY_NOT_RUN_FILE) {
    appendFileSync(process.env.SHIPIT_VERIFY_NOT_RUN_FILE, JSON.stringify({ check: "npm-packed-plugin", reason: "no offline npm cache" }) + "\n");
  }
  console.log("NOT RUN: npm consumer for the exact artifact (no offline npm cache; tooling limit, not a pass).");
  process.exit(0);
}

process.env.SHIPIT_PACKED_CONSUMER = "npm";
process.env.SHIPIT_PACKED_ARTIFACT = fileURLToPath(artifact);
await import("./packed-single-seo.mjs");

assert.equal(checksum(), receipt.tarball.sha256, "verification must preserve the artifact");
writeFileSync(new URL("npm-consumer.json", directory), JSON.stringify({
  schemaVersion: 1,
  status: "passed",
  finishedAt: new Date().toISOString(),
  target: environment.target.name,
  node: process.versions.node,
  npm: version.stdout.trim(),
  emdash: environment.target.versions.get("emdash"),
  astro: environment.target.versions.get("astro"),
  tarball: receipt.tarball,
  install: "npm install --ignore-scripts --offline --strict-peer-deps --no-audit --no-fund",
  usesHostLockfile: false,
  isolatedNpmConfiguration: true,
  isolatedNpmCache: true,
  offlineCacheCopiedFrom: offlineCache,
  runtime: "Node",
  storage: "SQLite",
}, null, 2) + "\n");
console.log("Clean npm consumer passed for the exact pnpm-verified native artifact.");
