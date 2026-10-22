import assert from "node:assert/strict";
import { extractSeoDocumentText, extractSeoDocumentSignals } from "./document-signals.ts";

const portable = [
	{ _type: "block", children: [
		{ _type: "span", text: "Dent" }, { _type: "span", text: "al", marks: ["strong"] },
		{ _type: "span", text: "\nimplants" },
	], markDefs: [{ _type: "link", href: "https://metadata.invalid", title: "Not document text" }] },
	{ _type: "block", style: "h2", children: [{ _type: "span", text: "Aftercare" }] },
];
const tiptap = { type: "doc", content: [
	{ type: "paragraph", attrs: { title: "Not document text" }, content: [
		{ type: "text", text: "Dent" },
		{ type: "text", text: "al", marks: [{ type: "bold" }] },
		{ type: "hardBreak" },
		{ type: "link", attrs: { href: "https://metadata.invalid" }, content: [{ type: "text", text: "implants" }] },
	] },
	{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Aftercare" }] },
] };
for (const document of [portable, tiptap]) {
	assert.equal(extractSeoDocumentText(document), "Dental\nimplants Aftercare");
	assert.equal(extractSeoDocumentSignals(document).text, "Dental implants Aftercare");
}
assert.equal(extractSeoDocumentText("  Plain\ntext  "), "  Plain\ntext  ");
assert.equal(extractSeoDocumentText([{ _type: "block", children: [{ _type: "span", text: "first" }] },
	{ _type: "block", children: [{ _type: "span", text: "second" }] }]), "first second");

const metadata = { type: "protocol-result", payload: { text: "Not prose" }, metadata: { description: "Not prose" } };
Object.defineProperty(metadata, "attrs", { get() { throw new Error("Attributes must not be read"); } });
Object.defineProperty(metadata, "extra", { get() { throw new Error("Unrelated fields must not be read"); } });
assert.equal(extractSeoDocumentText(metadata), "");
const withIgnoredMetadata = {
	type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Visible text" }] }],
	metadata: null as unknown,
};
withIgnoredMetadata.metadata = withIgnoredMetadata;
assert.equal(extractSeoDocumentText(withIgnoredMetadata), "Visible text");
for (const empty of [null, undefined, false, 42, {}, [], { type: "image", attrs: { alt: "Image metadata" } }]) {
	assert.equal(extractSeoDocumentText(empty), "");
}
console.log("Document text: inline words, breaks, block separation and metadata exclusion passed.");
