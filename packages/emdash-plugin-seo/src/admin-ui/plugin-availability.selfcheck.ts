import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import { MutationCache, MutationObserver, QueryCache, QueryClient, QueryClientContext, QueryClientProvider } from "@tanstack/react-query";

import { SEO_ENGINE_PLUGIN_ID } from "@shipitseo/emdash-plugin-seo/admin-contract";
import { SEO_DEFAULT_BRAND_NAME } from "../branding.ts";
import { verificationHostVersion } from "../site-verification.ts";
import { SeoBrandProvider, seoAdminBrandFromManifest, useSeoBrand, type SeoAdminBrand } from "./brand-context.ts";
import { SEO_CATALOGUES, createSeoI18n } from "./i18n/messages.ts";
import * as availabilityModel from "./plugin-availability-model.ts";

const {
	SEO_HOST_MANIFEST_KEY,
	SEO_PLUGINS_MANAGER_URL,
	createSeoPluginAvailabilityWatch,
	isSeoPluginRouteMissing,
	seoPluginDisabled,
	seoPluginManifestState,
} = availabilityModel;

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let cases = 0;
async function check(name: string, run: () => void | Promise<void>) {
	try { await run(); } catch (error) { throw new Error(name + ": " + (error instanceof Error ? error.message : String(error))); }
	cases += 1;
}

/** The error EmDash's admin client throws for its own 404 answer to an unregistered plugin route. */
function hostRouteMissing(): Error {
	return Object.assign(new Error("Plugin route not found"), { name: "ApiResponseError", status: 404, code: "NOT_FOUND" });
}
function manifest(enabled: unknown) {
	return { version: "1.3.0", plugins: { [SEO_ENGINE_PLUGIN_ID]: { version: "0.4.0", enabled, adminMode: "react", adminPages: [{ path: "/seo" }] } } };
}

function compile(text: string, fileName: string, scope: Record<string, unknown>, modules: Record<string, unknown> = {}) {
	const result = ts.transpileModule(text, { fileName, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", ...Object.keys(scope), result.outputText)((name: string) => {
		if (name === "react/jsx-runtime") return jsx;
		assert.ok(Object.hasOwn(modules, name), "Unexpected production import: " + name);
		return modules[name];
	}, output, output.exports, ...Object.values(scope));
	return output.exports;
}
function declaration(source: string, name: string): string {
	const parsed = ts.createSourceFile("production.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
	assert.equal(found.length, 1, "Exact production declaration: " + name);
	return found[0]!.getText(parsed);
}

await check("the manifest flag EmDash already loaded decides the state", () => {
	assert.equal(seoPluginManifestState(manifest(false)), "disabled");
	assert.equal(seoPluginManifestState(manifest(true)), "enabled");
	for (const value of [undefined, null, "manifest", [], {}, { plugins: null }, { plugins: {} }, { plugins: { other: { enabled: false } } },
		manifest(undefined), manifest("false"), { plugins: { [SEO_ENGINE_PLUGIN_ID]: null } }]) {
		assert.equal(seoPluginManifestState(value), "unknown", JSON.stringify(value) ?? "undefined");
	}
	const inherited = Object.create({ [SEO_ENGINE_PLUGIN_ID]: { enabled: false } });
	assert.equal(seoPluginManifestState({ plugins: inherited }), "unknown", "only the manifest's own entry counts");
	assert.deepEqual(SEO_HOST_MANIFEST_KEY, ["manifest"]);
	assert.equal(SEO_PLUGINS_MANAGER_URL, "/_emdash/admin/plugins-manager");
});

await check("only EmDash's unregistered-route answer counts as a missing route", () => {
	assert.equal(isSeoPluginRouteMissing(hostRouteMissing()), true);
	const near = [
		Object.assign(new Error("Entry not found"), { status: 404, code: "NOT_FOUND" }),
		Object.assign(new Error("Plugin route not found"), { status: 405, code: "NOT_FOUND" }),
		Object.assign(new Error("Plugin route not found"), { status: 404, code: "PLUGIN_ERROR" }),
		Object.assign(new Error("Plugin route error"), { status: 500, code: "INTERNAL_ERROR" }),
		new Error("Plugin route not found"),
		{ status: 404, code: "NOT_FOUND" },
		null,
		"Plugin route not found",
	];
	for (const error of near) assert.equal(isSeoPluginRouteMissing(error), false, String(error));
});

await check("a manifest that says enabled outweighs a missing route", () => {
	assert.equal(seoPluginDisabled("disabled", false), true);
	assert.equal(seoPluginDisabled("disabled", true), true);
	assert.equal(seoPluginDisabled("unknown", true), true);
	assert.equal(seoPluginDisabled("unknown", false), false);
	assert.equal(seoPluginDisabled("enabled", true), false);
	assert.equal(seoPluginDisabled("enabled", false), false);
});

await check("the first missing route refreshes the manifest once and notifies once", () => {
	let refreshes = 0; let notified = 0;
	const watch = createSeoPluginAvailabilityWatch(() => { refreshes += 1; });
	const stop = watch.subscribe(() => { notified += 1; });
	watch.report(new Error("Network down"));
	watch.report(Object.assign(new Error("Entry not found"), { status: 404, code: "NOT_FOUND" }));
	assert.deepEqual([watch.routeMissing(), refreshes, notified], [false, 0, 0], "other failures keep their own error states");
	watch.report(hostRouteMissing());
	assert.deepEqual([watch.routeMissing(), refreshes, notified], [true, 1, 1]);
	watch.report(hostRouteMissing());
	assert.deepEqual([refreshes, notified], [1, 1], "later answers never repeat the manifest read");
	stop();
	const second = createSeoPluginAvailabilityWatch(() => {});
	let late = 0;
	second.subscribe(() => { late += 1; })();
	second.report(hostRouteMissing());
	assert.equal(late, 0, "an unsubscribed listener is not called");
});

const viewSource = read("./plugin-disabled-view.tsx");
let locale = "en";
const { SeoPluginDisabledState } = compile(viewSource, "plugin-disabled-view.tsx", {}, {
	"@phosphor-icons/react": icons,
	"./brand-context.ts": { useSeoBrand },
	"./i18n/index.ts": { useSeoI18n: () => createSeoI18n(locale) },
	"./plugin-availability-model.ts": availabilityModel,
});
const DEFAULT_BRAND: SeoAdminBrand = { kind: "default", name: SEO_DEFAULT_BRAND_NAME };
function renderDisabled(brand: SeoAdminBrand | null = DEFAULT_BRAND) {
	const view = React.createElement(SeoPluginDisabledState);
	return renderToStaticMarkup(brand ? React.createElement(SeoBrandProvider, { value: brand }, view) : view);
}

await check("the disabled state says what happened, where to enable it and that data is kept", () => {
	const html = renderDisabled();
	const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	assert.equal(text, "SHIPIT SEO is disabled Enable it in EmDash Plugins to use these settings. Saved data is kept. Open EmDash Plugins");
	assert.match(html, /<h2 id="seo-plugin-disabled-title">SHIPIT SEO is disabled<\/h2>/);
	assert.match(html, /<section class="shipit-seo-panel shipit-seo-plugin-disabled" role="status" aria-labelledby="seo-plugin-disabled-title">/);
	assert.match(html, /<a class="shipit-seo-plugin-disabled__action" href="\/_emdash\/admin\/plugins-manager">Open EmDash Plugins<\/a>/);
	assert.doesNotMatch(html, /<button|Retry|unavailable|Plugin route not found/i, "no retry loop and no raw route error");
	assert.match(html, /^<div class="shipit-seo-admin">/, "the workspace styles and container apply");
});

await check("the disabled title names the configured brand, or a neutral label when it cannot be read", () => {
	assert.match(renderDisabled({ kind: "configured", name: "Acme Search & Co" }), /<h2 id="seo-plugin-disabled-title">Acme Search &amp; Co is disabled<\/h2>/);
	const fallback = renderDisabled(null);
	assert.match(fallback, /<h2 id="seo-plugin-disabled-title">SEO is disabled<\/h2>/);
	assert.doesNotMatch(fallback, /Shipit|SHIPIT/);
});

await check("Dutch and Turkish name the same state in their own words", () => {
	for (const next of ["nl", "tr"] as const) {
		locale = next;
		const html = renderDisabled({ kind: "configured", name: "Acme SEO" });
		const catalogue = SEO_CATALOGUES[next];
		for (const key of ["plugin.disabled.title", "plugin.disabled.body", "plugin.disabled.action"] as const) {
			assert.ok(html.includes(catalogue[key].replace("{brand}", "Acme SEO")), next + " shows " + key);
			assert.notEqual(catalogue[key], SEO_CATALOGUES.en[key], next + " translates " + key);
		}
		assert.ok(html.includes('href="/_emdash/admin/plugins-manager"'));
	}
	locale = "en";
});

await check("the view needs no request or workspace code", () => {
	assert.doesNotMatch(viewSource, /api\.ts|apiFetch|fetch\(|useQuery|onRetry/);
	const imports = viewSource.match(/^import [^;]+;$/gm);
	assert.deepEqual(imports, [
		'import { Plugs } from "@phosphor-icons/react";',
		'import { useSeoBrand } from "./brand-context.ts";',
		'import { useSeoI18n } from "./i18n/index.ts";',
		'import { SEO_PLUGINS_MANAGER_URL } from "./plugin-availability-model.ts";',
	]);
});

// The admin page as shipped: only the host manifest and failed plugin requests switch it.
const admin = read("./admin.tsx");
let pageClient: QueryClient | null = null;
function PageQueryClientProvider(props: { client: QueryClient; children?: React.ReactNode }) {
	pageClient = props.client;
	return React.createElement(QueryClientProvider, props);
}
const { SeoAdminPage } = compile(declaration(admin, "SeoAdminPage") + "\nexport { SeoAdminPage };", "admin-page-probe.tsx", {
	React, QueryClient, QueryCache, MutationCache, QueryClientContext,
	QueryClientProvider: PageQueryClientProvider,
	RobotsHostSettingsContext: React.createContext<unknown>(null),
	SiteVerificationHostContext: React.createContext<unknown>(null),
	Toasty: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
	SeoAdminWorkspace: () => React.createElement("p", null, "workspace-probe", React.createElement("b", null, useSeoBrand().name)),
	SeoPluginDisabledState: () => React.createElement("p", null, "disabled-probe", React.createElement("b", null, useSeoBrand().name)),
	SeoBrandProvider, seoAdminBrandFromManifest,
	verificationHostVersion,
	...availabilityModel,
});

type HostClient = { client: QueryClient; refreshes: unknown[] };
function hostClient(data?: unknown): HostClient {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	if (data !== undefined) client.setQueryData(["manifest"], data);
	const refreshes: unknown[] = [];
	client.invalidateQueries = ((filters?: unknown) => { refreshes.push(filters); return Promise.resolve(); }) as QueryClient["invalidateQueries"];
	return { client, refreshes };
}
function renderPage(host: HostClient | null) {
	pageClient = null;
	const page = React.createElement(SeoAdminPage);
	const html = renderToStaticMarkup(host ? React.createElement(QueryClientProvider, { client: host.client }, page) : page);
	assert.ok(pageClient, "the page keeps its own query client");
	return { html, client: pageClient as QueryClient };
}

await check("a disabled manifest replaces the workspace before any plugin request", () => {
	const host = hostClient(manifest(false));
	const { html, client } = renderPage(host);
	assert.match(html, /disabled-probe/);
	assert.doesNotMatch(html, /workspace-probe/);
	assert.equal(client.getQueryCache().getAll().length, 0, "no plugin query was created");
	assert.deepEqual(host.refreshes, [], "reading the manifest sends nothing");
});

await check("an enabled, unread or absent manifest keeps the workspace", () => {
	for (const host of [hostClient(manifest(true)), hostClient(), hostClient({ version: "1.3.0", plugins: {} }), null]) {
		const { html } = renderPage(host);
		assert.match(html, /workspace-probe/);
		assert.doesNotMatch(html, /disabled-probe/);
	}
});

await check("the page names the workspace from the menu label in the manifest", () => {
	const labelled = (label: unknown, enabled = true) => ({ version: "1.3.0", plugins: { [SEO_ENGINE_PLUGIN_ID]: {
		version: "0.4.0", enabled, adminMode: "react", adminPages: [{ path: "/seo", label, icon: "search" }] } } });
	assert.match(renderPage(hostClient(labelled(SEO_DEFAULT_BRAND_NAME))).html, /workspace-probe<b>SHIPIT SEO<\/b>/);
	assert.match(renderPage(hostClient(labelled("Acme SEO"))).html, /workspace-probe<b>Acme SEO<\/b>/);
	assert.match(renderPage(hostClient(labelled("Acme SEO", false))).html, /disabled-probe<b>Acme SEO<\/b>/, "the disabled page keeps the configured name");
	for (const host of [hostClient(labelled(undefined)), hostClient(labelled("Acme {SEO}")), hostClient(labelled(" Acme ")), hostClient(), null]) {
		const { html } = renderPage(host);
		assert.match(html, /workspace-probe<b>SEO<\/b>/, "an unreadable label falls back to the neutral name");
		assert.doesNotMatch(html, /Shipit|SHIPIT/);
	}
});

await check("failed plugin reads and writes report a missing route and refresh the manifest once", async () => {
	const host = hostClient();
	const { client } = renderPage(host);
	await client.fetchQuery({ queryKey: ["probe", "other"], queryFn: () => Promise.reject(new Error("Network down")), retry: false }).catch(() => {});
	assert.deepEqual(host.refreshes, [], "another failure keeps its error state");
	await client.fetchQuery({ queryKey: ["probe", "read"], queryFn: () => Promise.reject(hostRouteMissing()), retry: false }).catch(() => {});
	assert.deepEqual(host.refreshes, [{ queryKey: ["manifest"], refetchType: "all" }]);
	await client.fetchQuery({ queryKey: ["probe", "again"], queryFn: () => Promise.reject(hostRouteMissing()), retry: false }).catch(() => {});
	assert.equal(host.refreshes.length, 1);

	const writer = hostClient();
	const { client: writeClient } = renderPage(writer);
	await new MutationObserver(writeClient, { mutationFn: () => Promise.reject(hostRouteMissing()) }).mutate().catch(() => {});
	assert.deepEqual(writer.refreshes, [{ queryKey: ["manifest"], refetchType: "all" }]);
});

await check("the page wiring reads the manifest cache and keeps the version read unchanged", () => {
	const page = declaration(admin, "SeoAdminPage");
	assert.match(page, /\{disabled \? <SeoPluginDisabledState \/> : <SeoAdminWorkspace \/>\}/);
	assert.match(page, /const disabled = seoPluginDisabled\(seoPluginManifestState\(hostManifest\), routeMissing\);/);
	assert.match(page, /queryCache: new QueryCache\(\{ onError: availability\.report \}\),\s*mutationCache: new MutationCache\(\{ onError: availability\.report \}\),/);
	assert.match(page, /verificationHostVersion\(hostQueryClient\?\.getQueryData\(\["manifest"\]\)\)/);
	assert.doesNotMatch(page, /fetchQuery|ensureQueryData|refetchInterval|setInterval/, "nothing polls the host");
});

await check("the disabled styles keep readable text and a visible focus ring", () => {
	const css = read("./workspace.css");
	const rule = (selector: string) => {
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const found = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
		assert.ok(found, "rule exists: " + selector);
		return found!;
	};
	assert.match(rule(".shipit-seo-plugin-disabled > p"), /color: var\(--text-color-kumo-default, #20242c\);\s*font-size: 13px;/);
	assert.match(rule(".shipit-seo-plugin-disabled__action"), /color: var\(--text-color-kumo-link, #1769c2\);/);
	assert.match(rule(".shipit-seo-plugin-disabled__action:focus-visible"), /outline: 2px solid/);
	assert.match(read("./admin.tsx"), /import "\.\/workspace\.css";/);
});

console.log(`Plugin availability self-check passed (${cases} cases).`);
