import { reviewOutputRoot } from "./environment.mjs";
// Native indexing-defaults proof on a migrated EmDash SQLite database from the
// selected published host. Settings routes run behind the published plugin
// route registry and HTTP dispatcher with the published plugin KV; public
// metadata, installation and content hooks run with a host-created plugin
// context. The automatic IndexNow gate uses a controlled transport and never
// delivers a URL.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";
const reviewRoot = reviewOutputRoot(target);

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Indexing defaults smoke skipped on ${target.name}; this check requires a released native target.`);
	process.exit(0);
}
globalThis.fetch = async () => { throw new Error("External networking is disabled in this smoke check"); };

const host = hostPackageRoot("emdash");
const hostIndex = readFileSync(new URL("dist/index.mjs", host), "utf8");
const contextImport = hostIndex.match(/import\s*\{[^}]*PluginStorageRepository[^}]*\}\s*from\s*"(\.\/context-[^"]+\.mjs)"/);
assert.ok(contextImport, "published host must expose its compiled context module");
const contextUrl = new URL(contextImport[1], new URL("dist/", host));
const contextSource = readFileSync(contextUrl, "utf8");
const contextModule = await import(contextUrl.href);
const PluginContextFactory = contextModule[contextSource.match(/\bPluginContextFactory as ([A-Za-z_$][\w$]*)/)[1]];
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
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const SchemaRegistry = await hostDistExport("SchemaRegistry");
const ContentRepository = await hostDistExport("ContentRepository");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createSqliteSeoFixture } = await import("./sqlite-plugin-fixture.mjs");
const { readSiteIndexingFacts } = await source("settings-runtime.ts");
const { setupIndexNow } = await source("indexnow-setup.ts");
const { publicIndexNowKey, updateIndexNowSettings, readIndexNowSettings } = await source("indexnow-runtime.ts");

const SITE = "https://example.com";
const GLOBAL = "plugin:shipit-seo:settings:global:v1";
const LEGACY_NOINDEX = "plugin:shipit-seo:settings:noindex";
// The global record and the eight legacy keys it superseded.
const SETTINGS_KEYS = new Set([GLOBAL, ...["siteName", "siteUrl", "orgName", "orgLogo", "sameAs", "defaultOgImage", "twitterHandle", "noindex"]
	.map((key) => `plugin:shipit-seo:settings:${key}`)]);

const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
	},
});
const counted = async (action) => {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	return {
		value,
		queries: run.length,
		writes: run.filter((item) => /^\s*(insert|update|delete|replace)\b/i.test(item.sql)).length,
		settingsReads: run.filter((item) => /^\s*select\b/i.test(item.sql) &&
			item.parameters.some((parameter) => SETTINGS_KEYS.has(parameter))).length,
	};
};
const budget = ({ queries, writes, settingsReads }) => ({ queries, writes, settingsReads });
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], requests: {} };
const check = (name) => report.checks.push(name);

const people = {
	editor: { id: "editor", email: "editor@example.com", name: "Editor", role: 40 },
	admin: { id: "admin", email: "admin@example.com", name: "Admin", role: 50 },
};

const historicalSeed = {
	version: 1,
	updatedAt: "2026-08-01T00:00:00.000Z",
	siteName: "Shipit Digital",
	siteUrl: "",
	organizationName: "Shipit Digital",
	organizationLogo: "",
	socialProfiles: [
		"https://www.instagram.com/shipitdigital.nl/",
		"https://www.linkedin.com/company/shipitdigital/",
		"https://www.tiktok.com/@shipit.digital",
		"https://www.facebook.com/profile.php?id=61580257498746",
	],
	defaultSocialImage: "",
	twitterHandle: "",
	noindex: false,
};
const savedRecord = (noindex, extra = {}) => ({
	version: 1, updatedAt: "2026-09-01T00:00:00.000Z",
	siteName: "Example", siteUrl: SITE, publisherType: "organization", organizationName: "Example",
	organizationLogo: "", personName: "", socialProfiles: [], personProfiles: [], defaultSocialImage: "",
	twitterHandle: "", noindex, contentScoringEnabled: true, ...extra,
});

async function row(name) {
	return (await db.selectFrom("options").select(["value", "revision"]).where("name", "=", name).executeTakeFirst()) ?? null;
}
async function putRow(name, value, revision) {
	await db.deleteFrom("options").where("name", "=", name).execute();
	await db.insertInto("options").values({ name, value: JSON.stringify(value), revision }).execute();
	return row(name);
}
const dropRow = (name) => db.deleteFrom("options").where("name", "=", name).execute();
const optionCount = async () => Number((await db.selectFrom("options").select(db.fn.countAll().as("count")).executeTakeFirst()).count);

try {
	await runMigrations(db);
	const seo = createSqliteSeoFixture(db);
	await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
	const schema = new SchemaRegistry(db);
	for (const [slug, label, urlPattern] of [["pages", "Pages", "/{slug}"], ["posts", "Posts", "/posts/{slug}"]]) {
		await schema.createCollection({ slug, label, hasSeo: true, routable: true, urlPattern });
		await schema.createField(slug, { slug: "title", label: "Title", type: "string" });
	}
	const content = new ContentRepository(db);
	const created = {};
	for (const [type, slug, title] of [
		["pages", "about", "About"],
		["posts", "launch", "Launch notes"],
		["posts", "private-note", "Private note"],
		["pages", "gate-absent", "Gate absent"],
		["pages", "gate-true", "Gate true"],
		["pages", "gate-legacy-false", "Gate legacy false"],
		["pages", "gate-corrupt", "Gate corrupt"],
		["pages", "gate-unreadable", "Gate unreadable"],
		["pages", "gate-rule", "Gate rule"],
	]) created[slug] = await content.create({ type, slug, data: { title }, status: "published", locale: "en" });
	// The entry's own core noindex, which Shipit must keep whatever its own preference.
	await db.insertInto("_emdash_seo").values({
		collection: "posts", content_id: created["private-note"].id, seo_no_index: 1,
		seo_canonical: null, seo_image: null, updated_at: "2026-09-01 10:00:00",
	}).execute();

	const routeOptions = { db, siteInfo: { siteUrl: SITE, siteName: "Example" }, cronReschedule() {} };
	const registry = new PluginRouteRegistry(routeOptions);
	registry.register(seo);
	const runtime = {
		getPluginRouteMeta(pluginId, path) {
			const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
			return route ? buildRouteMeta(route) : null;
		},
		async handlePluginApiRoute(pluginId, _method, path, request, caller) {
			let body;
			try {
				body = await parseRouteInput(request, this.getPluginRouteMeta(pluginId, path)?.request);
			} catch (error) {
				if (typeof error?.status === "number") return { success: false, status: error.status, error: { code: "INVALID_PLUGIN_REQUEST", message: error.message } };
				throw error;
			}
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
		},
	};
	async function call(route, body, { user = people.admin, csrf = true } = {}) {
		const init = body === undefined
			? { method: "GET", headers: csrf ? { "X-EmDash-Request": "1" } : {} }
			: { method: "POST", headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) }, body: JSON.stringify(body) };
		const request = new Request(`${SITE}/_emdash/api/plugins/shipit-seo/${route}`, init);
		const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: user ?? undefined });
		const payload = await response.json();
		return { status: response.status, data: payload?.data, error: payload?.error };
	}
	const factory = new PluginContextFactory(routeOptions);
	const pluginCtx = factory.createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
	const warnings = [];
	const realWarn = pluginCtx.log.warn.bind(pluginCtx.log);
	pluginCtx.log.warn = (message, detail) => {
		warnings.push({ message, detail });
		realWarn(message, detail);
	};
	const page = (entry, type) => ({
		url: `${SITE}/${type === "posts" ? "posts/" : ""}${entry.slug}`, path: `/${entry.slug}`, locale: null, kind: "content",
		pageType: type === "posts" ? "article" : "website", title: entry.data.title, pageTitle: entry.data.title,
		description: null, canonical: null, image: null,
		content: { collection: type, id: entry.id, slug: entry.slug }, seo: {}, siteName: "Example", siteUrl: SITE,
	});
	const aboutPage = page(created.about, "pages");
	const launchPage = page(created.launch, "posts");
	const privatePage = page(created["private-note"], "posts");
	const render = async (target, ctx = pluginCtx) => (await seo.hooks["page:metadata"].handler({ page: target }, ctx)) ?? [];
	const robotsOf = (contributions) => contributions.filter((item) => item.kind === "meta" && item.name === "robots").map((item) => item.content);
	const robotsFor = async () => ({
		about: robotsOf(await render(aboutPage)),
		launch: robotsOf(await render(launchPage)),
		private: robotsOf(await render(privatePage)),
	});
	const loaded = async () => (await call("admin-settings")).data;
	const guardOf = (settings) => settings.revision === null
		? { expectedRevision: null, expectedLegacyGuard: settings.legacyGuard }
		: { expectedRevision: settings.revision };

	// ---- Permissions -----------------------------------------------------------
	assert.equal((await call("admin-settings", undefined, { user: null })).status, 401, "anonymous readers are refused");
	for (const [route, body] of [
		["admin-settings", undefined],
		["save-admin-settings", { noindex: false, expectedRevision: null }],
		["save-content-scoring", { contentScoringEnabled: false, expectedContentScoringEnabled: true }],
		["reset-admin-settings", { expectedRevision: "r" }],
	]) {
		assert.equal((await call(route, body, { user: people.editor })).status, 403, `${route} is Administrator only`);
	}
	assert.equal((await call("save-admin-settings", { noindex: false, expectedRevision: null }, { csrf: false })).error?.code, "CSRF_REJECTED");
	check("settings routes: anonymous 401, Editor 403 on read, save, scoring and reset, missing CSRF header refused");

	// ---- Clean absence ---------------------------------------------------------
	const optionsBefore = await optionCount();
	const absentRead = await counted(() => call("admin-settings"));
	const absent = absentRead.value.data;
	assert.deepEqual([absent.state, absent.revision, absent.updatedAt, absent.values.noindex, absent.legacyPresent], ["absent", null, null, false, false]);
	assert.match(absent.legacyGuard, /^legacy-v1:[0-9a-f]{64}$/);
	assert.equal(absentRead.writes, 0);
	assert.equal(await optionCount(), optionsBefore, "reading absent settings writes nothing");
	report.requests.adminReadAbsent = budget(absentRead);
	const absentRender = await counted(() => render(aboutPage));
	assert.deepEqual(robotsOf(absentRender.value), [], "no plugin robots meta and no index,follow on clean absence");
	assert.ok(absentRender.value.some((item) => item.kind === "meta" && item.name === "description" || item.kind === "link"), "other metadata still renders");
	assert.equal(absentRender.writes, 0);
	assert.equal(absentRender.settingsReads, 9, "one global read and eight legacy reads while nothing is stored");
	report.requests.metadataAbsent = budget(absentRender);
	assert.deepEqual(await robotsFor(), { about: [], launch: [], private: ["noindex,nofollow"] }, "the entry's own noindex is kept");
	const absentFacts = await counted(() => readSiteIndexingFacts(pluginCtx));
	assert.deepEqual([absentFacts.value.state, absentFacts.value.noindex, absentFacts.settingsReads], ["ok", false, 3]);
	report.requests.indexingFactsAbsent = budget(absentFacts);
	check("absent: admin state absent with a legacy guard and no write; Pages and Posts carry no plugin robots meta; core entry noindex kept; 9 settings reads per render, 3 for the indexing facts");

	// ---- Installation ----------------------------------------------------------
	await seo.hooks["plugin:install"].handler({}, pluginCtx);
	assert.equal(await row(GLOBAL), null, "installation leaves the global settings absent");
	assert.deepEqual((await robotsFor()).about, [], "installation adds no restriction");
	for (const [label, value] of [["saved true", savedRecord(true)], ["corrupt", { version: 9 }], ["present null", null]]) {
		const before = await putRow(GLOBAL, value, `install-${label.replace(" ", "-")}`);
		await seo.hooks["plugin:install"].handler({}, pluginCtx);
		assert.deepEqual(await row(GLOBAL), before, `reinstall keeps a ${label} record and its revision`);
	}
	await dropRow(GLOBAL);
	check("installation and reinstall never write the global settings; existing true, corrupt and null records keep value and revision");

	// ---- Deliberate saves --------------------------------------------------------
	const values = { ...absent.values, siteUrl: SITE };
	const unguarded = await call("save-admin-settings", { ...values, noindex: true });
	assert.equal(unguarded.data.success, false, "a save without the loaded revision is refused");
	assert.equal(await row(GLOBAL), null);
	const staleLegacy = await loaded();
	await putRow(LEGACY_NOINDEX, false, "legacy-after-load");
	const legacyChanged = await call("save-admin-settings", { ...values, noindex: true, ...guardOf(staleLegacy) });
	assert.deepEqual([legacyChanged.data.success, legacyChanged.data.conflict], [false, true], "a legacy change after loading is a conflict");
	assert.equal(await row(GLOBAL), null);
	await dropRow(LEGACY_NOINDEX);
	const firstGuard = guardOf(await loaded());
	const firstSave = await counted(() => call("save-admin-settings", { ...values, noindex: true, ...firstGuard }));
	assert.equal(firstSave.value.data.success, true);
	let stored = await row(GLOBAL);
	assert.equal(JSON.parse(stored.value).indexingPreferenceConfirmed, true, "a deliberate save stores the confirmation marker");
	assert.equal(stored.revision, firstSave.value.data.settings.revision);
	report.requests.firstSave = budget(firstSave);
	assert.deepEqual(await robotsFor(), { about: ["noindex,nofollow"], launch: ["noindex,nofollow"], private: ["noindex,nofollow"] });
	const savedRender = await counted(() => render(aboutPage));
	assert.equal(savedRender.settingsReads, 1, "one settings read per render with a stored record");
	report.requests.metadataSaved = budget(savedRender);
	const stale = await call("save-admin-settings", { ...values, noindex: false, expectedRevision: "stale" });
	assert.deepEqual([stale.data.success, stale.data.conflict], [false, true]);
	assert.deepEqual(await row(GLOBAL), stored, "a stale save writes nothing");
	const liftGuard = guardOf(await loaded());
	const lift = await counted(() => call("save-admin-settings", { ...values, noindex: false, ...liftGuard }));
	assert.equal(lift.value.data.success, true);
	assert.equal(lift.writes, 1);
	report.requests.save = budget(lift);
	assert.deepEqual(await robotsFor(), { about: [], launch: [], private: ["noindex,nofollow"] }, "a saved false adds nothing and keeps core noindex");
	check("full saves need the loaded revision and legacy guard; stale and legacy-changed saves write nothing; saved true and false render exactly; the marker is stored");

	// ---- Content type rules ---------------------------------------------------------
	const ruleSave = await counted(async () => call("save-admin-settings", { ...values, noindex: false, contentTypeNoindex: ["posts"], ...guardOf(await loaded()) }));
	assert.equal(ruleSave.value.data.success, true, "a rule for an existing content type saves");
	assert.deepEqual(JSON.parse((await row(GLOBAL)).value).contentTypeNoindex, ["posts"]);
	assert.deepEqual(await robotsFor(), { about: [], launch: ["noindex,nofollow"], private: ["noindex,nofollow"] },
		"a posts rule adds noindex to every post and to no page");
	const ruledRender = await counted(() => render(launchPage));
	assert.equal(ruledRender.settingsReads, 1, "the rule reuses the one settings read per render");
	assert.equal(ruledRender.writes, 0);
	report.requests.metadataContentTypeRule = budget(ruledRender);
	const ruleRevision = (await row(GLOBAL)).revision;
	const unknownRule = await call("save-admin-settings", { ...values, contentTypeNoindex: ["missing", "posts"], ...guardOf(await loaded()) });
	assert.equal(unknownRule.data.success, false);
	assert.ok(unknownRule.data.errors.contentTypeNoindex, "a rule for a type the site lacks is refused");
	assert.equal((await row(GLOBAL)).revision, ruleRevision, "the refused rule writes nothing");
	const omitted = await call("save-admin-settings", { ...values, siteName: "Example renamed", ...guardOf(await loaded()) });
	assert.equal(omitted.data.success, true);
	assert.deepEqual(JSON.parse((await row(GLOBAL)).value).contentTypeNoindex, ["posts"], "a save that omits the field keeps the rule");
	const cleared = await call("save-admin-settings", { ...values, noindex: false, contentTypeNoindex: [], ...guardOf(await loaded()) });
	assert.equal(cleared.data.success, true);
	assert.deepEqual(await robotsFor(), { about: [], launch: [], private: ["noindex,nofollow"] }, "clearing the rule restores the earlier output and keeps core noindex");
	check("content type rules: a saved posts rule renders noindex,nofollow on posts only with one settings read; unknown types are refused without a write; omitting the field keeps it; clearing restores the output");

	// ---- Legacy and historical states ---------------------------------------------
	await dropRow(GLOBAL);
	for (const legacy of [true, false]) {
		await putRow(LEGACY_NOINDEX, legacy, `legacy-${legacy}`);
		const state = await loaded();
		assert.deepEqual([state.state, state.values.noindex], ["legacy", legacy]);
		assert.deepEqual((await robotsFor()).about, legacy ? ["noindex,nofollow"] : []);
	}
	await dropRow(LEGACY_NOINDEX);
	await putRow(GLOBAL, historicalSeed, "seed-1");
	const seedState = await loaded();
	assert.deepEqual([seedState.state, seedState.values.noindex], ["historical-seed", true]);
	assert.deepEqual((await robotsFor()).about, ["noindex,nofollow"], "the historical seed keeps its effective restriction");
	await putRow(GLOBAL, { ...historicalSeed, twitterHandle: "@near" }, "near-1");
	assert.deepEqual([(await loaded()).state, (await robotsFor()).about], ["saved", []], "a near-match is an ordinary saved false");
	await putRow(GLOBAL, savedRecord(true, { siteName: "Example", organizationName: "Example" }), "auto-seed-true");
	assert.deepEqual([(await loaded()).state, (await robotsFor()).about], ["saved", ["noindex,nofollow"]], "an earlier automatic true seed is kept");
	await putRow(GLOBAL, historicalSeed, "seed-2");
	const seedLoaded = await loaded();
	const exitSeed = await call("save-admin-settings", { ...historicalSeed, publisherType: "organization", personName: "", personProfiles: [], contentScoringEnabled: true, noindex: false, ...guardOf(seedLoaded) });
	assert.equal(exitSeed.data.success, true);
	stored = JSON.parse((await row(GLOBAL)).value);
	assert.deepEqual([stored.indexingPreferenceConfirmed, stored.siteName, stored.noindex], [true, "Shipit Digital", false]);
	assert.deepEqual([(await loaded()).state, (await robotsFor()).about], ["saved", []], "a deliberate save of the seed's own values exits the fingerprint");
	check("legacy true and false kept; exact historical seed renders noindex; near-match and automatic true seed are ordinary records; saving unchanged seed values stores the marker and leaves the fingerprint");

	// ---- Corrupt and unavailable ---------------------------------------------------
	for (const [label, name, value] of [
		["present null", GLOBAL, null],
		["unsupported version", GLOBAL, { ...savedRecord(true), version: 2 }],
		["malformed marker", GLOBAL, { ...historicalSeed, indexingPreferenceConfirmed: "yes" }],
		["wrong legacy type", LEGACY_NOINDEX, "false"],
	]) {
		await dropRow(GLOBAL);
		await dropRow(LEGACY_NOINDEX);
		const before = await putRow(name, value, `corrupt-${label.replaceAll(" ", "-")}`);
		const state = await loaded();
		assert.deepEqual([state.state, state.values], ["corrupt", null], `${label}: corrupt, no values`);
		const rendered = await render(aboutPage);
		assert.deepEqual(rendered, [], `${label}: metadata contributes nothing`);
		const results = [
			await call("save-admin-settings", { ...values, noindex: false, ...(name === GLOBAL ? { expectedRevision: before.revision } : { expectedRevision: null, expectedLegacyGuard: `legacy-v1:${"0".repeat(64)}` }) }),
			await call("save-content-scoring", { contentScoringEnabled: false, expectedContentScoringEnabled: true }),
			await call("reset-admin-settings", { expectedRevision: before.revision }),
		];
		assert.ok(results.every((result) => result.data?.success === false || result.status >= 400), `${label}: every write is refused`);
		assert.deepEqual(await row(name), before, `${label}: the record is unchanged`);
		assert.equal(name === LEGACY_NOINDEX ? await row(GLOBAL) : null, null, `${label}: no global record is created`);
	}
	await dropRow(GLOBAL);
	await dropRow(LEGACY_NOINDEX);
	assert.ok(warnings.some((item) => item.message === "seo: page metadata skipped because the site settings are unreadable" && item.detail?.state === "corrupt"));
	const unreadableCtx = { ...pluginCtx, kv: { ...pluginCtx.kv, getVersioned: async () => { throw new Error("database is locked"); } } };
	assert.deepEqual(await render(aboutPage, unreadableCtx), [], "an unreadable store contributes nothing");
	assert.ok(warnings.some((item) => item.detail?.state === "unavailable"), "the unavailable state is logged");
	const missingApiCtx = { ...pluginCtx, kv: { ...pluginCtx.kv, getVersioned: undefined } };
	assert.deepEqual(await render(aboutPage, missingApiCtx), [], "a host without versioned reads contributes nothing");
	check("present null, unsupported version, malformed marker and wrong legacy type are corrupt: no values, no metadata, every write refused, rows unchanged; thrown reads and missing versioned APIs contribute nothing and are logged");

	// ---- Scoring-only adoption -----------------------------------------------------
	const scoringAbsent = await counted(async () => call("save-content-scoring", { contentScoringEnabled: false, expectedContentScoringEnabled: true, ...guardOf(await loaded()) }));
	assert.equal(scoringAbsent.value.data.success, true);
	stored = JSON.parse((await row(GLOBAL)).value);
	assert.deepEqual([stored.noindex, stored.contentScoringEnabled, Object.hasOwn(stored, "indexingPreferenceConfirmed")], [false, false, false], "adopting an absent preference stores no restriction and no marker");
	report.requests.scoringAdoption = budget(scoringAbsent);
	await dropRow(GLOBAL);
	await putRow(LEGACY_NOINDEX, true, "legacy-scoring");
	assert.equal((await call("save-content-scoring", { contentScoringEnabled: false, expectedContentScoringEnabled: true, ...guardOf(await loaded()) })).data.success, true);
	assert.equal(JSON.parse((await row(GLOBAL)).value).noindex, true, "adopting a legacy true keeps it");
	await dropRow(LEGACY_NOINDEX);
	await putRow(GLOBAL, historicalSeed, "seed-scoring");
	assert.equal((await call("save-content-scoring", { contentScoringEnabled: false, expectedContentScoringEnabled: true, ...guardOf(await loaded()) })).data.success, true);
	stored = JSON.parse((await row(GLOBAL)).value);
	assert.deepEqual([stored.noindex, Object.hasOwn(stored, "indexingPreferenceConfirmed")], [true, false], "the historical seed is written with its effective true");
	await putRow(GLOBAL, { ...savedRecord(false), indexingPreferenceConfirmed: true }, "confirmed-scoring");
	assert.equal((await call("save-content-scoring", { contentScoringEnabled: false, expectedContentScoringEnabled: true, ...guardOf(await loaded()) })).data.success, true);
	assert.equal(JSON.parse((await row(GLOBAL)).value).indexingPreferenceConfirmed, true, "scoring keeps the marker");
	check("scoring-only changes keep absent (false), legacy true, the seed's effective true and the marker");

	// ---- Restore inherited -----------------------------------------------------------
	await putRow(GLOBAL, { ...savedRecord(true), indexingPreferenceConfirmed: true }, "reset-true");
	await putRow(LEGACY_NOINDEX, false, "reset-legacy-false");
	assert.deepEqual((await call("reset-admin-settings", { expectedRevision: "stale" })).data.conflict, true);
	assert.equal((await row(GLOBAL)).revision, "reset-true", "a stale restore writes nothing");
	const reset = await counted(() => call("reset-admin-settings", { expectedRevision: "reset-true" }));
	assert.equal(reset.value.data.success, true);
	stored = JSON.parse((await row(GLOBAL)).value);
	assert.deepEqual([stored.noindex, stored.indexingPreferenceConfirmed, stored.siteName], [true, true, "Example"], "restore keeps the loaded restriction and the marker");
	assert.equal(JSON.parse((await row(LEGACY_NOINDEX)).value), false, "restore leaves legacy keys untouched");
	assert.deepEqual((await robotsFor()).about, ["noindex,nofollow"]);
	report.requests.reset = budget(reset);
	await dropRow(GLOBAL);
	await dropRow(LEGACY_NOINDEX);
	check("restore is revision-checked, writes the inherited values with the loaded noindex and marker, and leaves legacy keys alone");

	const cronTasks = async () => Number((await sql`select count(*) as count from _emdash_cron_tasks`.execute(db)).rows[0].count);
	assert.equal(await cronTasks(), 0, "settings reads, saves, restores, installation and rendering schedule no background work");
	check("no cron task was scheduled before IndexNow automation was turned on");

	// ---- Automatic IndexNow gate ---------------------------------------------------
	const submitted = [];
	pluginCtx.http = { fetch: async (url, init) => {
		if (url === "https://api.indexnow.org/indexnow") {
			submitted.push(url);
			return new Response(null, { status: 200 });
		}
		assert.equal(url, `${SITE}/indexnow-key.txt`, "only the site's own key file is read");
		const key = await publicIndexNowKey(pluginCtx);
		const response = new Response(key.key, { headers: { "content-type": "text/plain; charset=utf-8" } });
		Object.defineProperty(response, "url", { value: url });
		return response;
	} };
	// The installation above seeded disabled IndexNow settings.
	const setup = await setupIndexNow(pluginCtx, (await readIndexNowSettings(pluginCtx)).updatedAt, async () => SITE);
	const automation = await updateIndexNowSettings(pluginCtx, (current) => ({ ...current.values, autoSubmit: true }), { expectedUpdatedAt: setup.updatedAt });
	assert.equal(automation.updated, true);
	assert.equal((await readIndexNowSettings(pluginCtx)).values.autoSubmit, true);
	const jobs = async () => (await pluginCtx.storage.indexnowJobs.query({ limit: 100 })).items.map((item) => item.data.url);
	const publish = async (slug, ctx = pluginCtx) => counted(async () => seo.hooks["content:afterPublish"].handler(
		{ collection: "pages", content: await pluginCtx.content.get("pages", created[slug].id) }, ctx));
	const gateFacts = await counted(() => readSiteIndexingFacts(pluginCtx));
	report.requests.automaticGateRead = budget(gateFacts);
	const absentEvent = await publish("gate-absent");
	assert.ok((await jobs()).includes(`${SITE}/gate-absent`), "an absent preference lets the automatic notification enqueue");
	report.requests.automaticEventAbsent = budget(absentEvent);
	await putRow(GLOBAL, { ...savedRecord(true), indexingPreferenceConfirmed: true }, "gate-true");
	const trueEvent = await publish("gate-true");
	assert.equal((await jobs()).includes(`${SITE}/gate-true`), false, "a saved restriction blocks it");
	report.requests.automaticEventRestricted = budget(trueEvent);
	await dropRow(GLOBAL);
	await putRow(LEGACY_NOINDEX, false, "gate-legacy-false");
	await publish("gate-legacy-false");
	assert.ok((await jobs()).includes(`${SITE}/gate-legacy-false`), "a legacy false lets it enqueue");
	await dropRow(LEGACY_NOINDEX);
	await putRow(GLOBAL, { version: 7 }, "gate-corrupt");
	const warningsBefore = warnings.length;
	await publish("gate-corrupt");
	assert.equal((await jobs()).includes(`${SITE}/gate-corrupt`), false, "a corrupt preference skips enqueueing");
	await dropRow(GLOBAL);
	await publish("gate-unreadable", { ...pluginCtx, kv: { ...pluginCtx.kv, getVersioned: async (key) => {
		if (key.startsWith("settings:global") || key === "settings:noindex") throw new Error("database is locked");
		return pluginCtx.kv.getVersioned(key);
	} } });
	assert.equal((await jobs()).includes(`${SITE}/gate-unreadable`), false, "an unreadable preference skips enqueueing");
	assert.deepEqual(
		warnings.slice(warningsBefore).filter((item) => item.message.startsWith("seo:indexnow automatic notification skipped")).map((item) => item.detail.state),
		["corrupt", "unavailable"],
	);
	await putRow(GLOBAL, { ...savedRecord(false), indexingPreferenceConfirmed: true, contentTypeNoindex: ["pages"] }, "gate-rule");
	await publish("gate-rule");
	assert.equal((await jobs()).includes(`${SITE}/gate-rule`), false, "a content type rule keeps that type out of automatic submission");
	await dropRow(GLOBAL);
	assert.deepEqual(submitted, [], "no URL was submitted; the queue is not delivered here");
	check("automatic IndexNow: absent and legacy false enqueue, saved true and a content type rule block, corrupt and unreadable skip with a logged state; controlled transport, nothing submitted");

	mkdirSync(new URL("indexing-defaults-review/", reviewRoot), { recursive: true });
	writeFileSync(new URL("indexing-defaults-review/native-sql-smoke.json", reviewRoot), `${JSON.stringify(report, null, 2)}\n`);
	console.log(`Native indexing defaults SQLite smoke passed: ${report.checks.length} check groups; metadata ${report.requests.metadataSaved.settingsReads} settings read stored, ${report.requests.metadataAbsent.settingsReads} absent; save ${report.requests.save.queries} queries with ${report.requests.save.writes} write.`);
} finally {
	await db.destroy();
}
