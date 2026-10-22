import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_REDIRECT_EDIT_LIMITS,
	SEO_ENGINE_PLUGIN_ID,
	REDIRECT_EDIT_INPUT_MAX_LENGTH,
	REDIRECT_GROUP_MAX_LENGTH,
	REDIRECT_ID_MAX_LENGTH,
	REDIRECT_PATH_MAX_LENGTH,
	REDIRECT_REVISION_MAX_LENGTH,
	REDIRECT_TIMESTAMP_MAX_LENGTH,
	redirectRuleConfiguration,
	redirectRuleEditability,
	type RedirectRule,
	type RedirectRuleEditDraft,
	type RedirectRuleUpdateRequest,
	type RedirectRuleUpdateSnapshot,
	type SeoAdminRedirectRuleLoadResult,
	type SeoAdminRedirectRuleUpdateResult,
	type SeoAdminRedirectRuleUpdateRecoveryResult,
} from "../admin-contract.ts";
import { jsonUtf8LengthWithin } from "../lib.ts";

export const REDIRECT_EDIT_COMMANDS = Object.freeze({
	load: "admin-redirect-rule",
	update: "update-admin-redirect-rule",
	reconcile: "reconcile-admin-redirect-rule-update",
} as const);

export interface RedirectEditApiClient {
	apiFetch(input: string, init?: RequestInit): Promise<Response>;
	parseApiResponse<T>(response: Response, fallbackMessage?: string): Promise<T>;
}
export type RedirectEditApiClientLoader = () => Promise<RedirectEditApiClient>;
export const loadRedirectEditApiClient: RedirectEditApiClientLoader = async () => {
	const admin = await import("@emdash-cms/admin");
	return { apiFetch: admin.apiFetch, parseApiResponse: admin.parseApiResponse };
};

export interface RedirectEditUnusable {
	status: "unusable";
	reason: "request" | "oversized" | "malformed" | "identity" | "version";
}
export type RedirectEditLoadOutcome = SeoAdminRedirectRuleLoadResult | RedirectEditUnusable;
export type RedirectEditUpdateOutcome = SeoAdminRedirectRuleUpdateResult | RedirectEditUnusable;
export type RedirectEditRecoveryOutcome = SeoAdminRedirectRuleUpdateRecoveryResult | RedirectEditUnusable;

export interface RedirectEditSubmission {
	readonly request: RedirectRuleUpdateRequest;
	readonly snapshot: RedirectRuleUpdateSnapshot;
}

export interface RedirectEditApi {
	load(id: string, signal?: AbortSignal): Promise<RedirectEditLoadOutcome>;
	update(submission: RedirectEditSubmission, signal?: AbortSignal): Promise<RedirectEditUpdateOutcome>;
	reconcile(submission: RedirectEditSubmission, signal?: AbortSignal): Promise<RedirectEditRecoveryOutcome>;
}

type Wire = Record<string, unknown>;
const DRAFT_KEYS = ["source", "destination", "type", "enabled"];
const CONFIG_KEYS = [...DRAFT_KEYS, "isPattern", "groupName", "auto"];
const RULE_KEYS = ["id", ...CONFIG_KEYS, "hits", "lastHitAt", "createdAt", "updatedAt"];
const PATH_CODES = [
	"required", "too-long", "absolute-url", "not-a-path", "protocol-relative", "backslash",
	"control-characters", "query", "fragment", "dot-segment", "invalid-encoding", "pattern",
	"reserved-path", "file-extension", "same-address", "stored-path",
];
const unusable = (reason: RedirectEditUnusable["reason"]): RedirectEditUnusable => ({ status: "unusable", reason });

function record(value: unknown): value is Wire {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: unknown, expected: readonly string[]): value is Wire {
	return record(value) && Object.keys(value).length === expected.length &&
		expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function resultKeys(value: unknown, expected: readonly string[]): value is Wire {
	return keys(value, ["contractVersion", "status", ...expected]);
}
function text(value: unknown, max: number, min = 0): value is string {
	return typeof value === "string" && value.length >= min && value.length <= max;
}
function oneOf(value: unknown, choices: readonly unknown[]): boolean { return choices.includes(value); }
function message(value: unknown): boolean { return text(value, SEO_ADMIN_REDIRECT_EDIT_LIMITS.messageLength, 1); }
function revision(value: unknown): value is string { return text(value, REDIRECT_REVISION_MAX_LENGTH, 1); }
function id(value: unknown): value is string { return text(value, REDIRECT_ID_MAX_LENGTH, 1); }

function rule(value: unknown): value is RedirectRule {
	return keys(value, RULE_KEYS) && id(value.id) && text(value.source, REDIRECT_PATH_MAX_LENGTH) &&
		text(value.destination, REDIRECT_PATH_MAX_LENGTH) && oneOf(value.type, [301, 302, 307, 308, 410, 451]) &&
		typeof value.enabled === "boolean" && typeof value.isPattern === "boolean" && typeof value.auto === "boolean" &&
		(value.groupName === null || text(value.groupName, REDIRECT_GROUP_MAX_LENGTH)) &&
		Number.isSafeInteger(value.hits) && (value.hits as number) >= 0 &&
		(value.lastHitAt === null || text(value.lastHitAt, REDIRECT_TIMESTAMP_MAX_LENGTH)) &&
		text(value.createdAt, REDIRECT_TIMESTAMP_MAX_LENGTH) && text(value.updatedAt, REDIRECT_TIMESTAMP_MAX_LENGTH);
}
function editableRule(value: unknown): value is RedirectRule {
	return rule(value) && redirectRuleEditability(value) === "editable";
}
function draft(value: unknown): value is RedirectRuleEditDraft {
	return keys(value, DRAFT_KEYS) && text(value.source, REDIRECT_EDIT_INPUT_MAX_LENGTH) &&
		text(value.destination, REDIRECT_EDIT_INPUT_MAX_LENGTH) && oneOf(value.type, [301, 302]) && typeof value.enabled === "boolean";
}
function configuration(value: unknown): boolean {
	return keys(value, CONFIG_KEYS) && text(value.source, REDIRECT_PATH_MAX_LENGTH) &&
		text(value.destination, REDIRECT_PATH_MAX_LENGTH) && oneOf(value.type, [301, 302]) &&
		typeof value.enabled === "boolean" && value.isPattern === false && typeof value.auto === "boolean" &&
		(value.groupName === null || text(value.groupName, REDIRECT_GROUP_MAX_LENGTH));
}
function sameFields(left: object, right: object, fields: readonly string[]): boolean {
	const leftFields = left as Wire;
	const rightFields = right as Wire;
	return fields.every((field) => leftFields[field] === rightFields[field]);
}
function within(value: unknown, limit: number): boolean {
	try { return jsonUtf8LengthWithin(value, limit) !== null; } catch { return false; }
}
function freeze<T>(value: T): T {
	if (record(value) || Array.isArray(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/** Captures the loaded configuration and the submitted draft without normalizing paths. */
export function prepareRedirectEditSubmission(
	loaded: RedirectRule,
	loadedRevision: string,
	edit: RedirectRuleEditDraft,
): RedirectEditSubmission | null {
	if (!editableRule(loaded) || !revision(loadedRevision) || !draft(edit)) return null;
	const submission = {
		request: { id: loaded.id, revision: loadedRevision, ...edit },
		snapshot: { id: loaded.id, revision: loadedRevision, baseline: redirectRuleConfiguration(loaded), draft: { ...edit } },
	};
	return captureSubmission(submission);
}

function captureSubmission(input: RedirectEditSubmission): RedirectEditSubmission | null {
	if (!keys(input, ["request", "snapshot"]) || !keys(input.request, ["id", "revision", ...DRAFT_KEYS]) ||
		!keys(input.snapshot, ["id", "revision", "baseline", "draft"])) return null;
	const request = input.request;
	const snapshot = input.snapshot;
	if (!id(request.id) || !revision(request.revision) || !draft(Object.fromEntries(DRAFT_KEYS.map((key) => [key, request[key]]))) ||
		!configuration(snapshot.baseline) || !draft(snapshot.draft) || request.id !== snapshot.id ||
		request.revision !== snapshot.revision || !sameFields(request, snapshot.draft, DRAFT_KEYS) ||
		!within(request, SEO_ADMIN_REDIRECT_EDIT_LIMITS.updateRequestBytes) ||
		!within(snapshot, SEO_ADMIN_REDIRECT_EDIT_LIMITS.recoveryRequestBytes)) return null;
	return freeze(JSON.parse(JSON.stringify(input)) as RedirectEditSubmission);
}

function envelope(value: unknown): RedirectEditUnusable | null {
	if (!within(value, SEO_ADMIN_REDIRECT_EDIT_LIMITS.resultBytes)) return unusable("oversized");
	if (!record(value)) return unusable("malformed");
	if (value.contractVersion !== SEO_ADMIN_CONTRACT_VERSION) return unusable("version");
	return null;
}
function ownedOptionalRule(value: unknown, requestedId: string): boolean {
	return value === null || (rule(value) && value.id === requestedId);
}
function unsupported(value: Wire, requestedId: string): boolean {
	if (!resultKeys(value, ["reason", "rule", "message"]) || !message(value.message)) return false;
	if (value.reason === "envelope") return value.rule === null;
	return rule(value.rule) && value.rule.id === requestedId &&
		redirectRuleEditability(value.rule) === value.reason && oneOf(value.reason, ["pattern", "type"]);
}

export function parseRedirectEditLoad(value: unknown, requestedId: string): RedirectEditLoadOutcome {
	const error = envelope(value);
	if (error) return error;
	const wire = value as Wire;
	if (wire.status === "loaded") {
		if (!resultKeys(wire, ["rule", "revision", "update"]) || !editableRule(wire.rule) || !revision(wire.revision) ||
			!oneOf(wire.update, ["available", "no-permission", "read-only"])) return unusable("malformed");
		if (wire.rule.id !== requestedId) return unusable("identity");
	} else if (wire.status === "unsupported") {
		if (!unsupported(wire, requestedId)) return unusable("malformed");
	} else if (wire.status === "missing") {
		if (!resultKeys(wire, ["message"]) || !message(wire.message)) return unusable("malformed");
	} else if (wire.status === "invalid" || wire.status === "unavailable") {
		if (!resultKeys(wire, ["reason", "message"]) || !message(wire.message) ||
			wire.reason !== (wire.status === "invalid" ? "input" : "no-access")) return unusable("malformed");
	} else if (wire.status === "failed") {
		if (!resultKeys(wire, ["message", "retryable"]) || !message(wire.message) || wire.retryable !== true) return unusable("malformed");
	} else return unusable("malformed");
	return value as SeoAdminRedirectRuleLoadResult;
}

function fieldErrors(value: unknown): boolean {
	if (!record(value)) return false;
	const fields = Object.keys(value);
	return fields.length > 0 && fields.every((field) => oneOf(field, ["source", "destination"]) &&
		keys(value[field], ["code", "message"]) && oneOf(value[field].code, PATH_CODES) && message(value[field].message));
}

export function parseRedirectEditUpdate(
	value: unknown,
	submission: RedirectEditSubmission,
	recovery = false,
): RedirectEditUpdateOutcome {
	const error = envelope(value);
	if (error) return error;
	const wire = value as Wire;
	const { snapshot } = submission;
	if (recovery && !oneOf(wire.status, ["updated", "unchanged", "stale", "missing", "uncertain", "invalid", "unavailable"])) {
		return unusable("malformed");
	}
	switch (wire.status) {
		case "updated":
		case "unchanged": {
			if (!resultKeys(wire, wire.status === "updated" ? ["rule", "revision", "confirmedBy"] : ["rule", "revision"]) ||
				!editableRule(wire.rule) || !revision(wire.revision)) return unusable("malformed");
			if (wire.rule.id !== snapshot.id) return unusable("identity");
			if (!sameFields(wire.rule, snapshot.baseline, ["groupName", "auto", "isPattern"])) {
				return unusable("malformed");
			}
			if (wire.rule.type !== snapshot.draft.type || wire.rule.enabled !== snapshot.draft.enabled ||
				(snapshot.draft.source === snapshot.baseline.source && wire.rule.source !== snapshot.baseline.source) ||
				(snapshot.draft.destination === snapshot.baseline.destination && wire.rule.destination !== snapshot.baseline.destination)) {
				return unusable("malformed");
			}
			if (wire.status === "updated") {
				if (wire.revision === snapshot.revision || !oneOf(wire.confirmedBy, recovery ? ["recovery"] : ["host", "recovery"])) return unusable("malformed");
			} else if ((!recovery && wire.revision !== snapshot.revision) ||
				!sameFields(wire.rule, snapshot.baseline, CONFIG_KEYS)) return unusable("malformed");
			break;
		}
		case "invalid":
			if (wire.reason === "input") {
				if (!resultKeys(wire, ["reason", "message"]) || !message(wire.message)) return unusable("malformed");
			} else if (wire.reason !== "fields" || !resultKeys(wire, ["reason", "errors"]) || !fieldErrors(wire.errors)) return unusable("malformed");
			break;
		case "conflict":
			if (!resultKeys(wire, ["reason", "message", "existing"]) || !message(wire.message) ||
				!oneOf(wire.reason, ["duplicate", "trailing-slash", "loop", "check-incomplete"]) ||
				!(wire.existing === null || rule(wire.existing))) return unusable("malformed");
			break;
		case "stale":
			if (!resultKeys(wire, ["reason", "message", "current"]) || !message(wire.message) ||
				!oneOf(wire.reason, ["revision", "changed"]) || !ownedOptionalRule(wire.current, snapshot.id)) return unusable("malformed");
			break;
		case "missing":
			if (!resultKeys(wire, ["message"]) || !message(wire.message)) return unusable("malformed");
			break;
		case "unsupported":
			if (!unsupported(wire, snapshot.id)) return unusable("malformed");
			break;
		case "refused":
			if (!resultKeys(wire, ["reason", "message"]) || !message(wire.message) ||
				!oneOf(wire.reason, ["host-validation", "precondition"])) return unusable("malformed");
			break;
		case "busy":
			if (!resultKeys(wire, ["message", "retryable"]) || !message(wire.message) || wire.retryable !== true) return unusable("malformed");
			break;
		case "not-saved":
			if (!resultKeys(wire, ["reason", "message", "retryable"]) || !message(wire.message) || wire.retryable !== true ||
				!oneOf(wire.reason, ["read-failed", "deadline", "write-failed"])) return unusable("malformed");
			break;
		case "uncertain":
		case "unavailable":
			if (!resultKeys(wire, ["reason", "message"]) || !message(wire.message) ||
				!oneOf(wire.reason, wire.status === "uncertain" ? ["pending", "unreadable"] : ["no-access", "read-only"])) return unusable("malformed");
			break;
		default: return unusable("malformed");
	}
	return value as SeoAdminRedirectRuleUpdateResult;
}

/** Retained response bytes are capped before the published JSON envelope parser runs. */
async function cappedResponse(response: Response): Promise<Response | null> {
	const max = SEO_ADMIN_REDIRECT_EDIT_LIMITS.wireResponseBytes;
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > max) {
		await response.body?.cancel();
		return null;
	}
	if (!response.body) return response;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			if (next.value.byteLength > max - length) {
				await reader.cancel();
				return null;
			}
			chunks.push(next.value.slice());
			length += next.value.byteLength;
		}
	} finally { reader.releaseLock(); }
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
	return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function createRedirectEditApi(load: RedirectEditApiClientLoader = loadRedirectEditApiClient): RedirectEditApi {
	const post = async (command: keyof typeof REDIRECT_EDIT_COMMANDS, body: string, signal?: AbortSignal) => {
		const client = await load();
		const response = await client.apiFetch(`/_emdash/api/plugins/${SEO_ENGINE_PLUGIN_ID}/${REDIRECT_EDIT_COMMANDS[command]}`, {
			method: "POST", headers: { "Content-Type": "application/json" }, body, ...(signal ? { signal } : {}),
		});
		const bounded = await cappedResponse(response);
		return bounded === null ? null : { value: await client.parseApiResponse<unknown>(bounded, "The redirect request could not be completed.") };
	};
	return {
		async load(requestedId, signal) {
			if (!id(requestedId)) return unusable("request");
			const response = await post("load", JSON.stringify({ id: requestedId }), signal);
			return response === null ? unusable("oversized") : parseRedirectEditLoad(response.value, requestedId);
		},
		async update(input, signal) {
			const captured = captureSubmission(input);
			if (!captured) return unusable("request");
			const response = await post("update", JSON.stringify(captured.request), signal);
			return response === null ? unusable("oversized") : parseRedirectEditUpdate(response.value, captured);
		},
		async reconcile(input, signal) {
			const captured = captureSubmission(input);
			if (!captured) return unusable("request");
			const response = await post("reconcile", JSON.stringify(captured.snapshot), signal);
			return response === null ? unusable("oversized") :
				parseRedirectEditUpdate(response.value, captured, true) as RedirectEditRecoveryOutcome;
		},
	};
}
