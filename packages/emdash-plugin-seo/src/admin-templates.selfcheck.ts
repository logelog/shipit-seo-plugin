import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH,
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_MODULES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	SEO_SCORE_VERSION,
	defaultSeoAdminTemplateSet,
} from "./admin-contract.ts";
import seoRuntime from "./sandbox-entry.ts";
import { analyzeSeoContent, summarizeSeoChecks } from "./analysis.ts";
import { parseSeoAdminTemplateConfiguration } from "./admin-ui/contract.ts";
import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import { GLOBAL_SETTINGS_KEY } from "./settings-runtime.ts";
import { collectionAnalysisProfileKey } from "./collection-analysis-profile.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

const values = new Map<string, unknown>([
	["settings:siteName", "Example Studio"],
	["settings:siteUrl", "https://example.com"],
	["settings:noindex", false],
	[
		"settings:sameAs",
		["https://social.example/example-studio", "https://directory.example/example-studio"],
		],
	["tpl:posts:title", "{{title}} | Legacy"],
	["tpl:posts:description", "{{description}}"],
]);
const settingsReads = new Map<string, number>();
// Every write gives the key a new revision, as on the published hosts.
const harnessRevisions = new Map<string, number>();
const harnessRevision = (key: string) => values.has(key) ? `r${harnessRevisions.get(key) ?? 0}` : null;
const bumpHarnessRevision = (key: string) => harnessRevisions.set(key, (harnessRevisions.get(key) ?? 0) + 1);
let kvWrites = 0;
let scoreWrites = 0;
let scoreReadFailure: Error | null = null;
let scoreDeletes = 0;
let scoreCacheWarnings = 0;
const scores = new Map<string, unknown>();
const scoreAnalysisRevisions = new Map<string, unknown>();
let analysisProfileWrites = 0;
let analysisProfileDeletes = 0;
const analysisProfiles = new Map<string, unknown>();
const socialOverrides = new Map<string, unknown>();
const socialRevisions = new Map<string, string>();
let socialRevisionSequence = 0;
const socialCounts = { read: 0, versioned: 0, conditional: 0, unguarded: 0 };
const socialRevision = (id: string) => socialOverrides.has(id) ? socialRevisions.get(id) ?? "seeded" : null;
const socialWrite = (id: string, value: unknown) => {
	socialOverrides.set(id, structuredClone(value));
	const revision = `social-${++socialRevisionSequence}`;
	socialRevisions.set(id, revision);
	return revision;
};
const legacyOverrides = new Map<string, unknown>();
const customSchemas = new Map<string, unknown>();
const schemaQueries: Array<{ where: unknown; limit: number }> = [];
let scoreRefreshPagingFixture = false;
let scoreRefreshOversizeFixture = false;
let scoreRefreshRepeatedCursorFixture = false;
let contentOptionsEmptyPageFixture = false;
let contentReads = 0;
const scoreRefreshListCalls: Array<{
	collection: string;
	limit: number | undefined;
	cursor: string | undefined;
	where: { status?: string; locale?: string } | undefined;
}> = [];

function seedPagedCustomSchemas(firstPageScope = "global"): void {
	customSchemas.clear();
	for (let index = 0; index < 100; index += 1) {
		customSchemas.set(`page-one-${index.toString().padStart(3, "0")}`, {
			storageVersion: 1,
			name: `Disabled page-one schema ${index}`,
			scope: firstPageScope,
			json: JSON.stringify({
				"@context": "https://schema.org",
				"@type": "Thing",
				name: `Thing ${index}`,
			}),
			enabled: false,
			createdAt: "2026-07-18T09:00:00.000Z",
			updatedAt: "2026-07-18T09:00:00.000Z",
		});
	}
	customSchemas.set("page-two-product", {
		storageVersion: 1,
		name: "Page-two product",
		scope: "posts",
		json: JSON.stringify({
			"@context": "https://schema.org",
			"@type": "Product",
			"@id": "{{canonical}}#page-two-product",
			name: "{{title}}",
		}),
		enabled: true,
		createdAt: "2026-07-18T10:00:00.000Z",
		updatedAt: "2026-07-18T10:00:00.000Z",
	});
}

const contentItems = new Map<string, any>([
	[
		"posts:post-1",
		{
		id: "post-1",
		slug: "useful-post",
		data: {
			title: "A useful post",
				excerpt:
					"A useful description for readers and search engines that explains the subject clearly.",
			content: "Useful content with enough detail for the analyzer.",
			featured_image: { id: "hero-1", src: "/uploads/hero-1.jpg", mimeType: "image/jpeg" },
		},
		seo: null,
		createdAt: "2026-07-14T09:00:00.000Z",
		updatedAt: "2026-07-14T10:00:00.000Z",
		publishedAt: "2026-07-14T10:00:00.000Z",
		},
	],
	[
		"posts:post-2",
		{
		id: "post-2",
		slug: "custom-post",
		data: {
			title: "Content title",
			excerpt: "Content description.",
			content: "Content body.",
			focus_keyword: "content fallback",
		},
		seo: {
			title: "Entry SEO title",
			description: "Entry SEO description",
			canonical: "https://example.com/custom-canonical",
			image: "https://example.com/custom-image.jpg",
			noIndex: false,
		},
		createdAt: "2026-07-14T09:00:00.000Z",
		updatedAt: "2026-07-14T10:00:00.000Z",
		publishedAt: "2026-07-14T10:00:00.000Z",
		},
	],
	[
		"salons:salon-1",
		{
			id: "salon-1",
			slug: "glow-studio",
			data: {
				title: "Old title",
				headline: "Glow Studio",
				excerpt: "A local salon in Amsterdam.",
				content: "Treatments and practical visitor information.",
			},
			seo: null,
			createdAt: "2026-07-14T09:00:00.000Z",
			updatedAt: "2026-07-14T10:00:00.000Z",
			publishedAt: "2026-07-14T10:00:00.000Z",
		},
	],
]);

const context = {
	plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
	site: { name: "Example Studio", url: "https://example.com", locale: "en" },
	// Current hosts expose versioned plugin settings; no business identity is stored here.
	settings: {
		get: async () => null,
		getVersioned: async () => null,
		compareAndSet: async () => ({ applied: false }),
		compareAndDelete: async () => ({ applied: false }),
	},
	kv: {
		get: async (key: string) => {
			if (key.startsWith("settings:")) settingsReads.set(key, (settingsReads.get(key) ?? 0) + 1);
			return structuredClone(values.get(key) ?? null);
		},
		getVersioned: async (key: string) => {
			if (key.startsWith("settings:")) settingsReads.set(key, (settingsReads.get(key) ?? 0) + 1);
			const revision = harnessRevision(key);
			return revision === null ? null : { value: structuredClone(values.get(key)), revision };
		},
		compareAndSet: async (key: string, expected: string | null, value: unknown) => {
			if (harnessRevision(key) !== expected) return { applied: false };
			kvWrites += 1;
			values.set(key, structuredClone(value));
			bumpHarnessRevision(key);
			return { applied: true, revision: harnessRevision(key) };
		},
		compareAndDelete: async (key: string, expected: string) => {
			if (harnessRevision(key) !== expected) return { applied: false };
			values.delete(key);
			harnessRevisions.delete(key);
			return { applied: true };
		},
		set: async (key: string, value: unknown) => {
			kvWrites += 1;
			values.set(key, structuredClone(value));
			bumpHarnessRevision(key);
		},
		delete: async (key: string) => values.delete(key),
		list: async () => [],
	},
	storage: {
		socialOverrides: {
			get: async (id: string) => {
				socialCounts.read++;
				return structuredClone(socialOverrides.get(id) ?? null);
			},
			getVersioned: async (id: string) => {
				socialCounts.versioned++;
				return socialOverrides.has(id)
					? { value: structuredClone(socialOverrides.get(id)), revision: socialRevision(id) }
					: null;
			},
			compareAndSet: async (id: string, expected: string | null, value: unknown) => {
				socialCounts.conditional++;
				if (socialRevision(id) !== expected) return { applied: false };
				return { applied: true, revision: socialWrite(id, value) };
			},
			compareAndDelete: async (id: string, expected: string) => {
				socialCounts.conditional++;
				if (socialRevision(id) !== expected) return { applied: false };
				socialOverrides.delete(id);
				return { applied: true };
			},
			put: async (id: string, value: unknown) => { socialCounts.unguarded++; socialWrite(id, value); },
			delete: async (id: string) => socialOverrides.delete(id),
		},
		analysisProfiles: {
			get: async (id: string) => structuredClone(analysisProfiles.get(id) ?? null),
			put: async (id: string, value: unknown) => {
				analysisProfileWrites += 1;
				analysisProfiles.set(id, structuredClone(value));
			},
			delete: async (id: string) => {
				analysisProfileDeletes += 1;
				return analysisProfiles.delete(id);
			},
		},
		overrides: {
			get: async (id: string) => structuredClone(legacyOverrides.get(id) ?? null),
			count: async () => legacyOverrides.size,
			put: async (id: string, value: unknown) => legacyOverrides.set(id, structuredClone(value)),
			delete: async (id: string) => legacyOverrides.delete(id),
		},
		schemas: {
			get: async (id: string) => structuredClone(customSchemas.get(id) ?? null),
			count: async () => customSchemas.size,
			put: async (id: string, value: unknown) => {
				customSchemas.set(id, structuredClone(value));
			},
			delete: async (id: string) => customSchemas.delete(id),
			query: async ({ limit = 50, cursor, where, orderBy }: any = {}) => {
				schemaQueries.push({ where, limit });
				let entries = [...customSchemas.entries()];
				if (where) {
					entries = entries.filter(([, data]: any) =>
						Object.entries(where).every(([key, value]) =>
							value === null
								? data?.[key] == null
								: value && typeof value === "object" && Array.isArray((value as any).in)
								? (value as any).in.includes(data?.[key])
								: data?.[key] === value),
					);
				}
				const [orderKey, direction] = Object.entries(orderBy ?? {})[0] ?? [];
				if (orderKey) {
					entries.sort(
						(left: any, right: any) =>
							String(left[1]?.[orderKey as string] ?? "").localeCompare(
								String(right[1]?.[orderKey as string] ?? ""),
							) * (direction === "desc" ? -1 : 1),
					);
				}
				const start = Number.parseInt(cursor ?? "0", 10) || 0;
				const pageLimit = Math.min(limit, 100);
				const hasMore = start + pageLimit < entries.length;
				return {
					items: entries.slice(start, start + pageLimit).map(([id, data]) => ({
						id,
						data: structuredClone(data),
					})),
					hasMore,
					cursor: hasMore ? String(start + pageLimit) : undefined,
				};
			},
		},
			scores: {
			get: async (id: string) => {
				if (scoreReadFailure) {
					const error = scoreReadFailure;
					scoreReadFailure = null;
					throw error;
				}
				return structuredClone(scores.get(id) ?? null);
			},
			count: async () => scores.size,
			put: async (id: string, value: unknown) => {
				scoreWrites += 1;
				scores.set(id, structuredClone(value));
			},
			compareAndSet: async (id: string, expected: any, next: any) => {
				const present = scores.has(id);
				if (expected.state === "missing" ? present : !present) return false;
				if (
					expected.state === "value" &&
					JSON.stringify(scores.get(id)) !== JSON.stringify(expected.value)
				)
					return false;
				if (next.action === "delete") {
					scoreDeletes += 1;
					return scores.delete(id);
				}
				scoreWrites += 1;
				scores.set(id, structuredClone(next.value));
				return true;
			},
			delete: async (id: string) => {
				scoreDeletes += 1;
				return scores.delete(id);
			},
			query: async () => ({
				items: [...scores.entries()].map(([id, data]) => ({ id, data: structuredClone(data) })),
				hasMore: false,
				cursor: undefined,
			}),
		},
		scoreAnalysisRevisions: {
			get: async (id: string) => structuredClone(scoreAnalysisRevisions.get(id) ?? null),
			compareAndSet: async (id: string, expected: any, next: any) => {
				const present = scoreAnalysisRevisions.has(id);
				if (expected.state === "missing" ? present : !present) return false;
				if (
					expected.state === "value" &&
					JSON.stringify(scoreAnalysisRevisions.get(id)) !== JSON.stringify(expected.value)
				)
					return false;
				if (next.action === "delete") return scoreAnalysisRevisions.delete(id);
				scoreAnalysisRevisions.set(id, structuredClone(next.value));
				return true;
			},
		},
	},
	content: {
		listCollections: async () => [
			{ slug: "posts", label: "Blog posts", labelSingular: "Post", hasSeo: true,
				urlPattern: "/blog/{slug}", routable: true, hidden: false },
			{ slug: "pages", label: "Pages", labelSingular: "Page", hasSeo: true,
				urlPattern: "/{slug}", routable: true, hidden: false },
			{ slug: "services", label: "Services", labelSingular: "Service", hasSeo: true,
				urlPattern: "/services/{slug}", routable: true, hidden: false },
		],
		getPublicUrl: async (collection: string, id: string) => {
			const item = contentItems.get(`${collection}:${id}`);
			if (!item?.publishedAt) return null;
			const prefix = collection === "posts" ? "/blog/" : collection === "salons" ? "/salon/" : null;
			return prefix ? `https://example.com${prefix}${encodeURIComponent(item.slug)}` : null;
		},
		get: async (collection: string, id: string) => {
			contentReads += 1;
			return structuredClone(contentItems.get(`${collection}:${id}`) ?? null);
		},
		list: async (collection: string, options: { limit?: number; cursor?: string; where?: { status?: string; locale?: string } } = {}) => {
			contentReads += 1;
			scoreRefreshListCalls.push({
				collection,
				limit: options.limit,
				cursor: options.cursor,
				where: options.where,
			});
			const items = [...contentItems.entries()]
				.filter(([key]) => key.startsWith(`${collection}:`))
				.map(([, item]) => structuredClone(item));
			if (scoreRefreshPagingFixture) {
				return {
					items: items.slice(0, 1),
					cursor: options.cursor ? undefined : "posts-page-2",
					hasMore: options.cursor === undefined,
				};
			}
			if (contentOptionsEmptyPageFixture) {
				return { items: [], cursor: "empty-next", hasMore: true };
			}
				if (scoreRefreshOversizeFixture) {
				return {
					items: Array.from({ length: 101 }, (_, index) => ({
						...structuredClone(items[0]),
						id: `bounded-post-${index}`,
					})),
					cursor: "oversize-page-2",
					hasMore: true,
				};
				}
				if (scoreRefreshRepeatedCursorFixture) {
					return {
						items: items.slice(0, 1),
						cursor: options.cursor,
						hasMore: true,
					};
				}
				const start = Number(options.cursor ?? 0);
				const limit = options.limit ?? items.length;
				const hasMore = start + limit < items.length;
				return {
					items: items.slice(start, start + limit),
					cursor: hasMore ? String(start + limit) : undefined,
					hasMore,
				};
		},
	},
	url: (path: string) => new URL(path, "https://example.com").href,
	log: {
		warn: (message: string) => {
			if (message === "seo: invalid score cache entry; rebuilding") scoreCacheWarnings += 1;
		},
		info: () => undefined,
		error: () => undefined,
		debug: () => undefined,
	},
};

function handler(name: string) {
	return (seoRuntime as any).routes[name].handler as (
		routeContext: any,
		routeContextValue: any,
	) => Promise<any>;
}

function route(input: unknown = {}) {
	return {
		input,
		request: {
			url: "https://example.com/_emdash/api/plugins/shipit-seo/admin-templates",
			method: "POST",
			headers: {},
		},
	};
}

/** A plugin KV map where every write gives the key a new revision, as on the published hosts. */
function versionedKv(store: Map<string, unknown>) {
	const revisions = new Map<string, number>();
	const revision = (key: string) => (store.has(key) ? `v${revisions.get(key) ?? 0}` : null);
	const bump = (key: string) => revisions.set(key, (revisions.get(key) ?? 0) + 1);
	return {
		get: async (key: string) => structuredClone(store.get(key) ?? null),
		getVersioned: async (key: string) =>
			store.has(key) ? { value: structuredClone(store.get(key)), revision: revision(key) } : null,
		compareAndSet: async (key: string, expected: string | null, value: unknown) => {
			if (revision(key) !== expected) return { applied: false };
			store.set(key, structuredClone(value));
			bump(key);
			return { applied: true, revision: revision(key) };
		},
		compareAndDelete: async (key: string, expected: string) => {
			if (revision(key) !== expected) return { applied: false };
			store.delete(key);
			revisions.delete(key);
			return { applied: true };
		},
		set: async (key: string, value: unknown) => {
			store.set(key, structuredClone(value));
			bump(key);
		},
		delete: async (key: string) => {
			revisions.delete(key);
			return store.delete(key);
		},
		list: async () => [],
	};
}

const EMPTY_TEMPLATE_GUARD = { fields: { title: null, description: null, socialTitle: null, socialDescription: null } };

/** Sends one Templates command with the revision and guard of a fresh configuration read. */
async function templateCommand(
	name: "save-admin-templates" | "reset-admin-templates",
	routeContext: any,
	collection: string,
	templateValues?: unknown,
) {
	const configuration = await handler("admin-templates")(route(), routeContext);
	const item = configuration.items.find((candidate: any) => candidate.collection === collection);
	return handler(name)(route({
		collection,
		expectedRevision: configuration.revision,
		inheritanceGuard: item?.inheritanceGuard ?? EMPTY_TEMPLATE_GUARD,
		...(templateValues ? { values: templateValues } : {}),
	}), routeContext);
}

function nestedRecords(value: unknown): Array<Record<string, any>> {
	if (Array.isArray(value)) return value.flatMap(nestedRecords);
	if (!value || typeof value !== "object") return [];
	const record = value as Record<string, any>;
	return [record, ...Object.values(record).flatMap(nestedRecords)];
}

const initial = await handler("admin-templates")(route(), context);
const noSeoCollections = await handler("admin-templates")(route(), {
	...context,
	schema: { listCollections: async () => [] },
});
check(
	"a site without SEO-enabled collections has a valid empty template response",
	noSeoCollections.contractVersion === SEO_ADMIN_CONTRACT_VERSION &&
		parseSeoAdminTemplateConfiguration(noSeoCollections).items.length === 0,
);
check(
	"legacy templates remain readable",
	initial.items.find((item: any) => item.collection === "posts")?.values.title.includes("Legacy"),
);
check(
	"legacy templates are shown as inherited older values",
	initial.state === "absent" &&
		initial.items.find((item: any) => item.collection === "posts")?.source === "legacy",
);
const freshKv = new Map<string, unknown>();
const freshTemplates = await handler("admin-templates")(route(), { ...context, kv: versionedKv(freshKv) });
check(
	"a fresh install without legacy template keys inherits the defaults",
	freshTemplates.state === "absent" &&
		freshTemplates.revision === null &&
		freshTemplates.items.every((item: any) => item.source === "default" && item.inheritanceGuard.revisions === null),
);

const dynamicContent = {
	...context.content,
	listCollections: async () => [
		{
			slug: "cities",
			label: "Plaatsen",
			labelSingular: "Plaats",
			hasSeo: true,
			urlPattern: "/plaats/{slug}",
			routable: true,
			hidden: false,
		},
		{
			slug: "pages",
			label: "Pagina's",
			labelSingular: "Pagina",
			hasSeo: true,
			urlPattern: "/{slug}",
			routable: true,
			hidden: false,
		},
		{
			slug: "salons",
			label: "Salons",
			labelSingular: "Salon",
			titleField: "headline",
			hasSeo: true,
			urlPattern: "/salon/{slug}",
			routable: true,
			hidden: false,
		},
		{
			slug: "treatments",
			label: "Behandelingen",
			labelSingular: "Behandeling",
			hasSeo: true,
			urlPattern: "/behandeling/{slug}",
			routable: true,
			hidden: false,
		},
		{
			slug: "audit_requests",
			label: "Audit requests",
			labelSingular: "Audit request",
			hasSeo: false,
			urlPattern: null,
			routable: true,
			hidden: false,
		},
		{
			slug: "internal",
			label: "Internal",
			labelSingular: "Internal",
			hasSeo: true,
			urlPattern: null,
			routable: true,
			hidden: true,
		},
		{
			slug: "unrouted",
			label: "Unrouted",
			labelSingular: "Unrouted",
			hasSeo: true,
			urlPattern: "/unrouted/{slug}",
			routable: false,
			hidden: false,
		},
	],
};
const dynamicContext = { ...context, content: dynamicContent };
scoreRefreshListCalls.length = 0;
const dynamicOptions = await handler("admin-content-options")(route(), dynamicContext);
check("content type choices do not list entries", scoreRefreshListCalls.length === 0 && dynamicOptions.items.length === 0);
check(
	"host collection discovery replaces product-specific collection assumptions",
	dynamicOptions.collections.map((item: any) => item.collection).join(",") ===
		"cities,pages,salons,treatments,audit_requests",
);
check(
	"host collection labels remain intact",
	dynamicOptions.collections.map((item: any) => item.label).join(",") ===
		"Plaatsen,Pagina's,Salons,Behandelingen,Audit requests",
);
const dynamicTemplates = await handler("admin-templates")(route(), dynamicContext);
check(
	"template configuration lists every visible routable collection, with or without core SEO fields",
	dynamicTemplates.items.map((item: any) => item.collection).join(",") ===
		"cities,pages,salons,treatments,audit_requests",
);
const disabledSeoTarget = dynamicTemplates.items.find((item: any) => item.collection === "audit_requests");
check(
	"a public collection without core SEO fields says templates still supply its defaults",
	disabledSeoTarget?.source === "default" &&
		disabledSeoTarget.description === "Defaults for audit requests. EmDash SEO fields are off for this content type, but templates still supply its description and social defaults. Saved entry overrides take precedence." &&
		dynamicTemplates.items[0].description === "Defaults for plaatsen. Saved entry overrides take precedence over these templates.",
);
// Hidden, unroutable and missing types keep their saved records and are never targets.
const retainedCollections = ["internal", "unrouted", "retired"];
const retainedTemplateKey = `configuration:templates:v${SEO_ADMIN_TEMPLATES_STORAGE_VERSION}`;
const retainedTemplateRevision = "2026-07-01T09:00:00.000Z";
const retainedTemplateValues = defaultSeoAdminTemplateSet(retainedCollections);
for (const collection of retainedCollections) retainedTemplateValues[collection].title = `{{title}} | ${collection}`;
const retainedTemplateKv = new Map<string, unknown>([[retainedTemplateKey, {
	version: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	updatedAt: retainedTemplateRevision,
	values: retainedTemplateValues,
	collectionUpdatedAt: Object.fromEntries(retainedCollections.map((collection) => [collection, retainedTemplateRevision])),
}]]);
const retainedTemplateContext = { ...dynamicContext, kv: versionedKv(retainedTemplateKv) };
const retainedRecord = () => retainedTemplateKv.get(retainedTemplateKey) as any;
const retainedIntact = () => retainedCollections.every((collection) =>
	retainedRecord()?.values[collection]?.title === `{{title}} | ${collection}` &&
	retainedRecord()?.collectionUpdatedAt[collection] === retainedTemplateRevision);
const citiesValues = { ...structuredClone(dynamicTemplates.items[0].values), description: "{{title}} in de stad" };
const savedVisibleTemplates = await templateCommand("save-admin-templates", retainedTemplateContext, "cities", citiesValues);
check(
	"saving one visible template keeps hidden, unroutable and missing templates as they are",
	savedVisibleTemplates.success === true &&
		savedVisibleTemplates.outcome === "saved" &&
		(savedVisibleTemplates.templates.items as any[]).every((item) => !retainedCollections.includes(item.collection)) &&
		(savedVisibleTemplates.templates.retainedCollections as string[]).join(",") === "internal,retired,unrouted" &&
		retainedIntact() &&
		Object.keys(retainedRecord().values).sort().join(",") === "cities,internal,retired,unrouted",
);
for (const collection of retainedCollections) {
	const rejected = await templateCommand("save-admin-templates", retainedTemplateContext, collection, retainedTemplateValues[collection]);
	check(`the ${collection} template cannot be edited`, rejected.success === false && rejected.error === "collection_unavailable" && retainedIntact());
}
const disabledSeoValues = { ...structuredClone(disabledSeoTarget.values), description: "Request: {{description}}" };
const savedDisabledSeo = await templateCommand("save-admin-templates", retainedTemplateContext, "audit_requests", disabledSeoValues);
check(
	"a public collection without core SEO fields saves through the same guarded command",
	savedDisabledSeo.success === true &&
		savedDisabledSeo.outcome === "saved" &&
		retainedRecord()?.values.audit_requests?.description === "Request: {{description}}" &&
		(savedDisabledSeo.templates.items as any[]).find((item) => item.collection === "audit_requests")?.source === "override" &&
		retainedIntact(),
);
const staleDisabledSeo = await handler("save-admin-templates")(route({
	collection: "audit_requests",
	expectedRevision: null,
	inheritanceGuard: disabledSeoTarget.inheritanceGuard,
	values: { ...disabledSeoValues, title: "Stale {{title}}" },
}), retainedTemplateContext);
check(
	"its save still refuses a stale revision",
	staleDisabledSeo.success === false && staleDisabledSeo.error === "conflict" &&
		retainedRecord()?.values.audit_requests?.title !== "Stale {{title}}",
);
const enabledSeoContext = {
	...retainedTemplateContext,
	content: {
		...dynamicContent,
		listCollections: async () => (await dynamicContent.listCollections()).map((item) =>
			item.slug === "audit_requests" ? { ...item, hasSeo: true } : item),
	},
};
const listedWithSeo = (await handler("admin-templates")(route(), enabledSeoContext)).items
	.find((item: any) => item.collection === "audit_requests");
const listedWithoutSeo = (await handler("admin-templates")(route(), retainedTemplateContext)).items
	.find((item: any) => item.collection === "audit_requests");
check(
	"turning core SEO fields on or off does not change the saved template listed",
	listedWithoutSeo?.source === "override" &&
		JSON.stringify(listedWithSeo?.values) === JSON.stringify(listedWithoutSeo?.values),
);
const resetDisabledSeo = await templateCommand("reset-admin-templates", retainedTemplateContext, "audit_requests");
check(
	"resetting it inherits the defaults and keeps every retained template",
	resetDisabledSeo.success === true &&
		resetDisabledSeo.outcome === "saved" &&
		!("audit_requests" in retainedRecord().values) &&
		retainedIntact(),
);
const resetVisibleTemplates = await templateCommand("reset-admin-templates", retainedTemplateContext, "cities");
check(
	"resetting another visible template keeps hidden, unroutable and missing templates and their revision",
	resetVisibleTemplates.success === true &&
		resetVisibleTemplates.outcome === "saved" &&
		!("cities" in retainedRecord().values) &&
		retainedIntact(),
);
retainedTemplateKv.clear();
const freshVisibleSave = await templateCommand("save-admin-templates", retainedTemplateContext, "cities", citiesValues);
const freshRecord = retainedTemplateKv.get(retainedTemplateKey) as any;
check(
	"a fresh site stores only the selected collection and keeps a null fallback token",
	freshVisibleSave.success === true &&
		Object.keys(freshRecord.values).join(",") === "cities" &&
		Object.hasOwn(freshRecord, "fallbackScoreRevision") && freshRecord.fallbackScoreRevision === null,
);
const dynamicSitemap = await handler("admin-sitemap")(route(), dynamicContext);
check(
	"sitemap configuration offers every public routable collection, with or without core SEO",
	dynamicSitemap.groups.map((item: any) => item.key).join(",") ===
		"audit_requests,cities,pages,salons,treatments",
);
const salonPreview = await handler("admin-entry-preview")(
	route({ ref: "salons:salon-1" }),
	dynamicContext,
);
check(
	"entry previews use the host collection route pattern",
	salonPreview.success &&
		salonPreview.preview.search.url === "https://example.com/salon/glow-studio",
);
check(
	"custom collection previews use the host title field",
	salonPreview.success &&
		salonPreview.preview.content.title === "Glow Studio" &&
		salonPreview.preview.search.title.includes("Glow Studio") &&
		!salonPreview.preview.search.title.includes("Old title"),
);
const updatedSalonPreview = await handler("admin-entry-preview")(
	route({
		ref: "salons:salon-1",
		snapshot: {
			ref: "salons:salon-1", sourceVersion: "revision:2", slug: "new-name",
			data: { title: "Glow Studio" }, seo: {},
		},
	}),
	dynamicContext,
);
check(
	"draft previews only use the discovered collection pattern",
	updatedSalonPreview.success &&
		updatedSalonPreview.preview.search.url === "https://example.com/salon/new-name",
);
const noDiscoveryContext = {
	...context,
	content: { get: context.content.get, list: context.content.list },
};
const unavailableOptions = await handler("admin-content-options")(route(), noDiscoveryContext);
check(
	"missing collection discovery does not invent site content types",
	unavailableOptions.collections.length === 0 && unavailableOptions.items.length === 0,
);

scoreRefreshListCalls.length = 0;
const contentOptions = await handler("admin-content-options")(route({ collection: "posts", limit: 25 }), context);
check(
	"preview content options do not depend on score cache",
	contentOptions.items.length === 2 && scores.size === 0,
);
check(
	"preview content options expose stable refs",
	contentOptions.items.every((item: any) => item.ref.startsWith("posts:")),
);
check(
	"content options list only the selected collection with a bounded page",
	scoreRefreshListCalls.length === 1 && scoreRefreshListCalls[0]?.collection === "posts" &&
		scoreRefreshListCalls[0]?.limit === 25 && contentOptions.hasMore === false,
);
scoreRefreshListCalls.length = 0;
let invalidContentOptionsRejected = false;
try {
	await handler("admin-content-options")(route({ collection: "posts", limit: 26 }), context);
} catch {
	invalidContentOptionsRejected = true;
}
check("content option pages reject oversized limits before listing", invalidContentOptionsRejected && scoreRefreshListCalls.length === 0);
scoreRefreshPagingFixture = true;
const firstContentPage = await handler("admin-content-options")(route({ collection: "posts", limit: 1 }), context);
const secondContentPage = await handler("admin-content-options")(
	route({ collection: "posts", limit: 1, cursor: firstContentPage.cursor }), context,
);
scoreRefreshPagingFixture = false;
check(
	"content options advance one selected collection page at a time",
	firstContentPage.items.length === 1 && firstContentPage.hasMore === true &&
		firstContentPage.cursor === "posts-page-2" && secondContentPage.hasMore === false &&
		scoreRefreshListCalls.length === 2 && scoreRefreshListCalls.every((call) =>
			call.collection === "posts" && call.limit === 1),
);
scoreRefreshListCalls.length = 0;
contentOptionsEmptyPageFixture = true;
const emptyContentPage = await handler("admin-content-options")(route({ collection: "posts", limit: 25 }), context);
contentOptionsEmptyPageFixture = false;
check(
	"content options preserve an advancing cursor after an empty filtered page",
	emptyContentPage.items.length === 0 && emptyContentPage.hasMore === true &&
		emptyContentPage.cursor === "empty-next" && scoreRefreshListCalls.length === 1,
);
scoreRefreshListCalls.length = 0;
scoreRefreshRepeatedCursorFixture = true;
let nonAdvancingContentPageRejected = false;
try {
	await handler("admin-content-options")(route({ collection: "posts", limit: 1, cursor: "same" }), context);
} catch {
	nonAdvancingContentPageRejected = true;
}
scoreRefreshRepeatedCursorFixture = false;
check("content options reject a repeated cursor", nonAdvancingContentPageRejected && scoreRefreshListCalls.length === 1);
scoreRefreshListCalls.length = 0;

values.set("settings:defaultOgImage", "https://example.com/default-social.jpg");
const emptyOverview = await handler("admin-overview")(route({ limit: 6 }), context);
check(
	"overview identifies its score as setup readiness",
	emptyOverview.readiness.state === "ready" &&
		emptyOverview.readiness.title === "SEO setup is ready",
);
check(
	"overview does not imply content quality before analysis",
	emptyOverview.summary.sampleSize === 0 &&
		emptyOverview.summary.needsAttention === 0 &&
		emptyOverview.readiness.description.includes(
			"Analyze content before evaluating content quality.",
		),
);
const emptyDashboard = await handler("admin")(route({ page: "dashboard" }), context);
const emptyDashboardRecords = nestedRecords(emptyDashboard.blocks);
check(
	"Block Kit dashboard identifies its score as setup readiness",
	emptyDashboardRecords.some(
		(item) => item.type === "meter" && item.label === "SEO setup readiness",
	),
);
check(
	"Block Kit dashboard does not report zero content issues before analysis",
	emptyDashboardRecords.some(
		(item) =>
			item.label === "Needs attention" &&
			item.value === "--" &&
			item.description === "Analyze content to measure",
	),
);
check(
	"readiness scores only checks that can change live output",
	!emptyOverview.checks.some((item: any) => item.check === "Description templates"),
);
const personSettings = await handler("admin-settings")(route(), context);
values.set(GLOBAL_SETTINGS_KEY, {
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	updatedAt: "2026-07-14T09:00:00.000Z",
	...personSettings.values,
	publisherType: "person",
	personName: "Ada Publisher",
});
const personOverview = await handler("admin-overview")(route({ limit: 6 }), context);
check(
	"publisher readiness names the selected Person entity",
	personOverview.checks.find((item: any) => item.check === "Publisher schema")?.detail ===
		"Person and WebSite schema are configured to be emitted.",
);
values.delete(GLOBAL_SETTINGS_KEY);
values.set("preset:website", false);
const websiteOffOverview = await handler("admin-overview")(route({ limit: 6 }), context);
check(
	"readiness reviews rather than fails when EmDash still emits its own site graph",
	websiteOffOverview.checks.find((item: any) => item.check === "Publisher schema")?.status === "review",
);
values.delete("preset:website");
values.delete("settings:defaultOgImage");
const noPluginImageOverview = await handler("admin-overview")(route({ limit: 6 }), context);
check(
	"readiness says EmDash's default image applies when the plugin has none",
	noPluginImageOverview.checks.find((item: any) => item.check === "Default social image")?.detail.includes("EmDash's default social image") === true,
);
values.set("settings:defaultOgImage", "https://example.com/default-social.jpg");
values.set("settings:noindex", true);
const noindexOverview = await handler("admin-overview")(route({ limit: 6 }), context);
check(
	"overview describes plugin noindex without claiming staging or robots control",
	noindexOverview.readiness.title === "Noindex is enabled" &&
		noindexOverview.readiness.description.includes("metadata") &&
		!noindexOverview.readiness.description.includes("Staging mode") &&
		!noindexOverview.readiness.description.includes("robots.txt blocks"),
);
check(
	"the noindex priority opens the view that owns the switch",
	noindexOverview.priorities.find((item: any) => item.check === "Search visibility")?.area === "Search & social",
);
values.set("settings:noindex", false);
const analysisSettings = await handler("admin-settings")(route(), context);
values.set(GLOBAL_SETTINGS_KEY, {
	...analysisSettings.values,
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	updatedAt: "2026-10-15T00:00:00.000Z",
	contentScoringEnabled: true,
	contentScoringResourceNoticeVersion: 1,
});
for (const [collection, profile] of [["posts", "article"], ["pages", "general"], ["stories", "general"]]) {
	values.set(collectionAnalysisProfileKey(collection), {
		version: 1, profile, updatedAt: "2026-10-15T00:00:00.000Z",
	});
}
const analyzerExtraIds = Array.from({ length: 26 }, (_, index) =>
	`analyzer-${index.toString().padStart(2, "0")}`,
);
for (const id of analyzerExtraIds) {
	contentItems.set(`posts:${id}`, {
		...structuredClone(contentItems.get("posts:post-1")),
		id,
		data: { ...structuredClone(contentItems.get("posts:post-1")?.data), title: id },
	});
}
scoreRefreshListCalls.length = 0;
const analyzerFirstPage = await handler("admin")(route({ page: "analyzer" }), context);
const analyzerNextAction = nestedRecords(analyzerFirstPage.blocks).find(
	(item) => item.action_id === "analyzer_page" && item.label === "Next content page",
);
check(
	"legacy analyzer loads only the first selected content page",
	Boolean(analyzerNextAction) && scoreRefreshListCalls.length === 1 &&
		scoreRefreshListCalls[0]?.collection === "posts" && scoreRefreshListCalls[0]?.limit === 25,
);
const readsBeforeExactSelection = contentReads;
const listsBeforeExactSelection = scoreRefreshListCalls.length;
const analyzerExact = await handler("admin")(
	route({ page: "analyzer", analyzer: { ref: "posts:analyzer-25" } }), context,
);
const analyzerExactRef = nestedRecords(analyzerExact.blocks).find(
	(item) => item.action_id === "ref" && item.label === "Content",
);
check(
	"legacy analyzer preserves an exact entry outside the first page",
	analyzerExactRef?.initial_value === "posts:analyzer-25" &&
		analyzerExactRef?.options?.some((item: any) => item.value === "posts:analyzer-25" && item.label.includes("analyzer-25")) &&
		contentReads === readsBeforeExactSelection + 2 &&
		scoreRefreshListCalls.length === listsBeforeExactSelection + 1 &&
		scoreWrites === 0 && scoreAnalysisRevisions.size === 0,
);
const analyzerMissing = await handler("admin")(
	route({ page: "analyzer", analyzer: { ref: "posts:missing-analyzer-entry" } }), context,
);
const analyzerMissingRef = nestedRecords(analyzerMissing.blocks).find(
	(item) => item.action_id === "ref" && item.label === "Content",
);
check(
	"an unavailable exact analyzer entry falls back without scoring content",
	analyzerMissingRef?.initial_value !== "posts:missing-analyzer-entry" &&
		analyzerMissingRef?.options?.some((item: any) => item.value === analyzerMissingRef.initial_value) &&
		scoreWrites === 0 && scoreAnalysisRevisions.size === 0,
);
const analyzerSecondPage = await handler("admin")(
	route({ action_id: "analyzer_page", value: analyzerNextAction?.value }), context,
);
const analyzerSecondPageRecords = nestedRecords(analyzerSecondPage.blocks);
check(
	"legacy analyzer exposes the next page and a route back to the first",
	analyzerSecondPageRecords.some((item) => item.action_id === "ref" &&
		item.options?.some((option: any) => option.value === "posts:analyzer-25")) &&
		analyzerSecondPageRecords.some((item) => item.action_id === "analyzer_page" &&
			item.label === "First content page") &&
		scoreRefreshListCalls.every((call) => call.collection === "posts" && call.limit === 25),
);
for (const id of analyzerExtraIds) contentItems.delete(`posts:${id}`);
scores.clear();
scoreAnalysisRevisions.clear();
scoreWrites = 0;
scoreRefreshListCalls.length = 0;
values.delete("settings:defaultOgImage");

const templateKey = `configuration:templates:v${SEO_ADMIN_TEMPLATES_STORAGE_VERSION}`;
const invalidValues = defaultSeoAdminTemplateSet();
invalidValues.posts.title = "{{unknownVariable}}";
const rejected = await templateCommand("save-admin-templates", context, "posts", invalidValues.posts);
check(
	"unknown template variables are rejected",
	rejected.success === false && rejected.error === "invalid_values" && Boolean(rejected.errors["posts.title"]),
);
check("invalid templates perform no writes", kvWrites === 0);

const validValues = defaultSeoAdminTemplateSet();
validValues.posts.title = "{{title}} | Example Studio";
validValues.posts.description = "Read {{description}}";
validValues.posts.socialTitle = "Social: {{title}}";
validValues.services.title = "{{title}} | Services";
const saved = await templateCommand("save-admin-templates", context, "posts", validValues.posts);
check("valid templates save successfully", saved.success === true && saved.outcome === "saved");
check("a template save is one conditional write", kvWrites === 1);
check("versioned template key is used", values.has(templateKey));
check("legacy keys remain untouched", values.get("tpl:posts:title") === "{{title}} | Legacy");
check(
	"only the selected collection gets an override",
	Object.keys((values.get(templateKey) as any).values).join(",") === "posts",
);
const savedAgain = await templateCommand("save-admin-templates", context, "posts", validValues.posts);
check("saving the values in effect writes nothing", savedAgain.outcome === "unchanged" && kvWrites === 1);
const inheritedPages = (await handler("admin-templates")(route(), context)).items.find((item: any) => item.collection === "pages");
const pinnedInherited = await templateCommand("save-admin-templates", context, "pages", inheritedPages.values);
check(
	"saving inherited values unchanged does not pin them",
	pinnedInherited.outcome === "unchanged" && !("pages" in (values.get(templateKey) as any).values) && kvWrites === 1,
);
await templateCommand("save-admin-templates", context, "services", validValues.services);
const servicesToken = (values.get(templateKey) as any).collectionUpdatedAt.services;

const partialTemplateContext = {
	...context,
	content: {
		...context.content,
		listCollections: async () => (await context.content.listCollections())
			.filter((item) => item.slug !== "services"),
	},
};
const pagesValues = { ...validValues.pages, description: "Page: {{description}}" };
const partialTemplateSave = await templateCommand("save-admin-templates", partialTemplateContext, "pages", pagesValues);
check("saving an available template preserves an absent collection", partialTemplateSave.success === true &&
	(values.get(templateKey) as any).values.services.title === validValues.services.title &&
	(values.get(templateKey) as any).collectionUpdatedAt.services === servicesToken);
await templateCommand("reset-admin-templates", context, "pages");
const unavailableTemplateContext = {
	...context,
	content: {
		...context.content,
		listCollections: async (): Promise<any[]> => { throw new Error("Schema temporarily unavailable"); },
	},
};
const writesBeforeTemplateOutage = kvWrites;
const unavailableTemplateSave = await handler("save-admin-templates")(route({
	collection: "pages",
	expectedRevision: harnessRevision(templateKey),
	inheritanceGuard: EMPTY_TEMPLATE_GUARD,
	values: pagesValues,
}), unavailableTemplateContext);
check("template save fails closed when collection discovery fails", unavailableTemplateSave.success === false &&
	unavailableTemplateSave.error === "unavailable" && kvWrites === writesBeforeTemplateOutage);

const preview = await handler("admin-entry-preview")(route({ ref: "posts:post-1" }), context);
check(
	"entry preview resolves saved title template",
	preview.success && preview.preview.search.title === "A useful post | Example Studio",
);
check(
	"entry preview exposes the search fallback used after clearing an override",
	preview.success &&
		preview.preview.search.fallbackTitle === "A useful post | Example Studio" &&
		preview.preview.search.fallbackDescription === preview.preview.search.description,
);
check(
	"entry preview resolves social template",
	preview.success && preview.preview.social.title === "Social: A useful post",
);
check(
	"entry preview exposes field sources",
	preview.success && preview.preview.sources.title === "template",
);
check(
	"entry preview resolves an absolute canonical",
	preview.success && preview.preview.search.url === "https://example.com/blog/useful-post",
);
check(
	"entry preview includes the active schema preset",
	preview.success && preview.preview.schemaTypes.includes("BlogPosting"),
);
check(
	"entry preview reports the saved noindex choice without claiming sitemap membership",
	preview.success && preview.preview.entryNoindex === false && !("sitemap" in preview.preview),
);
check(
	"entry preview validates matching canonicals",
	preview.success && preview.preview.canonicalValidation.status === "matches",
);
check(
	"entry preview reports EmDash-owned locale output",
	preview.success && preview.preview.localeGraph.owner === "emdash-core",
);
check(
	"single-locale hosts do not receive translation warnings",
	preview.success && preview.preview.localeGraph.status === "single-locale",
);
check(
	"entry preview exposes empty social overrides explicitly",
	preview.success &&
		preview.preview.social.override.title === null &&
		preview.preview.social.override.description === null,
);

const initialSchemaPreview = await handler("entry-schema-preview")(
	route({ ref: "posts:post-1" }),
	context,
);
check(
	"entry schema preview marks the live BlogPosting graph as emitted",
	initialSchemaPreview.success &&
		initialSchemaPreview.items.some(
			(item: any) => item.presetKey === "blogPosting" && item.emitted === true,
		),
);
customSchemas.set("conflicting-article", {
	storageVersion: 1,
	name: "Conflicting article",
	scope: "posts",
	json: JSON.stringify({
		"@context": "https://schema.org",
		"@type": "Article",
		"@id": "{{canonical}}#article",
		name: "{{title}}",
	}),
	enabled: true,
	createdAt: "2026-07-19T10:00:00.000Z",
	updatedAt: "2026-07-19T10:00:00.000Z",
});
const conflictingSchemaPreview = await handler("entry-schema-preview")(
	route({ ref: "posts:post-1" }),
	context,
);
const suppressedArticle = conflictingSchemaPreview.success
	? conflictingSchemaPreview.items.find((item: any) => item.id === "custom:conflicting-article")
	: null;
check(
	"entry schema preview uses live conflict resolution",
	Boolean(
		suppressedArticle &&
			suppressedArticle.emitted === false &&
			suppressedArticle.suppressedReason === "entity-conflict" &&
			suppressedArticle.conflictId === "https://example.com/blog/useful-post#article",
	),
);
check(
	"entry schema preview resolves custom schema variables before display",
	suppressedArticle?.graph?.name === "A useful post | Example Studio",
);
const conflictScoreResponse = await handler("scores")(
	route({ ref: "posts:post-1", refresh: true }),
	context,
);
const resolvedSchemaCheck = conflictScoreResponse.items[0]?.checks.find(
	(item: any) => item.id === "schema",
);
check(
	"content analysis scores only schema graphs that survive live conflict resolution",
	resolvedSchemaCheck?.status === "pass" &&
		String(resolvedSchemaCheck?.evidence?.actual).includes("BlogPosting") &&
		!String(resolvedSchemaCheck?.evidence?.actual).includes("Article"),
);
scores.clear();
scoreWrites = 0;
customSchemas.clear();

const beforePagedSchemaScore = await handler("scores")(
	route({ ref: "posts:post-1", refresh: true }),
	context,
);
// Entry analysis reads only the rules scoped to this entry, so 100 rows for
// another collection never fill its bounded query.
seedPagedCustomSchemas("services");
for (const scope of ["posts:post-1", "posts:useful-post", "posts:post-2", "posts:another-slug"]) {
	customSchemas.set(scope, {
		storageVersion: 1, name: scope, scope, enabled: false,
		json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing" }),
		createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
	});
}
const pagedSchemaScore = await handler("scores")(route({ ref: "posts:post-1" }), context);
check(
	"analysis fingerprints include a matching custom schema behind 100 unrelated rows",
	pagedSchemaScore.items[0]?.ref === "posts:post-1" && beforePagedSchemaScore.items[0]?.ref === "posts:post-1" &&
		pagedSchemaScore.items[0].configurationFingerprint !== beforePagedSchemaScore.items[0].configurationFingerprint,
);
check(
	"content analysis resolves a matching custom schema through its scoped query",
	String(
		pagedSchemaScore.items[0]?.checks.find((item: any) => item.id === "schema")?.evidence?.actual,
	).includes("Product"),
);
const scopedScoreOverview = await handler("admin-overview")(route({ limit: 50 }), context);
check(
	"overview includes a saved score with collection, ID and slug schemas despite unrelated rules",
	scopedScoreOverview.content.some((item: any) => item.ref === "posts:post-1"),
);
const applicableSchema = customSchemas.get("posts:useful-post") as any;
customSchemas.set("posts:useful-post", { ...applicableSchema, updatedAt: "2026-10-15T01:00:00.000Z" });
const changedSchemaOverview = await handler("admin-overview")(route({ limit: 50 }), context);
check("overview excludes a saved score after its applicable schema changes", changedSchemaOverview.summary.sampleSize === 0);
customSchemas.set("posts:useful-post", applicableSchema);
const pagedSchemaEntryPreview = await handler("admin-entry-preview")(
	route({ ref: "posts:post-1" }),
	context,
);
check(
	"entry preview includes a matching custom schema from the second storage page",
	pagedSchemaEntryPreview.success &&
		pagedSchemaEntryPreview.preview.schemaTypes.includes("Product"),
);
scores.clear();
scoreWrites = 0;
customSchemas.clear();

const socialReadsBefore = { ...socialCounts };
const socialContentReadsBefore = contentReads;
const socialBaseline = await handler("admin-entry-social")(route({ ref: "posts:post-1" }), context);
check("Social recovery reads one canonical row without building a preview",
	socialBaseline.success && socialBaseline.ref === "posts:post-1" &&
	socialBaseline.snapshot.revision === null && socialBaseline.snapshot.override === null &&
	socialCounts.versioned === socialReadsBefore.versioned + 1 &&
	socialCounts.read === socialReadsBefore.read && contentReads === socialContentReadsBefore + 1);
const savedSocial = await handler("save-admin-entry-social")(
	route({
		ref: "posts:post-1",
		title: "A dedicated social headline",
		description: "A dedicated social description for shared links.",
		expectedRevision: socialBaseline.snapshot.revision,
	}),
	context,
);
check(
	"social-only overrides return target-bound persistence acknowledgement",
	savedSocial.success && savedSocial.outcome === "saved" &&
	savedSocial.ref === "posts:post-1" && savedSocial.snapshot.ref === "posts:post-1" &&
	savedSocial.snapshot.override.title === "A dedicated social headline" &&
	socialOverrides.has("posts:post-1") && socialCounts.unguarded === 0 &&
	socialCounts.read === socialReadsBefore.read && contentReads === socialContentReadsBefore + 2,
);
const savedSocialPreview = await handler("admin-entry-preview")(route({ ref: "posts:post-1" }), context);
check(
	"saved Social preview is independent and carries the correlated canonical revision",
	savedSocialPreview.success &&
		savedSocialPreview.preview.social.title === "A dedicated social headline" &&
		savedSocialPreview.preview.sources.socialTitle === "plugin-social-override" &&
		savedSocialPreview.preview.search.title === "A useful post | Example Studio" &&
		savedSocialPreview.preview.social.editing.state === "ready" &&
		savedSocialPreview.preview.social.editing.snapshot.revision === savedSocial.snapshot.revision,
);
const conditionalBeforeNoop = socialCounts.conditional;
const unchangedSocial = await handler("save-admin-entry-social")(route({
	ref: "posts:post-1", title: " A dedicated social headline ",
	description: "A dedicated social description for shared links.",
	expectedRevision: savedSocial.snapshot.revision,
}), context);
check("normalized unchanged Social save preserves the revision without a write",
	unchangedSocial.success && unchangedSocial.outcome === "unchanged" &&
	unchangedSocial.snapshot.revision === savedSocial.snapshot.revision &&
	socialCounts.conditional === conditionalBeforeNoop);
const staleSocial = await handler("save-admin-entry-social")(route({
	ref: "posts:post-1", title: "Stale overwrite", description: "", expectedRevision: null,
}), context);
const unguardedSocial = await handler("save-admin-entry-social")(route({
	ref: "posts:post-1", title: "Unguarded overwrite", description: "",
}), context);
check("stale and old unguarded Social clients cannot overwrite the canonical row",
	!staleSocial.success && staleSocial.outcome === "rejected" && staleSocial.error === "conflict" &&
	!unguardedSocial.success && unguardedSocial.error === "invalid_values" &&
	socialCounts.conditional === conditionalBeforeNoop &&
	(socialOverrides.get("posts:post-1") as any).title === "A dedicated social headline");
const aliasTarget = await handler("admin-entry-social")(route({ ref: "posts:useful-post" }), {
	...context, content: { ...context.content, get: async () => contentItems.get("posts:post-1") },
});
check("Social recovery cannot substitute a slug-resolved row for its requested canonical target",
	!aliasTarget.success && aliasTarget.ref === "posts:useful-post" && aliasTarget.error === "not_found");
const unavailableSocial = await handler("admin-entry-social")(route({ ref: "posts:post-1" }), {
	...context, storage: { ...context.storage, socialOverrides: {
		...context.storage.socialOverrides, getVersioned: async () => { throw new Error("unreadable"); },
	} },
});
check("unreadable Social storage is not reported as an absent override",
	!unavailableSocial.success && unavailableSocial.error === "storage_unavailable");
const noPreviewContext = {
	...context, kv: { ...context.kv, get: async () => { throw new Error("preview unavailable"); } },
};
const acknowledgedWithoutPreview = await handler("save-admin-entry-social")(route({
	ref: "posts:post-1", title: "A dedicated social headline",
	description: "A dedicated social description for shared links.",
	expectedRevision: savedSocial.snapshot.revision,
}), noPreviewContext);
check("a Social persistence acknowledgement does not depend on resolved preview settings",
	acknowledgedWithoutPreview.success && acknowledgedWithoutPreview.outcome === "unchanged");

const draftPreview = await handler("admin-entry-preview")(
	route({
	ref: "posts:post-1",
	template: { ...validValues.posts, title: "Draft {{title}}" },
	}),
	context,
);
check(
	"unsaved draft templates can be previewed",
	draftPreview.success && draftPreview.preview.search.title === "Draft A useful post",
);

const corePreview = await handler("admin-entry-preview")(
	route({
	ref: "posts:post-2",
	template: { ...validValues.posts, title: "Draft {{title}}" },
	}),
	context,
);
check(
	"entry SEO title wins over templates",
	corePreview.success && corePreview.preview.search.title === "Entry SEO title",
);
check(
	"the preview still reports the template value the entry SEO title hides",
	corePreview.success &&
		corePreview.preview.sources.title === "core-seo" &&
		typeof corePreview.preview.search.fallbackTitle === "string" &&
		corePreview.preview.search.fallbackTitle.startsWith("Draft "),
);
check(
	"entry SEO description wins over templates",
	corePreview.success && corePreview.preview.search.description === "Entry SEO description",
);
check(
	"entry preview keeps override-free template fallbacks separate from core SEO values",
	corePreview.success &&
		corePreview.preview.search.fallbackTitle !== corePreview.preview.search.title &&
		corePreview.preview.search.fallbackDescription !== corePreview.preview.search.description,
);
check(
	"entry SEO source is reported",
	corePreview.success && corePreview.preview.sources.title === "core-seo",
);
check(
	"canonical path mismatches are explicit",
	corePreview.success && corePreview.preview.canonicalValidation.status === "different-path",
);

const socialPrecedenceItem = contentItems.get("posts:post-2");
socialPrecedenceItem.seo.ogTitle = "Explicit Open Graph title";
socialPrecedenceItem.seo.ogDescription = "Explicit Open Graph description";
legacyOverrides.set("posts:post-2", {
	title: "Legacy general title",
	description: "Legacy general description",
});
const socialPrecedencePreview = await handler("admin-entry-preview")(
	route({ ref: "posts:post-2" }),
	context,
);
check(
	"explicit Open Graph title wins over a legacy general-title override",
	socialPrecedencePreview.success &&
		socialPrecedencePreview.preview.social.title === "Explicit Open Graph title" &&
		socialPrecedencePreview.preview.sources.socialTitle === "core-seo",
);
check(
	"explicit Open Graph description wins over a legacy general-description override",
	socialPrecedencePreview.success &&
		socialPrecedencePreview.preview.social.description === "Explicit Open Graph description" &&
		socialPrecedencePreview.preview.sources.socialDescription === "core-seo",
);
legacyOverrides.delete("posts:post-2");
delete socialPrecedenceItem.seo.ogTitle;
delete socialPrecedenceItem.seo.ogDescription;

const coreNoindexItem = contentItems.get("posts:post-2");
coreNoindexItem.seo.noIndex = true;
const coreNoindexPreview = await handler("admin-entry-preview")(
	route({ ref: "posts:post-2" }),
	context,
);
check(
	"core noIndex drives entry visibility",
	coreNoindexPreview.success &&
		coreNoindexPreview.preview.indexable === false &&
		coreNoindexPreview.preview.entryNoindex === true,
);
coreNoindexItem.seo.noIndex = false;

// A read that throws may hide a valid or newer row, so it is refused, never deleted.
const seededScore = (await handler("scores")(route({ ref: "posts:post-1" }), context)).items[0];
const storedBeforeReadFailure = structuredClone(scores.get("posts:post-1")) as any;
const deletesBeforeReadFailure = scoreDeletes;
scoreReadFailure = new SyntaxError("Bad control character in string literal in JSON");
const unreadableScoreResponse = await handler("scores")(route({ ref: "posts:post-1" }), context);
check(
	"an unreadable stored score is refused without deleting or replacing it",
	seededScore?.ref === "posts:post-1" && unreadableScoreResponse.items.length === 0 &&
		scoreDeletes === deletesBeforeReadFailure && scoreWrites === 1 &&
		JSON.stringify(scores.get("posts:post-1")) === JSON.stringify(storedBeforeReadFailure),
);
const firstScoreResponse = await handler("scores")(route({ ref: "posts:post-1" }), context);
const firstScore = firstScoreResponse.items[0];
check(
	"a retry after the read failure returns the preserved stored score",
	firstScore?.ref === "posts:post-1" && firstScore.analysisRevision === storedBeforeReadFailure.analysisRevision &&
		scoreWrites === 1,
);
check(
	"score endpoint exposes versioned admin metadata",
	firstScoreResponse.contractVersion === SEO_ADMIN_CONTRACT_VERSION &&
		firstScoreResponse.engineVersion === SEO_ENGINE_VERSION &&
		firstScoreResponse.scoreVersion === SEO_SCORE_VERSION &&
		!Number.isNaN(Date.parse(firstScoreResponse.generatedAt)),
);
check(
	"single-entry score response is not paginated",
	firstScoreResponse.cursor === undefined && firstScoreResponse.hasMore === false,
);
check("freshly analyzed scores are marked current", firstScore.freshness === "current");
const overviewProfileReads: string[] = [];
const overviewScoreQueries: any[] = [];
let overviewContentReads = 0;
const overviewProfileKey = collectionAnalysisProfileKey("posts");
const overviewWritesBefore = [kvWrites, scoreWrites, scoreDeletes, analysisProfileWrites];
async function sampleOverview(options: { profile?: unknown; unavailable?: boolean; rows?: any[] } = {}) {
	return handler("admin-overview")(route({ limit: 50 }), {
		...context,
		kv: {
			...context.kv,
			getVersioned: async (key: string) => {
				if (key.startsWith("configuration:analysis-profile:v1:")) overviewProfileReads.push(key);
				if (key === collectionAnalysisProfileKey("pages")) return null;
				if (key !== overviewProfileKey) return context.kv.getVersioned(key);
				if (options.unavailable) throw new Error("Profile storage unavailable");
				return Object.hasOwn(options, "profile") ? options.profile : context.kv.getVersioned(key);
			},
		},
		storage: {
			...context.storage,
			scores: {
				...context.storage.scores,
				query: async (query: any) => {
					overviewScoreQueries.push(query);
					return { items: (options.rows ?? [firstScore]).slice(0, query.limit).map((data) => ({ data })), hasMore: false };
				},
			},
		},
		content: {
			...context.content,
			get: async () => { overviewContentReads += 1; throw new Error("Overview must not read entries"); },
			list: async () => { overviewContentReads += 1; throw new Error("Overview must not list entries"); },
		},
	});
}
const savedScoreOverview = await sampleOverview();
check(
	"overview samples a newly saved article score while another collection has no profile",
	savedScoreOverview.summary.sampleSize === 1 && savedScoreOverview.content[0]?.ref === firstScore.ref &&
		savedScoreOverview.summary.averageContentScore === firstScore.score,
);
const shortArticleAnalysis = analyzeSeoContent({
	ref: firstScore.ref, collection: firstScore.collection, entryId: firstScore.entryId,
	slug: firstScore.slug, title: "test", description: "tes",
	url: "https://example.com/posts/test", noindex: false, image: "https://example.com/social.jpg",
	schemaEnabled: true, schemaPreset: "BlogPosting",
	body: "A useful note.", document: [{ _type: "block", style: "normal", children: [{ _type: "span", text: "A useful note." }] }],
	assessmentProfile: firstScore.assessmentProfile,
});
const shortArticleChecks = summarizeSeoChecks(shortArticleAnalysis.checks);
const shortArticleOverview = await sampleOverview({ rows: [{ ...firstScore, ...shortArticleAnalysis }] });
check(
	"overview keeps a short article with scored issues visible without content reads or analysis writes",
	shortArticleChecks.issues === 2 && shortArticleChecks.advisories > 0 &&
		shortArticleOverview.summary.sampleSize === 1 && shortArticleOverview.summary.needsAttention === 1 &&
		shortArticleOverview.summary.averageContentScore === 40 &&
		shortArticleOverview.content[0]?.needsAttention === true &&
		shortArticleOverview.content[0]?.firstIssue.startsWith("Body text length: ") === true &&
		overviewContentReads === 0 && JSON.stringify([kvWrites, scoreWrites, scoreDeletes, analysisProfileWrites]) === JSON.stringify(overviewWritesBefore),
	JSON.stringify({ shortArticleChecks, summary: shortArticleOverview.summary, content: shortArticleOverview.content, overviewContentReads, writes: [kvWrites, scoreWrites, scoreDeletes, analysisProfileWrites], overviewWritesBefore }),
);
for (const [state, profile] of [
	["unconfigured", null],
	["changed", { revision: "r2", value: { version: 1, profile: "general", updatedAt: firstScore.updatedAt } }],
	["unsupported version", { revision: "r2", value: { version: 2, profile: "article", updatedAt: firstScore.updatedAt } }],
	["corrupt", { revision: "r2", value: { version: 1, profile: "unknown", updatedAt: firstScore.updatedAt } }],
] as const) {
	check(`overview excludes scores when their assessment profile is ${state}`, (await sampleOverview({ profile })).summary.sampleSize === 0);
}
check("overview excludes scores when their assessment profile cannot be read", (await sampleOverview({ unavailable: true })).summary.sampleSize === 0);
const sameProfileOverview = await sampleOverview({ profile: {
	revision: "a-new-revision", value: { version: 1, profile: "article", updatedAt: "2026-10-15T12:00:00.000Z" },
} });
check("saving the same assessment purpose preserves overview sample eligibility", sameProfileOverview.summary.sampleSize === 1);
check("overview rejects a stored profile that contradicts its fingerprint", (await sampleOverview({ rows: [{
	...firstScore, assessmentProfile: { version: 1, profile: "general" },
}] })).summary.sampleSize === 0);
overviewProfileReads.length = 0;
overviewScoreQueries.length = 0;
const boundedScoreOverview = await sampleOverview({ rows: Array.from({ length: 100 }, (_, index) => ({
	...firstScore, ref: `posts:sample-${index}`, entryId: `sample-${index}`,
})) });
check(
	"overview preserves the bounded score sample and reads each collection profile once",
	boundedScoreOverview.summary.sampleSize === 50 && overviewScoreQueries.length === 1 &&
		overviewScoreQueries[0].limit === 100 && JSON.stringify(overviewProfileReads) === JSON.stringify([overviewProfileKey]),
);
check(
	"overview sampling reads no content and performs no analysis writes",
	overviewContentReads === 0 && JSON.stringify([kvWrites, scoreWrites, scoreDeletes, analysisProfileWrites]) === JSON.stringify(overviewWritesBefore),
);
const snapshotOnlyScore = await handler("scores")(
	route({ ref: "posts:post-1", storedOnly: true, snapshotOnly: true }), context,
);
const snapshotOnlyItem = snapshotOnlyScore.items[0];
check(
	"snapshot-only scores omit freshness when configuration has not been checked",
	snapshotOnlyItem?.score === firstScore.score &&
		snapshotOnlyItem != null && !("freshness" in snapshotOnlyItem),
);
const writesBeforeStoredRead = scoreWrites;
const contentReadsBeforeStoredRead = contentReads;
let revisionReservationAttempts = 0;
const compareAndSetBeforeStoredRead = context.storage.scoreAnalysisRevisions.compareAndSet;
context.storage.scoreAnalysisRevisions.compareAndSet = async () => {
	revisionReservationAttempts += 1;
	throw new Error("stored score reads must not reserve analysis revisions");
};
scores.set("posts:post-1", {
	...structuredClone(firstScore),
	scoreVersion: Math.max(1, SEO_SCORE_VERSION - 1),
	freshness: undefined,
});
const staleScoreResponse = await handler("scores")(
	route({ collection: "posts", storedOnly: true }),
	context,
);
check(
	"stored-only score reads preserve the last known score after an analyzer upgrade",
	staleScoreResponse.items[0]?.score === firstScore.score &&
		staleScoreResponse.items[0]?.freshness === "stale",
);
check(
	"stored-only score reads never reserve revisions, analyze, or write content",
	scoreWrites === writesBeforeStoredRead &&
		contentReads === contentReadsBeforeStoredRead &&
		revisionReservationAttempts === 0,
);
context.storage.scoreAnalysisRevisions.compareAndSet = compareAndSetBeforeStoredRead;
scores.set("posts:post-1", structuredClone(firstScore));
const templateStorageKey = `configuration:templates:v${SEO_ADMIN_TEMPLATES_STORAGE_VERSION}`;
const nextValues = structuredClone(validValues);
nextValues.posts.title = "Revised {{title}}";
values.set(templateStorageKey, {
	version: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	updatedAt: "2026-07-14T14:00:00.000Z",
	values: nextValues,
});
const readsBeforeTemplateStoredCheck = contentReads;
const writesBeforeTemplateStoredCheck = scoreWrites;
const templateStaleScore = await handler("scores")(
	route({ ref: "posts:post-1", storedOnly: true }), context,
);
check(
	"stored-only scores become stale after a saved template revision",
	templateStaleScore.items[0]?.freshness === "stale" &&
		// Verified against the entry's own saved inputs: one exact read, no writes.
		contentReads === readsBeforeTemplateStoredCheck + 1 &&
		scoreWrites === writesBeforeTemplateStoredCheck,
);
const revisedScoreResponse = await handler("scores")(route({ ref: "posts:post-1" }), context);
const revisedScore = revisedScoreResponse.items[0];
check(
	"score records capture the template revision",
	typeof firstScore.templateUpdatedAt === "string",
);
check("scores capture the module revision", firstScore.modulesUpdatedAt === null);
check("template revisions invalidate cached scores", scoreWrites === 2);
check("recomputed scores use the revised template", revisedScore.title === "Revised A useful post");
check(
	"recomputed scores expose the new template revision",
	revisedScore.templateUpdatedAt === "2026-07-14T14:00:00.000Z",
);
const templateCurrentScore = await handler("scores")(
	route({ ref: "posts:post-1", storedOnly: true }), context,
);
check("stored-only scores become current after template reanalysis", templateCurrentScore.items[0]?.freshness === "current");

const moduleStorageKey = `configuration:modules:v${SEO_ADMIN_MODULES_STORAGE_VERSION}`;
const moduleValues = Object.fromEntries(
	SEO_ADMIN_MODULE_DEFINITIONS.map((definition) => [definition.key, definition.defaultEnabled]),
);
moduleValues.imageSeo = false;
moduleValues.schema = false;
values.set(moduleStorageKey, {
	version: SEO_ADMIN_MODULES_STORAGE_VERSION,
	updatedAt: "2026-07-14T15:00:00.000Z",
	values: moduleValues,
});
const readsBeforeModuleStoredCheck = contentReads;
const writesBeforeModuleStoredCheck = scoreWrites;
const moduleStaleScores = await handler("scores")(
	route({ collection: "posts", storedOnly: true }), context,
);
check(
	"stored-only score pages become stale after a saved module revision",
	moduleStaleScores.items[0]?.freshness === "stale" &&
		// One exact read per verified row with an input identity, no writes.
		contentReads === readsBeforeModuleStoredCheck + moduleStaleScores.items.filter((item: any) => item.inputIdentity).length &&
		scoreWrites === writesBeforeModuleStoredCheck,
);
const moduleRevisedScoreResponse = await handler("scores")(route({ ref: "posts:post-1" }), context);
const moduleRevisedScore = moduleRevisedScoreResponse.items[0];
check("module revisions invalidate cached scores", scoreWrites === 3);
check(
	"recomputed scores expose the new module revision",
	moduleRevisedScore.modulesUpdatedAt === "2026-07-14T15:00:00.000Z",
);
check(
	"disabled Image SEO becomes transparent without hiding its evidence",
	moduleRevisedScore.checks.some(
		(item: any) => item.id === "image-alt-text" && item.status === "review" && item.weight === 0,
	),
);
check(
	"disabled plugin schema falls back to EmDash core structured data in analysis",
	moduleRevisedScore.checks.some(
		(item: any) =>
			item.id === "schema" &&
			item.status === "pass" &&
			String(item.evidence?.actual).includes("BlogPosting"),
	),
);

const initialConfigurationFingerprint = moduleRevisedScore.configurationFingerprint;
const currentSettings = await handler("admin-settings")(route(), context);
const savedSettings = await handler("save-admin-settings")(
	route({
		...currentSettings.values,
		organizationName: "Example Studio Publishing",
		expectedRevision: currentSettings.revision,
		...(currentSettings.revision === null ? { expectedLegacyGuard: currentSettings.legacyGuard } : {}),
	}),
	context,
);
check("analysis settings save succeeds", savedSettings.success === true);
const settingsRevisedScoreResponse = await handler("scores")(
	route({ ref: "posts:post-1" }),
	context,
);
const settingsRevisedScore = settingsRevisedScoreResponse.items[0];
check("analysis settings invalidate cached scores", scoreWrites === 4);
check(
	"analysis settings produce a new configuration fingerprint",
	settingsRevisedScore.configurationFingerprint !== initialConfigurationFingerprint,
);

const schemaPresetValues = Object.fromEntries(
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => [
		definition.key,
		definition.defaultEnabled,
	]),
);
schemaPresetValues.blogPosting = false;
const currentSchemaPresets = await handler("admin-schema-presets")(route(), context);
const savedSchemaPresets = await handler("save-admin-schema-presets")(
	route({ values: schemaPresetValues, expectedRevision: currentSchemaPresets.revision }),
	context,
);
check("schema preset save succeeds", savedSchemaPresets.success === true);
const schemaRevisedScoreResponse = await handler("scores")(route({ ref: "posts:post-1" }), context);
const schemaRevisedScore = schemaRevisedScoreResponse.items[0];
check("schema preset changes invalidate cached scores", scoreWrites === 5);
check(
	"schema preset changes produce a new configuration fingerprint",
	schemaRevisedScore.configurationFingerprint !== settingsRevisedScore.configurationFingerprint,
);

const savedFocusKeyword = await handler("save-focus-keyword")(
	route({
		ref: "posts:post-1",
		keywords: ["  topical   authority  ", "secondary topic", "TOPICAL AUTHORITY"],
	}),
	context,
);
check("focus keyword save succeeds", savedFocusKeyword.success === true);
check(
	"focus keyword profile is normalized, deduplicated, and versioned",
	savedFocusKeyword.success &&
		savedFocusKeyword.profile?.storageVersion === SEO_ADMIN_ANALYSIS_PROFILE_STORAGE_VERSION &&
		savedFocusKeyword.profile.keyword === "topical authority" &&
		JSON.stringify(savedFocusKeyword.profile.keywords) ===
			JSON.stringify(["topical authority", "secondary topic"]),
);
check(
	"focus keyword save refreshes the score",
	savedFocusKeyword.success && savedFocusKeyword.item.keyword === "topical authority",
);
check(
	"content scores expose the complete focus keyword profile",
	savedFocusKeyword.success &&
		JSON.stringify(savedFocusKeyword.item.keywords) ===
			JSON.stringify(["topical authority", "secondary topic"]),
);

await (seoRuntime as any).hooks["content:afterSave"].handler(
	{ collection: "posts", content: { id: "post-1" } },
	context,
);
check(
	"content events retain the saved focus keyword",
	(scores.get("posts:post-1") as any)?.keyword === "topical authority" &&
		(scores.get("posts:post-1") as any)?.keywords?.[1] === "secondary topic",
);

scoreRefreshListCalls.length = 0;
const rejectedUnscopedRefresh = await handler("refresh-scores")(route({}), context);
check(
	"score refresh rejects an omitted collection without reading content",
	rejectedUnscopedRefresh.success === false &&
		rejectedUnscopedRefresh.error === "unsupported_collection" &&
		scoreRefreshListCalls.length === 0,
);

scoreRefreshPagingFixture = true;
scoreRefreshListCalls.length = 0;
// post-1 is already scored and unchanged, so each page processes it and reuses its stored result.
const unchangedRefreshState = () => JSON.stringify([scoreWrites, scores.get("posts:post-1"), [...scoreAnalysisRevisions.entries()]]);
const refreshStateBeforePaging = unchangedRefreshState();
const firstRefreshPage = await handler("refresh-scores")(
	route({ collection: "posts", limit: 1_000 }),
	context,
);
check(
	"score refresh reads one bounded page from one collection",
	firstRefreshPage.success === true &&
	firstRefreshPage.collection === "posts" &&
	firstRefreshPage.processed === 1 &&
		firstRefreshPage.updated === 0 &&
		unchangedRefreshState() === refreshStateBeforePaging &&
		/^sha256-[a-f0-9]{64}$/.test(firstRefreshPage.revision) &&
		firstRefreshPage.hasMore === true &&
		firstRefreshPage.cursor === "posts-page-2" &&
		scoreRefreshListCalls.length === 1 &&
		scoreRefreshListCalls[0]?.collection === "posts" &&
		scoreRefreshListCalls[0]?.limit === 100,
);
scoreRefreshListCalls.length = 0;
const secondRefreshPage = await handler("refresh-scores")(
	route({
		collection: "posts",
		cursor: firstRefreshPage.cursor,
		revision: firstRefreshPage.revision,
		limit: 100,
	}),
	context,
);
check(
	"score refresh advances only with the supplied cursor",
	secondRefreshPage.success === true &&
		secondRefreshPage.processed === 1 &&
		secondRefreshPage.updated === 0 &&
		unchangedRefreshState() === refreshStateBeforePaging &&
		secondRefreshPage.hasMore === false &&
		secondRefreshPage.cursor === null &&
		scoreRefreshListCalls.length === 1 &&
		scoreRefreshListCalls[0]?.cursor === "posts-page-2",
);
// An entry whose template record reads but cannot be decoded stops the page
// instead of being skipped as if the collection were complete.
const templatesBeforeCorruption = values.has(templateStorageKey) ? structuredClone(values.get(templateStorageKey)) : undefined;
values.set(templateStorageKey, { version: SEO_ADMIN_TEMPLATES_STORAGE_VERSION, values: "not templates" });
bumpHarnessRevision(templateStorageKey);
scoreRefreshListCalls.length = 0;
let unreadableRefreshError = "";
try {
	await handler("refresh-scores")(route({ collection: "posts", limit: 100 }), context);
} catch (error: unknown) {
	unreadableRefreshError = String(error);
}
if (templatesBeforeCorruption === undefined) values.delete(templateStorageKey);
else values.set(templateStorageKey, templatesBeforeCorruption);
bumpHarnessRevision(templateStorageKey);
check(
	"score refresh stops when an entry's SEO configuration cannot be read",
	unreadableRefreshError.includes("Score refresh stopped at posts:post-1") &&
		scoreRefreshListCalls.length === 1 &&
		unchangedRefreshState() === refreshStateBeforePaging,
	unreadableRefreshError,
);

scoreRefreshListCalls.length = 0;
const scopedRefreshPage = await handler("refresh-scores")(
	route({ collection: "posts", status: "published", locale: "nl", limit: 25 }),
	context,
);
check(
	"score refresh applies host-supported status and locale filters",
	scopedRefreshPage.success === true &&
		scoreRefreshListCalls.length === 1 &&
		scoreRefreshListCalls[0]?.where?.status === "published" &&
		scoreRefreshListCalls[0]?.where?.locale === "nl" &&
		scoreRefreshListCalls[0]?.limit === 25,
);
scoreRefreshListCalls.length = 0;
let changedScopeRejected = false;
try {
	await handler("refresh-scores")(
		route({ collection: "posts", status: "draft", locale: "nl", cursor: scopedRefreshPage.cursor, revision: scopedRefreshPage.revision, limit: 25 }),
		context,
	);
} catch (error) {
	changedScopeRejected = String(error).includes("configuration changed");
}
check("score refresh rejects a continuation with changed status", changedScopeRejected && scoreRefreshListCalls.length === 0);
let changedCollectionRejected = false;
try {
	await handler("refresh-scores")(
		route({ collection: "pages", status: "published", locale: "nl", cursor: scopedRefreshPage.cursor, revision: scopedRefreshPage.revision, limit: 25 }),
		context,
	);
} catch (error) {
	changedCollectionRejected = String(error).includes("configuration changed");
}
check("score refresh rejects a continuation from another collection", changedCollectionRejected && scoreRefreshListCalls.length === 0);

// A trial keyword is never stored, so a refresh that names one is refused before any read.
scoreRefreshListCalls.length = 0;
const trialRefreshState = () => JSON.stringify([scoreWrites, analysisProfileWrites, [...scoreAnalysisRevisions.entries()]]);
const stateBeforeTrialRefresh = trialRefreshState();
const firstTrialRefresh = await handler("refresh-scores")(
	route({ collection: "posts", limit: 100, keyword: "first keyword" }),
	context,
);
const continuedTrialRefresh = await handler("refresh-scores")(
	route({
		collection: "posts",
		cursor: "posts-page-2",
		revision: firstRefreshPage.revision,
		limit: 100,
		keyword: "second keyword",
	}),
	context,
);
check(
	"score refresh refuses trial keywords before reading or writing",
	[firstTrialRefresh, continuedTrialRefresh].every((result: any) =>
		result.success === false && result.error === "trial_keyword_not_durable" && result.cursor === undefined) &&
		scoreRefreshListCalls.length === 0 &&
		trialRefreshState() === stateBeforeTrialRefresh,
);
scoreRefreshPagingFixture = false;

scoreRefreshListCalls.length = 0;
let missingRevisionRejected = false;
try {
	await handler("refresh-scores")(
		route({ collection: "posts", cursor: "posts-page-2", limit: 100 }),
		context,
	);
} catch (error: unknown) {
	missingRevisionRejected = String(error).includes("revision");
}
check(
	"score refresh rejects a continuation without its scoring revision before reading content",
	missingRevisionRejected && scoreRefreshListCalls.length === 0,
);

scoreRefreshPagingFixture = true;
const staleRevisionStart = await handler("refresh-scores")(
	route({ collection: "posts", limit: 100 }),
	context,
);
scoreRefreshPagingFixture = false;
const templatesBeforeRevisionCheck = Object.fromEntries(
	(
		(await handler("admin-templates")(route(), context)).items as Array<{
			collection: string;
			values: unknown;
		}>
	).map((item) => [item.collection, structuredClone(item.values)]),
) as typeof validValues;
const revisedTemplates = structuredClone(templatesBeforeRevisionCheck);
revisedTemplates.posts.title = "{{title}} | Revised scoring configuration";
await templateCommand("save-admin-templates", context, "posts", revisedTemplates.posts);
scoreRefreshListCalls.length = 0;
const scoreWritesBeforeStaleRevision = scoreWrites;
let staleRevisionRejected = false;
try {
	await handler("refresh-scores")(
		route({
			collection: "posts",
			cursor: staleRevisionStart.cursor,
			revision: staleRevisionStart.revision,
			limit: 100,
		}),
		context,
	);
} catch (error: unknown) {
	staleRevisionRejected = String(error).includes("configuration changed");
}
check(
	"score refresh rejects a stale scoring revision before reading or writing content",
	staleRevisionRejected &&
		scoreRefreshListCalls.length === 0 &&
		scoreWrites === scoreWritesBeforeStaleRevision,
);

const repeatedCursorStart = await handler("refresh-scores")(
	route({ collection: "posts", limit: 100 }),
	context,
);
scoreRefreshRepeatedCursorFixture = true;
scoreRefreshListCalls.length = 0;
const scoreWritesBeforeRepeatedCursor = scoreWrites;
let repeatedCursorRejected = false;
try {
	await handler("refresh-scores")(
		route({
			collection: "posts",
			cursor: "stuck-score-cursor",
			revision: repeatedCursorStart.revision,
			limit: 100,
		}),
		context,
	);
} catch (error: unknown) {
	repeatedCursorRejected = String(error).includes("did not advance");
}
check(
	"score refresh rejects a non-advancing cursor before writing scores",
	repeatedCursorRejected &&
		scoreRefreshListCalls.length === 1 &&
		scoreWrites === scoreWritesBeforeRepeatedCursor,
);
scoreRefreshRepeatedCursorFixture = false;
await templateCommand("save-admin-templates", context, "posts", templatesBeforeRevisionCheck.posts);

scoreRefreshOversizeFixture = true;
scoreRefreshListCalls.length = 0;
const scoreWritesBeforeOversizeRefresh = scoreWrites;
let oversizedRefreshRejected = false;
try {
	await handler("refresh-scores")(route({ collection: "posts", limit: 100 }), context);
} catch (error: unknown) {
	oversizedRefreshRejected = String(error).includes("exceeded the requested limit");
}
check(
	"score refresh rejects an oversized host page before writing scores",
	oversizedRefreshRejected &&
		scoreWrites === scoreWritesBeforeOversizeRefresh &&
		scoreRefreshListCalls.length === 1,
);
scoreRefreshOversizeFixture = false;
check(
	"paged score refresh retains the saved focus keyword",
	(scores.get("posts:post-1") as any)?.keyword === "topical authority" &&
		(scores.get("posts:post-1") as any)?.keywords?.[1] === "secondary topic",
);

const moduleRecordBeforeRevisionRace = structuredClone(values.get(moduleStorageKey)) as any;
let releaseOldModuleRead!: () => void;
const oldModuleReadRelease = new Promise<void>((resolve) => {
	releaseOldModuleRead = resolve;
});
let signalOldModuleRead!: () => void;
const oldModuleReadCaptured = new Promise<void>((resolve) => {
	signalOldModuleRead = resolve;
});
const originalKvGet = context.kv.get;
let captureOldModuleRead = true;
context.kv.get = async (key: string) => {
	const snapshot = await originalKvGet(key);
	if (key === moduleStorageKey && captureOldModuleRead) {
		captureOldModuleRead = false;
		signalOldModuleRead();
		await oldModuleReadRelease;
	}
	return snapshot;
};
// Without a stored score there is no reuse probe, so the older operation reserves
// its revision before the held module read.
scores.delete("posts:post-1");
const oldConfigurationAnalysis = handler("scores")(
	route({ ref: "posts:post-1", refresh: true }),
	context,
);
await oldModuleReadCaptured;
const moduleRecordAfterRevisionRace = structuredClone(moduleRecordBeforeRevisionRace);
moduleRecordAfterRevisionRace.updatedAt = "2026-07-14T15:30:00.000Z";
moduleRecordAfterRevisionRace.values.imageSeo = !moduleRecordAfterRevisionRace.values.imageSeo;
values.set(moduleStorageKey, moduleRecordAfterRevisionRace);
const newConfigurationScore = (
	await handler("scores")(route({ ref: "posts:post-1", refresh: true }), context)
).items[0];
releaseOldModuleRead();
const oldConfigurationResponse = await oldConfigurationAnalysis;
context.kv.get = originalKvGet;
const scoreAfterRevisionRace = scores.get("posts:post-1") as any;
check(
	"an older configuration analysis cannot overwrite a newer completed analysis",
	oldConfigurationResponse.items.length === 0 &&
		newConfigurationScore?.modulesUpdatedAt === moduleRecordAfterRevisionRace.updatedAt &&
		(scoreAnalysisRevisions.get("posts:post-1") as any)?.revision === newConfigurationScore.analysisRevision &&
		scoreAfterRevisionRace.analysisRevision === newConfigurationScore.analysisRevision &&
		scoreAfterRevisionRace.modulesUpdatedAt === moduleRecordAfterRevisionRace.updatedAt &&
		scoreAfterRevisionRace.inputIdentity === newConfigurationScore.inputIdentity &&
		scoreAfterRevisionRace.configurationFingerprint === newConfigurationScore.configurationFingerprint,
);
values.set(moduleStorageKey, moduleRecordBeforeRevisionRace);

const profileWritesBeforeInvalidInput = analysisProfileWrites;
const rejectedLongKeyword = await handler("save-focus-keyword")(
	route({ ref: "posts:post-1", keyword: "x".repeat(SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH + 1) }),
	context,
);
check("overlong focus keywords are rejected", rejectedLongKeyword.error === "keyword_too_long");
check(
	"invalid focus keywords perform no writes",
	analysisProfileWrites === profileWritesBeforeInvalidInput,
);

const rejectedKeywordCount = await handler("save-focus-keyword")(
	route({
		ref: "posts:post-1",
		keywords: Array.from(
			{ length: SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT + 1 },
			(_, index) => `keyword ${index}`,
		),
	}),
	context,
);
check(
	"focus keyword profiles enforce the maximum count",
	rejectedKeywordCount.error === "too_many_keywords",
);
check(
	"over-limit focus keyword profiles perform no writes",
	analysisProfileWrites === profileWritesBeforeInvalidInput,
);

const rejectedRef = await handler("save-focus-keyword")(
	route({ ref: "unknown:missing", keyword: "keyword" }),
	context,
);
check(
	"unsupported focus keyword refs are rejected",
	rejectedRef.error === "unsupported_collection",
);

const clearedFocusKeyword = await handler("save-focus-keyword")(
	route({ ref: "posts:post-1", keywords: [] }),
	context,
);
check(
	"blank focus keywords persist an explicit empty profile",
	clearedFocusKeyword.success &&
		clearedFocusKeyword.profile?.keywords.length === 0 &&
		analysisProfiles.has("posts:post-1") &&
		analysisProfileDeletes === 0,
);
check(
	"an explicit empty profile removes its analyzer keyword",
	clearedFocusKeyword.success && clearedFocusKeyword.item.keyword === undefined,
);

const fallbackScore = await handler("scores")(
	route({ ref: "posts:post-2", refresh: true }),
	context,
);
check(
	"content fields remain the final keyword fallback",
	fallbackScore.items[0]?.keyword === "content fallback",
);
await handler("save-focus-keyword")(
	route({ ref: "posts:post-2", keyword: "saved keyword" }),
	context,
);
const restoredFallback = await handler("save-focus-keyword")(
	route({ ref: "posts:post-2", keyword: "" }),
	context,
);
check(
	"clearing a profile suppresses a stale content-field fallback",
	restoredFallback.success && restoredFallback.item.keyword === undefined,
);

const previewAfterKeywordSave = await handler("admin-entry-preview")(
	route({ ref: "posts:post-1" }),
	context,
);
check(
	"analysis profiles do not alter emitted metadata",
	previewAfterKeywordSave.success &&
		previewAfterKeywordSave.preview.search.title === "Revised A useful post",
);
await handler("save-focus-keyword")(
	route({ ref: "posts:post-1", keyword: "delete cleanup" }),
	context,
);
await handler("save-admin-entry-social")(
	route({ ref: "posts:post-1", title: "Cleanup title", description: "",
		expectedRevision: (await handler("admin-entry-social")(route({ ref: "posts:post-1" }), context)).snapshot.revision }),
	context,
);
await (seoRuntime as any).hooks["content:afterDelete"].handler(
	{ collection: "posts", id: "post-1" },
	context,
);
check(
	"content deletion removes analysis data, score cache, and social exceptions",
	!analysisProfiles.has("posts:post-1") &&
		!scores.has("posts:post-1") &&
		!socialOverrides.has("posts:post-1"),
);

await handler("save-admin-entry-social")(
	route({
		ref: "posts:post-1",
		title: "Share-ready headline",
		description: "Share-ready description",
		expectedRevision: (await handler("admin-entry-social")(route({ ref: "posts:post-1" }), context)).snapshot.revision,
	}),
	context,
);

const metadataPage = {
	url: "https://example.com/blog/useful-post",
	path: "/blog/useful-post",
	locale: "en",
	kind: "content",
	pageType: "article",
	title: "A useful post | Example Studio",
	pageTitle: "A useful post",
	description: "Theme description",
	canonical: "https://example.com/blog/useful-post",
	image: null,
	content: { collection: "posts", id: "post-1", slug: "useful-post" },
	seo: {},
	articleMeta: {},
	siteName: "Example Studio",
	siteUrl: "https://example.com",
};
values.set(moduleStorageKey, {
	version: SEO_ADMIN_MODULES_STORAGE_VERSION,
	updatedAt: "2026-07-14T16:00:00.000Z",
	values: { ...moduleValues, schema: true },
});
seedPagedCustomSchemas();
const metadataPreview = await handler("admin-entry-preview")(
	route({ ref: "posts:post-1" }),
	context,
);
settingsReads.clear();
const contributions = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: metadataPage },
	context,
);
check(
	"public metadata reads saved site settings once per page",
	settingsReads.size === 1 && settingsReads.get(GLOBAL_SETTINGS_KEY) === 1,
	JSON.stringify([...settingsReads]),
);
const legacySettingsReads = new Map<string, number>();
const legacySettingsContext = {
	...context,
	kv: {
		...context.kv,
		get: async (key: string) => {
			if (key.startsWith("settings:")) legacySettingsReads.set(key, (legacySettingsReads.get(key) ?? 0) + 1);
			return key === GLOBAL_SETTINGS_KEY ? null : context.kv.get(key);
		},
		getVersioned: async (key: string) => {
			if (key.startsWith("settings:")) legacySettingsReads.set(key, (legacySettingsReads.get(key) ?? 0) + 1);
			return key === GLOBAL_SETTINGS_KEY ? null : context.kv.getVersioned(key);
		},
	},
};
const legacyContributions = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: metadataPage },
	legacySettingsContext,
);
check(
	"public metadata reads each legacy site setting once per page",
	legacySettingsReads.size === 9 && [...legacySettingsReads.values()].every((count) => count === 1),
	JSON.stringify([...legacySettingsReads]),
);
check(
	"legacy site settings keep the public description",
	legacyContributions.some((item: any) => item.kind === "meta" && item.name === "description" &&
		item.content === contributions.find((item: any) => item.kind === "meta" && item.name === "description")?.content),
);
const descriptionContribution = contributions.find(
	(item: any) => item.kind === "meta" && item.name === "description",
);
const socialTitleContribution = contributions.find(
	(item: any) => item.kind === "property" && item.property === "og:title",
);
const titleContribution = contributions.find((item: any) => item.kind === "title");
check(
	"unsupported document title is left to the theme",
	titleContribution === undefined,
);
check(
	"template preview description matches live metadata without claiming title ownership",
	metadataPreview.success &&
		descriptionContribution?.content === metadataPreview.preview.search.description &&
		titleContribution === undefined,
);
check(
	"live meta description uses the effective resolver",
	descriptionContribution?.content.startsWith("Read A useful description"),
);
check(
	"live Open Graph title uses the social-only override",
	socialTitleContribution?.content === "Share-ready headline",
);
check(
	"live Twitter description uses the same social-only override",
	contributions.find((item: any) => item.kind === "meta" && item.name === "twitter:description")
		?.content === "Share-ready description",
);
check(
	"metadata contributions use core-compatible dedupe keys",
	descriptionContribution && !("key" in descriptionContribution),
);
const localMediaPath = "/_emdash/api/media/file/01JTESTSOCIALIMAGE.png";
const priorGlobalSettings = values.get(GLOBAL_SETTINGS_KEY) as Record<string, unknown>;
values.set(GLOBAL_SETTINGS_KEY, {
	...priorGlobalSettings,
	defaultSocialImage: localMediaPath,
});
const localImageContributions = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: { ...metadataPage, kind: "custom", content: null, image: null } },
	context,
);
check(
	"local library fallback emits an absolute public social image URL",
	localImageContributions.some(
		(item: any) => item.kind === "property" && item.property === "og:image" &&
			item.content === `https://example.com${localMediaPath}`,
	),
);
values.set(GLOBAL_SETTINGS_KEY, {
	...priorGlobalSettings,
	siteUrl: "",
	defaultSocialImage: localMediaPath,
});
const noOriginContributions = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: { ...metadataPage, kind: "custom", content: null, image: null, siteUrl: "" } },
	{ ...context, site: { ...context.site, url: "" } },
);
check(
	"relative social images and card hints are omitted without a public origin",
	!noOriginContributions.some((item: any) =>
		(item.kind === "property" && item.property === "og:image") ||
		(item.kind === "meta" && (item.name === "twitter:image" || item.name === "twitter:card"))),
);
values.set(GLOBAL_SETTINGS_KEY, priorGlobalSettings);
check(
	"public metadata emits a matching custom schema from the second storage page",
	contributions.some(
		(item: any) => item.kind === "jsonld" && item.id === "custom:page-two-product",
	),
);
customSchemas.clear();

for (let index = 0; index < 500; index += 1) {
	customSchemas.set(`unrelated-${index.toString().padStart(3, "0")}`, {
		storageVersion: 1,
		name: `Unrelated schema ${index}`,
		scope: "services",
		json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", name: `Unrelated ${index}` }),
		enabled: false,
		createdAt: "2026-07-18T09:00:00.000Z",
		updatedAt: "2026-07-18T09:00:00.000Z",
	});
}
customSchemas.set("matching-after-global-cap", {
	storageVersion: 1,
	name: "Matching after global cap",
	scope: "posts",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Product", "@id": "{{canonical}}#matching-product", name: "{{title}}" }),
	enabled: true,
	createdAt: "2026-07-18T10:00:00.000Z",
	updatedAt: "2026-07-18T10:00:00.000Z",
});
schemaQueries.length = 0;
const scopedContributions = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: metadataPage },
	context,
);
check(
	"public metadata reads matching schema beyond the global 500-record cap",
	scopedContributions.some((item: any) => item.kind === "jsonld" && item.id === "custom:matching-after-global-cap"),
);
check(
	"public metadata queries only indexed scopes with bounded pages",
	schemaQueries.length > 0 && schemaQueries.length <= 6 && schemaQueries.every((query) =>
		query.limit <= 100 &&
		((query.where as any)?.scope === null ||
			(Array.isArray((query.where as any)?.scope?.in) &&
				(query.where as any).scope.in.includes("posts") &&
				!(query.where as any).scope.in.includes("services")))),
);
customSchemas.clear();

for (const [id, scope] of [["legacy-missing-scope", undefined], ["legacy-blank-scope", ""]] as const) {
	customSchemas.set(id, {
		storageVersion: 1,
		name: id,
		...(scope === undefined ? {} : { scope }),
		json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": `{{canonical}}#${id}`, name: id }),
		enabled: true,
		createdAt: "2026-07-18T10:00:00.000Z",
		updatedAt: "2026-07-18T10:00:00.000Z",
	});
}
const legacyScopeContributions = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: metadataPage },
	context,
);
check(
	"public metadata preserves global output from legacy schemas without a scope",
	["legacy-missing-scope", "legacy-blank-scope"].every((id) =>
		legacyScopeContributions.some((item: any) => item.kind === "jsonld" && item.id === `custom:${id}`)),
);
customSchemas.clear();

let malformedPageReads = 0;
const malformedSchemaContext = {
	...context,
	storage: {
		...context.storage,
		schemas: {
			...context.storage.schemas,
			query: async ({ cursor }: any = {}) => {
				malformedPageReads += 1;
				if (malformedPageReads > 6) throw new Error("Schema query exceeded its page budget");
				return {
					items: Array.from({ length: 100 }, () => ({ id: "", data: { scope: "posts" } })),
					hasMore: true,
					cursor: String(Number(cursor ?? "0") + 1),
				};
			},
		},
	},
};
const malformedSchemaContributions = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: metadataPage },
	malformedSchemaContext,
);
check(
	"malformed schema rows cannot extend public metadata reads beyond the page budget",
	malformedPageReads <= 6 && malformedSchemaContributions.some((item: any) =>
		item.kind === "meta" && item.name === "description"),
);

const clearedSocial = await handler("save-admin-entry-social")(
	route({ ref: "posts:post-1", title: "", description: "",
		expectedRevision: (await handler("admin-entry-social")(route({ ref: "posts:post-1" }), context)).snapshot.revision }),
	context,
);
const clearedSocialPreview = await handler("admin-entry-preview")(route({ ref: "posts:post-1" }), context);
check(
	"clearing both social fields restores inherited metadata and deletes canonical storage",
	clearedSocial.success && clearedSocial.snapshot.override === null &&
		clearedSocial.snapshot.revision === null && clearedSocialPreview.success &&
		clearedSocialPreview.preview.social.title === "Social: A useful post" &&
		!socialOverrides.has("posts:post-1"),
);

const resetTemplates = await templateCommand("reset-admin-templates", context, "posts");
check("a template override can be restored to its inherited values", resetTemplates.success === true && resetTemplates.outcome === "saved");
check(
	"restoring an override keeps the record without that collection",
	values.has(templateStorageKey) && !("posts" in (values.get(templateStorageKey) as any).values),
);
check(
	"restored templates expose the legacy title",
	resetTemplates.templates.items.find((item: any) => item.collection === "posts")?.values.title ===
		"{{title}} | Legacy",
);
check(
	"restored templates are labeled as inherited older values",
	resetTemplates.templates.items.find((item: any) => item.collection === "posts")?.source === "legacy",
);
const resetAgain = await templateCommand("reset-admin-templates", context, "posts");
check("resetting an inheriting collection writes nothing", resetAgain.outcome === "unchanged");

contentItems.set("pages:about", {
	id: "about",
	slug: "about",
	data: {
		title: "About the studio",
		excerpt: "How the studio approaches search, content, and technical quality for its clients.",
		content: "The studio works on search, content, and technical quality for its clients.",
	},
	seo: null,
	createdAt: "2026-07-15T09:00:00.000Z",
	updatedAt: "2026-07-15T10:00:00.000Z",
	publishedAt: "2026-07-15T10:00:00.000Z",
});
const scopedTemplates = await handler("admin-templates")(route(), context);
const scopedTemplateValues = Object.fromEntries(
	scopedTemplates.items.map((item: any) => [item.collection, structuredClone(item.values)]),
);
const postBeforeScopedSave = await handler("scores")(route({ ref: "posts:post-1" }), context);
const pageBeforeScopedSave = await handler("scores")(route({ ref: "pages:about" }), context);
check(
	"both collections start with current scores",
	postBeforeScopedSave.items[0]?.freshness === "current" &&
		pageBeforeScopedSave.items[0]?.freshness === "current",
);
const postsOnlyTemplateValues = structuredClone(scopedTemplateValues);
postsOnlyTemplateValues.posts.title = "Posts only {{title}}";
const postsOnlyTemplateSave = await templateCommand("save-admin-templates", context, "posts", postsOnlyTemplateValues.posts);
check("a template change for one collection saves", postsOnlyTemplateSave.success === true);
const pageAfterScopedSave = await handler("scores")(route({ ref: "pages:about", storedOnly: true }), context);
const postAfterScopedSave = await handler("scores")(route({ ref: "posts:post-1", storedOnly: true }), context);
check(
	"changing one collection's template keeps other collections' scores current",
	pageAfterScopedSave.items[0]?.freshness === "current",
);
check(
	"changing one collection's template marks that collection's scores stale",
	postAfterScopedSave.items[0]?.freshness === "stale",
);

// A record written before per-collection tokens: every collection uses updatedAt.
values.set(templateStorageKey, {
	version: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	updatedAt: "2026-07-01T00:00:00.000Z",
	values: structuredClone(scopedTemplateValues),
});
bumpHarnessRevision(templateStorageKey);
await handler("scores")(route({ ref: "posts:post-1" }), context);
await handler("scores")(route({ ref: "pages:about" }), context);
const legacyRecordSave = await templateCommand("save-admin-templates", context, "posts", postsOnlyTemplateValues.posts);
const pageAfterLegacyRecordSave = await handler("scores")(route({ ref: "pages:about", storedOnly: true }), context);
const postAfterLegacyRecordSave = await handler("scores")(route({ ref: "posts:post-1", storedOnly: true }), context);
const legacyRecordAfterSave = values.get(templateStorageKey) as any;
check(
	"a record saved before per-collection tokens keeps unchanged collections current",
	legacyRecordSave.success === true &&
		pageAfterLegacyRecordSave.items[0]?.freshness === "current" &&
		postAfterLegacyRecordSave.items[0]?.freshness === "stale",
);
check(
	"an older record keeps its global fallback and gains no fallback field",
	legacyRecordAfterSave.updatedAt === "2026-07-01T00:00:00.000Z" &&
		!Object.hasOwn(legacyRecordAfterSave, "fallbackScoreRevision") &&
		Object.keys(legacyRecordAfterSave.collectionUpdatedAt).join(",") === "posts",
);

await handler("scores")(route({ ref: "posts:post-1" }), context);
const scopedReset = await templateCommand("reset-admin-templates", context, "posts");
check("a reset after a one-collection change succeeds", scopedReset.success === true);
const pageAfterScopedReset = await handler("scores")(route({ ref: "pages:about", storedOnly: true }), context);
const postAfterScopedReset = await handler("scores")(route({ ref: "posts:post-1", storedOnly: true }), context);
check(
	"a reset keeps scores current for collections it does not change",
	pageAfterScopedReset.items[0]?.freshness === "current",
);
check(
	"a reset marks the collection it changes stale",
	postAfterScopedReset.items[0]?.freshness === "stale",
);
const pageAfterResetSave = await templateCommand("save-admin-templates", context, "pages", scopedTemplateValues.pages);
const pageAfterResetResave = await handler("scores")(route({ ref: "pages:about", storedOnly: true }), context);
check(
	"saving unchanged values after a reset writes nothing and keeps scores current",
	pageAfterResetSave.outcome === "unchanged" && pageAfterResetResave.items[0]?.freshness === "current",
);

// Removing an override equal to its inherited value changes ownership, not the token.
const pagesInherited = (await handler("admin-templates")(route(), context)).items.find((item: any) => item.collection === "pages");
values.set(templateStorageKey, {
	...(values.get(templateStorageKey) as any),
	values: { ...(values.get(templateStorageKey) as any).values, pages: structuredClone(pagesInherited.inherited.values) },
});
bumpHarnessRevision(templateStorageKey);
const tokenBeforeEqualReset = (values.get(templateStorageKey) as any).collectionUpdatedAt?.pages ?? "fallback";
const equalReset = await templateCommand("reset-admin-templates", context, "pages");
const recordAfterEqualReset = values.get(templateStorageKey) as any;
check(
	"removing an override equal to inheritance changes ownership and keeps its token",
	equalReset.outcome === "saved" && !("pages" in recordAfterEqualReset.values) &&
		(recordAfterEqualReset.collectionUpdatedAt?.pages ?? "fallback") === tokenBeforeEqualReset,
);

const refreshBeforeResetCycle = await handler("refresh-scores")(route({ collection: "posts", limit: 1 }), context);
await templateCommand("save-admin-templates", context, "posts", postsOnlyTemplateValues.posts);
await templateCommand("reset-admin-templates", context, "posts");
const refreshAfterResetCycle = await handler("refresh-scores")(route({ collection: "posts", limit: 1 }), context);
check(
	"a save and reset that return to the same values still start a new refresh revision",
	refreshBeforeResetCycle.success === true &&
		refreshAfterResetCycle.success === true &&
		refreshBeforeResetCycle.revision !== refreshAfterResetCycle.revision,
);

const RealDate = Date;
const frozenTime = RealDate.now();
globalThis.Date = class extends RealDate {
	constructor(...args: unknown[]) {
		super(...((args.length ? args : [frozenTime]) as [number]));
	}
	static now() {
		return frozenTime;
	}
} as DateConstructor;
try {
	await templateCommand("save-admin-templates", context, "posts", postsOnlyTemplateValues.posts);
	await handler("scores")(route({ ref: "posts:post-1" }), context);
	await templateCommand("reset-admin-templates", context, "posts");
	const postAfterSameMillisecondReset = await handler("scores")(route({ ref: "posts:post-1", storedOnly: true }), context);
	check(
		"a reset in the same millisecond as the save still marks the changed collection stale",
		postAfterSameMillisecondReset.items[0]?.freshness === "stale",
	);
} finally {
	globalThis.Date = RealDate;
}

const articleRulesBeforeMapping = await handler("scores")(route({ ref: "posts:post-1", refresh: true }), context);
const postsAsPlainContent = await handler("save-admin-schema-content-types")(
	route({ values: { posts: "none" }, expectedRevision: null }),
	context,
);
const postAfterMapping = await handler("scores")(route({ ref: "posts:post-1", storedOnly: true }), context);
const articleRulesAfterMapping = await handler("scores")(route({ ref: "posts:post-1", refresh: true }), context);
const featuredImageWeight = (result: any) =>
	result.items[0]?.checks.find((item: any) => item.id === "featured-image")?.weight;
check(
	"schema mappings do not change the independently selected article analysis profile",
	postsAsPlainContent.success === true &&
		articleRulesBeforeMapping.items[0]?.assessmentProfile.profile === "article" &&
		featuredImageWeight(articleRulesBeforeMapping) === 0 &&
		postAfterMapping.items[0]?.freshness === "stale" &&
		featuredImageWeight(articleRulesAfterMapping) === 0 &&
		articleRulesAfterMapping.items[0]?.assessmentProfile.profile === "article",
);
const mappingReset = await handler("reset-admin-schema-content-types")(
	route({ expectedRevision: postsAsPlainContent.contentTypes?.revision, confirmed: true }),
	context,
);
check("a confirmed reset with the loaded revision restores the defaults", mappingReset.success === true);
contentItems.set("posts:cover-post", {
	...structuredClone(contentItems.get("posts:post-1")),
	id: "cover-post",
	slug: "cover-post",
	data: {
		...Object.fromEntries(
			Object.entries(structuredClone(contentItems.get("posts:post-1")?.data ?? {})).filter(
				([key]) => !["featured_image", "image", "logo", "ogImage"].includes(key),
			),
		),
		coverImage: "https://example.com/cover.jpg",
	},
});
const coverScore = await handler("scores")(route({ ref: "posts:cover-post", refresh: true }), context);
check(
	"an article's cover image counts as its featured image",
	coverScore.items[0]?.checks.find((item: any) => item.id === "featured-image")?.status === "pass",
);
contentItems.delete("posts:cover-post");

const storyBody = [
	{ _type: "block", style: "h2", children: [{ _type: "span", text: "Story heading" }] },
	{
		_type: "block",
		style: "normal",
		children: [
			{ _type: "span", text: "A custom rich-text field describes the service in enough detail for search previews. " },
			{ _type: "span", text: "Read the missing guide", marks: ["guide"] },
		],
		markDefs: [{ _key: "guide", _type: "link", href: "/missing-story-guide" }],
	},
];
const storyItem = {
	id: "story-1",
	type: "stories",
	slug: "story-1",
	status: "published",
	data: { title: "Custom story", story: storyBody },
	seo: null,
	createdAt: "2026-07-14T09:00:00.000Z",
	updatedAt: "2026-07-14T10:00:00.000Z",
	publishedAt: "2026-07-14T10:00:00.000Z",
};
let storyDiscoveryCalls = 0;
const storyContext = {
	...context,
	schema: {
		listCollections: async () => {
			storyDiscoveryCalls += 1;
			return [{
				slug: "stories", label: "Stories", labelSingular: "Story", hasSeo: true,
				urlPattern: "/stories/{slug}", routable: true, hidden: false,
				fields: [
					{ slug: "title", type: "string" },
					{ slug: "story", type: "portableText" },
				],
			}];
		},
	},
	content: {
		...context.content,
		get: async (collection: string, id: string) =>
			collection === "stories" && id === storyItem.id ? structuredClone(storyItem) : null,
		getPublicUrl: async (collection: string, id: string) =>
			collection === "stories" && id === storyItem.id
				? "https://example.com/stories/story-1"
				: null,
		list: async (collection: string) => ({
			items: collection === "stories" ? [structuredClone(storyItem)] : [],
			cursor: undefined,
			hasMore: false,
		}),
	},
};
const storyPage = {
	...metadataPage,
	url: "https://example.com/stories/story-1",
	path: "/stories/story-1",
	pageType: "page",
	title: "Custom story",
	pageTitle: "Custom story",
	description: "Theme fallback",
	canonical: "https://example.com/stories/story-1",
	content: { collection: "stories", id: storyItem.id, slug: storyItem.slug },
};
const storyMetadata = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: storyPage }, storyContext,
);
check(
	"single custom portable-text field supplies the public description fallback",
	storyMetadata.some((item: any) => item.kind === "meta" && item.name === "description" &&
		item.content.includes("A custom rich-text field describes the service")),
);
const storyAnalysis = await handler("analyze-content")(
	route({ collection: "stories", id: storyItem.id, persist: false }), storyContext,
);
check(
	"single custom portable-text field supplies analyzer body signals",
	storyAnalysis.success && storyAnalysis.item?.metrics.wordCount >= 15 &&
		storyAnalysis.item?.metrics.headingCount === 1 &&
		storyAnalysis.item?.metrics.internalLinkCount === 1,
	JSON.stringify({ success: storyAnalysis.success, metrics: storyAnalysis.item?.metrics }),
);
const storyCrawl = await handler("admin-crawl-diagnostics")(route(), storyContext);
check(
	"single custom portable-text field supplies crawl links",
	storyCrawl.unresolvedLinks?.some((item: any) => item.targetPath === "/missing-story-guide"),
);
check("body discovery reuses the collection schema read", storyDiscoveryCalls === 1);

const formattedDescriptionCases = [
	{
		name: "Portable Text inline formatting preserves words",
		body: [{ _type: "block", children: [
			{ _type: "span", text: "Dent" }, { _type: "span", text: "al", marks: ["strong"] },
			{ _type: "span", text: " implants" },
		] }],
		expected: "Dental implants",
	},
	{
		name: "Portable Text line breaks separate words",
		body: [{ _type: "block", children: [
			{ _type: "span", text: "Dental" }, { _type: "span", text: "\nimplants" },
		] }],
		expected: "Dental implants",
	},
	{
		name: "Tiptap inline text and hard breaks preserve words",
		body: { type: "doc", content: [{ type: "paragraph", content: [
			{ type: "text", text: "Dent" }, { type: "text", text: "al", marks: [{ type: "bold" }] },
			{ type: "hardBreak" }, { type: "text", text: "implants" },
		] }] },
		expected: "Dental implants",
	},
	{
		name: "separate blocks stay separate",
		body: [{ _type: "block", children: [{ _type: "span", text: "Dental" }] },
			{ _type: "block", children: [{ _type: "span", text: "implants" }] }],
		expected: "Dental implants",
	},
	{
		name: "node attributes and protocol metadata stay out of descriptions",
		body: { type: "doc", attrs: { label: "Attribute-only text", protocol: "tool-output" },
			content: [{ type: "paragraph", attrs: { title: "Attribute only", href: "https://attribute.invalid" },
				content: [{ type: "text", text: "Dental implants" }] },
			{ type: "protocol-result", attrs: { text: "Private tool text", command: "not prose" } }] },
		expected: "Dental implants",
	},
	{
		name: "explicit excerpt retains precedence over formatted body",
		body: [{ _type: "block", children: [{ _type: "span", text: "Dent" }, { _type: "span", text: "al" }] }],
		data: { excerpt: "Explicit excerpt", summary: "Summary", description: "Description" },
		expected: "Explicit excerpt",
	},
	{
		name: "summary retains precedence over description and body",
		body: "Body fallback",
		data: { excerpt: " ", summary: "Summary", description: "Description" },
		expected: "Summary",
	},
	{
		name: "explicit description retains precedence over body",
		body: "Body fallback",
		data: { description: "Explicit description" },
		expected: "Explicit description",
	},
	{
		name: "generated body excerpt retains its 180 character bound",
		body: [{ _type: "block", children: [{ _type: "span", text: "a".repeat(220) }] }],
		expected: "a".repeat(179) + "…",
	},
	{
		name: "180 code point excerpt keeps its final supplementary character",
		body: "i".repeat(179) + "\u{1f600}",
		expected: "i".repeat(179) + "\u{1f600}",
	},
	{
		name: "181 code point excerpt keeps the existing ellipsis bound",
		body: "i".repeat(180) + "\u{1f600}",
		expected: "i".repeat(179) + "…",
	},
	{
		name: "shortened excerpt never splits a supplementary character",
		body: "i".repeat(178) + "\u{1f600}" + "xx",
		expected: "i".repeat(178) + "\u{1f600}" + "…",
	},
	{
		name: "explicit metadata is not silently shortened to an excerpt",
		body: "Body fallback",
		data: { excerpt: "x".repeat(220) },
		expected: "x".repeat(220),
	},
] satisfies Array<{ name: string; body: unknown; expected: string; data?: Record<string, string> }>;
for (const test of formattedDescriptionCases) {
	const item = { ...structuredClone(storyItem), data: { title: "Custom story", story: test.body, ...test.data } };
	const localContext = {
		...storyContext,
		content: { ...storyContext.content, get: async () => structuredClone(item) },
	};
	const preview = await handler("admin-entry-preview")(route({ ref: "stories:story-1" }), localContext);
	if (test === formattedDescriptionCases[0]) {
		const analyzed = await handler("analyze-content")(
			route({ collection: "stories", id: storyItem.id, keyword: "Dental implants", persist: false }), localContext,
		);
		const keywordDescription = analyzed.item?.checks.find((value: any) => value.id === "keyword-description");
		check("generated description supplies the same intact phrase to analysis",
			analyzed.success && keywordDescription?.status === "pass",
			JSON.stringify({ success: analyzed.success, check: keywordDescription }));
	}
	const metadata = await (seoRuntime as any).hooks["page:metadata"].handler({ page: storyPage }, localContext);
	const description = metadata.find((value: any) => value.kind === "meta" && value.name === "description")?.content;
	check(test.name, preview.success && preview.preview.search.description === test.expected && description === test.expected,
		JSON.stringify({ success: preview.success, preview: preview.preview?.search.description, public: description, expected: test.expected }));
}

const preferredContentContext = {
	...storyContext,
	content: {
		...storyContext.content,
		get: async () => ({
			...structuredClone(storyItem),
			data: { ...structuredClone(storyItem.data), content: "The primary content field wins." },
		}),
	},
};
const preferredContentMetadata = await (seoRuntime as any).hooks["page:metadata"].handler(
	{ page: storyPage }, preferredContentContext,
);
check(
	"content field remains the preferred public description source",
	preferredContentMetadata.some((item: any) => item.kind === "meta" &&
		item.name === "description" && item.content === "The primary content field wins."),
);

const ambiguousStoryContext = {
	...storyContext,
	schema: {
		listCollections: async () => [{
			slug: "stories", label: "Stories", labelSingular: "Story", hasSeo: true,
			urlPattern: "/stories/{slug}", routable: true, hidden: false,
			fields: [
				{ slug: "story", type: "portableText" },
				{ slug: "appendix", type: "portableText" },
			],
		}],
	},
};
const ambiguousStoryAnalysis = await handler("analyze-content")(
	route({ collection: "stories", id: storyItem.id, persist: false }), ambiguousStoryContext,
);
check(
	"multiple portable-text fields do not guess an analyzer body",
	ambiguousStoryAnalysis.success && ambiguousStoryAnalysis.item?.metrics.wordCount === 0,
);

const draftRaw = {
	id: "revision-score-entry",
	type: "posts",
	slug: "live-slug",
	status: "published",
	locale: "en",
	data: { title: "Live title", excerpt: "Live description", content: "Live article content." },
	seo: null,
	createdAt: "2026-07-14T09:00:00.000Z",
	updatedAt: "2026-07-14T10:00:00.000Z",
	publishedAt: "2026-07-14T10:00:00.000Z",
	liveRevisionId: "live-revision",
	draftRevisionId: "draft-revision-1" as string | null,
	version: 2,
};
const draftRevisions = new Map([
	["draft-revision-1", { id: "draft-revision-1", collection: "posts", entryId: draftRaw.id,
		data: { title: "First draft title", excerpt: "First draft description", _slug: "first-draft-slug" } }],
	["draft-revision-2", { id: "draft-revision-2", collection: "posts", entryId: draftRaw.id,
		data: { title: "Second draft title", excerpt: "Second draft description", _slug: "second-draft-slug" } }],
	["draft-revision-3", { id: "draft-revision-3", collection: "posts", entryId: draftRaw.id,
		data: { title: "Manual draft title", excerpt: "Manual draft description", _slug: "manual-draft-slug" } }],
]);
let releaseFirstDraft!: () => void;
let signalFirstDraftRead!: () => void;
const firstDraftGate = new Promise<void>((resolve) => { releaseFirstDraft = resolve; });
const firstDraftRead = new Promise<void>((resolve) => { signalFirstDraftRead = resolve; });
const revisionScoreContext = {
	...context,
	content: {
		...context.content,
		get: async (collection: string, id: string) =>
			collection === "posts" && id === draftRaw.id ? structuredClone(draftRaw) : null,
		getRevision: async (collection: string, id: string, revisionId: string) => {
			if (collection !== "posts" || id !== draftRaw.id) return null;
			if (revisionId === "draft-revision-1") {
				signalFirstDraftRead();
				await firstDraftGate;
			}
			return structuredClone(draftRevisions.get(revisionId) ?? null);
		},
		getPublicUrl: async () => "https://example.com/blog/live-slug",
		list: async (collection: string) => ({
			items: collection === "posts" ? [structuredClone(draftRaw)] : [],
			cursor: undefined,
			hasMore: false,
		}),
	},
};
const firstDraftEvent = { collection: "posts", content: {
	...structuredClone(draftRaw),
	data: { ...draftRaw.data, ...draftRevisions.get("draft-revision-1")!.data, _slug: undefined },
} };
const firstDraftHook = (seoRuntime as any).hooks["content:afterSave"].handler(firstDraftEvent, revisionScoreContext);
await firstDraftRead;
draftRaw.draftRevisionId = "draft-revision-2";
const secondDraftEvent = { collection: "posts", content: {
	...structuredClone(draftRaw),
	data: { ...draftRaw.data, ...draftRevisions.get("draft-revision-2")!.data, _slug: undefined },
} };
await (seoRuntime as any).hooks["content:afterSave"].handler(secondDraftEvent, revisionScoreContext);
releaseFirstDraft();
await firstDraftHook;
const newestHookScore = scores.get(`posts:${draftRaw.id}`) as any;
check(
	"out-of-order draft saves keep the newest saved revision score",
	newestHookScore?.title.includes("Second draft title") &&
		newestHookScore?.slug === "second-draft-slug" &&
		newestHookScore?.sourceVersion === savedContentVersion(draftRaw),
);
const writesBeforeStaleDraftHook = scoreWrites;
await (seoRuntime as any).hooks["content:afterSave"].handler(firstDraftEvent, revisionScoreContext);
check("stale draft hooks cannot overwrite a newer draft", scoreWrites === writesBeforeStaleDraftHook);

draftRaw.draftRevisionId = "draft-revision-3";
const manualDraftRefresh = await handler("refresh-scores")(
	route({ collection: "posts", limit: 1 }), revisionScoreContext,
);
const manualDraftScore = scores.get(`posts:${draftRaw.id}`) as any;
check(
	"manual score refresh analyzes the exact saved draft and staged slug",
	manualDraftRefresh.success && manualDraftRefresh.processed === 1 && manualDraftRefresh.updated === 1 &&
	manualDraftScore?.title.includes("Manual draft title") &&
	manualDraftScore?.slug === "manual-draft-slug" &&
	manualDraftScore?.sourceVersion === savedContentVersion(draftRaw),
);
const writesBeforeUnsupportedDraft = scoreWrites;
let unsupportedDraftRejected = false;
try {
	await handler("refresh-scores")(
		route({ collection: "posts", limit: 1 }),
		{ ...revisionScoreContext, content: { ...revisionScoreContext.content, getRevision: undefined } },
	);
} catch (error) {
	unsupportedDraftRejected = String(error).includes("revision read access");
}
check(
	"manual score refresh refuses a draft without revision read access",
	unsupportedDraftRejected && scoreWrites === writesBeforeUnsupportedDraft,
);
draftRaw.draftRevisionId = null;
draftRaw.version = 3;
draftRaw.status = "scheduled";
await (seoRuntime as any).hooks["content:afterSchedule"].handler(
	{ collection: "posts", content: structuredClone(draftRaw) }, revisionScoreContext,
);
const scheduledScore = scores.get(`posts:${draftRaw.id}`) as any;
check(
	"content state changes refresh the score at the saved revision",
	scheduledScore?.title.includes("Live title") &&
		scheduledScore?.sourceVersion === savedContentVersion(draftRaw) &&
		scheduledScore?.sourceVersion !== manualDraftScore.sourceVersion,
);

if (failures) {
	console.error(`\n${failures} SEO template self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nALL SEO TEMPLATE CHECKS PASSED");
}
