// Rules for the Site verification view. EmDash core owns
// `seo.googleVerification` and `seo.bingVerification`: its settings endpoint
// stores them and EmDashHead emits the provider meta tags. This module decides
// what the view may show and send. It has no React, DOM, host or network
// imports, so a sandbox view can reuse it.

export type VerificationProvider = "google" | "bing";

export const VERIFICATION_PROVIDERS = ["google", "bing"] as const satisfies readonly VerificationProvider[];

/** Core's settings field and the meta name EmDashHead emits from it. */
export const VERIFICATION_PROVIDER_FIELDS = {
	google: { field: "googleVerification", metaName: "google-site-verification" },
	bing: { field: "bingVerification", metaName: "msvalidate.01" },
} as const satisfies Record<VerificationProvider, { field: string; metaName: string }>;

/** Core's schema limit for each code. Its Zod version counts code points. */
export const VERIFICATION_CODE_MAX_LENGTH = 100;

export function verificationCodeLength(value: string): number {
	return [...value].length;
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

// ---- Host and role hints --------------------------------------------------

// EmDash 1.0.1 replaces the whole stored `seo` group on save, so a one-field
// update there erases the other code and every neighbouring SEO setting.
const VERIFICATION_MERGING_HOSTS: ReadonlySet<string> = new Set(["1.1.0", "1.2.0", "1.3.0", "1.3.1"]);

/** The EmDash version in the admin manifest the host already loaded. Reading it sends nothing. */
export function verificationHostVersion(manifest: unknown): string | null {
	return isPlainRecord(manifest) && typeof manifest.version === "string" && manifest.version ? manifest.version : null;
}

/** Saving is allowed only on hosts verified to merge supplied SEO fields into the stored group. */
export function verificationHostMerges(version: string | null): boolean {
	return version !== null && VERIFICATION_MERGING_HOSTS.has(version);
}

// EmDash 1.0.1, 1.1.0 and 1.2.0 grant settings:read from Editor (40) and
// settings:manage from Admin (50). Any other role value gives no hint.
const VERIFICATION_ROLE_LEVELS: ReadonlySet<number> = new Set([10, 20, 30, 40, 50]);
const VERIFICATION_READ_ROLE = 40;
const VERIFICATION_MANAGE_ROLE = 50;

export type VerificationRoleHint = "allowed" | "denied" | "unknown";

/** Presentation only: the settings endpoint authorizes every request. */
export function verificationRoleHints(user: { status: "pending" | "error" | "success"; role?: unknown }): {
	read: VerificationRoleHint;
	manage: VerificationRoleHint;
} {
	const role = user.role;
	if (user.status !== "success" || typeof role !== "number" || !VERIFICATION_ROLE_LEVELS.has(role)) {
		return { read: "unknown", manage: "unknown" };
	}
	return {
		read: role >= VERIFICATION_READ_ROLE ? "allowed" : "denied",
		manage: role >= VERIFICATION_MANAGE_ROLE ? "allowed" : "denied",
	};
}

// ---- Settings response ----------------------------------------------------

export type VerificationStoredCode =
	/** No tag is emitted: the field is absent or an empty string. */
	| { kind: "none"; stored: "absent" | "empty" }
	/** Emitted exactly as stored, whitespace included. */
	| { kind: "code"; code: string }
	/**
	 * Not a string. `identity` is the value's JSON, kept in memory only so a
	 * changed value is not mistaken for the loaded one; never shown or sent.
	 */
	| { kind: "unreadable"; type: string; identity: string };

export interface VerificationSnapshot {
	/** "absent" when EmDash has no SEO settings group stored yet. */
	seo: "absent" | "object";
	codes: Readonly<Record<VerificationProvider, VerificationStoredCode>>;
}

const ABSENT: VerificationStoredCode = { kind: "none", stored: "absent" };

/**
 * Projects the two codes from the settings data the admin helpers unwrap
 * without checking. Nothing else from the response is kept. A non-object
 * response or `seo` group is a failed read, never an empty configuration.
 */
export function parseVerificationSettings(data: unknown): { ok: true; snapshot: VerificationSnapshot } | { ok: false; detail: string } {
	if (!isPlainRecord(data)) return { ok: false, detail: `settings response is ${valueType(data)}, not an object` };
	const seo = data.seo;
	if (seo === undefined) return { ok: true, snapshot: { seo: "absent", codes: { google: ABSENT, bing: ABSENT } } };
	if (!isPlainRecord(seo)) return { ok: false, detail: `seo settings are ${valueType(seo)}, not an object` };
	const codes: Record<VerificationProvider, VerificationStoredCode> = { google: ABSENT, bing: ABSENT };
	for (const provider of VERIFICATION_PROVIDERS) {
		const field = VERIFICATION_PROVIDER_FIELDS[provider].field;
		const value = seo[field];
		if (value === undefined) continue;
		if (value === "") codes[provider] = { kind: "none", stored: "empty" };
		else if (typeof value === "string") codes[provider] = { kind: "code", code: value };
		else {
			const identity = jsonIdentity(value);
			if (identity === null) return { ok: false, detail: `seo.${field} cannot be read` };
			codes[provider] = { kind: "unreadable", type: valueType(value), identity };
		}
	}
	return { ok: true, snapshot: { seo: "object", codes } };
}

/** Absent and empty both mean no tag, so neither counts as a change of the other. */
export function sameVerificationCode(left: VerificationStoredCode, right: VerificationStoredCode): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind === "code" && right.kind === "code") return left.code === right.code;
	if (left.kind === "unreadable" && right.kind === "unreadable") return left.identity === right.identity && left.type === right.type;
	return true;
}

// ---- Request failures -----------------------------------------------------

export type VerificationRequestFailure =
	| { type: "response"; status: number; code: string; message: string }
	| { type: "malformed"; detail: string }
	| { type: "transport"; message: string };

export type VerificationReadProblem = "signed-out" | "forbidden" | "refused" | "unavailable" | "malformed" | "network";

// EmDash 1.1.0's auth middleware destroys a disabled account's session and
// answers 403 ACCOUNT_DISABLED, so only that 403 ends the session like a 401.
function sessionEnded(failure: { status: number; code: string }): boolean {
	return failure.status === 401 || (failure.status === 403 && failure.code === "ACCOUNT_DISABLED");
}

export function verificationReadProblem(failure: VerificationRequestFailure): VerificationReadProblem {
	if (failure.type === "malformed") return "malformed";
	if (failure.type === "transport") return "network";
	if (sessionEnded(failure)) return "signed-out";
	if (failure.status === 403 && failure.code === "FORBIDDEN") return "forbidden";
	return failure.status >= 400 && failure.status < 500 ? "refused" : "unavailable";
}

/** The read states the view tells apart besides a usable snapshot. */
export function verificationReadState(problem: VerificationReadProblem): "denied" | "malformed" | "unavailable" {
	if (problem === "signed-out" || problem === "forbidden") return "denied";
	return problem === "malformed" ? "malformed" : "unavailable";
}

export type VerificationWriteRefusal = "invalid" | "signed-out" | "forbidden" | "refused";

/**
 * A 4xx answer refuses the write before applying it. Null means the write may
 * have been applied: after a 5xx, a lost response or an unreadable success
 * body, because EmDash 1.1.0 merges, then reads every setting back and purges
 * caches inside the same request.
 */
export function verificationWriteRefusal(failure: VerificationRequestFailure): VerificationWriteRefusal | null {
	if (failure.type !== "response" || failure.status < 400 || failure.status >= 500) return null;
	if (failure.status === 400) return "invalid";
	if (sessionEnded(failure)) return "signed-out";
	if (failure.status === 403 && failure.code === "FORBIDDEN") return "forbidden";
	return "refused";
}

/** Refusals after which the view reads the current user again, once: an ended session or a denied permission. */
export function verificationRefusalRereadsRole(problem: VerificationReadProblem | VerificationWriteRefusal): boolean {
	return problem === "signed-out" || problem === "forbidden";
}

// ---- Port -----------------------------------------------------------------

export type VerificationPortResult = { ok: true; data: unknown } | { ok: false; failure: VerificationRequestFailure };

export interface VerificationPatch {
	seo: { googleVerification?: string; bingVerification?: string };
}

/** EmDash's settings endpoint, as the view uses it. */
export interface VerificationSettingsPort {
	read(): Promise<VerificationPortResult>;
	/** Sends exactly `patch`. Core merges each supplied SEO field and keeps every other setting. */
	write(patch: VerificationPatch): Promise<VerificationPortResult>;
}

export type VerificationLoadResult =
	| { ok: true; snapshot: VerificationSnapshot }
	| { ok: false; problem: VerificationReadProblem; failure: VerificationRequestFailure };

export async function loadVerificationSettings(port: VerificationSettingsPort): Promise<VerificationLoadResult> {
	const result = await port.read();
	if (!result.ok) return { ok: false, problem: verificationReadProblem(result.failure), failure: result.failure };
	const parsed = parseVerificationSettings(result.data);
	if (!parsed.ok) return { ok: false, problem: "malformed", failure: { type: "malformed", detail: parsed.detail } };
	return { ok: true, snapshot: parsed.snapshot };
}

// ---- Draft input ----------------------------------------------------------

export type VerificationDraftProblem =
	/** HTML instead of a code. `code` is the content value of this provider's pasted tag, when it is usable. */
	| { reason: "markup"; code: string | null }
	| { reason: "other-provider"; provider: VerificationProvider }
	| { reason: "spaces" }
	| { reason: "too-long"; length: number }
	/** A stored code was emptied by editing. Removing it takes the explicit Remove action. */
	| { reason: "empty" };

export type VerificationDraftCheck =
	| { status: "empty" }
	| { status: "code"; code: string }
	| { status: "invalid"; problem: VerificationDraftProblem };

const MARKUP = /[<>"']/;
const INVISIBLE = /[\s\p{Cc}\p{Cf}]/u;
const META_TAG = /<meta\b[^>]*>/gi;

function metaAttribute(tag: string, attribute: "name" | "content"): string | null {
	const match = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i").exec(tag);
	return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function readMetaTags(text: string): { provider: VerificationProvider | null; content: string }[] {
	const tags: { provider: VerificationProvider | null; content: string }[] = [];
	for (const match of text.matchAll(META_TAG)) {
		const content = metaAttribute(match[0], "content");
		if (content === null) continue;
		const name = metaAttribute(match[0], "name")?.toLowerCase();
		const provider = VERIFICATION_PROVIDERS.find((candidate) => VERIFICATION_PROVIDER_FIELDS[candidate].metaName === name) ?? null;
		tags.push({ provider, content });
	}
	return tags;
}

/**
 * Accepts one provider content code. Surrounding whitespace is dropped; the
 * code itself must not contain HTML, whitespace or invisible characters. This
 * says nothing about whether the provider will accept the code.
 */
export function checkVerificationDraft(provider: VerificationProvider, draft: string): VerificationDraftCheck {
	const code = draft.trim();
	if (!code) return { status: "empty" };
	if (MARKUP.test(code)) {
		const tags = readMetaTags(code);
		const own = tags.find((tag) => tag.provider === provider);
		if (own) {
			const inner = checkVerificationDraft(provider, own.content);
			return { status: "invalid", problem: { reason: "markup", code: inner.status === "code" ? inner.code : null } };
		}
		const other = tags.find((tag) => tag.provider !== null)?.provider;
		if (other) return { status: "invalid", problem: { reason: "other-provider", provider: other } };
		return { status: "invalid", problem: { reason: "markup", code: null } };
	}
	if (INVISIBLE.test(code)) return { status: "invalid", problem: { reason: "spaces" } };
	const length = verificationCodeLength(code);
	if (length > VERIFICATION_CODE_MAX_LENGTH) return { status: "invalid", problem: { reason: "too-long", length } };
	return { status: "code", code };
}

/** False for a stored code this view would not accept as typed, such as one with spaces or HTML. */
export function verificationStoredCodeIsPlain(provider: VerificationProvider, stored: VerificationStoredCode): boolean {
	if (stored.kind !== "code") return true;
	const check = checkVerificationDraft(provider, stored.code);
	return check.status === "code" && check.code === stored.code;
}

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** The tag EmDash 1.1.0 renders for a stored code, escaped as its page metadata renderer does. */
export function verificationMetaTag(provider: VerificationProvider, code: string): string {
	const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ATTRIBUTE_ESCAPES[character] ?? character);
	return `<meta name="${escape(VERIFICATION_PROVIDER_FIELDS[provider].metaName)}" content="${escape(code)}">`;
}

// ---- Fields and changes ---------------------------------------------------

export interface VerificationFieldState {
	/** Stored value the draft started from. A save is refused when the store no longer holds it. */
	base: VerificationStoredCode;
	draft: string;
	/** Set only by the explicit Remove action. */
	remove: boolean;
}

export type VerificationFields = Readonly<Record<VerificationProvider, VerificationFieldState>>;

/** Text for the input. A stored code is shown exactly; nothing is normalized by loading. */
export function verificationEditorText(stored: VerificationStoredCode): string {
	return stored.kind === "code" ? stored.code : "";
}

function fieldFrom(stored: VerificationStoredCode): VerificationFieldState {
	return { base: stored, draft: verificationEditorText(stored), remove: false };
}

// No pending change: untouched, or differing from the stored code only by
// surrounding whitespace. Such a field follows newer reads.
function followsStore(provider: VerificationProvider, field: VerificationFieldState): boolean {
	return verificationIntent(provider, field).kind === "unchanged";
}

// Also true when the draft already equals the newer stored value, as after a
// save this view did not see finish.
function adoptsRead(provider: VerificationProvider, field: VerificationFieldState, latest: VerificationStoredCode): boolean {
	return followsStore(provider, field) || verificationIntent(provider, { ...field, base: latest }).kind === "unchanged";
}

function sameField(left: VerificationFieldState, right: VerificationFieldState): boolean {
	return left.draft === right.draft && left.remove === right.remove && sameVerificationCode(left.base, right.base);
}

function mapFields(fields: VerificationFields, update: (provider: VerificationProvider, field: VerificationFieldState) => VerificationFieldState): VerificationFields {
	return { google: update("google", fields.google), bing: update("bing", fields.bing) };
}

export function verificationFieldsFrom(snapshot: VerificationSnapshot): VerificationFields {
	return { google: fieldFrom(snapshot.codes.google), bing: fieldFrom(snapshot.codes.bing) };
}

export function editVerificationDraft(fields: VerificationFields, provider: VerificationProvider, draft: string): VerificationFields {
	return { ...fields, [provider]: { ...fields[provider], draft, remove: false } };
}

export function removeVerificationCode(fields: VerificationFields, provider: VerificationProvider): VerificationFields {
	return { ...fields, [provider]: { ...fields[provider], draft: "", remove: true } };
}

export function undoVerificationField(fields: VerificationFields, provider: VerificationProvider): VerificationFields {
	return { ...fields, [provider]: fieldFrom(fields[provider].base) };
}

/**
 * Settles a code that changed in the store after its draft started. "use-stored"
 * drops the draft; "keep-mine" keeps it over the new value, so saving it is a
 * deliberate overwrite.
 */
export function resolveVerificationChange(
	fields: VerificationFields,
	provider: VerificationProvider,
	latest: VerificationStoredCode,
	choice: "use-stored" | "keep-mine",
): VerificationFields {
	return { ...fields, [provider]: choice === "use-stored" ? fieldFrom(latest) : { ...fields[provider], base: latest } };
}

export interface VerificationChange {
	provider: VerificationProvider;
	/** Stored value being replaced, compared again just before writing. */
	base: VerificationStoredCode;
	/** "" removes the code: core accepts no null. */
	value: string;
}

export type VerificationIntent =
	| { kind: "unchanged" }
	| { kind: "change"; change: VerificationChange; action: "add" | "replace" | "remove" }
	| { kind: "problem"; problem: VerificationDraftProblem };

/**
 * What saving would do with one field. A draft equal to the stored code, or
 * differing only by surrounding whitespace, is unchanged, so an untouched
 * provider never enters the update.
 */
export function verificationIntent(provider: VerificationProvider, field: VerificationFieldState): VerificationIntent {
	const base = field.base;
	if (field.remove) {
		return base.kind === "none" ? { kind: "unchanged" } : { kind: "change", change: { provider, base, value: "" }, action: "remove" };
	}
	if (base.kind === "code" && field.draft === base.code) return { kind: "unchanged" };
	const check = checkVerificationDraft(provider, field.draft);
	if (check.status === "empty") return base.kind === "code" ? { kind: "problem", problem: { reason: "empty" } } : { kind: "unchanged" };
	if (check.status === "invalid") return { kind: "problem", problem: check.problem };
	if (base.kind === "code" && check.code === base.code) return { kind: "unchanged" };
	return { kind: "change", change: { provider, base, value: check.code }, action: base.kind === "none" ? "add" : "replace" };
}

export function verificationChanges(fields: VerificationFields): { changes: VerificationChange[]; problems: VerificationProvider[] } {
	const changes: VerificationChange[] = [];
	const problems: VerificationProvider[] = [];
	for (const provider of VERIFICATION_PROVIDERS) {
		const intent = verificationIntent(provider, fields[provider]);
		if (intent.kind === "change") changes.push(intent.change);
		else if (intent.kind === "problem") problems.push(provider);
	}
	return { changes, problems };
}

/**
 * What the save footer reports. "clean" only when no field has a change or a
 * problem, the same rule that marks a field Unsaved; an invalid draft is
 * unsaved even though it cannot be sent.
 */
export type VerificationDraftSummary =
	| { kind: "clean" }
	| { kind: "ready"; changes: VerificationChange[] }
	| { kind: "invalid"; problems: VerificationProvider[]; changes: VerificationChange[] };

export function verificationDraftSummary(fields: VerificationFields): VerificationDraftSummary {
	const { changes, problems } = verificationChanges(fields);
	if (problems.length) return { kind: "invalid", problems, changes };
	return changes.length ? { kind: "ready", changes } : { kind: "clean" };
}

/** The whole update body: only the changed codes, never the loaded settings. */
export function verificationPatch(changes: readonly VerificationChange[]): VerificationPatch {
	const seo: VerificationPatch["seo"] = {};
	for (const change of changes) seo[VERIFICATION_PROVIDER_FIELDS[change.provider].field] = change.value;
	return { seo };
}

function storedAfterWrite(value: string): VerificationStoredCode {
	return value === "" ? { kind: "none", stored: "empty" } : { kind: "code", code: value };
}

// ---- Save and recovery ----------------------------------------------------

export interface VerificationPending {
	changes: readonly VerificationChange[];
	/** "write": the write may or may not have been applied. "readback": core accepted it; the confirming read failed. */
	cause: "write" | "readback";
	failure: VerificationRequestFailure;
}

export type VerificationSaveResult =
	/** The read before writing failed; nothing was written. */
	| { status: "not-checked"; problem: VerificationReadProblem; failure: VerificationRequestFailure }
	/** A changed code is no longer the stored value its draft started from; nothing was written. */
	| { status: "stale"; providers: VerificationProvider[]; latest: VerificationSnapshot }
	/** The endpoint refused the write before applying it. */
	| { status: "rejected"; refusal: VerificationWriteRefusal; failure: VerificationRequestFailure }
	/** The outcome is unknown. Nothing reads again until the owner asks. */
	| { status: "unconfirmed"; pending: VerificationPending }
	| { status: "confirmed"; latest: VerificationSnapshot; providers: VerificationProvider[] }
	/** The write was accepted, but the confirming read shows other values for `replaced`. */
	| { status: "conflict"; latest: VerificationSnapshot; confirmed: VerificationProvider[]; replaced: VerificationProvider[] };

/** Whether core may hold the sent codes now, so the host's cached settings are stale. */
export function verificationSaveMayHaveCommitted(result: VerificationSaveResult): boolean {
	return result.status === "confirmed" || result.status === "conflict" || result.status === "unconfirmed";
}

/**
 * One save through EmDash's last-writer-wins endpoint: a read, at most one
 * write and one confirming read. The read before writing only narrows the
 * window for overwriting another save; one landing between that read and the
 * write is still overwritten. An unconfirmed write is never retried, rolled
 * back or followed by an automatic read.
 */
export async function saveVerificationCodes(port: VerificationSettingsPort, changes: readonly VerificationChange[]): Promise<VerificationSaveResult> {
	const providers = changes.map((change) => change.provider);
	if (!providers.length || new Set(providers).size !== providers.length) {
		throw new TypeError("A verification save needs at least one change and one change per provider.");
	}
	const before = await loadVerificationSettings(port);
	if (!before.ok) return { status: "not-checked", problem: before.problem, failure: before.failure };
	const stale = changes.filter((change) => !sameVerificationCode(before.snapshot.codes[change.provider], change.base));
	if (stale.length) return { status: "stale", providers: stale.map((change) => change.provider), latest: before.snapshot };

	const written = await port.write(verificationPatch(changes));
	if (!written.ok) {
		const refusal = verificationWriteRefusal(written.failure);
		if (refusal) return { status: "rejected", refusal, failure: written.failure };
		return { status: "unconfirmed", pending: { changes, cause: "write", failure: written.failure } };
	}
	const response = parseVerificationSettings(written.data);
	if (!response.ok) {
		return { status: "unconfirmed", pending: { changes, cause: "write", failure: { type: "malformed", detail: response.detail } } };
	}

	const after = await loadVerificationSettings(port);
	if (!after.ok) return { status: "unconfirmed", pending: { changes, cause: "readback", failure: after.failure } };
	const replaced = changes.filter((change) => !sameVerificationCode(after.snapshot.codes[change.provider], storedAfterWrite(change.value)));
	const confirmed = providers.filter((provider) => !replaced.some((change) => change.provider === provider));
	if (replaced.length) return { status: "conflict", latest: after.snapshot, confirmed, replaced: replaced.map((change) => change.provider) };
	return { status: "confirmed", latest: after.snapshot, providers };
}

/**
 * What one read after an unconfirmed save shows for each sent code. It names
 * the stored value now, not the write's history: another save can store the
 * same code, or put the previous one back after this save was applied.
 */
export type VerificationRecoveryOutcome = "sent" | "previous" | "other";

export type VerificationRecoveryResult =
	| { ok: true; latest: VerificationSnapshot; outcomes: { provider: VerificationProvider; outcome: VerificationRecoveryOutcome }[] }
	| { ok: false; problem: VerificationReadProblem; failure: VerificationRequestFailure };

export async function recoverVerificationOutcome(port: VerificationSettingsPort, pending: VerificationPending): Promise<VerificationRecoveryResult> {
	const read = await loadVerificationSettings(port);
	if (!read.ok) return read;
	const outcomes = pending.changes.map((change) => {
		const stored = read.snapshot.codes[change.provider];
		const outcome: VerificationRecoveryOutcome = sameVerificationCode(stored, storedAfterWrite(change.value))
			? "sent"
			: sameVerificationCode(stored, change.base) ? "previous" : "other";
		return { provider: change.provider, outcome };
	});
	return { ok: true, latest: read.snapshot, outcomes };
}

/**
 * A newer read. Fields without a pending change, or whose draft it already
 * stores, follow it; others keep their draft and the base it started from.
 */
export function mergeVerificationSnapshot(fields: VerificationFields, latest: VerificationSnapshot): VerificationFields {
	return mapFields(fields, (provider, field) => (adoptsRead(provider, field, latest.codes[provider]) ? fieldFrom(latest.codes[provider]) : field));
}

/**
 * Fields after a save or recovery read. A confirmed code takes the stored
 * value unless its field changed after `sent` was captured. Another sent code
 * keeps its draft over the latest stored value, so saving it again is a
 * deliberate overwrite.
 */
export function settleVerificationFields(
	current: VerificationFields,
	sent: VerificationFields,
	latest: VerificationSnapshot,
	changed: readonly VerificationProvider[],
	confirmed: readonly VerificationProvider[],
): VerificationFields {
	return mapFields(current, (provider, field) => {
		const editedSince = !sameField(field, sent[provider]);
		if (!editedSince && confirmed.includes(provider)) return fieldFrom(latest.codes[provider]);
		if (!editedSince && changed.includes(provider)) return { ...field, base: latest.codes[provider] };
		return adoptsRead(provider, field, latest.codes[provider]) ? fieldFrom(latest.codes[provider]) : field;
	});
}

/**
 * Sent codes a finished save leaves unsettled: all of a refused, unchecked or
 * stale save, and those replaced after an accepted one. An unconfirmed save
 * keeps its codes in the pending record instead.
 */
export function verificationSaveHandoff(changes: readonly VerificationChange[], result: VerificationSaveResult): readonly VerificationChange[] {
	if (result.status === "confirmed" || result.status === "unconfirmed") return [];
	if (result.status === "conflict") return changes.filter((change) => result.replaced.includes(change.provider));
	return changes;
}

/** Sent codes a check did not find stored. */
export function verificationRecoveryHandoff(
	pending: VerificationPending,
	outcomes: readonly { provider: VerificationProvider; outcome: VerificationRecoveryOutcome }[],
): readonly VerificationChange[] {
	return pending.changes.filter((change) => outcomes.some((item) => item.provider === change.provider && item.outcome !== "sent"));
}

/** The codes a running or unconfirmed save sent, kept outside any mounted view. */
export function verificationWriteChanges(state: VerificationWriteState): readonly VerificationChange[] {
	if (state.status === "idle") return [];
	return state.status === "saving" ? state.changes : state.pending.changes;
}

/**
 * Puts the codes of a running or unconfirmed save back into fields built from
 * a read, so reopening the view or loading after a failed read keeps the
 * person's entry. A field with its own pending edit is kept, and providers the
 * save did not send stay as read.
 */
export function restoreVerificationIntent(fields: VerificationFields, changes: readonly VerificationChange[]): VerificationFields {
	return mapFields(fields, (provider, field) => {
		const change = changes.find((item) => item.provider === provider);
		if (!change || !followsStore(provider, field)) return field;
		return change.value === "" ? { ...field, draft: "", remove: true } : { ...field, draft: change.value, remove: false };
	});
}

/**
 * Handed-over providers still shown as unsaved in `fields` against `read`,
 * the read those fields are compared with. A code that read already holds,
 * apart from surrounding whitespace in a draft, is not reported. The answer
 * describes that read, not what EmDash stores now.
 */
export function verificationCarriedUnsaved(
	fields: VerificationFields,
	read: VerificationSnapshot,
	carried: readonly VerificationChange[],
): VerificationProvider[] {
	return VERIFICATION_PROVIDERS.filter((provider) => {
		if (!carried.some((change) => change.provider === provider)) return false;
		const status = verificationFieldStatus({ provider, field: fields[provider], latest: read.codes[provider], pending: null });
		return status === "unsaved" || status === "changed";
	});
}

/** The banner after an explicit edit, Undo or choice: notices about the form as it was no longer apply. */
export function verificationNoticeAfterEdit(previous: VerificationNotice | null): VerificationNotice | null {
	return previous?.status === "saved" || previous?.status === "carried" ? null : previous;
}

/**
 * The banner after handed-over codes are restored: the providers still unsaved
 * against the observed read, or no carried banner once none is.
 */
export function verificationNoticeAfterHandoff(previous: VerificationNotice | null, unsaved: readonly VerificationProvider[]): VerificationNotice | null {
	if (unsaved.length) return { status: "carried", providers: [...unsaved] };
	return previous?.status === "carried" ? null : previous;
}

// ---- View state -----------------------------------------------------------

export type VerificationFieldStatus = "saved" | "not-configured" | "unsaved" | "unconfirmed" | "unreadable" | "changed";

/** The banner the view shows for its latest request; an unconfirmed outcome is shown from the registry instead. */
export type VerificationNotice =
	| Exclude<VerificationSaveResult, { status: "confirmed" | "unconfirmed" }>
	| { status: "saved"; providers: VerificationProvider[] }
	| { status: "carried"; providers: VerificationProvider[] }
	| { status: "recovered"; outcomes: { provider: VerificationProvider; outcome: VerificationRecoveryOutcome }[] }
	| { status: "recovery-failed"; failure: VerificationRequestFailure }
	| { status: "reload-failed"; failure: VerificationRequestFailure };

/**
 * The banner after an owner-requested reload. A failed reload reports its own
 * failure. A successful one drops refusals, request failures and the result
 * of an earlier save or check, which described a role, session, connection or
 * stored codes it has just read again, and drops a banner about codes once
 * none of them is still edited. Drafts and an unconfirmed outcome are not
 * affected; reload is not offered while one is open.
 */
export function verificationNoticeAfterReload(
	previous: VerificationNotice | null,
	reload: { ok: true; fields: VerificationFields; snapshot: VerificationSnapshot } | { ok: false; failure: VerificationRequestFailure },
): VerificationNotice | null {
	if (!reload.ok) return { status: "reload-failed", failure: reload.failure };
	if (!previous) return null;
	const status = (provider: VerificationProvider) =>
		verificationFieldStatus({ provider, field: reload.fields[provider], latest: reload.snapshot.codes[provider], pending: null });
	switch (previous.status) {
		case "rejected":
		case "not-checked":
		case "recovery-failed":
		case "reload-failed":
		case "recovered":
		case "saved":
			return null;
		case "stale":
			return previous.providers.some((provider) => status(provider) === "changed") ? previous : null;
		case "conflict":
			return previous.replaced.some((provider) => status(provider) === "unsaved" || status(provider) === "changed") ? previous : null;
		case "carried": {
			const providers = previous.providers.filter((provider) => status(provider) === "unsaved" || status(provider) === "changed");
			if (!providers.length) return null;
			return providers.length === previous.providers.length ? previous : { status: "carried", providers };
		}
		default:
			return previous;
	}
}

/** Never "verified": storing a code is not the provider's ownership check. */
export function verificationFieldStatus(input: {
	provider: VerificationProvider;
	field: VerificationFieldState;
	latest: VerificationStoredCode;
	pending: VerificationPending | null;
}): VerificationFieldStatus {
	if (input.pending?.changes.some((change) => change.provider === input.provider)) return "unconfirmed";
	const edited = verificationIntent(input.provider, input.field).kind !== "unchanged";
	if (edited && !sameVerificationCode(input.field.base, input.latest)) return "changed";
	if (edited) return "unsaved";
	const base = input.field.base;
	return base.kind === "code" ? "saved" : base.kind === "unreadable" ? "unreadable" : "not-configured";
}

export type VerificationWriteState =
	| { status: "idle"; settled: number }
	| { status: "saving"; settled: number; changes: readonly VerificationChange[] }
	| { status: "unconfirmed"; settled: number; pending: VerificationPending }
	| { status: "checking"; settled: number; pending: VerificationPending };

export type VerificationSaveBlocker =
	| "settings-unavailable"
	| "host-unverified"
	| "role"
	| "role-unknown"
	| "unconfirmed"
	| "write-in-progress"
	| "busy"
	| "changed"
	| "invalid"
	| "unchanged";

/**
 * Reasons the view cannot save now. Saving stays off until the role hint says
 * allowed; the endpoint still decides every request.
 */
export function verificationSaveBlockers(input: {
	snapshot: VerificationSnapshot | null;
	fields: VerificationFields | null;
	hostVersion: string | null;
	manage: VerificationRoleHint;
	write: VerificationWriteState;
	busy: boolean;
}): VerificationSaveBlocker[] {
	const blockers: VerificationSaveBlocker[] = [];
	if (!input.snapshot || !input.fields) blockers.push("settings-unavailable");
	if (!verificationHostMerges(input.hostVersion)) blockers.push("host-unverified");
	if (input.manage === "denied") blockers.push("role");
	else if (input.manage !== "allowed") blockers.push("role-unknown");
	if (input.write.status === "unconfirmed" || input.write.status === "checking") blockers.push("unconfirmed");
	else if (input.write.status === "saving") blockers.push("write-in-progress");
	if (input.busy) blockers.push("busy");
	const { snapshot, fields } = input;
	if (snapshot && fields) {
		const { changes, problems } = verificationChanges(fields);
		if (changes.some((change) => !sameVerificationCode(change.base, snapshot.codes[change.provider]))) blockers.push("changed");
		if (problems.length) blockers.push("invalid");
		if (!changes.length) blockers.push("unchanged");
	}
	return blockers;
}

/** Inputs are read-only unless a save could follow, and while any save or check is open. */
export function verificationEditable(input: {
	snapshot: VerificationSnapshot | null;
	hostVersion: string | null;
	manage: VerificationRoleHint;
	write: VerificationWriteState;
	busy: boolean;
}): boolean {
	return input.snapshot !== null && verificationHostMerges(input.hostVersion) && input.manage === "allowed" &&
		input.write.status === "idle" && !input.busy;
}

/**
 * Owner-requested reads. Neither depends on the role hint: the endpoint
 * decides, and a read is how a person recovers after signing in again.
 * Reload waits while an outcome is unknown, because only the check compares
 * the stored codes with the ones sent.
 */
export function verificationReadActions(input: { write: VerificationWriteState; busy: boolean }): { reload: boolean; check: boolean } {
	return {
		reload: !input.busy && input.write.status === "idle",
		check: !input.busy && input.write.status === "unconfirmed",
	};
}

/**
 * Whether an owner-requested read should also reread the current user, once.
 * Focus and reconnect refetching are off, so a role cached as unknown or
 * denied, for example after signing in again elsewhere, otherwise keeps
 * editing off. The refreshed role is still only a hint.
 */
export function verificationRoleRefreshWanted(manage: VerificationRoleHint, userFetching: boolean): boolean {
	return manage !== "allowed" && !userFetching;
}

// ---- Operation ownership --------------------------------------------------

/** Which action of one mounted view may still apply its result. */
export interface VerificationOwner {
	/** Starts an action; results of every earlier action stop applying. */
	claim(): number;
	owns(token: number): boolean;
	/** The view is gone: no later result applies. */
	close(): void;
}

export function createVerificationOwner(): VerificationOwner {
	let generation = 0;
	let open = true;
	return {
		claim: () => ++generation,
		owns: (token) => open && token === generation,
		close: () => {
			open = false;
		},
	};
}

export interface VerificationWriteTicket {
	readonly id: number;
	readonly kind: "save" | "recovery";
}

/**
 * Writes and recovery reads shared by every mount of the view in one admin
 * document, so leaving and reopening the view cannot start a second save while
 * one is in flight or its outcome is unknown. Other tabs and other people are
 * not covered. `settled` counts finished operations, which lets a reopened
 * view notice that a save it did not start has ended.
 *
 * A finished operation also leaves its unsettled codes as a handoff. The view
 * that started it takes them at once if it is still open; otherwise they wait
 * for the next view to load, which may finish its first read only after the
 * operation answered.
 */
export interface VerificationWriteRegistry {
	current(): VerificationWriteState;
	/** Null unless idle. `changes` stay readable until the save settles. */
	beginSave(changes: readonly VerificationChange[]): VerificationWriteTicket | null;
	/** Null unless an outcome is unconfirmed and nothing is running. */
	beginRecovery(): VerificationWriteTicket | null;
	/**
	 * `pending` keeps an outcome unconfirmed; null clears it and stores
	 * `handoff`. A ticket that is not current is ignored.
	 */
	finish(ticket: VerificationWriteTicket, pending: VerificationPending | null, handoff?: readonly VerificationChange[]): void;
	/** The codes the last finished operation left unsettled, returned once. */
	takeHandoff(): readonly VerificationChange[];
	subscribe(listener: () => void): () => void;
}

export function createVerificationWriteRegistry(): VerificationWriteRegistry {
	let state: VerificationWriteState = { status: "idle", settled: 0 };
	let active: VerificationWriteTicket | null = null;
	let handoff: readonly VerificationChange[] = [];
	let lastId = 0;
	const listeners = new Set<() => void>();
	const update = (next: VerificationWriteState) => {
		state = next;
		for (const listener of [...listeners]) listener();
	};
	return {
		current: () => state,
		beginSave(changes) {
			if (state.status !== "idle") return null;
			active = { id: ++lastId, kind: "save" };
			handoff = [];
			update({ status: "saving", settled: state.settled, changes });
			return active;
		},
		beginRecovery() {
			if (state.status !== "unconfirmed") return null;
			active = { id: ++lastId, kind: "recovery" };
			update({ status: "checking", settled: state.settled, pending: state.pending });
			return active;
		},
		finish(ticket, pending, next = []) {
			if (active === null || ticket.id !== active.id) return;
			active = null;
			handoff = pending ? [] : next;
			const settled = state.settled + 1;
			update(pending ? { status: "unconfirmed", settled, pending } : { status: "idle", settled });
		},
		takeHandoff() {
			const taken = handoff;
			handoff = [];
			return taken;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
