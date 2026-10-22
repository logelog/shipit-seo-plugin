import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import * as previewIcons from "@phosphor-icons/react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_OUTPUT_SUPPORT,
	SEO_ADMIN_OWNERSHIP_FIELDS,
	SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminEntryPreview,
	type SeoAdminOwnershipFieldState,
	type SeoAdminSocialOverrideSnapshot,
} from "../admin-contract.ts";
import { buildSavedSearchPreviewModel } from "./content-extension-model.ts";
import { createNativeSeoEditorController } from "./native-seo-editor-controller.ts";
import {
	canSaveNativeSeoValues,
	createNativeSeoEditorState,
	updateNativeSeoDraft,
	type NativeSeoDraft,
	type NativeSeoEditorState,
	type NativeSeoTarget,
	type NativeSeoValues,
} from "./native-seo-editor-state.ts";
import { buildNativeSeoSearchPreview, buildNativeSeoSocialPreview } from "./native-seo-editor-preview.ts";
import { createSerpPreviewModel, type SerpPreviewModel } from "./serp-preview-model.ts";
import { buildSocialEditorPreview } from "./social-editor-preview.ts";
import { createSocialSaveState } from "./social-save-state.ts";

const target: NativeSeoTarget = {
	principal: { id: "fixture-editor", role: 40 }, collection: "posts", entryId: "entry-a", locale: "nl",
};
const socialTarget = { ref: "posts:entry-a", locale: "nl" };
const nativeValues: NativeSeoValues = {
	title: "Native saved title", description: "Native saved description", image: "/_emdash/api/media/file/saved.jpg",
};
const socialSnapshot: SeoAdminSocialOverrideSnapshot = {
	ref: socialTarget.ref, revision: "social-revision-a", override: {
		storageVersion: SEO_ADMIN_SOCIAL_OVERRIDE_STORAGE_VERSION, ref: socialTarget.ref,
		title: "Saved Social title", description: "Saved Social description", updatedAt: "2026-10-17T12:00:00.000Z",
	},
};
const preview: SeoAdminEntryPreview = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, generatedAt: "2026-10-17T12:00:00.000Z",
	content: { ref: socialTarget.ref, entryId: target.entryId, collection: "posts", collectionLabel: "Posts", title: "Content title", slug: "fixture" },
	search: { title: "Last-loaded resolved search title", description: "Last-loaded resolved description",
		fallbackTitle: "Inherited title template", fallbackDescription: "Inherited description template",
		url: "https://example.invalid/nl/fixture", titleLength: 33, descriptionLength: 32 },
	social: { editing: { state: "ready", snapshot: socialSnapshot },
		title: "Saved Social title", description: "Saved Social description", image: "https://example.invalid/last-loaded.jpg",
		fallbackTitle: "Inherited Social title", fallbackDescription: "Inherited Social description",
		override: { title: socialSnapshot.override!.title, description: socialSnapshot.override!.description, updatedAt: socialSnapshot.override!.updatedAt } },
	indexable: true, entryNoindex: false,
	canonicalValidation: { status: "matches", canonical: "https://example.invalid/nl/fixture", expectedPath: "/nl/fixture" },
	localeGraph: { owner: "emdash-core", emitsMarkup: false, status: "single-locale", hostSupportsTranslationGroups: true,
		currentLocale: "nl", defaultLocale: "nl", translationGroup: null, discoveredLocales: ["nl"], alternates: [], xDefaultLocale: null, issues: [] },
	schemaTypes: [], outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
	sources: { title: "core-seo", description: "core-seo", canonical: "core-seo", socialTitle: "plugin-social-override", socialDescription: "plugin-social-override", image: "core-seo" },
};
function state(patch: NativeSeoDraft = {}, owner = target): NativeSeoEditorState {
	return updateNativeSeoDraft(createNativeSeoEditorState(owner, { target: owner, revision: "native-revision-a", values: nativeValues }), patch);
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) freeze(child);
	}
	return value;
}
const field = (value: string | null, source: string, unavailable = false) => ({ value, source, unavailable });
const datePrefix = "17 Oct 2026 -";
function search(device: "desktop" | "mobile" = "mobile") {
	return createSerpPreviewModel({ device, datePrefix, saved: {
		title: field(preview.search.title, "core-seo"), description: field(preview.search.description, "template"),
		permalink: field("https://example.invalid/nl/public-route", "generated"),
		canonical: field(preview.search.url, "core-seo"),
	} });
}
function social(platform: "facebook" | "x" = "facebook", draft: { customizing: boolean; title?: string; description?: string } | null = null) {
	return buildSocialEditorPreview({
		target: socialTarget, state: createSocialSaveState(socialTarget, { state: "ready", snapshot: socialSnapshot }),
		draft, loaded: { target: socialTarget, preview }, platform,
	});
}
let cases = 0;
function check(_name: string, run: () => void) { run(); cases += 1; }

check("unmodified, unowned or irrelevant native fields retain exact base identity", () => {
	const base = search();
	for (const value of [null, state(), state({ title: nativeValues.title }), state({ image: "/_emdash/api/media/file/new.jpg" })]) {
		assert.equal(buildNativeSeoSearchPreview(base, preview, value, ["title", "description"], datePrefix), base);
	}
	assert.equal(buildNativeSeoSearchPreview(base, preview, state({ title: "Local title" }), [], datePrefix), base);
	const shared = social();
	for (const value of [null, state(), state({ image: nativeValues.image }), state({ title: "Local title", description: "Local description" })]) {
		assert.equal(buildNativeSeoSocialPreview(shared, value, ["image"], socialTarget), shared);
	}
	assert.equal(buildNativeSeoSocialPreview(shared, state({ image: null }), [], socialTarget), shared);
});

check("native text is a local fitted preview and preserves device, full originals and both URL owners", () => {
	for (const device of ["desktop", "mobile"] as const) {
		const base = freeze(search(device));
		const local = freeze(state({ title: "Planning your first dental visit ".repeat(5).trim(), description: "A local description with useful administrative details. ".repeat(6).trim() }));
		const originalBase = JSON.stringify(base); const originalState = JSON.stringify(local);
		const updated = buildNativeSeoSearchPreview(base, preview, local, ["title", "description"], datePrefix);
		assert.equal(updated.title.value, local.draft.title);
		assert.equal(updated.description.value, local.draft.description);
		assert.equal(updated.title.state, "draft"); assert.equal(updated.description.state, "draft");
		assert.equal(updated.title.source, "Native SEO draft");
		assert.equal(updated.description.source, "Native SEO draft");
		assert.equal(updated.device, device); assert.equal(updated.profile, base.profile);
		assert.equal(updated.permalink, base.permalink); assert.equal(updated.canonical, base.canonical);
		assert.equal(updated.displayUrl, base.displayUrl); assert.equal(updated.isDraft, true);
		const expected = createSerpPreviewModel({ device, datePrefix, saved: {
			title: field(local.draft.title!, "Native SEO draft"), description: field(local.draft.description!, "Native SEO draft"),
			permalink: field(base.permalink.value, base.permalink.source), canonical: field(base.canonical.value, base.canonical.source),
		} });
		assert.deepEqual(updated.fittedTitle, expected.fittedTitle);
		assert.deepEqual(updated.fittedDescription, expected.fittedDescription);
		assert.equal(JSON.stringify(base), originalBase); assert.equal(JSON.stringify(local), originalState);
	}
});

check("text changes preserve an existing independent draft and untouched fitted text", () => {
	const base = createSerpPreviewModel({ device: "mobile", datePrefix, saved: {
		title: field("Saved title", "core-seo"), description: field("Saved description", "core-seo"),
		permalink: field("https://example.invalid/page", "generated"), canonical: field(preview.search.url, "core-seo"),
	}, draft: { title: field("Separate local title", "Existing draft source"), permalink: field("https://example.invalid/draft-route", "Existing route draft") } });
	const updated = buildNativeSeoSearchPreview(base, preview, state({ description: "Native description draft" }), ["description"], datePrefix);
	assert.equal(updated.title, base.title); assert.equal(updated.fittedTitle, base.fittedTitle);
	assert.equal(updated.permalink, base.permalink); assert.equal(updated.permalink.state, "draft");
	assert.equal(updated.description.value, "Native description draft");
});

check("clearing native text uses only reported inheritance and never guesses a missing fallback", () => {
	const base = search();
	const clear = state({ title: "  ", description: null });
	const inherited = buildNativeSeoSearchPreview(base, preview, clear, ["title", "description"], datePrefix);
	assert.equal(inherited.title.value, preview.search.fallbackTitle);
	assert.equal(inherited.description.value, preview.search.fallbackDescription);
	assert.equal(inherited.title.state, "draft");
	assert.equal(inherited.title.source, "Native SEO inherited fallback");
	const unknown = buildNativeSeoSearchPreview(base, { ...preview, search: { ...preview.search, fallbackTitle: undefined, fallbackDescription: undefined } }, clear, ["title", "description"], datePrefix);
	assert.equal(unknown.title.value, null); assert.equal(unknown.title.state, "unavailable");
	assert.equal(unknown.description.value, null); assert.equal(unknown.description.state, "unavailable");
	assert.equal(unknown.isDraft, true);
	assert.equal(unknown.canonical, base.canonical);
});

check("foreign identities, incoherent baselines and invalid fields fail closed independently", () => {
	const base = search();
	const foreign = state({ title: "Wrong entry" }, { ...target, entryId: "entry-b" });
	assert.equal(buildNativeSeoSearchPreview(base, preview, foreign, ["title"], datePrefix), base);
	assert.equal(buildNativeSeoSearchPreview(base, { ...preview, content: { ...preview.content, ref: "pages:entry-a" } }, state({ title: "Local" }), ["title"], datePrefix), base);
	const valid = state({ title: "Local" });
	const incoherent = { ...valid, baseline: { ...valid.baseline!, target: { ...target, locale: "en" } } };
	assert.equal(buildNativeSeoSearchPreview(base, preview, incoherent, ["title"], datePrefix), base);
	assert.equal(buildNativeSeoSearchPreview(base, preview, state({ title: "x".repeat(201) }), ["title"], datePrefix), base);
	const mixed = buildNativeSeoSearchPreview(base, preview, state({ title: "x".repeat(201), description: "Valid local description" }), ["title", "description"], datePrefix);
	assert.equal(mixed.title, base.title); assert.equal(mixed.fittedTitle, base.fittedTitle);
	assert.equal(mixed.description.value, "Valid local description");
	const wrongType = state({ title: false } as unknown as NativeSeoDraft);
	assert.equal(buildNativeSeoSearchPreview(base, preview, wrongType, ["title"], datePrefix), base);
});

check("native image drafts preserve Social text drafts, fitted text, URL and Social save context", () => {
	for (const platform of ["facebook", "x"] as const) {
		const base = freeze(social(platform, { customizing: true, title: "Local plugin Social title", description: "Local plugin Social description" }));
		const local = freeze(state({ image: "/_emdash/api/media/file/new.jpg", title: "Must not replace Social text" }));
		const oldBase = JSON.stringify(base); const oldState = JSON.stringify(local);
		const updated = buildNativeSeoSocialPreview(base, local, ["image", "title"], socialTarget);
		assert.equal(updated.model.fields.image.value, "/_emdash/api/media/file/new.jpg");
		assert.equal(updated.model.fields.image.state, "draft");
		assert.equal(updated.model.fields.image.source, "Native SEO image draft");
		assert.equal(updated.model.imageState, "available");
		assert.equal(updated.model.fields.title, base.model.fields.title);
		assert.equal(updated.model.fields.description, base.model.fields.description);
		assert.equal(updated.model.fields.url, base.model.fields.url);
		assert.equal(updated.model.fittedTitle, base.model.fittedTitle);
		assert.equal(updated.model.fittedDescription, base.model.fittedDescription);
		assert.equal(updated.model.profile, base.model.profile);
		assert.equal(updated.fieldBasis.title, "local"); assert.equal(updated.fieldBasis.description, "local");
		assert.equal(updated.fieldBasis.url, base.fieldBasis.url); assert.equal(updated.fieldBasis.image, "local");
		assert.equal(updated.context, base.context, "native image preview must not alter Social CAS admission or uncertainty");
		assert.equal(updated.caption, "Unsaved sharing image. Sharing text is unsaved.");
		assert.equal(updated.model.isDraft, true);
		assert.equal(JSON.stringify(base), oldBase); assert.equal(JSON.stringify(local), oldState);
	}
});

check("a cleared image without a reported fallback stays unavailable rather than exposing a guessed featured image", () => {
	const base = social();
	const updated = buildNativeSeoSocialPreview(base, state({ image: null }), ["image"], socialTarget);
	assert.equal(updated.model.imageState, "unavailable");
	assert.equal(updated.model.fields.image.state, "unavailable");
	assert.equal(updated.model.fields.image.value, null);
	assert.equal(updated.fieldBasis.image, "unavailable");
	assert.equal(updated.caption, "Unsaved sharing image.", "the image field's status line alone says what shows after saving");
	assert.equal(updated.model.fields.title, base.model.fields.title);
	assert.equal(updated.model.fields.url, base.model.fields.url);
	assert.equal(updated.context, base.context);
	assert.equal(base.model.fields.image.value, preview.social.image);
});

check("an image draft cannot turn unavailable sharing metadata into confirmed text or URL", () => {
	const base = buildSocialEditorPreview({ target: socialTarget, state: createSocialSaveState(socialTarget, { state: "ready", snapshot: socialSnapshot }),
		draft: null, loaded: null, platform: "facebook" });
	const updated = buildNativeSeoSocialPreview(base, state({ image: "/_emdash/api/media/file/new.jpg" }), ["image"], socialTarget);
	assert.equal(updated.model.fields.url, base.model.fields.url);
	assert.equal(updated.model.fields.url.state, "unavailable");
	assert.equal(updated.fieldBasis.url, "unavailable");
	assert.match(updated.caption, /The page address could not be read\./);
	assert.doesNotMatch(updated.caption, /last-loaded/);
	assert.equal(updated.context, base.context);
});

check("a cleared image previews the reported fallback as an unsaved change, never as a read error", () => {
	const base = social();
	for (const [fallback, imageState] of [
		[{ value: "/_emdash/api/media/file/featured.jpg", source: "content" }, "available"],
		[{ value: "https://example.invalid/site.jpg", source: "site-default" }, "available"],
		[{ value: null, source: "site-default" }, "missing"],
	] as const) {
		const updated = buildNativeSeoSocialPreview(base, state({ image: null }), ["image"], socialTarget, fallback);
		assert.equal(updated.model.imageState, imageState);
		assert.equal(updated.model.fields.image.state, "draft", "the revealed image is marked as pending save");
		assert.equal(updated.model.fields.image.value, fallback.value);
		assert.equal(updated.fieldBasis.image, "local");
		assert.equal(updated.caption, "Unsaved sharing image.", "the image field's status line alone says what sharing uses after saving");
		assert.doesNotMatch(updated.caption, /could not be read|last-loaded|cleared|After saving/);
		assert.equal(updated.model.fields.title, base.model.fields.title);
		assert.equal(updated.context, base.context);
	}
	const chosen = buildNativeSeoSocialPreview(base, state({ image: "/_emdash/api/media/file/new.jpg" }), ["image"], socialTarget,
		{ value: "/_emdash/api/media/file/featured.jpg", source: "content" });
	assert.equal(chosen.model.fields.image.value, "/_emdash/api/media/file/new.jpg", "a chosen image is shown, not the fallback");
});

check("native image preview refuses entry, locale, ownership, invalid URL and existing target mismatches", () => {
	const base = social(); const valid = state({ image: "/_emdash/api/media/file/new.jpg" });
	for (const targetValue of [{ ...socialTarget, ref: "posts:entry-b" }, { ...socialTarget, locale: "en" }]) {
		assert.equal(buildNativeSeoSocialPreview(base, valid, ["image"], targetValue), base);
	}
	assert.equal(buildNativeSeoSocialPreview(base, valid, [], socialTarget), base);
	for (const image of ["javascript:alert(1)", "x".repeat(4_097)]) {
		assert.equal(buildNativeSeoSocialPreview(base, state({ image }), ["image"], socialTarget), base);
	}
	const wrongBaseline = { ...valid, baseline: { ...valid.baseline!, target: { ...target, entryId: "entry-b" } } };
	assert.equal(buildNativeSeoSocialPreview(base, wrongBaseline, ["image"], socialTarget), base);
	const mismatched = { ...base, context: { ...base.context, targetMismatch: true } };
	assert.equal(buildNativeSeoSocialPreview(mismatched, valid, ["image"], socialTarget), mismatched);
});

// The card during a review after a refused save: the real controller, saved preview builder and card component.
const cardSource = readFileSync(new URL("./search-social-preview.tsx", import.meta.url), "utf8");
const cardCompiled = ts.transpileModule(cardSource, {
	fileName: "search-social-preview.tsx", reportDiagnostics: true,
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.deepEqual(cardCompiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const cardModule = { exports: {} as {
	SearchPreview: (props: { model: SerpPreviewModel; presentation?: "native"; descriptionDisplay?: "full" }) => ReactElement;
} };
const requireCard = createRequire(import.meta.resolve("react"));
new Function("require", "module", "exports", cardCompiled.outputText)(
	(name: string) => name === "@phosphor-icons/react" ? previewIcons : requireCard(name), cardModule, cardModule.exports);
const card = (model: SerpPreviewModel) => renderToStaticMarkup(createElement(cardModule.exports.SearchPreview,
	{ model, presentation: "native", descriptionDisplay: "full" }));

type TextField = "title" | "description";
function ownedPreview(states: Partial<Record<TextField, SeoAdminOwnershipFieldState>> = {},
	patch: { status?: "current" | "stale"; locale?: string | null; core?: Partial<NativeSeoValues> } = {}): SeoAdminEntryPreview {
	const core: NativeSeoValues = { ...nativeValues, ...patch.core };
	return {
		...preview,
		search: { ...preview.search, title: core.title ?? preview.search.fallbackTitle!, description: core.description ?? preview.search.fallbackDescription! },
		sources: { ...preview.sources, title: "core-seo", description: "core-seo" },
		ownership: {
			status: patch.status ?? "current", reason: null, sourceVersion: "saved-version-a",
			locale: patch.locale === undefined ? target.locale : patch.locale, record: null,
			fields: SEO_ADMIN_OWNERSHIP_FIELDS.map((name) => {
				const value = name === "title" || name === "description" || name === "image" ? core[name] : name === "noIndex" ? false : null;
				const state = (name === "title" || name === "description" ? states[name] : undefined) ?? "not-shadowed";
				return { field: name, state, core: value, legacy: null, effective: value, effectiveSource: "core-seo", social: null };
			}),
			unsupportedDirectives: { state: "none", tokens: [] },
		},
	};
}
class FixtureApiError extends Error {
	readonly status: number;
	readonly code: string | undefined = undefined;
	constructor(status: number) { super("Fixture request refused"); this.status = status; }
}
/** Context A edits, another context saves first, A's save is refused and A checks the saved values. */
async function reviewFlow(otherContext: Partial<NativeSeoValues>, draft: NativeSeoDraft = { title: "Local title draft" }) {
	let stored: NativeSeoValues = { ...nativeValues };
	let counter = 1;
	const writes: unknown[] = [];
	const entry = () => ({ id: target.entryId, type: target.collection, locale: target.locale,
		_rev: btoa(`${counter}:2026-10-17T12:00:00.000Z`), seo: { ...stored, canonical: null, noIndex: false } });
	const store = createNativeSeoEditorController(target, {
		fetchContent: async () => entry(),
		updateContent: async (_collection, _id, input) => {
			writes.push(input);
			const body = input as unknown as { seo: NativeSeoDraft; _rev: string };
			if (body._rev !== entry()._rev) throw new FixtureApiError(409);
			stored = { ...stored, ...body.seo }; counter += 1;
			return entry();
		},
		ApiResponseError: FixtureApiError as never,
		clock: { now: () => 0, setTimeout: () => null, clearTimeout() {} },
	});
	await store.read();
	store.change(draft);
	stored = { ...stored, ...otherContext }; counter += 1;
	await store.save();
	const refused = store.getSnapshot();
	assert.equal(refused.phase, "conflict", "the refused save opens the review");
	await store.read();
	const state = store.getSnapshot();
	assert.ok(state.phase === "conflict" && state.reviewSnapshot, "the check reads the newer saved values for review");
	return { state, refused, writes };
}
async function checkAsync(_name: string, run: () => Promise<void>) { await run(); cases += 1; }

await checkAsync("an open review shows the reviewed saved values as saved, not the last-loaded text or the draft", async () => {
	const other = { description: "Description saved in another context." };
	const { state, writes } = await reviewFlow(other);
	const owned = ownedPreview();
	for (const device of ["mobile", "desktop"] as const) {
		const base = buildSavedSearchPreviewModel(owned, device, datePrefix);
		const before = JSON.stringify(state);
		// The hook offers no editable field during a review; the card does not depend on that.
		for (const allowed of [[], ["title", "description", "image"]] as const) {
			const model = buildNativeSeoSearchPreview(base, owned, state, allowed, datePrefix);
			assert.equal(model.description.value, other.description, "the description the fields and the review list show");
			assert.equal(model.description.state, "saved"); assert.equal(model.description.source, "core-seo");
			assert.equal(model.title, base.title, "a title the other context left alone keeps the reported text");
			assert.equal(model.isDraft, false);
			assert.equal(model.device, device); assert.equal(model.canonical, base.canonical);
			assert.deepEqual(model.fittedDescription, createSerpPreviewModel({ device, datePrefix, saved: {
				title: field(base.title.value, base.title.source), description: field(other.description, "core-seo"),
				permalink: field(base.permalink.value, base.permalink.source, base.permalink.state === "unavailable"),
				canonical: field(base.canonical.value, base.canonical.source),
			} }).fittedDescription);
			const html = card(model);
			assert.match(html, /Saved values/);
			assert.ok(html.includes(other.description), "the card reads the reviewed description");
			assert.ok(!html.includes(nativeValues.description!), "the pre-conflict saved description is gone");
			assert.ok(!html.includes("Local title draft"), "the kept draft is not previewed as saved");
			assert.doesNotMatch(html, /Unsaved changes|Local preview/);
		}
		assert.equal(JSON.stringify(state), before, "building the card leaves the review untouched");
	}
	assert.equal(canSaveNativeSeoValues(state), false, "the review still admits no write");
	assert.equal(writes.length, 1, "only the refused save was sent");
});

await checkAsync("a reviewed title and a reviewed cleared description resolve as saved text and reported inheritance", async () => {
	const { state } = await reviewFlow({ title: "Title saved in another context", description: null }, { description: "Local description draft" });
	const owned = ownedPreview();
	const model = buildNativeSeoSearchPreview(buildSavedSearchPreviewModel(owned, "mobile", datePrefix), owned, state, [], datePrefix);
	assert.deepEqual([model.title.value, model.title.state], ["Title saved in another context", "saved"]);
	assert.deepEqual([model.description.value, model.description.state], [owned.search.fallbackDescription, "saved"]);
	assert.equal(model.isDraft, false);
	assert.ok(card(model).includes("Title saved in another context"));
	const unknown = { ...owned, search: { ...owned.search, fallbackDescription: undefined } };
	const unreported = buildNativeSeoSearchPreview(buildSavedSearchPreviewModel(unknown, "mobile", datePrefix), unknown, state, [], datePrefix);
	assert.deepEqual([unreported.description.value, unreported.description.state], [null, "unavailable"], "a missing fallback is never guessed");
});

await checkAsync("a review keeps the reported text where a legacy record decides, facts are not current or the card already describes it", async () => {
	const other = { title: "Title saved in another context", description: "Description saved in another context." };
	const { state, refused } = await reviewFlow(other);
	for (const owned of [
		ownedPreview({ title: "conflict", description: "equal" }), ownedPreview({ title: "unknown", description: "unknown" }),
		ownedPreview({}, { status: "stale" }), ownedPreview({}, { locale: "en" }), { ...ownedPreview(), ownership: undefined },
		ownedPreview({}, { core: other }),
	]) {
		const base = buildSavedSearchPreviewModel(owned, "mobile", datePrefix);
		assert.equal(buildNativeSeoSearchPreview(base, owned, state, [], datePrefix), base);
	}
	const owned = ownedPreview();
	const base = buildSavedSearchPreviewModel(owned, "mobile", datePrefix);
	assert.equal(refused.reviewSnapshot, null);
	assert.equal(buildNativeSeoSearchPreview(base, owned, refused, [], datePrefix), base, "nothing is under review before the check");
	const foreign = { ...state, reviewSnapshot: { ...state.reviewSnapshot!, target: { ...target, entryId: "entry-b" } } };
	assert.equal(buildNativeSeoSearchPreview(base, owned, foreign, [], datePrefix), base);
});

console.log(`Native SEO draft preview self-check passed (${cases} checks). Browser layout, native persistence and published metadata are not exercised.`);
