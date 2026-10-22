import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SEO_CATALOGUES,
  validateSeoCatalogue,
  validateSeoMessageParameters,
} from "../packages/emdash-plugin-seo/src/admin-ui/i18n/messages.ts";

const catalogueDirectory = fileURLToPath(new URL(
  "../packages/emdash-plugin-seo/src/admin-ui/i18n/catalogues/", import.meta.url,
));

export function checkSeoTranslations(directory = catalogueDirectory, registry = SEO_CATALOGUES) {
  const errors = [...validateSeoMessageParameters()];
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const locales = new Set();
  for (const entry of entries) {
    const locale = entry.name.slice(0, -5);
    locales.add(locale);
    if (!entry.isFile()) {
      errors.push(entry.name + ": catalogue must be a regular file");
      continue;
    }
    try {
      if (Intl.getCanonicalLocales(locale)[0] !== locale) {
        errors.push(entry.name + ": use the canonical locale filename");
      }
    } catch {
      errors.push(entry.name + ": invalid locale filename");
    }
    let catalogue;
    try {
      catalogue = JSON.parse(readFileSync(resolve(directory, entry.name), "utf8"));
    } catch {
      errors.push(entry.name + ": invalid JSON");
      continue;
    }
    errors.push(...validateSeoCatalogue(catalogue).map((error) => entry.name + ": " + error));
    if (!Object.hasOwn(registry, locale)) {
      errors.push(entry.name + ": add its import and SEO_CATALOGUES entry in i18n/messages.ts");
    } else if (!isDeepStrictEqual(registry[locale], catalogue)) {
      errors.push(entry.name + ": registered values differ from this catalogue");
    }
  }
  if (!locales.has("en")) errors.push("en.json: canonical catalogue is missing");
  for (const locale of Object.keys(registry)) {
    if (!locales.has(locale)) errors.push(locale + ": registered catalogue file is missing");
  }
  return { errors, locales: [...locales].sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = checkSeoTranslations();
    if (result.errors.length) {
      console.error(result.errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("Translation catalogues passed: " + result.locales.join(", ") + ".");
    }
  } catch (error) {
    console.error("Could not check translation catalogues: " + error.message);
    process.exitCode = 1;
  }
}
