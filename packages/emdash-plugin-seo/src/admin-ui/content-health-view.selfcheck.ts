// Content health over real saved rows. A migrated in-memory SQLite database
// from the selected published host stores the scores through the real routes
// and the published HTTP dispatcher; every read is sent by the production
// api.ts with the host's apiFetch and response parser. The exact ContentAudit
// and ContentAuditContainer declarations from admin.tsx render under a hook
// owner whose queries are real QueryObservers on a real QueryClient.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";
import { ArrowSquareOut, Eye, FileText, MagnifyingGlass } from "@phosphor-icons/react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Table } from "@cloudflare/kumo/components/table";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { applySeed, createContentAccessWithWrite } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";
import * as adminContract from "@shipitseo/emdash-plugin-seo/admin-contract";
import type { SeoAdminContentScore, SeoAdminContentScores, SeoAdminOverview } from "@shipitseo/emdash-plugin-seo/admin-contract";
import { seoAnalysisPresentation } from "../analysis.ts";
import { createPlugin } from "../native-entry.ts";
import { contentEditorUrl } from "./content-editor-url.ts";
import * as extensionModel from "./content-extension-model.ts";
import * as overviewModel from "./overview-model.ts";
import * as workspace from "./workspace-model.ts";

const SITE = "https://example.com";
const API = "/_emdash/api/plugins/shipit-seo/";

// ---- The published host's dispatcher and the installed admin client ----
const emdashDist = new URL("./", import.meta.resolve("emdash"));
async function hostDistExport(name: string): Promise<any> {
	for (const file of readdirSync(emdashDist).filter((entry) => entry.endsWith(".mjs")).sort()) {
		const alias = readFileSync(new URL(file, emdashDist), "utf8").match(new RegExp(`\\b${name} as ([A-Za-z_$][\\w$]*)`))?.[1];
		if (alias) return (await import(new URL(file, emdashDist).href))[alias];
	}
	throw new Error(`published ${name} was not found`);
}
const PluginRouteRegistry = await hostDistExport("PluginRouteRegistry");
const buildRouteMeta = await hostDistExport("buildRouteMeta");
const parseRouteInput = await hostDistExport("parseRouteInput");
const dispatchPluginApiRequest = await hostDistExport("dispatchPluginApiRequest");
const syncDeclaredStorageIndexes = await hostDistExport("syncDeclaredStorageIndexes");
const adminEntry = new URL(import.meta.resolve("@emdash-cms/admin"));
const clientImport = readFileSync(adminEntry, "utf8").match(/import\s*\{([^}]*\bas apiFetch\b[^}]*)\}\s*from\s*"([^"]+)"/);
assert.ok(clientImport, "the installed admin exports its request helper");
const hostClient = await import(new URL(clientImport[2], adminEntry).href);
const apiFetch = hostClient[clientImport[1].match(/(\w+)\s+as\s+apiFetch\b/)![1]!];
const parseApiResponse = hostClient[clientImport[1].match(/(\w+)\s+as\s+parseApiResponse\b/)![1]!];
assert.equal(typeof apiFetch, "function");
assert.equal(typeof parseApiResponse, "function");
const compiledApi = ts.transpileModule(readFileSync(new URL("./api.ts", import.meta.url), "utf8"), { fileName: "api.ts", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.deepEqual(compiledApi.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const requireClient = createRequire(new URL("./api.ts", import.meta.url));
const clientModules: Record<string, unknown> = {
	"@emdash-cms/admin": { apiFetch, parseApiResponse },
	"@shipitseo/emdash-plugin-seo/admin-contract": adminContract,
};
const api = { exports: {} as Record<string, any> };
new Function("require", "module", "exports", compiledApi.outputText)((specifier: string) =>
	Object.hasOwn(clientModules, specifier) ? clientModules[specifier] : requireClient(specifier), api, api.exports);

// ---- Saved pages and posts scored by the real manual analysis route ----
const db = new Kysely<any>({ dialect: createDialect({ url: ":memory:" }) });
const span = (text: string) => ({ _type: "span", _key: `s${text.length}`, text, marks: [] });
const block = (text: string, style = "normal") => ({ _type: "block", _key: `b${style}${text.length}`, style, markDefs: [], children: [span(text)] });
const entry = (slug: string, number: number) => ({
	id: slug, slug, status: "published", locale: "en",
	data: {
		title: `Loaf ${number} baked every morning`,
		...(number % 3 === 0 ? {} : { excerpt: `Fresh loaf ${number} from the harbour bakery, shaped by hand each morning.` }),
		content: [block(`Loaf ${number} at Harbour Bakery`, "h1"), ...Array.from({ length: 3 + (number % 4) }, (_, index) =>
			block(`Fresh loaf ${number} is shaped by hand every morning and baked in small batches for visitors on day ${index + 1}.`))],
	},
});
const pageSlugs = Array.from({ length: 11 }, (_, index) => `page-${String(index + 1).padStart(2, "0")}`);
const postSlugs = ["post-1", "post-2"];
const requests: Array<{ route: string; params: URLSearchParams }> = [];
let failScores = false;
const originalFetch = globalThis.fetch;
let cases = 0;
function check(name: string) { cases += 1; console.log("  PASS  " + name); }

try {
	await runMigrations(db);
	await applySeed(db, {
		version: "1", defaultLocale: "en",
		collections: ["pages", "posts"].map((slug) => ({
			slug, label: slug === "pages" ? "Pages" : "Posts", supports: ["drafts", "revisions", "seo"],
			urlPattern: slug === "pages" ? "/{slug}" : "/posts/{slug}", routable: true,
			fields: [{ slug: "title", label: "Title", type: "string" }, { slug: "excerpt", label: "Excerpt", type: "string" }, { slug: "content", label: "Content", type: "portableText" }],
		})),
		content: { pages: pageSlugs.map((slug, index) => entry(slug, index + 1)), posts: postSlugs.map((slug, index) => entry(slug, index + 20)) },
	} as any, { includeContent: true });
	const ids = new Map<string, string>();
	for (const collection of ["pages", "posts"]) {
		for (const row of await db.selectFrom(`ec_${collection}`).select(["id", "slug"]).execute()) ids.set(row.slug, `${collection}:${row.id}`);
	}
	const ref = (slug: string) => ids.get(slug)!;

	const seo = createPlugin();
	await syncDeclaredStorageIndexes(db, [{ id: seo.id, storage: seo.storage }]);
	const registry = new PluginRouteRegistry({ db, siteInfo: { siteUrl: SITE, siteName: "Harbour Bakery", url: SITE, name: "Harbour Bakery" }, cronReschedule() {} });
	registry.register(seo);
	const routes = seo.routes as Record<string, any>;
	const runtime = {
		getPluginRouteMeta(pluginId: string, path: string) {
			const route = pluginId === seo.id ? routes[path.replace(/^\//, "")] : undefined;
			return route ? buildRouteMeta(route) : null;
		},
		async handlePluginApiRoute(pluginId: string, _method: string, path: string, request: Request, caller: unknown) {
			const input = await parseRouteInput(request, this.getPluginRouteMeta(pluginId, path)?.request);
			return registry.invoke(pluginId, path.replace(/^\//, ""), { request, body: input, user: caller });
		},
	};
	const admin = { id: "admin", email: "admin@example.com", name: "Admin", role: 50 };
	const call = async (route: string, input: unknown) => {
		const request = new Request(`${SITE}${API}${route}`, {
			method: "POST", headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" }, body: JSON.stringify(input),
		});
		const response = await dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: admin });
		const payload = JSON.parse(await response.text());
		assert.equal(response.status, 200, JSON.stringify(payload?.error));
		return payload.data;
	};
	// Only the plugin's own routes answer the admin client; anything else stays offline.
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input), SITE);
		assert.ok(url.origin === SITE && url.pathname.startsWith(API), "External networking is disabled in this selfcheck");
		const route = url.pathname.slice(API.length);
		const request = new Request(url, init);
		assert.deepEqual([request.method, request.headers.get("X-EmDash-Request")], ["GET", "1"], "the view only reads");
		requests.push({ route, params: url.searchParams });
		if (failScores && route === "scores") {
			return new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Plugin route error" } }), { status: 500, headers: { "Content-Type": "application/json" } });
		}
		return dispatchPluginApiRequest({ runtime, pluginId: seo.id, path: `/${route}`, request, user: admin });
	}) as typeof fetch;

	const settings = await call("admin-settings", {});
	assert.equal((await call("save-admin-settings", {
		...settings.values, siteName: "Harbour Bakery", siteUrl: SITE, publisherType: "organization", organizationName: "Harbour Bakery",
		organizationLogo: "", socialProfiles: [], personProfiles: [], personName: "", defaultSocialImage: "", twitterHandle: "", noindex: false,
		...(settings.revision === null ? { expectedRevision: null, expectedLegacyGuard: settings.legacyGuard } : { expectedRevision: settings.revision }),
	})).success, true);
	const scoring = await call("admin-settings", {});
	assert.equal((await call("save-content-scoring", {
		contentScoringEnabled: true, expectedContentScoringEnabled: scoring.values.contentScoringEnabled, expectedRevision: scoring.revision,
		...(scoring.revision === null ? { expectedLegacyGuard: scoring.legacyGuard } : {}), resourceNoticeVersion: scoring.contentScoring.currentNoticeVersion,
	})).success, true);
	for (const collection of ["pages", "posts"]) {
		const profile = await call("admin-analysis-profile", { collection });
		assert.equal((await call("save-analysis-profile", { collection, profile: "general", expectedRevision: profile.selection.revision })).success, true);
	}
	// Distinct save times, so the newest-first sample order is the analysis order reversed.
	const analysisOrder = [...pageSlugs, ...postSlugs];
	for (const slug of analysisOrder) {
		assert.equal((await call("analyze-saved-content", { ref: ref(slug), locale: "en" })).success, true, slug);
		await new Promise((resolve) => setTimeout(resolve, 3));
	}
	const staleSlug = "page-09";
	await createContentAccessWithWrite(db).update("pages", ref(staleSlug).slice("pages:".length), {
		content: [block("Loaf 9 at Harbour Bakery", "h1"), block("The rye loaf now replaces this page's earlier text for every visitor this week.")],
	});
	assert.equal(requests.length, 0, "control: setup sends no admin client request");

	// ---- The production declarations under a hook owner ----
	let queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnReconnect: false, refetchOnWindowFocus: false, retry: 1 } } });
	type Cell = { value: any; deps?: readonly unknown[] };
	let owner: HookOwner;
	class HookOwner {
		cells: Cell[] = [];
		cursor = 0;
		effects: Array<() => unknown> = [];
		subscriptions: Array<() => void> = [];
		render<T>(render: () => T): T {
			const previous = owner;
			owner = this; this.cursor = 0;
			try { return render(); } finally { owner = previous; }
		}
		flush() { for (const effect of this.effects.splice(0)) effect(); }
		unmount() { for (const stop of this.subscriptions.splice(0)) stop(); }
		changed(index: number, deps?: readonly unknown[]) {
			const previous = this.cells[index];
			return !deps || !previous?.deps || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps![i]));
		}
		state<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
			const index = this.cursor++;
			this.cells[index] ??= { value: typeof initial === "function" ? (initial as () => T)() : initial };
			return [this.cells[index].value, (value) => {
				this.cells[index]!.value = typeof value === "function" ? (value as (current: T) => T)(this.cells[index]!.value) : value;
			}];
		}
		effect(effect: () => unknown, deps?: readonly unknown[]) {
			const index = this.cursor++;
			if (this.changed(index, deps)) this.effects.push(effect);
			this.cells[index] = { value: null, deps };
		}
		memo<T>(compute: () => T, deps: readonly unknown[]): T {
			const index = this.cursor++;
			if (this.changed(index, deps)) this.cells[index] = { value: compute(), deps };
			return this.cells[index]!.value;
		}
		// As useBaseQuery: an optimistic result while rendering; subscribe, then apply the options, after commit.
		query(options: any) {
			const index = this.cursor++;
			const defaulted: any = queryClient.defaultQueryOptions(options);
			defaulted._optimisticResults = "optimistic";
			const slot = (this.cells[index] ??= { value: { observer: new QueryObserver(queryClient, defaulted), subscribed: false } }).value;
			const result = slot.observer.getOptimisticResult(defaulted);
			this.effects.push(() => {
				if (!slot.subscribed) { slot.subscribed = true; this.subscriptions.push(slot.observer.subscribe(() => {})); }
				slot.observer.setOptions(defaulted);
			});
			return result;
		}
	}
	const localReact = {
		...React,
		useState: <T,>(initial: T | (() => T)) => owner.state(initial),
		useEffect: (effect: () => unknown, deps?: readonly unknown[]) => owner.effect(effect, deps),
		useMemo: <T,>(compute: () => T, deps: readonly unknown[]) => owner.memo(compute, deps),
	};
	const ViewSkeleton = (_props: { label: string }) => null;
	const ViewErrorState = (_props: { title: string }) => null;
	const scope: Record<string, unknown> = {
		...extensionModel, ...overviewModel, React: localReact, useQuery: (options: unknown) => owner.query(options),
		seoWorkspaceKeys: workspace.seoWorkspaceKeys, fetchSeoAdminOverview: api.exports.fetchSeoAdminOverview, fetchSeoContentScores: api.exports.fetchSeoContentScores,
		contentEditorUrl, Badge, Button, Dialog, Empty, Table, ArrowSquareOut, Eye, FileText, MagnifyingGlass,
		EntryPreviewDialogBody: () => null, ViewSkeleton, ViewErrorState,
	};
	const adminSource = ts.createSourceFile("admin.tsx", readFileSync(new URL("./admin.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const declaration = (name: string) => {
		const found = adminSource.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
		assert.equal(found.length, 1, "Exact production declaration: " + name);
		return found[0]!.getText(adminSource);
	};
	const compiled = ts.transpileModule(["readableDate", "useOverviewQuery", "ContentAudit", "ContentAuditContainer"].map(declaration).join("\n") +
		"\nexport { ContentAudit, ContentAuditContainer };", { fileName: "content-health-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const production = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", ...Object.keys(scope), compiled.outputText)((name: string) => {
		assert.equal(name, "react/jsx-runtime", "Unexpected production import: " + name);
		return jsx;
	}, production, production.exports, ...Object.values(scope));
	const { ContentAudit, ContentAuditContainer } = production.exports;

	type Element = React.ReactElement<Record<string, any>>;
	const kids = (node: Element): Element[] => [node.props.children].flat(Infinity).filter((item): item is Element => React.isValidElement(item));
	const elements = (tree: React.ReactNode): Element[] => {
		if (Array.isArray(tree)) return tree.flatMap(elements);
		if (!React.isValidElement(tree)) return [];
		const element = tree as Element;
		return [element, ...elements(element.props.children)];
	};
	const text = (tree: React.ReactNode, visible = false): string => {
		if (typeof tree === "string" || typeof tree === "number") return String(tree);
		if (Array.isArray(tree)) return tree.map((item) => text(item, visible)).join("");
		if (!React.isValidElement(tree)) return "";
		const element = tree as Element;
		return visible && element.props.className === "sr-only" ? "" : text(element.props.children, visible);
	};
	const scoreParts = (cell: Element) => {
		const badge = kids(cell).filter((node) => node.type === Badge).at(-1)!;
		const prefix = elements(badge.props.children).find((node) => node.props.className === "sr-only");
		const label = kids(cell).find((node) => node.type === "span");
		const qualifier = kids(cell).find((node) => node.type === "small");
		return { variant: badge.props.variant, name: text(badge), visible: text(badge, true), prefix: prefix ? text(prefix) : null,
			label: label ? text(label) : null, qualifier: qualifier ? text(qualifier) : null };
	};
	const rowsOf = (view: Element) => {
		const body = elements(view).find((node) => node.type === Table.Body);
		return body ? kids(body).map((row) => {
			const cells = kids(row);
			const meta = elements(cells[0]).find((node) => node.props.className === "shipit-seo-mobile-meta")!;
			return { ref: String(row.key), className: row.props.className, mobile: scoreParts(kids(meta)[0]!), table: scoreParts(elements(cells[2]).find((node) => node.props.className === "shipit-seo-score-cell")!) };
		}) : [];
	};
	const statusOf = (view: Element) => {
		const found = elements(view).filter((node) => node.type === "p" && node.props.role === "status");
		assert.equal(found.length, 1, "one persistent status line");
		return text(found[0]);
	};
	function mount(requestedRef: string | null = null) {
		const container = new HookOwner();
		const audit = new HookOwner();
		const props = { requestedRef, onOpenInTemplates: () => {} };
		return {
			render() {
				const tree = container.render(() => ContentAuditContainer(props)) as Element;
				const view = tree.type === ContentAudit ? audit.render(() => ContentAudit(tree.props)) as Element : null;
				audit.flush(); container.flush();
				return { tree, view };
			},
			unmount() { container.unmount(); audit.unmount(); },
		};
	}
	const settle = async () => {
		for (let turn = 0; turn < 2000 && (turn < 3 || queryClient.isFetching() > 0); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(queryClient.isFetching(), 0, "every request settles");
	};
	const scoreRequests = () => requests.filter((request) => request.route === "scores");
	const expectRequest = (refs: readonly string[]) => {
		const params = scoreRequests().at(-1)!.params;
		assert.deepEqual([params.get("refs"), params.get("storedOnly"), params.get("limit"), params.has("snapshotOnly"), params.has("refresh")],
			[JSON.stringify(refs), "true", String(refs.length), false, false], "one stored-only request for the exact refs");
	};
	type Expected = { kind: "current"; item: SeoAdminContentScore } | { kind: "stale" | "saved" };
	const toneVariant = { good: "success", review: "warning", poor: "error", neutral: "secondary" } as const;
	const expectRow = (row: ReturnType<typeof rowsOf>[number], overviewRow: SeoAdminOverview["content"][number], expected: Expected) => {
		const score = String(overviewRow.score);
		let parts;
		if (expected.kind === "current") {
			const band = seoAnalysisPresentation(expected.item);
			assert.notEqual(band.tone, "neutral", "control: a numbered result has a band");
			parts = { variant: toneVariant[band.tone], name: score, visible: score, prefix: null, label: band.label, qualifier: band.qualifier };
		} else if (expected.kind === "stale") {
			parts = { variant: "secondary", name: `Last known score ${score}`, visible: score, prefix: "Last known score ",
				label: "Analysis needs refreshing", qualifier: "Saved inputs or analysis version no longer match" };
		} else {
			parts = { variant: "secondary", name: `Saved score ${score}`, visible: score, prefix: "Saved score ", label: "Saved analysis", qualifier: "Current content not checked" };
		}
		assert.deepEqual(row.table, parts, `${row.ref} score cell (${expected.kind})`);
		assert.deepEqual(row.mobile, parts, `${row.ref} mobile meta (${expected.kind})`);
	};
	const CHECKING = "Checking recent rows against current content...";
	const FAILED = "Current content could not be checked. Saved scores are shown.";

	// ---- Opening the view: overview first, then one stored-only check of the first rows ----
	let view = mount();
	let rendered = view.render();
	assert.equal(rendered.tree.type, ViewSkeleton);
	assert.deepEqual(requests.map((request) => `${request.route}?${request.params}`), ["admin-overview?limit=50"]);
	await settle();
	let overview = queryClient.getQueryData<SeoAdminOverview>(workspace.seoWorkspaceKeys.overview)!;
	const newestFirst = [...analysisOrder].reverse().map(ref);
	assert.deepEqual(overview.content.map((row) => row.ref), newestFirst, "the sample lists every numbered saved row, newest first");
	assert.ok(overview.content.every((row) => row.presentation?.label === "Saved analysis"), "control: stored rows carry no freshness");
	rendered = view.render();
	for (const [index, row] of rowsOf(rendered.view!).entries()) expectRow(row, overview.content[index]!, { kind: "saved" });
	assert.equal(statusOf(rendered.view!), CHECKING);
	const allRefs = newestFirst.slice(0, 10);
	assert.equal(scoreRequests().length, 1);
	expectRequest(allRefs);
	check("the check is sent once for the first 10 rows, and its result is not used before it arrives");
	await settle();
	rendered = view.render();
	assert.equal(statusOf(rendered.view!), "");
	const firstCheck = queryClient.getQueryData<SeoAdminContentScores>(workspace.seoWorkspaceKeys.contentHealthFreshness(overview.generatedAt, allRefs))!;
	const checked = new Map(firstCheck.items.map((item) => [item.ref, item]));
	assert.equal(checked.get(ref(staleSlug))?.freshness, "stale", "control: the changed page is stale");
	const expectAll = (rows: ReturnType<typeof rowsOf>, checks: ReadonlyMap<string, SeoAdminContentScore>, refs: readonly string[]) => {
		assert.deepEqual(rows.map((row) => row.ref), overview.content.map((row) => row.ref), "a check never hides a row");
		for (const [index, row] of rows.entries()) {
			const item = checks.get(row.ref);
			expectRow(row, overview.content[index]!, !refs.includes(row.ref) || !item ? { kind: "saved" }
				: item.freshness === "current" ? { kind: "current", item } : { kind: "stale" });
		}
	};
	expectAll(rowsOf(rendered.view!), checked, allRefs);
	assert.ok(rowsOf(rendered.view!).every((row) => row.mobile.visible !== "-" && row.table.visible !== "-"), "no listed row shows a dash");
	check("checked rows show bands or a refresh request, the others their saved score, in both cells with screen-reader prefixes");

	// ---- Search filters only the rows; the type filter changes the checked rows ----
	kids(elements(rendered.view!).find((node) => node.props.className === "shipit-seo-search")!).find((node) => node.type === "input")!
		.props.onChange({ target: { value: "Loaf 9 " } });
	rendered = view.render();
	assert.deepEqual(rowsOf(rendered.view!).map((row) => row.ref), [ref(staleSlug)], "search narrows the listed rows");
	assert.equal(scoreRequests().length, 1, "search sends no check");
	kids(elements(rendered.view!).find((node) => node.props.className === "shipit-seo-search")!).find((node) => node.type === "input")!
		.props.onChange({ target: { value: "" } });
	elements(rendered.view!).find((node) => node.type === "select")!.props.onChange({ target: { value: "pages" } });
	rendered = view.render();
	assert.equal(elements(rendered.view!).find((node) => node.type === "select")!.props.value, "pages");
	assert.equal(statusOf(rendered.view!), CHECKING);
	const pageRefs = newestFirst.filter((item) => item.startsWith("pages:")).slice(0, 10);
	assert.equal(scoreRequests().length, 2);
	expectRequest(pageRefs);
	await settle();
	rendered = view.render();
	const pageCheck = new Map(queryClient.getQueryData<SeoAdminContentScores>(workspace.seoWorkspaceKeys.contentHealthFreshness(overview.generatedAt, pageRefs))!.items
		.map((item) => [item.ref, item]));
	const pageRows = rowsOf(rendered.view!);
	assert.deepEqual(pageRows.map((row) => row.ref), newestFirst.filter((item) => item.startsWith("pages:")));
	for (const row of pageRows) {
		const item = pageCheck.get(row.ref);
		expectRow(row, overview.content.find((candidate) => candidate.ref === row.ref)!,
			!item ? { kind: "saved" } : item.freshness === "current" ? { kind: "current", item } : { kind: "stale" });
	}
	assert.equal(pageRows.at(-1)!.ref, ref("page-01"));
	assert.equal(pageRows.at(-1)!.table.label, "Saved analysis", "the eleventh page is not checked");
	elements(rendered.view!).find((node) => node.type === "select")!.props.onChange({ target: { value: "all" } });
	rendered = view.render();
	await settle();
	rendered = view.render();
	assert.equal(scoreRequests().length, 3);
	expectRequest(allRefs);
	check("search leaves the check alone; the selected type's first 10 rows are checked with one request");

	// ---- A new overview snapshot gets one new check, sent only after the overview settles ----
	await new Promise((resolve) => setTimeout(resolve, 5));
	void queryClient.invalidateQueries({ queryKey: workspace.seoWorkspaceKeys.overview });
	rendered = view.render();
	assert.equal(statusOf(rendered.view!), "", "no check runs while the overview reloads");
	expectAll(rowsOf(rendered.view!), checked, allRefs);
	await settle();
	assert.equal(scoreRequests().length, 3, "no check is sent while the overview is fetching");
	const previous = overview.generatedAt;
	overview = queryClient.getQueryData<SeoAdminOverview>(workspace.seoWorkspaceKeys.overview)!;
	assert.notEqual(overview.generatedAt, previous, "control: the overview is a new snapshot");
	rendered = view.render();
	assert.equal(statusOf(rendered.view!), CHECKING);
	for (const [index, row] of rowsOf(rendered.view!).entries()) expectRow(row, overview.content[index]!, { kind: "saved" });
	assert.equal(scoreRequests().length, 4, "the new snapshot gets exactly one new check");
	expectRequest(allRefs);
	await settle();
	rendered = view.render();
	assert.equal(statusOf(rendered.view!), "");
	expectAll(rowsOf(rendered.view!), checked, allRefs);
	check("a new overview snapshot is checked once, after it arrives, and an older check is not applied to it");

	// ---- A failed read of a held check withdraws its bands until a retry succeeds ----
	const heldKey = workspace.seoWorkspaceKeys.contentHealthFreshness(overview.generatedAt, allRefs);
	const bands = (rows: ReturnType<typeof rowsOf>) => rows.filter((row) => !["Saved analysis", "Analysis needs refreshing"].includes(row.table.label!));
	assert.ok(bands(rowsOf(rendered.view!)).length > 0, "control: the held check shows a band");
	failScores = true;
	void queryClient.refetchQueries({ queryKey: heldKey, exact: true });
	rendered = view.render();
	assert.equal(statusOf(rendered.view!), CHECKING);
	expectAll(rowsOf(rendered.view!), new Map(), []);
	await settle();
	assert.equal(scoreRequests().length, 5, "one read of the held key, not retried");
	expectRequest(allRefs);
	assert.equal(queryClient.getQueryState(heldKey)?.status, "error");
	assert.ok(queryClient.getQueryData<SeoAdminContentScores>(heldKey)?.items.some((item) => item.freshness === "current"),
		"control: the failed query still holds its earlier current result");
	rendered = view.render();
	assert.equal(rendered.tree.type, ContentAudit, "a failed read never replaces the view");
	assert.equal(statusOf(rendered.view!), FAILED);
	expectAll(rowsOf(rendered.view!), new Map(), []);
	assert.equal(bands(rowsOf(rendered.view!)).length, 0, "no band survives the failed read");
	failScores = false;
	void queryClient.refetchQueries({ queryKey: heldKey, exact: true });
	await settle();
	assert.equal(scoreRequests().length, 6, "the retry reads the held key once");
	expectRequest(allRefs);
	rendered = view.render();
	assert.equal(statusOf(rendered.view!), "");
	expectAll(rowsOf(rendered.view!), checked, allRefs);
	check("a failed read of a held check shows saved scores with its status line, and a successful retry restores the bands");

	// ---- A failed check keeps every row and its saved score ----
	failScores = true;
	await new Promise((resolve) => setTimeout(resolve, 5));
	void queryClient.invalidateQueries({ queryKey: workspace.seoWorkspaceKeys.overview });
	await settle();
	overview = queryClient.getQueryData<SeoAdminOverview>(workspace.seoWorkspaceKeys.overview)!;
	rendered = view.render();
	await settle();
	rendered = view.render();
	assert.equal(rendered.tree.type, ContentAudit, "a failed check never replaces the view");
	assert.equal(scoreRequests().length, 7, "a failed check is not retried");
	assert.equal(statusOf(rendered.view!), FAILED);
	expectAll(rowsOf(rendered.view!), new Map(), []);
	failScores = false;
	view.unmount();
	check("a failed check shows its status line and saved scores, with no error view and no hidden row");

	// ---- A cached check from before this view opened is not trusted ----
	await settle();
	queryClient.setQueryData(workspace.seoWorkspaceKeys.overview, overview);
	queryClient.setQueryData(workspace.seoWorkspaceKeys.contentHealthFreshness(overview.generatedAt, allRefs),
		{ ...firstCheck, items: firstCheck.items.map((item) => ({ ...item, freshness: "current" as const })) });
	view = mount();
	rendered = view.render();
	assert.equal(statusOf(rendered.view!), CHECKING);
	for (const [index, row] of rowsOf(rendered.view!).entries()) expectRow(row, overview.content[index]!, { kind: "saved" });
	await settle();
	assert.equal(scoreRequests().length, 8, "opening the view checks again despite the cached result");
	rendered = view.render();
	expectAll(rowsOf(rendered.view!), checked, allRefs);
	view.unmount();
	check("a check cached before the view opened is never shown; the view checks again and shows the stale row");

	// ---- An outdated cached overview is reloaded before any check is sent ----
	await settle();
	queryClient.setQueryData(workspace.seoWorkspaceKeys.overview, overview, { updatedAt: Date.now() - 60_000 });
	view = mount();
	rendered = view.render();
	for (const [index, row] of rowsOf(rendered.view!).entries()) expectRow(row, overview.content[index]!, { kind: "saved" });
	assert.equal(statusOf(rendered.view!), "", "no check runs while the outdated overview reloads");
	assert.equal(scoreRequests().length, 8, "no check is sent for the outdated snapshot");
	await settle();
	assert.notEqual(queryClient.getQueryData<SeoAdminOverview>(workspace.seoWorkspaceKeys.overview)!.generatedAt, overview.generatedAt, "control: the overview reloaded");
	overview = queryClient.getQueryData<SeoAdminOverview>(workspace.seoWorkspaceKeys.overview)!;
	rendered = view.render();
	assert.equal(statusOf(rendered.view!), CHECKING);
	await settle();
	assert.equal(scoreRequests().length, 9, "one check for the reloaded snapshot");
	expectRequest(allRefs);
	rendered = view.render();
	expectAll(rowsOf(rendered.view!), checked, allRefs);
	view.unmount();
	check("an outdated cached overview is reloaded first, and only its new snapshot is checked");

	// ---- A focused entry selects its type and is checked in the same single request ----
	await settle();
	queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnReconnect: false, refetchOnWindowFocus: false, retry: 1 } } });
	queryClient.setQueryData(workspace.seoWorkspaceKeys.overview, overview);
	view = mount(ref("page-01"));
	rendered = view.render();
	assert.equal(elements(rendered.view!).find((node) => node.type === "select")!.props.value, "pages", "the focused row's type is selected");
	await settle();
	assert.equal(scoreRequests().length, 10, "one check for the focused view");
	expectRequest([...pageRefs, ref("page-01")]);
	rendered = view.render();
	const focused = rowsOf(rendered.view!).find((row) => row.ref === ref("page-01"))!;
	assert.equal(focused.className, "shipit-seo-content-row--focused");
	const focusedItem = queryClient.getQueryData<SeoAdminContentScores>(
		workspace.seoWorkspaceKeys.contentHealthFreshness(overview.generatedAt, [...pageRefs, ref("page-01")]))!.items.find((item) => item.ref === ref("page-01"))!;
	expectRow(focused, overview.content.find((row) => row.ref === ref("page-01"))!, { kind: "current", item: focusedItem });
	view.unmount();
	check("a focused entry beyond the first 10 selects its type and is checked in the one request, with no request for the previous filter");

	// ---- A type change that selects the rows already checked reuses that check ----
	await settle();
	const pagesOnly = { ...overview, content: overview.content.filter((row) => row.collection === "pages") };
	queryClient.setQueryData(workspace.seoWorkspaceKeys.overview, pagesOnly);
	view = mount();
	view.render();
	await settle();
	assert.equal(scoreRequests().length, 11, "one check when the view opens");
	expectRequest(pageRefs);
	const pagesCheck = new Map(queryClient.getQueryData<SeoAdminContentScores>(
		workspace.seoWorkspaceKeys.contentHealthFreshness(overview.generatedAt, pageRefs))!.items.map((item) => [item.ref, item]));
	assert.ok([...pagesCheck.values()].some((item) => item.freshness === "current"), "control: the check has a current row");
	for (const value of ["pages", "all"]) {
		rendered = view.render();
		elements(rendered.view!).find((node) => node.type === "select")!.props.onChange({ target: { value } });
		rendered = view.render();
		assert.equal(elements(rendered.view!).find((node) => node.type === "select")!.props.value, value);
		assert.equal(statusOf(rendered.view!), "", `no check runs for ${value}`);
		await settle();
		assert.equal(scoreRequests().length, 11, `selecting ${value} with the same rows sends no check`);
		rendered = view.render();
		const rows = rowsOf(rendered.view!);
		assert.deepEqual(rows.map((row) => row.ref), pagesOnly.content.map((row) => row.ref));
		for (const [index, row] of rows.entries()) {
			const item = pageRefs.includes(row.ref) ? pagesCheck.get(row.ref) : undefined;
			expectRow(row, pagesOnly.content[index]!, !item ? { kind: "saved" } : item.freshness === "current" ? { kind: "current", item } : { kind: "stale" });
		}
	}
	view.unmount();
	check("a type change that selects the rows already checked sends no check and keeps that check's result");

	assert.ok(requests.every((request) => ["admin-overview", "scores"].includes(request.route)), "the view reads only the overview and stored scores");
	console.log(`Content health view selfcheck passed (${cases} cases).`);
} finally {
	globalThis.fetch = originalFetch;
	await db.destroy();
}
