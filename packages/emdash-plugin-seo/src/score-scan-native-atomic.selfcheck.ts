import assert from "node:assert/strict";

import { ContentRepository, OptionsRepository, PluginStorageRepository, SchemaRegistry, createContentAccess, createSettingsAccess } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";

import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import { createNativeScoreScanAcceptance } from "./score-scan-native-acceptance.ts";
import { GLOBAL_SETTINGS_KEY, readContentScoringPolicy } from "./settings-runtime.ts";
import { acceptAnalyzedScore } from "./score-history.ts";
import { SEO_SCORE_VERSION } from "./analysis.ts";
import { collectionAnalysisProfileKey, readCollectionAnalysisProfile } from "./collection-analysis-profile.ts";

const PLUGIN = "shipit-seo";
const SITE = { name: "Example", url: "https://example.com", locale: "en" };
const descriptor = { scores: {}, scoreAnalysisRevisions: {}, scoreScanJobs: {} };
const db = new Kysely<any>({ dialect: createDialect({ url: ":memory:" }) });
let beforeBatch: (() => Promise<void>) | null = null;
let afterCommit: (() => void) | null = null;
let injectStatementFailure = false;
let batches = 0;
let lastStatements: readonly any[] = [];
const adapter = db.getExecutor().adapter as any;
adapter.executeAtomicBatch = async (queries: readonly any[]) => {
	batches++;
	lastStatements = queries;
	for (const query of queries) assert.ok(query.parameters.length <= 100, "every compiled statement fits D1's bind budget");
	const before = beforeBatch;
	beforeBatch = null;
	if (before) await before();
	const result = await db.transaction().execute(async (trx: any) => {
		const results = [];
		for (const [index, query] of queries.entries()) {
			if (injectStatementFailure && index === queries.length - 2) throw new Error("injected SQL failure");
			results.push(await trx.executeQuery(query));
		}
		return results;
	});
	if (afterCommit) { const after = afterCommit; afterCommit = null; after(); }
	return result;
};
const repositories = { PluginStorageRepository, OptionsRepository, createSettingsAccess, createContentAccess };
const acceptance = createNativeScoreScanAcceptance({
	db, pluginId: PLUGIN, pluginVersion: "test", repositories, storage: descriptor, site: SITE,
});
const store = (name: string) => new PluginStorageRepository(db, PLUGIN, name, []);
const options = new OptionsRepository(db);
const job = store("scoreScanJobs");
const scores = store("scores");
const revisions = store("scoreAnalysisRevisions");
const profileKey = collectionAnalysisProfileKey("posts");
const policyName = `plugin:${PLUGIN}:${GLOBAL_SETTINGS_KEY}`;
const profileName = `plugin:${PLUGIN}:${profileKey}`;
let entryId: string;
let originalRow: Record<string, unknown>;

async function reset() {
	await db.deleteFrom("_plugin_storage").execute();
	await db.deleteFrom("options").where("name", "in", [policyName, profileName]).execute();
	await job.put("current", { count: 0, receipt: null });
	await options.set(policyName, { version: 1, marker: "enabled" });
	await options.set(profileName, { version: 1, profile: "article" });
	await revisions.put(`posts:${entryId}`, { revision: 1 });
	await db.updateTable("ec_posts").set(originalRow).where("id", "=", entryId).execute();
	await db.deleteFrom("_emdash_seo").where("collection", "=", "posts").execute();
	await db.updateTable("_emdash_collections").set({ has_seo: 1 }).where("slug", "=", "posts").execute();
	beforeBatch = null;
	afterCommit = null;
	injectStatementFailure = false;
}
const ref = () => `posts:${entryId}`;

// This is the existing terminal callback shape: owner fence, dependent reads,
// conditional score storage, and the final exactly-once outcome receipt.
async function terminal(extra?: (ctx: any) => Promise<void>, expectedCount = 0) {
	return acceptance.transaction(async ({ context }) => {
		const ctx = context as any;
		const current = await ctx.storage.scoreScanJobs.getVersioned("current");
		if (current.value.count !== expectedCount) throw new Error("stale owner");
		const fence = await ctx.storage.scoreScanJobs.compareAndSet("current", current.revision, { count: expectedCount, fenced: true });
		assert.equal(fence.applied, true);
		assert.deepEqual(await ctx.storage.scoreScanJobs.get("current"), { count: expectedCount, fenced: true }, "reads see the buffered fence");
		await ctx.kv.getVersioned(GLOBAL_SETTINGS_KEY);
		await ctx.kv.getVersioned(profileKey);
		const entry = await ctx.content.get("posts", entryId);
		assert.equal(savedContentVersion(entry), savedContentVersion((await createContentAccess(db, { site: SITE as any }).get("posts", entryId))!));
		await ctx.storage.scoreAnalysisRevisions.get(ref());
		if (extra) await extra(ctx);
		const currentScore = await ctx.storage.scores.getVersioned(ref());
		const written = await ctx.storage.scores.compareAndSet(ref(), currentScore?.revision ?? null, { ref: ref(), score: 71 });
		assert.equal(written.applied, true);
		assert.deepEqual(await ctx.storage.scores.get(ref()), { ref: ref(), score: 71 });
		const final = await ctx.storage.scoreScanJobs.compareAndSet("current", fence.revision, { count: expectedCount + 1, receipt: "attempt-1" });
		assert.equal(final.applied, true);
		return "accepted";
	}, { collection: "posts" });
}
async function unchanged() {
	assert.deepEqual(await job.get("current"), { count: 0, receipt: null }, "no terminal receipt committed");
	assert.equal(await scores.get(ref()), null, "no score committed");
}

try {
	await runMigrations(db);
	const schema = new SchemaRegistry(db);
	await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] } as any);
	await schema.createField("posts", { slug: "title", label: "Title", type: "string" } as any);
	const entry = await new ContentRepository(db).create({ type: "posts", slug: "first", status: "published", locale: "en", data: { title: "First" } } as any);
	entryId = String(entry.id);
	originalRow = await db.selectFrom("ec_posts").selectAll().where("id", "=", entryId).executeTakeFirstOrThrow();

	await reset();
	assert.equal(await terminal(), "accepted");
	assert.deepEqual(await job.get("current"), { count: 1, receipt: "attempt-1" });
	assert.deepEqual(await scores.get(ref()), { ref: ref(), score: 71 });
	assert.equal(lastStatements.length, 4, "one fenced batch holds both writes and its assertion");

	// Every branch-influencing dependency is tested at commit, not only during
	// the asynchronous read plan. Native SEO has its own independent fence.
	const changes: Array<[string, () => Promise<void>]> = [
		["policy", () => options.set(policyName, { version: 1, marker: "paused" })],
		["profile", () => options.set(profileName, { version: 1, profile: "general" })],
		["content", async () => { await db.updateTable("ec_posts").set({ title: "Changed" }).where("id", "=", entryId).execute(); }],
		["content deletion", async () => { await db.deleteFrom("ec_posts").where("id", "=", entryId).execute(); }],
		["native SEO insertion", async () => { await db.insertInto("_emdash_seo").values({ collection: "posts", content_id: entryId, seo_title: "Changed" }).execute(); }],
		["SEO feature flag", async () => { await db.updateTable("_emdash_collections").set({ has_seo: 0 }).where("slug", "=", "posts").execute(); }],
		["reservation", () => revisions.put(ref(), { revision: 2 })],
		["missing score insertion", () => scores.put(ref(), { ref: ref(), score: 99 })],
		["job owner", () => job.put("current", { count: 0, receipt: null, owner: "other" })],
	];
	for (const [name, change] of changes) {
		// Restore a row deleted by the preceding case.
		if (!(await db.selectFrom("ec_posts").select("id").where("id", "=", entryId).executeTakeFirst()))
			await db.insertInto("ec_posts").values(originalRow).execute();
		await reset();
		beforeBatch = change;
		await assert.rejects(() => terminal(), /malformed JSON/, name);
		if (name !== "job owner") assert.deepEqual(await job.get("current"), { count: 0, receipt: null }, name);
		if (name !== "missing score insertion") assert.equal(await scores.get(ref()), null, name);
		else assert.deepEqual(await scores.get(ref()), { ref: ref(), score: 99 }, "the competing score remains intact");
	}

	await reset();
	await db.insertInto("_emdash_seo").values({ collection: "posts", content_id: entryId, seo_title: "Before" }).execute();
	beforeBatch = async () => { await db.updateTable("_emdash_seo").set({ seo_title: "After" }).where("content_id", "=", entryId).execute(); };
	await assert.rejects(() => terminal(), /malformed JSON/, "an existing native SEO row is fenced");
	await unchanged();

	await reset();
	await options.delete(profileName);
	beforeBatch = () => options.set(profileName, { version: 1, profile: "article" });
	await assert.rejects(() => terminal(), /malformed JSON/, "an absent profile cannot appear between planning and commit");
	await unchanged();

	await reset();
	await scores.put(ref(), { score: 10 });
	beforeBatch = async () => { await scores.delete(ref()); };
	await assert.rejects(() => terminal(), /malformed JSON/, "a previously observed score cannot disappear");
	await unchanged();

	await reset();
	const absentId = "absent-entry";
	beforeBatch = async () => { await db.insertInto("ec_posts").values({ ...originalRow, id: absentId, slug: "appeared", translation_group: absentId }).execute(); };
	await assert.rejects(() => terminal(async (ctx) => {
		assert.equal(await ctx.content.get("posts", absentId), null);
	}), /malformed JSON/, "an absent content row cannot appear");
	await unchanged();
	await db.deleteFrom("ec_posts").where("id", "=", absentId).execute();

	await reset();
	injectStatementFailure = true;
	await assert.rejects(() => terminal(), /injected SQL failure/);
	await unchanged();
	injectStatementFailure = false;

	await reset();
	beforeBatch = async () => { assert.equal(await terminal(), "accepted"); };
	await assert.rejects(() => terminal(), /malformed JSON/, "a competing drain commits the receipt only once");
	assert.deepEqual(await job.get("current"), { count: 1, receipt: "attempt-1" });
	assert.deepEqual(await scores.get(ref()), { ref: ref(), score: 71 });

	await reset();
	afterCommit = () => { throw new Error("lost acknowledgement"); };
	await assert.rejects(() => terminal(), /lost acknowledgement/);
	assert.deepEqual(await job.get("current"), { count: 1, receipt: "attempt-1" }, "an uncertain response has its exact committed receipt");
	const countBeforeReplay = batches;
	await assert.rejects(() => terminal(), /stale owner/);
	assert.equal(batches, countBeforeReplay, "a repeated attempt does not submit another batch");
	assert.deepEqual(await scores.get(ref()), { ref: ref(), score: 71 });

	await reset();
	await acceptance.transaction(async ({ context }) => {
		const ctx = context as any;
		const current = await ctx.storage.scoreScanJobs.getVersioned("current");
		const fence = await ctx.storage.scoreScanJobs.compareAndSet("current", current.revision, { fenced: true });
		const score = await ctx.storage.scores.compareAndSet(ref(), null, { score: 10 });
		assert.equal((await ctx.storage.scores.compareAndDelete(ref(), score.revision)).applied, true);
		assert.equal(await ctx.storage.scores.getVersioned(ref()), null, "buffered deletion is visible before commit");
		assert.equal((await ctx.storage.scoreScanJobs.compareAndSet("current", fence.revision, { count: 1, receipt: "refused" })).applied, true);
	}, { collection: "posts" });
	assert.deepEqual(await job.get("current"), { count: 1, receipt: "refused" });
	assert.equal(await scores.get(ref()), null, "a buffered rollback never publishes its intermediate score");

	await reset();
	await assert.rejects(() => acceptance.transaction(async ({ context }) => {
		await (context.storage as any).scores.compareAndSet(ref(), null, { score: 100 });
		throw new Error("callback failure");
	}, { collection: "posts" }), /callback failure/);
	await unchanged();
	await assert.rejects(() => acceptance.transaction(async ({ context }) => {
		await context.content!.get("pages", "outside");
	}, { collection: "posts" }), /outside the acceptance scope/);
	await assert.rejects(() => acceptance.transaction(async ({ context }) => {
		await (context.storage as any).scoreAnalysisRevisions.compareAndSet(ref(), null, { revision: 2 });
	}, { collection: "posts" }), /reservation writes/);
	await assert.rejects(() => acceptance.transaction(async ({ context }) => {
		await (context.storage as any).scores.compareAndSet(ref(), null, { score: 100 });
	}, { collection: "posts" }), /terminal job fence and receipt/);
	await unchanged();
	const custom = createNativeScoreScanAcceptance({
		db: db.withPlugin({ transformQuery: ({ node }: any) => node, transformResult: async ({ result }: any) => result }),
		pluginId: PLUGIN, pluginVersion: "test", repositories, storage: descriptor, site: SITE,
	});
	await assert.rejects(() => custom.transaction(async () => "unreachable", { collection: "posts" }), /custom database plugins/,
		"never silently strip a host query plugin that may carry access constraints");

	// Exercise the real acceptance engine through these ports, including its
	// post-write policy/profile/reservation reads and their buffered snapshots.
	await reset();
	await options.set(policyName, {
		version: 1, updatedAt: "2026-10-01T00:00:00.000Z", siteName: "Example", siteUrl: SITE.url, organizationName: "Example",
		organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false,
		contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1,
	});
	await options.set(profileName, { version: 1, profile: "article", updatedAt: "2026-10-15T00:00:00.000Z" });
	await revisions.put(ref(), { id: ref(), ref: ref(), storageVersion: 1, revision: 1, updatedAt: "2026-10-04T10:00:00.000Z" });
	await acceptance.transaction(async ({ context }) => {
		const ctx = context as any;
		const current = await ctx.storage.scoreScanJobs.getVersioned("current");
		const fence = await ctx.storage.scoreScanJobs.compareAndSet("current", current.revision, { count: 0, fenced: true });
		const policy = await readContentScoringPolicy(context);
		assert.equal(policy.state, "enabled");
		if (policy.state !== "enabled") throw new Error("Expected enabled scoring");
		const profile = await readCollectionAnalysisProfile(context, "posts");
		assert.equal(profile.state, "configured");
		if (profile.state !== "configured") throw new Error("Expected an Article profile");
		const content = await context.content!.get("posts", entryId) as any;
		const score = {
			ref: ref(), collection: "posts", entryId, slug: "first", title: "First", score: 71, grade: "needs-improvement", status: "published",
			checks: [], metrics: {}, url: null, sourceUpdatedAt: content.updatedAt ?? null, scoreVersion: SEO_SCORE_VERSION, analysisRevision: 1,
			assessmentProfile: { profile: profile.profile, version: profile.version }, assessmentProfileRevision: profile.revision,
			sourceVersion: savedContentVersion(content), updatedAt: "2026-10-04T10:00:00.000Z", templateUpdatedAt: null,
			modulesUpdatedAt: null, configurationFingerprint: "fixture", metaOverrideUpdatedAt: null,
			inputIdentity: `seo-input-v1-sha256-${"0".repeat(64)}`,
		} as any;
		assert.deepEqual(await acceptAnalyzedScore(context, score, { admission: policy }), { persisted: true });
		assert.equal((await ctx.storage.scoreScanJobs.compareAndSet("current", fence.revision, { count: 1, receipt: "real-engine" })).applied, true);
	}, { collection: "posts" });
	assert.equal((await scores.get(ref()) as any)?.analysisRevision, 1);
	assert.deepEqual(await job.get("current"), { count: 1, receipt: "real-engine" });
} finally {
	delete adapter.executeAtomicBatch;
	await db.destroy();
}

console.log("shipit-seo native atomic score acceptance self-check passed");
