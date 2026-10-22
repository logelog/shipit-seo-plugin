import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalPackages, seoPackageName } from "./environment.mjs";

const name = process.argv[2];
const root = canonicalPackages.get(seoPackageName);
if (!root || (name !== seoPackageName && name !== "@shipit/emdash-plugin-seo" && name !== "admin-ui"))
  throw new Error("Select SEO engine or admin-ui selfchecks");
const directory = name === "admin-ui" ? "src/admin-ui/" : "src/";
const files = readdirSync(new URL(directory, root))
  .filter(file => file.endsWith(".selfcheck.ts"))
  .sort()
  .map(file => `${directory}${file}`);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL(file, root))], { cwd: fileURLToPath(root), stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`${name}: ${files.length} selfcheck files passed.`);
