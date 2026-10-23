import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compatibilityCli, compatibilityRoot, expectedPackagePins, hostPeerRange, readCompatibility,
  selectCompatibilityTarget, validateCompatibility } from "./compatibility.mjs";
import { checkCompatibility, checkDevelopmentCompatibility, checkFixtureCompatibility, compatibilityUpdates,
  managedDocuments, renderCompatibilityBlock, replaceCompatibilityBlock, writeCompatibilityUpdates } from "./sync-compatibility.mjs";
import { runtimeHostGateFiles, runtimeHostSupportErrors } from "./runtime-host-compatibility.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const initial = () => ({
  schemaVersion: 1, currentTarget: "native-1.3.1", retainedTargets: ["native-1.3.0"],
  toolchain: { node: "24.19.0", nodeRange: ">=24.19.0 <25", pnpm: "11.19.0", astro: "7.3.2" },
  targets: {
    "native-1.3.1": { emdash: "1.3.1", admin: "1.3.1", dependencyRoot: "integration/emdash/published-host-1.3.1",
      port: 4365, verifyModes: ["quick"], reviewedLockSha256: "1".repeat(64) },
    "native-1.3.0": { emdash: "1.3.0", admin: "1.3.0", dependencyRoot: "integration/emdash/published-host-1.3.0",
      port: 4364, verifyModes: ["quick", "full"], reviewedLockSha256: "0".repeat(64) },
  },
});

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "shipit-compatibility-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  const policy = initial();
  for (const name of ["package.json", "packages/emdash-plugin-seo/package.json", ".nvmrc", ".node-version",
    ...Object.keys(managedDocuments), "packages/emdash-plugin-seo/src/admin-contract.ts", ...runtimeHostGateFiles]) {
    write(name, readFileSync(path.join(compatibilityRoot, name), "utf8"));
  }
  for (const [name, target] of Object.entries(policy.targets)) {
    const lock = `lockfileVersion: '9.0'\n# synthetic ${name}\n`;
    target.reviewedLockSha256 = hash(lock);
    write(`${target.dependencyRoot}/pnpm-lock.yaml`, lock);
    write(`${target.dependencyRoot}/package.json`, { private: true, packageManager: `pnpm@${policy.toolchain.pnpm}`,
      engines: { node: policy.toolchain.nodeRange }, dependencies: expectedPackagePins(policy, name) });
  }
  write("compatibility.json", policy);
  write("packages/emdash-plugin-seo/CHANGELOG.md", "# Historical release\n\nEmDash 1.3.0 was used for that release.\n");
  writeCompatibilityUpdates(root);
  return { root, write, policy };
}

function development(policy, root = compatibilityRoot) {
  return {
    configurations: Object.keys(policy.targets).map(name => [name, { host: { target: name },
      dependencyRoot: policy.targets[name].dependencyRoot, expectedPackages: expectedPackagePins(policy, name),
      tasks: { quick: [{ label: "host", args: ["verify.mjs", "--target", name] }] } }]),
    environment: { defaultHostTarget: policy.currentTarget, selectHostTarget: name => ({ name,
      port: policy.targets[name].port, fixtureRoot: pathToFileURL(`${path.resolve(root, policy.targets[name].dependencyRoot)}/`),
      versions: new Map(Object.entries(expectedPackagePins(policy, name))) }) },
  };
}

test("policy selects the current target, retains exact peers and refuses unavailable full verification", () => {
  const policy = validateCompatibility(initial());
  assert.equal(selectCompatibilityTarget(policy).name, policy.currentTarget);
  assert.equal(hostPeerRange(policy), "1.3.0 || 1.3.1");
  assert.deepEqual(expectedPackagePins(policy), { emdash: "1.3.1", "@emdash-cms/admin": "1.3.1", astro: "7.3.2" });
  assert.throws(() => selectCompatibilityTarget(policy, policy.currentTarget, { mode: "full" }), /not implemented/);
  assert.throws(() => selectCompatibilityTarget(policy, "native-1.3.2"), /Unknown/);
  assert.ok(Object.isFrozen(policy.targets[policy.currentTarget].verifyModes));
});

test("schema rejects ambiguous versions, paths, modes and roles", () => {
  const mutations = [
    p => { p.extra = true; },
    p => { p.currentTarget = "native-1.3.2"; },
    p => { p.retainedTargets.push(p.currentTarget); },
    p => { p.targets[p.currentTarget].emdash = "^1.3.1"; },
    p => { p.targets[p.currentTarget].dependencyRoot = "../outside"; },
    p => { p.targets[p.currentTarget].port = 4364; },
    p => { p.targets[p.currentTarget].verifyModes = ["quick", "quick"]; },
    p => { p.targets[p.currentTarget].reviewedLockSha256 = "pending"; },
    p => { p.toolchain.nodeRange = ">=20"; },
  ];
  for (const mutate of mutations) {
    const policy = initial();
    mutate(policy);
    assert.throws(() => validateCompatibility(policy));
  }
});

test("pending lock hashes cannot produce CI metadata", t => {
  const { root, write, policy } = fixture(t);
  policy.targets[policy.currentTarget].reviewedLockSha256 = null;
  write("compatibility.json", policy);
  assert.throws(() => compatibilityCli(["--ci-json"], root), /not reviewed/);
  assert.match(checkFixtureCompatibility(root).join("\n"), /pending review/);
  assert.equal(compatibilityCli(["--field", "currentTarget"], root), "native-1.3.1");
});

test("promoting an unsupported target detects stale docs and peers and refuses to advertise it", t => {
  const { root, write, policy } = fixture(t);
  const oldLock = readFileSync(path.join(root, policy.targets["native-1.3.0"].dependencyRoot, "pnpm-lock.yaml"));
  const history = readFileSync(path.join(root, "packages/emdash-plugin-seo/CHANGELOG.md"));
  policy.targets["native-1.3.2"] = { ...policy.targets[policy.currentTarget], emdash: "1.3.2", admin: "1.3.2",
    dependencyRoot: "integration/emdash/published-host-1.3.2", port: 4366, reviewedLockSha256: null };
  policy.retainedTargets.push(policy.currentTarget);
  policy.currentTarget = "native-1.3.2";
  write("compatibility.json", policy);
  const stale = compatibilityUpdates(root).map(update => update.name);
  assert.ok(stale.includes("README.md"));
  assert.ok(stale.includes("packages/emdash-plugin-seo/package.json"));
  assert.match(checkFixtureCompatibility(root).join("\n"), /native-1.3.2 fixture/);
  assert.ok(stale.every(name => !name.startsWith("integration/") && !name.includes("CHANGELOG") && !name.includes("receipt")));
  assert.throws(() => writeCompatibilityUpdates(root), /Cannot synchronize unsupported runtime declarations/);
  const unsupported = runtimeHostSupportErrors(root, readCompatibility(root));
  assert.equal(unsupported.length, 8);
  assert.ok(unsupported.every(message => message.includes("1.3.2")));
  const product = JSON.parse(readFileSync(path.join(root, "packages/emdash-plugin-seo/package.json"), "utf8"));
  assert.equal(product.peerDependencies.emdash, "1.3.0 || 1.3.1");
  assert.equal(product.devDependencies.emdash, "1.3.1");
  assert.deepEqual(readFileSync(path.join(root, policy.targets["native-1.3.0"].dependencyRoot, "pnpm-lock.yaml")), oldLock);
  assert.deepEqual(readFileSync(path.join(root, "packages/emdash-plugin-seo/CHANGELOG.md")), history);
});

test("supported synchronization is idempotent and full verification/report select the same target", t => {
  const { root, policy } = fixture(t);
  assert.deepEqual(compatibilityUpdates(root), []);
  assert.deepEqual(writeCompatibilityUpdates(root), []);
  const table = renderCompatibilityBlock(policy, "matrix");
  assert.ok(table.includes("pnpm verify --target native-1.3.0"));
  assert.ok(table.includes("pnpm dev:report --target native-1.3.0"));
});

test("runtime gate checks retain older entries, require retained hosts and fail closed on changed grammar", t => {
  const { root, write, policy } = fixture(t);
  assert.deepEqual(runtimeHostSupportErrors(root, policy), []);
  const file = "packages/emdash-plugin-seo/src/admin-ui/robots-txt-model.ts";
  write(file, readFileSync(path.join(root, file), "utf8").replace(/\s*"1\.3\.0": \{ read: 40, manage: 50 \},/, ""));
  assert.match(runtimeHostSupportErrors(root, policy).join("\n"), /ROBOTS_SETTINGS_ROLE_GATES: declared EmDash 1.3.0/);
  const sitemap = "packages/emdash-plugin-seo/src/sitemap-installation.ts";
  write(sitemap, readFileSync(path.join(root, sitemap), "utf8").replace("export const SITEMAP_NATIVE_HOST_VERSIONS:", "export let SITEMAP_NATIVE_HOST_VERSIONS:"));
  assert.match(runtimeHostSupportErrors(root, policy).join("\n"), /Unrecognized SITEMAP_NATIVE_HOST_VERSIONS source/);
});

test("fixture drift fails and synchronization never blesses its hash or manifest", t => {
  const { root, write, policy } = fixture(t);
  const target = policy.targets[policy.currentTarget];
  write(`${target.dependencyRoot}/pnpm-lock.yaml`, "changed lock\n");
  write(`${target.dependencyRoot}/package.json`, { dependencies: { emdash: "1.3.0" } });
  const before = readFileSync(path.join(root, "compatibility.json"));
  const errors = checkFixtureCompatibility(root);
  assert.match(errors.join("\n"), /emdash must be 1.3.1/);
  assert.match(errors.join("\n"), /reviewed lock hash differs/);
  writeCompatibilityUpdates(root);
  assert.deepEqual(readFileSync(path.join(root, "compatibility.json")), before);
  assert.equal(readFileSync(path.join(root, target.dependencyRoot, "pnpm-lock.yaml"), "utf8"), "changed lock\n");
});

test("development drift catches a stale default, task target and runtime pin", () => {
  const policy = validateCompatibility(initial());
  const state = development(policy);
  assert.deepEqual(checkDevelopmentCompatibility(policy, state.configurations, state.environment), []);
  state.environment.defaultHostTarget = "native-1.3.0";
  state.configurations[0][1].tasks.quick[0].args[2] = "native-1.3.0";
  state.configurations[0][1].preflight = { quick: { files: ["integration/emdash/published-host-1.3.0/package.json"] } };
  state.environment.selectHostTarget = name => ({ name, port: policy.targets[name].port, versions: new Map([["emdash", "1.3.0"]]) });
  const errors = checkDevelopmentCompatibility(policy, state.configurations, state.environment, { root: compatibilityRoot }).join("\n");
  assert.match(errors, /Runtime default target differs/);
  assert.match(errors, /selects another target/);
  assert.match(errors, /runtime target pins differ/);
  assert.match(errors, /source or preflight selects another fixture/);
  assert.match(errors, /runtime fixture differs/);
});

test("current docs, product pins and retained fixture agree; changing a current block is detected", async t => {
  const { root, write, policy } = fixture(t);
  assert.deepEqual(await checkCompatibility(root, { development: development(policy, root) }), []);
  write("README.md", readFileSync(path.join(root, "README.md"), "utf8").replace("Native EmDash/admin support: **1.3.1 or 1.3.0**", "Native EmDash/admin support: **1.3.0**"));
  assert.match((await checkCompatibility(root, { development: development(policy, root) })).join("\n"), /README.md: compatibility values are stale/);
});

test("managed blocks must exist exactly once", () => {
  assert.throws(() => replaceCompatibilityBlock("No markers", "support", "text", "README.md"), /Expected one/);
  const block = "<!-- compatibility:support:start -->old<!-- compatibility:support:end -->";
  assert.throws(() => replaceCompatibilityBlock(block + block, "support", "text", "README.md"), /Expected one/);
});

test("development guidance contains target metadata without workstation links", () => {
  const block = renderCompatibilityBlock(validateCompatibility(initial()), "development");
  assert.match(block, /native-1\.3\.1/);
  assert.match(block, /integration\/emdash\/published-host-1\.3\.1/);
  assert.doesNotMatch(block, /https?:\/\/|4365|open.{0,20}(?:URL|address)/i);
});
