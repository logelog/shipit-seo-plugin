import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";
import {
	validateSeoAdminCustomSchemaInput,
	type SchemaLibraryTemplate,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { applyVarsDeep, validateCustomJsonLd } from "../lib.ts";
import {
	createSchemaWorkspaceMutationGate,
	newSchemaWorkspaceId,
	schemaComposerDraftDirty,
	schemaWorkspaceRoute,
	schemaWorkspaceTemplateCopy,
} from "./schema-workspace-model.ts";
import {
	createSeoSchemaComposerDraft,
	parseSeoSchemaScope,
	serializeSeoSchemaScope,
} from "./schema-composer-view-model.ts";

const source = readFileSync(new URL("./configuration-views.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");
const library = readFileSync(new URL("./schema-library-view.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../sandbox-entry.ts", import.meta.url), "utf8");
function parsed(text: string) {
	return ts.createSourceFile("production.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function find(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
	const found: ts.Node[] = [];
	const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
	visit(root);
	return found;
}
function unique<T extends ts.Node>(nodes: T[], name: string): T {
	assert.equal(nodes.length, 1, "Exact production node: " + name);
	return nodes[0];
}
function fn(text: string, name: string) {
	return unique(parsed(text).statements.filter((node): node is ts.FunctionDeclaration =>
		ts.isFunctionDeclaration(node) && node.name?.text === name), name);
}
const schemaView = fn(source, "SchemaView");
function local(name: string) {
	return unique(schemaView.body!.statements.filter((node) => ts.isVariableStatement(node) &&
		node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name)), name).getText();
}
function opening(node: ts.Node) {
	return ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
}
function attribute(node: ts.Node, name: string) {
	const item = opening(node)?.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name);
	return item && ts.isJsxAttribute(item) ? item.initializer : undefined;
}
function expression(node: ts.Node, name: string) {
	const value = attribute(node, name);
	assert.ok(value && ts.isJsxExpression(value) && value.expression, "Production JSX expression: " + name);
	return value.expression.getText();
}
function uses(node: ts.Node, name: string) {
	return find(node, (item) => ts.isIdentifier(item) && item.text === name).length > 0;
}
function component(root: ts.Node, name: string) {
	return unique(find(root, (node) => opening(node)?.tagName.getText() === name), name);
}
function compile(text: string, scope: Record<string, unknown>) {
	const result = ts.transpileModule(text, { fileName: "schema-handoff-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} };
	new Function("require", "module", "exports", ...Object.keys(scope), result.outputText)(
		(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; },
		output, output.exports, ...Object.values(scope));
	return output.exports as Record<string, any>;
}
const dependencies = { newSchemaWorkspaceId, parseSeoSchemaScope, serializeSeoSchemaScope, createSeoSchemaComposerDraft,
	schemaWorkspaceTemplateCopy, schemaComposerDraftDirty, schemaWorkspaceRoute, validateSeoAdminCustomSchemaInput };
const helpers = compile(["editorFromSchema", "editorInput", "newComposerDraft"].map((name) => fn(source, name).getText()).join("\n") +
	"\nexport { editorFromSchema, editorInput, newComposerDraft };", dependencies);
assert.equal(find(schemaView, (node) => {
	const label = attribute(node, "aria-label");
	return !!label && ts.isStringLiteral(label) && label.text === "Selected schema template";
}).length, 0, "Use template opens the builder in place, without an intermediate review card");
const replacementDialog = unique(find(schemaView, (node) => {
	if (opening(node)?.tagName.getText() !== "Dialog.Root") return false;
	const value = attribute(node, "open");
	return !!value && uses(value, "replacement");
}), "Draft replacement dialog").getText();
const inactiveEffect = unique(find(schemaView, (node) => ts.isCallExpression(node) &&
	node.expression.getText() === "React.useEffect" && !!node.arguments[0] &&
	uses(node.arguments[0], "setReplacement") && uses(node.arguments[0], "setRepairRevision")), "Inactive draft replacement cleanup") as ts.CallExpression;
const libraryUse = expression(component(fn(library, "SchemaLibraryView"), "TemplateRow"), "onUse");
const libraryElement = component(schemaView, "SchemaLibraryView");
const parentUse = expression(libraryElement, "onUseTemplate");
assert.equal(parentUse, "openTemplateCopy", "The Library tab hands its template to the Schema builder directly");
assert.equal(find(fn(admin, "SeoAdminWorkspace"), (node) => opening(node)?.tagName.getText() === "SchemaLibraryView").length, 0,
	"The workspace has no separate Library page; ?view=library opens the Schema tab");
let libraryGuard: ts.Node | undefined = libraryElement.parent;
while (libraryGuard && !ts.isJsxExpression(libraryGuard)) libraryGuard = libraryGuard.parent;
assert.ok(libraryGuard?.getText().startsWith('{active && section === "library" ?'),
	"The library mounts only while its tab is shown, so other tabs send no library read");
const publicExpansion = unique(fn(engine, "buildPageMetadata").body!.statements.filter((node): node is ts.ForOfStatement =>
	ts.isForOfStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === "customs"), "Public custom-schema expansion");
const { expand } = compile("export function expand(customs, scopes, vars) { const expandedCustoms = []; " +
	publicExpansion.getText() + "; return expandedCustoms; }", {
	applyVarsDeep, validateCustomJsonLd, ctx: { log: { warn: () => assert.fail("Valid handoff fixture must expand without warnings") } },
});

type Element = React.ReactElement<Record<string, any>>;
function elements(tree: React.ReactNode): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const item = tree as Element;
	return [item, ...elements(item.props.children)];
}
function text(tree: React.ReactNode): string {
	if (Array.isArray(tree)) return tree.map(text).join("");
	if (React.isValidElement(tree)) return text((tree as Element).props.children);
	return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
function Button(_props: any) { return null; }
const Dialog = Object.assign((_props: any) => null, { Root: (_props: any) => null, Title: (_props: any) => null, Description: (_props: any) => null });
function button(tree: React.ReactNode, label: string) {
	return unique(elements(tree).filter((node) => node.type === Button && text(node.props.children) === label) as any[], label) as Element;
}
const json = JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: "{{title}}", url: "{{canonical}}",
	description: "{{description}}", author: { "@type": "Person", name: "{{author}}" } });
function template(): SchemaLibraryTemplate & { revision: string } {
	return { id: "library-article", name: "Reusable article", json, createdAt: "2026-10-16T12:00:00.000Z",
		updatedAt: "2026-10-16T12:00:00.000Z", revision: "library-record-revision" };
}
function oldEditor() {
	return helpers.editorFromSchema({ id: "existing-saved-schema", name: "Unsaved raw changes", scope: "posts:original", json,
		enabled: true }, "saved-schema-revision");
}
function fixture(options: { busy?: boolean; unconfirmed?: string | null; editor?: any; dirtyEditor?: boolean; dirtyComposer?: boolean;
	route?: "schema" | "library"; active?: boolean } = {}) {
	const composer = helpers.newComposerDraft("howTo");
	if (options.dirtyComposer) composer.input.schemaName = "Unsaved guided changes";
	const state = { editor: options.editor ?? null, composer, composerIdentity: { id: "previous-guided-id", expectedRevision: "guided-revision" },
		replacement: null as { title: string; apply: () => void } | null, busy: options.busy ?? false, unconfirmed: options.unconfirmed ?? null,
		builderMode: "guided", section: options.route === "schema" ? "overview" : "library", builderOpen: false, builderFocusVersion: 0, schemaErrors: {} as Record<string, string>,
		schemaMessage: null as string | null, composerErrors: {}, composerMessage: "Old composer note", savingSchema: false, repairRevision: "repair-revision" as string | null };
	const editorBaseline = { current: options.dirtyEditor ? null : state.editor ? JSON.stringify(state.editor) : null };
	const writes: any[] = [];
	const attempts: any[] = [];
	const routes: string[] = [];
	const set = (key: keyof typeof state) => (value: any) => { (state as any)[key] = typeof value === "function" ? value(state[key]) : value; };
	const scope = { ...dependencies, ...helpers, ...state, editorBaseline, mutationGate: createSchemaWorkspaceMutationGate(),
		setEditor: set("editor"), setComposer: set("composer"), setComposerIdentity: set("composerIdentity"),
		setReplacement: set("replacement"), setSchemaErrors: set("schemaErrors"), setSchemaMessage: set("schemaMessage"),
		setComposerErrors: set("composerErrors"), setComposerMessage: set("composerMessage"), setBuilderMode: set("builderMode"),
		setSection: set("section"), setBuilderOpen: set("builderOpen"), setBuilderFocusVersion: set("builderFocusVersion"),
		setSavingSchema: set("savingSchema"), setRepairRevision: set("repairRevision"),
		active: options.active ?? true, route: options.route ?? "library", previousSection: { current: "overview" },
		onRouteChange: (route: string) => routes.push(route),
		runMutation: async (attempt: unknown, request: () => Promise<unknown>) => { attempts.push(attempt); return request(); },
		saveSeoAdminCustomSchema: async (command: unknown) => { writes.push(structuredClone(command)); return {
			success: false, error: "validation", message: "Synthetic route stop", errors: { _form: "Synthetic route stop" },
		}; },
		handleFailure: () => {}, reportUnconfirmed: (cause: unknown) => assert.fail(String(cause)),
		onSaved: () => assert.fail("The synthetic route does not return a saved record"),
		toasts: { success: () => assert.fail("No saved acknowledgement") }, refreshOverview: () => assert.fail("No saved acknowledgement"),
		savedNote: "", upsertSchemaWorkspaceCustom: () => assert.fail("No saved acknowledgement"),
	};
	const handlers = compile(["showSection", "composerDirty", "editorDirty", "requestReplacement", "resetComposer", "openTemplateCopy", "saveCustomSchema"].map(local).join("\n") +
		"\nexport { openTemplateCopy, saveCustomSchema, composerDirty, editorDirty };", scope);
	const render = (markup: string, overrides: Record<string, unknown> = {}) => compile("export function render() { return (" + markup + "); }",
		{ ...scope, ...state, ...handlers, Button, Dialog, ...overrides }).render();
	return { state, writes, attempts, handlers, editorBaseline, routes,
		dialog: (active = true) => render(replacementDialog, { active }),
		leave: () => compile("export const leave = " + inactiveEffect.arguments[0].getText() + ";", { ...scope, ...state, active: false }).leave() };
}

let groups = 0;
async function check(run: () => void | Promise<void>) { await run(); groups += 1; }
await check(() => {
	const original = Object.freeze(template());
	const copy = schemaWorkspaceTemplateCopy(original);
	assert.deepEqual(copy, { name: original.name, json: original.json, scope: "", enabled: false });
	assert.equal(Object.hasOwn(copy, "id"), false);
	assert.equal(Object.hasOwn(copy, "revision"), false);
	const first = helpers.editorFromSchema(copy);
	const second = helpers.editorFromSchema(copy);
	assert.match(first.writeId, /^schema-[0-9a-f]{32}$/);
	assert.notEqual(first.writeId, original.id);
	assert.notEqual(first.writeId, second.writeId);
	assert.equal(first.expectedRevision, null);
	assert.equal(first.values.id, undefined);
	assert.equal(first.values.scope, "");
	assert.equal(first.values.enabled, false);
	assert.equal(first.values.json, json, "Copying must preserve unresolved variables");
});
await check(() => {
	const original = template();
	const f = fixture();
	const editorBeforeUse = f.state.editor;
	assert.equal(editorBeforeUse, null, "Showing the library creates no editor or saved schema");
	const libraryReturn = { templateId: null as string | null };
	compile("export const use = " + libraryUse + ";", { template: original, onUseTemplate: f.handlers[parentUse], libraryReturn }).use();
	assert.equal(libraryReturn.templateId, original.id, "Use template records its template, so Back can return focus to its button");
	assert.deepEqual(f.routes, ["schema"], "Use template moves the route to view=schema, so Back returns to Library");
	assert.equal(f.state.section, "custom");
	assert.ok(f.state.editor, "Use template opens the builder with the copy");
	assert.equal(f.state.editor.values.name, "Reusable article");
	assert.equal(f.state.editor.values.json, json);
	original.name = "Changed later in the library";
	original.json = '{"@type":"WebPage","name":"Changed later"}';
	assert.equal(f.state.editor.values.name, "Reusable article", "The draft is an independent copy, not a live link");
	assert.equal(f.state.editor.values.json, json);
	assert.match(f.state.schemaMessage ?? "", /^Independent copy of "Reusable article"\. Editing or deleting the template later does not change it\./);
	assert.deepEqual(f.writes, []);
	const schemaRoute = fixture({ route: "schema" });
	schemaRoute.handlers.openTemplateCopy(template());
	assert.deepEqual(schemaRoute.routes, [], "Opening a copy from a Schema tab keeps the current route");
	const hidden = fixture({ active: false });
	hidden.handlers.openTemplateCopy(template());
	assert.deepEqual(hidden.routes, [], "A hidden Schema owner never pushes a route");
});
await check(() => {
	const f = fixture();
	f.handlers.openTemplateCopy(template());
	assert.ok(f.state.editor, "Use template opens the independent draft in place");
	assert.equal(f.state.editor.values.enabled, false);
	assert.equal(f.state.editor.values.scope, "");
	assert.equal(f.state.editor.expectedRevision, null);
	assert.equal(f.state.composerIdentity.expectedRevision, null);
	assert.notEqual(f.state.composerIdentity.id, "previous-guided-id");
	assert.equal(f.state.builderMode, "raw");
	assert.equal(f.state.section, "custom");
	assert.equal(f.state.builderOpen, true);
	assert.equal(f.state.builderFocusVersion, 1);
	assert.equal(f.editorBaseline.current, null);
	assert.deepEqual(f.writes, []);
	assert.deepEqual(f.attempts, []);
});
await check(() => {
	for (const blocked of [{ busy: true }, { unconfirmed: "Save not confirmed" }]) {
		const f = fixture({ ...blocked, editor: oldEditor(), dirtyEditor: true, dirtyComposer: true });
		const before = JSON.stringify({ editor: f.state.editor, composer: f.state.composer });
		f.handlers.openTemplateCopy(template());
		assert.equal(JSON.stringify({ editor: f.state.editor, composer: f.state.composer }), before);
		assert.equal(f.state.replacement, null);
		assert.deepEqual(f.routes, []);
		assert.deepEqual(f.writes, []);
	}
	const f = fixture({ editor: oldEditor(), dirtyEditor: true });
	f.handlers.openTemplateCopy(template());
	f.state.unconfirmed = "A pending request needs review";
	assert.equal(button(f.dialog(), "Replace draft").props.disabled, true, "A replacement opened earlier cannot be confirmed during recovery");
	assert.deepEqual(f.routes, []);
});
await check(() => {
	for (const draft of [{ editor: oldEditor(), dirtyEditor: true }, { dirtyComposer: true }]) {
		const f = fixture(draft);
		assert.equal(f.handlers.editorDirty || f.handlers.composerDirty, true);
		const before = JSON.stringify({ editor: f.state.editor, composer: f.state.composer, identity: f.state.composerIdentity });
		f.handlers.openTemplateCopy(template());
		assert.ok(f.state.replacement);
		assert.equal(JSON.stringify({ editor: f.state.editor, composer: f.state.composer, identity: f.state.composerIdentity }), before);
		assert.deepEqual(f.routes, [], "An unanswered replacement keeps the Library route");
		button(f.dialog(), "Keep draft").props.onClick();
		assert.equal(f.state.replacement, null);
		assert.equal(JSON.stringify({ editor: f.state.editor, composer: f.state.composer, identity: f.state.composerIdentity }), before);
		assert.equal(f.state.section, "library", "Keeping the draft stays on the Library tab");
		f.handlers.openTemplateCopy(template());
		button(f.dialog(), "Replace draft").props.onClick();
		assert.equal(f.state.replacement, null);
		assert.equal(f.state.editor.values.json, json);
		assert.equal(f.state.editor.values.enabled, false);
		assert.equal(f.state.editor.expectedRevision, null);
		assert.notEqual(f.state.editor.writeId, "existing-saved-schema");
		assert.equal(schemaComposerDraftDirty(f.state.composer, helpers.newComposerDraft("howTo")), false);
		assert.deepEqual(f.routes, ["schema"]);
		assert.deepEqual(f.writes, []);
	}
});
await check(() => {
	const f = fixture({ editor: oldEditor(), dirtyEditor: true, dirtyComposer: true });
	const before = JSON.stringify({ editor: f.state.editor, composer: f.state.composer, identity: f.state.composerIdentity });
	f.handlers.openTemplateCopy(template());
	assert.equal((f.dialog(false) as Element).props.open, false, "The persistent Schema view must hide its replacement dialog while inactive");
	f.leave();
	assert.equal(f.state.replacement, null);
	assert.equal(JSON.stringify({ editor: f.state.editor, composer: f.state.composer, identity: f.state.composerIdentity }), before);
	assert.deepEqual(f.routes, []);
	assert.deepEqual(f.writes, []);
});
await check(async () => {
	const draft = helpers.editorFromSchema(schemaWorkspaceTemplateCopy(template()));
	const missing = fixture({ editor: draft });
	await missing.handlers.saveCustomSchema();
	assert.ok(missing.state.schemaErrors.scope);
	assert.deepEqual(missing.writes, [], "A copy without explicit scope cannot reach the write API");
	assert.deepEqual(missing.attempts, []);
	assert.deepEqual(expand([draft.values], ["global", "posts", "posts:first"], {}), [], "An unscoped disabled copy contributes no public graph");
	const scoped = { ...draft, scopeMode: "entry", collection: "posts", entry: "first" };
	const disabled = fixture({ editor: scoped });
	await disabled.handlers.saveCustomSchema();
	assert.equal(disabled.writes.length, 1, "Saving a disabled record is an explicit write, not publication");
	const command = disabled.writes[0];
	assert.equal(command.scope, "posts:first");
	assert.equal(command.enabled, false);
	assert.equal(command.id, draft.writeId);
	assert.equal(command.expectedRevision, null);
	assert.notEqual(command.id, template().id);
	assert.deepEqual(expand([command], ["global", "posts", "posts:first"], {}), [], "The actual public expansion skips disabled records");
	assert.deepEqual(expand([{ ...command, enabled: true }], ["global", "pages", "pages:first"], {}), [], "An enabled copy cannot leak into another scope");
});
await check(() => {
	const copy = schemaWorkspaceTemplateCopy(template());
	const savedJson = copy.json;
	const vars = [
		{ title: 'First "visit" & care\n{{siteName}}', canonical: "https://example.test/posts/first", description: "First entry", author: "A & B", siteName: "Never expand twice" },
		{ title: "Second visit", canonical: "https://example.test/posts/second", description: 'Second "entry"', author: "Second author", siteName: "Other practice" },
	];
	const first = expand([{ ...copy, enabled: true, scope: "posts:first" }], ["global", "posts", "posts:first"], vars[0]);
	const second = expand([{ ...copy, enabled: true, scope: "posts:second" }], ["global", "posts", "posts:second"], vars[1]);
	assert.equal(first.length, 1);
	assert.equal(second.length, 1);
	for (const [index, result] of [first, second].entries()) {
		const graph = JSON.parse(JSON.stringify(result[0].graph));
		assert.equal(graph.headline, vars[index].title);
		assert.equal(graph.url, vars[index].canonical);
		assert.equal(graph.description, vars[index].description);
		assert.equal(graph.author.name, vars[index].author);
	}
	assert.notEqual(first[0].graph, second[0].graph);
	assert.equal(copy.json, savedJson, "Entry expansion never rewrites the unresolved saved template copy");
	assert.equal(copy.enabled, false, "Previewing entry values never enables the library-derived draft");
});
console.log(JSON.stringify({ status: "passed", groups, scope: "Production schema-template handoff closures, controls and custom-schema expansion; no browser or persistent writes" }));
