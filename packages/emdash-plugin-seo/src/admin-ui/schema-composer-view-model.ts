import {
	defaultSeoSchemaComposerInput,
	seoSchemaComposerFields,
	type SeoAdminCustomSchema,
	type SeoAdminCustomSchemaInput,
	type SeoSchemaComposerFieldDefinition,
	type SeoSchemaComposerFieldKey,
	type SeoSchemaComposerInput,
	type SeoSchemaComposerRecipe,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

export type SeoSchemaScopeMode = "global" | "collection" | "entry";

export interface SeoSchemaScopeDraft {
	mode: SeoSchemaScopeMode;
	collection: string;
	entry: string;
}

export interface SeoSchemaComposerDraft {
	input: SeoSchemaComposerInput;
	scope: SeoSchemaScopeDraft;
}

export function parseSeoSchemaScope(scope: string): SeoSchemaScopeDraft {
	if (scope === "global") return { mode: "global", collection: "", entry: "" };
	const separator = scope.indexOf(":");
	if (separator < 0) return { mode: "collection", collection: scope, entry: "" };
	return {
		mode: "entry",
		collection: scope.slice(0, separator),
		entry: scope.slice(separator + 1),
	};
}

export function serializeSeoSchemaScope(scope: SeoSchemaScopeDraft): string {
	const collection = scope.collection.trim();
	const entry = scope.entry.trim();
	if (scope.mode === "global") return "global";
	if (scope.mode === "collection") return collection;
	return `${collection}:${entry}`;
}

export function createSeoSchemaComposerDraft(recipe: SeoSchemaComposerRecipe): SeoSchemaComposerDraft {
	const input = defaultSeoSchemaComposerInput(recipe);
	return {
		input: { ...input, values: { ...input.values } },
		scope: parseSeoSchemaScope(input.scope),
	};
}

export function seoSchemaComposerDraftInput(draft: SeoSchemaComposerDraft): SeoSchemaComposerInput {
	return {
		...draft.input,
		scope: serializeSeoSchemaScope(draft.scope),
		values: { ...draft.input.values },
	};
}

const EVENT_PHYSICAL_FIELDS = new Set<SeoSchemaComposerFieldKey>([
	"locationName",
	"streetAddress",
	"addressLocality",
	"addressRegion",
	"postalCode",
	"addressCountry",
]);

export function visibleSeoSchemaComposerFields(
	recipe: SeoSchemaComposerRecipe,
	values: SeoSchemaComposerInput["values"],
): readonly SeoSchemaComposerFieldDefinition[] {
	const fields = seoSchemaComposerFields(recipe);
	if (recipe !== "event") return fields;
	const attendanceMode = values.eventAttendanceMode;
	const showPhysical = attendanceMode !== "https://schema.org/OnlineEventAttendanceMode";
	const showVirtual = attendanceMode !== "https://schema.org/OfflineEventAttendanceMode";
	return fields.filter((field) => {
		if (EVENT_PHYSICAL_FIELDS.has(field.key)) return showPhysical;
		if (field.key === "virtualLocationUrl") return showVirtual;
		return true;
	});
}

export function duplicateSeoAdminCustomSchemaInput(schema: SeoAdminCustomSchema): SeoAdminCustomSchemaInput {
	const suffix = " copy";
	const name = schema.name.length + suffix.length <= 120
		? `${schema.name}${suffix}`
		: `${schema.name.slice(0, 120 - suffix.length).trimEnd()}${suffix}`;
	return {
		name,
		scope: schema.scope,
		json: schema.json,
		enabled: false,
	};
}

/** Matches the visible type name or its schema.org type, so the list never hides a type by its description. */
export function filterSeoSchemaComposerRecipes<T extends { label: string; schemaType: string }>(
	recipes: readonly T[],
	query: string,
): T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...recipes];
	return recipes.filter((recipe) => recipe.label.toLowerCase().includes(needle) || recipe.schemaType.toLowerCase().includes(needle));
}

/** Arrow keys move within the shown list and stop at its ends; other keys keep a shown highlight. */
export function moveSeoSchemaComposerHighlight<K extends string>(shown: readonly K[], current: K | null, key: string): K | null {
	if (!shown.length) return null;
	const index = current === null ? -1 : shown.indexOf(current);
	if (key === "ArrowDown") return shown[index < 0 ? 0 : Math.min(shown.length - 1, index + 1)];
	if (key === "ArrowUp") return shown[index < 0 ? shown.length - 1 : Math.max(0, index - 1)];
	return index < 0 ? shown[0] : shown[index];
}

export interface SeoSchemaComposerTypeUses {
	/** Saved custom schemas that already declare the type, by name. */
	customs: string[];
	/** Enabled built-in defaults that can add the same type, by label. */
	defaults: string[];
}

/** Read-only context for the chosen type; saving still adds a separate record and changes nothing else. */
export function seoSchemaComposerTypeUses(
	schemaType: string,
	customSchemas: readonly Pick<SeoAdminCustomSchema, "id" | "name" | "types">[],
	presets: readonly { label: string; enabled: boolean }[],
	editingId: string | null,
): SeoSchemaComposerTypeUses {
	return {
		customs: customSchemas.filter((schema) => schema.id !== editingId && schema.types.includes(schemaType)).map((schema) => schema.name),
		defaults: presets.filter((preset) => preset.enabled && preset.label === schemaType).map((preset) => preset.label),
	};
}

export function upsertSeoAdminCustomSchema(
	schemas: readonly SeoAdminCustomSchema[],
	schema: SeoAdminCustomSchema,
): SeoAdminCustomSchema[] {
	return [schema, ...schemas.filter((item) => item.id !== schema.id)];
}
