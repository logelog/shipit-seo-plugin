import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import { QueryClient } from "@tanstack/react-query";

import { SEO_ENGINE_PLUGIN_ID } from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as branding from "../branding.ts";
import * as apiRoutes from "./api-routes.ts";
import { seoAdminBrandFromManifest, useSeoHostBrand, type SeoAdminBrand } from "./brand-context.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let cases = 0;
async function check(name: string, run: () => void | Promise<void>) {
	try { await run(); } catch (error) { throw new Error(name + ": " + (error instanceof Error ? error.message : String(error))); }
	cases += 1;
}

function compile(file: string, modules: Record<string, unknown>) {
	const result = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", result.outputText)((name: string) => {
		if (name === "react/jsx-runtime") return jsx;
		assert.ok(Object.hasOwn(modules, name), "Unexpected production import: " + name);
		return modules[name];
	}, output, output.exports);
	return output.exports;
}

const requests: string[] = [];
const { ShipitLogo } = compile("./shipit-logo.tsx", {});
const markModule = compile("./brand-mark.tsx", {
	react: React,
	"@emdash-cms/admin": {
		apiFetch: async (url: string) => { requests.push(url); return new Response("{}"); },
		parseApiResponse: async () => ({}),
	},
	"@phosphor-icons/react": icons,
	"../branding.ts": branding,
	"./api-routes.ts": apiRoutes,
	"./shipit-logo.tsx": { ShipitLogo },
});
const { SeoBrandMark, createSeoBrandLogoReader } = markModule as {
	SeoBrandMark: React.ComponentType<{ brand: SeoAdminBrand; reader?: unknown }>;
	createSeoBrandLogoReader: (read: () => Promise<unknown>) => {
		snapshot: () => { status: string; branding?: unknown };
		subscribe: (listener: () => void) => () => void;
		request: () => void;
	};
};

const DEFAULT: SeoAdminBrand = { kind: "default", name: "SHIPIT SEO" };
const ACME: SeoAdminBrand = { kind: "configured", name: "Acme SEO" };
const FALLBACK: SeoAdminBrand = { kind: "fallback", name: "SEO" };
const logo = { src: "/brand/acme.svg?v=0123456789ab", type: "image/svg+xml", width: 96, height: 96 };
const darkLogo = { src: "/brand/acme-dark.svg?v=ba9876543210", type: "image/svg+xml", width: 96, height: 96 };
const fixed = (state: unknown) => ({ snapshot: () => state, subscribe: () => () => {}, request: () => { throw new Error("a fixed reader is never asked"); } });
// React's server renderer hoists image preloads; the admin renders on the client.
const mark = (brand: SeoAdminBrand, state: unknown = { status: "loading" }) =>
	renderToStaticMarkup(React.createElement(SeoBrandMark, { brand, reader: fixed(state) })).replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
const BUILT_IN = /viewBox="123\.03127 101\.07082/;

function manifest(label: unknown, extra: Record<string, unknown> = {}) {
	return { version: "1.3.0", plugins: { [SEO_ENGINE_PLUGIN_ID]: { version: "0.4.0", enabled: true, adminMode: "react",
		adminPages: [{ path: "/other", label: "Other" }, { path: "/seo", label, icon: "search" }], ...extra } } };
}

await check("the workspace name is the menu label the host lists for this plugin's page", () => {
	assert.deepEqual(seoAdminBrandFromManifest(manifest("SHIPIT SEO")), DEFAULT);
	assert.deepEqual(seoAdminBrandFromManifest(manifest("Acme SEO")), ACME);
	assert.deepEqual(seoAdminBrandFromManifest(manifest("SEO")), { kind: "configured", name: "SEO" });
	assert.deepEqual(seoAdminBrandFromManifest(manifest("Ağaç Dijital")), { kind: "configured", name: "Ağaç Dijital" });
	const unreadable: unknown[] = [
		undefined, null, "manifest", {}, { plugins: null }, { plugins: {} }, { plugins: { other: { adminPages: [{ path: "/seo", label: "Acme" }] } } },
		manifest(undefined), manifest(42), manifest(""), manifest(" Acme"), manifest("Acme {SEO}"), manifest("x".repeat(33)),
		manifest("Acme", { adminPages: "nope" }), manifest("Acme", { adminPages: [{ path: "/elsewhere", label: "Acme" }] }),
	];
	for (const value of unreadable) assert.deepEqual(seoAdminBrandFromManifest(value), FALLBACK, JSON.stringify(value) ?? "undefined");
});

await check("the host manifest cache is read without a request", () => {
	const client = new QueryClient();
	client.setQueryData(["manifest"], manifest("Acme SEO"));
	function Probe({ cache }: { cache: QueryClient | null }) {
		return React.createElement("b", null, useSeoHostBrand(cache).name);
	}
	assert.equal(renderToStaticMarkup(React.createElement(Probe, { cache: client })), "<b>Acme SEO</b>");
	assert.equal(renderToStaticMarkup(React.createElement(Probe, { cache: null })), "<b>SEO</b>");
	assert.equal(client.getQueryCache().getAll().every((query) => query.state.fetchStatus === "idle"), true);
});

await check("the default brand keeps the built-in mark and asks for nothing", () => {
	const html = mark(DEFAULT);
	assert.match(html, BUILT_IN);
	assert.match(html, /^<span class="shipit-seo-product__icon" aria-hidden="true"><svg/);
	assert.equal(html, renderToStaticMarkup(React.createElement("span", { className: "shipit-seo-product__icon", "aria-hidden": "true" }, React.createElement(ShipitLogo))),
		"the unbranded mark is unchanged");
});

await check("a configured brand never shows the built-in mark", () => {
	const pending = mark(ACME, { status: "loading" });
	assert.equal(pending, '<span class="shipit-seo-product__icon shipit-seo-product__icon--pending" aria-hidden="true" data-logo="loading"></span>',
		"the slot is reserved and empty while the logo is read");
	assert.equal(mark(ACME, { status: "failed" }), '<span class="shipit-seo-product__icon shipit-seo-product__icon--pending" aria-hidden="true" data-logo="failed"></span>');
	const glyph = mark(ACME, { status: "ready", branding: { logo: null, logoDark: null } });
	assert.match(glyph, /^<span class="shipit-seo-product__icon shipit-seo-product__icon--neutral" aria-hidden="true"><svg/);
	const light = mark(ACME, { status: "ready", branding: { logo, logoDark: null } });
	assert.equal(light, '<span class="shipit-seo-product__icon shipit-seo-product__icon--image" aria-hidden="true">' +
		'<img class="shipit-seo-product__logo shipit-seo-product__logo--light" src="/brand/acme.svg?v=0123456789ab" alt="" width="96" height="96" decoding="async" draggable="false"/></span>');
	const themed = mark(ACME, { status: "ready", branding: { logo, logoDark: darkLogo } });
	assert.match(themed, /class="shipit-seo-product__icon shipit-seo-product__icon--image shipit-seo-product__icon--themed"/);
	assert.match(themed, /shipit-seo-product__logo--light" src="\/brand\/acme\.svg\?v=0123456789ab"/);
	assert.match(themed, /shipit-seo-product__logo--dark" src="\/brand\/acme-dark\.svg\?v=ba9876543210"/);
	for (const html of [pending, glyph, light, themed, mark(FALLBACK)]) {
		assert.doesNotMatch(html, BUILT_IN);
		assert.doesNotMatch(html, /Shipit|SHIPIT/);
	}
	assert.match(mark(FALLBACK, { status: "ready", branding: { logo, logoDark: null } }), /shipit-seo-product__icon--neutral/, "an unreadable brand shows no logo");
});

await check("the logo is read once per admin document and kept when it cannot be read", async () => {
	let reads = 0;
	const answers: unknown[] = [{ logo, logoDark: darkLogo }];
	const reader = createSeoBrandLogoReader(async () => { reads += 1; return answers.shift(); });
	let notified = 0;
	const stop = reader.subscribe(() => { notified += 1; });
	assert.deepEqual(reader.snapshot(), { status: "loading" });
	reader.request(); reader.request();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(reads, 1);
	assert.deepEqual(reader.snapshot(), { status: "ready", branding: { logo, logoDark: darkLogo } });
	assert.equal(notified, 1);
	stop();
	for (const answer of [{ logo: { ...logo, src: "https://cdn.example.com/a.svg?v=0123456789ab" }, logoDark: null }, { logo }, null]) {
		const malformed = createSeoBrandLogoReader(async () => answer);
		malformed.request();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.deepEqual(malformed.snapshot(), { status: "failed" }, JSON.stringify(answer));
	}
	const rejected = createSeoBrandLogoReader(async () => { throw new Error("Plugin route not found"); });
	rejected.request();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(rejected.snapshot(), { status: "failed" });
	const source = read("./brand-mark.tsx");
	assert.match(source, /apiFetch\(seoAdminApiUrl\("admin-branding"\), \{ cache: "no-store" \}\)/);
	assert.match(source, /if \(configured\) reader\.request\(\);/, "only a configured brand asks for its logo");
	assert.deepEqual(requests, [], "rendering alone sends nothing");
});

await check("the stylesheet switches logos with the host theme and wraps only a site's own name", () => {
	const css = read("./admin.css");
	assert.match(css, /\.shipit-seo-product__icon--themed \.shipit-seo-product__logo--dark,\n:is\(\.dark, \[data-theme="dark"\], \[data-mode="dark"\]\) \.shipit-seo-product__icon--themed \.shipit-seo-product__logo--light \{\n\tdisplay: none;\n\}/);
	assert.match(css, /:is\(\.dark, \[data-theme="dark"\], \[data-mode="dark"\]\) \.shipit-seo-product__icon--themed \.shipit-seo-product__logo--dark \{\n\tdisplay: block;\n\}/);
	assert.match(css, /\.shipit-seo-product__icon--image img \{[^}]*object-fit: contain;/);
	assert.match(css, /\.shipit-seo-workspace-nav__brand:not\(\[data-brand="default"\]\) h1 \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
	assert.match(css, /\.shipit-seo-workspace-nav__brand h1 \{[^}]*white-space: nowrap;/, "the default heading keeps its layout");
});

console.log(`SEO brand mark self-check passed (${cases} cases).`);
