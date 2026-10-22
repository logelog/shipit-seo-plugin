import {
	OptionsRepository,
	PluginStorageRepository,
	adaptSandboxEntry,
	createContentAccess,
	createSettingsAccess,
	getSeoMeta,
	type PluginDescriptor,
	type ResolvedPlugin,
} from "emdash";

import {
	seoAdminPage,
	seoBranding,
	seoInstallation,
	seoLlmsTxtInstallation,
	seoPlugin,
	seoRobotsInstallation,
	seoSitemapInstallation,
	type SeoPluginOptions,
} from "./index.ts";
import { createLinkNativeHostFactory } from "./internal-link-native-host.ts";
import { createNativeCoexistenceHost } from "./plugin-coexistence-native-host.ts";
import { markOwnMetadataContributions } from "./plugin-coexistence-metadata.ts";
import { createSeoEngine } from "./sandbox-entry.ts";
import type { ScoreScanHost } from "./score-scan.ts";
import { createNativeScoreScanAcceptance } from "./score-scan-native-acceptance.ts";
import { createNativeScoreScanSource } from "./score-scan-native-source.ts";
import type { SitemapSeoUrlResolver } from "./sitemap-engine.ts";
import { createNativeSitemapSource } from "./sitemap-native-source.ts";
import type { SitemapHost } from "./sitemap-runtime.ts";

// Same resolution as public pages: EmDash's own image and canonical rules.
const seoUrls: SitemapSeoUrlResolver = (seo, siteUrl, path) => {
	const meta = getSeoMeta(
		{ data: {}, seo: { title: null, description: null, image: seo.image, canonical: seo.canonical, noIndex: false } },
		{ siteUrl, path },
	);
	return { image: meta.ogImage, canonical: meta.canonical };
};

function nativeSitemapHost(options: SeoPluginOptions): SitemapHost | undefined {
	const installation = seoSitemapInstallation(options);
	if (!installation) return undefined;
	// Only a public HTTPS site without path or port, as IndexNow validated it.
	const site = seoInstallation(options);
	return {
		installation,
		publicOrigin: site.siteIssue === null ? site.siteUrl : null,
		seoUrls,
		// Loaded on first use: the runtime module needs Astro's virtual modules.
		async openSource() {
			const { getDb } = await import("emdash/runtime");
			return createNativeSitemapSource(await getDb());
		},
	};
}

// Loaded on first use: the runtime module needs Astro's virtual modules.
async function hostDatabase() {
	const { getDb } = await import("emdash/runtime");
	return getDb();
}

function nativeScoreScanHost(descriptor: PluginDescriptor): ScoreScanHost {
	return {
		async openSource() {
			return createNativeScoreScanSource(await hostDatabase());
		},
		async openAcceptance(ctx) {
			return createNativeScoreScanAcceptance({
				db: await hostDatabase(),
				pluginId: ctx.plugin.id,
				pluginVersion: ctx.plugin.version,
				repositories: { PluginStorageRepository, OptionsRepository, createSettingsAccess, createContentAccess },
				storage: descriptor.storage ?? {},
				site: ctx.site,
				log: ctx.log,
			});
		},
	};
}

export function createPlugin(options: SeoPluginOptions = {}): ResolvedPlugin {
	const descriptor = seoPlugin(options);
	const branding = seoBranding(options);
	if (branding.kind === "invalid") {
		console.warn("SEO plugin branding options cannot be read; the admin shows the label SEO without a logo. Check branding in the Astro configuration and rebuild.");
	}
	const sitemap = nativeSitemapHost(options);
	const robots = seoRobotsInstallation(options);
	const llmsTxt = seoLlmsTxtInstallation(options);
	const engine = adaptSandboxEntry(
		createSeoEngine(seoInstallation(options), {
			...(sitemap ? { sitemap } : {}),
			...(robots ? { robots } : {}),
			...(llmsTxt ? { llmsTxt } : {}),
			scoreScan: nativeScoreScanHost(descriptor),
			...(branding.kind === "configured" ? { branding: branding.branding } : {}),
			internalLinks: createLinkNativeHostFactory({ openDatabase: hostDatabase }),
			coexistence: createNativeCoexistenceHost({
				openDatabase: hostDatabase,
				configured: options.installation?.configuredPlugins === undefined ? [] : options.installation.configuredPlugins,
			}),
		}),
		descriptor,
	);
	const metadata = engine.hooks?.["page:metadata"];
	return {
		...engine,
		hooks: {
			...engine.hooks,
			...(metadata ? {
				"page:metadata": {
					...metadata,
					async handler(...args: Parameters<typeof metadata.handler>) {
						const contributions = await metadata.handler(...args);
						markOwnMetadataContributions(contributions);
						return contributions;
					},
				},
			} : {}),
		},
		admin: {
			...engine.admin,
			entry: "@shipitseo/emdash-plugin-seo/admin",
			pages: [seoAdminPage(branding)],
		},
	};
}

export default createPlugin;
