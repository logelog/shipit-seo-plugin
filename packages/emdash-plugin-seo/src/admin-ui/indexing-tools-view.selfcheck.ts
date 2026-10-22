import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function declarationIn(source: string, name: string): string {
	const parsed = ts.createSourceFile("view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
	assert.equal(found.length, 1, "Exact production declaration: " + name);
	return found[0]!.getText(parsed);
}
type Element = React.ReactElement<Record<string, any>>;
function elements(tree: unknown): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const node = tree as Element;
	return [node, ...elements(node.props.children)];
}
let cases = 0;
function check(run: () => void) { run(); cases += 1; }

const notFound = read("./not-found-view.tsx");
const activity = read("./core-404-activity-view.tsx");
const rules = read("./redirect-rules-view.tsx");
const crawl = read("./crawl-diagnostics-view.tsx");
const indexNow = read("./indexnow-view.tsx");
const llms = read("./llms-txt-view.tsx");
const robots = read("./robots-txt-view.tsx");
const sitemap = read("./sitemap-view.tsx");
const css = read("./admin.css");

// I3: Redirect rules first; a 404 row opens the existing New redirect dialog with its path.
check(() => {
	const view = declarationIn(notFound, "NotFoundView");
	const tabs = [...view.matchAll(/\{ value: "(rules|activity|triage)", label: "([^"]+)" \}/g)].map((match) => [match[1], match[2]]);
	assert.deepEqual(tabs, [["rules", "Redirect rules"], ["activity", "404 activity"], ["triage", "Forwarded paths"]]);
	assert.match(view, /React\.useState<"activity" \| "triage" \| "rules">\("rules"\)/, "Redirect rules is selected on entry");
	assert.match(view, /setPrefill\(\(current\) => \(\{ source, request: \(current\?\.request \?\? 0\) \+ 1 \}\)\);\s*setTab\("rules"\);/);
	assert.match(view, /<RedirectRulesView prefill=\{prefill\} onPrefillHandled=\{prefillHandled\} \/>/);
	assert.match(view, /<Core404Activity onCreateRedirect=\{createRedirect\} \/>/);
	const output = ts.transpileModule(declarationIn(activity, "CreateRedirectAction") + "\nexport { CreateRedirectAction };", {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	const Button = () => null;
	const module = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", "Button", "ArrowBendUpRight", output.outputText)(() => jsx, module, module.exports, Button, () => null);
	const opened: string[] = [];
	const action = module.exports.CreateRedirectAction({ path: "/missing page", onCreateRedirect: (path: string) => opened.push(path) }) as Element;
	assert.equal(action.type, Button);
	assert.equal(action.props["aria-label"], "Create redirect from /missing page", "the accessible name contains the visible label");
	assert.equal(action.props.children, "Create redirect");
	action.props.onClick();
	assert.deepEqual(opened, ["/missing page"]);
	assert.equal(module.exports.CreateRedirectAction({ path: "/x" }), null, "no action without a destination");
	assert.equal(declarationIn(activity, "RetainedPaths").match(/<CreateRedirectAction path=\{item\.path\}/g)?.length, 1, "Recorded paths rows");
	assert.equal(declarationIn(activity, "TopPaths").match(/<CreateRedirectAction path=\{item\.path\}/g)?.length, 1, "Top by hits rows");
	const viewSource = declarationIn(rules, "RedirectRulesView");
	assert.match(viewSource, /if \(!prefill \|\| createAccess === null\) return;\s*onPrefillHandled\?\.\(\);/, "the request waits for the create permission");
	assert.match(viewSource, /prefillRedirectForm\(redirectFormStore, prefill\.source\)/);
	assert.match(viewSource, /CREATE_UNAVAILABLE\[createAccess\]/, "a refused create is explained instead of opening an unusable dialog");
	assert.ok(viewSource.indexOf("prefillRedirectForm(") < viewSource.indexOf("setFormOpen(true);\n\t}, [prefill"), "the existing dialog opens after the draft is set");
});

// I4: row actions and key data stay reachable at narrow widths.
check(() => {
	for (const [label, source, action] of [["unresolved links", declarationIn(crawl, "InternalGraphView"), "Edit source"], ["unlinked entries", declarationIn(crawl, "InternalGraphView"), "Edit entry"]] as const) {
		const actionAt = source.indexOf(`>\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t${action}`);
		const meta = source.lastIndexOf("shipit-seo-mobile-meta", actionAt);
		assert.ok(actionAt > 0 && meta > 0, label + ": the mobile meta carries " + action);
		const firstCell = source.lastIndexOf("<Table.Cell>", meta);
		assert.equal(source.slice(firstCell, meta).includes("</Table.Cell>"), false, label + ": the mobile meta sits in the first cell");
	}
	const triage = declarationIn(notFound, "NotFoundTriage");
	const meta = triage.slice(triage.indexOf("shipit-seo-mobile-meta"), triage.indexOf("</Table.Cell>", triage.indexOf("shipit-seo-mobile-meta")));
	for (const fragment of ["item.hits", "statusBadge(item.status)", "suggestion.path", "Ignore</Button>", "Reopen</Button>"]) {
		assert.ok(meta.includes(fragment), "forwarded paths mobile meta shows " + fragment);
	}
	// Every table wrapper that renders mobile meta drops the fixed minimum width.
	let wrappers = 0;
	for (const file of readdirSync(new URL(".", import.meta.url)).filter((name) => name.endsWith(".tsx"))) {
		const source = read("./" + file);
		for (const match of source.matchAll(/<div className="(shipit-seo-table-wrap[^"]*)"/g)) {
			const end = source.indexOf("</Table>", match.index);
			if (!source.slice(match.index, end).includes("shipit-seo-mobile-meta")) continue;
			wrappers += 1;
			if (file === "admin.tsx") continue;
			assert.match(match[1], /\bshipit-seo-table-wrap--fluid\b/, file + ": a table with mobile meta is fluid");
		}
	}
	assert.ok(wrappers >= 5, "control: the scan found the tables with mobile meta");
	const fixed = css.indexOf(".shipit-seo-table-wrap table {\n\tmin-width: 900px;");
	const fluid = css.indexOf(".shipit-seo-table-wrap.shipit-seo-table-wrap--fluid table {\n\tmin-width: 100%;");
	assert.ok(fixed > 0 && fluid > fixed, "the fluid rule overrides the fixed minimum width");
	assert.match(sitemap, /<div className="shipit-seo-table-wrap shipit-seo-table-wrap--fluid(?: [^"]+)?">/, "the sitemap preview needs no sideways scroll");
});

// I5: IndexNow turn-off is confirmed, saves name their scope and the engine note is accurate.
check(() => {
	assert.match(indexNow, /<p>Participating engines such as Bing receive these URLs\. Google Search is not an IndexNow participant\.<\/p>/);
	assert.match(indexNow, />Save content types<\/Button>/);
	assert.match(indexNow, />Save advanced settings<\/Button>/);
	assert.doesNotMatch(indexNow, />Save changes<\/Button>/, "no unlabelled save remains");
	assert.match(indexNow, /variant="secondary-destructive" loading=\{busy === "disable"\} disabled=\{busy !== null\} onClick=\{\(\) => setTurnOffOpen\(true\)\}>Turn off IndexNow/);
	assert.doesNotMatch(indexNow, /onClick=\{\(\) => void turnOff\(\)\}>Turn off/, "the trigger never turns IndexNow off directly");
	assert.match(indexNow, /<Dialog\.Root role="alertdialog" open=\{pageActive && turnOffOpen\}[\s\S]*?Queued and retrying URLs stop being sent[\s\S]*?>Cancel<\/Button>[\s\S]*?variant="destructive"[\s\S]*?void turnOff\(\)\.then\(\(\) => setTurnOffOpen\(false\)\)/);
	assert.doesNotMatch(indexNow, /Google (?:uses|supports|receives) IndexNow/i);
	assert.match(indexNow, /Noindexed entries are skipped, including every entry of a content type with a noindex rule in Indexing rules\./,
		"automatic submission names the content type rule it follows");
});

// The content type picker and the manual list follow the content type noindex rule.
check(() => {
	assert.match(indexNow, /const submittable = submittableIndexNowTypes\(available, status\.contentTypeRules\);/);
	assert.match(indexNow, /indexNowScopeRows\(status\.contentTypes, savedScope, draftScope, status\.contentTypeRules\)/);
	assert.match(indexNow, /const automationActive = [^;]*eligibleIndexNowScope\(savedScope, submittable\)/, "a ruled type never makes automation active");
	assert.match(indexNow, /const canStart = [^;]*eligibleIndexNowScope\(draftScope, submittable\)\.length > 0;/, "a scope of only ruled types cannot start");
	assert.match(indexNow, /draftOnlyRuled\s*\?\s*"Every selected content type has a noindex rule in Indexing rules\. Choose another content type\."/);
	assert.match(indexNow, /\{row\.noindexRule \? <Badge variant="warning">Noindex rule<\/Badge> : null\}/);
	assert.match(indexNow, /Types marked Noindex rule are not submitted while their content type rule is on\. Their choice is kept for when the rule is removed\./,
		"the scope note below already names Indexing rules once");
	assert.match(indexNow, /onCheckedChange=\{\(checked\) => updateScope\(row\.collection, checked === true\)\}/, "a ruled type stays selectable");
	assert.match(indexNow, /\{manualRuleNote \? <p className="shipit-indexnow-muted">\{manualRuleNote\}<\/p> : null\}/);
	assert.match(indexNow, /toggleIndexNowScope\(current\.scope\.values\.autoSubmitContentTypes, collection, checked, available\)/,
		"turning the default into a list keeps ruled choices");
});

// I6: the llms.txt output switch sits in the main panel header with its scope.
check(() => {
	const header = llms.indexOf('className="shipit-seo-llms-header-actions"');
	const editor = llms.indexOf('label="Markdown text"');
	const aside = llms.indexOf('<aside className="shipit-seo-panel shipit-seo-llms-status"');
	const toggle = llms.indexOf('label={current.enabled ? "Output on (saved setting)" : "Output off (saved setting)"}');
	assert.ok(header > 0 && toggle > header && toggle < editor && editor < aside, "the switch is in the main panel header");
	assert.equal(llms.match(/label=\{current\.enabled \? "Output on \(saved setting\)" : "Output off \(saved setting\)"\}/g)?.length, 1,
		"one switch only, and its label names the saved state it shows");
	assert.match(llms, /<Button type="button" variant="primary" loading=\{busy === "save"\}/, "Save is the primary action");
	assert.match(llms, /<p>Applies immediately\. Text changes need Save\.<\/p>/);
	assert.match(llms, /aria-describedby="seo-llms-output-help"/);
	assert.match(llms.slice(aside), /On this host the file is at/, "the aside keeps the public file");
	assert.match(llms.slice(aside), /Check again/, "the aside keeps the observation");
});

// I7: the sitemap index link leads the form and listed types show their file links.
check(() => {
	const view = declarationIn(sitemap, "SitemapView");
	const indexLink = view.indexOf("shipit-seo-sitemap-index-link");
	const types = view.indexOf("<legend>Content types</legend>");
	assert.ok(indexLink > 0 && indexLink < types, "Sitemap index: shows above the content types");
	assert.match(view, /<span>Sitemap index:<\/span>/);
	assert.match(view, /sitemapFileLinks\(configuration\.publicFiles\.origin, plan\)/);
	assert.match(view, /owned && checked && checked === baseline\.contentTypes\[group\.key\]/, "links only for saved, listed choices");
	assert.match(view, /A content type noindex rule in Indexing rules leaves this type out of the sitemap\. This choice is kept for when the rule is removed\./);
});

// I8: the robots.txt editor names the other editor of the same text.
check(() => {
	assert.match(robots, /const EMDASH_SEO_SETTINGS_URL = "\/_emdash\/admin\/settings\/seo";/);
	const count = robots.indexOf('id="seo-robots-count"');
	const help = robots.indexOf("EmDash Settings &gt; SEO edits the same robots.txt text");
	assert.ok(count > 0 && help > count && help < robots.indexOf("<SettingsActionBar", count), "the help line sits under the editor");
	assert.match(robots, /<a href=\{EMDASH_SEO_SETTINGS_URL\}>Open EmDash SEO settings<\/a>/);
});

// Copy rules for every touched page.
check(() => {
	for (const [name, source] of [["not-found", notFound], ["activity", activity], ["rules", rules], ["crawl", crawl], ["indexnow", indexNow], ["llms", llms], ["robots", robots], ["sitemap", sitemap]] as const) {
		assert.doesNotMatch(source, /[\u2014\u2013\u2026]/, name + " has no em dash, en dash or ellipsis character");
	}
});

console.log(`Indexing tool views self-check passed (${cases} groups).`);
