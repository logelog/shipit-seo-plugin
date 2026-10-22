import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";

import {
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
} from "./admin-contract.ts";
import { composeSeoSchema, defaultSeoSchemaComposerInput } from "./schema-composer.ts";
import seoRuntime from "./sandbox-entry.ts";

const organizationId = "https://example.com/#organization";
const mediaLogo = "/_emdash/api/media/file/01JLOGO.png";

const values = new Map<string, unknown>([
	["settings:siteName", "Example Studio"],
	["settings:siteUrl", "https://example.com"],
	["settings:orgName", "Example Studio BV"],
	["settings:orgLogo", mediaLogo],
	["settings:noindex", false],
]);
const metaOverrides = new Map<string, unknown>();
const customSchemas = new Map<string, unknown>();
const contentItems = new Map<string, any>([
	["services:service-1", {
		id: "service-1",
		slug: "seo",
		status: "published",
		data: { title: "SEO service", excerpt: "Search engine optimisation for growing teams." },
		seo: null,
		updatedAt: "2026-09-01T10:00:00.000Z",
		publishedAt: "2026-09-01T10:00:00.000Z",
	}],
	["posts:post-1", {
		id: "post-1",
		slug: "schema-graphs",
		status: "published",
		data: { title: "Schema graphs", excerpt: "How linked entities keep a graph consistent." },
		seo: null,
		updatedAt: "2026-09-02T10:00:00.000Z",
		publishedAt: "2026-09-02T10:00:00.000Z",
	}],
]);

// Host KV semantics: every write issues a new revision; a null expected
// revision creates only when the key is absent.
const revisions = new Map<string, string>();
let revisionCounter = 0;
let failNextKvWrite: "before" | "after" | null = null;
function bumpRevision(key: string): string {
	const revision = `r${++revisionCounter}`;
	revisions.set(key, revision);
	return revision;
}
function revisionOf(key: string): string | null {
	if (!values.has(key)) return null;
	return revisions.get(key) ?? bumpRevision(key);
}
function injectedKvFailure(commit: () => void): void {
	const mode = failNextKvWrite;
	failNextKvWrite = null;
	if (mode === "before") throw new Error("connection reset before commit");
	commit();
	if (mode === "after") throw new Error("connection reset after commit");
}

function mapStore(map: Map<string, unknown>) {
	const rowRevisions = new Map<string, string>();
	let rowCounter = 0;
	const current = (id: string) => map.has(id) ? rowRevisions.get(id) ?? `seed:${id}` : null;
	const put = async (id: string, value: unknown) => {
		map.set(id, structuredClone(value));
		const revision = `row-${++rowCounter}`;
		rowRevisions.set(id, revision);
		return revision;
	};
	return {
		get: async (id: string) => structuredClone(map.get(id) ?? null),
		put,
		delete: async (id: string) => { rowRevisions.delete(id); return map.delete(id); },
		getVersioned: async (id: string) => {
			const revision = current(id);
			return revision === null ? null : { value: structuredClone(map.get(id)), revision };
		},
		compareAndSet: async (id: string, expected: string | null, value: unknown) => {
			if (current(id) !== expected) return { applied: false };
			return { applied: true, revision: await put(id, value) };
		},
		compareAndDelete: async (id: string, expected: string) => {
			if (current(id) !== expected) return { applied: false };
			map.delete(id); rowRevisions.delete(id);
			return { applied: true };
		},
	};
}

const context = {
	plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
	site: { name: "Example Studio", url: "https://example.com", locale: "en" },
	schema: { listCollections: async () => [
		{ slug: "services", label: "Services", hasSeo: true, routable: true, urlPattern: "/services/{slug}" },
		{ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/blog/{slug}" },
	] },
	kv: {
		get: async (key: string) => structuredClone(values.get(key) ?? null),
		set: async (key: string, value: unknown) => {
			values.set(key, structuredClone(value));
			bumpRevision(key);
		},
		delete: async (key: string) => {
			revisions.delete(key);
			return values.delete(key);
		},
		list: async () => [],
		getVersioned: async (key: string) => {
			const revision = revisionOf(key);
			return revision === null ? null : { value: structuredClone(values.get(key)), revision };
		},
		compareAndSet: async (key: string, expectedRevision: string | null, value: unknown) => {
			if (revisionOf(key) !== expectedRevision) return { applied: false as const };
			let revision = "";
			injectedKvFailure(() => {
				values.set(key, structuredClone(value));
				revision = bumpRevision(key);
			});
			return { applied: true as const, revision };
		},
		compareAndDelete: async (key: string, expectedRevision: string) => {
			if (revisionOf(key) !== expectedRevision) return { applied: false };
			injectedKvFailure(() => {
				values.delete(key);
				revisions.delete(key);
			});
			return { applied: true };
		},
	},
	storage: {
		overrides: mapStore(new Map()),
		socialOverrides: mapStore(new Map()),
		metaOverrides: mapStore(metaOverrides),
		schemas: {
			...mapStore(customSchemas),
			count: async () => customSchemas.size,
			query: async () => ({
				items: [...customSchemas.entries()].map(([id, data]) => ({ id, data: structuredClone(data) })),
				hasMore: false,
				cursor: undefined,
			}),
		},
	},
	content: {
		getPublicUrl: async (collection: string, id: string) => {
			const item = contentItems.get(`${collection}:${id}`);
			if (!item) return null;
			const prefix =
				({ posts: "blog", services: "services", articles: "articles", offerings: "offerings", pages: "pages" } as Record<string, string>)[
					collection
				] ?? null;
			return prefix ? `https://example.com/${prefix}/${encodeURIComponent(item.slug)}` : null;
		},
		get: async (collection: string, id: string) =>
			structuredClone(contentItems.get(`${collection}:${id}`) ?? null),
		list: async (collection: string) => ({
			items: [...contentItems.entries()]
				.filter(([key]) => key.startsWith(`${collection}:`))
				.map(([, item]) => structuredClone(item)),
			hasMore: false,
			cursor: undefined,
		}),
	},
	url: (path: string) => new URL(path, "https://example.com").href,
	log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
};

function pageFor(collection: string, id: string, slug: string, path: string, pageType: string): PublicPageContext {
	return {
		url: `https://example.com${path}`,
		path,
		locale: "en",
		kind: "content",
		pageType,
		title: slug,
		pageTitle: slug,
		description: "",
		canonical: `https://example.com${path}`,
		image: null,
		content: { collection, id, slug },
		seo: {},
		siteName: "Example Studio",
		siteUrl: "https://example.com",
	} as PublicPageContext;
}

const entries = [
	{ ref: "services:service-1", page: pageFor("services", "service-1", "seo", "/services/seo", "content"), owner: "Service" },
	{ ref: "posts:post-1", page: pageFor("posts", "post-1", "schema-graphs", "/blog/schema-graphs", "article"), owner: "BlogPosting" },
];

async function liveGraphs(page: PublicPageContext): Promise<Array<{ id: string; graph: any }>> {
	const contributions = await (seoRuntime as any).hooks["page:metadata"].handler({ page }, context);
	return contributions.filter((item: any) => item.kind === "jsonld");
}

async function previewGraphs(ref: string): Promise<any[]> {
	const result = await (seoRuntime as any).routes["entry-schema-preview"].handler({ input: { ref } }, context);
	assert.equal(result.success, true, `${ref} preview resolves`);
	return result.items;
}

function organizationReferences(value: unknown): number {
	if (Array.isArray(value)) return value.reduce((total: number, item) => total + organizationReferences(item), 0);
	if (!value || typeof value !== "object") return 0;
	const node = value as Record<string, unknown>;
	const own = node["@id"] === organizationId && Object.keys(node).every((key) => key === "@id") ? 1 : 0;
	return own + Object.values(node).reduce((total: number, item) => total + organizationReferences(item), 0);
}

function ownerOf(graphs: readonly { graph: any }[], type: string): Record<string, unknown> | undefined {
	const graph = graphs.find((item) => item.graph?.["@type"] === type)?.graph;
	return graph?.publisher ?? graph?.provider;
}

for (const entry of entries) {
	metaOverrides.clear();
	const linked = await liveGraphs(entry.page);
	const organization = linked.find((item) => item.id === "preset:organization")?.graph;
	assert.ok(organization, `${entry.ref} emits the site Organization by default`);
	assert.equal(organization.logo, `https://example.com${mediaLogo}`, `${entry.ref} emits an absolute media logo`);
	assert.deepEqual(ownerOf(linked, entry.owner), { "@id": organizationId }, `${entry.ref} links ${entry.owner} to it`);

	metaOverrides.set(entry.ref, {
		storageVersion: SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
		ref: entry.ref,
		robots: { nofollow: false, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false },
		disabledPresets: ["organization"],
		updatedAt: "2026-09-03T10:00:00.000Z",
	});
	const live = await liveGraphs(entry.page);
	assert.equal(live.some((item) => item.id === "preset:organization"), false, `${entry.ref} omits the disabled Organization`);
	assert.equal(organizationReferences(live.map((item) => item.graph)), 0, `${entry.ref} live metadata has no dangling Organization reference`);
	assert.equal(ownerOf(live, entry.owner)?.name, "Example Studio BV", `${entry.ref} names the ${entry.owner} organization inline`);

	const preview = await previewGraphs(entry.ref);
	const organizationRow = preview.find((item) => item.presetKey === "organization");
	assert.equal(organizationRow?.disabled, true, `${entry.ref} preview keeps the disabled Organization row`);
	assert.equal(organizationRow?.emitted, false);
	const emitted = preview.filter((item) => item.emitted);
	assert.equal(organizationReferences(emitted.map((item) => item.graph)), 0, `${entry.ref} preview has no dangling Organization reference`);
	assert.equal(ownerOf(emitted, entry.owner)?.name, "Example Studio BV", `${entry.ref} preview names the ${entry.owner} organization inline`);
}

const course = composeSeoSchema({
	...defaultSeoSchemaComposerInput("course"),
	scope: "services:service-1",
});
assert.equal(course.success, true, "a Course composer graph can be saved");
if (course.success) {
	customSchemas.set("course-1", {
		storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		name: "Course",
		scope: course.output.scope,
		json: course.output.json,
		enabled: true,
		createdAt: "2026-09-03T10:00:00.000Z",
		updatedAt: "2026-09-03T10:00:00.000Z",
	});
}
const service = entries[0];
metaOverrides.clear();
const customLinked = await liveGraphs(service.page);
const linkedCourse = customLinked.find((item) => item.id === "custom:course-1")?.graph;
assert.deepEqual(linkedCourse?.provider, { "@id": organizationId }, "composer output links to the canonical Organization id");
assert.deepEqual(
	(await previewGraphs(service.ref)).find((item) => item.id === "custom:course-1")?.graph.provider,
	{ "@id": organizationId },
	"preview resolves the same composer Organization link",
);

metaOverrides.set(service.ref, {
	storageVersion: SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
	ref: service.ref,
	robots: { nofollow: false, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false },
	disabledPresets: ["organization"],
	updatedAt: "2026-09-03T10:00:00.000Z",
});
const customUnlinked = await liveGraphs(service.page);
const inlineCourse = customUnlinked.find((item) => item.id === "custom:course-1")?.graph;
assert.equal(inlineCourse?.provider?.name, "Example Studio BV", "composer uses an inline provider when Organization is disabled on the entry");
assert.equal(inlineCourse?.provider?.["@id"], undefined);
const previewInlineCourse = (await previewGraphs(service.ref)).find((item) => item.id === "custom:course-1")?.graph;
assert.equal(previewInlineCourse?.provider?.name, "Example Studio BV", "preview uses the same inline provider");
assert.equal(previewInlineCourse?.provider?.["@id"], undefined);

metaOverrides.clear();
values.set("preset:organization", false);
const globallyUnlinked = await liveGraphs(service.page);
assert.equal(
	globallyUnlinked.find((item) => item.id === "custom:course-1")?.graph.provider?.name,
	"Example Studio BV",
	"composer uses an inline provider when Organization is globally off",
);

values.set("preset:organization", true);
values.set("preset:webPage", true);
const post = entries[1];
const postWithWebPage = await liveGraphs(post.page);
assert.deepEqual(
	postWithWebPage.find((item) => item.id === "primary")?.graph.mainEntityOfPage,
	{ "@id": "https://example.com/blog/schema-graphs#webpage" },
	"live BlogPosting links to the enabled WebPage preset",
);
values.set("preset:webPage", false);
const postWithoutWebPage = await liveGraphs(post.page);
assert.equal(
	postWithoutWebPage.find((item) => item.id === "primary")?.graph.mainEntityOfPage,
	post.page.canonical,
	"live BlogPosting uses the canonical URL when WebPage is off",
);
values.set("preset:webPage", true);
values.set("preset:website", false);
const serviceWithoutWebsite = await liveGraphs(service.page);
assert.equal(
	serviceWithoutWebsite.find((item) => item.id === "preset:webPage")?.graph.isPartOf,
	undefined,
	"live WebPage omits isPartOf when WebSite is off",
);

values.set("settings:global:v1", {
	version: 1,
	updatedAt: "2026-09-04T10:00:00.000Z",
	siteName: "Example Studio",
	siteUrl: "https://example.com",
	publisherType: "person",
	personName: "Ada Publisher",
	organizationName: "Example Studio BV",
	organizationLogo: mediaLogo,
	socialProfiles: ["https://social.example/company"],
	personProfiles: ["https://social.example/ada"],
	defaultSocialImage: "",
	twitterHandle: "",
	noindex: false,
});
const personId = "https://example.com/#person";
for (const entry of entries) {
	const live = await liveGraphs(entry.page);
	const publisher = live.find((item) => item.id === "preset:organization")?.graph;
	assert.equal(publisher?.["@type"], "Person", `${entry.ref} emits the selected publisher type`);
	assert.equal(publisher?.["@id"], personId, `${entry.ref} gives Person a stable identity`);
	assert.deepEqual(publisher?.sameAs, ["https://social.example/ada"], `${entry.ref} excludes the Organization profiles`);
	assert.deepEqual(ownerOf(live, entry.owner), { "@id": personId }, `${entry.ref} links to Person`);
	const preview = await previewGraphs(entry.ref);
	assert.equal(preview.find((item) => item.presetKey === "organization")?.graph["@type"], "Person");
	assert.deepEqual(ownerOf(preview.filter((item) => item.emitted), entry.owner), { "@id": personId });
}
const personCustom = (await liveGraphs(service.page)).find((item) => item.id === "custom:course-1")?.graph;
assert.deepEqual(personCustom?.provider, { "@id": personId }, "saved custom schema link follows the selected Person");

metaOverrides.set(service.ref, {
	storageVersion: SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
	ref: service.ref,
	robots: { nofollow: false, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false },
	disabledPresets: ["organization"],
	updatedAt: "2026-09-04T10:00:00.000Z",
});
const personDisabled = await liveGraphs(service.page);
assert.equal(personDisabled.some((item) => item.id === "preset:organization"), false);
assert.deepEqual(ownerOf(personDisabled, service.owner), { "@type": "Person", name: "Ada Publisher" });
assert.equal(personDisabled.find((item) => item.id === "custom:course-1")?.graph.provider?.["@id"], undefined);

const originalSchema = context.schema;
context.schema = { listCollections: async () => [
	{ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/blog/{slug}" },
] };
const postsOnly = await (seoRuntime as any).routes["admin-configuration"].handler({ input: {} }, context);
assert.equal(postsOnly.schema.presets.items.find((item: any) => item.key === "service")?.enabled, true);
assert.equal(postsOnly.schema.presets.items.find((item: any) => item.key === "service")?.applicable, false,
	"Service is not counted as active when discovery confirms the collection is absent");
context.schema = { listCollections: async () => { throw new Error("Discovery unavailable"); } };
const unknownCollections = await (seoRuntime as any).routes["admin-configuration"].handler({ input: {} }, context);
assert.equal(unknownCollections.schema.presets.items.find((item: any) => item.key === "service")?.applicable, undefined,
	"a failed collection lookup does not claim Service is absent");
context.schema = originalSchema;

const contentTypesKey = "configuration:schema-content-types:v1";
const routeHandler = (name: string) => (seoRuntime as any).routes[name].handler;
const saveRoles = (rolesInput: Record<string, string>, expectedRevision: string | null, extra: Record<string, unknown> = {}) =>
	routeHandler("save-admin-schema-content-types")({ input: { values: rolesInput, expectedRevision, ...extra } }, context);
const resetRoles = (expectedRevision: string) =>
	routeHandler("reset-admin-schema-content-types")({ input: { expectedRevision, confirmed: true } }, context);
const readRoles = (input: Record<string, unknown> = {}) => routeHandler("admin-schema-content-types")({ input }, context);
const storedRevision = () => revisionOf(contentTypesKey);

for (const route of ["admin-schema-content-types", "save-admin-schema-content-types", "reset-admin-schema-content-types"]) {
	assert.equal((seoRuntime as any).routes[route].permission, "plugins:manage", `${route} declares the Admin-only boundary`);
}

contentItems.set("articles:article-1", {
	id: "article-1",
	slug: "field-notes",
	status: "published",
	data: { title: "Field notes", excerpt: "Notes from the field." },
	seo: null,
	updatedAt: "2026-09-05T10:00:00.000Z",
	publishedAt: "2026-09-05T10:00:00.000Z",
});
contentItems.set("offerings:offering-1", {
	id: "offering-1",
	slug: "audits",
	status: "published",
	data: { title: "Audits", excerpt: "Technical audits." },
	seo: null,
	updatedAt: "2026-09-05T10:00:00.000Z",
	publishedAt: "2026-09-05T10:00:00.000Z",
});
contentItems.set("pages:page-1", {
	id: "page-1",
	slug: "about",
	status: "published",
	data: { title: "About the studio", excerpt: "Who we are." },
	seo: null,
	updatedAt: "2026-09-05T10:00:00.000Z",
	publishedAt: "2026-09-05T10:00:00.000Z",
});
const mappedCollections: any[] = [
	{ slug: "services", label: "Services", hasSeo: true, routable: true, urlPattern: "/services/{slug}" },
	{ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/blog/{slug}" },
	{ slug: "articles", label: "Articles", hasSeo: true, routable: true, urlPattern: "/articles/{slug}" },
	{ slug: "offerings", label: "Offerings", hasSeo: true, routable: true, urlPattern: "/offerings/{slug}" },
	// EmDash's metadata fields are off here; JSON-LD from page:metadata does not depend on them.
	{ slug: "pages", label: "Pages", hasSeo: false, routable: true, urlPattern: "/pages/{slug}" },
	{ slug: "internal", label: "Internal", hasSeo: true, routable: true, hidden: true },
	{ slug: "fragments", label: "Fragments", hasSeo: true, routable: false },
];
context.schema = { listCollections: async () => mappedCollections };
metaOverrides.clear();
const articleEntry = pageFor("articles", "article-1", "field-notes", "/articles/field-notes", "content");
const offeringEntry = pageFor("offerings", "offering-1", "audits", "/offerings/audits", "content");
const pageEntry = pageFor("pages", "page-1", "about", "/pages/about", "website");
const hasType = (graphs: readonly { graph: any }[], type: string) => graphs.some((item) => item.graph?.["@type"] === type);
const countType = (graphs: readonly { graph: any }[], type: string) => graphs.filter((item) => item.graph?.["@type"] === type).length;

assert.equal(hasType(await liveGraphs(articleEntry), "BlogPosting"), false, "an unmapped collection emits no BlogPosting");
assert.equal(hasType(await liveGraphs(offeringEntry), "Service"), false, "an unmapped collection emits no Service");
const defaults = await routeHandler("admin-configuration")({ input: {} }, context);
assert.equal(defaults.schema.contentTypes.discoveryAvailable, true);
assert.deepEqual(
	[defaults.schema.contentTypes.record, defaults.schema.contentTypes.revision, defaults.schema.contentTypes.writable],
	["absent", null, true],
);
assert.deepEqual(
	defaults.schema.contentTypes.items.map((item: any) => [item.collection, item.role, item.source]),
	[
		["services", "service", "default"],
		["posts", "blogPosting", "default"],
		["articles", "none", "default"],
		["offerings", "none", "default"],
		["pages", "none", "default"],
	],
	"routable, listed content types are offered whether or not EmDash metadata fields are on",
);
assert.equal(defaults.schema.contentTypes.discoveredCount, 5, "hidden and non-routable content types are not offered");

const unknownCollection = await saveRoles({ archive: "blogPosting" }, null);
assert.equal(unknownCollection.error, "invalid", "a content type the site does not list is rejected");
assert.ok(unknownCollection.errors.archive);
const unknownRole = await saveRoles({ articles: "recipe" }, null);
assert.equal(unknownRole.error, "invalid", "an unsupported role is rejected");
assert.ok(unknownRole.errors.articles);
assert.equal(values.has(contentTypesKey), false, "rejected mappings are not stored");

const saved = await saveRoles({ articles: "blogPosting", offerings: "service", posts: "none", services: "service" }, null);
assert.equal(saved.success, true, "a mapping for discovered content types is saved");
assert.deepEqual(
	(values.get(contentTypesKey) as any)?.values,
	{ articles: "blogPosting", offerings: "service", posts: "none" },
	"default roles are not stored",
);
assert.equal(saved.contentTypes.revision, storedRevision(), "the saved configuration carries the stored revision");
assert.deepEqual(
	saved.contentTypes.items.map((item: any) => [item.collection, item.role, item.source]),
	[
		["services", "service", "default"],
		["posts", "none", "saved"],
		["articles", "blogPosting", "saved"],
		["offerings", "service", "saved"],
		["pages", "none", "default"],
	],
);

const stale = await saveRoles({ articles: "none" }, null);
assert.equal(stale.error, "conflict", "a save loaded before the record existed does not replace it");
assert.equal(stale.current?.revision, saved.contentTypes.revision, "a conflict returns the stored revision for review");
assert.equal((values.get(contentTypesKey) as any)?.values.articles, "blogPosting");
const elsewhere = structuredClone(values.get(contentTypesKey)) as any;
elsewhere.updatedAt = "2026-09-06T10:00:00.000Z";
await context.kv.set(contentTypesKey, elsewhere);
const overwritten = await saveRoles({ articles: "none" }, saved.contentTypes.revision);
assert.equal(overwritten.error, "conflict", "another session's write is not replaced");
assert.equal((values.get(contentTypesKey) as any)?.updatedAt, "2026-09-06T10:00:00.000Z");

const liveArticle = await liveGraphs(articleEntry);
assert.equal(hasType(liveArticle, "BlogPosting"), true, "a collection mapped to Blog posting emits BlogPosting");
assert.deepEqual(ownerOf(liveArticle, "BlogPosting"), { "@id": personId }, "mapped BlogPosting links to the publisher");
const previewArticle = (await previewGraphs("articles:article-1")).filter((item) => item.emitted);
assert.equal(hasType(previewArticle, "BlogPosting"), true, "the entry preview matches live BlogPosting output");
assert.equal(hasType(await liveGraphs(offeringEntry), "Service"), true, "a collection mapped to Service emits Service");
assert.equal(
	hasType((await previewGraphs("offerings:offering-1")).filter((item) => item.emitted), "Service"),
	true,
	"the entry preview matches live Service output",
);
assert.equal(hasType(await liveGraphs(post.page), "BlogPosting"), false, "posts mapped to no type-specific schema stop emitting");
assert.equal(hasType(await liveGraphs(service.page), "Service"), true, "services keep their default role");
const mappedConfiguration = await routeHandler("admin-configuration")({ input: {} }, context);
assert.equal(
	mappedConfiguration.schema.presets.items.find((item: any) => item.key === "blogPosting")?.applicable,
	true,
	"Blog posting is applicable through the mapped collection",
);

// Web page claims the main graph without the global WebPage switch.
values.set("preset:website", true);
values.set("preset:webPage", false);
const loaded = await readRoles();
const webPageSaved = await saveRoles({ pages: "webPage" }, loaded.contentTypes.revision);
assert.equal(webPageSaved.success, true, "a page content type can be mapped to Web page");
assert.equal((values.get(contentTypesKey) as any)?.values.posts, "none", "saving one type keeps the others");
const pagePrimary = await liveGraphs(pageEntry);
assert.equal(countType(pagePrimary, "WebPage"), 1, "Web page emits exactly one WebPage");
assert.equal(pagePrimary.find((item) => item.id === "primary")?.graph["@type"], "WebPage", "the WebPage claims primary");
assert.equal(pagePrimary.find((item) => item.graph?.["@type"] === "WebSite")?.id, "preset:website", "WebSite keeps a separate contribution");
assert.deepEqual(
	pagePrimary.find((item) => item.id === "primary")?.graph.isPartOf,
	{ "@id": "https://example.com/#website" },
	"the WebPage belongs to the WebSite",
);
values.set("preset:webPage", true);
assert.equal(countType(await liveGraphs(pageEntry), "WebPage"), 1, "the global WebPage switch adds no second WebPage");
assert.equal(countType(await liveGraphs(articleEntry), "WebPage"), 1, "the global switch still adds WebPage to other types");
assert.equal(
	(await liveGraphs(articleEntry)).find((item) => item.graph?.["@type"] === "WebPage")?.id,
	"preset:webPage",
);
values.set("preset:webPage", false);
const pagePreview = await previewGraphs("pages:page-1");
assert.deepEqual(
	pagePreview.filter((item) => item.emitted).map((item) => item.graph?.["@type"]).sort(),
	pagePrimary.map((item) => item.graph?.["@type"]).sort(),
	"the entry preview lists the live Web page graphs",
);
assert.equal(pagePreview.find((item) => item.presetKey === "webPage")?.replacesCore, true);
metaOverrides.set("pages:page-1", {
	storageVersion: SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
	ref: "pages:page-1",
	robots: { nofollow: false, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false },
	disabledPresets: ["webPage"],
	updatedAt: "2026-09-06T10:00:00.000Z",
});
const pageSuppressed = await liveGraphs(pageEntry);
assert.equal(hasType(pageSuppressed, "WebPage"), false, "an entry can still turn off its WebPage");
assert.equal(pageSuppressed.find((item) => item.id === "primary")?.graph["@type"], "WebSite", "WebSite takes primary back");
assert.equal(
	(await previewGraphs("pages:page-1")).find((item) => item.presetKey === "webPage")?.replacesCore,
	false,
	"a turned-off WebPage is not reported as the main graph",
);
metaOverrides.clear();
const loadedModules = (await routeHandler("admin-configuration")({ input: {} }, context)).modules;
const moduleValues = Object.fromEntries(loadedModules.items.map((item: any) => [item.key, item.enabled]));
const schemaOff = await routeHandler("save-admin-modules")({ input: { ...moduleValues, schema: false, expectedRevision: loadedModules.revision } }, context);
assert.equal(schemaOff.success, true);
assert.equal((await liveGraphs(pageEntry)).length, 0, "schema output off removes the Web page default");
assert.equal((await routeHandler("save-admin-modules")({ input: { ...moduleValues, expectedRevision: schemaOff.modules.revision } }, context)).success, true);

// A write whose outcome is unknown is settled by reading the record, never by repeating it.
const beforeUnconfirmed = await readRoles();
failNextKvWrite = "after";
const unconfirmed = await saveRoles({ articles: "none" }, beforeUnconfirmed.contentTypes.revision);
assert.equal(unconfirmed.error, "unconfirmed", "a thrown write is unconfirmed, not failed");
const appliedCheck = await readRoles({
	expectedRevision: beforeUnconfirmed.contentTypes.revision,
	check: { action: "save", values: { articles: "none" } },
});
assert.equal(appliedCheck.check, "applied", "the check finds the committed save");
failNextKvWrite = "before";
const notStored = await saveRoles({ articles: "blogPosting" }, appliedCheck.contentTypes.revision);
assert.equal(notStored.error, "unconfirmed");
const notAppliedCheck = await readRoles({
	expectedRevision: appliedCheck.contentTypes.revision,
	check: { action: "save", values: { articles: "blogPosting" } },
});
assert.equal(notAppliedCheck.check, "not_applied", "an unchanged record shows the save was not stored");
await context.kv.set(contentTypesKey, { ...(values.get(contentTypesKey) as any), updatedAt: "2026-09-07T10:00:00.000Z" });
const changedCheck = await readRoles({
	expectedRevision: appliedCheck.contentTypes.revision,
	check: { action: "save", values: { articles: "blogPosting" } },
});
assert.equal(changedCheck.check, "changed", "a record changed elsewhere is reported for review");

// An unreadable record is reported, fails closed publicly and is replaced only on request.
values.set(contentTypesKey, { version: 1, updatedAt: "2026-09-08T10:00:00.000Z", values: { articles: "recipe" } });
bumpRevision(contentTypesKey);
const invalid = await readRoles();
assert.equal(invalid.contentTypes.record, "invalid", "a malformed record is reported, not treated as absent");
assert.equal(hasType(await liveGraphs(post.page), "BlogPosting"), false, "an unreadable mapping does not fall back to defaults");
assert.equal(hasType(await liveGraphs(service.page), "Service"), false);
assert.equal(
	(await liveGraphs(pageEntry)).some((item) => item.id === "primary"),
	false,
	"an unreadable mapping leaves the main graph to EmDash",
);
assert.equal(hasType((await previewGraphs("posts:post-1")).filter((item) => item.emitted), "BlogPosting"), false,
	"the entry preview fails closed with the live output");
const blindReplace = await saveRoles({ pages: "webPage" }, invalid.contentTypes.revision);
assert.equal(blindReplace.error, "invalid_stored", "an unreadable record is not overwritten without confirmation");
assert.deepEqual((values.get(contentTypesKey) as any).values, { articles: "recipe" });
await assert.rejects(
	Promise.resolve(routeHandler("admin-portability-export")({ input: {} }, context)).then((result: any) => {
		if (result?.success === false) throw new Error(String(result.error));
		return result;
	}),
	/content type schema mapping/,
	"export refuses while the mapping is unreadable",
);
values.set(contentTypesKey, null);
bumpRevision(contentTypesKey);
const storedNull = await readRoles();
assert.equal(storedNull.contentTypes.record, "invalid", "a stored JSON null is invalid, not absent");
assert.equal(hasType(await liveGraphs(post.page), "BlogPosting"), false, "public output treats a stored null as unreadable");
// With no listed types, repairing sends an empty replacement. Its check compares
// the exact intended record, so a different mapping saved meanwhile is not "saved".
context.schema = { listCollections: async () => [] };
const emptyRepair = await readRoles();
assert.equal(emptyRepair.contentTypes.record, "invalid");
await context.kv.set(contentTypesKey, { version: 1, updatedAt: "2026-09-09T10:00:00.000Z", values: { pages: "service" } });
const elsewhereRepair = await readRoles({
	expectedRevision: emptyRepair.contentTypes.revision,
	check: { action: "save", values: {}, replaceInvalid: true },
});
assert.equal(elsewhereRepair.check, "changed", "an empty replacement is not reported saved over a different mapping");
assert.equal(
	(await readRoles({ expectedRevision: emptyRepair.contentTypes.revision, check: { action: "save", values: {} } })).check,
	"changed",
	"an empty ordinary save never counts as applied",
);
await context.kv.set(contentTypesKey, { version: 1, updatedAt: "2026-09-09T11:00:00.000Z", values: {} });
assert.equal(
	(await readRoles({ expectedRevision: emptyRepair.contentTypes.revision, check: { action: "save", values: {}, replaceInvalid: true } })).check,
	"applied",
	"the exact intended replacement is recognised",
);
assert.equal(
	(await readRoles({ check: { action: "save", values: { pages: "recipe" } } })).check,
	"changed",
	"a check with an unsupported role is never applied",
);
context.schema = { listCollections: async () => mappedCollections };
values.set(contentTypesKey, null);
bumpRevision(contentTypesKey);
const storedNullAgain = await readRoles();
const replaced = await saveRoles({ pages: "webPage" }, storedNullAgain.contentTypes.revision, { replaceInvalid: true });
assert.equal(replaced.success, true, "an unreadable record is replaced on request");
assert.deepEqual((values.get(contentTypesKey) as any).values, { pages: "webPage" });

context.schema = { listCollections: async () => { throw new Error("Discovery unavailable"); } };
const blind = await saveRoles({ articles: "none" }, replaced.contentTypes.revision);
assert.equal(blind.error, "unavailable", "a mapping is not saved when content types cannot be listed");
const blindConfiguration = await routeHandler("admin-configuration")({ input: {} }, context);
assert.equal(blindConfiguration.schema.contentTypes.discoveryAvailable, false);
assert.deepEqual(blindConfiguration.schema.contentTypes.items, []);
assert.deepEqual(
	blindConfiguration.schema.contentTypes.unlisted,
	[{ collection: "pages", role: "webPage" }],
	"the saved mapping that still applies is listed when content types cannot be listed",
);
assert.equal(hasType(await liveGraphs(pageEntry), "WebPage"), true, "the saved mapping keeps applying live");

const many: any[] = Array.from({ length: 101 }, (_, index) => ({ slug: `type-${String(index).padStart(3, "0")}`, label: `Type ${index}`, routable: true }));
context.schema = { listCollections: async () => many };
const overflow = await readRoles();
assert.equal(overflow.contentTypes.items.length, 100, "at most 100 content types are listed");
assert.equal(overflow.contentTypes.discoveredCount, 101, "the configuration says more exist instead of slicing silently");
assert.deepEqual(overflow.contentTypes.unlisted, [{ collection: "pages", role: "webPage" }]);
context.schema = { listCollections: async () => mappedCollections };

const resetStale = await resetRoles("r0");
assert.equal(resetStale.error, "conflict", "a reset of a version that is no longer stored is refused");
assert.equal(values.has(contentTypesKey), true);
const resetUnconfirmed = await readRoles();
failNextKvWrite = "after";
assert.equal((await resetRoles(resetUnconfirmed.contentTypes.revision)).error, "unconfirmed");
assert.equal(
	(await readRoles({ expectedRevision: resetUnconfirmed.contentTypes.revision, check: { action: "reset" } })).check,
	"applied",
	"the check finds the committed reset",
);
assert.equal(values.has(contentTypesKey), false, "reset removes the stored mapping");
assert.equal(hasType(await liveGraphs(articleEntry), "BlogPosting"), false, "reset returns the collection to its default role");
assert.equal(hasType(await liveGraphs(post.page), "BlogPosting"), true, "reset restores the posts default");
assert.equal(hasType(await liveGraphs(pageEntry), "WebPage"), false, "pages return to no type-specific schema");

// EmDash marks content pages "article" unless the theme says otherwise, and fills
// an unclaimed "primary" slot with its own BlogPosting.
values.set("preset:website", true);
await saveRoles({ articles: "blogPosting", offerings: "service", posts: "none" }, null);
const hostDefault = (page: PublicPageContext): PublicPageContext => ({ ...page, pageType: "article" });
const primaryType = (graphs: readonly { id: string; graph: any }[]) =>
	graphs.find((item) => item.id === "primary")?.graph?.["@type"];
const liveTypes = async (page: PublicPageContext) =>
	(await liveGraphs(hostDefault(page))).map((item) => item.graph?.["@type"]).sort();
const previewTypes = async (ref: string) =>
	(await previewGraphs(ref)).filter((item) => item.emitted).map((item) => item.graph?.["@type"]).sort();
const entryPreviewTypes = async (ref: string) =>
	(await routeHandler("admin-entry-preview")({ input: { ref } }, context)).preview.schemaTypes as string[];
for (const [page, ref, primary] of [
	[articleEntry, "articles:article-1", "BlogPosting"],
	[post.page, "posts:post-1", "WebSite"],
	[offeringEntry, "offerings:offering-1", "WebSite"],
] as const) {
	assert.equal(primaryType(await liveGraphs(hostDefault(page))), primary, `${ref} claims primary with ${primary}`);
	assert.deepEqual(await previewTypes(ref), await liveTypes(page), `${ref} preview lists the live graphs`);
}
assert.equal(hasType(await liveGraphs(hostDefault(post.page)), "BlogPosting"), false,
	"posts mapped to no type-specific schema leave no slot for the EmDash BlogPosting");
assert.equal((await entryPreviewTypes("posts:post-1")).includes("BlogPosting"), false);
values.set("preset:website", false);
assert.equal(primaryType(await liveGraphs(hostDefault(post.page))), undefined,
	"with WebSite off nothing claims primary on an unmapped content page");
assert.equal((await entryPreviewTypes("posts:post-1")).includes("BlogPosting"), true,
	"the entry preview reports the EmDash BlogPosting that fills the unclaimed slot");
values.set("preset:website", true);
await resetRoles((await readRoles()).contentTypes.revision);
context.schema = originalSchema;

console.log("SEO schema preset runtime self-check passed.");
