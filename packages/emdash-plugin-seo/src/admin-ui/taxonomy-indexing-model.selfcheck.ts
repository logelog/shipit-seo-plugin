import assert from "node:assert/strict";
import { SEO_ADMIN_CONTRACT_VERSION } from "../admin-contract.ts";
import { parseIndexingTaxonomies } from "./taxonomy-indexing-model.ts";

const valid = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, available: true,
	items: [{name: "category", label: "Categories"}, {name: "region", label: "Regions"}], truncated: false, message: null };
const parsed = parseIndexingTaxonomies(valid);
assert.deepEqual(parsed, valid); assert.notEqual(parsed.items, valid.items);
assert.equal(parseIndexingTaxonomies({...valid, items: []}).available, true);
assert.equal(parseIndexingTaxonomies({...valid, available:false, items:[], message:"Try again"}).available, false);
for (const broken of [null, [], {...valid, contractVersion:0}, {...valid, available:"true"}, {...valid, truncated:true},
	{...valid, available:false}, {...valid, message:"Loaded"}, {...valid, items:[{name:"../bad",label:"Bad"}]},
	{...valid, items:[{name:"tag",label:""}]}, {...valid, items:[valid.items[1],valid.items[0]]},
	{...valid, items:[valid.items[0],valid.items[0]]}, {...valid, items:[{name:"category",label:"a".repeat(201)}]}]) {
	assert.throws(() => parseIndexingTaxonomies(broken), /Invalid SEO admin response|engine\/admin mismatch/);
}
console.log("Taxonomy indexing admin parser checks passed.");
