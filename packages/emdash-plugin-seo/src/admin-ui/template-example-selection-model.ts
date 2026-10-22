// Which published entry the Templates view previews against. An explicit
// reference controls the example until the editor chooses another entry or
// content type; it is resolved by one exact read or from a listed or
// remembered option for that same entry, never by substituting another.

import {
	isSeoContentCollectionKey,
	type SeoAdminTemplateExample,
	type SeoAdminTemplateExampleResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

export interface TemplateExampleTarget {
	entryId: string;
	locale: string;
	title: string;
	slug: string | null;
}

export interface TemplateExampleRequest {
	ref: string;
	/** Both null when the reference does not name one content type and one entry. */
	collection: string | null;
	entryId: string | null;
}

/** Accepts only `collection:entryId` within the limits the exact read accepts. */
export function parseTemplateExampleRef(ref: string): TemplateExampleRequest {
	const separator = ref.indexOf(":");
	const collection = separator > 0 ? ref.slice(0, separator) : "";
	const entryId = separator > 0 ? ref.slice(separator + 1) : "";
	return isSeoContentCollectionKey(collection) && entryId.length > 0 && entryId.length <= 128
		? { ref, collection, entryId }
		: { ref, collection: null, entryId: null };
}

/** The locale rule the preview applies to its input. */
export function templateExampleLocaleUsable(locale: unknown): locale is string {
	return typeof locale === "string" && locale.length > 0 && locale.length <= 35;
}

export function templateExampleTarget(entry: TemplateExampleTarget): TemplateExampleTarget {
	return { entryId: entry.entryId, locale: entry.locale, title: entry.title, slug: entry.slug };
}

export function sameTemplateExampleTarget(left: TemplateExampleTarget, right: TemplateExampleTarget): boolean {
	return left.entryId === right.entryId && left.locale === right.locale && left.title === right.title && left.slug === right.slug;
}

/** The exact read for the current request, as its query cache holds it. */
export type TemplateExampleLookup =
	| { status: "idle" }
	| { status: "pending" }
	| { status: "answered"; result: SeoAdminTemplateExampleResult }
	| { status: "failed" };

export const IDLE_TEMPLATE_EXAMPLE_LOOKUP: TemplateExampleLookup = Object.freeze({ status: "idle" });

/** The newest outcome wins: a failed Retry is shown instead of an earlier answer. */
export function templateExampleLookup(query: {
	fetching: boolean;
	status: "pending" | "error" | "success";
	data: SeoAdminTemplateExampleResult | undefined;
}): TemplateExampleLookup {
	if (query.fetching) return { status: "pending" };
	if (query.status === "error") return { status: "failed" };
	if (query.status === "success" && query.data) return { status: "answered", result: query.data };
	return IDLE_TEMPLATE_EXAMPLE_LOOKUP;
}

/**
 * Query behavior of the exact read. It starts on its own only while wanted and
 * while its key holds no answer and no failure: an entry without data counts as
 * stale whatever its stale time, so a cached failure would otherwise be read
 * again when the key returns. A canceled read is reverted to no outcome and may
 * start again; everything else waits for an explicit refetch (Retry).
 */
export function templateExampleQueryPolicy(wanted: boolean) {
	return {
		enabled: (query: { state: { status: "pending" | "error" | "success"; data: unknown } }) =>
			wanted && query.state.data === undefined && query.state.status !== "error",
		retry: false,
		retryOnMount: false,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: Infinity,
		gcTime: Infinity,
	} as const;
}

export type TemplateExampleSelection =
	/** No explicit reference and nothing remembered for the type yet. */
	| { kind: "none" }
	| { kind: "selected"; example: TemplateExampleTarget; requested: boolean }
	| { kind: "invalid"; ref: string }
	| { kind: "type-unavailable"; collection: string; entryId: string | null }
	| { kind: "loading"; collection: string; entryId: string }
	| { kind: "refused"; collection: string; entryId: string; message: string }
	| { kind: "failed"; collection: string; entryId: string };

export interface TemplateExampleSelectionInput {
	request: TemplateExampleRequest | null;
	/** The content type the form shows. */
	active: string | null;
	/** Whether the newest readable configuration lists the active type as a target. */
	activeAvailable: boolean;
	remembered: TemplateExampleTarget | null;
	/** The active type's current published page, once it has loaded. */
	listed: readonly SeoAdminTemplateExample[] | null;
	lookup: TemplateExampleLookup;
}

export interface TemplateExampleResolution {
	selection: TemplateExampleSelection;
	/** Whether the one exact read for the request is needed. */
	lookup: boolean;
	/** The listed entry to remember when nothing was requested or remembered. */
	first: TemplateExampleTarget | null;
}

/**
 * A request is shown only as its own entry: an exact answer bound to it (a
 * refusal included, which outranks a listed or remembered option until
 * Retry), else a listed or remembered option with its ID and a usable locale,
 * else one exact read. Only without a request does the first listed entry apply.
 */
export function resolveTemplateExampleSelection(input: TemplateExampleSelectionInput): TemplateExampleResolution {
	const { request, active, activeAvailable, remembered, listed, lookup } = input;
	const settled = (selection: TemplateExampleSelection): TemplateExampleResolution => ({ selection, lookup: false, first: null });
	if (request && request.collection === null) return settled({ kind: "invalid", ref: request.ref });
	if (!active) return settled({ kind: "none" });
	const requested = request?.collection === active ? request.entryId : null;
	if (!activeAvailable) return settled({ kind: "type-unavailable", collection: active, entryId: requested });
	if (requested !== null) {
		const entryId = requested;
		if (lookup.status === "pending") return settled({ kind: "loading", collection: active, entryId });
		if (lookup.status === "failed") return settled({ kind: "failed", collection: active, entryId });
		if (lookup.status === "answered") {
			const result = lookup.result;
			// Malformed input has no bound identity; every other answer must name this request.
			if (!result.success && result.error === "invalid_input") return settled({ kind: "refused", collection: active, entryId, message: result.message });
			if (result.collection !== active || result.entryId !== entryId) return settled({ kind: "failed", collection: active, entryId });
			if (!result.success) return settled({ kind: "refused", collection: active, entryId, message: result.message });
			if (result.example.entryId !== entryId || !templateExampleLocaleUsable(result.example.locale)) {
				return settled({ kind: "failed", collection: active, entryId });
			}
			return settled({ kind: "selected", requested: true, example: templateExampleTarget(result.example) });
		}
		const usable = (entry: TemplateExampleTarget | undefined | null) =>
			entry && entry.entryId === entryId && templateExampleLocaleUsable(entry.locale) ? entry : undefined;
		const known = usable(remembered) ?? usable(listed?.find((entry) => entry.entryId === entryId));
		if (known) return settled({ kind: "selected", requested: true, example: templateExampleTarget(known) });
		return { selection: { kind: "loading", collection: active, entryId }, lookup: true, first: null };
	}
	if (remembered) return settled({ kind: "selected", requested: false, example: remembered });
	const first = listed?.[0];
	return { selection: { kind: "none" }, lookup: false, first: first ? templateExampleTarget(first) : null };
}
