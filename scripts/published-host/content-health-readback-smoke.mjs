// Content health readback proof on a migrated EmDash SQLite database from the
// selected published host. Pages are scored by a durable scan through the
// published HTTP dispatcher; the overview and stored-only score reads are then
// sent as GET requests by the production admin client (api.ts with the host's
// apiFetch and response parser) and rendered through the Content health cell
// model. Statement counts are SQL statements observed on the in-memory database.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { setFixtureContentAnalysis, setFixtureAssessmentProfile } from "./fixture-content-analysis.mjs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

if (target.name !== "native-1.3.0") {
	console.log(`Content health readback smoke skipped on ${target.name}; this check requires the native 1.3.0 target.`);
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
const { Kysely } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const { OptionsRepository, PluginStorageRepository, adaptSandboxEntry, applySeed, createContentAccess, createContentAccessWithWrite, createSettingsAccess } = await import("emdash");
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { seoPlugin } = await source("index.ts");
const { createSeoEngine } = await source("sandbox-entry.ts");
const { createNativeScoreScanSource } = await source("score-scan-native-source.ts");
const { createNativeScoreScanAcceptance } = await source("score-scan-native-acceptance.ts");
const { SEO_SCORE_VERSION, seoAnalysisPresentation, seoScoreDisplay } = await source("analysis.ts");
const { contentHealthFreshnessRefs, contentHealthScoreCell } = await source("admin-ui/overview-model.ts");

// The installed admin client's own request helper and response parser, without its editor components.
const adminEntry = new URL(import.meta.resolve("@emdash-cms/admin"));
const clientImport = readFileSync(adminEntry, "utf8").match(/import\s*\{([^}]*\bas apiFetch\b[^}]*)\}\s*from\s*"([^"]+)"/);
assert.ok(clientImport, "the installed admin exports its request helper");
const hostClient = await import(new URL(clientImport[2], adminEntry).href);
const apiFetch = hostClient[clientImport[1].match(/(\w+)\s+as\s+apiFetch\b/)[1]];
const parseApiResponse = hostClient[clientImport[1].match(/(\w+)\s+as\s+parseApiResponse\b/)[1]];
assert.equal(typeof apiFetch, "function");
assert.equal(typeof parseApiResponse, "function");
const ts = (await import("typescript")).default;
const apiUrl = new URL("packages/emdash-plugin-seo/src/admin-ui/api.ts", sourceRoot);
const compiledApi = ts.transpileModule(readFileSync(apiUrl, "utf8"), { fileName: "api.ts", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.deepEqual(compiledApi.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const requireClient = createRequire(apiUrl);
const clientModules = {
	"@emdash-cms/admin": { apiFetch, parseApiResponse },
	"@shipitseo/emdash-plugin-seo/admin-contract": await import("@shipitseo/emdash-plugin-seo/admin-contract"),
};
const client = { exports: {} };
new Function("require", "module", "exports", compiledApi.outputText)((specifier) =>
	Object.hasOwn(clientModules, specifier) ? clientModules[specifier] : requireClient(specifier), client, client.exports);
const { fetchSeoAdminOverview, fetchSeoContentScores } = client.exports;

const SITE = "https://example.com";
const API = "/_emdash/api/plugins/shipit-seo/";
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], reads: {} };
const check = (name) => report.checks.push(name);
const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
	},
});
const isWrite = ({ sql }) => /^\s*(insert|update|delete|replace)\b/i.test(sql);
const isContentRead = ({ sql }) => /^\s*select\b/i.test(sql) && /"ec_(pages|posts)"/i.test(sql);
const counted = async (action) => {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	return { value, run, queries: run.length, writes: run.filter(isWrite).length, contentReads: run.filter(isContentRead) };
};
const storedScores = async () => (await db.selectFrom("_plugin_storage").select(["id", "data"])
	.where("plugin_id", "=", "shipit-seo").where("collection", "=", "scores").execute()).map((row) => JSON.parse(row.data));

const span = (text) => ({ _type: "span", _key: `s${text.length}`, text, marks: [] });
const block = (text, style = "normal") => ({ _type: "block", _key: `b${style}${text.length}`, style, markDefs: [], children: [span(text)] });
const sentences = (word, count) => Array.from({ length: count }, (_, index) =>
	block(`Fresh ${word} is shaped by hand every morning and baked in small batches for visitors on day ${index + 1}.`));
const words = (blocks) => blocks.flatMap((item) => item.children.map((child) => child.text)).join(" ").split(/\s+/).filter(Boolean).length;
const page = (number) => {
	const word = `loaf${number}`;
	const content = [block(`${word} at Harbour Bakery`, "h1"), ...sentences(word, 3 + (number % 4))];
	assert.ok(words(content) >= 50, `page ${number} carries at least 50 words`);
	return {
		id: `page-${number}`, slug: `page-${number}`, status: "published", locale: "en",
		data: { title: `${word} baked every morning`, ...(number % 3 === 0 ? {} : { excerpt: `Fresh ${word} from the harbour bakery, shaped by hand each morning.` }), content },
	};
};
const shortContent = [block("A short note about the harbour bakery opening hours this week, with the new weekend times listed for every visitor here today.")];
assert.equal(words(shortContent), 22, "the short page carries 22 words");
const translatedContent = [block("Liman Firini ekmekleri", "h1"), ...Array.from({ length: 5 }, (_, index) =>
	block(`Taze ekmek her sabah elde sekillendirilir ve misafirler icin kucuk partiler halinde pisirilir, gun ${index + 1}.`))];
assert.ok(words(translatedContent) >= 50, "the translation carries at least 50 words");

try {
	await runMigrations(db);
	const PAGES = Array.from({ length: 12 }, (_, index) => page(index + 1));
	const TRANSLATED_SOURCE = "page-5";
	await applySeed(db, {
		version: "1",
		defaultLocale: "en",
		collections: ["pages", "posts"].map((slug) => ({
			slug, label: slug === "pages" ? "Pages" : "Posts", supports: ["drafts", "revisions", "seo"],
			urlPattern: slug === "pages" ? "/{slug}" : "/posts/{slug}", routable: true,
			fields: [{ slug: "title", label: "Title", type: "string" }, { slug: "excerpt", label: "Excerpt", type: "string" }, { slug: "content", label: "Content", type: "portableText" }],
		})),
		content: {
			pages: [
				...PAGES,
				{ id: "page-short", slug: "page-short", status: "published", locale: "en", data: { title: "Opening hours this week", excerpt: "Opening hours.", content: shortContent } },
				{ id: "page-5-tr", slug: "page-5", status: "published", locale: "tr", translationOf: TRANSLATED_SOURCE,
					data: { title: "Liman Firini taze ekmek", excerpt: "Liman Firini taze ekmekleri her sabah elde sekillendirir.", content: translatedContent } },
			],
			posts: Array.from({ length: 5 }, (_, index) => ({ ...page(index + 20), id: `post-${index}`, slug: `post-${index}` })),
		},
	}, { includeContent: true });
	const pageRows = await db.selectFrom("ec_pages").select(["id", "slug", "locale", "title", "translation_group"]).execute();
	const entry = (slug, locale = "en") => pageRows.find((row) => row.slug === slug && row.locale === locale);
	const sourcePage = entry(TRANSLATED_SOURCE);
	const translation = entry(TRANSLATED_SOURCE, "tr");
	assert.ok(sourcePage && translation && sourcePage.id !== translation.id && sourcePage.translation_group === translation.translation_group,
		"the translation is its own entry in the source's translation group");
	const sourceRef = `pages:${sourcePage.id}`;
	const translationRef = `pages:${translation.id}`;
	const shortRef = `pages:${entry("page-short").id}`;

	const descriptor = seoPlugin();
	const scoreScan = {
		openSource: async () => createNativeScoreScanSource(db),
		openAcceptance: async (ctx) => createNativeScoreScanAcceptance({
			db, pluginId: ctx.plugin.id, pluginVersion: ctx.plugin.version,
			repositories: { PluginStorageRepository, OptionsRepository, createSettingsAccess, createContentAccess },
			storage: descriptor.storage ?? {}, site: ctx.site, log: ctx.log,
		}),
	};
	const seo = adaptSandboxEntry(createSeoEngine(undefined, { scoreScan }), descriptor);
	await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
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
			const input = await parseRouteInput(request, meta?.request);
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body: input, user: caller });
		},
	};
	const admin = { id: "admin", email: "admin@example.com", name: "Admin", role: 50 };
	async function call(route, input) {
		const request = new Request(`${SITE}${API}${route}`, {
			method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" }, body: JSON.stringify(input),
		});
		const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: admin });
		const payload = JSON.parse(await response.text());
		return { status: response.status, data: payload?.data, error: payload?.error };
	}
	// Only the plugin's own routes answer the admin client; anything else stays offline.
	const clientRequests = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input), SITE);
		if (url.origin !== SITE || !url.pathname.startsWith(API)) throw new Error("External networking is disabled in this smoke check");
		const request = new Request(url, init);
		clientRequests.push({ method: request.method, route: url.pathname.slice(API.length), params: url.searchParams, csrf: request.headers.get("X-EmDash-Request") });
		return dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${url.pathname.slice(API.length)}`, request, user: admin });
	};
	const lastRequest = (route) => {
		const found = clientRequests.at(-1);
		assert.deepEqual([found?.method, found?.route, found?.csrf], ["GET", route, "1"], `the client sends one GET ${route} request`);
		return found.params;
	};

	const loaded = (await call("admin-settings", {})).data;
	const saved = await call("save-admin-settings", {
		...loaded.values, siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "organization", organizationName: "Harbour Bakery",
		organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false,
		...(loaded.revision === null ? { expectedRevision: null, expectedLegacyGuard: loaded.legacyGuard } : { expectedRevision: loaded.revision }),
	});
	assert.equal(saved.data.success, true, JSON.stringify(saved.data));
	await setFixtureContentAnalysis(call, true);
	await setFixtureAssessmentProfile(call, "pages", "general");

	// ---- A durable scan scores every published page in every locale ----
	let commands = 0;
	const commandId = () => `readback-${String(++commands).padStart(4, "0")}`;
	const started = await call("start-score-scan", {
		commandId: commandId(), replace: null, collection: "pages", status: "published", locale: null, taxonomies: [], target: { mode: "all" },
	});
	assert.equal(started.status, 200, JSON.stringify(started.error));
	assert.equal(started.data.success, true, JSON.stringify(started.data));
	let scan = started.data.scan;
	let decision = "continue";
	for (let step = 0; decision === "continue"; step += 1) {
		assert.ok(step < 40, "the scan reaches a decision");
		const result = await call("command-score-scan", { command: "continue", runId: scan.runId, expectedRevision: scan.revision, commandId: commandId() });
		assert.equal(result.status, 200, JSON.stringify(result.error));
		assert.equal(result.data.success, true, JSON.stringify(result.data));
		({ scan, decision } = result.data);
	}
	assert.deepEqual([decision, scan.state, scan.completion, scan.counters.saved], ["completed", "completed", "exhausted", 14],
		"the scan saves 12 English pages, the short page and the translation");
	const stored = new Map((await storedScores()).map((row) => [row.ref, row]));
	const numbered = [...stored.values()].filter((row) => row.collection === "pages" && seoScoreDisplay(row).score !== null).map((row) => row.ref);
	assert.equal(numbered.length, 13, "every page but the short one has a number");
	assert.ok(stored.has(shortRef) && seoScoreDisplay(stored.get(shortRef)).score === null, "control: the short page is stored without a number");
	assert.ok(![...stored.values()].some((row) => row.collection === "posts"), "posts are not scanned");
	check("a durable scan stores every published page, numbered or not, in both locales");

	// ---- (a) The overview the client reads lists exactly the numbered current pages ----
	const readOverview = async () => {
		const read = await counted(() => fetchSeoAdminOverview());
		assert.equal(lastRequest("admin-overview").toString(), "limit=50");
		assert.deepEqual([read.contentReads.length, read.writes], [0, 0], "the overview reads no entries and writes nothing");
		return read;
	};
	const overviewRead = await readOverview();
	const overview = overviewRead.value;
	report.reads.overview = { queries: overviewRead.queries, writes: overviewRead.writes, contentReads: overviewRead.contentReads.length };
	assert.equal(overview.summary.totalScored, stored.size, "the total counts every stored row");
	assert.deepEqual(overview.content.map((row) => row.ref).sort(), [...numbered].sort(), "rows are the numbered pages: no posts and not the short page");
	assert.equal(overview.summary.sampleSize, 13);
	for (const [index, row] of overview.content.entries()) {
		const record = stored.get(row.ref);
		assert.deepEqual([row.collection, row.entryId, row.score, row.updatedAt], ["pages", record.entryId, record.score, record.updatedAt], `${row.ref} is its stored row`);
		assert.deepEqual(record.assessmentProfile, { profile: "general", version: 1 }, `${row.ref} was scored as General`);
		const content = pageRows.find((item) => `pages:${item.id}` === row.ref);
		assert.deepEqual([row.title, row.title.startsWith(content.title), content.locale], [record.title, true, row.ref === translationRef ? "tr" : "en"],
			`${row.ref} is bound to its own locale entry`);
		assert.deepEqual(row.presentation, { label: "Saved analysis", qualifier: "Current content not checked", tone: "neutral" }, "stored rows make no freshness claim");
		if (index > 0) assert.ok(overview.content[index - 1].updatedAt >= row.updatedAt, "rows are the most recent first");
	}
	assert.equal(overview.summary.averageContentScore,
		Math.round(overview.content.reduce((sum, row) => sum + row.score, 0) / overview.content.length), "the average is the rounded mean of the listed rows");
	check("(a) the client's overview read lists each numbered page once with its stored score, General v1 and own locale, and reads no entry");

	// ---- (b) The stored-only check of the first rows verifies freshness without writing ----
	const readChecks = async (refs) => {
		const read = await counted(() => fetchSeoContentScores({ refs, limit: refs.length, storedOnly: true }));
		const params = lastRequest("scores");
		assert.deepEqual([params.get("refs"), params.get("storedOnly"), params.get("limit"), params.has("snapshotOnly")],
			[JSON.stringify(refs), "true", String(refs.length), false], "the stored-only check names the exact refs");
		assert.equal(read.writes, 0, "the stored-only check writes nothing");
		const ids = refs.map((ref) => ref.slice("pages:".length));
		assert.ok(read.contentReads.length > 0 && read.contentReads.every(({ parameters }) => ids.some((id) => parameters.includes(id))),
			"every entry read binds one of the requested entries");
		return { items: new Map(read.value.items.map((item) => [item.ref, item])), read };
	};
	const firstRefs = overview.content.slice(0, 10).map((row) => row.ref);
	const first = await readChecks(firstRefs);
	report.reads.storedOnly = { queries: first.read.queries, writes: first.read.writes, contentReads: first.read.contentReads.length };
	assert.deepEqual([...first.items.keys()], firstRefs);
	for (const row of overview.content.slice(0, 10)) {
		const item = first.items.get(row.ref);
		assert.deepEqual([item.freshness, item.score, item.updatedAt, item.scoreVersion], ["current", row.score, row.updatedAt, SEO_SCORE_VERSION], `${row.ref} is current`);
	}
	check("(b) the stored-only check of the first 10 rows reports each current with the same score and time and writes nothing");

	// ---- (c) Content health shows every saved number and bands only for verified rows ----
	const cellsFor = (rows, checks) => new Map(rows.map((row) => [row.ref, contentHealthScoreCell(row, checks.get(row.ref))]));
	const expectCurrent = (row, cell, item) => {
		const band = seoAnalysisPresentation(item);
		assert.deepEqual([cell.badgeText, cell.current, cell.label, cell.qualifier, cell.accessiblePrefix], [String(row.score), true, band.label, band.qualifier, null], `${row.ref} shows its band`);
		assert.ok(["success", "warning", "error"].includes(cell.variant), `${row.ref} takes its band colour`);
	};
	const expectSaved = (row, cell) => assert.deepEqual([cell.badgeText, cell.variant, cell.label, cell.qualifier, cell.accessiblePrefix, cell.current],
		[String(row.score), "secondary", "Saved analysis", "Current content not checked", "Saved score", false], `${row.ref} shows its saved score`);
	const cells = cellsFor(overview.content, first.items);
	for (const [index, row] of overview.content.entries()) {
		if (index < 10) expectCurrent(row, cells.get(row.ref), first.items.get(row.ref));
		else expectSaved(row, cells.get(row.ref));
	}
	assert.ok(![...cells.values()].some((cell) => cell.badgeText === "-"), "no listed row shows a dash");
	check("(c) checked current rows show their saved number with a band; the other rows show their saved number as a saved score");

	// ---- (d) A changed page keeps its number and asks for a refresh; the others are unchanged ----
	await setFixtureContentAnalysis(call, false);
	const contentApi = createContentAccessWithWrite(db);
	const changedBody = [block("loaf5 at Harbour Bakery", "h1"), ...sentences("rye", 6)];
	await contentApi.update("pages", sourcePage.id, { content: changedBody });
	assert.deepEqual(stored.get(sourceRef), (await storedScores()).find((row) => row.ref === sourceRef), "control: a repository write runs no plugin hook, so the stored row is unchanged");
	const changedOverview = (await readOverview()).value;
	assert.deepEqual(changedOverview.content.map(({ ref, score, updatedAt }) => ({ ref, score, updatedAt })),
		overview.content.map(({ ref, score, updatedAt }) => ({ ref, score, updatedAt })), "the overview lists the same stored rows");
	const changedRefs = contentHealthFreshnessRefs(changedOverview.content, sourceRef);
	report.sourcePosition = changedOverview.content.findIndex((row) => row.ref === sourceRef);
	const changed = await readChecks(changedRefs);
	assert.equal(changed.items.get(sourceRef).freshness, "stale", "the changed page is stale");
	const changedCells = cellsFor(changedOverview.content, changed.items);
	assert.deepEqual(changedCells.get(sourceRef), {
		badgeText: String(stored.get(sourceRef).score), variant: "secondary", label: "Analysis needs refreshing",
		qualifier: "Saved inputs or analysis version no longer match", current: false, accessiblePrefix: "Last known score",
	});
	for (const row of changedOverview.content) {
		if (row.ref === sourceRef) continue;
		if (changedRefs.includes(row.ref)) {
			assert.equal(changed.items.get(row.ref).freshness, "current", `${row.ref} is still current`);
			expectCurrent(row, changedCells.get(row.ref), changed.items.get(row.ref));
		} else expectSaved(row, changedCells.get(row.ref));
		assert.deepEqual(changedCells.get(row.ref), cells.get(row.ref), `${row.ref} is unchanged`);
	}
	check("(d) with automatic analysis paused, the stored-only check still runs: a changed page keeps its saved number and reads Analysis needs refreshing; the other rows are unchanged");

	// ---- (e) An earlier analyzer's row leaves the overview; the translation keeps its own result ----
	const earlier = changedOverview.content.find((row) => row.ref !== sourceRef && row.ref !== translationRef).ref;
	await db.updateTable("_plugin_storage").set({ data: JSON.stringify({ ...stored.get(earlier), scoreVersion: SEO_SCORE_VERSION - 1 }) })
		.where("plugin_id", "=", "shipit-seo").where("collection", "=", "scores").where("id", "=", earlier).execute();
	const laterOverview = (await readOverview()).value;
	assert.deepEqual(laterOverview.content.map((row) => row.ref), changedOverview.content.map((row) => row.ref).filter((ref) => ref !== earlier),
		"the earlier analyzer's row is not listed");
	assert.deepEqual([laterOverview.summary.sampleSize, laterOverview.summary.totalScored], [12, stored.size]);
	const pair = await readChecks([translationRef, sourceRef]);
	const translated = laterOverview.content.find((row) => row.ref === translationRef);
	assert.deepEqual([translated.entryId, translated.score, pair.items.get(translationRef).score, pair.items.get(translationRef).freshness],
		[translation.id, stored.get(translationRef).score, stored.get(translationRef).score, "current"], "the translation keeps its own ref, score and freshness");
	assert.equal(pair.items.get(sourceRef).freshness, "stale", "while its changed source is stale");
	check("(e) an earlier analyzer's page row stays out of the overview; the tr variant keeps its own ref, score and freshness after its source changed");

	assert.ok(clientRequests.every((request) => request.method === "GET"), "the admin client only reads");
	report.clientRequests = clientRequests.length;
	report.result = "passed";
	console.log(JSON.stringify(report));
	console.log(`Content health readback passed through the published HTTP dispatcher on EmDash ${target.versions.get("emdash")} with in-memory SQLite (${report.checks.length} check groups).`);
} finally {
	await db.destroy();
}
