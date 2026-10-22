export interface SchemaVersionedValue {
	value: unknown;
	revision: string;
}

export interface SchemaConditionalStore {
	getVersioned(id: string): Promise<unknown>;
	compareAndSet(id: string, expectedRevision: string | null, value: unknown): Promise<unknown>;
	compareAndDelete(id: string, expectedRevision: string): Promise<unknown>;
}

export function validSchemaWriteRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export function schemaConditionalStore(value: unknown): SchemaConditionalStore | null {
	if (!value || typeof value !== "object") return null;
	const store = value as Partial<SchemaConditionalStore>;
	return typeof store.getVersioned === "function" &&
		typeof store.compareAndSet === "function" &&
		typeof store.compareAndDelete === "function" ? store as SchemaConditionalStore : null;
}

export async function readSchemaVersioned(store: SchemaConditionalStore, id: string): Promise<SchemaVersionedValue | null> {
	const envelope = await store.getVersioned(id);
	if (envelope === null) return null;
	if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
		!Object.hasOwn(envelope, "value") ||
		!validSchemaWriteRevision((envelope as SchemaVersionedValue).revision)) {
		throw new Error("Invalid versioned schema storage result");
	}
	return { value: (envelope as SchemaVersionedValue).value, revision: (envelope as SchemaVersionedValue).revision };
}

export async function writeSchemaConditional(
	store: SchemaConditionalStore,
	id: string,
	expectedRevision: string | null,
	value: unknown,
): Promise<{ applied: true; revision: string } | { applied: false }> {
	const result = await store.compareAndSet(id, expectedRevision, value);
	if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid schema write result");
	if ((result as { applied?: unknown }).applied === false) return { applied: false };
	if ((result as { applied?: unknown }).applied !== true || !validSchemaWriteRevision((result as { revision?: unknown }).revision) ||
		(result as { revision?: unknown }).revision === expectedRevision)
		throw new Error("Unconfirmed schema write revision");
	return { applied: true, revision: (result as { revision: string }).revision };
}

export async function deleteSchemaConditional(store: SchemaConditionalStore, id: string, expectedRevision: string): Promise<boolean> {
	const result = await store.compareAndDelete(id, expectedRevision);
	if (!result || typeof result !== "object" || Array.isArray(result) ||
		typeof (result as { applied?: unknown }).applied !== "boolean") throw new Error("Invalid schema delete result");
	return (result as { applied: boolean }).applied;
}
