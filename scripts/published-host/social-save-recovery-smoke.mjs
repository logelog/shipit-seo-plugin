// Exact-package Social checks use released runtime dispatch and disposable SQLite.
// Faults are injected at the host repository boundary, never in product handlers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEnvironment, runtimeExport, selectHostTarget } from "./environment.mjs";

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
	assert.ok(["--archive", "--receipt", "--mode", "--target"].includes(args[i]) && args[i + 1] && !options[args[i]], "Usage: social-save-recovery-smoke.mjs --archive ABSOLUTE_TGZ --receipt ABSOLUTE_JSON --mode beta5-red|green [--target native-1.2.0|native-1.3.0]");
	options[args[i]] = args[i + 1];
}
const archive = options["--archive"];
const receiptFile = options["--receipt"];
const mode = options["--mode"];
assert.ok(archive && isAbsolute(archive) && receiptFile && isAbsolute(receiptFile));
assert.ok(["beta5-red", "green"].includes(mode));
assert.equal(process.platform, "linux");
assert.equal(process.versions.node, "24.19.0");
const environment = createEnvironment(undefined, selectHostTarget(options["--target"] ?? process.env.SHIPIT_HOST_TARGET ?? "native-1.2.0"));
assert.ok(["native-1.2.0", "native-1.3.0"].includes(environment.target.name));
environment.assertVersions();
const PLUGIN = "shipit-seo";
const PACKAGE = "@shipitseo/emdash-plugin-seo";
const SITE = "https://example.com";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const bytes = readFileSync(archive);
if (mode === "beta5-red") {
	assert.equal(bytes.byteLength, 777343);
	assert.equal(sha(bytes), "1597bf157919b36804214be5d09c1416780d3738c16d717749390b66559af79c");
}
mkdirSync(dirname(receiptFile), { recursive: true });
const work = mkdtempSync(join(dirname(receiptFile), "runtime-"));
const report = {
	schemaVersion: 1, status: "failed", mode, target: environment.target.name, node: process.versions.node,
	host: { emdash: environment.target.versions.get("emdash"), admin: environment.target.versions.get("@emdash-cms/admin"), database: "SQLite", dependencies: "Existing pinned host graph; no install or build" },
	artifact: { file: archive, bytes: bytes.byteLength, sha256: sha(bytes) },
	fixtureSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
	evidence: "Actual extracted package, configured released EmDashRuntime and published HTTP dispatcher",
	faultBoundary: "Host repository wrappers delegate real persistence; selected faults alter acknowledgement/read behavior. Explicit competing-writer cases use labelled fixture writes outside counted product calls.",
	networkAttempts: 0, cases: [],
};
const writeReport = () => {
	const text = JSON.stringify(report, null, 2) + "\n";
	assert.ok(Buffer.byteLength(text) <= 65536);
	writeFileSync(receiptFile, text);
};
const watchdog = setTimeout(() => {
	report.error = "Social runtime fixture exceeded 45 seconds";
	writeReport();
	process.exit(1);
}, 45000);
const deny = () => { report.networkAttempts += 1; throw new Error("Networking is disabled in the Social recovery fixture"); };
globalThis.fetch = async () => deny();
net.Socket.prototype.connect = deny;
tls.connect = deny;
dgram.createSocket = deny;
for (const target of [dns, dns.promises]) for (const name of Object.keys(target)) {
	if (/^(?:lookup|resolve|reverse)/.test(name) && typeof target[name] === "function") target[name] = deny;
}
syncBuiltinESMExports();
const run = (command, arguments_) => {
	const result = spawnSync(command, arguments_, { encoding: "utf8", maxBuffer: 1048576 });
	if (result.error) throw result.error;
	assert.equal(result.status, 0, result.stderr);
	return result.stdout;
};
async function hostExport(name) {
	const directory = new URL("dist/", environment.hostPackageRoot("emdash"));
	for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const url = new URL(file, directory);
		const source = readFileSync(url, "utf8");
		const alias = source.match(new RegExp("\\b" + name + " as ([A-Za-z_$][\\w$]*)"))?.[1];
		if (alias) return { url, source, alias };
	}
	throw new Error("Missing published host export " + name);
}
async function importHostExport(name) {
	const found = await hostExport(name);
	return (await import(found.url.href))[found.alias];
}

let runtime;
try {
	assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 20 * 1024 * 1024);
	const entries = run("tar", ["-tzf", archive]).trim().split("\n");
	assert.ok(entries.length > 0 && entries.length < 500);
	assert.ok(entries.every((path) => path.startsWith("package/") && !path.split("/").includes("..")));
	assert.ok(run("tar", ["-tvzf", archive]).trim().split("\n").every((line) => /^[d-]/.test(line)));
	const packageRoot = join(work, "node_modules", ...PACKAGE.split("/"));
	mkdirSync(packageRoot, { recursive: true });
	run("tar", ["-xzf", archive, "-C", packageRoot, "--strip-components=1"]);
	const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	assert.equal(manifest.name, PACKAGE);
	assert.equal(existsSync(join(packageRoot, "src")), false);
	report.artifact.version = manifest.version;
	if (mode === "beta5-red") assert.equal(manifest.version, "0.4.0-beta.5");
	const hostManifest = JSON.parse(readFileSync(new URL("package.json", environment.hostRoot), "utf8"));
	const coreManifest = JSON.parse(readFileSync(new URL("package.json", environment.hostPackageRoot("emdash")), "utf8"));
	for (const name of new Set([...Object.keys(hostManifest.dependencies), ...Object.keys(hostManifest.devDependencies), ...Object.keys(coreManifest.dependencies), ...Object.keys(manifest.peerDependencies ?? {})])) {
		const target = join(work, "node_modules", name);
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(realpathSync(fileURLToPath(environment.hostPackageRoot(name))), target);
	}
	const config = { database: { entrypoint: "emdash/db/sqlite", config: { url: join(work, "social.sqlite") } }, siteUrl: SITE };
	const runtimeInfo = await hostExport("EmDashRuntime");
	assert.equal((runtimeInfo.source.match(/import\.meta\.env\.DEV/g) ?? []).length, 1);
	const virtualConfig = "data:text/javascript," + encodeURIComponent("export default " + JSON.stringify(config) + ";");
	registerHooks({
		resolve(specifier, context, nextResolve) { return nextResolve(specifier === "virtual:emdash/config" ? virtualConfig : specifier, context); },
		load(url, context, nextLoad) {
			const loaded = nextLoad(url, context);
			return url === runtimeInfo.url.href ? { ...loaded, source: runtimeInfo.source.replace("import.meta.env.DEV", "false") } : loaded;
		},
	});
	const { createDialect } = await import(runtimeExport(environment, "emdash", "./db/sqlite").href);
	const { runMigrations } = await import(runtimeExport(environment, "emdash", "./db").href);
	const { Kysely } = await import(runtimeExport(environment, "kysely").href);
	const { OptionsRepository, PluginStorageRepository } = await import(runtimeExport(environment, "emdash").href);
	const bootstrap = new Kysely({ dialect: createDialect({ url: config.database.config.url }) });
	try {
		await runMigrations(bootstrap);
		const settings = new OptionsRepository(bootstrap);
		for (const name of ["emdash:setup_complete", "emdash:seed_complete"]) await settings.set(name, true);
		for (const name of ["site:url", "emdash:site_url"]) await settings.set(name, SITE);
	} finally { await bootstrap.destroy(); }
	const { createPlugin } = await import(pathToFileURL(join(packageRoot, manifest.exports["./plugin"].default)).href);
	const plugin = createPlugin({ siteUrl: SITE });
	assert.equal(plugin.version, manifest.version);
	const EmDashRuntime = (await import(runtimeInfo.url.href))[runtimeInfo.alias];
	runtime = await EmDashRuntime.create({ config, plugins: [plugin], createDialect, sandboxEnabled: false, sandboxBypassed: false, sandboxedPluginEntries: [], mediaProviderEntries: [], migrationMode: "auto" });
	assert.equal(runtime.isPluginEnabled(PLUGIN), true);
	const dispatch = await importHostExport("dispatchPluginApiRequest");
	const caller = { id: "social-fixture-admin", email: "admin@example.test", name: "Social fixture administrator", role: 50, emailVerified: true, avatarUrl: null, data: null, createdAt: "2026-10-15T00:00:00.000Z" };
	const call = async (route, body, extra = {}) => {
		const request = new Request(SITE + "/_emdash/api/plugins/" + PLUGIN + "/" + route, {
			method: extra.method ?? "POST", headers: { "Content-Type": "application/json", ...(extra.csrf === false ? {} : { "X-EmDash-Request": "1" }), ...extra.headers },
			...(extra.method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
		});
		const response = await dispatch({ runtime, pluginId: PLUGIN, path: "/" + route, request, user: extra.user === undefined ? caller : extra.user });
		return { status: response.status, allow: response.headers.get("allow"), payload: await response.json() };
	};
	await runtime.schemaRegistry.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] });
	for (const slug of ["title", "excerpt"]) await runtime.schemaRegistry.createField("posts", { slug, label: slug, type: "string" });
	const ContentRepository = await importHostExport("ContentRepository");
	const content = new ContentRepository(runtime.db);
	const entry = await content.create({ type: "posts", slug: "social-recovery-proof", status: "published", locale: "en", data: { title: "Social recovery fixture", excerpt: "Synthetic content in a disposable Social save database." } });
	const ref = "posts:" + entry.id;
	const store = new PluginStorageRepository(runtime.db, PLUGIN, "socialOverrides", plugin.storage.socialOverrides.indexes);
	await new OptionsRepository(runtime.db).set("plugin:other-plugin:social-fixture-sentinel", { preserve: "Unrelated option" });
	await new PluginStorageRepository(runtime.db, PLUGIN, "schemas", plugin.storage.schemas.indexes).put("social-fixture-sentinel", { preserve: "Unrelated schema row" });
	const preservationSnapshot = async () => ({
		options: await runtime.db.selectFrom("options").selectAll().orderBy("name").execute(),
		storage: await runtime.db.selectFrom("_plugin_storage").selectAll().where("collection", "!=", "socialOverrides").orderBy("plugin_id").orderBy("collection").orderBy("id").execute(),
		content: await runtime.db.selectFrom("ec_posts").selectAll().orderBy("id").execute(),
		coreSeo: await runtime.db.selectFrom("_emdash_seo").selectAll().orderBy("collection").orderBy("content_id").execute(),
	});
	const preservedBefore = await preservationSnapshot();
	const methods = ["get", "getVersioned", "put", "delete", "compareAndSet", "compareAndDelete"];
	const counts = Object.fromEntries(methods.map((name) => [name, 0]));
	const originals = Object.fromEntries(methods.map((name) => [name, PluginStorageRepository.prototype[name]]));
	let previewFault = null;
	let afterWriteFault = null;
	let storageFault = null;
	let writeFault = null;
	let capabilityFault = null;
	let writeGate = null;
	let previewReadRace = false;
	let contentReads = 0;
	const touchedIds = new Set();
	for (const name of methods) PluginStorageRepository.prototype[name] = async function (...values) {
		if (this.pluginId !== PLUGIN || this.collection !== "socialOverrides") return originals[name].apply(this, values);
		counts[name] += 1;
		touchedIds.add(values[0]);
		if (name === "getVersioned" && storageFault) {
			if (storageFault === "throw") throw new Error("Controlled versioned Social read failure");
			if (storageFault === "corrupt") return { revision: "fixture-corrupt-read", value: { invalid: true } };
		}
		if (["compareAndSet", "compareAndDelete"].includes(name) && writeGate) {
			const gate = writeGate;
			gate.entered += 1;
			if (gate.entered === 2) gate.release();
			await gate.promise;
		}
		const result = await originals[name].apply(this, values);
		if (name === "get" && values[0] === ref && previewReadRace) {
			previewReadRace = false;
			await originals.put.call(this, ref, { storageVersion: 1, ref, title: "New canonical value after preview read", description: null, updatedAt: new Date().toISOString() });
		}
		if (["put", "compareAndSet", "compareAndDelete", "delete"].includes(name) && afterWriteFault) previewFault = afterWriteFault;
		if (["compareAndSet", "compareAndDelete"].includes(name) && writeFault && result.applied) {
			const selected = writeFault;
			writeFault = null;
			if (selected === "malformed-ack") return { applied: "not-a-boolean" };
			if (selected === "malformed-ack-unreadable") {
				storageFault = "throw";
				return { applied: "not-a-boolean" };
			}
			if (selected === "commit-throw-different") {
				await originals.put.call(this, ref, { storageVersion: 1, ref, title: "Concurrent later value", description: null, updatedAt: new Date().toISOString() });
				throw new Error("Controlled lost acknowledgement after another writer replaced the value");
			}
			if (selected !== "commit-throw") storageFault = selected === "commit-throw-unreadable" ? "throw" : "corrupt";
			throw new Error("Controlled committed conditional Social write then lost acknowledgement");
		}
		return result;
	};
	const PluginContextFactory = await importHostExport("PluginContextFactory");
	const originalContext = PluginContextFactory.prototype.createContext;
	PluginContextFactory.prototype.createContext = function (definition) {
		const context = originalContext.call(this, definition);
		if (definition.id === PLUGIN && capabilityFault) context.storage.socialOverrides[capabilityFault] = undefined;
		return context;
	};
	const originalFind = ContentRepository.prototype.findById;
	ContentRepository.prototype.findById = async function (collection, id, ...rest) {
		if (collection === "posts" && id === entry.id) contentReads += 1;
		if (collection === "posts" && id === entry.id && previewFault) {
			if (previewFault === "throw") throw new Error("Controlled content preview read failure after committed Social write");
			return null;
		}
		return originalFind.call(this, collection, id, ...rest);
	};
	const snapshot = () => originals.getVersioned.call(store, ref);
	const resetCounts = () => { for (const key of methods) counts[key] = 0; contentReads = 0; touchedIds.clear(); };
	const record = (name, detail) => { report.cases.push({ name, ...detail, calls: { ...counts }, contentReads, touchedIds: [...touchedIds] }); writeReport(); };
	if (mode === "beta5-red") {
		resetCounts();
		const control = await call("save-admin-entry-social", { ref, title: "Positive control", description: "Saved through actual released dispatch" });
		assert.equal(control.status, 200);
		assert.equal(control.payload.success, true);
		assert.equal(control.payload.data.success, true);
		assert.equal((await snapshot()).value.title, "Positive control");
		record("positive-success-control", { status: control.status, operationSuccess: true, persistedTitle: "Positive control" });
		for (const fault of ["not_found", "throw"]) {
			previewFault = null;
			afterWriteFault = fault;
			resetCounts();
			const title = "Committed before preview " + fault;
			const response = await call("save-admin-entry-social", { ref, title, description: "This write survives the controlled preview fault" });
			const persisted = await snapshot();
			assert.equal(persisted.value.title, title);
			if (fault === "not_found") {
				assert.equal(response.status, 200);
				assert.equal(response.payload.data.success, false);
				assert.equal(response.payload.data.error, "not_found");
			} else {
				assert.equal(response.payload.success, false);
				assert.ok(response.status >= 400);
			}
			record("committed-write-preview-" + fault, { defectObserved: true, status: response.status, response: response.payload, durableOverride: persisted.value });
		}
		previewFault = null;
		afterWriteFault = null;
		const baseline = await snapshot();
		const clients = await Promise.all([call("admin-entry-preview", { ref }), call("admin-entry-preview", { ref })]);
		assert.ok(clients.every((client) => client.payload.data.success && client.payload.data.preview.social.override.title === baseline.value.title));
		resetCounts();
		const first = await call("save-admin-entry-social", { ref, title: "First client newer value", description: "First client" });
		const second = await call("save-admin-entry-social", { ref, title: "Stale second client value", description: "Second client from same old baseline" });
		assert.equal(first.payload.data.success, true);
		assert.equal(second.payload.data.success, true);
		const final = await snapshot();
		assert.equal(final.value.title, "Stale second client value");
		assert.notEqual(final.revision, baseline.revision);
		record("stale-second-client-overwrites-first", { defectObserved: true, bothClientsObservedSameBaseline: true, bothSavesAcknowledged: true, durableTitle: final.value.title });
		report.status = "red-reproduced";
	} else {
		const contract = await import(pathToFileURL(join(packageRoot, manifest.exports["./admin-contract"].default)).href);
		const contractVersion = contract.SEO_ADMIN_CONTRACT_VERSION;
		assert.ok([39, 40, 41, 42, 43, 44, 45, 46, 47].includes(contractVersion), "Social recovery requires a supported admin contract");
		const writes = () => counts.compareAndSet + counts.compareAndDelete;
		const assertBounded = (maximumReads = 1, maximumWrites = 1) => {
			assert.equal(counts.put + counts.delete, 0, "Guarded Social routes never use unconditional writes");
			assert.equal(counts.get, 0, "Editing commands use authoritative versioned reads");
			assert.ok(counts.getVersioned <= maximumReads, "Versioned reads stay within the exact-record budget");
			assert.ok(writes() <= maximumWrites, "At most one conditional write is attempted");
			assert.ok([...touchedIds].every((id) => id === ref), "Editing commands touch only the canonical Social key");
		};
		const data = (response) => {
			assert.equal(response.status, 200, JSON.stringify(response));
			assert.equal(response.payload.success, true, JSON.stringify(response));
			assert.equal(response.payload.data.contractVersion, contractVersion);
			return response.payload.data;
		};
		const read = async () => data(await call("admin-entry-social", { ref }));
		const save = async (expectedRevision, title, description = "") => data(await call("save-admin-entry-social", { ref, title, description, expectedRevision }));
		const assertSnapshot = (result, title, revision) => {
			assert.equal(result.success, true, JSON.stringify(result));
			assert.equal(result.ref, ref);
			assert.equal(result.snapshot.ref, ref);
			if (title === null) {
				assert.equal(result.snapshot.override, null);
				assert.equal(result.snapshot.revision, null);
			} else {
				assert.equal(result.snapshot.override.ref, ref);
				assert.equal(result.snapshot.override.title, title);
				assert.equal(typeof result.snapshot.revision, "string");
				assert.ok(result.snapshot.revision.length > 0);
			}
			if (revision !== undefined) assert.equal(result.snapshot.revision, revision);
		};
		const assertRejected = (result, error) => {
			assert.deepEqual([result.success, result.ref, result.outcome, result.error], [false, ref, "rejected", error]);
		};
		const arrange = async (title = null, description = "") => {
			previewFault = null; afterWriteFault = null; storageFault = null; writeFault = null; capabilityFault = null;
			if (title === null) await originals.delete.call(store, ref);
			else await originals.put.call(store, ref, { storageVersion: 1, ref, title, description: description || null, updatedAt: new Date().toISOString() });
			return snapshot();
		};
		resetCounts();
		const absent = await read();
		assertSnapshot(absent, null);
		assert.equal(counts.getVersioned, 1);
		assertBounded(1, 0);
		record("strict-absent-snapshot", { snapshot: absent.snapshot });
		resetCounts();
		const created = await save(null, "  Guarded   title  ", "  Saved   description ");
		assertSnapshot(created, "Guarded title");
		assert.equal(created.outcome, "saved");
		assert.equal(created.snapshot.override.description, "Saved description");
		assert.equal((await snapshot()).revision, created.snapshot.revision);
		assert.deepEqual((await snapshot()).value, created.snapshot.override);
		assert.equal(counts.compareAndSet, 1);
		assertBounded();
		record("guarded-create-normalizes", { outcome: created.outcome });
		resetCounts();
		const unchanged = await save(created.snapshot.revision, " Guarded title ", "Saved description");
		assertSnapshot(unchanged, "Guarded title", created.snapshot.revision);
		assert.equal(unchanged.outcome, "unchanged");
		assertBounded(1, 0);
		record("unchanged-normalized-zero-writes", { outcome: unchanged.outcome });
		resetCounts();
		const updated = await save(created.snapshot.revision, "Updated guarded title", "Saved description");
		assertSnapshot(updated, "Updated guarded title");
		assert.notEqual(updated.snapshot.revision, created.snapshot.revision);
		assert.deepEqual((await snapshot()).value, updated.snapshot.override);
		assertBounded();
		record("guarded-update-new-revision", { outcome: updated.outcome });
		for (const [label, title, description] of [["update", "Stale overwrite", ""], ["clear", "", ""]]) {
			resetCounts();
			const rejected = await save(created.snapshot.revision, title, description);
			assertRejected(rejected, "conflict");
			assert.equal((await snapshot()).value.title, "Updated guarded title");
			assertBounded(1, 0);
			record("stale-" + label + "-rejected", { outcome: rejected.outcome, error: rejected.error });
		}
		resetCounts();
		const cleared = await save(updated.snapshot.revision, "", "");
		assertSnapshot(cleared, null);
		assert.equal(cleared.outcome, "saved");
		assert.equal(counts.compareAndDelete, 1);
		assert.equal(await snapshot(), null);
		assertBounded();
		record("guarded-clear", { outcome: cleared.outcome });
		resetCounts();
		const absentUnchanged = await save(null, "", "");
		assertSnapshot(absentUnchanged, null);
		assert.equal(absentUnchanged.outcome, "unchanged");
		assertBounded(1, 0);
		record("absent-clear-zero-writes", { outcome: absentUnchanged.outcome });
		for (const label of ["create", "update", "clear-update"]) {
			const baseline = await arrange(label === "create" ? null : "Race baseline");
			let release;
			writeGate = { entered: 0, promise: new Promise((resolve) => { release = resolve; }), release: () => release() };
			const timer = setTimeout(() => { release(); }, 2000);
			resetCounts();
			let results;
			try {
				results = await Promise.all([save(baseline?.revision ?? null, label === "clear-update" ? "" : "Race first"), save(baseline?.revision ?? null, "Race second")]);
				assert.equal(writeGate.entered, 2, "Both requests reach the genuine conditional-write boundary");
			} finally { clearTimeout(timer); writeGate = null; }
			assert.equal(results.filter((result) => result.success).length, 1);
			assertRejected(results.find((result) => !result.success), "conflict");
			const winner = results.find((result) => result.success);
			const durable = await snapshot();
			assert.deepEqual(durable?.value ?? null, winner.snapshot.override);
			assert.equal(durable?.revision ?? null, winner.snapshot.revision);
			assertBounded(2, 2);
			record("native-cas-race-" + label, { successful: 1, conflicted: 1, conditionalAttempts: writes() });
		}
		await arrange(null);
		const abaFirst = await save(null, "ABA original");
		const abaMiddle = await save(abaFirst.snapshot.revision, "ABA different");
		const abaLast = await save(abaMiddle.snapshot.revision, "ABA original");
		resetCounts();
		const abaStale = await save(abaFirst.snapshot.revision, "ABA original");
		assertRejected(abaStale, "conflict");
		assert.equal((await snapshot()).revision, abaLast.snapshot.revision);
		assertBounded(1, 0);
		record("aba-stale-noop-rejected", { sameValuesNewRevision: true, error: abaStale.error });
		for (const clear of [false, true]) {
			const baseline = await arrange("Commit then throw baseline");
			writeFault = "commit-throw";
			resetCounts();
			const recovered = await save(baseline.revision, clear ? "" : "Committed with lost acknowledgement");
			assertSnapshot(recovered, clear ? null : "Committed with lost acknowledgement");
			assert.deepEqual((await snapshot())?.value ?? null, recovered.snapshot.override);
			assert.equal(recovered.outcome, "saved");
			assert.equal(counts.getVersioned, 2, "Only one recovery read follows the thrown write");
			assertBounded(2);
			record("conditional-" + (clear ? "clear" : "save") + "-commit-then-throw-recovered", { outcome: recovered.outcome });
		}
		await arrange("Malformed acknowledgement baseline");
		writeFault = "malformed-ack";
		resetCounts();
		const malformedRecovered = await save((await snapshot()).revision, "Saved despite malformed acknowledgement");
		assertSnapshot(malformedRecovered, "Saved despite malformed acknowledgement");
		assert.equal(malformedRecovered.outcome, "saved");
		assert.equal(counts.getVersioned, 2);
		assertBounded(2);
		record("malformed-native-acknowledgement-recovered", { outcome: malformedRecovered.outcome });
		for (const fault of ["commit-throw-unreadable", "commit-throw-corrupt", "malformed-ack-unreadable"]) {
			const baseline = await arrange("Uncertain baseline");
			writeFault = fault;
			resetCounts();
			const uncertain = await save(baseline.revision, "Durable uncertain value");
			assert.deepEqual([uncertain.success, uncertain.ref, uncertain.outcome, uncertain.error], [false, ref, "unconfirmed", "unconfirmed"]);
			assert.equal((await snapshot()).value.title, "Durable uncertain value");
			assert.equal(counts.getVersioned, 2);
			assertBounded(2);
			record(fault + "-stays-unconfirmed", { outcome: uncertain.outcome, durableValueExists: true });
			storageFault = null;
			resetCounts();
			const recovered = await read();
			assertSnapshot(recovered, "Durable uncertain value");
			assertBounded(1, 0);
			record(fault + "-explicit-read-only-recovery", { snapshotMatchesSubmittedValues: true });
		}
		const differentBaseline = await arrange("Different readback baseline");
		writeFault = "commit-throw-different";
		resetCounts();
		const differentUnconfirmed = await save(differentBaseline.revision, "Submitted value replaced by a later writer");
		assert.deepEqual([differentUnconfirmed.success, differentUnconfirmed.ref, differentUnconfirmed.outcome, differentUnconfirmed.error], [false, ref, "unconfirmed", "unconfirmed"]);
		assert.equal((await snapshot()).value.title, "Concurrent later value");
		assert.equal(counts.getVersioned, 2);
		assertBounded(2);
		record("commit-then-throw-different-readback-stays-unconfirmed", { outcome: differentUnconfirmed.outcome, concurrentValuePreserved: true });
		resetCounts();
		const differentRecovery = await read();
		assertSnapshot(differentRecovery, "Concurrent later value");
		assertBounded(1, 0);
		record("explicit-recovery-observes-different-current-values", { submittedValuesPresent: false, currentTitle: differentRecovery.snapshot.override.title });
		for (const fault of ["not_found", "throw"]) {
			const baseline = await arrange("Preview failure baseline");
			afterWriteFault = fault;
			resetCounts();
			const acknowledged = await save(baseline.revision, "Save independent of preview " + fault);
			assertSnapshot(acknowledged, "Save independent of preview " + fault);
			assert.equal(contentReads, 1, "Save resolves its target once and never eagerly rebuilds preview");
			assertBounded();
			record("save-acknowledged-with-preview-" + fault, { outcome: acknowledged.outcome, previewRequestedBySave: false });
			const preview = await call("admin-entry-preview", { ref });
			assert.ok(preview.payload.success === false || preview.payload.data.success === false);
			assert.equal((await snapshot()).value.title, "Save independent of preview " + fault);
			previewFault = null; afterWriteFault = null;
		}
		for (const fault of ["throw", "corrupt"]) {
			const baseline = await arrange("Read refusal baseline");
			storageFault = fault;
			resetCounts();
			const unreadable = await read();
			assert.deepEqual([unreadable.success, unreadable.ref, unreadable.error], [false, ref, fault === "throw" ? "storage_unavailable" : "record_invalid"]);
			assertBounded(1, 0);
			record("strict-read-" + fault, { error: unreadable.error });
			resetCounts();
			const refused = await save(baseline.revision, "Must not overwrite unreadable state");
			assertRejected(refused, unreadable.error);
			assertBounded(1, 0);
			record("save-refuses-" + fault, { error: refused.error });
		}
		storageFault = null;
		await arrange("Corrupt persistent record");
		await runtime.db.updateTable("_plugin_storage").set({ data: "{not JSON" }).where("plugin_id", "=", PLUGIN).where("collection", "=", "socialOverrides").where("id", "=", ref).execute();
		resetCounts();
		const invalidJson = await read();
		assert.equal(invalidJson.success, false);
		assert.equal(invalidJson.error, "storage_unavailable");
		assertBounded(1, 0);
		record("stored-json-unreadable-is-not-absent", { error: invalidJson.error });
		await originals.put.call(store, ref, { storageVersion: 1, ref: "posts:wrong-target", title: "Wrong identity", description: null, updatedAt: new Date().toISOString() });
		resetCounts();
		const invalidIdentity = await read();
		assert.equal(invalidIdentity.success, false);
		assert.equal(invalidIdentity.error, "record_invalid");
		assertBounded(1, 0);
		record("record-target-mismatch-refused", { error: invalidIdentity.error });
		for (const method of ["getVersioned", "compareAndSet", "compareAndDelete"]) {
			const baseline = await arrange("Missing capability baseline");
			capabilityFault = method;
			resetCounts();
			const refused = await save(baseline.revision, "Must not write without " + method);
			assertRejected(refused, "storage_unavailable");
			assertBounded(1, 0);
			record("missing-" + method + "-refuses-write", { error: refused.error });
		}
		await arrange(null);
		const aliasRef = "posts:" + entry.slug;
		const aliasValue = { storageVersion: 1, ref: aliasRef, title: "Retained legacy slug override", description: null, updatedAt: new Date().toISOString() };
		await originals.put.call(store, aliasRef, aliasValue);
		const aliasBefore = await originals.getVersioned.call(store, aliasRef);
		resetCounts();
		const aliasAbsent = await read();
		assertSnapshot(aliasAbsent, null);
		const aliasRevisionRefused = await save(aliasBefore.revision, "Alias revision cannot authorize canonical write");
		assertRejected(aliasRevisionRefused, "conflict");
		assertBounded(2, 0);
		record("alias-revision-is-not-canonical-authority", { canonicalAbsent: true, error: aliasRevisionRefused.error });
		resetCounts();
		const canonical = await save(null, "Canonical value over alias");
		assertSnapshot(canonical, "Canonical value over alias");
		const canonicalClear = await save(canonical.snapshot.revision, "");
		assertSnapshot(canonicalClear, null);
		assert.deepEqual(await originals.getVersioned.call(store, aliasRef), aliasBefore);
		assertBounded(2, 2);
		record("canonical-create-clear-preserves-alias", { canonicalCleared: true, aliasUnchanged: true });
		resetCounts();
		const aliasPreviewResponse = await call("admin-entry-preview", { ref });
		assert.equal(aliasPreviewResponse.status, 200);
		assert.equal(aliasPreviewResponse.payload.success, true);
		const aliasPreview = aliasPreviewResponse.payload.data;
		assert.equal(aliasPreview.success, true);
		assert.equal(aliasPreview.preview.contractVersion, contractVersion);
		assert.equal(aliasPreview.preview.social.override.title, aliasValue.title);
		assert.ok(counts.get <= 2 && counts.getVersioned <= 1, "Preview has at most two raw canonical/alias reads and one correlated versioned read");
		assert.equal(writes() + counts.put + counts.delete, 0);
		record("preview-retains-legacy-alias-with-canonical-absence", { legacyTitle: aliasValue.title });
		assert.deepEqual(aliasPreview.preview.social.editing, { state: "ready", snapshot: { ref, revision: null, override: null } });
		await arrange("Old canonical value used by preview");
		previewReadRace = true;
		resetCounts();
		const racedPreviewResponse = await call("admin-entry-preview", { ref });
		assert.equal(racedPreviewResponse.status, 200);
		const racedPreview = racedPreviewResponse.payload.data.preview;
		assert.deepEqual(racedPreview.social.editing, { state: "unavailable", reason: "snapshot_changed" });
		assert.equal(racedPreview.social.override.title, "Old canonical value used by preview");
		assert.equal((await snapshot()).value.title, "New canonical value after preview read");
		assert.ok(counts.get <= 2 && counts.getVersioned <= 1);
		assert.equal(writes() + counts.put + counts.delete, 0);
		record("preview-versioned-read-correlation-refuses-raced-baseline", { editing: racedPreview.social.editing });
		const missingRef = "posts:missing-social-fixture";
		resetCounts();
		const missing = data(await call("admin-entry-social", { ref: missingRef }));
		assert.equal(missing.success, false);
		assert.equal(missing.error, "not_found");
		assert.equal(writes() + counts.put + counts.delete + counts.getVersioned, 0);
		record("missing-entry-is-not-missing-record", { error: missing.error });
		for (const route of ["admin-entry-social", "save-admin-entry-social"]) {
			const valid = route === "admin-entry-social" ? { ref } : { ref, title: "Boundary title", description: "", expectedRevision: null };
			for (const [label, body, extra, status] of [
				["unauthenticated", valid, { user: null }, 401],
				["insufficient-role", valid, { user: { ...caller, role: 10 } }, 403],
				["csrf", valid, { csrf: false }, 403],
				["method", undefined, { method: "GET" }, 405],
				["unknown-field", { ...valid, unexpected: true }, {}, 400],
				["malformed-json", "{broken", {}, 400],
				["byte-cap", { ...valid, oversized: "x".repeat(route === "admin-entry-social" ? 2048 : 16384) }, {}, 413],
			]) {
				resetCounts();
				const response = await call(route, body, extra);
				assert.equal(response.status, status, route + " " + label + ": " + JSON.stringify(response));
				if (label === "method") assert.equal(response.allow, "POST");
				assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 0);
				record(route + "-boundary-" + label, { status, storageCalls: 0 });
			}
		}
		resetCounts();
		const oldRequest = await call("save-admin-entry-social", { ref, title: "Old unguarded request", description: "" });
		assert.equal(oldRequest.status, 400);
		assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 0);
		record("old-unguarded-save-schema-refused", { status: 400 });
		for (const [field, value, error] of [["title", "x".repeat(301), "title_too_long"], ["description", "x".repeat(1001), "description_too_long"]]) {
			resetCounts();
			const invalid = data(await call("save-admin-entry-social", { ref, title: "", description: "", expectedRevision: null, [field]: value }));
			assertRejected(invalid, error);
			assertBounded(1, 0);
			record("normalized-" + field + "-limit", { error });
		}
		report.status = "passed";
	}
	assert.deepEqual(await preservationSnapshot(), preservedBefore, "Social commands preserve unrelated options, storage, content and core SEO");
	report.unrelatedStatePreserved = true;
	assert.equal(report.networkAttempts, 0);
} catch (error) {
	report.error = error instanceof Error ? error.stack?.slice(0, 8192) : String(error).slice(0, 8192);
	process.exitCode = 1;
} finally {
	try {
		if (runtime) { await runtime.shutdown(); await runtime.db.destroy(); }
	} finally {
		clearTimeout(watchdog);
		report.finishedAt = new Date().toISOString();
		writeReport();
		assert.ok(relative(dirname(receiptFile), work).startsWith("runtime-"));
		rmSync(work, { recursive: true });
	}
}
console.log(JSON.stringify({ status: report.status, artifact: report.artifact, cases: report.cases.map((item) => item.name), receipt: receiptFile, error: report.error }));
