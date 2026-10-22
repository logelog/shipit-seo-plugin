import assert from "node:assert/strict";
import { markOwnMetadataContributions } from "./plugin-coexistence-metadata.ts";
import { createPluginCoexistenceMiddleware, installMetadataCoexistenceGuard } from "./plugin-coexistence-middleware.ts";

const own = Object.freeze({ kind: "jsonld", id: "own-schema", graph: { "@type": "Article" } });
const peer = Object.freeze({ kind: "jsonld", id: "peer-schema", graph: { "@type": "BlogPosting" } });
const ownDescription = Object.freeze({ kind: "meta", name: "description", content: "Description" });
markOwnMetadataContributions([own, ownDescription]);
const raw = Object.freeze([peer, own, ownDescription]);
let reads = 0;
const facade = {
	async collectPageMetadata(page: unknown) {
		assert.equal(this, facade);
		assert.ok(page);
		reads += 1;
		return raw;
	},
	async collectPageFragments() { return ["unchanged fragment"]; },
};
const fragments = facade.collectPageFragments;
assert.equal(installMetadataCoexistenceGuard(facade), true);
const wrapped = facade.collectPageMetadata;
assert.equal(installMetadataCoexistenceGuard(facade), true);
assert.equal(facade.collectPageMetadata, wrapped);
const page = { seo: { robots: "noindex" } };
const first = facade.collectPageMetadata(page);
const concurrent = facade.collectPageMetadata(page);
assert.equal(first, concurrent);
const result = await first;
assert.deepEqual(result, [peer, ownDescription]);
assert.notEqual(result, raw);
assert.equal(result[0], peer);
assert.equal(raw[1], own);
assert.equal(reads, 1);
assert.equal(facade.collectPageFragments, fragments);
await facade.collectPageMetadata({ seo: {} });
assert.equal(reads, 2);
console.log("Metadata facade shares one finalization per page and retains the host cache and fragments.");

let otherReads = 0;
const otherFacade = { async collectPageMetadata(_page?: unknown) { otherReads += 1; return raw; } };
assert.equal(installMetadataCoexistenceGuard(otherFacade), true);
await otherFacade.collectPageMetadata(page);
assert.equal(otherReads, 1);
assert.equal(reads, 2);
console.log("Metadata facade lifetime stays request-local.");

const failure = new Error("collector unavailable");
let attempts = 0;
const failedFacade = { async collectPageMetadata(_page?: unknown) { attempts += 1; throw failure; } };
assert.equal(installMetadataCoexistenceGuard(failedFacade), true);
await assert.rejects(failedFacade.collectPageMetadata(page), (error) => error === failure);
await assert.rejects(failedFacade.collectPageMetadata(page), (error) => error === failure);
assert.equal(attempts, 1);
console.log("Metadata collector failures remain failures without an automatic retry.");

for (const unavailable of [null, undefined, {}, Object.freeze({ collectPageMetadata: async () => raw }),
	Object.defineProperty({}, "collectPageMetadata", { get() { throw new Error("do not invoke accessors"); } })]) {
	assert.equal(installMetadataCoexistenceGuard(unavailable), false);
}
console.log("Missing, accessor-only and frozen facades remain unsupported without invoking them.");

let nextCalls = 0;
const middleware = createPluginCoexistenceMiddleware();
const context = { locals: {} } as Parameters<typeof middleware>[0];
const response = new Response("next");
assert.equal(await middleware(context, async () => { nextCalls += 1; return response; }), response);
assert.equal(nextCalls, 1);
console.log("Unsupported facade requests continue through the existing middleware pipeline.");
console.log("Metadata middleware self-checks passed (5 groups).");
