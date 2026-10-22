import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";
import { createSeoI18n } from "./i18n/messages.ts";
import { isSeoContractMismatchError, seoWorkspaceKeys } from "./workspace-model.ts";

const source = readFileSync(new URL("./content-type-indexing-container.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("content-type-indexing-container.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ContentTypeIndexingContainer");
assert.equal(declarations.length, 1, "Execute the production wrapper and its actual closures");

type Element = ReactElement<Record<string, any>>;
const ContentTypeIndexingControls = () => null;
const ContractMismatchScreen = () => null;
let locale = "en";
let state: Record<string, unknown> = {};
let queryKey: unknown;
let enabled: unknown;
const scope = {
	useQuery: (input: { queryKey: unknown; enabled?: unknown }) => {
		queryKey = input.queryKey;
		enabled = input.enabled;
		return { ...state, refetch: async () => {} };
	},
	fetchSeoAdminSitemap: async () => { throw new Error("The wrapper probe never fetches"); },
	ContentTypeIndexingControls, ContractMismatchScreen, isSeoContractMismatchError, seoWorkspaceKeys,
	useSeoI18n: () => createSeoI18n(locale),
};
const compiled = ts.transpileModule(declarations[0]!.getText(parsed), {
	fileName: "content-type-indexing-container-probe.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} };
new Function("require", "module", "exports", ...Object.keys(scope), compiled.outputText)(
	(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; },
	output, output.exports, ...Object.values(scope),
);
const { ContentTypeIndexingContainer } = output.exports as Record<string, any>;
const selected = ["pages", "posts"];
const saved = ["posts"];
const sitemap = { owner: "shipit", groups: [{ key: "posts", label: "Posts" }] };
function render(query: Record<string, unknown> = {}, props: Record<string, unknown> = {}): Element {
	state = { isPending: false, isFetching: false, isError: false, error: null, data: sitemap, ...query };
	return ContentTypeIndexingContainer({ selected, saved, disabled: false, siteNoindex: true, savedSiteNoindex: false, onChange() {}, ...props });
}
let cases = 0;
function check(run: () => void) { run(); cases += 1; }

check(() => {
	const tree = render();
	assert.equal(tree.type, ContentTypeIndexingControls);
	assert.deepEqual(queryKey, seoWorkspaceKeys.sitemap, "the rows read the Sitemaps page configuration");
	assert.equal(tree.props.sitemap, sitemap);
	assert.equal(tree.props.selected, selected, "the draft rules reach the rows");
	assert.equal(tree.props.saved, saved, "the stored rules reach the rows beside the draft");
	assert.deepEqual([tree.props.siteNoindex, tree.props.savedSiteNoindex], [true, false], "draft and saved site-wide noindex both reach the rows");
	assert.deepEqual([tree.props.unconfirmed, render({}, { unconfirmed: true }).props.unconfirmed], [false, true], "an unconfirmed save reaches the rows");
	render();
	assert.equal(enabled, true, "the read runs while the rules are shown");
	assert.equal(render({}, { active: false }).type, ContentTypeIndexingControls, "a hidden section keeps its rows");
	assert.equal(enabled, false, "the read is passive while Indexing rules is hidden");
});

check(() => {
	assert.equal(render({ isError: true, error: new Error("Sitemaps unavailable.") }).props.error, "Sitemaps unavailable.");
	locale = "nl";
	const nl = createSeoI18n("nl").t("indexing.types.unavailable");
	assert.notEqual(nl, createSeoI18n("en").t("indexing.types.unavailable"), "control: the catalogue is translated");
	assert.equal(render({ isError: true, error: "offline" }).props.error, nl, "a read failure without a message follows the admin language");
	locale = "en";
});

console.log(`Content type indexing container: ${cases} wrapper cases passed.`);
