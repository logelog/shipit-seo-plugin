import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { Button } from "@cloudflare/kumo/components/button";
import { Loader } from "@cloudflare/kumo/components/loader";
import { ArrowCounterClockwise, FloppyDisk } from "@phosphor-icons/react";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function declaration(source: string, name: string): string {
	const parsed = ts.createSourceFile("production.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
	assert.equal(found.length, 1, "Exact production declaration: " + name);
	return found[0]!.getText(parsed);
}
const barSource = read("./settings-action-bar.tsx");
const compiled = ts.transpileModule(declaration(barSource, "SettingsActionBar") + "\nexport { SettingsActionBar };", {
	fileName: "action-bar-probe.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} as Record<string, any> };
new Function("require", "module", "exports", "Button", "Loader", "ArrowCounterClockwise", "FloppyDisk", compiled.outputText)(
	(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, output, output.exports, Button, Loader, ArrowCounterClockwise, FloppyDisk);
const SettingsActionBar = output.exports.SettingsActionBar as (props: Record<string, unknown>) => React.ReactElement<Record<string, any>>;

type Element = React.ReactElement<Record<string, any>>;
function elements(tree: React.ReactNode): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as Element;
	return [element, ...elements(element.props.children)];
}
let cases = 0;
function check(run: () => void) { run(); cases += 1; }
function click() {
	let prevented = 0;
	return { preventDefault: () => { prevented += 1; }, get prevented() { return prevented; } };
}

check(() => {
	let discarded = 0; let saved = 0;
	const restore = React.createElement(Button, { type: "button", variant: "secondary-destructive" }, "Restore defaults");
	const tree = SettingsActionBar({ status: "Unsaved changes", restore, discardDisabled: false, onDiscard: () => { discarded += 1; },
		saveLabel: "Save sitemap settings", saveDisabled: false, onSave: () => { saved += 1; } });
	const [left, right] = tree.props.children as Element[];
	assert.equal(left.props.className, "shipit-seo-action-bar__restore");
	assert.equal(left.props.children, restore, "Restore sits alone at the left");
	assert.equal(right.props.className, "shipit-seo-action-bar__commit");
	const [status, buttons] = right.props.children as Element[];
	assert.equal(status.type, "p"); assert.equal(status.props.role, "status"); assert.equal(status.props.children, "Unsaved changes");
	const [discard, save] = elements(buttons).filter((node) => node.type === Button);
	assert.deepEqual([discard.props.children, discard.props.variant, discard.props.type], ["Discard changes", "secondary", "button"]);
	assert.deepEqual([save.props.children, save.props.variant, save.props.type], ["Save sitemap settings", "primary", "button"],
		"The rightmost action is the primary Save naming its object");
	const available = click();
	discard.props.onClick(click()); save.props.onClick(available);
	assert.deepEqual([discarded, saved], [1, 1]);
	assert.equal(available.prevented, 0, "An available Save keeps its click");
	assert.deepEqual([discard.props["aria-disabled"], save.props["aria-disabled"]], [undefined, undefined]);
	const html = renderToStaticMarkup(tree);
	assert.ok(html.indexOf("Restore defaults") < html.indexOf("Unsaved changes") && html.indexOf("Unsaved changes") < html.indexOf("Discard changes") &&
		html.indexOf("Discard changes") < html.indexOf("Save sitemap settings"), "Visual order: restore, status, Discard, Save");
});

check(() => {
	let discarded = 0;
	const tree = SettingsActionBar({ status: "Saved", discardDisabled: true, onDiscard: () => { discarded += 1; }, saveLabel: "Save indexing rules", saveDisabled: true,
		statusTone: "error", discardLabel: "Wijzigingen verwerpen" });
	const [left, right] = tree.props.children as Element[];
	assert.equal(left.props.children, undefined, "A page without a restore action leaves the slot empty");
	const [status] = right.props.children as Element[];
	assert.equal(status.props.className, "shipit-seo-form-error");
	const [discard, save] = elements(right).filter((node) => node.type === Button);
	assert.equal(discard.props.children, "Wijzigingen verwerpen");
	assert.deepEqual([discard.props["aria-disabled"], save.props["aria-disabled"]], [true, true], "Both are disabled when nothing is unsaved");
	assert.deepEqual([discard.props.disabled, save.props.disabled, save.props.loading], [undefined, undefined, undefined],
		"Neither is natively disabled, so a pressed button keeps keyboard focus");
	assert.equal(save.props.type, "submit", "Without a handler Save submits the form");
	const refused = click();
	discard.props.onClick(click()); save.props.onClick(refused);
	assert.equal(discarded, 0, "A disabled Discard does nothing");
	assert.equal(refused.prevented, 1, "A disabled Save cancels the click, and with it the form submission");
	const html = renderToStaticMarkup(tree);
	assert.equal(html.match(/<button[^>]*aria-disabled="true"/g)?.length, 2, "Kumo passes aria-disabled to both buttons");
	const nativelyDisabled = /<button[^>]*\sdisabled=""/;
	assert.match(renderToStaticMarkup(React.createElement(Button, { disabled: true }, "Probe")), nativelyDisabled, "control: the pattern finds a disabled Kumo button");
	assert.doesNotMatch(html, nativelyDisabled, "No button carries the native disabled attribute");
});

// While a save runs, Save shows Kumo's loader and stays focusable; its click submits nothing.
check(() => {
	let saved = 0;
	const tree = SettingsActionBar({ status: "Saving...", discardDisabled: true, onDiscard: () => {}, saveLabel: "Save robots.txt", saveDisabled: false,
		saving: true, onSave: () => { saved += 1; } });
	const [, save] = elements(tree).filter((node) => node.type === Button);
	assert.equal(save.props["aria-disabled"], true, "A running save reads as disabled");
	assert.equal(save.props.disabled, undefined);
	const saveMarkup = renderToStaticMarkup(save);
	const exposed = (markup: string) => markup.replace(/<(\w+)[^>]*\saria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "");
	assert.match(renderToStaticMarkup(React.createElement(Loader, { size: 14 })), /role="status" aria-label="Loading"/, "control: Kumo's loader carries its own English label");
	assert.match(saveMarkup, /role="status" aria-label="Loading"/, "control: the loader replaces the save icon");
	assert.doesNotMatch(exposed(saveMarkup), /aria-label=|role="status"/, "No label or status inside Save is exposed while it saves");
	assert.equal(exposed(saveMarkup).replace(/<[^>]+>/g, ""), "Save robots.txt", "Save's accessible name while saving is its label alone");
	const refused = click();
	save.props.onClick(refused);
	assert.deepEqual([saved, refused.prevented], [0, 1], "Pressing Save again while it runs sends nothing");
	const idle = elements(SettingsActionBar({ status: "", discardDisabled: false, onDiscard: () => {}, saveLabel: "Save", saveDisabled: false, onSave: () => {} }))
		.filter((node) => node.type === Button)[1]!;
	assert.equal(idle.props.icon, FloppyDisk, "control: an idle Save shows its own icon");
	const css = read("./admin.css");
	assert.match(css, /\n\.shipit-seo-action-bar__buttons > button\[aria-disabled="true"\] \{\s*cursor: not-allowed;\s*opacity: 0\.5;\s*\}/,
		"An unavailable button is dimmed as Kumo dims a disabled one");
	assert.match(css, /\n\.shipit-seo-action-bar__buttons > button\[aria-disabled="true"\]:focus-visible \{\s*opacity: 1;\s*\}/,
		"A focused unavailable button draws its focus ring at full strength");
	const hoverTint = "not-disabled:hover:bg-kumo-tint";
	assert.ok(renderToStaticMarkup(React.createElement(Button, { variant: "secondary" }, "Probe")).includes(hoverTint), "control: Kumo's secondary button carries the hover tint");
	assert.ok(!renderToStaticMarkup(React.createElement(Button, { variant: "primary" }, "Probe")).includes(hoverTint), "control: the primary Save does not");
	assert.match(css, /\n\.shipit-seo-action-bar__buttons > button\.not-disabled\\:hover\\:bg-kumo-tint\[aria-disabled="true"\]:hover \{\s*background-color: var\(--color-kumo-base\);\s*\}/,
		"An unavailable Discard keeps its resting background on hover");
});

// Every settings form uses the one bar; restore is secondary-destructive and always confirms.
check(() => {
	const admin = read("./admin.tsx");
	const configuration = read("./configuration-views.tsx");
	const sitemap = read("./sitemap-view.tsx");
	const robots = read("./robots-txt-view.tsx");
	const templates = read("./template-views.tsx");
	const pages = [
		["Search & social and Website", declaration(admin, "SettingsActions")],
		["Indexing rules", declaration(admin, "IndexingSettings")],
		["Feature controls", declaration(configuration, "ConfigurationActions")],
		["Sitemaps", declaration(sitemap, "SitemapView")],
		["Robots.txt", declaration(robots, "RobotsTxtView")],
		["Templates", declaration(templates, "TemplatesView")],
	] as const;
	for (const [page, body] of pages) {
		assert.equal(body.match(/<SettingsActionBar\b/g)?.length, 1, page + " has one action bar");
		assert.doesNotMatch(body, /className="shipit-seo-settings-actions"|className="shipit-seo-sitemap-actions"|className="shipit-seo-robots-actions"/,
			page + " keeps no second action layout");
		assert.match(body, /saveLabel=(?:"Save [^"]+"|\{[^}]+\})/, page + " names what Save saves");
	}
	assert.doesNotMatch(declaration(admin, "IndexingSettings"), /restore=/, "Indexing rules has no restore action for its record");
	assert.match(declaration(admin, "SearchSocialSettings"), /saveLabel="Save search & social settings"/);
	assert.match(declaration(admin, "SiteIdentitySettings"), /saveLabel="Save website settings"/);
	const restoreButtons: [string, string, RegExp][] = [
		["Search & social", declaration(admin, "SettingsActions"), /<Dialog\.Root\s+role="alertdialog"[\s\S]*?<Dialog\.Trigger[\s\S]*?variant="secondary-destructive"[\s\S]*?disabled=\{!stored \|\| busy\}[\s\S]*?Restore inherited/],
		["Feature controls", declaration(configuration, "ConfigurationActions"), /<Dialog\.Root role="alertdialog"[^>]*>\s*<Dialog\.Trigger render=\{\(props\) => \(\s*<Button \{\.\.\.props\} type="button" variant="secondary-destructive" icon=\{ArrowCounterClockwise\} disabled=\{!canRestore \|\| busy\}>/],
		["Sitemaps", declaration(sitemap, "SitemapView"), /variant="secondary-destructive"\s+icon=\{ArrowCounterClockwise\}\s+disabled=\{formLocked \|\| configuration\.revision === null\}\s+onClick=\{\(\) => setResetOpen\(true\)\}/],
		["Robots.txt", declaration(robots, "RobotsTxtView"), /variant="secondary-destructive" icon=\{ArrowCounterClockwise\} disabled=\{!canRestore\} onClick=\{\(\) => setRestoreOpen\(true\)\}/],
		["Templates", declaration(templates, "TemplatesView"), /variant="secondary-destructive"\s+icon=\{ArrowCounterClockwise\}\s+disabled=\{!canResetTemplate\(state, active\)\}\s+onClick=\{\(\) => store\.dispatch\(\{ type: "open-reset", collection: active \}\)\}/],
	];
	for (const [page, body, pattern] of restoreButtons) assert.match(body, pattern, page + " restore opens a confirmation first");
	const restoreDescription = declaration(admin, "SettingsActions").match(/<Dialog\.Description>([\s\S]*?)<\/Dialog\.Description>/)?.[1]?.replace(/\s+/g, " ").trim();
	assert.equal(restoreDescription, "The site identity and social defaults return to the values inherited from legacy settings or the site and are saved " +
		"with the current site-wide noindex setting, which does not change. The content type and taxonomy archive noindex rules in Indexing rules are kept. " +
		"Content scoring is turned back on. The business identity is stored separately and is kept.", "Restore inherited names every rule it keeps");
	// A kept page closes its confirmation while it is hidden.
	assert.match(declaration(sitemap, "SitemapView"), /<Dialog\.Root role="alertdialog" open=\{pageActive && resetOpen\}/);
	assert.match(declaration(robots, "RobotsTxtView"), /<Dialog\.Root role="alertdialog" open=\{pageActive && restoreOpen\}/);
	assert.match(declaration(sitemap, "SitemapView"), /if \(!pageActive\) setResetOpen\(false\);/);
	assert.match(declaration(robots, "RobotsTxtView"), /if \(!pageActive\) setRestoreOpen\(false\);/);
	assert.match(declaration(templates, "TemplatesView"), /<Dialog\.Root\s+role="alertdialog"\s+open=\{review !== null\}/);
	assert.match(declaration(sitemap, "SitemapView"), /onDiscard=\{\(\) => \{ setDraft\(baseline\); setDraftRevision\(configuration\.revision\); setErrors\(\{\}\); \}\}/, "Sitemap Discard only resets the draft");
	assert.match(declaration(sitemap, "SitemapView"), /saveSeoAdminSitemap\(local\.values, draftRevision, corrupt\)/, "a save names the revision its choices started from");
	assert.match(declaration(sitemap, "SitemapView"), /if \(sameDraft\(draft, baseline\) \|\| sameDraft\(draft, next\)\) setDraftRevision\(configuration\.revision\);/,
		"a newer read moves that revision only while nothing is unsaved");
	assert.match(declaration(sitemap, "SitemapView"), /saveLabel=\{corrupt \? "Replace stored settings" : "Save sitemap settings"\}/);
});

console.log("Settings action bar self-check passed (" + cases + " groups).");
