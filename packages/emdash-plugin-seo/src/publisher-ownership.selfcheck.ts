import assert from "node:assert/strict";

import type { BusinessIdentityCustomRecord, BusinessIdentityRecord, BusinessIdentityRenderState } from "./business-identity.ts";
import { buildSchemaPresetGraphs, resolveSchemaOrganizationReferences, type GlobalSeoSettings, type SchemaPresetValues } from "./lib.ts";
import {
	PUBLISHER_OWNERSHIP_KEY,
	PUBLISHER_OWNERSHIP_PREFLIGHT_LIMIT,
	inspectPublisherOwnership,
	parsePublisherOwnershipRecord,
	presetDefinesCustomPublisherId,
	publisherOwnershipEffective,
	publisherOwnershipOptedOut,
	publisherOwnershipPreflight,
	readPublisherOwnership,
	resolvePublisherOutput,
	savePublisherOwnership,
	type PublisherOwnershipHost,
	type PublisherOwnershipKv,
} from "./publisher-ownership.ts";

const ORIGIN = "https://shop.example";
const settings: GlobalSeoSettings = {
	siteName: "Harbour Bakery",
	siteUrl: `${ORIGIN}/`,
	publisherType: "organization",
	orgName: "Harbour Legal Name BV",
	orgLogo: "",
	personName: "",
	sameAs: [],
	defaultOgImage: "",
	twitterHandle: "",
};

// ---- Strict record ----
assert.deepEqual(parsePublisherOwnershipRecord({ version: 1, mode: "none" }), { version: 1, mode: "none" });
assert.deepEqual(parsePublisherOwnershipRecord({ mode: "automatic", version: 1 }), { version: 1, mode: "automatic" });
for (const value of [null, [], "none", { version: 1 }, { version: 2, mode: "none" }, { version: 1, mode: "off" }, { version: 1, mode: "none", extra: true }, { version: "1", mode: "none" }]) {
	assert.equal(parsePublisherOwnershipRecord(value), null, `${JSON.stringify(value)} is not a valid record`);
}

// ---- Read states; a read never writes ----
function memoryKv(initial?: { value: unknown; revision: string }) {
	let stored = initial ?? null;
	let counter = 0;
	const calls = { reads: 0, writes: 0 };
	let throwOnWrite: "before" | "after" | null = null;
	let refuseWithoutChange = false;
	const kv: Required<PublisherOwnershipKv> = {
		getVersioned: async (key) => {
			assert.equal(key, PUBLISHER_OWNERSHIP_KEY);
			calls.reads += 1;
			return stored ? { value: structuredClone(stored.value), revision: stored.revision } : null;
		},
		compareAndSet: async (key, expected, value) => {
			assert.equal(key, PUBLISHER_OWNERSHIP_KEY);
			calls.writes += 1;
			if (throwOnWrite === "before") {
				throwOnWrite = null;
				throw new Error("connection reset");
			}
			if (refuseWithoutChange) return { applied: false };
			if ((stored?.revision ?? null) !== expected) return { applied: false };
			stored = { value: structuredClone(value), revision: `r${++counter}` };
			if (throwOnWrite === "after") {
				throwOnWrite = null;
				throw new Error("connection reset after commit");
			}
			return { applied: true, revision: stored.revision };
		},
	};
	return {
		kv,
		calls,
		get stored() {
			return stored;
		},
		set(value: { value: unknown; revision: string } | null) {
			stored = value;
		},
		failWrite(when: "before" | "after") {
			throwOnWrite = when;
		},
		refuse() {
			refuseWithoutChange = true;
		},
	};
}

const absentKv = memoryKv();
assert.deepEqual(await readPublisherOwnership(absentKv.kv), { state: "absent", revision: null });
assert.equal(absentKv.calls.writes, 0, "reading an absent record writes no default");
assert.deepEqual(await readPublisherOwnership(memoryKv({ value: { version: 1, mode: "none" }, revision: "r9" }).kv), { state: "valid", revision: "r9", mode: "none" });
assert.deepEqual(await readPublisherOwnership(memoryKv({ value: null, revision: "r3" }).kv), { state: "corrupt", revision: "r3" }, "a stored JSON null is corrupt");
assert.deepEqual(await readPublisherOwnership(memoryKv({ value: { version: 1, mode: "none", note: "x" }, revision: "r4" }).kv), { state: "corrupt", revision: "r4" });
assert.deepEqual(await readPublisherOwnership({ getVersioned: async () => { throw new SyntaxError("Unexpected token"); } }), { state: "corrupt", revision: null }, "unparsable bytes are a stored, unreadable record");
assert.deepEqual(await readPublisherOwnership({ getVersioned: async () => { throw new Error("database is locked"); } }), { state: "unavailable", revision: null });
assert.deepEqual(await readPublisherOwnership({ getVersioned: async () => ({ value: { version: 1, mode: "none" } }) }), { state: "unavailable", revision: null }, "a read without a revision is not trusted");
assert.deepEqual(await readPublisherOwnership({}), { state: "unavailable", revision: null }, "a host without versioned reads cannot tell");
assert.equal(publisherOwnershipEffective({ state: "absent", revision: null }), "automatic");
assert.equal(publisherOwnershipEffective({ state: "valid", revision: "r", mode: "none" }), "none");
assert.equal(publisherOwnershipEffective({ state: "corrupt", revision: "r" }), "unknown");
assert.equal(publisherOwnershipEffective({ state: "unavailable", revision: null }), "unknown");
assert.equal(publisherOwnershipOptedOut({ state: "valid", revision: "r", mode: "none" }), true);
for (const state of [{ state: "absent", revision: null }, { state: "corrupt", revision: "r" }, { state: "unavailable", revision: null }, { state: "valid", revision: "r", mode: "automatic" }] as const) {
	assert.equal(publisherOwnershipOptedOut(state), false, `${state.state} is not a confirmed opt-out`);
}

// ---- Page decision ----
const identityRecord = (overrides: Partial<BusinessIdentityRecord> = {}): BusinessIdentityRecord => ({
	kind: "Organization",
	name: "Harbour Bakery",
	contactPoints: [],
	sameAs: [],
	areaServed: [],
	target: { kind: "home" },
	version: 1,
	updatedAt: "2026-10-01T00:00:00.000Z",
	active: true,
	entityId: `${ORIGIN}/#organization`,
	...overrides,
} as BusinessIdentityRecord);
const active: BusinessIdentityRenderState = { state: "valid", record: identityRecord() };
const homePage = { path: "/", url: `${ORIGIN}/`, content: { collection: "pages", id: "home", slug: "home" } };
const orgDefinition = { "@context": "https://schema.org", "@type": "Organization", "@id": `${ORIGIN}/#organization`, name: "Harbour Bakery BV", legalName: "Harbour Bakery BV" };
const nestedDefinition = {
	"@context": "https://schema.org",
	"@type": "Organization",
	"@id": `${ORIGIN}/#organization`,
	name: "Harbour Bakery BV",
	founder: { "@type": "Person", "@id": `${ORIGIN}/#person`, name: "Jane Baker" },
};
const decide = (ownership: "automatic" | "none" | "unknown", identity: BusinessIdentityRenderState | null, customs: Array<{ id: string; graph: unknown }> = [], publisherType: "organization" | "person" = "organization") =>
	resolvePublisherOutput({ ownership, identity, settings: { siteUrl: settings.siteUrl, publisherType }, page: homePage, customs });

for (const ownership of ["none", "unknown"] as const) {
	const decision = decide(ownership, null, [{ id: "c", graph: orgDefinition }]);
	assert.deepEqual(decision.publisher, { kind: "none" }, `${ownership} emits no automatic publisher`);
	assert.equal(decision.source, null);
	assert.equal(decision.reason, ownership === "none" ? "policy_none" : "policy_unknown");
	assert.deepEqual(decision.customIds, [`${ORIGIN}/#organization`], "the custom definition still reserves its ID");
}
assert.deepEqual(decide("automatic", null).publisher, { kind: "none" }, "automatic mode without an identity read fails closed");
assert.equal(decide("automatic", { state: "absent" }).publisher, undefined, "absent identity keeps the legacy publisher unchanged");
assert.equal(decide("automatic", { state: "valid", record: identityRecord({ active: false }) }).source, "legacy");
const legacyCollision = decide("automatic", { state: "absent" }, [{ id: "c", graph: orgDefinition }]);
assert.deepEqual(legacyCollision.publisher, { kind: "none" }, "a custom definition of the legacy ID leaves the legacy publisher off");
assert.equal(legacyCollision.reason, "custom_definition");
assert.equal(legacyCollision.source, "legacy");
assert.deepEqual(legacyCollision.conflicts, [{ customId: "c", ownedIds: [`${ORIGIN}/#organization`], outcome: "publisher_omitted" }]);
const legacyPerson = decide("automatic", { state: "absent" }, [{ id: "c", graph: orgDefinition }], "person");
assert.equal(legacyPerson.publisher, undefined, "an Organization definition does not collide with a Person publisher");
assert.deepEqual(legacyPerson.customIds, [`${ORIGIN}/#organization`]);
for (const state of [{ state: "invalid" }, { state: "unavailable" }] as const) {
	assert.deepEqual(decide("automatic", state).publisher, { kind: "none" }, `${state.state} identity fails closed`);
}
const identityDecision = decide("automatic", active);
assert.equal(identityDecision.publisher?.kind, "identity");
assert.equal(identityDecision.fullDefinition, true);
const identityCollision = decide("automatic", active, [{ id: "c", graph: nestedDefinition }]);
assert.deepEqual(identityCollision.publisher, { kind: "none" });
assert.equal(identityCollision.source, "business");
assert.deepEqual(identityCollision.customIds.sort(), [`${ORIGIN}/#organization`, `${ORIGIN}/#person`], "nested publisher IDs are reserved too");

// Root canonical page, Person preset ON, nested Organization+Person custom graph.
const rootPage = {
	...homePage,
	kind: "content",
	pageType: "website",
	title: "Home",
	pageTitle: "Home",
	canonical: `${ORIGIN}/`,
	locale: null,
	siteName: settings.siteName,
} as any;
const presets = { organization: true, website: true, webPage: false, blogPosting: true, service: true, breadcrumbList: false, person: true, faqPage: false, localBusiness: false, product: false, event: false, videoObject: false } as unknown as SchemaPresetValues;
const pageData = { person: { name: "Jane Baker" } };
for (const ownership of ["automatic", "none"] as const) {
	const decision = decide(ownership, ownership === "automatic" ? { state: "absent" } : null, [{ id: "c", graph: nestedDefinition }]);
	const built = buildSchemaPresetGraphs({ page: rootPage, settings, presets, data: pageData, contentTypeRoles: { pages: "none" } as any, publisher: decision.publisher });
	const person = built.find((item) => item.key === "person");
	assert.equal(person?.graph["@id"], `${ORIGIN}/#person`, "the Person preset on a root canonical page builds the publisher-shaped ID");
	assert.equal(presetDefinesCustomPublisherId(person!.graph, decision.customIds), `${ORIGIN}/#person`, `${ownership}: the preset yields to the nested custom Person`);
	assert.ok(!built.some((item) => item.key === "organization"), `${ownership}: no automatic publisher graph`);
	assert.ok(!built.some((item) => JSON.stringify(item.graph).includes("Harbour Legal Name BV")), `${ownership}: no generated publisher facts`);
	assert.equal(resolveSchemaOrganizationReferences(nestedDefinition, settings, false, decision.publisher), nestedDefinition, `${ownership}: the custom graph is passed through unchanged`);
}
assert.equal(presetDefinesCustomPublisherId({ "@type": "Person", "@id": `${ORIGIN}/team#person`, name: "x" }, [`${ORIGIN}/#person`]), null, "other IDs are not affected");

// ---- Restore preflight ----
const record = (json: unknown, overrides: Partial<BusinessIdentityCustomRecord> = {}): BusinessIdentityCustomRecord => ({
	id: overrides.id ?? `c${Math.abs(JSON.stringify(json).length)}`,
	name: overrides.name ?? "Snippet",
	scope: "global",
	json: typeof json === "string" ? json : JSON.stringify(json),
	enabled: true,
	target: null,
	...overrides,
});
function host(options: {
	kv?: PublisherOwnershipKv;
	identity?: BusinessIdentityRenderState;
	records?: BusinessIdentityCustomRecord[] | Error;
	site?: { siteName: string; siteUrl: string; publisherType: "organization" | "person" } | Error;
	gates?: { schemaModule: boolean; sitePublisherPreset: boolean };
}): PublisherOwnershipHost & { recordReads: number[] } {
	const recordReads: number[] = [];
	return {
		kv: options.kv ?? memoryKv().kv,
		readSite: async () => {
			if (options.site instanceof Error) throw options.site;
			return options.site ?? { siteName: settings.siteName, siteUrl: settings.siteUrl, publisherType: "organization" };
		},
		readIdentity: async () => options.identity ?? { state: "absent" },
		readGlobalCustomSchemas: async (limit) => {
			recordReads.push(limit);
			if (options.records instanceof Error) throw options.records;
			return options.records ?? [];
		},
		readGates: async () => options.gates ?? { schemaModule: true, sitePublisherPreset: true },
		recordReads,
	};
}

assert.deepEqual(await publisherOwnershipPreflight(host({})), { status: "clear", source: "legacy", entityId: `${ORIGIN}/#organization`, checked: 0 });
const siteUrlCollision = await publisherOwnershipPreflight(host({ records: [record({ "@context": "https://schema.org", "@type": "Organization", "@id": "{{siteUrl}}/#organization", name: "x" }, { id: "site-org", name: "Site org" })] }));
assert.equal(siteUrlCollision.status, "refused");
assert.ok(siteUrlCollision.status === "refused" && siteUrlCollision.reason === "collision");
assert.deepEqual(siteUrlCollision.status === "refused" ? siteUrlCollision.definitions : [], [{ id: "site-org", name: "Site org", scope: "global", ownedIds: [`${ORIGIN}//#organization`] }]);
assert.match(siteUrlCollision.status === "refused" ? siteUrlCollision.message : "", /Only custom schemas that apply to the whole site were checked/);
for (const id of ["{{title}}/#organization", "{{canonical}}#organization", "{{siteUrl}}/#{{slug}}"]) {
	const result = await publisherOwnershipPreflight(host({ records: [record({ "@type": "Organization", "@id": id, name: "x" }, { name: "Page dependent" })] }));
	assert.ok(result.status === "refused" && result.reason === "incomplete", `${id} cannot be cleared without the pages it reaches`);
}
assert.equal((await publisherOwnershipPreflight(host({ records: [record({ "@type": "WebPage", "@id": "{{canonical}}#webpage", name: "x" })] }))).status, "clear", "an ID that can never be owned is clear");
assert.equal((await publisherOwnershipPreflight(host({ records: [record(orgDefinition, { enabled: false })] }))).status, "clear", "a disabled record is never emitted");
assert.equal((await publisherOwnershipPreflight(host({ records: [record("{not json")] }))).status, "clear", "invalid JSON is never emitted");
const overflow = await publisherOwnershipPreflight(host({ records: Array.from({ length: PUBLISHER_OWNERSHIP_PREFLIGHT_LIMIT + 1 }, (_, index) => record({ "@type": "Thing", name: `t${index}` }, { id: `t${index}` })) }));
assert.ok(overflow.status === "refused" && overflow.reason === "overflow");
const bounded = host({});
await publisherOwnershipPreflight(bounded);
assert.deepEqual(bounded.recordReads, [PUBLISHER_OWNERSHIP_PREFLIGHT_LIMIT], "one bounded read of site-wide records");
assert.ok((await publisherOwnershipPreflight(host({ records: new Error("query failed") }))).status === "refused");
assert.ok(((await publisherOwnershipPreflight(host({ site: new Error("settings") }))) as any).reason === "read_failed");
assert.ok(((await publisherOwnershipPreflight(host({ identity: { state: "unavailable" } }))) as any).reason === "publisher_unknown");
const personIdentity: BusinessIdentityRenderState = { state: "valid", record: identityRecord({ kind: "Person", entityId: `${ORIGIN}/#person`, organizationReferenceAliases: true }) };
const aliasCollision = await publisherOwnershipPreflight(host({ identity: personIdentity, records: [record(orgDefinition, { id: "old-org" })] }));
assert.ok(aliasCollision.status === "refused" && aliasCollision.reason === "collision" && aliasCollision.source === "business", "an alias the identity answers to counts");
const noAddress = await publisherOwnershipPreflight(host({ site: { siteName: "x", siteUrl: "", publisherType: "organization" }, records: [record(orgDefinition)] }));
assert.deepEqual(noAddress, { status: "clear", source: "legacy", entityId: "", checked: 1 }, "a legacy publisher without a site address has no ID to collide with");

// ---- Commands ----
const store = memoryKv();
const commands = (gates?: { schemaModule: boolean; sitePublisherPreset: boolean }, records: BusinessIdentityCustomRecord[] = []) =>
	host({ kv: store.kv, records, ...(gates ? { gates } : {}) });
let view = (await inspectPublisherOwnership(commands())).ownership;
assert.deepEqual([view.state, view.effective, view.revision, view.writable], ["absent", "automatic", null, true]);
assert.equal(store.calls.writes, 0);
const off = await savePublisherOwnership(commands(), { mode: "none", expectedRevision: null });
assert.ok(off.success && off.changed && off.ownership.effective === "none");
assert.deepEqual(store.stored?.value, { version: 1, mode: "none" });
const offRevision = store.stored!.revision;
const again = await savePublisherOwnership(commands(), { mode: "none", expectedRevision: offRevision });
assert.ok(again.success && !again.changed, "the same mode writes nothing");
assert.equal(store.calls.writes, 1);
const stale = await savePublisherOwnership(commands(), { mode: "automatic", expectedRevision: null });
assert.ok(!stale.success && stale.error === "conflict" && stale.ownership?.revision === offRevision, "a stale revision is a conflict with the current setting");
assert.equal(store.calls.writes, 1);
const blocked = await savePublisherOwnership(commands({ schemaModule: false, sitePublisherPreset: false }, [record(orgDefinition, { id: "owner" })]), { mode: "automatic", expectedRevision: offRevision });
assert.ok(!blocked.success && blocked.error === "preflight" && blocked.preflight?.reason === "collision", "switch states do not skip the preflight");
assert.deepEqual(store.stored, { value: { version: 1, mode: "none" }, revision: offRevision }, "a refused return keeps the stored opt-out");
const on = await savePublisherOwnership(commands(), { mode: "automatic", expectedRevision: offRevision });
assert.ok(on.success && on.changed && on.preflight?.status === "clear");
assert.deepEqual(store.stored?.value, { version: 1, mode: "automatic" }, "automatic mode is kept as an explicit record");
const onRevision = store.stored!.revision;
store.failWrite("after");
const lost = await savePublisherOwnership(commands(), { mode: "none", expectedRevision: onRevision });
assert.ok(!lost.success && lost.error === "unconfirmed" && lost.intended === "none");
const writesAfterLost = store.calls.writes;
const requested = await inspectPublisherOwnership(commands(), { check: { mode: "none", expectedRevision: onRevision } });
assert.equal(requested.check, "matches_requested");
assert.equal(store.calls.writes, writesAfterLost, "the check never writes or retries");
const loaded = await inspectPublisherOwnership(commands(), { check: { mode: "automatic", expectedRevision: store.stored!.revision } });
assert.equal(loaded.check, "matches_loaded");
assert.equal((await inspectPublisherOwnership(commands(), { check: { mode: "automatic", expectedRevision: "r-old" } })).check, "differs");
const beforeFail = store.stored!.revision;
store.failWrite("before");
const failed = await savePublisherOwnership(commands(), { mode: "automatic", expectedRevision: beforeFail });
assert.ok(!failed.success && failed.error === "unconfirmed");
assert.equal((await inspectPublisherOwnership(commands(), { check: { mode: "automatic", expectedRevision: beforeFail } })).check, "matches_loaded", "a write that failed before storage leaves the loaded revision");
store.refuse();
const uncertain = await savePublisherOwnership(commands(), { mode: "automatic", expectedRevision: beforeFail });
assert.ok(!uncertain.success && uncertain.error === "storage_uncertain");

const corrupt = memoryKv({ value: { version: 1, mode: "maybe" }, revision: "r7" });
const corruptView = (await inspectPublisherOwnership(host({ kv: corrupt.kv }))).ownership;
assert.deepEqual([corruptView.state, corruptView.effective, corruptView.writable], ["corrupt", "unknown", false]);
for (const mode of ["none", "automatic"] as const) {
	const refused = await savePublisherOwnership(host({ kv: corrupt.kv }), { mode, expectedRevision: "r7" });
	assert.ok(!refused.success && refused.error === "unreadable", `a corrupt record refuses ${mode}`);
}
assert.equal(corrupt.calls.writes, 0, "corrupt bytes are never overwritten");
assert.deepEqual(corrupt.stored, { value: { version: 1, mode: "maybe" }, revision: "r7" });
for (const input of [null, {}, { mode: "off", expectedRevision: null }, { mode: "none" }, { mode: "none", expectedRevision: "" }, { mode: "none", expectedRevision: "x".repeat(129) }]) {
	const invalid = await savePublisherOwnership(commands(), input);
	assert.ok(!invalid.success && invalid.error === "invalid", `${JSON.stringify(input)} is refused`);
}
const unsupported = await savePublisherOwnership(host({ kv: { getVersioned: async () => null } }), { mode: "none", expectedRevision: null });
assert.ok(!unsupported.success && unsupported.error === "unsupported");
assert.equal((await inspectPublisherOwnership(host({ kv: { getVersioned: async () => null } }))).ownership.writable, false);
view = (await inspectPublisherOwnership(host({ kv: store.kv, gates: { schemaModule: false, sitePublisherPreset: true } }))).ownership;
assert.deepEqual(view.gates, { schemaModule: false, sitePublisherPreset: true }, "the separate gates are reported, never folded into the setting");

console.log("Publisher ownership selfcheck passed");
