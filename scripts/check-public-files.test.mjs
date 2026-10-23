import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkPublicFile, checkPublicFiles } from "./check-public-files.mjs";

for (const path of [".env", ".env.production", ".dev.vars", ".dev.vars.production", ".npmrc", "dev.sqlite", "dev.sqlite-wal", "backup.db", "package.tgz", "server.log"]) {
  test("rejects " + path, () => assert.match(checkPublicFile(path, "value").join("\n"), /local or sensitive file/));
}

test("permits source code and non-secret environment examples", () => {
  assert.deepEqual(checkPublicFile("src/index.ts", "export const value = 1;"), []);
  assert.deepEqual(checkPublicFile(".env.example", "PUBLIC_SITE_URL=https://example.com"), []);
});

test("rejects private directories and symlinks", () => {
  assert.match(checkPublicFile("docs/handoffs/context.md", "notes").join("\n"), /private development directory/);
  assert.match(checkPublicFile("src/link.ts", undefined, true).join("\n"), /symbolic link/);
});

test("detects token-shaped values without printing them", () => {
  const token = "ghp_" + "x".repeat(40);
  const errors = checkPublicFile("src/config.ts", token);
  assert.deepEqual(errors, ["src/config.ts: access token"]);
  assert.equal(errors.join().includes(token), false);
});

test("checks files staged with force even when gitignore excludes them", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shipit-public-files-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  git("init", "--quiet");
  writeFileSync(join(directory, ".gitignore"), ".env\n");
  writeFileSync(join(directory, ".env"), "VALUE=example");
  git("add", "--force", ".env");
  assert.match(checkPublicFiles(directory).errors.join("\n"), /\.env: local or sensitive file/);
});

test("detects local user paths and private key headers", () => {
  const path = ["", "home", "example", "work"].join("/");
  assert.deepEqual(checkPublicFile("src/config.ts", path), ["src/config.ts: local user path"]);
  assert.deepEqual(checkPublicFile("src/config.ts", "-----BEGIN " + "PRIVATE KEY-----"), ["src/config.ts: private key"]);
});

test("allows synthetic local-file URL rejection fixtures", () => {
  assert.deepEqual(checkPublicFile("src/origin.selfcheck.ts", "file:" + "///tmp/example"), []);
});

test("rejects a force-staged provider variables file", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "shipit-public-vars-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  git("init", "--quiet");
  writeFileSync(join(directory, ".gitignore"), ".dev.vars*\n");
  writeFileSync(join(directory, ".dev.vars.production"), "VALUE=opaque");
  git("add", "--force", ".dev.vars.production");
  assert.match(checkPublicFiles(directory).errors.join("\n"), /\.dev\.vars\.production: local or sensitive file/);
});

test("NUL bytes cannot hide a token in a source file", () => {
  const token = "npm_" + "x".repeat(40);
  assert.deepEqual(checkPublicFile("src/config.ts", "\0" + token), [
    "src/config.ts: NUL byte in text file", "src/config.ts: access token",
  ]);
});

test("binary assets still receive sensitive text checks", () => {
  assert.deepEqual(checkPublicFile("docs/image.png", "\0binary"), []);
  assert.deepEqual(checkPublicFile("docs/image.png", "\0" + "npm_" + "x".repeat(40)), ["docs/image.png: access token"]);
});

test("published prose rejects fixed workstation admin links", () => {
  const previousBlock = "The fixture is integration/emdash/published-host-1.3.1; its preview is\n" +
    "http://127.0.0.1:4365/_emdash/admin.";
  for (const file of ["README.md", "docs/architecture.md", "packages/emdash-plugin-seo/README.md"]) {
    assert.deepEqual(checkPublicFile(file, previousBlock), [file + ": workstation admin URL in published prose"]);
  }
  for (const value of [
    "https://localhost:4396/_emdash/admin", "http://[::1]:4365/_emdash/admin",
    "http://[0:0:0:0:0:0:0:1]:4415/_emdash/admin", "http://127.1:3000/_emdash/api/content",
    "http://preview.localhost:4321/_emdash/admin", "http://0.0.0.0:8080/_emdash/admin",
  ]) assert.match(checkPublicFile("docs/install.md", value).join("\n"), /workstation admin URL/);
});

test("published prose rejects absolute workstation file paths", () => {
  const home = ["", "home", "example", "project"].join("/");
  const windows = ["C:", "work", "project"].join("\\");
  assert.match(checkPublicFile("README.md", home).join("\n"), /local user path/);
  assert.match(checkPublicFile("docs/install.md", windows).join("\n"), /absolute workstation path/);
  assert.match(checkPublicFile("README.md", "file:" + "///tmp/site").join("\n"), /absolute workstation path/);
});

test("portable localhost examples, relative routes and source fixtures remain valid", () => {
  for (const value of [
    "For example, http://localhost:4321/posts/example is a local development page.",
    "Use /_emdash/admin in your site's existing origin.",
    "https://www.npmjs.com/package/@shipitseo/emdash-plugin-seo",
    "https://github.com/logelog/shipit-seo-plugin",
    "Run the command from path/to/site.",
  ]) assert.deepEqual(checkPublicFile("docs/install.md", value), []);
  assert.deepEqual(checkPublicFile("src/origin.selfcheck.ts", "http://127.0.0.1:4365/_emdash/admin"), []);
});
