// Native internal-link candidate source proof on a disposable in-memory
// SQLite fixture. Statement and row counts are driver-returned values; they do
// not measure physical reads, CPU or Cloudflare D1 cost, and Postgres or the
// sandbox runner are not exercised.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === "--target" && ["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(args[1]),
	"Usage: node scripts/published-host/internal-link-source-smoke.mjs --target native-1.1.0|native-1.2.0|native-1.3.0");
process.env.SHIPIT_HOST_TARGET = args[1];
const { sourceRoot, target } = await import("./host-loader.mjs");
assert.equal(target.name, args[1], "The loader must use the selected native dependency graph");
globalThis.fetch = async () => { throw new Error("External networking is disabled in this smoke check"); };

const { Kysely, CompiledQuery } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runInternalLinkNativeSourceSelfcheck } = await import(new URL(
	"packages/emdash-plugin-seo/src/internal-link-native-source.selfcheck.ts", sourceRoot));
const statements = [];

// Observe the connection result before Kysely returns it to the port.
// Fixture setup, changes and cleanup use the same connection outside measured calls.
function observedDialect(dialect) {
	return new Proxy(dialect, {
		get(object, property) {
			const value = Reflect.get(object, property, object);
			if (property !== "createDriver") return typeof value === "function" ? value.bind(object) : value;
			return () => {
				const driver = object.createDriver();
				const observed = new WeakMap();
				const originals = new WeakMap();
				return new Proxy(driver, {
					get(owner, key) {
						if (key === "acquireConnection") return async (...args) => {
							const connection = await owner.acquireConnection(...args);
							if (observed.has(connection)) return observed.get(connection);
							const wrapped = new Proxy(connection, {
								get(origin, method) {
									const member = Reflect.get(origin, method, origin);
									if (method !== "executeQuery") return typeof member === "function" ? member.bind(origin) : member;
									return async (query) => {
										assert.ok(statements.length < 20000, "The synthetic smoke exceeded its statement bound");
										const entry = { sql: query.sql, parameters: [...query.parameters], returnedRows: 0, rowKeys: [], textBytes: { t: 0, e: 0 } };
										statements.push(entry);
										try {
											const result = await member.call(origin, query);
											entry.returnedRows = result.rows.length;
											entry.rowKeys = [...new Set(result.rows.flatMap((row) => Object.keys(row)))].sort();
											for (const row of result.rows) {
												for (const [column, cell] of Object.entries(row)) {
													const prefix = /^([te])\d+_text$/.exec(column)?.[1];
													if (prefix && typeof cell === "string") entry.textBytes[prefix] = Math.max(entry.textBytes[prefix], Buffer.byteLength(cell));
												}
											}
											return result;
										} catch (error) {
											entry.error = error instanceof Error ? error.message : String(error);
											throw error;
										}
									};
								},
							});
							observed.set(connection, wrapped);
							originals.set(wrapped, connection);
							return wrapped;
						};
						if (key === "releaseConnection") return (connection, ...args) =>
							owner.releaseConnection(originals.get(connection) ?? connection, ...args);
						const member = Reflect.get(owner, key, owner);
						return typeof member === "function" ? member.bind(owner) : member;
					},
				});
			};
		},
	});
}

const db = new Kysely({ dialect: observedDialect(createDialect({ url: ":memory:" })) });
const report = {
	target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", workers: 1, status: "running",
	measurementLimit: "Driver-returned statements and rows only. Query plans and counts are not physical reads, CPU or Cloudflare D1 cost; Postgres and sandbox are not exercised.",
	measurements: [], plans: [],
};

const WINDOW_COLUMNS = ["deleted_at", "id", "locale", "status", "translation_group"];
const LIMITS = { window: 200, projection: 25, membership: 1601, "upper-id": 1, sentinel: 1, collection: 1, fields: 6, taxonomy: 1, terms: 8 };
const planLabels = new Set(["dense-page", "sparse-empty-page", "metadata-page", "membership-dense-page", "taxonomy-page"]);

function kindOf({ sql }) {
	if (!/^\s*select\b/i.test(sql)) return "write";
	if (/\bfrom "ec_[a-z0-9_]+"/i.test(sql)) {
		if (/\bcase\b/i.test(sql)) return "projection";
		if (/^\s*select "id", "locale", "translation_group", "status", "deleted_at" from /i.test(sql)) return "window";
		if (/^\s*select "id" from /i.test(sql)) return /order by "id" desc/i.test(sql) ? "upper-id" : "sentinel";
		return "content-other";
	}
	if (/\bfrom "content_taxonomies"/i.test(sql)) return "membership";
	if (/\bfrom "_emdash_collections"/i.test(sql)) return "collection";
	if (/\bfrom "_emdash_fields"/i.test(sql)) return "fields";
	if (/\bfrom "_emdash_taxonomy_defs"/i.test(sql)) return "taxonomy";
	if (/\bfrom "taxonomies"/i.test(sql)) return "terms";
	return "other";
}

function assertBoundedRead(entry) {
	const kind = kindOf(entry);
	assert.ok(kind in LIMITS, `A measured source operation issued an unexpected ${kind} statement: ${entry.sql.slice(0, 160)}`);
	assert.doesNotMatch(entry.sql, /\bcount\s*\(/i, "The source must not count a result set");
	assert.doesNotMatch(entry.sql, /(?:\bselect\s+(?:distinct\s+)?|,)\s*(?:"[^"]+"\.)?\*/i, "The source must use an explicit projection");
	assert.doesNotMatch(entry.sql, /"(?:body|data|revisions|live_revision_id|draft_revision_id)"/i,
		"The source must not read bodies, data documents or revisions");
	assert.match(entry.sql, /\blimit \?$/i, "Every source read must bind an explicit row limit");
	const limit = entry.parameters.at(-1);
	assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= LIMITS[kind], `A ${kind} read exceeded its SQL row limit`);
	assert.ok(entry.returnedRows <= limit, `A ${kind} read returned more rows than its limit`);
	if (kind === "window") assert.ok(entry.rowKeys.every((column) => WINDOW_COLUMNS.includes(column)), "The window returned a non-identity column");
	if (kind === "membership") {
		assert.equal(limit, 1601, "Membership must use the 1,601-row overflow sentinel");
		assert.ok(entry.returnedRows <= 1600, "Membership returned beyond the pivot key bound");
		assert.doesNotMatch(entry.sql, /"(?:locale|status|deleted_at|published_at|scheduled_at)"/i, "Legacy pivot columns are not authoritative");
		assert.ok(entry.rowKeys.every((column) => column === "entry_id" || column === "taxonomy_id"), "Membership returned an unexpected column");
	}
	if (kind === "projection") {
		assert.ok(entry.rowKeys.every((column) => ["id", "version", "updated_at"].includes(column) || /^[te]\d+_(?:kind|text)$/.test(column)),
			"The projection returned an unbounded or unexpected column");
		assert.ok(entry.textBytes.t <= 2048 && entry.textBytes.e <= 8192, "A projected editorial value exceeded its raw byte bound");
	}
}

async function measure(label, action) {
	assert.ok(typeof label === "string" && label.length > 0 && label.length <= 80, "A measurement needs a bounded label");
	const start = statements.length;
	let value;
	let failure;
	try {
		value = await action();
	} catch (error) {
		failure = error;
	}
	const run = statements.slice(start);
	const count = (kind) => run.filter((entry) => kindOf(entry) === kind).length;
	const rows = (kind) => run.filter((entry) => kindOf(entry) === kind).reduce((sum, entry) => sum + entry.returnedRows, 0);
	assert.equal(count("write"), 0, label + ": a measured source operation wrote");
	for (const entry of run) assertBoundedRead(entry);
	const measurement = {
		label, outcome: failure ? "rejected" : "returned", queries: run.length, writes: 0,
		definitionQueries: count("collection") + count("fields") + count("taxonomy") + count("terms"),
		windowRows: rows("window"), membershipQueries: count("membership"), membershipRows: rows("membership"),
		sentinelQueries: count("sentinel"), projectionQueries: count("projection"), projectionRows: rows("projection"),
		upperIdQueries: count("upper-id"),
		maxProjectedTitleBytes: Math.max(0, ...run.map((entry) => entry.textBytes.t)),
		maxProjectedExcerptBytes: Math.max(0, ...run.map((entry) => entry.textBytes.e)),
	};
	assert.ok(measurement.definitionQueries <= 4, label + ": more than four definition reads");
	if (value && typeof value === "object" && "examinedRows" in value) {
		assert.ok(count("window") <= 1 && count("sentinel") <= 1 && count("projection") <= 1 && count("upper-id") === 0,
			label + ": a page exceeded its window, sentinel or projection count");
		assert.ok(measurement.membershipQueries <= 1, label + ": a page issued more than one membership batch");
		assert.ok(value.examinedRows <= measurement.windowRows, label + ": examined rows were not fetched");
		assert.equal(value.candidates.length, measurement.projectionRows, label + ": candidates differ from projected rows");
		Object.assign(measurement, {
			examinedRows: value.examinedRows, candidates: value.candidates.length, exhausted: value.exhausted,
		});
	} else if (value && typeof value === "object" && "kind" in value) {
		assert.ok(count("window") + count("membership") + count("projection") + count("sentinel") === 0 && count("upper-id") <= 1,
			label + ": scope resolution read content beyond its upper ID");
		measurement.resolution = value.kind;
	} else {
		assert.ok(failure, label + ": unexpected measured value");
		assert.equal(count("window") + count("membership") + count("projection") + count("sentinel"), 0,
			label + ": a refused page read content");
		measurement.refusal = failure?.reason ?? "error";
	}
	report.measurements.push(measurement);

	if (planLabels.has(label)) {
		const seen = new Set();
		for (const entry of run) {
			const kind = kindOf(entry);
			if (entry.error || seen.has(kind) || !["window", "membership", "sentinel", "projection"].includes(kind)) continue;
			seen.add(kind);
			assert.ok(report.plans.length < 16, "The smoke exceeded its query-plan bound");
			const plan = await db.executeQuery(CompiledQuery.raw(`EXPLAIN QUERY PLAN ${entry.sql}`, entry.parameters));
			report.plans.push({
				label, kind, sql: entry.sql.slice(0, 640), sqlTruncated: entry.sql.length > 640,
				parameterCount: entry.parameters.length, rows: plan.rows.slice(0, 8).map((row) => row.detail),
				rowsTruncated: plan.rows.length > 8,
			});
		}
	}
	if (failure) throw failure;
	return value;
}

let failure;
try {
	report.selfcheck = await runInternalLinkNativeSourceSelfcheck(db, { measure });
	const byLabel = new Map(report.measurements.map((entry) => [entry.label, entry]));
	for (const label of ["dense-page", "sparse-empty-page", "metadata-page", "membership-dense-page", "taxonomy-page", "group-term-page", "scope-changed-page"]) {
		assert.ok(byLabel.has(label), "Missing measurement " + label);
	}
	const grouped = byLabel.get("group-term-page");
	assert.equal(grouped.membershipQueries, 1, "Translation-group membership must use one batch");
	assert.equal(grouped.membershipRows, 2, "Only the two group assignments may match");
	assert.equal(grouped.candidates, 1, "The group page stops at its one-match budget");
	const dense = byLabel.get("membership-dense-page");
	assert.equal(dense.membershipQueries, 1);
	assert.equal(dense.membershipRows, 1600, "Eight selected terms over a 200-row window must reach the 1,600-row key bound");
	assert.equal(byLabel.get("sparse-empty-page").sentinelQueries, 1, "A full sparse window needs one ID-only sentinel");
	assert.equal(byLabel.get("upper-boundary-page").sentinelQueries, 0, "A window ending at the upper ID needs no sentinel");
	assert.equal(byLabel.get("dense-page").membershipQueries, 0, "No taxonomy filter means no membership read");
	assert.equal(byLabel.get("scope-changed-page").refusal, "scope-changed");
	for (const kind of ["window", "membership", "projection"]) {
		assert.ok(report.plans.some((plan) => plan.kind === kind), "Record a " + kind + " query plan");
	}
	report.status = "passed";
} catch (error) {
	failure = error;
	report.status = "failed";
	report.error = error instanceof Error ? error.message.slice(0, 2048) : String(error).slice(0, 2048);
} finally {
	await db.destroy();
}
const output = new URL(`artifacts/current-validation/internal-link-source-smoke-${target.name}.json`, sourceRoot);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
assert.ok(Buffer.byteLength(serialized) <= 64 * 1024, "The smoke report exceeded 64 KiB");
mkdirSync(new URL("artifacts/current-validation/", sourceRoot), { recursive: true });
writeFileSync(output, serialized);
if (failure) throw failure;
console.log(`Native internal link source smoke passed: ${report.selfcheck.cases.length} fixture cases, ${report.selfcheck.stubCases.length} refusal cases, ${report.measurements.length} measured calls, ${report.plans.length} query plans; SQLite :memory:, one worker. Report: ${output.pathname}`);
