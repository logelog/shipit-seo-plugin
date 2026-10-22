import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_OUTPUT_SUPPORT,
	SEO_ENGINE_VERSION,
	type SeoAdminEntryPreview,
} from "../admin-contract.ts";
import {
	createNativeSeoEditorController,
	type NativeSeoEditorClock,
	type NativeSeoEditorController as Store,
} from "./native-seo-editor-controller.ts";
import { createNativeSeoEditorState, nativeSeoChangedFields, nativeSeoRevisionBehind } from "./native-seo-editor-state.ts";
import type { NativeSeoHostProvider, useNativeSeoEditor } from "./native-seo-editor.tsx";

type Input = Parameters<typeof useNativeSeoEditor>[0];
type View = ReturnType<typeof useNativeSeoEditor>;
type Cell = { value?: any; deps?: readonly unknown[]; effect?: () => void | (() => void); cleanup?: () => void; pending?: boolean };
type Context = { initial: any; Provider: { context: Context } };
let activeFrame: Frame | null = null;
let activeHarness: Harness | null = null;
let scenario: Harness | null = null;
const equalDeps = (left?: readonly unknown[], right?: readonly unknown[]) =>
	Boolean(left && right && left.length === right.length && left.every((item, index) => Object.is(item, right[index])));

class Frame {
	cells: Cell[] = [];
	contexts = new Map<Context, any>();
	cursor = 0;
	dirty = false;
	run<T>(owner: Harness, scope: "public" | "private", render: () => T): T {
		const previous = activeFrame; const previousHarness = activeHarness;
		activeFrame = this; activeHarness = owner; owner.scope = scope; this.cursor = 0;
		try { return render(); } finally { activeFrame = previous; activeHarness = previousHarness; }
	}
	cell(): Cell { return this.cells[this.cursor++] ??= {}; }
	commit(owner: Harness) {
		owner.withCurrent(() => {
			for (const cell of this.cells) if (cell.pending) {
				cell.pending = false; cell.cleanup?.();
				const cleanup = cell.effect?.(); cell.cleanup = typeof cleanup === "function" ? cleanup : undefined;
			}
		});
	}
	strictReplay(owner: Harness) {
		owner.withCurrent(() => {
			for (const cell of this.cells) cell.cleanup?.();
			for (const cell of this.cells) if (cell.effect) {
				const cleanup = cell.effect(); cell.cleanup = typeof cleanup === "function" ? cleanup : undefined;
			}
		});
	}
	unmount(owner: Harness) {
		owner.withCurrent(() => { for (const cell of this.cells) cell.cleanup?.(); });
		this.cells = [];
	}
}
function frame() { assert.ok(activeFrame, "hooks execute within their owning render"); return activeFrame; }
const controlledReact = {
	createContext(initial: any): Context {
		const context = { initial } as Context; context.Provider = { context }; return context;
	},
	useContext(context: Context) { const current = frame(); return current.contexts.has(context) ? current.contexts.get(context) : context.initial; },
	useRef(initial: any) { const cell = frame().cell(); cell.value ??= { current: initial }; return cell.value; },
	useState(initial: any) {
		const cell = frame().cell();
		if (!Object.prototype.hasOwnProperty.call(cell, "value")) cell.value = typeof initial === "function" ? initial() : initial;
		return [cell.value, (update: any) => { cell.value = typeof update === "function" ? update(cell.value) : update; }];
	},
	useMemo(factory: () => any, deps: readonly unknown[]) {
		const cell = frame().cell();
		if (!equalDeps(cell.deps, deps)) { cell.value = factory(); cell.deps = [...deps]; }
		return cell.value;
	},
	useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
		const cell = frame().cell();
		if (!equalDeps(cell.deps, deps)) { cell.effect = effect; cell.deps = [...deps]; cell.pending = true; }
	},
	useSyncExternalStore(subscribe: (listener: () => void) => () => void, getSnapshot: () => any) {
		const current = frame();
		controlledReact.useEffect(() => subscribe(() => { current.dirty = true; }), [subscribe]);
		return getSnapshot();
	},
};
const jsx = { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
class HostApiError extends Error { readonly status: number; constructor(status: number) { super("Native fixture request rejected"); this.status = status; } }
const source = readFileSync(new URL("./native-seo-editor.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
	fileName: "native-seo-editor.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
type HookModule = { NativeSeoHostProvider: typeof NativeSeoHostProvider; useNativeSeoEditor: typeof useNativeSeoEditor };
const browser = {
	addEventListener(name: string, listener: (event: any) => void) { assert.ok(activeHarness); activeHarness.listen(name, listener); },
	removeEventListener(name: string, listener: (event: any) => void) { assert.ok(activeHarness); activeHarness.unlisten(name, listener); },
};
// Each check loads its own module instance, so drafts kept for a later visit never cross checks.
function loadHookModule(): HookModule {
const output = { exports: {} as HookModule };
new Function("require", "module", "exports", "window", "queueMicrotask", compiled.outputText)((name: string) => {
	if (name === "react") return controlledReact;
	if (name === "react/jsx-runtime") return jsx;
	if (name === "@tanstack/react-query") return { useQueryClient() {
		assert.ok(activeHarness); activeHarness.queryHookScopes.push(activeHarness.scope);
		return activeHarness.scope === "public" ? activeHarness.publicClient : activeHarness.privateClient;
	} };
	if (name === "@emdash-cms/admin") return {
		ApiResponseError: HostApiError,
		useCurrentUser() {
			assert.ok(activeHarness); activeHarness.userHookScopes.push(activeHarness.scope);
			return activeHarness.user;
		},
		fetchContent(collection: string, id: string, options?: { locale?: string }) {
			const owner = activeHarness ?? scenario; assert.ok(owner); return owner.fetch(collection, id, options);
		},
		updateContent(collection: string, id: string, input: any, options?: { locale?: string }) {
			const owner = activeHarness ?? scenario; assert.ok(owner); return owner.update(collection, id, input, options);
		},
	};
	if (name === "./native-seo-editor-controller.ts") return { createNativeSeoEditorController(...args: Parameters<typeof createNativeSeoEditorController>) {
		assert.ok(activeHarness);
		const store = createNativeSeoEditorController(args[0], { ...args[1], clock: activeHarness.clock }, args[2], args[3]);
		activeHarness.stores.push(store); return store;
	} };
	assert.equal(name, "./native-seo-editor-state.ts", "the hook uses its real controller and state boundary");
	return { createNativeSeoEditorState, nativeSeoChangedFields, nativeSeoRevisionBehind };
}, output, output.exports, browser, (callback: () => void) => {
	assert.ok(activeHarness); activeHarness.microtasks.push(callback);
});
return output.exports;
}
let ActualProvider: HookModule["NativeSeoHostProvider"];
let actualHook: HookModule["useNativeSeoEditor"];
function useModule(module: HookModule) { ActualProvider = module.NativeSeoHostProvider; actualHook = module.useNativeSeoEditor; }

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((finish) => { resolve = finish; });
	return { promise, resolve };
}
const values = { title: "Native title", description: "Native description", image: "/_emdash/api/media/file/native.jpg" };
function preview(entryId = "entry-a", locale = "en"): SeoAdminEntryPreview {
	const ref = "posts:" + entryId; const url = "https://example.invalid/" + locale + "/" + entryId;
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, generatedAt: "2026-10-17T12:00:00.000Z",
		content: { ref, entryId, collection: "posts", collectionLabel: "Posts", title: "Fixture content", slug: entryId },
		search: { title: values.title, description: values.description, url, titleLength: values.title.length, descriptionLength: values.description.length },
		social: { editing: { state: "ready", snapshot: { ref, revision: null, override: null } },
			title: values.title, description: values.description, image: values.image, fallbackTitle: values.title, fallbackDescription: values.description,
			override: { title: null, description: null, updatedAt: null } },
		indexable: true, entryNoindex: false,
		canonicalValidation: { status: "matches", canonical: url, expectedPath: "/" + locale + "/" + entryId },
		localeGraph: { owner: "emdash-core", emitsMarkup: false, status: "single-locale", hostSupportsTranslationGroups: true,
			currentLocale: locale, defaultLocale: locale, translationGroup: null, discoveredLocales: [locale], alternates: [], xDefaultLocale: null, issues: [] },
		schemaTypes: [], outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
		sources: { title: "core-seo", description: "legacy-override", canonical: "core-seo", socialTitle: "core-seo", socialDescription: "legacy-override", image: "legacy-override" },
		ownership: {
			status: "current", reason: null, sourceVersion: "native-revision-a", locale,
			record: { sourceOverrideId: "fixture-legacy", keyKind: "id" },
			fields: [
				{ field: "title", state: "not-shadowed", core: values.title, legacy: null, effective: values.title, effectiveSource: "core-seo", social: null },
				{ field: "description", state: "equal", core: values.description, legacy: values.description, effective: values.description, effectiveSource: "legacy-override", social: null },
				{ field: "image", state: "conflict", core: values.image, legacy: "/_emdash/api/media/file/legacy.jpg", effective: "/_emdash/api/media/file/legacy.jpg", effectiveSource: "legacy-override", social: null },
				{ field: "canonical", state: "not-shadowed", core: null, legacy: null, effective: url, effectiveSource: "content", social: null },
				{ field: "noIndex", state: "not-shadowed", core: false, legacy: null, effective: false, effectiveSource: null, social: null },
			],
			unsupportedDirectives: { state: "none", tokens: [] },
		},
	};
}
/** Every native field owned by core SEO, as a preview reads it before any legacy record exists. */
function notShadowed(source: SeoAdminEntryPreview): SeoAdminEntryPreview {
	return { ...source, ownership: { ...source.ownership!, record: null,
		fields: source.ownership!.fields.map((field) => ({ ...field, state: "not-shadowed" as const, legacy: null })) } };
}
/** The preview the host returns after a refresh, describing the newer saved values. */
function refreshed(source: SeoAdminEntryPreview, saved: Partial<typeof values>): SeoAdminEntryPreview {
	return { ...source, ownership: { ...source.ownership!, fields: source.ownership!.fields.map((field) =>
		Object.hasOwn(saved, field.field) ? { ...field, core: saved[field.field as keyof typeof values]!, effective: saved[field.field as keyof typeof values]! } : field) } };
}
interface Row { id: string; type: string; locale: string; _rev: string; seo: typeof values }
class Harness {
	provider = new Frame();
	editor = new Frame();
	scope: "public" | "private" = "public";
	listeners = new Map<string, Set<(event: any) => void>>();
	microtasks: (() => void)[] = [];
	timers = new Map<number, () => void>();
	timerId = 0;
	stores: Store[] = [];
	queryHookScopes: string[] = [];
	userHookScopes: string[] = [];
	fetches: { collection: string; id: string; locale: string | undefined }[] = [];
	updates: { collection: string; id: string; input: any; locale: string | undefined }[] = [];
	publicInvalidations: unknown[] = [];
	privateInvalidations: unknown[] = [];
	/** Entries the host cache holds; `refetched` replaces them when an invalidation lands. */
	hostEntries: unknown[] = [];
	refetched: unknown[] | null = null;
	publicClient = {
		invalidateQueries: async (input: unknown) => { this.publicInvalidations.push(input); if (this.refetched) this.hostEntries = this.refetched; },
		getQueriesData: (filters: { queryKey: unknown[] }) => this.hostEntries.map((data) => [[...filters.queryKey, { locale: "en" }], data]),
	};
	privateClient = {
		invalidateQueries: async (input: unknown) => { this.privateInvalidations.push(input); },
		getQueriesData: () => { throw new Error("The private cache never holds host entries"); },
	};
	rows = new Map<string, Row>();
	failReads = 0;
	unknownWrite = false;
	refetches = 0;
	refetchResult = deferred<void>();
	user = {
		isSuccess: true, isError: false, isFetching: false, data: { id: "fixture-owner", role: 40 } as { id: string; role: number } | null,
		refetch: () => { this.refetches += 1; return this.refetchResult.promise; },
	};
	confirmed = 0;
	input: Input = { preview: preview(), locale: "en", open: false, onConfirmed: () => { this.confirmed += 1; } };
	view!: View;
	clock: NativeSeoEditorClock = {
		now: () => 0,
		setTimeout: (callback) => { const id = ++this.timerId; this.timers.set(id, callback); return id; },
		clearTimeout: (id) => { this.timers.delete(id as number); },
	};
	withCurrent<T>(run: () => T): T {
		const previous = activeHarness; activeHarness = this;
		try { return run(); } finally { activeHarness = previous; }
	}
	listen(name: string, listener: (event: any) => void) { let listeners = this.listeners.get(name); if (!listeners) this.listeners.set(name, listeners = new Set()); listeners.add(listener); }
	unlisten(name: string, listener: (event: any) => void) { this.listeners.get(name)?.delete(listener); }
	dispatch(name: string, event: any = {}) { this.withCurrent(() => { for (const listener of [...this.listeners.get(name) ?? []]) listener(event); }); }
	row(collection: string, id: string, locale: string): Row {
		const key = JSON.stringify([collection, id, locale]); let row = this.rows.get(key);
		if (!row) { row = { id, type: collection, locale, _rev: "native-revision-a", seo: { ...values } }; this.rows.set(key, row); }
		return row;
	}
	async fetch(collection: string, id: string, options?: { locale?: string }) {
		this.fetches.push({ collection, id, locale: options?.locale });
		if (this.failReads > 0) { this.failReads -= 1; throw new Error("Fixture read unavailable"); }
		return structuredClone(this.row(collection, id, options?.locale ?? ""));
	}
	async update(collection: string, id: string, input: any, options?: { locale?: string }) {
		this.updates.push({ collection, id, input: structuredClone(input), locale: options?.locale });
		if (this.unknownWrite) throw new Error("Fixture acknowledgement lost");
		const row = this.row(collection, id, options?.locale ?? "");
		if (input._rev !== row._rev) throw new HostApiError(409);
		row.seo = { ...row.seo, ...input.seo }; row._rev += "-next";
		return structuredClone(row);
	}
	render(patch: Partial<Input> = {}): View {
		this.input = { ...this.input, ...patch };
		const element = this.provider.run(this, "public", () => ActualProvider({ children: null })) as unknown as { type: { context: Context }; props: { value: any } };
		this.provider.commit(this);
		this.editor.contexts.set(element.type.context, element.props.value);
		this.view = this.editor.run(this, "private", () => actualHook(this.input));
		this.editor.commit(this);
		return this.view;
	}
	flushMicrotasks() {
		this.withCurrent(() => { while (this.microtasks.length) this.microtasks.shift()!(); });
	}
	async settle() {
		// Controller/API continuations are promises; no wall-clock time or native requests are used.
		for (let index = 0; index < 24; index += 1) { await Promise.resolve(); this.flushMicrotasks(); }
	}
	stop() {
		this.editor.unmount(this); this.provider.unmount(this); this.flushMicrotasks();
		assert.ok(this.stores.every((store) => !store.live()), "all owned stores are disposed at teardown");
		assert.equal(this.timers.size, 0);
		assert.ok([...this.listeners.values()].every((listeners) => listeners.size === 0));
	}
}
let cases = 0;
async function check(_name: string, run: (harness: Harness) => Promise<void>) {
	useModule(loadHookModule());
	const harness = new Harness(); scenario = harness;
	try { await run(harness); cases += 1; } finally { harness.stop(); scenario = null; }
}

await check("public identity/cache stays outside the private editor cache and only current unshadowed equal-core fields may change", async (h) => {
	h.render();
	assert.equal(h.fetches.length, 0, "closed popup does not read or write native metadata");
	assert.equal(h.updates.length, 0);
	h.render({ open: true }); await h.settle(); h.render();
	assert.equal(h.fetches.length, 1);
	assert.deepEqual(h.view.allowedFields, ["title"], "equal and conflicting legacy shadows remain read-only");
	const original = h.input.preview; const ownership = original.ownership!;
	const behind = { ...ownership, fields: ownership.fields.map((field) => field.field === "title" ? { ...field, core: "Different saved core value" } : field) };
	for (const answer of [
		{ ...ownership, status: "stale" as const },
		{ ...ownership, status: "unknown" as const },
		{ ...ownership, locale: "nl" },
		behind,
		{ ...ownership, fields: ownership.fields.map((field) => field.field === "title" ? { ...field, state: "unknown" as const } : field) },
	]) {
		h.render({ preview: { ...original, ownership: answer } });
		assert.deepEqual(h.view.allowedFields, []);
		assert.equal(h.view.previewUpdating, answer === behind, "only facts about other saved values wait for a preview refresh");
		h.withCurrent(() => h.view.change({ title: "Unadmitted value" }));
		assert.deepEqual(h.stores[0]!.getSnapshot().draft, {});
	}
	await h.settle();
	assert.deepEqual(h.publicInvalidations, [{ queryKey: ["content", "posts", "entry-a"] }], "a preview behind the read values asks the host to refresh once");
	assert.equal(h.confirmed, 1);
	h.render({ preview: { ...original, ownership: behind } }); await h.settle();
	assert.equal(h.publicInvalidations.length, 1, "the same saved revision is refreshed only once");
	h.render({ preview: original });
	h.withCurrent(() => h.view.change({ description: "Blocked legacy field" }));
	assert.deepEqual(h.stores[0]!.getSnapshot().draft, {});
	h.withCurrent(() => h.view.change({ title: "Local native title" })); h.render();
	assert.deepEqual(h.stores[0]!.getSnapshot().draft, { title: "Local native title" });
	assert.equal(h.updates.length, 0, "typing and opening never dispatch a write");
	h.withCurrent(() => h.view.save()); await h.settle(); h.render();
	assert.equal(h.updates.length, 1);
	assert.deepEqual(h.updates[0]!.input, { seo: { title: "Local native title" }, _rev: "native-revision-a" });
	assert.deepEqual(h.publicInvalidations, [{ queryKey: ["content", "posts", "entry-a"] }, { queryKey: ["content", "posts", "entry-a"] }]);
	assert.deepEqual(h.privateInvalidations, []);
	assert.equal(h.confirmed, 2);
	assert.ok(h.queryHookScopes.length > 0 && h.queryHookScopes.every((scope) => scope === "public"));
	assert.ok(h.userHookScopes.length > 0 && h.userHookScopes.every((scope) => scope === "public"));
	assert.equal(h.view.state?.phase, "confirmed");
});

await check("a failed initial read can be retried and close/reopen retains an unknown save attempt", async (h) => {
	h.failReads = 1;
	h.render({ open: true }); await h.settle(); h.render();
	assert.equal(h.view.state?.baseline, null);
	assert.equal(h.view.state?.problem, "readback_unavailable");
	assert.equal(h.view.loading, false);
	assert.equal(h.view.unavailable, false, "an admitted owner may explicitly retry a failed read");
	h.withCurrent(() => h.view.read()); await h.settle(); h.render();
	assert.equal(h.fetches.length, 2); assert.ok(h.view.state?.baseline);
	assert.deepEqual(h.view.allowedFields, ["title"]);
	h.withCurrent(() => h.view.change({ title: "Retained attempted title" })); h.render();
	h.unknownWrite = true;
	h.withCurrent(() => h.view.save()); await h.settle(); h.render();
	const attempt = h.view.state?.attempt; assert.ok(attempt);
	assert.equal(h.view.state?.phase, "unknown");
	const store = h.stores[0]; const reads = h.fetches.length;
	h.render({ open: false }); await h.settle(); h.render({ open: true }); await h.settle(); h.render();
	assert.equal(h.stores.length, 1); assert.ok(store?.live());
	assert.equal(h.view.state?.attempt, attempt);
	assert.equal(h.view.state?.draft.title, "Retained attempted title");
	assert.equal(h.fetches.length, reads, "reopening with a baseline does not silently resolve an unknown write");
	h.withCurrent(() => h.view.save()); await h.settle(); h.render();
	assert.equal(h.view.state?.attempt, attempt);
	assert.equal(h.updates.length, 1, "an unknown attempt cannot be retried as a new write");
});

await check("strict-effect replay renews the same store lease while entry, locale and principal changes dispose the former owner", async (h) => {
	h.render({ open: true }); await h.settle(); h.render();
	h.withCurrent(() => h.view.change({ title: "Draft owned by entry a" })); h.render();
	const first = h.stores[0]!;
	h.editor.strictReplay(h); h.flushMicrotasks();
	assert.ok(first.live(), "strict cleanup/setup must not dispose the renewed same-store lease");
	assert.equal(first.getSnapshot().draft.title, "Draft owned by entry a");
	const transitions = [
		{ entry: "entry-b", locale: "en", principal: "fixture-owner", role: 40 },
		{ entry: "entry-b", locale: "nl", principal: "fixture-owner", role: 40 },
		{ entry: "entry-b", locale: "nl", principal: "fixture-second-owner", role: 40 },
		{ entry: "entry-b", locale: "nl", principal: "fixture-second-owner", role: 50 },
	];
	let previous = first;
	for (const transition of transitions) {
		h.user.data = { id: transition.principal, role: transition.role };
		h.render({ preview: preview(transition.entry, transition.locale), locale: transition.locale });
		h.flushMicrotasks(); await h.settle(); h.render();
		const current = h.stores.at(-1)!;
		assert.notEqual(current, previous);
		assert.equal(previous.live(), false, "a different store must not inherit the new owner's strict-effect lease");
		assert.ok(current.live());
		assert.deepEqual(current.getSnapshot().draft, {});
		assert.deepEqual(current.getSnapshot().target, {
			principal: { id: transition.principal, role: transition.role }, collection: "posts", entryId: transition.entry, locale: transition.locale,
		});
		previous = current;
	}
	assert.equal(h.updates.length, 0);
	assert.equal(h.stores.length, 5);
});

await check("persisted restore waits for a fresh public principal before a new generation can read or write", async (h) => {
	h.render({ open: true }); await h.settle(); h.render();
	const old = h.stores[0]!; const reads = h.fetches.length;
	h.dispatch("pageshow", { persisted: false }); h.render();
	assert.equal(h.refetches, 0); assert.equal(h.stores.length, 1);
	h.dispatch("pagehide");
	assert.equal(old.live(), false); assert.equal(old.getSnapshot().baseline, null);
	h.dispatch("pageshow", { persisted: true });
	h.render(); h.flushMicrotasks();
	assert.equal(h.refetches, 1);
	assert.equal(h.view.unavailable, true);
	assert.equal(h.view.loading, true);
	assert.equal(h.fetches.length, reads, "restoring cannot reuse the cached principal to begin a native read");
	assert.equal(h.updates.length, 0);
	const restoringStore = h.stores.at(-1)!;
	assert.notEqual(restoringStore, old);
	h.user.data = { id: "fixture-restored-owner", role: 40 };
	h.refetchResult.resolve(); await h.settle();
	h.render(); h.flushMicrotasks(); await h.settle(); h.render();
	const restored = h.stores.at(-1)!;
	assert.notEqual(restored, old); assert.notEqual(restored, restoringStore);
	assert.equal(restoringStore.live(), false);
	assert.equal(restored.getSnapshot().target.principal.id, "fixture-restored-owner");
	assert.ok(restored.getSnapshot().baseline);
	assert.equal(h.view.unavailable, false);
	assert.equal(h.fetches.length, reads + 1);
	assert.deepEqual(h.view.allowedFields, ["title"]);
	assert.equal(h.updates.length, 0);
	assert.ok(h.userHookScopes.every((scope) => scope === "public"));
});

await check("a host autosave delivering a newer entry revision keeps the store and draft and moves or reviews the guard", async (h) => {
	const rev = (counter: number) => btoa(`${counter}:fixture`);
	const row = h.row("posts", "entry-a", "en");
	row._rev = rev(4);
	const entry = (revision: string) => ({ id: "entry-a", type: "posts", locale: "en", _rev: revision,
		seo: { ...row.seo, canonical: null, noIndex: false }, data: { title: "Body edited by the host" } });
	h.render({ open: true, entry: entry(rev(4)) }); await h.settle(); h.render();
	assert.equal(h.view.state?.baseline?.revision, rev(4));
	h.withCurrent(() => h.view.change({ title: "Popup title typed before autosave" })); h.render();
	const store = h.stores[0]!; const reads = h.fetches.length;
	// The host saves body text only; its new revision keeps the native SEO fields.
	row._rev = rev(5);
	h.render({ entry: entry(rev(5)) }); h.render();
	assert.equal(h.stores.length, 1, "a new entry revision never creates a new editor store");
	assert.ok(store.live(), "the store, and the dialog that reads it, survive the autosave");
	assert.equal(h.view.state?.baseline?.revision, rev(5), "the draft is carried onto the newer revision as its guard");
	assert.deepEqual(h.view.state?.draft, { title: "Popup title typed before autosave" });
	assert.equal(h.view.state?.phase, "editing");
	// Another editor changes a native field before the next host revision arrives.
	row.seo = { ...row.seo, description: "Saved by another editor" }; row._rev = rev(6);
	h.render({ entry: entry(rev(6)) }); h.render();
	assert.equal(h.stores.length, 1);
	assert.equal(h.view.state?.phase, "conflict", "different native fields open the existing review");
	assert.equal(h.view.state?.reviewSnapshot?.values.description, "Saved by another editor");
	assert.deepEqual(h.view.state?.draft, { title: "Popup title typed before autosave" }, "the draft is kept for the review");
	assert.equal(h.fetches.length, reads, "an observation never reads");
	assert.equal(h.updates.length, 0, "nothing is written before the editor chooses");
	h.withCurrent(() => h.view.save()); await h.settle(); h.render();
	assert.equal(h.updates.length, 0, "a save is refused while the review is open");
	h.withCurrent(() => h.view.review(true)); h.render();
	assert.equal(h.view.state?.baseline?.revision, rev(6));
	assert.equal(h.view.previewUpdating, true, "the preview still shows the description read before the review");
	assert.deepEqual(h.view.allowedFields, []);
	h.withCurrent(() => h.view.save()); await h.settle();
	assert.equal(h.updates.length, 0, "no save until the preview describes the adopted values");
	assert.deepEqual(h.publicInvalidations, [], "the host already delivered the reviewed revision, whose preview read follows from it");
	h.render({ preview: refreshed(h.input.preview, { description: "Saved by another editor" }) });
	assert.equal(h.view.previewUpdating, false);
	assert.deepEqual(h.view.allowedFields, ["title"]);
	h.withCurrent(() => h.view.save()); await h.settle(); h.render();
	assert.deepEqual(h.updates[0]!.input, { seo: { title: "Popup title typed before autosave" }, _rev: rev(6) },
		"recovery is a fresh guarded write with only the changed field");
	assert.equal(h.view.state?.phase, "confirmed");
	assert.equal(row.seo.description, "Saved by another editor", "the other editor's field is retained");
});

await check("after a conflict, Keep my edits and Use saved values refresh the preview and leave the field editable", async (h) => {
	const rev = (counter: number) => btoa(`${counter}:fixture`);
	const open = notShadowed(preview());
	const row = h.row("posts", "entry-a", "en");
	row._rev = rev(4);
	h.render({ open: true, preview: open }); await h.settle(); h.render();
	assert.deepEqual(h.view.allowedFields, ["title", "description", "image"]);
	h.withCurrent(() => h.view.change({ description: "Popup draft kept during conflict" })); h.render();
	row.seo = { ...row.seo, description: "Changed in another tab" }; row._rev = rev(5);
	h.withCurrent(() => h.view.save()); await h.settle(); h.render();
	assert.equal(h.updates.length, 1);
	assert.equal(h.view.state?.phase, "conflict");
	h.withCurrent(() => h.view.read()); await h.settle(); h.render();
	assert.equal(h.view.state?.reviewSnapshot?.values.description, "Changed in another tab");
	// The host entry can deliver the reviewed values before a choice; the review, not the preview, is pending then.
	h.render({ preview: refreshed(open, { description: "Changed in another tab" }) });
	assert.equal(h.view.state?.phase, "conflict");
	assert.equal(h.view.previewUpdating, false, "an open review over a current preview is not shown as updating");
	assert.deepEqual(h.view.allowedFields, [], "the fields stay read-only until a choice");
	h.render({ preview: open });
	const invalidations = h.publicInvalidations.length;
	h.withCurrent(() => h.view.review(true)); h.render(); await h.settle(); h.render();
	assert.equal(h.view.state?.phase, "editing");
	assert.equal(h.view.state?.draft.description, "Popup draft kept during conflict");
	assert.equal(h.view.previewUpdating, true);
	assert.equal(h.publicInvalidations.length, invalidations + 1, "the adopted values refresh the host entry and the preview");
	assert.ok(h.confirmed > 0);
	h.render({ preview: refreshed(open, { description: "Changed in another tab" }) });
	assert.equal(h.view.previewUpdating, false);
	assert.deepEqual(h.view.allowedFields, ["title", "description", "image"], "the kept draft is editable again");
	h.withCurrent(() => h.view.change({ description: "Popup draft edited after the review" })); h.render();
	h.withCurrent(() => h.view.save()); await h.settle(); h.render();
	assert.equal(h.updates.length, 2);
	assert.deepEqual(h.updates[1]!.input, { seo: { description: "Popup draft edited after the review" }, _rev: rev(5) },
		"a fresh guarded write on the reviewed revision with only the changed field");
	assert.equal(h.view.state?.phase, "confirmed");
});

await check("Use saved values loads the reviewed values once the preview matches", async (h) => {
	const rev = (counter: number) => btoa(`${counter}:fixture`);
	const open = notShadowed(preview());
	const row = h.row("posts", "entry-a", "en");
	row._rev = rev(4);
	h.render({ open: true, preview: open }); await h.settle(); h.render();
	h.withCurrent(() => h.view.change({ description: "Draft to drop" })); h.render();
	row.seo = { ...row.seo, description: "Changed in another tab" }; row._rev = rev(5);
	h.withCurrent(() => h.view.read()); await h.settle(); h.render();
	assert.equal(h.view.state?.phase, "conflict");
	h.withCurrent(() => h.view.review(false)); h.render(); await h.settle(); h.render();
	assert.deepEqual(h.view.state?.draft, {});
	assert.equal(h.view.state?.baseline?.values.description, "Changed in another tab");
	assert.equal(h.view.previewUpdating, true);
	h.render({ preview: refreshed(open, { description: "Changed in another tab" }) });
	assert.equal(h.view.previewUpdating, false);
	assert.deepEqual(h.view.allowedFields, ["title", "description", "image"]);
	assert.equal(h.updates.length, 0, "using saved values writes nothing");
});

await check("a dirty draft survives leaving the entry in the admin, is named on return and is checked before it can be saved", async (h) => {
	const open = notShadowed(preview());
	h.render({ open: true, preview: open }); await h.settle(); h.render();
	h.withCurrent(() => h.view.change({ title: "Draft kept across navigation" })); h.render();
	assert.equal(h.listeners.get("beforeunload")?.size, 1, "a reload or closing the tab asks first while edits are unsaved");
	assert.equal(h.view.restoredDraft, false);
	h.render({ preview: notShadowed(preview("entry-b")), open: false }); h.flushMicrotasks(); await h.settle(); h.render();
	assert.deepEqual(h.stores.at(-1)!.getSnapshot().draft, {}, "another entry never receives the draft");
	assert.equal(h.listeners.get("beforeunload")?.size ?? 0, 0);
	const reads = h.fetches.length;
	h.render({ preview: open }); h.flushMicrotasks(); await h.settle(); h.render();
	assert.deepEqual(h.view.state?.draft, { title: "Draft kept across navigation" }, "returning to the entry restores the draft");
	assert.equal(h.view.restoredDraft, true, "the editor says the draft was kept");
	assert.equal(h.fetches.length, reads, "nothing is read while the popup stays closed");
	assert.equal(h.updates.length, 0);
	h.render({ open: true }); await h.settle(); h.render();
	assert.equal(h.fetches.length, reads + 1, "opening checks the kept draft against the saved values once");
	assert.equal(h.view.state?.phase, "editing");
	h.withCurrent(() => h.view.save()); await h.settle(); h.render();
	assert.deepEqual(h.updates[0]!.input, { seo: { title: "Draft kept across navigation" }, _rev: "native-revision-a" });
	assert.equal(h.view.state?.phase, "confirmed");
	assert.equal(h.view.restoredDraft, false);
});

await check("a kept draft whose saved values changed meanwhile opens the review instead of saving over them", async (h) => {
	const open = notShadowed(preview());
	h.render({ open: true, preview: open }); await h.settle(); h.render();
	h.withCurrent(() => h.view.change({ title: "Kept title" })); h.render();
	h.render({ preview: notShadowed(preview("entry-b")), open: false }); h.flushMicrotasks(); await h.settle(); h.render();
	const row = h.row("posts", "entry-a", "en");
	row.seo = { ...row.seo, title: "Saved elsewhere meanwhile" }; row._rev = "native-revision-z";
	h.render({ preview: open, open: true }); h.flushMicrotasks(); await h.settle(); h.render();
	assert.equal(h.view.state?.phase, "conflict");
	assert.equal(h.view.state?.reviewSnapshot?.values.title, "Saved elsewhere meanwhile");
	assert.deepEqual(h.view.state?.draft, { title: "Kept title" });
	h.withCurrent(() => h.view.save()); await h.settle();
	assert.equal(h.updates.length, 0, "no write before the review");
});

await check("a discarded or saved draft is not kept for a later visit", async (h) => {
	const open = notShadowed(preview());
	h.render({ open: true, preview: open }); await h.settle(); h.render();
	h.withCurrent(() => h.view.change({ title: "Discarded title" })); h.render();
	h.withCurrent(() => h.view.discard()); h.render();
	h.render({ preview: notShadowed(preview("entry-b")), open: false }); h.flushMicrotasks(); await h.settle(); h.render();
	h.render({ preview: open }); h.flushMicrotasks(); await h.settle(); h.render();
	assert.deepEqual(h.stores.at(-1)!.getSnapshot().draft, {});
	assert.equal(h.view.restoredDraft, false);
});

await check("a host refresh that brings a newer saved entry leaves the preview read to that entry", async (h) => {
	const original = preview(); const ownership = original.ownership!;
	const behind = { ...original, ownership: { ...ownership, fields: ownership.fields.map((field) => field.field === "title" ? { ...field, core: "Older saved title" } : field) } };
	const cached = { id: "entry-a", type: "posts", locale: "en", _rev: "native-revision-0", updatedAt: "2026-10-17T11:00:00.000Z" };
	h.hostEntries = [cached];
	h.refetched = [{ ...cached, _rev: "native-revision-a", updatedAt: "2026-10-17T12:00:00.000Z" }];
	h.render({ open: true, preview: behind }); await h.settle(); h.render(); await h.settle();
	assert.deepEqual(h.publicInvalidations, [{ queryKey: ["content", "posts", "entry-a"] }]);
	assert.equal(h.confirmed, 0, "the newer host entry starts its own preview read, so none is requested here");
});

await check("a host entry at the adopted revision is not refreshed again while its preview loads", async (h) => {
	const original = preview(); const ownership = original.ownership!;
	const behind = { ...original, ownership: { ...ownership, fields: ownership.fields.map((field) => field.field === "title" ? { ...field, core: "Older saved title" } : field) } };
	const entry = { id: "entry-a", type: "posts", locale: "en", _rev: "native-revision-a", seo: { ...values } };
	h.render({ open: true, preview: behind, entry }); await h.settle(); h.render(); await h.settle();
	assert.equal(h.view.previewUpdating, true);
	assert.deepEqual(h.publicInvalidations, [], "the host already holds the adopted revision");
	h.render({ entry: { ...entry, _rev: btoa("1:fixture") } }); await h.settle(); h.render(); await h.settle();
	assert.equal(h.publicInvalidations.length, 1, "a host entry that is behind is refreshed once");
	assert.equal(h.confirmed, 1, "an unchanged host entry asks for the preview again");
});

console.log(`Native SEO hook lifecycle self-check passed (${cases} checks). Controlled hooks and events do not establish browser, authentication or installed-package acceptance.`);
