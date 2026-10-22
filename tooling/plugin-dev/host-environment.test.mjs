import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { reviewOutputRoot, selectHostTarget, sourceRoot } from "../../scripts/published-host/environment.mjs";

test("the default development target uses the single published native host", () => {
  const target = selectHostTarget();
  assert.equal(target.name, "native-1.3.0");
  assert.equal(selectHostTarget("native-1.3.0").fixtureRoot.href, target.fixtureRoot.href);
  assert.equal(target.versions.get("emdash"), "1.3.0");
  assert.equal(target.versions.get("@emdash-cms/admin"), "1.3.0");
  assert.equal(target.versions.get("astro"), "7.3.2");
  assert.equal(target.port, 4364);
  assert.equal(target.stateRoot.href, new URL(".dev/native-host-1.3.0/", sourceRoot).href);
  assert.equal(target.outputRoot.href, new URL("artifacts/native-host-1.3.0/", sourceRoot).href);
  const manifest = JSON.parse(readFileSync(new URL("package.json", target.fixtureRoot), "utf8"));
  assert.equal(manifest.dependencies.emdash, "1.3.0");
  assert.equal(manifest.dependencies["@emdash-cms/admin"], "1.3.0");
  for (const name of ["published-1.0.1", "native-1.1.0", "native-1.2.0", "native-9.9.9"]) {
    assert.throws(() => selectHostTarget(name), /Unknown host target/);
  }
});

test("detail receipts stay inside the canonical target's artifact directory", () => {
  const target = selectHostTarget();
  assert.equal(reviewOutputRoot(target).href, target.outputRoot.href);
  for (const path of ["sitemaps-review/native-sql-smoke.json", "schema-library-review/packed-consumer.json"]) {
    assert.equal(new URL(path, reviewOutputRoot(target)).href, new URL("artifacts/native-host-1.3.0/" + path, sourceRoot).href);
  }
});

test("the committed development dependency graph remains frozen", () => {
  const expected = [
    [
      "integration/emdash/published-host-1.3.0/package.json",
      "d7ffd9c0c85dacf18247ed4b0b93701630569b20158ee994d14a5c01d4e3a9c3"
    ],
    [
      "integration/emdash/published-host-1.3.0/pnpm-lock.yaml",
      "92b03eee802e42fdf5b8d47f31837ac6d6c9ec012a778a672b9b8a60876705c9"
    ],
    [
      "integration/emdash/published-host-1.3.0/pnpm-workspace.yaml",
      "6ac3ad5a577f237ebae4bb8ae0705a1118b7a2793e4294f7a45b93eeae1a005f"
    ]
  ];
  for (const [path, expectedHash] of expected) {
    const actual = createHash("sha256").update(readFileSync(new URL(path, sourceRoot))).digest("hex");
    assert.equal(actual, expectedHash, path);
  }
});

test("the 1.3 preview admits development shortcuts only at its own development origin", async () => {
  const target = selectHostTarget("native-1.3.0");
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
      for (const origin of ["http://127.0.0.1:4364", "http://127.0.0.1:4363", "http://localhost:4364", "https://example.com"]) {
        const result = await onRequest({ url: new URL(path, origin) }, next);
        assert.equal(result.status, development && origin === "http://127.0.0.1:" + target.port ? 200 : 403);
      }
    }
    assert.equal((await onRequest({ url: new URL("https://example.com/ordinary-page") }, next)).status, 200);
  }
});

test("the 1.3 source preview targets its declared host and the exact current admin export", () => {
  const target = selectHostTarget("native-1.3.0");
  for (const name of ["astro.native.config.mjs", "astro.native-admin.config.mjs"]) {
    const source = readFileSync(new URL(name, target.fixtureRoot), "utf8");
    assert.equal(source.match(/environment\.target\.name !== "([^"]+)"/)?.[1], target.name, name);
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
});
