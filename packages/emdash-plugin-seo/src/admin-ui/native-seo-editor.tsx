import { ApiResponseError, fetchContent, updateContent, useCurrentUser } from "@emdash-cms/admin";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as React from "react";

import type { SeoAdminEntryPreview } from "../admin-contract.ts";
import { createNativeSeoEditorController, type NativeSeoRetainedDraft } from "./native-seo-editor-controller.ts";
import type { NativeSeoEditorController } from "./native-seo-editor-fields.tsx";
import {
	createNativeSeoEditorState,
	nativeSeoChangedFields,
	nativeSeoRevisionBehind,
	type NativeSeoEditorState,
	type NativeSeoField,
	type NativeSeoTarget,
} from "./native-seo-editor-state.ts";

interface NativeSeoHost {
	client: QueryClient;
	principal: { id: string; role: number } | null;
	ready: boolean;
	generation: number;
}
const HostContext = React.createContext<NativeSeoHost | null>(null);

/** Revision, draft and update time of each cached host entry for one target; a saved change alters one of them. */
function hostEntryIdentity(client: QueryClient, collection: string, entryId: string, locale: string | null): string {
	return JSON.stringify(client.getQueriesData({ queryKey: ["content", collection, entryId] }).map(([, data]) => {
		const item = data && typeof data === "object" ? data as Record<string, unknown> : null;
		return item?.id === entryId && (locale === null || item.locale === undefined || item.locale === locale)
			? [item._rev ?? null, item.draftRevisionId ?? null, item.updatedAt ?? null] : null;
	}));
}

export type HostEntryRefresh = (collection: string, entryId: string, locale: string | null) => Promise<{ changed: boolean }>;

/**
 * Refetches the entry through the host's public cache without touching its private write token.
 * `changed` is true when the host now holds another saved version, which reaches the panel as a new entry.
 */
function refreshHostEntry(client: QueryClient, collection: string, entryId: string, locale: string | null): Promise<{ changed: boolean }> {
	const before = hostEntryIdentity(client, collection, entryId, locale);
	const settle = () => ({ changed: hostEntryIdentity(client, collection, entryId, locale) !== before });
	return client.invalidateQueries({ queryKey: ["content", collection, entryId] }).then(settle, settle);
}

/** The host entry refresh for panels inside `NativeSeoHostProvider`; null without a host cache. */
export function useHostEntryRefresh(): HostEntryRefresh | null {
	const client = React.useContext(HostContext)?.client ?? null;
	return React.useMemo(() => client ? (collection, entryId, locale) => refreshHostEntry(client, collection, entryId, locale) : null, [client]);
}

/** Read the public signed-in-user hook before entering the plugin's private cache. */
export function NativeSeoHostProvider({ children }: { children: React.ReactNode }) {
	const client = useQueryClient();
	const user = useCurrentUser();
	const [generation, setGeneration] = React.useState(0);
	const [restoring, setRestoring] = React.useState(false);
	React.useEffect(() => {
		const onPageShow = (event: PageTransitionEvent) => {
			if (!event.persisted) return;
			setRestoring(true);
			setGeneration((value) => value + 1);
			void user.refetch().then(() => setRestoring(false), () => setRestoring(false));
		};
		window.addEventListener("pageshow", onPageShow);
		return () => window.removeEventListener("pageshow", onPageShow);
	}, [user.refetch]);
	const data = user.isSuccess && !user.isError ? user.data : null;
	const principal = data && typeof data.id === "string" && data.id &&
		typeof data.role === "number" && Number.isFinite(data.role) ? { id: data.id, role: data.role } : null;
	const value = React.useMemo(() => ({
		client, principal, generation, ready: Boolean(principal && !user.isFetching && !restoring),
	}), [client, principal?.id, principal?.role, user.isFetching, restoring, generation]);
	return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

const emptySnapshot = () => null;
const emptySubscribe = () => () => {};
const dependencies = { ApiResponseError, fetchContent, updateContent };
const FIELDS = ["title", "description", "image"] as const;

/**
 * Unsaved popup edits outlive navigation inside the admin for this page only,
 * keyed by principal, entry and locale. A reload starts empty, and another
 * principal never receives them.
 */
const retainedDrafts = new Map<string, NativeSeoRetainedDraft>();
const RETAINED_DRAFT_LIMIT = 16;

function unsavedEdits(state: NativeSeoEditorState | null): boolean {
	return Boolean(state?.baseline && (nativeSeoChangedFields(state).length || Object.keys(state.errors).length));
}

function retainDraft(key: string, state: NativeSeoEditorState) {
	if (!state.baseline || !unsavedEdits(state)) return;
	retainedDrafts.delete(key);
	retainedDrafts.set(key, { baseline: state.baseline, draft: state.draft });
	while (retainedDrafts.size > RETAINED_DRAFT_LIMIT) retainedDrafts.delete(retainedDrafts.keys().next().value!);
}

export function useNativeSeoEditor(input: {
	preview: SeoAdminEntryPreview;
	locale: string | null;
	open: boolean;
	/** The saved entry the host passes to the panel; a newer revision may carry the draft guard. */
	entry?: unknown;
	/**
	 * Runs after the host cache is refreshed for native values this editor read (a confirmed save or an
	 * adopted read) and the host still holds the same saved version; a newer one brings its own preview.
	 */
	onConfirmed?(): void;
}): NativeSeoEditorController {
	const host = React.useContext(HostContext);
	const { preview, locale } = input;
	const callback = React.useRef(input.onConfirmed);
	callback.current = input.onConfirmed;
	const retentionKey = host?.principal && locale ? JSON.stringify([
		host.principal.id, host.principal.role, preview.content.collection, preview.content.entryId, locale,
	]) : null;
	const key = retentionKey && host ? JSON.stringify([retentionKey, host.generation]) : null;
	const ownerRef = React.useRef<ReturnType<typeof createNativeSeoEditorController> | null>(null);
	const owner = React.useMemo(() => {
		if (!key || !host?.principal || !locale) return null;
		const target: NativeSeoTarget = {
			principal: { ...host.principal }, collection: preview.content.collection,
			entryId: preview.content.entryId, locale,
		};
		try { createNativeSeoEditorState(target, null); } catch { return null; }
		// One host refresh per saved revision, so a preview that stays behind cannot start a loop.
		const refreshed = new Set<string>();
		const refresh = (revision: string) => {
			if (ownerRef.current !== owned || !owned.live() || refreshed.has(revision)) return;
			refreshed.add(revision);
			void refreshHostEntry(host.client, target.collection, target.entryId, target.locale).then(({ changed }) => {
				if (!changed && ownerRef.current === owned && owned.live()) callback.current?.();
			});
		};
		// Read without removing it: a strict development render may build this owner twice.
		const restored = retentionKey ? retainedDrafts.get(retentionKey) ?? null : null;
		const owned = createNativeSeoEditorController(target, dependencies, (snapshot) => refresh(snapshot.revision), restored);
		return { store: owned, refresh, restored, retentionKey: retentionKey!, notice: { shown: restored !== null, checked: restored === null } };
	}, [key, host?.client]);
	const store = owner?.store ?? null;
	ownerRef.current = store;
	const state = React.useSyncExternalStore(
		store?.subscribe ?? emptySubscribe,
		store?.getSnapshot ?? emptySnapshot,
		emptySnapshot,
	);
	const leases = React.useRef(new WeakMap<object, symbol>());
	React.useEffect(() => {
		if (!store || !owner) return;
		const current = Symbol();
		leases.current.set(store, current);
		if (owner.restored && retainedDrafts.get(owner.retentionKey) === owner.restored) retainedDrafts.delete(owner.retentionKey);
		const onPageHide = () => store.dispose();
		window.addEventListener("pagehide", onPageHide);
		return () => {
			window.removeEventListener("pagehide", onPageHide);
			// A development strict-effect remount renews the same lease before this microtask.
			queueMicrotask(() => {
				if (leases.current.get(store) !== current) return;
				if (store.live()) retainDraft(owner.retentionKey, store.getSnapshot());
				store.dispose(); leases.current.delete(store);
			});
		};
	}, [store, owner]);
	React.useEffect(() => {
		if (!input.open || !host?.ready || !store?.live() || !owner) return;
		// Kept edits are checked against the saved values once before they can be saved.
		if (!store.getSnapshot().baseline || !owner.notice.checked) {
			owner.notice.checked = true;
			void store.read();
		}
	}, [input.open, host?.ready, store, owner]);
	const dirty = unsavedEdits(state);
	React.useEffect(() => {
		if (!dirty) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [dirty]);
	const observedEntry = input.entry;
	const guardRevision = state?.baseline?.revision ?? null;
	const settled = Boolean(state && !state.attempt && !state.writePending && !state.readback);
	React.useEffect(() => {
		// Repeats after each settled operation, since the controller ignores an observation while busy.
		if (observedEntry !== undefined && settled && store?.live()) store.observe(observedEntry);
	}, [store, observedEntry, guardRevision, settled]);
	const available = Boolean(host?.ready && store?.live());
	const ownership = preview.ownership;
	const baseline = state?.baseline ?? null;
	const ownershipCurrent = Boolean(available && baseline && ownership?.status === "current" && ownership.locale === locale);
	// An open review keeps every field read-only until a choice; the preview may already describe
	// the saved values under review, which are newer than the baseline, so nothing is updating.
	const reviewing = state?.phase === "conflict";
	// Ownership facts describe the saved values they were read with. A newer read the editor adopted
	// (a review choice or a check) leaves every field read-only until the preview describes it too.
	const previewUpdating = Boolean(!reviewing && ownershipCurrent && baseline && ownership?.fields.some((value) =>
		(FIELDS as readonly string[]).includes(value.field) && value.state !== "unknown" &&
		value.core !== baseline.values[value.field as NativeSeoField]));
	const allowedFields: readonly NativeSeoField[] = ownershipCurrent && !previewUpdating && !reviewing && baseline && ownership
		? FIELDS.filter((field) => ownership.fields.some((value) =>
			value.field === field && value.state === "not-shadowed" && value.core === baseline.values[field]))
		: [];
	const hostRevision = observedEntry && typeof observedEntry === "object" && typeof (observedEntry as { _rev?: unknown })._rev === "string"
		? (observedEntry as { _rev: string })._rev : null;
	// A host entry at or past the adopted revision already has its own preview read; refreshing it again cannot help.
	const staleRevision = previewUpdating && settled && baseline &&
		(hostRevision === null || nativeSeoRevisionBehind(hostRevision, baseline.revision)) ? baseline.revision : null;
	React.useEffect(() => {
		if (staleRevision !== null) owner?.refresh(staleRevision);
	}, [owner, staleRevision]);
	return {
		state,
		loading: Boolean(!state?.baseline && (state?.readback || state?.phase === "idle")) || Boolean(host?.principal && !host.ready),
		unavailable: !available,
		allowedFields,
		previewUpdating,
		restoredDraft: Boolean(owner?.notice.shown && dirty),
		change(patch) {
			if (!available || !store || !Object.keys(patch).every((field) => allowedFields.includes(field as NativeSeoField))) return;
			if (owner) owner.notice.shown = false;
			store.change(patch);
		},
		save() {
			if (!available || !store || !Object.keys(store.getSnapshot().draft).every((field) => allowedFields.includes(field as NativeSeoField))) return;
			if (owner) owner.notice.shown = false;
			void store.save();
		},
		read() { if (available && store) void store.read(); },
		review(keep) { if (available && store) store.review(keep); },
		discard() {
			if (!available || !store) return;
			if (owner) owner.notice.shown = false;
			store.discard();
		},
	};
}
