// Runtime phases complement the separate installed Astro removal/build check.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import dgram from "node:dgram";
import dns from "node:dns";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import tls from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPackedArtifact } from "../../packages/emdash-plugin-seo/scripts/packed-artifact.mjs";
import { createEnvironment, runtimeExport } from "./environment.mjs";

const PLUGIN = "shipit-seo";
const PACKAGE = "@shipitseo/emdash-plugin-seo";
const SITE = "https://example.com";
const KEY = "0123456789abcdef0123456789abcdef";
const BUDGET = 65_536;
const environment = createEnvironment();
const sha = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sorted = (rows) => rows.map((row) => ({ ...row })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const inside = (parent, child) => { const part = relative(parent, child); return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith("../"); };

function writeJson(path, value) {
	const text = `${JSON.stringify(value, null, 2)}\n`;
	assert.ok(Buffer.byteLength(text) <= BUDGET, "Lifecycle evidence exceeds 64 KiB");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

function parseArgs(args) {
	const options = {};
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		assert.ok(["--phase", "--consumer", "--database", "--archive", "--state", "--receipt"].includes(key) && !options[key] && args[index + 1], "Use --phase NAME --consumer PATH --database PATH --archive PATH --state PATH --receipt PATH");
		options[key] = args[index + 1];
	}
	assert.equal(Object.keys(options).length, 6);
	assert.ok(["seed-disable", "without-plugin", "reinstall-enable"].includes(options["--phase"]));
	for (const key of ["--consumer", "--database", "--archive", "--state", "--receipt"]) {
		assert.ok(isAbsolute(options[key]), `${key} must be absolute`);
		options[key] = resolve(options[key]);
	}
	const consumer = realpathSync(options["--consumer"]);
	const manifest = readJson(join(consumer, "package.json"));
	assert.equal(manifest.private, true);
	assert.equal(manifest.name, "shipit-seo-native-removal-consumer", "Only the isolated removal consumer may be opened");
	assert.ok(inside(realpathSync(tmpdir()), consumer), "The removal consumer must be a temporary directory");
	assert.ok(inside(consumer, options["--database"]), "The synthetic database stays inside the consumer");
	assert.equal(realpathSync(dirname(options["--database"])), consumer, "The synthetic database is directly inside the consumer");
	assert.ok(!inside(join(consumer, "node_modules"), options["--state"]));
	assert.ok(!inside(join(consumer, "node_modules"), options["--receipt"]));
	const customerPackage = fileURLToPath(new URL("../../packages/emdash-plugin-seo/", import.meta.url));
	assert.ok(!inside(customerPackage, options["--state"]) && !inside(customerPackage, options["--receipt"]), "Evidence stays outside the customer package");
	assert.equal(new Set([options["--database"], options["--archive"], options["--state"], options["--receipt"]]).size, 4);
	if (options["--phase"] === "seed-disable") {
		assert.equal(existsSync(options["--database"]), false, "Seed requires a new synthetic database");
		assert.equal(existsSync(options["--state"]), false, "Seed cannot replace earlier lifecycle state");
	} else {
		assert.equal(realpathSync(options["--database"]), options["--database"]);
		assert.ok(existsSync(options["--state"]));
	}
	return { phase: options["--phase"], consumer, database: options["--database"], archive: options["--archive"], stateFile: options["--state"], receiptFile: options["--receipt"] };
}

function blockNetworking() {
	let attempts = 0;
	const deny = () => { attempts += 1; throw new Error("Networking is disabled in the native removal lifecycle fixture"); };
	globalThis.fetch = async () => deny();
	net.Socket.prototype.connect = deny;
	tls.connect = deny;
	dgram.createSocket = deny;
	for (const name of Object.keys(dns)) if (/^(?:lookup|resolve|reverse)/.test(name) && typeof dns[name] === "function") dns[name] = deny;
	for (const name of Object.keys(dns.promises)) if (/^(?:lookup|resolve|reverse)/.test(name) && typeof dns.promises[name] === "function") dns.promises[name] = async () => deny();
	syncBuiltinESMExports();
	return () => attempts;
}

function files(directory, prefix = "", installed = false) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const name = prefix + entry.name;
		const path = join(directory, entry.name);
		if (installed && prefix === "" && entry.name === "node_modules") {
			assert.ok(entry.isDirectory() && !entry.isSymbolicLink(), "Installed package machinery must be a local directory");
			return [];
		}
		assert.equal(entry.isSymbolicLink(), false, "Package files cannot be symbolic links");
		if (entry.isDirectory()) return files(path, `${name}/`);
		assert.ok(entry.isFile());
		return [{ name, sha256: sha(readFileSync(path)) }];
	}).sort((a, b) => a.name.localeCompare(b.name));
}

function exactPackage(options) {
	const bytes = readFileSync(options.archive);
	assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024);
	const runTar = (args) => {
		const result = spawnSync("tar", args, { encoding: "utf8", timeout: 30_000, maxBuffer: BUDGET });
		assert.equal(result.error, undefined, result.error?.message);
		assert.equal(result.status, 0, (result.stderr ?? "").slice(-4096));
		return result.stdout;
	};
	const entries = runTar(["-tzf", options.archive]).trim().split("\n");
	assert.ok(entries.length > 0 && entries.length < 500);
	assert.ok(entries.every((path) => path.startsWith("package/") && !path.split("/").includes("..")));
	assert.ok(runTar(["-tvzf", options.archive]).trim().split("\n").every((line) => /^[d-]/.test(line)));
	const temporary = mkdtempSync(join(tmpdir(), "shipit-seo-removal-archive-"));
	try {
		runTar(["-xzf", options.archive, "-C", temporary, "--strip-components=1"]);
		const archivedManifest = assertPackedArtifact(temporary);
		assert.equal(archivedManifest.name, PACKAGE);
		const identity = { version: archivedManifest.version, bytes: bytes.byteLength, sha256: sha(bytes), filesSha256: sha(JSON.stringify(files(temporary))) };
		if (options.phase !== "without-plugin") {
			const installed = realpathSync(join(options.consumer, "node_modules", ...PACKAGE.split("/")));
			assert.ok(inside(options.consumer, installed), "The exact package must be installed inside the isolated consumer");
			assert.deepEqual(files(installed, "", true), files(temporary), "Every installed archive-owned file equals the exact archive; installed node_modules machinery is separate");
			identity.root = installed;
		} else {
			assert.equal(existsSync(join(options.consumer, "node_modules", ...PACKAGE.split("/"))), false, "The without-plugin phase requires actual dependency removal");
			assert.equal(readJson(join(options.consumer, "package.json")).dependencies?.[PACKAGE], undefined);
		}
		return identity;
	} finally {
		assert.ok(lstatSync(temporary).isDirectory() && temporary.startsWith(join(tmpdir(), "shipit-seo-removal-archive-")));
		rmSync(temporary, { recursive: true });
	}
}

async function hostExport(name) {
	const directory = new URL("dist/", environment.hostPackageRoot("emdash"));
	for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const url = new URL(file, directory);
		const source = readFileSync(url, "utf8");
		const alias = source.match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return { url, source, alias };
	}
	throw new Error(`Published ${name} export was not found`);
}

async function importHostExport(name) {
	const found = await hostExport(name);
	return (await import(found.url.href))[found.alias];
}

function snapshot(file) {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		return {
			options: sorted(db.prepare("SELECT * FROM options WHERE name LIKE 'plugin:shipit-seo:%' OR name IN ('site:url', 'emdash:site_url', 'site:seo')").all()),
			storage: sorted(db.prepare("SELECT * FROM _plugin_storage WHERE plugin_id = ?").all(PLUGIN)),
			content: sorted(db.prepare("SELECT * FROM ec_posts").all()),
			coreSeo: sorted(db.prepare("SELECT * FROM _emdash_seo").all()),
			// Core recordHit advances these access fields; config_revision owns configuration changes.
			redirects: sorted(db.prepare("SELECT * FROM _emdash_redirects").all().map(({ hits: _hits, last_hit_at: _lastHitAt, updated_at: _accessUpdatedAt, ...configuration }) => configuration)),
			media: sorted(db.prepare("SELECT * FROM media").all()),
		};
	} finally { db.close(); }
}

function lifecycleRows(file) {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		return {
			state: { ...db.prepare("SELECT * FROM _plugin_state WHERE plugin_id = ?").get(PLUGIN) },
			cron: sorted(db.prepare("SELECT * FROM _emdash_cron_tasks WHERE plugin_id = ?").all(PLUGIN)),
		};
	} finally { db.close(); }
}

async function main() {
	assert.equal(process.platform, "linux", "Run the lifecycle fixture in WSL2 or Linux");
	assert.equal(process.versions.node, "24.19.0");
	assert.equal(environment.target.name, "native-1.3.0");
	environment.assertVersions();
	const options = parseArgs(process.argv.slice(2));
	const networkAttempts = blockNetworking();
	const identity = exactPackage(options);
	const receipt = { schemaVersion: 1, status: "failed", phase: options.phase, target: environment.target.name, package: { version: identity.version, bytes: identity.bytes, sha256: identity.sha256, filesSha256: identity.filesSha256 }, limits: "No active request is started. Disable prevents subsequent dispatch and disables retained cron rows; cancellation of already executing work or accepted remote effects is not established." };
	let runtime;
	let nextState;
	try {
		const state = options.phase === "seed-disable" ? null : readJson(options.stateFile);
		if (state) {
			assert.equal(state.schemaVersion, 1);
			assert.equal(state.consumer, options.consumer);
			assert.equal(state.database, options.database);
			assert.equal(state.archiveSha256, identity.sha256);
			assert.equal(state.filesSha256, identity.filesSha256);
			assert.deepEqual(snapshot(options.database), state.retained, "Retained rows match before opening another runtime");
			assert.deepEqual(lifecycleRows(options.database), state.lifecycle, "Inactive state and cron survive the intervening operation");
			assert.equal(sha(readFileSync(state.backup)), state.backupSha256, "The stopped backup is unchanged");
		}
		const config = { database: { entrypoint: "emdash/db/sqlite", config: { url: options.database } }, siteUrl: SITE, registry: false };
		const runtimeInfo = await hostExport("EmDashRuntime");
		assert.equal((runtimeInfo.source.match(/import\.meta\.env\.DEV/g) ?? []).length, 1);
		const virtualConfig = `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(config)};`)}`;
		// Host getDb() outside a request imports this dialect; without it the plugin fails closed and withholds public metadata.
		const virtualDialect = `data:text/javascript,${encodeURIComponent(`export { createDialect } from ${JSON.stringify(runtimeExport(environment, "emdash", "./db/sqlite").href)};`)}`;
		registerHooks({
			resolve(specifier, context, nextResolve) { return nextResolve(specifier === "virtual:emdash/config" ? virtualConfig : specifier === "virtual:emdash/dialect" ? virtualDialect : specifier, context); },
			load(url, context, nextLoad) {
				const loaded = nextLoad(url, context);
				return url === runtimeInfo.url.href ? { ...loaded, source: runtimeInfo.source.replace("import.meta.env.DEV", "false") } : loaded;
			},
		});
		const { createDialect } = await import(runtimeExport(environment, "emdash", "./db/sqlite").href);
		const { OptionsRepository, PluginStorageRepository, ContentRepository, CronAccessImpl, MediaRepository } = await import(runtimeExport(environment, "emdash").href);
		if (!state) {
			const { Kysely } = await import(runtimeExport(environment, "kysely").href);
			const { runMigrations } = await import(runtimeExport(environment, "emdash", "./db").href);
			const db = new Kysely({ dialect: createDialect({ url: options.database }) });
			try {
				await runMigrations(db);
				const settings = new OptionsRepository(db);
				await settings.set("emdash:setup_complete", true);
				await settings.set("emdash:seed_complete", true);
				await settings.set("site:url", SITE);
				await settings.set("emdash:site_url", SITE);
				await settings.set("site:seo", { robotsTxt: "User-agent: *\nDisallow: /retained-private/\n" });
			} finally { await db.destroy(); }
		}
		let plugin;
		let contract;
		let installCalls = 0;
		if (identity.root) {
			const manifest = readJson(join(identity.root, "package.json"));
			const { createPlugin } = await import(pathToFileURL(join(identity.root, manifest.exports["./plugin"].default)).href);
			contract = await import(pathToFileURL(join(identity.root, manifest.exports["./admin-contract"].default)).href);
			plugin = createPlugin({ siteUrl: SITE });
			assert.equal(plugin.version, identity.version);
			const install = plugin.hooks["plugin:install"];
			assert.ok(install?.handler);
			plugin.hooks["plugin:install"] = { ...install, handler: async (...args) => { installCalls += 1; return install.handler(...args); } };
		}
		const EmDashRuntime = (await import(runtimeInfo.url.href))[runtimeInfo.alias];
		let cronClock = state ? new Date(Date.parse(state.lifecycle.cron[0].next_run_at) + 1000) : new Date(Date.now() + 86_400_000);
		runtime = await EmDashRuntime.create({ config, plugins: plugin ? [plugin] : [], createDialect, sandboxEnabled: false, sandboxBypassed: false, sandboxedPluginEntries: [], mediaProviderEntries: [], migrationMode: "auto", now: () => cronClock });
		const dispatch = await importHostExport("dispatchPluginApiRequest");
		const caller = { id: "removal-admin", email: "admin@example.test", name: "Removal administrator", role: 50, emailVerified: true, avatarUrl: null, data: null, createdAt: "2026-10-01T00:00:00.000Z" };
		const request = async (route, body, user = caller) => {
			const httpRequest = new Request(`${SITE}/_emdash/api/plugins/${PLUGIN}/${route}`, { method: body === undefined ? "GET" : "POST", headers: { "X-EmDash-Request": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
			return dispatch({ runtime, pluginId: PLUGIN, path: `/${route}`, request: httpRequest, user });
		};
		const call = async (route, body, user) => {
			const response = await request(route, body, user);
			const payload = await response.json();
			assert.equal(response.status, 200, `${route}: ${JSON.stringify(payload)}`);
			return payload.data;
		};
		const success = async (route, body) => { const data = await call(route, body); assert.equal(data.success, true, `${route}: ${JSON.stringify(data)}`); return data; };
		const guard = (current) => current.revision === null ? { expectedRevision: null, expectedLegacyGuard: current.legacyGuard } : { expectedRevision: current.revision };
		const saveScoring = async (enabled) => { const current = await call("admin-settings"); return success("save-content-scoring", { contentScoringEnabled: enabled, expectedContentScoringEnabled: current.values.contentScoringEnabled, ...guard(current), ...(enabled ? { resourceNoticeVersion: contract.CONTENT_SCORING_RESOURCE_NOTICE_VERSION } : {}) }); };
		const page = { url: `${SITE}/`, path: "/", locale: null, kind: "custom", pageType: "website", title: "Retained home", pageTitle: "Retained home", description: "Synthetic removal fixture", canonical: `${SITE}/`, image: null, seo: {}, siteName: "Removal Dental", siteUrl: SITE };
		let priorPageMetadata;
		if (!state) {
			assert.equal(installCalls, 1, "The released configured lifecycle installs the archive once");
			assert.equal(runtime.isPluginEnabled(PLUGIN), true);
			await runtime.schemaRegistry.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] });
			for (const [slug, type] of [["title", "string"], ["excerpt", "string"], ["content", "portableText"], ["focus_keyword", "string"]]) await runtime.schemaRegistry.createField("posts", { slug, label: slug, type });
			const block = (text, key) => ({ _type: "block", _key: `b${key}`, style: "normal", markDefs: [], children: [{ _type: "span", _key: `s${key}`, text, marks: [] }] });
			const entry = await new ContentRepository(runtime.db).create({ type: "posts", slug: "dental-care", status: "published", locale: "en", data: { title: "Dental care at the local practice", excerpt: "Synthetic native metadata retained after removal.", focus_keyword: "dental care", content: Array.from({ length: 5 }, (_, index) => block(`Dental care information for appointment ${index}. This synthetic entry stays in an isolated removal test database.`, String(index))) } });
			const entryRef = { collection: "posts", entryId: entry.id, locale: "en", ref: `posts:${entry.id}` };
			const SeoRepository = await importHostExport("SeoRepository");
			await new SeoRepository(runtime.db).upsert("posts", entry.id, { title: "Saved native dental title", description: "Saved native dental description retained after removal.", canonical: `${SITE}/posts/dental-care`, noIndex: false });
			const current = await call("admin-settings");
			await success("save-admin-settings", { ...current.values, siteName: "Removal Dental", siteUrl: SITE, publisherType: "organization", organizationName: "Removal Dental", organizationLogo: "", personName: "", socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false, ...guard(current) });
			await saveScoring(true);
			await success("save-analysis-profile", { collection: "posts", profile: "article", expectedRevision: null });
			await success("save-focus-keyword", { ref: entryRef.ref, keywords: ["dental care"], pillar: true, profileOnly: true });
			const analyzed = await success("analyze-saved-content", { ref: entryRef.ref, locale: "en" });
			assert.deepEqual([analyzed.outcome, analyzed.history], ["saved", "created"]);
			await success("save-business-identity", { document: { kind: "LocalBusiness", businessType: "Dentist", name: "Removal Dental", contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } }, expectedRevision: null });
			const json = JSON.stringify({ "@context": "https://schema.org", "@type": "BlogPosting", "@id": "{{canonical}}#retained-article", headline: "{{title}}" });
			await success("save-schema-library-template", { mode: "create", expectedRevision: null, id: "tpl-removal0000000000000", name: "Retained article", json });
			await success("save-entry-custom-schema", { ...entryRef, ref: undefined, id: "entry-removal0000000000000", expectedRevision: null, name: "Retained article copy", json, enabled: true });
			const templates = await call("admin-templates");
			const template = templates.items.find((item) => item.collection === "posts");
			assert.ok(template);
			await success("save-admin-templates", { collection: "posts", expectedRevision: templates.revision, inheritanceGuard: template.inheritanceGuard, values: { title: "{{title}} | Retained", description: "Retained {{title}}", socialTitle: "Retained share {{title}}", socialDescription: "Retained social description" } });
			await success("save-admin-entry-social", { ref: entryRef.ref, title: "Retained social title", description: "Retained social description", expectedRevision: null });
			await success("save-entry-directives", { ref: entryRef.ref, robots: { nofollow: true, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false } });
			await saveScoring(false);
			const settings = new OptionsRepository(runtime.db);
			const now = new Date().toISOString();
			const future = new Date(Date.now() + 86_400_000).toISOString();
			await settings.set("plugin:shipit-seo:settings:indexnow:v1", { version: contract.SEO_ADMIN_INDEXNOW_STORAGE_VERSION, updatedAt: now, values: { enabled: false, autoSubmit: false, autoSubmitContentTypes: ["posts"], apiKey: KEY, keyLocation: "/indexnow-key.txt", batchSize: 100, minIntervalSeconds: 3600, maxAttempts: 5 } });
			const store = (name) => new PluginStorageRepository(runtime.db, PLUGIN, name, plugin.storage[name].indexes);
			const url = `${SITE}/posts/dental-care`;
			const submissionId = `submission:${now}:0123456789abcdef`;
			await store("indexnowJobs").put(`url:${encodeURIComponent(url)}`, { id: `url:${encodeURIComponent(url)}`, storageVersion: contract.SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION, url, ref: entryRef.ref, reason: "manual", status: "pending", attempts: 0, nextAttemptAt: future, lastHttpStatus: null, lastError: null, lastSubmittedAt: null, createdAt: now, updatedAt: now, submissionId });
			await store("indexnowSubmissions").put(submissionId, { id: submissionId, storageVersion: contract.SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION, source: "manual", event: null, ref: entryRef.ref, urlCount: 1, sampleUrls: [url], sampleSkipped: [], detail: "sample", counts: { queued: 1, retrying: 0, sent: 0, accepted: 0, failed: 0, skipped: 0, superseded: 0 }, status: "queued", attempts: 0, lastAttemptAt: null, lastHttpStatus: null, nextAttemptAt: future, lastDetail: "Synthetic preservation fixture", createdAt: now, updatedAt: now });
			await store("indexnowSubmissionUrls").put(`${submissionId}:urls:0`, { storageVersion: contract.SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION, submissionId, page: 0, urls: [url], skipped: [] });
			await store("indexnowDeliveries").put("removal-retained-delivery", { id: "removal-retained-delivery", storageVersion: contract.SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION, status: "retry", urlCount: 1, urls: [url], httpStatus: 429, attempt: 1, detail: "Synthetic preservation fixture; no request sent", retryAt: future, createdAt: now });
			// Opaque records exercise retention without running a migration or recovery.
			for (const name of ["overrides", "migrations", "migrationOperations"]) await store(name).put("removal-retained-record", { id: "removal-retained-record", ref: "posts:retained-legacy", fixture: "synthetic preservation record", createdAt: now });
			const indexNow = await call("admin-indexnow", { limit: 10 });
			assert.deepEqual(indexNow.queue, { pending: 1, retrying: 0, failed: 0, delivered: 0, lastAcceptedAt: null });
			assert.equal(indexNow.jobs.length, 1);
			assert.deepEqual([indexNow.jobs[0].url, indexNow.jobs[0].status, indexNow.jobs[0].submissionId], [url, "pending", submissionId]);
			assert.equal(indexNow.deliveries.length, 1);
			assert.deepEqual([indexNow.deliveries[0].id, indexNow.deliveries[0].status, indexNow.deliveries[0].httpStatus], ["removal-retained-delivery", "retry", 429]);
			await success("save-admin-indexnow", { ...indexNow.values, enabled: false, autoSubmit: false, expectedUpdatedAt: indexNow.updatedAt });
			assert.equal((await call("public-indexnow-key", undefined, null)).key, KEY, "IndexNow Off retains the public key");
			const history = (await success("admin-indexnow-history", { limit: 10 })).history;
			assert.deepEqual([history.available, history.total, history.items.length], [true, 1, 1]);
			assert.deepEqual([history.items[0].id, history.items[0].detail, history.items[0].counts.queued], [submissionId, "sample", 1]);
			assert.deepEqual((await success("admin-indexnow-history-urls", { submissionId, page: 0 })).urls.items, [{ url, skipped: false }]);
			const cron = new CronAccessImpl(runtime.db, PLUGIN, () => undefined);
			await cron.schedule(`indexnow-drain-${Date.parse(future)}`, { schedule: "* * * * *" });
			assert.equal(lifecycleRows(options.database).cron.length, 1);
			assert.equal(lifecycleRows(options.database).cron[0].enabled, 1);
			assert.ok(Date.parse(lifecycleRows(options.database).cron[0].next_run_at) <= cronClock.getTime());
			assert.equal(await runtime.cronExecutor.tick(), 1, "The active positive control executes the due cron hook with IndexNow Off");
			cronClock = new Date(Date.parse(lifecycleRows(options.database).cron[0].next_run_at) + 1000);
			receipt.activeDueCronExecutions = 1;
			const RedirectRepository = await importHostExport("RedirectRepository");
			await new RedirectRepository(runtime.db).create({ source: "/retained-redirect", destination: "/posts/dental-care", type: 301, enabled: true });
			await new MediaRepository(runtime.db).create({ filename: "retained.txt", mimeType: "text/plain", size: 30, storageKey: "removal-retained.txt", alt: "Synthetic retained media" });
			priorPageMetadata = await runtime.collectPageMetadata(page);
			assert.ok(priorPageMetadata.some((item) => item.kind === "jsonld" && item.graph?.["@type"] === "Dentist"));
			const beforeDisable = snapshot(options.database);
			const registryUninstall = await importHostExport("handleRegistryUninstall");
			let uninstallLifecycleCalls = 0;
			const refused = await registryUninstall(runtime.db, null, PLUGIN, { deleteData: false, beforeDelete: async () => { uninstallLifecycleCalls += 1; } });
			assert.deepEqual([refused.success, refused.error?.code, uninstallLifecycleCalls], [false, "NOT_FOUND", 0], "Registry Uninstall refuses the configured plugin before teardown");
			assert.deepEqual(snapshot(options.database), beforeDisable);
			const disabled = await runtime.handlePluginDisable(PLUGIN);
			assert.deepEqual([disabled.success, disabled.data?.item.status, disabled.data?.item.source], [true, "inactive", "config"]);
			assert.deepEqual(snapshot(options.database), beforeDisable, "Disable retains all product and core records");
			nextState = { schemaVersion: 1, consumer: options.consumer, database: options.database, archiveSha256: identity.sha256, filesSha256: identity.filesSha256, entry: entryRef, submissionId, retained: beforeDisable, lifecycle: lifecycleRows(options.database) };
		} else {
			assert.equal(installCalls, 0, "Reopening never reruns the recorded configured install");
			assert.deepEqual(snapshot(options.database), state.retained);
		}
		assert.equal(runtime.isPluginEnabled(PLUGIN), false);
		assert.equal(runtime.configuredPlugins.some((item) => item.id === PLUGIN), options.phase !== "without-plugin");
		if (priorPageMetadata) {
			assert.deepEqual(await runtime.collectPageMetadata(page), priorPageMetadata, "An existing page context keeps its already collected request snapshot");
			receipt.existingPageContextCacheRetained = true;
		}
		assert.deepEqual(await runtime.collectPageMetadata({ ...page }), [], "A new page context receives no inactive or absent plugin metadata hooks");
		for (const [route, body, user] of [["admin-settings", undefined, caller], ["drain-admin-indexnow", {}, caller], ["public-indexnow-key", undefined, null]]) assert.equal((await request(route, body, user)).status, 404, `${route}: inactive dispatch is refused`);
		const inactive = lifecycleRows(options.database);
		assert.deepEqual([inactive.state.status, inactive.state.source], ["inactive", "config"]);
		assert.equal(inactive.cron.length, 1);
		assert.ok(inactive.cron.every((row) => row.enabled === 0 && row.status === "idle" && row.locked_at === null));
		assert.ok(inactive.cron.every((row) => Date.parse(row.next_run_at) <= cronClock.getTime()), "The retained cron row is due at the controlled executor clock");
		assert.equal(await runtime.cronExecutor.tick(), 0, "Disabled due cron rows cannot begin a new invocation");
		assert.deepEqual(lifecycleRows(options.database), inactive);
		if (options.phase === "reinstall-enable") {
			assert.equal(state.withoutPluginVerified, true, "Verify dependency removal before reinstallation");
			const enabled = await runtime.handlePluginEnable(PLUGIN);
			assert.deepEqual([enabled.success, enabled.data?.item.status], [true, "active"]);
			assert.equal(runtime.isPluginEnabled(PLUGIN), true);
			assert.ok(lifecycleRows(options.database).cron.every((row) => row.enabled === 1), "Explicit Enable re-enables retained cron work");
			assert.equal((await call("admin-indexnow", { limit: 10 })).values.enabled, false);
			assert.equal((await call("admin-settings")).values.contentScoringEnabled, false);
			assert.equal((await call("public-indexnow-key", undefined, null)).key, KEY);
			assert.equal((await call("schema-library")).templates.length, 1);
			assert.equal((await call("entry-custom-schemas", { collection: "posts", entryId: state.entry.entryId, locale: "en" })).items.length, 1);
			assert.equal((await call("scores", { ref: state.entry.ref, storedOnly: true, snapshotOnly: true })).items.length, 1);
			assert.equal((await success("admin-indexnow-history", { limit: 10 })).history.items.length, 1);
			assert.equal((await success("admin-indexnow-history-urls", { submissionId: state.submissionId, page: 0 })).urls.items.length, 1);
			assert.ok((await runtime.collectPageMetadata({ ...page })).some((item) => item.kind === "jsonld" && item.graph?.["@type"] === "Dentist"));
		}
		const retained = nextState?.retained ?? state.retained;
		assert.deepEqual(snapshot(options.database), retained, "Lifecycle and readback preserve namespaced records, revisions and core data");
		receipt.installCalls = installCalls;
		receipt.retainedSha256 = sha(JSON.stringify(retained));
		receipt.inactiveCronRows = inactive.cron.length;
		receipt.explicitEnable = options.phase === "reinstall-enable";
	} catch (error) {
		receipt.error = error instanceof Error ? error.message.slice(0, 8192) : String(error).slice(0, 8192);
		receipt.finishedAt = new Date().toISOString();
		receipt.networkAttempts = networkAttempts();
		writeJson(options.receiptFile, receipt);
		throw error;
	} finally {
		if (runtime) { await runtime.shutdown(); await runtime.db.destroy(); }
		if (existsSync(options.database)) {
			const checkpoint = new DatabaseSync(options.database);
			try { assert.equal(checkpoint.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy, 0); } finally { checkpoint.close(); }
		}
		assert.equal(networkAttempts(), 0, "No network operation may be attempted");
	}
	if (nextState) {
		nextState.backup = `${options.stateFile}.backup.sqlite`;
		assert.equal(existsSync(nextState.backup), false);
		cpSync(options.database, nextState.backup);
		nextState.backupSha256 = sha(readFileSync(nextState.backup));
		assert.equal(sha(readFileSync(options.database)), nextState.backupSha256, "Closed database backup is byte-identical");
		writeJson(options.stateFile, nextState);
		receipt.backupSha256 = nextState.backupSha256;
	} else if (options.phase === "without-plugin") {
		const state = readJson(options.stateFile);
		writeJson(options.stateFile, { ...state, withoutPluginVerified: true });
	}
	receipt.networkAttempts = networkAttempts();
	receipt.status = "passed";
	receipt.finishedAt = new Date().toISOString();
	writeJson(options.receiptFile, receipt);
	console.log(`Native removal lifecycle ${options.phase} passed on released EmDash 1.3.0.`);
}

await main();
