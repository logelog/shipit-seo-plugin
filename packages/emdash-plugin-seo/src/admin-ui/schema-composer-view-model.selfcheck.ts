import {
	SEO_SCHEMA_COMPOSER_RECIPES,
	seoSchemaComposerFields,
	type SeoAdminCustomSchema,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	createSeoSchemaComposerDraft,
	duplicateSeoAdminCustomSchemaInput,
	filterSeoSchemaComposerRecipes,
	moveSeoSchemaComposerHighlight,
	parseSeoSchemaScope,
	seoSchemaComposerTypeUses,
	seoSchemaComposerDraftInput,
	serializeSeoSchemaScope,
	upsertSeoAdminCustomSchema,
	visibleSeoSchemaComposerFields,
} from "./schema-composer-view-model.ts";

let failures = 0;

function check(label: string, condition: boolean) {
	if (condition) console.log(`ok - ${label}`);
	else {
		failures += 1;
		console.error(`not ok - ${label}`);
	}
}

for (const recipe of SEO_SCHEMA_COMPOSER_RECIPES) {
	const draft = createSeoSchemaComposerDraft(recipe.key);
	check(`${recipe.label} draft selects its recipe`, draft.input.recipe === recipe.key);
	check(`${recipe.label} draft clones recipe values`, draft.input.values !== createSeoSchemaComposerDraft(recipe.key).input.values);
	check(`${recipe.label} exposes common and recipe fields`, seoSchemaComposerFields(recipe.key).length >= 8);
	check(`${recipe.label} serializes its default scope`, seoSchemaComposerDraftInput(draft).scope === draft.input.scope);
}

const eventDraft = createSeoSchemaComposerDraft("event");
const physicalEventFields = visibleSeoSchemaComposerFields("event", eventDraft.input.values).map((field) => field.key);
check("physical Event shows address fields", physicalEventFields.includes("streetAddress"));
check("physical Event hides the online URL", !physicalEventFields.includes("virtualLocationUrl"));
const onlineEventFields = visibleSeoSchemaComposerFields("event", {
	...eventDraft.input.values,
	eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
}).map((field) => field.key);
check("online Event hides address fields", !onlineEventFields.includes("streetAddress"));
check("online Event shows the virtual URL", onlineEventFields.includes("virtualLocationUrl"));
const mixedEventFields = visibleSeoSchemaComposerFields("event", {
	...eventDraft.input.values,
	eventAttendanceMode: "https://schema.org/MixedEventAttendanceMode",
}).map((field) => field.key);
check("mixed Event shows both location modes", mixedEventFields.includes("streetAddress") && mixedEventFields.includes("virtualLocationUrl"));

check("global scope round-trips", serializeSeoSchemaScope(parseSeoSchemaScope("global")) === "global");
check("collection scope round-trips", serializeSeoSchemaScope(parseSeoSchemaScope("posts")) === "posts");
check("entry scope round-trips", serializeSeoSchemaScope(parseSeoSchemaScope("pages:contact")) === "pages:contact");
check(
	"scope serializer trims user input",
	serializeSeoSchemaScope({ mode: "entry", collection: " pages ", entry: " contact " }) === "pages:contact",
);

const sourceSchema: SeoAdminCustomSchema = {
	id: "schema-course",
	name: "Course schema",
	scope: "pages:academy",
	json: '{"@context":"https://schema.org","@type":"Course","name":"Academy"}',
	enabled: true,
	storageVersion: 1,
	types: ["Course"],
	valid: true,
	validationError: null,
	createdAt: "2026-07-14T10:00:00.000Z",
	updatedAt: "2026-07-14T10:00:00.000Z",
};
const duplicate = duplicateSeoAdminCustomSchemaInput(sourceSchema);
check("duplicate removes the source identifier", !("id" in duplicate));
check("duplicate preserves scope and JSON", duplicate.scope === sourceSchema.scope && duplicate.json === sourceSchema.json);
check("duplicate is disabled until explicitly enabled", duplicate.enabled === false);
check("duplicate receives a recognizable name", duplicate.name === "Course schema copy");

const replacement = { ...sourceSchema, name: "Updated course", updatedAt: "2026-07-14T11:00:00.000Z" };
const inserted = { ...sourceSchema, id: "schema-howto", name: "HowTo schema" };
const upserted = upsertSeoAdminCustomSchema([sourceSchema, inserted], replacement);
check("upsert places the saved schema first", upserted[0] === replacement);
check("upsert replaces instead of duplicating an identifier", upserted.filter((item) => item.id === sourceSchema.id).length === 1);
check("upsert preserves unrelated schemas", upserted.some((item) => item.id === inserted.id));

const keysFor = (query: string) => filterSeoSchemaComposerRecipes(SEO_SCHEMA_COMPOSER_RECIPES, query).map((recipe) => recipe.key).join(",");
check("an empty search lists every guided type in order", keysFor("  ") === SEO_SCHEMA_COMPOSER_RECIPES.map((recipe) => recipe.key).join(","));
check("typing prod filters to Product", keysFor("prod") === "product");
check("search ignores case and surrounding space", keysFor("  JOB ") === "jobPosting");
check("search matches the schema.org type as well as the label", keysFor("videoobject") === "videoObject" && keysFor("softwareapp") === "softwareApplication");
check("search never matches a type by its description only", keysFor("ordered steps") === "" && keysFor("purchasable") === "");
check("no match leaves an empty list", keysFor("no such type") === "");
check("descriptions make no rich-result promise", SEO_SCHEMA_COMPOSER_RECIPES.every((recipe) => !/rich result|eligib|guarantee|Google/i.test(recipe.description)));
const shown = ["howTo", "course", "product"] as const;
check("ArrowDown moves to the next type", moveSeoSchemaComposerHighlight(shown, "howTo", "ArrowDown") === "course");
check("ArrowDown stops at the last type", moveSeoSchemaComposerHighlight(shown, "product", "ArrowDown") === "product");
check("ArrowUp stops at the first type", moveSeoSchemaComposerHighlight(shown, "howTo", "ArrowUp") === "howTo");
check("ArrowUp from no highlight starts at the end", moveSeoSchemaComposerHighlight(shown, null, "ArrowUp") === "product");
check("a filtered-out highlight falls back to the first shown type", moveSeoSchemaComposerHighlight(shown, "event" as never, "Enter") === "howTo");
check("an empty list has no highlight", moveSeoSchemaComposerHighlight([], "howTo" as never, "ArrowDown") === null);
const uses = seoSchemaComposerTypeUses("Product", [
	{ id: "schema-a", name: "Shoe offer", types: ["Product"] },
	{ id: "schema-b", name: "Course page", types: ["Course"] },
	{ id: "schema-c", name: "Edited product", types: ["Product", "Offer"] },
], [{ label: "Product", enabled: true }, { label: "Event", enabled: true }, { label: "Product", enabled: false }], "schema-c");
check("type uses list other saved schemas of the type, excluding the record under edit", uses.customs.join("|") === "Shoe offer");
check("type uses list enabled defaults of the same type only", uses.defaults.join("|") === "Product");
const quiet = seoSchemaComposerTypeUses("HowTo", [{ id: "schema-b", name: "Course page", types: ["Course"] }], [{ label: "Product", enabled: true }], null);
check("an unused type reports nothing", quiet.customs.length === 0 && quiet.defaults.length === 0);

if (failures) {
	console.error(`\n${failures} schema composer view-model self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nSchema composer view-model self-checks passed.");
}
