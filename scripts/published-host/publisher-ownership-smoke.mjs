// Native publisher ownership proof on a migrated EmDash SQLite database from
// the selected published host. Routes run behind the published HTTP
// dispatcher, which checks the user and the CSRF header before a handler runs.
// The policy lives in the published plugin KV, custom schemas in the plugin's
// storage collection, and page output comes from the plugin's page:metadata
// hook with a host-created plugin context (hook output, not rendered HTML).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Publisher ownership smoke skipped on ${target.name}; this check requires a released native target.`);
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
const { PUBLISHER_OWNERSHIP_KEY } = await source("publisher-ownership.ts");
const { BUSINESS_IDENTITY_KV_KEY } = await source("business-identity.ts");
const { SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS } = await source("admin-contract.ts");

const SITE = "https://example.com";
const POLICY_ROW = `plugin:shipit-seo:${PUBLISHER_OWNERSHIP_KEY}`;
const IDENTITY_ROW = `plugin:shipit-seo:${BUSINESS_IDENTITY_KV_KEY}`;
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], queries: {} };
const check = (name) => report.checks.push(name);

// Counts statements, and can drop the response of one committed policy write.
const statements = [];
let loseNextPolicyWrite = false;
const lostQueries = new Set();
const responseLoss = {
	transformQuery({ node, queryId }) {
		if (loseNextPolicyWrite && (node.kind === "UpdateQueryNode" || node.kind === "InsertQueryNode") && JSON.stringify(node).includes(POLICY_ROW)) {
			loseNextPolicyWrite = false;
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
const rowReads = (run, row) => run.filter(({ sql, parameters }) => /^\s*select\b/i.test(sql) && /"options"/.test(sql) && parameters.includes(row)).length;
const optionRow = async (name) => (await db.selectFrom("options").select(["value", "revision"]).where("name", "=", name).executeTakeFirst()) ?? null;
const contentScans = (run) => run.filter(({ sql }) => /from "ec_(posts|pages)"/.test(sql) && !/where/i.test(sql)).length;

try {
	await runMigrations(db);
	const seo = createSqliteSeoFixture(db);
	await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
	const schema = new SchemaRegistry(db);
	await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" });
	await schema.createField("posts", { slug: "title", label: "Title", type: "string" });
	await schema.createCollection({ slug: "pages", label: "Pages", hasSeo: true, routable: true, urlPattern: "/{slug}" });
	await schema.createField("pages", { slug: "title", label: "Title", type: "string" });
	await schema.createField("pages", { slug: "person", label: "Person", type: "json" });
	const content = new ContentRepository(db);
	const post = await content.create({ type: "posts", slug: "launch", data: { title: "Launch" }, status: "published", locale: "en" });
	const about = await content.create({ type: "pages", slug: "about", data: { title: "About" }, status: "published", locale: "en" });
	const home = await content.create({ type: "pages", slug: "home", data: { title: "Home", person: { name: "Jane Baker" } }, status: "published", locale: "en" });

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
	async function call(route, body, { user = people.admin, csrf = true, method = "POST" } = {}) {
		const request = new Request(`${SITE}/_emdash/api/plugins/shipit-seo/${route}`, {
			method,
			headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) },
			...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
		});
		const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: user ?? undefined });
		const payload = JSON.parse(await response.text());
		return { status: response.status, data: payload?.data, error: payload?.error };
	}
	const pluginCtx = new PluginContextFactory(routeOptions).createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
	const pageFor = (entry, path, canonical = `${SITE}${path}`) => ({
		url: `${SITE}${path}`, path, locale: entry.locale, kind: "content", pageType: entry.type === "posts" ? "article" : "website",
		title: entry.slug, pageTitle: entry.data.title, description: "", canonical, image: null,
		content: { collection: entry.type, id: entry.id, slug: entry.slug }, seo: {}, siteName: "Harbour Bakery", siteUrl: SITE,
	});
	const render = async (entry, path, canonical) => (await seo.hooks["page:metadata"].handler({ page: pageFor(entry, path, canonical) }, pluginCtx)) ?? [];
	const graphs = (contributions) => contributions.filter((item) => item.kind === "jsonld");
	const graphOf = (contributions, id) => graphs(contributions).find((item) => item.id === id)?.graph;
	const presetPublisherFacts = (contributions) => graphs(contributions)
		.filter((item) => !String(item.id).startsWith("custom:"))
		.some((item) => /"(publisher|provider)"/.test(JSON.stringify(item.graph)));
	const nonSchema = (contributions) => JSON.stringify(contributions.filter((item) => item.kind !== "jsonld"));
	const saveCustom = async (name, scope, json) => {
		const result = await call("save-admin-custom-schema", { id: "publisher-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), expectedRevision: null, name, scope, json: JSON.stringify(json), enabled: true });
		return result.data;
	};

	// Website name and legacy publisher name differ, as on the reviewed fixture.
	const settings = await call("admin-settings", {});
	const saved = await call("save-admin-settings", {
		siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "organization", organizationName: "Harbour Bakery BV",
		organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false,
		...(settings.data.revision === null ? { expectedRevision: null, expectedLegacyGuard: settings.data.legacyGuard } : { expectedRevision: settings.data.revision }),
	});
	assert.equal(saved.data.success, true, JSON.stringify(saved.data));

	// ---- Permissions, CSRF and strict input ----
	const routes = {
		"admin-publisher-ownership": {},
		"save-admin-publisher-ownership": { mode: "none", expectedRevision: null },
	};
	for (const [route, body] of Object.entries(routes)) {
		assert.equal((await call(route, body, { user: null })).status, 401, `${route} refuses anonymous callers`);
		assert.equal((await call(route, body, { user: people.editor })).status, 403, `${route} refuses an Editor`);
		assert.equal((await call(route, body, { csrf: false })).status, 403, `${route} requires the CSRF header`);
	}
	assert.equal((await call("save-admin-publisher-ownership", { mode: "none", expectedRevision: null, force: true })).status, 400, "unknown input keys are refused");
	assert.equal((await call("save-admin-publisher-ownership", { mode: "off", expectedRevision: null })).status, 400, "an unknown mode is refused");
	assert.equal(await optionRow(POLICY_ROW), null, "refused requests wrote nothing");
	const pluginTypes = createRequire(new URL("package.json", hostPackageRoot("emdash"))).resolve("@emdash-cms/plugin-types");
	const { extractManifestRoute } = await import(pathToFileURL(pluginTypes).href);
	for (const route of Object.keys(routes)) {
		assert.equal(JSON.parse(JSON.stringify(extractManifestRoute(route, seo.routes[route]))).permission, "plugins:manage", route);
	}
	check("permissions, CSRF, strict input and manifest permission");

	// ---- Absent: a read writes nothing, legacy output unchanged ----
	const absentRead = await counted(() => call("admin-publisher-ownership", {}));
	assert.deepEqual([absentRead.value.data.ownership.state, absentRead.value.data.ownership.effective], ["absent", "automatic"]);
	assert.equal(absentRead.writes, 0);
	assert.equal(await optionRow(POLICY_ROW), null, "no default record is created");
	report.queries.ownershipRead = { queries: absentRead.queries, writes: absentRead.writes };
	const legacyPost = await counted(() => render(post, "/posts/launch"));
	assert.equal(graphOf(legacyPost.value, "preset:organization")?.name, "Harbour Bakery BV", "the legacy publisher keeps its own name");
	assert.equal(rowReads(legacyPost.run, POLICY_ROW), 1, "one policy read per schema request");
	assert.equal(rowReads(legacyPost.run, IDENTITY_ROW), 1, "automatic mode reads the identity once");
	assert.equal(legacyPost.writes, 0, "rendering writes nothing");
	assert.equal(contentScans(legacyPost.run), 0, "no content enumeration");
	report.queries.publicRenderAutomatic = { queries: legacyPost.queries, policyReads: 1, identityReads: 1, writes: 0 };
	const baseline = { post: legacyPost.value, about: await render(about, "/about") };
	check("absent policy: no write, legacy output, one policy read per render");

	// ---- Legacy path: a custom definition survives and the automatic publisher is left off ----
	const legacyOwner = await saveCustom("Theme organization", "global", { "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "Harbour Bakery BV", legalName: "Harbour Bakery Holding BV" });
	assert.equal(legacyOwner.success, true, JSON.stringify(legacyOwner));
	const legacyCollision = await render(post, "/posts/launch");
	assert.equal(graphOf(legacyCollision, "preset:organization"), undefined);
	assert.equal(graphOf(legacyCollision, `custom:${legacyOwner.schema.id}`)?.legalName, "Harbour Bakery Holding BV", "the custom graph is emitted whole");
	assert.equal(presetPublisherFacts(legacyCollision), false, "no generated publisher links or inline facts");
	assert.equal((await call("delete-admin-custom-schema", { id: legacyOwner.schema.id, expectedRevision: legacyOwner.schema.revision })).data.success, true);
	assert.equal(JSON.stringify(await render(post, "/posts/launch")), JSON.stringify(baseline.post), "removing it restores the legacy output exactly");
	check("legacy path keeps an owning custom graph");

	// ---- Opt-out ----
	const off = await counted(() => call("save-admin-publisher-ownership", { mode: "none", expectedRevision: null }));
	assert.equal(off.value.data.success, true, JSON.stringify(off.value.data));
	assert.equal(off.writes, 1, "one conditional write");
	report.queries.ownershipOff = { queries: off.queries, writes: off.writes };
	assert.deepEqual(JSON.parse((await optionRow(POLICY_ROW)).value), { version: 1, mode: "none" });
	const offPost = await counted(() => render(post, "/posts/launch"));
	assert.equal(rowReads(offPost.run, POLICY_ROW), 1);
	assert.equal(rowReads(offPost.run, IDENTITY_ROW), 0, "the opt-out avoids the identity read");
	report.queries.publicRenderOff = { queries: offPost.queries, policyReads: 1, identityReads: 0, writes: offPost.writes };
	for (const [label, contributions, before] of [["post", offPost.value, baseline.post], ["page", await render(about, "/about"), baseline.about]]) {
		assert.equal(graphOf(contributions, "preset:organization"), undefined, `${label}: no publisher`);
		assert.equal(presetPublisherFacts(contributions), false, `${label}: no publisher links or inline facts`);
		assert.equal(nonSchema(contributions), nonSchema(before), `${label}: other metadata unchanged`);
	}
	const duplicate = await call("save-admin-publisher-ownership", { mode: "none", expectedRevision: off.value.data.ownership.revision });
	assert.deepEqual([duplicate.data.success, duplicate.data.changed], [true, false], "a repeated command writes nothing");
	const stale = await call("save-admin-publisher-ownership", { mode: "automatic", expectedRevision: null });
	assert.equal(stale.data.error, "conflict", "a stale revision is refused");
	check("opt-out: no publisher on Post or Page, one write, duplicate and stale commands");

	// ---- Only a valid opt-out relaxes the owned-ID guards ----
	const identity = await call("save-business-identity", { document: { kind: "Organization", name: "Harbour Bakery BV", contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } }, expectedRevision: null });
	assert.equal(identity.data.success, true, JSON.stringify(identity.data));
	const owner = await saveCustom("Custom owner", "global", { "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "Owned by custom" });
	assert.equal(owner.success, true, `a custom graph may own the ID while output is off: ${JSON.stringify(owner)}`);
	const offWithOwner = await render(post, "/posts/launch");
	assert.equal(graphOf(offWithOwner, `custom:${owner.schema.id}`)?.name, "Owned by custom");
	assert.equal(graphOf(offWithOwner, "preset:organization"), undefined);
	check("valid opt-out relaxes owned-ID save guards; the custom graph is emitted");

	// ---- Returning to automatic output ----
	const offRevision = (await call("admin-publisher-ownership", {})).data.ownership.revision;
	const refused = await counted(() => call("save-admin-publisher-ownership", { mode: "automatic", expectedRevision: offRevision }));
	assert.equal(refused.value.data.error, "preflight");
	assert.equal(refused.value.data.preflight.reason, "collision");
	assert.deepEqual(refused.value.data.preflight.definitions.map((item) => item.id), [owner.schema.id]);
	assert.equal(refused.writes, 0, "a refused return writes nothing");
	assert.equal(contentScans(refused.run), 0, "the preflight enumerates no content");
	assert.equal((await optionRow(POLICY_ROW)).revision, offRevision, "the opt-out is kept");
	report.queries.restoreRefused = { queries: refused.queries, writes: refused.writes };
	assert.equal((await call("delete-admin-custom-schema", { id: owner.schema.id, expectedRevision: owner.schema.revision })).data.success, true);
	const restored = await counted(() => call("save-admin-publisher-ownership", { mode: "automatic", expectedRevision: offRevision }));
	assert.equal(restored.value.data.success, true, JSON.stringify(restored.value.data));
	assert.equal(restored.writes, 1);
	assert.equal(contentScans(restored.run), 0);
	report.queries.restoreAccepted = { queries: restored.queries, writes: restored.writes };
	assert.deepEqual(JSON.parse((await optionRow(POLICY_ROW)).value), { version: 1, mode: "automatic" }, "kept as an explicit record");
	const business = await render(post, "/posts/launch");
	assert.equal(graphOf(business, "preset:organization")?.name, "Harbour Bakery BV", "the business publisher resumes");
	assert.equal((await saveCustom("Owner again", "global", { "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "x" })).success, false, "the guard applies again");
	check("restore preflight refuses a known collision, then restores with an explicit record");

	// ---- A row written behind the guard (a race or a content-specific record) is preserved at render ----
	await db.insertInto("_plugin_storage").values({
		plugin_id: seo.id, collection: "schemas", id: "race-owner",
		data: JSON.stringify({ storageVersion: 1, name: "Race owner", scope: `posts:${post.id}`, enabled: true, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE}/#organization`, name: "Raced", founder: { "@type": "Person", "@id": `${SITE}/#person`, name: "Jane" } }) }),
	}).execute();
	const raced = await render(post, "/posts/launch");
	assert.equal(graphOf(raced, "custom:race-owner")?.founder?.name, "Jane", "the content-specific graph survives");
	assert.equal(graphOf(raced, "preset:organization"), undefined);
	assert.equal(presetPublisherFacts(raced), false);
	assert.equal(graphOf(await render(about, "/about"), "preset:organization")?.name, "Harbour Bakery BV", "other pages keep the publisher");
	await db.deleteFrom("_plugin_storage").where("id", "=", "race-owner").execute();
	check("content-specific and raced definitions preserved at render");

	// ---- Person preset on a root canonical page yields to a nested custom Person ----
	const presetValues = Object.fromEntries(SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => [definition.key, definition.key === "person" ? true : definition.defaultEnabled]));
	assert.equal((await call("save-admin-schema-presets", { values: presetValues, expectedRevision: (await call("admin-schema-presets", undefined, { method: "GET" })).data.revision })).data.success, true);
	assert.equal(graphOf(await render(home, "/", `${SITE}/`), "preset:person")?.["@id"], `${SITE}/#person`, "control: the preset builds the root ID");
	await db.insertInto("_plugin_storage").values({
		plugin_id: seo.id, collection: "schemas", id: "nested-owner",
		data: JSON.stringify({ storageVersion: 1, name: "Nested owner", scope: `pages:${home.id}`, enabled: true, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE}/#organization`, name: "Owner", founder: { "@type": "Person", "@id": `${SITE}/#person`, name: "Jane Baker" } }) }),
	}).execute();
	for (const mode of ["automatic", "none"]) {
		if (mode === "none") {
			const current = (await call("admin-publisher-ownership", {})).data.ownership.revision;
			assert.equal((await call("save-admin-publisher-ownership", { mode: "none", expectedRevision: current })).data.success, true);
		}
		const rendered = await render(home, "/", `${SITE}/`);
		assert.equal(graphOf(rendered, "custom:nested-owner")?.founder?.name, "Jane Baker", `${mode}: the nested custom graph is emitted whole`);
		assert.equal(graphOf(rendered, "preset:person"), undefined, `${mode}: the Person preset yields`);
		assert.equal(graphOf(rendered, "preset:organization"), undefined, `${mode}: no automatic publisher`);
	}
	await db.deleteFrom("_plugin_storage").where("id", "=", "nested-owner").execute();
	check("root canonical Person preset yields to a nested custom Person, automatic and off");

	// ---- Legacy rows with an empty or missing scope apply site-wide in preview and public output alike ----
	const legacyRow = (id, scope) => ({
		plugin_id: seo.id, collection: "schemas", id,
		data: JSON.stringify({ storageVersion: 1, name: id, ...(scope === undefined ? {} : { scope }), enabled: true, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Event", "@id": `{{canonical}}#${id}`, name: id, startDate: "2026-11-01" }) }),
	});
	await db.insertInto("_plugin_storage").values([legacyRow("legacy-empty", ""), legacyRow("legacy-missing", undefined)]).execute();
	const publicCustoms = (await render(post, "/posts/launch")).filter((item) => item.kind === "jsonld" && String(item.id).startsWith("custom:")).map((item) => item.id).sort();
	assert.deepEqual(publicCustoms, ["custom:legacy-empty", "custom:legacy-missing"], "control: public output applies both legacy rows");
	for (const entryOnly of [true, false]) {
		const preview = await call("entry-schema-preview", { ref: `posts:${post.id}`, entryOnly });
		assert.equal(preview.data.success, true, JSON.stringify(preview.data));
		const previewCustoms = preview.data.items.filter((item) => item.source === "custom" && item.emitted).map((item) => item.id).sort();
		assert.deepEqual(previewCustoms, publicCustoms, `the ${entryOnly ? "entry-scoped" : "full"} preview agrees with public output`);
	}
	await db.deleteFrom("_plugin_storage").where("id", "in", ["legacy-empty", "legacy-missing"]).execute();
	check("empty and missing scopes: scoped preview agrees with public output");

	// ---- Committed write with a lost response ----
	const beforeLoss = (await call("admin-publisher-ownership", {})).data.ownership;
	loseNextPolicyWrite = true;
	const lost = await counted(() => call("save-admin-publisher-ownership", { mode: "automatic", expectedRevision: beforeLoss.revision }));
	assert.equal(lost.value.data.error, "unconfirmed");
	assert.equal(lost.value.data.intended, "automatic");
	assert.equal(lost.writes, 1, "no automatic retry");
	const settled = await call("admin-publisher-ownership", { check: { mode: "automatic", expectedRevision: beforeLoss.revision } });
	assert.equal(settled.data.check, "matches_requested");
	check("uncertain committed write reported unconfirmed, settled by a read");

	// ---- Corrupt and unreadable policy rows ----
	const healthy = await optionRow(POLICY_ROW);
	await db.updateTable("options").set({ value: JSON.stringify({ version: 1, mode: "maybe" }), revision: "corrupt-revision" }).where("name", "=", POLICY_ROW).execute();
	const corrupt = await call("admin-publisher-ownership", {});
	assert.deepEqual([corrupt.data.ownership.state, corrupt.data.ownership.effective, corrupt.data.ownership.writable], ["corrupt", "unknown", false]);
	assert.equal((await call("save-admin-publisher-ownership", { mode: "automatic", expectedRevision: "corrupt-revision" })).data.error, "unreadable");
	assert.equal((await optionRow(POLICY_ROW)).value, JSON.stringify({ version: 1, mode: "maybe" }), "corrupt bytes are kept");
	const corruptRender = await render(about, "/about");
	assert.equal(graphOf(corruptRender, "preset:organization"), undefined, "unknown ownership adds no automatic publisher");
	assert.equal(presetPublisherFacts(corruptRender), false);
	assert.equal((await saveCustom("Owner unknown", "global", { "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "x" })).success, false, "unknown is not an opt-out");
	await db.updateTable("options").set({ value: "{not json", revision: "broken-revision" }).where("name", "=", POLICY_ROW).execute();
	const unreadable = await call("admin-publisher-ownership", {});
	assert.equal(unreadable.data.ownership.effective, "unknown");
	assert.equal((await call("save-admin-publisher-ownership", { mode: "none", expectedRevision: null })).data.error, "unreadable");
	assert.equal((await optionRow(POLICY_ROW)).value, "{not json", "unparsable bytes are kept");
	report.unparsableState = unreadable.data.ownership.state;
	await db.updateTable("options").set({ value: healthy.value, revision: healthy.revision }).where("name", "=", POLICY_ROW).execute();
	check("corrupt and unparsable policy rows: unknown, output suppressed, writes refused, bytes kept");

	// ---- Identity row and website name untouched by the policy ----
	const identityRow = await optionRow(IDENTITY_ROW);
	assert.equal(JSON.parse(identityRow.value).name, "Harbour Bakery BV", "the identity is retained");
	const settingsAfter = await call("admin-settings", {});
	assert.equal(settingsAfter.data.values.siteName, "Harbour Bakery", "the website name is unchanged");
	check("saved identity and website name preserved");

	report.result = "passed";
	console.log(JSON.stringify(report));
	console.log(`Publisher ownership passed through the published HTTP dispatcher with plugin KV and storage on EmDash ${target.versions.get("emdash")} with in-memory SQLite (${report.checks.length} check groups).`);
} finally {
	await db.destroy();
}
