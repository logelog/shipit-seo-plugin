// The lifecycle helper owns database retention; this consumer owns real package
// operations, Astro configuration, production builds and public responses.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createEnvironment, readManifest } from "./environment.mjs";

const PACKAGE = "@shipitseo/emdash-plugin-seo";
const SITE = "https://example.com";
const BUDGET = 65_536;
const environment = createEnvironment();
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const inside = (parent, child) => { const part = relative(parent, child); return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith("../"); };

function writeJson(path, value) {
	const text = `${JSON.stringify(value, null, 2)}\n`;
	assert.ok(Buffer.byteLength(text) <= BUDGET, "Removal evidence exceeds 64 KiB");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

function parseArgs(args) {
	const values = {};
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		assert.ok(["--archive", "--receipt"].includes(key) && !values[key] && args[index + 1], "Use --archive PATH --receipt PATH");
		assert.ok(isAbsolute(args[index + 1]), `${key} must be absolute`);
		values[key] = resolve(args[index + 1]);
	}
	assert.equal(Object.keys(values).length, 2);
	assert.notEqual(values["--archive"], values["--receipt"]);
	const customerPackage = fileURLToPath(new URL("../../packages/emdash-plugin-seo/", import.meta.url));
	assert.ok(!inside(customerPackage, values["--receipt"]), "Evidence stays outside the customer package");
	return { archive: realpathSync(values["--archive"]), receipt: values["--receipt"] };
}

function processIdentity(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		return stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[19];
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

function hasAdminStyles(directory) {
	return readdirSync(directory, { withFileTypes: true }).some((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? hasAdminStyles(path) : entry.isFile() && entry.name.endsWith(".css") && readFileSync(path, "utf8").includes(".shipit-seo-admin");
	});
}

function publicHead(html) {
	const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1];
	assert.ok(head, "The public response contains a head");
	const decode = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
	const tag = (attribute, name) => {
		const match = head.match(new RegExp(`<meta[^>]*${attribute}="${name}"[^>]*content="([^"]*)"`, "i")) ?? head.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attribute}="${name}"`, "i"));
		return match ? decode(match[1]) : null;
	};
	return {
		title: decode(head.match(/<title>([^<]*)<\/title>/i)?.[1] ?? ""),
		description: tag("name", "description"),
		canonical: decode(head.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/i)?.[1] ?? ""),
		socialTitle: tag("property", "og:title"), socialDescription: tag("property", "og:description"),
		robots: tag("name", "robots"),
		graphs: [...head.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1])),
	};
}

async function main() {
	assert.equal(process.platform, "linux", "Run removal verification in WSL2 or Linux");
	assert.equal(process.versions.node, "24.19.0");
	const interfaces = readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2).map((line) => line.split(":")[0].trim());
	assert.deepEqual(interfaces, ["lo"], "Run removal verification in a loopback-only network namespace");
	assert.equal(environment.target.name, "native-1.3.0");
	environment.assertVersions();
	const options = parseArgs(process.argv.slice(2));
	const archiveBytes = readFileSync(options.archive);
	assert.ok(archiveBytes.byteLength > 0 && archiveBytes.byteLength <= 20 * 1024 * 1024);
	const hostManifest = readManifest(environment.hostRoot);
	assert.equal(hostManifest.packageManager, "pnpm@11.19.0");
	const hostLock = fileURLToPath(new URL("pnpm-lock.yaml", environment.hostRoot));
	const hostPackage = fileURLToPath(new URL("package.json", environment.hostRoot));
	const frozen = { manifest: sha(readFileSync(hostPackage)), lock: sha(readFileSync(hostLock)) };
	const modulesText = readFileSync(new URL("node_modules/.modules.yaml", environment.hostRoot), "utf8");
	const store = modulesText.match(/(?:"storeDir"\s*:\s*"([^"\n]+)"|^storeDir:\s*([^\n]+))/m);
	assert.ok(store, "The existing target must record its cached pnpm store");
	const storeDirectory = (store[1] ?? store[2]).trim();
	assert.ok(isAbsolute(storeDirectory) && existsSync(storeDirectory));
	const work = mkdtempSync(join(tmpdir(), "shipit-seo-removal-"));
	const consumer = join(work, "consumer");
	const database = join(consumer, "site.sqlite");
	const stateFile = join(work, "lifecycle.json");
	const guardPath = join(work, "runtime-guard.mjs");
	const guardReport = join(work, "runtime-guard.jsonl");
	const active = new Set();
	const receipt = {
		schemaVersion: 1, status: "failed", target: environment.target.name, node: process.versions.node,
		package: { file: basename(options.archive), bytes: archiveBytes.byteLength, sha256: sha(archiveBytes) },
		evidence: { packageManager: "Pinned pnpm; separate consumer node_modules; offline cached-store dependency operations; scripts disabled", lifecycle: "Released runtime and dispatcher in separate stopped-writer phases", initialWrapper: "Exact installed package registration and Astro build; active metadata and key are exercised by the lifecycle seed", public: "Loopback production HTTP after removal and after explicit re-enable", network: "Dependency operations are offline. Runtime preloads reject non-loopback transports and lifecycle phases reject all networking.", retentionNormalization: "Released RedirectRepository.recordHit changes hits, last_hit_at and updated_at. Their exact one-request delta is checked separately; every redirect configuration column and config_revision remains in the retained hash.", limits: "No already executing request or accepted provider operation is cancelled by this fixture. Local SQLite evidence does not establish Cloudflare/D1 or sandbox behavior." },
		steps: {},
	};
	mkdirSync(consumer);
	const configDirectory = join(work, "package-manager-config");
	mkdirSync(configDirectory);
	const userConfig = join(configDirectory, "user.npmrc");
	const globalConfig = join(configDirectory, "global.npmrc");
	writeFileSync(userConfig, "");
	writeFileSync(globalConfig, "");
	const baseEnvironment = { ...process.env, NODE_OPTIONS: "", SHIPIT_HOST_TARGET: environment.target.name, SHIPIT_PUBLISHED_HOST: fileURLToPath(environment.hostRoot), ASTRO_TELEMETRY_DISABLED: "1", EMDASH_SITE_URL: "", SITE_URL: "", NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig, NPM_CONFIG_CACHE: join(work, "npm-cache"), npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_cache: join(work, "npm-cache") };

	function launch(command, args, label, extraEnvironment = {}) {
		const child = spawn(command, args, { cwd: consumer, env: { ...baseEnvironment, ...extraEnvironment }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
		const record = { child, label, identity: child.pid ? processIdentity(child.pid) : null, output: "", error: null, code: null, signal: null };
		active.add(record);
		for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { record.output = (record.output + chunk.toString()).slice(-BUDGET); });
		record.done = new Promise((resolve) => {
			child.once("error", (error) => { record.error = error; });
			child.once("close", (code, signal) => { record.code = code; record.signal = signal; active.delete(record); resolve(); });
		});
		return record;
	}
	function signal(record, name) {
		if (record.child.exitCode !== null || record.child.signalCode !== null || !record.child.pid) return;
		const current = processIdentity(record.child.pid);
		if (current === null) return;
		assert.ok(record.identity && current === record.identity, "Only the created process group may be stopped");
		try { process.kill(-record.child.pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; }
	}
	async function stop(record) {
		signal(record, "SIGTERM");
		await Promise.race([record.done, delay(5_000, undefined, { ref: false })]);
		let forced = false;
		if (active.has(record)) { forced = true; signal(record, "SIGKILL"); await Promise.race([record.done, delay(2_000, undefined, { ref: false })]); }
		assert.equal(active.has(record), false, `${record.label} must exit before files are changed`);
		return { forced, code: record.code, signal: record.signal };
	}
	async function run(command, args, label, { milliseconds = 180_000, guarded = false } = {}) {
		const record = launch(command, args, label, guarded ? { NODE_OPTIONS: `--max-old-space-size=2048 --import=${guardPath}`, REMOVAL_GUARD_REPORT: guardReport, REMOVAL_GUARD_PHASE: label } : {});
		const finished = await Promise.race([record.done.then(() => true), delay(milliseconds, undefined, { ref: false }).then(() => false)]);
		if (!finished) { await stop(record); throw new Error(`${label} exceeded ${milliseconds} ms: ${record.output.slice(-8192)}`); }
		assert.equal(record.error, null, `${label}: ${record.error?.message}`);
		assert.equal(record.code, 0, `${label} failed (${record.code ?? record.signal}): ${record.output.slice(-8192)}`);
		return record.output.trim();
	}
	function removeCreated(path) {
		assert.ok(inside(work, path));
		if (!existsSync(path)) return;
		assert.ok(inside(realpathSync(work), realpathSync(path)), "Cleanup stays inside this fixture");
		rmSync(path, { recursive: true });
	}
	const pnpmOptions = ["--offline", "--ignore-scripts", "--strict-peer-dependencies", `--store-dir=${storeDirectory}`];
	const lifecycle = async (phase) => {
		const receiptPath = join(work, `${phase}.json`);
		await run(process.execPath, [fileURLToPath(new URL("native-removal-lifecycle.mjs", import.meta.url)), "--phase", phase, "--consumer", consumer, "--database", database, "--archive", options.archive, "--state", stateFile, "--receipt", receiptPath], phase, { milliseconds: 90_000 });
		const result = readJson(receiptPath);
		assert.equal(result.status, "passed");
		assert.equal(result.package.sha256, receipt.package.sha256);
		assert.equal(result.networkAttempts, 0);
		receipt.steps[phase] = result;
		return result;
	};
	const build = async (label) => {
		for (const name of ["dist", ".astro", "node_modules/.vite"]) removeCreated(join(consumer, name));
		const astro = readJson(join(consumer, "node_modules/astro/package.json"));
		await run(process.execPath, [join(consumer, "node_modules/astro", astro.bin.astro), "build"], label, { guarded: true });
		assert.ok(existsSync(join(consumer, "dist/server/entry.mjs")));
	};
	async function openServer(label) {
		const probe = createServer();
		await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
		const address = probe.address();
		assert.ok(address && typeof address !== "string");
		const port = address.port;
		await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
		const record = launch(process.execPath, [join(consumer, "dist/server/entry.mjs")], label, { HOST: "127.0.0.1", PORT: String(port), NODE_OPTIONS: `--max-old-space-size=2048 --import=${guardPath}`, REMOVAL_GUARD_REPORT: guardReport, REMOVAL_GUARD_PHASE: label });
		const origin = `http://127.0.0.1:${port}`;
		try {
			const deadline = Date.now() + 25_000;
			while (Date.now() < deadline) {
				assert.equal(record.error, null, `${label}: ${record.error?.message}`);
				assert.ok(active.has(record), `${label} stopped: ${record.output.slice(-8192)}`);
				try {
					const response = await fetch(origin, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
					await response.arrayBuffer();
					if (response.status === 200) return { origin, record };
				} catch {}
				await delay(100);
			}
			throw new Error(`${label} did not become ready: ${record.output.slice(-8192)}`);
		} catch (error) { await stop(record); throw error; }
	}
	async function request(origin, path, { method = "GET", token } = {}) {
		assert.ok(path.startsWith("/") && !path.startsWith("//"));
		const response = await fetch(origin + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: "manual", signal: AbortSignal.timeout(15_000) });
		const chunks = [];
		let bytes = 0;
		if (response.body) for await (const chunk of response.body) { bytes += chunk.byteLength; assert.ok(bytes <= BUDGET, `${path} exceeds 64 KiB`); chunks.push(chunk); }
		return { status: response.status, headers: response.headers, text: Buffer.concat(chunks).toString("utf8"), bytes };
	}
	function assertRetained(file = database) {
		const expected = readJson(stateFile).retained;
		const db = new DatabaseSync(file, { readOnly: true });
		const sorted = (rows) => rows.map((row) => ({ ...row })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
		try {
			const actual = {
				options: sorted(db.prepare("SELECT * FROM options WHERE name LIKE 'plugin:shipit-seo:%' OR name IN ('site:url', 'emdash:site_url', 'site:seo')").all()),
				storage: sorted(db.prepare("SELECT * FROM _plugin_storage WHERE plugin_id = 'shipit-seo'").all()),
				content: sorted(db.prepare("SELECT * FROM ec_posts").all()), coreSeo: sorted(db.prepare("SELECT * FROM _emdash_seo").all()),
				redirects: sorted(db.prepare("SELECT * FROM _emdash_redirects").all().map(({ hits: _hits, last_hit_at: _lastHitAt, updated_at: _accessUpdatedAt, ...configuration }) => configuration)), media: sorted(db.prepare("SELECT * FROM media").all()),
			};
			for (const [name, rows] of Object.entries(actual)) assert.equal(sha(JSON.stringify(rows)), sha(JSON.stringify(expected[name])), `Retained ${name} rows and revisions match; redirect access fields are verified separately`);
			return sha(JSON.stringify(actual));
		} finally { db.close(); }
	}
	function redirectRow() {
		const db = new DatabaseSync(database, { readOnly: true });
		try { return { ...db.prepare("SELECT * FROM _emdash_redirects WHERE source = '/retained-redirect'").get() }; }
		finally { db.close(); }
	}

	try {
		writeFileSync(guardPath, runtimeGuardSource);
		assert.equal(await run("pnpm", ["--version"], "package-manager-version", { milliseconds: 15_000 }), "11.19.0");
		// The consumer builds with Astro; the host's package bundler requires a different TypeScript major.
		const { tsdown: hostBundler, ...devDependencies } = hostManifest.devDependencies;
		assert.equal(hostBundler, "0.20.3");
		const manifest = { name: "shipit-seo-native-removal-consumer", private: true, type: "module", packageManager: hostManifest.packageManager, engines: hostManifest.engines, dependencies: { ...hostManifest.dependencies, [PACKAGE]: `file:${options.archive}` }, devDependencies };
		receipt.steps.consumerDependencies = { omittedHostBuildOnlyDependency: "tsdown", otherPinsPreserved: true, strictPeers: true, offline: true, scriptsDisabled: true, emdashFonts: "false; supported system-font option in every configuration state" };
		writeJson(join(consumer, "package.json"), manifest);
		cpSync(hostLock, join(consumer, "pnpm-lock.yaml"));
		cpSync(fileURLToPath(new URL("pnpm-workspace.yaml", environment.hostRoot)), join(consumer, "pnpm-workspace.yaml"));
		await run("pnpm", ["install", "--no-frozen-lockfile", ...pnpmOptions], "install-exact-archive");
		assert.equal(lstatSync(join(consumer, "node_modules")).isSymbolicLink(), false);
		for (const [name, expected] of environment.target.versions) assert.equal(readJson(join(consumer, "node_modules", name, "package.json")).version, expected);
		const installedManifest = readJson(join(consumer, "package.json"));
		const withoutPlugin = (value) => { const clone = structuredClone(value); delete clone.dependencies[PACKAGE]; return clone; };
		const uploads = join(consumer, "uploads");
		mkdirSync(uploads);
		const mediaBytes = Buffer.from("Synthetic retained media file\n");
		assert.equal(mediaBytes.byteLength, 30);
		writeFileSync(join(uploads, "removal-retained.txt"), mediaBytes);
		mkdirSync(join(consumer, "src/pages/posts"), { recursive: true });
		writeFileSync(join(consumer, "src/live.config.ts"), 'import { defineLiveCollection } from "astro:content";\nimport { emdashLoader } from "emdash/runtime";\nexport const collections = { _emdash: defineLiveCollection({ loader: emdashLoader() }) };\n');
		writeFileSync(join(consumer, "src/middleware.ts"), 'import { defineMiddleware } from "astro:middleware";\nexport const onRequest = defineMiddleware(async (_context, next) => { const runtime = globalThis[Symbol.for("emdash:runtime-holder")]?.instance; if (runtime) globalThis[Symbol.for("removal-fixture-runtimes")]?.add(runtime); return next(); });\n');
		writeFileSync(join(consumer, "src/pages/index.astro"), homeSource);
		writeFileSync(join(consumer, "src/pages/posts/[slug].astro"), postSource);
		const activeConfig = configSource(database, uploads, true);
		const removedConfig = configSource(database, uploads, false);
		writeFileSync(join(consumer, "astro.config.mjs"), activeConfig);
		writeFileSync(join(consumer, "registration-check.mjs"), registrationSource);
		await run(process.execPath, [join(consumer, "registration-check.mjs")], "exact-wrapper-registration", { guarded: true, milliseconds: 30_000 });
		await lifecycle("seed-disable");
		await build("installed-wrapper-build");
		assert.ok(hasAdminStyles(join(consumer, "dist/client")), "The initial installed wrapper bundles its admin styles");
		assertRetained();
		receipt.steps.initialWrapper = { registeredKeyRoute: true, registeredSitemapAndLlmsMiddleware: true, productionBuild: true, adminStylesBundled: true };
		const raw = `ec_pat_${randomBytes(32).toString("base64url")}`;
		const db = new DatabaseSync(database);
		try {
			const now = new Date().toISOString();
			db.prepare("INSERT INTO users (id, email, name, role, email_verified, created_at, updated_at, disabled) VALUES (?, ?, ?, 50, 1, ?, ?, 0)").run("removal-http-admin", "http-admin@example.test", "Removal HTTP administrator", now, now);
			db.prepare("INSERT INTO _emdash_api_tokens (id, name, token_hash, prefix, user_id, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run("removal-http-token", "Isolated removal verification", createHash("sha256").update(raw).digest("base64url"), raw.slice(0, 11), "removal-http-admin", JSON.stringify(["admin"]), now);
			assert.equal(db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy, 0);
		} finally { db.close(); }
		const backupDirectory = join(work, "stopped-backup");
		mkdirSync(backupDirectory);
		const backups = {};
		for (const name of ["site.sqlite", "astro.config.mjs", "package.json", "pnpm-lock.yaml", "uploads/removal-retained.txt"]) {
			const destination = join(backupDirectory, name);
			mkdirSync(dirname(destination), { recursive: true });
			cpSync(join(consumer, name), destination);
			backups[name] = sha(readFileSync(destination));
			assert.equal(sha(readFileSync(join(consumer, name))), backups[name]);
		}
		receipt.steps.stoppedBackup = { files: Object.keys(backups).length, databaseSha256: backups["site.sqlite"], uploadsSha256: backups["uploads/removal-retained.txt"], configurationSha256: backups["astro.config.mjs"], lockSha256: backups["pnpm-lock.yaml"], lifecycleBackupSha256: readJson(stateFile).backupSha256 };
		assert.equal(active.size, 0, "Restore verification starts with all fixture processes closed");
		const restoredDatabase = join(work, "restored-backup.sqlite");
		cpSync(join(backupDirectory, "site.sqlite"), restoredDatabase);
		assert.equal(sha(readFileSync(restoredDatabase)), backups["site.sqlite"]);
		const restored = new DatabaseSync(restoredDatabase, { readOnly: true });
		try {
			assert.deepEqual(restored.prepare("PRAGMA integrity_check").all().map((row) => row.integrity_check), ["ok"]);
			assert.deepEqual({ ...restored.prepare("SELECT status, source FROM _plugin_state WHERE plugin_id = 'shipit-seo'").get() }, { status: "inactive", source: "config" });
			assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM _emdash_cron_tasks WHERE plugin_id = 'shipit-seo' AND enabled != 0").get().count, 0);
		} finally { restored.close(); }
		receipt.steps.stoppedBackup.restore = { copiedToSeparateOwnedFile: true, openedReadOnly: true, integrity: "ok", retainedSha256: assertRetained(restoredDatabase), inactiveStateAndCronRetained: true, boundary: "Database restore and retained-record readback; complete matching package/configuration rollback is covered separately." };
		writeFileSync(join(consumer, "astro.config.mjs"), removedConfig);
		await run("pnpm", ["--config.offline=true", "--config.ignore-scripts=true", "--config.strict-peer-dependencies=true", `--config.store-dir=${storeDirectory}`, "remove", PACKAGE], "remove-plugin-dependency");
		assert.deepEqual(readJson(join(consumer, "package.json")), withoutPlugin(installedManifest), "Dependency removal preserves every other direct dependency and manifest option");
		assert.equal(existsSync(join(consumer, "node_modules", ...PACKAGE.split("/"))), false);
		assert.equal(readFileSync(join(consumer, "astro.config.mjs"), "utf8"), removedConfig);
		await build("original-emdash-build");
		assert.equal(hasAdminStyles(join(consumer, "dist/client")), false, "The clean removal build contains no plugin admin styles");
		const redirectBefore = redirectRow();
		const removed = await openServer("removed-production-server");
		try {
			const result = await request(removed.origin, "/posts/dental-care");
			assert.equal(result.status, 200);
			const head = publicHead(result.text);
			assert.equal(head.title, "Dental care at the local practice", "The theme owns the document title");
			assert.equal(head.description, "Saved native dental description retained after removal.");
			assert.equal(head.canonical, `${SITE}/posts/dental-care`);
			assert.equal(head.socialTitle, "Saved native dental title");
			assert.equal(head.socialDescription, "Saved native dental description retained after removal.");
			assert.equal(/noindex|nofollow/.test(head.robots ?? ""), false, "Plugin restrictions stop contributing");
			assert.ok(head.graphs.some((graph) => graph["@type"] === "BlogPosting"), "EmDash supplies its article fallback");
			assert.equal(head.graphs.some((graph) => graph["@type"] === "Dentist" || graph["@id"]?.endsWith("#retained-article")), false);
			const pluginList = await request(removed.origin, "/_emdash/api/admin/plugins", { token: raw });
			assert.equal(pluginList.status, 200);
			assert.equal(JSON.parse(pluginList.text).data.items.some((item) => item.id === "shipit-seo"), false, "The core admin list has no removed configured plugin");
			for (const path of ["/_emdash/api/plugins/shipit-seo/admin-settings", "/_emdash/api/plugins/shipit-seo/public-indexnow-key", "/indexnow-key.txt", "/llms.txt"]) for (const method of ["GET", "HEAD"]) {
				const absent = await request(removed.origin, path, { method, token: raw });
				assert.equal(absent.status, 404, `${method} ${path} is absent after removal`);
				if (method === "HEAD") assert.equal(absent.bytes, 0);
			}
			const robots = await request(removed.origin, "/robots.txt");
			assert.equal(robots.status, 200);
			assert.equal(robots.text, `User-agent: *\nDisallow: /retained-private/\n\nSitemap: ${SITE}/sitemap.xml\n`);
			assert.equal(robots.headers.get("cache-control"), "public, max-age=86400");
			const sitemap = await request(removed.origin, "/sitemap.xml");
			assert.equal(sitemap.status, 200);
			assert.equal(sitemap.headers.get("cache-control"), "public, max-age=3600");
			assert.ok(sitemap.text.includes(`${SITE}/sitemap-posts.xml`));
			const posts = await request(removed.origin, "/sitemap-posts.xml");
			assert.equal(posts.status, 200);
			assert.ok(posts.text.includes(`${SITE}/posts/dental-care`));
			const redirect = await request(removed.origin, "/retained-redirect");
			assert.equal(redirect.status, 301);
			assert.equal(new URL(redirect.headers.get("location"), removed.origin).pathname, "/posts/dental-care");
			const media = await request(removed.origin, "/_emdash/api/media/file/removal-retained.txt");
			assert.equal(media.status, 200);
			assert.equal(media.text, mediaBytes.toString("utf8"));
			receipt.steps.removedPublic = { themeTitle: head.title, nativeDescription: head.description, canonical: head.canonical, nativeSocial: true, pluginRestrictionsAbsent: true, coreArticleFallback: true, adminListAbsent: true, pluginApiAndKeyAbsent: true, llmsTxtAbsent: true, savedCoreRobots: true, coreSitemap: true, redirectSurvives: true, mediaSurvives: true };
		} finally { const stopped = await stop(removed.record); assert.deepEqual(stopped, { forced: false, code: 0, signal: null }, `The removed production runtime shuts down cleanly: ${removed.record.output.slice(-4096)}`); }
		const redirectAfter = redirectRow();
		const redirectChanges = Object.keys(redirectBefore).filter((name) => redirectBefore[name] !== redirectAfter[name]).sort();
		assert.deepEqual(redirectChanges, ["hits", "last_hit_at", "updated_at"]);
		assert.equal(redirectAfter.hits, redirectBefore.hits + 1);
		assert.equal(redirectAfter.last_hit_at, redirectAfter.updated_at, "The released core hit tracker updates both access timestamps");
		receipt.steps.removedPublic.redirectAccess = { hitDelta: 1, changedFields: redirectChanges, configurationAndRevisionUnchanged: true };
		receipt.steps.removedPublic.retainedSha256 = assertRetained();
		await lifecycle("without-plugin");
		await run("pnpm", ["add", `file:${options.archive}`, ...pnpmOptions], "reinstall-exact-archive");
		assert.deepEqual(withoutPlugin(readJson(join(consumer, "package.json"))), withoutPlugin(installedManifest));
		writeFileSync(join(consumer, "astro.config.mjs"), activeConfig);
		await build("reinstalled-wrapper-build");
		assert.ok(hasAdminStyles(join(consumer, "dist/client")));
		await lifecycle("reinstall-enable");
		const reinstalled = await openServer("reinstalled-production-server");
		try {
			const key = await request(reinstalled.origin, "/indexnow-key.txt");
			assert.equal(key.status, 200);
			assert.equal(key.text, "0123456789abcdef0123456789abcdef");
			const indexNow = await request(reinstalled.origin, "/_emdash/api/plugins/shipit-seo/admin-indexnow", { token: raw });
			assert.equal(indexNow.status, 200);
			assert.equal(JSON.parse(indexNow.text).data.values.enabled, false);
			const settings = await request(reinstalled.origin, "/_emdash/api/plugins/shipit-seo/admin-settings", { token: raw });
			assert.equal(settings.status, 200);
			assert.equal(JSON.parse(settings.text).data.values.contentScoringEnabled, false);
			const home = await request(reinstalled.origin, "/");
			assert.equal(home.status, 200);
			assert.ok(publicHead(home.text).graphs.some((graph) => graph["@type"] === "Dentist"));
			const post = await request(reinstalled.origin, "/posts/dental-care");
			assert.equal(post.status, 200);
			const head = publicHead(post.text);
			assert.equal(head.socialTitle, "Retained social title");
			assert.ok(head.graphs.some((graph) => graph["@id"] === `${SITE}/posts/dental-care#retained-article`));
			receipt.steps.reinstalledPublic = { explicitEnableRequired: true, optionalWorkRemainsOff: true, retainedKeyServed: true, retainedBusinessIdentity: true, retainedSocialException: true, retainedCustomSchema: true };
		} finally { const stopped = await stop(reinstalled.record); assert.deepEqual(stopped, { forced: false, code: 0, signal: null }, `The reinstalled production runtime shuts down cleanly: ${reinstalled.record.output.slice(-4096)}`); }
		receipt.steps.reinstalledPublic.retainedSha256 = assertRetained();
		for (const [name, hash] of Object.entries(backups)) assert.equal(sha(readFileSync(join(backupDirectory, name))), hash);
		assert.equal(sha(readFileSync(options.archive)), receipt.package.sha256);
		assert.equal(sha(readFileSync(hostPackage)), frozen.manifest);
		assert.equal(sha(readFileSync(hostLock)), frozen.lock);
		const guardRecords = readFileSync(guardReport, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.ok(guardRecords.length > 0 && Buffer.byteLength(JSON.stringify(guardRecords)) <= BUDGET);
		receipt.steps.runtimeEgress = { records: guardRecords.length, observations: guardRecords };
		assert.ok(guardRecords.every((record) => record.externalAttempts === 0));
		for (const label of ["removed-production-server", "reinstalled-production-server"]) assert.ok(guardRecords.some((record) => record.phase === label && record.gracefulShutdown === true));
		receipt.steps.runtimeEgress = { records: guardRecords.length, externalAttempts: 0, gracefulProductionStops: 2, lifecycleNetworkAttempts: 0 };
		receipt.steps.frozenHost = { manifestUnchanged: true, lockUnchanged: true };
		receipt.status = "passed";
	} catch (error) {
		receipt.error = error instanceof Error ? error.message.slice(0, 8192) : String(error).slice(0, 8192);
		throw error;
	} finally {
		try { for (const record of [...active]) await stop(record); }
		finally {
			receipt.finishedAt = new Date().toISOString();
			writeJson(options.receipt, receipt);
			assert.ok(lstatSync(work).isDirectory() && work.startsWith(join(tmpdir(), "shipit-seo-removal-")));
			assert.equal(active.size, 0, "All owned processes must stop before cleanup");
			rmSync(work, { recursive: true });
		}
	}
	console.log("Exact-package native removal, public fallback and reinstallation passed on released EmDash 1.3.0.");
}

function configSource(database, uploads, installed) {
	return `import node from "@astrojs/node";\nimport react from "@astrojs/react";\nimport { defineConfig } from "astro/config";\nimport emdash, { local } from "emdash/astro";\nimport { sqlite } from "emdash/db";\n${installed ? 'import { shipitSeo } from "@shipitseo/emdash-plugin-seo/astro";\n' : ""}\nconst originalOptions = { database: sqlite({ url: ${JSON.stringify(`file:${database}`)} }), storage: local({ directory: ${JSON.stringify(uploads)}, baseUrl: "/_emdash/api/media/file" }), registry: false, fonts: false, siteUrl: ${JSON.stringify(SITE)} };\nexport default defineConfig({ site: ${JSON.stringify(SITE)}, output: "server", trailingSlash: "ignore", devToolbar: { enabled: false }, adapter: node({ mode: "standalone" }), integrations: [react(), ${installed ? "shipitSeo(emdash, originalOptions)" : "emdash(originalOptions)"}], vite: { resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query"] }${installed ? ', ssr: { noExternal: ["@shipitseo/emdash-plugin-seo"] }' : ""} } });\n`;
}

const homeSource = `---
import { createPublicPageContext } from "emdash/page";
import { EmDashHead, EmDashBodyStart, EmDashBodyEnd } from "emdash/ui";
const page = createPublicPageContext({ Astro, kind: "custom", title: "Retained home", description: "Synthetic native removal fixture", siteName: "Removal Dental", siteUrl: "https://example.com" });
---
<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Retained home</title><EmDashHead page={page} /></head><body><EmDashBodyStart page={page} /><main><h1>Retained home</h1></main><EmDashBodyEnd page={page} /></body></html>
`;

const postSource = `---
import { getEmDashEntry } from "emdash";
import { createPublicPageContext } from "emdash/page";
import { EmDashHead, EmDashBodyStart, EmDashBodyEnd } from "emdash/ui";
const { slug } = Astro.params;
if (!slug) return new Response(null, { status: 404 });
const { entry, error } = await getEmDashEntry("posts", slug, { locale: "en" });
if (error) throw error;
const data = (entry?.data ?? {}) as Record<string, unknown>;
if (!entry || typeof data.id !== "string") return new Response(null, { status: 404 });
const title = typeof data.title === "string" ? data.title : slug;
const page = createPublicPageContext({ Astro, kind: "content", pageType: "article", title, pageTitle: title, description: typeof data.excerpt === "string" ? data.excerpt : "", canonical: new URL(Astro.url.pathname, Astro.url.origin).href, siteName: "Removal Dental", siteUrl: "https://example.com", content: { collection: "posts", id: data.id, slug: entry.id } });
---
<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>{title}</title><EmDashHead page={page} /></head><body><EmDashBodyStart page={page} /><main><h1>{title}</h1></main><EmDashBodyEnd page={page} /></body></html>
`;

const registrationSource = `import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import emdash from "emdash/astro";
import { shipitSeo } from "@shipitseo/emdash-plugin-seo/astro";
const integration = shipitSeo(emdash, { plugins: [], registry: false, fonts: false });
const root = new URL("./", import.meta.url);
const injected = []; const middleware = [];
const config = { root, base: "/", site: "https://example.com", trailingSlash: "ignore", security: {}, image: {}, srcDir: new URL("src/", root), publicDir: new URL("public/", root), integrations: [integration] };
await integration.hooks["astro:config:setup"]({ config, command: "build", isRestart: false, injectRoute: (route) => injected.push(route), addMiddleware: (entry) => middleware.push(entry), updateConfig: () => config, logger: { warn() {}, info() {}, debug() {}, error() {} } });
const route = injected.filter((item) => item.pattern === "/indexnow-key.txt");
assert.equal(route.length, 1);
assert.equal(realpathSync(fileURLToPath(route[0].entrypoint)), realpathSync(fileURLToPath(new URL("node_modules/@shipitseo/emdash-plugin-seo/dist/indexnow-route.js", root))));
for (const name of ["sitemap", "llms-txt"]) {
 const expected = realpathSync(fileURLToPath(new URL("node_modules/@shipitseo/emdash-plugin-seo/dist/" + name + "-middleware-entry.js", root)));
 assert.equal(middleware.filter((entry) => entry.entrypoint instanceof URL && realpathSync(fileURLToPath(entry.entrypoint)) === expected).length, 1);
}
console.log("Exact installed wrapper registers its key route and public middleware.");
`;

const runtimeGuardSource = `import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import dgram from "node:dgram";
let externalAttempts = 0;
let gracefulShutdown = false;
const denied = [];
const deny = (operation, hostname = "") => { externalAttempts += 1; if (denied.length < 10) denied.push({ operation, hostname: String(hostname).slice(0, 128) }); throw new Error("Non-loopback networking is disabled in removal verification"); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => { const url = new URL(input instanceof Request ? input.url : String(input)); if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return deny("fetch", url.hostname); return originalFetch(input, init); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { const first = args[0]; const host = first && typeof first === "object" ? first.host ?? first.hostname : typeof first === "number" ? args[1] : null; if (host !== "127.0.0.1") return deny("net.connect", host ?? (Array.isArray(first) ? "normalized-arguments-array" : typeof first)); return connect.apply(this, args); };
tls.connect = (...args) => deny("tls.connect", args[0]?.host ?? args[0]?.hostname ?? ""); dgram.createSocket = () => deny("dgram.createSocket");
const lookup = dns.lookup;
dns.lookup = (hostname, ...args) => hostname === "127.0.0.1" ? lookup(hostname, ...args) : deny("dns.lookup", hostname);
const promiseLookup = dns.promises.lookup;
dns.promises.lookup = async (hostname, ...args) => hostname === "127.0.0.1" ? promiseLookup(hostname, ...args) : deny("dns.promises.lookup", hostname);
for (const name of Object.keys(dns)) if (/^(?:lookupService|resolve|reverse)/.test(name) && typeof dns[name] === "function") dns[name] = (hostname) => deny("dns." + name, hostname);
for (const name of Object.keys(dns.promises)) if (/^(?:lookupService|resolve|reverse)/.test(name) && typeof dns.promises[name] === "function") dns.promises[name] = async (hostname) => deny("dns.promises." + name, hostname);
syncBuiltinESMExports();
const servers = new Set();
const runtimes = new Set();
globalThis[Symbol.for("removal-fixture-runtimes")] = runtimes;
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) { servers.add(this); return listen.apply(this, args); };
let stopping = false;
process.on("SIGTERM", async () => {
 if (stopping) return; stopping = true;
 try {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => { if (!server.listening) return resolve(); server.close((error) => error ? reject(error) : resolve()); })));
  for (const runtime of runtimes) { await runtime.shutdown(); await runtime.db.destroy(); }
  gracefulShutdown = servers.size > 0 && runtimes.size > 0;
  process.exit(gracefulShutdown ? 0 : 143);
 } catch (error) { console.error("Removal fixture shutdown failed:", error.message); process.exit(1); }
});
process.on("exit", () => { assert.ok(process.env.REMOVAL_GUARD_REPORT); appendFileSync(process.env.REMOVAL_GUARD_REPORT, JSON.stringify({ phase: process.env.REMOVAL_GUARD_PHASE, externalAttempts, denied, gracefulShutdown }) + "\\n"); });
`;

await main();
