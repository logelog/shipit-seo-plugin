import { SEO_ADMIN_CONTRACT_VERSION, SEO_ADMIN_TEMPLATE_SMALL_REQUEST_MAX_BYTES, defaultSeoAdminTemplateSet } from "./admin-contract.ts";
import { METADATA_TEMPLATES_KEY } from "./metadata-templates.ts";
import seoRuntime from "./sandbox-entry.ts";
import { imageFromContentData, featuredImageFromContentData } from "./content-analysis-inputs.ts";
import { resolveEffectiveContentMetadata } from "./entry-analysis-runtime.ts";
import { createSavedContentSnapshot } from "./admin-ui/saved-content-snapshot.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
	if (ok) console.log(`  PASS  ${name}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
	}
}

const routes = (seoRuntime as any).routes;
const hook = (seoRuntime as any).hooks["page:metadata"].handler;
const call = (name: string, input: unknown, ctx: unknown) => routes[name].handler({ input, request: { url: "https://example.com/_emdash/api/plugins/shipit-seo/x", method: "POST", headers: {} } }, ctx);

function harness() {
	const kv = new Map<string, unknown>();
	const revisions = new Map<string, string>();
	let counter = 0;
	const counts = { kvWrites: 0, schemaQueries: 0, publicUrl: 0, contentGets: 0 };
	const items = new Map<string, any>([
		["posts:p1", {
			id: "p1", slug: "launch", status: "published", locale: "en", version: 3, liveRevisionId: "lr1", draftRevisionId: "dr1",
			updatedAt: "2026-10-01T10:00:00.000Z", publishedAt: "2026-10-01T10:00:00.000Z",
			data: { title: "Launch notes", excerpt: "What shipped in the launch.", content: "Body text." },
			seo: null,
		}],
		["posts:p2", {
			id: "p2", slug: "draft", status: "draft", locale: "en", version: 1, liveRevisionId: null, draftRevisionId: "dr2",
			updatedAt: "2026-10-01T11:00:00.000Z", publishedAt: null,
			data: { title: "Draft post", excerpt: "Not yet." }, seo: null,
		}],
		["pages:a1", {
			id: "a1", slug: "about", status: "published", locale: "en", version: 1, liveRevisionId: "lr3", draftRevisionId: null,
			updatedAt: "2026-10-01T09:00:00.000Z", publishedAt: "2026-10-01T09:00:00.000Z",
			data: { title: "About us", content: "We make things." },
			seo: { description: "Entry SEO description", title: null, ogTitle: null, ogDescription: null, image: null, canonical: null, noIndex: false },
		}],
		// A public type whose core SEO fields are off: the host row carries no seo.
		["notes:n1", {
			id: "n1", slug: "field-day", status: "published", locale: "en", version: 1, liveRevisionId: "lr4", draftRevisionId: null,
			updatedAt: "2026-10-01T08:00:00.000Z", publishedAt: "2026-10-01T08:00:00.000Z",
			data: { title: "Field day", excerpt: "Notes from the field." },
		}],
		["unrouted:u1", {
			id: "u1", slug: "behind", status: "published", locale: "en", version: 1, liveRevisionId: "lr5", draftRevisionId: null,
			updatedAt: "2026-10-01T07:00:00.000Z", publishedAt: "2026-10-01T07:00:00.000Z",
			data: { title: "Behind the scenes", excerpt: "Not routed." }, seo: null,
		}],
	]);
	const legacyOverrides = new Map<string, unknown>();
	const socialOverrides = new Map<string, unknown>();
	let publicUrlOverride: ((collection: string, id: string) => string | null) | null = null;
	let afterFirstGet: ((item: any) => any) | null = null;
	let getsSinceHook = 0;
	const ctx: any = {
		plugin: { id: "shipit-seo", version: "test" },
		site: { name: "Example Studio", url: "https://example.com", locale: "en" },
		settings: { get: async () => null, getVersioned: async () => null, compareAndSet: async () => ({ applied: false }), compareAndDelete: async () => ({ applied: false }) },
		kv: {
			get: async (key: string) => structuredClone(kv.get(key) ?? null),
			getVersioned: async (key: string) => (kv.has(key) ? { value: structuredClone(kv.get(key)), revision: revisions.get(key) } : null),
			compareAndSet: async (key: string, expected: string | null, value: unknown) => {
				if ((revisions.get(key) ?? null) !== expected) return { applied: false };
				counts.kvWrites += 1;
				kv.set(key, structuredClone(value));
				revisions.set(key, `r${++counter}`);
				return { applied: true, revision: revisions.get(key) };
			},
			compareAndDelete: async () => ({ applied: false }),
			set: async (key: string, value: unknown) => {
				counts.kvWrites += 1;
				kv.set(key, structuredClone(value));
				revisions.set(key, `r${++counter}`);
			},
			delete: async (key: string) => kv.delete(key),
			list: async () => [],
		},
		storage: {
			overrides: { get: async (id: string) => structuredClone(legacyOverrides.get(id) ?? null) },
			socialOverrides: {
				get: async (id: string) => structuredClone(socialOverrides.get(id) ?? null),
				put: async () => undefined,
				delete: async () => undefined,
			},
			schemas: {
				get: async () => null,
				query: async () => {
					counts.schemaQueries += 1;
					return { items: [], hasMore: false };
				},
			},
		},
		content: {
			listCollections: async () => [
				{ slug: "posts", label: "Posts", hasSeo: true, urlPattern: "/posts/{slug}", routable: true, hidden: false },
				{ slug: "pages", label: "Pages", hasSeo: true, urlPattern: "/pages/{slug}", routable: true, hidden: false },
				{ slug: "internal", label: "Internal", hasSeo: true, urlPattern: null, routable: true, hidden: true },
				{ slug: "notes", label: "Notes", hasSeo: false, urlPattern: "/notes/{slug}", routable: true, hidden: false },
				{ slug: "unrouted", label: "Unrouted", hasSeo: true, urlPattern: "/unrouted/{slug}", routable: false, hidden: false },
			],
			get: async (collection: string, id: string) => {
				counts.contentGets += 1;
				const item = structuredClone(items.get(`${collection}:${id}`) ?? null);
				getsSinceHook += 1;
				if (item && getsSinceHook > 1 && afterFirstGet) return afterFirstGet(item);
				return item;
			},
			list: async (collection: string, options: any) => {
				const where = options?.where ?? {};
				const rows = [...items.entries()]
					.filter(([key, item]) => key.startsWith(`${collection}:`) && (!where.status || item.status === where.status))
					.map(([, item]) => structuredClone(item));
				return { items: rows.slice(0, options?.limit ?? 50), hasMore: false };
			},
			getPublicUrl: async (collection: string, id: string) => {
				counts.publicUrl += 1;
				if (publicUrlOverride) return publicUrlOverride(collection, id);
				const item = items.get(`${collection}:${id}`);
				return item?.status === "published" ? `https://example.com/${collection}/${item.slug}` : null;
			},
		},
		log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
	};
	return {
		ctx, kv, items, counts, legacyOverrides, socialOverrides,
		setPublicUrl(fn: typeof publicUrlOverride) {
			publicUrlOverride = fn;
		},
		afterFirstGet(fn: typeof afterFirstGet) {
			afterFirstGet = fn;
			getsSinceHook = 0;
		},
		reset() {
			counts.kvWrites = 0;
			counts.schemaQueries = 0;
			counts.publicUrl = 0;
			counts.contentGets = 0;
			publicUrlOverride = null;
			afterFirstGet = null;
		},
	};
}

function tags(contributions: any[]) {
	const find = (kind: string, name: string) => contributions.find((item) => item.kind === kind && (item.name === name || item.property === name))?.content ?? "";
	return {
		description: find("meta", "description"),
		ogTitle: find("property", "og:title"),
		ogDescription: find("property", "og:description"),
		twitterTitle: find("meta", "twitter:title"),
		twitterDescription: find("meta", "twitter:description"),
	};
}

const values = { ...defaultSeoAdminTemplateSet(["posts"]).posts, description: "Read: {{description}}", socialTitle: "{{title}} on {{siteName}}" };
const previewInput = (patch: Record<string, unknown> = {}) => ({ collection: "posts", entryId: "p1", locale: "en", values, ...patch });

// --- Prediction equals the public hook after the save ------------------------

{
	const h = harness();
	const preview = await call("preview-admin-template", previewInput(), h.ctx);
	check("a published entry previews", preview.success === true, JSON.stringify(preview));
	check("preview reads no schema rows and writes nothing", h.counts.schemaQueries === 0 && h.counts.kvWrites === 0);
	check("preview observes the public URL once", h.counts.publicUrl === 1, String(h.counts.publicUrl));
	const configuration = await routes["admin-templates"].handler({}, h.ctx);
	const item = configuration.items.find((candidate: any) => candidate.collection === "posts");
	const saved = await call("save-admin-templates", { collection: "posts", expectedRevision: configuration.revision, inheritanceGuard: item.inheritanceGuard, values }, h.ctx);
	check("the previewed values save", saved.success === true && saved.outcome === "saved");
	h.counts.schemaQueries = 0;
	const emitted = tags(await hook({ page: { url: "https://example.com/posts/launch", path: "/posts/launch", locale: "en", kind: "content", canonical: "https://example.com/posts/launch", content: { collection: "posts", id: "p1", slug: "launch" }, seo: {}, articleMeta: {}, siteName: "Example Studio", siteUrl: "https://example.com" } }, h.ctx));
	const p = preview.preview;
	check("the prediction equals the hook's description", emitted.description === p.description.value && p.description.value === "Read: What shipped in the launch.", JSON.stringify([emitted, p.description]));
	check("the prediction equals the hook's social title tags", emitted.ogTitle === p.socialTitle.value && emitted.twitterTitle === p.socialTitle.value && p.socialTitle.value === "Launch notes on Example Studio");
	check("the prediction equals the hook's social description tags", emitted.ogDescription === p.socialDescription.value && emitted.twitterDescription === p.socialDescription.value);
	check("the title is a suggestion with its source", p.titleSuggestion.value === "Launch notes \u2014 Example Studio" && p.titleSuggestion.source === "template");
	check("the prediction names the exact entry, locale and URL", p.entryId === "p1" && p.locale === "en" && p.status === "published" && p.publicUrl === "https://example.com/posts/launch");
}

// --- Entry SEO wins --------------------------------------------------------

{
	const h = harness();
	const preview = await call("preview-admin-template", { ...previewInput({ collection: "pages", entryId: "a1" }), values: defaultSeoAdminTemplateSet(["pages"]).pages }, h.ctx);
	check("an entry SEO description wins over the template", preview.success && preview.preview.description.value === "Entry SEO description" && preview.preview.description.source === "core-seo");
}

// --- Refusals ----------------------------------------------------------------

{
	const h = harness();
	const refusal = async (input: unknown, error: string, label: string) => {
		const result = await call("preview-admin-template", input, h.ctx);
		check(label, result.success === false && result.error === error, JSON.stringify(result).slice(0, 200));
	};
	await refusal(previewInput({ entryId: "p2" }), "not_published", "a draft is not previewed as a public page");
	await refusal(previewInput({ locale: "fr" }), "locale_mismatch", "a locale other than the entry's is refused");
	await refusal(previewInput({ entryId: "missing" }), "not_found", "a missing entry is refused");
	await refusal(previewInput({ collection: "internal" }), "collection_unavailable", "a hidden content type is refused");
	await refusal(previewInput({ values: { ...values, title: "{{nope}}" } }), "invalid_values", "invalid template values are refused");
	h.setPublicUrl(() => null);
	await refusal(previewInput(), "no_public_url", "an entry without a public URL has no exact prediction");
	h.setPublicUrl(() => `https://example.com/${"x".repeat(9_000)}`);
	h.counts.publicUrl = 0;
	await refusal(previewInput(), "stored_value_too_large", "an oversized public URL is refused");
	check("an oversized URL is observed once, never looked up again", h.counts.publicUrl === 1);
	h.reset();

	h.items.get("posts:p1").data.content = "x".repeat(40_000);
	await refusal(previewInput(), "content_too_large", "content beyond the preview limits is refused before resolution");
	h.items.get("posts:p1").data.content = "Body text.";
	h.items.get("posts:p1").data.excerpt = "y".repeat(30_000);
	await refusal(previewInput({ values: { ...values, description: "{{description}} {{description}} {{description}}" } }), "expansion_too_large", "an expansion over its cap is refused before it is built");
	h.items.get("posts:p1").data.excerpt = "What shipped in the launch.";

	h.socialOverrides.set("posts:p1", { storageVersion: 1, ref: "posts:p1", title: "z".repeat(40_000), updatedAt: "2026-10-01T00:00:00.000Z" });
	await refusal(previewInput(), "stored_value_too_large", "a raw social override is bounded before it is trimmed");
	h.socialOverrides.clear();
	h.legacyOverrides.set("posts:p1", { title: "w".repeat(40_000) });
	await refusal(previewInput(), "stored_value_too_large", "a raw legacy override is bounded before it is used");
	h.legacyOverrides.clear();
	// Stored settings are validated on read; the host's own site name is not.
	h.kv.set("settings:siteName", "s".repeat(40_000));
	await refusal(previewInput(), "settings_unreadable", "oversized stored site settings are unreadable, so no preview is shown");
	h.kv.delete("settings:siteName");
	const hostName = h.ctx.site.name;
	h.ctx.site.name = "s".repeat(40_000);
	await refusal(previewInput(), "stored_value_too_large", "the host's site name is bounded before helpers read it");
	h.ctx.site.name = hostName;

	h.afterFirstGet((item) => ({ ...item, version: item.version + 1 }));
	await refusal(previewInput(), "entry_changed", "an entry that changes between reads is refused");
	h.afterFirstGet((item) => ({ ...item, slug: "s".repeat(10_000) }));
	await refusal(previewInput(), "entry_changed", "an oversized second observation is refused before comparison");
	h.reset();

	// Four fields of 19 expansions just under 16 KiB each exceed the 64 KiB answer.
	const bigValues = { title: "{{description}}".repeat(19), description: "{{description}}".repeat(19), socialTitle: "{{description}}".repeat(19), socialDescription: "{{description}}".repeat(19) };
	h.items.get("posts:p1").data.excerpt = "e".repeat(860);
	const big = await call("preview-admin-template", previewInput({ values: bigValues }), h.ctx);
	check("an answer over the envelope cap is refused, not truncated", big.success === false && big.error === "response_too_large");
	h.items.get("posts:p1").data.excerpt = "What shipped in the launch.";

	h.kv.set(METADATA_TEMPLATES_KEY, { version: 1, values: "broken" });
	await refusal(previewInput(), "templates_unreadable", "an unreadable template record allows no preview");
	h.kv.delete(METADATA_TEMPLATES_KEY);
	check("no refusal wrote anything or read schema rows", h.counts.kvWrites === 0 && h.counts.schemaQueries === 0);
}

// --- A public type without core SEO fields is a target -----------------------

{
	const h = harness();
	const notesValues = { ...defaultSeoAdminTemplateSet(["notes"]).notes, description: "Field report: {{description}}", socialTitle: "{{title}} from {{siteName}}" };
	const examples = await call("admin-template-examples", { collection: "notes", limit: 25 }, h.ctx);
	check("examples list a public type without core SEO fields", examples.success === true && examples.items.length === 1 && examples.items[0].entryId === "n1");
	const preview = await call("preview-admin-template", { collection: "notes", entryId: "n1", locale: "en", values: notesValues }, h.ctx);
	check("it previews", preview.success === true, JSON.stringify(preview).slice(0, 200));
	check("its preview reads no schema rows and writes nothing", h.counts.schemaQueries === 0 && h.counts.kvWrites === 0);
	const configuration = await routes["admin-templates"].handler({}, h.ctx);
	const item = configuration.items.find((candidate: any) => candidate.collection === "notes");
	check("its template is listed, while hidden and unroutable types are not",
		Boolean(item) && configuration.items.map((candidate: any) => candidate.collection).join(",") === "posts,pages,notes");
	const saved = await call("save-admin-templates", { collection: "notes", expectedRevision: configuration.revision, inheritanceGuard: item.inheritanceGuard, values: notesValues }, h.ctx);
	check("its template saves", saved.success === true && saved.outcome === "saved");
	const emitted = tags(await hook({ page: { url: "https://example.com/notes/field-day", path: "/notes/field-day", locale: "en", kind: "content", canonical: "https://example.com/notes/field-day", content: { collection: "notes", id: "n1", slug: "field-day" }, seo: {}, articleMeta: {}, siteName: "Example Studio", siteUrl: "https://example.com" } }, h.ctx));
	const p = preview.success ? preview.preview : null;
	check("the hook emits the prediction for a type without core SEO fields",
		Boolean(p) && emitted.description === p.description.value && p.description.value === "Field report: Notes from the field." &&
			emitted.ogTitle === p.socialTitle.value && emitted.twitterTitle === p.socialTitle.value && p.socialTitle.value === "Field day from Example Studio",
		JSON.stringify([emitted, p?.description, p?.socialTitle]).slice(0, 300));
	check("the template is the source of those tags", p?.description.source === "template" && p?.socialTitle.source === "template");
	const unrouted = await call("preview-admin-template", { collection: "unrouted", entryId: "u1", locale: "en", values: notesValues }, h.ctx);
	check("an unroutable type is still refused", unrouted.success === false && unrouted.error === "collection_unavailable");
	const unroutedExamples = await call("admin-template-examples", { collection: "unrouted", limit: 25 }, h.ctx);
	check("and lists no examples", unroutedExamples.success === false && unroutedExamples.error === "collection_unavailable");
}

// --- Examples ----------------------------------------------------------------

{
	const h = harness();
	const page = await call("admin-template-examples", { collection: "posts", limit: 25 }, h.ctx);
	check("examples list published entries only, with locale and slug",
		page.success && page.items.length === 1 && page.items[0].entryId === "p1" && page.items[0].locale === "en" && page.items[0].slug === "launch" && page.hasMore === false);
	const empty = await call("admin-template-examples", { collection: "pages", limit: 25 }, h.ctx);
	check("a collection with published entries lists them", empty.success && empty.items.length === 1);
	h.items.get("posts:p1").data.title = "t".repeat(5_000);
	const oversized = await call("admin-template-examples", { collection: "posts", limit: 25 }, h.ctx);
	check("an oversized listed title refuses the page before it is trimmed", oversized.success === false && oversized.error === "response_too_large");
	h.items.get("posts:p1").data.title = "Launch notes";
	h.items.get("posts:p1").data.content = "b".repeat(5_000_000);
	const body = await call("admin-template-examples", { collection: "posts", limit: 25 }, h.ctx);
	check("listing does not walk unused bodies", body.success === true);
	const hidden = await call("admin-template-examples", { collection: "internal", limit: 25 }, h.ctx);
	check("examples of a hidden content type are refused", hidden.success === false && hidden.error === "collection_unavailable");
}

// --- One exact example, independent of the listed page ------------------------

{
	const route = routes["admin-template-example"];
	check("the exact example route is a strict small POST for plugins:manage",
		route.permission === "plugins:manage" && JSON.stringify(route.methods) === JSON.stringify(["POST"]) &&
			route.request?.body === "json" && route.request?.maxBytes === SEO_ADMIN_TEMPLATE_SMALL_REQUEST_MAX_BYTES);
	check("its input names one collection and one entry ID, nothing else",
		route.input.safeParse({ collection: "posts", entryId: "p1" }).success === true &&
			route.input.safeParse({ collection: "posts", entryId: "p1", cursor: "next" }).success === false &&
			route.input.safeParse({ collection: "posts", entryId: "p1", locale: "en" }).success === false &&
			route.input.safeParse({ collection: "posts", entryId: "" }).success === false &&
			route.input.safeParse({ collection: "posts", entryId: "x".repeat(129) }).success === false &&
			route.input.safeParse({ collection: "x".repeat(65), entryId: "p1" }).success === false);

	const h = harness();
	for (let index = 0; index < 30; index += 1) {
		const id = `bulk${index}`;
		h.items.set(`posts:${id}`, {
			id, slug: `bulk-${index}`, status: "published", locale: index === 29 ? "fr" : "en", version: 1, liveRevisionId: `lb${index}`, draftRevisionId: null,
			updatedAt: "2026-09-01T00:00:00.000Z", publishedAt: "2026-09-01T00:00:00.000Z",
			data: { title: `Bulk ${index}`, excerpt: "Bulk entry.", content: "b".repeat(index === 28 ? 2_000_000 : 10) }, seo: null,
		});
	}
	let lists = 0;
	const list = h.ctx.content.list;
	h.ctx.content.list = async (...args: any[]) => {
		lists += 1;
		return list(...args);
	};
	const firstPage = await call("admin-template-examples", { collection: "posts", limit: 25 }, h.ctx);
	check("the published pager lists 25 rows without the requested entry",
		firstPage.success && firstPage.items.length === 25 && !firstPage.items.some((entry: any) => entry.entryId === "bulk29"));
	h.reset();
	lists = 0;
	const exact = await call("admin-template-example", { collection: "posts", entryId: "bulk29" }, h.ctx);
	check("an entry outside the first page resolves exactly, with its actual locale",
		exact.success === true && exact.contractVersion === SEO_ADMIN_CONTRACT_VERSION && exact.collection === "posts" && exact.entryId === "bulk29" &&
			exact.example.entryId === "bulk29" && exact.example.locale === "fr" && exact.example.title === "Bulk 29" && exact.example.slug === "bulk-29",
		JSON.stringify(exact).slice(0, 300));
	check("it carries only the listed option fields",
		exact.success === true && JSON.stringify(Object.keys(exact.example).sort()) === JSON.stringify(["entryId", "locale", "publishedAt", "slug", "title", "updatedAt"]));
	check("one exact read: no page, schema record, public URL or write",
		h.counts.contentGets === 1 && lists === 0 && h.counts.schemaQueries === 0 && h.counts.publicUrl === 0 && h.counts.kvWrites === 0,
		JSON.stringify({ ...h.counts, lists }));
	const large = await call("admin-template-example", { collection: "posts", entryId: "bulk28" }, h.ctx);
	check("an exact read does not walk an unused body", large.success === true && large.example.entryId === "bulk28");
	const french = await call("preview-admin-template", previewInput({ entryId: "bulk29", locale: exact.success ? exact.example.locale : "" }), h.ctx);
	check("the exact example previews with the locale it returned", french.success === true && french.preview.entryId === "bulk29" && french.preview.locale === "fr",
		JSON.stringify(french).slice(0, 200));

	const bound = async (input: { collection: string; entryId: string }, error: string, label: string) => {
		const result = await call("admin-template-example", input, h.ctx);
		check(label, result.success === false && result.error === error && result.collection === input.collection && result.entryId === input.entryId &&
			typeof result.message === "string" && !("example" in result), JSON.stringify(result).slice(0, 200));
	};
	h.reset();
	lists = 0;
	await bound({ collection: "posts", entryId: "p2" }, "not_published", "a draft is refused by name and selects nothing");
	await bound({ collection: "posts", entryId: "missing" }, "not_found", "a missing entry is refused by name");
	await bound({ collection: "posts", entryId: "a1" }, "not_found", "an entry of another collection is not found in this one");
	await bound({ collection: "internal", entryId: "p1" }, "collection_unavailable", "a hidden type is refused before content is read");
	await bound({ collection: "unrouted", entryId: "u1" }, "collection_unavailable", "an unroutable type is refused");
	await bound({ collection: "ghost", entryId: "g1" }, "collection_unavailable", "a missing type is refused");
	check("refusals read at most one entry each and never list pages", h.counts.contentGets === 3 && lists === 0, JSON.stringify({ ...h.counts, lists }));

	const get = h.ctx.content.get;
	h.ctx.content.get = async (collection: string, id: string) => ({ ...(await get(collection, id)), id: "p9" });
	await bound({ collection: "posts", entryId: "p1" }, "not_found", "a different returned ID is never shown as the request");
	h.ctx.content.get = async (collection: string, id: string) => ({ ...(await get(collection, id)), id: 7 });
	await bound({ collection: "posts", entryId: "p1" }, "not_found", "a numeric ID is compared without trimming");
	h.ctx.content.get = async () => {
		throw new Error("database is locked");
	};
	await bound({ collection: "posts", entryId: "p1" }, "content_unavailable", "a failed read is unavailable, not missing");
	h.ctx.content.get = get;

	for (const locale of ["", null, "x".repeat(36), 7]) {
		h.items.get("posts:p1").locale = locale;
		await bound({ collection: "posts", entryId: "p1" }, "invalid_locale", `stored locale ${JSON.stringify(locale)} is refused as unusable`);
	}
	h.items.get("posts:p1").locale = "en";
	h.items.get("posts:p1").data.title = "t".repeat(5_000);
	await bound({ collection: "posts", entryId: "p1" }, "response_too_large", "an oversized title is refused before it is trimmed");
	h.items.get("posts:p1").data.title = "Launch notes";
	h.items.get("posts:p1").slug = "s".repeat(3_000);
	await bound({ collection: "posts", entryId: "p1" }, "response_too_large", "an oversized slug is refused, not shortened");
	h.items.get("posts:p1").slug = "launch";

	for (const input of [{ collection: "posts" }, { collection: "posts", entryId: "" }, { collection: "Bad Type", entryId: "p1" }, { collection: "posts", entryId: "x".repeat(129) }, null]) {
		const result = await call("admin-template-example", input, h.ctx);
		check(`malformed input ${JSON.stringify(input)?.slice(0, 40)} has no bound result`,
			result.success === false && result.error === "invalid_input" && !("collection" in result) && !("entryId" in result));
	}

	const note = await call("admin-template-example", { collection: "notes", entryId: "n1" }, h.ctx);
	check("a public type without core SEO fields resolves", note.success === true && note.example.entryId === "n1");
	check("no exact read wrote anything or read schema rows", h.counts.kvWrites === 0 && h.counts.schemaQueries === 0);
}

// --- The canonical link and og:url name one effective canonical ---------------

{
	const h = harness();
	const R = "https://example.com/posts/launch";
	const C = "https://example.com/guides/launch";
	const L = "https://example.com/archive/launch";
	// The host overlays a core canonical onto the page context before hooks run.
	const postPage = (canonical: string | null, content: Record<string, string> = { collection: "posts", id: "p1", slug: "launch" }, locale = "en") => ({
		url: R, path: "/posts/launch", locale, kind: "content", canonical, content, seo: {}, articleMeta: {}, siteName: "Example Studio", siteUrl: "https://example.com",
	});
	const urls = async (page: unknown) => {
		const contributions = await hook({ page }, h.ctx);
		return {
			canonical: contributions.filter((item: any) => item.kind === "link" && item.rel === "canonical").map((item: any) => item.href),
			ogUrl: contributions.filter((item: any) => item.kind === "property" && item.property === "og:url").map((item: any) => item.content),
		};
	};
	const both = (found: { canonical: string[]; ogUrl: string[] }, expected: string) =>
		found.canonical.length === 1 && found.ogUrl.length === 1 && found.canonical[0] === expected && found.ogUrl[0] === expected;
	const neither = (found: { canonical: string[]; ogUrl: string[] }) => found.canonical.length === 0 && found.ogUrl.length === 0;
	const state = async (label: string, expected: string, source: string, pageCanonical: string) => {
		const found = await urls(postPage(pageCanonical));
		check(`${label}: one canonical link and one og:url, both the effective canonical`, both(found, expected), JSON.stringify(found));
		const entry = await call("admin-entry-preview", { ref: "posts:p1", entryOnly: true }, h.ctx);
		check(`${label}: the saved entry preview names that canonical and its source`,
			entry.success === true && entry.preview.search.url === expected && entry.preview.sources.canonical === source,
			JSON.stringify(entry.success ? [entry.preview.search.url, entry.preview.sources.canonical] : entry).slice(0, 200));
		const template = await call("preview-admin-template", previewInput(), h.ctx);
		check(`${label}: the Templates example keeps the entry's public route and locale`,
			template.success === true && template.preview.publicUrl === R && template.preview.entryId === "p1" && template.preview.locale === "en",
			JSON.stringify(template).slice(0, 200));
	};

	await state("no override", R, "generated", R);
	h.items.get("posts:p1").seo = { canonical: C };
	await state("core canonical", C, "core-seo", C);
	h.legacyOverrides.set("posts:p1", { canonical: L });
	await state("legacy over core", L, "legacy-override", C);
	h.legacyOverrides.delete("posts:p1");
	await state("legacy removed", C, "core-seo", C);
	h.items.get("posts:p1").seo = { canonical: null };
	await state("core cleared", R, "generated", R);

	h.items.get("posts:p1").seo = { canonical: "/guides/launch" };
	check("a relative core canonical resolves against the site URL for both", both(await urls(postPage(C)), C));
	h.items.get("posts:p1").seo = null;

	const RF = "https://example.com/fr/posts/launch";
	h.items.set("posts:p1fr", { ...structuredClone(h.items.get("posts:p1")), id: "p1fr", locale: "fr" });
	h.setPublicUrl((collection, id) => `https://example.com/${id === "p1fr" ? "fr/" : ""}${collection}/launch`);
	h.items.get("posts:p1").seo = { canonical: C };
	h.legacyOverrides.set("posts:p1", { canonical: L });
	check("an entry's core canonical and id-keyed legacy canonical do not describe another locale's entry with the same slug",
		both(await urls({ ...postPage(RF, { collection: "posts", id: "p1fr", slug: "launch" }, "fr"), url: RF, path: "/fr/posts/launch" }), RF));
	const french = await call("preview-admin-template", previewInput({ entryId: "p1fr", locale: "fr" }), h.ctx);
	check("its Templates example names its own route and locale", french.success === true && french.preview.publicUrl === RF && french.preview.locale === "fr");
	h.legacyOverrides.clear();
	h.items.get("posts:p1").seo = null;
	h.setPublicUrl(null);

	const G = "https://example.com/posts/launch/";
	check("a generated canonical follows the page's own canonical for both", both(await urls(postPage(G)), G));
	check("without a page canonical the public route names both", both(await urls(postPage(null)), R));
	const plain = (canonical: string | null) => ({ url: "https://example.com/search", path: "/search", locale: "en", kind: "custom", canonical, seo: {}, siteName: "Example Studio", siteUrl: "https://example.com" });
	check("a page without content names its own canonical for both", both(await urls(plain("https://example.com/find")), "https://example.com/find"));
	check("a page without content or canonical keeps the page URL for both", both(await urls(plain(null)), "https://example.com/search"));

	// Invalid values keep their precedence and contribute neither URL; the host's own output is separate.
	h.items.get("posts:p1").seo = { canonical: C };
	h.legacyOverrides.set("posts:p1", { canonical: "javascript:alert(1)" });
	check("an invalid legacy canonical still wins and the plugin contributes neither URL", neither(await urls(postPage(C))));
	const shadowed = await call("admin-entry-preview", { ref: "posts:p1", entryOnly: true }, h.ctx);
	check("and the saved entry preview still names the legacy source", shadowed.success === true && shadowed.preview.sources.canonical === "legacy-override");
	h.legacyOverrides.clear();
	h.items.get("posts:p1").seo = { canonical: "ftp://example.com/guides/launch" };
	check("an invalid core canonical contributes neither URL", neither(await urls(postPage(R))));
	h.items.get("posts:p1").seo = null;
	check("an invalid page canonical without content contributes neither URL", neither(await urls(plain("ftp://example.com/find"))));

	// URL parsing accepts these, but EmDash keeps a link only after an http(s):// prefix and renders any property.
	h.items.get("posts:p1").seo = { canonical: C };
	for (const value of ["https:example.com/archive/launch", "https:/example.com/archive/launch", "https:\\\\example.com/archive/launch", "\u0001https://example.com/archive/launch"]) {
		h.legacyOverrides.set("posts:p1", { canonical: value });
		const found = await urls(postPage(C));
		check(`${JSON.stringify(value)}: the legacy canonical link is unchanged and no og:url is added without a link EmDash keeps`,
			found.canonical.length === 1 && found.canonical[0] === value && found.ogUrl.length === 0, JSON.stringify(found));
	}

	for (const [value, expected] of [[` ${L}\n`, L], [`\t${L}`, L], ["HTTPS://EXAMPLE.COM/archive/launch", "HTTPS://EXAMPLE.COM/archive/launch"]]) {
		h.legacyOverrides.set("posts:p1", { canonical: value });
		check(`${JSON.stringify(value)}: a legacy value EmDash keeps as a link names both`, both(await urls(postPage(C)), expected));
	}
	h.legacyOverrides.clear();
	h.items.get("posts:p1").seo = null;
	const shorthandPage = await urls(plain("https:example.com/find"));
	check("a shorthand page canonical without content adds no og:url",
		shorthandPage.canonical.length === 1 && shorthandPage.canonical[0] === "https:example.com/find" && shorthandPage.ogUrl.length === 0, JSON.stringify(shorthandPage));
	h.kv.set("settings:siteName", "s".repeat(40_000));
	check("unreadable site settings contribute neither URL", neither(await urls(postPage(R))));
	h.kv.delete("settings:siteName");
	check("no URL case wrote anything", h.counts.kvWrites === 0);
}

// Native local image values have no src/url after the host normalizes a save.
{
	const h = harness();
	const item = h.items.get("notes:n1");
	const local = {
		id: "01LOCALPHOTO", provider: "local", mimeType: "image/jpeg",
		filename: "restaurant.jpg", width: 1600, height: 900, alt: "A restaurant dining room",
		meta: { storageKey: "01LOCALPHOTO.jpg" },
	};
	const featuredUrl = "https://example.com/_emdash/api/media/file/01LOCALPHOTO.jpg";
	const fallbackUrl = "https://example.com/site-social.jpg";
	await h.ctx.kv.set("settings:defaultOgImage", fallbackUrl);
	h.reset();
	item.data.featured_image = local;
	const effective = () => resolveEffectiveContentMetadata(h.ctx, "notes", item);
	const savedPreview = () => call("admin-entry-preview", { ref: "notes:n1", entryOnly: true }, h.ctx);
	const publicContributions = () => hook({ page: {
		url: "https://example.com/notes/field-day", path: "/notes/field-day", locale: "en",
		kind: "content", canonical: "https://example.com/notes/field-day",
		content: { collection: "notes", id: "n1", slug: "field-day" }, seo: {},
		articleMeta: {}, siteName: "Example Studio", siteUrl: "https://example.com",
	} }, h.ctx);
	const assertImage = async (label: string, expected: string, source: string) => {
		const metadata = await effective();
		const preview = await savedPreview();
		const contributions = await publicContributions();
		check(label + ": shared metadata resolves the image and source",
			metadata.image.value === expected && metadata.image.source === source && metadata.vars.image === expected, JSON.stringify(metadata.image));
		check(label + ": saved social preview uses the same image",
			preview.success === true && preview.preview.social.image === expected && preview.preview.sources.image === source,
			JSON.stringify(preview.success ? preview.preview.social : preview).slice(0, 250));
		check(label + ": public Twitter image uses the same shared resolution",
			contributions.some((entry: any) => entry.kind === "meta" && entry.name === "twitter:image" && entry.content === expected));
	};

	check("native local media uses its stored key without a src/url",
		imageFromContentData(item.data) === "/_emdash/api/media/file/01LOCALPHOTO.jpg" && !("src" in local));
	await assertImage("featured media with core SEO disabled", featuredUrl, "content");

	item.seo = { image: "https://example.com/entry-social.jpg" };
	await assertImage("specific SEO image takes precedence", "https://example.com/entry-social.jpg", "core-seo");
	item.seo.image = "/_emdash/api/media/file/manual-social.jpg";
	await assertImage("native SEO picker image takes precedence", "https://example.com/_emdash/api/media/file/manual-social.jpg", "core-seo");
	h.legacyOverrides.set("notes:n1", { ogImage: "https://example.com/legacy-social.jpg" });
	await assertImage("existing per-entry sharing override keeps precedence", "https://example.com/legacy-social.jpg", "legacy-override");
	h.legacyOverrides.clear();
	delete item.seo;

	delete item.data.featured_image;
	item.data.hero_image = local;
	await assertImage("declared image alias uses the shared fallback", featuredUrl, "content");
	delete item.data.hero_image;
	await assertImage("site image follows an absent featured image", fallbackUrl, "site-default");

	for (const unsafe of [
		"javascript:alert(1)", "java\nscript:alert(1)", "java\tscript:alert(1)",
		"data:image/png;base64,AAAA", "file:///tmp/image.jpg", "blob:https://example.com/image",
	]) {
		for (const value of [unsafe, { src: unsafe }, { url: unsafe }, { provider: "provider-images", previewUrl: unsafe }]) {
			item.data.featured_image = value;
			check("unsafe direct image is not selected: " + JSON.stringify(value), imageFromContentData(item.data) === "");
			await assertImage("unsafe image falls back: " + JSON.stringify(value), fallbackUrl, "site-default");
			const contributions = await publicContributions();
			check("unsafe image is never emitted: " + JSON.stringify(value),
				!contributions.some((entry: any) => ["og:image", "twitter:image"].includes(entry.property ?? entry.name) && entry.content === unsafe));
		}
	}
	delete item.data.featured_image;



	for (const [value, expected] of [
		[{ id: "local-id", provider: "local" }, "/_emdash/api/media/file/local-id"],
		[{ id: "local-id", provider: "local", src: "javascript:alert(1)", meta: { storageKey: "safe key.jpg" } }, "/_emdash/api/media/file/safe%20key.jpg"],
		[{ asset: { _type: "reference", _ref: "local-ref" } }, "/_emdash/api/media/file/local-ref"],
		[{ id: "local-id", meta: { storageKey: "photos/dining room?#%.jpg" } }, "/_emdash/api/media/file/photos/dining%20room%3F%23%25.jpg"],
		[{ id: "local-id", meta: { storageKey: "../photo.jpg" } }, "/_emdash/api/media/file/..%2Fphoto.jpg"],
		[{ id: "remote-id", provider: "external", src: "https://images.example/remote.jpg" }, "https://images.example/remote.jpg"],
		[{ id: "remote-id", provider: "provider-images", previewUrl: "https://images.example/provider.jpg" }, "https://images.example/provider.jpg"],
		[{ id: "remote-id", provider: "provider-images" }, ""],
		[{ provider: "provider-images", asset: { id: "remote-id" } }, ""],
		["/legacy-featured.jpg", "/legacy-featured.jpg"],
		["images/relative-featured.jpg", "images/relative-featured.jpg"],
		["//images.example/feature.jpg", "//images.example/feature.jpg"],
		[null, ""],
	] as const) {
		check("stored media value resolves without a lookup: " + JSON.stringify(value),
			featuredImageFromContentData({ featured_image: value }) === expected);
	}
	check("image fallback resolution made no storage writes", h.counts.kvWrites === 0);
}

// A native Save can leave the base row unchanged until publish. Admin schema
// prediction uses the same verified saved revision as the search preview.
{
	for (const id of ["p1", "p2"]) {
		const h = harness();
		const ref = "posts:" + id;
		const base = h.items.get(ref);
		base.seo = { description: "tes", title: null, canonical: null, noIndex: false };
		const before = JSON.stringify(base);
		const snapshot = createSavedContentSnapshot(ref, base, { id: base.draftRevisionId, collection: "posts", entryId: id,
			data: { title: "test", content: "Saved draft body.", _slug: "test" } });
		const stored = await call("entry-schema-preview", { ref, entryOnly: true }, h.ctx);
		const predicted = await call("entry-schema-preview", { ref, entryOnly: true, snapshot }, h.ctx);
		const article = (result: any) => result.success ? result.items.find((row: any) => row.emitted && row.types.includes("BlogPosting"))?.graph : null;
		const oldArticle = article(stored);
		const draftArticle = article(predicted);
		check(id + ": stored schema keeps the base title and route",
			oldArticle?.headline === base.data.title && oldArticle?.["@id"] === "https://example.com/posts/" + base.slug + "#article", JSON.stringify(oldArticle));
		check(id + ": saved draft schema uses its current headline and route",
			draftArticle?.headline === "test" && draftArticle?.["@id"] === "https://example.com/posts/test#article" &&
			["https://example.com/posts/test", "https://example.com/posts/test#webpage"].includes(typeof draftArticle?.mainEntityOfPage === "string" ? draftArticle.mainEntityOfPage : draftArticle?.mainEntityOfPage?.["@id"]) && draftArticle?.description === "tes", JSON.stringify(draftArticle));
		check(id + ": saved draft projection retains the stored publication timestamp",
			draftArticle?.dateModified === base.updatedAt, JSON.stringify(draftArticle?.dateModified));
		check(id + ": schema predictions neither publish nor mutate stored content",
			JSON.stringify(h.items.get(ref)) === before && h.counts.kvWrites === 0);
		if (id === "p1") {
			const output = await hook({ page: { url: "https://example.com/posts/launch", path: "/posts/launch", locale: "en",
				kind: "content", canonical: "https://example.com/posts/launch", content: { collection: "posts", id, slug: "launch" },
				pageTitle: base.data.title, seo: {}, articleMeta: {}, siteName: "Example Studio", siteUrl: "https://example.com" } }, h.ctx);
			const json = JSON.stringify(output);
			check("a saved draft prediction leaves public schema on the published base",
				json.includes('"headline":"Launch notes"') && !json.includes('"headline":"test"') && !json.includes("/posts/test#article"), json);
		}
	}
}

if (failures) {
	console.error(`\n${failures} metadata template preview self-check(s) failed.`);
	process.exit(1);
}
console.log("\nAll metadata template preview self-checks passed.");
