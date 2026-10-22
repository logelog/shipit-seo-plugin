import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SEO_ADMIN_CONTRACT_VERSION, SEO_ENGINE_VERSION, SEO_ROBOTS_TXT_OWNERS } from "@shipitseo/emdash-plugin-seo/admin-contract";

import { ROBOTS_INSTALLATION_OWNERS } from "../robots-installation.ts";
import { parseSeoAdminRobotsTxtFacts } from "./contract.ts";

assert.deepEqual([...SEO_ROBOTS_TXT_OWNERS], [...ROBOTS_INSTALLATION_OWNERS, "not-installed"],
	"the admin knows every recorded owner and the runtime-only one");

const facts = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION,
	engineVersion: SEO_ENGINE_VERSION,
	owner: "emdash-core",
	ownerDetail: null,
	hostVersion: "1.1.0",
	configuredOrigin: { origin: "https://cms.example.org", source: "emdash-config" },
	configuredOriginKnown: true,
};
assert.deepEqual(parseSeoAdminRobotsTxtFacts(facts), facts);
assert.equal(parseSeoAdminRobotsTxtFacts({ ...facts, owner: "unknown", ownerDetail: "public could not be read (EACCES)" }).owner, "unknown");
assert.deepEqual(parseSeoAdminRobotsTxtFacts({ ...facts, configuredOrigin: null, owner: "not-installed", configuredOriginKnown: false }).owner, "not-installed");

for (const [patch, field] of [
	[{ owner: "shipit" }, "robotsTxt.owner"],
	[{ ownerDetail: 1 }, "robotsTxt.ownerDetail"],
	[{ hostVersion: undefined }, "robotsTxt.hostVersion"],
	[{ configuredOriginKnown: "yes" }, "robotsTxt.configuredOriginKnown"],
	[{ configuredOrigin: { origin: "https://cms.example.org/", source: "emdash-config" } }, "robotsTxt.configuredOrigin"],
	[{ configuredOrigin: { origin: "https://user@cms.example.org", source: "environment" } }, "robotsTxt.configuredOrigin"],
	[{ configuredOrigin: { origin: "https://cms.example.org", source: "astro-site" } }, "robotsTxt.configuredOrigin"],
	[{ configuredOriginKnown: false }, "robotsTxt.configuredOrigin"],
	[{ engineVersion: 1 }, "robotsTxt.engineVersion"],
] as const) {
	assert.throws(() => parseSeoAdminRobotsTxtFacts({ ...facts, ...patch }), new RegExp(field.replace(".", "\\.")));
}
assert.throws(() => parseSeoAdminRobotsTxtFacts({ ...facts, contractVersion: 25 }), /engine\/admin mismatch/);
assert.throws(() => parseSeoAdminRobotsTxtFacts([]), /robotsTxt\.root/);

// The view re-checks eligibility when a write is confirmed and keeps the
// restore confirmation disabled while restoring is not allowed.
const view = readFileSync(new URL("./robots-txt-view.tsx", import.meta.url), "utf8");
assert.match(view, /async function write\([^)]*\) \{\s*\/\/[^\n]*\n\s*if \(!snapshot \|\| writing\.current \|\| !robotsWriteAllowed\(kind, blockers\)\) return;/);
assert.match(view, /variant="destructive" loading=\{busy === "restore"\} disabled=\{!canRestore\} onClick=\{\(\) => void write\("", "restore"\)\}/);
assert.match(view, /saveDisabled=\{!canSave\}\n\t+saving=\{busy === "save"\}\n\t+onSave=\{\(\) => void write\(draft, "save"\)\}/);
// One action bar: restore at the left opens the confirmation; Discard only resets the editor to the stored text.
assert.match(view, /<SettingsActionBar\n\t+status=\{statusLine\}\n\t+restore=\{\(\n\t+<Button type="button" variant="secondary-destructive" icon=\{ArrowCounterClockwise\} disabled=\{!canRestore\} onClick=\{\(\) => setRestoreOpen\(true\)\}>/);
assert.match(view, /onDiscard=\{\(\) => setDraft\(robotsEditorText\(current\.stored\)\)\}/);
assert.match(view, /saveLabel="Save robots\.txt"/);
assert.equal(view.match(/void write\(/g)?.length, 2, "Only Save and the confirmed restore write");
assert.match(view, /readOnly=\{!editable\}/);
assert.doesNotMatch(view, /maxLength|maxlength/, "no native limit cuts text by UTF-16 units");
assert.match(view, /updateSettings\(robotsSettingsUpdate\(text\)\)/, "the view sends only the robots field");

console.log("robots-txt-contract selfcheck passed");
