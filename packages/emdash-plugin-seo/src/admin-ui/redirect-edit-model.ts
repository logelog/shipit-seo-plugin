// Session state for editing one existing exact-path redirect by its EmDash ID.
// The shared commands validate, plan and classify; this module orders the
// requests, fences late responses and keeps an unconfirmed save locked.
import {
	REDIRECT_EDIT_INPUT_MAX_LENGTH,
	redirectRuleEditability,
	type RedirectRule,
	type RedirectRuleEditAccess,
	type RedirectRuleEditDraft,
	type RedirectRuleEditFieldErrors,
} from "../admin-contract.ts";

import {
	prepareRedirectEditSubmission,
	type RedirectEditLoadOutcome,
	type RedirectEditRecoveryOutcome,
	type RedirectEditSubmission,
	type RedirectEditUpdateOutcome,
} from "./redirect-edit-api.ts";
import {
	INITIAL_REDIRECT_FILTERS,
	classifyRedirectRequestError,
	type RedirectListFilters,
} from "./redirect-rules-model.ts";

export type RedirectEditPhase =
	| "loading"
	| "load-failed"
	| "blocked"
	| "editing"
	| "saving"
	| "checking"
	| "uncertain"
	| "stale"
	| "reloading"
	| "saved";

export interface RedirectEditNotice {
	tone: "info" | "warning" | "error";
	title: string;
	message: string;
	/** The redirect can still be reviewed or managed in EmDash Redirects. */
	coreAdmin: boolean;
}

export interface RedirectEditLoaded {
	readonly rule: RedirectRule;
	/** Opaque; passed back unchanged and never decoded. */
	readonly revision: string;
	readonly access: RedirectRuleEditAccess;
}

export interface RedirectEditConfirmed {
	readonly rule: RedirectRule;
	readonly revision: string;
	readonly confirmedBy: "host" | "recovery";
}

export interface RedirectEditSession {
	/** A response for an earlier session is ignored. */
	readonly token: number;
	/** The exact EmDash ID this session reads and writes. */
	readonly id: string;
	readonly phase: RedirectEditPhase;
	readonly loaded: RedirectEditLoaded | null;
	/** Form fields; they become configuration only once EmDash confirms a save. */
	readonly draft: RedirectRuleEditDraft | null;
	/** Captured before the save request; recovery sends this same snapshot. */
	readonly operation: RedirectEditSubmission | null;
	/** The only request whose response may still change this session. */
	readonly pending: number | null;
	readonly notice: RedirectEditNotice | null;
	readonly fieldErrors: RedirectRuleEditFieldErrors;
	/** The rule a conflict, stale or unsupported result reported. */
	readonly related: RedirectRule | null;
	readonly confirmed: RedirectEditConfirmed | null;
	/** Another redirect requested while this one needed review. */
	readonly deferred: string | null;
	/**
	 * `hidden`: the dialog closed or the list unmounted while the save was
	 * unresolved; the result it settles into is kept until it is reviewed.
	 * `dismissed`: closed after its state was seen; it ends once the dialog
	 * has finished closing.
	 */
	readonly visibility: "shown" | "hidden" | "dismissed";
}

/** The last confirmed save; it outlives the dialog, the session and the list view. */
export interface RedirectEditCompletion {
	readonly sequence: number;
	readonly id: string;
	readonly rule: RedirectRule;
	readonly confirmedBy: "host" | "recovery";
}

export interface RedirectEditSnapshot {
	readonly session: RedirectEditSession | null;
	readonly completion: RedirectEditCompletion | null;
	/** Applied list filters, kept while the list view is unmounted. */
	readonly filters: RedirectListFilters;
	/** Counts saves stopped by field errors; each one moves focus and is announced. */
	readonly attempt: number;
	/** Source of session tokens, request IDs and completion sequences. */
	readonly counter: number;
}

export const INITIAL_REDIRECT_EDIT_SNAPSHOT: RedirectEditSnapshot = Object.freeze<RedirectEditSnapshot>({
	session: null,
	completion: null,
	filters: INITIAL_REDIRECT_FILTERS,
	attempt: 0,
	counter: 0,
});

export interface RedirectEditStore {
	get(): RedirectEditSnapshot;
	update(change: (current: RedirectEditSnapshot) => RedirectEditSnapshot): void;
	subscribe(listener: () => void): () => void;
}

/**
 * Holds the edit session outside the components, so closing the dialog or
 * leaving the tab cannot drop an unresolved save or unlock its fields.
 */
export function createRedirectEditStore(initial: RedirectEditSnapshot = INITIAL_REDIRECT_EDIT_SNAPSHOT): RedirectEditStore {
	let snapshot = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => snapshot,
		update(change) {
			const next = change(snapshot);
			if (next === snapshot) return;
			snapshot = next;
			for (const listener of [...listeners]) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export interface RedirectEditActions {
	load(id: string, signal: AbortSignal): Promise<RedirectEditLoadOutcome>;
	update(submission: RedirectEditSubmission, signal: AbortSignal): Promise<RedirectEditUpdateOutcome>;
	reconcile(submission: RedirectEditSubmission, signal: AbortSignal): Promise<RedirectEditRecoveryOutcome>;
	/**
	 * Reloads the first list page for these filters once. It runs after a
	 * confirmed save even when no list is mounted.
	 */
	refresh(filters: RedirectListFilters): void;
}

export interface RedirectEditDeadlines {
	loadMs: number;
	saveMs: number;
	checkMs: number;
}

export const REDIRECT_EDIT_DEADLINES: Readonly<RedirectEditDeadlines> = Object.freeze({
	loadMs: 15_000,
	saveMs: 20_000,
	checkMs: 15_000,
});

/** The save may have reached EmDash: fields stay fixed until a check settles it. */
export function redirectEditUnresolved(session: RedirectEditSession | null): boolean {
	return session !== null && (session.phase === "saving" || session.phase === "checking" || session.phase === "uncertain");
}

/**
 * A result that arrived while the dialog was hidden. A confirmed save is not
 * held here; the list's confirmed summary reports it.
 */
export function redirectEditRetained(session: RedirectEditSession | null): boolean {
	return session !== null && session.visibility === "hidden" && !redirectEditUnresolved(session) && session.phase !== "saved";
}

/** Must be reviewed before another redirect can be edited. */
export function redirectEditNeedsReview(session: RedirectEditSession | null): boolean {
	return redirectEditUnresolved(session) || redirectEditRetained(session);
}

export function redirectEditCanSave(session: RedirectEditSession | null): boolean {
	return session !== null && session.phase === "editing" && session.loaded?.access === "available" && session.draft !== null;
}

export type RedirectRowAction = "edit" | "review" | "core";

/** Guidance for a list row; the commands still decide what may be saved. */
export function redirectRowAction(rule: RedirectRule, session: RedirectEditSession | null): RedirectRowAction {
	if (session && session.id === rule.id && redirectEditNeedsReview(session)) return "review";
	return redirectRuleEditability(rule) === "editable" ? "edit" : "core";
}

export const REDIRECT_EDIT_FIELD_LABELS = Object.freeze({ source: "Source path", destination: "Destination path" });

export function firstInvalidRedirectEditField(errors: RedirectRuleEditFieldErrors): "source" | "destination" | null {
	return errors.source ? "source" : errors.destination ? "destination" : null;
}

/** Field errors render as plain text, so a stopped save is also announced. */
export function redirectEditAnnouncement(errors: RedirectRuleEditFieldErrors): string {
	const parts = (["source", "destination"] as const)
		.filter((field) => errors[field])
		.map((field) => `${REDIRECT_EDIT_FIELD_LABELS[field]}: ${errors[field]!.message}`);
	return parts.length ? `The change was not saved. ${parts.join(" ")}` : "";
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const CONFLICT_TITLES = {
	duplicate: "A redirect for this path already exists",
	"trailing-slash": "The other trailing-slash form already redirects",
	loop: "This change would loop",
	"check-incomplete": "This change could not be checked",
} as const;

const KEPT = "Your changes are kept.";

const UNCONFIRMED_TITLE = "Save not confirmed";
const TRANSPORT_UNCERTAIN =
	"This plugin did not get an answer from EmDash, so the change may or may not be saved. Check the saved redirect before changing it again.";
const RESPONSE_UNCERTAIN =
	"This plugin could not read EmDash's answer, so the change may or may not be saved. Check the saved redirect before changing it again.";
const CHECK_FAILED =
	"The check could not reach EmDash, so the change may still be saved. Check again, or review the redirect in EmDash Redirects.";
const CHECK_DENIED =
	"EmDash refused the check for this sign-in, so it is still unknown whether the change was saved. Sign in again, then check again, or review the redirect in EmDash Redirects.";
const CHECK_REJECTED =
	"EmDash refused the check request, so it is still unknown whether the change was saved. Review the redirect in EmDash Redirects.";
const CHECK_UNREADABLE =
	"This plugin could not read the check's answer, so the change may still be saved. Check again, or review the redirect in EmDash Redirects.";
const LOAD_UNREADABLE = "This plugin could not read this redirect from EmDash. Try again, or open it in EmDash Redirects.";
const LOAD_OUT_OF_STEP = "This page and this plugin are out of step. Reload the page, then open the redirect again.";
const LOAD_FAILED = "EmDash did not return this redirect. Try again, or open it in EmDash Redirects.";
const REVIEW_MESSAGE =
	"The settings EmDash has now are shown under Saved in EmDash. Your changes are kept in the form; review them and save again.";

function notice(tone: RedirectEditNotice["tone"], title: string, message: string, coreAdmin = false): RedirectEditNotice {
	return { tone, title, message, coreAdmin };
}

function errorDetail(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

// ---------------------------------------------------------------------------
// Transitions. Each returns the next session and, for a confirmed save, the
// configuration EmDash currently has.
// ---------------------------------------------------------------------------

interface Transition {
	session: RedirectEditSession;
	confirmed?: RedirectEditConfirmed;
	stopped?: boolean;
}

type Settled<T> = { value: T } | { error: unknown };

function settledFields(session: RedirectEditSession): RedirectEditSession {
	return { ...session, operation: null, notice: null, fieldErrors: {}, related: null, deferred: null };
}

function editable(session: RedirectEditSession, next: RedirectEditNotice | null, related: RedirectRule | null = null): Transition {
	return { session: { ...settledFields(session), phase: "editing", notice: next, related } };
}

function stopped(session: RedirectEditSession, errors: RedirectRuleEditFieldErrors): Transition {
	return { session: { ...settledFields(session), phase: "editing", fieldErrors: errors }, stopped: true };
}

function unresolved(session: RedirectEditSession, message: string): Transition {
	return {
		session: {
			...session,
			phase: "uncertain",
			notice: notice("warning", UNCONFIRMED_TITLE, message, true),
			fieldErrors: {},
			related: null,
		},
	};
}

function stale(
	session: RedirectEditSession,
	message: string,
	current: RedirectRule | null,
	title = "This redirect changed in EmDash",
): Transition {
	return {
		session: {
			...settledFields(session),
			phase: "stale",
			notice: notice("warning", title, message, true),
			related: current,
		},
	};
}

function blocked(session: RedirectEditSession, next: RedirectEditNotice, related: RedirectRule | null = null): Transition {
	return { session: { ...settledFields(session), phase: "blocked", notice: next, related } };
}

function missing(session: RedirectEditSession, message: string): Transition {
	return blocked(session, notice("error", "This redirect no longer exists", message, true));
}

function saved(
	session: RedirectEditSession,
	result: { rule: RedirectRule; revision: string; confirmedBy: "host" | "recovery" },
): Transition {
	const confirmed: RedirectEditConfirmed = { rule: result.rule, revision: result.revision, confirmedBy: result.confirmedBy };
	return { session: { ...settledFields(session), phase: "saved", confirmed }, confirmed };
}

/** A no-op leaves the configuration as it was; the returned version becomes the baseline. */
function unchanged(session: RedirectEditSession, result: { rule: RedirectRule; revision: string }): Transition {
	const access = session.loaded?.access ?? "available";
	return {
		session: {
			...settledFields(session),
			phase: "editing",
			loaded: { rule: result.rule, revision: result.revision, access },
			notice: notice("info", "No changes to save", "EmDash already has these settings."),
		},
	};
}

function afterUpdate(session: RedirectEditSession, settled: Settled<RedirectEditUpdateOutcome>): Transition {
	if ("error" in settled) {
		// Only refusals before the route handler prove nothing was written.
		const failure = classifyRedirectRequestError(settled.error);
		const detail = errorDetail(settled.error, "The request was refused.");
		if (failure === "denied") {
			return editable(session, notice("error", "You cannot change this redirect", `${detail} Changing redirects needs permission to manage redirects. ${KEPT}`));
		}
		if (failure === "rejected") return editable(session, notice("error", "The change was not saved", `${detail} ${KEPT}`));
		return unresolved(session, TRANSPORT_UNCERTAIN);
	}
	const result = settled.value;
	switch (result.status) {
		case "updated":
			return saved(session, result);
		case "unchanged":
			return unchanged(session, result);
		case "invalid":
			return result.reason === "fields"
				? stopped(session, result.errors)
				: editable(session, notice("error", "The change was not saved", result.message));
		case "conflict":
			return editable(
				session,
				notice("error", CONFLICT_TITLES[result.reason], result.message, result.reason === "check-incomplete" || result.existing !== null),
				result.existing,
			);
		case "stale":
			return stale(session, result.message, result.current);
		case "missing":
			return missing(session, result.message);
		case "unsupported":
			return blocked(session, notice("error", "Edit this redirect in EmDash", result.message, true), result.rule);
		case "refused":
			// EmDash refused the opened revision itself; the record need not have changed.
			return result.reason === "precondition"
				? stale(session, result.message, null, "EmDash did not accept this version")
				: editable(session, notice("error", "EmDash refused the change", result.message));
		case "busy":
		case "not-saved":
			return editable(session, notice("warning", "The change was not saved", result.message));
		case "uncertain":
			return unresolved(session, result.message);
		case "unavailable":
			if (result.reason === "read-only" && session.loaded) {
				const next = editable(session, notice("error", "Redirects are read-only here", result.message, true));
				return { session: { ...next.session, loaded: { ...session.loaded, access: "read-only" } } };
			}
			return blocked(session, notice("error", "Redirects are unavailable", result.message, true));
		case "unusable":
			// The request was refused before it was sent; anything else may follow a write.
			return result.reason === "request"
				? editable(session, notice("error", "The change was not sent", "This plugin could not prepare this change, so nothing was sent. Reload the redirect and try again."))
				: unresolved(session, RESPONSE_UNCERTAIN);
	}
}

/**
 * A recovery read cannot know whether the original request finished, so
 * only an observation that settles the outcome unlocks the form.
 */
function afterRecovery(session: RedirectEditSession, settled: Settled<RedirectEditRecoveryOutcome>): Transition {
	if ("error" in settled) {
		// A refused check reads nothing, so the save stays as unknown as before.
		const failure = classifyRedirectRequestError(settled.error);
		return unresolved(session, failure === "denied" ? CHECK_DENIED : failure === "rejected" ? CHECK_REJECTED : CHECK_FAILED);
	}
	const result = settled.value;
	switch (result.status) {
		case "updated":
			return saved(session, result);
		case "unchanged":
			return unchanged(session, result);
		case "stale":
			return stale(session, result.message, result.current);
		case "missing":
			return missing(session, result.message);
		case "uncertain":
			return unresolved(session, result.message);
		case "invalid":
			// The shared planner refuses these fields for this baseline, so the
			// update stopped before its write. An unreadable snapshot proves nothing.
			return result.reason === "fields" ? stopped(session, result.errors) : unresolved(session, CHECK_UNREADABLE);
		case "unavailable":
			return unresolved(session, result.message);
		case "unusable":
			return unresolved(session, CHECK_UNREADABLE);
	}
}

type LoadMode = "open" | "reload";

function afterLoad(session: RedirectEditSession, settled: Settled<RedirectEditLoadOutcome>, mode: LoadMode): Transition {
	const failed = (message: string): Transition => mode === "reload"
		? { session: { ...session, phase: "stale", notice: notice("error", "The redirect could not be reloaded", message, true) } }
		: { session: { ...settledFields(session), phase: "load-failed", notice: notice("error", "The redirect could not be loaded", message, true) } };
	if ("error" in settled) {
		if (classifyRedirectRequestError(settled.error) === "denied") {
			return blocked(session, notice("error", "You cannot view this redirect", "Viewing redirects needs the redirects:read permission, which EmDash gives editors and administrators.", true));
		}
		return failed(LOAD_FAILED);
	}
	const result = settled.value;
	switch (result.status) {
		case "loaded": {
			const { rule, revision, update: access } = result;
			const draft: RedirectRuleEditDraft = mode === "reload" && session.draft
				? session.draft
				: { source: rule.source, destination: rule.destination, type: rule.type === 302 ? 302 : 301, enabled: rule.enabled };
			return {
				session: {
					...settledFields(session),
					phase: "editing",
					loaded: { rule, revision, access },
					draft,
					notice: mode === "reload" ? notice("info", "Review the current settings", REVIEW_MESSAGE) : null,
				},
			};
		}
		case "unsupported":
			return blocked(session, notice("error", "Edit this redirect in EmDash", result.message, true), result.rule);
		case "missing":
			return missing(session, result.message);
		case "invalid":
			return blocked(session, notice("error", "This redirect cannot be opened", result.message, true));
		case "unavailable":
			return blocked(session, notice("error", "Redirects are unavailable", result.message, true));
		case "failed":
			return failed(result.message);
		case "unusable":
			return failed(result.reason === "version" ? LOAD_OUT_OF_STEP : LOAD_UNREADABLE);
	}
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// Settles at the deadline even when the request ignores its abort signal. The
// abort only stops the browser waiting; it does not prove nothing was written.
function withDeadline<T>(request: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
	const controller = new AbortController();
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			const reason = new DOMException("The operation timed out.", "TimeoutError");
			controller.abort(reason);
			reject(reason);
		}, ms);
		let started: Promise<T>;
		try {
			started = request(controller.signal);
		} catch (error) {
			started = Promise.reject(error);
		}
		started.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

async function settle<T>(request: (signal: AbortSignal) => Promise<T>, ms: number): Promise<Settled<T>> {
	try {
		return { value: await withDeadline(request, ms) };
	} catch (error) {
		return { error };
	}
}

/** Registers one request for the session and returns its ID. */
function claim(
	store: RedirectEditStore,
	token: number,
	change: (session: RedirectEditSession) => RedirectEditSession,
): number | null {
	const current = store.get();
	if (!current.session || current.session.token !== token) return null;
	const request = current.counter + 1;
	store.update(() => ({ ...current, counter: request, session: { ...change(current.session!), pending: request } }));
	return request;
}

/**
 * Applies a response only to the request the session still waits for. A
 * confirmed save is recorded once and refreshes the list once, whether or
 * not the list or dialog is still mounted.
 */
function apply(
	store: RedirectEditStore,
	actions: RedirectEditActions,
	token: number,
	request: number,
	transition: (session: RedirectEditSession) => Transition,
): void {
	const current = store.get();
	const session = current.session;
	if (!session || session.token !== token || session.pending !== request) return;
	const next = transition(session);
	const sequence = current.counter + 1;
	const { confirmed } = next;
	store.update(() => ({
		...current,
		session: { ...next.session, pending: null },
		attempt: next.stopped ? current.attempt + 1 : current.attempt,
		counter: confirmed ? sequence : current.counter,
		completion: confirmed
			? { sequence, id: session.id, rule: confirmed.rule, confirmedBy: confirmed.confirmedBy }
			: current.completion,
	}));
	if (confirmed) actions.refresh(current.filters);
}

async function runLoad(
	store: RedirectEditStore,
	actions: RedirectEditActions,
	token: number,
	mode: LoadMode,
	deadlines: RedirectEditDeadlines,
): Promise<void> {
	const id = store.get().session?.id;
	if (id === undefined) return;
	const request = claim(store, token, (session) => ({
		...session,
		phase: mode === "reload" ? "reloading" : "loading",
		notice: null,
		fieldErrors: {},
		deferred: null,
	}));
	if (request === null) return;
	const settled = await settle((signal) => actions.load(id, signal), deadlines.loadMs);
	apply(store, actions, token, request, (session) => afterLoad(session, settled, mode));
}

/**
 * Opens one redirect by its ID with exactly one read; list-row values are
 * never saved. An unresolved save, or a result it settled into while hidden,
 * is shown again as it is instead: no read replaces it, for any redirect.
 */
export async function openRedirectEdit(
	store: RedirectEditStore,
	actions: RedirectEditActions,
	id: string,
	deadlines: RedirectEditDeadlines = REDIRECT_EDIT_DEADLINES,
): Promise<"opened" | "unresolved" | "retained"> {
	const current = store.get().session;
	if (current && redirectEditNeedsReview(current)) {
		const kept = redirectEditUnresolved(current) ? "unresolved" : "retained";
		store.update((snapshot) => snapshot.session
			? { ...snapshot, session: { ...snapshot.session, visibility: "shown", deferred: snapshot.session.id === id ? null : id } }
			: snapshot);
		return kept;
	}
	const token = store.get().counter + 1;
	store.update((snapshot) => ({
		...snapshot,
		counter: token,
		session: {
			token,
			id,
			phase: "loading",
			loaded: null,
			draft: null,
			operation: null,
			pending: null,
			notice: null,
			fieldErrors: {},
			related: null,
			confirmed: null,
			deferred: null,
			visibility: "shown",
		},
	}));
	await runLoad(store, actions, token, "open", deadlines);
	return "opened";
}

/** Reads the same ID again after a failed load. */
export async function retryRedirectEditLoad(
	store: RedirectEditStore,
	actions: RedirectEditActions,
	deadlines: RedirectEditDeadlines = REDIRECT_EDIT_DEADLINES,
): Promise<void> {
	const session = store.get().session;
	if (!session || session.phase !== "load-failed") return;
	await runLoad(store, actions, session.token, "open", deadlines);
}

/**
 * The explicit exact-ID reload after a stale result. The draft is kept for
 * review against the current version; nothing is saved automatically.
 */
export async function reloadRedirectEdit(
	store: RedirectEditStore,
	actions: RedirectEditActions,
	deadlines: RedirectEditDeadlines = REDIRECT_EDIT_DEADLINES,
): Promise<void> {
	const session = store.get().session;
	if (!session || session.phase !== "stale") return;
	await runLoad(store, actions, session.token, "reload", deadlines);
}

export function updateRedirectEditDraft(store: RedirectEditStore, change: Partial<RedirectRuleEditDraft>): void {
	store.update((current) => {
		const session = current.session;
		if (!session || !redirectEditCanSave(session) || !session.draft) return current;
		const fieldErrors = { ...session.fieldErrors };
		if ("source" in change) delete fieldErrors.source;
		if ("destination" in change) delete fieldErrors.destination;
		return {
			...current,
			session: { ...session, draft: { ...session.draft, ...change }, fieldErrors, notice: null, related: null },
		};
	});
}

function lengthErrors(draft: RedirectRuleEditDraft): RedirectRuleEditFieldErrors | null {
	const errors: RedirectRuleEditFieldErrors = {};
	for (const field of ["source", "destination"] as const) {
		if (draft[field].length > REDIRECT_EDIT_INPUT_MAX_LENGTH) {
			errors[field] = {
				code: "too-long",
				message: `Use at most ${REDIRECT_EDIT_INPUT_MAX_LENGTH.toLocaleString("en-US")} characters. Nothing was sent.`,
			};
		}
	}
	return errors.source || errors.destination ? errors : null;
}

/**
 * Captures the ID, the loaded revision and configuration and the form fields
 * before the request. Repeated calls, closing and late responses cannot start
 * another update while this one is unresolved.
 */
export async function saveRedirectEdit(
	store: RedirectEditStore,
	actions: RedirectEditActions,
	deadlines: RedirectEditDeadlines = REDIRECT_EDIT_DEADLINES,
): Promise<void> {
	const session = store.get().session;
	if (!session || !redirectEditCanSave(session) || !session.loaded || !session.draft) return;
	const token = session.token;
	const tooLong = lengthErrors(session.draft);
	if (tooLong) {
		store.update((current) => current.session?.token === token
			? { ...current, attempt: current.attempt + 1, session: stopped(current.session, tooLong).session }
			: current);
		return;
	}
	const submission = prepareRedirectEditSubmission(session.loaded.rule, session.loaded.revision, session.draft);
	if (!submission) {
		store.update((current) => current.session?.token === token
			? { ...current, session: editable(current.session, notice("error", "The change was not sent", "This plugin could not prepare this change, so nothing was sent. Reload the redirect and try again.")).session }
			: current);
		return;
	}
	const request = claim(store, token, (current) => ({
		...settledFields(current),
		phase: "saving",
		operation: submission,
	}));
	if (request === null) return;
	const settled = await settle((signal) => actions.update(submission, signal), deadlines.saveMs);
	apply(store, actions, token, request, (current) => afterUpdate(current, settled));
}

/** One read-only recovery of the same snapshot; it never writes or retries the save. */
export async function checkRedirectEdit(
	store: RedirectEditStore,
	actions: RedirectEditActions,
	deadlines: RedirectEditDeadlines = REDIRECT_EDIT_DEADLINES,
): Promise<void> {
	const session = store.get().session;
	if (!session || session.phase !== "uncertain" || !session.operation) return;
	const { token, operation } = session;
	const request = claim(store, token, (current) => ({ ...current, phase: "checking", deferred: null }));
	if (request === null) return;
	const settled = await settle((signal) => actions.reconcile(operation, signal), deadlines.checkMs);
	apply(store, actions, token, request, (current) => afterRecovery(current, settled));
}

function setVisibility(store: RedirectEditStore, visibility: RedirectEditSession["visibility"]): void {
	store.update((current) => current.session && (current.session.visibility !== visibility || current.session.deferred !== null)
		? { ...current, session: { ...current.session, visibility, deferred: null } }
		: current);
}

/**
 * The user closed the dialog. Decided at that moment, so an answer that
 * arrives while the dialog is still closing is kept for review rather than
 * ended with it.
 */
export function hideRedirectEdit(store: RedirectEditStore): "hidden" | "dismissed" | "none" {
	const session = store.get().session;
	if (!session) return "none";
	const visibility = redirectEditNeedsReview(session) ? "hidden" : "dismissed";
	setVisibility(store, visibility);
	return visibility;
}

/** The dialog finished closing: a dismissed session ends; a hidden one stays. */
export function releaseRedirectEdit(store: RedirectEditStore): void {
	store.update((current) => current.session?.visibility === "dismissed" ? { ...current, session: null } : current);
}

/**
 * The list view unmounted. An unresolved save stays locked until a check
 * settles it, and an unseen result stays until it is reviewed; anything
 * else ends.
 */
export function closeRedirectEdit(store: RedirectEditStore): "closed" | "kept" {
	const session = store.get().session;
	if (!session) return "closed";
	if (redirectEditNeedsReview(session)) {
		setVisibility(store, "hidden");
		return "kept";
	}
	store.update((current) => ({ ...current, session: null }));
	return "closed";
}

export function dismissRedirectEditCompletion(store: RedirectEditStore): void {
	store.update((current) => current.completion ? { ...current, completion: null } : current);
}

/** The list keeps its applied filters here, so a later save refreshes the same view. */
export function rememberRedirectEditFilters(store: RedirectEditStore, filters: RedirectListFilters): void {
	store.update((current) => current.filters === filters ? current : { ...current, filters });
}
