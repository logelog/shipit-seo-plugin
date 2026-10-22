import assert from "node:assert/strict";

import engine from "../sandbox-entry.ts";
import { SEO_ADMIN_API_ROUTES, SEO_ENGINE_PLUGIN_ID, SEO_ENGINE_VERSION } from "../admin-contract.ts";
import { SEO_WORKSPACE_URL, seoAdminApiUrl } from "./api-routes.ts";
import { SEO_ADMIN_PAGE, seoPlugin } from "../index.ts";

const descriptor = seoPlugin();
const engineRoutes = new Set(Object.keys(engine.routes ?? {}));

assert.equal(descriptor.id, SEO_ENGINE_PLUGIN_ID);
assert.equal(descriptor.version, SEO_ENGINE_VERSION);
assert.equal(descriptor.format, "native");
assert.equal(descriptor.entrypoint, "@shipitseo/emdash-plugin-seo/plugin");
assert.equal(descriptor.adminEntry, "@shipitseo/emdash-plugin-seo/admin");
assert.deepEqual(descriptor.adminPages, [SEO_ADMIN_PAGE]);
assert.equal(SEO_WORKSPACE_URL, "/_emdash/admin/plugins/shipit-seo/seo");
assert.equal(new Set(SEO_ADMIN_API_ROUTES).size, SEO_ADMIN_API_ROUTES.length);
assert.deepEqual(SEO_ADMIN_API_ROUTES.filter((route) => !engineRoutes.has(route)), []);
for (const route of SEO_ADMIN_API_ROUTES) {
	assert.equal(seoAdminApiUrl(route), `/_emdash/api/plugins/shipit-seo/${route}`);
}

console.log("SEO route and admin URL self-check passed.");
