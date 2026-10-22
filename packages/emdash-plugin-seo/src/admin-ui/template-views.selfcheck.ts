import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input, Textarea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import * as contract from "@shipitseo/emdash-plugin-seo/admin-contract";
import type { SeoAdminTemplateConfiguration, SeoAdminTemplateItem, SeoAdminTemplateValues } from "@shipitseo/emdash-plugin-seo/admin-contract";

import * as entrySchemaModel from "./entry-schema-model.ts";
import * as templatesModel from "./metadata-templates-model.ts";
import * as exampleModel from "./template-example-selection-model.ts";
import * as editorModel from "./template-editor-model.ts";
import * as workspaceModel from "./workspace-model.ts";

const {
	TEMPLATE_TYPE_LIST_MAX, insertTemplateVariable, templateFieldExamples, templateTypeLabel, templateTypePickerMode,
} = editorModel;

let cases = 0;
function check(name: string, run: () => void | Promise<void>) { return Promise.resolve(run()).then(() => { cases += 1; }, (error) => { throw new Error(name, { cause: error }); }); }

// ---- Pure editor rules ------------------------------------------------------

await check("type picker and caret insertion rules", () => {
	assert.equal(TEMPLATE_TYPE_LIST_MAX, 4);
	assert.deepEqual([0, 1, 4, 5, 8].map(templateTypePickerMode), ["list", "list", "list", "select", "select"]);
	assert.equal(templateTypeLabel("Posts", false), "Posts");
	assert.equal(templateTypeLabel("Posts", true), "Posts (edited)");
	assert.deepEqual(insertTemplateVariable("Read more", "title", 4, 4), { value: "Read{{title}} more", caret: 13 });
	assert.deepEqual(insertTemplateVariable("Read more", "title", 0, 4), { value: "{{title}} more", caret: 9 }, "A selection is replaced");
	assert.deepEqual(insertTemplateVariable("Read", "title", null, null), { value: "Read{{title}}", caret: 13 }, "No caret inserts at the end");
	assert.deepEqual(insertTemplateVariable("Read", "title", 9, 9), { value: "Read{{title}}", caret: 13 }, "An out-of-range caret inserts at the end");
	assert.deepEqual(insertTemplateVariable("Read", "title", 3, 1), { value: "Rea{{title}}d", caret: 12 }, "A reversed range never deletes text");
	assert.deepEqual(insertTemplateVariable("", "site", undefined, undefined), { value: "{{site}}", caret: 8 });
	const preview = { titleSuggestion: { value: "T", source: "template" }, description: { value: "D", source: "template" },
		socialTitle: { value: "", source: "template" }, socialDescription: { value: "SD", source: "template" } };
	const settled = { kind: "settled", outcome: { kind: "result", result: { success: true, preview } } } as never;
	assert.deepEqual(templateFieldExamples(settled), { title: "T", description: "D", socialTitle: "", socialDescription: "SD" });
	for (const view of [{ kind: "none" }, { kind: "pending" }, { kind: "stale" },
		{ kind: "settled", outcome: { kind: "failed", message: "x" } },
		{ kind: "settled", outcome: { kind: "result", result: { success: false, error: "not_found", message: "x" } } }] as never[]) {
		assert.equal(templateFieldExamples(view), null, "Only a settled successful preview of the current form yields examples");
	}
});

// ---- The production view with local hooks -----------------------------------

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
	effect(effect: () => unknown, deps?: readonly unknown[]) {
		const index = this.cursor++;
		const previous = this.cells[index];
		if (!deps || !previous?.deps || deps.length !== previous.deps.length || deps.some((value, i) => value !== previous.deps![i])) this.effects.push(effect);
		this.cells[index] = { value: null, deps };
	}
}
const localReact = {
	...React,
	useState: <T,>(initial: T | (() => T)) => owner.state(initial),
	useRef: <T,>(initial: T) => owner.ref(initial),
	useEffect: (effect: () => unknown, deps?: readonly unknown[]) => owner.effect(effect, deps),
	useLayoutEffect: (effect: () => unknown, deps?: readonly unknown[]) => owner.effect(effect, deps),
	useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T) => snapshot(),
};
const previews: unknown[] = [];
let previewAnswer: unknown = null;
const api = {
	fetchSeoAdminTemplateExample: () => Promise.reject(new Error("No exact example is requested here")),
	fetchSeoAdminTemplateExamples: () => Promise.reject(new Error("Examples come from the query fixture")),
	previewSeoAdminTemplate: (request: unknown) => { previews.push(request); return Promise.resolve(previewAnswer); },
	resetSeoAdminTemplate: () => Promise.reject(new Error("Unexpected reset")),
	saveSeoAdminTemplate: () => Promise.reject(new Error("Unexpected save")),
};
const examplePage = { success: true, items: [{ entryId: "e1", locale: "en", title: "Hello", slug: "hello" }], hasMore: false, cursor: null };
const useQuery = (options: { queryKey: readonly unknown[] }) => options.queryKey[1] === "template-examples"
	? { data: examplePage, isError: false, isPending: false, isFetching: false, status: "success", refetch: () => Promise.resolve() }
	: { data: undefined, isError: false, isPending: false, isFetching: false, status: "pending", refetch: () => Promise.resolve() };
const SettingsActionBar = () => null;
const modules: Record<string, unknown> = {
	"@cloudflare/kumo/components/badge": { Badge }, "@cloudflare/kumo/components/banner": { Banner }, "@cloudflare/kumo/components/button": { Button },
	"@cloudflare/kumo/components/dialog": { Dialog }, "@cloudflare/kumo/components/empty": { Empty }, "@cloudflare/kumo/components/input": { Input, Textarea },
	"@cloudflare/kumo/components/select": { Select }, "@phosphor-icons/react": icons, "@shipitseo/emdash-plugin-seo/admin-contract": contract,
	"@tanstack/react-query": { useQuery }, react: localReact, "react/jsx-runtime": jsx, "./api.ts": api, "./entry-schema-model.ts": entrySchemaModel,
	"./metadata-templates-model.ts": templatesModel, "./template-example-selection-model.ts": exampleModel, "./workspace-model.ts": workspaceModel,
	"./settings-action-bar.tsx": { SettingsActionBar }, "./template-editor-model.ts": editorModel,
};
const source = readFileSync(new URL("./template-views.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "template-views.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} as Record<string, any> };
new Function("require", "module", "exports", compiled.outputText)((name: string) => {
	assert.ok(Object.hasOwn(modules, name), "Unexpected production import: " + name);
	return modules[name];
}, output, output.exports);
const TemplatesView = output.exports.TemplatesView as (props: Record<string, unknown>) => React.ReactElement;

type Element = React.ReactElement<Record<string, any>>;
function elements(tree: React.ReactNode): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as Element;
	return [element, ...elements(element.props.children)];
}
function text(tree: React.ReactNode): string {
	if (typeof tree === "string" || typeof tree === "number") return String(tree);
	if (Array.isArray(tree)) return tree.map(text).join("");
	return React.isValidElement(tree) ? text((tree as Element).props.children) : "";
}
const VALUES: SeoAdminTemplateValues = { title: "{{title}}", description: "Read more", socialTitle: "{{title}}", socialDescription: "About {{title}}" };
function item(collection: string): SeoAdminTemplateItem {
	return { collection, label: collection[0]!.toUpperCase() + collection.slice(1), description: "Template for " + collection + ".", source: "override", values: { ...VALUES },
		inheritanceGuard: { fields: { title: null, description: null, socialTitle: null, socialDescription: null } },
		inherited: { source: "default", values: { ...VALUES }, ignoredLegacyFields: [] } };
}
let stamp = 1;
function read(collections: string[]) {
	const configuration: SeoAdminTemplateConfiguration = {
		contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, storageVersion: contract.SEO_ADMIN_TEMPLATES_STORAGE_VERSION, engineVersion: contract.SEO_ENGINE_VERSION,
		state: "saved", revision: "r1", discovery: "available", allowedVariables: ["title", "site"], outputSupport: contract.SEO_ADMIN_OUTPUT_SUPPORT,
		retainedCollections: [], items: collections.map(item),
	};
	return { configuration, requestedAt: stamp++ };
}
function mount(collections: string[]) {
	const hooks = new HookOwner();
	const props = { read: read(collections), reloading: false, onReload: () => {}, requestedRef: null, onRequestedRefChange: () => {}, onChanged: () => {} };
	const render = () => {
		let tree = hooks.render(() => TemplatesView(props)) as Element; hooks.flush();
		tree = hooks.render(() => TemplatesView(props)) as Element; hooks.flush();
		return tree;
	};
	return { render };
}
const byClass = (tree: React.ReactNode, className: string) => elements(tree).filter((node) => node.props.className === className);
const field = (tree: React.ReactNode, id: string) => {
	const found = elements(tree).filter((node) => node.props["data-seo-setting"] === id);
	assert.equal(found.length, 1, "One template field marked " + id);
	return found[0]!;
};
const settle = async () => { for (let turn = 0; turn < 10; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve)); };

await check("up to four types show a vertical list beside the fields and a narrow-width Select, with edited markers", () => {
	const view = mount(["posts", "pages", "events"]);
	let tree = view.render();
	const body = byClass(tree, "shipit-seo-template-body shipit-seo-template-body--list");
	assert.equal(body.length, 1, "The form body uses the list layout");
	const list = byClass(body, "shipit-seo-template-types");
	assert.equal(list.length, 1); assert.equal(list[0]!.props.role, "group");
	const buttons = elements(list).filter((node) => node.type === "button");
	assert.deepEqual(buttons.map((node) => [node.props["data-template-type"], text(node), node.props["aria-current"]]),
		[["posts", "Posts", "true"], ["pages", "Pages", undefined], ["events", "Events", undefined]]);
	assert.doesNotMatch(source, /components\/tabs|<Tabs\b/, "No segmented type tabs remain");
	const select = elements(byClass(body, "shipit-seo-template-type-select")).find((node) => node.type === Select)!;
	assert.deepEqual(select.props.items, { posts: "Posts", pages: "Pages", events: "Events" }); assert.equal(select.props.value, "posts");
	field(tree, "titleTemplate").props.onChange({ target: { value: "{{title}} edited" } });
	tree = view.render();
	assert.deepEqual(elements(byClass(tree, "shipit-seo-template-types")).filter((node) => node.type === "button").map(text), ["Posts (edited)", "Pages", "Events"]);
	assert.equal(elements(tree).find((node) => node.type === Select && node.props.label === "Content type")!.props.items.posts, "Posts (edited)");
	elements(byClass(tree, "shipit-seo-template-types")).find((node) => node.props["data-template-type"] === "pages")!.props.onClick();
	tree = view.render();
	assert.equal(field(tree, "titleTemplate").props.value, "{{title}}", "Switching type shows that type's own values");
	elements(byClass(tree, "shipit-seo-template-types")).find((node) => node.props["data-template-type"] === "posts")!.props.onClick();
	tree = view.render();
	assert.equal(field(tree, "titleTemplate").props.value, "{{title}} edited", "Switching back keeps the draft");
	templatesModel.templatesStore.dispatch({ type: "discard", collection: "posts" });
});

await check("more than four types always use the Select", () => {
	const view = mount(["posts", "pages", "events", "news", "products", "jobs", "faqs", "guides"]);
	const tree = view.render();
	assert.equal(byClass(tree, "shipit-seo-template-body shipit-seo-template-body--select").length, 1);
	assert.equal(byClass(tree, "shipit-seo-template-types").length, 0, "No list renders for eight types");
	const select = elements(tree).find((node) => node.type === Select && node.props.label === "Content type")!;
	assert.equal(Object.keys(select.props.items).length, 8);
	select.props.onValueChange("jobs");
	assert.equal(templatesModel.templatesStore.get().active, "jobs");
	select.props.onValueChange("missing");
	assert.equal(templatesModel.templatesStore.get().active, "jobs", "An unknown value selects nothing");
	select.props.onValueChange("posts");
});

await check("variable chips insert at the caret of the field used last and mark the form unsaved", () => {
	const view = mount(["posts", "pages", "events"]);
	let tree = view.render();
	const chips = elements(byClass(tree, "shipit-seo-template-vars")).filter((node) => node.type === "button");
	assert.deepEqual(chips.map((node) => node.props["data-template-variable"]), ["title", "site"]);
	assert.ok(chips.every((node) => node.props.type === "button"), "Chips never submit the form");
	let prevented = 0; chips[0]!.props.onMouseDown({ preventDefault: () => { prevented += 1; } });
	assert.equal(prevented, 1, "Pressing a chip keeps focus in the field");
	chips[0]!.props.onClick();
	tree = view.render();
	assert.equal(field(tree, "titleTemplate").props.value, "{{title}}{{title}}", "Before any focus the title field gets the token at its end");
	const bar = () => elements(tree).find((node) => node.type === SettingsActionBar)!;
	assert.equal(bar().props.status, "Unsaved changes");
	bar().props.onDiscard(); tree = view.render();
	assert.equal(field(tree, "titleTemplate").props.value, "{{title}}", "Discard removes the insertion");
	const calls: unknown[][] = [];
	const element = { selectionStart: 4, selectionEnd: 4, focus: () => calls.push(["focus"]), setSelectionRange: (start: number, end: number) => calls.push([start, end]) };
	const description = field(tree, "descriptionTemplate");
	description.props.ref(element); description.props.onFocus();
	elements(byClass(tree, "shipit-seo-template-vars")).find((node) => node.props["data-template-variable"] === "title")!.props.onClick();
	tree = view.render();
	assert.equal(field(tree, "descriptionTemplate").props.value, "Read{{title}} more");
	assert.equal(field(tree, "titleTemplate").props.value, "{{title}}", "Other fields are untouched");
	assert.deepEqual(calls, [["focus"], [13, 13]], "Focus returns to the field with the caret after the token");
	assert.equal(bar().props.status, "Unsaved changes");
	assert.equal(bar().props.saveDisabled, false);
	bar().props.onDiscard(); tree = view.render();
	assert.equal(field(tree, "descriptionTemplate").props.value, "Read more");
});

await check("after Preview each field shows its resolved example, and an edit hides stale examples", async () => {
	const view = mount(["posts", "pages", "events"]);
	let tree = view.render();
	assert.equal(byClass(tree, "shipit-seo-template-example").length, 0, "No examples before a preview");
	previewAnswer = { success: true, preview: {
		collection: "posts", entryId: "e1", locale: "en", slug: "hello", status: "published", publishedAt: null, version: 1, publicUrl: "https://example.test/hello",
		description: { value: "Read more", source: "template" }, socialTitle: { value: "Hello", source: "template" },
		socialDescription: { value: "", source: "template" }, titleSuggestion: { value: "Hello", source: "template" }, noindex: false,
	} };
	const previewButton = elements(tree).find((node) => node.type === Button && text(node) === "Preview")!;
	assert.equal(previewButton.props.disabled, false, "The published example is selected");
	previewButton.props.onClick();
	await settle();
	tree = view.render();
	assert.equal(previews.length, 1);
	const examples = byClass(tree, "shipit-seo-template-example").map(text);
	assert.deepEqual(examples, ["Example: Hello", "Example: Read more", "Example: Hello", "Example: empty, so this tag is not emitted"],
		"Every field shows its resolved example");
	for (const [id, index] of [["titleTemplate", 0], ["descriptionTemplate", 1], ["socialTitleTemplate", 2], ["socialDescriptionTemplate", 3]] as const) {
		const wrapper = byClass(tree, "shipit-seo-template-field")[index]!;
		assert.ok(elements(wrapper).some((node) => node.props["data-seo-setting"] === id), "Example " + index + " sits under " + id);
	}
	field(tree, "socialTitleTemplate").props.onChange({ target: { value: "{{title}} changed" } });
	tree = view.render();
	assert.equal(byClass(tree, "shipit-seo-template-example").length, 0, "A changed form hides examples until Preview runs again");
	templatesModel.templatesStore.dispatch({ type: "discard", collection: "posts" });
});

await check("one action bar with Use inherited at the left, confirmed through the dialog", () => {
	const view = mount(["posts", "pages", "events"]);
	const tree = view.render();
	const bars = elements(tree).filter((node) => node.type === SettingsActionBar);
	assert.equal(bars.length, 1);
	const bar = bars[0]!;
	assert.equal(bar.props.saveLabel, "Save template");
	assert.equal(bar.props.discardDisabled, true); assert.equal(bar.props.saveDisabled, true, "Clean forms cannot save or discard");
	const restore = bar.props.restore as Element;
	assert.equal(restore.type, Button); assert.equal(restore.props.variant, "secondary-destructive"); assert.equal(text(restore), "Use inherited");
	assert.equal(restore.props.disabled, false);
	restore.props.onClick();
	assert.equal(templatesModel.templatesStore.get().confirmingReset?.collection, "posts", "Restore opens the confirmation and writes nothing");
	templatesModel.templatesStore.dispatch({ type: "close-reset" });
	assert.equal(source.match(/<SettingsActionBar\b/g)?.length, 1);
});

console.log("Template editor self-check passed (" + cases + " cases).");
