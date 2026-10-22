// Native saved score lifecycle proof on a migrated EmDash SQLite database from
// the selected published host. Every route call goes through the published HTTP
// dispatcher, which checks the user, the declared permission and the CSRF header
// before a handler runs; responses go through the admin parser. Query and write
// counts are SQL statements observed on the disposable in-memory database.
import assert from "node:assert/strict";
import { setFixtureContentAnalysis, setFixtureAssessmentProfile } from "./fixture-content-analysis.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Saved score lifecycle smoke skipped on ${target.name}; this check requires a released native target.`);
	process.exit(0);
}
let providerRequests = 0;
globalThis.fetch = async () => { providerRequests += 1; throw new Error("External networking is disabled in this smoke check"); };

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
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createPlugin } = await source("native-entry.ts");
const { SEO_SCORE_VERSION } = await source("analysis.ts");
const { parseSeoAdminContentScores, parseSeoAdminSavedAnalysisResult } = await source("admin-ui/contract.ts");

const SITE = "https://example.com";
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], queries: {} };
const check = (name) => report.checks.push(name);
const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
	},
});
const isWrite = ({ sql }) => /^\s*(insert|update|delete|replace)\b/i.test(sql);
const SCORE_COLLECTIONS = ["scores", "scoreHistory", "scoreAnalysisRevisions", "analysisProfiles"];
const counted = async (action) => {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	const scoreWrites = Object.fromEntries(SCORE_COLLECTIONS.map((name) => [name,
		run.filter((entry) => isWrite(entry) && /_plugin_storage/i.test(entry.sql) && entry.parameters.includes(name)).length]));
	return {
		value, run, queries: run.length, writes: run.filter(isWrite).length, scoreWrites,
		contentReads: run.filter(({ sql }) => /^\s*select\b/i.test(sql) && /from "ec_(posts|pages)"/i.test(sql)).length,
		contentScans: run.filter(({ sql }) => /from "ec_(posts|pages)"/i.test(sql) && !/where/i.test(sql)).length,
	};
};
// Every content statement of a saved-entry path binds that entry's exact ID; a
// status- or locale-filtered page would have a WHERE clause and still fail here.
const exactContentReads = (counted, id) => {
	const content = counted.run.filter(({ sql }) => /"ec_(posts|pages)"/i.test(sql));
	return content.length > 0 && content.every(({ parameters }) => parameters.includes(id));
};
// The entry's custom schema rules come from exactly the two scoped queries: the
// global, collection and entry scopes, and legacy rows without a scope.
const scopedSchemaReads = (counted, collection, id) => {
	const reads = counted.run.filter(({ sql, parameters }) => /^\s*select\b/i.test(sql) && /"_plugin_storage"/i.test(sql) && parameters.includes("schemas"));
	const scoped = ({ parameters }) => ["global", collection, `${collection}:${id}`].every((scope) => parameters.includes(scope));
	const legacy = ({ sql, parameters }) => /is null/i.test(sql) && !parameters.includes("global");
	return reads.some(scoped) && reads.some(legacy) && reads.every((read) => scoped(read) || legacy(read));
};
const measure = (run) => ({ queries: run.queries, writes: run.writes, contentReads: run.contentReads, scoreWrites: run.scoreWrites });
const noScoreWrites = { scores: 0, scoreHistory: 0, scoreAnalysisRevisions: 0, analysisProfiles: 0 };
const storageRow = async (collection, id) => (await db.selectFrom("_plugin_storage").selectAll()
	.where("plugin_id", "=", "shipit-seo").where("collection", "=", collection).where("id", "=", id).executeTakeFirst()) ?? null;
const storedScore = async (ref) => { const row = await storageRow("scores", ref); return row ? JSON.parse(row.data) : null; };
const historyFor = async (ref) => (await db.selectFrom("_plugin_storage").selectAll()
	.where("plugin_id", "=", "shipit-seo").where("collection", "=", "scoreHistory").execute())
	.filter((row) => JSON.parse(row.data).ref === ref);

const span = (text) => ({ _type: "span", _key: `s${text.length}`, text, marks: [] });
const block = (text, style = "normal") => ({ _type: "block", _key: `b${style}${text.length}`, style, markDefs: [], children: [span(text)] });
const body = (word) => [block(`${word} at Harbour Bakery`, "h1"), ...Array.from({ length: 6 }, (_, index) =>
	block(`Fresh ${word} is shaped by hand every morning and baked in small batches for day ${index + 1}.`))];
const excerpt = "Fresh sourdough and pastries baked every morning at Harbour Bakery, shaped by hand and sold the same day.";

try {
	await runMigrations(db);
	const seo = createPlugin();
	await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
	const schema = new SchemaRegistry(db);
	for (const [collection, label] of [["posts", "Posts"], ["pages", "Pages"]]) {
		await schema.createCollection({ slug: collection, label, hasSeo: true, routable: true, urlPattern: `/${collection}/{slug}`, supports: ["drafts", "revisions"] });
		for (const [slug, fieldLabel, type] of [["title", "Title", "string"], ["excerpt", "Excerpt", "string"], ["content", "Content", "portableText"], ["focus_keyword", "Focus keyword", "string"]])
			await schema.createField(collection, { slug, label: fieldLabel, type });
	}
	const content = new ContentRepository(db);
	const create = (slug, keyword, extra = {}) => content.create({
		type: "posts", slug, status: "published", locale: "en",
		data: { title: `${keyword} baked every morning by hand`, excerpt, content: body(keyword), focus_keyword: keyword, ...extra },
	});

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
			let input;
			try {
				input = await parseRouteInput(request, meta?.request);
			} catch (error) {
				if (typeof error?.status === "number") return { success: false, status: error.status, error: { code: "INVALID_PLUGIN_REQUEST", message: error.message } };
				throw error;
			}
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body: input, user: caller });
		},
	};
	const people = {
		editor: { id: "editor", email: "editor@example.com", name: "Editor", role: 40 },
		admin: { id: "admin", email: "admin@example.com", name: "Admin", role: 50 },
	};
	async function call(route, input, { user = people.admin, csrf = true } = {}) {
		const request = new Request(`${SITE}/_emdash/api/plugins/shipit-seo/${route}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) },
			body: JSON.stringify(input),
		});
		const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: user ?? undefined });
		const payload = JSON.parse(await response.text());
		return { status: response.status, data: payload?.data, error: payload?.error };
	}
	const pluginCtx = new PluginContextFactory(routeOptions).createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
	const saveSettings = async (patch) => {
		const loaded = (await call("admin-settings", {})).data;
		const result = await call("save-admin-settings", {
			...loaded.values, ...patch,
			...(loaded.revision === null ? { expectedRevision: null, expectedLegacyGuard: loaded.legacyGuard } : { expectedRevision: loaded.revision }),
		});
		assert.equal(result.data.success, true, JSON.stringify(result.data));
	};
	const setScoring = (enabled) => setFixtureContentAnalysis(call, enabled);
	await saveSettings({
		siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "organization", organizationName: "Harbour Bakery",
		organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false,
	});
	const analyzeSaved = async (ref, locale = "en", options) => {
		const result = await call("analyze-saved-content", { ref, locale }, options);
		assert.equal(result.status, 200, JSON.stringify(result.error));
		return parseSeoAdminSavedAnalysisResult(result.data, ref);
	};
	const storedOnly = async (ref, snapshotOnly) => parseSeoAdminContentScores((await call("scores", { ref, storedOnly: true, ...(snapshotOnly ? { snapshotOnly: true } : {}) })).data).items[0] ?? null;
	const listBadges = async (refs) => parseSeoAdminContentScores((await call("scores", { refs, storedOnly: true, snapshotOnly: true })).data).items;
	const optionsSnapshot = () => db.selectFrom("options").selectAll().orderBy("name").execute();
	const retainedStorage = async (ref) => (await db.selectFrom("_plugin_storage").selectAll()
		.where("plugin_id", "=", seo.id).orderBy("collection").orderBy("id").execute())
		.filter((row) => !(["scores", "scoreAnalysisRevisions"].includes(row.collection) && row.id === ref));
	const automaticBlocked = async (collection, entry, error) => {
		const ref = `${collection}:${entry.id}`;
		const audit = await counted(() => call("audit-content", { refs: [ref] }));
		assert.deepEqual([audit.value.status, audit.value.data.failures[0]?.error, audit.writes, audit.contentReads], [200, error, 0, 0]);
		const legacy = await counted(() => call("analyze-content", { collection, id: entry.id }));
		assert.deepEqual([legacy.value.status, legacy.value.data.success, legacy.value.data.error, legacy.writes, legacy.contentReads], [200, false, error, 0, 0]);
		const payload = { collection, content: await pluginCtx.content.get(collection, entry.id), isNew: false };
		const hook = await counted(() => seo.hooks["content:afterSave"].handler(payload, pluginCtx));
		assert.deepEqual(hook.scoreWrites, noScoreWrites, "an automatic hook never reserves or stores a score under the manual-only policy");
		// Real bulk admission is covered by score-scan-lifecycle-smoke.mjs with its native scan ports.
		return { audit: measure(audit), legacy: measure(legacy), hook: measure(hook) };
	};
	const manualOnly = async (collection, entry, state) => {
		const ref = `${collection}:${entry.id}`;
		const settings = (await call("admin-settings", {})).data;
		assert.equal(settings.contentScoring.state, state);
		const optionsBefore = await optionsSnapshot();
		const unrelatedBefore = await retainedStorage(ref);
		const contentBefore = await content.findById(collection, entry.id);
		assert.equal(await storedScore(ref), null, "manual-only entries start without a score");
		const manual = await counted(() => analyzeSaved(ref, entry.locale));
		assert.deepEqual([manual.value.success, manual.value.outcome, manual.value.history, manual.value.item.ref], [true, "saved", "not-attempted", ref]);
		assert.equal(manual.value.item.assessmentProfile.profile, "article", "manual analysis uses the explicitly saved assessment profile");
		assert.ok(manual.scoreWrites.scores > 0 && manual.scoreWrites.scoreAnalysisRevisions > 0);
		assert.ok(manual.run.filter(isWrite).every(({ sql, parameters }) => /_plugin_storage/i.test(sql) && parameters.includes(ref) &&
			["scores", "scoreAnalysisRevisions"].some((collection) => parameters.includes(collection))),
			"every manual write belongs only to the selected score or its reserved revision");
		assert.deepEqual([manual.scoreWrites.scoreHistory, manual.scoreWrites.analysisProfiles, manual.contentScans], [0, 0, 0]);
		assert.ok(exactContentReads(manual, entry.id) && scopedSchemaReads(manual, collection, entry.id));
		assert.equal(manual.run.some(({ sql, parameters }) => /_plugin_storage/i.test(sql) &&
			parameters.some((value) => ["scoreHistory", "operationLeases", "scoreScanJobs"].includes(value))), false,
			"manual-only acceptance does not read, append or prune history, acquire its lease, or inspect scans");
		const fresh = await counted(() => storedOnly(ref));
		assert.deepEqual([fresh.value.freshness, fresh.writes], ["current", 0]);
		assert.ok(exactContentReads(fresh, entry.id));
		const identity = await counted(() => call("entry-analysis-identity", { ref }));
		assert.deepEqual([identity.value.data.success, identity.value.data.identity.locale, identity.value.data.identity.sourceVersion, identity.writes],
			[true, entry.locale, manual.value.item.sourceVersion, 0]);
		assert.ok(exactContentReads(identity, entry.id));
		const reuse = await counted(() => analyzeSaved(ref, entry.locale));
		assert.deepEqual([reuse.value.outcome, reuse.value.history, reuse.writes], ["reused", "not-attempted", 0]);
		assert.ok(exactContentReads(reuse, entry.id));
		const wrongLocale = await counted(() => analyzeSaved(ref, "fr"));
		assert.deepEqual([wrongLocale.value.success, wrongLocale.value.error, wrongLocale.writes], [false, "locale_mismatch", 0]);
		assert.ok(exactContentReads(wrongLocale, entry.id));
		assert.deepEqual(await optionsSnapshot(), optionsBefore, "manual acceptance changes no setting, notice acknowledgement or saved assessment profile");
		assert.deepEqual(await retainedStorage(ref), unrelatedBefore, "history and every unrelated plugin row remain byte-identical");
		assert.deepEqual(await content.findById(collection, entry.id), contentBefore);
		assert.deepEqual(await historyFor(ref), []);
		assert.equal((await call("admin-settings", {})).data.contentScoring.state, state);
		assert.equal(providerRequests, 0);
		report.queries[`manual-${state}`] = { saved: measure(manual), freshness: measure(fresh), identity: measure(identity), reuse: measure(reuse) };
	};

	// ---- Permission, CSRF and strict input on the durable saved action ----
	const first = await create("first-loaf", "sourdough");
	const firstRef = `posts:${first.id}`;
	assert.equal((await call("analyze-saved-content", { ref: firstRef, locale: "en" }, { user: null })).status, 401);
	assert.equal((await call("analyze-saved-content", { ref: firstRef, locale: "en" }, { user: people.editor })).status, 403, "plugins:manage is required");
	assert.equal((await call("analyze-saved-content", { ref: firstRef, locale: "en" }, { csrf: false })).status, 403, "the CSRF header is required");
	for (const input of [{ ref: firstRef }, { ref: firstRef, locale: "en", keyword: "trial" }, { ref: firstRef, locale: "en", snapshot: { data: {} } }])
		assert.equal((await call("analyze-saved-content", input)).status, 400, `strict input refuses ${JSON.stringify(Object.keys(input))}`);
	assert.equal(await storedScore(firstRef), null, "refused requests store nothing");
	check("administrator-only durable action with CSRF and an exact ref and locale only");

	const pending = await counted(() => analyzeSaved(firstRef));
	assert.deepEqual([pending.value.success, pending.value.error, pending.contentReads, pending.writes], [false, "profile_required", 0, 0]);
	const pendingPage = await content.create({ type: "pages", slug: "manual-pending-page", status: "published", locale: "en",
		data: { title: "Sourdough baked every morning by hand", excerpt, content: body("sourdough"), focus_keyword: "sourdough" } });
	await setFixtureAssessmentProfile(call, "pages", "article");
	report.queries.pendingAutomaticGuards = await automaticBlocked("pages", pendingPage, "activation_required");
	await manualOnly("pages", pendingPage, "pending-confirmation");
	assert.equal((await call("admin-analysis-profile", { collection: "posts" })).data.selection.state, "unconfigured",
		"the manual-only page profile does not configure the original post fixture");
	check("pending automatic policy permits an explicit exact-locale saved page only after deliberate profile selection, without history, settings, provider or unrelated changes; hook, legacy and audit admission stay blocked");
	const enabled = await counted(() => setScoring(true));
	assert.deepEqual(enabled.scoreWrites, noScoreWrites, "activation starts no catch-up analysis");
	const unconfigured = await counted(() => analyzeSaved(firstRef));
	assert.deepEqual([unconfigured.value.error, unconfigured.contentReads, unconfigured.writes], ["profile_required", 0, 0]);
	assert.equal((await call("save-analysis-profile", { collection: "posts", profile: "article", expectedRevision: null }, { user: people.editor })).status, 403);
	assert.equal((await call("save-analysis-profile", { collection: "posts", profile: "article", expectedRevision: null }, { csrf: false })).status, 403);
	await setFixtureAssessmentProfile(call, "posts", "article");
	check("missing assessment profiles refuse before content reads or analysis writes under both pending and enabled policy");

	// ---- First durable score, visible after reload and in list reads ----
	const firstRun = await counted(() => analyzeSaved(firstRef));
	assert.deepEqual([firstRun.value.success, firstRun.value.outcome, firstRun.value.history], [true, "saved", "created"]);
	const firstStored = await storedScore(firstRef);
	assert.match(firstStored.inputIdentity, /^seo-input-v1-sha256-[0-9a-f]{64}$/);
	assert.equal(firstStored.scoreVersion, SEO_SCORE_VERSION);
	assert.equal((await historyFor(firstRef)).length, 1);
	assert.equal(firstRun.contentScans, 0, "saved analysis enumerates no content");
	assert.ok(exactContentReads(firstRun, first.id), "every content statement binds the exact entry ID");
	assert.ok(scopedSchemaReads(firstRun, "posts", first.id),
		JSON.stringify(firstRun.run.filter(({ parameters }) => parameters.includes("schemas")).map(({ sql, parameters }) => ({ sql, parameters }))));
	const wide = await counted(() => pluginCtx.content.list("posts", { limit: 5, where: { status: "published" } }));
	assert.equal(exactContentReads(wide, first.id), false, "control: a filtered page of entries fails the exact-ID check");
	const unscopedSchemas = await counted(() => pluginCtx.storage.schemas.query({ limit: 5 }));
	assert.equal(scopedSchemaReads({ run: [...firstRun.run, ...unscopedSchemas.run] }, "posts", first.id), false,
		"control: an unscoped schema query fails the scope check");
	const legacyArmOnly = firstRun.run.filter(({ sql, parameters }) => !(parameters.includes("schemas") && parameters.includes("global")));
	assert.equal(scopedSchemaReads({ run: legacyArmOnly }, "posts", first.id), false, "control: the legacy arm alone fails the scope check");
	const reloaded = await storedOnly(firstRef, true);
	assert.deepEqual([reloaded.analysisRevision, reloaded.score, "freshness" in reloaded], [firstStored.analysisRevision, firstStored.score, false],
		"a reload reads the accepted durable result as stored history");
	assert.equal((await listBadges([firstRef]))[0]?.score, firstStored.score, "the list badge read returns the saved score");
	report.queries.firstSavedScore = measure(firstRun);
	check("Analyze saved content stores an accepted result readable after reload and in list reads");

	// ---- Strict reuse: identity reads only ----
	const reuseRun = await counted(() => analyzeSaved(firstRef));
	assert.deepEqual([reuseRun.value.outcome, reuseRun.value.history], ["reused", "not-attempted"]);
	assert.equal(reuseRun.writes, 0, "unchanged inputs reserve nothing and write no score, history or profile");
	assert.ok(exactContentReads(reuseRun, first.id) && scopedSchemaReads(reuseRun, "posts", first.id), "identity reads stay exact and scoped");
	assert.equal(reuseRun.value.item.updatedAt, firstStored.updatedAt);
	assert.equal((await historyFor(firstRef)).length, 1);
	report.queries.unchangedReuse = measure(reuseRun);
	const legacyRead = await counted(() => call("scores", { ref: firstRef }));
	assert.equal(legacyRead.writes, 0, "the legacy non-stored scores read reuses unchanged inputs without writes");
	assert.ok(exactContentReads(legacyRead, first.id));
	report.queries.legacyScoresReadReuse = measure(legacyRead);
	check("unchanged inputs are reused with zero writes; identity reads are measured");

	// ---- Saved drafts and the save hook ----
	const before = await content.findById("posts", first.id);
	const revision = await new RevisionRepository(db).create({
		collection: "posts", entryId: first.id, data: { ...before.data, focus_keyword: "draft loaf", _slug: before.slug },
	});
	assert.ok(await content.replaceDraftRevision("posts", first.id, revision.id, before));
	const afterDraft = await content.findById("posts", first.id);
	assert.equal(afterDraft.updatedAt, before.updatedAt, "control: a draft save keeps updatedAt");
	const event = async () => ({ collection: "posts", content: await pluginCtx.content.get("posts", first.id), isNew: false });
	const hookRun = await counted(async () => seo.hooks["content:afterSave"].handler(await event(), pluginCtx));
	const draftStored = await storedScore(firstRef);
	assert.deepEqual([draftStored.keywords, draftStored.focusKeywordSource], [["draft loaf"], "content"], "the hook analyzes the hydrated draft's keyword");
	assert.notEqual(draftStored.sourceVersion, firstStored.sourceVersion);
	assert.ok(exactContentReads(hookRun, first.id), "the hook rereads only the exact entry");
	report.queries.draftSaveHook = measure(hookRun);
	const unchangedHook = await counted(async () => seo.hooks["content:afterSave"].handler(await event(), pluginCtx));
	assert.deepEqual(unchangedHook.scoreWrites, noScoreWrites, "an unchanged save reuses");
	report.queries.unchangedSaveHook = measure(unchangedHook);
	const staleEvent = await event();
	await content.update("posts", first.id, { data: { ...afterDraft.data, excerpt: `${excerpt} Saved again.` } });
	const staleHook = await counted(async () => seo.hooks["content:afterSave"].handler(staleEvent, pluginCtx));
	assert.deepEqual(staleHook.scoreWrites, noScoreWrites, "an out-of-date event payload is gated before any reservation");
	check("the save hook handler, called directly on published storage, rereads the exact row, hydrates the saved draft, reuses unchanged saves and gates stale payloads");

	// ---- Read-only stored freshness verification ----
	assert.equal((await analyzeSaved(firstRef)).outcome, "saved");
	const currentRead = await counted(() => storedOnly(firstRef));
	assert.deepEqual([currentRead.value.freshness, currentRead.writes], ["current", 0], "the stored score matches its exact inputs now");
	assert.ok(exactContentReads(currentRead, first.id) && scopedSchemaReads(currentRead, "posts", first.id), "verification reads stay exact and scoped");
	report.queries.storedFreshnessVerification = measure(currentRead);
	await db.insertInto("_plugin_storage").values({
		plugin_id: seo.id, collection: "overrides", id: firstRef,
		data: JSON.stringify({ ref: firstRef, robots: "noindex", updatedAt: "2026-10-03T12:00:00.000Z" }),
	}).execute();
	const staleRead = await counted(() => storedOnly(firstRef));
	assert.deepEqual([staleRead.value.freshness, staleRead.writes], ["stale", 0], "an entry legacy record change is seen by verification");
	const snapshotRead = await counted(() => storedOnly(firstRef, true));
	assert.deepEqual(["freshness" in snapshotRead.value, snapshotRead.writes, snapshotRead.contentReads], [false, 0, 0], "history reads claim nothing and read no content");
	report.queries.historyRead = measure(snapshotRead);
	// A historical record taken while templates were unreadable is readable and never current or reused.
	const historical = await create("historical-loaf", "rye");
	const historicalRef = `posts:${historical.id}`;
	assert.equal((await analyzeSaved(historicalRef)).outcome, "saved");
	const { inputIdentity: historicalIdentity, ...historicalRecord } = await storedScore(historicalRef);
	await db.updateTable("_plugin_storage").set({ data: JSON.stringify({ ...historicalRecord, inputIdentity: historicalIdentity, templateUpdatedAt: "unreadable-templates" }) })
		.where("plugin_id", "=", "shipit-seo").where("collection", "=", "scores").where("id", "=", historicalRef).execute();
	assert.equal((await storedOnly(historicalRef, true))?.templateUpdatedAt, "unreadable-templates", "the stored endpoint returns it as readable history");
	assert.equal((await listBadges([historicalRef]))[0]?.ref, historicalRef);
	assert.equal((await storedOnly(historicalRef))?.freshness, "stale");
	assert.equal((await analyzeSaved(historicalRef)).outcome, "saved", "it is recomputed, never strictly reused");
	check("stored freshness is verified per row against its own inputs without writes; history reads stay pure");

	// ---- Trial keywords stay session results ----
	const beforeTrial = await storedScore(firstRef);
	const trial = await call("analyze-content", { collection: "posts", id: first.id, keyword: "trial words" });
	assert.deepEqual([trial.data.success, trial.data.persistence], [true, "session"]);
	assert.deepEqual(await storedScore(firstRef), beforeTrial, "a trial keyword never becomes the stored score");
	check("legacy durable analysis keeps trial keywords in session mode");

	// ---- A refused persistence is a named refusal ----
	const refused = await create("refused-loaf", "spelt");
	const refusedRef = `posts:${refused.id}`;
	assert.equal((await analyzeSaved(refusedRef)).outcome, "saved");
	const { inputIdentity: _refusedIdentity, ...accepted } = await storedScore(refusedRef);
	const blocker = { ...accepted, sourceUpdatedAt: "2999-01-01T00:00:00.000Z", score: 1 };
	await db.updateTable("_plugin_storage").set({ data: JSON.stringify(blocker) })
		.where("plugin_id", "=", "shipit-seo").where("collection", "=", "scores").where("id", "=", refusedRef).execute();
	const refusedRun = await analyzeSaved(refusedRef);
	assert.deepEqual([refusedRun.success, refusedRun.error], [false, "superseded"]);
	assert.equal((await storedScore(refusedRef)).score, 1, "nothing was saved");
	const legacyRefused = await call("analyze-content", { collection: "posts", id: refused.id });
	assert.deepEqual([legacyRefused.data.success, legacyRefused.data.error], [false, "superseded"], "the legacy route reports the refusal too");
	check("refused persistence is reported as superseded, never as a saved score");

	// ---- Scoring policy through the real settings routes ----
	const offEntry = await create("off-loaf", "oat");
	const offRef = `posts:${offEntry.id}`;
	await setScoring(false);
	const offRun = await counted(() => call("analyze-content", { collection: "posts", id: offEntry.id }));
	assert.deepEqual([offRun.value.data.success, offRun.value.data.error, offRun.writes, offRun.contentReads], [false, "scoring_disabled", 0, 0]);
	const pausedManual = await create("manual-paused-loaf", "barley");
	report.queries.pausedAutomaticGuards = await automaticBlocked("posts", pausedManual, "scoring_disabled");
	await manualOnly("posts", pausedManual, "paused");
	check("paused automatic policy permits an explicit saved post and read-only verification with no history or settings changes; default automatic and hook gates remain closed");
	assert.equal((await storedOnly(firstRef, true))?.ref, firstRef, "stored history stays readable while scoring is off");
	const offHook = await counted(async () => seo.hooks["content:afterSave"].handler({ collection: "posts", content: await pluginCtx.content.get("posts", offEntry.id) }, pluginCtx));
	assert.deepEqual([offHook.scoreWrites.scores, offHook.scoreWrites.scoreAnalysisRevisions], [0, 0], "saves start no analysis while off");
	const reenable = await counted(() => setScoring(true));
	assert.deepEqual(reenable.scoreWrites, noScoreWrites, "re-enabling through the settings route starts no catch-up work");
	assert.equal(await storedScore(offRef), null);
	const settingsRow = await db.selectFrom("options").selectAll().where("name", "=", "plugin:shipit-seo:settings:global:v1").executeTakeFirst();
	await db.updateTable("options").set({ value: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), contentScoringEnabled: true }) })
		.where("name", "=", "plugin:shipit-seo:settings:global:v1").execute();
	const corruptRun = await counted(() => analyzeSaved(offRef));
	assert.deepEqual([corruptRun.value.error, corruptRun.writes], ["scoring_unavailable", 0], "a corrupt policy record admits no analysis");
	assert.equal((await storedOnly(firstRef, true))?.ref, firstRef, "stored history stays readable while the policy is unreadable");
	await db.updateTable("options").set({ value: settingsRow.value }).where("name", "=", "plugin:shipit-seo:settings:global:v1").execute();
	assert.equal((await analyzeSaved(offRef)).outcome, "saved", "control: a readable enabled policy admits analysis");
	check("automatic scoring off and an unreadable policy refuse their respective actions; history stays readable and re-enabling starts no catch-up work");

	// ---- Exact entry and locale ----
	const french = await content.create({
		type: "posts", slug: "first-loaf", status: "published", locale: "fr", translationOf: first.id,
		data: { title: "Pain au levain cuit chaque matin", excerpt, content: body("levain"), focus_keyword: "levain" },
	});
	const frenchRef = `posts:${french.id}`;
	assert.equal((await analyzeSaved(frenchRef, "en")).error, "locale_mismatch");
	assert.equal(await storedScore(frenchRef), null);
	const frenchRun = await analyzeSaved(frenchRef, "fr");
	assert.deepEqual([frenchRun.outcome, frenchRun.item.ref], ["saved", frenchRef]);
	check("each locale is its own exact entry and a mismatched locale is refused");

	assert.equal(providerRequests, 0, "no lifecycle route or hook calls a provider");
	report.providerRequests = providerRequests;
	report.result = "passed";
	console.log(JSON.stringify(report));
	console.log(`Saved score lifecycle passed through the published HTTP dispatcher on EmDash ${target.versions.get("emdash")} with in-memory SQLite (${report.checks.length} check groups).`);
} finally {
	await db.destroy();
}
