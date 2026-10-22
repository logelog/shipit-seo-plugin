import { existsSync } from "node:fs";
import type { AstroIntegration } from "astro";
import type { IndexNowKeyRoute } from "./indexnow.ts";

export const INDEXNOW_INTEGRATION_NAME = "shipit-seo-indexnow";
export const INDEXNOW_KEY_ROUTE_PATTERN = "/indexnow-key.txt";
export const INDEXNOW_KEY_ROUTE_ENTRYPOINT = new URL(
	import.meta.url.endsWith(".ts") ? "./indexnow-route.ts" : "./indexnow-route.js",
	import.meta.url,
);

/** A public file or conventional Astro page that already serves the key path keeps that ownership. */
export function hasIndexNowKeyRouteFile(config: { publicDir: URL; srcDir: URL }): boolean {
	return [
		new URL("indexnow-key.txt", config.publicDir),
		...[
			"indexnow-key.txt.ts", "indexnow-key.txt.js", "indexnow-key.txt.astro",
			"indexnow-key.txt/index.ts", "indexnow-key.txt/index.js", "indexnow-key.txt/index.astro",
		].map((path) => new URL(`pages/${path}`, config.srcDir)),
	].some((path) => existsSync(path));
}

export interface IndexNowResolvedKeyRoute {
	patternRegex: RegExp;
	entrypoint?: string;
}

/** The first matching resolved route owns the response, including redirects. */
export function settleIndexNowKeyRoute(
	classified: IndexNowKeyRoute,
	routes: readonly IndexNowResolvedKeyRoute[],
	isShipit: (entrypoint: string) => boolean,
): IndexNowKeyRoute {
	if (classified !== "injected") return classified;
	const winner = routes.find((route) => route.patternRegex.test(INDEXNOW_KEY_ROUTE_PATTERN) ||
		route.patternRegex.test(INDEXNOW_KEY_ROUTE_PATTERN + "/"));
	if (!winner) return "unavailable";
	return typeof winner.entrypoint === "string" && isShipit(winner.entrypoint) ? "injected" : "existing";
}

export function seoIndexNow(): AstroIntegration {
	return {
		name: INDEXNOW_INTEGRATION_NAME,
		hooks: {
			"astro:config:setup": ({ config, injectRoute }) => {
				if (config.base !== "/") {
					throw new Error("seoIndexNow requires an Astro site mounted at the root path.");
				}
				if (config.integrations.filter((item) => item.name === INDEXNOW_INTEGRATION_NAME).length > 1) {
					throw new Error("Configure seoIndexNow only once.");
				}
				if (hasIndexNowKeyRouteFile(config)) return;
				injectRoute({
					pattern: INDEXNOW_KEY_ROUTE_PATTERN,
					entrypoint: INDEXNOW_KEY_ROUTE_ENTRYPOINT,
					prerender: false,
				});
			},
		},
	};
}
