import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";
import { generateBaseSeoContributions, renderPageMetadata, resolvePageMetadata } from "emdash/page";

import { SEO_ADMIN_SETTINGS_STORAGE_VERSION, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import { COEXISTENCE_PROFILES, COEXISTENCE_ROBOTS_KEY, classifyNativePluginInventory,
	unavailableCoexistenceInventory, type CoexistenceInventory } from "./plugin-coexistence.ts";
import { createSeoEngine } from "./sandbox-entry.ts";
import { defaultSettingsValues } from "./settings-state.ts";
import { taxonomyArchivePage } from "./taxonomy-archives.ts";

const SITE = "https://example.com";
const clone = <T>(value: T): T => structuredClone(value);
function page(values: Partial<PublicPageContext> = {}): PublicPageContext {
	return { url: SITE + "/category/bread", path: "/category/bread", locale: "en", kind: "custom", pageType: "website",
		title: "Bread", description: "Bread archive", canonical: SITE + "/category/bread", image: null,
		siteName: "Example practice", siteUrl: SITE, ...values };
}
function fixture(options: {
	policy?: string[]; siteNoindex?: boolean; unreadable?: boolean; schemaOff?: boolean;
	inventory?: CoexistenceInventory; entryNoindex?: boolean;
} = {}) {
	const stats = { reads: [] as string[], contentReads: 0, taxonomyReads: 0, writes: 0, network: 0, schedules: 0 };
	const settings = { version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-16T00:00:00.000Z",
		...defaultSettingsValues({ siteName: "Example practice", siteUrl: SITE }), indexingPreferenceConfirmed: true,
		noindex: options.siteNoindex ?? false,
		...(options.policy === undefined ? {} : { taxonomyArchiveNoindex: [...options.policy] }) };
	const snapshot = JSON.stringify(settings);
	const refuse = async () => { stats.writes += 1; throw new Error("Metadata cannot write data."); };
	const definition = { slug: "posts", label: "Posts", routable: true, hasSeo: true, hidden: false };
	const entry = { id: "assigned-entry", slug: "bread-guide", status: "published", locale: "en",
		data: { title: "Bread guide", excerpt: "A guide assigned to the category" }, seo: { noIndex: options.entryNoindex ?? false } };
	const ctx: any = {
		plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION }, site: { url: SITE, name: "Example practice", locale: "en" },
		kv: {
			get: async (key: string) => { stats.reads.push(key); return key === "module:schema" && options.schemaOff ? false : null; },
			getVersioned: async (key: string) => {
				stats.reads.push(key);
				if (key !== "settings:global:v1") return null;
				if (options.unreadable) throw new Error("Settings cannot be read.");
				return { revision: "fixture-settings", value: clone(settings) };
			},
			set: refuse, delete: refuse, compareAndSet: refuse, compareAndDelete: refuse,
		},
		storage: new Proxy({}, { get: () => ({ get: async () => null, getMany: async () => new Map(),
			query: async () => ({ items: [], hasMore: false }), count: async () => 0,
			put: refuse, putMany: refuse, delete: refuse, deleteMany: refuse }) }),
		content: { get: async () => { stats.contentReads += 1; return clone(entry); },
			getPublicUrl: async () => SITE + "/posts/bread-guide", listCollections: async () => [definition] },
		schema: { getCollection: async () => definition, listCollections: async () => [definition] },
		taxonomies: new Proxy({}, { get: () => async () => { stats.taxonomyReads += 1; throw new Error("Public metadata cannot discover taxonomies."); } }),
		settings: { get: async () => null, getVersioned: async () => null, getAll: async () => ({}) },
		http: { fetch: async () => { stats.network += 1; throw new Error("No provider requests."); } },
		cron: { schedule: async () => { stats.schedules += 1; throw new Error("No scheduling."); }, cancel: refuse },
		log: { warn() {}, info() {}, error() {} },
	};
	const engine = options.inventory === undefined ? createSeoEngine() : createSeoEngine(undefined, {
		coexistence: { observe: async () => clone(options.inventory!) },
	});
	return { stats, async run(input: PublicPageContext): Promise<any[]> {
		const output = await engine.hooks["page:metadata"].handler({ page: input }, ctx);
		assert.ok(Array.isArray(output));
		assert.equal(JSON.stringify(settings), snapshot);
		assert.deepEqual([stats.taxonomyReads, stats.writes, stats.network, stats.schedules], [0, 0, 0, 0]);
		assert.equal(stats.reads.filter((key) => key === "settings:global:v1").length, 1,
			"Archive policy reuses the metadata hook's one global settings read");
		return output as any[];
	} };
}
function robots(output: any[]): string[] {
	const contributions = output.filter((item) => item.kind === "meta" && item.name === "robots");
	assert.ok(contributions.length <= 1, "The hook emits at most one robots contribution");
	return contributions.length ? contributions[0].content.split(",").map((token: string) => token.trim()) : [];
}
function assertRendered(output: any[], input: PublicPageContext, expected: string[]) {
	assert.deepEqual(robots(output), expected);
	const merged = resolvePageMetadata([...output, ...generateBaseSeoContributions(input)]);
	assert.deepEqual(merged.meta.filter((item) => item.name === "robots").map((item) => item.content), [expected.join(",")]);
	const html = renderPageMetadata(merged);
	assert.equal((html.match(/name="robots"/g) ?? []).length, 1);
}

for (const taxonomy of ["category", "region"]) {
	const input = taxonomyArchivePage(page(), taxonomy);
	const current = fixture({ policy: ["category", "region"] });
	assertRendered(await current.run(input), input, ["noindex"]);
	assert.equal(current.stats.contentReads, 0);
}
for (const themeRobots of ["index,follow,noarchive", "noindex,noarchive", "NOINDEX, NOFOLLOW, nosnippet", "max-snippet:0,noimageindex"]) {
	const input = taxonomyArchivePage(page({ seo: { robots: themeRobots } }), "category");
	const expected = [...new Set([...themeRobots.split(",").map((token) => token.trim().toLowerCase()).filter((token) => token !== "index"), "noindex"])];
	assertRendered(await fixture({ policy: ["category"] }).run(input), input, expected);
	assert.equal(expected.includes("nofollow"), themeRobots.toLowerCase().split(",").some((token) => token.trim() === "nofollow"),
		"Archive policy adds no follow restriction of its own");
}
{
	const input = taxonomyArchivePage(page({ seo: { robots: "index,follow,noarchive,max-snippet:0" } }), "category");
	const output = await fixture({ policy: ["category"], siteNoindex: true }).run(input);
	const tokens = robots(output);
	for (const token of ["noindex", "nofollow", "noarchive", "max-snippet:0"]) assert.ok(tokens.includes(token), token);
	assert.equal(tokens.includes("index"), false);
	assert.equal(tokens.includes("follow"), false, "The site-wide nofollow restriction removes the positive theme counterpart");
}
for (const input of [page(), page({ pageType: "shipit-seo:taxonomy:tag" }),
	page({ pageType: "shipit-seo:taxonomy:Category" }), page({ pageType: "shipit-seo:taxonomy:category:extra" }),
	page({ pageType: "taxonomy:category" }), page({ pageType: "shipit-seo:taxonomy:category", kind: "content" })]) {
	const before = await fixture().run(input);
	const after = await fixture({ policy: ["category"] }).run(input);
	assert.deepEqual(after, before, "Unbound, unselected and malformed contexts keep their existing metadata");
}
{
	const input = taxonomyArchivePage(page({ seo: { robots: "noarchive" } }), "category");
	const baseline = fixture(); const cleared = fixture({ policy: [] });
	assert.deepEqual(await cleared.run(input), await baseline.run(input), "An explicit empty policy restores inherited behavior");
	assert.deepEqual(cleared.stats.reads, baseline.stats.reads, "Archive selection adds no public read or background work");
}
for (const entryNoindex of [false, true]) {
	const input = page({ kind: "content", pageType: "article", path: "/posts/bread-guide", url: SITE + "/posts/bread-guide",
		content: { collection: "posts", id: "assigned-entry", slug: "bread-guide" } });
	const before = await fixture({ entryNoindex }).run(input);
	const after = await fixture({ policy: ["category"], entryNoindex }).run(input);
	assert.deepEqual(after, before, "Entries assigned to a selected taxonomy retain core-owned indexing");
	assert.equal(robots(after).includes("noindex"), entryNoindex);
	const mixed: PublicPageContext = { ...input, kind: "custom", pageType: "shipit-seo:taxonomy:category" };
	assert.deepEqual(await fixture({ policy: ["category"], entryNoindex }).run(mixed), await fixture({ entryNoindex }).run(mixed),
		"Even a custom marker cannot apply archive policy to a content identity");
}
{
	const input = taxonomyArchivePage(page(), "category");
	const output = await fixture({ policy: ["category"], schemaOff: true }).run(input);
	assert.deepEqual(robots(output), ["noindex"]);
	assert.equal(output.some((item) => item.kind === "jsonld"), false, "Archive robots policy does not enable Schema");
	assert.deepEqual(await fixture({ policy: ["category"], unreadable: true }).run(input), [], "Unreadable settings do not invent policy");
}
const profile = COEXISTENCE_PROFILES.find((item) => item.id === "seo-suite")!;
const overlap = classifyNativePluginInventory({ configured: [], rows: [{ id: profile.runtimeId, source: "registry",
	version: profile.assessedVersion, status: "active", publisherDid: profile.publisherDid, slug: profile.slug }] });
for (const inventory of [overlap, unavailableCoexistenceInventory()]) {
	const input = taxonomyArchivePage(page({ seo: { robots: "index,follow,noarchive" } }), "category");
	const output = await fixture({ policy: ["category"], inventory }).run(input);
	const restriction = output.find((item) => item.kind === "meta" && item.name === "robots");
	assert.equal(restriction?.key, COEXISTENCE_ROBOTS_KEY);
	assert.ok(robots(output).includes("noindex")); assert.ok(robots(output).includes("noarchive"));
	assert.equal(robots(output).includes("index"), false); assert.equal(robots(output).includes("nofollow"), false);
	assert.equal(output.some((item) => item.kind === "jsonld" || item.kind === "property" || item.kind === "link"), false,
		"Retaining a chosen restriction cannot resurrect paused metadata or Schema");
}
console.log("Taxonomy archive metadata checks passed (real hook, theme restrictions, content isolation and coexistence).");
