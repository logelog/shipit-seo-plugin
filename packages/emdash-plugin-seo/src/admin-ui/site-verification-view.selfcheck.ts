import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { ArrowSquareOut } from "@phosphor-icons/react";
import * as verification from "../site-verification.ts";

import { SEO_ADMIN_VIEWS, buildSeoAdminSearch, parseSeoAdminLocation } from "./content-extension-model.ts";
import { SEO_WORKSPACE_DRAFT_VIEWS, SEO_WORKSPACE_NAV_GROUPS, SEO_WORKSPACE_VIEW_LABELS } from "./workspace-model.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const view = read("./site-verification-view.tsx");
const admin = read("./admin.tsx");
const css = read("./workspace.css");

// ---- Navigation -----------------------------------------------------------

assert.ok(SEO_ADMIN_VIEWS.includes("verification"));
assert.equal(SEO_WORKSPACE_VIEW_LABELS.verification, "Site verification");
assert.ok(SEO_WORKSPACE_NAV_GROUPS.find((group) => group.id === "settings")?.views.includes("verification"), "listed under Settings");
assert.equal(parseSeoAdminLocation("?view=verification").view, "verification");
assert.equal(buildSeoAdminSearch("?view=robots&ref=posts:1", "verification"), "?view=verification");
assert.match(admin, /: draftView === "indexnow" \? <IndexNowView \/>\s*: <div className="shipit-seo-verification-page"><SiteVerificationView \/><CustomVerificationView \/><\/div>\}/, "core codes and custom tags share the verification destination");
assert.ok(SEO_WORKSPACE_DRAFT_VIEWS.includes("verification"), "unsaved codes and tags keep the page mounted while another page is open");

// ---- Host wiring ----------------------------------------------------------

assert.match(admin, /verificationHostVersion\(hostQueryClient\?\.getQueryData\(\["manifest"\]\)\)/,
	"the host version comes from the manifest the host already loaded");
assert.doesNotMatch(admin, /fetchQuery\(\{ queryKey: \["manifest"\]|ensureQueryData\(\{ queryKey: \["manifest"\]/, "reading the version sends no request");
assert.match(admin, /onSettingsChanged: invalidateHostSettings/, "writes mark the host admin's cached settings stale");
assert.match(admin, /<SiteVerificationHostContext\.Provider value=\{verificationHost\}>/);

// ---- Core settings only ---------------------------------------------------

assert.match(view, /import \{ ApiResponseError, fetchSettings, updateSettings, useCurrentUser \} from "@emdash-cms\/admin";/);
assert.match(view, /read: \(\) => settingsCall\(\(\) => fetchSettings\(\)\),/);
assert.match(view, /write: \(patch\) => settingsCall\(\(\) => updateSettings\(patch\)\),/, "only the patch of changed codes is posted");
assert.equal(view.match(/updateSettings\(/g)?.length, 1, "no other settings write");
assert.doesNotMatch(view, /\bfetch\(|apiFetch|from "\.\/api\.ts"|ctx\.|kv\b/, "no plugin route, KV copy or other network call");
assert.doesNotMatch(view, /setInterval|setTimeout|refetchInterval|useQuery\(/, "no polling or background refresh");
assert.doesNotMatch(view, /maxLength|maxlength/, "the browser must not cut a pasted tag short silently");
assert.match(view, /passwordManagerIgnore/);

// ---- Save and recovery wiring --------------------------------------------

const saveBody = view.slice(view.indexOf("async function save()"), view.indexOf("async function recover()"));
assert.match(saveBody, /\/\/ Eligibility from this render[^\n]*\n\t\tif \(!current \|\| !fields \|\| !canSave\) return;/);
const finished = saveBody.indexOf("writeRegistry.finish(ticket");
const invalidated = saveBody.indexOf("if (verificationSaveMayHaveCommitted(result)) host.onSettingsChanged?.();");
const owned = saveBody.indexOf("if (!current.owns(token)) return;");
assert.ok(finished > 0 && invalidated > finished && owned > invalidated,
	"a save settles the shared registry and invalidates host settings before checking whether the view still owns the result");
const recoverBody = view.slice(view.indexOf("async function recover()"), view.indexOf("function edit("));
assert.match(recoverBody, /recoverVerificationOutcome\(settingsPort, state\.pending\)/);
assert.match(recoverBody, /const roleRefreshed = refreshRoleForRead\(\);/);
assert.match(recoverBody, /restoreVerificationIntent\(previous \?\? verificationFieldsFrom\(latest\), state\.pending\.changes\)/,
	"the check keeps the sent codes after a failed first read or a reopened view");
assert.doesNotMatch(recoverBody, /saveVerificationCodes|updateSettings/, "recovery only reads");
assert.match(view, /disabled=\{!canSave\} onClick=\{\(\) => void save\(\)\}/);
// Discard sits before Save, as in the shared action bar, and only returns fields to their stored codes.
assert.match(view, /<div className="shipit-seo-verification-buttons">\n\t+<Button type="button" variant="secondary" icon=\{ArrowCounterClockwise\} disabled=\{!canDiscard\} onClick=\{discard\}>\n\t+Discard changes\n\t+<\/Button>\n\t+<Button type="button" variant="primary"/);
assert.match(view, /const canDiscard = editable && unsavedCodes && pending === null;/, "nothing to discard, a running write or an unconfirmed outcome keeps Discard off");
const discardBody = view.slice(view.indexOf("function discard()"), view.indexOf("function edit("));
assert.match(discardBody, /edit\(\(previous\) => VERIFICATION_PROVIDERS\.reduce\(\(next, provider\) => undoVerificationField\(next, provider\), previous\)\);/);
assert.doesNotMatch(discardBody, /save|updateSettings|setLoad/, "Discard never writes or reloads");
{
	const loaded = verification.verificationFieldsFrom({ seo: "object", codes: { google: { kind: "code", code: "StoredGoogle1" }, bing: { kind: "none", stored: "empty" } } });
	const edited = verification.removeVerificationCode(verification.editVerificationDraft(loaded, "bing", "NewBingCode"), "google");
	assert.equal(verification.verificationDraftSummary(edited).kind, "ready");
	const discarded = verification.VERIFICATION_PROVIDERS.reduce((next, provider) => verification.undoVerificationField(next, provider), edited);
	assert.deepEqual(discarded, loaded, "Discard returns every field to what was loaded");
	assert.equal(verification.verificationDraftSummary(discarded).kind, "clean");
}
const cardDetail = view.slice(view.indexOf("const detail = status ==="), view.indexOf("return (", view.indexOf("const detail = status ===")));
assert.match(cardDetail, /^const detail = status === "unconfirmed"\n\t\t\? "The last save of this code is unconfirmed\. Choose Check stored codes to see what EmDash stores\."/,
	"an unconfirmed save is described before any pending change, so it never reads as not saved");
assert.ok(cardDetail.indexOf('status === "unconfirmed"') < cardDetail.indexOf('intent.kind === "change"'), "unconfirmed takes precedence over replacement and removal text");
assert.equal(cardDetail.match(/status === "unconfirmed"/g)?.length, 1);
assert.match(view, /\{status === "unconfirmed" && latest\.kind === "code" \? \(\n\t+<details className="shipit-seo-verification-tag">\n\t+<summary>Previously loaded tag<\/summary>\n\t+<pre tabIndex=\{0\}>\{verificationMetaTag\(provider, latest\.code\)\}<\/pre>/,
	"a disclosure remains only for the previously loaded tag of an unconfirmed save");
assert.equal(view.match(/<details className="shipit-seo-verification-tag">/g)?.length, 1);
// The tag EmDash adds is live code built from the draft, under the input.
assert.match(view, /const liveCode = !field\.remove && field\.draft\.trim\(\) && !problem \? field\.draft\.trim\(\) : null;/);
assert.match(view, /const liveLabel = liveCode === null \? "Tag shape"\n\t+: status === "unconfirmed" \? "Tag from the unconfirmed save"\n\t+: edited \? "Tag EmDash adds after saving" : "Tag EmDash adds";/,
	"an unconfirmed save is never labelled as the current tag");
assert.match(view, /<div className="shipit-seo-verification-live-tag">\n\t+<span>\{liveLabel\}<\/span>\n\t+<code>\{verificationMetaTag\(provider, liveCode \?\? "YOUR_CODE"\)\}<\/code>/);
assert.ok(view.indexOf("shipit-seo-verification-live-tag") > view.indexOf('label="Verification code"'), "the live tag follows the input");
assert.match(view, /data-seo-setting=\{VERIFICATION_SETTING_IDS\[provider\]\}/);
assert.match(view, /const VERIFICATION_SETTING_IDS: Record<VerificationProvider, string> = \{ google: "googleCode", bing: "bingCode" \};/);
// The host-settings note is visible and each save names its scope.
assert.match(view, /<p className="shipit-seo-verification-host-note">\n\t+EmDash Settings \{">"\} SEO edits the same Google and Bing fields;[^\n]*\n\t+<a className="shipit-seo-verification-link" href=\{CORE_SEO_SETTINGS_PATH\}>Open EmDash SEO settings<\/a>/);
assert.ok(view.indexOf("shipit-seo-verification-host-note") < view.indexOf("<details className=\"shipit-seo-panel shipit-seo-verification-help\">"), "the note is outside the help disclosure");
assert.match(view, /aria-label="Save Google and Bing codes"/);
assert.match(view, /Save Google and Bing codes\n\t+<\/Button>/);
assert.doesNotMatch(view, />\s*Save changes\s*</, "the save names what it saves");
const custom = read("./custom-verification-view.tsx");
assert.match(custom, />Save custom tags<\/Button>/);
assert.match(custom, /Saves only the custom tags\. Google and Bing codes have their own save above\./);
assert.match(custom, /<code className="shipit-seo-custom-verification__tag">\{customVerificationTagText\(\{ name: tag\.name \|\| "service-verification", content: tag\.content \|\| "YOUR_CODE" \}\)\}<\/code>/,
	"custom rows show their tag like the provider cards");
assert.match(view, /readOnly=\{!editable\}/);
assert.match(view, /const readActions = verificationReadActions\(\{ write, busy: busy !== null \}\);/, "read eligibility comes from the model, not the role hint");
assert.equal(view.match(/disabled=\{!readActions\.reload\}/g)?.length, 2, "Reload and Try again");
assert.match(view, /disabled=\{!readActions\.check\} onClick=\{\(\) => void recover\(\)\}/);
assert.match(view, /if \(!verificationRoleRefreshWanted\(hints\.manage, user\.isFetching\)\) return false;\n\t\tvoid user\.refetch\(\);/,
	"an unknown or denied role is reread with an owner-requested read");
const reloadBody = view.slice(view.indexOf("async function reload()"), view.indexOf("async function save()"));
assert.match(reloadBody, /if \(!current \|\| !readActions\.reload\) return;\n\t\tconst token = current\.claim\(\);\n\t\tconst roleRefreshed = refreshRoleForRead\(\);/);
assert.match(reloadBody, /if \(!roleRefreshed\) refreshRole\(result\.problem\);/, "the role is reread at most once per reload");
assert.match(view, /if \(verificationRefusalRereadsRole\(problem\)\) void user\.refetch\(\);/, "refusals use the model's rule for rereading the role");
assert.match(view, /const carried = writeRegistry\.takeHandoff\(\);\n\t\t\tconst restored = restoreVerificationIntent\(verificationFieldsFrom\(result\.snapshot\), \[\.\.\.verificationWriteChanges\(writeRegistry\.current\(\)\), \.\.\.carried\]\);\n\t\t\tsetFields\(restored\);/,
	"a reopened view shows the codes of a running, unconfirmed or departed save or check, read when its first read answers");
for (const [body, handoff] of [
	[saveBody, "verificationSaveHandoff(changes, result)"],
	[view.slice(view.indexOf("async function recover()"), view.indexOf("function edit(")), "result.ok ? verificationRecoveryHandoff(state.pending, result.outcomes) : []"],
] as const) {
	assert.ok(body.includes(handoff), `finish leaves ${handoff}`);
	assert.match(body, /if \(!current\.owns\(token\)\) return;\n\t\twriteRegistry\.takeHandoff\(\);/, "only the view that still owns the result takes its handoff at once");
}
const settleEffect = view.slice(view.indexOf("// A save or check this mount did not run"), view.indexOf("function refreshRole("));
assert.match(settleEffect, /if \(!fields\) return;\n\t\tconst carried = writeRegistry\.takeHandoff\(\);/, "an open view takes a departed operation's handoff only once its fields are loaded");
assert.match(view, /const unsaved = verificationCarriedUnsaved\(restored, result\.snapshot, carried\);\n\t\t\tsetOutcome\(\(previous\) => verificationNoticeAfterHandoff\(previous, unsaved\)\);/,
	"a reopened view warns only about handed-over codes its first read does not hold");
assert.match(settleEffect, /const unsaved = snapshot \? verificationCarriedUnsaved\(restoreVerificationIntent\(fields, carried\), snapshot, carried\) : \[\];\n\t\tsetOutcome\(\(previous\) => verificationNoticeAfterHandoff\(previous, unsaved\)\);/,
	"an open view warns only about handed-over codes its last read does not hold");
assert.doesNotMatch(view, /providers: carried\.map\(/, "the warning never lists every handed-over provider unfiltered");
assert.match(view, /outcome\.providers\.length === 1\s*\? `The \$\{listProviders\(outcome\.providers\)\} entry differs from what this view last read from EmDash and is kept as unsaved\. Reload to see what EmDash stores now, and review it before saving\.`\s*: `The \$\{listProviders\(outcome\.providers\)\} entries differ from what this view last read from EmDash and are kept as unsaved\. Reload to see what EmDash stores now, and review them before saving\.`/,
	"the warning describes kept entries against the observed read, in the singular for one provider and the plural for two");
assert.doesNotMatch(view, /and Bing entry differs|entries differs|entries [^`]*\bis kept/, "no plural list with a singular verb");
assert.doesNotMatch(view, /back in their fields|code sent before this view was reopened/, "it does not claim the earlier sent code itself is shown");
assert.match(view, /function edit\(update: \(previous: VerificationFields\) => VerificationFields\) \{\n\t\tif \(!editable\) return;\n\t\tsetFields\(\(previous\) => \(previous \? update\(previous\) : previous\)\);\n\t\tsetOutcome\(\(previous\) => verificationNoticeAfterEdit\(previous\)\);/,
	"every explicit edit, Undo or choice settles the saved and carried banners");
assert.doesNotMatch(view, /previous\?\.status === "saved" \? null : previous/);
assert.doesNotMatch(view, /reopened is not stored/, "it does not assert what EmDash stores now");
assert.match(view, /writeRegistry\.beginSave\(changes\)/);
assert.match(view, /mergeVerificationSnapshot\(fields, result\.snapshot\)/, "reloading keeps edited drafts");
assert.match(reloadBody, /setOutcome\(\(previous\) => verificationNoticeAfterReload\(previous, \{ ok: false, failure: result\.failure \}\)\);/,
	"a failed reload reports its own failure");
assert.match(reloadBody, /setFields\(next\);\n\t\tsetOutcome\(\(previous\) => verificationNoticeAfterReload\(previous, \{ ok: true, fields: next, snapshot: result\.snapshot \}\)\);/,
	"a successful reload settles the banner against the fields it shows");
assert.doesNotMatch(view, /previous\?\.status === "reload-failed" \? null : previous/, "an earlier refusal no longer outlives a successful reload");
assert.match(view, /const draftSummary = verificationDraftSummary\(fields\);/);
assert.match(view, /: draftSummary\.kind === "invalid"\s*\? `Unsaved changes\. Fix or undo the \$\{listProviders\(draftSummary\.problems\)\} code before saving\.`/,
	"an invalid draft makes the footer report unsaved changes");
assert.match(view, /: draftSummary\.kind === "ready"\s*\? changeSummary\(draftSummary\.changes, fields\)\s*: `No unsaved changes\. Stored codes loaded/,
	"the clean message is reached only when nothing is unsaved");
assert.equal(view.match(/No unsaved changes/g)?.length, 1);
assert.doesNotMatch(view, /summary \|\| `No unsaved changes/, "an empty list of sendable changes no longer reads as clean");

// ---- Copy and states ------------------------------------------------------

assert.doesNotMatch(view, /"Verified"|>Verified<|variant[=:] ?"success"|variant[=:] ?"green"|toasts\.success|useSeoToasts/, "storage is never shown as provider verification or a green success");
for (const label of ["Saved", "Not configured", "Unsaved", "Unconfirmed"]) assert.ok(view.includes(`label: "${label}"`), label);
for (const href of [
	"https://search.google.com/search-console",
	"https://support.google.com/webmasters/answer/9008080?hl=en",
	"https://www.bing.com/webmasters",
	"https://learn.microsoft.com/en-us/bingwebmaster/verifying-wordpress",
]) {
	assert.ok(view.includes(`href: "${href}"`), href);
}
assert.match(view, /target="_blank" rel="noopener noreferrer"/);
assert.doesNotMatch(view, /[\u2013\u2014\u2026\u2018\u2019\u201c\u201d]/, "plain punctuation only");

// ---- Layout ---------------------------------------------------------------

const block = css.slice(css.indexOf("/* Site verification"), css.indexOf("/* Responsive adjustments"));
assert.ok(block.length > 0);
assert.match(block, /\.shipit-seo-verification-providers \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(block, /@container shipit-seo-workspace \(max-width: 760px\) \{\s*\.shipit-seo-verification-providers \{\s*grid-template-columns: minmax\(0, 1fr\);/,
	"provider cards stack in a narrow workspace");
for (const colour of block.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
	const before = block.slice(Math.max(0, colour.index - 48), colour.index);
	assert.match(before, /var\(--[a-z-]+, $/, `colour ${colour[0]} is only a fallback for a host token`);
}
for (const name of view.matchAll(/shipit-seo-verification-[a-z-]+/g)) {
	assert.ok(block.includes(`.${name[0]}`), `${name[0]} has a scoped rule`);
}

// ---- Rendered provider card ------------------------------------------------

{
	const parsed = ts.createSourceFile("site-verification-view.tsx", view, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const pick = (name: string) => {
		const found = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name ||
			ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name));
		assert.equal(found.length, 1, "Exact production declaration: " + name);
		return found[0]!.getText(parsed);
	};
	const compiled = ts.transpileModule(["CORE_SEO_SETTINGS_PATH", "VERIFICATION_SETTING_IDS", "PROVIDER_COPY", "STATUS_BADGES", "problemText", "storedDetail", "ProviderCard"]
		.map(pick).join("\n") + "\nexport { ProviderCard };", { fileName: "provider-card-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
	assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const output = { exports: {} as Record<string, any> };
	const scope = { React, Badge, Button, Input, ArrowSquareOut, ...verification };
	new Function("require", "module", "exports", ...Object.keys(scope), compiled.outputText)(
		(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, output, output.exports, ...Object.values(scope));
	const ProviderCard = output.exports.ProviderCard as (props: Record<string, unknown>) => React.ReactElement;
	const none = { kind: "none" } as const;
	const card = (provider: "google" | "bing", field: Record<string, unknown>, status = "unsaved", latest: unknown = none) =>
		renderToStaticMarkup(ProviderCard({ provider, field: { base: none, draft: "", remove: false, ...field }, latest, status, editable: true,
			onDraft: () => {}, onRemove: () => {}, onUndo: () => {}, onResolve: () => {} }));
	const empty = card("google", {}, "not-configured");
	assert.match(empty, /Tag shape<\/span><code>&lt;meta name=&quot;google-site-verification&quot; content=&quot;YOUR_CODE&quot;&gt;<\/code>/, "an empty input shows the tag shape");
	assert.match(empty, /data-seo-setting="googleCode"/);
	const typed = card("google", { draft: "AbC123xyz" });
	assert.match(typed, /Tag EmDash adds after saving<\/span><code>&lt;meta name=&quot;google-site-verification&quot; content=&quot;AbC123xyz&quot;&gt;<\/code>/,
		"typing a code updates the tag live");
	const stored = { kind: "code", code: "0123ABCD4567EF89" } as const;
	assert.match(card("bing", { base: stored, draft: stored.code }, "saved", stored), /Tag EmDash adds<\/span><code>&lt;meta name=&quot;msvalidate\.01&quot; content=&quot;0123ABCD4567EF89&quot;&gt;/);
	assert.doesNotMatch(card("bing", { base: stored, draft: stored.code }, "saved", stored), /<details/, "a saved tag needs no disclosure");
	const pasted = card("google", { draft: '<meta name="google-site-verification" content="AbC123xyz">' });
	assert.match(pasted, />Use code AbC123xyz<\/span><\/button>/, "a pasted full tag still offers its code");
	assert.match(pasted, /Tag shape<\/span><code>[^<]*YOUR_CODE/, "markup is never echoed as the tag EmDash adds");
	assert.doesNotMatch(card("bing", { base: stored, draft: "", remove: true }, "unsaved", stored), /shipit-seo-verification-live-tag/, "a removal shows no tag");
	const unconfirmed = card("google", { base: stored, draft: "NewCode1" }, "unconfirmed", stored);
	assert.match(unconfirmed, /Tag from the unconfirmed save<\/span>/);
	assert.match(unconfirmed, /<details class="shipit-seo-verification-tag"><summary>Previously loaded tag<\/summary>/);
}

console.log("site verification view selfcheck passed");
