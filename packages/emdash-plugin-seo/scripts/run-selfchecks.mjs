import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const files = ["", "admin-ui/"].flatMap((directory) =>
  readdirSync(new URL(`../src/${directory}`, import.meta.url))
    .filter((file) => file.endsWith(".selfcheck.ts"))
    .map((file) => `${directory}${file}`),
).sort();

for (const file of files) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL(`../src/${file}`, import.meta.url)),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`SEO self-checks passed (${files.length} files).`);
