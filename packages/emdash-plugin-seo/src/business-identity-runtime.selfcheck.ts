import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";

import {
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	SEO_ENGINE_VERSION,
} from "./admin-contract.ts";
import { BUSINESS_IDENTITY_KV_KEY } from "./business-identity.ts";
import { readAnalysisRuntimeConfig } from "./entry-analysis-runtime.ts";
import { defaultSeoSchemaComposerInput } from "./schema-composer.ts";
import seoRuntime from "./sandbox-entry.ts";

const SITE = "https://example.com";
const values = new Map<string, unknown>([
	["settings:siteName", "Harbour Bakery"],
	["settings:siteUrl", SITE],
	["settings:orgName", "Harbour Bakery"],
	["settings:noindex", false],
]);
const revisions = new Map<string, string>();
let counter = 0;
let failNextWrite: "after" | null = null;
const bump = (key: string) => {
	const revision = `r${++counter}`;
	revisions.set(key, revision);
	return revision;
};
const revisionOf = (key: string) => (values.has(key) ? revisions.get(key) ?? bump(key) : null);
const customSchemas = new Map<string, unknown>();
const metaOverrides = new Map<string, unknown>();
const contentItems = new Map<string, any>([
	["pages:about-id", { id: "about-id", slug: "about", status: "published", locale: "en", data: { title: "About us" }, seo: null, updatedAt: "2026-09-01T10:00:00.000Z" }],
	["pages:home-id", { id: "home-id", slug: "welcome", status: "published", locale: "en", data: { title: "Welcome" }, seo: { canonical: `${SITE}/` }, updatedAt: "2026-09-01T10:00:00.000Z" }],
	["pages:draft-id", { id: "draft-id", slug: "draft", status: "draft", locale: "en", data: { title: "Draft" }, seo: null, updatedAt: "2026-09-01T10:00:00.000Z" }],
	["posts:post-1", { id: "post-1", slug: "fresh-bread", status: "published", locale: "en", data: { title: "Fresh bread" }, seo: null, updatedAt: "2026-09-02T10:00:00.000Z" }],
	["services:service-1", { id: "service-1", slug: "catering", status: "published", locale: "en", data: { title: "Catering" }, seo: null, updatedAt: "2026-09-03T10:00:00.000Z" }],
]);
const mapStore = (map: Map<string, unknown>) => {
	const rowRevisions = new Map<string, string>();
	let rowCounter = 0;
	const current = (id: string) => map.has(id) ? rowRevisions.get(id) ?? `seed:${id}` : null;
	const put = async (id: string, value: unknown) => {
		map.set(id, structuredClone(value));
		const revision = `row-${++rowCounter}`;
		rowRevisions.set(id, revision);
		return revision;
	};
	return {
		get: async (id: string) => structuredClone(map.get(id) ?? null),
		put,
		delete: async (id: string) => { rowRevisions.delete(id); return map.delete(id); },
		getVersioned: async (id: string) => {
			const revision = current(id);
			return revision === null ? null : { value: structuredClone(map.get(id)), revision };
		},
		compareAndSet: async (id: string, expected: string | null, value: unknown) => {
			if (current(id) !== expected) return { applied: false };
			return { applied: true, revision: await put(id, value) };
		},
		compareAndDelete: async (id: string, expected: string) => {
			if (current(id) !== expected) return { applied: false };
			map.delete(id); rowRevisions.delete(id);
			return { applied: true };
		},
	};
};

const versionedKv = {
	get: async (key: string) => structuredClone(values.get(key) ?? null),
	set: async (key: string, value: unknown) => {
		values.set(key, structuredClone(value));
		bump(key);
	},
	delete: async (key: string) => {
		revisions.delete(key);
		return values.delete(key);
	},
	list: async () => [],
	getVersioned: async (key: string) => {
		const revision = revisionOf(key);
		return revision === null ? null : { value: structuredClone(values.get(key)), revision };
	},
	compareAndSet: async (key: string, expected: string | null, value: unknown) => {
		if (revisionOf(key) !== expected) return { applied: false as const };
		values.set(key, structuredClone(value));
		const revision = bump(key);
		if (failNextWrite === "after") {
			failNextWrite = null;
			throw new Error("connection reset after commit");
		}
		return { applied: true as const, revision };
	},
	compareAndDelete: async (key: string, expected: string) => {
		if (revisionOf(key) !== expected) return { applied: false };
		values.delete(key);
		revisions.delete(key);
		return { applied: true };
	},
};
const context: any = {
	plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION },
	site: { name: "Harbour Bakery", url: SITE, locale: "en" },
	schema: { listCollections: async () => [
		{ slug: "pages", label: "Pages", hasSeo: true, routable: true, urlPattern: "/{slug}" },
		{ slug: "posts", label: "Posts", hasSeo: true, routable: true, urlPattern: "/blog/{slug}" },
		{ slug: "services", label: "Services", hasSeo: true, routable: true, urlPattern: "/services/{slug}" },
	] },
	kv: versionedKv,
	storage: {
		overrides: mapStore(new Map()),
		socialOverrides: mapStore(new Map()),
		metaOverrides: mapStore(metaOverrides),
		schemas: {
			...mapStore(customSchemas),
			count: async () => customSchemas.size,
			query: async () => ({
				items: [...customSchemas.entries()].map(([id, data]) => ({ id, data: structuredClone(data) })),
				hasMore: false,
				cursor: undefined,
			}),
		},
	},
	content: {
		getPublicUrl: async (collection: string, id: string) => {
			const item = contentItems.get(`${collection}:${id}`);
			if (!item || item.status !== "published") return null;
			const prefix = ({ pages: "", posts: "blog/", services: "services/" } as Record<string, string>)[collection];
			return `${SITE}/${prefix}${item.slug}`;
		},
		get: async (collection: string, id: string) => structuredClone(contentItems.get(`${collection}:${id}`) ?? null),
		list: async (collection: string, options: any = {}) => ({
			items: [...contentItems.entries()]
				.filter(([key, item]) => key.startsWith(`${collection}:`) && (!options.where?.status || item.status === options.where.status))
				.map(([, item]) => structuredClone(item))
				.slice(0, options.limit ?? 100),
			hasMore: false,
			cursor: undefined,
		}),
	},
	url: (path: string) => new URL(path, SITE).href,
	log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
};

const route = (name: string) => (input: unknown) => (seoRuntime as any).routes[name].handler({ input }, context);
// Full settings saves name the snapshot they were loaded from.
const settingsGuard = async () => {
	const loaded = await route("admin-settings")({});
	return loaded.revision === null
		? { expectedRevision: null, expectedLegacyGuard: loaded.legacyGuard }
		: { expectedRevision: loaded.revision };
};
const hook = async (page: PublicPageContext, ctx = context) => (seoRuntime as any).hooks["page:metadata"].handler({ page }, ctx);
const jsonld = (contributions: any[]) => contributions.filter((item) => item.kind === "jsonld");
const graphOf = (contributions: any[], id: string) => jsonld(contributions).find((item) => item.id === id)?.graph;
const nonSchema = (contributions: any[]) => JSON.stringify(contributions.filter((item) => item.kind !== "jsonld"));

function page(path: string, content?: { collection: string; id: string; slug: string }, pageType = "website"): PublicPageContext {
	return {
		url: `${SITE}${path}`,
		path,
		locale: null,
		kind: content ? "content" : "custom",
		pageType,
		title: content?.slug ?? "Home",
		pageTitle: content?.slug ?? "Home",
		description: "",
		canonical: `${SITE}${path}`,
		image: null,
		...(content ? { content } : {}),
		seo: {},
		siteName: "Harbour Bakery",
		siteUrl: SITE,
	} as PublicPageContext;
}
const home = page("/");
const about = page("/about", { collection: "pages", id: "about-id", slug: "about" });
const post = page("/blog/fresh-bread", { collection: "posts", id: "post-1", slug: "fresh-bread" }, "article");
const service = page("/services/catering", { collection: "services", id: "service-1", slug: "catering" });
values.set("configuration:schema-content-types:v1", { version: 1, updatedAt: "2026-09-01T00:00:00.000Z", values: { services: "service" } });
customSchemas.set("course", {
	storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	name: "Baking course",
	scope: "global",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Course", "@id": "{{canonical}}#course", name: "Baking", provider: { "@id": "{{siteUrl}}/#organization" } }),
	enabled: true,
	createdAt: "2026-09-01T00:00:00.000Z",
	updatedAt: "2026-09-01T00:00:00.000Z",
});

// ---- Absent: the legacy publisher, unchanged ----
const pages = [home, about, post, service];
const absent = await Promise.all(pages.map((item) => hook(item)));
const absentFingerprint = (await readAnalysisRuntimeConfig(context)).fingerprint;
assert.equal(graphOf(absent[0], "preset:organization")?.["@id"], `${SITE}/#organization`);
assert.equal(values.has(BUSINESS_IDENTITY_KV_KEY), false, "rendering never writes");

for (const name of ["admin-business-identity", "preview-business-identity", "save-business-identity", "set-business-identity-active", "transition-business-identity-entity", "admin-business-identity-pages"]) {
	assert.equal((seoRuntime as any).routes[name].permission, "plugins:manage", `${name} is Admin-only`);
}

// ---- Adoption of a restaurant on the About page ----
const restaurant = {
	kind: "LocalBusiness",
	businessType: "Restaurant",
	name: "Harbour Bakery",
	telephone: "+31 20 123 4567",
	contactPoints: [],
	sameAs: [],
	address: { streetAddress: "Kade 1", addressLocality: "Amsterdam", addressCountry: "NL" },
	areaServed: [],
	location: {
		geo: { latitude: "52.37403", longitude: "4.88969" },
		hours: { mode: "weekly", days: {
			Monday: { state: "periods", periods: [{ opens: "09:07", closes: "17:00" }] },
			Tuesday: { state: "closed" }, Wednesday: { state: "unknown" }, Thursday: { state: "unknown" },
			Friday: { state: "unknown" }, Saturday: { state: "unknown" }, Sunday: { state: "open24" },
		} },
	},
	restaurant: { servesCuisine: ["Dutch"], acceptsReservations: true },
	target: { kind: "content", collection: "pages", entryId: "about-id", locale: "en", title: "About us" },
};
const view = await route("admin-business-identity")({});
assert.equal(view.identity.state, "absent");
assert.equal(view.identity.legacy.entityId, `${SITE}/#organization`);
const pageList = await route("admin-business-identity-pages")({ collection: "pages", limit: 25 });
assert.deepEqual(pageList.items.map((item: any) => item.entryId), ["about-id", "home-id"], "only published entries are offered");
const draftTarget = await route("save-business-identity")({ document: { ...restaurant, target: { ...restaurant.target, entryId: "draft-id" } }, expectedRevision: null });
assert.equal(draftTarget.success, false);
const adopted = await route("save-business-identity")({ document: restaurant, expectedRevision: null });
assert.equal(adopted.success, true, JSON.stringify(adopted));
const stored = values.get(BUSINESS_IDENTITY_KV_KEY) as any;
assert.equal(stored.entityId, `${SITE}/#organization`, "the stored ID is the publisher ID emitted before adoption");
assert.equal(stored.active, true);

const active = await Promise.all(pages.map((item) => hook(item)));
const aboutPublisher = graphOf(active[1], "preset:organization");
assert.equal(aboutPublisher["@type"], "Restaurant");
assert.equal(aboutPublisher.telephone, "+31 20 123 4567");
assert.deepEqual(aboutPublisher.openingHoursSpecification[0], { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday"], opens: "09:07:00", closes: "17:00:00" });
for (const [index, label] of [[0, "home"], [2, "post"], [3, "service"]] as const) {
	const publisher = graphOf(active[index], "preset:organization");
	assert.equal(publisher["@type"], "Organization", `${label} types the business as its organization`);
	assert.equal(publisher["@id"], `${SITE}/#organization`, `${label} keeps the same ID`);
	for (const key of ["telephone", "address", "geo", "openingHoursSpecification", "contactPoint"]) {
		assert.ok(!JSON.stringify(jsonld(active[index])).includes(`"${key}"`), `${label} carries no ${key}`);
	}
	assert.equal(nonSchema(active[index]), nonSchema(absent[index]), `${label} keeps unrelated metadata`);
}
assert.deepEqual(graphOf(active[3], "preset:service").provider, { "@id": `${SITE}/#organization` });
assert.deepEqual(graphOf(active[2], "custom:course").provider, { "@id": `${SITE}/#organization` }, "custom references link to the identity");
const activeFingerprint = (await readAnalysisRuntimeConfig(context)).fingerprint;
assert.notEqual(activeFingerprint, absentFingerprint);
values.set(BUSINESS_IDENTITY_KV_KEY, { ...stored, name: "Harbour Bakery Amsterdam" });
assert.notEqual((await readAnalysisRuntimeConfig(context)).fingerprint, activeFingerprint, "a fact change with the same update time changes the fingerprint");
values.set(BUSINESS_IDENTITY_KV_KEY, stored);

// ---- Entry disables the publisher: inline minimal shape only ----
metaOverrides.set("services:service-1", {
	storageVersion: SEO_ADMIN_META_OVERRIDE_STORAGE_VERSION,
	ref: "services:service-1",
	robots: { nofollow: false, noarchive: false, nosnippet: false, noimageindex: false, notranslate: false },
	disabledPresets: ["organization"],
	updatedAt: "2026-09-04T00:00:00.000Z",
});
const disabledService = await hook(service);
assert.equal(graphOf(disabledService, "preset:organization"), undefined);
const inlineProvider = graphOf(disabledService, "preset:service").provider;
assert.equal(inlineProvider["@type"], "Organization");
assert.ok(!("telephone" in inlineProvider) && !("@id" in inlineProvider) && !("address" in inlineProvider));
metaOverrides.clear();

// ---- Write guards while active ----
const ownedDefinition = { "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "Old" };
const rawSave = await route("save-admin-custom-schema")({ id: "identity-schema-1", expectedRevision: null, name: "Old org", scope: "global", json: JSON.stringify(ownedDefinition), enabled: true });
assert.equal(rawSave.success, false, "a raw save defining the identity's ID is refused");
assert.equal((await route("save-admin-custom-schema")({ id: "identity-schema-2", expectedRevision: null, name: "Old org off", scope: "global", json: JSON.stringify(ownedDefinition), enabled: false })).success, true, "it may be saved turned off");
const canonicalOwner = JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{canonical}}#organization", name: "Old" });
assert.equal((await route("save-admin-custom-schema")({ id: "identity-schema-3", expectedRevision: null, name: "Per post", scope: "posts", json: canonicalOwner, enabled: true })).success, true, "a per-entry entity on other pages is a different entity");
const rootEntry = await route("save-admin-custom-schema")({ id: "identity-schema-4", expectedRevision: null, name: "Root page", scope: "pages:home-id", json: canonicalOwner, enabled: true });
assert.equal(rootEntry.success, false, "an entry whose canonical is the site root resolves to the identity's ID");
const slugScope = await route("save-admin-custom-schema")({ id: "identity-schema-5", expectedRevision: null, name: "By slug", scope: "pages:welcome", json: canonicalOwner, enabled: true });
assert.equal(slugScope.success, false, "a slug scope cannot be resolved without a scan, so it fails closed");
const courseFixture = customSchemas.get("course");
customSchemas.delete("course");
const composed = await route("compose-admin-schema")({ ...defaultSeoSchemaComposerInput("course"), id: "identity-course", expectedRevision: null, schemaName: "Course", scope: "global", enabled: true });
assert.equal(composed.success, true, `a composed schema that references the identity passes the same guard: ${JSON.stringify(composed.errors)}`);
customSchemas.delete(composed.schema.id);
customSchemas.set("course", courseFixture);
const settingsChange = await route("save-admin-settings")({ siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "organization", organizationName: "Changed", organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false , ...await settingsGuard() });
assert.equal(settingsChange.success, false, "legacy publisher fields are read-only while active");
const siteNameChange = await route("save-admin-settings")({ siteName: "Harbour Bakery NL", siteUrl: SITE, publisherType: "organization", organizationName: "Harbour Bakery", organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false , ...await settingsGuard() });
assert.equal(siteNameChange.success, true, "the site name keeps its own save");
values.delete("settings:global:v1");

// ---- Race: a custom record defines the owned ID anyway ----
customSchemas.set("race-literal", {
	storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION, name: "Race literal", scope: "posts",
	json: JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", "@id": `${SITE}#organization`, name: "Old" }, { "@type": "Event", "@id": `${SITE}/e#event`, name: "Tasting", organizer: { "@id": `${SITE}#organization` } }] }),
	enabled: true, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
});
const raced = await hook(post);
assert.equal(JSON.stringify(graphOf(raced, "custom:race-literal")), JSON.stringify(JSON.parse((customSchemas.get("race-literal") as any).json)), "the custom graph is kept exactly, its own reference included");
assert.equal(graphOf(raced, "preset:organization"), undefined, "the identity publisher is left off that page");
assert.ok(!JSON.stringify(jsonld(raced)).includes('"publisher"'), "and no preset carries publisher facts there");
customSchemas.set("race-nested", {
	storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION, name: "Race nested", scope: "posts",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE}/#organization`, name: "Old", employee: { "@type": "Person", name: "Jane" } }),
	enabled: true, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z",
});
const unsafe = await hook(post);
assert.equal(graphOf(unsafe, "preset:organization"), undefined, "a nested custom definition also leaves the identity publisher off that page");
assert.equal(graphOf(unsafe, "custom:race-nested").employee.name, "Jane", "and keeps the custom graph");
assert.ok(graphOf(await hook(home), "preset:organization"), "other pages keep the publisher");
customSchemas.delete("race-literal");
customSchemas.delete("race-nested");

// ---- Unknown write outcome ----
const loaded = await route("admin-business-identity")({});
failNextWrite = "after";
const lost = await route("save-business-identity")({ document: { ...restaurant, priceRange: "$$" }, expectedRevision: loaded.identity.revision });
assert.equal(lost.error, "unconfirmed");
const checked = await route("admin-business-identity")({ check: { intended: lost.intended, loaded: loaded.identity.record } });
assert.equal(checked.check, "matches_requested");

// ---- Deactivation resumes the legacy publisher exactly ----
const beforeOff = await route("admin-business-identity")({});
const off = await route("set-business-identity-active")({ active: false, expectedRevision: beforeOff.identity.revision, confirmed: true });
assert.equal(off.success, true);
for (const id of [...customSchemas.keys()]) if (id !== "course") customSchemas.delete(id);
const inactive = await Promise.all(pages.map((item) => hook(item)));
assert.equal(JSON.stringify(inactive), JSON.stringify(absent), "an inactive identity leaves the legacy output unchanged");
assert.equal((await readAnalysisRuntimeConfig(context)).fingerprint === absentFingerprint, false, "a stored inactive record is still part of the analysis fingerprint");
assert.equal((values.get(BUSINESS_IDENTITY_KV_KEY) as any).priceRange, "$$", "deactivation keeps the facts");
const allowed = await route("save-admin-settings")({ siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "organization", organizationName: "Harbour Bakery", organizationLogo: "", socialProfiles: ["https://social.example/hb"], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false , ...await settingsGuard() });
assert.equal(allowed.success, true, "legacy publisher fields are editable while inactive");
values.delete("settings:global:v1");

// ---- Fail closed: invalid, stored null, unreadable, no versioned read ----
for (const [label, setup] of [
	["invalid", () => values.set(BUSINESS_IDENTITY_KV_KEY, { ...stored, version: 9 })],
	["stored null", () => values.set(BUSINESS_IDENTITY_KV_KEY, null)],
] as const) {
	setup();
	const failed = await Promise.all([hook(home), hook(post), hook(service)]);
	for (const contributions of failed) {
		assert.equal(graphOf(contributions, "preset:organization"), undefined, `${label}: no publisher`);
		const json = JSON.stringify(jsonld(contributions));
		assert.ok(!json.includes('"publisher"') && !json.includes('"provider":{"@type"'), `${label}: no publisher links or expansion`);
	}
	assert.equal(graphOf(failed[1], "custom:course").provider["@id"], `${SITE}/#organization`, `${label}: references stay bare`);
	assert.equal(nonSchema(failed[1]), nonSchema(await hook(post)), `${label}: other metadata unchanged`);
	assert.equal((await route("save-admin-settings")({ siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "person", organizationName: "Harbour Bakery", organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false , ...await settingsGuard() })).success, false, `${label}: legacy publisher stays read-only`);
}
const oldHost = { ...context, kv: { get: versionedKv.get, set: versionedKv.set, delete: versionedKv.delete, list: versionedKv.list } };
values.delete(BUSINESS_IDENTITY_KV_KEY);
assert.equal(graphOf(await hook(home, oldHost), "preset:organization"), undefined, "without a versioned read the identity cannot be shown absent, so output fails closed");
const throwing = { ...context, kv: { ...versionedKv, getVersioned: async (key: string) => {
	if (key === BUSINESS_IDENTITY_KV_KEY) throw new Error("database is locked");
	return versionedKv.getVersioned(key);
} } };
assert.equal(graphOf(await hook(home, throwing), "preset:organization"), undefined, "an unreadable identity fails closed");
assert.equal(JSON.stringify(await Promise.all(pages.map((item) => hook(item)))), JSON.stringify(absent), "absent again: legacy output");
assert.equal((await readAnalysisRuntimeConfig(context)).fingerprint, absentFingerprint, "absent again: the fingerprint is unchanged");

// ---- Publisher ownership: one policy for legacy and business output ----
const OWNERSHIP_KEY = "configuration:publisher-ownership:v1";
for (const name of ["admin-publisher-ownership", "save-admin-publisher-ownership"]) {
	assert.equal((seoRuntime as any).routes[name].permission, "plugins:manage", `${name} is Admin-only`);
}
const ownershipRead = await route("admin-publisher-ownership")({});
assert.deepEqual([ownershipRead.ownership.state, ownershipRead.ownership.effective, ownershipRead.ownership.revision], ["absent", "automatic", null]);
assert.equal(values.has(OWNERSHIP_KEY), false, "reading writes no default");
const legacyOwner = {
	storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION, name: "Theme organization", scope: "global",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "Harbour Bakery BV", legalName: "Harbour Bakery BV" }),
	enabled: true, createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
};
customSchemas.set("legacy-owner", legacyOwner);
const legacyCollision = await hook(home);
assert.equal(graphOf(legacyCollision, "preset:organization"), undefined, "legacy path: a custom definition leaves the automatic publisher off");
assert.equal(graphOf(legacyCollision, "custom:legacy-owner").legalName, "Harbour Bakery BV", "legacy path: the custom graph survives instead of being dropped");
assert.ok(!JSON.stringify(jsonld(legacyCollision)).includes('"publisher"'), "legacy path: no generated publisher links or facts");
customSchemas.delete("legacy-owner");
assert.equal(JSON.stringify(await Promise.all(pages.map((item) => hook(item)))), JSON.stringify(absent), "without that custom graph the legacy output is unchanged");

const turnedOff = await route("save-admin-publisher-ownership")({ mode: "none", expectedRevision: null });
assert.equal(turnedOff.success, true, JSON.stringify(turnedOff));
assert.equal(turnedOff.contractVersion, ownershipRead.contractVersion);
assert.deepEqual(values.get(OWNERSHIP_KEY), { version: 1, mode: "none" });
const offPages = await Promise.all(pages.map((item) => hook(item)));
for (const [index, contributions] of offPages.entries()) {
	assert.equal(graphOf(contributions, "preset:organization"), undefined, `off: no publisher on page ${index}`);
	assert.ok(!JSON.stringify(jsonld(contributions)).includes('"publisher"'), `off: no publisher link on page ${index}`);
	assert.equal(nonSchema(contributions), nonSchema(absent[index]), `off: other metadata unchanged on page ${index}`);
}
assert.ok(!("provider" in graphOf(offPages[3], "preset:service")), "off: no service provider");
assert.equal(JSON.stringify(graphOf(offPages[2], "custom:course").provider), JSON.stringify({ "@id": `${SITE}/#organization` }), "off: an authored reference stays as written");
assert.equal(graphOf(offPages[0], "primary")?.name ?? graphOf(offPages[0], "preset:website")?.name, "Harbour Bakery", "off: website name output is unchanged");
const offFingerprint = (await readAnalysisRuntimeConfig(context)).fingerprint;
assert.notEqual(offFingerprint, absentFingerprint, "the opt-out is part of the analysis fingerprint");
const offStaleRevision = await route("save-admin-publisher-ownership")({ mode: "automatic", expectedRevision: null });
assert.equal(offStaleRevision.error, "conflict", "a stale revision changes nothing");

// Only a valid opt-out relaxes owned-ID guards.
const offIdentity = await route("save-business-identity")({ document: restaurant, expectedRevision: (await route("admin-business-identity")({})).identity.revision });
assert.equal(offIdentity.success, true, "the identity can be saved and stays retained while output is off");
const ownerWhileOff = await route("save-admin-custom-schema")({ id: "identity-schema-6", expectedRevision: null, name: "Custom owner", scope: "global", json: JSON.stringify(ownedDefinition), enabled: true });
assert.equal(ownerWhileOff.success, true, `a custom graph may own the ID while automatic output is off: ${JSON.stringify(ownerWhileOff.errors)}`);
const offWithOwner = await hook(home);
assert.equal(graphOf(offWithOwner, `custom:${ownerWhileOff.schema.id}`)?.name, "Old", "off: the owning custom graph is emitted");
assert.equal(graphOf(offWithOwner, "preset:organization"), undefined);
const offView = await route("admin-business-identity")({});
assert.equal(offView.identity.publisherOutput, "none");
assert.ok(offView.identity.notices.some((notice: any) => notice.code === "automatic-off"));

// Returning to automatic output: bounded site-wide check, refusal keeps the opt-out.
const offRevision = (await route("admin-publisher-ownership")({})).ownership.revision;
const refusedReturn = await route("save-admin-publisher-ownership")({ mode: "automatic", expectedRevision: offRevision });
assert.equal(refusedReturn.error, "preflight");
assert.equal(refusedReturn.preflight.reason, "collision");
assert.equal(refusedReturn.preflight.source, "business");
assert.deepEqual(refusedReturn.preflight.definitions.map((item: any) => item.id), [ownerWhileOff.schema.id]);
assert.deepEqual(values.get(OWNERSHIP_KEY), { version: 1, mode: "none" }, "the refused return keeps the stored opt-out");
customSchemas.delete(ownerWhileOff.schema.id);
const accepted = await route("save-admin-publisher-ownership")({ mode: "automatic", expectedRevision: offRevision });
assert.equal(accepted.success, true, JSON.stringify(accepted));
assert.equal(accepted.preflight.status, "clear");
assert.deepEqual(values.get(OWNERSHIP_KEY), { version: 1, mode: "automatic" }, "automatic mode is an explicit record");
assert.equal(graphOf(await hook(about), "preset:organization")["@type"], "Restaurant", "the identity publisher resumes");
assert.equal((await route("save-admin-custom-schema")({ id: "identity-schema-7", expectedRevision: null, name: "Owner again", scope: "global", json: JSON.stringify(ownedDefinition), enabled: true })).success, false, "the guard applies again");

// A content-specific definition outside the preflight is preserved when the page renders.
customSchemas.set("post-owner", {
	storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION, name: "Post owner", scope: "posts:post-1",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE}/#organization`, name: "Owner", founder: { "@type": "Person", "@id": `${SITE}/#person`, name: "Jane" } }),
	enabled: true, createdAt: "2026-09-07T00:00:00.000Z", updatedAt: "2026-09-07T00:00:00.000Z",
});
const postOwner = await hook(post);
assert.equal(graphOf(postOwner, "custom:post-owner").founder.name, "Jane", "the content-specific graph survives");
assert.equal(graphOf(postOwner, "preset:organization"), undefined);
assert.ok(graphOf(await hook(home), "preset:organization"), "other pages keep the automatic publisher");
customSchemas.delete("post-owner");

// Person preset on a root canonical page yields to a nested custom Person, in both modes.
const presetValues = Object.fromEntries(SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => [definition.key, definition.key === "person" ? true : definition.defaultEnabled]));
values.set("configuration:schema-presets:v2", { version: 2, updatedAt: "2026-09-08T00:00:00.000Z", values: presetValues });
contentItems.set("pages:home-id", { ...contentItems.get("pages:home-id"), data: { title: "Welcome", person: { name: "Jane Baker" } } });
const rootHome = { ...page("/", { collection: "pages", id: "home-id", slug: "welcome" }), canonical: `${SITE}/` } as PublicPageContext;
assert.equal(graphOf(await hook(rootHome), "preset:person")?.["@id"], `${SITE}/#person`, "the Person preset builds the root ID");
customSchemas.set("nested-owner", {
	storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION, name: "Nested owner", scope: "pages:home-id",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", "@id": `${SITE}/#organization`, name: "Owner", founder: { "@type": "Person", "@id": `${SITE}/#person`, name: "Jane Baker" } }),
	enabled: true, createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z",
});
for (const mode of ["automatic", "none"] as const) {
	if (mode === "none") values.set(OWNERSHIP_KEY, { version: 1, mode: "none" });
	const rendered = await hook(rootHome);
	assert.equal(graphOf(rendered, "custom:nested-owner")?.founder?.name, "Jane Baker", `${mode}: the nested custom graph is emitted whole`);
	assert.equal(graphOf(rendered, "preset:person"), undefined, `${mode}: the Person preset yields to the custom Person`);
	assert.equal(graphOf(rendered, "preset:organization"), undefined, `${mode}: no automatic publisher`);
}
customSchemas.delete("nested-owner");
values.delete("configuration:schema-presets:v2");
contentItems.set("pages:home-id", { ...contentItems.get("pages:home-id"), data: { title: "Welcome" } });

// Unknown ownership: output suppressed, guards stay, bytes kept, writes refused.
values.set(OWNERSHIP_KEY, { version: 1, mode: "maybe" });
const unknownPages = await Promise.all([hook(home), hook(about)]);
for (const contributions of unknownPages) assert.equal(graphOf(contributions, "preset:organization"), undefined, "unknown: no automatic publisher");
assert.equal((await route("save-admin-custom-schema")({ id: "identity-schema-8", expectedRevision: null, name: "Owner unknown", scope: "global", json: JSON.stringify(ownedDefinition), enabled: true })).success, false, "unknown is not an opt-out");
const unknownRead = await route("admin-publisher-ownership")({});
assert.deepEqual([unknownRead.ownership.state, unknownRead.ownership.effective, unknownRead.ownership.writable], ["corrupt", "unknown", false]);
const unknownWrite = await route("save-admin-publisher-ownership")({ mode: "automatic", expectedRevision: unknownRead.ownership.revision });
assert.equal(unknownWrite.error, "unreadable");
assert.deepEqual(values.get(OWNERSHIP_KEY), { version: 1, mode: "maybe" }, "the unreadable bytes are kept");
assert.notEqual((await readAnalysisRuntimeConfig(context)).fingerprint, offFingerprint, "unknown has its own fingerprint");
values.set(OWNERSHIP_KEY, { version: 1, mode: "automatic" });
const explicitAutomatic = (await readAnalysisRuntimeConfig(context)).fingerprint;
values.delete(OWNERSHIP_KEY);
assert.equal((await readAnalysisRuntimeConfig(context)).fingerprint, explicitAutomatic, "absent and saved automatic analyze the same output");

console.log("business identity runtime selfcheck passed");
