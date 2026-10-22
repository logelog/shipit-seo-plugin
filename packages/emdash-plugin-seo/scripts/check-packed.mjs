import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertBrandNeutralArtifact, assertPackedArtifact } from "./packed-artifact.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "shipit-seo-package-check-"));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}${result.stderr}`);
}

try {
  const packed = join(workspace, "packed");
  mkdirSync(packed);
  run("pnpm", ["--config.ignore-scripts=true", "pack", "--pack-destination", packed], packageRoot);
  const tarballs = readdirSync(packed).filter((name) => name.endsWith(".tgz"));
  assert.equal(tarballs.length, 1);

  const sourceManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const packageName = sourceManifest.name;
  assert.match(packageName, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
  const packageDirectory = join(workspace, "node_modules", ...packageName.split("/"));
  mkdirSync(packageDirectory, { recursive: true });
  run("tar", ["-xzf", join(packed, tarballs[0]), "-C", packageDirectory, "--strip-components=1"], workspace);

  const manifest = assertPackedArtifact(packageDirectory);
  assertBrandNeutralArtifact(packageDirectory);
  assert.equal(manifest.name, packageName);
  assert.equal(manifest.version, sourceManifest.version);
  for (const document of ["README.md", "UPGRADE.md", "INSTALL-PROMPT.md"]) {
    const installs = [...readFileSync(join(packageDirectory, document), "utf8").matchAll(/@shipitseo\/emdash-plugin-seo@([0-9A-Za-z.+-]*[0-9A-Za-z])/g)];
    assert.ok(installs.length > 0, `${document} names the version to install`);
    for (const [, version] of installs) assert.equal(version, manifest.version, `${document} installs the packed version`);
  }
  assert.equal(manifest.main, "./dist/index.js");
  const adminEntry = readFileSync(join(packageDirectory, manifest.exports["./admin"].default), "utf8");
  assert.match(adminEntry, /import "\.\/admin\.css";/);
  assert.equal(existsSync(join(packageDirectory, "dist/admin-ui/admin.css")), true);

  writeFileSync(join(workspace, "consumer.mjs"), `
import assert from "node:assert/strict";
import { normalizeSeoSitemapPath } from ${JSON.stringify(`${packageName}/sitemap-policy`)};
import { taxonomyArchiveName, taxonomyArchivePage } from ${JSON.stringify(`${packageName}/taxonomy-archives`)};
const resolved = import.meta.resolve(${JSON.stringify(`${packageName}/sitemap-policy`)});
assert.ok(resolved.startsWith(new URL(${JSON.stringify(`./node_modules/${packageName}/dist/`)}, import.meta.url).href));
assert.equal(normalizeSeoSitemapPath("/known/"), "/known");
const archiveExport = import.meta.resolve(${JSON.stringify(`${packageName}/taxonomy-archives`)});
assert.ok(archiveExport.startsWith(new URL(${JSON.stringify(`./node_modules/${packageName}/dist/`)}, import.meta.url).href));
const page = taxonomyArchivePage({ url: "https://example.com/category/bread", path: "/category/bread", locale: "en",
  kind: "custom", pageType: "website", title: "Bread", description: null, canonical: null, image: null }, "category");
assert.equal(taxonomyArchiveName(page), "category");
`);
  run(process.execPath, [join(workspace, "consumer.mjs")], workspace);
  console.log("Packed SEO exports resolve from dist without source files.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
