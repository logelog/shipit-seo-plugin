import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";
import { SEO_ADMIN_CONTRACT_VERSION } from "../admin-contract.ts";
import type { SeoAdminIndexingTaxonomies } from "../taxonomy-indexing.ts";
import { createSeoI18n } from "./i18n/messages.ts";
import { isSeoContractMismatchError, seoWorkspaceKeys } from "./workspace-model.ts";

const source = readFileSync(new URL("./taxonomy-indexing-container.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("taxonomy-indexing-container.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === "TaxonomyIndexingContainer");
assert.equal(declarations.length, 1, "Execute the production wrapper and its actual event closures");

type QueryState = {
	isPending: boolean;
	isFetching: boolean;
	isError: boolean;
	error: unknown;
	data?: SeoAdminIndexingTaxonomies;
};
type QueryOptions = {
	queryKey: readonly unknown[];
	queryFn: (context: { signal: AbortSignal }) => Promise<SeoAdminIndexingTaxonomies>;
	refetchOnWindowFocus: boolean;
	refetchOnReconnect: boolean;
	retry: boolean;
	staleTime: number;
	enabled: boolean;
};
type Element = ReactElement<Record<string, any>>;
const TaxonomyIndexingControls = () => null;
const ContractMismatchScreen = () => null;
const selected = ["category", "deleted_type"];
const saved = ["category"];
let locale = "en";
const data: SeoAdminIndexingTaxonomies = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, available: true,
	items: [{ name: "category", label: "Categories" }], truncated: false, message: null,
};
let state: QueryState;
let options!: QueryOptions;
let requests: Array<{ cancelRefetch?: boolean }> = [];
let changes: string[][] = [];
let receivedSignal: AbortSignal | undefined;
const scope = {
	useQuery: (input: QueryOptions) => {
		options = input;
		return { ...state, refetch: async (input: { cancelRefetch?: boolean } = {}) => { requests.push(input); } };
	},
	fetchIndexingTaxonomies: async (signal?: AbortSignal) => { receivedSignal = signal; return data; },
	TaxonomyIndexingControls, ContractMismatchScreen, isSeoContractMismatchError, seoWorkspaceKeys,
	useSeoI18n: () => createSeoI18n(locale),
};
const compiled = ts.transpileModule(declarations[0]!.getText(parsed), {
	fileName: "taxonomy-indexing-container-probe.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} };
new Function("require", "module", "exports", ...Object.keys(scope), compiled.outputText)(
	(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; },
	output, output.exports, ...Object.values(scope),
);
const { TaxonomyIndexingContainer } = output.exports as Record<string, any>;
function render(patch: Partial<QueryState> = {}, disabled = false, unconfirmed?: boolean, active?: boolean): Element {
	state = { isPending: false, isFetching: false, isError: false, error: null, data, ...patch };
	requests = []; changes = [];
	return TaxonomyIndexingContainer({ selected, saved, disabled, siteNoindex: true, savedSiteNoindex: false, unconfirmed,
		validationError: "Retained field error", onChange: (names: string[]) => changes.push(names), active });
}
let cases = 0;
function check(run: () => void) { run(); cases += 1; }

check(() => {
	const tree = render();
	assert.equal(tree.type, TaxonomyIndexingControls);
	assert.equal(tree.props.selected, selected, "Unknown choices stay with the parent's retained draft");
	assert.equal(tree.props.saved, saved, "The stored rules reach the rows beside the draft");
	assert.deepEqual([tree.props.siteNoindex, tree.props.savedSiteNoindex], [true, false], "Draft and saved site-wide noindex both reach the rows");
	assert.deepEqual([tree.props.unconfirmed, render({}, false, true).props.unconfirmed], [false, true], "An unconfirmed save reaches the rows");
	assert.equal(tree.props.definitions, data.items);
	assert.equal(tree.props.loading, false);
	assert.equal(tree.props.validationError, "Retained field error");
	assert.deepEqual(options.queryKey, seoWorkspaceKeys.indexingTaxonomies);
	assert.equal(options.refetchOnWindowFocus, false);
	assert.equal(options.refetchOnReconnect, false);
	assert.equal(options.retry, false);
	assert.equal(options.staleTime, 60_000);
	assert.equal(options.enabled, true, "The read runs while the rules are shown");
	assert.equal(render({}, false, undefined, false).type, TaxonomyIndexingControls, "A hidden section keeps its rows");
	assert.equal(options.enabled, false, "The read is passive while Indexing rules is hidden");
	assert.equal(requests.length, 0, "Rendering the wrapper does not explicitly refetch");
	tree.props.onChange(["category"]);
	assert.deepEqual(changes, [["category"]]);
	tree.props.onRetry();
	assert.deepEqual(requests, [{ cancelRefetch: false }], "Explicit retries reuse an in-flight request instead of cancelling it");
});
check(() => {
	const tree = render({ isPending: true, isFetching: true, data: undefined });
	assert.equal(tree.props.loading, true);
	assert.equal(tree.props.definitions, null);
	assert.equal(tree.props.error, null);
	assert.equal(tree.props.selected, selected);
	tree.props.onRetry(); tree.props.onRetry();
	assert.equal(requests.length, 0, "Initial loading cannot start another request");
});
const unavailable = { ...data, available: false, items: [], message: "Taxonomy definitions could not be loaded. Try again." };
check(() => {
	const tree = render({ data: unavailable });
	assert.equal(tree.props.definitions, null);
	assert.equal(tree.props.error, createSeoI18n("en").t("indexing.archives.unavailable"));
	assert.equal(tree.props.loading, false);
	tree.props.onRetry();
	assert.deepEqual(requests, [{ cancelRefetch: false }]);
	locale = "tr";
	assert.equal(render({ data: unavailable }).props.error, createSeoI18n("tr").t("indexing.archives.unavailable"),
		"The server's fixed English message gives way to the admin language");
	locale = "en";
});
check(() => {
	const tree = render({ data: unavailable, isFetching: true });
	assert.equal(tree.props.loading, true, "Retrying an available:false response is busy even though isPending is false");
	assert.equal(tree.props.error, createSeoI18n("en").t("indexing.archives.unavailable"));
	assert.equal(tree.props.selected, selected);
	tree.props.onRetry(); tree.props.onRetry();
	assert.equal(requests.length, 0, "Repeated retries during the same fetch do not reach refetch");
});
check(() => {
	const tree = render({ isFetching: true });
	assert.equal(tree.props.definitions, data.items, "A background refresh keeps the available list");
	assert.equal(tree.props.loading, true);
	tree.props.onRetry();
	assert.equal(requests.length, 0);
});
check(() => {
	const tree = render({ isError: true, error: new Error("Network unavailable"), isFetching: true });
	assert.equal(tree.type, TaxonomyIndexingControls);
	assert.equal(tree.props.loading, true, "An error with cached data can still have an active retry");
	assert.equal(tree.props.definitions, null);
	assert.equal(tree.props.selected, selected);
	assert.match(tree.props.error, /Try again/);
	tree.props.onRetry();
	assert.equal(requests.length, 0);
	locale = "nl";
	assert.equal(render({ isError: true, error: new Error("Network unavailable") }).props.error, createSeoI18n("nl").t("indexing.archives.unavailable"),
		"The read failure follows the admin language");
	assert.notEqual(createSeoI18n("nl").t("indexing.archives.unavailable"), createSeoI18n("en").t("indexing.archives.unavailable"), "control: the catalogue is translated");
	locale = "en";
});
check(() => {
	const tree = render({}, true);
	assert.equal(tree.props.disabled, true);
	tree.props.onChange([]); tree.props.onRetry();
	assert.deepEqual(changes, []);
	assert.deepEqual(requests, [], "A pending parent save blocks explicit reads and changes");
});
check(() => {
	const mismatch = new Error("Invalid SEO admin response: indexing.taxonomies");
	let tree = render({ isError: true, error: mismatch }, true);
	assert.equal(tree.type, ContractMismatchScreen);
	assert.equal(tree.props.error, mismatch);
	tree.props.onRetry(); assert.equal(requests.length, 0);
	tree = render({ isError: true, error: mismatch, isFetching: true });
	tree.props.onRetry(); assert.equal(requests.length, 0);
	tree = render({ isError: true, error: mismatch });
	tree.props.onRetry(); assert.deepEqual(requests, [{ cancelRefetch: false }]);
});
check(() => {
	const tree = render();
	assert.equal(tree.props.loading, false, "Settling a retry enables a later deliberate refresh");
	tree.props.onRetry(); assert.equal(requests.length, 1);
});
render();
const controller = new AbortController();
assert.equal(await options.queryFn({ signal: controller.signal }), data);
assert.equal(receivedSignal, controller.signal, "The wrapper passes the query cancellation signal to the API");
controller.abort();
assert.equal(receivedSignal?.aborted, true);
console.log(`Taxonomy indexing container: ${cases} wrapper cases and cancellation forwarding passed.`);
