import assert from "node:assert/strict";

import {
	diagnoseSeoLocaleGraph,
	resolveSeoHreflangLinks,
	type SeoLocaleGraphEntry,
} from "./locale-graph.ts";

function entry(
	entryId: string,
	locale: string | null,
	translationGroup: string | null,
	overrides: Partial<SeoLocaleGraphEntry> = {},
): SeoLocaleGraphEntry {
	return {
		entryId,
		locale,
		translationGroup,
		published: true,
		indexable: true,
		url: `https://example.com/${locale ?? "unknown"}/${entryId}`,
		...overrides,
	};
}

const singleLocale = diagnoseSeoLocaleGraph({
	currentEntryId: "home-en",
	defaultLocale: "en",
	hostSupportsTranslationGroups: false,
	entries: [entry("home-en", "en", null)],
});
assert.equal(singleLocale.status, "single-locale");
assert.equal(singleLocale.owner, "emdash-core");
assert.equal(singleLocale.emitsMarkup, false);

const oldHostWithMultipleLocales = diagnoseSeoLocaleGraph({
	currentEntryId: "home-en",
	defaultLocale: "en",
	hostSupportsTranslationGroups: false,
	entries: [entry("home-en", "en", null), entry("contact-nl", "nl", null)],
});
assert.equal(oldHostWithMultipleLocales.status, "host-upgrade-required");
assert.equal(oldHostWithMultipleLocales.issues[0]?.code, "translation-context-unavailable");
assert.deepEqual(oldHostWithMultipleLocales.alternates, []);

const completeGraph = diagnoseSeoLocaleGraph({
	currentEntryId: "home-nl",
	defaultLocale: "en",
	hostSupportsTranslationGroups: true,
	entries: [entry("home-en", "en", "home"), entry("home-nl", "nl", "home")],
});
assert.equal(completeGraph.status, "complete");
assert.equal(completeGraph.alternates.length, 2);
assert.equal(completeGraph.xDefaultLocale, "en");
assert.deepEqual(resolveSeoHreflangLinks(completeGraph), [
	{ hreflang: "en", href: "https://example.com/en/home-en" },
	{ hreflang: "nl", href: "https://example.com/nl/home-nl" },
	{ hreflang: "x-default", href: "https://example.com/en/home-en" },
]);

const unprefixedDefaultGraph = diagnoseSeoLocaleGraph({
	currentEntryId: "home-nl",
	defaultLocale: "en",
	hostSupportsTranslationGroups: true,
	entries: [
		entry("home-de", "de", "home", { url: "https://example.com/de" }),
		entry("home-en", "en", "home", { url: "https://example.com/en" }),
		entry("home-nl", "nl", "home", { url: "https://example.com/" }),
	],
});
assert.equal(resolveSeoHreflangLinks(unprefixedDefaultGraph).at(-1)?.href, "https://example.com/");

const duplicateLocale = diagnoseSeoLocaleGraph({
	currentEntryId: "home-en",
	defaultLocale: "en",
	hostSupportsTranslationGroups: true,
	entries: [
		entry("home-en", "en", "home"),
		entry("home-en-copy", "EN", "home"),
		entry("home-nl", "nl", "home"),
	],
});
assert.equal(duplicateLocale.status, "incomplete");
assert.equal(duplicateLocale.issues[0]?.code, "duplicate-locale");
assert.deepEqual(resolveSeoHreflangLinks(duplicateLocale), []);

const duplicateUrlGraph = diagnoseSeoLocaleGraph({
	currentEntryId: "home-en",
	defaultLocale: "en",
	hostSupportsTranslationGroups: true,
	entries: [
		entry("home-en", "en", "home", { url: "https://example.com/home" }),
		entry("home-nl", "nl", "home", { url: "https://example.com/home" }),
	],
});
assert.deepEqual(resolveSeoHreflangLinks(duplicateUrlGraph), []);

const missingDefault = diagnoseSeoLocaleGraph({
	currentEntryId: "home-nl",
	defaultLocale: "en",
	hostSupportsTranslationGroups: true,
	entries: [entry("home-nl", "nl", "home"), entry("home-de", "de", "home")],
});
assert.equal(missingDefault.status, "incomplete");
assert.equal(missingDefault.issues[0]?.code, "default-locale-missing");
assert.equal(missingDefault.xDefaultLocale, "de");

const noindexCurrent = diagnoseSeoLocaleGraph({
	currentEntryId: "home-nl",
	defaultLocale: "en",
	hostSupportsTranslationGroups: true,
	entries: [
		entry("home-en", "en", "home"),
		entry("home-nl", "nl", "home", { indexable: false }),
	],
});
assert.equal(noindexCurrent.status, "not-indexable");
assert.deepEqual(noindexCurrent.alternates, []);

console.log("SEO locale graph self-check passed.");
