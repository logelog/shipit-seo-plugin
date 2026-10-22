import assert from "node:assert/strict";

import {
	SOCIAL_PREVIEW_PROFILES,
	buildSocialPreviewModel,
	type SocialPreviewFields,
	type SocialPreviewPlatform,
} from "./social-preview-model.ts";

const saved: SocialPreviewFields = {
	title: { value: "Saved social override", source: "plugin-social-override" },
	description: { value: "Independent OG description", source: "core-seo" },
	image: { value: "https://assets.example.test/old.jpg", source: "site-default" },
	url: { value: "https://external.example.test/custom/landing/?keep=%2F#section", source: "legacy-override" },
};
const savedBefore = structuredClone(saved);
const platforms: SocialPreviewPlatform[] = ["facebook", "x"];

for (const platform of platforms) {
	const model = buildSocialPreviewModel({ platform, saved });
	assert.deepEqual(model.fields.title, {
		value: "Saved social override", source: "plugin-social-override", state: "saved",
	}, "a saved social override must remain saved on either platform");
	assert.deepEqual(model.fields.description, {
		value: "Independent OG description", source: "core-seo", state: "saved",
	});
	assert.equal(model.fields.url.value, saved.url.value, "explicit external URLs keep their path, origin and encoding");
	assert.equal(model.fittedTitle.text, "Saved social override");
	assert.equal(model.fittedDescription.text, "Independent OG description");
	assert.equal(model.isDraft, false);
	assert.equal(model.imageState, "available");
}
assert.deepEqual(saved, savedBefore, "building a preview must leave the saved resolver fields intact");
assert.equal(buildSocialPreviewModel({ platform: "facebook", saved, draft: {} }).isDraft, false);
assert.equal(buildSocialPreviewModel({ platform: "facebook", saved, draft: { title: undefined } }).isDraft, false);

const slugOnly = buildSocialPreviewModel({
	platform: "facebook",
	saved,
	draft: { url: { value: "/stories/new-slug/index", source: "draft-permalink" } },
});
assert.deepEqual(slugOnly.fields.title, {
	value: "Saved social override", source: "plugin-social-override", state: "saved",
}, "a changed permalink must not replace independent social text");
assert.deepEqual(slugOnly.fields.description, {
	value: "Independent OG description", source: "core-seo", state: "saved",
});
assert.deepEqual(slugOnly.fields.url, {
	value: "/stories/new-slug/index", source: "draft-permalink", state: "draft",
});
assert.equal(slugOnly.isDraft, true);

const titleOnly = buildSocialPreviewModel({
	platform: "x",
	saved,
	draft: { title: { value: "Draft social title", source: "plugin-social-override" } },
});
assert.equal(titleOnly.fields.title.state, "draft");
assert.equal(titleOnly.fittedTitle.text, "Draft social title");
assert.equal(titleOnly.fields.description.value, saved.description.value);
assert.equal(titleOnly.fields.description.state, "saved");
assert.equal(titleOnly.fields.url.value, saved.url.value);

const descriptionOnly = buildSocialPreviewModel({
	platform: "facebook",
	saved,
	draft: { description: { value: "Resolved fallback after clearing", source: "template" } },
});
assert.deepEqual(descriptionOnly.fields.description, {
	value: "Resolved fallback after clearing", source: "template", state: "draft",
});
assert.equal(descriptionOnly.fields.title.value, saved.title.value);
assert.equal(descriptionOnly.fields.title.state, "saved");

const changedImage = buildSocialPreviewModel({
	platform: "facebook",
	saved,
	draft: { image: { value: "/_emdash/api/media/file/new.jpg", source: "core-seo" } },
});
assert.deepEqual(changedImage.fields.image, {
	value: "/_emdash/api/media/file/new.jpg", source: "core-seo", state: "draft",
}, "the shown image must carry its own source instead of the saved fallback badge");
assert.equal(changedImage.imageState, "available");
assert.equal(changedImage.fields.title.state, "saved");

const removedImage = buildSocialPreviewModel({
	platform: "x", saved, draft: { image: { value: null, source: "core-seo" } },
});
assert.deepEqual(removedImage.fields.image, { value: null, source: "core-seo", state: "draft" });
assert.equal(removedImage.imageState, "missing", "an explicit empty resolved image must not reuse the saved image");
assert.equal(removedImage.isDraft, true);
const fallbackImage = buildSocialPreviewModel({
	platform: "facebook", saved,
	draft: { image: { value: "https://example.test/featured.jpg", source: "content" } },
});
assert.equal(fallbackImage.fields.image.source, "content");
assert.equal(fallbackImage.imageState, "available");

const unavailableImage = buildSocialPreviewModel({
	platform: "facebook", saved,
	draft: { image: { value: "https://example.test/unreadable.jpg", source: "core-seo", unavailable: true } },
});
assert.equal(unavailableImage.fields.image.state, "unavailable");
assert.equal(unavailableImage.fields.image.source, "core-seo");
assert.equal(unavailableImage.fields.image.value, null);
assert.equal(unavailableImage.imageState, "unavailable", "unreadable media must remain distinct from an absent image");
assert.equal(unavailableImage.isDraft, true);
const savedUnavailable = buildSocialPreviewModel({
	platform: "x", saved: { ...saved, image: { value: null, source: "site-default", unavailable: true } },
});
assert.equal(savedUnavailable.imageState, "unavailable");
assert.equal(savedUnavailable.isDraft, false);
const savedMissing = buildSocialPreviewModel({
	platform: "x", saved: { ...saved, image: { value: null, source: "site-default" } },
});
assert.equal(savedMissing.imageState, "missing");
assert.equal(savedMissing.fields.image.state, "saved");

const clearedTitle = buildSocialPreviewModel({
	platform: "facebook", saved, draft: { title: { value: null, source: "content" } },
});
assert.equal(clearedTitle.fittedTitle.text, "");
assert.equal(clearedTitle.fields.title.state, "draft");
const unavailableTitle = buildSocialPreviewModel({
	platform: "x", saved, draft: { title: { value: "Old text", source: "template", unavailable: true } },
});
assert.equal(unavailableTitle.fittedTitle.text, "");
assert.equal(unavailableTitle.fields.title.state, "unavailable");
const missingUrl = buildSocialPreviewModel({
	platform: "facebook", saved, draft: { url: { value: null, source: "generated" } },
});
assert.equal(missingUrl.fields.url.value, null, "the model must not invent a public URL");

for (const text of [
	"Een website voor beslissingen",
	"İstanbul için doğru açıklama",
	"مرحبا بالعالم ومشاركة المحتوى",
	"Cafe\u0301 en familie \u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}",
]) {
	const model = buildSocialPreviewModel({
		platform: "facebook", saved: { ...saved, title: { value: text, source: "content" } },
	});
	assert.equal(model.fittedTitle.text, text, "short Unicode and RTL strings retain their logical order");
	assert.equal(model.fittedTitle.clipped, false);
}

const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}";
const families = buildSocialPreviewModel({
	platform: "facebook", saved: { ...saved, title: { value: family.repeat(100), source: "content" } },
});
assert.equal(families.fittedTitle.clipped, true);
assert.ok(families.fittedTitle.text.endsWith("\u2026"));
const familyPrefix = families.fittedTitle.text.slice(0, -1);
assert.equal(familyPrefix, family.repeat(familyPrefix.length / family.length), "clipping must not split joined emoji");
assert.ok(families.fittedTitle.lines.length <= 2);

const longWord = "W".repeat(100);
const facebookLong = buildSocialPreviewModel({
	platform: "facebook", saved: { ...saved, title: { value: longWord, source: "content" } },
});
const xLong = buildSocialPreviewModel({
	platform: "x", saved: { ...saved, title: { value: longWord, source: "content" } },
});
assert.equal(facebookLong.fittedTitle.clipped, true);
assert.equal(xLong.fittedTitle.clipped, true);
assert.ok(facebookLong.fittedTitle.lines.length <= 2);
assert.ok(xLong.fittedTitle.lines.length <= 2);
assert.ok(facebookLong.fittedTitle.text.length < xLong.fittedTitle.text.length,
	"the chosen font profile must determine the text budget");
assert.equal(facebookLong.fields.title.value, longWord, "fitting must not shorten the resolved metadata field");
const oversized = buildSocialPreviewModel({
	platform: "facebook", saved: { ...saved, description: { value: "W".repeat(100_000), source: "content" } },
});
assert.equal(oversized.fittedDescription.inputLimited, true);
assert.ok(oversized.fittedDescription.text.length < 200);
assert.ok(oversized.fittedDescription.lines.length <= 2);

assert.ok(Object.isFrozen(SOCIAL_PREVIEW_PROFILES));
for (const platform of platforms) {
	const profile = SOCIAL_PREVIEW_PROFILES[platform];
	assert.ok(Object.isFrozen(profile));
	assert.ok(Object.isFrozen(profile.title));
	assert.ok(Object.isFrozen(profile.description));
	assert.equal(profile.approximate, true);
	assert.equal(profile.imageAspectRatio, 1.91);
}
assert.match(SOCIAL_PREVIEW_PROFILES.x.caveat, /unverified/i);
