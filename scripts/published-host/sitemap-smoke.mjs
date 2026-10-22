import { reviewOutputRoot } from "./environment.mjs";
// Native sitemap proof on a migrated EmDash SQLite database from the selected
// published host: projected reads, keyset files, parameter budgets, route
// parity with EmDash's getPublicUrl, revision-checked settings through a real
// plugin context, and read-only public requests with their query counts.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";
const reviewRoot = reviewOutputRoot(target);

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Sitemap smoke skipped on ${target.name}; this check requires a released native target.`);
	process.exit(0);
}
globalThis.fetch = async () => { throw new Error("External networking is disabled in this smoke check"); };

const host = hostPackageRoot("emdash");
async function hostDistExport(name) {
	const dist = new URL("dist/", host);
	for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const alias = readFileSync(new URL(file, dist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(new URL(file, dist).href))[alias];
	}
	throw new Error(`published ${name} was not found`);
}
const { Kysely, sql } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const { getSeoMeta } = await import("emdash");
const SchemaRegistry = await hostDistExport("SchemaRegistry");
const PluginContextFactory = await hostDistExport("PluginContextFactory");
const setI18nConfig = await hostDistExport("setI18nConfig");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createNativeSitemapSource, SITEMAP_GROUP_STATEMENT_BUDGET } = await source("sitemap-native-source.ts");
const { SitemapCapacityError, resolveSitemapRoute, sitemapPageSize } = await source("sitemap-engine.ts");
const { buildSitemapAdmin, saveSitemapSettings, serveSitemapFile, previewSitemapFile } = await source("sitemap-runtime.ts");
const { seoPlugin } = await source("index.ts");
const { persistAdminSettings, readAdminSettings } = await source("settings-runtime.ts");
const { MODULES_SETTINGS_KEY, readAdminModules } = await source("entry-analysis-runtime.ts");

const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push(event.query.sql);
	},
});
const counted = async (action) => {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	return { value, queries: run.length, writes: run.filter((text) => /^\s*(insert|update|delete|replace)\b/i.test(text)).length };
};
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", requests: {} };

try {
	await runMigrations(db);
	const schema = new SchemaRegistry(db);
	await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: false, routable: true, urlPattern: "/blog/{year}/{slug}" });
	await schema.createCollection({ slug: "pages", label: "Pages", hasSeo: false, routable: true });
	await schema.createCollection({ slug: "forms", label: "Form entries", routable: false });

	const id = (index) => `01K${String(index).padStart(23, "0")}`;
	const post = (index, values = {}) => ({
		id: id(index), slug: `post-${index}`, status: "published", locale: "en", translation_group: null,
		published_at: "2026-01-02 23:30:00", updated_at: "2026-09-01 10:00:00", deleted_at: null, ...values,
	});
	await db.insertInto("ec_posts").values([
		post(1, { translation_group: "g1" }),
		post(2, { translation_group: "g1", locale: "fr", slug: "post-1" }),
		post(3),
		post(4, { status: "draft" }),
		post(5, { deleted_at: "2026-09-02 10:00:00" }),
		post(6, { slug: "  " }),
		post(7, { locale: "de" }),
		post(8),
		post(9, { slug: "it's & co" }),
	]).execute();
	await db.insertInto("ec_pages").values({ id: id(20), slug: "about", status: "published", locale: "en", published_at: null, updated_at: "2026-09-01 10:00:00" }).execute();
	await db.insertInto("_emdash_seo").values([
		{ collection: "posts", content_id: id(3), seo_no_index: 1, seo_canonical: null, seo_image: null, updated_at: "2026-09-01 10:00:00" },
		{ collection: "posts", content_id: id(8), seo_no_index: 0, seo_canonical: null, seo_image: "01MEDIA", updated_at: "2026-10-02 08:00:00" },
		// Same content id under another collection must not leak into posts.
		{ collection: "pages", content_id: id(1), seo_no_index: 1, seo_canonical: null, seo_image: null, updated_at: "2026-09-01 10:00:00" },
	]).execute();

	// Projected reads and keyset files.
	const native = createNativeSitemapSource(db);
	const en = { locales: ["en"] };
	const planned = await counted(() => native.planFiles("posts", en, 2));
	assert.deepEqual(planned.value, { rowCount: 4, cursors: [null, id(3)] });
	assert.equal(planned.queries, 1);
	const seen = [];
	for (const after of planned.value.cursors) {
		const page = await counted(() => native.readRows("posts", en, { after, limit: 2 }));
		assert.equal(page.queries, 1, "one statement per child file");
		seen.push(...page.value.map((row) => row.id));
	}
	assert.deepEqual(seen, [id(1), id(3), id(8), id(9)], "each candidate appears once, in id order");
	const rows = await native.readRows("posts", en, { after: null, limit: 10 });
	assert.deepEqual(rows.map((row) => row.id), [id(1), id(3), id(8), id(9)], "drafts, deleted rows, blank slugs and other locales are not candidates");
	assert.equal(rows[0].seo, null, "a row without core SEO metadata stays indexable and a pages SEO row does not leak");
	assert.equal(rows[1].seo.noIndex, true);
	assert.deepEqual(rows[2].seo, { noIndex: false, canonical: null, image: "01MEDIA", updatedAt: "2026-10-02 08:00:00" });
	assert.deepEqual(Object.keys(rows[0]).sort(), ["id", "locale", "publishedAt", "seo", "slug", "translationGroup", "updatedAt"],
		"only public URL metadata is projected");

	// Translation groups under the D1 parameter limit and the request budget.
	const routedLocales = { locales: ["en", "fr"] };
	const groups = await counted(() => native.readGroups("posts", routedLocales, ["g1"]));
	assert.deepEqual(groups.value.map((row) => row.locale).sort(), ["en", "fr"]);
	assert.equal(groups.queries, 1);
	const manyLocales = { locales: Array.from({ length: 85 }, (_, index) => `l${index}`) };
	const budget = await counted(() => native.readGroups("posts", manyLocales, Array.from({ length: 500 }, (_, index) => `g${index}`))
		.then(() => null, (error) => error));
	assert.ok(budget.value instanceof SitemapCapacityError && budget.value.kind === "request-budget");
	assert.equal(budget.queries, 0, "the budget is checked before any statement runs");
	const batched = await counted(() => native.readGroups("posts", routedLocales, Array.from({ length: 200 }, (_, index) => `g${index}`)));
	assert.equal(batched.queries, Math.ceil(200 / (100 - 3 - 2 - 2)));
	assert.ok(batched.queries <= SITEMAP_GROUP_STATEMENT_BUDGET);
	await assert.rejects(native.readRows("posts; drop table ec_posts", en, { after: null, limit: 1 }), /Invalid sitemap collection key/);

	// Route parity with EmDash's own getPublicUrl. Outside Astro, EmDash reads
	// its runtime i18n mirror once and caches it, so it is set before any call;
	// default-locale rows stay unprefixed as without i18n.
	setI18nConfig({ defaultLocale: "en", locales: ["en", "fr"], prefixDefaultLocale: false });
	const parity = [];
	for (const trailingSlash of ["ignore", "always", "never"]) {
		const factory = new PluginContextFactory({ db, siteInfo: { siteName: "Smoke", siteUrl: "https://example.com", locale: "en", trailingSlash } });
		const content = factory.createContext({ id: "parity", version: "0.0.0", capabilities: ["content:read", "schema:read"], admin: {}, storage: {}, allowedHosts: [] }).content;
		for (const row of [post(1), post(9, { slug: "it's & co" }), post(20, { slug: "about" })]) {
			const collection = row.id === id(20) ? "pages" : "posts";
			const expected = await content.getPublicUrl(collection, row.id);
			const routed = resolveSitemapRoute({
				pattern: collection === "posts" ? "/blog/{year}/{slug}" : null, collection, slug: row.slug, id: row.id,
				publishedAt: collection === "posts" ? row.published_at : null, locale: "en",
			}, { trailingSlash, i18n: null });
			assert.equal(`https://example.com${routed.path}`, expected, `${collection} ${row.slug} ${trailingSlash}`);
			parity.push({ trailingSlash, collection, url: expected });
		}
	}
	const i18nContent = new PluginContextFactory({ db, siteInfo: { siteUrl: "https://example.com", locale: "en", trailingSlash: "ignore" } })
		.createContext({ id: "parity-i18n", version: "0.0.0", capabilities: ["content:read", "schema:read"], admin: {}, storage: {}, allowedHosts: [] }).content;
	const frExpected = await i18nContent.getPublicUrl("posts", id(2));
	const frRouted = resolveSitemapRoute({ pattern: "/blog/{year}/{slug}", collection: "posts", slug: "post-1", id: id(2), publishedAt: "2026-01-02 23:30:00", locale: "fr" },
		{ trailingSlash: "ignore", i18n: { defaultLocale: "en", locales: ["en", "fr"], prefixDefaultLocale: false } });
	assert.equal(`https://example.com${frRouted.path}`, frExpected);
	parity.push({ locale: "fr", url: frExpected });
	// Settings and public files through a real plugin context.
	const seo = seoPlugin();
	// Each request gets its own plugin context, as EmDash creates one per invocation.
	const contextFactory = new PluginContextFactory({ db, siteInfo: { siteName: "Smoke", siteUrl: "https://example.com", locale: "en", trailingSlash: "ignore" } });
	const fresh = () => contextFactory.createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
	const ctx = fresh();
	const seoUrls = (input, siteUrl, path) => {
		const meta = getSeoMeta({ data: {}, seo: { title: null, description: null, image: input.image, canonical: input.canonical, noIndex: false } }, { siteUrl, path });
		return { image: meta.ogImage, canonical: meta.canonical };
	};
	const sitemapHost = {
		installation: { owner: "shipit", detail: null, routing: { trailingSlash: "ignore", i18n: null } },
		seoUrls,
		openSource: async () => createNativeSitemapSource(db),
	};
	await ctx.kv.set("settings:noindex", false);
	const admin = await counted(() => buildSitemapAdmin(fresh(), sitemapHost));
	assert.equal(admin.value.availability, "ready");
	assert.deepEqual(admin.value.values.contentTypes, { pages: true, posts: true });
	assert.equal(admin.writes, 0);
	report.requests.admin = { queries: admin.queries, writes: admin.writes };
	const index = await counted(() => serveSitemapFile(fresh(), sitemapHost, { kind: "index" }));
	assert.equal(index.value.status, 200);
	assert.ok(index.value.body.includes("<loc>https://example.com/sitemap-pages.xml</loc>"));
	assert.equal(index.writes, 0);
	report.requests.index = { queries: index.queries, writes: index.writes, bytes: Buffer.byteLength(index.value.body) };
	const child = await counted(() => serveSitemapFile(fresh(), sitemapHost, { kind: "child", collection: "posts", after: null }));
	assert.equal(child.value.status, 200);
	assert.ok(child.value.body.includes("<loc>https://example.com/blog/2026/post-1</loc>"));
	assert.ok(child.value.body.includes("<loc>https://example.com/blog/2026/it&apos;s%20%26%20co</loc>"));
	assert.ok(child.value.body.includes("<lastmod>2026-10-02T08:00:00.000Z</lastmod>"), "the SEO row's newer timestamp is the page's lastmod");
	assert.ok(child.value.body.includes("<image:loc>https://example.com/_emdash/api/media/file/01MEDIA</image:loc>"));
	assert.ok(!child.value.body.includes("post-3"), "noindex rows are not listed");
	assert.equal(child.writes, 0);
	report.requests.child = { queries: child.queries, writes: child.writes, bytes: Buffer.byteLength(child.value.body), pageSize: sitemapPageSize(sitemapHost.installation.routing, "en") };
	const saved = await saveSitemapSettings(ctx, sitemapHost, { contentTypes: { pages: false, posts: true }, excludedPaths: ["/blog/2026/post-1"], expectedRevision: null });
	assert.equal(saved.success, true);
	const stale = await saveSitemapSettings(ctx, sitemapHost, { contentTypes: { pages: true }, excludedPaths: [], expectedRevision: null });
	assert.equal(stale.conflict, true, "the options table revision fences a stale save");
	const afterSave = await serveSitemapFile(ctx, sitemapHost, { kind: "index" });
	assert.ok(!afterSave.body.includes("sitemap-pages.xml"));
	const excluded = await serveSitemapFile(ctx, sitemapHost, { kind: "child", collection: "posts", after: null });
	assert.ok(!excluded.body.includes("/blog/2026/post-1<"));
	const preview = await counted(() => previewSitemapFile(fresh(), sitemapHost, { collection: "posts", after: null }));
	assert.equal(preview.value.success, true);
	assert.deepEqual(preview.value.entries.map((entry) => entry.status), ["excluded-path", "noindex", "included", "included"]);
	assert.equal(preview.writes, 0);
	report.requests.preview = { queries: preview.queries, writes: preview.writes };

	// The counts above include the cold fallback that reads every legacy
	// settings and module key while no versioned record is stored. A site that
	// has saved Shipit settings and feature controls reads one record of each.
	await persistAdminSettings(ctx, (await readAdminSettings(ctx)).values);
	await ctx.kv.set(MODULES_SETTINGS_KEY, { version: 1, updatedAt: new Date().toISOString(), values: (await readAdminModules(ctx)).values });
	const savedIndex = await counted(() => serveSitemapFile(fresh(), sitemapHost, { kind: "index" }));
	const savedChild = await counted(() => serveSitemapFile(fresh(), sitemapHost, { kind: "child", collection: "posts", after: null }));
	assert.equal(savedIndex.value.status, 200);
	assert.equal(savedChild.value.status, 200);
	assert.equal(savedIndex.writes + savedChild.writes, 0);
	assert.ok(savedChild.queries < child.queries, "stored settings replace the legacy fallback reads");
	report.requests.savedStateIndex = { queries: savedIndex.queries, writes: savedIndex.writes };
	report.requests.savedStateChild = { queries: savedChild.queries, writes: savedChild.writes };
	// A content type noindex rule leaves its type out of the real index and child route; removing it restores both.
	const savedValues = (await readAdminSettings(ctx)).values;
	await persistAdminSettings(ctx, { ...savedValues, contentTypeNoindex: ["posts"] });
	const ruledAdmin = await buildSitemapAdmin(fresh(), sitemapHost);
	assert.deepEqual(ruledAdmin.noindexContentTypes, ["posts"]);
	assert.equal(ruledAdmin.values.contentTypes.posts, true, "the stored sitemap choice is unchanged");
	assert.deepEqual(ruledAdmin.plan, [], "the ruled type gets no file");
	const ruledIndex = await counted(() => serveSitemapFile(fresh(), sitemapHost, { kind: "index" }));
	assert.equal(ruledIndex.value.status, 200);
	assert.ok(!ruledIndex.value.body.includes("sitemap-posts.xml"), "the index lists no posts file while the rule is on");
	assert.equal(ruledIndex.writes, 0);
	assert.equal((await serveSitemapFile(fresh(), sitemapHost, { kind: "child", collection: "posts", after: null })).status, 404);
	await persistAdminSettings(ctx, { ...savedValues, contentTypeNoindex: [] });
	const restoredIndex = await serveSitemapFile(fresh(), sitemapHost, { kind: "index" });
	assert.ok(restoredIndex.body.includes("sitemap-posts.xml"), "removing the rule lists the posts file again");
	assert.ok((await serveSitemapFile(fresh(), sitemapHost, { kind: "child", collection: "posts", after: null })).body.includes("<loc>https://example.com/blog/2026/it&apos;s%20%26%20co</loc>"));
	report.requests.contentTypeRuleIndex = { queries: ruledIndex.queries, writes: ruledIndex.writes };
	report.parity = parity;

	// A real 50,000-row native fixture: one planning scan, one bounded source
	// file per table request, and no offset or content hydration. This is SQLite
	// capacity evidence, not measured D1 rows_read or a hosting cost guarantee.
	await schema.createCollection({ slug: "sitemap_capacity", label: "Sitemap capacity", hasSeo: false, routable: true, urlPattern: "/capacity/{slug}" });
	for (let start = 1; start <= 50_000; start += 500) {
		await db.insertInto("ec_sitemap_capacity").values(Array.from({ length: 500 }, (_, offset) => ({
			id: id(start + offset), slug: `capacity-${String(start + offset).padStart(5, "0")}`, status: "published", locale: "en",
			translation_group: null, published_at: "2026-01-02 23:30:00", updated_at: "2026-09-01 10:00:00", deleted_at: null,
		}))).execute();
	}
	await db.insertInto("_emdash_seo").values(Array.from({ length: 500 }, (_, index) => ({
		collection: "sitemap_capacity", content_id: id((index + 1) * 100), seo_no_index: 1, seo_canonical: null, seo_image: null, updated_at: "2026-09-01 10:00:00",
	}))).execute();
	const nativeCapacity = createNativeSitemapSource(db);
	const capacityStart = Date.now();
	const capacityPlan = await counted(() => nativeCapacity.planFiles("sitemap_capacity", en, 500));
	assert.equal(capacityPlan.value.rowCount, 50_000);
	assert.equal(capacityPlan.value.cursors.length, 100);
	assert.deepEqual([capacityPlan.value.cursors[0], capacityPlan.value.cursors[99]], [null, id(49_500)]);
	assert.deepEqual([capacityPlan.queries, capacityPlan.writes], [1, 0]);
	const capacityPlanMs = Date.now() - capacityStart;
	const projectedCapacity = await nativeCapacity.readRows("sitemap_capacity", en, { after: id(41_500), limit: 500 });
	assert.deepEqual([projectedCapacity.length, projectedCapacity[0].id, projectedCapacity.at(-1).id], [500, id(41_501), id(42_000)]);
	assert.ok(projectedCapacity.every((row) => !Object.hasOwn(row, "data") && !Object.hasOwn(row, "content") && !Object.hasOwn(row, "title")));
	const capacitySettings = await buildSitemapAdmin(fresh(), sitemapHost);
	const savedCapacity = await saveSitemapSettings(fresh(), sitemapHost, {
		contentTypes: { pages: false, posts: false, sitemap_capacity: true }, excludedPaths: [], expectedRevision: capacitySettings.revision,
	});
	assert.equal(savedCapacity.success, true, JSON.stringify(savedCapacity));
	let capacitySourceRows = 0;
	let capacityPlans = 0;
	const capacityHost = {
		...sitemapHost,
		openSource: async () => ({
			...nativeCapacity,
			async planFiles(...args) { capacityPlans += 1; return nativeCapacity.planFiles(...args); },
			async readRows(...args) { const rows = await nativeCapacity.readRows(...args); capacitySourceRows += rows.length; return rows; },
		}),
	};
	const boundedPreview = async (input) => {
		capacitySourceRows = 0;
		const before = statements.length;
		const started = Date.now();
		const result = await counted(() => previewSitemapFile(fresh(), capacityHost, input));
		assert.ok(capacitySourceRows <= 500, "one current public file is the preview's source bound");
		assert.equal(capacityPlans, 0, "table pages do not repeat collection planning");
		assert.ok(!statements.slice(before).some((query) => /\b(?:offset|row_number)\b/i.test(query)), "no OFFSET or ranked inventory query in a table page");
		assert.equal(result.writes, 0);
		assert.ok(result.queries <= 12, "saved-state table requests keep the native query budget");
		return { ...result, projectedRows: capacitySourceRows, ms: Date.now() - started };
	};
	const capacityXml = await serveSitemapFile(fresh(), sitemapHost, { kind: "child", collection: "sitemap_capacity", after: null });
	assert.equal(capacityXml.status, 200);
	assert.equal((capacityXml.body.match(/<url>/g) ?? []).length, 495);
	const capacityFirst = await boundedPreview({ collection: "sitemap_capacity", after: null, limit: 25 });
	assert.equal(capacityFirst.value.success, true);
	assert.deepEqual([capacityFirst.value.total, capacityFirst.value.matched, capacityFirst.value.included, capacityFirst.value.excluded, capacityFirst.value.entries.length], [500, 500, 495, 5, 25]);
	const capacityNext = await boundedPreview({ collection: "sitemap_capacity", after: null, limit: 25, cursor: capacityFirst.value.nextCursor });
	assert.equal(capacityNext.value.success, true);
	assert.deepEqual([capacityNext.value.entries.length, capacityNext.value.offset, capacityNext.value.entries[0].id], [25, 25, id(26)]);
	const capacityExcluded = await boundedPreview({ collection: "sitemap_capacity", after: null, status: "excluded", limit: 50 });
	assert.deepEqual([capacityExcluded.value.success, capacityExcluded.value.matched, capacityExcluded.value.entries.length], [true, 5, 5]);
	const capacityNoMatch = await boundedPreview({ collection: "sitemap_capacity", after: null, search: "50000" });
	assert.deepEqual([capacityNoMatch.value.success, capacityNoMatch.value.matched], [true, 0], "search never claims to cover the other99files");
	const capacityLast = await boundedPreview({ collection: "sitemap_capacity", after: capacityPlan.value.cursors[99], search: "50000" });
	assert.deepEqual([capacityLast.value.success, capacityLast.value.total, capacityLast.value.matched, capacityLast.value.entries[0].id], [true, 500, 1, id(50_000)]);
	assert.deepEqual(await serveSitemapFile(fresh(), sitemapHost, { kind: "child", collection: "sitemap_capacity", after: null }), capacityXml,
		"table pagination and filtering leave public XML unchanged");
	// Controlled fixture write outside the read budget changes an unseen row of
	// the same file; an old continuation must refuse the changed snapshot.
	await db.insertInto("_emdash_seo").values({ collection: "sitemap_capacity", content_id: id(499), seo_no_index: 1, seo_canonical: null, seo_image: null, updated_at: "2026-09-01 10:00:00" }).execute();
	const capacityStale = await boundedPreview({ collection: "sitemap_capacity", after: null, limit: 25, cursor: capacityFirst.value.nextCursor });
	assert.deepEqual([capacityStale.value.success, capacityStale.value.stale], [false, true]);
	const capacitySummary = (result) => ({ queries: result.queries, writes: result.writes, projectedRows: result.projectedRows, returnedRows: result.value.success ? result.value.entries.length : 0, ms: result.ms });
	report.requests.capacity50000 = {
		candidates: 50_000, files: 100, planning: { queries: capacityPlan.queries, returnedBoundaries: 100, ms: capacityPlanMs },
		first: capacitySummary(capacityFirst), next: capacitySummary(capacityNext), excluded: capacitySummary(capacityExcluded),
		noMatchInFirstFile: capacitySummary(capacityNoMatch), lastFileSearch: capacitySummary(capacityLast), stale: capacitySummary(capacityStale),
		publicXmlUnchangedByPreview: true, fileLocalCounts: { total: 500, included: 495, excluded: 5 },
		limits: "Fresh synthetic in-memory SQLite. Planning still scans candidates; bounded projected/response rows are not a D1 rows_read claim.",
	};

	mkdirSync(new URL("sitemaps-review/", reviewRoot), { recursive: true });
	writeFileSync(new URL("sitemaps-review/native-sql-smoke.json", reviewRoot), `${JSON.stringify(report, null, 2)}\n`);
	console.log(`Native sitemap SQLite smoke passed: cold-settings index ${report.requests.index.queries} queries, child ${report.requests.child.queries}, preview ${report.requests.preview.queries}; saved-settings index ${report.requests.savedStateIndex.queries}, child ${report.requests.savedStateChild.queries}; no writes.`);
} finally {
	await db.destroy();
}
