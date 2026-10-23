import assert from "node:assert/strict";

import { SEO_ADMIN_CONTRACT_VERSION } from "./admin-contract.ts";
import { UNKNOWN_INDEXNOW_INSTALLATION } from "./indexnow.ts";
import { createSeoEngine } from "./sandbox-entry.ts";
import {
	SITEMAP_LIMITS,
	SitemapCapacityError,
	portableSitemapSeoUrls,
	type SitemapSource,
	type SitemapSourceRow,
	type SitemapRouting,
} from "./sitemap-engine.ts";
import { SITEMAP_SETTINGS_KEY, readSitemapPortableValues, type SitemapHost } from "./sitemap-runtime.ts";

interface Row extends SitemapSourceRow {
	collection: string;
	status: string;
	deleted: boolean;
}

function row(collection: string, id: string, input: Partial<Row> = {}): Row {
	return {
		collection, id, slug: `${collection}-${id}`, locale: "en", translationGroup: null, updatedAt: "2026-10-01 10:00:00",
		publishedAt: "2026-09-01 10:00:00", seo: null, status: "published", deleted: false, ...input,
	};
}

/** Same candidate predicate as the native source, with call counts. */
function memorySource(rows: Row[], calls: string[]): SitemapSource {
	const candidates = (collection: string, locales: string[]) => rows
		.filter((item) => item.collection === collection && item.status === "published" && !item.deleted &&
			item.slug.trim() !== "" && locales.includes(item.locale))
		.sort((left, right) => (left.id < right.id ? -1 : 1));
	return {
		async planFiles(collection, filter, pageSize) {
			calls.push(`plan ${collection}`);
			const list = candidates(collection, filter.locales);
			const boundaries = list.filter((_, index) => (index + 1) % pageSize === 0 && index + 1 < list.length).map((item) => item.id);
			return list.length ? { rowCount: list.length, cursors: [null, ...boundaries] } : { rowCount: 0, cursors: [] };
		},
		async readRows(collection, filter, range) {
			calls.push(`rows ${collection} ${range.after ?? "start"}`);
			return candidates(collection, filter.locales).filter((item) => range.after === null || item.id > range.after).slice(0, range.limit);
		},
		async readGroups(collection, filter, groups) {
			calls.push(`groups ${collection} ${groups.length}`);
			return candidates(collection, filter.locales).filter((item) => item.translationGroup && groups.includes(item.translationGroup));
		},
	};
}

function versionedKv() {
	const values = new Map<string, { value: unknown; revision: string }>();
	let counter = 0;
	let writes = 0;
	const kv = {
		get: async (key: string) => structuredClone(values.get(key)?.value ?? null),
		set: async (key: string, value: unknown) => {
			writes += 1;
			values.set(key, { value: structuredClone(value), revision: `r${++counter}` });
		},
		delete: async (key: string) => {
			writes += 1;
			return values.delete(key);
		},
		list: async () => [],
		getVersioned: async (key: string) => {
			const current = values.get(key);
			return current ? { value: structuredClone(current.value), revision: current.revision } : null;
		},
		compareAndSet: async (key: string, expected: string | null, value: unknown) => {
			if ((values.get(key)?.revision ?? null) !== expected) return { applied: false };
			writes += 1;
			const revision = `r${++counter}`;
			values.set(key, { value: structuredClone(value), revision });
			return { applied: true, revision };
		},
		compareAndDelete: async (key: string, expected: string) => {
			if (values.get(key)?.revision !== expected) return { applied: false };
			writes += 1;
			values.delete(key);
			return { applied: true };
		},
	};
	return { kv, values, get writes() { return writes; } };
}

const COLLECTIONS = [
	{ slug: "pages", label: "Pages", labelSingular: "Page", hasSeo: false, urlPattern: null, routable: true, hidden: false },
	{ slug: "posts", label: "Posts", labelSingular: "Post", hasSeo: false, urlPattern: null, routable: true, hidden: false },
	{ slug: "services", label: "Services", labelSingular: "Service", hasSeo: true, urlPattern: "/services/{slug}", routable: true, hidden: false },
	{ slug: "forms", label: "Form submissions", labelSingular: "Submission", hasSeo: false, urlPattern: null, routable: false, hidden: true },
];

function harness(options: { collections?: typeof COLLECTIONS; rows?: Row[]; owner?: "shipit" | "site-route"; pageSize?: number; source?: SitemapSource; overrides?: Map<string, unknown>; siteUrl?: string; publicOrigin?: string | null; routing?: SitemapRouting } = {}) {
	const store = versionedKv();
	store.values.set("settings:noindex", { value: false, revision: "r0" });
	const calls: string[] = [];
	const overrideCalls: string[] = [];
	const overrides = options.overrides ?? new Map<string, unknown>();
	const host: SitemapHost = {
		installation: { owner: options.owner ?? "shipit", detail: options.owner === "site-route" ? "src/pages/sitemap.xml.ts" : null, routing: options.routing ?? { trailingSlash: "ignore", i18n: null } },
		seoUrls: portableSitemapSeoUrls,
		...(options.publicOrigin !== undefined ? { publicOrigin: options.publicOrigin } : {}),
		openSource: async () => options.source ?? memorySource(options.rows ?? [], calls),
		...(options.pageSize ? { limits: { ...SITEMAP_LIMITS, pageSize: options.pageSize } } : {}),
	};
	const engine = createSeoEngine(UNKNOWN_INDEXNOW_INSTALLATION, { sitemap: host });
	const collections = options.collections ?? COLLECTIONS;
	const context = () => ({
		plugin: { id: "shipit-seo", version: "test" },
		site: { name: "Example", url: options.siteUrl ?? "https://example.com", locale: "en" },
		schema: { listCollections: async () => structuredClone(collections) },
		kv: store.kv,
		// Other plugin collections are empty; overrides record their calls.
		storage: new Proxy({
			overrides: {
				query: async (input: { limit: number }) => {
					overrideCalls.push(`query ${input.limit}`);
					return { items: [...overrides.keys()].slice(0, input.limit).map((id) => ({ id, data: overrides.get(id) })), hasMore: false };
				},
				getMany: async (ids: string[]) => {
					overrideCalls.push(`getMany ${ids.length}`);
					return new Map(ids.filter((id) => overrides.has(id)).map((id) => [id, overrides.get(id)]));
				},
				count: async () => overrides.size,
				get: async (id: string) => overrides.get(id) ?? null,
			},
		} as Record<string, unknown>, {
			get: (target, name) => target[name as string] ?? {
				count: async () => 0,
				query: async () => ({ items: [], hasMore: false }),
				get: async () => null,
				getMany: async () => new Map(),
			},
		}),
		log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
	});
	const call = (name: string, input: unknown = {}) =>
		(engine as any).routes[name].handler({ input, request: new Request("https://example.com/_emdash/api/plugins/shipit-seo/x") }, context());
	return { store, call, calls, overrideCalls };
}

// Defaults: builtin Pages and Posts; custom and unroutable types stay out.
const fresh = harness({ rows: [row("pages", "01"), row("posts", "02"), row("services", "03")] });
const initial = await fresh.call("admin-sitemap");
assert.equal(initial.contractVersion, SEO_ADMIN_CONTRACT_VERSION);
assert.equal(initial.settings, "default");
assert.equal(initial.revision, null);
assert.equal(initial.owner, "shipit");
assert.equal(initial.availability, "ready");
assert.deepEqual(initial.groups.map((group: any) => [group.key, group.source, group.unique]), [["pages", "default", true], ["posts", "default", true], ["services", "default", true]]);
assert.deepEqual(initial.values.contentTypes, { pages: true, posts: true, services: false });
assert.deepEqual(initial.plan.map((plan: any) => [plan.collection, plan.candidates, plan.files.length]), [["pages", 1, 1], ["posts", 1, 1]]);
const index = await fresh.call("sitemap", {});
assert.equal(index.status, 200);
assert.ok(index.body.includes("<loc>https://example.com/sitemap-pages.xml</loc>") && index.body.includes("sitemap-posts.xml"));
assert.ok(!index.body.includes("sitemap-services.xml"), "an unselected custom type is not listed");
assert.equal((await fresh.call("sitemap", { collection: "services" })).status, 404);
assert.equal((await fresh.call("sitemap", { collection: "forms" })).status, 404);
const posts = await fresh.call("sitemap", { collection: "posts" });
assert.ok(posts.body.includes("<loc>https://example.com/posts/posts-02</loc>"));
assert.equal(posts.cacheControl, "public, max-age=300");
assert.equal((await fresh.call("sitemap", { invalid: "true" })).status, 404);
assert.equal(fresh.store.writes, 0, "reads, previews and public requests never write");

// Saved choices, conflicts and reload.
const saved = await fresh.call("save-admin-sitemap", { contentTypes: { pages: false, posts: true, services: true }, excludedPaths: [" /posts/posts-02/ "], expectedRevision: null });
assert.equal(saved.success, true);
assert.ok(saved.sitemap.revision);
assert.deepEqual(saved.sitemap.values.excludedPaths, ["/posts/posts-02"]);
const stale = await fresh.call("save-admin-sitemap", { contentTypes: { pages: true }, excludedPaths: [], expectedRevision: null });
assert.equal(stale.success, false);
assert.equal(stale.conflict, true);
const reloaded = await fresh.call("admin-sitemap");
assert.equal(reloaded.settings, "saved");
assert.deepEqual(reloaded.values.contentTypes, { pages: false, posts: true, services: true });
const afterSave = await fresh.call("sitemap", {});
assert.ok(!afterSave.body.includes("sitemap-pages.xml") && afterSave.body.includes("sitemap-services.xml"));
const excluded = await fresh.call("sitemap", { collection: "posts" });
assert.equal(excluded.status, 200);
assert.ok(!excluded.body.includes("posts-02"), "an exact path exclusion removes the address from the child file");
assert.equal((await fresh.call("save-admin-sitemap", { contentTypes: { unknown: true }, excludedPaths: [], expectedRevision: reloaded.revision })).success, false);
assert.equal((await fresh.call("save-admin-sitemap", { contentTypes: {}, excludedPaths: ["/news/*"], expectedRevision: reloaded.revision })).errors.excludedPaths !== undefined, true);

// Preview mirrors the child file and explains omissions.
const preview = await fresh.call("preview-admin-sitemap", { collection: "posts", after: null });
assert.equal(preview.success, true);
assert.equal(preview.fileUrl, "https://example.com/sitemap-posts.xml");
assert.deepEqual(preview.entries.map((entry: any) => entry.status), ["excluded-path"]);

// A collection added after saving stays out; stored keys for absent types are kept.
fresh.store.values.set(SITEMAP_SETTINGS_KEY, {
	value: { version: 1, updatedAt: "2026-10-01T00:00:00.000Z", values: { contentTypes: { staticRoutes: true, posts: true, archived: true }, excludedPaths: [] } },
	revision: "legacy",
});
const legacy = await fresh.call("admin-sitemap");
assert.deepEqual(legacy.preservedKeys, ["archived", "staticRoutes"]);
assert.equal(legacy.values.contentTypes.pages, true, "builtin Pages without a stored choice keep their default");
assert.equal(legacy.values.contentTypes.services, false, "a type without a stored choice stays unselected");
const preserved = await fresh.call("save-admin-sitemap", { contentTypes: { pages: true, posts: true, services: false }, excludedPaths: [], expectedRevision: "legacy" });
assert.equal(preserved.success, true);
const stored = fresh.store.values.get(SITEMAP_SETTINGS_KEY)!.value as any;
assert.equal(stored.values.contentTypes.staticRoutes, true);
assert.equal(stored.values.contentTypes.archived, true);
const portableContext = { kv: fresh.store.kv, schema: { listCollections: async () => COLLECTIONS } } as never;
assert.deepEqual((await readSitemapPortableValues(portableContext)).values.contentTypes,
	{ staticRoutes: true, pages: true, posts: true, services: false, archived: true });

// Reset is revision checked.
assert.equal((await fresh.call("reset-admin-sitemap", { expectedRevision: "stale" })).conflict, true);
const reset = await fresh.call("reset-admin-sitemap", { expectedRevision: preserved.sitemap.revision });
assert.equal(reset.success, true);
assert.equal(reset.sitemap.settings, "default");
assert.equal(fresh.store.values.has(SITEMAP_SETTINGS_KEY), false);

// Corrupt records are not defaults.
fresh.store.values.set(SITEMAP_SETTINGS_KEY, { value: { version: 1, values: "broken" }, revision: "bad" });
const corrupt = await fresh.call("admin-sitemap");
assert.equal(corrupt.settings, "corrupt");
assert.equal(corrupt.availability, "settings-corrupt");
const corruptPublic = await fresh.call("sitemap", {});
assert.equal(corruptPublic.status, 503);
assert.equal(corruptPublic.cacheControl, "no-store");
await assert.rejects(readSitemapPortableValues({ kv: fresh.store.kv, schema: { listCollections: async () => COLLECTIONS } } as any));
assert.equal((await fresh.call("save-admin-sitemap", { contentTypes: { pages: true }, excludedPaths: [], expectedRevision: "bad" })).success, false);
const replaced = await fresh.call("save-admin-sitemap", { contentTypes: { pages: true }, excludedPaths: [], expectedRevision: "bad", replaceInvalid: true });
assert.equal(replaced.success, true);
assert.equal(replaced.sitemap.settings, "saved");

// The routing boundary refuses selections that can share addresses.
const shared = harness({ collections: [
	...COLLECTIONS.slice(0, 2),
	{ slug: "landing", label: "Landing", labelSingular: "Landing", hasSeo: true, urlPattern: "/campaign", routable: true, hidden: false },
	{ slug: "topics", label: "Topics", labelSingular: "Topic", hasSeo: true, urlPattern: "/pages/{slug}", routable: true, hidden: false },
], rows: [row("landing", "01"), row("landing", "02")] });
assert.match((await shared.call("save-admin-sitemap", { contentTypes: { landing: true }, excludedPaths: [], expectedRevision: null })).errors.contentTypes, /one fixed address/);
assert.match((await shared.call("save-admin-sitemap", { contentTypes: { topics: true }, excludedPaths: [], expectedRevision: null })).errors.contentTypes, /same address/);
shared.store.values.set(SITEMAP_SETTINGS_KEY, { value: { version: 1, updatedAt: "2026-10-01T00:00:00.000Z", values: { contentTypes: { topics: true }, excludedPaths: [] } }, revision: "x" });
const conflicted = await shared.call("admin-sitemap");
assert.equal(conflicted.availability, "route-conflict");
assert.deepEqual(conflicted.overlaps, [{ collections: ["pages", "topics"] }]);
assert.equal((await shared.call("sitemap", {})).status, 503);

// Fixed collection paths are proven from current public candidates, not their
// names or a custom singleton field. Reads never persist that proof.
const homeDefinition = { slug: "home", label: "Home", labelSingular: "Home", hasSeo: true, urlPattern: "/", routable: true, hidden: false };
const homeRows = [row("home", "01", { slug: "home" })];
const fixed = harness({ collections: [...COLLECTIONS, homeDefinition], rows: homeRows });
const fixedAdmin = await fixed.call("admin-sitemap");
assert.equal(fixedAdmin.groups.find((group: any) => group.key === "home").unique, true,
	"a currently unique unselected fixed path can be selected");
assert.equal(fixedAdmin.values.contentTypes.home, false);
const fixedSave = await fixed.call("save-admin-sitemap", { contentTypes: { home: true }, excludedPaths: [], expectedRevision: null });
assert.equal(fixedSave.success, true);
assert.equal((await fixed.call("sitemap", {})).body.includes("sitemap-home.xml"), true);
const fixedChild = await fixed.call("sitemap", { collection: "home" });
assert.equal(fixedChild.status, 200);
assert.equal((fixedChild.body.match(/<loc>https:\/\/example.com\/<\/loc>/g) ?? []).length, 1);
assert.equal((await fixed.call("preview-admin-sitemap", { collection: "home", after: null })).entries[0].url, "https://example.com/");

homeRows.push(row("home", "02", { slug: "second" }));
assert.equal((await fixed.call("sitemap", {})).status, 503, "the index rechecks after a second entry is published");
assert.equal((await fixed.call("sitemap", { collection: "home" })).status, 503, "the child rechecks independently");
assert.equal((await fixed.call("admin-sitemap")).groups.find((group: any) => group.key === "home").unique, false);
homeRows.pop();
assert.equal((await fixed.call("sitemap", { collection: "home" })).status, 200);
const beforeReadWrites = fixed.store.writes;
await fixed.call("admin-sitemap");
await fixed.call("sitemap", {});
assert.equal(fixed.store.writes, beforeReadWrites);

// Rows that resolve to different locale paths can coexist; alias locale
// codes resolving to one prefix still conflict.
const multilingual = harness({
	collections: [homeDefinition],
	rows: [row("home", "01", { slug: "home" }), row("home", "02", { slug: "accueil", locale: "fr" })],
	routing: { trailingSlash: "always", i18n: { defaultLocale: "en", locales: ["en", "fr"], prefixDefaultLocale: false } },
});
assert.equal((await multilingual.call("save-admin-sitemap", { contentTypes: { home: true }, excludedPaths: [], expectedRevision: null })).success, true);
const localizedChild = await multilingual.call("sitemap", { collection: "home" });
assert.equal(localizedChild.status, 200);
assert.ok(localizedChild.body.includes("<loc>https://example.com/</loc>"));
assert.ok(localizedChild.body.includes("<loc>https://example.com/fr/</loc>"));
const aliases = harness({
	collections: [homeDefinition],
	rows: [row("home", "01", { locale: "es" }), row("home", "02", { locale: "es-ES" })],
	routing: { trailingSlash: "ignore", i18n: { defaultLocale: "en", locales: ["en", { path: "spanish", codes: ["es", "es-ES"] }], prefixDefaultLocale: false } },
});
assert.match((await aliases.call("save-admin-sitemap", { contentTypes: { home: true }, excludedPaths: [], expectedRevision: null })).errors.contentTypes, /one fixed address/);

// The fixed-path probe is bounded to L+1 rows, including large collections.
// Malformed or failed projected reads cannot authorize a save or response.
for (const answer of [
	[row("home", "01"), row("home", "02"), row("home", "03")],
	[row("home", "01", { locale: "fr" })],
	[row("home", "01"), row("home", "01")],
	[null],
	"unreadable",
	new Error("read failed"),
]) {
	const malformed = harness({ collections: [homeDefinition], source: {
		planFiles: async () => { throw new Error("No planning after a failed proof."); },
		readRows: async (_collection, filter, range) => {
			assert.deepEqual(filter.locales, ["en"]);
			assert.equal(range.limit, 2);
			assert.equal(range.after, null);
			if (answer instanceof Error) throw answer;
			return answer as any;
		},
		readGroups: async () => [],
	} });
	assert.equal((await malformed.call("admin-sitemap")).groups[0].unique, false);
	assert.equal((await malformed.call("save-admin-sitemap", { contentTypes: { home: true }, excludedPaths: [], expectedRevision: null })).success, false);
	assert.equal(malformed.store.writes, 0);
	malformed.store.values.set(SITEMAP_SETTINGS_KEY, { value: { version: 1, updatedAt: "2026-10-01T00:00:00.000Z", values: { contentTypes: { home: true }, excludedPaths: [] } }, revision: "x" });
	assert.equal((await malformed.call("sitemap", {})).status, 503);
	assert.equal((await malformed.call("sitemap", { collection: "home" })).status, 503);
}

const changingSource = harness({ collections: [homeDefinition], source: {
	planFiles: async () => ({ rowCount: 1, cursors: [null] }),
	readRows: async (_collection, _filter, range) => range.limit === 2
		? [row("home", "01")] : [row("home", "01"), row("home", "02")],
	readGroups: async () => [],
} });
changingSource.store.values.set(SITEMAP_SETTINGS_KEY, { value: { version: 1, updatedAt: "2026-10-01T00:00:00.000Z", values: { contentTypes: { home: true }, excludedPaths: [] } }, revision: "x" });
assert.equal((await changingSource.call("sitemap", { collection: "home" })).status, 503,
	"a new duplicate observed during child rendering is not partially advertised");

const fixedOverlap = harness({ collections: [homeDefinition, { ...homeDefinition, slug: "landing", label: "Landing" }], rows: [row("home", "01"), row("landing", "02")] });
assert.match((await fixedOverlap.call("save-admin-sitemap", { contentTypes: { home: true, landing: true }, excludedPaths: [], expectedRevision: null })).errors.contentTypes, /same address/);
const dateOnly = harness({ collections: [{ ...homeDefinition, urlPattern: "/{year}" }], rows: [row("home", "01")] });
assert.match((await dateOnly.call("save-admin-sitemap", { contentTypes: { home: true }, excludedPaths: [], expectedRevision: null })).errors.contentTypes, /without \{slug\} or \{id\}/);

// Keyset files, noindex, missing SEO and SEO-only lastmod in public XML.
const many = harness({
	pageSize: 2,
	rows: [
		row("posts", "01"),
		row("posts", "02", { seo: { noIndex: false, canonical: null, image: "01IMG", updatedAt: "2026-10-03 09:00:00" } }),
		row("posts", "03", { seo: { noIndex: true, canonical: null, image: null, updatedAt: null } }),
		row("posts", "04", { status: "draft" }),
		row("posts", "05", { deleted: true }),
		row("posts", "06", { slug: "   " }),
		row("posts", "07", { locale: "fr" }),
		row("posts", "08"),
	],
});
const plan = (await many.call("admin-sitemap")).plan.find((item: any) => item.collection === "posts");
assert.deepEqual(plan, { collection: "posts", label: "Posts", candidates: 4, files: [null, "02"] });
const second = await many.call("sitemap", { collection: "posts", after: "02" });
assert.ok(second.body.includes("posts-08") && !second.body.includes("posts-03"), "noindex rows stay out of a file that still exists");
const first = await many.call("sitemap", { collection: "posts" });
assert.ok(first.body.includes("<lastmod>2026-10-03T09:00:00.000Z</lastmod>"), "an SEO-only write advances lastmod");
assert.ok(first.body.includes("<image:loc>https://example.com/_emdash/api/media/file/01IMG</image:loc>"));
assert.ok(!first.body.includes("posts-07"), "without locale routing only the site locale has the address");
assert.equal((await many.call("sitemap", { collection: "posts", after: "08" })).status, 404);
assert.ok(!many.calls.some((entry) => entry.startsWith("plan") && many.calls.indexOf(entry) > many.calls.findIndex((item) => item.startsWith("rows"))),
	"child files never run the planning scan");

// Legacy overrides: one probe per request; only rows they can change are read.
const legacyRows = harness({
	rows: [row("posts", "01"), row("posts", "02"), row("posts", "03", { seo: { noIndex: true, canonical: null, image: null, updatedAt: null } })],
	overrides: new Map<string, unknown>([["posts:01", { robots: "noindex" }], ["posts:posts-02", { ogImage: "https://cdn.example/legacy.jpg" }]]),
});
const legacyXml = await legacyRows.call("sitemap", { collection: "posts" });
assert.ok(!legacyXml.body.includes("posts-01"));
assert.ok(legacyXml.body.includes("https://cdn.example/legacy.jpg"));
assert.deepEqual(legacyRows.overrideCalls, ["query 1", "getMany 2", "getMany 1"], "ids of the two relevant rows, then one slug lookup");
const noLegacy = harness({ rows: [row("posts", "01")] });
await noLegacy.call("sitemap", { collection: "posts" });
assert.deepEqual(noLegacy.overrideCalls, ["query 1"]);

// Ownership, site noindex, failures and capacity.
assert.deepEqual(await harness({ owner: "site-route", rows: [row("posts", "01")] }).call("sitemap", {}), { pass: true });
const moduleOff = harness({ rows: [row("posts", "01")] });
moduleOff.store.values.set("module:sitemap", { value: false, revision: "m" });
assert.deepEqual(await moduleOff.call("sitemap", {}), { pass: true });
assert.equal((await moduleOff.call("admin-sitemap")).owner, "module-off");
const noindexSite = harness({ rows: [row("posts", "01")] });
noindexSite.store.values.set("settings:noindex", { value: true, revision: "n" });
const emptyIndex = await noindexSite.call("sitemap", {});
assert.equal(emptyIndex.status, 200);
assert.ok(!emptyIndex.body.includes("<sitemap>"));
assert.equal((await noindexSite.call("sitemap", { collection: "posts" })).status, 404);
const failing = harness({ source: { planFiles: async () => { throw new Error("database offline"); }, readRows: async () => { throw new Error("database offline"); }, readGroups: async () => [] } });
assert.equal((await failing.call("sitemap", {})).status, 503);
assert.equal((await failing.call("sitemap", { collection: "posts" })).status, 503);
assert.equal((await failing.call("admin-sitemap")).availability, "source-unavailable");
const unreadable = harness({ rows: [row("posts", "01")] });
unreadable.store.kv.getVersioned = async () => { throw new Error("options table locked"); };
const unreadableResponse = await unreadable.call("sitemap", {});
assert.equal(unreadableResponse.status, 503, "a failed settings read is a 503, not an exception");
assert.equal(unreadableResponse.cacheControl, "no-store");
const budget = harness({ source: {
	planFiles: async () => ({ rowCount: 1, cursors: [null] }),
	readRows: async () => { throw new SitemapCapacityError("too many groups", "request-budget"); },
	readGroups: async () => [],
} });
const budgetResponse = await budget.call("sitemap", { collection: "posts" });
assert.equal(budgetResponse.status, 500);
assert.match(budgetResponse.body, /database queries/);
assert.match((await budget.call("preview-admin-sitemap", { collection: "posts", after: null })).errors._form, /database queries/);

// The Sitemaps module switch exists only where Shipit serves /sitemap.xml.
const moduleValues = (items: any[]) => Object.fromEntries(items.map((item: any) => [item.key, item.enabled]));
const nativeModules = await fresh.call("admin-configuration");
const nativeSitemapItem = nativeModules.modules.items.find((item: any) => item.key === "sitemap");
assert.deepEqual([nativeSitemapItem.status, nativeSitemapItem.editable, nativeSitemapItem.capability], ["active", true, "native-sitemap"]);
const switchedOff = await fresh.call("save-admin-modules", { ...moduleValues(nativeModules.modules.items), sitemap: false, expectedRevision: nativeModules.modules.revision });
assert.equal(switchedOff.success, true);
assert.deepEqual(await fresh.call("sitemap", {}), { pass: true }, "switched off, EmDash core answers");
assert.equal((await fresh.call("save-admin-modules", { ...moduleValues(switchedOff.modules.items), sitemap: true, expectedRevision: switchedOff.modules.revision })).success, true);
const legacyNative = harness();
legacyNative.store.values.set("module:sitemap", { value: false, revision: "legacy-off" });
const nativeOn = await legacyNative.call("admin-configuration");
const nativeSaved = await legacyNative.call("save-admin-modules", { ...moduleValues(nativeOn.modules.items), sitemap: true, expectedRevision: nativeOn.modules.revision });
assert.equal(nativeSaved.success, true);
const nativeReset = await legacyNative.call("reset-admin-modules", { expectedRevision: nativeSaved.modules.revision });
assert.equal(nativeReset.success, true, "native control may reset to the inherited legacy flag");
assert.equal(nativeReset.modules.items.find((item: any) => item.key === "sitemap")?.enabled, false);
const external = harness({ owner: "site-route" });
const externalModules = await external.call("admin-configuration");
const externalSitemapItem = externalModules.modules.items.find((item: any) => item.key === "sitemap");
assert.deepEqual([externalSitemapItem.status, externalSitemapItem.editable, externalSitemapItem.capability], ["core-managed", false, undefined]);
const externalSave = await external.call("save-admin-modules", { ...moduleValues(externalModules.modules.items), sitemap: false, expectedRevision: externalModules.modules.revision });
assert.equal(externalSave.success, false, "an externally owned sitemap cannot be switched here");
assert.ok(externalSave.errors.sitemap);
assert.equal(external.store.writes, 0);
const nativeOverview = await fresh.call("admin-overview", { limit: 6 });
const externalOverview = await external.call("admin-overview", { limit: 6 });
assert.equal(nativeOverview.summary.totalModules, externalOverview.summary.totalModules + 1,
	"the overview counts the Sitemaps switch only where it exists");

// The Sitemaps flag is read strictly: invalid stored records never default.
const flagCase = async (setup: (values: Map<string, { value: unknown; revision: string }>) => void) => {
	const flagged = harness({ rows: [row("posts", "01")] });
	setup(flagged.store.values);
	return { index: await flagged.call("sitemap", {}), admin: await flagged.call("admin-sitemap") };
};
const modulesKey = "configuration:modules:v1";
const moduleRecord = (values: Record<string, unknown>, version: unknown = 1) => ({
	value: { version, updatedAt: "2026-10-01T00:00:00.000Z", values }, revision: "m1",
});
const allModules = (sitemap: unknown) => ({ seoAnalyzer: false, schema: true, sitemap, redirections: false, monitor404: false,
	analytics: false, localSeo: false, imageSeo: true, contentAi: false });
const absent = await flagCase(() => undefined);
assert.equal(absent.index.status, 200, "no stored flag uses the default");
const validOff = await flagCase((values) => values.set(modulesKey, moduleRecord(allModules(false))));
assert.deepEqual([validOff.index, validOff.admin.owner], [{ pass: true }, "module-off"]);
const validOn = await flagCase((values) => values.set(modulesKey, moduleRecord(allModules(true))));
assert.equal(validOn.index.status, 200);
for (const [label, setup] of [
	["unknown version", (values: Map<string, any>) => values.set(modulesKey, moduleRecord(allModules(true), 2))],
	["malformed values", (values: Map<string, any>) => values.set(modulesKey, moduleRecord({ ...allModules(true), sitemap: "yes" }))],
	["stored null", (values: Map<string, any>) => values.set(modulesKey, { value: null, revision: "m1" })],
	["non-boolean legacy flag", (values: Map<string, any>) => values.set("module:sitemap", { value: "false", revision: "l1" })],
] as const) {
	const invalid = await flagCase(setup);
	assert.equal(invalid.index.status, 503, `${label}: no XML under an invalid flag`);
	assert.equal(invalid.index.cacheControl, "no-store");
	assert.equal(invalid.admin.availability, "feature-controls-invalid", label);
}
const legacyOffFlag = await flagCase((values) => values.set("module:sitemap", { value: false, revision: "l1" }));
assert.deepEqual(legacyOffFlag.index, { pass: true }, "a boolean legacy flag still switches the sitemap off");

// Site URL and site-wide noindex are read strictly too.
const globalKey = "settings:global:v1";
const globalRecord = (input: Record<string, unknown> = {}, version: unknown = 1) => ({
	value: {
		version, updatedAt: "2026-10-01T00:00:00.000Z", siteName: "Example", siteUrl: "https://www.example.com",
		publisherType: "organization", organizationName: "Example", organizationLogo: "", personName: "",
		socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false,
		contentScoringEnabled: true, ...input,
	},
	revision: "g1",
});
for (const [label, setup] of [
	["malformed global record", (values: Map<string, any>) => values.set(globalKey, globalRecord({ noindex: "no" }))],
	["unknown global version", (values: Map<string, any>) => values.set(globalKey, globalRecord({}, 9))],
	["stored null global record", (values: Map<string, any>) => values.set(globalKey, { value: null, revision: "g1" })],
	["non-boolean legacy noindex", (values: Map<string, any>) => values.set("settings:noindex", { value: "false", revision: "n1" })],
	["non-string legacy site URL", (values: Map<string, any>) => values.set("settings:siteUrl", { value: 42, revision: "u1" })],
] as const) {
	const invalid = await flagCase(setup);
	assert.equal(invalid.index.status, 503, `${label}: no XML under invalid site settings`);
	assert.equal(invalid.index.cacheControl, "no-store");
	assert.equal(invalid.admin.availability, "site-settings-invalid", label);
}
const validGlobal = await flagCase((values) => values.set(globalKey, globalRecord()));
assert.ok(validGlobal.index.body.includes("<loc>https://www.example.com/sitemap-posts.xml</loc>"), "the Site identity origin is used");
assert.equal(validGlobal.admin.publicFiles.source, "site-identity");
const absentNoindex = await flagCase((values) => values.delete("settings:noindex"));
assert.equal(absentNoindex.admin.availability, "ready", "an absent preference adds no site-wide noindex");
assert.ok(absentNoindex.index.body.includes("<sitemap>"), "an absent preference lists sitemap files");
const noOrigin = harness({ rows: [row("posts", "01")] });
noOrigin.store.values.set(globalKey, globalRecord({ siteUrl: "", noindex: true }));
const noOriginIndex = await (async () => {
	const engine = createSeoEngine(UNKNOWN_INDEXNOW_INSTALLATION, { sitemap: {
		installation: { owner: "shipit", detail: null, routing: { trailingSlash: "ignore", i18n: null } },
		seoUrls: portableSitemapSeoUrls,
		openSource: async () => { throw new Error("no source is needed"); },
	} });
	return (engine as any).routes.sitemap.handler({ input: {} }, {
		plugin: { id: "shipit-seo", version: "test" }, site: { name: "Example", url: "", locale: "en" },
		schema: { listCollections: async () => COLLECTIONS }, kv: noOrigin.store.kv, storage: {},
		log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
	});
})();
assert.equal(noOriginIndex.status, 200, "site-wide noindex serves the empty index without a site URL");
assert.ok(!noOriginIndex.body.includes("<sitemap>"));

// Without a stored or EmDash site URL, the public Astro site recorded at build is the origin.
const astroOnly = harness({ rows: [row("posts", "01")], siteUrl: "", publicOrigin: "https://www.example.org" });
const astroIndex = await astroOnly.call("sitemap", {});
assert.ok(astroIndex.body.includes("<loc>https://www.example.org/sitemap-posts.xml</loc>"));
assert.equal((await astroOnly.call("admin-sitemap")).publicFiles.source, "astro-site");
const noFallback = harness({ rows: [row("posts", "01")], siteUrl: "", publicOrigin: null });
assert.equal((await noFallback.call("sitemap", {})).status, 503, "without any public origin the sitemap is unavailable");
assert.equal((await noFallback.call("admin-sitemap")).availability, "no-origin");
const missingOriginPreview = await noFallback.call("preview-admin-sitemap", { collection: "posts", after: null });
assert.equal(missingOriginPreview.success, false);
assert.equal(missingOriginPreview.errors._form, "Set the production URL in Local SEO's Website settings before previewing sitemap files.");
assert.equal(noFallback.store.writes, 0, "the missing-origin preview only directs the owner to the existing setting");
const emdashFirst = harness({ rows: [row("posts", "01")], publicOrigin: "https://www.example.org" });
assert.equal((await emdashFirst.call("admin-sitemap")).publicFiles.origin, "https://example.com", "EmDash's site URL wins over the Astro site");

// A content type noindex rule leaves its type out of the index without changing the stored choice.
{
	const ruled = harness({ rows: [row("pages", "01"), row("posts", "02"), row("posts", "03"), row("services", "04")] });
	const savedChoice = await ruled.call("save-admin-sitemap", { contentTypes: { pages: true, posts: true, services: true }, excludedPaths: [], expectedRevision: null });
	assert.equal(savedChoice.success, true);
	const storedChoice = structuredClone(ruled.store.values.get(SITEMAP_SETTINGS_KEY));
	const setRule = (contentTypeNoindex?: string[]) => ruled.store.values.set(globalKey, globalRecord({
		siteUrl: "https://example.com", indexingPreferenceConfirmed: true, ...(contentTypeNoindex === undefined ? {} : { contentTypeNoindex }),
	}));
	setRule(["posts"]);
	const admin = await ruled.call("admin-sitemap");
	assert.equal(admin.availability, "ready");
	assert.deepEqual(admin.noindexContentTypes, ["posts"]);
	assert.equal(admin.values.contentTypes.posts, true, "the stored sitemap choice is reported unchanged");
	assert.deepEqual(admin.plan.map((plan: any) => plan.collection), ["pages", "services"], "the ruled type gets no planned file");
	const ruledIndex = await ruled.call("sitemap", {});
	assert.equal(ruledIndex.status, 200);
	assert.ok(ruledIndex.body.includes("sitemap-pages.xml") && ruledIndex.body.includes("sitemap-services.xml"));
	assert.ok(!ruledIndex.body.includes("sitemap-posts.xml"), "the index lists no file for the ruled type");
	assert.equal((await ruled.call("sitemap", { collection: "posts" })).status, 404, "its child file is not served");
	const ruledPreview = await ruled.call("preview-admin-sitemap", { collection: "posts", after: null });
	assert.equal(ruledPreview.success, false);
	assert.match(ruledPreview.errors._form, /content type noindex rule in Indexing rules/);
	assert.deepEqual(ruled.store.values.get(SITEMAP_SETTINGS_KEY), storedChoice, "the rule never rewrites the sitemap record");
	setRule(["events", "pages", "posts"]);
	assert.deepEqual((await ruled.call("admin-sitemap")).noindexContentTypes, ["pages", "posts"], "only listed groups are reported");
	for (const rule of [undefined, [], ["events"]]) {
		setRule(rule);
		const restored = await ruled.call("admin-sitemap");
		assert.deepEqual(restored.noindexContentTypes, [], "no listed group is ruled");
		assert.deepEqual(restored.plan.map((plan: any) => plan.collection), ["pages", "posts", "services"]);
		const restoredIndex = await ruled.call("sitemap", {});
		assert.ok(restoredIndex.body.includes("sitemap-posts.xml"), "removing the rule lists the type again");
		assert.ok((await ruled.call("sitemap", { collection: "posts" })).body.includes("posts-02"));
	}
	setRule(["posts"]);
	const siteWide = ruled.store.values.get(globalKey) as any;
	ruled.store.values.set(globalKey, { ...siteWide, value: { ...siteWide.value, noindex: true } });
	assert.equal((await ruled.call("admin-sitemap")).availability, "site-noindex", "site-wide noindex still empties the index first");
	assert.equal(ruled.store.writes, 1, "only the explicit sitemap save wrote");
}

// Public configuration keeps choices and exclusions private.
const publicConfig = await fresh.call("public-config");
assert.deepEqual(publicConfig.sitemap, { enabled: true, url: "/sitemap.xml" });

console.log("SEO sitemap runtime self-check passed.");

// The bounded table uses saved public-file decisions, not a second sitemap policy.
const windowRows = Array.from({ length: 60 }, (_, index) => row("posts", String(index + 1).padStart(3, "0"),
	(index + 1) % 10 === 0 ? { seo: { noIndex: true, canonical: null, image: null, updatedAt: null } } : {}));
const windowOverrides = new Map<string, unknown>();
const windowed = harness({ rows: windowRows, overrides: windowOverrides });
const xmlBeforeWindows = await windowed.call("sitemap", { collection: "posts" });
const windowFirst = await windowed.call("preview-admin-sitemap", { collection: "posts", after: null });
assert.equal(windowFirst.success, true);
assert.deepEqual([windowFirst.total, windowFirst.matched, windowFirst.included, windowFirst.excluded, windowFirst.offset, windowFirst.limit], [60, 60, 54, 6, 0, 25]);
assert.equal(windowFirst.entries.length, 25);
const windowSecond = await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, cursor: windowFirst.nextCursor });
assert.equal(windowSecond.success, true);
assert.deepEqual(windowSecond.entries.map((entry: any) => entry.id), windowRows.slice(25, 50).map((entry) => entry.id));
assert.equal(windowSecond.offset, 25);
const windowBack = await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, cursor: windowSecond.previousCursor });
assert.deepEqual(windowBack.entries, windowFirst.entries);
const windowFifty = await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, limit: 50 });
assert.equal(windowFifty.entries.length, 50);
const windowExcluded = await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, status: "excluded" });
assert.deepEqual([windowExcluded.entries.length, windowExcluded.matched, windowExcluded.total], [6, 6, 60]);
assert.ok(windowExcluded.entries.every((entry: any) => entry.status === "noindex"));
const windowSearch = await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, search: " POSTS-050 ", status: "excluded" });
assert.deepEqual([windowSearch.entries.length, windowSearch.matched, windowSearch.included], [1, 1, 54]);
assert.equal(windowSearch.entries[0].id, "050");
const windowMissing = await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, search: "not-in-this-file" });
assert.deepEqual([windowMissing.total, windowMissing.matched, windowMissing.entries.length, windowMissing.nextCursor], [60, 0, 0, null]);
assert.deepEqual(await windowed.call("sitemap", { collection: "posts" }), xmlBeforeWindows, "admin filters and pages do not change the public file");
assert.ok(!windowed.calls.some((call) => call.startsWith("plan ")), "preview table pages never plan or count every collection");
assert.equal(windowed.store.writes, 0);
for (const change of [{ search: "posts" }, { status: "included" }, { limit: 50 }, { after: "005" }]) {
	const result = await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, cursor: windowFirst.nextCursor, ...change });
	assert.deepEqual([result.success, result.stale], [false, true], "a continuation belongs to one file and filter");
}
windowRows[59].slug = "changed-after-first-page";
assert.equal((await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, cursor: windowFirst.nextCursor })).stale, true,
	"a row outside the first table page still invalidates the file snapshot");
windowRows[59].slug = "posts-060";
windowOverrides.set("posts:059", { robots: "noindex" });
assert.equal((await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, cursor: windowFirst.nextCursor })).stale, true,
	"legacy override changes invalidate the same file decision snapshot");
windowOverrides.clear();
windowed.store.values.set(SITEMAP_SETTINGS_KEY, { value: { version: 1, updatedAt: "2026-10-01T00:00:00.000Z", values: { contentTypes: { posts: true, pages: true }, excludedPaths: [] } }, revision: "window-revision" });
assert.equal((await windowed.call("preview-admin-sitemap", { collection: "posts", after: null, cursor: windowFirst.nextCursor })).stale, true,
	"saving equivalent settings still fences earlier revision cursors");
assert.equal(windowed.store.writes, 0, "all window requests remain read-only");
