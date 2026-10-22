import type { QueryClient } from "@tanstack/react-query";

import { createSocialEditorStore, type SocialEditorStore } from "./social-editor-store.ts";
import type { SocialSaveTarget } from "./social-save-state.ts";

/**
 * The released native 1.3 admin keeps its signed-in user under this key in its
 * own QueryClient. It is a target-specific integration detail, read from the
 * cache only; nothing here fetches it. A cached principal cannot reveal a
 * session replaced outside this document until the host itself observes it.
 */
const HOST_CURRENT_USER_KEY = ["currentUser"] as const;

interface HostPrincipal {
	id: string;
	role: number;
}

interface SocialEditorOwner {
	client: QueryClient;
	principal: HostPrincipal;
	store: SocialEditorStore | null;
	/** Views attached to the current store; replacing the store detaches them all. */
	leases: Set<() => void>;
	stopIdentity: () => void;
	stopPageHide: () => void;
	stopRemovalWatch: () => void;
	revoked: boolean;
}

export interface SocialEditorLease {
	store: SocialEditorStore;
	release(): void;
}

// Keyed by the actual editor form object, so an abandoned form takes its owner with it.
const owners = new WeakMap<HTMLFormElement, SocialEditorOwner>();

/** Retained data is not authority: an invalidated or failed refresh keeps the previous user in `data`. */
function readHostPrincipal(client: QueryClient): HostPrincipal | null {
	const state = client.getQueryState(HOST_CURRENT_USER_KEY);
	if (!state || state.status !== "success" || state.isInvalidated) return null;
	const data: unknown = state.data;
	if (!data || typeof data !== "object") return null;
	const { id, role } = data as { id?: unknown; role?: unknown };
	return typeof id === "string" && id.length > 0 && typeof role === "number" && Number.isFinite(role) ? { id, role } : null;
}

function samePrincipal(left: HostPrincipal, right: HostPrincipal): boolean {
	return left.id === right.id && left.role === right.role;
}

function isHostCurrentUserKey(key: readonly unknown[]): boolean {
	return key.length === 1 && key[0] === HOST_CURRENT_USER_KEY[0];
}

/** Ends ownership: values are cleared, late results are dropped and every listener is removed. */
function revoke(form: HTMLFormElement, owner: SocialEditorOwner): void {
	if (owner.revoked) return;
	owner.revoked = true;
	if (owners.get(form) === owner) owners.delete(form);
	owner.stopIdentity();
	owner.stopPageHide();
	owner.stopRemovalWatch();
	owner.store?.dispose();
	owner.store = null;
	const leases = [...owner.leases];
	owner.leases.clear();
	for (const notify of leases) notify();
}

function createOwner(form: HTMLFormElement, view: Window, client: QueryClient, principal: HostPrincipal): SocialEditorOwner {
	const owner: SocialEditorOwner = {
		client, principal, store: null, leases: new Set(),
		stopIdentity: () => {}, stopPageHide: () => {}, stopRemovalWatch: () => {}, revoked: false,
	};
	owner.stopIdentity = client.getQueryCache().subscribe((event) => {
		if (!isHostCurrentUserKey(event.query.queryKey)) return;
		const current = readHostPrincipal(client);
		if (!current || !samePrincipal(current, owner.principal)) revoke(form, owner);
	});
	const onPageHide = () => revoke(form, owner);
	view.addEventListener("pagehide", onPageHide);
	owner.stopPageHide = () => view.removeEventListener("pagehide", onPageHide);
	// The form can leave the document without unmounting any view, so removal is watched for the owner's whole life.
	const removal = new MutationObserver(() => {
		if (!form.isConnected) revoke(form, owner);
	});
	removal.observe(form.ownerDocument.documentElement, { childList: true, subtree: true });
	owner.stopRemovalWatch = () => removal.disconnect();
	owners.set(form, owner);
	return owner;
}

/**
 * Attaches one view to the Social controller retained for this exact form,
 * host client, observed principal and target. Returns null when no such owner
 * qualifies; the caller then keeps component-local state and nothing is reused.
 */
export function acquireSocialEditorOwner(input: {
	form: HTMLFormElement;
	client: QueryClient;
	target: SocialSaveTarget;
	onRevoke: () => void;
}): SocialEditorLease | null {
	const { form, client, target } = input;
	const view = form.ownerDocument.defaultView;
	const principal = readHostPrincipal(client);
	const existing = owners.get(form);
	if (existing && (!principal || !view || !form.isConnected || existing.client !== client || !samePrincipal(existing.principal, principal))) {
		revoke(form, existing);
	}
	if (!principal || !view || !form.isConnected) return null;
	const owner = owners.get(form) ?? createOwner(form, view, client, principal);
	if (owner.store && (owner.store.target.ref !== target.ref || owner.store.target.locale !== target.locale)) {
		// Detached without notice: a notified view of the replaced target would re-acquire it and replace this one.
		owner.leases.clear();
		owner.store.dispose();
		owner.store = null;
	}
	const store = owner.store ?? createSocialEditorStore(target);
	owner.store = store;
	const lease = () => input.onRevoke();
	owner.leases.add(lease);
	return {
		store,
		release() {
			if (!owner.leases.delete(lease) || owner.leases.size > 0) return;
			if (!form.isConnected) revoke(form, owner);
		},
	};
}
