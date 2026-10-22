// Controlled exact-package proof using the published native HTTP adapter.
// Provider and DNS responses are synthetic; no external transport is permitted.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createEnvironment, runtimeExport } from "./environment.mjs";

const [consumer, receiptFile, artifactJson] = process.argv.slice(2);
assert.ok(consumer && isAbsolute(consumer) && receiptFile && isAbsolute(receiptFile),
	"Usage: node indexnow-deadline-smoke.mjs ABSOLUTE_CONSUMER ABSOLUTE_RECEIPT ARTIFACT_JSON");
const environment = createEnvironment(consumer);
assert.ok(["native-1.2.0", "native-1.3.0"].includes(environment.target.name));
for (const name of ["emdash", "@emdash-cms/admin"]) {
	assert.equal(JSON.parse(readFileSync(new URL("package.json", environment.hostPackageRoot(name)), "utf8")).version, environment.target.versions.get(name));
}
const astroVersion = JSON.parse(readFileSync(new URL("package.json", environment.hostPackageRoot("astro")), "utf8")).version;
const artifact = JSON.parse(artifactJson);
const PLUGIN = "shipit-seo";
const SITE = "https://example.com";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const SETTINGS_KEY = "plugin:shipit-seo:settings:indexnow:v1";
const KEY = "DeadlineFixtureOnlyIndexNowKey";
const fixture = mkdtempSync(join(consumer, "indexnow-deadline-"));
assert.ok(relative(consumer, fixture).startsWith("indexnow-deadline-"));
const report = {
	schemaVersion: 1, status: "failed", target: environment.target.name, node: process.versions.node,
	host: { emdash: environment.target.versions.get("emdash"), admin: environment.target.versions.get("@emdash-cms/admin"), astro: astroVersion, database: "SQLite" }, tarball: artifact,
	evidence: "Exact installed package, published EmDashRuntime and HTTP dispatcher, native HTTP response buffering",
	transport: "Controlled global fetch responses for exact provider and DoH requests; no live provider acceptance",
	network: { dohA: 0, dohAAAA: 0, providerPosts: 0, loopback: 0, denied: 0 },
	cases: [],
};
const originalFetch = globalThis.fetch;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const activeIntervals = new Set();
globalThis.setInterval = (...args) => {
	const timer = originalSetInterval(...args);
	activeIntervals.add(timer);
	return timer;
};
globalThis.clearInterval = (timer) => {
	activeIntervals.delete(timer);
	return originalClearInterval(timer);
};
let probe = null;
const probes = [];
const pendingRoutes = new Set();
const timeoutBudget = 14_000;
const writeReport = () => {
	const contents = JSON.stringify(report, null, 2) + "\n";
	assert.ok(Buffer.byteLength(contents) <= 65_536);
	mkdirSync(dirname(receiptFile), { recursive: true });
	writeFileSync(receiptFile, contents);
};
const watchdog = setTimeout(() => {
	report.error = "Fixture exceeded its 45-second wall-clock budget";
	writeReport();
	process.exit(1);
}, 45_000);

function deferred() {
	let resolve;
	const promise = new Promise((finish) => { resolve = finish; });
	return { promise, resolve };
}
async function within(promise, milliseconds, label) {
	let timer;
	try {
		return await Promise.race([promise, new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(label)), milliseconds);
		})]);
	} finally { clearTimeout(timer); }
}
function makeProbe(mode) {
	const entered = deferred();
	const current = {
		mode, entered, calls: 0, aborted: false, aborts: 0, signal: null,
		response: null, bodyController: null, completed: false, enteredAt: null,
	};
	current.finish = () => {
		if (current.completed) return;
		current.completed = true;
		if (mode === "pending-fetch") current.resolve(new Response("{}", { status: 202 }));
		if (mode === "buffered-body") {
			current.bodyController.enqueue(new TextEncoder().encode("}"));
			current.bodyController.close();
		}
	};
	probes.push(current);
	return current;
}
globalThis.fetch = async (input, init = {}) => {
	const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
	const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
	const dohType = url.searchParams.get("type");
	if (method === "GET" && url.origin === "https://cloudflare-dns.com" && url.pathname === "/dns-query" &&
		url.searchParams.size === 2 && url.searchParams.get("name") === "api.indexnow.org" &&
		(dohType === "A" || dohType === "AAAA") && !url.hash && !url.username && !url.password) {
		assert.equal(new Headers(init.headers).get("accept"), "application/dns-json");
		report.network[dohType === "A" ? "dohA" : "dohAAAA"] += 1;
		return Response.json({ Status: 0, Answer: dohType === "A" ? [{
			name: "api.indexnow.org", type: 1, TTL: 60, data: "93.184.216.34",
		}] : [] });
	}
	if (url.href === ENDPOINT && method === "POST") {
		assert.ok(probe, "A provider request requires an explicitly selected fixture case");
		const current = probe;
		current.calls += 1;
		assert.equal(current.calls, 1, "Each selected batch makes one provider request");
		report.network.providerPosts += 1;
		assert.ok(init.signal instanceof AbortSignal, "The genuine host adapter forwards the composed signal");
		current.signal = init.signal;
		init.signal.addEventListener("abort", () => { current.aborted = true; current.aborts += 1; }, { once: true });
		const payload = JSON.parse(typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body));
		assert.ok(payload.host === "example.com" && payload.key === KEY && payload.urlList.length === 1,
			"The packed provider request contains the selected synthetic batch");
		current.enteredAt = Date.now();
		current.entered.resolve();
		if (current.mode === "accepted") return new Response("{}", { status: 202 });
		if (current.mode === "pending-fetch") return new Promise((resolve) => { current.resolve = resolve; });
		if (current.mode === "buffered-body") {
			current.response = new Response(new ReadableStream({
				start(controller) {
					current.bodyController = controller;
					controller.enqueue(new TextEncoder().encode("{"));
				},
			}), { status: 202, headers: { "Content-Type": "application/json" } });
			return current.response;
		}
		throw new Error("Unknown controlled transport mode");
	}
	if (url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password) {
		report.network.loopback += 1;
		return originalFetch(input, init);
	}
	report.network.denied += 1;
	throw new Error("Network target denied by the IndexNow deadline fixture");
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
	const packageRoot = join(consumer, "node_modules", "@shipitseo", "emdash-plugin-seo");
	const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	assert.equal(manifest.name, "@shipitseo/emdash-plugin-seo");
	assert.equal(existsSync(join(packageRoot, "src")), false, "The consumer has no product source");
	assert.ok(realpathSync(packageRoot).startsWith(realpathSync(consumer) + "/"), "The package belongs to this consumer");
	const config = { database: { entrypoint: "emdash/db/sqlite", config: { url: join(fixture, "deadline.sqlite") } }, siteUrl: SITE };
	const runtimeInfo = await hostExport("EmDashRuntime");
	assert.equal((runtimeInfo.source.match(/import\.meta\.env\.DEV/g) ?? []).length, 1);
	const virtualConfig = "data:text/javascript," + encodeURIComponent("export default " + JSON.stringify(config) + ";");
	registerHooks({
		resolve(specifier, context, nextResolve) {
			return nextResolve(specifier === "virtual:emdash/config" ? virtualConfig : specifier, context);
		},
		load(url, context, nextLoad) {
			const loaded = nextLoad(url, context);
			return url === runtimeInfo.url.href
				? { ...loaded, source: runtimeInfo.source.replace("import.meta.env.DEV", "false") }
				: loaded;
		},
	});
	const { createDialect } = await import(runtimeExport(environment, "emdash", "./db/sqlite").href);
	const { runMigrations } = await import(runtimeExport(environment, "emdash", "./db").href);
	const { Kysely } = await import(runtimeExport(environment, "kysely").href);
	const { OptionsRepository, PluginStorageRepository } = await import(runtimeExport(environment, "emdash").href);
	const bootstrap = new Kysely({ dialect: createDialect({ url: config.database.config.url }) });
	try {
		await runMigrations(bootstrap);
		const options = new OptionsRepository(bootstrap);
		for (const name of ["emdash:setup_complete", "emdash:seed_complete"]) await options.set(name, true);
		for (const name of ["site:url", "emdash:site_url"]) await options.set(name, SITE);
	} finally { await bootstrap.destroy(); }
	const { createPlugin } = await import(pathToFileURL(join(packageRoot, manifest.exports["./plugin"].default)).href);
	const plugin = createPlugin({ siteUrl: SITE });
	assert.equal(plugin.version, manifest.version);
	const EmDashRuntime = (await import(runtimeInfo.url.href))[runtimeInfo.alias];
	runtime = await EmDashRuntime.create({
		config, plugins: [plugin], createDialect, sandboxEnabled: false, sandboxBypassed: false,
		sandboxedPluginEntries: [], mediaProviderEntries: [], migrationMode: "auto",
	});
	assert.equal(runtime.isPluginEnabled(PLUGIN), true);
	const dispatch = await importHostExport("dispatchPluginApiRequest");
	const caller = { id: "deadline-admin", email: "admin@example.test", name: "Deadline administrator", role: 50,
		emailVerified: true, avatarUrl: null, data: null, createdAt: "2026-10-15T00:00:00.000Z" };
	const call = (route, body) => {
		const request = new Request(SITE + "/_emdash/api/plugins/" + PLUGIN + "/" + route, {
			method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: JSON.stringify(body),
		});
		const result = (async () => {
			const response = await dispatch({ runtime, pluginId: PLUGIN, path: "/" + route, request, user: caller });
			const payload = await response.json();
			assert.equal(response.status, 200, route + " must reach the published dispatcher");
			assert.equal(payload.success, true, route + " must pass the host permission and input boundary");
			return payload.data;
		})();
		pendingRoutes.add(result);
		void result.then(() => pendingRoutes.delete(result), () => pendingRoutes.delete(result));
		return result;
	};
	const options = new OptionsRepository(runtime.db);
	const store = (name) => new PluginStorageRepository(runtime.db, PLUGIN, name, plugin.storage[name].indexes);
	const rows = async (collection) => (await runtime.db.selectFrom("_plugin_storage").selectAll()
		.where("plugin_id", "=", PLUGIN).where("collection", "=", collection).orderBy("id").execute());
	const records = async (collection) => (await rows(collection)).map((row) => JSON.parse(row.data));
	const snapshot = async () => ({
		options: await runtime.db.selectFrom("options").selectAll().orderBy("name").execute(),
		storage: await runtime.db.selectFrom("_plugin_storage").selectAll().orderBy("plugin_id").orderBy("collection").orderBy("id").execute(),
	});
	await options.set("plugin:other-plugin:deadline-sentinel", { preserve: "Unrelated option" });
	await store("schemas").put("deadline-preservation", {
		storageVersion: 1, name: "Unrelated schema", scope: "posts", enabled: false,
		json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", name: "Preserved schema" }),
		createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
	});
	const unrelatedBefore = {
		option: await options.get("plugin:other-plugin:deadline-sentinel"),
		storage: await store("schemas").get("deadline-preservation"),
	};
	const baselineIntervals = activeIntervals.size;
	const configure = async (maxAttempts = 5) => {
		const updatedAt = new Date().toISOString();
		const values = {
			enabled: true, autoSubmit: false, autoSubmitContentTypes: ["posts"], apiKey: KEY,
			keyLocation: "/indexnow-key.txt", batchSize: 1, minIntervalSeconds: 300, maxAttempts,
		};
		await options.set(SETTINGS_KEY, {
			version: 1, updatedAt, values,
			verification: { siteOrigin: SITE, keyLocation: values.keyLocation, apiKey: KEY, checkedAt: updatedAt },
		});
		return { updatedAt, values };
	};
	const queue = async (name) => {
		const url = SITE + "/posts/deadline-" + name;
		const queued = await call("submit-admin-indexnow", { urls: [url], force: false, deliverNow: false });
		assert.equal(queued.success, true, "The packed manual route queues the synthetic URL");
		assert.equal(queued.enqueued, 1);
		return url;
	};
	const jobFor = async (url) => {
		const job = (await records("indexnowJobs")).find((item) => item.url === url);
		assert.ok(job, "The real queue contains the selected job");
		return job;
	};

	await configure();
	probe = makeProbe("accepted");
	const acceptedUrl = await queue("accepted-control");
	const accepted = await within(call("drain-admin-indexnow", { force: false }), 3_000, "Accepted control did not settle");
	assert.equal(accepted.success, true);
	assert.equal((await jobFor(acceptedUrl)).status, "delivered", "Control: a fully buffered 202 is accepted");
	assert.equal((await records("operationLeases")).length, 0);
	assert.equal(activeIntervals.size, baselineIntervals);
	report.cases.push({ name: "accepted-control", providerPosts: probe.calls, disposition: "accepted" });

	for (const [mode, maxAttempts] of [["pending-fetch", 5], ["buffered-body", 1]]) {
		const settings = await configure(maxAttempts);
		probe = makeProbe(mode);
		const current = probe;
		const url = await queue(mode);
		const started = Date.now();
		const deliveryPromise = call("drain-admin-indexnow", { force: false });
		await within(current.entered.promise, 3_000, "The packed native HTTP adapter never dispatched the selected request");
		assert.equal((await records("operationLeases")).filter((item) => item.scope === "indexnow:queue").length, 1,
			"The pending delivery holds the durable queue lease");
		assert.ok(activeIntervals.size > baselineIntervals, "The queue owner has a live heartbeat while delivery waits");
		let offSettled = false;
		const offPromise = call("save-admin-indexnow", {
			...settings.values, enabled: false, expectedUpdatedAt: settings.updatedAt,
		}).then((result) => { offSettled = true; return result; });
		await delay(100);
		assert.equal(offSettled, false, "The off operation waits behind this delivery's same-process queue owner");
		if (mode === "buffered-body") {
			assert.equal(current.response.status, 202);
			assert.equal(current.response.body.locked, true, "The real native HTTP adapter is buffering the stalled provider body");
		}
		const delivery = await within(deliveryPromise, timeoutBudget, mode + " did not settle at the application deadline");
		const elapsedMs = Date.now() - started;
		assert.ok(elapsedMs >= 9_500 && elapsedMs < 14_000, "The fixed 10-second deadline bounds the local wait");
		assert.equal(current.aborted, true, "The timeout aborts the signal forwarded through native HTTP");
		assert.equal(current.aborts, 1);
		assert.equal(delivery.success, maxAttempts > 1, "A timed-out final attempt is failed; an eligible retry is retained");
		if (maxAttempts === 1) assert.equal(delivery.error, "delivery_failed");
		const off = await within(offPromise, 2_000, "Queued IndexNow off did not proceed after the deadline");
		assert.equal(off.success, true);
		assert.equal(off.indexNow.values.enabled, false);
		const job = await jobFor(url);
		assert.equal(job.attempts, 1, "A timeout counts as one attempted delivery");
		assert.equal(job.status, maxAttempts > 1 ? "retry" : "failed");
		assert.equal(job.lastHttpStatus, null, "Buffered headers alone do not establish an accepted response");
		assert.match(job.lastError, /timed out/i);
		assert.match(job.lastError, /acceptance could not be confirmed/i);
		assert.match(job.lastError, /retry may submit/i);
		const audits = (await records("indexnowDeliveries")).filter((item) => item.urls.includes(url));
		assert.equal(audits.length, 1);
		const audit = audits[0];
		assert.equal(audit.attempt, 1);
		assert.equal(audit.status, job.status);
		assert.equal(audit.httpStatus, null);
		assert.match(audit.detail, /acceptance could not be confirmed/i);
		const history = (await records("indexnowSubmissions")).find((item) => item.id === job.submissionId);
		assert.ok(history, "The attempted batch keeps its submission history");
		assert.equal(history.attempts, 1);
		assert.equal(history.counts.accepted, 0);
		assert.equal(history.counts[maxAttempts > 1 ? "retrying" : "failed"], 1);
		if (maxAttempts > 1) {
			assert.ok(Date.parse(job.nextAttemptAt) >= Date.parse(audit.createdAt) + 300_000,
				"Timeouts use the existing delayed backoff, not immediate retries");
			assert.ok(Date.parse(job.nextAttemptAt) > Date.now());
		} else {
			assert.equal(job.nextAttemptAt, null);
			assert.match(job.lastError, /retry limit reached/i);
		}
		assert.equal((await records("operationLeases")).length, 0, "Delivery and queued off release their durable leases");
		assert.equal(activeIntervals.size, baselineIntervals, "Delivery and queued off clear their heartbeat intervals");
		const afterOff = await snapshot();
		current.finish();
		await delay(100);
		assert.deepEqual(await snapshot(), afterOff, "A late 202/body completion cannot write after a newer off operation");
		assert.equal(current.calls, 1, "No post-off remote request follows the late response");
		const disabled = await call("drain-admin-indexnow", { force: false });
		assert.deepEqual([disabled.success, disabled.error], [false, "indexnow_disabled"]);
		assert.equal(current.calls, 1, "Explicit drain while off makes no provider request");
		assert.equal((await records("operationLeases")).length, 0);
		report.cases.push({
			name: mode, elapsedMs, providerPosts: current.calls, aborts: current.aborts,
			disposition: job.status, attempts: job.attempts, remoteAcceptance: "unconfirmed",
			retryDelayed: maxAttempts > 1, queuedOffCompleted: true, leasesReleased: true,
			heartbeatReleased: true, lateResponseWroteNothing: true, postOffSends: 0,
		});
	}
	assert.deepEqual({
		option: await options.get("plugin:other-plugin:deadline-sentinel"),
		storage: await store("schemas").get("deadline-preservation"),
	}, unrelatedBefore, "Unrelated options and plugin storage remain unchanged");
	assert.equal(report.network.providerPosts, 3);
	assert.equal(report.network.dohA, 3, "The actual host HTTP boundary validates provider A records");
	assert.equal(report.network.dohAAAA, 3, "The actual host HTTP boundary validates provider AAAA records");
	assert.equal(report.network.denied, 0);
	report.status = "passed";
	report.unrelatedRecordsPreserved = true;
} catch (error) {
	report.error = String(error);
	throw error;
} finally {
	try {
		for (const current of probes) if (current.mode !== "accepted" && !current.completed && current.enteredAt !== null) current.finish();
		await within(Promise.allSettled([...pendingRoutes]), 3_000, "Fixture route cleanup did not settle");
		if (runtime) { await runtime.shutdown(); await runtime.db.destroy(); }
	} finally {
		for (const timer of activeIntervals) originalClearInterval(timer);
		globalThis.fetch = originalFetch;
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
		clearTimeout(watchdog);
		writeReport();
		rmSync(fixture, { recursive: true, force: true });
	}
}
console.log("Packed native IndexNow deadline passed: pending fetch, buffered body, abort, retry/final uncertainty, queued off, lease cleanup and late-response refusal.");
