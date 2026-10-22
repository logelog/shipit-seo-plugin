// Native metadata Templates proof on a migrated EmDash SQLite database from the
// selected published host. Routes run behind the published HTTP dispatcher,
// which checks the user, the CSRF header and the declared body limit before a
// handler runs. The record lives in the published plugin KV, and page output
// comes from the plugin's page:metadata hook with a host-created plugin
// context (not rendered HTML).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Metadata templates smoke skipped on ${target.name}; this check requires a released native target.`);
	process.exit(0);
}
let networkCalls = 0;
globalThis.fetch = async () => {
	networkCalls += 1;
	throw new Error("External networking is disabled in this smoke check");
};

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
const RevisionRepository = await hostDistExport("RevisionRepository");
const SeoRepository = await hostDistExport("SeoRepository");
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const { generateBaseSeoContributions, resolvePageMetadata } = await import("emdash/page");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createSqliteSeoFixture } = await import("./sqlite-plugin-fixture.mjs");
const { METADATA_TEMPLATES_KEY } = await source("metadata-templates.ts");

const SITE = "https://example.com";
const RECORD_ROW = `plugin:shipit-seo:${METADATA_TEMPLATES_KEY}`;
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], queries: {} };
const check = (name) => report.checks.push(name);

// Counts statements, and can drop the response of one committed record write:
// the UPDATE or INSERT runs and autocommits, then the caller sees an error.
const statements = [];
let loseNextRecordWrite = false;
const lostQueries = new Set();
const responseLoss = {
	transformQuery({ node, queryId }) {
		if (loseNextRecordWrite && (node.kind === "UpdateQueryNode" || node.kind === "InsertQueryNode") && JSON.stringify(node).includes(RECORD_ROW)) {
			loseNextRecordWrite = false;
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
// Template reads are counted by their bound options key, not by SQL text.
const templateReads = (run) => run.filter(({ sql, parameters }) => /^\s*select\b/i.test(sql) && /"options"/.test(sql) &&
	parameters.some((value) => value === RECORD_ROW || String(value).startsWith("plugin:shipit-seo:tpl:"))).length;
const schemaReads = (run) => run.filter(({ sql, parameters }) => /_plugin_storage/.test(sql) && parameters.includes("schemas")).length;
const recordRow = async () => (await db.selectFrom("options").select(["value", "revision"]).where("name", "=", RECORD_ROW).executeTakeFirst()) ?? null;
const optionCount = async () => Number((await db.selectFrom("options").select(db.fn.countAll().as("count")).executeTakeFirst()).count);

try {
	await runMigrations(db);
	const seo = createSqliteSeoFixture(db);
	await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
	const schema = new SchemaRegistry(db);
	await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] });
	for (const slug of ["title", "excerpt", "notes"]) await schema.createField("posts", { slug, label: slug, type: "string" });
	await schema.createCollection({ slug: "pages", label: "Pages", hasSeo: true, routable: true, urlPattern: "/pages/{slug}", supports: ["drafts", "revisions"] });
	for (const slug of ["title", "excerpt"]) await schema.createField("pages", { slug, label: slug, type: "string" });
	// Public and routable, with EmDash's SEO fields off: still a page the hook describes.
	await schema.createCollection({ slug: "notes", label: "Notes", hasSeo: false, routable: true, urlPattern: "/notes/{slug}", supports: ["drafts", "revisions"] });
	for (const slug of ["title", "excerpt"]) await schema.createField("notes", { slug, label: slug, type: "string" });
	// Genuinely hidden and genuinely unroutable types, which are never template targets.
	await schema.createCollection({ slug: "internal", label: "Internal", hasSeo: true, routable: true, hidden: true, urlPattern: "/internal/{slug}" });
	await schema.createCollection({ slug: "unrouted", label: "Unrouted", hasSeo: true, routable: false });
	const content = new ContentRepository(db);
	const post = await content.create({ type: "posts", slug: "launch-notes", data: { title: "Launch notes", excerpt: "Fresh bread daily" }, status: "published", locale: "en" });
	const french = await content.create({ type: "posts", slug: "launch-notes", data: { title: "Notes de lancement", excerpt: "Pain frais" }, status: "published", locale: "fr", translationOf: post.id });
	const huge = await content.create({ type: "posts", slug: "huge-notes", data: { title: "Huge", notes: "h".repeat(40_000) }, status: "published", locale: "en" });
	const wide = await content.create({ type: "posts", slug: "wide-notes", data: { title: "Wide", excerpt: "w".repeat(9_000) }, status: "published", locale: "en" });
	const draftPost = await content.create({ type: "posts", slug: "draft-post", data: { title: "Draft post", excerpt: "Not yet" }, status: "draft", locale: "en" });
	const page = await content.create({ type: "pages", slug: "about", data: { title: "About", excerpt: "About the bakery" }, status: "published", locale: "en" });
	const note = await content.create({ type: "notes", slug: "starter", data: { title: "Starter notes", excerpt: "Feeding the starter" }, status: "published", locale: "en" });
	// A normal draft save of a published entry: the draft is a revision, the live columns stay.
	const draftRevision = await new RevisionRepository(db).create({ collection: "posts", entryId: post.id, data: { title: "Launch notes (draft)", excerpt: "Unpublished draft excerpt" } });
	await content.setDraftRevision("posts", post.id, draftRevision.id);
	await new SeoRepository(db).upsert("pages", page.id, { description: "Entry SEO description for About" });

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
	const warnings = [];
	const log = pluginCtx.log;
	pluginCtx.log = { ...log, warn: (message, data) => { warnings.push({ message, data }); } };
	const pageFor = (entry, path, collection, canonical = `${SITE}${path}`) => ({
		url: `${SITE}${path}`, path, locale: entry.locale, kind: "content", pageType: "article",
		title: entry.slug, pageTitle: entry.data.title, description: "", canonical, image: null,
		content: { collection, id: entry.id, slug: entry.slug }, seo: {}, siteName: "Harbour Bakery", siteUrl: SITE,
	});
	const tagsOf = (contributions) => {
		const find = (kind, name) => contributions.find((item) => item.kind === kind && (item.name === name || item.property === name))?.content ?? "";
		return {
			description: find("meta", "description"),
			socialTitle: find("property", "og:title"),
			socialDescription: find("property", "og:description"),
			twitterTitle: find("meta", "twitter:title"),
			twitterDescription: find("meta", "twitter:description"),
		};
	};
	const render = async (entry, path, collection = "posts") => tagsOf((await seo.hooks["page:metadata"].handler({ page: pageFor(entry, path, collection) }, pluginCtx)) ?? []);
	const configuration = async () => (await call("admin-templates")).data;
	const command = async (route, collection, values, options = {}) => {
		const current = options.configuration ?? (await configuration());
		const item = current.items.find((candidate) => candidate.collection === collection);
		return call(route, {
			collection,
			expectedRevision: options.expectedRevision === undefined ? current.revision : options.expectedRevision,
			inheritanceGuard: options.guard ?? item.inheritanceGuard,
			...(values ? { values } : {}),
		});
	};
	const postValues = { title: "{{title}} | {{siteName}}", description: "Fresh from the oven: {{description}}", socialTitle: "{{title}} at {{siteName}}", socialDescription: "" };
	const previewOf = (values, patch = {}) => call("preview-admin-template", { collection: "posts", entryId: post.id, locale: "en", values, ...patch });

	// ---- Permissions, CSRF, declared bodies and strict input ----
	const sampleGuard = { fields: { title: null, description: null, socialTitle: null, socialDescription: null }, revisions: null };
	const routes = {
		"admin-templates": undefined,
		"save-admin-templates": { collection: "posts", expectedRevision: null, inheritanceGuard: sampleGuard, values: postValues },
		"reset-admin-templates": { collection: "posts", expectedRevision: null, inheritanceGuard: sampleGuard },
		"admin-template-examples": { collection: "posts", limit: 25 },
		"admin-template-example": { collection: "posts", entryId: post.id },
		"preview-admin-template": { collection: "posts", entryId: post.id, locale: "en", values: postValues },
	};
	for (const [route, body] of Object.entries(routes)) {
		assert.equal((await call(route, body, { user: null })).status, 401, `${route} refuses anonymous callers`);
		assert.equal((await call(route, body, { user: people.editor })).status, 403, `${route} refuses an Editor`);
		assert.equal((await call(route, body, { csrf: false })).status, 403, `${route} requires the CSRF header`);
	}
	assert.equal(await recordRow(), null, "refused requests wrote nothing");
	const pluginTypes = createRequire(new URL("package.json", hostPackageRoot("emdash"))).resolve("@emdash-cms/plugin-types");
	const { extractManifestRoute } = await import(pathToFileURL(pluginTypes).href);
	for (const route of Object.keys(routes)) {
		assert.equal(JSON.parse(JSON.stringify(extractManifestRoute(route, seo.routes[route]))).permission, "plugins:manage", route);
	}
	assert.equal((await call("save-admin-templates", undefined, { raw: JSON.stringify({ ...routes["save-admin-templates"], values: { ...postValues, description: "x".repeat(40_000) } }) })).status, 413, "the declared save body limit is enforced before parsing");
	assert.equal((await call("preview-admin-template", undefined, { raw: JSON.stringify({ ...routes["preview-admin-template"], values: { ...postValues, description: "x".repeat(40_000) } }) })).status, 413, "and the preview body limit");
	assert.equal((await call("admin-template-example", undefined, { raw: JSON.stringify({ collection: "posts", entryId: "x".repeat(5_000) }) })).status, 413, "and the exact example body limit");
	assert.equal((await call("save-admin-templates", { ...routes["save-admin-templates"], scope: "all" })).status, 400, "unknown fields are refused by the strict contract");
	for (const body of [{ collection: "posts", entryId: post.id, locale: "en" }, { collection: "posts", entryId: post.id, cursor: "next" }, { collection: "posts", entryId: "" }, { collection: "posts" }]) {
		assert.equal((await call("admin-template-example", body)).status, 400, `the exact example refuses ${JSON.stringify(body)}`);
	}
	assert.equal(await recordRow(), null);
	check("permissions, CSRF, declared body limits and strict input");

	// ---- Absent state: defaults, no writes ----
	const optionsBefore = await optionCount();
	const absent = await counted(() => call("admin-templates"));
	assert.equal(absent.value.status, 200);
	assert.equal(absent.value.data.state, "absent");
	assert.deepEqual(absent.value.data.items.map((item) => `${item.collection}:${item.source}`).sort(), ["notes:default", "pages:default", "posts:default"],
		"public types are targets with or without core SEO fields; hidden and unroutable types are not");
	assert.equal(absent.writes, 0);
	assert.equal(await optionCount(), optionsBefore, "reading creates no row");
	report.queries.configurationReadAbsent = { queries: absent.queries, writes: absent.writes, templateReads: templateReads(absent.run) };
	check("absent record inherits the defaults without writes");

	// ---- Preview: published live data, not the pending draft ----
	const pageBefore = await render(page, "/pages/about", "pages");
	const first = await counted(() => previewOf(postValues));
	assert.equal(first.value.status, 200);
	assert.equal(first.value.data.success, true, JSON.stringify(first.value.data));
	const predicted = first.value.data.preview;
	assert.equal(predicted.description.value, "Fresh from the oven: Fresh bread daily", "the preview uses live content, not the draft revision");
	assert.equal(predicted.titleSuggestion.value, "Launch notes | Harbour Bakery");
	assert.equal(predicted.publicUrl, `${SITE}/posts/launch-notes`);
	assert.equal(first.writes, 0);
	assert.equal(schemaReads(first.run), 0, "the preview reads no schema rows");
	report.queries.previewRoute = { queries: first.queries, writes: first.writes, schemaReads: schemaReads(first.run), templateReads: templateReads(first.run), bytes: first.value.bytes };
	const control = await counted(() => call("admin-entry-preview", { ref: `posts:${post.id}`, template: postValues }));
	report.queries.entryPreviewRouteControl = { queries: control.queries, writes: control.writes, schemaReads: schemaReads(control.run) };
	check("explicit preview of the published entry ignores the pending draft");

	// ---- Save, reload, public output equals the prediction; other collection unchanged ----
	// Route cost only: the configuration the editor loaded is read outside the count.
	const loadedForSave = await configuration();
	const saved = await counted(() => command("save-admin-templates", "posts", postValues, { configuration: loadedForSave }));
	assert.equal(saved.value.data.success, true, JSON.stringify(saved.value.data));
	assert.equal(saved.value.data.outcome, "saved");
	assert.equal(saved.writes, 1, "one conditional write");
	report.queries.saveRoute = { queries: saved.queries, writes: saved.writes, includes: "the command and the configuration read in its answer" };
	const stored = JSON.parse((await recordRow()).value);
	assert.deepEqual(Object.keys(stored.values), ["posts"]);
	assert.equal(stored.fallbackScoreRevision, null);
	const reloaded = await counted(() => call("admin-templates"));
	assert.equal(reloaded.value.data.state, "saved");
	assert.equal(reloaded.value.data.items.find((item) => item.collection === "posts").source, "override");
	report.queries.configurationRead = { queries: reloaded.queries, writes: reloaded.writes, templateReads: templateReads(reloaded.run) };
	const hookRun = await counted(() => render(post, "/posts/launch-notes"));
	const emitted = hookRun.value;
	assert.equal(emitted.description, predicted.description.value, "the page's description equals the prediction");
	assert.equal(emitted.socialTitle, predicted.socialTitle.value);
	assert.equal(emitted.twitterTitle, predicted.socialTitle.value);
	assert.equal(emitted.socialDescription, predicted.socialDescription.value);
	assert.equal(emitted.twitterDescription, predicted.socialDescription.value);
	report.queries.hookContribution = { queries: hookRun.queries, writes: hookRun.writes, templateReads: templateReads(hookRun.run) };
	assert.deepEqual(await render(page, "/pages/about", "pages"), pageBefore, "the Page's output is unchanged");
	assert.equal(pageBefore.description, "Entry SEO description for About", "entry SEO wins over the template");
	const pageHook = await counted(() => render(page, "/pages/about", "pages"));
	report.queries.hookContributionInheriting = { queries: pageHook.queries, templateReads: templateReads(pageHook.run) };
	const frenchPreview = await previewOf(postValues, { entryId: french.id });
	assert.equal(frenchPreview.data.error, "locale_mismatch", "the exact locale is required");
	check("saved defaults reach the hook exactly as predicted; the Page and entry SEO are unchanged");

	// ---- No-op, stale revision, legacy guard and ABA ----
	const loadedForNoop = await configuration();
	const same = await counted(() => command("save-admin-templates", "posts", postValues, { configuration: loadedForNoop }));
	assert.equal(same.value.data.outcome, "unchanged");
	assert.equal(same.writes, 0, "a no-op writes nothing");
	report.queries.noopSaveRoute = { queries: same.queries, writes: same.writes };
	const before = await recordRow();
	const stale = await command("save-admin-templates", "posts", { ...postValues, title: "Stale {{title}}" }, { expectedRevision: "00000000-0000-0000-0000-000000000000" });
	assert.equal(stale.data.error, "conflict");
	assert.deepEqual(await recordRow(), before, "a stale revision changes nothing");
	const loaded = await configuration();
	await pluginCtx.kv.set("tpl:pages:title", "{{title}} | Legacy");
	const legacyRace = await command("save-admin-templates", "pages", { ...postValues, description: "Page {{description}}" }, { configuration: loaded });
	assert.equal(legacyRace.data.error, "conflict", "a legacy change after the configuration was loaded is a conflict");
	const legacyLoaded = await configuration();
	assert.equal(legacyLoaded.items.find((item) => item.collection === "pages").source, "legacy");
	await pluginCtx.kv.set("tpl:pages:title", "{{title}} | Legacy");
	const aba = await command("save-admin-templates", "pages", { ...postValues, description: "Page {{description}}" }, { configuration: legacyLoaded });
	assert.equal(aba.data.error, "conflict", "the same legacy bytes written again are a conflict");
	assert.deepEqual(await recordRow(), before);
	check("no-op, stale revision, load-to-command legacy race and equal-value ABA");

	// ---- A committed write whose response is lost ----
	const writesBefore = statements.length;
	loseNextRecordWrite = true;
	const lost = await command("save-admin-templates", "posts", { ...postValues, socialDescription: "{{description}}" });
	assert.equal(lost.data.error, "unconfirmed", JSON.stringify(lost.data));
	assert.equal(statements.slice(writesBefore).filter(({ sql, parameters }) => /^\s*(insert|update)\b/i.test(sql) && parameters.includes(RECORD_ROW)).length, 1, "one write, no retry");
	assert.equal(JSON.parse((await recordRow()).value).values.posts.socialDescription, "{{description}}", "the write committed; only a read can show it");
	check("committed-write uncertainty is reported without retry or rollback");

	// ---- Reset: deliberate, inherited legacy value, record kept ----
	const pagesSave = await command("save-admin-templates", "pages", { ...postValues, description: "Page {{description}}" });
	assert.equal(pagesSave.data.outcome, "saved");
	const tokensBefore = JSON.parse((await recordRow()).value).collectionUpdatedAt;
	const loadedForReset = await configuration();
	const reset = await counted(() => command("reset-admin-templates", "pages", undefined, { configuration: loadedForReset }));
	assert.equal(reset.value.data.outcome, "saved");
	report.queries.resetRoute = { queries: reset.queries, writes: reset.writes, includes: "the command and the configuration read in its answer" };
	const afterReset = JSON.parse((await recordRow()).value);
	assert.equal("pages" in afterReset.values, false);
	assert.equal(afterReset.collectionUpdatedAt.posts, tokensBefore.posts, "the other token is unchanged");
	assert.notEqual(afterReset.collectionUpdatedAt.pages, tokensBefore.pages, "the reset token advances because the values change");
	assert.equal((await configuration()).items.find((item) => item.collection === "pages").values.title, "{{title}} | Legacy", "reset inherits the readable legacy value");
	assert.equal(await pluginCtx.kv.get("tpl:pages:title"), "{{title}} | Legacy", "legacy bytes stay");
	check("reset of one collection inherits legacy values and keeps other tokens");

	// ---- A public type with core SEO fields off: listed, previewed, saved, emitted, reset ----
	const notesValues = { title: "{{title}} | {{siteName}}", description: "From the notebook: {{description}}", socialTitle: "{{title}} notes", socialDescription: "" };
	const listed = await configuration();
	const notesItem = listed.items.find((item) => item.collection === "notes");
	assert.ok(notesItem, "the disabled-SEO public type is listed");
	assert.match(notesItem.description, /EmDash SEO fields are off/);
	assert.equal(listed.items.some((item) => item.collection === "internal" || item.collection === "unrouted"), false, "hidden and unroutable types are not listed");
	const noteExamples = await call("admin-template-examples", { collection: "notes", limit: 25 });
	assert.deepEqual(noteExamples.data.items.map((item) => item.entryId), [note.id]);
	for (const collection of ["internal", "unrouted"]) {
		assert.equal((await call("admin-template-examples", { collection, limit: 25 })).data.error, "collection_unavailable", `${collection} lists no examples`);
		assert.equal((await call("preview-admin-template", { collection, entryId: note.id, locale: "en", values: notesValues })).data.error, "collection_unavailable", `${collection} is not previewed`);
	}
	const noteBefore = await render(note, "/notes/starter", "notes");
	assert.equal(noteBefore.description, "Feeding the starter", "before a save the inherited default describes the page");
	const notePreview = await counted(() => call("preview-admin-template", { collection: "notes", entryId: note.id, locale: "en", values: notesValues }));
	assert.equal(notePreview.value.data.success, true, JSON.stringify(notePreview.value.data));
	assert.equal(notePreview.writes, 0);
	const notePredicted = notePreview.value.data.preview;
	const beforeNoteSave = await recordRow();
	const hiddenEdit = await command("save-admin-templates", "internal", notesValues, { configuration: { ...listed, items: [...listed.items, { collection: "internal", inheritanceGuard: sampleGuard }] } });
	assert.equal(hiddenEdit.data.error, "collection_unavailable", "a hidden type cannot be edited");
	assert.deepEqual(await recordRow(), beforeNoteSave, "and nothing was written");
	const staleNote = await command("save-admin-templates", "notes", notesValues, { configuration: listed, expectedRevision: "00000000-0000-0000-0000-000000000000" });
	assert.equal(staleNote.data.error, "conflict", "the revision guard applies to it");
	assert.deepEqual(await recordRow(), beforeNoteSave);
	const noteSave = await counted(() => command("save-admin-templates", "notes", notesValues, { configuration: listed }));
	assert.equal(noteSave.value.data.outcome, "saved", JSON.stringify(noteSave.value.data));
	assert.equal(noteSave.writes, 1, "one conditional write");
	const afterNoteSave = JSON.parse((await recordRow()).value);
	assert.deepEqual(afterNoteSave.values.notes, notesValues);
	assert.equal((await configuration()).items.find((item) => item.collection === "notes").source, "override", "the saved template reloads");
	const noteHook = await counted(() => render(note, "/notes/starter", "notes"));
	assert.equal(noteHook.value.description, notePredicted.description.value, "the page's description equals the prediction");
	assert.equal(noteHook.value.socialTitle, notePredicted.socialTitle.value);
	assert.equal(noteHook.value.twitterTitle, notePredicted.socialTitle.value);
	assert.equal(notePredicted.description.source, "template");
	report.queries.disabledSeoTarget = {
		previewQueries: notePreview.queries, saveQueries: noteSave.queries, saveWrites: noteSave.writes,
		hookQueries: noteHook.queries, hookTemplateReads: templateReads(noteHook.run),
	};
	const noteReset = await command("reset-admin-templates", "notes");
	assert.equal(noteReset.data.outcome, "saved");
	assert.equal("notes" in JSON.parse((await recordRow()).value).values, false);
	assert.deepEqual(await render(note, "/notes/starter", "notes"), noteBefore, "reset returns the page to the inherited default");
	check("a public type with core SEO fields off is listed, previewed, guarded, saved, emitted and reset; hidden and unroutable types are refused");

	// ---- Bounds and refusals ----
	assert.equal((await previewOf(postValues, { entryId: huge.id })).data.error, "content_too_large");
	assert.equal((await previewOf({ ...postValues, description: "{{description}} {{description}}" }, { entryId: wide.id })).data.error, "expansion_too_large");
	assert.equal((await previewOf(postValues, { entryId: draftPost.id })).data.error, "not_published");
	const examples = await counted(() => call("admin-template-examples", { collection: "posts", limit: 25 }));
	assert.equal(examples.value.data.success, true);
	assert.equal(examples.value.data.items.some((item) => item.entryId === draftPost.id), false, "drafts are not listed");
	assert.ok(examples.value.data.items.some((item) => item.entryId === french.id && item.locale === "fr"), "each option names its locale");
	report.queries.examplesRoute = { queries: examples.queries, writes: examples.writes };
	check("preview bounds, publication and example listing");

	// ---- One exact example outside the first published page ----
	// Created after every other post, so the earlier posts are older than the first page.
	for (let index = 0; index < 26; index += 1) {
		await content.create({ type: "posts", slug: `bulk-${index}`, data: { title: `Bulk ${index}`, excerpt: "Bulk entry" }, status: "published", locale: "en" });
	}
	const firstPosts = await counted(() => call("admin-template-examples", { collection: "posts", limit: 25 }));
	assert.equal(firstPosts.value.data.success, true);
	assert.equal(firstPosts.value.data.items.length, 25);
	assert.equal(firstPosts.value.data.hasMore, true, "more than 25 published posts");
	const listedIds = new Set(firstPosts.value.data.items.map((item) => item.entryId));
	assert.ok(!listedIds.has(post.id) && !listedIds.has(french.id), "the English and French posts are outside the first page");
	report.queries.examplesRouteFullPage = { queries: firstPosts.queries, writes: firstPosts.writes };
	const recordBeforeExact = await recordRow();
	const optionsBeforeExact = await optionCount();
	const fetchesBeforeExact = networkCalls;
	const exactRuns = [];
	for (const entry of [post, french]) {
		const exact = await counted(() => call("admin-template-example", { collection: "posts", entryId: entry.id }));
		assert.equal(exact.value.status, 200);
		assert.equal(exact.value.data.success, true, JSON.stringify(exact.value.data));
		assert.deepEqual(
			[exact.value.data.collection, exact.value.data.entryId, exact.value.data.example.entryId, exact.value.data.example.locale, exact.value.data.example.title],
			["posts", entry.id, entry.id, entry.locale, entry.data.title],
			"the off-page entry resolves exactly with its actual locale",
		);
		assert.equal(exact.writes, 0);
		assert.equal(schemaReads(exact.run), 0, "no schema rows are read");
		assert.ok(exact.run.some(({ sql }) => /"ec_posts"/.test(sql)), "the exact read is observed on the posts table");
		assert.equal(exact.run.some(({ sql }) => /"ec_posts"/.test(sql) && /\border\s+by\b|\bcount\s*\(/i.test(sql)), false, "no page or count is read");
		exactRuns.push(exact);
	}
	assert.deepEqual([post.locale, french.locale], ["en", "fr"]);
	report.queries.exactExampleRoute = { queries: exactRuns[0].queries, writes: exactRuns[0].writes, bytes: exactRuns[0].value.bytes };
	const exactFrench = exactRuns[1].value.data.example;
	const frenchExactPreview = await call("preview-admin-template", { collection: "posts", entryId: exactFrench.entryId, locale: exactFrench.locale, values: postValues });
	assert.equal(frenchExactPreview.data.success, true, JSON.stringify(frenchExactPreview.data));
	assert.deepEqual([frenchExactPreview.data.preview.entryId, frenchExactPreview.data.preview.locale], [french.id, "fr"], "the preview uses the exact entry and the locale it returned");
	const refusals = [
		[{ collection: "posts", entryId: draftPost.id }, "not_published"],
		[{ collection: "posts", entryId: "00000000-0000-0000-0000-000000000000" }, "not_found"],
		[{ collection: "posts", entryId: page.id }, "not_found"],
		[{ collection: "internal", entryId: post.id }, "collection_unavailable"],
		[{ collection: "unrouted", entryId: post.id }, "collection_unavailable"],
	];
	for (const [body, error] of refusals) {
		const refused = await call("admin-template-example", body);
		assert.equal(refused.status, 200);
		assert.deepEqual([refused.data.success, refused.data.error, refused.data.collection, refused.data.entryId], [false, error, body.collection, body.entryId],
			`${body.collection}:${body.entryId} is refused as ${error} and names its request`);
		assert.equal("example" in refused.data, false, "a refusal carries no example");
	}
	assert.deepEqual(await recordRow(), recordBeforeExact, "exact example reads write nothing");
	assert.equal(await optionCount(), optionsBeforeExact);
	assert.equal(networkCalls, fetchesBeforeExact, "and call no network");
	check("an exact example outside the first page resolves with its locale and previews; drafts, missing, other-collection and hidden or unroutable references are refused by name without writes");

	// ---- Corrupt and unavailable records are kept and refuse every write ----
	const valid = await recordRow();
	await db.updateTable("options").set({ value: JSON.stringify({ version: 1, values: "broken" }) }).where("name", "=", RECORD_ROW).execute();
	const corruptRow = await recordRow();
	const corrupt = await configuration();
	assert.equal(corrupt.state, "corrupt");
	assert.equal(corrupt.items.length, 0);
	assert.equal((await command("save-admin-templates", "posts", postValues, { configuration: { ...corrupt, items: [{ collection: "posts", inheritanceGuard: sampleGuard }] } })).data.error, "corrupt");
	assert.equal((await previewOf(postValues)).data.error, "templates_unreadable");
	assert.deepEqual(await recordRow(), corruptRow, "corrupt bytes are kept");
	warnings.length = 0;
	const corruptOutput = await render(post, "/posts/launch-notes");
	assert.equal(corruptOutput.description, "Fresh bread daily", "an unreadable record gives the entry's own description");
	assert.ok(warnings.some(({ message, data }) => /templates are unreadable/.test(message) && data?.state === "corrupt" && !JSON.stringify(data).includes("broken")), "one bounded warning without stored bytes");
	await db.updateTable("options").set({ value: "{not json" }).where("name", "=", RECORD_ROW).execute();
	assert.equal((await configuration()).state, "unavailable");
	assert.equal((await previewOf(postValues)).data.error, "templates_unreadable");
	assert.equal((await recordRow()).value, "{not json");
	await db.updateTable("options").set({ value: valid.value, revision: valid.revision }).where("name", "=", RECORD_ROW).execute();
	check("corrupt and unavailable records are kept, refuse writes and previews, and fall back to entry values");

	// ---- One effective canonical names the canonical link and og:url ----
	// Route R, core C and legacy L are distinct. The page context carries the
	// core canonical as EmDashHead's SEO panel overlay does, and the published
	// merge keeps the first of each key with plugin contributions before base.
	const R = `${SITE}/posts/launch-notes`;
	const C = `${SITE}/guides/launch-notes`;
	const L = `${SITE}/archive/launch-notes`;
	const ref = `posts:${post.id}`;
	const legacyAt = "2026-10-03T12:00:00.000Z";
	const urlsOf = (contributions) => ({
		canonical: contributions.filter((item) => item.kind === "link" && item.rel === "canonical").map((item) => item.href),
		ogUrl: contributions.filter((item) => item.kind === "property" && item.property === "og:url").map((item) => item.content),
	});
	const tablesOf = (run) => {
		const tables = {};
		for (const { sql } of run) {
			for (const [, table] of sql.matchAll(/\b(?:from|into|update|join)\s+"([^"]+)"/gi)) tables[table] = (tables[table] ?? 0) + 1;
		}
		return tables;
	};
	const observe = async (entry, path, canonical) => {
		const page = pageFor(entry, path, "posts", canonical);
		const fetchesBefore = networkCalls;
		const hookRun = await counted(() => seo.hooks["page:metadata"].handler({ page }, pluginCtx));
		const merged = resolvePageMetadata([...hookRun.value, ...generateBaseSeoContributions(page)]);
		return {
			plugin: urlsOf(hookRun.value),
			merged: urlsOf([
				...merged.links.map((link) => ({ kind: "link", ...link })),
				...merged.properties.map((item) => ({ kind: "property", ...item })),
			]),
			cost: { queries: hookRun.queries, writes: hookRun.writes, schemaReads: schemaReads(hookRun.run), network: networkCalls - fetchesBefore, tables: tablesOf(hookRun.run) },
		};
	};
	const seoRepository = new SeoRepository(db);
	const states = [];
	report.queries.canonicalSocialHook = {};
	const visit = async (label, expected, source, pageCanonical) => {
		const observed = await observe(post, "/posts/launch-notes", pageCanonical);
		report.queries.canonicalSocialHook[label] = observed.cost;
		states.push({
			label, expected, source, observed,
			entry: (await call("admin-entry-preview", { ref })).data,
			template: (await previewOf(postValues)).data,
		});
	};
	await visit("route", R, "generated", R);
	await seoRepository.upsert("posts", post.id, { canonical: C });
	await visit("core", C, "core-seo", C);
	await pluginCtx.storage.overrides.put(ref, { ref, canonical: L, updatedAt: legacyAt });
	await visit("legacy", L, "legacy-override", C);
	const frenchTemplate = (await previewOf(postValues, { entryId: french.id, locale: "fr" })).data;
	const frenchRoute = frenchTemplate.preview?.publicUrl;
	const frenchObserved = await observe(french, new URL(frenchRoute).pathname, frenchRoute);
	await pluginCtx.storage.overrides.delete(ref);
	await visit("legacy-removed", C, "core-seo", C);
	await seoRepository.upsert("posts", post.id, { canonical: null });
	await visit("core-cleared", R, "generated", R);
	await pluginCtx.storage.overrides.put(ref, { ref, canonical: "javascript:alert(1)", updatedAt: legacyAt });
	const invalid = await observe(post, "/posts/launch-notes", R);
	report.queries.canonicalSocialHook.invalidLegacy = invalid.cost;
	const invalidEntry = (await call("admin-entry-preview", { ref })).data;
	// URL parsing accepts the first four, but the published merge keeps a link
	// only after an http(s):// prefix while it keeps any property.
	await seoRepository.upsert("posts", post.id, { canonical: C });
	const dropped = ["https:example.com/archive/launch-notes", "https:/example.com/archive/launch-notes", "https:\\\\example.com/archive/launch-notes", "\u0001https://example.com/archive/launch-notes"];
	const kept = [[` ${L}\n`, L], ["HTTPS://EXAMPLE.COM/archive/launch-notes", "HTTPS://EXAMPLE.COM/archive/launch-notes"]];
	const legacyForms = [];
	for (const value of [...dropped, ...kept.map(([value]) => value)]) {
		await pluginCtx.storage.overrides.put(ref, { ref, canonical: value, updatedAt: legacyAt });
		legacyForms.push({ value, observed: await observe(post, "/posts/launch-notes", C) });
	}
	report.queries.canonicalSocialHook.shorthandLegacy = legacyForms[0].observed.cost;
	await pluginCtx.storage.overrides.delete(ref);
	await seoRepository.upsert("posts", post.id, { canonical: null });

	for (const state of states) {
		assert.deepEqual(state.observed.merged, { canonical: [state.expected], ogUrl: [state.expected] },
			`${state.label}: the published merge keeps one canonical link and one og:url, both the effective canonical`);
	}
	for (const state of states) {
		assert.deepEqual(state.observed.plugin, { canonical: [state.expected], ogUrl: [state.expected] }, `${state.label}: the hook contributes both`);
		assert.equal(state.entry.success, true, JSON.stringify(state.entry).slice(0, 200));
		assert.equal(state.entry.preview.search.url, state.expected, `${state.label}: the saved entry preview names the same canonical`);
		assert.equal(state.entry.preview.sources.canonical, state.source);
		assert.equal(state.template.success, true, JSON.stringify(state.template).slice(0, 200));
		assert.equal(state.template.preview.publicUrl, R, `${state.label}: the Templates example keeps the public route`);
		assert.equal(state.template.preview.locale, "en");
		assert.deepEqual([state.observed.cost.writes, state.observed.cost.network], [0, 0], `${state.label}: the hook writes nothing and calls no network`);
	}
	assert.deepEqual([frenchTemplate.preview.entryId, frenchTemplate.preview.locale], [french.id, "fr"]);
	assert.ok(![C, L].includes(frenchRoute));
	assert.deepEqual(frenchObserved.plugin, { canonical: [frenchRoute], ogUrl: [frenchRoute] },
		"another locale's entry with the same slug is not described by this entry's core or id-keyed legacy value");
	for (const { cost } of [frenchObserved, invalid]) assert.deepEqual([cost.writes, cost.network], [0, 0]);
	assert.deepEqual(invalid.plugin, { canonical: [], ogUrl: [] }, "an invalid legacy value contributes neither URL");
	assert.deepEqual(invalid.merged, { canonical: [R], ogUrl: [R] }, "the host's own page canonical remains for both");
	assert.equal(invalidEntry.preview.sources.canonical, "legacy-override", "the invalid legacy value keeps its precedence");
	check("one effective canonical names the canonical link and og:url for route, core and legacy values, restores on removal, and keeps the Templates route and locale; invalid values contribute neither");
	for (const { value, observed } of legacyForms.slice(0, dropped.length)) {
		assert.deepEqual(observed.merged, { canonical: [C], ogUrl: [C] }, `${JSON.stringify(value)}: a legacy link the merge drops leaves the core canonical for both`);
		assert.deepEqual(observed.plugin, { canonical: [value], ogUrl: [] }, `${JSON.stringify(value)}: the hook keeps its canonical link contribution and adds no og:url`);
	}
	for (const [index, [value, expected]] of kept.entries()) {
		assert.deepEqual(legacyForms[dropped.length + index].observed.merged, { canonical: [expected], ogUrl: [expected] }, `${JSON.stringify(value)}: a legacy link the merge keeps names both`);
	}
	for (const { observed } of legacyForms) assert.deepEqual([observed.cost.writes, observed.cost.network], [0, 0]);
	check("a legacy canonical the published merge drops as a link adds no og:url, so the core canonical names both; trimmed and uppercase values name both");

	report.network = networkCalls;
	report.result = "passed";
	console.log(JSON.stringify(report));
	console.log(`Metadata templates passed through the published HTTP dispatcher with plugin KV on EmDash ${target.versions.get("emdash")} with in-memory SQLite (${report.checks.length} check groups).`);
} catch (error) {
	report.result = "failed";
	report.network = networkCalls;
	console.log(JSON.stringify(report));
	throw error;
} finally {
	await db.destroy();
}
