import { SEO_PORTABILITY_CONFIRMATION, type SeoPortabilityBundle } from "./admin-contract.ts";
import seoRuntime from "./sandbox-entry.ts";
import { collectionAnalysisProfileKey } from "./collection-analysis-profile.ts";
import { MODULES_SETTINGS_KEY, SCHEMA_PRESETS_SETTINGS_KEY } from "./entry-analysis-runtime.ts";
import { INDEXNOW_SETTINGS_STORAGE_KEY } from "./indexnow-runtime.ts";
import { METADATA_TEMPLATES_KEY } from "./metadata-templates.ts";
import { GLOBAL_SETTINGS_KEY, readContentScoringPolicy } from "./settings-runtime.ts";
import { SITEMAP_SETTINGS_KEY } from "./sitemap-runtime.ts";

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`  PASS  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
	}
}

const STORED_SETTINGS = {
	version: 1,
	updatedAt: "2026-10-18T14:48:16.974Z",
	customVerificationTags: [{ name: "example-site-verification", content: "examplecode123" }],
	taxonomyArchiveNoindex: ["category", "tag"],
	contentTypeNoindex: ["pages"],
	siteName: "Example site",
	siteUrl: "https://site.example",
	publisherType: "organization",
	organizationName: "Example site",
	organizationLogo: "",
	personName: "",
	socialProfiles: [],
	personProfiles: [],
	defaultSocialImage: "",
	twitterHandle: "@example",
	noindex: false,
	contentScoringEnabled: false,
	indexingPreferenceConfirmed: true,
};
// Every successful import withdraws this acknowledgement, as its preview states.
const ACKNOWLEDGED_SETTINGS = { ...STORED_SETTINGS, contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1 };
const { contentScoringResourceNoticeVersion: _withdrawn, ...WITHDRAWN_SETTINGS } = ACKNOWLEDGED_SETTINGS;
// Only pages has a stored template; posts inherits the defaults.
const STORED_TEMPLATES = {
	version: 1,
	updatedAt: "2026-10-18T11:03:36.717Z",
	fallbackScoreRevision: null,
	values: {
		pages: {
			title: "{{title}} | {{siteName}}",
			description: "{{description}}",
			socialTitle: "{{title}} | {{siteName}}",
			socialDescription: "{{description}}",
		},
	},
	collectionUpdatedAt: { pages: "2026-10-18T11:03:36.717Z" },
};
const STORED_INDEXNOW = {
	version: 1,
	updatedAt: "2026-10-18T14:48:16.974Z",
	values: {
		enabled: false,
		autoSubmit: false,
		autoSubmitContentTypes: ["pages", "posts"],
		apiKey: "0123456789abcdef0123456789abcdef",
		keyLocation: "/indexnow-key.txt",
		batchSize: 100,
		minIntervalSeconds: 300,
		maxAttempts: 5,
	},
};
const STORED_SCHEMA_ID = "appointment-steps";
const STORED_SCHEMA = {
	storageVersion: 1,
	name: "Appointment steps",
	scope: "pages",
	json: JSON.stringify({
		"@context": "https://schema.org",
		"@type": "HowTo",
		"@id": "{{canonical}}#how-to",
		name: "{{title}}",
		step: [{ "@type": "HowToStep", position: 1, name: "Call", text: "Phone to book a time" }],
	}),
	enabled: true,
	createdAt: "2026-10-18T11:06:40.018Z",
	updatedAt: "2026-10-18T11:06:40.018Z",
};
const PROFILE_KEY = collectionAnalysisProfileKey("posts");

function createHarness() {
	const kv = new Map<string, unknown>();
	const kvRevisions = new Map<string, string>();
	const schemas = new Map<string, unknown>();
	const schemaRevisions = new Map<string, string>();
	const leases = new Map<string, unknown>();
	/** Every storage mutation, in order. */
	const writes: string[] = [];
	let counter = 0;
	const seedKv = (key: string, value: unknown) => {
		kv.set(key, structuredClone(value));
		kvRevisions.set(key, `k${++counter}`);
	};
	const seedSchema = (id: string, value: unknown) => {
		schemas.set(id, structuredClone(value));
		schemaRevisions.set(id, `s${++counter}`);
		return schemaRevisions.get(id)!;
	};
	const kvRevision = (key: string) => kv.has(key) ? kvRevisions.get(key)! : null;
	const schemaRevision = (id: string) => schemas.has(id) ? schemaRevisions.get(id)! : null;
	const kvApi = {
		get: async (key: string) => structuredClone(kv.get(key) ?? null),
		set: async (key: string, value: unknown) => {
			writes.push(`kv:${key}`);
			seedKv(key, value);
		},
		delete: async (key: string) => {
			writes.push(`kv-delete:${key}`);
			kvRevisions.delete(key);
			return kv.delete(key);
		},
		list: async (prefix = "") => [...kv.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([key, value]) => ({ key, value: structuredClone(value) })),
		getVersioned: async (key: string) => kv.has(key) ? { value: structuredClone(kv.get(key)), revision: kvRevision(key)! } : null,
		compareAndSet: async (key: string, expected: string | null, value: unknown) => {
			if (kvRevision(key) !== expected) return { applied: false };
			writes.push(`kv:${key}`);
			seedKv(key, value);
			return { applied: true, revision: kvRevision(key) };
		},
		compareAndDelete: async (key: string, expected: string) => {
			if (kvRevision(key) !== expected) return { applied: false };
			writes.push(`kv-delete:${key}`);
			kv.delete(key);
			kvRevisions.delete(key);
			return { applied: true };
		},
	};
	const schemaApi = {
		get: async (id: string) => structuredClone(schemas.get(id) ?? null),
		count: async () => schemas.size,
		put: async (id: string, value: unknown) => {
			writes.push(`schema:${id}`);
			return seedSchema(id, value);
		},
		delete: async (id: string) => {
			writes.push(`schema-delete:${id}`);
			schemaRevisions.delete(id);
			return schemas.delete(id);
		},
		getVersioned: async (id: string) => schemas.has(id) ? { value: structuredClone(schemas.get(id)), revision: schemaRevision(id)! } : null,
		compareAndSet: async (id: string, expected: string | null, value: unknown) => {
			if (schemaRevision(id) !== expected) return { applied: false };
			writes.push(`schema:${id}`);
			return { applied: true, revision: seedSchema(id, value) };
		},
		compareAndDelete: async (id: string, expected: string) => {
			if (schemaRevision(id) !== expected) return { applied: false };
			writes.push(`schema-delete:${id}`);
			schemas.delete(id);
			schemaRevisions.delete(id);
			return { applied: true };
		},
		query: async ({ limit = 50, cursor }: { limit?: number; cursor?: string } = {}) => {
			const start = Number.parseInt(cursor ?? "0", 10) || 0;
			const pageLimit = Math.min(limit, 100);
			const entries = [...schemas.entries()];
			const hasMore = start + pageLimit < entries.length;
			return {
				items: entries.slice(start, start + pageLimit).map(([id, data]) => ({ id, data: structuredClone(data) })),
				hasMore,
				cursor: hasMore ? String(start + pageLimit) : undefined,
			};
		},
	};
	const operationLeases = {
		get: async (id: string) => structuredClone(leases.get(id) ?? null),
		put: async (id: string, value: unknown) => {
			writes.push(`lease:${id}`);
			leases.set(id, structuredClone(value));
		},
		delete: async (id: string) => {
			writes.push(`lease-delete:${id}`);
			return leases.delete(id);
		},
		compareAndSet: async (id: string, expected: any, next: any) => {
			const present = leases.has(id);
			if (expected.state === "missing" ? present : !present) return false;
			if (expected.state === "value" && JSON.stringify(leases.get(id)) !== JSON.stringify(expected.value)) return false;
			writes.push(`lease:${id}`);
			if (next.action === "delete") return leases.delete(id);
			leases.set(id, structuredClone(next.value));
			return true;
		},
		query: async () => ({ items: [], hasMore: false, cursor: undefined }),
	};
	return {
		context: {
			plugin: { id: "shipit-seo", version: "test" },
			settings: {
				get: async () => null,
				getVersioned: async () => null,
				compareAndSet: async () => ({ applied: false }),
				compareAndDelete: async () => ({ applied: false }),
			},
			schema: {
				listCollections: async () => [
					{ slug: "posts", label: "Posts", hasSeo: true, urlPattern: "/posts/{slug}", routable: true, hidden: false },
					{ slug: "pages", label: "Pages", hasSeo: true, urlPattern: "/{slug}", routable: true, hidden: false },
				],
			},
			kv: kvApi,
			storage: { operationLeases, schemas: schemaApi },
			log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
		},
		kv,
		schemas,
		writes,
		seedKv,
		seedSchema,
		/** Stored values only: an unchanged section keeps its record, or its absence, byte for byte. */
		stored() {
			const sorted = (map: Map<string, unknown>) => [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
			return JSON.stringify({ kv: sorted(kv), schemas: sorted(schemas) });
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
			url: "https://site.example/_emdash/api/plugins/shipit-seo/portability",
			method: "POST",
			headers: {},
		},
	};
}

async function seededHarness(settings: Record<string, unknown>) {
	const harness = createHarness();
	await (seoRuntime as any).hooks["plugin:install"].handler({}, harness.context);
	// The sitemap, module and schema preset records stay absent, so they read as defaults.
	harness.seedKv(GLOBAL_SETTINGS_KEY, settings);
	harness.seedKv(METADATA_TEMPLATES_KEY, STORED_TEMPLATES);
	harness.seedKv(INDEXNOW_SETTINGS_STORAGE_KEY, STORED_INDEXNOW);
	harness.seedKv(PROFILE_KEY, { version: 1, profile: "article", updatedAt: "2026-10-18T11:00:00.000Z" });
	harness.seedSchema(STORED_SCHEMA_ID, STORED_SCHEMA);
	return harness;
}

/** Exports, optionally edits the bundle or the stored state, then previews and applies through the routes. */
async function importExport(
	mode: "merge" | "replace",
	editBundle: (bundle: SeoPortabilityBundle) => void = () => undefined,
	editStored: (harness: ReturnType<typeof createHarness>) => void = () => undefined,
	settings: Record<string, unknown> = STORED_SETTINGS,
) {
	const harness = await seededHarness(settings);
	const exported = await handler("admin-portability-export")(route(), harness.context);
	const bundle = JSON.parse(JSON.stringify(exported.bundle)) as SeoPortabilityBundle;
	editBundle(bundle);
	editStored(harness);
	const preview = await handler("admin-portability-preview")(route({ bundle, mode }), harness.context);
	const before = harness.stored();
	harness.writes.length = 0;
	const applied = await handler("admin-portability-apply")(route({
		bundle,
		mode,
		confirmation: SEO_PORTABILITY_CONFIRMATION,
		planFingerprint: preview.plan?.fingerprint,
	}), harness.context);
	const changedSections = preview.success
		? preview.plan.sections.filter((section: any) => section.changed).map((section: any) => section.key)
		: null;
	return { harness, preview, applied, before, changedSections, writes: [...harness.writes] };
}

function storedSettings(harness: ReturnType<typeof createHarness>) {
	return harness.kv.get(GLOBAL_SETTINGS_KEY) as Record<string, unknown>;
}

function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
		? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
		: item);
}

function warnsAboutAcknowledgement(preview: any): boolean {
	return preview.success === true && preview.plan.warnings.some((warning: string) => warning.includes("resource-use acknowledgement"));
}

for (const mode of ["merge", "replace"] as const) {
	const same = await importExport(mode);
	check(`${mode}: the preview of an export of the same state reports no change`,
		same.preview.success === true && same.changedSections?.length === 0, same.changedSections);
	check(`${mode}: the preview still states that the import does not transfer the acknowledgement`,
		warnsAboutAcknowledgement(same.preview), same.preview.plan?.warnings);
	check(`${mode}: the import of an export of the same state succeeds`, same.applied.success === true, same.applied);
	check(`${mode}: without a stored acknowledgement, the import of the same state performs no storage write`,
		same.writes.length === 0, same.writes);
	check(`${mode}: every stored record and every absent record is left as it was`, same.harness.stored() === same.before);
	const settings = await handler("admin-settings")(route(), same.harness.context);
	check(`${mode}: the indexing preference stays confirmed`,
		settings.indexingPreferenceConfirmed === true && storedSettings(same.harness).indexingPreferenceConfirmed === true);

	const acknowledged = await importExport(mode, undefined, undefined, ACKNOWLEDGED_SETTINGS);
	check(`${mode}: with a stored acknowledgement, the preview of the same state reports no change`,
		acknowledged.preview.success === true && acknowledged.changedSections?.length === 0, acknowledged.changedSections);
	check(`${mode}: with a stored acknowledgement, the import of the same state writes only the settings record`,
		acknowledged.applied.success === true &&
			JSON.stringify(acknowledged.writes) === JSON.stringify([`kv:${GLOBAL_SETTINGS_KEY}`]), acknowledged.writes);
	check(`${mode}: that write removes only the acknowledgement and keeps the indexing confirmation`,
		stableJson(storedSettings(acknowledged.harness)) === stableJson(WITHDRAWN_SETTINGS), storedSettings(acknowledged.harness));
	check(`${mode}: analysis then waits for a fresh local acknowledgement`,
		(await readContentScoringPolicy(acknowledged.harness.context as any)).state === "pending-confirmation");
}

// The owner changed one rule after the export; importing the export restores only that rule.
const restored = await importExport("merge", () => undefined, (harness) => {
	harness.seedKv(GLOBAL_SETTINGS_KEY, { ...ACKNOWLEDGED_SETTINGS, taxonomyArchiveNoindex: ["tag"], updatedAt: "2026-10-20T07:30:00.000Z" });
}, ACKNOWLEDGED_SETTINGS);
check("restoring one rule: the preview reports only the settings as changed",
	JSON.stringify(restored.changedSections) === JSON.stringify(["settings"]), restored.changedSections);
check("restoring one rule: the import succeeds", restored.applied.success === true, restored.applied);
check("restoring one rule: only the settings record is written, once",
	JSON.stringify(restored.writes) === JSON.stringify([`kv:${GLOBAL_SETTINGS_KEY}`]), restored.writes);
check("restoring one rule: the rule is restored",
	JSON.stringify(storedSettings(restored.harness).taxonomyArchiveNoindex) === JSON.stringify(["category", "tag"]));
check("restoring one rule: the settings write keeps the indexing confirmation and withdraws the acknowledgement",
	storedSettings(restored.harness).indexingPreferenceConfirmed === true &&
	!Object.hasOwn(storedSettings(restored.harness), "contentScoringResourceNoticeVersion"));
check("restoring one rule: absent sitemap, module and preset records stay absent",
	[SITEMAP_SETTINGS_KEY, MODULES_SETTINGS_KEY, SCHEMA_PRESETS_SETTINGS_KEY].every((key) => !restored.harness.kv.has(key)));
check("restoring one rule: the inherited posts template stays inherited",
	JSON.stringify(restored.harness.kv.get(METADATA_TEMPLATES_KEY)) === JSON.stringify(STORED_TEMPLATES));
check("restoring one rule: the IndexNow record and the custom schema are left as they were",
	JSON.stringify(restored.harness.kv.get(INDEXNOW_SETTINGS_STORAGE_KEY)) === JSON.stringify(STORED_INDEXNOW) &&
	JSON.stringify(restored.harness.schemas.get(STORED_SCHEMA_ID)) === JSON.stringify(STORED_SCHEMA));

const resumed = await importExport("merge", (bundle) => {
	bundle.configuration.settings.contentScoringEnabled = true;
});
check("turning analysis on: the preview states that the acknowledgement is not transferred",
	warnsAboutAcknowledgement(resumed.preview), resumed.preview.plan?.warnings);
check("turning analysis on: only the settings record is written",
	resumed.applied.success === true && JSON.stringify(resumed.writes) === JSON.stringify([`kv:${GLOBAL_SETTINGS_KEY}`]), resumed.writes);
check("turning analysis on: no acknowledgement is stored and the indexing confirmation is kept",
	!Object.hasOwn(storedSettings(resumed.harness), "contentScoringResourceNoticeVersion") &&
	storedSettings(resumed.harness).indexingPreferenceConfirmed === true);
check("turning analysis on: analysis waits for a local acknowledgement",
	(await readContentScoringPolicy(resumed.harness.context as any)).state === "pending-confirmation");

const pagesTemplate = await importExport("merge", (bundle) => {
	bundle.configuration.templates.pages.title = "{{title}} | Imported";
});
const writtenTemplates = pagesTemplate.harness.kv.get(METADATA_TEMPLATES_KEY) as typeof STORED_TEMPLATES;
check("changing the stored template: only the template record is written",
	pagesTemplate.applied.success === true && JSON.stringify(pagesTemplate.writes) === JSON.stringify([`kv:${METADATA_TEMPLATES_KEY}`]),
	pagesTemplate.writes);
check("changing the stored template: the inherited posts template is not stored",
	JSON.stringify(Object.keys(writtenTemplates.values)) === JSON.stringify(["pages"]) &&
	writtenTemplates.values.pages.title === "{{title}} | Imported");

const acknowledgedTemplate = await importExport("merge", (bundle) => {
	bundle.configuration.templates.pages.title = "{{title}} | Imported";
}, () => undefined, ACKNOWLEDGED_SETTINGS);
check("changing the stored template with a stored acknowledgement: only the acknowledgement and the template are written",
	acknowledgedTemplate.applied.success === true &&
		JSON.stringify(acknowledgedTemplate.writes) === JSON.stringify([`kv:${GLOBAL_SETTINGS_KEY}`, `kv:${METADATA_TEMPLATES_KEY}`]),
	acknowledgedTemplate.writes);
check("changing the stored template with a stored acknowledgement: the settings lose only the acknowledgement",
	stableJson(storedSettings(acknowledgedTemplate.harness)) === stableJson(WITHDRAWN_SETTINGS));

const editedSchema = await importExport("merge", (bundle) => {
	bundle.configuration.customSchemas[0].name = "Appointment steps (imported)";
});
const writtenSchema = editedSchema.harness.schemas.get(STORED_SCHEMA_ID) as typeof STORED_SCHEMA;
check("editing the custom schema: only that schema is written",
	editedSchema.applied.success === true && JSON.stringify(editedSchema.writes) === JSON.stringify([`schema:${STORED_SCHEMA_ID}`]),
	editedSchema.writes);
check("editing the custom schema: it keeps its creation time",
	writtenSchema.name === "Appointment steps (imported)" && writtenSchema.createdAt === STORED_SCHEMA.createdAt);

const droppedSchema = await importExport("replace", (bundle) => {
	bundle.configuration.customSchemas = [];
});
check("replace without the custom schema: only its deletion is written",
	droppedSchema.applied.success === true &&
		JSON.stringify(droppedSchema.writes) === JSON.stringify([`schema-delete:${STORED_SCHEMA_ID}`]), droppedSchema.writes);

const indexNowPolicy = await importExport("merge", (bundle) => {
	bundle.configuration.indexNow.minIntervalSeconds += 60;
});
check("changing the IndexNow policy: only the IndexNow record is written, under its lease",
	indexNowPolicy.applied.success === true &&
		JSON.stringify(indexNowPolicy.writes.filter((write) => !write.startsWith("lease"))) ===
			JSON.stringify([`kv:${INDEXNOW_SETTINGS_STORAGE_KEY}`]), indexNowPolicy.writes);
check("changing the IndexNow policy: the local key is kept",
	(indexNowPolicy.harness.kv.get(INDEXNOW_SETTINGS_STORAGE_KEY) as typeof STORED_INDEXNOW).values.apiKey === STORED_INDEXNOW.values.apiKey &&
	(indexNowPolicy.harness.kv.get(INDEXNOW_SETTINGS_STORAGE_KEY) as typeof STORED_INDEXNOW).values.minIntervalSeconds === 360);

if (failures) {
	console.error(`\n${failures} SEO portability apply self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nAll SEO portability apply self-checks passed.");
}
