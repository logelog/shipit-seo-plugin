import assert from "node:assert/strict";

import { ROBOTS_TXT_CORE_FALLBACK_BODY, effectiveRobotsTxt } from "../robots-txt.ts";
import {
	ROBOTS_OBSERVATION_MAX_BYTES,
	loadRobotsSettings,
	readRobotsObservationBody,
	robotsEditable,
	parseRobotsSettings,
	robotsDraftChanged,
	robotsEditorText,
	robotsHasCarriageReturns,
	robotsObservation,
	robotsReadProblem,
	robotsRoleHints,
	robotsServedPreview,
	robotsSettingsUpdate,
	robotsUncertainOutcome,
	robotsStoredPreview,
	robotsWriteAllowed,
	robotsWriteBlockers,
	robotsWriteProblem,
	saveRobotsText,
	type RobotsPortResult,
	type RobotsRequestFailure,
	type RobotsSettingsPort,
	type RobotsSettingsSnapshot,
} from "./robots-txt-model.ts";

// Role hints exist only for a verified host and a loaded user.
assert.deepEqual(robotsRoleHints("1.1.0", { status: "success", role: 50 }), { read: "allowed", manage: "allowed" });
assert.deepEqual(robotsRoleHints("1.2.0", { status: "success", role: 50 }), { read: "allowed", manage: "allowed" });
assert.deepEqual(robotsRoleHints("1.3.0", { status: "success", role: 50 }), { read: "allowed", manage: "allowed" });
assert.deepEqual(robotsRoleHints("1.3.0", { status: "success", role: 40 }), { read: "allowed", manage: "denied" });
assert.deepEqual(robotsRoleHints("1.3.0", { status: "success", role: 30 }), { read: "denied", manage: "denied" });
assert.deepEqual(robotsRoleHints("1.3.1", { status: "success", role: 50 }), { read: "allowed", manage: "allowed" });
assert.deepEqual(robotsRoleHints("1.2.0", { status: "success", role: 40 }), { read: "allowed", manage: "denied" });
assert.deepEqual(robotsRoleHints("1.2.0", { status: "success", role: 30 }), { read: "denied", manage: "denied" });
assert.deepEqual(robotsRoleHints("1.1.0", { status: "success", role: 40 }), { read: "allowed", manage: "denied" });
assert.deepEqual(robotsRoleHints("1.1.0", { status: "success", role: 30 }), { read: "denied", manage: "denied" });
assert.deepEqual(robotsRoleHints("1.1.0", { status: "pending" }), { read: "unknown", manage: "unknown" });
assert.deepEqual(robotsRoleHints("1.1.0", { status: "error" }), { read: "unknown", manage: "unknown" });
assert.deepEqual(robotsRoleHints("1.0.1", { status: "success", role: 50 }), { read: "unknown", manage: "unknown" });
assert.deepEqual(robotsRoleHints(null, { status: "success", role: 50 }), { read: "unknown", manage: "unknown" });
assert.deepEqual(robotsRoleHints("1.1.0", { status: "success", role: "50" }), { read: "unknown", manage: "unknown" });

// The update body carries the one field and nothing else.
assert.deepEqual(robotsSettingsUpdate("User-agent: *"), { seo: { robotsTxt: "User-agent: *" } });
assert.deepEqual(Object.keys(robotsSettingsUpdate("")), ["seo"]);

// Malformed outer data is a failed read, never an empty default.
for (const data of [undefined, null, "", [], 42, "settings"]) {
	assert.equal(parseRobotsSettings(data).ok, false, `outer ${JSON.stringify(data)}`);
}
const parsed = (data: unknown): RobotsSettingsSnapshot => {
	const result = parseRobotsSettings(data);
	assert.ok(result.ok);
	return result.snapshot;
};
assert.deepEqual(parsed({}), { stored: { kind: "unset" }, siteUrl: { kind: "none" }, seoMergeable: true });
assert.deepEqual(parsed({ title: "x", seo: { titleSeparator: "|" } }).stored, { kind: "unset" });
assert.deepEqual(parsed({ seo: { robotsTxt: "" } }).stored, { kind: "text", text: "" });
assert.deepEqual(parsed({ seo: { robotsTxt: " \n" } }).stored, { kind: "text", text: " \n" });
assert.deepEqual(parsed({ seo: { robotsTxt: 7 } }).stored, { kind: "invalid", served: "fallback", type: "number", identity: "7" });
assert.deepEqual(parsed({ seo: { robotsTxt: null } }).stored, { kind: "invalid", served: "default", type: "null", identity: "null" });
assert.deepEqual(parsed({ seo: { robotsTxt: ["a"] } }).stored, { kind: "invalid", served: "fallback", type: "array", identity: '["a"]' });
// A value that cannot be serialized is an unreadable response, never a default.
assert.equal(parseRobotsSettings({ seo: { robotsTxt: 1n } }).ok, false);
assert.equal(parseRobotsSettings({ seo: { robotsTxt: () => "x" } }).ok, false);
assert.equal(parseRobotsSettings({ seo: Symbol("seo") }).ok, false);
for (const seo of ["text", null, [], 1]) {
	const snapshot = parsed({ seo });
	assert.equal(snapshot.seoMergeable, false, `seo ${JSON.stringify(seo)}`);
	assert.equal(snapshot.stored.kind, "invalid");
}
assert.deepEqual(parsed({ url: "https://example.com/" }).siteUrl, { kind: "text", text: "https://example.com/" });
assert.deepEqual(parsed({ url: "" }).siteUrl, { kind: "none" });
assert.deepEqual(parsed({ url: null }).siteUrl, { kind: "none" }, "core falls back for a falsy value");
assert.deepEqual(parsed({ url: 5 }).siteUrl, { kind: "invalid", type: "number" });

// Failure classes.
const response = (status: number, code = "X"): RobotsRequestFailure => ({ type: "response", status, code, message: code });
assert.equal(robotsReadProblem(response(401, "UNAUTHORIZED")), "unauthorized");
assert.equal(robotsReadProblem(response(403, "FORBIDDEN")), "read-denied");
assert.equal(robotsReadProblem(response(403, "INSUFFICIENT_SCOPE")), "refused");
assert.equal(robotsReadProblem(response(500, "SETTINGS_READ_ERROR")), "service");
assert.equal(robotsReadProblem({ type: "transport", message: "Failed to fetch" }), "network");
assert.equal(robotsWriteProblem(response(400, "VALIDATION_ERROR")), "invalid");
assert.equal(robotsWriteProblem(response(401)), "unauthorized");
assert.equal(robotsWriteProblem(response(403, "FORBIDDEN")), "save-denied");
assert.equal(robotsWriteProblem(response(403, "CSRF_REJECTED")), "refused");
assert.equal(robotsWriteProblem(response(429)), "refused");
assert.equal(robotsWriteProblem(response(500, "SETTINGS_UPDATE_ERROR")), "uncertain");
assert.equal(robotsWriteProblem(response(502)), "uncertain");
assert.equal(robotsWriteProblem({ type: "transport", message: "network" }), "uncertain");
assert.equal(robotsWriteProblem({ type: "malformed", detail: "x" }), "uncertain");

// A scripted settings endpoint: last writer wins, siblings merged like core.
function endpoint(initial: Record<string, unknown>) {
	let settings: Record<string, unknown> = structuredClone(initial);
	const log: string[] = [];
	const reads: RobotsPortResult[] = [];
	const writes: ((text: string) => RobotsPortResult)[] = [];
	const apply = (text: string) => {
		settings = { ...settings, seo: { ...(settings.seo as object), robotsTxt: text } };
	};
	const port: RobotsSettingsPort = {
		async read() {
			log.push("read");
			return reads.shift() ?? { ok: true, data: structuredClone(settings) };
		},
		async write(text) {
			log.push(`write:${JSON.stringify(robotsSettingsUpdate(text))}`);
			const scripted = writes.shift();
			if (scripted) return scripted(text);
			apply(text);
			return { ok: true, data: structuredClone(settings) };
		},
	};
	return {
		port, log, reads, writes, apply,
		get settings(): Record<string, unknown> { return settings; },
		set settings(next: Record<string, unknown>) { settings = next; },
	};
}

const site = endpoint({ title: "Site", url: "https://example.com", seo: { titleSeparator: "|", robotsTxt: "User-agent: *" } });
const loaded = await loadRobotsSettings(site.port);
assert.ok(loaded.ok);
const base = loaded.snapshot.stored;

// Saved, confirmed by a reload; siblings stay.
const saved = await saveRobotsText(site.port, base, "User-agent: *\nDisallow: /tmp/");
assert.equal(saved.status, "saved");
assert.ok(saved.status === "saved" && saved.confirmation === "reloaded" && !saved.replacedAfter);
assert.deepEqual(site.log, ["read", "read", 'write:{"seo":{"robotsTxt":"User-agent: *\\nDisallow: /tmp/"}}', "read"]);
assert.deepEqual(site.settings, { title: "Site", url: "https://example.com", seo: { titleSeparator: "|", robotsTxt: "User-agent: *\nDisallow: /tmp/" } });

// Another editor saved after this one loaded: nothing is written.
site.log.length = 0;
const stale = { kind: "text", text: "User-agent: *" } as const;
const conflict = await saveRobotsText(site.port, stale, "Mine");
assert.equal(conflict.status, "conflict");
assert.deepEqual(site.log, ["read"], "a detected change sends no write");

// Last writer wins: a write that lands after the check is overwritten, and the reload shows it.
site.log.length = 0;
const current = { kind: "text", text: "User-agent: *\nDisallow: /tmp/" } as const;
site.writes.push((text) => {
	site.apply(text);
	const answer = { ok: true as const, data: structuredClone(site.settings) };
	site.apply("Other editor");
	return answer;
});
const overwritten = await saveRobotsText(site.port, current, "Mine");
assert.ok(overwritten.status === "saved" && overwritten.replacedAfter && overwritten.confirmation === "reloaded");
assert.deepEqual(overwritten.status === "saved" && overwritten.snapshot?.stored, { kind: "text", text: "Other editor" });

// Refusals before the write keep everything unchanged.
for (const [failure, problem] of [
	[response(400, "VALIDATION_ERROR"), "invalid"],
	[response(401, "UNAUTHORIZED"), "unauthorized"],
	[response(403, "FORBIDDEN"), "save-denied"],
	[response(403, "CSRF_REJECTED"), "refused"],
] as const) {
	const before: Record<string, unknown> = structuredClone(site.settings);
	site.writes.push(() => ({ ok: false, failure }));
	const result = await saveRobotsText(site.port, { kind: "text", text: "Other editor" }, "Denied");
	assert.equal(result.status, "rejected");
	assert.equal(result.status === "rejected" && result.problem, problem);
	assert.deepEqual(site.settings, before);
}

// A failed check before writing sends no write.
site.log.length = 0;
site.reads.push({ ok: false, failure: response(403, "FORBIDDEN") });
const unchecked = await saveRobotsText(site.port, { kind: "text", text: "Other editor" }, "x");
assert.ok(unchecked.status === "not-checked" && unchecked.problem === "read-denied");
assert.deepEqual(site.log, ["read"]);

// Uncertain: committed, then the response was lost. One reload reports it; no retry.
site.log.length = 0;
site.writes.push((text) => {
	site.apply(text);
	return { ok: false, failure: { type: "transport", message: "Failed to fetch" } };
});
const lost = await saveRobotsText(site.port, { kind: "text", text: "Other editor" }, "Committed");
assert.ok(lost.status === "uncertain" && lost.reload.ok && lost.reload.outcome === "sent-text");
assert.equal(site.log.filter((entry) => entry.startsWith("write")).length, 1, "never retried");

site.writes.push(() => ({ ok: false, failure: response(500, "SETTINGS_UPDATE_ERROR") }));
const notStored = await saveRobotsText(site.port, { kind: "text", text: "Committed" }, "Lost");
assert.ok(notStored.status === "uncertain" && notStored.reload.ok && notStored.reload.outcome === "previous-text");

// The same observation follows a write that was applied and then undone by
// another editor before the reload: the outcome names the text, not the history.
site.writes.push((text) => {
	site.apply(text);
	site.apply("Committed");
	return { ok: false, failure: { type: "transport", message: "Failed to fetch" } };
});
const undone = await saveRobotsText(site.port, { kind: "text", text: "Committed" }, "Applied then replaced");
assert.ok(undone.status === "uncertain" && undone.reload.ok && undone.reload.outcome === "previous-text",
	"previous-text does not mean the write was not applied");

site.writes.push((text) => {
	site.apply(text);
	site.apply("Third editor");
	return { ok: true, data: "<html>proxy page</html>" };
});
const different = await saveRobotsText(site.port, { kind: "text", text: "Committed" }, "Mine");
assert.ok(different.status === "uncertain" && different.reload.ok && different.reload.outcome === "other-text",
	"an unreadable success body is uncertain too");

site.writes.push(() => ({ ok: false, failure: response(503) }));
site.reads.push({ ok: true, data: structuredClone(site.settings) });
site.reads.push({ ok: false, failure: { type: "transport", message: "offline" } });
const unknown = await saveRobotsText(site.port, { kind: "text", text: "Third editor" }, "x");
assert.ok(unknown.status === "uncertain" && !unknown.reload.ok && unknown.reload.problem === "network");

// The write succeeded but the confirming reload failed.
site.reads.push({ ok: true, data: structuredClone(site.settings) });
site.reads.push({ ok: false, failure: response(500) });
const responseOnly = await saveRobotsText(site.port, { kind: "text", text: "Third editor" }, "Final");
assert.ok(responseOnly.status === "saved" && responseOnly.confirmation === "response-only" && !responseOnly.replacedAfter);

// A malformed seo object stops the save at the check.
site.settings = { seo: "broken" };
site.log.length = 0;
const malformed = await saveRobotsText(site.port, { kind: "text", text: "Final" }, "x");
assert.equal(malformed.status, "conflict");
assert.deepEqual(site.log, ["read"]);

// Invalid stored values are compared by their JSON identity, not only their type.
{
	const invalid = endpoint({ seo: { robotsTxt: 42 } });
	const loaded42 = await loadRobotsSettings(invalid.port);
	assert.ok(loaded42.ok);
	invalid.settings = { seo: { robotsTxt: 43 } };
	invalid.log.length = 0;
	const changedNumber = await saveRobotsText(invalid.port, loaded42.snapshot.stored, "Text");
	assert.equal(changedNumber.status, "conflict", "42 then 43 is a change, not the loaded value");
	assert.deepEqual(invalid.log, ["read"], "nothing is written");

	invalid.settings = { seo: { robotsTxt: 43 } };
	const loaded43 = await loadRobotsSettings(invalid.port);
	assert.ok(loaded43.ok);
	const recovered = await saveRobotsText(invalid.port, loaded43.snapshot.stored, "User-agent: *");
	assert.ok(recovered.status === "saved" && !recovered.replacedAfter, "an unchanged invalid value can still be replaced");

	invalid.settings = { seo: { robotsTxt: { a: 1 } } };
	const loadedObject = await loadRobotsSettings(invalid.port);
	assert.ok(loadedObject.ok);
	invalid.writes.push(() => {
		invalid.settings = { seo: { robotsTxt: { a: 2 } } };
		return { ok: false, failure: { type: "transport", message: "lost" } };
	});
	const changedObject = await saveRobotsText(invalid.port, loadedObject.snapshot.stored, "Mine");
	assert.ok(changedObject.status === "uncertain" && changedObject.reload.ok && changedObject.reload.outcome === "other-text",
		"{a:1} then {a:2} is other text, not the previous text");

	invalid.settings = { seo: { robotsTxt: 1n } };
	const unreadable = await loadRobotsSettings(invalid.port);
	assert.deepEqual([unreadable.ok, unreadable.ok ? null : unreadable.problem], [false, "malformed"]);
	invalid.settings = { seo: { robotsTxt: { a: 1 } } };
	const beforeUnreadable = await loadRobotsSettings(invalid.port);
	assert.ok(beforeUnreadable.ok);
	invalid.settings = { seo: { robotsTxt: 1n } };
	invalid.log.length = 0;
	const unreadableCheck = await saveRobotsText(invalid.port, beforeUnreadable.snapshot.stored, "x");
	assert.ok(unreadableCheck.status === "not-checked" && unreadableCheck.problem === "malformed");
	assert.deepEqual(invalid.log, ["read"]);
}

// A later successful reload classifies the same way as the first one.
assert.equal(robotsUncertainOutcome({ kind: "text", text: "Sent" }, { kind: "unset" }, "Sent"), "sent-text");
assert.equal(robotsUncertainOutcome({ kind: "unset" }, { kind: "unset" }, "Sent"), "previous-text");
assert.equal(robotsUncertainOutcome({ kind: "text", text: "" }, { kind: "unset" }, "Sent"), "other-text");

// Editor text and blockers.
assert.equal(robotsEditorText({ kind: "text", text: "a\r\nb\rc" }), "a\nb\nc");
assert.equal(robotsHasCarriageReturns({ kind: "text", text: "a\r\nb" }), true);
assert.equal(robotsDraftChanged({ kind: "text", text: "a\r\nb" }, "a\nb"), false);
assert.equal(robotsDraftChanged({ kind: "unset" }, ""), false);
assert.equal(robotsDraftChanged({ kind: "invalid", served: "fallback", type: "number", identity: "7" }, ""), true);
const snapshot: RobotsSettingsSnapshot = { stored: { kind: "text", text: "A" }, siteUrl: { kind: "none" }, seoMergeable: true };
const ready = { status: "ready", owner: "emdash-core" } as const;
const gate = { snapshot, facts: ready, manage: "allowed", uncertain: false, busy: false, draft: "B", lineEndsAccepted: false } as const;
assert.deepEqual(robotsWriteBlockers(gate), { save: [], restore: [] });

for (const [host, user, allowed] of [
	["1.2.0", { status: "success", role: 50 }, true],
	["1.2.0", { status: "success", role: 40 }, false],
	["1.2.0", { status: "success", role: 30 }, false],
	["1.2.0", { status: "pending" }, false],
	["1.2.0", { status: "error" }, false],
	["1.2.0", { status: "success" }, false],
	["1.2.0", { status: "success", role: "50" }, false],
	["1.2.0", { status: "success", role: 50.5 }, false],
	["1.2.0", { status: "success", role: Number.NaN }, false],
	["1.3.0", { status: "success", role: 50 }, true],
	["1.3.0", { status: "success", role: 40 }, false],
	["1.3.0", { status: "success", role: 30 }, false],
	["1.3.1", { status: "success", role: 50 }, true],
	["1.4.0", { status: "success", role: 50 }, false],
	[null, { status: "success", role: 50 }, false],
] as const) {
	const hints = robotsRoleHints(host, user);
	const input = { ...gate, manage: hints.manage };
	const blockers = robotsWriteBlockers(input);
	const label = `host=${host}, status=${user.status}, role=${"role" in user ? user.role : "missing"}`;
	assert.equal(robotsEditable(input), allowed, label);
	assert.equal(robotsWriteAllowed("save", blockers), allowed, label);
	assert.equal(robotsWriteAllowed("restore", blockers), allowed, label);
}
assert.deepEqual(robotsWriteBlockers({ ...gate, manage: "unknown" }), { save: ["role-unknown"], restore: ["role-unknown"] },
	"writes stay off while the role is pending, failed or unknown");
assert.deepEqual(robotsWriteBlockers({ ...gate, manage: "denied" }).save, ["role"]);
assert.deepEqual(robotsWriteBlockers({ ...gate, draft: "A" }).save, ["unchanged"]);
assert.deepEqual(robotsWriteBlockers({ ...gate, snapshot: null, facts: { status: "pending" }, manage: "denied", uncertain: true, busy: true, draft: "x".repeat(5001) }).save,
	["settings-unavailable", "ownership-pending", "role", "uncertain", "busy", "too-long"]);
assert.deepEqual(robotsWriteBlockers({ ...gate, facts: { status: "error" } }).save, ["ownership-unknown"]);
assert.deepEqual(robotsWriteBlockers({ ...gate, facts: { status: "ready", owner: "unsettled" } }).save, ["not-core"]);
assert.deepEqual(robotsWriteBlockers({ ...gate, snapshot: { ...snapshot, stored: { kind: "text", text: "" } }, draft: "" }).restore,
	["already-default"]);
// Restore stays off while nothing is stored, even with an unsaved draft; only Discard clears it.
for (const stored of [{ kind: "text", text: "" }, { kind: "unset" }] as const) {
	const draftOnly = robotsWriteBlockers({ ...gate, snapshot: { ...snapshot, stored }, draft: "User-agent: *\nDisallow: /private/\n" });
	assert.deepEqual(draftOnly.restore, ["already-default"]);
	assert.equal(robotsWriteAllowed("restore", draftOnly), false);
	assert.deepEqual(draftOnly.save, [], "the draft itself can still be saved");
}
assert.deepEqual(robotsWriteBlockers({ ...gate, snapshot: { ...snapshot, stored: { kind: "invalid", served: "default", type: "null", identity: "null" } }, draft: "" }).restore, [],
	"an invalid stored value is something to restore");
assert.deepEqual(robotsWriteBlockers({ ...gate, snapshot: { ...snapshot, seoMergeable: false } }).save, ["seo-malformed"]);
// A confirmation opened while writes were allowed is re-checked when confirmed.
const opened = robotsWriteBlockers({ ...gate, snapshot: { ...snapshot, stored: { kind: "text", text: "Custom" } }, draft: "Custom" });
assert.equal(robotsWriteAllowed("restore", opened), true);
for (const [change, blocker] of [
	[{ facts: { status: "error" } }, "ownership-unknown"],
	[{ facts: { status: "pending" } }, "ownership-pending"],
	[{ facts: { status: "ready", owner: "static-file" } }, "not-core"],
	[{ facts: { status: "ready", owner: "unknown" } }, "not-core"],
	[{ manage: "unknown" }, "role-unknown"],
	[{ manage: "denied" }, "role"],
	[{ busy: true }, "busy"],
	[{ uncertain: true }, "uncertain"],
] as const) {
	const later = robotsWriteBlockers({ ...gate, snapshot: { ...snapshot, stored: { kind: "text", text: "Custom" } }, draft: "Custom", ...change });
	assert.equal(robotsWriteAllowed("restore", later), false, blocker);
	assert.ok(later.restore.includes(blocker));
	assert.equal(robotsWriteAllowed("save", later), false);
}
assert.equal(robotsWriteAllowed("save", opened), false, "an unchanged draft cannot be saved");

// Stored CR line ends: the LF draft is never saved without explicit consent.
const crlf = { ...snapshot, stored: { kind: "text", text: "A\r\nB" } } as const;
assert.deepEqual(robotsWriteBlockers({ ...gate, snapshot: crlf, draft: "A\nB\nC" }).save, ["line-ends"]);
assert.deepEqual(robotsWriteBlockers({ ...gate, snapshot: crlf, draft: "A\nB\nC", lineEndsAccepted: true }).save, []);
assert.deepEqual(robotsWriteBlockers({ ...gate, snapshot: crlf, draft: "A\nB" }).save, ["line-ends", "unchanged"]);
assert.deepEqual(robotsWriteBlockers({ ...gate, snapshot: crlf, draft: "" }).restore, [], "restoring the default rewrites nothing");

// Preview and observation.
const origin = { configuredOrigin: null, configuredOriginKnown: true, requestOrigin: "http://127.0.0.1:4362" };
const preview = robotsServedPreview({ ...origin, text: "  ", siteUrl: { kind: "none" } });
assert.ok(preview.kind === "file" && preview.sitemapBase.source === "request" && preview.originKnown);
assert.equal(preview.kind === "file" && preview.file.body, "\n\nSitemap: http://127.0.0.1:4362/sitemap.xml\n");
const unknownOrigin = robotsServedPreview({ ...origin, configuredOriginKnown: false, text: null, siteUrl: { kind: "none" } });
assert.ok(unknownOrigin.kind === "file" && !unknownOrigin.originKnown, "an unrecorded configured origin is not presented as known");
assert.deepEqual(robotsServedPreview({ ...origin, text: "x", siteUrl: { kind: "invalid", type: "number" } }),
	{ kind: "fallback", body: ROBOTS_TXT_CORE_FALLBACK_BODY, reason: "site-url-invalid" });
const invalidStored: RobotsSettingsSnapshot = { ...snapshot, stored: { kind: "invalid", served: "fallback", type: "number", identity: "7" } };
assert.equal(robotsStoredPreview(invalidStored, origin).kind, "fallback");
assert.deepEqual(robotsObservation(invalidStored, origin, { status: 200, redirected: false, body: ROBOTS_TXT_CORE_FALLBACK_BODY }),
	{ status: "fallback" }, "an expected fallback is still not current configuration");
const observedBody = effectiveRobotsTxt("A", "http://127.0.0.1:4362").body;
assert.deepEqual(robotsObservation(snapshot, origin, { status: 200, redirected: false, body: observedBody }), { status: "matches" });
assert.deepEqual(robotsObservation({ ...snapshot, siteUrl: { kind: "text", text: "https://www.example.com/" } }, origin,
	{ status: 200, redirected: false, body: effectiveRobotsTxt("A", "https://www.example.com").body }), { status: "matches" });

// The text box is locked while a save, restore or reload is pending, whose result replaces the draft.
const editableInput = { snapshot, facts: ready, manage: "allowed", uncertain: false, busy: false } as const;
assert.equal(robotsEditable(editableInput), true);
assert.equal(robotsEditable({ ...editableInput, busy: true }), false, "no typing into a draft a pending save will replace");
assert.equal(robotsEditable({ ...editableInput, manage: "unknown" }), false);
assert.equal(robotsEditable({ ...editableInput, uncertain: true }), false);
assert.equal(robotsEditable({ ...editableInput, facts: { status: "ready", owner: "static-file" } }), false);
assert.equal(robotsEditable({ ...editableInput, facts: { status: "ready", owner: "unknown" } }), false, "filesystem inspection failure keeps the stored text read-only");
assert.equal(robotsEditable({ ...editableInput, snapshot: { ...snapshot, seoMergeable: false } }), false);
assert.equal(robotsEditable({ ...editableInput, snapshot: null }), false);

// Observed bodies: a byte cap that cancels the stream, and a byte order mark kept.
function streamOf(chunks: Uint8Array[]) {
	let cancelled = false;
	let index = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index < chunks.length) controller.enqueue(chunks[index++]);
			else controller.close();
		},
		cancel() {
			cancelled = true;
		},
	});
	return { stream, cancelled: () => cancelled, pulled: () => index };
}
const bomText = "\uFEFFUser-agent: *\nDisallow: /private/";
const bomFile = effectiveRobotsTxt(bomText, "http://127.0.0.1:4362").body;
const bomBytes = new TextEncoder().encode(bomFile);
assert.deepEqual([...bomBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
const bomRead = await readRobotsObservationBody(streamOf([bomBytes.slice(0, 2), bomBytes.slice(2)]).stream);
assert.equal(bomRead.text, bomFile, "the byte order mark survives, also across a chunk boundary");
assert.equal(bomRead.truncated, false);
assert.deepEqual(robotsObservation({ ...snapshot, stored: { kind: "text", text: bomText } }, origin,
	{ status: 200, redirected: false, body: bomRead.text }), { status: "matches" });
assert.equal(await new Response(bomBytes).text() === bomFile, false, "Response.text() would drop it");

const big = streamOf(Array.from({ length: 40 }, () => new Uint8Array(4096).fill(0x61)));
const bigRead = await readRobotsObservationBody(big.stream);
assert.equal(bigRead.truncated, true);
assert.equal(bigRead.bytes, ROBOTS_OBSERVATION_MAX_BYTES);
assert.equal(bigRead.text.length, ROBOTS_OBSERVATION_MAX_BYTES);
assert.equal(big.cancelled(), true, "the rest of an oversized body is cancelled");
assert.ok(big.pulled() < 40, "an oversized body is not read to the end");
assert.deepEqual(robotsObservation(snapshot, origin, { status: 200, redirected: false, body: bigRead.text, truncated: true }),
	{ status: "unavailable", reason: "too-large" }, "a cut-off body is never verified");
const exact = await readRobotsObservationBody(streamOf([new Uint8Array(ROBOTS_OBSERVATION_MAX_BYTES)]).stream);
assert.equal(exact.truncated, false, "exactly the cap is read whole");
assert.deepEqual(await readRobotsObservationBody(null), { text: "", bytes: 0, truncated: false });

// The new field is a core-owned read projection, not an editor write.
for (const robotsTxt of [undefined, "", "Allow: /", "Sitemap: https://cdn.example.net/map.xml  \r\n", 7, null]) {
	assert.equal(parsed({ seo: { robotsTxt, disallowAiTraining: true } }).disallowAiTraining, true);
	assert.equal(parsed({ seo: { robotsTxt, disallowAiTraining: false } }).disallowAiTraining, false);
}
for (const disallowAiTraining of [undefined, null, "true", 1, {}, []]) {
	assert.equal(parsed({ seo: { robotsTxt: "A", disallowAiTraining } }).disallowAiTraining, undefined, "core requires exact boolean true");
}
const trainingSite = endpoint({ url: "https://example.com", seo: { robotsTxt: "A", disallowAiTraining: false, titleSeparator: "|" } });
const trainingLoaded = await loadRobotsSettings(trainingSite.port);
assert.ok(trainingLoaded.ok);
// A core setting changed after load. The text-only write must preserve it.
trainingSite.settings = { ...trainingSite.settings, seo: { ...(trainingSite.settings.seo as object), disallowAiTraining: true } };
const trainingSaved = await saveRobotsText(trainingSite.port, trainingLoaded.snapshot.stored, "B");
assert.ok(trainingSaved.status === "saved" && trainingSaved.snapshot?.disallowAiTraining === true);
assert.deepEqual(trainingSite.settings.seo, { robotsTxt: "B", disallowAiTraining: true, titleSeparator: "|" });
assert.equal(trainingSite.log.filter((item) => item.startsWith("write:")).length, 1);
assert.ok(trainingSite.log.includes('write:{"seo":{"robotsTxt":"B"}}'));
const trainingRestored = await saveRobotsText(trainingSite.port, { kind: "text", text: "B" }, "");
assert.ok(trainingRestored.status === "saved" && trainingRestored.snapshot?.disallowAiTraining === true);
assert.deepEqual(trainingSite.settings.seo, { robotsTxt: "", disallowAiTraining: true, titleSeparator: "|" });
assert.deepEqual(robotsSettingsUpdate(""), { seo: { robotsTxt: "" } }, "restoring text does not disable the core AI setting");

const origin13 = { ...origin, hostVersion: "1.3.0" };
for (const text of [undefined, "", " \n\t", "Allow: /\r\n", "Sitemap: https://cdn.example.net/map.xml  \r\n"]) {
	const snapshot = parsed({ seo: { robotsTxt: text, disallowAiTraining: true } });
	const expected = effectiveRobotsTxt(text, origin.requestOrigin, { hostVersion: "1.3.0", disallowAiTraining: true }).body;
	const stored = robotsStoredPreview(snapshot, origin13);
	assert.ok(stored.kind === "file" && stored.file.disallowAiTraining);
	assert.equal(stored.kind === "file" && stored.file.body, expected);
	const draft = robotsServedPreview({ ...origin13, text: "Draft", siteUrl: snapshot.siteUrl, disallowAiTraining: snapshot.disallowAiTraining });
	assert.ok(draft.kind === "file" && draft.file.disallowAiTraining);
	assert.equal(draft.kind === "file" && draft.file.body, effectiveRobotsTxt("Draft", origin.requestOrigin, { hostVersion: "1.3.0", disallowAiTraining: true }).body);
	assert.deepEqual(robotsObservation(snapshot, origin13, { status: 200, redirected: false, body: expected }), { status: "matches" });
	assert.deepEqual(robotsObservation(snapshot, origin13, { status: 200, redirected: false, body: effectiveRobotsTxt(text, origin.requestOrigin).body }), { status: "different" });
	for (const hostVersion of ["1.1.0", "1.2.0", "1.3.2", "1.4.0", null, undefined]) {
		const old = robotsStoredPreview(snapshot, { ...origin, hostVersion });
		assert.ok(old.kind === "file" && !old.file.disallowAiTraining);
		assert.equal(old.kind === "file" && old.file.body, effectiveRobotsTxt(text, origin.requestOrigin).body, `stored true ignored on ${hostVersion}`);
		assert.deepEqual(robotsObservation(snapshot, { ...origin, hostVersion }, { status: 200, redirected: false, body: expected }), { status: "different" });
	}
}
const oldSnapshotWithoutPolicy: RobotsSettingsSnapshot = { stored: { kind: "text", text: "A" }, siteUrl: { kind: "none" }, seoMergeable: true };
const noPolicy = robotsStoredPreview(oldSnapshotWithoutPolicy, origin13);
assert.equal(noPolicy.kind === "file" && noPolicy.file.body, effectiveRobotsTxt("A", origin.requestOrigin).body, "existing snapshots remain compatible without the optional field");
const disabledPolicy = robotsStoredPreview(parsed({ seo: { robotsTxt: "A", disallowAiTraining: false } }), origin13);
assert.equal(disabledPolicy.kind === "file" && disabledPolicy.file.body, observedBody);
assert.deepEqual(robotsObservation(parsed({ seo: { robotsTxt: 7, disallowAiTraining: true } }), origin13, { status: 200, redirected: false, body: ROBOTS_TXT_CORE_FALLBACK_BODY }), { status: "fallback" });

console.log("robots-txt-model selfcheck passed");
