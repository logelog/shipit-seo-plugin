import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readCompatibility } from "../../scripts/compatibility.mjs";
import { assertVerificationMode, defaultHostTarget, reviewOutputRoot, selectHostTarget, sourceRoot } from "../../scripts/published-host/environment.mjs";
import { main, readConfig } from "./cli.mjs";

const repository = fileURLToPath(sourceRoot);
const policy = readCompatibility(sourceRoot);
const targetNames = Object.keys(policy.targets);

test("the current and retained development targets use their declared published hosts", () => {
  assert.equal(defaultHostTarget, policy.currentTarget);
  assert.equal(selectHostTarget().name, process.env.SHIPIT_HOST_TARGET || policy.currentTarget);
  for (const name of targetNames) {
    const record = policy.targets[name];
    const target = selectHostTarget(name);
    assert.equal(target.name, name);
    assert.equal(target.versions.get("emdash"), record.emdash);
    assert.equal(target.versions.get("@emdash-cms/admin"), record.admin);
    assert.equal(target.versions.get("astro"), policy.toolchain.astro);
    assert.equal(target.port, record.port);
    assert.equal(target.fixtureRoot.href, new URL(record.dependencyRoot + "/", sourceRoot).href);
    const manifest = JSON.parse(readFileSync(new URL("package.json", target.fixtureRoot), "utf8"));
    assert.equal(manifest.dependencies.emdash, record.emdash);
    assert.equal(manifest.dependencies["@emdash-cms/admin"], record.admin);
    assert.equal(manifest.dependencies.astro, policy.toolchain.astro);
    assert.equal(manifest.packageManager, "pnpm@" + policy.toolchain.pnpm);
    const config = readConfig(repository, name);
    assert.equal(config.host.target, name);
    assert.equal(config.dependencyRoot, record.dependencyRoot);
    assert.equal(config.expectedPackages.emdash, record.emdash);
    assert.equal(config.ports[0].port, record.port);
    assert.deepEqual(config.tasks.quick[1].args.slice(-3), ["--target", name, "--quick"]);
    assert.equal(config.tasks.setup[0].cwd, record.dependencyRoot);
    assert.equal(config.sourceDirectories.some(directory => directory.includes("{fixture}")), false);
  }
  assert.equal(readConfig(repository).host.target, policy.currentTarget);
  for (const name of ["published-1.0.1", "native-1.1.0", "native-1.2.0", "native-9.9.9"]) {
    assert.throws(() => selectHostTarget(name), /Unknown host target/);
  }
});

test("detail receipts stay inside each selected target's artifact directory", () => {
  for (const name of targetNames) {
    const target = selectHostTarget(name);
    assert.equal(reviewOutputRoot(target).href, target.outputRoot.href);
    for (const path of ["sitemaps-review/native-sql-smoke.json", "schema-library-review/packed-consumer.json"]) {
      assert.equal(new URL(path, reviewOutputRoot(target)).href,
        new URL("artifacts/native-host-" + policy.targets[name].emdash + "/" + path, sourceRoot).href);
    }
  }
});

test("the retained development dependency graph remains frozen", () => {
  const expected = [
    ["integration/emdash/published-host-1.3.0/package.json", "d7ffd9c0c85dacf18247ed4b0b93701630569b20158ee994d14a5c01d4e3a9c3"],
    ["integration/emdash/published-host-1.3.0/pnpm-lock.yaml", "92b03eee802e42fdf5b8d47f31837ac6d6c9ec012a778a672b9b8a60876705c9"],
    ["integration/emdash/published-host-1.3.0/pnpm-workspace.yaml", "6ac3ad5a577f237ebae4bb8ae0705a1118b7a2793e4294f7a45b93eeae1a005f"],
  ];
  for (const [path, expectedHash] of expected) {
    const actual = createHash("sha256").update(readFileSync(new URL(path, sourceRoot))).digest("hex");
    assert.equal(actual, expectedHash, path);
  }
});

test("declared registry fixture locks keep reviewed identities without local archives", () => {
  for (const name of targetNames) {
    const record = policy.targets[name];
    const lock = readFileSync(new URL(record.dependencyRoot + "/pnpm-lock.yaml", sourceRoot));
    assert.equal(createHash("sha256").update(lock).digest("hex"), record.reviewedLockSha256, name);
    assert.equal(/\bfile:/.test(lock.toString()), false, name);
  }
});

test("unqualified full verification fails before dependency or output work", async () => {
  for (const name of targetNames) {
    const target = selectHostTarget(name);
    assert.doesNotThrow(() => assertVerificationMode(target, "quick"));
    if (!policy.targets[name].verifyModes.includes("full")) {
      assert.throws(() => assertVerificationMode(target, "full"), /full verification is not implemented/);
      await assert.rejects(main(["verify", "--target", name], repository), /full verification is not implemented/);
    }
  }
});

test("each preview admits development shortcuts only at its own development origin", async () => {
  for (const name of targetNames) {
    const target = selectHostTarget(name);
    const source = readFileSync(new URL("src-native/middleware.ts", target.fixtureRoot), "utf8");
    const middlewareImport = 'import { defineMiddleware } from "astro:middleware";';
    assert.equal(source.split(middlewareImport).length, 2);
    assert.equal(source.split("import.meta.env.DEV").length, 2);
    for (const development of [false, true]) {
      const body = source.replace(middlewareImport, "const defineMiddleware = callback => callback;")
        .replace("import.meta.env.DEV", String(development));
      const { onRequest } = await import("data:text/javascript," + encodeURIComponent(body));
      const next = () => new Response("next");
      for (const path of ["/_emdash/api/auth/dev-bypass", "/_emdash/api/setup/dev-complete"]) {
        for (const origin of ["http://127.0.0.1:" + target.port, "http://127.0.0.1:4363", "http://localhost:" + target.port, "https://example.com"]) {
          const result = await onRequest({ url: new URL(path, origin) }, next);
          assert.equal(result.status, development && origin === "http://127.0.0.1:" + target.port ? 200 : 403);
        }
      }
      assert.equal((await onRequest({ url: new URL("https://example.com/ordinary-page") }, next)).status, 200);
    }
  }
});

test("each source preview selects its own host and the exact current admin export", () => {
  for (const name of targetNames) {
    const target = selectHostTarget(name);
    for (const file of ["astro.native.config.mjs", "astro.native-admin.config.mjs"]) {
      const source = readFileSync(new URL(file, target.fixtureRoot), "utf8");
      assert.equal(source.match(/environment\.target\.name !== "([^"]+)"/)?.[1], target.name, file);
    }
    const source = readFileSync(new URL("astro.native-admin.config.mjs", target.fixtureRoot), "utf8");
    const expression = source.match(/find: (\/.*\/), replacement:/)?.[1];
    assert.ok(expression, "the source alias declares a regular expression");
    const alias = Function("return (" + expression + ");")();
    const manifest = JSON.parse(readFileSync(new URL("packages/emdash-plugin-seo/package.json", sourceRoot), "utf8"));
    assert.equal(alias.test(manifest.name + "/admin"), true);
    for (const specifier of ["@shipit/emdash-plugin-seo/admin", manifest.name, manifest.name + "/admin-contract", manifest.name + "/admin/extra"]) {
      assert.equal(alias.test(specifier), false, specifier);
    }
  }
});
