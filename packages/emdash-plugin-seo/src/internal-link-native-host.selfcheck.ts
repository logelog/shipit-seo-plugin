import assert from "node:assert/strict";

import type { PluginContext } from "emdash";

import { SEO_ADMIN_SETTINGS_STORAGE_VERSION } from "./admin-contract.ts";
import { savedContentVersion } from "./admin-ui/saved-content-snapshot.ts";
import { createLinkNativeHostFactory } from "./internal-link-native-host.ts";
import { createLinkSuggestionRuntime } from "./internal-link-runtime.ts";
import { GLOBAL_SETTINGS_KEY } from "./settings-runtime.ts";

// ---------------------------------------------------------------------------
// A recording database and context. The database answers every SELECT with no
// rows, which the native ports read as a missing collection; anything other
// than a SELECT, or an undeclared context surface, is a forbidden operation.

const forbidden: string[] = [];

function recordingDatabase(queries: string[]) {
	const builder = (table: string) => {
		queries.push(table);
		const chain: Record<string, (...args: unknown[]) => unknown> = {
			select: () => chain, leftJoin: () => chain, where: () => chain, orderBy: () => chain, limit: () => chain,
			execute: async () => [],
			executeTakeFirst: async () => undefined,
		};
		return new Proxy(chain, {
			get(target, key) {
				if (typeof key === "string" && !Object.hasOwn(target, key)) forbidden.push("query." + key);
				return target[key as string];
			},
		});
	};
	return new Proxy({ selectFrom: builder }, {
		get(target, key) {
			if (typeof key === "string" && key !== "selectFrom" && key !== "then") forbidden.push("db." + key);
			return (target as Record<string, unknown>)[key as string];
		},
	});
}

const STAMP = "2026-10-04T12:00:00.000Z";
const SOURCE_ID = "01KSOURCE00000000000000001";
const sourceRow = (collection: string, id: string) => ({
	id, type: collection, slug: "spring-plan", status: "published", locale: "en", createdAt: STAMP, updatedAt: STAMP, publishedAt: STAMP,
	version: 1, draftRevisionId: null,
	data: { content: [{ _type: "block", _key: "b1", style: "normal", markDefs: [], children: [{ _type: "span", _key: "s1", text: "Drip irrigation notes.", marks: [] }] }] },
});

function context(calls: string[]) {
	const surface = (name: string, methods: Record<string, (...args: any[]) => unknown>) => new Proxy({}, {
		get(_target, key) {
			if (typeof key !== "string" || key === "then") return undefined;
			const method = methods[key];
			if (method) return async (...args: unknown[]) => {
				calls.push(name + "." + key);
				return method(...args);
			};
			if (key !== "getRevision") forbidden.push(name + "." + key);
			return undefined;
		},
	});
	const parts: Record<string, unknown> = {
		site: { name: "Garden", url: "https://example.com", locale: "en" },
		log: { warn() {}, info() {}, error() {}, debug() {} },
		schema: surface("schema", {
			getCollection: (slug: string) => ({ slug, label: "Posts", hidden: false, routable: true, fields: [{ slug: "content", type: "portableText" }] }),
		}),
		content: surface("content", { get: (collection: string, id: string) => sourceRow(collection, id) }),
		kv: surface("kv", {
			getVersioned: (key: string) => key === GLOBAL_SETTINGS_KEY ? {
				value: {
					version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: STAMP, siteName: "Garden", siteUrl: "https://example.com",
					organizationName: "Garden", organizationLogo: "", socialProfiles: [], defaultSocialImage: "", twitterHandle: "",
					noindex: false, indexingPreferenceConfirmed: true,
				},
				revision: "settings-1",
			} : null,
		}),
	};
	return new Proxy(parts, {
		get(target, key) {
			if (typeof key !== "string" || key === "then") return undefined;
			if (!Object.hasOwn(target, key)) forbidden.push("ctx." + key);
			return target[key];
		},
	}) as unknown as PluginContext;
}

const scope = {
	collection: "guides", locale: "en", taxonomy: null, termIds: [] as string[],
	scopeVersion: "link-scope-v1:sha256-" + "0".repeat(64), upperId: null,
};
const ref = { collection: "guides", entryId: "01KG0000000000000000000003" };
const budget = { candidateRows: 200, scopeMatches: 25 };

// ---------------------------------------------------------------------------
// The factory is inert; one invocation opens the database at most once

for (const options of [undefined, {}, { openDatabase: 7 }]) {
	assert.throws(() => createLinkNativeHostFactory(options as never), TypeError);
}

{
	const queries: string[] = [];
	const calls: string[] = [];
	let opens = 0;
	const factory = createLinkNativeHostFactory({ openDatabase: async () => { opens += 1; return recordingDatabase(queries); } });
	assert.equal(opens, 0, "Creating the factory opens nothing");

	const ctx = context(calls);
	const first = factory.open(ctx);
	assert.equal(opens, 0, "Opening the ports reads nothing");
	assert.deepEqual(calls, []);
	const policy = await first.policy.readPolicy();
	assert.equal(policy.kind, "readable");
	assert.deepEqual(calls, ["kv.getVersioned"]);
	assert.equal(opens, 0, "Settings reads do not open the database");

	assert.deepEqual(await first.candidates.resolveScope({ collection: "guides", locale: "en", taxonomy: null }, ["guides"]),
		{ kind: "invalid", reason: "collection-unavailable" }, "Scope resolution reaches the native port over the opened database");
	await assert.rejects(() => first.candidates.page(scope, null, budget), (error: unknown) =>
		error instanceof Error && error.name === "LinkCandidatePageRefusal");
	const queriesBeforeTarget = queries.length;
	assert.deepEqual(await first.targets.readTarget(ref, scope, policy.kind === "readable" ? policy.version : ""), { kind: "unavailable" });
	assert.ok(queries.length > queriesBeforeTarget, "This invocation's policy observation lets its target port read");
	assert.equal(opens, 1, "Every native port of one invocation shares one opening");

	// Another invocation has fresh ports and no observation from the first.
	const second = factory.open(ctx);
	assert.notEqual(second, first);
	assert.notEqual(second.policy, first.policy);
	const queriesBeforeSecond = queries.length;
	assert.deepEqual(await second.targets.readTarget(ref, scope, policy.kind === "readable" ? policy.version : ""), { kind: "unavailable" });
	assert.equal(queries.length, queriesBeforeSecond, "Another invocation's policy observation is not shared");
	assert.equal(opens, 2, "A second invocation opens its own database handle");
}

{
	// A failed opening refuses every native port honestly, is not retried and adds no connection.
	let opens = 0;
	const failure = new Error("Synthetic database opening failure");
	const factory = createLinkNativeHostFactory({ openDatabase: async () => { opens += 1; throw failure; } });
	const ports = factory.open(context([]));
	const same = (error: unknown) => error === failure;
	await assert.rejects(() => ports.candidates.resolveScope({ collection: "guides", locale: "en", taxonomy: null }, ["guides"]), same);
	await assert.rejects(() => ports.candidates.page(scope, null, budget), same);
	await assert.rejects(() => ports.targets.readTarget(ref, scope, "link-policy-v1:sha256-" + "0".repeat(64)), same);
	assert.equal(opens, 1);
	await assert.rejects(() => factory.open(context([])).candidates.page(scope, null, budget), same);
	assert.equal(opens, 2, "No failure is cached across invocations");
}

{
	// The assembled ports drive the shared runtime: the SDK source, then native scope resolution.
	const queries: string[] = [];
	const calls: string[] = [];
	let opens = 0;
	const factory = createLinkNativeHostFactory({ openDatabase: async () => { opens += 1; return recordingDatabase(queries); } });
	const runtime = createLinkSuggestionRuntime({ ports: { kind: "available", ports: factory.open(context(calls)) }, allowedCollections: ["guides"] });
	const result = await runtime.find({
		source: { collection: "posts", entryId: SOURCE_ID, locale: "en", sourceVersion: savedContentVersion(sourceRow("posts", SOURCE_ID)) },
		generation: 1,
		destination: { collection: "guides", taxonomy: null },
	});
	assert.deepEqual(result, { kind: "invalid", reason: "collection-unavailable" });
	assert.deepEqual(calls, ["schema.getCollection", "content.get"], "The SDK source is read before the native scope");
	assert.equal(opens, 1);
	assert.equal(queries[0], "_emdash_collections");
}

assert.deepEqual(forbidden, [], "A forbidden database or context operation was touched");
console.log("Internal link native host selfcheck passed");
