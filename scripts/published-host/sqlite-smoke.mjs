import assert from "node:assert/strict";
import { SEO_ADMIN_CONTRACT_VERSION } from "../../packages/emdash-plugin-seo/src/admin-contract.ts";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("External networking is disabled in this smoke check"); };

const host = hostPackageRoot("emdash");
const hostIndex = readFileSync(new URL("dist/index.mjs", host), "utf8");
const contextImport = hostIndex.match(/import\s*\{[^}]*PluginStorageRepository[^}]*\}\s*from\s*"(\.\/context-[^"]+\.mjs)"/);
assert.ok(contextImport, "published host must expose its compiled context module");
const contextUrl = new URL(contextImport[1], new URL("dist/", host));
const contextSource = readFileSync(contextUrl, "utf8");
const contextModule = await import(contextUrl.href);
function hostContextExport(name) {
	const alias = contextSource.match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
	assert.ok(alias && typeof contextModule[alias] === "function", `published ${name} must be callable`);
	return contextModule[alias];
}
const PluginContextFactory = hostContextExport("PluginContextFactory");
const PluginStorageRepository = hostContextExport("PluginStorageRepository");
// The host runtime creates declared plugin indexes at startup; the smoke runs
// the same published function against the SEO descriptor's storage.
async function hostDistExport(name) {
	const dist = new URL("dist/", host);
	for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const alias = readFileSync(new URL(file, dist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(new URL(file, dist).href))[alias];
	}
	return null;
}
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const { Kysely, sql } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const { setupIndexNow } = await import(new URL("packages/emdash-plugin-seo/src/indexnow-setup.ts", sourceRoot));
const {
	INDEXNOW_SETTINGS_STORAGE_KEY, buildAdminIndexNowStatus, publicIndexNowKey,
	readIndexNowSettings, updateIndexNowSettings,
} = await import(new URL("packages/emdash-plugin-seo/src/indexnow-runtime.ts", sourceRoot));
const { compareStoredValue } = await import(new URL("packages/emdash-plugin-seo/src/conditional-storage.ts", sourceRoot));
const { enqueueIndexNowUrls, deliverIndexNowQueue, listIndexNowHistory, readIndexNowHistoryUrls } =
	await import(new URL("packages/emdash-plugin-seo/src/indexnow-runtime.ts", sourceRoot));
const { seoPlugin } = await import(new URL("packages/emdash-plugin-seo/src/index.ts", sourceRoot));

const db = new Kysely({ dialect: createDialect({ url: ":memory:" }) });
try {
	const migrations = await runMigrations(db);
	assert.ok(migrations.applied.includes("077_plugin_storage_revisions"));
	const site = "https://example.com";
	const pluginId = "indexnow-validation";
	const factory = new PluginContextFactory({
		db, siteInfo: { url: site, name: "Validation site" }, cronReschedule() {},
	});
	const storage = seoPlugin().storage;
	if (syncDeclaredStorageIndexes) {
		await syncDeclaredStorageIndexes(db, [{ id: pluginId, storage }]);
		const indexes = (await sql`select name from sqlite_master where type = 'index' and name like ${`idx_plugin_${pluginId}_indexnow%`}`.execute(db)).rows
			.map((row) => row.name).sort();
		for (const expected of [
			"indexnowSubmissions_status", "indexnowSubmissions_source", "indexnowSubmissions_detail",
			"indexnowSubmissions_createdAt", "indexnowSubmissionUrls_submissionId", "indexnowJobs_status",
		]) assert.ok(indexes.includes(`idx_plugin_${pluginId}_${expected}`), `the host creates the ${expected} index`);
	} else {
		assert.ok(!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name), "the native host must expose its storage index setup");
	}
	const ctx = factory.createContext({
		id: pluginId, version: "0.0.0", capabilities: [],
		admin: {},
		storage,
		allowedHosts: [],
	});
	assert.equal(typeof ctx.kv.getVersioned, "function");
	assert.equal(typeof ctx.kv.compareAndSet, "function");
	assert.ok(ctx.cron, "native host scheduling context must be present");
	const requests = [];
	const submitted = [];
	ctx.http = { fetch: async (url, init) => {
		// Controlled transport: no request leaves the process.
		if (url === "https://api.indexnow.org/indexnow") {
			assert.equal(init.method, "POST");
			submitted.push(JSON.parse(init.body).urlList);
			return new Response(null, { status: 200 });
		}
		assert.equal(url, `${site}/indexnow-key.txt`);
		assert.equal(init.method, "GET");
		assert.equal(init.credentials, "omit");
		const key = await publicIndexNowKey(ctx);
		assert.equal(key.configured, true);
		requests.push(url);
		const response = new Response(key.key, { headers: { "content-type": "text/plain; charset=utf-8" } });
		Object.defineProperty(response, "url", { value: url });
		return response;
	} };
	const first = await setupIndexNow(ctx, null, async () => site);
	assert.equal(first.values.enabled, true);
	assert.equal(first.values.autoSubmit, false, "first activation leaves automatic submission off");
	assert.deepEqual(first.values.autoSubmitContentTypes, ["pages", "posts"]);
	assert.match(first.values.apiKey, /^[a-f0-9]{32}$/);
	assert.equal((await buildAdminIndexNowStatus(ctx, site)).readiness.state, "ready");
	const firstSnapshot = await ctx.kv.getVersioned(INDEXNOW_SETTINGS_STORAGE_KEY);
	assert.ok(firstSnapshot?.revision);
	const retried = await setupIndexNow(ctx, first.updatedAt, async () => site);
	assert.equal(retried.values.apiKey, first.values.apiKey);
	assert.notEqual((await ctx.kv.getVersioned(INDEXNOW_SETTINGS_STORAGE_KEY)).revision, firstSnapshot.revision);
	await assert.rejects(setupIndexNow(ctx, first.updatedAt, async () => site), /settings changed/);
	const saved = await updateIndexNowSettings(ctx, (current) => ({ ...current.values, batchSize: 29 }), { expectedUpdatedAt: retried.updatedAt });
	assert.equal(saved.updated, true);
	assert.equal(saved.values.batchSize, 29);
	assert.equal((await buildAdminIndexNowStatus(ctx, site)).readiness.state, "ready");
	const normalFetch = ctx.http.fetch;
	ctx.http.fetch = async (url, init) => {
		const response = await normalFetch(url, init);
		const concurrent = await ctx.kv.get(INDEXNOW_SETTINGS_STORAGE_KEY);
		await db.updateTable("options")
			.set({ value: JSON.stringify({ ...concurrent, values: { ...concurrent.values, batchSize: 33 } }) })
			.where("name", "=", `plugin:${pluginId}:${INDEXNOW_SETTINGS_STORAGE_KEY}`)
			.execute();
		return response;
	};
	await assert.rejects(setupIndexNow(ctx, saved.updatedAt, async () => site), /settings changed/);
	assert.equal((await readIndexNowSettings(ctx)).values.batchSize, 33);

	const realStore = new PluginStorageRepository(db, pluginId, "conditional-control", []);
	assert.equal(await compareStoredValue(realStore, "job", { state: "missing" }, { action: "put", value: { status: "pending" } }), true);
	assert.equal(await compareStoredValue(realStore, "job", { state: "missing" }, { action: "put", value: { status: "duplicate" } }), false);
	assert.equal(await compareStoredValue(realStore, "job", { state: "value", value: { status: "pending" } }, { action: "put", value: { status: "delivered" } }), true);
	assert.deepEqual(await realStore.get("job"), { status: "delivered" });
	assert.equal(requests.length, 3);
	assert.equal((await readIndexNowSettings(ctx)).values.apiKey, first.values.apiKey);

	// Submission history on real storage: more entries than one host page,
	// a 250-URL group with stored detail pages, and mixed-entry batches.
	for (let index = 0; index < 120; index += 1) {
		const queued = await enqueueIndexNowUrls(ctx, site, [{ url: `/history/${index}`, reason: "manual" }]);
		assert.equal(queued.history, "recorded");
	}
	const group = await enqueueIndexNowUrls(ctx, site, Array.from({ length: 250 }, (_, index) => ({ url: `/group/${index}`, reason: "manual" })));
	assert.equal(group.enqueued, 250);
	assert.equal(group.history, "recorded");
	const seen = [];
	let cursor = null;
	let pages = 0;
	do {
		const page = await listIndexNowHistory(ctx, { cursor, limit: 50 });
		assert.equal(page.available, true);
		assert.equal(page.total, 121);
		seen.push(...page.items);
		cursor = page.cursor;
		pages += 1;
	} while (cursor && pages < 10);
	assert.equal(pages, 3);
	assert.equal(cursor, null, "the final page has no cursor");
	assert.equal(new Set(seen.map((item) => item.id)).size, 121);
	assert.deepEqual(seen.map((item) => item.createdAt), seen.map((item) => item.createdAt).sort().reverse());
	const groupEntry = seen.find((item) => item.urlCount === 250);
	assert.ok(groupEntry);
	assert.equal(groupEntry.detail, "pages");
	const detailUrls = [];
	for (let page = 0; page < 3; page += 1) {
		const detail = await readIndexNowHistoryUrls(ctx, groupEntry.id, page);
		assert.equal(detail.pageCount, 3);
		detailUrls.push(...detail.items.map((item) => item.url));
	}
	assert.equal(new Set(detailUrls).size, 250);
	assert.equal(await readIndexNowHistoryUrls(ctx, groupEntry.id, 3), null);
	let drains = 0;
	while (drains < 30) {
		const delivered = await deliverIndexNowQueue(ctx, site, { force: true });
		if (!delivered.success) {
			assert.equal(delivered.error, "no_due_jobs");
			break;
		}
		assert.equal(delivered.history, "recorded");
		drains += 1;
	}
	assert.equal(submitted.flat().length, 370, "each queued URL was sent once through the controlled transport");
	assert.ok(submitted.some((batch) => batch.some((url) => url.includes("/group/")) && batch.some((url) => url.includes("/history/"))),
		"a batch carried URLs of more than one history entry");
	let settled = [];
	cursor = null;
	do {
		const page = await listIndexNowHistory(ctx, { cursor, limit: 50, status: "sent" });
		settled.push(...page.items);
		cursor = page.cursor;
	} while (cursor);
	assert.equal(settled.length, 121);
	for (const entry of settled) {
		assert.equal(entry.counts.sent, entry.urlCount);
		assert.equal(entry.lastHttpStatus, 200);
	}
	console.log("IndexNow setup and submission history passed with published EmDash native KV, PluginStorageRepository and in-memory SQLite.");
	await redirectSmoke();
	await entrySchemaSmoke();
	await schemaContentTypesSmoke();
	await businessIdentitySmoke();
} finally {
	await db.destroy();
	globalThis.fetch = originalFetch;
}


// Redirect rules: the native plugin as EmDash registers it, invoked through the
// published plugin route registry behind the published HTTP dispatcher, which
// checks the user, the session CSRF header and token scope before a handler runs.
async function redirectSmoke() {
	const RedirectRepository = await hostDistExport("RedirectRepository");
	const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
	const buildRouteMeta = await hostDistExport("buildRouteMeta");
	const parseRouteInput = await hostDistExport("parseRouteInput");
	const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
	const PluginRouteRequestError = await hostDistExport("PluginRouteRequestError");
	const handleRedirectList = await hostDistExport("handleRedirectList");
	const wouldCreateLoop = await hostDistExport("wouldCreateLoop");
	const hostPatterns = {
		compile: await hostDistExport("compilePattern"),
		match: await hostDistExport("matchPattern"),
		interpolate: await hostDistExport("interpolateDestination"),
		validate: await hostDistExport("validatePattern"),
	};
	for (const [name, value] of Object.entries({ RedirectRepository, PluginRouteRegistry, buildRouteMeta, parseRouteInput, dispatchPluginApiRequest, PluginRouteRequestError, handleRedirectList, wouldCreateLoop, ...hostPatterns })) {
		assert.equal(typeof value, "function", `published host exports ${name}`);
	}
	const { createPlugin } = await import(new URL("packages/emdash-plugin-seo/src/native-entry.ts", sourceRoot));
	const { compileRedirectPattern, createRedirectRule, interpolateRedirectDestination, reconcileRedirectRule, redirectRequestPathname } =
		await import(new URL("packages/emdash-plugin-seo/src/redirects.ts", sourceRoot));
	const { emdashRedirectHost } = await import(new URL("packages/emdash-plugin-seo/src/redirects-emdash.ts", sourceRoot));

	const redirectDb = new Kysely({ dialect: createDialect({ url: ":memory:" }) });
	try {
		await runMigrations(redirectDb);
		const site = "https://example.com";
		const seo = createPlugin();
		assert.ok(seo.capabilities.includes("redirects:write"), "the native descriptor declares redirects:write");
		const routeOptions = { db: redirectDb, siteInfo: { url: site, name: "Redirect validation" }, cronReschedule() {} };
		const registry = new PluginRouteRegistry(routeOptions);
		registry.register(seo);
		const runtime = {
			getPluginRouteMeta(pluginId, path) {
				const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
				return route ? buildRouteMeta(route) : null;
			},
			async handlePluginApiRoute(pluginId, _method, path, request, caller) {
				let body;
				try { body = await parseRouteInput(request, this.getPluginRouteMeta(pluginId, path)?.request); }
				catch (error) {
					if (error instanceof PluginRouteRequestError) return { success: false, status: error.status, error: { code: "INVALID_PLUGIN_REQUEST", message: error.message } };
					throw error;
				}
				return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
			},
		};
		const people = {
			author: { id: "author", email: "author@example.com", name: "Author", role: 30 },
			editor: { id: "editor", email: "editor@example.com", name: "Editor", role: 40 },
			admin: { id: "admin", email: "admin@example.com", name: "Admin", role: 50 },
		};
		let dispatcherRequests = 0;
		async function call(route, body, { user, csrf = true, tokenScopes, rawBody } = {}) {
			dispatcherRequests += 1;
			const request = new Request(`${site}/_emdash/api/plugins/shipit-seo/${route}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) },
				body: rawBody ?? JSON.stringify(body),
			});
			const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user, tokenScopes });
			const text = await response.text();
			const payload = JSON.parse(text);
			return { status: response.status, data: payload?.data, error: payload?.error, bytes: Buffer.byteLength(text) };
		}
		const repo = new RedirectRepository(redirectDb);
		const draft = (source, destination, type = 301) => ({ source, destination, type });

		// Authorization is the host's: no handler runs for a refused request.
		assert.equal((await call("admin-redirect-rules", {})).status, 401);
		assert.equal((await call("admin-redirect-rules", {}, { user: people.author })).status, 403);
		const editorList = await call("admin-redirect-rules", {}, { user: people.editor });
		assert.equal(editorList.status, 200);
		assert.equal(editorList.data.create, "no-permission");
		assert.equal((await call("create-admin-redirect-rule", draft("/editor", "/x"), { user: people.editor })).status, 403);
		assert.equal((await call("create-admin-redirect-rule", draft("/csrf", "/x"), { user: people.admin, csrf: false })).error?.code, "CSRF_REJECTED");
		assert.equal((await call("create-admin-redirect-rule", draft("/token", "/x"), { user: people.admin, csrf: false, tokenScopes: ["content:read"] })).error?.code, "INSUFFICIENT_SCOPE");
		const editorCheck = await call("reconcile-admin-redirect-rule", draft("/editor", "/x"), { user: people.editor });
		assert.deepEqual([editorCheck.status, editorCheck.data.status], [200, "uncertain"], "recovery is a read and absence is not final");
		assert.equal((await call("create-admin-redirect-rule", { ...draft("/x", "/y"), type: 307 }, { user: people.admin })).status, 400);
		assert.equal(await repo.findBySource("/editor"), null);
		assert.equal(await repo.findBySource("/csrf"), null);
		assert.equal(await repo.findBySource("/token"), null);

		// A 301 and a 302 become core records, the same ones the core admin lists.
		const permanent = await call("create-admin-redirect-rule", draft("/old-page", "/new-page", 301), { user: people.admin });
		const temporary = await call("create-admin-redirect-rule", draft("/sale", "/offers?from=sale", 302), { user: people.admin });
		for (const [result, type] of [[permanent, 301], [temporary, 302]]) {
			assert.equal(result.status, 200);
			assert.equal(result.data.status, "created");
			assert.equal(result.data.confirmedBy, "host");
			const stored = await repo.findBySource(result.data.rule.source);
			assert.equal(stored.id, result.data.rule.id);
			assert.equal(stored.type, type);
			assert.equal(stored.enabled, true);
			assert.equal(stored.auto, false);
		}
		const coreList = await handleRedirectList(redirectDb, { limit: 50 });
		assert.ok(coreList.success);
		assert.deepEqual(coreList.data.items.map((rule) => rule.id).sort(), [permanent.data.rule.id, temporary.data.rule.id].sort());
		const tokenCreate = await call("create-admin-redirect-rule", draft("/token-ok", "/x"), { user: people.admin, csrf: false, tokenScopes: ["admin"] });
		assert.equal(tokenCreate.data?.status, "created", "an admin-scoped token needs no session header");

		// Sources are stored as the pathname Astro hands to the middleware.
		const { createNormalizedUrl } = await import(new URL("dist/core/util/normalized-url.js", hostPackageRoot("astro")).href);
		for (const spelling of ["/caf%c3%a9", "/café", "/caf%C3%A9", "/caf%25c3%25a9", "/a//b", "/a%2fb", "/a%2Fb", "/%5Femdash/x", "/page%2Ehtml", "/a b", "/%41bc", "/a/%252e%252e/start", "/a/%255Cb", "/a%zz//b", "/%E2%82", `/x%${"25".repeat(9)}41`]) {
			const requested = new URL(spelling, site).pathname;
			assert.equal(redirectRequestPathname(requested), createNormalizedUrl(`${site}${requested}`).pathname, `Astro parity for ${spelling}`);
		}
		const escaped = await call("create-admin-redirect-rule", draft("/caf%c3%a9", "/cafe"), { user: people.admin });
		assert.equal(escaped.data.rule.source, "/caf%C3%A9");
		assert.ok(await repo.findBySource("/caf%C3%A9"));
		for (const [source, code] of [["/%5Femdash/x", "reserved-path"], ["/page%2Ehtml", "file-extension"], ["/%5Bslug%5D", "pattern"]]) {
			const rejected = await call("create-admin-redirect-rule", draft(source, "/x"), { user: people.admin });
			assert.equal(rejected.data.errors?.source?.code, code, source);
		}

		// Duplicates, trailing-slash aliases and rules the middleware never serves.
		const duplicate = await call("create-admin-redirect-rule", draft("/old-page", "/elsewhere"), { user: people.admin });
		assert.deepEqual([duplicate.data.status, duplicate.data.reason, duplicate.data.existing?.id], ["conflict", "duplicate", permanent.data.rule.id]);
		const alias = await call("create-admin-redirect-rule", draft("/old-page/", "/elsewhere"), { user: people.admin });
		assert.deepEqual([alias.data.status, alias.data.reason], ["conflict", "trailing-slash"]);
		for (const [source, code] of [["/page.html", "file-extension"], ["/_emdash/x", "reserved-path"], ["/q?x=1", "query"]]) {
			const rejected = await call("create-admin-redirect-rule", draft(source, "/x"), { user: people.admin });
			assert.equal(rejected.data.errors?.source?.code, code, source);
		}

		// Loops through a trailing slash, a query or an existing core pattern pass
		// the host's literal check but loop in the middleware.
		const core = new PluginContextFactory(routeOptions).createContext({ id: "redirect-core", version: "0.0.0", capabilities: ["redirects:write"], admin: {}, storage: {}, allowedHosts: [] }).redirects;
		await core.create({ source: "/a", destination: "/b/" });
		await core.create({ source: "/c", destination: "/d" });
		await core.create({ source: "/p/[slug]", destination: "/e/" });
		const edges = (await repo.findAllEnabled()).map((rule) => ({ ...rule }));
		assert.equal(wouldCreateLoop("/b", "/a", edges), null, "the host's literal loop check accepts /b -> /a");
		assert.equal(wouldCreateLoop("/d", "/c?x=1", edges), null, "and /d -> /c?x=1");
		assert.equal(wouldCreateLoop("/e", "/p/x", edges), null, "and /e -> /p/x");
		for (const [source, destination] of [["/b", "/a"], ["/d", "/c?x=1"], ["/e", "/p/x"]]) {
			const looped = await call("create-admin-redirect-rule", draft(source, destination), { user: people.admin });
			assert.deepEqual([looped.data.status, looped.data.reason], ["conflict", "loop"], `${source} -> ${destination}`);
			assert.equal(await repo.findBySource(source), null);
		}

		// The pattern semantics used by the chain check match the host's own.
		for (const [source, paths] of [
			["/p/[slug]", ["/p/x", "/p/x/y", "/p/", "/p/a%20b"]],
			["/docs/[...rest]", ["/docs/a", "/docs/a/b/c", "/docs/"]],
			["/a.b/[id]", ["/a.b/1", "/axb/1"]],
			["/x/[slug]y", ["/x/ay"]],
			["/x/[a]/[a]", ["/x/1/2"]],
			["/x/[...rest]/z", ["/x/1/z"]],
		]) {
			const ours = compileRedirectPattern(source);
			assert.equal(ours !== null, hostPatterns.validate(source) === null, `validity of ${source}`);
			if (!ours) continue;
			const theirs = hostPatterns.compile(source);
			for (const path of paths) {
				const match = path.match(ours.regex);
				const ourParams = match ? Object.fromEntries(ours.names.map((name, index) => [name, match[index + 1]])) : null;
				assert.deepEqual(ourParams, hostPatterns.match(theirs, path), `${source} on ${path}`);
				if (ourParams) assert.equal(interpolateRedirectDestination("/to/[...rest]/[slug]/[id]", ourParams), hostPatterns.interpolate("/to/[...rest]/[slug]/[id]", ourParams));
			}
		}

		// Pages: real cursors keep filters; the route rejects a forged cursor.
		for (let index = 0; index < 110; index += 1) {
			await core.create({ source: `/bulk/${index}`, destination: "/bulk", enabled: index % 10 !== 0, groupName: index < 15 ? "Imported" : null });
		}
		const seen = new Set();
		let cursor = null;
		let pages = 0;
		do {
			const page = await call("admin-redirect-rules", { search: "/bulk/", enabled: true, limit: 40, cursor }, { user: people.admin });
			assert.equal(page.data.status, "ok");
			assert.ok(page.data.items.every((rule) => rule.enabled && rule.source.startsWith("/bulk/")));
			for (const rule of page.data.items) seen.add(rule.id);
			cursor = page.data.cursor;
			pages += 1;
		} while (cursor && pages < 10);
		assert.deepEqual([pages, seen.size], [3, 99]);
		const grouped = await call("admin-redirect-rules", { group: "Imported", limit: 100 }, { user: people.admin });
		assert.equal(grouped.data.items.length, 15);
		const forged = await call("admin-redirect-rules", { cursor: "forged" }, { user: people.admin });
		assert.equal(forged.data.status, "invalid-cursor");

		// Uncertain writes against the real host: a create that commits and then
		// fails is confirmed by lookup; a malformed lookup page stays uncertain.
		const commitThenFail = {
			list: core.list.bind(core),
			create: async (input) => {
				await core.create(input);
				throw Object.assign(new Error("Failed to create redirect"), { code: "REDIRECT_CREATE_ERROR" });
			},
		};
		const recovered = await createRedirectRule(emdashRedirectHost({ redirects: commitThenFail }), draft("/uncertain", "/settled"));
		assert.deepEqual([recovered.status, recovered.confirmedBy], ["created", "lookup"]);
		assert.equal((await handleRedirectList(redirectDb, { search: "/uncertain", limit: 10 })).data.items.length, 1, "written once");
		const malformed = { list: async () => ({ items: [], hasMore: true }) };
		assert.equal((await reconcileRedirectRule(emdashRedirectHost({ redirects: malformed }), draft("/uncertain-2", "/x"))).status, "uncertain");
		// A check that runs before a slow create writes stays uncertain; the same
		// check confirms the rule once the original request finishes.
		let reached;
		let release;
		const waiting = new Promise((resolve) => { reached = resolve; });
		const gate = new Promise((resolve) => { release = resolve; });
		const slow = createRedirectRule(emdashRedirectHost({ redirects: {
			list: core.list.bind(core),
			create: async (input) => {
				reached();
				await gate;
				return core.create(input);
			},
		} }), draft("/slow", "/done"));
		await waiting;
		const early = await call("reconcile-admin-redirect-rule", draft("/slow", "/done"), { user: people.admin });
		assert.equal(early.data.status, "uncertain");
		release();
		assert.equal((await slow).status, "created");
		const late = await call("reconcile-admin-redirect-rule", draft("/slow", "/done"), { user: people.admin });
		assert.deepEqual([late.data.status, late.data.confirmedBy], ["created", "lookup"]);

		const editGroups = [];
		const editRequestStart = dispatcherRequests;
		if (["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
			const commands = { load: "admin-redirect-rule", update: "update-admin-redirect-rule", recover: "reconcile-admin-redirect-rule-update" };
			const counts = { get: 0, list: 0, update: 0 };
			const writes = [];
			const hostErrors = [];
			let contextMode = "full";
			const originalContext = PluginContextFactory.prototype.createContext;
			PluginContextFactory.prototype.createContext = function (...args) {
				const withoutRedirects = args[0].id === seo.id && contextMode === "no-access";
				const readOnlyRedirects = args[0].id === seo.id && contextMode === "read-only";
				const definition = withoutRedirects
					? { ...args[0], capabilities: args[0].capabilities.filter((capability) => capability !== "redirects:read" && capability !== "redirects:write") }
					: readOnlyRedirects
						? { ...args[0], capabilities: [...new Set([...args[0].capabilities.filter((capability) => capability !== "redirects:write"), "redirects:read"])] }
						: args[0];
				const ctx = originalContext.call(this, definition, ...args.slice(1));
				if (withoutRedirects) assert.equal(ctx.redirects, undefined, "the published factory exposes no redirect access without a capability");
				if (readOnlyRedirects) {
					assert.equal(typeof ctx.redirects.get, "function");
					assert.equal(typeof ctx.redirects.list, "function");
					for (const method of ["create", "update", "delete"]) assert.equal(ctx.redirects[method], undefined, "the published factory exposes no writer with only redirects:read");
				}
				if (args[0].id !== seo.id || !ctx.redirects) return ctx;
				const redirects = ctx.redirects;
				const wrapped = {
					...redirects,
					get: async (...input) => { counts.get += 1; return redirects.get(...input); },
					list: async (...input) => { counts.list += 1; return redirects.list(...input); },
					...(typeof redirects.update === "function" ? { update: async (...input) => {
						counts.update += 1;
						writes.push(input);
						try { return await redirects.update(...input); }
						catch (error) { hostErrors.push(error); throw error; }
					} } : {}),
				};
				return { ...ctx, redirects: wrapped };
			};
			const mark = () => ({ ...counts });
			const callsSince = (before) => Object.fromEntries(Object.keys(counts).map((key) => [key, counts[key] - before[key]]));
			const readOnlyCalls = { get: 1, list: 0, update: 0 };
			const noCalls = { get: 0, list: 0, update: 0 };
			const preserve = (rule) => ({ auto: rule.auto, groupName: rule.groupName, hits: rule.hits, lastHitAt: rule.lastHitAt, createdAt: rule.createdAt, isPattern: rule.isPattern });
			const edit = (loaded, changes = {}) => ({ id: loaded.rule.id, revision: loaded.revision, source: loaded.rule.source, destination: loaded.rule.destination, type: loaded.rule.type, enabled: loaded.rule.enabled, ...changes });
			const snapshot = (loaded, changes = {}) => ({
				id: loaded.rule.id, revision: loaded.revision,
				baseline: { source: loaded.rule.source, destination: loaded.rule.destination, type: loaded.rule.type, enabled: loaded.rule.enabled, isPattern: loaded.rule.isPattern, groupName: loaded.rule.groupName, auto: loaded.rule.auto },
				draft: { source: loaded.rule.source, destination: loaded.rule.destination, type: loaded.rule.type, enabled: loaded.rule.enabled, ...changes },
			});
			async function editCall(route, input, options = {}) {
				const result = await call(route, input, { user: people.admin, ...options });
				assert.ok(result.bytes <= 65_536, `${route} keeps its HTTP response within 64 KiB`);
				if (result.status === 200) assert.equal(result.data.contractVersion, SEO_ADMIN_CONTRACT_VERSION);
				return result;
			}
			async function load(id) {
				const before = mark();
				const result = await editCall(commands.load, { id });
				assert.deepEqual([result.status, result.data.status, result.data.update], [200, "loaded", "available"]);
				assert.equal(result.data.rule.id, id);
				assert.ok(typeof result.data.revision === "string" && result.data.revision.length > 0);
				assert.deepEqual(callsSince(before), readOnlyCalls);
				return result.data;
			}
			try {
				const seed = await repo.create({ source: "/edit-original", destination: "/edit-target", type: 301, enabled: true, groupName: "Edit imported", auto: true });
				await repo.recordHit(seed.id);
				let current = await load(seed.id);
				const original = current;
				assert.equal(current.rule.hits, 1);
				assert.deepEqual([current.rule.auto, current.rule.groupName], [true, "Edit imported"]);
				assert.equal(current.revision, (await core.get(seed.id))._rev, "the route carries the actual host revision");
				editGroups.push("exact-ID load");

				let before = mark();
				contextMode = "no-access";
				try {
					for (const [route, input] of [[commands.load, { id: seed.id }], [commands.update, edit(current, { type: 302 })], [commands.recover, snapshot(current, { type: 302 })]]) {
						const unavailable = await editCall(route, input);
						assert.deepEqual([unavailable.status, unavailable.data.status, unavailable.data.reason], [200, "unavailable", "no-access"]);
					}
					assert.deepEqual(callsSince(before), noCalls);
					assert.deepEqual(await repo.findById(seed.id), current.rule);
				} finally {
					contextMode = "full";
				}
				editGroups.push("published factory without redirect capabilities is unavailable");

				contextMode = "read-only";
				try {
					before = mark();
					const readOnly = await editCall(commands.load, { id: seed.id });
					assert.deepEqual([readOnly.status, readOnly.data.status, readOnly.data.update, readOnly.data.revision], [200, "loaded", "read-only", current.revision]);
					assert.deepEqual(readOnly.data.rule, current.rule);
					assert.deepEqual(callsSince(before), readOnlyCalls);
					before = mark();
					const refused = await editCall(commands.update, edit(current, { type: 302 }));
					assert.deepEqual([refused.status, refused.data.status, refused.data.reason], [200, "unavailable", "read-only"]);
					assert.deepEqual(callsSince(before), noCalls, "a missing update method refuses before preflight or any write attempt");
					before = mark();
					const readRecovery = await editCall(commands.recover, snapshot(current, { type: 302 }));
					assert.deepEqual([readRecovery.data.status, readRecovery.data.reason], ["uncertain", "pending"]);
					assert.deepEqual(callsSince(before), readOnlyCalls);
					assert.deepEqual(await repo.findById(seed.id), current.rule);
				} finally {
					contextMode = "full";
				}
				editGroups.push("published read-only capability retains reads and exposes no writer");

				before = mark();
				assert.equal((await editCall(commands.load, { id: seed.id }, { user: undefined })).status, 401);
				assert.equal((await editCall(commands.load, { id: seed.id }, { user: people.author })).status, 403);
				assert.equal((await editCall(commands.update, edit(current, { type: 302 }), { user: people.editor })).status, 403);
				assert.equal((await editCall(commands.recover, snapshot(current, { type: 302 }), { user: people.author })).status, 403);
				assert.deepEqual(callsSince(before), noCalls, "refused roles never reach ctx.redirects");
				const editorLoad = await editCall(commands.load, { id: seed.id }, { user: people.editor });
				assert.deepEqual([editorLoad.status, editorLoad.data.status, editorLoad.data.update], [200, "loaded", "no-permission"]);
				before = mark();
				const editorRecovery = await editCall(commands.recover, snapshot(current, { type: 302 }), { user: people.editor });
				assert.deepEqual([editorRecovery.status, editorRecovery.data.status, editorRecovery.data.reason], [200, "uncertain", "pending"]);
				assert.deepEqual(callsSince(before), readOnlyCalls);
				assert.deepEqual(await repo.findById(seed.id), current.rule);
				editGroups.push("dispatcher roles and read-only editor recovery");

				before = mark();
				for (const [route, input] of [[commands.load, { id: seed.id }], [commands.update, edit(current, { type: 302 })], [commands.recover, snapshot(current, { type: 302 })]]) {
					assert.equal((await editCall(route, input, { csrf: false })).error?.code, "CSRF_REJECTED");
					assert.equal((await editCall(route, input, { csrf: false, tokenScopes: ["content:read"] })).error?.code, "INSUFFICIENT_SCOPE");
				}
				assert.equal((await editCall(commands.update, edit(current, { type: 302 }), { user: people.editor, csrf: false, tokenScopes: ["admin"] })).status, 403);
				assert.deepEqual(callsSince(before), noCalls);
				assert.equal((await editCall(commands.load, { id: seed.id }, { csrf: false, tokenScopes: ["admin"] })).data.status, "loaded");
				editGroups.push("dispatcher CSRF and token scopes");

				before = mark();
				const savedSnapshot = snapshot(current, { type: 302 });
				for (const [route, input] of [
					[commands.load, { id: seed.id, source: "/edit-original" }],
					[commands.load, { id: "" }],
					[commands.load, { id: "x".repeat(129) }],
					[commands.update, { ...edit(current), groupName: "forged" }],
					[commands.update, { ...edit(current), auto: false }],
					[commands.update, { ...edit(current), hits: 0 }],
					[commands.update, { ...edit(current), revision: "x".repeat(1_025) }],
					[commands.update, { ...edit(current), source: "/" + "x".repeat(4_096) }],
					[commands.update, { ...edit(current), type: 307 }],
					[commands.update, { ...edit(current), enabled: undefined }],
					[commands.recover, { ...savedSnapshot, completed: true }],
					[commands.recover, { ...savedSnapshot, baseline: { ...savedSnapshot.baseline, hits: 0 } }],
					[commands.recover, { ...savedSnapshot, baseline: { ...savedSnapshot.baseline, isPattern: true } }],
				]) assert.equal((await editCall(route, input)).status, 400, `${route} rejects extra or out-of-bounds fields`);
				assert.equal((await editCall(commands.update, {}, { rawBody: "{" })).status, 400);
				assert.deepEqual(callsSince(before), noCalls, "strict schemas and malformed JSON stop before the handler");
				assert.deepEqual(await repo.findById(seed.id), current.rule);
				editGroups.push("strict inputs and malformed JSON");

				for (const [route, input, maxBytes, status] of [
					[commands.load, { id: seed.id }, 2_048, "loaded"],
					[commands.update, edit(current), 65_536, "unchanged"],
					[commands.recover, savedSnapshot, 98_304, "uncertain"],
				]) {
					const json = JSON.stringify(input);
					const rawBody = json + " ".repeat(maxBytes - Buffer.byteLength(json));
					assert.equal(Buffer.byteLength(rawBody), maxBytes);
					before = mark();
					const exact = await editCall(route, input, { rawBody });
					assert.deepEqual([exact.status, exact.data.status], [200, status]);
					assert.deepEqual(callsSince(before), readOnlyCalls);
					before = mark();
					const oversized = await editCall(route, input, { rawBody: rawBody + " " });
					assert.deepEqual([oversized.status, oversized.error?.code], [413, "INVALID_PLUGIN_REQUEST"]);
					assert.deepEqual(callsSince(before), noCalls, "raw bytes are refused before schema parsing or context calls");
				}
				editGroups.push("three exact raw-byte limits and overflow refusals");

				const replaced = await editCall(commands.update, edit(current, { source: "/edit-replaced", destination: "/edit-new-target?from=edit", type: 302 }));
				assert.deepEqual([replaced.status, replaced.data.status, replaced.data.confirmedBy], [200, "updated", "host"]);
				assert.equal(replaced.data.rule.id, seed.id);
				assert.notEqual(replaced.data.revision, current.revision);
				assert.deepEqual(preserve(replaced.data.rule), preserve(current.rule));
				assert.deepEqual(await repo.findById(seed.id), replaced.data.rule);
				assert.equal(await repo.findBySource(original.rule.source), null);
				const pluginEditedList = await call("admin-redirect-rules", { search: "/edit-replaced", limit: 10 }, { user: people.admin });
				assert.deepEqual(pluginEditedList.data.items.map((rule) => rule.id), [seed.id]);
				assert.deepEqual((await handleRedirectList(redirectDb, { search: "/edit-replaced", limit: 10 })).data.items.map((rule) => rule.id), [seed.id]);
				current = replaced.data;
				editGroups.push("same core ID and preserved origin/group/activity in both lists");

				before = mark();
				const unchanged = await editCall(commands.update, edit(current));
				assert.deepEqual([unchanged.data.status, unchanged.data.revision], ["unchanged", current.revision]);
				assert.deepEqual(unchanged.data.rule, current.rule);
				assert.deepEqual(callsSince(before), readOnlyCalls, "no-op does not preflight or write");
				assert.deepEqual(await repo.findById(seed.id), current.rule);
				before = mark();
				const stale = await editCall(commands.update, edit(original, { destination: "/must-not-save-stale" }));
				assert.deepEqual([stale.data.status, stale.data.reason, stale.data.current.id], ["stale", "revision", seed.id]);
				assert.deepEqual(callsSince(before), readOnlyCalls);
				assert.deepEqual(await repo.findById(seed.id), current.rule);
				editGroups.push("no-op and known stale revision make no write");

				await repo.recordHit(seed.id);
				const hit = await core.get(seed.id);
				assert.equal(hit._rev, current.revision);
				assert.equal(hit.redirect.hits, current.rule.hits + 1);
				before = mark();
				const afterHit = await editCall(commands.update, edit(current, { type: 301 }));
				assert.deepEqual([afterHit.data.status, afterHit.data.confirmedBy], ["updated", "host"]);
				assert.deepEqual([callsSince(before).get, callsSince(before).update], [1, 1]);
				assert.ok(callsSince(before).list > 0 && callsSince(before).list <= 12, "an active status change validates the bounded replacement graph");
				assert.deepEqual(preserve(afterHit.data.rule), preserve(hit.redirect));
				assert.notEqual(afterHit.data.revision, hit._rev);
				current = afterHit.data;
				editGroups.push("hits retain a usable configuration revision and are never copied back");

				before = mark();
				const disabled = await editCall(commands.update, edit(current, { enabled: false }));
				assert.deepEqual([disabled.data.status, disabled.data.rule.enabled], ["updated", false]);
				assert.deepEqual(callsSince(before), { get: 1, list: 0, update: 1 });
				assert.deepEqual(writes.at(-1), [seed.id, { _rev: current.revision, enabled: false }]);
				assert.deepEqual(preserve(disabled.data.rule), preserve(current.rule));
				const enabled = await editCall(commands.update, edit(disabled.data, { enabled: true }));
				assert.deepEqual([enabled.data.status, enabled.data.rule.enabled], ["updated", true]);
				assert.deepEqual(preserve(enabled.data.rule), preserve(disabled.data.rule));
				current = enabled.data;
				const legacySeed = await repo.create({ source: "/edit-legacy.html", destination: "/edit-legacy-target", type: 301, enabled: true });
				const legacy = await load(legacySeed.id);
				before = mark();
				const legacyDisabled = await editCall(commands.update, edit(legacy, { enabled: false }));
				assert.deepEqual([legacyDisabled.data.status, legacyDisabled.data.rule.source, legacyDisabled.data.rule.enabled], ["updated", legacy.rule.source, false]);
				assert.deepEqual(callsSince(before), { get: 1, list: 0, update: 1 });
				assert.deepEqual(writes.at(-1), [legacySeed.id, { _rev: legacy.revision, enabled: false }]);
				editGroups.push("minimal disable, re-enable and unchanged legacy-path disable");

				const graphSeed = await repo.create({ source: "/edit-graph-old", destination: "/edit-graph-new", type: 301, enabled: true });
				const graphLoaded = await load(graphSeed.id);
				const graphReplaced = await editCall(commands.update, edit(graphLoaded, { source: "/edit-graph-new", destination: "/edit-graph-old" }));
				assert.deepEqual([graphReplaced.data.status, graphReplaced.data.rule.id, graphReplaced.data.confirmedBy], ["updated", graphSeed.id, "host"]);
				assert.equal(await repo.findBySource("/edit-graph-old"), null, "the replaced old edge cannot create a false loop through its former source");
				assert.deepEqual(await repo.findById(graphSeed.id), graphReplaced.data.rule);
				assert.deepEqual(preserve(graphReplaced.data.rule), preserve(graphLoaded.rule));
				editGroups.push("replacement removes the old edge before chain validation");

				for (const [source, reason] of [["/old-page", "duplicate"], ["/old-page/", "trailing-slash"]]) {
					before = mark();
					const conflict = await editCall(commands.update, edit(current, { source }));
					assert.deepEqual([conflict.data.status, conflict.data.reason, conflict.data.existing.id], ["conflict", reason, permanent.data.rule.id]);
					assert.equal(callsSince(before).update, 0);
					assert.deepEqual(await repo.findById(seed.id), current.rule);
				}
				await core.create({ source: "/edit-return", destination: current.rule.source });
				before = mark();
				const editLoop = await editCall(commands.update, edit(current, { destination: "/edit-return?x=1" }));
				assert.deepEqual([editLoop.data.status, editLoop.data.reason], ["conflict", "loop"]);
				assert.equal(callsSince(before).update, 0);
				assert.deepEqual(await repo.findById(seed.id), current.rule);
				editGroups.push("duplicate, slash alias and runtime chain-loop refusals");

				for (const [input, reason] of [
					[{ source: "/edit-pattern/[slug]", destination: "/edit-pattern-target/[slug]", type: 301 }, "pattern"],
					[{ source: "/edit-other-status", destination: "/edit-done", type: 307 }, "type"],
				]) {
					const unsupported = await core.create(input);
					const stored = await repo.findById(unsupported.redirect.id);
					const loaded = await editCall(commands.load, { id: stored.id });
					assert.deepEqual([loaded.data.status, loaded.data.reason, loaded.data.rule.id], ["unsupported", reason, stored.id]);
					before = mark();
					const refused = await editCall(commands.update, { id: stored.id, revision: unsupported._rev, source: stored.source, destination: stored.destination, type: 302, enabled: stored.enabled });
					assert.deepEqual([refused.data.status, refused.data.reason], ["unsupported", reason]);
					assert.deepEqual(callsSince(before), readOnlyCalls);
					assert.deepEqual(await repo.findById(stored.id), stored);
				}
				for (const [route, input] of [[commands.load, { id: "missing-edit-id" }], [commands.update, { ...edit(current), id: "missing-edit-id" }], [commands.recover, { ...snapshot(current), id: "missing-edit-id" }]]) {
					before = mark();
					assert.equal((await editCall(route, input)).data.status, "missing");
					assert.deepEqual(callsSince(before), readOnlyCalls);
				}
				assert.equal(await repo.findById("missing-edit-id"), null);
				editGroups.push("patterns, other statuses and missing IDs are not written or recreated");

				for (const kind of ["throw", "null"]) {
					const originalUpdate = RedirectRepository.prototype.update;
					const originalFind = RedirectRepository.prototype.findVersionedById;
					let armed = false;
					let resolvedWrites = 0;
					let consumed = 0;
					RedirectRepository.prototype.update = async function (...args) {
						const result = await originalUpdate.apply(this, args);
						if (args[0] === seed.id && args[3] && result) { resolvedWrites += 1; armed = true; }
						return result;
					};
					RedirectRepository.prototype.findVersionedById = async function (id) {
						const result = await originalFind.call(this, id);
						if (id !== seed.id || !armed) return result;
						armed = false;
						consumed += 1;
						if (kind === "throw") throw new Error("controlled final context readback loss after committed update");
						return null;
					};
					let recoveredEdit;
					before = mark();
					const errorCount = hostErrors.length;
					try {
						recoveredEdit = await editCall(commands.update, edit(current, { destination: `/edit-after-${kind}` }));
					} finally {
						RedirectRepository.prototype.update = originalUpdate;
						RedirectRepository.prototype.findVersionedById = originalFind;
					}
					assert.deepEqual([recoveredEdit.data.status, recoveredEdit.data.confirmedBy], ["updated", "recovery"]);
					assert.deepEqual([resolvedWrites, consumed, armed, hostErrors.length - errorCount], [1, 1, false, 1]);
					if (kind === "throw") assert.equal(hostErrors.at(-1).message, "controlled final context readback loss after committed update");
					else assert.equal(hostErrors.at(-1).code, "NOT_FOUND");
					assert.deepEqual([callsSince(before).get, callsSince(before).update], [2, 1]);
					assert.equal(recoveredEdit.data.rule.id, seed.id);
					assert.equal(recoveredEdit.data.rule.destination, `/edit-after-${kind}`);
					assert.notEqual(recoveredEdit.data.revision, current.revision);
					assert.deepEqual(preserve(recoveredEdit.data.rule), preserve(current.rule));
					assert.deepEqual(await repo.findById(seed.id), recoveredEdit.data.rule);
					assert.equal(RedirectRepository.prototype.update, originalUpdate);
					assert.equal(RedirectRepository.prototype.findVersionedById, originalFind);
					current = recoveredEdit.data;
					editGroups.push(`real committed update followed by final context readback ${kind}`);
				}
				const positive = await editCall(commands.update, edit(current, { destination: "/edit-restored-positive" }));
				assert.deepEqual([positive.data.status, positive.data.confirmedBy], ["updated", "host"]);
				assert.deepEqual(preserve(positive.data.rule), preserve(current.rule));
				current = positive.data;
				editGroups.push("untouched positive update after fault-hook restoration");

				const pendingSnapshot = snapshot(current, { destination: "/edit-delayed-target" });
				const originalUpdate = RedirectRepository.prototype.update;
				let releaseEdit;
				let reachedEdit;
				let held = 0;
				const editReached = new Promise((resolve) => { reachedEdit = resolve; });
				const editGate = new Promise((resolve) => { releaseEdit = resolve; });
				RedirectRepository.prototype.update = async function (...args) {
					if (args[0] === seed.id && args[3] && held === 0) { held += 1; reachedEdit(); await editGate; }
					return originalUpdate.apply(this, args);
				};
				let pending;
				try {
					pending = editCall(commands.update, edit(current, pendingSnapshot.draft));
					await Promise.race([editReached, pending.then((result) => { throw new Error(`The edit finished before reaching its actual repository update: ${JSON.stringify(result)}`); })]);
					before = mark();
					const earlyRecovery = await editCall(commands.recover, pendingSnapshot);
					assert.deepEqual([earlyRecovery.data.status, earlyRecovery.data.reason], ["uncertain", "pending"]);
					assert.deepEqual(callsSince(before), readOnlyCalls, "a held actual host update does not let recovery write or unlock the baseline");
					assert.deepEqual(await repo.findById(seed.id), current.rule);
					releaseEdit();
					const settled = await pending;
					assert.deepEqual([settled.data.status, settled.data.confirmedBy, held], ["updated", "host", 1]);
					current = settled.data;
				} finally {
					releaseEdit();
					if (pending) await pending.catch(() => {});
					RedirectRepository.prototype.update = originalUpdate;
				}
				before = mark();
				const lateRecovery = await editCall(commands.recover, pendingSnapshot);
				assert.deepEqual([lateRecovery.data.status, lateRecovery.data.confirmedBy, lateRecovery.data.rule.id], ["updated", "recovery", seed.id]);
				assert.deepEqual(callsSince(before), readOnlyCalls);
				assert.deepEqual(await repo.findById(seed.id), current.rule);
				editGroups.push("held actual update stays uncertain then read-only recovery confirms");

				const otherBaseline = await core.get(seed.id);
				const otherWriter = await core.update(seed.id, { _rev: otherBaseline._rev, groupName: "Changed in core" });
				before = mark();
				const changed = await editCall(commands.recover, pendingSnapshot);
				assert.deepEqual([changed.data.status, changed.data.reason, changed.data.current.groupName], ["stale", "changed", "Changed in core"]);
				assert.deepEqual(callsSince(before), readOnlyCalls);
				assert.deepEqual(await repo.findById(seed.id), otherWriter.redirect);
				editGroups.push("other-writer preserved-group change remains stale without overwrite");

				const oversizedSeed = await repo.create({ source: "/edit-oversized-group", destination: "/edit-oversized-target", type: 301, enabled: false, groupName: "g".repeat(201) });
				const oversizedStored = await repo.findById(oversizedSeed.id);
				const oversizedVersion = await core.get(oversizedSeed.id);
				assert.equal(oversizedVersion.redirect.groupName.length, 201, "the actual host record exceeds the plugin envelope");
				for (const [route, input] of [[commands.load, { id: oversizedSeed.id }], [commands.update, { id: oversizedSeed.id, revision: oversizedVersion._rev, source: oversizedStored.source, destination: "/must-not-save-oversized-group", type: 302, enabled: false }]]) {
					before = mark();
					const oversized = await editCall(route, input);
					assert.deepEqual([oversized.status, oversized.data.status, oversized.data.reason, oversized.data.rule], [200, "unsupported", "envelope", null]);
					assert.match(oversized.data.message, /EmDash Redirects/);
					assert.deepEqual(callsSince(before), readOnlyCalls, "an oversized real record is refused before list preflight or update");
				}
				assert.deepEqual(await repo.findById(oversizedSeed.id), oversizedStored, "the full group and configuration remain untouched");
				assert.equal((await core.get(oversizedSeed.id))._rev, oversizedVersion._rev);
				editGroups.push("oversized real core group returns only unsupported envelope and core fallback");
			} finally {
				contextMode = "full";
				PluginContextFactory.prototype.createContext = originalContext;
			}
		}

		// The extracted native descriptor carries permissions and raw JSON bounds.
		const pluginTypes = createRequire(new URL("package.json", hostPackageRoot("emdash"))).resolve("@emdash-cms/plugin-types");
		const { extractManifestRoute } = await import(pathToFileURL(pluginTypes).href);
		assert.deepEqual(
			// Unset route options are present as undefined; JSON keeps what a manifest carries.
			JSON.parse(JSON.stringify(["admin-redirect-rules", "create-admin-redirect-rule", "reconcile-admin-redirect-rule", "admin-redirect-rule", "update-admin-redirect-rule", "reconcile-admin-redirect-rule-update"]
				.map((name) => extractManifestRoute(name, seo.routes[name])))),
			[
				{ name: "admin-redirect-rules", permission: "redirects:read" },
				{ name: "create-admin-redirect-rule", permission: "redirects:manage" },
				{ name: "reconcile-admin-redirect-rule", permission: "redirects:read" },
				{ name: "admin-redirect-rule", permission: "redirects:read", request: { body: "json", maxBytes: 2_048 } },
				{ name: "update-admin-redirect-rule", permission: "redirects:manage", request: { body: "json", maxBytes: 65_536 } },
				{ name: "reconcile-admin-redirect-rule-update", permission: "redirects:read", request: { body: "json", maxBytes: 98_304 } },
			],
		);
		if (["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
			editGroups.push("six extracted route permissions and request declarations");
			console.log(`Redirect edit: ${editGroups.length} integrated groups and ${dispatcherRequests - editRequestStart} dispatcher requests finished on EmDash ${target.versions.get("emdash")} with in-memory SQLite; host internal SQL, public HTTP, UI, sandbox and Cloudflare remain separate checks.`);
		}
		console.log(`Redirect list and create passed through the published HTTP dispatcher, route registry and ctx.redirects on EmDash ${target.versions.get("emdash")} with in-memory SQLite.`);
	} finally {
		await redirectDb.destroy();
	}
}

// Entry custom schemas: the same registered plugin and dispatcher, with real
// content rows, the plugin's revisioned storage and its declared scope index.
async function schemaContentTypesSmoke() {
	const SchemaRegistry = await hostDistExport("SchemaRegistry");
	const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
	const buildRouteMeta = await hostDistExport("buildRouteMeta");
	const parseRouteInput = await hostDistExport("parseRouteInput");
	const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
	const { createPlugin } = await import(new URL("packages/emdash-plugin-seo/src/native-entry.ts", sourceRoot));
	const { readSchemaContentTypeRoles } = await import(new URL("packages/emdash-plugin-seo/src/entry-analysis-runtime.ts", sourceRoot));
	const key = "configuration:schema-content-types:v1";
	const schemaDb = new Kysely({ dialect: createDialect({ url: ":memory:" }) });
	try {
		await runMigrations(schemaDb);
		const site = "https://example.com";
		const seo = createPlugin();
		const schema = new SchemaRegistry(schemaDb);
		// EmDash's own SEO fields stay off on Pages; JSON-LD defaults do not depend on them.
		await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" });
		await schema.createCollection({ slug: "pages", label: "Pages", hasSeo: false, routable: true });
		await schema.createCollection({ slug: "internal", label: "Internal", routable: true, hidden: true });

		const routeOptions = { db: schemaDb, siteInfo: { url: site, name: "Content type schema validation" }, cronReschedule() {} };
		const registry = new PluginRouteRegistry(routeOptions);
		registry.register(seo);
		const runtime = {
			getPluginRouteMeta(pluginId, path) {
				const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
				return route ? buildRouteMeta(route) : null;
			},
			async handlePluginApiRoute(pluginId, _method, path, request, caller) {
				const body = await parseRouteInput(request, this.getPluginRouteMeta(pluginId, path)?.request);
				return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
			},
		};
		const editor = { id: "editor", email: "editor@example.com", name: "Editor", role: 40 };
		const admin = { id: "admin", email: "admin@example.com", name: "Admin", role: 50 };
		async function call(route, body, user = admin) {
			const request = new Request(`${site}/_emdash/api/plugins/shipit-seo/${route}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
				body: JSON.stringify(body),
			});
			const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: user ?? undefined });
			const payload = await response.json();
			return { status: response.status, data: payload?.data };
		}

		assert.equal((await call("admin-schema-content-types", {}, null)).status, 401);
		for (const [route, body] of [
			["admin-schema-content-types", {}],
			["save-admin-schema-content-types", { values: { pages: "webPage" }, expectedRevision: null }],
			["reset-admin-schema-content-types", { expectedRevision: "r", confirmed: true }],
		]) {
			assert.equal((await call(route, body, editor)).status, 403, `${route} refuses an editor`);
		}

		const pluginCtx = new PluginContextFactory(routeOptions).createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
		const initial = await call("admin-schema-content-types", {});
		assert.deepEqual(initial.data.contentTypes.items.map((item) => [item.collection, item.role]), [["pages", "none"], ["posts", "blogPosting"]],
			"routable, listed types are offered with or without EmDash SEO fields; hidden ones are not");
		assert.deepEqual([initial.data.contentTypes.record, initial.data.contentTypes.revision], ["absent", null]);

		const saved = await call("save-admin-schema-content-types", { values: { posts: "blogPosting", pages: "webPage" }, expectedRevision: null });
		assert.equal(saved.data.success, true, JSON.stringify(saved.data));
		const stored = await pluginCtx.kv.getVersioned(key);
		assert.deepEqual(stored.value.values, { pages: "webPage" }, "only roles that differ from the defaults are stored");
		assert.equal(stored.revision, saved.data.contentTypes.revision, "the response carries the host revision");

		await pluginCtx.kv.set(key, { ...stored.value, updatedAt: "2026-10-02T12:00:00.000Z" });
		const stale = await call("save-admin-schema-content-types", { values: { pages: "none" }, expectedRevision: stored.revision });
		assert.equal(stale.data.error, "conflict", "the host revision rejects a save loaded before another write");
		assert.equal((await pluginCtx.kv.get(key)).updatedAt, "2026-10-02T12:00:00.000Z", "the other write is kept");
		assert.equal((await call("reset-admin-schema-content-types", { expectedRevision: stale.data.current.revision })).status, 400,
			"a reset without confirmation is rejected before it runs");
		assert.equal((await call("reset-admin-schema-content-types", { expectedRevision: stored.revision, confirmed: true })).data.error, "conflict");
		const reset = await call("reset-admin-schema-content-types", { expectedRevision: stale.data.current.revision, confirmed: true });
		assert.equal(reset.data.success, true);
		assert.equal(await pluginCtx.kv.getVersioned(key), null, "a confirmed reset with the loaded revision removes the record");

		await pluginCtx.kv.set(key, null);
		assert.equal((await readSchemaContentTypeRoles(pluginCtx)).invalid, true, "native storage tells a stored null from a missing record");
		const invalid = await call("admin-schema-content-types", {});
		assert.equal(invalid.data.contentTypes.record, "invalid");
		const refused = await call("save-admin-schema-content-types", { values: { pages: "webPage" }, expectedRevision: invalid.data.contentTypes.revision });
		assert.equal(refused.data.error, "invalid_stored", "an unreadable record is not replaced without confirmation");
		const replaced = await call("save-admin-schema-content-types", { values: { pages: "webPage" }, expectedRevision: invalid.data.contentTypes.revision, replaceInvalid: true });
		assert.equal(replaced.data.success, true);
		assert.equal((await readSchemaContentTypeRoles(pluginCtx)).invalid, false);

		const pluginTypes = createRequire(new URL("package.json", hostPackageRoot("emdash"))).resolve("@emdash-cms/plugin-types");
		const { extractManifestRoute } = await import(pathToFileURL(pluginTypes).href);
		const routes = ["admin-schema-content-types", "save-admin-schema-content-types", "reset-admin-schema-content-types"];
		assert.deepEqual(
			JSON.parse(JSON.stringify(routes.map((name) => extractManifestRoute(name, seo.routes[name])))),
			routes.map((name) => ({ name, permission: "plugins:manage" })),
		);
		console.log(`Content type schema defaults passed through the published HTTP dispatcher with versioned plugin KV on EmDash ${target.versions.get("emdash")} with in-memory SQLite.`);
	} finally {
		await schemaDb.destroy();
	}
}

async function entrySchemaSmoke() {
	const SchemaRegistry = await hostDistExport("SchemaRegistry");
	const ContentRepository = await hostDistExport("ContentRepository");
	const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
	const buildRouteMeta = await hostDistExport("buildRouteMeta");
	const parseRouteInput = await hostDistExport("parseRouteInput");
	const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
	for (const [name, value] of Object.entries({ SchemaRegistry, ContentRepository, PluginRouteRegistry, buildRouteMeta, parseRouteInput, dispatchPluginApiRequest })) {
		assert.equal(typeof value, "function", `published host exports ${name}`);
	}
	const { createPlugin } = await import(new URL("packages/emdash-plugin-seo/src/native-entry.ts", sourceRoot));
	let counting = false;
	const queries = [];
	const readCounts = [];
	const schemaDb = new Kysely({
		dialect: createDialect({ url: ":memory:" }),
		log(event) {
			if (counting && event.level === "query") queries.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
		},
	});
	try {
		await runMigrations(schemaDb);
		const site = "https://example.com";
		const seo = createPlugin();
		if (syncDeclaredStorageIndexes) await syncDeclaredStorageIndexes(schemaDb, [{ id: seo.id, storage: seo.storage }]);
		const schema = new SchemaRegistry(schemaDb);
		await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" });
		await schema.createField("posts", { slug: "title", label: "Title", type: "string" });
		const content = new ContentRepository(schemaDb);
		const english = await content.create({ type: "posts", slug: "launch-notes", data: { title: "Launch notes" }, status: "published", locale: "en" });
		const french = await content.create({ type: "posts", slug: "launch-notes", data: { title: "Notes" }, status: "published", locale: "fr", translationOf: english.id });
		assert.notEqual(french.id, english.id, "each translation is its own row");

		const routeOptions = { db: schemaDb, siteInfo: { url: site, name: "Schema validation" }, cronReschedule() {} };
		const registry = new PluginRouteRegistry(routeOptions);
		registry.register(seo);
		const runtime = {
			getPluginRouteMeta(pluginId, path) {
				const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
				return route ? buildRouteMeta(route) : null;
			},
			async handlePluginApiRoute(pluginId, _method, path, request, caller) {
				const body = await parseRouteInput(request, this.getPluginRouteMeta(pluginId, path)?.request);
				return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
			},
		};
		const editor = { id: "editor", email: "editor@example.com", name: "Editor", role: 40 };
		const admin = { id: "admin", email: "admin@example.com", name: "Admin", role: 50 };
		async function call(route, body, user = admin) {
			const request = new Request(`${site}/_emdash/api/plugins/shipit-seo/${route}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
				body: JSON.stringify(body),
			});
			const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: user ?? undefined });
			const payload = await response.json();
			return { status: response.status, data: payload?.data };
		}
		const ref = { collection: "posts", entryId: english.id, locale: "en" };
		const article = (headline) => JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline });

		async function measureList(label, input, expectedItems, expectedVersionedReads) {
			queries.length = 0;
			counting = true;
			let result;
			try {
				result = await call("entry-custom-schemas", input);
			} finally {
				counting = false;
			}
			assert.equal(result.status, 200);
			assert.equal(result.data.success, true);
			assert.equal(result.data.items.length, expectedItems);
			assert.ok(result.data.items.every((item) => !Object.hasOwn(item, "revision")), "list summaries cannot authorize a write");
			assert.ok(queries.every((query) => !/^\s*(insert|update|delete|replace|create|drop|alter)\b/i.test(query.sql)), "listing and inspection must not write");
			const storageReads = queries.filter((query) => query.sql.includes('"_plugin_storage"') && query.parameters.includes("schemas"));
			const versionedReads = storageReads.filter((query) => /^select "data", "revision" from "_plugin_storage"/i.test(query.sql));
			assert.equal(versionedReads.length, expectedVersionedReads, label + " exact-row versioned reads");
			readCounts.push({ label, items: expectedItems, totalQueries: queries.length, schemaQueries: storageReads.length, versionedReads: versionedReads.length });
			return result;
		}

		assert.equal((await call("entry-custom-schemas", ref, null)).status, 401);
		assert.equal((await call("entry-custom-schemas", ref, editor)).status, 403);
		assert.equal((await call("save-entry-custom-schema", { ...ref, id: "entry-editordeniedwrite000", expectedRevision: null, name: "x", json: article("x"), enabled: true }, editor)).status, 403);
		assert.equal((await call("remove-entry-custom-schema", { ...ref, id: "entry-editordeniedwrite000", expectedRevision: "r" }, editor)).status, 403);

		const pluginCtx = new PluginContextFactory(routeOptions).createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
		await pluginCtx.storage.schemas.put("site-wide", { name: "Site", scope: "global", json: article("Site"), enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
		await pluginCtx.storage.schemas.put("unscoped", { name: "Unscoped", json: article("Unscoped"), enabled: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

		await measureList("empty-list", ref, 0, 0);
		const created = await call("save-entry-custom-schema", { ...ref, id: "entry-sqlitesmoke00000000a", expectedRevision: null, name: "Launch article", json: article("Launch"), enabled: true });
		assert.equal(created.status, 200);
		assert.equal(created.data.success, true, JSON.stringify(created.data));
		const stored = await pluginCtx.storage.schemas.getVersioned("entry-sqlitesmoke00000000a");
		assert.deepEqual(stored.value.target, { collection: "posts", entryId: english.id, locale: "en" });
		assert.equal(stored.revision, created.data.schema.revision);

		const listed = await measureList("one-record-list", ref, 1, 0);
		assert.deepEqual(listed.data.items.map((item) => item.id), ["entry-sqlitesmoke00000000a"]);
		assert.deepEqual(listed.data.inherited.map((item) => [item.id, item.owner]).sort(), [["site-wide", "site"], ["unscoped", "site"]],
			"indexed scope and null-scope reads find inherited rows on SQLite");

		const inspected = await measureList("one-record-inspection", { ...ref, inspectId: created.data.schema.id }, 1, 1);
		assert.equal(inspected.data.inspected.state, "owned");
		assert.equal(inspected.data.inspected.schema.revision, created.data.schema.revision);
		const countedIds = [];
		for (let index = 1; index < 20; index += 1) {
			const id = "entry-sqlitecount0000000" + String(index).padStart(2, "0");
			await pluginCtx.storage.schemas.put(id, { ...stored.value, name: "Count example " + index });
			countedIds.push(id);
		}
		await measureList("twenty-record-list", ref, 20, 0);
		const inspectedTwenty = await measureList("twenty-record-inspection", { ...ref, inspectId: created.data.schema.id }, 20, 1);
		assert.equal(inspectedTwenty.data.inspected.schema.revision, created.data.schema.revision);
		for (const id of countedIds) await pluginCtx.storage.schemas.delete(id);

		const edited = await call("save-entry-custom-schema", { ...ref, id: "entry-sqlitesmoke00000000a", expectedRevision: created.data.schema.revision, name: "Launch article", json: article("Revised"), enabled: true });
		assert.equal(edited.data.success, true);
		const stale = await call("save-entry-custom-schema", { ...ref, id: "entry-sqlitesmoke00000000a", expectedRevision: created.data.schema.revision, name: "Old", json: article("Old"), enabled: true });
		assert.equal(stale.data.error, "conflict", "the host revision rejects a stale save");
		const moved = await call("save-entry-custom-schema", { ...ref, id: "site-wide", expectedRevision: (await pluginCtx.storage.schemas.getVersioned("site-wide")).revision, name: "Moved", json: article("Moved"), enabled: true });
		assert.equal(moved.data.error, "scope_mismatch");
		assert.equal((await pluginCtx.storage.schemas.get("site-wide")).scope, "global", "the shared record stayed global");

		const frenchList = await call("entry-custom-schemas", { collection: "posts", entryId: french.id, locale: "fr" });
		assert.equal(frenchList.data.entry.locale, "fr");
		assert.deepEqual(frenchList.data.items, [], "the other locale's row does not see this record");
		assert.equal((await call("save-entry-custom-schema", { collection: "posts", entryId: french.id, locale: "en", id: "entry-sqlitesmoke00000000b", expectedRevision: null, name: "x", json: article("x"), enabled: true })).data.error, "entry_mismatch");

		const staleRemove = await call("remove-entry-custom-schema", { ...ref, id: "entry-sqlitesmoke00000000a", expectedRevision: created.data.schema.revision });
		assert.equal(staleRemove.data.error, "conflict");
		const removed = await call("remove-entry-custom-schema", { ...ref, id: "entry-sqlitesmoke00000000a", expectedRevision: edited.data.schema.revision });
		assert.deepEqual([removed.data.success, await pluginCtx.storage.schemas.get("entry-sqlitesmoke00000000a")], [true, null]);

		const pluginTypes = createRequire(new URL("package.json", hostPackageRoot("emdash"))).resolve("@emdash-cms/plugin-types");
		const { extractManifestRoute } = await import(pathToFileURL(pluginTypes).href);
		assert.deepEqual(
			JSON.parse(JSON.stringify(["entry-custom-schemas", "save-entry-custom-schema", "remove-entry-custom-schema"]
				.map((name) => extractManifestRoute(name, seo.routes[name])))),
			[
				{ name: "entry-custom-schemas", permission: "plugins:manage" },
				{ name: "save-entry-custom-schema", permission: "plugins:manage" },
				{ name: "remove-entry-custom-schema", permission: "plugins:manage" },
			],
		);
		console.log(`Entry custom schemas passed through the published HTTP dispatcher with revisioned plugin storage on EmDash ${target.versions.get("emdash")} with in-memory SQLite.`);
		console.log("Entry schema SQL read counts: " + JSON.stringify(readCounts));
	} finally {
		await schemaDb.destroy();
	}
}

// Business identity: the six routes behind the published dispatcher, the one
// settings-prefixed options row they write, guarded custom schema saves and
// the page:metadata output, all on in-memory SQLite. Query counts are reported
// so the cost bounds can be read from a real adapter.
async function businessIdentitySmoke() {
	const SchemaRegistry = await hostDistExport("SchemaRegistry");
	const ContentRepository = await hostDistExport("ContentRepository");
	const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
	const buildRouteMeta = await hostDistExport("buildRouteMeta");
	const parseRouteInput = await hostDistExport("parseRouteInput");
	const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
	const OptionsRepository = await hostDistExport("OptionsRepository");
	for (const [name, value] of Object.entries({ SchemaRegistry, ContentRepository, PluginRouteRegistry, buildRouteMeta, parseRouteInput, dispatchPluginApiRequest, OptionsRepository })) {
		assert.equal(typeof value, "function", `published host exports ${name}`);
	}
	const { createSqliteSeoFixture } = await import("./sqlite-plugin-fixture.mjs");
	const { COEXISTENCE_PROFILES } = await import(new URL("packages/emdash-plugin-seo/src/plugin-coexistence.ts", sourceRoot));
	const { CONTENT_SCORING_RESOURCE_NOTICE_VERSION, SEO_PORTABILITY_CONFIRMATION } = await import(new URL("packages/emdash-plugin-seo/src/admin-contract.ts", sourceRoot));
	let counting = false;
	const queries = [];
	const identityDb = new Kysely({
		dialect: createDialect({ url: ":memory:" }),
		log(event) {
			if (counting && event.level === "query") queries.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
		},
	});
	const optionName = "plugin:shipit-seo:settings:business-identity:v1";
	const readRow = async () => (await sql`select value, revision from options where name = ${optionName}`.execute(identityDb)).rows[0] ?? null;
	try {
		await runMigrations(identityDb);
		const site = "https://example.com";
		const seo = createSqliteSeoFixture(identityDb);
		if (syncDeclaredStorageIndexes) await syncDeclaredStorageIndexes(identityDb, [{ id: seo.id, storage: seo.storage }]);
		const schema = new SchemaRegistry(identityDb);
		await schema.createCollection({ slug: "pages", label: "Pages", hasSeo: true, routable: true, urlPattern: "/{slug}" });
		await schema.createField("pages", { slug: "title", label: "Title", type: "string" });
		await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" });
		await schema.createField("posts", { slug: "title", label: "Title", type: "string" });
		const content = new ContentRepository(identityDb);
		const about = await content.create({ type: "pages", slug: "about", data: { title: "About the bakery" }, status: "published", locale: "en" });
		const draft = await content.create({ type: "pages", slug: "draft-page", data: { title: "Draft" }, status: "draft", locale: "en" });
		const post = await content.create({ type: "posts", slug: "fresh-bread", data: { title: "Fresh bread" }, status: "published", locale: "en" });

		const routeOptions = { db: identityDb, siteInfo: { siteUrl: site, siteName: "Harbour Bakery" }, cronReschedule() {} };
		const registry = new PluginRouteRegistry(routeOptions);
		registry.register(seo);
		const runtime = {
			getPluginRouteMeta(pluginId, path) {
				const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
				return route ? buildRouteMeta(route) : null;
			},
			async handlePluginApiRoute(pluginId, _method, path, request, caller) {
				const body = await parseRouteInput(request, this.getPluginRouteMeta(pluginId, path)?.request);
				return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
			},
		};
		const editor = { id: "editor", email: "editor@example.com", name: "Editor", role: 40 };
		const admin = { id: "admin", email: "admin@example.com", name: "Admin", role: 50 };
		async function call(route, body, user = admin) {
			const request = new Request(`${site}/_emdash/api/plugins/shipit-seo/${route}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
				body: JSON.stringify(body),
			});
			const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: user ?? undefined });
			const payload = await response.json();
			return { status: response.status, data: payload?.data };
		}
		const pluginCtx = new PluginContextFactory(routeOptions).createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
		assert.equal(typeof pluginCtx.settings?.getVersioned, "function", "the host offers versioned plugin settings");
		const pageContext = (path, entry) => ({
			url: `${site}${path}`, path, locale: null, kind: entry ? "content" : "custom", pageType: "website",
			title: entry?.slug ?? "Home", pageTitle: entry?.data?.title ?? "Home", description: "", canonical: `${site}${path}`, image: null,
			...(entry ? { content: { collection: entry.type, id: entry.id, slug: entry.slug } } : {}),
			seo: {}, siteName: "Harbour Bakery", siteUrl: site,
		});
		const homePage = pageContext("/");
		const aboutPage = pageContext("/about", { ...about, type: "pages" });
		const postPage = pageContext("/posts/fresh-bread", { ...post, type: "posts" });
		const render = async (page) => (await seo.hooks["page:metadata"].handler({ page }, pluginCtx)) ?? [];
		const graphOf = (contributions, id) => contributions.find((item) => item.kind === "jsonld" && item.id === id)?.graph;
		const nonSchema = (contributions) => JSON.stringify(contributions.filter((item) => item.kind !== "jsonld"));

		// ---- Permissions ----
		const routes = ["admin-business-identity", "preview-business-identity", "save-business-identity", "set-business-identity-active", "transition-business-identity-entity", "admin-business-identity-pages"];
		assert.equal((await call("admin-business-identity", {}, null)).status, 401, "anonymous readers are refused");
		for (const [route, body] of [
			["admin-business-identity", {}],
			["preview-business-identity", { document: {} }],
			["save-business-identity", { document: {}, expectedRevision: null }],
			["set-business-identity-active", { active: false, expectedRevision: "r", confirmed: true }],
			["transition-business-identity-entity", { to: "origin", expectedRevision: "r", confirmed: true }],
			["admin-business-identity-pages", { collection: "pages", limit: 25 }],
		]) assert.equal((await call(route, body, editor)).status, 403, `${route} refuses an editor`);
		const pluginTypes = createRequire(new URL("package.json", hostPackageRoot("emdash"))).resolve("@emdash-cms/plugin-types");
		const { extractManifestRoute } = await import(pathToFileURL(pluginTypes).href);
		assert.deepEqual(JSON.parse(JSON.stringify(routes.map((name) => extractManifestRoute(name, seo.routes[name])))), routes.map((name) => ({ name, permission: "plugins:manage" })));

		// ---- Absent: legacy output, no write on read ----
		counting = true;
		const before = [await render(homePage), await render(aboutPage), await render(postPage)];
		counting = false;
		const absentQueries = queries.splice(0);
		assert.equal(graphOf(before[0], "preset:organization")?.["@id"], `${site}/#organization`);
		const view = await call("admin-business-identity", {});
		assert.equal(view.data.identity.state, "absent");
		assert.equal(await readRow(), null, "opening the view writes nothing");
		const pages = await call("admin-business-identity-pages", { collection: "pages", limit: 25 });
		assert.equal(pages.data.items[0].url, `${site}/about`, "the host's public address is offered with each page");
		assert.deepEqual(pages.data.items.map((item) => item.entryId), [about.id], "only published pages are offered");
		assert.equal((await call("admin-business-identity-pages", { collection: "pages", limit: 26 })).status, 400, "the page size is bounded");

		// ---- Adoption ----
		const restaurant = {
			kind: "LocalBusiness", businessType: "Restaurant", name: "Harbour Bakery", telephone: "+31 20 123 4567",
			contactPoints: [], sameAs: ["https://social.example/harbour"],
			address: { streetAddress: "Kade 1", addressLocality: "Amsterdam", postalCode: "1011 AA", addressCountry: "NL" },
			areaServed: [{ kind: "City", name: "Amsterdam", countryCode: "NL" }],
			location: { geo: { latitude: "52.37403", longitude: "4.88969" }, hours: { mode: "weekly", days: {
				Monday: { state: "periods", periods: [{ opens: "09:07", closes: "17:00" }] }, Tuesday: { state: "closed" },
				Wednesday: { state: "unknown" }, Thursday: { state: "unknown" }, Friday: { state: "periods", periods: [{ opens: "18:00", closes: "01:00" }] },
				Saturday: { state: "unknown" }, Sunday: { state: "open24" },
			} } },
			restaurant: { servesCuisine: ["Dutch"], acceptsReservations: true },
			target: { kind: "content", collection: "pages", entryId: about.id, locale: "en", title: "About the bakery" },
		};
		assert.equal((await call("save-business-identity", { document: restaurant })).status, 400, "a write without an expected revision is rejected before it runs");

		assert.equal((await call("save-business-identity", { document: { ...restaurant, target: { ...restaurant.target, entryId: draft.id } }, expectedRevision: null })).data.success, false, "an unpublished page cannot be the target");
		counting = true;
		const adopted = await call("save-business-identity", { document: restaurant, expectedRevision: null });
		counting = false;
		const saveQueries = queries.splice(0);
		assert.equal(adopted.data.success, true, JSON.stringify(adopted.data));
		const row = await readRow();
		assert.ok(row, "the record is one row in the options table");
		assert.equal(row.revision, adopted.data.revision, "the response carries the host revision");
		const stored = JSON.parse(row.value);
		assert.equal(stored.entityId, `${site}/#organization`, "adoption stores the publisher ID pages used before");
		assert.equal(stored.active, true);
		const identityWrites = saveQueries.filter((query) => /^\s*(insert|update|delete)/i.test(query.sql) && query.parameters.includes(optionName));
		assert.equal(identityWrites.length, 1, "one compare-and-set write of the identity row");
		assert.equal(saveQueries.filter((query) => /^\s*(insert|update|delete)/i.test(query.sql)).length, 1, "and no other write");

		// ---- Output ----
		counting = true;
		const active = [await render(homePage), await render(aboutPage), await render(postPage)];
		counting = false;
		const renderQueries = queries.splice(0);
		const isIdentityRead = (query) => /^\s*select/i.test(query.sql) && /from "options"/i.test(query.sql) && query.parameters.includes(optionName);
		const identityReads = renderQueries.filter(isIdentityRead).length;
		assert.equal(identityReads, 3, "one identity read per rendered page");
		assert.equal(absentQueries.filter(isIdentityRead).length, 3, "the same single read happens while no identity is stored");
		for (const querySet of [absentQueries, renderQueries]) {
			const inventoryReads = querySet.filter((query) => query.sql.includes('from "_plugin_state"'));
			assert.equal(inventoryReads.length, 3, "each page observes peer state once through its own fixture database");
			for (const query of inventoryReads) {
				assert.ok(query.sql.startsWith("select "));
				assert.equal((query.sql.match(/substr\(/g) ?? []).length, 6, "inventory reads project six clipped fields");
				assert.deepEqual(query.parameters.filter((value) => typeof value === "string" && value.startsWith("r_")).sort(),
					COEXISTENCE_PROFILES.map((profile) => profile.runtimeId).sort());
				assert.equal(query.parameters.at(-1), 32, "inventory retains its row limit");
			}
		}
		for (const [label, list] of [["absent", absentQueries], ["active", renderQueries]]) {
			assert.equal(list.filter((query) => /^\s*(insert|update|delete|replace)\b/i.test(query.sql)).length, 0, `rendering never writes (${label})`);
		}
		const baselineForms = new Set(absentQueries.filter((query) => !isIdentityRead(query)).map((query) => query.sql));
		const added = renderQueries.filter((query) => !isIdentityRead(query) && !baselineForms.has(query.sql)).map((query) => query.sql);
		assert.deepEqual(added, [], "an active identity adds no other kind of read, such as a content or schema inventory");
		assert.ok(
			renderQueries.filter((query) => !isIdentityRead(query)).length <= absentQueries.filter((query) => !isIdentityRead(query)).length,
			"and no more reads than the absent baseline",
		);
		const full = graphOf(active[1], "preset:organization");
		assert.equal(full["@type"], "Restaurant");
		assert.equal(full.telephone, "+31 20 123 4567");
		assert.deepEqual(full.geo, { "@type": "GeoCoordinates", latitude: 52.37403, longitude: 4.88969 });
		assert.ok(full.openingHoursSpecification.some((item) => item.opens === "09:07:00" && item.dayOfWeek.includes("Monday")));
		for (const [index, label] of [[0, "home"], [2, "post"]]) {
			const minimal = graphOf(active[index], "preset:organization");
			assert.equal(minimal["@type"], "Organization", `${label} types the business as its organization`);
			assert.equal(minimal["@id"], `${site}/#organization`);
			assert.ok(!JSON.stringify(active[index]).includes("Kade 1") && !JSON.stringify(active[index]).includes("+31 20 123 4567"), `${label} carries no address or phone`);
			assert.equal(nonSchema(active[index]), nonSchema(before[index === 0 ? 0 : 2]), `${label} keeps unrelated metadata`);
		}

		// ---- Revisions and conflicts ----
		const loaded = await call("admin-business-identity", {});
		// Rows written before migration 077 report revision "0" until written; the
		// update trigger replaces "0" on later writes, so it is lifted only to set one up.
		const trigger = (await sql`select sql from sqlite_master where type = 'trigger' and name = 'emdash_options_revision_update'`.execute(identityDb)).rows[0]?.sql;
		assert.ok(trigger, "the host keeps option revisions with an update trigger");
		await sql`drop trigger emdash_options_revision_update`.execute(identityDb);
		await sql`update options set revision = '0' where name = ${optionName}`.execute(identityDb);
		await sql.raw(trigger).execute(identityDb);
		assert.equal((await pluginCtx.settings.getVersioned("business-identity:v1")).revision, "0");
		assert.equal((await call("save-business-identity", { document: restaurant, expectedRevision: loaded.data.identity.revision })).data.error, "conflict", "a stale revision is refused");
		const fromZero = await call("save-business-identity", { document: { ...restaurant, priceRange: "$$" }, expectedRevision: "0" });
		assert.equal(fromZero.data.success, true, "a row from before revisions were tracked reports revision 0, which is accepted");
		assert.notEqual((await readRow()).revision, "0", "and the write gives it a new revision");
		await pluginCtx.settings.set("business-identity:v1", { ...stored, name: "Harbour Bakery Elsewhere", updatedAt: "2026-10-02T12:00:00.000Z", priceRange: "$$" });
		const stale = await call("save-business-identity", { document: restaurant, expectedRevision: fromZero.data.revision });
		assert.equal(stale.data.error, "conflict");
		assert.equal(JSON.parse((await readRow()).value).name, "Harbour Bakery Elsewhere", "the other write is kept");

		// ---- Unknown write outcome: committed, then the response is lost ----
		const current = await call("admin-business-identity", {});
		const originalCompareAndSet = OptionsRepository.prototype.compareAndSet;
		OptionsRepository.prototype.compareAndSet = async function (...args) {
			const result = await originalCompareAndSet.apply(this, args);
			OptionsRepository.prototype.compareAndSet = originalCompareAndSet;
			throw new Error(`connection reset after commit (${result.applied})`);
		};
		const lost = await call("save-business-identity", { document: { ...restaurant, priceRange: "$$$" }, expectedRevision: current.data.identity.revision });
		OptionsRepository.prototype.compareAndSet = originalCompareAndSet;
		assert.equal(lost.data.error, "unconfirmed");
		assert.equal(lost.data.intended.priceRange, "$$$");
		const settled = await call("admin-business-identity", { check: { intended: lost.data.intended, loaded: current.data.identity.record } });
		assert.equal(settled.data.check, "matches_requested", "one read shows the stored values match the request, without naming who stored them");
		await pluginCtx.settings.set("business-identity:v1", { ...JSON.parse((await readRow()).value), alternateName: "HB", updatedAt: "2026-10-02T12:30:00.000Z" });
		assert.equal((await call("admin-business-identity", { check: { intended: lost.data.intended, loaded: current.data.identity.record } })).data.check, "differs", "a later change elsewhere is not reported as this write");

		// ---- Ownership guards ----
		const fresh = await call("admin-business-identity", {});
		const owned = JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "Old" });
		const rawSave = await call("save-admin-custom-schema", { id: "identity-owner", expectedRevision: null, name: "Old organization", scope: "global", json: owned, enabled: true });
		assert.equal(rawSave.data.success, false, "an enabled custom schema cannot define the active identity's ID");
		assert.equal((await call("save-entry-custom-schema", { collection: "posts", entryId: post.id, locale: "en", id: "entry-identityguard00000a", expectedRevision: null, name: "Owner", json: owned, enabled: true })).data.success, false, "nor can an entry's own schema");
		const off = await call("set-business-identity-active", { active: false, expectedRevision: fresh.data.identity.revision, confirmed: true });
		assert.equal(off.data.success, true);
		assert.deepEqual(
			[await render(homePage), await render(aboutPage), await render(postPage)],
			before,
			"an inactive identity leaves every page exactly as it was before adoption",
		);
		assert.equal((await call("save-admin-custom-schema", { id: "identity-owner", expectedRevision: null, name: "Old organization", scope: "global", json: owned, enabled: true })).data.success, true, "an inactive identity owns nothing");
		const on = await call("set-business-identity-active", { active: true, expectedRevision: off.data.revision, confirmed: true });
		assert.equal(on.data.error, "owned_id_defined", "activation is refused while a custom schema defines the ID");
		assert.deepEqual(on.data.definitions.map((item) => item.name), ["Old organization"]);

		// Race: the record lands after activation; the page keeps it whole and leaves the identity publisher off.
		const customId = (await pluginCtx.storage.schemas.query({ limit: 10 })).items.find((item) => item.data.name === "Old organization").id;
		await pluginCtx.storage.schemas.put(customId, { ...(await pluginCtx.storage.schemas.get(customId)), enabled: false });
		const reactivated = await call("set-business-identity-active", { active: true, expectedRevision: off.data.revision, confirmed: true });
		assert.equal(reactivated.data.success, true);
		await pluginCtx.storage.schemas.put(customId, { ...(await pluginCtx.storage.schemas.get(customId)), enabled: true });
		const raced = await render(postPage);
		const racedGraph = graphOf(raced, `custom:${customId}`);
		assert.deepEqual(Object.keys(racedGraph).sort(), ["@context", "@id", "@type", "name"], "the custom definition is kept whole, never reduced");
		assert.deepEqual([racedGraph["@type"], racedGraph.name], ["Organization", "Old"]);
		assert.equal(graphOf(raced, "preset:organization"), undefined, "the identity publisher is left off that page");
		assert.ok(!JSON.stringify(raced.filter((item) => item.kind === "jsonld" && !String(item.id).startsWith("custom:"))).includes('"publisher"'), "and no preset links a publisher there");
		await pluginCtx.storage.schemas.put(customId, { ...(await pluginCtx.storage.schemas.get(customId)), json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "Old", employee: { "@type": "Person", name: "Jane" } }) });
		const unsafe = await render(postPage);
		assert.equal(graphOf(unsafe, "preset:organization"), undefined, "a definition with nested facts also leaves the identity publisher off that page");
		assert.equal(graphOf(unsafe, `custom:${customId}`).employee.name, "Jane", "and keeps the custom graph");
		await pluginCtx.storage.schemas.delete(customId);

		// ---- Legacy settings guard ----
		const settings = (await call("admin-settings", {})).data;
		// A full save names the loaded revision and, with no record, the loaded legacy keys.
		const loadedGuard = settings.revision === null
			? { expectedRevision: null, expectedLegacyGuard: settings.legacyGuard }
			: { expectedRevision: settings.revision };
		const lockedChange = await call("save-admin-settings", { ...settings.values, organizationName: "Changed", ...loadedGuard });
		assert.equal(lockedChange.data.success, false, "legacy publisher fields are read-only while the identity is active");
		const siteName = await call("save-admin-settings", { ...settings.values, siteName: "Harbour Bakery NL", ...loadedGuard });
		assert.equal(siteName.data.success, true, "the site name keeps its own save");

		// ---- Portability leaves the record alone ----
		const identityBefore = await readRow();
		const articleProfile = await call("save-analysis-profile", { collection: "posts", profile: "article", expectedRevision: null });
		assert.equal(articleProfile.data.success, true, JSON.stringify(articleProfile.data).slice(0, 300));
		const exported = await call("admin-portability-export", {});
		assert.deepEqual(exported.data.bundle.configuration.analysisProfiles, { posts: { profile: "article", version: 1 } },
			"real prefix discovery exports only semantic profile selection, without stored revision or timestamp");
		assert.ok(!JSON.stringify(exported.data.bundle).includes("Kade 1"), "exports do not contain the business identity");
		assert.equal(Object.hasOwn(exported.data.bundle.configuration.settings, "contentScoringResourceNoticeVersion"), false);
		for (const mode of ["merge", "replace"]) {
			const loaded = (await call("admin-settings", {})).data;
			const activated = await call("save-content-scoring", {
				contentScoringEnabled: true,
				expectedContentScoringEnabled: loaded.values.contentScoringEnabled,
				expectedRevision: loaded.revision,
				expectedLegacyGuard: loaded.legacyGuard,
				resourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
			});
			assert.equal(activated.data.success, true, JSON.stringify(activated.data).slice(0, 300));
			assert.equal(activated.data.settings.contentScoring.state, "enabled", "control: local acknowledgement admits analysis before import");
			const loadedProfile = (await call("admin-analysis-profile", { collection: "posts" })).data.selection;
			assert.equal((await call("save-analysis-profile", { collection: "posts", profile: "general", expectedRevision: loadedProfile.revision })).data.success, true);
			const preview = await call("admin-portability-preview", { bundle: exported.data.bundle, mode });
			assert.equal(preview.data.success, true, JSON.stringify(preview.data).slice(0, 300));
			const applied = await call("admin-portability-apply", { bundle: exported.data.bundle, mode, confirmation: SEO_PORTABILITY_CONFIRMATION, planFingerprint: preview.data.plan.fingerprint });
			assert.equal(applied.data.success, true, JSON.stringify(applied.data).slice(0, 300));
			assert.deepEqual(await readRow(), identityBefore, `a ${mode} import leaves the record and its revision unchanged`);
			const persistedSettings = await pluginCtx.kv.get("settings:global:v1");
			assert.equal(Object.hasOwn(persistedSettings, "contentScoringResourceNoticeVersion"), false,
				`a ${mode} import removes acknowledgement from the real JSON-backed settings row`);
			assert.equal((await call("admin-settings", {})).data.contentScoring.state, "pending-confirmation",
				`a ${mode} import requires fresh acknowledgement after a confirmed SQLite write`);
			const importedProfile = (await call("admin-analysis-profile", { collection: "posts" })).data.selection;
			assert.equal(importedProfile.state, "configured");
			assert.equal(importedProfile.profile, "article", `a ${mode} import restores its exported assessment selection through real SQLite`);
			assert.equal(importedProfile.version, 1);
		}

		// ---- Fail closed ----
		await sql`update options set value = ${"null"} where name = ${optionName}`.execute(identityDb);
		const failed = await render(postPage);
		assert.equal(graphOf(failed, "preset:organization"), undefined, "a stored null emits no publisher");
		assert.ok(!JSON.stringify(failed.filter((item) => item.kind === "jsonld")).includes('"publisher"'), "and no publisher links");
		assert.equal((await call("admin-business-identity", {})).data.identity.state, "invalid");
		await sql`update options set value = ${"{not json"} where name = ${optionName}`.execute(identityDb);
		assert.equal((await call("admin-business-identity", {})).data.identity.state, "corrupt", "an unparsable row is reported as damaged");
		assert.equal(graphOf(await render(homePage), "preset:organization"), undefined, "and output fails closed");
		await sql`delete from options where name = ${optionName}`.execute(identityDb);
		assert.equal(graphOf(await render(homePage), "preset:organization")?.["@id"], `${site}/#organization`, "an absent record restores the legacy publisher");

		console.log(
			`Business identity routes passed through the published HTTP dispatcher with versioned plugin settings on EmDash ${target.versions.get("emdash")} with in-memory SQLite; ` +
			`page:metadata contributions were read from the plugin hook with a real plugin context (not the host page pipeline or HTML). ` +
			`Adoption: ${saveQueries.length} queries, 1 write (the identity row). Three page renders: ${absentQueries.length} queries while absent and ${renderQueries.length} while active, ` +
			`${identityReads} of them reads of the identity row, no writes and no read kind beyond the absent baseline.`,
		);
	} finally {
		await identityDb.destroy();
	}
	await reviewedFirstIdentityAdoptionSmoke({ SchemaRegistry, ContentRepository, PluginRouteRegistry, buildRouteMeta, parseRouteInput, dispatchPluginApiRequest, createSqliteSeoFixture });
}

async function reviewedFirstIdentityAdoptionSmoke({ SchemaRegistry, ContentRepository, PluginRouteRegistry, buildRouteMeta, parseRouteInput, dispatchPluginApiRequest, createSqliteSeoFixture }) {
	let counting = false;
	const queries = [];
	const freshDb = new Kysely({
		dialect: createDialect({ url: ":memory:" }),
		log(event) {
			if (counting && event.level === "query") queries.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
		},
	});
	const optionName = "plugin:shipit-seo:settings:business-identity:v1";
	const writes = (run) => run.filter((query) => /^\s*(insert|update|delete|replace)\b/i.test(query.sql));
	try {
		await runMigrations(freshDb);
		const site = "https://example.com";
		const seo = createSqliteSeoFixture(freshDb);
		if (syncDeclaredStorageIndexes) await syncDeclaredStorageIndexes(freshDb, [{ id: seo.id, storage: seo.storage }]);
		const schema = new SchemaRegistry(freshDb);
		await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" });
		await schema.createField("posts", { slug: "title", label: "Title", type: "string" });
		const post = await new ContentRepository(freshDb).create({ type: "posts", slug: "first-visit", data: { title: "First visit" }, status: "published", locale: "en" });
		const routeOptions = { db: freshDb, siteInfo: { siteUrl: site, siteName: "Example publisher" }, cronReschedule() { assert.fail("identity adoption must not schedule work"); } };
		const registry = new PluginRouteRegistry(routeOptions);
		registry.register(seo);
		const runtime = {
			getPluginRouteMeta(pluginId, path) {
				const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
				return route ? buildRouteMeta(route) : null;
			},
			async handlePluginApiRoute(pluginId, _method, path, request, caller) {
				const body = await parseRouteInput(request, this.getPluginRouteMeta(pluginId, path)?.request);
				return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
			},
		};
		const admin = { id: "admin", email: "admin@example.com", name: "Admin", role: 50 };
		async function call(route, body = {}) {
			const request = new Request(site + "/_emdash/api/plugins/shipit-seo/" + route, {
				method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" }, body: JSON.stringify(body),
			});
			const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: "/" + route, request, user: admin });
			return { status: response.status, data: (await response.json())?.data };
		}
		async function countedCall(route, body) {
			queries.length = 0;
			counting = true;
			try { return { result: await call(route, body), run: queries.slice() }; }
			finally { counting = false; }
		}
		const ctx = new PluginContextFactory(routeOptions).createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
		assert.equal(typeof ctx.settings?.getVersioned, "function");
		assert.equal(typeof ctx.settings?.compareAndDelete, "function");
		const readRow = async () => (await sql`select value, revision from options where name = ${optionName}`.execute(freshDb)).rows[0] ?? null;
		const otherOptions = async () => (await sql`select name, value, revision from options where name != ${optionName} order by name`.execute(freshDb)).rows;
		const initial = await call("admin-business-identity");
		assert.equal(initial.status, 200);
		assert.equal(initial.data.identity.state, "absent");
		assert.equal(initial.data.identity.legacy.publisherType, "organization");
		assert.equal(initial.data.identity.legacy.entityId, site + "/#organization");
		const publisherChange = { confirmed: true, fromEntityId: initial.data.identity.legacy.entityId, fromType: initial.data.identity.legacy.publisherType };
		const document = { kind: "Person", name: "Ada", contactPoints: [], sameAs: ["https://social.example/ada", "https://network.example/ada"], areaServed: [], target: { kind: "home" } };
		const beforeOptions = await otherOptions();
		const unreviewed = await countedCall("save-business-identity", { document, expectedRevision: null });
		assert.equal(unreviewed.result.data.error, "invalid", "first adoption in another family needs an explicit publisher review");
		assert.equal(writes(unreviewed.run).length, 0);
		assert.equal(await readRow(), null);
		assert.equal((await call("save-business-identity", { document, expectedRevision: null, publisherChange: { ...publisherChange, confirmed: false } })).status, 400, "the published dispatcher rejects an unconfirmed publisher change");

		const adopted = await countedCall("save-business-identity", { document, expectedRevision: null, publisherChange });
		assert.equal(adopted.result.status, 200);
		assert.equal(adopted.result.data.success, true, JSON.stringify(adopted.result.data));
		assert.equal(adopted.result.data.record.entityId, site + "/#person");
		assert.equal(adopted.result.data.record.organizationReferenceAliases, undefined);
		assert.equal(writes(adopted.run).length, 1);
		assert.ok(writes(adopted.run)[0].parameters.includes(optionName), "the only SQL write creates the identity row");
		assert.deepEqual(await otherOptions(), beforeOptions, "reviewed adoption leaves all legacy options and revisions unchanged");
		const stored = await ctx.settings.getVersioned("business-identity:v1");
		assert.equal(stored.revision, adopted.result.data.revision);
		assert.deepEqual(stored.value.sameAs, document.sameAs, "profiles persist in the host's versioned settings");
		assert.deepEqual((await call("admin-business-identity")).data.identity.record.sameAs, document.sameAs);
		const render = (path, entry) => seo.hooks["page:metadata"].handler({ page: {
			url: site + path, path, locale: "en", kind: entry ? "content" : "custom", pageType: "website",
			title: entry?.data?.title ?? "Home", pageTitle: entry?.data?.title ?? "Home", description: "", canonical: site + path, image: null,
			...(entry ? { content: { collection: "posts", id: entry.id, slug: entry.slug } } : {}),
			seo: {}, siteName: "Example publisher", siteUrl: site,
		} }, ctx);
		for (const contributions of [await render("/"), await render("/posts/first-visit", post)]) {
			const publisher = contributions.find((item) => item.kind === "jsonld" && item.id === "preset:organization")?.graph;
			assert.equal(publisher?.["@type"], "Person");
			assert.equal(publisher?.["@id"], site + "/#person");
			assert.deepEqual(publisher?.sameAs, document.sameAs, "full and minimal public publisher graphs retain the saved profiles");
		}
		assert.deepEqual(await otherOptions(), beforeOptions, "public hook rendering does not write legacy options");

		assert.equal((await ctx.settings.compareAndDelete("business-identity:v1", stored.revision)).applied, true);

		const settings = (await call("admin-settings")).data;
		const guard = settings.revision === null ? { expectedRevision: null, expectedLegacyGuard: settings.legacyGuard } : { expectedRevision: settings.revision };
		const changedPublisher = await call("save-admin-settings", { ...settings.values, publisherType: "person", personName: "Legacy person", ...guard });
		assert.equal(changedPublisher.data.success, true, "control: the ordinary settings API can change the legacy publisher while no identity exists");
		const changedOptions = await otherOptions();
		const stalePublisher = await countedCall("save-business-identity", { document, expectedRevision: null, publisherChange });
		assert.equal(stalePublisher.result.data.error, "conflict", "the real settings change invalidates the captured old publisher review");
		assert.equal(writes(stalePublisher.run).length, 0);
		assert.equal(await readRow(), null);
		assert.deepEqual(await otherOptions(), changedOptions, "refusing stale review never changes the new legacy settings");
		console.log("Reviewed first identity adoption SQL: " + JSON.stringify({
			adoption: { queries: adopted.run.length, writes: writes(adopted.run).length },
			unreviewed: { queries: unreviewed.run.length, writes: writes(unreviewed.run).length },
			stalePublisher: { queries: stalePublisher.run.length, writes: writes(stalePublisher.run).length },
		}));
	} finally {
		await freshDb.destroy();
	}
}
