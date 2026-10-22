// Membership and ancestry for the generated Schema.org LocalBusiness catalogue.
// Validation, draft loading, field visibility, output and public inspection all
// ask these functions, so a type means the same thing everywhere.
// No React, DOM, Node, SQL or network dependencies.

import {
	LOCAL_BUSINESS_CATALOGUE_SOURCE,
	LOCAL_BUSINESS_EXCLUDED_TYPES,
	LOCAL_BUSINESS_EXTERNAL_PARENTS,
	LOCAL_BUSINESS_TYPE_ROWS,
} from "./local-business-types.ts";

export { LOCAL_BUSINESS_CATALOGUE_SOURCE };

export type LocalBusinessType = (typeof LOCAL_BUSINESS_TYPE_ROWS)[number][0];

export interface LocalBusinessTypeInfo {
	id: LocalBusinessType;
	/** A readable name derived from the identifier. */
	label: string;
	/** Direct parents as Schema.org names, in the release's multiple inheritance. */
	parents: readonly string[];
	/** Set for types from a hosted Schema.org extension that is part of the release. */
	extension: "health-lifesci" | null;
}

export const LOCAL_BUSINESS_TYPES: readonly LocalBusinessTypeInfo[] = LOCAL_BUSINESS_TYPE_ROWS.map((row) => ({
	id: row[0],
	label: row[1],
	parents: row[2],
	extension: (row as readonly unknown[])[3] === "health-lifesci" ? "health-lifesci" : null,
}));

const BY_ID = new Map<string, LocalBusinessTypeInfo>(LOCAL_BUSINESS_TYPES.map((info) => [info.id, info]));
const EXTERNAL = new Map<string, { label: string; parents: readonly string[] }>(Object.entries(LOCAL_BUSINESS_EXTERNAL_PARENTS));
const EXCLUDED = new Map<string, { parents: readonly string[]; reason: string }>(
	LOCAL_BUSINESS_EXCLUDED_TYPES.map((item) => [item.id, { parents: item.parents, reason: item.reason }]),
);

export function isLocalBusinessType(value: unknown): value is LocalBusinessType {
	return typeof value === "string" && BY_ID.has(value);
}

export function localBusinessTypeInfo(value: unknown): LocalBusinessTypeInfo | null {
	return typeof value === "string" ? BY_ID.get(value) ?? null : null;
}

/** Why a LocalBusiness class in the release cannot be chosen, or null. */
export function localBusinessTypeExclusion(value: unknown): string | null {
	return typeof value === "string" ? EXCLUDED.get(value)?.reason ?? null : null;
}

/** A readable name for any class the catalogue names, falling back to the identifier. */
export function localBusinessClassLabel(name: string): string {
	return BY_ID.get(name)?.label ?? EXTERNAL.get(name)?.label ?? name;
}

function parentsOf(name: string): readonly string[] {
	return BY_ID.get(name)?.parents ?? EXCLUDED.get(name)?.parents ?? EXTERNAL.get(name)?.parents ?? [];
}

/**
 * Every ancestor of a catalogue or excluded type up to Organization and Place,
 * nearest first, each once. Thing is left out. Empty for unknown names.
 */
export function localBusinessAncestors(name: string): string[] {
	if (!BY_ID.has(name) && !EXCLUDED.has(name)) return [];
	const seen = new Set<string>();
	const queue = [...parentsOf(name)];
	while (queue.length) {
		const next = queue.shift()!;
		if (next === "Thing" || seen.has(next)) continue;
		seen.add(next);
		queue.push(...parentsOf(next));
	}
	return [...seen];
}

/** Whether a type is the given class or inherits from it through any parent. */
export function localBusinessTypeIsA(name: unknown, ancestor: string): boolean {
	if (typeof name !== "string") return false;
	if (!BY_ID.has(name) && !EXCLUDED.has(name)) return false;
	return name === ancestor || localBusinessAncestors(name).includes(ancestor);
}

/** Cuisine, menu and reservation details belong to this family. */
export function isFoodEstablishmentType(name: unknown): boolean {
	return localBusinessTypeIsA(name, "FoodEstablishment");
}

const PUBLISHER_TYPES_OUTSIDE_CATALOGUE = new Set(["Organization", "Person", "Corporation", "NGO", "MedicalOrganization"]);

/**
 * Types a page may use for a site publisher: Person, Organization and its
 * common subtypes, and every LocalBusiness class in the release, including the
 * excluded ones that older or hand-written graphs may still carry.
 */
export function isPublisherSchemaType(name: unknown): boolean {
	return typeof name === "string" && (PUBLISHER_TYPES_OUTSIDE_CATALOGUE.has(name) || BY_ID.has(name) || EXCLUDED.has(name));
}

function searchable(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Matches the readable name or the identifier, ignoring case, spaces and punctuation. */
export function localBusinessTypeMatches(info: Pick<LocalBusinessTypeInfo, "id" | "label">, query: string): boolean {
	const needle = searchable(query);
	if (!needle) return true;
	return searchable(info.label).includes(needle) || searchable(info.id).includes(needle);
}
