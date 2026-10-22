import {
	fetchNativeSeoSnapshot,
	parseNativeSeoItem,
	saveNativeSeoAttempt,
	type NativeSeoApiDependencies,
} from "./native-seo-editor-api.ts";
import {
	beginNativeSeoReadback,
	beginNativeSeoSave,
	createNativeSeoEditorState,
	discardNativeSeoDraft,
	nativeSeoEditorReducer,
	reviewNativeSeoSave,
	updateNativeSeoDraft,
	type NativeSeoDraft,
	type NativeSeoEditorState,
	type NativeSeoSnapshot,
	type NativeSeoTarget,
} from "./native-seo-editor-state.ts";

export const NATIVE_SEO_REQUEST_DEADLINE_MS = 15_000;
export interface NativeSeoEditorClock {
	now(): number;
	setTimeout(callback: () => void, milliseconds: number): unknown;
	clearTimeout(handle: unknown): void;
}
export interface NativeSeoEditorControllerDependencies extends NativeSeoApiDependencies {
	clock?: NativeSeoEditorClock;
}
export interface NativeSeoEditorController {
	getSnapshot(): NativeSeoEditorState;
	subscribe(listener: () => void): () => void;
	live(): boolean;
	dispose(): void;
	change(patch: NativeSeoDraft): void;
	/** A saved entry the host delivered; it never reads, writes or discards. */
	observe(item: unknown): void;
	read(): Promise<void>;
	save(): Promise<void>;
	review(keepDraft?: boolean): void;
	discard(): void;
}

const defaultClock: NativeSeoEditorClock = {
	now: () => performance.now(),
	setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};
interface Operation {
	deadline: number;
	cancel: (() => void) | null;
}
type BoundedResult<T> = { kind: "value"; value: T } | { kind: "timeout" | "cancelled" | "failed" };

/** Edits kept from an earlier store for the same owner, over the saved values they were made against. */
export interface NativeSeoRetainedDraft {
	readonly baseline: NativeSeoSnapshot;
	readonly draft: NativeSeoDraft;
}

/**
 * One form/principal/entry/locale owns this store. Native writes and plugin Social
 * text remain separate. A confirmed readback does not synchronize the native
 * editor's private revision token; its ordinary conflict flow still applies.
 * A retained draft starts over its old saved values, never as an attempt, so the
 * next read either keeps it or opens the review.
 */
export function createNativeSeoEditorController(
	target: NativeSeoTarget,
	dependencies: NativeSeoEditorControllerDependencies,
	onConfirmed?: (snapshot: NativeSeoSnapshot) => void,
	retained?: NativeSeoRetainedDraft | null,
): NativeSeoEditorController {
	let state = createNativeSeoEditorState(target, null);
	if (retained) {
		const restored = createNativeSeoEditorState(target, retained.baseline);
		if (restored.baseline) state = updateNativeSeoDraft(restored, retained.draft);
	}
	const owner = state.target;
	const clock = dependencies.clock ?? defaultClock;
	const listeners = new Set<() => void>();
	let disposed = false;
	let active: Operation | null = null;
	let confirmedListener = onConfirmed;
	const current = (operation: Operation) => !disposed && active === operation;
	const install = (next: NativeSeoEditorState) => {
		if (disposed || state === next) return;
		state = next;
		for (const listener of [...listeners]) listener();
	};
	const begin = (): Operation => {
		const operation: Operation = { deadline: clock.now() + NATIVE_SEO_REQUEST_DEADLINE_MS, cancel: null };
		active = operation;
		return operation;
	};
	const finish = (operation: Operation) => {
		if (active === operation) active = null;
	};
	const bounded = <T,>(operation: Operation, request: () => Promise<T>): Promise<BoundedResult<T>> => {
		if (!current(operation)) return Promise.resolve({ kind: "cancelled" });
		const remaining = Math.min(NATIVE_SEO_REQUEST_DEADLINE_MS, operation.deadline - clock.now());
		if (remaining <= 0) return Promise.resolve({ kind: "timeout" });
		return new Promise((resolve) => {
			let settled = false;
			let handle: unknown;
			const settle = (result: BoundedResult<T>) => {
				if (settled) return;
				settled = true;
				clock.clearTimeout(handle);
				if (operation.cancel === cancel) operation.cancel = null;
				resolve(result);
			};
			const cancel = () => settle({ kind: "cancelled" });
			operation.cancel = cancel;
			handle = clock.setTimeout(() => settle({ kind: "timeout" }), remaining);
			try {
				// The public native API cannot be aborted. Both late outcomes are observed and ignored.
				request().then((value) => settle({ kind: "value", value }), () => settle({ kind: "failed" }));
			} catch { settle({ kind: "failed" }); }
		});
	};
	const readWithin = async (operation: Operation): Promise<void> => {
		if (!current(operation)) return;
		const started = beginNativeSeoReadback(state);
		if (!started.request) return;
		const request = started.request;
		install(started.state);
		const result = await bounded(operation, () => fetchNativeSeoSnapshot(owner, dependencies));
		if (!current(operation) || state.readback !== request) return;
		if (result.kind !== "value" || result.value.outcome !== "read") {
			install(nativeSeoEditorReducer(state, { type: "readback-unavailable", request }));
			return;
		}
		const next = nativeSeoEditorReducer(state, { type: "readback-result", request, snapshot: result.value.snapshot });
		const confirmed = request.attempt !== null && next.attempt === null && next.baseline !== null && next.problem !== "not_saved";
		install(next);
		if (confirmed && current(operation) && state.baseline === next.baseline) {
			try { confirmedListener?.(next.baseline!); }
			catch { /* A view refresh cannot change the native values already confirmed by readback. */ }
		}
	};
	return {
		getSnapshot: () => state,
		subscribe(listener) {
			if (disposed) return () => {};
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		live: () => !disposed,
		dispose() {
			if (disposed) return;
			disposed = true;
			active?.cancel?.();
			active = null;
			confirmedListener = undefined;
			state = createNativeSeoEditorState(owner, null);
			const detached = [...listeners];
			listeners.clear();
			for (const listener of detached) listener();
		},
		change(patch) {
			if (!disposed) install(updateNativeSeoDraft(state, patch));
		},
		observe(item) {
			if (disposed || active) return;
			const snapshot = parseNativeSeoItem(item, owner);
			if (snapshot) install(nativeSeoEditorReducer(state, { type: "observed", snapshot }));
		},
		async read() {
			if (disposed || active) return;
			const operation = begin();
			try { await readWithin(operation); }
			finally { finish(operation); }
		},
		async save() {
			if (disposed || active) return;
			const started = beginNativeSeoSave(state);
			if (!started.attempt) return;
			const attempt = started.attempt;
			const operation = begin();
			install(started.state);
			try {
				const result = await bounded(operation, () => saveNativeSeoAttempt(attempt, dependencies));
				if (!current(operation) || state.attempt !== attempt) return;
				if (result.kind !== "value" || result.value.outcome === "unknown") {
					install(nativeSeoEditorReducer(state, { type: "write-unknown", attempt }));
					return;
				}
				install(nativeSeoEditorReducer(state, { type: "write-result", attempt, result: result.value }));
				// Acknowledgement and readback share the same finite operation budget.
				if (result.value.outcome === "acknowledged" && current(operation) &&
					state.attempt === attempt && !state.writePending && state.problem === null) await readWithin(operation);
			} finally { finish(operation); }
		},
		review(keepDraft = true) {
			if (!disposed && !active) install(reviewNativeSeoSave(state, keepDraft));
		},
		discard() {
			if (!disposed && !active) install(discardNativeSeoDraft(state));
		},
	};
}
