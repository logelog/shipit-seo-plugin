import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertVerificationMode, childEnvironment, createEnvironment, parseOptions, readManifest, sourceRoot } from "./environment.mjs";
import { prepareTypes } from "./prepare-types.mjs";
import { fullVerificationPlan } from "./verification-plan.mjs";

const options = parseOptions(process.argv.slice(2));
assertVerificationMode(options.target, options.quick ? "quick" : "full");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 19) throw new Error("Use Node >=24.19.0 <25 for published-host verification");
const script = name => fileURLToPath(new URL(name, import.meta.url));
const pluginManifest = readManifest(new URL("packages/emdash-plugin-seo/", sourceRoot));
const socialArchive = fileURLToPath(new URL(`package-candidate/${pluginManifest.name.replace(/^@/, "").replace("/", "-")}-${pluginManifest.version}.tgz`, options.target.outputRoot));
const fullSteps = options.quick ? [] : fullVerificationPlan(options.target.name, {
  socialArchive,
  socialReceipt: fileURLToPath(new URL("social-save-recovery/packed-green.json", options.target.outputRoot)),
});
const environment = createEnvironment(options.hostPath ?? fileURLToPath(options.target.fixtureRoot), options.target);
environment.assertVersions();
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
  ...fullSteps.map(([label, name, ...args]) => [label, [script(name), ...args]]),
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
