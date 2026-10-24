// Build-time installation adapter. It runs in the site's Astro config process,
// never in the plugin runtime, and binds only what the site configuration says.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AstroIntegration } from "astro";
import type { PluginDescriptor } from "emdash";

import { SEO_ENGINE_PLUGIN_ID } from "./admin-contract.ts";
import { SEO_BRAND_NAME_COMFORTABLE_LENGTH, seoBrandNameLength } from "./branding.ts";
import { checkShipitSeoOptions, resolveSeoBranding, type ShipitSeoOptions } from "./branding-files.ts";
import { checkContentAnalysisOptions } from "./content-body-mapping.ts";
import { seoPlugin } from "./index.ts";
import { classifyIndexNowSite, type IndexNowKeyRoute, type IndexNowSiteIssue } from "./indexnow.ts";
import { listLlmsTxtDirectory } from "./llms-txt-files.ts";
import { inspectPublicFiles } from "./public-file-inspection.ts";
import {
	LLMS_TXT_NATIVE_HOST_VERSIONS,
	classifyLlmsTxtInstallation,
	llmsTxtRouteFact,
	settleLlmsTxtInstallation,
	type LlmsTxtInstallation,
	type LlmsTxtRouteFact,
} from "./llms-txt-installation.ts";
import {
	classifyRobotsInstallation,
	emdashSiteUrlOrigin,
	isRobotsName,
	isRobotsPageEntry,
	robotsRouteFact,
	settleRobotsInstallation,
	type RobotsInstallation,
	type RobotsRouteFact,
} from "./robots-installation.ts";
import {
	INDEXNOW_INTEGRATION_NAME,
	INDEXNOW_KEY_ROUTE_ENTRYPOINT,
	INDEXNOW_KEY_ROUTE_PATTERN,
	hasIndexNowKeyRouteFile,
	settleIndexNowKeyRoute,
	type IndexNowResolvedKeyRoute,
} from "./indexnow-integration.ts";
import {
	SITEMAP_NATIVE_HOST_VERSIONS,
	classifySitemapInstallation,
	isSitemapStaticFile,
	sitemapPageAddress,
	sitemapRouteWinner,
	type AstroI18nShape,
	type SitemapInstallation,
} from "./sitemap-installation.ts";

const SITEMAP_MIDDLEWARE_ENTRYPOINT = new URL(
	import.meta.url.endsWith(".ts") ? "./sitemap-middleware-entry.ts" : "./sitemap-middleware-entry.js",
	import.meta.url,
);
const COEXISTENCE_MIDDLEWARE_ENTRYPOINT = new URL(
	import.meta.url.endsWith(".ts") ? "./plugin-coexistence-middleware-entry.ts" : "./plugin-coexistence-middleware-entry.js",
	import.meta.url,
);
const SITEMAP_OWNER_MODULE = "virtual:shipit-seo/sitemap-owner";
const RESOLVED_SITEMAP_OWNER_MODULE = `\0${SITEMAP_OWNER_MODULE}`;
const LLMS_TXT_MIDDLEWARE_ENTRYPOINT = new URL(
	import.meta.url.endsWith(".ts") ? "./llms-txt-middleware-entry.ts" : "./llms-txt-middleware-entry.js",
	import.meta.url,
);
const LLMS_TXT_OWNER_MODULE = "virtual:shipit-seo/llms-txt-owner";
const RESOLVED_LLMS_TXT_OWNER_MODULE = `\0${LLMS_TXT_OWNER_MODULE}`;

export type { SeoContentAnalysisOptions, SeoBodyMapping, SeoBodyBlock, SeoBodyField } from "./content-body-mapping.ts";
export type { ShipitSeoBranding, ShipitSeoOptions } from "./branding-files.ts";

interface EmDashConfigShape {
	plugins?: readonly unknown[];
	sandboxed?: readonly unknown[];
	siteUrl?: unknown;
}

const SITE_WARNINGS: Record<IndexNowSiteIssue, string> = {
	missing: "Astro's site option is not set",
	local: "Astro's site option is a local address",
	"not-https": "Astro's site option does not use HTTPS",
	path: "Astro's site option has a path, query or fragment",
	port: "Astro's site option uses a nonstandard port",
	"not-public": "Astro's site option is not a public domain name",
};

// EmDash's version decides whether the native source matches its schema.
function installedEmDashVersion(root: URL): string | null {
	try {
		let directory = new URL(".", pathToFileURL(createRequire(new URL("package.json", root)).resolve("emdash")));
		for (let depth = 0; depth < 6; depth += 1) {
			const manifest = new URL("package.json", directory);
			if (existsSync(manifest)) {
				const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown; version?: unknown };
				if (parsed.name === "emdash") return typeof parsed.version === "string" ? parsed.version : null;
			}
			directory = new URL("..", directory);
		}
	} catch {
		// An unresolvable host is reported as an unsupported version.
	}
	return null;
}

interface SitemapConfigShape {
	root: URL;
	srcDir: URL;
	publicDir: URL;
	base?: unknown;
	trailingSlash?: unknown;
	i18n?: unknown;
	integrations?: readonly ({ name?: string } | null | undefined)[];
}

function classifySitemap(config: SitemapConfigShape, emdashVersion: string | null): SitemapInstallation {
	const pages = new URL("pages/", config.srcDir);
	return classifySitemapInstallation({
		emdashVersion,
		...inspectPublicFiles(config.publicDir, pages, { address: isSitemapStaticFile, page: (entry) => sitemapPageAddress(entry) !== null }),
		integrations: (config.integrations ?? []).map((item) => item?.name ?? "").filter(Boolean),
		base: config.base,
		trailingSlash: config.trailingSlash,
		i18n: (config.i18n ?? null) as AstroI18nShape | null,
	});
}

// EmDash's own sitemap routes resolve to files inside its package.
function isEmDashCoreEntrypoint(entrypoint: string): boolean {
	return /(?:^|[\\/])emdash[\\/](?:dist|src)[\\/]/.test(entrypoint) || entrypoint.startsWith("emdash/");
}

function isEmDashRobotsRoute(route: { entrypoint?: string }): boolean {
	return typeof route.entrypoint === "string" && isEmDashCoreEntrypoint(route.entrypoint) &&
		/[\\/]robots\.txt\.(?:mjs|js|ts)$/.test(route.entrypoint);
}

function classifyRobots(config: SitemapConfigShape, emdashVersion: string | null, emdashSiteUrl: string | null): RobotsInstallation {
	const pages = new URL("pages/", config.srcDir);
	return classifyRobotsInstallation({
		emdashVersion,
		...inspectPublicFiles(config.publicDir, pages, { address: isRobotsName, page: isRobotsPageEntry }),
		integrations: (config.integrations ?? []).map((item) => item?.name ?? "").filter(Boolean),
		base: config.base,
		emdashSiteUrl,
	});
}

function classifyLlmsTxt(config: SitemapConfigShape, emdashVersion: string | null): LlmsTxtInstallation {
	return classifyLlmsTxtInstallation({
		emdashVersion,
		publicDirectory: listLlmsTxtDirectory(config.publicDir),
		pagesDirectory: listLlmsTxtDirectory(new URL("pages/", config.srcDir)),
		integrations: (config.integrations ?? []).map((item) => item?.name ?? "").filter(Boolean),
		base: config.base,
		i18n: config.i18n,
	});
}

/**
 * The file a resolved route entrypoint names: a file URL, an absolute path, or
 * a path relative to the project root. Null when it cannot be resolved without
 * the process directory.
 */
function routeEntrypointFile(entrypoint: string, root: URL | null): string | null {
	try {
		if (!entrypoint || entrypoint.includes("\0")) return null;
		if (entrypoint.startsWith("file:")) return fileURLToPath(entrypoint);
		const windows = process.platform === "win32";
		if (windows ? /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(entrypoint) : entrypoint.startsWith("/"))
			return fileURLToPath(pathToFileURL(entrypoint));
		// Drive-relative and root-relative Windows paths depend on the process directory.
		if (windows && /^(?:[A-Za-z]:|[\\/])/.test(entrypoint)) return null;
		if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(entrypoint)) return null;
		if (!root || root.protocol !== "file:") return null;
		const base = fileURLToPath(root);
		return fileURLToPath(pathToFileURL(/[\\/]$/.test(base) ? base + entrypoint : `${base}/${entrypoint}`));
	} catch {
		return null;
	}
}

// Ownership uses the exact normalized entrypoint, without filesystem alias resolution.
function isShipitKeyRouteFile(file: string): boolean {
	try {
		return pathToFileURL(file).href === pathToFileURL(fileURLToPath(INDEXNOW_KEY_ROUTE_ENTRYPOINT)).href;
	} catch {
		return false;
	}
}

function isSeoDescriptor(value: unknown): boolean {
	return Boolean(value) && typeof value === "object" && (value as { id?: unknown }).id === SEO_ENGINE_PLUGIN_ID;
}

/**
 * Installs EmDash with Shipit SEO through one Astro integration.
 *
 * `shipitSeo(emdash, config)` replaces `emdash(config)`. It registers the plugin
 * once, keeps every other EmDash option and plugin, and during Astro's config
 * setup binds IndexNow to Astro's `site`: network access to that one hostname
 * and the root `/indexnow-key.txt` route. The descriptor is completed before
 * EmDash's own setup hook runs, which is before EmDash generates its plugin
 * module. A non-public `site` installs the plugin without that permission.
 *
 * On a verified EmDash version it also adds the sitemap middleware after
 * EmDash's own. Who answers /sitemap.xml is recorded from the final Astro
 * configuration and resolved routes; the middleware passes every request
 * through unless that record names Shipit SEO. Who answers /robots.txt is
 * recorded the same way; Shipit SEO never serves that file. /llms.txt has its
 * own middleware: it answers only when no page, public file, integration,
 * route or redirect can, and passes every request through otherwise.
 *
 * The optional third argument names the admin menu entry and workspace and
 * sets their logo: `shipitSeo(emdash, config, { branding: { name, logo } })`.
 * Logo files are checked in `public/` at config setup and again against the
 * final configuration; any invalid value stops the build.
 */
export function shipitSeo<Config extends EmDashConfigShape>(
	emdash: (config: Config) => AstroIntegration,
	config: Config = {} as Config,
	options?: ShipitSeoOptions,
): AstroIntegration {
	if (typeof emdash !== "function") {
		throw new Error("Pass EmDash's Astro integration: shipitSeo(emdash, config).");
	}
	const brandingShape = checkShipitSeoOptions(options);
	const contentAnalysis = checkContentAnalysisOptions(options?.contentAnalysis);
	if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
		throw new Error("EmDash plugins must be a list.");
	}
	if ([...(config.plugins ?? []), ...(config.sandboxed ?? [])].some(isSeoDescriptor)) {
		throw new Error("Remove seoPlugin() from the EmDash plugin lists. shipitSeo() registers the SEO plugin once.");
	}
	// A private copy, completed in place below; the shared descriptor never changes.
	const descriptor: PluginDescriptor = { ...seoPlugin() };
	let installedOptions: Parameters<typeof seoPlugin>[0] | null = null;
	let emdashVersion: string | null = null;
	let classified: SitemapInstallation | null = null;
	let competingRoute: string | null = null;
	const emdashSiteUrl = emdashSiteUrlOrigin(config.siteUrl);
	let robotsClassified: RobotsInstallation | null = null;
	let robotsRoute: RobotsRouteFact | null = null;
	let llmsClassified: LlmsTxtInstallation | null = null;
	let llmsRoute: LlmsTxtRouteFact | null = null;
	let keyRouteClassified: IndexNowKeyRoute | null = null;
	let keyRoutes: readonly IndexNowResolvedKeyRoute[] | null = null;
	// Resolved entrypoints may be relative to the project root, which is final only at astro:config:done.
	let projectRoot: URL | null = null;
	// A route that wins a sitemap address keeps it; otherwise the latest
	// configuration facts decide. Plugin options are serialized when Vite loads
	// the plugin module, after both of these hooks have run.
	const settleSitemap = () => {
		if (!installedOptions?.installation || !classified) return;
		if (keyRouteClassified !== null && keyRoutes !== null) {
			installedOptions.installation.keyRoute = settleIndexNowKeyRoute(keyRouteClassified, keyRoutes, (entrypoint) => {
				const file = routeEntrypointFile(entrypoint, projectRoot);
				return file !== null && isShipitKeyRouteFile(file);
			});
		}
		installedOptions.installation.sitemap = competingRoute && classified.owner === "shipit"
			? { owner: "competing-route", detail: competingRoute, routing: classified.routing }
			: classified;
		// Unsettled until the resolved routes name EmDash's own route.
		if (robotsClassified) installedOptions.installation.robots = settleRobotsInstallation(robotsClassified, robotsRoute);
		// Unsettled, and so not served by Shipit, until the resolved routes are recorded.
		if (llmsClassified) installedOptions.installation.llmsTxt = settleLlmsTxtInstallation(llmsClassified, llmsRoute);
		Object.assign(descriptor, seoPlugin(installedOptions));
	};
	const integration = emdash({ ...config, plugins: [...(config.plugins ?? []), descriptor] });
	const setup = integration?.hooks?.["astro:config:setup"];
	if (integration?.name !== "emdash" || typeof setup !== "function") {
		throw new Error("shipitSeo() expects EmDash's Astro integration: shipitSeo(emdash, config).");
	}
	integration.hooks["astro:config:setup"] = async (params) => {
		const { config: astroConfig, injectRoute, logger } = params;
		const integrations = astroConfig.integrations ?? [];
		if (integrations.filter((item) => item?.name === "emdash").length !== 1) {
			throw new Error("Configure EmDash once. shipitSeo(emdash, config) replaces a separate emdash() integration.");
		}
		const site = classifyIndexNowSite(astroConfig.site);
		const keyRoute: IndexNowKeyRoute = astroConfig.base !== "/"
			? "unavailable"
			: integrations.some((item) => item?.name === INDEXNOW_INTEGRATION_NAME) || hasIndexNowKeyRouteFile(astroConfig)
				? "existing"
				: "injected";
		keyRouteClassified = keyRoute;
		emdashVersion = installedEmDashVersion(astroConfig.root);
		classified = classifySitemap(astroConfig, emdashVersion);
		robotsClassified = classifyRobots(astroConfig, emdashVersion, emdashSiteUrl);
		llmsClassified = classifyLlmsTxt(astroConfig, emdashVersion);
		const branding = brandingShape ? await resolveSeoBranding(brandingShape, astroConfig) : null;
		installedOptions = {
			...(site.siteUrl ? { siteUrl: site.siteUrl } : {}),
			installation: {
				siteOrigin: site.siteOrigin,
				siteIssue: site.issue,
				keyRoute,
				sitemap: classified,
				robots: settleRobotsInstallation(robotsClassified, robotsRoute),
				llmsTxt: settleLlmsTxtInstallation(llmsClassified, llmsRoute),
				configuredPlugins: [...(config.plugins ?? []), ...(config.sandboxed ?? [])].length > 28
					? null
					: [...(config.plugins ?? []), ...(config.sandboxed ?? [])].map((plugin) => {
						const peer = plugin && typeof plugin === "object" ? plugin as Record<string, unknown> : {};
						const field = (name: string, limit: number) => typeof peer[name] === "string"
							? (peer[name] as string).slice(0, limit + 1) : null;
						return { id: field("id", 128), entrypoint: field("entrypoint", 512), version: field("version", 128) };
					}),
				...(branding ? { branding } : {}),
				...(contentAnalysis ? { contentAnalysis } : {}),
			},
		};
		Object.assign(descriptor, seoPlugin(installedOptions));
		if (keyRoute === "injected") {
			injectRoute({ pattern: INDEXNOW_KEY_ROUTE_PATTERN, entrypoint: INDEXNOW_KEY_ROUTE_ENTRYPOINT, prerender: false });
		}
		if (site.issue) logger.warn(`${SITE_WARNINGS[site.issue]}, so IndexNow stays unavailable on this build.`);
		if (keyRoute === "unavailable") logger.warn("IndexNow needs a site mounted at the root path to serve /indexnow-key.txt.");
		if (branding && seoBrandNameLength(branding.name) > SEO_BRAND_NAME_COMFORTABLE_LENGTH) {
			logger.warn(`branding.name ${JSON.stringify(branding.name)} is longer than ${SEO_BRAND_NAME_COMFORTABLE_LENGTH} characters, so the workspace heading wraps and the admin menu may shorten it.`);
		}
		await setup(params);
		if (emdashVersion === "1.3.0" || emdashVersion === "1.3.1") {
			params.addMiddleware({ entrypoint: COEXISTENCE_MIDDLEWARE_ENTRYPOINT, order: "pre" });
		}
		// Added after EmDash's own `pre` middleware, so its runtime is initialized
		// first. Later hooks may still change the owner, so it is added whenever
		// the native source matches the installed EmDash version.
		if (emdashVersion && SITEMAP_NATIVE_HOST_VERSIONS.includes(emdashVersion)) {
			// Loaded by Vite after the configuration and routes are final.
			params.updateConfig({
				vite: {
					plugins: [{
						name: "shipit-seo:sitemap-owner",
						resolveId: (id: string) => (id === SITEMAP_OWNER_MODULE ? RESOLVED_SITEMAP_OWNER_MODULE : undefined),
						load: (id: string) => (id === RESOLVED_SITEMAP_OWNER_MODULE
							? `export default ${JSON.stringify(installedOptions?.installation?.sitemap?.owner ?? "unsupported-host")};`
							: undefined),
					}],
				},
			});
			params.addMiddleware({ entrypoint: SITEMAP_MIDDLEWARE_ENTRYPOINT, order: "pre" });
		}
		if (emdashVersion && LLMS_TXT_NATIVE_HOST_VERSIONS.includes(emdashVersion)) {
			params.updateConfig({
				vite: {
					plugins: [{
						name: "shipit-seo:llms-txt-owner",
						resolveId: (id: string) => (id === LLMS_TXT_OWNER_MODULE ? RESOLVED_LLMS_TXT_OWNER_MODULE : undefined),
						load: (id: string) => (id === RESOLVED_LLMS_TXT_OWNER_MODULE
							? `export default ${JSON.stringify(installedOptions?.installation?.llmsTxt?.owner ?? "unsupported-host")};`
							: undefined),
					}],
				},
			});
			params.addMiddleware({ entrypoint: LLMS_TXT_MIDDLEWARE_ENTRYPOINT, order: "pre" });
		}
	};
	// Later integrations can still change base, i18n, trailingSlash or the
	// public directory; the final configuration decides the recorded facts.
	const done = integration.hooks["astro:config:done"];
	integration.hooks["astro:config:done"] = async (params) => {
		projectRoot = params.config.root;
		classified = classifySitemap(params.config, emdashVersion);
		robotsClassified = classifyRobots(params.config, emdashVersion, emdashSiteUrl);
		llmsClassified = classifyLlmsTxt(params.config, emdashVersion);
		if (brandingShape && installedOptions?.installation) {
			installedOptions.installation.branding = await resolveSeoBranding(brandingShape, params.config);
		}
		settleSitemap();
		if (classified.owner !== "shipit") {
			params.logger.info(`The SEO plugin leaves /sitemap.xml unchanged (${classified.owner}: ${classified.detail ?? "not available"}).`);
		}
		return done?.(params);
	};
	// Another integration's injected route keeps its sitemap. Plugin options are
	// serialized when Vite loads the plugin module, after routes resolve, so the
	// runtime passes those requests through.
	const resolved = integration.hooks["astro:routes:resolved"];
	integration.hooks["astro:routes:resolved"] = async (params) => {
		competingRoute = sitemapRouteWinner(params.routes, (route) => isEmDashCoreEntrypoint(route.entrypoint));
		robotsRoute = robotsRouteFact(params.routes, isEmDashRobotsRoute);
		llmsRoute = llmsTxtRouteFact(params.routes);
		keyRoutes = params.routes;
		settleSitemap();
		const robots = installedOptions?.installation?.robots;
		if (robots && robots.owner !== "emdash-core") {
			params.logger.info(`The Robots.txt editor is read-only on this build (${robots.owner}: ${robots.detail ?? "not available"}).`);
		}
		const llmsTxt = installedOptions?.installation?.llmsTxt;
		if (llmsTxt && llmsTxt.owner !== "shipit") {
			params.logger.info(`The SEO plugin leaves /llms.txt unchanged (${llmsTxt.owner}: ${llmsTxt.detail ?? "not available"}).`);
		}
		if (competingRoute && classified?.owner === "shipit") {
			params.logger.warn(`${competingRoute}, so the SEO plugin leaves the sitemap unchanged.`);
		}
		return resolved?.(params);
	};
	return integration;
}
