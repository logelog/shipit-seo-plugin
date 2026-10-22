import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { assertBrandNeutralArtifact, assertPackedArtifact, shippedBrandLeaks } from "./packed-artifact.mjs";

function artifact(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "shipit-seo-artifact-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const manifest = {
    name: "@shipitseo/emdash-plugin-seo",
    version: "0.4.0-beta.1",
    private: true,
    type: "module",
    main: "./dist/index.js",
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    scripts: { prepack: "npm run build" },
    ...overrides,
  };
  write("package.json", JSON.stringify(manifest));
  write("dist/index.js", "export const name = 'Shipit SEO';\n");
  write("dist/index.d.ts", "export declare const name: string;\n");
  write("README.md", "# Shipit SEO\n\n[Install](INSTALL-PROMPT.md#install)\n\n[EmDash](https://docs.emdashcms.com/)\n");
  write("INSTALL-PROMPT.md", "# Install\n");
  write("CHANGELOG.md", "# Changes\n");
  write("THIRD-PARTY-NOTICES.md", "Schema.org vocabulary data: CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/.\n");
  return { root, write, manifest };
}

test("a private candidate may be audited before its product license is chosen", (t) => {
  const { root, manifest } = artifact(t);
  assert.deepEqual(assertPackedArtifact(root), manifest);
});

test("a public unscoped beta includes its license and explicit publication settings", (t) => {
  const { root, write } = artifact(t, {
    name: "shipit-seo", private: false, license: "MIT",
    publishConfig: { access: "public", tag: "beta" },
  });
  write("LICENSE", "MIT License\n");
  write("UPGRADE.md", "# Upgrade\n\n[Install](INSTALL-PROMPT.md)\n");
  assert.equal(assertPackedArtifact(root).name, "shipit-seo");
});

for (const path of ["src/customer.ts", "scripts/setup.js", "docs/private.md", "dist/debug/route.js", "dist/model.selfcheck.js", "dist/admin.js.map"]) {
  test("rejects accidentally distributed " + path, (t) => {
    const { root, write } = artifact(t);
    write(path, "development-only\n");
    assert.throws(() => assertPackedArtifact(root), /Unexpected packed path|Development file|Unexpected compiled file/);
  });
}

test("rejects a symlink even when its filename is allowed", (t) => {
  const { root } = artifact(t);
  symlinkSync("index.js", join(root, "dist", "alias.js"));
  assert.throws(() => assertPackedArtifact(root), /symlink/);
});

test("rejects a compiled file with an inline source map", (t) => {
  const { root, write } = artifact(t);
  write("dist/index.js", "export {};\n//# sourceMappingURL=data:application/json;base64,e30=\n");
  assert.throws(() => assertPackedArtifact(root), /Source map/);
});

test("rejects a README link into the private development repository", (t) => {
  const { root, write } = artifact(t);
  write("README.md", "[Build instructions](https://github.com/example/private-workspace/blob/main/docs/setup.md)\n");
  assert.throws(() => assertPackedArtifact(root), /private reference/);
});

test("rejects a README link that is absent from the customer archive", (t) => {
  const { root, write } = artifact(t);
  write("README.md", "[Developer setup](docs/setup.md)\n");
  assert.throws(() => assertPackedArtifact(root), /missing from package/);
});

test("rejects a README reference link outside the customer archive", (t) => {
  const { root, write } = artifact(t);
  write("README.md", "[Setup][setup]\n\n[setup]: ../private.md\n");
  assert.throws(() => assertPackedArtifact(root), /escapes package/);
});

test("rejects missing export declarations and exports escaping dist", (t) => {
  const { root, write, manifest } = artifact(t);
  manifest.exports["."].types = "./dist/missing.d.ts";
  write("package.json", JSON.stringify(manifest));
  assert.throws(() => assertPackedArtifact(root), /types is missing/);
  manifest.exports["."].types = "./dist/../README.md";
  write("package.json", JSON.stringify(manifest));
  assert.throws(() => assertPackedArtifact(root), /escapes dist/);
});

test("rejects adding an install-time script to the published package", (t) => {
  const { root } = artifact(t, { scripts: { postinstall: "node setup.js" } });
  assert.throws(() => assertPackedArtifact(root), /must not run postinstall/);
});

test("rejects losing the Schema.org license notice", (t) => {
  const { root, write } = artifact(t);
  write("THIRD-PARTY-NOTICES.md", "Schema.org vocabulary data.\n");
  assert.throws(() => assertPackedArtifact(root), /license attribution is missing/);
});

test("a public candidate cannot pass without product licensing and the beta tag", (t) => {
  const { root, write, manifest } = artifact(t, { private: false });
  assert.throws(() => assertPackedArtifact(root), /needs a license/);
  manifest.license = "MIT";
  write("package.json", JSON.stringify(manifest));
  assert.throws(() => assertPackedArtifact(root), /needs LICENSE/);
  write("LICENSE", "MIT License\n");
  manifest.publishConfig = { access: "public", tag: "latest" };
  write("package.json", JSON.stringify(manifest));
  assert.throws(() => assertPackedArtifact(root), /must use the beta tag/);
  manifest.publishConfig.tag = "beta";
  write("package.json", JSON.stringify(manifest));
  assert.throws(() => assertPackedArtifact(root), /Missing customer file: UPGRADE\.md/);
  write("UPGRADE.md", "# Upgrade\n");
  assert.equal(assertPackedArtifact(root).private, false);
});

test("historical beta.1 through beta.14 artifacts remain readable without a removal guide", (t) => {
  for (let beta = 1; beta <= 14; beta++) {
    const { root, manifest } = artifact(t, { version: "0.4.0-beta." + beta });
    assert.deepEqual(assertPackedArtifact(root), manifest);
  }
});

test("beta.15 includes a removal guide with packaged links", (t) => {
  const { root, write, manifest } = artifact(t, { version: "0.4.0-beta.15" });
  write("README.md", "# Shipit SEO\n\n[Remove](UNINSTALL-PROMPT.md#remove)\n");
  write("UNINSTALL-PROMPT.md", "# Remove\n\n[Install](INSTALL-PROMPT.md)\n");
  assert.deepEqual(assertPackedArtifact(root), manifest);
});

for (const version of [
  "0.4.0-beta.15", "0.4.0-beta.16", "0.4.0", "0.5.0-beta.1",
  "0.4.0-beta.0", "0.4.0-beta.01", "0.4.0-beta.14.1",
]) {
  test(version + " requires the removal guide", (t) => {
    const { root } = artifact(t, { version });
    assert.throws(() => assertPackedArtifact(root), /Missing customer file: UNINSTALL-PROMPT\.md/);
  });
}

for (const [label, link, error] of [
  ["into the private repository", "https://github.com/example/private-workspace/blob/main/docs/recovery.md", /UNINSTALL-PROMPT\.md contains a private reference/],
  ["outside the package", "../private.md", /Customer link escapes package/],
  ["to a missing packaged file", "recovery.md", /Customer link is missing from package/],
  ["with an unsupported scheme", "vscode:recovery", /Unsupported customer link in UNINSTALL-PROMPT\.md/],
]) {
  test("rejects a removal guide link " + label, (t) => {
    const { root, write } = artifact(t, { version: "0.4.0-beta.15" });
    write("UNINSTALL-PROMPT.md", "# Remove\n\n[Recovery](" + link + ")\n");
    assert.throws(() => assertPackedArtifact(root), error);
  });
}

for (const version of ["0.4.0-beta.38", "0.4.0-beta.39"]) {
  test("historical private " + version + " remains readable without an upgrade guide", (t) => {
    const { root, write, manifest } = artifact(t, { version });
    write("UNINSTALL-PROMPT.md", "# Remove\n");
    assert.deepEqual(assertPackedArtifact(root), manifest);
  });
}

for (const privateValue of [false, undefined]) {
  test("a candidate with private=" + privateValue + " requires its packaged upgrade guide", (t) => {
    const { root, write, manifest } = artifact(t, {
      version: "0.4.0-beta.39", private: privateValue, license: "MIT",
      publishConfig: { access: "public", tag: "beta" },
    });
    write("LICENSE", "MIT License\n");
    write("UNINSTALL-PROMPT.md", "# Remove\n");
    assert.throws(() => assertPackedArtifact(root), /Missing customer file: UPGRADE\.md/);
    write("UPGRADE.md", "# Upgrade\n\n[Install](INSTALL-PROMPT.md)\n[Remove](UNINSTALL-PROMPT.md)\n");
    assert.deepEqual(assertPackedArtifact(root), JSON.parse(JSON.stringify(manifest)));
  });
}

for (const [label, link, error] of [
  ["into the private repository", "https://github.com/example/private-workspace/blob/main/docs/update.md", /UPGRADE\.md contains a private reference/],
  ["outside the package", "../releasing.md", /Customer link escapes package/],
  ["to a missing packaged file", "releasing.md", /Customer link is missing from package/],
  ["with an unsupported scheme", "vscode:upgrade", /Unsupported customer link in UPGRADE\.md/],
]) {
  test("rejects an upgrade guide link " + label, (t) => {
    const { root, write } = artifact(t, { version: "0.4.0-beta.39" });
    write("UNINSTALL-PROMPT.md", "# Remove\n");
    write("UPGRADE.md", "# Upgrade\n\n[Update](" + link + ")\n");
    assert.throws(() => assertPackedArtifact(root), error);
  });
}

const region = (path, body) => "//#region " + path + "\n" + body + "\n//#endregion\n";

test("shipped text may name the product only in its default name and the stored-text cleaning table", () => {
  const allowed = [
    region("src/branding.ts", 'const SEO_DEFAULT_BRAND_NAME = "SHIPIT SEO";'),
    region("src/legacy-brand-text.ts", 'const LEGACY_BRAND_PHRASES = [["Shipit guidance", "checklist guideline"]];\nconst LEGACY_BRAND_NAME = /\\b(Shipit SEO|Shipit)(\'s)?(?![\\w-])/g;'),
    region("src/admin-ui/workspace-shell.tsx", "/** The Shipit SEO rail. */\nfunction ShipitLogo() { return isShipitKeyRouteFile; } // Shipit comment\nconst label = `${name} is disabled`;"),
  ].join("");
  assert.deepEqual(shippedBrandLeaks(allowed, "dist/admin-ui/admin.js"), []);
});

for (const [label, body, path] of [
  ["a sentence in a view", 'const title = "Shipit SEO settings cannot be read";', "src/admin-ui/admin.tsx"],
  ["a compiled JSX heading", 'jsx("h1", { children: "SHIPIT SEO" });', "src/admin-ui/workspace-shell.tsx"],
  ["a template literal", "const text = `${count} pages use Shipit's defaults`;", "src/sandbox-entry.ts"],
  ["text after a template expression", "const text = `${count} ${`nested ${x}`} Shipit adds`;", "src/sandbox-entry.ts"],
  ["a catalogue value", 'var en_default = { "plugin.disabled.title": "Shipit SEO is disabled" };', "src/admin-ui/i18n/catalogues/en.json"],
  ["the default name outside its module", 'const label = "SHIPIT SEO";', "src/index.ts"],
  ["a longer text in the default name module", 'const label = "SHIPIT SEO admin";', "src/branding.ts"],
  ["a string after a regular expression that holds a quote", 'const quote = /"/g; const text = "Shipit adds";', "src/lib.ts"],
  ["a string after a division", "const half = total / 2; const text = 'Shipit adds'; const other = 1 / 3;", "src/lib.ts"],
]) {
  test("rejects the product name in " + label, () => {
    const leaks = shippedBrandLeaks(region(path, body), "dist/index.js");
    assert.equal(leaks.length, 1, leaks.join("\n"));
    assert.match(leaks[0], /product name in shipped text/);
  });
}

test("rejects the product name in shipped styles and outside any module region", () => {
  assert.equal(shippedBrandLeaks('/* Shipit comment */ .a::after { content: "Shipit SEO"; }', "dist/admin-ui/admin.css").length, 1);
  assert.equal(shippedBrandLeaks('export const name = "Shipit SEO";\n', "dist/index.js").length, 1);
});

test("the packed archive check reads every compiled file", (t) => {
  const { root, write } = artifact(t);
  assert.throws(() => assertBrandNeutralArtifact(root), /Product name in shipped text:\ndist\/index\.js:1/);
  write("dist/index.js", region("src/index.ts", "export const name = 'SEO';"));
  write("dist/admin-ui/admin.js", region("src/admin-ui/admin.tsx", "const title = 'Settings';"));
  write("dist/admin-ui/admin.css", ".a { color: red; }\n");
  write("dist/index.d.ts", "/** Shipit SEO types. */ export declare const name: \"Shipit SEO\";\n");
  assertBrandNeutralArtifact(root);
  write("dist/admin-ui/admin.js", region("src/admin-ui/admin.tsx", "const title = 'Shipit SEO';"));
  assert.throws(() => assertBrandNeutralArtifact(root), /dist\/admin-ui\/admin\.js:2 \(src\/admin-ui\/admin\.tsx\)/);
});
