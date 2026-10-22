// Ownership facts for /robots.txt, recorded by `shipitSeo()` from the settled
// Astro configuration and resolved routes, and passed to the native runtime
// through the plugin descriptor options. Shipit SEO never serves the file.

/** EmDash versions whose /robots.txt route this editor was verified against. */
export const ROBOTS_NATIVE_HOST_VERSIONS: readonly string[] = ["1.1.0", "1.2.0", "1.3.0", "1.3.1"];

export const ROBOTS_INSTALLATION_OWNERS = [
	"emdash-core",
	"unsettled",
	"unknown",
	"site-route",
	"static-file",
	"integration",
	"competing-route",
	"unsupported-routing",
	"unsupported-host",
	"not-served",
] as const;

export type RobotsInstallationOwner = (typeof ROBOTS_INSTALLATION_OWNERS)[number];

export interface RobotsInstallation {
	owner: RobotsInstallationOwner;
	/** File, integration, route, version or setting that decided the owner. */
	detail: string | null;
	/** EmDash version installed beside the site, or null when it was not found. */
	hostVersion: string | null;
	/** Origin of EmDash's `siteUrl` option, which core uses before the environment. */
	emdashSiteUrl: string | null;
}

function validOrigin(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 2048) return false;
	try {
		const parsed = new URL(value);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value;
	} catch {
		return false;
	}
}

/** Strict check of serialized descriptor options; anything else is refused. */
export function validRobotsInstallation(value: unknown): RobotsInstallation | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<RobotsInstallation>;
	if (!ROBOTS_INSTALLATION_OWNERS.includes(candidate.owner as RobotsInstallationOwner)) return null;
	if (candidate.detail !== null && (typeof candidate.detail !== "string" || candidate.detail.length > 300)) return null;
	if (candidate.hostVersion !== null && (typeof candidate.hostVersion !== "string" || candidate.hostVersion.length > 64)) return null;
	if (candidate.emdashSiteUrl !== null && !validOrigin(candidate.emdashSiteUrl)) return null;
	return {
		owner: candidate.owner as RobotsInstallationOwner,
		detail: candidate.detail,
		hostVersion: candidate.hostVersion,
		emdashSiteUrl: candidate.emdashSiteUrl,
	};
}

/** EmDash normalizes its `siteUrl` option to an origin at startup; anything else is left to core. */
export function emdashSiteUrlOrigin(value: unknown): string | null {
	if (typeof value !== "string" || !value) return null;
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
	} catch {
		return null;
	}
}

// Astro page extensions, as EmDash checks before injecting /robots.txt.
const ROUTE_EXTENSIONS = [".astro", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".mts", ".md", ".mdx", ".html"];

export interface RobotsPageEntry {
	name: string;
	directory: boolean;
	/** Names inside a directory entry; unused for files. */
	children?: readonly string[];
}

// Case-insensitive file systems serve and detect these names in any case, so
// any case keeps the site's file in charge.
export function isRobotsName(name: string): boolean {
	return name.toLowerCase() === "robots.txt";
}

/** True for a top-level `src/pages` entry EmDash treats as the site's own robots.txt route. */
export function isRobotsPageEntry(entry: RobotsPageEntry): boolean {
	if (entry.directory) {
		return isRobotsName(entry.name) &&
			(entry.children ?? []).some((child) => ROUTE_EXTENSIONS.some((extension) => child.toLowerCase() === `index${extension}`));
	}
	return ROUTE_EXTENSIONS.some((extension) => entry.name.toLowerCase().endsWith(extension) &&
		isRobotsName(entry.name.slice(0, -extension.length)));
}

export interface RobotsClassificationFacts {
	emdashVersion: string | null;
	/** A failed filesystem inspection keeps this editor read-only. */
	inspectionError?: string | null;
	pageEntries: readonly RobotsPageEntry[];
	/** File names directly in the public directory. */
	publicFiles: readonly string[];
	/** Names of the other configured Astro integrations. */
	integrations: readonly string[];
	base?: unknown;
	emdashSiteUrl: string | null;
}

/**
 * Who answers /robots.txt from configuration facts alone. A public file
 * (served before any route in dev and production), a site page, another
 * robots integration, a base path (crawlers read only the host root) or an
 * unverified EmDash version keeps the file away from this editor. The
 * remaining case is `unsettled` until the resolved routes name core's route.
 */
export function classifyRobotsInstallation(facts: RobotsClassificationFacts): RobotsInstallation {
	const known = { hostVersion: facts.emdashVersion, emdashSiteUrl: facts.emdashSiteUrl };
	if (!facts.emdashVersion || !ROBOTS_NATIVE_HOST_VERSIONS.includes(facts.emdashVersion)) {
		return { owner: "unsupported-host", detail: `EmDash ${facts.emdashVersion ?? "version unknown"}`, ...known };
	}
	// Dev's public middleware and the standalone static handler both answer
	// before any route, so a public file wins over a site page.
	const file = facts.publicFiles.find(isRobotsName);
	if (file) return { owner: "static-file", detail: `public/${file}`, ...known };
	if (facts.inspectionError) return { owner: "unknown", detail: facts.inspectionError, ...known };
	const page = facts.pageEntries.find(isRobotsPageEntry);
	if (page) return { owner: "site-route", detail: `src/pages/${page.name}`, ...known };
	const integration = facts.integrations.find((name) => name !== "emdash" && /robots/i.test(name));
	if (integration) return { owner: "integration", detail: integration, ...known };
	const base = typeof facts.base === "string" ? facts.base : "/";
	if (base !== "/" && base !== "") return { owner: "unsupported-routing", detail: `Astro base path ${base}`, ...known };
	return { owner: "unsettled", detail: "Resolved routes were not recorded", ...known };
}

export interface RobotsResolvedRoute {
	pattern: string;
	patternRegex: RegExp;
	entrypoint?: string;
}

export type RobotsRouteFact =
	| { winner: "core" }
	| { winner: "other"; detail: string }
	| { winner: "none" };

/**
 * The route that answers /robots.txt, given routes in Astro's precedence
 * order (the order `astro:routes:resolved` receives). Production serves the
 * first match; dev breaks a tie between identical patterns by entrypoint
 * instead, so any other route with the same pattern also counts as competing.
 */
export function robotsRouteFact(
	routes: readonly RobotsResolvedRoute[],
	isCore: (route: RobotsResolvedRoute) => boolean,
): RobotsRouteFact {
	const winner = routes.find((route) => route.patternRegex.test("/robots.txt"));
	if (!winner) return { winner: "none" };
	if (!isCore(winner)) return { winner: "other", detail: `${winner.pattern} answers /robots.txt` };
	const tied = routes.find((route) => route !== winner && !isCore(route) && route.pattern === winner.pattern);
	return tied ? { winner: "other", detail: `${tied.pattern} is defined twice` } : { winner: "core" };
}

/**
 * Applies the resolved-route fact to a configuration classification. Only a
 * route fact naming core's route makes core the owner; without one the
 * classification stays `unsettled`.
 */
export function settleRobotsInstallation(classified: RobotsInstallation, route: RobotsRouteFact | null): RobotsInstallation {
	if (classified.owner !== "unsettled" || !route) return classified;
	if (route.winner === "other") return { ...classified, owner: "competing-route", detail: route.detail };
	if (route.winner === "none") return { ...classified, owner: "not-served", detail: "No route answers /robots.txt" };
	return { ...classified, owner: "emdash-core", detail: null };
}
