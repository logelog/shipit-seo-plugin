import assert from "node:assert/strict";

import { QueryClient } from "@tanstack/react-query";

import {
	SEO_ADMIN_CONTRACT_VERSION, SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, SEO_ENGINE_VERSION,
} from "../admin-contract.ts";
import { acquireSocialEditorOwner } from "./social-editor-owner.ts";
import type { SocialEditorStore } from "./social-editor-store.ts";
import { beginSocialSave, type SocialSaveTarget } from "./social-save-state.ts";

// Non-DOM owner tests: real QueryClient/cache events, explicit observer checkpoints
// and transparent form/window stand-ins. React and browser remounts are separate.
class OwnerWindow extends EventTarget {
	readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	readonly MutationObserver = OwnerMutationObserver;
	override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
		if (listener) {
			const items = this.listeners.get(type) ?? new Set();
			items.add(listener); this.listeners.set(type, items);
		}
		super.addEventListener(type, listener, options);
	}
	override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
		if (listener) this.listeners.get(type)?.delete(listener);
		super.removeEventListener(type, listener, options);
	}
	listenerCount() { return [...this.listeners.values()].reduce((sum, items) => sum + items.size, 0); }
}

class OwnerMutationObserver {
	static readonly active = new Set<OwnerMutationObserver>();
	readonly callback: MutationCallback;
	constructor(callback: MutationCallback) { this.callback = callback; }
	observe(_target: Node, _options?: MutationObserverInit) { OwnerMutationObserver.active.add(this); }
	disconnect() { OwnerMutationObserver.active.delete(this); }
	takeRecords(): MutationRecord[] { return []; }
	static checkpoint() {
		for (const observer of [...this.active]) {
			if (this.active.has(observer)) observer.callback([], observer as unknown as MutationObserver);
		}
	}
}

const originalObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
Object.defineProperty(globalThis, "MutationObserver", { configurable: true, writable: true, value: OwnerMutationObserver });
const currentUserKey = ["currentUser"] as const;
const target: SocialSaveTarget = { ref: "posts:owner-a", locale: "en" };
const header = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION };
const clients: QueryClient[] = [];
let fetches = 0;
let cases = 0;
function makeClient(data: unknown = { id: "user-a", role: 40 }) {
	const client = new QueryClient({ defaultOptions: { queries: {
		retry: false, gcTime: Infinity, queryFn: async () => { fetches++; throw new Error("No request belongs in an owner check"); },
	} } });
	if (data !== undefined) client.setQueryData(currentUserKey, data);
	clients.push(client);
	return client;
}
function makeForm() {
	const view = new OwnerWindow();
	const document = { defaultView: view, documentElement: {} };
	const node = { isConnected: true, ownerDocument: document };
	return { node, view, form: node as unknown as HTMLFormElement };
}
function lease(form: HTMLFormElement, client: QueryClient, requested = target, onRevoke = () => {}) {
	const acquired = acquireSocialEditorOwner({ form, client, target: requested, onRevoke });
	assert.ok(acquired, "A connected form and known successful principal must qualify");
	return acquired;
}
function edit(store: SocialEditorStore) {
	const { ref } = store.target;
	store.observeEditing({ state: "ready", snapshot: { ref, revision: "before", override: {
		storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, ref, title: "Saved", description: null,
		updatedAt: "2026-10-16T07:00:00.000Z",
	} } });
	const draft = { customizing: true, title: "Private unsaved title", description: "Private unsaved description" };
	store.setDraft(draft); store.updateState({ type: "draft", draftIdentity: draft });
	return draft;
}
function pending(store: SocialEditorStore) {
	const draft = edit(store);
	const started = beginSocialSave(store.stateRef.current, {
		draftIdentity: draft, values: { title: draft.title, description: draft.description },
	});
	assert.ok(started.attempt); store.installState(started.state);
	return { attempt: started.attempt, draft };
}
function assertEnded(store: SocialEditorStore) {
	assert.equal(store.live(), false);
	assert.equal(store.getSnapshot().draft, null);
	assert.equal(store.stateRef.current.baseline, null);
	assert.equal(store.stateRef.current.attempt, null);
	assert.equal(store.stateRef.current.reviewSnapshot, null);
}
function end(form: ReturnType<typeof makeForm>, client: QueryClient) {
	form.node.isConnected = false; OwnerMutationObserver.checkpoint();
	assert.equal(form.view.listenerCount(), 0);
	assert.equal(client.getQueryCache().hasListeners(), false);
	client.clear();
}
async function check(name: string, run: () => void | Promise<void>) {
	await run(); cases++;
	assert.equal(OwnerMutationObserver.active.size, 0, `${name}: owner observers must be cleaned up`);
}

try {
	await check("Panel detach and reattach preserve the complete controller", () => {
		const f = makeForm(), client = makeClient();
		const first = lease(f.form, client), draft = edit(first.store);
		const baseline = first.store.stateRef.current.baseline;
		const owner = first.store.previewOwnerRef.current;
		const epoch = first.store.previewEpochRef.current;
		first.release(); OwnerMutationObserver.checkpoint();
		assert.equal(first.store.live(), true);
		const next = lease(f.form, client);
		assert.equal(next.store, first.store); assert.equal(next.store.draftRef.current, draft);
		assert.equal(next.store.stateRef.current.draftIdentity, draft);
		assert.equal(next.store.stateRef.current.baseline, baseline);
		assert.equal(next.store.previewOwnerRef.current, owner); assert.equal(next.store.previewEpochRef.current, epoch);
		next.release(); end(f, client);
	});

	for (const replacement of [{ ref: "posts:owner-b", locale: "en" }, { ref: target.ref, locale: "tr" }, { ref: target.ref, locale: null }]) {
		await check(`Active target replacement ${JSON.stringify(replacement)}`, () => {
			const f = makeForm(), client = makeClient();
			const first = lease(f.form, client); const { attempt, draft } = pending(first.store);
			const next = lease(f.form, client, replacement);
			assert.notEqual(next.store, first.store); assertEnded(first.store);
			assert.deepEqual(next.store.target, replacement); assert.equal(next.store.live(), true);
			const disposed = first.store.getSnapshot();
			first.store.settle({ type: "save-result", attempt, result: { ...header, ref: target.ref, success: true, outcome: "saved", snapshot: {
				ref: target.ref, revision: "late", override: { ref: target.ref, storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
					title: draft.title, description: draft.description, updatedAt: "2026-10-16T08:00:00.000Z" },
			} } });
			assert.equal(first.store.getSnapshot(), disposed);
			const newerDraft = edit(next.store); first.release(); first.release();
			assert.equal(next.store.live(), true); assert.equal(next.store.draftRef.current, newerDraft);
			next.release();
			const back = lease(f.form, client);
			assert.notEqual(back.store, first.store); assertEnded(next.store); assert.equal(back.store.draftRef.current, null);
			back.release(); end(f, client);
		});
	}

	await check("Two same-target leases share one store", () => {
		const f = makeForm(), client = makeClient(); const first = lease(f.form, client), second = lease(f.form, client);
		assert.equal(first.store, second.store); const draft = edit(first.store);
		first.release(); assert.equal(second.store.live(), true); assert.equal(second.store.draftRef.current, draft);
		second.release(); end(f, client);
	});

	await check("Separate forms never share private state", () => {
		const a = makeForm(), b = makeForm(), client = makeClient();
		const first = lease(a.form, client), second = lease(b.form, client); edit(first.store);
		assert.notEqual(first.store, second.store); assert.equal(second.store.draftRef.current, null);
		a.node.isConnected = false; OwnerMutationObserver.checkpoint(); assertEnded(first.store); assert.equal(second.store.live(), true);
		assert.equal(a.view.listenerCount(), 0); assert.equal(client.getQueryCache().hasListeners(), true);
		first.release(); second.release(); end(b, client);
	});

	await check("Replacing the client revokes even the same principal", () => {
		const f = makeForm(), a = makeClient(), b = makeClient(); let notices = 0;
		const first = lease(f.form, a, target, () => { notices++; }); edit(first.store);
		const next = lease(f.form, b); assertEnded(first.store); assert.equal(notices, 1);
		assert.equal(a.getQueryCache().hasListeners(), false); assert.notEqual(first.store, next.store);
		first.release(); assert.equal(next.store.live(), true); next.release(); end(f, b); a.clear();
	});

	for (const data of [{ id: "user-b", role: 40 }, { id: "user-a", role: 10 }]) {
		await check(`Principal replacement ${JSON.stringify(data)}`, () => {
			const f = makeForm(), client = makeClient(); let notices = 0;
			const first = lease(f.form, client, target, () => { notices++; }); edit(first.store);
			client.setQueryData(currentUserKey, data); assertEnded(first.store); assert.equal(notices, 1);
			assert.equal(client.getQueryCache().hasListeners(), false); assert.equal(f.view.listenerCount(), 0);
			const next = lease(f.form, client); assert.notEqual(first.store, next.store); assert.equal(next.store.draftRef.current, null);
			first.release(); assert.equal(next.store.live(), true); next.release(); end(f, client);
		});
	}

	const cacheChanges: Array<[string, (client: QueryClient) => void | Promise<unknown>]> = [
		["cached error", client => { client.getQueryCache().find({ queryKey: currentUserKey, exact: true })!.setState({ status: "error", error: new Error("Observed auth failure") }); }],
		["invalidate", client => client.invalidateQueries({ queryKey: currentUserKey, exact: true, refetchType: "none" })],
		["remove", client => { client.removeQueries({ queryKey: currentUserKey, exact: true }); }],
		["reset", client => client.resetQueries({ queryKey: currentUserKey, exact: true })],
		["clear", client => { client.clear(); }],
	];
	for (const [name, change] of cacheChanges) {
		await check(`Auth cache ${name} clears ownership`, async () => {
			const f = makeForm(), client = makeClient(); let notices = 0;
			const first = lease(f.form, client, target, () => { notices++; }); edit(first.store);
			await change(client); assertEnded(first.store); assert.equal(notices, 1);
			assert.equal(client.getQueryCache().hasListeners(), false); assert.equal(f.view.listenerCount(), 0);
			assert.equal(acquireSocialEditorOwner({ form: f.form, client, target, onRevoke: () => {} }), null);
			first.release(); end(f, client);
		});
	}

	await check("Fresh equivalent principal and unrelated cache events preserve ownership", () => {
		const f = makeForm(), client = makeClient(); let notices = 0;
		const first = lease(f.form, client, target, () => { notices++; }), draft = edit(first.store);
		client.setQueryData(["unrelated"], { value: 1 }); client.setQueryData(currentUserKey, { id: "user-a", role: 40, name: "Changed display name" });
		assert.equal(first.store.live(), true); assert.equal(first.store.draftRef.current, draft); assert.equal(notices, 0);
		first.release(); end(f, client);
	});

	for (const data of [null, {}, { id: "", role: 40 }, { id: 4, role: 40 }, { id: "user-a" }, { id: "user-a", role: "40" }, { id: "user-a", role: NaN }, { id: "user-a", role: Infinity }, { id: "user-a", role: -Infinity }]) {
		await check("Malformed cached principal does not qualify", () => {
			const f = makeForm(), client = makeClient(data);
			assert.equal(acquireSocialEditorOwner({ form: f.form, client, target, onRevoke: () => {} }), null);
			assert.equal(client.getQueryCache().hasListeners(), false); assert.equal(f.view.listenerCount(), 0); end(f, client);
		});
	}

	for (const active of [true, false]) {
		await check(`${active ? "Active" : "Detached panel"} form removal disposes and removes listeners`, () => {
			const f = makeForm(), client = makeClient(); let revocations = 0, storeEvents = 0;
			const first = lease(f.form, client, target, () => { revocations++; }); pending(first.store);
			first.store.subscribe(() => { storeEvents++; });
			if (!active) first.release();
			f.node.isConnected = false; OwnerMutationObserver.checkpoint(); assertEnded(first.store);
			assert.equal(revocations, active ? 1 : 0); assert.equal(storeEvents, 1);
			assert.equal(client.getQueryCache().hasListeners(), false); assert.equal(f.view.listenerCount(), 0);
			const ended = first.store.getSnapshot(); first.store.setDraft({ customizing: true, title: "Late edit" });
			OwnerMutationObserver.checkpoint(); first.release();
			assert.equal(first.store.getSnapshot(), ended); assert.equal(storeEvents, 1); end(f, client);
		});
	}

	await check("A subtree checkpoint does not end a connected form owner", () => {
		const f = makeForm(), client = makeClient(); const first = lease(f.form, client), draft = edit(first.store);
		OwnerMutationObserver.checkpoint(); assert.equal(first.store.live(), true); assert.equal(first.store.draftRef.current, draft);
		first.release(); OwnerMutationObserver.checkpoint(); const next = lease(f.form, client);
		assert.equal(next.store, first.store); next.release(); end(f, client);
	});

	await check("Page exit clears active leases and all listeners once", () => {
		const f = makeForm(), client = makeClient(); let notices = 0;
		const first = lease(f.form, client, target, () => { notices++; }), second = lease(f.form, client, target, () => { notices++; });
		edit(first.store); f.view.dispatchEvent(new Event("pagehide")); assertEnded(first.store); assert.equal(notices, 2);
		assert.equal(client.getQueryCache().hasListeners(), false); assert.equal(f.view.listenerCount(), 0);
		f.view.dispatchEvent(new Event("pagehide")); assert.equal(notices, 2); first.release(); second.release(); end(f, client);
	});

	await check("Disconnected or viewless forms do not create resources", () => {
		const f = makeForm(), client = makeClient(); f.node.isConnected = false;
		assert.equal(acquireSocialEditorOwner({ form: f.form, client, target, onRevoke: () => {} }), null);
		f.node.isConnected = true; f.node.ownerDocument.defaultView = null as unknown as OwnerWindow;
		assert.equal(acquireSocialEditorOwner({ form: f.form, client, target, onRevoke: () => {} }), null); end(f, client);
	});

	assert.equal(fetches, 0, "Owner acquisition and restoration must not request currentUser or other data");
	console.log(`Social editor owner non-DOM self-checks passed (${cases} cases).`);
} finally {
	for (const client of clients) client.clear();
	for (const observer of [...OwnerMutationObserver.active]) observer.disconnect();
	if (originalObserver) Object.defineProperty(globalThis, "MutationObserver", originalObserver);
	else Reflect.deleteProperty(globalThis, "MutationObserver");
}
