// Native durable score scan proof on a migrated EmDash SQLite database from the
// selected published host. Content, taxonomies and assignments come from the
// host seed API; every scan call goes through the published HTTP dispatcher.
// The engine is bound to this disposable database the way the native entry binds
// the runtime database, so the transaction and route contexts share one
// connection: a base-context call inside the acceptance callback would hang here.
// Statement counts are SQL statements observed on the in-memory database.
import assert from "node:assert/strict";
import { setFixtureContentAnalysis, setFixtureAssessmentProfile } from "./fixture-content-analysis.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Score scan lifecycle smoke skipped on ${target.name}; this check requires a released native target.`);
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
const { OptionsRepository, PluginStorageRepository, adaptSandboxEntry, applySeed, createContentAccess, createSettingsAccess } = await import("emdash");
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
const { SCORE_SCAN_RECORD_LIMIT_BYTES, scoreScanRecordBytes } = await source("score-scan.ts");
const { SEO_SCORE_VERSION } = await source("analysis.ts");

const SITE = "https://example.com";
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], units: {} };
const check = (name) => report.checks.push(name);
const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
	},
});
const isWrite = ({ sql }) => /^\s*(insert|update|delete|replace)\b/i.test(sql);
const storageWrite = (collection) => (entry) => isWrite(entry) && /_plugin_storage/i.test(entry.sql) && entry.parameters.includes(collection);
const counted = async (action) => {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	return { value, run, queries: run.length, writes: run.filter(isWrite).length };
};
const storageRow = async (collection, id) => (await db.selectFrom("_plugin_storage").selectAll()
	.where("plugin_id", "=", "shipit-seo").where("collection", "=", collection).where("id", "=", id).executeTakeFirst()) ?? null;
const storedScore = async (ref) => { const row = await storageRow("scores", ref); return row ? JSON.parse(row.data) : null; };
const historyCount = async (ref) => (await db.selectFrom("_plugin_storage").select("data")
	.where("plugin_id", "=", "shipit-seo").where("collection", "=", "scoreHistory").execute())
	.filter((row) => JSON.parse(row.data).ref === ref).length;

const span = (text) => ({ _type: "span", _key: `s${text.length}`, text, marks: [] });
const block = (text, style = "normal") => ({ _type: "block", _key: `b${style}${text.length}`, style, markDefs: [], children: [span(text)] });
const body = (word) => [block(`${word} at Harbour Bakery`, "h1"), ...Array.from({ length: 6 }, (_, index) =>
	block(`Fresh ${word} is shaped by hand every morning and baked in small batches for day ${index + 1}.`))];
const post = (id, status, category, region) => ({
	id, slug: id, status, taxonomies: { category: [category], region: [region] },
	data: { title: `${id} ${category} loaves baked every morning`, excerpt: `Fresh ${category} from the ${region} bakery, shaped by hand.`, content: body(category) },
});

try {
	await runMigrations(db);
	await applySeed(db, {
		version: "1",
		defaultLocale: "en",
		collections: [{
			slug: "posts", label: "Posts", supports: ["drafts", "revisions", "seo"], urlPattern: "/posts/{slug}", routable: true,
			fields: [{ slug: "title", label: "Title", type: "string" }, { slug: "excerpt", label: "Excerpt", type: "string" }, { slug: "content", label: "Content", type: "portableText" }],
		}],
		taxonomies: [
			{ name: "category", label: "Categories", hierarchical: true, collections: ["posts"], terms: [
				{ slug: "bread", label: "Bread" }, { slug: "rye", label: "Rye", parent: "bread" }, { slug: "cakes", label: "Cakes" },
			] },
			{ name: "region", label: "Regions", hierarchical: false, collections: ["posts"], terms: [{ slug: "north", label: "North" }, { slug: "south", label: "South" }] },
		],
		content: { posts: [
			post("p1", "published", "bread", "north"),
			post("p2", "published", "rye", "north"),
			post("p3", "draft", "rye", "north"),
			post("p4", "published", "cakes", "north"),
			post("p5", "published", "rye", "south"),
			post("p6", "published", "bread", "north"),
		] },
	}, { includeContent: true });
	const ids = Object.fromEntries((await db.selectFrom("ec_posts").select(["id", "slug"]).execute()).map((row) => [row.slug, row.id]));
	const term = async (taxonomy, slug) => (await db.selectFrom("taxonomies").select("id").where("name", "=", taxonomy).where("slug", "=", slug).executeTakeFirstOrThrow()).id;
	const [bread, north] = [await term("category", "bread"), await term("region", "north")];
	// Seeded IDs are ordinary ULIDs, so traversal order is the sorted ID order, not seed order.
	const inIdOrder = (...slugs) => slugs.map((slug) => ids[slug]).sort().map((id) => `posts:${id}`);
	const withDescendants = inIdOrder("p1", "p2", "p6");
	const exactTerm = inIdOrder("p1", "p6");

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
	let commands = 0;
	const commandId = () => `smoke-${String(++commands).padStart(4, "0")}`;
	const send = async (command, scan, id = commandId()) => {
		const result = await call("command-score-scan", { command, runId: scan.runId, expectedRevision: scan.revision, commandId: id });
		assert.equal(result.status, 200, JSON.stringify(result.error));
		return result.data;
	};
	const start = async (scope, replace = null) => {
		const result = await call("start-score-scan", { commandId: commandId(), replace: replace ? { runId: replace.runId, expectedRevision: replace.revision } : null, ...scope });
		assert.equal(result.status, 200, JSON.stringify(result.error));
		return result.data;
	};
	const drain = async (scan) => {
		let result = await send("continue", scan);
		for (let step = 0; result.success && result.decision === "continue"; step += 1) {
			assert.ok(step < 100, "the scan reaches a decision");
			result = await send("continue", result.scan);
		}
		assert.equal(result.success, true, JSON.stringify(result));
		return result;
	};
	const scope = (extra = {}) => ({
		collection: "posts", status: "published", locale: null, target: { mode: "count", count: 2 },
		taxonomies: [
			{ taxonomy: "category", termIds: [bread], includeDescendants: true },
			{ taxonomy: "region", termIds: [north], includeDescendants: false },
		],
		...extra,
	});
	const loaded = (await call("admin-settings", {})).data;
	const saved = await call("save-admin-settings", {
		...loaded.values, siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "organization", organizationName: "Harbour Bakery",
		organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false,
		...(loaded.revision === null ? { expectedRevision: null, expectedLegacyGuard: loaded.legacyGuard } : { expectedRevision: loaded.revision }),
	});
	assert.equal(saved.data.success, true, JSON.stringify(saved.data));

	const pending = await counted(() => start(scope()));
	assert.equal(pending.value.error, "activation_required");
	assert.equal(pending.run.filter(storageWrite("scoreScanJobs")).length, 0);
	await setFixtureContentAnalysis(call, true);
	const unconfigured = await counted(() => start(scope()));
	assert.equal(unconfigured.value.error, "profile_required");
	assert.equal(unconfigured.run.filter(storageWrite("scoreScanJobs")).length, 0);
	await setFixtureAssessmentProfile(call, "posts", "article");
	check("scan admission requires resource acknowledgement and an explicit collection profile");

	// ---- Permission, CSRF and exact input ----
	assert.equal((await call("start-score-scan", { commandId: commandId(), replace: null, ...scope() }, { user: null })).status, 401);
	assert.equal((await call("start-score-scan", { commandId: commandId(), replace: null, ...scope() }, { user: people.editor })).status, 403, "plugins:manage is required");
	assert.equal((await call("start-score-scan", { commandId: commandId(), replace: null, ...scope() }, { csrf: false })).status, 403, "the CSRF header is required");
	assert.equal((await call("start-score-scan", { commandId: commandId(), replace: null, ...scope(), cursor: "x" })).status, 400, "no client cursor");
	assert.equal((await call("command-score-scan", { command: "continue", runId: "scan-0123456789", expectedRevision: 1, commandId: commandId(), score: 100 })).status, 400, "no client score data");
	assert.equal((await call("score-scan", {})).data.scan, null, "refused requests create no run");
	check("administrator-only scan routes with CSRF and exact inputs");

	// ---- Taxonomy discovery and bounded term options ----
	const taxonomies = (await call("score-scan-taxonomies", { collection: "posts" })).data;
	const discovered = Object.fromEntries(taxonomies.taxonomies.map((item) => [item.name, item.hierarchical]));
	assert.deepEqual([discovered.category, discovered.region], [true, false], "seeded definitions attached to posts are discovered");
	const terms = (await call("score-scan-terms", { collection: "posts", taxonomy: "category", locale: "en", search: "ry", cursor: null })).data;
	assert.deepEqual(terms.terms.map((item) => item.label), ["Rye"]);
	const notAttached = (await call("score-scan-terms", { collection: "posts", taxonomy: "missing", locale: null, search: "", cursor: null })).data;
	assert.equal(notAttached.error, "invalid_selection", "a rejected selection is named, not shown as empty");
	check("taxonomy definitions and searched term pages for the selected collection");

	// ---- Scoped count run with descendants, AND across taxonomies, one entry per request ----
	const started = await start(scope());
	assert.equal(started.success, true, JSON.stringify(started));
	const first = await counted(() => send("continue", started.scan));
	assert.deepEqual([first.value.outcome.ref, first.value.outcome.status, first.value.outcome.history], [withDescendants[0], "saved", "created"]);
	// begin < job fence < score < this attempt's receipt < commit, all in the transaction that encloses the score write.
	const attemptId = first.value.outcome.attemptId;
	const jobData = (entry) => entry.parameters.find((value) => typeof value === "string" && value.startsWith("{") && value.includes('"runId"')) ?? "";
	const scoreWrite = first.run.findIndex(storageWrite("scores"));
	assert.ok(scoreWrite >= 0, "the saved unit writes its score");
	const begin = first.run.findLastIndex((entry, index) => index < scoreWrite && /^\s*begin\b/i.test(entry.sql));
	assert.ok(begin >= 0, "the score write runs inside a logged transaction");
	assert.ok(!first.run.slice(begin + 1, scoreWrite).some((entry) => /^\s*(commit|rollback)\b/i.test(entry.sql)), "no transaction ends before the score write");
	const commit = first.run.findIndex((entry, index) => index > scoreWrite && /^\s*(commit|rollback)\b/i.test(entry.sql));
	assert.ok(commit > scoreWrite && /^\s*commit\b/i.test(first.run[commit].sql), "the enclosing transaction commits");
	const inside = first.run.slice(begin + 1, commit).map((entry, offset) => ({ entry, index: begin + 1 + offset }));
	const fence = inside.find(({ entry, index }) => index < scoreWrite && storageWrite("scoreScanJobs")(entry) &&
		jobData(entry).includes(`"attempt":{"attemptId":"${attemptId}"`));
	const receipt = inside.find(({ entry, index }) => index > scoreWrite && storageWrite("scoreScanJobs")(entry) &&
		jobData(entry).includes('"attempt":null') && jobData(entry).includes(`"attemptId":"${attemptId}","admission"`));
	assert.ok(fence, "the job fence for this attempt is written inside the transaction before the score");
	assert.ok(receipt, "this attempt's terminal receipt is written inside the same transaction after the score");
	const reservation = first.run.findLastIndex((entry, index) => index < begin && storageWrite("scoreAnalysisRevisions")(entry));
	assert.ok(reservation >= 0, "the analysis reservation precedes the acceptance transaction");
	assert.ok(!first.run.slice(begin + 1, commit).some(storageWrite("scoreHistory")), "history is outside the acceptance transaction");
	report.units.saved = { queries: first.queries, writes: first.writes, transactionStatements: commit - begin + 1 };
	const replayId = commandId();
	const second = await counted(() => send("continue", first.value.scan, replayId));
	assert.deepEqual([second.value.outcome.ref, second.value.decision, second.value.scan.completion], [withDescendants[1], "completed", "target-reached"],
		"the selected count ends the run after two matching entries in ID order");
	const replay = await counted(() => send("continue", first.value.scan, replayId));
	assert.deepEqual([replay.value.replayed, replay.writes], [true, 0], "a lost response is answered from its receipt without work");
	assert.equal((await storedScore(withDescendants[1])).ref, withDescendants[1]);
	assert.equal(await historyCount(withDescendants[0]), 1);
	const reloaded = (await call("score-scan", {})).data.scan;
	assert.deepEqual([reloaded.revision, reloaded.counters.admitted, reloaded.counters.saved], [second.value.scan.revision, 2, 2], "progress survives a reload");
	const record = await storageRow("scoreScanJobs", "current");
	assert.ok(scoreScanRecordBytes(JSON.parse(record.data)) <= SCORE_SCAN_RECORD_LIMIT_BYTES);
	check("count run over a descendant term AND a second taxonomy, one entry per request, fenced acceptance and receipt replay");

	// ---- All matching content: reuse, scoring off and on, explicit resume, stop ----
	const all = await start(scope({ target: { mode: "all" } }), reloaded);
	const reused = await counted(() => send("continue", all.scan));
	assert.deepEqual([reused.value.outcome.status, reused.value.outcome.history], ["reused", "not-attempted"]);
	assert.equal(reused.run.filter(storageWrite("scores")).length, 0, "reuse writes no score");
	report.units.reused = { queries: reused.queries, writes: reused.writes };
	for (const enabled of [false, true])
		await setFixtureContentAnalysis(call, enabled);
	const blocked = await send("continue", reused.value.scan);
	assert.deepEqual([blocked.decision, blocked.scan.pauseReason, blocked.scan.counters.admitted], ["paused", "policy-changed", 1],
		"scoring off and on between units requires an explicit resume");
	const resumed = await send("resume", blocked.scan);
	const next = await send("continue", resumed.scan);
	assert.equal(next.outcome.ref, withDescendants[1]);
	// A run that analyzer 20 started carries no analyzer stamp in the stored record.
	const { scoreVersion: runAnalyzer, ...earlierRun } = JSON.parse((await storageRow("scoreScanJobs", "current")).data);
	assert.equal(runAnalyzer, SEO_SCORE_VERSION, "a run records the analyzer that started it");
	assert.ok(earlierRun.outcomes.some((outcome) => outcome.score !== null), "control: the run holds a shown outcome number");
	await db.updateTable("_plugin_storage").set({ data: JSON.stringify(earlierRun) })
		.where("plugin_id", "=", "shipit-seo").where("collection", "=", "scoreScanJobs").where("id", "=", "current").execute();
	const crossed = await counted(() => send("continue", next.scan));
	assert.deepEqual([crossed.value.decision, crossed.value.scan.pauseReason, crossed.value.scan.counters.admitted],
		["paused", "policy-changed", next.scan.counters.admitted], "a run crossing the analyzer upgrade pauses before admitting another entry");
	assert.equal(crossed.run.filter(storageWrite("scores")).length, 0, "the upgrade pause analyzes nothing");
	assert.ok(crossed.value.scan.outcomes.every((outcome) => outcome.score === null), "outcome numbers from the earlier analyzer are dropped");
	assert.equal(JSON.parse((await storageRow("scoreScanJobs", "current")).data).scoreVersion, SEO_SCORE_VERSION, "the pause restamps the current analyzer");
	const resumedAfterUpgrade = await send("resume", crossed.value.scan);
	assert.equal(resumedAfterUpgrade.scan.state, "running", "one explicit resume continues the restamped run");
	const stopped = await send("stop", resumedAfterUpgrade.scan);
	assert.deepEqual([stopped.decision, stopped.scan.state], ["stopped", "stopped"]);
	assert.equal((await send("continue", stopped.scan)).error, "not_running");
	assert.equal((await storedScore(withDescendants[0])).ref, withDescendants[0], "stopping keeps saved scores");
	check("all mode reuses scores, pauses on a changed scoring policy or analyzer, resumes only explicitly and stops with confirmation");

	// ---- Membership: the descendant matches only when selected; draft, other category and other region never match ----
	const full = await start(scope({ target: { mode: "all" } }), stopped.scan);
	const fullDone = await drain(full.scan);
	assert.deepEqual(fullDone.scan.outcomes.map((outcome) => outcome.ref), withDescendants, "the rye child of bread matches with descendants");
	assert.ok(!fullDone.scan.outcomes.some((outcome) => [ids.p3, ids.p4, ids.p5].some((id) => outcome.ref === `posts:${id}`)));
	const exact = await start(scope({ target: { mode: "all" }, taxonomies: [{ taxonomy: "category", termIds: [bread], includeDescendants: false }] }), fullDone.scan);
	const exactDone = await drain(exact.scan);
	assert.deepEqual(exactDone.scan.outcomes.map((outcome) => outcome.ref), exactTerm, "without descendants only the selected term group matches");
	assert.equal(exactDone.scan.completion, "exhausted");
	check("descendants are included only when selected; status, category and region filters exclude the others");

	report.result = "passed";
	console.log(JSON.stringify(report));
	console.log(`Score scan lifecycle passed through the published HTTP dispatcher on EmDash ${target.versions.get("emdash")} with in-memory SQLite (${report.checks.length} check groups).`);
} finally {
	await db.destroy();
}
