export interface SavedContentItem {
	id: string;
	data: Record<string, unknown>;
	slug: string | null;
	updatedAt: string;
	draftRevisionId?: string | null;
	version?: unknown;
	_rev?: unknown;
	seo?: Record<string, unknown>;
}

export interface SavedContentSnapshot {
	ref: string;
	data: Record<string, unknown>;
	slug: string | null;
	seo?: Record<string, unknown>;
	sourceVersion: string;
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => [key, stableValue(item)]));
}

function valueFingerprint(value: unknown): string {
	const text = JSON.stringify(stableValue(value));
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16);
}

export function savedContentVersion(item: {
	updatedAt?: string | null;
	draftRevisionId?: string | null;
	version?: unknown;
	_rev?: unknown;
	data: Record<string, unknown>;
	slug?: string | null;
	seo?: unknown;
}): string {
	let version = typeof item.version === "number" && Number.isSafeInteger(item.version) ? item.version : null;
	if (version === null && typeof item._rev === "string") {
		try {
			const counter = Number(atob(item._rev).split(":")[0]);
			if (Number.isSafeInteger(counter) && counter >= 0) version = counter;
		} catch { /* A host without a usable revision token uses the saved-value fingerprint. */ }
	}
	return JSON.stringify([
		version,
		item.draftRevisionId ?? null,
		item.updatedAt ?? null,
		valueFingerprint(item.seo ?? null),
		version !== null || item.draftRevisionId ? null : valueFingerprint([item.data, item.slug]),
	]);
}

export function isSavedContentItem(value: unknown): value is SavedContentItem {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Partial<SavedContentItem>;
	return typeof item.id === "string" && !!item.data && typeof item.data === "object" &&
		!Array.isArray(item.data) && (item.slug === null || typeof item.slug === "string") &&
		typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)) &&
		(item.draftRevisionId === undefined || item.draftRevisionId === null || typeof item.draftRevisionId === "string") &&
		(item.seo === undefined || (!!item.seo && typeof item.seo === "object" && !Array.isArray(item.seo)));
}

export function hydrateSavedContent(item: SavedContentItem, revision: {
	data: Record<string, unknown>;
}): SavedContentItem {
	const draftData = Object.fromEntries(Object.entries(revision.data).filter(([key]) => !key.startsWith("_")));
	return {
		...item,
		slug: typeof revision.data._slug === "string" ? revision.data._slug : item.slug,
		data: { ...item.data, ...draftData },
	};
}

export function createSavedContentSnapshot(ref: string, value: unknown, revision?: unknown): SavedContentSnapshot {
	const separator = ref.indexOf(":");
	const collection = ref.slice(0, separator);
	const id = ref.slice(separator + 1);
	if (separator < 1 || !id.trim() || !isSavedContentItem(value) || value.id !== id) {
		throw new Error("Invalid saved content response.");
	}
	let item = value;
	if (value.draftRevisionId) {
		const draft = revision as { id?: unknown; collection?: unknown; entryId?: unknown; data?: unknown } | undefined;
		if (!draft || draft.id !== value.draftRevisionId || draft.collection !== collection || draft.entryId !== id ||
			!draft.data || typeof draft.data !== "object" || Array.isArray(draft.data)) {
			throw new Error("Invalid saved draft response.");
		}
		item = hydrateSavedContent(value, { data: draft.data as Record<string, unknown> });
	}
	return { ref, data: item.data, slug: item.slug, ...(item.seo ? { seo: item.seo } : {}), sourceVersion: savedContentVersion(value) };
}

export function savedSnapshotMatches(
	value: { ref: unknown; sourceKind?: unknown; sourceVersion?: unknown },
	expected: { ref: string; sourceVersion: string },
): boolean {
	return value.ref === expected.ref && value.sourceKind === "saved-snapshot" &&
		value.sourceVersion === expected.sourceVersion && expected.sourceVersion.length > 0;
}

export async function verifySavedContentVersions<T extends { ref: string; sourceVersion?: string }>(
	items: readonly T[],
	readVersion: (ref: string) => Promise<string | null>,
	signal?: AbortSignal,
): Promise<{ items: T[]; failures: Array<{ ref: string; error: string }> }> {
	const verified: T[] = [];
	const failures: Array<{ ref: string; error: string }> = [];
	for (const item of items) {
		signal?.throwIfAborted();
		try {
			const version = await readVersion(item.ref);
			signal?.throwIfAborted();
			if (version === null) failures.push({ ref: item.ref, error: "content_not_found" });
			else if (version !== item.sourceVersion) failures.push({ ref: item.ref, error: "saved_content_changed" });
			else verified.push(item);
		} catch (error) {
			if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
			failures.push({ ref: item.ref, error: "saved_content_unavailable" });
		}
	}
	return { items: verified, failures };
}
