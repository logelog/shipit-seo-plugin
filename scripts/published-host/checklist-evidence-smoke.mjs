// Native checklist evidence proof on a migrated EmDash SQLite database from the
// selected published host. Session analysis and its cache-validation identity
// run behind the published HTTP dispatcher, which checks the user and the CSRF
// header before a handler runs. Responses go through the admin parser, so the
// engine and the admin agree on every evaluation basis. Output evidence is the
// plugin's page:metadata hook (hook output, not rendered HTML).
import assert from "node:assert/strict";
import { setFixtureContentAnalysis, setFixtureAssessmentProfile } from "./fixture-content-analysis.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";

if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(target.name)) {
	console.log(`Checklist evidence smoke skipped on ${target.name}; this check requires a released native target.`);
	process.exit(0);
}
let fetchAttempts = 0;
globalThis.fetch = async () => { fetchAttempts += 1; throw new Error("External networking is disabled in this smoke check"); };

const host = hostPackageRoot("emdash");
async function hostDistExport(name) {
	const dist = new URL("dist/", host);
	for (const file of readdirSync(dist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const alias = readFileSync(new URL(file, dist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(new URL(file, dist).href))[alias];
	}
	throw new Error(`published ${name} was not found`);
}
const hostIndex = readFileSync(new URL("dist/index.mjs", host), "utf8");
const contextUrl = new URL(hostIndex.match(/import\s*\{[^}]*PluginStorageRepository[^}]*\}\s*from\s*"(\.\/context-[^"]+\.mjs)"/)[1], new URL("dist/", host));
const contextSource = readFileSync(contextUrl, "utf8");
const contextModule = await import(contextUrl.href);
const PluginContextFactory = contextModule[contextSource.match(/\bPluginContextFactory as ([A-Za-z_$][\w$]*)/)[1]];
const { Kysely } = await import("kysely");
const { createDialect } = await import("emdash/db/sqlite");
const { runMigrations } = await import("emdash/db");
const SchemaRegistry = await hostDistExport("SchemaRegistry");
const ContentRepository = await hostDistExport("ContentRepository");
const SeoRepository = await hostDistExport("SeoRepository");
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const handleContentGet = await hostDistExport("handleContentGet");
const source = (path) => import(new URL(`packages/emdash-plugin-seo/src/${path}`, sourceRoot));
const { createSqliteSeoFixture } = await import("./sqlite-plugin-fixture.mjs");
const { SEO_SCORE_VERSION, seoScoreDisplay } = await source("analysis.ts");
const { readAdminModules } = await source("entry-analysis-runtime.ts");
const { parseSeoAdminContentAudit, parseSeoAdminContentScores, parseSeoAdminEntryAnalysisIdentityResult } = await source("admin-ui/contract.ts");
const { contentCheckPresentation, groupContentChecks, analysisSummary, searchExclusionCheck } = await source("admin-ui/content-extension-model.ts");
const { sessionScoreBoundToEntry, sessionScoreMatchesIdentity } = await source("admin-ui/editor-session-analysis.ts");
const { createSavedContentSnapshot } = await source("admin-ui/saved-content-snapshot.ts");
const { SEO_SNIPPET_DEVICE_LABELS, seoSnippetCutPoint, seoSnippetFit } = await source("snippet-fit.ts");
// Mirrors the analyzer's fit evidence wording over the fit the editor preview shares; change both together.
const snippetFitEvidence = (value, field) => seoSnippetFit(value, field)
	.map((fit) => `${SEO_SNIPPET_DEVICE_LABELS[fit.device]}: ${fit.clipped ? `cut after "${seoSnippetCutPoint(fit.visible)}"` : "fits"}`).join("; ");

const SITE = "https://example.com";
const report = { target: target.name, emdash: target.versions.get("emdash"), storage: "sqlite :memory:", checks: [], queries: {} };
const check = (name) => report.checks.push(name);

const statements = [];
const db = new Kysely({
	dialect: createDialect({ url: ":memory:" }),
	log(event) {
		if (event.level === "query") statements.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
	},
});
const counted = async (action) => {
	const start = statements.length;
	const value = await action();
	const run = statements.slice(start);
	return { value, queries: run.length, writes: run.filter(({ sql }) => /^\s*(insert|update|delete|replace)\b/i.test(sql)).length, run };
};
// A content read without a WHERE clause would be an inventory scan.
const contentScans = (run) => run.filter(({ sql }) => /from "ec_(posts|pages)"/i.test(sql) && !/where/i.test(sql)).length;
const contentReads = (run) => run.filter(({ sql }) => /^\s*select\b/i.test(sql) && /from "ec_(posts|pages)"/i.test(sql)).length;
const storageRows = async (collection) => db.selectFrom("_plugin_storage").selectAll()
	.where("plugin_id", "=", "shipit-seo").where("collection", "=", collection).orderBy("id").execute();

const span = (text, marks = []) => ({ _type: "span", _key: `s${text.length}${marks.join("")}`, text, marks });
const block = (text, style = "normal", extra = {}) => ({ _type: "block", _key: `b${style}${text.length}`, style, markDefs: [], children: [span(text)], ...extra });
const paragraphs = (count) => Array.from({ length: count }, (_, index) =>
	block(`Fresh sourdough is shaped by hand every morning and baked in small batches for the day ${index + 1}.`));

try {
	await runMigrations(db);
	const seo = createSqliteSeoFixture(db);
	await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
	const schema = new SchemaRegistry(db);
	for (const [slug, label, urlPattern] of [["posts", "Posts", "/posts/{slug}"], ["pages", "Pages", "/pages/{slug}"]]) {
		await schema.createCollection({ slug, label, hasSeo: true, routable: true, urlPattern, supports: ["drafts", "revisions"] });
		await schema.createField(slug, { slug: "title", label: "Title", type: "string" });
		await schema.createField(slug, { slug: "excerpt", label: "Excerpt", type: "string" });
		await schema.createField(slug, { slug: "content", label: "Content", type: "portableText" });
	}
	await schema.createField("pages", { slug: "body_source", label: "Body source", type: "string" });
	const content = new ContentRepository(db);
	const liveBody = [
		block("Sourdough at Harbour Bakery", "h1"),
		block("How we bake", "h2"),
		{ _type: "image", _key: "img1", alt: "img", asset: { _ref: "media:loaf", url: "https://example.com/loaf.jpg" } },
		block("", "normal", {
			markDefs: [{ _key: "short", _type: "link", href: "/pages/about" }, { _key: "generic", _type: "link", href: "/pages/menu" }],
			children: [span("x", ["short"]), span(" and "), span("click here", ["generic"]), span(" for the menu.")],
		}),
		...paragraphs(20),
	];
	const excerpt = "Fresh sourdough and pastries baked every morning at Harbour Bakery, shaped by hand and sold the same day near the harbour.";
	const create = (type, slug, status, extra = {}) => content.create({
		type, slug, status, locale: "en",
		data: { title: "Sourdough baked every morning by hand", excerpt, content: liveBody, ...extra },
	});
	const draft = await create("posts", "draft-loaf", "draft");
	const scheduled = await create("posts", "scheduled-loaf", "draft");
	await content.schedule("posts", scheduled.id, new Date(Date.now() + 86_400_000).toISOString());
	const live = await create("posts", "live-loaf", "published");
	const twin = await create("posts", "twin-loaf", "published");
	const noindexed = await create("posts", "hidden-loaf", "published");
	await new SeoRepository(db).upsert("posts", noindexed.id, { noIndex: true });
	const templatePage = await create("pages", "home", "published", { content: [], body_source: "template" });
	const french = await content.create({
		type: "posts", slug: "live-loaf", status: "published", locale: "fr", translationOf: live.id,
		data: { title: "Pain au levain cuit chaque matin", excerpt, content: liveBody },
	});
	assert.equal((await content.findById("posts", scheduled.id)).status, "scheduled", "control: the host stores a scheduled entry");

	const routeOptions = { db, siteInfo: { siteUrl: SITE, siteName: "Harbour Bakery", url: SITE, name: "Harbour Bakery" }, cronReschedule() {} };
	const registry = new PluginRouteRegistry(routeOptions);
	registry.register(seo);
	const runtime = {
		getPluginRouteMeta(pluginId, path) {
			const route = pluginId === seo.id ? seo.routes[path.replace(/^\//, "")] : undefined;
			return route ? buildRouteMeta(route) : null;
		},
		async handlePluginApiRoute(pluginId, method, path, request, caller) {
			const meta = this.getPluginRouteMeta(pluginId, path);
			let body;
			try {
				body = await parseRouteInput(request, meta?.request);
			} catch (error) {
				if (typeof error?.status === "number") return { success: false, status: error.status, error: { code: "INVALID_PLUGIN_REQUEST", message: error.message } };
				throw error;
			}
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body, user: caller });
		},
	};
	const people = {
		editor: { id: "editor", email: "editor@example.com", name: "Editor", role: 40 },
		admin: { id: "admin", email: "admin@example.com", name: "Admin", role: 50 },
	};
	async function call(route, body, { user = people.admin, csrf = true } = {}) {
		const request = new Request(`${SITE}/_emdash/api/plugins/shipit-seo/${route}`, body === undefined
			? { method: "GET", headers: csrf ? { "X-EmDash-Request": "1" } : {} }
			: {
				method: "POST",
				headers: { "Content-Type": "application/json", ...(csrf ? { "X-EmDash-Request": "1" } : {}) },
				body: JSON.stringify(body),
			});
		const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: user ?? undefined });
		const payload = JSON.parse(await response.text());
		return { status: response.status, data: payload?.data, error: payload?.error };
	}
	const pluginCtx = new PluginContextFactory(routeOptions).createContext({ id: seo.id, version: "0.0.0", capabilities: seo.capabilities, admin: {}, storage: seo.storage, allowedHosts: [] });
	const audit = async (refs) => {
		const result = await call("audit-content", { refs });
		assert.equal(result.status, 200, JSON.stringify(result.error));
		return parseSeoAdminContentAudit(result.data);
	};
	const identityOf = async (ref) => parseSeoAdminEntryAnalysisIdentityResult((await call("entry-analysis-identity", { ref })).data, ref);
	// The editor's saved snapshot, built from EmDash's own content API handler as the admin receives it.
	const editorAudit = async (collection, entryId) => {
		const response = await handleContentGet(db, collection, entryId);
		assert.equal(response.success, true, JSON.stringify(response.error));
		const snapshot = createSavedContentSnapshot(`${collection}:${entryId}`, JSON.parse(JSON.stringify(response.data.item)));
		const score = parseSeoAdminContentAudit((await call("audit-content", { refs: [`${collection}:${entryId}`], snapshots: [snapshot] })).data).items[0];
		assert.equal(score.sourceVersion, snapshot.sourceVersion);
		return { snapshot, score };
	};
	const currentFor = (score, identity, snapshot) => sessionScoreMatchesIdentity(score, identity) &&
		sessionScoreBoundToEntry(score, identity, { savedVersion: snapshot.sourceVersion, locale: "en" });
	const checkOf = (score, id) => score.checks.find((item) => item.id === id);
	const tagsOf = async (entry, collection, path) => {
		const contributions = (await seo.hooks["page:metadata"].handler({ page: {
			url: `${SITE}${path}`, path, locale: "en", kind: "content", pageType: collection === "posts" ? "article" : "website",
			title: entry.data.title, pageTitle: entry.data.title, description: null, canonical: `${SITE}${path}`, image: null,
			content: { collection, id: entry.id, slug: entry.slug }, seo: {}, siteName: "Harbour Bakery", siteUrl: SITE,
		} }, pluginCtx)) ?? [];
		const find = (kind, key) => contributions.find((item) => item.kind === kind && (item.name === key || item.property === key || item.rel === key));
		return {
			robots: find("meta", "robots")?.content ?? null,
			description: find("meta", "description")?.content ?? null,
			socialTitle: find("property", "og:title")?.content ?? null,
			canonical: find("link", "canonical")?.href ?? null,
			jsonLdTypes: contributions.filter((item) => item.kind === "jsonld").flatMap((item) => [].concat(item.graph?.["@type"] ?? [])),
		};
	};

	const settings = await call("admin-settings", {});
	const saveSettings = async (patch) => {
		const loaded = (await call("admin-settings", {})).data;
		const result = await call("save-admin-settings", {
			...loaded.values, ...patch,
			...(loaded.revision === null ? { expectedRevision: null, expectedLegacyGuard: loaded.legacyGuard } : { expectedRevision: loaded.revision }),
		});
		assert.equal(result.data.success, true, JSON.stringify(result.data));
	};
	assert.equal(settings.status, 200);
	await saveSettings({
		siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "organization", organizationName: "Harbour Bakery",
		organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false,
	});
	await setFixtureContentAnalysis(call, true);
	await setFixtureAssessmentProfile(call, "posts", "article");
	await setFixtureAssessmentProfile(call, "pages", "general");

	// ---- Permissions, CSRF and strict input ----
	for (const [route, body] of [["audit-content", { refs: [`posts:${live.id}`] }], ["entry-analysis-identity", { ref: `posts:${live.id}` }]]) {
		assert.equal((await call(route, body, { user: null })).status, 401, `${route} refuses anonymous callers`);
		assert.equal((await call(route, body, { user: people.editor })).status, 403, `${route} refuses an Editor, as before this delivery`);
		assert.equal((await call(route, body, { csrf: false })).status, 403, `${route} requires the CSRF header`);
	}
	assert.equal((await call("entry-analysis-identity", { ref: `posts:${live.id}`, force: true })).status, 400, "unknown input keys are refused");
	check("administrator-only session analysis and identity, CSRF and strict input");

	// ---- Publication state comes before the indexing directive ----
	const scoresBefore = await storageRows("scores");
	const historyBefore = await storageRows("scoreHistory");
	const sessionRun = await counted(() => audit([draft.id, scheduled.id, live.id, twin.id, noindexed.id].map((id) => `posts:${id}`).concat(`pages:${templatePage.id}`)));
	const byRef = new Map(sessionRun.value.items.map((item) => [item.ref, item]));
	assert.equal(sessionRun.value.items.length, 6, JSON.stringify(sessionRun.value.failures));
	assert.ok(sessionRun.value.items.every((item) => item.scoreVersion === SEO_SCORE_VERSION && item.persistence === "session"));
	for (const [entry, status] of [[draft, "draft"], [scheduled, "scheduled"]]) {
		const indexing = checkOf(byRef.get(`posts:${entry.id}`), "indexability");
		assert.deepEqual([indexing.basis, indexing.weight, indexing.status], ["not-applicable", 0, "review"], status);
		assert.match(indexing.detail, new RegExp(`not published \\(${status}\\)`));
	}
	const liveScore = byRef.get(`posts:${live.id}`);
	const liveIndexing = checkOf(liveScore, "indexability");
	assert.deepEqual([liveIndexing.basis, liveIndexing.status, liveIndexing.label, liveIndexing.weight, liveIndexing.severity],
		["measured", "pass", "Indexing directive", 0, "info"], "the allowed directive is reported without weight");
	assert.match(liveIndexing.limitation, /reach, crawl or index/);
	const hidden = byRef.get(`posts:${noindexed.id}`);
	const condition = searchExclusionCheck(hidden);
	assert.equal(condition?.weight, 0);
	assert.match(condition.evidence.source, /seo\.noIndex/, "the entry SEO directive is named as the source");
	assert.deepEqual([hidden.score, hidden.status], [byRef.get(`posts:${twin.id}`).score, byRef.get(`posts:${twin.id}`).status],
		"noindex neither caps nor lowers the score of identical content");
	assert.equal(checkOf(byRef.get(`posts:${draft.id}`), "indexability").weight, 0);
	assert.equal(sessionRun.writes, 0, "session analysis writes nothing");
	assert.equal(contentScans(sessionRun.run), 0, "session analysis enumerates no content");
	report.queries.sessionAnalysisSixEntries = { queries: sessionRun.queries, writes: sessionRun.writes, contentReads: contentReads(sessionRun.run) };
	check("draft and scheduled entries have no public indexing pass; published noindex is a zero-weight condition with its source");

	// ---- Output evidence where a check claims it ----
	const liveTags = await tagsOf(live, "posts", `/posts/${live.slug}`);

	await setFixtureAssessmentProfile(call, "posts", "general");
	assert.deepEqual(await tagsOf(live, "posts", `/posts/${live.slug}`), liveTags,
		"assessment purpose never changes anonymous metadata or schema output");
	const generalScore = (await audit([`posts:${live.id}`])).items[0];
	assert.equal(generalScore.assessmentProfile.profile, "general");
	assert.equal(liveScore.assessmentProfile.profile, "article");
	const articleDepth = checkOf(liveScore, "content-depth");
	const generalDepth = checkOf(generalScore, "content-depth");
	assert.equal(generalScore.metrics.wordCount, liveScore.metrics.wordCount,
		"saved word-count evidence is independent of the selected assessment purpose");
	assert.deepEqual([articleDepth.evidence.actual, generalDepth.evidence.actual], [liveScore.metrics.wordCount, liveScore.metrics.wordCount]);
	assert.ok(liveScore.metrics.wordCount >= 300 && liveScore.metrics.wordCount < 600,
		`control: the real saved body is between the General and Article body text targets (${liveScore.metrics.wordCount} words)`);
	assert.deepEqual([articleDepth.basis, articleDepth.weight, articleDepth.status], ["measured", 10, "review"],
		"an Article body of 300 to 599 words is scored as Partly met");
	assert.deepEqual([generalDepth.basis, generalDepth.weight, generalDepth.status], ["measured", 0, "pass"],
		"General body text length is unweighted advice that passes from 100 words");
	assert.equal(generalScore.calculation.totalWeight, liveScore.calculation.totalWeight - articleDepth.weight,
		"only the Article purpose scores body text length");
	const profileRows = new Set(["content-depth", "featured-image"]);
	const sharedRows = (score) => score.checks.filter((item) => !profileRows.has(item.id));
	assert.deepEqual(sharedRows(generalScore), sharedRows(liveScore),
		"switching purpose changes only the purpose rows of this saved fixture");
	assert.deepEqual([checkOf(generalScore, "featured-image").basis, checkOf(liveScore, "featured-image").basis],
		["not-applicable", "measured"], "purpose still selects applicable featured-image advice");
	assert.deepEqual([checkOf(generalScore, "featured-image").weight, checkOf(liveScore, "featured-image").weight],
		[0, 0], "featured-image advice does not change the score");
	await setFixtureAssessmentProfile(call, "posts", "article");
	const rolesKey = "configuration:schema-content-types:v1";
	const previousRoles = await pluginCtx.kv.get(rolesKey);
	await pluginCtx.kv.set(rolesKey, { version: 1, updatedAt: new Date().toISOString(), values: { posts: "none" } });
	const noAutomaticSchemaScore = (await audit([`posts:${live.id}`])).items[0];
	assert.equal(noAutomaticSchemaScore.assessmentProfile.profile, "article");
	for (const id of ["content-depth", "heading-structure", "featured-image"])
		assert.deepEqual(checkOf(noAutomaticSchemaScore, id), checkOf(liveScore, id), `schema none preserves the Article ${id} rule`);
	if (previousRoles === null || previousRoles === undefined) await pluginCtx.kv.delete(rolesKey);
	else await pluginCtx.kv.set(rolesKey, previousRoles);
	check("assessment purpose and automatic schema ownership are independent on real host routes");

	const hiddenTags = await tagsOf(noindexed, "posts", `/posts/${noindexed.slug}`);
	assert.match(hiddenTags.robots ?? "", /noindex/, "the condition matches the robots tag Shipit contributes");
	assert.doesNotMatch(liveTags.robots ?? "", /noindex/);
	assert.equal(checkOf(liveScore, "url").evidence.actual, liveTags.canonical, "the canonical check names the canonical Shipit contributes");
	assert.equal(checkOf(liveScore, "description").evidence.actual, Boolean(liveTags.description),
		"description presence agrees with the contributed description without storing its text");
	assert.equal(checkOf(liveScore, "description-display-length").evidence.actual, snippetFitEvidence(liveTags.description, "description"),
		"separate display advice estimates the contributed description with the preview's fit");
	assert.match(checkOf(liveScore, "description-display-length").detail, /^Estimate: /);
	assert.equal(checkOf(liveScore, "description-display-length").weight, 0);
	const preview = await call("admin-entry-preview", { ref: `posts:${live.id}`, entryOnly: true });
	const titleSource = preview.data.preview.sources.title;
	const titleCheck = checkOf(liveScore, "title");
	const suggestion = preview.data.preview.search.title;
	assert.equal(titleSource, "template", "control: with no saved title the resolver uses the default template");
	assert.ok(suggestion.includes(live.data.title) && suggestion.includes("Harbour Bakery") && suggestion !== live.data.title,
		"control: the configured template adds the site name to the content title");
	assert.equal(titleCheck.evidence.source, "Resolved title suggestion: metadata template", "the check names the resolver's actual source");
	assert.equal(titleCheck.evidence.actual, Boolean(suggestion), "the presence check observes the resolver's template result");
	assert.equal(checkOf(liveScore, "title-display-length").evidence.actual, snippetFitEvidence(suggestion, "title"),
		"separate display advice estimates the resolved title suggestion with the preview's fit");
	assert.match(checkOf(liveScore, "title-display-length").detail, /^Estimate: /);
	assert.equal(checkOf(liveScore, "title-display-length").weight, 0);
	assert.equal(liveTags.socialTitle, live.data.title, "Shipit's og:title is the content title, not the suggestion");
	assert.match(titleCheck.limitation, /served <title> element/, "no tag the plugin emits is the served <title>, so it is not claimed");
	report.titleSource = titleSource;
	check("canonical, robots and description agree with the plugin's page:metadata output; the title suggestion is labelled as one");

	// ---- Saved-body evidence and heuristics keep factual labels ----
	const heading = checkOf(liveScore, "heading-structure");
	assert.deepEqual([heading.status, heading.basis], ["review", "heuristic"]);
	assert.match(heading.detail, /1 H1 heading in the saved body\. Whether the rendered page also shows a title H1 is not observed/);
	const links = checkOf(liveScore, "descriptive-link-text");
	assert.deepEqual([links.status, links.basis, links.label, links.evidence.actual], ["review", "heuristic", "Link text", 1]);
	assert.match(links.detail, /1 of 2 saved body links/);
	const alt = checkOf(liveScore, "image-alt-text");
	assert.deepEqual([alt.status, alt.basis], ["pass", "measured"]);
	assert.equal(alt.evidence.actual, 0, "the observed saved image has an alt attribute");
	assert.equal(alt.detail, "The body image has an alt attribute.");
	assert.match(alt.limitation, /descriptive quality, decorative intent and template-added images are not verified/);
	check("a real body H1 is reviewed without a rendered duplicate claim; alt and generic-link checks report presence and matches");

	// ---- Template body: not checked, dashed, never complete ----
	const templateScore = byRef.get(`pages:${templatePage.id}`);
	assert.equal(checkOf(templateScore, "content-depth").basis, "unavailable");
	const templatePresentation = contentCheckPresentation(templateScore);
	const templateGroups = templatePresentation.groups;
	assert.deepEqual(templateGroups.map((group) => group.id), ["basic", "additional", "search-snippet", "content-readability"]);
	const basicDepth = templateGroups.find((group) => group.id === "basic").rows.find((row) => row.check.id === "content-depth");
	assert.deepEqual([basicDepth?.kind, basicDepth?.word, basicDepth?.showRecommendation], ["not-checked", "Not checked", true],
		"unread template body text is Not checked in Basic SEO, with its guidance");
	const readability = templateGroups.find((group) => group.id === "content-readability");
	assert.deepEqual(readability.checks.map((item) => item.id), ["sentence-readability", "paragraph-length", "heading-structure"]);
	assert.ok(readability.checks.every((item) => item.basis === "unavailable" && item.status === "review" && item.weight === 0));
	assert.ok(readability.rows.every((row) => row.word === "Not checked"));
	assert.deepEqual([readability.summary.label, readability.manualCount, readability.scoredCount, readability.complete],
		["3 not checked", 3, 0, false]);
	assert.ok(templateGroups.every((group) => !group.complete || group.manualCount === 0),
		"a group with unavailable evidence cannot claim completion");
	for (const key of ["issues", "suggestions", "notChecked"])
		assert.equal(templatePresentation.totals[key], templateGroups.reduce((total, group) => total + group.counts[key], 0), `header ${key} is the sum of the groups`);
	assert.match(analysisSummary(templateScore), /[1-9]\d* not checked$/);
	const templateDisplay = seoScoreDisplay(templateScore);
	assert.deepEqual([templateDisplay.score, templateDisplay.band, templateDisplay.label], [null, null, "Partially checked"],
		"a template body shows a dash, never a number");
	check("the four groups keep unread template body evidence as Not checked rows with a dashed score and no completion");

	// ---- Exact entry and locale ----
	const frenchScore = (await audit([`posts:${french.id}`])).items[0];
	assert.deepEqual([frenchScore.ref, frenchScore.entryId, frenchScore.title.includes("Pain au levain")], [`posts:${french.id}`, french.id, true]);
	assert.notEqual(french.id, live.id);
	check("each locale is its own exact entry");

	// ---- Cache validation identity: scoped reads, no analysis or writes ----
	const liveRef = `posts:${live.id}`;
	const identityRun = await counted(() => call("entry-analysis-identity", { ref: liveRef }));
	const identity = parseSeoAdminEntryAnalysisIdentityResult(identityRun.value.data, liveRef);
	assert.equal(identity.success, true);
	assert.equal(sessionScoreMatchesIdentity(liveScore, identity.identity), true, "an unchanged entry and configuration accept the cached result");
	const liveEditor = await editorAudit("posts", live.id);
	assert.equal(identity.identity.sourceVersion, liveEditor.snapshot.sourceVersion,
		"the engine's saved version equals the one the editor computes from EmDash's content API");
	assert.equal(identity.identity.locale, "en");
	assert.equal(currentFor(liveEditor.score, identity.identity, liveEditor.snapshot), true);
	const frenchIdentity = await identityOf(`posts:${french.id}`);
	assert.equal(frenchIdentity.identity.locale, "fr", "the identity names the exact row's locale");
	assert.equal(sessionScoreBoundToEntry(liveEditor.score, frenchIdentity.identity, { savedVersion: liveEditor.snapshot.sourceVersion, locale: "en" }), false);
	assert.equal(identityRun.writes, 0, "validation writes nothing");
	assert.equal(contentScans(identityRun.run), 0, "validation enumerates no content");
	assert.equal(contentReads(identityRun.run), 1, "validation reads the one exact entry");
	report.queries.identity = { queries: identityRun.queries, writes: identityRun.writes, contentReads: contentReads(identityRun.run) };
	report.queries.sessionAnalysisOneEntry = (() => { const one = sessionRun.queries / 6; return { averageQueriesPerEntry: Math.round(one) }; })();

	// ---- Session results stay out of durable storage ----
	assert.deepEqual(await storageRows("scores"), scoresBefore, "no session result entered score storage");
	assert.deepEqual(await storageRows("scoreHistory"), historyBefore, "no session result entered score history");
	check("session results and validation leave score storage and history unchanged");

	// Saving entry directives refreshes that entry's stored score, as before this
	// delivery; only the session and identity calls below must stay write-free.
	const changes = [
		["a legacy module flag without a versioned record", async () => {
			const modules = await readAdminModules(pluginCtx);
			assert.equal(modules.updatedAt, null, "control: no versioned modules record exists yet");
			await pluginCtx.kv.set("module:imageSeo", !modules.values.imageSeo);
		}],
		["site settings", () => saveSettings({ siteName: "Harbour Bakery and Cafe" })],
		["modules", async () => {
			const loaded = await call("admin-configuration", {});
			const modules = await readAdminModules(pluginCtx);
			const result = await call("save-admin-modules", { ...modules.values, imageSeo: !modules.values.imageSeo, expectedRevision: loaded.data.modules.revision });
			assert.equal(result.data.success, true, JSON.stringify(result.data));
		}],
		["entry directives", async () => {
			const result = await call("save-entry-directives", { ref: liveRef, robots: { nofollow: false, noarchive: true, nosnippet: false, noimageindex: false, notranslate: false } });
			assert.equal(result.data.success, true, JSON.stringify(result.data));
		}],
		["metadata template", async () => {
			const configuration = (await call("admin-templates")).data;
			const item = configuration.items.find((candidate) => candidate.collection === "posts");
			const result = await call("save-admin-templates", {
				collection: "posts", expectedRevision: configuration.revision, inheritanceGuard: item.inheritanceGuard,
				values: { title: "{{title}} | {{siteName}} bakery", description: "{{description}}", socialTitle: "", socialDescription: "" },
			});
			assert.equal(result.data.success, true, JSON.stringify(result.data));
		}],
	];
	let cached = liveEditor;
	const liveVersion = (await content.findById("posts", live.id)).updatedAt;
	for (const [label, change] of changes) {
		await change();
		assert.equal((await content.findById("posts", live.id)).updatedAt, liveVersion, `${label}: the saved entry is unchanged`);
		const validation = await counted(async () => {
			const current = await identityOf(liveRef);
			assert.equal(currentFor(cached.score, current.identity, cached.snapshot), false, `${label}: the cached result is no longer current`);
			cached = await editorAudit("posts", live.id);
			assert.equal(currentFor(cached.score, (await identityOf(liveRef)).identity, cached.snapshot), true, `${label}: a fresh result matches again`);
		});
		assert.equal(validation.writes, 0, `${label}: validation and session analysis write nothing`);
	}
	await content.update("posts", live.id, { data: { ...live.data, excerpt: `${excerpt} Saved again in another tab.` } });
	const afterRemoteSave = await identityOf(liveRef);
	assert.equal(sessionScoreMatchesIdentity(cached.score, afterRemoteSave.identity), true, "control: the configuration did not change");
	assert.equal(currentFor(cached.score, afterRemoteSave.identity, cached.snapshot), false,
		"a save from another tab makes the cached result obsolete even though the editor still shows the older version");
	check("legacy module flags, site settings, modules, entry directives, templates and a remote save each invalidate a cached result; the saved version and locale are bound");

	// ---- The entry's own plugin records bind a kept result; a stored score is verified against its exact inputs ----
	const persistedLive = await call("analyze-content", { collection: "posts", id: live.id });
	assert.equal(persistedLive.data.success, true, JSON.stringify(persistedLive.data));
	const storedFreshness = async () => parseSeoAdminContentScores((await call("scores", { ref: liveRef, storedOnly: true })).data).items[0].freshness;
	assert.equal(await storedFreshness(), "current", "control: the persisted score matches its exact inputs");
	cached = await editorAudit("posts", live.id);
	assert.equal(currentFor(cached.score, (await identityOf(liveRef)).identity, cached.snapshot), true);
	await db.insertInto("_plugin_storage").values({
		plugin_id: seo.id, collection: "overrides", id: liveRef,
		data: JSON.stringify({ ref: liveRef, robots: "noindex", updatedAt: "2026-10-03T12:00:00.000Z" }),
	}).execute();
	const afterLegacy = await identityOf(liveRef);
	assert.notEqual(afterLegacy.identity.entryInputFingerprint, cached.score.entryInputFingerprint);
	assert.equal(currentFor(cached.score, afterLegacy.identity, cached.snapshot), false, "a remote legacy noindex override after the response invalidates the kept result");
	assert.equal(await storedFreshness(), "stale",
		"the stored-only route verifies the entry's own inputs, so a remote legacy override makes the stored score stale");
	cached = await editorAudit("posts", live.id);
	const legacyCondition = searchExclusionCheck(cached.score);
	assert.match(legacyCondition?.evidence.source ?? "", /legacy robots override/, "the fresh result names the legacy directive as the source");
	assert.equal(currentFor(cached.score, (await identityOf(liveRef)).identity, cached.snapshot), true);
	const profileSave = await call("save-focus-keyword", { ref: liveRef, keywords: ["sourdough"], pillar: true, profileOnly: true });
	assert.equal(profileSave.data.success, true, JSON.stringify(profileSave.data));
	assert.equal(currentFor(cached.score, (await identityOf(liveRef)).identity, cached.snapshot), false, "a remote keyword and pillar change invalidates the kept result");
	cached = await editorAudit("posts", live.id);
	assert.deepEqual([cached.score.keywords, cached.score.pillar], [["sourdough"], true]);
	assert.equal(currentFor(cached.score, (await identityOf(liveRef)).identity, cached.snapshot), true);
	check("a remote legacy noindex override and a remote keyword and pillar change invalidate a kept result; stored-only verification sees them");


	// ---- Legacy snapshots stay readable, unchanged and never current ----
	const twinRef = `posts:${twin.id}`;
	const legacyCheck = { id: "title", label: "SEO title length", category: "metadata", severity: "high", status: "pass", weight: 14,
		detail: "41 characters.", evidence: { actual: 41, expected: "35-60 characters", source: "seo.title" }, recommendation: "Keep it." };
	const legacyScore = {
		scoreVersion: 14, analysisRevision: 1, ref: twinRef, collection: "posts", entryId: twin.id, slug: twin.slug, title: twin.data.title,
		score: 96, grade: "excellent", status: "pass", checks: [legacyCheck],
		metrics: { wordCount: 140, sentenceCount: 9, averageSentenceWords: 15.6, paragraphCount: 9, longestParagraphWords: 17, headingCount: 2, h1Count: 1,
			internalLinkCount: 2, externalLinkCount: 0, genericLinkCount: 1, imageCount: 1, imageAltCount: 1, imageDecorativeCount: 0, imageMissingAltCount: 0, structured: true },
		url: `${SITE}/posts/${twin.slug}`, sourceUpdatedAt: twin.updatedAt, updatedAt: "2026-09-01T00:00:00.000Z",
		templateUpdatedAt: null, modulesUpdatedAt: null, configurationFingerprint: "seo-config-v1-legacy", metaOverrideUpdatedAt: null,
	};
	await db.insertInto("_plugin_storage").values([
		{ plugin_id: seo.id, collection: "scores", id: twinRef, data: JSON.stringify(legacyScore), created_at: "2026-09-01 00:00:00", updated_at: "2026-09-01 00:00:00" },
		{ plugin_id: seo.id, collection: "scoreHistory", id: `score-history:legacy:${twin.id}`, data: JSON.stringify({ ...legacyScore, capturedAt: legacyScore.updatedAt }), created_at: "2026-09-01 00:00:00", updated_at: "2026-09-01 00:00:00" },
	]).execute();
	const legacyRows = { scores: await storageRows("scores"), history: await storageRows("scoreHistory") };
	const legacyRead = await counted(() => call("scores", { ref: twinRef, storedOnly: true }));
	const legacyItem = parseSeoAdminContentScores(legacyRead.value.data).items[0];
	assert.deepEqual([legacyItem.scoreVersion, legacyItem.freshness], [14, "stale"], "a legacy score is readable and never current");
	assert.ok(groupContentChecks(legacyItem).every((group) => group.legacy && !group.complete), "the checklist claims no completion for it");
	const legacyDisplay = seoScoreDisplay(legacyItem);
	assert.deepEqual([legacyDisplay.score, legacyDisplay.band, legacyDisplay.label], [null, null, "Earlier analyzer"],
		"an earlier analyzer's stored result never shows a number or band");
	assert.equal(analysisSummary(legacyItem), "Earlier analyzer. Analyze again.");
	assert.equal(legacyRead.writes, 0, "reading a legacy score writes nothing and launches no reanalysis");
	await audit([twinRef]);
	assert.deepEqual(await storageRows("scores"), legacyRows.scores, "legacy score bytes are unchanged after reads and session analysis");
	assert.deepEqual(await storageRows("scoreHistory"), legacyRows.history, "legacy history bytes are unchanged");
	const persisted = await call("analyze-content", { collection: "posts", id: twin.id });
	assert.equal(persisted.data.success, true, JSON.stringify(persisted.data));
	assert.equal(persisted.data.item.scoreVersion, SEO_SCORE_VERSION);
	const historyAfter = await storageRows("scoreHistory");
	const legacyHistoryRow = legacyRows.history.find((row) => row.id === `score-history:legacy:${twin.id}`);
	assert.deepEqual(historyAfter.find((row) => row.id === legacyHistoryRow.id), legacyHistoryRow, "an explicit reanalysis keeps the legacy history row byte for byte");
	assert.equal(historyAfter.length, legacyRows.history.length + 1, "it adds one current history snapshot");
	const currentStored = parseSeoAdminContentScores((await call("scores", { ref: twinRef, storedOnly: true })).data).items[0];
	assert.deepEqual([currentStored.scoreVersion, currentStored.freshness], [SEO_SCORE_VERSION, "current"]);
	assert.ok(currentStored.checks.every((item) => typeof item.basis === "string" && item.limitation), "the stored current score carries its evaluation basis");
	check("legacy score and history rows stay byte-identical and stale until an explicit reanalysis adds a current snapshot");

	// ---- Analysis switch, deletion and unreadable configuration ----
	await setFixtureContentAnalysis(call, false);
	const offRun = await counted(() => call("audit-content", { refs: [liveRef] }));
	assert.equal(offRun.value.data.failures[0].error, "scoring_disabled");
	assert.equal(offRun.writes, 0);
	assert.equal(contentReads(offRun.run), 0, "paused automatic admission never analyzes an entry");
	const manualIdentity = await counted(() => identityOf(liveRef));
	assert.equal(manualIdentity.value.success, true, "one exact saved entry can be identified without admitting automatic analysis");
	assert.equal(manualIdentity.writes, 0);
	assert.equal(contentReads(manualIdentity.run), 1);
	assert.equal(contentScans(manualIdentity.run), 0);

	const optionsBeforeManual = await db.selectFrom("options").selectAll().orderBy("name").execute();
	const retainedBeforeManual = await db.selectFrom("_plugin_storage").selectAll()
		.where("plugin_id", "=", seo.id).where("collection", "not in", ["scores", "scoreAnalysisRevisions"]).orderBy("collection").orderBy("id").execute();
	const otherScoresBeforeManual = (await storageRows("scores")).filter((row) => row.id !== liveRef);
	const otherRevisionsBeforeManual = (await storageRows("scoreAnalysisRevisions")).filter((row) => row.id !== liveRef);
	const contentBeforeManual = await content.findById("posts", live.id);
	const manual = await counted(() => call("analyze-saved-content", { ref: liveRef, locale: "en" }));
	assert.deepEqual([manual.value.status, manual.value.data.success, manual.value.data.outcome, manual.value.data.history], [200, true, "saved", "not-attempted"], JSON.stringify(manual.value));
	assert.equal(manual.value.data.item.ref, liveRef);
	assert.equal(contentScans(manual.run), 0, "manual analysis never enumerates content");
	assert.ok(manual.run.filter(({ sql }) => /^\s*select\b/i.test(sql) && /from "ec_(posts|pages)"/i.test(sql))
		.every(({ parameters }) => parameters.includes(live.id)), "every manual content read names the selected row");
	assert.equal(manual.run.some(({ sql, parameters }) => /_plugin_storage/.test(sql) &&
		parameters.some((value) => ["scoreHistory", "operationLeases", "scoreScanJobs"].includes(value))), false,
		"manual-only analysis does not read, write or prune optional history, leases or scans");
	const manualReadback = await counted(storedFreshness);
	assert.equal(manualReadback.value, "current", "the manual result is verified with automatic analysis still paused");
	assert.equal(manualReadback.writes, 0, "verifying the paused manual result writes nothing");
	assert.deepEqual(await db.selectFrom("options").selectAll().orderBy("name").execute(), optionsBeforeManual,
		"manual analysis changes no saved setting, acknowledgement or assessment profile");
	assert.deepEqual(await db.selectFrom("_plugin_storage").selectAll().where("plugin_id", "=", seo.id)
		.where("collection", "not in", ["scores", "scoreAnalysisRevisions"]).orderBy("collection").orderBy("id").execute(), retainedBeforeManual,
		"manual analysis preserves all prior history and unrelated plugin records");
	assert.deepEqual((await storageRows("scores")).filter((row) => row.id !== liveRef), otherScoresBeforeManual);
	assert.deepEqual((await storageRows("scoreAnalysisRevisions")).filter((row) => row.id !== liveRef), otherRevisionsBeforeManual,
		"manual analysis changes no unrelated analysis reservation");
	assert.deepEqual(await content.findById("posts", live.id), contentBeforeManual);
	const reuse = await counted(() => call("analyze-saved-content", { ref: liveRef, locale: "en" }));
	assert.deepEqual([reuse.value.data.success, reuse.value.data.outcome, reuse.value.data.history, reuse.writes], [true, "reused", "not-attempted", 0]);
	const deniedManual = await counted(async () => [
		await call("analyze-saved-content", { ref: liveRef, locale: "en" }, { user: null }),
		await call("analyze-saved-content", { ref: liveRef, locale: "en" }, { user: people.editor }),
		await call("analyze-saved-content", { ref: liveRef, locale: "en" }, { csrf: false }),
		await call("analyze-saved-content", { ref: liveRef, locale: "en", purpose: "manual-entry" }),
	]);
	assert.deepEqual(deniedManual.value.map((result) => result.status), [401, 403, 403, 400]);
	assert.equal(deniedManual.writes, 0, "authorization and extra-input denials write nothing");
	assert.equal(contentReads(deniedManual.run), 0);
	const wrongLocale = await counted(() => call("analyze-saved-content", { ref: liveRef, locale: "fr" }));
	assert.deepEqual([wrongLocale.value.data.success, wrongLocale.value.data.error, wrongLocale.writes], [false, "locale_mismatch", 0]);
	report.queries.manualPaused = { queries: manual.queries, writes: manual.writes, contentReads: contentReads(manual.run), history: manual.value.data.history };
	report.queries.manualReuse = { queries: reuse.queries, writes: reuse.writes };
	check("paused automatic analysis still allows one explicit saved-entry result and read-only identity, without history, settings, scans or unrelated changes; exact locale and dispatcher authorization are enforced");
	await setFixtureContentAnalysis(call, true);
	await content.delete("posts", draft.id);
	const deleted = await identityOf(`posts:${draft.id}`);
	assert.deepEqual([deleted.success, deleted.error], [false, "content_not_found"], "a deleted entry cannot validate a cached result");
	assert.deepEqual((await call("audit-content", { refs: [`posts:${draft.id}`] })).data.failures, [{ ref: `posts:${draft.id}`, error: "content_not_found" }]);
	const healthyIdentityRows = await db.selectFrom("options").selectAll().where("name", "like", "plugin:shipit-seo:configuration:templates%").execute();
	await db.updateTable("options").set({ value: "{not json" }).where("name", "=", "plugin:shipit-seo:configuration:templates:v1").execute();
	const unreadableTemplates = await identityOf(liveRef);
	assert.equal(unreadableTemplates.success, true, "an unreadable template record is a distinct token, never the earlier one");
	assert.equal(sessionScoreMatchesIdentity(cached.score, unreadableTemplates.identity), false);
	for (const row of healthyIdentityRows) await db.updateTable("options").set({ value: row.value }).where("name", "=", row.name).execute();
	await db.updateTable("options").set({ value: "{not json" }).where("name", "=", "plugin:shipit-seo:settings:global:v1").execute();
	const unreadableSettings = await identityOf(liveRef);
	assert.deepEqual([unreadableSettings.success, unreadableSettings.error], [false, "configuration_unreadable"], "unreadable site settings refuse validation");
	check("automatic audit remains paused; deleted content and unreadable configuration refuse identity verification");

	assert.equal(fetchAttempts, 0, "checklist and manual analysis make no fetch attempt");
	report.fetchAttempts = fetchAttempts;
	report.result = "passed";
	console.log(JSON.stringify(report));
	console.log(`Checklist evidence passed through the published HTTP dispatcher on EmDash ${target.versions.get("emdash")} with in-memory SQLite (${report.checks.length} check groups).`);
} finally {
	await db.destroy();
}
