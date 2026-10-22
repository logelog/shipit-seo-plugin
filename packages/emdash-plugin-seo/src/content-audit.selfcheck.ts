import assert from "node:assert/strict";
import seoRuntime from "./sandbox-entry.ts";
import { contentAuditRefs, runContentAudit } from "./content-audit.ts";
import { persistScoreWithHistory } from "./score-history.ts";
import { METADATA_TEMPLATES_KEY, LEGACY_TEMPLATE_REVISIONS_KEY } from "./metadata-templates.ts";
import { readAdminTemplates, readCollectionTemplateToken, templateRevisionFor } from "./entry-analysis-runtime.ts";
import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import { parseSeoAdminEntryPreviewResult } from "./admin-ui/contract.ts";
import { SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION } from "./admin-contract.ts";
import { GLOBAL_SETTINGS_KEY } from "./settings-runtime.ts";
import { defaultSettingsValues } from "./settings-state.ts";
import { collectionAnalysisProfileKey } from "./collection-analysis-profile.ts";

const configuredValues = new Map<string, unknown>([
	[GLOBAL_SETTINGS_KEY, {
		...defaultSettingsValues({ siteName: "Test site", siteUrl: "https://example.com" }),
		version: 1, updatedAt: "2026-10-15T00:00:00.000Z",
		contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1,
	}],
	[collectionAnalysisProfileKey("posts"), {
		version: 1, profile: "article", updatedAt: "2026-10-15T00:00:00.000Z",
	}],
]);

let writes = 0;
let schemaQueries = 0;
let lists = 0;
const rejectWrite = () => { writes += 1; throw new Error("Unexpected write"); };
const store = {
	get: async () => null,
	query: async (options: any) => {
		// The entry's scopes plus legacy rows with an empty or missing scope, under one cap.
		assert.ok(
			[JSON.stringify({ scope: { in: ["global", "posts", "posts:one", "posts:short-post", ""] } }), JSON.stringify({ scope: null })]
				.includes(JSON.stringify(options.where)),
			`unexpected custom schema read ${JSON.stringify(options.where)}`,
		);
		assert.equal(options.limit, 101);
		assert.equal(options.cursor, undefined);
		schemaQueries += 1;
		return { items: [], hasMore: false };
	},
	count: async () => 0,
	put: rejectWrite,
	delete: rejectWrite,
	deleteMany: rejectWrite,
};
const post = {
	id: "one", type: "posts", slug: "short-post", status: "published", locale: "en",
	seo: { title: "Short post", description: "", noIndex: false },
	data: { title: "Short post", content: [{ _type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text: "A short example.", marks: [] }] }] },
	updatedAt: "2026-09-09T10:00:00.000Z",
};
let current = structuredClone(post);
let reads = 0;
const context: any = {
	plugin: { id: "shipit-seo", version: "test" },
	site: { name: "Test site", url: "https://example.com" },
	schema: { listCollections: async () => [{
		slug: "posts", label: "Posts", labelSingular: "Post", hasSeo: true,
		urlPattern: "/blog/{slug}", routable: true, hidden: false,
	}] },
	kv: {
		get: async (key: string) => structuredClone(configuredValues.get(key) ?? null),
		getVersioned: async (key: string) => configuredValues.has(key)
			? { value: structuredClone(configuredValues.get(key)), revision: "r1" } : null,
		list: async () => [], set: rejectWrite, delete: rejectWrite,
	},
	storage: new Proxy({}, { get: () => store }),
	content: {
		getPublicUrl: async (_collection: string, id: string) => id === "one"
			? `https://example.com/blog/${encodeURIComponent(current.slug)}` : null,
		get: async (_collection: string, id: string) => {
			reads += 1;
			if (id === "broken") throw new Error("Private storage details");
			return id === "one" ? structuredClone(current) : null;
		},
		list: async (collection: string, options: any) => {
			lists += 1;
			assert.equal(collection, "posts");
			assert.equal(options.limit, 25);
			return { items: [structuredClone(current)], hasMore: false };
		},
	},
	url: (path: string) => new URL(path, "https://example.com").href,
	log: { warn() {}, info() {}, error() {}, debug() {} },
};
const route = (name: string, input: unknown, ctx = context) =>
	(seoRuntime as any).routes[name].handler({ input }, ctx);

assert.throws(() => contentAuditRefs([]));
assert.throws(() => contentAuditRefs(Array.from({ length: 26 }, (_, index) => `posts:${index}`)));
assert.throws(() => contentAuditRefs(["not-a-reference"]));
assert.throws(() => contentAuditRefs(["posts:one", null]));
assert.deepEqual(contentAuditRefs(["posts:one", "posts:one"]), ["posts:one"]);

const audit = await route("audit-content", { refs: ["posts:one", "posts:missing", "posts:broken", "posts:one"] });
assert.equal(audit.persistence, "session");
assert.equal(audit.items.length, 1);
assert.equal(audit.items[0].analysisRevision, 0);
assert.equal(audit.items[0].persistence, "session");
assert.equal(audit.items[0].freshness, "current");
assert.ok(audit.items[0].checks.some((check: any) => check.status !== "pass" && check.recommendation && check.evidence));
assert.deepEqual(audit.failures, [
	{ ref: "posts:missing", error: "content_not_found" },
	{ ref: "posts:broken", error: "analysis_failed" },
]);
assert.equal(writes, 0);
assert.equal(reads, 4);
assert.equal(lists, 0);
assert.equal(schemaQueries, 4, "two scoped reads for each analyzed entry");

const savedSnapshot = await route("audit-content", {
	refs: ["posts:one"],
	snapshots: [{
		ref: "posts:one", sourceVersion: "revision:2", slug: post.slug,
		data: { ...post.data, title: "A clearer title from the saved draft revision" },
		seo: { ...post.seo, title: "A clearer title from the saved draft revision" },
	}],
});
assert.equal(savedSnapshot.items[0].sourceUpdatedAt, post.updatedAt);
assert.equal(savedSnapshot.items[0].sourceVersion, "revision:2");
assert.equal(savedSnapshot.items[0].sourceKind, "saved-snapshot");
assert.equal(savedSnapshot.items[0].checks.find((check: any) => check.id === "title").status, "pass");
assert.equal(current.data.title, post.data.title);
assert.equal(writes, 0);
await assert.rejects(route("audit-content", {
	refs: ["posts:one"], snapshots: [{ ref: "posts:other" }],
}), /must match unique selected entry/);

const definitions = await route("audit-content-options", {});
assert.equal(definitions.items.length, 0);
assert.equal(lists, 0);
const selectedPage = await route("audit-content-options", { collection: "posts" });
assert.equal(selectedPage.items.length, 1);
assert.equal(selectedPage.hasMore, false);
assert.equal(lists, 1);
const preview = await route("admin-entry-preview", { ref: "posts:one", entryOnly: true });
assert.equal(preview.success, true);
assert.equal(preview.preview.localeGraph.status, "incomplete");
assert.equal(lists, 1);
const snapshotInput = {
	ref: "posts:one", sourceVersion: "revision:3", slug: post.slug,
	data: {
		...post.data, title: "The complete saved draft preview",
		excerpt: "A description from the saved revision, with no change to the public timestamp.",
	},
	seo: { title: null, description: null, image: "https://example.com/saved-draft.png" },
	status: "draft", id: "other", locale: "fr",
};
const readsBeforePreview = reads;
const savedPreview = await route("admin-entry-preview", {
	ref: "posts:one", snapshot: snapshotInput, entryOnly: false,
});
assert.equal(savedPreview.success, true);
assert.equal(savedPreview.preview.sourceVersion, snapshotInput.sourceVersion);
assert.equal(savedPreview.preview.sourceKind, "saved-snapshot");
assert.equal(savedPreview.preview.content.ref, "posts:one");
assert.equal(savedPreview.preview.content.title, snapshotInput.data.title);
assert.ok(savedPreview.preview.search.title.includes(snapshotInput.data.title));
assert.ok(savedPreview.preview.search.fallbackTitle.includes(snapshotInput.data.title));
assert.equal(savedPreview.preview.search.description, snapshotInput.data.excerpt);
assert.equal(savedPreview.preview.search.fallbackDescription, snapshotInput.data.excerpt);
assert.ok(savedPreview.preview.social.title.includes(snapshotInput.data.title));
assert.equal(savedPreview.preview.social.description, snapshotInput.data.excerpt);
assert.equal(savedPreview.preview.social.image, snapshotInput.seo.image);
assert.equal(savedPreview.preview.sources.image, "core-seo");
assert.deepEqual(savedPreview.preview.social.fallbackImage, { value: null, source: "site-default" },
	"clearing the custom image reveals no featured image and no site image in this fixture");
assert.equal(savedPreview.preview.entryNoindex, preview.preview.entryNoindex);
assert.equal("sitemap" in savedPreview.preview, false);
assert.equal(savedPreview.preview.localeGraph.status, "incomplete");
assert.equal(reads - readsBeforePreview, 2);
assert.equal(lists, 1);
assert.equal(writes, 0);
assert.equal(current.data.title, post.data.title);
const overrideReads: string[] = [];
const renamedPreview = await route("admin-entry-preview", {
	ref: "posts:one", snapshot: { ...snapshotInput, slug: "saved-draft-slug" },
}, {
	...context,
	storage: new Proxy({}, { get: (_target, name) => name === "schemas" ? {
		...store,
		query: async (options: any) => {
			assert.ok(
				[
					JSON.stringify({ where: { scope: { in: ["global", "posts", "posts:one", "posts:saved-draft-slug", ""] } }, limit: 101 }),
					JSON.stringify({ where: { scope: null }, limit: 101 }),
				].includes(JSON.stringify(options)),
				"the preview reads the saved snapshot's scopes and legacy site-wide rows only",
			);
			return { items: [], hasMore: false };
		},
	} : {
		...store,
		get: async (key: string) => {
			if (name === "overrides") overrideReads.push(key);
			return null;
		},
	} }),
});
assert.equal(renamedPreview.preview.search.url, "https://example.com/blog/saved-draft-slug");
assert.equal(renamedPreview.preview.content.slug, "saved-draft-slug");
assert.deepEqual([...new Set(overrideReads)], ["posts:one", "posts:saved-draft-slug"]);
assert.equal(lists, 1);

async function snapshotUrlPreview(options: {
	pattern: string | null;
	hostUrl?: string | null | Error;
	status?: string;
	slug?: string;
}) {
	const row = { ...post, status: options.status ?? "published", locale: "nl", publishedAt: "2026-10-02T12:00:00.000Z" };
	let publicUrlReads = 0;
	let contentReads = 0;
	const routeContext = {
		...context,
		schema: { listCollections: async () => [{
			slug: "posts", label: "Posts", labelSingular: "Post", hasSeo: true,
			urlPattern: options.pattern, routable: true, hidden: false,
		}] },
		storage: new Proxy({}, { get: () => ({ ...store, query: async (query: any) => {
			assert.equal(query.limit, 101);
			assert.ok(query.where && !query.cursor, "routing previews keep scoped schema reads");
			return { items: [], hasMore: false };
		} }) }),
		content: {
			get: async (collection: string, id: string) => {
				assert.equal(collection, "posts");
				assert.equal(id, row.id);
				contentReads += 1;
				return structuredClone(row);
			},
			getPublicUrl: options.hostUrl === undefined ? undefined : async (collection: string, id: string) => {
				assert.equal(collection, "posts");
				assert.equal(id, row.id);
				publicUrlReads += 1;
				if (options.hostUrl instanceof Error) throw options.hostUrl;
				return options.hostUrl;
			},
			list: async () => { throw new Error("A routing preview must not enumerate content"); },
		},
	};
	const result = await route("admin-entry-preview", {
		ref: "posts:one", entryOnly: true,
		snapshot: {
			ref: "posts:one", sourceVersion: "routing-snapshot", slug: options.slug ?? row.slug,
			data: { ...row.data, locale: "fr", publishedAt: "2030-01-01T00:00:00.000Z" },
			status: "draft", locale: "fr", id: "other",
		},
	}, routeContext);
	assert.equal(result.success, true);
	assert.equal(result.preview.sourceKind, "saved-snapshot");
	assert.equal(result.preview.sourceVersion, "routing-snapshot");
	assert.equal(result.preview.content.ref, "posts:one");
	assert.equal(contentReads, 2, "the exact row is read and checked again after resolution");
	assert.equal(writes, 0);
	return { preview: result.preview, publicUrlReads };
}

for (const hostUrl of [
	"https://example.com/posts/short-post",
	"https://example.com/nl/2026/10/02/short-post/",
]) {
	const savedRoute = await snapshotUrlPreview({ pattern: null, hostUrl });
	assert.equal(savedRoute.preview.search.url, hostUrl, "unchanged saved snapshots retain the host's complete route");
	assert.ok(savedRoute.publicUrlReads > 0);
}
const renamedRoute = await snapshotUrlPreview({ pattern: "/blog/{slug}", hostUrl: "https://example.com/blog/short-post", slug: "new-snapshot-slug" });
assert.equal(renamedRoute.preview.search.url, "https://example.com/blog/new-snapshot-slug");
assert.equal(renamedRoute.publicUrlReads, 0, "a changed slug must not reuse the saved host URL");
const draftRoute = await snapshotUrlPreview({ pattern: "/blog/{slug}", hostUrl: "https://example.com/blog/short-post", status: "draft" });
assert.equal(draftRoute.preview.search.url, "https://example.com/blog/short-post");
assert.equal(draftRoute.publicUrlReads, 0, "a draft does not call the public host resolver");
for (const hostUrl of [undefined, null, new Error("Public route unavailable"), "javascript:invalid"]) {
	const unavailableRoute = await snapshotUrlPreview({ pattern: "/blog/{slug}", hostUrl });
	assert.equal(unavailableRoute.preview.search.url, "", "an unavailable native route must not be invented from a pattern");
}

await assert.rejects(route("admin-entry-preview", { ref: "posts:one", snapshot: snapshotInput }, {
	...context,
	storage: new Proxy({}, { get: (_target, name) => name === "schemas"
		? { ...store, query: async (options: any) => ({ ...await store.query(options), hasMore: true }) }
		: store }),
}), /Too many schema rules/);
for (const snapshot of [
	{ ...snapshotInput, ref: "posts:other" },
	{ ...snapshotInput, sourceVersion: "" },
	{ ...snapshotInput, data: [] },
]) {
	await assert.rejects(route("admin-entry-preview", { ref: "posts:one", snapshot }), /snapshot must match/);
}
await assert.rejects(route("admin-entry-preview", {
	ref: "posts:one", snapshot: { ...snapshotInput, data: { title: "a".repeat(2 * 1024 * 1024) } },
}), /preview request size limit/);
let previewReads = 0;
await assert.rejects(route("admin-entry-preview", { ref: "posts:one", snapshot: snapshotInput }, {
	...context,
	content: {
		...context.content,
		get: async (collection: string, id: string) => {
			assert.equal(collection, "posts");
			assert.equal(id, "one");
			previewReads += 1;
			return { ...structuredClone(post), status: previewReads === 1 ? "published" : "draft" };
		},
	},
}), /Content changed while resolving/);
const stored = await route("scores", { ref: "posts:one", storedOnly: true, snapshotOnly: true });
assert.deepEqual(stored.items, []);
assert.equal(lists, 1);
assert.equal(writes, 0);
await assert.rejects(route("scores", { ref: "posts:one", storedOnly: true, snapshotOnly: true }, {
	...context,
	storage: new Proxy({}, { get: (_target, name) => name === "scores"
		? { ...store, get: async () => { throw new Error("score storage unavailable"); } }
		: store }),
}), /score storage unavailable/);

for (const legacy of [
	{ storageVersion: 1, keyword: "example" },
	{ storageVersion: 2, keyword: "example", keywords: ["example"] },
	{ storageVersion: 3, keyword: "example", keywords: ["example"], pillar: true },
]) {
	const legacyContext = {
		...context,
		storage: new Proxy({}, { get: (_target, collection) => collection === "analysisProfiles"
			? { ...store, get: async () => ({ ...legacy, ref: "posts:one", updatedAt: post.updatedAt }) }
			: store }),
	};
	const legacyAudit = await route("audit-content", { refs: ["posts:one"] }, legacyContext);
	assert.equal(legacyAudit.items.length, 1);
	assert.deepEqual(legacyAudit.items[0].profileKeywords, ["example"]);
	assert.equal(writes, 0);
}

for (const persist of [false, "false"]) {
	const preview = await route("analyze-content", { collection: "posts", id: "one", persist });
	assert.equal(preview.success, true);
	assert.equal(preview.persistence, "session");
	assert.equal(preview.item.analysisRevision, 0);
}
// A trial keyword without persist:false is still only a session result.
const trialKeyword = "unique absent trial phrase";
const trialPreview = await route("analyze-content", { collection: "posts", id: "one", keyword: trialKeyword });
assert.deepEqual(
	[trialPreview.success, trialPreview.persistence, trialPreview.item.persistence, trialPreview.item.analysisRevision],
	[true, "session", "session", 0],
);
assert.deepEqual([trialPreview.item.keyword, trialPreview.item.keywords], [trialKeyword, [trialKeyword]]);
assert.equal(writes, 0);
assert.deepEqual(await route("analyze-content", { collection: "posts", id: "one" }), { success: false, error: "scoring_unavailable" },
	"durable analysis without conditional revisions is a named refusal");
await assert.rejects(persistScoreWithHistory(context, audit.items[0]), /Session analysis cannot be persisted/);
await assert.rejects(persistScoreWithHistory(context, { ...audit.items[0], analysisRevision: 10 }), /Session analysis cannot be persisted/);
assert.equal(writes, 0);

current.seo.description = "A useful and specific description of this example article, explaining its purpose and helping readers decide whether to open the complete page.";
current.updatedAt = "2026-09-09T10:01:00.000Z";
const recheck = await route("audit-content", { refs: ["posts:one"] });
assert.equal(recheck.items[0].sourceUpdatedAt, current.updatedAt);
assert.equal(audit.items[0].checks.find((check: any) => check.id === "description").status, "pass");
assert.equal(recheck.items[0].checks.find((check: any) => check.id === "description").status, "pass");
assert.equal(audit.items[0].checks.find((check: any) => check.id === "description-display-length").status, "review");
assert.equal(recheck.items[0].checks.find((check: any) => check.id === "description-display-length").status, "pass");
assert.equal(writes, 0);

let changingReads = 0;
const changed = await route("audit-content", { refs: ["posts:one"] }, {
	...context,
	content: { ...context.content, get: async () => ({ ...current, updatedAt: String(++changingReads) }) },
});
assert.equal(changed.items.length, 0);
assert.deepEqual(changed.failures, [{ ref: "posts:one", error: "analysis_failed" }]);

let imageModuleEnabled = true;
const changedConfiguration = await route("audit-content", { refs: ["posts:one"] }, {
	...context,
	kv: { ...context.kv, get: async (key: string) => key === "module:imageSeo" ? imageModuleEnabled : null },
	content: {
		...context.content,
		get: async () => {
			if (++changingReads > 3) imageModuleEnabled = false;
			return structuredClone(current);
		},
	},
});
assert.equal(changedConfiguration.items.length, 0);
assert.deepEqual(changedConfiguration.failures, [{ ref: "posts:one", error: "analysis_failed" }]);

for (const collection of ["analysisProfiles", "metaOverrides", "overrides"]) {
	let version = 0;
	const changedEntrySettings = await route("audit-content", { refs: ["posts:one"] }, {
		...context,
		storage: new Proxy({}, { get: (_target, name) => name === collection
			? { ...store, get: async () => ({ version: ++version }) }
			: store }),
	});
	assert.equal(changedEntrySettings.items.length, 0, collection);
	assert.deepEqual(changedEntrySettings.failures, [{ ref: "posts:one", error: "analysis_failed" }]);
}

// ---- Cache validation identity: the scoped inputs, no analysis or writes ----
const identityReadsBefore = reads;
const schemaQueriesBefore = schemaQueries;
const identity = await route("entry-analysis-identity", { ref: "posts:one" });
const sessionNow = (await route("audit-content", { refs: ["posts:one"] })).items[0];
assert.equal(identity.success, true);
assert.deepEqual(identity.identity, {
	scoreVersion: sessionNow.scoreVersion,
	configurationFingerprint: sessionNow.configurationFingerprint,
	templateUpdatedAt: sessionNow.templateUpdatedAt,
	modulesUpdatedAt: sessionNow.modulesUpdatedAt,
	metaOverrideUpdatedAt: sessionNow.metaOverrideUpdatedAt,
	sourceVersion: savedContentVersion(current),
	locale: "en",
	entryInputFingerprint: sessionNow.entryInputFingerprint,
}, "the identity equals what a session analysis of the same entry records, bound to the row read now");
assert.equal(writes, 0, "validation writes nothing");
assert.equal(lists, 1, "validation lists no content");
assert.equal(reads - identityReadsBefore, 1 + 2, "one exact entry read for the identity, two for the session analysis");
assert.equal(schemaQueries - schemaQueriesBefore, 2 + 4, "the identity reads only the entry's scoped schema rows");
assert.match(sessionNow.entryInputFingerprint, /^sha256-[0-9a-f]{64}$/);
for (const collection of ["analysisProfiles", "overrides"]) {
	const changedEntryRecords = await route("entry-analysis-identity", { ref: "posts:one" }, {
		...context,
		storage: new Proxy({}, { get: (_target, name) => name === collection
			? { ...store, get: async () => ({ ref: "posts:one", robots: "noindex", keywords: ["bread"], pillar: true, updatedAt: "2026-10-03T12:00:00.000Z" }) }
			: store }),
	});
	assert.notEqual(changedEntryRecords.identity.entryInputFingerprint, identity.identity.entryInputFingerprint,
		`a remote ${collection} change after the response is visible in the identity`);
	assert.equal(changedEntryRecords.identity.configurationFingerprint, identity.identity.configurationFingerprint, "control: the configuration is unchanged");
}
const unreadableEntryRecords = await route("entry-analysis-identity", { ref: "posts:one" }, {
	...context,
	storage: new Proxy({}, { get: (_target, name) => name === "overrides"
		? { ...store, get: async () => { throw new Error("storage unavailable"); } }
		: store }),
});
assert.deepEqual([unreadableEntryRecords.success, unreadableEntryRecords.error], [false, "configuration_unreadable"], "unreadable entry records fail closed");
const scopedSchemaRow = {
	id: "custom-posts", data: {
		storageVersion: 1, name: "Posts FAQ", scope: "posts", enabled: true,
		createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
		json: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] }),
	},
};
const schemaChanged = {
	...context,
	storage: new Proxy({}, { get: (_target, name) => name === "schemas"
		? { ...store, query: async (options: any) => ({ items: options.where.scope?.in ? [scopedSchemaRow] : [], hasMore: false }) }
		: store }),
};
const legacyModuleOff = await route("entry-analysis-identity", { ref: "posts:one" }, {
	...context,
	kv: { ...context.kv, get: async (key: string) => key === "module:imageSeo" ? false : null },
});
assert.equal(legacyModuleOff.identity.modulesUpdatedAt, null, "control: without a versioned modules record the timestamp stays null");
assert.notEqual(legacyModuleOff.identity.configurationFingerprint, identity.identity.configurationFingerprint,
	"a legacy module flag changes the identity through its effective value");
const changedIdentity = await route("entry-analysis-identity", { ref: "posts:one" }, schemaChanged);
assert.notEqual(changedIdentity.identity.configurationFingerprint, identity.identity.configurationFingerprint,
	"a schema change for this entry invalidates the cached session result although its content is unchanged");
assert.equal(changedIdentity.identity.configurationFingerprint,
	(await route("audit-content", { refs: ["posts:one"] }, schemaChanged)).items[0].configurationFingerprint);
for (const [ref, error] of [["posts:missing", "content_not_found"], ["not-a-ref", "invalid_ref"], ["unknown:one", "unsupported_collection"]]) {
	const failed = await route("entry-analysis-identity", { ref });
	assert.deepEqual([failed.success, failed.error, failed.ref], [false, error, ref], ref);
}
const unreadable = await route("entry-analysis-identity", { ref: "posts:one" }, {
	...context,
	storage: new Proxy({}, { get: (_target, name) => name === "schemas"
		? { ...store, query: async (options: any) => ({ ...await store.query(options), hasMore: true }) }
		: store }),
});
assert.deepEqual([unreadable.success, unreadable.error], [false, "configuration_unreadable"]);
const identityRoute = (seoRuntime as any).routes["entry-analysis-identity"];
assert.equal(identityRoute.permission, "plugins:manage", "the same administrator boundary as session analysis");
assert.equal(identityRoute.input.safeParse({ ref: "posts:one", extra: true }).success, false, "strict input");
assert.equal(writes, 0);

// The narrow template token equals the full template read in every record state.
const templateStates: Array<[string, { versioned: () => unknown; legacy: unknown }, string | null]> = [
	["absent, no legacy map", { versioned: () => null, legacy: null }, null],
	["absent with a legacy map", { versioned: () => null, legacy: { collectionUpdatedAt: { posts: "2026-09-30T00:00:00.000Z" } } }, "2026-09-30T00:00:00.000Z"],
	["saved with this collection's token", { versioned: () => ({ revision: "r1", value: { version: 1, updatedAt: "2026-10-01T00:00:00.000Z", values: {}, collectionUpdatedAt: { posts: "2026-10-02T00:00:00.000Z" } } }), legacy: null }, "2026-10-02T00:00:00.000Z"],
	["corrupt", { versioned: () => ({ revision: "r2", value: { version: 9 } }), legacy: null }, "unreadable-templates"],
	["unavailable", { versioned: () => { throw new Error("offline"); }, legacy: null }, "unreadable-templates"],
];
for (const [state, rows, expected] of templateStates) {
	const templateContext = {
		...context,
		kv: {
			...context.kv,
			getVersioned: async (key: string) => key === METADATA_TEMPLATES_KEY ? rows.versioned() : null,
			get: async (key: string) => key === LEGACY_TEMPLATE_REVISIONS_KEY ? rows.legacy : null,
		},
	};
	const narrow = await readCollectionTemplateToken(templateContext, "posts");
	assert.equal(narrow, templateRevisionFor(await readAdminTemplates(templateContext), "posts"), state);
	assert.equal(narrow, expected, state);
}

// ---- Saved per-field ownership on the entry preview ----
const ownedPost = {
	...structuredClone(post),
	version: 4,
	seo: { title: "Core title", description: "Core description", image: null, canonical: "https://example.com/blog/short-post", noIndex: false },
};
const ownedVersion = savedContentVersion(ownedPost);
const legacyRecord = {
	ref: "posts:one", title: "Legacy title", description: "Core description", canonical: "/blog/short-post",
	robots: "noindex,nofollow,noarchive", updatedAt: "2026-10-01T00:00:00.000Z", importedFrom: "an earlier plugin",
};
function ownershipContext(options: {
	overrides?: Record<string, unknown>;
	social?: (key: string) => unknown;
	socialStore?: boolean;
	item?: unknown;
	overridesError?: boolean;
	settingsUnreadable?: boolean;
} = {}) {
	const storageReads: string[] = [];
	let contentReads = 0;
	const item = options.item ?? ownedPost;
	const ctx = {
		...context,
		kv: options.settingsUnreadable
			? { ...context.kv, getVersioned: async () => { throw new Error("settings storage offline"); } }
			: context.kv,
		content: {
			...context.content,
			get: async (_collection: string, id: string) => {
				contentReads += 1;
				return id === "one" ? structuredClone(item) : null;
			},
		},
		storage: new Proxy({}, {
			get: (_target, name) => {
				if (name === "socialOverrides" && options.socialStore === false) return undefined;
				if (name !== "overrides" && name !== "socialOverrides") return store;
				return {
					...store,
					get: async (key: string) => {
						storageReads.push(`${String(name)}:${key}`);
						if (name === "socialOverrides") return options.social ? structuredClone(options.social(key)) : null;
						if (options.overridesError) throw new Error("legacy override storage offline");
						return structuredClone(options.overrides?.[key] ?? null);
					},
				};
			},
		}),
	};
	return { ctx, storageReads, contentReads: () => contentReads };
}
async function ownershipOf(input: Record<string, unknown>, options: Parameters<typeof ownershipContext>[0] = {}) {
	const harness = ownershipContext(options);
	// The editor's preview reads only the entry's scoped records.
	const result = await route("admin-entry-preview", { ref: "posts:one", entryOnly: true, ...input }, harness.ctx);
	assert.equal(result.success, true);
	// Every answer the engine gives passes the strict admin parser.
	parseSeoAdminEntryPreviewResult(result);
	return { ownership: result.preview.ownership, preview: result.preview, ...harness };
}
const fieldOf = (ownership: any, name: string) => ownership.fields.find((item: any) => item.field === name);

const exact = await ownershipOf({}, { overrides: { "posts:one": legacyRecord } });
assert.deepEqual(exact.ownership, {
	status: "current",
	reason: null,
	sourceVersion: ownedVersion,
	locale: "en",
	record: { sourceOverrideId: "posts:one", keyKind: "id" },
	fields: [
		{ field: "title", state: "conflict", core: "Core title", legacy: "Legacy title", effective: "Legacy title", effectiveSource: "legacy-override", social: { value: "Legacy title", source: "legacy-override" } },
		{ field: "description", state: "equal", core: "Core description", legacy: "Core description", effective: "Core description", effectiveSource: "legacy-override", social: { value: "Core description", source: "legacy-override" } },
		{ field: "canonical", state: "equal", core: "https://example.com/blog/short-post", legacy: "/blog/short-post", effective: "https://example.com/blog/short-post", effectiveSource: "legacy-override", social: null },
		{ field: "image", state: "not-shadowed", core: null, legacy: null, effective: null, effectiveSource: "site-default", social: null },
		{ field: "noIndex", state: "conflict", core: false, legacy: true, effective: true, effectiveSource: "legacy-override", social: null },
	],
	unsupportedDirectives: { state: "present", tokens: ["noarchive"] },
}, "an exact-ID record: conflict, equal after URL resolution, not shadowed and unsupported directives");
assert.deepEqual(exact.storageReads, ["overrides:posts:one", "socialOverrides:posts:one", "socialOverrides:posts:short-post"],
	"ownership reuses the resolver's own reads: one exact-ID override read and the social pair");
assert.equal(exact.contentReads(), 1);
assert.equal(writes, 0);

const ownedSnapshot = { ref: "posts:one", data: ownedPost.data, slug: ownedPost.slug, sourceVersion: ownedVersion };
const savedCurrent = await ownershipOf({ entryOnly: true, snapshot: ownedSnapshot }, { overrides: { "posts:one": legacyRecord } });
assert.equal(savedCurrent.ownership.status, "current");
assert.equal(savedCurrent.ownership.sourceVersion, savedCurrent.preview.sourceVersion);
assert.equal(savedCurrent.contentReads(), 2, "the saved snapshot keeps its final reread of the row");
const savedEcho = await ownershipOf({ entryOnly: true, snapshot: { ...ownedSnapshot, seo: ownedPost.seo } }, { overrides: { "posts:one": legacyRecord } });
assert.deepEqual(savedEcho.ownership, savedCurrent.ownership, "a snapshot echoing the stored SEO changes nothing");

const stale = await ownershipOf({ entryOnly: true, snapshot: { ...ownedSnapshot, sourceVersion: "an-older-saved-version" } }, { overrides: { "posts:one": legacyRecord } });
assert.deepEqual([stale.ownership.status, stale.ownership.reason, stale.ownership.record, stale.ownership.sourceVersion],
	["stale", "saved-version-mismatch", null, ownedVersion]);
assert.ok(stale.ownership.fields.every((item: any) => item.state === "unknown" && item.core === null && item.reason === "saved-version-mismatch"));
assert.equal(stale.ownership.unsupportedDirectives.state, "unknown");

// A matching version must not let client SEO become a stored or effective fact.
const fabricated = await ownershipOf(
	{ entryOnly: true, snapshot: { ...ownedSnapshot, seo: { ...ownedPost.seo, title: "Fabricated title", noIndex: true } } },
	{ overrides: { "posts:one": { ...legacyRecord, title: undefined } } },
);
assert.deepEqual([fabricated.ownership.status, fabricated.ownership.reason], ["unknown", "snapshot-seo-mismatch"]);
assert.ok(!JSON.stringify(fabricated.ownership).includes("Fabricated title"));
assert.ok(fabricated.ownership.fields.every((item: any) => item.state === "unknown"));

const alias = await ownershipOf({}, { overrides: { "posts:short-post": { ...legacyRecord, ref: "posts:short-post" } } });
assert.deepEqual(alias.ownership.record, { sourceOverrideId: "posts:short-post", keyKind: "slug-alias" });
assert.equal(fieldOf(alias.ownership, "title").state, "conflict");
assert.deepEqual(alias.storageReads.filter((read) => read.startsWith("overrides:")), ["overrides:posts:one", "overrides:posts:short-post"]);

const none = await ownershipOf({});
assert.equal(none.ownership.record, null);
assert.ok(none.ownership.fields.every((item: any) => item.state === "not-shadowed" && item.effectiveSource !== "legacy-override"));
assert.deepEqual(none.ownership.unsupportedDirectives, { state: "none", tokens: [] });
assert.deepEqual([fieldOf(none.ownership, "title").effective, fieldOf(none.ownership, "title").effectiveSource], ["Core title", "core-seo"]);

const equalTitle = await ownershipOf({}, { overrides: { "posts:one": { ...legacyRecord, title: "  Core title  " } } });
assert.equal(fieldOf(equalTitle.ownership, "title").state, "equal");
const coreNoindex = await ownershipOf({}, { item: { ...ownedPost, seo: { ...ownedPost.seo, noIndex: true } }, overrides: { "posts:one": legacyRecord } });
assert.equal(fieldOf(coreNoindex.ownership, "noIndex").state, "equal");
const directivesOnly = await ownershipOf({}, { overrides: { "posts:one": { ref: "posts:one", robots: "nofollow,max-snippet:20" } } });
assert.equal(fieldOf(directivesOnly.ownership, "noIndex").state, "not-shadowed");
assert.deepEqual(directivesOnly.ownership.unsupportedDirectives, { state: "present", tokens: ["nofollow", "max-snippet:20"] });

for (const [name, options, expected] of [
	["a record that is not an object", { overrides: { "posts:one": "corrupt" } }, { all: "legacy-record-invalid" }],
	["an invalid title value", { overrides: { "posts:one": { ...legacyRecord, title: 42 } } }, { title: "legacy-field-invalid" }],
	["an invalid robots value", { overrides: { "posts:one": { ...legacyRecord, robots: ["noindex"] } } }, { noIndex: "legacy-field-invalid" }],
	["a failed social read", { overrides: { "posts:one": legacyRecord }, social: () => { throw new Error("offline"); } }, { title: "social-read-incomplete", description: "social-read-incomplete" }],
	["a missing social store", { overrides: { "posts:one": legacyRecord }, socialStore: false }, { title: "social-read-incomplete", description: "social-read-incomplete" }],
	["an invalid social row", { overrides: { "posts:one": legacyRecord }, social: (key: string) => key === "posts:one" ? { bogus: true } : null }, { title: "social-record-invalid", description: "social-record-invalid" }],
] as const) {
	const answer = await ownershipOf({}, options as any);
	assert.equal(answer.ownership.status, "current", name);
	for (const item of answer.ownership.fields) {
		const reason = "all" in expected ? expected.all : (expected as Record<string, string>)[item.field];
		if (reason) assert.deepEqual([item.state, item.reason, item.core, item.effective], ["unknown", reason, null, null], `${name}: ${item.field}`);
		else assert.notEqual(item.state, "unknown", `${name}: ${item.field} stays known`);
	}
}
const invalidRecord = await ownershipOf({}, { overrides: { "posts:one": "corrupt" } });
assert.deepEqual([invalidRecord.ownership.record, invalidRecord.ownership.unsupportedDirectives.state], [{ sourceOverrideId: "posts:one", keyKind: "id" }, "unknown"]);

const socialOverride = {
	storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, ref: "posts:one",
	title: "A social title", description: null, updatedAt: "2026-10-01T00:00:00.000Z",
};
const withSocial = await ownershipOf({}, { overrides: { "posts:one": legacyRecord }, social: (key: string) => key === "posts:one" ? socialOverride : null });
assert.deepEqual(fieldOf(withSocial.ownership, "title").social, { value: "A social title", source: "plugin-social-override" });
assert.equal(fieldOf(withSocial.ownership, "title").effective, "Legacy title", "the title suggestion is still the legacy value");
assert.deepEqual(withSocial.storageReads.filter((read) => read.startsWith("socialOverrides:")), ["socialOverrides:posts:one"]);

for (const [name, item, reason] of [
	["an incomplete stored SEO row", { ...ownedPost, seo: { title: "Core title", description: "", noIndex: false } }, "core-seo-invalid"],
	["a collection without core SEO", { ...ownedPost, seo: undefined }, "core-seo-unavailable"],
] as const) {
	const answer = await ownershipOf({}, { item, overrides: { "posts:one": legacyRecord } });
	assert.deepEqual([answer.ownership.status, answer.ownership.reason, answer.ownership.record], ["unknown", reason, null], name);
	assert.ok(answer.ownership.fields.every((field: any) => field.state === "unknown" && field.reason === reason), name);
}
// An unreadable legacy record or settings row refuses the whole preview, so no ownership answer is returned at all.
await assert.rejects(ownershipOf({}, { overrides: { "posts:one": legacyRecord }, overridesError: true }), /legacy override storage offline/);
await assert.rejects(
	ownershipOf({ entryOnly: true, snapshot: ownedSnapshot }, { overrides: { "posts:one": legacyRecord }, overridesError: true }),
	/legacy override storage offline/,
);
await assert.rejects(
	ownershipOf({}, { overrides: { "posts:one": legacyRecord }, settingsUnreadable: true }),
	(error: unknown) => error instanceof Error && error.constructor.name === "SiteSettingsUnreadableError",
);
assert.equal(writes, 0, "ownership facts write nothing");

let inFlight = 0;
let maximum = 0;
const serial = await runContentAudit(["posts:one", "posts:two"], async (ref) => {
	inFlight += 1;
	maximum = Math.max(maximum, inFlight);
	await Promise.resolve();
	inFlight -= 1;
	return { ...audit.items[0], ref };
});
assert.equal(maximum, 1);
assert.equal(serial.items.length, 2);
assert.equal(writes, 0);
const featuredSnapshot = { ...snapshotInput, data: { ...snapshotInput.data, featured_image: { src: "https://example.com/featured.jpg", alt: "" } } };
const featuredPreview = await route("admin-entry-preview", { ref: "posts:one", snapshot: featuredSnapshot, entryOnly: true });
assert.deepEqual([featuredPreview.preview.social.image, featuredPreview.preview.sources.image], [snapshotInput.seo.image, "core-seo"]);
assert.deepEqual(featuredPreview.preview.social.fallbackImage, { value: "https://example.com/featured.jpg", source: "content" },
	"the preview reports the featured image a cleared custom image reveals");
assert.equal(writes, 0, "reporting the fallback image writes nothing");
console.log("Content audit checks passed: bounded serial reads, partial failures, stock-host preview, recheck, source changes and persistence rejection.");
