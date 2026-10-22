import { readFileSync } from "node:fs";
import path from "node:path";

const sourceRoot = "packages/emdash-plugin-seo/src/";
export const runtimeHostGateFiles = Object.freeze([
  "sitemap-installation.ts", "robots-installation.ts", "llms-txt-installation.ts",
  "site-verification.ts", "astro.ts", "robots-txt.ts", "admin-ui/robots-txt-model.ts",
  "host-patch-compatibility.selfcheck.ts",
].map(file => sourceRoot + file));

function one(source, expression, label) {
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) throw new Error(`Unrecognized ${label} source; review its host gate before changing support.`);
  return matches[0][1];
}

function versions(json, label) {
  const values = JSON.parse(json);
  if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value))) {
    throw new Error(`Unrecognized ${label} version list.`);
  }
  return values;
}

function conditions(source, expression, field, label) {
  const condition = one(source, expression, label);
  return condition.split(/\s*\|\|\s*/).map(term => {
    const escaped = field.replaceAll(".", "\\.");
    const match = new RegExp(`^\\s*${escaped}\\s*===\\s*"(\\d+\\.\\d+\\.\\d+)"\\s*$`).exec(term);
    if (!match) throw new Error(`Unrecognized ${label} condition.`);
    return match[1];
  });
}

export function runtimeHostSupportErrors(root, policy) {
  const errors = [];
  const required = [...new Set([policy.currentTarget, ...policy.retainedTargets].map(name => policy.targets[name].emdash))];
  const read = file => readFileSync(path.join(root, sourceRoot, file), "utf8");
  const check = (label, extract) => {
    try {
      const allowed = extract();
      for (const version of required) if (!allowed.includes(version)) errors.push(`${label}: declared EmDash ${version} is not supported by this runtime gate.`);
    } catch (error) { errors.push(`${label}: ${error.message}`); }
  };
  for (const [file, name] of [["sitemap-installation.ts", "SITEMAP_NATIVE_HOST_VERSIONS"],
    ["robots-installation.ts", "ROBOTS_NATIVE_HOST_VERSIONS"], ["llms-txt-installation.ts", "LLMS_TXT_NATIVE_HOST_VERSIONS"]]) {
    check(name, () => versions(one(read(file), new RegExp(`export const ${name}: readonly string\\[\\] = (\\[[^\\]]*\\]);`, "g"), name), name));
  }
  check("VERIFICATION_MERGING_HOSTS", () => versions(one(read("site-verification.ts"),
    /const VERIFICATION_MERGING_HOSTS: ReadonlySet<string> = new Set\((\[[^\]]*\])\);/g,
    "VERIFICATION_MERGING_HOSTS"), "VERIFICATION_MERGING_HOSTS"));
  check("coexistence middleware", () => conditions(read("astro.ts"),
    /if\s*\(([^)]+)\)\s*\{\s*params\.addMiddleware\(\{\s*entrypoint:\s*COEXISTENCE_MIDDLEWARE_ENTRYPOINT,/g,
    "emdashVersion", "coexistence middleware"));
  check("robots AI policy", () => conditions(read("robots-txt.ts"),
    /const disallowAiTraining\s*=\s*\(([^)]+)\)\s*&&\s*policy\.disallowAiTraining\s*===\s*true;/g,
    "policy.hostVersion", "robots AI policy"));
  check("ROBOTS_SETTINGS_ROLE_GATES", () => {
    const body = one(read("admin-ui/robots-txt-model.ts"),
      /const ROBOTS_SETTINGS_ROLE_GATES:[^=]+?=\s*\{([\s\S]*?)\n\};/g, "ROBOTS_SETTINGS_ROLE_GATES");
    const entry = /"(\d+\.\d+\.\d+)":\s*\{\s*read:\s*\d+,\s*manage:\s*\d+\s*\},?/g;
    const values = [...body.matchAll(entry)].map(match => match[1]);
    if (!values.length || body.replace(entry, "").trim()) throw new Error("Unrecognized role-gate entries.");
    return values;
  });
  check("host patch regression coverage", () => versions(one(read("host-patch-compatibility.selfcheck.ts"),
    /for\s*\(const version of (\[[^\]]*\])\)\s*\{\s*const sitemap\s*=/g,
    "host patch regression coverage"), "host patch regression coverage"));
  return errors;
}
