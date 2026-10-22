import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import * as banner from "@cloudflare/kumo/components/banner";
import * as button from "@cloudflare/kumo/components/button";
import * as collapsible from "@cloudflare/kumo/components/collapsible";
import * as input from "@cloudflare/kumo/components/input";
import * as select from "@cloudflare/kumo/components/select";
import * as contract from "@shipitseo/emdash-plugin-seo/admin-contract";

import * as authoringCodec from "./entry-schema-authoring.ts";
import { OWN_TABLIST_SELECTOR, WRAPPING_TABS, WRAPPING_UNDERLINE_TABS } from "./workspace-tabs.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./admin.css");
const editorCss = read("./content-editor.css");
const views = Object.fromEntries(readdirSync(new URL("./", import.meta.url))
	.filter((file) => file.endsWith(".tsx"))
	.map((file) => [file, read("./" + file)]));
let cases = 0;
function check(name: string, run: () => void) {
	try { run(); } catch (error) { throw new Error(name + ": " + (error instanceof Error ? error.message : String(error))); }
	cases += 1;
}
/** The body of the first rule whose selector list is exactly `selector`, inside `scope` when given. */
function rule(selector: string, scope = css): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = new RegExp(`(?:^|\\n)\\t*${escaped}\\s*\\{([^}]*)\\}`).exec(scope)?.[1];
	assert.ok(found, "rule exists: " + selector);
	return found;
}
/** The body of the `@container shipit-seo-workspace (max-width: N)` blocks, joined. */
function workspaceQuery(maxWidth: number): string {
	const blocks: string[] = [];
	const opener = `@container shipit-seo-workspace (max-width: ${maxWidth}px) {`;
	for (let at = css.indexOf(opener); at >= 0; at = css.indexOf(opener, at + 1)) {
		let depth = 0;
		for (let index = at + opener.length - 1; index < css.length; index += 1) {
			if (css[index] === "{") depth += 1;
			if (css[index] === "}") depth -= 1;
			if (depth === 0) { blocks.push(css.slice(at + opener.length, index)); break; }
		}
	}
	assert.ok(blocks.length, "container query exists: " + maxWidth);
	return blocks.join("\n");
}

/** An element with the content-box inline size its container queries measure. */
type LayoutNode = { tag: string; classes: string[]; attrs: Record<string, string>; width: number };
type Compound = { tag?: string; classes: string[]; attrs: [string, string | undefined][]; child: boolean };
const stylesheets = Object.fromEntries(readdirSync(new URL("./", import.meta.url))
	.filter((file) => file.endsWith(".css"))
	.map((file) => [file, read("./" + file)]));
function splitTopLevel(list: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < list.length; index += 1) {
		if ("([".includes(list[index]!)) depth += 1;
		else if (")]".includes(list[index]!)) depth -= 1;
		else if (list[index] === "," && depth === 0) { parts.push(list.slice(start, index).trim()); start = index + 1; }
	}
	return [...parts, list.slice(start).trim()];
}
function compounds(selector: string): Compound[] | null {
	const steps: Compound[] = [];
	let child = false;
	for (const token of selector.replace(/\s*>\s*/g, " > ").trim().split(/\s+/)) {
		if (token === ">") { child = true; continue; }
		const match = /^(\*|[a-z][a-z0-9]*)?((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/.exec(token);
		if (!match || !(match[1] || match[2])) return null;
		steps.push({
			tag: match[1] === "*" ? undefined : match[1],
			classes: [...match[2]!.matchAll(/\.([\w-]+)/g)].map((found) => found[1]!),
			attrs: [...match[2]!.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((found) => [found[1]!, found[2]] as [string, string | undefined]),
			child,
		});
		child = false;
	}
	return steps;
}
/** `selector` with each pseudo-class dropped, which matches a superset of it; null for a pseudo-element or what the model cannot parse. */
function widened(selector: string): Compound[] | null {
	if (selector.includes("::")) return null;
	let text = "";
	for (let index = 0; index < selector.length;) {
		if (selector[index] === "[") {
			const end = selector.indexOf("]", index);
			if (end < 0) return null;
			text += selector.slice(index, end + 1);
			index = end + 1;
		} else if (selector[index] === ":") {
			if (!text.trim() || /[\s>]$/.test(text)) text += "*";
			for (index += 1; /[\w-]/.test(selector[index] ?? ""); index += 1);
			for (let depth = 0; selector[index] === "(" || depth > 0; index += 1) {
				if (index >= selector.length) return null;
				depth += selector[index] === "(" ? 1 : selector[index] === ")" ? -1 : 0;
			}
		} else {
			text += selector[index];
			index += 1;
		}
	}
	return compounds(text);
}
const cascadeRules = Object.entries(stylesheets).flatMap(([file, source]) => {
	const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const found: { file: string; selectors: { text: string; steps: Compound[] | null; wide: Compound[] | null; specificity: number }[]; body: string; conditions: string[] }[] = [];
	const walk = (from: number, conditions: string[]): number => {
		for (let at = from; ;) {
			const open = text.indexOf("{", at);
			const close = text.indexOf("}", at);
			if (close >= 0 && (open < 0 || close < open)) return close + 1;
			if (open < 0) return text.length;
			const prelude = text.slice(at, open).split(";").at(-1)!.trim();
			if (prelude.startsWith("@")) { at = walk(open + 1, [...conditions, prelude]); continue; }
			const end = text.indexOf("}", open);
			found.push({ file, body: text.slice(open + 1, end), conditions, selectors: splitTopLevel(prelude).map((selector) => {
				const steps = compounds(selector);
				return { text: selector, steps, wide: steps ? null : widened(selector), specificity: steps?.reduce((sum, step) => sum + 100 * (step.classes.length + step.attrs.length) + (step.tag ? 1 : 0), 0) ?? 0 };
			}) });
			at = end + 1;
		}
	};
	walk(0, []);
	return found;
}).map((rule, order) => ({ ...rule, order, values: declarations(rule.body) }));
const rulesByProperty = new Map<string, typeof cascadeRules>();
for (const rule of cascadeRules) {
	for (const property of rule.values.keys()) rulesByProperty.set(property, rulesByProperty.get(property) ?? []).get(property)!.push(rule);
}
/** The last value of each property in `body`, with the container shorthand expanded. */
function declarations(body: string): Map<string, string> {
	const values = new Map<string, string>();
	for (const declaration of body.split(";")) {
		const colon = declaration.indexOf(":");
		if (colon < 0) continue;
		const name = declaration.slice(0, colon).trim();
		const value = declaration.slice(colon + 1).trim();
		if (name !== "container") { values.set(name, value); continue; }
		const [names = "none", type = "normal"] = value.split("/").map((part) => part.trim());
		values.set("container-name", names);
		values.set("container-type", type);
	}
	return values;
}
function compoundMatches(step: Compound, node: LayoutNode): boolean {
	return (!step.tag || step.tag === node.tag) && step.classes.every((name) => node.classes.includes(name)) &&
		step.attrs.every(([name, value]) => Object.hasOwn(node.attrs, name) && (value === undefined || node.attrs[name] === value));
}
function selectorMatches(steps: Compound[], chain: LayoutNode[], index: number, step = steps.length - 1): boolean {
	if (!compoundMatches(steps[step]!, chain[index]!)) return false;
	if (step === 0) return true;
	if (steps[step]!.child) return index > 0 && selectorMatches(steps, chain, index - 1, step - 1);
	for (let ancestor = index - 1; ancestor >= 0; ancestor -= 1) if (selectorMatches(steps, chain, ancestor, step - 1)) return true;
	return false;
}
/** Whether a selector this model cannot match might still select `node` at rest. */
function unsupportedReaches(selector: string, node: LayoutNode): boolean {
	const last = splitTopLevel(selector.replace(/\s*[>+~]\s*|\s+/g, ",")).at(-1)!;
	if (/:(?:hover|focus|focus-visible|focus-within|active|disabled|checked|visited)\b|::/.test(last.replace(/:not\([^()]*\)/g, ""))) return false;
	const [, tag, classes = ""] = /^(\*|[a-z][a-z0-9]*)?((?:\.[\w-]+)*)/.exec(last)!;
	return (!tag || tag === "*" || tag === node.tag) && [...classes.matchAll(/\.([\w-]+)/g)].every((found) => node.classes.includes(found[1]!));
}
function conditionHolds(prelude: string, chain: LayoutNode[], index: number, viewport: number): boolean | undefined {
	if (/^@keyframes\b|^@media \(prefers-/.test(prelude)) return false;
	const query = /^@(container|media)(?: ([\w-]+))? \((min|max)-width: ([\d.]+)(px|rem)\)$/.exec(prelude);
	if (!query) return undefined;
	const [, kind, name, bound, amount, unit] = query;
	const limit = Number(amount) * (unit === "rem" ? 16 : 1);
	const within = (width: number) => bound === "max" ? width <= limit : width >= limit;
	if (kind === "media") return name ? undefined : within(viewport);
	for (let ancestor = index - 1; ancestor >= 0; ancestor -= 1) {
		if (!["inline-size", "size"].includes(computedStyle(chain, ancestor, "container-type", viewport))) continue;
		if (name && !computedStyle(chain, ancestor, "container-name", viewport).split(/\s+/).includes(name)) continue;
		return within(chain[ancestor]!.width);
	}
	return false;
}
/** The cascaded value of `property` on `chain[index]`, from every admin stylesheet. */
function computedStyle(chain: LayoutNode[], index: number, property: string, viewport: number): string {
	let winner: { value: string; specificity: number; order: number } | undefined;
	for (const rule of rulesByProperty.get(property) ?? []) {
		const value = rule.values.get(property)!;
		for (const selector of rule.selectors) {
			if (!selector.steps) {
				if (selector.wide && !selectorMatches(selector.wide, chain, index)) continue;
				assert.ok(!unsupportedReaches(selector.text, chain[index]!), `${rule.file} reaches the ${property} model through an unsupported selector: ${selector.text}`);
				continue;
			}
			if (!selectorMatches(selector.steps, chain, index)) continue;
			const holds = rule.conditions.map((prelude) => conditionHolds(prelude, chain, index, viewport));
			assert.ok(!holds.includes(undefined), `${rule.file} reaches the ${property} model through an unsupported condition: ${rule.conditions.join(" ")}`);
			if (holds.includes(false)) continue;
			assert.equal(rule.file, "admin.css", `only admin.css sets ${property} here, so stylesheet order cannot change it: ${selector.text}`);
			assert.ok(!value.includes("!important"), `${property} is not forced: ${selector.text}`);
			if (!winner || selector.specificity > winner.specificity || (selector.specificity === winner.specificity && rule.order > winner.order)) {
				winner = { value, specificity: selector.specificity, order: rule.order };
			}
		}
	}
	return winner?.value ?? (property === "container-type" ? "normal" : "none");
}
function trackCount(value: string): number {
	const repeated = /^repeat\((\d+),/.exec(value);
	if (repeated) return Number(repeated[1]);
	return splitTopLevel(value.replace(/\s+(?![^(]*\))/g, ",")).length;
}
const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
/** The ancestors, from the root, of each element in `markup` that carries `className` or satisfies `match`, ending with that element. */
function renderedChains(markup: string, match: string | ((node: Omit<LayoutNode, "width">) => boolean)): Omit<LayoutNode, "width">[][] {
	const matches = typeof match === "string" ? (node: Omit<LayoutNode, "width">) => node.classes.includes(match) : match;
	const stack: Omit<LayoutNode, "width">[] = [];
	const chains: Omit<LayoutNode, "width">[][] = [];
	for (const [, closing, tag, attributes, selfClosing] of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
		if (closing) { assert.equal(stack.pop()?.tag, tag, "the rendered markup is balanced"); continue; }
		const attrs = Object.fromEntries([...attributes!.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map((found) => [found[1]!, found[2] ?? ""]));
		const node = { tag: tag!, classes: (attrs.class ?? "").split(/\s+/).filter(Boolean), attrs };
		if (matches(node)) chains.push([...stack, node]);
		if (!selfClosing && !VOID_ELEMENTS.has(tag!)) stack.push(node);
	}
	assert.equal(stack.length, 0, "every rendered element closes");
	return chains;
}
/** The shipped authoring controls with their optional details open. */
function renderAuthoringControls(props: Record<string, unknown>): string {
	const compiled = ts.transpileModule(read("./entry-schema-authoring-controls.tsx"), {
		fileName: "entry-schema-authoring-controls.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
	});
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const Root = (rootProps: object) => React.createElement(collapsible.Collapsible.Root, { ...rootProps, defaultOpen: true });
	const modules: Record<string, unknown> = {
		"@phosphor-icons/react": icons,
		"@cloudflare/kumo/components/banner": banner,
		"@cloudflare/kumo/components/button": button,
		"@cloudflare/kumo/components/collapsible": { Collapsible: Object.assign(Root, collapsible.Collapsible, { Root }) },
		"@cloudflare/kumo/components/input": input,
		"@cloudflare/kumo/components/select": select,
		"@shipitseo/emdash-plugin-seo/admin-contract": contract,
		"./entry-schema-authoring.ts": authoringCodec,
	};
	const output = { exports: {} as Record<string, unknown> };
	const requireReact = createRequire(import.meta.resolve("react"));
	new Function("require", "module", "exports", compiled.outputText)((name: string) => {
		if (Object.hasOwn(modules, name)) return modules[name];
		assert.ok(name === "react" || name === "react/jsx-runtime", "unexpected production import: " + name);
		return requireReact(name);
	}, output, output.exports);
	const Controls = output.exports.EntrySchemaAuthoringControls as React.ComponentType<Record<string, unknown>>;
	return renderToStaticMarkup(React.createElement(Controls, { disabled: false, onModeChange() {}, onChooseType() {}, onPatch() {}, ...props }));
}

check("Local SEO Review tracks cannot widen past the panel", () => {
	assert.match(rule(".shipit-seo-identity-form,\n.shipit-seo-identity-step,\n.shipit-seo-identity-stack"), /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
	const narrow = workspaceQuery(560);
	assert.match(narrow, /\.shipit-seo-identity-stack > \.shipit-seo-details div \{\s*grid-template-columns: minmax\(0, 1fr\);/,
		"each Review fact puts its value under its label at narrow widths");
	assert.match(narrow, /\.shipit-seo-identity-stack > \.shipit-seo-details dd \{\s*text-align: left;/);
	assert.match(rule(".shipit-seo-details__note"), /display: block;[\s\S]*font-weight: 400;/, "the ID note sits on its own line in regular weight");
	const identity = views["business-identity-view.tsx"]!;
	assert.equal((identity.match(/<span className="shipit-seo-muted shipit-seo-details__note">Kept from /g) ?? []).length, 2);
	assert.doesNotMatch(identity, /<span className="shipit-seo-muted"> Kept from/, "no bold explanation runs on after the Entity ID");
});

check("Local SEO Next and the Review save are primary", () => {
	const identity = views["business-identity-view.tsx"]!;
	assert.match(identity, /<Button type="submit" variant="primary" icon=\{FloppyDisk\} loading=\{state\.pending === "save" \|\| state\.pending === "replace"\}/);
	assert.match(identity, /type="button"\s+variant="primary"\s+icon=\{ArrowRight\}\s+disabled=\{stepIndex >= IDENTITY_STEPS\.length - 1\}/);
});

check("confirmation dialogs share one padded layout with a heading title", () => {
	let dialogs = 0;
	for (const [file, source] of Object.entries(views)) {
		for (const match of source.matchAll(/<Dialog size="sm"[^>]*>/g)) {
			dialogs += 1;
			assert.match(match[0], /className="shipit-seo-delete-dialog"/, file + " dialog uses the shared confirmation layout");
		}
	}
	assert.ok(dialogs >= 12, "control: the scan finds the workspace confirmations (" + dialogs + ")");
	assert.doesNotMatch('<Dialog size="sm">', /className="shipit-seo-delete-dialog"/, "control: an unstyled dialog would fail");
	assert.match(rule(".shipit-seo-delete-dialog"), /padding: 20px;/);
	assert.match(rule(".shipit-seo-delete-dialog > h2"), /font-size: 16px;[\s\S]*font-weight: 600;/);
	assert.match(views["admin.tsx"]!, /<Dialog size="sm" className="shipit-seo-delete-dialog">\s*<Dialog\.Title>Restore inherited SEO settings\?/);
	assert.match(views["sitemap-view.tsx"]!, /<Dialog size="sm" className="shipit-seo-delete-dialog">\s*<Dialog\.Title>Restore sitemap defaults\?/);
	assert.match(views["configuration-views.tsx"]!, /<Dialog size="sm" className="shipit-seo-delete-dialog">\s*<Dialog\.Title>\{restoreTitle\}<\/Dialog\.Title>/,
		"Feature controls and Schema defaults restore");
});

check("the Work queue filters follow the workspace width", () => {
	assert.match(workspaceQuery(840), /\.shipit-seo-queue-filters \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*\.shipit-seo-queue-filters > :first-child \{\s*grid-column: 1 \/ -1;/);
	assert.match(workspaceQuery(560), /\.shipit-seo-queue-filters \{\s*grid-template-columns: minmax\(0, 1fr\);/);
	// The base track minimums need 742px: wider than the 1280px workspace column, which is under 840px.
	assert.match(rule(".shipit-seo-queue-filters"), /grid-template-columns: minmax\(220px, 1\.5fr\) repeat\(3, minmax\(150px, 0\.75fr\)\);/);
	assert.ok(css.indexOf("@container shipit-seo-workspace (max-width: 840px) {\n\t.shipit-seo-queue-filters") > css.indexOf("@media (max-width: 680px)"),
		"the workspace rules come after the viewport rules they refine");
	const queue = views["work-queue-view.tsx"]!;
	assert.equal((queue.match(/className="shipit-seo-queue-banner shipit-seo-queue-intro"/g) ?? []).length, 2);
	assert.match(queue, /<div className="shipit-seo-queue-actions">\s*<Button type="button" variant="primary"/);
	assert.match(rule(".shipit-seo-queue-intro > p"), /font-size: 13px;/, "one body size for the intro");
	assert.match(rule(".shipit-seo-queue-intro > p.shipit-seo-queue-limit"), /text-align: start;/, "helpers align with the intro");
	assert.match(rule(".shipit-seo-queue-actions"), /display: flex;[\s\S]*gap: 8px;/);
	assert.doesNotMatch(rule(".shipit-seo-queue-actions"), /space-between/, "Reset session no longer wraps alone at the far edge");
});

check("workspace tab strips wrap instead of hiding tabs", () => {
	assert.deepEqual(WRAPPING_TABS, { className: "shipit-seo-tabs-wrap", listClassName: "shipit-seo-tabs-wrap__list" });
	assert.equal(WRAPPING_UNDERLINE_TABS.indicatorClassName, "shipit-seo-tabs-wrap__underline");
	const strips = [
		["not-found-view.tsx", "segmented"], ["indexnow-view.tsx", "underline"], ["core-404-activity-view.tsx", "segmented"],
		["crawl-diagnostics-view.tsx", "segmented"], ["configuration-views.tsx", "segmented"], ["business-identity-view.tsx", "underline"],
	] as const;
	for (const [file, variant] of strips) {
		const source = views[file]!;
		const spread = variant === "underline" ? "WRAPPING_UNDERLINE_TABS" : "WRAPPING_TABS";
		const tabs = [...source.matchAll(/<Tabs\b[\s\S]*?\/>/g)].map((match) => match[0]).filter((tab) => !tab.includes("shipit-seo-identity-tabs"));
		assert.ok(tabs.length > 0, file);
		for (const tab of tabs) assert.ok(tab.includes(`variant="${variant}"`) && tab.includes(`{...${spread}}`), file + " spreads " + spread);
	}
	const narrow = workspaceQuery(560);
	assert.match(narrow, /\.shipit-seo-tabs-wrap > \.shipit-seo-tabs-wrap__list \{\s*flex-wrap: wrap;\s*height: auto;\s*min-height: 36px;\s*overflow: visible;/);
	assert.match(narrow, /\.shipit-seo-tabs-wrap > \.shipit-seo-tabs-wrap__list > \[role="tab"\] \{\s*min-height: 32px;/, "wrapped rows keep the single-row tab height");
	assert.match(narrow, /\.shipit-seo-tabs-wrap__underline \{\s*top: calc\(var\(--active-tab-top\) \+ var\(--active-tab-height\) - 2px\);\s*bottom: auto;/,
		"the underline follows the active tab onto its row");
});

check("workspace tab strips are named for assistive technology", () => {
	assert.equal(OWN_TABLIST_SELECTOR, ':scope > .shipit-seo-tabs-wrap > [role="tablist"]', "only the strip directly inside the container is named");
	const tabsSource = read("./workspace-tabs.ts");
	assert.match(tabsSource, /React\.useLayoutEffect\(\(\) => \{\n\t\tref\.current\?\.querySelector\(OWN_TABLIST_SELECTOR\)\?\.setAttribute\(attribute, value\);\n\t\}\);/);
	const named = [
		["not-found-view.tsx", 'useTablistName<HTMLDivElement>({ label: "Redirects & 404s sections" })', '<div ref={tabsRef} className="shipit-seo-redirects-workspace">'],
		["indexnow-view.tsx", 'useTablistName<HTMLDivElement>({ label: "IndexNow sections" })', '<div ref={tabsRef} className="shipit-indexnow-tabs">'],
		["core-404-activity-view.tsx", 'useTablistName<HTMLDivElement>({ label: "404 activity view" })', '<div ref={tabsRef} className="shipit-core-404__modes"'],
		["crawl-diagnostics-view.tsx", 'useTablistName<HTMLDivElement>({ label: "Crawl diagnostics sections" })', '<div ref={tabsRef} className="shipit-seo-crawl-workspace">'],
		["configuration-views.tsx", 'useTablistName<HTMLElement>({ label: "Schema sections" })', '<nav ref={sectionTabsRef} aria-label="Schema sections"><Tabs'],
		["configuration-views.tsx", 'useTablistName<HTMLElement>({ labelledBy: "schema-builder-title" })', '<section ref={builderTabsRef} className="shipit-seo-panel shipit-seo-schema-builder"'],
		["business-identity-view.tsx", 'useTablistName<HTMLElement>({ labelledBy: "business-identity-output" })', '<section ref={outputTabsRef} aria-labelledby="business-identity-output">'],
	] as const;
	for (const [file, hook, container] of named) {
		const source = views[file]!;
		assert.ok(source.includes(hook), file + " names its strip");
		const at = source.indexOf(container);
		assert.ok(at > 0, file + " holds the strip in the named container");
		assert.match(source.slice(at, at + 600), /<Tabs\b/, file + ": the strip follows its container directly");
	}
	const strips = Object.entries(views).flatMap(([file, source]) => [...source.matchAll(/\{\.\.\.WRAPPING(?:_UNDERLINE)?_TABS\}/g)].map(() => file));
	assert.equal(strips.length, named.length, "every wrapping strip has a name");
});

check("module rows give descriptions the full width at narrow sizes", () => {
	const narrow = workspaceQuery(560);
	assert.match(narrow, /\.shipit-seo-module-row \{\s*grid-template-columns: 38px minmax\(0, 1fr\);/);
	assert.match(narrow, /\.shipit-seo-module-row > \.shipit-seo-module-controls \{\s*grid-column: 2;/);
});

check("Sitemaps stacks by workspace width and keeps Save beside Discard", () => {
	assert.match(workspaceQuery(700), /\.shipit-seo-sitemap-layout \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\.shipit-seo-sitemap-status \{\s*position: static;/);
	assert.doesNotMatch(rule(".shipit-seo-public-link"), /inline-flex/, "the link flows as text, so the icon follows the last line");
	assert.match(rule(".shipit-seo-public-link__end"), /white-space: nowrap;/, "the icon shares a line with the last character");
	assert.match(rule(".shipit-seo-public-link__end > svg"), /display: inline-block;/);
	// A flex or grid link makes each text part and the last character separate boxes: "sitemap.xm l".
	const linkRules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:^|\n)\t*([^{}@\s][^{}@]*?)\s*\{([^{}]*)\}/g)]
		.filter(([, selectors]) => selectors.split(",").some((selector) =>
			/\.shipit-seo-public-link(?![\w-])|\.shipit-seo-sitemap-[\w-]+ a$/.test(selector.trim())));
	assert.ok(linkRules.length >= 4, "control: the rules reaching public sitemap links are found");
	for (const [, selectors, body] of linkRules) {
		assert.doesNotMatch(body, /display:\s*(?:inline-)?(?:flex|grid)\b/, "a public sitemap link stays in text flow at every width: " + selectors.trim());
	}
	assert.match(rule(".shipit-seo-sitemap-row a.shipit-seo-public-link span"), /color: inherit;/,
		"the last character and the icon keep the link colour inside a content type row");
	const sitemap = views["sitemap-view.tsx"]!;
	assert.match(sitemap, /<a className="shipit-seo-public-link" href=\{url\}/);
	assert.match(sitemap, /const \{ parts, end \} = publicLinkText\(children \?\? url, children === undefined\);/);
	assert.match(sitemap, /<span className="shipit-seo-public-link__end">\{end\}<ArrowUpRight size=\{14\} aria-hidden="true" \/><\/span>/);
	assert.match(sitemap, /parts\.map\(\(part, index\) => <React\.Fragment key=\{index\}>\{index \? <wbr \/> : null\}\{part\}<\/React\.Fragment>\)/,
		"an address breaks between its path parts before any mid-word break");
	assert.doesNotMatch(sitemap, /published \$\{plan\.candidates === 1 \? "entry" : "entries"\} in /, "the count is not presented as listed entries");
	assert.match(sitemap, /` · \$\{sitemapPlanSummary\(plan\)\}`/);
	assert.match(sitemap, /Counts include every published entry\. A file leaves out entries marked noindex, excluded paths and entries/);
});

check("Local SEO step numbers stay circles beside shrinking labels", () => {
	const number = rule(".shipit-seo-local-navigation > button > .shipit-seo-local-navigation__number");
	for (const declaration of ["flex: 0 0 20px;", "width: 20px;", "min-width: 20px;", "height: 20px;", "border-radius: 999px;"]) assert.ok(number.includes(declaration), declaration);
	assert.match(rule(".shipit-seo-local-navigation > button > span"), /min-width: 0;/, "the label rule still lets text shrink, which the number rule outranks");
});

check("kept draft pages keep the workspace grid", () => {
	assert.match(rule(".shipit-seo-draft-pane"), /display: contents;/);
	assert.match(rule(".shipit-seo-draft-pane[hidden]"), /display: none;/);
});

check("inherited site-wide and content type rules read as information", () => {
	const note = rule('.shipit-seo-native-advanced__noindex-note[data-scope="content-type"]');
	assert.match(note, /background: var\(--color-kumo-banner-info, #e8f0fe\);/);
	assert.match(note, /color: var\(--text-color-kumo-default, #20242c\);/);
	assert.doesNotMatch(note, /#b42318|#fff0ef/);
	assert.match(css, /\.shipit-seo-native-advanced__noindex-note\[data-scope="site"\],\n\.shipit-seo-native-advanced__noindex-note\[data-scope="content-type"\] \{\n\talign-items: flex-start;\n\tbackground: var\(--color-kumo-banner-info/,
		"the site-wide note shares the information style");
	assert.match(css, /\.shipit-seo-native-advanced__noindex-note\[data-scope="site"\] > svg,\n\.shipit-seo-native-advanced__noindex-note\[data-scope="content-type"\] > svg \{[^}]*color: var\(--text-color-kumo-info/);
	assert.match(views["content-extensions.tsx"]!, /data-scope="site">\s*<Info size=\{14\} weight="fill" aria-hidden="true" \/>/);
	assert.match(views["content-extensions.tsx"]!, /<p className="shipit-seo-native-advanced__noindex-note" role="status">\s*<WarningCircle size=\{14\} weight="fill" aria-hidden="true" \/>/,
		"only the entry's own noindex keeps the warning");
	assert.match(rule(".shipit-seo-native-advanced__noindex-note > svg"), /flex: none;/, "the icon never shrinks into a stray dot");
	assert.match(views["content-extensions.tsx"]!, /data-scope="content-type">\s*<Info size=\{14\} weight="fill" aria-hidden="true" \/>/);
});

check("schema source badges keep one column", () => {
	assert.match(rule(".shipit-seo-entry-schema__list > li > .shipit-seo-entry-schema__source"), /flex: 0 0 9\.5rem;/);
	assert.match(rule(".shipit-seo-entry-schema__list > li > .shipit-seo-entry-schema__row-actions"), /min-inline-size: 11rem;/);
});

const layoutNode = (tag: string, className: string, width: number, attrs: Record<string, string> = {}): LayoutNode =>
	({ tag, classes: className.split(" ").filter(Boolean), attrs, width });
const sized = (grid: Omit<LayoutNode, "width">[], width: number) => grid.map((element) => ({ ...element, width }));
// Insets from the measured 375px Library chain around its 223px form content box.
const library = (form: number) => [
	layoutNode("div", "shipit-seo-admin", form + 72), layoutNode("div", "shipit-seo-workspace-shell", form + 72),
	layoutNode("div", "shipit-seo-workspace-content", form + 72), layoutNode("div", "shipit-seo-schema-pane", form + 72),
	layoutNode("div", "shipit-seo-schema-pane", form + 72), layoutNode("section", "shipit-seo-panel shipit-seo-library", form + 34),
	layoutNode("form", "shipit-seo-library__form", form),
];
const dialog = (panel: number, row: boolean) => [
	layoutNode("div", "shipit-seo-snippet-dialog", panel + 48, { role: "dialog" }),
	layoutNode("div", "shipit-seo-snippet-dialog__panel", panel, { role: "tabpanel" }),
	layoutNode("div", "shipit-seo-entry-schema", panel),
	...(row ? [layoutNode("section", "shipit-seo-entry-schema__section", panel), layoutNode("ul", "shipit-seo-entry-schema__list", panel - 2),
		layoutNode("li", "", panel - 24, { "data-source": "entry" })] : []),
	layoutNode("form", "shipit-seo-entry-schema__form", panel - (row ? 58 : 34)),
];

check("schema type descriptions and the saved-output notice stay beside the icon", () => {
	for (const existingOutputTypes of [[], ["BlogPosting"]]) {
		const markup = renderAuthoringControls({ json: "", mode: "choose", existingOutputTypes });
		const elements = renderedChains(markup, (node) => node.classes.includes("shipit-seo-entry-authoring__type") ||
			node.tag === "svg" || node.classes.includes("shipit-seo-entry-authoring__type-heading") ||
			node.classes.includes("shipit-seo-entry-authoring__type-description"));
		const cards = elements.filter((chain) => chain.at(-1)!.classes.includes("shipit-seo-entry-authoring__type"));
		const children = elements.filter((chain) => chain.at(-2)?.classes.includes("shipit-seo-entry-authoring__type"));
		assert.equal(cards.length, 5, "control: every schema type renders");
		assert.equal(children.filter((chain) => chain.at(-1)!.classes.includes("shipit-seo-entry-authoring__type-description")).length,
			existingOutputTypes.length ? 6 : 5, "control: the emitted Blog post adds the fourth card child from the regression");
		for (const cardChain of cards) {
			const card = cardChain.at(-1)!;
			const ownChildren = children.filter((chain) => chain.at(-2) === card);
			assert.ok(ownChildren.length === 3 || ownChildren.length === 4, "the card has one icon, a heading, a description and an optional notice");
			for (const width of [180, 223, 400, 800]) {
				const cardNodes = sized(cardChain, width);
				assert.equal(computedStyle(cardNodes, cardNodes.length - 1, "align-content", width + 80), "start",
					"a taller neighboring card cannot spread the title and description apart");
				for (const childChain of ownChildren) {
					const child = childChain.at(-1)!;
					const nodes = sized(childChain, width);
					const at = nodes.length - 1;
					assert.equal(computedStyle(nodes, at, "grid-column", width + 80), child.tag === "svg" ? "1" : "2",
						"all text, including the optional notice, uses the flexible text column");
					if (child.tag === "svg") assert.equal(computedStyle(nodes, at, "grid-row", width + 80), "1 / span 2",
						"the icon stays at the heading instead of auto-placing after a text row");
					else assert.equal(computedStyle(nodes, at, "min-width", width + 80), "0", "long text can shrink within its column");
				}
			}
		}
	}
});

check("guided schema fields stack in any narrow form, in the Library as in the entry dialog", () => {
	assert.match(views["schema-library-view.tsx"]!, /<form\n\t+className="shipit-seo-library__form"[\s\S]{0,800}?<h3 className="shipit-seo-library__form-title">\{title\}<\/h3>\s*<EntrySchemaAuthoringControls\b/,
		"the Library form holds the controls directly, outside any dialog container");
	assert.match(views["content-extensions.tsx"]!, /<form\n\t+className="shipit-seo-entry-schema__form"[\s\S]{0,800}?<h4 className="shipit-seo-entry-schema__form-title">\{title\}<\/h4>\s*<EntrySchemaAuthoringControls\b/,
		"the entry dialog form holds the controls directly");
	const guided = renderedChains(renderAuthoringControls({ context: "template", json: authoringCodec.createEntrySchemaAuthoring("WebPage"), mode: "guided" }),
		"shipit-seo-entry-authoring__fields");
	assert.equal(guided.length, 2, "control: the render reaches the required and the optional field grids");
	assert.ok(guided.some((grid) => grid.some((node) => node.classes.includes("shipit-seo-entry-authoring__optional"))), "control: the optional details are open");
	const types = renderedChains(renderAuthoringControls({ context: "template", json: "", mode: "choose" }), "shipit-seo-entry-authoring__types");
	assert.equal(types.length, 1, "control: the render reaches the type chooser");
	for (const grid of [...guided, ...types]) assert.ok(grid[0]!.classes.includes("shipit-seo-entry-authoring"), "every grid sits in the authoring root");
	const columns = (chain: LayoutNode[], viewport: number) => trackCount(computedStyle(chain, chain.length - 1, "grid-template-columns", viewport));
	assert.match(rule(".shipit-seo-entry-schema__form"), /padding: 16px;\n\tborder: 1px solid/, "the 34px form inset the dialog model assumes");
	assert.match(rule(".shipit-seo-entry-schema__list"), /padding: 0;\n\tborder: 1px solid/, "the 2px list inset the dialog model assumes");
	assert.match(rule(".shipit-seo-entry-schema__list > li"), /padding: 9px 11px;/, "the 22px row inset the dialog model assumes");
	assert.equal(computedStyle(dialog(300, false), 1, "container-name", 380), "shipit-seo-dialog", "control: the model finds the dialog container");
	for (const [index] of library(223).entries()) {
		assert.notEqual(computedStyle(library(223), index, "container-name", 375), "shipit-seo-dialog", "control: the Library has no dialog container");
	}
	for (const grid of [...guided, ...types]) {
		for (const [index] of grid.entries()) {
			if (index > 0) assert.equal(computedStyle([...library(223), ...sized(grid, 223)], library(223).length + index, "container-type", 375), "normal",
				"the grids query the authoring root, not a nearer container");
		}
		assert.equal(columns([...library(223), ...sized(grid, 223)], 375), 1, "the 375px Library form from acceptance stacks its fields");
		for (let form = 200; form <= 1100; form += 1) {
			assert.equal(columns([...library(form), ...sized(grid, form)], form + 152), form <= 480 ? 1 : 2, `Library grid in a ${form}px form`);
		}
		for (const row of [false, true]) {
			for (let panel = 240; panel <= 912; panel += 1) {
				const form = panel - (row ? 58 : 34);
				assert.equal(columns([...dialog(panel, row), ...sized(grid, form)], panel + 80), panel <= 540 ? 1 : 2,
					`the entry dialog ${row ? "row" : "add"} form keeps the dialog breakpoint in a ${panel}px panel`);
			}
		}
	}
});

check("guided field controls shrink to a one-column cell instead of crossing the form border", () => {
	const service = JSON.stringify({ "@context": "https://schema.org", "@type": "Service", name: "Boiler repair", description: "Same-day repairs.", serviceType: "Repair" });
	const faq = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage",
		mainEntity: [{ "@type": "Question", name: "Do you open on Sundays?", acceptedAnswer: { "@type": "Answer", text: "Yes." } }] });
	for (const json of [service, faq]) assert.ok(authoringCodec.decodeEntrySchemaAuthoring(json).ok, "control: the guided form opens " + json);
	const drafts = [authoringCodec.createEntrySchemaAuthoring("WebPage"), service, faq];
	const isControl = (element: Omit<LayoutNode, "width">) => (element.attrs["data-kumo-component"] === "Select" && element.attrs["data-kumo-part"] === "trigger") ||
		(["input", "textarea"].includes(element.tag) && !Object.hasOwn(element.attrs, "aria-hidden"));
	const guidedGrid = (element: Omit<LayoutNode, "width">) =>
		element.classes.includes("shipit-seo-entry-authoring__fields") || element.classes.includes("shipit-seo-entry-authoring__questions");
	assert.throws(() => computedStyle([layoutNode("div", "shipit-seo-scan__status", 400), layoutNode("div", "", 400)], 1, "display", 1000),
		/unsupported selector: \.shipit-seo-scan__status > div:first-child/, "control: a pseudo-class selector that could match still stops the model");
	const display = (chain: LayoutNode[], index: number, viewport: number) => {
		const own = computedStyle(chain, index, "display", viewport);
		return own !== "none" ? own : chain[index]!.classes.find((name) => ["grid", "inline-grid", "flex", "inline-flex"].includes(name)) ?? "block";
	};
	const owners = [
		["the 375px Library form", "template", library(223), 375], ["a 320px Library form", "template", library(168), 320], ["a wide Library form", "template", library(900), 1052],
		["a narrow entry dialog add form", "entry", dialog(300, false), 380], ["a narrow entry dialog row form", "entry", dialog(300, true), 380],
		["a wide entry dialog row form", "entry", dialog(860, true), 940],
	] as const;
	for (const [owner, context, prefix, viewport] of owners) {
		const markup = drafts.map((json) => renderAuthoringControls({ context, json, mode: "guided" })).join("");
		assert.match(markup, /data-kumo-part="trigger"[^>]*><span class="min-w-0 truncate[^"]*">Resolved meta description<\/span>/,
			"control: Kumo's value keeps its truncation classes in the acceptance select");
		const controls = renderedChains(markup, isControl).filter((chain) => chain.some(guidedGrid));
		const kinds = new Set(controls.map((chain) => chain.at(-1)!.tag + (chain.some((element) => element.classes.includes("shipit-seo-entry-authoring__questions")) ? " in a question" : "")));
		assert.deepEqual([...kinds].sort(), ["button", "input", "input in a question", "textarea", "textarea in a question"], "control: the render reaches every kind of guided control");
		const form = prefix.at(-1)!.width;
		let sourceSelects = 0;
		for (const control of controls) {
			const chain = [...prefix, ...sized(control, form)];
			const last = chain.length - 1;
			const name = (index: number) => [chain[index]!.tag, ...chain[index]!.classes.filter((part) => part.startsWith("shipit-seo") || part === "grid")].join(".") +
				(chain[index]!.attrs["data-kumo-part"] ? `[data-kumo-part="${chain[index]!.attrs["data-kumo-part"]}"]` : "");
			for (let index = prefix.length + control.map(guidedGrid).lastIndexOf(true) + 1; index <= last; index += 1) {
				const parent = display(chain, index - 1, viewport);
				if (!/grid|flex/.test(parent)) continue;
				assert.equal(computedStyle(chain, index, "min-width", viewport), "0",
					`${owner}: ${name(index)} under a ${parent} ${name(index - 1)} may shrink below its content to the cell, for ${name(last)}`);
			}
			assert.equal(computedStyle(chain, last, "max-width", viewport), "100%", `${owner}: ${name(last)} stays inside its cell`);
			assert.equal(computedStyle(chain, last, "width", viewport), "none", `${owner}: ${name(last)} keeps Kumo's own width where it fits`);
			const source = chain.findIndex((element) => element.classes.includes("shipit-seo-entry-authoring__field-source"));
			if (source < 0 || source + 1 >= last) continue;
			sourceSelects += 1;
			assert.equal(display(chain, source + 1, viewport), "grid", `control: Kumo lays out the ${owner} source field as a grid`);
			assert.equal(computedStyle(chain, source + 1, "grid-template-columns", viewport), "minmax(0, 1fr)",
				`${owner}: the source field's column takes the cell width, so max-width clamps ${name(last)} to the cell`);
		}
		assert.ok(sourceSelects >= 4, `control: ${owner} renders every variable source select`);
		const values = renderedChains(markup, (element) => element.tag === "span" && element.classes.includes("truncate"))
			.filter((chain) => chain.at(-2)!.attrs["data-kumo-part"] === "trigger" && chain.some(guidedGrid));
		assert.ok(values.length >= 4, "control: every guided select has a value");
		for (const value of values) {
			for (const property of ["min-width", "overflow", "text-overflow", "white-space"]) {
				assert.equal(computedStyle([...prefix, ...sized(value, form)], prefix.length + value.length - 1, property, viewport), "none",
					`${owner}: no admin rule overrides the ${property} of Kumo's truncated value`);
			}
		}
	}
});

check("disclosures use the check groups' caret, not the browser triangle", () => {
	assert.match(rule(".shipit-seo-analysis-details > summary", editorCss), /list-style: none;/);
	// Metadata guidance, saved JSON-LD, schema output and the Overview share one marker.
	const scopes = [".shipit-seo-native-panel__summary-details", ".shipit-seo-saved-metadata__guidance", ".shipit-seo-json-preview details",
		".shipit-seo-entry-schema__details", ".shipit-seo-overview__details"];
	const shared = (part: string, extra = "") => scopes.map((scope) => scope + extra + part).join(",\n");
	assert.match(rule(shared(" > summary"), editorCss), /display: flex;[\s\S]*list-style: none;/);
	assert.match(rule(shared(" > summary::-webkit-details-marker") + ",\n.shipit-seo-analysis-details > summary::-webkit-details-marker", editorCss), /display: none;/);
	const marker = rule(shared(" > summary::before") + ",\n.shipit-seo-analysis-details > summary::before", editorCss);
	assert.match(marker, /width: 12px;\n {2}height: 12px;\n {2}background-color: var\(--text-color-kumo-subtle, #667085\);/,
		"the size and subtle colour of the check groups' caret, whatever the summary's text colour");
	assert.match(marker, /-webkit-mask: url\("data:image\/svg\+xml,[^"]*M181\.66,133\.66l-80,80a8,8,0,0,1-11\.32-11\.32L164\.69,128,90\.34,53\.66[^"]*"\) center \/ contain no-repeat;\n {2}mask: url\(/,
		"the Phosphor CaretRight shape the check groups render");
	assert.doesNotMatch(marker, /border-right|border-bottom/, "no drawn glyph, which turns into a hook when rotated");
	assert.match(rule(shared(" > summary::before", "[open]") + ",\n.shipit-seo-analysis-details[open] > summary::before", editorCss),
		/transform: rotate\(90deg\);/, "the groups' open rotation");
	assert.match(rule(".shipit-seo-native-panel__group[open] > summary > svg"), /transform: rotate\(90deg\);/, "control: the groups rotate their caret the same way");
	assert.match(views["content-extensions.tsx"]!, /<div className="shipit-seo-native-panel__summary-details">/);
	assert.doesNotMatch(views["content-extensions.tsx"]!, /<summary>Score details<\/summary>|<details className="shipit-seo-native-panel__summary-details">/, "the score scope is plain text, not another disclosure");
	assert.match(views["saved-metadata-review.tsx"]!, /<details className="shipit-seo-saved-metadata__guidance">\s*<summary>Where to edit<\/summary>/);
	assert.equal((views["configuration-views.tsx"]!.match(/<div className="shipit-seo-json-preview">[^\n]*<details><summary>Review saved JSON-LD<\/summary>/g) ?? []).length, 2);
});

check("primary actions are styled primary", () => {
	const redirects = views["redirect-rules-view.tsx"]!;
	assert.match(redirects, /type="button"\s+variant="primary"\s+icon=\{ArrowBendUpRight\}\s+loading=\{form\.phase === "saving"\}/, "Save redirect");
	assert.match(redirects, /id=\{EDIT_PRIMARY_ID\}\s+type="button"\s+variant="primary"\s+icon=\{FloppyDisk\}/, "Save changes");
	assert.match(views["llms-txt-view.tsx"]!, /<Button type="button" variant="primary" loading=\{busy === "save"\}/);
	const indexNow = views["indexnow-view.tsx"]!;
	assert.match(indexNow, /variant="primary" loading=\{busy === "automation"\} disabled=\{busy !== null\} onClick=\{\(\) => void saveAutomation\("scope"\)\}>Save content types/);
	assert.match(indexNow, /variant="primary" loading=\{busy === "advanced"\}/);
});

check("customer text names no internal call", () => {
	assert.doesNotMatch(views["indexnow-view.tsx"]!, /"shipitSeo\(\) Astro entry point"/);
	assert.match(views["indexnow-view.tsx"]!, /status\.setup\.installation === "astro" \? "Astro integration"/);
	assert.doesNotMatch(views["admin.tsx"]!, /stores only these two fields/, "Website names what its save actually sends");
	assert.match(views["admin.tsx"]!, /Saving sends the site settings as they were loaded, with only your changes here, and is refused if they changed elsewhere in the meantime\./);
});

console.log(`Workspace layout self-check passed (${cases} groups).`);
