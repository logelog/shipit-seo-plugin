import assert from "node:assert/strict";
import { SEO_ADMIN_CONTRACT_VERSION } from "../../packages/emdash-plugin-seo/src/admin-contract.ts";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer, request as nodeHttpRequest } from "node:http";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createEnvironment, reviewOutputRoot, sourceRoot } from "./environment.mjs";
import { recordPackedVerification } from "../../tooling/plugin-dev/ci-evidence.mjs";
import { assertPackedArtifact } from "../../packages/emdash-plugin-seo/scripts/packed-artifact.mjs";

const environment = createEnvironment();
environment.assertVersions();
const reviewRoot = reviewOutputRoot(environment.target);
const hostManifest = JSON.parse(readFileSync(new URL("package.json", environment.hostRoot), "utf8"));
const packageManagerVersion = /^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(hostManifest.packageManager ?? "")?.[1];
if (!packageManagerVersion) throw new Error("Packed consumer requires an exact pnpm version");
const nativeConsumer = ["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(environment.target.name);
const fullNativeConsumer = ["native-1.2.0", "native-1.3.0"].includes(environment.target.name);
const indexNowDeadlineSmoke = process.env.SHIPIT_INDEXNOW_DEADLINE_SMOKE === "1";
if (indexNowDeadlineSmoke && !fullNativeConsumer) throw new Error("The IndexNow deadline fixture requires a supported full native target");
const npmConsumer = process.env.SHIPIT_PACKED_CONSUMER === "npm";
const existingArtifact = process.env.SHIPIT_PACKED_ARTIFACT;
if (npmConsumer && !fullNativeConsumer) throw new Error("The npm consumer requires a supported full native target");
if (existingArtifact && (!npmConsumer || !isAbsolute(existingArtifact)))
	throw new Error("An existing absolute artifact path is only accepted by the npm consumer");
// The exact artifact the consumer installed, recorded with the evidence.
let packedTarball = null;
const workspace = mkdtempSync(join(tmpdir(), "shipit-seo-packed-"));
const packageName = "@shipitseo/emdash-plugin-seo";
const packageDirectory = join(workspace, "node_modules", ...packageName.split("/"));
const sourcePackage = fileURLToPath(new URL("packages/emdash-plugin-seo/", sourceRoot));
const hostBin = fileURLToPath(new URL("node_modules/.bin/", environment.hostRoot));
const loaderFlag = `--import=${new URL("host-loader.mjs", import.meta.url).href}`;
const inheritedNodeOptions = process.env.NODE_OPTIONS ?? "";
const nodeOptions = inheritedNodeOptions === loaderFlag ? "" :
	inheritedNodeOptions.endsWith(` ${loaderFlag}`) ? inheritedNodeOptions.slice(0, -loaderFlag.length - 1) : inheritedNodeOptions;
if (nodeOptions.includes(loaderFlag)) throw new Error("Packed test cannot run with the canonical source loader");
const packedEnvironment = {
	...process.env,
	PATH: [hostBin, process.env.PATH].filter(Boolean).join(delimiter),
	NODE_OPTIONS: nodeOptions,
};

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, stdio: "inherit", env: packedEnvironment });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function hasAdminStyles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory() && hasAdminStyles(path)) return true;
		if (entry.isFile() && entry.name.endsWith(".css") &&
			readFileSync(path, "utf8").includes(".shipit-seo-admin")) return true;
	}
	return false;
}

async function availableLoopbackPort() {
	const probe = createServer();
	try {
		await new Promise((resolve, reject) => {
			probe.once("error", reject);
			probe.listen(0, "127.0.0.1", resolve);
		});
		const address = probe.address();
		assert.ok(address && typeof address !== "string");
		return address.port;
	} finally {
		if (probe.listening) await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
	}
}

// The packed middleware answers /llms.txt from the stored record through
// EmDash's public plugin dispatcher on the production server.
async function checkProductionLlmsTxt(origin) {
	const key = "plugin:shipit-seo:configuration:llms-txt:v1";
	const request = (method = "GET", path = "/llms.txt") => fetch(`${origin}${path}`, { method, redirect: "manual", signal: AbortSignal.timeout(10_000) });
	const volatile = new Set(["date", "connection", "keep-alive", "server-timing"]);
	const stableHeaders = (response) => [...response.headers.entries()].filter(([name]) => !volatile.has(name));
	const writeRecord = (value, revision) => {
		const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
		try {
			database.prepare("DELETE FROM options WHERE name = ?").run(key);
			if (value !== null) database.prepare("INSERT INTO options (name, value, revision) VALUES (?, ?, ?)").run(key, value, revision);
		} finally {
			database.close();
		}
	};
	// Refusals and unavailable states: same status and plain-text headers for
	// GET and HEAD, never cacheable, and no stored text in the body.
	const expectRefusal = async (status, label) => {
		for (const method of ["GET", "HEAD"]) {
			const response = await request(method);
			const body = await response.text();
			assert.equal(response.status, status, `${method} /llms.txt ${label}`);
			assert.equal(response.headers.get("cache-control"), "no-store", `${method} ${label}`);
			assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8", `${method} ${label}`);
			assert.equal(response.headers.get("x-content-type-options"), "nosniff", `${method} ${label}`);
			if (status === 503) assert.equal(response.headers.get("retry-after"), "300", `${method} ${label}`);
			if (method === "HEAD") assert.equal(body, "", `HEAD ${label} has no body`);
			else assert.equal(body.includes("Packed site"), false, `${label} exposes no stored text`);
		}
	};
	await expectRefusal(404, "without a record");
	const text = `${String.fromCharCode(0xfeff)}# Packed site ${String.fromCodePoint(0x1f600)}\r\n\r\n- [Docs](/docs) \u00e9\r\n`;
	writeRecord(JSON.stringify({ version: 1, enabled: true, text }), "packed-llms-1");
	const get = await request();
	const body = new Uint8Array(await get.arrayBuffer());
	assert.equal(get.status, 200, "an enabled record is served");
	assert.deepEqual([...body], [...new TextEncoder().encode(text)], "the production body is the exact UTF-8 bytes");
	assert.equal(get.headers.get("content-type"), "text/plain; charset=utf-8");
	assert.equal(get.headers.get("cache-control"), "public, max-age=300");
	assert.equal(get.headers.get("x-content-type-options"), "nosniff");
	assert.equal(get.headers.get("content-length"), String(body.byteLength));
	const head = await request("HEAD");
	assert.equal(head.status, 200);
	assert.equal((await head.arrayBuffer()).byteLength, 0, "HEAD sends no body");
	assert.deepEqual(stableHeaders(head), stableHeaders(get), "HEAD has the same headers as GET");
	assert.equal((await request("GET", "/llms.txt?ref=1")).status, 404);
	const post = await request("POST");
	assert.deepEqual([post.status, post.headers.get("allow")], [405, "GET, HEAD"]);
	writeRecord(JSON.stringify({ version: 1, enabled: false, text }), "packed-llms-2");
	await expectRefusal(404, "with output off");
	writeRecord(JSON.stringify({ version: 2, enabled: true, text }), "packed-llms-3");
	await expectRefusal(503, "with an invalid record");
	writeRecord("{not json", "packed-llms-4");
	await expectRefusal(503, "with unreadable stored JSON");
	writeRecord(null);
	await expectRefusal(404, "after the record is removed");
}

async function startProductionServer() {
	const port = await availableLoopbackPort();
	const origin = `http://127.0.0.1:${port}`;
	const server = spawn(process.execPath, [join(workspace, "dist/server/entry.mjs")], {
		cwd: workspace,
		env: { ...packedEnvironment, HOST: "127.0.0.1", PORT: String(port) },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let serverError;
	let serverOutput = "";
	server.on("error", (error) => { serverError = error; });
	for (const stream of [server.stdout, server.stderr]) {
		stream.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-8_192); });
	}
	const stop = async () => {
		if (server.exitCode === null && server.signalCode === null) {
			const exited = new Promise((resolve) => server.once("exit", resolve));
			server.kill("SIGTERM");
			await Promise.race([exited, delay(3_000, undefined, { ref: false })]);
			if (server.exitCode === null && server.signalCode === null) {
				server.kill("SIGKILL");
				await Promise.race([exited, delay(1_000, undefined, { ref: false })]);
			}
		}
		// The database is changed and the server restarted only after it exits.
		assert.ok(server.exitCode !== null || server.signalCode !== null, "the production server must have exited");
	};
	try {
		const pluginUrl = `${origin}/_emdash/api/plugins/shipit-seo/public-indexnow-key`;
		let pluginResponse;
		const deadline = Date.now() + 20_000;
		while (!pluginResponse && Date.now() < deadline) {
			if (serverError || server.exitCode !== null || server.signalCode !== null) {
				throw new Error(`Production server stopped before serving IndexNow: ${serverError ?? serverOutput}`);
			}
			try {
				pluginResponse = await fetch(pluginUrl, { signal: AbortSignal.timeout(2_000) });
			} catch {
				await delay(100);
			}
		}
		assert.ok(pluginResponse, `Production server did not serve IndexNow within 20 seconds: ${serverOutput}`);
		return { origin, pluginResponse, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

async function checkProductionIndexNowKey(origin) {
	const rowName = "plugin:shipit-seo:settings:indexnow:v1";
	const configuredKey = "PackedRuntimeOnlyIndexNowKey";
	const sentinelKey = "UntrustedLoopbackSentinelKey";
	const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
	const previous = database.prepare("SELECT value, revision FROM options WHERE name = ?").get(rowName);
	const sentinelRequests = [];
	const sentinel = createHttpServer((request, response) => {
		sentinelRequests.push({ method: request.method, path: request.url });
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ success: true, data: { configured: true, key: sentinelKey } }));
	});
	const headersOf = (response) => ({
		type: response.headers.get("content-type"), cache: response.headers.get("cache-control"),
		nosniff: response.headers.get("x-content-type-options"), robots: response.headers.get("x-robots-tag"),
	});
	const expectedHeaders = {
		type: "text/plain; charset=utf-8", cache: "no-store", nosniff: "nosniff", robots: "noindex, nofollow",
	};
	const requestWithHost = (host) => new Promise((resolve, reject) => {
		const request = nodeHttpRequest(new URL("/indexnow-key.txt", origin), { headers: { Host: host } }, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk) => {
				body += chunk;
				if (body.length > 1_024) request.destroy(new Error("IndexNow key response exceeds fixture budget"));
			});
			response.on("end", () => resolve({ status: response.statusCode, body }));
			response.on("error", reject);
		});
		request.setTimeout(10_000, () => request.destroy(new Error("IndexNow key request timed out")));
		request.on("error", reject);
		request.end();
	});
	try {
		await new Promise((resolve, reject) => {
			sentinel.once("error", reject);
			sentinel.listen(0, "127.0.0.1", resolve);
		});
		const forgedHost = `127.0.0.1:${sentinel.address().port}`;
		assert.deepEqual(await requestWithHost(forgedHost), { status: 404, body: "Not found" },
			"a forged Host must not make an unconfigured site serve the sentinel key");
		// Controlled storage fixture: IndexNow and automatic delivery remain off.
		database.prepare("DELETE FROM options WHERE name = ?").run(rowName);
		database.prepare("INSERT INTO options (name, value, revision) VALUES (?, ?, ?)").run(rowName, JSON.stringify({
			version: 1, updatedAt: "2026-10-15T00:00:00.000Z",
			values: {
				enabled: false, autoSubmit: false, autoSubmitContentTypes: ["pages", "posts"],
				apiKey: configuredKey, keyLocation: "/indexnow-key.txt", batchSize: 100,
				minIntervalSeconds: 300, maxAttempts: 5,
			},
		}), "packed-indexnow-key-boundary");
		for (const method of ["GET", "HEAD"]) {
			const response = await fetch(`${origin}/indexnow-key.txt?visitor=ignored`, {
				method, signal: AbortSignal.timeout(10_000),
			});
			assert.equal(response.status, 200, "the packed route reads the plugin-owned key through the real public dispatcher");
			assert.deepEqual(headersOf(response), expectedHeaders);
			assert.equal(await response.text(), method === "HEAD" ? "" : configuredKey);
		}
		assert.deepEqual(await requestWithHost(forgedHost), { status: 200, body: configuredKey },
			"the real stored key is independent of the incoming Host");
		assert.deepEqual(sentinelRequests, [], "the local sentinel must receive no self-request");
		if (fullNativeConsumer) writeNativeReceipt("indexnow-key-review/packed-consumer.json", {
			schemaVersion: 1, target: environment.target.name, emdash: environment.target.versions.get("emdash"),
			archiveSha256: packedTarball.sha256,
			evidence: "Exact packed Astro production route, published EmDash public dispatcher and synthetic SQLite key fixture",
			configuredKey: "GET returns the exact fixture key; HEAD has no body; both preserve public text headers",
			forgedHost: { target: "separate loopback sentinel", unconfigured: 404, configured: 200, sentinelRequests: 0 },
			transport: "No provider call or public network target; IndexNow remains disabled",
		});
	} finally {
		database.prepare("DELETE FROM options WHERE name = ?").run(rowName);
		if (previous) database.prepare("INSERT INTO options (name, value, revision) VALUES (?, ?, ?)").run(rowName, previous.value, previous.revision);
		database.close();
		if (sentinel.listening) await new Promise((resolve, reject) => sentinel.close((error) => error ? reject(error) : resolve()));
	}
}

async function checkProductionPublicRoutes() {
	const { origin, pluginResponse, stop } = await startProductionServer();
	try {
		assert.equal(pluginResponse.status, 200, "The public plugin key route must be available");
		const pluginPayload = await pluginResponse.json();
		const keyStatus = pluginPayload?.success === true ? pluginPayload.data : pluginPayload;
		assert.equal(keyStatus?.configured, false);
		assert.equal(keyStatus?.key, null);

		for (const method of ["GET", "HEAD"]) {
			const response = await fetch(`${origin}/indexnow-key.txt`, {
				method,
				signal: AbortSignal.timeout(10_000),
			});
			assert.equal(response.status, 404, `${method} must report an unconfigured key`);
			assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
			assert.equal(response.headers.get("cache-control"), "no-store");
			assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
			assert.equal(await response.text(), method === "GET" ? "Not found" : "");
		}

		await checkProductionIndexNowKey(origin);

		const redirectRules = await fetch(`${origin}/_emdash/api/plugins/shipit-seo/admin-redirect-rules`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
			body: "{}",
			signal: AbortSignal.timeout(10_000),
		});
		assert.equal(redirectRules.status, 401, "The packed redirect rules route must require a signed-in user");

		if (nativeConsumer) {
			// The packed middleware answers sitemap addresses after EmDash's own
			// middleware. A fresh site has no entries yet, so the truthful index
			// lists no files and no child file exists.
			for (const method of ["GET", "HEAD"]) {
				const index = await fetch(`${origin}/sitemap.xml`, { method, signal: AbortSignal.timeout(10_000) });
				assert.equal(index.status, 200, `${method} /sitemap.xml must be served`);
				assert.equal(index.headers.get("content-type"), "application/xml; charset=utf-8");
				assert.equal(index.headers.get("cache-control"), "public, max-age=300", "Shipit, not EmDash core, serves the index");
				assert.equal(index.headers.get("x-content-type-options"), "nosniff");
				const body = await index.text();
				if (method === "GET") {
					assert.match(body, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
					assert.equal(body.includes("<sitemap>"), false, "a site without entries lists no files");
				} else {
					assert.equal(body, "");
				}
			}
			for (const path of ["/sitemap-pages.xml", "/sitemap-posts.xml?after=01A", "/sitemap.xml?ref=1", "/sitemap-posts.xml?page=2", "/sitemap-bad-name.xml"]) {
				const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
				assert.equal(response.status, 404, `${path} must be a 404`);
				assert.equal(response.headers.get("cache-control"), "no-store", `${path} must not be cached`);
				assert.equal(await response.text(), "Sitemap file not found.");
			}
		}

		const pageResponse = await fetch(`${origin}/seo-fixture`, { signal: AbortSignal.timeout(10_000) });
		assert.equal(pageResponse.status, 200, "The public SEO fixture must render through EmDash");
		const html = await pageResponse.text();
		const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1];
		assert.ok(head, "The public SEO fixture must contain a document head");
		assert.match(head, /<meta name="description" content="A public page for checking rendered SEO metadata\."\s*\/?\s*>/);
		assert.match(head, /<link rel="canonical" href="https:\/\/example\.test\/seo-fixture\/"\s*\/?\s*>/);
		assert.match(head, /<meta property="og:title" content="SEO fixture social title"\s*\/?\s*>/);
		assert.match(head, /<meta property="og:description" content="SEO fixture social description"\s*\/?\s*>/);
		assert.match(head, /<meta property="og:image" content="https:\/\/example\.test\/seo-fixture\.jpg"\s*\/?\s*>/);
		assert.match(head, /<meta name="twitter:card" content="summary_large_image"\s*\/?\s*>/);
		const graphs = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
			.map((match) => JSON.parse(match[1]));
		const publisher = graphs.find((graph) => ["Organization", "Person"].includes(graph?.["@type"]));
		assert.ok(publisher, "Shipit SEO must contribute a site publisher graph");
		assert.equal(typeof publisher["@id"], "string", "The publisher must have a stable graph ID");
		const website = graphs.find((graph) => graph?.["@type"] === "WebSite");
		assert.ok(website, "Shipit SEO must contribute a website graph");
		assert.equal(typeof website.publisher?.["@id"], "string", "The website must reference its publisher");
		assert.equal(website.publisher?.["@id"], publisher["@id"], "Website publisher must resolve to its emitted entity");

		// EmDash treats content pages as articles and fills an unclaimed primary
		// graph with its own BlogPosting, so the plugin's role decides the result.
		for (const [collection, expected, absent] of [["pages", "WebSite", "BlogPosting"], ["posts", "BlogPosting", "WebSite"]]) {
			const contentResponse = await fetch(`${origin}/seo-fixture-content?collection=${collection}`, {
				signal: AbortSignal.timeout(10_000),
			});
			assert.equal(contentResponse.status, 200, `The ${collection} content fixture must render through EmDash`);
			const contentHead = (await contentResponse.text()).match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
			const contentTypes = [...contentHead.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
				.map((match) => JSON.parse(match[1])?.["@type"]);
			assert.equal(contentTypes.filter((type) => type === expected).length, 1, `${collection} pages carry one ${expected} graph`);
			assert.equal(contentTypes.includes(absent), false, `${collection} pages carry no ${absent} graph`);
		}
		if (nativeConsumer) {
			// EmDash core serves robots.txt; with no Site URL, siteUrl option or
			// environment origin, its Sitemap line uses the request origin, never
			// the Astro site that the sitemap uses.
			const robots = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(10_000) });
			assert.equal(robots.status, 200);
			assert.equal(robots.headers.get("cache-control"), "public, max-age=86400");
			assert.equal(await robots.text(), [
				"User-agent: *", "Allow: /", "", "# Disallow admin and API routes", "Disallow: /_emdash/", "", `Sitemap: ${origin}/sitemap.xml`, "",
			].join("\n"));
			// A clean install has no stored site URL and no Shipit settings, so the
			// index is served from the public Astro site recorded at build.
			const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
			try {
				const siteUrl = database.prepare("SELECT value FROM options WHERE name = ?").get("emdash:site_url");
				assert.equal(siteUrl, undefined, "the clean consumer has no EmDash site URL");
				const shipitSettings = database.prepare("SELECT name FROM options WHERE name LIKE 'plugin:shipit-seo:settings:%'").all();
				assert.deepEqual(shipitSettings, [], "a clean installation stores no Shipit settings");
			} finally {
				database.close();
			}
			const index = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(10_000) });
			assert.equal(index.status, 200, "the Astro site origin serves the index without stored settings");
			assert.equal(index.headers.get("cache-control"), "public, max-age=300");
			const locations = [...(await index.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
			assert.ok(locations.every((location) => location.startsWith("https://www.example.com/sitemap-")),
				"listed files use the Astro site origin, not the request host");
			await checkProductionLlmsTxt(origin);
		}
	} finally {
		await stop();
	}
}

// Real Pages and Posts with no Shipit settings on the production server. Rows
// are written while the server is stopped, because the runtime caches
// collection metadata; plugin settings are read per request.
async function checkPackedIndexingDefaults() {
	const now = "2026-10-03T06:00:00.000Z";
	const entries = [
		["ec_pages", "01KA0000000000000000000001", "about", "About the packed site", "/pages/about"],
		["ec_posts", "01KA0000000000000000000002", "launch", "Packed launch notes", "/posts/launch"],
		["ec_posts", "01KA0000000000000000000003", "private-note", "A private note", "/posts/private-note"],
	];
	const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
	try {
		for (const [slug, pattern] of [["pages", "/pages/{slug}"], ["posts", "/posts/{slug}"]]) {
			database.prepare("UPDATE _emdash_collections SET has_seo = 1, url_pattern = ? WHERE slug = ?").run(pattern, slug);
		}
		for (const [table, id, slug, title] of entries) {
			database.prepare(`INSERT INTO ${table} (id, slug, status, locale, title, published_at, created_at, updated_at, translation_group) VALUES (?, ?, 'published', 'en', ?, ?, ?, ?, ?)`)
				.run(id, slug, title, now, now, now, id);
		}
		// The entry's own core noindex.
		database.prepare("INSERT INTO _emdash_seo (collection, content_id, seo_no_index) VALUES ('posts', ?, 1)").run(entries[2][1]);
	} finally {
		database.close();
	}
	const setGlobalSettings = (value, revision) => {
		const settings = new DatabaseSync(join(workspace, "smoke.sqlite"));
		try {
			settings.prepare("DELETE FROM options WHERE name = 'plugin:shipit-seo:settings:global:v1'").run();
			if (value !== null) settings.prepare("INSERT INTO options (name, value, revision) VALUES ('plugin:shipit-seo:settings:global:v1', ?, ?)").run(value, revision);
		} finally {
			settings.close();
		}
	};
	const { origin, stop } = await startProductionServer();
	const evidence = { origin: "loopback production server", tarball: packedTarball, states: {} };
	try {
		const observe = async () => {
			const pages = {};
			for (const [, , slug, title, path] of entries) {
				const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
				assert.equal(response.status, 200, `${path} renders`);
				const head = (await response.text()).match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
				assert.ok(head.includes(`<title>${title}</title>`), `${path} renders its own entry`);
				const types = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1])?.["@type"]);
				pages[slug] = {
					robots: [...head.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((match) => match[1]),
					publisher: types.includes("Organization") || types.includes("Person"),
				};
			}
			const index = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(10_000) });
			const indexBody = await index.text();
			const sitemap = { status: index.status, cacheControl: index.headers.get("cache-control"), files: [...indexBody.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]), urls: [] };
			for (const file of sitemap.files) {
				const child = await fetch(`${origin}${new URL(file).pathname}`, { signal: AbortSignal.timeout(10_000) });
				assert.equal(child.status, 200, `${file} is served`);
				sitemap.urls.push(...[...(await child.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
			}
			return { pages, sitemap };
		};

		const absent = await observe();
		evidence.states.absent = absent;
		assert.deepEqual(absent.pages.about.robots, [], "a Page carries no robots meta without a stored preference");
		assert.deepEqual(absent.pages.launch.robots, [], "a Post carries no robots meta without a stored preference");
		assert.equal(absent.pages["private-note"].robots.length, 1, "the entry's own noindex renders once");
		assert.match(absent.pages["private-note"].robots[0], /noindex/, "the entry's own noindex is kept");
		assert.ok(absent.pages.about.publisher, "Shipit metadata still renders");
		assert.equal(absent.sitemap.status, 200);
		assert.deepEqual(absent.sitemap.files.sort(), ["https://www.example.com/sitemap-pages.xml", "https://www.example.com/sitemap-posts.xml"]);
		assert.deepEqual(absent.sitemap.urls.sort(), ["https://www.example.com/pages/about", "https://www.example.com/posts/launch"],
			"the sitemap lists indexable Pages and Posts and leaves out the entry's own noindex");

		const savedRecord = (noindex) => JSON.stringify({
			version: 1, updatedAt: now, siteName: "Packed site", siteUrl: "https://www.example.com", publisherType: "organization",
			organizationName: "Packed site", organizationLogo: "", personName: "", socialProfiles: [], personProfiles: [],
			defaultSocialImage: "", twitterHandle: "", noindex, contentScoringEnabled: true, indexingPreferenceConfirmed: true,
		});
		setGlobalSettings(savedRecord(false), "packed-saved-false");
		const savedFalse = await observe();
		evidence.states.savedFalse = savedFalse;
		assert.deepEqual([savedFalse.pages.about.robots, savedFalse.pages.launch.robots], [[], []], "a saved false adds no robots meta");
		assert.match(savedFalse.pages["private-note"].robots[0] ?? "", /noindex/, "a saved false keeps the entry's own noindex");
		assert.deepEqual(savedFalse.sitemap.urls.sort(), ["https://www.example.com/pages/about", "https://www.example.com/posts/launch"],
			"a saved false lists the indexable Pages and Posts");

		setGlobalSettings(savedRecord(true), "packed-restricted");
		const restricted = await observe();
		evidence.states.savedTrue = restricted;
		for (const slug of ["about", "launch", "private-note"]) {
			assert.deepEqual(restricted.pages[slug].robots, ["noindex,nofollow"], `a saved restriction applies to ${slug}`);
		}
		assert.deepEqual([restricted.sitemap.status, restricted.sitemap.files], [200, []], "a saved restriction lists no files");

		setGlobalSettings(JSON.stringify({ version: 9 }), "packed-corrupt");
		const corrupt = await observe();
		evidence.states.corrupt = corrupt;
		assert.deepEqual([corrupt.pages.about.robots, corrupt.pages.about.publisher], [[], false], "a corrupt record contributes no Shipit metadata");
		assert.match(corrupt.pages["private-note"].robots[0] ?? "", /noindex/, "core keeps the entry's own noindex when Shipit contributes nothing");
		assert.deepEqual([corrupt.sitemap.status, corrupt.sitemap.cacheControl], [503, "no-store"], "the sitemap answers 503 without caching instead of guessing");

		setGlobalSettings(null);
		const restored = await observe();
		assert.deepEqual([restored.pages.about.robots, restored.sitemap.urls.length], [[], 2], "removing the record returns to no restriction");
	} finally {
		await stop();
	}
	mkdirSync(fileURLToPath(new URL("indexing-defaults-review/", reviewRoot)), { recursive: true });
	writeFileSync(fileURLToPath(new URL("indexing-defaults-review/packed-consumer.json", reviewRoot)), `${JSON.stringify(evidence, null, 2)}\n`);
}

// The saved template library through the packed production server's HTTP
// routes, with an Administrator API token written while the server is stopped.
// Templates are copied into one Post and one Page, predicted, saved as each
// entry's own schema and compared with the JSON-LD in the served HTML.
// Fixture identifiers in the exact form the routes accept, checked before any request uses them.
function fixtureId(prefix, seed) {
	const id = `${prefix}-${seed.padEnd(20, "0")}`;
	assert.match(id, prefix === "tpl" ? /^tpl-[a-z0-9]{20}$/ : /^entry-[a-z0-9]{20}$/, `fixture identifier ${id}`);
	return id;
}

async function checkPackedSchemaLibrary() {
	const now = "2026-10-03T07:00:00.000Z";
	const raw = `ec_pat_${randomBytes(32).toString("base64url")}`;
	const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
	try {
		assert.equal(database.prepare("SELECT value FROM options WHERE name = ?").get("emdash:site_url"), undefined,
			"the earlier public-route checks leave the EmDash Site URL absent");
		// EmDash getPublicUrl requires its stored Site URL independently of Astro.site.
		database.prepare("INSERT INTO options (name, value, revision) VALUES ('emdash:site_url', ?, ?)").run(JSON.stringify("https://www.example.com"), "packed-site-url");
		database.prepare("INSERT INTO users (id, email, name, role, email_verified, created_at, updated_at, disabled) VALUES (?, ?, ?, 50, 1, ?, ?, 0)")
			.run("packed-admin", "admin@example.test", "Packed administrator", now, now);
		// EmDash stores base64url(SHA-256(raw token)); the server resolving it to this user proves the format.
		database.prepare("INSERT INTO _emdash_api_tokens (id, name, token_hash, prefix, user_id, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.run("packed-token", "Packed library check", createHash("sha256").update(raw).digest("base64url"), raw.slice(0, 11), "packed-admin", JSON.stringify(["admin"]), now);
		// The Page's own canonical URL, which both the prediction and the page use.
		database.prepare("INSERT INTO _emdash_seo (collection, content_id, seo_canonical) VALUES ('pages', ?, ?)").run("01KA0000000000000000000001", "https://www.example.com/about-us");
	} finally {
		database.close();
	}
	const clientFiles = readdirSync(join(workspace, "dist", "client"), { recursive: true }).map(String).filter((name) => name.endsWith(".js"));
	assert.ok(clientFiles.some((name) => readFileSync(join(workspace, "dist", "client", name), "utf8").includes("Schema library")),
		"the packed admin bundle contains the Schema library view");
	const { origin, stop } = await startProductionServer();
	const evidence = { origin: "loopback production server", tarball: packedTarball, steps: {} };
	try {
		const api = async (route, body, { token = raw } = {}) => {
			const response = await fetch(`${origin}/_emdash/api/plugins/shipit-seo/${route}`, {
				method: body === undefined ? "GET" : "POST",
				headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(20_000),
			});
			const text = await response.text();
			return { status: response.status, bytes: Buffer.byteLength(text), data: JSON.parse(text)?.data };
		};
		const pageGraphs = async (path) => {
			const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
			assert.equal(response.status, 200, `${path} renders`);
			const head = (await response.text()).match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
			return [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
		};
		assert.equal((await api("schema-library", undefined, { token: null })).status, 401, "an anonymous caller is refused");
		const empty = await api("schema-library");
		assert.deepEqual([empty.status, empty.data.state], [200, "absent"]);

		const create = async (id, name, json, expectedRevision) => {
			const result = await api("save-schema-library-template", { mode: "create", expectedRevision, id, name, json });
			assert.equal(result.data.success, true, JSON.stringify(result.data));
			return result.data.library.revision;
		};
		const articleId = fixtureId("tpl", "packedarticle");
		const pageId = fixtureId("tpl", "packedpage");
		const articleJson = JSON.stringify({ "@context": "https://schema.org", "@type": "Article", "@id": "https://www.example.com/#packed-article", headline: "{{title}}", publisher: { "@id": "https://www.example.com/#organization" } });
		const pageJson = JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", "@id": "{{canonical}}#packed-page", name: "{{title}}", url: "{{canonical}}" });
		let revision = await create(articleId, "Packed article", articleJson, null);
		revision = await create(pageId, "Packed page", pageJson, revision);
		const reloaded = await api("schema-library");
		assert.deepEqual([reloaded.data.state, reloaded.data.revision, reloaded.data.templates.map((item) => item.id)], ["saved", revision, [articleId, pageId]]);
		evidence.steps.library = { state: reloaded.data.state, templates: reloaded.data.templates.length, bytes: reloaded.data.bytes };

		const copy = async (entryRef, path, entryId, json) => {
			const before = await pageGraphs(path);
			const preview = await api("preview-entry-schema-candidate", { requestId: `packed-${entryId.slice(-8)}`, ...entryRef, id: entryId, expectedRevision: null, name: "Packed copy", json, enabled: true });
			assert.equal(preview.status, 200);
			assert.ok(preview.bytes <= 524_288);
			assert.equal(preview.data.success, true, JSON.stringify(preview.data));
			const predicted = preview.data.items.find((item) => item.id === `custom:${entryId}`);
			assert.equal(predicted.emitted, true);
			assert.equal(before.some((graph) => graph["@id"] === predicted.graph["@id"]), false, "a saved template changes no page");
			const saved = await api("save-entry-custom-schema", { ...entryRef, id: entryId, expectedRevision: null, name: "Packed copy", json, enabled: true });
			assert.equal(saved.data.success, true, JSON.stringify(saved.data));
			const after = await pageGraphs(path);
			const served = after.find((graph) => graph["@id"] === predicted.graph["@id"]);
			assert.deepEqual(served, predicted.graph, `the served HTML of ${path} carries exactly the predicted graph`);
			const ids = after.map((graph) => graph["@id"]).filter(Boolean);
			assert.equal(new Set(ids).size, ids.length, `no entity is defined twice in the JSON-LD served for ${path}`);
			return { preview, predicted, after };
		};
		const post = { collection: "posts", entryId: "01KA0000000000000000000002", locale: "en" };
		const page = { collection: "pages", entryId: "01KA0000000000000000000001", locale: "en" };

		const postRouteId = fixtureId("entry", "packedpostroute");
		const postRouteJson = JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", "@id": "{{canonical}}#packed-post-route", name: "{{title}}", url: "{{canonical}}" });
		const postRoute = await copy(post, "/posts/launch", postRouteId, postRouteJson);
		assert.equal(postRoute.preview.data.canonicalSource, "page");
		assert.equal(postRoute.predicted.graph["@id"], "https://www.example.com/posts/launch#packed-post-route");
		assert.equal(postRoute.predicted.graph.url, "https://www.example.com/posts/launch");
		evidence.steps.postRouteCanonical = { path: "/posts/launch", canonicalSource: "page", registeredUrl: "https://www.example.com/posts/launch", servedEqualsPrediction: true, responseBytes: postRoute.preview.bytes, graph: postRoute.predicted.graph };

		const article = await copy(post, "/posts/launch", fixtureId("entry", "packedarticle"), articleJson);
		assert.equal(article.preview.data.canonicalSource, "page");
		evidence.steps.postArticle = { path: "/posts/launch", canonicalSource: "page", servedEqualsPrediction: true, responseBytes: article.preview.bytes, graph: article.predicted.graph };
		const pageCopy = await copy(page, "/pages/about", fixtureId("entry", "packedpagecopy"), pageJson);
		assert.equal(pageCopy.preview.data.canonicalSource, "entry");
		assert.equal(pageCopy.predicted.graph["@id"], "https://www.example.com/about-us#packed-page");
		evidence.steps.pageCanonical = { path: "/pages/about", canonicalSource: "entry", servedEqualsPrediction: true, graph: pageCopy.predicted.graph };

		// Library edits and deletion never reach the applied copies or the pages.
		const pages = JSON.stringify([await pageGraphs("/posts/launch"), await pageGraphs("/pages/about")]);
		const changedJson = articleJson.replace("{{title}}", "Changed in the library");
		const edited = await api("save-schema-library-template", { mode: "update", expectedRevision: reloaded.data.revision, id: articleId, name: "Packed article", json: `  ${changedJson}  ` });
		assert.equal(edited.data.success, true);
		assert.equal(edited.data.template.json, changedJson, "the edit is stored trimmed");
		const afterEdit = await api("schema-library");
		assert.equal(afterEdit.data.templates.find((item) => item.id === articleId).json, changedJson, "a reload shows the edit");
		assert.equal(JSON.stringify([await pageGraphs("/posts/launch"), await pageGraphs("/pages/about")]), pages, "editing a template leaves the pages unchanged");
		let libraryRevision = afterEdit.data.revision;
		for (const id of [articleId, pageId]) {
			const deleted = await api("delete-schema-library-template", { expectedRevision: libraryRevision, id });
			assert.deepEqual([deleted.data.success, deleted.data.template], [true, null]);
			libraryRevision = deleted.data.library.revision;
		}
		const afterDelete = await api("schema-library");
		assert.deepEqual([afterDelete.data.state, afterDelete.data.templates.length, afterDelete.data.revision], ["saved", 0, libraryRevision],
			"the library is an empty saved record after deleting both templates");
		assert.equal(JSON.stringify([await pageGraphs("/posts/launch"), await pageGraphs("/pages/about")]), pages, "deleting templates leaves the pages unchanged");
		assert.equal((await api("entry-custom-schemas", post)).data.items.find((item) => item.id === fixtureId("entry", "packedarticle"))?.json, articleJson, "the Post's copy keeps its JSON");
		assert.equal((await api("entry-custom-schemas", post)).data.items.find((item) => item.id === postRouteId)?.json, postRouteJson, "the Post's route-based copy keeps its unresolved variables");
		assert.equal((await api("entry-custom-schemas", page)).data.items.find((item) => item.id === fixtureId("entry", "packedpagecopy"))?.json, pageJson, "the Page's copy keeps its JSON");
		evidence.steps.isolation = { afterEdit: "pages unchanged", afterDelete: "pages unchanged", library: { state: afterDelete.data.state, templates: 0 } };
	} finally {
		await stop();
	}
	mkdirSync(fileURLToPath(new URL("schema-library-review/", reviewRoot)), { recursive: true });
	writeFileSync(fileURLToPath(new URL("schema-library-review/packed-consumer.json", reviewRoot)), `${JSON.stringify(evidence, null, 2)}\n`);
}

async function checkPackedRedirectEdit() {
	const now = "2026-10-03T08:00:00.000Z";
	const id = "packed-existing-redirect";
	const raw = `ec_pat_${randomBytes(32).toString("base64url")}`;
	const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
	try {
		database.prepare("INSERT INTO _emdash_api_tokens (id, name, token_hash, prefix, user_id, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.run("packed-redirect-edit-token", "Packed redirect edit check", createHash("sha256").update(raw).digest("base64url"), raw.slice(0, 11), "packed-admin", JSON.stringify(["admin"]), now);
		database.prepare("INSERT INTO _emdash_redirects (id, source, destination, type, is_pattern, enabled, hits, last_hit_at, group_name, auto, created_at, updated_at, config_revision) VALUES (?, ?, ?, 301, 0, 1, 7, ?, ?, 1, ?, ?, ?)")
			.run(id, "/seo-fixture", "/posts/launch?fixed=old#original", now, "Packed imported rules", now, now, "packed-edit-baseline");
	} finally {
		database.close();
	}
	const { origin, stop } = await startProductionServer();
	const evidence = { origin: "loopback production server", tarball: packedTarball, steps: {} };
	try {
		const api = async (path, body, { token = raw } = {}) => {
			const response = await fetch(`${origin}/_emdash/api/${path}`, {
				method: body === undefined ? "GET" : "POST",
				headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
				body: body === undefined ? undefined : JSON.stringify(body),
				redirect: "manual",
				signal: AbortSignal.timeout(20_000),
			});
			const text = await response.text();
			assert.ok(Buffer.byteLength(text) <= 65_536, "the packed redirect response stays within 64 KiB");
			const payload = JSON.parse(text);
			return { status: response.status, success: payload.success, data: payload.data, error: payload.error };
		};
		const plugin = async (route, body, options) => {
			const result = await api(`plugins/shipit-seo/${route}`, body, options);
			if (result.status === 200) {
				assert.equal(result.success, true);
				assert.equal(result.data.contractVersion, SEO_ADMIN_CONTRACT_VERSION);
			}
			return result;
		};
		const core = async (recordId) => {
			const result = await api(`redirects/${encodeURIComponent(recordId)}`);
			assert.deepEqual([result.status, result.success, result.data.id], [200, true, recordId]);
			return result.data;
		};
		const load = async () => {
			const result = await plugin("admin-redirect-rule", { id });
			assert.deepEqual([result.status, result.data.status, result.data.update, result.data.rule.id], [200, "loaded", "available", id]);
			return result.data;
		};
		const draft = (rule, changes = {}) => ({ source: rule.source, destination: rule.destination, type: rule.type, enabled: rule.enabled, ...changes });
		const preserved = (rule) => ({ id: rule.id, isPattern: rule.isPattern, auto: rule.auto, groupName: rule.groupName, createdAt: rule.createdAt });
		const matchesSaved = (actual, saved) => {
			assert.deepEqual({ ...draft(actual), ...preserved(actual) }, { ...draft(saved), ...preserved(saved) });
			assert.ok(actual.hits >= saved.hits, "fire-and-forget public hit updates cannot erase retained activity");
			if (saved.lastHitAt !== null) assert.ok(Date.parse(actual.lastHitAt) >= Date.parse(saved.lastHitAt));
		};
		const publicResult = async (path) => {
			const response = await fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
			await response.arrayBuffer();
			return { status: response.status, location: response.headers.get("location") };
		};
		const observe = async (source, type, destination) => {
			const results = [];
			for (const path of [source, `${source}/`, `${source}?visitor=discarded`]) {
				const result = await publicResult(path);
				assert.deepEqual(result, { status: type, location: destination }, path);
				results.push(result);
			}
			return results;
		};
		// A normal core creation publishes the seeded graph and invalidates earlier empty artifacts.
		const neighbor = await api("redirects", { source: "/packed-edit-neighbor", destination: "/posts/launch", type: 301, groupName: "Packed control" });
		assert.deepEqual([neighbor.status, neighbor.success], [201, true]);
		const neighborBefore = await core(neighbor.data.id);
		const initial = await load();
		assert.deepEqual([initial.rule.auto, initial.rule.groupName, initial.rule.hits, initial.rule.lastHitAt, initial.rule.createdAt], [true, "Packed imported rules", 7, now, now]);
		assert.deepEqual(await core(id), initial.rule);
		const expected = draft(initial.rule, { source: "/pages/about", destination: "/posts/launch?fixed=1#section", type: 302 });
		const request = { id, revision: initial.revision, ...expected };
		const snapshot = { id, revision: initial.revision, baseline: { ...draft(initial.rule), isPattern: false, groupName: initial.rule.groupName, auto: initial.rule.auto }, draft: expected };
		for (const [route, body] of [["admin-redirect-rule", { id }], ["update-admin-redirect-rule", request], ["reconcile-admin-redirect-rule-update", snapshot]]) {
			assert.equal((await plugin(route, body, { token: null })).status, 401, `${route} refuses anonymous access`);
		}
		evidence.steps.anonymousRefused = 3;
		evidence.steps.initial = { sameCoreId: true, preserved: preserved(initial.rule), public: await observe(initial.rule.source, 301, initial.rule.destination) };

		const updated = await plugin("update-admin-redirect-rule", request);
		assert.deepEqual([updated.status, updated.data.status, updated.data.confirmedBy, updated.data.rule.id], [200, "updated", "host", id]);
		assert.notEqual(updated.data.revision, initial.revision);
		assert.deepEqual(preserved(updated.data.rule), preserved(initial.rule));
		assert.ok(updated.data.rule.hits >= initial.rule.hits, "public activity is retained rather than copied from the baseline");
		matchesSaved(await core(id), updated.data.rule);
		const reloaded = await load();
		assert.equal(reloaded.revision, updated.data.revision);
		matchesSaved(reloaded.rule, updated.data.rule);
		evidence.steps.edited = { sameCoreId: true, newRevision: true, preserved: preserved(reloaded.rule), public: await observe(expected.source, 302, expected.destination) };
		assert.deepEqual(await publicResult(initial.rule.source), { status: 200, location: null }, "the old source returns to ordinary routing");
		evidence.steps.oldSourceRestored = true;

		const recovery = await plugin("reconcile-admin-redirect-rule-update", snapshot);
		assert.deepEqual([recovery.status, recovery.data.status, recovery.data.confirmedBy, recovery.data.rule.id, recovery.data.revision], [200, "updated", "recovery", id, reloaded.revision]);
		assert.deepEqual(preserved(recovery.data.rule), preserved(initial.rule));
		matchesSaved(recovery.data.rule, reloaded.rule);
		evidence.steps.readOnlyRecovery = { status: recovery.data.status, sameCoreId: true, sameConfirmedRevision: true };
		const stale = await plugin("update-admin-redirect-rule", { ...request, destination: "/must-not-replace-current" });
		assert.deepEqual([stale.status, stale.data.status, stale.data.reason], [200, "stale", "revision"]);
		assert.equal((await core(id)).destination, expected.destination);
		evidence.steps.staleRefused = true;

		const setEnabled = async (enabled) => {
			const baseline = await load();
			const result = await plugin("update-admin-redirect-rule", { id, revision: baseline.revision, ...draft(baseline.rule, { enabled }) });
			assert.deepEqual([result.status, result.data.status, result.data.rule.enabled], [200, "updated", enabled]);
			assert.notEqual(result.data.revision, baseline.revision);
			assert.deepEqual(preserved(result.data.rule), preserved(initial.rule));
			matchesSaved(await core(id), result.data.rule);
			return result.data;
		};
		await setEnabled(false);
		assert.deepEqual(await publicResult(expected.source), { status: 200, location: null }, "disabled rules leave ordinary page routing intact");
		evidence.steps.disabled = { status: 200, location: null };
		await setEnabled(true);
		evidence.steps.reenabled = await observe(expected.source, 302, expected.destination);
		await setEnabled(false);
		assert.deepEqual(await publicResult(expected.source), { status: 200, location: null });
		assert.deepEqual(await core(neighbor.data.id), neighborBefore, "the neighboring core record is unchanged");
		evidence.steps.finalState = { enabled: false, neighboringRecordUnchanged: true, preserved: preserved((await load()).rule) };
	} finally {
		await stop();
	}
	mkdirSync(fileURLToPath(new URL("redirect-rule-edit/", reviewRoot)), { recursive: true });
	writeFileSync(fileURLToPath(new URL("redirect-rule-edit/packed-consumer.json", reviewRoot)), `${JSON.stringify(evidence, null, 2)}\n`);
	console.log("Packed redirect edit passed same-ID conditional HTTP updates, core readback, read-only recovery and public 301/302, query, slash, disable and re-enable behavior.");
}

// Metadata Templates through the packed production server's HTTP routes: a
// published Post and Page are previewed, saved against the loaded revision,
// read back and compared with the tags in the served HTML.
async function checkPackedMetadataTemplates() {
	const now = "2026-10-03T08:00:00.000Z";
	const raw = `ec_pat_${randomBytes(32).toString("base64url")}`;
	const pageId = "01KA0000000000000000000001";
	const postId = "01KA0000000000000000000002";
	const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
	try {
		database.prepare("INSERT INTO _emdash_api_tokens (id, name, token_hash, prefix, user_id, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.run("packed-templates-token", "Packed templates check", createHash("sha256").update(raw).digest("base64url"), raw.slice(0, 11), "packed-admin", JSON.stringify(["admin"]), now);
		// The Page's own SEO description, which must win over its template.
		database.prepare("UPDATE _emdash_seo SET seo_description = ? WHERE collection = 'pages' AND content_id = ?").run("The packed site's own about text", pageId);
		const siteUrl = database.prepare("SELECT value, revision FROM options WHERE name = ?").get("emdash:site_url");
		assert.equal(siteUrl?.value, JSON.stringify("https://www.example.com"), "metadata templates reuse the configured EmDash Site URL");
		assert.equal(siteUrl?.revision, "packed-site-url", "the configured Site URL remains unchanged");
	} finally {
		database.close();
	}
	const clientFiles = readdirSync(join(workspace, "dist", "client"), { recursive: true }).map(String).filter((name) => name.endsWith(".js"));
	assert.ok(clientFiles.some((name) => readFileSync(join(workspace, "dist", "client", name), "utf8").includes("Published example")),
		"the packed admin bundle contains the Templates preview");
	const { origin, stop } = await startProductionServer();
	const evidence = { origin: "loopback production server", tarball: packedTarball, steps: {} };
	try {
		const api = async (route, body, { token = raw } = {}) => {
			const response = await fetch(`${origin}/_emdash/api/plugins/shipit-seo/${route}`, {
				method: body === undefined ? "GET" : "POST",
				headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(20_000),
			});
			const text = await response.text();
			return { status: response.status, bytes: Buffer.byteLength(text), data: JSON.parse(text)?.data };
		};
		const decode = (value) => value.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
		const servedTags = async (path) => {
			const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
			assert.equal(response.status, 200, `${path} renders`);
			const head = (await response.text()).match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
			const tag = (attribute, name) => {
				const match = head.match(new RegExp(`<meta[^>]*${attribute}="${name}"[^>]*content="([^"]*)"`, "i")) ??
					head.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attribute}="${name}"`, "i"));
				return match ? decode(match[1]) : "";
			};
			return {
				title: decode(head.match(/<title>([^<]*)<\/title>/i)?.[1] ?? ""),
				description: tag("name", "description"),
				socialTitle: tag("property", "og:title"),
				socialDescription: tag("property", "og:description"),
				twitterTitle: tag("name", "twitter:title"),
				twitterDescription: tag("name", "twitter:description"),
			};
		};
		const matches = (served, preview) =>
			served.description === preview.description.value &&
			served.socialTitle === preview.socialTitle.value && served.twitterTitle === preview.socialTitle.value &&
			served.socialDescription === preview.socialDescription.value && served.twitterDescription === preview.socialDescription.value;

		assert.equal((await api("admin-templates", undefined, { token: null })).status, 401, "an anonymous caller is refused");
		const postBefore = await servedTags("/posts/launch");
		const pageBefore = await servedTags("/pages/about");
		const absent = await api("admin-templates");
		assert.deepEqual([absent.status, absent.data.state], [200, "absent"]);
		const examples = await api("admin-template-examples", { collection: "posts", limit: 25 });
		assert.ok(examples.data.items.some((item) => item.entryId === postId && item.locale === "en"), "the published Post is offered with its locale");

		const save = async (collection, values) => {
			const loaded = await api("admin-templates");
			const item = loaded.data.items.find((candidate) => candidate.collection === collection);
			const result = await api("save-admin-templates", { collection, expectedRevision: loaded.data.revision, inheritanceGuard: item.inheritanceGuard, values });
			assert.equal(result.data.success, true, JSON.stringify(result.data));
			return result.data;
		};
		const postValues = { title: "{{title}} | Packed", description: "Packed summary of {{title}}", socialTitle: "Share: {{title}}", socialDescription: "" };
		const postPreview = await api("preview-admin-template", { collection: "posts", entryId: postId, locale: "en", values: postValues });
		assert.equal(postPreview.data.success, true, JSON.stringify(postPreview.data));
		const postSaved = await save("posts", postValues);
		assert.equal(postSaved.outcome, "saved");
		const reloaded = await api("admin-templates");
		assert.deepEqual(reloaded.data.items.find((item) => item.collection === "posts").values, postValues, "the saved values are read back");
		const postAfter = await servedTags("/posts/launch");
		assert.ok(matches(postAfter, postPreview.data.preview), `the served Post equals the prediction: ${JSON.stringify([postAfter, postPreview.data.preview])}`);
		assert.equal(postAfter.title, postBefore.title, "the document title stays the theme's");
		assert.deepEqual(await servedTags("/pages/about"), pageBefore, "saving Posts leaves the Page unchanged");
		evidence.steps.post = { path: "/posts/launch", before: postBefore, after: postAfter, predicted: postPreview.data.preview };

		const pageValues = { title: "{{title}} | Packed pages", description: "Pages: {{description}}", socialTitle: "Page: {{title}}", socialDescription: "" };
		const pagePreview = await api("preview-admin-template", { collection: "pages", entryId: pageId, locale: "en", values: pageValues });
		assert.equal(pagePreview.data.success, true, JSON.stringify(pagePreview.data));
		assert.equal(pagePreview.data.preview.description.source, "core-seo", "the entry's own SEO description wins");
		await save("pages", pageValues);
		const pageAfter = await servedTags("/pages/about");
		assert.ok(matches(pageAfter, pagePreview.data.preview), `the served Page equals the prediction: ${JSON.stringify([pageAfter, pagePreview.data.preview])}`);
		assert.equal(pageAfter.description, "The packed site's own about text");
		assert.equal(pageAfter.socialTitle, "Page: About the packed site");
		evidence.steps.page = { path: "/pages/about", before: pageBefore, after: pageAfter, predicted: pagePreview.data.preview };

		const loaded = await api("admin-templates");
		const postItem = loaded.data.items.find((item) => item.collection === "posts");
		const reset = await api("reset-admin-templates", { collection: "posts", expectedRevision: loaded.data.revision, inheritanceGuard: postItem.inheritanceGuard });
		assert.equal(reset.data.outcome, "saved", JSON.stringify(reset.data));
		assert.deepEqual(await servedTags("/posts/launch"), postBefore, "a deliberate reset restores the Post's inherited output");
		assert.equal((await servedTags("/pages/about")).socialTitle, "Page: About the packed site", "and keeps the Page's template");
		evidence.steps.reset = { collection: "posts", postRestored: true, pageKept: true };
	} finally {
		await stop();
	}
	mkdirSync(fileURLToPath(new URL("metadata-templates-review/", reviewRoot)), { recursive: true });
	writeFileSync(fileURLToPath(new URL("metadata-templates-review/packed-consumer.json", reviewRoot)), `${JSON.stringify(evidence, null, 2)}\n`);
}

// Publisher ownership through the packed production server: the served HTML of
// a published Post and Page with automatic output on and off, on the legacy
// settings path and the business identity path, with custom definitions of
// the publisher ID that must survive.
async function checkPackedPublisherOwnership() {
	const now = "2026-10-03T09:00:00.000Z";
	const raw = `ec_pat_${randomBytes(32).toString("base64url")}`;
	const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
	try {
		database.prepare("INSERT INTO _emdash_api_tokens (id, name, token_hash, prefix, user_id, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
			.run("packed-ownership-token", "Packed publisher ownership check", createHash("sha256").update(raw).digest("base64url"), raw.slice(0, 11), "packed-admin", JSON.stringify(["admin"]), now);
	} finally {
		database.close();
	}
	const clientFiles = readdirSync(join(workspace, "dist", "client"), { recursive: true }).map(String).filter((name) => name.endsWith(".js"));
	assert.ok(clientFiles.some((name) => readFileSync(join(workspace, "dist", "client", name), "utf8").includes("Publisher schema & Local SEO")),
		"the packed admin bundle contains the Feature controls publisher row");
	const { origin, stop } = await startProductionServer();
	const evidence = { origin: "loopback production server", tarball: packedTarball, steps: {} };
	try {
		const api = async (route, body, { token = raw } = {}) => {
			const response = await fetch(`${origin}/_emdash/api/plugins/shipit-seo/${route}`, {
				method: body === undefined ? "GET" : "POST",
				headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(20_000),
			});
			const text = await response.text();
			return { status: response.status, data: JSON.parse(text)?.data };
		};
		const served = async (path) => {
			const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
			assert.equal(response.status, 200, `${path} renders`);
			const head = (await response.text()).match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
			const graphs = [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
			return { graphs, json: JSON.stringify(graphs) };
		};
		const nodes = (value, found = []) => {
			if (Array.isArray(value)) value.forEach((item) => nodes(item, found));
			else if (value && typeof value === "object") {
				found.push(value);
				for (const [key, child] of Object.entries(value)) if (key !== "@context") nodes(child, found);
			}
			return found;
		};
		const definitionsOf = (page, id) => nodes(page.graphs).filter((node) => node["@id"] === id && Object.keys(node).some((key) => key !== "@id" && key !== "@context"));
		// EmDash core's own graphs carry no root @id (its BlogPosting names the site as an inline
		// publisher). Shipit's publisher links live in its WebSite, BlogPosting and Service presets;
		// custom graphs, such as the Post's Article copied from the library above, keep what was written.
		const coreGraphs = (page) => page.graphs.filter((graph) => !graph["@id"]);
		const linkingPresets = (page) => JSON.stringify(page.graphs.filter((graph) => graph["@id"] && ["WebSite", "BlogPosting", "Service"].includes(graph["@type"])));
		const authoredArticle = (page) => page.graphs.find((graph) => graph["@id"] === "https://www.example.com/#packed-article");
		const ORG = "https://www.example.com/#organization";
		const pages = { post: "/posts/launch", page: "/pages/about" };
		const snapshot = async () => ({ post: await served(pages.post), page: await served(pages.page) });

		assert.equal((await api("admin-publisher-ownership", {}, { token: null })).status, 401, "an anonymous caller is refused");
		const settings = await api("admin-settings");
		const savedSettings = await api("save-admin-settings", {
			siteName: "Packed Site", siteUrl: "https://www.example.com", publisherType: "organization", organizationName: "Packed Publisher BV",
			organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false,
			...(settings.data.revision === null ? { expectedRevision: null, expectedLegacyGuard: settings.data.legacyGuard } : { expectedRevision: settings.data.revision }),
		});
		assert.equal(savedSettings.data.success, true, JSON.stringify(savedSettings.data));

		// Legacy settings publisher, automatic output (no record).
		const absent = await api("admin-publisher-ownership", {});
		assert.deepEqual([absent.data.ownership.state, absent.data.ownership.effective], ["absent", "automatic"]);
		const legacy = await snapshot();
		for (const [label, page] of Object.entries(legacy)) {
			const definitions = definitionsOf(page, ORG);
			assert.equal(definitions.length, 1, `${label}: one publisher definition`);
			assert.equal(definitions[0].name, "Packed Publisher BV", `${label}: the legacy publisher keeps its own name, not the website name`);
		}
		evidence.steps.legacyAutomatic = { post: legacy.post.graphs, page: legacy.page.graphs };

		// Legacy path: a site-wide custom definition is kept and the automatic publisher is left off.
		const themeOrg = await api("save-admin-custom-schema", { id: "packed-theme-organization", expectedRevision: null, name: "Theme organization", scope: "global", enabled: true, json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "Theme Org BV", legalName: "Theme Org Holding BV" }) });
		assert.equal(themeOrg.data.success, true, JSON.stringify(themeOrg.data));
		const legacyCollision = await snapshot();
		for (const [label, page] of Object.entries(legacyCollision)) {
			const definitions = definitionsOf(page, "https://www.example.com//#organization").concat(definitionsOf(page, ORG));
			assert.equal(definitions.length, 1, `${label}: only the custom definition`);
			assert.equal(definitions[0].legalName, "Theme Org Holding BV", `${label}: the custom graph is served whole`);
			assert.ok(!page.json.includes("Packed Publisher BV"), `${label}: no generated publisher facts`);
		}
		evidence.steps.legacyCustomDefinition = { post: legacyCollision.post.graphs, page: legacyCollision.page.graphs };
		assert.equal((await api("delete-admin-custom-schema", { id: themeOrg.data.schema.id, expectedRevision: themeOrg.data.schema.revision })).data.success, true);
		assert.equal(JSON.stringify(await snapshot()), JSON.stringify(legacy), "removing it restores the legacy output exactly");

		// Automatic output off.
		const off = await api("save-admin-publisher-ownership", { mode: "none", expectedRevision: null });
		assert.equal(off.data.success, true, JSON.stringify(off.data));
		const legacyOff = await snapshot();
		for (const [label, page] of Object.entries(legacyOff)) {
			assert.equal(definitionsOf(page, ORG).length, 0, `${label}: no publisher definition while off`);
			assert.ok(!page.json.includes("Packed Publisher BV"), `${label}: no generated publisher facts while off`);
			assert.ok(!/"(publisher|provider)":/.test(linkingPresets(page)), `${label}: no Shipit publisher or provider link while off`);
			assert.equal(JSON.stringify(authoredArticle(page)), JSON.stringify(authoredArticle(legacy[label])), `${label}: an authored custom reference is left as written`);
			assert.equal(JSON.stringify(coreGraphs(page)), JSON.stringify(coreGraphs(legacy[label])), `${label}: EmDash's own graphs are unchanged by the setting`);
			assert.equal(page.json.includes("Packed Site"), legacy[label].json.includes("Packed Site"), `${label}: the website name output is kept`);
		}
		evidence.steps.legacyOff = { post: legacyOff.post.graphs, page: legacyOff.page.graphs, emdashCoreGraphs: { post: coreGraphs(legacyOff.post), page: coreGraphs(legacyOff.page) } };

		// Business identity saved while off: retained, not published; custom definitions allowed.
		const identity = await api("save-business-identity", { document: { kind: "Organization", name: "Packed Business BV", contactPoints: [], sameAs: [], areaServed: [], target: { kind: "home" } }, expectedRevision: null });
		assert.equal(identity.data.success, true, JSON.stringify(identity.data));
		const siteWide = await api("save-admin-custom-schema", { id: "packed-site-owner", expectedRevision: null, name: "Site owner", scope: "global", enabled: true, json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "Custom Owner BV" }) });
		assert.equal(siteWide.data.success, true, `allowed while off: ${JSON.stringify(siteWide.data)}`);
		const entryRef = { collection: "posts", entryId: "01KA0000000000000000000002", locale: "en" };
		const entryOwnerId = fixtureId("entry", "packedowner");
		const entryOwner = await api("save-entry-custom-schema", { ...entryRef, id: entryOwnerId, expectedRevision: null, name: "Post owner", enabled: true, json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": ORG, name: "Post Owner BV" }) });
		assert.equal(entryOwner.data.success, true, `allowed while off: ${JSON.stringify(entryOwner.data)}`);
		const businessOff = await snapshot();
		for (const [label, page] of Object.entries(businessOff)) {
			assert.ok(!page.json.includes("Packed Business BV") && !page.json.includes("Packed Publisher BV"), `${label}: saved identities are not published while off`);
		}
		assert.ok(businessOff.post.json.includes("Post Owner BV") && businessOff.page.json.includes("Custom Owner BV"), "custom definitions are served");
		evidence.steps.businessOffWithCustom = { post: businessOff.post.graphs, page: businessOff.page.graphs };

		// Returning to automatic output: the site-wide definition is refused, the per-entry one is not in scope.
		const offRevision = (await api("admin-publisher-ownership", {})).data.ownership.revision;
		const refused = await api("save-admin-publisher-ownership", { mode: "automatic", expectedRevision: offRevision });
		assert.equal(refused.data.error, "preflight", JSON.stringify(refused.data));
		assert.deepEqual(refused.data.preflight.definitions.map((item) => item.id), [siteWide.data.schema.id], "only site-wide schema is checked");
		assert.equal(JSON.stringify(await snapshot()), JSON.stringify(businessOff), "a refused return changes no page");
		evidence.steps.restoreRefused = { reason: refused.data.preflight.reason, definitions: refused.data.preflight.definitions, message: refused.data.message };
		assert.equal((await api("delete-admin-custom-schema", { id: siteWide.data.schema.id, expectedRevision: siteWide.data.schema.revision })).data.success, true);
		const restored = await api("save-admin-publisher-ownership", { mode: "automatic", expectedRevision: offRevision });
		assert.equal(restored.data.success, true, JSON.stringify(restored.data));
		const business = await snapshot();
		const pageDefinitions = definitionsOf(business.page, ORG);
		assert.deepEqual(pageDefinitions.map((node) => node.name), ["Packed Business BV"], "the Page carries the business publisher once");
		const postDefinitions = definitionsOf(business.post, ORG);
		assert.deepEqual(postDefinitions.map((node) => node.name), ["Post Owner BV"], "the Post keeps its own definition and gets no automatic publisher");
		assert.ok(!business.post.json.includes("Packed Business BV"), "no generated publisher facts on the collision page");
		evidence.steps.businessAutomatic = { post: business.post.graphs, page: business.page.graphs, preflight: restored.data.preflight };
	} finally {
		await stop();
	}
	mkdirSync(fileURLToPath(new URL("publisher-ownership-review/", reviewRoot)), { recursive: true });
	writeFileSync(fileURLToPath(new URL("publisher-ownership-review/packed-consumer.json", reviewRoot)), `${JSON.stringify(evidence, null, 2)}\n`);
}

// Released native targets paginate core sitemap files numerically. Exercise the packed
// production build with both runtime fallback paths, restarting after every
// ownership change so a cached runtime cannot conceal the persisted state.
async function checkPackedNativeSitemapFallback() {
	assert.ok(fullNativeConsumer);
	const now = "2026-10-11T09:00:00.000Z";
	const syntheticPosts = 2005;
	const raw = `ec_pat_${randomBytes(32).toString("base64url")}`;
	const moduleKey = "plugin:shipit-seo:configuration:modules:v1";
	const database = new DatabaseSync(join(workspace, "smoke.sqlite"));
	let expectedSecondPage;
	let indexablePosts;
	try {
		const state = database.prepare("SELECT status, source FROM _plugin_state WHERE plugin_id = ?").get("shipit-seo");
		assert.deepEqual({ ...state }, { status: "active", source: "config" }, "the genuine configured lifecycle recorded an active native plugin");
		database.exec("BEGIN");
		try {
			const insert = database.prepare("INSERT INTO ec_posts (id, slug, status, locale, title, published_at, created_at, updated_at, translation_group) VALUES (?, ?, 'published', 'en', ?, ?, ?, ?, ?)");
			for (let index = 1; index <= syntheticPosts; index += 1) {
				const id = `01KB${String(index).padStart(22, "0")}`;
				insert.run(id, `packed-sitemap-${index}`, `Packed sitemap Post ${index}`, now, now, now, id);
			}
			database.prepare("INSERT INTO _emdash_api_tokens (id, name, token_hash, prefix, user_id, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
				.run("packed-sitemap-token", "Packed sitemap fallback check", createHash("sha256").update(raw).digest("base64url"), raw.slice(0, 11), "packed-admin", JSON.stringify(["admin"]), now);
			database.exec("COMMIT");
		} catch (error) {
			database.exec("ROLLBACK");
			throw error;
		}
		const rows = database.prepare(`SELECT c.slug FROM ec_posts c
			LEFT JOIN _emdash_seo s ON s.collection = 'posts' AND s.content_id = c.id
			WHERE c.status = 'published' AND c.deleted_at IS NULL AND c.slug IS NOT NULL AND TRIM(c.slug) <> ''
			AND (s.seo_no_index IS NULL OR s.seo_no_index = 0) ORDER BY c.id`).all();
		indexablePosts = rows.length;
		assert.equal(indexablePosts, syntheticPosts + 1, "the launch Post is indexable and the private Post is excluded");
		expectedSecondPage = rows.slice(2000, 4000).map(({ slug }) => `/posts/${slug}`);
		assert.equal(expectedSecondPage.length, 6, "the released core's second page has the remaining six Posts");
	} finally {
		database.close();
	}
	const evidence = {
		schemaVersion: 1, target: environment.target.name, emdash: environment.target.versions.get("emdash"),
		origin: "loopback production server", tarball: packedTarball,
		syntheticPosts, indexablePosts, corePageSize: 2000, states: {},
	};
	const locations = (body) => [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
	const api = async (origin, route, body, token = raw) => {
		const response = await fetch(`${origin}/_emdash/api/plugins/shipit-seo/${route}`, {
			method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20_000),
		});
		const text = await response.text();
		assert.ok(Buffer.byteLength(text) <= 65_536, "the module response stays within 64 KiB");
		return { status: response.status, ...JSON.parse(text) };
	};
	const loadModuleRecord = async (origin) => {
		const loaded = await api(origin, "admin-configuration", {});
		assert.deepEqual([loaded.status, loaded.success], [200, true]);
		const sitemap = loaded.data.modules.items.find((item) => item.key === "sitemap");
		assert.deepEqual([sitemap.editable, sitemap.capability], [true, "native-sitemap"]);
		return { values: Object.fromEntries(loaded.data.modules.items.map(({ key, enabled }) => [key, enabled])), revision: loaded.data.modules.revision };
	};
	const loadModules = async (origin) => (await loadModuleRecord(origin)).values;
	const saveSitemapModule = async (origin, enabled) => {
		const loaded = await loadModuleRecord(origin);
		const values = { ...loaded.values, sitemap: enabled };
		const saved = await api(origin, "save-admin-modules", { ...values, expectedRevision: loaded.revision });
		assert.deepEqual([saved.status, saved.success, saved.data.success], [200, true, true], JSON.stringify(saved));
		assert.equal(saved.data.modules.items.find((item) => item.key === "sitemap").enabled, enabled);
		assert.deepEqual(await loadModules(origin), values, "authenticated readback retains all module choices");
	};
	const readModulesRecord = () => {
		const saved = new DatabaseSync(join(workspace, "smoke.sqlite"));
		try {
			const row = saved.prepare("SELECT value, revision FROM options WHERE name = ?").get(moduleKey);
			assert.ok(row && typeof row.revision === "string");
			return { ...row };
		} finally { saved.close(); }
	};
	const checkCore = async (origin) => {
		const results = {};
		for (const path of ["/sitemap.xml", "/sitemap-posts-2.xml"]) {
			let getHeaders;
			for (const method of ["GET", "HEAD"]) {
				const response = await fetch(`${origin}${path}`, { method, redirect: "manual", signal: AbortSignal.timeout(20_000) });
				const body = await response.text();
				const headers = { contentType: response.headers.get("content-type"), cacheControl: response.headers.get("cache-control") };
				assert.equal(response.status, 200, `${method} ${path}: core fallback succeeds`);
				assert.deepEqual(headers, { contentType: "application/xml; charset=utf-8", cacheControl: "public, max-age=3600" }, `${method} ${path}: released core owns the response`);
				if (method === "HEAD") {
					assert.equal(body, "", `HEAD ${path} sends no body`);
					assert.deepEqual(headers, getHeaders);
				} else {
					getHeaders = headers;
					const urls = locations(body);
					if (path === "/sitemap.xml") {
						assert.match(body, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
						assert.deepEqual(urls.map((url) => new URL(url).pathname).sort(), ["/sitemap-pages.xml", "/sitemap-posts-2.xml", "/sitemap-posts.xml"]);
						assert.ok(urls.every((url) => new URL(url).search === ""), "core uses numeric child files without plugin cursors");
					} else {
						assert.match(body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
						assert.deepEqual(urls.map((url) => new URL(url).pathname), expectedSecondPage, "the second core page contains exactly the remaining indexable Posts");
						assert.equal(body.includes("/posts/private-note"), false);
					}
					results[path] = { status: response.status, ...headers, bytes: Buffer.byteLength(body), locations: urls };
				}
			}
			results[path].head = { status: 200, bodyBytes: 0, headersMatch: true };
		}
		for (const method of ["GET", "HEAD"]) {
			const response = await fetch(`${origin}/sitemap-posts-1.xml`, { method, redirect: "manual", signal: AbortSignal.timeout(10_000) });
			const body = await response.text();
			assert.equal(response.status, 404, `${method}: the invalid numeric first-page name is refused`);
			if (method === "HEAD") assert.equal(body, "");
			results[`invalid${method}`] = { status: response.status, cacheControl: response.headers.get("cache-control"), bytes: Buffer.byteLength(body) };
		}
		return results;
	};
	const active = await startProductionServer();
	try {
		assert.equal(active.pluginResponse.status, 200);
		assert.equal((await loadModules(active.origin)).sitemap, true);
		const index = await fetch(`${active.origin}/sitemap.xml`, { signal: AbortSignal.timeout(20_000) });
		assert.deepEqual([index.status, index.headers.get("cache-control")], [200, "public, max-age=300"], "the enabled plugin owns the index");
		const files = locations(await index.text());
		assert.ok(files.some((file) => new URL(file).pathname === "/sitemap-posts.xml" && new URL(file).searchParams.has("after")), "the enabled plugin lists its cursor continuation files");
		evidence.states.pluginOn = { status: index.status, cacheControl: index.headers.get("cache-control"), files };
		const modules = await loadModules(active.origin);
		assert.equal((await api(active.origin, "save-admin-modules", { ...modules, sitemap: false }, null)).status, 401, "anonymous callers cannot change module ownership");
		await saveSitemapModule(active.origin, false);
	} finally { await active.stop(); }
	const disabledModule = readModulesRecord();
	assert.equal(JSON.parse(disabledModule.value).values.sitemap, false);
	const moduleOff = await startProductionServer();
	try {
		assert.equal(moduleOff.pluginResponse.status, 200, "the plugin stays active when only its sitemap module is off");
		assert.equal((await loadModules(moduleOff.origin)).sitemap, false, "a fresh production runtime retains the off choice");
		assert.deepEqual(readModulesRecord(), disabledModule, "restart does not reseed the saved module snapshot");
		evidence.states.moduleOff = await checkCore(moduleOff.origin);
		await saveSitemapModule(moduleOff.origin, true);
	} finally { await moduleOff.stop(); }
	const restoredModule = readModulesRecord();
	assert.equal(JSON.parse(restoredModule.value).values.sitemap, true, "deactivation is tested independently with the sitemap module on");
	const deactivated = new DatabaseSync(join(workspace, "smoke.sqlite"));
	try {
		assert.equal(deactivated.prepare("UPDATE _plugin_state SET status = 'inactive', deactivated_at = ? WHERE plugin_id = ? AND status = 'active'").run(now, "shipit-seo").changes, 1, "the real configured plugin state is deactivated while the server is stopped");
	} finally { deactivated.close(); }
	const pluginOff = await startProductionServer();
	try {
		assert.equal(pluginOff.pluginResponse.status, 404, "the inactive plugin has no public routes in the restarted runtime");
		for (const method of ["GET", "HEAD"]) {
			const keyFile = await fetch(`${pluginOff.origin}/indexnow-key.txt`, { method, signal: AbortSignal.timeout(10_000) });
			assert.equal(keyFile.status, 404, "the packed key adapter preserves the public dispatcher inactive-plugin refusal");
			assert.equal(await keyFile.text(), method === "HEAD" ? "" : "Not found");
		}
		assert.deepEqual(readModulesRecord(), restoredModule, "deactivation retains the saved on choice and its revision");
		evidence.states.pluginInactive = await checkCore(pluginOff.origin);
	} finally { await pluginOff.stop(); }
	const stateCheck = new DatabaseSync(join(workspace, "smoke.sqlite"));
	try {
		assert.equal(stateCheck.prepare("SELECT status FROM _plugin_state WHERE plugin_id = ?").get("shipit-seo").status, "inactive", "reboot preserves the disabled core state");
	} finally { stateCheck.close(); }
	writeNativeReceipt("sitemap-fallback/packed-consumer.json", evidence);
	console.log(`Packed EmDash ${environment.target.versions.get("emdash")} sitemap fallback passed authenticated module-off and inactive-plugin restarts, numeric core pagination, GET/HEAD and invalid first-page names.`);
}

function writeNativeReceipt(relativePath, value) {
	assert.ok(fullNativeConsumer);
	const contents = `${JSON.stringify(value, null, 2)}\n`;
	assert.ok(Buffer.byteLength(contents) <= 65_536, "the native receipt stays within 64 KiB");
	const destination = fileURLToPath(new URL(relativePath, environment.target.outputRoot));
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, contents);
}

function retainNativeCandidate(tarball) {
	assert.ok(fullNativeConsumer);
	const destination = fileURLToPath(new URL(`package-candidate/${packedTarball.file}`, environment.target.outputRoot));
	mkdirSync(dirname(destination), { recursive: true });
	cpSync(tarball, destination);
	const retained = readFileSync(destination);
	assert.equal(retained.byteLength, packedTarball.bytes);
	assert.equal(createHash("sha256").update(retained).digest("hex"), packedTarball.sha256, "the retained candidate is the artifact that passed every packed check");
	writeNativeReceipt("package-candidate/receipt.json", {
		schemaVersion: 1, target: environment.target.name, emdash: environment.target.versions.get("emdash"),
		status: "packed-consumer-verified", tarball: packedTarball,
		sitemapReceipt: "sitemap-fallback/packed-consumer.json",
	});
}

try {
	writeFileSync(join(workspace, "package.json"), JSON.stringify({
		name: "shipit-seo-packed-smoke", private: true, type: "module",
		packageManager: hostManifest.packageManager,
	}, null, 2));
	const packageManager = spawnSync("pnpm", ["--version"], {
		cwd: workspace, env: packedEnvironment, encoding: "utf8", timeout: 15_000, maxBuffer: 16_384,
	});
	assert.equal(packageManager.status, 0, packageManager.stderr);
	assert.equal(packageManager.stdout.trim(), packageManagerVersion, "Packed consumer must use the pinned pnpm version");
	const packedDirectory = join(workspace, "packed");
	mkdirSync(packedDirectory);
	// dist is built by the verification step from the host graph; packing must
	// not run prepack, which would rebuild it with a package install that a
	// checkout set up with only that graph does not have.
	if (existingArtifact) cpSync(existingArtifact, join(packedDirectory, basename(existingArtifact)));
	else run("pnpm", ["--config.ignore-scripts=true", "--dir", sourcePackage, "pack", "--pack-destination", packedDirectory], workspace);
	const tarballs = readdirSync(packedDirectory).filter((file) => file.endsWith(".tgz"));
	if (tarballs.length !== 1) throw new Error("Expected one packed SEO artifact");
	const tarballBytes = readFileSync(join(packedDirectory, tarballs[0]));
	packedTarball = { file: tarballs[0], bytes: tarballBytes.byteLength, sha256: createHash("sha256").update(tarballBytes).digest("hex") };
	console.log(`Packed artifact ${packedTarball.file}: ${packedTarball.bytes} bytes, sha256 ${packedTarball.sha256}`);
	mkdirSync(packageDirectory, { recursive: true });
	run("tar", ["-xzf", join(packedDirectory, tarballs[0]), "-C", packageDirectory, "--strip-components=1"], workspace);

	const manifest = assertPackedArtifact(packageDirectory);
	if (manifest.name !== packageName || manifest.dependencies?.["@shipit/emdash-plugin-seo-admin"] ||
		manifest.peerDependencies?.["@shipit/emdash-plugin-seo-admin"])
		throw new Error("Packed SEO artifact still depends on the legacy companion");
	if (existsSync(join(packageDirectory, "src")))
		throw new Error("Packed SEO artifact includes source files");
	if (manifest.main !== "./dist/index.js")
		throw new Error("Packed SEO main entry does not use dist");
	for (const [subpath, entry] of Object.entries(manifest.exports)) {
		for (const condition of ["types", "default"]) {
			const path = entry[condition];
			if (typeof path !== "string" || !path.startsWith("./dist/") || !existsSync(join(packageDirectory, path)))
				throw new Error(`Packed SEO ${subpath} ${condition} entry is missing from dist: ${path}`);
		}
	}
	assert.match(readFileSync(join(packageDirectory, manifest.exports["./admin"].default), "utf8"),
		/import "\.\/admin\.css";/);
	assert.ok(existsSync(join(packageDirectory, "dist/admin-ui/admin.css")), "Packed admin styles are missing");
	for (const subpath of ["indexnow-integration", "indexnow-route"]) {
		const resolved = spawnSync(process.execPath, ["-p", `require.resolve("${packageName}/${subpath}")`], {
			cwd: workspace, env: packedEnvironment, encoding: "utf8",
		});
		assert.equal(resolved.status, 0, resolved.stderr);
		assert.equal(realpathSync(resolved.stdout.trim()), realpathSync(join(packageDirectory, manifest.exports[`./${subpath}`].default)));
	}

	const coreManifest = JSON.parse(readFileSync(new URL("package.json", environment.hostPackageRoot("emdash")), "utf8"));
	const hostNames = new Set([
		...Object.keys(hostManifest.dependencies),
		...Object.keys(hostManifest.devDependencies),
		...Object.keys(coreManifest.dependencies),
	]);
	if (nativeConsumer) {
		rmSync(join(workspace, "node_modules"), { recursive: true });
		writeFileSync(join(workspace, "package.json"), JSON.stringify({
			name: "shipit-seo-packed-native-consumer",
			private: true,
			type: "module",
			packageManager: hostManifest.packageManager,
			engines: hostManifest.engines,
			dependencies: {
				...(npmConsumer ? Object.fromEntries([
					"emdash", "@emdash-cms/admin", "astro", "@astrojs/node", "@astrojs/react", "react", "react-dom", "kysely",
					"@cloudflare/kumo", "@phosphor-icons/react", "@tanstack/react-query",
				].map((name) => [name, hostManifest.dependencies[name]])) : hostManifest.dependencies),
				[packageName]: `file:${join(packedDirectory, tarballs[0])}`,
			},
			devDependencies: {
				"@types/react": hostManifest.devDependencies["@types/react"],
				"@types/react-dom": hostManifest.devDependencies["@types/react-dom"],
			},
		}, null, 2));
		if (npmConsumer) {
			// npm resolves the plugin's own peers without borrowing the host lock
			// or pnpm's graph. Install scripts are not needed by this plugin.
			const userConfig = join(workspace, "npm-userconfig");
			const globalConfig = join(workspace, "npm-globalconfig");
			writeFileSync(userConfig, "");
			writeFileSync(globalConfig, "");
			const offlineCache = process.env.SHIPIT_NPM_OFFLINE_CACHE ?? "";
			if (!offlineCache || !existsSync(offlineCache)) throw new Error("The npm consumer needs SHIPIT_NPM_OFFLINE_CACHE; verification does not use the registry.");
			cpSync(offlineCache, join(workspace, "npm-cache"), { recursive: true });
			run("npm", [
				"install", "--ignore-scripts", "--offline", "--strict-peer-deps", "--no-audit", "--no-fund", "--no-update-notifier",
				"--registry=https://registry.npmjs.org/", "--cache=" + join(workspace, "npm-cache"),
				"--userconfig=" + userConfig, "--globalconfig=" + globalConfig,
			], workspace);
		} else {
			cpSync(fileURLToPath(new URL("pnpm-lock.yaml", environment.hostRoot)), join(workspace, "pnpm-lock.yaml"));
			cpSync(fileURLToPath(new URL("pnpm-workspace.yaml", environment.hostRoot)), join(workspace, "pnpm-workspace.yaml"));
			// The host graph's own store, which an offline install needs whatever TMPDIR or HOME point at.
			const modules = readFileSync(fileURLToPath(new URL("node_modules/.modules.yaml", environment.hostRoot)), "utf8");
			const store = modules.match(/(?:"storeDir"\s*:\s*"([^"\n]+)"|^storeDir:\s*([^\n]+))/m);
			if (!store) throw new Error("The host graph does not record its pnpm store");
			run("pnpm", ["install", "--offline", "--config.trust-lockfile=true", "--no-frozen-lockfile", "--ignore-scripts", "--strict-peer-dependencies",
				"--store-dir=" + (store[1] ?? store[2]).trim()], workspace);
		}
		const resolved = spawnSync(process.execPath, ["-p", `require.resolve("${packageName}")`], {
			cwd: workspace, env: packedEnvironment, encoding: "utf8",
		});
		assert.equal(resolved.status, 0, resolved.stderr);
		assert.equal(realpathSync(resolved.stdout.trim()), realpathSync(join(packageDirectory, "dist/index.js")));
		for (const name of ["emdash", "@emdash-cms/admin", "astro"]) {
			const installed = JSON.parse(readFileSync(join(workspace, "node_modules", name, "package.json"), "utf8"));
			assert.equal(installed.version, environment.target.versions.get(name), `Packed consumer must use selected ${name}`);
		}
	} else for (const name of hostNames) {
		const destination = join(workspace, "node_modules", name);
		mkdirSync(dirname(destination), { recursive: true });
		const source = realpathSync(fileURLToPath(environment.hostPackageRoot(name)));
		if (name === "emdash") cpSync(source, destination, { recursive: true });
		else symlinkSync(source, destination);
	}
	const consumerSource = nativeConsumer ? new URL(environment.target.consumerSource, environment.hostRoot) :
		new URL("integration/emdash/published-host/src/", sourceRoot);
	cpSync(fileURLToPath(consumerSource), join(workspace, "src"), { recursive: true });
	if (nativeConsumer) {
		const postPage = join(workspace, "src/pages/posts/[slug].astro");
		const source = readFileSync(postPage, "utf8");
		const requestCanonical = "canonical: new URL(Astro.url.pathname, Astro.url.origin).href,";
		assert.equal(source.split(requestCanonical).length, 2, "the copied Post fixture has one request-origin canonical");
		// This registered-route fixture serves its configured public authority.
		writeFileSync(postPage, source.replace(requestCanonical, "canonical: new URL(Astro.url.pathname, Astro.site).href,"));
	}
	if (!nativeConsumer) {
		writeFileSync(join(workspace, "package.json"), JSON.stringify({ private: true, type: "module", name: "shipit-seo-packed-smoke" }));
	}
	writeFileSync(join(workspace, "astro.config.mjs"), `
import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";
${nativeConsumer ? `import { shipitSeo } from "@shipitseo/emdash-plugin-seo/astro";` : `import { seoPlugin } from "@shipitseo/emdash-plugin-seo";
import { seoIndexNow } from "@shipitseo/emdash-plugin-seo/indexnow-integration";
import { viteAliases } from ${JSON.stringify(new URL("vite-aliases.mjs", import.meta.url).href)};
import { createEnvironment } from ${JSON.stringify(new URL("environment.mjs", import.meta.url).href)};`}

export default defineConfig({
  site: ${nativeConsumer ? '"https://www.example.com"' : '"http://127.0.0.1:4369"'},
  output: "server",
  devToolbar: { enabled: false },
  adapter: node({ mode: "standalone" }),
  integrations: ${nativeConsumer
    ? `[react(), shipitSeo(emdash, { database: sqlite({ url: "file:./smoke.sqlite" }) })]`
    : `[react(), seoIndexNow(), emdash({
    database: sqlite({ url: "file:./smoke.sqlite" }),
    plugins: [seoPlugin()],
  })]`},
  vite: {
    resolve: { alias: ${nativeConsumer ? "[]" : 'viteAliases(createEnvironment(), { canonical: false, exclude: ["emdash"] })'}, dedupe: ["react", "react-dom", "@tanstack/react-query"] },
    ssr: { noExternal: ["@shipitseo/emdash-plugin-seo"] },
    server: { fs: { allow: ${JSON.stringify(nativeConsumer ? [workspace] : [workspace, fileURLToPath(environment.hostRoot)])} } },
  },
});
`);
	if (nativeConsumer) {
		// The packed entry point binds a public site through the consumer's own
		// EmDash integration; the generated plugin module carries the options.
		writeFileSync(join(workspace, "entry-check.mjs"), `
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import emdash from "emdash/astro";
import { shipitSeo } from "@shipitseo/emdash-plugin-seo/astro";

const integration = shipitSeo(emdash, { plugins: [] });
const updates = [];
const injected = [];
const middleware = [];
const root = new URL("./", import.meta.url);
const config = {
  root, base: "/", site: "https://www.example.com", trailingSlash: "ignore", security: {}, image: {},
  srcDir: new URL("src/", root), publicDir: new URL("public/", root), integrations: [integration],
};
await integration.hooks["astro:config:setup"]({
  config, command: "build", isRestart: false,
  injectRoute: (route) => injected.push(route), addMiddleware: (entry) => middleware.push(entry),
  updateConfig: (update) => { updates.push(update); return config; },
  logger: { warn: () => undefined, info: () => undefined, debug: () => undefined, error: () => undefined },
});
const plugin = updates.flatMap((update) => update.vite?.plugins ?? []).flat().find((item) => item?.name === "emdash-virtual-modules");
const code = String(await plugin.load(plugin.resolveId("virtual:emdash/plugins")));
assert.ok(code.includes('{"siteUrl":"https://www.example.com","installation":{"siteOrigin":"https://www.example.com","siteIssue":null,"keyRoute":"injected","sitemap":{"owner":"shipit","detail":null,"routing":{"trailingSlash":"ignore","i18n":null}},"robots":{"owner":"unsettled","detail":"Resolved routes were not recorded","hostVersion":"${environment.target.versions.get("emdash")}","emdashSiteUrl":null},"llmsTxt":{"owner":"unsettled","detail":"Resolved routes were not recorded","hostVersion":"${environment.target.versions.get("emdash")}"},"configuredPlugins":[]}}'),
  "before routes resolve, robots.txt and llms.txt ownership is unsettled");
const sitemapEntry = realpathSync(fileURLToPath(new URL("node_modules/@shipitseo/emdash-plugin-seo/dist/sitemap-middleware-entry.js", root)));
const isSitemapMiddleware = (entry) => entry.entrypoint instanceof URL && realpathSync(fileURLToPath(entry.entrypoint)) === sitemapEntry;
const llmsEntry = realpathSync(fileURLToPath(new URL("node_modules/@shipitseo/emdash-plugin-seo/dist/llms-txt-middleware-entry.js", root)));
const isLlmsMiddleware = (entry) => entry.entrypoint instanceof URL && realpathSync(fileURLToPath(entry.entrypoint)) === llmsEntry;
assert.equal(middleware.filter(isSitemapMiddleware).length, 1, "the packed entry point adds the sitemap middleware once");
assert.equal(middleware.filter(isLlmsMiddleware).length, 1, "the packed entry point adds the llms.txt middleware once");
const coexistenceEntry = realpathSync(fileURLToPath(new URL("node_modules/@shipitseo/emdash-plugin-seo/dist/plugin-coexistence-middleware-entry.js", root)));
const isCoexistenceMiddleware = (entry) => entry.entrypoint instanceof URL && realpathSync(fileURLToPath(entry.entrypoint)) === coexistenceEntry;
assert.equal(middleware.filter(isCoexistenceMiddleware).length, ${environment.target.versions.get("emdash") === "1.3.0" ? 1 : 0});
if (${environment.target.versions.get("emdash") === "1.3.0"}) {
  assert.ok(middleware.findIndex(isCoexistenceMiddleware) > 0, "metadata finalization follows EmDash initialization");
  assert.ok(middleware.findIndex(isCoexistenceMiddleware) < middleware.findIndex(isSitemapMiddleware));
}
assert.ok(middleware.findIndex(isSitemapMiddleware) > 0, "the sitemap middleware follows EmDash's own middleware");
assert.ok(isLlmsMiddleware(middleware.at(-1)), "the llms.txt middleware follows EmDash's and the sitemap middleware");
assert.ok(middleware.every((entry) => entry.order === "pre"));
const route = injected.find((item) => item.pattern === "/indexnow-key.txt");
assert.ok(route, "the packed entry point injects the key route once");
assert.equal(injected.filter((item) => item.pattern === "/indexnow-key.txt").length, 1);
assert.equal(realpathSync(fileURLToPath(route.entrypoint)), realpathSync(fileURLToPath(new URL("node_modules/@shipitseo/emdash-plugin-seo/dist/indexnow-route.js", root))));
console.log("Packed shipitSeo() bound https://www.example.com through EmDash ${environment.target.versions.get("emdash")}.");
`);
		run(process.execPath, [join(workspace, "entry-check.mjs")], workspace);
	}
	const astroRoot = nativeConsumer ? pathToFileURL(`${join(workspace, "node_modules/astro")}/`) : environment.hostPackageRoot("astro");
	const astroManifest = JSON.parse(readFileSync(new URL("package.json", astroRoot), "utf8"));
	const astroCli = fileURLToPath(new URL(astroManifest.bin.astro, astroRoot));
	run("/usr/bin/time", ["-p", process.execPath, astroCli, "build"], workspace);
	assert.ok(hasAdminStyles(join(workspace, "dist", "client")), "Packed admin CSS was not bundled into the client build");
	if (nativeConsumer) {
		// Plugin options are serialized after Astro resolved the routes, which name EmDash's robots route.
		const serverDir = join(workspace, "dist", "server");
		const settled = /["']?robots["']?\s*:\s*\{\s*["']?owner["']?\s*:\s*["']emdash-core["']/;
		const bound = readdirSync(serverDir, { recursive: true }).map(String).filter((name) => name.endsWith(".mjs"))
			.some((name) => settled.test(readFileSync(join(serverDir, name), "utf8")));
		assert.ok(bound, "the production build records EmDash core as the owner of /robots.txt");
		// No page, file, integration or route answers /llms.txt in the clean consumer.
		const llmsSettled = /["']?llmsTxt["']?\s*:\s*\{\s*["']?owner["']?\s*:\s*["']shipit["']/;
		const llmsBound = readdirSync(serverDir, { recursive: true }).map(String).filter((name) => name.endsWith(".mjs"))
			.some((name) => llmsSettled.test(readFileSync(join(serverDir, name), "utf8")));
		assert.ok(llmsBound, "the production build records Shipit SEO as the owner of /llms.txt");
	}
	await checkProductionPublicRoutes();
	if (nativeConsumer) await checkPackedIndexingDefaults();
	if (nativeConsumer) await checkPackedSchemaLibrary();
	if (nativeConsumer) await checkPackedRedirectEdit();
	if (nativeConsumer) await checkPackedMetadataTemplates();
	if (nativeConsumer) await checkPackedPublisherOwnership();
	if (fullNativeConsumer) await checkPackedNativeSitemapFallback();
	if (indexNowDeadlineSmoke) run(process.execPath, [
		fileURLToPath(new URL("indexnow-deadline-smoke.mjs", import.meta.url)), workspace,
		fileURLToPath(new URL("indexnow-deadline/packed-consumer.json", environment.target.outputRoot)),
		JSON.stringify(packedTarball),
	], workspace);
	const size = spawnSync("du", ["-sk", join(workspace, "dist")], { encoding: "utf8" });
	if (size.status === 0) console.log(`Packed build size: ${size.stdout.trim()}`);
	const evidenceTarget = nativeConsumer ? environment.target.name : environment.target.name === "published-1.0.1" ? "default" : null;
	if (evidenceTarget) recordPackedVerification(fileURLToPath(sourceRoot), evidenceTarget, packedTarball);
	if (fullNativeConsumer) retainNativeCandidate(join(packedDirectory, tarballs[0]));
	console.log(`Packed single SEO plugin passed Astro SSR, rendered metadata, admin bundling and the unconfigured IndexNow route${nativeConsumer ? " through shipitSeo()" : ""}.`);
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
