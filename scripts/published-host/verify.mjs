import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertVerificationMode, childEnvironment, createEnvironment, parseOptions, readManifest, sourceRoot } from "./environment.mjs";
import { prepareTypes } from "./prepare-types.mjs";

const options = parseOptions(process.argv.slice(2));
assertVerificationMode(options.target, options.quick ? "quick" : "full");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 19) throw new Error("Use Node >=24.19.0 <25 for published-host verification");
const environment = createEnvironment(options.hostPath ?? fileURLToPath(options.target.fixtureRoot), options.target);
environment.assertVersions();
const script = name => fileURLToPath(new URL(name, import.meta.url));
const pluginManifest = readManifest(new URL("packages/emdash-plugin-seo/", sourceRoot));
const socialArchive = fileURLToPath(new URL(`package-candidate/${pluginManifest.name.replace(/^@/, "").replace("/", "-")}-${pluginManifest.version}.tgz`, environment.target.outputRoot));
// The package is built with the selected host graph's tsdown, never with an
// install of its own, so a checkout set up with only that graph can verify.
const packageBuild = spawnSync(process.execPath, [script("build-package.mjs")], {
  cwd: fileURLToPath(sourceRoot), env: childEnvironment(environment), stdio: "inherit",
});
if (packageBuild.error) throw packageBuild.error;
if (packageBuild.status !== 0) process.exit(packageBuild.status ?? 1);
const configs = prepareTypes(environment);
const tsc = fileURLToPath(new URL("bin/tsc", environment.hostPackageRoot("typescript")));
const steps = [
  ["resolution", [script("resolution-control.mjs")]],
  ["engine-types", [tsc, "--noEmit", "-p", configs.engine]],
  ["admin-types", [tsc, "--noEmit", "-p", configs.admin]],
  ["engine-selfchecks", [script("selfchecks.mjs"), "@shipitseo/emdash-plugin-seo"]],
  ["admin-selfchecks", [script("selfchecks.mjs"), "admin-ui"]],
  ...(!options.quick ? [
    ["engine-build", [script("build-engine.mjs")]],
    ...(["native-1.2.0", "native-1.3.0"].includes(environment.target.name) ? [["install-lifecycle", [script("install-lifecycle-smoke.mjs")]]] : []),
    ["packed-single-plugin", [script("packed-single-seo.mjs")]],
    ...(["native-1.2.0", "native-1.3.0"].includes(environment.target.name) ? [["npm-packed-plugin", [script("npm-packed-native.mjs")]]] : []),
    ...(["native-1.2.0", "native-1.3.0"].includes(environment.target.name) ? [["social-save-recovery", [
      script("social-save-recovery-smoke.mjs"), "--target", environment.target.name, "--mode", "green", "--archive", socialArchive,
      "--receipt", fileURLToPath(new URL("social-save-recovery/packed-green.json", environment.target.outputRoot)),
    ]]] : []),
    ["sqlite", [script("sqlite-smoke.mjs")]],
    ...(["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(environment.target.name) ? [
      ["sitemap-sqlite", [script("sitemap-smoke.mjs")]],
      ["robots-sqlite", [script("robots-smoke.mjs")]],
      ["llms-sqlite", [script("llms-txt-smoke.mjs")]],
      ["indexing-defaults-sqlite", [script("indexing-defaults-smoke.mjs")]],
      ...(environment.target.name === "native-1.3.0" ? [["taxonomy-archive-html", [script("taxonomy-archive-smoke.mjs")]]] : []),
      ["schema-library-sqlite", [script("schema-library-smoke.mjs")]],
      ["metadata-templates-sqlite", [script("metadata-templates-smoke.mjs")]],
      ["publisher-ownership-sqlite", [script("publisher-ownership-smoke.mjs")]],
      ["checklist-evidence-sqlite", [script("checklist-evidence-smoke.mjs")]],
      ["saved-score-lifecycle-sqlite", [script("saved-score-lifecycle-smoke.mjs")]],
      ["score-scan-source-sqlite", [script("score-scan-source-smoke.mjs"), "--target", environment.target.name]],
      ["score-scan-lifecycle-sqlite", [script("score-scan-lifecycle-smoke.mjs")]],
      ["content-health-readback-sqlite", [script("content-health-readback-smoke.mjs")]],
      ["ownership-conflicts-sqlite", [script("ownership-conflicts-smoke.mjs")]],
    ] : []),
  ] : []),
];
for (const [label, args] of steps) {
  console.log(`Published EmDash ${environment.target.versions.get("emdash")}: ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: fileURLToPath(sourceRoot), env: childEnvironment(environment), stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Published-host verification passed (${options.quick ? "quick" : "full"}).`);
