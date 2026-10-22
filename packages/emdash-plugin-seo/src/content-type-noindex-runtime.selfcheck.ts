import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";
import { generateBaseSeoContributions, renderPageMetadata, resolvePageMetadata } from "emdash/page";

import { SEO_ADMIN_SETTINGS_STORAGE_VERSION, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import { analyzeSeoContent } from "./analysis.ts";
import {
	createMetadataReadObservation,
	entryAnalysisConfigurationFingerprint,
	resolveEffectiveContentMetadata,
	resolveEntryOwnership,
} from "./entry-analysis-runtime.ts";
import { COEXISTENCE_PROFILES, COEXISTENCE_ROBOTS_KEY, classifyNativePluginInventory } from "./plugin-coexistence.ts";
import { createSeoEngine } from "./sandbox-entry.ts";
import { defaultSettingsValues } from "./settings-state.ts";
import { taxonomyArchivePage } from "./taxonomy-archives.ts";

const SITE = "https://example.com";
const clone = <T>(value: T): T => structuredClone(value);
const definitions = ["posts", "pages", "events"].map((slug) => ({ slug, label: slug[0]!.toUpperCase() + slug.slice(1), routable: true, hasSeo: true, hidden: false }));
function entry(collection: string, noIndex = false) {
	return { id: `${collection}-entry`, slug: `${collection}-guide`, status: "published", locale: "en", updatedAt: "2026-10-16T00:00:00.000Z",
		data: { title: `A ${collection} guide`, excerpt: "A published entry" },
		seo: { title: null, description: null, canonical: null, image: null, noIndex } };
}
function fixture(options: { rule?: string[]; siteNoindex?: boolean; unreadable?: boolean; entryNoindex?: boolean; inventory?: unknown } = {}) {
	const stats = { reads: [] as string[], writes: 0, network: 0, schedules: 0 };
	const settings = { version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-16T00:00:00.000Z",
		...defaultSettingsValues({ siteName: "Example practice", siteUrl: SITE }), indexingPreferenceConfirmed: true,
		noindex: options.siteNoindex ?? false,
		...(options.rule === undefined ? {} : { contentTypeNoindex: [...options.rule] }) };
	const snapshot = JSON.stringify(settings);
	const refuse = async () => { stats.writes += 1; throw new Error("Metadata cannot write data."); };
	const ctx: any = {
		plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION }, site: { url: SITE, name: "Example practice", locale: "en" },
		kv: {
			get: async (key: string) => { stats.reads.push(key); return null; },
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
		content: { get: async (collection: string) => clone(entry(collection, options.entryNoindex)),
			getPublicUrl: async (collection: string) => `${SITE}/${collection}/${collection}-guide`, listCollections: async () => clone(definitions) },
		schema: { getCollection: async (slug: string) => definitions.find((item) => item.slug === slug) ?? null, listCollections: async () => clone(definitions) },
		taxonomies: new Proxy({}, { get: () => async () => { throw new Error("Public metadata cannot discover taxonomies."); } }),
		settings: { get: async () => null, getVersioned: async () => null, getAll: async () => ({}) },
		http: { fetch: async () => { stats.network += 1; throw new Error("No provider requests."); } },
		cron: { schedule: async () => { stats.schedules += 1; throw new Error("No scheduling."); }, cancel: refuse },
		log: { warn() {}, info() {}, error() {} },
	};
	const engine = options.inventory === undefined ? createSeoEngine() : createSeoEngine(undefined, {
		coexistence: { observe: async () => clone(options.inventory as any) },
	});
	return { ctx, settings, stats, async run(input: PublicPageContext): Promise<any[]> {
		const output = await engine.hooks["page:metadata"].handler({ page: input }, ctx);
		assert.ok(Array.isArray(output));
		assert.equal(JSON.stringify(settings), snapshot, "metadata never changes the settings");
		assert.deepEqual([stats.writes, stats.network, stats.schedules], [0, 0, 0]);
		assert.ok(stats.reads.filter((key) => key === "settings:global:v1").length <= 1, "the rule reuses the one global settings read");
		return output as any[];
	} };
}
function contentPage(collection: string): PublicPageContext {
	return { url: `${SITE}/${collection}/${collection}-guide`, path: `/${collection}/${collection}-guide`, locale: "en", kind: "content",
		pageType: "article", title: `A ${collection} guide`, description: null, canonical: null, image: null,
		siteName: "Example practice", siteUrl: SITE, content: { collection, id: `${collection}-entry`, slug: `${collection}-guide` } };
}
function robots(output: any[]): string[] {
	const contributions = output.filter((item) => item.kind === "meta" && item.name === "robots");
	assert.ok(contributions.length <= 1, "at most one robots contribution");
	return contributions.length ? contributions[0].content.split(",").map((token: string) => token.trim()) : [];
}
function rendered(output: any[], input: PublicPageContext): string[] {
	const merged = resolvePageMetadata([...output, ...generateBaseSeoContributions(input)]);
	const html = renderPageMetadata(merged);
	assert.equal((html.match(/name="robots"/g) ?? []).length <= 1, true, "the page renders one robots tag at most");
	return merged.meta.filter((item) => item.name === "robots").map((item) => item.content);
}

// Entries of a ruled type render noindex,nofollow, like the other noindex sources.
{
	const input = contentPage("posts");
	const ruled = fixture({ rule: ["events", "posts"] });
	const output = await ruled.run(input);
	assert.deepEqual(robots(output), ["noindex", "nofollow"]);
	assert.deepEqual(rendered(output, input), ["noindex,nofollow"], "the rendered head carries the rule");
	const baseline = await fixture().run(input);
	assert.deepEqual(robots(baseline), [], "control: without a rule the same entry has no plugin robots meta");
}
// Other types, an empty list and an absent field all keep the existing output and reads.
for (const collection of ["pages", "posts"]) {
	const input = contentPage(collection);
	const absent = fixture(); const empty = fixture({ rule: [] });
	const before = await absent.run(input);
	assert.deepEqual(await empty.run(input), before, "an empty list equals no rule");
	assert.deepEqual(empty.stats.reads, absent.stats.reads, "an empty list adds no read");
	if (collection === "pages") {
		const other = fixture({ rule: ["posts"] });
		assert.deepEqual(await other.run(input), before, "a rule for another type changes nothing here");
		assert.deepEqual(other.stats.reads, absent.stats.reads);
	}
}
// The rule only adds noindex: entry noindex and site-wide noindex keep their effect.
for (const [label, options] of [["entry", { entryNoindex: true }], ["site", { siteNoindex: true }]] as const) {
	const input = contentPage("posts");
	assert.deepEqual(robots(await fixture({ ...options, rule: ["posts"] }).run(input)), ["noindex", "nofollow"], label + " noindex with the rule");
	assert.deepEqual(robots(await fixture(options).run(input)), ["noindex", "nofollow"], "control: " + label + " noindex alone");
	assert.deepEqual(robots(await fixture({ ...options, rule: ["pages"] }).run(input)), ["noindex", "nofollow"], label + " noindex with another type's rule");
}
// Archives and unbound pages carry no content type, so a type rule never reaches them.
{
	const archive = taxonomyArchivePage({ url: SITE + "/category/bread", path: "/category/bread", locale: "en", kind: "custom", pageType: "website",
		title: "Bread", description: "Bread archive", canonical: SITE + "/category/bread", image: null, siteName: "Example practice", siteUrl: SITE }, "category");
	assert.deepEqual(await fixture({ rule: ["pages", "posts"] }).run(archive), await fixture().run(archive));
}
assert.deepEqual(await fixture({ rule: ["posts"], unreadable: true }).run(contentPage("posts")), [], "unreadable settings invent no rule");
assert.deepEqual(await fixture({ rule: ["posts", "pages"] }).run(contentPage("pages")), [],
	"a stored list out of canonical order makes the record corrupt, so no metadata is guessed");
// Coexistence keeps a chosen restriction when another plugin owns metadata.
{
	const profile = COEXISTENCE_PROFILES.find((item) => item.id === "seo-suite")!;
	const overlap = classifyNativePluginInventory({ configured: [], rows: [{ id: profile.runtimeId, source: "registry",
		version: profile.assessedVersion, status: "active", publisherDid: profile.publisherDid, slug: profile.slug }] });
	const output = await fixture({ rule: ["posts"], inventory: overlap }).run(contentPage("posts"));
	const restriction = output.find((item) => item.kind === "meta" && item.name === "robots");
	assert.equal(restriction?.key, COEXISTENCE_ROBOTS_KEY);
	assert.ok(robots(output).includes("noindex"), "the rule survives as a coexistence restriction");
}

// Analysis inputs: the source is named in precedence order and only covered types change.
{
	const { ctx, settings } = fixture({ rule: ["posts"], siteNoindex: false });
	const values = { ...settings } as any;
	const item = entry("posts", true);
	const observation = createMetadataReadObservation();
	const effective = await resolveEffectiveContentMetadata(ctx, "posts", item, undefined, values, undefined, observation);
	assert.equal(effective.indexable, false);
	assert.deepEqual(effective.noindexSources, ["content-type-rule", "entry-seo"]);
	const other = await resolveEffectiveContentMetadata(ctx, "pages", entry("pages"), undefined, values);
	assert.deepEqual([other.indexable, other.noindexSources], [true, []]);
	const both = await resolveEffectiveContentMetadata(ctx, "posts", entry("posts"), undefined, { ...values, noindex: true });
	assert.deepEqual(both.noindexSources, ["site-setting", "content-type-rule"]);
	const ruleOnly = await resolveEffectiveContentMetadata(ctx, "posts", entry("posts"), undefined, values, undefined, createMetadataReadObservation());
	const ownershipObservation = createMetadataReadObservation();
	const ruleOnlyObserved = await resolveEffectiveContentMetadata(ctx, "posts", entry("posts"), undefined, values, undefined, ownershipObservation);
	const ownership = resolveEntryOwnership({ hostItem: entry("posts"), resolvedItem: entry("posts"), effective: ruleOnlyObserved, observation: ownershipObservation });
	const noIndex = ownership.fields.find((field) => field.field === "noIndex");
	assert.equal(ruleOnly.robots, "noindex,nofollow");
	assert.deepEqual([noIndex?.effective, noIndex?.effectiveSource, noIndex?.core], [true, "content-type-rule", false],
		"saved ownership names the rule as the deciding source");

	const base = { ref: "posts:posts-entry", collection: "posts", entryId: "posts-entry", slug: "posts-guide", title: "A posts guide",
		description: "A published entry", url: SITE + "/posts/posts-guide", publicationStatus: "published", body: "Body text.", focusKeywords: [],
		assessmentProfile: { profile: "general", version: 1 }, schemaEnabled: false, schemaPreset: "None", imageSeoEnabled: true } as any;
	const ruleCheck = analyzeSeoContent({ ...base, noindex: true, noindexSources: ["content-type-rule"] }).checks.find((check) => check.id === "indexability")!;
	assert.equal(ruleCheck.label, "Excluded from search");
	assert.match(ruleCheck.detail, /marked noindex by the content type rule in Indexing rules\./);
	assert.equal(ruleCheck.evidence.source, "the content type noindex rule");
	assert.equal(ruleCheck.weight, 0, "the rule never changes the score");
	const combined = analyzeSeoContent({ ...base, noindex: true, noindexSources: ["site-setting", "content-type-rule", "entry-seo"] })
		.checks.find((check) => check.id === "indexability")!;
	assert.match(combined.detail, /the site-wide noindex setting in Indexing rules and the content type rule in Indexing rules and this entry's SEO settings/);
	const unscored = analyzeSeoContent({ ...base, noindex: false, noindexSources: [] });
	assert.equal(analyzeSeoContent({ ...base, noindex: true, noindexSources: ["content-type-rule"] }).score, unscored.score,
		"control: excluded entries keep the score of the same content");

	const runtime = (rule?: string[]) => ({ settings: { ...values, ...(rule === undefined ? { contentTypeNoindex: undefined } : { contentTypeNoindex: rule }) },
		presets: {}, customSchemas: [], contentTypeRoles: {}, contentTypeRolesInvalid: false, businessIdentity: { state: "absent" },
		publisherOwnership: "automatic", global: {}, fingerprint: "" }) as any;
	const profile = { profile: "article", version: 1 } as any;
	const fingerprint = (collection: string, rule?: string[]) =>
		entryAnalysisConfigurationFingerprint(runtime(rule), {} as any, collection, entry(collection), profile);
	assert.equal(fingerprint("pages", ["posts"]), fingerprint("pages"), "a rule for another type keeps this type's saved analyses current");
	assert.equal(fingerprint("posts", []), fingerprint("posts"), "an empty list keeps earlier fingerprints");
	assert.notEqual(fingerprint("posts", ["posts"]), fingerprint("posts"), "a rule for this type marks its saved analyses stale");
	assert.match(fingerprint("posts", ["posts"]), /:content-type-noindex$/);
}

console.log("Content type noindex runtime checks passed (real metadata hook, rendered robots, isolation, precedence, analysis inputs and ownership).");
