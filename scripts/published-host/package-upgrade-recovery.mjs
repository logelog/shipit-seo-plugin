// The configured released runtime owns lifecycle and dispatch. Its only Astro
// inputs supplied here are virtual config, virtual dialect and the production DEV flag.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEnvironment, runtimeExport } from "./environment.mjs";
import { setFixtureContentAnalysis, setFixtureAssessmentProfile } from "./fixture-content-analysis.mjs";
import { assertPackedArtifact } from "../../packages/emdash-plugin-seo/scripts/packed-artifact.mjs";

const PLUGIN = "shipit-seo";
const PACKAGE = "@shipitseo/emdash-plugin-seo";
const SITE = "https://example.com";
const BUDGET = 65_536;
const environment = createEnvironment();
const self = fileURLToPath(import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => {
	const text = `${JSON.stringify(value, null, 2)}\n`;
	assert.ok(Buffer.byteLength(text) <= BUDGET, `Report exceeds ${BUDGET} bytes`);
	writeFileSync(path, text);
};
const sortedRows = (rows) => rows.map((row) => ({ ...row })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

function blockNetworking() {
	let attempts = 0;
	const deny = () => { attempts += 1; throw new Error("Networking is disabled in the package upgrade fixture"); };
	globalThis.fetch = async () => deny();
	net.Socket.prototype.connect = deny;
	tls.connect = deny;
	dgram.createSocket = deny;
	for (const name of Object.keys(dns)) {
		if (/^(?:lookup|resolve|reverse)/.test(name) && typeof dns[name] === "function") dns[name] = deny;
	}
	for (const name of Object.keys(dns.promises)) {
		if (/^(?:lookup|resolve|reverse)/.test(name) && typeof dns.promises[name] === "function") dns.promises[name] = async () => deny();
	}
	syncBuiltinESMExports();
	return () => attempts;
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

function applicationSnapshot(file) {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		return {
			options: sortedRows(db.prepare("SELECT * FROM options WHERE name LIKE 'plugin:shipit-seo:%' OR name IN ('site:url', 'emdash:site_url')").all()),
			storage: sortedRows(db.prepare("SELECT * FROM _plugin_storage WHERE plugin_id = ?").all(PLUGIN)),
			content: sortedRows(db.prepare("SELECT * FROM ec_posts").all()),
			coreSeo: sortedRows(db.prepare("SELECT * FROM _emdash_seo").all()),
		};
	} finally { db.close(); }
}

async function runPhase(phase, file) {
	assert.ok(["native-1.2.0", "native-1.3.0"].includes(environment.target.name));
	environment.assertVersions();
	const networkAttempts = blockNetworking();
	const fixture = readJson(file);
	const consumer = fixture.consumers[phase === "upgrade" ? "candidate" : "previous"];
	const config = readJson(join(consumer, "site-config.json"));
	assert.equal(config.database.config.url, fixture.database);
	const runtimeExportInfo = await hostExport("EmDashRuntime");
	assert.equal((runtimeExportInfo.source.match(/import\.meta\.env\.DEV/g) ?? []).length, 1);
	const virtualConfig = `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(config)};`)}`;
	// Host getDb() outside a request imports this dialect; without it the plugin fails closed and withholds public metadata.
	const virtualDialect = `data:text/javascript,${encodeURIComponent(`export { createDialect } from ${JSON.stringify(runtimeExport(environment, "emdash", "./db/sqlite").href)};`)}`;
	registerHooks({
		resolve(specifier, context, nextResolve) {
			return nextResolve(specifier === "virtual:emdash/config" ? virtualConfig : specifier === "virtual:emdash/dialect" ? virtualDialect : specifier, context);
		},
		load(url, context, nextLoad) {
			const loaded = nextLoad(url, context);
			return url === runtimeExportInfo.url.href
				? { ...loaded, source: runtimeExportInfo.source.replace("import.meta.env.DEV", "false") }
				: loaded;
		},
	});
	const { createDialect } = await import(runtimeExport(environment, "emdash", "./db/sqlite").href);
	const { runMigrations } = await import(runtimeExport(environment, "emdash", "./db").href);
	const { OptionsRepository, PluginStorageRepository } = await import(runtimeExport(environment, "emdash").href);
	if (phase === "baseline") {
		const { Kysely } = await import(runtimeExport(environment, "kysely").href);
		const db = new Kysely({ dialect: createDialect({ url: fixture.database }) });
		try {
			await runMigrations(db);
			const options = new OptionsRepository(db);
			await options.set("emdash:setup_complete", true);
			await options.set("emdash:seed_complete", true);
			await options.set("site:url", SITE);
			await options.set("emdash:site_url", SITE);
		} finally { await db.destroy(); }
	}
	const packageRoot = join(consumer, "node_modules", ...PACKAGE.split("/"));
	const manifest = readJson(join(packageRoot, "package.json"));
	const { createPlugin } = await import(pathToFileURL(join(packageRoot, manifest.exports["./plugin"].default)).href);
	const contract = await import(pathToFileURL(join(packageRoot, manifest.exports["./admin-contract"].default)).href);
	const plugin = createPlugin({ siteUrl: SITE });
	assert.equal(plugin.version, manifest.version, "Archive package and engine versions agree");
	let installCalls = 0;
	const installHook = plugin.hooks["plugin:install"];
	plugin.hooks["plugin:install"] = { ...installHook, handler: async (...args) => {
		installCalls += 1;
		return installHook.handler(...args);
	} };
	const EmDashRuntime = (await import(runtimeExportInfo.url.href))[runtimeExportInfo.alias];
	let runtime;
	let result;
	try {
		runtime = await EmDashRuntime.create({
			config, plugins: [plugin], createDialect, sandboxEnabled: false, sandboxBypassed: false,
			sandboxedPluginEntries: [], mediaProviderEntries: [], migrationMode: "auto",
		});
		assert.equal(runtime.isPluginEnabled(PLUGIN), true);
		assert.equal(installCalls, phase === "baseline" ? 1 : 0, "The real host lifecycle installs once");
		const dispatch = await importHostExport("dispatchPluginApiRequest");
		const caller = { id: "upgrade-admin", email: "admin@example.test", name: "Upgrade administrator", role: 50,
			emailVerified: true, avatarUrl: null, data: null, createdAt: "2026-10-01T00:00:00.000Z" };
		const call = async (route, body, user = caller) => {
			const request = new Request(`${SITE}/_emdash/api/plugins/${PLUGIN}/${route}`, {
				method: body === undefined ? "GET" : "POST",
				headers: { "X-EmDash-Request": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body),
			});
			const response = await dispatch({ runtime, pluginId: PLUGIN, path: `/${route}`, request, user });
			const payload = await response.json();
			assert.equal(response.status, 200, `${route}: ${JSON.stringify(payload)}`);
			return payload.data;
		};
		const success = async (route, body) => {
			const data = await call(route, body);
			assert.equal(data.success, true, `${route}: ${JSON.stringify(data)}`);
			return data;
		};
		const saveSettings = async (patch) => {
			const current = await call("admin-settings");
			return success("save-admin-settings", {
				...current.values, ...patch,
				...(current.revision === null ? { expectedRevision: null, expectedLegacyGuard: current.legacyGuard } : { expectedRevision: current.revision }),
			});
		};
		const ContentRepository = await importHostExport("ContentRepository");
		const content = new ContentRepository(runtime.db);
		const SeoRepository = await importHostExport("SeoRepository");
		const coreSeo = new SeoRepository(runtime.db);
		if (phase === "baseline") {
			const schema = runtime.schemaRegistry;
			await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] });
			for (const [slug, type] of [["title", "string"], ["excerpt", "string"], ["content", "portableText"], ["focus_keyword", "string"]])
				await schema.createField("posts", { slug, label: slug, type });
			const span = (text, key) => ({ _type: "span", _key: `s${key}`, text, marks: [] });
			const block = (text, key, style = "normal") => ({ _type: "block", _key: `b${key}`, style, markDefs: [], children: [span(text, key)] });
			const entry = await content.create({ type: "posts", slug: "dental-care", status: "published", locale: "en", data: {
				title: "Dental care at the local practice", excerpt: "A synthetic dental practice entry for package upgrade checks.", focus_keyword: "dental care",
				content: [block("Dental care at the local practice", "h", "h1"), ...Array.from({ length: 5 }, (_, i) => block(`Dental care information for appointment ${i}. This synthetic content stays in an isolated package test database.`, String(i)))],
			} });
			fixture.entry = { collection: "posts", entryId: entry.id, locale: "en", ref: `posts:${entry.id}` };
			await coreSeo.upsert("posts", entry.id, { title: "Saved dental SEO title", description: "Saved native dental description retained across upgrades.", canonical: `${SITE}/posts/dental-care`, noIndex: false });
			await saveSettings({ siteName: "Upgrade Dental", siteUrl: SITE, publisherType: "organization", organizationName: "Upgrade Dental", organizationLogo: "", personName: "", socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false });
			await success("save-business-identity", { document: { kind: "LocalBusiness", businessType: "Dentist", name: "Upgrade Dental", contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } }, expectedRevision: null });
			const json = JSON.stringify({ "@context": "https://schema.org", "@type": "BlogPosting", "@id": "{{canonical}}#upgrade-article", headline: "{{title}}", publisher: { "@id": `${SITE}/#organization` } });
			await success("save-schema-library-template", { mode: "create", expectedRevision: null, id: "tpl-upgrade0000000000000", name: "Upgrade article", json });
			await success("save-entry-custom-schema", { ...fixture.entry, ref: undefined, id: "entry-upgrade0000000000000", expectedRevision: null, name: "Upgrade article copy", json, enabled: true });
			const fixtureCall = async (route, body) => ({ data: await call(route, body) });
			await setFixtureContentAnalysis(fixtureCall, true);
			await setFixtureAssessmentProfile(fixtureCall, "posts", "article");
			const analysis = await success("analyze-saved-content", { ref: fixture.entry.ref, locale: "en" });
			assert.equal(analysis.outcome, "saved");
			assert.equal(analysis.history, "created", "Baseline analysis creates durable score history");
			await setFixtureContentAnalysis(fixtureCall, false);
			const options = new OptionsRepository(runtime.db);
			const now = new Date().toISOString();
			const future = new Date(Date.now() + 86_400_000).toISOString();
			await options.set("plugin:shipit-seo:settings:indexnow:v1", {
				version: contract.SEO_ADMIN_INDEXNOW_STORAGE_VERSION, updatedAt: now,
				values: { enabled: false, autoSubmit: false, autoSubmitContentTypes: ["posts"], apiKey: "0123456789abcdef0123456789abcdef", keyLocation: "/indexnow-key.txt", batchSize: 100, minIntervalSeconds: 3600, maxAttempts: 5 },
			});
			const store = (name) => new PluginStorageRepository(runtime.db, PLUGIN, name, plugin.storage[name].indexes);
			const urls = Array.from({ length: 4 }, (_, i) => `${SITE}/posts/retained-${i}`);
			const submissionId = `submission:${now}:0123456789abcdef`;
			for (const url of urls) await store("indexnowJobs").put(`url:${encodeURIComponent(url)}`, {
				id: `url:${encodeURIComponent(url)}`, storageVersion: contract.SEO_ADMIN_INDEXNOW_QUEUE_STORAGE_VERSION, url, ref: fixture.entry.ref,
				reason: "manual", status: "pending", attempts: 0, nextAttemptAt: future, lastHttpStatus: null, lastError: null, lastSubmittedAt: null, createdAt: now, updatedAt: now, submissionId,
			});
			await store("indexnowSubmissions").put(submissionId, {
				id: submissionId, storageVersion: contract.SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION, source: "manual", event: null, ref: fixture.entry.ref,
				urlCount: urls.length, sampleUrls: urls.slice(0, 3), sampleSkipped: [], detail: "pages", counts: { queued: 4, retrying: 0, sent: 0, accepted: 0, failed: 0, skipped: 0, superseded: 0 },
				status: "queued", attempts: 0, lastAttemptAt: null, lastHttpStatus: null, nextAttemptAt: future, lastDetail: "Synthetic preservation fixture", createdAt: now, updatedAt: now,
			});
			await store("indexnowSubmissionUrls").put(`${submissionId}:urls:0`, { storageVersion: contract.SEO_ADMIN_INDEXNOW_SUBMISSION_STORAGE_VERSION, submissionId, page: 0, urls, skipped: [] });
			await store("indexnowDeliveries").put("upgrade-retained-delivery", {
				id: "upgrade-retained-delivery", storageVersion: contract.SEO_ADMIN_INDEXNOW_DELIVERY_STORAGE_VERSION, status: "retry", urlCount: 1, urls: [urls[0]], httpStatus: 429,
				attempt: 1, detail: "Synthetic preservation fixture; no request sent", retryAt: future, createdAt: now,
			});
			fixture.submissionId = submissionId;
			writeJson(file, fixture);
		}
		const entry = await content.findById("posts", fixture.entry.entryId);
		assert.ok(entry);
		const savedSeo = await coreSeo.get("posts", fixture.entry.entryId);
		assert.equal(savedSeo.title, "Saved dental SEO title");
		const observe = async () => {
			const settings = await call("admin-settings");
			const identity = await call("admin-business-identity");
			const library = await call("schema-library");
			const schemas = await call("entry-custom-schemas", { collection: "posts", entryId: fixture.entry.entryId, locale: "en" });
			const scores = await call("scores", { ref: fixture.entry.ref, storedOnly: true, snapshotOnly: true });
			const verifiedScores = await call("scores", { ref: fixture.entry.ref, storedOnly: true });
			const indexNow = await call("admin-indexnow", { limit: 10 });
			const history = await success("admin-indexnow-history", { limit: 10 });
			const historyUrls = await success("admin-indexnow-history-urls", { submissionId: fixture.submissionId, page: 0 });
			const publicKey = await call("public-indexnow-key");
			assert.equal(indexNow.values.enabled, false);
			assert.equal(indexNow.values.autoSubmit, false);
			assert.equal(publicKey.key, "0123456789abcdef0123456789abcdef");
			assert.equal(history.history.items.length, 1);
			assert.equal(historyUrls.urls.items.length, 4);
			assert.equal(library.templates.length, 1);
			assert.equal(schemas.items.length, 1);
			assert.equal(scores.items.length, 1);
			assert.ok(["current", "stale"].includes(verifiedScores.items[0]?.freshness), "The current package reports stored-score freshness explicitly");
			const page = (path, item) => ({
				url: `${SITE}${path}`, path, locale: item ? "en" : null, kind: item ? "content" : "custom", pageType: item ? "article" : "website",
				title: item?.slug ?? "Home", pageTitle: item?.data.title ?? "Home", description: item?.data.excerpt ?? "", canonical: `${SITE}${path}`, image: null,
				...(item ? { content: { collection: "posts", id: item.id, slug: item.slug } } : {}), seo: item ? savedSeo : {}, siteName: "Upgrade Dental", siteUrl: SITE,
			});
			const metadata = { home: await runtime.collectPageMetadata(page("/")), post: await runtime.collectPageMetadata(page("/posts/dental-care", entry)) };
			assert.ok(metadata.home.some((item) => item.kind === "jsonld" && item.graph?.["@type"] === "Dentist"));
			assert.ok(metadata.post.some((item) => item.kind === "jsonld" && item.graph?.["@id"] === `${SITE}/posts/dental-care#upgrade-article`));
			return { settings, identity, library, schemas, scores, verifiedScores, indexNow, history, historyUrls, publicKey, metadata };
		};
		const before = applicationSnapshot(fixture.database);
		assert.equal(before.coreSeo.length, 1, "A nonempty saved native SEO record participates in preservation and recovery");
		assert.equal(before.storage.filter((row) => row.collection === "scoreHistory" && JSON.parse(row.data).ref === fixture.entry.ref).length, 1, "The saved entry has a real durable history row in every phase");
		const observations = await observe();
		assert.deepEqual(applicationSnapshot(fixture.database), before, "Runtime readback and metadata leave retained rows and revisions unchanged");
		result = { version: manifest.version, installCalls, snapshot: before, metadata: observations.metadata,
			readback: { libraryTemplates: observations.library.templates.length, customSchemas: observations.schemas.items.length,
				score: { ref: observations.scores.items[0].ref, score: observations.scores.items[0].score, scoreVersion: observations.scores.items[0].scoreVersion, analysisRevision: observations.scores.items[0].analysisRevision, inputIdentity: observations.scores.items[0].inputIdentity },
				freshness: observations.verifiedScores.items[0].freshness, indexNowEnabled: observations.indexNow.values.enabled, queued: observations.indexNow.queue, historyItems: observations.history.history.items.length, historyUrls: observations.historyUrls.urls.items.length },
		};
		if (phase === "upgrade") {
			await saveSettings({ siteName: "Upgrade Dental changed" });
			assert.equal((await call("admin-settings")).values.siteName, "Upgrade Dental changed");
			const afterWrite = applicationSnapshot(fixture.database);
			assert.notDeepEqual(afterWrite.options, before.options, "The upgraded package performs a real revision-checked settings write");
			result.afterWriteSha256 = sha(JSON.stringify(afterWrite));
		}
	} finally {
		if (runtime) { await runtime.shutdown(); await runtime.db.destroy(); }
	}
	assert.equal(networkAttempts(), 0, "No network operation was attempted");
	const checkpoint = new DatabaseSync(fixture.database);
	try { checkpoint.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } finally { checkpoint.close(); }
	result.networkAttempts = networkAttempts();
	writeJson(join(fixture.work, `${phase}.json`), result);
}

function parseArgs(args) {
	const options = {};
	for (let i = 0; i < args.length; i += 2) {
		const key = args[i];
		assert.ok(["--previous-archive", "--candidate-archive", "--receipt"].includes(key) && !options[key] && args[i + 1], "Use --previous-archive PATH --candidate-archive PATH --receipt PATH");
		assert.ok(isAbsolute(args[i + 1]), `${key} must be absolute`);
		options[key] = resolve(args[i + 1]);
	}
	assert.equal(Object.keys(options).length, 3);
	return options;
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000, maxBuffer: BUDGET, ...options });
	assert.equal(result.error, undefined, result.error?.message);
	assert.equal(result.status, 0, `${command} failed: ${(result.stderr + result.stdout).slice(-BUDGET)}`);
	return result.stdout;
}

function extractConsumer(archive, directory, config) {
	const data = readFileSync(archive);
	assert.ok(data.byteLength > 0 && data.byteLength <= 20 * 1024 * 1024);
	const entries = run("tar", ["-tzf", archive]).trim().split("\n");
	assert.ok(entries.length > 0 && entries.length < 500);
	assert.ok(entries.every((path) => path.startsWith("package/") && !path.split("/").includes("..")), "Archive entries stay within package/");
	assert.ok(run("tar", ["-tvzf", archive]).trim().split("\n").every((line) => /^[d-]/.test(line)), "Archive contains only regular files and directories");
	const packageRoot = join(directory, "node_modules", ...PACKAGE.split("/"));
	mkdirSync(packageRoot, { recursive: true });
	run("tar", ["-xzf", archive, "-C", packageRoot, "--strip-components=1"]);
	const manifest = assertPackedArtifact(packageRoot);
	assert.equal(manifest.name, PACKAGE);
	const hostManifest = readJson(new URL("package.json", environment.hostRoot));
	const coreManifest = readJson(new URL("package.json", environment.hostPackageRoot("emdash")));
	const names = new Set([...Object.keys(hostManifest.dependencies), ...Object.keys(hostManifest.devDependencies), ...Object.keys(coreManifest.dependencies), ...Object.keys(manifest.peerDependencies ?? {})]);
	for (const name of names) {
		const target = join(directory, "node_modules", name);
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(realpathSync(fileURLToPath(environment.hostPackageRoot(name))), target);
	}
	writeJson(join(directory, "package.json"), { name: "shipit-seo-upgrade-consumer", private: true, type: "module", dependencies: { [PACKAGE]: `file:${archive}` } });
	writeJson(join(directory, "site-config.json"), config);
	writeJson(join(directory, "dependency-lock.json"), { package: { name: PACKAGE, version: manifest.version, sha256: sha(data) }, hostLockSha256: sha(readFileSync(new URL("pnpm-lock.yaml", environment.hostRoot))) });
	return { file: archive, bytes: data.byteLength, sha256: sha(data), version: manifest.version };
}

async function main(args) {
	assert.equal(process.platform, "linux", "Run the upgrade fixture in WSL2 or Linux");
	assert.equal(process.versions.node, "24.19.0");
	assert.ok(["native-1.2.0", "native-1.3.0"].includes(environment.target.name));
	environment.assertVersions();
	const options = parseArgs(args);
	const output = options["--receipt"];
	const sourcePackage = fileURLToPath(new URL("../../packages/emdash-plugin-seo/", import.meta.url));
	const receiptPath = relative(sourcePackage, output);
	assert.ok(receiptPath === ".." || receiptPath.startsWith("../"), "Receipt stays outside the customer package");
	const previousFile = options["--previous-archive"];
	const candidateFile = options["--candidate-archive"];
	assert.notEqual(realpathSync(previousFile), realpathSync(candidateFile));
	assert.notEqual(output, previousFile);
	assert.notEqual(output, candidateFile);
	const work = mkdtempSync(join(tmpdir(), "shipit-seo-upgrade-"));
	const receipt = { schemaVersion: 1, status: "failed", target: environment.target.name, node: process.versions.node, host: { emdash: environment.target.versions.get("emdash"), admin: environment.target.versions.get("@emdash-cms/admin"), database: "SQLite" },
		evidence: { lifecycle: "Actual configured EmDashRuntime.create; original install hook is observed and delegated", admin: "Actual released dispatcher and runtime route handling with a synthetic administrator", public: "Actual runtime page-metadata contributions; no rendered HTML or Astro build", dependencies: "Existing pinned host graph; no package-manager installation in this fixture", indexNow: "Explicit synthetic key, pending jobs, delivery and history fixtures; disabled; no provider request", backup: "Stopped writers, checkpointed complete SQLite file, package archive, configuration and dependency-identity record" },
	};
	try {
		const database = join(work, "site.sqlite");
		const config = { database: { entrypoint: "emdash/db/sqlite", config: { url: database } }, siteUrl: SITE };
		const consumers = { previous: join(work, "previous"), candidate: join(work, "candidate") };
		receipt.previous = extractConsumer(previousFile, consumers.previous, config);
		receipt.candidate = extractConsumer(candidateFile, consumers.candidate, config);
		assert.notEqual(receipt.previous.version, receipt.candidate.version, "Upgrade requires distinct package versions");
		const fixture = join(work, "fixture.json");
		writeJson(fixture, { work, database, consumers });
		const phase = (name) => {
			run(process.execPath, [self, "--phase", name, fixture], { env: { ...process.env, SHIPIT_HOST_TARGET: environment.target.name, NODE_OPTIONS: "", EMDASH_SITE_URL: "", SITE_URL: "" } });
			return readJson(join(work, `${name}.json`));
		};
		const baseline = phase("baseline");
		const backup = join(work, "backup.sqlite");
		cpSync(database, backup);
		const backupHash = sha(readFileSync(backup));
		const configHash = sha(readFileSync(join(consumers.previous, "site-config.json")));
		const lockHash = sha(readFileSync(join(consumers.previous, "dependency-lock.json")));
		const upgraded = phase("upgrade");
		assert.deepEqual(upgraded.snapshot, baseline.snapshot, "Upgrade preserves all saved rows and revisions");
		assert.deepEqual(upgraded.metadata, baseline.metadata, "Upgrade preserves actual public metadata contributions");
		assert.deepEqual(upgraded.readback.score, baseline.readback.score, "Stored score remains readable without reanalysis");
		assert.notEqual(upgraded.afterWriteSha256, sha(JSON.stringify(baseline.snapshot)));
		for (const suffix of ["-wal", "-shm"]) if (existsSync(database + suffix)) rmSync(database + suffix);
		cpSync(backup, database);
		assert.equal(sha(readFileSync(database)), backupHash, "Full database file is restored before reopening");
		assert.equal(sha(readFileSync(previousFile)), receipt.previous.sha256);
		assert.equal(sha(readFileSync(join(consumers.previous, "site-config.json"))), configHash);
		assert.equal(sha(readFileSync(join(consumers.previous, "dependency-lock.json"))), lockHash);
		const rollback = phase("rollback");
		assert.deepEqual(rollback.snapshot, baseline.snapshot, "Restored old package sees the complete original retained state");
		assert.deepEqual(rollback.metadata, baseline.metadata, "Restored old package reproduces original public metadata contributions");
		assert.deepEqual(rollback.readback.score, baseline.readback.score);
		assert.equal(sha(readFileSync(candidateFile)), receipt.candidate.sha256);
		receipt.status = "passed";
		receipt.checks = { retainedSettingsAndRevisions: true, businessIdentity: true, customSchema: true, schemaLibrary: true, storedScoreAndHistory: true, controlledIndexNowKeyQueueAndHistory: true, coreContent: true, publicMetadataContributions: true, upgradedSettingsWrite: true, fullDatabaseRestored: true, oldPackageConfigAndDependencyIdentity: true, zeroNetworkAttempts: true };
		receipt.backupSha256 = backupHash;
		receipt.observed = { baseline: { version: baseline.version, installCalls: baseline.installCalls, snapshotSha256: sha(JSON.stringify(baseline.snapshot)), readback: baseline.readback }, upgraded: { version: upgraded.version, installCalls: upgraded.installCalls, snapshotSha256: sha(JSON.stringify(upgraded.snapshot)), readback: upgraded.readback }, restored: { version: rollback.version, installCalls: rollback.installCalls, snapshotSha256: sha(JSON.stringify(rollback.snapshot)), readback: rollback.readback } };
	} catch (error) {
		receipt.error = error instanceof Error ? error.message.slice(0, 8192) : String(error).slice(0, 8192);
		throw error;
	} finally {
		receipt.finishedAt = new Date().toISOString();
		mkdirSync(dirname(output), { recursive: true });
		writeJson(output, receipt);
		assert.ok(lstatSync(work).isDirectory() && work.startsWith(join(tmpdir(), "shipit-seo-upgrade-")));
		rmSync(work, { recursive: true });
	}
	console.log(`Exact-package upgrade and complete database/package recovery passed on released native EmDash ${environment.target.versions.get("emdash")}.`);
}

if (process.argv[2] === "--phase") {
	assert.ok(["baseline", "upgrade", "rollback"].includes(process.argv[3]) && process.argv.length === 5);
	await runPhase(process.argv[3], process.argv[4]);
} else await main(process.argv.slice(2));
