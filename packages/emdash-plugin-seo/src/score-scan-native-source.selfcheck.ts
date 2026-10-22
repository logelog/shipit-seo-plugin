import assert from "node:assert/strict";

import { createNativeScoreScanSource } from "./score-scan-native-source.ts";
import {
	SCORE_SCAN_CANDIDATE_BUDGET,
	SCORE_SCAN_EXPANDED_TERM_LIMIT,
	SCORE_SCAN_MATCH_BUDGET,
	SCORE_SCAN_TERM_PAGE_LIMIT,
	SCORE_SCAN_TERM_CURSOR_LIMIT,
	ScoreScanSelectionError,
	type ScoreScanReferencePage,
	type ScoreScanSourceRequest,
	type ScoreScanSourceScope,
	type ScoreScanTermOptionsRequest,
} from "./score-scan-source.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostDatabase = any;

interface SelfcheckOptions {
	measure?: <T>(label: string, action: () => Promise<T>) => Promise<T>;
}

interface PageObservation {
	label: string;
	fetchedCandidates: number;
	examinedCandidates: number;
	matchedReferences: number;
	nextAfterId: string | null;
	exhausted: boolean;
}

const collections = ["scan_dense", "scan_sparse", "scan_empty", "scan_membership", "scan_other"] as const;
const category = "scan_category";
const tag = "scan_tag";
const foreign = "scan_foreign";
const wide = "scan_wide";
const id = (index: number) => "01K" + String(index).padStart(23, "0");
const termId = (index: number) => "01T" + String(index).padStart(23, "0");

function invalidSelection(error: unknown): error is ScoreScanSelectionError {
	assert.ok(error instanceof ScoreScanSelectionError);
	assert.equal(error.name, "ScoreScanSelectionError");
	assert.equal(error.code, "invalid-selection");
	return true;
}

function plainSourceError(error: unknown): error is Error {
	assert.ok(error instanceof Error);
	assert.ok(!(error instanceof ScoreScanSelectionError));
	assert.notEqual((error as Error & { code?: string }).code, "invalid-selection");
	return true;
}

export async function runScoreScanNativeSourceSelfcheck(db: HostDatabase, options: SelfcheckOptions = {}) {
	const measure = options.measure ?? (async <T>(_label: string, action: () => Promise<T>) => action());
	const measuredLabels = new Set([
		"dense-page", "dense-target-page", "upper-boundary-page", "sparse-page", "sparse-target-page",
		"sparse-zero-page", "sparse-final-page", "zero-match-page", "empty-boundary-page", "taxonomy-page",
		"term-options-page-0", "translated-term-options", "escaped-term-search-2100",
	]);
	const observed = <T>(label: string, action: () => Promise<T>) =>
		measuredLabels.has(label) ? measure(label, action) : action();
	const created: string[] = [];
	const cases: string[] = [];
	const pages: PageObservation[] = [];
	const termPages: Array<{ label: string; returnedTerms: number; nextCursor: string | null }> = [];
	const native = createNativeScoreScanSource(db);
	const contentRow = (index: number, values: Record<string, unknown> = {}) => ({
		id: id(index), locale: "en", status: "published", translation_group: id(index),
		deleted_at: null, scheduled_at: null, slug: null, body: "Content bodies are outside the source projection.",
		...values,
	});
	const termRow = (index: number, name: string, label: string, values: Record<string, unknown> = {}) => ({
		id: termId(index), name, label, slug: "term-" + index, locale: "en",
		translation_group: termId(index), parent_id: null, data: '{"private":"not projected"}', sort_order: 0,
		...values,
	});
	const insert = async (table: string, rows: readonly Record<string, unknown>[]) => {
		for (let start = 0; start < rows.length; start += 50) {
			await db.insertInto(table).values(rows.slice(start, start + 50)).execute();
		}
	};
	const resolve = (values: Partial<ScoreScanSourceRequest> = {}) => native.resolveScope({
		collection: "scan_dense", status: "all", locale: null, taxonomies: [], ...values,
	}, collections);
	const page = async (
		label: string,
		scope: ScoreScanSourceScope,
		afterId: string | null = null,
		matchBudget = SCORE_SCAN_MATCH_BUDGET,
		candidateBudget = SCORE_SCAN_CANDIDATE_BUDGET,
	) => {
		const result = await observed(label, () => native.page(scope, afterId, { candidateBudget, matchBudget }));
		assert.ok(result.fetchedCandidates <= candidateBudget, label + ": fetched window exceeds its budget");
		assert.ok(result.examinedCandidates <= candidateBudget, label + ": consumed window exceeds its budget");
		assert.ok(result.examinedCandidates <= result.fetchedCandidates, label + ": consumed rows were not fetched");
		assert.equal(result.matchedReferences, result.references.length, label + ": match counter differs from references");
		assert.ok(result.references.length <= matchBudget, label + ": returned too many matching references");
		assert.equal(new Set(result.references.map((reference) => reference.id)).size, result.references.length);
		for (const reference of result.references) {
			assert.equal(reference.collection, scope.collection);
			assert.equal(reference.afterId, reference.id);
			assert.ok(reference.locale.length > 0);
			assert.ok(afterId === null || reference.id > afterId);
			assert.ok(scope.upperId !== null && reference.id <= scope.upperId);
		}
		assert.ok(result.references.every((reference, index) => index === 0 || result.references[index - 1].id < reference.id));
		if (result.examinedCandidates > 0) assert.ok(result.nextAfterId !== null && (afterId === null || result.nextAfterId > afterId));
		pages.push({
			label, fetchedCandidates: result.fetchedCandidates, examinedCandidates: result.examinedCandidates,
			matchedReferences: result.matchedReferences, nextAfterId: result.nextAfterId, exhausted: result.exhausted,
		});
		return result;
	};
	const termOptions = async (label: string, values: Partial<ScoreScanTermOptionsRequest> = {}) => {
		const result = await observed(label, () => native.termOptions({
			collection: "scan_membership", taxonomy: category, locale: "en", search: "", cursor: null,
			limit: SCORE_SCAN_TERM_PAGE_LIMIT, ...values,
		}, collections));
		assert.ok(result.terms.length <= (values.limit ?? SCORE_SCAN_TERM_PAGE_LIMIT));
		for (const term of result.terms) {
			assert.deepEqual(Object.keys(term).sort(), ["id", "label", "locale", "translationGroup"]);
			assert.ok(term.translationGroup.length > 0);
		}
		termPages.push({ label, returnedTerms: result.terms.length, nextCursor: result.nextCursor });
		return result;
	};
	const ids = (result: ScoreScanReferencePage) => result.references.map((reference) => reference.id);
	const selection = (taxonomy: string, termIds: readonly string[], includeDescendants = false) => ({
		taxonomy, termIds, includeDescendants,
	});

	try {
		for (const collection of collections) {
			const table = "ec_" + collection;
			await db.schema.createTable(table)
				.addColumn("id", "text", (column: any) => column.primaryKey())
				.addColumn("locale", "text", (column: any) => column.notNull().defaultTo("en"))
				.addColumn("status", "text", (column: any) => column.notNull())
				.addColumn("translation_group", "text")
				.addColumn("deleted_at", "text")
				.addColumn("scheduled_at", "text")
				.addColumn("slug", "text")
				.addColumn("body", "text")
				.execute();
			created.push(table);
		}
		await db.schema.createTable("_emdash_taxonomy_def_groups")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("name", "text", (column: any) => column.notNull().unique())
			.addColumn("hierarchical", "integer", (column: any) => column.notNull())
			.addColumn("collections", "text", (column: any) => column.notNull())
			.execute();
		created.push("_emdash_taxonomy_def_groups");
		await db.schema.createTable("_emdash_taxonomy_defs")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("name", "text", (column: any) => column.notNull())
			.addColumn("locale", "text", (column: any) => column.notNull())
			.addColumn("translation_group", "text")
			.addColumn("collections", "text")
			.addColumn("hierarchical", "integer")
			.addColumn("label", "text")
			.addUniqueConstraint("_emdash_taxonomy_defs_name_locale_unique", ["name", "locale"])
			.execute();
		created.push("_emdash_taxonomy_defs");
		await db.schema.createTable("taxonomies")
			.addColumn("id", "text", (column: any) => column.primaryKey())
			.addColumn("name", "text", (column: any) => column.notNull())
			.addColumn("slug", "text", (column: any) => column.notNull())
			.addColumn("label", "text", (column: any) => column.notNull())
			.addColumn("locale", "text", (column: any) => column.notNull())
			.addColumn("translation_group", "text")
			.addColumn("parent_id", "text")
			.addColumn("data", "text")
			.addColumn("sort_order", "integer")
			.addUniqueConstraint("taxonomies_name_slug_locale_unique", ["name", "slug", "locale"])
			.execute();
		created.push("taxonomies");
		await db.schema.createIndex("idx_taxonomies_name_locale").on("taxonomies").columns(["name", "locale"]).execute();
		await db.schema.createIndex("idx_taxonomies_parent").on("taxonomies").column("parent_id").execute();
		await db.schema.createTable("content_taxonomies")
			.addColumn("collection", "text", (column: any) => column.notNull())
			.addColumn("entry_id", "text", (column: any) => column.notNull())
			.addColumn("taxonomy_id", "text", (column: any) => column.notNull())
			.addColumn("locale", "text")
			.addColumn("status", "text")
			.addPrimaryKeyConstraint("scan_assignments_pk", ["collection", "entry_id", "taxonomy_id"])
			.execute();
		created.push("content_taxonomies");

		await insert("ec_scan_dense", Array.from({ length: 260 }, (_, index) => contentRow(index + 1)));
		await insert("ec_scan_sparse", Array.from({ length: 430 }, (_, index) =>
			contentRow(index + 1, { status: [205, 407].includes(index + 1) ? "published" : "draft" })));
		const membershipRows = [
			contentRow(1), contentRow(2, { locale: "fr", status: "draft", translation_group: id(1) }),
			contentRow(3), contentRow(4), contentRow(5),
			contentRow(6, { scheduled_at: "2026-10-05 12:00:00" }), contentRow(7, { status: "scheduled" }),
			contentRow(8), contentRow(9, { deleted_at: "2026-10-04 12:00:00" }), contentRow(10),
			contentRow(11, { locale: "fr" }), contentRow(12), contentRow(13, { translation_group: null }),
		];
		await insert("ec_scan_membership", membershipRows);
		await insert("_emdash_taxonomy_def_groups", [
			{ id: "def-category", name: category, hierarchical: 1, collections: '["scan_membership"]' },
			{ id: "def-tag", name: tag, hierarchical: 0, collections: '["scan_membership"]' },
			{ id: "def-foreign", name: foreign, hierarchical: 1, collections: '["scan_other"]' },
			{ id: "def-wide", name: wide, hierarchical: 1, collections: '["scan_membership"]' },
		]);
		await insert("_emdash_taxonomy_defs", [category, tag, foreign, wide].map((name) => ({
			id: name + "-en", name, locale: "en", translation_group: "def-" + name,
			collections: '["scan_other"]', hierarchical: 0, label: name,
		})));
		const a = termId(1000), aFr = termId(1001), b = termId(1002);
		const child = termId(1003), grandchild = termId(1004), x = termId(1100), y = termId(1101);
		await insert("taxonomies", [
			termRow(1000, category, "Alpha"),
			termRow(1001, category, "Alpha FR", { locale: "fr", translation_group: a }),
			termRow(1002, category, "Beta"),
			termRow(1003, category, "Child", { parent_id: a }),
			termRow(1004, category, "Grandchild", { parent_id: child }),
			termRow(1005, category, "Child FR", { locale: "fr", translation_group: child, parent_id: a }),
			termRow(1100, tag, "Tag X"), termRow(1101, tag, "Tag Y"),
			termRow(1200, foreign, "Foreign"),
		]);
		const assignments: Record<string, unknown>[] = [];
		const assign = (index: number, terms: readonly string[], collection = "scan_membership") => {
			assignments.push(...terms.map((taxonomy_id) => ({
				collection, entry_id: id(index), taxonomy_id, locale: "fr", status: "draft",
			})));
		};
		assign(1, [a, b, x]); assign(3, [b, x]); assign(4, [child, x]); assign(5, [a, y]);
		assign(6, [a, x]); assign(7, [a, x]); assign(8, [a, x]); assign(9, [a, x]);
		assign(10, [a, x], "scan_other"); assign(11, [a, x]); assign(12, [grandchild, x]);
		await insert("content_taxonomies", assignments);

		const dense = await resolve();
		assert.equal(dense.upperId, id(260));
		const first = await page("dense-page", dense);
		assert.deepEqual(ids(first), Array.from({ length: 25 }, (_, index) => id(index + 1)));
		assert.equal(first.examinedCandidates, 25);
		assert.equal(first.nextAfterId, id(25));
		assert.equal(first.exhausted, false);
		const target = await page("dense-target-page", dense, first.nextAfterId, 2);
		assert.deepEqual(ids(target), [id(26), id(27)]);
		assert.equal(target.examinedCandidates, 2);
		assert.equal(target.nextAfterId, id(27));
		const next = await page("dense-next-page", dense, target.nextAfterId);
		assert.equal(next.references[0].id, id(28));
		cases.push("dense match budgets preserve every unconsumed matching ID");
		await insert("ec_scan_dense", [contentRow(261)]);
		const boundary = await page("upper-boundary-page", dense, id(250));
		assert.deepEqual(ids(boundary), Array.from({ length: 10 }, (_, index) => id(index + 251)));
		assert.equal(boundary.nextAfterId, id(260));
		assert.equal(boundary.exhausted, true);
		const seen: string[] = [];
		let after: string | null = null;
		for (let index = 0; index < 20; index += 1) {
			const result = await page("dense-traversal-" + index, dense, after);
			seen.push(...ids(result));
			after = result.nextAfterId;
			if (result.exhausted) break;
		}
		assert.deepEqual(seen, Array.from({ length: 260 }, (_, index) => id(index + 1)));
		cases.push("all traversal excludes IDs above the starting upper boundary");

		const sparse = await resolve({ collection: "scan_sparse", status: "published", locale: "en" });
		const sparseFirst = await page("sparse-page", sparse);
		assert.deepEqual(ids(sparseFirst), []);
		assert.equal(sparseFirst.examinedCandidates, 200);
		assert.equal(sparseFirst.nextAfterId, id(200));
		assert.equal(sparseFirst.exhausted, false);
		const sparseTarget = await page("sparse-target-page", sparse, sparseFirst.nextAfterId, 1);
		assert.deepEqual(ids(sparseTarget), [id(205)]);
		assert.equal(sparseTarget.examinedCandidates, 5);
		assert.equal(sparseTarget.nextAfterId, id(205));
		const sparseMiddle = await page("sparse-zero-page", sparse, sparseTarget.nextAfterId);
		assert.deepEqual(ids(sparseMiddle), []);
		assert.equal(sparseMiddle.examinedCandidates, 200);
		assert.equal(sparseMiddle.nextAfterId, id(405));
		assert.equal(sparseMiddle.exhausted, false);
		const sparseLast = await page("sparse-final-page", sparse, sparseMiddle.nextAfterId);
		assert.deepEqual(ids(sparseLast), [id(407)]);
		assert.equal(sparseLast.examinedCandidates, 25);
		assert.equal(sparseLast.nextAfterId, id(430));
		assert.equal(sparseLast.exhausted, true);
		cases.push("sparse predicates consume bounded raw ID windows before filtering");
		const zeroScope = { ...dense, locale: "de" };
		const zero = await page("zero-match-page", zeroScope);
		assert.equal(zero.matchedReferences, 0);
		assert.equal(zero.examinedCandidates, 200);
		assert.equal(zero.nextAfterId, id(200));
		const zeroLast = await page("zero-match-final-page", zeroScope, zero.nextAfterId);
		assert.equal(zeroLast.examinedCandidates, 60);
		assert.equal(zeroLast.exhausted, true);
		const emptyScope = await resolve({ collection: "scan_empty" });
		assert.equal(emptyScope.upperId, null);
		await insert("ec_scan_empty", [contentRow(1)]);
		const empty = await page("empty-boundary-page", emptyScope);
		assert.equal(empty.fetchedCandidates, 0);
		assert.equal(empty.examinedCandidates, 0);
		assert.deepEqual(ids(empty), []);
		assert.equal(empty.nextAfterId, null);
		assert.equal(empty.exhausted, true);
		assert.deepEqual(ids(await page("new-empty-collection-run", await resolve({ collection: "scan_empty" }))), [id(1)]);
		cases.push("zero-match progress and null starting boundaries remain explicit");
		await assert.rejects(() => native.page(dense, null, { candidateBudget: 201, matchBudget: 25 }), plainSourceError);
		await assert.rejects(() => native.page(dense, null, { candidateBudget: 200, matchBudget: 26 }), plainSourceError);
		await assert.rejects(() => native.page(dense, null, { candidateBudget: 0, matchBudget: 1 }), plainSourceError);

		const taxonomyRequest = {
			collection: "scan_membership", status: "published" as const, locale: "en",
			taxonomies: [selection(category, [a, aFr, a, b]), selection(tag, [x])],
		};
		const taxonomyScope = await resolve(taxonomyRequest);
		assert.deepEqual([...taxonomyScope.taxonomies[0].termGroups].sort(), [a, b].sort());
		assert.deepEqual(taxonomyScope.taxonomies[0].termIds, taxonomyRequest.taxonomies[0].termIds);
		const taxonomyPage = await page("taxonomy-page", taxonomyScope);
		assert.deepEqual(ids(taxonomyPage), [id(1), id(3), id(6), id(8)]);
		cases.push("OR terms and AND taxonomies use translation groups and the exact collection");
		const translated = await resolve({
			...taxonomyRequest, status: "all", locale: null,
			taxonomies: [selection(category, [aFr]), selection(tag, [x])],
		});
		assert.deepEqual(ids(await page("translated-membership-page", translated)), [id(1), id(2), id(6), id(7), id(8), id(11)]);
		const scheduled = await resolve({
			...taxonomyRequest, status: "scheduled", taxonomies: [selection(category, [a]), selection(tag, [x])],
		});
		assert.deepEqual(ids(await page("scheduled-status-page", scheduled)), [id(7)]);
		cases.push("locale and status belong to content rows, including shared translations");

		const descendantRequest = {
			...taxonomyRequest, taxonomies: [selection(category, [a], true), selection(tag, [x])],
		};
		const descendantScope = await resolve(descendantRequest);
		assert.deepEqual([...descendantScope.taxonomies[0].termGroups].sort(), [a, child, grandchild].sort());
		assert.deepEqual(ids(await page("descendant-page", descendantScope)), [id(1), id(4), id(6), id(8), id(12)]);
		await db.updateTable("taxonomies").set({ parent_id: grandchild }).where("id", "=", a).execute();
		assert.deepEqual((await resolve(descendantRequest)).taxonomies[0].termGroups, descendantScope.taxonomies[0].termGroups);
		await db.updateTable("taxonomies").set({ parent_id: b }).where("translation_group", "=", child).execute();
		const childReference = { collection: "scan_membership", id: id(4), locale: "en", afterId: id(4) };
		assert.equal(await native.revalidate(descendantScope, childReference), "matching");
		assert.equal(await native.revalidate(await resolve(descendantRequest), childReference), "no-longer-matching");
		await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(tag, [x], true)] }), invalidSelection);
		cases.push("descendants deduplicate translations, terminate cycles and retain their resolved hierarchy");

		assert.equal(await native.revalidate(taxonomyScope, {
			collection: "scan_membership", id: id(13), locale: "en", afterId: id(13),
		}), "no-longer-matching");
		const reference = taxonomyPage.references[0];
		assert.equal(await native.revalidate(taxonomyScope, reference), "matching");
		await db.deleteFrom("content_taxonomies").where("collection", "=", "scan_membership")
			.where("entry_id", "=", id(1)).where("taxonomy_id", "=", x).execute();
		assert.equal(await native.revalidate(taxonomyScope, reference), "no-longer-matching");
		await insert("content_taxonomies", [{ collection: "scan_membership", entry_id: id(1), taxonomy_id: x, locale: null, status: null }]);
		await db.updateTable("ec_scan_membership").set({ status: "draft" }).where("id", "=", id(1)).execute();
		assert.equal(await native.revalidate(taxonomyScope, reference), "no-longer-matching");
		await db.updateTable("ec_scan_membership").set({ status: "published", locale: "fr" }).where("id", "=", id(1)).execute();
		assert.equal(await native.revalidate(translated, reference), "no-longer-matching");
		await db.updateTable("ec_scan_membership").set({ locale: "en", deleted_at: "2026-10-04 12:00:00" }).where("id", "=", id(1)).execute();
		assert.notEqual(await native.revalidate(taxonomyScope, reference), "matching");
		await db.deleteFrom("ec_scan_membership").where("id", "=", id(8)).execute();
		assert.equal(await native.revalidate(taxonomyScope, taxonomyPage.references.find((item) => item.id === id(8))!), "missing");
		cases.push("revalidation rejects changed assignments, status, locale and deleted entries");

		await insert("taxonomies", Array.from({ length: 60 }, (_, index) =>
			termRow(2000 + index, category, "Option " + String(index).padStart(3, "0"))));
		await insert("taxonomies", [
			termRow(2100, category, "Literal % mark"), termRow(2101, category, "Literal _ mark"),
			termRow(2102, category, "Literal " + String.fromCharCode(92) + " mark"), termRow(2103, category, "Literal plain mark"),
			termRow(2104, category, "Option 000 FR", { locale: "fr", translation_group: termId(2000) }),
			termRow(2105, category, "\u00dcber"),
		]);
		const selectedTerms: string[] = [];
		let cursor: string | null = null;
		let firstCursor: string | null = null;
		for (let index = 0; index < 5; index += 1) {
			const result = await termOptions("term-options-page-" + index, { search: "Option", limit: 17, cursor });
			assert.ok(result.terms.every((term) => term.locale === "en"));
			selectedTerms.push(...result.terms.map((term) => term.id));
			cursor = result.nextCursor;
			firstCursor ??= cursor;
			if (cursor === null) break;
		}
		assert.equal(selectedTerms.length, 60);
		assert.equal(new Set(selectedTerms).size, 60);
		assert.deepEqual([...selectedTerms].sort(), Array.from({ length: 60 }, (_, index) => termId(2000 + index)).sort());
		assert.equal(cursor, null);
		assert.ok(firstCursor);
		for (const values of [{ locale: "fr" }, { taxonomy: tag }, { search: "Literal" }, { collection: "scan_other" }]) {
			await assert.rejects(() => termOptions("term-cursor-scope-refusal", { search: "Option", cursor: firstCursor, ...values }), invalidSelection);
		}
		await assert.rejects(() => termOptions("malformed-term-cursor", { cursor: "not-a-cursor" }), invalidSelection);
		await assert.rejects(() => termOptions("oversized-term-cursor", { cursor: "x".repeat(SCORE_SCAN_TERM_CURSOR_LIMIT + 1) }), invalidSelection);
		await assert.rejects(() => termOptions("oversized-term-page", { limit: 51 }), invalidSelection);
		const translatedOptions = await termOptions("translated-term-options", { locale: "fr", search: "Option" });
		assert.deepEqual(translatedOptions.terms, [{ id: termId(2104), translationGroup: termId(2000), label: "Option 000 FR", locale: "fr" }]);
		for (const [search, expected] of [["%", 2100], ["_", 2101], ["\\", 2102]] as const) {
			const result = await termOptions("escaped-term-search-" + expected, { search });
			assert.deepEqual(result.terms.map((term) => term.id), [termId(expected)]);
		}
		assert.deepEqual((await termOptions("bound-term-search", { search: "' OR 1=1 --" })).terms, []);
		assert.deepEqual((await termOptions("identical-unicode-search", { search: "\u00dcber" })).terms.map((term) => term.id), [termId(2105)]);
		cases.push("term pages project one locale and scope their cursors without wildcard expansion");

		const wideRoot = termId(3000);
		await insert("taxonomies", [termRow(3000, wide, "Wide root")]);
		await insert("taxonomies", Array.from({ length: SCORE_SCAN_EXPANDED_TERM_LIMIT - 2 }, (_, index) =>
			termRow(3001 + index, wide, "Wide child " + index, { parent_id: wideRoot })));
		await insert("taxonomies", [
			termRow(3600, wide, "Wide child FR", { locale: "fr", translation_group: termId(3001), parent_id: wideRoot }),
		]);
		const wideRequest = { ...taxonomyRequest, taxonomies: [selection(wide, [wideRoot], true)] };
		const combinedWideRequest = { ...wideRequest, taxonomies: [...wideRequest.taxonomies, selection(tag, [x])] };
		const combined = await measure("descendant-global-at-limit", () => resolve(combinedWideRequest));
		assert.equal(combined.taxonomies.reduce((sum, group) => sum + group.termGroups.length, 0), SCORE_SCAN_EXPANDED_TERM_LIMIT);
		await insert("taxonomies", [termRow(3511, wide, "Last child within the bound", { parent_id: wideRoot })]);
		const bounded = await measure("descendant-at-limit", () => resolve(wideRequest));
		assert.equal(bounded.taxonomies[0].termGroups.length, SCORE_SCAN_EXPANDED_TERM_LIMIT);
		await assert.rejects(() => resolve(combinedWideRequest), (error) =>
			invalidSelection(error) && /descendant|expand|512|limit|many/i.test(error.message));
		await insert("taxonomies", [termRow(3512, wide, "One child beyond the bound", { parent_id: wideRoot })]);
		await assert.rejects(() => measure("descendant-limit", () => resolve(wideRequest)), (error) =>
			invalidSelection(error) && /descendant|expand|512|limit|many/i.test(error.message));
		await assert.rejects(() => resolve({
			...taxonomyRequest, taxonomies: [selection(wide, Array.from({ length: 65 }, (_, index) => termId(3000 + index)))],
		}), invalidSelection);
		cases.push("descendant expansion accepts its bound and rejects overflow without truncation");

		await assert.rejects(() => native.resolveScope({ ...taxonomyRequest, collection: "scan_dense; DROP TABLE taxonomies" }, collections), invalidSelection);
		await assert.rejects(() => native.resolveScope(taxonomyRequest, ["scan_dense"]), invalidSelection);
		await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(foreign, [termId(1200)])] }), invalidSelection);
		await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(category, [x])] }), invalidSelection);
		await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(category, [termId(9999)])] }), invalidSelection);
		await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection("scan_missing", [a])] }), invalidSelection);
		await assert.rejects(() => termOptions("missing-taxonomy", { taxonomy: "scan_missing" }), invalidSelection);
		await assert.rejects(() => termOptions("detached-taxonomy", { taxonomy: foreign }), invalidSelection);
		cases.push("scope resolution refuses unauthorized collections and invalid taxonomy selections");

		for (const [index, values] of [
			[4000, { translation_group: "" }], [4001, { translation_group: null }], [4002, { locale: "" }],
		] as const) {
			const label = "Corrupt term " + index;
			await insert("taxonomies", [termRow(index, category, label, values)]);
			await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(category, [termId(index)])] }), plainSourceError);
			await assert.rejects(() => termOptions("corrupt-term-" + index, { search: label, locale: null }), plainSourceError);
		}
		await insert("taxonomies", [termRow(4003, category, "Corrupt term ID", { id: "" })]);
		await assert.rejects(() => termOptions("corrupt-term-id", { search: "Corrupt term ID" }), plainSourceError);
		for (const attachments of ["not-json", "null", "{}", "[3]", '["scan_membership",null]']) {
			await db.updateTable("_emdash_taxonomy_def_groups").set({ collections: attachments }).where("name", "=", category).execute();
			await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(category, [a])] }), plainSourceError);
			await assert.rejects(() => termOptions("corrupt-definition-attachments"), plainSourceError);
		}
		await db.updateTable("_emdash_taxonomy_def_groups").set({ collections: '["scan_membership"]' }).where("name", "=", category).execute();
		for (const hierarchical of [2, "invalid"]) {
			await db.updateTable("_emdash_taxonomy_def_groups").set({ hierarchical }).where("name", "=", category).execute();
			await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(category, [a])] }), plainSourceError);
			await assert.rejects(() => termOptions("corrupt-definition-hierarchy"), plainSourceError);
		}
		await db.deleteFrom("_emdash_taxonomy_def_groups").where("name", "=", category).execute();
		await db.updateTable("_emdash_taxonomy_defs").set({ collections: '["scan_membership"]', hierarchical: null }).where("name", "=", category).execute();
		await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(category, [a])] }), plainSourceError);
		await assert.rejects(() => termOptions("null-definition-hierarchy"), plainSourceError);
		await db.updateTable("_emdash_taxonomy_defs").set({ collections: null, hierarchical: 0 }).where("name", "=", category).execute();
		await assert.rejects(() => resolve({ ...taxonomyRequest, taxonomies: [selection(category, [a])] }), plainSourceError);
		await assert.rejects(() => termOptions("null-definition-attachments"), plainSourceError);
		cases.push("corrupt persisted terms and taxonomy definitions remain host failures");
		await assert.rejects(() => native.resolveScope({
			collection: "scan_missing", status: "all", locale: null, taxonomies: [],
		}, ["scan_missing"]), (error) => plainSourceError(error) && /no such table/i.test(error.message));
		cases.push("an allowed missing collection table remains a SQLite failure");
		return { cases, pages, termPages, pureCases };
	} finally {
		for (const table of created.reverse()) await db.schema.dropTable(table).execute();
	}
}


const pureCases = [
	"null upper boundary does not query the database",
	"invalid bounds and scope fail before database access",
	"database read failures remain failures",
	"locale syntax is validated without content reads",
	"corrupt persisted projections remain host failures",
	"missing taxonomies are typed selection refusals across read styles",
];
let prohibitedReads = 0;
const unavailableDatabase = new Proxy({}, {
	get() {
		prohibitedReads += 1;
		throw new Error("No database access is allowed in a pure source-bound check.");
	},
});
const pureSource = createNativeScoreScanSource(unavailableDatabase);
const pureScope: ScoreScanSourceScope = { collection: "posts", status: "all", locale: null, taxonomies: [], upperId: null };
assert.deepEqual(await pureSource.page(pureScope, null, { candidateBudget: 200, matchBudget: 25 }), {
	references: [], nextAfterId: null, exhausted: true, fetchedCandidates: 0, examinedCandidates: 0, matchedReferences: 0,
});
for (const budget of [
	{ candidateBudget: 201, matchBudget: 25 }, { candidateBudget: 200, matchBudget: 26 },
	{ candidateBudget: 0, matchBudget: 1 }, { candidateBudget: 1, matchBudget: 0 },
]) await assert.rejects(() => pureSource.page(pureScope, null, budget), plainSourceError);
await assert.rejects(() => pureSource.page({ ...pureScope, collection: "posts;drop" }, null, { candidateBudget: 1, matchBudget: 1 }), plainSourceError);
await assert.rejects(() => pureSource.resolveScope({
	collection: "posts", status: "all", locale: null, taxonomies: [],
}, []), invalidSelection);
assert.deepEqual(await pureSource.page({ ...pureScope, locale: "en-US" }, null, { candidateBudget: 1, matchBudget: 1 }), {
	references: [], nextAfterId: null, exhausted: true, fetchedCandidates: 0, examinedCandidates: 0, matchedReferences: 0,
});
for (const locale of ["en_US", "not a locale"]) {
	await assert.rejects(() => pureSource.page({ ...pureScope, locale }, null, { candidateBudget: 1, matchBudget: 1 }), plainSourceError);
	await assert.rejects(() => pureSource.resolveScope({
		collection: "posts", status: "all", locale, taxonomies: [],
	}, ["posts"]), invalidSelection);
}
const termRequest: ScoreScanTermOptionsRequest = {
	collection: "posts", taxonomy: "tags", locale: null, search: "", cursor: null, limit: 1,
};
await assert.rejects(() => pureSource.termOptions({
	...termRequest, cursor: "x".repeat(SCORE_SCAN_TERM_CURSOR_LIMIT + 1),
}, ["posts"]), invalidSelection);
await assert.rejects(() => pureSource.termOptions({ ...termRequest, search: "x".repeat(257) }, ["posts"]), invalidSelection);
const expandedScope: ScoreScanSourceScope = {
	...pureScope, taxonomies: [{
		taxonomy: "tags", termIds: ["one"], includeDescendants: false,
		termGroups: Array.from({ length: SCORE_SCAN_EXPANDED_TERM_LIMIT + 1 }, (_, index) => "group-" + index),
	}],
};
await assert.rejects(() => pureSource.page(expandedScope, null, { candidateBudget: 1, matchBudget: 1 }), plainSourceError);
await assert.rejects(() => pureSource.revalidate(expandedScope, {
	collection: "posts", id: "one", locale: "en", afterId: "one",
}), plainSourceError);
const malformedScope = {
	...expandedScope, taxonomies: [{ ...expandedScope.taxonomies[0], termGroups: [""] }],
};
await assert.rejects(() => pureSource.page(malformedScope, null, { candidateBudget: 1, matchBudget: 1 }), plainSourceError);
await assert.rejects(() => pureSource.revalidate(malformedScope, {
	collection: "posts", id: "one", locale: "en", afterId: "one",
}), plainSourceError);
await assert.rejects(() => pureSource.revalidate(pureScope, {
	collection: "posts", id: "", locale: "en", afterId: "",
}), plainSourceError);
assert.equal(prohibitedReads, 0);
const readFailure = new Error("Synthetic source read failure");
const failingSource = createNativeScoreScanSource({ selectFrom() { throw readFailure; } });
const readableScope = { ...pureScope, upperId: "one" };
const sameReadFailure = (error: unknown) => plainSourceError(error) && error === readFailure;
await assert.rejects(() => failingSource.page(readableScope, null, { candidateBudget: 1, matchBudget: 1 }), sameReadFailure);
await assert.rejects(() => failingSource.revalidate(readableScope, {
	collection: "posts", id: "one", locale: "en", afterId: "one",
}), sameReadFailure);
const resolveRequest: ScoreScanSourceRequest = { collection: "posts", status: "all", locale: null, taxonomies: [] };
await assert.rejects(() => failingSource.resolveScope(resolveRequest, ["posts"]), sameReadFailure);
await assert.rejects(() => failingSource.termOptions(termRequest, ["posts"]), sameReadFailure);
const queryStub = (first: () => unknown, rows: () => unknown = () => []) => ({
	leftJoin() { return this; },
	select() { return this; },
	where() { return this; },
	orderBy() { return this; },
	limit() { return this; },
	executeTakeFirst: first,
	execute: rows,
});
const asyncFailingSource = createNativeScoreScanSource({
	selectFrom() { return queryStub(() => Promise.reject(readFailure), () => Promise.reject(readFailure)); },
});
await assert.rejects(() => asyncFailingSource.resolveScope(resolveRequest, ["posts"]), sameReadFailure);
await assert.rejects(() => asyncFailingSource.termOptions(termRequest, ["posts"]), sameReadFailure);
for (const values of [
	{ id: null }, { id: "" }, { locale: null }, { locale: "" },
	{ translation_group: null }, { translation_group: "" },
]) {
	const projectedSource = createNativeScoreScanSource({
		selectFrom(table: string) {
			return queryStub(
				() => table.startsWith("_emdash_taxonomy_defs") ? { collections: '["posts"]', hierarchical: 0 } : { id: "one" },
				() => [{ id: "one", translation_group: "one", label: "Term", locale: "en", ...values }],
			);
		},
	});
	await assert.rejects(() => projectedSource.termOptions(termRequest, ["posts"]), plainSourceError);
}
for (const first of [() => undefined, () => Promise.resolve(undefined)]) {
	const missingDefinitionSource = createNativeScoreScanSource({
		selectFrom() { return queryStub(first); },
	});
	await assert.rejects(() => missingDefinitionSource.resolveScope({
		...resolveRequest, taxonomies: [{ taxonomy: "tags", termIds: ["one"], includeDescendants: false }],
	}, ["posts"]), invalidSelection);
	await assert.rejects(() => missingDefinitionSource.termOptions(termRequest, ["posts"]), invalidSelection);
}
console.log("Native score scan source bounds: " + pureCases.length + " cases passed; SQLite fixtures run through the native smoke.");
