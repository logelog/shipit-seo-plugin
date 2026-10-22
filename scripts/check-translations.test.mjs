import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SEO_CATALOGUES } from "../packages/emdash-plugin-seo/src/admin-ui/i18n/messages.ts";
import { checkSeoTranslations } from "./check-translations.mjs";

function fixture(t, registry = { en: SEO_CATALOGUES.en }) {
  const directory = mkdtempSync(join(tmpdir(), "shipit-seo-translations-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (locale, catalogue) => writeFileSync(join(directory, locale + ".json"), JSON.stringify(catalogue));
  for (const [locale, catalogue] of Object.entries(registry)) write(locale, catalogue);
  return { directory, registry, write };
}

test("accepts an additional registered locale without changing a test allowlist", (t) => {
  const f = fixture(t, { en: SEO_CATALOGUES.en, de: { ...SEO_CATALOGUES.en } });
  assert.deepEqual(checkSeoTranslations(f.directory, f.registry), { errors: [], locales: ["de", "en"] });
});

test("rejects a catalogue that would never enter the runtime bundle", (t) => {
  const f = fixture(t);
  f.write("de", SEO_CATALOGUES.en);
  assert.match(checkSeoTranslations(f.directory, f.registry).errors.join("\n"), /de.json: add its import/);
});

test("rejects registered catalogues without a matching file", (t) => {
  const f = fixture(t);
  assert.deepEqual(checkSeoTranslations(f.directory, { ...f.registry, de: SEO_CATALOGUES.en }).errors,
    ["de: registered catalogue file is missing"]);
});

test("rejects a locale filename whose casing cannot match the normalized admin locale", (t) => {
  const f = fixture(t, { en: SEO_CATALOGUES.en, "pt-br": SEO_CATALOGUES.en });
  assert.deepEqual(checkSeoTranslations(f.directory, f.registry).errors,
    ["pt-br.json: use the canonical locale filename"]);
});

test("rejects an invalid locale filename", (t) => {
  const f = fixture(t, { en: SEO_CATALOGUES.en, not_a_locale: SEO_CATALOGUES.en });
  assert.deepEqual(checkSeoTranslations(f.directory, f.registry).errors,
    ["not_a_locale.json: invalid locale filename"]);
});

test("rejects missing strings, changed parameters and unknown message keys", (t) => {
  const catalogue = { ...SEO_CATALOGUES.en, "nav.view.overview": "", "nav.destinations": "{wrong}", extra: "unused" };
  const f = fixture(t, { en: SEO_CATALOGUES.en, de: catalogue });
  assert.deepEqual(checkSeoTranslations(f.directory, f.registry).errors, [
    "de.json: nav.view.overview: missing string",
    "de.json: nav.destinations: named placeholders differ",
    "de.json: extra: unknown key",
  ]);
});

test("reports malformed JSON without printing its values", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.directory, "de.json"), "{broken");
  assert.deepEqual(checkSeoTranslations(f.directory, f.registry).errors, ["de.json: invalid JSON"]);
});

test("rejects catalogue symlinks", (t) => {
  const f = fixture(t);
  symlinkSync("en.json", join(f.directory, "de.json"));
  assert.deepEqual(checkSeoTranslations(f.directory, f.registry).errors,
    ["de.json: catalogue must be a regular file"]);
});

test("rejects a registry entry pointing at a different catalogue", (t) => {
  const f = fixture(t, { en: SEO_CATALOGUES.en, de: { ...SEO_CATALOGUES.en } });
  assert.deepEqual(checkSeoTranslations(f.directory, {
    ...f.registry, de: { ...SEO_CATALOGUES.en, "nav.view.overview": "Different" },
  }).errors, ["de.json: registered values differ from this catalogue"]);
});

test("requires the English source catalogue", (t) => {
  const f = fixture(t, {});
  assert.deepEqual(checkSeoTranslations(f.directory, {}).errors, ["en.json: canonical catalogue is missing"]);
});
