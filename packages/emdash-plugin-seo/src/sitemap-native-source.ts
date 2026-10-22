// Native sitemap source for the EmDash 1.1.0 SQLite/D1/Postgres schema. It
// reads only public URL columns of `ec_<collection>` and the core SEO row for
// the same collection and content id, through the host's own Kysely instance.
// The schema is version-specific: the Astro entry point enables this source
// only on a verified EmDash version, and sandboxed plugins cannot use it.
import {
	SitemapCapacityError,
	isSitemapCollectionFileKey,
	sitemapPlan,
	type SitemapCollectionPlan,
	type SitemapSource,
	type SitemapSourceFilter,
	type SitemapSourceRow,
} from "./sitemap-engine.ts";

/** D1 binds at most 100 parameters per statement. */
const STATEMENT_PARAMETERS = 100;
// Bound in every candidate query: status, blank slug and the SEO collection.
const FIXED_PARAMETERS = 3;
const PARAMETER_MARGIN = 2;
/**
 * Sibling statements one child request may run. Every routed locale value is
 * bound in each statement, so many locales shrink the batch; a request that
 * would need more statements fails before running any of them.
 */
export const SITEMAP_GROUP_STATEMENT_BUDGET = 10;

interface ProjectedRow {
	id: string;
	slug: string;
	locale: string;
	translation_group: string | null;
	updated_at: string | null;
	published_at: string | null;
	seo_row: string | null;
	seo_no_index: number | string | null;
	seo_canonical: string | null;
	seo_image: string | null;
	seo_updated_at: string | null;
}

// The host's Kysely instance; its builder quotes identifiers and binds values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostDatabase = any;

function table(collection: string): string {
	if (!isSitemapCollectionFileKey(collection)) throw new Error("Invalid sitemap collection key.");
	return `ec_${collection} as c`;
}

function parameterBudget(filter: SitemapSourceFilter): number {
	const available = STATEMENT_PARAMETERS - FIXED_PARAMETERS - PARAMETER_MARGIN - filter.locales.length;
	if (filter.locales.length === 0 || available < 1) throw new Error("Too many routed locales for one sitemap query.");
	return available;
}

function candidates(db: HostDatabase, collection: string, filter: SitemapSourceFilter) {
	parameterBudget(filter);
	return db.selectFrom(table(collection))
		.where("c.status", "=", "published")
		.where("c.deleted_at", "is", null)
		.where("c.slug", "is not", null)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.where((eb: any) => eb(eb.fn("trim", ["c.slug"]), "<>", ""))
		.where("c.locale", "in", filter.locales);
}

function projected(db: HostDatabase, collection: string, filter: SitemapSourceFilter) {
	return candidates(db, collection, filter)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.leftJoin("_emdash_seo as s", (join: any) => join.onRef("s.content_id", "=", "c.id").on("s.collection", "=", collection))
		.select([
			"c.id", "c.slug", "c.locale", "c.translation_group", "c.updated_at", "c.published_at",
			"s.content_id as seo_row", "s.seo_no_index", "s.seo_canonical", "s.seo_image", "s.updated_at as seo_updated_at",
		]);
}

function sourceRow(row: ProjectedRow): SitemapSourceRow {
	return {
		id: String(row.id),
		slug: String(row.slug),
		locale: String(row.locale),
		translationGroup: row.translation_group ?? null,
		updatedAt: row.updated_at ?? null,
		publishedAt: row.published_at ?? null,
		seo: row.seo_row == null
			? null
			: {
				noIndex: Number(row.seo_no_index ?? 0) !== 0,
				canonical: row.seo_canonical || null,
				image: row.seo_image || null,
				updatedAt: row.seo_updated_at ?? null,
			},
	};
}

export function createNativeSitemapSource(db: HostDatabase): SitemapSource {
	return {
		// One ranked scan per collection returns only the first row and the last
		// row of every full file, so the index never transfers every id.
		async planFiles(collection, filter, pageSize): Promise<SitemapCollectionPlan> {
			if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Invalid sitemap page size.");
			const ranked = candidates(db, collection, filter)
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.select((eb: any) => [
					"c.id",
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					eb.fn.agg("row_number").over((over: any) => over.orderBy("c.id")).as("position"),
					eb.fn.countAll().over().as("total"),
				]);
			const rows = await db.selectFrom(ranked.as("r"))
				.select(["r.id", "r.position", "r.total"])
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				.where((eb: any) => eb.or([
					eb("r.position", "=", 1),
					eb.and([eb(eb("r.position", "%", pageSize), "=", 0), eb("r.position", "<", eb.ref("r.total"))]),
				]))
				.orderBy("r.position")
				.execute() as { id: string; position: number | string; total: number | string }[];
			const total = rows.length ? Number(rows[0].total) : 0;
			const boundaries = rows
				.filter((row) => Number(row.position) % pageSize === 0 && Number(row.position) < total)
				.map((row) => String(row.id));
			return sitemapPlan(total, boundaries);
		},

		async readRows(collection, filter, range) {
			if (!Number.isInteger(range.limit) || range.limit < 1) throw new Error("Invalid sitemap row limit.");
			let query = projected(db, collection, filter);
			if (range.after !== null) query = query.where("c.id", ">", range.after);
			const rows = await query.orderBy("c.id").limit(range.limit).execute() as ProjectedRow[];
			return rows.map(sourceRow);
		},

		async readGroups(collection, filter, groups) {
			const batchSize = parameterBudget(filter);
			if (Math.ceil(groups.length / batchSize) > SITEMAP_GROUP_STATEMENT_BUDGET) {
				throw new SitemapCapacityError(
					`Translation alternates for ${groups.length} groups across ${filter.locales.length} locale values exceed one request's query budget.`,
					"request-budget",
				);
			}
			const result: SitemapSourceRow[] = [];
			for (let index = 0; index < groups.length; index += batchSize) {
				const batch = groups.slice(index, index + batchSize);
				// A group has at most one active row per locale; more means unexpected data.
				const ceiling = batch.length * filter.locales.length;
				const rows = await projected(db, collection, filter)
					.where("c.translation_group", "in", batch)
					.limit(ceiling + 1)
					.execute() as ProjectedRow[];
				if (rows.length > ceiling) throw new Error("A translation group has more rows than routed locales.");
				result.push(...rows.map(sourceRow));
			}
			return result;
		},
	};
}
