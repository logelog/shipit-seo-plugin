import assert from "node:assert/strict";
import { CONTENT_SCORING_RESOURCE_NOTICE_VERSION } from "./admin-contract.ts";
import {
	GLOBAL_SETTINGS_KEY, buildAdminSettings, getContentScoringEnabled, persistAdminSettings,
	readContentScoringPolicy, resetAdminSettings, saveAdminSettingsIfCurrent, saveContentScoring,
} from "./settings-runtime.ts";
import { defaultSettingsValues } from "./settings-state.ts";

let revision = 0;
let writes = 0;
let current: { value: any; revision: string } | null = null;
let failRead = false;
let beforeWrite: (() => void) | null = null;
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const seed = (value: any) => { current = { value: clone(value), revision: `r${++revision}` }; };
const ctx: any = {
	site: { name: "Synthetic site", url: "https://example.com" },
	log: { warn() {} },
	kv: {
		get: async (key: string) => key === GLOBAL_SETTINGS_KEY ? clone(current?.value ?? null) : null,
		getVersioned: async (key: string) => {
			if (failRead) throw new Error("unavailable");
			return key === GLOBAL_SETTINGS_KEY ? clone(current) : null;
		},
		set: async (key: string, value: unknown) => { assert.equal(key, GLOBAL_SETTINGS_KEY); writes += 1; seed(value); },
		compareAndSet: async (key: string, expected: string | null, value: unknown) => {
			assert.equal(key, GLOBAL_SETTINGS_KEY);
			beforeWrite?.();
			if ((current?.revision ?? null) !== expected) return { applied: false };
			writes += 1;
			seed(value);
			return { applied: true, revision: current!.revision };
		},
	},
	content: new Proxy({}, { get: () => { throw new Error("Activation must not read content"); } }),
	storage: new Proxy({}, { get: () => { throw new Error("Activation must not touch scores or history"); } }),
	cron: new Proxy({}, { get: () => { throw new Error("Activation must not schedule catch-up"); } }),
};
async function loaded() {
	const settings = await buildAdminSettings(ctx);
	assert.ok(settings.values);
	return settings;
}
async function change(enabled: boolean, notice?: number) {
	const settings = await loaded();
	return saveContentScoring(ctx, {
		contentScoringEnabled: enabled, expectedContentScoringEnabled: settings.values.contentScoringEnabled,
		expectedRevision: settings.revision, expectedLegacyGuard: settings.legacyGuard,
		...(notice === undefined ? {} : { resourceNoticeVersion: notice }),
	});
}
async function generic(intent: boolean) {
	const settings = await loaded();
	return saveAdminSettingsIfCurrent(ctx, {
		...settings.values, contentScoringEnabled: intent, contentScoringResourceNoticeVersion: 1,
	} as any, { expectedRevision: settings.revision, expectedLegacyGuard: settings.legacyGuard });
}
const state = async () => (await readContentScoringPolicy(ctx)).state;

assert.equal((await loaded()).values.contentScoringEnabled, true);
assert.equal(await state(), "pending-confirmation");
assert.equal(await getContentScoringEnabled(ctx), false);
assert.equal(writes, 0);
assert.equal((await generic(true)).success, true);
assert.equal(await state(), "pending-confirmation", "generic writes ignore a forged acknowledgement");
assert.equal(current!.value.contentScoringResourceNoticeVersion, undefined);
const beforeNotice = writes;
assert.equal((await change(true)).success, false);
assert.equal((await change(true, 0)).success, false);
assert.equal(writes, beforeNotice);
assert.equal((await change(true, CONTENT_SCORING_RESOURCE_NOTICE_VERSION)).success, true);
assert.equal(await state(), "enabled");
assert.equal(await getContentScoringEnabled(ctx), true);
assert.equal((await generic(false)).success, true);
assert.equal(await state(), "enabled", "metadata saves preserve admitted intent and acknowledgement");
assert.equal((await change(false)).success, true);
assert.equal(await state(), "paused");
assert.equal(current!.value.contentScoringResourceNoticeVersion, 1);
assert.equal((await generic(true)).success, true);
assert.equal(await state(), "paused", "generic saves cannot resume analysis");
assert.equal((await resetAdminSettings(ctx, (await loaded()).revision!)).success, true);
assert.equal(await state(), "paused", "restore preserves intent and acknowledgement");
assert.equal((await change(true)).success, false);
assert.equal((await change(true, 1)).success, true);

const retained = clone(current);
const originalSet = ctx.kv.set;
ctx.kv.set = async (key: string, value: unknown) => {
	assert.equal(Object.hasOwn(value as object, "contentScoringResourceNoticeVersion"), false,
		"import must omit the server-owned acknowledgement before a JSON-backed write");
	assert.deepEqual(structuredClone(value), clone(value),
		"tracked import values must equal their JSON-stored representation");
	return originalSet(key, value);
};
await persistAdminSettings(ctx, {
	...defaultSettingsValues({ siteName: "Imported", siteUrl: "https://example.com" }),
	contentScoringResourceNoticeVersion: 1,
} as any);
assert.equal(await state(), "pending-confirmation", "import cannot transfer acknowledgement");
assert.equal(current!.value.contentScoringResourceNoticeVersion, undefined);
ctx.kv.set = originalSet;
current = retained;
assert.equal(await state(), "enabled", "raw snapshot restoration keeps prior admission");
const beforeConflict = await loaded();
const prior = clone(current);
beforeWrite = () => { beforeWrite = null; seed({ ...prior.value, siteName: "Concurrent" }); };
const conflict = await saveContentScoring(ctx, {
	contentScoringEnabled: false, expectedContentScoringEnabled: true,
	expectedRevision: beforeConflict.revision, expectedLegacyGuard: null,
});
assert.ok(!conflict.success && conflict.conflict);
assert.equal(current!.value.siteName, "Concurrent");
assert.equal(await state(), "enabled");
seed({ ...prior.value, contentScoringResourceNoticeVersion: 2 });
assert.equal(await state(), "pending-confirmation");
seed({ ...prior.value, contentScoringResourceNoticeVersion: "1" });
assert.equal(await state(), "unavailable");
assert.equal((await loaded()).state, "saved", "bad acknowledgement does not erase metadata ownership");
assert.equal((await change(true, CONTENT_SCORING_RESOURCE_NOTICE_VERSION)).success, true);
assert.equal(await state(), "enabled", "an explicit revision-fenced acknowledgement repairs the malformed marker");
seed({ ...prior.value, contentScoringEnabled: false, contentScoringResourceNoticeVersion: "1" });
assert.equal(await state(), "paused");
failRead = true;
assert.equal(await state(), "unavailable");
console.log("Saved-content activation policy self-checks passed.");
