// First boot and reboot use the released runtime with its configured SQLite
// factory. The harness supplies Astro's virtual config and production DEV flag;
// it never injects a database or replaces the runtime's lifecycle ownership gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createSeoEngine } = await source("sandbox-entry.ts");
const {
	MODULES_SETTINGS_KEY, SCHEMA_PRESETS_SETTINGS_KEY, LEGACY_SCHEMA_PRESETS_SETTINGS_KEY,
	SEO_MODULES, readAdminModules, readAdminSchemaPresets,
} = await source("entry-analysis-runtime.ts");
const {
	SEO_ADMIN_MODULES_STORAGE_VERSION, SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	SEO_ADMIN_INDEXNOW_STORAGE_VERSION, SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS, seoModuleCanRun,
} = await source("admin-contract.ts");
const { INDEXNOW_SETTINGS_STORAGE_KEY, readIndexNowSettings } = await source("indexnow-runtime.ts");
const { defaultIndexNowSettings } = await source("indexnow.ts");
const pluginId = "shipit-seo";
const prefix = `plugin:${pluginId}:`;
const timestamp = "2026-09-30T12:00:00.000Z";
const values = (definitions, value) => Object.fromEntries(definitions.map(({ key }) => [key, value]));
const disabledModules = values(SEO_MODULES, false);
const disabledPresets = values(SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS, false);
const savedIndexNow = {
	version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION, updatedAt: timestamp,
	values: { ...defaultIndexNowSettings(), enabled: true, autoSubmit: true,
		autoSubmitContentTypes: null, apiKey: "preserved-indexnow-key" },
};
const cases = [
	{ name: "missing", records: [], configuredUrl: "https://configured.example", expectedUrl: "https://configured.example" },
	{ name: "existing", records: [
		[MODULES_SETTINGS_KEY, { version: SEO_ADMIN_MODULES_STORAGE_VERSION, updatedAt: timestamp, values: disabledModules }],
		[SCHEMA_PRESETS_SETTINGS_KEY, { version: SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION, updatedAt: timestamp, values: disabledPresets }],
		[INDEXNOW_SETTINGS_STORAGE_KEY, savedIndexNow],
		["settings:global:v1", { version: 1, updatedAt: timestamp, values: { noindex: true, contentScoringEnabled: false } }],
	], expectDisabled: true, expectedUrl: "https://saved.example" },
	{ name: "invalid", records: [
		[MODULES_SETTINGS_KEY, { version: 1, updatedAt: timestamp, values: "invalid" }],
		[SCHEMA_PRESETS_SETTINGS_KEY, null], [INDEXNOW_SETTINGS_STORAGE_KEY, { version: 1, values: "invalid" }],
	], savedUrl: "http://public.example", expectedUrl: "https://setup.example" },
	{ name: "legacy-keys", records: [
		...SEO_MODULES.map(({ key }) => [`module:${key}`, false]),
		...SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map(({ key }) => [`preset:${key}`, false]),
	], expectDisabled: true, legacy: true, expectedUrl: "https://saved.example" },
	{ name: "legacy-presets", records: [
		...SEO_MODULES.map(({ key }) => [`module:${key}`, false]),
		[LEGACY_SCHEMA_PRESETS_SETTINGS_KEY, { version: 1, updatedAt: timestamp, values: disabledPresets }],
	], expectDisabled: true, legacy: true, expectedUrl: "https://saved.example" },
	{ name: "conditional-winner", records: [], conflict: true, expectedUrl: "https://saved.example" },
	{ name: "unreadable-json", records: [], unreadable: true, expectedUrl: "https://saved.example" },
];
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests += 1; throw new Error("External networking is disabled in this smoke check"); };

async function pureInstallChecks() {
	const install = createSeoEngine().hooks["plugin:install"].handler;
	for (const fixture of cases) {
		const records = new Map(structuredClone(fixture.records));
		if (fixture.conflict) records.set(INDEXNOW_SETTINGS_STORAGE_KEY, structuredClone(savedIndexNow));
		const before = structuredClone([...records]);
		const unexpected = () => { throw new Error(`Install touched storage in ${fixture.name}`); };
		const ctx = {
			kv: new Proxy({}, { get: unexpected }), storage: new Proxy({}, { get: unexpected }),
			cron: new Proxy({}, { get: unexpected }), http: new Proxy({}, { get: unexpected }),
			log: { info() {} },
		};
		await install({}, ctx);
		await install({}, ctx);
		assert.deepEqual([...records], before, `${fixture.name}: repeated installation preserves every value`);
		ctx.kv = { async get(key) { return records.get(key) ?? null; } };
		if (fixture.name === "missing") {
			assert.deepEqual((await readAdminModules(ctx)).values,
				Object.fromEntries(SEO_MODULES.map(({ key, defaultEnabled }) => [key, seoModuleCanRun(key) && defaultEnabled])));
			assert.deepEqual((await readAdminSchemaPresets(ctx)).values,
				Object.fromEntries(SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map(({ key, defaultEnabled }) => [key, defaultEnabled])));
			assert.deepEqual((await readIndexNowSettings(ctx)).values, defaultIndexNowSettings());
			assert.equal(records.size, 0, "reader defaults require no seeded records");
		} else if (fixture.expectDisabled) {
			assert.deepEqual((await readAdminModules(ctx)).values, disabledModules);
			const presets = await readAdminSchemaPresets(ctx);
			assert.deepEqual(presets.values, disabledPresets);
			assert.equal(presets.migrationNeeded, Boolean(fixture.legacy));
		}
		if (fixture.name === "existing" || fixture.conflict)
			assert.deepEqual((await readIndexNowSettings(ctx)).values, savedIndexNow.values);
		assert.deepEqual([...records], before, `${fixture.name}: readers leave storage untouched`);
	}
	assert.equal(networkRequests, 0);
	return cases.map(({ name }) => name);
}

async function hostDistExport(name) {
	const dist = new URL("dist/", hostPackageRoot("emdash"));
	for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const url = new URL(file, dist);
		const contents = readFileSync(url, "utf8");
		const alias = contents.match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return { url, contents, alias };
	}
	throw new Error(`Published ${name} was not found`);
}
const optionRows = async (db) => (await db.selectFrom("options").selectAll()
	.where("name", "like", `${prefix}%`).orderBy("name").execute()).map((row) => ({ ...row }));

async function bootConfiguredDatabase(file, fixture) {
	const config = {
		database: { entrypoint: "emdash/db/sqlite", config: { url: file } },
		...(fixture.configuredUrl ? { siteUrl: fixture.configuredUrl } : {}),
	};
	const runtimeExport = await hostDistExport("EmDashRuntime");
	assert.equal((runtimeExport.contents.match(/import\.meta\.env\.DEV/g) ?? []).length, 1,
		"the harness replaces only the released runtime's Astro production flag");
	const virtualConfig = `data:text/javascript,${encodeURIComponent(`export default ${JSON.stringify(config)};`)}`;
	// Harness-only Astro inputs; the configured DB and lifecycle code run intact.
	registerHooks({
		resolve(specifier, context, nextResolve) {
			return nextResolve(specifier === "virtual:emdash/config" ? virtualConfig : specifier, context);
		},
		load(url, context, nextLoad) {
			const loaded = nextLoad(url, context);
			if (url !== runtimeExport.url.href) return loaded;
			return { ...loaded, source: runtimeExport.contents.replace("import.meta.env.DEV", "false") };
		},
	});
	const EmDashRuntime = (await import(runtimeExport.url.href))[runtimeExport.alias];
	const { createDialect } = await import("emdash/db/sqlite");
	const { getRequestContext } = await import("emdash/request-context");
	const { createPlugin } = await source("native-entry.ts");
	assert.equal(getRequestContext(), undefined, "configured boot has no injected request database");
	const plugin = createPlugin();
	const install = plugin.hooks["plugin:install"];
	const events = [];
	plugin.hooks["plugin:install"] = { ...install, handler: async (event, ctx) => {
		events.push("install");
		assert.equal(ctx.site.url, fixture.expectedUrl);
		await install.handler(event, ctx);
	} };
	plugin.hooks["plugin:activate"] = { ...install, handler: async (_event, ctx) => {
		events.push("activate");
		assert.equal(ctx.site.url, fixture.expectedUrl);
	} };
	let runtime;
	try {
		runtime = await EmDashRuntime.create({
			config, plugins: [plugin], createDialect, sandboxEnabled: false, sandboxBypassed: false,
			sandboxedPluginEntries: [], mediaProviderEntries: [], migrationMode: "auto",
		});
		assert.equal(runtime.isPluginEnabled(pluginId), true, `${fixture.name}: plugin remains active`);
		const state = await runtime.db.selectFrom("_plugin_state").selectAll().where("plugin_id", "=", pluginId).executeTakeFirstOrThrow();
		assert.equal(state.status, "active");
		assert.equal(state.source, "config");
		assert.equal(runtime.pipelineFactoryOptions.siteInfo.siteUrl, fixture.expectedUrl);
		assert.equal(networkRequests, 0);
		return { events, state, rows: await optionRows(runtime.db), siteUrl: fixture.expectedUrl };
	} finally {
		if (runtime) { await runtime.shutdown(); await runtime.db.destroy(); }
	}
}

if (process.argv[2] === "--boot") {
	assert.ok(["native-1.2.0", "native-1.3.0"].includes(target.name));
	const result = await bootConfiguredDatabase(process.argv[3], JSON.parse(process.argv[4]));
	console.log(`LIFECYCLE_RESULT ${JSON.stringify(result)}`);
} else {
	assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--pure"));
	const pure = await pureInstallChecks();
	if (process.argv[2] === "--pure") {
		console.log(JSON.stringify({ target: target.name, pure, networkRequests }, null, 2));
	} else {
		assert.ok(["native-1.2.0", "native-1.3.0"].includes(target.name), "configured native lifecycle proof requires a supported full native target");
		const { Kysely } = await import("kysely");
		const { createDialect } = await import("emdash/db/sqlite");
		const { runMigrations } = await import("emdash/db");
		const { OptionsRepository } = await import("emdash");
		const directory = mkdtempSync(join(tmpdir(), "seo-install-lifecycle-"));
		const boots = [];
		const boot = (file, fixture) => {
			const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--boot", file, JSON.stringify(fixture)], {
				env: { ...process.env, EMDASH_SITE_URL: "", SITE_URL: "" }, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024,
			});
			assert.equal(child.error, undefined, child.error?.message);
			assert.equal(child.status, 0, `${fixture.name}: ${child.stderr}\n${child.stdout}`);
			const output = child.stdout.split("\n").find((line) => line.startsWith("LIFECYCLE_RESULT "));
			assert.ok(output, "configured runtime child reports its lifecycle outcome");
			return JSON.parse(output.slice("LIFECYCLE_RESULT ".length));
		};
		try {
			for (const fixture of cases) {
				const file = join(directory, `${fixture.name}.sqlite`);
				const db = new Kysely({ dialect: createDialect({ url: file }) });
				let before;
				try {
					await runMigrations(db);
					const options = new OptionsRepository(db);
					await options.set("emdash:setup_complete", true);
					await options.set("emdash:seed_complete", true);
					await options.set("site:url", fixture.savedUrl ?? "https://saved.example/path");
					await options.set("emdash:site_url", "https://setup.example");
					for (const [key, value] of fixture.records) await options.set(`${prefix}${key}`, value);
					if (fixture.conflict) {
						const key = `${prefix}${INDEXNOW_SETTINGS_STORAGE_KEY}`;
						const winner = await options.compareAndSet(key, null, savedIndexNow);
						assert.equal(winner.applied, true);
						assert.deepEqual(await options.compareAndSet(key, null, { ...savedIndexNow, values: defaultIndexNowSettings() }), { applied: false });
						assert.deepEqual((await options.getVersioned(key)).value, savedIndexNow);
					}
					if (fixture.unreadable) {
						await options.set(`${prefix}${INDEXNOW_SETTINGS_STORAGE_KEY}`, null);
						await db.updateTable("options").set({ value: "{unreadable JSON" }).where("name", "=", `${prefix}${INDEXNOW_SETTINGS_STORAGE_KEY}`).execute();
					}
					assert.equal(await db.selectFrom("_plugin_state").select("plugin_id").where("plugin_id", "=", pluginId).executeTakeFirst(), undefined);
					before = await optionRows(db);
				} finally { await db.destroy(); }
				const first = boot(file, fixture);
				assert.deepEqual(first.events, ["install", "activate"], `${fixture.name}: genuine first boot owns install and activate`);
				assert.deepEqual(first.rows, before, `${fixture.name}: first boot preserves serialized settings and revisions`);
				const reboot = boot(file, fixture);
				assert.deepEqual(reboot.events, [], `${fixture.name}: a fresh isolate does not repeat lifecycle`);
				assert.deepEqual(reboot.state, first.state, `${fixture.name}: reboot preserves the existing active state`);
				assert.deepEqual(reboot.rows, before, `${fixture.name}: reboot preserves settings and revisions`);
				boots.push({ name: fixture.name, first: first.events, reboot: reboot.events, siteUrl: first.siteUrl });
			}
		} finally { rmSync(directory, { recursive: true, force: true }); }
		console.log(JSON.stringify({ target: target.name, emdash: target.versions.get("emdash"), harness: "Astro virtual config and production DEV flag", pure, boots, networkRequests }, null, 2));
	}
}
