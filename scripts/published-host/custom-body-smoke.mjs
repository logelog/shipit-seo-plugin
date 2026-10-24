// Custom saved-body checks through the published native route dispatcher and a
// migrated, disposable SQLite database. This covers saved inputs, not a browser
// render, a running HTTP server or another storage adapter.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";
import { setFixtureContentAnalysis } from "./fixture-content-analysis.mjs";

assert.equal(target.name, "native-1.3.1", "custom body smoke requires the current published native host");
assert.equal(target.versions.get("emdash"), "1.3.1");
assert.equal(process.versions.node, "24.19.0");

const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => {
	networkAttempts += 1;
	throw new Error("Networking is disabled in the custom body smoke");
};

const host = hostPackageRoot("emdash");
const dist = new URL("dist/", host);
const publishedFiles = readdirSync(dist).filter((file) => file.endsWith(".mjs")).sort()
	.map((file) => ({ url: new URL(file, dist), text: readFileSync(new URL(file, dist), "utf8") }));
async function hostDistExport(name) {
	for (const file of publishedFiles) {
		const alias = file.text.match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(file.url.href))[alias];
	}
	throw new Error(`Published ${name} was not found in the selected host`);
}
const hostIndex = readFileSync(new URL("index.mjs", dist), "utf8");
const contextImport = hostIndex.match(/import\s*\{[^}]*PluginStorageRepository[^}]*\}\s*from\s*"(\.\/context-[^"]+\.mjs)"/);
assert.ok(contextImport, "published context module is present");
const contextUrl = new URL(contextImport[1], dist);
const contextSource = readFileSync(contextUrl, "utf8");
const contextAlias = contextSource.match(/\bPluginContextFactory as ([A-Za-z_$][\w$]*)/)?.[1];
assert.ok(contextAlias, "published context factory is exported");
const PluginContextFactory = (await import(contextUrl.href))[contextAlias];
const { Kysely } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const SchemaRegistry = await hostDistExport("SchemaRegistry");
const ContentRepository = await hostDistExport("ContentRepository");
const SeoRepository = await hostDistExport("SeoRepository");
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const handleContentGet = await hostDistExport("handleContentGet");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createPlugin } = await source("native-entry.ts");
const { SEO_SCORE_VERSION, seoScoreDisplay } = await source("analysis.ts");
const { parseSeoAdminEntryPreviewResult } = await source("admin-ui/contract.ts");
const { resolveEditorBasicAnalysis } = await source("admin-ui/editor-basic-analysis.ts");
const { createSavedContentSnapshot } = await source("admin-ui/saved-content-snapshot.ts");
const { readContentScoringPolicy } = await source("settings-runtime.ts");
const { countSeoWords } = await source("document-signals.ts");

const SITE = "https://example.com";
const report = {
	target: target.name, emdash: target.versions.get("emdash"), analyzer: SEO_SCORE_VERSION,
	storage: "migrated SQLite :memory:", checks: [], queries: {},
	limits: ["Saved-input native dispatcher and local analyzer only; no browser or rendered HTML proof.", "No D1, Postgres, provider delivery or installed-package proof."],
};
const checked = (name) => report.checks.push(name);
const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
	},
});
const write = ({ sql }) => /^\s*(?:insert|update|delete|replace|create|alter|drop)\b/i.test(sql);
async function counted(name, action, entryId) {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	const contentReads = run.filter(({ sql }) => /^\s*select\b/i.test(sql) && /\b(?:from|join)\s+"ec_posts"/i.test(sql));
	assert.equal(run.filter(write).length, 0, `${name}: opening and local analysis attempt no database mutations`);
	if (entryId !== undefined) {
		assert.ok(contentReads.length > 0, `${name}: the published host actually reads the saved entry`);
		assert.ok(contentReads.every(({ sql, parameters }) => /\bwhere\b/i.test(sql) && parameters.includes(entryId)),
			`${name}: every content read is scoped to the requested entry, not an inventory scan`);
	}
	if (entryId === undefined) assert.equal(run.length, 0, `${name}: local checks and denied requests perform no queries`);
	assert.ok(run.length <= 128, `${name}: one entry has a bounded query count`);
	report.queries[name] = { statements: run.length, mutations: 0, contentReads: contentReads.length };
	return value;
}
const span = (text) => ({ _type: "span", text, marks: [] });
const block = (text, style = "normal") => ({ _type: "block", style, children: [span(text)], markDefs: [] });
const prose = Array.from({ length: 36 }, (_, index) => block(
	`Sourdough bread is prepared with fresh flour and a patient daily routine. Each loaf rests before baking and is shared with neighbours at the table ${index + 1}.`,
));
const mapping = {
	mappings: [{ collection: "posts", bodyField: "content", blocks: [{ type: "article_section", version: 1, fields: [
		{ kind: "heading", path: ["heading"], level: 1 },
		{ kind: "richText", path: ["body"] },
		{ kind: "link", path: ["link_label"], href: ["link_url"] },
	] }] }],
};

try {
	await runMigrations(db);
	const plugin = createPlugin({
		siteUrl: SITE,
		installation: { siteOrigin: SITE, siteIssue: null, keyRoute: "unavailable", contentAnalysis: mapping },
	});
	await syncDeclaredStorageIndexes(db, [{ id: plugin.id, storage: plugin.storage }]);
	const schema = new SchemaRegistry(db);
	await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] });
	for (const [slug, type] of [["title", "string"], ["excerpt", "string"], ["content", "portableText"]])
		await schema.createField("posts", { slug, label: slug, type });
	const content = new ContentRepository(db);
	const coreSeo = new SeoRepository(db);
	const create = (slug, version) => content.create({
		type: "posts", slug, status: "published", locale: "en",
		data: {
			title: "Sourdough bread for the neighbourhood table",
			excerpt: "A practical guide to preparing sourdough bread, from a patient daily routine to sharing a fresh loaf at the neighbourhood table.",
			content: [{ _type: "article_section", _version: version,
				heading: "Sourdough bread for the neighbourhood table", body: prose,
				link_label: "Read the baking guide", link_url: "/guides/baking",
				private_note: "THIS_CONFIGURATION_LABEL_MUST_NOT_BE_BODY_PROSE", theme: "blue", enabled: true,
			}],
		},
	});
	const entry = await create("sourdough-bread", 1);
	const unknown = await create("unmapped-version", 2);
	await coreSeo.upsert("posts", entry.id, { title: entry.data.title, description: entry.data.excerpt, noIndex: false });
	await coreSeo.upsert("posts", unknown.id, { title: unknown.data.title, description: unknown.data.excerpt, noIndex: false });
	const routeOptions = {
		db, siteInfo: { siteUrl: SITE, siteName: "Neighbourhood Bakery", locale: "en" },
		cronReschedule() { throw new Error("Opening one entry must not schedule work"); },
	};
	const registry = new PluginRouteRegistry(routeOptions);
	registry.register(plugin);
	const runtime = {
		getPluginRouteMeta(pluginId, path) {
			const route = pluginId === plugin.id ? plugin.routes[path.replace(/^\//, "")] : undefined;
			return route ? buildRouteMeta(route) : null;
		},
		async handlePluginApiRoute(pluginId, method, path, request, caller) {
			const meta = this.getPluginRouteMeta(pluginId, path);
			const body = await parseRouteInput(request, meta?.request);
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
		},
	};
	const admin = { id: "fixture-admin", email: "admin@example.com", name: "Fixture Admin", role: 50 };
	async function call(route, body, { user = admin, csrf = true } = {}) {
		assert.ok(["admin-entry-preview", "admin-settings", "save-content-scoring"].includes(route));
		const request = new Request(`${SITE}/_emdash/api/plugins/${plugin.id}/${route}`, {
			method: "POST", headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) },
			body: JSON.stringify(body),
		});
		const response = await dispatchPluginApiRequest({ runtime, pluginId: plugin.id, path: `/${route}`, request, user });
		const envelope = JSON.parse(await response.text());
		return { status: response.status, data: envelope.data, error: envelope.error, cacheControl: response.headers.get("Cache-Control") };
	}
	const ctx = new PluginContextFactory(routeOptions).createContext({
		id: plugin.id, version: plugin.version, capabilities: plugin.capabilities,
		admin: plugin.admin ?? {}, storage: plugin.storage, allowedHosts: [],
	});
	await setFixtureContentAnalysis(call, false);
	const policyBefore = await readContentScoringPolicy(ctx);
	assert.equal(policyBefore.state, "paused", "optional server analysis is explicitly off before opening");
	assert.equal((await call("admin-settings", {})).data.values.contentScoringEnabled, false);

	async function snapshotOf(item) {
		const result = await handleContentGet(db, "posts", item.id, "en");
		assert.equal(result.success, true, JSON.stringify(result.error));
		return createSavedContentSnapshot(`posts:${item.id}`, JSON.parse(JSON.stringify(result.data.item)));
	}
	async function open(item, snapshot) {
		const result = await call("admin-entry-preview", { ref: `posts:${item.id}`, entryOnly: true, snapshot });
		assert.equal(result.status, 200, JSON.stringify(result.error));
		assert.equal(result.cacheControl, "private, no-store");
		const parsed = parseSeoAdminEntryPreviewResult(result.data);
		assert.equal(parsed.success, true);
		return parsed.preview;
	}
	const basic = (snapshot, preview, overrides = {}) => resolveEditorBasicAnalysis({
		ref: snapshot.ref, snapshot, preview, sourceVersion: snapshot.sourceVersion, locale: "en",
		profile: null, profileReady: true, keywords: ["sourdough bread"],
		assessment: { state: "unconfigured", collection: "posts", revision: null }, assessmentReady: true,
		publicationStatus: "published", ...overrides,
	});
	const snapshot = await snapshotOf(entry);
	const preview = await counted("mappedEntryOpen", () => open(entry, snapshot), entry.id);
	assert.equal(preview.ownership.status, "current");
	assert.equal(preview.sourceKind, "saved-snapshot");
	assert.equal(preview.sourceVersion, snapshot.sourceVersion);
	assert.deepEqual(preview.bodyAnalysis.mapping, mapping.mappings[0]);
	const analysis = await counted("localMappedAnalysis", () => basic(snapshot, preview));
	assert.equal(analysis.state, "ready");
	assert.equal(analysis.result.scoreVersion, SEO_SCORE_VERSION);
	assert.ok(analysis.result.metrics.wordCount > 600, "the mapped saved body is actually read");
	assert.equal(analysis.result.metrics.internalLinkCount, 1);
	assert.equal(analysis.result.metrics.h1Count, 1);
	const expectedVisible = [entry.data.content[0].heading, ...prose.map((paragraph) => paragraph.children[0].text), entry.data.content[0].link_label].join(" ");
	assert.equal(analysis.result.metrics.wordCount, countSeoWords(expectedVisible), "only the declared visible prose and link label enter the count");
	assert.notEqual(seoScoreDisplay(analysis.result).score, null, "a fully declared custom body gets a local numeric badge with server analysis off");
	checked("native factory preserves a configured mapping through the real saved preview and local analysis");
	checked("opening one entry performs bounded scoped reads and no writes; local scoring performs no queries");

	for (const [name, overrides] of [
		["changed-source", { sourceVersion: snapshot.sourceVersion + "changed" }],
		["other-entry", { ref: `posts:${unknown.id}` }],
		["other-locale", { locale: "fr" }],
	]) assert.equal((await counted(name, () => basic(snapshot, preview, overrides))).state, "unavailable", name);
	checked("source, entry and locale guards still reject mismatched saved inputs");

	for (const [name, options, status] of [["anonymous", { user: null }, 401], ["missing-csrf", { csrf: false }, 403]]) {
		const result = await counted(name, () => call("admin-entry-preview", { ref: snapshot.ref, entryOnly: true, snapshot }, options));
		assert.equal(result.status, status);
	}
	checked("the published dispatcher retains authentication and CSRF checks");

	const unknownSnapshot = await snapshotOf(unknown);
	const unknownPreview = await counted("unmappedVersionOpen", () => open(unknown, unknownSnapshot), unknown.id);
	const unknownAnalysis = await counted("unmappedVersionAnalysis", () => basic(unknownSnapshot, unknownPreview));
	assert.equal(unknownAnalysis.state, "ready");
	assert.equal(seoScoreDisplay(unknownAnalysis.result).score, null);
	assert.equal(unknownAnalysis.result.checks.find((check) => check.id === "content-depth")?.basis, "unavailable");
	checked("a saved custom block with an unknown version stays partial");

	await coreSeo.upsert("posts", entry.id, { title: entry.data.title, description: "A changed saved description.", noIndex: false });
	const stalePreview = await counted("staleSavedPreview", () => open(entry, snapshot), entry.id);
	assert.equal(stalePreview.ownership.status, "stale");
	assert.equal((await counted("staleSavedAnalysis", () => basic(snapshot, stalePreview))).state, "unavailable");
	checked("a native SEO revision change prevents an old snapshot from claiming a current score");
	assert.deepEqual(await readContentScoringPolicy(ctx), policyBefore, "opening and local checks do not activate optional server analysis");
	assert.equal(networkAttempts, 0, "no provider or other fetch was attempted");
	report.networkAttempts = networkAttempts;
	console.log(JSON.stringify(report));
	console.log("Custom body native saved-input smoke passed.");
} finally {
	await db.destroy();
	globalThis.fetch = originalFetch;
}
