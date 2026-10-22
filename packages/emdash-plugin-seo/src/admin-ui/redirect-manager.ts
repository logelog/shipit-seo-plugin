export interface CoreRedirectRule {
	id: string;
	source: string;
	destination: string;
	type: number;
	isPattern: boolean;
	enabled: boolean;
	hits: number;
	lastHitAt: string | null;
	groupName: string | null;
	auto: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface CoreRedirectInventory {
	rules: CoreRedirectRule[];
	complete: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCoreRedirectRule(value: unknown): CoreRedirectRule {
	if (!isRecord(value)) throw new Error("Invalid core redirect response");
	if (
		typeof value.id !== "string"
		|| typeof value.source !== "string"
		|| typeof value.destination !== "string"
		|| typeof value.type !== "number"
		|| !Number.isInteger(value.type)
		|| typeof value.isPattern !== "boolean"
		|| typeof value.enabled !== "boolean"
		|| typeof value.hits !== "number"
		|| !Number.isInteger(value.hits)
		|| !(value.lastHitAt === null || typeof value.lastHitAt === "string")
		|| !(value.groupName === null || typeof value.groupName === "string")
		|| typeof value.auto !== "boolean"
		|| typeof value.createdAt !== "string"
		|| typeof value.updatedAt !== "string"
	) {
		throw new Error("Invalid core redirect response");
	}
	return value as unknown as CoreRedirectRule;
}

export function parseCoreRedirectPage(value: unknown): {
	items: CoreRedirectRule[];
	nextCursor: string | null;
} {
	if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("Invalid core redirect list response");
	if (!(value.nextCursor === undefined || typeof value.nextCursor === "string")) {
		throw new Error("Invalid core redirect cursor");
	}
	return {
		items: value.items.map(parseCoreRedirectRule),
		nextCursor: value.nextCursor ?? null,
	};
}
