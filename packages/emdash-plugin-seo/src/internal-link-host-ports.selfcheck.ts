import assert from "node:assert/strict";

import type { PluginContext } from "emdash";

import { SEO_ADMIN_SETTINGS_STORAGE_VERSION } from "./admin-contract.ts";
import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import { LINK_POLICY_MATERIAL_BYTES, LINK_VERSION_FINGERPRINT_BYTES, createLinkHostPorts } from "./internal-link-host-ports.ts";
import { LINK_SUGGESTION_LIMITS, type LinkSourceRead } from "./internal-link-suggestions.ts";
import { GLOBAL_SETTINGS_KEY } from "./settings-runtime.ts";
import { LEGACY_SETTINGS_KEYS } from "./settings-state.ts";

// ---------------------------------------------------------------------------
// Controlled SDK and KV surfaces: every call is recorded, anything undeclared fails

const SITE = "https://example.com";
const ENTRY = "01KENTRY000000000000000001";
const STAMP = "2026-10-04T12:00:00.000Z";
const block = (key: string, text: string) =>
	({ _type: "block", _key: key, style: "normal", markDefs: [], children: [{ _type: "span", _key: key + "-s", text, marks: [] }] });
const LIVE_BODY = [block("b1", "The live paragraph covers drip irrigation.")];
const DRAFT_BODY = [block("b1", "The saved draft paragraph covers rain barrels.")];

const schema = (fields: unknown = [{ slug: "title", type: "string" }, { slug: "content", type: "portableText" }, { slug: "excerpt", type: "text" }]) =>
	({ slug: "posts", label: "Posts", fields });
const row = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: ENTRY, type: "posts", slug: "spring-plan", status: "published", locale: "en",
	data: { title: "Spring plan", content: LIVE_BODY, excerpt: "Short" },
	createdAt: STAMP, updatedAt: STAMP, publishedAt: STAMP, version: 3, draftRevisionId: null,
	...patch,
});
const revision = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
	id: "rev-2", collection: "posts", entryId: ENTRY,
	data: { title: "Spring plan draft", content: DRAFT_BODY, _slug: "spring-plan-new" },
	createdAt: STAMP,
	...patch,
});

interface Fake {
	schema?: () => unknown;
	row?: () => unknown;
	/** Absent means the context has no revision access. */
	revision?: () => unknown;
	kv?: (key: string) => unknown;
	site?: Record<string, unknown>;
	omit?: string[];
}

const forbidden: string[] = [];
let networkCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
	networkCalls += 1;
	throw new Error("Network access is not allowed in the host-port selfcheck");
}) as typeof fetch;

function fakeContext(fake: Fake) {
	const calls: Array<{ name: string; args: unknown[] }> = [];
	const surface = (name: string, methods: Record<string, ((...args: any[]) => unknown) | undefined>, probes: readonly string[] = []) =>
		new Proxy({}, {
			get(_target, key) {
				if (typeof key !== "string") return undefined;
				const method = methods[key];
				if (method) {
					return async (...args: unknown[]) => {
						calls.push({ name: name + "." + key, args: structuredClone(args) });
						return method(...args);
					};
				}
				// A capability probe may find an optional method absent; any other access is a forbidden operation.
				if (!probes.includes(key)) forbidden.push(name + "." + key);
				return undefined;
			},
		});
	const parts: Record<string, unknown> = {
		site: fake.site ?? { name: "Garden", url: SITE, locale: "en" },
		log: { warn() {}, info() {}, error() {}, debug() {} },
		schema: surface("schema", { getCollection: fake.schema ?? (() => schema()) }),
		content: surface("content", { get: fake.row ?? (() => row()), getRevision: fake.revision }, ["getRevision"]),
		kv: fake.omit?.includes("kv.getVersioned")
			? surface("kv", {}, ["getVersioned"])
			: surface("kv", { getVersioned: fake.kv ?? (() => null) }),
	};
	for (const key of fake.omit ?? []) if (!key.includes(".")) delete parts[key];
	const ctx = new Proxy(parts, {
		get(target, key) {
			if (typeof key !== "string" || key === "then") return undefined;
			if (!Object.hasOwn(target, key) && !["schema", "content", "kv"].includes(key)) forbidden.push("ctx." + key);
			return target[key];
		},
	});
	return { ctx: ctx as unknown as PluginContext, calls, names: () => calls.map((call) => call.name) };
}

async function source(fake: Fake, ref = { collection: "posts", entryId: ENTRY }) {
	const context = fakeContext(fake);
	const read = await createLinkHostPorts(context.ctx).source.readSource(ref);
	return { read, names: context.names(), calls: context.calls };
}

function found(read: LinkSourceRead, label: string) {
	if (read.kind !== "found") return assert.fail(label + ": expected a found source, got " + JSON.stringify(read));
	return read.document;
}

const cases: string[] = [];

// ---------------------------------------------------------------------------
// Saved source

{
	const live = row();
	const untouched = structuredClone(live);
	const { read, names, calls } = await source({ row: () => live });
	const document = found(read, "live row");
	assert.deepEqual(names, ["schema.getCollection", "content.get"]);
	assert.deepEqual(calls[0].args, ["posts"]);
	assert.deepEqual(calls[1].args, ["posts", ENTRY]);
	assert.deepEqual(document, {
		collection: "posts", entryId: ENTRY, locale: "en", sourceVersion: savedContentVersion(untouched as never),
		revisionId: null, field: "content", body: LIVE_BODY, siteUrl: SITE, routeUrl: null,
	});
	assert.deepEqual(live, untouched, "The host row must not be changed");
	cases.push("a live row reads exactly its schema and row, with the saved version and no route");
}

{
	// The draft revision owns the body; the version comes from the untouched row.
	for (const version of [3, undefined]) {
		const live = row({ draftRevisionId: "rev-2", ...(version === undefined ? { version: undefined } : {}) });
		const untouched = structuredClone(live);
		const { read, names, calls } = await source({ row: () => live, revision: () => revision() });
		const document = found(read, "draft row");
		assert.deepEqual(names, ["schema.getCollection", "content.get", "content.getRevision"]);
		assert.deepEqual(calls[2].args, ["posts", ENTRY, "rev-2"]);
		assert.deepEqual(document.body, DRAFT_BODY);
		assert.equal(document.revisionId, "rev-2");
		assert.equal(document.sourceVersion, savedContentVersion(untouched as never));
		assert.deepEqual(live, untouched, "Draft selection must not change the host row");
	}
	cases.push("a saved draft supplies its own body under the version of the untouched row");

	const draftRow = () => row({ draftRevisionId: "rev-2" });
	for (const [label, read] of [
		["draft without its own body field", () => revision({ data: { title: "Draft without body" } })],
		["draft body only on a prototype", () => revision({ data: Object.create({ content: DRAFT_BODY }) })],
		["draft data only on a prototype", () => Object.assign(Object.create({ data: { content: DRAFT_BODY } }), { id: "rev-2", collection: "posts", entryId: ENTRY })],
		["draft data is a list", () => revision({ data: [DRAFT_BODY] })],
		["another revision", () => revision({ id: "rev-3" })],
		["another collection's revision", () => revision({ collection: "pages" })],
		["another entry's revision", () => revision({ entryId: "01KENTRY000000000000000002" })],
		["draft not found", () => null],
		["draft read failure", () => { throw new Error("Synthetic revision failure"); }],
	] as const) {
		const result = await source({ row: draftRow, revision: read });
		assert.deepEqual(result.read, { kind: "unavailable" }, label);
		assert.deepEqual(result.names, ["schema.getCollection", "content.get", "content.getRevision"], label);
	}
	const withoutRevisions = await source({ row: draftRow });
	assert.deepEqual(withoutRevisions.read, { kind: "unavailable" });
	assert.deepEqual(withoutRevisions.names, ["schema.getCollection", "content.get"]);
	cases.push("an unreadable or mismatched draft is unavailable and never falls back to the live body");
}

{
	// Records that cannot identify the saved source.
	for (const [label, value] of [
		["another entry", row({ id: "01KENTRY000000000000000002" })],
		["another collection", row({ type: "pages" })],
		["list data", row({ data: [LIVE_BODY] })],
		["unparseable timestamp", row({ updatedAt: "yesterday" })],
		["non-text slug", row({ slug: 7 })],
		["no locale", row({ locale: null })],
		["non-canonical locale", row({ locale: "EN" })],
		["invalid locale", row({ locale: "en_US" })],
		["text version", row({ version: "3" })],
		["negative version", row({ version: -1 })],
		["fractional version", row({ version: 1.5 })],
		["empty draft pointer", row({ draftRevisionId: "" })],
		["non-text draft pointer", row({ draftRevisionId: 7 })],
		["not a record", "posts"],
	] as const) {
		const result = await source({ row: () => value });
		assert.deepEqual(result.read, { kind: "unavailable" }, label);
		assert.deepEqual(result.names, ["schema.getCollection", "content.get"], label);
	}
	const missing = await source({ row: () => null });
	assert.deepEqual(missing.read, { kind: "missing" });
	const failing = await source({ row: () => { throw new Error("Synthetic content failure"); } });
	assert.deepEqual(failing.read, { kind: "unavailable" });
	cases.push("mismatched, malformed and unusable-locale rows are unavailable; a missing row is missing");
}

{
	// The exact schema selects one Portable Text field before the row is read.
	for (const [label, value, expected] of [
		["missing collection", null, { kind: "missing" }],
		["another collection's schema", { ...schema(), slug: "pages" }, { kind: "unavailable" }],
		["fields not a list", schema({ content: "portableText" }), { kind: "unavailable" }],
		["field without a slug", schema([{ type: "portableText" }]), { kind: "unavailable" }],
		["repeated field slug", schema([{ slug: "content", type: "portableText" }, { slug: "content", type: "string" }]), { kind: "unavailable" }],
		["no Portable Text field", schema([{ slug: "title", type: "string" }, { slug: "body", type: "json" }]), { kind: "unsupported", reason: "no-portable-text-field" }],
		["two Portable Text fields", schema([{ slug: "content", type: "portableText" }, { slug: "summary", type: "portableText" }]), { kind: "unsupported", reason: "ambiguous-body-field" }],
	] as const) {
		const result = await source({ schema: () => value });
		assert.deepEqual(result.read, expected, label);
		assert.deepEqual(result.names, ["schema.getCollection"], label);
	}
	const failing = await source({ schema: () => { throw new Error("Synthetic schema failure"); } });
	assert.deepEqual(failing.read, { kind: "unavailable" });
	for (const ref of [{ collection: "Posts", entryId: ENTRY }, { collection: "posts", entryId: "" }, { collection: "posts", entryId: " " + ENTRY }]) {
		const result = await source({}, ref);
		assert.deepEqual(result.read, { kind: "unavailable" });
		assert.deepEqual(result.names, []);
	}
	for (const omit of ["schema", "content"]) {
		const result = await source({ omit: [omit] });
		assert.deepEqual(result.read, { kind: "unavailable" }, "without " + omit);
		assert.deepEqual(result.names, [], "without " + omit);
	}
	cases.push("schema refusals precede the row read; invalid references and absent capabilities read nothing");
}

{
	// Bounds: the SDK has already hydrated the row when they apply.
	const big = (bytes: number) => [block("big", "x".repeat(bytes))];
	const liveTooLarge = await source({ row: () => row({ data: { title: "Big", content: big(LINK_SUGGESTION_LIMITS.sourceBodyBytes) } }) });
	assert.deepEqual(liveTooLarge.read, { kind: "unavailable" });
	assert.deepEqual(liveTooLarge.names, ["schema.getCollection", "content.get"]);
	const draftTooLarge = await source({ row: () => row({ draftRevisionId: "rev-2" }), revision: () => revision({ data: { content: big(LINK_SUGGESTION_LIMITS.sourceBodyBytes) } }) });
	assert.deepEqual(draftTooLarge.read, { kind: "unavailable" });
	found((await source({ row: () => row({ data: { title: "Near the cap", content: big(LINK_SUGGESTION_LIMITS.sourceBodyBytes - 1_000) } }) })).read, "body under the cap");

	// What the version helper would serialize is bounded before it runs.
	const unrelated = "u".repeat(LINK_VERSION_FINGERPRINT_BYTES);
	for (const [label, value] of [
		["fingerprinted data beyond its bound", row({ version: undefined, data: { title: "Big", content: LIVE_BODY, notes: unrelated } })],
		["SEO record beyond its bound", row({ seo: { title: unrelated } })],
		["oversized revision token", row({ version: undefined, _rev: "r".repeat(513) })],
	] as const) {
		const result = await source({ row: () => value });
		assert.deepEqual(result.read, { kind: "unavailable" }, label);
		assert.deepEqual(result.names, ["schema.getCollection", "content.get"], label);
	}
	// Without the fallback the same unrelated field is never fingerprinted.
	for (const value of [
		row({ data: { title: "Big", content: LIVE_BODY, notes: unrelated } }),
		row({ version: undefined, _rev: btoa("4:token"), data: { title: "Big", content: LIVE_BODY, notes: unrelated } }),
		row({ version: undefined, draftRevisionId: "rev-2", data: { title: "Big", notes: unrelated } }),
	]) {
		const untouched = structuredClone(value);
		const document = found((await source({ row: () => value, revision: () => revision() })).read, "no data fingerprint");
		assert.equal(document.sourceVersion, savedContentVersion(untouched as never));
	}
	const fingerprinted = row({ version: undefined, data: { title: "Small", content: LIVE_BODY } });
	assert.equal(found((await source({ row: () => fingerprinted })).read, "fingerprinted").sourceVersion, savedContentVersion(structuredClone(fingerprinted) as never));

	// Pointer and timestamp metadata are bounded before the shared helpers or the revision read use them.
	const realParse = Date.parse;
	let parses = 0;
	Date.parse = (value: string) => {
		parses += 1;
		return realParse(value);
	};
	try {
		const control = await source({ row: () => row({ draftRevisionId: "rev-2" }), revision: () => revision() });
		assert.deepEqual(found(control.read, "valid pointer control").body, DRAFT_BODY);
		assert.deepEqual(control.names, ["schema.getCollection", "content.get", "content.getRevision"]);
		assert.ok(parses > 0, "The control must reach the shared timestamp check");
		for (const [label, pointer] of [
			["pointer beyond the identity bound", "r".repeat(LINK_SUGGESTION_LIMITS.identityChars + 1)],
			["huge pointer", "r".repeat(LINK_VERSION_FINGERPRINT_BYTES)],
			["pointer with surrounding space", " rev-2"],
			["pointer with a control character", "rev\u00002"],
		] as const) {
			const result = await source({ row: () => row({ draftRevisionId: pointer }), revision: () => revision({ id: pointer }) });
			assert.deepEqual(result.read, { kind: "unavailable" }, label);
			assert.deepEqual(result.names, ["schema.getCollection", "content.get"], label + ": no revision read");
		}
		parses = 0;
		const longTimestamp = await source({ row: () => row({ draftRevisionId: "rev-2", updatedAt: STAMP + "0".repeat(41) }), revision: () => revision() });
		assert.deepEqual(longTimestamp.read, { kind: "unavailable" });
		assert.deepEqual(longTimestamp.names, ["schema.getCollection", "content.get"], "oversized timestamp: no revision read");
		assert.equal(parses, 0, "An oversized timestamp is refused before it is parsed");
		const nonTextTimestamp = await source({ row: () => row({ updatedAt: 1_759_579_200_000 }) });
		assert.deepEqual(nonTextTimestamp.read, { kind: "unavailable" });
		assert.equal(parses, 0);
	} finally {
		Date.parse = realParse;
	}
	assert.equal(found((await source({ site: { name: "Garden", locale: "en" } })).read, "no site URL").siteUrl, null);
	cases.push("body, fingerprint and revision-token bounds refuse instead of inventing a version; the document validator still applies");
}

// ---------------------------------------------------------------------------
// Global indexing policy

const record = (patch: Record<string, unknown> = {}) => ({
	version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: STAMP, siteName: "Garden", siteUrl: SITE,
	organizationName: "Garden", organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "",
	noindex: false, indexingPreferenceConfirmed: true, ...patch,
});
const store = (entries: Record<string, unknown>) => (key: string) => Object.hasOwn(entries, key) ? entries[key] : null;

async function policy(kv: (key: string) => unknown, extra: Partial<Fake> = {}) {
	const context = fakeContext({ kv, ...extra });
	const ports = createLinkHostPorts(context.ctx);
	const read = await ports.policy.readPolicy();
	return { read, ports, names: context.names(), calls: context.calls };
}

function readable(read: { kind: string; version?: string }, label: string): string {
	if (read.kind !== "readable" || typeof read.version !== "string") return assert.fail(label + ": expected a readable policy, got " + JSON.stringify(read));
	assert.match(read.version, /^link-policy-v1:sha256-[0-9a-f]{64}$/, label);
	return read.version;
}

{
	const saved = await policy(store({ [GLOBAL_SETTINGS_KEY]: { value: record(), revision: "r1" } }));
	const version = readable(saved.read, "saved record");
	assert.deepEqual(saved.names, ["kv.getVersioned"]);
	assert.deepEqual(saved.calls[0].args, [GLOBAL_SETTINGS_KEY]);
	const observation = saved.ports.policyObservation(version);
	assert.deepEqual(observation, { version, noindex: false, contentTypeNoindex: [], siteUrl: SITE });
	assert.ok(Object.isFrozen(observation));
	assert.ok(Object.isFrozen(observation?.contentTypeNoindex));
	assert.throws(() => { (observation as { noindex: boolean }).noindex = true; }, TypeError);
	assert.equal(saved.ports.policyObservation(version + "0"), null);
	assert.equal(saved.ports.policyObservation("link-policy-v1:sha256-" + "0".repeat(64)), null);

	const again = readable((await policy(store({ [GLOBAL_SETTINGS_KEY]: { value: record(), revision: "r1" } }))).read, "same record");
	assert.equal(again, version, "The identity is deterministic");
	const rewritten = readable((await policy(store({ [GLOBAL_SETTINGS_KEY]: { value: record(), revision: "r2" } }))).read, "same values, new revision");
	assert.notEqual(rewritten, version, "A same-value rewrite changes the identity");
	const noindex = await policy(store({ [GLOBAL_SETTINGS_KEY]: { value: record({ noindex: true }), revision: "r3" } }));
	assert.equal(noindex.ports.policyObservation(readable(noindex.read, "noindex"))?.noindex, true);
	const ruled = await policy(store({ [GLOBAL_SETTINGS_KEY]: { value: record({ contentTypeNoindex: ["guides", "posts"] }), revision: "r1" } }));
	const ruledVersion = readable(ruled.read, "content type rule");
	assert.deepEqual(ruled.ports.policyObservation(ruledVersion)?.contentTypeNoindex, ["guides", "posts"]);
	assert.equal(ruled.ports.policyObservation(ruledVersion)?.noindex, false, "the rule never becomes the global flag");
	assert.notEqual(ruledVersion, version, "the rule is part of the identity even under the same revision");
	const emptyRule = readable((await policy(store({ [GLOBAL_SETTINGS_KEY]: { value: record({ contentTypeNoindex: [] }), revision: "r1" } }))).read, "empty rule");
	assert.notEqual(emptyRule, ruledVersion);
	assert.deepEqual((await policy(store({ [GLOBAL_SETTINGS_KEY]: { value: record({ contentTypeNoindex: ["posts", "guides"] }), revision: "r1" } }))).read,
		{ kind: "unreadable" }, "a rule out of canonical order is a corrupt record, never a guess");

	// Another invocation shares nothing.
	const other = createLinkHostPorts(fakeContext({}).ctx);
	assert.equal(other.policyObservation(version), null);
	cases.push("a stored record is one versioned read; same-value revisions change the identity; observations are immutable and per invocation");
}

{
	// Without a record: the global key and all eight legacy keys, absence included.
	const absent = await policy(store({}));
	const absentVersion = readable(absent.read, "absent");
	assert.deepEqual(absent.calls.map((call) => call.args[0]), [GLOBAL_SETTINGS_KEY, ...LEGACY_SETTINGS_KEYS]);
	assert.equal(absent.calls.length, 9);
	assert.deepEqual(absent.ports.policyObservation(absentVersion), { version: absentVersion, noindex: false, contentTypeNoindex: [], siteUrl: SITE });

	const legacy = await policy(store({ "settings:noindex": { value: true, revision: "l1" } }));
	const legacyVersion = readable(legacy.read, "legacy");
	assert.equal(legacy.calls.length, 9);
	assert.notEqual(legacyVersion, absentVersion);
	assert.equal(legacy.ports.policyObservation(legacyVersion)?.noindex, true);
	const legacyRewritten = readable((await policy(store({ "settings:noindex": { value: true, revision: "l2" } }))).read, "legacy rewrite");
	assert.notEqual(legacyRewritten, legacyVersion, "A same-value legacy rewrite changes the identity");
	const orgName = readable((await policy(store({ "settings:orgName": { value: "Garden Co", revision: "o1" } }))).read, "legacy key appears");
	assert.notEqual(orgName, absentVersion, "A legacy key appearing changes the identity even while the state stays absent");
	const legacyUrl = await policy(store({ "settings:siteUrl": { value: "https://www.example.com", revision: "u1" } }));
	assert.equal(legacyUrl.ports.policyObservation(readable(legacyUrl.read, "legacy site URL"))?.siteUrl, "https://www.example.com");
	const savedVersion = readable((await policy(store({ [GLOBAL_SETTINGS_KEY]: { value: record({ siteUrl: SITE }), revision: "r1" } }))).read, "saved");
	assert.notEqual(savedVersion, absentVersion, "The saved and absent classifications differ");
	cases.push("absent and legacy settings read nine keys and fingerprint every envelope, absence and classification");
}

{
	// Unreadable settings are never defaults, and they clear the observation.
	for (const [label, kv, extra] of [
		["corrupt record", store({ [GLOBAL_SETTINGS_KEY]: { value: { version: 0 }, revision: "r9" } }), {}],
		["record without a revision", store({ [GLOBAL_SETTINGS_KEY]: { value: record() } }), {}],
		["corrupt legacy key", store({ "settings:noindex": { value: "yes", revision: "l9" } }), {}],
		["settings read failure", () => { throw new Error("Synthetic KV failure"); }, {}],
		["no versioned reads", store({}), { omit: ["kv.getVersioned"] }],
	] as const) {
		const result = await policy(kv, extra as Partial<Fake>);
		assert.deepEqual(result.read, { kind: "unreadable" }, label);
	}

	let fail = false;
	const context = fakeContext({ kv: (key) => {
		if (fail) throw new Error("Synthetic KV failure");
		return key === GLOBAL_SETTINGS_KEY ? { value: record(), revision: "r1" } : null;
	} });
	const ports = createLinkHostPorts(context.ctx);
	const first = readable(await ports.policy.readPolicy(), "first read");
	assert.ok(ports.policyObservation(first));
	fail = true;
	assert.deepEqual(await ports.policy.readPolicy(), { kind: "unreadable" });
	assert.equal(ports.policyObservation(first), null, "A failed read clears the observation");

	// An older read finishing late cannot replace a newer observation.
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let reads = 0;
	const racing = createLinkHostPorts(fakeContext({ kv: async (key) => {
		if (key !== GLOBAL_SETTINGS_KEY) return null;
		reads += 1;
		if (reads === 1) {
			await gate;
			return { value: record(), revision: "r-old" };
		}
		return { value: record(), revision: "r-new" };
	} }).ctx);
	const older = racing.policy.readPolicy();
	const newer = readable(await racing.policy.readPolicy(), "newer read");
	release();
	const olderVersion = readable(await older, "older read");
	assert.notEqual(olderVersion, newer);
	assert.ok(racing.policyObservation(newer));
	assert.equal(racing.policyObservation(olderVersion), null);
	cases.push("corrupt, unavailable and oversized settings are unreadable; a failed or superseded read leaves no stale observation");
}

{
	// Oversized envelopes are refused after the host returned them but before classification or hashing.
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
	assert.ok(descriptor?.configurable, "The digest counter needs a replaceable global crypto");
	const realCrypto = globalThis.crypto;
	const countingDigests = async <T>(action: () => Promise<T>) => {
		let digests = 0;
		Object.defineProperty(globalThis, "crypto", {
			configurable: true, writable: true, enumerable: descriptor.enumerable,
			value: {
				getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
				randomUUID: realCrypto.randomUUID.bind(realCrypto),
				subtle: {
					digest: (algorithm: unknown, data: unknown) => {
						digests += 1;
						return realCrypto.subtle.digest(algorithm as never, data as never);
					},
				},
			},
		});
		try {
			return { value: await action(), digests };
		} finally {
			Object.defineProperty(globalThis, "crypto", descriptor);
		}
	};
	// Unconfirmed, default-valued records go through the historical-seed fingerprint during classification.
	const seedShaped = (socialProfiles: string[]) => {
		const value: Record<string, unknown> = record({ siteUrl: "", socialProfiles });
		delete value.indexingPreferenceConfirmed;
		return value;
	};
	const profiles = (count: number) => Array.from({ length: count }, (_, index) => "https://social.example/profile/" + index);

	const control = await countingDigests(() => policy(store({ [GLOBAL_SETTINGS_KEY]: { value: seedShaped(profiles(3)), revision: "r1" } })));
	readable(control.value.read, "seed-shaped control");
	assert.ok(control.digests >= 2, "The control must reach classification and identity hashing");

	const oversizedRecord = await countingDigests(() => policy(store({ [GLOBAL_SETTINGS_KEY]: { value: seedShaped(profiles(2_500)), revision: "r1" } })));
	assert.deepEqual(oversizedRecord.value.read, { kind: "unreadable" });
	assert.equal(oversizedRecord.digests, 0, "An oversized record must be refused before classification and hashing");
	assert.deepEqual(oversizedRecord.value.names, ["kv.getVersioned"], "No extra storage call");

	const oversizedLegacy = await countingDigests(() => policy(store({ "settings:sameAs": { value: profiles(2_500), revision: "s1" } })));
	assert.deepEqual(oversizedLegacy.value.read, { kind: "unreadable" });
	assert.equal(oversizedLegacy.digests, 0);
	assert.equal(oversizedLegacy.value.calls.length, 9, "The same nine storage calls");

	// Each legacy envelope fits alone; together they pass the aggregate bound.
	const tenKilobytes = "t".repeat(10_000);
	const aggregate: Record<string, unknown> = {};
	for (const key of LEGACY_SETTINGS_KEYS) {
		if (key === "settings:noindex") continue;
		aggregate[key] = { value: key === "settings:sameAs" ? [tenKilobytes] : tenKilobytes, revision: "a-" + key };
	}
	assert.ok(Object.values(aggregate).every((entry) => JSON.stringify(entry).length < LINK_POLICY_MATERIAL_BYTES));
	assert.ok(JSON.stringify(Object.values(aggregate)).length > LINK_POLICY_MATERIAL_BYTES);
	const aggregated = await countingDigests(() => policy(store(aggregate)));
	assert.deepEqual(aggregated.value.read, { kind: "unreadable" });
	assert.equal(aggregated.digests, 0);
	assert.equal(aggregated.value.calls.length, 9);
	cases.push("single and aggregate oversized envelopes are refused before classification or hashing, with unchanged storage calls");
}

assert.deepEqual(forbidden, [], "An undeclared SDK, KV or context surface was touched");
assert.equal(networkCalls, 0, "The host ports reached the network");
globalThis.fetch = realFetch;
console.log("Internal link host ports selfcheck passed: " + cases.length + " groups");
