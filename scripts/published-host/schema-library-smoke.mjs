// Native schema library proof on a migrated EmDash SQLite database from the
// selected published host. Routes run behind the published HTTP dispatcher,
// which checks the user, the CSRF header and the declared body limit before a
// handler runs. The library lives in the published plugin KV, entry schemas in
// the plugin's storage collection, and page output comes from the plugin's
// page:metadata hook with a host-created plugin context (not rendered HTML).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Schema library smoke skipped on ${target.name}; this check requires a released native target.`);
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
const hostIndex = readFileSync(new URL("dist/index.mjs", host), "utf8");
const contextUrl = new URL(hostIndex.match(/import\s*\{[^}]*PluginStorageRepository[^}]*\}\s*from\s*"(\.\/context-[^"]+\.mjs)"/)[1], new URL("dist/", host));
const contextSource = readFileSync(contextUrl, "utf8");
const contextModule = await import(contextUrl.href);
const PluginContextFactory = contextModule[contextSource.match(/\bPluginContextFactory as ([A-Za-z_$][\w$]*)/)[1]];
const { Kysely } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const SchemaRegistry = await hostDistExport("SchemaRegistry");
const ContentRepository = await hostDistExport("ContentRepository");
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createSqliteSeoFixture } = await import("./sqlite-plugin-fixture.mjs");
const { SCHEMA_LIBRARY_KEY } = await source("schema-library.ts");

const SITE = "https://example.com";
const LIBRARY_ROW = `plugin:shipit-seo:${SCHEMA_LIBRARY_KEY}`;
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], queries: {} };
const check = (name) => report.checks.push(name);

// Counts statements, and can drop the response of one committed library write:
// the UPDATE or INSERT runs and autocommits, then the caller sees an error.
const statements = [];
let loseNextLibraryWrite = false;
const lostQueries = new Set();
const responseLoss = {
	transformQuery({ node, queryId }) {
		if (loseNextLibraryWrite && (node.kind === "UpdateQueryNode" || node.kind === "InsertQueryNode") && JSON.stringify(node).includes(LIBRARY_ROW)) {
			loseNextLibraryWrite = false;
			lostQueries.add(queryId);
		}
		return node;
	},
	async transformResult({ queryId, result }) {
		if (lostQueries.delete(queryId)) throw new Error("connection reset after commit");
		return result;
	},
};
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	plugins: [responseLoss],
	// SQL with its bound parameters; the in-memory fixture holds only synthetic data.
	log(event) {
		if (event.level === "query") statements.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
	},
});
const counted = async (action) => {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	return { value, queries: run.length, writes: run.filter(({ sql }) => /^\s*(insert|update|delete|replace)\b/i.test(sql)).length, run };
};
// Reads of the library's options row: the key is a bound parameter, not SQL text.
const libraryReads = (run) => run.filter(({ sql, parameters }) => /^\s*select\b/i.test(sql) && /"options"/.test(sql) && parameters.includes(LIBRARY_ROW)).length;
const libraryRow = async () => (await db.selectFrom("options").select(["value", "revision"]).where("name", "=", LIBRARY_ROW).executeTakeFirst()) ?? null;
const optionCount = async () => Number((await db.selectFrom("options").select(db.fn.countAll().as("count")).executeTakeFirst()).count);

try {
	await runMigrations(db);
	const seo = createSqliteSeoFixture(db);
	await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
	const schema = new SchemaRegistry(db);
	await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" });
	for (const slug of ["title", "excerpt", "notes"]) await schema.createField("posts", { slug, label: slug, type: "string" });
	await schema.createCollection({ slug: "pages", label: "Pages", hasSeo: true, routable: true, urlPattern: "/{slug}" });
	await schema.createField("pages", { slug: "title", label: "Title", type: "string" });
	const content = new ContentRepository(db);
	// The title holds a supported placeholder as literal text.
	const post = await content.create({ type: "posts", slug: "launch-notes", data: { title: "Launch {{description}} notes", excerpt: "Fresh bread daily" }, status: "published", locale: "en" });
	const french = await content.create({ type: "posts", slug: "launch-notes", data: { title: "Notes de lancement", excerpt: "Pain frais" }, status: "published", locale: "fr", translationOf: post.id });
	const wide = await content.create({ type: "posts", slug: "wide-notes", data: { title: "Wide", excerpt: "w".repeat(20_000) }, status: "published", locale: "en" });
	const huge = await content.create({ type: "posts", slug: "huge-notes", data: { title: "Huge", notes: "h".repeat(40_000) }, status: "published", locale: "en" });
	const draft = await content.create({ type: "pages", slug: "draft-page", data: { title: "Draft page" }, status: "draft", locale: "en" });

	const routeOptions = { db, siteInfo: { siteUrl: SITE, siteName: "Harbour Bakery", url: SITE, name: "Harbour Bakery" }, cronReschedule() {} };
	const registry = new PluginRouteRegistry(routeOptions);
	registry.register(seo);
	const runtime = {
		getPluginRouteMeta(pluginId, path) {
			const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
			return route ? buildRouteMeta(route) : null;
		},
		async handlePluginApiRoute(pluginId, method, path, request, caller) {
			const meta = this.getPluginRouteMeta(pluginId, path);
			let body;
			try {
				body = await parseRouteInput(request, meta?.request);
			} catch (error) {
				if (typeof error?.status === "number") return { success: false, status: error.status, error: { code: "INVALID_PLUGIN_REQUEST", message: error.message } };
				throw error;
			}
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
		},
	};
	const people = {
		editor: { id: "editor", email: "editor@example.com", name: "Editor", role: 40 },
		admin: { id: "admin", email: "admin@example.com", name: "Admin", role: 50 },
	};
	async function call(route, body, { user = people.admin, csrf = true, raw } = {}) {
		const init = body === undefined && raw === undefined
			? { method: "GET", headers: csrf ? { "X-EmDash-Request": "1" } : {} }
			: { method: "POST", headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) }, body: raw ?? JSON.stringify(body) };
		const request = new Request(`${SITE}/_emdash/api/plugins/shipit-seo/${route}`, init);
		const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: user ?? undefined });
		const text = await response.text();
		const payload = JSON.parse(text);
		return { status: response.status, data: payload?.data, error: payload?.error, bytes: new TextEncoder().encode(text).byteLength };
	}
	const pluginCtx = new PluginContextFactory(routeOptions).createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
	const pageFor = (entry, path) => ({
		url: `${SITE}${path}`, path, locale: entry.locale, kind: "content", pageType: "article",
		title: entry.slug, pageTitle: entry.data.title, description: "", canonical: `${SITE}${path}`, image: null,
		content: { collection: entry.type ?? "posts", id: entry.id, slug: entry.slug }, seo: {}, siteName: "Harbour Bakery", siteUrl: SITE,
	});
	const render = async (entry, path) => (await seo.hooks["page:metadata"].handler({ page: pageFor(entry, path) }, pluginCtx)) ?? [];
	const customGraphs = async (entry, path) => (await render(entry, path)).filter((item) => item.kind === "jsonld" && String(item.id).startsWith("custom:"));
	const article = (headline, extra = {}) => JSON.stringify({ "@context": "https://schema.org", "@type": "Article", "@id": "{{siteUrl}}/#library-article", headline, description: "{{description}}", ...extra });
	const tid = (seed) => `tpl-${seed.padEnd(20, "0").slice(0, 20)}`;
	const eid = (seed) => `entry-${seed.padEnd(20, "0").slice(0, 20)}`;
	const ref = { collection: "posts", entryId: post.id, locale: "en" };
	let requests = 0;
	const preview = (input, options) => call("preview-entry-schema-candidate", { requestId: `smoke-${String(++requests).padStart(4, "0")}`, ...ref, name: "Library article", enabled: true, ...input }, options);

	// ---- Permissions, CSRF and declared bodies ----
	const routes = {
		"schema-library": undefined,
		"save-schema-library-template": { mode: "create", expectedRevision: null, id: tid("denied"), name: "x", json: article("x") },
		"delete-schema-library-template": { expectedRevision: "r", id: tid("denied") },
		"preview-entry-schema-candidate": { requestId: "denied-0001", ...ref, id: eid("denied"), expectedRevision: null, name: "x", json: article("x"), enabled: true },
	};
	for (const [route, body] of Object.entries(routes)) {
		assert.equal((await call(route, body, { user: null })).status, 401, `${route} refuses anonymous callers`);
		assert.equal((await call(route, body, { user: people.editor })).status, 403, `${route} refuses an Editor`);
		assert.equal((await call(route, body, { csrf: false })).status, 403, `${route} requires the CSRF header`);
	}
	assert.equal(await libraryRow(), null, "refused requests wrote nothing");
	const pluginTypes = createRequire(new URL("package.json", hostPackageRoot("emdash"))).resolve("@emdash-cms/plugin-types");
	const { extractManifestRoute } = await import(pathToFileURL(pluginTypes).href);
	for (const route of Object.keys(routes)) {
		assert.equal(JSON.parse(JSON.stringify(extractManifestRoute(route, seo.routes[route]))).permission, "plugins:manage", route);
	}
	const oversizedSave = await call("save-schema-library-template", undefined, { raw: JSON.stringify({ mode: "create", expectedRevision: null, id: tid("big"), name: "x", json: "x".repeat(600_000) }) });
	assert.equal(oversizedSave.status, 413, "the declared template body limit is enforced before parsing");
	const oversizedPreview = await call("preview-entry-schema-candidate", undefined, { raw: JSON.stringify({ requestId: "big-request", ...ref, id: eid("big"), expectedRevision: null, name: "x", json: "{}", enabled: true, snapshot: { ref: `posts:${post.id}`, data: { notes: "n".repeat(1_100_000) }, slug: "launch-notes", sourceVersion: "v" } }) });
	assert.equal(oversizedPreview.status, 413, "and the 1 MiB preview body limit");
	check("permissions, CSRF and declared body limits");

	// ---- Library: absent read, create, reload, edit ----
	const optionsBefore = await optionCount();
	const emptyRead = await counted(() => call("schema-library"));
	assert.equal(emptyRead.value.status, 200);
	assert.equal(emptyRead.value.data.state, "absent");
	assert.equal(emptyRead.writes, 0);
	assert.equal(await optionCount(), optionsBefore, "reading creates no row");
	report.queries.libraryReadAbsent = { queries: emptyRead.queries, writes: emptyRead.writes };

	const created = await counted(() => call("save-schema-library-template", { mode: "create", expectedRevision: null, id: tid("article"), name: "Library article", json: article("{{title}}") }));
	assert.equal(created.value.data.success, true, JSON.stringify(created.value.data));
	assert.equal(created.writes, 1);
	report.queries.libraryCreate = { queries: created.queries, writes: created.writes };
	const stored = await libraryRow();
	assert.equal(stored.revision, created.value.data.library.revision);
	assert.deepEqual(Object.keys(JSON.parse(stored.value)), ["version", "templates"], "no scope or enabled flag");
	const reloaded = await counted(() => call("schema-library"));
	assert.equal(reloaded.value.data.state, "saved");
	assert.equal(reloaded.value.data.templates[0].json, article("{{title}}"), "stored unresolved");
	assert.equal(reloaded.value.data.bytes, new TextEncoder().encode(stored.value).byteLength);
	report.queries.libraryRead = { queries: reloaded.queries, writes: reloaded.writes };
	const second = await call("save-schema-library-template", { mode: "create", expectedRevision: reloaded.value.data.revision, id: tid("faq"), name: "FAQ page", json: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", name: "{{title}}" }) });
	assert.equal(second.data.success, true);
	const stale = await call("save-schema-library-template", { mode: "update", expectedRevision: reloaded.value.data.revision, id: tid("article"), name: "Library article", json: article("Stale") });
	assert.equal(stale.data.error, "conflict");
	assert.equal((await libraryRow()).revision, second.data.library.revision, "a stale revision changes nothing");
	for (const [label, body] of [
		["invalid JSON", { name: "Bad", json: "{nope" }],
		["unknown variable", { name: "Bad", json: article("{{price}}") }],
		["oversized template", { name: "Bad", json: article("x".repeat(33_000)) }],
		["duplicate name", { name: "faq page", json: article("x") }],
	]) {
		const refused = await call("save-schema-library-template", { mode: "create", expectedRevision: second.data.library.revision, id: tid("bad"), ...body });
		assert.equal(refused.data.error, "invalid_values", label);
	}
	assert.equal((await libraryRow()).revision, second.data.library.revision, "refused values change nothing");
	check("library absent, create, reload, stale revision and invalid values");

	// ---- Lost response after a committed write: no retry, an authoritative read decides ----
	loseNextLibraryWrite = true;
	const lost = await counted(() => call("save-schema-library-template", { mode: "update", expectedRevision: second.data.library.revision, id: tid("faq"), name: "FAQ page", json: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", name: "Committed {{title}}" }) }));
	assert.equal(lost.value.data.success, false);
	assert.equal(lost.value.data.error, "unconfirmed", "the caller cannot know the outcome");
	assert.equal(lost.writes, 1, "one write, no retry and no rollback");
	const afterLoss = await call("schema-library");
	assert.equal(afterLoss.data.templates.find((item) => item.id === tid("faq")).json.includes("Committed"), true, "the read shows the committed template");
	assert.notEqual(afterLoss.data.revision, second.data.library.revision);
	check("uncertain write committed, reported unconfirmed, settled by a read");

	// ---- Corrupt and unreadable rows are reported and never overwritten ----
	const healthy = await libraryRow();
	await db.updateTable("options").set({ value: JSON.stringify({ version: 9, templates: [] }), revision: "corrupt-revision" }).where("name", "=", LIBRARY_ROW).execute();
	const corrupt = await call("schema-library");
	assert.deepEqual([corrupt.data.state, corrupt.data.corrupt.reason, corrupt.data.revision], ["corrupt", "unsupported-version", "corrupt-revision"]);
	assert.equal((await call("save-schema-library-template", { mode: "create", expectedRevision: "corrupt-revision", id: tid("w"), name: "W", json: article("w") })).data.error, "corrupt");
	assert.equal((await call("delete-schema-library-template", { expectedRevision: "corrupt-revision", id: tid("faq") })).data.error, "corrupt");
	assert.equal((await libraryRow()).revision, "corrupt-revision", "a corrupt library is kept");
	await db.updateTable("options").set({ value: "{not json", revision: "broken-revision" }).where("name", "=", LIBRARY_ROW).execute();
	const unreadable = await call("schema-library");
	assert.equal(unreadable.data.state, "unavailable");
	assert.equal((await call("save-schema-library-template", { mode: "create", expectedRevision: null, id: tid("w"), name: "W", json: article("w") })).data.error, "unavailable");
	assert.equal((await libraryRow()).value, "{not json");
	await db.updateTable("options").set({ value: healthy.value, revision: healthy.revision }).where("name", "=", LIBRARY_ROW).execute();
	check("corrupt and unreadable library rows");

	// ---- Copy into one exact entry: predict, save, compare with public output ----
	const library = await call("schema-library");
	const template = library.data.templates.find((item) => item.id === tid("article"));
	const publicBefore = await counted(() => render(post, "/posts/launch-notes"));
	const knownRead = await counted(() => call("schema-library"));
	assert.equal(libraryReads(knownRead.run), 1, "control: a library read is counted by its bound key");
	assert.equal(libraryReads(publicBefore.run), 0, "public output never reads the library");
	assert.deepEqual(publicBefore.value.filter((item) => String(item.id).startsWith("custom:")), [], "a template alone changes no page");
	const added = await counted(() => preview({ id: eid("copy"), expectedRevision: null, json: template.json }));
	assert.equal(added.value.status, 200);
	assert.equal(added.value.data.success, true, JSON.stringify(added.value.data));
	assert.equal(added.writes, 0, "a preview writes nothing");
	assert.equal(added.run.some(({ sql }) => /from "ec_posts"/.test(sql) && !/where/i.test(sql)), false, "no content enumeration");
	assert.equal(libraryReads(added.run), 0, "the candidate preview does not read the library");
	report.queries.publicRenderLibraryReads = libraryReads(publicBefore.run);
	assert.ok(added.value.bytes <= 524_288, "the whole HTTP body is within the response cap");
	report.queries.candidatePreview = { queries: added.queries, writes: added.writes, responseBytes: added.value.bytes };
	const existingPreview = await counted(() => call("entry-schema-preview", { ref: `posts:${post.id}`, entryOnly: true }));
	assert.equal(existingPreview.value.data.success, true);
	report.queries.existingEntryPreview = { queries: existingPreview.queries, writes: existingPreview.writes };
	report.queries.publicRender = { queries: publicBefore.queries, writes: publicBefore.writes };
	const predicted = added.value.data.items.find((item) => item.id === `custom:${eid("copy")}`);
	assert.equal(predicted.emitted, true);
	assert.equal(predicted.graph.headline.startsWith("Launch {{description}} notes"), true, "the title's placeholder text stays literal");
	assert.equal(predicted.graph.description, "Fresh bread daily");
	assert.equal(predicted.graph["@id"], `${SITE}/#library-article`);
	assert.equal(added.value.data.canonicalSource, "page");

	const saved = await counted(() => call("save-entry-custom-schema", { ...ref, id: eid("copy"), expectedRevision: null, name: "Library article", json: template.json, enabled: true }));
	assert.equal(saved.value.data.success, true);
	report.queries.entrySave = { queries: saved.queries, writes: saved.writes };
	const published = await customGraphs(post, "/posts/launch-notes");
	assert.deepEqual(published.map((item) => item.id), [`custom:${eid("copy")}`]);
	assert.deepEqual(JSON.parse(JSON.stringify(published[0].graph)), JSON.parse(JSON.stringify(predicted.graph)), "the prediction equals the public contribution after the save");
	const allPublic = (await render(post, "/posts/launch-notes")).filter((item) => item.kind === "jsonld");
	const definitions = allPublic.flatMap((item) => [item.graph].flat()).map((node) => node?.["@id"]).filter(Boolean);
	assert.equal(new Set(definitions).size, definitions.length, "no entity is defined twice in the page's Shipit JSON-LD");
	assert.deepEqual(await customGraphs(french, "/fr/posts/launch-notes"), [], "the French row is unchanged");
	assert.deepEqual(await customGraphs(wide, "/posts/wide-notes"), [], "and so is another entry");
	check("candidate prediction equals public contribution after the explicit save");

	// A published host route predicts {{canonical}}; an entry-owned URL takes precedence.
	const usesCanonical = JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", "@id": "{{canonical}}#canonical-page", name: "{{title}}" });
	const registeredCanonical = await counted(() => preview({ id: eid("routecanon"), expectedRevision: null, json: usesCanonical }));
	assert.equal(registeredCanonical.value.status, 200);
	assert.equal(registeredCanonical.value.data.success, true, JSON.stringify(registeredCanonical.value.data));
	assert.equal(registeredCanonical.value.data.canonicalSource, "page");
	const registeredCanonicalGraph = registeredCanonical.value.data.items.find((item) => item.id === `custom:${eid("routecanon")}`).graph;
	assert.equal(registeredCanonicalGraph["@id"], `${SITE}/posts/launch-notes#canonical-page`);
	assert.equal(registeredCanonical.writes, 0, "the registered-route prediction writes nothing");
	assert.equal(await pluginCtx.storage.schemas.getVersioned(eid("routecanon")), null, "the route-derived candidate remains unsaved");
	report.queries.registeredCanonicalPreview = { queries: registeredCanonical.queries, writes: registeredCanonical.writes, responseBytes: registeredCanonical.value.bytes };
	await db.insertInto("_emdash_seo").values({ collection: "posts", content_id: post.id, seo_canonical: `${SITE}/stories/launch`, seo_no_index: 0 }).execute();
	const canonicalPreview = await preview({ id: eid("canon"), expectedRevision: null, json: usesCanonical });
	assert.equal(canonicalPreview.data.success, true, JSON.stringify(canonicalPreview.data));
	assert.equal(canonicalPreview.data.canonicalSource, "entry");
	const canonicalGraph = canonicalPreview.data.items.find((item) => item.id === `custom:${eid("canon")}`).graph;
	assert.equal(canonicalGraph["@id"], `${SITE}/stories/launch#canonical-page`);
	assert.notEqual(canonicalGraph["@id"], registeredCanonicalGraph["@id"], "the explicit entry canonical wins over the registered route");
	assert.equal((await call("save-entry-custom-schema", { ...ref, id: eid("canon"), expectedRevision: null, name: "Canonical page", json: usesCanonical, enabled: true })).data.success, true);
	const canonicalPublic = (await customGraphs(post, "/posts/launch-notes")).find((item) => item.id === `custom:${eid("canon")}`);
	assert.deepEqual(JSON.parse(JSON.stringify(canonicalPublic.graph)), JSON.parse(JSON.stringify(canonicalGraph)), "an entry-owned canonical is predicted exactly");
	const canonicalRow = await pluginCtx.storage.schemas.getVersioned(eid("canon"));
	assert.equal((await call("remove-entry-custom-schema", { ...ref, id: eid("canon"), expectedRevision: canonicalRow.revision })).data.success, true);
	await db.deleteFrom("_emdash_seo").where("collection", "=", "posts").where("content_id", "=", post.id).execute();
	check("canonical: unsaved registered-route prediction and explicit entry precedence");

	// Editing the saved copy replaces it in place in the prediction.
	const edit = await preview({ id: eid("copy"), expectedRevision: saved.value.data.schema.revision, json: article("Edited {{title}}") });
	assert.equal(edit.data.success, true);
	assert.equal(edit.data.items.filter((item) => item.id === `custom:${eid("copy")}`).length, 1, "no duplicate next to the stored original");
	assert.equal((await preview({ id: eid("copy"), expectedRevision: "stale", json: article("x") })).data.error, "conflict");
	assert.equal((await preview({ id: eid("twin"), expectedRevision: null, json: template.json })).data.saveCheck.reason, "identity", "a second copy reports the entity the first defines");
	assert.equal((await preview({ entryId: french.id, locale: "en", id: eid("fr"), expectedRevision: null, json: template.json })).data.error, "entry_mismatch");
	const frenchPreview = await preview({ entryId: french.id, locale: "fr", id: eid("fr"), expectedRevision: null, json: template.json });
	assert.deepEqual(frenchPreview.data.items.filter((item) => item.source === "custom").map((item) => item.id), [`custom:${eid("fr")}`], "the French row predicts only its own record");
	const draftPreview = await preview({ collection: "pages", entryId: draft.id, id: eid("draft"), expectedRevision: null, json: template.json });
	assert.equal(draftPreview.data.success, true);
	assert.equal(draftPreview.data.entry.status, "draft", "an unpublished entry is predicted with its status");
	const snapshot = { ref: `posts:${post.id}`, data: { title: "Saved title", excerpt: "Saved excerpt" }, slug: "launch-notes", sourceVersion: "v-saved" };
	const fromSnapshot = await preview({ id: eid("snap"), expectedRevision: null, json: article("{{title}}", { "@id": "{{siteUrl}}/#snap" }), snapshot });
	assert.deepEqual(fromSnapshot.data.content, { sourceKind: "saved-snapshot", sourceVersion: "v-saved" });
	assert.equal((await preview({ id: eid("snap"), expectedRevision: null, json: article("x"), snapshot: { ...snapshot, ref: `posts:${french.id}` } })).data.error, "snapshot_mismatch");
	check("edit in place, stale revision, identity check, locale isolation, unpublished entry, snapshot checks");

	// Bounds: refused, never truncated; public output keeps its own rules.
	const expanded = await preview({ entryId: wide.id, id: eid("wide"), expectedRevision: null, json: article("x", { text: "{{description}}".repeat(8) }) });
	assert.equal(expanded.data.error, "expansion_too_large");
	assert.equal((await preview({ entryId: huge.id, id: eid("huge"), expectedRevision: null, json: template.json })).data.error, "content_too_large");
	check("expansion and content bounds");

	// ---- Library edits and deletion never reach the applied copy or the page ----
	const copyRow = await pluginCtx.storage.schemas.getVersioned(eid("copy"));
	const pageBefore = JSON.stringify(await customGraphs(post, "/posts/launch-notes"));
	const current = await call("schema-library");
	const changed = await call("save-schema-library-template", { mode: "update", expectedRevision: current.data.revision, id: tid("article"), name: "Library article", json: article("Changed in the library") });
	assert.equal(changed.data.success, true);
	assert.deepEqual(await pluginCtx.storage.schemas.getVersioned(eid("copy")), copyRow, "the applied copy keeps its JSON and revision");
	assert.equal(JSON.stringify(await customGraphs(post, "/posts/launch-notes")), pageBefore, "and the page is unchanged");
	const removed = await call("delete-schema-library-template", { expectedRevision: changed.data.library.revision, id: tid("article") });
	assert.equal(removed.data.success, true);
	assert.equal(removed.data.library.templates.some((item) => item.id === tid("article")), false);
	assert.deepEqual(await pluginCtx.storage.schemas.getVersioned(eid("copy")), copyRow, "deleting the template keeps the copy");
	assert.equal(JSON.stringify(await customGraphs(post, "/posts/launch-notes")), pageBefore);
	assert.equal((await call("delete-schema-library-template", { expectedRevision: changed.data.library.revision, id: tid("faq") })).data.error, "conflict", "deletion needs the reviewed revision");
	// The public route answers for anyone; a template still stored must not appear in it.
	const remaining = (await call("schema-library")).data.templates.find((item) => item.id === tid("faq"));
	assert.ok(remaining?.json.includes("Committed"), "the FAQ template is still stored");
	const publicConfig = await call("public-config", {}, { user: null, csrf: false });
	assert.equal(publicConfig.status, 200);
	assert.deepEqual(Object.keys(publicConfig.data).sort(), ["noindex", "siteName", "sitemap", "sitemapUrl"]);
	assert.equal(typeof publicConfig.data.noindex, "boolean");
	const publicText = JSON.stringify(publicConfig.data);
	for (const leak of [remaining.id, remaining.name, remaining.json, "Committed", SCHEMA_LIBRARY_KEY, "templates", "schema-library"]) {
		assert.equal(publicText.includes(leak), false, `public configuration does not carry ${leak.slice(0, 40)}`);
	}
	check("library edit and delete leave applied copies and pages unchanged");

	report.result = "passed";
	console.log(JSON.stringify(report));
	console.log(`Schema library passed through the published HTTP dispatcher with plugin KV and revisioned storage on EmDash ${target.versions.get("emdash")} with in-memory SQLite (${report.checks.length} check groups).`);
} finally {
	await db.destroy();
}
