// Private contextual-link route proof on one disposable, migrated SQLite database.
// Driver observations include SDK hydration, returned rows and errors. They do
// not establish physical reads, CPU, D1, Postgres, sandbox or browser behavior.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === "--target" && ["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(args[1]),
	"Usage: node scripts/published-host/internal-link-routes-smoke.mjs --target native-1.1.0|native-1.2.0|native-1.3.0");
process.env.SHIPIT_HOST_TARGET = args[1];
const { hostPackageRoot, sourceRoot, target } = await import("./host-loader.mjs");
assert.equal(target.name, args[1]);

const realFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
	networkCalls += 1;
	throw new Error("External networking is disabled in this smoke check");
};

const { Kysely, sql } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const { adaptSandboxEntry } = await import("emdash");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createSeoEngine } = await source("sandbox-entry.ts");
const { seoInstallation, seoPlugin } = await source("index.ts");
const { createLinkNativeHostFactory } = await source("internal-link-native-host.ts");
const { createLinkHostPorts } = await source("internal-link-host-ports.ts");
const { GLOBAL_SETTINGS_KEY } = await source("settings-runtime.ts");
const { SEO_ADMIN_SETTINGS_STORAGE_VERSION } = await source("admin-contract.ts");

async function hostDistExport(name) {
	const dist = new URL("dist/", hostPackageRoot("emdash"));
	for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const alias = readFileSync(new URL(file, dist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(new URL(file, dist).href))[alias];
	}
	throw new Error(`Published ${name} was not found`);
}
const SchemaRegistry = await hostDistExport("SchemaRegistry");
const ContentRepository = await hostDistExport("ContentRepository");
const RevisionRepository = await hostDistExport("RevisionRepository");
const PluginContextFactory = await hostDistExport("PluginContextFactory");
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const setI18nConfig = await hostDistExport("setI18nConfig");
setI18nConfig({ defaultLocale: "en", locales: ["en", "fr"], prefixDefaultLocale: false });

const SITE = "https://example.com";
const SOURCE = "link_sources";
const DESTINATION = "link_targets";
const SOURCE_TABLE = "ec_" + SOURCE;
const TARGET_TABLE = "ec_" + DESTINATION;
const PHRASE = "Drip irrigation";
const STAMP = "2026-10-04 12:00:00";
const TARGET_ID = (index) => "01K" + String(index).padStart(23, "0");
const TERM = "01T" + String(1).padStart(23, "0");
const TERM_GROUP = "topic-group-water";
const SCORE_COLLECTIONS = ["scores", "scoreHistory", "scoreAnalysisRevisions", "analysisProfiles", "scoreScanJobs"];
const ROUTES = ["find-link-suggestions", "next-link-suggestions", "verify-link-suggestion", "check-saved-link"];
const CAP = 49_152;
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const clone = (value) => JSON.parse(JSON.stringify(value));
const statements = [];
let phase = { owner: "fixture", label: "setup" };
let nativeDatabaseOpenings = 0;
let dispatchedHandlers = 0;
let foreignKeyBoundaryChecks = 0;

async function tagged(owner, label, action) {
	const previous = phase;
	phase = { owner, label };
	try { return await action(); } finally { phase = previous; }
}
const fixture = (label, action) => tagged("fixture", label, action);
const preparation = (label, action) => tagged("preparation", label, action);

function observedDialect(dialect) {
	return new Proxy(dialect, {
		get(object, property) {
			const value = Reflect.get(object, property, object);
			if (property !== "createDriver") return typeof value === "function" ? value.bind(object) : value;
			return () => {
				const driver = object.createDriver();
				const observed = new WeakMap();
				const originals = new WeakMap();
				return new Proxy(driver, {
					get(owner, key) {
						if (key === "acquireConnection") return async (...args) => {
							const connection = await owner.acquireConnection(...args);
							if (observed.has(connection)) return observed.get(connection);
							const wrapped = new Proxy(connection, {
								get(origin, method) {
									const member = Reflect.get(origin, method, origin);
									if (method !== "executeQuery") return typeof member === "function" ? member.bind(origin) : member;
									return async (query) => {
										assert.ok(statements.length < 20_000, "The route fixture exceeded its statement bound");
										const entry = { ...phase, sql: query.sql, parameters: [...query.parameters], returnedRows: 0,
											rowKeys: [], returnedTextBytes: 0, bodyBytes: 0, revisionDataBytes: 0 };
										statements.push(entry);
										try {
											const result = await member.call(origin, query);
											entry.returnedRows = result.rows.length;
											entry.rowKeys = [...new Set(result.rows.flatMap((row) => Object.keys(row)))].sort();
											for (const row of result.rows) for (const [column, cell] of Object.entries(row)) {
												if (typeof cell !== "string") continue;
												const length = Buffer.byteLength(cell);
												entry.returnedTextBytes += length;
												if (column === "body") entry.bodyBytes += length;
												if (column === "data" && /\bfrom\s+"?revisions"?\b/i.test(entry.sql)) entry.revisionDataBytes += length;
											}
											return result;
										} catch (error) {
											entry.error = String(error instanceof Error ? error.message : error).slice(0, 256);
											throw error;
										}
									};
								},
							});
							observed.set(connection, wrapped);
							originals.set(wrapped, connection);
							return wrapped;
						};
						if (key === "releaseConnection") return (connection, ...args) => owner.releaseConnection(originals.get(connection) ?? connection, ...args);
						const member = Reflect.get(owner, key, owner);
						return typeof member === "function" ? member.bind(owner) : member;
					},
				});
			};
		},
	});
}

const db = new Kysely({ dialect: observedDialect(createDialect({ url: ":memory:" })) });
const report = {
	target: target.name, emdash: target.versions.get("emdash"), storage: "migrated sqlite :memory:", workers: 1, status: "running",
	measurementLimit: "Complete driver statements, returned rows and errors, including full SDK row hydration. Authenticated caller state is supplied to the real dispatcher. Not bearer authentication middleware, physical reads, CPU, D1, Postgres, sandbox or browser evidence.",
	checks: [], measurements: [], sqlShapes: [],
};
const check = (name) => report.checks.push(name);
const isSelect = (entry) => /^\s*select\b/i.test(entry.sql);
const isWrite = (entry) => /^\s*(insert|update|delete|replace|create|alter|drop)\b/i.test(entry.sql);
const from = (entry, table) => /^\s*select[\s\S]*?\bfrom\s+"?([a-z0-9_]+)/i.exec(entry.sql)?.[1]?.toLowerCase() === table.toLowerCase();
const fullRow = (entry, table) => new RegExp(`^\\s*select\\s+\\*\\s+from\\s+"?${table}"?\\b`, "i").test(entry.sql);

function kindOf(entry) {
	if (!isSelect(entry)) return isWrite(entry) ? "write" : "other";
	if (from(entry, SOURCE_TABLE)) return fullRow(entry, SOURCE_TABLE) ? "source-hydration" : "source-other";
	if (from(entry, TARGET_TABLE)) {
		if (fullRow(entry, TARGET_TABLE)) return "sdk-target-hydration";
		if (/^\s*select "id", "locale", "translation_group", "status", "deleted_at" from /i.test(entry.sql)) return "candidate-window";
		if (/^\s*select "id" from /i.test(entry.sql)) return /order by "id" desc/i.test(entry.sql) ? "upper-id" : "sentinel";
		return "target-projection";
	}
	if (from(entry, "revisions")) return "revision";
	if (from(entry, "_emdash_collections")) return "collection";
	if (from(entry, "_emdash_fields")) return "fields";
	if (from(entry, "_emdash_taxonomy_defs")) return "taxonomy";
	if (from(entry, "taxonomies")) return "terms";
	if (from(entry, "content_taxonomies")) return "membership";
	if (from(entry, "_emdash_seo")) return "core-seo";
	if (from(entry, "_plugin_storage")) return "plugin-storage";
	if (from(entry, "options")) return entry.parameters.includes("site:timezone") ? "host-timezone" : "settings";
	return "other";
}

function assertProductReads(run, label) {
	for (const entry of run) {
		assert.ok(isSelect(entry), label + ": unexpected non-SELECT: " + entry.sql.slice(0, 160));
		assert.doesNotMatch(entry.sql, /\bcount\s*\(/i, label + ": an operation counted content");
		if (from(entry, "_plugin_storage")) {
			assert.ok(entry.parameters.includes("shipit-seo") && entry.parameters.includes("overrides"), label + ": unrelated plugin storage read");
			assert.ok(SCORE_COLLECTIONS.every((collection) => !entry.parameters.includes(collection)), label + ": score/history read");
		}
		if (from(entry, "_emdash_collections") || from(entry, "_emdash_fields")) {
			assert.ok([SOURCE, DESTINATION, sourceCollectionId, targetCollectionId].some((identity) => entry.parameters.includes(identity)),
				label + ": unscoped or unrelated schema read");
		}
		if (from(entry, SOURCE_TABLE) && fullRow(entry, SOURCE_TABLE)) {
			assert.ok(entry.parameters.includes(savedSource.id), label + ": source hydration lacks its exact ID");
			assert.ok(entry.returnedRows <= 1, label + ": source hydration returned more than one row");
		}
		if (kindOf(entry) === "candidate-window") {
			assert.equal(entry.parameters.at(-1), 200, label + ": raw candidate window limit");
			assert.ok(entry.returnedRows <= 200);
			assert.deepEqual(entry.rowKeys, entry.returnedRows ? ["deleted_at", "id", "locale", "status", "translation_group"] : []);
		}
		if (kindOf(entry) === "sdk-target-hydration") {
			assert.ok(entry.returnedRows <= 1, label + ": SDK URL hydration is exact");
			assert.match(entry.sql, /where id = \?\s+and deleted_at is null/i);
		}
		if (kindOf(entry) === "target-projection") {
			assert.doesNotMatch(entry.sql, /"(?:body|data|draft_revision_id|live_revision_id)"/i, label + ": candidate or target body projection");
			assert.ok(entry.returnedRows <= 25, label + ": projection exceeds matched references");
		}
	}
}

let savedSource;
let sourceCollectionId;
let targetCollectionId;
let ctx;
let runtime;
let seo;
const people = {
	editor: { id: "editor", email: "editor@example.com", name: "Editor", role: 40 },
	admin: { id: "admin", email: "admin@example.com", name: "Admin", role: 50 },
};

async function call(route, input, options = {}) {
	const method = options.method ?? "POST";
	const headers = new Headers({ "Content-Type": "application/json" });
	if (options.csrf !== false) headers.set("X-EmDash-Request", "1");
	for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
	const body = method === "GET" || method === "HEAD" ? undefined : options.rawBody ?? JSON.stringify(input);
	const request = new Request(`${SITE}/_emdash/api/plugins/shipit-seo/${route}`, { method, headers, ...(body === undefined ? {} : { body }) });
	const response = await dispatchPluginApiRequest({
		runtime, pluginId: seo.id, path: "/" + route, request,
		user: options.user === null ? undefined : options.user ?? people.admin,
		...(options.tokenScopes === undefined ? {} : { tokenScopes: options.tokenScopes }),
	});
	const raw = await response.text();
	const payload = JSON.parse(raw);
	assert.equal(response.headers.get("Cache-Control"), "private, no-store", route + ": cache policy");
	assert.ok(Buffer.byteLength(raw) <= CAP, route + ": wrapped response exceeds 48 KiB");
	if (payload.success === true) assert.equal(Buffer.byteLength(raw), bytes(payload.data) + 24, route + ": success wrapper reserve");
	return { status: response.status, data: payload.data, error: payload.error, allow: response.headers.get("Allow"),
		responseBytes: Buffer.byteLength(raw), requestBytes: typeof body === "string" ? Buffer.byteLength(body) : body?.byteLength ?? 0 };
}

async function measure(label, route, input, options = {}) {
	const foreignKeys = await tagged("control", label + "-foreign-key-boundary", () => sql`PRAGMA foreign_keys`.execute(db));
	assert.equal(foreignKeys.rows[0]?.foreign_keys, 1, label + ": foreign keys must be enabled before the route request");
	foreignKeyBoundaryChecks += 1;
	const start = statements.length;
	const openings = nativeDatabaseOpenings;
	const handlers = dispatchedHandlers;
	const result = await tagged("product", label, () => call(route, input, options));
	const observed = statements.slice(start);
	const product = observed.filter((entry) => entry.owner === "product");
	assertProductReads(product, label);
	const byKind = {};
	for (const entry of product) {
		const kind = kindOf(entry);
		const totals = byKind[kind] ??= { statements: 0, returnedRows: 0, errors: 0, maxRows: 0 };
		totals.statements += 1;
		totals.returnedRows += entry.returnedRows;
		totals.errors += Number(Boolean(entry.error));
		totals.maxRows = Math.max(totals.maxRows, entry.returnedRows);
		if (!report.sqlShapes.some((shape) => shape.kind === kind)) {
			report.sqlShapes.push({ kind, sql: entry.sql.slice(0, 768), truncated: entry.sql.length > 768, parameterCount: entry.parameters.length });
		}
	}
	const measurement = {
		label, route, status: result.status, outcome: result.data?.kind ?? result.error?.code ?? "unknown",
		statements: product.length, selects: product.filter(isSelect).length, writes: product.filter(isWrite).length,
		returnedRows: product.reduce((total, entry) => total + entry.returnedRows, 0), errors: product.filter((entry) => entry.error).length,
		returnedTextBytes: product.reduce((total, entry) => total + entry.returnedTextBytes, 0),
		sourceBodyBytes: product.filter((entry) => kindOf(entry) === "source-hydration").reduce((total, entry) => total + entry.bodyBytes, 0),
		revisionDataBytes: product.reduce((total, entry) => total + entry.revisionDataBytes, 0),
		sdkTargetBodyBytes: product.filter((entry) => kindOf(entry) === "sdk-target-hydration").reduce((total, entry) => total + entry.bodyBytes, 0),
		nativeDatabaseOpenings: nativeDatabaseOpenings - openings, dispatchedHandlers: dispatchedHandlers - handlers,
		fixtureWrites: observed.filter((entry) => entry.owner === "fixture" && isWrite(entry)).length,
		requestBytes: result.requestBytes, responseBytes: result.responseBytes, byKind,
	};
	assert.equal(measurement.writes, 0, label + ": product write");
	assert.ok(measurement.nativeDatabaseOpenings <= 1, label + ": native connection opened more than once");
	report.measurements.push(measurement);
	return { ...result, product, measurement };
}

function noReads(run, status, label) {
	assert.equal(run.status, status, label);
	assert.equal(run.measurement.statements, 0, label + ": SQL before refusal");
	assert.equal(run.measurement.nativeDatabaseOpenings, 0, label + ": native database before refusal");
}
function pageOf(run, label) {
	assert.equal(run.status, 200, label);
	assert.equal(run.data?.kind, "result", label + ": " + JSON.stringify(run.data));
	return run.data;
}
function chosenRequest(page) {
	assert.ok(page.response.suggestions.length > 0, "Find must return a contextual suggestion");
	return { owner: clone(page.response.owner), policyVersion: page.response.policyVersion, suggestion: clone(page.response.suggestions[0]) };
}
function verificationOf(run, kind, label) {
	assert.equal(run.status, 200, label);
	assert.equal(run.data?.kind, "verification", label + ": " + JSON.stringify(run.data));
	assert.equal(run.data.verification.kind, kind, label + ": " + JSON.stringify(run.data.verification));
	return run.data.verification;
}

const span = (key, text, marks = []) => ({ _type: "span", _key: key, text, marks });
const paragraph = (key, text, marks = []) => ({ _type: "block", _key: key, style: "normal", markDefs: [], children: [span(key + "-main", text, marks)] });
function savedBody(phrase = PHRASE, marks = ["strong", "superscript"]) {
	return Array.from({ length: 5 }, (_, index) => ({
		...paragraph("source-p" + (index + 1), `Use ${phrase} to keep soil moist in bed ${index + 1}.`, marks),
		children: [span("source-p" + (index + 1) + "-main", `Use ${phrase} to keep soil moist in bed ${index + 1}.`, marks),
			span("source-p" + (index + 1) + "-aside", " Keep the neighbouring seedlings undisturbed.", ["em"])],
	}));
}
function linkedBody(body, request, href) {
	const result = clone(body);
	const anchor = request.suggestion.anchor;
	const block = result.find((item) => item._key === anchor.blockKey);
	assert.ok(block);
	const index = block.children.findIndex((item) => item._key === anchor.spanKey);
	assert.ok(index >= 0);
	const original = block.children[index];
	assert.equal(original.text.slice(anchor.start, anchor.end), anchor.text);
	const replacement = [];
	if (anchor.start > 0) replacement.push(span("saved-before", original.text.slice(0, anchor.start), [...original.marks]));
	replacement.push(span("saved-anchor-new-key", anchor.text, [...original.marks, "chosen-link"]));
	if (anchor.end < original.text.length) replacement.push(span("saved-after", original.text.slice(anchor.end), [...original.marks]));
	block.children.splice(index, 1, ...replacement);
	block.markDefs = [{ _key: "chosen-link", _type: "link", href }];
	return result;
}

let content;
let revisions;
const globalSettings = {
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-04T12:00:00.000Z", siteName: "Garden", siteUrl: SITE,
	organizationName: "Garden", organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "",
	noindex: false, indexingPreferenceConfirmed: true,
};
const snapshotScores = () => fixture("score-history-snapshot", () => db.selectFrom("_plugin_storage").selectAll()
	.where("plugin_id", "=", "shipit-seo").where("collection", "in", SCORE_COLLECTIONS).orderBy("collection").orderBy("id").execute());
async function stageBody(body, label) {
	return fixture(label, async () => {
		const live = await content.findById(SOURCE, savedSource.id);
		const revision = await revisions.create({ collection: SOURCE, entryId: savedSource.id, data: { ...live.data, body, _slug: live.slug } });
		await content.setDraftRevision(SOURCE, savedSource.id, revision.id);
		return revision;
	});
}
async function sourceInput(label, taxonomy = null, generation = 7) {
	const read = await preparation(label, () => createLinkHostPorts(ctx).source.readSource({ collection: SOURCE, entryId: savedSource.id }));
	assert.equal(read.kind, "found", label + ": " + JSON.stringify(read));
	assert.equal(read.document.field, "body");
	return { source: { collection: SOURCE, entryId: savedSource.id, locale: "en", sourceVersion: read.document.sourceVersion },
		generation, destination: { collection: DESTINATION, taxonomy } };
}
function exactSourceOnly(run, label) {
	assert.equal(run.measurement.nativeDatabaseOpenings, 0, label + ": Check opened the native candidate/target database");
	for (const entry of run.product) {
		const kind = kindOf(entry);
		assert.ok(["source-hydration", "revision", "collection", "fields", "core-seo", "host-timezone"].includes(kind),
			label + ": non-source read " + kind + ": " + entry.sql.slice(0, 160));
		if (kind === "source-hydration") assert.ok(entry.parameters.includes(savedSource.id));
		if (kind === "revision") assert.ok(entry.parameters.includes(SOURCE) && entry.parameters.includes(savedSource.id));
		if (kind === "collection" || kind === "fields") assert.ok(entry.parameters.includes(SOURCE) || entry.parameters.includes(sourceCollectionId), label + ": foreign schema read");
		if (kind === "core-seo") assert.ok(entry.parameters.includes(SOURCE) && entry.parameters.includes(savedSource.id));
	}
}

let failure;
try {
	await fixture("migrations-and-schema", async () => {
		await runMigrations(db);
		const nativeHost = createLinkNativeHostFactory({ openDatabase: async () => { nativeDatabaseOpenings += 1; return db; } });
		seo = adaptSandboxEntry(createSeoEngine(seoInstallation(), { internalLinks: nativeHost }), seoPlugin());
		await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
		const schema = new SchemaRegistry(db);
		for (const [slug, pattern] of [[SOURCE, "/articles/{slug}"], [DESTINATION, "/guides/{slug}"]]) {
			await schema.createCollection({ slug, label: slug, hasSeo: true, routable: true, urlPattern: pattern, supports: ["drafts", "revisions"] });
			for (const [field, type] of [["title", "string"], ["excerpt", "text"], ["body", "portableText"]]) {
				await schema.createField(slug, { slug: field, label: field, type });
			}
		}
		sourceCollectionId = (await db.selectFrom("_emdash_collections").select("id").where("slug", "=", SOURCE).executeTakeFirstOrThrow()).id;
		targetCollectionId = (await db.selectFrom("_emdash_collections").select("id").where("slug", "=", DESTINATION).executeTakeFirstOrThrow()).id;
		content = new ContentRepository(db);
		revisions = new RevisionRepository(db);
		savedSource = await content.create({ type: SOURCE, slug: "watering-notes", status: "published", locale: "en",
			data: { title: "Watering notes", excerpt: "Saved garden notes.", body: [paragraph("live-only", "The published paragraph has no matching anchor.")] } });
		const largeBody = JSON.stringify([paragraph("large-target", "b".repeat(70_000))]);
		await db.insertInto(TARGET_TABLE).values(Array.from({ length: 201 }, (_, offset) => {
			const index = offset + 1;
			return { id: TARGET_ID(index), slug: "guide-" + index, status: "published", locale: "en", translation_group: "target-group-" + index,
				created_at: STAMP, updated_at: STAMP, published_at: STAMP, deleted_at: null, version: 3,
				title: PHRASE, excerpt: "Water roots steadily through the summer.", body: index <= 5 || index === 201 ? largeBody : "[]" };
		})).execute();
		await db.insertInto("_emdash_taxonomy_def_groups").values({ id: "topic-definition-group", name: "topics", collections: JSON.stringify([DESTINATION]), hierarchical: 0 }).execute();
		await db.insertInto("_emdash_taxonomy_defs").values({ id: "topics-en", name: "topics", label: "Topics", locale: "en", translation_group: "topic-definition-group", collections: '["stale"]', hierarchical: 0 }).execute();
		await db.insertInto("taxonomies").values({ id: TERM, name: "topics", slug: "water", label: "Water", locale: "en", translation_group: TERM_GROUP }).execute();
		await db.insertInto("content_taxonomies").values({ collection: DESTINATION, entry_id: "target-group-201", taxonomy_id: TERM_GROUP, locale: "fr", status: "draft" }).execute();
		await db.insertInto("_plugin_storage").values(SCORE_COLLECTIONS.map((collection) => ({ plugin_id: seo.id, collection, id: "route-proof-sentinel", data: JSON.stringify({ marker: collection, ref: SOURCE + ":" + savedSource.id }) }))).execute();
	});
	const factoryOptions = { db, siteInfo: { siteName: "Garden", siteUrl: SITE, locale: "en", trailingSlash: "always" }, cronReschedule() {} };
	ctx = new PluginContextFactory(factoryOptions).createContext(seo);
	await fixture("stored-global-policy", () => ctx.kv.set(GLOBAL_SETTINGS_KEY, globalSettings));
	const registry = new PluginRouteRegistry(factoryOptions);
	registry.register(seo);
	runtime = {
		getPluginRouteMeta(pluginId, path) {
			const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
			return route ? buildRouteMeta(route) : null;
		},
		async handlePluginApiRoute(pluginId, method, path, request, caller) {
			dispatchedHandlers += 1;
			let body;
			try { body = await parseRouteInput(request, this.getPluginRouteMeta(pluginId, path)?.request); }
			catch (error) {
				if (typeof error?.status === "number") return { success: false, status: error.status, error: { code: "INVALID_PLUGIN_REQUEST", message: error.message } };
				throw error;
			}
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
		},
	};
	const originalBody = savedBody();
	const firstRevision = await stageBody(originalBody, "saved-source-revision");
	const findInput = await sourceInput("saved-source-version");
	const savedRead = await preparation("source-ownership-control", () => createLinkHostPorts(ctx).source.readSource({ collection: SOURCE, entryId: savedSource.id }));
	assert.equal(savedRead.document.revisionId, firstRevision.id);
	assert.deepEqual(savedRead.document.body, originalBody);
	assert.equal((await fixture("live-body-control", () => content.findById(SOURCE, savedSource.id))).data.body[0]._key, "live-only");
	const beforeScores = await snapshotScores();

	const observerStart = statements.length;
	await tagged("control", "observer-row-control", () => db.selectFrom(TARGET_TABLE).select("id").where("id", "=", TARGET_ID(1)).execute());
	assert.equal(statements[observerStart].returnedRows, 1);
	const errorStart = statements.length;
	await assert.rejects(() => tagged("control", "observer-error-control", () => db.selectFrom("missing_route_proof_table").select("id").execute()));
	assert.ok(statements[errorStart].error);
	check("driver controls observe returned rows and failed statements");

	for (const route of ROUTES) {
		const declaration = seo.routes[route];
		assert.equal(declaration.public === true, false, route + ": private route");
		assert.equal(declaration.permission, "plugins:manage");
		assert.deepEqual(declaration.methods, ["POST"]);
		assert.deepEqual(declaration.request, { body: "json", maxBytes: route === ROUTES[0] || route === ROUTES[1] ? 16_384 : 49_152 });
		const invalid = route === ROUTES[0] ? { ...findInput, extra: true } : {};
		for (const [label, options, expected] of [
			["anonymous", { user: null }, 401], ["editor", { user: people.editor }, 403],
			["session-without-csrf", { csrf: false }, 403],
			["token-without-scope", { csrf: false, tokenScopes: [] }, 403],
			["token-content-scope", { csrf: false, tokenScopes: ["content:read"] }, 403],
			["editor-admin-scope", { user: people.editor, csrf: false, tokenScopes: ["admin"] }, 403],
		]) {
			const run = await measure(route + ":" + label, route, invalid, options);
			noReads(run, expected, label);
			assert.equal(run.measurement.dispatchedHandlers, 0, label + ": authorization preceded dispatch");
			assert.equal(run.error.code, label.startsWith("token-") ? "INSUFFICIENT_SCOPE"
				: label === "session-without-csrf" ? "CSRF_REJECTED" : label === "anonymous" ? "UNAUTHORIZED" : "FORBIDDEN");
		}
		const wrongMethod = await measure(route + ":get-method", route, undefined, { method: "GET" });
		noReads(wrongMethod, 405, route + ": POST only");
		assert.equal(wrongMethod.allow, "POST");
		const semantic = await measure(route + ":semantic-invalid", route, invalid);
		noReads(semantic, 200, route + ": semantic-invalid");
		assert.equal(semantic.data.kind, "invalid");
		for (const [label, rawBody, headers, expected] of [
			["malformed-json", "{", {}, 400],
			["invalid-utf8", new Uint8Array([0x22, 0xc3, 0x28, 0x22]), {}, 400],
			["streamed-oversize", " ".repeat(declaration.request.maxBytes + 1), {}, 413],
			["declared-oversize", "{}", { "Content-Length": String(declaration.request.maxBytes + 1) }, 413],
		]) noReads(await measure(route + ":" + label, route, undefined, { rawBody, headers }), expected, label);
	}
	check("all four real private routes enforce roles, session CSRF, admin token scope, POST, byte limits and malformed input before data reads");

	const denseRun = await measure("dense-find", ROUTES[0], findInput);
	const dense = pageOf(denseRun, "dense Find");
	assert.equal(dense.response.suggestions.length, 5);
	assert.equal(dense.response.page.scopeMatches, 25);
	assert.equal(dense.response.page.examinedRows, 25);
	assert.equal(denseRun.measurement.byKind["candidate-window"].returnedRows, 200);
	assert.equal(denseRun.measurement.byKind["sdk-target-hydration"].statements, 5);
	assert.ok(denseRun.measurement.sdkTargetBodyBytes > 350_000, "Hidden target bodies are included");
	assert.ok(dense.next);
	assert.equal(dense.next.afterId, TARGET_ID(25));
	assert.equal(dense.next.scope.upperId, TARGET_ID(201));
	assert.deepEqual(dense.response.suggestions.map((item) => item.anchor.occurrence.ordinal), [1, 2, 3, 4, 5]);
	const denseNext = pageOf(await measure("dense-explicit-next", ROUTES[1], { generation: findInput.generation, receipt: dense.next }), "dense Next");
	assert.equal(denseNext.response.owner.scope.afterId, TARGET_ID(25));
	assert.equal(denseNext.response.page.scopeMatches, 25);
	check("dense Find and explicit Next preserve a 200-row window, 25 matches, five anchors and the original upper ID");

	const sparseInput = { ...clone(findInput), generation: 8, destination: { collection: DESTINATION, taxonomy: { taxonomy: "topics", termIds: [TERM] } } };
	const sparseRun = await measure("sparse-empty-find", ROUTES[0], sparseInput);
	const sparse = pageOf(sparseRun, "sparse Find");
	assert.equal(sparse.response.suggestions.length, 0);
	assert.equal(sparse.response.page.examinedRows, 200);
	assert.ok(sparse.next);
	assert.equal(sparse.next.afterId, TARGET_ID(200));
	assert.equal(sparse.next.scope.upperId, TARGET_ID(201));
	await fixture("new-row-after-original-window", () => db.insertInto(TARGET_TABLE).values({ id: TARGET_ID(202), slug: "guide-202", status: "published", locale: "en",
		translation_group: "target-group-202", created_at: STAMP, updated_at: STAMP, published_at: STAMP, version: 3, title: PHRASE, excerpt: "", body: "[]" }).execute());
	const sparseNextRun = await measure("sparse-explicit-next-original-upper", ROUTES[1], { generation: sparseInput.generation, receipt: sparse.next });
	const sparseNext = pageOf(sparseNextRun, "sparse Next");
	assert.equal(sparseNext.response.suggestions.length, 1);
	assert.equal(sparseNext.response.suggestions[0].target.entryId, TARGET_ID(201));
	assert.equal(sparseNext.response.page.examinedRows, 1);
	assert.equal(sparseNext.next, null);
	assert.equal(sparseNextRun.measurement.byKind["sdk-target-hydration"].statements, 1);
	assert.ok(sparseNextRun.product.filter((entry) => kindOf(entry) === "candidate-window").every((entry) => entry.parameters.includes(TARGET_ID(201))));
	check("sparse taxonomy Next retains its original window and uses authoritative content/term groups despite legacy pivot metadata");

	const request = chosenRequest(dense);
	const verifiedRun = await measure("verify-chosen-target", ROUTES[2], request);
	const verified = verificationOf(verifiedRun, "verified", "chosen Verify");
	assert.equal(verified.url, request.suggestion.target.publicUrl);
	assert.equal(verifiedRun.measurement.byKind["source-hydration"].statements, 2);
	assert.equal(verifiedRun.measurement.byKind["sdk-target-hydration"].statements, 1);
	assert.equal(verifiedRun.measurement.byKind["candidate-window"], undefined);
	assert.equal(verifiedRun.product.filter((entry) => kindOf(entry) === "settings" && entry.parameters.includes("plugin:shipit-seo:settings:global:v1")).length, 2);
	assert.ok(verifiedRun.product.filter((entry) => from(entry, TARGET_TABLE) && kindOf(entry) !== "upper-id").every((entry) => entry.parameters.includes(request.suggestion.target.entryId)), "Verify reads only the chosen target");
	const bearerRun = await measure("admin-bearer-verify-without-session-csrf", ROUTES[2], request, { csrf: false, tokenScopes: ["admin"] });
	verificationOf(bearerRun, "verified", "admin token scope");
	const sameVersion = await measure("check-same-saved-version", ROUTES[3], request);
	assert.deepEqual(sameVersion.data.check, { kind: "inconclusive", detail: "same-saved-version" });
	exactSourceOnly(sameVersion, "same-version Check");
	const insertedBody = linkedBody(originalBody, request, verified.url);
	const insertedRevision = await stageBody(insertedBody, "fixture-saved-link-revision");
	const checkedRun = await measure("check-new-saved-link", ROUTES[3], request);
	assert.equal(checkedRun.data.kind, "saved-check");
	assert.deepEqual(checkedRun.data.check, { kind: "verified" });
	exactSourceOnly(checkedRun, "saved-link Check");
	const storedRevision = await fixture("saved-marks-control", () => revisions.findById(insertedRevision.id));
	const linked = storedRevision.data.body.find((block) => block._key === request.suggestion.anchor.blockKey);
	assert.deepEqual(linked.children.at(-1), originalBody.find((block) => block._key === linked._key).children.at(-1));
	assert.deepEqual(linked.children.find((child) => child._key === "saved-anchor-new-key").marks, ["strong", "superscript", "chosen-link"]);
	const staleSource = verificationOf(await measure("verify-stale-saved-source", ROUTES[2], request), "stale", "saved source changed");
	assert.ok(staleSource.reasons.includes("source-version-changed"));
	check("Find, chosen Verify and newer-revision Check use genuine SDK storage and preserve split-span formatting and unrelated marks");

	for (const route of [ROUTES[2], ROUTES[3]]) {
		for (const [label, input] of [
			["extra-top", { ...clone(request), force: true }],
			["extra-target", { ...clone(request), suggestion: { ...clone(request.suggestion), target: { ...clone(request.suggestion.target), draft: true } } }],
			["wrong-owner-locale", { ...clone(request), owner: { ...clone(request.owner), source: { ...clone(request.owner.source), locale: "fr" } } }],
		]) {
			const refused = await measure(route + ":" + label, route, input);
			noReads(refused, 200, label);
			assert.equal(refused.data.kind, "invalid");
		}
	}
	const badNext = { generation: sparseInput.generation, receipt: { ...clone(sparse.next), database: {} } };
	const invalidNext = await measure("next-extra-receipt-field", ROUTES[1], badNext);
	noReads(invalidNext, 200, "strict receipt");
	assert.equal(invalidNext.data.kind, "invalid");
	check("returned request ownership and page receipts reject extra or inconsistent fields before reads");

	await stageBody(originalBody, "fixture-source-for-stale-policy");
	const policyInput = await sourceInput("source-version-for-policy");
	const policyPage = pageOf(await measure("find-before-same-value-policy-write", ROUTES[0], policyInput), "policy baseline");
	const policyRequest = chosenRequest(policyPage);
	await fixture("same-value-global-policy-write", () => ctx.kv.set(GLOBAL_SETTINGS_KEY, clone(globalSettings)));
	const stalePolicy = verificationOf(await measure("verify-same-value-global-revision-change", ROUTES[2], policyRequest), "stale", "global revision changed");
	assert.ok(stalePolicy.reasons.includes("policy-changed"));
	const targetPage = pageOf(await measure("find-before-target-save", ROUTES[0], policyInput), "target baseline");
	const targetRequest = chosenRequest(targetPage);
	await fixture("target-version-change", () => db.updateTable(TARGET_TABLE).set({ version: 4, updated_at: "2026-10-04 12:00:01" }).where("id", "=", targetRequest.suggestion.target.entryId).execute());
	const staleTarget = verificationOf(await measure("verify-changed-chosen-target", ROUTES[2], targetRequest), "stale", "target changed");
	assert.ok(staleTarget.reasons.includes("target-changed"));
	await fixture("restore-target-version", () => db.updateTable(TARGET_TABLE).set({ version: 3, updated_at: STAMP }).where("id", "=", targetRequest.suggestion.target.entryId).execute());
	check("source, same-value global revision and chosen target changes produce named stale verification");

	const longPhrase = "irrigation" + "x".repeat(440);
	const decoratedBody = savedBody(longPhrase, ["em", "strike-through", "strong", "subscript", "superscript", "underline"]);
	await fixture("large-editorial-titles", () => db.updateTable(TARGET_TABLE).set({ title: longPhrase, excerpt: "", version: 4, updated_at: "2026-10-04 12:00:02" }).where("id", "<=", TARGET_ID(25)).execute());
	await stageBody(decoratedBody, "fixture-large-decorated-source");
	const largeInput = await sourceInput("large-source-version", null, 9);
	const largeRun = await measure("large-decorated-find-wrapped-bound", ROUTES[0], largeInput);
	const largePage = pageOf(largeRun, "large decorated Find");
	assert.ok(largePage.response.omittedForResponseLimit > 0, "Large Find must exercise response trimming");
	const largeRequest = chosenRequest(largePage);
	assert.ok(bytes(largeRequest) > 16_384 && bytes(largeRequest) <= CAP, "A returned decorated suggestion needs the larger Verify/Check request budget");
	const largeVerify = await measure("large-suggestion-verify-roundtrip", ROUTES[2], largeRequest);
	const largeVerified = verificationOf(largeVerify, "verified", "large suggestion Verify");
	await stageBody(linkedBody(decoratedBody, largeRequest, largeVerified.url), "fixture-large-saved-link");
	const largeCheck = await measure("large-suggestion-check-roundtrip", ROUTES[3], largeRequest);
	assert.deepEqual(largeCheck.data.check, { kind: "verified" });
	exactSourceOnly(largeCheck, "large saved-link Check");
	check("a real decorated suggestion exceeding 16 KiB roundtrips through Verify/Check while wrapped Find trims within 48 KiB");

	const goodRevision = await stageBody(originalBody, "fixture-source-before-ownership-refusals");
	const ownershipInput = await sourceInput("ownership-source-version");
	const foreign = await fixture("foreign-entry-revision", async () => {
		const entry = await content.create({ type: SOURCE, slug: "foreign-notes", status: "published", locale: "en", data: { title: "Other notes", excerpt: "", body: originalBody } });
		return revisions.create({ collection: SOURCE, entryId: entry.id, data: { body: originalBody } });
	});
	const foreignCollection = await fixture("foreign-collection-revision", () => revisions.create({ collection: DESTINATION, entryId: TARGET_ID(201), data: { body: originalBody } }));
	const noBody = await fixture("owned-revision-without-body", () => revisions.create({ collection: SOURCE, entryId: savedSource.id, data: { title: "No owned body", _slug: savedSource.slug } }));
	for (const [label, pointer] of [["foreign-entry", foreign.id], ["foreign-collection", foreignCollection.id], ["missing-revision", "missing-route-proof-revision"], ["revision-without-own-body", noBody.id]]) {
		// Invalid pointers are deliberate corruption; the host setter refuses foreign ownership.
		await fixture(label + "-pointer", async () => {
			if (label === "missing-revision") await sql`PRAGMA foreign_keys = OFF`.execute(db);
			try {
				await db.updateTable(SOURCE_TABLE).set({ draft_revision_id: pointer }).where("id", "=", savedSource.id).execute();
			} finally {
				if (label === "missing-revision") await sql`PRAGMA foreign_keys = ON`.execute(db);
			}
		});
		const refused = await measure("find-" + label, ROUTES[0], ownershipInput);
		assert.equal(refused.status, 200);
		assert.deepEqual(refused.data, { kind: "unavailable", reason: "source-unavailable" });
		assert.equal(refused.measurement.nativeDatabaseOpenings, 0, label + ": never enters candidate/target adapter");
		const recheck = await measure("check-" + label, ROUTES[3], largeRequest);
		assert.deepEqual(recheck.data.check, { kind: "inconclusive", detail: "source-unavailable" });
		exactSourceOnly(recheck, label + " Check");
	}
	await fixture("restore-owned-source-pointer", () => db.updateTable(SOURCE_TABLE).set({ draft_revision_id: goodRevision.id }).where("id", "=", savedSource.id).execute());
	const readableAgain = pageOf(await measure("find-owned-source-restored-control", ROUTES[0], ownershipInput), "restored owned source");
	assert.equal(readableAgain.response.owner.source.revisionId, goodRevision.id);
	check("foreign, missing and bodyless saved revisions are unavailable without borrowing the live source body");

	assert.deepEqual(await snapshotScores(), beforeScores, "Suggestions, Verify and Check leave durable scores/history/profiles/jobs unchanged");
	assert.equal(networkCalls, 0, "No route calls the network");
	report.productWrites = statements.filter((entry) => entry.owner === "product" && isWrite(entry)).length;
	report.fixtureWrites = statements.filter((entry) => entry.owner === "fixture" && isWrite(entry)).length;
	report.preparationStatements = statements.filter((entry) => entry.owner === "preparation").length;
	report.controlStatements = statements.filter((entry) => entry.owner === "control").length;
	report.foreignKeyBoundaryChecks = foreignKeyBoundaryChecks;
	report.observationsByOwner = Object.fromEntries(["product", "fixture", "preparation", "control"].map((owner) => {
		const entries = statements.filter((entry) => entry.owner === owner);
		return [owner, { statements: entries.length, returnedRows: entries.reduce((sum, entry) => sum + entry.returnedRows, 0),
			writes: entries.filter(isWrite).length, errors: entries.filter((entry) => entry.error).length,
			returnedTextBytes: entries.reduce((sum, entry) => sum + entry.returnedTextBytes, 0) }];
	}));
	report.networkCalls = networkCalls;
	assert.equal(report.productWrites, 0);
	check("complete route observations contain zero product writes, score/history access or outbound calls");
	report.status = "passed";
} catch (error) {
	failure = error;
	report.status = "failed";
	report.failure = String(error instanceof Error ? error.message : error).slice(0, 1024);
} finally {
	await db.destroy();
	globalThis.fetch = realFetch;
}

const output = JSON.stringify(report);
assert.ok(Buffer.byteLength(output) <= 65_536, "The compact route report exceeds 64 KiB");
console.log(output);
if (failure) throw failure;
console.log(`Internal-link routes passed through the published EmDash ${target.versions.get("emdash")} dispatcher with migrated in-memory SQLite (${report.checks.length} check groups).`);
