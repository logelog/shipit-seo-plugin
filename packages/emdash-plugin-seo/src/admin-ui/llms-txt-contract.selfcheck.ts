import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	SEO_ADMIN_API_ROUTES,
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ENGINE_VERSION,
	SEO_LLMS_TXT_CORRUPT_REASONS,
	SEO_LLMS_TXT_OWNERS,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { LLMS_TXT_INSTALLATION_OWNERS } from "../llms-txt-installation.ts";
import { parseSeoAdminLlmsTxt, parseSeoAdminLlmsTxtWriteResult } from "./contract.ts";
import { SEO_ADMIN_VIEWS } from "./content-extension-model.ts";
import { SEO_WORKSPACE_NAV_GROUPS, SEO_WORKSPACE_VIEW_LABELS } from "./workspace-model.ts";

const BOM = String.fromCharCode(0xfeff);

assert.deepEqual([...SEO_LLMS_TXT_OWNERS], [...LLMS_TXT_INSTALLATION_OWNERS, "not-installed"],
	"the admin knows every recorded owner and the runtime-only one");
assert.deepEqual([...SEO_LLMS_TXT_CORRUPT_REASONS], ["not-object", "unsupported-version", "unexpected-fields", "enabled-not-boolean", "text-invalid", "enabled-without-h1"]);
for (const route of ["admin-llms-txt", "save-admin-llms-txt", "set-admin-llms-txt-enabled", "reset-admin-llms-txt"]) {
	assert.ok((SEO_ADMIN_API_ROUTES as readonly string[]).includes(route), route);
}
assert.ok(SEO_ADMIN_VIEWS.includes("llms"));
assert.ok(SEO_WORKSPACE_NAV_GROUPS.find((group) => group.id === "indexing")?.views.includes("llms"), "listed under Indexing");
assert.equal(SEO_WORKSPACE_VIEW_LABELS.llms, "llms.txt");

const text = `${BOM}# Site\r\n`;
const stored = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION, owner: "shipit", ownerDetail: null, hostVersion: "1.1.0",
	conditionalStorage: true, state: "stored", revision: "r1", enabled: true, text, bytes: new TextEncoder().encode(text).byteLength,
	corrupt: null, limits: { documentBytes: 131072, requestBytes: 1048576 }, path: "/llms.txt", cacheControl: "public, max-age=300",
};
assert.equal(parseSeoAdminLlmsTxt(stored).text, text, "the exact text, BOM and CRLF included, passes");
const absent = { ...stored, state: "absent", revision: null, enabled: false, text: null, bytes: null };
assert.equal(parseSeoAdminLlmsTxt(absent).state, "absent");
assert.equal(parseSeoAdminLlmsTxt({ ...absent, state: "unavailable" }).state, "unavailable");
const corrupt = { ...absent, state: "corrupt", revision: "r9", corrupt: { reason: "unsupported-version", detail: "The stored version is 2.", copy: "{\"version\":2}", copyBytes: 13 } };
assert.equal(parseSeoAdminLlmsTxt(corrupt).corrupt?.copy, "{\"version\":2}");
assert.equal(parseSeoAdminLlmsTxt({ ...corrupt, corrupt: { ...corrupt.corrupt, copy: null, copyBytes: 2_000_000 } }).corrupt?.copy, null);

const invalid: [string, Record<string, unknown>][] = [
	["owner", { ...stored, owner: "someone" }],
	["revision on absent", { ...absent, revision: "r1" }],
	["missing revision", { ...stored, revision: null }],
	["enabled without a record", { ...absent, enabled: true }],
	["byte count", { ...stored, bytes: 1 }],
	["enabled text without H1", { ...stored, text: "no heading", bytes: 10 }],
	["unpaired surrogate", { ...stored, enabled: false, text: String.fromCharCode(0xd800), bytes: 3 }],
	["text on absent", { ...absent, text: "" }],
	["corrupt without detail", { ...corrupt, corrupt: null }],
	["corrupt reason", { ...corrupt, corrupt: { ...corrupt.corrupt, reason: "other" } }],
	["copy size", { ...corrupt, corrupt: { ...corrupt.corrupt, copyBytes: 1 } }],
	["corrupt detail on stored", { ...stored, corrupt: corrupt.corrupt }],
	["limits", { ...stored, limits: { documentBytes: 1, requestBytes: 1048576 } }],
	["path", { ...stored, path: "/LLMS.txt" }],
];
for (const [label, value] of invalid) assert.throws(() => parseSeoAdminLlmsTxt(value), /Invalid SEO admin response: llmsTxt/, label);
assert.throws(() => parseSeoAdminLlmsTxt({ ...stored, contractVersion: SEO_ADMIN_CONTRACT_VERSION - 1 }), new RegExp(`engine/admin mismatch: expected contract ${SEO_ADMIN_CONTRACT_VERSION}`));

assert.equal(parseSeoAdminLlmsTxtWriteResult({ success: true, changed: false, llms: stored }).success, true);
assert.deepEqual(parseSeoAdminLlmsTxtWriteResult({ success: false, reason: "conflict", message: "changed" }), { success: false, reason: "conflict", message: "changed" });
assert.throws(() => parseSeoAdminLlmsTxtWriteResult({ success: true, llms: stored }), /llmsTxt.write/);
assert.throws(() => parseSeoAdminLlmsTxtWriteResult({ success: false, reason: "retry", message: "x" }), /llmsTxt.write/);
assert.throws(() => parseSeoAdminLlmsTxtWriteResult({ success: false, reason: "invalid", message: "x", field: "enabled" }), /llmsTxt.write/);

// The view: escaped text only, same-origin bounded check, complete write gates.
const view = readFileSync(new URL("./llms-txt-view.tsx", import.meta.url), "utf8");
assert.doesNotMatch(view, /dangerouslySetInnerHTML|innerHTML|marked|markdown-it|remark/, "Markdown is never rendered as HTML");
assert.doesNotMatch(view, /maxLength|maxlength/, "no native limit cuts text by UTF-16 units");
assert.doesNotMatch(view, /setInterval|refetchInterval|useQuery/, "no polling or background refetch");
assert.match(view, /fetch\(new URL\(LLMS_TXT_PATH, window\.location\.origin\), \{\s*cache: "no-store", credentials: "omit", redirect: "manual", signal: controller\.signal,/);
assert.match(view, /async function write\(operation: LlmsTxtOperation, kind: "save" \| "output" \| "reset"\) \{\s*if \(writing\.current\) return;\s*writing\.current = true;\s*invalidateObservation\(\);/,
	"every write first clears the earlier observation");
assert.match(view, /observeController\.current\?\.abort\(\);\s*observeController\.current = null;\s*setObservation\(\{ \.\.\.OBSERVATION_IDLE, status: "stale" \}\);/, "an invalidated check is aborted");
assert.match(view, /React\.useEffect\(\(\) => \(\) => \{\s*observeToken\.current \+= 1;\s*observeController\.current\?\.abort\(\);/, "unmounting aborts the check");
assert.match(view, /disabled=\{!observationAllowed\}/, "Check again follows the observation gate");
assert.match(view, /function reset\(\) \{\s*if \(!state \|\| state\.revision === null \|\| resetBlockers\.length\) return;/);
assert.match(view, /variant="destructive" loading=\{busy === "reset"\} disabled=\{resetBlockers\.length > 0\} onClick=\{reset\}/);
assert.match(view, /disabled=\{saveBlockers\.length > 0\} onClick=\{save\}/);
assert.match(view, /readOnly=\{!editable\}/);
assert.match(view, /applyState\(result\.state, kind === "save" \? "new-basis" : "keep-draft"\)/, "only a confirmed save starts a new draft basis");
assert.match(view, /if \(!llmsTxtAuthoritative\(result\.value\)\) \{[\s\S]{0,160}setOutcome\(\{ status: "still-unavailable" \}\);\s*return;/,
	"an unavailable answer keeps uncertainty and the reload requirement");
assert.doesNotMatch(view, /reload\("replace-draft"\)|"replace-draft"/, "no reload replaces a retained draft");
assert.match(view, /label=\{current\.enabled \? "Output on \(saved setting\)" : "Output off \(saved setting\)"\}/, "the label names the saved state the switch shows");
assert.doesNotMatch(view, /label="Serve at/, "the switch names the saved setting, not a served file");
assert.match(view, /JSON, Its|written out again as JSON/, "the copy is described as re-serialized JSON");

console.log("llms.txt admin contract and view self-check passed.");
