import * as React from "react";
import { SEO_ENGINE_PLUGIN_ID } from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	SEO_DEFAULT_BRAND_NAME,
	SEO_FALLBACK_BRAND_NAME,
	normalizeSeoBrandName,
	seoBrandNameProblem,
} from "../branding.ts";
import { SEO_HOST_MANIFEST_KEY } from "./plugin-availability-model.ts";

/**
 * The name the admin shows for this plugin. `default` keeps the built-in mark;
 * `configured` is the site's own name; `fallback` is shown when the name
 * cannot be read and never names the default product.
 */
export interface SeoAdminBrand {
	kind: "default" | "configured" | "fallback";
	name: string;
}

export const SEO_FALLBACK_BRAND: SeoAdminBrand = Object.freeze({ kind: "fallback", name: SEO_FALLBACK_BRAND_NAME });
const SEO_DEFAULT_BRAND: SeoAdminBrand = Object.freeze({ kind: "default", name: SEO_DEFAULT_BRAND_NAME });

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The label of this plugin's admin page in the EmDash admin manifest, which the server sets from branding. */
export function seoAdminBrandFromManifest(manifest: unknown): SeoAdminBrand {
	if (!isRecord(manifest) || !isRecord(manifest.plugins) || !Object.hasOwn(manifest.plugins, SEO_ENGINE_PLUGIN_ID)) return SEO_FALLBACK_BRAND;
	const entry = manifest.plugins[SEO_ENGINE_PLUGIN_ID];
	const pages = isRecord(entry) && Array.isArray(entry.adminPages) ? entry.adminPages : [];
	const page = pages.find((item) => isRecord(item) && item.path === "/seo");
	const label = isRecord(page) ? page.label : undefined;
	if (label === SEO_DEFAULT_BRAND_NAME) return SEO_DEFAULT_BRAND;
	if (typeof label !== "string" || normalizeSeoBrandName(label) !== label || seoBrandNameProblem(label)) return SEO_FALLBACK_BRAND;
	return { kind: "configured", name: label };
}

const SeoBrandContext = React.createContext<SeoAdminBrand>(SEO_FALLBACK_BRAND);

/** Every surface that names the plugin reads this one value. */
export const SeoBrandProvider = SeoBrandContext.Provider;

export function useSeoBrand(): SeoAdminBrand {
	return React.useContext(SeoBrandContext);
}

interface HostManifestCache {
	getQueryCache(): { subscribe(listener: () => void): () => void };
	getQueryData(key: readonly unknown[]): unknown;
}

/** The brand from the host admin's cached manifest; reading it sends no request. */
export function useSeoHostBrand(client: HostManifestCache | null | undefined): SeoAdminBrand {
	const subscribe = React.useCallback(
		(notify: () => void) => client ? client.getQueryCache().subscribe(notify) : () => {},
		[client],
	);
	const read = React.useCallback(() => client?.getQueryData(SEO_HOST_MANIFEST_KEY), [client]);
	const manifest = React.useSyncExternalStore(subscribe, read, read);
	return React.useMemo(() => seoAdminBrandFromManifest(manifest), [manifest]);
}
