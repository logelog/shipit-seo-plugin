import {
	createSocialSaveState,
	socialSaveAcknowledgesDraft,
	socialSaveReducer,
	type SocialSaveEvent,
	type SocialSaveState,
	type SocialSaveTarget,
} from "./social-save-state.ts";

/** Only edited fields are captured; untouched fields follow the saved baseline. */
export interface SocialOverrideDraftState {
	customizing: boolean;
	title?: string;
	description?: string;
}

export interface SocialEditorSnapshot {
	state: SocialSaveState;
	draft: SocialOverrideDraftState | null;
}

/**
 * One complete Social controller: draft object identity, save state, preview
 * owner and epoch, and the synchronous gate every view reads. Views subscribe
 * and detach; only dispose ends it, and a disposed store accepts no event.
 */
export interface SocialEditorStore {
	readonly target: Readonly<SocialSaveTarget>;
	readonly stateRef: { readonly current: SocialSaveState };
	readonly draftRef: { readonly current: SocialOverrideDraftState | null };
	readonly previewOwnerRef: { readonly current: symbol };
	readonly previewEpochRef: { readonly current: number };
	getSnapshot(): SocialEditorSnapshot;
	subscribe(listener: () => void): () => void;
	installState(next: SocialSaveState): void;
	updateState(event: SocialSaveEvent): void;
	setDraft(next: SocialOverrideDraftState | null): void;
	/** Applies passive metadata once per observed object, so a remount re-renders without re-dispatching. */
	observeEditing(editing: SocialSaveState["editing"]): void;
	/** Delivers a request result only while this store is live; a late result after disposal is dropped. */
	settle(event: SocialSaveEvent): void;
	retain(): () => void;
	live(): boolean;
	dispose(): void;
}

function initialState(target: SocialSaveTarget): SocialSaveState {
	return createSocialSaveState(target, { state: "unavailable", reason: "snapshot_changed" });
}

export function createSocialEditorStore(
	requestedTarget: SocialSaveTarget,
	options: { disposeWhenReleased?: boolean } = {},
): SocialEditorStore {
	const target = Object.freeze({ ref: requestedTarget.ref, locale: requestedTarget.locale });
	let state = initialState(target);
	let draft: SocialOverrideDraftState | null = null;
	let snapshot: SocialEditorSnapshot = { state, draft };
	let epoch = 0;
	let lastEditing: SocialSaveState["editing"] | null = null;
	let retained = 0;
	let disposed = false;
	const owner = Symbol("social-preview-owner");
	const listeners = new Set<() => void>();
	const emit = () => {
		snapshot = { state, draft };
		for (const listener of [...listeners]) listener();
	};
	const installState = (next: SocialSaveState) => {
		if (disposed) return;
		if (next.sequence > 0 && next.baseline !== state.baseline) epoch++;
		state = next;
		if (socialSaveAcknowledgesDraft(next, draft)) draft = null;
		emit();
	};
	const updateState = (event: SocialSaveEvent) => {
		if (!disposed) installState(socialSaveReducer(state, event));
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		state = initialState(target);
		draft = null;
		lastEditing = null;
		emit();
		listeners.clear();
	};
	return {
		target,
		stateRef: { get current() { return state; } },
		draftRef: { get current() { return draft; } },
		previewOwnerRef: { current: owner },
		previewEpochRef: { get current() { return epoch; } },
		getSnapshot: () => snapshot,
		subscribe(listener) {
			if (disposed) return () => {};
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		installState,
		updateState,
		setDraft(next) {
			if (disposed) return;
			draft = next;
			emit();
		},
		observeEditing(editing) {
			if (disposed || editing === lastEditing) return;
			lastEditing = editing;
			updateState({ type: "editing", editing });
		},
		settle: updateState,
		retain() {
			retained++;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				retained--;
				// Deferred so a React effect replay re-retains before the store is ended.
				if (options.disposeWhenReleased && retained === 0) queueMicrotask(() => { if (retained === 0) dispose(); });
			};
		},
		live: () => !disposed,
		dispose,
	};
}
