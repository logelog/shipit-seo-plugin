import assert from "node:assert/strict";

import { ContentRepository, OptionsRepository, PluginStorageRepository, SchemaRegistry, createContentAccess, createSettingsAccess } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";

import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import { seoPlugin } from "./index.ts";
import { acceptAnalyzedScore } from "./score-history.ts";
import { createNativeScoreScanAcceptance } from "./score-scan-native-acceptance.ts";
import { readContentScoringPolicy } from "./settings-runtime.ts";
import { collectionAnalysisProfileKey, readCollectionAnalysisProfile } from "./collection-analysis-profile.ts";
import { SEO_SCORE_VERSION } from "./analysis.ts";
import type { ScoreScanBoundPorts } from "./score-scan.ts";

const PLUGIN = "shipit-seo";
const SITE = { name: "Example", url: "https://example.com", locale: "en" };
const settings = (contentScoringEnabled: boolean) => ({
	version: 1, updatedAt: "2026-10-01T00:00:00.000Z", siteName: "Example", siteUrl: SITE.url, organizationName: "Example",
	organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false, contentScoringEnabled,
	contentScoringResourceNoticeVersion: 1,
});

// A disposable in-memory database with the published host's migrations and repositories.
const db = new Kysely<any>({ dialect: createDialect({ url: ":memory:" }) });
try {
	await runMigrations(db);
	const descriptor = seoPlugin();
	const repositories = { PluginStorageRepository, OptionsRepository, createSettingsAccess, createContentAccess };
	const configuredAcceptance = createNativeScoreScanAcceptance({
		db, pluginId: PLUGIN, pluginVersion: "test", repositories, storage: descriptor.storage ?? {}, site: SITE,
	});
	const acceptance = { transaction: <T>(work: (ports: ScoreScanBoundPorts) => Promise<T>) => configuredAcceptance.transaction(work, { collection: "posts" }) };
	const baseStore = (collection: string) =>
		new PluginStorageRepository(db, PLUGIN, collection, [...((descriptor.storage as any)?.[collection]?.indexes ?? [])]);
	const options = new OptionsRepository(db);

	// ---- Policy reads keep the host settings key, decoder and opaque revision ----

	assert.equal((await acceptance.transaction(async ({ context }) => readContentScoringPolicy(context))).state, "pending-confirmation",
		"an absent record cannot admit analysis");
	await options.set(`plugin:${PLUGIN}:settings:global:v1`, settings(true));
	const base = await createSettingsAccess(options, PLUGIN).getVersioned("global:v1");
	assert.ok(base && typeof base.revision === "string");
	const enabled = await acceptance.transaction(async ({ context }) => readContentScoringPolicy(context));
	assert.equal(enabled.state, "enabled");
	assert.equal(enabled.revision, base.revision);
	await options.set(`plugin:${PLUGIN}:settings:global:v1`, settings(false));
	const disabled = await acceptance.transaction(async ({ context }) => readContentScoringPolicy(context));
	assert.equal(disabled.state, "paused");
	await options.set(`plugin:${PLUGIN}:settings:global:v1`, { $emdash: "plugin-setting", v: 1, kid: "0123abcd", iv: "aaaaaaaaaaaaaaaa", ciphertext: "bbbbbbbbbbbbbbbb" });
	assert.deepEqual(await acceptance.transaction(async ({ context }) => readContentScoringPolicy(context)), { state: "unavailable", reason: "unreadable" },
		"an undeclared encrypted envelope is rejected by the host decoder");
	await options.set(`plugin:${PLUGIN}:settings:global:v1`, settings(true));
	await options.set(`plugin:${PLUGIN}:${collectionAnalysisProfileKey("posts")}`, { version: 1, profile: "article", updatedAt: "2026-10-15T00:00:00.000Z" });
	const selected = await acceptance.transaction(async ({ context }) => readCollectionAnalysisProfile(context, "posts"));
	assert.equal(selected.state, "configured");
	if (selected.state !== "configured") throw new Error("Expected a configured Article profile.");
	const policy = await acceptance.transaction(async ({ context }) => readContentScoringPolicy(context));
	assert.equal(policy.state, "enabled");

	// ---- Only bound ports exist inside the transaction ----

	await acceptance.transaction(async ({ context }) => {
		assert.deepEqual(Object.keys(context.storage).sort(), ["scoreAnalysisRevisions", "scoreScanJobs", "scores"]);
		await assert.rejects(() => context.kv.getVersioned("configuration:modules:v1"), /cannot use kv\.getVersioned/);
		await assert.rejects(() => context.kv.getVersioned(collectionAnalysisProfileKey("pages")), /cannot use kv\.getVersioned/, "another collection's profile is outside the transaction scope");
		assert.equal((context as any).settings, undefined);
		assert.equal(typeof (context.kv as any).set, "undefined", "no write port outside the acceptance collections");
	});
	assert.throws(() => createNativeScoreScanAcceptance({ db: {}, pluginId: PLUGIN, pluginVersion: "test", repositories, storage: descriptor.storage ?? {} }),
		/transactional host database/, "no nontransactional fallback");
	assert.throws(() => createNativeScoreScanAcceptance({ db, pluginId: PLUGIN, pluginVersion: "test", repositories, storage: {} }), /declared scores collection/);
	const fake = createNativeScoreScanAcceptance({
		db: { transaction: () => ({ execute: (work: (trx: unknown) => unknown) => work(db) }) },
		pluginId: PLUGIN, pluginVersion: "test", repositories, storage: descriptor.storage ?? {},
	});
	await assert.rejects(() => fake.transaction(async () => "unreachable", { collection: "posts" }), /did not open a transaction/, "a base connection is never accepted as a transaction");

	// ---- Rollback and commit ----

	await assert.rejects(() => acceptance.transaction(async ({ context }) => {
		await (context.storage as any).scoreScanJobs.put("current", { probe: true });
		throw new Error("injected callback failure");
	}), /injected callback failure/);
	assert.equal(await baseStore("scoreScanJobs").get("current"), null, "a thrown callback rolls back every bound write");
	const created = await acceptance.transaction(async ({ context }) => (context.storage as any).scoreScanJobs.compareAndSet("current", null, { probe: 1 }));
	assert.equal(created.applied, true);
	const fenced = await acceptance.transaction(async ({ context }) => {
		const jobs = (context.storage as any).scoreScanJobs;
		const current = await jobs.getVersioned("current");
		const fence = await jobs.compareAndSet("current", current.revision, { probe: 2 });
		assert.notEqual(fence.revision, current.revision, "the fence write rotates the stored revision");
		return jobs.compareAndSet("current", fence.revision, { probe: 3 });
	});
	assert.equal(fenced.applied, true, "the final write names the fence's fresh revision");
	assert.deepEqual(await baseStore("scoreScanJobs").get("current"), { probe: 3 });

	// ---- Content versions and real score acceptance inside the transaction ----

	const schema = new SchemaRegistry(db);
	await schema.createCollection({ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/posts/{slug}", supports: ["drafts", "revisions"] } as any);
	await schema.createField("posts", { slug: "title", label: "Title", type: "string" } as any);
	const entry = await new ContentRepository(db).create({ type: "posts", slug: "first", status: "published", locale: "en", data: { title: "First" } } as any);
	const id = String((entry as any).id);
	const plain = await createContentAccess(db, { site: SITE as any, revisions: true }).get("posts", id);
	const boundRow = await acceptance.transaction(async ({ context }) => context.content!.get("posts", id));
	assert.ok(boundRow && Object.hasOwn(boundRow, "version") && Object.hasOwn(boundRow, "draftRevisionId"));
	assert.equal(savedContentVersion(boundRow as any), savedContentVersion(plain as any), "bound reads keep the ordinary saved version");

	const ref = `posts:${id}`;
	await baseStore("scoreAnalysisRevisions").put(ref, { id: ref, ref, storageVersion: 1, revision: 1, updatedAt: "2026-10-04T10:00:00.000Z" });
	const score = {
		ref, collection: "posts", entryId: id, slug: "first", title: "First", score: 80, grade: "good", status: "published",
		checks: [], metrics: {}, url: null, sourceUpdatedAt: (plain as any).updatedAt ?? null, scoreVersion: SEO_SCORE_VERSION, analysisRevision: 1,
		assessmentProfile: { profile: selected.profile, version: selected.version }, assessmentProfileRevision: selected.revision,
		sourceVersion: savedContentVersion(plain as any), updatedAt: "2026-10-04T10:00:00.000Z", templateUpdatedAt: null,
		modulesUpdatedAt: null, configurationFingerprint: "fixture", metaOverrideUpdatedAt: null,
		inputIdentity: `seo-input-v1-sha256-${"0".repeat(64)}`,
	} as any;
	const admission = policy.state === "enabled" ? policy : null;
	assert.ok(admission);
	await assert.rejects(() => acceptance.transaction(async ({ context }) => {
		assert.deepEqual(await acceptAnalyzedScore(context, score, { admission }), { persisted: true });
		throw new Error("injected receipt failure");
	}), /injected receipt failure/);
	assert.equal(await baseStore("scores").get(ref), null, "an accepted score rolls back with a failed receipt");
	const accepted = await acceptance.transaction(async ({ context }) => acceptAnalyzedScore(context, score, { admission }));
	assert.deepEqual(accepted, { persisted: true });
	assert.equal((await baseStore("scores").get(ref) as any)?.analysisRevision, 1, "a committed acceptance is visible to the base connection");
	await options.set(`plugin:${PLUGIN}:${collectionAnalysisProfileKey("posts")}`, { version: 1, profile: "general", updatedAt: "2026-10-15T01:00:00.000Z" });
	assert.deepEqual(await acceptance.transaction(async ({ context }) => acceptAnalyzedScore(context, score, { admission })),
		{ persisted: false, refusal: "policy-changed" }, "a changed profile refuses terminal acceptance and preserves the previous score");
	assert.equal((await baseStore("scores").get(ref) as any)?.assessmentProfile.profile, "article");
	await options.set(`plugin:${PLUGIN}:${collectionAnalysisProfileKey("posts")}`, { version: 1, profile: "article", updatedAt: "2026-10-15T02:00:00.000Z" });
	const restored = await acceptance.transaction(async ({ context }) => readCollectionAnalysisProfile(context, "posts"));
	if (restored.state !== "configured") throw new Error("Expected the restored Article profile.");
	score.assessmentProfileRevision = restored.revision;
	assert.deepEqual(await acceptance.transaction(async ({ context }) => acceptAnalyzedScore(context, score, { admission })),
		{ persisted: true }, "matching profile and policy admit acceptance before the policy revision changes");
	await options.set(`plugin:${PLUGIN}:settings:global:v1`, settings(true));
	assert.deepEqual(await acceptance.transaction(async ({ context }) => acceptAnalyzedScore(context, { ...score, analysisRevision: 1 }, { admission })),
		{ persisted: false, refusal: "policy-changed" }, "a policy save after admission refuses acceptance inside the transaction");
} finally {
	await db.destroy();
}

console.log("shipit-seo native score scan acceptance self-check passed");
