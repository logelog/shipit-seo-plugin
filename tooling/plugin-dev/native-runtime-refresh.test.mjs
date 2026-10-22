import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageBuildOptions, parsePackageBuildMode } from "../../scripts/published-host/package-build-options.mjs";
import { assertPreviewPortAvailable, preflightNativeRuntimeRefresh, writeRuntimeAdminEntry } from "../../scripts/published-host/native-runtime-refresh.mjs";
import { acquireLock, checkToolchain, readConfig, runTasks } from "./cli.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const packageDirectory = path.join(repository, "packages/emdash-plugin-seo");
const packageManifest = JSON.parse(readFileSync(path.join(packageDirectory, "package.json"), "utf8"));

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "native-runtime-refresh-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adminFixture(t, names = ["admin.js", "admin.css"]) {
  const root = fixture(t);
  const output = path.join(root, "dist/admin-ui");
  mkdirSync(output, { recursive: true });
  for (const name of names) writeFileSync(path.join(output, name), name.endsWith(".css") ? ".fixture { color: red; }\n" : "export const fixture = true;\n");
  return { root, output, url: pathToFileURL(root + path.sep) };
}

function probeHarness({ occupied = false, neverListen = false, neverClose = false, closeError = null } = {}) {
  const probe = new EventEmitter();
  const jobs = new Map();
  const state = { closes: 0, callbacks: [], options: null };
  probe.listen = (options) => {
    state.options = options;
    if (occupied) probe.emit("error", Object.assign(new Error("occupied"), { code: "EADDRINUSE" }));
    else if (!neverListen) probe.emit("listening");
  };
  probe.close = (callback) => {
    state.closes += 1;
    state.callbacks.push(callback);
    if (!neverClose) callback(closeError);
  };
  const timers = {
    setTimeout(callback) { const token = {}; jobs.set(token, callback); return token; },
    clearTimeout(token) { jobs.delete(token); },
  };
  return {
    probe, state, jobs,
    options: { createProbe: () => probe, timers },
    expire() { const current = [...jobs.values()]; jobs.clear(); for (const callback of current) callback(); },
  };
}

test("the runtime build option is explicit and all other arguments fail", () => {
  assert.equal(parsePackageBuildMode([]), "full");
  assert.equal(parsePackageBuildMode(["--runtime-only"]), "runtime-only");
  for (const args of [["--quick"], ["--runtime-only", "--runtime-only"], ["--runtime-only=true"], ["--target", "native-1.1.0"], ["other"], null]) {
    assert.throws(() => parsePackageBuildMode(args), /Usage/);
  }
});

test("runtime mode preserves all production JS entries, externals and clean options and only omits declarations", () => {
  const normal = packageBuildOptions(packageManifest.scripts.build);
  assert.equal(normal.entry.length, 17);
  assert.equal(normal.dts, true);
  assert.equal(normal.clean, true);
  assert.equal(normal.outDir, "dist");
  assert.deepEqual(normal.format, ["esm"]);
  assert.equal(normal.platform, "neutral");
  assert.ok(normal.entry.includes("src/sandbox-entry.ts"));
  assert.ok(normal.entry.includes("src/admin-ui/admin.tsx"));
  assert.ok(normal.entry.includes("src/taxonomy-archives.ts"));
  assert.ok(normal.entry.includes("src/plugin-coexistence-metadata.ts"));
  assert.ok(normal.entry.includes("src/plugin-coexistence-middleware-entry.ts"));
  assert.ok(normal.external.includes("@shipitseo/emdash-plugin-seo/admin-contract"));
  assert.deepEqual(packageBuildOptions(packageManifest.scripts.build, { runtimeOnly: true }), { ...normal, dts: false });
  assert.deepEqual(packageBuildOptions(packageManifest.scripts.build, { runtimeOnly: false }), normal);
});

test("unknown package build grammar still fails instead of silently dropping production flags", () => {
  for (const script of [
    packageManifest.scripts.build.replace("--clean", "--unknown"),
    packageManifest.scripts.build.replace("--out-dir dist", "--out-dir"),
    packageManifest.scripts.build.replace("tsdown ", "another "),
    packageManifest.scripts.build.replace("node scripts/link-admin-css.mjs", "node other.mjs"),
    packageManifest.scripts.build + " && node extra.mjs",
  ]) assert.throws(() => packageBuildOptions(script));
});

test("native-only preflight rejects other targets before reading pins or probing a port", async () => {
  for (const name of ["published-1.0.1", "published-1.1.0", "published-1.2.0", "sandbox-1.2.0", "native-1.1.0", "native-1.2.0", "native-9.9.9", "other", undefined]) {
    let reads = 0;
    await assert.rejects(preflightNativeRuntimeRefresh({ target: { name, port: 4360 }, assertVersions() { reads += 1; } }, {
      checkPort() { reads += 1; },
    }), /configured native host target/);
    assert.equal(reads, 0);
  }
});

test("native preflight validates host pins before the port and propagates either failure", async () => {
  for (const [name, port] of [["native-1.3.0", 4364], ["native-1.3.1", 4365]]) {
    const calls = [];
    const environment = { target: { name, port }, assertVersions() { calls.push("pins"); } };
    await preflightNativeRuntimeRefresh(environment, { checkPort(selectedPort) { calls.push(selectedPort); } });
    assert.deepEqual(calls, ["pins", port]);
    calls.length = 0;
    await assert.rejects(preflightNativeRuntimeRefresh({ ...environment, assertVersions() { calls.push("pins"); throw new Error("wrong host version"); } }, {
      checkPort() { calls.push("port"); },
    }), /wrong host version/);
    assert.deepEqual(calls, ["pins"]);
    await assert.rejects(preflightNativeRuntimeRefresh(environment, { checkPort() { throw new Error("preview occupied"); } }), /preview occupied/);
  }
});

test("the port probe binds only the selected loopback port and finishes after releasing it", async () => {
  const h = probeHarness();
  await assertPreviewPortAvailable(4362, h.options);
  assert.equal(h.state.options.host, "127.0.0.1");
  assert.equal(h.state.options.port, 4362);
  assert.equal(h.state.closes, 1);
  assert.equal(h.jobs.size, 0);
  let destroyed = false;
  h.probe.emit("connection", { destroy() { destroyed = true; } });
  assert.equal(destroyed, true);
});

test("an occupied preview or probe close failure never authorizes a refresh", async () => {
  const occupied = probeHarness({ occupied: true });
  await assert.rejects(assertPreviewPortAvailable(4362, occupied.options), (error) => /stop the preview/.test(error.message) && error.cause.code === "EADDRINUSE");
  assert.equal(occupied.state.options.signal.aborted, true);
  assert.equal(occupied.state.closes, 1);
  assert.equal(occupied.jobs.size, 0);
  const failed = probeHarness({ closeError: new Error("close failed") });
  await assert.rejects(assertPreviewPortAvailable(4362, failed.options), /did not close/);
  assert.equal(failed.state.options.signal.aborted, true);
  assert.equal(failed.jobs.size, 0);
});

test("a probe or close timeout aborts and closes the probe and ignores late success", async () => {
  for (const options of [{ neverListen: true }, { neverClose: true }]) {
    const h = probeHarness(options);
    const pending = assertPreviewPortAvailable(4362, h.options);
    h.expire();
    await assert.rejects(pending, /timed out/);
    assert.equal(h.state.options.signal.aborted, true);
    assert.ok(h.state.closes >= 1);
    assert.equal(h.jobs.size, 0);
    for (const callback of h.state.callbacks) callback();
    h.probe.emit("listening");
  }
  for (const port of [0, 65536, NaN]) assert.throws(() => assertPreviewPortAvailable(port), /Invalid/);
});

test("runtime JS and CSS produce the exact production wrapper without synthesizing declarations", (t) => {
  const runtime = adminFixture(t);
  writeRuntimeAdminEntry(runtime.url);
  assert.equal(existsSync(path.join(runtime.output, "admin.d.ts")), false);
  const normal = adminFixture(t);
  mkdirSync(path.join(normal.root, "scripts"));
  const helper = path.join(normal.root, "scripts/link-admin-css.mjs");
  writeFileSync(helper, readFileSync(path.join(packageDirectory, "scripts/link-admin-css.mjs")));
  const missingTypes = spawnSync(process.execPath, [helper], { encoding: "utf8" });
  assert.notEqual(missingTypes.status, 0);
  assert.match(missingTypes.stderr, /Missing compiled admin output/);
  assert.equal(existsSync(path.join(normal.output, "admin-entry.js")), false);
  writeFileSync(path.join(normal.output, "admin.d.ts"), "export declare const fixture: boolean;\n");
  const production = spawnSync(process.execPath, [helper], { encoding: "utf8" });
  assert.equal(production.error, undefined);
  assert.equal(production.status, 0, production.stderr);
  assert.deepEqual(readFileSync(path.join(runtime.output, "admin-entry.js")), readFileSync(path.join(normal.output, "admin-entry.js")));
});

test("missing, empty or non-file runtime outputs and wrapper write failures propagate", (t) => {
  for (const names of [["admin.js"], ["admin.css"]]) {
    const missing = adminFixture(t, names);
    assert.throws(() => writeRuntimeAdminEntry(missing.url), /ENOENT/);
    assert.equal(existsSync(path.join(missing.output, "admin-entry.js")), false);
  }
  const empty = adminFixture(t);
  writeFileSync(path.join(empty.output, "admin.css"), "");
  assert.throws(() => writeRuntimeAdminEntry(empty.url), /Missing compiled admin output/);
  const directory = adminFixture(t, ["admin.css"]);
  mkdirSync(path.join(directory.output, "admin.js"));
  assert.throws(() => writeRuntimeAdminEntry(directory.url), /Missing compiled admin output/);
  const unwritable = adminFixture(t);
  mkdirSync(path.join(unwritable.output, "admin-entry.js"));
  assert.throws(() => writeRuntimeAdminEntry(unwritable.url), /EISDIR/);
});

test("native refresh omits declarations while quick, full and prepack keep production builds", () => {
  const normal = readConfig(repository);
  for (const native of [normal, readConfig(repository, "native-1.3.0")]) {
    assert.deepEqual(native.tasks.refresh, [{
      label: "runtime-package-refresh", command: "node",
      args: ["--import=./scripts/published-host/host-loader.mjs", "scripts/published-host/build-package.mjs", "--runtime-only"],
      timeoutMs: 180000,
    }]);
    for (const config of [normal, native]) for (const task of ["quick", "verify", "dev"]) {
      assert.equal(config.tasks[task].some((step) => step.args.includes("--runtime-only")), false);
    }
  }
  assert.equal(packageManifest.scripts.prepack, "npm run build");
  assert.deepEqual(checkToolchain(repository), { node: "24.19.0", pnpm: "11.19.0" });
});

test("refresh cannot enter its task or create reports while the toolkit lock is owned", async (t) => {
  const root = fixture(t);
  const lock = path.join(root, "work.lock");
  const release = acquireLock(root, lock);
  try {
    await assert.rejects(runTasks(root, readConfig(repository, "native-1.3.0"), "refresh", {}, {}, lock), /active/);
    assert.equal(existsSync(path.join(root, "artifacts")), false);
  } finally { release(); }
});
