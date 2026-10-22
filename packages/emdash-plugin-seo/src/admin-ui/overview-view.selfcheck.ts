import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import { Button as KumoButton } from "@cloudflare/kumo/components/button";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Select } from "@cloudflare/kumo/components/select";
import { QueryClient, QueryClientProvider, QueryObserver, useQuery, useQueryClient } from "@tanstack/react-query";
import {
 SEO_ADMIN_CONTRACT_VERSION, SEO_ADMIN_SETTINGS_STORAGE_VERSION, SEO_ENGINE_VERSION,
 type SeoAdminOverview, type SeoAdminReadableSettings, type SeoAdminSettings, type SeoAdminUnreadableSettings,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { buildSeoAdminSearch, parseSeoAdminLocation, type SeoAdminView } from "./content-extension-model.ts";
import * as workspace from "./workspace-model.ts";
import * as overviewModel from "./overview-model.ts";
import { createSeoI18n } from "./i18n/messages.ts";
import type { OverviewViewProps } from "./overview-view.tsx";

function overview(): SeoAdminOverview {
 return {
  contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, generatedAt: "2026-10-16T12:00:00.000Z",
  readiness: { score: 91, state: "review", title: "Review setup", description: "Review setup." },
  site: { name: "Example", url: "https://example.test", indexable: true, robotsMode: "none", settingsState: "saved", defaultSocialImage: null, socialProfileCount: 0 },
  summary: { totalScored: 2, sampleSize: 2, averageContentScore: 51, needsAttention: 1, schemaPresetsEnabled: 3, schemaPresetsTotal: 5, customSchemas: 0, legacyOverrides: 0, migrationRecords: 0, enabledModules: 2, totalModules: 8 },
  priorities: [{ priority: 1, area: "Future owner", check: "Unknown owner", status: "review", detail: "Review." }],
  checks: [{ group: "Setup", check: "Unknown owner", status: "review", weight: 1, detail: "Review." }], content: [],
 };
}
function settings(): SeoAdminReadableSettings {
 return {
  contractVersion: SEO_ADMIN_CONTRACT_VERSION, storageVersion: SEO_ADMIN_SETTINGS_STORAGE_VERSION, engineVersion: SEO_ENGINE_VERSION,
  state: "saved", updatedAt: "2026-10-16T11:00:00.000Z", revision: "settings-1", legacyGuard: null, legacyPresent: false, indexingPreferenceConfirmed: true,
  hostSiteUrl: "https://example.test", contentScoring: { state: "paused", revision: "scoring-1", intentEnabled: false, acknowledgedNoticeVersion: null, currentNoticeVersion: 1 },
  values: { siteName: "Example", siteUrl: "https://example.test", publisherType: "organization", organizationName: "Example", organizationLogo: "", personName: "", socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false, contentScoringEnabled: false },
 };
}
function unreadable(): SeoAdminUnreadableSettings {
 return { ...settings(), state: "unavailable", updatedAt: null, revision: null, legacyGuard: null, legacyPresent: false, indexingPreferenceConfirmed: false, values: null, contentScoring: { state: "unavailable", reason: "unreadable" } };
}

type CapturedButton = { children?: React.ReactNode; variant?: string; disabled?: boolean; onClick?: () => void };
let buttons: CapturedButton[] = [];
let cards: { className?: string; onClick?: () => void; children?: React.ReactNode }[] = [];
let details: Record<string, unknown>[] = [];
let forwarded: OverviewViewProps | null = null;
function Button(props: React.ComponentProps<typeof KumoButton>) {
 buttons.push(props as CapturedButton);
 return React.createElement(KumoButton, props);
}
const observedJsx = Object.fromEntries(Object.entries(jsx).map(([name, value]) => [name,
 name === "jsx" || name === "jsxs" ? (...args: Parameters<typeof jsx.jsx>) => {
  const type = args[0];
  const props = args[1] as Record<string, any>;
  if (type === "button" && props?.className === "shipit-seo-overview__link") cards.push(props);
  if (type === "details") details.push(props);
  return (value as typeof jsx.jsx)(...args);
 } : value,
]));
const requireReact = createRequire(import.meta.resolve("react"));
function compile(text: string, fileName: string, scope: Record<string, unknown> = {}, modules: Record<string, unknown> = {}) {
 const result = ts.transpileModule(text, { fileName, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
 assert.deepEqual(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
 const output = { exports: {} };
 new Function("require", "module", "exports", ...Object.keys(scope), result.outputText)((name: string) => {
  if (name === "react/jsx-runtime") return observedJsx;
  if (name === "react") return requireReact(name);
  assert.ok(Object.hasOwn(modules, name), "Unexpected production import: " + name);
  return modules[name];
 }, output, output.exports, ...Object.values(scope));
 return output.exports as Record<string, any>;
}
const viewSource = readFileSync(new URL("./overview-view.tsx", import.meta.url), "utf8");
const { OverviewView: ActualOverviewView } = compile(viewSource, "overview-view.tsx", {}, {
 "@cloudflare/kumo/components/button": { Button }, "@phosphor-icons/react": icons, "./overview-model.ts": overviewModel, "./workspace-model.ts": workspace,
});
function OverviewView(props: OverviewViewProps) { forwarded = props; return React.createElement(ActualOverviewView, props); }
const source = ts.createSourceFile("admin.tsx", readFileSync(new URL("./admin.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declarationFrom(parsed: ts.SourceFile, name: string): string {
 const found = parsed.statements.filter((node) => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name));
 assert.equal(found.length, 1, "Exact production declaration: " + name);
 return found[0].getText(parsed);
}
function declaration(name: string): string { return declarationFrom(source, name); }
const shell = ts.createSourceFile("workspace-shell.tsx", readFileSync(new URL("./workspace-shell.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const { SeoViewBoundary: ActualBoundary } = compile(declarationFrom(shell, "SeoViewBoundary"), "boundary-probe.tsx", {
 React, Button, WarningCircle: icons.WarningCircle, ArrowClockwise: icons.ArrowClockwise,
 isSeoContractMismatchError: workspace.isSeoContractMismatchError,
 ContractMismatchScreen: () => React.createElement("p", null, "Contract mismatch"),
});
let forceBoundaryErrorState = false;
function SeoViewBoundary(props: { resetKey: string; children?: React.ReactNode }) {
 if (!forceBoundaryErrorState || props.resetKey !== "overview") return React.createElement(ActualBoundary, props);
 const boundary = new ActualBoundary(props);
 boundary.state = ActualBoundary.getDerivedStateFromError(new Error("Synthetic captured Overview render error"));
 return boundary.render();
}
const hooks = ["useOverviewQuery", "useSettingsQuery"].map(declaration).join("\n");
const overlapViews: SeoAdminView[] = [];
let overlapOpen: (() => void) | null = null;
let overviewReads = 0;
let settingsReads = 0;
const queries = {
 fetchSeoAdminOverview: () => { overviewReads += 1; return Promise.reject(new Error("Synthetic overview read failure")); },
 fetchSeoAdminSettings: () => { settingsReads += 1; return Promise.reject(new Error("A passive settings read must stay disabled")); },
};
const options = compile(hooks + "\nexport {useOverviewQuery,useSettingsQuery};", "query-options.tsx", { ...queries, useQuery: (value: unknown) => value, seoWorkspaceKeys: workspace.seoWorkspaceKeys });
const inert = () => null;
const scope = {
 React, ...queries, useQuery, useQueryClient, ...workspace, buildSeoAdminSearch, parseSeoAdminLocation, OverviewView,
 Banner, Button, Badge, Select, ShipitLogo: inert, SlidersHorizontal: icons.SlidersHorizontal,
 useSeoI18n: () => createSeoI18n("en"),
 cancelBusinessIdentityProfileFocus: inert, requestBusinessIdentityFocus: inert,
 WorkspaceNavigation: inert, IndexingNavigation: inert, LocalSeoNavigation: inert, SeoViewBoundary,
 ViewSkeleton: ({ label }: { label: string }) => React.createElement("p", { role: "status" }, label),
 ViewErrorState: ({ title }: { title: string }) => React.createElement("p", { role: "alert" }, title),
 ContentScoringControls: inert, ContentAuditContainer: inert, WorkQueueView: inert, TrendsView: inert, CrawlDiagnosticsView: inert,
 NotFoundView: inert, TemplatesContainer: inert, SettingsSectionContainer: inert, ModulesContainer: inert, SitemapContainer: inert,
 RobotsTxtView: inert, LlmsTxtView: inert, SchemaLibraryView: inert, IndexNowView: inert, SiteVerificationView: inert, CustomVerificationView: inert,
 MigrationContainer: inert, PortabilityView: inert, SchemaContainer: inert,
 WorkspaceDraftProvider: ({ children }: { children?: React.ReactNode }) => children,
 WorkspacePageActiveProvider: ({ children }: { children?: React.ReactNode }) => children,
 PluginOverlapLine: ({ view, onOpenModules }: { view: SeoAdminView; onOpenModules: () => void }) => {
  overlapViews.push(view); overlapOpen = onOpenModules;
  return React.createElement("p", { className: "overlap-line-probe" }, "overlap-line-probe");
 },
};
const production = compile(["useOverviewQuery", "useSettingsQuery", "OverviewContainer", "SeoAdminWorkspace"].map(declaration).join("\n") + "\nexport {SeoAdminWorkspace};", "workspace-probe.tsx", scope);
function forwardedProps(): OverviewViewProps | null { return forwarded; }
function resetCapture() { buttons = []; cards = []; details = []; forwarded = null; }
function renderView(data: SeoAdminOverview, cached?: SeoAdminSettings, refreshing = false, hideNextStep = false) {
 resetCapture();
 const opened: SeoAdminView[] = []; let refreshed = 0;
 const html = renderToStaticMarkup(React.createElement(OverviewView, { data, settings: cached, onOpenPriority: (view) => opened.push(view), onRefresh: () => refreshed += 1, refreshing, hideNextStep }));
 return { html, opened, refreshes: () => refreshed };
}
function stat(html: string, label: string) {
 const match = html.match(new RegExp(`<dt>${label}</dt><dd><strong>(.*?)</strong><small>(.*?)</small></dd>`));
 assert.ok(match, "Labeled saved statistic: " + label);
 return { value: match[1], detail: match[2] };
}
let cases = 0;
function check(name: string, run: () => void) { run(); cases += 1; }
check("snapshot times use the medium date and short time the other pages use", () => {
 const { html } = renderView(overview(), settings());
 const expected = new Date("2026-10-16T12:00:00.000Z").toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
 assert.ok(html.includes(`Snapshot from ${expected}.`), "setup snapshot time");
 assert.ok(html.includes(`<dt>Updated</dt><dd>${expected}</dd>`), "results update time");
 assert.doesNotMatch(html, /\d{1,2}\/\d{1,2}\/\d{4}/, "no numeric date");
});
check("one primary action, qualified saved numbers, setup details open and no duplicate settings grid", () => {
 const before = overview(); const cached = settings(); const snapshot = structuredClone(cached);
 const result = renderView(before, cached);
 assert.equal(buttons.filter((button) => button.variant === "primary").length, 1);
 assert.equal((result.html.match(/Setup score: 91\/100/g) ?? []).length, 1);
 assert.equal(details.length, 2);
 assert.equal(details[0].open, true, "Setup details are visible without a click");
 assert.equal(details[1].open, undefined, "About these results stays folded");
 assert.ok(details.every((props) => props.onToggle === undefined));
 assert.match(result.html, /<details class="shipit-seo-overview__details" open="">\s*<summary><span>Setup details<\/span>/);
 assert.match(result.html, /Saved results only/);
 assert.match(result.html, /separately from content quality/);
 assert.doesNotMatch(result.html, /\bP[12]\b|Current site health|Open future owner/i);
 assert.deepEqual(stat(result.html, "Saved score average"), { value: "51", detail: "2 recent saved scores" });
 assert.equal(cards.length, 0, "The rail is the only settings navigation");
 assert.doesNotMatch(result.html, /shipit-seo-overview__links|<h2[^>]*>Settings<\/h2>/);
 assert.deepEqual(result.opened, []);
 assert.deepEqual(cached, snapshot, "rendering never changes settings or activates features");
 const refresh = buttons.find((button) => button.children === "Refresh overview" || button.children === "Refreshing\u2026");
 assert.ok(refresh?.onClick); refresh.onClick(); assert.equal(result.refreshes(), 1);
 renderView(before, cached, true);
 assert.equal(buttons.find((button) => button.children === "Refresh overview" || button.children === "Refreshing\u2026")?.disabled, true);
});
check("the production site-address action opens Website settings without changing stored input", () => {
 const data = overview(); data.site.url = null;
 const cached = settings(); cached.values.siteUrl = ""; cached.hostSiteUrl = "";
 const before = structuredClone({ data, cached });
 const result = renderView(data, cached);
 const action = buttons.filter((button) => button.variant === "primary");
 assert.equal(action.length, 1);
 assert.equal(action[0].children, "Set site address");
 action[0].onClick?.();
 assert.deepEqual(result.opened, ["site"]);
 assert.deepEqual({ data, cached }, before);
});
check("setup actions distinguish site URL and publisher profiles despite their shared legacy area", () => {
 const data = overview(); const cached = settings();
 data.priorities = [
  { priority: 1, area: "Site identity", check: "Site URL", status: "review", detail: "Set the production domain." },
  { priority: 2, area: "Site identity", check: "SameAs profiles", status: "review", detail: "Review official profiles." },
 ];
 data.checks = [
  { group: "Indexing", check: "Site URL", status: "review", weight: 10, detail: "Set the production domain." },
  { group: "Social", check: "SameAs profiles", status: "review", weight: 1, detail: "Review official profiles." },
 ];
 const before = structuredClone({ data, cached });
 const result = renderView(data, cached);
 const action = (label: string) => {
  const found = buttons.filter((button) => React.Children.toArray(button.children).join("") === label);
  assert.equal(found.length, 1, label);
  return found[0]!;
 };
 action("Open Website").onClick?.();
 action("Open Local SEO").onClick?.();
 assert.deepEqual(result.opened, ["site", "identity"]);
 assert.doesNotMatch(result.html, /Open site identity/);
 assert.deepEqual({ data, cached }, before);
});
check("a caller-owned critical notice hides only the duplicate next step", () => {
 const result = renderView(overview(), unreadable(), false, true);
 assert.equal(buttons.filter((button) => button.variant === "primary").length, 0);
 assert.doesNotMatch(result.html, /SEO settings need attention|Next step/);
 assert.match(result.html, /Saved content results/); assert.equal(cards.length, 0);
});
check("empty, measured zero, zero findings and unavailable remain distinct in rendered saved statistics", () => {
 const data = overview(); data.summary.sampleSize = 0; data.summary.averageContentScore = null; data.summary.needsAttention = 0;
 let html = renderView(data).html;
 assert.equal(stat(html, "Saved score average").value, "--");
 assert.equal(stat(html, "Need attention").value, "--");
 assert.equal(stat(html, "Saved sample").value, "0");
 assert.match(html, /No saved analyses yet/);
 data.summary.sampleSize = 1; data.summary.averageContentScore = 0; data.summary.needsAttention = 1;
 html = renderView(data).html; assert.equal(stat(html, "Saved score average").value, "0");
 data.summary.averageContentScore = 91; data.summary.needsAttention = 0;
 html = renderView(data).html; assert.equal(stat(html, "Need attention").value, "0");
 html = renderView(data, unreadable()).html;
 for (const label of ["Saved score average", "Need attention", "Saved sample"]) assert.equal(stat(html, label).value, "--");
 assert.doesNotMatch(html, /No saved analyses yet/);
});

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const pushed: string[] = [];
const location = { pathname: "/_emdash/admin/plugins/shipit-seo/seo", search: "?keep=1&view=overview", hash: "#proof" };
Object.defineProperty(globalThis, "window", { configurable: true, value: {
 location, history: { state: { proof: true }, pushState(_state: unknown, _title: string, url: string) { pushed.push(url); const next = new URL(url, "https://fixture.invalid"); location.search = next.search; location.hash = next.hash; } },
} });
async function settle(done: () => boolean, message: string) {
 for (let turn = 0; turn < 100 && !done(); turn += 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
 assert.ok(done(), message);
}
try {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } } });
 client.mount();
 const data = overview();
 client.setQueryData(workspace.seoWorkspaceKeys.overview, data);
 client.setQueryData(workspace.seoWorkspaceKeys.settings, settings());
 const passiveOverview = new QueryObserver(client, options.useOverviewQuery(false));
 const passiveSettings = new QueryObserver(client, options.useSettingsQuery(false));
 let overviewNotifications = 0; let settingsNotifications = 0;
 const stopOverview = passiveOverview.subscribe(() => overviewNotifications += 1);
 const stopSettings = passiveSettings.subscribe(() => settingsNotifications += 1);
 const renderWorkspace = (view: SeoAdminView = "overview") => {
  resetCapture(); location.search = "?keep=1&view=" + view; location.hash = "#proof";
  return renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(production.SeoAdminWorkspace)));
 };
 const clickPrimary = (view: SeoAdminView) => {
  const primary = buttons.filter((button) => button.variant === "primary"); assert.equal(primary.length, 1);
  const cached = structuredClone(client.getQueryData(workspace.seoWorkspaceKeys.settings));
  primary[0].onClick?.(); const url = new URL(pushed.at(-1)!, "https://fixture.invalid");
  assert.equal(url.searchParams.get("view"), view); assert.equal(url.searchParams.get("keep"), "1"); assert.equal(url.hash, "#proof");
  assert.deepEqual(client.getQueryData(workspace.seoWorkspaceKeys.settings), cached);
 };
 let html = renderWorkspace();
 assert.equal(forwardedProps()?.settings, client.getQueryData(workspace.seoWorkspaceKeys.settings), "the production workspace forwards its actual passive settings cache");
 assert.equal((html.match(/Setup score: 91\/100/g) ?? []).length, 1, "workspace does not add a duplicate readiness strip");
 const settingsBeforeNavigation = structuredClone(client.getQueryData(workspace.seoWorkspaceKeys.settings));
 assert.equal(cards.length, 0);
 assert.equal(overlapViews.at(-1), "overview", "The overlap notice owner receives the Overview route");
 assert.ok(html.indexOf("overlap-line-probe") >= 0 && html.indexOf("overlap-line-probe") < html.indexOf("Saved content results"),
  "The overlap notice sits above the Overview content");
 overlapOpen!(); assert.equal(new URL(pushed.at(-1)!, "https://fixture.invalid").searchParams.get("view"), "modules", "Review opens Feature controls");
 assert.deepEqual(client.getQueryData(workspace.seoWorkspaceKeys.settings), settingsBeforeNavigation);
 cases += 1;
 const newerUnreadable = unreadable(); const cachedUnreadable = client.setQueryData(workspace.seoWorkspaceKeys.settings, newerUnreadable);
 await settle(() => passiveSettings.getCurrentResult().data === cachedUnreadable && settingsNotifications > 0, "mounted passive settings observer sees direct saves");
 html = renderWorkspace();
 assert.equal(forwardedProps()?.settings, cachedUnreadable);
 assert.match(html, /SEO settings cannot be read/); assert.doesNotMatch(html, /SEO settings need attention/);
 assert.equal(forwardedProps()?.hideNextStep, true);
 assert.equal(stat(html, "Saved score average").value, "--"); clickPrimary("indexing"); cases += 1;
 const noindex = settings(); noindex.values.noindex = true; client.setQueryData(workspace.seoWorkspaceKeys.settings, noindex);
 html = renderWorkspace(); assert.match(html, /Search engines are told not to index supported pages/);
 assert.doesNotMatch(html, /Search visibility is restricted/); assert.equal(forwardedProps()?.hideNextStep, true); clickPrimary("indexing"); cases += 1;
 const oldUnavailable = overview(); oldUnavailable.site.settingsState = "unavailable"; oldUnavailable.site.indexable = null; oldUnavailable.site.robotsMode = "unknown";
 oldUnavailable.summary.sampleSize = 0; oldUnavailable.summary.averageContentScore = null; oldUnavailable.summary.needsAttention = 0;
 client.setQueryData(workspace.seoWorkspaceKeys.overview, oldUnavailable); client.setQueryData(workspace.seoWorkspaceKeys.settings, settings());
 html = renderWorkspace(); assert.match(html, /Saved results need reloading/); assert.doesNotMatch(html, /No saved analyses yet|Start with one page/);
 assert.equal(stat(html, "Saved sample").value, "--"); clickPrimary("content"); cases += 1;
 client.setQueryData(workspace.seoWorkspaceKeys.overview, overview());
 forceBoundaryErrorState = true;
 for (const [cached, notice] of [[unreadable(), /SEO settings cannot be read/], [noindex, /Search engines are told not to index supported pages/]] as const) {
  client.setQueryData(workspace.seoWorkspaceKeys.settings, cached);
  html = renderWorkspace();
  assert.match(html, /This view failed to render/); assert.match(html, notice);
  assert.equal(forwarded, null, "the actual boundary fallback replaces the Overview child in this captured-error-state probe");
  clickPrimary("indexing");
 }
 forceBoundaryErrorState = false; cases += 1;
 client.setQueryData(workspace.seoWorkspaceKeys.overview, overview()); client.setQueryData(workspace.seoWorkspaceKeys.settings, unreadable());
 renderWorkspace();
 const refreshAction = buttons.find((button) => button.children === "Refresh overview" || button.children === "Refreshing\u2026");
 assert.ok(refreshAction?.onClick); refreshAction.onClick();
 renderWorkspace();
 assert.equal(forwardedProps()?.refreshing, true, "the actual Refresh action forwards the query's fetching state");
 assert.equal(buttons.find((button) => button.children === "Refresh overview" || button.children === "Refreshing\u2026")?.disabled, true);
 await settle(() => passiveOverview.getCurrentResult().isError && overviewNotifications > 0, "failed refresh retains data but leaves success status");
 assert.ok(passiveOverview.getCurrentResult().data, "a failed refresh keeps its old data for this precedence case");
 html = renderWorkspace(); assert.match(html, /SEO overview unavailable/); assert.match(html, /SEO settings cannot be read/);
 assert.equal(forwarded, null, "query fallback retains the critical notice outside the boundary");
 client.setQueryData(workspace.seoWorkspaceKeys.settings, noindex);
 html = renderWorkspace(); assert.match(html, /Search engines are told not to index supported pages/); cases += 1;
 client.setQueryData(workspace.seoWorkspaceKeys.settings, unreadable());
 await client.resetQueries({ queryKey: workspace.seoWorkspaceKeys.overview, exact: true });
 html = renderWorkspace();
 assert.match(html, /Loading the SEO overview/); assert.match(html, /SEO settings cannot be read/);
 assert.equal(forwarded, null, "loading keeps the external critical notice visible");
 client.setQueryData(workspace.seoWorkspaceKeys.settings, noindex);
 html = renderWorkspace(); assert.match(html, /Search engines are told not to index supported pages/); cases += 1;
 html = renderWorkspace("templates");
 assert.match(html, /Search engines are told not to index supported pages/);
 assert.equal(buttons.filter((button) => button.variant === "primary").length, 0, "other workspace views retain their secondary critical action");
 assert.equal(buttons.filter((button) => button.children === "Open Indexing").length, 1);
 buttons.find((button) => button.children === "Open Indexing")?.onClick?.();
 assert.equal(new URL(pushed.at(-1)!, "https://fixture.invalid").searchParams.get("view"), "indexing"); cases += 1;
 assert.equal(settingsReads, 0, "passive settings cache updates and ordinary paint send no request");
 assert.equal(overviewReads, 2, "only the explicit failed refresh and its existing one retry send reads");
 assert.equal(client.getQueryCache().getAll().length, 2, "ordinary paint and disclosure markup add no query key");
 stopOverview(); stopSettings(); client.unmount(); client.clear();
} finally {
 if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
}
console.log(`Overview view and mounted query-cache wiring selfcheck passed (${cases} cases).`);
