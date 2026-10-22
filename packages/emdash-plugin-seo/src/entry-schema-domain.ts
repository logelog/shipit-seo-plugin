// Values shared by admin-contract.ts and entry-schemas.ts. This module must
// import nothing: an import back into either file reopens the module cycle
// that left bundled schema preset constants uninitialized.

export const SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION = 1 as const;

export function isSeoAdminSchemaScope(value: string): boolean {
	if (value === "global") return true;
	return /^[a-z][a-z0-9_-]{0,63}(?::[A-Za-z0-9][A-Za-z0-9._~%-]{0,119})?$/.test(value);
}

export function extractSeoSchemaTypes(value: unknown): string[] {
	const types = new Set<string>();
	const seen = new WeakSet<object>();
	const visit = (item: unknown, depth: number) => {
		if (depth > 24 || item === null || typeof item !== "object") return;
		if (seen.has(item)) return;
		seen.add(item);
		if (Array.isArray(item)) {
			for (const child of item) visit(child, depth + 1);
			return;
		}
		const object = item as Record<string, unknown>;
		const type = object["@type"];
		if (typeof type === "string" && type.trim()) types.add(type.trim());
		else if (Array.isArray(type)) {
			for (const entry of type)
				if (typeof entry === "string" && entry.trim()) types.add(entry.trim());
		}
		for (const child of Object.values(object)) visit(child, depth + 1);
	};
	visit(value, 0);
	return [...types].slice(0, 24);
}
