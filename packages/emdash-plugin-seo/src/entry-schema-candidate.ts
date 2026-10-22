// Bounds for previewing an unsaved entry schema. The preview runs the shared
// entry resolver on content and stored records the host has already loaded;
// everything the preview itself builds from them is bounded here before it
// is built: the content handed to the metadata and preset helpers, the
// unresolved stored JSON, every custom expansion together, the candidate's
// resolved graph and the complete wire response. Exceeding a bound refuses
// the preview; nothing is truncated. Public page output never uses these
// bounds. No React, DOM, Node or storage import.

import {
	TemplateExpansionLimitError,
	applyVarsDeepBounded,
	jsonUtf8LengthWithin,
	templateVariables,
	utf8ByteLength,
	type TemplateExpansionBudget,
} from "./lib.ts";

/** Resolved candidate graph, as serialized JSON. */
export const ENTRY_SCHEMA_CANDIDATE_MAX_BYTES = 131_072;
/** The complete HTTP body, including EmDash's `{"success":true,"data":...}` envelope. */
export const ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES = 524_288;
/** Request body limit the route declares to the host. */
export const ENTRY_SCHEMA_PREVIEW_REQUEST_MAX_BYTES = 1_048_576;
/** UTF-8 bytes of unresolved JSON across every applicable stored record. */
export const ENTRY_SCHEMA_PREVIEW_UNRESOLVED_MAX_BYTES = 1_048_576;
/** Visited values and variable tokens across every custom expansion. */
export const ENTRY_SCHEMA_PREVIEW_EXPANSION_WORK = 250_000;

/**
 * Content handed to the metadata and preset helpers. Body flattening copies a
 * string once per nesting level, and a metadata template of at most 1,000
 * characters repeats a variable at most 125 times, so these caps keep those
 * intermediates to a few megabytes.
 */
export const ENTRY_SCHEMA_PREVIEW_CONTENT_LIMITS = Object.freeze({
	depth: 16,
	values: 50_000,
	stringBytes: 32_768,
	totalStringBytes: 1_048_576,
});

export type EntrySchemaPreviewLimitFailure =
	| { error: "content_too_large"; message: string }
	| { error: "expansion_too_large"; message: string }
	| { error: "response_too_large"; message: string };

const bytes = (value: number) => value.toLocaleString("en-US");

/**
 * Walks a loaded content item without copying it. Returns a refusal message
 * for content beyond the preview limits, or null.
 */
export function entrySchemaPreviewContentProblem(
	item: unknown,
	limits: Readonly<Record<keyof typeof ENTRY_SCHEMA_PREVIEW_CONTENT_LIMITS, number>> = ENTRY_SCHEMA_PREVIEW_CONTENT_LIMITS,
): string | null {
	let values = 0;
	let total = 0;
	let problem: string | null = null;
	const visit = (value: unknown, depth: number): void => {
		if (problem) return;
		values += 1;
		if (values > limits.values) {
			problem = `This entry has more than ${bytes(limits.values)} stored values, more than the schema preview reads.`;
			return;
		}
		if (depth > limits.depth) {
			problem = `This entry nests content more than ${limits.depth} levels deep, more than the schema preview reads.`;
			return;
		}
		if (typeof value === "string") {
			const size = utf8ByteLength(value, 0, value.length, limits.stringBytes);
			total += size;
			if (size > limits.stringBytes) {
				problem = `This entry has a text value over ${bytes(limits.stringBytes)} bytes, more than the schema preview reads.`;
			} else if (total > limits.totalStringBytes) {
				problem = `This entry has more than ${bytes(limits.totalStringBytes)} bytes of text, more than the schema preview reads.`;
			}
			return;
		}
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length && !problem; index += 1) visit(value[index], depth + 1);
			return;
		}
		if (value && typeof value === "object") {
			// One key at a time, so an oversized object stops at the first value past the cap.
			for (const key in value) {
				if (problem) return;
				if (!Object.hasOwn(value, key)) continue;
				const size = utf8ByteLength(key, 0, key.length, limits.stringBytes);
				total += size;
				if (size > limits.stringBytes || total > limits.totalStringBytes) {
					problem = `This entry has more than ${bytes(limits.totalStringBytes)} bytes of text, more than the schema preview reads.`;
					return;
				}
				visit((value as Record<string, unknown>)[key], depth + 1);
			}
		}
	};
	visit(item, 0);
	return problem;
}

/** Unresolved JSON across stored rows, counted before any of it is parsed. */
export function entrySchemaPreviewUnresolvedProblem(rows: ReadonlyArray<{ value: Record<string, unknown> }>): string | null {
	let total = 0;
	for (const row of rows) {
		const json = row.value.json;
		if (typeof json === "string") total += utf8ByteLength(json, 0, json.length, ENTRY_SCHEMA_PREVIEW_UNRESOLVED_MAX_BYTES - total);
		if (total > ENTRY_SCHEMA_PREVIEW_UNRESOLVED_MAX_BYTES) {
			return `The stored schemas for this entry hold more than ${bytes(ENTRY_SCHEMA_PREVIEW_UNRESOLVED_MAX_BYTES)} bytes of JSON-LD, more than the schema preview reads.`;
		}
	}
	return null;
}

/**
 * One budget for every custom graph the resolver expands, suppressed ones
 * included, with the candidate's own expansion also held to its cap.
 */
export function createEntrySchemaPreviewExpansion(candidateId: string) {
	const shared: TemplateExpansionBudget = {
		work: ENTRY_SCHEMA_PREVIEW_EXPANSION_WORK,
		outputBytes: ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES,
	};
	let candidateExceeded = false;
	return {
		expand(schema: { id: string }, parsed: unknown, vars: Record<string, string>): unknown {
			if (schema.id !== candidateId) return applyVarsDeepBounded(parsed, vars, shared);
			const own: TemplateExpansionBudget = {
				work: shared.work,
				outputBytes: Math.min(shared.outputBytes, ENTRY_SCHEMA_CANDIDATE_MAX_BYTES),
			};
			const before = { ...own };
			try {
				return applyVarsDeepBounded(parsed, vars, own);
			} catch (error) {
				if (error instanceof TemplateExpansionLimitError && error.limit === "output" && shared.outputBytes > ENTRY_SCHEMA_CANDIDATE_MAX_BYTES) {
					candidateExceeded = true;
				}
				throw error;
			} finally {
				shared.work -= before.work - own.work;
				shared.outputBytes -= before.outputBytes - own.outputBytes;
			}
		},
		limitFailure(error: TemplateExpansionLimitError): EntrySchemaPreviewLimitFailure {
			if (candidateExceeded) {
				return {
					error: "expansion_too_large",
					message: `With this entry's values, the schema would expand to more than ${bytes(ENTRY_SCHEMA_CANDIDATE_MAX_BYTES)} bytes. Nothing is shown rather than a shortened preview.`,
				};
			}
			return {
				error: error.limit === "work" ? "expansion_too_large" : "response_too_large",
				message: error.limit === "work"
					? "The schemas for this entry need more expansion work than the preview allows. Nothing is shown rather than a partial preview."
					: `The schemas for this entry expand to more than ${bytes(ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES)} bytes. Nothing is shown rather than a partial preview.`,
			};
		},
	};
}

/** Whether any text value of validated entry JSON uses the variable. */
export function entrySchemaUsesVariable(parsed: unknown, name: string): boolean {
	if (typeof parsed === "string") return templateVariables(parsed).includes(name);
	if (Array.isArray(parsed)) return parsed.some((item) => entrySchemaUsesVariable(item, name));
	if (parsed && typeof parsed === "object") return Object.values(parsed).some((item) => entrySchemaUsesVariable(item, name));
	return false;
}

/** An explicit canonical or the published entry's registered public URL is required. */
export const ENTRY_SCHEMA_CANONICAL_UNRESOLVED =
	"This schema uses {{canonical}}, but no public URL is available for this preview. Set an explicit canonical URL, or publish the entry with a working public route. Your form is kept.";

/** The candidate's resolved graph, or a refusal when it is over its cap. */
export function entrySchemaCandidateGraphBytes(graph: unknown): { ok: true; bytes: number } | { ok: false; failure: EntrySchemaPreviewLimitFailure } {
	const size = jsonUtf8LengthWithin(graph, ENTRY_SCHEMA_CANDIDATE_MAX_BYTES);
	return size === null
		? {
			ok: false,
			failure: {
				error: "expansion_too_large",
				message: `The resolved schema is larger than ${bytes(ENTRY_SCHEMA_CANDIDATE_MAX_BYTES)} bytes. Nothing is shown rather than a shortened preview.`,
			},
		}
		: { ok: true, bytes: size };
}

/** Bytes of the HTTP body EmDash writes for a successful plugin route. */
export function entrySchemaPreviewWireBytes(data: unknown): number | null {
	return jsonUtf8LengthWithin({ success: true, data }, ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES);
}

export const ENTRY_SCHEMA_PREVIEW_RESPONSE_TOO_LARGE: EntrySchemaPreviewLimitFailure = Object.freeze({
	error: "response_too_large",
	message: `The preview for this entry is larger than ${bytes(ENTRY_SCHEMA_PREVIEW_RESPONSE_MAX_BYTES)} bytes. Nothing is shown rather than a partial preview.`,
});
