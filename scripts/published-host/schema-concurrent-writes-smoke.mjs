// Exact-package schema commands use released runtime dispatch and disposable SQLite.
// Faults are injected at host storage boundaries, never in product handlers.
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
	assert.ok(["--archive", "--receipt", "--mode", "--target"].includes(args[i]) && args[i + 1] && !options[args[i]], "Usage: schema-concurrent-writes-smoke.mjs --archive ABSOLUTE_TGZ --receipt ABSOLUTE_JSON --mode beta17-red|green [--target native-1.3.0]");
	options[args[i]] = args[i + 1];
}
const archive = options["--archive"];
const receiptFile = options["--receipt"];
const mode = options["--mode"];
assert.ok(archive && isAbsolute(archive) && receiptFile && isAbsolute(receiptFile));
assert.ok(["beta17-red", "green"].includes(mode));
assert.equal(process.platform, "linux");
assert.equal(process.versions.node, "24.19.0");
const environment = createEnvironment(undefined, selectHostTarget(options["--target"] ?? process.env.SHIPIT_HOST_TARGET ?? "native-1.3.0"));
assert.equal(environment.target.name, "native-1.3.0");
environment.assertVersions();
const PLUGIN = "shipit-seo";
const PACKAGE = "@shipitseo/emdash-plugin-seo";
const SITE = "https://example.com";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const bytes = readFileSync(archive);
if (mode === "beta17-red") {
	assert.equal(bytes.byteLength, 803114);
	assert.equal(sha(bytes), "4d7a66cc2abaae43e0b3d22c1b4379453f0d53738d875cd770cf4a45644e10d4");
}
mkdirSync(dirname(receiptFile), { recursive: true });
const work = mkdtempSync(join(dirname(receiptFile), "runtime-"));
const report = {
	schemaVersion: 1, status: "failed", mode, target: environment.target.name, node: process.versions.node,
	host: { emdash: environment.target.versions.get("emdash"), admin: environment.target.versions.get("@emdash-cms/admin"), database: "SQLite", dependencies: "Existing pinned host graph; no install or build" },
	artifact: { file: archive, bytes: bytes.byteLength, sha256: sha(bytes) },
	fixtureSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
	evidence: "Actual extracted package, configured released EmDashRuntime and published HTTP dispatcher",
	faultBoundary: "Host context storage wrappers delegate real SQLite persistence; labelled direct fixture writes inject concurrent revisions outside counted product calls. A two-command barrier precedes actual conditional writes. No product handler is replaced.",
	networkAttempts: 0, cases: [],
};
const writeReport = () => {
	const text = JSON.stringify(report, null, 2) + "\n";
	assert.ok(Buffer.byteLength(text) <= 65536);
	writeFileSync(receiptFile, text);
};
const watchdog = setTimeout(() => {
	report.error = "Schema runtime fixture exceeded 90 seconds";
	writeReport();
	process.exit(1);
}, 90000);
const deny = () => { report.networkAttempts += 1; throw new Error("Networking is disabled in the schema concurrency fixture"); };
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
	if (mode === "beta17-red") assert.equal(manifest.version, "0.4.0-beta.17");
	const hostManifest = JSON.parse(readFileSync(new URL("package.json", environment.hostRoot), "utf8"));
	const coreManifest = JSON.parse(readFileSync(new URL("package.json", environment.hostPackageRoot("emdash")), "utf8"));
	for (const name of new Set([...Object.keys(hostManifest.dependencies), ...Object.keys(hostManifest.devDependencies), ...Object.keys(coreManifest.dependencies), ...Object.keys(manifest.peerDependencies ?? {})])) {
		const target = join(work, "node_modules", name);
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(realpathSync(fileURLToPath(environment.hostPackageRoot(name))), target);
	}
	const config = { database: { entrypoint: "emdash/db/sqlite", config: { url: join(work, "schema.sqlite") } }, siteUrl: SITE };
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

	const caller = { id: "schema-fixture-admin", email: "admin@example.test", name: "Schema fixture administrator", role: 50, emailVerified: true, avatarUrl: null, data: null, createdAt: "2026-10-16T00:00:00.000Z" };
	const call = async (route, body, extra = {}) => {
		const method = extra.method ?? "POST";
		const request = new Request(SITE + "/_emdash/api/plugins/" + PLUGIN + "/" + route, {
			method, headers: { "Content-Type": "application/json", ...(extra.csrf === false ? {} : { "X-EmDash-Request": "1" }) },
			...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
		});
		const response = await dispatch({ runtime, pluginId: PLUGIN, path: "/" + route, request, user: extra.user === undefined ? caller : extra.user });
		return { status: response.status, allow: response.headers.get("allow"), payload: await response.json() };
	};
	const data = (response) => {
		assert.equal(response.status, 200, JSON.stringify(response));
		assert.equal(response.payload.success, true, JSON.stringify(response));
		return response.payload.data;
	};
	const optionsStore = new OptionsRepository(runtime.db);
	const store = new PluginStorageRepository(runtime.db, PLUGIN, "schemas", plugin.storage.schemas.indexes);
	const PRESETS = "configuration:schema-presets:v2";
	const PREFIX = "plugin:" + PLUGIN + ":";
	const storageMethods = ["get", "getVersioned", "query", "count", "put", "delete", "compareAndSet", "compareAndDelete"];
	const kvMethods = ["get", "getVersioned", "list", "set", "delete", "compareAndSet", "compareAndDelete"];
	const counts = { schemas: Object.fromEntries(storageMethods.map((name) => [name, 0])), presets: Object.fromEntries(kvMethods.map((name) => [name, 0])) };
	const touches = { schemas: new Set(), presets: new Set() };
	const conditionalLog = [];
	const storeOriginal = Object.fromEntries(storageMethods.map((name) => [name, PluginStorageRepository.prototype[name]]));
	let readFault = null;
	let writeFault = null;
	let capabilityFault = null;
	let barrier = null;
	let beforeConditional = null;
	let afterConditional = null;
		const writes = () => counts.schemas.put + counts.schemas.delete + counts.schemas.compareAndSet + counts.schemas.compareAndDelete + counts.presets.set + counts.presets.delete + counts.presets.compareAndSet + counts.presets.compareAndDelete;
	const rawSnapshot = (id) => storeOriginal.getVersioned.call(store, id);
	const presetSnapshot = () => optionsStore.getVersioned(PREFIX + PRESETS);
	const rawRecord = (id, name = "Synthetic schema " + id) => ({ storageVersion: 1, name, scope: "global", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": SITE + "/#" + id, name }), enabled: true, createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z" });
	const seed = (id, name) => storeOriginal.put.call(store, id, rawRecord(id, name));
	const clearRows = async () => {
		const rows = await runtime.db.selectFrom("_plugin_storage").select("id").where("plugin_id", "=", PLUGIN).where("collection", "=", "schemas").execute();
		for (const row of rows) await storeOriginal.delete.call(store, row.id);
	};
	const reset = () => {
		readFault = null; writeFault = null; capabilityFault = null; barrier = null; beforeConditional = null; afterConditional = null;
		for (const group of Object.values(counts)) for (const name of Object.keys(group)) group[name] = 0;
		for (const group of Object.values(touches)) group.clear();
		conditionalLog.length = 0;
	};
	const record = (name, detail = {}) => {
		report.cases.push({ name, ...detail, calls: Object.fromEntries(Object.entries(counts).map(([owner, values]) => [owner, Object.fromEntries(Object.entries(values).filter(([, count]) => count > 0))])), targets: { schemas: [...touches.schemas], presets: [...touches.presets] } });
		writeReport();
	};
	const assertBounded = ({ reads = 1, conditional = 1, query = 1, count = 0, presets = false, target } = {}) => {
		const group = presets ? counts.presets : counts.schemas;
		assert.equal(group[presets ? "set" : "put"] + group.delete, 0, "Schema commands never fall back to unconditional writes");
		assert.equal(group.get, 0, "Revision commands never reread an unversioned editing target");
		assert.ok(group.getVersioned <= reads, "Exact reads remain bounded: " + JSON.stringify(counts));
		assert.ok(group.compareAndSet + group.compareAndDelete <= conditional, "Conditional attempts remain bounded");
		if (!presets) { assert.ok(group.query <= query, "Existing identity query remains bounded"); assert.ok(group.count <= count, "Capacity reads remain bounded"); }
		if (target) assert.ok([...(presets ? touches.presets : touches.schemas)].every((key) => key === target), "Only the exact editing target is read or written");
	};
	const PluginContextFactory = await importHostExport("PluginContextFactory");
	const originalContext = PluginContextFactory.prototype.createContext;
	PluginContextFactory.prototype.createContext = function (definition) {
		const context = originalContext.call(this, definition);
		if (definition.id !== PLUGIN) return context;
		const instrument = (port, methods, owner) => {
			for (const method of methods) {
				const original = port[method];
				if (typeof original !== "function") continue;
				port[method] = async (...values) => {
					const tracked = owner === "schemas" || values[0] === PRESETS;
					if (tracked) {
						counts[owner][method] += 1;
						if (!["query", "count", "list"].includes(method)) touches[owner].add(values[0]);
						if (method === "getVersioned" && readFault?.owner === owner) {
							if (readFault.kind === "throw") throw new Error("Controlled unavailable versioned schema read");
							return { revision: readFault.revision ?? "fixture-invalid-revision", value: { unexpected: true } };
						}
						if (["compareAndSet", "compareAndDelete"].includes(method)) {
							conditionalLog.push({ owner, method, id: values[0], expectedRevision: values[1] });
							if (beforeConditional) await beforeConditional({ owner, method, values });
							if (barrier?.owner === owner) { const active = barrier; active.entered += 1; if (active.entered === 2) active.release(); await active.promise; }
						}
					}
					const result = await original(...values);
					if (tracked && ["compareAndSet", "compareAndDelete"].includes(method) && result?.applied === true) {
						if (afterConditional) await afterConditional({ owner, method, values, result });
						if (writeFault?.owner === owner) {
							const selected = writeFault.kind; writeFault = null;
							if (selected === "malformed") return { applied: "invalid" };
							throw new Error("Controlled committed schema write with lost acknowledgement");
						}
					}
					return result;
				};
			}
		};
		instrument(context.storage.schemas, storageMethods, "schemas");
		instrument(context.kv, kvMethods, "presets");
		if (capabilityFault) (capabilityFault.owner === "schemas" ? context.storage.schemas : context.kv)[capabilityFault.method] = undefined;
		return context;
	};
	await runtime.schemaRegistry.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] });
	await optionsStore.set("plugin:other-plugin:schema-fixture-sentinel", { preserve: "Unrelated option" });
	await new PluginStorageRepository(runtime.db, "other-plugin", "schemas", []).put("schema-fixture-sentinel", { preserve: "Unrelated schema" });
	const preservationSnapshot = async () => ({
		options: await runtime.db.selectFrom("options").selectAll().where("name", "not like", PREFIX + "%").orderBy("name").execute(),
		otherStorage: await runtime.db.selectFrom("_plugin_storage").selectAll().where("plugin_id", "!=", PLUGIN).orderBy("plugin_id").orderBy("collection").orderBy("id").execute(),
		content: await runtime.db.selectFrom("ec_posts").selectAll().orderBy("id").execute(),
		coreSeo: await runtime.db.selectFrom("_emdash_seo").selectAll().orderBy("collection").orderBy("content_id").execute(),
	});
	const preservedBefore = await preservationSnapshot();
	const input = (id, expectedRevision, name = "Saved " + id) => ({ id, expectedRevision, name, scope: "global", json: rawRecord(id, name).json, enabled: true });
	const save = async (id, revision, name, route = "save-admin-custom-schema") => data(await call(route, input(id, revision, name)));
	const remove = async (id, expectedRevision, route = "delete-admin-custom-schema") => data(await call(route, { id, expectedRevision }));
	const read = async (id) => data(await call("admin-custom-schema", { id }));
	const presetsRead = async () => data(await call("admin-schema-presets", undefined, { method: "GET" }));
	const presetsSave = async (values, expectedRevision, extra = {}) => data(await call("save-admin-schema-presets", { values, expectedRevision, ...extra }));
	const presetsReset = async (expectedRevision) => data(await call("reset-admin-schema-presets", { expectedRevision }));
	const presetValues = (configuration) => Object.fromEntries(configuration.items.map((item) => [item.key, item.enabled]));
	const reject = (result, error) => { assert.equal(result.success, false, JSON.stringify(result)); assert.equal(result.error, error, JSON.stringify(result)); };
	const successfulSchema = (result, id, name) => {
		assert.equal(result.success, true, JSON.stringify(result));
		assert.equal(result.schema.id, id);
		assert.equal(result.schema.name, name);
		assert.equal(typeof result.schema.revision, "string");
		assert.ok(result.schema.revision.length > 0);
		return result.schema;
	};
	const race = async (owner, commands) => {
		let release;
		barrier = { owner, entered: 0, promise: new Promise((resolve) => { release = resolve; }), release: () => release() };
		const timeout = setTimeout(() => release(), 2000);
		try {
			const results = await Promise.all(commands.map((runCommand) => runCommand()));
			assert.equal(barrier.entered, 2, "Both requests reached the genuine conditional-write boundary");
			assert.equal(results.filter((result) => result.success).length, 1, JSON.stringify(results));
			reject(results.find((result) => !result.success), "conflict");
			return results.find((result) => result.success);
		} finally { clearTimeout(timeout); barrier = null; }
	};
	if (mode === "beta17-red") {
		const created = data(await call("save-admin-custom-schema", { name: "Original schema", scope: "global", json: rawRecord("baseline").json, enabled: true }));
		assert.equal(created.success, true);
		const id = created.schema.id;
		const loaded = await rawSnapshot(id);
		reset();
		const newer = await save(id, loaded.revision, "Newer schema");
		const stale = await save(id, loaded.revision, "Stale schema");
		assert.ok(newer.success && stale.success);
		assert.equal((await rawSnapshot(id)).value.name, "Stale schema");
		record("stale-edit-overwrites-newer-value", { defectObserved: true, sameLoadedRevision: true });
		reset();
		const beforeDelete = await rawSnapshot(id);
		const updated = await save(id, beforeDelete.revision, "Edit before stale delete");
		assert.equal(updated.success, true);
		const deleted = await remove(id, beforeDelete.revision);
		assert.equal(deleted.success, true);
		assert.equal(await rawSnapshot(id), null);
		record("stale-delete-removes-newer-edit", { defectObserved: true });
		report.status = "red-reproduced";
	} else {
		const contract = await import(pathToFileURL(join(packageRoot, manifest.exports["./admin-contract"].default)).href);
		assert.equal(contract.SEO_ADMIN_CONTRACT_VERSION, 39);
		reset();
		const absent = await read("schema-proof");
		assert.deepEqual([absent.success, absent.id, absent.state, absent.schema], [true, "schema-proof", "absent", null]);
		assertBounded({ conditional: 0, query: 0, target: "schema-proof" });
		record("exact-absent-edit-snapshot");
		reset();
		const created = successfulSchema(await save("schema-proof", null, "First schema"), "schema-proof", "First schema");
		assert.equal((await rawSnapshot("schema-proof")).revision, created.revision);
		assertBounded({ count: 2, target: "schema-proof" });
		record("stable-create-returns-own-revision");
		reset();
		const duplicate = await save("schema-proof", null, "Duplicate submission");
		reject(duplicate, "conflict");
		assert.equal((await rawSnapshot("schema-proof")).value.name, "First schema");
		assertBounded({ conditional: 0, target: "schema-proof" });
		record("duplicate-create-stable-id-conflicts");
		const loaded = await read("schema-proof");
		assert.equal(loaded.schema.revision, created.revision);
		reset();
		const edited = successfulSchema(await save("schema-proof", loaded.schema.revision, "Newer schema"), "schema-proof", "Newer schema");
		assert.notEqual(edited.revision, created.revision);
		assert.equal((await rawSnapshot("schema-proof")).value.createdAt, created.createdAt);
		assertBounded({ target: "schema-proof" });
		record("guarded-edit-preserves-created-at");
		for (const command of [() => save("schema-proof", created.revision, "Stale edit"), () => remove("schema-proof", created.revision)]) {
			reset(); reject(await command(), "conflict");
			assert.equal((await rawSnapshot("schema-proof")).revision, edited.revision);
			assertBounded({ conditional: 0, target: "schema-proof" });
			record("stale-" + (report.cases.at(-1).name === "stale-edit-rejected" ? "delete" : "edit") + "-rejected");
		}
		for (const kind of ["create", "edit", "edit-delete"]) {
			await clearRows();
			if (kind !== "create") await seed("race-schema", "Race baseline");
			const revision = (await rawSnapshot("race-schema"))?.revision ?? null;
			const clients = await Promise.all([read("race-schema"), read("race-schema")]);
			assert.ok(clients.every((client) => (client.schema?.revision ?? null) === revision));
			reset();
			const winner = await race("schemas", [() => save("race-schema", revision, "Race first"), () => kind === "edit-delete" ? remove("race-schema", revision) : save("race-schema", revision, "Race second")]);
			const durable = await rawSnapshot("race-schema");
			assert.equal(durable?.revision ?? null, winner.schema?.revision ?? null);
			assertBounded({ reads: 2, conditional: 2, query: 2, count: kind === "create" ? 4 : 0, target: "race-schema" });
			record("actual-native-cas-" + kind + "-race", { loadedSameRevision: true, successful: 1, conflicted: 1 });
		}
		await clearRows();
		await seed("aba-schema", "Same original value");
		const abaFirst = await rawSnapshot("aba-schema");
		await seed("aba-schema", "Intermediate value");
		await storeOriginal.put.call(store, "aba-schema", abaFirst.value);
		const abaLast = await rawSnapshot("aba-schema");
		assert.notEqual(abaFirst.revision, abaLast.revision);
		reset(); reject(await save("aba-schema", abaFirst.revision, "Same original value"), "conflict");
		assert.equal((await rawSnapshot("aba-schema")).revision, abaLast.revision);
		assertBounded({ conditional: 0, target: "aba-schema" });
		record("equal-values-do-not-authorize-stale-revision");
		for (const kind of ["throw", "malformed"]) {
			for (const deleting of [false, true]) {
				await seed("lost-schema", "Lost acknowledgement baseline");
				const baseline = await rawSnapshot("lost-schema");
				reset(); writeFault = { owner: "schemas", kind };
				const result = deleting ? await remove("lost-schema", baseline.revision) : await save("lost-schema", baseline.revision, "Committed uncertain schema");
				reject(result, "unconfirmed");
				assert.equal((await rawSnapshot("lost-schema"))?.value.name ?? null, deleting ? null : "Committed uncertain schema");
				assertBounded({ reads: 2, target: "lost-schema" });
				record("schema-" + (deleting ? "delete" : "save") + "-" + kind + "-stays-unconfirmed", { durableEffectExists: true });
				reset(); const current = await read("lost-schema");
				assert.equal(current.success, true); assert.equal(current.state, deleting ? "absent" : "saved");
				assertBounded({ conditional: 0, query: 0, target: "lost-schema" });
				record("schema-" + kind + "-explicit-read-only-review", { currentValuesDoNotAttributeHistoricalCommit: true });
			}
		}
		for (const kind of ["throw", "invalid"]) {
			await seed("read-fault", "Read fault baseline");
			const baseline = await rawSnapshot("read-fault");
			reset(); readFault = { owner: "schemas", kind, revision: baseline.revision };
			const inspected = await read("read-fault");
			assert.equal(inspected.success, kind !== "throw");
			assert.equal(inspected.state ?? inspected.error, kind === "throw" ? "unavailable" : "invalid");
			const refused = await save("read-fault", baseline.revision, "Must preserve unreadable record");
			assert.equal(refused.success, false); assert.ok(["unavailable", "invalid_record"].includes(refused.error));
			assert.equal((await rawSnapshot("read-fault")).revision, baseline.revision);
			assertBounded({ reads: 2, conditional: 0, target: "read-fault" });
			record("unreadable-schema-" + kind + "-refuses-write");
		}
		reset();
		await storeOriginal.put.call(store, "invalid-delete", { unexpected: true });
		const invalidDeleteRead = await read("invalid-delete");
		assert.equal(invalidDeleteRead.state, "invalid");
		await storeOriginal.put.call(store, "invalid-delete", { unexpected: "A newer invalid version" });
		const newerInvalid = await rawSnapshot("invalid-delete");
		reset();
		reject(await remove("invalid-delete", invalidDeleteRead.revision), "conflict");
		assert.deepEqual(await rawSnapshot("invalid-delete"), newerInvalid);
		assertBounded({ conditional: 0, query: 0, target: "invalid-delete" });
		record("stale-invalid-delete-preserves-newer-row");
		reset();
		const invalidDeleted = await remove("invalid-delete", newerInvalid.revision);
		assert.equal(invalidDeleted.success, true, JSON.stringify(invalidDeleted));
		assert.equal(await rawSnapshot("invalid-delete"), null);
		assertBounded({ query: 0, target: "invalid-delete" });
		record("exact-invalid-row-can-be-deleted-conditionally");
		reset();
		await clearRows();
		for (let index = 0; index < 4; index += 1) await seed("listed-" + index);
		const listing = data(await call("schemas", { limit: 100 }));
		assert.equal(listing.items.length, 4);
		assert.equal(counts.schemas.query, 1);
		assert.equal(counts.schemas.getVersioned, 0);
		assert.equal(writes(), 0);
		record("list-does-not-fan-out-versioned-reads");
		await clearRows();
		reset();
		const inherited = await presetsRead();
		assert.equal(inherited.record, "absent"); assert.equal(inherited.revision, null); assert.equal(inherited.writable, true);
		const values = presetValues(inherited); values.blogPosting = !values.blogPosting;
		assertBounded({ presets: true, conditional: 0, target: PRESETS });
		record("preset-inherited-versioned-snapshot");
		reset();
		const savedPresets = await presetsSave(values, null);
		assert.equal(savedPresets.success, true, JSON.stringify(savedPresets));
		const savedConfig = savedPresets.presets;
		assert.equal(savedConfig.record, "valid"); assert.equal(savedConfig.revision, (await presetSnapshot()).revision);
		assertBounded({ presets: true, target: PRESETS });
		record("preset-conditional-create");
		reset();
		reject(await presetsSave(values, null), "conflict");
		reject(await presetsReset(savedConfig.revision + "-stale"), "conflict");
		assertBounded({ presets: true, reads: 2, conditional: 0, target: PRESETS });
		record("preset-stale-create-reset-preserve-newer-state");
		reset();
		const resetPresets = await presetsReset(savedConfig.revision);
		assert.equal(resetPresets.success, true, JSON.stringify(resetPresets));
		assert.equal(await presetSnapshot(), null);
		assertBounded({ presets: true, target: PRESETS });
		record("preset-conditional-reset");
		const recreated = await presetsSave(values, null);
		const recRevision = recreated.presets.revision;
		assert.notEqual(recRevision, savedConfig.revision);
		reset(); reject(await presetsReset(savedConfig.revision), "conflict");
		assert.equal((await presetSnapshot()).revision, recRevision);
		assertBounded({ presets: true, conditional: 0, target: PRESETS });
		record("preset-reset-recreate-rejects-old-revision");
		for (const kind of ["save", "save-reset"]) {
			const baseline = await presetSnapshot();
			const first = { ...baseline.value.values, blogPosting: !baseline.value.values.blogPosting };
			const second = { ...baseline.value.values, breadcrumbList: !baseline.value.values.breadcrumbList };
			reset();
			await race("presets", [() => presetsSave(first, baseline.revision), () => kind === "save-reset" ? presetsReset(baseline.revision) : presetsSave(second, baseline.revision)]);
			assertBounded({ presets: true, reads: 2, conditional: 2, target: PRESETS });
			record("actual-native-preset-" + kind + "-race", { successful: 1, conflicted: 1 });
			if (!(await presetSnapshot())) await optionsStore.set(PREFIX + PRESETS, { version: 2, updatedAt: "2026-10-16T00:00:00.000Z", values });
		}
		for (const kind of ["throw", "malformed"]) {
			const baseline = await presetSnapshot();
			reset(); writeFault = { owner: "presets", kind };
			reject(await presetsSave({ ...baseline.value.values, blogPosting: !baseline.value.values.blogPosting }, baseline.revision), "unconfirmed");
			assert.notEqual((await presetSnapshot()).revision, baseline.revision);
			assertBounded({ presets: true, reads: 2, target: PRESETS });
			record("preset-" + kind + "-stays-unconfirmed");
		}
		await optionsStore.set(PREFIX + PRESETS, { version: 2, values: { unexpected: true } });
		reset();
		const corrupt = await presetsRead();
		assert.equal(corrupt.record, "invalid"); assert.equal(typeof corrupt.revision, "string");
		reject(await presetsSave(values, corrupt.revision), "invalid_record");
		assertBounded({ presets: true, reads: 2, conditional: 0, target: PRESETS });
		record("invalid-preset-not-treated-as-absent");
		reset();
		const repaired = await presetsSave(values, corrupt.revision, { replaceInvalid: true });
		assert.equal(repaired.success, true, JSON.stringify(repaired));
		assertBounded({ presets: true, target: PRESETS });
		record("invalid-preset-replacement-requires-reviewed-revision");
		for (const owner of ["schemas", "presets"]) for (const method of ["getVersioned", "compareAndSet", "compareAndDelete"]) {
			reset(); capabilityFault = { owner, method };
			const result = owner === "schemas" ? await save("missing-capability", null, "Must not write") : await presetsSave(values, (await presetSnapshot()).revision);
			reject(result, "unavailable"); assert.equal(writes(), 0);
			record(owner + "-missing-" + method + "-refuses-write");
		}
		reset();
		const composerBase = contract.defaultSeoSchemaComposerInput("howTo");
		const composedInput = { ...composerBase, id: "guided-schema", expectedRevision: null, schemaName: "Guided schema", scope: "posts", enabled: true, values: { ...composerBase.values, steps: "Plan | Choose the page outcome\nReview | Confirm the saved result" } };
		await clearRows();
		reset();
		const guided = data(await call("compose-admin-schema", composedInput));
		const guidedSchema = successfulSchema(guided, "guided-schema", "Guided schema");
		assert.equal(guided.recipe, "howTo");
		assertBounded({ count: 2, target: "guided-schema" });
		record("guided-create-shares-stable-id-and-revision-guards");
		reset(); reject(data(await call("compose-admin-schema", composedInput)), "conflict");
		assertBounded({ conditional: 0, target: "guided-schema" });
		record("guided-duplicate-create-refuses-overwrite");
		const rawGuided = await save("guided-schema", guidedSchema.revision, "Raw edit after guided create");
		assert.equal(rawGuided.success, true);
		reset();
		reject(data(await call("compose-admin-schema", { ...composedInput, expectedRevision: guidedSchema.revision, schemaName: "Stale guided edit" })), "conflict");
		assertBounded({ conditional: 0, target: "guided-schema" });
		record("guided-stale-edit-preserves-newer-raw-edit");
		await clearRows();
		const ownedTarget = { collection: "posts", entryId: "synthetic-entry-id", locale: "en" };
		await storeOriginal.put.call(store, "entry-owned-schema", { ...rawRecord("entry-owned-schema", "Entry-owned schema"), scope: "posts:synthetic-entry-id", target: ownedTarget });
		const targetBefore = await rawSnapshot("entry-owned-schema");
		reset();
		const moved = data(await call("save-admin-custom-schema", { ...input("entry-owned-schema", targetBefore.revision, "Must retain entry target"), scope: "global" }));
		assert.equal(moved.success, false);
		assert.equal(writes(), 0);
		assert.deepEqual(await rawSnapshot("entry-owned-schema"), targetBefore);
		record("entry-owned-schema-cannot-move-to-broader-scope");
		reset();
		const targetEdited = data(await call("save-admin-custom-schema", { ...input("entry-owned-schema", targetBefore.revision, "Entry-owned edited"), scope: targetBefore.value.scope }));
		assert.equal(targetEdited.success, true, JSON.stringify(targetEdited));
		assert.deepEqual((await rawSnapshot("entry-owned-schema")).value.target, ownedTarget);
		assert.equal((await rawSnapshot("entry-owned-schema")).value.createdAt, targetBefore.value.createdAt);
		record("entry-owned-schema-retains-exact-target-and-created-at");
		for (const kind of ["own-revision", "equal-newer-revision"]) {
			reset(); await clearRows();
			for (let index = 0; index < 499; index += 1) await seed("capacity-" + index);
			let competed = false;
			let newerRevision = null;
			afterConditional = async ({ owner, method, values: command }) => {
				if (owner !== "schemas" || method !== "compareAndSet" || command[0] !== "capacity-created" || competed) return;
				competed = true;
				await seed("capacity-concurrent-row");
				if (kind === "equal-newer-revision") {
					const current = await rawSnapshot("capacity-created");
					await storeOriginal.put.call(store, "capacity-created", current.value);
					newerRevision = (await rawSnapshot("capacity-created")).revision;
				}
			};
			const capacity = await save("capacity-created", null, "Capacity guarded create");
			assert.equal(competed, true);
			assert.equal(capacity.success, false, JSON.stringify(capacity));
			assert.equal(counts.schemas.put + counts.schemas.delete, 0);
			assert.equal(counts.schemas.compareAndSet, 1);
			assert.ok(counts.schemas.compareAndDelete <= 1);
			if (kind === "own-revision") { assert.equal(await rawSnapshot("capacity-created"), null); assert.equal(await storeOriginal.count.call(store), 500); }
			else { assert.equal((await rawSnapshot("capacity-created")).revision, newerRevision); assert.equal(await storeOriginal.count.call(store), 501); }
			record("capacity-cleanup-" + kind, { rejected: true, exactOwnRevisionOnly: true, competingRowPreserved: Boolean(await rawSnapshot("capacity-concurrent-row")), outcomeError: capacity.error });
		}
		reset(); await clearRows();
		const rawValid = input("boundary-schema", null, "Boundary schema");
		const boundaryRoutes = [
			["admin-custom-schema", { id: "boundary-schema" }],
			["save-admin-custom-schema", rawValid],
			["compose-admin-schema", composedInput],
			["delete-admin-custom-schema", { id: "boundary-schema", expectedRevision: "stale" }],
			["save-schema", rawValid],
			["delete-schema", { id: "boundary-schema", expectedRevision: "stale" }],
			["save-admin-schema-presets", { values, expectedRevision: null }],
			["reset-admin-schema-presets", { expectedRevision: "stale" }],
		];
		for (const [route, body] of boundaryRoutes) {
			for (const [label, payload, extra, status] of [["unauthenticated", body, { user: null }, 401], ["role", body, { user: { ...caller, role: 10 } }, 403], ["csrf", body, { csrf: false }, 403], ["method", undefined, { method: "GET" }, 405], ["unknown-field", { ...body, unexpected: true }, {}, 400], ["malformed-json", "{broken", {}, 400]]) {
				reset(); const result = await call(route, payload, extra);
				assert.equal(result.status, status, route + " " + label + " " + JSON.stringify(result));
				assert.equal(writes(), 0); assert.equal(counts.schemas.getVersioned + counts.presets.getVersioned, 0);
				record(route + "-denies-" + label, { status });
			}
		}
		for (const [route, body] of boundaryRoutes.filter(([route]) => !route.startsWith("admin-"))) {
			const old = { ...body }; delete old.expectedRevision;
			reset(); const result = await call(route, old);
			assert.equal(result.status, 400, route + " " + JSON.stringify(result)); assert.equal(writes(), 0);
			record(route + "-old-client-without-revision-refused", { status: 400 });
		}
		await clearRows();
		reset();
		const aliasCreated = await save("alias-schema", null, "Alias create", "save-schema");
		assert.equal(aliasCreated.success, true, JSON.stringify(aliasCreated));
		const aliasSnapshot = await rawSnapshot("alias-schema");
		const aliasEdited = await save("alias-schema", aliasSnapshot.revision, "Alias edited");
		assert.equal(aliasEdited.success, true);
		reject(await remove("alias-schema", aliasSnapshot.revision, "delete-schema"), "conflict");
		const aliasDeleted = await remove("alias-schema", (await rawSnapshot("alias-schema")).revision, "delete-schema");
		assert.equal(aliasDeleted.success, true); assert.equal(await rawSnapshot("alias-schema"), null);
		record("legacy-aliases-use-same-revision-guards");
		const rawWriteMaxBytes = 100_000 * 6 + 8192;
		for (const [route, id] of [["save-admin-custom-schema", "large-unicode-main"], ["save-schema", "large-unicode-alias"]]) {
			const json = JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": SITE + "/#" + id, description: "界".repeat(90_000) });
			const command = { ...input(id, null, "Large Unicode schema"), json };
			const wireBytes = Buffer.byteLength(JSON.stringify(command));
			assert.ok(json.length < 100_000 && wireBytes > 262144 && wireBytes <= rawWriteMaxBytes);
			reset();
			const large = successfulSchema(data(await call(route, command)), id, "Large Unicode schema");
			assert.equal(large.json, json);
			assert.equal((await rawSnapshot(id)).value.json, json);
			assertBounded({ count: 2, target: id });
			record(route + "-preserves-large-unicode-json-domain", { jsonCharacters: json.length, requestBytes: wireBytes });
			const oversized = JSON.stringify(input(id + "-over-cap", null, "Over byte cap")) + " ".repeat(rawWriteMaxBytes + 1);
			reset();
			const overCap = await call(route, oversized);
			assert.equal(overCap.status, 413, JSON.stringify(overCap));
			assert.equal(Object.values(counts).flatMap((group) => Object.values(group)).reduce((sum, count) => sum + count, 0), 0);
			record(route + "-oversize-wire-refused-before-storage", { status: overCap.status, requestBytes: Buffer.byteLength(oversized), storageCalls: 0 });
			const shell = JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", description: "" });
			const domainOverflow = JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", description: "x".repeat(100_001 - shell.length) });
			assert.equal(domainOverflow.length, 100_001);
			reset();
			const tooLong = await call(route, { ...input(id + "-over-domain", null, "Over character limit"), json: domainOverflow });
			assert.equal(tooLong.status, 400, JSON.stringify(tooLong));
			assert.equal(writes(), 0);
			record(route + "-preserves-100000-character-limit", { status: tooLong.status, jsonCharacters: domainOverflow.length, writes: 0 });
		}
		const cjk = "界";
		const largeLines = Array.from({ length: 40 }, () => cjk.repeat(499)).join("\n");
		const urlPrefix = "https://example.com/";
		const largeUrl = urlPrefix + cjk.repeat(2048 - urlPrefix.length);
		const largeComposer = { id: "large-composer-wire", expectedRevision: null, recipe: "howTo", schemaName: "Large guided schema", scope: "posts", enabled: false,
			values: { name: cjk.repeat(2048), description: cjk.repeat(20_000), url: largeUrl, image: largeUrl, steps: largeLines, tools: largeLines, supplies: largeLines,
				totalTime: "P" + "0".repeat(2046) + "D", estimatedCost: "0".repeat(2048), currency: "EUR" } };
		const largeComposed = contract.composeSeoSchema(largeComposer);
		assert.equal(largeComposed.success, true, JSON.stringify(largeComposed));
		const composerWireBytes = Buffer.byteLength(JSON.stringify(largeComposer));
		assert.ok(largeComposed.output.json.length < 100_000 && composerWireBytes > 262144 && composerWireBytes <= rawWriteMaxBytes);
		reset();
		const savedLargeComposer = successfulSchema(data(await call("compose-admin-schema", largeComposer)), largeComposer.id, largeComposer.schemaName);
		assert.equal(savedLargeComposer.json, largeComposed.output.json);
		assert.equal((await rawSnapshot(largeComposer.id)).value.json, largeComposed.output.json);
		assertBounded({ count: 2, target: largeComposer.id });
		record("composer-preserves-valid-large-guided-domain", { jsonCharacters: largeComposed.output.json.length, requestBytes: composerWireBytes });
		reset();
		const composerOverCap = await call("compose-admin-schema", { ...composedInput, values: { ...composedInput.values, description: "x".repeat(rawWriteMaxBytes) } });
		assert.equal(composerOverCap.status, 413, JSON.stringify(composerOverCap));
		assert.equal(Object.values(counts).flatMap((group) => Object.values(group)).reduce((sum, count) => sum + count, 0), 0);
		record("composer-oversize-wire-refused-before-storage", { status: 413, storageCalls: 0 });
		// Import scenarios mutate only this disposable database. Direct writes
		// below are labelled competing writers, not product persistence fallbacks.
		for (const kind of ["schema-race", "schema-owned-rollback", "schema-equal-newer-rollback", "preset-race", "preset-equal-newer-rollback", "schema-lost-ack", "preset-lost-ack"]) {
			reset(); await clearRows();
			await seed("import-a", "Import A baseline"); await seed("import-b", "Import B baseline");
			const exported = data(await call("admin-portability-export", {}));
			const bundle = structuredClone(exported.bundle);
			const schemas = bundle.configuration.customSchemas;
			assert.ok(Array.isArray(schemas), "Export custom-schema path is available");
			for (const schema of schemas) if (schema.id.startsWith("import-")) { schema.name += " changed"; schema.json = rawRecord(schema.id, schema.name).json; }
			bundle.configuration.schemaPresets.blogPosting = !bundle.configuration.schemaPresets.blogPosting;
			const preview = data(await call("admin-portability-preview", { bundle, mode: "merge" }));
			assert.equal(preview.success, true, JSON.stringify(preview));
			let injected = false;
			let equalLaterRevision = null;
			const originalA = await rawSnapshot("import-a");
			const originalB = await rawSnapshot("import-b");
			const originalPreset = await presetSnapshot();
			reset();
			if (kind.endsWith("lost-ack")) writeFault = { owner: kind.startsWith("schema") ? "schemas" : "presets", kind: "throw" };
			beforeConditional = async ({ owner, method, values: command }) => {
				if (injected || method !== "compareAndSet") return;
				if (kind === "schema-lost-ack" && owner === "schemas" && command[0] === "import-a" || kind === "preset-lost-ack" && owner === "presets" && command[0] === PRESETS) { injected = true; return; }
				if (kind === "schema-race" && owner === "schemas" && command[0] === "import-a") {
					injected = true; await seed("import-a", "Concurrent schema before import CAS");
				} else if (kind === "preset-race" && owner === "presets" && command[0] === PRESETS) {
					injected = true; await optionsStore.set(PREFIX + PRESETS, { ...originalPreset.value, updatedAt: "2026-10-16T09:00:00.000Z" });
				} else if (["schema-owned-rollback", "schema-equal-newer-rollback", "preset-equal-newer-rollback"].includes(kind) && owner === "schemas" && command[0] === "import-b") {
					injected = true;
					if (kind === "schema-equal-newer-rollback") { const current = await rawSnapshot("import-a"); await storeOriginal.put.call(store, "import-a", current.value); equalLaterRevision = (await rawSnapshot("import-a")).revision; }
					if (kind === "preset-equal-newer-rollback") { const current = await presetSnapshot(); await optionsStore.set(PREFIX + PRESETS, current.value); equalLaterRevision = (await presetSnapshot()).revision; }
					await storeOriginal.put.call(store, "import-b", originalB.value);
				}
			};
			const imported = data(await call("admin-portability-apply", { bundle, mode: "merge", confirmation: "IMPORT_SEO_CONFIGURATION", planFingerprint: preview.plan.fingerprint }));
			assert.equal(injected, true, "Import reached the selected real conditional-write boundary: " + JSON.stringify(imported));
			assert.equal(imported.success, false, JSON.stringify(imported));
			assert.equal(counts.schemas.put + counts.schemas.delete + counts.presets.set + counts.presets.delete, 0, "Import schema and preset writes have no unconditional fallback");
			if (kind === "schema-race") assert.equal((await rawSnapshot("import-a")).value.name, "Concurrent schema before import CAS");
			if (kind === "preset-race") assert.notEqual((await presetSnapshot()).revision, originalPreset.revision);
			if (kind === "schema-owned-rollback") { assert.deepEqual((await rawSnapshot("import-a")).value, originalA.value); assert.equal(imported.rollbackPerformed, true); }
			if (kind === "schema-equal-newer-rollback") { assert.equal((await rawSnapshot("import-a")).revision, equalLaterRevision); assert.equal(imported.error, "rollback_conflict"); }
			if (kind === "preset-equal-newer-rollback") { assert.equal((await presetSnapshot()).revision, equalLaterRevision); assert.equal(imported.error, "rollback_conflict"); }
			if (kind.endsWith("lost-ack")) {
				const owner = kind.startsWith("schema") ? "schemas" : "presets";
				const id = owner === "schemas" ? "import-a" : PRESETS;
				assert.equal(conditionalLog.filter((command) => command.owner === owner && command.id === id).length, 1, "An unacknowledged write never gains a rollback token from current values");
				assert.notEqual((owner === "schemas" ? await rawSnapshot(id) : await presetSnapshot()).revision, owner === "schemas" ? originalA.revision : originalPreset.revision);
				assert.equal(imported.rollbackPerformed, false);
			}
			assert.deepEqual((await rawSnapshot("import-b")).value, originalB.value);
			record("actual-native-import-" + kind, { error: imported.error, rollbackPerformed: imported.rollbackPerformed, concurrentRevisionPreserved: kind.includes("equal") || kind.endsWith("race") });
		}
		reset();
		report.status = "passed";
	}
	assert.deepEqual(await preservationSnapshot(), preservedBefore, "Schema commands preserve other plugins, core options, content and core SEO");
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
