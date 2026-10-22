// Build and render the explicit taxonomy archive templates on released native
// EmDash with a disposable SQLite file and the existing pinned dependency graph.
// The same build renders an entry whose content type has a noindex rule.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createEnvironment, readManifest, reviewOutputRoot, seoPackageRoot } from "./environment.mjs";

const PACKAGE = "@shipitseo/emdash-plugin-seo";
const SITE = "https://example.com";
const BUDGET = 65_536;
const GLOBAL_ROW = "plugin:shipit-seo:settings:global:v1";
const environment = createEnvironment();
const sha = (value) => createHash("sha256").update(value).digest("hex");
const inside = (root, path) => { const part = relative(root, path); return part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith("../"); };
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function processIdentity(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
		assert.ok(fields.length >= 20 && /^\d+$/.test(fields[19]), "Readable Linux process identity is required");
		return { pid, state: fields[0], parent: Number(fields[1]), group: Number(fields[2]), session: Number(fields[3]), startTicks: fields[19] };
	} catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return null; throw error; }
}
function fileTreeHash(root) {
	const files = [];
	const visit = (directory, prefix = "") => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const name = prefix + entry.name;
			if (entry.isDirectory()) visit(join(directory, entry.name), name + "/");
			else { assert.ok(entry.isFile(), "Compiled output contains only regular files"); files.push([name, sha(readFileSync(join(directory, entry.name)))]); }
		}
	};
	visit(root);
	return sha(JSON.stringify(files));
}
function publicRobots(html) {
	const head = html.match(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i)?.[1];
	assert.ok(head, "The production response contains a head");
	const tags = [...head.matchAll(/<meta\b[^>]*>/gi)].map((match) => {
		const attributes = Object.fromEntries([...match[0].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((item) => [item[1].toLowerCase(), item[2]]));
		return attributes.name?.toLowerCase() === "robots" ? attributes.content ?? "" : null;
	}).filter((value) => value !== null);
	assert.ok(tags.length <= 1, "EmDashHead renders at most one robots meta tag");
	return tags.flatMap((value) => value.split(",").map((token) => token.trim().toLowerCase()).filter(Boolean));
}
function retainedRows(database) {
	const db = new DatabaseSync(database, { readOnly: true });
	try {
		const tables = ["ec_posts", "_emdash_seo", "taxonomies", "content_taxonomies", "_emdash_taxonomy_defs", "_emdash_taxonomy_def_groups"];
		return Object.fromEntries(tables.map((table) => {
			const rows = db.prepare(`SELECT * FROM ${table}`).all().map((row) => ({ ...row })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
			return [table, sha(JSON.stringify(rows))];
		}));
	} finally { db.close(); }
}

async function seedDisposableDatabase(database) {
	const { hostPackageRoot } = await import("./host-loader.mjs");
	const host = hostPackageRoot("emdash");
	async function hostDistExport(name) {
		const dist = new URL("dist/", host);
		for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
			const alias = readFileSync(new URL(file, dist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
			if (alias) return (await import(new URL(file, dist).href))[alias];
		}
		throw new Error(`Released ${name} export was not found`);
	}
	const { Kysely } = await import("kysely");
	const { createDialect } = await import("emdash/db/sqlite");
	const { runMigrations } = await import("emdash/db");
	const SchemaRegistry = await hostDistExport("SchemaRegistry");
	const ContentRepository = await hostDistExport("ContentRepository");
	const TaxonomyRepository = await hostDistExport("TaxonomyRepository");
	const db = new Kysely({ dialect: createDialect({ url: `file:${database}` }) });
	try {
		await runMigrations(db);
		const schema = new SchemaRegistry(db);
		await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" });
		await schema.createField("posts", { slug: "title", label: "Title", type: "string" });
		await schema.createField("posts", { slug: "excerpt", label: "Excerpt", type: "string" });
		const content = new ContentRepository(db);
		const post = await content.create({ type: "posts", slug: "assigned-guide", status: "published", locale: "en", data: { title: "Assigned guide", excerpt: "A published post assigned to both archive terms." } });
		const privatePost = await content.create({ type: "posts", slug: "core-noindex-guide", status: "published", locale: "en", data: { title: "Core noindex guide", excerpt: "Its own core indexing choice remains authoritative." } });
		await db.insertInto("_emdash_seo").values([
			{ collection: "posts", content_id: post.id, seo_no_index: 0 },
			{ collection: "posts", content_id: privatePost.id, seo_no_index: 1 },
		]).onConflict((conflict) => conflict.columns(["collection", "content_id"]).doUpdateSet((expression) => ({ seo_no_index: expression.ref("excluded.seo_no_index") }))).execute();
		const group = "archive-region-definition";
		await db.insertInto("_emdash_taxonomy_def_groups").values({ id: group, name: "region", hierarchical: 0, collections: '["posts"]' }).execute();
		await db.insertInto("_emdash_taxonomy_defs").values({ id: "archive-region-en", name: "region", label: "Regions", label_singular: "Region", locale: "en", translation_group: group, hierarchical: 0, collections: '["posts"]' }).execute();
		const taxonomy = new TaxonomyRepository(db);
		const terms = [];
		for (const [name, slug, label] of [["category", "bread", "Bread collection"], ["region", "north", "Northern practice area"]]) {
			const term = await taxonomy.create({ name, slug, label, locale: "en", data: { description: `Archive for ${label}.` } });
			assert.equal(term.name, name); assert.equal(term.label, label); assert.notEqual(term.name, term.label);
			await taxonomy.setTermsForEntry("posts", post.id, name, [term.id]);
			terms.push({ taxonomy: name, slug, label });
		}
		const assigned = await taxonomy.getTermsForEntry("posts", post.id, undefined, "en");
		assert.deepEqual(assigned.map((term) => term.name).sort(), ["category", "region"], "The published control entry is really assigned to both archives");
		await db.insertInto("options").values({ name: "emdash:site_url", value: JSON.stringify(SITE), revision: "archive-site-url" }).onConflict((conflict) => conflict.column("name").doUpdateSet({ value: JSON.stringify(SITE), revision: "archive-site-url" })).execute();
		return { terms, assignedPost: post.id, coreNoindexPost: privatePost.id };
	} finally { await db.destroy(); }
}

async function main() {
	assert.equal(process.platform, "linux", "Run the isolated native smoke in WSL2 or Linux");
	assert.equal(environment.target.name, "native-1.3.0", "This HTML fixture requires the released native1.3 target");
	assert.equal(process.versions.node, "24.19.0");
	assert.deepEqual(process.argv.slice(2), [], "Select native1.3 through SHIPIT_HOST_TARGET; this smoke accepts no path overrides");
	environment.assertVersions();
	const hostManifest = readManifest(environment.hostRoot);
	const coreManifest = readManifest(environment.hostPackageRoot("emdash"));
	const sourcePackage = fileURLToPath(seoPackageRoot);
	const sourceManifest = readFileSync(join(sourcePackage, "package.json"));
	const packageManifest = JSON.parse(sourceManifest.toString("utf8"));
	assert.equal(packageManifest.name, PACKAGE);
	assert.ok(packageManifest.exports?.["./taxonomy-archives"], "Build the package with its taxonomy archive export first");
	for (const entry of Object.values(packageManifest.exports)) for (const condition of ["default", "types"]) {
		assert.ok(typeof entry[condition] === "string" && entry[condition].startsWith("./dist/") && existsSync(join(sourcePackage, entry[condition])), "Full compiled package output is a prerequisite");
	}
	const lock = fileURLToPath(new URL("pnpm-lock.yaml", environment.hostRoot));
	const frozen = { lock: sha(readFileSync(lock)), manifest: sha(readFileSync(new URL("package.json", environment.hostRoot))),
		packageManifest: sha(sourceManifest), packageDist: fileTreeHash(join(sourcePackage, "dist")) };
	const work = mkdtempSync(join(tmpdir(), "shipit-seo-taxonomy-archive-"));
	const consumer = join(work, "consumer");
	const database = join(consumer, "site.sqlite");
	const guard = join(work, "network-guard.mjs");
	const guardReport = join(work, "network.jsonl");
	const receiptPath = fileURLToPath(new URL("taxonomy-archive-review/native-html-smoke.json", reviewOutputRoot(environment.target)));
	const active = new Set();
	const created = new Set();
	let installed = null;
	const receipt = { schemaVersion: 1, status: "failed", target: environment.target.name, emdash: coreManifest.version, node: process.versions.node,
		evidence: "Compiled package copy, released EmDash, real Astro standalone HTTP, disposable file SQLite. Reused pinned dependencies; no dependency installation. Controlled stored-policy phases are not admin UI or revision-save evidence.",
		limits: "Local native1.3 SQLite only; no Cloudflare/D1, Postgres, sandbox, third-party theme or package-publication claim.",
		package: { version: packageManifest.version, manifestSha256: frozen.packageManifest, distSha256: frozen.packageDist }, templates: {}, phases: {}, checks: [], network: [], cleanup: {} };
	const baseEnvironment = { ...process.env, NODE_OPTIONS: `--max-old-space-size=2048 --import=${guard}`, ASTRO_TELEMETRY_DISABLED: "1", EMDASH_SITE_URL: "", SITE_URL: "", TAXONOMY_GUARD_REPORT: guardReport };
	let localOrigin = null;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		assert.equal(url.origin, localOrigin, "The smoke driver only requests its own active loopback server");
		return originalFetch(input, init);
	};
	function launch(args, label, extra = {}) {
		const child = spawn(process.execPath, args, { cwd: consumer, env: { ...baseEnvironment, TAXONOMY_GUARD_PHASE: label, ...extra }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
		const record = { child, label, identity: null, argv: [process.execPath, ...args], observed: new Map(), closed: false, output: "", error: null, code: null, signal: null };
		active.add(record); created.add(record);
		for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { record.output = (record.output + chunk.toString()).slice(-BUDGET); });
		record.done = new Promise((resolve) => { child.once("error", (error) => { record.error = error; }); child.once("close", (code, signal) => { record.code = code; record.signal = signal; record.closed = true; active.delete(record); resolve(); }); });
		if (child.pid) {
			record.identity = processIdentity(child.pid);
			assert.ok(record.identity && record.identity.group === child.pid && record.identity.session === child.pid, "The created child owns its detached process group and session");
		}
		return record;
	}
	function ownedMembers(record) {
		if (!record.child.pid) { assert.ok(record.closed, "A failed spawn must settle before cleanup"); return []; }
		assert.ok(record.identity, "The created process identity must be available");
		const processes = new Map();
		for (const entry of readdirSync("/proc")) if (/^[1-9]\d*$/.test(entry)) {
			const identity = processIdentity(Number(entry)); if (identity) processes.set(identity.pid, identity);
		}
		const leader = processes.get(record.child.pid);
		if (leader) assert.equal(leader.startTicks, record.identity.startTicks, "The created process leader must not have been replaced");
		const members = new Map([...processes].filter(([pid, identity]) => identity.group === record.child.pid || identity.session === record.child.pid || record.observed.get(pid) === identity.startTicks));
		let previousSize;
		do {
			previousSize = members.size;
			for (const [pid, identity] of processes) if (identity.parent === record.child.pid || members.has(identity.parent)) members.set(pid, identity);
		} while (members.size !== previousSize);
		for (const [pid, identity] of members) {
			record.observed.set(pid, identity.startTicks);
			assert.ok(identity.group === record.child.pid && identity.session === record.child.pid && BigInt(identity.startTicks) >= BigInt(record.identity.startTicks), "Created descendants must remain in their owned group and session");
			try {
				const uid = readFileSync(`/proc/${pid}/status`, "utf8").match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);
				assert.ok(uid && uid.slice(1).every((value) => Number(value) === process.getuid()), "Only current-user fixture processes may be stopped");
			} catch (error) { if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error; }
		}
		if (leader && leader.state !== "Z") {
			try {
				assert.equal(readlinkSync(`/proc/${leader.pid}/cwd`), consumer, "The created leader keeps its disposable working directory");
				assert.deepEqual(readFileSync(`/proc/${leader.pid}/cmdline`, "utf8").split("\0").filter(Boolean), record.argv, "The created leader keeps its exact command");
			} catch (error) { if ((error.code !== "ENOENT" && error.code !== "ESRCH") || processIdentity(leader.pid) !== null) throw error; }
		}
		return [...members.values()];
	}
	function assertStoppedProcesses() {
		assert.equal(active.size, 0, "All direct children must have closed");
		for (const record of created) assert.ok(record.closed && ownedMembers(record).length === 0, `${record.label} group and session must be absent before database access or cleanup`);
	}
	function signal(record, name) {
		if (ownedMembers(record).length === 0) return;
		try { process.kill(-record.child.pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; }
	}
	async function waitStopped(record, milliseconds) {
		const deadline = Date.now() + milliseconds;
		do {
			if (record.closed && ownedMembers(record).length === 0) return true;
			await delay(100);
		} while (Date.now() < deadline);
		return record.closed && ownedMembers(record).length === 0;
	}
	async function stop(record) {
		signal(record, "SIGTERM");
		if (!await waitStopped(record, 5_000)) {
			signal(record, "SIGKILL");
			assert.ok(await waitStopped(record, 2_000), `${record.label} group and session must exit before policy writes or cleanup`);
		}
	}
	async function run(args, label) {
		const record = launch(args, label);
		if (!await Promise.race([record.done.then(() => true), delay(180_000, undefined, { ref: false }).then(() => false)])) { await stop(record); throw new Error(`${label} exceeded 180 seconds`); }
		await stop(record);
		assert.equal(record.error, null, `${label}: ${record.error?.message}`);
		assert.equal(record.code, 0, `${label} failed: ${record.output.slice(-8192)}`);
		assertStoppedProcesses();
	}
	async function openServer(label) {
		assertStoppedProcesses();
		const probe = createServer();
		await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
		const address = probe.address(); assert.ok(address && typeof address !== "string");
		await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
		localOrigin = `http://127.0.0.1:${address.port}`;
		const record = launch([join(consumer, "dist/server/entry.mjs")], label, { HOST: "127.0.0.1", PORT: String(address.port) });
		const deadline = Date.now() + 25_000;
		try {
			while (Date.now() < deadline) {
				assert.equal(record.error, null, record.error?.message); assert.ok(active.has(record), record.output.slice(-8192));
				try { const response = await fetch(localOrigin + "/category/bread", { redirect: "manual", signal: AbortSignal.timeout(2_000) }); await response.arrayBuffer(); if (response.status === 200) return record; }
				catch {}
				await delay(100);
			}
			throw new Error(`Production archive did not become ready: ${record.output.slice(-8192)}`);
		} catch (error) { await stop(record); throw error; }
	}
	async function request(path) {
		assert.ok(path.startsWith("/") && !path.startsWith("//"));
		const response = await fetch(localOrigin + path, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
		const chunks = []; let bytes = 0;
		if (response.body) for await (const chunk of response.body) { bytes += chunk.byteLength; assert.ok(bytes <= BUDGET, `${path} exceeds the response budget`); chunks.push(chunk); }
		return { status: response.status, text: Buffer.concat(chunks).toString("utf8"), bytes };
	}
	function writePolicy(names, noindex = false, types) {
		assertStoppedProcesses();
		assert.ok(inside(work, database));
		const db = new DatabaseSync(database);
		try {
			const values = { version: 1, updatedAt: "2026-10-16T00:00:00.000Z", indexingPreferenceConfirmed: true,
				siteName: "Archive fixture", siteUrl: SITE, publisherType: "organization", organizationName: "Archive fixture", organizationLogo: "", personName: "",
				socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "", contentScoringEnabled: false, noindex,
				...(names === undefined ? {} : { taxonomyArchiveNoindex: [...names] }),
				...(types === undefined ? {} : { contentTypeNoindex: [...types] }) };
			db.prepare("INSERT INTO options(name,value,revision) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,revision=excluded.revision")
				.run(GLOBAL_ROW, JSON.stringify(values), `archive-${Object.keys(receipt.phases).length}`);
		} finally { db.close(); }
	}
	async function observe(label, names, noindex = false, types) {
		writePolicy(names, noindex, types);
		const record = await openServer("serve-" + label);
		const observations = {};
		const postsRuled = types?.includes("posts") === true;
		try {
			for (const [key, path] of [["category", "/category/bread"], ["region", "/region/north"], ["restricted", "/restricted/north"], ["unbound", "/unbound-category/bread"], ["themeNoindex", "/theme-noindex/bread"], ["post", "/posts/assigned-guide"], ["coreNoindexPost", "/posts/core-noindex-guide"]]) {
				const result = await request(path); assert.equal(result.status, 200, `${label} ${path}`);
				const tokens = publicRobots(result.text);
				const typeNoindex = postsRuled && (key === "post" || key === "coreNoindexPost");
				const expectedNoindex = noindex || key === "coreNoindexPost" || key === "themeNoindex" || typeNoindex || names?.includes(key === "restricted" ? "region" : key);
				assert.equal(tokens.includes("noindex"), !!expectedNoindex, `${label} ${key} noindex`);
				assert.equal(tokens.includes("nofollow"), noindex || key === "coreNoindexPost" || typeNoindex, `${label} ${key} no unexpected nofollow`);
				assert.equal(tokens.includes("index") && tokens.includes("noindex"), false);
				assert.equal(tokens.includes("follow") && tokens.includes("nofollow"), false);
				if (key === "category") {
					assert.ok(result.text.includes('data-taxonomy-name="category"'), "Released getTerm returns the taxonomy name separately from its label");
					assert.ok(result.text.includes("Bread collection"), "The actual SDK term label differs from its category name");
				}
				if (key === "region") {
					assert.ok(result.text.includes('data-taxonomy-name="region"'), "Released getTerm returns the exact custom taxonomy name");
					assert.ok(result.text.includes("Northern practice area"), "The actual SDK term label differs from its custom taxonomy name");
				}
				if (key === "restricted") for (const token of ["noarchive", "max-snippet:0"]) assert.ok(tokens.includes(token), `${label} ${token} survives`);
				if (key === "themeNoindex" && !noindex) assert.deepEqual(tokens, ["noindex", "follow"], `${label} a theme noindex keeps its follow instead of becoming noindex,nofollow`);
				observations[key] = { status: result.status, robots: tokens, bytes: result.bytes, sha256: sha(result.text) };
			}
			const index = await request("/sitemap.xml"); assert.equal(index.status, 200);
			if (noindex) assert.equal(index.text.includes("<sitemap>"), false, "The existing site-wide policy keeps the sitemap empty");
			else if (postsRuled) {
				assert.equal(index.text.includes("/sitemap-posts.xml"), false, "A content type rule leaves its type out of the sitemap index");
				assert.equal(index.text.includes("<sitemap>"), false, "The ruled type is the only content type, so the index lists no file");
				const child = await request("/sitemap-posts.xml"); assert.equal(child.status, 404, "The ruled type's child file answers 404");
				observations.sitemapIndex = { status: index.status, bytes: index.bytes, sha256: sha(index.text), child: child.status };
			} else {
				assert.ok(index.text.includes("/sitemap-posts.xml"));
				const child = await request("/sitemap-posts.xml"); assert.equal(child.status, 200);
				assert.ok(child.text.includes(SITE + "/posts/assigned-guide</loc>"), "Archive policy leaves associated posts in the Shipit sitemap");
				for (const excluded of ["core-noindex-guide", "/category/", "/region/", "/restricted/", "/unbound-category/"]) assert.equal(child.text.includes(excluded), false, excluded);
				observations.sitemap = { status: child.status, bytes: child.bytes, sha256: sha(child.text) };
			}
		} finally { await stop(record); localOrigin = null; }
		receipt.phases[label] = observations;
		return observations;
	}
	let failure;
	try {
		mkdirSync(consumer); writeFileSync(guard, guardSource);
		writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "shipit-seo-taxonomy-archive-consumer", private: true, type: "module", dependencies: hostManifest.dependencies }));
		const dependencies = new Set([...Object.keys(hostManifest.dependencies), ...Object.keys(hostManifest.devDependencies ?? {}), ...Object.keys(coreManifest.dependencies ?? {})]);
		for (const name of dependencies) {
			const destination = join(consumer, "node_modules", name); mkdirSync(dirname(destination), { recursive: true });
			const existing = fileURLToPath(environment.hostPackageRoot(name));
			if (name === "emdash") cpSync(existing, destination, { recursive: true }); else symlinkSync(existing, destination);
		}
		installed = join(consumer, "node_modules", PACKAGE); mkdirSync(installed, { recursive: true });
		cpSync(join(sourcePackage, "package.json"), join(installed, "package.json")); cpSync(join(sourcePackage, "dist"), join(installed, "dist"), { recursive: true });
		assert.equal(sha(readFileSync(join(installed, "package.json"))), frozen.packageManifest, "The copied package manifest matches the immutable source binding");
		assert.equal(fileTreeHash(join(installed, "dist")), frozen.packageDist, "The copied payload matches the immutable compiled source binding");
		receipt.package.copyMatchedSource = true;
		const source = new URL(environment.target.consumerSource, environment.hostRoot);
		for (const name of ["category/[slug].astro", "region/[slug].astro", "posts/[slug].astro"]) {
			let text = readFileSync(new URL("pages/" + name, source), "utf8");
			const canonical = "canonical: new URL(Astro.url.pathname, Astro.url.origin).href,";
			assert.equal(text.split(canonical).length, 2); text = text.replace(canonical, "canonical: new URL(Astro.url.pathname, Astro.site).href,");
			if (name !== "posts/[slug].astro") {
				assert.equal(text.split("<h1>{term.label}</h1>").length, 2);
				text = text.replace("<h1>{term.label}</h1>", "<h1 data-taxonomy-name={term.name}>{term.label}</h1>");
			}
			const destination = join(consumer, "src/pages", name); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, text);
			receipt.templates[name] = sha(text);
		}
		const regionSource = readFileSync(join(consumer, "src/pages/region/[slug].astro"), "utf8");
		const siteName = 'siteName: "Dev Site",'; assert.equal(regionSource.split(siteName).length, 2);
		const restrictive = regionSource.replace(siteName, siteName + '\n\tseo: { robots: "index,follow,noarchive,max-snippet:0" },');
		mkdirSync(join(consumer, "src/pages/restricted")); writeFileSync(join(consumer, "src/pages/restricted/[slug].astro"), restrictive);
		receipt.templates["restricted/[slug].astro"] = sha(restrictive);
		const categorySource = readFileSync(join(consumer, "src/pages/category/[slug].astro"), "utf8");
		assert.ok(categorySource.includes("const page = taxonomyArchivePage(createPublicPageContext({")); assert.ok(categorySource.includes("}), term.name);"));
		const unbound = categorySource.replace("const page = taxonomyArchivePage(createPublicPageContext({", "const page = createPublicPageContext({").replace("}), term.name);", "});");
		mkdirSync(join(consumer, "src/pages/unbound-category")); writeFileSync(join(consumer, "src/pages/unbound-category/[slug].astro"), unbound);
		receipt.templates["unbound-category/[slug].astro"] = sha(unbound);
		assert.equal(unbound.split(siteName).length, 2);
		const themeNoindex = unbound.replace(siteName, siteName + '\n\tseo: { robots: "noindex,follow" },');
		mkdirSync(join(consumer, "src/pages/theme-noindex")); writeFileSync(join(consumer, "src/pages/theme-noindex/[slug].astro"), themeNoindex);
		receipt.templates["theme-noindex/[slug].astro"] = sha(themeNoindex);
		cpSync(fileURLToPath(new URL("live.config.ts", source)), join(consumer, "src/live.config.ts"));
		writeFileSync(join(consumer, "src/middleware.ts"), 'import { defineMiddleware } from "astro:middleware";\nexport const onRequest = defineMiddleware(async ({ url }, next) => { if (url.pathname.startsWith("/_emdash/api/auth/") || url.pathname.startsWith("/_emdash/api/setup/dev-")) return new Response("Unavailable in the archive fixture", { status: 403 }); const runtime = globalThis[Symbol.for("emdash:runtime-holder")]?.instance; if (runtime) globalThis[Symbol.for("taxonomy-fixture-runtimes")]?.add(runtime); return next(); });\n');
		writeFileSync(join(consumer, "astro.config.mjs"), `import node from "@astrojs/node";\nimport react from "@astrojs/react";\nimport { defineConfig } from "astro/config";\nimport emdash from "emdash/astro";\nimport { sqlite } from "emdash/db";\nimport { shipitSeo } from "${PACKAGE}/astro";\nexport default defineConfig({ site: "${SITE}", output: "server", trailingSlash: "ignore", devToolbar: { enabled: false }, cacheDir: ${JSON.stringify(join(consumer, ".astro"))}, adapter: node({ mode: "standalone" }), integrations: [react(), shipitSeo(emdash, { database: sqlite({ url: ${JSON.stringify(`file:${database}`)} }), registry: false, fonts: false, siteUrl: "${SITE}" })], vite: { cacheDir: ${JSON.stringify(join(consumer, ".vite"))}, resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query"] }, ssr: { noExternal: ["${PACKAGE}"] } } });\n`);
		assertStoppedProcesses();
		receipt.seed = await seedDisposableDatabase(database);
		writePolicy(undefined);
		const retained = retainedRows(database);
		const astro = readJson(join(consumer, "node_modules/astro/package.json"));
		console.log("Taxonomy archive smoke: build the disposable native1.3 consumer.");
		await run([join(consumer, "node_modules/astro", astro.bin.astro), "build"], "build");
		assert.ok(existsSync(join(consumer, "dist/server/entry.mjs")));
		const baseline = await observe("inherited", undefined);
		for (const [label, names] of [["category", ["category"]], ["custom", ["region"]], ["both", ["category", "region"]], ["cleared", []]]) {
			const current = await observe(label, names);
			for (const key of ["post", "coreNoindexPost"]) assert.deepEqual(current[key].robots, baseline[key].robots, "Associated entries keep the same robots across archive-only changes");
			assert.equal(current.sitemap.sha256, baseline.sitemap.sha256, "Archive-only changes leave the content sitemap unchanged");
			assert.deepEqual(retainedRows(database), retained, "Terms, assignments, content and core SEO rows remain unchanged");
		}
		const ruled = await observe("type-rule", undefined, false, ["posts"]);
		assert.deepEqual(ruled.post.robots, ["noindex", "nofollow"], "An entry of a ruled content type renders noindex,nofollow");
		for (const key of ["category", "region", "restricted", "unbound", "themeNoindex"]) assert.deepEqual(ruled[key].robots, baseline[key].robots, "A content type rule never reaches " + key);
		assert.deepEqual(retainedRows(database), retained, "The content type rule writes no content, taxonomy or SEO rows");
		const lifted = await observe("type-rule-removed", undefined, false, []);
		for (const key of ["post", "coreNoindexPost", "category", "region", "restricted", "unbound", "themeNoindex"]) assert.deepEqual(lifted[key].robots, baseline[key].robots, "Removing the rule restores " + key);
		assert.equal(lifted.sitemap.sha256, baseline.sitemap.sha256, "Removing the rule restores the content sitemap");
		assert.deepEqual(retainedRows(database), retained);
		await observe("site-noindex", ["category", "region"], true);
		assert.deepEqual(retainedRows(database), retained);
		receipt.checks = ["released SDK term.name binds exact taxonomy while term.label remains display text", "real compiled EmDashHead: built-in and custom archives", "inherited, separate, combined, clear and site-wide policies", "restrictive theme directives preserved without extra nofollow", "a theme noindex,follow on a custom page is kept as written", "unbound archive remains unaffected by taxonomy policy", "assigned entries and content sitemap unchanged; core entry noindex retained", "no content, taxonomy or membership writes during policy phases", "content type rule: its entries render noindex,nofollow, its type leaves the sitemap index and its child file answers 404; removing the rule restores both"];
		receipt.status = "passed";
	} catch (error) { failure = error; receipt.error = String(error?.stack ?? error).slice(-8192); }
	finally {
		for (const record of created) { try { await stop(record); } catch (error) { failure ??= error; receipt.cleanup.error = String(error.message).slice(0, 512); } }
		globalThis.fetch = originalFetch;
		try {
			if (existsSync(guardReport)) receipt.network = readFileSync(guardReport, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
			if (receipt.status === "passed") assert.ok(receipt.network.length > 0, "Guard evidence must exist");
			assert.ok(receipt.network.every((entry) => entry.externalAttempts === 0), "No provider or external requests may be attempted");
			for (const label of Object.keys(receipt.phases)) assert.ok(receipt.network.some((entry) => entry.phase === "serve-" + label && entry.gracefulShutdown), label + " closed its runtime and SQLite connection");
			assert.equal(sha(readFileSync(lock)), frozen.lock); assert.equal(sha(readFileSync(new URL("package.json", environment.hostRoot))), frozen.manifest);
			receipt.cleanup.frozenHostPinsUnchanged = true;
		} catch (error) { failure ??= error; receipt.verificationError = String(error.message).slice(0, 512); }
		try {
			assert.equal(sha(readFileSync(join(sourcePackage, "package.json"))), frozen.packageManifest, "The source package manifest remains unchanged");
			assert.equal(fileTreeHash(join(sourcePackage, "dist")), frozen.packageDist, "The source compiled payload remains unchanged");
			receipt.cleanup.sourcePackageUnchanged = true;
			if (installed) {
				assert.equal(sha(readFileSync(join(installed, "package.json"))), frozen.packageManifest, "The copied package manifest remains unchanged");
				assert.equal(fileTreeHash(join(installed, "dist")), frozen.packageDist, "The copied compiled payload remains unchanged");
				receipt.cleanup.copiedPackageUnchanged = true;
			}
		} catch (error) { failure ??= error; receipt.packageVerificationError = String(error.message).slice(0, 512); }
		try {
			assertStoppedProcesses();
			receipt.cleanup.processGroups = [...created].map((record) => ({ label: record.label, pid: record.child.pid ?? null, startTicks: record.identity?.startTicks ?? null, leaderClosed: record.closed, groupAndSessionAbsent: true }));
			receipt.cleanup.processesStopped = true;
			assert.ok(inside(tmpdir(), work) && realpathSync(work) === work);
			rmSync(work, { recursive: true, force: true }); receipt.cleanup.temporaryFilesRemoved = true;
		} catch (error) { failure ??= error; receipt.cleanup = { ...receipt.cleanup, error: String(error.message).slice(0, 512), temporaryFilesRemoved: false, retainedWorkspace: work }; }
		if (failure) receipt.status = "failed";
		const text = JSON.stringify(receipt, null, 2) + "\n"; assert.ok(Buffer.byteLength(text) <= BUDGET, "Receipt exceeds 64 KiB");
		mkdirSync(dirname(receiptPath), { recursive: true }); writeFileSync(receiptPath, text);
	}
	if (failure) throw failure;
	console.log(`Taxonomy archive native HTML smoke passed (${Object.keys(receipt.phases).length} policy phases); receipt: ${receiptPath}`);
}

const guardSource = `import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import dgram from "node:dgram";
let externalAttempts = 0; const denied = []; let gracefulShutdown = false;
const deny = (operation, host = "") => { externalAttempts += 1; if (denied.length < 10) denied.push({ operation, host: String(host).slice(0, 128) }); throw new Error("External networking is disabled in the taxonomy archive fixture"); };
const fetch = globalThis.fetch;
globalThis.fetch = async (input, init) => { const url = new URL(input instanceof Request ? input.url : String(input)); if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return deny("fetch", url.hostname); return fetch(input, init); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { const first = args[0]; const host = first && typeof first === "object" ? first.host ?? first.hostname : typeof first === "number" ? args[1] : null; if (host !== "127.0.0.1") return deny("net.connect", host ?? "normalized-or-unset"); return connect.apply(this, args); };
tls.connect = (...args) => deny("tls.connect", args[0]?.host ?? ""); dgram.createSocket = () => deny("dgram.createSocket");
const lookup = dns.lookup; dns.lookup = (host, ...args) => host === "127.0.0.1" ? lookup(host, ...args) : deny("dns.lookup", host);
const promiseLookup = dns.promises.lookup; dns.promises.lookup = async (host, ...args) => host === "127.0.0.1" ? promiseLookup(host, ...args) : deny("dns.promises.lookup", host);
for (const name of Object.keys(dns)) if (/^(?:lookupService|resolve|reverse)/.test(name) && typeof dns[name] === "function") dns[name] = (host) => deny("dns." + name, host);
for (const name of Object.keys(dns.promises)) if (/^(?:lookupService|resolve|reverse)/.test(name) && typeof dns.promises[name] === "function") dns.promises[name] = async (host) => deny("dns.promises." + name, host);
syncBuiltinESMExports();
const servers = new Set(); const runtimes = new Set(); globalThis[Symbol.for("taxonomy-fixture-runtimes")] = runtimes;
const listen = http.Server.prototype.listen; http.Server.prototype.listen = function (...args) { servers.add(this); return listen.apply(this, args); };
let stopping = false;
process.on("SIGTERM", async () => { if (stopping) return; stopping = true; try { await Promise.all([...servers].map((server) => new Promise((resolve, reject) => { if (!server.listening) return resolve(); server.close((error) => error ? reject(error) : resolve()); }))); for (const runtime of runtimes) { await runtime.shutdown(); await runtime.db.destroy(); } gracefulShutdown = servers.size > 0 && runtimes.size > 0; process.exit(gracefulShutdown ? 0 : 143); } catch (error) { console.error(error.message); process.exit(1); } });
process.on("exit", () => { assert.ok(process.env.TAXONOMY_GUARD_REPORT); appendFileSync(process.env.TAXONOMY_GUARD_REPORT, JSON.stringify({ phase: process.env.TAXONOMY_GUARD_PHASE, externalAttempts, denied, gracefulShutdown }) + "\\n"); });
`;

await main();
