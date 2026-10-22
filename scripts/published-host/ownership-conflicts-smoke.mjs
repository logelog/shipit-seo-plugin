// Saved ownership and guarded legacy removal through the published dispatcher.
// Every fixture lives in one migrated SQLite :memory: database; no server runs.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

assert.ok(["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name), "ownership smoke requires a verified native target");
assert.equal(process.versions.node, "24.19.0");
let networkAttempts = 0;
globalThis.fetch = async () => {
	networkAttempts += 1;
	throw new Error("Networking is disabled in the ownership smoke");
};

const host = hostPackageRoot("emdash");
async function hostDistExport(name) {
	const dist = new URL("dist/", host);
	for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const alias = readFileSync(new URL(file, dist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(new URL(file, dist).href))[alias];
	}
	throw new Error(`Published ${name} was not found`);
}
const hostIndex = readFileSync(new URL("dist/index.mjs", host), "utf8");
const contextImport = hostIndex.match(/import\s*\{[^}]*PluginStorageRepository[^}]*\}\s*from\s*"(\.\/context-[^"]+\.mjs)"/);
assert.ok(contextImport, "installed context factory import is present");
const contextUrl = new URL(contextImport[1], new URL("dist/", host));
const contextSource = readFileSync(contextUrl, "utf8");
const contextAlias = contextSource.match(/\bPluginContextFactory as ([A-Za-z_$][\w$]*)/);
assert.ok(contextAlias, "installed context factory export is present");
const PluginContextFactory = (await import(contextUrl.href))[contextAlias[1]];
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
const { SEO_ADMIN_OWNERSHIP_FIELDS, SEO_ADMIN_LEGACY_EXPORT_FORMAT, SEO_ADMIN_LEGACY_EXPORT_FORMAT_VERSION, SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES } = await source("admin-contract.ts");
const { parseSeoAdminEntryPreviewResult, parseSeoAdminMigrationPlan, parseSeoAdminLegacyDiscardResponse } = await source("admin-ui/contract.ts");
const { createSavedContentSnapshot } = await source("admin-ui/saved-content-snapshot.ts");

const SITE = "https://example.com";
const report = {
	target: target.name, emdash: target.versions.get("emdash"), storage: "migrated SQLite :memory:", checks: [], queries: {},
	queryComparison: {
		reference: "legacy-shadow-audit/owner-paths-result.json: 57 SELECTs per entryOnly preview",
		incrementalComparisonProved: false,
		reason: "The historical audit does not reconcile unchanged resolver dependencies at this source version; these are absolute counts with scoped-read and zero-write assertions.",
	},
	limits: ["Saved-state setup uses published repositories; no editor-save HTTP or rendered HTML proof.", "Mutation counts are attempted SQL statements, not proof of rows changed.", "No browser, sandbox transport, Postgres, D1 or Cloudflare proof."],
};
const check = (name) => report.checks.push(name);
const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
	},
});
async function counted(name, action, expectedWrites = 0) {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	const reads = run.filter(({ sql }) => /^\s*select\b/i.test(sql));
	const writes = run.filter(({ sql }) => /^\s*(insert|update|delete|replace)\b/i.test(sql));
	const contentReads = reads.filter(({ sql }) => /from "ec_/i.test(sql));
	assert.equal(writes.length, expectedWrites, `${name}: attempted mutation statements match the scoped operation and any injected fixture write`);
	assert.ok(contentReads.every(({ sql }) => /from "ec_posts"/i.test(sql) && /where\b/i.test(sql)), `${name}: no unrelated content or inventory reads`);
	assert.ok(reads.filter(({ sql }) => /from "_plugin_storage"/i.test(sql)).every(({ sql }) => /where\b/i.test(sql)), `${name}: plugin reads are scoped`);
	assert.ok(reads.length <= 96, `${name}: the single-record dispatcher path has a bounded read count`);
	report.queries[name] = { selects: reads.length, mutationStatements: writes.length, contentReads: contentReads.length };
	return value;
}

try {
	await runMigrations(db);
	const plugin = createPlugin();
	await syncDeclaredStorageIndexes(db, [{ id: plugin.id, storage: plugin.storage }]);
	const schema = new SchemaRegistry(db);
	await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] });
	for (const [slug, label] of [["title", "Title"], ["excerpt", "Excerpt"]]) await schema.createField("posts", { slug, label, type: "string" });
	const content = new ContentRepository(db);
	const entry = await content.create({ type: "posts", slug: "ownership-entry", status: "published", locale: "en", data: { title: "Ownership entry", excerpt: "An isolated saved ownership fixture." } });
	const ref = `posts:${entry.id}`;
	const alias = `posts:${entry.slug}`;
	const routeOptions = { db, siteInfo: { siteUrl: SITE, siteName: "Audit Site", url: SITE, name: "Audit Site" }, cronReschedule() {} };
	let conditionalUnavailable = false;
	let unconditionalDeletes = 0;
	let beforeConditionalDelete = null;
	for (const name of ["core-seo-migration-plan", "discard-admin-legacy-override"]) {
		const original = plugin.routes[name].handler;
		plugin.routes[name].handler = async (ctx) => {
			if (!conditionalUnavailable && !beforeConditionalDelete) return original(ctx);
			const store = ctx.storage.overrides;
			const overrides = new Proxy(store, {
				get(target, key) {
					if (conditionalUnavailable && ["getVersioned", "compareAndSet", "compareAndDelete"].includes(key)) return undefined;
					if (conditionalUnavailable && key === "delete") return async () => { unconditionalDeletes += 1; throw new Error("Unconditional removal must not run"); };
					const value = Reflect.get(target, key);
					if (key === "compareAndDelete" && beforeConditionalDelete) return async (...args) => {
						const mutate = beforeConditionalDelete;
						beforeConditionalDelete = null;
						await mutate(target, args[0]);
						return value.apply(target, args);
					};
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
			return original({ ...ctx, storage: { ...ctx.storage, overrides } });
		};
	}
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
	const people = {
		admin: { id: "audit-admin", email: "admin@example.com", name: "Audit Admin", role: 50 },
		editor: { id: "audit-editor", email: "editor@example.com", name: "Audit Editor", role: 40 },
	};
	async function call(route, body, { user = people.admin, csrf = true } = {}) {
		assert.ok(["admin-entry-preview", "core-seo-migration-plan", "discard-admin-legacy-override"].includes(route));
		const request = new Request(`${SITE}/_emdash/api/plugins/shipit-seo/${route}`, {
			method: "POST", headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) }, body: JSON.stringify(body),
		});
		const response = await dispatchPluginApiRequest({ runtime, pluginId: plugin.id, path: `/${route}`, request, user });
		const envelope = JSON.parse(await response.text());
		return { status: response.status, data: envelope.data, error: envelope.error };
	}
	const ctx = new PluginContextFactory(routeOptions).createContext({ id: plugin.id, version: "0.0.0", capabilities: plugin.capabilities, admin: {}, storage: plugin.storage, allowedHosts: [] });
	const core = new SeoRepository(db);
	const saved = { title: "Core title before", description: "Core description before", canonical: `${SITE}/posts/core-before`, image: `${SITE}/core-before.jpg`, noIndex: false };
	const legacy = { ref, title: "Legacy title", description: "Legacy description", canonical: `${SITE}/posts/legacy`, ogImage: `${SITE}/legacy.jpg`, robots: "noindex,nofollow,noarchive", updatedAt: "2026-10-03T12:00:00.000Z", unsupported: { retained: ["all", "fields", "é"] } };
	await core.upsert("posts", entry.id, saved);
	async function snapshot() {
		const response = await handleContentGet(db, "posts", entry.id);
		assert.equal(response.success, true, JSON.stringify(response.error));
		return createSavedContentSnapshot(ref, JSON.parse(JSON.stringify(response.data.item)));
	}
	async function preview(name, input = {}) {
		const response = await counted(name, () => call("admin-entry-preview", { ref, entryOnly: true, ...input }));
		assert.equal(response.status, 200, JSON.stringify(response.error));
		const result = parseSeoAdminEntryPreviewResult(response.data);
		assert.equal(result.success, true);
		assert.ok(result.preview.ownership, "ownership data is returned on the allocated native route");
		assert.deepEqual(result.preview.ownership.fields.map((field) => field.field), SEO_ADMIN_OWNERSHIP_FIELDS);
		return result.preview;
	}
	const fieldOf = (preview, field) => preview.ownership.fields.find((item) => item.field === field);
	const control = await preview("core-control");
	assert.equal(control.search.description, saved.description);
	assert.equal(control.ownership.status, "current");
	assert.equal(control.ownership.locale, "en");
	assert.equal(control.ownership.record, null);
	assert.ok(control.ownership.fields.every((field) => field.state === "not-shadowed"));
	check("core-only control is current and names no legacy record");

	await ctx.storage.overrides.put(ref, legacy);
	const shadow = await preview("exact-id");
	assert.deepEqual(shadow.ownership.record, { sourceOverrideId: ref, keyKind: "id" });
	assert.ok(shadow.ownership.fields.every((field) => field.state === "conflict"));
	assert.deepEqual(shadow.ownership.unsupportedDirectives, { state: "present", tokens: ["noarchive"] });
	assert.equal(fieldOf(shadow, "description").core, saved.description);
	assert.equal(fieldOf(shadow, "description").effective, legacy.description);
	assert.equal(fieldOf(shadow, "title").social.value, legacy.title);
	check("exact-ID ownership reports stored core, legacy output and unsupported directives");

	const previousSnapshot = await snapshot();
	const afterSave = { ...saved, description: "Core description after save" };
	await core.upsert("posts", entry.id, afterSave);
	const newSnapshot = await snapshot();
	assert.notEqual(newSnapshot.sourceVersion, previousSnapshot.sourceVersion);
	const fresh = await preview("saved-core-change", { snapshot: newSnapshot });
	assert.equal(fresh.ownership.status, "current");
	assert.equal(fresh.ownership.sourceVersion, newSnapshot.sourceVersion);
	assert.equal(fieldOf(fresh, "description").core, afterSave.description);
	assert.equal(fieldOf(fresh, "description").effective, legacy.description);
	const stale = await preview("old-snapshot", { snapshot: previousSnapshot });
	assert.equal(stale.ownership.status, "stale");
	assert.equal(stale.ownership.reason, "saved-version-mismatch");
	assert.ok(stale.ownership.fields.every((field) => field.state === "unknown"));
	const fabricated = await preview("fabricated-seo", { snapshot: { ...newSnapshot, seo: { ...newSnapshot.seo, description: "Fabricated saved core" } } });
	assert.equal(fabricated.ownership.status, "unknown");
	assert.equal(fabricated.ownership.reason, "snapshot-seo-mismatch");
	assert.ok(fabricated.ownership.fields.every((field) => field.state === "unknown"));
	check("a core save updates authoritative values; old and fabricated snapshots cannot claim current ownership");
	await ctx.storage.overrides.put(ref, { ...legacy, title: saved.title });
	const matching = await preview("equal-title");
	assert.equal(fieldOf(matching, "title").state, "equal");
	assert.equal(fieldOf(matching, "description").state, "conflict");
	check("equal legacy and saved core values are ownership information");

	await ctx.storage.overrides.delete(ref);
	await ctx.storage.overrides.put(alias, { ...legacy, ref });
	const aliasPreview = await preview("slug-alias");
	assert.deepEqual(aliasPreview.ownership.record, { sourceOverrideId: alias, keyKind: "slug-alias" });
	assert.equal(fieldOf(aliasPreview, "description").effective, legacy.description);
	check("slug-alias output identifies the shared alias key");
	await ctx.storage.overrides.delete(alias);
	await ctx.storage.overrides.put(ref, legacy);

	for (const [name, options] of [["editor-denial", { user: people.editor }], ["csrf-denial", { csrf: false }]]) {
		const denied = await counted(name, () => call("admin-entry-preview", { ref, entryOnly: true }, options));
		assert.equal(denied.status, 403);
		assert.equal(report.queries[name].selects, 0, "permission/CSRF refusal precedes plugin reads");
	}
	check("Editor permission and absent CSRF header refuse ownership before plugin reads");

	const policy = "skip";
	async function plan(name, sourceOverrideId = ref, withSnapshot = true) {
		const response = await counted(name, () => call("core-seo-migration-plan", {
			refs: [sourceOverrideId], conflictPolicy: policy, limit: 1, ...(withSnapshot ? { snapshot: true } : {}),
		}));
		assert.equal(response.status, 200, JSON.stringify(response.error));
		const result = parseSeoAdminMigrationPlan(response.data);
		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].sourceOverrideId, sourceOverrideId);
		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);
		return result;
	}
	function exportedRecord(result, expectedRecord, locale) {
		const item = result.items[0];
		assert.equal(item.snapshot.status, "available");
		assert.equal(item.snapshot.bytes, new TextEncoder().encode(item.snapshot.document).byteLength);
		assert.ok(item.snapshot.bytes <= SEO_ADMIN_LEGACY_EXPORT_MAX_BYTES);
		const exported = JSON.parse(item.snapshot.document);
		assert.deepEqual({ format: exported.format, formatVersion: exported.formatVersion }, { format: SEO_ADMIN_LEGACY_EXPORT_FORMAT, formatVersion: SEO_ADMIN_LEGACY_EXPORT_FORMAT_VERSION });
		assert.equal(exported.generatedAt, result.generatedAt);
		assert.equal(exported.migrationVersion, result.migrationVersion);
		assert.equal(exported.sourceOverrideId, item.sourceOverrideId);
		assert.equal(exported.reference, item.ref);
		assert.equal(exported.fingerprint, item.fingerprint);
		assert.equal(exported.conflictPolicy, policy);
		assert.deepEqual(exported.entry, { ref, collection: "posts", entryId: entry.id, locale });
		assert.deepEqual(exported.record, expectedRecord, "the same plan carries the complete unmodified raw record");
		return exported;
	}
	async function discard(name, item, expectedWrites = 0, options) {
		const response = await counted(name, () => call("discard-admin-legacy-override", {
			sourceOverrideId: item.sourceOverrideId, fingerprint: item.fingerprint, conflictPolicy: policy, confirm: "DISCARD_LEGACY_SEO",
		}, options), expectedWrites);
		assert.equal(response.status, 200, JSON.stringify(response.error));
		return parseSeoAdminLegacyDiscardResponse(response.data);
	}
	const ordinaryPlan = await plan("ordinary-plan", ref, false);
	assert.equal(ordinaryPlan.items[0].snapshot, undefined, "raw export is opt-in");
	const boundPlan = await plan("bound-export");
	assert.equal(boundPlan.writeAvailable, false, "published native host has no conditional core SEO writer");
	assert.equal(boundPlan.discardAvailable, true, "conditional removal is a separate capability");
	exportedRecord(boundPlan, legacy, "en");
	assert.equal(report.queries["bound-export"].selects, report.queries["ordinary-plan"].selects, "export uses the existing selected-plan snapshot without another raw read");
	check("opt-in complete raw export shares the plan fingerprint, exact entry, actual locale and measured UTF-8 document");
	for (const [route, input] of [
		["core-seo-migration-plan", { refs: [ref], limit: 1, snapshot: true }],
		["discard-admin-legacy-override", { sourceOverrideId: ref, fingerprint: boundPlan.items[0].fingerprint, conflictPolicy: policy, confirm: "DISCARD_LEGACY_SEO" }],
	]) {
		const name = `editor-${route}`;
		assert.equal((await counted(name, () => call(route, input, { user: people.editor }))).status, 403);
		assert.equal(report.queries[name].selects, 0);
	}
	check("Editor access to the bound export and guarded discard is refused before plugin reads");

	await ctx.storage.overrides.delete(ref);
	await ctx.storage.overrides.put(alias, legacy);
	const aliasExport = await plan("alias-export-refusal", alias);
	assert.deepEqual(aliasExport.items[0].snapshot, { status: "refused", reason: "not-exact-id" });
	await ctx.storage.overrides.delete(alias);
	await ctx.storage.overrides.put(ref, legacy);
	for (const input of [
		{ refs: [ref], limit: 2, snapshot: true },
		{ refs: [ref, alias], limit: 1, snapshot: true },
		{ refs: [ref], limit: 1, snapshot: true, cursor: "overrides:any" },
	]) {
		const refused = await counted(`invalid-export-${report.checks.length}-${input.limit}-${input.refs.length}-${Boolean(input.cursor)}`, () => call("core-seo-migration-plan", input));
		assert.equal(refused.status, 400);
	}
	check("alias exports and snapshots with more than one record, limit 1 violated or a cursor are refused");

	const changedRaw = { ...legacy, unsupported: { ...legacy.unsupported, changedAfterExport: true } };
	await ctx.storage.overrides.put(ref, changedRaw);
	assert.deepEqual(await discard("raw-change-refusal", boundPlan.items[0]), { success: false, contractVersion: boundPlan.contractVersion, engineVersion: boundPlan.engineVersion, error: "preview_stale" });
	assert.deepEqual(await ctx.storage.overrides.get(ref), changedRaw);
	const changedRawPlan = await plan("changed-raw-export");
	assert.notEqual(changedRawPlan.items[0].fingerprint, boundPlan.items[0].fingerprint);
	exportedRecord(changedRawPlan, changedRaw, "en");

	// Change only this in-memory row's locale, leaving core SEO and its version stable.
	const beforeLocale = await snapshot();
	await db.updateTable("ec_posts").set({ locale: "nl" }).where("id", "=", entry.id).execute();
	assert.equal((await snapshot()).sourceVersion, beforeLocale.sourceVersion);
	const localeRefusal = await discard("locale-change-refusal", changedRawPlan.items[0]);
	assert.deepEqual([localeRefusal.success, localeRefusal.error], [false, "preview_stale"]);
	assert.deepEqual(await ctx.storage.overrides.get(ref), changedRaw);
	const localePlan = await plan("actual-locale-export");
	assert.notEqual(localePlan.items[0].fingerprint, changedRawPlan.items[0].fingerprint);
	exportedRecord(localePlan, changedRaw, "nl");
	assert.equal((await preview("actual-locale-preview")).ownership.locale, "nl");
	check("raw unsupported-field and locale changes invalidate the reviewed export before removal");

	conditionalUnavailable = true;
	const unavailablePlan = await plan("no-conditional-plan");
	assert.equal(unavailablePlan.discardAvailable, false);
	const unavailable = await discard("no-conditional-discard", unavailablePlan.items[0]);
	assert.deepEqual([unavailable.success, unavailable.error], [false, "discard_unavailable"]);
	assert.equal(report.queries["no-conditional-discard"].selects, 0, "unavailable removal is refused before reading the record");
	assert.equal(unconditionalDeletes, 0);
	assert.deepEqual(await ctx.storage.overrides.get(ref), changedRaw);
	conditionalUnavailable = false;
	check("a simulated host without conditional storage offers no discard and never falls back to delete");

	const racedRecord = { ...changedRaw, concurrentMarker: "saved immediately before conditional delete" };
	beforeConditionalDelete = async (store, id) => store.put(id, racedRecord);
	const raced = await discard("conditional-delete-race", localePlan.items[0], 2);
	assert.deepEqual([raced.success, raced.error], [false, "preview_stale"]);
	assert.equal(beforeConditionalDelete, null, "the race ran at the installed conditional-delete boundary");
	assert.deepEqual(await ctx.storage.overrides.get(ref), racedRecord, "the concurrently changed record survives the revision-guarded delete");
	Object.assign(report.queries["conditional-delete-race"], { injectedFixturePutStatements: 1, guardedDeleteAttempted: true, guardedDeleteApplied: false, newerRecordPreserved: true });
	check("one injected fixture PUT precedes an attempted guarded DELETE; stale refusal and the surviving newer row prove no removal");

	const reviewed = await plan("reviewed-export-after-race");
	const backup = exportedRecord(reviewed, racedRecord, "nl");
	const removed = await discard("guarded-discard", reviewed.items[0], 1);
	assert.equal(removed.success, true);
	assert.deepEqual(removed.discarded, backup.record);
	assert.deepEqual(removed.nextOwner, { kind: "core-seo" });
	assert.equal(await ctx.storage.overrides.get(ref), null);
	const restoredOwner = await preview("core-after-discard");
	assert.equal(restoredOwner.ownership.record, null);
	assert.equal(restoredOwner.search.description, afterSave.description);
	assert.equal(restoredOwner.social.title, afterSave.title);
	assert.equal(restoredOwner.indexable, true);
	assert.deepEqual(restoredOwner.ownership.unsupportedDirectives, { state: "none", tokens: [] });
	assert.deepEqual(await core.get("posts", entry.id), afterSave, "discard never writes core SEO");
	check("reviewed conditional removal returns the backed-up record and preview ownership returns to saved core");

	assert.equal(networkAttempts, 0);
	report.result = "passed";
	const output = JSON.stringify(report);
	assert.ok(Buffer.byteLength(output) <= 64 * 1024, "the smoke report stays bounded");
	console.log(output);
	console.log(`Ownership conflicts passed through the published dispatcher with in-memory SQLite (${report.checks.length} check groups).`);
} finally {
	await db.destroy();
}
