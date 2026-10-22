import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import * as radio from "@cloudflare/kumo/components/radio";

import { SEO_CATALOGUES, createSeoI18n } from "./i18n/messages.ts";
import * as model from "./indexing-rules-model.ts";

const {
	effectiveIndexing, indexingEffectText, indexingRuleStatus, indexingSitemapServing, listedIndexingRuleStatus, siteIndexingStatus,
} = model;
const en = createSeoI18n("en");
let locale = "en";
let cases = 0;
function check(run: () => void) { run(); cases += 1; }

check(() => {
	assert.deepEqual(effectiveIndexing(true, false, "type"), { choice: "noindex", source: "site" }, "site-wide noindex applies without an own rule");
	assert.deepEqual(effectiveIndexing(true, true, "archive"), { choice: "noindex", source: "site" }, "site-wide noindex wins over the own rule");
	assert.deepEqual(effectiveIndexing(false, true, "type"), { choice: "noindex", source: "type" });
	assert.deepEqual(effectiveIndexing(false, true, "archive"), { choice: "noindex", source: "archive" });
	assert.deepEqual(effectiveIndexing(false, false, "type"), { choice: "index", source: null });
});

check(() => {
	assert.deepEqual(siteIndexingStatus(false, false), { saved: { choice: "index", source: null }, after: null });
	assert.deepEqual(siteIndexingStatus(true, true), { saved: { choice: "noindex", source: "site" }, after: null });
	assert.deepEqual(siteIndexingStatus(false, true).after, { choice: "noindex", source: "site" }, "a pending site-wide change is only an after-saving line");
	assert.deepEqual(siteIndexingStatus(false, true).saved, { choice: "index", source: null }, "the saved state stays the live one");
	assert.deepEqual(siteIndexingStatus(true, false).after, { choice: "index", source: null });
});

check(() => {
	const row = (saved: [boolean, boolean], draft: [boolean, boolean]) =>
		indexingRuleStatus("type", { siteNoindex: saved[0], noindex: saved[1] }, { siteNoindex: draft[0], noindex: draft[1] });
	assert.deepEqual(row([false, true], [false, true]),
		{ saved: { choice: "noindex", source: "type" }, after: null, own: "noindex", ownUnsaved: false, editable: true });
	assert.deepEqual(row([false, true], [false, false]),
		{ saved: { choice: "noindex", source: "type" }, after: { choice: "index", source: null }, own: "index", ownUnsaved: true, editable: true },
		"a pending own choice shows as after saving, never as the saved state");
	assert.deepEqual(row([false, false], [true, false]),
		{ saved: { choice: "index", source: null }, after: { choice: "noindex", source: "site" }, own: "index", ownUnsaved: false, editable: false },
		"a draft site-wide noindex makes the row read-only and keeps its own rule");
	assert.deepEqual(row([false, true], [true, true]).after, { choice: "noindex", source: "site" }, "a change of source is a change of effect");
	assert.deepEqual(row([true, true], [false, true]),
		{ saved: { choice: "noindex", source: "site" }, after: { choice: "noindex", source: "type" }, own: "noindex", ownUnsaved: false, editable: true },
		"the kept own rule applies again when site-wide returns to Index");
	assert.deepEqual(row([true, false], [true, false]),
		{ saved: { choice: "noindex", source: "site" }, after: null, own: "index", ownUnsaved: false, editable: false });
	assert.equal(row([false, false], [true, true]).ownUnsaved, true, "an own change made before site-wide noindex stays marked unsaved");
});

check(() => {
	const lists = { selected: ["posts"], saved: ["posts"], siteNoindex: false, savedSiteNoindex: false };
	const before = { ...lists, selected: [...lists.selected], saved: [...lists.saved] };
	const on = listedIndexingRuleStatus("type", { ...lists, siteNoindex: true }, "posts");
	const off = listedIndexingRuleStatus("type", lists, "posts");
	assert.equal(on.own, "noindex");
	assert.equal(on.ownUnsaved, false, "site-wide noindex on keeps the stored own rule");
	assert.deepEqual(off, { saved: { choice: "noindex", source: "type" }, after: null, own: "noindex", ownUnsaved: false, editable: true },
		"with site-wide Index the kept own rule is the editable saved state again");
	assert.deepEqual(off.after, null);
	assert.deepEqual(lists, before, "reading a row never rewrites the lists");
	assert.equal(listedIndexingRuleStatus("archive", { ...lists, selected: [] }, "posts").after?.choice, "index");
	assert.equal(listedIndexingRuleStatus("archive", lists, "tags").saved.choice, "index", "an unruled name reads Index");
});

check(() => {
	assert.equal(indexingEffectText({ choice: "index", source: null }, en.t), "Index");
	assert.equal(indexingEffectText({ choice: "noindex", source: "type" }, en.t), "Noindex (Content type rule)");
	assert.equal(indexingEffectText({ choice: "noindex", source: "archive" }, en.t), "Noindex (Archive rule)");
	assert.equal(indexingEffectText({ choice: "noindex", source: "site" }, en.t), "Noindex (Site-wide rule)");
	assert.equal(indexingEffectText({ choice: "noindex", source: "site" }, en.t, false), "Noindex", "the site-wide block names its own source");
	const nl = createSeoI18n("nl");
	const tr = createSeoI18n("tr");
	assert.equal(indexingEffectText({ choice: "noindex", source: "type" }, nl.t), "Noindex (Regel per inhoudstype)");
	assert.equal(indexingEffectText({ choice: "noindex", source: "archive" }, tr.t), "Noindex (Arşiv kuralı)");
});

check(() => {
	assert.equal(indexingSitemapServing("shipit"), "served");
	for (const owner of ["module-off", "site-route", "static-file", "integration", "unknown"]) assert.equal(indexingSitemapServing(owner), "not-served", owner);
	assert.equal(indexingSitemapServing(undefined), null, "no ownership is claimed before the sitemap read");
	assert.equal(indexingSitemapServing(null), null);
});

// Index on a content type only means the type adds no noindex; an entry can still add its own.
check(() => {
	const guarantee = /guarantee|always (?:be )?indexed|will (?:be )?(?:indexed|appear)|\b(?:is|are) indexed\b/i;
	assert.match("Entries are indexed.", guarantee, "control: the guard flags a guarantee");
	const copy = Object.entries(SEO_CATALOGUES.en).filter(([key]) => key.startsWith("indexing."));
	assert.ok(copy.length > 40, "control: the Indexing copy is read");
	for (const [key, text] of copy) assert.doesNotMatch(text, guarantee, key);
	assert.match(en.t("indexing.types.effect"), /Index lets entries appear in search results unless an entry sets its own noindex\./);
	assert.match(en.t("indexing.site.indexEffect"), /^Pages can appear in search results unless /);
	assert.match(en.t("indexing.precedence.optIn"), /can only add noindex/);
});

const source = readFileSync(new URL("./indexing-rule-status.tsx", import.meta.url), "utf8");
const modules: Record<string, unknown> = {
	"react/jsx-runtime": jsx,
	"@phosphor-icons/react": icons,
	"@cloudflare/kumo/components/radio": radio,
	"./i18n/index.ts": { useSeoI18n: () => createSeoI18n(locale) },
	"./indexing-rules-model.ts": model,
};
const compiled = ts.transpileModule(source, {
	fileName: "indexing-rule-status.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} as Record<string, any> };
new Function("require", "module", "exports", compiled.outputText)(
	(name: string) => { assert.ok(Object.hasOwn(modules, name), "Unexpected import: " + name); return modules[name]; },
	output, output.exports,
);
const { IndexingSavedState, IndexingPendingState, IndexingChoiceGroup, IndexingRuleControl } = output.exports;
const { Radio } = radio;
type Element = React.ReactElement<Record<string, any>>;
function elements(tree: unknown): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as Element;
	return [element, ...elements(element.props.children)];
}
const html = (element: unknown) => renderToStaticMarkup(element as React.ReactElement);

check(() => {
	const index = html(React.createElement(IndexingSavedState, { effect: { choice: "index", source: null } }));
	assert.match(index, /^<p class="shipit-seo-indexing-state" data-choice="index"><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg><span>Index<\/span><\/p>$/,
		"the state is text with an icon, not colour alone");
	const ruled = html(React.createElement(IndexingSavedState, { effect: { choice: "noindex", source: "type" } }));
	assert.match(ruled, /data-choice="noindex".*<span>Noindex \(Content type rule\)<\/span>/);
	assert.equal(IndexingPendingState({ effect: null }), null, "nothing pending, no second line");
	const pending = html(React.createElement(IndexingPendingState, { effect: { choice: "noindex", source: "archive" } }));
	assert.match(pending, /<span>After saving: Noindex \(Archive rule\)<\/span><span class="shipit-seo-indexing-tag">Unsaved<\/span>/);
	locale = "tr";
	assert.match(html(React.createElement(IndexingPendingState, { effect: { choice: "index", source: null } })), /Kaydettikten sonra: Index.*Kaydedilmemiş/);
	locale = "en";
	const unknown = html(React.createElement(IndexingPendingState, { effect: { choice: "noindex", source: "archive" }, unconfirmed: true }));
	assert.match(unknown, /<span>After saving: Noindex \(Archive rule\)<\/span><span class="shipit-seo-indexing-tag">Save not confirmed<\/span>/,
		"after a save with an unknown outcome the pending line is not called unsaved");
});

check(() => {
	const changes: string[] = [];
	const group = IndexingChoiceGroup({ legend: "Search visibility for Posts", value: "index", disabled: false, onChange: (choice: string) => changes.push(choice) }) as Element;
	assert.equal(group.type, Radio.Group, "an explicit radio group, not a switch");
	assert.equal(group.props.orientation, "horizontal");
	assert.equal(group.props.value, "index");
	const parts = elements(group.props.children);
	const legend = parts.find((node) => node.type === Radio.Legend)!;
	assert.equal(legend.props.className, "sr-only");
	assert.equal(legend.props.children, "Search visibility for Posts", "the group names its item");
	assert.deepEqual(parts.filter((node) => node.type === Radio.Item).map((node) => [node.props.value, node.props.label, node.props.disabled]),
		[["index", "Index", undefined], ["noindex", "Noindex", false]]);
	group.props.onValueChange("index");
	group.props.onValueChange("other");
	group.props.onValueChange("noindex");
	assert.deepEqual(changes, ["noindex"], "only a real change to a known choice is reported");
	const limited = IndexingChoiceGroup({ legend: "x", value: "index", disabled: true, noindexDisabled: true, onChange() {} }) as Element;
	assert.equal(limited.props.disabled, true);
	assert.equal(elements(limited.props.children).filter((node) => node.type === Radio.Item)[1]!.props.disabled, true);
	assert.match(html(group), /role="radiogroup"/);
});

check(() => {
	const editable = indexingRuleStatus("type", { siteNoindex: false, noindex: false }, { siteNoindex: false, noindex: false });
	const control = IndexingRuleControl({ status: editable, legend: "Posts", disabled: false, atLimit: true, onChange() {} }) as Element;
	assert.equal(control.type, IndexingChoiceGroup);
	assert.equal(control.props.noindexDisabled, true, "no new noindex past the limit");
	const ruled = indexingRuleStatus("type", { siteNoindex: false, noindex: true }, { siteNoindex: false, noindex: true });
	assert.equal((IndexingRuleControl({ status: ruled, legend: "Posts", disabled: false, atLimit: true, onChange() {} }) as Element).props.noindexDisabled, false,
		"a ruled item can always return to Index at the limit");
	const kept = indexingRuleStatus("type", { siteNoindex: false, noindex: false }, { siteNoindex: true, noindex: false });
	const readOnly = IndexingRuleControl({ status: kept, legend: "Posts", disabled: false, atLimit: false, onChange() { throw new Error("read-only"); } }) as Element;
	assert.notEqual(readOnly.type, IndexingChoiceGroup, "no control while site-wide noindex is in the draft");
	assert.equal(elements(readOnly).some((node) => node.type === Radio.Group), false);
	assert.match(html(readOnly), /<p class="shipit-seo-indexing-kept"><svg[^>]*>.*<\/svg><span>Own rule kept: Index<\/span><\/p>/);
	const changedFirst = indexingRuleStatus("type", { siteNoindex: false, noindex: false }, { siteNoindex: true, noindex: true });
	assert.match(html(IndexingRuleControl({ status: changedFirst, legend: "Posts", disabled: false, atLimit: false, onChange() {} })),
		/Own rule kept: Noindex<\/span><span class="shipit-seo-indexing-tag">Unsaved<\/span>/, "a kept rule changed in this draft says so");
	assert.match(html(IndexingRuleControl({ status: changedFirst, legend: "Posts", disabled: false, atLimit: false, unconfirmed: true, onChange() {} })),
		/Own rule kept: Noindex<\/span><span class="shipit-seo-indexing-tag">Save not confirmed<\/span>/, "a kept rule sent in an unconfirmed save is not called unsaved");
});

// A kept draft carries its own list edits onto lists another editor saved since; other fields are untouched.
check(() => {
	const { rebaseIndexingNameLists } = model;
	const draft = { contentTypeNoindex: ["posts"], taxonomyArchiveNoindex: [], noindex: true, siteName: "Draft name" };
	const base = { contentTypeNoindex: [], taxonomyArchiveNoindex: ["genre"] };
	const next = { contentTypeNoindex: ["pages"], taxonomyArchiveNoindex: ["genre", "region"] };
	assert.deepEqual(rebaseIndexingNameLists(draft, base, next), { contentTypeNoindex: ["pages", "posts"], taxonomyArchiveNoindex: ["region"], noindex: true, siteName: "Draft name" },
		"an added and a removed name apply to the newer lists; scalar fields are returned as they were");
	assert.deepEqual(draft.contentTypeNoindex, ["posts"], "the draft passed in is not changed");
	assert.deepEqual(rebaseIndexingNameLists({ contentTypeNoindex: ["posts"] }, { contentTypeNoindex: [] }, { contentTypeNoindex: ["posts"] }), {},
		"a list that already holds this draft's change is no longer a draft");
	assert.deepEqual(rebaseIndexingNameLists({ contentTypeNoindex: ["events", "posts"] }, { contentTypeNoindex: ["events", "posts"] }, { contentTypeNoindex: ["pages"] }), {},
		"a list this draft did not change follows the other editor, removals included");
	assert.deepEqual(rebaseIndexingNameLists({ contentTypeNoindex: ["pages"] }, { contentTypeNoindex: ["pages", "posts"] }, { contentTypeNoindex: ["events", "pages", "posts"] }),
		{ contentTypeNoindex: ["events", "pages"] }, "a removal stays removed beside the other editor's addition");
	assert.deepEqual(rebaseIndexingNameLists({ taxonomyArchiveNoindex: ["tag", "genre"] }, { taxonomyArchiveNoindex: ["genre"] }, {}),
		{ taxonomyArchiveNoindex: ["tag"] }, "a newer record without the list keeps only this draft's additions, sorted as stored");
	const scalarOnly: { twitterHandle: string; contentTypeNoindex?: string[] } = { twitterHandle: "@draft" };
	assert.deepEqual(rebaseIndexingNameLists(scalarOnly, base, next), { twitterHandle: "@draft" }, "a draft without lists is unchanged");
});

console.log(`Indexing rules status model self-check passed (${cases} cases).`);
