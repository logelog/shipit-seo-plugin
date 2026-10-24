import assert from "node:assert/strict";
import { projectContentBody, validSeoBodyMapping, type SeoBodyMapping } from "./content-body-mapping.ts";
import { extractSeoDocumentSignals } from "./document-signals.ts";

let cases = 0;
function check(name: string, run: () => void): void {
	run();
	cases += 1;
	console.log(`  PASS  ${name}`);
}

function paragraph(text: string) {
	return { _type: "block", style: "normal", children: [{ _type: "span", text }], markDefs: [] };
}

function project(data: Record<string, unknown>, mapping: SeoBodyMapping, publicUrl: string) {
	assert.equal(validSeoBodyMapping(mapping), true);
	const originalData = structuredClone(data);
	const originalMapping = structuredClone(mapping);
	const projection = projectContentBody(data, { bodyField: mapping.bodyField, mapping });
	assert.deepEqual(data, originalData, "reading saved content must not change it");
	assert.deepEqual(mapping, originalMapping, "a render plan must remain unchanged");
	assert.equal(projection.incomplete, false);
	const signals = extractSeoDocumentSignals(projection.document, "", publicUrl);
	assert.equal(signals.unsupportedBlockCount, 0);
	return signals;
}

const feature = {
	_type: "site_feature", _version: 1, _key: "schema", anchor: "schema",
	heading: "Structured data", lead: "Describe the visible page.", description: "A complete feature description.",
	label: "Excluded section label", number: "02", tone: "ink",
	body: [
		{ _type: "block", style: "h3", children: [{ _type: "span", text: "Answer common questions" }] },
		paragraph("Keep reusable details with the saved page."),
		{
			_type: "block", style: "normal",
			children: [{ _type: "span", text: "Read the reference", marks: ["reference"] }],
			markDefs: [{ _key: "reference", _type: "link", href: "https://reference.example/schema" }],
		},
	],
	items: [{ label: "Reusable definitions", icon: "schema" }, { label: "Saved entry overrides", icon: "check" }],
	note: "Only public pages are assessed.", link_label: "Schema guide", link_url: "/docs/schema",
};

const home = {
	title: "Excluded search title", excerpt: "Excluded search description",
	featured_image: { src: "https://example.com/social.png", alt: "Excluded social image" },
	content: [
		{
			_type: "site_hero", _version: 1, _key: "hero", heading: "Content controls", highlight: "Inside the editor",
			lead: "Review saved copy before publishing.", body: [paragraph("Editors can check one page without a bulk scan.")],
			label: "Excluded eyebrow", note: "Excluded release status", baseline_left: "Excluded compatibility label",
			link_label: "Read the guide", link_url: "/docs/install", secondary_label: "Source repository", secondary_url: "https://example.org/source",
		},
		{
			_type: "site_screenshot", _version: 1, _key: "screenshot", heading: "Excluded screenshot heading",
			asset: "indexing", image_alt: "Excluded screenshot alternative", caption: "Excluded screenshot caption",
		},
		{
			_type: "site_feature", _version: 1, _key: "appearance", anchor: "appearance", heading: "Excluded appearance heading",
			lead: "Excluded appearance lead", body: [paragraph("Excluded appearance paragraph")],
			link_label: "Review content", link_url: "/docs/analysis",
		},
		feature,
		{
			_type: "site_feature", _version: 1, _key: "analysis", anchor: "analysis", heading: "Business details",
			lead: "Keep public information accurate.", body: [paragraph("Choose one page for the complete address.")],
			items: [{ label: "Excluded home capability", icon: "person" }], note: "Excluded preview caption",
			link_label: "Business guide", link_url: "/docs/configure",
		},
		{
			_type: "site_workflow", _version: 1, _key: "workflow", heading: "Excluded workflow heading",
			items: [{ title: "Excluded workflow step", description: "Excluded workflow description", link_url: "/not-rendered" }],
		},
		{
			_type: "site_control", _version: 1, _key: "control", heading: "Excluded control heading",
			lead: "Excluded control lead", body: [paragraph("Excluded control paragraph")],
		},
		{
			_type: "site_closing", _version: 1, _key: "closing", heading: "Try one page",
			body: [paragraph("Keep a backup before changing the site.")], link_label: "Removal guide", link_url: "/docs/uninstall",
		},
	],
};

const homeMapping: SeoBodyMapping = {
	collection: "home", slugs: ["home"], bodyField: "content",
	blocks: [
		{ type: "site_hero", version: 1, fields: [
			{ kind: "heading", path: ["heading"], level: 1, append: [["highlight"]] },
			{ kind: "text", path: ["lead"] }, { kind: "richText", path: ["body"] },
			{ kind: "link", path: ["link_label"], href: ["link_url"] },
			{ kind: "link", path: ["secondary_label"], href: ["secondary_url"] },
		] },
		{ type: "site_feature", version: 1, when: { path: ["anchor"], oneOf: ["appearance"] }, fields: [
			{ kind: "link", path: ["link_label"], href: ["link_url"] },
		] },
		{ type: "site_feature", version: 1, when: { path: ["anchor"], oneOf: ["schema", "analysis"] }, fields: [
			{ kind: "heading", path: ["heading"], level: 2 }, { kind: "text", path: ["lead"] },
			{ kind: "richText", path: ["body"] }, { kind: "link", path: ["link_label"], href: ["link_url"] },
		] },
		{ type: "site_feature", version: 1, fields: [] },
		{ type: "site_screenshot", version: 1, fields: [] },
		{ type: "site_workflow", version: 1, fields: [] },
		{ type: "site_control", version: 1, fields: [] },
		{ type: "site_closing", version: 1, fields: [
			{ kind: "heading", path: ["heading"], level: 2 }, { kind: "richText", path: ["body"] },
			{ kind: "link", path: ["link_label"], href: ["link_url"] },
		] },
	],
};

check("Home reads only displayed sections and preserves their semantic order", () => {
	const signals = project(home, homeMapping, "https://example.com/");
	assert.equal(signals.text, [
		"Content controls Inside the editor", "Review saved copy before publishing.",
		"Editors can check one page without a bulk scan.", "Read the guide", "Source repository", "Review content",
		"Structured data", "Describe the visible page.", "Answer common questions",
		"Keep reusable details with the saved page.", "Read the reference", "Schema guide",
		"Business details", "Keep public information accurate.", "Choose one page for the complete address.", "Business guide",
		"Try one page", "Keep a backup before changing the site.", "Removal guide",
	].join(" "));
	assert.deepEqual(signals.headings, [
		{ level: 1, text: "Content controls Inside the editor" },
		{ level: 2, text: "Structured data" }, { level: 3, text: "Answer common questions" },
		{ level: 2, text: "Business details" }, { level: 2, text: "Try one page" },
	]);
	assert.equal(signals.h1Count, 1);
	assert.equal(signals.links.length, 7);
	assert.equal(signals.internalLinkCount, 5);
	assert.equal(signals.externalLinkCount, 2);
	assert.deepEqual(signals.links.map(link => link.href), [
		"/docs/install", "https://example.org/source", "/docs/analysis", "https://reference.example/schema",
		"/docs/schema", "/docs/configure", "/docs/uninstall",
	]);
	assert.equal(signals.imageCount, 0, "social metadata and an unrendered screenshot are not body images");
	assert.equal(signals.text.includes("Excluded"), false);
	assert.equal(signals.text.includes("A complete feature description"), false);
	assert.equal(signals.text.includes("Reusable definitions"), false);
});

check("The same feature block can have a different explicit template projection", () => {
	const detailMapping: SeoBodyMapping = {
		collection: "pages", slugs: ["features"], bodyField: "content", blocks: [
			{ type: "site_feature", version: 1, fields: [
				{ kind: "heading", path: ["heading"], level: 2 }, { kind: "text", path: ["description"] },
				{ kind: "richText", path: ["body"] },
				{ kind: "group", path: ["items", "*"], fields: [{ kind: "text", path: ["label"] }] },
				{ kind: "text", path: ["note"] }, { kind: "link", path: ["link_label"], href: ["link_url"] },
			] },
		],
	};
	const data = { content: [feature] };
	const homeSignals = project(data, homeMapping, "https://example.com/");
	const detail = project(data, detailMapping, "https://example.com/features");
	assert.equal(homeSignals.text, [
		"Structured data", "Describe the visible page.", "Answer common questions",
		"Keep reusable details with the saved page.", "Read the reference", "Schema guide",
	].join(" "));
	assert.equal(detail.text, [
		"Structured data", "A complete feature description.", "Answer common questions",
		"Keep reusable details with the saved page.", "Read the reference", "Reusable definitions",
		"Saved entry overrides", "Only public pages are assessed.", "Schema guide",
	].join(" "));
	assert.equal(detail.text.includes("Describe the visible page"), false);
	assert.equal(homeSignals.text.includes("Reusable definitions"), false);
	assert.deepEqual(detail.headings, [{ level: 2, text: "Structured data" }, { level: 3, text: "Answer common questions" }]);
	assert.equal(detail.links.length, 2);
	assert.equal(detail.internalLinkCount, 1);
	assert.equal(detail.externalLinkCount, 1);
	assert.equal(detail.imageCount, 0);
	assert.equal(detail.text.includes("Excluded"), false);
});

const guide = {
	title: "Install the example extension", excerpt: "Use a separate site for the first trial.",
	seo: { title: "Excluded metadata title", description: "Excluded metadata description", image: "https://example.com/social.png" },
	content: [{
		_type: "guide_section", _version: 1, _key: "package", anchor: "package-status", heading: "Check the package",
		body: [
			{
				_type: "block", style: "normal",
				children: [{ _type: "span", text: "Read the " }, { _type: "span", text: "release notes", marks: ["release"] }, { _type: "span", text: " before changing the site." }],
				markDefs: [{ _key: "release", _type: "link", href: "https://example.org/releases" }],
			},
			{ _type: "block", style: "h3", children: [{ _type: "span", text: "Choose one package manager" }] },
			{ _type: "image", asset: { _ref: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, alt: "Screenshot of the saved checklist" },
		],
		steps: [{ text: "Keep the existing lockfile." }, { text: "Build the site copy." }],
		bullets: [{ text: "Use the tested host version." }], note: "Keep the old package for recovery.",
		code: "const excludedCode = 'Excluded command example';", label: "Excluded editor label",
		links: [{ label: "Configuration guide", href: "/docs/configure" }],
	}],
};

const guideMapping: SeoBodyMapping = {
	collection: "docs", bodyField: "content",
	fields: [{ kind: "heading", path: ["title"], level: 1 }, { kind: "text", path: ["excerpt"] }],
	blocks: [{ type: "guide_section", version: 1, fields: [
		{ kind: "heading", path: ["heading"], level: 2 }, { kind: "richText", path: ["body"] },
		{ kind: "group", path: ["steps", "*"], fields: [{ kind: "text", path: ["text"] }] },
		{ kind: "group", path: ["bullets", "*"], fields: [{ kind: "text", path: ["text"] }] },
		{ kind: "text", path: ["note"] },
		{ kind: "group", path: ["links", "*"], fields: [{ kind: "link", path: ["label"], href: ["href"] }] },
	] }],
};

check("A guide includes its displayed lead, lists, rich links and image alt without reading code or SEO fields", () => {
	const signals = project(guide, guideMapping, "https://example.com/docs/install");
	assert.equal(signals.text, [
		"Install the example extension", "Use a separate site for the first trial.", "Check the package",
		"Read the release notes before changing the site.", "Choose one package manager", "Keep the existing lockfile.",
		"Build the site copy.", "Use the tested host version.", "Keep the old package for recovery.", "Configuration guide",
	].join(" "));
	assert.deepEqual(signals.headings, [
		{ level: 1, text: "Install the example extension" }, { level: 2, text: "Check the package" },
		{ level: 3, text: "Choose one package manager" },
	]);
	assert.equal(signals.h1Count, 1);
	assert.deepEqual(signals.proseBlocks, [
		"Use a separate site for the first trial.", "Read the release notes before changing the site.",
		"Keep the existing lockfile.", "Build the site copy.", "Use the tested host version.",
		"Keep the old package for recovery.", "Configuration guide",
	]);
	assert.equal(signals.links.length, 2);
	assert.equal(signals.internalLinkCount, 1);
	assert.equal(signals.externalLinkCount, 1);
	assert.equal(signals.imageCount, 1);
	assert.equal(signals.imageAltCount, 1);
	assert.equal(signals.images[0]?.alt, "Screenshot of the saved checklist");
	assert.equal(signals.text.includes("Screenshot of the saved checklist"), false, "image alt is not body prose");
	assert.equal(signals.text.includes("Excluded"), false);
	assert.equal(signals.text.includes("https://"), false, "destinations remain link/image evidence rather than body words");
});

console.log(`\n${cases} site body projection checks passed.`);
