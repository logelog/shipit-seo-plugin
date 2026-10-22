// Sitemap ownership facts recorded by `shipitSeo()` at build time and passed
// to the native runtime through the plugin descriptor options.
import type { SitemapLocaleEntry, SitemapRouting } from "./sitemap-engine.ts";

/** EmDash versions whose content and SEO schema the native source was verified against. */
export const SITEMAP_NATIVE_HOST_VERSIONS: readonly string[] = ["1.1.0", "1.2.0", "1.3.0", "1.3.1"];

export const SITEMAP_INSTALLATION_OWNERS = [
	"shipit",
	"site-route",
	"static-file",
	"integration",
	"competing-route",
	"unknown",
	"unsupported-routing",
	"unsupported-host",
] as const;

export type SitemapInstallationOwner = (typeof SITEMAP_INSTALLATION_OWNERS)[number];

export interface SitemapInstallation {
	owner: SitemapInstallationOwner;
	/** File, integration, version or setting that decided a non-Shipit owner. */
	detail: string | null;
	routing: SitemapRouting | null;
}

function validLocaleEntry(value: unknown): value is SitemapLocaleEntry {
	if (typeof value === "string") return value.length > 0 && value.length <= 64;
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const entry = value as { path?: unknown; codes?: unknown };
	return typeof entry.path === "string" && entry.path.length > 0 && entry.path.length <= 64 &&
		Array.isArray(entry.codes) && entry.codes.length <= 32 &&
		entry.codes.every((code) => typeof code === "string" && code.length > 0 && code.length <= 64);
}

function validRouting(value: unknown): value is SitemapRouting {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const routing = value as Partial<SitemapRouting>;
	if (routing.trailingSlash !== "always" && routing.trailingSlash !== "never" && routing.trailingSlash !== "ignore") return false;
	if (routing.i18n === null) return true;
	const i18n = routing.i18n as Partial<NonNullable<SitemapRouting["i18n"]>> | undefined;
	return Boolean(i18n) && typeof i18n!.defaultLocale === "string" && typeof i18n!.prefixDefaultLocale === "boolean" &&
		Array.isArray(i18n!.locales) && i18n!.locales.length <= 100 && i18n!.locales.every(validLocaleEntry);
}

/** Strict check of serialized descriptor options; anything else is refused. */
export function validSitemapInstallation(value: unknown): SitemapInstallation | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<SitemapInstallation>;
	if (!SITEMAP_INSTALLATION_OWNERS.includes(candidate.owner as SitemapInstallationOwner)) return null;
	if (candidate.detail !== null && (typeof candidate.detail !== "string" || candidate.detail.length > 300)) return null;
	if (candidate.routing !== null && !validRouting(candidate.routing)) return null;
	if (candidate.owner === "shipit" && candidate.routing === null) return null;
	return { owner: candidate.owner as SitemapInstallationOwner, detail: candidate.detail ?? null, routing: candidate.routing ?? null };
}

/** Astro `i18n` shape read at build time. */
export interface AstroI18nShape {
	defaultLocale?: unknown;
	locales?: unknown;
	routing?: unknown;
	domains?: unknown;
}

/**
 * Routing facts for the sitemap, or the reason they are unsupported: a base
 * path, locale domains or manual locale routing can serve addresses the
 * EmDash route resolver does not describe.
 */
export function sitemapRoutingFromAstro(config: {
	base?: unknown;
	trailingSlash?: unknown;
	i18n?: AstroI18nShape | null;
}): { routing: SitemapRouting } | { unsupported: string } {
	const base = typeof config.base === "string" ? config.base : "/";
	if (base !== "/" && base !== "") return { unsupported: `Astro base path ${base}` };
	const trailingSlash = config.trailingSlash === "always" || config.trailingSlash === "never" ? config.trailingSlash : "ignore";
	const i18n = config.i18n;
	if (!i18n) return { routing: { trailingSlash, i18n: null } };
	if (i18n.domains && typeof i18n.domains === "object" && Object.keys(i18n.domains).length) {
		return { unsupported: "Astro i18n domains" };
	}
	if (i18n.routing === "manual") return { unsupported: "Astro manual i18n routing" };
	const locales = Array.isArray(i18n.locales)
		? i18n.locales.map((entry) => (entry && typeof entry === "object"
			? { path: String((entry as { path?: unknown }).path ?? ""), codes: [...((entry as { codes?: unknown }).codes as unknown[] ?? [])].map(String) }
			: entry))
		: [];
	if (typeof i18n.defaultLocale !== "string" || !locales.every(validLocaleEntry)) {
		return { unsupported: "Astro i18n locales" };
	}
	const routing = i18n.routing && typeof i18n.routing === "object" ? i18n.routing as { prefixDefaultLocale?: unknown } : {};
	return {
		routing: {
			trailingSlash,
			i18n: {
				defaultLocale: i18n.defaultLocale,
				locales: locales as SitemapLocaleEntry[],
				prefixDefaultLocale: routing.prefixDefaultLocale === true,
			},
		},
	};
}

const SITEMAP_ADDRESS = /^sitemap(?:-[^/]*)?\.xml$/;
// Astro page extensions, as EmDash checks before injecting its own routes.
const ROUTE_EXTENSIONS = [".astro", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".mts", ".md", ".mdx", ".html"];

/** True for a route pattern that is itself a sitemap address, such as `/sitemap-[collection].xml`. */
export function isSitemapRoutePattern(pattern: string): boolean {
	return pattern.startsWith("/") && SITEMAP_ADDRESS.test(pattern.slice(1));
}

export interface SitemapResolvedRoute {
	pattern: string;
	patternRegex: RegExp;
	entrypoint: string;
}

/**
 * The first non-EmDash route that wins a sitemap address, given routes in
 * Astro's precedence order (the order `astro:routes:resolved` receives and
 * the router uses). Generic routes such as `/[name].xml` can outrank
 * EmDash's `/sitemap-[collection].xml` on Astro's final tie-break, while a
 * rest route such as `/[...slug]` never does; only an actual win counts.
 */
export function sitemapRouteWinner(
	routes: readonly SitemapResolvedRoute[],
	isCore: (route: SitemapResolvedRoute) => boolean,
): string | null {
	const addresses = new Set(["/sitemap.xml", "/sitemap-pages.xml", "/sitemap-posts.xml",
		"/sitemap-pages-1.xml", "/sitemap-pages-2.xml", "/sitemap-posts-1.xml", "/sitemap-posts-2.xml"]);
	// Each route also proposes the sitemap addresses its own pattern can
	// produce, so a pattern such as `/[prefix]-products.xml` is probed at
	// `/sitemap-products.xml`.
	for (const route of routes) {
		if (!isCore(route)) for (const address of sitemapAddressesFor(route.pattern)) addresses.add(address);
	}
	for (const address of addresses) {
		const winner = routes.find((route) => route.patternRegex.test(address) || route.patternRegex.test(`${address}/`));
		if (winner && !isCore(winner)) return `${winner.pattern} answers ${address}`;
	}
	return null;
}

const PARAMETER = /\[[^\]]+\]/g;
const PARAMETER_FILLS = ["sitemap", "sitemap-pages", "pages", "sitemap.xml", "sitemap-pages.xml"];
const PAGE_PARAMETER_FILLS = [...PARAMETER_FILLS, "1", "2"];
const SITEMAP_PATH = /^\/sitemap(?:-[a-z][a-z0-9_]{0,62}(?:-[1-9][0-9]*)?)?\.xml$/;

/** Sitemap addresses a route pattern produces when its parameters take sitemap-like values. */
export function sitemapAddressesFor(pattern: string): string[] {
	const parts = pattern.split(PARAMETER);
	const parameterNames = pattern.match(PARAMETER) ?? [];
	const parameters = parameterNames.length;
	if (parameters === 0) return SITEMAP_PATH.test(pattern) ? [pattern] : [];
	const found = new Set<string>();
	const fill = (index: number, text: string) => {
		if (index === parameters) {
			if (SITEMAP_PATH.test(text)) found.add(text);
			return;
		}
		// Parameters beyond the third take the first value to bound the search.
		const values = parameterNames[index] === "[page]" ? PAGE_PARAMETER_FILLS : PARAMETER_FILLS;
		for (const value of index < 3 ? values : values.slice(0, 1)) fill(index + 1, `${text}${value}${parts[index + 1]}`);
	};
	fill(0, parts[0]);
	return [...found];
}

export interface SitemapPageEntry {
	name: string;
	directory: boolean;
	/** Names inside a directory entry; unused for files. */
	children?: readonly string[];
}

/** Sitemap address a top-level `src/pages` entry serves, or null. */
export function sitemapPageAddress(entry: SitemapPageEntry): string | null {
	if (entry.directory) {
		return SITEMAP_ADDRESS.test(entry.name) &&
			(entry.children ?? []).some((child) => ROUTE_EXTENSIONS.some((extension) => child === `index${extension}`))
			? entry.name
			: null;
	}
	const extension = ROUTE_EXTENSIONS.find((candidate) => entry.name.endsWith(candidate));
	const address = extension ? entry.name.slice(0, -extension.length) : null;
	return address && SITEMAP_ADDRESS.test(address) ? address : null;
}

/** True for a `public/` file served at a sitemap address; the file name is the address. */
export function isSitemapStaticFile(name: string): boolean {
	return SITEMAP_ADDRESS.test(name);
}

export interface SitemapClassificationFacts {
	emdashVersion: string | null;
	/** A failed filesystem inspection cannot establish that these addresses are free. */
	inspectionError?: string | null;
	pageEntries: readonly SitemapPageEntry[];
	/** File names directly in the public directory. */
	publicFiles: readonly string[];
	/** Names of the other configured Astro integrations. */
	integrations: readonly string[];
	base?: unknown;
	trailingSlash?: unknown;
	i18n?: AstroI18nShape | null;
}

/**
 * Who answers /sitemap.xml. A site page or public file, another sitemap
 * integration, unsupported routing or an unverified EmDash version keeps the
 * existing owner; only the remaining case lets Shipit serve it.
 */
export function classifySitemapInstallation(facts: SitemapClassificationFacts): SitemapInstallation {
	if (!facts.emdashVersion || !SITEMAP_NATIVE_HOST_VERSIONS.includes(facts.emdashVersion)) {
		return { owner: "unsupported-host", detail: `EmDash ${facts.emdashVersion ?? "version unknown"}`, routing: null };
	}
	const file = facts.publicFiles.find(isSitemapStaticFile);
	if (file) return { owner: "static-file", detail: `public/${file}`, routing: null };
	if (facts.inspectionError) return { owner: "unknown", detail: facts.inspectionError, routing: null };
	for (const entry of facts.pageEntries) {
		if (sitemapPageAddress(entry)) return { owner: "site-route", detail: `src/pages/${entry.name}`, routing: null };
	}
	const integration = facts.integrations.find((name) => name !== "emdash" && /sitemap/i.test(name));
	if (integration) return { owner: "integration", detail: integration, routing: null };
	const routing = sitemapRoutingFromAstro(facts);
	if ("unsupported" in routing) return { owner: "unsupported-routing", detail: routing.unsupported, routing: null };
	return { owner: "shipit", detail: null, routing: routing.routing };
}
