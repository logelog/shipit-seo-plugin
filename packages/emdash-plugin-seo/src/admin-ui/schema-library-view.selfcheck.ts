import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";
import * as contract from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as authoring from "./entry-schema-authoring.ts";
import * as libraryModel from "./schema-library-model.ts";
import * as workspaceModel from "./workspace-model.ts";

// The production SchemaLibraryView runs under a hook owner with the real library store and reducer.
// Only the query cache, the request helpers, presentational controls and the DOM nodes are fixtures.

type Element = React.ReactElement<Record<string, any>>;
type Cell = { value: any; deps?: readonly unknown[] };
let owner: HookOwner;
class HookOwner {
	cells: Cell[] = [];
	cursor = 0;
	effects: Array<() => unknown> = [];
	render<T>(render: () => T): T {
		const previous = owner;
		owner = this; this.cursor = 0;
		try { return render(); } finally { owner = previous; }
	}
	flush() { for (const effect of this.effects.splice(0)) effect(); }
	changed(index: number, deps: readonly unknown[]) {
		const previous = this.cells[index];
		return !previous?.deps || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps![i]));
	}
	state<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
		const index = this.cursor++;
		this.cells[index] ??= { value: typeof initial === "function" ? (initial as () => T)() : initial };
		return [this.cells[index].value, (value) => {
			this.cells[index]!.value = typeof value === "function" ? (value as (current: T) => T)(this.cells[index]!.value) : value;
		}];
	}
	ref<T>(initial: T) {
		const index = this.cursor++;
		this.cells[index] ??= { value: { current: initial } };
		return this.cells[index]!.value as { current: T };
	}
	effect(effect: () => unknown, deps: readonly unknown[]) {
		const index = this.cursor++;
		if (this.changed(index, deps)) this.effects.push(effect);
		this.cells[index] = { value: null, deps };
	}
	memo<T>(factory: () => T, deps: readonly unknown[]): T {
		const index = this.cursor++;
		if (this.changed(index, deps)) this.cells[index] = { value: factory(), deps };
		return this.cells[index]!.value;
	}
}
const localReact = {
	...React,
	useState: <T,>(initial: T | (() => T)) => owner.state(initial),
	useRef: <T,>(initial: T) => owner.ref(initial),
	useEffect: (effect: () => unknown, deps: readonly unknown[]) => owner.effect(effect, deps),
	useLayoutEffect: (effect: () => unknown, deps: readonly unknown[]) => owner.effect(effect, deps),
	useMemo: <T,>(factory: () => T, deps: readonly unknown[]) => owner.memo(factory, deps),
	useCallback: <T,>(callback: T) => callback,
	useSyncExternalStore: <T,>(_subscribe: unknown, get: () => T) => get(),
};

function Button(_props: any) { return null; }
function Banner(_props: any) { return null; }
function CodeBlock(_props: any) { return null; }
function Input(_props: any) { return null; }
function InputArea(_props: any) { return null; }
function EntrySchemaAuthoringControls(_props: any) { return null; }
const Dialog = Object.assign(function Dialog(_props: any) { return null; }, {
	Root: function DialogRoot(_props: any) { return null; },
	Title: function DialogTitle(_props: any) { return null; },
	Description: function DialogDescription(_props: any) { return null; },
});
const icon = () => null;

/** A focus target with the browser rules the view relies on: disabled and hidden nodes do not take focus. */
class FakeNode {
	isConnected = true;
	visible = true;
	disabled = false;
	focusable = false;
	attributes = new Map<string, string>();
	tag: string;
	label: string;
	constructor(tag: string, label: string) { this.tag = tag; this.label = label; }
	checkVisibility() { return this.visible; }
	closest(_selector: string) { return this.visible ? null : this; }
	setAttribute(name: string, value: string) { this.attributes.set(name, value); }
	focus() {
		if (!this.isConnected || !this.visible || this.disabled) return;
		if (!this.focusable && !this.attributes.has("tabindex")) return;
		doc.activeElement = this;
		focusLog.push(this.label);
		deliverFocus(this);
	}
}
/** Every focus that took effect, in order, so a check can see each move and not only where focus ended. */
const focusLog: string[] = [];
/** Dispatches focus as a bubbling focus event to the rendered view; set by the fixture that rendered last. */
let deliverFocus: (node: FakeNode) => void = () => {};
const doc = { body: new FakeNode("body", "body"), activeElement: null as FakeNode | null };
doc.activeElement = doc.body;
(globalThis as { document?: unknown }).document = doc;

function walk(tree: React.ReactNode): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(walk);
	if (!React.isValidElement(tree)) return [];
	const node = tree as Element;
	return [node, ...walk(node.props.children), ...walk(node.props.action)];
}
function text(tree: React.ReactNode): string {
	if (typeof tree === "string" || typeof tree === "number") return String(tree);
	if (Array.isArray(tree)) return tree.map(text).join("");
	return React.isValidElement(tree) ? text((tree as Element).props.children) : "";
}

const source = readFileSync(new URL("./schema-library-view.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "schema-library-view.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);

let active: Fixture;
/** Loads a fresh copy of the production module, so module state starts empty for each fixture. */
function loadView(store: libraryModel.SchemaLibraryStore) {
	const modules: Record<string, unknown> = {
		react: localReact,
		"react/jsx-runtime": jsx,
		"@cloudflare/kumo/components/banner": { Banner },
		"@cloudflare/kumo/components/button": { Button },
		"@cloudflare/kumo/components/code": { CodeBlock },
		"@cloudflare/kumo/components/dialog": { Dialog },
		"@cloudflare/kumo/components/input": { Input, InputArea },
		"@tanstack/react-query": { useQuery: (options: { queryKey: unknown }) => active.query(options) },
		"@phosphor-icons/react": { ArrowClockwise: icon, Books: icon, Info: icon, MagnifyingGlass: icon, Plus: icon, Warning: icon, WarningCircle: icon },
		"@shipitseo/emdash-plugin-seo/admin-contract": contract,
		"./api.ts": {
			fetchSeoSchemaLibrary: () => assert.fail("Reads go through the query cache fixture"),
			saveSeoSchemaLibraryTemplate: (request: unknown) => active.save(request),
			deleteSeoSchemaLibraryTemplate: (request: unknown) => active.remove(request),
		},
		"./entry-schema-authoring-controls.tsx": { EntrySchemaAuthoringControls },
		"./entry-schema-authoring.ts": authoring,
		"./schema-library-model.ts": { ...libraryModel, schemaLibraryStore: store },
		"./workspace-model.ts": workspaceModel,
	};
	const output = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", compiled.outputText)((name: string) => {
		assert.ok(Object.hasOwn(modules, name), "Unexpected production import: " + name);
		return modules[name];
	}, output, output.exports);
	return output.exports.SchemaLibraryView as (props: { onUseTemplate(template: contract.SchemaLibraryTemplate): void }) => Element;
}

const advancedJson = (name: string) => JSON.stringify({ "@context": "https://schema.org", "@type": "Event", name, url: "{{canonical}}" });
function template(id: string, name: string, updatedAt = "2026-10-16T10:00:00.000Z"): contract.SchemaLibraryTemplate {
	return { id, name, json: advancedJson("{{title}}"), createdAt: "2026-10-16T10:00:00.000Z", updatedAt };
}
function library(templates: contract.SchemaLibraryTemplate[], revision = "library-1"): contract.SeoAdminSchemaLibrary {
	return {
		contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, engineVersion: contract.SEO_ENGINE_VERSION,
		state: "saved", revision, templates,
		bytes: new TextEncoder().encode(JSON.stringify({ version: 1, templates })).byteLength,
		corrupt: null, conditionalStorage: true, limits: contract.SEO_ADMIN_SCHEMA_LIBRARY_LIMITS,
	};
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface QueryState {
	data: libraryModel.SchemaLibraryRead | undefined;
	isPending: boolean;
	isError: boolean;
	isFetching: boolean;
	error: unknown;
}

class Fixture {
	store = libraryModel.createSchemaLibraryStore();
	View = loadView(this.store);
	cache: QueryState = { data: undefined, isPending: true, isError: false, isFetching: true, error: null };
	reads = 0;
	saves: unknown[] = [];
	removes: unknown[] = [];
	used: contract.SchemaLibraryTemplate[] = [];
	saveReply: () => Promise<unknown> = () => Promise.reject(new Error("Every simulated save answer is explicit"));
	removeReply: () => Promise<unknown> = () => Promise.reject(new Error("Unexpected delete"));
	view = new HookOwner();
	rows = new Map<string, HookOwner>();
	nodes = new Map<string, FakeNode>();
	refs = new Set<{ current: unknown }>();
	query(options: { queryKey: unknown }) {
		assert.deepEqual(options.queryKey, workspaceModel.seoWorkspaceKeys.schemaLibrary);
		return { ...this.cache, refetch: () => {
			this.reads += 1;
			this.cache = { ...this.cache, isFetching: true };
			return new Promise(() => {});
		} };
	}
	async save(request: unknown) { this.saves.push(structuredClone(request)); return this.saveReply(); }
	async remove(request: unknown) { this.removes.push(structuredClone(request)); return this.removeReply(); }
	/** A successful read; the cache replaces its data and clears the error. */
	answer(read: contract.SeoAdminSchemaLibrary, requestedAt = performance.now()) {
		this.cache = { data: { library: read, requestedAt }, isPending: false, isError: false, isFetching: false, error: null };
	}
	/** A failed read; the cache keeps whatever data it had, as TanStack Query does. */
	fail(error: unknown) {
		this.cache = { ...this.cache, isPending: false, isError: true, isFetching: false, error };
	}
	node(element: Element): FakeNode {
		const tag = element.type === Button ? "button" : element.type === Input ? "input" : element.type === InputArea ? "textarea"
			: typeof element.type === "string" ? element.type : "div";
		// A wrapper with no text of its own, such as a notice, is named by the banner it holds.
		const label = String(element.props["aria-label"] ?? element.props.id ?? element.props.label ?? (text(element.props.children)
			|| (walk(element.props.children).find((child) => child.type === Banner)?.props.title ?? "")));
		const key = tag + ":" + label;
		let found = this.nodes.get(key);
		if (!found) { found = new FakeNode(tag, label); this.nodes.set(key, found); }
		found.focusable = ["button", "input", "textarea"].includes(tag) || element.props.tabIndex !== undefined;
		found.disabled = Boolean(element.props.disabled || element.props.loading);
		return found;
	}
	/** Renders the view and its rows, attaches refs as a commit does, then runs effects. */
	render(depth = 0): { tree: Element; all: Element[] } {
		active = this;
		const snapshot = this.store.get();
		const tree = this.view.render(() => this.View({ onUseTemplate: (picked) => this.used.push(picked) }));
		const all = walk(tree);
		const onFocus = all.find((element) => element.type === "section")?.props.onFocus as ((event: { target: FakeNode }) => void) | undefined;
		deliverFocus = (node) => {
			if (node.isConnected && [...this.nodes.values()].includes(node)) onFocus?.({ target: node });
		};
		const rows = all.filter((node) => node.props.template && typeof node.props.onUse === "function");
		for (const row of rows) {
			const id = row.props.template.id as string;
			const rowOwner = this.rows.get(id) ?? new HookOwner();
			this.rows.set(id, rowOwner);
			all.push(...walk(rowOwner.render(() => (row.type as unknown as (props: unknown) => React.ReactNode)(row.props))));
		}
		const attached = new Set<{ current: unknown }>();
		for (const element of all) {
			const ref = element.props.ref as { current: unknown } | undefined;
			if (!ref || typeof ref !== "object" || !("current" in ref)) continue;
			ref.current = this.node(element);
			attached.add(ref);
		}
		for (const ref of this.refs) if (!attached.has(ref)) ref.current = null;
		this.refs = attached;
		// As in a browser, a control this render no longer draws leaves the document and drops its focus,
		// and so does one it draws disabled, as a busy button is.
		const drawn = new Set(all.filter((element) => element.type === Button || element.type === Input || element.type === InputArea
			|| typeof element.type === "string").map((element) => this.node(element)));
		for (const node of this.nodes.values()) node.isConnected = drawn.has(node);
		if (doc.activeElement && doc.activeElement !== doc.body && (!doc.activeElement.isConnected || doc.activeElement.disabled)) {
			doc.activeElement = doc.body;
		}
		this.view.flush();
		for (const rowOwner of this.rows.values()) rowOwner.flush();
		// As useSyncExternalStore does, a store change made by an effect renders the view again.
		if (this.store.get() !== snapshot) {
			assert.ok(depth < 5, "the store settles within a few renders");
			return this.render(depth + 1);
		}
		return { tree, all };
	}
	mount() {
		this.view = new HookOwner();
		this.rows = new Map();
		this.nodes = new Map();
		this.refs = new Set();
		return this.render();
	}
	unmount() {
		for (const node of this.nodes.values()) node.isConnected = false;
		if (doc.activeElement && !doc.activeElement.isConnected) doc.activeElement = doc.body;
	}
}

function button(all: Element[], label: string) {
	const found = all.filter((node) => node.type === Button && (text(node.props.children) === label || node.props["aria-label"] === label));
	assert.equal(found.length, 1, "One button: " + label);
	return found[0]!;
}
function banner(all: Element[], title: string) {
	return all.filter((node) => node.type === Banner && node.props.title === title);
}
function form(all: Element[]) {
	return all.filter((node) => node.type === "form");
}
function nameInput(all: Element[]) {
	const found = all.filter((node) => node.type === Input && node.props.label === "Name");
	assert.equal(found.length, 1, "One name input");
	return found[0]!;
}
function row(all: Element[], id: string) {
	const found = all.filter((node) => node.props.template?.id === id && typeof node.props.onUse === "function");
	assert.equal(found.length, 1, "One row: " + id);
	return found[0]!;
}

const failures: string[] = [];
let groups = 0;
async function check(name: string, run: () => unknown) {
	try { await run(); groups += 1; } catch (error) { failures.push(name + ": " + (error instanceof Error ? error.message : String(error))); }
}

const unconfirmedTitle = "Save not confirmed";
const readAgainTitle = "The schema library could not be read again";

// A save whose answer is lost, followed by a failed read, keeps the form, the draft and the
// unconfirmed notice on screen, shows the read failure inline and accepts no write until a
// later read answers.
await check("failed read after an unconfirmed save", async () => {
	const f = new Fixture();
	const original = template("tpl-aaaaaaaaaaaaaaaaaaaa", "Reusable event");
	f.answer(library([original]));
	f.mount();
	row(f.render().all, original.id).props.onEdit();
	nameInput(f.render().all).props.onChange({ target: { value: "Edited event" } });
	let view = f.render().all;
	assert.equal(button(view, "Save changes").props.disabled, false, "control: the edited form can be saved");
	f.saveReply = () => Promise.reject(new TypeError("Failed to fetch"));
	form(view)[0]!.props.onSubmit({ preventDefault() {} });
	await settle();
	assert.equal(f.saves.length, 1);
	assert.equal(f.reads, 1, "control: the unknown outcome asks for one read");
	assert.ok(f.store.get().unconfirmed, "control: the store holds the unknown outcome");
	f.fail(new Error("Library read failed with 500"));
	view = f.render().all;
	assert.equal(form(view).length, 1, "the form stays visible after the failed read");
	assert.equal(banner(view, unconfirmedTitle).length, 1, "the Save not confirmed notice stays visible");
	assert.equal(nameInput(view).props.value, "Edited event", "the draft stays visible");
	assert.equal(nameInput(view).props.disabled, true, "the sent draft cannot change before a read");
	const failure = banner(view, readAgainTitle);
	assert.equal(failure.length, 1, "the read failure is shown inline");
	assert.ok(view.some((node) => node.props.role === "alert" && walk(node.props.children).includes(failure[0]!)), "the read failure is announced");
	assert.equal(button(view, "Save changes").props.disabled, true, "Save stays off after the failed read");
	assert.equal(button(view, "New template").props.disabled, true);
	form(view)[0]!.props.onSubmit({ preventDefault() {} });
	await settle();
	assert.equal(f.saves.length, 1, "no second write before a successful read");
	const retry = button(walk(failure[0]!.props.action), "Try again");
	assert.notEqual(retry.props.loading, true, "control: Try again is idle before it is pressed");
	retry.props.onClick();
	assert.equal(f.reads, 2, "Try again sends one read");
	view = f.render().all;
	assert.equal(button(walk(banner(view, readAgainTitle)[0]!.props.action), "Try again").props.loading, true,
		"Try again shows that its read is running");
	assert.equal(form(view).length, 1, "the form stays visible while the read runs");
	assert.equal(button(view, "Save changes").props.disabled, true, "Save stays off while the read runs");
	f.answer(library([{ ...original, name: "Edited event", updatedAt: "2026-10-16T11:00:00.000Z" }], "library-2"), performance.now() + 1);
	f.render();
	view = f.render().all;
	assert.equal(banner(view, readAgainTitle).length, 0, "a successful read ends the read failure");
	assert.equal(banner(view, unconfirmedTitle).length, 0, "a later read settles the unknown outcome");
	assert.equal(f.store.get().editor, null);
	assert.ok(banner(view, 'The library now holds "Edited event" with the content of your form.').length === 1);
	assert.equal(f.saves.length, 1);
});

// A failed refresh with no write outstanding keeps the list but turns every write off,
// including a deletion already under review, until a read succeeds.
await check("failed refresh without an outstanding write", async () => {
	const f = new Fixture();
	const kept = template("tpl-bbbbbbbbbbbbbbbbbbbb", "Kept event");
	f.answer(library([kept]));
	let view = f.mount().all;
	assert.equal(button(view, "New template").props.disabled, false, "control: New template is available after a read");
	f.fail(new Error("Library read failed with 500"));
	view = f.render().all;
	assert.equal(banner(view, readAgainTitle).length, 1, "the list stays and the read failure is shown inline");
	assert.equal(button(view, "New template").props.disabled, true, "no new template after a failed read");
	for (const label of ["Use template Kept event", "Edit Kept event", "Delete Kept event"]) {
		assert.equal(button(view, label).props.disabled, true, label + " waits for a successful read");
	}
	f.answer(library([kept]));
	view = f.render().all;
	row(view, kept.id).props.onDelete();
	view = f.render().all;
	assert.equal(button(view, "Delete template").props.disabled, false, "control: the reviewed deletion can be sent");
	f.fail(new Error("Library read failed with 500"));
	view = f.render().all;
	const remove = button(view, "Delete template");
	assert.equal(remove.props.disabled, true, "a reviewed deletion waits for a successful read");
	remove.props.onClick();
	await settle();
	assert.deepEqual(f.removes, [], "no deletion is sent after a failed read");
	f.fail(Object.assign(new Error("Forbidden"), { status: 403 }));
	view = f.render().all;
	assert.equal(banner(view, "The schema library needs administrator access").length, 1, "a denied read says which permission is missing");
	const empty = new Fixture();
	empty.fail(new Error("First read failed"));
	view = empty.mount().all;
	assert.equal(banner(view, "The schema library could not be loaded").length, 1, "with nothing loaded, the error page stays");
	assert.equal(form(view).length, 0);
	button(view, "Try again").props.onClick();
	assert.equal(empty.reads, 1);
});

// A successful Try again unmounts its own alert; focus goes to the Library heading, not the page body.
await check("focus after a successful Try again", async () => {
	const f = new Fixture();
	const kept = template("tpl-cccccccccccccccccccc", "Retry event");
	f.answer(library([kept]));
	f.mount();
	f.fail(new Error("Library read failed with 500"));
	let view = f.render().all;
	const retry = button(walk(banner(view, readAgainTitle)[0]!.props.action), "Try again");
	f.node(retry).focus();
	assert.equal(doc.activeElement?.label, "Try again", "control: Try again holds focus");
	retry.props.onClick();
	f.answer(library([kept]));
	view = f.render().all;
	assert.equal(banner(view, readAgainTitle).length, 0, "control: a successful read removes the alert");
	assert.equal(doc.activeElement?.label, "seo-library-title", "focus moves to the Library heading");
});

// Back from the builder mounts the Library again; focus returns to the Use template button
// that opened the copy, or to the Library heading when that button is gone or off.
await check("focus after Back from the builder", async () => {
	const f = new Fixture();
	const first = template("tpl-cccccccccccccccccccc", "First event");
	const second = template("tpl-dddddddddddddddddddd", "Second event");
	f.answer(library([first, second]));
	doc.activeElement = doc.body;
	let view = f.mount().all;
	assert.equal(doc.activeElement, doc.body, "Opening Library directly moves no focus");
	row(view, second.id).props.onUse();
	assert.deepEqual(f.used.map((item) => item.id), [second.id], "control: Use template opens the copy");
	const builderHeading = new FakeNode("h2", "Schema draft");
	builderHeading.focusable = true;
	const openBuilder = () => {
		f.unmount();
		builderHeading.visible = true;
		builderHeading.focus();
		assert.equal(doc.activeElement, builderHeading, "control: the builder heading holds focus");
	};
	openBuilder();
	builderHeading.visible = false;
	f.mount();
	assert.equal(doc.activeElement?.label, "Use template Second event", "Back returns focus to the Use template button that started the copy");
	openBuilder();
	builderHeading.visible = false;
	f.mount();
	assert.equal(doc.activeElement?.label, "Use template Second event", "a second Back returns focus there again");
	openBuilder();
	builderHeading.visible = false;
	f.answer(library([first], "library-2"));
	f.mount();
	assert.equal(doc.activeElement?.label, "seo-library-title", "with the template gone, focus goes to the Library heading");
	assert.equal((doc.activeElement as FakeNode).attributes.get("tabindex"), "-1");
	f.answer(library([first, second], "library-3"));
	openBuilder();
	const tab = new FakeNode("button", "Library tab");
	tab.focusable = true;
	tab.focus();
	f.mount();
	assert.equal(doc.activeElement, tab, "a person who chose the Library tab keeps focus on it");
	openBuilder();
	builderHeading.visible = false;
	f.cache = { data: undefined, isPending: true, isError: false, isFetching: true, error: null };
	f.mount();
	assert.equal(doc.activeElement, builderHeading, "nothing moves while the library is loading");
	f.answer(library([first, second], "library-3"));
	f.render();
	assert.equal(doc.activeElement?.label, "Use template Second event", "focus returns once the list is shown");
	openBuilder();
	builderHeading.visible = false;
	f.fail(new Error("Library read failed with 500"));
	f.mount();
	assert.equal(doc.activeElement?.label, "seo-library-title", "an unavailable Use template button sends focus to the heading");
});

const builder = new FakeNode("h2", "Schema draft");
builder.focusable = true;
/** Use template, the builder taking focus, then Back: the cached list shows while the read sent on mount runs. */
function useThenBack(f: Fixture, view: Element[], picked: contract.SchemaLibraryTemplate) {
	row(view, picked.id).props.onUse();
	f.unmount();
	builder.visible = true;
	builder.focus();
	assert.equal(doc.activeElement, builder, "control: the builder heading holds focus");
	builder.visible = false;
	f.cache = { ...f.cache, isFetching: true };
	const shown = f.mount().all;
	assert.equal(doc.activeElement?.label, "Use template " + picked.name, "control: the cached list returns focus to the button");
	return shown;
}
function searchInput(all: Element[]) {
	const found = all.filter((node) => node.type === Input && node.props.label === "Search templates");
	assert.equal(found.length, 1, "One search input");
	return found[0]!;
}
function tryAgain(all: Element[]) {
	const failure = banner(all, readAgainTitle);
	assert.equal(failure.length, 1, "One read failure");
	return button(walk(failure[0]!.props.action), "Try again");
}
/** Opens the template, renames it and presses Save changes by keyboard; the answer is lost, so the outcome is unknown. */
async function unknownSave(f: Fixture, original: contract.SchemaLibraryTemplate, name: string) {
	const reads = f.reads;
	row(f.render().all, original.id).props.onEdit();
	nameInput(f.render().all).props.onChange({ target: { value: name } });
	let view = f.render().all;
	f.node(button(view, "Save changes")).focus();
	assert.equal(doc.activeElement?.label, "Save changes", "control: Save changes holds focus");
	f.saveReply = () => Promise.reject(new TypeError("Failed to fetch"));
	form(view)[0]!.props.onSubmit({ preventDefault() {} });
	view = f.render().all;
	assert.equal(button(view, "Save changes").props.loading, true, "control: Save changes is busy while the save runs");
	assert.equal(doc.activeElement, doc.body, "nothing moves focus while the save request runs");
	await settle();
	view = f.render().all;
	assert.equal(banner(view, unconfirmedTitle).length, 1, "control: the save outcome is unknown");
	assert.equal(f.reads, reads + 1, "control: the unknown outcome asks for one read");
	assert.equal(doc.activeElement?.label, unconfirmedTitle, "control: the Save not confirmed alert holds focus");
	return view;
}

// When the read sent on mount no longer lists the template, its Use template button leaves the page
// and focus goes to the Library heading.
await check("focus after Back when the read removes the template", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const kept = template("tpl-eeeeeeeeeeeeeeeeeeee", "Kept event");
	const temporary = template("tpl-ffffffffffffffffffff", "Temporary event");
	f.answer(library([kept, temporary]));
	useThenBack(f, f.mount().all, temporary);
	f.answer(library([kept], "library-2"));
	const view = f.render().all;
	assert.equal(view.some((node) => node.props["aria-label"] === "Use template Temporary event"), false, "control: the read removed the template");
	assert.equal(doc.activeElement?.label, "seo-library-title", "focus goes to the Library heading");
	assert.equal((doc.activeElement as FakeNode).attributes.get("tabindex"), "-1");
});

// When the read sent on mount fails, the cached Use template button turns off and focus goes to the Library heading.
await check("focus after Back when the read fails", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const listed = template("tpl-gggggggggggggggggggg", "Listed event");
	f.answer(library([listed]));
	useThenBack(f, f.mount().all, listed);
	f.fail(new Error("Library read failed with 500"));
	const view = f.render().all;
	assert.equal(button(view, "Use template Listed event").props.disabled, true, "control: the failed read turns the button off");
	assert.equal(doc.activeElement?.label, "seo-library-title", "focus goes to the Library heading");
});

// A read that keeps the button usable leaves focus on it, and focus a person moved while the read ran stays.
await check("focus after Back that the read leaves in place", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const kept = template("tpl-eeeeeeeeeeeeeeeeeeee", "Kept event");
	const temporary = template("tpl-ffffffffffffffffffff", "Temporary event");
	f.answer(library([kept, temporary]));
	useThenBack(f, f.mount().all, temporary);
	f.answer(library([kept, temporary]));
	let view = f.render().all;
	assert.equal(doc.activeElement?.label, "Use template Temporary event", "a button the read keeps usable keeps focus");
	useThenBack(f, view, temporary);
	const tab = new FakeNode("button", "Library tab");
	tab.focusable = true;
	tab.focus();
	f.answer(library([kept], "library-2"));
	f.render();
	assert.equal(doc.activeElement, tab, "focus a person moved to the Library tab stays");
	f.answer(library([kept, temporary], "library-3"));
	view = useThenBack(f, f.render().all, temporary);
	f.node(searchInput(view)).focus();
	f.answer(library([kept], "library-4"));
	f.render();
	assert.equal(doc.activeElement?.label, "Search templates", "focus a person moved to Search templates stays");
});

// A busy Try again drops focus to the page. Once its read settles, also as a second failure, focus goes
// to the Library heading; focus a person placed on another control while the read ran stays.
await check("focus after a Try again whose read fails again", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const kept = template("tpl-hhhhhhhhhhhhhhhhhhhh", "Failing event");
	f.answer(library([kept]));
	f.mount();
	f.fail(new Error("Library read failed with 500"));
	let view = f.render().all;
	f.node(tryAgain(view)).focus();
	assert.equal(doc.activeElement?.label, "Try again", "control: Try again holds focus");
	tryAgain(view).props.onClick();
	view = f.render().all;
	assert.equal(tryAgain(view).props.loading, true, "control: Try again is busy while its read runs");
	assert.equal(doc.activeElement, doc.body, "control: the busy Try again drops focus to the page, and nothing moves it before the read settles");
	f.fail(new Error("Library read failed with 500"));
	view = f.render().all;
	assert.notEqual(tryAgain(view).props.loading, true, "control: the failed read ends the busy state");
	assert.equal(doc.activeElement?.label, "seo-library-title", "focus goes to the Library heading");
	f.node(tryAgain(view)).focus();
	tryAgain(view).props.onClick();
	view = f.render().all;
	assert.equal(doc.activeElement, doc.body, "control: the second busy Try again drops focus too");
	f.node(searchInput(view)).focus();
	f.fail(new Error("Library read failed with 500"));
	f.render();
	assert.equal(doc.activeElement?.label, "Search templates", "focus a person placed on Search templates stays");
});

// The read that settles an unknown save and keeps the form removes the Save not confirmed alert that
// held focus; focus goes to the Library heading.
await check("focus after a read settles an unknown save and keeps the form", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const original = template("tpl-iiiiiiiiiiiiiiiiiiii", "Unknown event");
	f.answer(library([original]));
	f.mount();
	await unknownSave(f, original, "Never stored event");
	f.answer(library([original]), performance.now() + 1);
	const view = f.render().all;
	assert.equal(banner(view, unconfirmedTitle).length, 0, "control: the read settles the outcome");
	assert.equal(form(view).length, 1, "control: the form is kept");
	assert.equal(banner(view, "The library holds this template as you opened it. Your form is kept; save again to apply it.").length, 1);
	assert.equal(doc.activeElement?.label, "seo-library-title", "focus goes to the Library heading");
});

// The read that settles an unknown save and closes the form moves focus once, to New template, the
// control that starts again: after a failed read and a Try again, and as the automatic read. Close
// moves focus there too.
await check("focus after a read settles an unknown save and closes the form", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const original = template("tpl-jjjjjjjjjjjjjjjjjjjj", "Stored event");
	f.answer(library([original]));
	f.mount();
	let view = await unknownSave(f, original, "Stored edit");
	f.fail(new Error("Library read failed with 500"));
	view = f.render().all;
	assert.equal(doc.activeElement?.label, unconfirmedTitle, "control: the alert keeps focus after a failed read");
	f.node(tryAgain(view)).focus();
	tryAgain(view).props.onClick();
	f.render();
	assert.equal(doc.activeElement, doc.body, "control: the busy Try again drops focus to the page");
	focusLog.length = 0;
	const stored = { ...original, name: "Stored edit", updatedAt: "2026-10-16T11:00:00.000Z" };
	f.answer(library([stored], "library-2"), performance.now() + 1);
	view = f.render().all;
	assert.equal(form(view).length, 0, "control: the read closes the form");
	assert.equal(banner(view, 'The library now holds "Stored edit" with the content of your form.').length, 1);
	assert.deepEqual(focusLog, ["New template"], "focus moves once, to New template, after a Try again");
	await unknownSave(f, stored, "Stored again");
	focusLog.length = 0;
	f.answer(library([{ ...stored, name: "Stored again", updatedAt: "2026-10-16T12:00:00.000Z" }], "library-3"), performance.now() + 1);
	view = f.render().all;
	assert.equal(form(view).length, 0, "control: the automatic read closes the form");
	assert.deepEqual(focusLog, ["New template"], "focus moves once, to New template, after the automatic read");
	row(view, original.id).props.onEdit();
	view = f.render().all;
	f.node(button(view, "Close")).focus();
	button(view, "Close").props.onClick();
	f.render();
	assert.equal(doc.activeElement?.label, "New template", "Close moves focus to New template");
});

// A read that closes the form leaves focus a person placed on another control while it ran.
await check("a read that closes the form keeps focus a person placed elsewhere", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const original = template("tpl-kkkkkkkkkkkkkkkkkkkk", "Searched event");
	f.answer(library([original]));
	f.mount();
	const view = await unknownSave(f, original, "Searched edit");
	f.node(searchInput(view)).focus();
	assert.equal(doc.activeElement?.label, "Search templates", "control: the person moved focus while the read ran");
	f.answer(library([{ ...original, name: "Searched edit", updatedAt: "2026-10-16T11:00:00.000Z" }], "library-2"), performance.now() + 1);
	const after = f.render().all;
	assert.equal(form(after).length, 0, "control: the read closes the form");
	assert.equal(doc.activeElement?.label, "Search templates", "focus stays on Search templates");
});

// A save answer that closes the form sends focus that left with the form to New template, and leaves
// focus a person placed on another control while the save ran.
await check("a save that closes the form keeps focus a person placed elsewhere", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const original = template("tpl-llllllllllllllllllll", "Saved event");
	f.answer(library([original]));
	f.mount();
	const saveRenamed = async (current: contract.SchemaLibraryTemplate, name: string, revision: string, during: (view: Element[]) => void) => {
		row(f.render().all, current.id).props.onEdit();
		nameInput(f.render().all).props.onChange({ target: { value: name } });
		let view = f.render().all;
		f.node(button(view, "Save changes")).focus();
		let answer: (value: unknown) => void = () => {};
		f.saveReply = () => new Promise((resolve) => { answer = resolve; });
		form(view)[0]!.props.onSubmit({ preventDefault() {} });
		view = f.render().all;
		assert.equal(button(view, "Save changes").props.loading, true, "control: Save changes is busy while the save runs");
		during(view);
		focusLog.length = 0;
		const stored = { ...current, name, updatedAt: "2026-10-16T11:00:00.000Z" };
		answer({ contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, success: true, changed: true, template: stored, library: library([stored], revision) });
		await settle();
		view = f.render().all;
		assert.equal(form(view).length, 0, "control: the save answer closes the form");
		assert.equal(banner(view, `Saved "${name}".`).length, 1, "control: the save succeeded");
		return stored;
	};
	const first = await saveRenamed(original, "Saved edit", "library-2", () =>
		assert.equal(doc.activeElement, doc.body, "control: the busy Save changes drops focus to the page"));
	assert.deepEqual(focusLog, ["New template"], "focus that left with the form goes once to New template");
	f.answer(library([first], "library-2"), performance.now() + 1);
	f.render();
	await saveRenamed(first, "Saved again", "library-3", (view) => {
		f.node(searchInput(view)).focus();
		assert.equal(doc.activeElement?.label, "Search templates", "control: the person moved focus while the save ran");
	});
	assert.deepEqual(focusLog, [], "the save answer moves no focus");
	assert.equal(doc.activeElement?.label, "Search templates", "focus stays on Search templates");
});

// A refused deletion leaves its failure notice in the store. Use template and Back show that notice
// again, and focus returns to the Use template button that started the copy, not to the notice.
await check("focus after Back with a notice kept from before", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const refused = template("tpl-mmmmmmmmmmmmmmmmmmmm", "Refused event");
	const picked = template("tpl-nnnnnnnnnnnnnnnnnnnn", "Picked event");
	f.answer(library([refused, picked]));
	let view = f.mount().all;
	row(view, refused.id).props.onDelete();
	view = f.render().all;
	f.removeReply = () => Promise.resolve({ contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, success: false, error: "conflict", message: "The request was refused." });
	button(view, "Delete template").props.onClick();
	await settle();
	view = f.render().all;
	assert.equal(f.removes.length, 1, "control: one deletion was sent");
	assert.equal(doc.activeElement?.label, "The request was refused.", "control: the new failure notice takes focus");
	row(view, picked.id).props.onUse();
	assert.deepEqual(f.used.map((item) => item.id), [picked.id], "control: Use template opens the copy");
	f.unmount();
	builder.visible = true;
	builder.focus();
	assert.equal(doc.activeElement, builder, "control: the builder heading holds focus");
	builder.visible = false;
	view = f.mount().all;
	assert.equal(banner(view, "The request was refused.").length, 1, "control: the notice from before Back is shown again");
	assert.equal(doc.activeElement?.label, "Use template Picked event", "Back returns focus to the Use template button, not to the kept notice");
	const refuseAgain = async () => {
		row(view, refused.id).props.onDelete();
		view = f.render().all;
		button(view, "Delete template").props.onClick();
		await settle();
		view = f.render().all;
	};
	await refuseAgain();
	assert.equal(f.removes.length, 2, "control: a second deletion was sent after Back");
	assert.equal(doc.activeElement?.label, "The request was refused.", "a refusal after Back takes focus");
	row(view, picked.id).props.onUse();
	f.unmount();
	const tab = new FakeNode("button", "Library tab");
	tab.focusable = true;
	tab.focus();
	view = f.mount().all;
	assert.equal(doc.activeElement, tab, "control: focus a person moved to the Library tab stays after Back");
	await refuseAgain();
	assert.equal(f.removes.length, 3, "control: a third deletion was sent");
	assert.equal(doc.activeElement?.label, "The request was refused.", "a refusal after that Back takes focus too");
});

// Switching away from the Library and back mounts it again; a notice kept in the store from before stays
// on screen and does not take focus from the tab the person chose.
await check("a kept notice does not take focus on a plain remount", async () => {
	doc.activeElement = doc.body;
	const f = new Fixture();
	const refused = template("tpl-oooooooooooooooooooo", "Kept refusal");
	f.answer(library([refused]));
	let view = f.mount().all;
	row(view, refused.id).props.onDelete();
	view = f.render().all;
	f.removeReply = () => Promise.resolve({ contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, success: false, error: "conflict", message: "The request was refused." });
	button(view, "Delete template").props.onClick();
	await settle();
	f.render();
	assert.equal(doc.activeElement?.label, "The request was refused.", "control: the new failure notice takes focus");
	f.unmount();
	const tab = new FakeNode("button", "Library tab");
	tab.focusable = true;
	tab.focus();
	view = f.mount().all;
	assert.equal(banner(view, "The request was refused.").length, 1, "control: the kept notice is shown again");
	assert.equal(doc.activeElement, tab, "focus stays on the Library tab");
});

if (failures.length) {
	console.error(failures.join("\n"));
	throw new Error(failures.length + " schema library view group(s) failed");
}
console.log(JSON.stringify({ status: "passed", groups, scope: "Production SchemaLibraryView under a hook owner: read failure recovery, focus after Back and focus after recovery reads" }));
