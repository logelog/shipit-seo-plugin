import * as React from "react";
import { apiFetch, parseApiResponse } from "@emdash-cms/admin";
import { MagnifyingGlass } from "@phosphor-icons/react";

import { validSeoAdminBranding, type SeoAdminBranding } from "../branding.ts";
import { seoAdminApiUrl } from "./api-routes.ts";
import type { SeoAdminBrand } from "./brand-context.ts";
import { ShipitLogo } from "./shipit-logo.tsx";

export type SeoBrandLogoState =
	| { status: "loading" }
	| { status: "ready"; branding: SeoAdminBranding }
	| { status: "failed" };

export interface SeoBrandLogoReader {
	snapshot: () => SeoBrandLogoState;
	subscribe: (listener: () => void) => () => void;
	/** Starts the one read; later calls keep its outcome. */
	request: () => void;
}

/** One read per admin document; the logo addresses carry their content hash. */
export function createSeoBrandLogoReader(read: () => Promise<unknown>): SeoBrandLogoReader {
	let state: SeoBrandLogoState = { status: "loading" };
	let requested = false;
	const listeners = new Set<() => void>();
	const settle = (next: SeoBrandLogoState) => {
		state = next;
		for (const listener of listeners) listener();
	};
	return {
		snapshot: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		request() {
			if (requested) return;
			requested = true;
			read().then(
				(value) => {
					const branding = validSeoAdminBranding(value);
					settle(branding ? { status: "ready", branding } : { status: "failed" });
				},
				() => settle({ status: "failed" }),
			);
		},
	};
}

const brandLogoReader = createSeoBrandLogoReader(async () => {
	const response = await apiFetch(seoAdminApiUrl("admin-branding"), { cache: "no-store" });
	return parseApiResponse<unknown>(response, "The logo could not be read.");
});

/** The configured logo pair; nothing is requested for the default or fallback brand. */
export function useSeoBrandLogos(brand: SeoAdminBrand, reader: SeoBrandLogoReader = brandLogoReader): SeoBrandLogoState {
	const state = React.useSyncExternalStore(reader.subscribe, reader.snapshot, reader.snapshot);
	const configured = brand.kind === "configured";
	React.useEffect(() => {
		if (configured) reader.request();
	}, [configured, reader]);
	return state;
}

/**
 * The square mark beside the workspace name. A configured brand never shows
 * the built-in mark: its slot stays empty until its logo is read, and a brand
 * without a logo gets a neutral search glyph.
 */
export function SeoBrandMark({ brand, reader }: { brand: SeoAdminBrand; reader?: SeoBrandLogoReader }) {
	const logos = useSeoBrandLogos(brand, reader);
	const [broken, setBroken] = React.useState<readonly string[]>([]);
	if (brand.kind === "default") {
		return <span className="shipit-seo-product__icon" aria-hidden="true"><ShipitLogo /></span>;
	}
	if (brand.kind === "configured" && logos.status !== "ready") {
		return <span className="shipit-seo-product__icon shipit-seo-product__icon--pending" aria-hidden="true" data-logo={logos.status} />;
	}
	const { logo, logoDark } = brand.kind === "configured" && logos.status === "ready" ? logos.branding : { logo: null, logoDark: null };
	if (!logo) {
		return <span className="shipit-seo-product__icon shipit-seo-product__icon--neutral" aria-hidden="true"><MagnifyingGlass size={20} weight="bold" /></span>;
	}
	const image = (source: NonNullable<SeoAdminBranding["logo"]>, theme: "light" | "dark") => broken.includes(source.src) ? null : (
		<img className={`shipit-seo-product__logo shipit-seo-product__logo--${theme}`} src={source.src} alt="" width={source.width} height={source.height}
			decoding="async" draggable={false} onError={() => setBroken((current) => [...current, source.src])} />
	);
	// Without a readable dark variant the light logo is shown in both themes.
	const dark = logoDark && !broken.includes(logoDark.src) ? logoDark : null;
	return (
		<span className={`shipit-seo-product__icon shipit-seo-product__icon--image${dark ? " shipit-seo-product__icon--themed" : ""}`} aria-hidden="true">
			{image(logo, "light")}
			{dark ? image(dark, "dark") : null}
		</span>
	);
}
