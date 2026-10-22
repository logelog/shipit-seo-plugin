import assert from "node:assert/strict";
import seoRuntime from "./sandbox-entry.ts";
import {
	CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	defaultSeoAdminSitemapValues,
	defaultSeoAdminTemplateSet,
	type SeoAdminModuleValues,
	type SeoAdminSchemaPresetValues,
} from "./admin-contract.ts";
import { defaultIndexNowSettings } from "./indexnow.ts";
import {
	GLOBAL_SETTINGS_KEY,
	buildAdminSettings,
	persistAdminSettings,
	resetAdminSettings,
	saveContentScoring,
	saveCustomVerificationTags,
} from "./settings-runtime.ts";
import { defaultSettingsValues, parseStoredSettings, storedSettingsValues } from "./settings-state.ts";
import {
	applySeoPortabilityBundleToState,
	createSeoPortabilityBundle,
	validateSeoPortabilityBundle,
	type SeoPortabilityState,
} from "./portability.ts";

const SITE = { siteName: "Example practice", siteUrl: "https://example.test" };
const TAGS = [{ name: "p:domain_verify", content: 'synthetic-123&"proof' }];
const OTHER = [{ name: "service-verification", content: "synthetic-other" }];
const clone = <T>(value: T): T => structuredClone(value);
let checks = 0;
function passed(label: string) { checks += 1; console.log("PASS " + label); }

function harness() {
	const values = new Map<string, unknown>();
	const revisions = new Map<string, string>();
	const reads: string[] = [];
	let sequence = 0;
	let casCalls = 0;
	let directWrites = 0;
	let beforeCas: (() => void) | undefined;
	let casMode: "normal" | "malformed" | "throw-after" = "normal";
	const seed = (key: string, value: unknown) => {
		values.set(key, clone(value));
		revisions.set(key, "r" + ++sequence);
	};
	const empty = { get: async () => null, query: async () => ({ items: [], hasMore: false }), count: async () => 0 };
	const context: any = {
		plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
		site: { name: SITE.siteName, url: SITE.siteUrl, locale: "en" },
		url: (path: string) => new URL(path, SITE.siteUrl).toString(),
		settings: { get: async () => null, getVersioned: async () => null },
		kv: {
			get: async (key: string) => { reads.push("get:" + key); return clone(values.get(key) ?? null); },
			getVersioned: async (key: string) => {
				reads.push("versioned:" + key);
				return values.has(key) ? { value: clone(values.get(key)), revision: revisions.get(key)! } : null;
			},
			set: async (key: string, value: unknown) => { directWrites += 1; seed(key, value); },
			compareAndSet: async (key: string, expected: string | null, value: unknown) => {
				casCalls += 1;
				const pending = beforeCas; beforeCas = undefined; pending?.();
				if ((revisions.get(key) ?? null) !== expected) return { applied: false };
				seed(key, value);
				if (casMode === "throw-after") throw new Error("lost settings acknowledgement");
				if (casMode === "malformed") return { applied: true, revision: 0 };
				return { applied: true, revision: revisions.get(key)! };
			},
		},
		storage: new Proxy({}, { get: () => empty }),
		schema: { listCollections: async () => [
			{ slug: "posts", label: "Posts", routable: true, hasSeo: true, urlPattern: "/posts/{slug}" },
			{ slug: "pages", label: "Pages", routable: true, hasSeo: true, urlPattern: "/{slug}" },
		] },
		content: {
			get: async (collection: string, id: string) => ({ id, slug: "example", locale: "en", status: "published", data: { title: collection + " example", excerpt: "Synthetic page description." }, seo: {} }),
			list: async () => ({ items: [], hasMore: false }),
		},
		log: { warn() {}, info() {}, error() {}, debug() {} },
	};
	return {
		context, values, reads, seed,
		get casCalls() { return casCalls; }, get directWrites() { return directWrites; },
		set beforeCas(value: (() => void) | undefined) { beforeCas = value; },
		set casMode(value: "normal" | "malformed" | "throw-after") { casMode = value; },
	};
}

function record(tags?: typeof TAGS) {
	return {
		version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-01T00:00:00.000Z",
		...defaultSettingsValues(SITE),
		contentScoringEnabled: false,
		contentScoringResourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
		...(tags === undefined ? {} : { customVerificationTags: clone(tags) }),
	};
}
function guard(settings: any) {
	return settings.revision === null
		? { expectedRevision: null, expectedLegacyGuard: settings.legacyGuard }
		: { expectedRevision: settings.revision };
}
function handler(name: string) {
	return (seoRuntime as any).routes[name].handler as (route: any, ctx: any) => Promise<any>;
}
function route(input: unknown) { return { input, request: { method: "POST", url: SITE.siteUrl + "/_emdash/api/plugins/shipit-seo/save-custom-verification-tags" } }; }
async function save(h: ReturnType<typeof harness>, tags: unknown) {
	const current = await buildAdminSettings(h.context);
	return saveCustomVerificationTags(h.context, { tags, ...guard(current) });
}
function withoutWriteFields(value: unknown) {
	const { updatedAt: _updatedAt, customVerificationTags: _tags, ...neighbors } = value as Record<string, unknown>;
	return neighbors;
}

const priorFetch = globalThis.fetch;
let externalAttempts = 0;
globalThis.fetch = async () => { externalAttempts += 1; throw new Error("No provider requests in custom verification checks"); };
try {
	const legacy = record();
	assert.ok(parseStoredSettings(legacy));
	assert.equal(Object.hasOwn(storedSettingsValues(legacy), "customVerificationTags"), false);
	assert.equal(Object.hasOwn(defaultSettingsValues(SITE), "customVerificationTags"), false);
	for (const invalid of [undefined, null, {}, [{ name: "P:Domain_verify", content: "code" }], [{ name: "robots", content: "none" }]])
		assert.equal(parseStoredSettings({ ...legacy, customVerificationTags: invalid }), null);
	assert.deepEqual(storedSettingsValues(record([])).customVerificationTags, []);
	passed("absent legacy objects stay absent; malformed and noncanonical stored tags fail closed");

	const fresh = harness();
	const initial = await buildAdminSettings(fresh.context);
	assert.equal(initial.state, "absent");
	assert.equal(fresh.casCalls, 0);
	assert.equal(fresh.directWrites, 0);
	assert.equal(Object.hasOwn(initial.values!, "customVerificationTags"), false);
	const created = await saveCustomVerificationTags(fresh.context, { tags: [{ name: " P:Domain_Verify ", content: ' synthetic-123&"proof ' }], ...guard(initial) });
	assert.ok(created.success);
	assert.deepEqual(created.settings.values.customVerificationTags, TAGS);
	assert.equal(created.settings.values.noindex, false);
	assert.equal(created.settings.contentScoring.state, "pending-confirmation");
	assert.equal(fresh.casCalls, 1);
	assert.equal(fresh.directWrites, 0);
	passed("guarded first save normalizes tags without activating analysis or changing indexing");

	const saved = harness();
	const existing = { ...record(), futureNeighbor: { keep: true } };
	saved.seed(GLOBAL_SETTINGS_KEY, existing);
	const changed = await save(saved, TAGS);
	assert.ok(changed.success);
	assert.deepEqual(withoutWriteFields(saved.values.get(GLOBAL_SETTINGS_KEY)), withoutWriteFields(existing));
	assert.deepEqual(changed.settings.values.customVerificationTags, TAGS);
	assert.equal(changed.settings.contentScoring.state, "paused");
	assert.equal(changed.settings.indexingPreferenceConfirmed, false);
	passed("narrow save preserves saved neighbors, confirmation ownership and resource acknowledgement");

	const beforeInvalid = clone(saved.values.get(GLOBAL_SETTINGS_KEY));
	const current = await buildAdminSettings(saved.context);
	for (const invalid of [
		{ tags: TAGS, ...guard(current), noindex: true },
		{ tags: [{ name: "google-site-verification", content: "code" }], ...guard(current) },
		{ tags: [{ name: "service-proof", content: "<script>" }], ...guard(current) },
		{ tags: TAGS },
	]) {
		const refused = await saveCustomVerificationTags(saved.context, invalid);
		assert.equal(refused.success, false);
	}
	assert.deepEqual(saved.values.get(GLOBAL_SETTINGS_KEY), beforeInvalid);
	assert.equal(saved.casCalls, 1);
	const descriptor = (seoRuntime as any).routes["save-custom-verification-tags"];
	assert.equal(descriptor.permission, "settings:manage");
	assert.deepEqual(descriptor.methods, ["POST"]);
	passed("narrow command rejects neighbor writes, reserved/markup values and missing guards before CAS");

	const omitted = { ...changed.settings.values, defaultSocialImage: "https://example.test/social.png" };
	delete omitted.customVerificationTags;
	const full = await handler("save-admin-settings")(route({ ...omitted, ...guard(await buildAdminSettings(saved.context)) }), saved.context);
	assert.ok(full.success);
	assert.deepEqual(full.settings.values.customVerificationTags, TAGS);
	assert.equal(full.settings.contentScoring.state, "paused");
	const cleared = await handler("save-admin-settings")(route({ ...full.settings.values, customVerificationTags: [], ...guard(full.settings) }), saved.context);
	assert.ok(cleared.success);
	assert.deepEqual(cleared.settings.values.customVerificationTags, []);
	assert.ok((await save(saved, TAGS)).success);
	assert.deepEqual((await save(saved, []) as any).settings.values.customVerificationTags, []);
	passed("full saves preserve omission while full and narrow explicit empty arrays remove tags");

	const conflict = harness();
	conflict.seed(GLOBAL_SETTINGS_KEY, record(TAGS));
	const loaded = await buildAdminSettings(conflict.context);
	conflict.beforeCas = () => conflict.seed(GLOBAL_SETTINGS_KEY, record(OTHER));
	const refused = await saveCustomVerificationTags(conflict.context, { tags: [], ...guard(loaded) });
	assert.ok(!refused.success && refused.conflict);
	assert.deepEqual((conflict.values.get(GLOBAL_SETTINGS_KEY) as any).customVerificationTags, OTHER);
	assert.equal(conflict.casCalls, 1);
	const stale = await saveCustomVerificationTags(conflict.context, { tags: TAGS, ...guard(loaded) });
	assert.ok(!stale.success && stale.conflict);
	assert.equal(conflict.casCalls, 1);
	passed("concurrent and already-stale global revisions preserve the winning tags without retry");

	const oldLegacy = harness();
	oldLegacy.seed("settings:siteName", "Legacy practice");
	oldLegacy.seed("settings:noindex", true);
	const loadedLegacy = await buildAdminSettings(oldLegacy.context);
	oldLegacy.seed("settings:siteName", "New legacy owner");
	const legacyConflict = await saveCustomVerificationTags(oldLegacy.context, { tags: TAGS, ...guard(loadedLegacy) });
	assert.ok(!legacyConflict.success && legacyConflict.conflict);
	assert.equal(oldLegacy.casCalls, 0);
	const adopted = await save(oldLegacy, TAGS);
	assert.ok(adopted.success);
	assert.equal(adopted.settings.values.siteName, "New legacy owner");
	assert.equal(adopted.settings.values.noindex, true);
	passed("legacy adoption uses the loaded legacy guard and retains its indexing preference");

	for (const mode of ["malformed", "throw-after"] as const) {
		const uncertain = harness();
		uncertain.seed(GLOBAL_SETTINGS_KEY, record());
		uncertain.casMode = mode;
		await assert.rejects(save(uncertain, TAGS));
		assert.equal(uncertain.casCalls, 1);
		assert.deepEqual((await buildAdminSettings(uncertain.context) as any).values.customVerificationTags, TAGS);
		assert.equal(uncertain.casCalls, 1);
	}
	passed("malformed or lost write acknowledgements remain errors and an explicit read recovers stored tags");

	const corrupt = harness();
	const corruptRecord = { ...record(), customVerificationTags: [{ name: "robots", content: "noindex" }] };
	corrupt.seed(GLOBAL_SETTINGS_KEY, corruptRecord);
	const corrupted = await buildAdminSettings(corrupt.context);
	assert.equal(corrupted.state, "corrupt");
	assert.equal((await save(corrupt, TAGS)).success, false);
	assert.equal(corrupt.casCalls, 0);
	assert.deepEqual(corrupt.values.get(GLOBAL_SETTINGS_KEY), corruptRecord);
	passed("corrupt current tags are not silently replaced");

	const historical = harness();
	historical.seed(GLOBAL_SETTINGS_KEY, {
		version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-08-01T00:00:00.000Z",
		siteName: "Shipit Digital", siteUrl: "", organizationName: "Shipit Digital", organizationLogo: "",
		socialProfiles: ["https://www.instagram.com/shipitdigital.nl/", "https://www.linkedin.com/company/shipitdigital/", "https://www.tiktok.com/@shipit.digital", "https://www.facebook.com/profile.php?id=61580257498746"],
		defaultSocialImage: "", twitterHandle: "", noindex: false,
		contentScoringResourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
	});
	const historicalBefore = await buildAdminSettings(historical.context);
	assert.equal(historicalBefore.state, "historical-seed");
	assert.equal(historicalBefore.values!.noindex, true);
	const historicalSaved = await save(historical, TAGS);
	assert.ok(historicalSaved.success);
	assert.equal(historicalSaved.settings.values.noindex, true);
	assert.deepEqual(historicalSaved.settings.values.customVerificationTags, TAGS);
	assert.equal(historicalSaved.settings.contentScoring.state, "enabled");
	assert.equal((await buildAdminSettings(historical.context) as any).values.noindex, true);
	passed("historical seed adoption preserves effective noindex and its existing acknowledgement");

	const preserved = harness();
	preserved.seed(GLOBAL_SETTINGS_KEY, record(TAGS));
	const reset = await resetAdminSettings(preserved.context, (await buildAdminSettings(preserved.context)).revision!);
	assert.ok(reset.success);
	assert.deepEqual(reset.settings.values.customVerificationTags, TAGS);
	assert.equal(reset.settings.contentScoring.state, "paused");
	const enabled = await saveContentScoring(preserved.context, {
		contentScoringEnabled: true, expectedContentScoringEnabled: false, ...guard(reset.settings),
		resourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION,
	});
	assert.ok(enabled.success);
	assert.deepEqual(enabled.settings.values.customVerificationTags, TAGS);
	passed("inherited-settings restore and analysis admission preserve custom tags");

	const state: SeoPortabilityState = {
		settings: clone(enabled.settings.values), sitemap: defaultSeoAdminSitemapValues(),
		modules: Object.fromEntries(SEO_ADMIN_MODULE_DEFINITIONS.map((item) => [item.key, item.defaultEnabled])) as SeoAdminModuleValues,
		schemaPresets: Object.fromEntries(SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((item) => [item.key, item.defaultEnabled])) as SeoAdminSchemaPresetValues,
		templates: defaultSeoAdminTemplateSet(), customSchemas: [], indexNow: defaultIndexNowSettings(), schemaContentTypes: {},
	};
	const exported = createSeoPortabilityBundle(state);
	assert.ok(validateSeoPortabilityBundle(exported).success);
	assert.deepEqual(exported.configuration.settings.customVerificationTags, TAGS);
	const oldBundle = clone(exported);
	delete oldBundle.configuration.settings.customVerificationTags;
	for (const mode of ["merge", "replace"] as const) {
		const next = applySeoPortabilityBundleToState(oldBundle, state, mode);
		assert.deepEqual(next.settings.customVerificationTags, TAGS);
		const explicit = clone(exported); explicit.configuration.settings.customVerificationTags = [];
		assert.deepEqual(applySeoPortabilityBundleToState(explicit, state, mode).settings.customVerificationTags, []);
	}
	const invalidBundle = clone(exported);
	invalidBundle.configuration.settings.customVerificationTags = [{ name: "description", content: "bad" }];
	assert.equal(validateSeoPortabilityBundle(invalidBundle).success, false);
	const absentState = clone(state); delete absentState.settings.customVerificationTags;
	assert.equal(Object.hasOwn(createSeoPortabilityBundle(absentState).configuration.settings, "customVerificationTags"), false);
	await persistAdminSettings(preserved.context, applySeoPortabilityBundleToState(oldBundle, state, "replace").settings);
	assert.deepEqual((await buildAdminSettings(preserved.context) as any).values.customVerificationTags, TAGS);
	assert.equal((await buildAdminSettings(preserved.context) as any).contentScoring.state, "pending-confirmation");
	passed("export/import carries tags, old bundles preserve them, explicit empty removes and admission remains local");

	const publicWithout = harness(); publicWithout.seed(GLOBAL_SETTINGS_KEY, record());
	const publicWith = harness(); publicWith.seed(GLOBAL_SETTINGS_KEY, record(TAGS));
	const publicHook = (seoRuntime as any).hooks["page:metadata"].handler;
	for (const collection of [null, "posts", "pages"]) {
		const page = {
			url: SITE.siteUrl + (collection ? "/example" : "/"), path: collection ? "/example" : "/", locale: "en", kind: collection ? "content" : "custom", pageType: collection === "posts" ? "article" : "website",
			title: "Example", pageTitle: "Example", description: "Synthetic description", canonical: SITE.siteUrl + (collection ? "/example" : "/"), seo: {}, siteName: SITE.siteName, siteUrl: SITE.siteUrl,
			...(collection ? { content: { collection, id: "entry", slug: "example" } } : {}),
		};
		publicWithout.reads.length = 0; publicWith.reads.length = 0;
		const plain = await publicHook({ page }, publicWithout.context);
		const tagged = await publicHook({ page }, publicWith.context);
		assert.ok(Array.isArray(plain) && Array.isArray(tagged), "public fixture must exercise the real metadata hook");
		assert.deepEqual(tagged.filter((item: any) => item.kind === "meta" && item.name === TAGS[0].name), [{ kind: "meta", ...TAGS[0] }]);
		assert.deepEqual(publicWith.reads, publicWithout.reads, "adding tags must not add public storage reads");
		assert.equal(publicWith.casCalls + publicWith.directWrites, 0);
	}
	const corruptPublic = await publicHook({ page: { url: SITE.siteUrl, path: "/", locale: "en", kind: "custom" } }, corrupt.context);
	assert.deepEqual(corruptPublic, []);
	passed("home/Post/Page emit typed tags through the existing read path with no writes or extra reads");

	assert.equal(externalAttempts, 0);
	passed("custom verification does not call providers");
} finally {
	globalThis.fetch = priorFetch;
}
console.log("Custom verification runtime checks passed: " + checks + " groups.");
