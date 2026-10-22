import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as icons from "@phosphor-icons/react";

import { createSerpPreviewModel, type SerpPreviewModel } from "./serp-preview-model.ts";
import { buildSocialPreviewModel, type SocialPreviewModel } from "./social-preview-model.ts";

// The real preview components, compiled from source.
const previewSource = readFileSync(new URL("./search-social-preview.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(previewSource, {
	fileName: "search-social-preview.tsx",
	reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const loaded = { exports: {} as Record<string, any> };
const requireFromReact = createRequire(import.meta.resolve("react"));
new Function("require", "module", "exports", compiled.outputText)(
	(name: string) => name === "@phosphor-icons/react" ? icons : requireFromReact(name),
	loaded,
	loaded.exports,
);
const { SearchPreview, SocialPreview } = loaded.exports;

// The props each editor surface passes, read from the editor source rather than restated here.
const editorSource = readFileSync(new URL("./content-extensions.tsx", import.meta.url), "utf8");
const editor = ts.createSourceFile("content-extensions.tsx", editorSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
type Attributes = Map<string, ts.JsxAttribute["initializer"]>;
interface JsxUse { attributes: Attributes; inDialog: boolean }

function jsxUses(root: ts.Node, tag: string): JsxUse[] {
	const uses: JsxUse[] = [];
	const visit = (node: ts.Node) => {
		if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === tag) {
			const attributes: Attributes = new Map();
			for (const attribute of node.attributes.properties) {
				assert.ok(ts.isJsxAttribute(attribute), `${tag} props are explicit, without spreads`);
				attributes.set(attribute.name.getText(), attribute.initializer);
			}
			let inDialog = false;
			for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
				if (ts.isJsxElement(parent) && /^Dialog\b/.test(parent.openingElement.tagName.getText())) inDialog = true;
			}
			uses.push({ attributes, inDialog });
		}
		ts.forEachChild(node, visit);
	};
	visit(root);
	return uses;
}
function literal(value: ts.Expression | ts.JsxAttribute["initializer"]): string | boolean | null {
	if (value === undefined) return true;
	if (ts.isStringLiteral(value)) return value.text;
	if (ts.isJsxExpression(value) && value.expression) return literal(value.expression);
	if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
	return null;
}

const frame = editor.statements.find((statement): statement is ts.FunctionDeclaration =>
	ts.isFunctionDeclaration(statement) && statement.name?.text === "SearchSnippetFrame");
assert.ok(frame, "SearchSnippetFrame owns every editor search preview");
const frameBinding = frame.parameters[0]?.name;
assert.ok(frameBinding && ts.isObjectBindingPattern(frameBinding));
const frameDefaults = new Map(frameBinding.elements.map((element): [string, ReturnType<typeof literal> | undefined] =>
	[element.name.getText(), element.initializer ? literal(element.initializer) : undefined]));
const [innerPreview, ...extraInner] = jsxUses(frame, "ResolvedSearchPreview");
assert.ok(innerPreview && extraInner.length === 0);
const presentation = innerPreview.attributes.get("presentation");
assert.ok(presentation && ts.isJsxExpression(presentation) && presentation.expression && ts.isConditionalExpression(presentation.expression));
const presentationChoice = presentation.expression;
assert.equal(presentationChoice.condition.getText(), "resultPage");
const presentationFor = (resultPage: boolean) => literal(resultPage ? presentationChoice.whenTrue : presentationChoice.whenFalse);
assert.equal(innerPreview.attributes.get("descriptionDisplay")?.getText(), "{descriptionDisplay}");

const searchSurfaces = jsxUses(editor, "SearchSnippetFrame").map(({ attributes, inDialog }) => {
	const resultPage = attributes.has("resultPage") ? literal(attributes.get("resultPage")) : frameDefaults.get("resultPage");
	const descriptionDisplay = attributes.has("descriptionDisplay") ? literal(attributes.get("descriptionDisplay")) : frameDefaults.get("descriptionDisplay");
	assert.equal(typeof resultPage, "boolean");
	assert.equal(typeof descriptionDisplay, "string");
	return { inDialog, resultPage: resultPage as boolean, props: { presentation: presentationFor(resultPage as boolean), descriptionDisplay } };
});
const sidebarSurfaces = searchSurfaces.filter((surface) => !surface.inDialog);
const dialogSurfaces = searchSurfaces.filter((surface) => surface.inDialog);
const socialSurfaces = jsxUses(editor, "ResolvedSocialPreview").map(({ attributes }) => ({
	presentation: attributes.has("presentation") ? literal(attributes.get("presentation")) : undefined,
	loadImage: attributes.has("loadImage") ? literal(attributes.get("loadImage")) : false,
}));

// Fixtures: values long enough that both device cards must shorten them.
type Field = { value: string | null; source: string; unavailable?: boolean };
const field = (value: string | null, source: string, unavailable = false): Field => ({ value, source, unavailable });
const title = "Readable sidebar previews keep their original type size while long appointment guide titles wrap across several lines in narrow editor panels";
const description = "Clinic appointment guidance explains preparation, arrival times, insurance questions, aftercare and follow-up visits for new patients in plain language, with extra detail for families. Bring your referral letter, a current medication list and any recent x-rays to the first visit.";
const saved = {
	title: field(title, "template"),
	description: field(description, "core-seo"),
	permalink: field("https://example.invalid/clinic/appointments/", "generated"),
	canonical: field("https://example.invalid/clinic/appointments-guide/", "core-seo"),
};
function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
const models: SerpPreviewModel[] = (["desktop", "mobile"] as const).map((device) => deepFreeze(createSerpPreviewModel({ device, saved })));

const escaped = (text: string) => renderToStaticMarkup(createElement(Fragment, null, text));
const render = (component: unknown, props: Record<string, unknown>) =>
	renderToStaticMarkup(createElement(component as never, props as never));
function lines(html: string, name: "title" | "description") {
	return Array.from(html.matchAll(new RegExp(`<div data-preview-line="${name}"([^>]*)>([^<]*)</div>`, "g")),
		(match) => ({ attributes: match[1] ?? "", text: match[2] ?? "" }));
}
function attributesOf(html: string, marker: string): string {
	const match = html.match(new RegExp(`<div ${marker}="true"([^>]*)>`));
	assert.ok(match, "Rendered element: " + marker);
	return match[1] ?? "";
}

let checks = 0;
function check(_name: string, run: () => void) {
	run();
	checks += 1;
}

check("editor surfaces keep the compact sidebar apart from the dialog previews", () => {
	assert.ok(sidebarSurfaces.length > 0 && dialogSurfaces.length > 0);
	for (const surface of sidebarSurfaces) assert.deepEqual(surface.props, { presentation: "native", descriptionDisplay: "compact" });
	for (const surface of dialogSurfaces) assert.equal(surface.props.descriptionDisplay, "external");
	assert.ok(dialogSurfaces.some((surface) => surface.resultPage) && dialogSurfaces.some((surface) => !surface.resultPage));
	assert.ok(jsxUses(editor, "SavedSnippetReviewNote").some((use) => use.inDialog), "the dialog shows the complete saved metadata beside its card");
	assert.ok(socialSurfaces.length > 0 && socialSurfaces.every((surface) => surface.presentation === "native"));
	assert.ok(socialSurfaces.some((surface) => surface.loadImage === true), "the editor loads the social image");
	for (const model of models) {
		assert.equal(model.fittedTitle.clipped, true, "control: the title is shortened on " + model.device);
		assert.equal(model.fittedDescription.clipped, true, "control: the description is shortened on " + model.device);
	}
});

check("the sidebar flows one exact fitted display string at original font sizes without scaling", () => {
	for (const model of models) {
		for (const { props } of sidebarSurfaces) {
			const html = render(SearchPreview, { model, ...props });
			const frameAttributes = attributesOf(html, "data-preview-frame");
			const cardAttributes = attributesOf(html, "data-preview-card");
			assert.match(frameAttributes, /data-preview-fit="responsive"/);
			// text-transform:none on each line is not a geometric transform.
			assert.doesNotMatch(html, /[;"]transform:|scale\(|zoom:|text-overflow|line-clamp/);
			assert.doesNotMatch(frameAttributes, /height:|overflow/);
			assert.match(cardAttributes, /style="width:100%;min-width:0;max-width:100%/);
			for (const name of ["title", "description"] as const) {
				const rendered = lines(html, name);
				const fitted = name === "title" ? model.fittedTitle : model.fittedDescription;
				assert.equal(rendered.length, 1, `${model.device} ${name} has one naturally wrapping block`);
				assert.equal(rendered[0]!.text, escaped(fitted.displayText), `${model.device} ${name} retains its exact fitted display text`);
				for (const line of rendered) {
					assert.match(line.attributes, new RegExp(`font-size:${model.profile[name].fontSize}px`));
					assert.match(line.attributes, /width:100%;/);
					assert.match(line.attributes, /white-space:normal;overflow-wrap:anywhere/);
				}
			}
		}
	}
});

check("dated descriptions and continuous text do not inherit logical line breaks in compact search", () => {
	const datedDescription = "Clear appointment preparation helps patients organise practical questions and confirmed details before a first dental visit, with useful notes for the practice.".slice(0, 146);
	assert.equal(datedDescription.length, 146);
	for (const device of ["desktop", "mobile"] as const) {
		for (const value of [datedDescription, "検索結果の説明を確認する".repeat(25), "unbroken".repeat(40), "👩🏽‍💻e\u0301".repeat(40)]) {
			const model = deepFreeze(createSerpPreviewModel({ device, datePrefix: "17 Oct 2026 -", saved: {
				...saved, description: field(value, "core-seo"),
			} }));
			const snapshot = JSON.stringify(model);
			assert.ok(model.fittedDescription.lines.length > 1, "Control: the model contains multiple logical description lines.");
			const html = render(SearchPreview, { model, ...sidebarSurfaces[0]!.props });
			const descriptionBlocks = lines(html, "description");
			assert.equal(descriptionBlocks.length, 1);
			assert.equal(descriptionBlocks[0]!.text, escaped("17 Oct 2026 - " + model.fittedDescription.text));
			assert.equal(descriptionBlocks[0]!.text, escaped(model.fittedDescription.displayText));
			assert.equal(descriptionBlocks[0]!.text.split("17 Oct 2026 -").length - 1, 1);
			assert.ok(html.includes(escaped(value)), "The complete original description remains accessible outside the fitted card.");
			assert.equal(JSON.stringify(model), snapshot, "Compact rendering leaves the fitted model and original metadata unchanged.");
		}
	}
});

check("the sidebar keeps full accessible metadata without a visible disclosure or warning wall", () => {
	for (const model of models) {
		const html = render(SearchPreview, { model, ...sidebarSurfaces[0]!.props });
		const metadata = html.match(/<aside\b[^>]*data-preview-metadata[^>]*>[\s\S]*?<\/aside>/)?.[0];
		assert.ok(metadata, "Full metadata remains in the rendered accessibility content.");
		assert.match(metadata, /class="sr-only"/);
		assert.doesNotMatch(metadata, /\baria-hidden=|\bhidden(?:=|\s|>)/);
		const fullText = metadata.match(/<p data-preview-description-text="true" dir="auto">([^<]*)<\/p>/)?.[1];
		assert.equal(fullText, escaped(description), "The complete description is retained beyond the fitted card.");
		assert.ok(metadata.includes(`${[...description].length} characters`));
		assert.match(metadata, /Source: Entry SEO settings\./);
		for (const value of [title, saved.canonical.value!, saved.permalink.value!]) assert.ok(metadata.includes(escaped(value)));
		const visible = html.replace(metadata, "");
		assert.doesNotMatch(visible, /<details\b|About this preview|Recommended:|Google may|Shortened in this card preview|Source:/);
		assert.ok(!visible.includes(escaped(description)), "The complete description does not become a duplicate paragraph under the compact card.");
	}
});

check("dialog previews keep full-size text and confine scrolling to the fitted canvas", () => {
	for (const model of models) {
		for (const surface of dialogSurfaces) {
			const html = render(SearchPreview, { model, ...surface.props });
			const width = model.profile.title.width;
			const frameAttributes = attributesOf(html, "data-preview-frame");
			assert.match(frameAttributes, /data-preview-fit="fixed"/);
			assert.match(frameAttributes, /role="region" aria-label="(?:Desktop|Mobile) search preview"/);
			assert.match(frameAttributes, /width:100%;max-width:\d+px;min-width:0;overflow-x:auto;overflow-y:hidden/);
			const cardAttributes = attributesOf(html, "data-preview-card");
			assert.match(cardAttributes, new RegExp(`width:${width}px;min-width:${width}px;max-width:${width}px`));
			assert.doesNotMatch(html, /[;" ]transform:|scale\(|zoom:|text-overflow|line-clamp/);
			assert.match(cardAttributes, new RegExp(`data-preview-framed="${!surface.resultPage}"`));
			for (const name of ["title", "description"] as const) {
				const fitted = name === "title" ? model.fittedTitle : model.fittedDescription;
				assert.deepEqual(lines(html, name).map((line) => line.text), fitted.lines.map(escaped), "Dialog line geometry remains the original fitted lines.");
				for (const line of lines(html, name)) {
					assert.match(line.attributes, new RegExp(`width:${model.profile[name].width}px;`));
					assert.match(line.attributes, new RegExp(`font-size:${model.profile[name].fontSize}px;`));
					assert.match(line.attributes, /white-space:nowrap/);
				}
			}
			assert.doesNotMatch(html.replace(/<aside\b[^>]*data-preview-metadata[^>]*>[\s\S]*?<\/aside>/g, ""), /data-preview-description-info/, "the dialog's separate saved metadata review owns the visible full text");
			assert.ok(html.includes(escaped(description)), "The preview retains the original full description accessibly.");
			assert.doesNotMatch(html, /About this preview|Shortened in this card preview|Recommended:|Google may/);
		}
	}
});

check("narrow modal wrappers retain the selected device, fitted words and metadata model", () => {
	for (const model of models) {
		const snapshot = JSON.stringify(model);
		for (const surface of dialogSurfaces) {
			const preview = render(SearchPreview, { model, ...surface.props });
			for (const width of [226, 444, 900]) {
				// Wrapper widths exercise the real render contract; SSR does not measure overflow.
				const html = renderToStaticMarkup(createElement("div", { style: { width } },
					createElement(SearchPreview, { model, ...surface.props })));
				assert.equal(html, `<div style="width:${width}px">${preview}</div>`);
				assert.ok(html.includes(`aria-label="${model.device === "desktop" ? "Desktop" : "Mobile"} search preview (approximate)"`));
				assert.equal((html.match(/overflow-x:auto/g) ?? []).length, 1, "only the preview canvas declares horizontal scrolling");
				const figureAttributes = html.match(/<figure\b([^>]*)>/)?.[1];
				assert.ok(figureAttributes);
				assert.match(figureAttributes, /min-width:0/);
				assert.doesNotMatch(figureAttributes, /overflow|transform|height:/);
				assert.deepEqual(lines(html, "title").map((line) => line.text), model.fittedTitle.lines.map(escaped));
				assert.deepEqual(lines(html, "description").map((line) => line.text), model.fittedDescription.lines.map(escaped));
			}
		}
		assert.equal(JSON.stringify(model), snapshot, "modal rendering cannot refit, switch device or mutate saved metadata");
	}
});

check("the social image uses its exact URL with a centred cover crop and keeps load and failure feedback", () => {
	const imageUrl = 'https://media.invalid/uploads/og card.png?w=1200&h=630&v="2"';
	const socialFields = {
		title: field("Sharing title for the appointment guide", "plugin-social-override"),
		description: field(description, "template"),
		image: field(imageUrl, "core-seo"),
		url: field(saved.canonical.value, "core-seo"),
	};
	const surface = socialSurfaces.find((item) => item.loadImage === true)!;
	const model: SocialPreviewModel = deepFreeze(buildSocialPreviewModel({ platform: "facebook", saved: socialFields }));
	const props = { model, presentation: surface.presentation, loadImage: true };
	const html = render(SocialPreview, props);
	assert.match(attributesOf(html, "data-preview-frame"), /data-preview-fit="scaled"/);
	assert.match(attributesOf(html, "data-preview-card"), /transform:scale\(1\);transform-origin:top left/);
	const images = html.match(/<img\b[^>]*>/g) ?? [];
	assert.equal(images.length, 1);
	assert.ok(images[0]!.includes(`src="${escaped(imageUrl)}"`), "the exact supplied URL, unchanged");
	assert.match(images[0]!, /style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;visibility:hidden"/);
	assert.match(html, /data-preview-image-status="loading" role="status" aria-live="polite"[^>]*>Loading image\./);
	assert.ok(html.includes(`height:${model.profile.title.width / model.profile.imageAspectRatio}px`), "the image frame keeps its card proportion");
	assert.deepEqual(lines(html, "title").map((line) => line.text), model.fittedTitle.lines.map(escaped));
	assert.deepEqual(lines(html, "description").map((line) => line.text), model.fittedDescription.lines.map(escaped));

	type Instance = { state: { status: string }; setState(update: { status: string }): void; render(): ReactElement<{ children?: ReactNode }> };
	const find = (node: ReactNode): ReactElement<{ url?: string; children?: ReactNode }> | null => {
		if (!isValidElement<{ url?: string; children?: ReactNode }>(node)) return null;
		if (typeof node.type === "function" && node.props.url !== undefined) return node;
		for (const child of ([] as ReactNode[]).concat(node.props.children)) {
			const found = find(child);
			if (found) return found;
		}
		return null;
	};
	const owner = find(SocialPreview(props));
	assert.ok(owner && owner.props.url === imageUrl && owner.key === imageUrl, "image state is keyed by its exact URL");
	const instance = new (owner.type as unknown as new (props: unknown) => Instance)(owner.props);
	instance.setState = (update) => { instance.state = { ...instance.state, ...update }; };
	const image = () => ([] as ReactNode[]).concat(instance.render().props.children)
		.find((child) => isValidElement(child) && child.type === "img") as ReactElement<{ onLoad(): void; onError(): void }> | undefined;
	image()!.props.onLoad();
	const loadedHtml = renderToStaticMarkup(instance.render());
	assert.match(loadedHtml, /object-fit:cover;object-position:center;visibility:visible/);
	assert.match(loadedHtml, /<p class="sr-only" data-preview-image-status="loaded"[^>]*>Image loaded\./);
	image()!.props.onError();
	const failedHtml = renderToStaticMarkup(instance.render());
	assert.doesNotMatch(failedHtml, /<img\b/);
	assert.match(failedHtml, /data-preview-image-status="failed" role="status"[^>]*>Image could not load\./);

	for (const [imageField, text] of [[field("", "core-seo"), "No sharing image set."], [field(imageUrl, "core-seo", true), "Sharing image could not be read."]] as const) {
		const other = render(SocialPreview, { ...props, model: buildSocialPreviewModel({ platform: "facebook", saved: { ...socialFields, image: imageField } }) });
		assert.doesNotMatch(other, /<img\b/);
		assert.ok(other.includes(text));
		assert.ok(!other.includes(escaped(imageUrl)), "an empty or unreadable image never shows a URL");
	}
});

console.log(`Preview readability self-check passed (${checks} checks). Rendered markup only; browser layout, fonts and pixel geometry are not measured.`);
