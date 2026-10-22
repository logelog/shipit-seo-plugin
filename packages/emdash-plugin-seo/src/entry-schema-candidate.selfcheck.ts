import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";

import { SEO_ENGINE_VERSION } from "./admin-contract.ts";
import {
	ENTRY_SCHEMA_CANDIDATE_MAX_BYTES,
	ENTRY_SCHEMA_PREVIEW_CONTENT_LIMITS,
	ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES,
	createEntrySchemaPreviewExpansion,
	entrySchemaPreviewContentProblem,
	entrySchemaPreviewWireBytes,
} from "./entry-schema-candidate.ts";
import {
	TemplateExpansionLimitError,
	applyVarsDeep,
	applyVarsDeepBounded,
	jsonUtf8LengthWithin,
	utf8ByteLength,
} from "./lib.ts";
import seoRuntime from "./sandbox-entry.ts";

const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const generous = () => ({ work: 1_000_000, outputBytes: 10_000_000 });

// --- bounded expansion is the public expansion, in one pass -------------------

const vars = {
	siteName: "Bakery",
	siteUrl: "https://example.com",
	title: "Crème brûlée {{description}}",
	description: "Rich custard,   and \"quotes\"",
	canonical: "https://example.com/p",
	image: "",
	author: "Ana",
	publishedAt: "",
	updatedAt: "",
	collection: "posts",
	slug: "creme",
};
const template = {
	"@context": "https://schema.org",
	"@type": ["Article"],
	headline: "{{title}}",
	alternativeHeadline: "{{ title }} by {{author}} on {{siteName}}",
	about: [{ name: "{{description}}", count: 3, flag: true, none: null }, "{{unknown}} stays empty", "😀 {{slug}}"],
};
const bounded = applyVarsDeepBounded(template, vars, generous());
assert.deepEqual(bounded, applyVarsDeep(template, vars), "bounded expansion equals the public expansion");
assert.equal((bounded as any).headline, "Crème brûlée {{description}}", "a placeholder inside a value stays literal; no second pass");

{
	const budget = generous();
	applyVarsDeepBounded(template, vars, budget);
	const strings = ["{{title}}", "{{ title }} by {{author}} on {{siteName}}", "{{description}}", "{{unknown}} stays empty", "😀 {{slug}}", "https://schema.org", "Article"];
	const expected = strings.reduce((total, value) => total + utf8ByteLength(String(applyVarsDeep(value, vars))), 0);
	assert.equal(generous().outputBytes - budget.outputBytes, expected, "output is charged in UTF-8 bytes of the expanded strings");
}

assert.throws(() => applyVarsDeepBounded({ a: "{{title}}".repeat(2_000) }, { title: "x".repeat(1_000) }, { work: 1_000_000, outputBytes: 131_072 }),
	(error: unknown) => error instanceof TemplateExpansionLimitError && error.limit === "output", "many tokens fail before the string is built");
assert.throws(() => applyVarsDeepBounded({ list: Array.from({ length: 5_000 }, () => "a") }, vars, { work: 1_000, outputBytes: 10_000_000 }),
	(error: unknown) => error instanceof TemplateExpansionLimitError && error.limit === "work");
assert.throws(() => applyVarsDeepBounded("{{title}}".repeat(600), vars, { work: 500, outputBytes: 10_000_000 }),
	(error: unknown) => error instanceof TemplateExpansionLimitError && error.limit === "work", "variable tokens are charged as work");

// A hostile variable is read only up to the remaining allowance.
{
	const huge = "é".repeat(4_000_000);
	assert.ok(utf8ByteLength(huge, 0, huge.length, 100) <= 104, "measurement stops just past its limit");
	assert.equal(utf8ByteLength(huge, 0, 10), 20);
	const started = performance.now();
	for (let round = 0; round < 200; round += 1) {
		assert.throws(() => applyVarsDeepBounded({ name: "{{description}}" }, { ...vars, description: huge }, { work: 100, outputBytes: 64 }),
			(error: unknown) => error instanceof TemplateExpansionLimitError && error.limit === "output");
	}
	assert.ok(performance.now() - started < 1_000, "200 refusals of an 8 MB variable do not scan it each time");
	const budget = { work: 100, outputBytes: 64 };
	assert.throws(() => applyVarsDeepBounded("{{description}}", { ...vars, description: huge }, budget));
	assert.equal(budget.outputBytes, 64, "a refused string spends no output allowance");
}
// Literal text is measured with the same cutoff.
assert.throws(() => applyVarsDeepBounded("x".repeat(300), vars, { work: 10, outputBytes: 100 }),
	(error: unknown) => error instanceof TemplateExpansionLimitError && error.limit === "output");
assert.equal(utf8ByteLength("aé€\u{1f600}"), 1 + 2 + 3 + 4);
assert.equal(utf8ByteLength("\ud800x"), 3 + 1, "a lone surrogate counts as its replacement character");

// --- exact serialized size without building the text ---------------------------

const samples: unknown[] = [
	null, true, false, 0, -0, 1.5e21, -12.25, Number.NaN, Number.POSITIVE_INFINITY, "", "plain",
	"quote \" backslash \\ slash / tab \t newline \n cr \r bs \b ff \f nul \u0000 unit \u001f del \u007f",
	"é € 😀    ", "\ud800 lone high", "lone low \udc00", "\udc00\ud800 reversed",
	[], [1, "two", null, undefined, () => 1, Symbol("s")], {},
	{ a: 1, b: undefined, c: () => 1, d: [undefined], "é\"": { nested: ["x", { y: "z" }] } },
	Object.assign(Object.create(null), { bare: "object", list: [1, 2, 3] }),
	{ "2": "integer key", "1": "order", z: "last" },
];
for (const sample of samples) {
	assert.equal(jsonUtf8LengthWithin(sample, 1_000_000), wire(sample), JSON.stringify(sample));
	assert.equal(jsonUtf8LengthWithin({ wrapped: sample }, 1_000_000), wire({ wrapped: sample }));
}
assert.equal(jsonUtf8LengthWithin("x".repeat(100), 101), 102 > 101 ? null : 102);
assert.equal(jsonUtf8LengthWithin("x".repeat(100), 102), 102);
assert.equal(jsonUtf8LengthWithin({ big: "y".repeat(5_000_000) }, 1_000), null);
{
	const shared = { text: "s".repeat(100) };
	const value = [shared, shared, shared];
	assert.equal(jsonUtf8LengthWithin(value, 1_000_000), wire(value), "a shared object is counted at each occurrence");
}
assert.equal(entrySchemaPreviewWireBytes({ ok: "é" }), wire({ success: true, data: { ok: "é" } }), "the wire size includes EmDash's envelope");

// --- content handed to the helpers ----------------------------------------------

const limits = ENTRY_SCHEMA_PREVIEW_CONTENT_LIMITS;
assert.equal(entrySchemaPreviewContentProblem({ id: "x", data: { title: "ok", content: [{ children: [{ text: "body" }] }] } }), null);
{
	let deep: unknown = "leaf";
	for (let level = 0; level < limits.depth + 1; level += 1) deep = [deep];
	assert.match(entrySchemaPreviewContentProblem({ data: deep }) ?? "", /levels deep/);
	assert.match(entrySchemaPreviewContentProblem({ data: { faq: Array.from({ length: limits.values + 1 }, () => 1) } }) ?? "", /stored values/);
	assert.match(entrySchemaPreviewContentProblem({ data: { title: "x".repeat(limits.stringBytes + 1) } }) ?? "", /text value over/);
	assert.match(entrySchemaPreviewContentProblem({ data: { title: "é".repeat(limits.stringBytes / 2 + 1) } }) ?? "", /text value over/, "counted in UTF-8 bytes");
	const body = Array.from({ length: 40 }, () => ({ text: "b".repeat(30_000) }));
	assert.match(entrySchemaPreviewContentProblem({ data: { content: body } }) ?? "", /bytes of text/, "a huge body is refused before flattening");
	const faq = Array.from({ length: 2_000 }, (_, index) => ({ question: `Q${index}`, answer: "a".repeat(1_000) }));
	assert.match(entrySchemaPreviewContentProblem({ data: { faqItems: faq } }) ?? "", /bytes of text/, "so is a huge FAQ list");
	const wide: Record<string, number> = {};
	for (let index = 0; index < 200_000; index += 1) wide[`k${index}`] = index;
	const started = performance.now();
	assert.match(entrySchemaPreviewContentProblem({ data: wide }) ?? "", /stored values/);
	assert.ok(performance.now() - started < 1_000, "a wide object stops at the cap");
}

// --- one budget across every custom graph -----------------------------------------

{
	const expansion = createEntrySchemaPreviewExpansion("candidate");
	const big = { "@context": "https://schema.org", "@type": "Thing", name: "x".repeat(200_000) };
	expansion.expand({ id: "other-1" }, big, vars);
	expansion.expand({ id: "other-2" }, big, vars);
	let thrown: unknown;
	try {
		expansion.expand({ id: "other-3" }, big, vars);
	} catch (error) {
		thrown = error;
	}
	assert.ok(thrown instanceof TemplateExpansionLimitError);
	assert.equal(expansion.limitFailure(thrown).error, "response_too_large", "stored graphs share the response budget");
}
{
	const expansion = createEntrySchemaPreviewExpansion("candidate");
	let thrown: unknown;
	try {
		expansion.expand({ id: "candidate" }, { name: "{{description}}".repeat(10) }, { ...vars, description: "d".repeat(20_000) });
	} catch (error) {
		thrown = error;
	}
	assert.ok(thrown instanceof TemplateExpansionLimitError);
	const failure = expansion.limitFailure(thrown);
	assert.equal(failure.error, "expansion_too_large");
	assert.match(failure.message, /131,072 bytes/);
}

// --- the candidate route against the shared resolver and the public hook -------

class VersionedStore {
	rows = new Map<string, { value: unknown; revision: string }>();
	private sequence = 0;
	queries = 0;
	seed(id: string, value: unknown): string {
		this.sequence += 1;
		const revision = `rev-${this.sequence}`;
		this.rows.set(id, { value: structuredClone(value), revision });
		return revision;
	}
	async get(id: string) {
		return structuredClone(this.rows.get(id)?.value ?? null);
	}
	async put(id: string, value: unknown) {
		this.seed(id, value);
	}
	async delete(id: string) {
		return this.rows.delete(id);
	}
	async getVersioned(id: string) {
		const row = this.rows.get(id);
		return row ? { value: structuredClone(row.value), revision: row.revision } : null;
	}
	async compareAndSet(id: string, expectedRevision: string | null, value: unknown) {
		const row = this.rows.get(id);
		if (expectedRevision === null ? row : row?.revision !== expectedRevision) return { applied: false as const };
		return { applied: true as const, revision: this.seed(id, value) };
	}
	async compareAndDelete(id: string, expectedRevision: string) {
		const row = this.rows.get(id);
		if (!row || row.revision !== expectedRevision) return { applied: false };
		this.rows.delete(id);
		return { applied: true };
	}
	async count() {
		return this.rows.size;
	}
	async query(options: { where?: Record<string, unknown>; limit?: number } = {}) {
		this.queries += 1;
		const condition = options.where?.scope;
		const items = [...this.rows.entries()]
			.map(([id, row]) => ({ id, data: structuredClone(row.value) as Record<string, unknown> }))
			.filter(({ data }) => {
				if (condition === undefined) return true;
				if (condition === null) return data.scope === null || data.scope === undefined;
				if (typeof condition === "string") return data.scope === condition;
				const list = (condition as { in?: unknown[] }).in;
				return Array.isArray(list) && list.includes(data.scope);
			});
		const limit = options.limit ?? 100;
		return { items: items.slice(0, limit), hasMore: items.length > limit, cursor: undefined };
	}
}

const POST = "01JPOSTAAAAAAAAAAAAAAAAAAA";
const FRENCH = "01JPOSTFRFRFRFRFRFRFRFRFRF";
const DRAFT = "01JPOSTDRAFTDRAFTDRAFTDRAF";
const kvStore = new VersionedStore();
kvStore.seed("settings:siteName", "Example");
kvStore.seed("settings:siteUrl", "https://example.com");
const schemas = new VersionedStore();
const contentItems = new Map<string, any>([
	// A title that itself contains a supported placeholder, kept literally by the public expansion.
	[`posts:${POST}`, { id: POST, type: "posts", slug: "launch-notes", status: "published", locale: "en", data: { title: "Launch {{description}} notes", excerpt: "Fresh bread daily" }, seo: null, updatedAt: "2026-09-01T10:00:00.000Z", publishedAt: "2026-09-01T10:00:00.000Z" }],
	[`posts:${FRENCH}`, { id: FRENCH, type: "posts", slug: "launch-notes", status: "published", locale: "fr", data: { title: "Notes" }, seo: null, updatedAt: "2026-09-01T10:00:00.000Z", publishedAt: "2026-09-01T10:00:00.000Z" }],
	[`posts:${DRAFT}`, { id: DRAFT, type: "posts", slug: "draft-notes", status: "draft", locale: "en", data: { title: "Draft notes" }, seo: null, updatedAt: "2026-09-01T10:00:00.000Z", publishedAt: null }],
]);
let contentReads = 0;
let publicUrlReads = 0;
const publicUrlTargets: Array<[string, string]> = [];
let readOverride: ((collection: string, id: string, read: number) => any) | null = null;
const context = {
	plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
	site: { name: "Example", url: "https://example.com", locale: "en" },
	schema: { listCollections: async () => [{ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}" }] },
	kv: {
		get: (key: string) => kvStore.get(key),
		set: (key: string, value: unknown) => kvStore.put(key, value),
		delete: (key: string) => kvStore.delete(key),
		list: async () => [],
		getVersioned: (key: string) => kvStore.getVersioned(key),
		compareAndSet: (key: string, revision: string | null, value: unknown) => kvStore.compareAndSet(key, revision, value),
		compareAndDelete: (key: string, revision: string) => kvStore.compareAndDelete(key, revision),
	},
	storage: new Proxy({ schemas, operationLeases: new VersionedStore() } as Record<string, unknown>, {
		get: (target, key: string) => (target[key] ??= new VersionedStore()),
	}),
	content: {
		get: async (collection: string, id: string) => {
			contentReads += 1;
			const stored = structuredClone(contentItems.get(`${collection}:${id}`) ?? null);
			return readOverride ? readOverride(collection, id, contentReads) ?? stored : stored;
		},
		getPublicUrl: async (collection: string, id: string): Promise<string | null> => {
			publicUrlReads += 1;
			publicUrlTargets.push([collection, id]);
			const item = contentItems.get(`${collection}:${id}`);
			return item?.status === "published" && item.slug ? `https://example.com/posts/${item.slug}` : null;
		},
		list: async () => {
			throw new Error("the candidate preview never lists content");
		},
	},
	url: (path: string) => new URL(path, "https://example.com").href,
	log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
};
const routes = (seoRuntime as any).routes;
const call = (route: string, input: unknown) => routes[route].handler({ input }, context);
const route = routes["preview-entry-schema-candidate"];
assert.equal(route.permission, "plugins:manage");
assert.deepEqual(route.request, { body: "json", maxBytes: 1_048_576 }, "the host enforces the declared body limit before parsing");

const ref = { collection: "posts", entryId: POST, locale: "en" };
const article = (headline: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({ "@context": "https://schema.org", "@type": "Article", "@id": "https://example.com/posts/launch-notes#candidate", headline, ...extra });
const newId = (seed: string) => `entry-${seed.padEnd(20, "0").slice(0, 20)}`;
let request = 0;
const preview = (input: Record<string, unknown>) =>
	call("preview-entry-schema-candidate", { requestId: `request-${String(++request).padStart(4, "0")}`, ...ref, name: "Candidate", enabled: true, ...input });

assert.equal(route.input.safeParse({ requestId: "request-0001", ...ref, id: newId("a"), expectedRevision: null, name: "x", json: "{}", enabled: true, scope: "global" }).success, false, "no scope can be passed");
assert.equal(route.input.safeParse({ requestId: "request-0001", collection: "posts", entryId: POST, id: newId("a"), expectedRevision: null, name: "x", json: "{}", enabled: true }).success, true, "locale may be omitted at the wire");
assert.equal((await preview({ locale: undefined, id: newId("a"), expectedRevision: null, json: article("x") })).error, "invalid_input", "but the command requires the exact locale");
assert.equal(route.input.safeParse({ requestId: "short", ...ref, id: newId("a"), expectedRevision: null, name: "x", json: "{}", enabled: true }).success, false);

// Public page JSON-LD for the post, as the page:metadata hook contributes it.
function page(id: string, slug: string): PublicPageContext {
	return {
		url: `https://example.com/posts/${slug}`, path: `/posts/${slug}`, locale: "en", kind: "content", pageType: "article",
		title: slug, pageTitle: slug, description: "", canonical: `https://example.com/posts/${slug}`, image: null,
		content: { collection: "posts", id, slug }, seo: {}, siteName: "Example", siteUrl: "https://example.com",
	} as PublicPageContext;
}
const publicGraphs = async (id = POST, slug = "launch-notes", pageOverrides: Partial<PublicPageContext> = {}) =>
	((await (seoRuntime as any).hooks["page:metadata"].handler({ page: { ...page(id, slug), ...pageOverrides } }, context)) as any[])
		.filter((item) => item.kind === "jsonld" && String(item.id).startsWith("custom:"));

// A new candidate: predicted, not written, and equal to public output after the save.
const addJson = article("{{title}}", { description: "{{description}}" });
const before = structuredClone([...schemas.rows]);
publicUrlReads = 0;
const added = await preview({ id: newId("add"), expectedRevision: null, json: addJson });
assert.equal(added.success, true, JSON.stringify(added));
const existingPreviewUrlReads = publicUrlReads;
assert.equal(added.requestId, `request-${String(request).padStart(4, "0")}`, "the request is echoed for correlation");
assert.equal(added.scope, "plugin-contribution");
assert.deepEqual([...schemas.rows], before, "a preview writes nothing");
assert.equal(added.candidate.mode, "add");
assert.equal(added.canonicalSource, "page", "without its own canonical the prediction uses the registered public route");
assert.equal(added.content.sourceKind, "stored-entry");
assert.equal(added.saveCheck.ok, true);
const predicted = added.items.find((item: any) => item.id === `custom:${newId("add")}`);
assert.equal(predicted.emitted, true);
assert.ok(predicted.graph.headline.startsWith("Launch {{description}} notes"), "the title's own placeholder stays literal");
assert.equal(predicted.graph.headline.includes("Fresh bread daily"), false, "and is not expanded by a second pass");
assert.equal(predicted.graph.description, "Fresh bread daily");
assert.equal(added.candidate.resolvedBytes, wire(predicted.graph));
assert.ok(entrySchemaPreviewWireBytes(added)! <= ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES);
assert.deepEqual(await publicGraphs(), [], "nothing reaches the page before a save");

const saved = await call("save-entry-custom-schema", { ...ref, id: newId("add"), expectedRevision: null, name: "Candidate", json: addJson, enabled: true });
assert.equal(saved.success, true);
const published = await publicGraphs();
assert.deepEqual(published.map((item) => item.id), [`custom:${newId("add")}`]);
assert.deepEqual(JSON.parse(JSON.stringify(published[0].graph)), JSON.parse(JSON.stringify(predicted.graph)), "the prediction matches public output after the save");

// Published registered routes fill {{canonical}} without saving a duplicate canonical field.
{
	const usesCanonical = article("{{title}}", { "@id": "{{canonical}}#canonical", url: "{{canonical}}" });
	const original = contentItems.get(`posts:${POST}`);
	const lookup = context.content.getPublicUrl;
	try {
		for (const [index, registeredUrl] of [
			"https://example.com/posts/launch-notes",
			"https://example.com/journal/launch-notes/",
			"https://example.com/fr/2026/09/01/launch-notes/",
			`https://example.com/archive/2026/09/01/${POST}.html`,
		].entries()) {
			context.content.getPublicUrl = async (collection, id) => {
				publicUrlReads += 1;
				publicUrlTargets.push([collection, id]);
				return registeredUrl;
			};
			publicUrlReads = 0; publicUrlTargets.length = 0;
			const id = newId(`route${index}`);
			const storedBefore = structuredClone([...schemas.rows]);
			const resolved = await preview({ id, expectedRevision: null, json: usesCanonical });
			assert.equal(resolved.success, true, JSON.stringify(resolved));
			assert.equal(resolved.canonicalSource, "page");
			assert.equal(publicUrlReads, existingPreviewUrlReads, "route eligibility adds no URL lookup to the existing preview");
			assert.ok(publicUrlReads > 0);
			assert.deepEqual(publicUrlTargets, Array.from({ length: publicUrlReads }, () => ["posts", POST]), "only the exact entry's registered URL is read");
			assert.deepEqual([...schemas.rows], storedBefore, "the route-derived preview writes no schema");
			assert.equal(contentItems.get(`posts:${POST}`).seo, null, "no canonical is written into the entry");
			const graph = resolved.items.find((item: any) => item.id === `custom:${id}`).graph;
			assert.equal(graph["@id"], `${registeredUrl}#canonical`);
			assert.equal(graph.url, registeredUrl, "host path, locale/date segments and trailing slash are preserved exactly");
			const saved = await call("save-entry-custom-schema", { ...ref, id, expectedRevision: null, name: "Route", json: usesCanonical, enabled: true });
			assert.equal(saved.success, true);
			const pageContext = { url: registeredUrl, path: new URL(registeredUrl).pathname, canonical: registeredUrl };
			const served = (await publicGraphs(POST, "launch-notes", pageContext)).find((item) => item.id === `custom:${id}`);
			assert.deepEqual(JSON.parse(JSON.stringify(served.graph)), JSON.parse(JSON.stringify(graph)));
			if (index === 0) {
				const themeCanonical = "https://example.com/theme-selected-address";
				const overridden = (await publicGraphs(POST, "launch-notes", { ...pageContext, canonical: themeCanonical })).find((item) => item.id === `custom:${id}`);
				assert.equal(overridden.graph.url, themeCanonical, "the public template's canonical precedence is unchanged");
				assert.notEqual(overridden.graph.url, graph.url, "the registered-route prediction is not proof of an arbitrary template canonical");
			}
			schemas.rows.delete(id);
		}
		context.content.getPublicUrl = lookup;
		const savedSnapshot = { ref: `posts:${POST}`, data: original.data, slug: original.slug, sourceVersion: "route-v1" };
		const snapshotPreview = await preview({ id: newId("routesnapshot"), expectedRevision: null, json: usesCanonical, snapshot: savedSnapshot });
		assert.equal(snapshotPreview.success, true, JSON.stringify(snapshotPreview));
		assert.equal(snapshotPreview.items.find((item: any) => item.id === `custom:${newId("routesnapshot")}`).graph.url, "https://example.com/posts/launch-notes");
		assert.equal((await preview({ id: newId("movedroute"), expectedRevision: null, json: usesCanonical, snapshot: { ...savedSnapshot, slug: "moved-notes" } })).error, "snapshot_mismatch", "a candidate cannot borrow the old route for a changed slug");

		for (const [label, getPublicUrl] of [
			["null", async () => null],
			["empty", async () => ""],
			["relative", async () => "/journal/launch-notes"],
			["invalid", async () => "not a URL"],
			["wrong type", async () => 42 as unknown as string],
			["unsafe", async () => "javascript:alert(1)"],
			["throws", async () => { throw new Error("URL unavailable"); }],
		] as const) {
			context.content.getPublicUrl = getPublicUrl;
			const storedBefore = structuredClone([...schemas.rows]);
			const unresolved = await preview({ id: newId("unresolved"), expectedRevision: null, json: usesCanonical });
			assert.equal(unresolved.error, "canonical_unresolved", label);
			assert.match(unresolved.message, /Your form is kept/);
			assert.deepEqual([...schemas.rows], storedBefore, `${label} lookup does not write`);
		}
		Reflect.deleteProperty(context.content, "getPublicUrl");
		assert.equal((await preview({ id: newId("missingapi"), expectedRevision: null, json: usesCanonical })).error, "canonical_unresolved");
		context.content.getPublicUrl = async () => null;
		const excludedCanonical = await preview({ id: newId("excludedcanon"), expectedRevision: null, json: usesCanonical, enabled: false });
		assert.equal(excludedCanonical.success, true, "an excluded schema needs no canonical prediction");
		context.content.getPublicUrl = lookup;
		publicUrlReads = 0;
		assert.equal((await preview({ entryId: DRAFT, id: newId("draftcanon"), expectedRevision: null, json: usesCanonical })).error, "canonical_unresolved", "an inferred draft path is not a confirmed public route");
		assert.equal(publicUrlReads, 0, "a draft path is never presented as a host public URL lookup");
		contentItems.set(`posts:${POST}`, { ...original, slug: null, data: { ...original.data, slug: original.slug } });
		assert.equal((await preview({ id: newId("aliascanon"), expectedRevision: null, json: usesCanonical, snapshot: savedSnapshot })).error, "canonical_unresolved", "an inferred snapshot path remains unresolved even when its normalized slug matches");

		contentItems.set(`posts:${POST}`, { ...original, seo: { canonical: "https://example.com/stories/launch" } });
		context.content.getPublicUrl = async () => "https://example.com/host-registered-route";
		const withRoute = await preview({ id: newId("ownwithroute"), expectedRevision: null, json: usesCanonical });
		assert.equal(withRoute.success, true, JSON.stringify(withRoute));
		assert.equal(withRoute.items.find((item: any) => item.id === `custom:${newId("ownwithroute")}`).graph.url, "https://example.com/stories/launch", "an explicit canonical wins over the valid host route");
		context.content.getPublicUrl = async () => null;
		const resolved = await preview({ id: newId("canon"), expectedRevision: null, json: usesCanonical });
		assert.equal(resolved.success, true, JSON.stringify(resolved));
		assert.equal(resolved.canonicalSource, "entry", "the saved canonical remains usable without a generated route");
		const graph = resolved.items.find((item: any) => item.id === `custom:${newId("canon")}`).graph;
		assert.equal(graph["@id"], "https://example.com/stories/launch#canonical");
		const saved = await call("save-entry-custom-schema", { ...ref, id: newId("canon"), expectedRevision: null, name: "Canonical", json: usesCanonical, enabled: true });
		assert.equal(saved.success, true);
		const served = (await publicGraphs(POST, "launch-notes", { canonical: "https://example.com/theme-selected-address" })).find((item) => item.id === `custom:${newId("canon")}`);
		assert.deepEqual(JSON.parse(JSON.stringify(served.graph)), JSON.parse(JSON.stringify(graph)), "the entry-owned canonical still wins over a template canonical");
		schemas.rows.delete(newId("canon"));
		const overrides = context.storage.overrides as VersionedStore;
		overrides.seed(`posts:${POST}`, { canonical: "https://example.com/legacy-address" });
		const legacy = await preview({ id: newId("legacycanon"), expectedRevision: null, json: usesCanonical });
		assert.equal(legacy.success, true, JSON.stringify(legacy));
		assert.equal(legacy.canonicalSource, "entry");
		assert.equal(legacy.items.find((item: any) => item.id === `custom:${newId("legacycanon")}`).graph.url, "https://example.com/legacy-address", "legacy canonical precedence over core remains unchanged");
	} finally {
		context.content.getPublicUrl = lookup;
		contentItems.set(`posts:${POST}`, original);
		(context.storage.overrides as VersionedStore).rows.delete(`posts:${POST}`);
	}
}

// Editing the saved record replaces it in place: no duplicate next to its stored original.
const editJson = article("Edited {{title}}");
const edited = await preview({ id: newId("add"), expectedRevision: saved.schema.revision, json: editJson });
assert.equal(edited.success, true, JSON.stringify(edited));
assert.equal(edited.candidate.mode, "edit");
assert.equal(edited.items.filter((item: any) => item.id === `custom:${newId("add")}`).length, 1);
assert.ok(edited.items.find((item: any) => item.id === `custom:${newId("add")}`).graph.headline.startsWith("Edited Launch {{description}} notes"));
assert.equal(edited.saveCheck.ok, true, "its own stored definition does not count as a collision");

// An added copy defining the same entity collides with the stored one, and says so.
const twin = await preview({ id: newId("twin"), expectedRevision: null, json: article("Twin") });
assert.equal(twin.success, true);
assert.equal(twin.saveCheck.ok, false);
assert.equal(twin.saveCheck.reason, "identity");
const twinDecisions = twin.items.filter((item: any) => item.source === "custom").map((item: any) => [item.id, item.emitted]);
assert.equal(twinDecisions.filter(([, emitted]: [string, boolean]) => emitted).length, 1, "the resolver emits only one definition of the entity");

// Revisions and ownership, as the save command checks them.
const stale = await preview({ id: newId("add"), expectedRevision: "rev-0", json: editJson });
assert.equal(stale.error, "conflict");
assert.equal(stale.current.revision, saved.schema.revision);
assert.equal((await preview({ id: newId("gone"), expectedRevision: "rev-1", json: editJson })).error, "not_found");
assert.equal((await preview({ id: newId("add"), expectedRevision: null, json: editJson })).error, "id_in_use");
assert.equal((await preview({ collection: "posts", entryId: FRENCH, locale: "fr", id: newId("add"), expectedRevision: saved.schema.revision, json: editJson })).error, "scope_mismatch", "another locale's row cannot edit this record");
assert.equal((await preview({ entryId: FRENCH, locale: "en", id: newId("fr"), expectedRevision: null, json: editJson })).error, "entry_mismatch");
assert.equal((await preview({ id: newId("bad"), expectedRevision: null, json: "{\"@type\":\"Article\"}" })).error, "invalid_values");
assert.equal((await preview({ id: "custom-id", expectedRevision: null, json: editJson })).error, "invalid_input");

// The French row's preview never sees the English record.
const french = await preview({ collection: "posts", entryId: FRENCH, locale: "fr", id: newId("fr"), expectedRevision: null, json: article("Nouvelles") });
assert.equal(french.success, true);
assert.deepEqual(french.items.filter((item: any) => item.source === "custom").map((item: any) => item.id), [`custom:${newId("fr")}`]);

// An unpublished entry is predicted with its status, so the editor can say it is not live yet.
const draft = await preview({ entryId: DRAFT, id: newId("draft"), expectedRevision: null, json: article("Draft") });
assert.equal(draft.success, true);
assert.equal(draft.entry.status, "draft");

// Excluded and output-off candidates are not resolved into the graph.
const excluded = await preview({ id: newId("off"), expectedRevision: null, json: article("Off"), enabled: false });
assert.equal(excluded.success, true);
assert.equal(excluded.items.some((item: any) => item.id === `custom:${newId("off")}`), false);
assert.equal(excluded.saveCheck.ok, true, "an excluded record is not checked for collisions");

// Observations that changed between reads are refused rather than mixed.
// The changed row stays changed for every later read, so only the between-read check can refuse it.
for (const change of [{ slug: "renamed-notes" }, { status: "draft" }, { locale: "fr" }]) {
	readOverride = (_collection, _id, read) => (read >= 2 ? { ...structuredClone(contentItems.get(`posts:${POST}`)), ...change } : null);
	contentReads = 0;
	const mixed = await preview({ id: newId("mix"), expectedRevision: null, json: editJson });
	assert.equal(mixed.error, "content_changed", JSON.stringify(change));
}
for (const change of [{ data: { title: "Changed during resolution" } }]) {
	readOverride = (_collection, _id, read) => (read === 3 ? { ...structuredClone(contentItems.get(`posts:${POST}`)), ...change } : null);
	contentReads = 0;
	assert.equal((await preview({ id: newId("mix"), expectedRevision: null, json: editJson })).error, "content_changed", "a change during resolution is refused");
}
// A huge body written during resolution is refused without being compared as text.
readOverride = (_collection, _id, read) => (read === 3
	? { ...structuredClone(contentItems.get(`posts:${POST}`)), data: { title: "x", content: Array.from({ length: 60 }, () => ({ text: "h".repeat(30_000) })) } }
	: null);
contentReads = 0;
assert.equal((await preview({ id: newId("mix"), expectedRevision: null, json: editJson })).error, "content_changed");
readOverride = null;

// Stored records that were never held to the editor's limits stay bounded on every path.
{
	const owned = (json: string) => ({
		storageVersion: 1, name: "Imported", scope: `posts:${POST}`, json, enabled: true,
		createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
		target: { collection: "posts", entryId: POST, locale: "en" },
	});
	const wide = JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": "https://example.com/#wide", text: "é".repeat(300_000) });
	const wideRevision = schemas.seed(newId("wide"), owned(wide));
	const conflict = await preview({ id: newId("wide"), expectedRevision: "rev-0", json: editJson });
	assert.equal(conflict.error, "response_too_large", "a conflict carrying a 600 KB stored record is refused at the wire cap");
	assert.match(conflict.message, /Reload the editor/);
	assert.ok(entrySchemaPreviewWireBytes(conflict)! < 2_000);
	assert.equal(schemas.rows.get(newId("wide"))?.revision, wideRevision);
	schemas.rows.delete(newId("wide"));
	const oversized = JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", text: "o".repeat(1_100_000) });
	schemas.seed(newId("over"), owned(oversized));
	assert.equal((await preview({ id: newId("over"), expectedRevision: "rev-0", json: editJson })).error, "schemas_too_large",
		"an oversized owned record is refused before the conflict path parses it");
	schemas.rows.delete(newId("over"));
}

// A saved snapshot is checked like the entry preview's, and cannot move the slug alias.
const snapshot = { ref: `posts:${POST}`, data: { title: "Snapshot title", excerpt: "Fresh bread daily" }, slug: "launch-notes", sourceVersion: "v-1" };
const fromSnapshot = await preview({ id: newId("snap"), expectedRevision: null, json: article("{{title}}", { "@id": "https://example.com/#snap" }), snapshot });
assert.equal(fromSnapshot.success, true, JSON.stringify(fromSnapshot));
assert.deepEqual(fromSnapshot.content, { sourceKind: "saved-snapshot", sourceVersion: "v-1" });
assert.ok(fromSnapshot.items.find((item: any) => item.id === `custom:${newId("snap")}`).graph.headline.startsWith("Snapshot title"));
assert.equal((await preview({ id: newId("snap"), expectedRevision: null, json: editJson, snapshot: { ...snapshot, ref: `posts:${FRENCH}` } })).error, "snapshot_mismatch");
assert.equal((await preview({ id: newId("snap"), expectedRevision: null, json: editJson, snapshot: { ...snapshot, slug: "draft-slug" } })).error, "snapshot_mismatch");

// Bounds: refused, never truncated, and not the public policy.
{
	const original = contentItems.get(`posts:${POST}`);
	contentItems.set(`posts:${POST}`, { ...original, data: { ...original.data, content: Array.from({ length: 40 }, () => ({ text: "b".repeat(30_000) })) } });
	const huge = await preview({ id: newId("huge"), expectedRevision: null, json: editJson });
	assert.equal(huge.error, "content_too_large");
	assert.equal((await publicGraphs()).length, 1, "public output still reads the same entry");
	contentItems.set(`posts:${POST}`, { ...original, data: { ...original.data, excerpt: "e".repeat(20_000) } });
	const expanded = await preview({ id: newId("exp"), expectedRevision: null, json: article("x", { "@id": "https://example.com/#exp", text: "{{description}}".repeat(8) }) });
	assert.equal(expanded.error, "expansion_too_large");
	assert.match(expanded.message, /131,072 bytes/);
	const sameAtPublic = await call("save-entry-custom-schema", { ...ref, id: newId("pub"), expectedRevision: null, name: "Wide", json: article("x", { "@id": "https://example.com/#pub", text: "{{description}}".repeat(8) }), enabled: true });
	assert.equal(sameAtPublic.success, true, "the save command keeps its own rules");
	assert.equal((await publicGraphs()).some((item) => item.id === `custom:${newId("pub")}`), true, "public output keeps the unbounded expansion");
	schemas.rows.delete(newId("pub"));
	contentItems.set(`posts:${POST}`, original);
}

// Stored inherited records with variables count toward the same response budget.
{
	const wideDescription = "w".repeat(30_000);
	const original = contentItems.get(`posts:${POST}`);
	contentItems.set(`posts:${POST}`, { ...original, data: { ...original.data, excerpt: wideDescription } });
	for (let index = 0; index < 5; index += 1) {
		schemas.seed(`site-${index}`, { name: `Site ${index}`, scope: "global", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": `https://example.com/#site-${index}`, a: "{{description}}", b: "{{description}}", c: "{{description}}", d: "{{description}}" }), enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	}
	const inherited = await preview({ id: newId("inh"), expectedRevision: null, json: article("Small", { "@id": "https://example.com/#small" }) });
	assert.equal(inherited.error, "response_too_large", "stored graphs expanded with large variables are bounded too");
	for (let index = 0; index < 5; index += 1) schemas.rows.delete(`site-${index}`);
	contentItems.set(`posts:${POST}`, original);
}

// Escaping is part of the wire size: control characters serialize as six bytes each.
{
	const original = contentItems.get(`posts:${POST}`);
	const controls = "\u0001".repeat(20_000);
	contentItems.set(`posts:${POST}`, { ...original, data: { ...original.data, excerpt: controls } });
	for (let index = 0; index < 5; index += 1) {
		schemas.seed(`esc-${index}`, { name: `Escaped ${index}`, scope: "global", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", "@id": `https://example.com/#esc-${index}`, a: "{{description}}" }), enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	}
	const escaped = await preview({ id: newId("esc"), expectedRevision: null, json: article("Small", { "@id": "https://example.com/#esc" }) });
	assert.equal(escaped.error, "response_too_large", "100,000 raw bytes that serialize to over 524,288 are refused at the wire size");
	for (let index = 0; index < 5; index += 1) schemas.rows.delete(`esc-${index}`);
	contentItems.set(`posts:${POST}`, original);
}

// More than 100 applicable stored records is refused, as the save command refuses it.
{
	for (let index = 0; index < 101; index += 1) {
		schemas.seed(`many-${index}`, { name: "Many", scope: "global", json: article("Many"), enabled: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	}
	assert.equal((await preview({ id: newId("many"), expectedRevision: null, json: editJson })).error, "too_many_applicable");
	for (let index = 0; index < 101; index += 1) schemas.rows.delete(`many-${index}`);
}

// Unresolved stored JSON is bounded before it is parsed.
{
	for (let index = 0; index < 12; index += 1) {
		schemas.seed(`legacy-${index}`, { name: "Legacy", scope: "global", json: JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", text: "l".repeat(95_000) }), enabled: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
	}
	assert.equal((await preview({ id: newId("legacy"), expectedRevision: null, json: editJson })).error, "schemas_too_large");
	for (let index = 0; index < 12; index += 1) schemas.rows.delete(`legacy-${index}`);
}

assert.equal(ENTRY_SCHEMA_CANDIDATE_MAX_BYTES, 131_072);
console.log("SEO entry schema candidate self-check passed.");
