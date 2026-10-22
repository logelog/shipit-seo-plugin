import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { Children, createElement, Fragment, isValidElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as previewIcons from "@phosphor-icons/react";

import { createSerpPreviewModel, type SerpPreviewModel } from "./serp-preview-model.ts";
import { seoKeywordMatchRanges, seoKeywordOccurrenceCount } from "../keyword-match.ts";
import { buildSocialPreviewModel, type SocialPreviewFieldBasis, type SocialPreviewModel } from "./social-preview-model.ts";

const componentSource = readFileSync(new URL("./search-social-preview.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(componentSource, {
	fileName: "search-social-preview.tsx",
	reportDiagnostics: true,
	compilerOptions: {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.CommonJS,
		jsx: ts.JsxEmit.ReactJSX,
	},
});
assert.deepEqual(compiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error), []);
const componentModule = { exports: {} as {
	searchPreviewReflows: (cardWidth: number, available: number | null) => boolean;
	SearchPreview: (props: { model: SerpPreviewModel; presentation?: "native" | "result-page"; descriptionDisplay?: "compact" | "full" | "external"; lastLoaded?: boolean;
		updating?: boolean; containerWidth?: number;
		descriptionEmphasis?: ReadonlyArray<readonly [number, number]> }) => import("react").ReactElement;
	SocialPreview: (props: { model: SocialPreviewModel; loadImage?: boolean; presentation?: "native";
		fieldBasis?: Partial<Record<"title" | "description" | "image" | "url", SocialPreviewFieldBasis>>; caption?: string }) => import("react").ReactElement;
} };
const requirePreview = createRequire(import.meta.resolve("react"));
new Function("require", "module", "exports", compiled.outputText)(
	(name: string) => name === "@phosphor-icons/react" ? previewIcons : requirePreview(name),
	componentModule, componentModule.exports,
);
const { SearchPreview, SocialPreview, searchPreviewReflows } = componentModule.exports;

const field = (value: string | null, source: string, unavailable = false) => ({ value, source, unavailable });
const saved = {
	title: field('<script>alert("preview")</script> İstanbul résumé 👩🏽‍💻 العربية '.repeat(8), "Metadata template"),
	description: field("Een lange beschrijving. İstanbul için açıklama. العربية ".repeat(10), "Legacy description"),
	permalink: field("https://example.invalid/posts/original/", "Content permalink"),
	canonical: field("https://canonical.invalid/custom/path/?keep=a&site=b", "Explicit canonical"),
};
const desktop = createSerpPreviewModel({ device: "desktop", saved });
const mobile = createSerpPreviewModel({
	device: "mobile", saved, datePrefix: "3 October 2026 -",
	draft: { permalink: field("https://example.invalid/posts/draft/", "Draft permalink") },
});
const socialFields = {
	title: field("Independent sharing title İstanbul العربية ".repeat(8), "Saved social title"),
	description: field("Saved sharing description; preserved independently. ".repeat(12), "Saved social description"),
	image: field("https://media.invalid/new-image.png?crop=a&width=1200", "Media override"),
	url: field(saved.canonical.value, "Resolved social URL"),
};
const facebook = buildSocialPreviewModel({ platform: "facebook", saved: socialFields });
const missingImage = buildSocialPreviewModel({
	platform: "x", saved: socialFields,
	draft: { image: field(null, "Draft image cleared") },
});
const unknownImage = buildSocialPreviewModel({
	platform: "x", saved: socialFields,
	draft: { image: field("https://media.invalid/unknown.png", "Unreadable draft image", true) },
});

const escapedText = (value: string) => renderToStaticMarkup(createElement(Fragment, null, value));
function markup<M>(Component: ComponentType<{ model: M }>, model: M, width: number): string {
	return renderToStaticMarkup(createElement("div", { style: { width } }, createElement(Component, { model })));
}
function figure(html: string): string {
	const match = html.match(/<figure\b[\s\S]*?<\/figure>/);
	assert.ok(match);
	return match[0];
}
function previewMetadata(html: string): string {
	const match = html.match(/<aside\b[^>]*data-preview-metadata[^>]*>[\s\S]*?<\/aside>/);
	assert.ok(match, "Full metadata remains available outside the fitted card.");
	assert.match(match[0], /class="sr-only"/);
	assert.doesNotMatch(match[0], /\baria-hidden=|\bhidden(?:=|\s|>)/, "Metadata remains in the accessibility tree.");
	return match[0];
}
function visiblePreview(html: string): string {
	return html.replace(/<aside\b[^>]*data-preview-metadata[^>]*>[\s\S]*?<\/aside>/g, "");
}
function fittedLines(html: string, name: string): string[] {
	const pattern = new RegExp(`<div data-preview-line="${name}"[^>]*>(.*?)</div>`, "g");
	return Array.from(html.matchAll(pattern), (match) => match[1]);
}
function assertPreview<M extends { fittedTitle: { lines: string[] }; fittedDescription: { lines: string[] } }>(
	Component: ComponentType<{ model: M }>, model: M,
): string {
	const narrow = figure(markup(Component, model, 260));
	const wide = figure(markup(Component, model, 900));
	assert.equal(narrow, wide, "The same built model must render identical fitted text at both editor widths.");
	assert.deepEqual(fittedLines(narrow, "title"), model.fittedTitle.lines.map(escapedText));
	assert.deepEqual(fittedLines(narrow, "description"), model.fittedDescription.lines.map(escapedText));
	assert.match(narrow, /role="region"[^>]*tabindex="0"[^>]*overflow-x:auto/);
	assert.match(narrow, /<figcaption/);
	assert.match(narrow, /\(approximate\)/);
	assert.match(narrow, /white-space:nowrap/);
	assert.match(narrow, /dir="auto"/);
	assert.doesNotMatch(narrow, /<(?:img|script|iframe)\b|\bhref=|background-image:/i);
	return narrow;
}

const desktopHtml = assertPreview(SearchPreview, desktop);
const mobileHtml = assertPreview(SearchPreview, mobile);
assert.match(desktopHtml, /data-preview-width="538"/);
assert.match(mobileHtml, /data-preview-width="338"/);
assert.match(desktopHtml, /&lt;script&gt;/);
assert.doesNotMatch(desktopHtml, /About this preview|Title is shortened|Your theme controls|resolved title suggestion/);
assert.match(desktopHtml, /Metadata template/);
assert.match(desktopHtml, /Saved values/);
assert.match(mobileHtml, /Unsaved changes/);
assert.match(mobileHtml, /data-preview-state="draft">Draft/);
assert.ok(mobileHtml.includes(escapedText(saved.canonical.value!)), "The explicit canonical must remain visible.");
assert.ok(mobileHtml.includes("https://example.invalid/posts/draft/"), "The draft permalink must remain separate.");
assert.match(mobileHtml, /3 October 2026 -/);

const facebookHtml = assertPreview(SocialPreview, facebook);
const missingHtml = assertPreview(SocialPreview, missingImage);
const unavailableHtml = assertPreview(SocialPreview, unknownImage);
assert.match(facebookHtml, /data-preview-width="500"/);
assert.match(facebookHtml, /data-preview-image-state="available"/);
assert.match(facebookHtml, /Source specified; image not loaded/);
assert.ok(facebookHtml.includes(escapedText(socialFields.image.value!)));
assert.match(missingHtml, /data-preview-image-state="missing"/);
assert.match(missingHtml, /No image source/);
assert.match(missingHtml, /Draft image cleared/);
assert.match(unavailableHtml, /data-preview-image-state="unavailable"/);
assert.match(unavailableHtml, /Image unavailable; source could not be read/);
assert.match(unavailableHtml, /data-preview-state="unavailable">Unavailable/);
assert.doesNotMatch(unavailableHtml, /https:\/\/media.invalid\/unknown.png/);
assert.doesNotMatch(unavailableHtml, /Current X presentation is unverified|Approximate layout/);

const imageMarkup = (model: SocialPreviewModel, loadImage = true, width = 260) =>
	figure(renderToStaticMarkup(createElement("div", { style: { width } },
		createElement(SocialPreview, { model, loadImage }))));
assert.equal(imageMarkup(facebook, false), facebookHtml, "Explicit image opt-out must preserve the standalone rendering.");
const optInHtml = imageMarkup(facebook);
assert.equal(optInHtml, imageMarkup(facebook, true, 900), "Image presentation must preserve the same fixed card at both panel widths.");
assert.match(optInHtml, /data-preview-image-presentation="loading"/);
assert.match(optInHtml, /Loading image/);
assert.match(optInHtml, /<img[^>]*loading="lazy"/);
assert.ok(optInHtml.includes(`src="${escapedText(socialFields.image.value!)}"`), "Image opt-in must use the exact supplied URL.");
assert.match(optInHtml, /object-fit:cover;object-position:center/);
assert.ok(optInHtml.includes(`height:${facebook.profile.title.width / facebook.profile.imageAspectRatio}px`),
	"The image frame must retain its fixed profile geometry.");
assert.match(optInHtml, /data-preview-image-state="available"/);
assert.match(optInHtml, /Media override/);
assert.deepEqual(fittedLines(optInHtml, "title"), facebook.fittedTitle.lines.map(escapedText));
assert.deepEqual(fittedLines(optInHtml, "description"), facebook.fittedDescription.lines.map(escapedText));
for (const model of [missingImage, unknownImage]) {
	assert.doesNotMatch(imageMarkup(model), /<img\b/);
}
const changedImage = buildSocialPreviewModel({
	platform: "facebook", saved: socialFields,
	draft: { image: field("https://media.invalid/replacement.png?version=2&size=1200", "Draft replacement image") },
});
const changedImageHtml = imageMarkup(changedImage);
assert.match(changedImageHtml, /data-preview-image-presentation="loading"/);
assert.match(changedImageHtml, /Draft replacement image/);
assert.match(changedImageHtml, /data-preview-state="draft">Draft/);
assert.doesNotMatch(changedImageHtml, /new-image.png/);

type ImageInstance = {
	state: { status: "loading" | "loaded" | "failed" };
	setState(update: Partial<ImageInstance["state"]>): void;
	render(): import("react").ReactElement<{ children?: import("react").ReactNode }>;
};
type ImageElement = import("react").ReactElement<{ url: string }> & {
	type: new (props: { url: string }) => ImageInstance;
};
function imageChild(model: SocialPreviewModel, native = false): ImageElement {
	const visit = (node: import("react").ReactNode): ImageElement | null => {
		if (!isValidElement<{ url?: string; children?: import("react").ReactNode }>(node)) return null;
		if (node.props.url === model.fields.image.value && node.key !== null) return node as ImageElement;
		let found: ImageElement | null = null;
		Children.forEach(node.props.children, (child) => { found ??= visit(child); });
		return found;
	};
	const child = visit(SocialPreview({ model, loadImage: true, presentation: native ? "native" : undefined }));
	assert.ok(child, "Image load state must live in a child keyed by its exact URL.");
	return child;
}
const firstImageChild = imageChild(facebook);
const nextImageChild = imageChild(changedImage);
assert.equal(firstImageChild.key, socialFields.image.value);
assert.equal(nextImageChild.key, changedImage.fields.image.value);
assert.notEqual(firstImageChild.key, nextImageChild.key, "Changing the URL must remount the image state owner.");
const imageInstance = new firstImageChild.type(firstImageChild.props);
imageInstance.setState = (update) => { imageInstance.state = { ...imageInstance.state, ...update }; };
const imageEvents = Children.toArray(imageInstance.render().props.children).find((child) =>
	isValidElement(child) && child.type === "img") as import("react").ReactElement<{ onLoad(): void; onError(): void }>;
assert.ok(imageEvents);
imageEvents.props.onLoad();
assert.match(renderToStaticMarkup(imageInstance.render()), /data-preview-image-presentation="loaded"/);
assert.match(renderToStaticMarkup(imageInstance.render()), /Image loaded/);
assert.match(renderToStaticMarkup(imageInstance.render()), /object-fit:cover;object-position:center/);
assert.match(renderToStaticMarkup(imageInstance.render()), /background-color:var\(--shipit-seo-preview-background, Canvas\)/);
assert.match(renderToStaticMarkup(imageInstance.render()), /color:var\(--shipit-seo-preview-foreground, CanvasText\)/);
imageEvents.props.onError();
const failedImageHtml = renderToStaticMarkup(imageInstance.render());
assert.match(failedImageHtml, /data-preview-image-presentation="failed"/);
assert.match(failedImageHtml, /Image could not load/);
assert.doesNotMatch(failedImageHtml, /<img\b/);
const freshImageInstance = new nextImageChild.type(nextImageChild.props);
assert.equal(freshImageInstance.state.status, "loading", "A new source must not inherit an earlier image failure.");

const unavailableSearch = createSerpPreviewModel({
	device: "desktop", saved: { ...saved, title: field(saved.title.value, "Unreadable title", true),
		canonical: field(saved.canonical.value, "Unreadable canonical", true) },
});
const unavailableSearchHtml = figure(markup(SearchPreview, unavailableSearch, 260));
assert.match(unavailableSearchHtml, /Title unavailable/);
assert.match(unavailableSearchHtml, /URL unavailable/);
assert.match(unavailableSearchHtml, /Unreadable title/);
assert.equal(fittedLines(unavailableSearchHtml, "title").length, 0);
assert.doesNotMatch(unavailableSearchHtml, /https:\/\/canonical.invalid/);

function nativeMarkup<M>(Component: ComponentType<{ model: M; presentation?: "native" }>, model: M, width: number): string {
	return figure(renderToStaticMarkup(createElement("div", { style: { width } },
		createElement(Component, { model, presentation: "native" }))));
}
for (const model of [desktop, mobile]) {
	const native = nativeMarkup(SearchPreview, model, 260);
	assert.equal(native, nativeMarkup(SearchPreview, model, 900), "Native containers must not change the fitted model.");
	assert.deepEqual(fittedLines(native, "title"), [escapedText(model.fittedTitle.displayText)]);
	assert.deepEqual(fittedLines(native, "description"), [escapedText(model.fittedDescription.displayText)]);
	assert.match(native, /data-preview-fit="responsive"/);
	assert.doesNotMatch(native, /(?:^|[;" ])transform:|overflow-x:auto|white-space:nowrap|line-clamp/);
	assert.match(native, /width:100%;min-width:0;max-width:100%;box-sizing:border-box/);
	assert.match(native, /white-space:normal;overflow-wrap:anywhere/);
	for (const name of ["title", "description"] as const) {
		assert.match(native, new RegExp(`data-preview-line="${name}"[^>]*font-size:${model.profile[name].fontSize}px`));
	}
	assert.match(native, /padding:16px/);
	assert.ok(native.includes(escapedText(saved.canonical.value!)), "Native cards retain the exact canonical address.");
	const metadata = previewMetadata(native);
	assert.match(metadata, /Source information unavailable/);
	assert.doesNotMatch(metadata, /Metadata template|Legacy description|source:/);
	for (const value of [model.title.value, model.description.value, model.canonical.value, model.permalink.value]) {
		if (value) assert.ok(metadata.includes(escapedText(value)), "Complete original metadata remains accessible.");
	}
	assert.doesNotMatch(native, /<details\b|About this preview|Your theme sets|Title is shortened/);
	const caption = native.match(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/)?.[0];
	assert.ok(caption);
	assert.match(caption, /approximate/);
	assert.doesNotMatch(caption, /Your theme|source:|Google may/);
}
for (const model of [desktop, mobile]) {
	const snapshot = JSON.stringify(model);
	for (const width of [226, 260, 320, 390, 900]) {
		const html = nativeMarkup(SearchPreview, model, width);
		assert.match(html, /data-preview-fit="responsive"/);
		assert.doesNotMatch(html, /(?:^|[;" ])transform:|width:(?:538|338)px;min-width:|font-size:[0-9]px/);
		assert.deepEqual(fittedLines(html, "title"), [escapedText(model.fittedTitle.displayText)]);
		assert.deepEqual(fittedLines(html, "description"), [escapedText(model.fittedDescription.displayText)]);
		assert.ok(previewMetadata(html).includes(escapedText(model.description.value!)), "Full metadata remains accessible outside the fitted card.");
	}
	assert.equal(JSON.stringify(model), snapshot, "responsive rendering cannot refit or modify the model");
}
const nativeMissingUrl = createSerpPreviewModel({ device: "mobile", saved: {
	...saved, canonical: field("", "Generated canonical"),
} });
const nativeMissingUrlHtml = nativeMarkup(SearchPreview, nativeMissingUrl, 260);
assert.match(nativeMissingUrlHtml, /No public address/);
assert.match(nativeMissingUrlHtml, /No public address is available for this entry/);
assert.doesNotMatch(nativeMissingUrlHtml, /data-preview-address/);
const nativeUnavailableSearchHtml = nativeMarkup(SearchPreview, unavailableSearch, 260);
assert.match(nativeUnavailableSearchHtml, /Address unavailable/);
assert.match(nativeUnavailableSearchHtml, /The public address could not be read/);
assert.match(nativeUnavailableSearchHtml, /data-preview-state="unavailable">Could not be read/);
assert.doesNotMatch(nativeUnavailableSearchHtml, /https:\/\/canonical.invalid/);

const emptyDescription = createSerpPreviewModel({ device: "mobile", datePrefix: "3 October 2026 -", saved: {
	...saved, description: field("", "Empty saved description"),
} });
assert.ok(emptyDescription.fittedDescription.lines.some((line) => line.includes("3 October 2026")), "Control: the fitting model retains its supplied prefix.");
const nativeEmptyDescriptionHtml = nativeMarkup(SearchPreview, emptyDescription, 260);
assert.match(nativeEmptyDescriptionHtml, /No description/);
assert.doesNotMatch(nativeEmptyDescriptionHtml, /3 October 2026/);
assert.match(figure(markup(SearchPreview, emptyDescription, 260)), /3 October 2026/, "Standalone presentation remains unchanged.");

for (const model of [facebook, missingImage, unknownImage]) {
	const native = nativeMarkup(SocialPreview, model, 260);
	assert.equal(native, nativeMarkup(SocialPreview, model, 900));
	assert.deepEqual(fittedLines(native, "title"), model.fittedTitle.lines.map(escapedText));
	assert.deepEqual(fittedLines(native, "description"), model.fittedDescription.lines.map(escapedText));
	assert.match(native, /data-preview-fit="scaled"/);
	assert.match(native, /transform:scale\(1\);transform-origin:top left/);
	previewMetadata(native);
	assert.doesNotMatch(native, /<details\b|About this preview|Approximate layout|presentation is unverified/);
	assert.match(native, /data-preview-image-state=/);
	assert.doesNotMatch(native, /<img\b/);
}
const nativeImageHtml = figure(renderToStaticMarkup(createElement(SocialPreview, {
	model: changedImage, loadImage: true, presentation: "native",
})));
assert.match(nativeImageHtml, /data-preview-image-presentation="loading"/);
assert.match(nativeImageHtml, /object-fit:cover;object-position:center/);
assert.doesNotMatch(nativeImageHtml, /object-fit:contain/);
assert.ok(nativeImageHtml.includes(`src="${escapedText(changedImage.fields.image.value!)}"`));
assert.doesNotMatch(nativeImageHtml, /Draft replacement image/);
assert.match(nativeImageHtml, /data-preview-state="draft">Unsaved value. Source information unavailable/);
assert.deepEqual(fittedLines(nativeImageHtml, "title"), changedImage.fittedTitle.lines.map(escapedText));

const publicAddress = "https://example.invalid/posts/original/";
const nativeKnownSearch = createSerpPreviewModel({ device: "mobile", saved: {
	title: field("A saved title", "template"),
	description: field("A saved description", "content"),
	permalink: field(publicAddress, "generated"),
	canonical: field(publicAddress, "generated"),
} });
const nativeKnownSearchHtml = nativeMarkup(SearchPreview, nativeKnownSearch, 260);
assert.match(nativeKnownSearchHtml, /Saved value from your title template/);
assert.match(nativeKnownSearchHtml, /Saved value from your content/);
assert.match(nativeKnownSearchHtml, /Saved value from this entry&#x27;s public address/);
assert.doesNotMatch(nativeKnownSearchHtml, /source:|>template<|>generated<|<dt[^>]*>Canonical/);
assert.equal(visiblePreview(nativeKnownSearchHtml).split(escapedText(publicAddress)).length - 1, 1, "The same canonical and public address appear once in the card.");
assert.equal(previewMetadata(nativeKnownSearchHtml).split(escapedText(publicAddress)).length - 1, 1, "The full public address remains accessible.");

const nativePreferredUrl = createSerpPreviewModel({ device: "mobile", saved: {
	title: field("A saved title", "core-seo"),
	description: field("A saved description", "legacy-override"),
	permalink: field(publicAddress, "generated"),
	canonical: field(saved.canonical.value, "core-seo"),
} });
const nativePreferredUrlHtml = nativeMarkup(SearchPreview, nativePreferredUrl, 260);
assert.match(nativePreferredUrlHtml, /Preferred URL/);
assert.match(nativePreferredUrlHtml, /Page address/);
assert.match(nativePreferredUrlHtml, /Saved value from the title in this entry&#x27;s SEO settings/);
assert.match(nativePreferredUrlHtml, /Saved value from the preferred URL in this entry&#x27;s SEO settings/);
assert.match(nativePreferredUrlHtml, /Saved value from earlier SEO settings/);
assert.equal(visiblePreview(nativePreferredUrlHtml).split(escapedText(saved.canonical.value!)).length - 1, 1);
assert.equal(previewMetadata(nativePreferredUrlHtml).split(escapedText(saved.canonical.value!)).length - 1, 1);
assert.equal(nativePreferredUrlHtml.split(escapedText(publicAddress)).length - 1, 1);

const nativeDraftSocial = buildSocialPreviewModel({ platform: "facebook", saved: {
	title: field("Saved sharing title", "template"),
	description: field("Saved sharing description", "site-default"),
	image: field("https://media.invalid/default.png", "site-default"),
	url: field(publicAddress, "generated"),
}, draft: {
	title: field("Draft sharing title", "plugin-social-override"),
	description: field("Saved fallback description", "Saved social fallback (source not reported)"),
} });
const nativeDraftSocialHtml = nativeMarkup(SocialPreview, nativeDraftSocial, 260);
assert.match(nativeDraftSocialHtml, /data-preview-state="draft">Unsaved value from your sharing title/);
assert.match(nativeDraftSocialHtml, /data-preview-state="draft">Unsaved value. Source information unavailable/);
assert.match(nativeDraftSocialHtml, /data-preview-state="saved">Saved value from your site defaults/);
assert.match(nativeDraftSocialHtml, /Unsaved changes/);
assert.doesNotMatch(nativeDraftSocialHtml, /plugin-social-override|site-default|Saved social fallback \(source not reported\)/);

const internalSource = "debug_source:<internal>";
const nativeUnknownSource = createSerpPreviewModel({ device: "mobile", saved: {
	title: field("Saved visible title", internalSource),
	description: field("Hidden unreadable description", internalSource, true),
	permalink: field(publicAddress, internalSource),
	canonical: field(publicAddress, internalSource),
} });
const nativeUnknownSourceHtml = nativeMarkup(SearchPreview, nativeUnknownSource, 260);
assert.match(nativeUnknownSourceHtml, /data-preview-state="saved">Saved value. Source information unavailable/);
assert.match(nativeUnknownSourceHtml, /data-preview-state="unavailable">Could not be read/);
assert.doesNotMatch(nativeUnknownSourceHtml, /debug_source|internal|Hidden unreadable description/);
assert.match(nativeUnknownSourceHtml, /Saved visible title/);
const nativeClearedImage = buildSocialPreviewModel({ platform: "facebook", saved: socialFields,
	draft: { image: field(null, "plugin-social-override") } });
const nativeClearedImageHtml = nativeMarkup(SocialPreview, nativeClearedImage, 260);
assert.match(nativeClearedImageHtml, /No sharing image set/);
assert.match(nativeClearedImageHtml, /data-preview-state="draft">No image in the draft/);
assert.doesNotMatch(nativeClearedImageHtml, /<img\b|new-image.png/);

const nativeMissingImageHtml = nativeMarkup(SocialPreview, missingImage, 260);
const nativeUnavailableImageHtml = nativeMarkup(SocialPreview, unknownImage, 260);
for (const html of [nativeMissingImageHtml, nativeUnavailableImageHtml]) {
	assert.match(html, /data-preview-image-compact="true"/);
	assert.match(html, /height:48px/);
	assert.doesNotMatch(html, /aspect-ratio:1\.91/);
	assert.match(html, /<svg[^>]*aria-hidden="true"/);
}
assert.doesNotMatch(nativeImageHtml, /data-preview-image-compact="true"/);
assert.ok(nativeImageHtml.includes("height:" + changedImage.profile.title.width / changedImage.profile.imageAspectRatio + "px"),
	"An available image keeps its existing profile proportions.");
for (const [model, html] of [[changedImage, nativeImageHtml], [missingImage, nativeMissingImageHtml], [unknownImage, nativeUnavailableImageHtml]] as const) {
	assert.match(visiblePreview(html), /sharing \(approximate\)/);
	assert.doesNotMatch(html, /About this preview|<details\b|Approximate layout|presentation is unverified|Title is shortened|Description is shortened/);
	const metadata = previewMetadata(html);
	for (const field of [model.fields.title, model.fields.description]) {
		if (field.state !== "unavailable" && field.value) assert.ok(metadata.includes(escapedText(field.value)));
	}
}

const mixedBasisModel = buildSocialPreviewModel({ platform: "facebook", saved: {
	title: field("Previously loaded title", "template"),
	description: field("Confirmed description", "plugin-social-override"),
	image: field(null, "site-default"),
	url: field("https://hidden.invalid/do-not-render", "generated", true),
}, draft: { title: field("Local title 👩🏽‍💻 e\u0301 العربية", "plugin-social-override") } });
const mixedBasisHtml = figure(renderToStaticMarkup(createElement(SocialPreview, {
	model: mixedBasisModel, presentation: "native", caption: "Local title with confirmed description.",
	fieldBasis: { title: "local", description: "confirmed", image: "loaded", url: "unavailable" },
})));
assert.match(mixedBasisHtml, /Local title with confirmed description/);
assert.match(mixedBasisHtml, /data-preview-basis="local">Local preview value/);
assert.match(mixedBasisHtml, /data-preview-basis="confirmed">Confirmed sharing value/);
assert.match(mixedBasisHtml, /data-preview-basis="loaded">No saved value\./);
assert.doesNotMatch(mixedBasisHtml, /last-loaded/, "loaded values are described as saved values");
assert.match(mixedBasisHtml, /data-preview-basis="unavailable">Value unavailable until metadata is refreshed/);
assert.doesNotMatch(mixedBasisHtml, /Unsaved|Saved values|hidden.invalid/);
assert.deepEqual(fittedLines(mixedBasisHtml, "title"), mixedBasisModel.fittedTitle.lines.map(escapedText));
assert.deepEqual(fittedLines(mixedBasisHtml, "description"), mixedBasisModel.fittedDescription.lines.map(escapedText));

const unspecifiedBasisHtml = figure(renderToStaticMarkup(createElement(SocialPreview, {
	model: mixedBasisModel, presentation: "native",
	fieldBasis: { title: "local", description: "confirmed", image: "loaded", url: "unavailable" },
})));
assert.match(visiblePreview(unspecifiedBasisHtml), /Local preview/);
assert.doesNotMatch(visiblePreview(unspecifiedBasisHtml), /Saved values|Unsaved changes/,
	"Mixed source values do not invent a save confirmation when no caption was supplied.");

const nativeLoadedChild = imageChild(changedImage, true);
const nativeLoadedInstance = new nativeLoadedChild.type(nativeLoadedChild.props);
nativeLoadedInstance.state = { status: "loaded" };
const nativeLoadedHtml = renderToStaticMarkup(nativeLoadedInstance.render());
assert.match(nativeLoadedHtml, /<p class="sr-only" data-preview-image-status="loaded"/, "A loaded image is not covered by a persistent status strip.");
assert.match(nativeLoadedHtml, /role="status"[^>]*aria-live="polite"/);
assert.match(nativeLoadedHtml, /Image loaded/);

function resultPageMarkup(model: SerpPreviewModel, width: number): string {
	return figure(renderToStaticMarkup(createElement("div", { style: { width } },
		createElement(SearchPreview, { model, presentation: "result-page" }))));
}
for (const model of [desktop, mobile]) {
	const resultPage = resultPageMarkup(model, 260);
	assert.equal(resultPage, resultPageMarkup(model, 900), "Result-page containers must retain the fitted model.");
	assert.deepEqual(fittedLines(resultPage, "title"), model.fittedTitle.lines.map(escapedText));
	assert.deepEqual(fittedLines(resultPage, "description"), model.fittedDescription.lines.map(escapedText));
	assert.ok(resultPage.includes(escapedText(saved.canonical.value!)));
	assert.match(resultPage, /data-preview-framed="false"/);
	assert.match(resultPage, /data-preview-fit="fixed"/);
	assert.match(resultPage, /role="region"[^>]*overflow-x:auto;overflow-y:hidden/);
	assert.doesNotMatch(resultPage, /(?:^|[;" ])transform:|scale\(|zoom:/);
	assert.match(resultPage, /white-space:nowrap/);
	assert.match(resultPage, /padding:0;border:0/);
	assert.match(resultPage, /background-color:transparent;box-shadow:none/);
	assert.match(resultPage, new RegExp(`max-width:${model.profile.title.width}px`));
	assert.match(resultPage, /style="margin:0;/);
	assert.doesNotMatch(visiblePreview(resultPage), /<details|data-preview-sources|Title is shortened|Your theme|source:/);
	previewMetadata(resultPage);
	assert.match(resultPage, /<figcaption[^>]*data-preview-summary/);
	assert.match(resultPage, /search \(approximate\)/);
}
assert.match(resultPageMarkup(nativeMissingUrl, 260), /No public address is available for this entry/);
assert.match(resultPageMarkup(unavailableSearch, 260), /The public address could not be read/);
assert.doesNotMatch(resultPageMarkup(unavailableSearch, 260), /https:\/\/canonical.invalid/);
assert.doesNotMatch(resultPageMarkup(emptyDescription, 260), /3 October 2026/);

// Complete resolved descriptions remain outside the fitted card at every length.
function fullDescriptionText(html: string): string {
	const match = html.match(/<p\b[^>]*data-preview-description-text[^>]*>([\s\S]*?)<\/p>/);
	assert.ok(match);
	return match[1];
}
const searchDescriptionMarkup = (model: SerpPreviewModel, descriptionDisplay: "compact" | "full" | "external", lastLoaded = false, presentation: "native" | "result-page" = "native") =>
	figure(renderToStaticMarkup(createElement(SearchPreview, { model, presentation, descriptionDisplay, lastLoaded })));
const ordinaryDescription = "Clear appointment preparation helps patients organise practical questions and confirmed details before a first dental visit, with useful notes for the practice.";
const ordinaryMobile = createSerpPreviewModel({ device: "mobile", saved: { ...saved, description: field(ordinaryDescription, "core-seo") } });
assert.equal(ordinaryMobile.description.value, ordinaryDescription);
assert.equal(ordinaryMobile.fittedDescription.text, ordinaryDescription, "Ordinary 160-character prose must survive the fitted mobile card.");
assert.equal(ordinaryMobile.fittedDescription.clipped, false);
const ordinaryPresentations = [
	searchDescriptionMarkup(ordinaryMobile, "compact"),
	searchDescriptionMarkup(ordinaryMobile, "full"),
	searchDescriptionMarkup(ordinaryMobile, "full", false, "result-page"),
];
for (const [index, html] of ordinaryPresentations.entries()) {
	assert.deepEqual(fittedLines(html, "description"), (index === 0 ? [ordinaryMobile.fittedDescription.displayText] : ordinaryMobile.fittedDescription.lines).map(escapedText));
	assert.equal(fullDescriptionText(html), escapedText(ordinaryDescription));
	assert.match(html, /data-preview-description-count(?:="[^"]*")?>160 characters/);
	assert.match(html, /Source: Entry SEO settings/);
	assert.doesNotMatch(html, /Shortened in this card preview/);
}
assert.equal(figure(nativeMarkup(SearchPreview, ordinaryMobile, 226)),
	figure(nativeMarkup(SearchPreview, ordinaryMobile, 900)), "Sidebar width reflows the fitted display text without shortening it.");
assert.equal(resultPageMarkup(ordinaryMobile, 226), resultPageMarkup(ordinaryMobile, 900));
for (const device of ["desktop", "mobile"] as const) {
	const model = createSerpPreviewModel({ device, saved });
	for (const descriptionDisplay of ["full", "external"] as const) {
		const html = searchDescriptionMarkup(model, descriptionDisplay);
		assert.match(html, /data-preview-fit="fixed"/, "full and external saved-modal previews retain their full-size canvas");
		assert.match(html, /role="region"[^>]*overflow-x:auto;overflow-y:hidden/);
		assert.doesNotMatch(html, /(?:^|[;" ])transform:|scale\(|zoom:/);
		assert.match(html, /white-space:nowrap/);
		assert.doesNotMatch(html, /data-preview-fit="responsive"/);
		assert.deepEqual(fittedLines(html, "title"), model.fittedTitle.lines.map(escapedText));
		assert.deepEqual(fittedLines(html, "description"), model.fittedDescription.lines.map(escapedText));
	}
}

for (const characters of [119, 120, 160, 161, 250]) {
	const text = "W".repeat(characters);
	const model = createSerpPreviewModel({ device: "mobile", saved: { ...saved, description: field(text, "core-seo") } });
	const compact = searchDescriptionMarkup(model, "compact");
	const full = searchDescriptionMarkup(model, "full");
	for (const [index, html] of [compact, full].entries()) {
		assert.match(html, new RegExp(`data-preview-description-count(?:="[^"]*")?>${characters} characters`));
		assert.equal(fullDescriptionText(html), escapedText(text), "the full input is not cut at 160 or the fitting boundary");
		assert.match(html, /Source: Entry SEO settings/);
		assert.doesNotMatch(html, /About this preview|Recommended:|Google may|Shortened in this card preview/);
		assert.deepEqual(fittedLines(html, "description"), (index === 0 ? [model.fittedDescription.displayText] : model.fittedDescription.lines).map(escapedText));
		assert.ok(html.indexOf("data-preview-description-info") > html.lastIndexOf('data-preview-line="description"'), "the readout is outside the fitted canvas");
	}
	assert.ok(previewMetadata(compact).includes(escapedText(text)), "Compact cards keep full accessible metadata without a disclosure.");
	assert.doesNotMatch(visiblePreview(compact), /data-preview-description-info|<details\b|About this preview/);
	assert.ok(visiblePreview(full).includes(`${characters} characters`), "Explicit full readouts keep useful counts visible.");
	assert.doesNotMatch(full, /<details\b|About this preview|data-preview-description-disclosure/);
	assert.equal(model.description.value, text);
}
for (const text of ["😀".repeat(160), "e\u0301".repeat(60), "Dent<strong>al</strong> implants"]) {
	const model = createSerpPreviewModel({ device: "desktop", saved: { ...saved, description: field(text, "template") } });
	const html = searchDescriptionMarkup(model, "full");
	assert.ok(html.includes(`${[...text].length} characters`), "counts Unicode code points, including combining marks");
	assert.ok(html.includes(escapedText(text)));
	assert.doesNotMatch(html, /<strong>al<\/strong>/, "resolved text is escaped, never interpreted as markup");
}
const narrowText = createSerpPreviewModel({ device: "mobile", saved: { ...saved, description: field("i".repeat(160), "content") } });
const wideText = createSerpPreviewModel({ device: "mobile", saved: { ...saved, description: field("W".repeat(160), "content") } });
assert.notDeepEqual(narrowText.fittedDescription, wideText.fittedDescription, "equal character counts retain width-dependent fitting");
assert.equal(wideText.fittedDescription.clipped, true, "Three mobile lines must still shorten wide-glyph descriptions.");
for (const model of [narrowText, wideText]) assert.match(searchDescriptionMarkup(model, "full"), /160 characters/);
const unreadableDescription = createSerpPreviewModel({ device: "mobile", saved: { ...saved, description: field("do not reveal this", "content", true) } });
const unreadableHtml = searchDescriptionMarkup(unreadableDescription, "full");
assert.match(unreadableHtml, /Count unavailable/);
assert.match(unreadableHtml, /The resolved description could not be read/);
assert.doesNotMatch(unreadableHtml, /data-preview-description-count(?:="[^"]*")?>0 characters|do not reveal this|data-preview-description-disclosure/);
const emptyDescriptionReadout = searchDescriptionMarkup(emptyDescription, "compact");
assert.match(emptyDescriptionReadout, /0 characters/);
assert.match(emptyDescriptionReadout, /No description is resolved/);
assert.doesNotMatch(emptyDescriptionReadout, /data-preview-description-disclosure/);
for (const [source, label] of [["legacy-override", "Earlier SEO settings"], ["template", "Metadata template"], ["content", "Saved content"], ["site-default", "Site defaults"], ["generated", "Generated fallback"]]) {
	const model = createSerpPreviewModel({ device: "mobile", saved: { ...saved, description: field("Resolved text", source) } });
	assert.ok(searchDescriptionMarkup(model, "full").includes(`Source: ${label}.`));
}
for (const presentation of ["native", "result-page"] as const) {
	const retained = searchDescriptionMarkup(wideText, "full", true, presentation);
	assert.match(retained, /data-description-freshness="last-loaded"/);
	assert.match(retained, /Last loaded. Source: Saved content/);
	assert.match(retained, /Last-loaded values/);
	assert.doesNotMatch(retained, /data-preview-summary-state(?:="[^"]*")?>Saved values/);
	assert.ok(retained.includes(escapedText(wideText.description.value!)));
	assert.deepEqual(fittedLines(retained, "description"), wideText.fittedDescription.lines.map(escapedText));
}

if (process.argv.includes("--render-evidence")) {
	const samples = [
		{ name: "Desktop search, narrow", theme: "light", width: 260, html: markup(SearchPreview, desktop, 260) },
		{ name: "Desktop search, wide", theme: "dark", width: 900, html: markup(SearchPreview, desktop, 900) },
		{ name: "Mobile search, narrow", theme: "dark", width: 260, html: markup(SearchPreview, mobile, 260) },
		{ name: "Mobile search, wide", theme: "light", width: 900, html: markup(SearchPreview, mobile, 900) },
		{ name: "Facebook image source, narrow", theme: "light", width: 260, html: markup(SocialPreview, facebook, 260) },
		{ name: "Facebook image source, wide", theme: "dark", width: 900, html: markup(SocialPreview, facebook, 900) },
		{ name: "X missing image, narrow", theme: "dark", width: 260, html: markup(SocialPreview, missingImage, 260) },
		{ name: "X unavailable image, wide", theme: "light", width: 900, html: markup(SocialPreview, unknownImage, 900) },
	];
	const artifact = new URL("../../../../artifacts/current-validation/phase-a-preview.html", import.meta.url);
	mkdirSync(new URL(".", artifact), { recursive: true });
	writeFileSync(artifact, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phase A preview component examples</title>
<style>body{margin:24px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#202020;background:#eee}
section{margin:24px 0;padding:20px;width:fit-content;max-width:calc(100% - 40px);border:1px solid currentColor}
section[data-theme=light]{color:#202020;background:#fff}
section[data-theme=dark]{color:#f4f4f4;background:#202020}
h1,h2{margin:0 0 8px}.example{font-weight:bold;margin:0 0 16px}
figure:focus-within [role=region]:focus{outline:2px solid currentColor;outline-offset:-2px}
.sr-only{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden;white-space:nowrap}
</style></head><body><h1>Phase A preview components</h1>
<p>Isolated leaf rendering. Native editor integration remains pending.</p>
${samples.map((sample) => `<section data-theme="${sample.theme}"><h2>${sample.name} (${sample.width}px)</h2><p class="example">Example data, no real operation</p>${sample.html}</section>`).join("\n")}
</body></html>\n`);
	console.log("Preview examples written to artifacts/current-validation/phase-a-preview.html.");
}


// The dialog owns the complete description beside its approximate card.
for (const device of ["desktop", "mobile"] as const) {
	const complete = "Complete metadata remains unchanged. ".repeat(12);
	const model = createSerpPreviewModel({ device, saved: { ...saved, description: field(complete, "template") } });
	for (const presentation of ["native", "result-page"] as const) {
		const html = searchDescriptionMarkup(model, "external", true, presentation);
		assert.equal(model.description.value, complete);
		assert.equal(model.description.source, "template");
		assert.ok(model.fittedDescription.clipped);
		assert.doesNotMatch(visiblePreview(html), /data-preview-description-info|data-preview-description-text/);
		assert.equal(fullDescriptionText(previewMetadata(html)), escapedText(complete));
		assert.doesNotMatch(html, /About this preview|Recommended:|Google may|data-preview-description-clipping|Shortened in this card preview/);
		assert.match(html, /Last-loaded values/);
		assert.match(html, /approximate/);
		assert.match(html, /data-preview-field="description"/);
	}
}

for (const presentation of ["native", "result-page"] as const) {
	const html = searchDescriptionMarkup(ordinaryMobile, "external", false, presentation);
	assert.doesNotMatch(html, /About this preview|Recommended:|Google may/);
	assert.equal(fullDescriptionText(previewMetadata(html)), escapedText(ordinaryDescription));
	assert.doesNotMatch(html, /data-preview-description-clipping|Shortened in this card preview/,
		"an unshortened description must not acquire a clipping warning");
}
// Keyword emphasis: the analyzer's phrase matcher, mapped back onto the original text.
const emphasisText = "Our dental implants guide. Dental-implants care, dental implantsxyz and DENTAL IMPLANTS aftercare.";
const emphasisRanges = seoKeywordMatchRanges(emphasisText, "Dental implants");
assert.deepEqual(emphasisRanges.map(([start, end]) => emphasisText.slice(start, end)), ["dental implants", "Dental-implants", "DENTAL IMPLANTS"],
	"case-insensitive whole phrases match; a longer word does not");
assert.equal(emphasisRanges.length, seoKeywordOccurrenceCount(emphasisText, "Dental implants"), "every counted occurrence is emphasised once");
for (const [text, keyword, expected] of [
	["Résumé tips. RESUME tips.", "resume", ["Résumé", "RESUME"]],
	["Re\u0301sume\u0301 tips", "résumé", ["Re\u0301sume\u0301"]],
	["東京の歯科インプラント案内", "インプラント", ["インプラント"]],
	["İstanbul guide", "istanbul", ["İstanbul"]],
	["No match here", "dental implants", []],
] as const) {
	assert.deepEqual(seoKeywordMatchRanges(text, keyword).map(([start, end]) => text.slice(start, end)), expected, text);
}
assert.equal(seoKeywordOccurrenceCount("ΟΔΟΣ καλή", "καλή"), 1, "control: the analyzer finds the phrase");
assert.deepEqual(seoKeywordMatchRanges("ΟΔΟΣ καλή", "καλή"), [], "a normalization that cannot be mapped back emphasises nothing");
assert.deepEqual(seoKeywordMatchRanges("Fresh bread daily", "🍕"), [], "a keyword with nothing to match emphasises nothing");

function stripTags(html: string): string { return html.replace(/<[^>]+>/g, ""); }
function emphasised(html: string): string[] {
	return Array.from(html.matchAll(/<strong data-preview-emphasis="true">([^<]*)<\/strong>/g), (match) => match[1]);
}
for (const device of ["desktop", "mobile"] as const) {
	const model = createSerpPreviewModel({ device, saved: { ...saved,
		title: field("Dental implants explained", "core-seo"),
		description: field("Dental implants replace missing teeth. Ask about dental implants today.", "core-seo") } });
	const ranges = seoKeywordMatchRanges(model.fittedDescription.displayText, "dental implants");
	assert.equal(ranges.length, 2);
	for (const descriptionDisplay of ["compact", "external"] as const) {
		const plainHtml = figure(renderToStaticMarkup(createElement(SearchPreview, { model, presentation: "native", descriptionDisplay })));
		const html = figure(renderToStaticMarkup(createElement(SearchPreview, { model, presentation: "native", descriptionDisplay, descriptionEmphasis: ranges })));
		assert.equal(emphasised(html).join(" "), "Dental implants dental implants", `${device} ${descriptionDisplay} bolds both description matches`);
		assert.deepEqual(fittedLines(html, "description").map(stripTags), fittedLines(plainHtml, "description"), "line text is unchanged");
		assert.deepEqual(fittedLines(html, "title"), fittedLines(plainHtml, "title"), "the title is never emphasised");
		assert.equal(stripTags(previewMetadata(html)), stripTags(previewMetadata(plainHtml)), "the full metadata text is unchanged");
	}
}
// A phrase that the fitted lines split is bold on both lines, without the dropped space.
let splitChecked = false;
for (let words = 0; words < 60 && !splitChecked; words += 1) {
	const description = `${"care ".repeat(words)}dental implants ${"follow-up ".repeat(30)}`.trim();
	const model = createSerpPreviewModel({ device: "desktop", saved: { ...saved, description: field(description, "core-seo") } });
	const ranges = seoKeywordMatchRanges(model.fittedDescription.displayText, "dental implants");
	const html = figure(renderToStaticMarkup(createElement(SearchPreview, { model, presentation: "native", descriptionDisplay: "external", descriptionEmphasis: ranges })));
	const lines = fittedLines(html, "description");
	const holding = lines.filter((line) => line.includes("data-preview-emphasis"));
	if (ranges.length !== 1 || holding.length !== 2) continue;
	assert.deepEqual(emphasised(html), ["dental", "implants"]);
	assert.deepEqual(lines.map(stripTags), model.fittedDescription.lines.map(escapedText));
	splitChecked = true;
}
assert.ok(splitChecked, "control: one fixture splits the phrase across lines");
const unlocatedModel = createSerpPreviewModel({ device: "mobile", saved: { ...saved, description: field("Dental implants guide", "core-seo") } });
const unlocated = figure(renderToStaticMarkup(createElement(SearchPreview, { model: { ...unlocatedModel,
	fittedDescription: { ...unlocatedModel.fittedDescription, lines: ["Something else"] } }, presentation: "native", descriptionDisplay: "external",
	descriptionEmphasis: [[0, 6]] })));
assert.deepEqual(emphasised(unlocated), [], "lines that do not come from the display text stay plain");

// A dialog narrower than the device card reflows the fitted text with a note instead of clipping it in a scroller.
{
	assert.equal(searchPreviewReflows(372, 338), true);
	assert.equal(searchPreviewReflows(572, 338), true);
	assert.equal(searchPreviewReflows(372, 400), false);
	assert.equal(searchPreviewReflows(372, null), false, "an unmeasured container keeps the device card");
	for (const model of [mobile, desktop]) {
		const narrow = figure(renderToStaticMarkup(createElement(SearchPreview, { model, presentation: "native", descriptionDisplay: "external", containerWidth: 338 })));
		assert.match(narrow, /data-preview-reflowed="true"/);
		assert.match(narrow, /data-preview-fit="responsive"/, "the reflowed card has no fixed width or inner scroller");
		assert.doesNotMatch(narrow, /scroll horizontally/);
		assert.match(narrow, new RegExp(`<p data-preview-reflow-note="true">Reflowed to fit this screen\\. The text is cut where a ${model.device === "desktop" ? "desktop" : "phone"} result cuts it; line breaks differ\\.</p>`));
		assert.ok(narrow.includes(escapedText(model.fittedDescription.displayText)), "the device's own cut text is kept");
		const wide = figure(renderToStaticMarkup(createElement(SearchPreview, { model, presentation: "native", descriptionDisplay: "external", containerWidth: 900 })));
		assert.doesNotMatch(wide, /data-preview-reflow-note|data-preview-reflowed/);
		assert.match(wide, /data-preview-fit="fixed"/);
	}
	const updating = figure(renderToStaticMarkup(createElement(SearchPreview, { model: desktop, presentation: "native", descriptionDisplay: "external", updating: true })));
	assert.match(updating, /<span data-preview-summary-state="true">Updating preview\.\.\.<\/span>/, "a card waiting for newer saved values says so");
	const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");
	assert.match(css, /\[data-preview-reflow-note\] \{[^}]*font-size: 12px;/, "the note is not tiny text");
}

console.log("Search/social preview component self-check passed.");
