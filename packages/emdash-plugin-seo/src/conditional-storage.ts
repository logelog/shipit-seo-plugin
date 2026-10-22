export type ConditionalExpected =
	| { state: "missing" }
	| { state: "value"; value: unknown };

export type ConditionalNext =
	| { action: "delete" }
	| { action: "put"; value: unknown };

interface NativeConditionalStorage {
	getVersioned(id: string): Promise<unknown>;
	compareAndSet(id: string, revision: string | null, value: unknown): Promise<unknown>;
	compareAndDelete(id: string, revision: string): Promise<unknown>;
}

interface LegacyConditionalStorage {
	compareAndSet(id: string, expected: ConditionalExpected, next: ConditionalNext): Promise<unknown>;
}

function conditionalStorageKind(store: unknown): "native" | "legacy" | null {
	if (!store || typeof store !== "object") return null;
	const candidate = store as Partial<NativeConditionalStorage>;
	if (typeof candidate.compareAndSet !== "function") return null;
	if (!("getVersioned" in candidate) && !("compareAndDelete" in candidate)) return "legacy";
	return typeof candidate.getVersioned === "function" &&
		typeof candidate.compareAndDelete === "function"
		? "native"
		: null;
}

export function supportsConditionalStorage(store: unknown): boolean {
	return conditionalStorageKind(store) !== null;
}

function serializedValue(value: unknown): string {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) throw new TypeError("Conditional values must be JSON serializable");
	return serialized;
}

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function appliedResult(result: unknown, action: ConditionalNext["action"]): boolean {
	if (!result || typeof result !== "object" || Array.isArray(result))
		throw new TypeError("Invalid conditional storage result");
	const candidate = result as { applied?: unknown; revision?: unknown };
	if (!Object.hasOwn(candidate, "applied") ||
		(candidate.applied !== true && candidate.applied !== false))
		throw new TypeError("Invalid conditional storage result");
	if (candidate.applied && action === "put" && !validRevision(candidate.revision))
		throw new TypeError("Invalid conditional storage revision");
	return candidate.applied === true;
}

export async function compareStoredValue(
	store: unknown,
	id: string,
	expected: ConditionalExpected,
	next: ConditionalNext,
): Promise<boolean> {
	const kind = conditionalStorageKind(store);
	if (!kind) throw new TypeError("Conditional storage is unavailable");
	if (!expected || (expected.state !== "missing" && expected.state !== "value") ||
		(expected.state === "value" && !Object.hasOwn(expected, "value")))
		throw new TypeError("Invalid conditional expected state");
	if (!next || (next.action !== "delete" && next.action !== "put") ||
		(next.action === "put" && !Object.hasOwn(next, "value")))
		throw new TypeError("Invalid conditional next action");
	const action = next.action;
	if (expected.state === "missing" && action === "delete") return false;

	// Capture both values before storage reads can yield to the caller.
	const expectedValue = expected.state === "value" ? serializedValue(expected.value) : null;
	const nextValue = next.action === "put" ? JSON.parse(serializedValue(next.value)) : undefined;
	if (kind === "legacy") {
		const result = await (store as LegacyConditionalStorage).compareAndSet(
			id,
			expectedValue === null ? { state: "missing" } : { state: "value", value: JSON.parse(expectedValue) },
			action === "delete" ? { action: "delete" } : { action: "put", value: nextValue },
		);
		if (typeof result !== "boolean") throw new TypeError("Invalid legacy conditional storage result");
		return result;
	}

	const native = store as NativeConditionalStorage;
	let revision: string | null = null;
	if (expected.state === "value") {
		const current = await native.getVersioned(id);
		if (current === null) return false;
		if (!current || typeof current !== "object" || Array.isArray(current) ||
			!Object.hasOwn(current, "value") || !Object.hasOwn(current, "revision") ||
			!validRevision((current as { revision?: unknown }).revision))
			throw new TypeError("Invalid versioned storage value");
		const snapshot = current as { value: unknown; revision: string };
		if (serializedValue(snapshot.value) !== expectedValue) return false;
		revision = snapshot.revision;
	}

	// The revision fences changes after the expected serialized value was checked.
	if (action === "delete")
		return appliedResult(await native.compareAndDelete(id, revision!), "delete");
	return appliedResult(await native.compareAndSet(id, revision, nextValue), "put");
}
