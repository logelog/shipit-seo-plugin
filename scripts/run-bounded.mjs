import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [label, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(process.env.RUN_BOUNDED_TIMEOUT_MS ?? 900_000);
if (
  !label ||
  !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(label) ||
  !command ||
  !Number.isSafeInteger(timeoutMs) ||
  timeoutMs < 1 ||
  timeoutMs > 2_147_483_647
) {
  console.error(
    "Usage: node scripts/run-bounded.mjs LABEL COMMAND ...ARGS\n" +
      "LABEL: 1-80 letters, digits, dots, underscores or hyphens; start with a letter or digit.\n" +
      "RUN_BOUNDED_TIMEOUT_MS: positive integer, default 900000.",
  );
  process.exit(2);
}

const directory = new URL("../artifacts/current-validation/", import.meta.url);
mkdirSync(directory, { recursive: true });
const startedAt = new Date().toISOString();
const started = performance.now();
const tail = Buffer.alloc(64 * 1024);
let cursor = 0;
let retainedBytes = 0;
let stdoutBytes = 0;
let stderrBytes = 0;
let timedOut = false;
let interruptedBy = null;
let spawnError = null;
let cleanupTimer;
let cleanupStarted;
let closed = false;
let finished = false;
let exitCode = null;
let exitSignal = null;

function capture(chunk, stream) {
  if (stream === "stdout") stdoutBytes += chunk.length;
  else stderrBytes += chunk.length;
  if (chunk.length >= tail.length) {
    chunk.copy(tail, 0, chunk.length - tail.length);
    cursor = 0;
    retainedBytes = tail.length;
    return;
  }
  const first = Math.min(chunk.length, tail.length - cursor);
  chunk.copy(tail, cursor, 0, first);
  chunk.copy(tail, 0, first);
  cursor = (cursor + chunk.length) % tail.length;
  retainedBytes = Math.min(tail.length, retainedBytes + chunk.length);
}

const child = spawn(command, args, {
  detached: true,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=2048",
  },
});

function signalGroup(signal) {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function cleanup(signal = "SIGTERM") {
  if (!signalGroup(signal)) {
    finish();
    return;
  }
  if (cleanupStarted !== undefined) return;
  cleanupStarted = performance.now();
  // Descendants may close their pipes before exiting or ignore the first signal.
  cleanupTimer = setInterval(() => {
    if (signalGroup(0)) {
      if (performance.now() - cleanupStarted < 5_000) return;
      signalGroup("SIGKILL");
    }
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
    finish();
  }, 100);
}

const timeout = setTimeout(() => {
  timedOut = true;
  cleanup();
}, timeoutMs);
const heartbeat = setInterval(() => {
  console.log(
    `[${label}] running ${Math.round((performance.now() - started) / 1000)}s; ` +
      `${stdoutBytes + stderrBytes} output bytes; retaining at most ${tail.length}.`,
  );
}, 30_000);

const onSignal = (signal) => {
  interruptedBy ??= signal;
  cleanup(signal);
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
child.stdout.on("data", (chunk) => capture(chunk, "stdout"));
child.stderr.on("data", (chunk) => capture(chunk, "stderr"));
child.on("error", (error) => {
  spawnError = error.code ?? "SPAWN_ERROR";
});
child.on("exit", () => cleanup());
child.on("close", (code, signal) => {
  closed = true;
  exitCode = code;
  exitSignal = signal;
  finish();
});

function finish() {
  if (finished || !closed || cleanupTimer !== undefined) return;
  finished = true;
  clearTimeout(timeout);
  clearInterval(heartbeat);
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  const output = Buffer.concat([
    tail.subarray(retainedBytes === tail.length ? cursor : 0, retainedBytes),
    tail.subarray(0, retainedBytes === tail.length ? cursor : 0),
  ]);
  const status = timedOut
    ? "timed_out"
    : interruptedBy || exitSignal
      ? "signaled"
      : exitCode === 0 && !spawnError
        ? "passed"
        : "failed";
  const summary = {
    label,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    timeoutMs,
    timedOut,
    exitCode,
    signal: exitSignal,
    interruptedBy,
    spawnError,
    stdoutBytes,
    stderrBytes,
    totalBytes: stdoutBytes + stderrBytes,
    retainedBytes,
    truncated: stdoutBytes + stderrBytes > retainedBytes,
  };
  writeFileSync(new URL(`${label}.log`, directory), output, { mode: 0o600 });
  writeFileSync(
    new URL(`${label}.json`, directory),
    JSON.stringify(summary, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    `[${label}] ${status} in ${(summary.durationMs / 1000).toFixed(1)}s; ` +
      `exit=${exitCode ?? "none"} signal=${exitSignal ?? "none"}; ` +
      `${summary.totalBytes} output bytes, ${retainedBytes} retained. ` +
      `Results: artifacts/current-validation/${label}.{json,log}`,
  );
  if (status !== "passed" && output.length) {
    process.stderr.write(output.subarray(-6 * 1024));
    process.stderr.write("\n");
  }
  if (timedOut) process.exitCode = 124;
  else if (interruptedBy || exitSignal)
    process.kill(process.pid, interruptedBy ?? exitSignal);
  else process.exitCode = spawnError ? (spawnError === "ENOENT" ? 127 : 126) : exitCode;
}
