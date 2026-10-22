// Templates view reads: a published-only example list, one exact published
// example, and a metadata-only preview of unsaved template values for one
// exact published entry. The preview resolves through the same resolver as
// the public page:metadata hook, with bounds applied before any helper
// normalizes or expands a value.
// It reads no schema, score or scan state and writes nothing. Plugin content
// access returns the live row (draft saves stay in revisions), and the entry,
// core SEO and URL are separate reads, so the entry is read again at the end.

import type { PluginContext } from "emdash";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_TEMPLATE_EXAMPLES_RESPONSE_MAX_BYTES,
	SEO_ADMIN_TEMPLATE_EXPANSION_MAX_BYTES,
	SEO_ADMIN_TEMPLATE_PREVIEW_RESPONSE_MAX_BYTES,
	isSeoContentCollectionKey,
	validateSeoAdminTemplateValues,
	type SeoAdminTemplateExample,
	type SeoAdminTemplateExampleFailure,
	type SeoAdminTemplateExampleResult,
	type SeoAdminTemplateExamplesResult,
	type SeoAdminTemplatePreview,
	type SeoAdminTemplatePreviewFailure,
	type SeoAdminTemplatePreviewResult,
} from "./admin-contract.ts";
import { ENTRY_SCHEMA_PREVIEW_CONTENT_LIMITS, entrySchemaPreviewContentProblem } from "./entry-schema-candidate.ts";
import {
	contentItemTitle,
	resolveContentCollection,
	resolveEffectiveContentMetadata,
	type MetadataResolutionBounds,
} from "./entry-analysis-runtime.ts";
import { TemplateExpansionLimitError, applyVarsDeepBounded, isHttpUrl, jsonUtf8LengthWithin, utf8ByteLength } from "./lib.ts";
import { readMetadataTemplates } from "./metadata-templates.ts";
import { getGlobalSettings, readSiteSettings } from "./settings-runtime.ts";
import { isReadableSiteSettings } from "./settings-state.ts";

/** Stored override records and site strings the preview lets the resolver read. */
export const TEMPLATE_PREVIEW_STORED_LIMITS = Object.freeze({
	depth: 8,
	values: 1_000,
	stringBytes: 32_768,
	totalStringBytes: 131_072,
});
const PUBLIC_URL_MAX_BYTES = 8_192;
const EXPANSION_WORK = 10_000;
/** Scalar fields the preview compares across its two entry reads, and the example list shows. */
const ENTRY_FIELD_MAX_BYTES = 2_048;
const EXAMPLE_TITLE_MAX_BYTES = 4_096;

export const TEMPLATE_PREVIEW_MESSAGES: Readonly<Record<SeoAdminTemplatePreviewFailure, string>> = Object.freeze({
	invalid_input: "Choose a content type, an entry and its locale.",
	collection_unavailable: "This content type is not an SEO template target, or content types are unavailable.",
	templates_unreadable: "The stored templates cannot be read, so no preview is shown.",
	settings_unreadable: "The SEO settings cannot be read. Public pages show no tags from this plugin until they can, so no preview is shown.",
	content_unavailable: "The entry could not be read. Try again.",
	not_found: "This entry no longer exists.",
	locale_mismatch: "This entry is no longer in the selected locale. Choose the example again.",
	not_published: "This entry is not published, so it has no public page to predict.",
	no_public_url: "EmDash has no public URL for this entry: the Site URL, the entry slug or a routable content type is missing. No exact prediction is possible.",
	content_too_large: "This entry holds more content than the preview reads. Nothing is shown rather than a partial preview.",
	stored_value_too_large: "A stored SEO value for this entry or site is larger than the preview reads. Nothing is shown rather than a partial preview.",
	expansion_too_large: `A template expands to more than ${SEO_ADMIN_TEMPLATE_EXPANSION_MAX_BYTES.toLocaleString("en-US")} bytes for this entry. Nothing is shown rather than a partial preview.`,
	response_too_large: `The preview is larger than ${SEO_ADMIN_TEMPLATE_PREVIEW_RESPONSE_MAX_BYTES.toLocaleString("en-US")} bytes. Nothing is shown rather than a partial preview.`,
	entry_changed: "The entry changed while the preview was prepared. Run the preview again.",
});

class TemplatePreviewRefusal extends Error {
	readonly code: SeoAdminTemplatePreviewFailure;

	constructor(code: SeoAdminTemplatePreviewFailure) {
		super(TEMPLATE_PREVIEW_MESSAGES[code]);
		this.name = "TemplatePreviewRefusal";
		this.code = code;
	}
}

function refuse(code: SeoAdminTemplatePreviewFailure): SeoAdminTemplatePreviewResult {
	return { success: false, error: code, message: TEMPLATE_PREVIEW_MESSAGES[code] };
}

function plain(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sameValue(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const leftKeys = Object.keys(left as object);
	const rightKeys = Object.keys(right as object);
	return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
		Object.hasOwn(right as object, key) &&
		sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function scalarWithin(value: unknown, maxBytes: number): boolean {
	if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return true;
	return typeof value === "string" && utf8ByteLength(value, 0, value.length, maxBytes) <= maxBytes;
}

/** Values read only after a string check; other types are never converted. */
function stringWithin(value: unknown, maxBytes: number): boolean {
	return typeof value !== "string" || utf8ByteLength(value, 0, value.length, maxBytes) <= maxBytes;
}

/**
 * The fields a second read is compared on, bounded before anything converts
 * or recurses into them.
 */
function secondObservationProblem(item: Record<string, unknown>): boolean {
	for (const field of ["id", "locale", "status", "slug", "version", "liveRevisionId", "updatedAt"]) {
		if (!scalarWithin(item[field], ENTRY_FIELD_MAX_BYTES)) return true;
	}
	return entrySchemaPreviewContentProblem(item.seo ?? null, TEMPLATE_PREVIEW_STORED_LIMITS) !== null;
}

/** What a second read must repeat for the preview to describe one entry state. */
function observedEntry(item: Record<string, unknown>) {
	return {
		id: String(item.id),
		locale: item.locale ?? null,
		status: item.status ?? null,
		slug: item.slug ?? null,
		version: item.version ?? null,
		liveRevisionId: item.liveRevisionId ?? null,
		updatedAt: item.updatedAt ?? null,
		seo: item.seo ?? null,
	};
}

export function templatePreviewBounds(): MetadataResolutionBounds {
	return {
		inspectStored(value) {
			if (entrySchemaPreviewContentProblem(value, TEMPLATE_PREVIEW_STORED_LIMITS)) {
				throw new TemplatePreviewRefusal("stored_value_too_large");
			}
		},
		substitute(template, vars) {
			try {
				return applyVarsDeepBounded(template, vars, { work: EXPANSION_WORK, outputBytes: SEO_ADMIN_TEMPLATE_EXPANSION_MAX_BYTES });
			} catch (error) {
				if (error instanceof TemplateExpansionLimitError) throw new TemplatePreviewRefusal("expansion_too_large");
				throw error;
			}
		},
	};
}

export interface TemplatePreviewHost {
	ctx: PluginContext;
	/** Visible template targets, or null when discovery is unavailable. */
	targets(): Promise<readonly string[] | null>;
}

/** The complete success body EmDash writes, counted without serializing it. */
export function templateRouteWireBytes(data: unknown, limit: number): number | null {
	return jsonUtf8LengthWithin({ success: true, data }, limit);
}

/**
 * Predicts the description and social tags Shipit SEO emits for one exact
 * published entry with the submitted, unsaved template values.
 */
export async function previewMetadataTemplate(host: TemplatePreviewHost, input: unknown): Promise<SeoAdminTemplatePreviewResult> {
	const source = plain(input);
	const collection = source?.collection;
	const entryId = source?.entryId;
	const locale = source?.locale;
	if (
		!source ||
		typeof collection !== "string" || !isSeoContentCollectionKey(collection) ||
		typeof entryId !== "string" || !entryId || entryId.length > 128 ||
		typeof locale !== "string" || !locale || locale.length > 35
	) {
		return refuse("invalid_input");
	}
	const validation = validateSeoAdminTemplateValues(source.values, collection);
	if (!validation.success) return { success: false, error: "invalid_values", errors: validation.errors };
	const ctx = host.ctx;
	let targets: readonly string[] | null = null;
	try {
		targets = await host.targets();
	} catch {
		targets = null;
	}
	if (!targets?.includes(collection)) return refuse("collection_unavailable");
	const templates = await readMetadataTemplates(ctx.kv as any);
	if (templates.state === "corrupt" || templates.state === "unavailable") return refuse("templates_unreadable");
	const site = await readSiteSettings(ctx);
	if (!isReadableSiteSettings(site)) return refuse("settings_unreadable");
	const content = ctx.content as (PluginContext["content"] & { getPublicUrl?: (collection: string, id: string) => Promise<string | null> }) | undefined;
	if (typeof content?.get !== "function" || typeof content.getPublicUrl !== "function") return refuse("content_unavailable");

	let item: Record<string, unknown> | null;
	try {
		item = plain(await content.get(collection, entryId));
	} catch {
		return refuse("content_unavailable");
	}
	if (!item || String(item.id) !== entryId) return refuse("not_found");
	if (item.locale !== locale) return refuse("locale_mismatch");
	if (item.status !== "published") return refuse("not_published");
	// One walk covers top-level fields, data and core SEO before any helper copies them.
	if (entrySchemaPreviewContentProblem(item, ENTRY_SCHEMA_PREVIEW_CONTENT_LIMITS)) return refuse("content_too_large");
	if (entrySchemaPreviewContentProblem(await getGlobalSettings(ctx, undefined, site.values), TEMPLATE_PREVIEW_STORED_LIMITS)) {
		return refuse("stored_value_too_large");
	}
	let publicUrl: string | null;
	try {
		publicUrl = await content.getPublicUrl(collection, entryId);
	} catch {
		return refuse("content_unavailable");
	}
	if (typeof publicUrl !== "string" || !publicUrl) return refuse("no_public_url");
	if (utf8ByteLength(publicUrl, 0, publicUrl.length, PUBLIC_URL_MAX_BYTES) > PUBLIC_URL_MAX_BYTES) return refuse("stored_value_too_large");
	if (!isHttpUrl(publicUrl)) return refuse("no_public_url");

	let effective: Awaited<ReturnType<typeof resolveEffectiveContentMetadata>>;
	try {
		// The URL checked above is the one the resolver uses; it does not look it up again.
		effective = await resolveEffectiveContentMetadata(ctx, collection, item, validation.values, site.values, {
			...templatePreviewBounds(),
			publicUrl,
		});
	} catch (error) {
		if (error instanceof TemplatePreviewRefusal) return refuse(error.code);
		throw error;
	}

	let again: Record<string, unknown> | null;
	try {
		again = plain(await content.get(collection, entryId));
	} catch {
		return refuse("content_unavailable");
	}
	if (!again || secondObservationProblem(again)) return refuse("entry_changed");
	if (!sameValue(observedEntry(item), observedEntry(again))) return refuse("entry_changed");

	const preview: SeoAdminTemplatePreview = {
		collection,
		entryId,
		locale,
		slug: String(item.slug ?? ""),
		status: "published",
		publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : null,
		version: typeof item.version === "number" ? item.version : null,
		publicUrl,
		description: { value: effective.description.value, source: effective.description.source },
		socialTitle: { value: effective.socialTitle.value, source: effective.socialTitle.source },
		socialDescription: { value: effective.socialDescription.value, source: effective.socialDescription.source },
		titleSuggestion: { value: effective.title.value, source: effective.title.source },
		noindex: !effective.indexable,
	};
	const result: SeoAdminTemplatePreviewResult = { success: true, preview };
	if (templateRouteWireBytes(result, SEO_ADMIN_TEMPLATE_PREVIEW_RESPONSE_MAX_BYTES) === null) return refuse("response_too_large");
	return result;
}

/**
 * Whether a field an example option shows is larger than the option carries.
 * Only those fields are bounded, before any of them is trimmed or converted;
 * bodies are never walked.
 */
function exampleOptionOversized(item: any, titleField: string | null | undefined): boolean {
	const data = item?.data && typeof item.data === "object" ? item.data : {};
	return (
		!scalarWithin(item?.id, ENTRY_FIELD_MAX_BYTES) ||
		!scalarWithin(item?.slug, ENTRY_FIELD_MAX_BYTES) ||
		!stringWithin(item?.locale, ENTRY_FIELD_MAX_BYTES) ||
		!stringWithin(item?.status, ENTRY_FIELD_MAX_BYTES) ||
		!stringWithin(item?.publishedAt, ENTRY_FIELD_MAX_BYTES) ||
		!stringWithin(item?.updatedAt, ENTRY_FIELD_MAX_BYTES) ||
		(typeof titleField === "string" && !stringWithin(data[titleField], EXAMPLE_TITLE_MAX_BYTES)) ||
		!stringWithin(data.title, EXAMPLE_TITLE_MAX_BYTES) ||
		!stringWithin(data.name, EXAMPLE_TITLE_MAX_BYTES)
	);
}

/** The option fields of an entry that passed `exampleOptionOversized`. */
function exampleOption(item: any, titleField: string | null | undefined): SeoAdminTemplateExample {
	return {
		entryId: String(item.id),
		title: contentItemTitle(item, titleField),
		slug: typeof item.slug === "string" && item.slug ? item.slug : null,
		locale: typeof item.locale === "string" ? item.locale : "",
		publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : null,
		updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
	};
}

/** The locale rule the preview applies to its input. */
function usableLocale(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 35;
}

export const TEMPLATE_EXAMPLE_MESSAGES: Readonly<Record<SeoAdminTemplateExampleFailure | "invalid_input", string>> = Object.freeze({
	invalid_input: "Choose a content type and one of its entries.",
	collection_unavailable: TEMPLATE_PREVIEW_MESSAGES.collection_unavailable,
	content_unavailable: "The requested entry could not be read. Try again.",
	not_found: "The requested entry does not exist in this content type.",
	not_published: "The requested entry is not published, so it has no public page to preview.",
	invalid_locale: "The requested entry has no usable locale, so it cannot be previewed.",
	response_too_large: "The requested entry has a title or identifier larger than an example shows. Nothing is shown rather than a shortened value.",
});

/**
 * One exact published entry of one template target, with the fields a listed
 * option shows. One `content.get` by ID: no pages, schema records, analysis,
 * public URL or network. Every answer after valid input names that input.
 */
export async function readMetadataTemplateExample(host: TemplatePreviewHost, input: unknown): Promise<SeoAdminTemplateExampleResult> {
	const source = plain(input);
	const collection = source?.collection;
	const entryId = source?.entryId;
	if (
		typeof collection !== "string" || !isSeoContentCollectionKey(collection) ||
		typeof entryId !== "string" || !entryId || entryId.length > 128
	) {
		return { success: false, error: "invalid_input", message: TEMPLATE_EXAMPLE_MESSAGES.invalid_input };
	}
	const refusal = (error: SeoAdminTemplateExampleFailure): SeoAdminTemplateExampleResult =>
		({ success: false, error, collection, entryId, message: TEMPLATE_EXAMPLE_MESSAGES[error] });
	const ctx = host.ctx;
	let targets: readonly string[] | null = null;
	try {
		targets = await host.targets();
	} catch {
		targets = null;
	}
	if (!targets?.includes(collection)) return refusal("collection_unavailable");
	if (typeof ctx.content?.get !== "function") return refusal("content_unavailable");
	let item: Record<string, unknown> | null;
	try {
		item = plain(await ctx.content.get(collection, entryId));
	} catch {
		return refusal("content_unavailable");
	}
	// An equal returned ID is bounded by the requested one.
	if (!item || (typeof item.id !== "string" && typeof item.id !== "number") || String(item.id) !== entryId) return refusal("not_found");
	if (item.status !== "published") return refusal("not_published");
	if (!usableLocale(item.locale)) return refusal("invalid_locale");
	const definition = await resolveContentCollection(ctx, collection);
	if (exampleOptionOversized(item, definition?.titleField)) return refusal("response_too_large");
	const result: SeoAdminTemplateExampleResult = {
		success: true,
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		collection,
		entryId,
		example: exampleOption(item, definition?.titleField),
	};
	if (templateRouteWireBytes(result, SEO_ADMIN_TEMPLATE_EXAMPLES_RESPONSE_MAX_BYTES) === null) return refusal("response_too_large");
	return result;
}

/**
 * One page of published entries in one template target, newest update first.
 * Each option names its exact entry and locale; nothing is selected or
 * previewed here.
 */
export async function listMetadataTemplateExamples(
	host: TemplatePreviewHost,
	input: { collection: string; limit: number; cursor?: string },
): Promise<SeoAdminTemplateExamplesResult> {
	const ctx = host.ctx;
	let targets: readonly string[] | null = null;
	try {
		targets = await host.targets();
	} catch {
		targets = null;
	}
	if (!targets?.includes(input.collection)) {
		return { success: false, error: "collection_unavailable", message: TEMPLATE_PREVIEW_MESSAGES.collection_unavailable };
	}
	if (typeof ctx.content?.list !== "function") {
		return { success: false, error: "content_unavailable", message: "Content could not be listed. Try again." };
	}
	let page: Awaited<ReturnType<NonNullable<PluginContext["content"]>["list"]>>;
	try {
		page = await ctx.content.list(input.collection, {
			where: { status: "published" },
			limit: input.limit,
			...(input.cursor ? { cursor: input.cursor } : {}),
			orderBy: { updatedAt: "desc" },
		});
	} catch {
		return { success: false, error: "content_unavailable", message: "Content could not be listed. Try again or go back to the first page." };
	}
	if (page.items.length > input.limit || (page.hasMore && (!page.cursor || page.cursor === input.cursor))) {
		return { success: false, error: "content_unavailable", message: "Content pagination did not advance within its limit." };
	}
	const definition = await resolveContentCollection(ctx, input.collection);
	// The host still loads full rows.
	if (page.items.some((item: any) => exampleOptionOversized(item, definition?.titleField))) {
		return {
			success: false,
			error: "response_too_large",
			message: "An entry on this page has a title or identifier larger than the list shows. Nothing is listed rather than a partial page.",
		};
	}
	const items = page.items
		.filter((item: any) => item?.status === "published")
		.map((item: any) => exampleOption(item, definition?.titleField));
	const result: SeoAdminTemplateExamplesResult = {
		success: true,
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		collection: input.collection,
		items,
		...(page.hasMore && page.cursor ? { cursor: page.cursor } : {}),
		hasMore: Boolean(page.hasMore),
	};
	if (templateRouteWireBytes(result, SEO_ADMIN_TEMPLATE_EXAMPLES_RESPONSE_MAX_BYTES) === null) {
		return {
			success: false,
			error: "response_too_large",
			message: "This page of entries is too large to list. Choose a smaller page or shorten entry titles.",
		};
	}
	return result;
}
