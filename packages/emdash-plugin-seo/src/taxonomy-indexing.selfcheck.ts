import assert from "node:assert/strict";
import type { PluginContext } from "emdash/plugin";
import { listIndexingTaxonomies, validateNewArchiveSelections, INDEXING_TAXONOMY_LIST_LIMIT } from "./taxonomy-indexing.ts";
import { SEO_ADMIN_CONTRACT_VERSION } from "./admin-contract.ts";

let reads = 0;
let definitions: unknown = [{ name: "tag", label: "Tags" }, { name: "category", label: "Categories" },
	{ name: "region", label: "Regions" }, { name: "tag", label: "Localized tags" }];
let failing = false;
const denied = () => { throw new Error("No term, entry, assignment, settings or write access in a definition read"); };
const ctx = { taxonomies: { getAll: async () => { reads += 1; if (failing) throw new Error("private host error"); return definitions; },
	getTerms: denied, getTerm: denied, assign: denied }, content: new Proxy({}, { get: denied }), settings: new Proxy({}, { get: denied }) } as unknown as PluginContext;
let result = await listIndexingTaxonomies(ctx);
assert.deepEqual(result, { contractVersion: SEO_ADMIN_CONTRACT_VERSION, available: true,
	items: [{ name: "category", label: "Categories" }, { name: "region", label: "Regions" }, { name: "tag", label: "Tags" }], truncated: false, message: null });
assert.equal(reads, 1);
assert.equal(await validateNewArchiveSelections(ctx, undefined, ["region"]), null);
assert.equal(await validateNewArchiveSelections(ctx, ["deleted"], ["deleted"]), null);
assert.equal(await validateNewArchiveSelections(ctx, [], ["deleted"]), null);
assert.equal(reads, 1, "Unrelated saves, retained unknown choices and removals need no taxonomy read");
assert.equal(await validateNewArchiveSelections(ctx, ["deleted", "region"], ["deleted"]), null);
assert.equal(reads, 2);
assert.match(await validateNewArchiveSelections(ctx, ["invented"], []) ?? "", /available/);
failing = true;
result = await listIndexingTaxonomies(ctx);
assert.equal(result.available, false); assert.deepEqual(result.items, []); assert.equal(result.truncated, false);
assert.doesNotMatch(result.message ?? "", /private host error/);
assert.match(await validateNewArchiveSelections(ctx, ["region"], []) ?? "", /unchanged/);
const before = reads;
assert.equal(await validateNewArchiveSelections(ctx, ["region"], ["region"]), null); assert.equal(reads, before);
failing = false; definitions = [];
result = await listIndexingTaxonomies(ctx); assert.equal(result.available, true); assert.deepEqual(result.items, []);
definitions = [{ name: "../bad", label: "Bad" }]; assert.equal((await listIndexingTaxonomies(ctx)).available, false);
definitions = Array.from({length: INDEXING_TAXONOMY_LIST_LIMIT + 1}, (_, i) => ({ name: `type_${String(i).padStart(3, "0")}`, label: `Type ${i}` }));
result = await listIndexingTaxonomies(ctx); assert.equal(result.items.length, INDEXING_TAXONOMY_LIST_LIMIT); assert.equal(result.truncated, true);
assert.equal(await validateNewArchiveSelections(ctx, ["type_200"], []), null, "Validation checks definitions beyond the bounded display list");
assert.equal((await listIndexingTaxonomies({} as PluginContext)).available, false);
const deniedContext = Object.defineProperty({}, "taxonomies", { get: () => { throw new Error("private permission detail"); } }) as PluginContext;
assert.equal((await listIndexingTaxonomies(deniedContext)).available, false);
console.log("Taxonomy indexing definitions and scoped save validation checks passed.");
