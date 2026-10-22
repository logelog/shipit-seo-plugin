import { composeSeoSchema, seoSchemaComposerFields, SEO_SCHEMA_COMPOSER_RECIPES } from "./schema-composer.ts";
import {
	SEO_ADMIN_CONFIGURATION_VERSION,
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_MODULES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminModuleValues,
	type SeoAdminSchemaPresetValues,
} from "./admin-contract.ts";
import { parseSeoAdminConfiguration, parseSeoAdminModulesSaveResult } from "./admin-ui/contract.ts";
import seoRuntime from "./sandbox-entry.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

function createContext() {
	const values = new Map<string, unknown>([
		["module:seoAnalyzer", true],
		["module:sitemap", true],
		["module:analytics", true],
		["preset:organization", false],
		["configuration:schema-presets:v1", {
			version: 1,
			updatedAt: "2026-07-10T10:00:00.000Z",
			values: {
				organization: false,
				website: true,
				blogPosting: true,
				service: false,
				breadcrumbList: true,
			},
		}],
	]);
	const schemas = new Map<string, any>([
		["legacy-schema", {
			name: "Legacy WebPage",
			scope: "pages",
			json: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage" }),
			enabled: true,
			createdAt: "2026-07-01T10:00:00.000Z",
			updatedAt: "2026-07-01T10:00:00.000Z",
		}],
		["identity-owner", {
			storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
			name: "Page identity owner",
			scope: "pages",
			json: JSON.stringify({
				"@context": "https://schema.org",
				"@type": "WebPage",
				"@id": "https://example.com/faq#webpage",
				name: "FAQ",
			}),
			enabled: true,
			createdAt: "2026-07-02T10:00:00.000Z",
			updatedAt: "2026-07-02T10:00:00.000Z",
		}],
	]);
	let kvSetCount = 0;
	let schemaPutCount = 0;
	let schemaDeleteCount = 0;
	const kvRevisions = new Map<string, string>();
	const schemaRevisions = new Map<string, string>();
	let nextRevision = 0;
	let schemaCountCalls = 0;
	let rejectNextSchemaPutAfterCommit = false;
	let failSchemaCountOnCall: number | null = null;
	let injectSchemaOnCountCall: {
		call: number;
		id: string;
		value: unknown;
	} | null = null;
	return {
		context: {
			plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
			kv: {
				get: async (key: string) => structuredClone(values.get(key) ?? null),
				// Published hosts read settings with revisions; unchanged rows keep one.
				getVersioned: async (key: string) => values.has(key) ? { value: structuredClone(values.get(key)), revision: kvRevisions.get(key) ?? `initial:${key}` } : null,
				compareAndSet: async (key: string, revision: string | null, value: unknown) => {
					const current = values.has(key) ? kvRevisions.get(key) ?? `initial:${key}` : null;
					if (current !== revision) return { applied: false };
					const next = `kv:${++nextRevision}`;
					kvSetCount += 1; values.set(key, structuredClone(value)); kvRevisions.set(key, next);
					return { applied: true, revision: next };
				},
				compareAndDelete: async (key: string, revision: string) => {
					if (!values.has(key) || (kvRevisions.get(key) ?? `initial:${key}`) !== revision) return { applied: false };
					values.delete(key); kvRevisions.delete(key); return { applied: true };
				},
				set: async (key: string, value: unknown) => {
					kvSetCount += 1;
					values.set(key, structuredClone(value));
				},
				delete: async (key: string) => values.delete(key),
				list: async () => [],
			},
			storage: {
				schemas: {
					get: async (id: string) => structuredClone(schemas.get(id) ?? null),
					getVersioned: async (id: string) => schemas.has(id)
						? { value: structuredClone(schemas.get(id)), revision: schemaRevisions.get(id) ?? `initial:${id}` } : null,
					compareAndSet: async (id: string, revision: string | null, value: unknown) => {
						const current = schemas.has(id) ? schemaRevisions.get(id) ?? `initial:${id}` : null;
						if (current !== revision) return { applied: false };
						const next = `schema:${++nextRevision}`;
						schemaPutCount += 1; schemas.set(id, structuredClone(value)); schemaRevisions.set(id, next);
						if (rejectNextSchemaPutAfterCommit) {
							rejectNextSchemaPutAfterCommit = false;
							throw new Error("Injected rejection after committed schema write");
						}
						return { applied: true, revision: next };
					},
					compareAndDelete: async (id: string, revision: string) => {
						if (!schemas.has(id) || (schemaRevisions.get(id) ?? `initial:${id}`) !== revision) return { applied: false };
						schemaDeleteCount += 1; schemas.delete(id); schemaRevisions.delete(id); return { applied: true };
					},
					count: async () => {
						schemaCountCalls += 1;
						if (injectSchemaOnCountCall?.call === schemaCountCalls) {
							schemas.set(
								injectSchemaOnCountCall.id,
								structuredClone(injectSchemaOnCountCall.value),
							);
							injectSchemaOnCountCall = null;
						}
						if (failSchemaCountOnCall === schemaCountCalls) {
							failSchemaCountOnCall = null;
							throw new Error("Injected schema count failure");
						}
						return schemas.size;
					},
					put: async (id: string, value: unknown) => {
						schemaPutCount += 1;
						schemas.set(id, structuredClone(value));
						if (rejectNextSchemaPutAfterCommit) {
							rejectNextSchemaPutAfterCommit = false;
							throw new Error(
								"Injected rejection after committed schema write",
							);
						}
					},
					delete: async (id: string) => {
						schemaDeleteCount += 1;
						return schemas.delete(id);
					},
					query: async ({
						limit = 50,
						cursor,
					}: { limit?: number; cursor?: string } = {}) => {
						const start = Number.parseInt(cursor ?? "0", 10) || 0;
						const pageLimit = Math.min(limit, 100);
						const entries = [...schemas.entries()];
						const hasMore = start + pageLimit < entries.length;
						return {
							items: entries
								.slice(start, start + pageLimit)
								.map(([id, data]) => ({ id, data: structuredClone(data) })),
							hasMore,
							cursor: hasMore ? String(start + pageLimit) : undefined,
						};
					},
				},
			},
			log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
		},
		values,
		schemas,
		get kvSetCount() {
			return kvSetCount;
		},
		get schemaPutCount() {
			return schemaPutCount;
		},
		get schemaDeleteCount() {
			return schemaDeleteCount;
		},
		rejectNextSchemaPutAfterCommit() {
			rejectNextSchemaPutAfterCommit = true;
		},
		failSchemaCountAfter(additionalCalls: number) {
			failSchemaCountOnCall = schemaCountCalls + additionalCalls;
		},
		injectSchemaOnCountAfter(
			additionalCalls: number,
			id: string,
			value: unknown,
		) {
			injectSchemaOnCountCall = {
				call: schemaCountCalls + additionalCalls,
				id,
				value,
			};
		},
	};
}

function parses(parse: (value: unknown) => unknown, value: unknown): boolean {
	try {
		parse(value);
		return true;
	} catch (error) {
		console.error(error);
		return false;
	}
}

function handler(name: string) {
	return (seoRuntime as any).routes[name].handler as (routeContext: any, context: any) => Promise<any>;
}

function route(input: unknown = {}) {
	return {
		input,
		request: {
			url: "https://example.com/_emdash/api/plugins/shipit-seo/configuration",
			method: "POST",
			headers: {},
		},
	};
}

const harness = createContext();
const initial = await handler("admin-configuration")(route(), harness.context);
check("configuration contract version is explicit", initial.configurationVersion === SEO_ADMIN_CONFIGURATION_VERSION);
check("legacy analyzer switch is not shown enabled", initial.modules.items.find((item: any) => item.key === "seoAnalyzer")?.enabled === false);
check("legacy sitemap policy remains readable without a switch", initial.modules.items.find((item: any) => item.key === "sitemap")?.enabled === true &&
	initial.modules.items.find((item: any) => item.key === "sitemap")?.editable === false);
check("legacy analyzer has no switch", initial.modules.items.find((item: any) => item.key === "seoAnalyzer")?.editable === false);
check("unsupported legacy modules cannot appear active", initial.modules.items.find((item: any) => item.key === "analytics")?.enabled === false);
check("unsupported modules are read-only", initial.modules.items.find((item: any) => item.key === "analytics")?.editable === false);
check("Image SEO is an active default module", initial.modules.items.find((item: any) => item.key === "imageSeo")?.enabled === true);
check("Image SEO can be controlled by administrators", initial.modules.items.find((item: any) => item.key === "imageSeo")?.editable === true);
check("404 Monitor has a switch for sites that forward missing paths", initial.modules.items.find((item: any) => item.key === "monitor404")?.editable === true);
check("the admin client accepts the configuration the engine returns", parses(parseSeoAdminConfiguration, initial));
check("legacy preset value remains readable", initial.schema.presets.items.find((item: any) => item.key === "organization")?.enabled === false);
check("missing legacy presets use safe defaults", initial.schema.presets.items.find((item: any) => item.key === "website")?.enabled === true);
check("v1 preset snapshots retain stored values", initial.schema.presets.items.find((item: any) => item.key === "service")?.enabled === false);
check("new v2 presets use safe disabled defaults", initial.schema.presets.items.find((item: any) => item.key === "webPage")?.enabled === false);
check("legacy preset snapshots request migration", initial.schema.presets.migrationNeeded === true);
const freshInstall = createContext();
freshInstall.values.clear();
const freshConfiguration = await handler("admin-configuration")(route(), freshInstall.context);
check(
	"a fresh install without legacy preset keys reports no migration",
	freshConfiguration.schema.presets.migrationNeeded === false && freshConfiguration.schema.presets.updatedAt === null,
);
check("lazy v1 preset reads do not write storage", harness.kvSetCount === 0);
check("legacy custom schema is normalized", initial.schema.customSchemas[0]?.storageVersion === SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION);
check("custom schema types are detected", initial.schema.customSchemas[0]?.types.includes("WebPage") === true);

const oldSnapshotHarness = createContext();
const oldSnapshotValues = Object.fromEntries(
	SEO_ADMIN_MODULE_DEFINITIONS.map((definition) => [definition.key, definition.defaultEnabled]),
) as SeoAdminModuleValues;
oldSnapshotValues.seoAnalyzer = true;
oldSnapshotValues.sitemap = true;
oldSnapshotValues.redirections = true;
oldSnapshotValues.monitor404 = true;
oldSnapshotValues.localSeo = true;
oldSnapshotHarness.values.set("settings:noindex", false);
oldSnapshotHarness.values.set(`configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`, {
	version: SEO_ADMIN_MODULES_STORAGE_VERSION,
	updatedAt: "2026-07-11T10:00:00.000Z",
	values: oldSnapshotValues,
});
const oldSnapshot = await handler("admin-configuration")(route(), oldSnapshotHarness.context);
check("old module snapshot retains its revision", oldSnapshot.modules.updatedAt === "2026-07-11T10:00:00.000Z");
check("old module snapshot does not mark inert switches enabled", oldSnapshot.modules.items.every((item: any) =>
	item.editable || item.key === "sitemap" || item.status === "site-integration" || !item.enabled));
check("old site integration setting remains readable", oldSnapshot.modules.items.find((item: any) => item.key === "monitor404")?.enabled === true);
const oldSnapshotPublicConfig = await handler("public-config")(route(), oldSnapshotHarness.context);
check("old sitemap policy remains available to custom site adapters", oldSnapshotPublicConfig.sitemap.enabled === true &&
	oldSnapshotPublicConfig.sitemapUrl === "/sitemap.xml");
check("old settings do not imply an llms.txt route exists", !("llmsTxt" in oldSnapshotPublicConfig) &&
	!("llmsTxtUrl" in oldSnapshotPublicConfig));
check("old module snapshot remains unchanged in storage", oldSnapshotHarness.kvSetCount === 0 &&
	(oldSnapshotHarness.values.get(`configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`) as any)?.values.sitemap === true);

const invalidModules = Object.fromEntries(initial.modules.items.map((item: any) => [item.key, item.enabled])) as SeoAdminModuleValues;
invalidModules.analytics = true;
check("modules report a writable record with no stored revision yet", initial.modules.writable === true && initial.modules.revision === null);
const unguardedModules = await handler("save-admin-modules")(route({ ...invalidModules, analytics: false }), harness.context);
check("a module save without the loaded revision is refused", unguardedModules.success === false &&
	Boolean(unguardedModules.errors._form) && harness.kvSetCount === 0);
const rejectedModules = await handler("save-admin-modules")(route({ ...invalidModules, expectedRevision: initial.modules.revision }), harness.context);
check("unavailable modules cannot be enabled", rejectedModules.success === false && Boolean(rejectedModules.errors.analytics));
check("invalid module settings perform no writes", harness.kvSetCount === 0);
const sitemapOff = { ...invalidModules, analytics: false, sitemap: false };
const lockedSitemap = await handler("save-admin-modules")(route({ ...sitemapOff, expectedRevision: initial.modules.revision }), harness.context);
check("without native sitemap control the Sitemaps flag cannot change", lockedSitemap.success === false &&
	Boolean(lockedSitemap.errors.sitemap) && harness.kvSetCount === 0);

// Reset falls back to the legacy flag; a locked flag may only reset to its own value.
const legacyOff = createContext();
legacyOff.values.set("module:sitemap", false);
const legacyOffReset = await handler("reset-admin-modules")(route({ expectedRevision: null }), legacyOff.context);
check("a locked legacy-off Sitemaps flag resets unchanged", legacyOffReset.success === true &&
	legacyOffReset.modules.items.find((item: any) => item.key === "sitemap")?.enabled === false);
const snapshotOn = createContext();
snapshotOn.values.set("module:sitemap", false);
snapshotOn.values.set(`configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`, {
	version: SEO_ADMIN_MODULES_STORAGE_VERSION,
	updatedAt: "2026-10-01T00:00:00.000Z",
	values: { ...Object.fromEntries(SEO_ADMIN_MODULE_DEFINITIONS.map((definition) => [definition.key, false])), sitemap: true },
});
const snapshotOnRevision = (await handler("admin-configuration")(route(), snapshotOn.context)).modules.revision;
const snapshotOnReset = await handler("reset-admin-modules")(route({ expectedRevision: snapshotOnRevision }), snapshotOn.context);
check("a reset that would switch a locked Sitemaps flag off is refused", snapshotOnReset.success === false &&
	Boolean(snapshotOnReset.errors.sitemap) &&
	snapshotOn.values.has(`configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`));

const validModules = { ...invalidModules, analytics: false, schema: false, imageSeo: false, monitor404: true };
const savedModules = await handler("save-admin-modules")(route({ ...validModules, expectedRevision: initial.modules.revision }), harness.context);
check("valid module settings are persisted", savedModules.success === true);
check("a saved module record reports its new revision", savedModules.success === true && typeof savedModules.modules.revision === "string");
check("404 Monitor can be turned on from feature controls", savedModules.success === true &&
	savedModules.modules.items.find((item: any) => item.key === "monitor404")?.enabled === true);
check("the admin client accepts the saved module result", parses(parseSeoAdminModulesSaveResult, savedModules));
check("module settings use one snapshot write", harness.kvSetCount === 1);
check(
	"module settings use the versioned key",
	harness.values.has(`configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`),
);
check("legacy module keys remain untouched", harness.values.get("module:seoAnalyzer") === true);
const staleModules = await handler("save-admin-modules")(route({ ...validModules, schema: true, expectedRevision: initial.modules.revision }), harness.context);
check("a module save naming an older revision conflicts and writes nothing", staleModules.success === false &&
	staleModules.conflict === true && harness.kvSetCount === 1 &&
	(harness.values.get(`configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`) as any)?.values.schema === false);
check("the admin client accepts a module conflict", parses(parseSeoAdminModulesSaveResult, staleModules));
const staleReset = await handler("reset-admin-modules")(route({ expectedRevision: initial.modules.revision }), harness.context);
check("a module restore naming an older revision conflicts and removes nothing", staleReset.success === false &&
	staleReset.conflict === true && harness.values.has(`configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`));

const presets = Object.fromEntries(initial.schema.presets.items.map((item: any) => [item.key, item.enabled])) as SeoAdminSchemaPresetValues;
presets.organization = true;
const savedPresets = await handler("save-admin-schema-presets")(route({ values: presets, expectedRevision: null }), harness.context);
check("schema presets are persisted", savedPresets.success === true);
check("schema presets use one snapshot write", harness.kvSetCount === 2);
check(
	"schema presets use the versioned key",
	harness.values.has(`configuration:schema-presets:v${SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION}`),
);
check("v1 preset snapshot remains available for rollback", harness.values.has("configuration:schema-presets:v1"));

const unsafeSchema = await handler("save-admin-custom-schema")(route({
id: "fixture-create-1", expectedRevision: null,
	name: "Unsafe",
	scope: "global",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", url: "javascript:alert(1)" }),
	enabled: true,
}), harness.context);
check("script-like JSON-LD is rejected", unsafeSchema.success === false && Boolean(unsafeSchema.errors.json));
check("unsafe JSON-LD performs no writes", harness.schemaPutCount === 0);

const scalarArraySchema = await handler("save-admin-custom-schema")(route({
id: "fixture-create-2", expectedRevision: null,
	name: "Invalid array",
	scope: "global",
	json: JSON.stringify([{ "@context": "https://schema.org", "@type": "WebPage" }, "not-an-object"]),
	enabled: true,
}), harness.context);
check("top-level JSON-LD arrays only accept objects", scalarArraySchema.success === false && Boolean(scalarArraySchema.errors.json));
check("invalid JSON-LD arrays perform no writes", harness.schemaPutCount === 0);

const invalidScope = await handler("save-admin-custom-schema")(route({
id: "fixture-create-3", expectedRevision: null,
	name: "Bad scope",
	scope: "pages/*",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage" }),
	enabled: true,
}), harness.context);
check("invalid schema scopes are rejected", invalidScope.success === false && Boolean(invalidScope.errors.scope));

const duplicateDefinitions = await handler("save-admin-custom-schema")(route({
id: "fixture-create-4", expectedRevision: null,
	name: "Duplicate definitions",
	scope: "posts",
	json: JSON.stringify([
		{ "@context": "https://schema.org", "@type": "Thing", "@id": "https://example.com/#entity", name: "One" },
		{ "@type": "Thing", "@id": "https://example.com/#entity", name: "Two" },
	]),
	enabled: true,
}), harness.context);
check("duplicate definitions inside one graph are rejected", duplicateDefinitions.success === false && Boolean(duplicateDefinitions.errors.json));
check("duplicate graph definitions perform no writes", harness.schemaPutCount === 0);

const overlappingIdentity = await handler("save-admin-custom-schema")(route({
id: "fixture-create-5", expectedRevision: null,
	name: "Conflicting FAQ page",
	scope: "pages:faq",
	json: JSON.stringify({
		"@context": "https://schema.org",
		"@type": "WebPage",
		"@id": "https://example.com/faq#webpage",
		name: "Conflicting FAQ",
	}),
	enabled: true,
}), harness.context);
check("overlapping schema scopes cannot redefine an entity", overlappingIdentity.success === false && Boolean(overlappingIdentity.errors.json));
check("cross-schema identity conflicts perform no writes", harness.schemaPutCount === 0);

const created = await handler("save-admin-custom-schema")(route({
id: "fixture-create-6", expectedRevision: null,
	name: "  FAQ graph  ",
	scope: "pages:faq",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] }),
	enabled: true,
}), harness.context);
check("valid custom schema is stored", created.success === true && harness.schemaPutCount === 1);
check("custom schema storage version is explicit", created.schema.storageVersion === SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION);
check("custom schema name is normalized", created.schema.name === "FAQ graph");
check("custom schema type preview is returned", created.schema.types.includes("FAQPage"));
const createdAt = created.schema.createdAt;

const updated = await handler("save-admin-custom-schema")(route({
	id: created.schema.id,
	expectedRevision: created.schema.revision,
	name: "FAQ graph",
	scope: "pages:faq",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": ["FAQPage", "WebPage"] }),
	enabled: false,
}), harness.context);
check("custom schema can be updated", updated.success === true && harness.schemaPutCount === 2);
check("custom schema update preserves creation time", updated.schema.createdAt === createdAt);
check("custom schema update refreshes detected types", updated.schema.types.includes("WebPage"));

const missingDelete = await handler("delete-admin-custom-schema")(route({ id: "missing", expectedRevision: "missing-review" }), harness.context);
check("missing custom schemas are not silently deleted", missingDelete.success === false && missingDelete.error === "not_found");
check("missing delete does not touch storage", harness.schemaDeleteCount === 0);
const deleted = await handler("delete-admin-custom-schema")(route({ id: created.schema.id, expectedRevision: updated.schema.revision }), harness.context);
check("existing custom schema can be deleted", deleted.success === true && harness.schemaDeleteCount === 1);

const reread = await handler("admin-configuration")(route(), harness.context);
check("schema module snapshot round-trips", reread.modules.items.find((item: any) => item.key === "schema")?.enabled === false);
check("Image SEO module state round-trips", reread.modules.items.find((item: any) => item.key === "imageSeo")?.enabled === false);
check("preset snapshot round-trips", reread.schema.presets.items.find((item: any) => item.key === "organization")?.enabled === true);
check("deleted custom schema is absent", !reread.schema.customSchemas.some((item: any) => item.id === created.schema.id));

const resetModules = await handler("reset-admin-modules")(route({ expectedRevision: (await handler("admin-configuration")(route(), harness.context)).modules.revision }), harness.context);
check("module snapshots can be restored to inherited values", resetModules.success === true);
check("restoring modules removes the versioned snapshot", !harness.values.has(`configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`));
check("restored modules mask the legacy analyzer value", resetModules.modules.items.find((item: any) => item.key === "seoAnalyzer")?.enabled === false);
check("restored modules have no stored revision", resetModules.modules.updatedAt === null);

const resetPresets = await handler("reset-admin-schema-presets")(route({ expectedRevision: savedPresets.presets.revision }), harness.context);
check("preset snapshots can be restored to inherited values", resetPresets.success === true);
check("restoring presets removes the versioned snapshot", !harness.values.has(`configuration:schema-presets:v${SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION}`));
check("restored presets expose the v1 organization value", resetPresets.presets.items.find((item: any) => item.key === "organization")?.enabled === false);
check("restored presets request migration", resetPresets.presets.migrationNeeded === true);
check("restored presets retain the v1 revision", resetPresets.presets.updatedAt === "2026-07-10T10:00:00.000Z");

const capacityHarness = createContext();
for (let index = capacityHarness.schemas.size; index < 500; index += 1) {
	capacityHarness.schemas.set(`capacity-${index.toString().padStart(3, "0")}`, {
		storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		name: `Capacity ${index}`,
		scope: "global",
		json: JSON.stringify({
			"@context": "https://schema.org",
			"@type": "Thing",
			name: `Thing ${index}`,
		}),
		enabled: false,
		createdAt: "2026-07-02T10:00:00.000Z",
		updatedAt: "2026-07-02T10:00:00.000Z",
	});
}
const overCapacityCreate = await handler("save-admin-custom-schema")(
	route({
id: "fixture-create-7", expectedRevision: null,
		name: "Record 501",
		scope: "global",
		json: JSON.stringify({
			"@context": "https://schema.org",
			"@type": "Thing",
			name: "Record 501",
		}),
		enabled: false,
	}),
	capacityHarness.context,
);
check(
	"custom schema creation stops visibly at the 500-record product cap",
	overCapacityCreate.success === false &&
		Boolean(overCapacityCreate.errors._form?.includes("limited to 500")) &&
		capacityHarness.schemas.size === 500 &&
		capacityHarness.schemaPutCount === 0,
);

const ambiguousCreateHarness = createContext();
ambiguousCreateHarness.rejectNextSchemaPutAfterCommit();
const ambiguousCreate = await handler("save-admin-custom-schema")(
	route({
id: "fixture-create-8", expectedRevision: null,
		name: "Ambiguous committed create",
		scope: "global",
		json: JSON.stringify({
			"@context": "https://schema.org",
			"@type": "Thing",
			name: "Committed",
		}),
		enabled: false,
	}),
	ambiguousCreateHarness.context,
);
check(
	"a committed-then-rejected schema create remains unconfirmed",
	ambiguousCreate.success === false && ambiguousCreate.error === "unconfirmed" && ambiguousCreateHarness.schemas.size === 3,
);

const unverifiableCapacityHarness = createContext();
unverifiableCapacityHarness.failSchemaCountAfter(2);
const unverifiableCapacityCreate = await handler("save-admin-custom-schema")(
	route({
id: "fixture-create-9", expectedRevision: null,
		name: "Unverifiable capacity create",
		scope: "global",
		json: JSON.stringify({
			"@context": "https://schema.org",
			"@type": "Thing",
			name: "Unverifiable",
		}),
		enabled: false,
	}),
	unverifiableCapacityHarness.context,
);
check(
	"an unverifiable post-create count rolls back only the exact new schema",
	unverifiableCapacityCreate.success === false &&
		Boolean(
			unverifiableCapacityCreate.errors._form?.includes(
				"could not be verified",
			),
		) &&
		unverifiableCapacityHarness.schemas.size === 2 &&
		unverifiableCapacityHarness.schemaDeleteCount === 1,
);

const racingCapacityHarness = createContext();
for (let index = racingCapacityHarness.schemas.size; index < 499; index += 1) {
	racingCapacityHarness.schemas.set(
		`race-capacity-${index.toString().padStart(3, "0")}`,
		{
			storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
			name: `Race capacity ${index}`,
			scope: "global",
			json: JSON.stringify({
				"@context": "https://schema.org",
				"@type": "Thing",
				name: `Thing ${index}`,
			}),
			enabled: false,
			createdAt: "2026-07-02T10:00:00.000Z",
			updatedAt: "2026-07-02T10:00:00.000Z",
		},
	);
}
const concurrentCapacityRecord = {
	storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	name: "Concurrent capacity winner",
	scope: "global",
	json: JSON.stringify({
		"@context": "https://schema.org",
		"@type": "Thing",
		name: "Winner",
	}),
	enabled: false,
	createdAt: "2026-07-02T10:00:00.000Z",
	updatedAt: "2026-07-02T10:00:00.000Z",
};
racingCapacityHarness.injectSchemaOnCountAfter(
	2,
	"concurrent-capacity-winner",
	concurrentCapacityRecord,
);
const racingCapacityCreate = await handler("save-admin-custom-schema")(
	route({
id: "fixture-create-10", expectedRevision: null,
		name: "Racing create",
		scope: "global",
		json: JSON.stringify({
			"@context": "https://schema.org",
			"@type": "Thing",
			name: "Racing",
		}),
		enabled: false,
	}),
	racingCapacityHarness.context,
);
check(
	"a racing 501st create removes only its own exact snapshot and preserves the concurrent winner",
	racingCapacityCreate.success === false &&
		racingCapacityHarness.schemas.size === 500 &&
		racingCapacityHarness.schemas.has("concurrent-capacity-winner") &&
		![...racingCapacityHarness.schemas.values()].some(
			(schema: any) => schema?.name === "Racing create",
		) &&
		racingCapacityHarness.schemaDeleteCount === 1,
);

const revisionHarness = createContext();
const revisionInput = {
	id: "revision-proof", expectedRevision: null, name: "Revision proof", scope: "global",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", name: "Proof" }), enabled: false,
};
const revisionCreated = await handler("save-admin-custom-schema")(route(revisionInput), revisionHarness.context);
const exactRead = await handler("admin-custom-schema")(route({ id: revisionInput.id }), revisionHarness.context);
check("an exact edit read binds its stored revision", exactRead.state === "saved" && exactRead.schema.revision === revisionCreated.schema.revision);
const revisionEdited = await handler("save-admin-custom-schema")(route({ ...revisionInput, expectedRevision: exactRead.schema.revision, name: "Newer revision" }), revisionHarness.context);
check("a confirmed edit returns a different revision", revisionEdited.success === true && revisionEdited.changed === true && revisionEdited.schema.revision !== exactRead.schema.revision);
const staleEdit = await handler("save-admin-custom-schema")(route({ ...revisionInput, expectedRevision: exactRead.schema.revision, name: "Stale edit" }), revisionHarness.context);
const staleDelete = await handler("delete-admin-custom-schema")(route({ id: revisionInput.id, expectedRevision: exactRead.schema.revision }), revisionHarness.context);
check("stale edits and deletes preserve the newer writer", staleEdit.error === "conflict" && staleDelete.error === "conflict" &&
	revisionHarness.schemas.get(revisionInput.id).name === "Newer revision" && revisionHarness.schemaPutCount === 2 && revisionHarness.schemaDeleteCount === 0);
const duplicateCreate = await handler("save-schema")(route(revisionInput), revisionHarness.context);
check("a repeated stable create conflicts through the legacy alias", duplicateCreate.error === "conflict" && revisionHarness.schemaPutCount === 2);
const aliasStaleDelete = await handler("delete-schema")(route({ id: revisionInput.id, expectedRevision: exactRead.schema.revision }), revisionHarness.context);
check("legacy deletion cannot bypass the reviewed revision", aliasStaleDelete.error === "conflict" && revisionHarness.schemaDeleteCount === 0);
revisionHarness.schemas.set("malformed-row", { unexpected: true });
const malformedRead = await handler("admin-custom-schema")(route({ id: "malformed-row" }), revisionHarness.context);
check("malformed storage is distinct from an absent record", malformedRead.success === true && malformedRead.state === "invalid" && typeof malformedRead.revision === "string");
const staleMalformedDelete = await handler("delete-admin-custom-schema")(route({ id: "malformed-row", expectedRevision: "stale-invalid-version" }), revisionHarness.context);
check("a stale malformed-record deletion preserves the stored value", staleMalformedDelete.error === "conflict" && revisionHarness.schemas.has("malformed-row"));
const malformedDelete = await handler("delete-admin-custom-schema")(route({ id: "malformed-row", expectedRevision: malformedRead.revision }), revisionHarness.context);
check("a reviewed malformed record can be deleted by its exact revision", malformedDelete.success === true && !revisionHarness.schemas.has("malformed-row"));
let oldClientReads = 0;
const oldClientContext = { ...revisionHarness.context, storage: { ...revisionHarness.context.storage, schemas: {
	...revisionHarness.context.storage.schemas,
	getVersioned: async () => { oldClientReads += 1; throw new Error("Old commands must not read a target"); },
} } };
const { expectedRevision: _omittedRevision, ...oldClientInput } = revisionInput;
const oldClient = await handler("save-admin-custom-schema")(route(oldClientInput), oldClientContext);
check("old clients missing a revision are rejected before target reads", oldClient.error === "invalid_input" && oldClientReads === 0);
const newerCapacityHarness = createContext();
const nativeStore = newerCapacityHarness.context.storage.schemas;
const countBefore = nativeStore.count;
let capacityRead = 0;
nativeStore.count = async () => {
	capacityRead += 1;
	if (capacityRead === 1) return 499;
	const committed = await nativeStore.getVersioned("capacity-equal-newer");
	if (!committed) throw new Error("The create must commit before capacity verification");
	await nativeStore.compareAndSet("capacity-equal-newer", committed.revision, committed.value);
	return 501;
};
const equalNewerCapacity = await handler("save-admin-custom-schema")(route({ ...revisionInput, id: "capacity-equal-newer" }), newerCapacityHarness.context);
nativeStore.count = countBefore;
check("capacity cleanup preserves an equal-value newer revision", equalNewerCapacity.error === "conflict" &&
	newerCapacityHarness.schemas.has("capacity-equal-newer") && newerCapacityHarness.schemaDeleteCount === 0);
const invalidPresetHarness = createContext();
const invalidPresetKey = `configuration:schema-presets:v${SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION}`;
invalidPresetHarness.values.set(invalidPresetKey, { unexpected: true });
const invalidPresetRead = await handler("admin-schema-presets")(route(), invalidPresetHarness.context);
const invalidPresetSave = await handler("save-admin-schema-presets")(route({ values: presets, expectedRevision: invalidPresetRead.revision }), invalidPresetHarness.context);
check("invalid preset snapshots retain their reviewed revision and require explicit repair", invalidPresetRead.record === "invalid" &&
	typeof invalidPresetRead.revision === "string" && invalidPresetSave.error === "invalid_record" && invalidPresetHarness.kvSetCount === 0);
const unavailablePresetContext = { ...invalidPresetHarness.context, kv: { ...invalidPresetHarness.context.kv, compareAndSet: undefined } };
const unavailablePreset = await handler("admin-schema-presets")(route(), unavailablePresetContext);
check("missing conditional storage is never writable or absent", unavailablePreset.record === "unavailable" && unavailablePreset.revision === null && unavailablePreset.writable === false);

const multibyteJson = JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", description: "\u754c".repeat(90_000) });
const multibyteCommand = { ...revisionInput, id: "multibyte-wire", json: multibyteJson };
const multibyteWireBytes = new TextEncoder().encode(JSON.stringify(multibyteCommand)).byteLength;
const rawSchemaRoute = (seoRuntime as any).routes["save-admin-custom-schema"];
const aliasSchemaRoute = (seoRuntime as any).routes["save-schema"];
const rawSchemaRequestCap = rawSchemaRoute.request.maxBytes as number;
check("the multibyte boundary is a valid schema below the character limit but above 256 KiB",
	multibyteJson.length < 100_000 && multibyteWireBytes > 262_144 && rawSchemaRoute.input.safeParse(multibyteCommand).success);
check("raw save and its alias share a finite wire limit that contains the multibyte command",
	Number.isSafeInteger(rawSchemaRequestCap) && rawSchemaRequestCap === aliasSchemaRoute.request.maxBytes &&
	rawSchemaRequestCap < 1_048_576 && multibyteWireBytes <= rawSchemaRequestCap);
const escapedWhitespaceJson = '{' + "\t".repeat(99_970) + '"@type":"Thing"}';
const escapedWhitespaceCommand = { ...revisionInput, id: "escaped-wire", json: escapedWhitespaceJson };
const escapedWhitespaceWireBytes = new TextEncoder().encode(JSON.stringify(escapedWhitespaceCommand)).byteLength;
check("valid heavily escaped JSON remains inside the bounded raw-save envelope",
	escapedWhitespaceJson.length <= 100_000 && JSON.parse(escapedWhitespaceJson)["@type"] === "Thing" &&
	rawSchemaRoute.input.safeParse(escapedWhitespaceCommand).success &&
	escapedWhitespaceWireBytes <= rawSchemaRequestCap);
check("the larger transport envelope does not enlarge the JSON character limit",
	!rawSchemaRoute.input.safeParse({ ...multibyteCommand, json: "x".repeat(100_001) }).success &&
	!aliasSchemaRoute.input.safeParse({ ...multibyteCommand, json: "x".repeat(100_001) }).success);
const multibyteHarness = createContext();
const multibyteSave = await handler("save-admin-custom-schema")(route(multibyteCommand), multibyteHarness.context);
check("the valid multibyte schema still passes domain validation",
	multibyteSave.success === true && multibyteSave.schema.json === multibyteJson);

const composerRoute = (seoRuntime as any).routes["compose-admin-schema"];
const largestRecipeCharacterBudget = Math.max(...SEO_SCHEMA_COMPOSER_RECIPES.map((recipe) =>
	seoSchemaComposerFields(recipe.key).reduce((sum, field) => sum + (field.multiline ? 20_000 : 2_048), 0)));
check("the composer wire limit covers every normalized recipe field budget",
	largestRecipeCharacterBudget === 92_288 && composerRoute.request.maxBytes >= largestRecipeCharacterBudget * 6 + 8_192);
const cjk = "\u754c";
const longLines = Array.from({ length: 40 }, () => cjk.repeat(499)).join("\n");
const urlPrefix = "https://example.com/";
const longUrl = urlPrefix + cjk.repeat(2_048 - urlPrefix.length);
const largeComposerCommand = {
	id: "large-composer-wire", expectedRevision: null, recipe: "howTo", schemaName: "Large guided schema", scope: "posts", enabled: false,
	values: {
		name: cjk.repeat(2_048), description: cjk.repeat(20_000), url: longUrl, image: longUrl,
		steps: longLines, tools: longLines, supplies: longLines,
		totalTime: "P" + "0".repeat(2_046) + "D", estimatedCost: "0".repeat(2_048), currency: "EUR",
	},
};
const largeComposed = composeSeoSchema(largeComposerCommand);
const composerWireBytes = new TextEncoder().encode(JSON.stringify(largeComposerCommand)).byteLength;
check("a valid normalized composer command can exceed the previous 256 KiB envelope",
	largeComposed.success && largeComposed.output.json.length < 100_000 && composerWireBytes > 262_144 &&
	composerWireBytes <= composerRoute.request.maxBytes && composerRoute.input.safeParse(largeComposerCommand).success);
const largeComposerHarness = createContext();
const largeComposerSave = await handler("compose-admin-schema")(route(largeComposerCommand), largeComposerHarness.context);
check("the multibyte composer boundary passes recipe and stored-schema validation", largeComposerSave.success === true);

const composerHarness = createContext();
const invalidComposition = await handler("compose-admin-schema")(route({
	id: "fixture-composer-1", expectedRevision: null,
	recipe: "howTo",
	schemaName: "Incomplete guide",
	scope: "posts",
	enabled: true,
	values: {
		name: "{{title}}",
		description: "{{description}}",
		url: "{{canonical}}",
		steps: "Only one step",
	},
}), composerHarness.context);
check("invalid guided schema is rejected", invalidComposition.success === false && Boolean(invalidComposition.errors.steps));
check("invalid guided schema performs no writes", composerHarness.schemaPutCount === 0);

const composed = await handler("compose-admin-schema")(route({
	id: "fixture-composer-2", expectedRevision: null,
	recipe: "howTo",
	schemaName: "Publishing guide",
	scope: "posts",
	enabled: true,
	values: {
		name: "{{title}}",
		description: "{{description}}",
		url: "{{canonical}}",
		image: "{{image}}",
		steps: "Plan | Confirm the outcome\nPublish | Complete and review the work",
		totalTime: "PT2H",
		tools: "Content editor",
		supplies: "Approved brief",
		estimatedCost: "",
		currency: "EUR",
	},
}), composerHarness.context);
check("valid guided schema is persisted", composed.success === true && composerHarness.schemaPutCount === 1);
check("guided schema returns its recipe", composed.success === true && composed.recipe === "howTo");
check("guided schema uses the custom-schema contract", composed.success === true && composed.schema.types.includes("HowTo"));
check("guided schema keeps page variables as data", composed.success === true && composed.json.includes("{{canonical}}#how-to"));

if (failures) {
	console.error(`\n${failures} SEO configuration self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nALL SEO CONFIGURATION CHECKS PASSED");
}
