import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { ArrowClockwise, ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react";

import {
	COEXISTENCE_PROFILES,
	classifyNativePluginInventory,
	unavailableCoexistenceInventory,
	type CoexistenceConfiguredPlugin,
	type CoexistenceInventory,
	type CoexistenceStateRow,
} from "../plugin-coexistence.ts";
import type { SeoAdminView } from "./content-extension-model.ts";
import {
	PLUGIN_COEXISTENCE_SURFACE_LABELS,
	PLUGIN_COEXISTENCE_VIEW_SURFACES,
	pluginOverlapForView,
	pluginOverlapRows,
	type PluginCoexistenceReadState,
} from "./plugin-coexistence-model.ts";

const source = readFileSync(new URL("./plugin-coexistence-view.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("production.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string): string {
	const found = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name ||
		ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name));
	assert.equal(found.length, 1, "Exact production declaration: " + name);
	return found[0]!.getText(parsed);
}
function compile(names: string[], scope: Record<string, unknown>): Record<string, any> {
	const compiled = ts.transpileModule(names.map(declaration).join("\n") + "\nexport { " + names.join(", ") + " };", {
		fileName: "plugin-notice-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
	});
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", ...Object.keys(scope), compiled.outputText)(
		(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; },
		output, output.exports, ...Object.values(scope),
	);
	return output.exports;
}
const viewScope = { React, Banner, Button, ArrowClockwise, ArrowRight, CheckCircle, WarningCircle, PLUGIN_COEXISTENCE_SURFACE_LABELS, pluginOverlapRows };
const { PluginCoexistenceNotice, PluginOverlapText } = compile(
	["PLUGINS_MANAGER_PATH", "peerStatus", "overlapStatus", "joinNames", "surfaceList", "PluginCoexistenceNotice", "PluginOverlapText"], viewScope,
) as {
	PluginCoexistenceNotice(props: { state: PluginCoexistenceReadState; onRetry: () => void }): React.ReactElement | null;
	PluginOverlapText(props: { overlap: ReturnType<typeof pluginOverlapForView>; overview: boolean; onOpenModules: () => void }): React.ReactElement | null;
};

type Element = React.ReactElement<Record<string, unknown>>;
function elements(tree: React.ReactNode): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as Element;
	return [element, ...elements(element.props.children as React.ReactNode)];
}
function registryRow(index: number, changes: Partial<CoexistenceStateRow> = {}): CoexistenceStateRow {
	const profile = COEXISTENCE_PROFILES[index]!;
	return { id: profile.runtimeId, source: "registry", status: "active", version: profile.assessedVersion,
		publisherDid: profile.publisherDid, slug: profile.slug, ...changes };
}
function inventory(rows: CoexistenceStateRow[] = [], configured: CoexistenceConfiguredPlugin[] = []) {
	const result = classifyNativePluginInventory({ configured, rows });
	assert.equal(result.status, "available");
	if (result.status !== "available") throw new Error("Expected available classifier fixture");
	return result;
}
const ready = (value: CoexistenceInventory): PluginCoexistenceReadState => ({ status: "ready", inventory: value });
let retries = 0;
function render(state: PluginCoexistenceReadState) {
	const tree = PluginCoexistenceNotice({ state, onRetry: () => { retries += 1; } });
	const html = renderToStaticMarkup(tree);
	return { tree, html, firstView: html.split("<details")[0] };
}
function closedDetails(html: string): void {
	const tags = html.match(/<details\b[^>]*>/g) ?? [];
	assert.equal(tags.length, 1, "Diagnostic detail has one disclosure");
	assert.doesNotMatch(tags[0], /\sopen(?:\s|=|>)/, "Diagnostic detail starts closed");
	assert.match(html, /<summary>Compatibility details<\/summary>/);
}
function actions(tree: React.ReactNode): Element {
	const nodes = elements(tree);
	const links = nodes.filter((node) => node.type === "a");
	assert.equal(links.length, 1, "One Manage plugins link");
	assert.equal(links[0].props.href, "/_emdash/admin/plugins-manager");
	assert.equal(links[0].props.children, "Manage plugins");
	const buttons = nodes.filter((node) => node.type === Button);
	assert.equal(buttons.length, 1, "One Check again action and nothing that changes another plugin");
	assert.equal(buttons[0].props.children, "Check again");
	assert.equal(buttons[0].props.type, "button");
	return buttons[0];
}
const allActive = () => {
	const value = inventory(COEXISTENCE_PROFILES.map((_, index) => registryRow(index)), [
		{ id: "configured-moorage", entrypoint: "@moorage/plugin-seo/sandbox", version: "0.1.4" },
	]);
	for (const peer of value.peers) { Object.freeze(peer.surfaces); Object.freeze(peer); }
	Object.freeze(value.peers); Object.freeze(value.paused); Object.freeze(value);
	return value;
};
let groups = 0;
function check(run: () => void): void { run(); groups += 1; }

check(() => {
	for (const value of [
		inventory(),
		inventory(COEXISTENCE_PROFILES.map((_, index) => registryRow(index, { status: "inactive", version: "99" }))),
		inventory([registryRow(3)]),
	]) {
		assert.deepEqual(value.paused, []);
		const { tree, html } = render(ready(value));
		assert.match(html, /No overlapping SEO plugins found\./, "A clear result says so in one positive line");
		assert.doesNotMatch(html, /Moorage SEO|SEO Suite|Instant Indexer|Page SEO Inspector|Not installed|Inactive|<details\b|<a\b/,
			"Absent, inactive and non-overlapping plugins are never listed");
		const buttons = elements(tree).filter((node) => node.type === Button);
		assert.equal(buttons.length, 1); assert.equal(buttons[0].props.children, "Check again");
		assert.equal(elements(tree).filter((node) => node.type === Banner).length, 0, "A clear state is not a warning");
	}
	assert.equal(retries, 0);
	const { tree } = render(ready(inventory()));
	(elements(tree).find((node) => node.type === Button)!.props.onClick as () => void)();
	assert.equal(retries, 1, "Check again on the clear line requests a fresh read");
	retries = 0;
});

check(() => {
	const value = allActive();
	const rows = pluginOverlapRows(value);
	assert.deepEqual(rows.map((row) => [row.name, row.versions, row.assessment, row.versionUnassessed, row.surfaces]), [
		["Moorage SEO", ["0.1.4"], "observed-overlap", false, ["robots", "schema"]],
		["SEO Suite", ["0.2.0"], "potential-overlap", false, ["metadata", "robots", "schema"]],
		["Instant Indexer", ["1.0.1"], "potential-overlap", false, ["indexnow"]],
	], "One row per overlapping plugin; a registry and configured copy share a row");
	const { tree, html, firstView } = render(ready(value));
	assert.equal(elements(tree).filter((node) => node.type === Banner).length, 1, "One warning heads the rows");
	assert.equal(elements(tree).filter((node) => node.type === "aside").length, 1);
	assert.doesNotMatch(html, /Other SEO plugins|Checked catalog|<h2\b|<section\b/);
	assert.match(firstView, /Overlapping SEO plugins detected/);
	const items = elements(tree).filter((node) => node.type === "li" && elements(node).some((child) => child.props.className === "shipit-seo-plugin-notice__name"));
	assert.deepEqual(items.map((item) => renderToStaticMarkup(item)), [
		'<li><div class="shipit-seo-plugin-notice__name"><strong>Moorage SEO</strong><span>0.1.4</span><span>Output overlap</span></div><p>Paused in this plugin: Robots meta tags, Schema</p></li>',
		'<li><div class="shipit-seo-plugin-notice__name"><strong>SEO Suite</strong><span>0.2.0</span><span>Potential overlap</span></div><p>Paused in this plugin: Search &amp; social, Robots meta tags, Schema</p></li>',
		'<li><div class="shipit-seo-plugin-notice__name"><strong>Instant Indexer</strong><span>1.0.1</span><span>Potential overlap</span></div><p>Paused in this plugin: IndexNow</p></li>',
	]);
	assert.equal(firstView.match(/Moorage SEO/g)?.length, 1, "A registry/config pair names its plugin only once");
	assert.match(firstView, /Deactivate one of the overlapping plugins in the plugins manager, then check again/);
	assert.doesNotMatch(firstView, /Page SEO Inspector|Google combines|Inspection tool/);
	closedDetails(html);
	assert.match(html, /Page SEO Inspector<\/strong> 0\.1\.1: Inspection tool/, "Active non-overlapping plugins stay in the details");
	assert.doesNotMatch(html, /Paused features in this plugin/, "Rows already name the paused features");
	assert.match(html, /Readable saved robots restrictions are carried separately/);
	assert.match(html, /Google combines restrictive rules across tags; other crawlers may differ/);
	assert.match(html, /Other plugins and theme markup may overlap/);
	const retry = actions(tree);
	assert.equal(retries, 0, "Rendering a notice sends no retry");
	(retry.props.onClick as () => void)();
	assert.equal(retries, 1, "Only the actual Check again callback requests a retry");
});

check(() => {
	const { tree, html, firstView } = render(ready(inventory([registryRow(3, { version: "99" })])));
	assert.match(firstView, /Some plugins are not assessed/);
	assert.doesNotMatch(firstView, /Overlapping|conflict|Deactivate|This plugin pauses|Paused in this plugin/);
	assert.match(html, /Page SEO Inspector<\/strong> 99: Unassessed version/);
	assert.doesNotMatch(html, /Paused features in this plugin/);
	closedDetails(html); actions(tree);
});

check(() => {
	for (const count of [1, 2]) {
		const value = inventory([], Array.from({ length: count }, (_, index) => ({
			id: `other-${index}`, entrypoint: `./unassessed-${index}.mjs`, version: "1",
		})));
		assert.equal(value.uncheckedConfiguredCount, count);
		const { tree, html, firstView } = render(ready(value));
		assert.match(firstView, /Some plugins are not assessed/);
		assert.doesNotMatch(firstView, /Overlapping|conflict|Deactivate|This plugin pauses/);
		assert.ok(html.includes(`${count} configured ${count === 1 ? "plugin is" : "plugins are"} outside this catalog.`));
		assert.doesNotMatch(html, /Paused features in this plugin|No overlapping/);
		closedDetails(html); actions(tree);
	}
});

check(() => {
	const { html, firstView } = render(ready(inventory([registryRow(0, { version: "99" })])));
	assert.match(firstView, /Overlapping SEO plugin detected/);
	assert.match(firstView, /<strong>Moorage SEO<\/strong><span>99<\/span><span>Potential overlap \(unassessed version\)<\/span>/);
	closedDetails(html);
});

check(() => {
	const { tree, html } = render({ status: "loading" });
	assert.match(html, /role="status"/);
	assert.match(html, /Checking SEO plugin compatibility/);
	assert.doesNotMatch(html, /compatible|No active|No overlapping|Checked catalog|<aside\b|<details\b/);
	assert.equal(elements(tree).filter((node) => node.type === Button || node.type === Banner).length, 0);
});

check(() => {
	for (const [kind, message] of [
		["denied", "You need permission to read plugin status."],
		["timeout", "The check timed out. Try again when ready."],
		["unavailable", "Plugin status could not be verified. Check again when ready."],
	] as const) {
		const { tree, html } = render({ status: "error", kind, message });
		assert.ok(html.includes(kind === "denied" ? "Plugin access required" : "Plugin status not verified"));
		assert.ok(html.includes(message));
		assert.doesNotMatch(html, /Moorage SEO|Paused features in this plugin|Paused in this plugin|Deactivate|<details\b|No active|No overlapping/,
			"A failed current read cannot retain the preceding overlap result or claim a clear state");
		actions(tree);
	}
});

check(() => {
	const value = unavailableCoexistenceInventory("A fresh inventory could not be read.");
	const { tree, html, firstView } = render(ready(value));
	assert.match(firstView, /SEO compatibility check unavailable/);
	assert.match(firstView, /This plugin pauses overlapping output until plugin status can be checked/);
	assert.match(html, /A fresh inventory could not be read\./);
	assert.match(html, /Paused features in this plugin: Search &amp; social, Robots meta tags, Schema, IndexNow\./);
	assert.doesNotMatch(firstView, /Deactivate|No active|No overlapping|compatible/);
	closedDetails(html); actions(tree);
});

check(() => {
	const { tree, html } = render({ status: "ready", inventory: {
		status: "unsupported", scope: "checked-catalog", message: "Native inventory is unavailable on this host.",
	} });
	assert.match(html, /Compatibility checks unavailable on this host/);
	assert.match(html, /Native inventory is unavailable on this host\./);
	assert.doesNotMatch(html, /Deactivate|Paused features in this plugin|<details\b|No active|No overlapping/);
	actions(tree);
});

// Compact notices: only an active overlap, only on Overview and the pages it pauses.
check(() => {
	assert.deepEqual(PLUGIN_COEXISTENCE_VIEW_SURFACES, {
		social: ["metadata"], templates: ["metadata"], indexing: ["robots"], schema: ["schema"], library: ["schema"], indexnow: ["indexnow"],
	});
	const state = ready(allActive());
	let opened = 0;
	const line = (view: SeoAdminView, value: PluginCoexistenceReadState = state) => {
		const tree = PluginOverlapText({ overlap: pluginOverlapForView(value, view), overview: view === "overview", onOpenModules: () => { opened += 1; } });
		return { tree, html: renderToStaticMarkup(tree) };
	};
	const overview = line("overview");
	assert.match(overview.html, /Overlapping SEO plugins are active: Moorage SEO, SEO Suite and Instant Indexer\. Paused in this plugin: Search &amp; social, Robots meta tags, Schema, IndexNow\./);
	assert.match(overview.html, /^<div class="shipit-seo-overlap-line" role="status">/, "The notice is one compact status line");
	assert.match(line("schema").html, /Paused while Moorage SEO and SEO Suite are active: Schema\./);
	assert.match(line("library").html, /Paused while Moorage SEO and SEO Suite are active: Schema\./);
	assert.match(line("indexing").html, /Paused while Moorage SEO and SEO Suite are active: Robots meta tags\./);
	assert.match(line("social").html, /Paused while SEO Suite is active: Search &amp; social\./);
	assert.match(line("indexnow").html, /Paused while Instant Indexer is active: IndexNow\./);
	for (const view of ["sitemap", "robots", "modules", "crawl", "queue"] as const) assert.equal(line(view).tree, null, view + " shows no overlap notice");
	const indexerOnly = ready(inventory([registryRow(2)]));
	assert.equal(line("schema", indexerOnly).tree, null, "A page whose surface is not paused shows nothing");
	assert.match(line("overview", indexerOnly).html, /An overlapping SEO plugin is active: Instant Indexer\. Paused in this plugin: IndexNow\./);
	for (const quiet of [ready(inventory()), ready(inventory([registryRow(3)])), ready(unavailableCoexistenceInventory()),
		{ status: "loading" } as const, { status: "error", kind: "timeout", message: "x" } as const]) {
		assert.equal(line("overview", quiet).tree, null, "No overlap, a failed or an unavailable check shows no compact notice");
	}
	const review = elements(overview.tree).find((node) => node.type === Button)!;
	assert.equal(review.props.children, "Review"); assert.equal(review.props["aria-label"], "Review in Feature controls");
	(review.props.onClick as () => void)(); assert.equal(opened, 1, "Review opens Feature controls");
	assert.equal(elements(overview.tree).filter((node) => node.type === "a").length, 0, "The compact notice has no action on another plugin");
});

// The compact notice mounts its reader only where it can apply.
check(() => {
	const Content = () => null;
	const { PluginOverlapLine } = compile(["PluginOverlapLine"], { PLUGIN_COEXISTENCE_VIEW_SURFACES, PluginOverlapLineContent: Content });
	for (const view of ["sitemap", "robots", "modules", "queue", "crawl"] as const) assert.equal(PluginOverlapLine({ view, onOpenModules: () => {} }), null);
	for (const view of ["overview", "social", "templates", "indexing", "schema", "library", "indexnow"] as const) {
		assert.equal(PluginOverlapLine({ view, onOpenModules: () => {} })?.type, Content, view + " mounts the shared reader");
	}
});

// One shared read serves every notice; Feature controls and Check again read again.
check(() => {
	let loads = 0; let onState: ((state: PluginCoexistenceReadState) => void) | null = null;
	const createPluginCoexistenceReader = (options: { onState: (state: PluginCoexistenceReadState) => void }) => {
		onState = options.onState;
		return { load: async () => { loads += 1; }, dispose: () => {} };
	};
	const fakeReact = {
		useSyncExternalStore: (subscribe: (listener: () => void) => () => void, snapshot: () => PluginCoexistenceReadState) => {
			subscribe(() => {}); return snapshot();
		},
		useEffect: (effect: () => void) => { effect(); },
	};
	const store = compile(["sharedState", "sharedRequested", "sharedReader", "sharedListeners", "coexistenceReader", "subscribeCoexistence", "coexistenceSnapshot", "usePluginCoexistence"],
		{ React: fakeReact, createPluginCoexistenceReader, readPluginCoexistence: () => Promise.resolve(null) });
	const first = store.usePluginCoexistence(false); const second = store.usePluginCoexistence(false);
	assert.equal(loads, 1, "Two compact notices share one read");
	assert.equal(first.state.status, "loading"); assert.equal(second.state.status, "loading");
	onState!({ status: "ready", inventory: allActive() });
	assert.equal(store.usePluginCoexistence(false).state.status, "ready", "Later notices reuse the shared result");
	assert.equal(loads, 1);
	store.usePluginCoexistence(true); assert.equal(loads, 2, "Feature controls reads again");
	first.retry(); assert.equal(loads, 3, "Check again reads again");
});

assert.equal(source.match(/apiFetch\(/g)?.length, 1, "The view sends only the inventory read");
assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)|deactivatePlugin|disablePlugin|importPlugin|fetchSettings|updateSettings/,
	"Nothing in Shipit changes another plugin or imports its data");
assert.match(declaration("PluginCoexistenceView"), /usePluginCoexistence\(true\)/);
assert.match(declaration("PluginOverlapLineContent"), /usePluginCoexistence\(false\)/);
assert.equal(retries, 1, "No state transition implicitly triggers the explicit retry action");

console.log("Plugin coexistence production notice checks passed (" + groups + " groups).");
