// View state for the Redirect rules tab. Validation and outcomes come from the
// shared redirect commands; this module sequences pages and chooses wording.
import {
	REDIRECT_LIST_PAGE_SIZE,
	validateRedirectRuleDraft,
	type RedirectRule,
	type RedirectRuleCreateResult,
	type RedirectRuleFieldErrors,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import type { SeoAdminRedirectRuleInput, SeoAdminRedirectRuleRequest } from "./api.ts";

export type RedirectStatusFilter = "all" | "enabled" | "disabled";
export type RedirectOriginFilter = "all" | "manual" | "automatic";

export interface RedirectListFilters {
	search: string;
	status: RedirectStatusFilter;
	origin: RedirectOriginFilter;
	/** Exact group name; set from a rule's group. */
	group: string | null;
}

export interface RedirectListPaging {
	filters: RedirectListFilters;
	/** Cursor that opens each visited page; the first page has none. */
	cursors: Array<string | null>;
	page: number;
}

export const INITIAL_REDIRECT_FILTERS: RedirectListFilters = Object.freeze({
	search: "",
	status: "all",
	origin: "all",
	group: null,
});

export function initialRedirectPaging(filters: RedirectListFilters = INITIAL_REDIRECT_FILTERS): RedirectListPaging {
	return { filters, cursors: [null], page: 0 };
}

/** A cursor only continues the filters it was issued for. */
export function withRedirectFilters(paging: RedirectListPaging, filters: Partial<RedirectListFilters>): RedirectListPaging {
	return initialRedirectPaging({ ...paging.filters, ...filters });
}

export function nextRedirectPage(paging: RedirectListPaging, cursor: string): RedirectListPaging {
	return { ...paging, cursors: [...paging.cursors.slice(0, paging.page + 1), cursor], page: paging.page + 1 };
}

export function previousRedirectPage(paging: RedirectListPaging): RedirectListPaging {
	return { ...paging, page: Math.max(0, paging.page - 1) };
}

export function redirectListRequest(
	paging: RedirectListPaging,
	limit: number = REDIRECT_LIST_PAGE_SIZE,
): SeoAdminRedirectRuleRequest {
	const { filters } = paging;
	return {
		search: filters.search.trim() || null,
		enabled: filters.status === "all" ? null : filters.status === "enabled",
		auto: filters.origin === "all" ? null : filters.origin === "automatic",
		group: filters.group,
		limit,
		cursor: paging.cursors[paging.page] ?? null,
	};
}

export function redirectFiltersActive(filters: RedirectListFilters): boolean {
	return Boolean(filters.search.trim()) || filters.status !== "all" || filters.origin !== "all" || filters.group !== null;
}

/**
 * An empty later page says nothing about the whole list: rules can be deleted
 * in EmDash after the earlier pages were read.
 */
export function redirectEmptyPage(paging: RedirectListPaging): "no-rules" | "no-matches" | "page-emptied" {
	if (paging.page > 0) return "page-emptied";
	return redirectFiltersActive(paging.filters) ? "no-matches" : "no-rules";
}

/**
 * `denied` and `rejected` are refused before the route handler runs, so
 * nothing was written. Anything else may have followed a committed write.
 */
export type RedirectRequestFailure = "denied" | "rejected" | "unknown";

export function classifyRedirectRequestError(error: unknown): RedirectRequestFailure {
	const status = typeof error === "object" && error !== null && typeof (error as { status?: unknown }).status === "number"
		? (error as { status: number }).status
		: null;
	if (status === 401 || status === 403) return "denied";
	if (status !== null && status >= 400 && status < 500 && status !== 408) return "rejected";
	return "unknown";
}

export type RedirectFormPhase = "editing" | "saving" | "checking" | "uncertain" | "saved";

export interface RedirectFormNotice {
	tone: "success" | "warning" | "error";
	title: string;
	message: string;
}

export interface RedirectFormState {
	phase: RedirectFormPhase;
	notice: RedirectFormNotice | null;
	fieldErrors: RedirectRuleFieldErrors;
	saved: RedirectRule | null;
	existing: RedirectRule | null;
}

export const INITIAL_REDIRECT_FORM: RedirectFormState = Object.freeze({
	phase: "editing",
	notice: null,
	fieldErrors: {},
	saved: null,
	existing: null,
});

function editing(notice: RedirectFormNotice, existing: RedirectRule | null = null): RedirectFormState {
	return { phase: "editing", notice, fieldErrors: {}, saved: null, existing };
}

const CONFLICT_TITLES = {
	duplicate: "A redirect for this path already exists",
	"trailing-slash": "The other trailing-slash form already redirects",
	loop: "This redirect would loop",
	"check-incomplete": "This redirect could not be checked",
} as const;

export function redirectFormAfterResult(result: RedirectRuleCreateResult): RedirectFormState {
	switch (result.status) {
		case "created":
			return {
				phase: "saved",
				notice: {
					tone: "success",
					title: "Redirect saved in EmDash",
					message: result.confirmedBy === "lookup"
						? "The response was interrupted, but EmDash has this rule saved. Nothing was saved twice."
						: "EmDash saved this rule.",
				},
				fieldErrors: {},
				saved: result.rule,
				existing: null,
			};
		case "invalid":
			return { ...INITIAL_REDIRECT_FORM, fieldErrors: result.errors };
		case "conflict":
			return editing({ tone: "error", title: CONFLICT_TITLES[result.reason], message: result.message }, result.existing);
		case "failed":
			return editing({
				tone: result.retryable ? "warning" : "error",
				title: result.reason === "host-rejected" ? "EmDash rejected the redirect" : "The redirect was not saved",
				message: result.message,
			});
		case "uncertain":
			return {
				phase: "uncertain",
				notice: { tone: "warning", title: "Save not confirmed", message: result.message },
				fieldErrors: {},
				saved: null,
				existing: null,
			};
		case "unavailable":
			return editing({ tone: "error", title: "Redirects are unavailable", message: result.message });
	}
}

/** Returns "check" when the outcome is unknown and must be reconciled first. */
export function redirectFormAfterCreateError(error: unknown): RedirectFormState | "check" {
	const failure = classifyRedirectRequestError(error);
	if (failure === "unknown") return "check";
	const detail = error instanceof Error && error.message ? error.message : "The request was refused.";
	return editing(failure === "denied"
		? { tone: "error", title: "You cannot create redirects", message: `${detail} Creating redirects needs permission to manage redirects.` }
		: { tone: "error", title: "The redirect was not saved", message: detail });
}

export function redirectFormAfterCheckError(): RedirectFormState {
	return {
		phase: "uncertain",
		notice: {
			tone: "warning",
			title: "Save not confirmed",
			message: "The redirect may have been saved, and the check could not reach EmDash. Check again, or search for the source path in EmDash Redirects before saving again.",
		},
		fieldErrors: {},
		saved: null,
		existing: null,
	};
}

/** Fields stay fixed while a save is running or its outcome is unknown. */
export function redirectFormLocked(state: RedirectFormState): boolean {
	return state.phase !== "editing";
}

export const REDIRECT_FIELD_LABELS = Object.freeze({
	source: "Source path",
	destination: "Destination path",
	type: "Status code",
});

export function firstInvalidRedirectField(errors: RedirectRuleFieldErrors): "source" | "destination" | "type" | null {
	return errors.source ? "source" : errors.destination ? "destination" : errors.type ? "type" : null;
}

/** Field errors render as plain text, so a failed save is also announced. */
export function redirectFieldAnnouncement(errors: RedirectRuleFieldErrors): string {
	const parts = (["source", "destination", "type"] as const)
		.filter((field) => errors[field])
		.map((field) => `${REDIRECT_FIELD_LABELS[field]}: ${errors[field]!.message}`);
	return parts.length ? `The redirect was not saved. ${parts.join(" ")}` : "";
}

export interface RedirectFormSnapshot {
	draft: SeoAdminRedirectRuleInput;
	touched: { source: boolean; destination: boolean };
	form: RedirectFormState;
	/** Counts saves stopped by field errors; each one moves focus and is announced. */
	attempt: number;
}

export const INITIAL_REDIRECT_SNAPSHOT: RedirectFormSnapshot = Object.freeze<RedirectFormSnapshot>({
	draft: { source: "", destination: "", type: 301 },
	touched: { source: false, destination: false },
	form: INITIAL_REDIRECT_FORM,
	attempt: 0,
});

export interface RedirectFormStore {
	get(): RedirectFormSnapshot;
	update(change: (current: RedirectFormSnapshot) => RedirectFormSnapshot): void;
	subscribe(listener: () => void): () => void;
}

/**
 * Holds the form outside the components, so closing the dialog or leaving the
 * tab cannot drop an unresolved save or unlock its fields.
 */
export function createRedirectFormStore(initial: RedirectFormSnapshot = INITIAL_REDIRECT_SNAPSHOT): RedirectFormStore {
	let snapshot = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => snapshot,
		update(change) {
			snapshot = change(snapshot);
			for (const listener of [...listeners]) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/**
 * Starts a new form. The stopped-save counter only grows, so a reset is never
 * mistaken for another failed save.
 */
export function resetRedirectForm(store: RedirectFormStore): void {
	store.update((current) => ({ ...INITIAL_REDIRECT_SNAPSHOT, attempt: current.attempt }));
}

export function redirectFormUnresolved(form: RedirectFormState): boolean {
	return form.phase === "saving" || form.phase === "checking" || form.phase === "uncertain";
}

/**
 * Starts a new form for a missing path. An unresolved save keeps its draft,
 * because replacing it would hide what EmDash may already have stored.
 */
export function prefillRedirectForm(store: RedirectFormStore, source: string): "prefilled" | "unresolved" {
	if (redirectFormUnresolved(store.get().form)) return "unresolved";
	store.update((current) => ({
		...INITIAL_REDIRECT_SNAPSHOT,
		draft: { ...INITIAL_REDIRECT_SNAPSHOT.draft, source },
		touched: { source: true, destination: false },
		attempt: current.attempt,
	}));
	return "prefilled";
}

export interface RedirectFormActions {
	create(input: SeoAdminRedirectRuleInput, signal: AbortSignal): Promise<RedirectRuleCreateResult>;
	reconcile(input: SeoAdminRedirectRuleInput, signal: AbortSignal): Promise<RedirectRuleCreateResult>;
	onSaved?(rule: RedirectRule): void;
}

export const REDIRECT_DEADLINES = Object.freeze({ createMs: 20_000, checkMs: 15_000 });

// Settles at the deadline even when the request ignores its abort signal.
function withDeadline<T>(request: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
	const controller = new AbortController();
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			const reason = new DOMException("The operation timed out.", "TimeoutError");
			controller.abort(reason);
			reject(reason);
		}, ms);
		request(controller.signal).then(
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

function settleForm(store: RedirectFormStore, next: RedirectFormState, actions: RedirectFormActions): void {
	store.update((current) => ({
		...current,
		form: next,
		attempt: firstInvalidRedirectField(next.fieldErrors) ? current.attempt + 1 : current.attempt,
	}));
	if (next.phase === "saved" && next.saved) actions.onSaved?.(next.saved);
}

/** Reads only; a lost create may still be running, so absence stays uncertain. */
export async function checkRedirectRule(
	store: RedirectFormStore,
	actions: RedirectFormActions,
	deadlines: { checkMs: number } = REDIRECT_DEADLINES,
): Promise<void> {
	const { draft, form } = store.get();
	if (form.phase !== "uncertain") return;
	const validation = validateRedirectRuleDraft(draft);
	const input = validation.valid ? validation.rule : draft;
	store.update((current) => ({ ...current, form: { ...current.form, phase: "checking" } }));
	let next: RedirectFormState;
	try {
		next = redirectFormAfterResult(await withDeadline((signal) => actions.reconcile(input, signal), deadlines.checkMs));
	} catch {
		next = redirectFormAfterCheckError();
	}
	settleForm(store, next, actions);
}

export async function saveRedirectRule(
	store: RedirectFormStore,
	actions: RedirectFormActions,
	deadlines: { createMs: number; checkMs: number } = REDIRECT_DEADLINES,
): Promise<void> {
	const { draft, form } = store.get();
	if (form.phase !== "editing") return;
	const validation = validateRedirectRuleDraft(draft);
	if (!validation.valid) {
		store.update((current) => ({
			...current,
			touched: { source: true, destination: true },
			form: { ...INITIAL_REDIRECT_FORM, fieldErrors: validation.errors },
			attempt: current.attempt + 1,
		}));
		return;
	}
	store.update((current) => ({ ...current, form: { ...INITIAL_REDIRECT_FORM, phase: "saving" } }));
	let next: RedirectFormState | "check";
	try {
		next = redirectFormAfterResult(await withDeadline((signal) => actions.create(validation.rule, signal), deadlines.createMs));
	} catch (error) {
		next = redirectFormAfterCreateError(error);
	}
	if (next !== "check") {
		settleForm(store, next, actions);
		return;
	}
	store.update((current) => ({ ...current, form: { ...current.form, phase: "uncertain" } }));
	await checkRedirectRule(store, actions, deadlines);
}
