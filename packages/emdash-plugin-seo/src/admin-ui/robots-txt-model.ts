// State rules for the Robots.txt editor. EmDash core owns `seo.robotsTxt` and
// serves /robots.txt; this module decides what the editor may show and send.
// It has no React, DOM or host imports, so a sandbox editor can reuse it.
import {
	ROBOTS_TXT_CORE_FALLBACK_BODY,
	classifyRobotsObservation,
	effectiveRobotsTxt,
	robotsSitemapBase,
	robotsTxtTooLong,
	type RobotsConfiguredOrigin,
	type RobotsEffectiveFile,
	type RobotsObservationResult,
	type RobotsSitemapBase,
} from "../robots-txt.ts";

// ---- Role hints -----------------------------------------------------------

// Released permission map: settings:read from Editor (40), settings:manage
// from Admin (50). Only a hint; the settings endpoint decides every request.
const ROBOTS_SETTINGS_ROLE_GATES: Readonly<Record<string, { read: number; manage: number }>> = {
	"1.1.0": { read: 40, manage: 50 },
	"1.2.0": { read: 40, manage: 50 },
	"1.3.0": { read: 40, manage: 50 },
	"1.3.1": { read: 40, manage: 50 },
};

export type RobotsRoleHint = "allowed" | "denied" | "unknown";

export function robotsRoleHints(
	hostVersion: string | null,
	user: { status: "pending" | "error" | "success"; role?: unknown },
): { read: RobotsRoleHint; manage: RobotsRoleHint } {
	const gate = hostVersion === null ? undefined : ROBOTS_SETTINGS_ROLE_GATES[hostVersion];
	if (!gate || user.status !== "success" || typeof user.role !== "number" || !Number.isInteger(user.role)) {
		return { read: "unknown", manage: "unknown" };
	}
	return {
		read: user.role >= gate.read ? "allowed" : "denied",
		manage: user.role >= gate.manage ? "allowed" : "denied",
	};
}

// ---- Settings response ----------------------------------------------------

/** What the settings endpoint returned for `seo.robotsTxt`. */
export type RobotsStoredText =
	| { kind: "unset" }
	| { kind: "text"; text: string }
	/**
	 * Not text. Core serves its default for a falsy value and its fallback
	 * otherwise. `identity` is the value's JSON, kept in memory only so a
	 * changed invalid value is not mistaken for the loaded one; never shown.
	 */
	| { kind: "invalid"; served: "default" | "fallback"; type: string; identity: string };

/** EmDash's Site settings URL as core reads it. A truthy non-string makes core serve its fallback. */
export type RobotsSiteUrl = { kind: "none" } | { kind: "text"; text: string } | { kind: "invalid"; type: string };

export interface RobotsSettingsSnapshot {
	stored: RobotsStoredText;
	siteUrl: RobotsSiteUrl;
	/** False when `seo` is present but not an object; core would merge a save into it. */
	seoMergeable: boolean;
	/** Core-owned setting; only exact 1.3.0 and 1.3.1 predictions apply it. */
	disallowAiTraining?: boolean;
}

function valueType(value: unknown): string {
	if (value === null) return "null";
	return Array.isArray(value) ? "array" : typeof value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON of a value the endpoint returned; null when it cannot be serialized.
function jsonIdentity(value: unknown): string | null {
	try {
		const json = JSON.stringify(value);
		return typeof json === "string" ? json : null;
	} catch {
		return null;
	}
}

/**
 * Validates the settings data the admin helpers unwrap without checking.
 * A non-object response is a failed read, never an empty default.
 */
export function parseRobotsSettings(data: unknown): { ok: true; snapshot: RobotsSettingsSnapshot } | { ok: false; detail: string } {
	if (!isPlainRecord(data)) return { ok: false, detail: `settings response is ${valueType(data)}, not an object` };
	const url = data.url;
	const siteUrl: RobotsSiteUrl = typeof url === "string" && url
		? { kind: "text", text: url }
		: url ? { kind: "invalid", type: valueType(url) } : { kind: "none" };
	const seo = data.seo;
	if (seo === undefined) return { ok: true, snapshot: { stored: { kind: "unset" }, siteUrl, seoMergeable: true } };
	if (!isPlainRecord(seo)) {
		const identity = jsonIdentity(seo);
		if (identity === null) return { ok: false, detail: "seo settings cannot be read" };
		return { ok: true, snapshot: { stored: { kind: "invalid", served: "default", type: `seo ${valueType(seo)}`, identity }, siteUrl, seoMergeable: false } };
	}
	const corePolicy = typeof seo.disallowAiTraining === "boolean" ? { disallowAiTraining: seo.disallowAiTraining } : {};
	const text = seo.robotsTxt;
	if (text === undefined) return { ok: true, snapshot: { stored: { kind: "unset" }, siteUrl, seoMergeable: true, ...corePolicy } };
	if (typeof text === "string") return { ok: true, snapshot: { stored: { kind: "text", text }, siteUrl, seoMergeable: true, ...corePolicy } };
	const identity = jsonIdentity(text);
	if (identity === null) return { ok: false, detail: "seo.robotsTxt cannot be read" };
	const stored: RobotsStoredText = { kind: "invalid", served: text ? "fallback" : "default", type: valueType(text), identity };
	return { ok: true, snapshot: { stored, siteUrl, seoMergeable: true, ...corePolicy } };
}

export function sameStoredText(left: RobotsStoredText, right: RobotsStoredText): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind === "text" && right.kind === "text") return left.text === right.text;
	if (left.kind === "invalid" && right.kind === "invalid") return left.identity === right.identity && left.type === right.type;
	return true;
}

// ---- Request failures -----------------------------------------------------

export type RobotsRequestFailure =
	| { type: "response"; status: number; code: string; message: string }
	| { type: "malformed"; detail: string }
	| { type: "transport"; message: string };

export type RobotsReadProblem = "unauthorized" | "read-denied" | "refused" | "service" | "malformed" | "network";
export type RobotsWriteProblem = "invalid" | "unauthorized" | "save-denied" | "refused" | "uncertain";

export function robotsReadProblem(failure: RobotsRequestFailure): RobotsReadProblem {
	if (failure.type === "malformed") return "malformed";
	if (failure.type === "transport") return "network";
	if (failure.status === 401) return "unauthorized";
	if (failure.status === 403 && failure.code === "FORBIDDEN") return "read-denied";
	return failure.status >= 400 && failure.status < 500 ? "refused" : "service";
}

/**
 * A 4xx answer is a verdict before any write. A 5xx, a lost response or an
 * unreadable success body may follow a committed write: EmDash 1.1.0 saves,
 * then reads the settings back and purges caches inside the same request.
 */
export function robotsWriteProblem(failure: RobotsRequestFailure): RobotsWriteProblem {
	if (failure.type !== "response" || failure.status < 400 || failure.status >= 500) return "uncertain";
	if (failure.status === 400) return "invalid";
	if (failure.status === 401) return "unauthorized";
	if (failure.status === 403 && failure.code === "FORBIDDEN") return "save-denied";
	return "refused";
}

// ---- Load and save --------------------------------------------------------

export type RobotsPortResult = { ok: true; data: unknown } | { ok: false; failure: RobotsRequestFailure };

/** The whole update body. Core merges `seo` field by field, so siblings and other groups stay as stored. */
export function robotsSettingsUpdate(text: string): { seo: { robotsTxt: string } } {
	return { seo: { robotsTxt: text } };
}

/** EmDash's settings endpoint, as the editor uses it. `write` sends only `robotsSettingsUpdate(text)`. */
export interface RobotsSettingsPort {
	read(): Promise<RobotsPortResult>;
	write(text: string): Promise<RobotsPortResult>;
}

export type RobotsLoadResult =
	| { ok: true; snapshot: RobotsSettingsSnapshot }
	| { ok: false; problem: RobotsReadProblem; failure: RobotsRequestFailure };

export async function loadRobotsSettings(port: RobotsSettingsPort): Promise<RobotsLoadResult> {
	const result = await port.read();
	if (!result.ok) return { ok: false, problem: robotsReadProblem(result.failure), failure: result.failure };
	const parsed = parseRobotsSettings(result.data);
	if (!parsed.ok) {
		const failure: RobotsRequestFailure = { type: "malformed", detail: parsed.detail };
		return { ok: false, problem: "malformed", failure };
	}
	return { ok: true, snapshot: parsed.snapshot };
}

/**
 * What one reload after an uncertain write shows. It describes the stored text
 * now, not what happened to the write: another editor can store the same text
 * or put the previous text back after a write that was applied.
 */
export type RobotsUncertainOutcome = "sent-text" | "previous-text" | "other-text";

export function robotsUncertainOutcome(stored: RobotsStoredText, base: RobotsStoredText, sent: string): RobotsUncertainOutcome {
	if (sameStoredText(stored, { kind: "text", text: sent })) return "sent-text";
	return sameStoredText(stored, base) ? "previous-text" : "other-text";
}

export type RobotsSaveResult =
	/** The write answered 2xx. `replacedAfter`: the reloaded text is no longer what was sent. */
	| { status: "saved"; snapshot: RobotsSettingsSnapshot | null; confirmation: "reloaded" | "response-only"; replacedAfter: boolean }
	/** The stored text changed after it was loaded; nothing was written. */
	| { status: "conflict"; latest: RobotsSettingsSnapshot }
	/** The check before writing failed; nothing was written. */
	| { status: "not-checked"; problem: RobotsReadProblem; failure: RobotsRequestFailure }
	/** The endpoint refused the write before applying it. */
	| { status: "rejected"; problem: Exclude<RobotsWriteProblem, "uncertain">; failure: RobotsRequestFailure }
	/** The write may have been applied; the editor reloaded once to find out. */
	| { status: "uncertain"; failure: RobotsRequestFailure; reload: { ok: true; snapshot: RobotsSettingsSnapshot; outcome: RobotsUncertainOutcome } | { ok: false; problem: RobotsReadProblem } };

/**
 * One save through EmDash's last-writer-wins endpoint. The read before the
 * write only narrows the window for overwriting another editor's change; a
 * save landing between that read and this write is still overwritten. An
 * uncertain write is never retried or rolled back here: one reload reports
 * what is stored, and the editor must not save again until a reload succeeds.
 */
export async function saveRobotsText(port: RobotsSettingsPort, base: RobotsStoredText, text: string): Promise<RobotsSaveResult> {
	const before = await loadRobotsSettings(port);
	if (!before.ok) return { status: "not-checked", problem: before.problem, failure: before.failure };
	if (!before.snapshot.seoMergeable || !sameStoredText(before.snapshot.stored, base)) return { status: "conflict", latest: before.snapshot };

	const sent: RobotsStoredText = { kind: "text", text };
	const written = await port.write(text);
	const response = written.ok ? parseRobotsSettings(written.data) : null;
	if (!written.ok || !response?.ok) {
		const failure: RobotsRequestFailure = !written.ok
			? written.failure
			: { type: "malformed", detail: response && !response.ok ? response.detail : "unreadable response" };
		const problem = robotsWriteProblem(failure);
		if (problem !== "uncertain") return { status: "rejected", problem, failure };
		const reload = await loadRobotsSettings(port);
		if (!reload.ok) return { status: "uncertain", failure, reload: { ok: false, problem: reload.problem } };
		return { status: "uncertain", failure, reload: { ok: true, snapshot: reload.snapshot, outcome: robotsUncertainOutcome(reload.snapshot.stored, base, text) } };
	}

	const confirmed = await loadRobotsSettings(port);
	const snapshot = confirmed.ok ? confirmed.snapshot : response.snapshot;
	return {
		status: "saved",
		snapshot,
		confirmation: confirmed.ok ? "reloaded" : "response-only",
		replacedAfter: !sameStoredText(snapshot.stored, sent),
	};
}

// ---- Editor ---------------------------------------------------------------

/** Text for the editor. A textarea turns CR and CRLF into LF, so saving stores LF line ends. */
export function robotsEditorText(stored: RobotsStoredText): string {
	return stored.kind === "text" ? stored.text.replace(/\r\n?/g, "\n") : "";
}

export function robotsHasCarriageReturns(stored: RobotsStoredText): boolean {
	return stored.kind === "text" && stored.text.includes("\r");
}

export function robotsDraftChanged(stored: RobotsStoredText, draft: string): boolean {
	return stored.kind === "invalid" || draft !== robotsEditorText(stored);
}

/** Stored text that already selects EmDash's default body. */
export function robotsStoredIsDefault(stored: RobotsStoredText): boolean {
	return stored.kind === "unset" || (stored.kind === "text" && stored.text === "");
}

export type RobotsFactsState =
	| { status: "pending" }
	| { status: "error" }
	| { status: "ready"; owner: string };

/**
 * Checked again when a write is confirmed, because ownership, role or busy
 * state can change while a confirmation is open. EmDash's permission check
 * cannot enforce who owns /robots.txt.
 */
export function robotsWriteAllowed(kind: "save" | "restore", blockers: { save: readonly RobotsWriteBlocker[]; restore: readonly RobotsWriteBlocker[] }): boolean {
	return blockers[kind].length === 0;
}

export type RobotsWriteBlocker =
	| "settings-unavailable"
	| "ownership-pending"
	| "ownership-unknown"
	| "not-core"
	| "role"
	| "role-unknown"
	| "seo-malformed"
	| "line-ends"
	| "uncertain"
	| "busy"
	| "too-long"
	| "unchanged"
	| "already-default";

/**
 * Reasons the editor cannot save the draft or restore the default now. Writes
 * stay off until the role hint says allowed; the endpoint still decides. A
 * draft built from stored CR line ends saves LF ones, so it needs the
 * person's explicit consent first.
 */
export function robotsWriteBlockers(input: {
	snapshot: RobotsSettingsSnapshot | null;
	facts: RobotsFactsState;
	manage: RobotsRoleHint;
	uncertain: boolean;
	busy: boolean;
	draft: string;
	lineEndsAccepted: boolean;
}): { save: RobotsWriteBlocker[]; restore: RobotsWriteBlocker[] } {
	const common: RobotsWriteBlocker[] = [];
	if (!input.snapshot) common.push("settings-unavailable");
	if (input.facts.status === "pending") common.push("ownership-pending");
	else if (input.facts.status === "error") common.push("ownership-unknown");
	else if (input.facts.owner !== "emdash-core") common.push("not-core");
	if (input.manage === "denied") common.push("role");
	else if (input.manage !== "allowed") common.push("role-unknown");
	if (input.snapshot && !input.snapshot.seoMergeable) common.push("seo-malformed");
	if (input.uncertain) common.push("uncertain");
	if (input.busy) common.push("busy");
	const save = [...common];
	if (input.snapshot && robotsHasCarriageReturns(input.snapshot.stored) && !input.lineEndsAccepted) save.push("line-ends");
	if (robotsTxtTooLong(input.draft)) save.push("too-long");
	if (input.snapshot && !robotsDraftChanged(input.snapshot.stored, input.draft)) save.push("unchanged");
	const restore = [...common];
	// Nothing stored is nothing to restore, whatever the draft; Discard changes clears a draft without a write.
	if (input.snapshot && robotsStoredIsDefault(input.snapshot.stored)) restore.push("already-default");
	return { save, restore };
}

/**
 * Whether the text box accepts edits. It is locked while a save, restore or
 * reload is in flight, because their result replaces the draft.
 */
export function robotsEditable(input: {
	snapshot: RobotsSettingsSnapshot | null;
	facts: RobotsFactsState;
	manage: RobotsRoleHint;
	uncertain: boolean;
	busy: boolean;
}): boolean {
	return input.snapshot !== null && input.snapshot.seoMergeable && input.facts.status === "ready" &&
		input.facts.owner === "emdash-core" && input.manage === "allowed" && !input.uncertain && !input.busy;
}

// ---- Preview and observation ---------------------------------------------

/** Bytes read from an observed /robots.txt; core's largest body is far below this. */
export const ROBOTS_OBSERVATION_MAX_BYTES = 65_536;

/**
 * Reads at most `maxBytes` of a response body and cancels the rest. Decodes
 * UTF-8 keeping a leading byte order mark, which `Response.text()` strips but
 * core sends when the stored text starts with one.
 */
export async function readRobotsObservationBody(
	body: ReadableStream<Uint8Array> | null,
	maxBytes: number = ROBOTS_OBSERVATION_MAX_BYTES,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
	if (!body) return { text: "", bytes: 0, truncated: false };
	const reader = body.getReader();
	const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
	let text = "";
	let bytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytes + value.byteLength > maxBytes) {
			text += decoder.decode(value.subarray(0, maxBytes - bytes), { stream: true });
			bytes = maxBytes;
			await reader.cancel().catch(() => undefined);
			return { text: text + decoder.decode(), bytes, truncated: true };
		}
		bytes += value.byteLength;
		text += decoder.decode(value, { stream: true });
	}
	return { text: text + decoder.decode(), bytes, truncated: false };
}

export interface RobotsPreviewOrigin {
	configuredOrigin: RobotsConfiguredOrigin | null;
	configuredOriginKnown: boolean;
	requestOrigin: string;
	hostVersion?: string | null;
}

export type RobotsServedPreview =
	| { kind: "file"; file: RobotsEffectiveFile; sitemapBase: RobotsSitemapBase; originKnown: boolean }
	| { kind: "fallback"; body: string; reason: "site-url-invalid" | "stored-invalid" };

/**
 * The body core serves for `text` (null when the field is unset). The origin
 * is not known when Site settings has no URL and the build recorded no facts.
 */
export function robotsServedPreview(input: RobotsPreviewOrigin & {
	text: string | null;
	siteUrl: RobotsSiteUrl;
	disallowAiTraining?: boolean;
}): RobotsServedPreview {
	if (input.siteUrl.kind === "invalid") return { kind: "fallback", body: ROBOTS_TXT_CORE_FALLBACK_BODY, reason: "site-url-invalid" };
	const sitemapBase = robotsSitemapBase({
		settingsUrl: input.siteUrl.kind === "text" ? input.siteUrl.text : null,
		configuredOrigin: input.configuredOrigin,
		requestOrigin: input.requestOrigin,
	});
	return {
		kind: "file",
		file: effectiveRobotsTxt(input.text, sitemapBase.base, input),
		sitemapBase,
		originKnown: input.siteUrl.kind === "text" || input.configuredOriginKnown,
	};
}

/** What core serves for the stored state, including stored values core cannot use. */
export function robotsStoredPreview(snapshot: RobotsSettingsSnapshot, origin: RobotsPreviewOrigin): RobotsServedPreview {
	const stored = snapshot.stored;
	if (stored.kind === "invalid" && stored.served === "fallback" && snapshot.siteUrl.kind !== "invalid") {
		return { kind: "fallback", body: ROBOTS_TXT_CORE_FALLBACK_BODY, reason: "stored-invalid" };
	}
	return robotsServedPreview({ ...origin, siteUrl: snapshot.siteUrl, text: stored.kind === "text" ? stored.text : null, disallowAiTraining: snapshot.disallowAiTraining });
}

/**
 * Compares a same-origin observation with the stored state. When core can
 * only serve its permissive fallback for the stored data, a fallback body is
 * still reported as the fallback, never as current configuration.
 */
export function robotsObservation(
	snapshot: RobotsSettingsSnapshot,
	origin: RobotsPreviewOrigin,
	response: { status: number; redirected: boolean; body: string; truncated?: boolean },
): RobotsObservationResult {
	if (response.truncated) return { status: "unavailable", reason: "too-large" };
	const preview = robotsStoredPreview(snapshot, origin);
	if (preview.kind === "fallback") {
		if (response.redirected) return { status: "unavailable", reason: "redirect" };
		if (response.status !== 200) return { status: "unavailable", reason: "status" };
		return response.body === ROBOTS_TXT_CORE_FALLBACK_BODY ? { status: "fallback" } : { status: "different" };
	}
	return classifyRobotsObservation({
		...response,
		stored: snapshot.stored.kind === "text" ? snapshot.stored.text : null,
		sitemapBase: preview.sitemapBase,
		hostVersion: origin.hostVersion,
		disallowAiTraining: snapshot.disallowAiTraining,
	});
}
