import assert from "node:assert/strict";
import { resolvePageMetadata, renderPageMetadata } from "emdash/page";
import { SEO_ADMIN_SETTINGS_STORAGE_VERSION, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import { createSeoEngine } from "./sandbox-entry.ts";
import { defaultSettingsValues } from "./settings-state.ts";
import {
	COEXISTENCE_PROFILES,
	COEXISTENCE_ROBOTS_KEY,
	classifyNativePluginInventory,
	unavailableCoexistenceInventory,
	type CoexistenceInventory,
} from "./plugin-coexistence.ts";
import { finalizeOwnMetadataContributions, markOwnMetadataContributions } from "./plugin-coexistence-metadata.ts";

const SITE = "https://example.com";
const TAGS = [{ name: "p:domain_verify", content: 'synthetic-proof&"one' }, { name: "custom-domain", content: "synthetic-two" }];
const LEGACY = "noarchive,ExampleRule:KeepOriginal";
const ID = "posts:fixture-entry";
const ALIAS = "posts:fixture-slug";
const clone = <T>(value: T): T => structuredClone(value);
let groups = 0;
const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
	try { await run(); groups += 1; console.log("PASS " + name); }
	catch (error) { failures.push(name); console.error("FAIL " + name, error); }
}
function observed(profileId: string, status: "active" | "inactive" = "active"): CoexistenceInventory {
	const profile = COEXISTENCE_PROFILES.find((candidate) => candidate.id === profileId)!;
	return classifyNativePluginInventory({ configured: [], rows: [{
		id: profile.runtimeId, source: "registry", version: profile.assessedVersion, status,
		publisherDid: profile.publisherDid, slug: profile.slug,
	}] });
}

function fixture(inventory: CoexistenceInventory | "throws" | null, options: {
	content?: boolean;
	noindex?: boolean;
	rows?: Array<[string, unknown]>;
	unreadable?: boolean;
	tags?: unknown;
} = {}) {
	const stats = { observations: 0, mutations: 0, network: 0, schedules: 0, legacyReads: [] as string[] };
	const settings = {
		version: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
		updatedAt: "2026-10-16T00:00:00.000Z",
		...defaultSettingsValues({ siteName: "Example practice", siteUrl: SITE }),
		indexingPreferenceConfirmed: true,
		noindex: options.noindex ?? false,
		customVerificationTags: options.tags ?? TAGS,
	};
	const rows = new Map(options.rows ?? []);
	const before = JSON.stringify({ settings, rows: [...rows] });
	const refuse = async () => { stats.mutations += 1; throw new Error("This metadata fixture forbids writes."); };
	const definition = { slug: "posts", label: "Posts", routable: true, hasSeo: true, hidden: false };
	const entry = {
		id: "fixture-entry", slug: "fixture-slug", status: "published", locale: "en",
		data: { title: "Fixture title", excerpt: "Fixture description" }, seo: { noIndex: false },
	};
	const ctx: any = {
		plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
		site: { url: SITE, name: "Example practice", locale: "en" },
		kv: {
			get: async () => null,
			getVersioned: async (key: string) => {
				if (key !== "settings:global:v1") return null;
				if (options.unreadable) throw new Error("Synthetic settings read failure");
				return { revision: "fixture-settings", value: clone(settings) };
			},
			set: refuse, delete: refuse, compareAndSet: refuse, compareAndDelete: refuse,
		},
		storage: new Proxy({}, { get: (_target, scope) => ({
			get: async (key: string) => {
				if (scope !== "overrides") return null;
				stats.legacyReads.push(key);
				return clone(rows.get(key) ?? null);
			},
			getMany: async () => new Map(), query: async () => ({ items: [], hasMore: false }), count: async () => 0,
			put: refuse, putMany: refuse, delete: refuse, deleteMany: refuse,
		}) }),
		content: {
			get: async () => options.content ? clone(entry) : null,
			getPublicUrl: async () => SITE + "/posts/fixture-slug",
			listCollections: async () => [definition],
		},
		schema: { getCollection: async () => definition, listCollections: async () => [definition] },
		settings: { get: async () => null, getVersioned: async () => null, getAll: async () => ({}) },
		http: { fetch: async () => { stats.network += 1; throw new Error("This fixture forbids provider requests."); } },
		cron: { schedule: async () => { stats.schedules += 1; throw new Error("This fixture forbids scheduling."); }, cancel: refuse },
		log: { warn() {}, info() {}, error() {} },
	};
	const engine = inventory === null ? createSeoEngine() : createSeoEngine(undefined, { coexistence: {
		observe: async () => {
			stats.observations += 1;
			if (inventory === "throws") throw new Error("Synthetic inventory failure");
			return clone(inventory);
		},
	} });
	const page: any = {
		url: SITE + "/posts/fixture-slug", path: "/posts/fixture-slug", locale: "en", kind: "content", pageType: "article",
		title: "Fixture title", pageTitle: "Fixture title", description: "Fixture description", canonical: SITE + "/posts/fixture-slug",
		image: null, siteName: "Example practice", siteUrl: SITE, seo: { robots: "index,follow" },
		content: { collection: "posts", id: "fixture-entry", slug: "fixture-slug" },
	};
	return {
		stats,
		async run(): Promise<any[]> {
			const result = await engine.hooks["page:metadata"].handler({ page }, ctx);
			assert.ok(Array.isArray(result));
			assert.equal(JSON.stringify({ settings, rows: [...rows] }), before);
			assert.deepEqual([stats.mutations, stats.network, stats.schedules], [0, 0, 0]);
			return result;
		},
	};
}

function verification(output: any[]) {
	return output.filter((value) => value.kind === "meta" && TAGS.some((tag) => tag.name === value.name))
		.map(({ name, content }) => ({ name, content }));
}
function restrictions(output: any[]): string {
	return output.filter((value) => value.kind === "meta" && value.name === "robots").map((value) => value.content).join(",");
}
function assertOrdinarySuppressed(output: any[]) {
	assert.ok(output.every((value) => value.kind === "meta" &&
		(value.name === "robots" || TAGS.some((tag) => tag.name === value.name))));
	const robots = output.filter((value) => value.kind === "meta" && value.name === "robots");
	assert.ok(robots.every((value) => value.key === COEXISTENCE_ROBOTS_KEY));
	assert.ok(!restrictions(output).split(",").includes("index"));
}
function assertLegacy(output: any[]) {
	const value = restrictions(output);
	for (const token of ["noindex", "nofollow", "noarchive", "ExampleRule:KeepOriginal"]) assert.ok(value.split(",").includes(token), token);
}

await check("unbound and inactive controls retain verification and ordinary metadata", async () => {
	for (const inventory of [null, observed("seo-suite", "inactive")]) {
		const h = fixture(inventory);
		const output = await h.run();
		assert.deepEqual(verification(output), TAGS);
		assert.ok(output.some((value) => value.kind === "meta" && value.name === "description"));
		assert.ok(output.some((value) => value.kind === "property" && value.property === "og:title"));
		assert.ok(output.some((value) => value.kind === "link" && value.rel === "canonical"));
		assert.ok(output.some((value) => value.kind === "jsonld"));
		assert.equal(h.stats.observations, inventory === null ? 0 : 1);
	}
});

await check("known metadata overlap retains exact verification contributions and suppresses ordinary output", async () => {
	const h = fixture(observed("seo-suite"), { noindex: true });
	const output = await h.run();
	assert.deepEqual(verification(output), TAGS);
	assertOrdinarySuppressed(output);
	assert.equal(restrictions(output), "noindex,nofollow");
	assert.equal(h.stats.observations, 1);
});

await check("finalization yields only the matching verification name in both peer orders", async () => {
	const output = await fixture(observed("seo-suite"), { noindex: true }).run();
	assert.deepEqual(verification(output), TAGS);
	markOwnMetadataContributions(output);
	const peer = Object.freeze({ kind: "meta", name: "P:DOMAIN_VERIFY", content: "peer-proof", key: "peer-verification" });
	for (const raw of [[peer, ...output], [...output, peer]]) {
		const before = JSON.stringify(raw);
		const finalized = finalizeOwnMetadataContributions(raw, "index,follow");
		assert.deepEqual(verification(finalized), [TAGS[1]]);
		assert.ok(finalized.includes(peer));
		assert.equal(JSON.stringify(raw), before);
		const resolved = resolvePageMetadata(finalized as any);
		assert.equal(resolved.meta.filter((value) => value.name.toLowerCase() === TAGS[0]!.name).length, 1);
		assert.equal(resolved.meta.find((value) => value.name === TAGS[1]!.name)?.content, TAGS[1]!.content);
		assert.match(renderPageMetadata(resolved), /noindex,nofollow/);
	}
});

await check("unavailable or throwing inventory preserves suppression and readable restrictions", async () => {
	for (const inventory of [unavailableCoexistenceInventory(), "throws" as const]) {
		const h = fixture(inventory, { noindex: true, rows: [[ID, { robots: LEGACY }]] });
		const output = await h.run();
		assert.deepEqual(verification(output), []);
		assertOrdinarySuppressed(output);
		assertLegacy(output);
		assert.deepEqual(h.stats.legacyReads, [ID]);
		assert.equal(h.stats.observations, 1);
	}
});

await check("content-ID resolution carries raw legacy rules under site noindex without another read", async () => {
	const h = fixture(observed("seo-suite"), { content: true, noindex: true, rows: [[ID, { ref: ID, robots: LEGACY }]] });
	const output = await h.run();
	assertLegacy(output);
	assertOrdinarySuppressed(output);
	assert.deepEqual(verification(output), TAGS);
	assert.deepEqual(h.stats.legacyReads, [ID]);
});

await check("content alias resolution carries only the selected already-read raw row", async () => {
	const h = fixture(observed("seo-suite"), { content: true, noindex: true, rows: [[ALIAS, { ref: ALIAS, robots: LEGACY }]] });
	assertLegacy(await h.run());
	assert.deepEqual(h.stats.legacyReads, [ID, ALIAS]);
});

await check("fallback resolution retains raw legacy rules under site noindex for ID and alias", async () => {
	for (const key of [ID, ALIAS]) {
		const h = fixture(observed("seo-suite"), { noindex: true, rows: [[key, { ref: key, robots: LEGACY }]] });
		assertLegacy(await h.run());
		assert.deepEqual(h.stats.legacyReads, key === ID ? [ID] : [ID, ALIAS]);
	}
});

await check("malformed present and final absent overrides do not invent an alias fallback or retained rules", async () => {
	for (const content of [false, true]) {
		for (const value of ["malformed-present", {}, []]) {
			const h = fixture(observed("seo-suite"), { content, noindex: true, rows: [[ID, value], [ALIAS, { robots: LEGACY }]] });
			assert.equal(restrictions(await h.run()), "noindex,nofollow");
			assert.deepEqual(h.stats.legacyReads, [ID]);
		}
		const absent = fixture(observed("seo-suite"), { content, noindex: true });
		assert.equal(restrictions(await absent.run()), "noindex,nofollow");
		assert.deepEqual(absent.stats.legacyReads, [ID, ALIAS]);
	}
});

await check("a robots-and-schema peer retains ordinary metadata plus original unknown legacy rules", async () => {
	const h = fixture(observed("moorage-seo"), { content: true, noindex: true, rows: [[ID, { robots: LEGACY }]] });
	const output = await h.run();
	assertLegacy(output);
	assert.deepEqual(verification(output), TAGS);
	assert.ok(output.some((value) => value.kind === "meta" && value.name === "description"));
	assert.equal(output.some((value) => value.kind === "jsonld"), false);
	assert.deepEqual(h.stats.legacyReads, [ID]);
});

await check("unreadable settings and a reserved-name tag never permit ordinary metadata as verification", async () => {
	for (const options of [{ unreadable: true }, { tags: [{ name: "description", content: "not-a-verification-tag" }] }]) {
		const h = fixture(observed("seo-suite"), options);
		assert.deepEqual(await h.run(), []);
		assert.equal(h.stats.observations, 0);
		assert.deepEqual(h.stats.legacyReads, []);
	}
});

assert.deepEqual(failures, [], "Failed metadata carry groups");
console.log(`Metadata verification and robots carry: ${groups} groups passed; synthetic contexts, no external requests or writes.`);
