// The host owns the Kysely instance and its driver; importing another Kysely
// copy here would make its nominal types incompatible.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostDatabase = any;
interface CompiledStatement { sql: string; parameters: readonly unknown[]; query: unknown }
interface AtomicBatchAdapter { executeAtomicBatch(queries: readonly CompiledStatement[]): Promise<readonly { rows: readonly unknown[] }[]> }
interface Versioned { value: unknown; revision: string }
interface Repository { getVersioned(id: string): Promise<unknown> }
interface ObservedRead { sql: string; parameters: readonly unknown[]; rows: Record<string, unknown>[] }
interface BufferedRecord { collection: string; id: string; initial: Versioned | null; current: Versioned | null; dirty: boolean }
interface BufferedWrite { record: BufferedRecord; revision: string | null }
type ExpectedRead = { kind: "option"; name: string } | { kind: "storage"; collection: string; id: string } | { kind: "content"; collection: string; id: string };

const MAX_READS = 12;
const MAX_WRITES = 8;
const MAX_ROW_BYTES = 512 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_PARAMETERS = 100;
const MAX_COLUMNS = 128;

function refuse(detail: string): never { throw new Error(`Native atomic score acceptance refused: ${detail}`); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function copy<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }
function encoded(value: unknown, limit: number): string {
	const json = JSON.stringify(value);
	if (typeof json !== "string" || new TextEncoder().encode(json).length > limit) refuse("record budget exceeded");
	return json;
}
function identifier(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) refuse("unsupported database identifier");
	return `"${value}"`;
}
function versioned(value: unknown): Versioned | null {
	if (value === null) return null;
	if (!record(value) || typeof value.revision !== "string" || !value.revision || value.revision.length > 128 || !Object.hasOwn(value, "value"))
		refuse("invalid versioned record");
	return copy(value as unknown as Versioned);
}

/** The native D1 adapter exposes this capability; other dialects retain their ordinary transaction. */
export function nativeAtomicBatchAdapter(db: HostDatabase): AtomicBatchAdapter | null {
	if (!db || typeof db.getExecutor !== "function") return null;
	const adapter = db.getExecutor().adapter;
	return adapter && typeof adapter.executeAtomicBatch === "function" ? adapter as AtomicBatchAdapter : null;
}

function compiled(sql: string, parameters: readonly unknown[]): CompiledStatement {
	if (parameters.length > MAX_PARAMETERS) refuse("D1 parameter budget exceeded");
	// The adapter consumes compiled SQL and parameters, as it does for Kysely's
	// own CompiledQuery. Keep a RawNode for the rest of the host contract.
	return { sql, parameters, query: { kind: "RawNode", sqlFragments: [sql], parameters: [] } };
}

function checkRead(query: CompiledStatement, expected: ExpectedRead, pluginId: string): void {
	const sql = query.sql.trim().replace(/\s+/g, " ").toLowerCase();
	let wanted: string;
	let parameters: readonly unknown[];
	if (expected.kind === "option") {
		wanted = 'select "value", "revision" from "options" where "name" = ?';
		parameters = [expected.name];
	} else if (expected.kind === "storage") {
		wanted = 'select "data", "revision" from "_plugin_storage" where "plugin_id" = ? and "collection" = ? and "id" = ?';
		parameters = [pluginId, expected.collection, expected.id];
	} else {
		const table = identifier(`ec_${expected.collection}`);
		if (sql === `select * from ${table} where id = ? and deleted_at is null`) parameters = [expected.id];
		else if (sql === 'select "has_seo" from "_emdash_collections" where "slug" = ?') parameters = [expected.collection];
		else if (sql === 'select * from "_emdash_seo" where "collection" = ? and "content_id" = ?') parameters = [expected.collection, expected.id];
		else refuse("unsupported content read");
		wanted = sql;
	}
	if (sql !== wanted || JSON.stringify(query.parameters) !== JSON.stringify(parameters)) refuse("unsupported host read");
}

function readGuard(read: ObservedRead): { sql: string; parameters: readonly unknown[] } {
	if (read.rows.length === 0) return { sql: `not exists (${read.sql})`, parameters: read.parameters };
	const row = read.rows[0]!;
	const keys = Object.keys(row);
	if (keys.length === 0 || keys.length > MAX_COLUMNS) refuse("unsupported row width");
	for (const value of Object.values(row))
		if (value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) refuse("unsupported row value");
	// One JSON parameter holds all columns, including native SEO and all content
	// fields. It avoids one D1 bind variable per field while comparing SQL NULL
	// with IS, rather than treating it as an unknown equality result.
	const cells = keys.map((key) => `observed.${identifier(key)} is json_extract(snapshot.value, '$."${key}"')`).join(" and ");
	return {
		sql: `exists (select 1 from (${read.sql}) as observed cross join json_each(?) as snapshot where ${cells})`,
		parameters: [...read.parameters, encoded([row], MAX_ROW_BYTES)],
	};
}

/**
 * A bounded optimistic terminal transaction for D1.batch. Host reads are
 * observed without result/query plugins; conditional storage writes exist only
 * in memory until every dependency can be tested by one atomic batch.
 */
export class NativeAtomicScoreScanPlan {
	readonly database: HostDatabase;
	private readonly pending = new Map<object, CompiledStatement>();
	private readonly reads: ObservedRead[] = [];
	private readonly values = new Map<string, Promise<unknown>>();
	private readonly records = new Map<string, Promise<BufferedRecord>>();
	private readonly writes: BufferedWrite[] = [];
	private expected: ExpectedRead | null = null;
	private readonly pluginId: string;
	private readonly collection: string;

	constructor(db: HostDatabase, pluginId: string, collection: string) {
		this.pluginId = pluginId;
		this.collection = collection;
		identifier(`ec_${collection}`);
		if (typeof db.withoutPlugins !== "function" || typeof db.withPlugin !== "function") refuse("uncached host reads unavailable");
		const plugins = db.getExecutor().plugins;
		if (!Array.isArray(plugins) || plugins.length !== 0) refuse("custom database plugins require an explicit atomic contract");
		const plain = db.withoutPlugins();
		this.database = plain.withPlugin({
			transformQuery: (args: { node: unknown; queryId: object }) => {
				if (!this.expected) refuse("read outside a bound port");
				const query = plain.getExecutor().compileQuery(args.node, args.queryId) as CompiledStatement;
				checkRead(query, this.expected, pluginId);
				this.pending.set(args.queryId, query);
				return args.node;
			},
			transformResult: async (args: { queryId: object; result: { rows: Record<string, unknown>[] } }) => {
				const query = this.pending.get(args.queryId);
				this.pending.delete(args.queryId);
				if (!query || !Array.isArray(args.result.rows) || args.result.rows.length > 1) refuse("unbounded host read");
				const observed = { sql: query.sql, parameters: [...query.parameters], rows: copy(args.result.rows) };
				encoded(observed.rows, MAX_ROW_BYTES);
				const previous = this.reads.find((read) => read.sql === observed.sql && JSON.stringify(read.parameters) === JSON.stringify(observed.parameters));
				if (previous && JSON.stringify(previous.rows) !== JSON.stringify(observed.rows)) refuse("dependency changed while planning");
				if (!previous) {
					if (this.reads.length >= MAX_READS) refuse("read budget exceeded");
					this.reads.push(observed);
				}
				return args.result;
			},
		});
	}

	private async capture<T>(expected: ExpectedRead, work: () => Promise<T>): Promise<T> {
		if (this.expected) refuse("overlapping bound reads");
		this.expected = expected;
		const before = this.reads.length;
		try {
			const value = await work();
			const observed = this.reads.slice(before);
			// No cached port result may influence a write without an SQL fence.
			if (observed.length === 0) refuse("host read did not expose its dependency");
			if (expected.kind === "content") {
				const first = observed[0]!;
				if (!first.sql.toLowerCase().includes(identifier(`ec_${expected.collection}`))) refuse("content row was not observed");
				const expectedCount = value === null ? 1 : observed.some((read) => read.sql.includes('"_emdash_seo"')) ? 3 : 2;
				if (observed.length !== expectedCount) refuse("incomplete content dependencies");
			} else if (observed.length !== 1) refuse("unexpected host dependency count");
			return copy(value);
		} finally {
			this.expected = null;
			this.pending.clear();
		}
	}

	async readOption(key: string, name: string, work: () => Promise<unknown>): Promise<unknown> {
		if (!this.values.has(key)) this.values.set(key, this.capture({ kind: "option", name }, work));
		return copy(await this.values.get(key));
	}

	async readContent(collection: string, id: string, work: () => Promise<unknown>): Promise<unknown> {
		if (collection !== this.collection || typeof id !== "string" || !id || id.length > 256) refuse("content outside the acceptance scope");
		const key = `content:${collection}:${id}`;
		if (!this.values.has(key)) this.values.set(key, this.capture({ kind: "content", collection, id }, work));
		return copy(await this.values.get(key));
	}

	private async load(collection: string, id: string, repository: Repository): Promise<BufferedRecord> {
		if (typeof id !== "string" || !id || id.length > 256) refuse("invalid storage key");
		if (collection === "scoreScanJobs" ? id !== "current" : !id.startsWith(`${this.collection}:`)) refuse("storage outside the acceptance scope");
		const key = `${collection}:${id}`;
		if (!this.records.has(key)) this.records.set(key, (async () => {
			const original = versioned(await this.capture({ kind: "storage", collection, id }, () => repository.getVersioned(id)));
			return { collection, id, initial: original, current: copy(original), dirty: false };
		})());
		return this.records.get(key)!;
	}

	storage(collection: string, repository: Repository): object {
		const write = async (id: string, revision: string | null, value: unknown, remove: boolean) => {
			if (collection === "scoreAnalysisRevisions") refuse("reservation writes are outside terminal acceptance");
			const item = await this.load(collection, id, repository);
			if ((item.current?.revision ?? null) !== revision || (remove && item.current === null)) return { applied: false };
			if (this.writes.length >= MAX_WRITES) refuse("write budget exceeded");
			const next = remove ? null : { value: JSON.parse(encoded(value, MAX_RECORD_BYTES)), revision: crypto.randomUUID() };
			item.current = next;
			item.dirty = true;
			this.writes.push({ record: item, revision: next?.revision ?? null });
			return next ? { applied: true, revision: next.revision } : { applied: true };
		};
		return Object.freeze({
			get: async (id: string) => copy((await this.load(collection, id, repository)).current?.value ?? null),
			getVersioned: async (id: string) => copy((await this.load(collection, id, repository)).current),
			compareAndSet: (id: string, revision: string | null, value: unknown) => write(id, revision, value, false),
			compareAndDelete: (id: string, revision: string) => write(id, revision, undefined, true),
		});
	}

	async commit(adapter: AtomicBatchAdapter): Promise<void> {
		const first = this.writes[0];
		const last = this.writes.at(-1);
		if (!first || !last || first === last || first.record.collection !== "scoreScanJobs" || first.record !== last.record ||
			!first.record.initial || !first.revision || !last.revision || first.revision === last.revision)
			refuse("a terminal job fence and receipt are required");
		const job = first.record;
		const dirty = (await Promise.all(this.records.values())).filter((item) => item.dirty && item !== job);
		if (dirty.length > 1 || dirty.some((item) => item.collection !== "scores") ||
			this.writes.slice(1, -1).some((write) => write.record === job)) refuse("unsupported terminal write shape");

		const guards = this.reads.map(readGuard);
		const jobKey = [this.pluginId, "scoreScanJobs", "current"];
		const marker = 'exists (select 1 from "_plugin_storage" where "plugin_id" = ? and "collection" = ? and "id" = ? and "revision" = ?)';
		const markerParameters = [...jobKey, first.revision];
		const at = new Date().toISOString();
		const statements: CompiledStatement[] = [];
		// Only the opaque fence revision must be stored here: the callback's
		// intermediate value is private to its buffered read-after-write view.
		statements.push(compiled(
			`update "_plugin_storage" set "revision" = ?, "updated_at" = ? where "plugin_id" = ? and "collection" = ? and "id" = ? and "revision" = ? and ${guards.map((guard) => `(${guard.sql})`).join(" and ")} returning "revision"`,
			[first.revision, at, ...jobKey, job.initial!.revision, ...guards.flatMap((guard) => guard.parameters)],
		));
		let scoreState = { sql: "1", parameters: [] as readonly unknown[] };
		const score = dirty[0];
		if (score) {
			const key = [this.pluginId, score.collection, score.id];
			if (score.current) {
				const data = encoded(score.current.value, MAX_RECORD_BYTES);
				if (score.initial) statements.push(compiled(
					`update "_plugin_storage" set "data" = ?, "revision" = ?, "updated_at" = ? where "plugin_id" = ? and "collection" = ? and "id" = ? and ${marker}`,
					[data, score.current.revision, at, ...key, ...markerParameters],
				));
				else statements.push(compiled(
					`insert into "_plugin_storage" ("plugin_id", "collection", "id", "data", "revision", "created_at", "updated_at") select ?, ?, ?, ?, ?, ?, ? where ${marker}`,
					[...key, data, score.current.revision, at, at, ...markerParameters],
				));
				scoreState = { sql: marker, parameters: [...key, score.current.revision] };
			} else {
				if (score.initial) statements.push(compiled(
					`delete from "_plugin_storage" where "plugin_id" = ? and "collection" = ? and "id" = ? and ${marker}`,
					[...key, ...markerParameters],
				));
				scoreState = { sql: 'not exists (select 1 from "_plugin_storage" where "plugin_id" = ? and "collection" = ? and "id" = ?)', parameters: key };
			}
		}
		statements.push(compiled(
			`update "_plugin_storage" set "data" = ?, "revision" = ?, "updated_at" = ? where "plugin_id" = ? and "collection" = ? and "id" = ? and "revision" = ? and (${scoreState.sql}) returning "revision"`,
			[encoded(job.current!.value, MAX_RECORD_BYTES), last.revision, at, ...jobKey, first.revision, ...scoreState.parameters],
		));
		// D1.batch rolls the whole batch back on an SQL error. CASE short-circuits:
		// malformed JSON is evaluated only when a fence or conditional write failed.
		statements.push(compiled(
			`select case when (${marker}) and (${scoreState.sql}) then 1 else json('score-scan-atomic-conflict') end as "accepted"`,
			[...jobKey, last.revision, ...scoreState.parameters],
		));
		const results = await adapter.executeAtomicBatch(statements);
		const assertion = results.at(-1)?.rows[0];
		if (results.length !== statements.length || !record(assertion) || assertion.accepted !== 1) refuse("unconfirmed atomic batch");
	}
}
