import assert from "node:assert/strict";
import { createSerpPreviewModel } from "./serp-preview-model.ts";
import type { SerpPreviewMetadata } from "./serp-preview-model.ts";

const saved: SerpPreviewMetadata = {
	title: { value: "Een resolved template | Voorbeeld", source: "template" },
	description: { value: "Legacy description with its own precedence.", source: "legacy-override" },
	permalink: { value: "https://site.example/blog/original/", source: "content" },
	canonical: { value: "https://external.example/custom/path?lang=nl", source: "core-seo" },
};
const model = createSerpPreviewModel({ device: "desktop", saved });
assert.equal(model.title.value, saved.title.value);
assert.equal(model.title.source, "template");
assert.equal(model.title.state, "saved");
assert.equal(model.description.source, "legacy-override");
assert.equal(model.isDraft, false);
const incidentalDirty = { title: undefined, isDirty: true };
assert.equal(createSerpPreviewModel({ device: "desktop", saved, draft: incidentalDirty }).isDraft, false);
assert.equal(model.canonical.value, "https://external.example/custom/path?lang=nl");
assert.equal(model.displayUrl, model.canonical.value);
assert.notEqual(model.permalink.value, model.canonical.value);

const slugOnly = createSerpPreviewModel({
	device: "desktop", saved,
	draft: { permalink: { value: "https://site.example/blog/new-slug/", source: "content" } },
});
assert.deepEqual(slugOnly.title, model.title);
assert.deepEqual(slugOnly.description, model.description);
assert.deepEqual(slugOnly.canonical, model.canonical);
assert.equal(slugOnly.permalink.state, "draft");
assert.equal(slugOnly.isDraft, true);
const titleOnly = createSerpPreviewModel({
	device: "mobile", saved,
	draft: { title: { value: "Explicit SEO draft", source: "core-seo" } },
});
assert.equal(titleOnly.title.value, "Explicit SEO draft");
assert.equal(titleOnly.title.source, "core-seo");
assert.equal(titleOnly.title.state, "draft");
assert.deepEqual(titleOnly.description, model.description);
const cleared = createSerpPreviewModel({
	device: "desktop", saved,
	draft: { title: { value: "Resolved fallback", source: "template" } },
});
assert.equal(cleared.title.source, "template");
assert.equal(cleared.title.state, "draft");
const unresolved = createSerpPreviewModel({
	device: "desktop", saved,
	draft: { title: { value: null, source: "unresolved", unavailable: true } },
});
assert.equal(unresolved.title.state, "unavailable");
assert.equal(unresolved.title.value, null);
assert.equal(unresolved.isDraft, true);
assert.deepEqual(unresolved.description, model.description);

const long = { ...saved, title: { value: "Een contentaudit die tot beslissingen leidt ".repeat(20), source: "template" } };
const desktop = createSerpPreviewModel({ device: "desktop", saved: long });
const mobile = createSerpPreviewModel({ device: "mobile", saved: long });
assert.notDeepEqual(desktop.fittedTitle, mobile.fittedTitle);
assert.equal(desktop.profile.title.lineCount, 1);
assert.equal(mobile.profile.title.lineCount, 2);
// Outer layout is deliberately absent from the model's input contract.
const smallPanel = { device: "mobile" as const, saved: long, editorWidth: 226 };
const largePanel = { device: "mobile" as const, saved: long, editorWidth: 900 };
assert.deepEqual(createSerpPreviewModel(smallPanel), createSerpPreviewModel(largePanel));
const noCanonical = createSerpPreviewModel({
	device: "desktop", saved: { ...saved, canonical: { value: null, source: "unresolved", unavailable: true } },
});
assert.equal(noCanonical.displayUrl, null);
assert.equal(noCanonical.canonical.state, "unavailable");
assert.match(model.approximation, /Approximate/);
console.log("SERP preview: saved sources, field patches, independent URLs and fixed device budgets passed.");
