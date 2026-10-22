import en from "./catalogues/en.json" with { type: "json" };
import nl from "./catalogues/nl.json" with { type: "json" };
import tr from "./catalogues/tr.json" with { type: "json" };

export const SEO_CATALOGUES = { en, tr, nl } as const;
export type SeoCatalogueLocale = keyof typeof SEO_CATALOGUES;
export type SeoMessageKey = keyof typeof en;
export type SeoCatalogue = Readonly<Partial<Record<SeoMessageKey, string>>>;
export type SeoCatalogueRegistry = Readonly<Record<string, SeoCatalogue>>;

export interface SeoMessageParameters {
	"nav.destinations": { section: string };
	"nav.attentionCount": { count: number };
	"nav.searchResults": { count: number };
	"nav.settingResult": { setting: string; page: string };
	"indexing.status.savedAt": { date: string };
	"indexing.state.withSource": { state: string; source: string };
	"indexing.pending.after": { state: string };
	"indexing.kept": { state: string };
	"indexing.types.choiceFor": { type: string };
	"indexing.types.limit": { limit: number };
	"indexing.types.removeNamed": { type: string };
	"indexing.archives.choiceFor": { taxonomy: string };
	"indexing.archives.limit": { limit: number };
	"indexing.archives.limitSetAll": { limit: number };
	"indexing.archives.removeNamed": { taxonomy: string };
	"plugin.disabled.title": { brand: string };
}

export type SeoTranslate = <Key extends SeoMessageKey>(
	key: Key,
	...args: Key extends keyof SeoMessageParameters
		? [parameters: SeoMessageParameters[Key]]
		: [parameters?: never]
) => string;

export interface SeoI18n {
	locale: string;
	t: SeoTranslate;
}

const MESSAGE_PARAMETERS: Record<keyof SeoMessageParameters, readonly string[]> = {
	"nav.destinations": ["section"],
	"nav.attentionCount": ["count"],
	"nav.searchResults": ["count"],
	"nav.settingResult": ["setting", "page"],
	"indexing.status.savedAt": ["date"],
	"indexing.state.withSource": ["state", "source"],
	"indexing.pending.after": ["state"],
	"indexing.kept": ["state"],
	"indexing.types.choiceFor": ["type"],
	"indexing.types.limit": ["limit"],
	"indexing.types.removeNamed": ["type"],
	"indexing.archives.choiceFor": ["taxonomy"],
	"indexing.archives.limit": ["limit"],
	"indexing.archives.limitSetAll": ["limit"],
	"indexing.archives.removeNamed": ["taxonomy"],
	"plugin.disabled.title": ["brand"],
};

export function normalizeSeoLocale(requested: string | null | undefined): string {
	if (typeof requested !== "string" || !requested.trim() || requested.length > 128) return "en";
	try {
		return Intl.getCanonicalLocales(requested.trim())[0] ?? "en";
	} catch {
		return "en";
	}
}

export function resolveSeoLocale(
	requested: string | null | undefined,
	catalogues: SeoCatalogueRegistry = SEO_CATALOGUES,
): string {
	const locale = normalizeSeoLocale(requested);
	if (Object.hasOwn(catalogues, locale)) return locale;
	const language = locale.split("-")[0] ?? "en";
	return Object.hasOwn(catalogues, language) ? language : "en";
}

export function seoMessagePlaceholders(message: string): string[] {
	return [...new Set([...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]!))].sort();
}

function samePlaceholders(left: string, right: string): boolean {
	const expected = seoMessagePlaceholders(left);
	const actual = seoMessagePlaceholders(right);
	return expected.length === actual.length && expected.every((name, index) => name === actual[index]);
}

export function validateSeoCatalogue(candidate: unknown): string[] {
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
		return ["Catalogue must be an object of plain strings."];
	}
	const values = candidate as Record<string, unknown>;
	const errors: string[] = [];
	for (const key of Object.keys(en) as SeoMessageKey[]) {
		if (!Object.hasOwn(values, key) || typeof values[key] !== "string" || !values[key].trim()) {
			errors.push(key + ": missing string");
		} else if (!samePlaceholders(en[key], values[key])) {
			errors.push(key + ": named placeholders differ");
		}
	}
	for (const key of Object.keys(values)) {
		if (!Object.hasOwn(en, key)) errors.push(key + ": unknown key");
	}
	return errors;
}

export function validateSeoMessageParameters(): string[] {
	const errors: string[] = [];
	for (const key of Object.keys(en) as SeoMessageKey[]) {
		const expected = Object.hasOwn(MESSAGE_PARAMETERS, key)
			? MESSAGE_PARAMETERS[key as keyof SeoMessageParameters]
			: [];
		const actual = seoMessagePlaceholders(en[key]);
		if (expected.length !== actual.length || ![...expected].sort().every((name, index) => name === actual[index])) {
			errors.push(key + ": parameter declaration differs");
		}
	}
	return errors;
}

export function createSeoI18n(
	requested: string | null | undefined,
	catalogues: SeoCatalogueRegistry = SEO_CATALOGUES,
): SeoI18n {
	const locale = normalizeSeoLocale(requested);
	const language = locale.split("-")[0] ?? "en";
	const candidates = [...new Set([locale, language])].flatMap((code) =>
		Object.hasOwn(catalogues, code) ? [catalogues[code]!] : [],
	);
	const translate = (key: SeoMessageKey, parameters?: Record<string, string | number>): string => {
		if (!Object.hasOwn(en, key)) return key;
		const fallback = en[key];
		const message = candidates.map((catalogue) => Object.hasOwn(catalogue, key) ? catalogue[key] : undefined)
			.find((candidate): candidate is string =>
				typeof candidate === "string" && !!candidate.trim() && samePlaceholders(fallback, candidate),
			) ?? fallback;
		return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, name: string) => {
			if (!parameters || !Object.hasOwn(parameters, name)) return token;
			const value = parameters[name];
			if (typeof value === "number") return Number.isFinite(value) ? formatSeoNumber(locale, value) : token;
			return typeof value === "string" ? value : token;
		});
	};
	return { locale, t: translate as SeoTranslate };
}

function formattingLocale(requested: string | null | undefined): string {
	const locale = normalizeSeoLocale(requested);
	return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : "en";
}

export function formatSeoNumber(
	locale: string | null | undefined,
	value: number,
	options?: Intl.NumberFormatOptions,
): string {
	return new Intl.NumberFormat(formattingLocale(locale), options).format(value);
}

export function formatSeoDate(
	locale: string | null | undefined,
	value: Date | number,
	options?: Intl.DateTimeFormatOptions,
): string {
	return new Intl.DateTimeFormat(formattingLocale(locale), options).format(value);
}
