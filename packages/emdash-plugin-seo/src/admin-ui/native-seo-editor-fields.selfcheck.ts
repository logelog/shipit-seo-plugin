import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_OUTPUT_SUPPORT,
	SEO_ENGINE_VERSION,
	type SeoAdminEntryPreview,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as stateModel from "./native-seo-editor-state.ts";
import { selectedLocalMediaUrl } from "./local-media.ts";
import * as imageFallback from "./native-seo-image-fallback.ts";
import * as snippetFit from "../snippet-fit.ts";
import { analyzeSeoContent, type SeoAnalysisInput } from "../analysis.ts";
import type {
	NativeSeoEditorController,
	NativeSeoImageFieldProps,
	NativeSeoTextFields,
} from "./native-seo-editor-fields.tsx";

type TextProps = Parameters<typeof NativeSeoTextFields>[0];
type Node = { tag: string; props: Record<string, any> };
let nodes: Node[] = [];
let picker: Record<string, any> | null = null;
// The host picker and styled button are leaf boundaries, not substitutes for the editor policy.
function HostButton({ variant: _variant, children, ...props }: Record<string, any>) {
	return React.createElement("button", props, children);
}
function HostPicker(props: Record<string, any>) { picker = props; return null; }
const observedJsx = Object.fromEntries(Object.entries(jsx).map(([name, value]) => [name,
	name === "jsx" || name === "jsxs" ? (...args: Parameters<typeof jsx.jsx>) => {
		const tag = typeof args[0] === "string" ? args[0] : args[0] === HostButton ? "button" : null;
		if (tag) nodes.push({ tag, props: args[1] as Record<string, any> });
		return (value as typeof jsx.jsx)(...args);
	} : value,
]));
const source = readFileSync(new URL("./native-seo-editor-fields.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
	fileName: "native-seo-editor-fields.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} as {
	NativeSeoTextFields: React.ComponentType<TextProps>;
	NativeSeoImageField: React.ComponentType<NativeSeoImageFieldProps>;
	NativeSeoSaveStatus: React.ComponentType<{ controller: NativeSeoEditorController; publicationStatus?: string | null }>;
	NativeSeoRecoveryActions: React.ComponentType<{ controller: NativeSeoEditorController }>;
	NativeSeoSaveButton: React.ComponentType<{ controller: NativeSeoEditorController; primary: boolean }>;
	nativeSeoSaveOutstanding: (controller: NativeSeoEditorController) => boolean;
	nativeSeoHasChanges: (controller: NativeSeoEditorController) => boolean;
	nativeSeoSaveScope: (publicationStatus: string | null | undefined) => string;
	nativeSeoCharacterCount: (value: string, limit: number) => string;
} };
new Function("require", "module", "exports", compiled.outputText)((name: string) => {
	if (name === "react") return React;
	if (name === "react/jsx-runtime") return observedJsx;
	if (name === "@cloudflare/kumo/components/button") return { Button: HostButton };
	if (name === "@emdash-cms/admin") return { MediaPickerModal: HostPicker };
	if (name === "@phosphor-icons/react") return icons;
	if (name === "./native-seo-editor-state.ts") return stateModel;
	if (name === "../snippet-fit.ts") return snippetFit;
	if (name === "./native-seo-image-fallback.ts") return imageFallback;
	assert.equal(name, "./local-media.ts", "the fields have no fetching or shared-store runtime dependency");
	return { selectedLocalMediaUrl };
}, output, output.exports);
const {
	NativeSeoTextFields: ActualText, NativeSeoImageField: ActualImage, NativeSeoSaveStatus: ActualStatus,
	NativeSeoRecoveryActions: ActualRecovery, NativeSeoSaveButton: ActualSave, nativeSeoSaveOutstanding, nativeSeoHasChanges,
	nativeSeoSaveScope, nativeSeoCharacterCount,
} = output.exports;
const target: stateModel.NativeSeoTarget = {
	principal: { id: "fixture-editor", role: 40 }, collection: "posts", entryId: "fixture-entry", locale: "en",
};
const stored: stateModel.NativeSeoValues = {
	title: "Native saved title", description: "Native saved description", image: "/_emdash/api/media/file/saved.jpg",
};
function snapshot(revision = "opaque-a", values = stored): stateModel.NativeSeoSnapshot {
	return { target, revision, values };
}
function initial(values = stored) { return stateModel.createNativeSeoEditorState(target, snapshot("opaque-a", values)); }
const preview: SeoAdminEntryPreview = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, generatedAt: "2026-10-17T12:00:00.000Z",
	content: { ref: "posts:fixture-entry", entryId: "fixture-entry", collection: "posts", collectionLabel: "Posts", title: "Content title", slug: "fixture" },
	search: { title: "Resolved effective title", description: "Resolved effective description",
		fallbackTitle: "Inherited title template", fallbackDescription: "Inherited description template",
		url: "https://example.invalid/fixture", titleLength: 24, descriptionLength: 30 },
	social: { editing: { state: "ready", snapshot: { ref: "posts:fixture-entry", revision: null, override: null } },
		title: "Social title", description: "Social description", image: "https://example.invalid/last-loaded.jpg",
		fallbackTitle: "Social fallback title", fallbackDescription: "Social fallback description",
		override: { title: null, description: null, updatedAt: null } },
	indexable: true, entryNoindex: false,
	canonicalValidation: { status: "matches", canonical: "https://example.invalid/fixture", expectedPath: "/fixture" },
	localeGraph: { owner: "emdash-core", emitsMarkup: false, status: "single-locale", hostSupportsTranslationGroups: true,
		currentLocale: "en", defaultLocale: "en", translationGroup: null, discoveredLocales: ["en"], alternates: [], xDefaultLocale: null, issues: [] },
	schemaTypes: [], outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
	sources: { title: "core-seo", description: "core-seo", canonical: "generated", socialTitle: "content", socialDescription: "content", image: "core-seo" },
};
type Calls = { changes: stateModel.NativeSeoDraft[]; saves: number; reads: number; reviews: boolean[]; discards: number; pickerOpen: boolean[]; errors: (string | null)[] };
function controller(state: stateModel.NativeSeoEditorState | null = initial(), allowedFields: readonly stateModel.NativeSeoField[] = ["title", "description", "image"]) {
	const calls: Calls = { changes: [], saves: 0, reads: 0, reviews: [], discards: 0, pickerOpen: [], errors: [] };
	const value: NativeSeoEditorController = {
		state, allowedFields, loading: false, unavailable: false,
		change: (patch) => calls.changes.push(patch),
		save: () => { calls.saves += 1; },
		read: () => { calls.reads += 1; },
		review: (keep) => calls.reviews.push(keep),
		discard: () => { calls.discards += 1; },
	};
	return { value, calls };
}
function render(value: NativeSeoEditorController, calls: Calls,
	options: { pickerOpen?: boolean; pickerError?: string | null; preview?: SeoAdminEntryPreview; datePrefix?: string; publicationStatus?: string | null;
		legacyGuidance?: string } = {}) {
	nodes = []; picker = null;
	const before = JSON.stringify(value.state);
	const shown = options.preview ?? preview;
	const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
		React.createElement(ActualText, { controller: value, preview: shown, datePrefix: options.datePrefix, legacyGuidance: options.legacyGuidance }),
		React.createElement(ActualImage, { controller: value, preview: shown, legacyGuidance: options.legacyGuidance, pickerOpen: options.pickerOpen ?? false,
			onPickerOpenChange: (open) => calls.pickerOpen.push(open), pickerError: options.pickerError,
			onPickerError: (error) => calls.errors.push(error) }),
		React.createElement(ActualStatus, { controller: value, publicationStatus: options.publicationStatus }),
		React.createElement(ActualRecovery, { controller: value }),
		React.createElement(ActualSave, { controller: value, primary: nativeSeoHasChanges(value) })));
	assert.equal(JSON.stringify(value.state), before, "rendering preserves the saved baseline, attempt and draft");
	assert.doesNotMatch(html, /<form\b|<img\b|\bhref=/, "rendering fields neither nests a form nor loads a media URL");
	for (const node of nodes.filter((item) => item.tag === "button")) assert.equal(node.props.type, "button");
	return html;
}
function input(field: "title" | "description") {
	const node = nodes.find((item) => (item.tag === "input" || item.tag === "textarea") && item.props.id.endsWith("-" + field));
	assert.ok(node); return node;
}
function label(node: Node): string {
	return React.Children.toArray(node.props.children).filter((child) => typeof child === "string").join("");
}
function button(name: string) {
	const node = nodes.find((item) => item.tag === "button" && label(item) === name);
	assert.ok(node, "button: " + name); return node;
}
function hasButton(name: string) { return nodes.some((item) => item.tag === "button" && label(item) === name); }
function fitText(field: "title" | "description"): string | null {
	const describedBy = String(input(field).props["aria-describedby"]).split(" ");
	const id = describedBy.find((item) => item.endsWith("-fit"));
	if (!id) return null;
	const node = nodes.find((item) => item.tag === "span" && item.props.id === id);
	assert.ok(node, "fit text for " + field);
	return String(node.props.children);
}
function currentPicker(): Record<string, any> { assert.ok(picker); return picker; }
let cases = 0;
function check(_name: string, run: () => void) { run(); cases += 1; }

check("initial loading and unavailable fields fail closed without resolved values becoming editable", () => {
	for (const loading of [true, false]) {
		const { value, calls } = controller(null); value.loading = loading; value.unavailable = !loading;
		const html = render(value, calls, { pickerOpen: true });
		assert.ok(html.includes(loading ? "Loading SEO fields..." : "SEO fields are unavailable."));
		for (const field of ["title", "description"] as const) {
			assert.equal(input(field).props.disabled, true);
			assert.equal(input(field).props.value, "");
			assert.equal(input(field).props.placeholder, "");
			input(field).props.onChange({ target: { value: "Must not edit" } });
		}
		assert.equal(currentPicker().open, false);
		for (const name of ["Check saved SEO fields", "Choose image"]) assert.equal(button(name).props.disabled, true);
		assert.equal(hasButton("Save SEO fields"), false, "without a change there is nothing to save");
		assert.equal(fitText("title"), null, "an unavailable field has no estimate");
		assert.deepEqual(calls.changes, []); assert.equal(calls.saves, 0); assert.equal(calls.reads, 0);
	}
});

check("native values and inherited placeholders remain separate with truthful input limits", () => {
	const { value, calls } = controller();
	render(value, calls);
	assert.equal(input("title").props.value, stored.title);
	assert.equal(input("description").props.value, stored.description);
	assert.equal(input("title").props.placeholder, preview.search.fallbackTitle);
	assert.equal(input("description").props.placeholder, preview.search.fallbackDescription);
	assert.equal(input("title").props.maxLength, 200);
	let enterPrevented = 0;
	input("title").props.onKeyDown({ key: "Enter", preventDefault: () => { enterPrevented += 1; } });
	assert.equal(enterPrevented, 1, "Enter in SEO title must not submit the parent content form");
	input("description").props.onKeyDown({ key: "Enter", preventDefault: () => { enterPrevented += 1; } });
	assert.equal(enterPrevented, 1, "description retains normal multiline editing");
	assert.equal(input("description").props.maxLength, 500);
	assert.equal(input("title").props.disabled, false);
	assert.equal(hasButton("Save SEO fields"), false, "unchanged native values offer no save");
	input("title").props.onChange({ target: { value: "" } });
	assert.deepEqual(calls.changes, [{ title: "" }], "blank input is preserved as the native inheritance request");
	const blank = controller(initial({ title: null, description: null, image: null }));
	render(blank.value, blank.calls);
	assert.equal(input("title").props.value, "");
	assert.equal(input("title").props.placeholder, preview.search.fallbackTitle);
	nodes = [];
	renderToStaticMarkup(React.createElement(ActualText, { controller: blank.value, preview: { ...preview, search: { ...preview.search, fallbackTitle: undefined, fallbackDescription: undefined } } }));
	assert.equal(input("title").props.placeholder, "", "an unavailable inheritance value is not invented from the current override");
	assert.equal(input("description").props.placeholder, "");
	const unicode = controller(stateModel.updateNativeSeoDraft(initial(), { title: "😀e\u0301" }));
	const unicodeHtml = render(unicode.value, unicode.calls);
	assert.match(unicodeHtml, /-title-limit">3 characters<\/span>/, "the counter names no limit far below it");
	assert.doesNotMatch(unicodeHtml, /input limit 200/);
	assert.deepEqual(unicode.calls.changes, []);
	for (const [field, count, expected] of [
		["title", 179, "179 characters"], ["title", 180, "180 characters, input limit 200"],
		["description", 449, "449 characters"], ["description", 450, "450 characters, input limit 500"],
	] as const) {
		const near = controller(stateModel.updateNativeSeoDraft(initial(), { [field]: "a".repeat(count) }));
		assert.ok(render(near.value, near.calls).includes(`-${field}-limit">${expected}</span>`), `${field} ${count}`);
	}
});

check("ownership defaults closed and a later ownership loss cannot submit an old draft", () => {
	const ready = controller(); delete ready.value.allowedFields;
	const html = render(ready.value, ready.calls);
	assert.match(html, /Edit this field in its current owner/);
	assert.equal(input("title").props.value, stored.title, "a disabled native value is not replaced by a legacy effective value");
	assert.equal(input("title").props.placeholder, "");
	assert.equal(input("description").props.disabled, true);
	input("title").props.onChange({ target: { value: "No authority" } });
	button("Replace image").props.onClick();
	currentPicker().onSelect({ url: "/_emdash/api/media/file/not-owned.jpg" });
	assert.deepEqual(ready.calls.changes, []);
	const dirty = controller(stateModel.updateNativeSeoDraft(initial(), { title: "Preserved local title" }), ["description"]);
	render(dirty.value, dirty.calls);
	assert.equal(button("Save SEO fields").props.disabled, true);
	assert.equal(fitText("title"), null, "a field owned elsewhere has no estimate of its unused native value");
	button("Save SEO fields").props.onClick();
	assert.equal(dirty.calls.saves, 0);
	assert.equal(input("title").props.value, "Preserved local title");
});

check("a field a current legacy record decides names where to review it; other read-only fields keep the generic hint", () => {
	const guidance = "Review saved SEO ownership for this entry and Acme SEO > Settings > Migration before replacing this value.";
	const held = { ...preview, ownership: { status: "current", locale: "en",
		fields: [{ field: "title", state: "conflict" }, { field: "description", state: "unknown" }, { field: "image", state: "equal" }] } } as unknown as SeoAdminEntryPreview;
	const { value, calls } = controller(initial(), []);
	const html = render(value, calls, { preview: held, legacyGuidance: guidance });
	assert.equal(html.split("Acme SEO &gt; Settings &gt; Migration").length - 1, 2, "title and image, which a legacy record decides");
	assert.match(html, /Edit this field in its current owner/, "the description's owner is unknown, so no page is named");
	const stale = { ...held, ownership: { ...held.ownership!, status: "stale" } } as SeoAdminEntryPreview;
	assert.doesNotMatch(render(value, calls, { preview: stale, legacyGuidance: guidance }), /Settings &gt; Migration/, "stale facts name no page");
	assert.doesNotMatch(render(value, calls, { preview: held }), /Settings &gt; Migration/, "without the guidance the generic hint stays");
});

check("Save SEO fields is an explicit native action and sends no implicit Social or content operation", () => {
	const state = stateModel.updateNativeSeoDraft(initial(), { title: "  ", description: "New description" });
	const { value, calls } = controller(state);
	const html = render(value, calls);
	assert.match(html, /role="status" tabindex="-1" data-native-seo-status="true">Unsaved SEO changes\.</,
		"the status takes focus when a focused save control disables or unmounts");
	assert.ok(html.includes(`<p class="shipit-seo-native-save__scope">${nativeSeoSaveScope(undefined)}</p>`), "one scope line by the native save");
	assert.equal(nativeSeoSaveScope(undefined), "Saves SEO fields now. Save other changes first so EmDash does not ask you to confirm them.");
	assert.match(render(value, calls, { publicationStatus: "published" }), /Updates the live page now, even while other changes are still a draft\./,
		"a published entry names the immediate effect on the live page");
	for (const status of ["draft", "scheduled"]) assert.match(render(value, calls, { publicationStatus: status }),
		/Saves now with this unpublished entry\. Visitors see these fields once it is published\./, status);
	assert.doesNotMatch(html, /Save other post changes before saving/, "no claim about other unsaved changes the host does not expose");
	assert.match(html, /Changed: SEO title, Meta description</, "the save names every field it sends");
	assert.equal(calls.saves, 0); assert.equal(calls.reads, 0);
	assert.equal(button("Save SEO fields").props.disabled, false);
	assert.equal(button("Save SEO fields").props.variant, "primary", "changed native fields make their save the primary action");
	assert.equal(button("Check saved SEO fields").props.variant, "secondary");
	button("Save SEO fields").props.onClick();
	assert.equal(calls.saves, 1); assert.equal(calls.reads, 0); assert.equal(calls.discards, 0);
	const started = stateModel.beginNativeSeoSave(state);
	assert.ok(started.attempt);
	assert.deepEqual(stateModel.nativeSeoWriteInput(started.attempt), { seo: { title: null, description: "New description" }, _rev: "opaque-a" });
	button("Discard SEO edits").props.onClick();
	assert.equal(calls.discards, 1);
	nodes = [];
	renderToStaticMarkup(React.createElement(ActualSave, { controller: value, primary: false }));
	assert.equal(button("Save SEO fields").props.variant, "secondary", "the footer decides which save is primary");
});

check("the public local image picker chooses or clears only the native image override", () => {
	const { value, calls } = controller();
	render(value, calls, { pickerOpen: true });
	assert.equal(currentPicker().open, true);
	assert.equal(currentPicker().localOnly, true);
	assert.equal(currentPicker().mediaKind, "image");
	currentPicker().onSelect({ url: "/_emdash/api/media/file/chosen.jpg" });
	assert.deepEqual(calls.changes, [{ image: "/_emdash/api/media/file/chosen.jpg" }]);
	assert.deepEqual(calls.pickerOpen, [false]);
	assert.equal(calls.saves, 0);
	button("Clear custom image").props.onClick();
	assert.deepEqual(calls.changes.at(-1), { image: null });
	assert.equal(calls.saves, 0);
	const cleared = controller(stateModel.updateNativeSeoDraft(initial(), { image: null }));
	const html = render(cleared.value, cleared.calls);
	assert.match(html, /Custom image cleared\. The inherited image shows after saving\./);
	assert.match(html, /Changed: Sharing image</);
	assert.doesNotMatch(html, /last-loaded.jpg|featured image|Saved custom image/);
	assert.deepEqual(cleared.calls.changes, []);
	const withFeatured = { ...preview, social: { ...preview.social, fallbackImage: { value: "/_emdash/api/media/file/featured.jpg", source: "content" as const } } };
	assert.match(render(cleared.value, cleared.calls, { preview: withFeatured }), /Custom image cleared\. After saving, sharing uses the featured image\./);
	const withoutFallback = { ...preview, social: { ...preview.social, fallbackImage: { value: null, source: "site-default" as const } } };
	assert.match(render(cleared.value, cleared.calls, { preview: withoutFallback }), /Custom image cleared\. After saving, no sharing image is set\./);
	const inheriting = controller(initial({ ...stored, image: null }));
	for (const [source, text] of [["content", "No custom image. Sharing uses the featured image."],
		["site-default", "No custom image. Sharing uses the site sharing image."]] as const) {
		const inherited = render(inheriting.value, inheriting.calls, { preview: { ...preview, sources: { ...preview.sources, image: source } } });
		assert.ok(inherited.includes(text), source);
		assert.doesNotMatch(inherited, /last-loaded/, "no developer wording for the inherited image");
	}
});

check("unsafe or oversized picker results do not become image drafts", () => {
	for (const url of ["https://elsewhere.invalid/_emdash/api/media/file/image.jpg", "javascript:alert(1)",
		"/_emdash/api/media/file/image.jpg?external=1", "/_emdash/api/media/file/" + "x".repeat(4_096)]) {
		const { value, calls } = controller();
		render(value, calls, { pickerOpen: true });
		currentPicker().onSelect({ url });
		assert.deepEqual(calls.changes, []);
		assert.ok(calls.errors.at(-1)?.includes("Choose another image"));
		assert.deepEqual(calls.pickerOpen, [false]);
	}
});

check("unknown saves retain the exact draft, disable retry/discard and offer a read only recovery", () => {
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { title: "Attempted title" }));
	assert.ok(begun.attempt);
	const unknown = stateModel.nativeSeoEditorReducer(begun.state, { type: "write-unknown", attempt: begun.attempt });
	const { value, calls } = controller(unknown);
	const html = render(value, calls);
	assert.match(html, /Save not confirmed\. Your edits are kept/);
	assert.equal(input("title").props.value, "Attempted title");
	assert.equal(button("Save SEO fields").props.disabled, true);
	assert.equal(button("Discard SEO edits").props.disabled, true);
	assert.equal(button("Check saved SEO fields").props.disabled, false);
	assert.match(html, /Changed: SEO title</, "the kept attempt still names its field");
	button("Save SEO fields").props.onClick(); button("Discard SEO edits").props.onClick(); button("Check saved SEO fields").props.onClick();
	assert.equal(calls.saves, 0); assert.equal(calls.discards, 0); assert.equal(calls.reads, 1);
	assert.doesNotMatch(html, /saved and checked|synchroniz|parent draft/i);
});

check("only an explicit conflict snapshot offers saved-value review without writing", () => {
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { title: "Keep this draft" }));
	assert.ok(begun.attempt);
	const failed = stateModel.nativeSeoEditorReducer(begun.state, { type: "write-result", attempt: begun.attempt, result: { outcome: "conflict" } });
	const reading = stateModel.beginNativeSeoReadback(failed);
	assert.ok(reading.request);
	const current = { ...stored, title: "Other saved title <escaped>" };
	const conflict = stateModel.nativeSeoEditorReducer(reading.state, { type: "readback-result", request: reading.request, snapshot: snapshot("opaque-b", current) });
	const { value, calls } = controller(conflict);
	const html = render(value, calls);
	assert.match(html, /Last checked saved values/);
	assert.match(html, /Other saved title &lt;escaped&gt;/);
	assert.equal(input("title").props.value, "Keep this draft", "review does not replace the local input");
	button("Keep my edits").props.onClick(); button("Use saved values").props.onClick();
	assert.deepEqual(calls.reviews, [true, false]); assert.equal(calls.saves, 0);
	// The footer stays short: the choices share the heading row and the scope note waits for an enabled Save.
	assert.match(html, /<div class="shipit-seo-native-save__review-head"><strong>Last checked saved values<\/strong><div class="shipit-seo-snippet-dialog__view-tools">[\s\S]*?Keep my edits[\s\S]*?Use saved values[\s\S]*?<\/div><\/div><dl>/);
	assert.doesNotMatch(html, /shipit-seo-native-save__scope/);
	assert.match(html, /Changed: SEO title/);
	const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");
	assert.match(css, /\[data-native-seo-save\] \.shipit-seo-native-save__review dl \{\n\tdisplay: grid;\n\tgrid-template-columns: max-content minmax\(0, 1fr\);/,
		"each saved value sits beside its name");
	assert.match(css, /\[data-native-seo-save\] \.shipit-seo-native-save__review \{\n\tgap: 6px;\n\tmargin-top: 0;\n\tpadding: 8px 10px;/);
	const hidden = controller({ ...conflict, phase: "unknown" });
	assert.doesNotMatch(render(hidden.value, hidden.calls), /Other saved title|Last checked saved values/);
});

check("pending reads and writes disable controls but never discard a draft or confirm the parent editor", () => {
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { image: null }));
	assert.ok(begun.attempt);
	const checking = stateModel.beginNativeSeoReadback(stateModel.nativeSeoEditorReducer(begun.state, { type: "write-unknown", attempt: begun.attempt }));
	for (const state of [begun.state, checking.state]) {
		const { value, calls } = controller(state);
		const html = render(value, calls, { pickerOpen: true });
		assert.equal(input("title").props.disabled, true);
		assert.equal(currentPicker().open, false);
		assert.equal(button("Save SEO fields").props.disabled, true);
		assert.equal(button("Check saved SEO fields").props.disabled, true);
		assert.doesNotMatch(html, /SEO values saved and checked/);
		assert.equal(calls.saves, 0); assert.equal(calls.reads, 0); assert.equal(calls.discards, 0);
	}
});

check("the fit estimate under each field matches the checklist's snippet fit and hides while inheriting", () => {
	const short = controller(stateModel.updateNativeSeoDraft(initial(), { title: "Dental implants explained", description: "A short description." }));
	render(short.value, short.calls);
	assert.equal(fitText("title"), "Fits phone and desktop (estimate)");
	assert.equal(fitText("description"), "Fits phone and desktop (estimate)");
	assert.match(String(input("title").props["aria-describedby"]), /-title-limit \S+-title-fit \S+-title-help$/);
	const longTitle = "A complete guide to choosing the right treatment plan for your whole family with dental implants";
	const long = controller(stateModel.updateNativeSeoDraft(initial(), { title: longTitle }));
	const html = render(long.value, long.calls);
	const fits = snippetFit.seoSnippetFit(longTitle, "title");
	const cut = fits.filter((fit) => fit.clipped);
	assert.ok(cut.length > 0, "control: the long title is cut on at least one device");
	assert.equal(fitText("title"), `May be cut on ${cut.map((fit) => `${fit.device === "mobile" ? "phone" : "desktop"} after "${snippetFit.seoSnippetCutPoint(fit.visible)}"`).join(" and ")} (estimate)`);
	const analysisInput: SeoAnalysisInput = { ref: "posts:fixture-entry", collection: "posts", entryId: "fixture-entry", slug: "fixture", title: longTitle,
		description: "A short description.", url: "https://example.invalid/fixture", noindex: false, publicationStatus: "published", body: "Body text.",
		assessmentProfile: { profile: "general", version: 1 }, schemaEnabled: false, schemaPreset: "Article" };
	const row = analyzeSeoContent(analysisInput).checks.find((check) => check.id === "title-display-length");
	assert.ok(row && row.status === "review");
	for (const fit of cut) assert.ok(row.detail.includes(`"${snippetFit.seoSnippetCutPoint(fit.visible)}"`), "the Title fit row names the same cut point");
	assert.match(html, /data-fit="cut"/);
	assert.doesNotMatch(html, /role="alert"[^>]*>[^<]*(?:cut|estimate)/i, "the estimate is never an error");
	const blank = controller(stateModel.updateNativeSeoDraft(initial(), { title: "   " }));
	render(blank.value, blank.calls);
	assert.equal(fitText("title"), null, "a blank field inherits and shows no estimate");
	assert.equal(input("title").props.placeholder, preview.search.fallbackTitle);
});

check("the footer controls stay on every tab only while native work is outstanding", () => {
	const clean = controller();
	assert.equal(nativeSeoSaveOutstanding(clean.value), false);
	assert.equal(nativeSeoHasChanges(clean.value), false);
	const changed = controller(stateModel.updateNativeSeoDraft(initial(), { image: null }));
	assert.equal(nativeSeoSaveOutstanding(changed.value), true);
	assert.equal(nativeSeoHasChanges(changed.value), true);
	const reverted = controller(stateModel.updateNativeSeoDraft(initial(), { title: stored.title }));
	assert.equal(nativeSeoHasChanges(reverted.value), false, "a draft equal to the saved value is not a change");
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { title: "Attempted title" }));
	assert.ok(begun.attempt);
	const unknown = controller(stateModel.nativeSeoEditorReducer(begun.state, { type: "write-unknown", attempt: begun.attempt }));
	assert.equal(nativeSeoSaveOutstanding(unknown.value), true, "an unconfirmed attempt keeps its recovery reachable");
	const unread = controller(stateModel.createNativeSeoEditorState(target, null));
	assert.equal(nativeSeoSaveOutstanding(unread.value), false, "an initial read is not native work to finish elsewhere");
	assert.equal(render(clean.value, clean.calls).includes("data-native-seo-save"), false, "a clean saved state needs no status");
});

check("the sharing image card gives landscape guidance with or without an image", () => {
	for (const values of [stored, { ...stored, image: null }]) {
		const { value, calls } = controller(initial(values));
		const html = render(value, calls);
		assert.match(html, /Use a landscape image, for example 1200 x 630 px\./);
		assert.equal(hasButton(values.image ? "Replace image" : "Choose image"), true);
	}
});

check("a check that finds the saved fields unchanged allows a fresh save and Discard without retrying", () => {
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { title: "Attempted title" }));
	assert.ok(begun.attempt);
	const lost = stateModel.nativeSeoEditorReducer(begun.state, { type: "write-unknown", attempt: begun.attempt });
	const reading = stateModel.beginNativeSeoReadback(lost);
	assert.ok(reading.request);
	const unchanged = stateModel.nativeSeoEditorReducer(reading.state, { type: "readback-result", request: reading.request, snapshot: snapshot() });
	const { value, calls } = controller(unchanged);
	const html = render(value, calls);
	assert.match(html, /The saved SEO fields are unchanged, so the save did not complete\. Your edits are kept; save again when ready\./);
	assert.equal(input("title").props.value, "Attempted title");
	assert.equal(input("title").props.disabled, false, "the kept draft stays editable");
	assert.equal(button("Save SEO fields").props.disabled, false);
	assert.equal(button("Discard SEO edits").props.disabled, false);
	assert.equal(calls.saves, 0, "nothing retries on its own");
	button("Save SEO fields").props.onClick(); button("Discard SEO edits").props.onClick();
	assert.equal(calls.saves, 1); assert.equal(calls.discards, 1);
});

check("adopted saved values wait for a matching preview with disabled, labelled fields", () => {
	const { value, calls } = controller(stateModel.updateNativeSeoDraft(initial(), { description: "Kept draft" }), []);
	value.previewUpdating = true;
	const html = render(value, calls);
	assert.equal(input("description").props.disabled, true);
	assert.equal(input("description").props.value, "Kept draft", "the draft stays shown while the preview refreshes");
	assert.match(html, /Updating the preview to the saved values\.\.\. Your edits are kept\./);
	assert.doesNotMatch(html, /Edit this field in its current owner/, "a refresh is not presented as another owner");
	assert.equal(button("Save SEO fields").props.disabled, true);
	button("Save SEO fields").props.onClick();
	assert.equal(calls.saves, 0);
	const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");
	assert.match(css, /\.shipit-seo-native-social__fields input:disabled,\n\.shipit-seo-native-social__fields textarea:disabled \{[^}]*cursor: not-allowed;/,
		"a disabled field looks disabled");
});

check("the updating note matches the outcome: kept edits, adopted saved values or a confirmed save", () => {
	const adopted = controller(initial(), []);
	adopted.value.previewUpdating = true;
	const adoptedHtml = render(adopted.value, adopted.calls);
	assert.match(adoptedHtml, /Updating the preview to the saved values\.\.\./);
	assert.doesNotMatch(adoptedHtml, /Your edits are kept/, "Use saved values leaves no edits to keep");
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { title: "Saved here" }));
	assert.ok(begun.attempt);
	const written = stateModel.nativeSeoEditorReducer(begun.state, { type: "write-result", attempt: begun.attempt,
		result: { outcome: "acknowledged", snapshot: snapshot("opaque-b", { ...stored, title: "Saved here" }) } });
	const reading = stateModel.beginNativeSeoReadback(written);
	assert.ok(reading.request);
	const confirmed = stateModel.nativeSeoEditorReducer(reading.state, { type: "readback-result", request: reading.request,
		snapshot: snapshot("opaque-b", { ...stored, title: "Saved here" }) });
	assert.equal(confirmed.phase, "confirmed");
	const own = controller(confirmed, []);
	own.value.previewUpdating = true;
	const ownHtml = render(own.value, own.calls);
	assert.match(ownHtml, /SEO values saved and checked\. Updating the preview to the saved values\.\.\./);
	assert.doesNotMatch(ownHtml, /Your edits are kept/, "a confirmed save has no unsaved edits");
});

check("the conflict review names images in words instead of media paths", () => {
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { title: "Keep this draft" }));
	assert.ok(begun.attempt);
	const failed = stateModel.nativeSeoEditorReducer(begun.state, { type: "write-result", attempt: begun.attempt, result: { outcome: "conflict" } });
	for (const [image, text] of [[stored.image, "Same custom image as before"], ["/_emdash/api/media/file/other.jpg", "A different custom image"], [null, "No custom image"]] as const) {
		const reading = stateModel.beginNativeSeoReadback(failed);
		assert.ok(reading.request);
		const conflict = stateModel.nativeSeoEditorReducer(reading.state, { type: "readback-result", request: reading.request,
			snapshot: snapshot("opaque-b", { ...stored, title: "Other title", image }) });
		const { value, calls } = controller(conflict);
		const html = render(value, calls);
		assert.ok(html.includes(`<dd dir="auto">${text}</dd>`), text);
		assert.doesNotMatch(html.slice(html.indexOf("Last checked saved values")), /\/_emdash\/api\/media/);
	}
	const reading = stateModel.beginNativeSeoReadback(failed);
	assert.ok(reading.request);
	const conflict = stateModel.nativeSeoEditorReducer(reading.state, { type: "readback-result", request: reading.request,
		snapshot: snapshot("opaque-b", { ...stored, title: "Other title" }) });
	const { value, calls } = controller(conflict, []);
	const html = render(value, calls);
	assert.equal(input("title").props.disabled, true);
	assert.match(html, /Choose Keep my edits or Use saved values to edit again\./, "read-only fields name the pending choice");
	assert.doesNotMatch(html, /Updating the preview|Edit this field in its current owner/);
});

check("an open review shows the saved values under review in fields the draft does not hold", () => {
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { title: "Keep this draft" }));
	assert.ok(begun.attempt);
	const failed = stateModel.nativeSeoEditorReducer(begun.state, { type: "write-result", attempt: begun.attempt, result: { outcome: "conflict" } });
	const reading = stateModel.beginNativeSeoReadback(failed);
	assert.ok(reading.request);
	const reviewed = { ...stored, description: "Description saved in another tab", image: "/_emdash/api/media/file/other.jpg" };
	const conflict = stateModel.nativeSeoEditorReducer(reading.state, { type: "readback-result", request: reading.request,
		snapshot: snapshot("opaque-b", reviewed) });
	assert.equal(conflict.phase, "conflict");
	assert.equal(conflict.baseline?.values.description, stored.description, "control: the write guard still holds the older saved values");
	const { value, calls } = controller(conflict, []);
	const html = render(value, calls);
	assert.equal(input("title").props.value, "Keep this draft");
	assert.equal(input("description").props.value, reviewed.description, "a read-only field shows the saved value the review describes");
	assert.ok(html.includes(`-description-limit">${reviewed.description.length} characters</span>`));
	assert.ok(html.slice(0, html.indexOf("Last checked saved values")).includes(reviewed.image), "the image field describes the reviewed image");
	assert.equal(html.includes(stored.description!), false, "no field shows the older saved description beside the review");
	assert.equal(stateModel.canSaveNativeSeoValues(conflict), false, "the open review still blocks a save");
	const kept = stateModel.reviewNativeSeoSave(conflict, true);
	const after = controller(kept, []);
	render(after.value, after.calls);
	assert.equal(input("description").props.value, reviewed.description, "Keep my edits changes no shown value");
	assert.equal(input("title").props.value, "Keep this draft");
	const started = stateModel.beginNativeSeoSave(kept);
	assert.ok(started.attempt);
	assert.deepEqual(stateModel.nativeSeoWriteInput(started.attempt), { seo: { title: "Keep this draft" }, _rev: "opaque-b" });
	assert.deepEqual(calls.changes, []); assert.equal(calls.saves, 0);
});

check("an entry another editor holds keeps the draft without a review until an explicit save after taking over", () => {
	const begun = stateModel.beginNativeSeoSave(stateModel.updateNativeSeoDraft(initial(), { title: "Held entry title" }));
	assert.ok(begun.attempt);
	const locked = stateModel.nativeSeoEditorReducer(begun.state, { type: "write-result", attempt: begun.attempt, result: { outcome: "locked" } });
	const { value, calls } = controller(locked);
	const html = render(value, calls);
	assert.match(html, /data-native-seo-status="true">Another editor is holding this entry\. Take over in EmDash before saving\. Your edits are kept\.</);
	assert.doesNotMatch(html, /Saved SEO values changed|Last checked saved values|Keep my edits|save again when ready/, "a lock refusal is no value conflict");
	assert.equal(input("title").props.value, "Held entry title");
	assert.equal(input("title").props.disabled, false);
	assert.equal(button("Save SEO fields").props.disabled, false);
	assert.equal(button("Discard SEO edits").props.disabled, false);
	assert.equal(calls.saves, 0, "nothing retries on its own");
});

check("the description estimate measures the date the preview shows before it", () => {
	const prefix = snippetFit.seoSnippetDatePrefix("2026-10-18T09:00:00.000Z", "en");
	const words = "A spring garden checklist for a volunteer yard with soil, seed trays and watering rotas for every week".split(" ");
	let description = "";
	for (let index = 0; !snippetFit.seoSnippetFit(description, "description", prefix).some((fit) => fit.clipped); index += 1)
		description = [description, words[index % words.length]].filter(Boolean).join(" ");
	const { value, calls } = controller(stateModel.updateNativeSeoDraft(initial(), { description }));
	render(value, calls);
	assert.equal(fitText("description"), "Fits phone and desktop (estimate)", "control: without the date it fits");
	render(value, calls, { datePrefix: prefix });
	const cut = snippetFit.seoSnippetFit(description, "description", prefix).filter((fit) => fit.clipped);
	assert.equal(fitText("description"), `May be cut on ${cut.map((fit) => `${fit.device === "mobile" ? "phone" : "desktop"} after "${snippetFit.seoSnippetCutPoint(fit.visible)}"`).join(" and ")} (estimate)`);
});

check("native and Social counters share one format", () => {
	assert.equal(nativeSeoCharacterCount("Short", 300), "5 characters");
	assert.equal(nativeSeoCharacterCount("\u{1F600}".repeat(270), 300), "270 characters, input limit 300", "code points, with the limit named near it");
});

console.log(`Native SEO field render self-check passed (${cases} checks). Native host requests, picker interaction and browser geometry are not exercised.`);
