import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Kysely, SqliteDialect } from "kysely";

import { createNativeLinkCandidatePort } from "./internal-link-native-source.ts";
import { createNativeScoreScanSource } from "./score-scan-native-source.ts";
import { ScoreScanSelectionError } from "./score-scan-source.ts";

// Execute real SQLite statements with D1's total parameter ceiling. This is an
// adapter regression check, not a replacement for running the Workers runtime.
const sqlite = new DatabaseSync(":memory:");
const reads: { sql: string; parameters: readonly unknown[]; rows: number }[] = [];
const database = {
	close: () => sqlite.close(),
	prepare(sql: string) {
		const statement = sqlite.prepare(sql);
		const check = (parameters: readonly unknown[]) => assert.ok(parameters.length <= 100,
			"D1 parameter ceiling exceeded: " + parameters.length + " in " + sql);
		return {
			reader: statement.columns().length > 0,
			all(parameters: readonly SQLInputValue[]) {
				check(parameters);
				const rows = statement.all(...parameters);
				reads.push({ sql, parameters, rows: rows.length });
				return rows;
			},
			run(parameters: readonly SQLInputValue[]) {
				check(parameters);
				const result = statement.run(...parameters);
				return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
			},
			iterate(parameters: readonly SQLInputValue[]) {
				check(parameters);
				return statement.iterate(...parameters);
			},
		};
	},
};
const db = new Kysely({ dialect: new SqliteDialect({ database }) });
const postId = (index: number) => "post-" + String(index).padStart(3, "0");
const entryGroup = (index: number) => 'entry"\\' + postId(index);
const treeGroup = (index: number) => 'tree"\\' + String(index).padStart(3, "0");
const tagGroups = Array.from({ length: 8 }, (_, index) => "tag'" + index);
const nativeFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("This selfcheck cannot access the network."); };

try {
	sqlite.exec(`
		CREATE TABLE _emdash_collections (
			id TEXT, slug TEXT, hidden INTEGER, routable INTEGER, url_pattern TEXT, title_field TEXT
		);
		CREATE TABLE _emdash_fields (id TEXT, collection_id TEXT, slug TEXT, type TEXT, column_type TEXT);
		CREATE TABLE _emdash_taxonomy_defs (
			id TEXT, name TEXT, collections TEXT, hierarchical INTEGER, translation_group TEXT
		);
		CREATE TABLE _emdash_taxonomy_def_groups (id TEXT, name TEXT, collections TEXT, hierarchical INTEGER);
		CREATE TABLE taxonomies (
			id TEXT PRIMARY KEY, name TEXT, slug TEXT, label TEXT, parent_id TEXT, locale TEXT, translation_group TEXT
		);
		CREATE TABLE content_taxonomies (
			collection TEXT, entry_id TEXT, taxonomy_id TEXT, PRIMARY KEY (collection, entry_id, taxonomy_id)
		);
		CREATE TABLE ec_posts (
			id TEXT PRIMARY KEY, slug TEXT, title TEXT, status TEXT, locale TEXT, translation_group TEXT,
			deleted_at TEXT, version INTEGER, updated_at TEXT
		);
		CREATE INDEX membership_lookup ON content_taxonomies (collection, entry_id, taxonomy_id);
		INSERT INTO _emdash_collections VALUES ('posts', 'posts', 0, 1, '/posts/{slug}', 'title');
		INSERT INTO _emdash_fields VALUES ('title', 'posts', 'title', 'string', 'TEXT');
		INSERT INTO _emdash_taxonomy_defs VALUES ('tags', 'tags', '["posts"]', 0, 'tag-definition');
		INSERT INTO _emdash_taxonomy_defs VALUES ('tree', 'tree', '["posts"]', 1, 'tree-definition');
	`);
	const insertTerm = sqlite.prepare("INSERT INTO taxonomies VALUES (?, ?, ?, ?, ?, ?, ?)");
	const insertPost = sqlite.prepare("INSERT INTO ec_posts VALUES (?, ?, ?, 'published', 'en', ?, NULL, 1, '2026-10-23T00:00:00Z')");
	const assign = sqlite.prepare("INSERT INTO content_taxonomies VALUES ('posts', ?, ?)");
	for (const [index, group] of tagGroups.entries()) insertTerm.run("tag-" + index, "tags", "tag-" + index, "Tag " + index, null, "en", group);
	for (let index = 0; index < 201; index++) {
		insertPost.run(postId(index), postId(index), "Title " + index, entryGroup(index));
		for (const group of tagGroups) assign.run(entryGroup(index), group);
	}

	const links = createNativeLinkCandidatePort(db);
	const resolvedLinks = await links.resolveScope({
		collection: "posts", locale: "en",
		taxonomy: { taxonomy: "tags", termIds: tagGroups.map((_, index) => "tag-" + index) },
	}, ["posts"]);
	assert.equal(resolvedLinks.kind, "resolved");
	if (resolvedLinks.kind !== "resolved") throw new Error("Expected a link scope.");
	// Exact boundary coverage: the old IN-list query crosses 100 parameters
	// before the candidate window itself reaches its permitted 200 rows.
	for (const candidateRows of [90, 91, 97, 98, 99, 100, 101, 200]) {
		const start = reads.length;
		const page = await links.page(resolvedLinks.scope, null, { candidateRows, scopeMatches: 25 });
		assert.deepEqual(page.candidates.map((candidate) => candidate.entryId), Array.from({ length: 25 }, (_, index) => postId(index)));
		assert.equal(page.examinedRows, 25);
		assert.equal(page.nextAfterId, postId(24));
		assert.equal(page.exhausted, false);
		const memberships = reads.slice(start).filter((read) => read.sql.includes('from "content_taxonomies"'));
		assert.equal(memberships.length, 1, "one membership statement per window");
		assert.equal(memberships[0].rows, candidateRows * 8);
	}
	insertPost.run(postId(999), postId(999), "Later post", entryGroup(999));
	const foundLinks: string[] = [];
	let linkCursor: string | null = null;
	for (let step = 0; step < 20; step++) {
		const page = await links.page(resolvedLinks.scope, linkCursor, { candidateRows: 200, scopeMatches: 25 });
		foundLinks.push(...page.candidates.map((candidate) => candidate.entryId));
		if (page.exhausted) break;
		assert.notEqual(page.nextAfterId, linkCursor);
		linkCursor = page.nextAfterId;
	}
	assert.deepEqual(foundLinks, Array.from({ length: 201 }, (_, index) => postId(index)),
		"pagination neither skips the unconsumed window nor includes later IDs");
	assert.equal(new Set(foundLinks).size, foundLinks.length);

	// 512 distinct groups, two locales per group, a 255-parent frontier and a
	// back edge to the root exercise both deduplication and cycle termination.
	for (let index = 0; index < 512; index++) {
		const parent = index === 0 ? treeGroup(511) : index <= 255 ? treeGroup(0) : treeGroup(index - 255);
		for (const locale of ["en", "nl"]) {
			const term = "tree-" + locale + "-" + String(index).padStart(3, "0");
			insertTerm.run(term, "tree", term, "Tree " + index, parent, locale, treeGroup(index));
		}
	}
	for (const index of [97, 199, 200]) assign.run(entryGroup(index), treeGroup(511));
	const scores = createNativeScoreScanSource(db);
	const request = {
		collection: "posts", status: "published" as const, locale: "en",
		taxonomies: [{ taxonomy: "tree", termIds: ["tree-en-000"], includeDescendants: true }],
	};
	const scoreScope = await scores.resolveScope(request, ["posts"]);
	assert.deepEqual(scoreScope.taxonomies[0].termGroups,
		Array.from({ length: 512 }, (_, index) => treeGroup(index)).sort());
	assert.equal(scoreScope.upperId, postId(999));
	let scoreCursor: string | null = null;
	const foundScores: string[] = [];
	for (let step = 0; step < 20; step++) {
		const page = await scores.page(scoreScope, scoreCursor, { candidateBudget: 200, matchBudget: 1 });
		assert.ok(page.fetchedCandidates <= 200);
		assert.ok(page.examinedCandidates <= page.fetchedCandidates);
		assert.ok(page.matchedReferences <= 1);
		foundScores.push(...page.references.map((reference) => reference.id));
		if (page.exhausted) break;
		assert.notEqual(page.nextAfterId, scoreCursor);
		scoreCursor = page.nextAfterId;
	}
	assert.deepEqual(foundScores, [97, 199, 200].map(postId));
	const reference = { collection: "posts", id: postId(200), locale: "en", afterId: postId(200) };
	assert.equal(await scores.revalidate(scoreScope, reference), "matching");
	sqlite.prepare("DELETE FROM content_taxonomies WHERE entry_id = ? AND taxonomy_id = ?").run(entryGroup(200), treeGroup(511));
	assert.equal(await scores.revalidate(scoreScope, reference), "no-longer-matching", "membership is read again before acceptance");

	const groups = scoreScope.taxonomies[0].termGroups;
	const intersected = {
		...scoreScope,
		taxonomies: [
			{ taxonomy: "first", termIds: ["first"], includeDescendants: false, termGroups: groups.slice(0, 256) },
			{ taxonomy: "second", termIds: ["second"], includeDescendants: false, termGroups: groups.slice(256) },
		],
	};
	const secondReference = { ...reference, id: postId(199), afterId: postId(199) };
	assert.equal(await scores.revalidate(intersected, secondReference), "no-longer-matching");
	assign.run(entryGroup(199), treeGroup(0));
	assert.equal(await scores.revalidate(intersected, secondReference), "matching",
		"selections intersect while groups within one selection are alternatives");

	insertTerm.run("overflow", "tree", "overflow", "Overflow", treeGroup(0), "en", "overflow");
	await assert.rejects(() => scores.resolveScope(request, ["posts"]), ScoreScanSelectionError,
		"a 513th distinct descendant must be refused");
	sqlite.prepare("DELETE FROM taxonomies WHERE id = ?").run("overflow");
	insertTerm.run("malformed", "tree", "malformed", "Malformed", treeGroup(0), "en", null);
	await assert.rejects(() => scores.resolveScope(request, ["posts"]), /Invalid descendant translation group/);
	sqlite.prepare("DELETE FROM taxonomies WHERE id = ?").run("malformed");

	const termRequest = { collection: "posts", taxonomy: "tree", locale: "en", search: "", limit: 50, cursor: null };
	const firstTerms = await scores.termOptions(termRequest, ["posts"]);
	const secondTerms = await scores.termOptions({ ...termRequest, cursor: firstTerms.nextCursor }, ["posts"]);
	assert.equal(firstTerms.terms.length, 50);
	assert.equal(secondTerms.terms.length, 50);
	assert.equal(new Set([...firstTerms.terms, ...secondTerms.terms].map((term) => term.id)).size, 100);
	assert.ok(firstTerms.terms.at(-1)!.id < secondTerms.terms[0].id, "term cursors preserve ordering");

	assert.ok(reads.every((read) => read.parameters.length <= 100));
	assert.ok(reads.some((read) => read.rows === 1600), "all 200 candidates retain all eight memberships");
	console.log("Native source bind budgets: 200-row windows, 512-group cycles, revalidation and cursors passed on SQLite with a 100-parameter execution ceiling.");
} finally {
	globalThis.fetch = nativeFetch;
	await db.destroy();
}
