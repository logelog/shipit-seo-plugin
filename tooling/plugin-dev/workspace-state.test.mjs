import assert from "node:assert/strict";
import { test } from "node:test";
import { verificationState } from "./workspace-state.mjs";

function fixture() {
  const config = {
    profile: "native-1.1.0", dependencyRoot: "candidate",
    host: { target: "native-1.1.0", format: "native", runner: "node", storage: "sqlite" },
    tasks: { verify: [{ label: "toolkit" }, { label: "host" }] },
  };
  const versions = { node: "24.19.0", pnpm: "11.19.0" };
  const packages = { emdash: "1.1.0", "@emdash-cms/admin": "1.1.0", astro: "7.3.2" };
  const report = {
    profile: config.profile, dependencyRoot: config.dependencyRoot, host: { ...config.host },
    task: "verify", status: "passed", sourceHash: "a".repeat(64), sourceChanged: false,
    startedAt: "2026-10-03T10:00:00.000Z", finishedAt: "2026-10-03T10:00:01.000Z",
    versions: { ...versions }, packages: { ...packages },
    checks: [
      { label: "toolkit", status: "passed", exitCode: 0, durationMs: 100 },
      { label: "host", status: "passed", exitCode: 0, durationMs: 900 },
    ],
  };
  return { config, versions, packages, report, state: () => verificationState(report, config, versions, packages) };
}

test("doctor recognizes a completed matching full verification without changing its evidence", () => {
  const f = fixture();
  const original = structuredClone(f.report);
  assert.deepEqual(f.state(), { state: "current", reason: "COMPLETED_FOR_CURRENT_SOURCE" });
  assert.deepEqual(f.report, original);
});

test("doctor distinguishes missing evidence and non-verification tasks from full verification", () => {
  const f = fixture();
  assert.deepEqual(verificationState(null, f.config, f.versions, f.packages), {
    state: "missing", reason: "NO_COMPLETED_VERIFICATION",
  });
  for (const task of ["setup", "quick", "dev"]) {
    f.report.task = task;
    assert.deepEqual(f.state(), { state: "not-verified", reason: "NOT_FULL_VERIFICATION" });
  }
});

test("doctor refuses different targets, dependency roots and host adapters", () => {
  const cases = [
    report => { report.profile = "default"; },
    report => { report.dependencyRoot = "baseline"; },
    report => { report.host.target = "published-1.0.1"; },
    report => { report.host.format = "standard"; },
    report => { report.host.runner = "workerd"; },
    report => { report.host.storage = "d1"; },
  ];
  for (const change of cases) {
    const f = fixture(); change(f.report);
    assert.deepEqual(f.state(), { state: "not-verified", reason: "TARGET_MISMATCH" });
  }
});

test("doctor marks changed or unverified source fingerprints stale", () => {
  for (const change of [
    report => { report.sourceChanged = true; },
    report => { delete report.sourceChanged; },
    report => { delete report.sourceHash; },
    report => { report.sourceHash = "invalid"; },
  ]) {
    const f = fixture(); change(f.report);
    assert.deepEqual(f.state(), { state: "stale", reason: "SOURCE_CHANGED_OR_UNVERIFIED" });
  }
});

test("doctor refuses an unfinished run and invalid completion ordering", () => {
  for (const change of [
    report => { report.status = "running"; },
    report => { delete report.finishedAt; },
    report => { report.startedAt = "invalid"; },
    report => { report.finishedAt = "invalid"; },
    report => { report.finishedAt = "2026-10-03T09:59:59.000Z"; },
  ]) {
    const f = fixture(); change(f.report);
    assert.deepEqual(f.state(), { state: "incomplete", reason: "RUN_NOT_FINISHED" });
  }
});

test("doctor requires the full configured check set in its configured order", () => {
  for (const change of [
    report => { delete report.checks; },
    report => { report.checks.pop(); },
    report => { report.checks.reverse(); },
    report => { report.checks[1] = { ...report.checks[0] }; },
    report => { report.checks.push({ ...report.checks[0], label: "extra" }); },
  ]) {
    const f = fixture(); change(f.report);
    assert.deepEqual(f.state(), { state: "incomplete", reason: "CHECK_SET_INCOMPLETE" });
  }
});

test("doctor preserves failed full runs and rejects invalid finished checks", () => {
  const failed = fixture();
  failed.report.status = "failed";
  assert.deepEqual(failed.state(), { state: "failed", reason: "VERIFICATION_FAILED" });
  for (const change of [
    check => { check.status = "failed"; },
    check => { check.status = "timed_out"; check.exitCode = null; },
    check => { check.exitCode = 1; },
    check => { check.durationMs = -1; },
    check => { check.durationMs = Infinity; },
  ]) {
    const f = fixture(); change(f.report.checks[1]);
    assert.deepEqual(f.state(), { state: "failed", reason: "CHECK_FAILED_OR_INVALID" });
  }
});

test("doctor requires matching Node, pnpm and selected host versions", () => {
  for (const name of ["node", "pnpm"]) {
    const f = fixture(); f.report.versions[name] = "0.0.1";
    assert.deepEqual(f.state(), { state: "not-verified", reason: "TOOLCHAIN_MISMATCH" });
  }
  for (const name of ["emdash", "@emdash-cms/admin", "astro"]) {
    const f = fixture(); f.report.packages[name] = "0.0.1";
    assert.deepEqual(f.state(), { state: "not-verified", reason: "DEPENDENCY_MISMATCH" });
  }
  const missing = fixture();
  delete missing.report.versions;
  assert.equal(missing.state().reason, "TOOLCHAIN_MISMATCH");
  const dependencies = fixture();
  delete dependencies.report.packages;
  assert.equal(dependencies.state().reason, "DEPENDENCY_MISMATCH");
});

test("doctor state contains only fixed status and reason, never report diagnostics", () => {
  const f = fixture();
  const diagnostic = "/private/synthetic-diagnostic";
  f.report.output = diagnostic;
  f.report.error = diagnostic;
  f.report.checks[0].output = diagnostic;
  assert.deepEqual(f.state(), { state: "current", reason: "COMPLETED_FOR_CURRENT_SOURCE" });
  f.report.checks[0].label = diagnostic;
  const state = f.state();
  assert.deepEqual(Object.keys(state), ["state", "reason"]);
  assert.ok(!JSON.stringify(state).includes(diagnostic));
  assert.equal(state.state, "incomplete");
});
