import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";

function gitOutput(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function sourceFileInputs(config) {
  return [...new Set(["plugin-dev.json", "package.json", ".nvmrc", ".node-version", ".github/workflows/verify.yml",
    ...(config.sourceFiles ?? []), path.join(config.dependencyRoot ?? ".", "pnpm-lock.yaml")])];
}

export function readCheckoutState(root, config) {
  const head = gitOutput(root, ["rev-parse", "HEAD"]);
  const branch = gitOutput(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const status = gitOutput(root, ["status", "--porcelain", "--untracked-files=no"]);
  let untrackedSource = null;
  if (config) {
    const directInputs = new Set(sourceFileInputs(config).map((file) => path.normalize(file)));
    const files = gitOutput(root, ["ls-files", "--others", "-z", "--",
      ...(config.sourceDirectories ?? []), ...directInputs,
      ...["node_modules", "dist", ".git", "artifacts"].map((name) => `:(glob,exclude)**/${name}/**`)]);
    if (files !== null) {
      try {
        untrackedSource = files.split("\0").filter(Boolean).some((file) =>
          !file.split("/").some((part) => ["node_modules", "dist", ".git", "artifacts"].includes(part)) &&
          (directInputs.has(path.normalize(file)) || lstatSync(path.join(root, file)).isFile()));
      } catch { untrackedSource = null; }
    }
  }
  return {
    commit: head && /^[a-f0-9]{40,64}$/.test(head) ? head : null,
    branch: branch && branch.length <= 256 ? branch : null,
    trackedDirty: status === null ? null : status.length > 0,
    untrackedSource,
  };
}

const hashPattern = /^[a-f0-9]{64}$/;

export function verificationState(report, config, versions, packages) {
  const result = (state, reason) => ({ state, reason });
  if (!report) return result("missing", "NO_COMPLETED_VERIFICATION");
  if (report.task !== "verify") return result("not-verified", "NOT_FULL_VERIFICATION");
  if (report.profile !== config.profile || report.dependencyRoot !== (config.dependencyRoot ?? ".") ||
      JSON.stringify(report.host) !== JSON.stringify(config.host ?? null)) {
    return result("not-verified", "TARGET_MISMATCH");
  }
  if (report.sourceChanged !== false || typeof report.sourceHash !== "string" || !hashPattern.test(report.sourceHash)) {
    return result("stale", "SOURCE_CHANGED_OR_UNVERIFIED");
  }
  const started = Date.parse(report.startedAt);
  const finished = Date.parse(report.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started || report.status === "running") {
    return result("incomplete", "RUN_NOT_FINISHED");
  }
  if (report.status !== "passed") return result("failed", "VERIFICATION_FAILED");
  const expected = config.tasks?.verify;
  if (!Array.isArray(expected) || !expected.length || !Array.isArray(report.checks) || report.checks.length !== expected.length ||
      expected.some((task, index) => report.checks[index]?.label !== task.label)) {
    return result("incomplete", "CHECK_SET_INCOMPLETE");
  }
  if (report.checks.some((check) => check.status !== "passed" || check.exitCode !== 0 ||
      !Number.isFinite(check.durationMs) || check.durationMs < 0)) {
    return result("failed", "CHECK_FAILED_OR_INVALID");
  }
  if (!versions || Object.entries(versions).some(([name, version]) => report.versions?.[name] !== version)) {
    return result("not-verified", "TOOLCHAIN_MISMATCH");
  }
  if (!packages || Object.entries(packages).some(([name, version]) => report.packages?.[name] !== version)) {
    return result("not-verified", "DEPENDENCY_MISMATCH");
  }
  return result("current", "COMPLETED_FOR_CURRENT_SOURCE");
}
