import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	VERIFICATION_CODE_MAX_LENGTH,
	VERIFICATION_PROVIDERS,
	VERIFICATION_PROVIDER_FIELDS,
	checkVerificationDraft,
	createVerificationOwner,
	createVerificationWriteRegistry,
	editVerificationDraft,
	loadVerificationSettings,
	mergeVerificationSnapshot,
	parseVerificationSettings,
	recoverVerificationOutcome,
	removeVerificationCode,
	resolveVerificationChange,
	restoreVerificationIntent,
	sameVerificationCode,
	saveVerificationCodes,
	settleVerificationFields,
	undoVerificationField,
	verificationCarriedUnsaved,
	verificationChanges,
	verificationCodeLength,
	verificationDraftSummary,
	verificationEditable,
	verificationFieldStatus,
	verificationFieldsFrom,
	verificationHostMerges,
	verificationHostVersion,
	verificationIntent,
	verificationMetaTag,
	verificationNoticeAfterEdit,
	verificationNoticeAfterHandoff,
	verificationNoticeAfterReload,
	verificationPatch,
	verificationReadActions,
	verificationReadProblem,
	verificationReadState,
	verificationRecoveryHandoff,
	verificationRefusalRereadsRole,
	verificationRoleHints,
	verificationRoleRefreshWanted,
	verificationSaveBlockers,
	verificationSaveHandoff,
	verificationSaveMayHaveCommitted,
	verificationStoredCodeIsPlain,
	verificationWriteChanges,
	verificationWriteRefusal,
	type VerificationChange,
	type VerificationFields,
	type VerificationNotice,
	type VerificationPatch,
	type VerificationPending,
	type VerificationPortResult,
	type VerificationProvider,
	type VerificationRequestFailure,
	type VerificationSaveResult,
	type VerificationSettingsPort,
	type VerificationSnapshot,
	type VerificationWriteRegistry,
	type VerificationWriteState,
} from "./site-verification.ts";

const source = readFileSync(new URL("./site-verification.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /^import /m, "the model has no React, DOM, host or network imports");

// ---- Provider facts -------------------------------------------------------

assert.deepEqual(VERIFICATION_PROVIDER_FIELDS, {
	google: { field: "googleVerification", metaName: "google-site-verification" },
	bing: { field: "bingVerification", metaName: "msvalidate.01" },
}, "the fields and meta names EmDash 1.1.0 core owns");
assert.equal(VERIFICATION_CODE_MAX_LENGTH, 100, "core's schema limit");

// ---- Host and role hints --------------------------------------------------

assert.equal(verificationHostVersion({ version: "1.1.0", commit: "913cb1bb9" }), "1.1.0");
for (const manifest of [null, undefined, "1.1.0", [], {}, { version: 110 }, { version: "" }]) {
	assert.equal(verificationHostVersion(manifest), null, `no version from ${JSON.stringify(manifest)}`);
}
for (const version of ["1.1.0", "1.2.0", "1.3.0", "1.3.1"]) assert.equal(verificationHostMerges(version), true);
for (const version of ["1.0.1", "1.1.1", "1.4.0", "0.42.0", null]) {
	assert.equal(verificationHostMerges(version), false, `${version} is not verified to merge nested SEO fields`);
}

assert.deepEqual(verificationRoleHints({ status: "success", role: 50 }), { read: "allowed", manage: "allowed" }, "Administrator");
assert.deepEqual(verificationRoleHints({ status: "success", role: 40 }), { read: "allowed", manage: "denied" }, "Editor reads only");
for (const role of [30, 20, 10]) assert.deepEqual(verificationRoleHints({ status: "success", role }), { read: "denied", manage: "denied" });
for (const user of [
	{ status: "success" as const, role: 45 },
	{ status: "success" as const, role: 60 },
	{ status: "success" as const, role: Number.NaN },
	{ status: "success" as const, role: "50" },
	{ status: "success" as const },
	{ status: "pending" as const, role: 50 },
	{ status: "error" as const, role: 50 },
]) {
	assert.deepEqual(verificationRoleHints(user), { read: "unknown", manage: "unknown" }, `unknown role fails closed: ${JSON.stringify(user)}`);
}

// ---- Strict projected reads ----------------------------------------------

function parsed(data: unknown): VerificationSnapshot {
	const result = parseVerificationSettings(data);
	assert.ok(result.ok, `parses ${JSON.stringify(data)}`);
	return result.snapshot;
}

for (const data of [null, undefined, "settings", 7, [], [{ seo: {} }]]) {
	assert.equal(parseVerificationSettings(data).ok, false, `a ${JSON.stringify(data)} response is a failed read, never an empty configuration`);
}
for (const seo of [null, [], "codes", 0, false]) {
	const result = parseVerificationSettings({ title: "Site", seo });
	assert.equal(result.ok, false, `seo ${JSON.stringify(seo)} is malformed, not empty`);
}
assert.deepEqual(parsed({ title: "Site" }), {
	seo: "absent",
	codes: { google: { kind: "none", stored: "absent" }, bing: { kind: "none", stored: "absent" } },
}, "no SEO group stored yet");
const projected = parsed({
	title: "Site",
	seo: { titleSeparator: "|", robotsTxt: "User-agent: *", googleVerification: "G-old", bingVerification: "", defaultOgImage: { mediaId: "m1" } },
	social: { twitter: "@site" },
});
assert.deepEqual(projected, { seo: "object", codes: { google: { kind: "code", code: "G-old" }, bing: { kind: "none", stored: "empty" } } });
assert.deepEqual(Object.keys(projected), ["seo", "codes"], "only the two codes are projected");
assert.doesNotMatch(JSON.stringify(projected), /User-agent|twitter|mediaId|\|/, "neighbouring settings never enter the snapshot");
assert.deepEqual(parsed({ seo: { googleVerification: "  " } }).codes.google, { kind: "code", code: "  " }, "kept exactly as stored and emitted");
assert.deepEqual(parsed({ seo: { googleVerification: 123, bingVerification: null } }).codes, {
	google: { kind: "unreadable", type: "number", identity: "123" },
	bing: { kind: "unreadable", type: "null", identity: "null" },
}, "a value that is not text is kept unreadable, not repaired or shown as empty");

assert.equal(sameVerificationCode({ kind: "none", stored: "absent" }, { kind: "none", stored: "empty" }), true, "absent and empty both emit no tag");
assert.equal(sameVerificationCode({ kind: "code", code: "a" }, { kind: "code", code: "a " }), false);
assert.equal(sameVerificationCode({ kind: "unreadable", type: "number", identity: "1" }, { kind: "unreadable", type: "number", identity: "2" }), false, "a changed unreadable value is noticed");
assert.equal(sameVerificationCode({ kind: "none", stored: "empty" }, { kind: "code", code: "a" }), false);

// ---- Request failures -----------------------------------------------------

const response = (status: number, code: string): VerificationRequestFailure => ({ type: "response", status, code, message: code });
const transport: VerificationRequestFailure = { type: "transport", message: "Failed to fetch" };
for (const [failure, problem, state] of [
	[response(401, "UNAUTHORIZED"), "signed-out", "denied"],
	[response(401, "NOT_AUTHENTICATED"), "signed-out", "denied"],
	[response(403, "ACCOUNT_DISABLED"), "signed-out", "denied"],
	[response(403, "FORBIDDEN"), "forbidden", "denied"],
	[response(403, "CSRF_REJECTED"), "refused", "unavailable"],
	[response(403, "account_disabled"), "refused", "unavailable"],
	[response(404, "NOT_FOUND"), "refused", "unavailable"],
	[response(500, "INTERNAL_ERROR"), "unavailable", "unavailable"],
	[transport, "network", "unavailable"],
	[{ type: "malformed", detail: "x" }, "malformed", "malformed"],
] as const) {
	assert.equal(verificationReadProblem(failure), problem);
	assert.equal(verificationReadState(verificationReadProblem(failure)), state);
}
for (const [failure, refusal] of [
	[response(400, "VALIDATION_ERROR"), "invalid"],
	[response(401, "UNAUTHORIZED"), "signed-out"],
	[response(403, "ACCOUNT_DISABLED"), "signed-out"],
	[response(403, "FORBIDDEN"), "forbidden"],
	[response(403, "CSRF_REJECTED"), "refused"],
	[response(403, "account_disabled"), "refused"],
	[response(413, "PAYLOAD_TOO_LARGE"), "refused"],
	[response(500, "SETTINGS_UPDATE_ERROR"), null],
	[response(502, "UNKNOWN_ERROR"), null],
	[transport, null],
	[{ type: "malformed", detail: "the response was not JSON" }, null],
] as const) {
	assert.equal(verificationWriteRefusal(failure), refusal, `${JSON.stringify(failure)}: a 5xx, lost or unreadable answer may follow a committed write`);
}

// ---- Draft input ----------------------------------------------------------

assert.deepEqual(checkVerificationDraft("google", "AbC123_-x"), { status: "code", code: "AbC123_-x" });
assert.deepEqual(checkVerificationDraft("google", "  AbC123 \n"), { status: "code", code: "AbC123" }, "surrounding whitespace from a paste is dropped");
for (const draft of ["", "   ", "\n\t"]) assert.deepEqual(checkVerificationDraft("bing", draft), { status: "empty" });
assert.deepEqual(checkVerificationDraft("google", "a".repeat(100)), { status: "code", code: "a".repeat(100) }, "100 characters fit");
assert.deepEqual(checkVerificationDraft("google", "a".repeat(101)), { status: "invalid", problem: { reason: "too-long", length: 101 } });
const wide = String.fromCodePoint(0x1f600);
assert.equal(wide.length, 2, "control: a non-BMP character is two UTF-16 units");
assert.equal(verificationCodeLength(wide.repeat(100)), 100);
assert.deepEqual(checkVerificationDraft("google", wide.repeat(100)).status, "code", "core's Zod counts code points, so 100 non-BMP characters fit");
assert.deepEqual(checkVerificationDraft("google", wide.repeat(101)), { status: "invalid", problem: { reason: "too-long", length: 101 } });
for (const draft of ["ab c", "ab\tc", `ab${String.fromCharCode(0x200b)}c`, `ab${String.fromCharCode(0)}c`, `ab${String.fromCharCode(0xa0)}c`]) {
	assert.deepEqual(checkVerificationDraft("bing", draft), { status: "invalid", problem: { reason: "spaces" } }, JSON.stringify(draft));
}
const googleTag = '<meta name="google-site-verification" content="AbC123xyz" />';
assert.deepEqual(checkVerificationDraft("google", googleTag), { status: "invalid", problem: { reason: "markup", code: "AbC123xyz" } },
	"the whole tag is refused, and its content value is offered");
assert.deepEqual(checkVerificationDraft("google", "<META CONTENT='Q9' NAME='Google-Site-Verification'>"), { status: "invalid", problem: { reason: "markup", code: "Q9" } });
assert.deepEqual(checkVerificationDraft("bing", '<meta name=msvalidate.01 content=0123ABCD>'), { status: "invalid", problem: { reason: "markup", code: "0123ABCD" } });
assert.deepEqual(checkVerificationDraft("bing", googleTag), { status: "invalid", problem: { reason: "other-provider", provider: "google" } });
assert.deepEqual(checkVerificationDraft("google", '<meta name="google-site-verification" content="has space">'), { status: "invalid", problem: { reason: "markup", code: null } },
	"a tag whose content is not a usable code offers nothing");
assert.deepEqual(checkVerificationDraft("google", `<meta name="google-site-verification" content="${"a".repeat(101)}">`), { status: "invalid", problem: { reason: "markup", code: null } });
for (const draft of ["<b>AbC</b>", '"AbC123"', "'AbC123'", "AbC>1", '<meta name="description" content="x">']) {
	assert.deepEqual(checkVerificationDraft("google", draft), { status: "invalid", problem: { reason: "markup", code: null } }, draft);
}

assert.equal(verificationStoredCodeIsPlain("google", { kind: "code", code: "AbC" }), true);
assert.equal(verificationStoredCodeIsPlain("google", { kind: "code", code: " AbC" }), false, "flagged, never normalized");
assert.equal(verificationStoredCodeIsPlain("google", { kind: "code", code: googleTag }), false);
assert.equal(verificationStoredCodeIsPlain("bing", { kind: "none", stored: "absent" }), true);
assert.equal(verificationMetaTag("google", "AbC123"), '<meta name="google-site-verification" content="AbC123">');
assert.equal(verificationMetaTag("bing", `a&b"c'd<e>`), '<meta name="msvalidate.01" content="a&amp;b&quot;c&#39;d&lt;e&gt;">', "escaped like core's renderer");

// ---- Fields, clearing and the update body --------------------------------

const loaded = parsed({ seo: { titleSeparator: "|", googleVerification: "G-old" } });
let fields: VerificationFields = verificationFieldsFrom(loaded);
assert.deepEqual(fields.google, { base: { kind: "code", code: "G-old" }, draft: "G-old", remove: false });
assert.deepEqual(verificationChanges(fields), { changes: [], problems: [] }, "loading changes nothing");

fields = editVerificationDraft(fields, "google", " G-old ");
assert.deepEqual(verificationIntent("google", fields.google), { kind: "unchanged" }, "whitespace around the stored code is not a change");
fields = editVerificationDraft(fields, "google", "");
assert.deepEqual(verificationIntent("google", fields.google), { kind: "problem", problem: { reason: "empty" } }, "emptying the input does not clear a code by itself");
fields = removeVerificationCode(fields, "google");
assert.deepEqual(verificationIntent("google", fields.google), { kind: "change", change: { provider: "google", base: { kind: "code", code: "G-old" }, value: "" }, action: "remove" });
assert.deepEqual(verificationPatch(verificationChanges(fields).changes), { seo: { googleVerification: "" } }, "clearing sends an empty string, never null");
assert.doesNotMatch(JSON.stringify(verificationPatch(verificationChanges(fields).changes)), /null/);
fields = editVerificationDraft(fields, "google", "G-new");
assert.equal(fields.google.remove, false, "typing cancels a pending removal");
fields = undoVerificationField(fields, "google");
assert.deepEqual(fields.google, { base: { kind: "code", code: "G-old" }, draft: "G-old", remove: false });
assert.deepEqual(verificationIntent("bing", removeVerificationCode(fields, "bing").bing), { kind: "unchanged" }, "nothing to remove");

fields = editVerificationDraft(editVerificationDraft(fields, "google", "G-new"), "bing", " B-1 ");
const both = verificationChanges(fields).changes;
assert.deepEqual(both.map((change) => [change.provider, change.value]), [["google", "G-new"], ["bing", "B-1"]]);
assert.deepEqual(verificationIntent("bing", fields.bing), {
	kind: "change", change: { provider: "bing", base: { kind: "none", stored: "absent" }, value: "B-1" }, action: "add",
});
assert.deepEqual(verificationPatch(both), { seo: { googleVerification: "G-new", bingVerification: "B-1" } }, "only the changed codes, nothing loaded");
const googleOnly = verificationChanges(editVerificationDraft(verificationFieldsFrom(loaded), "google", "G-new")).changes;
assert.deepEqual(verificationPatch(googleOnly), { seo: { googleVerification: "G-new" } }, "an unchanged provider never enters the update");
assert.deepEqual(Object.keys(verificationPatch(googleOnly)), ["seo"]);

const invalid = editVerificationDraft(verificationFieldsFrom(loaded), "bing", googleTag);
assert.deepEqual(verificationChanges(invalid), { changes: [], problems: ["bing"] });

const spaced = verificationFieldsFrom(parsed({ seo: { googleVerification: " G-spaced " } }));
assert.equal(spaced.google.draft, " G-spaced ", "a stored code is shown exactly");
assert.deepEqual(verificationChanges(editVerificationDraft(spaced, "bing", "B-1")).changes.map((change) => change.provider), ["bing"],
	"editing one provider does not normalize the other's stored value");

const unreadable = verificationFieldsFrom(parsed({ seo: { googleVerification: 42 } }));
assert.equal(unreadable.google.draft, "", "an unreadable value is not shown");
assert.deepEqual(verificationIntent("google", unreadable.google), { kind: "unchanged" }, "and is preserved unless replaced or removed");
assert.equal(verificationIntent("google", editVerificationDraft(unreadable, "google", "G-1").google).kind, "change");
assert.deepEqual(verificationIntent("google", removeVerificationCode(unreadable, "google").google), {
	kind: "change", change: { provider: "google", base: { kind: "unreadable", type: "number", identity: "42" }, value: "" }, action: "remove",
});

// ---- Core endpoint double -------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ScriptedRead = () => VerificationPortResult;
type ScriptedWrite = (patch: VerificationPatch) => VerificationPortResult;

interface Endpoint {
	settings: Record<string, unknown>;
	log: string[];
	/** Answers used before the stored settings, one per request. */
	reads: ScriptedRead[];
	writes: ScriptedWrite[];
	apply(patch: VerificationPatch): void;
	port: VerificationSettingsPort;
}

/** EmDash 1.1.0's settings endpoint: POST merges each supplied SEO field and returns every setting. */
function endpoint(initial: Record<string, unknown>, mode: "merge" | "replace-group" = "merge"): Endpoint {
	const site: Endpoint = {
		settings: structuredClone(initial),
		log: [],
		reads: [],
		writes: [],
		apply(patch: VerificationPatch): void {
			const stored = isRecord(site.settings.seo) ? site.settings.seo : {};
			const seo: Record<string, unknown> = mode === "merge" ? { ...stored } : {};
			for (const [field, value] of Object.entries(patch.seo)) if (value !== undefined) seo[field] = value;
			site.settings = { ...site.settings, seo };
		},
		port: {
			async read(): Promise<VerificationPortResult> {
				site.log.push("read");
				const scripted: ScriptedRead | undefined = site.reads.shift();
				return scripted ? scripted() : { ok: true, data: structuredClone(site.settings) };
			},
			async write(patch: VerificationPatch): Promise<VerificationPortResult> {
				site.log.push(`write:${JSON.stringify(patch)}`);
				const scripted: ScriptedWrite | undefined = site.writes.shift();
				if (scripted) return scripted(patch);
				site.apply(patch);
				return { ok: true, data: structuredClone(site.settings) };
			},
		},
	};
	return site;
}

/** Holds each read of `port` until released, in the order the reads started. */
function gated(port: VerificationSettingsPort): { port: VerificationSettingsPort; release: () => void } {
	const waiting: (() => void)[] = [];
	return {
		port: {
			read: async (): Promise<VerificationPortResult> => {
				await new Promise<void>((resolve) => waiting.push(resolve));
				return port.read();
			},
			write: (patch: VerificationPatch): Promise<VerificationPortResult> => port.write(patch),
		},
		release: (): void => {
			const next = waiting.shift();
			assert.ok(next, "a read is waiting");
			next();
		},
	};
}

const STORED = {
	title: "Site",
	seo: { titleSeparator: "|", robotsTxt: "User-agent: *\nDisallow: /tmp", googleVerification: "G-old", defaultOgImage: { mediaId: "m1" } },
	social: { twitter: "@site" },
};
const NEIGHBOURS = { titleSeparator: "|", robotsTxt: "User-agent: *\nDisallow: /tmp", defaultOgImage: { mediaId: "m1" } };

async function prepared(stored: Record<string, unknown> = STORED) {
	const site = endpoint(stored);
	const read = await loadVerificationSettings(site.port);
	assert.ok(read.ok);
	assert.deepEqual(site.log, ["read"], "a load is one settings read");
	site.log.length = 0;
	return { site, snapshot: read.snapshot, fields: verificationFieldsFrom(read.snapshot) };
}

function changesFor(fields: VerificationFields, edits: Partial<Record<"google" | "bing", string | null>>): VerificationChange[] {
	let next = fields;
	for (const [provider, draft] of Object.entries(edits) as ["google" | "bing", string | null][]) {
		next = draft === null ? removeVerificationCode(next, provider) : editVerificationDraft(next, provider, draft);
	}
	return verificationChanges(next).changes;
}

const writes = (log: readonly string[]) => log.filter((entry) => entry.startsWith("write")).length;

// Failure controls before any success claim.
{
	// A read failure before writing sends nothing.
	const { site, fields: start } = await prepared();
	for (const [failure, problem] of [[response(500, "INTERNAL_ERROR"), "unavailable"], [response(401, "UNAUTHORIZED"), "signed-out"], [response(403, "FORBIDDEN"), "forbidden"], [transport, "network"]] as const) {
		site.log.length = 0;
		site.reads.push(() => ({ ok: false, failure }));
		const result = await saveVerificationCodes(site.port, changesFor(start, { google: "G-new" }));
		assert.equal(result.status, "not-checked");
		assert.equal(result.status === "not-checked" && result.problem, problem);
		assert.deepEqual(site.log, ["read"], "no write without the preflight read");
	}
	site.log.length = 0;
	site.reads.push(() => ({ ok: true, data: { seo: "broken" } }));
	const malformed = await saveVerificationCodes(site.port, changesFor(start, { google: "G-new" }));
	assert.equal(malformed.status === "not-checked" && malformed.problem, "malformed", "a malformed seo group stops the save");
	assert.equal(writes(site.log), 0);
	assert.deepEqual(site.settings, STORED);
}
{
	// A changed field that is stale refuses the write and keeps the draft.
	const { site, fields: start } = await prepared();
	(site.settings.seo as Record<string, unknown>).googleVerification = "G-other";
	const result = await saveVerificationCodes(site.port, changesFor(start, { google: "G-new" }));
	assert.ok(result.status === "stale");
	assert.deepEqual(result.providers, ["google"]);
	assert.deepEqual(result.latest.codes.google, { kind: "code", code: "G-other" });
	assert.deepEqual(site.log, ["read"], "a known stale snapshot never writes");
	assert.equal((site.settings.seo as Record<string, unknown>).googleVerification, "G-other");
	assert.equal(verificationSaveMayHaveCommitted(result), false);

	const merged = mergeVerificationSnapshot(editVerificationDraft(start, "google", "G-new"), result.latest);
	assert.equal(merged.google.draft, "G-new", "the draft survives");
	assert.deepEqual(merged.google.base, { kind: "code", code: "G-old" }, "and so does the base it started from");
	assert.equal(verificationFieldStatus({ provider: "google", field: merged.google, latest: { kind: "code", code: "G-other" }, pending: null }), "changed");
	const keep = resolveVerificationChange(merged, "google", { kind: "code", code: "G-other" }, "keep-mine");
	assert.deepEqual(verificationIntent("google", keep.google), { kind: "change", change: { provider: "google", base: { kind: "code", code: "G-other" }, value: "G-new" }, action: "replace" },
		"keeping the draft makes the next save a deliberate overwrite");
	const use = resolveVerificationChange(merged, "google", { kind: "code", code: "G-other" }, "use-stored");
	assert.deepEqual(use.google, { base: { kind: "code", code: "G-other" }, draft: "G-other", remove: false });
}
{
	// An absent field becoming empty elsewhere is not a stale change: neither emits a tag.
	const { site, fields: start } = await prepared({ seo: { titleSeparator: "|" } });
	(site.settings.seo as Record<string, unknown>).bingVerification = "";
	const result = await saveVerificationCodes(site.port, changesFor(start, { bing: "B-1" }));
	assert.equal(result.status, "confirmed");
}
{
	// Refusals answer before any write is applied.
	const { site, fields: start } = await prepared();
	for (const [failure, refusal] of [
		[response(400, "VALIDATION_ERROR"), "invalid"],
		[response(401, "UNAUTHORIZED"), "signed-out"],
		[response(403, "FORBIDDEN"), "forbidden"],
		[response(403, "CSRF_REJECTED"), "refused"],
	] as const) {
		site.log.length = 0;
		site.writes.push(() => ({ ok: false, failure }));
		const result = await saveVerificationCodes(site.port, changesFor(start, { google: "G-new" }));
		assert.equal(result.status === "rejected" && result.refusal, refusal);
		assert.deepEqual(site.log, ["read", 'write:{"seo":{"googleVerification":"G-new"}}'], "no confirming read and no retry after a refusal");
		assert.equal(verificationSaveMayHaveCommitted(result), false);
	}
	assert.deepEqual(site.settings, STORED);
}
{
	// A write whose answer is lost after it committed: unconfirmed, never retried, rolled back or read again.
	const { site, fields: start } = await prepared();
	const changes = changesFor(start, { google: "G-new", bing: "B-1" });
	for (const answer of [
		(): VerificationPortResult => ({ ok: false, failure: transport }),
		(): VerificationPortResult => ({ ok: false, failure: response(500, "SETTINGS_UPDATE_ERROR") }),
		(): VerificationPortResult => ({ ok: true, data: undefined }),
		(): VerificationPortResult => ({ ok: true, data: { seo: [] } }),
	]) {
		site.settings = structuredClone(STORED);
		site.log.length = 0;
		site.writes.push((patch: VerificationPatch): VerificationPortResult => {
			site.apply(patch);
			return answer();
		});
		const result = await saveVerificationCodes(site.port, changes);
		assert.equal(result.status, "unconfirmed");
		assert.equal(result.status === "unconfirmed" && result.pending.cause, "write");
		assert.equal(site.log.length, 2, "preflight and one write, no automatic read");
		assert.equal(writes(site.log), 1, "never retried");
		assert.equal((site.settings.seo as Record<string, unknown>).googleVerification, "G-new", "never rolled back");
		assert.equal(verificationSaveMayHaveCommitted(result), true, "the host's cached settings are invalidated");
	}
}
{
	// Accepted, but the confirming read failed.
	const { site, fields: start } = await prepared();
	site.reads.push(() => ({ ok: true, data: structuredClone(site.settings) }), () => ({ ok: false, failure: transport }));
	const result = await saveVerificationCodes(site.port, changesFor(start, { google: "G-new" }));
	assert.equal(result.status === "unconfirmed" && result.pending.cause, "readback");
	assert.deepEqual(site.log, ["read", 'write:{"seo":{"googleVerification":"G-new"}}', "read"]);
}
{
	// Accepted, then another save replaced one code before the confirming read.
	const { site, fields: start } = await prepared();
	site.reads.push(() => ({ ok: true, data: structuredClone(site.settings) }), () => {
		(site.settings.seo as Record<string, unknown>).googleVerification = "G-later";
		return { ok: true, data: structuredClone(site.settings) };
	});
	const sentFields = editVerificationDraft(editVerificationDraft(start, "google", "G-new"), "bing", "B-1");
	const result = await saveVerificationCodes(site.port, verificationChanges(sentFields).changes);
	assert.equal(result.status, "conflict", "a differing readback is a conflict, not success");
	assert.deepEqual(result.status === "conflict" && [result.confirmed, result.replaced], [["bing"], ["google"]]);
	assert.equal(verificationSaveMayHaveCommitted(result), true);
	if (result.status === "conflict") {
		const settled = settleVerificationFields(sentFields, sentFields, result.latest, ["google", "bing"], result.confirmed);
		assert.deepEqual(settled.bing, { base: { kind: "code", code: "B-1" }, draft: "B-1", remove: false });
		assert.deepEqual(settled.google, { base: { kind: "code", code: "G-later" }, draft: "G-new", remove: false }, "the replaced draft is kept over the latest value");
		assert.equal(verificationFieldStatus({ provider: "google", field: settled.google, latest: result.latest.codes.google, pending: null }), "unsaved");
	}
}
{
	// Control: posting the whole loaded group, as EmDash's own SEO form does, reverts a newer neighbouring change.
	const { site, snapshot } = await prepared();
	assert.equal(snapshot.seo, "object");
	const loadedGroup = structuredClone(STORED.seo);
	(site.settings.seo as Record<string, unknown>).robotsTxt = "User-agent: *\nDisallow: /newer";
	site.apply({ seo: { ...loadedGroup, googleVerification: "G-new" } } as VerificationPatch);
	assert.equal((site.settings.seo as Record<string, unknown>).robotsTxt, "User-agent: *\nDisallow: /tmp", "control: a full-object save loses the newer robots text");
}
{
	// Control: a host that replaces the whole group (EmDash 1.0.1) confirms the codes yet erases the neighbours,
	// so confirmation cannot protect them and saving is limited to merging hosts.
	const site = endpoint(STORED, "replace-group");
	const start = verificationFieldsFrom((await loadVerificationSettings(site.port) as { ok: true; snapshot: VerificationSnapshot }).snapshot);
	const result = await saveVerificationCodes(site.port, changesFor(start, { bing: "B-1" }));
	assert.equal(result.status, "confirmed");
	assert.equal((site.settings.seo as Record<string, unknown>).titleSeparator, undefined, "control: neighbours are gone on a replacing host");
	assert.equal(verificationHostMerges("1.0.1"), false);
}

// Success after the controls: only changed codes are sent and every neighbour survives.
{
	const { site, fields: start } = await prepared();
	const result = await saveVerificationCodes(site.port, changesFor(start, { google: "G-new", bing: "B-1" }));
	assert.equal(result.status, "confirmed");
	assert.deepEqual(result.status === "confirmed" && result.providers, ["google", "bing"]);
	assert.deepEqual(site.log, ["read", 'write:{"seo":{"googleVerification":"G-new","bingVerification":"B-1"}}', "read"], "one preflight, one write, one confirming read");
	assert.deepEqual(site.settings, { ...STORED, seo: { ...NEIGHBOURS, googleVerification: "G-new", bingVerification: "B-1" } });
	assert.equal(verificationSaveMayHaveCommitted(result), true);
}
{
	// An unchanged provider that changed elsewhere neither blocks nor enters the update.
	const { site, fields: start } = await prepared();
	(site.settings.seo as Record<string, unknown>).bingVerification = "B-elsewhere";
	const result = await saveVerificationCodes(site.port, changesFor(start, { google: "G-new" }));
	assert.equal(result.status, "confirmed");
	assert.deepEqual(site.log[1], 'write:{"seo":{"googleVerification":"G-new"}}');
	assert.equal((site.settings.seo as Record<string, unknown>).bingVerification, "B-elsewhere");
	if (result.status === "confirmed") {
		const settled = settleVerificationFields(start, start, result.latest, ["google"], result.providers);
		assert.equal(settled.bing.draft, "B-elsewhere", "an untouched field follows the latest read");
	}
}
{
	// Clearing one provider stops its tag and keeps the other and every neighbour.
	const { site, fields: start } = await prepared({ ...STORED, seo: { ...STORED.seo, bingVerification: "B-1" } });
	const result = await saveVerificationCodes(site.port, changesFor(start, { google: null }));
	assert.ok(result.status === "confirmed");
	assert.deepEqual(site.settings.seo, { ...NEIGHBOURS, googleVerification: "", bingVerification: "B-1" });
	assert.deepEqual(result.latest.codes.google, { kind: "none", stored: "empty" });
	const second = await saveVerificationCodes(site.port, changesFor(verificationFieldsFrom(result.latest), { bing: null }));
	assert.equal(second.status, "confirmed");
	assert.deepEqual(site.settings.seo, { ...NEIGHBOURS, googleVerification: "", bingVerification: "" }, "both cleared, neighbours intact");
}
{
	// A field edited after the save started keeps the newer edit.
	const { site, fields: start } = await prepared();
	const sent = editVerificationDraft(start, "google", "G-new");
	const result = await saveVerificationCodes(site.port, verificationChanges(sent).changes);
	assert.ok(result.status === "confirmed");
	const newer = editVerificationDraft(sent, "google", "G-newer");
	const settled = settleVerificationFields(newer, sent, result.latest, ["google"], result.providers);
	assert.deepEqual(settled.google, { base: { kind: "code", code: "G-old" }, draft: "G-newer", remove: false }, "a late result never overwrites a newer draft");
	assert.deepEqual(settleVerificationFields(sent, sent, result.latest, ["google"], result.providers).google, { base: { kind: "code", code: "G-new" }, draft: "G-new", remove: false });
}

await assert.rejects(saveVerificationCodes(endpoint(STORED).port, []), TypeError, "a save needs a change");
{
	const { fields: start } = await prepared();
	const [change] = changesFor(start, { google: "G-new" });
	await assert.rejects(saveVerificationCodes(endpoint(STORED).port, [change!, change!]), TypeError, "one change per provider");
}

// ---- Recovery: one owner-requested read -----------------------------------

{
	const changes: VerificationChange[] = [
		{ provider: "google", base: { kind: "code", code: "G-old" }, value: "G-new" },
		{ provider: "bing", base: { kind: "none", stored: "absent" }, value: "B-1" },
	];
	const pending: VerificationPending = { changes, cause: "write", failure: transport };
	const site = endpoint({ seo: { googleVerification: "G-new", bingVerification: "B-other" } });
	const result = await recoverVerificationOutcome(site.port, pending);
	assert.deepEqual(site.log, ["read"], "recovery is one read");
	assert.ok(result.ok);
	assert.deepEqual(result.outcomes, [{ provider: "google", outcome: "sent" }, { provider: "bing", outcome: "other" }]);
	const previous = await recoverVerificationOutcome(endpoint({ seo: { googleVerification: "G-old" } }).port, pending);
	assert.deepEqual(previous.ok && previous.outcomes, [{ provider: "google", outcome: "previous" }, { provider: "bing", outcome: "previous" }]);
	const failed = endpoint({});
	failed.reads.push(() => ({ ok: false, failure: response(503, "UNAVAILABLE") }));
	const unread = await recoverVerificationOutcome(failed.port, pending);
	assert.equal(unread.ok, false);
	assert.equal(writes(failed.log), 0, "recovery never writes");
}

// ---- Reopening the view around an unconfirmed save ------------------------

/** The view's mount when its first read answers: codes of a running, unconfirmed or departed operation restored. */
function received(snapshot: VerificationSnapshot, registry: VerificationWriteRegistry): VerificationFields {
	const carried = registry.takeHandoff();
	return restoreVerificationIntent(verificationFieldsFrom(snapshot), [...verificationWriteChanges(registry.current()), ...carried]);
}

async function mount(site: Endpoint, registry: VerificationWriteRegistry) {
	const read = await loadVerificationSettings(site.port);
	assert.ok(read.ok);
	return { snapshot: read.snapshot, fields: received(read.snapshot, registry) };
}

/** The view's "Check stored codes": one read, then the sent codes settled over the fields it has, if any. */
async function check(site: Endpoint, registry: VerificationWriteRegistry, fields: VerificationFields | null) {
	const state = registry.current();
	assert.ok(state.status === "unconfirmed");
	const ticket = registry.beginRecovery();
	assert.ok(ticket);
	const reads = site.log.length;
	const result = await recoverVerificationOutcome(site.port, state.pending);
	registry.finish(ticket, result.ok ? null : state.pending, result.ok ? verificationRecoveryHandoff(state.pending, result.outcomes) : []);
	registry.takeHandoff();
	assert.ok(result.ok);
	assert.equal(site.log.length - reads, 1, "the check is one read");
	const changed = state.pending.changes.map((change) => change.provider);
	const sent = result.outcomes.filter((item) => item.outcome === "sent").map((item) => item.provider);
	const before = restoreVerificationIntent(fields ?? verificationFieldsFrom(result.latest), state.pending.changes);
	return { latest: result.latest, outcomes: result.outcomes, fields: settleVerificationFields(before, before, result.latest, changed, sent) };
}

/** A save from the first mount whose answer is lost; `applied` says whether core stored it first. */
async function lostSave(site: Endpoint, registry: VerificationWriteRegistry, fields: VerificationFields, applied: boolean) {
	const changes = verificationChanges(fields).changes;
	const ticket = registry.beginSave(changes);
	assert.ok(ticket);
	site.writes.push((patch: VerificationPatch): VerificationPortResult => {
		if (applied) site.apply(patch);
		return { ok: false, failure: transport };
	});
	const result = await saveVerificationCodes(site.port, changes);
	assert.ok(result.status === "unconfirmed");
	registry.finish(ticket, result.pending, verificationSaveHandoff(changes, result));
	return result.pending;
}

const G_OLD = { kind: "code", code: "G-old" } as const;

{
	// Not applied: the view is left after the lost answer, reopened, then checked.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	const owner = createVerificationOwner();
	const token = owner.claim();
	await lostSave(site, registry, editVerificationDraft(first.fields, "google", "G-new"), false);
	owner.close();
	assert.equal(owner.owns(token), false, "the first mount applies nothing after it is left");

	const second = await mount(site, registry);
	const plain = verificationFieldsFrom(second.snapshot);
	assert.equal(plain.google.draft, "G-old", "control: fields built only from the read lose the entry");
	assert.deepEqual(second.fields.google, { base: G_OLD, draft: "G-new", remove: false }, "the reopened view shows the sent code");
	assert.deepEqual(second.fields.bing, plain.bing, "a provider the save did not send stays as read");
	const unknown = registry.current();
	assert.ok(unknown.status === "unconfirmed");
	assert.equal(verificationFieldStatus({ provider: "google", field: second.fields.google, latest: second.snapshot.codes.google, pending: unknown.pending }), "unconfirmed");
	assert.equal(verificationEditable({ snapshot: second.snapshot, hostVersion: "1.1.0", manage: "allowed", write: unknown, busy: false }), false, "read-only until the check");
	assert.deepEqual(verificationReadActions({ write: unknown, busy: false }), { reload: false, check: true });

	const checked = await check(site, registry, second.fields);
	assert.equal(settleVerificationFields(plain, plain, checked.latest, ["google"], []).google.draft, "G-old", "control: settling read-only fields drops the entry");
	assert.deepEqual(checked.outcomes, [{ provider: "google", outcome: "previous" }]);
	assert.deepEqual(checked.fields.google, { base: G_OLD, draft: "G-new", remove: false }, "the entry is kept, as the view says");
	assert.deepEqual(registry.current(), { status: "idle", settled: 2 });
	assert.deepEqual(verificationSaveBlockers({ snapshot: checked.latest, fields: checked.fields, hostVersion: "1.1.0", manage: "allowed", write: registry.current(), busy: false }), []);
	const again = await saveVerificationCodes(site.port, verificationChanges(checked.fields).changes);
	assert.equal(again.status, "confirmed", "the kept entry can be saved deliberately");
	assert.deepEqual(site.settings.seo, { ...NEIGHBOURS, googleVerification: "G-new" });
}
{
	// Applied: a removal and an addition were stored before the answer was lost.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	await lostSave(site, registry, removeVerificationCode(editVerificationDraft(first.fields, "bing", "B-1"), "google"), true);
	const second = await mount(site, registry);
	assert.deepEqual(second.snapshot.codes, { google: { kind: "none", stored: "empty" }, bing: { kind: "code", code: "B-1" } });
	assert.deepEqual(verificationChanges(second.fields).changes, [], "restored codes that are already stored are not a change");
	const checked = await check(site, registry, second.fields);
	assert.deepEqual(checked.outcomes, [{ provider: "google", outcome: "sent" }, { provider: "bing", outcome: "sent" }]);
	assert.deepEqual(checked.fields, verificationFieldsFrom(checked.latest));
	assert.equal(verificationFieldStatus({ provider: "bing", field: checked.fields.bing, latest: checked.latest.codes.bing, pending: null }), "saved");
	assert.deepEqual(site.settings.seo, { ...NEIGHBOURS, googleVerification: "", bingVerification: "B-1" });
}
{
	// The reopened view's first read fails; the check rebuilds the entry from the registry.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	await lostSave(site, registry, editVerificationDraft(first.fields, "google", "G-new"), false);
	site.reads.push(() => ({ ok: false, failure: transport }));
	assert.equal((await loadVerificationSettings(site.port)).ok, false);
	assert.deepEqual(verificationReadActions({ write: registry.current(), busy: false }), { reload: false, check: true }, "the check is the way forward");
	const checked = await check(site, registry, null);
	assert.deepEqual(checked.fields.google, { base: G_OLD, draft: "G-new", remove: false }, "not lost with the failed read");
	assert.deepEqual(checked.fields.bing, verificationFieldsFrom(checked.latest).bing);
}
{
	// The view is left while the save is still running and reopened before it answers.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	const changes = verificationChanges(editVerificationDraft(first.fields, "google", "G-new")).changes;
	const running = registry.beginSave(changes);
	assert.ok(running);
	const second = await mount(site, registry);
	assert.deepEqual(second.fields.google, { base: G_OLD, draft: "G-new", remove: false }, "the running save's code is shown");
	assert.equal(verificationEditable({ snapshot: second.snapshot, hostVersion: "1.1.0", manage: "allowed", write: registry.current(), busy: false }), false);
	assert.deepEqual(verificationReadActions({ write: registry.current(), busy: false }), { reload: false, check: false });
	assert.deepEqual(restoreVerificationIntent(editVerificationDraft(second.fields, "google", "G-mine"), changes).google.draft, "G-mine", "a newer draft is never overwritten");
	assert.deepEqual(restoreVerificationIntent(second.fields, changes).bing, second.fields.bing, "an untouched provider stays as read");

	// It answers unconfirmed without having been applied: the check keeps the entry.
	registry.finish(running, { changes, cause: "write", failure: transport });
	const checked = await check(site, registry, second.fields);
	assert.deepEqual(checked.fields.google, { base: G_OLD, draft: "G-new", remove: false });
}
{
	// The first mount's save is confirmed while the view is reopened: a reload adopts the stored code, no conflict.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	const changes = verificationChanges(editVerificationDraft(first.fields, "google", "G-new")).changes;
	const running = registry.beginSave(changes);
	assert.ok(running);
	const second = await mount(site, registry);
	site.apply(verificationPatch(changes));
	registry.finish(running, null);
	const reread = await loadVerificationSettings(site.port);
	assert.ok(reread.ok);
	const merged = mergeVerificationSnapshot(second.fields, reread.snapshot);
	assert.deepEqual(merged.google, { base: { kind: "code", code: "G-new" }, draft: "G-new", remove: false });
	assert.deepEqual(verificationSaveBlockers({ snapshot: reread.snapshot, fields: merged, hostVersion: "1.1.0", manage: "allowed", write: registry.current(), busy: false }), ["unchanged"]);
}

{
	// Exact order: Check starts, the view is left and reopened, the departing Check answers with the old
	// code, and only then does the reopened view's first read answer.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	await lostSave(site, registry, editVerificationDraft(first.fields, "google", "G-new"), false);
	const unknown = registry.current();
	assert.ok(unknown.status === "unconfirmed");
	const departing = createVerificationOwner();
	const departingToken = departing.claim();
	const ticket = registry.beginRecovery();
	assert.ok(ticket);
	const gate = gated(site.port);
	const departingCheck = recoverVerificationOutcome(gate.port, unknown.pending);
	departing.close();
	const reopenedRead = loadVerificationSettings(gate.port);
	gate.release();
	const checked = await departingCheck;
	assert.ok(checked.ok);
	assert.deepEqual(checked.outcomes, [{ provider: "google", outcome: "previous" }]);
	registry.finish(ticket, null, verificationRecoveryHandoff(unknown.pending, checked.outcomes));
	assert.equal(departing.owns(departingToken), false, "the departing view drops its result and takes nothing");
	assert.deepEqual(registry.current(), { status: "idle", settled: 2 });
	assert.deepEqual(verificationWriteChanges(registry.current()), [], "control: the registry state alone no longer holds the sent code");
	gate.release();
	const reopened = await reopenedRead;
	assert.ok(reopened.ok);
	assert.equal(verificationFieldsFrom(reopened.snapshot).google.draft, "G-old", "control: fields from the read alone lose it");
	const fields = received(reopened.snapshot, registry);
	assert.deepEqual(fields.google, { base: G_OLD, draft: "G-new", remove: false }, "the reopened view receives the sent code");
	assert.deepEqual(fields.bing, verificationFieldsFrom(reopened.snapshot).bing, "an untouched provider stays as read");
	assert.deepEqual(registry.takeHandoff(), [], "handed over once");
	assert.deepEqual(verificationChanges(fields).changes.map((change) => [change.provider, change.value]), [["google", "G-new"]], "and can be saved deliberately");
	assert.deepEqual(restoreVerificationIntent(editVerificationDraft(fields, "google", "G-mine"), unknown.pending.changes).google.draft, "G-mine",
		"a newer draft is never overwritten by a handoff");
}
{
	// Same order, but core had stored the code: the check finds it, nothing is handed over, the stored code shows as saved.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	await lostSave(site, registry, editVerificationDraft(first.fields, "google", "G-new"), true);
	const unknown = registry.current();
	assert.ok(unknown.status === "unconfirmed");
	const ticket = registry.beginRecovery();
	assert.ok(ticket);
	const gate = gated(site.port);
	const departingCheck = recoverVerificationOutcome(gate.port, unknown.pending);
	const reopenedRead = loadVerificationSettings(gate.port);
	gate.release();
	const checked = await departingCheck;
	assert.ok(checked.ok);
	assert.deepEqual(checked.outcomes, [{ provider: "google", outcome: "sent" }]);
	registry.finish(ticket, null, verificationRecoveryHandoff(unknown.pending, checked.outcomes));
	gate.release();
	const reopened = await reopenedRead;
	assert.ok(reopened.ok);
	const fields = received(reopened.snapshot, registry);
	assert.deepEqual(fields, verificationFieldsFrom(reopened.snapshot));
	assert.equal(verificationFieldStatus({ provider: "google", field: fields.google, latest: reopened.snapshot.codes.google, pending: null }), "saved");
}
{
	// The reopened view's first read answers while the departing Check still runs; the open view then takes the handoff once.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	await lostSave(site, registry, editVerificationDraft(first.fields, "google", "G-new"), false);
	const unknown = registry.current();
	assert.ok(unknown.status === "unconfirmed");
	const ticket = registry.beginRecovery();
	assert.ok(ticket);
	const gate = gated(site.port);
	const departingCheck = recoverVerificationOutcome(gate.port, unknown.pending);
	const reopenedRead = loadVerificationSettings(gate.port);
	gate.release();
	gate.release();
	const reopened = await reopenedRead;
	assert.ok(reopened.ok);
	assert.equal(registry.current().status, "checking");
	const open = received(reopened.snapshot, registry);
	assert.deepEqual(open.google, { base: G_OLD, draft: "G-new", remove: false }, "restored from the running check");
	const checked = await departingCheck;
	assert.ok(checked.ok);
	registry.finish(ticket, null, verificationRecoveryHandoff(unknown.pending, checked.outcomes));
	const carried = registry.takeHandoff();
	assert.deepEqual(carried.map((change) => change.provider), ["google"]);
	assert.deepEqual(restoreVerificationIntent(open, carried), open, "taking it again changes nothing in the open view");
	assert.deepEqual(registry.takeHandoff(), [], "and a later view gets nothing stale");
}
{
	// A save left in flight is refused after the reopened view's first read started: its codes are handed over too.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	const changes = verificationChanges(editVerificationDraft(editVerificationDraft(first.fields, "google", "G-new"), "bing", "B-1")).changes;
	const ticket = registry.beginSave(changes);
	assert.ok(ticket);
	const gate = gated(site.port);
	const reopenedRead = loadVerificationSettings(gate.port);
	site.writes.push((): VerificationPortResult => ({ ok: false, failure: response(403, "FORBIDDEN") }));
	const refused = await saveVerificationCodes(site.port, changes);
	assert.ok(refused.status === "rejected");
	registry.finish(ticket, null, verificationSaveHandoff(changes, refused));
	gate.release();
	const reopened = await reopenedRead;
	assert.ok(reopened.ok);
	const fields = received(reopened.snapshot, registry);
	assert.deepEqual(verificationChanges(fields).changes.map((change) => [change.provider, change.value]), [["google", "G-new"], ["bing", "B-1"]],
		"the refused codes are back as unsaved entries");
	assert.deepEqual(site.settings, STORED, "nothing was written");
}
{
	const latest = parsed({ seo: { googleVerification: "G-later" } });
	const changes: VerificationChange[] = [
		{ provider: "google", base: G_OLD, value: "G-new" },
		{ provider: "bing", base: { kind: "none", stored: "absent" }, value: "B-1" },
	];
	const pending: VerificationPending = { changes, cause: "write", failure: transport };
	assert.deepEqual(verificationSaveHandoff(changes, { status: "confirmed", latest, providers: ["google", "bing"] }), []);
	assert.deepEqual(verificationSaveHandoff(changes, { status: "unconfirmed", pending }), [], "the pending record keeps them");
	assert.deepEqual(verificationSaveHandoff(changes, { status: "conflict", latest, confirmed: ["bing"], replaced: ["google"] }), [changes[0]]);
	assert.deepEqual(verificationSaveHandoff(changes, { status: "stale", providers: ["google"], latest }), changes);
	assert.deepEqual(verificationSaveHandoff(changes, { status: "rejected", refusal: "invalid", failure: response(400, "VALIDATION_ERROR") }), changes);
	assert.deepEqual(verificationSaveHandoff(changes, { status: "not-checked", problem: "network", failure: transport }), changes);
	assert.deepEqual(verificationRecoveryHandoff(pending, [{ provider: "google", outcome: "sent" }, { provider: "bing", outcome: "other" }]), [changes[1]]);
	assert.deepEqual(verificationRecoveryHandoff(pending, [{ provider: "google", outcome: "previous" }, { provider: "bing", outcome: "sent" }]), [changes[0]]);
}

// ---- Signing in again ------------------------------------------------------

{
	const idle = { status: "idle", settled: 0 } as const;
	const pending: VerificationPending = { changes: [{ provider: "google", base: G_OLD, value: "G-new" }], cause: "write", failure: transport };
	for (const [write, busy, actions] of [
		[idle, false, { reload: true, check: false }],
		[idle, true, { reload: false, check: false }],
		[{ status: "saving", settled: 0, changes: pending.changes }, false, { reload: false, check: false }],
		[{ status: "unconfirmed", settled: 1, pending }, false, { reload: false, check: true }],
		[{ status: "unconfirmed", settled: 1, pending }, true, { reload: false, check: false }],
		[{ status: "checking", settled: 1, pending }, false, { reload: false, check: false }],
	] as const) {
		assert.deepEqual(verificationReadActions({ write, busy }), actions, `${write.status}${busy ? " while busy" : ""}: reads never depend on the role hint`);
	}
	assert.equal(verificationRoleRefreshWanted("unknown", false), true, "a failed or missing role is reread with the owner's read");
	assert.equal(verificationRoleRefreshWanted("denied", false), true, "so is a denied one, which may be stale");
	assert.equal(verificationRoleRefreshWanted("allowed", false), false);
	assert.equal(verificationRoleRefreshWanted("unknown", true), false, "not while a role read is already running");

	// Signed out: the role read failed. After signing in elsewhere, Reload rereads settings and the role once.
	const snapshot = parsed({ seo: { googleVerification: "G-old" } });
	const drafts = editVerificationDraft(verificationFieldsFrom(snapshot), "google", "G-new");
	const signedOut = verificationRoleHints({ status: "error" });
	assert.deepEqual(verificationSaveBlockers({ snapshot, fields: drafts, hostVersion: "1.1.0", manage: signedOut.manage, write: idle, busy: false }), ["role-unknown"]);
	assert.equal(verificationRoleRefreshWanted(signedOut.manage, false), true);
	const reloaded = mergeVerificationSnapshot(drafts, snapshot);
	assert.equal(reloaded.google.draft, "G-new", "the draft survives the reload");
	const signedIn = verificationRoleHints({ status: "success", role: 50 });
	assert.deepEqual(verificationSaveBlockers({ snapshot, fields: reloaded, hostVersion: "1.1.0", manage: signedIn.manage, write: idle, busy: false }), [],
		"saving is possible again; the endpoint still decides");
	assert.equal(verificationRoleRefreshWanted(signedIn.manage, false), false, "and the role is not reread again");
	const editor = verificationRoleHints({ status: "success", role: 40 });
	assert.deepEqual(verificationSaveBlockers({ snapshot, fields: reloaded, hostVersion: "1.1.0", manage: editor.manage, write: idle, busy: false }), ["role"], "an Editor stays read-only");
}

// ---- Status, blockers and editability ------------------------------------

{
	const snapshot = parsed({ seo: { googleVerification: "G-old", bingVerification: 7 } });
	const start = verificationFieldsFrom(snapshot);
	const idle: VerificationWriteState = { status: "idle", settled: 0 };
	const pending: VerificationPending = { changes: [{ provider: "google", base: { kind: "code", code: "G-old" }, value: "G-new" }], cause: "write", failure: transport };
	const statuses = [
		verificationFieldStatus({ provider: "google", field: start.google, latest: snapshot.codes.google, pending: null }),
		verificationFieldStatus({ provider: "bing", field: start.bing, latest: snapshot.codes.bing, pending: null }),
		verificationFieldStatus({ provider: "google", field: editVerificationDraft(start, "google", "G-new").google, latest: snapshot.codes.google, pending: null }),
		verificationFieldStatus({ provider: "google", field: start.google, latest: snapshot.codes.google, pending }),
		verificationFieldStatus({ provider: "bing", field: start.bing, latest: snapshot.codes.bing, pending }),
		verificationFieldStatus({ provider: "google", field: verificationFieldsFrom(parsed({})).google, latest: { kind: "none", stored: "absent" }, pending: null }),
	];
	assert.deepEqual(statuses, ["saved", "unreadable", "unsaved", "unconfirmed", "unreadable", "not-configured"]);
	assert.ok(!statuses.some((status) => /verif/i.test(status)), "storage never reads as provider verification");

	const ready = { snapshot, fields: editVerificationDraft(start, "google", "G-new"), hostVersion: "1.1.0", manage: "allowed" as const, write: idle, busy: false };
	assert.deepEqual(verificationSaveBlockers(ready), [], "control: an eligible save has no blockers");
	assert.deepEqual(verificationSaveBlockers({ ...ready, snapshot: null, fields: null }), ["settings-unavailable"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, hostVersion: "1.0.1" }), ["host-unverified"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, hostVersion: null }), ["host-unverified"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, manage: "denied" }), ["role"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, manage: "unknown" }), ["role-unknown"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, write: { status: "unconfirmed", settled: 1, pending } }), ["unconfirmed"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, write: { status: "checking", settled: 1, pending } }), ["unconfirmed"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, write: { status: "saving", settled: 0, changes: [] } }), ["write-in-progress"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, busy: true }), ["busy"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, fields: start }), ["unchanged"]);
	assert.deepEqual(verificationSaveBlockers({ ...ready, fields: editVerificationDraft(ready.fields, "bing", "<p>") }), ["invalid"]);
	const stale = parsed({ seo: { googleVerification: "G-other", bingVerification: 7 } });
	assert.deepEqual(verificationSaveBlockers({ ...ready, snapshot: stale, fields: mergeVerificationSnapshot(ready.fields, stale) }), ["changed"]);

	const editable = { snapshot, hostVersion: "1.1.0", manage: "allowed" as const, write: idle, busy: false };
	assert.equal(verificationEditable(editable), true);
	for (const blocked of [
		{ ...editable, snapshot: null },
		{ ...editable, hostVersion: "1.0.1" },
		{ ...editable, manage: "denied" as const },
		{ ...editable, manage: "unknown" as const },
		{ ...editable, write: { status: "saving", settled: 0, changes: [] } as const },
		{ ...editable, write: { status: "unconfirmed", settled: 1, pending } as const },
		{ ...editable, busy: true },
	]) {
		assert.equal(verificationEditable(blocked), false, JSON.stringify(blocked.write ?? blocked));
	}
}

{
	// Control first: a real edit of a code that changed elsewhere keeps its base and blocks the save.
	const loadedCode = parsed({ seo: { googleVerification: "G" } });
	const external = parsed({ seo: { googleVerification: "G-elsewhere" } });
	const idle = { status: "idle", settled: 0 } as const;
	const real = mergeVerificationSnapshot(editVerificationDraft(editVerificationDraft(verificationFieldsFrom(loadedCode), "google", "G-mine"), "bing", "B-1"), external);
	assert.deepEqual(real.google.base, { kind: "code", code: "G" });
	assert.deepEqual(verificationSaveBlockers({ snapshot: external, fields: real, hostVersion: "1.1.0", manage: "allowed", write: idle, busy: false }), ["changed"]);

	// A whitespace-only edit changes nothing, so after a reload it neither blocks another provider nor enters the update.
	const raw = editVerificationDraft(editVerificationDraft(verificationFieldsFrom(loadedCode), "google", " G "), "bing", "B-1");
	assert.deepEqual(verificationSaveBlockers({ snapshot: external, fields: raw, hostVersion: "1.1.0", manage: "allowed", write: idle, busy: false }), [],
		"only codes that would be sent can be stale");
	const reloaded = mergeVerificationSnapshot(raw, external);
	assert.deepEqual(reloaded.google, { base: { kind: "code", code: "G-elsewhere" }, draft: "G-elsewhere", remove: false }, "it follows the newer read");
	assert.deepEqual(reloaded.bing, raw.bing, "the real edit is kept");
	assert.deepEqual(verificationSaveBlockers({ snapshot: external, fields: reloaded, hostVersion: "1.1.0", manage: "allowed", write: idle, busy: false }), []);
	assert.deepEqual(verificationPatch(verificationChanges(reloaded).changes), { seo: { bingVerification: "B-1" } });
	assert.equal(verificationFieldStatus({ provider: "google", field: reloaded.google, latest: external.codes.google, pending: null }), "saved");
	const settled = settleVerificationFields(raw, raw, external, ["bing"], []);
	assert.deepEqual(settled.google, reloaded.google, "a save of the other provider reconciles it the same way");
}

{
	// The save footer reads clean only when no field shows Unsaved, so an invalid draft that cannot be sent is not clean.
	const snapshot = parsed({ seo: { googleVerification: "G-old" } });
	const start = verificationFieldsFrom(snapshot);
	const unsaved = (fields: VerificationFields): VerificationProvider[] => VERIFICATION_PROVIDERS.filter((provider) =>
		["unsaved", "changed"].includes(verificationFieldStatus({ provider, field: fields[provider], latest: snapshot.codes[provider], pending: null })));
	const wholeTag = editVerificationDraft(start, "google", '<meta name="google-site-verification" content="G-new" />');
	const otherTag = editVerificationDraft(start, "bing", '<meta name="google-site-verification" content="G-new" />');
	assert.deepEqual(unsaved(wholeTag), ["google"]);
	assert.deepEqual(verificationDraftSummary(wholeTag), { kind: "invalid", problems: ["google"], changes: [] }, "an edited whole meta tag is unsaved, not clean");
	assert.deepEqual(unsaved(otherTag), ["bing"]);
	assert.deepEqual(verificationDraftSummary(otherTag), { kind: "invalid", problems: ["bing"], changes: [] }, "so is the other provider's tag");
	const mixed = editVerificationDraft(otherTag, "google", "G-new");
	assert.deepEqual(verificationDraftSummary(mixed), {
		kind: "invalid", problems: ["bing"], changes: [{ provider: "google", base: { kind: "code", code: "G-old" }, value: "G-new" }],
	}, "a valid change does not hide an invalid one");
	assert.ok(verificationSaveBlockers({ snapshot, fields: mixed, hostVersion: "1.1.0", manage: "allowed", write: { status: "idle", settled: 0 }, busy: false }).includes("invalid"),
		"validation still blocks the save");

	assert.deepEqual(verificationDraftSummary(start), { kind: "clean" }, "control: a loaded form is clean");
	assert.deepEqual(unsaved(start), []);
	assert.deepEqual(verificationDraftSummary(editVerificationDraft(start, "google", " G-old ")), { kind: "clean" }, "control: whitespace around the stored code stays clean");
	assert.equal(verificationDraftSummary(editVerificationDraft(start, "bing", "B-1")).kind, "ready");
	for (const fields of [start, wholeTag, otherTag, mixed, removeVerificationCode(start, "google"), editVerificationDraft(start, "google", ""), editVerificationDraft(start, "google", " G-old ")]) {
		assert.equal(verificationDraftSummary(fields).kind === "clean", unsaved(fields).length === 0, "the footer is clean exactly when no field shows Unsaved");
	}
}

{
	// An Editor's save is refused, the person is made an Administrator again, and the owner reloads.
	const { site, snapshot, fields: start } = await prepared();
	const drafts = editVerificationDraft(start, "google", "G-new");
	site.writes.push((): VerificationPortResult => ({ ok: false, failure: response(403, "FORBIDDEN") }));
	const refused = await saveVerificationCodes(site.port, verificationChanges(drafts).changes);
	assert.ok(refused.status === "rejected");
	const banner: VerificationNotice = refused;
	const idle = { status: "idle", settled: 0 } as const;
	const editor = verificationRoleHints({ status: "success", role: 40 });
	assert.equal(verificationEditable({ snapshot, hostVersion: "1.1.0", manage: editor.manage, write: idle, busy: false }), false, "the refused Editor is read-only");

	// Control first: a failed reload keeps the drafts and reports its own failure in place of the refusal.
	const unavailable = response(503, "UNAVAILABLE");
	site.reads.push((): VerificationPortResult => ({ ok: false, failure: unavailable }));
	const failedReload = await loadVerificationSettings(site.port);
	assert.ok(!failedReload.ok);
	assert.deepEqual(verificationNoticeAfterReload(banner, { ok: false, failure: failedReload.failure }), { status: "reload-failed", failure: unavailable });
	assert.equal(drafts.google.draft, "G-new");

	const reread = await loadVerificationSettings(site.port);
	assert.ok(reread.ok);
	const fields = mergeVerificationSnapshot(drafts, reread.snapshot);
	assert.equal(fields.google.draft, "G-new", "the draft survives the reload");
	const admin = verificationRoleHints({ status: "success", role: 50 });
	assert.equal(verificationEditable({ snapshot: reread.snapshot, hostVersion: "1.1.0", manage: admin.manage, write: idle, busy: false }), true);
	assert.deepEqual(verificationSaveBlockers({ snapshot: reread.snapshot, fields, hostVersion: "1.1.0", manage: admin.manage, write: idle, busy: false }), []);
	const reloaded = { ok: true as const, fields, snapshot: reread.snapshot };
	assert.equal(verificationNoticeAfterReload(banner, reloaded), null, "the refusal no longer contradicts allowed editing");
	for (const notice of [
		{ status: "not-checked", problem: "signed-out", failure: response(401, "UNAUTHORIZED") },
		{ status: "recovery-failed", failure: transport },
		{ status: "reload-failed", failure: unavailable },
	] as const) {
		assert.equal(verificationNoticeAfterReload(notice, reloaded), null, `${notice.status} is superseded by a successful reload`);
	}
	assert.equal(verificationNoticeAfterReload(null, reloaded), null);

	// Banners about codes stay only while a code they name is still edited.
	const other = parsed({ seo: { ...STORED.seo, googleVerification: "G-other" } });
	const stale: VerificationNotice = { status: "stale", providers: ["google"], latest: other };
	const staleFields = mergeVerificationSnapshot(drafts, other);
	assert.equal(verificationNoticeAfterReload(stale, { ok: true, fields: staleFields, snapshot: other }), stale, "still changed elsewhere");
	const resolved = resolveVerificationChange(staleFields, "google", other.codes.google, "use-stored");
	assert.equal(verificationNoticeAfterReload(stale, { ok: true, fields: resolved, snapshot: other }), null);
	const codeNotices: VerificationNotice[] = [
		{ status: "conflict", latest: other, confirmed: [], replaced: ["google"] },
		{ status: "carried", providers: ["google"] },
	];
	for (const notice of codeNotices) {
		const kept = resolveVerificationChange(staleFields, "google", other.codes.google, "keep-mine");
		assert.equal(verificationNoticeAfterReload(notice, { ok: true, fields: kept, snapshot: other }), notice, `${notice.status} stays while the entry is unsaved`);
		const adopted = mergeVerificationSnapshot(editVerificationDraft(kept, "google", "G-other"), other);
		assert.equal(verificationNoticeAfterReload(notice, { ok: true, fields: adopted, snapshot: other }), null, `${notice.status} goes once the entry is stored`);
	}
	const unknown: VerificationWriteState = { status: "unconfirmed", settled: 1, pending: { changes: verificationChanges(drafts).changes, cause: "write", failure: transport } };
	assert.equal(verificationReadActions({ write: unknown, busy: false }).reload, false, "reload is not offered while an outcome is unconfirmed, so it never clears that intent");
}

{
	// An unconfirmed save was applied, and Check stored codes reports the sent code as stored.
	const site = endpoint(STORED);
	const registry = createVerificationWriteRegistry();
	const first = await mount(site, registry);
	const typed = editVerificationDraft(first.fields, "google", "G-new");
	await lostSave(site, registry, typed, true);
	const checked = await check(site, registry, typed);
	assert.deepEqual(checked.outcomes, [{ provider: "google", outcome: "sent" }]);
	const finding: VerificationNotice = { status: "recovered", outcomes: checked.outcomes };
	assert.equal(registry.current().status, "idle");

	// Another save then changes Google in EmDash.
	site.apply({ seo: { googleVerification: "G-later" } });

	// Control first: a failed reload reports its own failure and leaves fields and registry alone.
	site.reads.push((): VerificationPortResult => ({ ok: false, failure: transport }));
	const failedReload = await loadVerificationSettings(site.port);
	assert.ok(!failedReload.ok);
	assert.deepEqual(verificationNoticeAfterReload(finding, { ok: false, failure: failedReload.failure }), { status: "reload-failed", failure: transport });
	assert.deepEqual(checked.fields.google, { base: { kind: "code", code: "G-new" }, draft: "G-new", remove: false });
	assert.equal(registry.current().status, "idle");

	// A successful reload shows the newer code and drops the finding, which described the store at the check.
	const reread = await loadVerificationSettings(site.port);
	assert.ok(reread.ok);
	const fields = mergeVerificationSnapshot(checked.fields, reread.snapshot);
	assert.deepEqual(fields.google, { base: { kind: "code", code: "G-later" }, draft: "G-later", remove: false });
	assert.equal(verificationNoticeAfterReload(finding, { ok: true, fields, snapshot: reread.snapshot }), null,
		"'stores the code you sent' never outlives a newer authoritative read");

	// An entry the check kept survives the reload as a draft; only the finding goes.
	const keptFinding: VerificationNotice = { status: "recovered", outcomes: [{ provider: "google", outcome: "previous" }] };
	const kept = editVerificationDraft(fields, "google", "G-mine");
	const keptAfter = mergeVerificationSnapshot(kept, reread.snapshot);
	assert.equal(keptAfter.google.draft, "G-mine");
	assert.equal(verificationNoticeAfterReload(keptFinding, { ok: true, fields: keptAfter, snapshot: reread.snapshot }), null);
}

{
	// A confirmed save shows "saved and read back"; another save then changes Google in EmDash.
	const { site, fields: start } = await prepared();
	const sent = editVerificationDraft(start, "google", "G-new");
	const result = await saveVerificationCodes(site.port, verificationChanges(sent).changes);
	assert.ok(result.status === "confirmed");
	const saved: VerificationNotice = { status: "saved", providers: result.providers };
	const settled = settleVerificationFields(sent, sent, result.latest, ["google"], result.providers);
	site.apply({ seo: { googleVerification: "G-later" } });

	// Control first: a failed reload reports its own failure and keeps the fields.
	site.reads.push((): VerificationPortResult => ({ ok: false, failure: transport }));
	const failedReload = await loadVerificationSettings(site.port);
	assert.ok(!failedReload.ok);
	assert.deepEqual(verificationNoticeAfterReload(saved, { ok: false, failure: failedReload.failure }), { status: "reload-failed", failure: transport });
	assert.deepEqual(settled.google, { base: { kind: "code", code: "G-new" }, draft: "G-new", remove: false });

	// A successful reload shows the newer code and drops the banner about the earlier save.
	const reread = await loadVerificationSettings(site.port);
	assert.ok(reread.ok);
	const fields = mergeVerificationSnapshot(settled, reread.snapshot);
	assert.deepEqual(fields.google, { base: { kind: "code", code: "G-later" }, draft: "G-later", remove: false });
	assert.equal(verificationNoticeAfterReload(saved, { ok: true, fields, snapshot: reread.snapshot }), null,
		"'EmDash adds the saved tags' never outlives a newer authoritative read");
}
{
	// A disabled account: EmDash destroys the session and answers the preflight GET with 403 ACCOUNT_DISABLED.
	const { site, snapshot, fields: start } = await prepared();
	const drafts = editVerificationDraft(start, "google", "G-new");
	const idle = { status: "idle", settled: 0 } as const;

	// Control first: an unrelated 403 on the preflight is a plain refusal and does not end the session.
	site.reads.push((): VerificationPortResult => ({ ok: false, failure: response(403, "CSRF_REJECTED") }));
	const refused = await saveVerificationCodes(site.port, verificationChanges(drafts).changes);
	assert.ok(refused.status === "not-checked");
	assert.equal(refused.problem, "refused");
	assert.equal(verificationRefusalRereadsRole(refused.problem), false, "no role reread for an unrelated 403");

	site.log.length = 0;
	const disabled = response(403, "ACCOUNT_DISABLED");
	site.reads.push((): VerificationPortResult => ({ ok: false, failure: disabled }));
	const ended = await saveVerificationCodes(site.port, verificationChanges(drafts).changes);
	assert.ok(ended.status === "not-checked");
	assert.equal(ended.problem, "signed-out");
	assert.deepEqual(site.log, ["read"], "the preflight GET stops the save; no POST is sent");
	assert.equal(verificationRefusalRereadsRole(ended.problem), true, "the current user is read again once");
	assert.equal(drafts.google.draft, "G-new", "the draft is kept");

	// Without a session that reread fails, so the role is unknown and the form is read-only with Save off.
	const signedOut = verificationRoleHints({ status: "error", role: 50 });
	assert.deepEqual(verificationSaveBlockers({ snapshot, fields: drafts, hostVersion: "1.1.0", manage: signedOut.manage, write: idle, busy: false }), ["role-unknown"]);
	assert.equal(verificationEditable({ snapshot, hostVersion: "1.1.0", manage: signedOut.manage, write: idle, busy: false }), false);

	// After signing in again, Reload rereads the role once and the settings; the draft survives and the banner goes.
	const notice: VerificationNotice = ended;
	assert.equal(verificationReadActions({ write: idle, busy: false }).reload, true);
	assert.equal(verificationRoleRefreshWanted(signedOut.manage, false), true);
	const reread = await loadVerificationSettings(site.port);
	assert.ok(reread.ok);
	const fields = mergeVerificationSnapshot(drafts, reread.snapshot);
	assert.equal(fields.google.draft, "G-new");
	const signedIn = verificationRoleHints({ status: "success", role: 50 });
	assert.deepEqual(verificationSaveBlockers({ snapshot: reread.snapshot, fields, hostVersion: "1.1.0", manage: signedIn.manage, write: idle, busy: false }), []);
	assert.equal(verificationNoticeAfterReload(notice, { ok: true, fields, snapshot: reread.snapshot }), null);

	// A POST answered with the same 403 is refused as an ended session, with no confirming read.
	site.log.length = 0;
	site.writes.push((): VerificationPortResult => ({ ok: false, failure: disabled }));
	const rejected = await saveVerificationCodes(site.port, verificationChanges(fields).changes);
	assert.ok(rejected.status === "rejected");
	assert.equal(rejected.refusal, "signed-out");
	assert.equal(verificationRefusalRereadsRole(rejected.refusal), true);
	assert.equal(site.log.length, 2);
	assert.deepEqual(site.settings, STORED, "nothing was written");
}

{
	// The handed-over warning names only codes still unsaved against the read the fields are compared with.
	const g = (code: string): VerificationChange => ({ provider: "google", base: G_OLD, value: code });
	const removeGoogle: VerificationChange = { provider: "google", base: G_OLD, value: "" };
	const addBing: VerificationChange = { provider: "bing", base: { kind: "none", stored: "absent" }, value: "B-1" };
	const reopened = (read: VerificationSnapshot, carried: readonly VerificationChange[]): VerificationProvider[] =>
		verificationCarriedUnsaved(restoreVerificationIntent(verificationFieldsFrom(read), carried), read, carried);

	// Control first: a code the reopened read does not hold is reported.
	assert.deepEqual(reopened(parsed({ seo: { googleVerification: "G-old" } }), [g("G-new")]), ["google"]);
	// A departed refused or stale save whose code another save already stored: the restored field is Saved, so no warning.
	const holdsNew = parsed({ seo: { googleVerification: "G-new" } });
	const matched = restoreVerificationIntent(verificationFieldsFrom(holdsNew), [g("G-new")]);
	assert.equal(verificationFieldStatus({ provider: "google", field: matched.google, latest: holdsNew.codes.google, pending: null }), "saved");
	assert.deepEqual(verificationCarriedUnsaved(matched, holdsNew, [g("G-new")]), [], "all match: no warning");
	assert.deepEqual(reopened(holdsNew, [g("G-new"), addBing]), ["bing"], "mixed: only the still-unsaved provider is named");
	assert.deepEqual(reopened(parsed({ seo: { googleVerification: " G-new " } }), [g("G-new")]), ["google"],
		"a stored code with surrounding whitespace is a different stored value");
	const spacedDraft = editVerificationDraft(verificationFieldsFrom(holdsNew), "google", " G-new ");
	assert.deepEqual(verificationCarriedUnsaved(spacedDraft, holdsNew, [g("G-new")]), [], "whitespace around a matching draft is not unsaved");
	assert.deepEqual(verificationCarriedUnsaved(restoreVerificationIntent(spacedDraft, [g("G-new")]), holdsNew, [g("G-new")]), []);
	assert.deepEqual(reopened(parsed({ seo: { googleVerification: "" } }), [removeGoogle]), [], "a removal the read already shows is no warning");
	assert.deepEqual(reopened(parsed({}), [removeGoogle]), [], "absent counts as removed");
	assert.deepEqual(reopened(parsed({ seo: { googleVerification: "G-old" } }), [removeGoogle]), ["google"], "a removal not yet stored is reported");
	assert.equal(restoreVerificationIntent(verificationFieldsFrom(parsed({ seo: { googleVerification: "G-old" } })), [removeGoogle]).google.remove, true,
		"and kept as an explicit pending removal");
	assert.deepEqual(verificationCarriedUnsaved(editVerificationDraft(matched, "bing", "B-2"), holdsNew, [g("G-new")]), [],
		"a provider that was not handed over is never named");

	// Foreign settlement in an open view is compared with that view's last read, which may predate the store.
	const openRead = parsed({ seo: { googleVerification: "G-old" } });
	const open = verificationFieldsFrom(openRead);
	assert.deepEqual(verificationCarriedUnsaved(restoreVerificationIntent(open, [g("G-new")]), openRead, [g("G-new")]), ["google"],
		"reported against the observed read, not as current storage");
	assert.deepEqual(verificationCarriedUnsaved(restoreVerificationIntent(verificationFieldsFrom(holdsNew), [g("G-new")]), holdsNew, [g("G-new")]), [],
		"an open view whose read already held the code shows no warning");
	assert.equal(restoreVerificationIntent(editVerificationDraft(open, "google", "G-mine"), [g("G-new")]).google.draft, "G-mine",
		"a newer draft in the open view is kept");
}

{
	// The carried banner's lifecycle: explicit edits, Undo, a partial Reload and an all-match handoff.
	const g: VerificationChange = { provider: "google", base: G_OLD, value: "G-new" };
	const b: VerificationChange = { provider: "bing", base: { kind: "none", stored: "absent" }, value: "B-1" };
	const read = parsed({ seo: { googleVerification: "G-old" } });
	const restored = restoreVerificationIntent(verificationFieldsFrom(read), [g, b]);
	const carried = verificationNoticeAfterHandoff(null, verificationCarriedUnsaved(restored, read, [g, b]));
	assert.deepEqual(carried, { status: "carried", providers: ["google", "bing"] });

	// Control first: an edit leaves refusal, failure and recovery banners alone.
	const refusal: VerificationNotice = { status: "rejected", refusal: "forbidden", failure: response(403, "FORBIDDEN") };
	const finding: VerificationNotice = { status: "recovered", outcomes: [{ provider: "google", outcome: "previous" }] };
	const failed: VerificationNotice = { status: "recovery-failed", failure: transport };
	for (const notice of [refusal, finding, failed]) assert.equal(verificationNoticeAfterEdit(notice), notice, `${notice.status} survives an edit`);
	assert.equal(verificationNoticeAfterEdit(null), null);

	// Undo returns both fields to the stored values: the form is clean and the carried banner goes.
	const undone = undoVerificationField(undoVerificationField(restored, "google"), "bing");
	assert.deepEqual(verificationDraftSummary(undone), { kind: "clean" });
	assert.equal(verificationNoticeAfterEdit(carried), null, "Undo clears the carried banner");
	const typed = editVerificationDraft(restored, "google", "G-mine");
	assert.equal(typed.google.draft, "G-mine", "an explicit edit keeps the fields");
	assert.equal(verificationNoticeAfterEdit(carried), null, "and clears the carried banner too");
	assert.equal(verificationNoticeAfterEdit({ status: "saved", providers: ["google"] }), null);

	// A successful Reload narrows the list to the providers still unsaved.
	const stored = parsed({ seo: { googleVerification: "G-new" } });
	const reloaded = mergeVerificationSnapshot(restored, stored);
	assert.deepEqual(reloaded.google, { base: { kind: "code", code: "G-new" }, draft: "G-new", remove: false });
	assert.deepEqual(verificationNoticeAfterReload(carried, { ok: true, fields: reloaded, snapshot: stored }), { status: "carried", providers: ["bing"] },
		"only the provider still unsaved is named");
	assert.equal(verificationNoticeAfterReload(carried, { ok: true, fields: restored, snapshot: read }), carried, "unchanged while every provider is still unsaved");
	assert.equal(verificationNoticeAfterReload(carried, { ok: true, fields: verificationFieldsFrom(stored), snapshot: stored }), null, "cleared once none is");
	assert.deepEqual(verificationNoticeAfterReload(carried, { ok: false, failure: transport }), { status: "reload-failed", failure: transport });

	// A later handoff that all matches the observed read clears an earlier carried banner.
	const none = verificationCarriedUnsaved(restoreVerificationIntent(verificationFieldsFrom(stored), [g]), stored, [g]);
	assert.deepEqual(none, []);
	assert.equal(verificationNoticeAfterHandoff(carried, none), null);
	assert.equal(verificationNoticeAfterHandoff(refusal, none), refusal, "a banner of another kind is left alone");
	assert.deepEqual(verificationNoticeAfterHandoff(refusal, ["bing"]), { status: "carried", providers: ["bing"] });
}

// ---- Ownership of late results --------------------------------------------

{
	const owner = createVerificationOwner();
	const first = owner.claim();
	const second = owner.claim();
	assert.equal(owner.owns(first), false, "a newer action supersedes an older one");
	assert.equal(owner.owns(second), true);
	owner.close();
	assert.equal(owner.owns(second), false, "nothing applies after the view is gone");

	// A slow load that answers after a newer reload is dropped.
	let release: (value: VerificationPortResult) => void = () => undefined;
	const slow: VerificationSettingsPort = {
		read: () => new Promise((resolve) => (release = resolve)),
		write: async () => ({ ok: false, failure: transport }),
	};
	const view = createVerificationOwner();
	const applied: string[] = [];
	const late = view.claim();
	const lateLoad = loadVerificationSettings(slow).then((result) => view.owns(late) && applied.push(result.ok ? "late" : "failed"));
	const fresh = view.claim();
	applied.push(view.owns(fresh) ? "fresh" : "lost");
	release({ ok: true, data: { seo: { googleVerification: "G-late" } } });
	await lateLoad;
	assert.deepEqual(applied, ["fresh"], "the late answer never replaces newer state");
}

{
	const registry = createVerificationWriteRegistry();
	const seen: VerificationWriteState["status"][] = [];
	const unsubscribe = registry.subscribe(() => seen.push(registry.current().status));
	const initial = registry.current();
	assert.equal(registry.current(), initial, "a stable snapshot between changes");
	assert.equal(registry.beginRecovery(), null, "nothing to recover");
	const pending: VerificationPending = { changes: [{ provider: "bing", base: { kind: "none", stored: "absent" }, value: "B-1" }], cause: "write", failure: transport };
	assert.deepEqual(verificationWriteChanges(registry.current()), []);
	const save = registry.beginSave(pending.changes);
	assert.ok(save);
	assert.deepEqual(registry.current(), { status: "saving", settled: 0, changes: pending.changes });
	assert.equal(verificationWriteChanges(registry.current()), pending.changes, "a running save's codes outlive the view that sent them");
	assert.equal(registry.beginSave(pending.changes), null, "no second save while one is in flight, from any mount");
	assert.equal(registry.beginRecovery(), null);
	registry.finish(save, pending);
	assert.equal(verificationWriteChanges(registry.current()), pending.changes);
	assert.deepEqual(registry.current(), { status: "unconfirmed", settled: 1, pending });
	assert.equal(registry.beginSave(pending.changes), null, "no save while the outcome is unknown");
	const check = registry.beginRecovery();
	assert.ok(check);
	assert.equal(registry.beginRecovery(), null, "one check at a time");
	assert.equal(registry.beginSave(pending.changes), null);
	registry.finish(save, null);
	assert.equal(registry.current().status, "checking", "a stale ticket cannot settle the current operation");
	registry.finish(check, pending);
	assert.deepEqual(registry.current(), { status: "unconfirmed", settled: 2, pending }, "a failed check keeps the outcome unknown");
	const retry = registry.beginRecovery();
	assert.ok(retry);
	registry.finish(retry, null);
	assert.deepEqual(registry.current(), { status: "idle", settled: 3 });
	assert.deepEqual(verificationWriteChanges(registry.current()), []);
	unsubscribe();
	assert.ok(registry.beginSave(pending.changes));
	assert.deepEqual(seen, ["saving", "unconfirmed", "checking", "unconfirmed", "checking", "idle"], "listeners stop after unsubscribing");
}
{
	const registry = createVerificationWriteRegistry();
	const changes: VerificationChange[] = [{ provider: "google", base: G_OLD, value: "G-new" }];
	const pending: VerificationPending = { changes, cause: "write", failure: transport };
	const save = registry.beginSave(changes);
	assert.ok(save);
	registry.finish(save, null, changes);
	assert.equal(registry.takeHandoff(), changes);
	assert.deepEqual(registry.takeHandoff(), [], "a handoff is taken once");
	const unconfirmed = registry.beginSave(changes);
	assert.ok(unconfirmed);
	registry.finish(unconfirmed, pending, changes);
	assert.deepEqual(registry.takeHandoff(), [], "an unconfirmed outcome keeps its codes in the pending record");
	const check = registry.beginRecovery();
	assert.ok(check);
	registry.finish(check, null, changes);
	const next = registry.beginSave(changes);
	assert.ok(next);
	assert.deepEqual(registry.takeHandoff(), [], "a new save supersedes an untaken handoff");
	registry.finish(save, null, changes);
	assert.deepEqual(registry.takeHandoff(), [], "a stale ticket leaves no handoff");
	assert.equal(registry.current().status, "saving");
}

// ---- Request bounds --------------------------------------------------------

{
	const outcomes: { result: VerificationSaveResult; calls: number }[] = [];
	for (const script of [
		(site: Endpoint) => site,
		(site: Endpoint) => (site.writes.push(() => ({ ok: false, failure: transport })), site),
		(site: Endpoint) => (site.reads.push(() => ({ ok: true, data: structuredClone(site.settings) }), () => ({ ok: false, failure: transport })), site),
	]) {
		const { site, fields: start } = await prepared();
		script(site);
		const result = await saveVerificationCodes(site.port, changesFor(start, { google: "G-new" }));
		outcomes.push({ result, calls: site.log.length });
	}
	assert.deepEqual(outcomes.map(({ result, calls }) => [result.status, calls]), [["confirmed", 3], ["unconfirmed", 2], ["unconfirmed", 3]],
		"a save is at most one preflight, one write and one confirming read");
}

console.log("site verification selfcheck passed");
