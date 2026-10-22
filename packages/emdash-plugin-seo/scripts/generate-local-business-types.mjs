// Developer tool: regenerates src/local-business-types.ts from a local copy of
// one released Schema.org dataset. It never fetches anything and is not part of
// the packed plugin.
//
//   node scripts/generate-local-business-types.mjs <schemaorg-current-https.jsonld> [--check]
//
// The input must match RELEASE.sha256. A new release needs a reviewed diff of
// the generated file and a compatibility decision: a type that disappears from
// the catalogue makes stored records that use it invalid, and older records are
// never coerced to another type.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RELEASE = {
	version: "30.1",
	released: "2026-09-16",
	dataset: "schemaorg-current-https.jsonld",
	sha256: "0a4b8c4c910fc831ec8695196510973390906a5ee34dc6b862dfec4d21a12f74",
};

const ROOT = "schema:LocalBusiness";

// Reviewed: still classes in the release, but their own descriptions deprecate
// them. Every other "deprecated" description stops the generator for review.
const REVIEWED_DEPRECATIONS = {
	"schema:Attorney": "Deprecated by Schema.org in favour of LegalService.",
	"schema:ProfessionalService": "Deprecated by Schema.org because it was confused with Service.",
};

const EXTENSIONS = {
	"https://health-lifesci.schema.org": "health-lifesci",
};
// Not part of the released core vocabulary; such classes are left out and listed.
const UNRELEASED_PARTS = new Set(["https://pending.schema.org", "https://attic.schema.org"]);

const OUTPUT = fileURLToPath(new URL("../src/local-business-types.ts", import.meta.url));

function fail(message) {
	console.error(`generate-local-business-types: ${message}`);
	process.exit(1);
}

function ids(value) {
	if (value === undefined || value === null) return [];
	return (Array.isArray(value) ? value : [value]).map((item) => (item && typeof item === "object" ? item["@id"] : item));
}

function text(value) {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && typeof value["@value"] === "string") return value["@value"];
	if (Array.isArray(value)) {
		const english = value.find((item) => item && typeof item === "object" && item["@language"] === "en");
		return text(english ?? value[0]);
	}
	return "";
}

function local(id) {
	if (!id.startsWith("schema:")) fail(`unexpected identifier ${id}`);
	return id.slice("schema:".length);
}

/** "HVACBusiness" -> "HVAC business", "CafeOrCoffeeShop" -> "Cafe or coffee shop". */
function readable(label) {
	const words = label
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.split(" ");
	const sentence = words.map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase())).join(" ");
	return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function compareIds(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const input = args.find((arg) => !arg.startsWith("--"));
if (!input) fail("pass the path of a local schemaorg-current-https.jsonld file");

const bytes = readFileSync(input);
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== RELEASE.sha256) fail(`input SHA-256 ${digest} is not the Schema.org ${RELEASE.version} release ${RELEASE.sha256}`);

const graph = JSON.parse(bytes.toString("utf8"))["@graph"];
if (!Array.isArray(graph)) fail("the dataset has no @graph");
const nodes = new Map(graph.map((node) => [node["@id"], node]));
const isClass = (id) => ids(nodes.get(id)?.["@type"]).includes("rdfs:Class");

const children = new Map();
for (const node of graph) {
	if (!isClass(node["@id"])) continue;
	for (const parent of ids(node["rdfs:subClassOf"])) {
		if (!children.has(parent)) children.set(parent, []);
		children.get(parent).push(node["@id"]);
	}
}

const family = new Set([ROOT]);
const queue = [ROOT];
while (queue.length) {
	for (const child of children.get(queue.shift()) ?? []) {
		if (!family.has(child)) {
			family.add(child);
			queue.push(child);
		}
	}
}

const rows = [];
const excluded = [];
for (const id of [...family].sort(compareIds)) {
	const node = nodes.get(id);
	const parents = ids(node["rdfs:subClassOf"]).sort(compareIds);
	const parts = ids(node["schema:isPartOf"]);
	const comment = text(node["rdfs:comment"]);
	const label = text(node["rdfs:label"]);
	if (label !== local(id)) fail(`${id} has the label ${JSON.stringify(label)}`);
	if (REVIEWED_DEPRECATIONS[id]) {
		if (!/deprecated/i.test(comment)) fail(`${id} is listed as deprecated but its description no longer says so`);
		excluded.push({ id: local(id), parents: parents.map(local), reason: REVIEWED_DEPRECATIONS[id] });
		continue;
	}
	if (/deprecated/i.test(comment)) fail(`${id} is described as deprecated; review it and add it to REVIEWED_DEPRECATIONS`);
	if (node["schema:supersededBy"] !== undefined) {
		excluded.push({ id: local(id), parents: parents.map(local), reason: `Superseded by ${ids(node["schema:supersededBy"]).map(local).join(", ")}.` });
		continue;
	}
	const unreleased = parts.find((part) => UNRELEASED_PARTS.has(part));
	if (unreleased) {
		excluded.push({ id: local(id), parents: parents.map(local), reason: `Part of ${unreleased}, not the released vocabulary.` });
		continue;
	}
	const unknownPart = parts.find((part) => !EXTENSIONS[part]);
	if (unknownPart) fail(`${id} is part of ${unknownPart}; review it before adding it`);
	const extension = parts.map((part) => EXTENSIONS[part])[0];
	rows.push({ id: local(id), label: readable(label), parents: parents.map(local), ...(extension ? { extension } : {}) });
}

for (const deprecated of Object.keys(REVIEWED_DEPRECATIONS)) {
	if (!family.has(deprecated)) fail(`${deprecated} is no longer a LocalBusiness class; review REVIEWED_DEPRECATIONS`);
}

// Every parent must be a selectable type or a class outside the LocalBusiness
// family; an excluded type in between would cut a selectable type off its ancestry.
const selectable = new Set(rows.map((row) => row.id));
const external = new Map();
const addExternal = (name) => {
	const id = `schema:${name}`;
	if (external.has(name) || name === "Thing") return;
	if (!isClass(id)) fail(`${id} is named as a parent but is not a class`);
	const parents = ids(nodes.get(id)["rdfs:subClassOf"]).sort(compareIds).map(local);
	external.set(name, parents);
	for (const parent of parents) addExternal(parent);
};
for (const row of rows) {
	for (const parent of row.parents) {
		if (selectable.has(parent)) continue;
		if (family.has(`schema:${parent}`)) fail(`${row.id} inherits from the excluded type ${parent}`);
		addExternal(parent);
	}
}

const quote = (value) => JSON.stringify(value);
const lines = [
	`// LocalBusiness types from the Schema.org ${RELEASE.version} release. Do not edit by hand:`,
	"// run scripts/generate-local-business-types.mjs on the verified dataset and",
	"// review the diff. Derived from the Schema.org vocabulary (https://schema.org),",
	"// licensed under CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).",
	"",
	"export const LOCAL_BUSINESS_CATALOGUE_SOURCE = {",
	'\tvocabulary: "Schema.org",',
	`\trelease: ${quote(RELEASE.version)},`,
	`\treleased: ${quote(RELEASE.released)},`,
	`\tdataset: ${quote(RELEASE.dataset)},`,
	`\tsha256: ${quote(RELEASE.sha256)},`,
	'\tlicence: "CC BY-SA 3.0",',
	'\tlicenceUrl: "https://creativecommons.org/licenses/by-sa/3.0/",',
	`\treleaseUrl: ${quote(`https://github.com/schemaorg/schemaorg/tree/main/data/releases/${RELEASE.version}`)},`,
	"} as const;",
	"",
	"/** Classes outside the LocalBusiness family that catalogue types inherit from: readable name and parents. */",
	"export const LOCAL_BUSINESS_EXTERNAL_PARENTS = {",
	...[...external.keys()]
		.sort(compareIds)
		.map((name) => `\t${name}: { label: ${quote(readable(name))}, parents: [${external.get(name).map(quote).join(", ")}] },`),
	"} as const;",
	"",
	"/** LocalBusiness classes in the release that new identities cannot choose. */",
	"export const LOCAL_BUSINESS_EXCLUDED_TYPES = [",
	...excluded.map((item) => `\t{ id: ${quote(item.id)}, parents: [${item.parents.map(quote).join(", ")}], reason: ${quote(item.reason)} },`),
	"] as const;",
	"",
	"/** Selectable types: [identifier, readable name, direct parents, extension]. */",
	"export const LOCAL_BUSINESS_TYPE_ROWS = [",
	...rows.map((row) =>
		`\t[${quote(row.id)}, ${quote(row.label)}, [${row.parents.map(quote).join(", ")}]${row.extension ? `, ${quote(row.extension)}` : ""}],`,
	),
	"] as const;",
	"",
];
const output = lines.join("\n");

if (check) {
	let current = "";
	try {
		current = readFileSync(OUTPUT, "utf8");
	} catch {
		fail(`${OUTPUT} does not exist`);
	}
	if (current !== output) fail("src/local-business-types.ts differs from the release; regenerate it and review the diff");
	console.log(`local business types match Schema.org ${RELEASE.version}: ${rows.length} selectable, ${excluded.length} excluded`);
} else {
	writeFileSync(OUTPUT, output);
	console.log(`wrote ${rows.length} selectable types and ${excluded.length} exclusions from Schema.org ${RELEASE.version}`);
}
