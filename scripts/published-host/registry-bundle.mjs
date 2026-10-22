import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEnvironment, readManifest, sourceRoot } from "./environment.mjs";

// Bundles the registry candidate with the target's pinned plugin CLI. The staged
// manifest carries placeholder release identity that only `bundle` accepts;
// publishing requires the owner's real publisher, license and contacts.
const LOCAL_RELEASE_IDENTITY = {
  publisher: "example.com",
  license: "LicenseRef-Local-Bundle-Check",
  author: { name: "Local bundle check" },
  security: { url: "https://example.com/security" },
};

const environment = createEnvironment();
environment.assertVersions();
if (!environment.target.versions.has("@emdash-cms/plugin-cli")) {
  throw new Error(`${environment.target.name} does not pin @emdash-cms/plugin-cli; select a registry-capable target`);
}
const stateRoot = environment.target.stateRoot;
const staging = new URL("registry-plugin/", stateRoot);
const tarballs = new URL("registry-tarball/", stateRoot);
const bundleRoot = new URL("registry-bundle/", stateRoot);
for (const directory of [staging, tarballs, bundleRoot]) rmSync(directory, { recursive: true, force: true });
mkdirSync(new URL("src/", staging), { recursive: true });
mkdirSync(tarballs, { recursive: true });
mkdirSync(bundleRoot, { recursive: true });

const { seoRegistryManifest } = await import(new URL("packages/emdash-plugin-seo/src/registry-manifest.ts", sourceRoot).href);
const entry = fileURLToPath(new URL("packages/emdash-plugin-seo/src/registry-entry.ts", sourceRoot));
writeFileSync(new URL("emdash-plugin.jsonc", staging), `${JSON.stringify({ ...seoRegistryManifest(), ...LOCAL_RELEASE_IDENTITY }, null, 2)}\n`);
writeFileSync(new URL("src/plugin.ts", staging), `export { default } from ${JSON.stringify(entry)};\n`);

const cliRoot = environment.hostPackageRoot("@emdash-cms/plugin-cli");
const bin = readManifest(cliRoot).bin?.["emdash-plugin"];
if (typeof bin !== "string") throw new Error("The pinned plugin CLI has no emdash-plugin binary");
const bundle = spawnSync(process.execPath, [
  fileURLToPath(new URL(bin, cliRoot)), "bundle", "--dir", fileURLToPath(staging), "--out-dir", fileURLToPath(tarballs),
], { cwd: fileURLToPath(staging), stdio: "inherit" });
if (bundle.error) throw bundle.error;
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

const [tarball] = readdirSync(tarballs).filter(name => name.endsWith(".tar.gz"));
if (!tarball) throw new Error("The plugin CLI did not write a bundle tarball");
const extract = spawnSync("tar", ["-xzf", fileURLToPath(new URL(tarball, tarballs)), "-C", fileURLToPath(bundleRoot)], { stdio: "inherit" });
if (extract.status !== 0) process.exit(extract.status ?? 1);

const files = readdirSync(bundleRoot, { recursive: true })
  .filter(name => statSync(new URL(name, bundleRoot)).isFile())
  .map(name => ({ name, bytes: statSync(new URL(name, bundleRoot)).size }))
  .sort((left, right) => left.name.localeCompare(right.name));
const manifest = JSON.parse(readFileSync(new URL("manifest.json", bundleRoot), "utf8"));
const report = {
  target: environment.target.name,
  cli: readManifest(cliRoot).version,
  tarball,
  compressedBytes: statSync(new URL(tarball, tarballs)).size,
  decompressedBytes: files.reduce((total, file) => total + file.bytes, 0),
  files,
  manifest: { id: manifest.id, version: manifest.version, capabilities: manifest.capabilities, routes: manifest.routes, editorPanels: manifest.admin?.editorPanels },
};
mkdirSync(environment.target.outputRoot, { recursive: true });
writeFileSync(new URL("registry-bundle.json", environment.target.outputRoot), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
