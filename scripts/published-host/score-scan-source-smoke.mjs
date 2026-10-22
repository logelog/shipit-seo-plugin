// Native score scan source proof on a disposable synthetic SQLite schema.
// Returned projection rows and consumed candidates are reported separately;
// neither counter measures physical rows read or Cloudflare D1 cost.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
assert.ok(args.length === 2 && args[0] === "--target" && ["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(args[1]),
	"Usage: node scripts/published-host/score-scan-source-smoke.mjs --target native-1.1.0|native-1.2.0|native-1.3.0");
process.env.SHIPIT_HOST_TARGET = args[1];
const { sourceRoot, target } = await import("./host-loader.mjs");
assert.equal(target.name, args[1], "The loader must use the selected native dependency graph");
globalThis.fetch = async () => { throw new Error("External networking is disabled in this smoke check"); };

const { Kysely, CompiledQuery } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runScoreScanNativeSourceSelfcheck } = await import(new URL(
	"packages/emdash-plugin-seo/src/score-scan-native-source.selfcheck.ts", sourceRoot));
const statements = [];

// Observe the connection result before Kysely returns it to the source port.
// Fixture setup and cleanup use the same connection outside measured calls.
function observedDialect(dialect) {
	return new Proxy(dialect, {
		get(object, property) {
			if (property !== "createDriver") {
				const value = Reflect.get(object, property, object);
				return typeof value === "function" ? value.bind(object) : value;
			}
			return () => {
				const driver = object.createDriver();
				const connections = new WeakMap();
				const originals = new WeakMap();
				return new Proxy(driver, {
					get(owner, key) {
						if (key === "acquireConnection") return async (...args) => {
							const connection = await owner.acquireConnection(...args);
							if (connections.has(connection)) return connections.get(connection);
							const observed = new Proxy(connection, {
								get(origin, method) {
									if (method === "executeQuery") return async (query) => {
										const entry = { sql: query.sql, parameters: [...query.parameters], returnedRows: 0, rowKeys: [] };
										assert.ok(statements.length < 10000, "The synthetic smoke exceeded its statement bound");
										statements.push(entry);
										try {
											const result = await origin.executeQuery(query);
											entry.returnedRows = result.rows.length;
											entry.rowKeys = [...new Set(result.rows.flatMap((row) => Object.keys(row)))].sort();
											return result;
										} catch (error) {
											entry.error = error instanceof Error ? error.message : String(error);
											throw error;
										}
									};
									const value = Reflect.get(origin, method, origin);
									return typeof value === "function" ? value.bind(origin) : value;
								},
							});
							connections.set(connection, observed);
							originals.set(observed, connection);
							return observed;
						};
						if (key === "releaseConnection") return (connection, ...args) =>
							owner.releaseConnection(originals.get(connection) ?? connection, ...args);
						const value = Reflect.get(owner, key, owner);
						return typeof value === "function" ? value.bind(owner) : value;
					},
				});
			};
		},
	});
}

const db = new Kysely({ dialect: observedDialect(createDialect({ url: ":memory:" })) });
const report = {
	target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", workers: 1,
	status: "running", measurements: [], plans: [],
	measurementLimit: "Driver-returned projection rows and consumed candidates only. EXPLAIN plans do not measure physical reads or D1 cost.",
};
const candidateColumns = ["id", "locale", "translation_group", "status", "deleted_at"];
const planLabels = new Set([
	"dense-page", "dense-next-page", "sparse-page", "zero-match-page",
	"empty-boundary-page", "upper-boundary-page", "taxonomy-page",
	"term-options-page-0", "descendant-at-limit", "descendant-limit",
]);
const isContent = ({ sql }) => /\bfrom "ec_[a-z0-9_]+"/i.test(sql);
const contentProjection = ({ sql }) => {
	const match = sql.match(/^\s*select ([\s\S]+?) from "ec_[a-z0-9_]+"/i);
	if (!match) return null;
	return match[1].split(",").map((column) => column.trim().replace(/^"|"$/g, ""));
};
const isCandidate = (entry) => contentProjection(entry)?.length === candidateColumns.length;
const isContentId = (entry) => isContent(entry) && contentProjection(entry)?.length === 1;
const kindOf = (entry) => isCandidate(entry) ? "candidate-window" : isContentId(entry) ? "content-id" :
	/\bfrom "content_taxonomies"/i.test(entry.sql) ? "membership" :
	/^\s*select distinct "translation_group" from "taxonomies"/i.test(entry.sql) ? "descendants" :
	/\bfrom "taxonomies"/i.test(entry.sql) ? "terms" : "definition";

function assertProjectedReads(run) {
	for (const entry of run) {
		assert.match(entry.sql, /^\s*select\b/i, "A measured source operation must only read");
		assert.doesNotMatch(entry.sql, /\bcount\s*\(/i, "The source must not count an entire result set");
		assert.doesNotMatch(entry.sql, /(?:\bselect\s+(?:distinct\s+)?|,)\s*(?:"[^"]+"\.)?\*/i,
			"The source must use an explicit projection");
		assert.doesNotMatch(entry.sql, /"(?:body|content|data|metadata|seo|excerpt)"/i,
			"The source must not read content bodies or metadata");
		if (!isContent(entry)) continue;
		const columns = contentProjection(entry);
		assert.ok(columns && (columns.length === 1 && columns[0] === "id" ||
			columns.length === candidateColumns.length && candidateColumns.every((column) => columns.includes(column))),
			"Content reads must project only the candidate keys or an ID");
		assert.ok(entry.rowKeys.every((column) => columns.includes(column)),
			"The native driver returned an unexpected content field");
		assert.match(entry.sql, /\blimit \?$/i, "A content read must bind an explicit row limit");
		const limit = entry.parameters.at(-1);
		assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= (isCandidate(entry) ? 200 : 1),
			"A content read exceeded its SQL row limit");
		assert.ok(entry.returnedRows <= (isCandidate(entry) ? 200 : 1),
			"A content projection exceeded its row bound");
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
	assertProjectedReads(run);
	const candidateRows = run.filter(isCandidate).reduce((sum, entry) => sum + entry.returnedRows, 0);
	const idReads = run.filter(isContentId);
	const page = value && typeof value === "object" && "fetchedCandidates" in value ? value : null;
	const measurement = {
		label, outcome: failure ? "rejected" : "returned", queries: run.length,
		returnedProjectionRows: run.reduce((sum, entry) => sum + entry.returnedRows, 0),
		returnedCandidateRows: candidateRows,
		returnedMembershipRows: run.filter((entry) => kindOf(entry) === "membership")
			.reduce((sum, entry) => sum + entry.returnedRows, 0),
		returnedTermRows: run.filter((entry) => ["terms", "descendants"].includes(kindOf(entry)))
			.reduce((sum, entry) => sum + entry.returnedRows, 0),
		contentIdQueries: idReads.length,
		returnedContentIds: idReads.reduce((sum, entry) => sum + entry.returnedRows, 0),
	};
	if (page) {
		assert.ok(run.filter(isCandidate).length <= 1, "A page may fetch only one candidate window");
		assert.equal(candidateRows, page.fetchedCandidates, "Fetched candidates must match driver-returned candidate rows");
		assert.ok(page.examinedCandidates >= 0 && page.examinedCandidates <= page.fetchedCandidates,
			"Consumed candidates must stay within the fetched window");
		assert.ok(page.matchedReferences >= 0 && page.matchedReferences <= 25 &&
			page.matchedReferences <= page.examinedCandidates, "Matches must stay within their candidate and result budgets");
		assert.equal(page.matchedReferences, page.references.length);
		assert.ok(idReads.length <= 1, "A page may read at most one separate exhaustion sentinel");
		Object.assign(measurement, {
			fetchedCandidates: page.fetchedCandidates, examinedCandidates: page.examinedCandidates,
			matchedReferences: page.matchedReferences, sentinelQueries: idReads.length,
			returnedSentinelRows: measurement.returnedContentIds,
		});
	}
	report.measurements.push(measurement);

	const representatives = new Map();
	for (const entry of run) if (!entry.error && !representatives.has(kindOf(entry))) representatives.set(kindOf(entry), entry);
	const priority = ["candidate-window", "membership", "descendants", "terms", "definition", "content-id"];
	for (const kind of (planLabels.has(label) ? priority.filter((key) => representatives.has(key)).slice(0, 2) : [])) {
		assert.ok(report.plans.length < 32, "The smoke exceeded its query-plan bound");
		const entry = representatives.get(kind);
		const plan = await db.executeQuery(CompiledQuery.raw(`EXPLAIN QUERY PLAN ${entry.sql}`, entry.parameters));
		report.plans.push({
			label, kind, sql: entry.sql.slice(0, 1024), sqlTruncated: entry.sql.length > 1024,
			parameterCount: entry.parameters.length,
			rows: plan.rows.slice(0, 16), rowsTruncated: plan.rows.length > 16,
		});
	}
	if (failure) throw failure;
	return value;
}

let failure;
try {
	report.selfcheck = await runScoreScanNativeSourceSelfcheck(db, { measure });
	assert.ok(report.measurements.length > 0, "The selfcheck must measure its source-port calls");
	assert.ok(report.plans.some((plan) => plan.kind === "candidate-window"), "Record a candidate-window query plan");
	assert.ok(report.plans.some((plan) => plan.kind === "membership"), "Record a taxonomy-membership query plan");
	assert.ok(report.plans.some((plan) => plan.kind === "terms"), "Record a term query plan");
	report.status = "passed";
} catch (error) {
	failure = error;
	report.status = "failed";
	report.error = error instanceof Error ? error.message : String(error);
} finally {
	await db.destroy();
}
const output = new URL(`artifacts/current-validation/score-scan-source-smoke-${target.name}.json`, sourceRoot);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
assert.ok(Buffer.byteLength(serialized) <= 64 * 1024, "The smoke report exceeded 64 KiB");
mkdirSync(new URL("artifacts/current-validation/", sourceRoot), { recursive: true });
writeFileSync(output, serialized);
if (failure) throw failure;
console.log(`Native score scan source smoke passed: ${report.selfcheck.cases.length} cases, ${report.measurements.length} measured calls, ${report.plans.length} query plans; SQLite :memory:, one worker. Report: ${output.pathname}`);
