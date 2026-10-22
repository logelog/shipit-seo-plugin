import {
	SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	SEO_PORTABILITY_CONFIRMATION,
	SEO_PORTABILITY_FORMAT,
	SEO_PORTABILITY_VERSION,
	type SeoPortabilityBundle,
} from "./admin-contract.ts";
import seoRuntime from "./sandbox-entry.ts";
import { collectionAnalysisProfileKey, readCollectionAnalysisProfile } from "./collection-analysis-profile.ts";
import { readContentScoringPolicy } from "./settings-runtime.ts";
import { defaultSettingsValues } from "./settings-state.ts";

let failures = 0;

function check(label: string, condition: boolean) {
	if (condition) console.log(`  PASS  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}`);
	}
}

function createCollection() {
	const values = new Map<string, any>();
	const api = {
		get: async (id: string) => structuredClone(values.get(id) ?? null),
		put: async (id: string, value: unknown) => {
			values.set(id, structuredClone(value));
		},
		delete: async (id: string) => values.delete(id),
		compareAndSet: async (id: string, expected: any, next: any) => {
			const present = values.has(id);
			if (expected.state === "missing" ? present : !present) return false;
			if (
				expected.state === "value" &&
				JSON.stringify(values.get(id)) !== JSON.stringify(expected.value)
			)
				return false;
			if (next.action === "delete") return values.delete(id);
			values.set(id, structuredClone(next.value));
			return true;
		},
		query: async (options: {
			where?: Record<string, unknown>;
			orderBy?: Record<string, "asc" | "desc">;
			limit?: number;
		} = {}) => {
			const entries = [...values.entries()].filter(([, value]) =>
				Object.entries(options.where ?? {}).every(
					([key, expected]) => value[key] === expected,
				)
			);
			const order = Object.entries(options.orderBy ?? {})[0];
			if (order) {
				const [key, direction] = order;
				entries.sort((left, right) => {
					const compared = String(left[1][key] ?? "").localeCompare(
						String(right[1][key] ?? ""),
					);
					return direction === "asc" ? compared : -compared;
				});
			}
			const limit = options.limit ?? 100;
			return {
				items: entries.slice(0, limit).map(([id, data]) => ({
					id,
					data: structuredClone(data),
				})),
				hasMore: entries.length > limit,
				cursor: undefined,
			};
		},
	};
	return api;
}

function createContext() {
	const kv = new Map<string, unknown>();
	// Every write gives the key a new revision, as on the published hosts.
	const kvRevisions = new Map<string, string>();
	let kvRevisionCounter = 0;
	const writeKv = (key: string, value: unknown) => {
		kv.set(key, structuredClone(value));
		kvRevisions.set(key, `k${++kvRevisionCounter}`);
	};
	const schemas = new Map<string, unknown>();
	const schemaRevisions = new Map<string, string>();
	let schemaRevisionCounter = 0;
	const schemaRevision = (id: string) => schemas.has(id) ? schemaRevisions.get(id) ?? `seed:${id}` : null;
	const writeSchema = (id: string, value: unknown) => {
		schemas.set(id, structuredClone(value));
		const revision = `s${++schemaRevisionCounter}`;
		schemaRevisions.set(id, revision);
		return revision;
	};
	const operationLeases = createCollection();
	let kvWrites = 0;
	let schemaWrites = 0;
	let schemaDeletes = 0;
	let failKeyOnce: string | null = null;
	let afterKeyOnce: { key: string; value: unknown; targetKey?: string } | null = null;
	let rejectAfterKeyCommitOnce: { key: string; value: unknown } | null = null;
	let afterReadOnce: {
		key: string;
		remaining: number;
		targetKey: string;
		value: unknown;
	} | null = null;
	let failSchemaOnce: string | null = null;
	let afterSchemaOnce: { id: string; value: unknown } | null = null;
	let rejectAfterSchemaCommitOnce: { id: string; value: unknown } | null = null;
	return {
		context: {
			plugin: { id: "shipit-seo", version: "test" },
			// Current hosts expose versioned plugin settings; no business identity is stored here.
			settings: {
				get: async () => null,
				getVersioned: async () => null,
				compareAndSet: async () => ({ applied: false }),
				compareAndDelete: async () => ({ applied: false }),
			},
			schema: { listCollections: async () => [
				{ slug: "posts", label: "Posts", hasSeo: true,
					urlPattern: "/blog/{slug}", routable: true, hidden: false },
				{ slug: "pages", label: "Pages", hasSeo: true,
					urlPattern: "/{slug}", routable: true, hidden: false },
				{ slug: "services", label: "Services", hasSeo: true,
					urlPattern: "/services/{slug}", routable: true, hidden: false },
			] },
			kv: {
				get: async (key: string) => {
					const value = structuredClone(kv.get(key) ?? null);
					if (afterReadOnce?.key === key) {
						afterReadOnce.remaining -= 1;
						if (afterReadOnce.remaining === 0) {
							writeKv(afterReadOnce.targetKey, afterReadOnce.value);
							afterReadOnce = null;
						}
					}
					return value;
				},
				set: async (key: string, value: unknown) => {
					if (failKeyOnce === key) {
						failKeyOnce = null;
						throw new Error(`Injected write failure for ${key}`);
					}
					kvWrites += 1;
					writeKv(key, value);
					if (afterKeyOnce?.key === key) {
						writeKv(afterKeyOnce.targetKey ?? key, afterKeyOnce.value);
						afterKeyOnce = null;
					}
					if (
						rejectAfterKeyCommitOnce?.key === key &&
						JSON.stringify(rejectAfterKeyCommitOnce.value) ===
							JSON.stringify(value)
					) {
						rejectAfterKeyCommitOnce = null;
						throw new Error(
							`Injected rejection after committed write for ${key}`,
						);
					}
				},
				delete: async (key: string) => {
					kvRevisions.delete(key);
					return kv.delete(key);
				},
				list: async (prefix = "") => [...kv.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })),
				// Versioned access through the same read and write hooks.
				async getVersioned(key: string) {
					const exists = kv.has(key);
					const revision = kvRevisions.get(key) ?? "r1";
					const value = await this.get(key);
					return exists ? { value, revision } : null;
				},
				async compareAndSet(key: string, expected: string | null, value: unknown) {
					if (failKeyOnce === key) {
						failKeyOnce = null;
						throw new Error(`Injected write failure for ${key}`);
					}
					const current = kv.has(key) ? kvRevisions.get(key) ?? "r1" : null;
					if (current !== expected) return { applied: false };
					kvWrites += 1;
					writeKv(key, value);
					const revision = kvRevisions.get(key);
					if (afterKeyOnce?.key === key) {
						writeKv(afterKeyOnce.targetKey ?? key, afterKeyOnce.value);
						afterKeyOnce = null;
					}
					if (
						rejectAfterKeyCommitOnce?.key === key &&
						JSON.stringify(rejectAfterKeyCommitOnce.value) === JSON.stringify(value)
					) {
						rejectAfterKeyCommitOnce = null;
						throw new Error(`Injected rejection after committed write for ${key}`);
					}
					return { applied: true, revision };
				},
				async compareAndDelete(key: string, expected: string) {
					const current = kv.has(key) ? kvRevisions.get(key) ?? "r1" : null;
					if (current !== expected) return { applied: false };
					kv.delete(key);
					kvRevisions.delete(key);
					return { applied: true };
				},
			},
			storage: {
				operationLeases,
				schemas: {
					get: async (id: string) => structuredClone(schemas.get(id) ?? null),
					count: async () => schemas.size,
					put: async (id: string, value: unknown) => {
						if (failSchemaOnce === id) {
							failSchemaOnce = null;
							throw new Error(`Injected schema write failure for ${id}`);
						}
						schemaWrites += 1;
						const revision = writeSchema(id, value);
						if (afterSchemaOnce?.id === id) {
							writeSchema(id, afterSchemaOnce.value);
							afterSchemaOnce = null;
						}
						if (
							rejectAfterSchemaCommitOnce?.id === id &&
							JSON.stringify(rejectAfterSchemaCommitOnce.value) ===
								JSON.stringify(value)
						) {
							rejectAfterSchemaCommitOnce = null;
							throw new Error(
								`Injected rejection after committed schema write for ${id}`,
							);
						}
						return revision;
					},
					delete: async (id: string) => {
						schemaDeletes += 1;
						schemaRevisions.delete(id);
						return schemas.delete(id);
					},
					async getVersioned(id: string) {
						const revision = schemaRevision(id);
						return revision === null ? null : { value: await this.get(id), revision };
					},
					async compareAndSet(id: string, expected: string | null, value: unknown) {
						if (schemaRevision(id) !== expected) return { applied: false };
						const revision = await this.put(id, value);
						return { applied: true, revision };
					},
					async compareAndDelete(id: string, expected: string) {
						if (schemaRevision(id) !== expected) return { applied: false };
						await this.delete(id);
						return { applied: true };
					},
					query: async ({
						limit = 50,
						cursor,
					}: { limit?: number; cursor?: string } = {}) => {
						const start = Number.parseInt(cursor ?? "0", 10) || 0;
						const pageLimit = Math.min(limit, 100);
						const entries = [...schemas.entries()];
						const items = entries
							.slice(start, start + pageLimit)
							.map(([id, data]) => ({ id, data: structuredClone(data) }));
						const hasMore = start + pageLimit < entries.length;
						return {
							items,
							hasMore,
							cursor: hasMore ? String(start + pageLimit) : undefined,
						};
					},
				},
			},
			log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
		},
		kv,
		schemas,
		get kvWrites() {
			return kvWrites;
		},
		get schemaWrites() {
			return schemaWrites;
		},
		get schemaDeletes() {
			return schemaDeletes;
		},
		failNextWrite(key: string) {
			failKeyOnce = key;
		},
		afterNextWrite(key: string, value: unknown, targetKey?: string) {
			afterKeyOnce = { key, value, targetKey };
		},
		rejectAfterCommittedWrite(key: string, value: unknown) {
			rejectAfterKeyCommitOnce = { key, value };
		},
		afterNthNextRead(
			key: string,
			remaining: number,
			targetKey: string,
			value: unknown,
		) {
			afterReadOnce = { key, remaining, targetKey, value };
		},
		failNextSchemaWrite(id: string) {
			failSchemaOnce = id;
		},
		afterNextSchemaWrite(id: string, value: unknown) {
			afterSchemaOnce = { id, value };
		},
		rejectAfterCommittedSchemaWrite(id: string, value: unknown) {
			rejectAfterSchemaCommitOnce = { id, value };
		},
	};
}

function handler(name: string) {
	return (seoRuntime as any).routes[name].handler as (routeContext: any, context: any) => Promise<any>;
}

function route(input: unknown = {}) {
	return {
		input,
		request: {
			url: "https://target.example/_emdash/api/plugins/shipit-seo/portability",
			method: "POST",
			headers: {},
		},
	};
}

const harness = createContext();
await (seoRuntime as any).hooks["plugin:install"].handler({}, harness.context);
check("installation leaves the global settings absent", !harness.kv.has("settings:global:v1"));
// Fixture: an owner's earlier deliberate save on the target site.
await harness.context.kv.set("settings:global:v1", {
	version: 1,
	updatedAt: "2026-07-14T16:30:00.000Z",
	siteName: "Target site",
	siteUrl: "https://target.example",
	publisherType: "organization",
	organizationName: "Target organization",
	organizationLogo: "https://target.example/logo.svg",
	personName: "",
	socialProfiles: ["https://social.example/target"],
	personProfiles: [],
	defaultSocialImage: "https://target.example/social.jpg",
	twitterHandle: "@target",
	noindex: false,
	contentScoringEnabled: true,
	indexingPreferenceConfirmed: true,
});
await harness.context.kv.set(`settings:indexnow:v${SEO_ADMIN_INDEXNOW_STORAGE_VERSION}`, {
	version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	updatedAt: "2026-07-14T17:00:00.000Z",
	values: {
		enabled: true,
		autoSubmit: true,
		apiKey: "target-key-1234",
		keyLocation: "/indexnow-key.txt",
		batchSize: 100,
		minIntervalSeconds: 300,
		maxAttempts: 5,
	},
});
await handler("save-admin-custom-schema")(route({
	id: "target-schema",
	expectedRevision: null,
	name: "Target schema",
	scope: "pages",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage" }),
	enabled: true,
}), harness.context).then((result) => {
	check("the initial revision-bound schema fixture is saved", result.success === true);
});

const globalSettingsKey = "settings:global:v1";
const stableExportSettings = {
	...(harness.kv.get(globalSettingsKey) as Record<string, unknown>),
	siteName: "Human edit during stable export",
	updatedAt: "2026-07-14T17:15:00.000Z",
};
const writesBeforeStableExport =
	harness.kvWrites + harness.schemaWrites + harness.schemaDeletes;
harness.afterNthNextRead(
	globalSettingsKey,
	2,
	globalSettingsKey,
	stableExportSettings,
);
const exported = await handler("admin-portability-export")(route(), harness.context);
check("export route returns the portable format", exported.bundle.format === SEO_PORTABILITY_FORMAT);
check("export route declares no warnings for valid storage", exported.warnings.length === 0);
check("export route omits the IndexNow key", !JSON.stringify(exported).includes("target-key-1234"));
check(
	"export retries an interleaved read and returns one stable configuration",
	exported.bundle.source.siteName === "Human edit during stable export" &&
		exported.bundle.configuration.settings.siteName ===
			"Human edit during stable export",
);
check(
	"stable export performs no persistence writes",
	harness.kvWrites + harness.schemaWrites + harness.schemaDeletes ===
		writesBeforeStableExport,
);

const pagedSchemaHarness = createContext();
for (let index = 0; index < 150; index += 1) {
	pagedSchemaHarness.schemas.set(
		`paged-schema-${index.toString().padStart(3, "0")}`,
		{
			storageVersion: 1,
			name: `Paged schema ${index}`,
			scope: "global",
			json: JSON.stringify({
				"@context": "https://schema.org",
				"@type": "Thing",
				name: `Thing ${index}`,
			}),
			enabled: index % 2 === 0,
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
			updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
		},
	);
}
const pagedSchemaExport = await handler("admin-portability-export")(
	route(),
	pagedSchemaHarness.context,
);
check(
	"portability snapshots include custom schemas beyond the host's first 100-record page",
	pagedSchemaExport.bundle.configuration.customSchemas.length === 150,
);
for (let index = 150; index < 501; index += 1) {
	pagedSchemaHarness.schemas.set(
		`paged-schema-${index.toString().padStart(3, "0")}`,
		{
			storageVersion: 1,
			name: `Paged schema ${index}`,
			scope: "global",
			json: JSON.stringify({
				"@context": "https://schema.org",
				"@type": "Thing",
				name: `Thing ${index}`,
			}),
			enabled: false,
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
			updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
		},
	);
}
let oversizedSchemaExportRejected = false;
try {
	await handler("admin-portability-export")(
		route(),
		pagedSchemaHarness.context,
	);
} catch (error: unknown) {
	oversizedSchemaExportRejected = String(error).includes(
		"reduce custom schemas to 500",
	);
}
check(
	"portability fails closed instead of silently truncating more than 500 custom schemas",
	oversizedSchemaExportRejected,
);

const bundle = structuredClone(exported.bundle) as SeoPortabilityBundle;
bundle.source.siteName = "Imported site";
bundle.source.siteUrl = "https://imported.example";
bundle.configuration.settings.siteName = "Imported site";
bundle.configuration.settings.siteUrl = "https://imported.example";
bundle.configuration.settings.noindex = true;
bundle.configuration.customSchemas.push({
	id: "imported-schema",
	name: "Imported schema",
	scope: "posts",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Article" }),
	enabled: false,
});

const stablePreviewSettings = {
	...(harness.kv.get(globalSettingsKey) as Record<string, unknown>),
	siteName: "Human edit during stable preview",
	updatedAt: "2026-07-14T17:20:00.000Z",
};
const writesBeforeStablePreview =
	harness.kvWrites + harness.schemaWrites + harness.schemaDeletes;
harness.afterNthNextRead(
	globalSettingsKey,
	2,
	globalSettingsKey,
	stablePreviewSettings,
);
const interleavedStablePreview = await handler("admin-portability-preview")(
	route({ bundle, mode: "merge" }),
	harness.context,
);
const repeatedStablePreview = await handler("admin-portability-preview")(
	route({ bundle, mode: "merge" }),
	harness.context,
);
check(
	"preview retries an interleaved read instead of returning a torn plan",
	interleavedStablePreview.success === true &&
		repeatedStablePreview.success === true &&
		interleavedStablePreview.plan.fingerprint ===
			repeatedStablePreview.plan.fingerprint,
);
check(
	"stable preview performs no persistence writes",
	harness.kvWrites + harness.schemaWrites + harness.schemaDeletes ===
		writesBeforeStablePreview,
);

const writesBeforePreview = harness.kvWrites + harness.schemaWrites + harness.schemaDeletes;
const preview = await handler("admin-portability-preview")(route({ bundle, mode: "merge" }), harness.context);
check("preview route returns a versioned plan", preview.success === true && preview.plan.portabilityVersion === SEO_PORTABILITY_VERSION);
check("preview route performs no writes", harness.kvWrites + harness.schemaWrites + harness.schemaDeletes === writesBeforePreview);
check("preview reports IndexNow safety disable", preview.success === true && preview.plan.summary.indexNowWillBeDisabled === true);
const foreignTypesBundle = structuredClone(bundle);
foreignTypesBundle.configuration.indexNow.autoSubmitContentTypes = ["posts", "portfolio"];
const foreignTypesPreview = await handler("admin-portability-preview")(
	route({ bundle: foreignTypesBundle, mode: "merge" }),
	harness.context,
);
check(
	"preview names IndexNow content types the target site does not have",
	foreignTypesPreview.success === true &&
		foreignTypesPreview.plan.warnings.some((warning: string) =>
			warning.includes("portfolio") && warning.includes("IndexNow")),
);

await harness.context.storage.schemas.put("concurrent-schema", {
	storageVersion: 1,
	name: "Concurrent schema",
	scope: "services",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Service" }),
	enabled: false,
	createdAt: "2026-07-14T17:01:00.000Z",
	updatedAt: "2026-07-14T17:01:00.000Z",
});
const writesBeforeStaleApply = harness.kvWrites + harness.schemaWrites + harness.schemaDeletes;
const staleApply = await handler("admin-portability-apply")(route({
	bundle,
	mode: "merge",
	confirmation: SEO_PORTABILITY_CONFIRMATION,
	planFingerprint: preview.plan.fingerprint,
}), harness.context);
check("apply rejects a stale preview", staleApply.success === false && staleApply.error === "preview_stale");
check("stale preview rejection performs no writes", harness.kvWrites + harness.schemaWrites + harness.schemaDeletes === writesBeforeStaleApply);

const freshPreview = await handler("admin-portability-preview")(route({ bundle, mode: "merge" }), harness.context);
check("preview refreshes after concurrent changes", freshPreview.success === true && freshPreview.plan.fingerprint !== preview.plan.fingerprint);
const missingConfirmation = await handler("admin-portability-apply")(route({
	bundle,
	mode: "merge",
	confirmation: "NO",
	planFingerprint: freshPreview.plan.fingerprint,
}), harness.context);
check("apply requires exact confirmation", missingConfirmation.success === false && missingConfirmation.error === "confirmation_required");
check("missing confirmation performs no writes", harness.kvWrites + harness.schemaWrites + harness.schemaDeletes === writesBeforeStaleApply);

// A human edit can land after apply reads the normalized state but before it
// captures raw rollback values. The apply route brackets that read with raw
// snapshots, rejects the stale preview, and never treats the human edit as a
// safe baseline that the import may overwrite.
const interleavedHumanSettings = {
	...(harness.kv.get(globalSettingsKey) as Record<string, unknown>),
	siteName: "Human edit between portability reads",
	updatedAt: "2026-07-14T17:30:00.000Z",
};
const writesBeforeInterleavedApply =
	harness.kvWrites + harness.schemaWrites + harness.schemaDeletes;
harness.afterNthNextRead(
	globalSettingsKey,
	2,
	globalSettingsKey,
	interleavedHumanSettings,
);
const interleavedApply = await handler("admin-portability-apply")(
	route({
		bundle,
		mode: "merge",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: freshPreview.plan.fingerprint,
	}),
	harness.context,
);
check(
	"apply rejects an edit between normalized-state and rollback-snapshot reads",
	interleavedApply.success === false &&
		interleavedApply.error === "preview_stale",
);
check(
	"interleaved stale rejection preserves the human value without writes",
	(harness.kv.get(globalSettingsKey) as any)?.siteName ===
		"Human edit between portability reads" &&
		harness.kvWrites + harness.schemaWrites + harness.schemaDeletes ===
			writesBeforeInterleavedApply,
);

const postInterleavePreview = await handler("admin-portability-preview")(
	route({ bundle, mode: "merge" }),
	harness.context,
);
const applied = await handler("admin-portability-apply")(
	route({
		bundle,
		mode: "merge",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: postInterleavePreview.plan.fingerprint,
	}),
	harness.context,
);
check("confirmed import succeeds", applied.success === true);
check("apply returns a pre-import backup", applied.success === true && applied.backup.source.siteUrl === "https://target.example");
const savedSettings = await handler("admin-settings")(route(), harness.context);
check("import persists normalized settings", savedSettings.values.siteUrl === "https://imported.example");
check("merge imports custom schemas", harness.schemas.has("imported-schema"));
check("merge preserves local custom schemas", harness.schemas.has("target-schema"));
check("merge preserves schemas created after the first preview", harness.schemas.has("concurrent-schema"));
const indexNowRecord = harness.kv.get(`settings:indexnow:v${SEO_ADMIN_INDEXNOW_STORAGE_VERSION}`) as any;
check("domain change disables IndexNow", indexNowRecord.values.enabled === false);
check("domain change preserves the local IndexNow key", indexNowRecord.values.apiKey === "target-key-1234");

const rollbackBundle = structuredClone(bundle);
rollbackBundle.source.siteName = "Rollback test";
rollbackBundle.configuration.settings.siteName = "Rollback test";
// The template write must happen for its injected failure to interrupt the import.
rollbackBundle.configuration.templates.posts.title = "{{title}} | Rollback test";
const beforeFailureKv = JSON.stringify([...harness.kv.entries()]);
const beforeFailureSchemas = JSON.stringify([...harness.schemas.entries()]);
harness.failNextWrite("configuration:templates:v1");
const rollbackPreview = await handler("admin-portability-preview")(route({
	bundle: rollbackBundle,
	mode: "replace",
}), harness.context);
const failedApply = await handler("admin-portability-apply")(route({
	bundle: rollbackBundle,
	mode: "replace",
	confirmation: SEO_PORTABILITY_CONFIRMATION,
	planFingerprint: rollbackPreview.plan.fingerprint,
}), harness.context);
check("partial write failure is reported", failedApply.success === false && failedApply.error === "apply_failed");
check("partial write failure performs automatic rollback", failedApply.rollbackPerformed === true);
check("rollback restores exact KV snapshots", JSON.stringify([...harness.kv.entries()]) === beforeFailureKv);
check("rollback restores exact custom schema snapshots", JSON.stringify([...harness.schemas.entries()]) === beforeFailureSchemas);

// Rollback writes can commit and then reject at the host transport boundary.
// Re-reading the exact snapshot value reconciles that outcome as a successful
// restore instead of incorrectly escalating to rollback_failed.
const ambiguousKvRollbackBundle = structuredClone(bundle);
ambiguousKvRollbackBundle.source.siteName = "Ambiguous KV rollback";
ambiguousKvRollbackBundle.configuration.settings.siteName =
	"Ambiguous KV rollback";
ambiguousKvRollbackBundle.configuration.templates.posts.title = "{{title}} | Ambiguous rollback";
const ambiguousKvRollbackPreview = await handler("admin-portability-preview")(
	route({
		bundle: ambiguousKvRollbackBundle,
		mode: "replace",
	}),
	harness.context,
);
const beforeAmbiguousKv = JSON.stringify([...harness.kv.entries()]);
const previousGlobalSettings = structuredClone(
	harness.kv.get(globalSettingsKey),
);
harness.rejectAfterCommittedWrite(globalSettingsKey, previousGlobalSettings);
harness.failNextWrite("configuration:templates:v1");
const ambiguousKvRollback = await handler("admin-portability-apply")(
	route({
		bundle: ambiguousKvRollbackBundle,
		mode: "replace",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: ambiguousKvRollbackPreview.plan.fingerprint,
	}),
	harness.context,
);
check(
	"committed-then-rejected KV rollback is reconciled as a full restore",
	ambiguousKvRollback.success === false &&
		ambiguousKvRollback.error === "apply_failed" &&
		ambiguousKvRollback.rollbackPerformed === true,
);
check(
	"ambiguous KV rollback restores the exact raw snapshot",
	JSON.stringify([...harness.kv.entries()]) === beforeAmbiguousKv,
);

const ambiguousSchemaRollbackBundle = structuredClone(bundle);
ambiguousSchemaRollbackBundle.source.siteName = "Ambiguous schema rollback";
ambiguousSchemaRollbackBundle.configuration.settings.siteName =
	"Ambiguous schema rollback";
// Only changed schemas are written, so both records change for the injected outcomes to occur.
for (const schema of ambiguousSchemaRollbackBundle.configuration.customSchemas)
	schema.name = `${schema.name} (ambiguous rollback)`;
const ambiguousSchemaRollbackPreview = await handler(
	"admin-portability-preview",
)(
	route({
		bundle: ambiguousSchemaRollbackBundle,
		mode: "replace",
	}),
	harness.context,
);
const beforeAmbiguousSchemas = JSON.stringify([...harness.schemas.entries()]);
const previousTargetSchema = structuredClone(
	harness.schemas.get("target-schema"),
);
harness.rejectAfterCommittedSchemaWrite("target-schema", previousTargetSchema);
harness.failNextSchemaWrite("imported-schema");
const ambiguousSchemaRollback = await handler("admin-portability-apply")(
	route({
		bundle: ambiguousSchemaRollbackBundle,
		mode: "replace",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: ambiguousSchemaRollbackPreview.plan.fingerprint,
	}),
	harness.context,
);
check(
	"a lost schema rollback acknowledgement remains unconfirmed",
	ambiguousSchemaRollback.success === false &&
		ambiguousSchemaRollback.error === "rollback_failed" &&
		ambiguousSchemaRollback.rollbackPerformed === false &&
		(ambiguousSchemaRollback.errors ?? []).some((message: string) => message.includes("schema:target-schema rollback could not be confirmed")),
);
check(
	"ambiguous schema rollback restores the exact raw snapshot",
	JSON.stringify([...harness.schemas.entries()]) === beforeAmbiguousSchemas,
);

// If a human changes a key after the import wrote it but before a later write
// fails, rollback must restore only the still-expected import writes. The human
// value remains and the result explicitly reports partial/conflicted state.
const kvConflictBundle = structuredClone(bundle);
kvConflictBundle.source.siteName = "KV conflict test";
kvConflictBundle.configuration.settings.siteName = "KV conflict test";
// The template write must happen for its injected failure to interrupt the import.
kvConflictBundle.configuration.templates.posts.title = "{{title}} | KV conflict test";
const kvConflictPreview = await handler("admin-portability-preview")(
	route({
		bundle: kvConflictBundle,
		mode: "replace",
	}),
	harness.context,
);
const humanSettings = {
	...(harness.kv.get(globalSettingsKey) as Record<string, unknown>),
	siteName: "Human settings edit during import",
	updatedAt: "2026-07-14T18:00:00.000Z",
};
harness.afterNextWrite(globalSettingsKey, humanSettings);
harness.failNextWrite("configuration:templates:v1");
const kvConflictApply = await handler("admin-portability-apply")(
	route({
		bundle: kvConflictBundle,
		mode: "replace",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: kvConflictPreview.plan.fingerprint,
	}),
	harness.context,
);
check(
	"rollback reports a KV conflict instead of claiming a full restore",
	kvConflictApply.success === false &&
		kvConflictApply.error === "rollback_conflict" &&
		kvConflictApply.rollbackPerformed === false,
);
check(
	"rollback preserves a concurrent human KV edit",
	(harness.kv.get(globalSettingsKey) as any)?.siteName ===
		"Human settings edit during import",
);
check(
	"rollback names the conflicted KV key",
	Array.isArray(kvConflictApply.errors) &&
		kvConflictApply.errors.some((error: string) =>
			error.includes(globalSettingsKey),
		),
);

// The same expected-value rule applies to collection records. A custom schema
// edited after this import's put is never overwritten by rollback.
const schemaConflictBundle = structuredClone(bundle);
schemaConflictBundle.source.siteName = "Schema conflict test";
schemaConflictBundle.configuration.settings.siteName = "Schema conflict test";
for (const schema of schemaConflictBundle.configuration.customSchemas)
	schema.name = `${schema.name} (schema conflict)`;
const schemaConflictPreview = await handler("admin-portability-preview")(
	route({
		bundle: schemaConflictBundle,
		mode: "replace",
	}),
	harness.context,
);
const humanSchema = {
	...(harness.schemas.get("target-schema") as Record<string, unknown>),
	name: "Human schema edit during import",
	updatedAt: "2026-07-14T18:05:00.000Z",
};
harness.afterNextSchemaWrite("target-schema", humanSchema);
harness.failNextSchemaWrite("imported-schema");
const schemaConflictApply = await handler("admin-portability-apply")(
	route({
		bundle: schemaConflictBundle,
		mode: "replace",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: schemaConflictPreview.plan.fingerprint,
	}),
	harness.context,
);
check(
	"rollback reports a schema conflict instead of claiming a full restore",
	schemaConflictApply.success === false &&
		schemaConflictApply.error === "rollback_conflict",
);
check(
	"rollback preserves a concurrent human schema edit",
	(harness.schemas.get("target-schema") as any)?.name ===
		"Human schema edit during import",
);
check(
	"rollback names the conflicted schema record",
	Array.isArray(schemaConflictApply.errors) &&
		schemaConflictApply.errors.some((error: string) =>
			error.includes("target-schema"),
		),
);

// A write that overlaps an otherwise successful import is verified before the
// route can claim success. The import rolls back its unchanged writes and
// preserves the overlapping human value as an explicit conflict.
const successfulOverlapBundle = structuredClone(bundle);
successfulOverlapBundle.source.siteName = "Successful overlap test";
successfulOverlapBundle.configuration.settings.siteName =
	"Successful overlap test";
const successfulOverlapPreview = await handler("admin-portability-preview")(
	route({
		bundle: successfulOverlapBundle,
		mode: "merge",
	}),
	harness.context,
);
const humanOverlapSettings = {
	...(harness.kv.get(globalSettingsKey) as Record<string, unknown>),
	siteName: "Human edit overlapping a successful import",
	updatedAt: "2026-07-14T18:10:00.000Z",
};
harness.afterNextWrite(globalSettingsKey, humanOverlapSettings);
const successfulOverlapApply = await handler("admin-portability-apply")(
	route({
		bundle: successfulOverlapBundle,
		mode: "merge",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: successfulOverlapPreview.plan.fingerprint,
	}),
	harness.context,
);
check(
	"a concurrent write prevents an import from claiming success",
	successfulOverlapApply.success === false &&
		successfulOverlapApply.error === "rollback_conflict",
);
check(
	"successful-import verification preserves the overlapping human value",
	(harness.kv.get(globalSettingsKey) as any)?.siteName ===
		"Human edit overlapping a successful import",
);

const leaked = structuredClone(bundle) as any;
leaked.configuration.indexNow.apiKey = "leaked-key";
const invalidPreview = await handler("admin-portability-preview")(route({ bundle: leaked, mode: "merge" }), harness.context);
check("secret-bearing imports are rejected", invalidPreview.success === false && invalidPreview.error === "invalid_bundle");

const versionedHarness = createContext();
await (seoRuntime as any).hooks["plugin:install"].handler({}, versionedHarness.context);
await versionedHarness.context.kv.set("settings:global:v1", {
	version: 1,
	updatedAt: "2026-07-14T16:30:00.000Z",
	siteName: "Versioned target",
	siteUrl: "https://target.example",
	publisherType: "organization",
	organizationName: "Versioned target",
	organizationLogo: "",
	personName: "",
	socialProfiles: [],
	personProfiles: [],
	defaultSocialImage: "",
	twitterHandle: "",
	noindex: false,
	contentScoringEnabled: true,
	indexingPreferenceConfirmed: true,
});
const versionedKv = versionedHarness.context.kv as any;
const revisions = new Map<string, string>([...versionedHarness.kv.keys()].map((key) => [key, "0"]));
let nextRevision = 0;
const originalSet = versionedKv.set.bind(versionedKv);
const originalDelete = versionedKv.delete.bind(versionedKv);
versionedKv.set = async (key: string, value: unknown) => {
	await originalSet(key, value);
	revisions.set(key, String(++nextRevision));
};
versionedKv.delete = async (key: string) => {
	const deleted = await originalDelete(key);
	if (deleted) revisions.delete(key);
	return deleted;
};
versionedKv.getVersioned = async (key: string) => {
	const revision = revisions.get(key);
	return revision === undefined ? null : {
		value: structuredClone(versionedHarness.kv.get(key)),
		revision,
	};
};
versionedKv.compareAndSet = async (key: string, expectedRevision: string | null, value: unknown) => {
	if ((revisions.get(key) ?? null) !== expectedRevision) return { applied: false };
	versionedHarness.kv.set(key, structuredClone(value));
	const revision = String(++nextRevision);
	revisions.set(key, revision);
	return { applied: true, revision };
};
versionedKv.compareAndDelete = async (key: string, expectedRevision: string) => {
	if (revisions.get(key) !== expectedRevision) return { applied: false };
	versionedHarness.kv.delete(key);
	revisions.delete(key);
	return { applied: true };
};
const versionedExport = await handler("admin-portability-export")(route(), versionedHarness.context);
const versionedBundle = structuredClone(versionedExport.bundle) as SeoPortabilityBundle;
versionedBundle.source.siteName = "Imported versioned settings";
versionedBundle.configuration.settings.siteName = "Imported versioned settings";
versionedBundle.configuration.indexNow.minIntervalSeconds += 1;
// The rotation below is injected after the preset write, which happens only when presets change.
versionedBundle.configuration.schemaPresets.faqPage = !versionedBundle.configuration.schemaPresets.faqPage;
versionedBundle.configuration.customSchemas.push({
	id: "versioned-import",
	name: "Versioned import",
	scope: "global",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing" }),
	enabled: false,
});
const versionedPreview = await handler("admin-portability-preview")(
	route({ bundle: versionedBundle, mode: "merge" }), versionedHarness.context,
);
check("versioned import preview is valid", versionedPreview.success === true);
const beforeVersionedFailure = JSON.stringify([...versionedHarness.kv.entries()]);
versionedHarness.failNextSchemaWrite("versioned-import");
const versionedFailure = await handler("admin-portability-apply")(
	route({
		bundle: versionedBundle,
		mode: "merge",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: versionedPreview.plan?.fingerprint ?? "",
	}),
	versionedHarness.context,
);
check(
	"an unconfirmed schema write preserves IndexNow recovery without claiming full restoration",
	versionedFailure.success === false && versionedFailure.error === "rollback_conflict" &&
		versionedFailure.rollbackPerformed === false &&
		(versionedFailure.errors ?? []).some((message: string) => message.includes("schema:versioned-import may have changed during an unconfirmed write")) &&
		JSON.stringify([...versionedHarness.kv.entries()]) === beforeVersionedFailure,
);
const concurrentVersionedPreview = await handler("admin-portability-preview")(
	route({ bundle: versionedBundle, mode: "merge" }), versionedHarness.context,
);
const indexNowKey = `settings:indexnow:v${SEO_ADMIN_INDEXNOW_STORAGE_VERSION}`;
const originalSchemaPut = versionedHarness.context.storage.schemas.put;
const humanIndexNowSettings = {
	version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	updatedAt: "2026-07-14T19:00:00.000Z",
	values: {
		enabled: false,
		autoSubmit: false,
		autoSubmitContentTypes: null,
		apiKey: "human-key-1234",
		keyLocation: "/indexnow-key.txt",
		batchSize: 100,
		minIntervalSeconds: 300,
		maxAttempts: 5,
	},
};
versionedHarness.context.storage.schemas.put = async (id: string, value: unknown) => {
	if (id === "versioned-import") {
		await versionedKv.set(indexNowKey, humanIndexNowSettings);
		throw new Error("Injected schema write failure after a concurrent settings edit");
	}
	return originalSchemaPut(id, value);
};
const concurrentVersionedFailure = await handler("admin-portability-apply")(
	route({
		bundle: versionedBundle,
		mode: "merge",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: concurrentVersionedPreview.plan.fingerprint,
	}),
	versionedHarness.context,
);
check(
	"rollback preserves a newer IndexNow edit after the import's conditional write",
	concurrentVersionedFailure.success === false &&
		concurrentVersionedFailure.error === "rollback_conflict" &&
		JSON.stringify(versionedHarness.kv.get(indexNowKey)) === JSON.stringify(humanIndexNowSettings),
);

versionedHarness.context.storage.schemas.put = originalSchemaPut;
const rotatedVersionedIndexNow = {
	...humanIndexNowSettings,
	updatedAt: "2026-07-14T19:05:00.000Z",
	values: { ...humanIndexNowSettings.values, apiKey: "rotated-key-5678" },
};
const versionedRotationPreview = await handler("admin-portability-preview")(
	route({ bundle: versionedBundle, mode: "merge" }), versionedHarness.context,
);
const casBeforeRotation = versionedKv.compareAndSet;
versionedKv.compareAndSet = async (key: string, expected: string | null, value: unknown) => {
	const result = await casBeforeRotation(key, expected, value);
	if (key === "configuration:schema-presets:v2" && result.applied) {
		versionedKv.compareAndSet = casBeforeRotation;
		await versionedKv.set(indexNowKey, rotatedVersionedIndexNow);
	}
	return result;
};
const versionedRotationApply = await handler("admin-portability-apply")(
	route({
		bundle: versionedBundle,
		mode: "merge",
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: versionedRotationPreview.plan.fingerprint,
	}),
	versionedHarness.context,
);
versionedKv.compareAndSet = casBeforeRotation;
check(
	"a versioned import does not overwrite an IndexNow key rotated while it was applied",
	versionedRotationPreview.success === true &&
		versionedRotationApply.success === false &&
		(versionedHarness.kv.get(indexNowKey) as any)?.values.apiKey === "rotated-key-5678",
);

const templateHarness = createContext();
const inheritedTemplateConfiguration = await handler("admin-templates")(route(), templateHarness.context);
const savedTemplateValues = Object.fromEntries(
	inheritedTemplateConfiguration.items.map((item: any) => [item.collection, structuredClone(item.values)]),
);
savedTemplateValues.posts.title = "Custom {{title}}";
savedTemplateValues.services.title = "Service {{title}}";
// A full set saved by an earlier version: Pages is pinned to a value equal to its inheritance.
await templateHarness.context.kv.set("configuration:templates:v1", {
	version: 1,
	updatedAt: "2026-07-14T09:00:00.000Z",
	values: savedTemplateValues,
	collectionUpdatedAt: {
		posts: "2026-07-14T09:00:00.000Z",
		pages: "2026-07-14T08:00:00.000Z",
		services: "2026-07-14T09:00:00.000Z",
	},
});
const templateSave = { success: true };
const templateRecordBefore = structuredClone(templateHarness.kv.get("configuration:templates:v1")) as any;
const postsOnlyBundle = structuredClone(
	(await handler("admin-portability-export")(route(), templateHarness.context)).bundle,
);
delete postsOnlyBundle.configuration.templates.pages;
delete postsOnlyBundle.configuration.templates.services;
const postsOnlyPreview = await handler("admin-portability-preview")(
	route({ bundle: postsOnlyBundle, mode: "replace" }),
	templateHarness.context,
);
check(
	"replace preview counts only saved templates that differ from their inherited value",
	templateSave.success === true &&
		postsOnlyPreview.success === true &&
		postsOnlyPreview.plan.sections.find((section: any) => section.key === "templates")?.deleted === 1,
);
const postsOnlyApply = await handler("admin-portability-apply")(route({
	bundle: postsOnlyBundle,
	mode: "replace",
	confirmation: SEO_PORTABILITY_CONFIRMATION,
	planFingerprint: postsOnlyPreview.plan.fingerprint,
}), templateHarness.context);
const templateRecordAfter = templateHarness.kv.get("configuration:templates:v1") as any;
check(
	"a replace import keeps a saved template equal to its inherited value, with its score revision",
	postsOnlyApply.success === true &&
		templateRecordAfter.values.pages !== undefined &&
		templateRecordAfter.collectionUpdatedAt.pages === templateRecordBefore.collectionUpdatedAt.pages &&
		templateRecordAfter.collectionUpdatedAt.services !== templateRecordBefore.collectionUpdatedAt.services,
);

const rotationHarness = createContext();
const rotationIndexNowKey = `settings:indexnow:v${SEO_ADMIN_INDEXNOW_STORAGE_VERSION}`;
await rotationHarness.context.kv.set(rotationIndexNowKey, {
	version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	updatedAt: "2026-07-14T16:00:00.000Z",
	values: {
		enabled: true,
		autoSubmit: true,
		apiKey: "original-key-1234",
		keyLocation: "/indexnow-key.txt",
		batchSize: 100,
		minIntervalSeconds: 300,
		maxAttempts: 5,
	},
});
const rotationBundle = (await handler("admin-portability-export")(route(), rotationHarness.context)).bundle;
rotationBundle.configuration.settings.organizationName = "Imported organization";
// Only a changed IndexNow policy is written, and the rotation is injected after a changed preset write.
rotationBundle.configuration.indexNow.minIntervalSeconds += 1;
rotationBundle.configuration.schemaPresets.faqPage = !rotationBundle.configuration.schemaPresets.faqPage;
const rotationPreview = await handler("admin-portability-preview")(
	route({ bundle: rotationBundle, mode: "merge" }),
	rotationHarness.context,
);
const rotatedIndexNow = {
	version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
	updatedAt: "2026-07-14T16:05:00.000Z",
	values: {
		enabled: true,
		autoSubmit: true,
		apiKey: "rotated-key-5678",
		keyLocation: "/indexnow-key.txt",
		batchSize: 100,
		minIntervalSeconds: 300,
		maxAttempts: 5,
	},
};
rotationHarness.afterNextWrite("configuration:schema-presets:v2", rotatedIndexNow, rotationIndexNowKey);
const rotationApply = await handler("admin-portability-apply")(route({
	bundle: rotationBundle,
	mode: "merge",
	confirmation: SEO_PORTABILITY_CONFIRMATION,
	planFingerprint: rotationPreview.plan.fingerprint,
}), rotationHarness.context);
check(
	"an import does not overwrite an IndexNow key rotated while it was applied",
	rotationPreview.success === true &&
		rotationApply.success === false &&
		(rotationHarness.kv.get(rotationIndexNowKey) as any)?.values.apiKey === "rotated-key-5678",
);

// A concurrent writer stores the same template bytes again after the import's
// own write; rollback must keep that newer revision instead of adopting it.
const abaHarness = createContext();
const abaTemplatesKey = "configuration:templates:v1";
const abaBundle = structuredClone(
	(await handler("admin-portability-export")(route(), abaHarness.context)).bundle,
) as SeoPortabilityBundle;
abaBundle.configuration.templates.posts.title = "{{title}} | Imported";
abaBundle.configuration.customSchemas.push({
	id: "aba-schema",
	name: "ABA schema",
	scope: "global",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing" }),
	enabled: false,
});
const abaPreview = await handler("admin-portability-preview")(route({ bundle: abaBundle, mode: "merge" }), abaHarness.context);
const abaKv = abaHarness.context.kv as any;
const abaCompareAndSet = abaKv.compareAndSet;
let abaWritten: unknown = null;
abaKv.compareAndSet = async function (key: string, expected: string | null, value: unknown) {
	const result = await abaCompareAndSet.call(this, key, expected, value);
	if (key === abaTemplatesKey && result.applied && abaWritten === null) {
		abaWritten = structuredClone(value);
		await abaKv.set(key, value);
	}
	return result;
};
abaHarness.failNextSchemaWrite("aba-schema");
const abaApply = await handler("admin-portability-apply")(route({
	bundle: abaBundle,
	mode: "merge",
	confirmation: SEO_PORTABILITY_CONFIRMATION,
	planFingerprint: abaPreview.plan.fingerprint,
}), abaHarness.context);
abaKv.compareAndSet = abaCompareAndSet;
check(
	"template rollback keeps an equal-value write made after the import's own write",
	abaApply.success === false &&
		abaApply.error === "rollback_conflict" &&
		(abaApply.errors ?? []).some((message: string) => message.startsWith(abaTemplatesKey)) &&
		JSON.stringify(abaHarness.kv.get(abaTemplatesKey)) === JSON.stringify(abaWritten),
);

// Nonempty assessment purpose is portable; activation acknowledgement is local.
async function profileHarness() {
	const current = createContext();
	await current.context.kv.set("settings:global:v1", {
		version: 1, updatedAt: "2026-10-15T00:00:00.000Z",
		...defaultSettingsValues({ siteName: "Profile fixture", siteUrl: "https://target.example" }),
		contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1, indexingPreferenceConfirmed: true,
	});
	await current.context.kv.set(collectionAnalysisProfileKey("posts"), { version: 1, profile: "article", updatedAt: "2026-10-15T00:00:00.000Z" });
	await current.context.kv.set(collectionAnalysisProfileKey("pages"), { version: 1, profile: "general", updatedAt: "2026-10-15T00:00:00.000Z" });
	return current;
}
const profileTarget = await profileHarness();
const profileExport = await handler("admin-portability-export")(route(), profileTarget.context);
check("nonempty per-collection purposes are discovered in export without revisions or timestamps",
	JSON.stringify(profileExport.bundle.configuration.analysisProfiles) === JSON.stringify({ posts: { profile: "article", version: 1 }, pages: { profile: "general", version: 1 } }));
const purposeBundle = structuredClone(profileExport.bundle) as SeoPortabilityBundle;
purposeBundle.configuration.analysisProfiles = { posts: { profile: "general", version: 1 } };
const purposePreview = await handler("admin-portability-preview")(route({ bundle: purposeBundle, mode: "replace" }), profileTarget.context);
const purposeApplied = await handler("admin-portability-apply")(route({ bundle: purposeBundle, mode: "replace", confirmation: SEO_PORTABILITY_CONFIRMATION, planFingerprint: purposePreview.plan?.fingerprint }), profileTarget.context);
check("replace imports the selected purpose and removes the omitted purpose without changing schema",
	purposeApplied.success === true &&
		(await readCollectionAnalysisProfile(profileTarget.context as any, "posts")).state === "configured" &&
		(profileTarget.kv.get(collectionAnalysisProfileKey("posts")) as any)?.profile === "general" &&
		!profileTarget.kv.has(collectionAnalysisProfileKey("pages")) && profileTarget.schemas.size === 0);
check("a successful import preserves intent but requires local resource acknowledgement",
	(await readContentScoringPolicy(profileTarget.context as any)).state === "pending-confirmation" &&
		(profileTarget.kv.get("settings:global:v1") as any)?.contentScoringEnabled === true &&
		(profileTarget.kv.get("settings:global:v1") as any)?.contentScoringResourceNoticeVersion === undefined);
check("a successful import keeps the stored indexing preference confirmation",
	(profileTarget.kv.get("settings:global:v1") as any)?.indexingPreferenceConfirmed === true);
const failedProfileTarget = await profileHarness();
const failedPurposeBundle = structuredClone(purposeBundle);
failedPurposeBundle.configuration.customSchemas.push({ id: "assessment-failure", name: "Failure fixture", scope: "global", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing" }), enabled: false });
const failedPurposePreview = await handler("admin-portability-preview")(route({ bundle: failedPurposeBundle, mode: "replace" }), failedProfileTarget.context);
const rawProfileBefore = JSON.stringify([...failedProfileTarget.kv.entries()].sort(([left], [right]) => left.localeCompare(right)));
failedProfileTarget.failNextSchemaWrite("assessment-failure");
const purposeFailed = await handler("admin-portability-apply")(route({ bundle: failedPurposeBundle, mode: "replace", confirmation: SEO_PORTABILITY_CONFIRMATION, planFingerprint: failedPurposePreview.plan?.fingerprint }), failedProfileTarget.context);
check("an unconfirmed schema write restores raw purposes without claiming full restoration",
	purposeFailed.success === false && purposeFailed.error === "rollback_conflict" && purposeFailed.rollbackPerformed === false &&
		(purposeFailed.errors ?? []).some((message: string) => message.includes("schema:assessment-failure may have changed during an unconfirmed write")) &&
		JSON.stringify([...failedProfileTarget.kv.entries()].sort(([left], [right]) => left.localeCompare(right))) === rawProfileBefore);
check("failed import restores the prior local activation acknowledgement",
	(await readContentScoringPolicy(failedProfileTarget.context as any)).state === "enabled" &&
		(failedProfileTarget.kv.get("settings:global:v1") as any)?.contentScoringResourceNoticeVersion === 1);

if (failures) {
	console.error(`\n${failures} SEO portability runtime self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nAll SEO portability runtime self-checks passed.");
}
