import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import { Select } from "@cloudflare/kumo/components/select";
import { Input } from "@cloudflare/kumo/components/input";
import { SEO_ADMIN_VIEWS, buildSeoAdminSearch, parseSeoAdminLocation, type SeoAdminView } from "./content-extension-model.ts";
import * as model from "./workspace-model.ts";
import { createSeoI18n } from "./i18n/messages.ts";
import type { SeoAdminBrand } from "./brand-context.ts";

const shellSource = readFileSync(new URL("./workspace-shell.tsx", import.meta.url), "utf8");
const logoSource = readFileSync(new URL("./shipit-logo.tsx", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");
function declaration(source: string, name: string) {
	const parsed = ts.createSourceFile("production.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found = parsed.statements.filter((node) =>
		ts.isFunctionDeclaration(node) && node.name?.text === name ||
		ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name));
	assert.equal(found.length, 1, "Exact production declaration: " + name);
	return found[0].getText(parsed);
}
function compile(source: string, scope: Record<string, unknown>) {
	const result = ts.transpileModule(source, { fileName: "navigation-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} };
	new Function("require", "module", "exports", ...Object.keys(scope), result.outputText)(
		(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; },
		output, output.exports, ...Object.values(scope));
	return output.exports as Record<string, any>;
}
import * as jsx from "react/jsx-runtime";

// Execute the actual event closures with local hook cells; DOM focus and layout
// remain installed-browser checks.
type Cell = { value: any; deps?: readonly unknown[] };
let owner: HookOwner;
class HookOwner {
	cells: Cell[] = [];
	cursor = 0;
	renders = 0;
	effects: Array<() => unknown> = [];
	readonly id: string;
	constructor(id: string) { this.id = id; }
	render<T>(render: () => T): T {
		const previous = owner;
		owner = this; this.cursor = 0; this.renders += 1;
		try { return render(); } finally { owner = previous; }
	}
	flush() { for (const effect of this.effects.splice(0)) effect(); }
	state<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
		const index = this.cursor++;
		this.cells[index] ??= { value: typeof initial === "function" ? (initial as () => T)() : initial };
		return [this.cells[index].value, (value) => {
			this.cells[index].value = typeof value === "function" ? (value as (current: T) => T)(this.cells[index].value) : value;
		}];
	}
	ref<T>(initial: T) {
		const index = this.cursor++;
		this.cells[index] ??= { value: { current: initial } };
		return this.cells[index].value as { current: T };
	}
	effect(effect: () => unknown, deps: readonly unknown[]) {
		const index = this.cursor++;
		const previous = this.cells[index];
		if (!previous?.deps || deps.some((value, i) => value !== previous.deps![i]) || deps.length !== previous.deps.length) {
			this.effects.push(effect);
		}
		this.cells[index] = { value: null, deps };
	}
}
const localReact = {
	...React,
	useState: <T,>(initial: T | (() => T)) => owner.state(initial),
	useRef: <T,>(initial: T) => owner.ref(initial),
	useEffect: (effect: () => unknown, deps: readonly unknown[]) => owner.effect(effect, deps),
	useLayoutEffect: (effect: () => unknown, deps: readonly unknown[]) => owner.effect(effect, deps),
	useCallback: <T,>(callback: T) => callback,
	useId: () => owner.id,
};
let renderLocale = "en";
const useSeoI18n = () => createSeoI18n(renderLocale);
let navigationBrand: SeoAdminBrand = { kind: "default", name: "SHIPIT SEO" };
// The mark renders in brand-mark.selfcheck.ts; here only its placement and brand are read.
function SeoBrandMark(_props: { brand: SeoAdminBrand }) { return null; }
const useSeoBrand = () => navigationBrand;
const { ShipitLogo } = compile(declaration(logoSource, "ShipitLogo") + "\nexport { ShipitLogo };", {});
const { WorkspaceNavigation, IndexingNavigation } = compile(
	["DESTINATION_ICONS", "SETTING_FOCUS_TIMEOUT_MS", "FOCUSABLE_CONTROL", "CHECKED_RADIO", "settingFocusRequest", "focusSettingField", "WorkspaceNavigation", "IndexingNavigation"]
		.map((name) => declaration(shellSource, name)).join("\n") + "\nexport { WorkspaceNavigation, IndexingNavigation };",
	{ React: localReact, Select, Input, SeoBrandMark, useSeoBrand, ...icons, ...model, useSeoI18n },
);
type Element = React.ReactElement<Record<string, any>>;
function elements(tree: React.ReactNode): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as Element;
	return [element, ...elements(element.props.children)];
}
function visibleElements(tree: React.ReactNode): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(visibleElements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as Element;
	if (element.props.hidden === true) return [];
	return [element, ...visibleElements(element.props.children)];
}
function text(tree: React.ReactNode): string {
	if (typeof tree === "string" || typeof tree === "number") return String(tree);
	if (Array.isArray(tree)) return tree.map(text).join("");
	return React.isValidElement(tree) ? text((tree as Element).props.children) : "";
}
function byClass(tree: React.ReactNode, className: string) {
	return elements(tree).find((node) => node.props.className === className);
}
function leaf(tree: React.ReactNode, view: SeoAdminView) {
	const found = visibleElements(tree).filter((node) => node.props["data-destination"] === view);
	assert.equal(found.length, 1, "One visible rail or search destination: " + view);
	return found[0];
}
function tool(tree: React.ReactNode, view: SeoAdminView) {
	const found = visibleElements(tree).filter((node) => node.props["data-indexing-destination"] === view);
	assert.equal(found.length, 1, "One local Indexing tool: " + view);
	return found[0];
}
function navHeadings(tree: React.ReactNode) { return elements(tree).filter((node) => typeof node.props.className === "string" && node.props.className.split(" ").includes("shipit-seo-workspace-nav__heading")); }
function tools(tree: React.ReactNode) { return elements(tree).filter((node) => node.props["data-indexing-destination"]).map((node) => node.props["data-indexing-destination"]); }
function settingRows(tree: React.ReactNode) { return visibleElements(tree).filter((node) => node.props["data-setting"]); }
function chooser(tree: React.ReactNode) { return elements(tree).find((node) => node.type === Select)!; }
function searchField(tree: React.ReactNode) { return elements(tree).find((node) => node.type === Input)!; }
function clearSearch(tree: React.ReactNode) { return elements(tree).find((node) => node.props.className === "shipit-seo-workspace-nav__clear")!; }
const indexingViews: SeoAdminView[] = ["indexing", "sitemap", "robots", "llms", "indexnow", "crawl", "monitor404"];
const railViews: SeoAdminView[] = ["overview", "queue", "content", "trends", "templates", "social", "schema", "identity",
	"indexing", "modules", "verification", "migration", "portability"];
const compactOrder: SeoAdminView[] = ["overview", "queue", "content", "trends", "templates", "social", "schema", "library", "identity", "site",
	...indexingViews, "modules", "verification", "migration", "portability"];
const headings = ["Content", "Search appearance", "Indexing", "Settings"];
const railHeadings = ["Content", "Search appearance", "Settings"];
function navigation(value: SeoAdminView, hiddenViews: SeoAdminView[] = [], counts: Partial<Record<SeoAdminView, number>> = {}) {
	const hooks = new HookOwner("nav");
	const localHooks = new HookOwner("indexing-nav");
	const selected: SeoAdminView[] = [];
	let props = { value, hiddenViews, counts, onChange: (next: SeoAdminView) => selected.push(next) };
	const render = (locale = "en") => {
		renderLocale = locale;
		hooks.render(() => WorkspaceNavigation(props)); hooks.flush();
		const tree = hooks.render(() => WorkspaceNavigation(props)) as Element; hooks.flush(); return tree;
	};
	const renderIndexing = (locale = "en") => {
		renderLocale = locale;
		const tree = localHooks.render(() => IndexingNavigation(props)) as Element | null; localHooks.flush(); return tree;
	};
	return { render, renderIndexing, selected, update: (next: Partial<typeof props>) => { props = { ...props, ...next }; } };
}
let cases = 0;
function check(run: () => void) { run(); cases += 1; }

check(() => {
	for (const brand of [
		{ kind: "default", name: "SHIPIT SEO" },
		{ kind: "configured", name: "Northwind Dental Marketing SEO" },
		{ kind: "fallback", name: "SEO" },
	] satisfies SeoAdminBrand[]) {
		navigationBrand = brand;
		const tree = navigation("overview").render();
		const identity = byClass(tree, "shipit-seo-workspace-nav__brand")!;
		assert.equal(identity.props["data-brand"], brand.kind, "The stylesheet wraps only a site's own name");
		const heading = elements(identity).filter((node) => node.type === "h1");
		assert.deepEqual(heading.map((node) => node.props.children), [brand.name], "The rail heading is the one brand name");
		const marks = elements(identity).filter((node) => node.type === SeoBrandMark);
		assert.equal(marks.length, 1);
		assert.equal(marks[0].props.brand, brand, "The mark follows the same brand");
	}
	navigationBrand = { kind: "default", name: "SHIPIT SEO" };
	assert.doesNotMatch(declaration(shellSource, "WorkspaceNavigation"), /SHIPIT|Shipit/, "The rail names no product of its own");
});

check(() => {
	const { ContractMismatchScreen } = compile(declaration(shellSource, "ContractMismatchScreen") + "\nexport { ContractMismatchScreen };", {
		React, ...icons, ...model, useSeoBrand, Button: ({ children }: { children?: React.ReactNode }) => React.createElement("button", null, children),
	});
	const error = new Error("SEO engine/admin mismatch: expected contract 45, received 9. (overview)");
	assert.equal(model.describeSeoContractMismatch(error)?.kind, "version");
	for (const [brand, name] of [[{ kind: "default", name: "SHIPIT SEO" }, "SHIPIT SEO"], [{ kind: "configured", name: "Acme SEO" }, "Acme SEO"], [{ kind: "fallback", name: "SEO" }, "SEO"]] as const) {
		navigationBrand = brand;
		const html = renderToStaticMarkup(React.createElement(ContractMismatchScreen, { error }));
		assert.match(html, new RegExp(`The ${name} engine answered with a different admin contract version`));
		assert.match(html, new RegExp(`Rebuild ${name} so its engine and admin come from the same release\\.`));
		assert.match(html, new RegExp(`install a matching ${name} engine and admin pair`));
		if (brand.kind !== "default") assert.doesNotMatch(html, /Shipit|SHIPIT/);
	}
	navigationBrand = { kind: "default", name: "SHIPIT SEO" };
});

check(() => {
	const encountered = new Set<string>();
	for (const view of SEO_ADMIN_VIEWS) {
		const hidden: SeoAdminView[] = view === "migration" ? [] : ["migration"];
		const nav = navigation(view, hidden, { content: 137 }); const tree = nav.render(); const local = nav.renderIndexing();
		const picker = chooser(tree);
		assert.equal(picker.props.label, "SEO page"); assert.equal(picker.props.value, view);
		assert.deepEqual(Object.keys(picker.props.items).sort(), SEO_ADMIN_VIEWS.filter((item) => !hidden.includes(item)).sort());
		assert.deepEqual(elements(picker.props.children).filter((node) => node.type === Select.GroupLabel).map((node) => node.props.children), headings,
			"The compact Select lists the rail's groups with the same headings");
		assert.deepEqual(elements(picker.props.children).filter((node) => node.type === Select.Option).map((node) => node.props.value),
			compactOrder.filter((item) => !hidden.includes(item)));
		const desktop = byClass(tree, "shipit-seo-workspace-nav__desktop");
		const rail = elements(desktop).filter((node) => node.props["data-destination"]);
		assert.deepEqual(rail.map((node) => node.props["data-destination"]), railViews.filter((item) => !hidden.includes(item)));
		assert.deepEqual(navHeadings(desktop).map((node) => text(node)), railHeadings,
			"Content, Search appearance and Settings carry visible headings");
		const groups = elements(desktop).filter((node) => node.props.className === "shipit-seo-workspace-nav__section");
		assert.deepEqual(groups.filter((group) => !navHeadings(group).length).map((group) => group.props["aria-label"]), ["Overview", "Indexing"]);
		for (const group of groups) {
			const heading = navHeadings(group)[0];
			if (heading) assert.equal(group.props["aria-labelledby"], heading.props.id, "A headed group is named by its heading");
		}
		assert.equal(elements(tree).filter((node) => node.props["data-destination"] === "modules").length, 1);
		assert.equal(elements(tree).filter((node) => node.type === "h1").length, 1);
		assert.deepEqual(elements(tree).filter((node) => node.props["aria-expanded"] !== undefined || node.props["aria-controls"] !== undefined), [],
			"The rail has no disclosure");
		const indexingRow = rail.filter((node) => node.props["data-rail-group"]);
		assert.equal(indexingRow.length, 1); assert.equal(indexingRow[0].props["data-rail-group"], "indexing");
		assert.equal(indexingRow[0].props["data-destination"], "indexing"); assert.equal(text(indexingRow[0]), "Indexing");
		assert.equal(elements(indexingRow[0]).filter((node) => node.type === icons.ListMagnifyingGlass).length, 1);
		assert.equal(indexingRow[0].props["aria-current"], view === "indexing" ? "page" : indexingViews.includes(view) ? "true" : undefined,
			"The one Indexing row is current for every Indexing tool");
		for (const node of rail) encountered.add(node.props["data-destination"]);
		for (const item of Object.keys(picker.props.items)) encountered.add(item);
		assert.equal(picker.props.items.site, "Website");
		assert.equal(rail.some((node) => node.props["data-destination"] === "site"), false, "Website shares the single Local SEO rail destination");
		assert.equal(picker.props.items.library, "Schema library");
		assert.equal(rail.some((node) => node.props["data-destination"] === "library"), false, "Library shares the single Schema rail destination");
		assert.equal(rail.filter((node) => node.props["aria-current"]).length, 1, "One rail row is current");
		if (indexingViews.includes(view)) {
			assert.ok(local); assert.equal(local.props["aria-label"], "Indexing tools");
			assert.deepEqual(tools(local), indexingViews, "The Indexing workspace lists every tool in canonical order");
			assert.deepEqual(elements(local).filter((node) => node.props["aria-current"]).map((node) => node.props["data-indexing-destination"]), [view]);
			assert.equal(tool(local, view).props["aria-current"], "page");
			for (const item of indexingViews) encountered.add(item);
			tool(local, view).props.onClick(); indexingRow[0].props.onClick();
		} else {
			assert.equal(local, null, "Local Indexing navigation is absent from other workspaces");
			const current = view === "site" ? "identity" : view === "library" ? "schema" : view;
			assert.equal(leaf(tree, current).props["aria-current"], view === "site" || view === "library" ? "true" : "page"); leaf(tree, current).props.onClick();
		}
		assert.deepEqual(nav.selected, [], "Reading navigation and selecting the current page make no route change");
		if (view === "content") {
			const count = elements(leaf(tree, "content")).find((node) => node.props.className === "shipit-seo-workspace-nav__count")!;
			assert.equal(count.props.children, "99+"); assert.equal(count.props["aria-label"], createSeoI18n("en").t("nav.attentionCount", { count: 137 }));
		}
		assert.match(renderToStaticMarkup(tree), /aria-label="SEO workspace"/);
	}
	assert.deepEqual([...encountered].sort(), [...SEO_ADMIN_VIEWS].sort(), "The rail, compact picker and local tools retain all 21 canonical routes");
});
check(() => {
	const nav = navigation("social", ["migration"]); let tree = nav.render();
	leaf(tree, "indexing").props.onClick(); assert.deepEqual(nav.selected, ["indexing"], "The Indexing row opens Indexing rules");
	nav.update({ value: "indexing" }); tree = nav.render();
	assert.equal(leaf(tree, "indexing").props["aria-current"], "page"); leaf(tree, "indexing").props.onClick();
	nav.update({ value: "robots" }); tree = nav.render(); let local = nav.renderIndexing()!;
	assert.equal(leaf(tree, "indexing").props["aria-current"], "true");
	leaf(tree, "indexing").props.onClick(); assert.deepEqual(nav.selected, ["indexing"], "The current Indexing row does nothing while another tool is open");
	assert.equal(tool(local, "robots").props["aria-current"], "page");
	const expectedIcons = { indexing: icons.ListChecks, sitemap: icons.TreeStructure, robots: icons.Robot,
		indexnow: icons.PaperPlaneTilt, llms: icons.FileText, crawl: icons.MagnifyingGlass, monitor404: icons.ArrowBendUpRight };
	for (const [view, Icon] of Object.entries(expectedIcons)) {
		const button = tool(local, view as SeoAdminView);
		assert.equal(elements(button).filter((node) => node.type === Icon && node.props["aria-hidden"] === "true").length, 1);
		assert.match(renderToStaticMarkup(button), /<svg/);
		assert.ok(elements(button).some((node) => node.type === "span" && node.props.children === createSeoI18n("en").t(`nav.view.${view as SeoAdminView}`)), "Every icon retains its visible tool label");
	}
	tool(local, "robots").props.onClick(); assert.deepEqual(nav.selected, ["indexing"], "A click on the open tool does nothing");
	tool(local, "sitemap").props.onClick(); assert.equal(nav.selected.at(-1), "sitemap");
	nav.update({ value: "sitemap" }); local = nav.renderIndexing()!;
	assert.equal(tool(local, "sitemap").props["aria-current"], "page"); assert.equal(tool(local, "robots").props["aria-current"], undefined);
	tool(local, "indexing").props.onClick(); assert.equal(nav.selected.at(-1), "indexing", "Indexing rules is a tool like the others");
	chooser(tree).props.onValueChange("verification"); assert.equal(nav.selected.at(-1), "verification");
	const count = nav.selected.length;
	chooser(tree).props.onValueChange(null); chooser(tree).props.onValueChange("missing"); chooser(tree).props.onValueChange("robots");
	assert.equal(nav.selected.length, count);
	nav.update({ value: "verification" }); tree = nav.render();
	assert.equal(leaf(tree, "verification").props["aria-current"], "page"); assert.equal(nav.renderIndexing(), null);
	assert.equal(leaf(tree, "indexing").props["aria-current"], undefined, "Leaving Indexing clears its row");
});
// Hidden tools are left out of the Indexing workspace; the rail row opens the first visible one.
check(() => {
	const nav = navigation("robots", ["crawl", "llms", "migration"]); const tree = nav.render();
	assert.deepEqual(tools(nav.renderIndexing()), ["indexing", "sitemap", "robots", "indexnow", "monitor404"]);
	assert.deepEqual(Object.keys(chooser(tree).props.items).filter((view) => indexingViews.includes(view as SeoAdminView)), ["indexing", "sitemap", "robots", "indexnow", "monitor404"]);
	const withoutRules = navigation("robots", ["indexing"]); let rulesTree = withoutRules.render();
	assert.deepEqual(tools(withoutRules.renderIndexing()), indexingViews.slice(1));
	assert.equal(leaf(rulesTree, "sitemap").props["data-rail-group"], "indexing"); assert.equal(leaf(rulesTree, "sitemap").props["aria-current"], "true");
	leaf(rulesTree, "sitemap").props.onClick(); assert.deepEqual(withoutRules.selected, []);
	withoutRules.update({ value: "social" }); rulesTree = withoutRules.render();
	leaf(rulesTree, "sitemap").props.onClick(); assert.deepEqual(withoutRules.selected, ["sitemap"]);
	const none = navigation("robots", [...indexingViews]); none.render();
	assert.equal(none.renderIndexing(), null, "No tool list when every tool is hidden");
});
check(() => {
	const nav = navigation("site", ["migration"]); let tree = nav.render();
	assert.equal(leaf(tree, "identity").props["aria-current"], "true");
	leaf(tree, "identity").props.onClick(); assert.deepEqual(nav.selected, [], "The active Local SEO destination keeps Website open");
	searchField(tree).props.onChange({ target: { value: "Website" } }); tree = nav.render();
	assert.deepEqual(visibleElements(tree).filter((node) => node.props["data-destination"]).map((node) => node.props["data-destination"]), ["site"]);
	assert.equal(leaf(tree, "site").props["aria-current"], "page");
	assert.deepEqual(settingRows(tree).map((node) => node.props["data-setting"]), ["siteName"]);
	clearSearch(tree).props.onClick(); nav.update({ value: "social" }); tree = nav.render();
	chooser(tree).props.onValueChange("site"); assert.deepEqual(nav.selected, ["site"], "The compact Website destination keeps its canonical route");
	searchField(tree).props.onChange({ target: { value: "Website" } }); tree = nav.render();
	leaf(tree, "site").props.onClick(); assert.deepEqual(nav.selected, ["site", "site"], "Website search selects the existing site route");
});
check(() => {
	const nav = navigation("library", ["migration"]); let tree = nav.render();
	assert.equal(leaf(tree, "schema").props["aria-current"], "true");
	leaf(tree, "schema").props.onClick(); assert.deepEqual(nav.selected, [], "The active Schema destination keeps Library open");
	nav.update({ value: "templates" }); tree = nav.render();
	leaf(tree, "schema").props.onClick(); assert.deepEqual(nav.selected, ["schema"], "Entering Schema from elsewhere opens its default route");
	chooser(tree).props.onValueChange("library"); assert.deepEqual(nav.selected, ["schema", "library"], "The compact Library destination keeps its deep link");
});
check(() => {
	const nav = navigation("social", ["migration"]); let tree = nav.render(); let focusCalls = 0;
	searchField(tree).props.ref.current = { focus: () => { focusCalls += 1; } };
	searchField(tree).props.onChange({ target: { value: "  SCHEMA  " } }); tree = nav.render();
	assert.deepEqual(visibleElements(tree).filter((node) => node.props["data-destination"]).map((node) => node.props["data-destination"]), ["schema", "library"]);
	assert.deepEqual(settingRows(tree).map((node) => text(node)), ["Schema output (Feature controls)", "Schema defaults (Schema)", "Custom schemas (Schema)", "Schema templates (Schema library)"],
		"Setting results read <setting> (<page>) after the page matches");
	assert.equal(elements(tree).find((node) => node.props.role === "status")?.props.children, createSeoI18n("en").t("nav.searchResults", { count: 6 }));
	assert.deepEqual(nav.selected, []); clearSearch(tree).props.onClick(); tree = nav.render();
	assert.equal(focusCalls, 1); assert.equal(leaf(tree, "modules").props["data-destination"], "modules");
	searchField(tree).props.onChange({ target: { value: "Robots" } }); tree = nav.render();
	leaf(tree, "robots").props.onClick(); assert.deepEqual(nav.selected, ["robots"], "Search reaches an Indexing tool without exposing a duplicate rail row");
	assert.equal(focusCalls, 2); nav.update({ value: "robots" }); tree = nav.render(); assert.equal(searchField(tree).props.value, "");
	searchField(tree).props.onChange({ target: { value: "no-such-setting" } }); tree = nav.render();
	assert.equal(visibleElements(tree).filter((node) => node.props["data-destination"] || node.props["data-setting"]).length, 0);
	assert.equal(elements(tree).find((node) => node.props.role === "status")?.props.children, createSeoI18n("en").t("nav.searchEmpty"));
	let prevented = 0; searchField(tree).props.onKeyDown({ key: "Escape", preventDefault: () => { prevented += 1; } }); tree = nav.render();
	assert.equal(prevented, 1); assert.equal(focusCalls, 3); assert.equal(searchField(tree).props.value, "");
	searchField(tree).props.onChange({ target: { value: "Migration" } }); tree = nav.render();
	assert.equal(visibleElements(tree).some((node) => node.props["data-destination"] === "migration"), false);
	searchField(tree).props.onChange({ target: { value: '<img src=x onerror="alert(1)">' } }); tree = nav.render();
	assert.doesNotMatch(renderToStaticMarkup(tree), /<img\s/); assert.equal(nav.selected.length, 1);
});
check(() => {
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const queried: string[] = []; const focused: string[] = []; const timers: Array<() => void> = [];
	const details = { tagName: "DETAILS", open: false, parentElement: null };
	let present: Record<string, unknown> | null = null;
	const control = (name: string, closest: unknown = null) => ({
		matches: (selector: string) => selector.split(", ").includes("input"), closest: () => closest, parentElement: details,
		focus: () => { focused.push(name); }, scrollIntoView: () => {},
	});
	Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: (selector: string) => { queried.push(selector); return present; } } });
	Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; } } });
	try {
		const nav = navigation("social", ["migration"]); let tree = nav.render();
		searchField(tree).props.ref.current = { focus: () => {} };
		searchField(tree).props.onChange({ target: { value: "bing" } }); tree = nav.render();
		const rows = settingRows(tree);
		assert.deepEqual(rows.map((node) => node.props["data-setting"]), ["bingCode"]);
		assert.equal(text(rows[0]), "Bing verification code (Site verification)");
		rows[0].props.onClick();
		assert.deepEqual(nav.selected, ["verification"], "A setting result opens its page");
		timers.shift()!();
		assert.deepEqual(queried, ['[data-seo-setting="bingCode"]']); assert.deepEqual(focused, []);
		assert.equal(timers.length, 1, "The field is awaited while its page renders");
		present = control("bing"); timers.shift()!();
		assert.deepEqual(focused, ["bing"], "The field is focused once it renders"); assert.equal(details.open, true, "An enclosing disclosure is opened");
		assert.equal(timers.length, 0);
		nav.update({ value: "verification" }); tree = nav.render();
		searchField(tree).props.onChange({ target: { value: "google" } }); tree = nav.render();
		present = control("google"); settingRows(tree)[0]!.props.onClick();
		assert.deepEqual(nav.selected, ["verification"], "A setting on the open page does not navigate");
		tree = nav.render(); assert.equal(searchField(tree).props.value, "", "The search clears");
		timers.shift()!(); assert.deepEqual(focused, ["bing", "google"]);
		searchField(tree).props.onChange({ target: { value: "excluded" } }); tree = nav.render();
		assert.deepEqual(settingRows(tree).map((node) => text(node)), ["Excluded paths (Sitemaps)"]);
		present = null; settingRows(tree)[0]!.props.onClick(); assert.equal(nav.selected.at(-1), "sitemap");
		assert.equal(timers.length, 1);
		searchField(tree).props.onChange({ target: { value: "taxonomy" } }); tree = nav.render();
		settingRows(tree)[0]!.props.onClick(); assert.equal(nav.selected.at(-1), "indexing", "A setting without a field opens its page");
		assert.equal(timers.length, 1, "A setting without a field waits for nothing");
		searchField(tree).props.onChange({ target: { value: "robots.txt" } }); tree = nav.render();
		present = control("hidden", {}); settingRows(tree).find((node) => node.props["data-setting"] === "robotsText")!.props.onClick();
		timers.shift()!(); assert.equal(timers.length, 1, "The earlier wait for Excluded paths ends once a newer request starts");
		const queriesBefore = queried.length; timers.shift()!();
		assert.equal(queried.at(-1), '[data-seo-setting="robotsText"]'); assert.ok(queried.length > queriesBefore);
		assert.deepEqual(focused, ["bing", "google"], "A control inside a hidden retained pane is never focused");
	} finally {
		if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
	}
});
check(() => {
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const focused: string[] = []; const timers: Array<() => void> = [];
	const option = (name: string) => ({ closest: () => null, parentElement: null, focus: () => { focused.push(name); }, scrollIntoView: () => {} });
	// The DOM order of a radio group: the unchecked Index option comes before the checked Noindex option.
	const group = { matches: () => false,
		querySelector: (selector: string) => selector === '[role="radio"][aria-checked="true"]' ? option("noindex") : option("index") };
	Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: () => group } });
	Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; } } });
	try {
		const nav = navigation("overview"); let tree = nav.render();
		searchField(tree).props.ref.current = { focus: () => {} };
		searchField(tree).props.onChange({ target: { value: "site-wide" } }); tree = nav.render();
		settingRows(tree).find((node) => node.props["data-setting"] === "siteNoindex")!.props.onClick();
		assert.deepEqual(nav.selected, ["indexing"]);
		timers.shift()!();
		assert.deepEqual(focused, ["noindex"], "A marked radio group is focused on its checked option");
	} finally {
		if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
	}
});
check(() => {
	const nav = navigation("migration"); nav.render(); nav.update({ value: "social", hiddenViews: ["migration"] });
	assert.equal(visibleElements(nav.render()).some((node) => node.props["data-destination"] === "migration"), false);
	nav.update({ value: "modules", hiddenViews: SEO_ADMIN_VIEWS.filter((view) => view !== "modules") });
	const tree = nav.render(); assert.deepEqual(Object.keys(chooser(tree).props.items), ["modules"]); assert.equal(leaf(tree, "modules").props["aria-current"], "page");
	assert.equal(elements(tree).some((node) => node.props["data-rail-group"]), false, "A fully hidden Indexing group has no row");
	nav.update({ hiddenViews: [...SEO_ADMIN_VIEWS] }); assert.equal(nav.render(), null);
});
check(() => {
	const nav = navigation("robots");
	for (const locale of ["en", "tr", "nl-BE", "xx-YY"]) {
		const tree = nav.render(locale); const { t } = createSeoI18n(locale);
		assert.equal(tree.props["aria-label"], t("nav.workspace")); assert.equal(searchField(tree).props["aria-label"], t("nav.searchLabel"));
		assert.equal(chooser(tree).props.items.indexing, t("nav.view.indexing"));
		assert.deepEqual(navHeadings(tree).map((node) => text(node)),
			[t("nav.group.content"), t("nav.group.appearance"), t("nav.group.settings")]);
		assert.equal(elements(leaf(tree, "indexing")).find((node) => node.props.className === "shipit-seo-workspace-nav__label")?.props.children, t("nav.group.indexing"));
		assert.equal(nav.renderIndexing(locale)?.props["aria-label"], t("nav.indexingTools")); assert.deepEqual(nav.selected, []);
	}
	let tree = nav.render("tr"); searchField(tree).props.onChange({ target: { value: "ŞEMA" } }); tree = nav.render("tr");
	assert.deepEqual(visibleElements(tree).filter((node) => node.props["data-destination"]).map((node) => node.props["data-destination"]), ["schema", "library"]);
	const turkish = createSeoI18n("tr");
	assert.ok(settingRows(tree).some((node) => text(node) === turkish.t("nav.settingResult", { setting: "Şema çıktısı", page: turkish.t("nav.view.modules") })),
		"Setting labels and results are translated");
	leaf(tree, "schema").props.onClick(); assert.deepEqual(nav.selected, ["schema"]);
	const outside = navigation("overview"); const dutch = createSeoI18n("nl");
	assert.equal(text(leaf(outside.render("nl"), "indexing")), dutch.t("nav.group.indexing"));
});
check(() => {
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document"); let focuses = 0;
	Object.defineProperty(globalThis, "document", { configurable: true, value: { querySelector: () => ({ focus: () => { focuses += 1; } }) } });
	try {
		const nav = navigation("robots"); nav.renderIndexing()!.props.onFocusCapture();
		nav.update({ value: "social" }); assert.equal(nav.renderIndexing(), null); assert.equal(focuses, 1, "Leaving local tools restores focus to the retained search input");
		nav.update({ value: "robots" }); const local = nav.renderIndexing()!;
		local.props.onFocusCapture(); local.props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: {} });
		nav.update({ value: "verification" }); nav.renderIndexing(); assert.equal(focuses, 1, "Focus that already moved elsewhere is not stolen");
	} finally { if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else delete (globalThis as any).document; }
});

// A page change scrolls only the real scroll container, never EmDash's overflow-hidden wrapper.
check(() => {
	const { revealWorkspaceTop } = compile(declaration(shellSource, "revealWorkspaceTop") + "\nexport { revealWorkspaceTop };",
		{ seoWorkspaceTopScroll: model.seoWorkspaceTopScroll });
	type FakeNode = { name: string; overflowY: string; scrollHeight: number; clientHeight: number; top: number; scrollTop: number; parentElement: FakeNode | null;
		getBoundingClientRect: () => { top: number } };
	const node = (name: string, overflowY: string, scrollHeight: number, clientHeight: number, top: number, parentElement: FakeNode | null): FakeNode =>
		({ name, overflowY, scrollHeight, clientHeight, top, scrollTop: 0, parentElement, getBoundingClientRect() { return { top: this.top }; } });
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const html = node("html", "visible", 900, 900, 0, null);
	const body = node("body", "auto", 1900, 900, 0, html);
	Object.defineProperty(globalThis, "document", { configurable: true, value: { body, documentElement: html, scrollingElement: html } });
	Object.defineProperty(globalThis, "window", { configurable: true, value: { getComputedStyle: (target: FakeNode) => ({ overflowY: target.overflowY }) } });
	try {
		// The EmDash 1.3.0 layout: the main column scrolls inside an overflow-hidden wrapper that escaped hidden text made scrollable.
		const wrapper = node("wrapper", "hidden", 958, 900, 0, body);
		const main = node("main", "auto", 1800, 844, 56, wrapper);
		const workspace = node("workspace", "visible", 1700, 1700, 80, main);
		revealWorkspaceTop(workspace);
		assert.deepEqual([main.scrollTop, wrapper.scrollTop, body.scrollTop, html.scrollTop], [0, 0, 0, 0], "A workspace top in view scrolls nothing");
		main.scrollTop = 360; workspace.top = -280;
		revealWorkspaceTop(workspace);
		assert.equal(main.scrollTop, 24, "The main column scrolls the workspace top back to its own top");
		assert.deepEqual([wrapper.scrollTop, body.scrollTop, html.scrollTop], [0, 0, 0], "The overflow-hidden wrapper and the page above it never scroll");
		const plain = node("plain", "visible", 2400, 2400, 0, body);
		const page = node("workspace", "visible", 2300, 2300, -100, plain);
		html.scrollTop = 500;
		revealWorkspaceTop(page);
		assert.deepEqual([html.scrollTop, body.scrollTop, plain.scrollTop], [400, 0, 0], "Without a scroll container the document scrolling element scrolls");
		html.scrollTop = 0;
		const outer = node("outer", "auto", 3000, 900, 0, body);
		const fitted = node("fitted", "auto", 600, 600, -260, outer);
		const nested = node("workspace", "visible", 560, 560, -240, fitted);
		outer.scrollTop = 300;
		revealWorkspaceTop(nested);
		assert.deepEqual([fitted.scrollTop, outer.scrollTop, html.scrollTop], [0, 60, 0],
			"A nearer auto container whose content fits cannot scroll, so the outer one that overflows brings the workspace top back");
	} finally {
		if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
	}
	const workspace = declaration(adminSource, "SeoAdminWorkspace");
	assert.match(shellSource, /scrollIntoView/, "control: the pattern finds a scrollIntoView call");
	assert.doesNotMatch(workspace, /scrollIntoView/, "A page change does not scroll every ancestor");
	assert.match(workspace, /previousView\.current = location\.view;\s*if \(workspaceRef\.current\) revealWorkspaceTop\(workspaceRef\.current\);\s*\}, \[location\.view\]\);/);
	assert.match(css, /(?:^|\n)\.shipit-seo-admin \{[^}]*\n\tposition: relative;/, "The plugin root contains its absolutely positioned hidden text");
});

// The view error is an alert, and its retry action can carry the page's own translated label.
check(() => {
	const Banner = (_props: Record<string, unknown>) => null;
	const Button = (_props: Record<string, unknown>) => null;
	const Mismatch = (_props: Record<string, unknown>) => null;
	const { ViewErrorState } = compile(declaration(shellSource, "ViewErrorState") + "\nexport { ViewErrorState };", {
		Banner, Button, WarningCircle: () => null, ContractMismatchScreen: Mismatch, isSeoContractMismatchError: model.isSeoContractMismatchError,
	});
	let retries = 0;
	const plain = ViewErrorState({ title: "Content page unavailable", error: new Error("Request failed"), onRetry: () => { retries += 1; } }) as Element;
	assert.equal(plain.type, Banner);
	assert.deepEqual([plain.props.role, plain.props.title, plain.props.description], ["alert", "Content page unavailable", "Request failed"], "The view error is announced as an alert");
	assert.equal(plain.props.action.type, Button);
	assert.equal(text(plain.props.action), "Retry", "Callers without a label keep Retry");
	plain.props.action.props.onClick();
	assert.equal(retries, 1);
	const translated = ViewErrorState({ title: "Indexeringsinstellingen niet beschikbaar", error: new Error("Failed"), onRetry: () => {}, retryLabel: "Opnieuw laden" }) as Element;
	assert.equal(text(translated.props.action), "Opnieuw laden", "A page's own label replaces Retry");
	assert.equal(translated.props.role, "alert");
	const passive = ViewErrorState({ title: "Unavailable", error: "unknown" }) as Element;
	assert.deepEqual([passive.props.role, passive.props.action, passive.props.description], ["alert", undefined, "The request failed."]);
});

const inert = () => null;
const listeners = new Map<string, () => void>();
const pushed: string[] = [];
const location = { pathname: "/_emdash/admin/plugins/shipit-seo/seo", search: "?keep=1&view=social", hash: "#fixture" };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: {
	location, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: inert,
	history: { state: {}, replaceState: inert, pushState(_state: unknown, _title: string, url: string) {
		pushed.push(url); const next = new URL(url, "https://fixture.invalid"); location.search = next.search;
	} },
} });
try {
	renderLocale = "en";
	let queryActions = 0;
	const settingsContainer = () => null;
	const viewBoundary = () => null;
	const schemaContainer = () => null;
	const overlapLine = () => null;
	const modulesContainer = () => null;
	const robotsView = () => null;
	const draftProvider = ({ children }: { children?: React.ReactNode }) => children;
	const pageActiveProvider = ({ children }: { children?: React.ReactNode }) => children;
	const localSeoNav = () => null;
	const websiteSummary = () => null;
	const workspace = compile(declaration(adminSource, "SeoAdminWorkspace") + "\nexport { SeoAdminWorkspace };", {
		React: localReact, ...model, ...icons, WorkspaceNavigation, IndexingNavigation, LocalSeoNavigation: localSeoNav, WebsiteSummaryCard: websiteSummary, buildSeoAdminSearch, parseSeoAdminLocation, useSeoI18n, ShipitLogo: inert,
		useQueryClient: () => ({ removeQueries: () => queryActions += 1, invalidateQueries: () => queryActions += 1 }),
		useOverviewQuery: () => ({ data: { summary: { needsAttention: 3, legacyOverrides: 0, migrationRecords: 0 }, site: { indexable: true }, engineVersion: "fixture" } }),
		useSettingsQuery: () => ({ data: { values: { noindex: false } } }),
		cancelBusinessIdentityProfileFocus: inert, requestBusinessIdentityFocus: inert,
		Banner: inert, Button: inert, Badge: inert, SeoViewBoundary: viewBoundary,
		OverviewContainer: inert, ContentScoringControls: inert, ContentAuditContainer: inert, WorkQueueView: inert, TrendsView: inert,
		CrawlDiagnosticsView: inert, NotFoundView: inert, TemplatesContainer: inert, SettingsSectionContainer: settingsContainer, BusinessIdentitySection: inert,
		ModulesContainer: modulesContainer, SitemapContainer: inert, RobotsTxtView: robotsView, LlmsTxtView: inert, SchemaLibraryView: inert,
		IndexNowView: inert, SiteVerificationView: inert, CustomVerificationView: inert, MigrationContainer: inert, PortabilityView: inert, SchemaContainer: schemaContainer,
		PluginOverlapLine: overlapLine, WorkspaceDraftProvider: draftProvider, WorkspacePageActiveProvider: pageActiveProvider,
	});
	const parent = new HookOwner("workspace");
	const renderParent = () => { const tree = parent.render(() => workspace.SeoAdminWorkspace()) as Element; parent.flush(); return tree; };
	let tree = renderParent();
	const retainedSettings = () => elements(tree).filter((node) => node.type === settingsContainer);
	const settings = (section: string) => {
		const selected = visibleElements(tree).filter((node) => node.type === settingsContainer);
		assert.equal(selected.length, 1, "Only the selected settings owner is visible");
		assert.equal(selected[0].props.section, section);
		return selected[0];
	};
	const assertRetainedSettings = (
		expected: readonly ("site" | "social" | "indexing")[],
		selected: "site" | "social" | "indexing" | null,
	) => {
		const panes = elements(tree).filter((node) => node.props.className === "shipit-seo-settings-pane");
		assert.deepEqual(panes.map((node) => node.props["data-settings-view"]), expected);
		assert.equal(retainedSettings().length, expected.length, "Each visited settings page keeps exactly one owner");
		const selectedOwners = visibleElements(tree).filter((node) => node.type === settingsContainer);
		assert.deepEqual(selectedOwners.map((node) => node.props.section),
			selected === null ? [] : [selected === "site" ? "identity" : selected]);
		const currentView = parseSeoAdminLocation(location.search).view;
		const changingBoundary = elements(tree).find((node) => node.type === viewBoundary && node.props.resetKey === currentView)!;
		assert.ok(changingBoundary, "The current route retains its separate error boundary");
		for (const pane of panes) {
			const view = pane.props["data-settings-view"];
			assert.equal(pane.key, view, "The retained settings pane keeps a stable route key");
			assert.equal(pane.props.hidden, view !== selected);
			const owners = elements(pane).filter((node) => node.type === settingsContainer);
			assert.equal(owners.length, 1);
			assert.equal(owners[0].props.section, view === "site" ? "identity" : view);
			assert.equal(owners[0].props.active, view === selected, "Only the selected owner enables its settings read");
			const boundaries = elements(pane).filter((node) => node.type === viewBoundary);
			assert.equal(boundaries.length, 1);
			assert.equal(boundaries[0].props.resetKey, "settings-" + view, "Owner errors cannot reset on another route");
			assert.equal(elements(changingBoundary).includes(owners[0]), false, "Pending settings writers stay outside the changing route boundary");
		}
	};
	assertRetainedSettings(["social"], "social");
	settings("social").props.onOverridesChange({ twitterHandle: "@unsaved" }); tree = renderParent();
	const socialDraft = structuredClone(settings("social").props.overrides);
	const hooks = new HookOwner("nested-navigation");
	const renderNav = () => { const props = elements(tree).find((node) => node.type === WorkspaceNavigation)!.props;
		hooks.render(() => WorkspaceNavigation(props)); hooks.flush();
		const result = hooks.render(() => WorkspaceNavigation(props)) as Element; hooks.flush(); return result; };
	let navTree = renderNav();
	const toolHooks = new HookOwner("nested-indexing");
	const renderTools = () => { const props = elements(tree).find((node) => node.type === IndexingNavigation)!.props;
		const result = toolHooks.render(() => IndexingNavigation(props)) as Element | null; toolHooks.flush(); return result; };
	const content = byClass(tree, "shipit-seo-workspace-content")!;
	const shell = byClass(tree, "shipit-seo-workspace-shell")!;
	assert.equal(shell.props.children[1], content, "Navigation and content keep independent sibling lifetimes");
	const renders = parent.renders;
	renderLocale = "tr"; navTree = renderNav();
	assert.equal(parent.renders, renders); assert.deepEqual(settings("social").props.overrides, socialDraft);
	assert.deepEqual(pushed, []); assert.equal(queryActions, 0, "Navigation rendering and locale changes add no requests or writes");
	const go = (view: SeoAdminView) => {
		const props = elements(tree).find((node) => node.type === IndexingNavigation)!.props;
		assert.equal(props.hiddenViews, elements(tree).find((node) => node.type === WorkspaceNavigation)!.props.hiddenViews, "The Indexing tools respect the rail's hidden pages");
		if (view === "site") chooser(navTree).props.onValueChange(view);
		else if (indexingViews.includes(view) && indexingViews.includes(parseSeoAdminLocation(location.search).view)) tool(renderTools(), view).props.onClick();
		else leaf(navTree, view).props.onClick();
		tree = renderParent(); navTree = renderNav();
	};
	searchField(navTree).props.onChange({ target: { value: "Schema" } }); navTree = renderNav();
	assert.equal(parent.renders, renders); assert.equal(queryActions, 0); assert.deepEqual(pushed, []);
	clearSearch(navTree).props.onClick(); navTree = renderNav();
	go("site");
	assert.match(pushed.at(-1)!, /keep=1&view=site#fixture/);
	assertRetainedSettings(["site", "social"], "site");
	settings("identity").props.onOverridesChange({ siteName: "Unsaved site name" }); tree = renderParent(); navTree = renderNav();
	const stepNavigation = () => elements(tree).filter((node) => node.type === localSeoNav);
	assert.equal(stepNavigation().length, 0, "Website is its own form, so the identity steps are not shown there");
	assert.equal(typeof settings("identity").props.onOpenView, "function", "The Website form can return to business identity");
	settings("identity").props.onOpenView("identity"); tree = renderParent(); navTree = renderNav();
	assert.equal(parseSeoAdminLocation(location.search).view, "identity");
	assert.equal(leaf(navTree, "identity").props["aria-current"], "page");
	assert.equal(stepNavigation().length, 1, "Local SEO shows one step navigation");
	const business = elements(tree).find((node) => node.props.showStepNavigation === false)!;
	assert.equal(business.props.onOpenSiteSettings instanceof Function, true, "The business form suppresses its duplicate tab row");
	assert.equal(business.props.websiteSummary.type, websiteSummary, "The Identity step carries the Website summary card");
	assert.deepEqual(business.props.websiteSummary.props.overrides, { siteName: "Unsaved site name" }, "The summary sees the unsaved Website draft");
	assertRetainedSettings(["site", "social"], null);
	business.props.websiteSummary.props.onEdit(); tree = renderParent(); navTree = renderNav();
	assert.equal(parseSeoAdminLocation(location.search).view, "site");
	assert.equal(stepNavigation().length, 0);
	assert.deepEqual(settings("identity").props.overrides, { siteName: "Unsaved site name" }, "Website keeps its settings owner across Local SEO");
	go("indexing");
	settings("indexing").props.onOverridesChange({ noindex: true }); tree = renderParent(); navTree = renderNav();
	const indexingDraft = structuredClone(settings("indexing").props.overrides);
	assertRetainedSettings(["site", "social", "indexing"], "indexing");
	go("social");
	assert.deepEqual(settings("social").props.overrides, socialDraft, "Leaf navigation retains the real Social draft");
	go("schema"); tree = renderParent(); navTree = renderNav();
	assert.equal(byClass(tree, "shipit-seo-schema-pane")?.props.hidden, false);
	assertRetainedSettings(["site", "social", "indexing"], null);
	const schemaOwner = () => {
		const owners = elements(tree).filter((node) => node.type === schemaContainer);
		assert.equal(owners.length, 1, "Schema and Library share one retained Schema owner");
		return owners[0];
	};
	assert.equal(schemaOwner().props.route, "schema"); assert.equal(schemaOwner().props.active, true);
	schemaOwner().props.onRouteChange("library"); tree = renderParent(); navTree = renderNav();
	assert.match(pushed.at(-1)!, /keep=1&view=library#fixture/, "Opening the Library tab pushes its deep link");
	assert.equal(schemaOwner().props.route, "library"); assert.equal(byClass(tree, "shipit-seo-schema-pane")?.props.hidden, false);
	assert.equal(leaf(navTree, "schema").props["aria-current"], "true", "Library highlights the Schema destination");
	schemaOwner().props.onRouteChange("schema"); tree = renderParent(); navTree = renderNav();
	assert.match(pushed.at(-1)!, /keep=1&view=schema#fixture/, "Leaving Library from a tab pushes view=schema");
	location.search = "?keep=1&view=library"; listeners.get("popstate")!(); tree = renderParent(); navTree = renderNav();
	assert.equal(schemaOwner().props.route, "library", "Back returns to the Library tab");
	location.search = "?keep=1&view=schema"; listeners.get("popstate")!(); tree = renderParent(); navTree = renderNav();
	assert.equal(schemaOwner().props.route, "schema");
	go("content");
	assert.equal(byClass(tree, "shipit-seo-schema-pane")?.props.hidden, true, "Visited Schema remains mounted across leaf navigation");
	assertRetainedSettings(["site", "social", "indexing"], null);
	go("indexing");
	assert.deepEqual(settings("indexing").props.overrides, indexingDraft, "The independent indexing draft remains local");
	go("site");
	assert.deepEqual(settings("identity").props.overrides, { siteName: "Unsaved site name" }, "Website keeps its own draft");
	go("modules");
	const modulesOwner = () => elements(tree).find((node) => node.type === modulesContainer)!;
	modulesOwner().props.onOpenView("queue", "images"); tree = renderParent(); navTree = renderNav();
	assert.deepEqual(parseSeoAdminLocation(location.search), { view: "queue", ref: null, queueScope: "images" }, "Image alt checks opens the image scope in place");
	assert.match(pushed.at(-1)!, /keep=1&view=queue&scope=images#fixture/);
	go("modules");
	modulesOwner().props.onOpenView("schema"); tree = renderParent(); navTree = renderNav();
	assert.equal(parseSeoAdminLocation(location.search).view, "schema");
	go("modules");
	assert.equal(leaf(navTree, "modules").props["aria-current"], "page");
	// A draft page stays mounted, hidden, only while one of its forms holds work.
	const draftPanes = () => elements(tree).filter((node) => node.props.className === "shipit-seo-draft-pane")
		.map((node) => [node.props["data-draft-view"], node.props.hidden] as const);
	const draftPane = (view: string) => elements(tree).find((node) => node.props.className === "shipit-seo-draft-pane" && node.props["data-draft-view"] === view)!;
	assert.deepEqual(draftPanes(), [["modules", false]]);
	go("indexing"); go("robots");
	assert.deepEqual(draftPanes(), [["robots", false]], "A clean page is not kept after leaving it");
	assert.equal(draftPane("robots").key, "robots");
	assert.equal(elements(draftPane("robots")).filter((node) => node.type === robotsView).length, 1);
	assert.equal(elements(draftPane("robots")).find((node) => node.type === viewBoundary)!.props.resetKey, "draft-robots",
		"A kept page has its own error boundary");
	const robotsReport = elements(draftPane("robots")).find((node) => node.type === draftProvider)!.props.value as (key: string, held: boolean) => void;
	robotsReport("robots-text", true); tree = renderParent(); navTree = renderNav();
	go("sitemap");
	assert.deepEqual(draftPanes(), [["sitemap", false], ["robots", true]], "Leaving a page with unsaved work keeps it mounted and hidden");
	const pageActive = (view: string) => elements(draftPane(view)).find((node) => node.type === pageActiveProvider)!.props.value;
	assert.deepEqual([pageActive("sitemap"), pageActive("robots")], [true, false], "A hidden kept page is told it is inactive, so it closes its dialogs");
	go("robots");
	assert.deepEqual(draftPanes(), [["robots", false]], "Returning shows the same owner; the clean page left behind is released");
	assert.equal(elements(draftPane("robots")).find((node) => node.type === draftProvider)!.props.value, robotsReport, "The reporter stays stable");
	robotsReport("robots-text", true); tree = renderParent();
	assert.deepEqual(draftPanes(), [["robots", false]], "A repeated report changes nothing");
	robotsReport("robots-text", false); tree = renderParent(); navTree = renderNav();
	go("modules");
	assert.deepEqual(draftPanes(), [["modules", false]], "Released work lets the page unmount when it is left");
	assert.equal(queryActions, 0, "Keeping and releasing a page sends nothing");
	for (const view of ["verification", "site", "identity", "indexing", "social"] as const) {
		location.search = "?keep=1&view=" + view; listeners.get("popstate")!(); tree = renderParent(); navTree = renderNav();
		assert.equal(leaf(navTree, view === "site" ? "identity" : view).props["aria-current"], view === "site" ? "true" : "page", "Back/Forward reveals the matching destination");
		assertRetainedSettings(["site", "social", "indexing"], view === "verification" || view === "identity" ? null : view);
		const overlap = elements(tree).filter((node) => node.type === overlapLine);
		assert.equal(overlap.length, 1, "One overlap notice owner sits above every view");
		assert.equal(overlap[0].props.view, view);
	}
	assert.deepEqual(settings("social").props.overrides, socialDraft);
	settings("social").props.onRestoredInherited(); tree = renderParent(); navTree = renderNav();
	assert.deepEqual(settings("social").props.overrides, {}, "An explicit inherited restore clears Social's local overrides");
	go("indexing");
	assert.deepEqual(settings("indexing").props.overrides, indexingDraft, "Restoring site/social defaults cannot clear the independent Indexing draft");
	go("site");
	assert.deepEqual(settings("identity").props.overrides, {}, "The same restore clears the Website overrides");
	assertRetainedSettings(["site", "social", "indexing"], "site");
	assert.equal(queryActions, 0, "Actual search/leaf/deep-link navigation does not invalidate or save");
	cases += 1;
} finally {
	if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
	else Reflect.deleteProperty(globalThis, "window");
}
assert.doesNotMatch(adminSource, /MOBILE_NAV_ITEMS|shipit-seo-mobile-nav/);
const navigationCss = css.slice(css.indexOf(".shipit-seo-workspace-shell {"), css.indexOf(".shipit-seo-header h1,"));
assert.doesNotMatch(navigationCss, /position:\s*(?:sticky|fixed)|overflow(?:-[xy])?:\s*(?:auto|scroll)|--shipit-seo-nav-available-height/);
assert.match(navigationCss, /grid-template-columns:\s*minmax\(210px,\s*230px\) minmax\(0,\s*1fr\)/);
assert.doesNotMatch(shellSource, /openGroup|GROUP_ICONS/);
assert.doesNotMatch(shellSource, /aria-expanded=|aria-controls=/, "The rail has no disclosure");
assert.doesNotMatch(shellSource, /shipit-seo-workspace-nav__primary/);
assert.doesNotMatch(declaration(adminSource, "SeoAdminWorkspace"), /<header|<h1|<ShipitLogo|icon=\{SlidersHorizontal\}/, "The rail identity and settings links are not duplicated above the content");
assert.doesNotMatch(declaration(shellSource, "WorkspaceNavigation"), /ResizeObserver|getBoundingClientRect|addEventListener/);
assert.match(css, /@container shipit-seo-admin \(max-width: 760px\)[\s\S]*?\.shipit-seo-workspace-nav__compact\s*\{\s*display: block;/);
assert.match(declaration(adminSource, "SeoAdminWorkspace"), /<IndexingNavigation value=\{view\} hiddenViews=\{hiddenViews\} onChange=\{\(next\) => selectView\(next\)\} \/>/);
assert.match(declaration(adminSource, "SeoAdminWorkspace"), /<PluginOverlapLine view=\{view\} onOpenModules=\{\(\) => selectView\("modules"\)\} \/>\n\s*<SeoViewBoundary resetKey=\{view\}>/,
	"The overlap notice sits at the top of the content, above the view");
assert.match(declaration(adminSource, "SeoAdminWorkspace"), /selectView\(SEO_SETTINGS_UNREADABLE_VIEW\)/);
assert.doesNotMatch(shellSource, /INDEXING_VIEWS: readonly|RAIL_SECTIONS/, "The rail has no second navigation model");
console.log("SEO workspace navigation self-check passed (" + cases + " groups).");
