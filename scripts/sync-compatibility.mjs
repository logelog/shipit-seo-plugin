import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compatibilityRoot, expectedPackagePins, hostPeerRange, readCompatibility, selectCompatibilityTarget } from "./compatibility.mjs";
import { runtimeHostSupportErrors } from "./runtime-host-compatibility.mjs";

export const managedDocuments = Object.freeze({
  "README.md": "support",
  "AGENTS.md": "development",
  "CONTRIBUTING.md": "development",
  "SECURITY.md": "support",
  "docs/architecture.md": "development",
  "docs/releasing.md": "support",
  "docs/compatibility.md": "matrix",
  "packages/emdash-plugin-seo/README.md": "package",
  "packages/emdash-plugin-seo/INSTALL-PROMPT.md": "support",
  "packages/emdash-plugin-seo/UPGRADE.md": "package",
  "packages/emdash-plugin-seo/UNINSTALL-PROMPT.md": "support",
});

const read = (root, name) => readFileSync(path.join(root, name), "utf8");
const readJson = (root, name) => JSON.parse(read(root, name));
const sortedTargets = policy => [policy.currentTarget, ...policy.retainedTargets];

function hostLabel(target) {
  return target.emdash === target.admin ? target.emdash : `${target.emdash} / admin ${target.admin}`;
}

export function renderCompatibilityBlock(policy, kind, productVersion) {
  const current = selectCompatibilityTarget(policy);
  const { node, pnpm, astro } = policy.toolchain;
  const hosts = sortedTargets(policy).map(name => hostLabel(policy.targets[name]));
  const support = `Native EmDash/admin support: **${hosts.join(" or ")}**.\nUse Node **${node}**, Astro **${astro}** and SQLite.`;
  if (kind === "support") return support;
  if (kind === "package") return `Version \`${productVersion}\` is a native beta.\n\n${support}`;
  if (kind === "development") {
    return `The default development target is **${current.name}** (EmDash/admin ${hostLabel(current)}).\nUse Node **${node}**, pnpm **${pnpm}**, Astro **${astro}** and SQLite.\nThe fixture is \`${current.dependencyRoot}\`.\n\nRetained native targets: ${policy.retainedTargets.length ? policy.retainedTargets.map(name => `\`${name}\``).join(", ") : "none"}.\nThe current target implements ${current.verifyModes.join(" and ")} verification${current.verifyModes.includes("full") ? "." : "; full verification is not implemented for this target."}`;
  }
  if (kind === "matrix") {
    const rows = sortedTargets(policy).map(name => {
      const target = policy.targets[name];
      return `| \`${name}\` | ${name === policy.currentTarget ? "Current" : "Retained"} | ${target.emdash} | ${target.admin} | ${target.verifyModes.join(", ")} |`;
    });
    const full = sortedTargets(policy).find(name => policy.targets[name].verifyModes.includes("full"));
    return `| Target | Role | EmDash | Admin | Implemented verification |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\nPinned toolchain: Node **${node}**, pnpm **${pnpm}**, Astro **${astro}**; native Node/SQLite only.\n\n\`pnpm verify:quick\` selects \`${policy.currentTarget}\`.\n${full ? `Full verification is available with \`pnpm verify --target ${full}\` and its prepared offline npm cache.\nRead that target's report with \`pnpm dev:report --target ${full}\`.` : "No target currently implements full verification."}\nA mode listed here describes the runner, not a passing test or release acceptance.`;
  }
  throw new Error(`Unknown compatibility block ${kind}.`);
}

export function replaceCompatibilityBlock(text, kind, replacement, name) {
  const start = `<!-- compatibility:${kind}:start -->`;
  const end = `<!-- compatibility:${kind}:end -->`;
  if (text.split(start).length !== 2 || text.split(end).length !== 2 || text.indexOf(end) < text.indexOf(start)) {
    throw new Error(`Expected one ${kind} compatibility block in ${name}.`);
  }
  const before = text.slice(0, text.indexOf(start) + start.length);
  const after = text.slice(text.indexOf(end));
  return `${before}\n${replacement}\n${after}`;
}

export function compatibilityUpdates(root, policy = readCompatibility(root)) {
  const updates = [];
  const offer = (name, value) => { if (read(root, name) !== value) updates.push({ name, value }); };
  const packageName = "packages/emdash-plugin-seo/package.json";
  const product = readJson(root, packageName);
  const pins = expectedPackagePins(policy);
  const peer = { emdash: hostPeerRange(policy), "@emdash-cms/admin": hostPeerRange(policy, "@emdash-cms/admin"), astro: policy.toolchain.astro };
  for (const [name, value] of Object.entries(pins)) product.devDependencies[name] = value;
  for (const [name, value] of Object.entries(peer)) product.peerDependencies[name] = value;
  offer(packageName, `${JSON.stringify(product, null, 2)}\n`);
  const workspace = readJson(root, "package.json");
  workspace.packageManager = `pnpm@${policy.toolchain.pnpm}`;
  workspace.engines = { ...workspace.engines, node: policy.toolchain.nodeRange };
  offer("package.json", `${JSON.stringify(workspace, null, 2)}\n`);
  offer(".nvmrc", `${policy.toolchain.node}\n`);
  offer(".node-version", `${policy.toolchain.node}\n`);
  for (const [name, kind] of Object.entries(managedDocuments)) {
    offer(name, replaceCompatibilityBlock(read(root, name), kind, renderCompatibilityBlock(policy, kind, product.version), name));
  }
  return updates;
}

export function checkFixtureCompatibility(root, policy = readCompatibility(root)) {
  const errors = [];
  for (const [name, target] of Object.entries(policy.targets)) {
    const label = `${name} fixture`;
    try {
      const fixture = readJson(root, `${target.dependencyRoot}/package.json`);
      for (const [dependency, expected] of Object.entries(expectedPackagePins(policy, name))) {
        if (fixture.dependencies?.[dependency] !== expected) errors.push(`${label}: ${dependency} must be ${expected}.`);
      }
      if (fixture.packageManager !== `pnpm@${policy.toolchain.pnpm}`) errors.push(`${label}: package manager pin differs.`);
      if (fixture.engines?.node !== policy.toolchain.nodeRange) errors.push(`${label}: Node range differs.`);
      if (target.reviewedLockSha256 === null) errors.push(`${label}: lock hash is pending review.`);
      else {
        const hash = createHash("sha256").update(readFileSync(path.join(root, target.dependencyRoot, "pnpm-lock.yaml"))).digest("hex");
        if (hash !== target.reviewedLockSha256) errors.push(`${label}: reviewed lock hash differs; inspect the lock change.`);
      }
    } catch (error) { errors.push(`${label}: ${error.message}`); }
  }
  return errors;
}

export function checkDevelopmentCompatibility(policy, configurations, environment, { root } = {}) {
  const errors = [];
  const samePins = (left, right) => left && Object.keys(left).length === Object.keys(right).length &&
    Object.entries(right).every(([key, value]) => left[key] === value);
  for (const [name, config] of configurations) {
    const target = selectCompatibilityTarget(policy, name);
    if (config.host?.target !== name || config.dependencyRoot !== target.dependencyRoot ||
        !samePins(config.expectedPackages, expectedPackagePins(policy, name))) {
      errors.push(`${name}: development config does not match compatibility.json.`);
    }
    for (const task of Object.values(config.tasks ?? {}).flat()) {
      const index = task.args?.indexOf("--target");
      if (index >= 0 && task.args[index + 1] !== name) errors.push(`${name}: task ${task.label} selects another target.`);
      if (task.cwd?.startsWith("integration/emdash/published-host-") && task.cwd !== target.dependencyRoot) {
        errors.push(`${name}: task ${task.label} uses another fixture.`);
      }
    }
    const sources = [...(config.sourceFiles ?? []), ...(config.sourceDirectories ?? []),
      ...Object.values(config.preflight ?? {}).flatMap(check => check.files ?? [])];
    if (sources.some(name => name.startsWith("integration/emdash/published-host-") &&
        name !== target.dependencyRoot && !name.startsWith(`${target.dependencyRoot}/`))) {
      errors.push(`${name}: source or preflight selects another fixture.`);
    }
  }
  if (environment.defaultHostTarget !== policy.currentTarget) errors.push("Runtime default target differs from compatibility.json.");
  for (const name of Object.keys(policy.targets)) {
    try {
      const target = environment.selectHostTarget(name);
      const expected = selectCompatibilityTarget(policy, name);
      if (target.name !== name || target.port !== expected.port ||
          !samePins(Object.fromEntries(target.versions), expectedPackagePins(policy, name))) {
        errors.push(`${name}: runtime target pins differ from compatibility.json.`);
      }
      if (root && (!target.fixtureRoot || fileURLToPath(target.fixtureRoot) !== path.resolve(root, expected.dependencyRoot) + path.sep)) {
        errors.push(`${name}: runtime fixture differs from compatibility.json.`);
      }
    } catch (error) { errors.push(`${name}: ${error.message}`); }
  }
  return errors;
}

export async function checkCompatibility(root = compatibilityRoot, { development } = {}) {
  const policy = readCompatibility(root);
  const errors = compatibilityUpdates(root, policy).map(({ name }) => `${name}: compatibility values are stale; run pnpm sync:compatibility.`);
  errors.push(...checkFixtureCompatibility(root, policy));
  errors.push(...runtimeHostSupportErrors(root, policy));
  const source = read(root, "packages/emdash-plugin-seo/src/admin-contract.ts");
  const product = readJson(root, "packages/emdash-plugin-seo/package.json");
  if (!source.includes(`export const SEO_ENGINE_VERSION = "${product.version}";`)) errors.push("Engine version differs from the product package version.");
  if (!development) {
    const toolkit = await import(pathToFileURL(path.join(root, "tooling/plugin-dev/cli.mjs")).href);
    const environment = await import(pathToFileURL(path.join(root, "scripts/published-host/environment.mjs")).href);
    development = { configurations: Object.keys(policy.targets).map(name => [name, toolkit.readConfig(root, name)]), environment };
    const defaultConfig = toolkit.readConfig(root);
    if (defaultConfig.host?.target !== policy.currentTarget) errors.push("Default development config selects another target.");
  }
  errors.push(...checkDevelopmentCompatibility(policy, development.configurations, development.environment, { root }));
  return errors;
}

export function writeCompatibilityUpdates(root = compatibilityRoot) {
  const policy = readCompatibility(root);
  const unsupported = runtimeHostSupportErrors(root, policy);
  if (unsupported.length) throw new Error(`Cannot synchronize unsupported runtime declarations:\n${unsupported.join("\n")}`);
  const updates = compatibilityUpdates(root, policy);
  for (const { name } of updates) {
    const file = path.join(root, name);
    if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error(`Refusing a non-regular managed file: ${name}`);
  }
  for (const { name, value } of updates) writeFileSync(path.join(root, name), value);
  return updates.map(({ name }) => name);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !["--write", "--check"].includes(args[0])) throw new Error("Usage: node scripts/sync-compatibility.mjs --write|--check");
    if (args[0] === "--write") {
      const changed = writeCompatibilityUpdates();
      console.log(changed.length ? `Updated compatibility values in:\n${changed.join("\n")}` : "Compatibility values are current.");
    } else {
      const errors = await checkCompatibility();
      if (errors.length) throw new Error(errors.join("\n"));
      console.log("Compatibility policy, pins, fixtures, runtime targets and current documentation agree.");
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
