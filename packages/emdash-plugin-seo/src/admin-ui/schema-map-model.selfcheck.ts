import assert from "node:assert/strict";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminCustomSchema,
	type SeoAdminReadableSettings,
	type SeoAdminSchemaConfiguration,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { buildSchemaMapModel, type SchemaMapInput } from "./schema-map-model.ts";

function configuration(): SeoAdminSchemaConfiguration {
	return {
		contentTypes: { storageVersion: SEO_ADMIN_SCHEMA_CONTENT_TYPES_STORAGE_VERSION, updatedAt: null, revision: null, record: "absent", writable: true, discoveryAvailable: true, discoveredCount: 3, items: [
			{ collection: "posts", label: "Posts", role: "blogPosting", source: "default" },
			{ collection: "pages", label: "Pages", role: "webPage", source: "saved" },
			{ collection: "notes", label: "Notes", role: "none", source: "default" },
		], unlisted: [] },
		presets: { storageVersion: SEO_ADMIN_SCHEMA_PRESETS_STORAGE_VERSION, updatedAt: null, revision: null, record: "absent", writable: true, migrationNeeded: false,
			items: SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => ({ ...definition, enabled: definition.defaultEnabled })) },
		customSchemaStorageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		customSchemas: [], hasMore: false,
	};
}

function settings(): SeoAdminReadableSettings {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION, storageVersion: SEO_ADMIN_SETTINGS_STORAGE_VERSION, engineVersion: SEO_ENGINE_VERSION,
		state: "saved", updatedAt: null, revision: "settings-1", legacyGuard: null, legacyPresent: false, indexingPreferenceConfirmed: true,
		contentScoring: { state: "paused", revision: "score-1", intentEnabled: false, acknowledgedNoticeVersion: null, currentNoticeVersion: 1 },
		values: { siteName: "Dental practice", siteUrl: "https://dental.test", publisherType: "organization", organizationName: "Saved publisher", organizationLogo: "", personName: "", socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: false, contentScoringEnabled: false },
	};
}

function input(): SchemaMapInput {
	return { configuration: configuration(), outputEnabled: true, settings: settings(), publisherOutput: "automatic",
		publisher: { kind: "legacy", identity: "absent", refreshError: null, reading: false, selection: "settled" } };
}

function custom(id: string, scope: string, enabled = true, valid = true): SeoAdminCustomSchema {
	return { id, name: id, scope, json: '{"@type":"Thing","name":"{{title}}"}', enabled, valid, storageVersion: SEO_ADMIN_CUSTOM_SCHEMA_STORAGE_VERSION,
		types: ["Thing"], validationError: valid ? null : "Invalid JSON", createdAt: "2026-10-16T12:00:00.000Z", updatedAt: "2026-10-16T12:00:00.000Z" };
}

let cases = 0;
function check(name: string, run: () => void) { run(); cases += 1; }

check("a WebPage role remains eligible while the optional global WebPage preset is off", () => {
	const value = input();
	assert.equal(value.configuration.presets.items.find((item) => item.key === "webPage")!.enabled, false);
	let result = buildSchemaMapModel(value);
	assert.equal(result.builtIns.find((item) => item.id === "webPage")?.state, "off");
	assert.equal(result.contentTypes.find((item) => item.id === "pages")?.state, "eligible");
	value.configuration.presets.items.find((item) => item.key === "blogPosting")!.enabled = false;
	result = buildSchemaMapModel(value);
	assert.equal(result.contentTypes.find((item) => item.id === "posts")?.state, "off");
	assert.equal(result.contentTypes.find((item) => item.id === "notes")?.status, "No type-specific schema");
	assert.equal(result.publisher.state, "eligible", "a role switch does not disable an unrelated publisher");
});

check("unknown preset state does not disable an independently configured WebPage role", () => {
	const value = input();
	value.configuration.presets.record = "unavailable";
	const result = buildSchemaMapModel(value);
	assert.equal(result.publisher.state, "unknown");
	assert.equal(result.contentTypes.find((item) => item.id === "posts")?.state, "unknown");
	assert.equal(result.contentTypes.find((item) => item.id === "pages")?.state, "eligible");
	assert.ok(result.builtIns.every((item) => item.state === "unknown"));
	value.configuration.contentTypes.record = "invalid";
	assert.ok(buildSchemaMapModel(value).contentTypes.every((item) => item.state === "invalid"));
});

check("module, unreadable settings and failed refresh never become positive output claims", () => {
	const value = input();
	value.configuration.customSchemas = [custom("shared", "posts")];
	value.outputEnabled = false;
	let result = buildSchemaMapModel(value);
	assert.equal(result.gate.state, "off");
	assert.equal(result.customGroups[1].items[0].state, "off");
	value.outputEnabled = true;
	value.settings = null;
	result = buildSchemaMapModel(value);
	assert.equal(result.gate.state, "unknown");
	assert.equal(result.publisher.state, "unknown");
	assert.equal(result.customGroups[1].items[0].state, "unknown");
	const readable = settings();
	value.settings = { ...readable, state: "unavailable", updatedAt: null, values: null, legacyGuard: null, legacyPresent: false, indexingPreferenceConfirmed: false,
		contentScoring: { state: "unavailable", reason: "unreadable" } };
	result = buildSchemaMapModel(value);
	assert.match(result.gate.detail, /adds no metadata/);
	value.settings = readable;
	value.refreshFailed = true;
	result = buildSchemaMapModel(value);
	assert.equal(result.gate.status, "Refresh failed");
	assert.match(result.gate.detail, /last configuration read/);
	assert.equal(result.customGroups[1].items[0].state, "unknown");
});

check("publisher uses the saved facts and independently qualifies draft, ownership and read uncertainty", () => {
	const value = input();
	const facts = { kind: "LocalBusiness" as const, businessType: "Dentist", name: "Saved dentist", logo: null, profiles: [] };
	value.publisher = { kind: "business", saved: facts, draft: { ...facts, name: "Unsaved name" }, draftBehind: true, refreshError: null, reading: false, selection: "settled" };
	let result = buildSchemaMapModel(value);
	assert.equal(result.publisher.name, "Saved dentist");
	assert.equal(result.publisherDraft, true);
	assert.equal(result.publisher.state, "eligible", "a separate draft does not replace the saved identity");
	value.publisher = { ...value.publisher, selection: "unknown" };
	assert.equal(buildSchemaMapModel(value).publisher.state, "unknown");
	value.publisher = { ...value.publisher, selection: "settled", refreshError: "Read failed" };
	assert.equal(buildSchemaMapModel(value).publisher.state, "unknown");
	value.publisherOutput = "none";
	assert.equal(buildSchemaMapModel(value).publisher.state, "unknown", "retained off ownership is not current after a failed read");
	for (const uncertain of [
		{ selection: "pending" as const, reading: false, refreshError: null },
		{ selection: "unknown" as const, reading: false, refreshError: null },
		{ selection: "settled" as const, reading: true, refreshError: null },
	]) {
		value.publisher = { ...value.publisher, ...uncertain };
		assert.equal(buildSchemaMapModel(value).publisher.state, "unknown", "retained off ownership cannot bypass a pending or uncertain selection");
	}
	value.publisher = { ...value.publisher, selection: "settled", reading: false, refreshError: null };
	result = buildSchemaMapModel(value);
	assert.equal(result.publisher.state, "off");
	assert.match(result.publisher.detail, /Automatic publisher output is off/);
	value.refreshFailed = true;
	assert.equal(buildSchemaMapModel(value).publisher.state, "unknown");
	value.refreshFailed = false;
	value.publisherOutput = null;
	assert.equal(buildSchemaMapModel(value).publisher.state, "unknown");
});

check("scope totals include disabled and invalid saved records without calling them emitted", () => {
	const value = input();
	value.configuration.customSchemas = [custom("global", "global"), custom("collection", "posts", false), custom("entry", "posts:exact-id", true, false), custom("unknown-type", "archived")];
	const before = JSON.stringify(value);
	Object.freeze(value.configuration.customSchemas);
	for (const schema of value.configuration.customSchemas) Object.freeze(schema);
	const result = buildSchemaMapModel(value);
	assert.deepEqual(result.customGroups.map((group) => group.items.length), [1, 2, 1]);
	assert.equal(result.customGroups[0].items[0].status, "Can contribute");
	assert.equal(result.customGroups[1].items[0].state, "off");
	assert.equal(result.customGroups[2].items[0].state, "invalid");
	assert.match(result.customGroups[2].items[0].detail, /Posts: exact-id/);
	assert.match(result.customGroups[1].items[1].detail, /^archived/);
	assert.equal(JSON.stringify(value), before);
	assert.equal(result.customTruncated, false);
});

check("inventory and discovery limits remain visible, including retained mappings", () => {
	const value = input();
	value.configuration.customSchemas = Array.from({ length: 101 }, (_, index) => custom(String(index), "global"));
	value.configuration.hasMore = false;
	value.configuration.contentTypes.discoveredCount = 105;
	value.configuration.contentTypes.unlisted = [{ collection: "archived", role: "service" }];
	let result = buildSchemaMapModel(value);
	assert.equal(result.customCount, 100);
	assert.equal(result.customTruncated, true);
	assert.match(result.contentTypesNotice!, /3 of 105/);
	assert.equal(result.retainedRoles, 1);
	value.configuration.customSchemas = [];
	value.configuration.hasMore = true;
	value.configuration.contentTypes.discoveryAvailable = false;
	result = buildSchemaMapModel(value);
	assert.equal(result.customCount, 0);
	assert.equal(result.customTruncated, true, "an empty returned slice is not proof no other records exist");
	assert.match(result.contentTypesNotice!, /could not be discovered/);
});

console.log(JSON.stringify({ status: "passed", cases }));
