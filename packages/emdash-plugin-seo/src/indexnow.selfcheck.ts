import assert from "node:assert/strict";

import {
	INDEXNOW_ENDPOINT,
	UNKNOWN_INDEXNOW_INSTALLATION,
	buildIndexNowPayload,
	classifyIndexNowResponse,
	createIndexNowDeliveryNonce,
	createIndexNowKey,
	decodeIndexNowHistoryCursor,
	defaultIndexNowSettings,
	emptyIndexNowSubmissionCounts,
	encodeIndexNowHistoryCursor,
	indexNowDeliveryId,
	indexNowHistoryScope,
	indexNowPublicOrigin,
	indexNowRetryAt,
	indexNowSetupIssue,
	indexNowSubmissionReason,
	indexNowSubmissionStatus,
	classifyIndexNowSite,
	normalizeIndexNowUrl,
	resolveIndexNowKeyLocation,
	validateIndexNowSettings,
	type IndexNowInstallation,
} from "./indexnow.ts";

const defaults = defaultIndexNowSettings();
assert.equal(defaults.enabled, false);
assert.equal(defaults.autoSubmit, false, "a new installation starts with automatic submission off");
assert.deepEqual(defaults.autoSubmitContentTypes, ["pages", "posts"], "Pages and Posts are reviewed first");
assert.notEqual(defaultIndexNowSettings().autoSubmitContentTypes, defaults.autoSubmitContentTypes, "defaults are not shared");
assert.equal(defaults.keyLocation, "/indexnow-key.txt");
for (const selection of [null, [], ["pages", "posts"], ["guides"]]) {
	const validation = validateIndexNowSettings({ ...defaults, autoSubmitContentTypes: selection });
	assert.equal(validation.success, true);
	assert.deepEqual(validation.success && validation.values.autoSubmitContentTypes, selection,
		"all eligible (null), none ([]) and explicit lists stay distinct");
}
assert.equal(validateIndexNowSettings({ ...defaults, autoSubmitContentTypes: ["posts", "posts"] }).success, false);
assert.equal(validateIndexNowSettings({ ...defaults, autoSubmitContentTypes: ["bad:type"] }).success, false);
assert.deepEqual(validateIndexNowSettings({ ...defaults, autoSubmitContentTypes: ["pages"] }).success, true);
assert.equal(validateIndexNowSettings({ ...defaults, autoSubmitContentTypes: undefined }).success, true);
const olderSettings = { ...defaults } as Partial<typeof defaults>;
delete olderSettings.autoSubmitContentTypes;
const olderValidation = validateIndexNowSettings(olderSettings);
assert.equal(
	olderValidation.success && olderValidation.values.autoSubmitContentTypes,
	null,
	"settings saved before the content type choice keep every eligible type",
);

assert.equal(validateIndexNowSettings({ ...defaults, enabled: true }).success, false);
assert.equal(validateIndexNowSettings({ ...defaults, apiKey: "short" }).success, false);
assert.equal(validateIndexNowSettings({ ...defaults, apiKey: "valid-key-123", batchSize: 1001 }).success, false);
assert.equal(validateIndexNowSettings({ ...defaults, apiKey: "valid-key-123", minIntervalSeconds: 299 }).success, false);
assert.equal(validateIndexNowSettings({ ...defaults, enabled: true, apiKey: "valid-key-123" }).success, true);

assert.equal(indexNowPublicOrigin("http://127.0.0.1:4321").ready, false);
assert.equal(indexNowPublicOrigin("http://192.168.1.20").ready, false);
assert.deepEqual(indexNowPublicOrigin("https://example.com/path"), { ready: true, origin: "https://example.com" });

assert.equal(
	normalizeIndexNowUrl("/article#section", "https://example.com"),
	"https://example.com/article",
);
assert.equal(normalizeIndexNowUrl("https://other.example/article", "https://example.com"), null);
assert.equal(normalizeIndexNowUrl("ftp://example.com/file", "https://example.com"), null);
assert.equal(normalizeIndexNowUrl("https://user:pass@example.com/private", "https://example.com"), null);

assert.equal(
	resolveIndexNowKeyLocation("/indexnow-key.txt", "https://example.com"),
	"https://example.com/indexnow-key.txt",
);
assert.equal(resolveIndexNowKeyLocation("https://other.example/key.txt", "https://example.com"), null);

const settings = { ...defaults, enabled: true, apiKey: "valid-key-123" };
const payload = buildIndexNowPayload(
	["https://example.com/a", "https://example.com/a#fragment", "https://example.com/b"],
	settings,
	"https://example.com",
);
assert.equal(INDEXNOW_ENDPOINT, "https://api.indexnow.org/indexnow");
assert.equal(payload.host, "example.com");
assert.equal(payload.key, "valid-key-123");
assert.equal(payload.keyLocation, "https://example.com/indexnow-key.txt");
assert.deepEqual(payload.urlList, ["https://example.com/a", "https://example.com/b"]);

assert.equal(classifyIndexNowResponse(200).disposition, "accepted");
assert.equal(classifyIndexNowResponse(202).disposition, "accepted");
assert.equal(classifyIndexNowResponse(429).disposition, "retry");
assert.equal(classifyIndexNowResponse(503).disposition, "retry");
assert.equal(classifyIndexNowResponse(403).disposition, "failed");

const now = new Date("2026-07-14T10:00:00.000Z");
assert.equal(indexNowRetryAt(1, "120", now), "2026-07-14T10:05:00.000Z");
assert.equal(indexNowRetryAt(2, null, now), "2026-07-14T10:15:00.000Z");
const deliveryTimestamp = "2026-07-14T10:00:00.000Z";
const deliveryUrls = ["https://example.com/article"];
assert.equal(
	indexNowDeliveryId(deliveryTimestamp, deliveryUrls, 1),
	indexNowDeliveryId(deliveryTimestamp, deliveryUrls, 1),
);
assert.notEqual(
	indexNowDeliveryId(deliveryTimestamp, deliveryUrls, 1),
	indexNowDeliveryId(deliveryTimestamp, deliveryUrls, 2),
);
assert.notEqual(
	indexNowDeliveryId(deliveryTimestamp, deliveryUrls, 1, "nonce-a"),
	indexNowDeliveryId(deliveryTimestamp, deliveryUrls, 1, "nonce-b"),
);
assert.throws(() => indexNowDeliveryId(deliveryTimestamp, deliveryUrls, 0), /positive integers/);
assert.equal(
	createIndexNowDeliveryNonce(Uint8Array.from({ length: 8 }, (_, index) => index)),
	"0001020304050607",
);
assert.throws(
	() => createIndexNowDeliveryNonce(new Uint8Array(7)),
	/at least 8 random bytes/,
);
assert.equal(
	createIndexNowKey(Uint8Array.from({ length: 16 }, (_, index) => index)),
	"000102030405060708090a0b0c0d0e0f",
);

// Astro site classification decides the narrow hostname permission at build time.
assert.deepEqual(classifyIndexNowSite("https://www.example.com"), {
	siteUrl: "https://www.example.com", siteOrigin: "https://www.example.com", issue: null,
});
assert.deepEqual(classifyIndexNowSite("https://Example.com/"), {
	siteUrl: "https://example.com", siteOrigin: "https://example.com", issue: null,
});
for (const [site, issue, siteOrigin] of [
	[undefined, "missing", null],
	["", "missing", null],
	["not a url", "missing", null],
	["http://127.0.0.1:4362", "local", "http://127.0.0.1:4362"],
	["https://localhost", "local", "https://localhost"],
	["https://shop.local", "local", "https://shop.local"],
	["http://192.168.1.4", "local", "http://192.168.1.4"],
	["http://example.com", "not-https", "http://example.com"],
	["https://example.com:8443", "port", "https://example.com:8443"],
	["https://example.com/blog", "path", "https://example.com"],
	["https://example.com/?preview=1", "path", "https://example.com"],
	["https://user:secret@example.com", "not-public", "https://example.com"],
	["https://example.test", "not-public", "https://example.test"],
	["https://8.8.8.8", "not-public", "https://8.8.8.8"],
	["ftp://example.com", "not-public", null],
] as const) {
	assert.deepEqual(classifyIndexNowSite(site), { siteUrl: null, siteOrigin, issue }, `${site}`);
}

const astro = (patch: Partial<IndexNowInstallation>): IndexNowInstallation => ({
	mode: "astro", siteUrl: "https://example.com", siteOrigin: "https://example.com", siteIssue: null, keyRoute: "injected", ...patch,
});
assert.equal(indexNowSetupIssue(astro({}), "https://example.com"), null);
assert.equal(indexNowSetupIssue(astro({ keyRoute: "existing" }), "https://example.com"), null);
const localIssue = indexNowSetupIssue(astro({ siteUrl: null, siteOrigin: "http://127.0.0.1:4362", siteIssue: "local" }), "http://127.0.0.1:4362");
assert.equal(localIssue?.code, "local-site");
assert.match(localIssue?.description ?? "", /cannot reach http:\/\/127\.0\.0\.1:4362, so nothing is sent/);
assert.equal(indexNowSetupIssue(astro({ siteUrl: null, siteOrigin: null, siteIssue: "missing" }), "")?.code, "missing-site");
assert.equal(indexNowSetupIssue(astro({ siteUrl: null, siteOrigin: "http://example.com", siteIssue: "not-https" }), "http://example.com")?.code, "invalid-site");
assert.equal(indexNowSetupIssue(astro({ keyRoute: "unavailable" }), "https://example.com")?.code, "key-route");
const legacy = (siteUrl: string | null): IndexNowInstallation => ({ mode: "legacy", siteUrl, siteOrigin: siteUrl, siteIssue: null, keyRoute: null });
assert.equal(indexNowSetupIssue(legacy("https://example.com"), "https://example.com"), null);
assert.equal(indexNowSetupIssue(legacy(null), "https://example.com")?.code, "permission",
	"an installation without the site hostname cannot reach the key file");
assert.equal(indexNowSetupIssue(legacy("https://example.com"), "https://www.example.com")?.code, "permission");
assert.equal(indexNowSetupIssue(legacy(null), "http://localhost:4321")?.code, "local-site");
assert.equal(indexNowSetupIssue(UNKNOWN_INDEXNOW_INSTALLATION, "https://example.com"), null);
assert.equal(indexNowSetupIssue(UNKNOWN_INDEXNOW_INSTALLATION, "")?.code, "missing-site");

// History status follows the most actionable bucket; counts never overlap.
const counts = (patch: Partial<ReturnType<typeof emptyIndexNowSubmissionCounts>>) => ({ ...emptyIndexNowSubmissionCounts(), ...patch });
assert.equal(indexNowSubmissionStatus(counts({ queued: 2, retrying: 1, sent: 3 })), "retry");
assert.equal(indexNowSubmissionStatus(counts({ queued: 1, sent: 3 })), "queued");
assert.equal(indexNowSubmissionStatus(counts({ sent: 2, failed: 1 })), "failed");
assert.equal(indexNowSubmissionStatus(counts({ sent: 2, accepted: 1, skipped: 4 })), "accepted");
assert.equal(indexNowSubmissionStatus(counts({ sent: 2, superseded: 1 })), "sent");
assert.equal(indexNowSubmissionStatus(counts({ superseded: 1, skipped: 1 })), "superseded");
assert.equal(indexNowSubmissionReason("manual", null), "manual");
assert.equal(indexNowSubmissionReason("automatic", "url-change"), "unpublish", "an old address keeps the removal job reason");
assert.equal(indexNowSubmissionReason("automatic", "publish"), "publish");

// A history cursor continues only the filter it was issued for.
const allScope = indexNowHistoryScope({});
const failedScope = indexNowHistoryScope({ status: "failed" });
const token = encodeIndexNowHistoryCursor(allScope, "host-cursor-ü/+=");
assert.match(token, /^[A-Za-z0-9_-]+$/);
assert.equal(decodeIndexNowHistoryCursor(token, allScope), "host-cursor-ü/+=");
assert.equal(decodeIndexNowHistoryCursor(token, failedScope), null);
for (const invalid of [undefined, "", "!!", "a", token.slice(0, -2), "x".repeat(1_025)])
	assert.equal(decodeIndexNowHistoryCursor(invalid, allScope), null);

console.log("IndexNow protocol self-check passed.");
