import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SEO_SCORE_VERSION, classifySeoContentCheck, seoScoreDisplay } from "./analysis.ts";
import { ANALYZER_20_FIXTURES } from "./analyzer20-compat.selfcheck.ts";
import { presentSeoChecks, seoCheckTotalsText } from "./check-presentation.ts";
import {
	SEO_MODULES,
	analyzeContentPreview,
	readCurrentScoreRevision,
	scoreContentSourceVersion,
} from "./entry-analysis-runtime.ts";
import { seoPlugin } from "./index.ts";
import registryEntry from "./registry-entry.ts";
import { seoRegistryManifest } from "./registry-manifest.ts";
import {
	SEO_OVERVIEW_CHECK_ACTION,
	SEO_OVERVIEW_PANEL,
	SEO_REGISTRY_STORAGE,
	handleSeoOverviewPanel,
	panelIdentity,
	panelInteraction,
} from "./registry-panel.ts";

// The host validates panel responses with the blocks package that its own
// emdash build depends on, so resolve the validator through emdash.
const blocksServer = createRequire(fileURLToPath(import.meta.resolve("emdash"))).resolve("@emdash-cms/blocks/server");
const { validateBlockResponse, validateContentEditorPanelInteraction } = await import(pathToFileURL(blocksServer).href);
const hostPolicy = { pluginPagePaths: [], allowedImageHosts: [] };

function assertValidResponse(response: any) {
	const result = validateBlockResponse(response, hostPolicy);
	assert.equal(result.valid, true, JSON.stringify(result.errors ?? result, null, 2));
	return response;
}

function text(response: any): string {
	return JSON.stringify(response.blocks);
}

function findBlock(blocks: any[], predicate: (block: any) => boolean): any {
	for (const block of blocks) {
		if (predicate(block)) return block;
		const nested = [
			...(Array.isArray(block.blocks) ? block.blocks : []),
			...(Array.isArray(block.panels) ? block.panels.flatMap((panel: any) => panel.blocks) : []),
			...(Array.isArray(block.elements) ? block.elements : []),
		];
		const found = nested.length ? findBlock(nested, predicate) : undefined;
		if (found) return found;
	}
	return undefined;
}

const checkButton = (response: any) => findBlock(response.blocks, (block) => block.action_id === SEO_OVERVIEW_CHECK_ACTION);

// Registration contract.
const manifest = seoRegistryManifest();
const native = seoPlugin().storage ?? {};
assert.deepEqual(Object.keys(manifest.storage).sort(), ["overrides", "schemas", "scores"]);
for (const [name, declaration] of Object.entries(manifest.storage)) {
	assert.match(name, /^[a-z][a-z0-9_]*$/);
	assert.deepEqual(declaration.indexes, native[name]?.indexes, `${name} indexes must match the native descriptor`);
}
assert.deepEqual(manifest.capabilities, ["content:read", "content:revisions:read", "schema:read"]);
assert.deepEqual(manifest.allowedHosts, []);
assert.deepEqual(manifest.admin.editorPanels.map((panel) => panel.route), [SEO_OVERVIEW_PANEL.route]);
assert.deepEqual(Object.keys(registryEntry.routes ?? {}), [SEO_OVERVIEW_PANEL.route]);
assert.equal((registryEntry.routes as any)[SEO_OVERVIEW_PANEL.route].permission, "content:edit_own");
assert.equal((registryEntry as any).hooks, undefined);

// Identity is accepted only from a host-attested panel context.
const ui = (entry: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
	surface: "content-editor-panel",
	locale: "en",
	direction: "ltr",
	extensionId: SEO_OVERVIEW_PANEL.id,
	entry: { collection: "posts", id: "post-1", locale: "en", version: 4, ...entry },
	...extra,
});
assert.deepEqual(panelIdentity(ui()), { collection: "posts", id: "post-1", locale: "en", version: 4 });
assert.equal(panelIdentity(undefined), null);
assert.equal(panelIdentity(ui({}, { surface: "admin-page" })), null);
assert.equal(panelIdentity(ui({}, { extensionId: "other-panel" })), null);
assert.equal(panelIdentity(ui({ collection: "products" })), null);
assert.equal(panelIdentity(ui({ version: "4" })), null);
assert.equal(panelIdentity(ui({ id: "" })), null);

assert.deepEqual(panelInteraction({ type: "panel_load" }), { kind: "load" });
assert.deepEqual(panelInteraction({ type: "block_action", action_id: SEO_OVERVIEW_CHECK_ACTION, value: { version: 4 } }), { kind: "check", version: 4 });
assert.deepEqual(panelInteraction({ type: "block_action", action_id: SEO_OVERVIEW_CHECK_ACTION, value: { version: 4, id: "post-2" } }), { kind: "invalid" });
assert.deepEqual(panelInteraction({ type: "block_action", action_id: SEO_OVERVIEW_CHECK_ACTION }), { kind: "invalid" });
assert.deepEqual(panelInteraction({ type: "block_action", action_id: "other", value: { version: 4 } }), { kind: "invalid" });
assert.deepEqual(panelInteraction({ type: "form_submit", action_id: SEO_OVERVIEW_CHECK_ACTION, values: {} }), { kind: "invalid" });
assert.equal(validateContentEditorPanelInteraction({ type: "block_action", action_id: SEO_OVERVIEW_CHECK_ACTION, value: { version: 4 } }).valid, true);

// A fake site with the storage the registry manifest declares and write traps.
interface FakeOptions {
	post?: Record<string, any>;
	kv?: Record<string, unknown>;
	scores?: Record<string, unknown>;
	revision?: Record<string, any> | null;
	collections?: Array<Record<string, unknown>>;
	contentGetError?: Error;
	withoutContent?: boolean;
}

const basePost = {
	id: "post-1", type: "posts", slug: "useful-canonical-checks", status: "published", locale: "en", version: 4,
	authorId: "user-1", draftRevisionId: null, liveRevisionId: "rev-live",
	createdAt: "2026-09-30T08:00:00.000Z", updatedAt: "2026-09-30T09:00:00.000Z", publishedAt: "2026-09-30T09:00:00.000Z",
	seo: { title: "Checking canonical URLs before publishing", description: "", image: null, canonical: null, noIndex: false },
	data: {
		title: "Checking a Canonical URL Before Publishing",
		excerpt: "How to confirm the canonical URL of a page before it goes live.",
		content: [{ _type: "block", style: "normal", markDefs: [], children: [{ _type: "span", text: "Canonical URLs tell search engines which address to index.", marks: [] }] }],
	},
};

function siteSettings(overrides: Record<string, unknown> = {}) {
	return {
		version: 1, updatedAt: "2026-09-30T07:00:00.000Z", siteName: "Demo site", siteUrl: "https://example.com",
		publisherType: "organization", organizationName: "Demo site", organizationLogo: "", personName: "",
		socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "",
		noindex: false, contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1, ...overrides,
	};
}

function fakeSite(options: FakeOptions = {}) {
	const counters = { writes: 0, contentGets: 0, revisionGets: 0, schemaQueries: 0, scoreGets: 0 };
	const rejectWrite = () => { counters.writes += 1; throw new Error("Unexpected write"); };
	const post = structuredClone(options.post ?? basePost);
	const kv = new Map(Object.entries({
		"settings:global:v1": siteSettings(),
		"configuration:analysis-profile:v1:posts": { profile: "article", version: 1, updatedAt: "2026-10-15T00:00:00.000Z" },
		...options.kv,
	}));
	const scores = new Map(Object.entries(options.scores ?? {}));
	const forbiddenQuery = async () => { throw new Error("Unexpected storage inventory query"); };
	// Entry analysis may read custom schemas for global, collection and entry
	// scopes only; the site-wide inventory read is what the panel must never do.
	const scopedSchemaQuery = async (query: any) => {
		const scopes = query?.where?.scope?.in;
		// An empty or missing scope is a legacy site-wide row, read as the public reader reads it.
		const entryScopes = new Set(["global", "", "posts", `posts:${post.id}`, `posts:${post.slug}`, `posts:${options.revision?.data?._slug}`]);
		const legacyNull = query?.where && Object.keys(query.where).length === 1 && query.where.scope === null;
		if (!legacyNull && (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((scope) => entryScopes.has(scope))))
			throw new Error("Unscoped custom schema inventory read");
		counters.schemaQueries += 1;
		return { items: [], hasMore: false };
	};
	const collection = (read: (id: string) => unknown, query: (options: any) => Promise<unknown> = forbiddenQuery) => ({
		get: async (id: string) => read(id),
		getMany: async () => new Map(),
		query,
		count: async () => 0,
		exists: async () => false,
		put: rejectWrite, putMany: rejectWrite, delete: rejectWrite, deleteMany: rejectWrite,
		compareAndSet: rejectWrite, compareAndDelete: rejectWrite, updateIf: rejectWrite,
	});
	const ctx: any = {
		plugin: { id: "shipit-seo", version: "test" },
		site: { name: "Demo site", url: "https://example.com", locale: "en" },
		schema: {
			listCollections: async () => options.collections ?? [
				{ slug: "posts", label: "Posts", labelSingular: "Post", hasSeo: true, urlPattern: "/posts/{slug}", routable: true, hidden: false, fields: [{ slug: "content", type: "portableText" }] },
				{ slug: "pages", label: "Pages", labelSingular: "Page", hasSeo: true, urlPattern: "/{slug}", routable: true, hidden: false, fields: [] },
			],
		},
		kv: {
			get: async (key: string) => structuredClone(kv.get(key) ?? null),
			getVersioned: async (key: string) => (kv.has(key) ? { value: structuredClone(kv.get(key)), revision: "r1" } : null),
			list: async () => [],
			set: rejectWrite, delete: rejectWrite, compareAndSet: rejectWrite, compareAndDelete: rejectWrite,
		},
		// Mirrors the sandbox bridge: any name resolves, undeclared ones fail on use.
		storage: new Proxy({
			scores: collection((id) => { counters.scoreGets += 1; return structuredClone(scores.get(id) ?? null); }),
			overrides: collection(() => null),
			schemas: collection(() => null, scopedSchemaQuery),
		} as Record<string, unknown>, {
			get: (declared, name) => declared[String(name)] ?? collection(() => {
				throw new Error(`Storage collection not declared: ${String(name)}`);
			}),
		}),
		content: options.withoutContent ? undefined : {
			get: async (_collection: string, id: string) => {
				counters.contentGets += 1;
				if (options.contentGetError) throw options.contentGetError;
				return id === post.id ? structuredClone(post) : null;
			},
			getPublicUrl: async (_collection: string, id: string) =>
				id === post.id && post.status === "published" ? `https://example.com/posts/${post.slug}` : null,
			...(options.revision === undefined ? {} : {
				getRevision: async (_collection: string, entryId: string, revisionId: string) => {
					counters.revisionGets += 1;
					return options.revision && entryId === post.id && revisionId === post.draftRevisionId ? structuredClone(options.revision) : null;
				},
			}),
		},
		url: (path: string) => new URL(path, "https://example.com").href,
		log: { warn() {}, info() {}, error() {}, debug() {} },
	};
	return { ctx, counters, post, scores, kv };
}

const load = { type: "panel_load" };
const check = (version = 4) => ({ type: "block_action", action_id: SEO_OVERVIEW_CHECK_ACTION, value: { version } });

// Opening the panel reads only this entry and its stored score.
{
	const { ctx, counters } = fakeSite();
	const response = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, ctx));
	assert.equal(counters.writes, 0);
	assert.equal(counters.contentGets, 1);
	assert.equal(counters.scoreGets, 1);
	assert.equal(counters.schemaQueries, 0, "an absent score needs no configuration enumeration");
	assert.equal(response.toast, undefined);
	assert.match(text(response), /No saved score yet/);
	assert.match(text(response), /Opening this panel never runs a check/);
	assert.match(text(response), /Unsaved changes in the editor are not included/);
	assert.match(text(response), /Source: Entry SEO field/);
	assert.ok(findBlock(response.blocks, (block) => block.type === "banner" && block.title === "Registry build limits"));
	assert.match(text(response), /Live page tags come from EmDash and your theme; this build does not publish them yet/);
	assert.match(text(response), /cannot read per-entry social overrides, which would replace this value/);
	assert.match(text(response), /Per-entry robots directives .* are not included: this build cannot read them/);
	assert.match(text(response), /EmDash noindex/);
	assert.doesNotMatch(text(response), /block indexing/);
	assert.deepEqual(checkButton(response)?.value, { version: 4 });
	assert.equal(findBlock(response.blocks, (block) => block.type === "meter"), undefined);
	const tabs = findBlock(response.blocks, (block) => block.type === "tab");
	assert.deepEqual(tabs.panels.map((panel: any) => panel.label), ["Findings", "Search", "Indexing"]);
}

// The explicit check analyzes the saved version once and keeps the result disposable.
{
	const { ctx, counters } = fakeSite();
	const response = assertValidResponse(await handleSeoOverviewPanel({ input: check(), ui: ui() }, ctx));
	assert.equal(counters.writes, 0);
	assert.equal(response.toast?.type, "success");
	assert.equal(findBlock(response.blocks, (block) => block.type === "meter"), undefined, "a session check without native data shows no overall score");
	const stats = findBlock(response.blocks, (block) => block.type === "stats");
	assert.deepEqual(stats.items.map((item: any) => item.label), ["Issues", "Suggestions", "Not checked"]);
	assert.match(text(response), /Not saved to score history/);
	assert.match(text(response), /No overall score is shown because \d+ checks need data this build cannot read/);
	assert.match(text(response), /Findings \(\d+\)/);
	assert.match(response.toast?.message ?? "", /checks were not evaluated/);
	assert.equal(checkButton(response)?.label, "Check saved version again");
	assert.ok(counters.contentGets >= 2, "the analysis re-reads the entry to detect concurrent saves");
	assert.ok(counters.schemaQueries >= 1, "the check reads custom schemas for this entry's scopes");

	// Checks that need focus keyword or per-entry schema data are listed, not presented as findings.
	const notEvaluated = findBlock(response.blocks, (block) => block.block_id === "seo-overview:findings:unreadable");
	assert.match(notEvaluated.label, /Not evaluated in this build: \d+/);
	const notEvaluatedText = JSON.stringify(notEvaluated.blocks);
	assert.match(notEvaluatedText, /Focus keyword: needs the stored focus keyword/);
	assert.match(notEvaluatedText, /Focus keyword repetition: needs the stored focus keyword/);
	assert.match(notEvaluatedText, /needs per-entry schema settings/);
	assert.doesNotMatch(notEvaluatedText, /pillar/, "pillar status no longer sets any target");
	const findingBlocks = findBlock(response.blocks, (block) => block.type === "tab").panels[0].blocks.filter((block: any) => block.block_id !== "seo-overview:findings:unreadable");
	const findings = JSON.stringify(findingBlocks);
	assert.doesNotMatch(findings, /Focus keyword|Structured data|keyword/i);
	assert.ok(findBlock(findingBlocks, (block) => block.type === "section" && block.text === "Failed: Body text length"), "body length is evaluated");
	assert.ok(findBlock(findingBlocks, (block) => block.type === "section" && block.text === "Failed: Internal links"), "internal links are evaluated");
	// The panel shows the editor's groups and pills for the same evaluated rows.
	const seedSite = fakeSite();
	const declaredCtx = { ...seedSite.ctx, storage: Object.fromEntries(SEO_REGISTRY_STORAGE.map((name) => [name, seedSite.ctx.storage[name]])) };
	const readable = (await analyzeContentPreview(declaredCtx, "posts", structuredClone(basePost))).checks
		.filter((item: any) => item.category !== "keyword" && !["focus-keyword", "secondary-keyword-coverage", "schema"].includes(item.id));
	const expected = presentSeoChecks({ checks: readable, scoreVersion: SEO_SCORE_VERSION, assessmentProfile: { profile: "article", version: 1 } });
	assert.deepEqual(findingBlocks.filter((block: any) => block.type === "accordion").map((block: any) => block.label),
		expected.groups.map((group) => `${group.label}: ${group.pill.text}`));
	assert.deepEqual(stats.items.map((item: any) => item.value), [expected.totals.issues, expected.totals.suggestions, expected.totals.notChecked]);
	assert.match(text(response), new RegExp(`Findings \\(${expected.totals.issues}\\)`));
}

// A check for an older version, or a forged value, analyzes nothing.
{
	const { ctx, counters } = fakeSite();
	const stale = assertValidResponse(await handleSeoOverviewPanel({ input: check(3), ui: ui() }, ctx));
	assert.match(text(stale), /The entry was saved again/);
	assert.equal(stale.toast?.type, "info");
	assert.equal(findBlock(stale.blocks, (block) => block.type === "meter"), undefined);
	assert.equal(counters.contentGets, 1);
	const forged = assertValidResponse(await handleSeoOverviewPanel({
		input: { type: "block_action", action_id: SEO_OVERVIEW_CHECK_ACTION, value: { version: 4, collection: "pages", id: "page-9" } },
		ui: ui(),
	}, ctx));
	assert.match(text(forged), /That action is not available/);
	assert.equal(findBlock(forged.blocks, (block) => block.type === "meter"), undefined);
	assert.equal(counters.writes, 0);
}

// Without a host-attested entry nothing is read.
{
	const { ctx, counters } = fakeSite();
	for (const forgedUi of [undefined, { entry: { collection: "posts", id: "post-1", locale: "en", version: 4 } }, ui({}, { extensionId: "x" })]) {
		const response = await handleSeoOverviewPanel({ input: check(), ui: forgedUi }, ctx);
		assert.match(text(response), /Open this overview from the content editor/);
	}
	assert.equal(counters.contentGets, 0);
}

// Locale and identity must match the stored entry.
{
	const { ctx } = fakeSite({ post: { ...basePost, locale: "fr" } });
	const response = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, ctx));
	assert.match(text(response), /The entry did not match the editor/);
}

// A save between the host read and the plugin read is reported, not analyzed.
{
	const { ctx, counters } = fakeSite({ post: { ...basePost, version: 5 } });
	const response = assertValidResponse(await handleSeoOverviewPanel({ input: check(), ui: ui() }, ctx));
	assert.match(text(response), /saved while the panel was loading/);
	assert.equal(counters.contentGets, 1);
}

// Stored scores: the panel proves staleness from entry-scoped revisions and
// never claims a score current, because it does not read the schema inventory.
{
	const seed = fakeSite();
	const declaredOnly = { ...seed.ctx, storage: Object.fromEntries(SEO_REGISTRY_STORAGE.map((name) => [name, seed.ctx.storage[name]])) };
	await assert.rejects(readCurrentScoreRevision(declaredOnly), /Unscoped custom schema inventory read/, "the guard rejects the site-wide read");
	const session = await analyzeContentPreview(declaredOnly, "posts", structuredClone(basePost));
	const symbolSession = await analyzeContentPreview(declaredOnly, "posts", structuredClone(basePost), "\u{1f355}");
	assert.deepEqual([symbolSession.keyword, symbolSession.keywords], [undefined, []],
		"a keyword with nothing to match is left out of the analysis and of the record's keyword list alike");
	const { persistence: _persistence, freshness: _freshness, ...stored } = session as any;
	// Persisted scores carry the site-wide fingerprint; the panel must not compare it.
	const record = { ...stored, analysisRevision: 1, sourceVersion: scoreContentSourceVersion(basePost), configurationFingerprint: "seo-config-v1-sitewide" };

	const matching = fakeSite({ scores: { "posts:post-1": record } });
	const matched = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, matching.ctx));
	assert.equal(findBlock(matched.blocks, (block) => block.type === "meter").label, "Saved SEO score");
	assert.match(text(matched), /Matches the saved version 4, en, its content type template and SEO feature controls/);
	assert.match(text(matched), /Site-wide SEO settings and custom schemas are not re-checked when this panel opens/);
	assert.doesNotMatch(text(matched), /out of date|is current/);
	assert.equal(matching.counters.schemaQueries, 0, "opening the panel reads no custom schemas");
	assert.equal(matching.counters.scoreGets, 1);
	assert.equal(matching.counters.writes, 0);
	for (const id of ["title", "description"]) {
		assert.equal(record.checks.find((check: any) => check.id === id).status, "pass", `${id} presence is not a stored finding`);
	}
	const nativeFindings = record.checks.filter((check: any) => classifySeoContentCheck(check).issue);
	assert.ok(nativeFindings.length > 0, "the native fixture has unresolved scored checks");
	for (const check of nativeFindings) {
		assert.ok(findBlock(matched.blocks, (block) => block.type === "section" &&
			block.text === `${check.status === "fail" ? "Failed" : "Partly met"}: ${check.label}`),
			`stored finding ${check.id} comes from the native analysis`);
	}
	assert.equal(findBlock(matched.blocks, (block) => block.block_id === "seo-overview:findings:unreadable"), undefined);
	// Same groups, pills and band as the editor for the same stored result.
	const display = seoScoreDisplay(record);
	const storedPresentation = presentSeoChecks(record);
	assert.equal(findBlock(matched.blocks, (block) => block.type === "meter").value, display.score);
	assert.ok(findBlock(matched.blocks, (block) => block.type === "context" &&
		block.text === `${display.label}${display.qualifier ? `. ${display.qualifier}` : ""}. ${seoCheckTotalsText(storedPresentation.totals)}.`), "band and header counts");
	assert.deepEqual(
		findBlock(matched.blocks, (block) => block.type === "tab").panels[0].blocks.filter((block: any) => block.type === "accordion").map((block: any) => [block.label, block.default_open]),
		storedPresentation.groups.map((group) => [`${group.label}: ${group.pill.text}`, group.id === storedPresentation.defaultOpenGroupId]));
	assert.doesNotMatch(text(matched), /Needs work|Needs attention|To review|Passed and informational/);

	const renamed = fakeSite({
		scores: { "posts:post-1": record },
		kv: { "settings:global:v1": siteSettings({ siteName: "Renamed site", updatedAt: "2026-10-01T10:00:00.000Z" }) },
	});
	const unverified = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, renamed.ctx));
	assert.match(text(unverified), /not re-checked when this panel opens/, "site-wide settings changes are reported as unverified, not current or stale");
	assert.doesNotMatch(text(unverified), /out of date/);

	const edited = fakeSite({ post: { ...basePost, version: 5, updatedAt: "2026-10-01T09:00:00.000Z" }, scores: { "posts:post-1": record } });
	const contentStale = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui({ version: 5 }) }, edited.ctx));
	assert.match(text(contentStale), /Saved score is out of date/);
	assert.match(text(contentStale), /The entry was saved after this score/);

	const olderRules = fakeSite({ scores: { "posts:post-1": { ...record, scoreVersion: SEO_SCORE_VERSION - 1 } } });
	assert.match(text(assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, olderRules.ctx))), /analysis rules changed since this score/);

	// A frozen analyzer 20 record never renders a number, band or meter.
	const frozen = ANALYZER_20_FIXTURES["d+"].score;
	const frozenRecord = { ...frozen, ref: "posts:post-1", entryId: "post-1", sourceVersion: scoreContentSourceVersion(basePost),
		templateUpdatedAt: record.templateUpdatedAt, modulesUpdatedAt: record.modulesUpdatedAt };
	const earlier = fakeSite({ scores: { "posts:post-1": frozenRecord } });
	const earlierResponse = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, earlier.ctx));
	assert.equal(findBlock(earlierResponse.blocks, (block) => block.type === "meter"), undefined);
	assert.ok(findBlock(earlierResponse.blocks, (block) => block.type === "context" && block.text === "Earlier analyzer. Analyze again."));
	assert.match(text(earlierResponse), /Saved score is out of date/);
	assert.doesNotMatch(text(earlierResponse), /\d+ \/ 100|Good|Needs improvement|Poor/, "no number or band");
	const earlierGroups = findBlock(earlierResponse.blocks, (block) => block.type === "tab").panels[0].blocks.filter((block: any) => block.type === "accordion");
	assert.ok(earlierGroups.length > 0 && earlierGroups.every((block: any) => /: Earlier analyzer$/.test(block.label) && block.default_open === false));
	assert.ok(findBlock(earlierResponse.blocks, (block) => block.type === "section" && /^Earlier result: /.test(block.text)));
	assert.match(text(earlierResponse), /Findings \(0\)/);
	assert.equal(earlier.counters.writes, 0);

	// A partially checked result shows its dash state, never a meter.
	const templatePost = { ...basePost, data: { ...basePost.data, body_source: "template" } };
	const templateSeed = fakeSite({ post: templatePost });
	const templateCtx = { ...templateSeed.ctx, storage: Object.fromEntries(SEO_REGISTRY_STORAGE.map((name) => [name, templateSeed.ctx.storage[name]])) };
	const { persistence: _templatePersistence, freshness: _templateFreshness, ...templateStored } =
		await analyzeContentPreview(templateCtx, "posts", structuredClone(templatePost)) as any;
	const templateRecord = { ...templateStored, analysisRevision: 1, sourceVersion: scoreContentSourceVersion(templatePost), configurationFingerprint: "seo-config-v1-sitewide" };
	const partialDisplay = seoScoreDisplay(templateRecord);
	assert.deepEqual([partialDisplay.score, partialDisplay.label], [null, "Partially checked"]);
	const partial = fakeSite({ post: templatePost, scores: { "posts:post-1": templateRecord } });
	const partialResponse = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, partial.ctx));
	assert.equal(findBlock(partialResponse.blocks, (block) => block.type === "meter"), undefined);
	assert.ok(findBlock(partialResponse.blocks, (block) => block.type === "context" &&
		block.text.startsWith(`Partially checked. ${partialDisplay.qualifier}. `)), "the dash reason is named");
	assert.match(text(partialResponse), /Matches the saved version 4/);

	const modules = fakeSite({
		scores: { "posts:post-1": record },
		kv: { "configuration:modules:v1": { version: 1, updatedAt: "2026-10-01T11:00:00.000Z", values: Object.fromEntries(SEO_MODULES.map((module) => [module.key, false])) } },
	});
	const modulesStale = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, modules.ctx));
	assert.match(text(modulesStale), /The SEO feature controls changed since this score/);
	assert.equal(modules.counters.schemaQueries, 0);

	const { sourceVersion: _sourceVersion, ...untrackedRecord } = record;
	const untracked = fakeSite({ scores: { "posts:post-1": untrackedRecord } });
	const legacy = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, untracked.ctx));
	assert.match(text(legacy), /This saved score has no version record/);
	assert.doesNotMatch(text(legacy), /Matches the saved version/);

	const scoringOff = fakeSite({ scores: { "posts:post-1": record }, kv: { "settings:global:v1": siteSettings({ contentScoringEnabled: false }) } });
	const offLoad = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, scoringOff.ctx));
	assert.equal(checkButton(offLoad), undefined);
	assert.match(text(offLoad), /Saved scores stay readable/);
	const offCheck = assertValidResponse(await handleSeoOverviewPanel({ input: check(), ui: ui() }, scoringOff.ctx));
	assert.equal(findBlock(offCheck.blocks, (block) => block.type === "meter").label, "Saved SEO score");
	assert.equal(offCheck.toast?.type, "info");
	assert.equal(scoringOff.counters.writes, 0);
}

// Scoring off with no stored score offers no check at all.
{
	const { ctx, counters } = fakeSite({ kv: { "settings:global:v1": siteSettings({ contentScoringEnabled: false }) } });
	const response = assertValidResponse(await handleSeoOverviewPanel({ input: check(), ui: ui() }, ctx));
	assert.equal(checkButton(response), undefined);
	assert.match(text(response), /Content scoring is off for this site/);
	assert.equal(counters.writes, 0);
}

// A saved draft revision is what the overview describes and analyzes.
{
	const draftPost = { ...basePost, status: "draft", draftRevisionId: "rev-draft" };
	const revision = { id: "rev-draft", collection: "posts", entryId: "post-1", data: { title: "A Saved Draft Title Waiting for Review", _slug: "saved-draft-title" } };
	const { ctx, counters } = fakeSite({ post: { ...draftPost, seo: { ...basePost.seo, title: null } }, revision });
	const response = assertValidResponse(await handleSeoOverviewPanel({ input: check(), ui: ui() }, ctx));
	assert.match(text(response), /A Saved Draft Title Waiting for Review/);
	assert.match(text(response), /Not public yet/);
	assert.ok(counters.revisionGets >= 1);
	assert.equal(counters.writes, 0);

	const noRevisionAccess = fakeSite({ post: draftPost });
	const denied = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, noRevisionAccess.ctx));
	assert.match(text(denied), /The saved draft could not be read/);
}

// Long metadata stays complete rather than truncated to the sidebar width.
{
	const description = "A long saved description that keeps going ".repeat(25).trim();
	const { ctx } = fakeSite({ post: { ...basePost, seo: { ...basePost.seo, description } } });
	const response = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, ctx));
	assert.ok(findBlock(response.blocks, (block) => block.type === "section" && block.text === `Description: ${description}`));
	assert.match(text(response), new RegExp(`${description.length} characters`));
}

// Noindex states explain why the entry is hidden.
{
	const { ctx } = fakeSite({ post: { ...basePost, seo: { ...basePost.seo, noIndex: true } } });
	const response = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, ctx));
	assert.match(text(response), /SEO rules block indexing/);
	assert.match(text(response), /EmDash SEO setting asks search engines not to index it/);
	assert.match(text(response), /Robots under SEO rules: noindex,nofollow/);
	assert.ok(findBlock(response.blocks, (block) => block.type === "fields" && block.fields.some((field: any) => field.label === "EmDash noindex" && field.value === "On")));

	const siteWide = fakeSite({ kv: { "settings:global:v1": siteSettings({ noindex: true }) } });
	const siteResponse = assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, siteWide.ctx));
	assert.match(text(siteResponse), /The site-wide noindex setting is on/);
	assert.ok(findBlock(siteResponse.blocks, (block) => block.type === "fields" && block.fields.some((field: any) => field.label === "EmDash noindex" && field.value === "Off")));
}

// Missing access, unsupported collections and engine errors get explicit states.
{
	const noContent = fakeSite({ withoutContent: true });
	assert.match(text(assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, noContent.ctx))), /does not have content read access/);

	const hidden = fakeSite({ collections: [{ slug: "posts", label: "Posts", hasSeo: true, routable: true, hidden: true }] });
	assert.match(text(assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui() }, hidden.ctx))), /not available for this content type/);

	const missing = fakeSite();
	assert.match(text(assertValidResponse(await handleSeoOverviewPanel({ input: load, ui: ui({ id: "post-404" }) }, missing.ctx))), /could not be found/);

	const failing = fakeSite({ contentGetError: new Error("Private storage details") });
	const failed = assertValidResponse(await handleSeoOverviewPanel({ input: check(), ui: ui() }, failing.ctx));
	assert.match(text(failed), /could not be loaded/);
	assert.doesNotMatch(text(failed), /Private storage details/);
	assert.equal(failed.toast?.type, "error");
}

console.log("SEO registry overview panel self-check passed.");
