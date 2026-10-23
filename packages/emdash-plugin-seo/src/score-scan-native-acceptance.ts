import type { PluginContext } from "emdash";

import type { ScoreScanAcceptance } from "./score-scan.ts";
import { GLOBAL_SETTINGS_KEY } from "./settings-runtime.ts";
import { collectionAnalysisProfileKey } from "./collection-analysis-profile.ts";
import { NativeAtomicScoreScanPlan, nativeAtomicBatchAdapter } from "./score-scan-native-atomic.ts";

/** The collections a terminal acceptance reads or writes inside its transaction. */
export const SCORE_SCAN_ACCEPTANCE_COLLECTIONS = ["scores", "scoreAnalysisRevisions", "scoreScanJobs"] as const;

type AcceptanceCollection = (typeof SCORE_SCAN_ACCEPTANCE_COLLECTIONS)[number];

// The host Kysely instance or transaction. Plugin types resolve another Kysely
// copy, whose classes are nominal, so the host value stays untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostDatabase = any;

interface StorageConfig {
	indexes?: ReadonlyArray<string | readonly string[]>;
	uniqueIndexes?: ReadonlyArray<string | readonly string[]>;
}

/** Public EmDash exports; the native entry passes them so this module imports no host values. */
export interface NativeScoreScanRepositories {
	PluginStorageRepository: new (db: HostDatabase, pluginId: string, collection: string, indexes: Array<string | string[]>) => object;
	OptionsRepository: new (db: HostDatabase) => { getVersioned(key: string): Promise<unknown> };
	createSettingsAccess(options: any, pluginId: string): { getVersioned(key: string): Promise<unknown> };
	createContentAccess(db: HostDatabase, options?: { site?: any; revisions?: boolean }): { get(collection: string, id: string): Promise<unknown> };
}

export interface NativeScoreScanAcceptanceOptions {
	db: HostDatabase;
	pluginId: string;
	pluginVersion: string;
	repositories: NativeScoreScanRepositories;
	/** The descriptor's storage declarations, so bound repositories validate the same indexes as `ctx.storage`. */
	storage: Partial<Record<string, StorageConfig>>;
	site?: unknown;
	log?: PluginContext["log"];
}

function refused(access: string): Error {
	return new Error(`Score scan acceptance cannot use ${access} inside its transaction`);
}

/**
 * Only terminal acceptance ports exist here. SQLite binds them to its actual
 * transaction; D1 binds uncached reads and buffered writes to an atomic plan.
 */
function boundContext(trx: HostDatabase, options: NativeScoreScanAcceptanceOptions, collection: string, plan?: NativeAtomicScoreScanPlan): PluginContext {
	const { repositories: host, pluginId } = options;
	const optionStore = new host.OptionsRepository(trx);
	const settings = host.createSettingsAccess(optionStore, pluginId);
	const profileKey = collectionAnalysisProfileKey(collection);
	const content = host.createContentAccess(trx, { site: options.site, revisions: false });
	const storage = Object.freeze(Object.fromEntries(SCORE_SCAN_ACCEPTANCE_COLLECTIONS.map((name) => {
		const config = options.storage[name]!;
		const indexes = [...(config.indexes ?? []), ...(config.uniqueIndexes ?? [])].map((index) => typeof index === "string" ? index : [...index]);
		const repository = new host.PluginStorageRepository(trx, pluginId, name, indexes);
		return [name, plan ? plan.storage(name, repository as any) : repository];
	})) as Record<AcceptanceCollection, object>);
	const kv = Object.freeze({
		async getVersioned(key: string): Promise<unknown> {
			if (key === profileKey) {
				const name = `plugin:${pluginId}:${key}`;
				return plan ? plan.readOption(key, name, () => optionStore.getVersioned(name)) : optionStore.getVersioned(name);
			}
			if (key !== GLOBAL_SETTINGS_KEY) throw refused(`kv.getVersioned:${String(key)}`);
			const read = () => settings.getVersioned(key.slice("settings:".length));
			return plan ? plan.readOption(key, `plugin:${pluginId}:${key}`, read) : read();
		},
	});
	return Object.freeze({
		plugin: Object.freeze({ id: pluginId, version: options.pluginVersion }),
		...(options.log ? { log: options.log } : {}),
		kv,
		storage,
		content: Object.freeze({ get: (collection: string, id: string) => plan
			? plan.readContent(collection, id, () => content.get(collection, id))
			: content.get(collection, id) }),
	}) as unknown as PluginContext;
}

/**
 * Score and outcome receipt commit together. Lease-managed history and every
 * base-context write run after this boundary, never through another connection
 * while the native transaction holds its lock.
 */
export function createNativeScoreScanAcceptance(options: NativeScoreScanAcceptanceOptions): ScoreScanAcceptance {
	const atomic = nativeAtomicBatchAdapter(options.db);
	if (!options.db || (!atomic && typeof options.db.transaction !== "function"))
		throw new Error("Native score scan acceptance requires a transactional host database");
	for (const name of SCORE_SCAN_ACCEPTANCE_COLLECTIONS)
		if (!options.storage[name]) throw new Error(`Native score scan acceptance requires the declared ${name} collection`);
	return {
		async transaction(work, scope) {
			if (atomic) {
				const plan = new NativeAtomicScoreScanPlan(options.db, options.pluginId, scope.collection);
				const result = await work({ context: boundContext(plan.database, options, scope.collection, plan) });
				await plan.commit(atomic);
				return result;
			}
			const builder = options.db.transaction();
			if (!builder || typeof builder.execute !== "function") throw new Error("Native transactions are unavailable");
			return builder.execute(async (trx: HostDatabase) => {
				if (!trx || trx.isTransaction !== true) throw new Error("The host did not open a transaction");
				return work({ context: boundContext(trx, options, scope.collection) });
			});
		},
	};
}
