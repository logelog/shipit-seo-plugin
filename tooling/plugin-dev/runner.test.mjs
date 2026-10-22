import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { getEventListeners } from "node:events";
import { mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { runCommand } from "./runner.mjs";

const supported = process.platform === "darwin" || process.platform === "linux";
const executable = process.execPath;

async function directory(t) {
  const path = await realpath(await mkdtemp(join(tmpdir(), "plugin-runner-")));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function nodeCheck(reportDir, label, source, options = {}) {
  return runCommand({ label, command: executable, args: ["-e", source], reportDir, ...options });
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail("Timed out waiting for the test process");
}

function exists(path) {
  return stat(path).then(() => true, () => false);
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

test("rejects traversal labels before creating any artifacts", async (t) => {
  const reportDir = await directory(t);
  await assert.rejects(nodeCheck(reportDir, "../escape", ""), TypeError);
  assert.deepEqual(await readdir(reportDir), []);
});

test("reports actionable unsupported platforms without spawning", { skip: supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await nodeCheck(reportDir, "unsupported", "throw new Error('must not run')");
  assert.equal(result.status, "failed");
  assert.equal(result.runnerError, "UNSUPPORTED_PLATFORM");
  assert.equal(result.exitCode, null);
});

test("returns success, honors cwd/env, and keeps invocation details out of reports", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const secret = "private-runner-test-argument";
  const controller = new AbortController();
  const source = `if (process.env.CHECK_SECRET !== ${JSON.stringify(secret)} || process.cwd() !== ${JSON.stringify(reportDir)} || process.env.NODE_OPTIONS !== '--max-old-space-size=2048') process.exit(9); process.stdout.write('passed output');`;
  const result = await nodeCheck(reportDir, "success", source, { cwd: reportDir, env: { CHECK_SECRET: secret, NODE_OPTIONS: undefined }, signal: controller.signal });
  assert.equal(result.status, "passed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdoutBytes, Buffer.byteLength("passed output"));
  assert.equal(await readFile(join(reportDir, "success.log"), "utf8"), "passed output");
  const report = await readFile(join(reportDir, "success.json"), "utf8");
  assert.deepEqual(JSON.parse(report), result);
  assert.ok(!report.includes(secret));
  assert.ok(!report.includes(source));
  assert.ok(!report.includes(reportDir));
  assert.deepEqual((await readdir(reportDir)).sort(), ["success.json", "success.log"]);
  assert.equal((await stat(join(reportDir, "success.json"))).mode & 0o777, 0o600);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("preserves an explicit Node memory setting", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await nodeCheck(reportDir, "memory", "if (process.env.NODE_OPTIONS !== '--max-old-space-size=256') process.exit(9)", { env: { NODE_OPTIONS: "--max-old-space-size=256" } });
  assert.equal(result.status, "passed");
});

test("passes shell metacharacters as literal arguments", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const argument = "literal; $(printf expanded) `printf expanded` $HOME";
  const result = await runCommand({
    label: "literal", command: executable,
    args: ["-e", "process.stdout.write(process.argv[1])", argument], reportDir,
  });
  assert.equal(result.status, "passed");
  assert.equal(await readFile(join(reportDir, "literal.log"), "utf8"), argument);
});

test("returns nonzero exits and captures both output streams", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await nodeCheck(reportDir, "failure", "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 7");
  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdoutBytes, 3);
  assert.equal(result.stderrBytes, 3);
  const log = await readFile(join(reportDir, "failure.log"), "utf8");
  assert.ok(log.includes("out") && log.includes("err"));
});

test("records missing binaries without throwing or disclosing their name", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const command = join(reportDir, "private-missing-executable");
  const result = await runCommand({ label: "missing", command, reportDir });
  assert.equal(result.status, "failed");
  assert.equal(result.spawnError, "ENOENT");
  assert.equal(result.exitCode, -2);
  assert.ok(!(await readFile(join(reportDir, "missing.json"), "utf8")).includes(command));
});

test("caps combined retained output and keeps a valid UTF-8 tail", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await nodeCheck(reportDir, "output", "process.stdout.write('OLD' + '€'.repeat(40000), () => process.stderr.write('😀'.repeat(30000) + 'END'))");
  assert.equal(result.status, "passed");
  assert.equal(result.totalBytes, 240_006);
  const log = await readFile(join(reportDir, "output.log"));
  assert.equal(result.retainedBytes, log.length);
  assert.ok(log.length <= 65_536 && log.length >= 65_532);
  assert.ok(result.truncated);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(log);
  assert.ok(decoded.endsWith("END"));
  assert.ok(!decoded.includes("OLD"));
});

test("replaces both previous results for the same label", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  await nodeCheck(reportDir, "replace", "process.stdout.write('old'); process.exitCode = 4");
  const latest = await nodeCheck(reportDir, "replace", "process.stdout.write('new')");
  assert.equal(await readFile(join(reportDir, "replace.log"), "utf8"), "new");
  assert.deepEqual(JSON.parse(await readFile(join(reportDir, "replace.json"), "utf8")), latest);
  assert.deepEqual((await readdir(reportDir)).sort(), ["replace.json", "replace.log"]);
});

for (const when of ["before invocation", "during report directory setup"]) {
  test(`does not spawn when cancelled ${when}`, { skip: !supported }, async (t) => {
    const reportDir = await directory(t);
    const marker = join(reportDir, "must-not-exist");
    const controller = new AbortController();
    const reason = "private-cancellation-reason";
    if (when === "before invocation") controller.abort(reason);
    const pending = nodeCheck(reportDir, "cancelled", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`, { signal: controller.signal });
    if (when === "during report directory setup") controller.abort(reason);
    const result = await pending;
    assert.equal(result.status, "signaled");
    assert.equal(result.interruptedBy, "ABORTED");
    assert.equal(result.exitCode, null);
    assert.equal(result.spawnError, null);
    assert.equal(await exists(marker), false);
    assert.ok(!(await readFile(join(reportDir, "cancelled.json"), "utf8")).includes(reason));
  });
}

test("times out a running command and removes its signal handlers", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const handlers = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const result = await nodeCheck(reportDir, "timeout", "setInterval(() => {}, 100)", { timeoutMs: 150 });
  assert.equal(result.status, "timed_out");
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
  assert.ok(result.durationMs < 3_000);
  assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], handlers);
});

for (const reason of ["main exit", "timeout", "cancellation"]) {
  test(`terminates a TERM-resistant descendant after ${reason}`, { skip: !supported }, async (t) => {
    const reportDir = await directory(t);
    const pidFile = join(reportDir, "grandchild.pid");
    let pid;
    const controller = new AbortController();
    t.after(() => { if (pid && alive(pid)) process.kill(pid, "SIGKILL"); });
    const grandchild = "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 100);";
    const source = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); child.on('message', () => { writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); ${reason === "main exit" ? "process.exit(0)" : "setInterval(() => {}, 100)"}; });`;
    const pending = nodeCheck(reportDir, "descendant", source, { timeoutMs: reason === "timeout" ? 500 : 5_000, signal: controller.signal });
    if (reason === "cancellation") {
      await waitFor(() => exists(pidFile));
      controller.abort();
    }
    const result = await pending;
    pid = Number(await readFile(pidFile, "utf8"));
    await waitFor(() => !alive(pid));
    assert.equal(result.status, reason === "timeout" ? "timed_out" : reason === "cancellation" ? "signaled" : "passed");
    if (reason === "cancellation") assert.equal(result.interruptedBy, "ABORTED");
    assert.equal(result.cleanupError, null);
  });
}

test("forwards interruption to the group and returns a signaled summary to its caller", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const ready = join(reportDir, "ready");
  const summaryPath = join(reportDir, "returned.json");
  const commandSource = `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 100);`;
  const harnessSource = `import { runCommand } from ${JSON.stringify(new URL("./runner.mjs", import.meta.url).href)}; import { writeFile } from 'node:fs/promises'; const result = await runCommand(${JSON.stringify({ label: "interrupted", command: executable, args: ["-e", commandSource], reportDir, timeoutMs: 5_000 })}); await writeFile(${JSON.stringify(summaryPath)}, JSON.stringify(result));`;
  const harness = spawn(executable, ["--input-type=module", "-e", harnessSource], { stdio: "ignore" });
  const ended = new Promise((resolve, reject) => { harness.on("error", reject); harness.on("close", (code, signal) => resolve({ code, signal })); });
  let childPid;
  t.after(async () => {
    if (childPid && alive(childPid)) process.kill(-childPid, "SIGKILL");
    if (harness.exitCode === null && harness.signalCode === null) harness.kill("SIGKILL");
    await ended;
  });
  await waitFor(() => exists(ready));
  childPid = Number(await readFile(ready, "utf8"));
  harness.kill("SIGTERM");
  assert.deepEqual(await ended, { code: 0, signal: null });
  const result = JSON.parse(await readFile(summaryPath, "utf8"));
  assert.equal(result.status, "signaled");
  assert.equal(result.interruptedBy, "SIGTERM");
  assert.ok(!alive(childPid));
});

test("records the leader PID as its process-group ID, and neither when nothing was spawned", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await nodeCheck(reportDir, "identity", "process.stdout.write(String(process.pid))");
  assert.equal(result.status, "passed");
  assert.equal(result.pid, Number(await readFile(join(reportDir, "identity.log"), "utf8")));
  assert.equal(result.pgid, result.pid);
  const missing = await runCommand({ label: "missing-identity", command: "/nonexistent/plugin-runner-binary", reportDir });
  assert.equal(missing.pid, null);
  assert.equal(missing.pgid, null);
});

const lateSurvivor = "process.on('SIGTERM', () => {}); const fs = require('node:fs'); const parent = process.ppid; const timer = setInterval(() => { if (process.ppid !== parent) { clearInterval(timer); setTimeout(() => fs.writeFileSync(MARKER, String(process.pid)), 200); } }, 10); setInterval(() => {}, 100);";

test("a stop after the leader exited still cleans up but is not recorded as a requested stop", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const exited = join(reportDir, "leader-exited");
  const controller = new AbortController();
  const survivor = lateSurvivor.replace("MARKER", JSON.stringify(exited));
  const source = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(survivor)}], { stdio: 'ignore' }); setTimeout(() => process.exit(0), 300);`;
  const pending = nodeCheck(reportDir, "late-stop", source, { timeoutMs: 10_000, signal: controller.signal });
  await waitFor(() => exists(exited));
  const child = Number(await readFile(exited, "utf8"));
  t.after(() => { if (alive(child)) process.kill(child, "SIGKILL"); });
  controller.abort();
  const result = await pending;
  assert.equal(result.exitCode, 0);
  assert.equal(result.interruptedBy, "ABORTED", "the late stop still reaches cleanup");
  assert.equal(result.stopRequestedBeforeExit, false);
  assert.equal(result.status, "passed");
  assert.equal(result.cleanupError, null);
  await waitFor(() => !alive(child));
});

/** Delivers termination signals as succeeded, refuses chosen calls with EPERM, delegates the rest. */
async function withGroupSignals(t, refuse, run) {
  const original = process.kill;
  const calls = [];
  process.kill = (pid, signal) => {
    if (pid < 0) {
      calls.push(String(signal));
      if (refuse(signal, calls)) throw Object.assign(new Error("simulated refusal"), { code: "EPERM" });
      if (signal !== 0) return true;
    }
    return original.call(process, pid, signal);
  };
  try { return await run(); } finally { process.kill = original; }
}

const probeRefusedTwice = (signal, calls) => signal === 0 && calls.filter((call) => call === "0").length <= 2;

test("macOS signal-0 EPERM after a delivered stop, with every member exiting, waits for a positive absent result", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await withGroupSignals(t, probeRefusedTwice, () =>
    nodeCheck(reportDir, "exiting-member", "process.exit(0)", { groupStates: () => ["?Es"], platform: "darwin" }));
  assert.equal(result.status, "passed");
  assert.equal(result.cleanupError, null);
  assert.equal(result.groupAbsentConfirmed, true);
  assert.equal(result.groupSignalErrorCount, 2);
  assert.ok(result.groupSignalErrors.every((entry) => entry.signal === "0" && entry.code === "EPERM" && entry.kind === "transient-exiting-probe" && entry.memberStates[0] === "?Es"));
});

for (const [name, options] of [
  ["on another platform", { groupStates: () => ["?Es"], platform: "linux" }],
  ["with unreadable member states", { groupStates: () => null, platform: "darwin" }],
  ["with a live member", { groupStates: () => ["S"], platform: "darwin" }],
  ["with no listed member", { groupStates: () => [], platform: "darwin" }],
]) {
  test(`signal-0 EPERM ${name} is a cleanup failure`, { skip: !supported }, async (t) => {
    const reportDir = await directory(t);
    const result = await withGroupSignals(t, probeRefusedTwice, () => nodeCheck(reportDir, "probe-failure", "process.exit(0)", options));
    assert.equal(result.status, "failed");
    assert.equal(result.cleanupError, "EPERM");
    assert.ok(result.groupSignalErrors.length > 0 && result.groupSignalErrors.every((entry) => entry.kind === "cleanup-failure"));
  });
}

test("EPERM from the actual termination signal fails cleanup even when members look exiting", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await withGroupSignals(t, (signal) => signal === "SIGTERM", () =>
    nodeCheck(reportDir, "term-refused", "process.exit(0)", { groupStates: () => ["?Es"], platform: "darwin" }));
  assert.equal(result.status, "failed");
  assert.equal(result.cleanupError, "EPERM");
  assert.equal(result.groupSignalErrors[0].signal, "SIGTERM");
  assert.equal(result.groupSignalErrors[0].kind, "cleanup-failure");
});

test("an exiting-member probe that never reaches a positive absent result fails after the grace period", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await withGroupSignals(t, (signal) => signal === 0, () =>
    nodeCheck(reportDir, "never-absent", "process.exit(0)", { groupStates: () => ["?Es"], platform: "darwin" }));
  assert.equal(result.status, "failed");
  assert.equal(result.cleanupError, "EPERM");
  assert.equal(result.groupAbsentConfirmed, false);
  assert.ok(result.groupSignalErrorCount > 2);
  assert.ok(result.groupSignalErrors.every((entry) => entry.kind === "transient-exiting-probe"));
});

test("EPERM with a live member during a timeout fails the cleanup", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await withGroupSignals(t, () => true, () =>
    nodeCheck(reportDir, "live-member", "setInterval(() => {}, 100)", { timeoutMs: 200, groupStates: () => ["S"], platform: "darwin" }));
  t.after(() => { try { process.kill(-result.pgid, "SIGKILL"); } catch {} });
  assert.equal(result.status, "failed");
  assert.equal(result.cleanupError, "EPERM");
  process.kill(-result.pgid, "SIGKILL");
  await waitFor(() => !alive(result.pid));
});

test("a real refused signal after more than eight transient probes stays recorded and fails cleanup", { skip: !supported }, async (t) => {
  const reportDir = await directory(t);
  const result = await withGroupSignals(t, (signal) => signal === 0 || signal === "SIGKILL", () =>
    nodeCheck(reportDir, "late-refusal", "process.exit(0)", { groupStates: () => ["?Es"], platform: "darwin" }));
  assert.equal(result.status, "failed");
  assert.equal(result.cleanupError, "EPERM");
  assert.equal(result.groupSignalErrors.length, 8);
  assert.ok(result.groupSignalErrors.every((entry) => entry.kind === "transient-exiting-probe"));
  assert.ok(result.groupSignalErrorCount > 9);
  assert.equal(result.latestCleanupFailure.signal, "SIGKILL");
  assert.equal(result.latestCleanupFailure.kind, "cleanup-failure");
  assert.ok(result.latestCleanupFailure.elapsedMs >= 900);
  assert.equal(result.groupAbsentConfirmed, false);
});
