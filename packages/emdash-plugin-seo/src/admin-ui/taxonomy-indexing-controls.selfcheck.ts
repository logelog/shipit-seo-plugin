import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import * as banner from "@cloudflare/kumo/components/banner";
import * as button from "@cloudflare/kumo/components/button";
import * as radio from "@cloudflare/kumo/components/radio";

import { createSeoI18n } from "./i18n/messages.ts";
import * as rulesModel from "./indexing-rules-model.ts";

const source = readFileSync(new URL("./taxonomy-indexing-controls.tsx", import.meta.url), "utf8");

// Hooks are replaced so the real event closures can run outside a renderer.
// Refs are recorded in call order: the heading, then the Remove button map.
let refs: { current: any }[] = [];
const localReact = {
	...React,
	useId: () => "tax",
	useRef: <T,>(current: T) => {
		const ref = { current };
		refs.push(ref);
		return ref;
	},
};
let locale = "en";
const i18n = { useSeoI18n: () => createSeoI18n(locale) };
function load(file: string, text: string, modules: Record<string, unknown>) {
	const compiled = ts.transpileModule(text, {
		fileName: file,
		reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
	});
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", compiled.outputText)(
		(name: string) => {
			assert.ok(Object.hasOwn(modules, name), "Unexpected import: " + name);
			return modules[name];
		},
		output,
		output.exports,
	);
	return output.exports;
}
const status = load("indexing-rule-status.tsx", readFileSync(new URL("./indexing-rule-status.tsx", import.meta.url), "utf8"), {
	"react/jsx-runtime": jsx,
	"@phosphor-icons/react": icons,
	"@cloudflare/kumo/components/radio": radio,
	"./i18n/index.ts": i18n,
	"./indexing-rules-model.ts": rulesModel,
});
const controls = load("taxonomy-indexing-controls.tsx", source, {
	react: localReact,
	"react/jsx-runtime": jsx,
	"@phosphor-icons/react": icons,
	"@cloudflare/kumo/components/banner": banner,
	"@cloudflare/kumo/components/button": button,
	"./i18n/index.ts": i18n,
	"./indexing-rule-status.tsx": status,
	"./indexing-rules-model.ts": rulesModel,
});
const LIMIT: number = controls.TAXONOMY_ARCHIVE_NOINDEX_LIMIT;
const { Button } = button;
const { IndexingRuleControl, IndexingChoiceGroup } = status;
const { Banner } = banner;

type Element = React.ReactElement<Record<string, any>>;
function elements(tree: unknown): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as Element;
	return [element, ...elements(element.props.children), ...elements(element.props.action), ...elements(element.props.label)];
}
function text(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(text).join("");
	return React.isValidElement(node) ? text((node as Element).props.children) : "";
}
const definitions = [
	{ name: "category", label: "Categories" },
	{ name: "post_tag", label: "Tags" },
	{ name: "genre", label: "Genre" },
];
const base = {
	selected: [] as string[],
	saved: undefined as string[] | undefined,
	definitions: definitions as typeof definitions | null,
	loading: false,
	error: null as string | null,
	disabled: false,
	siteNoindex: false,
	savedSiteNoindex: false,
};
function render(props: Partial<typeof base> & Record<string, unknown>) {
	const changes: string[][] = [];
	const focused: string[] = [];
	let retries = 0;
	const merged = { ...base, onChange: (names: string[]) => changes.push(names), onRetry: () => { retries += 1; }, ...props };
	merged.saved ??= merged.selected;
	refs = [];
	const tree = controls.TaxonomyIndexingControls(merged) as Element;
	const heading = refs[0]!;
	const removeButtons = refs[1]!;
	heading.current = { focus: () => focused.push("heading") };
	const focusRemove = (name: string) => removeButtons.current.set(name, { focus: () => focused.push("remove:" + name) });
	return { tree, html: renderToStaticMarkup(tree), changes, focused, focusRemove, retries: () => retries };
}
/** The row's rule control; `choice` is the radio group it renders while the row is editable. */
function row(tree: Element, name: string) {
	const item = elements(tree).find((node) => node.type === "li" && node.key === name);
	assert.ok(item, "Row exists: " + name);
	const control = elements(item).find((node) => node.type === IndexingRuleControl);
	assert.ok(control, "Row has its rule control: " + name);
	return { control, choice: IndexingRuleControl(control.props) as Element, html: renderToStaticMarkup(item) };
}
const rules = (selected: string[], saved = selected, siteNoindex = false, savedSiteNoindex = false) => ({ selected, saved, siteNoindex, savedSiteNoindex });
const SET_NOINDEX = "Set all to Noindex";
const SET_INDEX = "Set all to Index";
function buttonByLabel(tree: Element, label: string): Element {
	const found = elements(tree).find((node) => node.type === Button && (node.props["aria-label"] === label || text(node.props.children) === label));
	assert.ok(found, "Button exists: " + label);
	return found;
}
let cases = 0;
function check(name: string, run: () => void) {
	run();
	cases += 1;
	void name;
}

check("model keeps unlisted selections in order and removes duplicates", () => {
	const model = controls.taxonomyIndexingModel(rules(["genre", "retired", "genre", "category", "old"]), [...definitions, { name: "genre", label: "Duplicate" }]);
	assert.deepEqual(model.selected, ["genre", "retired", "category", "old"]);
	assert.deepEqual(model.unlisted, ["retired", "old"]);
	assert.deepEqual(model.listed.map((item: any) => [item.name, item.status.own]), [["category", "noindex"], ["post_tag", "index"], ["genre", "noindex"]]);
	assert.equal(model.listed[2].label, "Genre", "the first definition of a name wins");
	assert.equal(controls.taxonomyIndexingModel(rules([]), [{ name: "topic", label: "  " }]).listed[0].label, "topic");
	assert.deepEqual(controls.taxonomyIndexingModel(rules(["a", "b"]), null).unlisted, ["a", "b"], "without a list every selection is shown by name");
	const draft = controls.taxonomyIndexingModel(rules(["genre"], ["category"]), definitions);
	assert.deepEqual(draft.listed.map((item: any) => [item.name, item.status.saved.choice, item.status.after?.choice ?? null]),
		[["category", "noindex", "index"], ["post_tag", "index", null], ["genre", "index", "noindex"]], "saved effects stay first; the draft is what saving would apply");
	assert.deepEqual(draft.listed[0].status.saved, { choice: "noindex", source: "archive" });
});

check("toggle, select all and clear change only the draft list", () => {
	assert.deepEqual(controls.toggleTaxonomyArchive(["retired"], "category", true), ["retired", "category"]);
	assert.deepEqual(controls.toggleTaxonomyArchive(["retired", "category"], "category", false), ["retired"]);
	assert.deepEqual(controls.selectAllTaxonomyArchives(["retired", "genre"], definitions), ["retired", "genre", "category", "post_tag"]);
	assert.deepEqual(controls.clearListedTaxonomyArchives(["retired", "genre", "category"], definitions), ["retired"], "Clear keeps unlisted names");
});

check("the limit holds for toggles and select all", () => {
	const full = Array.from({ length: LIMIT }, (_, index) => `t${index}`);
	assert.equal(LIMIT, 100);
	assert.deepEqual(controls.toggleTaxonomyArchive(full, "category", true), full);
	const nearly = full.slice(0, LIMIT - 2);
	assert.deepEqual(controls.selectAllTaxonomyArchives(nearly, definitions), nearly, "Select all past the limit adds nothing");
	const model = controls.taxonomyIndexingModel(rules(nearly), definitions);
	assert.equal(model.canSelectAll, false);
	assert.equal(model.atLimit, false);
	const { tree, html } = render({ selected: full });
	assert.equal(row(tree, "category").choice.props.noindexDisabled, true, "an Index archive cannot become Noindex at the limit");
	assert.equal(row(render({ selected: [...full.slice(0, LIMIT - 1), "genre"] }).tree, "genre").choice.props.noindexDisabled, false, "a Noindex archive can still return to Index at the limit");
	assert.match(html, /id="tax-limit" role="status">Limit of 100 taxonomy archives reached\./);
	assert.match(html, /<fieldset[^>]*aria-describedby="tax-limit"/, "disabled rows are described by the limit");
	assert.match(render({ selected: nearly }).html, /Set all to Noindex would pass the limit of 100\./);
	assert.match(render({}).html, /id="tax-limit" role="status"><\/span>/, "the limit status stays mounted while empty");
});

check("rows, select all, clear and remove report the next list through onChange", () => {
	const view = render({ selected: ["retired", "genre"] });
	row(view.tree, "category").control.props.onChange("noindex");
	row(view.tree, "genre").control.props.onChange("index");
	buttonByLabel(view.tree, SET_NOINDEX).props.onClick();
	buttonByLabel(view.tree, SET_INDEX).props.onClick();
	buttonByLabel(view.tree, "Remove the rule for retired").props.onClick();
	assert.deepEqual(view.changes, [
		["retired", "genre", "category"],
		["retired"],
		["retired", "genre", "category", "post_tag"],
		["retired"],
		["genre"],
	]);
	assert.deepEqual(view.focused, ["heading", "heading", "heading"], "Set all to Noindex, Set all to Index and the last Remove keep focus on the heading");
	const unchanged = render({ selected: ["category"] });
	row(unchanged.tree, "category").control.props.onChange("noindex");
	assert.deepEqual(unchanged.changes, [], "an unchanged list is not reported");
});

check("removing an unlisted name moves focus to its neighbour", () => {
	const view = render({ selected: ["first", "second", "third"] });
	for (const name of ["first", "second", "third"]) view.focusRemove(name);
	buttonByLabel(view.tree, "Remove the rule for second").props.onClick();
	buttonByLabel(view.tree, "Remove the rule for third").props.onClick();
	assert.deepEqual(view.changes, [["first", "third"], ["first", "second"]]);
	assert.deepEqual(view.focused, ["remove:third", "remove:second"], "the next name first, otherwise the previous one");
});

check("disabled locks every draft control", () => {
	const { tree } = render({ selected: ["retired", "category"], disabled: true });
	const locked = elements(tree).filter((item) => item.type === IndexingRuleControl);
	assert.equal(locked.length, 3, "control: every listed archive has a control");
	for (const node of locked) assert.equal((IndexingRuleControl(node.props) as Element).props.disabled, true);
	for (const label of [SET_NOINDEX, SET_INDEX, "Remove the rule for retired"]) {
		assert.equal(buttonByLabel(tree, label).props.disabled, true, label);
	}
});

check("loading, unreadable, empty, truncated and unloaded states stay distinct", () => {
	const loading = render({ definitions: null, loading: true });
	assert.match(loading.html, /role="status"[^>]*>Loading taxonomies\.\.\./);
	assert.equal(elements(loading.tree).some((node) => node.type === Banner), false);

	const failed = render({ definitions: null, error: "Read failed." });
	assert.match(failed.html, /Taxonomies could not be loaded/);
	assert.match(failed.html, /Read failed\./);
	assert.doesNotMatch(failed.html, /No taxonomies were found|Loading taxonomies/);
	assert.equal(elements(failed.tree).find((node) => node.type === Banner)?.props.role, "alert");
	buttonByLabel(failed.tree, "Retry").props.onClick();
	assert.equal(failed.retries(), 1);
	assert.deepEqual(failed.focused, ["heading"], "Retry moves focus before its banner can unmount");

	const stale = render({ error: "Refresh failed." });
	assert.match(stale.html, /The taxonomy list could not be refreshed/);
	row(stale.tree, "category");

	const empty = render({ definitions: [] });
	assert.match(empty.html, /No taxonomies were found on this site\./);
	assert.doesNotMatch(empty.html, /could not be loaded|Loading taxonomies/);
	assert.equal(elements(empty.tree).some((node) => node.type === "fieldset"), false);

	const truncated = render({ truncated: true, selected: ["beyond"] });
	assert.match(truncated.html, /Not every taxonomy is listed\./);
	assert.match(truncated.html, /may be outside the listed taxonomies/);

	const unloaded = render({ definitions: null });
	assert.match(unloaded.html, /Taxonomies are not loaded\./);
	buttonByLabel(unloaded.tree, "Load taxonomies").props.onClick();
	assert.equal(unloaded.retries(), 1);
});

check("unlisted and unloaded selections stay visible with their own removal", () => {
	const listed = render({ selected: ["retired"] });
	assert.match(listed.html, /Archive noindex rules not in this list/);
	assert.match(listed.html, /No longer found on this site/);
	assert.match(listed.html, /<code>retired<\/code>/);
	const unloaded = render({ definitions: null, loading: true, selected: ["category"] });
	assert.match(unloaded.html, /Shown by name until the taxonomies load\./);
	assert.match(unloaded.html, />Archive noindex rules<\/strong>/);
	buttonByLabel(unloaded.tree, "Remove the rule for category").props.onClick();
	assert.deepEqual(unloaded.changes, [[]]);
});

check("copy states the effect once without claiming live output", () => {
	const { html } = render({ selected: ["category"], validationError: "Use at most 100 taxonomies." });
	assert.match(html, /<h3[^>]*>Taxonomy archives<\/h3>/);
	assert.match(html, /id="tax-description">Noindex adds noindex to the archive pages of every term in the taxonomy\. Index lets those pages appear in search results\.<\/p>/);
	assert.match(html, /role="alert"[^>]*>Use at most 100 taxonomies\./);
	assert.match(html, /aria-describedby="tax-error"/);
	assert.doesNotMatch(html, /verified|is live|\bindexed\b/i);
	assert.doesNotMatch(html, /<code>category<\/code>/, "listed rows show the label, not the key");
	assert.doesNotMatch(html, /hidden from search|takes precedence|archive integration/, "repeated notes live in the page help");
});

check("each archive has an explicit Index or Noindex choice over the stored noindex list", () => {
	const view = render({ selected: ["genre"] });
	const category = row(view.tree, "category");
	const genre = row(view.tree, "genre");
	assert.equal(category.choice.type, IndexingChoiceGroup);
	assert.equal(category.choice.props.legend, "Search visibility for Categories archive pages");
	assert.notEqual(genre.choice.props.legend, category.choice.props.legend, "each group names its taxonomy");
	assert.equal(category.choice.props.value, "index", "not in the noindex list: Index");
	assert.equal(genre.choice.props.value, "noindex", "in the noindex list: Noindex");
	assert.match(genre.html, /<span>Noindex \(Archive rule\)<\/span>/);
	assert.match(category.html, /<span>Index<\/span>/);
	assert.equal(elements(view.tree).filter((node) => node.type === IndexingRuleControl).length, 3, "one control per listed taxonomy and no second control row");
	genre.control.props.onChange("index");
	category.control.props.onChange("noindex");
	assert.deepEqual(view.changes, [[], ["genre", "category"]], "the stored list keeps its noindex meaning");
	const pending = render({ selected: ["genre", "category"], saved: ["genre"] });
	assert.match(row(pending.tree, "category").html, /<span>Index<\/span>.*<span>After saving: Noindex \(Archive rule\)<\/span><span class="shipit-seo-indexing-tag">Unsaved<\/span>/);
	assert.doesNotMatch(row(pending.tree, "genre").html, /After saving/);
	const unknown = render({ selected: ["genre", "category"], saved: ["genre"], unconfirmed: true });
	assert.match(row(unknown.tree, "category").html, /After saving: Noindex \(Archive rule\)<\/span><span class="shipit-seo-indexing-tag">Save not confirmed<\/span>/,
		"after a save with an unknown outcome a pending row is not called unsaved");
	const kept = render({ selected: ["category"], saved: [], siteNoindex: true, unconfirmed: true });
	assert.match(row(kept.tree, "category").html, /Own rule kept: Noindex<\/span><span class="shipit-seo-indexing-tag">Save not confirmed<\/span>/,
		"nor is a kept rule sent in that save");
});

check("a draft site-wide noindex keeps every archive rule read-only and unchanged", () => {
	const view = render({ selected: ["genre", "retired"], siteNoindex: true });
	assert.doesNotMatch(view.html, /role="radiogroup"/, "no archive control while site-wide noindex is in the draft");
	assert.match(row(view.tree, "genre").html, /<span>Noindex \(Archive rule\)<\/span>.*After saving: Noindex \(Site-wide rule\).*<span>Own rule kept: Noindex<\/span><\/p>/);
	assert.match(row(view.tree, "category").html, /Own rule kept: Index<\/span><\/p>/);
	for (const label of [SET_NOINDEX, SET_INDEX]) assert.equal(buttonByLabel(view.tree, label).props.disabled, true, label + " waits for site-wide Index");
	assert.equal(buttonByLabel(view.tree, "Remove the rule for retired").props.disabled, false, "an unlisted rule can still be removed");
	assert.deepEqual(view.changes, []);
	const model = controls.taxonomyIndexingModel(rules(["genre"], ["genre"], true), definitions);
	assert.deepEqual([model.editable, model.canSelectAll, model.canClear], [false, false, false]);
	assert.deepEqual(model.selected, ["genre"], "the stored choice is kept");
	const nearly = Array.from({ length: LIMIT - 2 }, (_, index) => `t${index}`);
	assert.match(render({ selected: nearly }).html, /would pass the limit/, "control: the same list reports the limit while editable");
	for (const selected of [nearly, [...nearly, "t98", "t99"]]) {
		assert.match(render({ selected, siteNoindex: true }).html, /id="tax-limit" role="status"><\/span>/, "a read-only list reports no limit");
	}
});

check("the section follows the admin language", () => {
	for (const language of ["nl", "tr"]) {
		locale = language;
		const t = createSeoI18n(language).t;
		const view = render({ selected: ["retired"], definitions: null });
		assert.ok(view.html.includes(t("indexing.archives.title")), language + " title");
		assert.ok(view.html.includes(t("indexing.archives.unloadedTitle")));
		assert.notEqual(t("indexing.archives.title"), "Taxonomy archives", "control: the catalogue is translated");
		const listed = render({ selected: ["genre"] });
		assert.equal(row(listed.tree, "genre").choice.props.legend, t("indexing.archives.choiceFor", { taxonomy: "Genre" }));
		assert.ok(text(buttonByLabel(listed.tree, t("indexing.archives.setAllNoindex")).props.children).length > 0);
	}
	locale = "en";
});

check("the component owns no request, save, form, effect or timer", () => {
	for (const pattern of [/\buse(Layout)?Effect\b/, /\bfetch\(/, /\bset(Timeout|Interval)\b/, /<form\b/, /type="submit"/, /\buseState\b/, /\bSave\b/, /\bDiscard\b/, /components\/switch/]) {
		assert.doesNotMatch(source, pattern, String(pattern));
	}
	assert.doesNotMatch(source, /import .*\.css/, "admin.tsx imports workspace styles");
});

console.log(`Taxonomy archive indexing controls self-check passed (${cases} cases).`);
