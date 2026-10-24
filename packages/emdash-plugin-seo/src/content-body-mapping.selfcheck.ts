import assert from "node:assert/strict";
import {
	bindContentAnalysis, bodyMappingRevision, checkContentAnalysisOptions,
	contentAnalysisOptions, contentBodyPlan, copyContentAnalysis, projectContentBody,
	validSeoBodyMapping, type SeoBodyField, type SeoBodyMapping, type SeoBodyPlan,
} from "./content-body-mapping.ts";
import { extractSeoDocumentSignals, extractSeoDocumentText } from "./document-signals.ts";

let cases = 0;
let failures = 0;
function check(name: string, run: () => void): void {
	cases += 1;
	try { run(); }
	catch (error) {
		failures += 1;
		console.error("FAIL content body mapping: " + name);
		console.error(error);
	}
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function portable(text: string, style = "normal") {
	return { _type: "block", style, children: [{ _type: "span", text }], markDefs: [] };
}
function simple(overrides: Partial<SeoBodyMapping> = {}): SeoBodyMapping {
	return {
		collection: "pages", bodyField: "content",
		blocks: [{ type: "feature", version: 1, fields: [{ kind: "text", path: ["body"] }] }],
		...overrides,
	};
}
function configured(mapping: SeoBodyMapping, slug = "overview"): SeoBodyPlan {
	const ctx = {};
	const options = checkContentAnalysisOptions({ mappings: [mapping] });
	assert.ok(options);
	bindContentAnalysis(ctx, options);
	return contentBodyPlan(ctx, mapping.collection, slug, null);
}

check("unconfigured standard bodies keep their shape and default field precedence", () => {
	const content = [portable("Saved portable text.", "h2")];
	assert.deepEqual(projectContentBody({ content, body: "Other body" }, { version: 1, bodyField: "body" }),
		{ document: content, incomplete: false });
	assert.deepEqual(projectContentBody({ body: content }, { version: 1, bodyField: "body" }),
		{ document: content, incomplete: false });
	assert.deepEqual(projectContentBody({ content: "" }, { version: 1, bodyField: "body" }),
		{ document: "", incomplete: false });
	assert.equal(projectContentBody({ metadata: "Not body text" }, { bodyField: null }).document, undefined);
});

check("configured standard Portable Text and Tiptap blocks retain their signals", () => {
	const data = { content: [
		portable("Portable heading", "h2"), portable("Portable paragraph."),
		{ type: "paragraph", content: [{ type: "text", text: "Tiptap paragraph." }] },
		{ _type: "image", src: "/photo.png", alt: "Photo description" }, { _type: "break" },
	] };
	const before = clone(data);
	freeze(data);
	const result = projectContentBody(data, configured(simple({ blocks: [] })));
	assert.equal(result.incomplete, false);
	assert.deepEqual(extractSeoDocumentSignals(result.document), extractSeoDocumentSignals(data.content));
	assert.deepEqual(data, before);
});

check("heading append, groups, links, rich text and images follow declared order", () => {
	const mapping = simple({
		fields: [{ kind: "text", path: ["lead"] }],
		blocks: [{ type: "feature", version: 1, fields: [
			{ kind: "heading", path: ["heading"], level: 2, append: [["ending"]] },
			{ kind: "group", path: ["items", "*"], fields: [
				{ kind: "text", path: ["body"] },
				{ kind: "link", path: ["label"], href: ["url"] },
				{ kind: "image", path: ["photo"], alt: ["photoAlt"] },
			] },
			{ kind: "richText", path: ["rich"] },
		] }],
	});
	const data = { lead: "Page introduction.", content: [{
		_type: "feature", _version: 1, _key: "saved-key", heading: "Primary", ending: "ending",
		items: [
			{ body: "First item.", label: "First guide", url: "/guide", photo: "/first.png", photoAlt: "First photo" },
			{ body: "Second item.", label: "External guide", url: "https://other.example/guide", photo: "/second.png", photoAlt: "" },
		],
		rich: [portable("Rich paragraph."), portable("Rich heading", "h3")],
		metadata: { title: "Never count this metadata." },
	}] };
	const beforeData = clone(data);
	const beforeMapping = clone(mapping);
	freeze(data); freeze(mapping);
	const result = projectContentBody(data, configured(mapping));
	assert.equal(result.incomplete, false);
	assert.equal(extractSeoDocumentText(result.document),
		"Page introduction. Primary ending First item. First guide Second item. External guide Rich paragraph. Rich heading");
	const signals = extractSeoDocumentSignals(result.document, "", "https://example.com/overview");
	assert.deepEqual(signals.headings, [{ level: 2, text: "Primary ending" }, { level: 3, text: "Rich heading" }]);
	assert.deepEqual(signals.links.map(({ href, text, kind }) => ({ href, text, kind })), [
		{ href: "/guide", text: "First guide", kind: "internal" },
		{ href: "https://other.example/guide", text: "External guide", kind: "external" },
	]);
	assert.deepEqual(signals.images.map(({ reference, alt }) => ({ reference, alt })), [
		{ reference: "/first.png", alt: "First photo" }, { reference: "/second.png", alt: "" },
	]);
	assert.doesNotMatch(signals.text, /metadata|saved-key|photo|https:/);
	assert.deepEqual(data, beforeData);
	assert.deepEqual(mapping, beforeMapping);
});

check("rich text accepts a Tiptap document without counting its attributes", () => {
	const mapping = simple({ blocks: [{ type: "rich_section", version: 2, fields: [{ kind: "richText", path: ["body"] }] }] });
	const data = { content: [{ _type: "rich_section", _version: 2,
		body: { type: "doc", content: [{ type: "paragraph", attrs: { title: "Not prose" }, content: [{ type: "text", text: "Visible text." }] }] },
	}] };
	const result = projectContentBody(data, configured(mapping));
	assert.equal(result.incomplete, false);
	assert.equal(extractSeoDocumentText(result.document), "Visible text.");
});

check("an explicit empty rule ignores a known non-rendered block", () => {
	const mapping = simple({ blocks: [{ type: "private_note", version: 1, fields: [] }] });
	assert.deepEqual(projectContentBody({ content: [{ _type: "private_note", _version: 1, body: "Not rendered." }] },
		configured(mapping)), { document: [], incomplete: false });
});

check("conditional rules read only the matching declared branch", () => {
	const mapping = simple({ blocks: [
		{ type: "feature", version: 1, when: { path: ["mode"], oneOf: ["visible"] }, fields: [{ kind: "text", path: ["body"] }] },
		{ type: "feature", version: 1, when: { path: ["mode"], oneOf: ["hidden"] }, fields: [] },
	] });
	const plan = configured(mapping);
	const result = projectContentBody({ content: [
		{ _type: "feature", _version: 1, mode: "visible", body: "Visible branch." },
		{ _type: "feature", _version: 1, mode: "hidden", body: "Not rendered." },
	] }, plan);
	assert.equal(result.incomplete, false);
	assert.equal(extractSeoDocumentText(result.document), "Visible branch.");
	assert.equal(projectContentBody({ content: [{ _type: "feature", _version: 1, mode: "unknown", body: "Unknown." }] }, plan).incomplete, true);
});

check("unknown block type, saved version and malformed body refuse complete coverage", () => {
	const plan = configured(simple());
	for (const block of [
		{ _type: "other", _version: 1, body: "Unknown type." },
		{ _type: "feature", _version: 2, body: "Unknown version." },
		{ _type: "feature", body: "Missing version." },
		{ _type: "feature", _version: "1", body: "Wrong version type." }, null, "Not a block",
	]) assert.equal(projectContentBody({ content: [block] }, plan).incomplete, true, JSON.stringify(block));
	for (const content of [null, {}, "Not a block list", 5]) {
		assert.equal(projectContentBody({ content }, plan).incomplete, true);
	}
	assert.equal(projectContentBody({ content: [] }, plan).incomplete, false);
});

check("selected fields with wrong types cannot be reported complete", () => {
	const definitions: Array<{ field: SeoBodyField; data: Record<string, unknown> }> = [
		{ field: { kind: "text", path: ["body"] }, data: { body: 42 } },
		{ field: { kind: "heading", path: ["body"], level: 2 }, data: { body: ["Array text"] } },
		{ field: { kind: "heading", path: ["body"], level: 2, append: [["ending"]] }, data: { body: "Title", ending: {} } },
		{ field: { kind: "link", path: ["body"], href: ["url"] }, data: { body: "Read guide", url: 42 } },
		{ field: { kind: "image", path: ["body"], alt: ["alt"] }, data: { body: {}, alt: "Alt" } },
		{ field: { kind: "image", path: ["body"], alt: ["alt"] }, data: { body: "/image.png", alt: [] } },
		{ field: { kind: "richText", path: ["body"] }, data: { body: 42 } },
		{ field: { kind: "richText", path: ["body"] }, data: { body: [{ _type: "unknown", text: "Unsupported rich text block" }] } },
		{ field: { kind: "group", path: ["body"], fields: [{ kind: "text", path: ["label"] }] }, data: { body: "Not a group" } },
		{ field: { kind: "group", path: ["body", "*"], fields: [{ kind: "text", path: ["label"] }] }, data: { body: {} } },
	];
	for (const { field, data } of definitions) {
		const mapping = simple({ blocks: [{ type: "feature", version: 1, fields: [field] }] });
		assert.equal(projectContentBody({ content: [{ _type: "feature", _version: 1, ...data }] },
			configured(mapping)).incomplete, true, field.kind + " malformed field");
	}
});

check("a custom body field does not also count the default body", () => {
	const result = projectContentBody({
		content: [portable("Wrong body.")], sections: [{ _type: "feature", _version: 1, body: "Selected body." }],
	}, configured(simple({ bodyField: "sections" })));
	assert.equal(result.incomplete, false);
	assert.equal(extractSeoDocumentText(result.document), "Selected body.");
});

check("slug-specific plans override defaults while other collections stay unconfigured", () => {
	const ctx = {};
	const options = checkContentAnalysisOptions({ mappings: [
		simple({ bodyField: "sections" }), simple({ bodyField: "special", slugs: ["special-page"] }),
	] });
	assert.ok(options);
	bindContentAnalysis(ctx, options);
	assert.equal(contentBodyPlan(ctx, "pages", "special-page", null).bodyField, "special");
	assert.equal(contentBodyPlan(ctx, "pages", "other-page", null).bodyField, "sections");
	assert.deepEqual(contentBodyPlan(ctx, "posts", "special-page", "body"), { version: 1, bodyField: "body" });
	assert.equal(bodyMappingRevision({ version: 1, bodyField: "body" }), "");
	assert.notEqual(bodyMappingRevision(contentBodyPlan(ctx, "pages", "special-page", null)),
		bodyMappingRevision(contentBodyPlan(ctx, "pages", "other-page", null)));
});

check("configuration copies are frozen and isolated between engines and replay contexts", () => {
	const input = { mappings: [simple()] };
	const left = {}, right = {}, replay = {};
	const leftOptions = checkContentAnalysisOptions(input);
	assert.ok(leftOptions);
	bindContentAnalysis(left, leftOptions);
	input.mappings[0].bodyField = "different";
	const rightOptions = checkContentAnalysisOptions(input);
	assert.ok(rightOptions);
	bindContentAnalysis(right, rightOptions);
	copyContentAnalysis(left, replay);
	assert.equal(contentBodyPlan(left, "pages", "", null).bodyField, "content");
	assert.equal(contentBodyPlan(replay, "pages", "", null).bodyField, "content");
	assert.equal(contentBodyPlan(right, "pages", "", null).bodyField, "different");
	assert.equal(contentAnalysisOptions({}), undefined);
	assert.equal(Object.isFrozen(leftOptions), true);
	assert.equal(Object.isFrozen(leftOptions.mappings), true);
	assert.equal(Object.isFrozen(leftOptions.mappings[0].blocks[0].fields[0].path), true);
	assert.throws(() => { (leftOptions.mappings[0] as { bodyField: string }).bodyField = "mutated"; }, TypeError);
});

check("path and companion validation rejects unsafe or ambiguous selectors", () => {
	for (const selector of [["__proto__"], ["constructor"], ["prototype"], ["a.b"], ["bad/key"], ["a".repeat(129)], Array(9).fill("nested")]) {
		assert.equal(validSeoBodyMapping(simple({ blocks: [{ type: "feature", version: 1, fields: [{ kind: "text", path: selector }] }] })), false, JSON.stringify(selector));
	}
	const invalidFields: unknown[] = [
		{ kind: "heading", path: ["title"], level: 7 }, { kind: "heading", path: ["title"] },
		{ kind: "text", path: ["body"], level: 2 }, { kind: "link", path: ["label"] },
		{ kind: "text", path: ["body"], href: ["url"] }, { kind: "text", path: ["body"], append: [["ending"]] },
		{ kind: "group", path: ["items"] }, { kind: "group", path: [], fields: [{ kind: "text", path: ["lead"] }] }, { kind: "text", path: ["body"], fields: [] },
		{ kind: "link", path: ["items", "*", "label"], href: ["items", "*", "url"] },
		{ kind: "heading", path: ["items", "*", "title"], level: 2, append: [["ending"]] },
		{ kind: "image", path: ["items", "*", "image"], alt: ["alt"] },
	];
	for (const field of invalidFields) {
		assert.equal(validSeoBodyMapping(simple({ blocks: [{ type: "feature", version: 1, fields: [field as SeoBodyField] }] })), false, JSON.stringify(field));
	}
	for (const fields of [
		[{ kind: "text", path: ["body"] }, { kind: "richText", path: ["body"] }],
		[{ kind: "richText", path: ["body"] }, { kind: "text", path: ["body", "text"] }],
	]) {
		assert.equal(validSeoBodyMapping(simple({ blocks: [{ type: "feature", version: 1, fields: fields as SeoBodyField[] }] })), false);
	}
	assert.equal(validSeoBodyMapping(simple({ fields: [{ kind: "richText", path: ["content"] }] })), false);
});

check("validation rejects executable, cyclic, accessor and non-plain values without invoking them", () => {
	assert.equal(checkContentAnalysisOptions(undefined), undefined);
	assert.deepEqual(checkContentAnalysisOptions({ mappings: [] }), { mappings: [] });
	for (const value of [null, {}, { mappings: "not a list" }, { mappings: [simple()], render: () => "Text" }]) {
		assert.throws(() => checkContentAnalysisOptions(value));
	}
	const functionPath = simple() as unknown as Record<string, unknown>;
	functionPath.bodyField = () => "content";
	assert.equal(validSeoBodyMapping(functionPath), false);
	const inherited = Object.assign(Object.create({ toJSON: () => simple() }), simple());
	assert.equal(validSeoBodyMapping(inherited), false);
	let reads = 0;
	const getterMapping = simple();
	Object.defineProperty(getterMapping, "bodyField", { enumerable: true, get() { reads += 1; return "content"; } });
	assert.equal(validSeoBodyMapping(getterMapping), false);
	assert.equal(reads, 0);
	const accessorOptions = {};
	Object.defineProperty(accessorOptions, "mappings", { enumerable: true, get() { reads += 1; return [simple()]; } });
	assert.throws(() => checkContentAnalysisOptions(accessorOptions));
	assert.equal(reads, 0);
	const cyclic = simple() as unknown as Record<string, unknown>;
	cyclic.extra = cyclic;
	assert.equal(validSeoBodyMapping(cyclic), false);
	assert.throws(() => checkContentAnalysisOptions({ mappings: new Array(1) }), "sparse configuration arrays cannot turn into a different JSON plan");
	const array = [simple()];
	Object.defineProperty(array, "0", { enumerable: true, get() { reads += 1; return simple(); } });
	assert.throws(() => checkContentAnalysisOptions({ mappings: array }));
	assert.equal(reads, 0);
});

check("configuration limits reject excess mappings, fields, nesting and serialized bytes", () => {
	assert.throws(() => checkContentAnalysisOptions({ mappings: Array.from({ length: 33 }, () => simple()) }));
	assert.equal(validSeoBodyMapping(simple({ blocks: Array.from({ length: 129 }, (_, i) => ({ type: "block_" + i, version: 1, fields: [] })) })), false);
	assert.equal(validSeoBodyMapping(simple({ blocks: [{ type: "feature", version: 1,
		fields: Array.from({ length: 129 }, (_, i) => ({ kind: "text" as const, path: ["field_" + i] })) }] })), false);
	let nested: SeoBodyField = { kind: "text", path: ["body"] };
	for (let i = 0; i < 10; i += 1) nested = { kind: "group", path: ["child"], fields: [nested] };
	assert.equal(validSeoBodyMapping(simple({ blocks: [{ type: "feature", version: 1, fields: [nested] }] })), false);
	const largeSlugs = Array.from({ length: 128 }, (_, i) => String(i).padStart(3, "0") + "x".repeat(253));
	assert.throws(() => checkContentAnalysisOptions({ mappings: [simple({ slugs: largeSlugs }), simple({ slugs: largeSlugs }), simple({ slugs: largeSlugs })] }));
});

check("projection bounds and cycles fail incomplete without mutating saved data", () => {
	const plan = configured(simple());
	assert.equal(projectContentBody({ content: Array.from({ length: 2_001 }, () => ({ _type: "feature", _version: 1, body: "Text" })) }, plan).incomplete, true);
	const long = { content: [{ _type: "feature", _version: 1, body: "x".repeat(262_145) }] };
	const before = long.content[0].body;
	assert.equal(projectContentBody(long, plan).incomplete, true);
	assert.equal(long.content[0].body, before);
	const groupMapping = simple({ blocks: [{ type: "feature", version: 1,
		fields: [{ kind: "group", path: ["items", "*"], fields: [{ kind: "text", path: ["body"] }] }] }] });
	const fanout = { content: [{ _type: "feature", _version: 1, items: Array.from({ length: 2_000 }, () => ({ body: "Text" })) }] };
	assert.equal(projectContentBody(fanout, configured(groupMapping)).incomplete, true);
	const cycle: Record<string, unknown> = { type: "doc", content: [portable("Visible text.")] };
	cycle.metadata = cycle;
	(cycle.content as unknown[]).push(cycle);
	const result = projectContentBody({ content: [{ _type: "feature", _version: 1, body: cycle }] },
		configured(simple({ blocks: [{ type: "feature", version: 1, fields: [{ kind: "richText", path: ["body"] }] }] })));
	assert.equal(result.incomplete, true);
	assert.equal(cycle.metadata, cycle);
});

check("nested unknown rich-text nodes do not become observed prose or complete coverage", () => {
 const mapping = simple({ blocks: [{ type: "feature", version: 1, fields: [{ kind: "richText", path: ["body"] }] }] });
 const project = (body: unknown) => projectContentBody({ content: [{ _type: "feature", _version: 1, body }] }, configured(mapping));
 const known = { type: "doc", content: [{ type: "blockquote", content: [
  { type: "paragraph", content: [{ type: "text", text: "Visible bread instructions.", marks: [{ type: "link", attrs: { href: "/bread" } }] }] },
 ] }] };
 const good = project(known);
 assert.equal(good.incomplete, false);
 assert.equal(extractSeoDocumentText(good.document), "Visible bread instructions.");
 const nested = structuredClone(known);
 (nested.content[0].content as unknown[]).push({ type: "unknownWidget", text: "Hidden arbitrary widget text" });
 const partial = project(nested);
 assert.equal(partial.incomplete, true);
 assert.equal(extractSeoDocumentText(partial.document), "Visible bread instructions.");
 const pt = project([{ _type: "block", children: [{ _type: "span", text: "Known span." }, { _type: "unknownWidget", text: "Never count this" }] }]);
 assert.equal(pt.incomplete, true);
 assert.equal(extractSeoDocumentText(pt.document), "Known span.");
 const hiddenOverride = project([{ _type: "block", text: "Do not replace rendered child text", children: [{ _type: "span", text: "Visible child.", children: [{ _type: "span", text: "Not a rendered descendant" }] }] }]);
 assert.equal(hiddenOverride.incomplete, false);
 assert.equal(extractSeoDocumentText(hiddenOverride.document), "Visible child.");
 const rootTiptap = projectContentBody({ content: known }, configured(simple({ blocks: [] })));
 assert.equal(rootTiptap.incomplete, false);
 assert.equal(extractSeoDocumentText(rootTiptap.document), "Visible bread instructions.");
 const hiddenTiptap = project({ type: "doc", text: "Not document prose", content: [{ type: "paragraph", text: "Not paragraph prose", content: [{ type: "text", text: "Rendered text." }] }] });
 assert.equal(hiddenTiptap.incomplete, false);
 assert.equal(extractSeoDocumentText(hiddenTiptap.document), "Rendered text.");
 const leafImage = project({ type: "doc", content: [{ type: "image", attrs: { src: "/photo.png", alt: "Photo" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Not rendered beneath an image" }] }] }] });
 assert.equal(leafImage.incomplete, false);
 assert.equal(extractSeoDocumentText(leafImage.document), "");
 assert.equal(extractSeoDocumentSignals(leafImage.document).imageAltCount, 1);
 const imageAliases = [{ _type: "image", previewUrl: "/photo.png", altText: "Photo description" }, { _type: "image", attrs: { src: "/second.png", alternativeText: "Another photo" } }];
 const projectedImages = project(imageAliases);
 assert.deepEqual(extractSeoDocumentSignals(projectedImages.document).images, extractSeoDocumentSignals(imageAliases).images, "configured image metadata preserves existing source and alt aliases");
 const directLinks = [{ _type: "block", children: [{ _type: "link", attrs: { href: "/first" }, children: [{ _type: "span", text: "First route" }] }] }, { type: "paragraph", content: [{ type: "link", href: "/second", content: [{ type: "text", text: "Second route" }] }] }];
 const projectedLinks = project(directLinks);
 assert.deepEqual(extractSeoDocumentSignals(projectedLinks.document, "", "https://example.test/").links, extractSeoDocumentSignals(directLinks, "", "https://example.test/").links, "configured direct link href aliases retain observed evidence");
 const hiddenLinkText = project([{ _type: "block", children: [{ _type: "link", href: "/route", text: "Hidden link override", children: [{ _type: "span", text: "Visible link" }] }] }]);
 assert.equal(extractSeoDocumentText(hiddenLinkText.document), "Visible link");
 const malformedChild = project([{ _type: "block", children: [null, "not a span"] }]);
 assert.equal(malformedChild.incomplete, true);
 const code = project([portable("Known paragraph."), { _type: "code", code: "not body prose", language: "text" }]);
 assert.equal(code.incomplete, false);
 assert.equal(extractSeoDocumentText(code.document), "Known paragraph.");
});

if (failures) throw new Error("Content body mapping: " + failures + " of " + cases + " cases failed.");
console.log("Content body mapping: " + cases + " cases passed.");
