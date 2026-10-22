import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as contract from "../admin-contract.ts";
import { createSavedContentSnapshot, savedContentVersion, type SavedContentSnapshot } from "./saved-content-snapshot.ts";

const requireSource = createRequire(import.meta.url);
const selectedHost = process.env.SHIPIT_PUBLISHED_HOST;
assert.ok(selectedHost && isAbsolute(selectedHost), "Run this check through the selected published host.");
const requireHost = createRequire(pathToFileURL(join(selectedHost, "package.json")));
const ts: typeof import("typescript") = requireHost("typescript");

// Use the installed host's response parser without loading its editor components.
const hostEntry = requireHost.resolve("@emdash-cms/admin");
const parserImport = readFileSync(hostEntry, "utf8").match(/import\s*\{([^}]*\bparseApiResponse\b[^}]*)\}\s*from\s*"([^"]+)"/);
assert.ok(parserImport, "The installed host exports its real response parser");
const parserExport = parserImport[1].match(/(\w+)\s+as\s+parseApiResponse/)?.[1] ?? "parseApiResponse";
const hostApi = await import(new URL(parserImport[2], pathToFileURL(hostEntry)).href);
const parseApiResponse = hostApi[parserExport];
assert.equal(typeof parseApiResponse, "function");

type Transport = (url: string, init?: RequestInit) => Promise<Response>;
let transport: Transport = async () => { throw new Error("No transport fixture is active"); };
const host = { apiFetch: (url: string, init?: RequestInit) => transport(url, init), parseApiResponse };
function production(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const source = readFileSync(new URL(name, import.meta.url), "utf8");
	const compiled = ts.transpileModule(source, {
		fileName: name, reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
	});
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} };
	new Function("require", "module", "exports", compiled.outputText)((specifier: string) => {
		if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
		if (specifier === "@emdash-cms/admin") return host;
		if (specifier === "@shipitseo/emdash-plugin-seo/admin-contract") return contract;
		return requireSource(specifier);
	}, output, output.exports);
	return output.exports;
}
const parser = production("./contract.ts");
const { fetchSeoAdminEntryPreview, fetchSeoEntrySchemaPreview, SavedContentChangedError } = production("./api.ts", { "./contract.ts": parser }) as
	Pick<typeof import("./api.ts"), "fetchSeoAdminEntryPreview" | "fetchSeoEntrySchemaPreview" | "SavedContentChangedError">;

const ref = "posts:snapshot-example";
const contentUrl = "/_emdash/api/content/posts/snapshot-example";
const previewUrl = "/_emdash/api/plugins/shipit-seo/admin-entry-preview";
const item = {
	id: "snapshot-example", data: { title: "Bread guide", content: "Saved bread content." },
	slug: "bread-guide", updatedAt: "2026-10-17T10:00:00.000Z",
	seo: { title: "Bread guide", description: "A saved description.", image: null, canonical: null, noIndex: false },
};
const snapshot = createSavedContentSnapshot(ref, item);
function previewFor(value: SavedContentSnapshot = snapshot): contract.SeoAdminEntryPreview {
	return {
		contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, engineVersion: contract.SEO_ENGINE_VERSION,
		generatedAt: item.updatedAt, sourceKind: "saved-snapshot", sourceVersion: value.sourceVersion,
		content: { ref: value.ref, entryId: value.ref.slice(value.ref.indexOf(":") + 1), collection: "posts", collectionLabel: "Posts",
			title: "Bread guide", slug: value.slug ?? "" },
		search: { title: "Bread guide", description: "A saved description.", url: "https://example.test/" + value.slug,
			titleLength: 11, descriptionLength: 20 },
		social: { title: "Bread guide", description: "A saved description.", image: null,
			fallbackTitle: "Bread guide", fallbackDescription: "A saved description.",
			override: { title: null, description: null, updatedAt: null },
			editing: { state: "ready", snapshot: { ref: value.ref, revision: null, override: null } } },
		indexable: true, entryNoindex: false,
		canonicalValidation: { status: "matches", canonical: "https://example.test/" + value.slug, expectedPath: "/" + value.slug },
		localeGraph: { owner: "emdash-core", emitsMarkup: false, status: "single-locale", hostSupportsTranslationGroups: false,
			currentLocale: "en", defaultLocale: "en", translationGroup: null, discoveredLocales: ["en"], alternates: [], xDefaultLocale: "en", issues: [] },
		schemaTypes: [], sources: { title: "core-seo", description: "core-seo", socialTitle: "core-seo", socialDescription: "core-seo", canonical: "generated", image: "content" },
		outputSupport: contract.SEO_ADMIN_OUTPUT_SUPPORT,
	};
}
interface Step {
	url: string;
	method?: string;
	data?: unknown;
	status?: number;
	onRequest?: (init?: RequestInit) => void;
}
function fixture(steps: Step[]) {
	const calls: Array<{ url: string; method: string; body: unknown }> = [];
	transport = async (url, init) => {
		init?.signal?.throwIfAborted();
		const step = steps[calls.length];
		assert.ok(step, "No extra request: " + url);
		assert.equal(url, step.url);
		assert.equal(init?.method ?? "GET", step.method ?? "GET");
		calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
		step.onRequest?.(init);
		return new Response(JSON.stringify({ data: step.data }), { status: step.status ?? 200, headers: { "Content-Type": "application/json" } });
	};
	return { calls, done: () => assert.equal(calls.length, steps.length, "Only the existing request sequence is used") };
}
const content = (value: unknown = item): Step => ({ url: contentUrl, data: { item: value } });
const resolved = (preview: unknown = previewFor()): Step => ({ url: previewUrl, method: "POST", data: { success: true, preview } });
async function rejects(steps: Step[], options: Parameters<typeof fetchSeoAdminEntryPreview>[2], message: RegExp) {
	const test = fixture(steps);
	let exposed: unknown;
	await assert.rejects(async () => {
		exposed = await fetchSeoAdminEntryPreview(ref, undefined, options);
	}, message);
	assert.equal(exposed, undefined, "A failed request cannot expose a retained raw snapshot");
	test.done();
}

{
	const test = fixture([content(), resolved(), content()]);
	const result = await fetchSeoAdminEntryPreview(ref, undefined, { entryOnly: true, savedVersion: snapshot.sourceVersion });
	assert.equal(result.success, true);
	if (!result.success) throw new Error("Expected a resolved preview");
	assert.deepEqual(result.savedSnapshot, snapshot);
	assert.deepEqual((test.calls[1].body as { snapshot: unknown }).snapshot, result.savedSnapshot,
		"The retained input is exactly the snapshot sent and verified");
	assert.deepEqual(test.calls.map((call) => call.url), [contentUrl, previewUrl, contentUrl]);
	test.done();
}
{
	const draftItem = { ...item, draftRevisionId: "draft-example" };
	const revision = { id: "draft-example", collection: "posts", entryId: item.id,
		data: { title: "Saved draft title", content: "Saved draft body.", _slug: "saved-draft", _private: "not content" } };
	const draftSnapshot = createSavedContentSnapshot(ref, draftItem, revision);
	const test = fixture([content(draftItem),
		{ url: "/_emdash/api/revisions/draft-example", data: { item: revision } },
		resolved(previewFor(draftSnapshot)), content(draftItem)]);
	const result = await fetchSeoAdminEntryPreview(ref, undefined, { entryOnly: true, savedVersion: savedContentVersion(draftItem) });
	assert.equal(result.success, true);
	if (!result.success) throw new Error("Expected a saved draft preview");
	assert.deepEqual(result.savedSnapshot, draftSnapshot);
	assert.equal(result.savedSnapshot?.data.content, "Saved draft body.");
	assert.equal(result.savedSnapshot?.slug, "saved-draft");
	assert.equal(Object.hasOwn(result.savedSnapshot!.data, "_private"), false);
	assert.deepEqual((test.calls[2].body as { snapshot: unknown }).snapshot, draftSnapshot);
	test.done();
}
await rejects([content({ ...item, id: "other" })], { entryOnly: true }, /Invalid saved content response/);
await rejects([content()], { entryOnly: true, savedVersion: "different-version" }, /Saved content changed/);
{
	// A newer saved entry is named, so the caller can refresh the host entry instead of retrying the same read.
	const test = fixture([content()]);
	const failure = await fetchSeoAdminEntryPreview(ref, undefined, { entryOnly: true, savedVersion: "shown-version" }).then(() => null, (error: unknown) => error);
	assert.ok(failure instanceof SavedContentChangedError);
	assert.equal(failure.sourceVersion, snapshot.sourceVersion);
	assert.equal(test.calls.some((call) => call.url === previewUrl), false, "nothing is resolved for a version the caller did not show");
	test.done();
}
await rejects([content(), resolved(previewFor({ ...snapshot, ref: "posts:other" }))],
	{ entryOnly: true }, /requestedRef/);
await rejects([content(), resolved({ ...previewFor(), sourceVersion: "different-version" })],
	{ entryOnly: true }, /savedSnapshot/);
await rejects([content(), resolved({ ...previewFor(), search: { ...previewFor().search, description: 7 } })],
	{ entryOnly: true }, /preview/);
await rejects([content(), resolved(), content({ ...item, updatedAt: "2026-10-17T10:01:00.000Z" })],
	{ entryOnly: true }, /Saved content changed or could not be verified/);
await rejects([content(), resolved(), { url: contentUrl, status: 404 }],
	{ entryOnly: true }, /Saved content changed or could not be verified/);
await rejects([content({ ...item, draftRevisionId: "draft-example" }),
	{ url: "/_emdash/api/revisions/draft-example", data: { item: { id: "draft-example", collection: "posts", entryId: "other", data: {} } } }],
	{ entryOnly: true }, /Invalid saved draft response/);
{
	const controller = new AbortController();
	controller.abort();
	await rejects([], { entryOnly: true, signal: controller.signal }, /aborted/);
}
{
	const controller = new AbortController();
	await rejects([content(), { ...resolved(), onRequest: () => controller.abort() }],
		{ entryOnly: true, signal: controller.signal }, /aborted/);
}
{
	const controller = new AbortController();
	await rejects([content(), resolved(), { ...content(), onRequest: () => controller.abort() }],
		{ entryOnly: true, signal: controller.signal }, /aborted/);
}
{
	const test = fixture([{ url: previewUrl, method: "POST", data: { success: true, preview: {
		...previewFor(), sourceKind: undefined, sourceVersion: undefined,
	} } }]);
	const result = await fetchSeoAdminEntryPreview(ref);
	assert.equal(result.success, true);
	assert.equal(Object.hasOwn(result, "savedSnapshot"), false, "Ordinary previews retain no raw client input");
	assert.deepEqual(test.calls[0].body, { ref });
	test.done();
}
{
	const test = fixture([content(), { url: previewUrl, method: "POST", data: { success: false, error: "not_found" } }]);
	const result = await fetchSeoAdminEntryPreview(ref, undefined, { entryOnly: true });
	assert.equal(result.success, false);
	assert.equal(Object.hasOwn(result, "savedSnapshot"), false);
	test.done();
}
// The schema prediction reuses the verified snapshot instead of hydrating it again.
const schemaUrl = "/_emdash/api/plugins/shipit-seo/entry-schema-preview";
const schemaItem = { ...item, locale: "en", version: 4, draftRevisionId: "saved-schema-draft" };
const schemaSnapshot = createSavedContentSnapshot(ref, schemaItem, { id: schemaItem.draftRevisionId, collection: "posts", entryId: item.id,
	data: { title: "test", content: "Saved draft body.", _slug: "test" } });
const schemaResponse: contract.SeoAdminEntrySchemaPreview = {
	contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, engineVersion: contract.SEO_ENGINE_VERSION, generatedAt: item.updatedAt, success: true,
	items: [{ id: "preset:blogPosting", source: "preset", presetKey: "blogPosting", name: "BlogPosting", types: ["BlogPosting"],
		disabled: false, emitted: true, suppressedReason: null, conflictId: null, replacesCore: true,
		graph: { "@type": "BlogPosting", headline: "test", "@id": "https://example.test/posts/test#article" } }],
};
const schemaOptions = { snapshot: schemaSnapshot, savedVersion: schemaSnapshot.sourceVersion, locale: "en" };
const schemaResult = (data: unknown = schemaResponse): Step => ({ url: schemaUrl, method: "POST", data });
async function schemaRejects(steps: Step[], options: Parameters<typeof fetchSeoEntrySchemaPreview>[1], message: RegExp) {
	const test = fixture(steps);
	let exposed: unknown;
	await assert.rejects(async () => { exposed = await fetchSeoEntrySchemaPreview(ref, options); }, message);
	assert.equal(exposed, undefined, "An unverified schema prediction is never exposed");
	test.done();
}
{
	const rawBefore = JSON.stringify(schemaSnapshot);
	const test = fixture([schemaResult(), content(schemaItem)]);
	const result = await fetchSeoEntrySchemaPreview(ref, schemaOptions);
	assert.deepEqual(result, schemaResponse);
	assert.deepEqual(test.calls[0].body, { ref, entryOnly: true, snapshot: schemaSnapshot });
	assert.equal((test.calls[0].body as { snapshot: SavedContentSnapshot }).snapshot.data.title, "test");
	assert.equal((test.calls[0].body as { snapshot: SavedContentSnapshot }).snapshot.slug, "test");
	assert.equal(schemaItem.data.title, "Bread guide", "The native base row still has the earlier published title");
	assert.equal(JSON.stringify(schemaSnapshot), rawBefore);
	assert.deepEqual(test.calls.map((call) => call.url), [schemaUrl, contentUrl],
		"One schema POST and bounded identity read; no new full snapshot or revision request");
	test.done();
}
for (const options of [undefined, {}, { ...schemaOptions, snapshot: null }, { ...schemaOptions, snapshot: { ...schemaSnapshot, ref: "posts:other" } },
	{ ...schemaOptions, savedVersion: "older" }, { ...schemaOptions, snapshot: { ...schemaSnapshot, sourceVersion: "" } },
	{ snapshot: schemaSnapshot, savedVersion: schemaSnapshot.sourceVersion }]) {
	await schemaRejects([], options, /Confirm the saved entry/);
}
for (const latest of [{ ...schemaItem, version: 5 }, { ...schemaItem, locale: "fr" }, { ...schemaItem, locale: undefined }, { ...schemaItem, seo: { ...item.seo, description: "Changed" } }]) {
	await schemaRejects([schemaResult(), content(latest)], schemaOptions, /Saved content changed or could not be verified/);
}
await schemaRejects([schemaResult(), { url: contentUrl, status: 404 }], schemaOptions, /Saved content changed or could not be verified/);
await schemaRejects([schemaResult({ ...schemaResponse, items: [{ id: "invalid" }] })], schemaOptions, /entrySchemaPreview.items/);
{
	const denied = { contractVersion: contract.SEO_ADMIN_CONTRACT_VERSION, engineVersion: contract.SEO_ENGINE_VERSION, success: false, error: "not_found" };
	const test = fixture([schemaResult(denied)]);
	assert.deepEqual(await fetchSeoEntrySchemaPreview(ref, schemaOptions), denied);
	test.done();
}
{
	const controller = new AbortController();
	controller.abort();
	await schemaRejects([], { ...schemaOptions, signal: controller.signal }, /aborted/);
}
{
	const controller = new AbortController();
	await schemaRejects([{ ...schemaResult(), onRequest: () => controller.abort() }],
		{ ...schemaOptions, signal: controller.signal }, /aborted/);
}
{
	const controller = new AbortController();
	await schemaRejects([schemaResult(), { ...content(schemaItem), onRequest: () => controller.abort() }],
		{ ...schemaOptions, signal: controller.signal }, /aborted/);
}
console.log("Entry preview snapshot self-check passed: real API/parser, correlated saved draft, bounded schema readback and failure/abort isolation.");
