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

import * as policy from "../content-type-noindex-policy.ts";
import { createSeoI18n } from "./i18n/messages.ts";
import * as rulesModel from "./indexing-rules-model.ts";

const source = readFileSync(new URL("./content-type-indexing-controls.tsx", import.meta.url), "utf8");
const containerSource = readFileSync(new URL("./content-type-indexing-container.tsx", import.meta.url), "utf8");
let refs: { current: any }[] = [];
let locale = "en";
const localReact = {
	...React,
	useId: () => "types",
	useRef: <T,>(current: T) => { const ref = { current }; refs.push(ref); return ref; },
};
const i18n = { useSeoI18n: () => createSeoI18n(locale) };
function load(file: string, modules: Record<string, unknown>) {
	const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
		fileName: file,
		reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
	});
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", compiled.outputText)(
		(name: string) => { assert.ok(Object.hasOwn(modules, name), "Unexpected import: " + name); return modules[name]; },
		output, output.exports,
	);
	return output.exports;
}
const status = load("./indexing-rule-status.tsx", {
	"react/jsx-runtime": jsx,
	"@phosphor-icons/react": icons,
	"@cloudflare/kumo/components/radio": radio,
	"./i18n/index.ts": i18n,
	"./indexing-rules-model.ts": rulesModel,
});
const controls = load("./content-type-indexing-controls.tsx", {
	react: localReact,
	"react/jsx-runtime": jsx,
	"@phosphor-icons/react": icons,
	"@cloudflare/kumo/components/banner": banner,
	"@cloudflare/kumo/components/button": button,
	"../content-type-noindex-policy.ts": policy,
	"./i18n/index.ts": i18n,
	"./indexing-rule-status.tsx": status,
	"./indexing-rules-model.ts": rulesModel,
});
const { IndexingRuleControl, IndexingChoiceGroup } = status;
const { Button } = button;
const { Banner } = banner;

type Element = React.ReactElement<Record<string, any>>;
function elements(tree: unknown): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const element = tree as Element;
	return [element, ...elements(element.props.children), ...elements(element.props.action)];
}
function text(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(text).join("");
	return React.isValidElement(node) ? text((node as Element).props.children) : "";
}
const sitemap = {
	owner: "shipit",
	groups: [
		{ key: "pages", label: "Pages", source: "default", urlPattern: null, unique: true },
		{ key: "posts", label: "Posts", source: "saved", urlPattern: null, unique: true },
		{ key: "events", label: "  ", source: "saved", urlPattern: "/events/{slug}", unique: true },
	],
	values: { contentTypes: { pages: true, posts: true, events: false }, excludedPaths: [] },
};
function render(props: Record<string, unknown> = {}) {
	const changes: string[][] = [];
	let retries = 0;
	let sitemaps = 0;
	refs = [];
	const merged = { selected: [] as string[], saved: [] as string[], sitemap, loading: false, error: null, disabled: false,
		siteNoindex: false, savedSiteNoindex: false, onChange: (names: string[]) => changes.push(names), onRetry: () => { retries += 1; }, onOpenSitemaps: () => { sitemaps += 1; }, ...props };
	const tree = controls.ContentTypeIndexingControls(merged) as Element;
	const focused: string[] = [];
	refs[0]!.current = { focus: () => focused.push("heading") };
	return { tree, html: renderToStaticMarkup(tree), changes, focused, retries: () => retries, sitemaps: () => sitemaps };
}
function row(tree: Element, key: string) {
	const item = elements(tree).find((node) => node.type === "li" && node.key === key);
	assert.ok(item, "Row exists: " + key);
	const control = elements(item).find((node) => node.type === IndexingRuleControl)!;
	assert.ok(control, "Row has its rule control: " + key);
	const choice = IndexingRuleControl(control.props) as Element;
	return { item, control, choice, html: renderToStaticMarkup(item) };
}
const rules = (selected: string[], saved = selected, siteNoindex = false, savedSiteNoindex = false) => ({ selected, saved, siteNoindex, savedSiteNoindex });
const en = createSeoI18n("en");
let cases = 0;
function check(run: () => void) { run(); cases += 1; }

const summary = (model: any) => model.rows.map((item: any) => [item.key, item.label, item.status.saved.choice, item.status.after?.choice ?? null, item.status.own, item.status.editable]);
check(() => {
	const model = controls.contentTypeIndexingModel(rules(["posts", "retired", "posts"], ["pages"]), sitemap);
	assert.deepEqual(model.selected, ["posts", "retired"]);
	assert.deepEqual(model.unlisted, ["retired"], "rules for removed types stay visible by name");
	assert.deepEqual(summary(model), [
		["pages", "Pages", "noindex", "index", "index", true],
		["posts", "Posts", "index", "noindex", "noindex", true],
		["events", "events", "index", null, "index", true],
	], "each row reads its saved effect, with the draft only as what saving would apply; a custom type is listed like any other");
	const siteWide = controls.contentTypeIndexingModel(rules(["posts"], ["posts"], true), sitemap);
	assert.deepEqual(summary(siteWide), [
		["pages", "Pages", "index", "noindex", "index", false],
		["posts", "Posts", "noindex", "noindex", "noindex", false],
		["events", "events", "index", "noindex", "index", false],
	], "a draft site-wide noindex makes every row read-only and keeps each own rule");
	assert.deepEqual(siteWide.rows[1].status.after, { choice: "noindex", source: "site" });
	assert.deepEqual(controls.contentTypeIndexingModel(rules(["posts"]), null), { rows: [], unlisted: ["posts"], selected: ["posts"], atLimit: false });
});

check(() => {
	assert.deepEqual(controls.toggleContentTypeNoindex(["posts"], "events", false), ["events", "posts"], "a new rule keeps the stored canonical order");
	assert.deepEqual(controls.toggleContentTypeNoindex(["events", "posts"], "posts", true), ["events"]);
	assert.deepEqual(controls.toggleContentTypeNoindex(["posts"], "posts", false), ["posts"]);
	const full = Array.from({ length: policy.CONTENT_TYPE_NOINDEX_LIMIT }, (_, index) => `t${String(index).padStart(3, "0")}`);
	assert.deepEqual(controls.toggleContentTypeNoindex(full, "pages", false), full, "the limit holds");
	const toggled = controls.toggleContentTypeNoindex(controls.toggleContentTypeNoindex(["events", "posts"], "pages", false), "pages", true);
	assert.ok(controls.sameContentTypeNames(toggled, ["events", "posts"]), "turning a type off and on returns the saved list");
	assert.ok(policy.isStoredContentTypeNoindex(controls.toggleContentTypeNoindex(["posts"], "events", false)), "drafts are valid stored lists");
});

check(() => {
	const view = render({ selected: ["posts"], saved: ["posts"] });
	const posts = row(view.tree, "posts");
	const pages = row(view.tree, "pages");
	assert.equal(posts.choice.type, IndexingChoiceGroup, "an explicit Index or Noindex choice per row");
	assert.equal(posts.choice.props.legend, en.t("indexing.types.choiceFor", { type: "Posts" }));
	assert.notEqual(posts.choice.props.legend, pages.choice.props.legend, "each group names its own type");
	assert.equal(posts.choice.props.value, "noindex");
	assert.equal(pages.choice.props.value, "index");
	assert.match(posts.html, /<span>Noindex \(Content type rule\)<\/span>/);
	assert.match(pages.html, /data-choice="index"[^>]*><svg[^>]*>.*?<\/svg><span>Index<\/span>/);
	assert.match(posts.html, /role="radiogroup"/);
	assert.doesNotMatch(view.html, /After saving/, "a clean draft has no pending line");
	assert.doesNotMatch(view.html, /<code>/, "rows show the label, not the key");
	assert.doesNotMatch(view.html, /sitemap\.xml|included|not selected/i, "no per-row sitemap text");
	pages.control.props.onChange("noindex");
	posts.control.props.onChange("index");
	posts.control.props.onChange("noindex");
	assert.deepEqual(view.changes, [["pages", "posts"], []], "only real changes are reported");
	const edits = elements(view.tree).filter((node) => node.type === Button && text(node.props.children) === en.t("indexing.types.editSitemap"));
	assert.equal(edits.length, 1, "one Edit in Sitemaps for the section");
	assert.equal(elements(pages.item).some((node) => node.type === Button), false, "no per-row Sitemaps button");
	edits[0]!.props.onClick();
	assert.equal(view.sitemaps(), 1, "Edit in Sitemaps opens Sitemaps");
	assert.match(view.html, /id="types-description">Noindex adds noindex to every entry of the type and leaves the type out of a sitemap served by this plugin\. Index lets entries appear in search results unless an entry sets its own noindex\.<\/p>/);
	assert.doesNotMatch(view.html, /\b(?:is|are) indexed\b|guarantee/i, "Index is never described as a guarantee for an entry");
	const pending = render({ selected: ["pages", "posts"], saved: ["posts"] });
	const changed = row(pending.tree, "pages");
	assert.match(changed.html, /<span>Index<\/span>.*<span>After saving: Noindex \(Content type rule\)<\/span><span class="shipit-seo-indexing-tag">Unsaved<\/span>/,
		"the saved state stays first and the draft reads as after saving");
	assert.equal(changed.choice.props.value, "noindex", "the control follows the draft");
	assert.doesNotMatch(row(pending.tree, "posts").html, /After saving/);
	const unknown = render({ selected: ["pages", "posts"], saved: ["posts"], unconfirmed: true });
	assert.match(row(unknown.tree, "pages").html, /After saving: Noindex \(Content type rule\)<\/span><span class="shipit-seo-indexing-tag">Save not confirmed<\/span>/,
		"after a save with an unknown outcome a pending row is not called unsaved");
	const kept = render({ selected: ["pages"], saved: [], siteNoindex: true, unconfirmed: true });
	assert.match(row(kept.tree, "pages").html, /Own rule kept: Noindex<\/span><span class="shipit-seo-indexing-tag">Save not confirmed<\/span>/,
		"nor is a kept rule sent in that save");
});

check(() => {
	const view = render({ selected: ["posts", "retired"] });
	assert.match(view.html, new RegExp(en.t("indexing.types.unlistedTitle")));
	assert.match(view.html, /<code>retired<\/code>/);
	const remove = elements(view.tree).find((node) => node.type === Button && node.props["aria-label"] === en.t("indexing.types.removeNamed", { type: "retired" }))!;
	remove.props.onClick();
	assert.deepEqual(view.changes, [["posts"]], "a removed type's rule can be removed");
	assert.deepEqual(view.focused, ["heading"], "focus moves before the button unmounts");
	const unloaded = render({ selected: ["posts"], sitemap: null, loading: true });
	assert.match(unloaded.html, new RegExp(en.t("indexing.types.unloadedHelp")));
	assert.match(unloaded.html, new RegExp(en.t("indexing.types.loading").replace(/\./g, "\\.")));
	assert.equal(elements(unloaded.tree).some((node) => node.type === IndexingRuleControl), false, "no control before the types load");
});

check(() => {
	const disabled = render({ selected: ["posts", "retired"], disabled: true });
	const locked = elements(disabled.tree).filter((item) => item.type === IndexingRuleControl);
	assert.equal(locked.length, 3, "control: every row has a control");
	for (const node of locked) assert.equal((IndexingRuleControl(node.props) as Element).props.disabled, true);
	const remove = elements(disabled.tree).find((node) => node.type === Button && node.props["aria-label"]?.startsWith("Remove"));
	assert.equal(remove?.props.disabled, true);
	const full = Array.from({ length: 100 }, (_, index) => `t${String(index).padStart(3, "0")}`);
	const limited = render({ selected: full });
	assert.equal(row(limited.tree, "pages").choice.props.noindexDisabled, true, "no new rule past the limit");
	assert.equal(row(limited.tree, "pages").choice.props.disabled, false, "Index stays available");
	assert.match(limited.html, /Limit of 100 content types reached\./);
	const fullWithPosts = render({ selected: [...full.slice(0, 99), "posts"].sort() });
	assert.equal(row(fullWithPosts.tree, "posts").choice.props.noindexDisabled, false, "a ruled type can always return to Index");
});

check(() => {
	const failed = render({ sitemap: null, error: "Sitemaps unavailable." });
	const alert = elements(failed.tree).find((node) => node.type === Banner)!;
	assert.equal(alert.props.role, "alert");
	assert.equal(alert.props.title, en.t("indexing.types.loadFailed"));
	assert.deepEqual(failed.focused, [], "control: nothing has moved focus yet");
	alert.props.action.props.onClick();
	assert.equal(failed.retries(), 1);
	assert.deepEqual(failed.focused, ["heading"], "Retry moves focus to the heading before it turns off and its banner leaves");
	const empty = render({ sitemap: { ...sitemap, groups: [] } });
	assert.match(empty.html, new RegExp(en.t("indexing.types.empty")));
	const siteWide = render({ siteNoindex: true, selected: ["posts"], saved: ["posts"] });
	assert.doesNotMatch(siteWide.html, /role="radiogroup"/, "no type control while the draft has site-wide noindex");
	assert.match(row(siteWide.tree, "posts").html, /<span>Noindex \(Content type rule\)<\/span>.*After saving: Noindex \(Site-wide rule\).*<span>Own rule kept: Noindex<\/span><\/p>/);
	assert.match(row(siteWide.tree, "pages").html, /<span>Index<\/span>.*After saving: Noindex \(Site-wide rule\).*<span>Own rule kept: Index<\/span><\/p>/);
	assert.doesNotMatch(siteWide.html, /overrides the content type/, "the page states the override once, above the sections");
	const invalid = render({ validationError: "Choose available content types." });
	assert.match(invalid.html, /id="types-error" class="shipit-seo-form-error" role="alert">Choose available content types\./);
	assert.match(invalid.html, /<fieldset[^>]*aria-describedby="types-error"/);
});

check(() => {
	for (const language of ["nl", "tr"]) {
		locale = language;
		const t = createSeoI18n(language).t;
		const view = render({ selected: ["posts"] });
		assert.equal(row(view.tree, "posts").choice.props.legend, t("indexing.types.choiceFor", { type: "Posts" }));
		assert.match(view.html, new RegExp(t("indexing.types.title")));
		assert.ok(view.html.includes(t("indexing.types.effect")));
		assert.ok(view.html.includes(t("indexing.state.withSource", { state: t("indexing.state.noindex"), source: t("indexing.source.type") })));
		assert.notEqual(t("indexing.types.choiceFor", { type: "Posts" }), en.t("indexing.types.choiceFor", { type: "Posts" }), "control: the catalogue is translated");
	}
	locale = "en";
});

check(() => {
	for (const pattern of [/\buse(Layout)?Effect\b/, /\bfetch\(/, /\bset(Timeout|Interval)\b/, /<form\b/, /type="submit"/, /\buseState\b/, /components\/switch/]) {
		assert.doesNotMatch(source, pattern, String(pattern));
	}
	assert.match(containerSource, /queryKey: seoWorkspaceKeys\.sitemap/, "the overview shares the Sitemaps page configuration");
	assert.doesNotMatch(containerSource, /refetchInterval|setInterval|saveSeo|mutate/, "the overview never writes or polls");
});

console.log(`Content type indexing controls self-check passed (${cases} cases).`);
