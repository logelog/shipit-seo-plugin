import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";

import {
	SEO_CATALOGUES,
	createSeoI18n,
	formatSeoDate,
	formatSeoNumber,
	normalizeSeoLocale,
	resolveSeoLocale,
	seoMessagePlaceholders,
	validateSeoCatalogue,
	validateSeoMessageParameters,
} from "./i18n/messages.ts";
import type { SeoMessageKey } from "./i18n/messages.ts";

for (const locale of ["en", "tr", "nl"]) {
	assert.ok(Object.hasOwn(SEO_CATALOGUES, locale), locale + " remains registered");
}
assert.deepEqual(Object.keys(SEO_CATALOGUES).sort(),
	readdirSync(new URL("./i18n/catalogues/", import.meta.url))
		.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).sort(),
	"every contributed catalogue is registered in the runtime bundle");
for (const [locale, catalogue] of Object.entries(SEO_CATALOGUES)) {
	assert.deepEqual(validateSeoCatalogue(catalogue), [], locale + " keeps every English key and named parameter");
}
assert.deepEqual(validateSeoMessageParameters(), [], "typed argument declarations cover every English placeholder");
assert.deepEqual(seoMessagePlaceholders("{date} / {section} / {date}"), ["date", "section"]);

const { ["nav.view.overview"]: missingOverview, ...incomplete } = SEO_CATALOGUES.nl;
assert.equal(missingOverview, "Overzicht");
assert.deepEqual(validateSeoCatalogue(incomplete), ["nav.view.overview: missing string"]);
assert.deepEqual(validateSeoCatalogue({ ...SEO_CATALOGUES.tr, extra: "Unused" }), ["extra: unknown key"]);
assert.deepEqual(validateSeoCatalogue({ ...SEO_CATALOGUES.nl, "nav.destinations": "Pagina's van {sectie}" }), [
	"nav.destinations: named placeholders differ",
]);
assert.deepEqual(validateSeoCatalogue({ ...SEO_CATALOGUES.nl, "indexing.status.savedAt": "Opgeslagen" }), [
	"indexing.status.savedAt: named placeholders differ",
]);
assert.deepEqual(validateSeoCatalogue([]), ["Catalogue must be an object of plain strings."]);
assert.deepEqual(validateSeoCatalogue(null), ["Catalogue must be an object of plain strings."]);

assert.equal(normalizeSeoLocale(" TR-tr "), "tr-TR");
assert.equal(normalizeSeoLocale("nl-be"), "nl-BE");
for (const locale of [undefined, null, "", " ", "not_a_locale", "x".repeat(129)]) {
	assert.equal(normalizeSeoLocale(locale), "en");
	assert.equal(resolveSeoLocale(locale), "en");
}
const fallbackCatalogues = { en: SEO_CATALOGUES.en, tr: SEO_CATALOGUES.tr, nl: SEO_CATALOGUES.nl };
assert.equal(resolveSeoLocale("tr-TR", fallbackCatalogues), "tr");
assert.equal(resolveSeoLocale("nl-BE", fallbackCatalogues), "nl");
assert.equal(resolveSeoLocale("en-GB", fallbackCatalogues), "en");
assert.equal(resolveSeoLocale("fr-FR", fallbackCatalogues), "en");
assert.equal(createSeoI18n("nl-BE", fallbackCatalogues).locale, "nl-BE", "catalogue fallback retains the admin region for formatting");
assert.equal(createSeoI18n("fr-FR", fallbackCatalogues).t("nav.view.overview"), "Overview");
assert.equal(createSeoI18n("tr-TR", fallbackCatalogues).t("nav.view.overview"), "Genel bakış");
assert.equal(createSeoI18n("nl-BE", fallbackCatalogues).t("nav.view.overview"), "Overzicht");

const regionalCatalogues = {
	...SEO_CATALOGUES,
	"nl-BE": { "nav.view.overview": "Belgisch overzicht" },
};
assert.equal(resolveSeoLocale("nl-BE", regionalCatalogues), "nl-BE");
const regional = createSeoI18n("nl-BE", regionalCatalogues);
assert.equal(regional.t("nav.view.overview"), "Belgisch overzicht", "an exact registered pack wins");
assert.equal(regional.t("nav.view.site"), "Website", "a missing regional key uses its base pack");
const missing = createSeoI18n("nl", { nl: incomplete });
assert.equal(missing.t("nav.view.overview"), "Overview", "a missing base key retains English");
const malformed = createSeoI18n("nl", {
	nl: { "nav.destinations": "Pagina's van {wrong}", "nav.view.overview": " " },
});
assert.equal(malformed.t("nav.destinations", { section: "Settings" }), "Settings destinations");
assert.equal(malformed.t("nav.view.overview"), "Overview");
assert.equal(createSeoI18n("en").t("unknown.runtime.key" as SeoMessageKey), "unknown.runtime.key");

const english = createSeoI18n("en");
const turkish = createSeoI18n("tr");
const dutch = createSeoI18n("nl");
assert.equal(english.t("nav.attentionCount", { count: 1234 }), "Items needing attention: 1,234");
assert.equal(turkish.t("nav.attentionCount", { count: 1234 }), "İlgilenilmesi gereken öğe sayısı: 1.234");
assert.equal(dutch.t("nav.attentionCount", { count: 1234 }), "Items die aandacht nodig hebben: 1.234");
assert.equal(dutch.t("indexing.status.savedAt", { date: "2 januari 2026" }), "Opgeslagen op 2 januari 2026");
assert.equal(english.t("nav.destination"), "SEO page");
assert.equal(turkish.t("nav.chooseDestination"), "Sayfa seçin");
assert.equal(dutch.t("nav.indexingTools"), "Indexeringstools");
assert.equal(english.t("nav.view.site"), "Website");
assert.equal(turkish.t("nav.view.site"), "Web sitesi");
assert.equal(dutch.t("nav.view.site"), "Website");
assert.equal(english.t("nav.searchLabel"), "Find a setting");
assert.equal(turkish.t("nav.searchLabel"), "Ayar bul");
assert.equal(dutch.t("nav.searchLabel"), "Zoek een instelling");
assert.equal(english.t("nav.searchResults", { count: 1234 }), "Matching settings: 1,234");
assert.equal(turkish.t("nav.searchResults", { count: 1234 }), "Eşleşen ayarlar: 1.234");
assert.equal(dutch.t("nav.searchResults", { count: 1234 }), "Gevonden instellingen: 1.234");
assert.equal(english.t("nav.settingResult", { setting: english.t("nav.setting.excludedPaths"), page: english.t("nav.view.sitemap") }), "Excluded paths (Sitemaps)");
assert.equal(turkish.t("nav.settingResult", { setting: turkish.t("nav.setting.bingCode"), page: turkish.t("nav.view.verification") }), "Bing doğrulama kodu (Site doğrulaması)");
assert.equal(dutch.t("nav.settingResult", { setting: dutch.t("nav.setting.googleCode"), page: dutch.t("nav.view.verification") }), "Verificatiecode van Google (Siteverificatie)");
assert.equal(english.t("indexing.save"), "Save indexing rules");
assert.equal(dutch.t("indexing.save"), "Indexeringsregels opslaan");
assert.equal(turkish.t("indexing.save"), "Dizine ekleme kurallarını kaydet");
assert.deepEqual(validateSeoCatalogue({ ...SEO_CATALOGUES.tr, "nav.settingResult": "{setting}" }), ["nav.settingResult: named placeholders differ"]);
assert.equal(english.t("nav.attentionCount", { count: Number.NaN }), "Items needing attention: {count}");
assert.equal(english.t("nav.destinations", { section: "$& {count}" }), "$& {count} destinations", "parameter text is never a replacement template or a second interpolation");

const hostileText = '<img src="x" onerror="alert(1)"><script>alert(2)</script>';
const plainText = english.t("nav.destinations", { section: hostileText });
assert.equal(plainText, hostileText + " destinations");
const markup = renderToStaticMarkup(createElement("span", null, plainText));
assert.equal(markup, "<span>&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt; destinations</span>");
assert.equal(markup.includes("<img"), false);
assert.equal(markup.includes("<script"), false);
const literalMarkup = createSeoI18n("nl", { nl: { "nav.view.overview": "<strong>Overzicht</strong>" } });
assert.equal(renderToStaticMarkup(createElement("span", null, literalMarkup.t("nav.view.overview"))), "<span>&lt;strong&gt;Overzicht&lt;/strong&gt;</span>");

assert.equal(formatSeoNumber("en", 1234.5), "1,234.5");
assert.equal(formatSeoNumber("tr", 1234.5), "1.234,5");
assert.equal(formatSeoNumber("nl", 1234.5), "1.234,5");
assert.equal(formatSeoNumber("en-IN", 120000), "1,20,000", "regional formatting is not reduced to the catalogue language");
assert.equal(formatSeoNumber("xx-ZZ", 1234.5), "1,234.5", "unsupported Intl locales use English deterministically");
assert.equal(formatSeoNumber("not_a_locale", 1234.5), "1,234.5");
const date = Date.UTC(2026, 0, 2, 12);
const dateOptions = { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" } as const;
assert.equal(formatSeoDate("en-GB", date, dateOptions), "2 January 2026");
assert.equal(formatSeoDate("tr-TR", date, dateOptions), "2 Ocak 2026");
assert.equal(formatSeoDate("nl-NL", date, dateOptions), "2 januari 2026");

const hookSource = readFileSync(new URL("./i18n/index.ts", import.meta.url), "utf8");
const hookOutput = ts.transpileModule(hookSource, {
	fileName: "locale-hook.ts",
	reportDiagnostics: true,
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});
assert.deepEqual(hookOutput.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
function loadLocaleHook(admin: object) {
	let previous: { locale: unknown; value: ReturnType<typeof createSeoI18n> } | undefined;
	let memoRuns = 0;
	const output = { exports: {} as Record<string, unknown> };
	const pureModule = { createSeoI18n, formatSeoDate, formatSeoNumber, resolveSeoLocale };
	const require = (name: string) => {
		if (name === "@emdash-cms/admin") return admin;
		if (name === "./messages.ts") return pureModule;
		assert.equal(name, "react");
		return { useMemo: (factory: () => ReturnType<typeof createSeoI18n>, dependencies: unknown[]) => {
			if (!previous || previous.locale !== dependencies[0]) {
				previous = { locale: dependencies[0], value: factory() };
				memoRuns += 1;
			}
			return previous.value;
		} };
	};
	new Function("require", "module", "exports", hookOutput.outputText)(require, output, output.exports);
	return { useSeoI18n: output.exports.useSeoI18n as () => ReturnType<typeof createSeoI18n>, memoRuns: () => memoRuns };
}
let adminLocale = "en";
let adminHookCalls = 0;
const hostHook = loadLocaleHook({ useLocale: () => { adminHookCalls += 1; return { locale: adminLocale }; } });
const beforeSwitch = hostHook.useSeoI18n();
assert.equal(beforeSwitch.t("nav.view.overview"), "Overview");
assert.equal(hostHook.useSeoI18n(), beforeSwitch, "an unchanged admin language reuses the translator");
adminLocale = "tr-TR";
const afterSwitch = hostHook.useSeoI18n();
assert.notEqual(afterSwitch, beforeSwitch);
assert.equal(afterSwitch.locale, "tr-TR");
assert.equal(afterSwitch.t("nav.view.overview"), "Genel bakış");
assert.equal(adminHookCalls, 3, "the host hook is called consistently on every render");
assert.equal(hostHook.memoRuns(), 2);
const olderHostHook = loadLocaleHook({});
assert.equal(olderHostHook.useSeoI18n().t("nav.view.overview"), "Overview", "a missing host locale export does not prevent loading");
assert.equal(olderHostHook.useSeoI18n().locale, "en");
assert.equal(loadLocaleHook({ useLocale: null }).useSeoI18n().locale, "en");

if (false) {
	// @ts-expect-error Unknown message keys cannot be used by native UI callers.
	english.t("nav.view.missing");
	// @ts-expect-error Parameterized messages require their named values.
	english.t("nav.destinations");
	// @ts-expect-error A translated count must remain numeric.
	english.t("nav.attentionCount", { count: "3" });
	// @ts-expect-error The placeholder name comes from the canonical message contract.
	english.t("indexing.status.savedAt", { when: "today" });
	// @ts-expect-error Search result counts require their declared numeric value.
	english.t("nav.searchResults", { count: "1" });
	// @ts-expect-error Fixed messages do not accept unused interpolation values.
	english.t("nav.view.overview", { section: "Content" });
}

console.log("SEO locale foundation checks passed (catalogues, fallback, parameters, text safety, formatting).");
