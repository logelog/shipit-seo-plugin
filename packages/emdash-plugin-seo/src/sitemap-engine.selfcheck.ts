import assert from "node:assert/strict";

import {
	SITEMAP_LIMITS,
	SitemapCapacityError,
	decideSitemapEntry,
	markDuplicateSitemapUrls,
	parseSitemapPublicPath,
	portableSitemapSeoUrls,
	renderSitemapIndex,
	renderSitemapUrlset,
	resolveSitemapRoute,
	resolveSitemapSelection,
	sitemapAcceptedLocales,
	sitemapAlternates,
	sitemapChildPath,
	sitemapExclusionKeys,
	sitemapLastmod,
	sitemapEntryByteBound,
	sitemapPageSize,
	sitemapPathKey,
	sitemapPatternIsUnique,
	sitemapPatternIsConstant,
	sitemapPlan,
	sitemapRouteOverlaps,
	type SitemapDecisionContext,
	type SitemapRouting,
	type SitemapSourceRow,
} from "./sitemap-engine.ts";
import {
	classifySitemapInstallation,
	sitemapPageAddress,
	sitemapRouteWinner,
	validSitemapInstallation,
} from "./sitemap-installation.ts";

const plain: SitemapRouting = { trailingSlash: "ignore", i18n: null };
const routed: SitemapRouting = {
	trailingSlash: "ignore",
	i18n: { defaultLocale: "en", locales: ["en", "fr", { path: "spanish", codes: ["es", "es-ES"] }], prefixDefaultLocale: false },
};
const route = (input: Partial<Parameters<typeof resolveSitemapRoute>[0]>, routing: SitemapRouting = plain) =>
	resolveSitemapRoute({ pattern: null, collection: "posts", slug: "hello", id: "01A", publishedAt: null, locale: "en", ...input }, routing).path;

// Route parity with EmDash 1.1.0 getPublicUrl.
assert.equal(route({}), "/posts/hello");
assert.equal(route({ pattern: "/blog/{slug}/" }), "/blog/hello");
assert.equal(route({ pattern: "/{year}/{month}/{day}/{slug}.html", publishedAt: "2026-01-02 23:30:00" }), "/2026/01/02/hello.html");
assert.equal(route({ pattern: "/{year}/{slug}", publishedAt: "2026-12-31T23:30:00-02:00" }), "/2027/hello", "date tokens use UTC");
assert.equal(resolveSitemapRoute({ pattern: "/{year}/{slug}", collection: "posts", slug: "a", id: "1", publishedAt: null, locale: "en" }, plain).reason, "unresolved-route");
assert.equal(resolveSitemapRoute({ pattern: "/{category}/{slug}", collection: "posts", slug: "a", id: "1", publishedAt: null, locale: "en" }, plain).reason, "unresolved-route");
assert.equal(route({ slug: "a b/c" }), "/posts/a%20b%2Fc");
assert.equal(route({}, { ...plain, trailingSlash: "always" }), "/posts/hello/");
assert.equal(route({ pattern: "/" }, { ...plain, trailingSlash: "always" }), "/");
assert.equal(route({ locale: "fr" }, routed), "/fr/posts/hello");
assert.equal(route({ locale: "en" }, routed), "/posts/hello");
assert.equal(route({ locale: "es-ES" }, routed), "/spanish/posts/hello", "locale codes map to the custom path");
assert.equal(route({ locale: "spanish" }, routed), "/spanish/posts/hello");
assert.equal(resolveSitemapRoute({ pattern: null, collection: "posts", slug: "a", id: "1", publishedAt: null, locale: "FR" }, routed).reason, "locale-unrouted", "locale matching is exact");
assert.equal(route({ locale: "en" }, { ...routed, i18n: { ...routed.i18n!, prefixDefaultLocale: true } }), "/en/posts/hello");
const objectDefault: SitemapRouting = { trailingSlash: "ignore", i18n: { defaultLocale: "en", locales: [{ path: "z-en", codes: ["en"] }, "de"], prefixDefaultLocale: false } };
assert.equal(route({ locale: "z-en" }, objectDefault), "/posts/hello", "a default locale named by code keeps its path unprefixed");

// Accepted locales: one unprefixed address per entry without locale routing.
assert.deepEqual(sitemapAcceptedLocales(plain, "en"), ["en"]);
assert.deepEqual(sitemapAcceptedLocales({ trailingSlash: "ignore", i18n: { defaultLocale: "de", locales: ["de"], prefixDefaultLocale: false } }, "en"), ["de"]);
assert.deepEqual(sitemapAcceptedLocales(routed, "en"), ["en", "es", "es-ES", "fr", "spanish"]);

// Path keys: Unicode and percent forms agree; a decoded slash stays reserved.
assert.equal(sitemapPathKey("/über/"), sitemapPathKey("/%C3%BCber"));
assert.notEqual(sitemapPathKey("/a%2Fb"), sitemapPathKey("/a/b"));
assert.notEqual(sitemapPathKey("/a%252Fb"), sitemapPathKey("/a%2Fb"));
assert.equal(sitemapPathKey("/"), "/");
assert.ok(sitemapExclusionKeys(["/thank-you/", "https://bad.example/x"]).has("/thank-you"));

// Selection defaults: Pages and Posts only; explicit choices win.
const collections = [
	{ key: "pages", label: "Pages", urlPattern: null },
	{ key: "posts", label: "Posts", urlPattern: null },
	{ key: "services", label: "Services", urlPattern: null },
];
assert.deepEqual(resolveSitemapSelection(collections, null).map((item) => item.selected), [true, true, false]);
assert.deepEqual(resolveSitemapSelection(collections, { pages: false, services: true }).map((item) => [item.selected, item.source]),
	[[false, "saved"], [true, "default"], [true, "saved"]]);

// Routing boundary.
assert.equal(sitemapPatternIsUnique({ key: "pages", urlPattern: "/about" }), false);
assert.equal(sitemapPatternIsUnique({ key: "archive", urlPattern: "/{year}/{month}" }), false);
assert.equal(sitemapPatternIsUnique({ key: "posts", urlPattern: null }), true);
assert.equal(sitemapPatternIsConstant({ key: "home", urlPattern: "/" }), true);
assert.equal(sitemapPatternIsConstant({ key: "landing", urlPattern: "/campaign" }), true);
for (const pattern of [null, "/{year}", "/{year}/{month}", "/{slug}", "/{broken", "/x?query", "/../x", "//other.example"]) {
	assert.equal(sitemapPatternIsConstant({ key: "home", urlPattern: pattern }), false);
}
assert.deepEqual(sitemapRouteOverlaps(collections, plain), []);
assert.equal(sitemapRouteOverlaps([{ key: "pages", urlPattern: "/{slug}" }, { key: "posts", urlPattern: "/{slug}" }], plain).length, 1);
assert.equal(sitemapRouteOverlaps([{ key: "pages", urlPattern: "/{slug}" }, { key: "posts", urlPattern: "/blog/{slug}" }], plain).length, 0);
assert.equal(sitemapRouteOverlaps([{ key: "pages", urlPattern: "/{slug}/{id}" }, { key: "posts", urlPattern: "/{slug}" }], routed).length, 1,
	"an unprefixed two-segment pattern can match a prefixed one-segment pattern");

// Decisions.
const origin = "https://example.com";
const context: SitemapDecisionContext = {
	collection: { key: "posts", label: "Posts", urlPattern: null },
	routing: plain,
	origin,
	exclusions: sitemapExclusionKeys(["/posts/excluded"]),
	seoUrls: portableSitemapSeoUrls,
	maxUrlLength: SITEMAP_LIMITS.maxUrlLength,
};
const row = (input: Partial<SitemapSourceRow> = {}): SitemapSourceRow => ({
	id: "01A", slug: "hello", locale: "en", translationGroup: null, updatedAt: "2026-10-01 10:00:00", publishedAt: null, seo: null, ...input,
});
const seo = (input: Partial<NonNullable<SitemapSourceRow["seo"]>> = {}) => ({ noIndex: false, canonical: null, image: null, updatedAt: null, ...input });
assert.equal(decideSitemapEntry(row(), context).status, "included", "missing core SEO metadata is indexable");
assert.equal(decideSitemapEntry(row({ seo: seo({ noIndex: true }) }), context).status, "noindex");
assert.equal(decideSitemapEntry(row({ slug: "excluded" }), context).status, "excluded-path");
assert.equal(decideSitemapEntry(row({ seo: seo({ canonical: "/posts/hello" }) }), context).status, "included");
assert.equal(decideSitemapEntry(row({ seo: seo({ canonical: "posts/hello" }) }), context).status, "included", "relative canonicals start at the site root");
assert.equal(decideSitemapEntry(row({ seo: seo({ canonical: "https://example.com/posts/hello/" }) }), context).status, "canonical-elsewhere", "trailing slash differs");
assert.equal(decideSitemapEntry(row({ seo: seo({ canonical: "https://example.com/posts/hello?ref=1" }) }), context).status, "canonical-elsewhere");
assert.equal(decideSitemapEntry(row({ seo: seo({ canonical: "https://other.example/posts/hello" }) }), context).status, "canonical-elsewhere");
assert.equal(decideSitemapEntry(row({ seo: seo({ canonical: "//example.com/posts/hello" }) }), context).status, "included");
assert.equal(decideSitemapEntry(row({ seo: seo({ canonical: "javascript:alert(1)" }) }), context).status, "canonical-elsewhere",
	"EmDash resolves a scheme-like text as a site path, which is another address");
assert.equal(decideSitemapEntry(row({ seo: seo({ canonical: "https://bad host/x" }) }), context).status, "canonical-invalid");
assert.equal(decideSitemapEntry(row({ legacy: { canonical: "/posts/hello", noIndex: false, image: null }, seo: seo({ canonical: "/elsewhere" }) }), context).status,
	"included", "a legacy override's canonical replaces the core one, as on the page");
assert.equal(decideSitemapEntry(row({ legacy: { canonical: null, noIndex: true, image: null } }), context).status, "noindex");
assert.equal(decideSitemapEntry(row({ seo: seo({ image: "01MEDIA" }) }), context).image, "https://example.com/_emdash/api/media/file/01MEDIA");
assert.equal(decideSitemapEntry(row({ seo: seo({ image: "/media/a.jpg" }) }), context).image, "https://example.com/media/a.jpg");
assert.equal(decideSitemapEntry(row({ seo: seo({ image: "//cdn.example/a.jpg" }) }), context).image, "https://cdn.example/a.jpg");
assert.equal(decideSitemapEntry(row({ seo: seo({ image: "/core.jpg" }), legacy: { canonical: null, noIndex: false, image: "https://cdn.example/legacy.jpg" } }), context).image,
	"https://cdn.example/legacy.jpg");
assert.equal(decideSitemapEntry(row({ seo: seo({ image: "/core.jpg" }), legacy: { canonical: null, noIndex: false, image: "javascript:x" } }), context).image,
	null, "an unusable legacy image replaces the core image without fallback");
const unicode = decideSitemapEntry(row(), { ...context, collection: { key: "posts", label: "Posts", urlPattern: "/über/{slug}" } });
assert.equal(unicode.url, "https://example.com/%C3%BCber/hello", "emitted URLs are serialized");
assert.equal(decideSitemapEntry(row({ slug: ".." }), context).status, "invalid-url", "dot segments are refused");
assert.equal(decideSitemapEntry(row({ slug: "x".repeat(2100) }), context).status, "invalid-url");
assert.equal(decideSitemapEntry(row({ seo: seo({ updatedAt: "2026-10-02 08:00:00" }) }), context).lastmod, "2026-10-02T08:00:00.000Z",
	"an SEO-only write advances lastmod");
assert.equal(decideSitemapEntry(row({ seo: seo({ updatedAt: "2026-09-01 08:00:00" }) }), context).lastmod, "2026-10-01T10:00:00.000Z");
assert.equal(sitemapLastmod("not a date"), null);

// Alternates: only included siblings, x-default from the default locale.
const routedContext = { ...context, routing: objectDefault };
const group = [
	decideSitemapEntry(row({ id: "01A", locale: "z-en", translationGroup: "g1" }), routedContext),
	decideSitemapEntry(row({ id: "01B", locale: "de", translationGroup: "g1" }), routedContext),
];
const alternates = sitemapAlternates([group[1]], group, objectDefault).get("01B")!;
assert.deepEqual(alternates.find((item) => item.hreflang === "x-default")?.href, "https://example.com/posts/hello");
assert.ok(alternates.some((item) => item.hreflang === "en"), "an object locale path maps to its language code");
const excludedSibling = decideSitemapEntry(row({ id: "01C", locale: "de", slug: "excluded", translationGroup: "g2" }),
	{ ...routedContext, exclusions: sitemapExclusionKeys(["/de/posts/excluded"]) });
assert.equal(excludedSibling.status, "excluded-path", "exclusions match the full localized path");
const keptSibling = decideSitemapEntry(row({ id: "01D", locale: "z-en", translationGroup: "g2", slug: "kept" }), routedContext);
assert.deepEqual(sitemapAlternates([keptSibling], [keptSibling, excludedSibling], objectDefault).get("01D")!.map((item) => item.hreflang), ["en", "x-default"]);
assert.equal(sitemapAlternates([keptSibling], [keptSibling], plain).size, 0, "no alternates without locale routing");
const duplicates = markDuplicateSitemapUrls([decideSitemapEntry(row({ id: "01A" }), context), decideSitemapEntry(row({ id: "01B" }), context)]);
assert.deepEqual(duplicates.map((entry) => entry.status), ["included", "duplicate-url"]);

// Public addresses.
assert.deepEqual(parseSitemapPublicPath("/sitemap.xml", ""), { match: "file", file: { kind: "index" } });
assert.equal(parseSitemapPublicPath("/sitemap.xml", "?x=1").match, "invalid");
assert.deepEqual(parseSitemapPublicPath("/sitemap-posts.xml", "?after=01ABC"), { match: "file", file: { kind: "child", collection: "posts", after: "01ABC" } });
assert.equal(parseSitemapPublicPath("/sitemap-posts.xml", "?after=a&after=b").match, "invalid");
assert.equal(parseSitemapPublicPath("/sitemap-posts.xml", "?page=2").match, "invalid");
assert.equal(parseSitemapPublicPath("/sitemap-posts.xml", "?after=").match, "invalid");
assert.equal(parseSitemapPublicPath("/sitemap-Posts.xml", "").match, "invalid");
assert.equal(parseSitemapPublicPath("/sitemap-posts-2.xml", "").match, "invalid", "only collection identifiers name child files");
assert.equal(parseSitemapPublicPath("/sitemaps.xml", "").match, "none");
assert.equal(parseSitemapPublicPath("/sitemap.xml/", "").match, "none");
assert.equal(sitemapChildPath("posts", "01A&b"), "/sitemap-posts.xml?after=01A%26b");

// XML: escaping, namespaces and both protocol limits, without partial files.
const escaped = decideSitemapEntry(row({ slug: "a&b" }), { ...context, collection: { key: "posts", label: "Posts", urlPattern: "/x/{slug}'s" } });
const xml = renderSitemapUrlset([escaped], new Map());
assert.ok(xml.includes("<loc>https://example.com/x/a%26b&apos;s</loc>"));
assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
assert.ok(!xml.includes("xmlns:xhtml") && !xml.includes("priority") && !xml.includes("changefreq"));
const many = Array.from({ length: 4 }, (_, index) => decideSitemapEntry(row({ id: `0${index}`, slug: `s${index}` }), context));
assert.throws(() => renderSitemapUrlset(many, new Map(), { ...SITEMAP_LIMITS, maxUrls: 3 }), SitemapCapacityError);
assert.throws(() => renderSitemapUrlset(many, new Map(), { ...SITEMAP_LIMITS, maxBytes: 300 }), SitemapCapacityError);
assert.throws(() => renderSitemapIndex(origin, [{ collection: "a", after: null }, { collection: "b", after: null }], { ...SITEMAP_LIMITS, maxUrls: 1 }), SitemapCapacityError);
const index = renderSitemapIndex(origin, [{ collection: "posts", after: null }, { collection: "posts", after: "01B" }]);
assert.ok(index.includes("<loc>https://example.com/sitemap-posts.xml?after=01B</loc>") && !index.includes("lastmod"));

// Byte limit: the page size comes from a worst-case entry bound, so a full
// file of maximal, fully escaped URLs with every alternate still fits.
assert.equal(sitemapPageSize(plain, "en"), 500, "real limits keep 500 rows without locale routing");
const manyLocales: SitemapRouting = {
	trailingSlash: "ignore",
	i18n: { defaultLocale: "l0", locales: Array.from({ length: 40 }, (_, index) => `l${index}`), prefixDefaultLocale: false },
};
assert.ok(sitemapPageSize(manyLocales, "en") < 500, "many routed locales shrink files below the URL count");
assert.ok(sitemapPageSize(manyLocales, "en") * sitemapEntryByteBound(manyLocales, "en") <= SITEMAP_LIMITS.maxBytes);
const smallLimits = { pageSize: 500, maxUrls: 50_000, maxBytes: 80_000, maxUrlLength: 120 };
const tight = sitemapPageSize(manyLocales, "en", smallLimits);
assert.ok(tight >= 1 && tight < 10, `small byte limits split files early (${tight})`);
const worstUrl = (index: number) => `https://e.co/${String(index).padStart(3, "0")}${"'&".repeat(60)}`.slice(0, smallLimits.maxUrlLength);
const worstEntries = Array.from({ length: tight }, (_, index) => ({
	id: `w${index}`, locale: "l0", translationGroup: "g", status: "included" as const, path: "/x",
	url: worstUrl(index), lastmod: "2026-10-01T10:00:00.000Z", image: worstUrl(index + 500), canonical: null,
}));
const worstAlternates = new Map(worstEntries.map((entry) => [entry.id, [
	...Array.from({ length: 40 }, (_, index) => ({ hreflang: `${"'".repeat(60)}${index}`.slice(0, 64), href: worstUrl(index + 900) })),
	{ hreflang: "x-default", href: worstUrl(999) },
]]));
const worstXml = renderSitemapUrlset(worstEntries, worstAlternates, smallLimits);
assert.ok(new TextEncoder().encode(worstXml).byteLength <= smallLimits.maxBytes, "a full worst-case file stays within the byte limit");
assert.ok(worstXml.includes("&apos;&amp;") && worstXml.includes('hreflang="x-default"'), "escaping and alternates are kept, not trimmed");

// Keyset files: a file emptied by filters does not hide the next file.
const rows = ["01", "02", "03", "04", "05"].map((id) => row({ id, slug: id === "03" || id === "04" ? "excluded" : `s${id}` }));
const pageSize = 2;
const plan = sitemapPlan(rows.length, rows.filter((_, position) => (position + 1) % pageSize === 0 && position + 1 < rows.length).map((item) => item.id));
assert.deepEqual(plan.cursors, [null, "02", "04"]);
const fileRows = (after: string | null) => rows.filter((item) => after === null || item.id > after).slice(0, pageSize);
const decided = plan.cursors.map((after) => markDuplicateSitemapUrls(fileRows(after).map((item) => decideSitemapEntry(item, { ...context, exclusions: sitemapExclusionKeys(["/posts/excluded"]) }))));
assert.deepEqual(decided.map((file) => file.filter((entry) => entry.status === "included").map((entry) => entry.id)), [["01", "02"], [], ["05"]]);
assert.deepEqual(sitemapPlan(0, []), { rowCount: 0, cursors: [] });

// Installation ownership.
const facts = { emdashVersion: "1.1.0", pageEntries: [], publicFiles: [], integrations: ["@astrojs/react", "emdash"] };
assert.equal(classifySitemapInstallation(facts).owner, "shipit");
assert.equal(classifySitemapInstallation({ ...facts, emdashVersion: "1.2.0" }).owner, "shipit");
assert.equal(classifySitemapInstallation({ ...facts, emdashVersion: "1.3.0" }).owner, "shipit");
assert.equal(classifySitemapInstallation({ ...facts, emdashVersion: "1.4.0" }).owner, "unsupported-host");
assert.equal(classifySitemapInstallation({ ...facts, emdashVersion: "1.0.1" }).owner, "unsupported-host");
assert.equal(classifySitemapInstallation({ ...facts, publicFiles: ["sitemap.xml"] }).owner, "static-file");
const unreadable = classifySitemapInstallation({ ...facts, inspectionError: "public could not be read (EACCES)" });
assert.equal(unreadable.owner, "unknown");
assert.deepEqual(validSitemapInstallation(JSON.parse(JSON.stringify(unreadable))), unreadable);
assert.equal(classifySitemapInstallation({ ...facts, inspectionError: "src/pages could not be read (EACCES)", publicFiles: ["sitemap.xml"] }).owner, "static-file");
assert.equal(classifySitemapInstallation({ ...facts, publicFiles: ["sitemap.xml.gz", "sitemap.xml.ts", "robots.txt"] }).owner, "shipit",
	"public files own only their exact address");
assert.equal(classifySitemapInstallation({ ...facts, pageEntries: [{ name: "sitemap.xml.ts", directory: false }] }).owner, "site-route");
assert.equal(classifySitemapInstallation({ ...facts, pageEntries: [{ name: "sitemap-[collection].xml.astro", directory: false }] }).owner, "site-route");
assert.equal(classifySitemapInstallation({ ...facts, pageEntries: [{ name: "sitemap.xml.gz", directory: false }] }).owner, "shipit");
assert.equal(sitemapPageAddress({ name: "sitemap.xml", directory: true, children: ["index.ts"] }), "sitemap.xml");
assert.equal(sitemapPageAddress({ name: "sitemap.xml", directory: true, children: ["notes.txt"] }), null);
assert.equal(classifySitemapInstallation({ ...facts, integrations: ["@astrojs/sitemap"] }).owner, "integration");
assert.equal(classifySitemapInstallation({ ...facts, base: "/docs" }).owner, "unsupported-routing");
assert.equal(classifySitemapInstallation({ ...facts, i18n: { defaultLocale: "en", locales: ["en", "fr"], domains: { fr: "https://fr.example" } } }).owner, "unsupported-routing");
assert.equal(classifySitemapInstallation({ ...facts, i18n: { defaultLocale: "en", locales: ["en", "fr"], routing: "manual" } }).owner, "unsupported-routing");
const withI18n = classifySitemapInstallation({ ...facts, trailingSlash: "always", i18n: { defaultLocale: "en", locales: ["en", { path: "spanish", codes: ["es"] }], routing: { prefixDefaultLocale: true } } });
assert.deepEqual(withI18n.routing, { trailingSlash: "always", i18n: { defaultLocale: "en", locales: ["en", { path: "spanish", codes: ["es"] }], prefixDefaultLocale: true } });
assert.deepEqual(validSitemapInstallation(JSON.parse(JSON.stringify(withI18n))), withI18n);
assert.equal(validSitemapInstallation({ owner: "shipit", detail: null, routing: null }), null);
assert.equal(validSitemapInstallation({ owner: "everyone", detail: null, routing: null }), null);

// Route precedence, in the order Astro 7.3.2 sorts resolved routes: static,
// then mixed segments tie-broken by route.localeCompare, then rest routes.
const resolvedRoute = (pattern: string, regex: RegExp, core = false) => ({ pattern, patternRegex: regex, entrypoint: core ? "node_modules/emdash/dist/astro/routes/x.mjs" : "src/integration/route.ts" });
const coreIndex = resolvedRoute("/sitemap.xml", /^\/sitemap\.xml\/?$/, true);
const coreChild = resolvedRoute("/sitemap-[collection].xml", /^\/sitemap-([^/]+?)\.xml\/?$/, true);
const generic = resolvedRoute("/[name].xml", /^\/([^/]+?)\.xml\/?$/);
const catchAll = resolvedRoute("/[...slug]", /^(?:\/(.*?))?\/?$/);
const isCore = (item: { entrypoint: string }) => item.entrypoint.includes("/emdash/dist/");
assert.ok("/[name].xml".localeCompare("/sitemap-[collection].xml") < 0, "Astro's final tie-break puts the generic route first");
assert.equal(sitemapRouteWinner([coreIndex, coreChild, catchAll], isCore), null, "a rest route never wins a sitemap address");
assert.match(sitemapRouteWinner([coreIndex, generic, coreChild, catchAll], isCore) ?? "", /^\/\[name\]\.xml answers \/sitemap-pages\.xml$/,
	"a generic route that outranks the child route keeps those addresses");
assert.equal(sitemapRouteWinner([coreIndex, coreChild, generic], isCore), null, "a generic route sorted after EmDash's routes is harmless");
assert.match(sitemapRouteWinner([resolvedRoute("/sitemap-news.xml", /^\/sitemap-news\.xml\/?$/), coreIndex, coreChild], isCore) ?? "", /sitemap-news/);
const numbered = resolvedRoute("/sitemap-[collection]-[page].xml", /^\/sitemap-([^/]+?)-([^/]+?)\.xml\/?$/);
assert.match(sitemapRouteWinner([coreIndex, numbered, coreChild, catchAll], isCore) ?? "", /answers \/sitemap-pages-1\.xml$/,
	"a competing numbered child route keeps its addresses");
assert.equal(sitemapRouteWinner([coreIndex, coreChild, numbered], isCore), null, "core keeps numbered addresses it wins");
assert.match(sitemapRouteWinner([resolvedRoute("/sitemap-posts-2.xml", /^\/sitemap-posts-2\.xml\/?$/), coreIndex, coreChild], isCore) ?? "", /sitemap-posts-2/);
const products = resolvedRoute("/[prefix]-products.xml", /^\/([^/]+?)-products\.xml\/?$/);
assert.ok("/[prefix]-products.xml".localeCompare("/sitemap-[collection].xml") < 0);
assert.match(sitemapRouteWinner([coreIndex, products, coreChild, catchAll], isCore) ?? "", /answers \/sitemap-products\.xml$/,
	"a generic route is probed at the sitemap addresses its own pattern produces");
assert.equal(sitemapRouteWinner([coreIndex, coreChild, products], isCore), null, "the same route sorted after EmDash's is harmless");
const pageNamedProducts = resolvedRoute("/[page]-products.xml", /^\/([^/]+?)-products\.xml\/?$/);
assert.match(sitemapRouteWinner([coreIndex, pageNamedProducts, coreChild, catchAll], isCore) ?? "", /answers \/sitemap-products\.xml$/,
	"a parameter named page can still hold a generic sitemap prefix");
assert.equal(sitemapRouteWinner([coreIndex, resolvedRoute("/feed-[x].xml", /^\/feed-([^/]+?)\.xml\/?$/), coreChild], isCore), null,
	"a pattern that cannot produce a sitemap address never competes");

console.log("SEO sitemap engine self-check passed.");
