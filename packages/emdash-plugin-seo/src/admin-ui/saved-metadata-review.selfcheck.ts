import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import {
	SEO_ADMIN_CONTRACT_VERSION, SEO_ADMIN_OUTPUT_SUPPORT, SEO_ENGINE_VERSION,
	type SeoAdminEntryPreview, type SeoAdminMetadataSource,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as brandContext from "./brand-context.ts";
import { SEO_OWNERSHIP_SOURCE_LABELS } from "./content-extension-model.ts";
import type { SavedMetadataReview } from "./saved-metadata-review.tsx";

type ReviewProps = Parameters<typeof SavedMetadataReview>[0];
type CapturedNode = { tag: string; props: Record<string, any> };
let nodes: CapturedNode[] = [];
const observedJsx = Object.fromEntries(Object.entries(jsx).map(([name, value]) => [name,
	name === "jsx" || name === "jsxs" ? (...args: Parameters<typeof jsx.jsx>) => {
		if (typeof args[0] === "string") nodes.push({ tag: args[0], props: args[1] as Record<string, any> });
		return (value as typeof jsx.jsx)(...args);
	} : value,
]));
const source = readFileSync(new URL("./saved-metadata-review.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
	fileName: "saved-metadata-review.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} };
new Function("require", "module", "exports", compiled.outputText)((name: string) => {
	if (name === "react/jsx-runtime") return observedJsx;
	if (name === "./brand-context.ts") return brandContext;
	assert.equal(name, "./content-extension-model.ts", "only the shared ownership labels and the brand are needed at runtime");
	return { SEO_OWNERSHIP_SOURCE_LABELS };
}, output, output.exports);
const ActualReview = (output.exports as { SavedMetadataReview: React.ComponentType<ReviewProps> }).SavedMetadataReview;
function preview(): SeoAdminEntryPreview {
	const title = "A complete saved title suggestion with a long ending that remains visible ".repeat(3).trim();
	const description = "The complete saved description remains readable beyond the approximate search card. ".repeat(6).trim();
	const url = "https://example.invalid/distinct-resolved-preview-address/?first=one&second=two";
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, generatedAt: "2026-10-16T12:00:00.000Z",
		content: { ref: "posts:review", entryId: "review", collection: "posts", collectionLabel: "Posts", title: "Entry title", slug: "checked-entry-slug" },
		search: { title, description, url, titleLength: title.length, descriptionLength: description.length },
		social: { editing: { state: "ready", snapshot: { ref: "posts:review", revision: null, override: null } },
			title, description, image: null, fallbackTitle: title, fallbackDescription: description,
			override: { title: null, description: null, updatedAt: null } },
		indexable: true, entryNoindex: false, canonicalValidation: { status: "matches", canonical: url, expectedPath: "/distinct-resolved-preview-address/" },
		localeGraph: { owner: "emdash-core", emitsMarkup: false, status: "single-locale", hostSupportsTranslationGroups: true,
			currentLocale: null, defaultLocale: null, translationGroup: null, discoveredLocales: [], alternates: [], xDefaultLocale: null, issues: [] },
		schemaTypes: [], outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
		sources: { title: "core-seo", description: "template", canonical: "content", socialTitle: "content", socialDescription: "template", image: "site-default" },
	};
}
const brand: brandContext.SeoAdminBrand = { kind: "configured", name: "Acme SEO" };
function render(data = preview(), field: ReviewProps["field"] = null, previewError = false) {
	nodes = [];
	return renderToStaticMarkup(React.createElement(brandContext.SeoBrandProvider, { value: brand },
		React.createElement(ActualReview, { preview: data, field, previewError })));
}
function classNodes(name: string) { return nodes.filter((node) => node.props.className?.split(" ").includes(name)); }
function values() { return classNodes("shipit-seo-saved-metadata__value").map((node) => node.props.children); }
function escapeMarkup(value: string) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
let cases = 0;
function check(name: string, run: () => void) { run(); cases += 1; }
check("complete saved values, their actual sources and displayed lengths remain outside the fitted card", () => {
	const data = preview(); const before = structuredClone(data); const html = render(data);
	assert.deepEqual(values(), [data.search.title, data.search.description, data.search.url]);
	for (const value of values()) assert.ok(html.includes(escapeMarkup(value)), "complete escaped saved value");
	assert.deepEqual(nodes.filter((node) => node.tag === "dt").map((node) => node.props.children), ["Title suggestion", "Meta description", "Preview URL"]);
	assert.equal(nodes.filter((node) => node.tag === "dl").length, 1);
	assert.equal(classNodes("shipit-seo-saved-metadata__row").length, 3);
	for (const value of values()) assert.match(html, new RegExp([...value].length + " characters"));
	assert.match(html, /Source: EmDash SEO/); assert.match(html, /Source: Metadata template/); assert.match(html, /Source: Entry content/);
	assert.match(html, /<h3>Saved metadata<\/h3>/); assert.match(html, />Saved values<\/span>/);
	assert.match(html, /Read-only\. Save edits in the owning field or template, then analyze saved content again/);
	assert.doesNotMatch(html, /checked-entry-slug|data-review-field/);
	assert.deepEqual(data, before);
});
check("checklist focus marks only the requested review row and its parent", () => {
	for (const field of ["title", "description", "slug"] as const) {
		const html = render(preview(), field);
		const marked = nodes.filter((node) => node.props["data-review-field"] !== undefined);
		assert.equal(marked.length, 2); assert.ok(marked.every((node) => node.props["data-review-field"] === field));
		const row = classNodes("shipit-seo-saved-metadata__row--review");
		assert.equal(row.length, 1); assert.equal(row[0].props["data-review-field"], field);
		assert.match(html, new RegExp("Review saved " + (field === "title" ? "title suggestion" : field === "description" ? "meta description" : "URL and slug")));
	}
	render(); assert.equal(classNodes("shipit-seo-saved-metadata__row--review").length, 0);
});
check("all reported source variants remain visible and preserve their owning-editor limits", () => {
	for (const owner of ["core-seo", "template", "legacy-override", "content", "generated", "site-default", "plugin-social-override"] as SeoAdminMetadataSource[]) {
		const data = preview(); data.sources.title = owner; data.sources.description = owner; data.sources.canonical = owner;
		for (const field of ["title", "description"] as const) {
			const html = render(data, field);
			assert.equal(html.split("Source: " + SEO_OWNERSHIP_SOURCE_LABELS[owner]).length - 1, 3);
			if (owner === "core-seo") assert.match(html, /under Settings &gt; SEO, where enabled for this content type/);
			else if (owner === "template") {
				assert.match(html, /Review Acme SEO &gt; Templates/); assert.match(html, /other entries of this type/);
				assert.match(html, /entry override under Settings &gt; SEO, where enabled/);
			} else if (owner === "legacy-override") assert.match(html, /saved SEO ownership for this entry and Acme SEO &gt; Settings &gt; Migration/);
			else if (owner === "content" || owner === "generated") assert.match(html, field === "title" ? /Title or configured title field/ : /Excerpt, Summary or Description.*body/);
			else assert.match(html, /reported metadata source and its site defaults/);
			if (field === "title") assert.match(html, /site template controls the served page title/);
		}
	}
});
check("folded guidance distinguishes the resolved preview URL from checked slug and canonical edits", () => {
	const html = render(preview(), "slug");
	assert.match(html, /resolved URL when the slug is blank.*canonical/);
	assert.match(html, /card URL may differ from the checked slug/);
	assert.match(html, /Settings &gt; URL &amp; language/); assert.match(html, /custom public route.*route configuration change/);
	assert.doesNotMatch(html, /checked-entry-slug|<dt>Canonical|<dt>Slug/);
	const details = nodes.filter((node) => node.tag === "details");
	assert.equal(details.length, 1); assert.equal(details[0].props.open, undefined);
	assert.match(html, /<summary>Where to edit<\/summary>/);
	assert.match(render(), /site template controls the served page title/);
});
check("failed refresh retains full last-loaded values with explicit qualification", () => {
	const data = preview(); const html = render(data, "description", true);
	assert.deepEqual(values(), [data.search.title, data.search.description, data.search.url]);
	assert.match(html, />Last loaded<\/span>/); assert.match(html, /These are the last loaded values/);
	assert.doesNotMatch(html, /This preview shows the resolved saved values|>Saved values<\/span>/);
});
check("display counts use Unicode code points rather than the API's UTF-16 lengths", () => {
	const data = preview(); data.search.title = "A\u{1F600}e\u0301"; data.search.description = "\u{1F680}".repeat(170);
	data.search.titleLength = data.search.title.length; data.search.descriptionLength = data.search.description.length;
	assert.equal(data.search.titleLength, 5); assert.equal(data.search.descriptionLength, 340);
	const html = render(data); assert.deepEqual(values().slice(0, 2), [data.search.title, data.search.description]);
	assert.match(html, />4 characters<\/span>/); assert.match(html, />170 characters<\/span>/);
	assert.doesNotMatch(html, />5 characters<\/span>|>340 characters<\/span>/);
});
check("RTL and mixed-direction saved values keep their text and resolve their own direction", () => {
	const data = preview();
	data.search.title = "دليل زراعة الأسنان 2026: Dental implants guide";
	data.search.description = "‏תיאור מלא בעברית עם English words באמצע ומספר 160.";
	data.search.url = "https://example.invalid/ar/زراعة-الأسنان?q=שלום";
	const before = structuredClone(data); const html = render(data);
	assert.deepEqual(values(), [data.search.title, data.search.description, data.search.url]);
	const valueNodes = classNodes("shipit-seo-saved-metadata__value");
	assert.equal(valueNodes.length, 3); assert.ok(valueNodes.every((node) => node.props.dir === "auto"));
	for (const value of values()) assert.ok(html.includes(`<dd class="shipit-seo-saved-metadata__value" dir="auto">${escapeMarkup(value)}</dd>`));
	assert.equal(html.split('dir="auto"').length - 1, 3, "only the three saved values resolve their own direction");
	assert.ok(classNodes("shipit-seo-saved-metadata__meta").every((node) => node.props.dir === undefined));
	assert.deepEqual(data, before);
});
check("saved text is escaped and empty values retain honest zero counts without editable controls", () => {
	const data = preview(); data.search.title = '<script>alert("title")</script>'; data.search.description = "";
	data.search.url = 'https://example.invalid/<img>?quote="&other=1';
	const html = render(data);
	for (const value of values()) assert.ok(html.includes(escapeMarkup(value)));
	assert.match(html, />0 characters<\/span>/);
	assert.doesNotMatch(html, /<(?:script|img|input|textarea|select|button|a)\b|contenteditable=|role="textbox"/i);
	for (const node of nodes) assert.ok(Object.keys(node.props).every((key) => !/^on[A-Z]/.test(key)), "read-only markup adds no callbacks");
});
console.log(`Saved metadata review selfcheck passed (${cases} cases).`);
