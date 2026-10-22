export const SEO_LOCALE_GRAPH_STATUSES = [
	"single-locale",
	"complete",
	"incomplete",
	"not-indexable",
	"host-upgrade-required",
] as const;

export const SEO_LOCALE_GRAPH_ISSUE_CODES = [
	"current-entry-missing",
	"current-locale-missing",
	"current-entry-excluded",
	"translation-context-unavailable",
	"duplicate-locale",
	"default-locale-missing",
] as const;

export type SeoLocaleGraphStatus = (typeof SEO_LOCALE_GRAPH_STATUSES)[number];
export type SeoLocaleGraphIssueCode = (typeof SEO_LOCALE_GRAPH_ISSUE_CODES)[number];
export type SeoLocaleGraphIssueSeverity = "info" | "warning" | "error";

export interface SeoLocaleGraphEntry {
	entryId: string;
	locale: string | null;
	translationGroup: string | null;
	published: boolean;
	indexable: boolean;
	url: string | null;
}

export interface SeoLocaleGraphInput {
	currentEntryId: string;
	defaultLocale: string | null;
	hostSupportsTranslationGroups: boolean;
	entries: SeoLocaleGraphEntry[];
}

export interface SeoLocaleGraphIssue {
	code: SeoLocaleGraphIssueCode;
	severity: SeoLocaleGraphIssueSeverity;
	message: string;
	locale: string | null;
}

export interface SeoLocaleGraphAlternate {
	entryId: string;
	locale: string;
	url: string | null;
	isCurrent: boolean;
	isDefault: boolean;
}

export interface SeoLocaleGraphDiagnostic {
	owner: "emdash-core";
	emitsMarkup: false;
	status: SeoLocaleGraphStatus;
	hostSupportsTranslationGroups: boolean;
	currentLocale: string | null;
	defaultLocale: string | null;
	translationGroup: string | null;
	discoveredLocales: string[];
	alternates: SeoLocaleGraphAlternate[];
	xDefaultLocale: string | null;
	issues: SeoLocaleGraphIssue[];
}

export interface SeoHreflangLink {
	hreflang: string;
	href: string;
}

function clean(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function localeKey(value: string | null | undefined): string | null {
	return clean(value)?.toLowerCase() ?? null;
}

function uniqueLocales(entries: SeoLocaleGraphEntry[]): string[] {
	const locales = new Map<string, string>();
	for (const entry of entries) {
		const key = localeKey(entry.locale);
		if (key && !locales.has(key)) locales.set(key, clean(entry.locale) ?? key);
	}
	return [...locales.values()].sort((left, right) => left.localeCompare(right));
}

function absoluteHttpUrl(value: string | null | undefined): string | null {
	const normalized = clean(value);
	if (!normalized) return null;
	try {
		const url = new URL(normalized);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

export function resolveSeoHreflangLinks(
	diagnostic: SeoLocaleGraphDiagnostic,
): SeoHreflangLink[] {
	if (diagnostic.status !== "complete" || diagnostic.alternates.length < 2) return [];

	const links: SeoHreflangLink[] = [];
	const seenLocales = new Set<string>();
	const seenUrls = new Set<string>();
	for (const alternate of diagnostic.alternates) {
		const locale = clean(alternate.locale);
		const localeIdentity = localeKey(locale);
		const href = absoluteHttpUrl(alternate.url);
		if (!locale || !localeIdentity || !href) return [];
		if (seenLocales.has(localeIdentity) || seenUrls.has(href)) return [];
		seenLocales.add(localeIdentity);
		seenUrls.add(href);
		links.push({ hreflang: locale, href });
	}

	const defaultLocale = localeKey(diagnostic.xDefaultLocale);
	const unprefixedLinks = links.filter((link) => {
		const locale = localeKey(link.hreflang);
		if (!locale) return false;
		const pathname = new URL(link.href).pathname.toLowerCase();
		return pathname !== `/${locale}` && !pathname.startsWith(`/${locale}/`);
	});
	const defaultLink =
		unprefixedLinks.length === 1
			? unprefixedLinks[0]
			: links.find((link) => localeKey(link.hreflang) === defaultLocale);
	if (!defaultLink) return [];
	return [...links, { hreflang: "x-default", href: defaultLink.href }];
}

function issue(
	code: SeoLocaleGraphIssueCode,
	severity: SeoLocaleGraphIssueSeverity,
	message: string,
	locale: string | null = null,
): SeoLocaleGraphIssue {
	return { code, severity, message, locale };
}

export function diagnoseSeoLocaleGraph(input: SeoLocaleGraphInput): SeoLocaleGraphDiagnostic {
	const defaultLocale = clean(input.defaultLocale);
	const current = input.entries.find((entry) => entry.entryId === input.currentEntryId) ?? null;
	const currentLocale = clean(current?.locale);
	const translationGroup = clean(current?.translationGroup);
	const eligibleEntries = input.entries.filter((entry) => entry.published && entry.indexable);
	const discoveredLocales = uniqueLocales(eligibleEntries);
	const base = {
		owner: "emdash-core" as const,
		emitsMarkup: false as const,
		hostSupportsTranslationGroups: input.hostSupportsTranslationGroups,
		currentLocale,
		defaultLocale,
		translationGroup,
		discoveredLocales,
	};

	if (!current) {
		return {
			...base,
			status: "incomplete",
			alternates: [],
			xDefaultLocale: null,
			issues: [issue("current-entry-missing", "error", "The current content entry could not be resolved.")],
		};
	}

	if (!current.published || !current.indexable) {
		return {
			...base,
			status: "not-indexable",
			alternates: [],
			xDefaultLocale: null,
			issues: [
				issue(
					"current-entry-excluded",
					"info",
					"EmDash excludes unpublished or noindex entries from hreflang output.",
					currentLocale,
				),
			],
		};
	}

	if (!currentLocale) {
		return {
			...base,
			status: "incomplete",
			alternates: [],
			xDefaultLocale: null,
			issues: [issue("current-locale-missing", "warning", "The entry does not expose a locale to the SEO plugin.")],
		};
	}

	if (!input.hostSupportsTranslationGroups) {
		const requiresUpgrade = discoveredLocales.length > 1;
		return {
			...base,
			status: requiresUpgrade ? "host-upgrade-required" : "single-locale",
			alternates: [],
			xDefaultLocale: requiresUpgrade ? null : currentLocale,
			issues: requiresUpgrade
				? [
						issue(
							"translation-context-unavailable",
							"warning",
							"Multiple locales exist, but this EmDash version does not expose translation groups to plugins.",
							currentLocale,
						),
					]
				: [],
		};
	}

	if (!translationGroup) {
		return {
			...base,
			status: "single-locale",
			alternates: [
				{
					entryId: current.entryId,
					locale: currentLocale,
					url: clean(current.url),
					isCurrent: true,
					isDefault: localeKey(currentLocale) === localeKey(defaultLocale),
				},
			],
			xDefaultLocale: currentLocale,
			issues: [],
		};
	}

	const groupEntries = eligibleEntries.filter(
		(entry) => clean(entry.translationGroup) === translationGroup && clean(entry.locale),
	);
	const localeCounts = new Map<string, number>();
	for (const entry of groupEntries) {
		const key = localeKey(entry.locale);
		if (key) localeCounts.set(key, (localeCounts.get(key) ?? 0) + 1);
	}

	const issues: SeoLocaleGraphIssue[] = [];
	for (const [locale, count] of localeCounts) {
		if (count > 1) {
			issues.push(
				issue(
					"duplicate-locale",
					"error",
					`Translation group ${translationGroup} contains ${count} published, indexable entries for ${locale}.`,
					locale,
				),
			);
		}
	}

	const defaultKey = localeKey(defaultLocale);
	const hasDefaultLocale = defaultKey ? localeCounts.has(defaultKey) : false;
	if (defaultLocale && !hasDefaultLocale) {
		issues.push(
			issue(
				"default-locale-missing",
				"warning",
				`Translation group ${translationGroup} has no published, indexable ${defaultLocale} entry.`,
				defaultLocale,
			),
		);
	}

	const alternates = groupEntries
		.map((entry): SeoLocaleGraphAlternate => ({
			entryId: entry.entryId,
			locale: clean(entry.locale) ?? "",
			url: clean(entry.url),
			isCurrent: entry.entryId === current.entryId,
			isDefault: localeKey(entry.locale) === defaultKey,
		}))
		.sort((left, right) => left.locale.localeCompare(right.locale) || left.entryId.localeCompare(right.entryId));

	if (alternates.length <= 1 && issues.length === 0) {
		return {
			...base,
			status: "single-locale",
			alternates,
			xDefaultLocale: alternates[0]?.locale ?? currentLocale,
			issues,
		};
	}

	return {
		...base,
		status: issues.length > 0 ? "incomplete" : "complete",
		alternates,
		xDefaultLocale:
			alternates.find((entry) => entry.isDefault)?.locale ?? alternates[0]?.locale ?? null,
		issues,
	};
}
