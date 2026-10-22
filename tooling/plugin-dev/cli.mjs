import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./runner.mjs";
import { readCheckoutState, sourceFileInputs, verificationState } from "./workspace-state.mjs";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const reportPath = "artifacts/plugin-dev";
const safeLabel = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

export function repoPath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    throw new Error("Development paths must stay inside the repository.");
  }
  return path.resolve(root, relative);
}

export function readConfig(root, targetName) {
  const { targets = {}, ...base } = readJson(path.join(root, "plugin-dev.json"));
  if (!targets || typeof targets !== "object" || Array.isArray(targets) ||
      Object.entries(targets).some(([name, value]) => !safeLabel.test(name) || name === "default" ||
        !value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("Invalid development target configuration.");
  }
  if (targetName !== undefined && (typeof targetName !== "string" || !safeLabel.test(targetName) || !Object.hasOwn(targets, targetName))) {
    throw new Error(`Unknown development target ${targetName}. Select a named target from plugin-dev.json.`);
  }
  const config = { ...base, ...(targetName === undefined ? {} : targets[targetName]), profile: targetName ?? "default" };
  if (config.schemaVersion !== 1 || typeof config.name !== "string" || !config.name || !config.tasks || typeof config.tasks !== "object" || Array.isArray(config.tasks)) {
    throw new Error("plugin-dev.json requires schemaVersion 1, name and tasks.");
  }
  if (config.host !== undefined) {
    if (!config.host || typeof config.host !== "object" || Array.isArray(config.host) ||
        ["target", "format", "runner", "storage"].some((key) => typeof config.host[key] !== "string" || !safeLabel.test(config.host[key]))) {
      throw new Error("Host metadata requires target, format, runner and storage.");
    }
    const { target, format, runner, storage } = config.host;
    config.host = { target, format, runner, storage };
  }
  repoPath(root, config.dependencyRoot ?? ".");
  for (const directory of [...(config.sourceDirectories ?? []), ...(config.sourceFiles ?? [])]) repoPath(root, directory);
  for (const [name, tasks] of Object.entries(config.tasks)) {
    if (!safeLabel.test(name) || !Array.isArray(tasks) || !tasks.length) throw new Error(`Invalid task group: ${name}`);
    const labels = new Set();
    for (const task of tasks) {
      if (!safeLabel.test(task.label) || ["run", "verification"].includes(task.label) || labels.has(task.label) || !["node", "pnpm"].includes(task.command) ||
          !Array.isArray(task.args) || task.args.some((arg) => typeof arg !== "string") ||
          (task.timeoutMs !== undefined && (!Number.isSafeInteger(task.timeoutMs) || task.timeoutMs < 1 || task.timeoutMs > 43_200_000))) {
        throw new Error(`Invalid command in task group ${name}.`);
      }
      if (!safeLabel.test(reportLabel(config, task.label))) throw new Error(`Report label is too long in task group ${name}.`);
      repoPath(root, task.cwd ?? ".");
      labels.add(task.label);
    }
  }
  for (const port of config.ports ?? []) {
    if (typeof port.name !== "string" || !Number.isInteger(port.port) || port.port < 1 || port.port > 65535) throw new Error("Invalid development port.");
  }
  if (config.preflight !== undefined) {
    if (!config.preflight || typeof config.preflight !== "object" || Array.isArray(config.preflight)) throw new Error("Invalid task preflight configuration.");
    for (const [name, check] of Object.entries(config.preflight)) {
      if (!Object.hasOwn(config.tasks, name) || !check || typeof check !== "object" || Array.isArray(check) ||
          Object.keys(check).some((key) => !["files", "installedPins"].includes(key)) || !Array.isArray(check.files) || !check.files.length ||
          (check.installedPins !== undefined && typeof check.installedPins !== "boolean")) {
        throw new Error(`Invalid preflight for task group ${name}.`);
      }
      for (const file of check.files) repoPath(root, file);
    }
  }
  return config;
}

export const previewCommands = new Set(["dev", "dev-admin", "dev-engine"]);

/**
 * Checks run under the toolkit lock before the first task, so a refusal leaves
 * package output, retained state and recorded evidence untouched.
 */
export async function preflightTasks(root, config, command, { isPortInUse = portInUse } = {}) {
  const check = config.preflight?.[command];
  if (!check) return;
  checkDependencies(root, config);
  if (check.installedPins) checkInstalledPins(root, config);
  for (const file of check.files) {
    let stat = null;
    try { stat = lstatSync(repoPath(root, file)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!stat?.isFile()) throw new Error(`${file} is missing or is not a regular file; nothing was refreshed.`);
  }
  for (const port of config.ports ?? []) {
    if (await isPortInUse(port.port)) throw new Error(`${port.name} port ${port.port} is in use; stop that preview before starting ${command}. Nothing was refreshed.`);
  }
}

/**
 * Every dependency the fixture manifest pins must resolve in the existing graph
 * at that exact version, because the preview config loads them after the refresh.
 */
export function checkInstalledPins(root, config) {
  const directory = repoPath(root, config.dependencyRoot ?? ".");
  const manifest = readJson(path.join(directory, "package.json"));
  const setupCommand = config.profile === "default" ? "pnpm dev:setup" : `pnpm dev:setup --target ${config.profile}`;
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      const candidate = packageRoot(directory, name);
      if (!candidate) throw new Error(`${name} is not installed for ${config.dependencyRoot}. Run ${setupCommand}; nothing was refreshed.`);
      const actual = readJson(candidate).version;
      if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec) && actual !== spec) {
        throw new Error(`${name}: ${config.dependencyRoot} pins ${spec}, found ${actual}. Run ${setupCommand}; nothing was refreshed.`);
      }
    }
  }
}

/**
 * A preview only counts as stopped after a requested stop of its running
 * last task with clean cleanup. An exit without a request, including exit
 * code 0, a timeout and any other failure during shutdown stay failed.
 */
// Only the stop signals the toolkit forwards count as intentional; SIGKILL means
// graceful shutdown failed, and any other signal is a crash during shutdown.
const requestedStopSignals = new Set(["SIGINT", "SIGTERM"]);

export function previewStatus(tasks, results, interrupted) {
  const last = results.at(-1);
  if (!interrupted || !last || results.length !== tasks.length || results.slice(0, -1).some((result) => result.status !== "passed")) return "failed";
  const requestedStop = last.stopRequestedBeforeExit === true && !last.timedOut && !last.cleanupError && !last.spawnError && !last.runnerError &&
    (last.signal !== null ? requestedStopSignals.has(last.signal) : [0, 130, 143].includes(last.exitCode));
  return requestedStop ? "stopped" : "failed";
}

export function parseTargetArgs(args) {
  if (!args.length) return undefined;
  if (args.length !== 2 || args[0] !== "--target" || typeof args[1] !== "string" || !safeLabel.test(args[1])) {
    throw new Error("Usage: <command> [--target NAME]. Define reproducible task arguments in plugin-dev.json.");
  }
  return args[1];
}

export function reportLabel(config, label) {
  return config.profile && config.profile !== "default" ? `${config.profile}-${label}` : label;
}

function targetMetadata(config) {
  return { profile: config.profile ?? "default", dependencyRoot: config.dependencyRoot ?? ".", host: config.host ?? null, ports: config.ports ?? [] };
}

export function childHostEnvironment(root, config, inherited = process.env) {
  const env = { ...inherited, NODE_OPTIONS: "--max-old-space-size=2048", ASTRO_DEV_BACKGROUND: "0" };
  if (config.host) {
    env.SHIPIT_HOST_TARGET = config.host.target;
    env.SHIPIT_PUBLISHED_HOST = repoPath(root, config.dependencyRoot ?? ".");
  }
  return env;
}

export function checkToolchain(root) {
  if (process.platform === "win32") throw new Error("Use WSL2 with the repository on its Linux filesystem.");
  const manifest = readJson(path.join(root, "package.json"));
  const expected = readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
  if (existsSync(path.join(root, ".node-version")) && readFileSync(path.join(root, ".node-version"), "utf8").trim() !== expected) {
    throw new Error(".nvmrc and .node-version disagree.");
  }
  if (process.versions.node !== expected) throw new Error(`Use Node ${expected}: run nvm install && nvm use.`);
  const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(manifest.packageManager ?? "")?.[1];
  if (!pnpmVersion) throw new Error("Pin an exact pnpm version in package.json#packageManager.");
  const result = spawnSync("pnpm", ["--version"], { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 16_384 });
  if (result.status !== 0 || result.stdout.trim() !== pnpmVersion) throw new Error(`Use pnpm ${pnpmVersion}: run corepack enable, then pnpm --version.`);
  return { node: expected, pnpm: pnpmVersion };
}

function packageRoot(root, name) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) throw new Error("Invalid dependency package name.");
  for (const prefix of ["node_modules", "node_modules/.pnpm/node_modules"]) {
    const candidate = path.join(root, prefix, name, "package.json");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function checkDependencies(root, config) {
  const directory = repoPath(root, config.dependencyRoot ?? ".");
  const packages = {};
  for (const [name, expected] of Object.entries(config.expectedPackages ?? {})) {
    const candidate = packageRoot(directory, name);
    if (!candidate) throw new Error(`${name} is missing. Run pnpm dev:setup.`);
    const actual = readJson(candidate).version;
    if (actual !== expected) throw new Error(`${name}: expected ${expected}, found ${actual}. Run pnpm dev:setup with the committed lockfile.`);
    packages[name] = actual;
  }
  return packages;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (used) => { socket.destroy(); resolve(used); };
    socket.setTimeout(400, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function assertRegularFile(file) {
  if (!existsSync(file)) {
    try { if (lstatSync(file).isSymbolicLink()) throw new Error("Refusing a symlinked report file."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return;
  }
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Refusing a symlinked or non-file report path.");
}

/** Checks a step reported as unable to run, one JSON object per line; unreadable lines count as unknown checks. */
export function readNotRun(file) {
  if (!existsSync(file)) return [];
  const seen = new Map();
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    let item;
    try { item = JSON.parse(line); } catch { item = null; }
    const check = typeof item?.check === "string" && item.check ? item.check : "unknown";
    if (!seen.has(check)) seen.set(check, { check, reason: typeof item?.reason === "string" ? item.reason : "unreported" });
  }
  return [...seen.values()];
}

export function writeReportJson(file, value) {
  assertRegularFile(file);
  const data = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(data) > 64 * 1024) throw new Error("Development evidence exceeds 64 KiB.");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, data, { flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
  } finally { if (existsSync(temporary)) rmSync(temporary); }
}

export function ensureReports(root, names = []) {
  for (const part of ["artifacts", reportPath]) {
    const directory = repoPath(root, part);
    if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error("Refusing a symlinked report directory.");
  }
  const directory = repoPath(root, reportPath);
  const marker = path.join(directory, ".owned.json");
  assertRegularFile(marker);
  const owner = createHash("sha256").update(realpathSync(root)).digest("hex");
  if (existsSync(directory) && !existsSync(marker) && readdirSync(directory).length) throw new Error("Report directory contains files not owned by this toolkit.");
  mkdirSync(directory, { recursive: true });
  const recorded = existsSync(marker) ? readJson(marker) : { owner, schemaVersion: 1, files: [] };
  if (recorded.owner !== owner) throw new Error("Report directory belongs to another checkout.");
  if (!Array.isArray(recorded.files) || [...recorded.files, ...names].some((name) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:json|log)$/.test(name))) {
    throw new Error("Invalid report ownership manifest.");
  }
  for (const name of names) {
    const file = path.join(directory, name);
    assertRegularFile(file);
    if (existsSync(file) && !recorded.files.includes(name)) throw new Error("Refusing to replace an unowned report file.");
  }
  recorded.files = [...new Set([...recorded.files, ...names])].sort();
  writeReportJson(marker, recorded);
  return directory;
}

export function cleanReports(root, apply = false) {
  const directory = repoPath(root, reportPath);
  if (!existsSync(directory)) return [];
  ensureReports(root);
  const recorded = readJson(path.join(directory, ".owned.json"));
  const files = readdirSync(directory).filter((name) => name !== ".owned.json");
  for (const name of files) {
    if (!recorded.files.includes(name) || !lstatSync(path.join(directory, name)).isFile()) {
      throw new Error("Unexpected or unowned report artifact; cleanup stopped without deleting anything.");
    }
  }
  if (apply) for (const name of files) rmSync(path.join(directory, name));
  return files;
}

export function acquireLock(root, lockDirectory = path.join(os.tmpdir(), `shipit-plugin-dev-${process.getuid?.() ?? "user"}.lock`)) {
  const token = randomUUID();
  const guard = `${lockDirectory}.guard`;
  try { mkdirSync(guard); }
  catch { throw new Error("Development lock is being updated. Retry after the other command starts; inspect a persistent lock guard before removing it."); }
  try {
  const ownerFile = path.join(lockDirectory, "owner.json");
  try { mkdirSync(lockDirectory); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (lstatSync(lockDirectory).isSymbolicLink()) throw new Error("Development lock must not be a symbolic link.");
    let owner;
    try { owner = readJson(ownerFile); }
    catch { throw new Error("Another development command is starting, or its lock needs inspection."); }
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error("Invalid development lock; inspect it before retrying.");
    let active = true;
    try { process.kill(owner.pid, 0); } catch (e) { if (e.code === "ESRCH") active = false; else throw e; }
    if (active) throw new Error(`Another plugin command is active (PID ${owner.pid}). Stop it before starting another build, test or preview.`);
    throw new Error(`A previous development command ended abnormally (PID ${owner.pid}). Its children may still be running. Inspect and stop them before removing the stale lock at ${lockDirectory}.`);
  }
  writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, token }) + "\n");
  return () => {
    if (existsSync(ownerFile) && readJson(ownerFile).token === token) rmSync(lockDirectory, { recursive: true });
  };
  } finally { rmSync(guard, { recursive: true }); }
}

export function sourceFingerprint(root, config) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(targetMetadata(config))).update("\0");
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (["node_modules", "dist", ".git", "artifacts"].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) hash.update(path.relative(root, file)).update("\0").update(readFileSync(file)).update("\0");
    }
  };
  for (const directory of config.sourceDirectories ?? []) visit(repoPath(root, directory));
  for (const name of sourceFileInputs(config)) {
    const file = repoPath(root, name);
    if (existsSync(file)) hash.update(name).update("\0").update(readFileSync(file));
  }
  return hash.digest("hex");
}

export function readRecordedReport(root, config, label = "run") {
  if (!["run", "verification"].includes(label)) throw new Error("Unknown development report type.");
  const name = `${reportLabel(config, label)}.json`;
  const file = path.join(root, reportPath, name);
  if (!existsSync(file)) throw new Error(`No recorded development run for ${config.profile ?? "default"}.`);
  for (const part of ["artifacts", reportPath]) {
    const directory = repoPath(root, part);
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Refusing a symlinked or non-directory report path.");
  }
  const boundedRead = (target) => {
    assertRegularFile(target);
    if (lstatSync(target).size > 64 * 1024) throw new Error("Recorded development evidence exceeds 64 KiB.");
    return readJson(target);
  };
  const recorded = boundedRead(path.join(root, reportPath, ".owned.json"));
  const owner = createHash("sha256").update(realpathSync(root)).digest("hex");
  if (recorded.schemaVersion !== 1 || recorded.owner !== owner || !Array.isArray(recorded.files) || !recorded.files.includes(name)) {
    throw new Error("Recorded development evidence is not owned by this checkout.");
  }
  const summary = boundedRead(file);
  const expected = targetMetadata(config);
  if (Object.entries(expected).some(([key, value]) => JSON.stringify(summary[key]) !== JSON.stringify(value))) {
    throw new Error("Recorded development target metadata does not match the selected configuration. Run verification again.");
  }
  return { ...summary, sourceChanged: summary.sourceChanged === true || summary.sourceHash !== sourceFingerprint(root, config) };
}

export async function main(argv = process.argv.slice(2), root = process.cwd(), lockDirectory) {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help") {
    console.log("Plugin development: doctor | setup | quick | verify | browser | dev | report | refresh | dev-admin | dev-engine (native EmDash 1.3.0; optional --target native-1.3.0) | clean [--apply]");
    return 0;
  }
  if (command === "clean") {
    if (args.some((arg) => arg !== "--apply")) throw new Error("Usage: clean [--apply]");
    const release = acquireLock(root, lockDirectory);
    let files;
    try { files = cleanReports(root, args.includes("--apply")); } finally { release(); }
    console.log(`${args.includes("--apply") ? "Removed" : "Would remove"} ${files.length} compact reports. Source, dependencies and databases are untouched.`);
    return 0;
  }
  const targetName = parseTargetArgs(args);
  const config = readConfig(root, targetName);
  if (command === "dev-engine" && config.host?.target !== "native-1.3.0") throw new Error("dev-engine requires the native-1.3.0 host.");
  if (command === "report") {
    console.log(JSON.stringify(readRecordedReport(root, config), null, 2));
    return 0;
  }
  if (command !== "doctor" && !Object.hasOwn(config.tasks, command)) throw new Error(`No ${command} task configured.`);
  const versions = checkToolchain(root);
  if (command === "doctor") {
    console.log(`${config.name} (${config.profile}): Node ${versions.node}, pnpm ${versions.pnpm}`);
    console.log(JSON.stringify(targetMetadata(config), null, 2));
    const packages = checkDependencies(root, config);
    console.log(JSON.stringify(packages, null, 2));
    console.log(JSON.stringify({ checkout: readCheckoutState(root, config) }, null, 2));
    const verificationFile = path.join(root, reportPath, `${reportLabel(config, "verification")}.json`);
    let report = null;
    try { report = readRecordedReport(root, config, existsSync(verificationFile) ? "verification" : "run"); }
    catch { /* Unreadable evidence cannot establish current verification. */ }
    console.log(JSON.stringify({ verification: { ...verificationState(report, config, versions, packages),
      finishedAt: report?.finishedAt ?? null, sourceHash: report?.sourceHash ?? null } }, null, 2));
    for (const port of config.ports ?? []) console.log(`${port.name}: 127.0.0.1:${port.port} ${await portInUse(port.port) ? "in use" : "available"}`);
    return 0;
  }
  const tasks = config.tasks[command];
  if (!tasks) throw new Error(`No ${command} task configured. Run help for available commands.`);
  const packages = command !== "setup" ? checkDependencies(root, config) : {};
  return runTasks(root, config, command, versions, packages, lockDirectory);
}

export async function runTasks(root, config, command, versions, packages, lockDirectory, { isPortInUse } = {}) {
  const tasks = Object.hasOwn(config.tasks, command) ? config.tasks[command] : null;
  if (!tasks) throw new Error(`No ${command} task configured.`);
  const release = acquireLock(root, lockDirectory);
  let interrupted = false;
  // Set before any report or fingerprint write: an unconfirmed cleanup keeps the lock.
  let retainLock = false;
  const controller = new AbortController();
  const stop = () => { interrupted = true; controller.abort(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await preflightTasks(root, config, command, { isPortInUse });
    const runFile = `${reportLabel(config, "run")}.json`;
    const verificationFile = command === "verify" ? `${reportLabel(config, "verification")}.json` : null;
    const directory = ensureReports(root, [runFile, ...(verificationFile ? [verificationFile] : []), ...tasks.flatMap((task) => [`${reportLabel(config, task.label)}.json`, `${reportLabel(config, task.label)}.log`])]);
    const summary = { schemaVersion: 1, ...targetMetadata(config), task: command, verificationId: command === "verify" ? randomUUID() : null,
      versions, packages, sourceHash: sourceFingerprint(root, config), startedAt: new Date().toISOString(), status: "running", checks: [], cleanup: null };
    const save = () => writeReportJson(path.join(directory, runFile), summary);
    // A check that cannot run in this environment says so here; it is never counted as passed.
    const notRunFile = path.join(directory, `${reportLabel(config, "not-run")}.jsonl`);
    rmSync(notRunFile, { force: true });
    save();
    const results = [];
    for (const task of tasks) {
      if (interrupted) break;
      console.log(`[${config.name}:${config.profile}] ${task.label}`);
      const result = await runCommand({
        label: reportLabel(config, task.label), command: task.command === "node" ? process.execPath : "pnpm", args: task.args,
        cwd: repoPath(root, task.cwd ?? "."), reportDir: directory, timeoutMs: task.timeoutMs ?? 900_000, signal: controller.signal,
        env: { ...childHostEnvironment(root, config),
          SHIPIT_VERIFY_ID: summary.verificationId ?? undefined,
          SHIPIT_VERIFY_STARTED_AT: verificationFile ? summary.startedAt : undefined,
          SHIPIT_VERIFY_SOURCE_HASH: verificationFile ? summary.sourceHash : undefined,
          SHIPIT_VERIFY_TARGET: verificationFile ? config.profile : undefined,
          SHIPIT_VERIFY_NOT_RUN_FILE: verificationFile ? notRunFile : undefined },
      });
      results.push(result);
      if (result.cleanupError) {
        retainLock = true;
        summary.cleanup = { uncertain: true, label: task.label, pid: result.pid, pgid: result.pgid, error: result.cleanupError, lock: "retained" };
        // Printed before any report write, which can fail and must not hide the workload.
        console.error(`Cleanup of ${task.label} was not confirmed (${result.cleanupError}). Process group ${result.pgid} (leader PID ${result.pid}) may still be running, so the development lock stays held. Inspect and stop that group before removing the lock.`);
      }
      summary.checks.push({ label: task.label, status: result.status, exitCode: result.exitCode, durationMs: result.durationMs,
        signal: result.signal, interruptedBy: result.interruptedBy, stopRequestedBeforeExit: result.stopRequestedBeforeExit, timedOut: result.timedOut,
        pid: result.pid, pgid: result.pgid, cleanupError: result.cleanupError, latestCleanupFailure: result.latestCleanupFailure,
        groupSignalErrorCount: result.groupSignalErrorCount, groupAbsentConfirmed: result.groupAbsentConfirmed, groupSignalErrors: result.groupSignalErrors });
      save();
      if (result.status !== "passed") break;
    }
    const preview = previewCommands.has(command);
    summary.status = preview ? previewStatus(tasks, results, interrupted)
      : !interrupted && results.length === tasks.length && results.every((result) => result.status === "passed") ? "passed" : "failed";
    if (retainLock) summary.status = "failed";
    summary.finishedAt = new Date().toISOString();
    if (verificationFile) summary.notRun = readNotRun(notRunFile);
    summary.sourceChanged = summary.sourceHash !== sourceFingerprint(root, config);
    if (summary.sourceChanged && command !== "setup" && !preview) summary.status = "failed";
    save();
    if (verificationFile) writeReportJson(path.join(directory, verificationFile), summary);
    console.log(`${command} (${config.profile}): ${summary.status}${preview ? " developer preview; not verification" : ""}. Compact results: ${reportPath}/${runFile}`);
    for (const item of summary.notRun ?? []) console.log(`NOT RUN: ${item.check} (${item.reason}); this check did not pass.`);
    return ["passed", "stopped"].includes(summary.status) ? 0 : 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (!retainLock) release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
