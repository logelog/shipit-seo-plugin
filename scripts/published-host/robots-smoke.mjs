import { reviewOutputRoot } from "./environment.mjs";
// Native robots.txt proof on a migrated EmDash SQLite database from the
// selected published host. It drives EmDash's own settings endpoint and
// /robots.txt route handlers with the editor's shared rules: permissions,
// field-only writes, sibling preservation, the validator limit, effective
// bodies, address order, fallbacks, last-writer-wins and a lost response.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";
const reviewRoot = reviewOutputRoot(target);

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Robots smoke skipped on ${target.name}; this check requires a released native target.`);
	process.exit(0);
}
globalThis.fetch = async () => { throw new Error("External networking is disabled in this smoke check"); };
delete process.env.EMDASH_SITE_URL;
delete process.env.SITE_URL;

const host = hostPackageRoot("emdash");
async function hostDistExport(name) {
	const dist = new URL("dist/", host);
	for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const alias = readFileSync(new URL(file, dist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(new URL(file, dist).href))[alias];
	}
	throw new Error(`published ${name} was not found`);
}
const { Kysely } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const settingsRoute = await import("emdash/internal/routes/api/settings");
const robotsRoute = await import("emdash/internal/routes/robots.txt");
const OptionsRepository = await hostDistExport("OptionsRepository");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { ROBOTS_TXT_CACHE_CONTROL, ROBOTS_TXT_CORE_FALLBACK_BODY, effectiveRobotsTxt, robotsTxtCodePoints, robotsTxtTooLong } = await source("robots-txt.ts");
const { buildRobotsTxtFacts } = await source("robots-runtime.ts");
const model = await source("admin-ui/robots-txt-model.ts");

const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push(event.query.sql);
	},
});
const counted = async (action) => {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	return { value, queries: run.length, writes: run.filter((text) => /^\s*(insert|update|delete|replace)\b/i.test(text)).length };
};

const ORIGIN = "http://127.0.0.1:4362";
const users = {
	admin: { id: "u-admin", role: 50 },
	editor: { id: "u-editor", role: 40 },
	author: { id: "u-author", role: 30 },
	anonymous: null,
};
const emdashLocals = (config = {}) => ({ db, storage: null, config });

async function apiCall(handler, { user, body, config } = {}) {
	const request = new Request(`${ORIGIN}/_emdash/api/settings`, body === undefined
		? { method: "GET" }
		: { method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" }, body: JSON.stringify(body) });
	const response = await handler({ request, locals: { emdash: emdashLocals(config), user }, url: new URL(request.url), cache: { enabled: false } });
	return { status: response.status, json: await response.json() };
}
const getSettings = (user, config) => apiCall(settingsRoute.GET, { user, config });
const postSettings = (user, body, config) => apiCall(settingsRoute.POST, { user, body, config });

async function robots({ config = {}, locals } = {}) {
	const url = new URL(`${ORIGIN}/robots.txt`);
	const response = await robotsRoute.GET({ locals: locals ?? { emdash: emdashLocals(config) }, url, request: new Request(url) });
	const read = await model.readRobotsObservationBody(response.body);
	return { status: response.status, cacheControl: response.headers.get("cache-control"), contentType: response.headers.get("content-type"), body: read.text, truncated: read.truncated };
}

// The editor's port, bound to the real endpoint handlers and one user.
function port(user, config) {
	const toResult = ({ status, json }) => status >= 200 && status < 300
		? { ok: true, data: json.data }
		: { ok: false, failure: { type: "response", status, code: json.error?.code ?? "UNKNOWN", message: json.error?.message ?? "" } };
	return {
		read: async () => toResult(await getSettings(user, config)),
		write: async (text) => toResult(await postSettings(user, model.robotsSettingsUpdate(text), config)),
	};
}

async function optionRows() {
	const rows = await db.selectFrom("options").select(["name", "value", "revision"]).where("name", "like", "site:%").orderBy("name").execute();
	return Object.fromEntries(rows.map((row) => [row.name, { value: JSON.parse(row.value), revision: row.revision }]));
}

const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], requests: {} };
const check = (name) => report.checks.push(name);

try {
	await runMigrations(db);
	const admin = port(users.admin);

	// Nothing stored: the default body with the request origin.
	const empty = await model.loadRobotsSettings(admin);
	assert.ok(empty.ok);
	assert.deepEqual(empty.snapshot.stored, { kind: "unset" });
	const defaults = await robots();
	assert.equal(defaults.status, 200);
	assert.equal(defaults.cacheControl, ROBOTS_TXT_CACHE_CONTROL);
	assert.equal(defaults.contentType, "text/plain; charset=utf-8");
	assert.equal(defaults.body, effectiveRobotsTxt(undefined, ORIGIN).body);
	const originFacts = { configuredOrigin: null, configuredOriginKnown: true, requestOrigin: ORIGIN };
	assert.deepEqual(model.robotsObservation(empty.snapshot, originFacts, { status: 200, redirected: false, body: defaults.body }), { status: "matches" });
	check("default body and request origin match the route");

	// Permissions are the endpoint's: 401 without a user, 403 FORBIDDEN below the role.
	assert.equal((await getSettings(users.anonymous)).status, 401);
	const authorRead = await getSettings(users.author);
	assert.deepEqual([authorRead.status, authorRead.json.error.code], [403, "FORBIDDEN"]);
	assert.equal(model.robotsReadProblem({ type: "response", status: 403, code: authorRead.json.error.code, message: "" }), "read-denied");
	assert.equal((await getSettings(users.editor)).status, 200, "an editor may read");
	check("read: anonymous 401, author 403 FORBIDDEN, editor 200");

	// Other settings first, as another editor or EmDash's own pages would store them.
	const seeded = await postSettings(users.admin, {
		title: "Smoke site",
		tagline: "Kept",
		url: "https://www.example.com/blog/",
		social: { twitter: "@smoke" },
		seo: { titleSeparator: " | ", googleVerification: "google-code", bingVerification: "bing-code" },
	});
	assert.equal(seeded.status, 200);
	const beforeDenied = await optionRows();
	const editorWrite = await model.saveRobotsText(port(users.editor), { kind: "unset" }, "User-agent: *\nDisallow: /editor/");
	assert.ok(editorWrite.status === "rejected" && editorWrite.problem === "save-denied");
	const anonymousWrite = await model.saveRobotsText({ read: admin.read, write: port(users.anonymous).write }, { kind: "unset" }, "x");
	assert.ok(anonymousWrite.status === "rejected" && anonymousWrite.problem === "unauthorized");
	assert.deepEqual(await optionRows(), beforeDenied, "denied writes change no row or revision");
	check("write: editor 403 save-denied, anonymous 401, nothing changed");

	// A save sends only the field; siblings and other groups keep their values.
	const loaded = await model.loadRobotsSettings(admin);
	assert.ok(loaded.ok);
	const custom = "User-agent: *\nDisallow: /private/  \n\n";
	const saveCall = await counted(() => model.saveRobotsText(admin, loaded.snapshot.stored, custom));
	assert.ok(saveCall.value.status === "saved" && saveCall.value.confirmation === "reloaded" && !saveCall.value.replacedAfter);
	const afterSave = await optionRows();
	for (const [name, row] of Object.entries(beforeDenied)) {
		if (name === "site:seo") continue;
		assert.deepEqual(afterSave[name], row, `${name} untouched`);
	}
	assert.deepEqual(afterSave["site:seo"].value, { titleSeparator: " | ", googleVerification: "google-code", bingVerification: "bing-code", robotsTxt: custom });
	assert.notEqual(afterSave["site:seo"].revision, beforeDenied["site:seo"].revision);
	report.requests.save = { queries: saveCall.queries, writes: saveCall.writes, note: "pre-write read, write, confirming read" };
	check("field-only save preserves SEO siblings and other groups");

	// Effective bodies straight from the route, with a path in the Site URL kept.
	const settingsBase = "https://www.example.com/blog";
	const served = async (text) => {
		await postSettings(users.admin, model.robotsSettingsUpdate(text));
		const response = await robots();
		const loadedNow = await model.loadRobotsSettings(admin);
		assert.ok(loadedNow.ok);
		const observation = model.robotsObservation(loadedNow.snapshot, originFacts, { status: response.status, redirected: false, body: response.body });
		return { response, observation };
	};
	for (const [label, text] of [
		["trimmed custom with appended Sitemap", custom],
		["whitespace-only custom", " \n\t "],
		["comment containing SITEMAP: verbatim", "User-agent: *\n# SITEMAP: none here  \n"],
		["CRLF text as stored", "User-agent: *\r\nDisallow: /tmp/\r\n"],
		["leading byte order mark", "﻿User-agent: *\nDisallow: /bom/"],
		["empty string restores the default", ""],
	]) {
		const { response, observation } = await served(text);
		assert.equal(response.status, 200, label);
		assert.equal(response.cacheControl, ROBOTS_TXT_CACHE_CONTROL, label);
		assert.equal(response.body, effectiveRobotsTxt(text, settingsBase).body, label);
		assert.deepEqual(observation, { status: "matches" }, label);
		check(`route body: ${label}`);
	}
	assert.equal((await robots()).body.includes("Sitemap: https://www.example.com/blog/sitemap.xml\n"), true);
	assert.equal((await optionRows())["site:seo"].value.robotsTxt, "", "restoring stores an empty string, not a deletion");

	// EmDash's validator (zod 4.5.4) counts code points; the editor counts the same way.
	const emoji = "😀".repeat(5000);
	assert.deepEqual([emoji.length, robotsTxtCodePoints(emoji), robotsTxtTooLong(emoji)], [10000, 5000, false]);
	const emojiSaved = await model.saveRobotsText(admin, (await model.loadRobotsSettings(admin)).snapshot.stored, emoji);
	assert.equal(emojiSaved.status, "saved", "5,000 non-BMP characters are accepted");
	assert.equal((await optionRows())["site:seo"].value.robotsTxt, emoji, "stored unchanged");
	const mixed = `${"a".repeat(4999)}😀`;
	assert.deepEqual([mixed.length, robotsTxtCodePoints(mixed), robotsTxtTooLong(mixed)], [5001, 5000, false]);
	assert.equal((await postSettings(users.admin, model.robotsSettingsUpdate(mixed))).status, 200, "5,001 units that are 5,000 code points pass");
	const beforeTooLong = await optionRows();
	for (const over of [`${emoji}a`, "a".repeat(5001), `${"a".repeat(4999)}😀😀`]) {
		assert.equal(robotsTxtCodePoints(over), 5001);
		assert.equal(robotsTxtTooLong(over), true, "the editor blocks it");
		const tooLong = await postSettings(users.admin, model.robotsSettingsUpdate(over));
		assert.deepEqual([tooLong.status, tooLong.json.error.code], [400, "VALIDATION_ERROR"], "EmDash rejects 5,001 code points");
		const current = await model.loadRobotsSettings(admin);
		assert.ok(current.ok);
		const blockers = model.robotsWriteBlockers({
			snapshot: current.snapshot, facts: { status: "ready", owner: "emdash-core" }, manage: "allowed",
			uncertain: false, busy: false, draft: over, lineEndsAccepted: false,
		});
		assert.deepEqual(blockers.save, ["too-long"], "the editor keeps Save disabled");
	}
	assert.equal(model.robotsWriteProblem({ type: "response", status: 400, code: "VALIDATION_ERROR", message: "" }), "invalid");
	assert.deepEqual(await optionRows(), beforeTooLong, "rejected texts write nothing");
	report.limit = { counted: "Unicode code points (zod 4.5.4 codePointLength)", accepted: "5,000 emoji (10,000 UTF-16 units)", rejected: "5,001 code points, HTTP 400 VALIDATION_ERROR, no write" };
	check("limit: 5,000 code points accepted including 5,000 non-BMP characters; 5,001 rejected without a write");

	// Address order after the Site URL: EmDash's siteUrl option, then the
	// environment origin core read first in this process, then the request.
	assert.equal((await postSettings(users.admin, { url: "" })).status, 200);
	await postSettings(users.admin, model.robotsSettingsUpdate("User-agent: *"));
	const installation = { owner: "emdash-core", detail: null, hostVersion: target.versions.get("emdash"), emdashSiteUrl: "https://cms.example.org" };
	const configFacts = buildRobotsTxtFacts(installation, {});
	const withConfig = await robots({ config: { siteUrl: "https://cms.example.org" } });
	assert.equal(withConfig.body, effectiveRobotsTxt("User-agent: *", "https://cms.example.org").body);
	const stored = await model.loadRobotsSettings(admin);
	assert.ok(stored.ok);
	assert.deepEqual(model.robotsObservation(stored.snapshot, { ...originFacts, configuredOrigin: configFacts.configuredOrigin },
		{ status: 200, redirected: false, body: withConfig.body }), { status: "matches" });
	const requestOnly = await robots();
	assert.equal(requestOnly.body, effectiveRobotsTxt("User-agent: *", ORIGIN).body);
	process.env.EMDASH_SITE_URL = "https://env.example.net/path";
	const envFacts = buildRobotsTxtFacts({ ...installation, emdashSiteUrl: null });
	assert.deepEqual(envFacts.configuredOrigin, { origin: "https://env.example.net", source: "environment" });
	const afterEnvChange = await robots();
	assert.equal(afterEnvChange.body, requestOnly.body, "core keeps the environment value it read first in this process");
	assert.deepEqual(model.robotsObservation(stored.snapshot, { ...originFacts, configuredOrigin: envFacts.configuredOrigin },
		{ status: 200, redirected: false, body: afterEnvChange.body }), { status: "other-origin", observedOrigin: ORIGIN },
		"a current-environment estimate that differs is reported, not matched");
	delete process.env.EMDASH_SITE_URL;
	check("address order: site URL, siteUrl option, cached environment, request");

	// Fallbacks are never current configuration.
	const noDb = await robots({ locals: { emdash: {} } });
	const failingDb = await robots({ locals: { emdash: { db: { selectFrom() { throw new Error("read failed"); } }, config: {} } } });
	for (const response of [noDb, failingDb]) {
		assert.equal(response.body, ROBOTS_TXT_CORE_FALLBACK_BODY);
		assert.equal(response.cacheControl, null, "the fallback sends no Cache-Control");
		assert.deepEqual(model.robotsObservation(stored.snapshot, originFacts, { status: 200, redirected: false, body: response.body }), { status: "fallback" });
	}
	const options = new OptionsRepository(db);
	const seoRow = await options.getVersioned("site:seo");
	await options.set("site:seo", { ...seoRow.value, robotsTxt: 42 });
	const invalid = await model.loadRobotsSettings(admin);
	assert.ok(invalid.ok);
	assert.deepEqual(invalid.snapshot.stored, { kind: "invalid", served: "fallback", type: "number", identity: "42" });
	const invalidServed = await robots();
	assert.equal(invalidServed.body, ROBOTS_TXT_CORE_FALLBACK_BODY);
	assert.deepEqual(model.robotsObservation(invalid.snapshot, originFacts, { status: 200, redirected: false, body: invalidServed.body }), { status: "fallback" });
	const replaced = await model.saveRobotsText(admin, invalid.snapshot.stored, "User-agent: *");
	assert.equal(replaced.status, "saved", "text replaces a stored non-text value");
	check("missing database, failed read and non-text value serve the uncached fallback, reported as fallback");

	// Malformed responses are failed reads, never an empty default.
	const malformed = await model.loadRobotsSettings({ read: async () => ({ ok: true, data: undefined }), write: admin.write });
	assert.deepEqual([malformed.ok, malformed.ok ? null : malformed.problem], [false, "malformed"]);
	check("a malformed settings response is a failed read");

	// Two editors through EmDash's last-writer-wins endpoint.
	const editorA = await model.loadRobotsSettings(admin);
	const editorB = await model.loadRobotsSettings(admin);
	assert.ok(editorA.ok && editorB.ok);
	const savedB = await model.saveRobotsText(admin, editorB.snapshot.stored, "User-agent: *\n# B");
	assert.equal(savedB.status, "saved");
	const staleA = await model.saveRobotsText(admin, editorA.snapshot.stored, "User-agent: *\n# A");
	assert.equal(staleA.status, "conflict", "a change since loading is detected before writing");
	assert.equal((await optionRows())["site:seo"].value.robotsTxt, "User-agent: *\n# B");
	const keptA = await model.saveRobotsText(admin, staleA.latest.stored, "User-agent: *\n# A");
	assert.ok(keptA.status === "saved" && !keptA.replacedAfter);
	assert.equal((await optionRows())["site:seo"].value.robotsTxt, "User-agent: *\n# A", "the last save wins");
	// A save between the check and the write is overwritten without notice.
	const raced = { read: admin.read, write: async (text) => {
		await postSettings(users.admin, model.robotsSettingsUpdate("User-agent: *\n# C"));
		return admin.write(text);
	} };
	const loadedForRace = await model.loadRobotsSettings(admin);
	assert.ok(loadedForRace.ok);
	const overwrote = await model.saveRobotsText(raced, loadedForRace.snapshot.stored, "User-agent: *\n# D");
	assert.ok(overwrote.status === "saved" && !overwrote.replacedAfter);
	assert.equal((await optionRows())["site:seo"].value.robotsTxt, "User-agent: *\n# D", "C was lost: the check is not atomic");
	check("two editors: change detected before writing, last writer wins, the check-to-write window overwrites");

	// A committed write whose response was lost: one reload, no retry.
	let posts = 0;
	const lost = { read: admin.read, write: async (text) => {
		posts += 1;
		await admin.write(text);
		return { ok: false, failure: { type: "transport", message: "connection reset" } };
	} };
	const uncertain = await model.saveRobotsText(lost, (await optionRows())["site:seo"] ? { kind: "text", text: "User-agent: *\n# D" } : { kind: "unset" }, "User-agent: *\n# E");
	assert.ok(uncertain.status === "uncertain" && uncertain.reload.ok && uncertain.reload.outcome === "sent-text");
	assert.equal(posts, 1, "never retried");
	check("lost response after a committed write: one reload shows the sent text, no retry");

	// Request costs on this database.
	report.requests.settingsGet = await counted(() => getSettings(users.admin)).then(({ queries, writes }) => ({ queries, writes }));
	report.requests.robotsGet = await counted(() => robots()).then(({ queries, writes }) => ({ queries, writes }));
	assert.equal(report.requests.robotsGet.writes, 0);
	assert.equal(report.requests.settingsGet.writes, 0);

	mkdirSync(new URL("robots-review/", reviewRoot), { recursive: true });
	writeFileSync(new URL("robots-review/native-sql-smoke.json", reviewRoot), `${JSON.stringify(report, null, 2)}\n`);
	console.log(`Native robots SQLite smoke passed: ${report.checks.length} checks; robots GET ${report.requests.robotsGet.queries} queries, settings GET ${report.requests.settingsGet.queries}, save ${report.requests.save.queries} queries with ${report.requests.save.writes} writes.`);
} finally {
	await db.destroy();
}
