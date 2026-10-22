import assert from "node:assert/strict";
import { classifySitemapInstallation } from "./sitemap-installation.ts";
import { classifyRobotsInstallation, settleRobotsInstallation } from "./robots-installation.ts";
import { classifyLlmsTxtInstallation, settleLlmsTxtInstallation } from "./llms-txt-installation.ts";
import { verificationHostMerges } from "./site-verification.ts";
import { effectiveRobotsTxt } from "./robots-txt.ts";
import { robotsRoleHints } from "./admin-ui/robots-txt-model.ts";

for (const version of ["1.3.0", "1.3.1"]) {
 const sitemap = { emdashVersion: version, pageEntries: [], publicFiles: [], integrations: ["emdash"] };
 assert.equal(classifySitemapInstallation(sitemap).owner, "shipit", `${version} supports native sitemap ownership`);
 assert.equal(classifySitemapInstallation({ ...sitemap, publicFiles: ["sitemap.xml"] }).owner, "static-file");
 const robots = { ...sitemap, emdashSiteUrl: "https://example.com" };
 assert.equal(settleRobotsInstallation(classifyRobotsInstallation(robots), { winner: "core" }).owner, "emdash-core");
 assert.equal(settleRobotsInstallation(classifyRobotsInstallation({ ...robots, publicFiles: ["robots.txt"] }), { winner: "core" }).owner, "static-file");
 const llms = { emdashVersion: version, publicDirectory: { state: "absent" as const }, pagesDirectory: { state: "absent" as const }, integrations: ["emdash"] };
 assert.equal(settleLlmsTxtInstallation(classifyLlmsTxtInstallation(llms), { winner: "none" }).owner, "shipit");
 assert.equal(verificationHostMerges(version), true);
 assert.deepEqual(robotsRoleHints(version, { status: "success", role: 50 }), { read: "allowed", manage: "allowed" });
 assert.deepEqual(robotsRoleHints(version, { status: "success", role: 40 }), { read: "allowed", manage: "denied" });
 assert.deepEqual(robotsRoleHints(version, { status: "success", role: 30 }), { read: "denied", manage: "denied" });
 for (const stored of [undefined, "Allow: /private/", "Sitemap: https://example.net/other.xml  "]) {
  assert.equal(effectiveRobotsTxt(stored, "https://example.com", { hostVersion: version, disallowAiTraining: true }).body,
   effectiveRobotsTxt(stored, "https://example.com", { hostVersion: "1.3.0", disallowAiTraining: true }).body);
 }
}
for (const version of ["1.3.2", "1.3.1-rc.1", "1.4.0", null]) {
 assert.equal(classifySitemapInstallation({ emdashVersion: version, pageEntries: [], publicFiles: [], integrations: [] }).owner, "unsupported-host");
 assert.equal(verificationHostMerges(version), false);
 assert.deepEqual(robotsRoleHints(version, { status: "success", role: 50 }), { read: "unknown", manage: "unknown" });
}
console.log("Exact native patch hosts preserve file owners, settings merging and role limits.");
