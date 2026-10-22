import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureReports, readConfig, readRecordedReport, reportLabel, sourceFingerprint, writeReportJson } from "./cli.mjs";
import { readCheckoutState, verificationState } from "./workspace-state.mjs";

const LIMIT = 64 * 1024;
const targets = new Set(["default", "native-1.3.0"]);
const outcomes = new Set(["success", "failure", "cancelled", "skipped"]);
const checkStatuses = new Set(["passed", "failed", "timed_out", "signaled"]);
const hostPackages = ["emdash", "@emdash-cms/admin", "astro"];
const hashPattern = /^[a-f0-9]{64}$/;
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const versionPattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const matchingString = (value, pattern) => typeof value === "string" && pattern.test(value) ? value : null;
const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function selectedTarget(target) {
  if (!targets.has(target)) throw new Error("Invalid evidence target.");
  return target;
}

function readSmallJson(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) throw new Error("Invalid evidence input.");
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (!isObject(value)) throw new Error("Invalid evidence input.");
  return value;
}

function readRun(root, config) {
  const name = `${reportLabel(config, "run")}.json`;
  const directory = ensureReports(root, [name]);
  const saved = readSmallJson(path.join(directory, name));
  const report = readRecordedReport(root, config);
  if (saved.schemaVersion !== 1) throw new Error("Invalid verification report.");
  return { report, savedSourceChanged: saved.sourceChanged };
}

function hostMetadata(config, target) {
  const expected = { target: "native-1.3.0", format: "native", runner: "node", storage: "sqlite" };
  if (!isObject(config.host) || Object.entries(expected).some(([key, value]) => config.host[key] !== value)) {
    throw new Error("Invalid evidence host.");
  }
  return expected;
}

function githubIdentity(context) {
  return {
    sha: matchingString(context?.sha, commitPattern),
    runId: matchingString(context?.runId, /^[1-9]\d{0,19}$/),
    runAttempt: matchingString(context?.runAttempt, /^[1-9]\d{0,9}$/),
  };
}

function environmentContext(env) {
  return {
    sha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    setupOutcome: env.SHIPIT_CI_SETUP_OUTCOME,
    verifyOutcome: env.SHIPIT_CI_VERIFY_OUTCOME,
  };
}

function tarballMetadata(value) {
  if (!isObject(value) || !matchingString(value.file, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}\.tgz$/) ||
      !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || !matchingString(value.sha256, hashPattern)) return null;
  return { file: value.file, bytes: value.bytes, sha256: value.sha256 };
}

function finishedCheck(value, label) {
  if (!isObject(value) || value.label !== label || !checkStatuses.has(value.status) ||
      !(value.exitCode === null || (Number.isInteger(value.exitCode) && Math.abs(value.exitCode) <= 2_147_483_647)) ||
      !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > 86_400_000) return null;
  return { label, status: value.status, exitCode: value.exitCode, durationMs: value.durationMs };
}

function configuredChecks(config) {
  const tasks = config.tasks.verify;
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 128) throw new Error("Invalid verification checks.");
  return tasks.map(task => task.label);
}

function pinnedVersions(root, config) {
  const node = matchingString(readFileSync(path.join(root, ".nvmrc"), "utf8").trim(), versionPattern);
  const nodeVersion = readFileSync(path.join(root, ".node-version"), "utf8").trim();
  const manifest = readSmallJson(path.join(root, "package.json"));
  const pnpm = /^pnpm@(\d{1,6}\.\d{1,6}\.\d{1,6})(?:\+[^\s]+)?$/.exec(manifest.packageManager ?? "")?.[1];
  const packages = Object.fromEntries(hostPackages.map(name => [name, matchingString(config.expectedPackages?.[name], versionPattern)]));
  if (!node || nodeVersion !== node || !pnpm || Object.values(packages).some(value => value === null)) {
    throw new Error("Invalid evidence version pins.");
  }
  return { versions: { node, pnpm }, packages };
}

function writeEvidence(root, name, value) {
  if (Buffer.byteLength(JSON.stringify(value, null, 2) + "\n") > LIMIT) throw new Error("Evidence size limit exceeded.");
  const directory = ensureReports(root, [name]);
  writeReportJson(path.join(directory, name), value);
}

export function recordPackedVerification(root, target, tarball, context = process.env) {
  selectedTarget(target);
  let config, report, host, savedSourceChanged;
  try {
    config = readConfig(root, target === "default" ? undefined : target);
    host = hostMetadata(config, target);
    ({ report, savedSourceChanged } = readRun(root, config));
    const labels = configuredChecks(config);
    if (report.task !== "verify" || report.status !== "running" || report.finishedAt !== undefined ||
        !timestamp(report.startedAt) || !matchingString(report.verificationId, uuidPattern) ||
        !matchingString(report.sourceHash, hashPattern) || report.sourceChanged ||
        (savedSourceChanged !== undefined && savedSourceChanged !== false) ||
        context.SHIPIT_VERIFY_ID !== report.verificationId || context.SHIPIT_VERIFY_STARTED_AT !== report.startedAt ||
        context.SHIPIT_VERIFY_SOURCE_HASH !== report.sourceHash || context.SHIPIT_VERIFY_TARGET !== target ||
        !Array.isArray(report.checks) || report.checks.length >= labels.length ||
        report.checks.some((check, index) => !finishedCheck(check, labels[index]) || check.status !== "passed" || check.exitCode !== 0)) return null;
  } catch {
    return null;
  }
  const artifact = tarballMetadata(tarball);
  if (!artifact) throw new Error("Invalid packed artifact evidence.");
  const checkout = readCheckoutState(root, config);
  const receipt = {
    schemaVersion: 1, target, host, verificationId: report.verificationId,
    startedAt: report.startedAt, sourceHash: report.sourceHash,
    commit: matchingString(checkout.commit, commitPattern),
    github: githubIdentity(environmentContext(context)), tarball: artifact,
  };
  writeEvidence(root, `${target}-packed-verification.json`, receipt);
  return receipt;
}

export function collectCiEvidence(root, target, context = {}) {
  selectedTarget(target);
  if (!isObject(context)) context = {};
  const github = {
    ...githubIdentity(context),
    setupOutcome: outcomes.has(context.setupOutcome) ? context.setupOutcome : "unknown",
    verifyOutcome: outcomes.has(context.verifyOutcome) ? context.verifyOutcome : "unknown",
  };
  const evidence = {
    schemaVersion: 1, target, host: null, commit: null, github,
    status: "not-verified", reasons: [], checkout: "unavailable",
    versions: { node: null, pnpm: null }, packages: Object.fromEntries(hostPackages.map(name => [name, null])),
    source: { hash: null, changed: null }, checks: [], package: null,
  };
  const reason = value => { if (!evidence.reasons.includes(value)) evidence.reasons.push(value); };
  if (!github.sha || !github.runId || !github.runAttempt) reason("invalid-ci-context");
  if (github.setupOutcome !== "success" || github.verifyOutcome !== "success") reason("ci-steps-not-successful");
  let config, pins, labels;
  try {
    config = readConfig(root, target === "default" ? undefined : target);
    evidence.host = hostMetadata(config, target);
    labels = configuredChecks(config);
    pins = pinnedVersions(root, config);
    evidence.source.hash = sourceFingerprint(root, config);
  } catch {
    reason("configuration-unavailable");
  }
  try {
    const checkout = readCheckoutState(root, config);
    evidence.commit = matchingString(checkout.commit, commitPattern);
    evidence.checkout = checkout.trackedDirty === true || checkout.untrackedSource === true ? "dirty" :
      checkout.trackedDirty === false && checkout.untrackedSource === false ? "clean" : "unavailable";
  } catch {
    reason("checkout-unavailable");
  }
  if (!evidence.commit || evidence.commit !== github.sha) reason("commit-mismatch");
  if (evidence.checkout !== "clean") reason("checkout-not-clean");
  let report, savedSourceChanged;
  if (config && pins && labels) {
    try {
      ({ report, savedSourceChanged } = readRun(root, config));
      evidence.source.changed = report.sourceChanged || savedSourceChanged === true;
      evidence.versions = Object.fromEntries(["node", "pnpm"].map(name => [name, matchingString(report.versions?.[name], versionPattern)]));
      evidence.packages = Object.fromEntries(hostPackages.map(name => [name, matchingString(report.packages?.[name], versionPattern)]));
      if (Array.isArray(report.checks)) {
        evidence.checks = labels.flatMap((label, index) => {
          const check = finishedCheck(report.checks[index], label);
          return check ? [check] : [];
        });
      }
      const state = verificationState({ ...report, sourceChanged: evidence.source.changed }, config, pins.versions, pins.packages);
      if (state.state !== "current" || savedSourceChanged !== false || report.task !== "verify" || report.status !== "passed" ||
          !timestamp(report.startedAt) || !timestamp(report.finishedAt) || Date.parse(report.finishedAt) < Date.parse(report.startedAt) ||
          !matchingString(report.verificationId, uuidPattern) || evidence.checks.length !== labels.length ||
          evidence.checks.some(check => check.status !== "passed" || check.exitCode !== 0)) reason("verification-not-current");
      if (!Array.isArray(report.notRun) || report.notRun.length) reason("checks-not-run");
    } catch {
      report = undefined;
      reason("verification-unavailable");
    }
  } else reason("verification-unavailable");
  if (report?.task === "verify" && matchingString(report.verificationId, uuidPattern) && evidence.source.hash) {
    try {
      const name = `${target}-packed-verification.json`;
      const directory = ensureReports(root, [name]);
      const receipt = readSmallJson(path.join(directory, name));
      const artifact = tarballMetadata(receipt.tarball);
      const sameGithub = isObject(receipt.github) && ["sha", "runId", "runAttempt"].every(key => github[key] !== null && receipt.github[key] === github[key]);
      if (receipt.schemaVersion === 1 && receipt.target === target && JSON.stringify(receipt.host) === JSON.stringify(evidence.host) &&
          receipt.verificationId === report.verificationId && receipt.startedAt === report.startedAt &&
          receipt.sourceHash === report.sourceHash && receipt.sourceHash === evidence.source.hash &&
          receipt.commit === evidence.commit && sameGithub && artifact) evidence.package = artifact;
      else reason("package-not-matched");
    } catch {
      reason("package-unavailable");
    }
  } else reason("package-unavailable");
  if (!evidence.reasons.length) evidence.status = "passed";
  else if ([github.setupOutcome, github.verifyOutcome].some(value => value === "failure" || value === "cancelled") || report?.status === "failed") evidence.status = "failed";
  return evidence;
}

export function main(argv = process.argv.slice(2), root = process.cwd(), context = environmentContext(process.env)) {
  if (argv.length !== 2 || argv[0] !== "--target" || !targets.has(argv[1])) throw new Error("Invalid evidence arguments.");
  const target = argv[1];
  const evidence = collectCiEvidence(root, target, context);
  writeEvidence(root, `${target}-ci-evidence.json`, evidence);
  console.log(`CI evidence (${target}): ${evidence.status}`);
  return evidence.status === "passed" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch { console.error("CI evidence could not be written."); process.exitCode = 1; }
}
