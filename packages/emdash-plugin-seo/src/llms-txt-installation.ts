// Ownership facts for /llms.txt, recorded by `shipitSeo()` from the settled
// Astro configuration and resolved routes, and passed to the native runtime
// through the plugin descriptor options. Shipit answers the file only when no
// page, public file, integration, route or redirect can answer it.

/** EmDash versions whose middleware and public plugin dispatcher this adapter was verified against. */
export const LLMS_TXT_NATIVE_HOST_VERSIONS: readonly string[] = ["1.1.0", "1.2.0", "1.3.0", "1.3.1"];

export const LLMS_TXT_INSTALLATION_OWNERS = [
	"shipit",
	"unsettled",
	"unknown",
	"site-route",
	"static-file",
	"integration",
	"competing-route",
	"unsupported-routing",
	"unsupported-host",
] as const;

export type LlmsTxtInstallationOwner = (typeof LLMS_TXT_INSTALLATION_OWNERS)[number];

export interface LlmsTxtInstallation {
	owner: LlmsTxtInstallationOwner;
	/** File, directory, integration, route, version or setting that decided the owner. */
	detail: string | null;
	/** EmDash version installed beside the site, or null when it was not found. */
	hostVersion: string | null;
}

/** Strict check of serialized descriptor options; anything else is refused. */
export function validLlmsTxtInstallation(value: unknown): LlmsTxtInstallation | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<LlmsTxtInstallation>;
	if (!LLMS_TXT_INSTALLATION_OWNERS.includes(candidate.owner as LlmsTxtInstallationOwner)) return null;
	if (candidate.detail !== null && (typeof candidate.detail !== "string" || candidate.detail.length > 300)) return null;
	if (candidate.hostVersion !== null && (typeof candidate.hostVersion !== "string" || candidate.hostVersion.length > 64)) return null;
	if (candidate.owner === "shipit" && candidate.detail !== null) return null;
	return { owner: candidate.owner as LlmsTxtInstallationOwner, detail: candidate.detail, hostVersion: candidate.hostVersion };
}

/**
 * One directory read at build time. `absent` is only a directory that does not
 * exist; a permission or other read error is `unreadable`, which never counts
 * as "no file here".
 */
export type LlmsTxtDirectoryListing =
	| { state: "listed"; entries: readonly LlmsTxtDirectoryEntry[] }
	| { state: "absent" }
	| { state: "unreadable"; code: string };

export interface LlmsTxtDirectoryEntry {
	name: string;
	directory: boolean;
	/** Set when the entry itself could not be inspected, such as an unresolved symbolic link. */
	unreadable?: string;
	/** For a directory named llms.txt only: its own listing. */
	children?: LlmsTxtDirectoryListing;
}

// Astro page extensions, as EmDash checks before injecting its root routes.
const ROUTE_EXTENSIONS = [".astro", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".mts", ".md", ".mdx", ".html"];

// Case-insensitive file systems serve and detect these names in any case, so
// any case keeps the site's file in charge.
export function isLlmsTxtName(name: string): boolean {
	return name.toLowerCase() === "llms.txt";
}

/** `llms.txt.<page extension>` in any letter case: a source page for /llms.txt. */
export function isLlmsTxtSourceFile(name: string): boolean {
	return ROUTE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension) &&
		isLlmsTxtName(name.slice(0, -extension.length)));
}

export type LlmsTxtPageMatch = { match: "none" } | { match: "page"; name: string } | { match: "unreadable"; name: string; code: string };

/**
 * Whether a top-level `src/pages` entry serves /llms.txt. An entry with a
 * candidate name that could not be inspected, or an unreadable llms.txt
 * directory, is not a "no".
 */
export function llmsTxtPageEntry(entry: LlmsTxtDirectoryEntry): LlmsTxtPageMatch {
	if (entry.unreadable !== undefined) {
		return isLlmsTxtName(entry.name) || isLlmsTxtSourceFile(entry.name)
			? { match: "unreadable", name: entry.name, code: entry.unreadable }
			: { match: "none" };
	}
	if (entry.directory) {
		if (!isLlmsTxtName(entry.name)) return { match: "none" };
		const children = entry.children;
		if (!children || children.state === "unreadable") {
			return { match: "unreadable", name: entry.name, code: children?.state === "unreadable" ? children.code : "not listed" };
		}
		if (children.state === "absent") return { match: "none" };
		return children.entries.some((child) => !child.directory &&
			ROUTE_EXTENSIONS.some((extension) => child.name.toLowerCase() === `index${extension}`))
			? { match: "page", name: entry.name }
			: { match: "none" };
	}
	return isLlmsTxtSourceFile(entry.name) ? { match: "page", name: entry.name } : { match: "none" };
}

export interface LlmsTxtClassificationFacts {
	emdashVersion: string | null;
	/** The final public directory. */
	publicDirectory: LlmsTxtDirectoryListing;
	/** `src/pages` of the final source directory. */
	pagesDirectory: LlmsTxtDirectoryListing;
	/** Names of the other configured Astro integrations. */
	integrations: readonly string[];
	base?: unknown;
	i18n?: unknown;
}

/**
 * Who answers /llms.txt from configuration facts alone. A public file (served
 * before any route), a site page, another llms integration, a base path, Astro
 * i18n routing or an unverified EmDash version keeps the file away from
 * Shipit. A directory that could not be read leaves the owner unknown. The
 * remaining case is `unsettled` until the resolved routes are recorded.
 */
export function classifyLlmsTxtInstallation(facts: LlmsTxtClassificationFacts): LlmsTxtInstallation {
	const hostVersion = facts.emdashVersion;
	if (!hostVersion || !LLMS_TXT_NATIVE_HOST_VERSIONS.includes(hostVersion)) {
		return { owner: "unsupported-host", detail: `EmDash ${hostVersion ?? "version unknown"}`, hostVersion };
	}
	if (facts.publicDirectory.state === "unreadable") {
		return { owner: "unknown", detail: `The public directory could not be read (${facts.publicDirectory.code})`, hostVersion };
	}
	const file = facts.publicDirectory.state === "listed"
		? facts.publicDirectory.entries.find((entry) => isLlmsTxtName(entry.name))
		: undefined;
	if (file?.unreadable !== undefined) {
		return { owner: "unknown", detail: `public/${file.name} could not be read (${file.unreadable})`, hostVersion };
	}
	if (file) return { owner: "static-file", detail: `public/${file.name}`, hostVersion };
	if (facts.pagesDirectory.state === "unreadable") {
		return { owner: "unknown", detail: `src/pages could not be read (${facts.pagesDirectory.code})`, hostVersion };
	}
	if (facts.pagesDirectory.state === "listed") {
		for (const entry of facts.pagesDirectory.entries) {
			const match = llmsTxtPageEntry(entry);
			if (match.match === "page") return { owner: "site-route", detail: `src/pages/${match.name}`, hostVersion };
			if (match.match === "unreadable") {
				return { owner: "unknown", detail: `src/pages/${match.name} could not be read (${match.code})`, hostVersion };
			}
		}
	}
	const integration = facts.integrations.find((name) => name !== "emdash" && /llms/i.test(name));
	if (integration) return { owner: "integration", detail: integration, hostVersion };
	const base = typeof facts.base === "string" ? facts.base : "/";
	if (base !== "/" && base !== "") return { owner: "unsupported-routing", detail: `Astro base path ${base}`, hostVersion };
	if (facts.i18n) return { owner: "unsupported-routing", detail: "Astro i18n routing", hostVersion };
	return { owner: "unsettled", detail: "Resolved routes were not recorded", hostVersion };
}

export interface LlmsTxtResolvedRoute {
	pattern: string;
	patternRegex: RegExp;
	type?: string;
}

export type LlmsTxtRouteFact = { winner: "none" } | { winner: "other"; detail: string };

/**
 * The first route, in Astro's precedence order (the order
 * `astro:routes:resolved` receives), whose pattern matches /llms.txt with or
 * without a final slash. Static, dynamic and rest routes and configured
 * redirects all count: a source `/[...slug]` page may answer the address,
 * also when `trailingSlash: "always"` makes its pattern require the slash.
 */
export function llmsTxtRouteFact(routes: readonly LlmsTxtResolvedRoute[]): LlmsTxtRouteFact {
	const winner = routes.find((route) => route.patternRegex.test("/llms.txt") || route.patternRegex.test("/llms.txt/"));
	if (!winner) return { winner: "none" };
	return { winner: "other", detail: `${winner.type === "redirect" ? "The redirect " : ""}${winner.pattern} answers /llms.txt` };
}

/**
 * Applies the resolved-route fact to a configuration classification. Only a
 * route fact naming no route makes Shipit the owner; without one the
 * classification stays `unsettled`.
 */
export function settleLlmsTxtInstallation(classified: LlmsTxtInstallation, route: LlmsTxtRouteFact | null): LlmsTxtInstallation {
	if (classified.owner !== "unsettled" || !route) return classified;
	if (route.winner === "other") return { ...classified, owner: "competing-route", detail: route.detail };
	return { ...classified, owner: "shipit", detail: null };
}
