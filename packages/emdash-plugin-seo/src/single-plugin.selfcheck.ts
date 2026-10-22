import assert from "node:assert/strict";

import { SEO_ENGINE_PLUGIN_ID, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import { seoPlugin } from "./index.ts";
import { createPlugin } from "./native-entry.ts";

const descriptor = seoPlugin();
const runtime = createPlugin();

assert.equal(descriptor.id, SEO_ENGINE_PLUGIN_ID);
assert.equal(runtime.id, descriptor.id);
assert.equal(runtime.version, SEO_ENGINE_VERSION);
// The host adds redirects:read, which redirects:write implies.
assert.deepEqual(runtime.capabilities, [
	"content:read", "content:revisions:read", "network:request", "schema:read", "hooks.content-policy:register",
	"redirects:write", "taxonomies:read", "redirects:read",
]);
assert.deepEqual(runtime.allowedHosts, descriptor.allowedHosts);
assert.deepEqual(
	Object.fromEntries(Object.entries(runtime.storage).map(([name, config]) => [name, config.indexes])),
	Object.fromEntries(Object.entries(descriptor.storage ?? {}).map(([name, config]) => [name, config.indexes])),
);
assert.deepEqual(runtime.admin.pages, descriptor.adminPages);
assert.equal(runtime.admin.entry, descriptor.adminEntry);
assert.ok(runtime.routes.admin);
assert.ok(runtime.routes["admin-indexnow"]);
assert.ok(runtime.routes["score-trends"]);
assert.ok(runtime.hooks["page:metadata"]);

const configuredDescriptor = seoPlugin({
	siteUrl: "https://example.com",
});
const configuredRuntime = createPlugin({ siteUrl: "https://example.com" });
assert.equal(configuredRuntime.id, descriptor.id);
assert.deepEqual(configuredRuntime.capabilities, runtime.capabilities);
assert.deepEqual(configuredRuntime.allowedHosts, configuredDescriptor.allowedHosts);
assert.deepEqual(configuredRuntime.storage, runtime.storage);

console.log("SEO single-plugin contract self-check passed.");
