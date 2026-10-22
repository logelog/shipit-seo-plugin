// EmDash adapter for the shared entry schema commands, written against the
// published 1.1.0 plugin context: `ctx.content.get` for the exact entry and the
// plugin's own `schemas` storage collection with per-row revisions.
import type { PluginContext } from "emdash";

import type { EntrySchemaHost, EntrySchemaHostEntry } from "./entry-schemas.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The entry fields the schema commands compare, normalized from a loaded content item. */
export function toEntrySchemaHostEntry(value: unknown): EntrySchemaHostEntry {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.status !== "string" ||
		!(value.locale === null || value.locale === undefined || typeof value.locale === "string") ||
		!(value.slug === null || value.slug === undefined || typeof value.slug === "string")
	) {
		throw new Error("EmDash returned an unexpected content item");
	}
	const data = isRecord(value.data) ? value.data : {};
	// Matches the slug the public page context and legacy alias scopes use.
	const slug = typeof value.slug === "string" && value.slug ? value.slug : typeof data.slug === "string" ? data.slug : null;
	return { id: value.id, slug, locale: typeof value.locale === "string" ? value.locale : null, status: value.status };
}

/** Null when the host lacks content reads or versioned plugin storage. */
export function emdashEntrySchemaHost(
	ctx: PluginContext,
	options: Pick<EntrySchemaHost, "hasCollection" | "schemaOutputEnabled" | "businessIdentityConflict">,
): EntrySchemaHost | null {
	const content = ctx.content;
	const schemas = ctx.storage?.schemas;
	if (
		typeof content?.get !== "function" ||
		typeof schemas?.query !== "function" ||
		typeof schemas.getVersioned !== "function" ||
		typeof schemas.compareAndSet !== "function" ||
		typeof schemas.compareAndDelete !== "function" ||
		typeof schemas.count !== "function"
	) {
		return null;
	}
	return {
		...options,
		async getEntry(collection, id) {
			const item = await content.get(collection, id);
			return item ? toEntrySchemaHostEntry(item) : null;
		},
		schemas: {
			query: (options) => schemas.query(options as Parameters<typeof schemas.query>[0]),
			getVersioned: (id) => schemas.getVersioned(id),
			compareAndSet: (id, expectedRevision, data) => schemas.compareAndSet(id, expectedRevision, data),
			compareAndDelete: (id, expectedRevision) => schemas.compareAndDelete(id, expectedRevision),
			count: () => schemas.count(),
		},
		now: () => new Date().toISOString(),
	};
}
