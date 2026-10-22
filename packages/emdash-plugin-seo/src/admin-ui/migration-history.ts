import type {
	SeoAdminMigrationRecord,
	SeoAdminMigrationStatusResponse,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

export interface MigrationBatch {
	id: string;
	createdAt: string;
	records: SeoAdminMigrationRecord[];
}

export type FetchMigrationHistoryPage = (options: {
	batchId: string;
	limit: number;
	cursor?: string;
}) => Promise<SeoAdminMigrationStatusResponse>;

const MAX_MIGRATION_BATCH_RECORDS = 500;
const MAX_MIGRATION_BATCH_PAGES = 10;
const MIGRATION_BATCH_PAGE_SIZE = 200;

function migrationBatch(id: string, records: Iterable<SeoAdminMigrationRecord>): MigrationBatch {
	const sorted = [...records].sort((left, right) => left.ref.localeCompare(right.ref));
	return {
		id,
		createdAt: sorted.reduce(
			(latest, item) => (item.createdAt > latest ? item.createdAt : latest),
			sorted[0]?.createdAt ?? "",
		),
		records: sorted,
	};
}

export function mergeMigrationHistoryPages(
	current: SeoAdminMigrationStatusResponse,
	next: SeoAdminMigrationStatusResponse,
): SeoAdminMigrationStatusResponse {
	if (next.hasMore && (!next.cursor || next.cursor === current.cursor)) {
		throw new Error("Migration history pagination did not advance");
	}
	const seen = new Set(current.items.map((item) => item.id));
	return {
		...next,
		items: [...current.items, ...next.items.filter((item) => !seen.has(item.id))],
	};
}

export function batchesFromMigrationHistory(
	history: SeoAdminMigrationStatusResponse | null,
): MigrationBatch[] {
	if (!history) return [];
	const grouped = new Map<string, SeoAdminMigrationRecord[]>();
	for (const record of history.items) {
		const records = grouped.get(record.batchId) ?? [];
		records.push(record);
		grouped.set(record.batchId, records);
	}
	return Array.from(grouped.entries(), ([id, records]) => migrationBatch(id, records)).sort(
		(left, right) => right.createdAt.localeCompare(left.createdAt),
	);
}

export async function fetchCompleteMigrationBatch(
	batchId: string,
	fetchPage: FetchMigrationHistoryPage,
): Promise<MigrationBatch> {
	const records = new Map<string, SeoAdminMigrationRecord>();
	const seenCursors = new Set<string>();
	let scanned = 0;
	let pages = 0;
	let cursor: string | undefined;
	do {
		if (pages >= MAX_MIGRATION_BATCH_PAGES)
			throw new Error("Migration batch exceeds the supported 10-page limit");
		const requestedLimit = Math.min(
			MIGRATION_BATCH_PAGE_SIZE,
			MAX_MIGRATION_BATCH_RECORDS - scanned,
		);
		if (requestedLimit <= 0)
			throw new Error("Migration batch exceeds the supported 500-record limit");
		const page = await fetchPage({
			batchId,
			limit: requestedLimit,
			...(cursor ? { cursor } : {}),
		});
		pages += 1;
		if (page.items.length > requestedLimit)
			throw new Error("Migration batch page exceeded the requested limit");
		scanned += page.items.length;
		for (const record of page.items) {
			if (record.batchId === batchId) records.set(record.id, record);
		}
		if (!page.hasMore) break;
		if (scanned >= MAX_MIGRATION_BATCH_RECORDS)
			throw new Error("Migration batch exceeds the supported 500-record limit");
		if (pages >= MAX_MIGRATION_BATCH_PAGES)
			throw new Error("Migration batch exceeds the supported 10-page limit");
		const nextCursor = page.cursor ?? "";
		if (!page.items.length || !nextCursor || seenCursors.has(nextCursor))
			throw new Error("Migration batch pagination did not advance");
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	} while (cursor);
	return migrationBatch(batchId, records.values());
}
