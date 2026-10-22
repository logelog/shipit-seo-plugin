import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Switch } from "@cloudflare/kumo/components/switch";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_MODULES_STORAGE_VERSION,
	SEO_ADMIN_SITEMAP_STORAGE_VERSION,
	validateSeoAdminModuleValues,
	validateSeoAdminSitemapValues,
	type SeoAdminModuleConfiguration,
	type SeoAdminModuleState,
	type SeoAdminSitemapConfiguration,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { publicLinkText, sitemapFileLinks, sitemapPlanSummary } from "./sitemap-view-model.ts";
import { SEO_MODULE_SETTING_IDS, SEO_SETTINGS_UNREADABLE_VIEW, seoWorkspaceKeys } from "./workspace-model.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const configurationSource = read("./configuration-views.tsx");
const scoringSource = read("./content-scoring-controls.tsx");
const ownershipSource = read("./publisher-ownership-view.tsx");
const adminSource = read("./admin.tsx");
function declaration(source: string, name: string): string {
	const parsed = ts.createSourceFile("production.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name ||
		ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name));
	assert.equal(found.length, 1, "Exact production declaration: " + name);
	return found[0]!.getText(parsed);
}

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
	effect(effect: () => unknown, deps: readonly unknown[]) {
		const index = this.cursor++;
		const previous = this.cells[index];
		if (!previous?.deps || deps.length !== previous.deps.length || deps.some((value, i) => value !== previous.deps![i])) this.effects.push(effect);
		this.cells[index] = { value: null, deps };
	}
}
const localReact = {
	...React,
	useState: <T,>(initial: T | (() => T)) => owner.state(initial),
	useEffect: (effect: () => unknown, deps: readonly unknown[]) => owner.effect(effect, deps),
	useMemo: <T,>(compute: () => T) => compute(),
};
const PluginCoexistenceView = () => null;
const ContentAnalysisActivation = () => null;
const PublisherOwnershipPanel = () => null;
const ConfigurationActions = () => null;
const Banner = () => null;
let writes = 0;
type ModuleWrite = (...args: unknown[]) => Promise<unknown>;
let saveModules: ModuleWrite = () => Promise.reject(new Error("Unexpected save"));
let resetModules: ModuleWrite = () => Promise.reject(new Error("Unexpected restore"));
const holds: Array<[string, boolean]> = [];
const toastLog: string[] = [];
const scope = {
	React: localReact, Badge, Banner, Button, Switch, ...icons, validateSeoAdminModuleValues, SEO_MODULE_SETTING_IDS,
	saveSeoAdminModules: (...args: unknown[]) => { writes += 1; return saveModules(...args); },
	resetSeoAdminModules: (...args: unknown[]) => { writes += 1; return resetModules(...args); },
	loadPublisherOwnership: () => {}, useSeoToasts: () => ({ success: (title: string) => { toastLog.push("success: " + title); }, error: (title: string) => { toastLog.push("error: " + title); } }),
	useWorkspaceDraftHold: (key: string, held: boolean) => { holds.push([key, held]); },
	useWorkspacePageActive: () => true,
	PluginCoexistenceView, ContentAnalysisActivation, PublisherOwnershipPanel, ConfigurationActions,
};
const compiled = ts.transpileModule(["MODULE_ICONS", "MODULE_DESTINATIONS", "moduleValues", "moduleForm", "sameModuleValues", "ModulesView"].map((name) => declaration(configurationSource, name)).join("\n") +
	"\nexport { ModulesView };", { fileName: "modules-probe.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} as Record<string, any> };
new Function("require", "module", "exports", ...Object.keys(scope), compiled.outputText)(
	(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, output, output.exports, ...Object.values(scope));
const ModulesView = output.exports.ModulesView as (props: Record<string, unknown>) => React.ReactElement<Record<string, any>>;

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
function module(key: SeoAdminModuleState["key"], enabled: boolean, editable = true): SeoAdminModuleState {
	return { key, label: key === "imageSeo" ? "Image alt checks" : key === "monitor404" ? "404 Monitor" : key[0]!.toUpperCase() + key.slice(1),
		description: "Purpose of " + key + ".", enabled, editable } as SeoAdminModuleState;
}
const configuration: SeoAdminModuleConfiguration = {
	storageVersion: SEO_ADMIN_MODULES_STORAGE_VERSION, updatedAt: "2026-10-18T10:00:00.000Z", revision: "rev-1", writable: true,
	items: [module("seoAnalyzer", true, false), module("schema", true), module("sitemap", false), module("monitor404", true), module("imageSeo", true)],
};
let cases = 0;
function check(run: () => void) { run(); cases += 1; }

check(() => {
	const opened: unknown[][] = [];
	const hooks = new HookOwner();
	const props = { configuration, onSaved: () => {}, onOverviewRefresh: () => Promise.resolve(), onOpenIdentity: () => {},
		onOpenView: (...args: unknown[]) => { opened.push(args); } };
	const render = () => { const tree = hooks.render(() => ModulesView(props)); hooks.flush(); return hooks.render(() => ModulesView(props)); };
	let tree = render();
	const top = (tree.props.children as Element[]).filter(React.isValidElement) as Element[];
	assert.deepEqual(top.map((node) => node.type === "form" ? "form" : node.type), [PluginCoexistenceView, "form", ContentAnalysisActivation, PublisherOwnershipPanel],
		"Overlap rows head Feature controls; the immediate panels follow the form");
	const heading = elements(top[1]).find((node) => node.props.className === "shipit-seo-heading-badges")!;
	assert.deepEqual(elements(heading).filter((node) => node.type === Badge).map(text), ["Save to apply", "3 of 4 on"], "The form is labelled as saved on Save");
	const rows = () => elements(tree).filter((node) => node.props.className === "shipit-seo-module-row");
	const openFor = (key: string) => {
		const row = rows().find((node) => elements(node).some((child) => child.type === Switch && child.props["data-seo-setting"] === SEO_MODULE_SETTING_IDS[key]))!;
		assert.ok(row, "Row for " + key);
		return elements(row).filter((node) => node.type === Button && text(node) === "Open");
	};
	assert.equal(rows().length, 4, "Only editable modules have rows");
	assert.deepEqual(["schema", "sitemap", "monitor404", "imageSeo"].map((key) => openFor(key).length), [1, 0, 1, 1], "Open appears only for modules saved on");
	for (const key of ["schema", "monitor404", "imageSeo"]) {
		const [open] = openFor(key);
		assert.equal(open!.props.variant, "ghost"); assert.equal(open!.props.type, "button");
		assert.match(open!.props["aria-label"], /^Open /);
		open!.props.onClick();
	}
	assert.deepEqual(opened, [["schema", undefined], ["monitor404", undefined], ["queue", "images"]], "Each link opens its page in the workspace");
	const switchFor = (key: string) => elements(tree).find((node) => node.type === Switch && node.props["data-seo-setting"] === SEO_MODULE_SETTING_IDS[key])!;
	switchFor("sitemap").props.onCheckedChange(true); switchFor("schema").props.onCheckedChange(false);
	tree = render();
	assert.equal(switchFor("sitemap").props.checked, true); assert.equal(switchFor("schema").props.checked, false);
	assert.deepEqual(["schema", "sitemap", "monitor404", "imageSeo"].map((key) => openFor(key).length), [1, 0, 1, 1], "Unsaved toggles do not change the links");
	assert.equal(writes, 0, "Rendering, linking and toggling write nothing");
	const actions = elements(tree).find((node) => node.type === ConfigurationActions)!;
	assert.equal(actions.props.saveLabel, "Save modules"); assert.equal(actions.props.dirty, true);
});

check(() => {
	const hooks = new HookOwner();
	const tree = hooks.render(() => ModulesView({ configuration, onSaved: () => {}, onOverviewRefresh: () => Promise.resolve() }));
	assert.equal(elements(tree).filter((node) => node.type === Button && text(node) === "Open").length, 0, "Without a navigation owner no link is offered");
});

check(() => {
	const activation = scoringSource.slice(scoringSource.indexOf("export function ContentAnalysisActivation()"), scoringSource.indexOf("export function ContentScoringControls("));
	assert.match(activation, /<div className="shipit-seo-heading-badges">\s*<Badge variant="outline">Saves immediately<\/Badge>/, "Automatic & bulk analysis is labelled as immediate");
	const feature = declaration(ownershipSource, "PublisherOwnershipPanel");
	assert.match(feature, /variant === "feature" \? \(\s*<div className="shipit-seo-heading-badges">\s*<Badge variant="outline">Saves immediately<\/Badge>/,
		"The publisher panel in Feature controls is labelled as immediate");
	assert.equal(feature.match(/Saves immediately/g)?.length, 1, "Local SEO keeps its own wording");
	const container = declaration(adminSource, "ModulesContainer");
	assert.match(container, /onOpenView=\{onOpenView\}/);
	const workspace = declaration(adminSource, "SeoAdminWorkspace");
	assert.match(workspace, /onOpenView=\{\(next, queueScope\) => selectView\(next, queueScope \? \{ queueScope \} : \{\}\)\}/);
	assert.match(workspace, /: options\.queueScope \?\? \(location\.view === "queue" \? location\.queueScope : "all"\);/, "An explicit queue scope wins");
});

// With analysis off, Content health opens Feature controls; the link button changes no setting itself.
check(() => {
	const LinkButton = (_props: Record<string, unknown>) => null;
	const NoticeBanner = (_props: Record<string, unknown>) => null;
	const probe = ts.transpileModule(["FEATURE_CONTROLS_URL", "AnalysisOffNotice"].map((name) => declaration(scoringSource, name)).join("\n") +
		"\nexport { AnalysisOffNotice, FEATURE_CONTROLS_URL };", { fileName: "analysis-off-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(probe.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const exported = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", "Banner", "LinkButton", probe.outputText)(
		(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exported, exported.exports, NoticeBanner, LinkButton);
	const opened: string[] = [];
	const render = (onOpenFeatureControls?: () => void) => exported.exports.AnalysisOffNotice({ onOpenFeatureControls }) as Element;
	const banner = render(() => opened.push("modules"));
	assert.equal(banner.type, NoticeBanner);
	assert.equal(banner.props.title, "Enable analysis to scan content");
	assert.equal(banner.props.description, "To scan your content, enable Automatic & bulk analysis in Feature controls.");
	const link = banner.props.action as Element;
	assert.equal(link.type, LinkButton); assert.equal(text(link), "Open Feature controls");
	assert.equal(link.props.href, exported.exports.FEATURE_CONTROLS_URL); assert.equal(link.props.href, "/_emdash/admin/plugins/shipit-seo/seo?view=modules");
	assert.doesNotMatch(text(link), /^Enable/, "The button opens a page; it does not claim to enable anything");
	const click = (init: Record<string, unknown> = {}) => { let prevented = false; return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init, preventDefault: () => { prevented = true; }, get prevented() { return prevented; } }; };
	const plain = click(); link.props.onClick(plain);
	assert.equal(plain.prevented, true); assert.deepEqual(opened, ["modules"], "A plain click opens Feature controls in the workspace");
	for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
		const event = click(modifier); link.props.onClick(event);
		assert.equal(event.prevented, false, "A modified click keeps the browser link behaviour");
	}
	assert.deepEqual(opened, ["modules"]);
	const alone = click(); (render().props.action as Element).props.onClick(alone);
	assert.equal(alone.prevented, false, "Without a workspace the link loads Feature controls itself");
	const health = scoringSource.slice(scoringSource.indexOf("export function ContentScoringControls("));
	assert.match(health, /const analysisOff = scoreScanNeedsAnalysisEnabled\(\{ isError: settingsQuery\.isError, values: settingsQuery\.data\?\.values, policyState: policy\?\.state \}\);/);
	assert.match(health, /\{analysisOff \? <AnalysisOffNotice onOpenFeatureControls=\{onOpenFeatureControls\} \/>\s*: !settingsQuery\.isPending && !settingsQuery\.isError && settingsValues !== null \? <div className="shipit-seo-analysis-status"/,
		"A pending, failed or unreadable read shows neither the notice nor a policy state");
	assert.doesNotMatch(health, /saveSeoContentScoring\(/, "Content health never writes the analysis preference");
	const workspace = declaration(adminSource, "SeoAdminWorkspace");
	assert.match(workspace, /onOpenFeatureControls=\{\(\) => \{ selectView\("modules"\); focusSettingField\("automaticAnalysis"\); \}\}/);
	const activation = declaration(scoringSource, "ContentAnalysisActivation");
	assert.match(activation, /<h2 id="seo-analysis-activation-title" tabIndex=\{-1\} data-seo-setting="automaticAnalysis">/, "Feature controls focuses the analysis section it opens");
});

// Unreadable settings: Content health names and opens the same page as the banner and Overview.
check(() => {
	assert.equal(SEO_SETTINGS_UNREADABLE_VIEW, "indexing");
	const health = scoringSource.slice(scoringSource.indexOf("export function ContentScoringControls("));
	assert.match(health, /Open \{SEO_WORKSPACE_VIEW_LABELS\[SEO_SETTINGS_UNREADABLE_VIEW\]\} for details\./);
	assert.match(health, /onOpenSettings \? <Button type="button" variant="secondary" onClick=\{onOpenSettings\}>Open \{SEO_WORKSPACE_VIEW_LABELS\[SEO_SETTINGS_UNREADABLE_VIEW\]\}<\/Button> : null/);
	assert.doesNotMatch(health, /Open Search &amp; social for details/);
	const workspace = declaration(adminSource, "SeoAdminWorkspace");
	assert.match(workspace, /<ContentScoringControls onOpenSettings=\{\(\) => selectView\(SEO_SETTINGS_UNREADABLE_VIEW\)\}\s+onOpenFeatureControls=/);
	assert.match(workspace, /onClick=\{\(\) => selectView\(SEO_SETTINGS_UNREADABLE_VIEW\)\}/);
	assert.match(read("./overview-model.ts"), /actionLabel: "Review settings", view: SEO_SETTINGS_UNREADABLE_VIEW,/);
});

// Save and restore name the revision the switches started from; a conflict keeps them until Reload latest.
{
	const sent: unknown[][] = [];
	let reloads = 0;
	const hooks = new HookOwner();
	const editableKeys = new Set(["schema", "sitemap", "monitor404", "imageSeo"]);
	const complete: SeoAdminModuleConfiguration = { ...configuration, items: SEO_ADMIN_MODULE_DEFINITIONS.map((definition) =>
		module(definition.key, definition.key === "schema", editableKeys.has(definition.key))) };
	let props: Record<string, unknown> = { configuration: complete, onSaved: () => {}, onOverviewRefresh: () => Promise.resolve(),
		onReload: () => { reloads += 1; return Promise.resolve(props.configuration as SeoAdminModuleConfiguration); } };
	const render = () => { hooks.render(() => ModulesView(props)); hooks.flush(); return hooks.render(() => ModulesView(props)); };
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	let tree = render();
	const switchFor = (key: string) => elements(tree).find((node) => node.type === Switch && node.props["data-seo-setting"] === SEO_MODULE_SETTING_IDS[key])!;
	const form = () => elements(tree).find((node) => node.type === "form")!;
	const actions = () => elements(tree).find((node) => node.type === ConfigurationActions)!;
	holds.length = 0;
	switchFor("schema").props.onCheckedChange(false); tree = render();
	assert.deepEqual(holds.at(-1), ["module-switches", true], "Unsaved switches hold the page");
	// A newer configuration read while switches are unsaved keeps them and their revision.
	props = { ...props, configuration: { ...complete, revision: "rev-2", items: complete.items.map((item) => ({ ...item })) } };
	tree = render();
	assert.equal(switchFor("schema").props.checked, false, "The unsaved switch survives a newer read");
	saveModules = (...args) => { sent.push(args); return Promise.resolve({ success: false, conflict: true, errors: { _form: "Feature controls changed before the save. Nothing was overwritten." } }); };
	form().props.onSubmit({ preventDefault: () => {} }); await settle(); tree = render();
	assert.equal(sent.length, 1, "One request, no retry");
	assert.equal(sent[0]![1], "rev-1", "The save names the revision the draft started from");
	assert.equal((sent[0]![0] as Record<string, boolean>).schema, false);
	assert.equal(switchFor("schema").props.checked, false, "A conflict keeps the draft");
	const banner = elements(tree).find((node) => node.type === Banner)!;
	assert.equal(banner.props.title, "Feature controls changed elsewhere");
	assert.equal(holds.at(-1)?.[1], true, "An unresolved conflict keeps the page held");
	elements(banner.props.action).find((node) => node.type === Button)!.props.onClick(); await settle(); tree = render();
	assert.equal(reloads, 1, "Reload latest reads the stored configuration again");
	assert.equal(switchFor("schema").props.checked, true, "A read of the newer revision discards the draft explicitly");
	assert.equal(elements(tree).some((node) => node.type === Banner), false);
	assert.equal(actions().props.dirty, false);
	resetModules = (...args) => { sent.push(args); return Promise.resolve({ success: false, conflict: true, errors: { _form: "x" } }); };
	await actions().props.onRestore(); tree = render();
	assert.deepEqual(sent.at(-1), ["rev-2"], "Restore names the latest stored revision");
	// A host without revision checks keeps the switches read-only.
	props = { ...props, configuration: { ...complete, revision: null, writable: false } };
	const readOnly = new HookOwner();
	const readOnlyTree = readOnly.render(() => ModulesView(props));
	assert.equal(elements(readOnlyTree).filter((node) => node.type === Switch).every((node) => node.props.disabled === true), true);
	assert.equal(elements(readOnlyTree).find((node) => node.type === ConfigurationActions)!.props.canRestore, false);
	assert.match(text(readOnlyTree), /cannot store Feature controls with a revision check/);
	cases += 1;
}

// Each switch is named by its module; the checked state, not the name, says whether it is on.
{
	const hooks = new HookOwner();
	let tree = hooks.render(() => ModulesView({ configuration, onSaved: () => {}, onOverviewRefresh: () => Promise.resolve() }));
	const switches = () => elements(tree).filter((node) => node.type === Switch);
	assert.deepEqual(switches().map((node) => node.props["aria-label"]), ["Schema", "Sitemap", "404 Monitor", "Image alt checks"]);
	assert.deepEqual(switches().map((node) => node.props.checked), [true, false, true, true]);
	switches()[0]!.props.onCheckedChange(false); switches()[1]!.props.onCheckedChange(true);
	tree = hooks.render(() => ModulesView({ configuration, onSaved: () => {}, onOverviewRefresh: () => Promise.resolve() }));
	assert.deepEqual(switches().map((node) => node.props["aria-label"]), ["Schema", "Sitemap", "404 Monitor", "Image alt checks"], "names stay when the state changes");
	assert.doesNotMatch(configurationSource, /"Disable" : "Enable"/);
	cases += 1;
}

// A successful Save modules reports beside Save; only failures and restores use toasts.
{
	toastLog.length = 0;
	const hooks = new HookOwner();
	const editableKeys = new Set(["schema", "sitemap", "monitor404", "imageSeo"]);
	const complete: SeoAdminModuleConfiguration = { ...configuration, items: SEO_ADMIN_MODULE_DEFINITIONS.map((definition) =>
		module(definition.key, definition.key === "schema", editableKeys.has(definition.key))) };
	const saved: SeoAdminModuleConfiguration = { ...complete, revision: "rev-saved", items: complete.items.map((item) => item.key === "sitemap" ? { ...item, enabled: true } : item) };
	let requests = 0;
	saveModules = () => { requests += 1; return Promise.resolve({ success: true, modules: saved }); };
	const props = { configuration: complete, onSaved: () => {}, onOverviewRefresh: () => Promise.resolve() };
	const render = () => { hooks.render(() => ModulesView(props)); hooks.flush(); return hooks.render(() => ModulesView(props)); };
	let tree = render();
	elements(tree).find((node) => node.type === Switch && node.props["data-seo-setting"] === SEO_MODULE_SETTING_IDS.sitemap)!.props.onCheckedChange(true);
	tree = render();
	elements(tree).find((node) => node.type === "form")!.props.onSubmit({ preventDefault: () => {} });
	await new Promise((resolve) => setTimeout(resolve, 0)); tree = render();
	assert.equal(requests, 1);
	assert.equal(elements(tree).find((node) => node.type === ConfigurationActions)!.props.message, "Module settings saved", "the status beside Save reports the save");
	assert.deepEqual(toastLog, [], "no toast covers the action bar after a save");
	const sitemapSource = read("./sitemap-view.tsx");
	const sitemapSave = sitemapSource.slice(sitemapSource.indexOf("async function save()"), sitemapSource.indexOf("async function reset()"));
	assert.ok(sitemapSave.length > 0);
	assert.doesNotMatch(sitemapSave, /toasts\.success/, "Save sitemap settings reports in its status only");
	assert.match(sitemapSource, /\? `Saved \$\{readableDate\(configuration\.updatedAt\)\}\.`/, "the status beside Save names the saved time");
	cases += 1;
}

/** The error a 504 answer raises through the production request helpers. */
async function gatewayTimeout(request: (api: typeof import("./api.ts")) => Promise<unknown>): Promise<Error> {
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response("Gateway Timeout", { status: 504 })) as typeof fetch;
	try {
		await request(await import("./api.ts"));
	} catch (error) {
		assert.ok(error instanceof Error);
		assert.equal((error as Error & { status?: number }).status, 504);
		return error;
	} finally {
		globalThis.fetch = realFetch;
	}
	throw new Error("A 504 answer resolved as a save result");
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const inert = () => null;
const Dialog = Object.assign(() => null, { Root: () => null, Trigger: () => null, Title: () => null, Description: () => null, Close: () => null });
const SettingsActionBar = () => null;

// A thrown or non-2xx Save modules may have committed: the switches stay as sent, every write
// waits, and Reload latest reads the stored choices.
{
	const actionsCompiled = ts.transpileModule(["readableDate", "ConfigurationActions"].map((name) => declaration(configurationSource, name)).join("\n") +
		"\nexport { ConfigurationActions };", { fileName: "configuration-actions-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(actionsCompiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const actionsOutput = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", "React", "Dialog", "Button", "ArrowCounterClockwise", "SettingsActionBar", actionsCompiled.outputText)(
		(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, actionsOutput, actionsOutput.exports,
		localReact, Dialog, Button, icons.ArrowCounterClockwise, SettingsActionBar);
	const RealConfigurationActions = actionsOutput.exports.ConfigurationActions as (props: Record<string, unknown>) => Element;
	const editableKeys = new Set(["schema", "sitemap", "monitor404", "imageSeo"]);
	const complete: SeoAdminModuleConfiguration = { ...configuration, items: SEO_ADMIN_MODULE_DEFINITIONS.map((definition) =>
		module(definition.key, definition.key === "schema", editableKeys.has(definition.key))) };
	const failures: Array<[string, Error]> = [["TypeError", new TypeError("Failed to fetch")], ["504", await gatewayTimeout((api) =>
		api.saveSeoAdminModules(Object.fromEntries(complete.items.map((item) => [item.key, item.enabled])) as never, "rev-1"))]];
	for (const [label, failure] of failures) {
		toastLog.length = 0;
		let reloads = 0;
		let answerRead: (value: SeoAdminModuleConfiguration | null) => void = () => {};
		const onReload = () => { reloads += 1; return new Promise<SeoAdminModuleConfiguration | null>((resolve) => { answerRead = resolve; }); };
		const hooks = new HookOwner();
		let props: Record<string, unknown> = { configuration: complete, onSaved: () => {}, onOverviewRefresh: () => Promise.resolve(), onReload };
		const render = () => { hooks.render(() => ModulesView(props)); hooks.flush(); return hooks.render(() => ModulesView(props)); };
		let tree = render();
		const switchFor = (key: string) => elements(tree).find((node) => node.type === Switch && node.props["data-seo-setting"] === SEO_MODULE_SETTING_IDS[key])!;
		const form = () => elements(tree).find((node) => node.type === "form")!;
		const actions = () => elements(tree).find((node) => node.type === ConfigurationActions)!;
		switchFor("sitemap").props.onCheckedChange(true); tree = render();
		const before = writes;
		saveModules = () => Promise.reject(failure);
		form().props.onSubmit({ preventDefault: () => {} }); await settle(); tree = render();
		assert.equal(writes - before, 1);
		assert.deepEqual(toastLog, ["error: Feature controls save not confirmed"], label + ": the toast does not call the switches unsaved");
		assert.equal(switchFor("sitemap").props.checked, true, label + ": the draft is kept");
		assert.equal(switchFor("sitemap").props.disabled, true, label + ": the sent switches cannot change before the reload");
		const banner = elements(tree).find((node) => node.type === Banner)!;
		assert.equal(banner.props.title, "Feature controls save not confirmed");
		assert.match(banner.props.description, /^The change may have been saved\./);
		assert.deepEqual([actions().props.locked, actions().props.message, actions().props.dirty], [true, "Save not confirmed", true]);
		assert.equal(holds.at(-1)?.[1], true, label + ": the unknown state keeps the page held");
		const bar = new HookOwner().render(() => RealConfigurationActions(actions().props));
		assert.equal(bar.type, SettingsActionBar);
		assert.deepEqual([bar.props.saveDisabled, bar.props.discardDisabled, bar.props.status], [true, true, "Save not confirmed"],
			label + ": Save and Discard wait for the reload");
		const restore = elements(bar.props.restore).find((node) => node.type === Dialog.Trigger)!.props.render({}) as Element;
		assert.equal(restore.props.disabled, true, label + ": Restore inherited waits for the reload");
		form().props.onSubmit({ preventDefault: () => {} }); await settle();
		assert.equal(writes - before, 1, label + ": no second write before the reload");
		const reloadButton = () => elements(elements(tree).find((node) => node.type === Banner)!.props.action).find((node) => node.type === Button)!;
		const readFailure = () => elements(tree).some((node) => node.props?.role === "alert" && /could not be read/.test(String(node.props.children)));
		// While the read runs, the unknown save keeps its lock and the draft; nothing can be sent.
		reloadButton().props.onClick(); await settle(); tree = render();
		assert.equal(reloads, 1, label + ": Reload latest reads the stored configuration");
		assert.deepEqual([switchFor("sitemap").props.checked, switchFor("sitemap").props.disabled, actions().props.locked], [true, true, true],
			label + ": a slow read keeps the draft and the lock");
		form().props.onSubmit({ preventDefault: () => {} }); await settle();
		reloadButton().props.onClick(); await settle(); tree = render();
		assert.deepEqual([writes - before, reloads], [1, 1], label + ": no second write and no second read while the read runs");
		// A failed read decides nothing: the lock, the banner and the draft stay.
		answerRead(null); await settle(); tree = render();
		assert.equal(readFailure(), true, label + ": the failed read is reported");
		assert.deepEqual([switchFor("sitemap").props.checked, switchFor("sitemap").props.disabled, actions().props.locked], [true, true, true],
			label + ": a failed read keeps the draft and the lock");
		form().props.onSubmit({ preventDefault: () => {} }); await settle();
		assert.equal(writes - before, 1, label + ": no write after a failed read");
		reloadButton().props.onClick(); await settle(); tree = render();
		assert.equal(reloads, 2, label + ": Reload latest can be tried again");
		if (label === "TypeError") {
			// The same revision means the save did not land: the draft stays for an explicit Save.
			answerRead(complete); await settle(); tree = render();
			assert.equal(elements(tree).some((node) => node.type === Banner), false);
			assert.deepEqual([switchFor("sitemap").props.checked, switchFor("sitemap").props.disabled, actions().props.locked, actions().props.dirty],
				[true, false, false, true], label + ": a read of the same revision keeps the unsaved switch editable");
			saveModules = () => Promise.resolve({ success: true, modules: complete });
			form().props.onSubmit({ preventDefault: () => {} }); await settle();
			assert.equal(writes - before, 2, label + ": the next save is an explicit new write");
		} else {
			const committed = { ...complete, revision: "rev-2",
				items: complete.items.map((item) => item.key === "sitemap" ? { ...item, enabled: true } : { ...item }) };
			props = { ...props, configuration: committed };
			answerRead(committed); await settle(); tree = render();
			assert.equal(elements(tree).some((node) => node.type === Banner), false);
			assert.deepEqual([switchFor("sitemap").props.checked, switchFor("sitemap").props.disabled, actions().props.locked, actions().props.dirty],
				[true, false, false, false], label + ": a newer revision shows the stored switches");
		}
	}
	cases += 1;
}

// A thrown or non-2xx sitemap save may have committed: the choices stay as sent, every write
// waits, and Reload latest reads the stored settings.
{
	const sitemapSource = read("./sitemap-view.tsx");
	toastLog.length = 0;
	const Checkbox = () => null;
	const Textarea = () => null;
	const saves: unknown[][] = [];
	const invalidations: unknown[] = [];
	let sitemapSave: (...args: unknown[]) => Promise<unknown> = () => Promise.reject(new Error("Unexpected save"));
	const sitemapScope = {
		...icons, React: localReact, Badge, Banner, Button, Checkbox, Dialog, Empty: inert, Textarea, Select: inert, Table: inert,
		validateSeoAdminSitemapValues, publicLinkText, sitemapFileLinks, sitemapPlanSummary, seoWorkspaceKeys, SettingsActionBar, SitemapPreview: inert,
		saveSeoAdminSitemap: (...args: unknown[]) => { saves.push(args); return sitemapSave(...args); },
		resetSeoAdminSitemap: () => Promise.reject(new Error("Unexpected restore")),
		previewSeoAdminSitemap: () => Promise.reject(new Error("Unexpected preview")),
		useQuery: () => { throw new Error("Unexpected query"); },
		useQueryClient: () => ({ invalidateQueries: (options: unknown) => { invalidations.push(options); return Promise.resolve(); } }),
		useSeoToasts: () => ({ success: (title: string) => { (toastLog as string[]).push("success: " + title); }, error: (title: string) => { (toastLog as string[]).push("error: " + title); } }),
		useWorkspaceDraftHold: (key: string, held: boolean) => { holds.push([key, held]); },
		useWorkspacePageActive: () => true,
	};
	const sitemapCompiled = ts.transpileModule(["OWNER_LABELS", "ownerExplanation", "AVAILABILITY_NOTICES", "draftFrom", "excludedLines", "sameDraft", "readableDate", "PublicLink", "SitemapView"]
		.map((name) => declaration(sitemapSource, name)).join("\n") + "\nexport { SitemapView };", { fileName: "sitemap-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(sitemapCompiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const sitemapOutput = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", ...Object.keys(sitemapScope), sitemapCompiled.outputText)(
		(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, sitemapOutput, sitemapOutput.exports, ...Object.values(sitemapScope));
	const SitemapView = sitemapOutput.exports.SitemapView as (props: Record<string, unknown>) => Element;
	const sitemap = (patch: Partial<SeoAdminSitemapConfiguration> = {}): SeoAdminSitemapConfiguration => ({
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, storageVersion: SEO_ADMIN_SITEMAP_STORAGE_VERSION, engineVersion: "fixture",
		updatedAt: "2026-10-18T10:00:00.000Z", revision: "sitemap-1", settings: "saved", writable: true, moduleEnabled: true,
		owner: "shipit", ownerDetail: null, availability: "ready",
		groups: [{ key: "pages", label: "Pages", source: "saved", urlPattern: "/{slug}", unique: true },
			{ key: "posts", label: "Posts", source: "saved", urlPattern: "/blog/{slug}", unique: true }],
		values: { contentTypes: { pages: true, posts: false }, excludedPaths: [] },
		preservedKeys: [], overlaps: [], plan: null, pageSize: 1000,
		publicFiles: { origin: "https://fixture.example", sitemapUrl: "https://fixture.example/sitemap.xml", source: "site-identity" },
		...patch,
	} as SeoAdminSitemapConfiguration);
	const failures: Array<[string, Error]> = [["TypeError", new TypeError("Failed to fetch")], ["504", await gatewayTimeout((api) =>
		api.saveSeoAdminSitemap({ contentTypes: { pages: true, posts: true }, excludedPaths: [] }, "sitemap-1", false))]];
	for (const [label, failure] of failures) {
		const hooks = new HookOwner();
		let reloads = 0;
		let answerRead: (value: SeoAdminSitemapConfiguration | null) => void = () => {};
		const onReload = () => { reloads += 1; return new Promise<SeoAdminSitemapConfiguration | null>((resolve) => { answerRead = resolve; }); };
		let props: Record<string, unknown> = { configuration: sitemap(), onSaved: () => {}, onOpenModules: () => {}, onReload };
		const render = () => { hooks.render(() => SitemapView(props)); hooks.flush(); return hooks.render(() => SitemapView(props)); };
		let tree = render();
		const posts = () => elements(tree).find((node) => node.type === Checkbox && node.props.label === "Posts")!;
		const excluded = () => elements(tree).find((node) => node.type === Textarea)!;
		const bar = () => elements(tree).find((node) => node.type === SettingsActionBar)!;
		posts().props.onCheckedChange(true); tree = render();
		assert.equal(bar().props.saveDisabled, false);
		const before = saves.length;
		sitemapSave = () => Promise.reject(failure);
		bar().props.onSave(); await settle(); tree = render();
		assert.equal(saves.length - before, 1);
		assert.deepEqual(saves.at(-1)!.slice(1), ["sitemap-1", false], "The save names the revision its choices started from");
		const banners = elements(tree).filter((node) => node.type === Banner);
		assert.deepEqual(banners.map((node) => node.props.title), ["Sitemap save not confirmed"], label + ": the page does not call the choices unsaved");
		assert.match(banners[0]!.props.description, /^The change may have been saved\./);
		assert.equal(posts().props.checked, true, label + ": the draft is kept");
		assert.deepEqual([posts().props.disabled, excluded().props.disabled], [true, true], label + ": the sent choices cannot change before the reload");
		assert.match(bar().props.status, /^Save not confirmed\./);
		assert.deepEqual([bar().props.saveDisabled, bar().props.discardDisabled, bar().props.restore.props.disabled], [true, true, true],
			label + ": Save, Discard and Restore defaults wait for the reload");
		assert.deepEqual(holds.at(-1), ["sitemap-choices", true], label + ": the unknown state keeps the page held");
		bar().props.onSave(); await settle();
		assert.equal(saves.length - before, 1, label + ": no second write before the reload");
		const reloadButton = () => elements(tree).find((node) => node.type === Banner)!.props.action;
		const readFailure = () => elements(tree).some((node) => node.props?.role === "alert" && /could not be read/.test(String(node.props.children)));
		// While the read runs, the unknown save keeps its lock and the draft; nothing can be sent.
		reloadButton().props.onClick(); await settle(); tree = render();
		assert.equal(reloads, 1, label + ": Reload latest reads the stored settings");
		assert.deepEqual([posts().props.checked, posts().props.disabled, bar().props.saveDisabled], [true, true, true], label + ": a slow read keeps the draft and the lock");
		bar().props.onSave(); await settle();
		reloadButton().props.onClick(); await settle(); tree = render();
		assert.deepEqual([saves.length - before, reloads], [1, 1], label + ": no second write and no second read while the read runs");
		// A failed read decides nothing: the lock, the banner and the draft stay.
		answerRead(null); await settle(); tree = render();
		assert.equal(readFailure(), true, label + ": the failed read is reported");
		assert.deepEqual([posts().props.checked, posts().props.disabled, bar().props.saveDisabled], [true, true, true], label + ": a failed read keeps the draft and the lock");
		assert.match(bar().props.status, /^Save not confirmed\./);
		bar().props.onSave(); await settle();
		assert.equal(saves.length - before, 1, label + ": no write after a failed read");
		reloadButton().props.onClick(); await settle(); tree = render();
		assert.equal(reloads, 2, label + ": Reload latest can be tried again");
		if (label === "TypeError") {
			// The same revision means the save did not land: the draft stays for an explicit Save.
			answerRead(sitemap()); await settle(); tree = render();
			assert.equal(elements(tree).some((node) => node.type === Banner), false);
			assert.deepEqual([posts().props.checked, posts().props.disabled, bar().props.saveDisabled], [true, false, false],
				label + ": a read of the same revision keeps the unsaved choice editable");
			sitemapSave = () => Promise.resolve({ success: true, sitemap: sitemap({ revision: "sitemap-2", values: { contentTypes: { pages: true, posts: true }, excludedPaths: [] } }) });
			bar().props.onSave(); await settle();
			assert.deepEqual([saves.length - before, saves.at(-1)!.slice(1)], [2, ["sitemap-1", false]], label + ": the next save is an explicit write on the read revision");
		} else {
			const committed = sitemap({ revision: "sitemap-2", values: { contentTypes: { pages: true, posts: true }, excludedPaths: [] } });
			props = { ...props, configuration: committed };
			answerRead(committed); await settle(); tree = render();
			assert.equal(elements(tree).some((node) => node.type === Banner), false);
			assert.equal(posts().props.checked, true, label + ": Reload shows the committed choice");
			assert.equal(posts().props.disabled, false);
			assert.match(bar().props.status, /^Saved /);
		}
	}
	assert.deepEqual(toastLog, [], "A sitemap save reports on its page only");
	cases += 1;
}

console.log("Feature controls self-check passed (" + cases + " groups).");
