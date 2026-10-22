import { spawn, spawnSync } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

const OUTPUT_LIMIT = 64 * 1024;
const TERM_GRACE_MS = 1_000;
const KILL_GRACE_MS = 1_000;

function outputTail() {
  const buffer = Buffer.alloc(OUTPUT_LIMIT);
  let cursor = 0;
  let length = 0;
  let total = 0;
  return {
    append(text) {
      const chunk = Buffer.from(text, "utf8");
      total += chunk.length;
      if (chunk.length >= buffer.length) {
        chunk.copy(buffer, 0, chunk.length - buffer.length);
        cursor = 0;
        length = buffer.length;
        return;
      }
      const first = Math.min(chunk.length, buffer.length - cursor);
      chunk.copy(buffer, cursor, 0, first);
      chunk.copy(buffer, 0, first);
      cursor = (cursor + chunk.length) % buffer.length;
      length = Math.min(buffer.length, length + chunk.length);
    },
    read() {
      const result = Buffer.concat([
        buffer.subarray(length === buffer.length ? cursor : 0, length),
        buffer.subarray(0, length === buffer.length ? cursor : 0),
      ]);
      let start = 0;
      while (start < result.length && (result[start] & 0xc0) === 0x80) start++;
      const output = result.subarray(start);
      return { output, truncated: total > output.length };
    },
  };
}

/** Process states of a group's members, or null when they cannot be read. */
export function readGroupStates(pgid) {
  const result = spawnSync("ps", ["-A", "-o", "pgid=,stat="], { encoding: "utf8", timeout: 2_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  return result.stdout.split("\n").map((line) => line.trim().split(/\s+/)).filter((fields) => Number(fields[0]) === pgid).map((fields) => fields[1] ?? "");
}

async function writeReport(reportDir, label, extension, data) {
  const temporary = join(reportDir, `.${label}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    await rename(temporary, join(reportDir, `${label}.${extension}`));
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Run serially; descendants must remain in the spawned POSIX process group. */
export async function runCommand({ label, command, args = [], cwd, reportDir, timeoutMs = 900_000, env = {}, signal, groupStates = readGroupStates, platform = process.platform }) {
  if (typeof label !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(label)) {
    throw new TypeError("Check label must start with a letter or digit and contain at most 80 letters, digits, dots, underscores or hyphens");
  }
  if (typeof command !== "string" || !command || !Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("Command and arguments must be strings");
  }
  if (typeof reportDir !== "string" || !reportDir || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new TypeError("A report directory and a positive timeout of at most 2147483647 milliseconds are required");
  }
  if (!env || typeof env !== "object" || Array.isArray(env) || Object.values(env).some((value) => value !== undefined && typeof value !== "string")) {
    throw new TypeError("Environment overrides must be strings or undefined");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("Cancellation signal must be an AbortSignal");
  }
  if (typeof groupStates !== "function" || typeof platform !== "string") throw new TypeError("Group state reader and platform must be a function and a string");

  const started = performance.now();
  const summary = {
    label, status: "failed", startedAt: new Date().toISOString(), finishedAt: null,
    durationMs: 0, timeoutMs, timedOut: false, exitCode: null, signal: null,
    pid: null, pgid: null,
    interruptedBy: null, stopRequestedBeforeExit: false, spawnError: null, runnerError: null, cleanupError: null, groupSignalErrors: [], groupSignalErrorCount: 0, groupAbsentConfirmed: false, latestCleanupFailure: null,
    stdoutBytes: 0, stderrBytes: 0, totalBytes: 0, retainedBytes: 0, truncated: false,
  };
  const tail = outputTail();
  let writable = false;
  try {
    await mkdir(reportDir, { recursive: true });
    writable = true;
  } catch {
    summary.runnerError = "REPORT_DIRECTORY_UNAVAILABLE";
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    summary.runnerError = "UNSUPPORTED_PLATFORM";
    console.error(`[${label}] Run this check in WSL2, Linux or macOS; native Windows process-tree cleanup is unsupported.`);
  }

  if (signal?.aborted) {
    summary.interruptedBy = "ABORTED";
    summary.stopRequestedBeforeExit = true;
  }
  if (!summary.runnerError && !summary.interruptedBy) {
    const childEnv = { ...process.env, ...env };
    childEnv.NODE_OPTIONS ??= "--max-old-space-size=2048";
    let child;
    try {
      child = spawn(command, args, { cwd, env: childEnv, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      summary.spawnError = error.code ?? "SPAWN_ERROR";
    }
    // The detached leader's PID is also its process-group ID; a receipt names both for inspection.
    if (child?.pid) {
      summary.pid = child.pid;
      summary.pgid = child.pid;
    }
    if (child) await new Promise((resolve) => {
      const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
      let closed = false;
      let cleaned = false;
      let settled = false;
      let cleanupStarted;
      let cleanupTimer;
      let drainTimer;
      let killed = false;
      let leaderExited = false;
      let terminationDelivered = false;
      let unprovenProbeError = null;

      const timeout = setTimeout(() => {
        summary.timedOut = true;
        cleanup();
      }, timeoutMs);
      const heartbeat = setInterval(() => {
        console.log(`[${label}] running ${Math.round((performance.now() - started) / 1000)}s; ${summary.stdoutBytes + summary.stderrBytes} output bytes`);
      }, 30_000);

      function signalGroup(signal) {
        if (!child.pid) return false;
        try {
          process.kill(-child.pid, signal);
          if (signal !== 0) terminationDelivered = true;
          return true;
        } catch (error) {
          if (error.code === "ESRCH") {
            summary.groupAbsentConfirmed = true;
            return false;
          }
          const code = error.code ?? "PROCESS_GROUP_SIGNAL_FAILED";
          // XNU can refuse signal 0 to a group whose remaining members are all exiting.
          // Only that probe, after a delivered termination signal, with every listed
          // member exiting, is held as unproven until the group is reported absent.
          let states = null;
          let transient = false;
          if (code === "EPERM" && signal === 0 && terminationDelivered && platform === "darwin") {
            states = groupStates(child.pid);
            transient = Array.isArray(states) && states.length > 0 && states.every((state) => /[EZ]/.test(state));
          }
          const observation = { signal: String(signal), code, elapsedMs: Math.round(performance.now() - started), leaderExited,
            kind: transient ? "transient-exiting-probe" : "cleanup-failure", memberStates: Array.isArray(states) ? states.slice(0, 8) : null };
          if (transient) unprovenProbeError = code;
          else {
            summary.cleanupError = code;
            // Kept outside the bounded list so early probes cannot hide a later real refusal.
            summary.latestCleanupFailure = observation;
          }
          summary.groupSignalErrorCount += 1;
          if (summary.groupSignalErrors.length < 8) summary.groupSignalErrors.push(observation);
          return true;
        }
      }
      function finish() {
        if (settled || !closed || !cleaned) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(heartbeat);
        clearInterval(cleanupTimer);
        clearTimeout(drainTimer);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        signal?.removeEventListener("abort", onAbort);
        tail.append(decoders.stdout.end());
        tail.append(decoders.stderr.end());
        resolve();
      }
      function finishCleanup() {
        cleaned = true;
        clearInterval(cleanupTimer);
        if (!closed) {
          drainTimer = setTimeout(() => {
            summary.cleanupError ??= "PROCESS_PIPES_DID_NOT_CLOSE";
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            closed = true;
            finish();
          }, 500);
        }
        finish();
      }
      function cleanup(signal = "SIGTERM") {
        if (cleaned) return;
        if (cleanupStarted !== undefined) return;
        cleanupStarted = performance.now();
        if (!signalGroup(signal)) {
          finishCleanup();
          return;
        }
        cleanupTimer = setInterval(() => {
          if (!signalGroup(0)) return finishCleanup();
          const elapsed = performance.now() - cleanupStarted;
          if (!killed && elapsed >= TERM_GRACE_MS) {
            killed = true;
            signalGroup("SIGKILL");
          }
          if (elapsed >= TERM_GRACE_MS + KILL_GRACE_MS) {
            summary.cleanupError ??= unprovenProbeError ?? "PROCESS_GROUP_STILL_PRESENT";
            signalGroup("SIGKILL");
            finishCleanup();
          }
        }, 50);
      }
      // A stop after the leader has already exited still drives cleanup, but it does
      // not turn that exit into a requested stop.
      function onSignal(signal) {
        summary.interruptedBy ??= signal;
        if (!leaderExited) summary.stopRequestedBeforeExit = true;
        cleanup(signal);
      }
      function onAbort() {
        summary.interruptedBy ??= "ABORTED";
        if (!leaderExited) summary.stopRequestedBeforeExit = true;
        cleanup();
      }
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      signal?.addEventListener("abort", onAbort, { once: true });
      for (const stream of ["stdout", "stderr"]) {
        child[stream].on("data", (chunk) => {
          summary[`${stream}Bytes`] += chunk.length;
          tail.append(decoders[stream].write(chunk));
        });
      }
      child.on("error", (error) => { summary.spawnError = error.code ?? "SPAWN_ERROR"; });
      child.on("exit", (code, signal) => {
        leaderExited = true;
        summary.exitCode = code;
        summary.signal = signal;
        clearTimeout(timeout);
        cleanup();
      });
      child.on("close", (code, signal) => {
        summary.exitCode = code;
        summary.signal = signal;
        closed = true;
        cleanup();
        finish();
      });
    });
  }

  const { output, truncated } = tail.read();
  summary.status = summary.runnerError || summary.cleanupError || summary.spawnError ? "failed"
    : summary.timedOut ? "timed_out" : summary.stopRequestedBeforeExit || summary.signal ? "signaled"
      : summary.exitCode === 0 ? "passed" : "failed";
  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Math.round(performance.now() - started);
  summary.totalBytes = summary.stdoutBytes + summary.stderrBytes;
  summary.retainedBytes = output.length;
  summary.truncated = truncated;
  if (writable) {
    try {
      await writeReport(reportDir, label, "log", output);
      await writeReport(reportDir, label, "json", `${JSON.stringify(summary, null, 2)}\n`);
    } catch {
      summary.runnerError = "REPORT_WRITE_FAILED";
      summary.status = "failed";
    }
  }
  console.log(`[${label}] ${summary.status} in ${(summary.durationMs / 1000).toFixed(1)}s; exit=${summary.exitCode ?? "none"}; ${summary.totalBytes} output bytes, ${summary.retainedBytes} retained`);
  if (summary.status !== "passed" && output.length) {
    let start = Math.max(0, output.length - 6 * 1024);
    while (start < output.length && (output[start] & 0xc0) === 0x80) start++;
    process.stderr.write(output.subarray(start));
    process.stderr.write("\n");
  }
  return summary;
}
