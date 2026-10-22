import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EntrySchemaAuthoringControlsProps } from "./entry-schema-authoring-controls.tsx";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import * as badge from "@cloudflare/kumo/components/badge";
import * as banner from "@cloudflare/kumo/components/banner";
import * as button from "@cloudflare/kumo/components/button";
import * as code from "@cloudflare/kumo/components/code";
import * as collapsible from "@cloudflare/kumo/components/collapsible";
import * as dialog from "@cloudflare/kumo/components/dialog";
import * as empty from "@cloudflare/kumo/components/empty";
import * as input from "@cloudflare/kumo/components/input";
import * as select from "@cloudflare/kumo/components/select";
import * as query from "@tanstack/react-query";
import * as contract from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as codec from "./entry-schema-authoring.ts";
import * as model from "./entry-schema-model.ts";
import * as libraryModel from "./schema-library-model.ts";
import * as routes from "./api-routes.ts";
import * as workspaceModel from "./workspace-model.ts";
import { createEntrySchemaAuthoring, encodeEntrySchemaAuthoring } from "./entry-schema-authoring.ts";
import { addEntrySchemaEditor, createEntrySchemaCandidateStore, createEntrySchemaPanelStore } from "./entry-schema-model.ts";

const modules: Record<string, unknown> = {
	"@phosphor-icons/react": icons,
	"@cloudflare/kumo/components/badge": badge,
	"@cloudflare/kumo/components/banner": banner,
	"@cloudflare/kumo/components/button": button,
	"@cloudflare/kumo/components/code": code,
	"@cloudflare/kumo/components/collapsible": collapsible,
	"@cloudflare/kumo/components/dialog": dialog,
	"@cloudflare/kumo/components/empty": empty,
	"@cloudflare/kumo/components/input": input,
	"@cloudflare/kumo/components/select": select,
	"@tanstack/react-query": query,
	"@shipitseo/emdash-plugin-seo/admin-contract": contract,
	"./entry-schema-authoring.ts": codec,
	"./entry-schema-model.ts": model,
	"./schema-library-model.ts": libraryModel,
	"./api-routes.ts": routes,
	"./workspace-model.ts": workspaceModel,
	"./api.ts": new Proxy({}, { get: () => () => { throw new Error("A static render must not call an API"); } }),
};
function production(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const source = readFileSync(new URL(name, import.meta.url), "utf8");
	const compiled = ts.transpileModule(source, {
		fileName: name, reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
	});
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} };
	const requireReact = createRequire(import.meta.resolve("react"));
	new Function("require", "module", "exports", compiled.outputText)((name: string) => {
		if (Object.hasOwn(overrides, name)) return overrides[name];
		if (Object.hasOwn(modules, name)) return modules[name];
		assert.ok(name === "react" || name === "react/jsx-runtime", "unexpected production import: " + name);
		return requireReact(name);
	}, output, output.exports);
	return output.exports;
}
const { EntrySchemaAuthoringControls } = production("./entry-schema-authoring-controls.tsx") as { EntrySchemaAuthoringControls: React.ComponentType<EntrySchemaAuthoringControlsProps> };
const { EntrySchemaCandidatePreview } = production("./entry-schema-library-controls.tsx") as { EntrySchemaCandidatePreview: React.ComponentType<{ panel: ReturnType<typeof createEntrySchemaPanelStore>; candidates: ReturnType<typeof createEntrySchemaCandidateStore>; target: { collection: string; entryId: string; locale: string; savedVersion: null }; canPreview: boolean; actions?: React.ReactNode }> };

const props: EntrySchemaAuthoringControlsProps = {
	json: "", mode: "choose", disabled: false,
	onModeChange() {}, onChooseType() {}, onPatch() {},
};
const render = (patch: Partial<EntrySchemaAuthoringControlsProps>) => renderToStaticMarkup(React.createElement(EntrySchemaAuthoringControls, { ...props, ...patch }));
const choose = render({});
assert.equal((choose.match(/class="shipit-seo-entry-authoring__type"/g) ?? []).length, 5);
for (const label of ["Article", "Blog post", "Web page", "Service", "FAQ"]) assert.ok(choose.includes(label));
assert.match(choose, /Advanced JSON-LD/);
assert.doesNotMatch(choose, /<textarea/);
assert.match(choose, /Existing default and shared schemas stay in place/);
assert.match(choose, /<svg[^>]*aria-hidden="true"/);
const templateChoose = render({ context: "template" });
assert.equal((templateChoose.match(/class="shipit-seo-entry-authoring__type"/g) ?? []).length, 5);
assert.match(templateChoose, /Saving a template does not add it to pages/);
assert.doesNotMatch(templateChoose, /this page|this site|saved title|saved description/i);
const disabled = render({ disabled: true });
for (const button of disabled.matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /\bdisabled=/, "every chooser action honors the pending/unknown gate");
const emittedChoose = render({ existingOutputTypes: ["BlogPosting"] });
assert.equal((emittedChoose.match(/class="shipit-seo-entry-authoring__type"/g) ?? []).length, 5);
assert.equal((emittedChoose.match(/In this plugin&#x27;s saved output\./g) ?? []).length, 1, "the chooser marks the emitted type once");
const emittedTemplate = render({ context: "template", existingOutputTypes: ["BlogPosting"] });
assert.doesNotMatch(emittedTemplate, /this plugin&#x27;s saved output|Show current output/);
const article = render({ json: createEntrySchemaAuthoring("Article"), mode: "guided" });
assert.match(article, /Article fields/);
assert.match(article, /Resolved SEO title/);
assert.match(article, /SEO title after overrides and templates; it may differ from the content title/);
assert.ok(codec.entrySchemaAuthoringFields("Article").some((field) => field.key === "description" && field.variables.includes("description")));
assert.match(article, /Required by this form/);
assert.match(article, /Edit JSON-LD/);
assert.match(article, /Optional details/);
assert.doesNotMatch(article, /Passes.*checks|eligible|Google/);
const templateArticle = render({ context: "template", json: createEntrySchemaAuthoring("Article"), mode: "guided" });
assert.match(templateArticle, /Resolved SEO title/);
assert.match(templateArticle, /Uses the destination page&#x27;s SEO title when a copy resolves, including overrides and templates/);
assert.doesNotMatch(templateArticle, /Saved title|this entry|this page/i);
const customTitle = encodeEntrySchemaAuthoring(createEntrySchemaAuthoring("Article"), { fields: { headline: "An explicit page headline" } });
assert.ok(customTitle.ok);
const customArticle = render({ json: customTitle.json, mode: "guided" });
assert.match(customArticle, /Custom headline \*/);
assert.match(customArticle, /<input[^>]*aria-required="true"[^>]*value="An explicit page headline"/);
const overlapGuided = render({ json: createEntrySchemaAuthoring("BlogPosting"), mode: "guided", existingOutputTypes: ["BlogPosting"], onShowExistingOutput() {} });
assert.match(overlapGuided, /Blog post in this plugin&#x27;s saved output/);
assert.match(overlapGuided, /may add another graph of the same type; existing graphs are not replaced or merged\./);
assert.match(overlapGuided, />Show current output</);
const overlapQuiet = render({ json: createEntrySchemaAuthoring("Article"), mode: "guided", existingOutputTypes: ["BlogPosting"], onShowExistingOutput() {} });
assert.doesNotMatch(overlapQuiet, /this plugin&#x27;s saved output|Show current output/);
const overlapNoReveal = render({ json: createEntrySchemaAuthoring("BlogPosting"), mode: "guided", existingOutputTypes: ["BlogPosting"] });
assert.match(overlapNoReveal, /Blog post in this plugin&#x27;s saved output/);
assert.doesNotMatch(overlapNoReveal, /Show current output/);
const overlapAdvanced = render({ json: createEntrySchemaAuthoring("BlogPosting"), mode: "advanced", existingOutputTypes: ["BlogPosting"], onShowExistingOutput() {} });
assert.match(overlapAdvanced, /this plugin&#x27;s saved output/);
const overlapTemplate = render({ context: "template", json: createEntrySchemaAuthoring("BlogPosting"), mode: "guided", existingOutputTypes: ["BlogPosting"] });
assert.doesNotMatch(overlapTemplate, /this plugin&#x27;s saved output|Show current output/);
const controlsSource = readFileSync(new URL("./entry-schema-authoring-controls.tsx", import.meta.url), "utf8");
assert.match(controlsSource, /ref=\{replacementFocus\} tabIndex=\{-1\} role="alertdialog"/);
assert.match(controlsSource, /if \(replacement\) replacementFocus\.current\?\.focus\(\)/);
assert.match(controlsSource, /typeFocus\.current\[returnFocus\.current\]\?\.focus\(\)/);
assert.match(controlsSource, /returnFocus\.current = replacement;\s+setReplacement\(null\)/);
assert.match(controlsSource, /if \(mode !== "choose"\) modeFocus\.current\?\.focus\(\)/);
assert.match(controlsSource, /event\.key !== "Escape"[\s\S]{0,180}if \(!disabled\) keepDraft\(\)/);
assert.equal((controlsSource.match(/role="alertdialog"/g) ?? []).length, 2, "replacement and overlap each get a focused dialog");
assert.match(controlsSource, /ref=\{overlapFocus\} tabIndex=\{-1\} role="alertdialog"/);
assert.match(controlsSource, /overlapFocus\.current\?\.focus\(\)/);
assert.match(controlsSource, /returnFocus\.current = overlap;\s+setOverlap\(null\)/);
assert.match(controlsSource, /if \(alreadyEmitted\(type\)\) setOverlap\(type\)/);
assert.match(controlsSource, /event\.key !== "Escape"[\s\S]{0,180}if \(!disabled\) keepOverlap\(\)/);

const faq = render({ json: createEntrySchemaAuthoring("FAQPage"), mode: "guided" });
assert.match(faq, /Add at least one question and answer shown on this page/);
assert.doesNotMatch(faq, /<fieldset/);
const explicitFaq = encodeEntrySchemaAuthoring(createEntrySchemaAuthoring("FAQPage"), { questions: [{ question: "Does this page describe appointments?", answer: "Only the example content supplied by its editor." }] });
assert.ok(explicitFaq.ok);
const filledFaq = render({ json: explicitFaq.json, mode: "guided" });
assert.match(filledFaq, /Does this page describe appointments\?/);
assert.match(filledFaq, /Only the example content supplied by its editor/);
assert.match(filledFaq, /aria-label="Remove question 1"/);
assert.equal((filledFaq.match(/aria-required="true"/g) ?? []).length, 2, "both custom FAQ fields expose their form requirements");
const richerJson = '{"@context":"https://schema.org","@type":"Article","headline":"Explicit title","author":{"@type":"Person","name":"Explicit author"}}';
const rich = render({ json: richerJson, mode: "advanced" });
assert.match(rich, /All properties are kept/);
assert.doesNotMatch(rich, />Edit fields</);
const richOverlap = render({ json: richerJson, mode: "advanced", existingOutputTypes: ["Article"], onShowExistingOutput() {} });
assert.match(richOverlap, /Article in this plugin&#x27;s saved output/);
assert.match(richOverlap, /may add another graph/);
assert.match(richOverlap, />Show current output</);
assert.match(richOverlap, /All properties are kept/);
const nestedEntityOnly = render({ json: richerJson, mode: "advanced", existingOutputTypes: ["Person"] });
assert.doesNotMatch(nestedEntityOnly, /this plugin&#x27;s saved output/, "a nested author does not mean another top-level Person graph");
const graphJson = JSON.stringify({ "@context": "https://schema.org", "@graph": [
	{ "@type": ["BlogPosting", "Article"], headline: "Graph title" },
	{ "@type": "Service", name: "A service" },
] });
const graphOverlap = render({ json: graphJson, mode: "advanced", existingOutputTypes: ["Article", "Service", "BlogPosting"] });
assert.match(graphOverlap, /Blog post, Article, Service in this plugin&#x27;s saved output/);
const arrayJson = JSON.stringify([
	{ "@context": "https://schema.org", "@type": "Article", headline: "First article" },
	{ "@context": "https://schema.org", "@type": "Article", headline: "Second article" },
]);
const arrayOverlap = render({ json: arrayJson, mode: "advanced", existingOutputTypes: ["Article"] });
assert.equal((arrayOverlap.match(/Article in this plugin&#x27;s saved output/g) ?? []).length, 1, "repeated types yield one concise notice");
const richTemplate = render({ context: "template", json: graphJson, mode: "advanced", existingOutputTypes: ["Article", "Service", "BlogPosting"] });
assert.doesNotMatch(richTemplate, /this plugin&#x27;s saved output|Show current output/);
for (const invalidJson of [
	'{"@context":"https://schema.org","@type":"Article"',
	'{"@context":"https://other.invalid/context","@type":"Article"}',
	JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: "{{unknown}}" }),
]) {
	assert.doesNotMatch(render({ json: invalidJson, mode: "advanced", existingOutputTypes: ["Article"] }), /this plugin&#x27;s saved output/,
		"an invalid draft has no inferred output notice");
}

const simpleAdvanced = render({ json: createEntrySchemaAuthoring("Article"), mode: "advanced" });
assert.match(simpleAdvanced, />Edit fields</, "lossless field editing is an explicit action for existing JSON");

// Execute the actual event closures with persistent local hook cells.
// DOM focus, native disabled-button behavior and layout remain browser checks.
type ControlElement = React.ReactElement<Record<string, any>>;
function controlElements(tree: unknown): ControlElement[] {
	if (Array.isArray(tree)) return tree.flatMap(controlElements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as ControlElement;
	return [element, ...controlElements(element.props.children), ...controlElements(element.props.action)];
}
function controlText(tree: unknown): string {
	if (typeof tree === "string" || typeof tree === "number") return String(tree);
	if (Array.isArray(tree)) return tree.map(controlText).join("");
	return React.isValidElement(tree) ? controlText((tree as ControlElement).props.children) : "";
}
function interactiveControls(patch: Partial<EntrySchemaAuthoringControlsProps>) {
	const cells: unknown[] = [];
	let cursor = 0;
	const chosen: codec.EntrySchemaAuthoringType[] = [];
	const changedModes: model.EntrySchemaAuthoringMode[] = [];
	const patches: unknown[] = [];
	let revealed = 0;
	let current: EntrySchemaAuthoringControlsProps = { ...props,
		onChooseType: (type) => chosen.push(type), onModeChange: (mode) => changedModes.push(mode),
		onPatch: (value) => patches.push(value), onShowExistingOutput: () => { revealed += 1; }, ...patch };
	const localReact = { ...React,
		useState: <T,>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] => {
			const index = cursor++;
			if (!(index in cells)) cells[index] = typeof initial === "function" ? (initial as () => T)() : initial;
			return [cells[index] as T, (next) => { cells[index] = typeof next === "function" ? (next as (previous: T) => T)(cells[index] as T) : next; }];
		},
		useRef: <T,>(initial: T) => {
			const index = cursor++;
			if (!(index in cells)) cells[index] = { current: initial };
			return cells[index] as { current: T };
		},
		useEffect: () => {},
	};
	const actual = production("./entry-schema-authoring-controls.tsx", { react: localReact }) as {
		EntrySchemaAuthoringControls: (values: EntrySchemaAuthoringControlsProps) => React.ReactNode;
	};
	const render = () => { cursor = 0; return actual.EntrySchemaAuthoringControls(current); };
	const action = (tree: React.ReactNode, label: string) => {
		const matches = controlElements(tree).filter((node) => node.type === button.Button && controlText(node.props.children) === label);
		assert.equal(matches.length, 1, "One authoring action: " + label);
		return matches[0]!;
	};
	const type = (tree: React.ReactNode, label: string) => {
		const match = controlElements(tree).find((node) => node.props.className === "shipit-seo-entry-authoring__type" &&
			controlElements(node).some((child) => child.props.className === "shipit-seo-entry-authoring__type-heading" && controlText(child) === label));
		assert.ok(match, "One schema type: " + label);
		return match;
	};
	const confirmation = (tree: React.ReactNode, label: string) => {
		const match = controlElements(tree).find((node) => node.props.role === "alertdialog" && node.props["aria-label"] === label);
		assert.ok(match, "Confirmation: " + label);
		return match;
	};
	return { render, action, type, confirmation, chosen, changedModes, patches, revealed: () => revealed,
		json: () => current.json, update: (next: Partial<EntrySchemaAuthoringControlsProps>) => { current = { ...current, ...next }; } };
}
const emptyOverlap = interactiveControls({ existingOutputTypes: ["BlogPosting"] });
emptyOverlap.type(emptyOverlap.render(), "Blog post").props.onClick();
assert.deepEqual(emptyOverlap.chosen, [], "selecting an emitted type does not replace JSON");
let overlapTree = emptyOverlap.render();
const overlapPrompt = emptyOverlap.confirmation(overlapTree, "Blog post in this plugin's saved output");
emptyOverlap.action(overlapTree, "Show current output").props.onClick();
assert.equal(emptyOverlap.revealed(), 1);
assert.equal(emptyOverlap.json(), "", "revealing output leaves the draft intact");
let prevented = 0;
let stopped = 0;
overlapPrompt.props.onKeyDown({ key: "Escape", preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
assert.equal(prevented, 1);
assert.equal(stopped, 1);
assert.equal(controlElements(emptyOverlap.render()).some((node) => node.props.role === "alertdialog"), false);
assert.deepEqual(emptyOverlap.chosen, [], "Escape cancels the overlap confirmation");
emptyOverlap.type(emptyOverlap.render(), "Blog post").props.onClick();
emptyOverlap.action(emptyOverlap.render(), "Choose another type").props.onClick();
assert.deepEqual(emptyOverlap.chosen, []);
emptyOverlap.type(emptyOverlap.render(), "Blog post").props.onClick();
emptyOverlap.action(emptyOverlap.render(), "Add Blog post anyway").props.onClick();
assert.deepEqual(emptyOverlap.chosen, ["BlogPosting"], "only explicit confirmation emits the chosen type");
assert.deepEqual(emptyOverlap.patches, []);

const existingDraft = interactiveControls({ json: richerJson, existingOutputTypes: ["BlogPosting"] });
existingDraft.type(existingDraft.render(), "Blog post").props.onClick();
existingDraft.action(existingDraft.render(), "Add Blog post anyway").props.onClick();
let replacementTree = existingDraft.render();
existingDraft.confirmation(replacementTree, "Replace draft JSON-LD");
assert.equal(existingDraft.json(), richerJson);
assert.deepEqual(existingDraft.chosen, [], "overlap confirmation does not skip draft replacement confirmation");
existingDraft.action(replacementTree, "Keep current draft").props.onClick();
assert.equal(existingDraft.json(), richerJson);
assert.deepEqual(existingDraft.chosen, []);
existingDraft.type(existingDraft.render(), "Blog post").props.onClick();
existingDraft.action(existingDraft.render(), "Add Blog post anyway").props.onClick();
replacementTree = existingDraft.render();
existingDraft.confirmation(replacementTree, "Replace draft JSON-LD").props.onKeyDown({
	key: "Escape", preventDefault() {}, stopPropagation() {},
});
assert.equal(existingDraft.json(), richerJson);
assert.deepEqual(existingDraft.chosen, []);
existingDraft.type(existingDraft.render(), "Blog post").props.onClick();
existingDraft.action(existingDraft.render(), "Add Blog post anyway").props.onClick();
existingDraft.action(existingDraft.render(), "Replace draft").props.onClick();
assert.deepEqual(existingDraft.chosen, ["BlogPosting"]);
assert.deepEqual(existingDraft.patches, [], "confirmation leaves JSON ownership with the caller");

const templateInteraction = interactiveControls({ context: "template", existingOutputTypes: ["BlogPosting"] });
templateInteraction.type(templateInteraction.render(), "Blog post").props.onClick();
assert.deepEqual(templateInteraction.chosen, ["BlogPosting"]);
assert.equal(controlElements(templateInteraction.render()).some((node) => node.props.role === "alertdialog"), false);
const lockedInteraction = interactiveControls({ existingOutputTypes: ["BlogPosting"] });
lockedInteraction.type(lockedInteraction.render(), "Blog post").props.onClick();
lockedInteraction.update({ disabled: true });
const lockedTree = lockedInteraction.render();
assert.equal(lockedInteraction.action(lockedTree, "Add Blog post anyway").props.disabled, true);
lockedInteraction.confirmation(lockedTree, "Blog post in this plugin's saved output").props.onKeyDown({
	key: "Escape", preventDefault() {}, stopPropagation() {},
});
assert.ok(lockedInteraction.confirmation(lockedInteraction.render(), "Blog post in this plugin's saved output"));
assert.deepEqual(lockedInteraction.chosen, [], "a locked confirmation cannot be dismissed through Escape");

// Type search filters the chooser without changing the draft; Enter picks the first match instead of submitting.
const searchable = interactiveControls({});
const typeSearch = (tree: React.ReactNode) => {
	const matches = controlElements(tree).filter((node) => node.type === input.Input && node.props.label === "Search schema types");
	assert.equal(matches.length, 1, "One schema type search");
	return matches[0]!;
};
const shownTypes = (tree: React.ReactNode) => controlElements(tree).filter((node) => node.props.className === "shipit-seo-entry-authoring__type")
	.map((node) => controlText(controlElements(node).find((child) => child.props.className === "shipit-seo-entry-authoring__type-heading")));
assert.deepEqual(shownTypes(searchable.render()), ["Article", "Blog post", "Web page", "Service", "FAQ"]);
typeSearch(searchable.render()).props.onChange({ target: { value: "  FAQ " } });
assert.deepEqual(shownTypes(searchable.render()), ["FAQ"]);
typeSearch(searchable.render()).props.onChange({ target: { value: "blogposting" } });
assert.deepEqual(shownTypes(searchable.render()), ["Blog post"], "the schema.org type name also matches");
let enterPrevented = 0;
typeSearch(searchable.render()).props.onKeyDown({ key: "Enter", preventDefault: () => { enterPrevented += 1; } });
assert.equal(enterPrevented, 1, "Enter in the search never submits the surrounding save form");
assert.deepEqual(searchable.chosen, ["BlogPosting"]);
typeSearch(searchable.render()).props.onChange({ target: { value: "no such type" } });
let noMatchTree = searchable.render();
assert.deepEqual(shownTypes(noMatchTree), []);
assert.equal(controlElements(noMatchTree).find((node) => node.props.role === "status")?.props.children, "No schema type matches");
typeSearch(noMatchTree).props.onKeyDown({ key: "Enter", preventDefault: () => { enterPrevented += 1; } });
assert.deepEqual(searchable.chosen, ["BlogPosting"], "Enter with no match chooses nothing");
assert.deepEqual(searchable.patches, []);
const searchOverlap = interactiveControls({ existingOutputTypes: ["BlogPosting"] });
typeSearch(searchOverlap.render()).props.onChange({ target: { value: "blog" } });
typeSearch(searchOverlap.render()).props.onKeyDown({ key: "Enter", preventDefault() {} });
assert.deepEqual(searchOverlap.chosen, [], "a searched type that is already in the output still asks first");
searchOverlap.confirmation(searchOverlap.render(), "Blog post in this plugin's saved output");
const searchLocked = interactiveControls({ disabled: true });
assert.equal(typeSearch(searchLocked.render()).props.disabled, true);

function renderLibrary(json: string | null, unknownSave = false, options: {
	openEditor?: boolean;
	state?: contract.SeoAdminSchemaLibrary["state"];
	conditionalStorage?: boolean;
	queryError?: boolean;
	search?: string;
} = {}) {
	const store = libraryModel.createSchemaLibraryStore();
	const template: contract.SchemaLibraryTemplate = {
		id: "tpl-aaaaaaaaaaaaaaaaaaaa", name: "Reusable example", json: json ?? "",
		createdAt: "2026-10-16T10:00:00.000Z", updatedAt: "2026-10-16T10:00:00.000Z",
	};
	const library: contract.SeoAdminSchemaLibrary = {
		contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, engineVersion: contract.SEO_ENGINE_VERSION,
		state: json === null ? "absent" : "saved", revision: json === null ? null : "library-fixture-revision",
		templates: json === null ? [] : [template],
		bytes: json === null ? 0 : new TextEncoder().encode(JSON.stringify({ version: 1, templates: [template] })).byteLength,
		corrupt: null, conditionalStorage: true,
		limits: contract.SEO_ADMIN_SCHEMA_LIBRARY_LIMITS,
	};
	if (options.state) library.state = options.state;
	if (options.conditionalStorage === false) library.conditionalStorage = false;
	if (options.openEditor !== false) {
		if (json === null) store.dispatch({ type: "open-create", id: template.id, library });
		else store.dispatch({ type: "open-edit", template, library });
	}
	if (options.search) store.dispatch({ type: "search", value: options.search });
	if (unknownSave) {
		store.dispatch({ type: "start", operation: "save" });
		store.dispatch({ type: "save-error", failure: "unknown", at: 2 });
	}
	const before = structuredClone(store.get());
	const { SchemaLibraryView } = production("./schema-library-view.tsx", {
		"./entry-schema-authoring-controls.tsx": { EntrySchemaAuthoringControls },
		"./schema-library-model.ts": { ...libraryModel, schemaLibraryStore: store },
		"@tanstack/react-query": { ...query, useQuery: () => ({
			data: options.queryError ? undefined : { library, requestedAt: 1 },
			isPending: false, isError: options.queryError ?? false, isFetching: false,
			error: options.queryError ? new Error("Synthetic library read failure") : null,
			refetch: () => { throw new Error("Rendering the library must not request a reload"); },
		}) },
	}) as { SchemaLibraryView: React.ComponentType<{ onUseTemplate(template: contract.SchemaLibraryTemplate): void }> };
	const html = renderToStaticMarkup(React.createElement(SchemaLibraryView, {
		onUseTemplate() { throw new Error("Rendering must not apply a template"); },
	}));
	assert.deepEqual(store.get(), before, "Rendering type fields never changes the library draft, revision or write state");
	return html;
}
function libraryButton(html: string, label: string) {
	const matches = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
		.map((match) => match[0])
		.filter((markup) => markup.replace(/<[^>]+>/g, "").trim() === label);
	assert.equal(matches.length, 1, "One library action: " + label);
	return matches[0];
}
const emptyLibrary = renderLibrary(null, false, { openEditor: false });
assert.match(emptyLibrary, /<h2 id="seo-library-title">Schema library<\/h2>/);
assert.match(emptyLibrary, /class="shipit-seo-library__count">0 of 20 templates<\/span>/);
assert.equal((emptyLibrary.match(/class="shipit-seo-library__empty-state"/g) ?? []).length, 1);
assert.match(emptyLibrary, /Saving a template does not change any page/);
assert.doesNotMatch(emptyLibrary, /data-kumo-component="Empty"|shipit-seo-library__toolbar/);
assert.doesNotMatch(libraryButton(emptyLibrary, "New template"), /\bdisabled=/);
assert.ok(emptyLibrary.indexOf("New template") < emptyLibrary.indexOf('class="shipit-seo-library__copy"'),
	"The create action stays with the library heading");
assert.doesNotMatch(emptyLibrary, /Manage schemas|shipit-seo-library__footer/, "Library is a Schema tab, so it has no button back to Schema");
assert.match(emptyLibrary, /never added to a page by itself: Use template opens an independent\s+copy/);
const populatedLibrary = renderLibrary(createEntrySchemaAuthoring("Article"), false, { openEditor: false });
assert.match(populatedLibrary, /class="shipit-seo-library__count">1 of 20 templates<\/span>/);
assert.match(populatedLibrary, /aria-label="Saved templates"/);
assert.match(populatedLibrary, /Reusable example/);
assert.doesNotMatch(populatedLibrary, /No templates yet|shipit-seo-library__empty-state/);
assert.doesNotMatch(libraryButton(populatedLibrary, "New template"), /\bdisabled=/);
for (const label of ["Use template", "Edit", "Delete"]) libraryButton(populatedLibrary, label);
const buttonClass = (markup: string) => markup.match(/class="([^"]*)"/)?.[1] ?? "";
assert.equal(buttonClass(libraryButton(populatedLibrary, "Use template")), buttonClass(libraryButton(populatedLibrary, "Edit")),
	"Use template is a secondary row action like Edit");
assert.match(libraryButton(populatedLibrary, "Use template"), /aria-label="Use template Reusable example"/);
const filteredLibrary = renderLibrary(createEntrySchemaAuthoring("Article"), false, { openEditor: false, search: "no matching template" });
assert.match(filteredLibrary, /No template matches this search/);
assert.doesNotMatch(filteredLibrary, /No templates yet|shipit-seo-library__empty-state/);
const failedLibrary = renderLibrary(null, false, { openEditor: false, queryError: true });
assert.match(failedLibrary, /The schema library could not be loaded/);
libraryButton(failedLibrary, "Try again");
assert.doesNotMatch(failedLibrary, /No templates yet|shipit-seo-library__count/);
for (const state of ["corrupt", "unavailable"] as const) {
	const unreadableLibrary = renderLibrary(null, false, { openEditor: false, state });
	assert.match(unreadableLibrary, state === "corrupt" ? /The stored library is invalid/ : /The library could not be read/);
	assert.doesNotMatch(unreadableLibrary, /No templates yet|shipit-seo-library__count/);
	assert.match(libraryButton(unreadableLibrary, "New template"), /\bdisabled=/);
	libraryButton(unreadableLibrary, "Reload library");
}
const unversionedLibrary = renderLibrary(null, false, { openEditor: false, conditionalStorage: false });
assert.match(unversionedLibrary, /The library could not be read/);
assert.doesNotMatch(unversionedLibrary, /No templates yet|shipit-seo-library__count/);

const newLibrary = renderLibrary(null);
assert.equal((newLibrary.match(/class="shipit-seo-entry-authoring__type"/g) ?? []).length, 5);
assert.doesNotMatch(newLibrary, /<textarea/);
const guidedLibrary = renderLibrary(createEntrySchemaAuthoring("Article"));
assert.match(guidedLibrary, /Article fields/);
assert.match(guidedLibrary, /Resolved SEO title/);
assert.doesNotMatch(guidedLibrary, /<textarea/);
const advancedLibrary = renderLibrary(richerJson);
assert.match(advancedLibrary, /Advanced JSON-LD/);
assert.match(advancedLibrary, /<textarea[^>]*class="[^"]*shipit-seo-library__code-input/);
assert.match(advancedLibrary, /All properties are kept/);
assert.doesNotMatch(advancedLibrary, />Edit fields</);
const unknownLibrary = renderLibrary(richerJson, true);
assert.match(unknownLibrary, /Save not confirmed/);
assert.match(unknownLibrary, /<textarea[^>]*disabled=/);
assert.match(libraryButton(unknownLibrary, "New template"), /\bdisabled=/);
assert.match(unknownLibrary, /Nothing is retried automatically/);

const editor = addEntrySchemaEditor();
const panel = createEntrySchemaPanelStore({ editor, opening: null, fieldErrors: {}, notice: null, unconfirmed: null, confirming: null, pending: null, pendingTemplate: null });
const candidates = createEntrySchemaCandidateStore();
const target = { collection: "posts", entryId: "01JEXAMPLE", locale: "en", savedVersion: null };
const previewProps = { panel, candidates, target, canPreview: false };
const defaultPreview = renderToStaticMarkup(React.createElement(EntrySchemaCandidatePreview, previewProps));
assert.match(defaultPreview, /Shows what this unsaved form would add. Nothing is saved/);
assert.doesNotMatch(defaultPreview, />Save schema</);
const withActions = renderToStaticMarkup(React.createElement(EntrySchemaCandidatePreview, {
	...previewProps,
	actions: React.createElement(React.Fragment, null, React.createElement("button", { type: "submit" }, "Save schema"), React.createElement("button", { type: "button" }, "Cancel")),
}));
const actionRow = withActions.match(/class="shipit-seo-entry-schema__actions">([\s\S]*?)<\/div>/)?.[1];
assert.ok(actionRow);
assert.ok(actionRow.indexOf("Preview") < actionRow.indexOf("Save schema") && actionRow.indexOf("Save schema") < actionRow.indexOf("Cancel"), "Preview and Save/Cancel share one action row in the intended order");
assert.match(actionRow, /<button type="submit">Save schema<\/button>/);
assert.match(withActions, /Preview predicts this draft. Nothing is saved/);
assert.doesNotMatch(withActions, /Shows what this unsaved form would add/);
assert.equal(candidates.get().pending, null, "rendering field or preview controls sends no candidate request");
console.log("Entry schema authoring controls and candidate action composition self-check passed.");
