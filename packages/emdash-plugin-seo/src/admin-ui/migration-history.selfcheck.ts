import assert from "node:assert/strict";

import {
	CORE_SEO_MIGRATION_VERSION,
	SEO_ADMIN_CONTRACT_VERSION,
	type LegacySeoOverrideSnapshot,
	type SeoAdminMigrationRecord,
	type SeoAdminMigrationStatusResponse,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	batchesFromMigrationHistory,
	fetchCompleteMigrationBatch,
	mergeMigrationHistoryPages,
} from "./migration-history.ts";

function record(batchId: string, index: number): SeoAdminMigrationRecord {
	return {
		id: `${batchId}:${index}`,
		batchId,
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		ref: `posts:${index.toString().padStart(3, "0")}`,
		collection: "posts",
		entryId: String(index),
		sourceOverrideId: `posts:${index}`,
		sourceOverride: {} as LegacySeoOverrideSnapshot,
		conflictPolicy: "skip",
		before: {
			title: null,
			description: null,
			image: null,
			canonical: null,
			noIndex: false,
		},
		after: {
			title: null,
			description: null,
			image: null,
			canonical: null,
			noIndex: false,
		},
		status: "applied",
		createdAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
		updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
	};
}

const batchId = "migration:test";
const allRecords = Array.from({ length: 150 }, (_, index) => record(batchId, index));
const visibleHistory = {
	success: true,
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: "test",
	generatedAt: "2026-08-01T00:00:00.000Z",
	migrationVersion: CORE_SEO_MIGRATION_VERSION,
	writeAvailable: true,
	items: allRecords.slice(50),
	hasMore: true,
} as SeoAdminMigrationStatusResponse;
assert.equal(
	batchesFromMigrationHistory(visibleHistory)[0]?.records.length,
	100,
	"latest history remains an explicitly partial view",
);

const complete = await fetchCompleteMigrationBatch(batchId, async ({ cursor }) => {
	const start = Number.parseInt(cursor ?? "0", 10) || 0;
	const items = allRecords.slice(start, start + 80);
	const next = start + items.length;
	return {
		success: true,
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: "test",
		generatedAt: "2026-08-01T00:00:00.000Z",
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		writeAvailable: true,
		items,
		hasMore: next < allRecords.length,
		...(next < allRecords.length ? { cursor: String(next) } : {}),
	} as SeoAdminMigrationStatusResponse;
});
assert.equal(complete.records.length, 150);
assert.equal(new Set(complete.records.map((item) => item.id)).size, 150);

await assert.rejects(
	() =>
		fetchCompleteMigrationBatch(
			batchId,
			async () =>
				({
					success: true,
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: "test",
					generatedAt: "2026-08-01T00:00:00.000Z",
					migrationVersion: CORE_SEO_MIGRATION_VERSION,
					writeAvailable: true,
					items: [],
					hasMore: true,
					cursor: "stuck",
				}) as SeoAdminMigrationStatusResponse,
		),
	/pagination did not advance/i,
);

await assert.rejects(
	() =>
		fetchCompleteMigrationBatch(
			batchId,
			async () =>
				({
					success: true,
					contractVersion: SEO_ADMIN_CONTRACT_VERSION,
					engineVersion: "test",
					generatedAt: "2026-08-01T00:00:00.000Z",
					migrationVersion: CORE_SEO_MIGRATION_VERSION,
					writeAvailable: true,
					items: Array.from({ length: 201 }, (_, index) => record(batchId, index)),
					hasMore: false,
				}) as SeoAdminMigrationStatusResponse,
		),
	/page exceeded the requested limit/i,
);

let duplicatePageCalls = 0;
await assert.rejects(
	() =>
		fetchCompleteMigrationBatch(batchId, async ({ limit }) => {
			duplicatePageCalls += 1;
			if (duplicatePageCalls > 4)
				throw new Error("Duplicate-page fixture exceeded its safety bound");
			return {
				success: true,
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				engineVersion: "test",
				generatedAt: "2026-08-01T00:00:00.000Z",
					migrationVersion: CORE_SEO_MIGRATION_VERSION,
				writeAvailable: true,
					items: Array.from({ length: limit }, () => record(batchId, 1)),
				hasMore: true,
				cursor: `duplicate-page-${duplicatePageCalls}`,
			} as SeoAdminMigrationStatusResponse;
		}),
	/supported 500-record limit/i,
);
assert.equal(duplicatePageCalls, 3);

let sparsePageCalls = 0;
await assert.rejects(
	() =>
		fetchCompleteMigrationBatch(batchId, async () => {
			sparsePageCalls += 1;
			if (sparsePageCalls > 10) throw new Error("Sparse-page fixture exceeded its safety bound");
			return {
				success: true,
				contractVersion: SEO_ADMIN_CONTRACT_VERSION,
				engineVersion: "test",
				generatedAt: "2026-08-01T00:00:00.000Z",
					migrationVersion: CORE_SEO_MIGRATION_VERSION,
				writeAvailable: true,
					items: [record(batchId, sparsePageCalls)],
				hasMore: true,
				cursor: `sparse-page-${sparsePageCalls}`,
			} as SeoAdminMigrationStatusResponse;
		}),
	/supported 10-page limit/i,
);
assert.equal(sparsePageCalls, 10);

function historyPage(
	items: SeoAdminMigrationRecord[],
	hasMore: boolean,
	cursor?: string,
): SeoAdminMigrationStatusResponse {
	return {
		success: true,
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: "test",
		generatedAt: "2026-08-01T00:00:00.000Z",
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		writeAvailable: true,
		items,
		hasMore,
		...(cursor ? { cursor } : {}),
	} as SeoAdminMigrationStatusResponse;
}
const newestHistory = historyPage([record("newest", 3), record("split", 2)], true, "page-1");
const olderHistory = historyPage([record("split", 2), record("split", 1), record("oldest", 0)], false);
const mergedHistory = mergeMigrationHistoryPages(newestHistory, olderHistory);
assert.deepEqual(
	mergedHistory.items.map((item) => item.id),
	["newest:3", "split:2", "split:1", "oldest:0"],
	"older history pages append without duplicating records",
);
assert.equal(mergedHistory.hasMore, false);
assert.equal(
	batchesFromMigrationHistory(mergedHistory).find((batch) => batch.id === "split")?.records.length,
	2,
	"a batch split across pages is regrouped after loading older records",
);
assert.throws(
	() => mergeMigrationHistoryPages(newestHistory, historyPage([record("oldest", 0)], true, "page-1")),
	/did not advance/,
);

console.log("shipit-seo migration history self-check passed");
