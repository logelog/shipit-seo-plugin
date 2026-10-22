import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";
import { generateBaseSeoContributions, renderPageMetadata, resolvePageMetadata } from "emdash/page";

import { SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION, SEO_ADMIN_SETTINGS_STORAGE_VERSION, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import { SEO_ROBOTS_DIRECTIVE_KEYS } from "./meta-overrides.ts";
import { createSeoEngine } from "./sandbox-entry.ts";
import { defaultSettingsValues } from "./settings-state.ts";
import { taxonomyArchivePage } from "./taxonomy-archives.ts";

// Which robots directive each noindex source emits in the real page:metadata hook:
// site-wide noindex and the content type rule emit noindex,nofollow, a taxonomy archive
// rule adds noindex to the theme's directives, and a theme value that already carries
// noindex keeps its directives, written lowercase and comma-separated as every robots value is.
// Advanced entry directives extend whichever value applies, the theme's own one included.
const SITE = "https://example.com";
const clone = <T>(value: T): T => structuredClone(value);
function page(values: Partial<PublicPageContext> = {}): PublicPageContext {
	return { url: SITE + "/landing", path: "/landing", locale: "en", kind: "custom", pageType: "website",
		title: "Landing", description: "A custom landing page", canonical: SITE + "/landing", image: null,
		siteName: "Example practice", siteUrl: SITE, ...values };
}
const ENTRY_REFS = ["posts:retired-entry", "posts:live-entry"];
const entry = (noIndex: boolean) => ({ id: "live-entry", slug: "live", status: "published", locale: "en", updatedAt: "2026-10-18T00:00:00.000Z",
	data: { title: "A live post", excerpt: "A published entry" }, seo: { title: null, description: null, canonical: null, image: null, noIndex } });
const advanced = (ref: string, directives: string[]) => ({ storageVersion: SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION, ref, disabledPresets: [],
	updatedAt: "2026-10-18T00:00:00.000Z", robots: Object.fromEntries(SEO_ROBOTS_DIRECTIVE_KEYS.map((key) => [key, directives.includes(key)])) });
function fixture(options: { siteNoindex?: boolean; rule?: string[]; archive?: string[]; override?: Record<string, unknown>;
	directives?: string[]; entryNoindex?: boolean } = {}) {
	const stats = { writes: 0, network: 0 };
	const settings = { version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-18T00:00:00.000Z",
		...defaultSettingsValues({ siteName: "Example practice", siteUrl: SITE }), indexingPreferenceConfirmed: true,
		noindex: options.siteNoindex ?? false,
		...(options.rule === undefined ? {} : { contentTypeNoindex: [...options.rule] }),
		...(options.archive === undefined ? {} : { taxonomyArchiveNoindex: [...options.archive] }) };
	const refuse = async () => { stats.writes += 1; throw new Error("Metadata cannot write data."); };
	const definition = { slug: "posts", label: "Posts", routable: true, hasSeo: true, hidden: false };
	const store = (name: string) => ({
		get: async (key: string) => !ENTRY_REFS.includes(key) ? null
			: name === "overrides" && options.override ? clone(options.override)
				: name === "metaOverrides" && options.directives ? advanced(key, options.directives) : null,
		getMany: async () => new Map(), query: async () => ({ items: [], hasMore: false }), count: async () => 0,
		put: refuse, putMany: refuse, delete: refuse, deleteMany: refuse,
	});
	const ctx: any = {
		plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION }, site: { url: SITE, name: "Example practice", locale: "en" },
		kv: {
			get: async () => null,
			getVersioned: async (key: string) => key === "settings:global:v1" ? { revision: "fixture-settings", value: clone(settings) } : null,
			set: refuse, delete: refuse, compareAndSet: refuse, compareAndDelete: refuse,
		},
		storage: new Proxy({}, { get: (_target, name) => store(String(name)) }),
		// A retired entry the theme still renders: its page context names the collection, the content is gone.
		// Only the live entry is still stored.
		content: { get: async (_collection: string, id: string) => id === "live-entry" ? clone(entry(options.entryNoindex ?? false)) : null,
			getPublicUrl: async (_collection: string, id: string) => id === "live-entry" ? SITE + "/posts/live" : null,
			listCollections: async () => [definition] },
		schema: { getCollection: async () => definition, listCollections: async () => [definition] },
		taxonomies: new Proxy({}, { get: () => async () => { throw new Error("Public metadata cannot discover taxonomies."); } }),
		settings: { get: async () => null, getVersioned: async () => null, getAll: async () => ({}) },
		http: { fetch: async () => { stats.network += 1; throw new Error("No provider requests."); } },
		cron: { schedule: refuse, cancel: refuse },
		log: { warn() {}, info() {}, error() {} },
	};
	const engine = createSeoEngine();
	return {
		stats,
		async robots(input: PublicPageContext): Promise<string> {
			const output = await engine.hooks["page:metadata"].handler({ page: input }, ctx) as any[];
			assert.deepEqual([stats.writes, stats.network], [0, 0]);
			const merged = resolvePageMetadata([...output, ...generateBaseSeoContributions(input)]);
			const rendered = merged.meta.filter((item) => item.name === "robots").map((item) => item.content);
			assert.ok(rendered.length <= 1);
			assert.ok((renderPageMetadata(merged).match(/name="robots"/g) ?? []).length <= 1, "one robots tag reaches the page");
			return rendered[0] ?? "";
		},
	};
}

const written = (robots: string) => robots.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean).join(",");
const themed = (robots: string, values: Partial<PublicPageContext> = {}) => page({ ...values, seo: { robots } });
const retired = (robots?: string) => page({ kind: "content", pageType: "article", path: "/posts/retired", url: SITE + "/posts/retired",
	content: { collection: "posts", id: "retired-entry", slug: "retired" }, ...(robots ? { seo: { robots } } : {}) });
const live = (robots?: string) => page({ kind: "content", pageType: "article", path: "/posts/live", url: SITE + "/posts/live",
	title: "A live post", description: "A published entry", canonical: SITE + "/posts/live",
	content: { collection: "posts", id: "live-entry", slug: "live" }, ...(robots ? { seo: { robots } } : {}) });

// A theme value with noindex keeps its directives, including follow, instead of becoming noindex,nofollow.
for (const robots of ["noindex", "noindex, follow", "noindex,follow,noarchive", "NOINDEX, max-snippet:0"]) {
	assert.equal(await fixture().robots(themed(robots)), written(robots), robots + " is not rewritten to noindex,nofollow");
}
assert.equal(written("NOINDEX, max-snippet:0"), "noindex,max-snippet:0");
assert.equal(await fixture().robots(themed("index,follow,noarchive")), "index,follow,noarchive", "a theme value without noindex stays as written");
assert.equal(await fixture().robots(page()), "", "nothing is added to a page without a restriction");

// Shipit's own noindex sources keep their directive.
assert.equal(await fixture({ siteNoindex: true }).robots(page()), "noindex,nofollow", "site-wide noindex");
assert.equal(await fixture({ siteNoindex: true }).robots(themed("noindex, follow")), "noindex,nofollow", "site-wide noindex replaces the theme value");
assert.equal(await fixture({ rule: ["posts"] }).robots(retired()), "noindex,nofollow", "content type rule");
assert.equal(await fixture({ rule: ["posts"] }).robots(retired("noindex, follow")), "noindex,nofollow", "the content type rule replaces the theme value");
assert.equal(await fixture({ rule: ["pages"] }).robots(retired("noindex, follow")), "noindex,follow", "another type's rule leaves the theme value");
assert.equal(await fixture({ override: { robots: "noindex" } }).robots(retired()), "noindex,nofollow", "a legacy record's noindex keeps its directive");
assert.equal(await fixture({ override: { robots: "noarchive" } }).robots(retired("noindex, follow")), "noarchive",
	"a legacy record's robots still win over the theme value");

// On a live entry without a plugin noindex source or legacy robots, Advanced directives extend the theme's value.
for (const robots of ["noindex", "noindex, follow", "noindex,follow,noarchive", "NOINDEX, max-snippet:0", "noarchive"]) {
	assert.equal(await fixture().robots(live(robots)), written(robots), robots + " stays the live entry's robots value");
}
assert.equal(await fixture({ directives: ["nosnippet"] }).robots(live("noindex, follow")), "noindex,follow,nosnippet",
	"Advanced nosnippet keeps the theme's noindex on a live entry");
assert.equal(await fixture({ directives: ["nosnippet", "noimageindex"] }).robots(live("NoArchive")), "noarchive,nosnippet,noimageindex",
	"a theme value without noindex is kept under Advanced directives");
assert.equal(await fixture({ directives: ["nofollow"] }).robots(live("index, follow")), "index,nofollow",
	"an Advanced directive replaces its positive counterpart in the theme value");
assert.equal(await fixture({ directives: ["nosnippet"] }).robots(live()), "nosnippet", "Advanced directives alone on a live entry");
assert.equal(await fixture().robots(live()), "", "nothing is added to a live entry without a restriction");
assert.equal(await fixture({ directives: ["nosnippet"] }).robots(retired("noindex, follow")), "noindex,follow,nosnippet",
	"Advanced directives extend the theme value on a retired entry too");
assert.equal(await fixture({ siteNoindex: true }).robots(live("noindex, follow")), "noindex,nofollow", "site-wide noindex on a live entry");
assert.equal(await fixture({ siteNoindex: true, directives: ["nosnippet"] }).robots(live("noindex, follow")), "noindex,nofollow,nosnippet",
	"Advanced directives follow the site-wide directive on a live entry");
assert.equal(await fixture({ rule: ["posts"], directives: ["nosnippet"] }).robots(live("noindex, follow")), "noindex,nofollow,nosnippet",
	"the content type rule replaces the theme value on a live entry");
assert.equal(await fixture({ rule: ["pages"], directives: ["nosnippet"] }).robots(live("noindex, follow")), "noindex,follow,nosnippet",
	"another type's rule leaves the live entry's theme value");
// The host overlays core entry noindex onto page.seo.robots before the hook runs.
assert.equal(await fixture({ entryNoindex: true, directives: ["nosnippet"] }).robots(live("noindex, nofollow")), "noindex,nofollow,nosnippet",
	"core entry noindex on a live entry");
assert.equal(await fixture({ override: { robots: "noindex" } }).robots(live("noindex, follow")), "noindex,nofollow",
	"a legacy record's noindex keeps its directive on a live entry");
assert.equal(await fixture({ override: { robots: "NoArchive" }, directives: ["nosnippet"] }).robots(live("noindex, follow")), "noarchive,nosnippet",
	"a legacy record's robots still win over the live entry's theme value");

// A taxonomy archive rule adds noindex to the theme's directives without nofollow.
{
	const archive = taxonomyArchivePage(themed("index,follow,noarchive"), "category");
	assert.deepEqual((await fixture({ archive: ["category"] }).robots(archive)).split(","), ["follow", "noarchive", "noindex"]);
	assert.equal(await fixture({ archive: ["tag"] }).robots(taxonomyArchivePage(themed("noindex, follow"), "category")), "noindex,follow",
		"an archive the rule does not name keeps the theme value as written");
}

console.log("Head robots self-check passed (theme directives kept and extended; site-wide, content type, legacy and archive sources unchanged).");
