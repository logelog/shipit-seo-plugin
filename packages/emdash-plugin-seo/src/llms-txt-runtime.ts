// The llms.txt document in plugin KV: one versioned record holding the text
// and the output switch under a single revision. Admin reads and writes and
// the public response build on the shared policy. Host specifics arrive as
// installation facts; this module has no database, Astro or native-only
// import and runs in either plugin format.
import type { PluginContext } from "emdash";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminLlmsTxt,
	type SeoAdminLlmsTxtWriteResult,
} from "./admin-contract.ts";
import {
	LLMS_TXT_CACHE_CONTROL,
	LLMS_TXT_DOCUMENT_MAX_BYTES,
	LLMS_TXT_DOCUMENT_PROBLEM_TEXT,
	LLMS_TXT_HEADING_PROBLEM_TEXT,
	LLMS_TXT_PATH,
	LLMS_TXT_STORAGE_VERSION,
	LLMS_TXT_STORED_COPY_MAX_BYTES,
	LLMS_TXT_WRITE_REQUEST_MAX_BYTES,
	checkLlmsTxtActivation,
	checkLlmsTxtDocument,
	llmsTxtPublicResponse,
	llmsTxtUtf8Bytes,
	parseLlmsTxtRecord,
	type LlmsTxtCorruptReason,
	type LlmsTxtDocumentProblem,
	type LlmsTxtHeadingProblem,
	type LlmsTxtPublicResponse,
	type LlmsTxtRecord,
	type LlmsTxtRefusal,
	type LlmsTxtStoredState,
} from "./llms-txt-document.ts";
import type { LlmsTxtInstallation } from "./llms-txt-installation.ts";

export const LLMS_TXT_SETTINGS_KEY = `configuration:llms-txt:v${LLMS_TXT_STORAGE_VERSION}`;

interface VersionedKv {
	getVersioned?: (key: string) => Promise<unknown>;
	compareAndSet?: (key: string, expectedRevision: string | null, value: unknown) => Promise<unknown>;
	compareAndDelete?: (key: string, expectedRevision: string) => Promise<unknown>;
}

type LlmsTxtSnapshot =
	| { state: "absent"; revision: null }
	| { state: "stored"; revision: string; record: LlmsTxtRecord }
	| { state: "corrupt"; revision: string; reason: LlmsTxtCorruptReason; detail: string; value: unknown }
	| { state: "unavailable"; revision: null };

function validRevision(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function versionedKv(ctx: PluginContext): PluginContext["kv"] & VersionedKv {
	return ctx.kv as PluginContext["kv"] & VersionedKv;
}

function conditionalStorage(ctx: PluginContext): boolean {
	const kv = versionedKv(ctx);
	return typeof kv.getVersioned === "function" && typeof kv.compareAndSet === "function" &&
		typeof kv.compareAndDelete === "function";
}

/**
 * Reads the record without creating one. A present value that is not a valid
 * record is corrupt with its revision; a value the host cannot parse makes
 * `getVersioned` throw before any revision exists, which is unavailable.
 */
export async function readLlmsTxtSnapshot(ctx: PluginContext): Promise<LlmsTxtSnapshot> {
	const kv = versionedKv(ctx);
	if (typeof kv.getVersioned !== "function") return { state: "unavailable", revision: null };
	try {
		const snapshot = await kv.getVersioned(LLMS_TXT_SETTINGS_KEY) as { value?: unknown; revision?: unknown } | null;
		if (snapshot === null) return { state: "absent", revision: null };
		if (!snapshot || typeof snapshot !== "object" || !Object.hasOwn(snapshot, "value") || !validRevision(snapshot.revision)) {
			return { state: "unavailable", revision: null };
		}
		const parsed = parseLlmsTxtRecord(snapshot.value);
		return parsed.ok
			? { state: "stored", revision: snapshot.revision, record: parsed.record }
			: { state: "corrupt", revision: snapshot.revision, reason: parsed.reason, detail: parsed.detail, value: snapshot.value };
	} catch (error) {
		ctx.log?.warn?.("seo: llms.txt record could not be read", { error: String(error) });
		return { state: "unavailable", revision: null };
	}
}

// The stored value as the KV adapter returned it, serialized again. Its
// formatting can differ from the database text; it is a recovery copy, not
// a byte-identical backup.
function storedCopy(value: unknown): { copy: string | null; copyBytes: number } {
	let copy: string | undefined;
	try {
		copy = JSON.stringify(value, null, "\t");
	} catch {
		copy = undefined;
	}
	if (typeof copy !== "string") return { copy: null, copyBytes: 0 };
	const copyBytes = llmsTxtUtf8Bytes(copy);
	return copyBytes > LLMS_TXT_STORED_COPY_MAX_BYTES ? { copy: null, copyBytes } : { copy, copyBytes };
}

function adminState(installation: LlmsTxtInstallation | null, snapshot: LlmsTxtSnapshot, conditional: boolean): SeoAdminLlmsTxt {
	const corrupt = snapshot.state === "corrupt"
		? { reason: snapshot.reason, detail: snapshot.detail, ...storedCopy(snapshot.value) }
		: null;
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		owner: installation?.owner ?? "not-installed",
		ownerDetail: installation?.detail ?? null,
		hostVersion: installation?.hostVersion ?? null,
		conditionalStorage: conditional,
		state: snapshot.state,
		revision: snapshot.revision,
		enabled: snapshot.state === "stored" ? snapshot.record.enabled : false,
		text: snapshot.state === "stored" ? snapshot.record.text : null,
		bytes: snapshot.state === "stored" ? llmsTxtUtf8Bytes(snapshot.record.text) : null,
		corrupt,
		limits: { documentBytes: LLMS_TXT_DOCUMENT_MAX_BYTES, requestBytes: LLMS_TXT_WRITE_REQUEST_MAX_BYTES },
		path: LLMS_TXT_PATH,
		cacheControl: LLMS_TXT_CACHE_CONTROL,
	};
}

export async function buildLlmsTxtAdmin(ctx: PluginContext, installation: LlmsTxtInstallation | null): Promise<SeoAdminLlmsTxt> {
	return adminState(installation, await readLlmsTxtSnapshot(ctx), conditionalStorage(ctx));
}

const CONFLICT = "The stored llms.txt changed after it was loaded. Nothing was saved. Reload it before saving again.";
const UNAVAILABLE = "The stored llms.txt could not be read, so nothing was changed. Reload when it is readable again.";

function refused(reason: "conflict" | "invalid" | "blocked" | "unavailable", message: string, field?: "text"): SeoAdminLlmsTxtWriteResult {
	return { success: false, reason, message, ...(field ? { field } : {}) };
}

/** Writes are allowed only while Shipit is the settled owner and the host checks revisions. */
function writeBlocked(ctx: PluginContext, installation: LlmsTxtInstallation | null): SeoAdminLlmsTxtWriteResult | null {
	if (!conditionalStorage(ctx)) return refused("blocked", "This EmDash host cannot save llms.txt with a revision check.");
	if (!installation) return refused("blocked", "This installation recorded no owner for /llms.txt. Install the plugin through its Astro integration and rebuild.");
	if (installation.owner !== "shipit") {
		return refused("blocked", `This plugin does not serve /llms.txt on this build (${installation.owner}${installation.detail ? `: ${installation.detail}` : ""}), so changes are off.`);
	}
	return null;
}

function conditionalResult(value: unknown, action: "put" | "delete"): { applied: boolean; revision: string | null } {
	if (!value || typeof value !== "object" || typeof (value as { applied?: unknown }).applied !== "boolean") {
		throw new Error("The host returned an invalid conditional write result.");
	}
	const result = value as { applied: boolean; revision?: unknown };
	if (result.applied && action === "put" && !validRevision(result.revision)) {
		throw new Error("The host returned an invalid revision.");
	}
	return { applied: result.applied, revision: result.applied && action === "put" ? result.revision as string : null };
}

export function llmsTxtDocumentMessage(problem: LlmsTxtDocumentProblem | LlmsTxtHeadingProblem): string {
	return problem in LLMS_TXT_DOCUMENT_PROBLEM_TEXT
		? `The text is refused: ${LLMS_TXT_DOCUMENT_PROBLEM_TEXT[problem as LlmsTxtDocumentProblem]}`
		: LLMS_TXT_HEADING_PROBLEM_TEXT[problem as LlmsTxtHeadingProblem];
}

async function putRecord(
	ctx: PluginContext,
	installation: LlmsTxtInstallation,
	expectedRevision: string | null,
	record: LlmsTxtRecord,
): Promise<SeoAdminLlmsTxtWriteResult> {
	// A thrown write leaves the outcome unknown; it reaches the caller as a
	// server error, never as a refusal.
	const result = conditionalResult(await versionedKv(ctx).compareAndSet!(LLMS_TXT_SETTINGS_KEY, expectedRevision, record), "put");
	if (!result.applied) return refused("conflict", CONFLICT);
	return { success: true, changed: true, llms: adminState(installation, { state: "stored", revision: result.revision!, record }, true) };
}

/**
 * Revision-checked save of the text. The output switch keeps its stored
 * value; while it is on, the new text must meet the activation H1 rule. The
 * text is stored exactly as received.
 */
export async function saveLlmsTxtDocument(
	ctx: PluginContext,
	installation: LlmsTxtInstallation | null,
	input: { expectedRevision: string | null; text: string },
): Promise<SeoAdminLlmsTxtWriteResult> {
	const blocked = writeBlocked(ctx, installation);
	if (blocked) return blocked;
	const document = checkLlmsTxtDocument(input.text);
	if (!document.ok) return refused("invalid", llmsTxtDocumentMessage(document.problem), "text");
	const snapshot = await readLlmsTxtSnapshot(ctx);
	if (snapshot.state === "unavailable") return refused("unavailable", UNAVAILABLE);
	if (snapshot.revision !== input.expectedRevision) return refused("conflict", CONFLICT);
	if (snapshot.state === "corrupt") {
		return refused("blocked", "The stored llms.txt is invalid. Download its copy and reset it before saving new text.");
	}
	const enabled = snapshot.state === "stored" && snapshot.record.enabled;
	if (enabled) {
		const activation = checkLlmsTxtActivation(input.text);
		if (!activation.ok) {
			return refused("invalid", `Output is on, so the text needs an H1. ${llmsTxtDocumentMessage(activation.problem)} Or turn output off first.`, "text");
		}
	}
	if (snapshot.state === "stored" && snapshot.record.text === input.text) {
		return { success: true, changed: false, llms: adminState(installation!, snapshot, true) };
	}
	return putRecord(ctx, installation!, input.expectedRevision, { version: LLMS_TXT_STORAGE_VERSION, enabled, text: input.text });
}

/** Revision-checked change of the output switch; the stored text is kept byte for byte. */
export async function setLlmsTxtEnabled(
	ctx: PluginContext,
	installation: LlmsTxtInstallation | null,
	input: { expectedRevision: string; enabled: boolean },
): Promise<SeoAdminLlmsTxtWriteResult> {
	const blocked = writeBlocked(ctx, installation);
	if (blocked) return blocked;
	const snapshot = await readLlmsTxtSnapshot(ctx);
	if (snapshot.state === "unavailable") return refused("unavailable", UNAVAILABLE);
	if (snapshot.revision !== input.expectedRevision) return refused("conflict", CONFLICT);
	// An absent record has no revision, so a toggle for it is already a conflict.
	if (snapshot.state === "corrupt") return refused("blocked", "The stored llms.txt is invalid. Reset it before changing output.");
	if (snapshot.record.enabled === input.enabled) {
		return { success: true, changed: false, llms: adminState(installation!, snapshot, true) };
	}
	if (input.enabled) {
		const activation = checkLlmsTxtActivation(snapshot.record.text);
		if (!activation.ok) return refused("invalid", `Output stays off. ${llmsTxtDocumentMessage(activation.problem)}`);
	}
	return putRecord(ctx, installation!, input.expectedRevision, { ...snapshot.record, enabled: input.enabled });
}

/**
 * Revision-checked delete of an invalid record, only after the person has
 * been offered its copy. A valid record is never deleted here, and a value too
 * large to offer as a copy is left for operator recovery.
 */
export async function resetCorruptLlmsTxt(
	ctx: PluginContext,
	installation: LlmsTxtInstallation | null,
	input: { expectedRevision: string },
): Promise<SeoAdminLlmsTxtWriteResult> {
	const blocked = writeBlocked(ctx, installation);
	if (blocked) return blocked;
	const snapshot = await readLlmsTxtSnapshot(ctx);
	if (snapshot.state === "unavailable") return refused("unavailable", UNAVAILABLE);
	if (snapshot.revision !== input.expectedRevision) return refused("conflict", CONFLICT);
	if (snapshot.state !== "corrupt") return refused("blocked", "The stored llms.txt is not invalid, so it is not reset. Reload it.");
	if (storedCopy(snapshot.value).copy === null) {
		return refused("blocked", "The invalid value is too large to offer as a copy, so it is not reset here. Follow the operator recovery steps.");
	}
	const result = conditionalResult(await versionedKv(ctx).compareAndDelete!(LLMS_TXT_SETTINGS_KEY, snapshot.revision), "delete");
	if (!result.applied) return refused("conflict", CONFLICT);
	return { success: true, changed: true, llms: adminState(installation, { state: "absent", revision: null }, true) };
}

export type LlmsTxtHttpResult = { pass: true } | ({ pass: false } & LlmsTxtPublicResponse);

/**
 * The public response for the native middleware. `pass` hands the request on
 * whenever Shipit is not the settled owner. One KV read per served request;
 * refused methods and queries read nothing.
 */
export async function serveLlmsTxt(
	ctx: PluginContext,
	installation: LlmsTxtInstallation | null,
	refusal: LlmsTxtRefusal | null,
): Promise<LlmsTxtHttpResult> {
	if (!installation || installation.owner !== "shipit") return { pass: true };
	if (refusal) return { pass: false, ...llmsTxtPublicResponse({ refusal }) };
	const snapshot = await readLlmsTxtSnapshot(ctx);
	const stored: LlmsTxtStoredState = snapshot.state === "stored" ? { state: "stored", record: snapshot.record } : { state: snapshot.state };
	if (snapshot.state === "corrupt" || snapshot.state === "unavailable") {
		ctx.log?.warn?.("seo: llms.txt unavailable", { state: snapshot.state });
	}
	return { pass: false, ...llmsTxtPublicResponse({ refusal: null, stored }) };
}
