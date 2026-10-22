import { SEO_ADMIN_CONTRACT_VERSION, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import seoRuntime from "./sandbox-entry.ts";
import { parseSeoAdminLegacyDiscardResponse, parseSeoAdminMigrationPlan } from "./admin-ui/contract.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

class MemoryCollection {
	items = new Map<string, any>();

	async get(id: string) {
		return clone(this.items.get(id) ?? null);
	}

	async put(id: string, value: unknown) {
		this.items.set(id, clone(value));
	}

	async delete(id: string) {
		return this.items.delete(id);
	}

	async compareAndSet(
		id: string,
		expected:
			| { state: "missing" }
			| { state: "value"; value: unknown },
		next:
			| { action: "put"; value: unknown }
			| { action: "delete" },
	) {
		const present = this.items.has(id);
		if (expected.state === "missing" ? present : !present) return false;
		if (
			expected.state === "value" &&
			JSON.stringify(this.items.get(id)) !== JSON.stringify(expected.value)
		)
			return false;
		if (next.action === "delete") return this.delete(id);
		await this.put(id, next.value);
		return true;
	}

	async count() {
		return this.items.size;
	}

	async query(options: any = {}): Promise<any> {
		let entries = [...this.items.entries()].map(([id, data]) => ({ id, data: clone(data) }));
		if (options.where) {
			entries = entries.filter((entry) =>
				Object.entries(options.where).every(([key, value]) => entry.data?.[key] === value),
			);
		}
		if (options.orderBy) {
			const [field, direction] = Object.entries(options.orderBy)[0] as [string, "asc" | "desc"];
			entries.sort((a, b) => String(a.data?.[field] ?? "").localeCompare(String(b.data?.[field] ?? "")));
			if (direction === "desc") entries.reverse();
		}
		return { items: entries.slice(0, options.limit ?? 50), cursor: undefined, hasMore: false };
	}
}

function createContext(
	options: { coreTitle?: string | null; ref?: string } = {},
) {
	const ref = options.ref ?? "posts:article-id";
	const overrides = new MemoryCollection();
	const migrations = new MemoryCollection();
	const migrationOperations = new MemoryCollection();
	const scores = new MemoryCollection();
	const scoreAnalysisRevisions = new MemoryCollection();
	const schemas = new MemoryCollection();
	const operationLeases = new MemoryCollection();
	const kv = new Map<string, unknown>();
	const contentItems = new Map<string, any>();
	let updateCount = 0;

	overrides.items.set(ref, {
		ref,
		title: "Legacy SEO title for the article page",
		description:
			"A complete legacy description that is long enough to represent a realistic search result while testing the reversible core SEO migration workflow.",
		canonical: "https://shipitdigital.nl/blog/article-slug",
		robots: "noindex,follow",
		ogImage: "https://shipitdigital.nl/og/article.png",
		updatedAt: "2026-07-14T12:00:00.000Z",
	});

	contentItems.set("article-id", {
		id: "article-id",
		type: "posts",
		slug: "article-slug",
		status: "published",
		locale: "en",
		data: {
			title: "Article title",
			content: Array.from({ length: 500 }, () => "useful").join(" "),
		},
		seo: {
			title: options.coreTitle ?? null,
			description: null,
			image: null,
			canonical: null,
			noIndex: false,
		},
		revision: { contentVersion: 1, seoVersion: 1 },
		createdAt: "2026-07-01T00:00:00.000Z",
		updatedAt: "2026-07-14T10:00:00.000Z",
		publishedAt: "2026-07-14T10:00:00.000Z",
	});

	const context: any = {
		plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
		schema: { listCollections: async () => [{
			slug: "posts", label: "Posts", hasSeo: true,
			urlPattern: "/blog/{slug}", routable: true, hidden: false,
		}] },
		storage: {
			overrides,
			migrations,
			migrationOperations,
			scores,
			scoreAnalysisRevisions,
			schemas,
			operationLeases,
		},
		kv: {
			get: async (key: string) => clone(kv.get(key) ?? null),
			// Published hosts read settings with revisions; unchanged rows keep one.
			getVersioned: async (key: string) => kv.has(key) ? { value: clone(kv.get(key)), revision: "r1" } : null,
			set: async (key: string, value: unknown) => void kv.set(key, clone(value)),
			delete: async (key: string) => kv.delete(key),
			list: async () => [],
		},
		content: {
			get: async (collection: string, id: string) => {
				const item = contentItems.get(id);
				return item?.type === collection ? clone(item) : null;
			},
			list: async (collection: string) => ({
				items: [...contentItems.values()]
					.filter((item) => item.type === collection)
					.map((item) => {
						const listed = clone(item);
						delete listed.seo;
						return listed;
					}),
				cursor: undefined,
				hasMore: false,
			}),
			update: async (collection: string, id: string, input: any) => {
				const item = contentItems.get(id);
				if (!item || item.type !== collection) throw new Error("Content not found");
				updateCount += 1;
				item.seo = { ...item.seo, ...(input.seo ?? {}) };
				item.revision = {
					contentVersion: item.revision.contentVersion,
					seoVersion: item.revision.seoVersion + 1,
				};
				return clone(item);
			},
			updateIfUnchanged: async (
				collection: string,
				id: string,
				input: any,
				expectedRevision: { contentVersion: number; seoVersion: number },
			) => {
				const item = contentItems.get(id);
				if (!item || item.type !== collection) throw new Error("Content not found");
				if (
					item.revision.contentVersion !== expectedRevision.contentVersion ||
					item.revision.seoVersion !== expectedRevision.seoVersion
				)
					return { updated: false, conflict: true };
				return {
					updated: true,
					item: await context.content.update(collection, id, input),
				};
			},
		},
		log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
		site: { name: "Shipit Digital", url: "https://shipitdigital.nl" },
		url: (path: string) => new URL(path, "https://shipitdigital.nl").toString(),
	};

	return {
		context,
		ref,
		overrides,
		migrations,
		migrationOperations,
		scores,
		operationLeases,
		contentItems,
		get updateCount() {
			return updateCount;
		},
	};
}

function handler(name: string) {
	return (seoRuntime as any).routes[name].handler as (routeContext: any, context: any) => Promise<any>;
}

function route(input: Record<string, unknown>) {
	return { input, request: { url: "https://shipitdigital.nl/_emdash/api/plugins/shipit-seo/test", method: "POST", headers: {} } };
}

async function migrationSelections(
	context: any,
	refs: string[],
	conflictPolicy: "skip" | "prefer-core" | "prefer-legacy" = "skip",
) {
	const preview = await handler("core-seo-migration-plan")(
		route({ refs, conflictPolicy, limit: 100 }),
		context,
	);
	return refs.map((sourceOverrideId) => {
		const item = preview.items.find(
			(candidate: any) => candidate.sourceOverrideId === sourceOverrideId,
		);
		if (!item)
			throw new Error(`Missing migration preview for ${sourceOverrideId}`);
		return { sourceOverrideId, fingerprint: item.fingerprint };
	});
}

async function applyMigration(
	context: any,
	refs: string[],
	conflictPolicy: "skip" | "prefer-core" | "prefer-legacy" = "skip",
	confirm = "MIGRATE_TO_CORE_SEO",
) {
	const plans = await migrationSelections(context, refs, conflictPolicy);
	return handler("core-seo-migration-apply")(
		route({ plans, conflictPolicy, confirm }),
		context,
	);
}

const rejectedFixture = createContext();
const rejected = await applyMigration(
	rejectedFixture.context,
	[rejectedFixture.ref],
	"skip",
	"wrong",
);
check("wrong confirmation rejects migration", rejected.success === false && rejected.error === "confirmation_required");
check(
	"migration errors carry versioned admin metadata",
	rejected.contractVersion === SEO_ADMIN_CONTRACT_VERSION && rejected.engineVersion === SEO_ENGINE_VERSION,
);
check("wrong confirmation performs no writes", rejectedFixture.updateCount === 0 && rejectedFixture.migrations.items.size === 0);

const missingContentCasFixture = createContext();
missingContentCasFixture.context.content.updateIfUnchanged = undefined;
const missingContentCasPlan = await handler("core-seo-migration-plan")(
	route({ refs: [missingContentCasFixture.ref], conflictPolicy: "skip", limit: 100 }),
	missingContentCasFixture.context,
);
check(
	"migration plan stays readable but reports unavailable writes without conditional content updates",
	missingContentCasPlan.success === true &&
		missingContentCasPlan.writeAvailable === false &&
		missingContentCasPlan.items[0]?.state === "ready" &&
		missingContentCasFixture.updateCount === 0 &&
		missingContentCasFixture.migrations.items.size === 0,
);
const missingContentCasBlocks = await handler("admin")(
	route({ page: "overrides" }), missingContentCasFixture.context,
);
check(
	"Block Kit migration reports missing guarded-write support rather than content:write access",
	missingContentCasBlocks.blocks.some(
		(block: any) => block.type === "context" && block.text?.includes("guarded-write capabilities"),
	) && !JSON.stringify(missingContentCasBlocks.blocks).includes("content:write"),
);
const missingContentCasApply = await applyMigration(
	missingContentCasFixture.context,
	[missingContentCasFixture.ref],
);
check(
	"migration apply fails closed without conditional content writes",
	missingContentCasApply.success === false &&
		missingContentCasApply.error === "content_write_unavailable" &&
		missingContentCasFixture.updateCount === 0 &&
		missingContentCasFixture.migrations.items.size === 0 &&
		missingContentCasFixture.overrides.items.has(missingContentCasFixture.ref),
);

const missingOverrideCasFixture = createContext();
missingOverrideCasFixture.overrides.compareAndSet = undefined as any;
const missingOverrideCasPlan = await handler("core-seo-migration-plan")(
	route({ refs: [missingOverrideCasFixture.ref], conflictPolicy: "skip", limit: 100 }),
	missingOverrideCasFixture.context,
);
check("migration plan reports unavailable writes without conditional override storage", missingOverrideCasPlan.writeAvailable === false);
const missingOverrideCasApply = await applyMigration(
	missingOverrideCasFixture.context,
	[missingOverrideCasFixture.ref],
);
check(
	"migration apply fails closed without conditional override writes",
	missingOverrideCasApply.success === false &&
		missingOverrideCasApply.error === "content_write_unavailable" &&
		missingOverrideCasFixture.updateCount === 0 &&
		missingOverrideCasFixture.migrations.items.size === 0 &&
		missingOverrideCasFixture.overrides.items.has(missingOverrideCasFixture.ref),
);

const missingOperationCasFixture = createContext();
missingOperationCasFixture.migrationOperations.compareAndSet = undefined as any;
const missingOperationCasPlan = await handler("core-seo-migration-plan")(
	route({ refs: [missingOperationCasFixture.ref], conflictPolicy: "skip", limit: 100 }),
	missingOperationCasFixture.context,
);
check("migration plan reports unavailable writes without conditional recovery storage", missingOperationCasPlan.writeAvailable === false);
const missingOperationCasApply = await applyMigration(
	missingOperationCasFixture.context,
	[missingOperationCasFixture.ref],
);
check(
	"migration apply fails closed without conditional recovery writes",
	missingOperationCasApply.success === false &&
		missingOperationCasApply.error === "content_write_unavailable" &&
		missingOperationCasFixture.updateCount === 0 &&
		missingOperationCasFixture.migrations.items.size === 0 &&
		missingOperationCasFixture.migrationOperations.items.size === 0 &&
		missingOperationCasFixture.overrides.items.has(
			missingOperationCasFixture.ref,
		),
);

const unsupportedSlugLookupFixture = createContext({
	ref: "posts:article-slug",
});
let unsupportedSlugListCalls = 0;
unsupportedSlugLookupFixture.context.content.get = async () => null;
unsupportedSlugLookupFixture.context.content.list = async () => {
	unsupportedSlugListCalls += 1;
	return { items: [], cursor: undefined, hasMore: false };
};
const unsupportedSlugPlan = await handler("core-seo-migration-plan")(
	route({
		refs: [unsupportedSlugLookupFixture.ref],
		conflictPolicy: "skip",
		limit: 100,
	}),
	unsupportedSlugLookupFixture.context,
);
check(
	"migration lookup fails closed without a direct bounded identifier lookup",
	unsupportedSlugPlan.items[0]?.state === "identifier-lookup-unavailable" &&
		String(unsupportedSlugPlan.items[0]?.detail).includes(
			"does not expose a bounded slug lookup",
		) &&
		unsupportedSlugListCalls === 0,
);

const fixture = createContext();
await fixture.context.kv.set("settings:global:v1", {
	version: 1, updatedAt: "2026-10-15T00:00:00.000Z",
	siteName: "Shipit Digital", siteUrl: "https://shipitdigital.nl",
	organizationName: "Shipit Digital", organizationLogo: "", socialProfiles: [],
	defaultSocialImage: "", twitterHandle: "", noindex: false,
	contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1,
});
await fixture.context.kv.set("configuration:analysis-profile:v1:posts", {
	profile: "article", version: 1, updatedAt: "2026-10-15T00:00:00.000Z",
});
const preview = await handler("core-seo-migration-plan")(
	route({ refs: [fixture.ref], conflictPolicy: "skip", limit: 100 }),
	fixture.context,
);
check("ID-based legacy ref resolves to the core entry", preview.items[0]?.entryId === "article-id");
check("migration preview is ready and non-mutating", preview.items[0]?.state === "ready" && fixture.updateCount === 0);
check("migration preview reports safe writes when all host capabilities are present", preview.writeAvailable === true);
check(
	"migration preview carries the versioned native-admin envelope",
	preview.contractVersion === SEO_ADMIN_CONTRACT_VERSION && preview.migrationVersion === 1 && typeof preview.generatedAt === "string",
);
check(
	"migration preview binds every item to a SHA-256 plan fingerprint",
	/^sha256-[a-f0-9]{64}$/.test(preview.items[0]?.fingerprint ?? ""),
);

const staleFingerprintFixture = createContext({
	coreTitle: "Core title reviewed by the admin",
});
const staleFingerprintPreview = await handler("core-seo-migration-plan")(
	route({
		refs: [staleFingerprintFixture.ref],
		conflictPolicy: "prefer-legacy",
		limit: 100,
	}),
	staleFingerprintFixture.context,
);
const staleFingerprintPlans = staleFingerprintPreview.items.map(
	(item: any) => ({
		sourceOverrideId: item.sourceOverrideId,
		fingerprint: item.fingerprint,
	}),
);
staleFingerprintFixture.contentItems.get("article-id").seo.title =
	"New human core edit after preview";
const staleFingerprintApply = await handler("core-seo-migration-apply")(
	route({
		plans: staleFingerprintPlans,
		conflictPolicy: "prefer-legacy",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	staleFingerprintFixture.context,
);
check(
	"apply rejects a core edit made after the reviewed prefer-legacy preview",
	staleFingerprintApply.success === false &&
		staleFingerprintApply.results[0]?.status === "changed-since-preview",
);
check(
	"stale plan fingerprint rejection performs no migration write",
	staleFingerprintFixture.updateCount === 0 &&
		staleFingerprintFixture.migrations.items.size === 0 &&
		staleFingerprintFixture.overrides.items.has(staleFingerprintFixture.ref) &&
		staleFingerprintFixture.contentItems.get("article-id").seo.title ===
			"New human core edit after preview",
);

const contentCasRaceFixture = createContext();
const contentCasRacePlans = await migrationSelections(
	contentCasRaceFixture.context,
	[contentCasRaceFixture.ref],
);
const contentCasUpdate =
	contentCasRaceFixture.context.content.updateIfUnchanged.bind(
		contentCasRaceFixture.context.content,
	);
let injectedContentCasEdit = false;
contentCasRaceFixture.context.content.updateIfUnchanged = async (
	collection: string,
	id: string,
	input: unknown,
	expectedRevision: { contentVersion: number; seoVersion: number },
) => {
	if (!injectedContentCasEdit) {
		injectedContentCasEdit = true;
		const item = contentCasRaceFixture.contentItems.get(id);
		item.seo.title = "Human core edit inside the final CAS gap";
		item.revision.seoVersion += 1;
	}
	return contentCasUpdate(collection, id, input, expectedRevision);
};
const contentCasRaceApply = await handler("core-seo-migration-apply")(
	route({
		plans: contentCasRacePlans,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	contentCasRaceFixture.context,
);
check(
	"conditional core write preserves an edit in the final read-write gap",
	contentCasRaceApply.success === false &&
		contentCasRaceApply.results[0]?.status === "changed-since-preview" &&
		contentCasRaceFixture.contentItems.get("article-id").seo.title ===
			"Human core edit inside the final CAS gap" &&
		contentCasRaceFixture.overrides.items.has(contentCasRaceFixture.ref),
);

const overrideDeleteCasFixture = createContext();
const overrideDeletePlans = await migrationSelections(
	overrideDeleteCasFixture.context,
	[overrideDeleteCasFixture.ref],
);
const overrideDeleteCas =
	overrideDeleteCasFixture.overrides.compareAndSet.bind(
		overrideDeleteCasFixture.overrides,
	);
let injectedOverrideDeleteEdit = false;
overrideDeleteCasFixture.overrides.compareAndSet = async (
	id: string,
	expected: any,
	next: any,
) => {
	if (!injectedOverrideDeleteEdit && next.action === "delete") {
		injectedOverrideDeleteEdit = true;
		overrideDeleteCasFixture.overrides.items.set(id, {
			...overrideDeleteCasFixture.overrides.items.get(id),
			title: "Human legacy edit inside the final CAS gap",
		});
	}
	return overrideDeleteCas(id, expected, next);
};
const overrideDeleteCasApply = await handler("core-seo-migration-apply")(
	route({
		plans: overrideDeletePlans,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	overrideDeleteCasFixture.context,
);
check(
	"conditional legacy delete preserves an edit in the final read-delete gap",
	overrideDeleteCasApply.success === false &&
		overrideDeleteCasApply.results[0]?.status === "changed-since-preview" &&
		overrideDeleteCasFixture.overrides.items.get(overrideDeleteCasFixture.ref)
			?.title === "Human legacy edit inside the final CAS gap" &&
		overrideDeleteCasFixture.contentItems.get("article-id").seo.title === null,
);

const rawOwnerClaimFixture = createContext();
const rawOwnerClaimPlans = await migrationSelections(
	rawOwnerClaimFixture.context,
	[rawOwnerClaimFixture.ref],
);
const rawOwnerLeasePut = rawOwnerClaimFixture.operationLeases.put.bind(
	rawOwnerClaimFixture.operationLeases,
);
let injectedRawOwnerEdit = false;
rawOwnerClaimFixture.operationLeases.put = async (
	id: string,
	value: unknown,
) => {
	await rawOwnerLeasePut(id, value);
	if (!injectedRawOwnerEdit) {
		injectedRawOwnerEdit = true;
		rawOwnerClaimFixture.overrides.items.set(rawOwnerClaimFixture.ref, {
			...rawOwnerClaimFixture.overrides.items.get(rawOwnerClaimFixture.ref),
			hostCompatibilityNote: "human-owned unmapped value",
		});
	}
};
const rawOwnerClaimApply = await handler("core-seo-migration-apply")(
	route({
		plans: rawOwnerClaimPlans,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	rawOwnerClaimFixture.context,
);
check(
	"claim-time validation detects an unmapped raw legacy owner edit",
	rawOwnerClaimApply.success === false &&
		rawOwnerClaimApply.results[0]?.status === "changed-since-preview",
);
check(
	"unmapped owner edit survives without core, journal, or delete writes",
	rawOwnerClaimFixture.updateCount === 0 &&
		rawOwnerClaimFixture.migrations.items.size === 0 &&
		rawOwnerClaimFixture.overrides.items.get(rawOwnerClaimFixture.ref)
			?.hostCompatibilityNote === "human-owned unmapped value",
);

const preparedJournalRaceFixture = createContext();
const preparedJournalRacePlans = await migrationSelections(
	preparedJournalRaceFixture.context,
	[preparedJournalRaceFixture.ref],
);
const committedPreparedJournalPut =
	preparedJournalRaceFixture.migrations.put.bind(
		preparedJournalRaceFixture.migrations,
	);
let injectedPreparedJournalCoreEdit = false;
preparedJournalRaceFixture.migrations.put = async (id: string, value: any) => {
	await committedPreparedJournalPut(id, value);
	if (!injectedPreparedJournalCoreEdit && value?.status === "prepared") {
		injectedPreparedJournalCoreEdit = true;
		preparedJournalRaceFixture.contentItems.get("article-id").seo.title =
			"Human core edit during prepared journal";
	}
};
const preparedJournalRaceApply = await handler("core-seo-migration-apply")(
	route({
		plans: preparedJournalRacePlans,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	preparedJournalRaceFixture.context,
);
check(
	"prepared journal is followed by an exact pre-core ownership reread",
	preparedJournalRaceApply.success === false &&
		preparedJournalRaceApply.results[0]?.status === "changed-since-preview" &&
		preparedJournalRaceFixture.updateCount === 0,
);
check(
	"human core edit after journal prepare survives with the legacy owner",
	preparedJournalRaceFixture.contentItems.get("article-id").seo.title ===
		"Human core edit during prepared journal" &&
		preparedJournalRaceFixture.overrides.items.has(
			preparedJournalRaceFixture.ref,
		) &&
		[...preparedJournalRaceFixture.migrations.items.values()][0]?.status ===
			"failed",
);

const duplicateOwnerFixture = createContext();
duplicateOwnerFixture.overrides.items.set("posts:article-slug", {
	...duplicateOwnerFixture.overrides.items.get(duplicateOwnerFixture.ref),
	ref: "posts:article-slug",
	updatedAt: "2026-07-14T12:00:01.000Z",
});
const duplicateOwnerPlan = await handler("core-seo-migration-plan")(
	route({
		refs: [duplicateOwnerFixture.ref],
		conflictPolicy: "skip",
		limit: 100,
	}),
	duplicateOwnerFixture.context,
);
check(
	"ID and slug legacy owners for one entry are blocked before migration",
	duplicateOwnerPlan.items[0]?.state === "conflict" &&
		String(duplicateOwnerPlan.items[0]?.detail).includes(
			"Multiple legacy owners",
		),
);
const duplicateOwnerApply = await applyMigration(
	duplicateOwnerFixture.context,
	[duplicateOwnerFixture.ref],
);
check(
	"duplicate legacy owners perform no core or ownership write",
	duplicateOwnerApply.success === false &&
		duplicateOwnerApply.results[0]?.status === "conflict" &&
		duplicateOwnerFixture.updateCount === 0 &&
		duplicateOwnerFixture.overrides.items.size === 2,
);

const applied = await applyMigration(fixture.context, [fixture.ref]);
const appliedCore = fixture.contentItems.get("article-id").seo;
const appliedRecord = [...fixture.migrations.items.values()][0];
check("confirmed migration applies core SEO", applied.success === true && appliedCore.title === "Legacy SEO title for the article page");
check("confirmed migration removes the legacy owner", !fixture.overrides.items.has(fixture.ref));
check("backup journal is committed before handoff completes", appliedRecord?.status === "applied" && appliedRecord?.before?.title === null);
check("migration refreshes the derived score cache", fixture.scores.items.has("posts:article-id"));

const afterCoreCheckpointFixture = createContext();
const afterCoreCheckpointSelections = await migrationSelections(
	afterCoreCheckpointFixture.context,
	[afterCoreCheckpointFixture.ref],
);
const afterCoreCheckpointInitial = await handler("core-seo-migration-apply")(
	route({
		plans: afterCoreCheckpointSelections,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	afterCoreCheckpointFixture.context,
);
const afterCoreCheckpointJournal = clone(
	[...afterCoreCheckpointFixture.migrations.items.values()][0],
);
const afterCoreCheckpointOperation = clone(
	[...afterCoreCheckpointFixture.migrationOperations.items.values()][0],
);
afterCoreCheckpointJournal.status = "prepared";
delete afterCoreCheckpointJournal.error;
afterCoreCheckpointOperation.status = "prepared";
afterCoreCheckpointOperation.record = clone(afterCoreCheckpointJournal);
afterCoreCheckpointFixture.migrations.items.set(
	afterCoreCheckpointJournal.id,
	clone(afterCoreCheckpointJournal),
);
afterCoreCheckpointFixture.migrationOperations.items.set(
	afterCoreCheckpointOperation.id,
	clone(afterCoreCheckpointOperation),
);
afterCoreCheckpointFixture.overrides.items.set(
	afterCoreCheckpointFixture.ref,
	clone(afterCoreCheckpointJournal.sourceOverride),
);
const afterCoreCheckpointFreshPreview = await handler(
	"core-seo-migration-plan",
)(
	route({
		refs: [afterCoreCheckpointFixture.ref],
		conflictPolicy: "skip",
		limit: 100,
	}),
	afterCoreCheckpointFixture.context,
);
const afterCoreCheckpointRetry = await handler("core-seo-migration-apply")(
	route({
		plans: [
			{
				sourceOverrideId:
					afterCoreCheckpointFreshPreview.items[0].sourceOverrideId,
				fingerprint: afterCoreCheckpointFreshPreview.items[0].fingerprint,
			},
		],
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	afterCoreCheckpointFixture.context,
);
check(
	"a prepared core-write checkpoint resumes the exact owner handoff",
	afterCoreCheckpointInitial.success === true &&
		afterCoreCheckpointFreshPreview.items[0]?.state === "ready" &&
		afterCoreCheckpointRetry.success === true &&
		afterCoreCheckpointRetry.results[0]?.migrationId ===
			afterCoreCheckpointJournal.id &&
		!afterCoreCheckpointFixture.overrides.items.has(
			afterCoreCheckpointFixture.ref,
		) &&
		afterCoreCheckpointFixture.migrations.items.get(
			afterCoreCheckpointJournal.id,
		)?.status === "applied" &&
		afterCoreCheckpointFixture.migrationOperations.items.get(
			afterCoreCheckpointOperation.id,
		)?.status === "applied",
);

const afterDeleteCheckpointFixture = createContext();
const afterDeleteCheckpointSelections = await migrationSelections(
	afterDeleteCheckpointFixture.context,
	[afterDeleteCheckpointFixture.ref],
);
await handler("core-seo-migration-apply")(
	route({
		plans: afterDeleteCheckpointSelections,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	afterDeleteCheckpointFixture.context,
);
const afterDeleteCheckpointJournal = clone(
	[...afterDeleteCheckpointFixture.migrations.items.values()][0],
);
const afterDeleteCheckpointOperation = clone(
	[...afterDeleteCheckpointFixture.migrationOperations.items.values()][0],
);
afterDeleteCheckpointJournal.status = "prepared";
delete afterDeleteCheckpointJournal.error;
afterDeleteCheckpointOperation.status = "prepared";
afterDeleteCheckpointOperation.record = clone(afterDeleteCheckpointJournal);
afterDeleteCheckpointFixture.migrations.items.set(
	afterDeleteCheckpointJournal.id,
	clone(afterDeleteCheckpointJournal),
);
afterDeleteCheckpointFixture.migrationOperations.items.set(
	afterDeleteCheckpointOperation.id,
	clone(afterDeleteCheckpointOperation),
);
const afterDeleteCheckpointFreshPreview = await handler(
	"core-seo-migration-plan",
)(
	route({ conflictPolicy: "skip", limit: 100 }),
	afterDeleteCheckpointFixture.context,
);
const afterDeleteCheckpointRetry = await handler("core-seo-migration-apply")(
	route({
		plans: [
			{
				sourceOverrideId:
					afterDeleteCheckpointFreshPreview.items[0].sourceOverrideId,
				fingerprint: afterDeleteCheckpointFreshPreview.items[0].fingerprint,
			},
		],
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	afterDeleteCheckpointFixture.context,
);
check(
	"a prepared post-delete checkpoint finalizes without repeating either owner write",
	afterDeleteCheckpointFreshPreview.items[0]?.state === "ready" &&
		afterDeleteCheckpointFreshPreview.items[0]?.sourceOverrideId ===
			afterDeleteCheckpointFixture.ref &&
		afterDeleteCheckpointRetry.success === true &&
		afterDeleteCheckpointRetry.results[0]?.migrationId ===
			afterDeleteCheckpointJournal.id &&
		afterDeleteCheckpointFixture.updateCount === 1 &&
		!afterDeleteCheckpointFixture.overrides.items.has(
			afterDeleteCheckpointFixture.ref,
		) &&
		afterDeleteCheckpointFixture.migrationOperations.items.get(
			afterDeleteCheckpointOperation.id,
		)?.status === "applied",
);

const recoveryIdentityWindowFixture = createContext();
await applyMigration(recoveryIdentityWindowFixture.context, [
	recoveryIdentityWindowFixture.ref,
]);
const recoveryIdentityWindowRecord = clone(
	[...recoveryIdentityWindowFixture.migrations.items.values()][0],
);
const recoveryIdentityWindowOperation = clone(
	[...recoveryIdentityWindowFixture.migrationOperations.items.values()][0],
);
recoveryIdentityWindowRecord.status = "prepared";
recoveryIdentityWindowOperation.status = "prepared";
recoveryIdentityWindowOperation.record = clone(recoveryIdentityWindowRecord);
recoveryIdentityWindowFixture.migrations.items.set(
	recoveryIdentityWindowRecord.id,
	clone(recoveryIdentityWindowRecord),
);
recoveryIdentityWindowFixture.migrationOperations.items.set(
	recoveryIdentityWindowOperation.id,
	clone(recoveryIdentityWindowOperation),
);
recoveryIdentityWindowFixture.overrides.items.set(
	recoveryIdentityWindowFixture.ref,
	clone(recoveryIdentityWindowRecord.sourceOverride),
);
const recoveryIdentityWindowDelete =
	recoveryIdentityWindowFixture.overrides.delete.bind(
		recoveryIdentityWindowFixture.overrides,
	);
let injectedRecoveryIdentityChange = false;
recoveryIdentityWindowFixture.overrides.delete = async (id: string) => {
	const deleted = await recoveryIdentityWindowDelete(id);
	if (!injectedRecoveryIdentityChange && id === recoveryIdentityWindowFixture.ref) {
		injectedRecoveryIdentityChange = true;
		const item = recoveryIdentityWindowFixture.contentItems.get("article-id");
		item.id = "renamed-during-prepared-recovery";
		item.revision.contentVersion += 1;
	}
	return deleted;
};
const recoveryIdentityWindowPlans = await migrationSelections(
	recoveryIdentityWindowFixture.context,
	[recoveryIdentityWindowFixture.ref],
);
const recoveryIdentityWindowResult = await handler(
	"core-seo-migration-apply",
)(
	route({
		plans: recoveryIdentityWindowPlans,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	recoveryIdentityWindowFixture.context,
);
check(
	"prepared recovery rejects an identity change after its source delete",
	recoveryIdentityWindowResult.success === false &&
		recoveryIdentityWindowResult.results[0]?.status === "partial-conflict",
);
check(
	"prepared recovery preserves the unreachable migrated owner after an identity race",
	recoveryIdentityWindowFixture.contentItems.get("article-id").id ===
			"renamed-during-prepared-recovery" &&
		recoveryIdentityWindowFixture.contentItems.get("article-id").seo.title ===
			"Legacy SEO title for the article page" &&
		!recoveryIdentityWindowFixture.overrides.items.has(
			recoveryIdentityWindowFixture.ref,
		) &&
		recoveryIdentityWindowFixture.migrations.items.get(
			recoveryIdentityWindowRecord.id,
		)?.status === "failed" &&
		recoveryIdentityWindowFixture.migrationOperations.items.get(
			recoveryIdentityWindowOperation.id,
		)?.status === "failed",
);

const recoverySiblingWindowFixture = createContext();
await applyMigration(recoverySiblingWindowFixture.context, [
	recoverySiblingWindowFixture.ref,
]);
const recoverySiblingWindowRecord = clone(
	[...recoverySiblingWindowFixture.migrations.items.values()][0],
);
const recoverySiblingWindowOperation = clone(
	[...recoverySiblingWindowFixture.migrationOperations.items.values()][0],
);
recoverySiblingWindowRecord.status = "prepared";
recoverySiblingWindowOperation.status = "prepared";
recoverySiblingWindowOperation.record = clone(recoverySiblingWindowRecord);
recoverySiblingWindowFixture.migrations.items.set(
	recoverySiblingWindowRecord.id,
	clone(recoverySiblingWindowRecord),
);
recoverySiblingWindowFixture.migrationOperations.items.set(
	recoverySiblingWindowOperation.id,
	clone(recoverySiblingWindowOperation),
);
recoverySiblingWindowFixture.overrides.items.set(
	recoverySiblingWindowFixture.ref,
	clone(recoverySiblingWindowRecord.sourceOverride),
);
const recoverySiblingWindowDelete =
	recoverySiblingWindowFixture.overrides.delete.bind(
		recoverySiblingWindowFixture.overrides,
	);
let injectedRecoverySibling = false;
recoverySiblingWindowFixture.overrides.delete = async (id: string) => {
	const deleted = await recoverySiblingWindowDelete(id);
	if (!injectedRecoverySibling && id === recoverySiblingWindowFixture.ref) {
		injectedRecoverySibling = true;
		recoverySiblingWindowFixture.overrides.items.set("posts:article-slug", {
			ref: "posts:article-slug",
			title: "Human sibling created during prepared recovery",
			updatedAt: "2026-07-14T12:09:00.000Z",
		});
	}
	return deleted;
};
const recoverySiblingWindowPlans = await migrationSelections(
	recoverySiblingWindowFixture.context,
	[recoverySiblingWindowFixture.ref],
);
const recoverySiblingWindowResult = await handler(
	"core-seo-migration-apply",
)(
	route({
		plans: recoverySiblingWindowPlans,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	recoverySiblingWindowFixture.context,
);
check(
	"prepared recovery rejects a sibling created after its source delete",
	recoverySiblingWindowResult.success === false &&
		recoverySiblingWindowResult.results[0]?.status === "partial-conflict",
);
check(
	"prepared recovery preserves the new sibling without recreating a duplicate owner",
	recoverySiblingWindowFixture.contentItems.get("article-id").seo.title ===
			null &&
		!recoverySiblingWindowFixture.overrides.items.has(
			recoverySiblingWindowFixture.ref,
		) &&
		recoverySiblingWindowFixture.overrides.items.get("posts:article-slug")
			?.title === "Human sibling created during prepared recovery",
);

const beforeMutationCheckpointFixture = createContext();
const beforeMutationCheckpointSelections = await migrationSelections(
	beforeMutationCheckpointFixture.context,
	[beforeMutationCheckpointFixture.ref],
);
await handler("core-seo-migration-apply")(
	route({
		plans: beforeMutationCheckpointSelections,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	beforeMutationCheckpointFixture.context,
);
const beforeMutationCheckpointJournal = clone(
	[...beforeMutationCheckpointFixture.migrations.items.values()][0],
);
const beforeMutationCheckpointOperation = clone(
	[...beforeMutationCheckpointFixture.migrationOperations.items.values()][0],
);
beforeMutationCheckpointJournal.status = "prepared";
delete beforeMutationCheckpointJournal.error;
beforeMutationCheckpointOperation.status = "prepared";
beforeMutationCheckpointOperation.record = clone(beforeMutationCheckpointJournal);
beforeMutationCheckpointFixture.contentItems.get("article-id").seo = clone(
	beforeMutationCheckpointJournal.before,
);
beforeMutationCheckpointFixture.contentItems.get("article-id").revision.seoVersion += 1;
beforeMutationCheckpointFixture.overrides.items.set(
	beforeMutationCheckpointFixture.ref,
	clone(beforeMutationCheckpointJournal.sourceOverride),
);
beforeMutationCheckpointFixture.migrations.items.clear();
beforeMutationCheckpointFixture.migrationOperations.items.set(
	beforeMutationCheckpointOperation.id,
	clone(beforeMutationCheckpointOperation),
);
const beforeMutationCheckpointRetry = await handler("core-seo-migration-apply")(
	route({
		plans: beforeMutationCheckpointSelections,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	beforeMutationCheckpointFixture.context,
);
check(
	"a prepared pre-write checkpoint is closed before a fresh migration starts",
	beforeMutationCheckpointRetry.success === true &&
		beforeMutationCheckpointFixture.migrations.items.size === 2 &&
		[...beforeMutationCheckpointFixture.migrations.items.values()].filter(
			(record) => record.status === "failed",
		).length === 1 &&
		[...beforeMutationCheckpointFixture.migrations.items.values()].filter(
			(record) => record.status === "applied",
		).length === 1 &&
		[...beforeMutationCheckpointFixture.migrationOperations.items.values()][0]
			?.status === "applied",
);

const appliedStatus = await handler("core-seo-migration-status")(
	route({ batchId: applied.batchId, limit: 100 }),
	fixture.context,
);
check(
	"native migration status exposes the applied journal",
	appliedStatus.success === true && appliedStatus.items[0]?.status === "applied" && appliedStatus.items[0]?.batchId === applied.batchId,
);
check(
	"migration status carries the versioned native-admin envelope",
	appliedStatus.contractVersion === SEO_ADMIN_CONTRACT_VERSION && appliedStatus.migrationVersion === 1 &&
		appliedStatus.writeAvailable === true,
);

const latestHistoryFixture = createContext();
for (let index = 0; index < 105; index += 1) {
	const id = `history-${String(index).padStart(3, "0")}`;
	const ref = `posts:${id}`;
	const createdAt = new Date(Date.UTC(2026, 6, 14, 10, 0, index)).toISOString();
	latestHistoryFixture.migrations.items.set(id, {
		...clone(appliedRecord),
		id,
		batchId: index >= 100 ? "history-batch-newest" : `history-batch-${index}`,
		ref,
		entryId: id,
		sourceOverrideId: ref,
		sourceOverride: { ...clone(appliedRecord.sourceOverride), ref },
		createdAt,
		updatedAt: createdAt,
	});
}

// Mirrors the EmDash 0.40 seek: the default order (ids stand in for created_at)
// seeks from the value carried in the cursor, while an orderBy seek re-reads the
// cursor row's current value, whatever the where clause now says about it.
function keysetQuery(collection: MemoryCollection) {
	return async (options: any = {}) => {
		const all = [...collection.items.entries()].map(([id, data]) => ({ id, data: clone(data) }));
		let entries = options.where
			? all.filter((entry) => Object.entries(options.where).every(([key, value]) => entry.data?.[key] === value))
			: all;
		const [field, direction] = (Object.entries(options.orderBy ?? {})[0] ?? ["", "asc"]) as [string, "asc" | "desc"];
		const compare = (left: { id: string; data: any }, right: { id: string; data: any }) =>
			(field ? String(left.data?.[field] ?? "").localeCompare(String(right.data?.[field] ?? "")) : 0) ||
			left.id.localeCompare(right.id);
		entries.sort(compare);
		if (direction === "desc") entries.reverse();
		if (options.cursor) {
			const anchor = field ? all.find((entry) => entry.id === options.cursor) : { id: options.cursor, data: {} };
			if (!anchor) throw new Error("Invalid storage cursor");
			entries = entries.filter((entry) => (direction === "desc" ? compare(entry, anchor) < 0 : compare(entry, anchor) > 0));
		}
		const limit = Math.min(options.limit ?? 50, 100);
		const items = entries.slice(0, limit);
		const hasMore = entries.length > limit;
		return { items, cursor: hasMore ? items[items.length - 1]?.id : undefined, hasMore };
	};
}

latestHistoryFixture.migrations.query = keysetQuery(latestHistoryFixture.migrations);
const latestHistory = await handler("core-seo-migration-status")(
	route({ limit: 100, latest: true }),
	latestHistoryFixture.context,
);
check(
	"latest migration history starts with the newest batch",
	latestHistory.items.length === 100 &&
		latestHistory.items[0]?.batchId === "history-batch-newest" &&
		latestHistory.hasMore === true &&
		typeof latestHistory.cursor === "string",
);
const olderHistory = await handler("core-seo-migration-status")(
	route({ limit: 100, latest: true, cursor: latestHistory.cursor }),
	latestHistoryFixture.context,
);
const historyIds = [...latestHistory.items, ...olderHistory.items].map((record: any) => record.id);
check(
	"older migration history beyond the newest 100 records is reachable",
	olderHistory.items.length === 5 &&
		olderHistory.hasMore === false &&
		new Set(historyIds).size === 105 &&
		olderHistory.items.every((record: any) =>
			record.createdAt <= latestHistory.items[latestHistory.items.length - 1].createdAt),
);

const pagedPlanFixture = createContext();
for (let index = 0; index < 149; index += 1) {
	const ref = `posts:paged-${String(index).padStart(3, "0")}`;
	pagedPlanFixture.overrides.items.set(ref, {
		ref,
		title: `Legacy title ${index}`,
		updatedAt: "2026-07-14T12:00:00.000Z",
	});
}
pagedPlanFixture.overrides.query = keysetQuery(pagedPlanFixture.overrides);
pagedPlanFixture.migrationOperations.query = keysetQuery(pagedPlanFixture.migrationOperations);
const firstPlanPage = await handler("core-seo-migration-plan")(
	route({ conflictPolicy: "skip", limit: 100 }),
	pagedPlanFixture.context,
);
const secondPlanPage = await handler("core-seo-migration-plan")(
	route({ conflictPolicy: "skip", limit: 100, cursor: firstPlanPage.cursor }),
	pagedPlanFixture.context,
);
const pagedPlanSources = [...firstPlanPage.items, ...secondPlanPage.items]
	.map((item: any) => item.sourceOverrideId);
check(
	"the migration plan pages beyond the first 100 legacy records",
	firstPlanPage.items.length === 100 &&
		firstPlanPage.hasMore === true &&
		typeof firstPlanPage.cursor === "string" &&
		secondPlanPage.items.length === 50 &&
		secondPlanPage.hasMore === false &&
		pagedPlanSources.length === 150 &&
		new Set(pagedPlanSources).size === 150,
);
check(
	"an invalid migration plan cursor is rejected",
	await handler("core-seo-migration-plan")(
		route({ conflictPolicy: "skip", limit: 100, cursor: "unknown-cursor" }),
		pagedPlanFixture.context,
	).then(() => false, () => true),
);

const skippedHandoffFixture = createContext();
skippedHandoffFixture.overrides.query = keysetQuery(skippedHandoffFixture.overrides);
skippedHandoffFixture.migrationOperations.query = keysetQuery(skippedHandoffFixture.migrationOperations);
for (let index = 0; index < 120; index += 1) {
	const sourceOverrideId = `posts:live-${String(index).padStart(3, "0")}`;
	skippedHandoffFixture.overrides.items.set(sourceOverrideId, {
		ref: sourceOverrideId,
		title: `Legacy title ${index}`,
		updatedAt: "2026-07-14T12:00:00.000Z",
	});
	const id = `core-seo-operation:live-${String(index).padStart(3, "0")}`;
	skippedHandoffFixture.migrationOperations.items.set(id, {
		id,
		storageVersion: 1,
		sourceOverrideId,
		selectionFingerprint: `sha256-${"0".repeat(64)}`,
		status: "prepared",
		record: { id: `migration-live-${index}`, sourceOverrideId, collection: "posts", entryId: `live-${index}`, ref: sourceOverrideId },
		updatedAt: "2026-07-14T12:00:00.000Z",
	});
}
const skippedHandoffPage = await handler("core-seo-migration-plan")(
	route({ conflictPolicy: "skip", limit: 100 }),
	skippedHandoffFixture.context,
);
check(
	"a page of handoffs listed with their owners does not come back empty",
	skippedHandoffPage.items.length === 100 && skippedHandoffPage.hasMore === true,
);

const crowdedHandoffFixture = createContext();
crowdedHandoffFixture.overrides.query = keysetQuery(crowdedHandoffFixture.overrides);
crowdedHandoffFixture.migrationOperations.query = keysetQuery(crowdedHandoffFixture.migrationOperations);
for (let index = 0; index < 520; index += 1) {
	const sourceOverrideId = `posts:crowded-${String(index).padStart(3, "0")}`;
	crowdedHandoffFixture.overrides.items.set(sourceOverrideId, {
		ref: sourceOverrideId,
		title: `Legacy title ${index}`,
		updatedAt: "2026-07-14T12:00:00.000Z",
	});
	const id = `core-seo-operation:crowded-${String(index).padStart(3, "0")}`;
	crowdedHandoffFixture.migrationOperations.items.set(id, {
		id,
		storageVersion: 1,
		sourceOverrideId,
		selectionFingerprint: `sha256-${"0".repeat(64)}`,
		status: "prepared",
		record: { id: `migration-crowded-${index}`, sourceOverrideId, collection: "posts", entryId: `crowded-${index}`, ref: sourceOverrideId },
		updatedAt: "2026-07-14T12:00:00.000Z",
	});
}
const crowdedPlanPage = await handler("core-seo-migration-plan")(
	route({ conflictPolicy: "skip", limit: 100 }),
	crowdedHandoffFixture.context,
);
const crowdedBlocks = await handler("admin")(route({ page: "overrides" }), crowdedHandoffFixture.context);
check(
	"a first page emptied by the scan budget is not reported as no legacy records",
	crowdedPlanPage.items.length === 0 &&
		crowdedPlanPage.hasMore === true &&
		!crowdedBlocks.blocks.some((block: any) => block.title === "Core SEO is the active metadata owner"),
);

const orphanFixture = createContext();
const orphanApply = await applyMigration(orphanFixture.context, [orphanFixture.ref]);
const orphanTemplate = clone([...orphanFixture.migrationOperations.items.values()][0]);
orphanFixture.overrides.query = keysetQuery(orphanFixture.overrides);
orphanFixture.migrationOperations.query = keysetQuery(orphanFixture.migrationOperations);
for (let index = 0; index < 130; index += 1) {
	const sourceOverrideId = `posts:orphan-${String(index).padStart(3, "0")}`;
	const id = `core-seo-operation:orphan-${String(index).padStart(3, "0")}`;
	orphanFixture.migrationOperations.items.set(id, {
		...clone(orphanTemplate),
		id,
		sourceOverrideId,
		status: "prepared",
		record: { ...clone(orphanTemplate.record), sourceOverrideId },
		updatedAt: "2026-07-14T12:00:00.000Z",
	});
}
const orphanFirstPage = await handler("core-seo-migration-plan")(
	route({ conflictPolicy: "skip", limit: 100 }),
	orphanFixture.context,
);
const orphanCursorRow = orphanFirstPage.items[orphanFirstPage.items.length - 1]?.sourceOverrideId;
const finalizedId = `core-seo-operation:${String(orphanCursorRow).slice("posts:".length)}`;
orphanFixture.migrationOperations.items.set(finalizedId, {
	...clone(orphanFixture.migrationOperations.items.get(finalizedId)),
	status: "applied",
	updatedAt: "2026-09-25T12:00:00.000Z",
});
const orphanSecondPage = await handler("core-seo-migration-plan")(
	route({ conflictPolicy: "skip", limit: 100, cursor: orphanFirstPage.cursor }),
	orphanFixture.context,
);
const orphanSources = new Set(
	[...orphanFirstPage.items, ...orphanSecondPage.items].map((item: any) => item.sourceOverrideId),
);
check(
	"finalizing the handoff at a page boundary does not skip the remaining prepared handoffs",
	orphanApply.success === true &&
		orphanFirstPage.items.length === 100 &&
		Array.from({ length: 130 }, (_, index) => `posts:orphan-${String(index).padStart(3, "0")}`)
			.every((id) => orphanSources.has(id)),
);

const missingRollbackContentCasFixture = createContext();
const missingRollbackContentCasApply = await applyMigration(
	missingRollbackContentCasFixture.context,
	[missingRollbackContentCasFixture.ref],
);
missingRollbackContentCasFixture.context.content.updateIfUnchanged = undefined;
const missingRollbackContentCasHistory = await handler("core-seo-migration-status")(
	route({ batchId: missingRollbackContentCasApply.batchId, limit: 100, latest: false }),
	missingRollbackContentCasFixture.context,
);
check(
	"migration history remains readable when conditional content writes are unavailable",
	missingRollbackContentCasHistory.success === true &&
		missingRollbackContentCasHistory.items[0]?.status === "applied" &&
		missingRollbackContentCasHistory.writeAvailable === false,
);
const missingRollbackContentCas = await handler("core-seo-migration-rollback")(
	route({
		batchId: missingRollbackContentCasApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	missingRollbackContentCasFixture.context,
);
check(
	"migration rollback fails closed without conditional content writes",
	missingRollbackContentCas.success === false &&
		missingRollbackContentCas.error === "content_write_unavailable" &&
		missingRollbackContentCasFixture.updateCount === 1 &&
		![...missingRollbackContentCasFixture.overrides.items.keys()].includes(
			missingRollbackContentCasFixture.ref,
		) &&
		[...missingRollbackContentCasFixture.migrations.items.values()][0]?.status ===
			"applied",
);

const missingRollbackOverrideCasFixture = createContext();
const missingRollbackOverrideCasApply = await applyMigration(
	missingRollbackOverrideCasFixture.context,
	[missingRollbackOverrideCasFixture.ref],
);
missingRollbackOverrideCasFixture.overrides.compareAndSet = undefined as any;
const missingRollbackOverrideCas = await handler("core-seo-migration-rollback")(
	route({
		batchId: missingRollbackOverrideCasApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	missingRollbackOverrideCasFixture.context,
);
check(
	"migration rollback fails closed without conditional override writes",
	missingRollbackOverrideCas.success === false &&
		missingRollbackOverrideCas.error === "content_write_unavailable" &&
		missingRollbackOverrideCasFixture.updateCount === 1 &&
		![...missingRollbackOverrideCasFixture.overrides.items.keys()].includes(
			missingRollbackOverrideCasFixture.ref,
		) &&
		[...missingRollbackOverrideCasFixture.migrations.items.values()][0]?.status ===
			"applied",
);

const rolledBack = await handler("core-seo-migration-rollback")(
	route({ batchId: applied.batchId, confirm: "ROLLBACK_CORE_SEO" }),
	fixture.context,
);
check("rollback restores the original core SEO snapshot", rolledBack.success === true && fixture.contentItems.get("article-id").seo.title === null);
check("rollback restores the exact legacy override", fixture.overrides.items.get(fixture.ref)?.updatedAt === "2026-07-14T12:00:00.000Z");
check("rollback journal state is durable", [...fixture.migrations.items.values()][0]?.status === "rolled-back");

const rollbackOwnerCheckpointFixture = createContext();
const rollbackOwnerCheckpointApply = await applyMigration(
	rollbackOwnerCheckpointFixture.context,
	[rollbackOwnerCheckpointFixture.ref],
);
const rollbackOwnerCheckpointRecord = clone(
	[...rollbackOwnerCheckpointFixture.migrations.items.values()][0],
);
const rollbackOwnerCheckpointOperation = clone(
	[...rollbackOwnerCheckpointFixture.migrationOperations.items.values()][0],
);
rollbackOwnerCheckpointFixture.overrides.items.set(
	rollbackOwnerCheckpointFixture.ref,
	clone(rollbackOwnerCheckpointRecord.sourceOverride),
);
rollbackOwnerCheckpointOperation.status = "rolling-back";
rollbackOwnerCheckpointOperation.record = clone(rollbackOwnerCheckpointRecord);
rollbackOwnerCheckpointFixture.migrationOperations.items.set(
	rollbackOwnerCheckpointOperation.id,
	clone(rollbackOwnerCheckpointOperation),
);
const rollbackOwnerCheckpointResult = await handler(
	"core-seo-migration-rollback",
)(
	route({
		batchId: rollbackOwnerCheckpointApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackOwnerCheckpointFixture.context,
);
check(
	"a restored-owner rollback checkpoint resumes the exact core restore",
	rollbackOwnerCheckpointResult.success === true &&
		rollbackOwnerCheckpointFixture.contentItems.get("article-id").seo.title ===
			null &&
		rollbackOwnerCheckpointFixture.overrides.items.has(
			rollbackOwnerCheckpointFixture.ref,
		) &&
		rollbackOwnerCheckpointFixture.migrations.items.get(
			rollbackOwnerCheckpointRecord.id,
		)?.status === "rolled-back" &&
		rollbackOwnerCheckpointFixture.migrationOperations.items.get(
			rollbackOwnerCheckpointOperation.id,
		)?.status === "rolled-back",
);

const rollbackCheckpointOwnerWindowFixture = createContext();
const rollbackCheckpointOwnerWindowApply = await applyMigration(
	rollbackCheckpointOwnerWindowFixture.context,
	[rollbackCheckpointOwnerWindowFixture.ref],
);
await handler("core-seo-migration-rollback")(
	route({
		batchId: rollbackCheckpointOwnerWindowApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackCheckpointOwnerWindowFixture.context,
);
const rollbackCheckpointOwnerWindowRecord = clone(
	[...rollbackCheckpointOwnerWindowFixture.migrations.items.values()][0],
);
const rollbackCheckpointOwnerWindowOperation = clone(
	[...rollbackCheckpointOwnerWindowFixture.migrationOperations.items.values()][0],
);
rollbackCheckpointOwnerWindowRecord.status = "applied";
rollbackCheckpointOwnerWindowOperation.status = "rolling-back";
rollbackCheckpointOwnerWindowOperation.record = clone(
	rollbackCheckpointOwnerWindowRecord,
);
rollbackCheckpointOwnerWindowFixture.migrations.items.set(
	rollbackCheckpointOwnerWindowRecord.id,
	clone(rollbackCheckpointOwnerWindowRecord),
);
rollbackCheckpointOwnerWindowFixture.migrationOperations.items.set(
	rollbackCheckpointOwnerWindowOperation.id,
	clone(rollbackCheckpointOwnerWindowOperation),
);
rollbackCheckpointOwnerWindowFixture.overrides.items.delete(
	rollbackCheckpointOwnerWindowFixture.ref,
);
const rollbackCheckpointOwnerWindowPut =
	rollbackCheckpointOwnerWindowFixture.overrides.put.bind(
		rollbackCheckpointOwnerWindowFixture.overrides,
	);
let injectedRollbackCheckpointOwnerChange = false;
rollbackCheckpointOwnerWindowFixture.overrides.put = async (
	id: string,
	value: unknown,
) => {
	await rollbackCheckpointOwnerWindowPut(id, value);
	if (
		!injectedRollbackCheckpointOwnerChange &&
		id === rollbackCheckpointOwnerWindowFixture.ref
	) {
		injectedRollbackCheckpointOwnerChange = true;
		const item =
			rollbackCheckpointOwnerWindowFixture.contentItems.get("article-id");
		item.slug = "renamed-during-rollback-checkpoint";
		item.revision.contentVersion += 1;
		rollbackCheckpointOwnerWindowFixture.overrides.items.set(
			"posts:renamed-during-rollback-checkpoint",
			{
				ref: "posts:renamed-during-rollback-checkpoint",
				title: "Human sibling created during rollback checkpoint",
				updatedAt: "2026-07-14T12:10:00.000Z",
			},
		);
	}
};
const rollbackCheckpointOwnerWindowResult = await handler(
	"core-seo-migration-rollback",
)(
	route({
		batchId: rollbackCheckpointOwnerWindowApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackCheckpointOwnerWindowFixture.context,
);
check(
	"rollback checkpoint rejects owner changes after restoring a missing source",
	rollbackCheckpointOwnerWindowResult.success === false &&
		rollbackCheckpointOwnerWindowResult.results[0]?.status ===
			"partial-conflict",
);
check(
	"rollback checkpoint deletes only its exact restored source after an owner race",
	rollbackCheckpointOwnerWindowFixture.contentItems.get("article-id").slug ===
			"renamed-during-rollback-checkpoint" &&
		rollbackCheckpointOwnerWindowFixture.contentItems.get("article-id").seo
			.title === null &&
		!rollbackCheckpointOwnerWindowFixture.overrides.items.has(
			rollbackCheckpointOwnerWindowFixture.ref,
		) &&
		rollbackCheckpointOwnerWindowFixture.overrides.items.get(
			"posts:renamed-during-rollback-checkpoint",
		)?.title === "Human sibling created during rollback checkpoint" &&
		rollbackCheckpointOwnerWindowFixture.migrations.items.get(
			rollbackCheckpointOwnerWindowRecord.id,
		)?.status !== "rolled-back" &&
		rollbackCheckpointOwnerWindowFixture.migrationOperations.items.get(
			rollbackCheckpointOwnerWindowOperation.id,
		)?.status !== "rolled-back",
);

const rollbackFinalCheckpointFixture = createContext();
const rollbackFinalCheckpointApply = await applyMigration(
	rollbackFinalCheckpointFixture.context,
	[rollbackFinalCheckpointFixture.ref],
);
await handler("core-seo-migration-rollback")(
	route({
		batchId: rollbackFinalCheckpointApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackFinalCheckpointFixture.context,
);
const rollbackFinalCheckpointRecord = clone(
	[...rollbackFinalCheckpointFixture.migrations.items.values()][0],
);
const rollbackFinalCheckpointOperation = clone(
	[...rollbackFinalCheckpointFixture.migrationOperations.items.values()][0],
);
rollbackFinalCheckpointRecord.status = "applied";
rollbackFinalCheckpointOperation.status = "rolling-back";
rollbackFinalCheckpointOperation.record = clone(rollbackFinalCheckpointRecord);
rollbackFinalCheckpointFixture.migrations.items.set(
	rollbackFinalCheckpointRecord.id,
	clone(rollbackFinalCheckpointRecord),
);
rollbackFinalCheckpointFixture.migrationOperations.items.set(
	rollbackFinalCheckpointOperation.id,
	clone(rollbackFinalCheckpointOperation),
);
const rollbackFinalCheckpointWrites = rollbackFinalCheckpointFixture.updateCount;
const rollbackFinalCheckpointRetry = await handler(
	"core-seo-migration-rollback",
)(
	route({
		batchId: rollbackFinalCheckpointApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackFinalCheckpointFixture.context,
);
check(
	"a fully restored rollback checkpoint finalizes without repeating owner writes",
	rollbackFinalCheckpointRetry.success === true &&
		rollbackFinalCheckpointFixture.updateCount ===
			rollbackFinalCheckpointWrites &&
		rollbackFinalCheckpointFixture.migrations.items.get(
			rollbackFinalCheckpointRecord.id,
		)?.status === "rolled-back" &&
		rollbackFinalCheckpointFixture.migrationOperations.items.get(
			rollbackFinalCheckpointOperation.id,
		)?.status === "rolled-back",
);

const rollbackAbaFixture = createContext();
const rollbackAbaApplyA = await applyMigration(
	rollbackAbaFixture.context,
	[rollbackAbaFixture.ref],
);
const rollbackAbaRecordA = clone(
	[...rollbackAbaFixture.migrations.items.values()][0],
);
await handler("core-seo-migration-rollback")(
	route({
		batchId: rollbackAbaApplyA.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackAbaFixture.context,
);
const rollbackAbaApplyB = await applyMigration(
	rollbackAbaFixture.context,
	[rollbackAbaFixture.ref],
);
const rollbackAbaOperationB = clone(
	[...rollbackAbaFixture.migrationOperations.items.values()][0],
);
rollbackAbaRecordA.status = "applied";
rollbackAbaFixture.migrations.items.set(
	rollbackAbaRecordA.id,
	clone(rollbackAbaRecordA),
);
const rollbackAbaWritesBeforeOldRollback = rollbackAbaFixture.updateCount;
const rollbackAbaOldRollback = await handler("core-seo-migration-rollback")(
	route({
		batchId: rollbackAbaApplyA.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackAbaFixture.context,
);
const rollbackAbaOperationAfter = [
	...rollbackAbaFixture.migrationOperations.items.values(),
][0];
check(
	"an old migration cannot roll back a newer finalized migration with equal SEO",
	rollbackAbaApplyB.success === true &&
		rollbackAbaOldRollback.results[0]?.status === "changed-since-migration" &&
		rollbackAbaFixture.updateCount === rollbackAbaWritesBeforeOldRollback &&
		!rollbackAbaFixture.overrides.items.has(rollbackAbaFixture.ref) &&
		rollbackAbaFixture.contentItems.get("article-id").seo.title ===
			"Legacy SEO title for the article page" &&
		rollbackAbaOperationAfter?.record?.id === rollbackAbaOperationB.record.id &&
		rollbackAbaOperationAfter?.status === "applied",
);
const rolledBackStatus = await handler("core-seo-migration-status")(
	route({ status: "rolled-back", limit: 100 }),
	fixture.context,
);
check("native migration status filters rolled-back records", rolledBackStatus.items.length === 1 && rolledBackStatus.items[0]?.status === "rolled-back");

const repeatedCursorFixture = createContext();
let repeatedCursorQueries = 0;
let repeatedCursorUsedCustomOrder = false;
repeatedCursorFixture.migrations.query = async (options: any) => {
	repeatedCursorQueries += 1;
	repeatedCursorUsedCustomOrder ||= Boolean(options.orderBy);
	const secondPage = repeatedCursorQueries === 2;
	const id = secondPage ? "repeat-a" : "repeat-b";
	return {
		items: [
			{
				id,
				data: {
					id,
					batchId: "repeated-cursor-batch",
					ref: `${id}-ref`,
					status: "rolled-back",
					createdAt: secondPage
						? "2026-07-14T12:00:00.000Z"
						: "2026-07-14T12:01:00.000Z",
				},
			},
		],
		cursor: "repeated-cursor",
		hasMore: true,
	};
};
const repeatedCursorRollback = await handler("core-seo-migration-rollback")(
	route({ batchId: "repeated-cursor-batch", confirm: "ROLLBACK_CORE_SEO" }),
	repeatedCursorFixture.context,
);
check(
	"rollback rejects a batch when storage repeats its cursor",
	repeatedCursorQueries === 2 &&
		repeatedCursorRollback.success === false &&
		repeatedCursorRollback.error === "incomplete_batch" &&
		repeatedCursorRollback.results.length === 0,
);
check(
	"incomplete rollback scans perform no content writes",
	!repeatedCursorUsedCustomOrder && repeatedCursorFixture.updateCount === 0,
);

const cappedBatchFixture = createContext();
let cappedBatchQueries = 0;
let cappedBatchUsedCustomOrder = false;
cappedBatchFixture.migrations.query = async (options: any) => {
	cappedBatchQueries += 1;
	cappedBatchUsedCustomOrder ||= Boolean(options.orderBy);
	const start = (5 - cappedBatchQueries) * 100;
	const items = Array.from({ length: options.limit }, (_, offset) => {
		const sequence = start + offset;
		const id = `capped-${String(sequence).padStart(3, "0")}`;
		return {
			id,
			data: {
				id,
				batchId: "capped-batch",
				ref: `${id}-ref`,
				status: "rolled-back",
				createdAt: "2026-07-14T12:00:00.000Z",
			},
		};
	});
	return {
		items,
		cursor: `capped-page-${cappedBatchQueries}`,
		hasMore: true,
	};
};
const cappedBatchRollback = await handler("core-seo-migration-rollback")(
	route({ batchId: "capped-batch", confirm: "ROLLBACK_CORE_SEO" }),
	cappedBatchFixture.context,
);
check(
	"rollback rejects a batch larger than its scan cap",
	cappedBatchQueries === 5 &&
		cappedBatchRollback.success === false &&
		cappedBatchRollback.error === "incomplete_batch" &&
		cappedBatchRollback.results.length === 0,
);
check(
	"over-cap rollback scans perform no content writes",
	!cappedBatchUsedCustomOrder && cappedBatchFixture.updateCount === 0,
);

const changedFixture = createContext();
const changedApply = await applyMigration(changedFixture.context, [
	changedFixture.ref,
]);
changedFixture.contentItems.get("article-id").seo.title = "Human edit after migration";
const protectedRollback = await handler("core-seo-migration-rollback")(
	route({ batchId: changedApply.batchId, confirm: "ROLLBACK_CORE_SEO" }),
	changedFixture.context,
);
check("rollback protects a newer human SEO edit", protectedRollback.results[0]?.status === "changed-since-migration");
check("protected human edit remains untouched", changedFixture.contentItems.get("article-id").seo.title === "Human edit after migration");

const changedSlugFixture = createContext();
const changedSlugApply = await applyMigration(changedSlugFixture.context, [
	changedSlugFixture.ref,
]);
const changedSlugWritesBeforeRollback = changedSlugFixture.updateCount;
changedSlugFixture.contentItems.get("article-id").slug = "renamed-article";
const changedSlugRollback = await handler("core-seo-migration-rollback")(
	route({ batchId: changedSlugApply.batchId, confirm: "ROLLBACK_CORE_SEO" }),
	changedSlugFixture.context,
);
check(
	"rollback keeps an ID-keyed owner valid after the entry slug changes",
	changedSlugRollback.success === true &&
		changedSlugRollback.results[0]?.status === "rolled-back",
);
check(
	"slug-changed ID rollback restores both journaled owners",
	changedSlugFixture.updateCount === changedSlugWritesBeforeRollback + 1 &&
		changedSlugFixture.overrides.items.has(changedSlugFixture.ref) &&
		changedSlugFixture.contentItems.get("article-id").seo.title === null &&
		[...changedSlugFixture.migrations.items.values()][0]?.status === "rolled-back",
);

const rollbackAliasFixture = createContext();
const rollbackAliasApply = await applyMigration(rollbackAliasFixture.context, [
	rollbackAliasFixture.ref,
]);
const rollbackAliasRecord = [
	...rollbackAliasFixture.migrations.items.values(),
][0];
rollbackAliasFixture.overrides.items.set("posts:article-id", {
	...rollbackAliasRecord.sourceOverride,
	ref: "posts:article-id",
	updatedAt: "2026-07-14T12:02:00.000Z",
});
const rollbackAliasConflict = await handler("core-seo-migration-rollback")(
	route({ batchId: rollbackAliasApply.batchId, confirm: "ROLLBACK_CORE_SEO" }),
	rollbackAliasFixture.context,
);
check(
	"rollback refuses a new canonical alias owner before any write",
	rollbackAliasConflict.success === false &&
		rollbackAliasConflict.results[0]?.status === "override-conflict" &&
		rollbackAliasFixture.contentItems.get("article-id").seo.title ===
			"Legacy SEO title for the article page",
);
check(
	"alias-conflicted rollback keeps one legacy owner and the applied journal",
	rollbackAliasFixture.overrides.items.size === 1 &&
		rollbackAliasFixture.overrides.items.has("posts:article-id") &&
		rollbackAliasRecord.status === "applied",
);

// Two admins can submit the same migration preview together. Only one may
// claim the legacy owner; the loser must re-read after the winner and must not
// compensate the winner's committed core write.
const concurrentFixture = createContext();
const concurrentUpdate = concurrentFixture.context.content.update;
let concurrentTargetWrites = 0;
let releaseFirstConcurrentTarget!: () => void;
let markFirstConcurrentTargetStarted!: () => void;
const firstConcurrentTargetGate = new Promise<void>((resolve) => {
	releaseFirstConcurrentTarget = resolve;
});
const firstConcurrentTargetStarted = new Promise<void>((resolve) => {
	markFirstConcurrentTargetStarted = resolve;
});
concurrentFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	if (input.seo?.title === "Legacy SEO title for the article page") {
		concurrentTargetWrites += 1;
		if (concurrentTargetWrites === 1) {
			markFirstConcurrentTargetStarted();
			await firstConcurrentTargetGate;
		}
	}
	return concurrentUpdate(collection, id, input);
};
const concurrentSelections = await migrationSelections(
	concurrentFixture.context,
	[concurrentFixture.ref],
);
const concurrentApplyInput = route({
	plans: concurrentSelections,
	conflictPolicy: "skip",
	confirm: "MIGRATE_TO_CORE_SEO",
});
const firstConcurrentApplyPromise = handler("core-seo-migration-apply")(
	concurrentApplyInput,
	concurrentFixture.context,
);
await firstConcurrentTargetStarted;
check(
	"apply leases the canonical entry identity instead of its slug alias",
	[...concurrentFixture.operationLeases.items.values()].some(
		(lease) => lease.scope === "core-seo-migration:posts:article-id",
	),
);
const secondMigrationIsolate = {
	...concurrentFixture.context,
	plugin: {
		...concurrentFixture.context.plugin,
		id: "shipit-seo-second-isolate",
	},
};
const secondConcurrentApplyPromise = handler("core-seo-migration-apply")(
	concurrentApplyInput,
	secondMigrationIsolate,
);
await new Promise((resolve) => setTimeout(resolve, 10));
releaseFirstConcurrentTarget();
const [firstConcurrentApply, secondConcurrentApply] = await Promise.all([
	firstConcurrentApplyPromise,
	secondConcurrentApplyPromise,
]);
check(
	"concurrent apply keeps the winning core owner committed",
	concurrentFixture.contentItems.get("article-id").seo.title ===
		"Legacy SEO title for the article page",
);
check(
	"concurrent apply claims the legacy owner once",
	!concurrentFixture.overrides.items.has(concurrentFixture.ref),
);
check(
	"concurrent apply converges both callers on one recovered migration",
	firstConcurrentApply.success === true &&
		secondConcurrentApply.success === true &&
		firstConcurrentApply.results[0]?.status === "applied" &&
		secondConcurrentApply.results[0]?.status === "applied" &&
		firstConcurrentApply.results[0]?.migrationId ===
			secondConcurrentApply.results[0]?.migrationId,
);

// Apply may be previewed while rollback is between restoring the legacy owner
// and restoring core SEO. The per-ref lease lets rollback finish first; apply
// then revalidates its now-stale core snapshot and performs no write.
const applyRollbackFixture = createContext();
const applyBeforeRollback = await applyMigration(applyRollbackFixture.context, [
	applyRollbackFixture.ref,
]);
const aliasRollbackRecord = [
	...applyRollbackFixture.migrations.items.values(),
][0];
aliasRollbackRecord.ref = "posts:historic-article-alias";
applyRollbackFixture.migrations.items.set(
	aliasRollbackRecord.id,
	aliasRollbackRecord,
);
const applyRollbackUpdate = applyRollbackFixture.context.content.update;
let releaseRollbackCoreRestore!: () => void;
let markRollbackOwnerRestored!: () => void;
const rollbackCoreRestoreGate = new Promise<void>((resolve) => {
	releaseRollbackCoreRestore = resolve;
});
const rollbackOwnerRestored = new Promise<void>((resolve) => {
	markRollbackOwnerRestored = resolve;
});
applyRollbackFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	if (input.seo?.title === null) {
		markRollbackOwnerRestored();
		await rollbackCoreRestoreGate;
	}
	return applyRollbackUpdate(collection, id, input);
};
const racingRollbackPromise = handler("core-seo-migration-rollback")(
	route({ batchId: applyBeforeRollback.batchId, confirm: "ROLLBACK_CORE_SEO" }),
	applyRollbackFixture.context,
);
await rollbackOwnerRestored;
check(
	"rollback leases the canonical entry identity instead of its journal alias",
	[...applyRollbackFixture.operationLeases.items.values()].some(
		(lease) => lease.scope === "core-seo-migration:posts:article-id",
	),
);
const racingApplyIsolate = {
	...applyRollbackFixture.context,
	plugin: {
		...applyRollbackFixture.context.plugin,
		id: "shipit-seo-racing-apply-isolate",
	},
};
const racingApplySelections = await migrationSelections(racingApplyIsolate, [
	applyRollbackFixture.ref,
]);
const racingApplyPromise = handler("core-seo-migration-apply")(
	route({
		plans: racingApplySelections,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	racingApplyIsolate,
);
await new Promise((resolve) => setTimeout(resolve, 10));
releaseRollbackCoreRestore();
const [racingRollback, racingApply] = await Promise.all([
	racingRollbackPromise,
	racingApplyPromise,
]);
check(
	"concurrent rollback wins its leased owner handoff",
	racingRollback.success === true &&
		applyRollbackFixture.contentItems.get("article-id").seo.title === null &&
		applyRollbackFixture.overrides.items.has(applyRollbackFixture.ref),
);
check(
	"concurrent apply reports its rollback-stale snapshot without writing",
	racingApply.success === false &&
		racingApply.results[0]?.status === "changed-since-preview",
);
check(
	"concurrent apply and rollback leave one rolled-back journal owner",
	[...applyRollbackFixture.migrations.items.values()].filter(
		(record) => record.status === "rolled-back",
	).length === 1 && applyRollbackFixture.migrations.items.size === 1,
);

// If a human changes core SEO after our write but before a later step fails,
// compensation must leave that newer value in place and report partial state.
const compensationFixture = createContext();
const compensationUpdate = compensationFixture.context.content.update;
let injectedCoreEdit = false;
compensationFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	const updated = await compensationUpdate(collection, id, input);
	if (
		!injectedCoreEdit &&
		input.seo?.title === "Legacy SEO title for the article page"
	) {
		injectedCoreEdit = true;
		compensationFixture.contentItems.get(id).seo.title =
			"Human edit during failed migration";
	}
	return updated;
};
compensationFixture.overrides.delete = async () => false;
const compensationResult = await applyMigration(compensationFixture.context, [
	compensationFixture.ref,
]);
check(
	"failed apply never compensates over a newer human core edit",
	compensationFixture.contentItems.get("article-id").seo.title ===
		"Human edit during failed migration",
);
check(
	"failed apply reports a partial conflict when compensation is unsafe",
	compensationResult.results[0]?.status === "partial-conflict",
);

// content.update may commit and still reject at the transport boundary. The
// apply path re-reads both owners, sees its exact target, and compensates that
// write without disturbing the still-present legacy owner.
const ambiguousCoreFixture = createContext();
const ambiguousCoreUpdate = ambiguousCoreFixture.context.content.update;
let rejectCommittedCoreWrite = true;
ambiguousCoreFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	const updated = await ambiguousCoreUpdate(collection, id, input);
	if (
		rejectCommittedCoreWrite &&
		input.seo?.title === "Legacy SEO title for the article page"
	) {
		rejectCommittedCoreWrite = false;
		throw new Error("Injected transport rejection after committed core write");
	}
	return updated;
};
const ambiguousCoreApply = await applyMigration(ambiguousCoreFixture.context, [
	ambiguousCoreFixture.ref,
]);
check(
	"ambiguous committed core write is compensated to the exact pre-migration value",
	ambiguousCoreApply.success === false &&
		ambiguousCoreFixture.contentItems.get("article-id").seo.title === null,
);
check(
	"ambiguous core compensation keeps the legacy owner and failed journal consistent",
	ambiguousCoreFixture.overrides.items.has(ambiguousCoreFixture.ref) &&
		[...ambiguousCoreFixture.migrations.items.values()][0]?.status === "failed",
);

// Collection delete has the same transport ambiguity. If the delete actually
// committed, core already equals the target, and the legacy owner is absent,
// the migration is complete and its journal is finalized as applied.
const ambiguousDeleteFixture = createContext();
const committedDelete = ambiguousDeleteFixture.overrides.delete.bind(
	ambiguousDeleteFixture.overrides,
);
ambiguousDeleteFixture.overrides.delete = async (id: string) => {
	await committedDelete(id);
	throw new Error("Injected transport rejection after committed owner delete");
};
const ambiguousDeleteApply = await applyMigration(
	ambiguousDeleteFixture.context,
	[ambiguousDeleteFixture.ref],
);
check(
	"ambiguous committed owner delete finalizes the already-applied handoff",
	ambiguousDeleteApply.success === true &&
		ambiguousDeleteApply.results[0]?.status === "applied" &&
		ambiguousDeleteFixture.contentItems.get("article-id").seo.title ===
			"Legacy SEO title for the article page" &&
		!ambiguousDeleteFixture.overrides.items.has(ambiguousDeleteFixture.ref),
);
check(
	"ambiguous owner delete leaves an applied journal",
	[...ambiguousDeleteFixture.migrations.items.values()][0]?.status ===
		"applied",
);

const ambiguousApplyJournalFixture = createContext();
const committedApplyJournalPut =
	ambiguousApplyJournalFixture.migrations.put.bind(
		ambiguousApplyJournalFixture.migrations,
	);
let rejectCommittedApplyJournal = true;
ambiguousApplyJournalFixture.migrations.put = async (
	id: string,
	value: any,
) => {
	await committedApplyJournalPut(id, value);
	if (rejectCommittedApplyJournal && value?.status === "applied") {
		rejectCommittedApplyJournal = false;
		throw new Error(
			"Injected transport rejection after committed apply journal",
		);
	}
};
const ambiguousApplyJournal = await applyMigration(
	ambiguousApplyJournalFixture.context,
	[ambiguousApplyJournalFixture.ref],
);
check(
	"ambiguous committed apply journal is reconciled without undoing the handoff",
	ambiguousApplyJournal.success === true &&
		ambiguousApplyJournalFixture.contentItems.get("article-id").seo.title ===
			"Legacy SEO title for the article page" &&
		!ambiguousApplyJournalFixture.overrides.items.has(
			ambiguousApplyJournalFixture.ref,
		) &&
		[...ambiguousApplyJournalFixture.migrations.items.values()][0]?.status ===
			"applied",
);

// A human repair to the legacy source between the core write and ownership
// handoff invalidates the preview. It must survive and the core write is safely
// restored only while it still equals this migration's expected value.
const ownerEditFixture = createContext();
const ownerEditUpdate = ownerEditFixture.context.content.update;
let injectedOwnerEdit = false;
ownerEditFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	const updated = await ownerEditUpdate(collection, id, input);
	if (
		!injectedOwnerEdit &&
		input.seo?.title === "Legacy SEO title for the article page"
	) {
		injectedOwnerEdit = true;
		ownerEditFixture.overrides.items.set(ownerEditFixture.ref, {
			...ownerEditFixture.overrides.items.get(ownerEditFixture.ref),
			title: "Human legacy repair during migration",
			updatedAt: "2026-07-14T12:05:00.000Z",
		});
	}
	return updated;
};
const ownerEditResult = await applyMigration(ownerEditFixture.context, [
	ownerEditFixture.ref,
]);
check(
	"ownership handoff preserves a newer human legacy edit",
	ownerEditFixture.overrides.items.get(ownerEditFixture.ref)?.title ===
		"Human legacy repair during migration",
);
check(
	"ownership handoff restores its core write after a detected source conflict",
	ownerEditFixture.contentItems.get("article-id").seo.title === null &&
		ownerEditResult.results[0]?.status === "changed-since-preview",
);

const finalOwnerReadFixture = createContext();
const finalOwnerReadPlans = await migrationSelections(
	finalOwnerReadFixture.context,
	[finalOwnerReadFixture.ref],
);
const finalOwnerReadLeasePut = finalOwnerReadFixture.operationLeases.put.bind(
	finalOwnerReadFixture.operationLeases,
);
let injectedFinalOwnerEdit = false;
finalOwnerReadFixture.operationLeases.put = async (
	id: string,
	value: unknown,
) => {
	await finalOwnerReadLeasePut(id, value);
	if (
		!injectedFinalOwnerEdit &&
		finalOwnerReadFixture.contentItems.get("article-id").seo.title ===
			"Legacy SEO title for the article page"
	) {
		injectedFinalOwnerEdit = true;
		finalOwnerReadFixture.overrides.items.set(finalOwnerReadFixture.ref, {
			...finalOwnerReadFixture.overrides.items.get(finalOwnerReadFixture.ref),
			hostCompatibilityNote: "human edit during final lease renewal",
		});
	}
};
const finalOwnerReadApply = await handler("core-seo-migration-apply")(
	route({
		plans: finalOwnerReadPlans,
		conflictPolicy: "skip",
		confirm: "MIGRATE_TO_CORE_SEO",
	}),
	finalOwnerReadFixture.context,
);
check(
	"final handoff renews before its raw legacy-owner reread",
	finalOwnerReadApply.success === false &&
		finalOwnerReadApply.results[0]?.status === "changed-since-preview" &&
		finalOwnerReadFixture.contentItems.get("article-id").seo.title === null,
);
check(
	"raw owner edit during final renewal survives without source deletion",
	finalOwnerReadFixture.overrides.items.get(finalOwnerReadFixture.ref)
		?.hostCompatibilityNote === "human edit during final lease renewal" &&
		[...finalOwnerReadFixture.migrations.items.values()][0]?.status ===
			"failed",
);

// An alias owner can appear after preview and after the core write. The final
// handoff rechecks all canonical ID/slug owners, restores core, and leaves both
// legacy records for explicit consolidation rather than creating dual layers.
const lateAliasFixture = createContext();
const lateAliasUpdate = lateAliasFixture.context.content.update;
let injectedLateAlias = false;
lateAliasFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	const updated = await lateAliasUpdate(collection, id, input);
	if (
		!injectedLateAlias &&
		input.seo?.title === "Legacy SEO title for the article page"
	) {
		injectedLateAlias = true;
		lateAliasFixture.overrides.items.set("posts:article-id", {
			...lateAliasFixture.overrides.items.get(lateAliasFixture.ref),
			ref: "posts:article-id",
			updatedAt: "2026-07-14T12:07:00.000Z",
		});
	}
	return updated;
};
const lateAliasApply = await applyMigration(lateAliasFixture.context, [
	lateAliasFixture.ref,
]);
check(
	"late alias owner invalidates handoff and restores core",
	lateAliasApply.success === false &&
		lateAliasApply.results[0]?.status === "changed-since-preview" &&
		lateAliasFixture.contentItems.get("article-id").seo.title === null,
);
check(
	"late alias conflict preserves both legacy records for consolidation",
	lateAliasFixture.overrides.items.has(lateAliasFixture.ref) &&
		lateAliasFixture.overrides.items.has("posts:article-id"),
);

const handoffSlugFixture = createContext();
const handoffSlugUpdate = handoffSlugFixture.context.content.update;
let injectedHandoffSlugEdit = false;
handoffSlugFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	const updated = await handoffSlugUpdate(collection, id, input);
	if (
		!injectedHandoffSlugEdit &&
		input.seo?.title === "Legacy SEO title for the article page"
	) {
		injectedHandoffSlugEdit = true;
		handoffSlugFixture.contentItems.get(id).slug = "renamed-during-handoff";
		return structuredClone(handoffSlugFixture.contentItems.get(id));
	}
	return updated;
};
const handoffSlugApply = await applyMigration(handoffSlugFixture.context, [
	handoffSlugFixture.ref,
]);
check(
	"slug change between core write and handoff prevents legacy owner deletion",
	handoffSlugApply.success === false &&
		handoffSlugApply.results[0]?.status === "partial-conflict" &&
		handoffSlugFixture.overrides.items.has(handoffSlugFixture.ref),
);
check(
	"handoff slug race preserves visible migrated metadata and the human slug",
	handoffSlugFixture.contentItems.get("article-id").slug ===
		"renamed-during-handoff" &&
		handoffSlugFixture.contentItems.get("article-id").seo.title === null &&
		handoffSlugFixture.overrides.items.has(handoffSlugFixture.ref),
);

// The narrower race can land after the source delete commits. Core is restored,
// but recreating the old slug owner would produce two aliases, so the new owner
// is preserved and the operation reports an explicit partial handoff.
const postDeleteAliasFixture = createContext();
const postDeleteSourceDelete = postDeleteAliasFixture.overrides.delete.bind(
	postDeleteAliasFixture.overrides,
);
let injectedPostDeleteAlias = false;
postDeleteAliasFixture.overrides.delete = async (id: string) => {
	const deleted = await postDeleteSourceDelete(id);
	if (!injectedPostDeleteAlias && id === postDeleteAliasFixture.ref) {
		injectedPostDeleteAlias = true;
		postDeleteAliasFixture.overrides.items.set("posts:article-slug", {
			ref: "posts:article-slug",
			title: "Human alias created after owner delete",
			updatedAt: "2026-07-14T12:08:00.000Z",
		});
	}
	return deleted;
};
const postDeleteAliasApply = await applyMigration(
	postDeleteAliasFixture.context,
	[postDeleteAliasFixture.ref],
);
check(
	"alias created after source deletion is reported as a partial ownership conflict",
	postDeleteAliasApply.success === false &&
		postDeleteAliasApply.results[0]?.status === "partial-conflict",
);
check(
	"post-delete alias race restores core and preserves exactly the newer legacy owner",
	postDeleteAliasFixture.contentItems.get("article-id").seo.title === null &&
		!postDeleteAliasFixture.overrides.items.has(postDeleteAliasFixture.ref) &&
		postDeleteAliasFixture.overrides.items.get("posts:article-slug")?.title ===
			"Human alias created after owner delete",
);

const postDeleteSlugFixture = createContext();
const postDeleteSlugSourceDelete = postDeleteSlugFixture.overrides.delete.bind(
	postDeleteSlugFixture.overrides,
);
let injectedPostDeleteSlugEdit = false;
postDeleteSlugFixture.overrides.delete = async (id: string) => {
	const deleted = await postDeleteSlugSourceDelete(id);
	if (!injectedPostDeleteSlugEdit && id === postDeleteSlugFixture.ref) {
		injectedPostDeleteSlugEdit = true;
		postDeleteSlugFixture.contentItems.get("article-id").slug =
			"renamed-after-delete";
	}
	return deleted;
};
const postDeleteSlugApply = await applyMigration(
	postDeleteSlugFixture.context,
	[postDeleteSlugFixture.ref],
);
check(
	"post-delete identity check uses the latest entry instead of the stale update result",
	postDeleteSlugApply.success === false &&
		postDeleteSlugApply.results[0]?.status === "partial-conflict" &&
		postDeleteSlugFixture.contentItems.get("article-id").slug ===
			"renamed-after-delete",
);
check(
	"post-delete slug race restores the still-reachable ID owner",
	postDeleteSlugFixture.contentItems.get("article-id").seo.title === null &&
		postDeleteSlugFixture.overrides.items.has(postDeleteSlugFixture.ref) &&
		[...postDeleteSlugFixture.migrations.items.values()][0]?.status ===
			"failed",
);

const rollbackPutAliasRaceFixture = createContext();
const rollbackPutAliasRaceApply = await applyMigration(
	rollbackPutAliasRaceFixture.context,
	[rollbackPutAliasRaceFixture.ref],
);
const rollbackPutAliasRacePut = rollbackPutAliasRaceFixture.overrides.put.bind(
	rollbackPutAliasRaceFixture.overrides,
);
let injectedRollbackPutAliasEdit = false;
rollbackPutAliasRaceFixture.overrides.put = async (
	id: string,
	value: unknown,
) => {
	await rollbackPutAliasRacePut(id, value);
	if (!injectedRollbackPutAliasEdit && id === rollbackPutAliasRaceFixture.ref) {
		injectedRollbackPutAliasEdit = true;
		rollbackPutAliasRaceFixture.contentItems.get("article-id").id =
			"renamed-during-rollback-owner-restore";
	}
};
const rollbackPutAliasRace = await handler("core-seo-migration-rollback")(
	route({
		batchId: rollbackPutAliasRaceApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackPutAliasRaceFixture.context,
);
check(
	"rollback rechecks the source alias after restoring the legacy owner",
	rollbackPutAliasRace.success === false &&
		rollbackPutAliasRace.results[0]?.status === "partial-conflict" &&
		String(rollbackPutAliasRace.results[0]?.error).includes(
			"legacy_owner_no_longer_aliases_entry",
		),
);
check(
	"rollback alias race removes only its inserted owner and preserves applied core",
	rollbackPutAliasRaceFixture.contentItems.get("article-id").id ===
		"renamed-during-rollback-owner-restore" &&
		rollbackPutAliasRaceFixture.contentItems.get("article-id").seo.title ===
			"Legacy SEO title for the article page" &&
		!rollbackPutAliasRaceFixture.overrides.items.has(
			rollbackPutAliasRaceFixture.ref,
		) &&
		[...rollbackPutAliasRaceFixture.migrations.items.values()][0]?.status ===
			"failed",
);

const rollbackPutCoreRaceFixture = createContext();
const rollbackPutCoreRaceApply = await applyMigration(
	rollbackPutCoreRaceFixture.context,
	[rollbackPutCoreRaceFixture.ref],
);
const rollbackPutCoreRacePut = rollbackPutCoreRaceFixture.overrides.put.bind(
	rollbackPutCoreRaceFixture.overrides,
);
let injectedRollbackPutCoreEdit = false;
rollbackPutCoreRaceFixture.overrides.put = async (
	id: string,
	value: unknown,
) => {
	await rollbackPutCoreRacePut(id, value);
	if (!injectedRollbackPutCoreEdit && id === rollbackPutCoreRaceFixture.ref) {
		injectedRollbackPutCoreEdit = true;
		rollbackPutCoreRaceFixture.contentItems.get("article-id").seo.title =
			"Human core edit during rollback";
	}
};
const rollbackPutCoreRace = await handler("core-seo-migration-rollback")(
	route({
		batchId: rollbackPutCoreRaceApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackPutCoreRaceFixture.context,
);
check(
	"rollback detects a human core edit made during legacy-owner restore",
	rollbackPutCoreRace.success === false &&
		rollbackPutCoreRace.results[0]?.status === "partial-conflict" &&
		String(rollbackPutCoreRace.results[0]?.error).includes(
			"core_owner_changed_during_rollback",
		),
);
check(
	"failed rollback preserves human core and removes only its exact inserted owner",
	rollbackPutCoreRaceFixture.contentItems.get("article-id").seo.title ===
		"Human core edit during rollback" &&
		!rollbackPutCoreRaceFixture.overrides.items.has(
			rollbackPutCoreRaceFixture.ref,
		) &&
		[...rollbackPutCoreRaceFixture.migrations.items.values()][0]?.status ===
			"failed",
);

// Rollback compensation is expected-value guarded too: if restoring core SEO
// fails after the source was recreated and a human immediately edits it, the
// cleanup path must not delete that human value.
const rollbackConflictFixture = createContext();
const rollbackConflictApply = await applyMigration(
	rollbackConflictFixture.context,
	[rollbackConflictFixture.ref],
);
const rollbackConflictUpdate = rollbackConflictFixture.context.content.update;
rollbackConflictFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	if (input.seo?.title === null) {
		rollbackConflictFixture.overrides.items.set(rollbackConflictFixture.ref, {
			...rollbackConflictFixture.overrides.items.get(
				rollbackConflictFixture.ref,
			),
			title: "Human edit during rollback failure",
			updatedAt: "2026-07-14T12:10:00.000Z",
		});
		throw new Error("Injected rollback core failure");
	}
	return rollbackConflictUpdate(collection, id, input);
};
const rollbackConflict = await handler("core-seo-migration-rollback")(
	route({
		batchId: rollbackConflictApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	rollbackConflictFixture.context,
);
check(
	"rollback failure cleanup preserves a newer human legacy edit",
	rollbackConflictFixture.overrides.items.get(rollbackConflictFixture.ref)
		?.title === "Human edit during rollback failure",
);
check(
	"rollback failure reports a partial conflict instead of claiming full rollback",
	rollbackConflict.results[0]?.status === "partial-conflict",
);

// If content disappears after the legacy owner was restored, rollback cannot
// prove either complete or retryable applied state. Preserve the restored owner
// and surface the missing core owner as an explicit partial conflict.
const missingCoreFixture = createContext();
const missingCoreApply = await applyMigration(missingCoreFixture.context, [
	missingCoreFixture.ref,
]);
const missingCoreUpdate = missingCoreFixture.context.content.update;
missingCoreFixture.context.content.update = async (
	collection: string,
	id: string,
	input: any,
) => {
	if (input.seo?.title === null) {
		missingCoreFixture.contentItems.delete(id);
		throw new Error("Injected content deletion during rollback");
	}
	return missingCoreUpdate(collection, id, input);
};
const missingCoreRollback = await handler("core-seo-migration-rollback")(
	route({ batchId: missingCoreApply.batchId, confirm: "ROLLBACK_CORE_SEO" }),
	missingCoreFixture.context,
);
check(
	"missing content during rollback is an explicit partial conflict",
	missingCoreRollback.success === false &&
		missingCoreRollback.results[0]?.status === "partial-conflict" &&
		String(missingCoreRollback.results[0]?.error).includes(
			"core_owner_missing_during_rollback",
		),
);
check(
	"missing-content rollback preserves the restored legacy owner and failed journal",
	missingCoreFixture.overrides.items.has(missingCoreFixture.ref) &&
		[...missingCoreFixture.migrations.items.values()][0]?.status === "failed",
);

// A legacy-owner restore can also commit and then reject. Cleanup detects the
// committed value, removes only that exact expected owner, and leaves the
// applied journal retryable without two metadata owners.
const ambiguousRestoreFixture = createContext();
const ambiguousRestoreApply = await applyMigration(
	ambiguousRestoreFixture.context,
	[ambiguousRestoreFixture.ref],
);
const committedRestore = ambiguousRestoreFixture.overrides.put.bind(
	ambiguousRestoreFixture.overrides,
);
let rejectCommittedRestore = true;
ambiguousRestoreFixture.overrides.put = async (id: string, value: unknown) => {
	await committedRestore(id, value);
	if (rejectCommittedRestore) {
		rejectCommittedRestore = false;
		throw new Error(
			"Injected transport rejection after committed owner restore",
		);
	}
};
const ambiguousRestoreRollback = await handler("core-seo-migration-rollback")(
	route({
		batchId: ambiguousRestoreApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	ambiguousRestoreFixture.context,
);
check(
	"ambiguous owner restore cleanup avoids duplicate metadata owners",
	ambiguousRestoreRollback.success === false &&
		ambiguousRestoreRollback.results[0]?.status === "failed" &&
		ambiguousRestoreFixture.contentItems.get("article-id").seo.title ===
			"Legacy SEO title for the article page" &&
		!ambiguousRestoreFixture.overrides.items.has(ambiguousRestoreFixture.ref),
);
check(
	"ambiguous owner restore keeps the migration journal applied and retryable",
	[...ambiguousRestoreFixture.migrations.items.values()][0]?.status ===
		"applied",
);

// Journal persistence can reject after committing too. A final-state reread
// confirms both owners and the durable rolled-back record before reporting
// success, rather than attempting a second owner transition.
const ambiguousJournalFixture = createContext();
const ambiguousJournalApply = await applyMigration(
	ambiguousJournalFixture.context,
	[ambiguousJournalFixture.ref],
);
const committedJournalPut = ambiguousJournalFixture.migrations.put.bind(
	ambiguousJournalFixture.migrations,
);
ambiguousJournalFixture.migrations.put = async (id: string, value: any) => {
	await committedJournalPut(id, value);
	if (value?.status === "rolled-back")
		throw new Error(
			"Injected transport rejection after committed rollback journal",
		);
};
const ambiguousJournalRollback = await handler("core-seo-migration-rollback")(
	route({
		batchId: ambiguousJournalApply.batchId,
		confirm: "ROLLBACK_CORE_SEO",
	}),
	ambiguousJournalFixture.context,
);
check(
	"ambiguous committed rollback journal is reconciled as rolled back",
	ambiguousJournalRollback.success === true &&
		ambiguousJournalFixture.contentItems.get("article-id").seo.title === null &&
		ambiguousJournalFixture.overrides.items.has(ambiguousJournalFixture.ref) &&
		[...ambiguousJournalFixture.migrations.items.values()][0]?.status ===
			"rolled-back",
);

const conflictFixture = createContext({ coreTitle: "Existing core SEO title" });
const conflictApply = await applyMigration(conflictFixture.context, [
	conflictFixture.ref,
]);
check("default conflict policy performs no content write", conflictApply.success === false && conflictFixture.updateCount === 0);
check("default conflict policy preserves both owners for manual review", conflictFixture.overrides.items.has(conflictFixture.ref));

const coreFixture = createContext();
coreFixture.contentItems.get("article-id").seo.description = "Keep this existing core description";
const coreRead = await handler("entry-seo")(
	route({ collection: "posts", id: "article-id" }),
	coreFixture.context,
);
check("core SEO read resolves the canonical entry ID", coreRead.success === true && coreRead.item?.id === "article-id");
check("core SEO read returns the normalized native shape", coreRead.item?.seo?.description === "Keep this existing core description");
check("core SEO read exposes a pending legacy owner", coreRead.legacyOverrideRef === coreFixture.ref);
check("unguarded core SEO write route is not registered", !Object.hasOwn((seoRuntime as any).routes, "set-entry-seo"));

check(
	"unguarded legacy override writers are not registered",
	!Object.hasOwn((seoRuntime as any).routes, "set-override") &&
		!Object.hasOwn((seoRuntime as any).routes, "delete-override"),
);

const lockedFixture = createContext();
lockedFixture.overrides.items.delete(lockedFixture.ref);
const lockedAdmin = await handler("admin")(route({ page: "overrides" }), lockedFixture.context);
check("legacy editor is absent when no records remain", !JSON.stringify(lockedAdmin.blocks).includes('"block_id":"seo_override"'));
const lockedWrite = await handler("admin")(
	route({ type: "form_submit", block_id: "seo_global", values: { siteName: "Changed from the legacy page" } }),
	lockedFixture.context,
);
check(
	"the legacy Block Kit page rejects writes",
	lockedWrite.toast?.type === "error" && !JSON.stringify(lockedAdmin.blocks).includes('"type":"form"'),
);

const discardFixture = createContext();
const discardPlan = await handler("core-seo-migration-plan")(
	route({ conflictPolicy: "skip", limit: 100 }),
	discardFixture.context,
);
const discardItem = discardPlan.items.find((item: any) => item.sourceOverrideId === discardFixture.ref);
const unconfirmedDiscard = await handler("discard-admin-legacy-override")(
	route({ sourceOverrideId: discardFixture.ref, fingerprint: discardItem?.fingerprint, conflictPolicy: "skip" }),
	discardFixture.context,
);
const staleDiscard = await handler("discard-admin-legacy-override")(
	route({ sourceOverrideId: discardFixture.ref, fingerprint: `sha256-${"0".repeat(64)}`, conflictPolicy: "skip", confirm: "DISCARD_LEGACY_SEO" }),
	discardFixture.context,
);
check(
	"a legacy record is not discarded without confirmation or with a stale review",
	unconfirmedDiscard.error === "confirmation_required" &&
		staleDiscard.error === "preview_stale" &&
		discardFixture.overrides.items.has(discardFixture.ref),
);
const discarded = await handler("discard-admin-legacy-override")(
	route({ sourceOverrideId: discardFixture.ref, fingerprint: discardItem?.fingerprint, conflictPolicy: "skip", confirm: "DISCARD_LEGACY_SEO" }),
	discardFixture.context,
);
check(
	"a reviewed legacy record can be discarded and its values are returned",
	discarded.success === true &&
		!discardFixture.overrides.items.has(discardFixture.ref) &&
		typeof discarded.discarded?.title === "string" &&
		discarded.nextOwner?.kind === "core-seo",
);

// ---- One exact record's export, bound to its reviewed plan ----
const DISCARD = "DISCARD_LEGACY_SEO";
const planRoute = (seoRuntime as any).routes["core-seo-migration-plan"];
const exportInput = (ref: string) => ({ refs: [ref], conflictPolicy: "skip", limit: 1, snapshot: true });
const discardWith = (fixture: ReturnType<typeof createContext>, fingerprint: string) =>
	handler("discard-admin-legacy-override")(
		route({ sourceOverrideId: fixture.ref, fingerprint, conflictPolicy: "skip", confirm: DISCARD }),
		fixture.context,
	);
const exportFixture = createContext();
exportFixture.overrides.items.set(exportFixture.ref, {
	...exportFixture.overrides.items.get(exportFixture.ref),
	robots: "noindex,nofollow,noarchive",
	notes: { owner: "legacy import", tags: ["a", 1, null, true] },
});
const storedForExport = clone(exportFixture.overrides.items.get(exportFixture.ref));
check(
	"a record export names exactly one ref with limit 1 and no cursor",
	planRoute.input.safeParse(exportInput(exportFixture.ref)).success &&
		!planRoute.input.safeParse({ ...exportInput(exportFixture.ref), limit: 100 }).success &&
		!planRoute.input.safeParse({ ...exportInput(exportFixture.ref), limit: undefined }).success &&
		!planRoute.input.safeParse({ ...exportInput(exportFixture.ref), refs: [exportFixture.ref, "posts:other"] }).success &&
		!planRoute.input.safeParse({ ...exportInput(exportFixture.ref), cursor: "overrides:next" }).success &&
		!planRoute.input.safeParse({ conflictPolicy: "skip", limit: 1, snapshot: true }).success &&
		!planRoute.input.safeParse({ ...exportInput(exportFixture.ref), snapshot: false }).success,
);
let exportOverrideReads = 0;
const exportOverrideGet = exportFixture.overrides.get.bind(exportFixture.overrides);
exportFixture.overrides.get = async (id: string) => {
	exportOverrideReads += 1;
	return exportOverrideGet(id);
};
const plainOnePlan = await handler("core-seo-migration-plan")(
	route({ refs: [exportFixture.ref], conflictPolicy: "skip", limit: 1 }),
	exportFixture.context,
);
const plainOneReads = exportOverrideReads;
exportOverrideReads = 0;
const exportPlan = await handler("core-seo-migration-plan")(route(exportInput(exportFixture.ref)), exportFixture.context);
const exportReads = exportOverrideReads;
exportFixture.overrides.get = exportOverrideGet;
const exportItem = exportPlan.items[0];
const exportedDocument = exportItem?.snapshot?.status === "available" ? JSON.parse(exportItem.snapshot.document) : null;
check(
	"an exact-ID export is the complete stored record, entry, locale, policy and fingerprint of one plan",
	exportPlan.discardAvailable === true &&
		exportPlan.writeAvailable === true &&
		exportPlan.items.length === 1 &&
		plainOnePlan.items[0].snapshot === undefined &&
		exportedDocument !== null &&
		JSON.stringify(exportedDocument.record) === JSON.stringify(storedForExport) &&
		exportedDocument.fingerprint === exportItem.fingerprint &&
		exportItem.fingerprint === plainOnePlan.items[0].fingerprint &&
		exportedDocument.sourceOverrideId === exportFixture.ref &&
		exportedDocument.reference === exportFixture.ref &&
		JSON.stringify(exportedDocument.entry) === JSON.stringify({ ref: exportFixture.ref, collection: "posts", entryId: "article-id", locale: "en" }) &&
		exportedDocument.conflictPolicy === "skip" &&
		exportedDocument.generatedAt === exportPlan.generatedAt &&
		exportItem.snapshot.bytes === new TextEncoder().encode(exportItem.snapshot.document).byteLength,
	JSON.stringify(exportItem?.snapshot ?? null).slice(0, 300),
);
check("the export adds no storage read to the same one-record plan", exportReads === plainOneReads, `${exportReads} vs ${plainOneReads}`);
let parsedExportPlan: any = null;
try {
	parsedExportPlan = parseSeoAdminMigrationPlan(exportPlan);
} catch (error) {
	parsedExportPlan = String(error);
}
check("the engine's export response passes the strict admin parser", parsedExportPlan?.items?.[0]?.snapshot?.status === "available", String(parsedExportPlan));

for (const [name, change] of [
	["an unsupported field", (record: any) => ({ ...record, notes: { ...record.notes, owner: "changed" } })],
	["an unsupported robots directive", (record: any) => ({ ...record, robots: "noindex,nofollow,nosnippet" })],
] as const) {
	const changed = change(storedForExport);
	exportFixture.overrides.items.set(exportFixture.ref, clone(changed));
	const staleDiscard = await discardWith(exportFixture, exportItem.fingerprint);
	check(
		`a change to ${name} after the export makes its fingerprint stale`,
		staleDiscard.error === "preview_stale" &&
			JSON.stringify(exportFixture.overrides.items.get(exportFixture.ref)) === JSON.stringify(changed),
	);
}
exportFixture.overrides.items.set(exportFixture.ref, clone(storedForExport));
const repeatedExport = (await handler("core-seo-migration-plan")(route(exportInput(exportFixture.ref)), exportFixture.context)).items[0];
check("control: an unchanged record and entry repeat the reviewed fingerprint", repeatedExport.fingerprint === exportItem.fingerprint);
exportFixture.contentItems.get("article-id").locale = "fr";
const relocalisedExport = (await handler("core-seo-migration-plan")(route(exportInput(exportFixture.ref)), exportFixture.context)).items[0];
const relocalisedDiscard = await discardWith(exportFixture, exportItem.fingerprint);
check(
	"the entry's actual locale is part of the reviewed fingerprint and export",
	relocalisedExport.fingerprint !== exportItem.fingerprint &&
		JSON.parse(relocalisedExport.snapshot.document).entry.locale === "fr" &&
		relocalisedDiscard.error === "preview_stale" &&
		exportFixture.overrides.items.has(exportFixture.ref),
);
exportFixture.contentItems.get("article-id").locale = null;
const unlocalisedExport = (await handler("core-seo-migration-plan")(route(exportInput(exportFixture.ref)), exportFixture.context)).items[0];
check("a host row without a locale exports null, not a site default", JSON.parse(unlocalisedExport.snapshot.document).entry.locale === null);
exportFixture.contentItems.get("article-id").locale = "en";

const raceFingerprint = (await handler("core-seo-migration-plan")(route(exportInput(exportFixture.ref)), exportFixture.context)).items[0].fingerprint;
const raceCompare = exportFixture.overrides.compareAndSet.bind(exportFixture.overrides);
let raceAttempts = 0;
exportFixture.overrides.compareAndSet = async (id: string, expected: any, next: any) => {
	raceAttempts += 1;
	exportFixture.overrides.items.set(id, { ...storedForExport, title: "Written after the discard read the record" });
	return raceCompare(id, expected, next);
};
const raceDiscard = await discardWith(exportFixture, raceFingerprint);
exportFixture.overrides.compareAndSet = raceCompare;
check(
	"a write between the last read and the guarded delete keeps the record",
	raceFingerprint === exportItem.fingerprint &&
		raceDiscard.error === "preview_stale" &&
		raceAttempts === 1 &&
		exportFixture.overrides.items.get(exportFixture.ref)?.title === "Written after the discard read the record",
);

class RevisionCollection extends MemoryCollection {
	revisions = new Map<string, number>();
	async put(id: string, value: unknown) {
		await super.put(id, value);
		this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
	}
	async getVersioned(id: string) {
		return this.items.has(id) ? { value: clone(this.items.get(id)), revision: `r${this.revisions.get(id) ?? 0}` } : null;
	}
	async compareAndSet(id: string, revision: any, value?: unknown): Promise<any> {
		if ((this.items.has(id) ? `r${this.revisions.get(id) ?? 0}` : null) !== revision) return { applied: false };
		await this.put(id, value);
		return { applied: true, revision: `r${this.revisions.get(id)}` };
	}
	async compareAndDelete(id: string, revision: string) {
		if (!this.items.has(id) || `r${this.revisions.get(id) ?? 0}` !== revision) return { applied: false };
		this.items.delete(id);
		return { applied: true };
	}
}
const nativeFixture = createContext();
const nativeOverrides = new RevisionCollection();
await nativeOverrides.put(nativeFixture.ref, nativeFixture.overrides.items.get(nativeFixture.ref));
nativeFixture.context.storage.overrides = nativeOverrides;
(nativeFixture as any).overrides = nativeOverrides;
const nativePlan = await handler("core-seo-migration-plan")(route(exportInput(nativeFixture.ref)), nativeFixture.context);
const nativeDelete = nativeOverrides.compareAndDelete.bind(nativeOverrides);
nativeOverrides.compareAndDelete = async (id: string, revision: string) => {
	await nativeOverrides.put(id, { ...(nativeOverrides.items.get(id) as any), description: "Changed after the versioned read" });
	return nativeDelete(id, revision);
};
const nativeRaceDiscard = await discardWith(nativeFixture, nativePlan.items[0].fingerprint);
nativeOverrides.compareAndDelete = nativeDelete;
const nativeRepeatPlan = await handler("core-seo-migration-plan")(route(exportInput(nativeFixture.ref)), nativeFixture.context);
const nativeDiscard = await discardWith(nativeFixture, nativeRepeatPlan.items[0].fingerprint);
check(
	"a revision-fenced host refuses a write after the versioned read and deletes the reviewed record",
	nativePlan.discardAvailable === true &&
		nativeRaceDiscard.error === "preview_stale" &&
		nativeDiscard.success === true &&
		!nativeOverrides.items.has(nativeFixture.ref),
	JSON.stringify([nativeRaceDiscard, nativeDiscard]).slice(0, 300),
);

const noConditionalFixture = createContext();
(noConditionalFixture.overrides as any).compareAndSet = undefined;
let unconditionalDeletes = 0;
const noConditionalDelete = noConditionalFixture.overrides.delete.bind(noConditionalFixture.overrides);
noConditionalFixture.overrides.delete = async (id: string) => {
	unconditionalDeletes += 1;
	return noConditionalDelete(id);
};
const noConditionalPlan = await handler("core-seo-migration-plan")(
	route({ refs: [noConditionalFixture.ref], conflictPolicy: "skip", limit: 100 }),
	noConditionalFixture.context,
);
const noConditionalDiscard = await discardWith(noConditionalFixture, noConditionalPlan.items[0].fingerprint);
check(
	"a host without conditional deletion reports it and deletes nothing",
	noConditionalPlan.discardAvailable === false &&
		noConditionalPlan.writeAvailable === false &&
		noConditionalDiscard.success === false &&
		noConditionalDiscard.error === "discard_unavailable" &&
		parseSeoAdminLegacyDiscardResponse(noConditionalDiscard).success === false &&
		unconditionalDeletes === 0 &&
		noConditionalFixture.overrides.items.has(noConditionalFixture.ref),
);
const conditionalOnlyFixture = createContext();
conditionalOnlyFixture.context.content.updateIfUnchanged = undefined;
const conditionalOnlyPlan = await handler("core-seo-migration-plan")(
	route({ refs: [conditionalOnlyFixture.ref], conflictPolicy: "skip", limit: 100 }),
	conditionalOnlyFixture.context,
);
check(
	"discard capability is reported separately from migration writes",
	conditionalOnlyPlan.writeAvailable === false && conditionalOnlyPlan.discardAvailable === true,
);

const cyclicRecord: any = { title: "Cyclic legacy title" };
cyclicRecord.self = cyclicRecord;
for (const [name, record] of [
	["a cycle", cyclicRecord],
	["a BigInt", { title: "Large counter", weight: 10n }],
	["a negative zero", { title: "Signed zero", weight: -0 }],
	["a non-finite number", { title: "Infinite weight", weight: Infinity }],
	["undefined inside an array", { title: "Array gap", tags: [undefined] }],
	["a Date", { title: "Dated", importedAt: new Date("2026-07-14T12:00:00.000Z") }],
] as const) {
	const lossyFixture = createContext();
	lossyFixture.overrides.items.set(lossyFixture.ref, { ref: lossyFixture.ref, ...record });
	let lossyWrites = 0;
	const lossyCompare = lossyFixture.overrides.compareAndSet.bind(lossyFixture.overrides);
	lossyFixture.overrides.compareAndSet = async (id: string, expected: any, next: any) => {
		lossyWrites += 1;
		return lossyCompare(id, expected, next);
	};
	let snapshotPlan: any;
	let listedPlan: any;
	try {
		snapshotPlan = await handler("core-seo-migration-plan")(route(exportInput(lossyFixture.ref)), lossyFixture.context);
		listedPlan = await handler("core-seo-migration-plan")(route({ conflictPolicy: "skip", limit: 100 }), lossyFixture.context);
	} catch (error) {
		snapshotPlan = { error: String(error) };
	}
	const lossyItem = snapshotPlan?.items?.[0];
	const lossyDiscard = lossyItem ? await discardWith(lossyFixture, lossyItem.fingerprint) : null;
	const lossyApply = lossyItem
		? await handler("core-seo-migration-apply")(
			route({ plans: [{ sourceOverrideId: lossyFixture.ref, fingerprint: lossyItem.fingerprint }], conflictPolicy: "skip", confirm: "MIGRATE_TO_CORE_SEO" }),
			lossyFixture.context,
		)
		: null;
	check(
		`a record with ${name} is refused as not JSON before canonicalization and cannot be acted on`,
		lossyItem?.snapshot?.status === "refused" &&
			lossyItem.snapshot.reason === "not-json" &&
			/^sha256-[a-f0-9]{64}$/.test(lossyItem.fingerprint) &&
			listedPlan.items[0].fingerprint !== lossyItem.fingerprint &&
			lossyDiscard?.error === "preview_stale" &&
			lossyApply?.success !== true &&
			lossyFixture.updateCount === 0 &&
			lossyWrites === 0 &&
			lossyFixture.overrides.items.has(lossyFixture.ref),
		JSON.stringify(snapshotPlan?.error ?? lossyItem?.snapshot ?? null),
	);
}

const largeFixture = createContext();
// Under the limit in UTF-16 code units, over it in UTF-8 bytes.
largeFixture.overrides.items.set(largeFixture.ref, { ...largeFixture.overrides.items.get(largeFixture.ref), notes: "é".repeat(1_100_000) });
const largeItem = (await handler("core-seo-migration-plan")(route(exportInput(largeFixture.ref)), largeFixture.context)).items[0];
check(
	"an export above 2 MiB of UTF-8 is refused whole",
	JSON.stringify(largeItem.snapshot) === JSON.stringify({ status: "refused", reason: "too-large" }),
);

const aliasExportFixture = createContext({ ref: "posts:article-slug" });
const unresolvedAliasItem = (await handler("core-seo-migration-plan")(route(exportInput(aliasExportFixture.ref)), aliasExportFixture.context)).items[0];
// The alias row names its entry by ID, so the plan resolves the entry and only the key kind refuses the export.
aliasExportFixture.overrides.items.get(aliasExportFixture.ref).ref = "posts:article-id";
const aliasExportItem = (await handler("core-seo-migration-plan")(route(exportInput(aliasExportFixture.ref)), aliasExportFixture.context)).items[0];
check(
	"a slug-alias record has no export, whether or not its entry resolves",
	JSON.stringify(unresolvedAliasItem.snapshot) === JSON.stringify({ status: "refused", reason: "entry-unavailable" }) &&
		aliasExportItem.entryId === "article-id" &&
		JSON.stringify(aliasExportItem.snapshot) === JSON.stringify({ status: "refused", reason: "not-exact-id" }),
	JSON.stringify([unresolvedAliasItem.snapshot, aliasExportItem.state, aliasExportItem.snapshot]),
);

const recoveryExportFixture = createContext();
await applyMigration(recoveryExportFixture.context, [recoveryExportFixture.ref]);
const recoveryExportRecord = clone([...recoveryExportFixture.migrations.items.values()][0]);
const recoveryExportOperation = clone([...recoveryExportFixture.migrationOperations.items.values()][0]);
recoveryExportRecord.status = "prepared";
recoveryExportOperation.status = "prepared";
recoveryExportOperation.record = clone(recoveryExportRecord);
// An earlier selection fingerprint, computed before the entry locale was part of it.
recoveryExportOperation.selectionFingerprint = `sha256-${"c".repeat(64)}`;
recoveryExportFixture.migrations.items.set(recoveryExportRecord.id, clone(recoveryExportRecord));
recoveryExportFixture.migrationOperations.items.set(recoveryExportOperation.id, clone(recoveryExportOperation));
recoveryExportFixture.overrides.items.set(recoveryExportFixture.ref, clone(recoveryExportRecord.sourceOverride));
const recoveryExportItem = (await handler("core-seo-migration-plan")(route(exportInput(recoveryExportFixture.ref)), recoveryExportFixture.context)).items[0];
const recoveryDiscard = await discardWith(recoveryExportFixture, recoveryExportItem.fingerprint);
check(
	"a prepared handoff keeps its stored fingerprint, has no export and is never discarded",
	recoveryExportItem.fingerprint === `sha256-${"c".repeat(64)}` &&
		JSON.stringify(recoveryExportItem.snapshot) === JSON.stringify({ status: "refused", reason: "recovery-pending" }) &&
		recoveryDiscard.error === "recovery_pending" &&
		recoveryExportFixture.overrides.items.has(recoveryExportFixture.ref),
);

console.log(failures === 0 ? "\nALL SEO MIGRATION RUNTIME CHECKS PASSED" : `\n${failures} SEO MIGRATION RUNTIME CHECK(S) FAILED`);
if (failures > 0) throw new Error(`${failures} SEO migration runtime self-check(s) failed`);

function clone<T>(value: T): T {
	return value === undefined ? value : structuredClone(value);
}
