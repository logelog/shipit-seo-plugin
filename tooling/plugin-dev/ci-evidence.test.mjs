import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectCiEvidence, main, recordPackedVerification } from "./ci-evidence.mjs";
import { ensureReports, readConfig, reportLabel, sourceFingerprint, writeReportJson } from "./cli.mjs";
import { readCheckoutState } from "./workspace-state.mjs";

const startedAt = "2026-10-03T10:00:00.000Z";
const finishedAt = "2026-10-03T10:00:01.000Z";
const verificationId = "12345678-1234-4234-8234-123456789abc";
const otherId = "abcdef12-1234-4234-9234-123456789abc";
const tarball = { file: "shipit-emdash-plugin-seo-0.1.0.tgz", bytes: 4123, sha256: "a".repeat(64) };

function git(root, args) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024,
  });
  assert.equal(result.status, 0, "The temporary Git fixture command must succeed");
  return result.stdout.trim();
}

function fixture(t, target = "native-1.3.0", { untracked = {}, ignored = [] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "plugin-dev-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  };
  const tasks = { verify: [
    { label: "toolkit", command: "node", args: ["--version"] },
    { label: "host", command: "node", args: ["--version"] },
  ] };
  const host = version => ({ target: "native-" + version, format: "native", runner: "node", storage: "sqlite" });
  const packages = version => ({ emdash: version, "@emdash-cms/admin": version, astro: "7.3.2" });
  write("plugin-dev.json", JSON.stringify({
    schemaVersion: 1, name: "Fixture", dependencyRoot: "baseline", host: host("1.3.0"),
    expectedPackages: packages("1.3.0"), sourceDirectories: ["src"], tasks,
    targets: {
      "native-1.3.0": { dependencyRoot: "candidate-1.3.0", host: host("1.3.0"), expectedPackages: packages("1.3.0") },
    },
  }));
  write("package.json", JSON.stringify({ private: true, packageManager: "pnpm@11.19.0" }));
  write(".nvmrc", `${process.versions.node}\n`);
  write(".node-version", `${process.versions.node}\n`);
  write(".gitignore", ["artifacts/", ...ignored].join("\n") + "\n");
  write("src/entry.mjs", "export const value = 1;\n");
  write("notes.md", "Tracked documentation outside the source fingerprint.\n");
  write("baseline/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write("candidate-1.3.0/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "user.email", "fixture@example.test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "Create fixture"]);
  const context = { sha: git(root, ["rev-parse", "HEAD"]), runId: "123456", runAttempt: "1", setupOutcome: "success", verifyOutcome: "success" };
  for (const [name, content] of Object.entries(untracked)) write(name, content);
  const config = readConfig(root, target === "default" ? undefined : target);
  const report = {
    schemaVersion: 1, profile: config.profile, dependencyRoot: config.dependencyRoot,
    host: config.host, ports: [], task: "verify", status: "running", verificationId, startedAt,
    sourceHash: sourceFingerprint(root, config), versions: { node: process.versions.node, pnpm: "11.19.0" },
    packages: config.expectedPackages, checks: [{ label: "toolkit", status: "passed", exitCode: 0, durationMs: 10 }],
  };
  const save = () => {
    const name = `${reportLabel(config, "run")}.json`;
    const directory = ensureReports(root, [name]);
    writeReportJson(path.join(directory, name), report);
  };
  const env = () => ({
    SHIPIT_VERIFY_ID: report.verificationId, SHIPIT_VERIFY_STARTED_AT: report.startedAt,
    SHIPIT_VERIFY_SOURCE_HASH: report.sourceHash, SHIPIT_VERIFY_TARGET: target,
    GITHUB_SHA: context.sha, GITHUB_RUN_ID: context.runId, GITHUB_RUN_ATTEMPT: context.runAttempt,
  });
  const finish = () => {
    assert.ok(recordPackedVerification(root, target, tarball, env()));
    report.status = "passed";
    report.finishedAt = finishedAt;
    report.sourceChanged = false;
    report.notRun = [];
    report.checks.push({ label: "host", status: "passed", exitCode: 0, durationMs: 20 });
    save();
  };
  const collect = (overrides = {}) => collectCiEvidence(root, target, { ...context, ...overrides });
  save();
  return { root, target, config, context, report, write, save, env, finish, collect };
}

test("each target exports a passed receipt only for its completed full run and tested package", async t => {
  for (const target of ["default", "native-1.3.0"]) await t.test(target, t => {
    const f = fixture(t, target);
    f.finish();
    const evidence = f.collect();
    assert.equal(evidence.status, "passed");
    assert.deepEqual(evidence.reasons, []);
    assert.equal(evidence.target, target);
    assert.equal(evidence.commit, f.context.sha);
    assert.deepEqual(evidence.package, tarball);
    assert.deepEqual(evidence.versions, f.report.versions);
    assert.deepEqual(evidence.packages, f.report.packages);
    assert.equal(evidence.source.changed, false);
    assert.equal(main(["--target", target], f.root, f.context), 0);
    const saved = JSON.parse(readFileSync(path.join(f.root, "artifacts/plugin-dev", `${target}-ci-evidence.json`), "utf8"));
    assert.deepEqual(saved, evidence);
    assert.ok(Buffer.byteLength(JSON.stringify(saved)) < 64 * 1024);
  });
});

test("a run with a check that did not run never becomes a passing receipt", async t => {
  for (const notRun of [[{ check: "npm-packed-plugin", reason: "no offline npm cache" }], undefined]) await t.test(String(notRun?.length ?? "missing"), t => {
    const f = fixture(t, "native-1.3.0");
    f.finish();
    assert.equal(f.collect().status, "passed", "control: the same run passes with nothing left unrun");
    if (notRun) f.report.notRun = notRun; else delete f.report.notRun;
    f.save();
    const evidence = f.collect();
    assert.notEqual(evidence.status, "passed");
    assert.ok(evidence.reasons.includes("checks-not-run"), JSON.stringify(evidence.reasons));
  });
});

test("standalone or mismatched active invocations cannot record package verification", async t => {
  const changes = [
    ["standalone", () => ({})],
    ["different run", env => ({ ...env, SHIPIT_VERIFY_ID: otherId })],
    ["different start", env => ({ ...env, SHIPIT_VERIFY_STARTED_AT: finishedAt })],
    ["different fingerprint", env => ({ ...env, SHIPIT_VERIFY_SOURCE_HASH: "b".repeat(64) })],
    ["different target", env => ({ ...env, SHIPIT_VERIFY_TARGET: "default" })],
  ];
  for (const [name, change] of changes) await t.test(name, t => {
    const f = fixture(t);
    assert.equal(recordPackedVerification(f.root, f.target, tarball, change(f.env())), null);
    assert.equal(existsSync(path.join(f.root, "artifacts/plugin-dev/native-1.3.0-packed-verification.json")), false);
  });
});

test("quick, finished and source-changed runs cannot produce a package receipt", async t => {
  for (const mode of ["quick", "finished", "changed", "recorded change"]) await t.test(mode, t => {
    const f = fixture(t);
    if (mode === "quick") f.report.task = "quick";
    if (mode === "finished") { f.report.status = "passed"; f.report.finishedAt = finishedAt; }
    if (mode === "changed") f.write("src/entry.mjs", "export const value = 2;\n");
    if (mode === "recorded change") f.report.sourceChanged = true;
    f.save();
    assert.equal(recordPackedVerification(f.root, f.target, tarball, f.env()), null);
  });
});

test("package metadata rejects paths, nonpositive bytes and malformed checksums", async t => {
  for (const [name, changes] of [
    ["absolute file", { file: "/private/output.tgz" }], ["relative path", { file: "../output.tgz" }],
    ["zero bytes", { bytes: 0 }], ["negative bytes", { bytes: -1 }], ["checksum", { sha256: "private value" }],
  ]) await t.test(name, t => {
    const f = fixture(t);
    assert.throws(() => recordPackedVerification(f.root, f.target, { ...tarball, ...changes }, f.env()), /^Error: Invalid packed artifact evidence\.$/);
  });
});

test("incomplete or incompatible run evidence never becomes a passing receipt", async t => {
  const cases = [
    ["quick", report => { report.task = "quick"; }],
    ["running", report => { report.status = "running"; delete report.finishedAt; }],
    ["unfinished", report => { delete report.finishedAt; }],
    ["bad timestamp", report => { report.finishedAt = "not a date"; }],
    ["partial", report => { report.checks.pop(); }],
    ["out of order", report => { report.checks.reverse(); }],
    ["duplicate", report => { report.checks[1] = { ...report.checks[0] }; }],
    ["failed check", report => { report.checks[1].status = "failed"; report.checks[1].exitCode = 1; }],
    ["wrong exit", report => { report.checks[1].exitCode = 1; }],
    ["duration", report => { report.checks[1].durationMs = -1; }],
    ["different target", report => { report.profile = "default"; }],
    ["changed during run", report => { report.sourceChanged = true; }],
    ["missing change state", report => { delete report.sourceChanged; }],
    ["wrong node", report => { report.versions.node = "1.2.3"; }],
    ["wrong pnpm", report => { report.versions.pnpm = "1.2.3"; }],
    ["wrong host", report => { report.packages.emdash = "1.2.3"; }],
  ];
  for (const [name, change] of cases) await t.test(name, t => {
    const f = fixture(t);
    f.finish(); change(f.report); f.save();
    assert.notEqual(f.collect().status, "passed");
  });
});

test("current source changes and tracked changes outside the fingerprint both prevent passing", async t => {
  for (const file of ["src/entry.mjs", "notes.md"]) await t.test(file, t => {
    const f = fixture(t);
    f.finish(); f.write(file, "Changed tracked input.\n");
    const evidence = f.collect();
    assert.equal(evidence.checkout, "dirty");
    assert.notEqual(evidence.status, "passed");
    assert.equal(evidence.source.changed, file === "src/entry.mjs");
  });
});

test("matching run fingerprints cannot certify untracked source as the checked-out commit", async t => {
  const cases = [
    { name: "untracked source", file: "src/untracked-entry.mjs", rejected: true },
    { name: "ignored source", file: "src/ignored-entry.mjs", ignored: ["src/ignored-entry.mjs"], rejected: true },
    { name: "unrelated notes", file: "untracked-notes.md", rejected: false },
    { name: "excluded generated output", file: "src/dist/generated.mjs", ignored: ["dist/"], rejected: false },
  ];
  for (const target of ["default", "native-1.3.0"]) {
    for (const item of cases) await t.test(`${target}: ${item.name}`, t => {
      const f = fixture(t, target, { untracked: { [item.file]: "export const fixture = true;\n" }, ignored: item.ignored });
      f.finish();
      const checkout = readCheckoutState(f.root, f.config);
      assert.equal(checkout.commit, f.context.sha);
      assert.equal(checkout.trackedDirty, false);
      assert.equal(checkout.untrackedSource, item.rejected);
      const evidence = f.collect();
      assert.equal(evidence.source.changed, false);
      assert.deepEqual(evidence.package, tarball);
      assert.equal(evidence.status, item.rejected ? "not-verified" : "passed");
      assert.equal(evidence.checkout, item.rejected ? "dirty" : "clean");
      assert.deepEqual(evidence.reasons, item.rejected ? ["checkout-not-clean"] : []);
    });
  }
});

test("a package from another verification run, CI run or attempt is not promoted", async t => {
  for (const field of ["verificationId", "startedAt", "runId", "runAttempt", "sha"]) await t.test(field, t => {
    const f = fixture(t);
    f.finish();
    if (field === "verificationId") { f.report.verificationId = otherId; f.save(); }
    if (field === "startedAt") { f.report.startedAt = "2026-10-03T10:00:00.001Z"; f.save(); }
    const overrides = field === "runId" ? { runId: "987654" } : field === "runAttempt" ? { runAttempt: "2" } : field === "sha" ? { sha: "b".repeat(40) } : {};
    const evidence = f.collect(overrides);
    assert.notEqual(evidence.status, "passed");
    assert.equal(evidence.package, null);
  });
});

test("failed or missing runs still produce compact nonpassing output", async t => {
  for (const mode of ["missing", "failed", "setup failed", "skipped", "invalid context", "oversized"]) await t.test(mode, t => {
    const f = fixture(t);
    f.finish();
    const runFile = path.join(f.root, "artifacts/plugin-dev", `${reportLabel(f.config, "run")}.json`);
    if (mode === "missing") rmSync(runFile);
    if (mode === "failed") { f.report.status = "failed"; f.save(); }
    if (mode === "oversized") writeFileSync(runFile, JSON.stringify({ output: "private".repeat(20_000) }));
    const overrides = mode === "setup failed" ? { setupOutcome: "failure", verifyOutcome: "skipped" }
      : mode === "skipped" ? { verifyOutcome: "skipped" } : mode === "invalid context" ? { sha: "private", runId: "private", runAttempt: "private" } : {};
    const context = { ...f.context, ...overrides };
    assert.equal(main(["--target", f.target], f.root, context), 1);
    const evidence = JSON.parse(readFileSync(path.join(f.root, "artifacts/plugin-dev/native-1.3.0-ci-evidence.json"), "utf8"));
    assert.notEqual(evidence.status, "passed");
    assert.equal(evidence.status, ["failed", "setup failed"].includes(mode) ? "failed" : "not-verified");
    assert.ok(!JSON.stringify(evidence).includes("private"));
  });
});

test("exported evidence drops raw output, paths, environment, content and unknown keys", t => {
  const f = fixture(t);
  const secret = "/private/synthetic-do-not-export";
  const receipt = recordPackedVerification(f.root, f.target, { ...tarball, path: secret, output: secret }, f.env());
  assert.deepEqual(receipt.tarball, tarball);
  f.finish();
  f.report.output = secret;
  f.report.env = { TOKEN: secret };
  f.report.error = secret;
  f.report.content = secret;
  f.report.versions.extra = secret;
  f.report.packages.extra = secret;
  f.report.checks.forEach(check => { check.output = secret; check.logPath = secret; });
  f.save();
  const evidence = f.collect({ output: secret, error: secret });
  assert.equal(evidence.status, "passed");
  assert.deepEqual(Object.keys(evidence), ["schemaVersion", "target", "host", "commit", "github", "status", "reasons", "checkout", "versions", "packages", "source", "checks", "package"]);
  assert.deepEqual(Object.keys(evidence.checks[0]), ["label", "status", "exitCode", "durationMs"]);
  assert.deepEqual(Object.keys(evidence.github), ["sha", "runId", "runAttempt", "setupOutcome", "verifyOutcome"]);
  assert.ok(!JSON.stringify(evidence).includes(secret));
  f.report.checks[0].label = secret; f.save();
  assert.notEqual(f.collect().status, "passed");
  assert.ok(!JSON.stringify(f.collect()).includes(secret));
});

test("CLI arguments cannot choose an output path or an undeclared target", t => {
  const f = fixture(t);
  for (const args of [[], ["--target", "../escape"], ["--target", "native-1.3.0", "--output", "/private/file"], ["--target", "unknown"], ["--target", "native-9.9.9"]]) {
    assert.throws(() => main(args, f.root, f.context), /^Error: Invalid evidence arguments\.$/);
  }
});
