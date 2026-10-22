import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { ArrowUpRight } from "@phosphor-icons/react";
import type { SeoAdminSitemapPreviewRequest } from "../admin-contract.ts";
import * as model from "./sitemap-view-model.ts";

type Props = Record<string, unknown> & { children?: React.ReactNode };
type QueryState = { data?: unknown; error?: unknown; isError: boolean; isFetching: boolean };
type Plan = { collection: string; label: string; files: Array<string | null> };
const source = await readFile(new URL("./sitemap-view.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("sitemap-view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = (name: string) => {
	const found = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
	assert.ok(found, "production declaration exists: " + name);
	return found as ts.FunctionDeclaration;
};
const statusLabels = parsed.statements.find((node) => ts.isVariableStatement(node) &&
	node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === "STATUS_LABELS"));
assert.ok(statusLabels);
const component = declaration("SitemapPreview");
const stateNames = component.body!.statements.flatMap((node) => ts.isVariableStatement(node)
	? node.declarationList.declarations.filter((item) => ts.isCallExpression(item.initializer!) &&
		item.initializer!.expression.getText(parsed) === "React.useState").map((item) =>
		(ts.isArrayBindingPattern(item.name) ? item.name.elements[0]!.getText(parsed) : ""))
	: []);
assert.deepEqual(stateNames, ["position", "filters", "searchText", "previous", "refresh"],
	"the probe retains the production state boundaries rather than replacing request logic");
const state = new Map<string, unknown>();
let hook = 0;
let query: QueryState = { isError: false, isFetching: false };
let queryOptions: Props;
const effects: Array<() => unknown> = [];
const buttons: Props[] = [];
const selects: Props[] = [];
const inputs: Props[] = [];
const requests: Array<{ input: SeoAdminSitemapPreviewRequest; signal: AbortSignal }> = [];
const ProbeReact = {
	...React,
	useState(initial: unknown) {
		const key = stateNames[hook++]!;
		assert.ok(key, "every state hook belongs to the inspected production component");
		if (!state.has(key)) state.set(key, typeof initial === "function" ? initial() : initial);
		return [state.get(key), (value: unknown) => state.set(key, typeof value === "function" ? value(state.get(key)) : value)];
	},
	useEffect(effect: () => unknown) { effects.push(effect); },
};
const Button = (props: Props) => {
	buttons.push(props);
	return React.createElement("button", {
		type: props.type as "button" | "submit" | undefined, disabled: Boolean(props.disabled),
		"aria-label": props["aria-label"] as string | undefined, title: props.title as string | undefined,
	}, props.children);
};
const Select = (props: Props) => {
	selects.push(props);
	return React.createElement("label", null, props.label as string,
		React.createElement("select", { "aria-label": props.label as string, value: props.value as string, onChange() {} },
			Object.entries(props.items as Record<string, string>).map(([value, label]) => React.createElement("option", { key: value, value }, label))));
};
const Input = (props: Props) => {
	inputs.push(props);
	return React.createElement("label", null, props.label as string,
		React.createElement("input", {
			type: props.type as string, value: props.value as string, onChange() {}, maxLength: props.maxLength as number,
			placeholder: props.placeholder as string, "aria-label": props.label as string,
		}));
};
const element = (tag: string) => ({ children, ...props }: Props) => React.createElement(tag, props, children);
const Table = Object.assign(element("table"), {
	Header: element("thead"), Body: element("tbody"), Row: element("tr"), Head: element("th"), Cell: element("td"),
});
const compiled = ts.transpileModule([
	statusLabels.getText(parsed), declaration("readableDate").getText(parsed), declaration("PublicLink").getText(parsed),
	component.getText(parsed), "module.exports = { SitemapPreview };",
].join("\n"), {
	fileName: "sitemap-preview-probe.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const context = {
	React: ProbeReact, useQuery: (options: Props) => { queryOptions = options; return query; },
	previewSeoAdminSitemap: async (input: SeoAdminSitemapPreviewRequest, options: { signal: AbortSignal }) => {
		requests.push({ input, signal: options.signal }); return query.data;
	},
	seoWorkspaceKeys: { sitemap: ["sitemap"] }, Button, Select, Input, Table, ArrowUpRight,
	ArrowClockwise: () => null, MagnifyingGlass: () => null, CaretLeft: () => null, CaretRight: () => null,
	Badge: ({ children }: Props) => React.createElement("span", null, children),
	Banner: ({ title, description, action }: Props) => React.createElement("aside", { role: "alert" },
		React.createElement("strong", null, title as string), React.createElement("p", null, description as string), action as React.ReactNode),
	Empty: ({ title, description }: Props) => React.createElement("div", null,
		React.createElement("strong", null, title as string), React.createElement("p", null, description as string)),
	...model,
};
const module = { exports: {} as { SitemapPreview: (props: { configuration: unknown }) => React.ReactNode } };
const requireReact = createRequire(import.meta.resolve("react"));
new Function("require", "module", "exports", ...Object.keys(context), compiled.outputText)(
	(name: string) => {
		assert.equal(name, "react/jsx-runtime", "the production snippet has no uninspected module side effects");
		return requireReact(name);
	}, module, module.exports, ...Object.values(context),
);

function start(plans: Plan[], patches: Record<string, unknown> = {}) {
	state.clear(); requests.length = 0;
	state.set("position", { collection: plans[0]?.collection ?? null, fileIndex: 0 });
	state.set("filters", model.initialSitemapExplorerFilters());
	state.set("searchText", ""); state.set("previous", null); state.set("refresh", 0);
	for (const [key, value] of Object.entries(patches)) state.set(key, value);
	query = { isError: false, isFetching: false };
	return { revision: "saved-revision-1", plan: plans };
}
function render(configuration: unknown) {
	hook = 0; effects.length = 0; buttons.length = 0; selects.length = 0; inputs.length = 0;
	const tree = module.exports.SitemapPreview({ configuration });
	assert.equal(hook, stateNames.length);
	return { tree, html: renderToStaticMarkup(React.createElement(React.Fragment, null, tree)) };
}
function nativeNode(tree: React.ReactNode, tag: string): React.ReactElement<Props> | undefined {
	if (!React.isValidElement<Props>(tree)) return undefined;
	if (tree.type === tag) return tree;
	for (const child of React.Children.toArray(tree.props.children)) {
		const match = nativeNode(child, tag); if (match) return match;
	}
	return undefined;
}
function byLabel(items: Props[], label: string) {
	const matches = items.filter((item) => item.label === label);
	assert.equal(matches.length, 1, "one named control: " + label);
	return matches[0]!;
}
function button(label: string) {
	const matches = buttons.filter((item) => item.children === label || item["aria-label"] === label);
	assert.equal(matches.length, 1, "one named action: " + label);
	return matches[0]!;
}
async function requested() {
	assert.equal(queryOptions.enabled, true);
	assert.equal(queryOptions.retry, false);
	assert.equal(queryOptions.refetchOnWindowFocus, false);
	assert.equal(queryOptions.refetchOnReconnect, false);
	const signal = new AbortController().signal;
	await (queryOptions.queryFn as (context: { signal: AbortSignal }) => Promise<unknown>)({ signal });
	assert.equal(requests.at(-1)?.signal, signal, "the real bounded request retains cancellation");
	return requests.at(-1)!.input;
}
function result(input: Partial<SeoAdminSitemapPreviewRequest> = {}, patch: Partial<model.SitemapPreviewSuccess> = {}): model.SitemapPreviewSuccess {
	const values = {
		success: true as const, collection: input.collection ?? "posts", after: input.after ?? null,
		fileUrl: "https://example.invalid/sitemap-posts.xml", included: 480, excluded: 20, total: 500,
		matched: 500, search: input.search ?? "", status: input.status ?? "all", limit: input.limit ?? 25,
		offset: 0, previousCursor: null, nextCursor: "rows-next",
		...patch,
	};
	const entries = patch.entries ?? Array.from({ length: Math.min(values.limit, values.matched - values.offset) }, (_, index) => ({
		id: `entry-${values.offset + index + 1}`, locale: "en", status: "included" as const,
		path: index === 0 ? "/posts/first" : `/posts/item-${values.offset + index + 1}`,
		url: index === 0 ? "https://example.invalid/posts/first" : `https://example.invalid/posts/item-${values.offset + index + 1}`,
		lastmod: "2026-10-21T12:00:00.000Z", image: null, canonical: null, alternates: 0,
	}));
	return { ...values, entries };
}
const single = [{ collection: "posts", label: "Posts", files: [null] }];
const oneConfiguration = start(single);
query.data = result({}, { total: 1, included: 1, excluded: 0, matched: 1, nextCursor: null });
const one = render(oneConfiguration);
assert.match(one.html, /<strong>1 entry<\/strong>/);
assert.equal(selects.some((item) => item.label === "Sitemap file"), false, "one public file needs no file picker");
assert.doesNotMatch(one.html, /<nav[^>]*aria-label="(?:Sitemap files|Preview rows)"/, "a single file and row page have no dead pager");
assert.match(one.html, /shipit-seo-table-wrap--sitemap/, "the table has its own responsive scope");
assert.match(one.html, /<th[^>]*>Address<\/th>.*<th[^>]*>Status<\/th>.*<th[^>]*>Last modified<\/th>/);
assert.match(one.html, /href="https:\/\/example.invalid\/sitemap-posts\.xml"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
assert.ok(one.html.indexOf("Rows per page") > one.html.indexOf("</table>"), "row sizing stays in the footer, away from file/search controls");
assert.equal(inputs[0]?.maxLength, 160);
assert.deepEqual(await requested(), { collection: "posts", after: null, search: "", status: "all", limit: 25, cursor: null });

// A direct file jump remains bounded, independently from the row-page cursor.
const many = [{ collection: "posts", label: "Posts", files: [null, ...Array.from({ length: 99 }, (_, index) => `after-${index + 1}`)] }];
const manyConfiguration = start(many, {
	position: { collection: "posts", fileIndex: 99 },
	filters: { search: "/news", status: "included", limit: 50, cursor: "rows-old", cursorScope: model.sitemapPreviewScope("saved-revision-1", { collection: "posts", after: "after-99" }) },
	searchText: "unsubmitted text",
});
query.data = result({ collection: "posts", after: "after-99", search: "/news", status: "included", limit: 50 }, {
	matched: 125, offset: 50, previousCursor: "rows-previous", nextCursor: "rows-next",
});
const manyHtml = render(manyConfiguration).html;
assert.match(manyHtml, /<strong>500 entries<\/strong>/);
assert.match(manyHtml, /<nav[^>]*aria-label="Sitemap files"/);
assert.match(manyHtml, /<nav[^>]*aria-label="Preview rows"/);
assert.equal(Object.keys(byLabel(selects, "Sitemap file").items as object).length, 100);
assert.equal(byLabel(selects, "Sitemap file").value, "99");
(byLabel(selects, "Sitemap file").onValueChange as (value: string) => void)("0");
render(manyConfiguration);
assert.deepEqual(await requested(), { collection: "posts", after: null, search: "/news", status: "included", limit: 50, cursor: null },
	"a file jump preserves submitted filters but cannot carry another file's row cursor");
assert.equal((state.get("filters") as model.SitemapExplorerFilters).cursorScope, "");

// Typing does not fetch a partial search; submitting and clearing use the actual handlers.
(byLabel(inputs, "Search this file").onChange as (event: { target: { value: string } }) => void)({ target: { value: " /literal?x=%25 " } });
let typing = render(manyConfiguration);
assert.equal((await requested()).search, "/news");
let prevented = false;
(nativeNode(typing.tree, "form")!.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault() { prevented = true; } });
assert.equal(prevented, true);
render(manyConfiguration);
assert.equal((await requested()).search, "/literal?x=%25", "literal punctuation is trimmed, not treated as a search expression");
(button("Clear").onClick as () => void)();
render(manyConfiguration);
assert.equal(state.get("searchText"), "");
assert.equal((await requested()).search, "");
assert.equal((state.get("filters") as model.SitemapExplorerFilters).cursor, null);

// Loading and a rejected snapshot cannot turn retained rows into the pending filter's results.
const earlier = result({}, { offset: 25, previousCursor: "rows-previous", nextCursor: "rows-next" });
const staleConfiguration = start(single, {
	previous: earlier, filters: { ...model.initialSitemapExplorerFilters(), search: "/new-filter", status: "excluded", limit: 50 }, searchText: "/new-filter",
});
query = { isError: true, isFetching: false, data: { success: false, stale: true, errors: { _form: "This preview changed. Refresh the first page." } } };
const stale = render(staleConfiguration).html;
assert.match(stale, /Showing earlier results for this file/);
assert.match(stale, /Rows 26-50 of 500 matching entries · All statuses/);
assert.doesNotMatch(stale, /Search: [^<]*new-filter/, "retained counts/labels belong to the previous response");
assert.equal(button("Previous rows").disabled, true);
assert.equal(button("Next rows").disabled, true);
query = { isError: false, isFetching: true, data: earlier };
state.set("filters", model.initialSitemapExplorerFilters());
render(staleConfiguration);
assert.equal(button("Previous rows").disabled, true);
assert.equal(button("Next rows").disabled, true);

// A lost read permission and a failed file switch must both hide cached addresses.
for (const status of [401, 403]) {
	query = { isError: true, isFetching: false, error: { status } };
	const denied = render(staleConfiguration).html;
	assert.doesNotMatch(denied, /<table|example\.invalid\/posts\/first|Open XML/);
}
state.set("position", { collection: "posts", fileIndex: 1 });
query = { isError: true, isFetching: false, error: { status: 503 } };
const switchedConfiguration = { ...staleConfiguration, plan: [{ collection: "posts", label: "Posts", files: [null, "after-500"] }] };
assert.doesNotMatch(render(switchedConfiguration).html, /<table|example\.invalid\/posts\/first/, "another file's failed read cannot display retained rows");

console.log("Sitemap explorer production-render self-check passed.");
