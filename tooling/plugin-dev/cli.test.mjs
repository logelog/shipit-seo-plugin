import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { readCompatibility } from "../../scripts/compatibility.mjs";
import { acquireLock, checkDependencies, checkInstalledPins, childHostEnvironment, cleanReports, ensureReports, main, parseTargetArgs, previewStatus, readConfig, readNotRun, readRecordedReport, repoPath, reportLabel, runTasks, sourceFingerprint, writeReportJson } from "./cli.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const compatibility = readCompatibility(repository);

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "plugin-dev-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function targetFixture(t) {
  const root = fixture(t);
  const write = (name, content) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  };
  const command = [{ label: "control", command: "node", args: ["-e", "console.log(JSON.stringify({ target: process.env.SHIPIT_HOST_TARGET, fixture: process.env.SHIPIT_PUBLISHED_HOST }))"] }];
  const config = {
    schemaVersion: 1, name: "Fixture", dependencyRoot: "baseline",
    host: { target: "published-1.0.1", format: "native", runner: "node", storage: "sqlite" },
    expectedPackages: { emdash: "1.0.1" }, sourceDirectories: ["src", "baseline/src"],
    sourceFiles: ["baseline/package.json", "baseline/astro.config.mjs"],
    ports: [{ name: "Preview", port: 4360 }], tasks: { verify: command },
    targets: {
      "native-1.1.0": {
        dependencyRoot: "candidate",
        host: { target: "native-1.1.0", format: "native", runner: "node", storage: "sqlite" },
        expectedPackages: { emdash: "1.1.0" }, sourceDirectories: ["src", "candidate/src"],
        sourceFiles: ["candidate/package.json", "candidate/pnpm-workspace.yaml", "candidate/astro-native.config.mjs"],
        ports: [{ name: "Preview", port: 4362 }], tasks: { verify: command },
      },
      "native-1.2.0": {
        dependencyRoot: "candidate-1.2.0",
        host: { target: "native-1.2.0", format: "native", runner: "node", storage: "sqlite" },
        expectedPackages: { emdash: "1.2.0" }, sourceDirectories: ["src", "candidate-1.2.0/src"],
        sourceFiles: ["candidate-1.2.0/package.json", "candidate-1.2.0/pnpm-workspace.yaml", "candidate-1.2.0/astro-native.config.mjs"],
        ports: [{ name: "Preview", port: 4363 }], tasks: { verify: command },
      },
      "native-1.3.0": {
        dependencyRoot: "candidate-1.3.0",
        host: { target: "native-1.3.0", format: "native", runner: "node", storage: "sqlite" },
        expectedPackages: { emdash: "1.3.0" }, sourceDirectories: ["src", "candidate-1.3.0/src"],
        sourceFiles: ["candidate-1.3.0/package.json", "candidate-1.3.0/pnpm-workspace.yaml", "candidate-1.3.0/astro-native.config.mjs"],
        ports: [{ name: "Preview", port: 4364 }], tasks: { verify: command },
      },
    },
  };
  const save = () => writeFileSync(path.join(root, "plugin-dev.json"), JSON.stringify(config));
  save();
  for (const [directory, version] of [["baseline", "1.0.1"], ["candidate", "1.1.0"], ["candidate-1.2.0", "1.2.0"], ["candidate-1.3.0", "1.3.0"]]) {
    write(`${directory}/node_modules/emdash/package.json`, JSON.stringify({ version }));
    write(`${directory}/package.json`, JSON.stringify({ private: true }));
    write(`${directory}/pnpm-lock.yaml`, `version: ${version}\n`);
    write(`${directory}/src/page.astro`, "<p>Fixture</p>\n");
  }
  write("baseline/astro.config.mjs", "export default {};\n");
  write("candidate/astro-native.config.mjs", "export default {};\n");
  write("candidate/pnpm-workspace.yaml", "packages: []\n");
  write("candidate-1.2.0/astro-native.config.mjs", "export default {};\n");
  write("candidate-1.2.0/pnpm-workspace.yaml", "packages: []\n");
  write("candidate-1.3.0/astro-native.config.mjs", "export default {};\n");
  write("candidate-1.3.0/pnpm-workspace.yaml", "packages: []\n");
  write("src/descriptor.ts", "export const format = 'native';\n");
  write("src/admin-ui/panel.tsx", "export const panel = 'SEO';\n");
  return { root, config, save };
}

function recordedSummary(root, config) {
  return {
    profile: config.profile, dependencyRoot: config.dependencyRoot ?? ".", host: config.host ?? null, ports: config.ports ?? [],
    task: "verify", status: "passed", sourceHash: sourceFingerprint(root, config), finishedAt: new Date().toISOString(),
  };
}

test("repository paths cannot escape the checkout", () => {
  for (const input of ["../other", "/tmp/other", "a/../../other", "a\\..\\other", ""]) assert.throws(() => repoPath("/repo", input));
  assert.equal(repoPath("/repo", "src"), "/repo/src");
});

test("configuration accepts argument arrays but rejects shell commands, duplicate and reserved labels", (t) => {
  const root = fixture(t);
  const config = { schemaVersion: 1, name: "Fixture", tasks: { verify: [{ label: "types", command: "node", args: ["--version"] }] } };
  const save = () => writeFileSync(path.join(root, "plugin-dev.json"), JSON.stringify(config));
  save();
  assert.equal(readConfig(root).tasks.verify[0].command, "node");
  config.tasks.verify[0].command = "sh"; save();
  assert.throws(() => readConfig(root), /Invalid command/);
  config.tasks.verify[0].command = "node";
  config.tasks.verify.push(config.tasks.verify[0]); save();
  assert.throws(() => readConfig(root), /Invalid command/);
  for (const label of ["run", "verification"]) {
    config.tasks.verify = [{ label, command: "node", args: ["--version"] }];
    save();
    assert.throws(() => readConfig(root), /Invalid command/, label);
  }
});

test("installed dependency versions must match the declared compatibility target", (t) => {
  const root = fixture(t);
  const config = { expectedPackages: { emdash: "0.38.0" } };
  assert.throws(() => checkDependencies(root, config), /missing/);
  const directory = path.join(root, "node_modules/emdash");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version: "0.35.0" }));
  assert.throws(() => checkDependencies(root, config), /expected 0.38.0, found 0.35.0/);
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version: "0.38.0" }));
  assert.deepEqual(checkDependencies(root, config), { emdash: "0.38.0" });
});

test("default pin recovery uses a valid no-target setup command", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { emdash: "1.3.0" } }));
  assert.throws(() => checkInstalledPins(root, { profile: "default" }), (error) => {
    assert.match(error.message, /Run pnpm dev:setup; nothing was refreshed/);
    assert.equal(error.message.includes("--target default"), false);
    return true;
  });
});

test("only one heavy command can own a lock, even across repositories", (t) => {
  const root = fixture(t);
  const lock = path.join(root, "work.lock");
  const release = acquireLock(root, lock);
  assert.throws(() => acquireLock("/another/repo", lock), /active/);
  release();
  const next = acquireLock(root, lock);
  next();
});

test("a lock symlink cannot be replaced during recovery", (t) => {
  const root = fixture(t);
  const target = path.join(root, "target");
  mkdirSync(target);
  const lock = path.join(root, "work.lock");
  symlinkSync(target, lock);
  assert.throws(() => acquireLock(root, lock), /symbolic link/);
});

test("cleanup is a dry run by default and never removes a database", (t) => {
  const root = fixture(t);
  const directory = ensureReports(root, ["types.log"]);
  writeFileSync(path.join(directory, "types.log"), "small log");
  assert.deepEqual(cleanReports(root), ["types.log"]);
  assert.equal(readFileSync(path.join(directory, "types.log"), "utf8"), "small log");
  writeFileSync(path.join(directory, "data.db"), "private data");
  assert.throws(() => cleanReports(root, true), /Unexpected.*report artifact/);
  assert.equal(readFileSync(path.join(directory, "types.log"), "utf8"), "small log");
  rmSync(path.join(directory, "data.db"));
  assert.deepEqual(cleanReports(root, true), ["types.log"]);
  assert.deepEqual(cleanReports(root), []);
});

test("reports refuse an existing unowned or symlinked directory", (t) => {
  const root = fixture(t);
  mkdirSync(path.join(root, "artifacts/plugin-dev"), { recursive: true });
  writeFileSync(path.join(root, "artifacts/plugin-dev/keep.txt"), "not ours");
  assert.throws(() => ensureReports(root), /not owned/);
  const other = fixture(t);
  symlinkSync(path.join(root, "artifacts"), path.join(other, "artifacts"));
  assert.throws(() => ensureReports(other), /symlinked/);
});

test("report metadata cannot overwrite symlink targets", (t) => {
  const root = fixture(t);
  const directory = ensureReports(root);
  const marker = path.join(directory, ".owned.json");
  const outside = path.join(root, "outside.json");
  writeFileSync(outside, readFileSync(marker));
  rmSync(marker);
  symlinkSync(outside, marker);
  const previous = readFileSync(outside, "utf8");
  assert.throws(() => ensureReports(root), /symbolic link|symlink/);
  assert.equal(readFileSync(outside, "utf8"), previous);
});

test("foreign JSON in a report folder is preserved during cleanup", (t) => {
  const root = fixture(t);
  const directory = ensureReports(root);
  writeFileSync(path.join(directory, "notes.json"), '{"keep":true}');
  assert.throws(() => cleanReports(root, true), /Unexpected|unowned/);
  assert.equal(readFileSync(path.join(directory, "notes.json"), "utf8"), '{"keep":true}');
});

test("run summaries cannot overwrite a symlink target", (t) => {
  const root = fixture(t);
  const directory = ensureReports(root, ["run.json"]);
  const outside = path.join(root, "keep.json");
  writeFileSync(outside, '{"keep":true}');
  symlinkSync(outside, path.join(directory, "run.json"));
  assert.throws(() => writeReportJson(path.join(directory, "run.json"), { replace: true }), /symlinked/);
  assert.equal(readFileSync(outside, "utf8"), '{"keep":true}');
});

test("an oversized report replacement preserves existing bytes and leaves no temporary files", (t) => {
  const root = fixture(t);
  const directory = ensureReports(root, ["run.json"]);
  const file = path.join(directory, "run.json");
  writeReportJson(file, { keep: "owned evidence" });
  const original = readFileSync(file);
  const marker = readFileSync(path.join(directory, ".owned.json"));
  const names = readdirSync(directory).sort();
  assert.throws(() => writeReportJson(file, { value: "a".repeat(64 * 1024) }), /exceeds 64 KiB/);
  assert.deepEqual(readFileSync(file), original);
  assert.deepEqual(readFileSync(path.join(directory, ".owned.json")), marker);
  assert.deepEqual(readdirSync(directory).sort(), names);
});

test("a dead command owner is not enough to reclaim its detached workload lock", (t) => {
  const root = fixture(t);
  const lock = path.join(root, "work.lock");
  mkdirSync(lock);
  writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 1073741823, token: "old" }));
  assert.throws(() => acquireLock(root, lock), /children may still be running/);
  assert.equal(JSON.parse(readFileSync(path.join(lock, "owner.json"))).token, "old");
});

test("inherited task names cannot change recorded evidence", async (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "plugin-dev.json"), JSON.stringify({ schemaVersion: 1, name: "Fixture", tasks: {} }));
  const directory = ensureReports(root, ["run.json"]);
  writeFileSync(path.join(directory, "run.json"), '{"keep":true}');
  await assert.rejects(main(["toString"], root), /No toString task configured/);
  assert.equal(readFileSync(path.join(directory, "run.json"), "utf8"), '{"keep":true}');
});

test("cleanup cannot run while another command owns the global lock", async (t) => {
  const root = fixture(t);
  const lock = path.join(root, "global.lock");
  const release = acquireLock(root, lock);
  try { await assert.rejects(main(["clean", "--apply"], root, lock), /active/); }
  finally { release(); }
});

test("named target overlays select their dependency root, metadata, sources and port", (t) => {
  const { root } = targetFixture(t);
  const baseline = readConfig(root);
  assert.equal(baseline.profile, "default");
  assert.equal(baseline.dependencyRoot, "baseline");
  assert.deepEqual(checkDependencies(root, baseline), { emdash: "1.0.1" });
  assert.equal(reportLabel(baseline, "run"), "run");
  for (const [name, directory, version, port] of [
    ["native-1.1.0", "candidate", "1.1.0", 4362],
    ["native-1.2.0", "candidate-1.2.0", "1.2.0", 4363],
    ["native-1.3.0", "candidate-1.3.0", "1.3.0", 4364],
  ]) {
    const candidate = readConfig(root, name);
    assert.equal(candidate.profile, name);
    assert.equal(candidate.dependencyRoot, directory);
    assert.deepEqual(checkDependencies(root, candidate), { emdash: version });
    assert.equal(candidate.host.format, "native");
    assert.equal(candidate.ports[0].port, port);
    assert.deepEqual(candidate.sourceDirectories, ["src", directory + "/src"]);
    assert.equal(reportLabel(candidate, "run"), name + "-run");
    assert.equal(reportLabel(candidate, "control"), name + "-control");
  }
});

test("target overlays inherit unspecified task groups without changing standalone defaults", (t) => {
  const { root, config, save } = targetFixture(t);
  delete config.targets["native-1.1.0"].tasks;
  save();
  assert.deepEqual(readConfig(root, "native-1.1.0").tasks, config.tasks);
  delete config.targets;
  delete config.host;
  save();
  const standalone = readConfig(root);
  assert.equal(standalone.profile, "default");
  assert.equal(standalone.host, undefined);
  assert.equal(reportLabel(standalone, "control"), "control");
  assert.throws(() => readConfig(root, "native-1.1.0"), /Unknown development target/);
});

test("target selection rejects unsafe names, incomplete metadata and oversized report labels", (t) => {
  const { root, config, save } = targetFixture(t);
  for (const target of ["missing", "toString", "__proto__", "../candidate", ""]) {
    assert.throws(() => readConfig(root, target), /Unknown development target/);
  }
  config.targets["native-1.1.0"].host = { target: "native-1.1.0", format: "native" };
  save();
  assert.throws(() => readConfig(root, "native-1.1.0"), /Host metadata/);
  delete config.targets["native-1.1.0"].host;
  config.targets["native-1.1.0"].tasks = { verify: [{ label: "a".repeat(80), command: "node", args: ["--version"] }] };
  save();
  assert.throws(() => readConfig(root, "native-1.1.0"), /Report label is too long/);
});

test("invalid target arguments fail before any recorded evidence changes", async (t) => {
  const { root } = targetFixture(t);
  assert.equal(parseTargetArgs([]), undefined);
  assert.equal(parseTargetArgs(["--target", "native-1.1.0"]), "native-1.1.0");
  const directory = ensureReports(root, ["run.json"]);
  const file = path.join(directory, "run.json");
  writeFileSync(file, '{"keep":true}');
  for (const command of ["setup", "doctor", "quick", "verify", "dev", "dev-engine", "report"]) {
    for (const args of [["--target"], ["--target", "--quick"], ["--target", "native-1.1.0", "--target", "native-1.1.0"], ["--target", "../candidate"], ["--quick"]]) {
      await assert.rejects(main([command, ...args], root), /Usage/);
    }
    await assert.rejects(main([command, "--target", "missing"], root), /Unknown development target/);
  }
  await assert.rejects(main(["clean", "--target", "native-1.1.0"], root), /Usage: clean/);
  assert.equal(readFileSync(file, "utf8"), '{"keep":true}');
});

test("selected host environments override ambient host target and fixture without changing the parent", (t) => {
  const { root } = targetFixture(t);
  const inherited = { SHIPIT_HOST_TARGET: "wrong", SHIPIT_PUBLISHED_HOST: "/wrong", FIXTURE_CONTROL: "keep" };
  for (const target of [undefined, "native-1.1.0", "native-1.2.0", "native-1.3.0"]) {
    const config = readConfig(root, target);
    const env = childHostEnvironment(root, config, inherited);
    assert.equal(env.SHIPIT_HOST_TARGET, config.host.target);
    assert.equal(env.SHIPIT_PUBLISHED_HOST, path.join(root, config.dependencyRoot));
    assert.equal(env.FIXTURE_CONTROL, "keep");
  }
  assert.equal(inherited.SHIPIT_HOST_TARGET, "wrong");
  assert.equal(inherited.SHIPIT_PUBLISHED_HOST, "/wrong");
});

test("candidate fingerprint changes for its manifest, lockfile, native config, descriptor, UI and fixture", (t) => {
  const { root } = targetFixture(t);
  const config = readConfig(root, "native-1.1.0");
  const originalHash = sourceFingerprint(root, config);
  for (const name of ["candidate/package.json", "candidate/pnpm-lock.yaml", "candidate/pnpm-workspace.yaml", "candidate/astro-native.config.mjs", "src/descriptor.ts", "src/admin-ui/panel.tsx", "candidate/src/page.astro"]) {
    const file = path.join(root, name);
    const content = readFileSync(file);
    writeFileSync(file, Buffer.concat([content, Buffer.from("\n")]));
    assert.notEqual(sourceFingerprint(root, config), originalHash, name);
    writeFileSync(file, content);
    assert.equal(sourceFingerprint(root, config), originalHash, name);
  }
  const removed = path.join(root, "candidate/src/page.astro");
  const content = readFileSync(removed);
  rmSync(removed);
  assert.notEqual(sourceFingerprint(root, config), originalHash);
  writeFileSync(removed, content);
  assert.equal(sourceFingerprint(root, config), originalHash);
});

test("all shipped targets include the packaged removal guide in verification", (t) => {
  const name = "packages/emdash-plugin-seo/UNINSTALL-PROMPT.md";
  const { root } = targetFixture(t);
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  for (const target of [undefined, "native-1.3.0"]) {
    assert.ok(readConfig(repository, target).sourceFiles.includes(name), target ?? "default");
  }
  const selected = readConfig(root, "native-1.3.0");
  selected.sourceFiles = [...selected.sourceFiles, name];
  writeFileSync(file, "# Remove while keeping data\n");
  const originalHash = sourceFingerprint(root, selected);
  writeFileSync(file, "# Remove with revised backup guidance\n");
  assert.notEqual(sourceFingerprint(root, selected), originalHash);
});

test("profile and host metadata enter the fingerprint even with the same source files", (t) => {
  const { root } = targetFixture(t);
  const config = readConfig(root, "native-1.1.0");
  const originalHash = sourceFingerprint(root, config);
  for (const changed of [
    { ...config, profile: "other" },
    { ...config, host: { ...config.host, target: "published-1.0.1" } },
    { ...config, host: { ...config.host, format: "standard" } },
    { ...config, host: { ...config.host, runner: "workerd" } },
    { ...config, host: { ...config.host, storage: "d1" } },
  ]) assert.notEqual(sourceFingerprint(root, changed), originalHash);
});

test("all targets fingerprint the CI workflow and Node setup pin without explicit source entries", (t) => {
  const { root } = targetFixture(t);
  mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  const files = [
    [".node-version", "24.19.0\n", "24.20.0\n"],
    [".github/workflows/verify.yml", "name: Verify\n", "name: Changed verification\n"],
  ];
  for (const [name, original] of files) writeFileSync(path.join(root, name), original);
  for (const target of [undefined, "native-1.1.0", "native-1.2.0", "native-1.3.0"]) {
    const config = readConfig(root, target);
    const originalHash = sourceFingerprint(root, config);
    for (const [name, original, changed] of files) {
      assert.equal(config.sourceFiles.includes(name), false);
      writeFileSync(path.join(root, name), changed);
      assert.notEqual(sourceFingerprint(root, config), originalHash, `${config.profile}: ${name}`);
      writeFileSync(path.join(root, name), original);
      assert.equal(sourceFingerprint(root, config), originalHash, `${config.profile}: restored ${name}`);
    }
  }
});

test("candidate reports cannot read baseline evidence or mismatched target metadata", (t) => {
  const { root } = targetFixture(t);
  const baseline = readConfig(root);
  const candidate = readConfig(root, "native-1.1.0");
  const directory = ensureReports(root, ["run.json", "native-1.1.0-run.json"]);
  writeReportJson(path.join(directory, "run.json"), recordedSummary(root, baseline));
  const original = readFileSync(path.join(directory, "run.json"), "utf8");
  assert.throws(() => readRecordedReport(root, candidate), /No recorded development run for native-1.1.0/);
  const file = path.join(directory, "native-1.1.0-run.json");
  writeReportJson(file, recordedSummary(root, baseline));
  assert.throws(() => readRecordedReport(root, candidate), /target metadata does not match/);
  const summary = recordedSummary(root, candidate);
  for (const changed of [
    { ...summary, profile: "default" },
    { ...summary, dependencyRoot: "baseline" },
    { ...summary, ports: [{ name: "Preview", port: 4360 }] },
    ...["target", "format", "runner", "storage"].map((key) => ({ ...summary, host: { ...summary.host, [key]: "wrong" } })),
  ]) {
    writeReportJson(file, changed);
    assert.throws(() => readRecordedReport(root, candidate), /target metadata does not match/);
  }
  writeReportJson(file, summary);
  assert.equal(readRecordedReport(root, candidate).sourceChanged, false);
  writeFileSync(path.join(root, "candidate/astro-native.config.mjs"), "export default { changed: true };\n");
  assert.equal(readRecordedReport(root, candidate).sourceChanged, true);
  assert.equal(readFileSync(path.join(directory, "run.json"), "utf8"), original);
});

test("recorded reads reject oversized reports and ownership markers without changing either file", (t) => {
  for (const oversized of ["run.json", ".owned.json"]) {
    const { root } = targetFixture(t);
    const config = readConfig(root);
    const directory = ensureReports(root, ["run.json"]);
    const file = path.join(directory, "run.json");
    const marker = path.join(directory, ".owned.json");
    writeReportJson(file, recordedSummary(root, config));
    assert.equal(readRecordedReport(root, config).sourceChanged, false);
    const target = path.join(directory, oversized);
    const value = JSON.parse(readFileSync(target, "utf8"));
    writeFileSync(target, JSON.stringify({ ...value, padding: "a".repeat(64 * 1024) }));
    const reportBytes = readFileSync(file);
    const markerBytes = readFileSync(marker);
    const names = readdirSync(directory).sort();
    assert.throws(() => readRecordedReport(root, config), /exceeds 64 KiB/, oversized);
    assert.deepEqual(readFileSync(file), reportBytes);
    assert.deepEqual(readFileSync(marker), markerBytes);
    assert.deepEqual(readdirSync(directory).sort(), names);
  }
});

test("recorded reads refuse either symlinked report parent without touching the target", (t) => {
  for (const parent of ["artifacts", "artifacts/plugin-dev"]) {
    const { root } = targetFixture(t);
    const config = readConfig(root);
    const directory = ensureReports(root, ["run.json"]);
    writeReportJson(path.join(directory, "run.json"), recordedSummary(root, config));
    const reportBytes = readFileSync(path.join(directory, "run.json"));
    const markerBytes = readFileSync(path.join(directory, ".owned.json"));
    const moved = path.join(root, "moved-reports");
    renameSync(path.join(root, parent), moved);
    symlinkSync(moved, path.join(root, parent));
    const target = parent === "artifacts" ? path.join(moved, "plugin-dev") : moved;
    const names = readdirSync(target).sort();
    assert.throws(() => readRecordedReport(root, config), /symlinked/, parent);
    assert.deepEqual(readFileSync(path.join(target, "run.json")), reportBytes);
    assert.deepEqual(readFileSync(path.join(target, ".owned.json")), markerBytes);
    assert.deepEqual(readdirSync(target).sort(), names);
  }
});

test("recorded reads do not claim foreign, unowned or unmarked evidence", (t) => {
  for (const ownership of ["foreign", "unowned", "missing marker"]) {
    const { root } = targetFixture(t);
    const config = readConfig(root);
    const directory = ensureReports(root, ["run.json"]);
    const file = path.join(directory, "run.json");
    const marker = path.join(directory, ".owned.json");
    writeReportJson(file, recordedSummary(root, config));
    if (ownership === "foreign") {
      const other = fixture(t);
      const foreign = ensureReports(other, ["run.json"]);
      writeFileSync(marker, readFileSync(path.join(foreign, ".owned.json")));
    } else if (ownership === "unowned") {
      const value = JSON.parse(readFileSync(marker, "utf8"));
      writeFileSync(marker, JSON.stringify({ ...value, files: [] }));
    } else rmSync(marker);
    const reportBytes = readFileSync(file);
    const markerBytes = existsSync(marker) ? readFileSync(marker) : null;
    const names = readdirSync(directory).sort();
    assert.throws(() => readRecordedReport(root, config), ownership === "missing marker" ? /ENOENT/ : /not owned/, ownership);
    assert.deepEqual(readFileSync(file), reportBytes);
    if (markerBytes === null) assert.equal(existsSync(marker), false);
    else assert.deepEqual(readFileSync(marker), markerBytes);
    assert.deepEqual(readdirSync(directory).sort(), names);
  }
});

test("a saved source-change finding survives an unchanged current fingerprint", (t) => {
  const { root } = targetFixture(t);
  const config = readConfig(root, "native-1.1.0");
  for (const label of ["run", "verification"]) {
    const name = `${reportLabel(config, label)}.json`;
    const directory = ensureReports(root, [name]);
    const file = path.join(directory, name);
    const summary = { ...recordedSummary(root, config), sourceChanged: true };
    writeReportJson(file, summary);
    const original = readFileSync(file);
    const marker = readFileSync(path.join(directory, ".owned.json"));
    assert.equal(summary.sourceHash, sourceFingerprint(root, config));
    assert.equal(readRecordedReport(root, config, label).sourceChanged, true);
    assert.deepEqual(readFileSync(file), original);
    assert.deepEqual(readFileSync(path.join(directory, ".owned.json")), marker);
  }
});

test("known successful commands record the selected child host and preserve baseline report files", async (t) => {
  const { root } = targetFixture(t);
  const versions = { node: process.versions.node, pnpm: "fixture" };
  const lock = path.join(root, "global.lock");
  const previousTarget = process.env.SHIPIT_HOST_TARGET;
  const previousHost = process.env.SHIPIT_PUBLISHED_HOST;
  try {
    process.env.SHIPIT_HOST_TARGET = "native-1.1.0";
    process.env.SHIPIT_PUBLISHED_HOST = "/wrong";
    const baseline = readConfig(root);
    assert.equal(await runTasks(root, baseline, "verify", versions, checkDependencies(root, baseline), lock), 0);
    const directory = path.join(root, "artifacts/plugin-dev");
    const original = readFileSync(path.join(directory, "run.json"), "utf8");
    const baselineChild = JSON.parse(readFileSync(path.join(directory, "control.log"), "utf8"));
    assert.deepEqual(baselineChild, { target: "published-1.0.1", fixture: path.join(root, "baseline") });

    process.env.SHIPIT_HOST_TARGET = "published-1.0.1";
    const candidate = readConfig(root, "native-1.1.0");
    assert.equal(await runTasks(root, candidate, "verify", versions, checkDependencies(root, candidate), lock), 0);
    const summary = readRecordedReport(root, candidate);
    const candidateChild = JSON.parse(readFileSync(path.join(directory, "native-1.1.0-control.log"), "utf8"));
    assert.deepEqual(candidateChild, { target: summary.host.target, fixture: path.join(root, summary.dependencyRoot) });
    assert.equal(summary.status, "passed");
    assert.equal(summary.sourceChanged, false);
    assert.ok(summary.finishedAt);
    assert.deepEqual(summary.packages, { emdash: "1.1.0" });
    assert.equal(summary.checks.length, 1);
    assert.equal(summary.checks[0].exitCode, 0);
    assert.equal(readFileSync(path.join(directory, "run.json"), "utf8"), original);
    assert.equal(existsSync(lock), false);
  } finally {
    if (previousTarget === undefined) delete process.env.SHIPIT_HOST_TARGET;
    else process.env.SHIPIT_HOST_TARGET = previousTarget;
    if (previousHost === undefined) delete process.env.SHIPIT_PUBLISHED_HOST;
    else process.env.SHIPIT_PUBLISHED_HOST = previousHost;
  }
});

test("full verification identities propagate to children and survive later non-verification tasks", async (t) => {
  const fields = ["SHIPIT_VERIFY_ID", "SHIPIT_VERIFY_STARTED_AT", "SHIPIT_VERIFY_SOURCE_HASH", "SHIPIT_VERIFY_TARGET"];
  const previous = Object.fromEntries(fields.map(name => [name, process.env[name]]));
  try {
    for (const name of fields) process.env[name] = "inherited-value";
    for (const target of [undefined, "native-1.1.0", "native-1.2.0", "native-1.3.0"]) {
      const { root, config, save } = targetFixture(t);
      const selected = target === undefined ? config : config.targets[target];
      const args = ["-e", `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(fields)}.map(name => [name, process.env[name] ?? null]))))`];
      selected.tasks = Object.fromEntries(["verify", "quick", "setup", "dev"].map(command => [command, [
        { label: `${command}-context`, command: "node", args },
      ]]));
      save();
      const chosen = readConfig(root, target);
      const versions = { node: process.versions.node, pnpm: "fixture" };
      const packages = checkDependencies(root, chosen);
      const lock = path.join(root, "global.lock");
      const run = command => runTasks(root, chosen, command, versions, command === "setup" ? {} : packages, lock);
      const directory = path.join(root, "artifacts/plugin-dev");
      const child = command => JSON.parse(readFileSync(path.join(directory, `${reportLabel(chosen, `${command}-context`)}.log`), "utf8"));

      assert.equal(await run("verify"), 0);
      const verification = readRecordedReport(root, chosen, "verification");
      assert.equal(verification.status, "passed");
      assert.match(verification.verificationId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      assert.deepEqual(child("verify"), {
        SHIPIT_VERIFY_ID: verification.verificationId,
        SHIPIT_VERIFY_STARTED_AT: verification.startedAt,
        SHIPIT_VERIFY_SOURCE_HASH: verification.sourceHash,
        SHIPIT_VERIFY_TARGET: chosen.profile,
      });
      const file = path.join(directory, `${reportLabel(chosen, "verification")}.json`);
      const retained = readFileSync(file, "utf8");
      for (const command of ["quick", "setup", "dev"]) {
        // A preview that exits by itself, even with code 0, is a failed preview.
        assert.equal(await run(command), command === "dev" ? 1 : 0, command);
        const latest = readRecordedReport(root, chosen);
        assert.equal(latest.task, command);
        if (command === "dev") assert.equal(latest.status, "failed");
        assert.equal(latest.verificationId, null);
        assert.deepEqual(child(command), Object.fromEntries(fields.map(name => [name, null])), command);
        assert.equal(readFileSync(file, "utf8"), retained, `${command} must preserve the full verification snapshot`);
        assert.deepEqual(readRecordedReport(root, chosen, "verification"), verification);
      }
      assert.equal(await run("verify"), 0);
      const next = readRecordedReport(root, chosen, "verification");
      assert.notEqual(next.verificationId, verification.verificationId);
      assert.equal(child("verify").SHIPIT_VERIFY_ID, next.verificationId);
      assert.equal(existsSync(lock), false);
    }
    for (const name of fields) assert.equal(process.env[name], "inherited-value");
  } finally {
    for (const name of fields) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("a known failing command records a finished failed candidate run and stops later checks", async (t) => {
  const { root, config, save } = targetFixture(t);
  config.targets["native-1.1.0"].tasks.verify = [
    { label: "pass-control", command: "node", args: ["-e", "process.exit(0)"] },
    { label: "fail-control", command: "node", args: ["-e", "process.exit(7)"] },
    { label: "unreached", command: "node", args: ["-e", "process.exit(0)"] },
  ];
  save();
  const candidate = readConfig(root, "native-1.1.0");
  const lock = path.join(root, "global.lock");
  assert.equal(await runTasks(root, candidate, "verify", { node: process.versions.node, pnpm: "fixture" }, checkDependencies(root, candidate), lock), 1);
  const summary = readRecordedReport(root, candidate);
  assert.equal(summary.status, "failed");
  assert.equal(summary.sourceChanged, false);
  assert.ok(summary.finishedAt);
  assert.deepEqual(summary.checks.map(({ status, exitCode }) => ({ status, exitCode })), [
    { status: "passed", exitCode: 0 }, { status: "failed", exitCode: 7 },
  ]);
  assert.deepEqual(readRecordedReport(root, candidate, "verification"), summary);
  assert.equal(existsSync(path.join(root, "artifacts/plugin-dev/native-1.1.0-unreached.json")), false);
  assert.equal(existsSync(lock), false);
});

function previewTest(name, run) {
  for (const command of ["dev-admin", "dev-engine"]) test(`${name} (${command})`, (t) => run(t, command));
}

function adminFixture(t, preview = "process.exit(0)", { previewTimeoutMs = 5_000, refresh, command = "dev-admin" } = {}) {
  const fixtureState = targetFixture(t);
  const { root, config, save } = fixtureState;
  const marker = path.join(root, "refreshed-output.txt");
  const target = config.targets["native-1.1.0"];
  target.tasks[command] = [
    { label: "refresh-control", command: "node", args: ["-e", refresh ?? `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'refreshed')`] },
    { label: "preview-control", command: "node", args: ["-e", preview], timeoutMs: previewTimeoutMs },
  ];
  target.preflight = { [command]: { files: ["candidate/astro-native.config.mjs", "src/admin-ui/panel.tsx"] } };
  save();
  return { ...fixtureState, command, marker, lock: path.join(root, "global.lock"), versions: { node: process.versions.node, pnpm: "fixture" } };
}

function assertUntouched(root, marker, lock) {
  assert.equal(existsSync(marker), false, "the refresh step must not run");
  assert.equal(existsSync(path.join(root, "artifacts")), false, "no evidence may be written");
  assert.equal(existsSync(lock), false, "the lock is released");
}

test("admin source preview selects the current native host by default", async () => {
  const normal = readConfig(repository);
  assert.equal(normal.host.target, compatibility.currentTarget);
  assert.deepEqual(normal.tasks["dev-admin"], readConfig(repository, compatibility.currentTarget).tasks["dev-admin"]);
  for (const target of ["published-1.0.1", "native-1.1.0", "native-1.2.0"]) {
    assert.throws(() => readConfig(repository, target), /Unknown development target/);
  }
  await assert.rejects(main(["dev-admin", "--target", compatibility.currentTarget, "--port", "4000"], repository), /Usage/);
  await assert.rejects(main(["dev-admin", "--target", "missing"], repository), /Unknown development target/);
  for (const name of Object.keys(compatibility.targets)) {
    const config = readConfig(repository, name);
    const target = compatibility.targets[name];
    const [refresh, preview] = config.tasks["dev-admin"];
    assert.deepEqual(refresh.args, config.tasks.refresh[0].args);
    assert.deepEqual(preview.args, ["--import=./scripts/published-host/host-loader.mjs", "scripts/published-host/dev-admin.mjs", "--target", name]);
    assert.equal(preview.args.includes("--runtime-only"), false);
    assert.deepEqual(config.ports, [{ name: "Native EmDash preview", port: target.port }]);
    assert.ok(config.sourceFiles.includes(target.dependencyRoot + "/astro.native-admin.config.mjs"));
    for (const file of config.preflight["dev-admin"].files) assert.ok(existsSync(path.join(repository, file)), file);
  }
});

test("the admin source entry selects matching native targets and refuses mismatched or undeclared targets before Astro", (t) => {
  const root = fixture(t);
  const scriptDirectory = path.join(root, "scripts/published-host");
  mkdirSync(scriptDirectory, { recursive: true });
  const script = path.join(scriptDirectory, "dev-admin.mjs");
  const marker = path.join(scriptDirectory, "selected-preview.json");
  copyFileSync(path.join(repository, "scripts/published-host/dev-admin.mjs"), script);
  copyFileSync(path.join(repository, "scripts/compatibility.mjs"), path.join(root, "scripts/compatibility.mjs"));
  copyFileSync(path.join(repository, "compatibility.json"), path.join(root, "compatibility.json"));
  const ports = Object.fromEntries(Object.entries(compatibility.targets).map(([name, target]) => [name, target.port]));
  writeFileSync(path.join(scriptDirectory, "environment.mjs"), [
    'export function createEnvironment() { return { target: { name: process.env.SHIPIT_HOST_TARGET, fixtureRoot: new URL("./fixture/", import.meta.url), port: (' + JSON.stringify(ports) + ')[process.env.SHIPIT_HOST_TARGET] }, assertVersions() {} }; }',
    'export function runtimeExport() { return new URL("./astro.mjs", import.meta.url); }',
  ].join("\n"));
  writeFileSync(path.join(scriptDirectory, "astro.mjs"), 'import { writeFileSync } from "node:fs"; export async function dev(options) { writeFileSync(new URL("./selected-preview.json", import.meta.url), JSON.stringify(options)); }');
  const run = (args, target) => spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, SHIPIT_HOST_TARGET: target, SHIPIT_PUBLISHED_HOST: root },
  });
  const [first, second] = Object.keys(ports);
  for (const [args, target] of [
    [["--target", first], second],
    [["--target", second], first],
    [["--target", "native-9.9.9"], "native-9.9.9"],
    [["--target", "published-1.2.0"], "published-1.2.0"],
  ]) {
    const result = run(args, target);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(marker), false);
  }
  for (const [target, port] of Object.entries(ports)) {
    const result = run(["--target", target], target);
    assert.equal(result.status, 0, result.stderr);
    const options = JSON.parse(readFileSync(marker, "utf8"));
    assert.equal(options.configFile, "astro.native-admin.config.mjs");
    assert.equal(options.server.host, "127.0.0.1");
    assert.equal(options.server.port, port);
    rmSync(marker);
  }
});

test("preflight configuration names an existing task group and repository files only", (t) => {
  const { root, config, save } = targetFixture(t);
  config.targets["native-1.1.0"].preflight = { missing: { files: ["src/descriptor.ts"] } };
  save();
  assert.throws(() => readConfig(root, "native-1.1.0"), /Invalid preflight/);
  config.targets["native-1.1.0"].preflight = { verify: { files: ["../outside.txt"] } };
  save();
  assert.throws(() => readConfig(root, "native-1.1.0"), /inside the repository/);
  config.targets["native-1.1.0"].preflight = { verify: { files: ["src/descriptor.ts"], ports: [1] } };
  save();
  assert.throws(() => readConfig(root, "native-1.1.0"), /Invalid preflight/);
});

previewTest("a busy preview port refuses the preview command before the refresh or any evidence", async (t, command) => {
  const { root, config, save, marker, lock, versions } = adminFixture(t, undefined, { command });
  const server = createServer();
  await new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  t.after(() => server.close());
  config.targets["native-1.1.0"].ports = [{ name: "Preview", port: server.address().port }];
  save();
  const candidate = readConfig(root, "native-1.1.0");
  await assert.rejects(runTasks(root, candidate, command, versions, checkDependencies(root, candidate), lock), /in use/);
  assertUntouched(root, marker, lock);
});

previewTest("missing source, missing dependencies and a held lock refuse truthfully without refreshing", async (t, command) => {
  const free = { isPortInUse: async () => false };
  {
    const { root, marker, lock, versions } = adminFixture(t, undefined, { command });
    rmSync(path.join(root, "src/admin-ui/panel.tsx"));
    const candidate = readConfig(root, "native-1.1.0");
    await assert.rejects(runTasks(root, candidate, command, versions, {}, lock, free), /src\/admin-ui\/panel\.tsx is missing/);
    assertUntouched(root, marker, lock);
  }
  {
    const { root, marker, lock, versions } = adminFixture(t, undefined, { command });
    rmSync(path.join(root, "candidate/node_modules/emdash"), { recursive: true });
    const candidate = readConfig(root, "native-1.1.0");
    await assert.rejects(runTasks(root, candidate, command, versions, {}, lock, free), /emdash is missing/);
    assertUntouched(root, marker, lock);
  }
  {
    const { root, marker, lock, versions } = adminFixture(t, undefined, { command });
    const release = acquireLock(root, lock);
    try {
      const candidate = readConfig(root, "native-1.1.0");
      await assert.rejects(runTasks(root, candidate, command, versions, {}, lock, free), /active/);
      assert.equal(existsSync(marker), false);
      assert.equal(existsSync(path.join(root, "artifacts")), false);
    } finally { release(); }
  }
});

previewTest("a preview that exits by itself or times out is failed even after a successful refresh", async (t, command) => {
  const free = { isPortInUse: async () => false };
  for (const [preview, options, expected] of [
    ["process.exit(0)", {}, "passed"],
    ["setInterval(() => {}, 100)", { previewTimeoutMs: 200 }, "timed_out"],
  ]) {
    const { root, marker, lock, versions } = adminFixture(t, preview, { ...options, command });
    const candidate = readConfig(root, "native-1.1.0");
    const directory = ensureReports(root, ["native-1.1.0-verification.json"]);
    const verification = path.join(directory, "native-1.1.0-verification.json");
    const prior = '{"task":"verify","keep":true}\n';
    writeFileSync(verification, prior);
    assert.equal(await runTasks(root, candidate, command, versions, checkDependencies(root, candidate), lock, free), 1);
    const summary = readRecordedReport(root, candidate);
    assert.equal(summary.task, command);
    assert.equal(summary.status, "failed");
    assert.equal(summary.verificationId, null);
    assert.deepEqual(summary.checks.map((check) => check.status), ["passed", expected]);
    assert.equal(summary.cleanup, null);
    assert.equal(existsSync(marker), true);
    assert.equal(readFileSync(verification, "utf8"), prior);
    assert.equal(existsSync(lock), false);
  }
});

async function interruptedRun(t, fixtureState, interruptAfter) {
  const { root, lock, versions, command } = fixtureState;
  const ready = path.join(root, interruptAfter);
  const resultFile = path.join(root, "harness-result.txt");
  const harness = `import { readConfig, runTasks } from ${JSON.stringify(new URL("./cli.mjs", import.meta.url).href)}; import { writeFileSync } from 'node:fs';
    const config = readConfig(${JSON.stringify(root)}, 'native-1.1.0');
    const code = await runTasks(${JSON.stringify(root)}, config, ${JSON.stringify(command)}, ${JSON.stringify(versions)}, { emdash: '1.1.0' }, ${JSON.stringify(lock)}, { isPortInUse: async () => false });
    writeFileSync(${JSON.stringify(resultFile)}, String(code));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", harness], { stdio: "ignore" });
  const ended = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await ended; });
  const deadline = Date.now() + 10_000;
  while (!existsSync(ready) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(existsSync(ready), "the harness reached the interruption point");
  const workload = Number(readFileSync(ready, "utf8"));
  child.kill("SIGTERM");
  assert.deepEqual(await ended, { code: 0, signal: null });
  let workloadAlive = true;
  try { process.kill(workload, 0); } catch { workloadAlive = false; }
  return { code: Number(readFileSync(resultFile, "utf8")), summary: readRecordedReport(root, readConfig(root, "native-1.1.0")), workloadAlive };
}

previewTest("only a requested stop of the running preview with clean cleanup is stopped", async (t, command) => {
  const readyPreview = (handler = "") => `${handler} require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'preview-ready'), String(process.pid)); setInterval(() => {}, 100);`;
  {
    const fixtureState = adminFixture(t, readyPreview(), { command });
    const { code, summary, workloadAlive } = await interruptedRun(t, fixtureState, "preview-ready");
    assert.equal(code, 0);
    assert.equal(summary.status, "stopped");
    assert.equal(summary.task, command);
    assert.equal(summary.verificationId, null);
    assert.equal(summary.checks[1].interruptedBy !== null, true);
    assert.equal(summary.cleanup, null);
    assert.equal(workloadAlive, false);
    assert.equal(existsSync(fixtureState.lock), false);
  }
  {
    const fixtureState = adminFixture(t, readyPreview("process.on('SIGTERM', () => process.exit(7));"), { command });
    const { code, summary, workloadAlive } = await interruptedRun(t, fixtureState, "preview-ready");
    assert.equal(code, 1, "a failure during the requested shutdown stays failed");
    assert.equal(summary.status, "failed");
    assert.equal(summary.checks[1].exitCode, 7);
    assert.equal(workloadAlive, false);
    assert.equal(existsSync(fixtureState.lock), false);
  }
  {
    // SIGUSR2 terminates without a core dump. A dumping crash signal can outlive
    // the TERM grace and is then recorded as the runner's SIGKILL.
    const fixtureState = adminFixture(t, readyPreview("process.on('SIGTERM', () => process.kill(process.pid, 'SIGUSR2'));"), { command });
    const { code, summary, workloadAlive } = await interruptedRun(t, fixtureState, "preview-ready");
    assert.equal(code, 1, "an unexpected signal during the requested shutdown stays failed");
    assert.equal(summary.status, "failed");
    assert.equal(summary.checks[1].stopRequestedBeforeExit, true);
    assert.equal(summary.checks[1].signal, "SIGUSR2");
    assert.equal(summary.checks[1].cleanupError, null);
    assert.equal(summary.checks[1].groupAbsentConfirmed, true);
    assert.equal(summary.cleanup, null);
    assert.equal(workloadAlive, false);
    assert.equal(existsSync(fixtureState.lock), false);
  }
  {
    const refresh = `require('node:fs').writeFileSync(require('node:path').join(process.cwd(), 'refresh-running'), String(process.pid)); setInterval(() => {}, 100);`;
    const fixtureState = adminFixture(t, readyPreview(), { refresh, command });
    const { code, summary } = await interruptedRun(t, fixtureState, "refresh-running");
    assert.equal(code, 1, "stopping before the preview runs is not a stopped preview");
    assert.equal(summary.status, "failed");
    assert.deepEqual(summary.checks.map((check) => check.label), ["refresh-control"]);
    assert.equal(existsSync(path.join(fixtureState.root, "preview-ready")), false);
    assert.equal(existsSync(fixtureState.lock), false);
  }
});

previewTest("an unconfirmed cleanup keeps the lock and records the workload before evidence is final", async (t, command) => {
  const { root, lock, versions } = adminFixture(t, undefined, { command });
  const candidate = readConfig(root, "native-1.1.0");
  const original = process.kill;
  process.kill = (pid, signal) => {
    if (pid < 0) throw Object.assign(new Error("simulated group signal failure"), { code: "EPERM" });
    return original.call(process, pid, signal);
  };
  let code;
  try {
    code = await runTasks(root, candidate, command, versions, checkDependencies(root, candidate), lock, { isPortInUse: async () => false });
  } finally { process.kill = original; }
  t.after(() => rmSync(lock, { recursive: true, force: true }));
  assert.equal(code, 1);
  const summary = readRecordedReport(root, candidate);
  assert.equal(summary.status, "failed");
  assert.equal(summary.cleanup.uncertain, true);
  assert.equal(summary.cleanup.label, "refresh-control");
  assert.equal(summary.cleanup.error, "EPERM");
  assert.equal(summary.cleanup.lock, "retained");
  assert.ok(Number.isInteger(summary.cleanup.pid) && summary.cleanup.pid > 0);
  assert.equal(summary.cleanup.pgid, summary.cleanup.pid);
  assert.equal(summary.checks[0].latestCleanupFailure.code, "EPERM");
  assert.ok(summary.checks[0].groupSignalErrorCount >= 1);
  assert.equal(summary.checks[0].groupAbsentConfirmed, false);
  assert.equal(existsSync(path.join(lock, "owner.json")), true, "the lock stays held for inspection");
});

test("preview status requires every earlier step to pass and a clean requested stop of the last one", () => {
  const tasks = [{}, {}];
  const passed = { status: "passed" };
  const stoppedBySignal = { status: "signaled", interruptedBy: "SIGINT", stopRequestedBeforeExit: true, timedOut: false, cleanupError: null, spawnError: null, runnerError: null, signal: "SIGINT", exitCode: null };
  assert.equal(previewStatus(tasks, [passed, stoppedBySignal], true), "stopped");
  assert.equal(previewStatus(tasks, [passed, { ...stoppedBySignal, signal: null, exitCode: 143 }], true), "stopped");
  assert.equal(previewStatus(tasks, [passed, stoppedBySignal], false), "failed");
  assert.equal(previewStatus(tasks, [passed, { ...stoppedBySignal, stopRequestedBeforeExit: false, signal: null, exitCode: 0 }], true), "failed",
    "a stop that arrives after the preview already exited is not a requested stop");
  assert.equal(previewStatus(tasks, [passed, { ...stoppedBySignal, cleanupError: "PROCESS_GROUP_STILL_PRESENT" }], true), "failed");
  assert.equal(previewStatus(tasks, [passed, { ...stoppedBySignal, timedOut: true }], true), "failed");
  assert.equal(previewStatus(tasks, [passed, { ...stoppedBySignal, signal: null, exitCode: 1 }], true), "failed");
  for (const signal of ["SIGKILL", "SIGABRT", "SIGSEGV", "SIGBUS"]) {
    assert.equal(previewStatus(tasks, [passed, { ...stoppedBySignal, signal }], true), "failed", signal);
  }
  assert.equal(previewStatus(tasks, [{ status: "failed" }, stoppedBySignal], true), "failed");
  assert.equal(previewStatus(tasks, [passed], true), "failed");
});

test("a stop that arrives after the preview leader exited cannot turn that exit into a stopped preview", async (t) => {
  const survivor = "process.on('SIGTERM', () => {}); const fs = require('node:fs'); const parent = process.ppid; const timer = setInterval(() => { if (process.ppid !== parent) { clearInterval(timer); setTimeout(() => fs.writeFileSync(MARKER, String(process.pid)), 200); } }, 10); setInterval(() => {}, 100);".replace("MARKER", "require('node:path').join(process.cwd(), 'leader-exited')");
  const preview = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(survivor)}], { stdio: 'ignore' }); setTimeout(() => process.exit(0), 300);`;
  const fixtureState = adminFixture(t, preview);
  const { code, summary, workloadAlive } = await interruptedRun(t, fixtureState, "leader-exited");
  assert.equal(code, 1);
  assert.equal(summary.status, "failed");
  assert.equal(summary.checks[1].exitCode, 0);
  assert.equal(summary.checks[1].stopRequestedBeforeExit, false);
  assert.equal(workloadAlive, false, "the remaining child is still cleaned up");
  assert.equal(existsSync(fixtureState.lock), false);
});

test("a report write failure after an unconfirmed cleanup still names the workload and keeps the lock", async (t) => {
  const breakReport = `const fs = require('node:fs'); const path = require('node:path'); const file = path.join(process.cwd(), 'artifacts/plugin-dev/native-1.1.0-run.json'); fs.rmSync(file); fs.mkdirSync(file);`;
  const { root, lock, versions } = adminFixture(t, "process.exit(0)", { refresh: breakReport });
  const candidate = readConfig(root, "native-1.1.0");
  const original = process.kill;
  const originalError = console.error;
  const messages = [];
  process.kill = (pid, signal) => {
    if (pid < 0) throw Object.assign(new Error("simulated group signal failure"), { code: "EPERM" });
    return original.call(process, pid, signal);
  };
  console.error = (...parts) => { messages.push(parts.join(" ")); };
  t.after(() => rmSync(lock, { recursive: true, force: true }));
  try {
    await assert.rejects(runTasks(root, candidate, "dev-admin", versions, checkDependencies(root, candidate), lock, { isPortInUse: async () => false }), /non-file report path/);
  } finally {
    process.kill = original;
    console.error = originalError;
  }
  const warning = messages.find((message) => message.includes("was not confirmed"));
  assert.ok(warning, "the cleanup warning is printed before the failing report write");
  assert.match(warning, /refresh-control was not confirmed \(EPERM\)\. Process group \d+ \(leader PID \d+\)/);
  assert.equal(existsSync(path.join(lock, "owner.json")), true);
});

previewTest("missing or mismatched installed host pins refuse the preview command before the refresh", async (t, command) => {
  const free = { isPortInUse: async () => false };
  const pinned = (fixtureState) => {
    const { root, config, save } = fixtureState;
    config.targets["native-1.1.0"].preflight[command].installedPins = true;
    save();
    writeFileSync(path.join(root, "candidate/package.json"), JSON.stringify({ private: true, dependencies: { "@astrojs/node": "11.1.4", emdash: "1.1.0" }, devDependencies: { tsdown: "0.20.3" } }));
  };
  const install = (root, name, version) => {
    mkdirSync(path.join(root, "candidate/node_modules", name), { recursive: true });
    writeFileSync(path.join(root, "candidate/node_modules", name, "package.json"), JSON.stringify({ version }));
  };
  {
    const fixtureState = adminFixture(t, undefined, { command });
    pinned(fixtureState);
    install(fixtureState.root, "tsdown", "0.20.3");
    const candidate = readConfig(fixtureState.root, "native-1.1.0");
    await assert.rejects(runTasks(fixtureState.root, candidate, command, fixtureState.versions, {}, fixtureState.lock, free), /@astrojs\/node is not installed/);
    assertUntouched(fixtureState.root, fixtureState.marker, fixtureState.lock);
  }
  {
    const fixtureState = adminFixture(t, undefined, { command });
    pinned(fixtureState);
    install(fixtureState.root, "tsdown", "0.20.3");
    install(fixtureState.root, "@astrojs/node", "11.1.3");
    const candidate = readConfig(fixtureState.root, "native-1.1.0");
    await assert.rejects(runTasks(fixtureState.root, candidate, command, fixtureState.versions, {}, fixtureState.lock, free), /pins 11\.1\.4, found 11\.1\.3/);
    assertUntouched(fixtureState.root, fixtureState.marker, fixtureState.lock);
  }
  {
    const fixtureState = adminFixture(t, undefined, { command });
    pinned(fixtureState);
    install(fixtureState.root, "tsdown", "0.20.3");
    install(fixtureState.root, "@astrojs/node", "11.1.4");
    const candidate = readConfig(fixtureState.root, "native-1.1.0");
    assert.equal(await runTasks(fixtureState.root, candidate, command, fixtureState.versions, checkDependencies(fixtureState.root, candidate), fixtureState.lock, free), 1);
    assert.equal(existsSync(fixtureState.marker), true, "matching pins reach the refresh");
    assert.equal(existsSync(fixtureState.lock), false);
  }
});

test("the engine command defaults to the current host and refreshes before preview", async (t) => {
  const normal = readConfig(repository);
  assert.equal(normal.host.target, compatibility.currentTarget);
  await assert.rejects(main(["dev-engine", "--target", compatibility.currentTarget, "--watch"], repository), /Usage/);
  await assert.rejects(main(["dev-engine", "--target", "missing"], repository), /Unknown development target/);
  const { root, config, save } = targetFixture(t);
  config.targets["other-sandbox"] = { ...config.targets["native-1.1.0"],
    host: { ...config.targets["native-1.1.0"].host, target: "other-sandbox", format: "sandbox" } };
  save();
  await assert.rejects(main(["dev-engine", "--target", "other-sandbox"], root), /requires a native host/);
  assert.equal(existsSync(path.join(root, "artifacts")), false);
  for (const name of Object.keys(compatibility.targets)) {
    const native = readConfig(repository, name);
    const target = compatibility.targets[name];
    assert.equal(native.tasks["dev-engine"].length, 2);
    const [refresh, preview] = native.tasks["dev-engine"];
    assert.equal(refresh.command, "node");
    assert.deepEqual(refresh.args, native.tasks.refresh[0].args);
    assert.equal(refresh.timeoutMs, native.tasks.refresh[0].timeoutMs);
    assert.equal(preview.command, "node");
    assert.deepEqual(preview.args, native.tasks.dev[0].args);
    assert.equal(preview.timeoutMs, native.tasks.dev[0].timeoutMs);
    assert.equal(native.preflight["dev-engine"].installedPins, true);
    assert.ok(native.preflight["dev-engine"].files.includes(target.dependencyRoot + "/astro.native.config.mjs"));
    assert.equal(native.preflight["dev-engine"].files.includes(target.dependencyRoot + "/astro.native-admin.config.mjs"), false);
    for (const file of native.preflight["dev-engine"].files) assert.ok(existsSync(path.join(repository, file)), file);
  }
  const scripts = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8")).scripts;
  assert.match(scripts["dev:engine"], /cli\.mjs dev-engine$/);
  assert.match(scripts["dev:setup"], /cli\.mjs setup$/);
});

test("a failed engine refresh prevents preview and preserves prior full verification", async (t) => {
  const previewMarker = "preview-reached";
  const preview = `require('node:fs').writeFileSync(require('node:path').join(process.cwd(), ${JSON.stringify(previewMarker)}), 'unexpected')`;
  const state = adminFixture(t, preview, { command: "dev-engine", refresh: "process.exit(7)" });
  const target = state.config.targets["native-1.1.0"];
  target.preflight["dev-engine"].installedPins = true;
  writeFileSync(path.join(state.root, "candidate/package.json"), JSON.stringify({ dependencies: { emdash: "1.1.0" } }));
  state.save();
  const directory = ensureReports(state.root, ["native-1.1.0-verification.json"]);
  const verification = path.join(directory, "native-1.1.0-verification.json");
  const prior = '{"task":"verify","keep":true}\n';
  writeFileSync(verification, prior);
  const candidate = readConfig(state.root, "native-1.1.0");
  assert.equal(await runTasks(state.root, candidate, state.command, state.versions, checkDependencies(state.root, candidate), state.lock, { isPortInUse: async () => false }), 1);
  const summary = readRecordedReport(state.root, candidate);
  assert.equal(summary.task, "dev-engine");
  assert.equal(summary.status, "failed");
  assert.equal(summary.verificationId, null);
  assert.deepEqual(summary.checks.map(({ label, status, exitCode }) => ({ label, status, exitCode })), [{ label: "refresh-control", status: "failed", exitCode: 7 }]);
  assert.equal(existsSync(path.join(state.root, previewMarker)), false);
  assert.equal(existsSync(state.marker), false);
  assert.equal(readFileSync(verification, "utf8"), prior);
  assert.equal(existsSync(state.lock), false);
});

function engineWrapperFixture(t, serve) {
  const state = adminFixture(t, undefined, { command: "dev-engine" });
  const directory = path.join(state.root, "scripts/published-host");
  mkdirSync(directory, { recursive: true });
  copyFileSync(path.join(repository, "scripts/published-host/dev.mjs"), path.join(directory, "dev.mjs"));
  writeFileSync(path.join(directory, "environment.mjs"), `
    export const sourceRoot = new URL('../../', import.meta.url);
    export function parseOptions(args) {
      if (JSON.stringify(args) !== JSON.stringify(['--target', 'native-1.1.0'])) throw new Error('Unexpected fixture arguments');
      return { target: { fixtureRoot: new URL('../../candidate/', import.meta.url) } };
    }
    export function createEnvironment() { return { assertVersions() {} }; }
    export function childEnvironment() { return { ...process.env }; }
  `);
  writeFileSync(path.join(directory, "serve.mjs"), serve);
  state.config.targets["native-1.1.0"].tasks["dev-engine"][1].args = ["scripts/published-host/dev.mjs", "--target", "native-1.1.0"];
  state.config.targets["native-1.1.0"].preflight["dev-engine"].files.push("scripts/published-host/dev.mjs", "scripts/published-host/environment.mjs", "scripts/published-host/serve.mjs");
  state.save();
  return state;
}

test("the normal engine wrapper has a clean requested stop", async (t) => {
  const state = engineWrapperFixture(t, "import { writeFileSync } from 'node:fs'; writeFileSync('serve-ready', String(process.pid)); setInterval(() => {}, 100);");
  const { code, summary, workloadAlive } = await interruptedRun(t, state, "serve-ready");
  assert.equal(summary.checks[0].status, "passed");
  assert.equal(summary.checks[1].stopRequestedBeforeExit, true);
  assert.equal(summary.checks[1].groupAbsentConfirmed, true);
  assert.equal(summary.checks[1].exitCode, 143, "the copied wrapper preserves its child's SIGTERM exit");
  assert.equal(code, 0);
  assert.equal(summary.task, "dev-engine");
  assert.equal(summary.status, "stopped");
  assert.equal(summary.verificationId, null);
  assert.equal(summary.cleanup, null);
  assert.equal(workloadAlive, false);
  assert.equal(existsSync(state.lock), false);
});

test("a normal engine wrapper keeps a real child shutdown failure failed", async (t) => {
  const state = engineWrapperFixture(t, "import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => process.exit(1)); writeFileSync('serve-ready', String(process.pid)); setInterval(() => {}, 100);");
  const { code, summary, workloadAlive } = await interruptedRun(t, state, "serve-ready");
  assert.equal(code, 1);
  assert.equal(summary.status, "failed");
  assert.equal(summary.checks[1].exitCode, 1);
  assert.equal(summary.checks[1].stopRequestedBeforeExit, true);
  assert.equal(summary.checks[1].groupAbsentConfirmed, true);
  assert.equal(workloadAlive, false);
  assert.equal(existsSync(state.lock), false);
});

test("unexpected normal wrapper child exits stay failed without a requested stop", async (t) => {
  for (const [childExit, expected] of [["process.exit(0)", 0], ["process.kill(process.pid, 'SIGINT')", 130], ["process.kill(process.pid, 'SIGTERM')", 143], ["process.kill(process.pid, 'SIGUSR2')", 1]]) {
    const state = engineWrapperFixture(t, childExit);
    const candidate = readConfig(state.root, "native-1.1.0");
    assert.equal(await runTasks(state.root, candidate, state.command, state.versions, checkDependencies(state.root, candidate), state.lock, { isPortInUse: async () => false }), 1);
    const summary = readRecordedReport(state.root, candidate);
    assert.equal(summary.status, "failed");
    assert.equal(summary.verificationId, null);
    assert.equal(summary.checks[1].exitCode, expected);
    assert.equal(summary.checks[1].stopRequestedBeforeExit, false);
    assert.equal(summary.checks[1].groupAbsentConfirmed, true);
    assert.equal(summary.cleanup, null);
    assert.equal(existsSync(state.lock), false);
  }
});

test("not-run reports are read once per check and an unreadable line is an unknown check", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shipit-not-run-"));
  try {
    const file = path.join(directory, "not-run.jsonl");
    assert.deepEqual(readNotRun(file), [], "no file means every check ran");
    writeFileSync(file, [
      JSON.stringify({ check: "npm-packed-plugin", reason: "no offline npm cache" }),
      JSON.stringify({ check: "npm-packed-plugin", reason: "again" }),
      "not json",
    ].join("\n") + "\n");
    assert.deepEqual(readNotRun(file), [
      { check: "npm-packed-plugin", reason: "no offline npm cache" },
      { check: "unknown", reason: "unreported" },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("all shipped targets fingerprint the issue chooser configuration", (t) => {
  const name = ".github/ISSUE_TEMPLATE/config.yml";
  for (const target of [undefined, "native-1.3.0"]) {
    const config = readConfig(repository, target);
    assert.ok(config.sourceFiles.includes(name), target ?? "default");
  }
  const { root } = targetFixture(t);
  const config = readConfig(root, "native-1.3.0");
  config.sourceFiles = [...config.sourceFiles, name];
  mkdirSync(path.join(root, ".github/ISSUE_TEMPLATE"), { recursive: true });
  writeFileSync(path.join(root, name), "blank_issues_enabled: false\n");
  const original = sourceFingerprint(root, config);
  writeFileSync(path.join(root, name), "blank_issues_enabled: true\n");
  assert.notEqual(sourceFingerprint(root, config), original);
  writeFileSync(path.join(root, name), "blank_issues_enabled: false\n");
  assert.equal(sourceFingerprint(root, config), original);
});
