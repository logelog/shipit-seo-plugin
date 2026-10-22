// Robots.txt policy for EmDash's core `/robots.txt` route. Shared by the native
// editor and a later sandbox editor: no React, DOM, Node, SQL or network
// imports. These rules mirror the verified released core routes, which own
// the file; nothing here serves or stores robots.txt.

/**
 * EmDash 1.1.0 validates `z.string().max(5000)` with zod 4.5.4, which counts
 * Unicode code points: a surrogate pair once, a lone surrogate as one.
 */
export const ROBOTS_TXT_MAX_CODE_POINTS = 5_000;

/** Core answers this when it has no database or its settings read fails. */
export const ROBOTS_TXT_CORE_FALLBACK_BODY = "User-agent: *\nAllow: /\n";

/** Cache-Control on core's stored and default bodies; the fallback sends none. */
export const ROBOTS_TXT_CACHE_CONTROL = "public, max-age=86400";

/** Crawlers read robots.txt only at the root of a host. */
export const ROBOTS_TXT_PATH = "/robots.txt";

const TRAILING_SLASH = /\/$/;

export type RobotsSitemapOriginSource = "site-settings" | "emdash-config" | "environment" | "request";

export interface RobotsConfiguredOrigin {
	origin: string;
	source: "emdash-config" | "environment";
}

export interface RobotsSitemapBase {
	/** Text placed before `/sitemap.xml`. */
	base: string;
	source: RobotsSitemapOriginSource;
}

function httpOrigin(value: unknown): string | null {
	if (typeof value !== "string" || !value) return null;
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
	} catch {
		return null;
	}
}

/**
 * The origin core uses when EmDash's Site settings URL is empty:
 * `config.siteUrl` (already an origin), then `EMDASH_SITE_URL || SITE_URL`
 * reduced to its origin. An invalid first environment value does not fall
 * through to the second one, exactly as in core.
 */
export function robotsConfiguredOrigin(
	emdashSiteUrl: string | null | undefined,
	env: Readonly<Record<string, string | undefined>> | null | undefined,
): RobotsConfiguredOrigin | null {
	if (emdashSiteUrl) return { origin: emdashSiteUrl, source: "emdash-config" };
	const value = env?.EMDASH_SITE_URL || env?.SITE_URL || "";
	const origin = httpOrigin(value);
	return origin ? { origin, source: "environment" } : null;
}

/**
 * Core's sitemap base: `(settings.url || getPublicOrigin(url, config))` with
 * one trailing slash removed. `settings.url` is used literally, so a path in
 * it is kept. The request origin is the address of the request that reads
 * /robots.txt, which differs between hosts and behind proxies.
 */
export function robotsSitemapBase(input: {
	settingsUrl: string | null | undefined;
	configuredOrigin: RobotsConfiguredOrigin | null;
	requestOrigin: string;
}): RobotsSitemapBase {
	if (input.settingsUrl) return { base: input.settingsUrl.replace(TRAILING_SLASH, ""), source: "site-settings" };
	if (input.configuredOrigin) {
		return { base: input.configuredOrigin.origin.replace(TRAILING_SLASH, ""), source: input.configuredOrigin.source };
	}
	return { base: input.requestOrigin.replace(TRAILING_SLASH, ""), source: "request" };
}

export function robotsSitemapUrl(base: string): string {
	return `${base}/sitemap.xml`;
}

export type RobotsEffectiveKind = "default" | "custom-with-sitemap" | "custom-with-ai-training" | "custom-verbatim";

export interface RobotsCorePolicy {
	hostVersion?: string | null;
	disallowAiTraining?: boolean;
}

const AI_TRAINING_RULES = [
	"# Disallow AI training",
	"User-agent: *",
	"Content-Signal: search=yes, ai-train=no",
	"Disallow:",
	...["Amazonbot", "Applebot-Extended", "Bytespider", "CCBot", "ClaudeBot", "Google-Extended", "GPTBot", "meta-externalagent"]
		.flatMap((agent) => ["", `User-agent: ${agent}`, "Disallow: /"]),
].join("\n");

export interface RobotsEffectiveFile {
	kind: RobotsEffectiveKind;
	/** The exact response body. */
	body: string;
	/** Leading part taken from the stored text; empty for the default body. */
	stored: string;
	/** Trailing part core adds; empty when the stored text is served verbatim. */
	added: string;
	/** Applied only by the verified 1.3.0 and 1.3.1 routes, from its core-owned setting. */
	disallowAiTraining: boolean;
}

/**
 * The body core serves for `seo.robotsTxt`. Empty or unset selects the default
 * allow-all body with the admin path excluded; whitespace-only text is custom.
 * Custom text containing `sitemap:` in any letter case, including inside a
 * comment, is served verbatim on 1.1/1.2. The 1.3 AI policy first appends
 * training rules after trimming custom text. A missing Sitemap directive is
 * appended last, after trimming again. Unknown hosts never opt into that policy.
 */
export function effectiveRobotsTxt(
	stored: string | null | undefined,
	sitemapBase: string,
	policy: RobotsCorePolicy = {},
): RobotsEffectiveFile {
	const disallowAiTraining = (policy.hostVersion === "1.3.0" || policy.hostVersion === "1.3.1") && policy.disallowAiTraining === true;
	const sitemapUrl = robotsSitemapUrl(sitemapBase);
	if (!stored) {
		const body = [
			"User-agent: *",
			"Allow: /",
			"",
			"# Disallow admin and API routes",
			"Disallow: /_emdash/",
			"",
			...(disallowAiTraining ? [AI_TRAINING_RULES, ""] : []),
			`Sitemap: ${sitemapUrl}`,
			"",
		].join("\n");
		return { kind: "default", body, stored: "", added: body, disallowAiTraining };
	}
	const hasSitemap = stored.toLowerCase().includes("sitemap:");
	if (hasSitemap && !disallowAiTraining) {
		return { kind: "custom-verbatim", body: stored, stored, added: "", disallowAiTraining };
	}
	const kept = stored.trimEnd();
	const training = disallowAiTraining ? `\n\n${AI_TRAINING_RULES}` : "";
	const added = hasSitemap ? `${training}\n` : `${training}\n\nSitemap: ${sitemapUrl}\n`;
	return { kind: hasSitemap ? "custom-with-ai-training" : "custom-with-sitemap", body: `${kept}${added}`, stored: kept, added, disallowAiTraining };
}

/** Code points as zod 4.5.4 counts them, so an emoji is one character. */
export function robotsTxtCodePoints(text: string): number {
	let count = text.length;
	for (let index = 0; index < text.length - 1; index += 1) {
		if ((text.charCodeAt(index) & 0xfc00) === 0xd800 && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
			count -= 1;
			index += 1;
		}
	}
	return count;
}

export function robotsTxtTooLong(text: string): boolean {
	return robotsTxtCodePoints(text) > ROBOTS_TXT_MAX_CODE_POINTS;
}

const OBSERVED_SITEMAP_BASE = /(?:^|\n)Sitemap: ([^\n]*)\/sitemap\.xml\n$/;

export type RobotsObservationResult =
	| { status: "matches" }
	| { status: "other-origin"; observedOrigin: string }
	| { status: "fallback" }
	| { status: "different" }
	| { status: "unavailable"; reason: "status" | "redirect" | "network" | "timeout" | "too-large" };

/** A bare `http(s)` origin: no path, query, credentials or trailing slash. */
export function isPlainHttpOrigin(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value;
	} catch {
		return false;
	}
}

/**
 * Compares one observed `/robots.txt` response with the body core would build
 * from the stored text and the expected Sitemap base. `matches` means the
 * whole body is identical. Two expected origins are estimates: a proxy can
 * hand core another request address, and core keeps the environment origin it
 * read first in its process while the estimate reads the current variables.
 * For those, a body that differs only by a plain HTTP(S) origin in the
 * Sitemap line is reported with that origin and is not a match.
 */
export function classifyRobotsObservation(input: {
	status: number;
	redirected?: boolean;
	body: string;
	stored: string | null | undefined;
	sitemapBase: RobotsSitemapBase;
} & RobotsCorePolicy): RobotsObservationResult {
	if (input.redirected) return { status: "unavailable", reason: "redirect" };
	if (input.status !== 200) return { status: "unavailable", reason: "status" };
	const expected = effectiveRobotsTxt(input.stored, input.sitemapBase.base, input);
	if (input.body === expected.body) return { status: "matches" };
	const estimated = input.sitemapBase.source === "request" || input.sitemapBase.source === "environment";
	if (estimated && (expected.kind === "default" || expected.kind === "custom-with-sitemap")) {
		const observedBase = OBSERVED_SITEMAP_BASE.exec(input.body)?.[1];
		if (observedBase !== undefined && isPlainHttpOrigin(observedBase) &&
			effectiveRobotsTxt(input.stored, observedBase, input).body === input.body) {
			return { status: "other-origin", observedOrigin: observedBase };
		}
	}
	if (input.body === ROBOTS_TXT_CORE_FALLBACK_BODY) return { status: "fallback" };
	return { status: "different" };
}
