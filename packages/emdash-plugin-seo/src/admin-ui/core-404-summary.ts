export interface Core404SummaryItem {
	path: string;
	count: number;
	lastSeen: string;
}

export function parseCore404Summary(value: unknown): Core404SummaryItem[] {
	if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) {
		throw new Error("Invalid EmDash 404 summary response");
	}
	return value.items.map((item: unknown) => {
		if (
			!item ||
			typeof item !== "object" ||
			!("path" in item) ||
			typeof item.path !== "string" ||
			!("count" in item) ||
			typeof item.count !== "number" ||
			!Number.isSafeInteger(item.count) ||
			item.count < 0 ||
			!("lastSeen" in item) ||
			typeof item.lastSeen !== "string"
		) {
			throw new Error("Invalid EmDash 404 summary item");
		}
		return { path: item.path, count: item.count, lastSeen: item.lastSeen };
	});
}
