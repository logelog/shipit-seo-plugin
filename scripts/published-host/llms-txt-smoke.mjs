import { reviewOutputRoot } from "./environment.mjs";
// Native llms.txt proof on a migrated EmDash SQLite database from the selected
// published host. The native plugin is registered with the published plugin
// route registry behind the published HTTP dispatcher, which checks the user,
// the CSRF header and the body limit before a handler runs, and the record
// lives in the published plugin KV. Public GET and HEAD go through the
// plugin's middleware and the public dispatcher boundary.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";
const reviewRoot = reviewOutputRoot(target);

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`llms.txt smoke skipped on ${target.name}; this check requires a released native target.`);
	process.exit(0);
}
globalThis.fetch = async () => { throw new Error("External networking is disabled in this smoke check"); };

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
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createPlugin } = await source("native-entry.ts");
const { createLlmsTxtMiddleware } = await source("llms-txt-middleware.ts");
const { LLMS_TXT_DOCUMENT_MAX_BYTES, llmsTxtUtf8Bytes } = await source("llms-txt-document.ts");
const { LLMS_TXT_SETTINGS_KEY } = await source("llms-txt-runtime.ts");
const model = await source("admin-ui/llms-txt-model.ts");

const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0);
const KEY = `plugin:shipit-seo:${LLMS_TXT_SETTINGS_KEY}`;
const SITE = "http://127.0.0.1:4362";

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
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], requests: {} };
const check = (name) => report.checks.push(name);

function nativePlugin(owner) {
	return createPlugin({
		installation: { siteOrigin: null, siteIssue: "missing", keyRoute: "unavailable", llmsTxt: { owner, detail: owner === "shipit" ? null : "/[...slug] answers /llms.txt", hostVersion: target.versions.get("emdash") } },
	});
}

// The runtime boundary as EmDash 1.1.0 implements it: a disabled plugin has no
// route metadata and answers NOT_FOUND; declared methods and request bodies
// are enforced before the registry invokes the handler.
function runtimeFor(plugin) {
	const registry = new PluginRouteRegistry({ db, siteInfo: { url: SITE, name: "llms smoke" }, cronReschedule() {} });
	registry.register(plugin);
	const runtime = {
		enabled: true,
		getPluginRouteMeta(pluginId, path) {
			if (!this.enabled || pluginId !== plugin.id) return null;
			const route = plugin.routes[path.replace(/^\//, "")];
			return route ? buildRouteMeta(route) : null;
		},
		async handlePluginApiRoute(pluginId, method, path, request, caller) {
			if (!this.enabled) return { success: false, error: { code: "NOT_FOUND", message: `Plugin not enabled: ${pluginId}` } };
			const meta = this.getPluginRouteMeta(pluginId, path);
			if (meta?.methods && !meta.methods.includes(method.toUpperCase())) {
				return { success: false, status: 405, error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } };
			}
			let body;
			try {
				body = await parseRouteInput(request, meta?.request);
			} catch (error) {
				if (typeof error?.status === "number") return { success: false, status: error.status, error: { code: "INVALID_PLUGIN_REQUEST", message: error.message } };
				throw error;
			}
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
		},
	};
	// EmDash's public handler: only routes declared public are reachable.
	const publicHandler = async (pluginId, method, path, request) => {
		const meta = runtime.getPluginRouteMeta(pluginId, path);
		if (meta?.public !== true) return { success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } };
		return runtime.handlePluginApiRoute(pluginId, method, path, request);
	};
	return { runtime, publicHandler };
}

const people = {
	author: { id: "author", email: "author@example.com", name: "Author", role: 30 },
	editor: { id: "editor", email: "editor@example.com", name: "Editor", role: 40 },
	admin: { id: "admin", email: "admin@example.com", name: "Admin", role: 50 },
};

function client(plugin, runtime) {
	return async function call(route, body, { user = people.admin, csrf = true, raw } = {}) {
		const init = body === undefined && raw === undefined
			? { method: "GET", headers: csrf ? { "X-EmDash-Request": "1" } : {} }
			: { method: "POST", headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) }, body: raw ?? JSON.stringify(body) };
		const request = new Request(`${SITE}/_emdash/api/plugins/shipit-seo/${route}`, init);
		const response = await dispatchPluginApiRequest({ runtime, pluginId: plugin.id, path: `/${route}`, request, user });
		const payload = await response.json();
		return { status: response.status, data: payload?.data, error: payload?.error };
	};
}

async function publicRequest(publicHandler, path = "/llms.txt", method = "GET", owner = "shipit") {
	const middleware = createLlmsTxtMiddleware(owner);
	const url = new URL(path, SITE);
	let passed = false;
	const response = await middleware({ url, request: new Request(url, { method }), locals: { emdash: { handlePublicPluginApiRoute: publicHandler } } },
		async () => { passed = true; return new Response("next", { status: 404, headers: { "Content-Type": "text/html" } }); });
	const bytes = new Uint8Array(await response.arrayBuffer());
	return { passed, status: response.status, headers: Object.fromEntries(response.headers), bytes, hasBody: response.body !== null };
}

async function storedRow() {
	return (await db.selectFrom("options").select(["name", "value", "revision"]).where("name", "=", KEY).executeTakeFirst()) ?? null;
}
const optionCount = async () => Number((await db.selectFrom("options").select(db.fn.countAll().as("count")).executeTakeFirst()).count);
const encode = (text) => new TextEncoder().encode(text);
const decodeExact = (bytes) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);

try {
	await runMigrations(db);
	const plugin = nativePlugin("shipit");
	const { runtime, publicHandler } = runtimeFor(plugin);
	const call = client(plugin, runtime);

	// ---- Permission and read-only reads ----------------------------------------
	assert.equal((await call("admin-llms-txt", undefined, { user: null })).status, 401);
	assert.equal((await call("admin-llms-txt", undefined, { user: people.author })).error?.code, "FORBIDDEN");
	assert.equal((await call("admin-llms-txt", undefined, { user: people.editor })).status, 403, "plugins:manage is Administrator only");
	const before = await optionCount();
	const firstRead = await counted(() => call("admin-llms-txt"));
	assert.equal(firstRead.value.status, 200);
	assert.equal(firstRead.value.data.state, "absent");
	assert.deepEqual([firstRead.value.data.enabled, firstRead.value.data.text, firstRead.value.data.revision], [false, null, null], "absent starts disabled with no text");
	assert.equal(firstRead.writes, 0);
	assert.equal(await optionCount(), before, "a read creates no record");
	report.requests.adminRead = { queries: firstRead.queries, writes: firstRead.writes };
	const absentPublic = await counted(() => publicRequest(publicHandler));
	assert.deepEqual([absentPublic.value.status, absentPublic.value.headers["cache-control"], absentPublic.value.passed], [404, "no-store", false]);
	assert.equal(absentPublic.writes, 0);
	report.requests.publicAbsent = { queries: absentPublic.queries, writes: absentPublic.writes };
	check("401, 403 for Author and Editor, Administrator reads absent state; reads create no record; absent answers 404 no-store");

	// ---- Save, refusals before any write ---------------------------------------
	const text = `${BOM}# Ünïcødé site 日本語\r\n\r\nShort summary.\r\n\r\n## Links\r\n- [About](/about)\r\n`;
	assert.equal((await call("save-admin-llms-txt", { expectedRevision: null, text }, { user: people.editor })).status, 403);
	assert.equal((await call("save-admin-llms-txt", { expectedRevision: null, text }, { csrf: false })).error?.code, "CSRF_REJECTED");
	assert.equal((await call("save-admin-llms-txt", { expectedRevision: null, text, enabled: true })).status, 400, "unknown fields are refused");
	assert.equal(await storedRow(), null);
	const save = await counted(() => call("save-admin-llms-txt", { expectedRevision: null, text }));
	assert.equal(save.value.data.success, true);
	assert.deepEqual([save.value.data.llms.state, save.value.data.llms.enabled, save.value.data.llms.text], ["stored", false, text]);
	let row = await storedRow();
	assert.deepEqual(JSON.parse(row.value), { version: 1, enabled: false, text }, "stored exactly, BOM, CRLF and non-ASCII included");
	assert.equal(row.revision, save.value.data.llms.revision);
	assert.equal(save.writes, 1);
	report.requests.save = { queries: save.queries, writes: save.writes };
	const disabled = await publicRequest(publicHandler);
	assert.deepEqual([disabled.status, disabled.headers["cache-control"]], [404, "no-store"]);
	assert.equal(decodeExact(disabled.bytes).includes("Short summary"), false, "a disabled document is not exposed");
	check("Editor 403, missing CSRF header 403, unknown field 400, no record; Administrator save stores BOM, CRLF and non-ASCII text exactly, disabled; public 404 without the text");

	// ---- Output on: exact UTF-8 GET and HEAD -----------------------------------
	const enable = await counted(() => call("set-admin-llms-txt-enabled", { expectedRevision: row.revision, enabled: true }));
	assert.equal(enable.value.data.success, true);
	report.requests.enable = { queries: enable.queries, writes: enable.writes };
	row = await storedRow();
	assert.deepEqual(JSON.parse(row.value), { version: 1, enabled: true, text }, "the switch keeps the stored bytes");
	const get = await counted(() => publicRequest(publicHandler));
	assert.equal(get.value.status, 200);
	assert.deepEqual([...get.value.bytes], [...encode(text)], "GET body is the exact UTF-8 bytes");
	assert.deepEqual([...get.value.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
	assert.equal(decodeExact(get.value.bytes), text);
	assert.deepEqual(get.value.headers, {
		"cache-control": "public, max-age=300",
		"content-length": String(llmsTxtUtf8Bytes(text)),
		"content-type": "text/plain; charset=utf-8",
		"x-content-type-options": "nosniff",
	});
	assert.deepEqual([get.queries, get.writes], [1, 0], "one KV read per public request");
	report.requests.publicGet = { queries: get.queries, writes: get.writes };
	const head = await publicRequest(publicHandler, "/llms.txt", "HEAD");
	assert.deepEqual([head.status, head.hasBody, head.bytes.byteLength], [200, false, 0]);
	assert.deepEqual(head.headers, get.value.headers, "HEAD has the same status and headers");
	assert.equal(JSON.stringify(get.value.headers).includes(row.revision), false, "no revision in public output");
	const query = await counted(() => publicRequest(publicHandler, "/llms.txt?ref=1"));
	assert.deepEqual([query.value.status, query.value.headers["cache-control"], query.queries], [404, "no-store", 0]);
	const post = await counted(() => publicRequest(publicHandler, "/llms.txt", "POST"));
	assert.deepEqual([post.value.status, post.value.headers.allow, post.queries], [405, "GET, HEAD", 0]);
	for (const method of ["PUT", "DELETE", "OPTIONS", "PATCH"]) assert.equal((await publicRequest(publicHandler, "/llms.txt", method)).status, 405, method);
	assert.equal((await publicRequest(publicHandler, "/llms.txt/")).passed, true, "other paths pass through");
	check("output on keeps the stored bytes; GET 200 exact UTF-8 bytes with BOM, text/plain; charset=utf-8, nosniff, public max-age=300, explicit length; HEAD identical status and headers without body; query 404 and other methods 405 without reading storage");

	// ---- Revision conflicts, H1 rule, two editors -------------------------------
	const stale = await call("save-admin-llms-txt", { expectedRevision: save.value.data.llms.revision, text: "# Stale\n" });
	assert.deepEqual([stale.data.success, stale.data.reason], [false, "conflict"]);
	assert.equal((await storedRow()).revision, row.revision, "a conflict writes nothing");
	const noHeading = await call("save-admin-llms-txt", { expectedRevision: row.revision, text: "No heading while output is on\n" });
	assert.deepEqual([noHeading.data.success, noHeading.data.reason, noHeading.data.field], [false, "invalid", "text"]);
	const [first, second] = await Promise.all([
		call("save-admin-llms-txt", { expectedRevision: row.revision, text: "# Editor A\n" }),
		call("save-admin-llms-txt", { expectedRevision: row.revision, text: "# Editor B\n" }),
	]);
	assert.deepEqual([first.data.success, second.data.success].sort(), [false, true], "two saves from one revision: exactly one applies");
	assert.equal([first, second].find((result) => !result.data.success).data.reason, "conflict");
	row = await storedRow();
	const winner = [first, second].find((result) => result.data.success).data.llms;
	assert.deepEqual([JSON.parse(row.value).text, row.revision], [winner.text, winner.revision]);
	check("stale revision conflict and enabled text without H1 refused without writes; two concurrent saves from one revision: one applies, one conflicts");

	// ---- Disable keeps the document --------------------------------------------
	const off = await call("set-admin-llms-txt-enabled", { expectedRevision: row.revision, enabled: false });
	assert.equal(off.data.llms.text, winner.text);
	row = await storedRow();
	assert.deepEqual(JSON.parse(row.value), { version: 1, enabled: false, text: winner.text }, "disabling retains the document");
	assert.equal((await publicRequest(publicHandler)).status, 404);
	const noChange = await counted(() => call("set-admin-llms-txt-enabled", { expectedRevision: row.revision, enabled: false }));
	assert.deepEqual([noChange.value.data.success, noChange.value.data.changed, noChange.writes], [true, false, 0]);
	check("output off retains the document and answers 404; an unchanged switch writes nothing");

	// ---- Byte limits, Unicode and request bound --------------------------------
	const exact = `# T\n${"a".repeat(LLMS_TXT_DOCUMENT_MAX_BYTES - 6)}é`;
	const accepted = await call("save-admin-llms-txt", { expectedRevision: row.revision, text: exact });
	assert.equal(accepted.data.success, true);
	assert.equal(accepted.data.llms.bytes, LLMS_TXT_DOCUMENT_MAX_BYTES);
	row = await storedRow();
	assert.equal(JSON.parse(row.value).text, exact);
	for (const [label, bad] of [["over the bound", `${exact}x`], ["NUL", `# A${NUL}`]]) {
		const refused = await call("save-admin-llms-txt", { expectedRevision: row.revision, text: bad });
		assert.deepEqual([refused.data.success, refused.data.reason], [false, "invalid"], label);
	}
	const surrogate = await call("save-admin-llms-txt", undefined, { raw: `{"expectedRevision":${JSON.stringify(row.revision)},"text":"# A\\ud800"}` });
	assert.deepEqual([surrogate.data.success, surrogate.data.reason], [false, "invalid"], "an escaped unpaired surrogate is refused");
	const oversized = await call("save-admin-llms-txt", { expectedRevision: row.revision, text: "x".repeat(1_100_000) });
	assert.deepEqual([oversized.status, oversized.error?.code], [413, "INVALID_PLUGIN_REQUEST"], "the declared 1 MiB body limit refuses before the handler");
	assert.equal((await storedRow()).revision, row.revision, "no refused request wrote");
	check("exactly 131,072 UTF-8 bytes stored unchanged; 131,073 bytes, NUL and an unpaired surrogate refused; a 1.1 MB request 413 before the handler; no write");

	// ---- Committed write with a lost response: one reload, no retry -------------
	const lostPort = {
		read: async () => { const result = await call("admin-llms-txt"); return { ok: true, value: result.data }; },
		save: async (body) => { await call("save-admin-llms-txt", undefined, { raw: body }); return { ok: false, failure: { type: "transport", message: "connection reset" } }; },
		setEnabled: async () => { throw new Error("not used"); },
		reset: async () => { throw new Error("not used"); },
	};
	const base = (await call("admin-llms-txt")).data;
	const lost = await counted(() => model.runLlmsTxtWrite(lostPort, { kind: "save", base, text: "# After a lost response\n" }));
	assert.equal(lost.value.status, "uncertain");
	assert.deepEqual([lost.value.reload.ok, lost.value.reload.outcome], [true, "sent-value"]);
	assert.equal(lost.writes, 1, "the lost write is not retried");
	row = await storedRow();
	check("a committed save with a lost response: one authoritative reload reports the sent value; one write, no retry");

	// ---- Corrupt record: copy, confirmed revision-checked reset ----------------
	await db.updateTable("options").set({ value: JSON.stringify({ version: 2, enabled: true, text: "# Future\n" }), revision: "smoke-corrupt-1" }).where("name", "=", KEY).execute();
	const corrupt = (await call("admin-llms-txt")).data;
	assert.deepEqual([corrupt.state, corrupt.corrupt.reason, corrupt.revision, corrupt.text], ["corrupt", "unsupported-version", "smoke-corrupt-1", null]);
	assert.deepEqual(JSON.parse(corrupt.corrupt.copy), { version: 2, enabled: true, text: "# Future\n" }, "the copy is the parsed value serialized again");
	assert.equal((await publicRequest(publicHandler)).status, 503);
	const overCorrupt = await call("save-admin-llms-txt", { expectedRevision: "smoke-corrupt-1", text: "# New\n" });
	assert.deepEqual([overCorrupt.data.success, overCorrupt.data.reason], [false, "blocked"], "a corrupt record is never overwritten by a save");
	assert.equal((await call("reset-admin-llms-txt", { expectedRevision: "smoke-corrupt-1" })).status, 400, "the reset needs explicit confirmation");
	const staleReset = await call("reset-admin-llms-txt", { expectedRevision: "smoke-old", confirm: true });
	assert.deepEqual([staleReset.data.success, staleReset.data.reason], [false, "conflict"]);
	assert.equal((await storedRow()).revision, "smoke-corrupt-1");
	const reset = await call("reset-admin-llms-txt", { expectedRevision: "smoke-corrupt-1", confirm: true });
	assert.deepEqual([reset.data.success, reset.data.llms.state], [true, "absent"]);
	assert.equal(await storedRow(), null);
	const resetValid = await call("save-admin-llms-txt", { expectedRevision: null, text: "# Valid\n" });
	const validReset = await call("reset-admin-llms-txt", { expectedRevision: resetValid.data.llms.revision, confirm: true });
	assert.deepEqual([validReset.data.success, validReset.data.reason], [false, "blocked"], "a valid record is never reset");
	check("unsupported version is corrupt with a re-serialized copy and 503; save refused; reset needs confirm and the current revision; a valid record is not reset");

	// ---- Malformed stored JSON: unavailable, operator recovery only -------------
	await db.updateTable("options").set({ value: "{not json", revision: "smoke-malformed-1" }).where("name", "=", KEY).execute();
	const unreadable = (await call("admin-llms-txt")).data;
	assert.deepEqual([unreadable.state, unreadable.revision, unreadable.corrupt], ["unavailable", null, null]);
	assert.equal((await publicRequest(publicHandler)).status, 503);
	for (const [route, body] of [["save-admin-llms-txt", { expectedRevision: null, text: "# Overwrite\n" }], ["set-admin-llms-txt-enabled", { expectedRevision: "smoke-malformed-1", enabled: false }], ["reset-admin-llms-txt", { expectedRevision: "smoke-malformed-1", confirm: true }]]) {
		const result = await call(route, body);
		assert.deepEqual([result.data.success, result.data.reason], [false, "unavailable"], route);
	}
	assert.deepEqual({ ...await storedRow() }, { name: KEY, value: "{not json", revision: "smoke-malformed-1" }, "nothing overwrites malformed JSON");
	await db.deleteFrom("options").where("name", "=", KEY).where("revision", "=", "smoke-malformed-1").execute();
	check("malformed stored JSON throws before a revision: unavailable state, 503, every write refused, the row unchanged");

	// ---- Other owner and deactivated plugin ------------------------------------
	const otherPlugin = nativePlugin("competing-route");
	const other = runtimeFor(otherPlugin);
	const otherCall = client(otherPlugin, other.runtime);
	assert.equal((await otherCall("admin-llms-txt")).data.owner, "competing-route");
	const blocked = await otherCall("save-admin-llms-txt", { expectedRevision: null, text: "# Other\n" });
	assert.deepEqual([blocked.data.success, blocked.data.reason], [false, "blocked"]);
	const otherPublic = await counted(() => publicRequest(other.publicHandler, "/llms.txt", "GET", "competing-route"));
	assert.deepEqual([otherPublic.value.passed, otherPublic.queries], [true, 0], "another owner keeps the address; storage is not read");
	const shipitButPlugin = await publicRequest(other.publicHandler);
	assert.equal(shipitButPlugin.passed, true, "a runtime owner other than Shipit passes");
	runtime.enabled = false;
	const deactivated = await publicRequest(publicHandler);
	assert.equal(deactivated.passed, true, "a deactivated plugin yields /llms.txt");
	assert.equal((await call("admin-llms-txt")).status, 404);
	runtime.enabled = true;
	check("another owner: writes blocked, middleware passes before reading storage; deactivated plugin: public request passes, admin route 404");

	mkdirSync(new URL("llms-review/", reviewRoot), { recursive: true });
	writeFileSync(new URL("llms-review/native-sql-smoke.json", reviewRoot), `${JSON.stringify(report, null, 2)}\n`);
	console.log(`Native llms.txt SQLite smoke passed: ${report.checks.length} checks; public GET ${report.requests.publicGet.queries} query, admin read ${report.requests.adminRead.queries}, save ${report.requests.save.queries} queries with ${report.requests.save.writes} write.`);
} finally {
	await db.destroy();
}
