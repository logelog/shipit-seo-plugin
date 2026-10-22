// Pure helpers — NO plugin context, no I/O. Everything here is deterministic and
// unit-testable. Used by both the page:metadata hook and the admin/save routes.
//
// SECURITY: JSON-LD is DATA only. validateCustomJsonLd rejects anything that looks
// like markup/script/code; the host renders the returned object inside a
// <script type="application/ld+json"> with safe escaping. We never build HTML here.

import type { PublicPageContext } from "emdash";

// ---------------------------------------------------------------------------
// Template variables
// ---------------------------------------------------------------------------

// The variables a site editor may reference in title/description templates and in
// custom JSON-LD strings. Listed for the admin "help" block.
export const TEMPLATE_VARS = [
	"siteName",
	"siteUrl",
	"title",
	"description",
	"canonical",
	"image",
	"author",
	"publishedAt",
	"updatedAt",
	"collection",
	"slug",
] as const;

export type TemplateVarKey = (typeof TEMPLATE_VARS)[number];

const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function templateVariables(tpl: string): string[] {
	if (typeof tpl !== "string" || tpl === "") return [];
	return [...tpl.matchAll(TEMPLATE_TOKEN_PATTERN)].map((match) => match[1]);
}

export function unknownTemplateVariables(tpl: string): string[] {
	const allowed = new Set<string>(TEMPLATE_VARS);
	return [...new Set(templateVariables(tpl).filter((key) => !allowed.has(key)))];
}

// Replace {{var}} tokens. Unknown vars resolve to an empty string. Tolerates
// optional inner whitespace ({{ title }}). Non-string inputs return "".
export function resolveTemplate(tpl: string, vars: Record<string, string>): string {
	if (typeof tpl !== "string" || tpl === "") return "";
	return tpl.replace(TEMPLATE_TOKEN_PATTERN, (_m, key: string) => {
		const v = vars[key];
		return typeof v === "string" ? v : "";
	});
}

// Build the template-vars record from a page context. Always strings (never
// null/undefined) so resolveTemplate produces clean output.
export function buildVars(page: PublicPageContext): Record<string, string> {
	const content = page.content;
	const article = page.articleMeta ?? {};
	return {
		siteName: str(page.siteName),
		siteUrl: str((page as PublicPageContext & { siteUrl?: string }).siteUrl),
		// pageTitle is the per-page title without the site suffix when available.
		title: str(page.pageTitle ?? page.title),
		description: str(page.description),
		canonical: str(page.canonical ?? page.url),
		image: str(page.image ?? page.seo?.ogImage ?? ""),
		author: str(article.author),
		publishedAt: str(article.publishedTime),
		updatedAt: str(article.modifiedTime),
		collection: str(content?.collection),
		slug: str(content?.slug ?? content?.id),
	};
}

function str(v: unknown): string {
	return v == null ? "" : String(v);
}

// ---------------------------------------------------------------------------
// Default content-type templates (RankMath-style title/description patterns)
// ---------------------------------------------------------------------------

export interface ContentTypeTemplate {
	title: string;
	description: string;
	socialTitle: string;
	socialDescription: string;
}

export const DEFAULT_TEMPLATES: Record<string, ContentTypeTemplate> = {
	posts: {
		title: "{{title}} — {{siteName}}",
		description: "{{description}}",
		socialTitle: "{{title}}",
		socialDescription: "{{description}}",
	},
	pages: {
		title: "{{title}} — {{siteName}}",
		description: "{{description}}",
		socialTitle: "{{title}}",
		socialDescription: "{{description}}",
	},
	services: {
		title: "{{title}} — {{siteName}}",
		description: "{{description}}",
		socialTitle: "{{title}}",
		socialDescription: "{{description}}",
	},
};

export function resolveContentTypeTemplate(
	template: ContentTypeTemplate,
	vars: Record<string, string>,
	substitute: (tpl: string, vars: Record<string, string>) => string = resolveTemplate,
): ContentTypeTemplate {
	const title = substitute(template.title, vars).trim();
	const description = substitute(template.description, vars).trim();
	return {
		title,
		description,
		socialTitle: substitute(template.socialTitle || template.title, vars).trim() || title,
		socialDescription:
			substitute(template.socialDescription || template.description, vars).trim() || description,
	};
}

// ---------------------------------------------------------------------------
// Custom JSON-LD validation + safe variable substitution
// ---------------------------------------------------------------------------

export class JsonLdValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JsonLdValidationError";
	}
}

// Markup/script-injection patterns that have no place in pure JSON-LD DATA. We
// block them defensively even though the host escapes output — defence in depth,
// with a clear editor error. NOTE: we deliberately do NOT substring-match
// "function" here because legitimate schema.org keys contain it (e.g. Person.
// jobFunction). Real JS functions can never survive JSON.parse and are caught
// structurally by assertPlainData below.
const FORBIDDEN_SUBSTRINGS = ["<script", "</", "javascript:"];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Parse + validate a custom JSON-LD string supplied by an admin. Returns the parsed
// object/array (DATA only). Throws JsonLdValidationError on anything suspicious.
export function validateCustomJsonLd(raw: string): Record<string, unknown> | Record<string, unknown>[] {
	if (typeof raw !== "string" || raw.trim() === "") {
		throw new JsonLdValidationError("JSON-LD is empty.");
	}

	// Reject script-like / code-like content on the RAW text first.
	const lower = raw.toLowerCase();
	for (const bad of FORBIDDEN_SUBSTRINGS) {
		if (lower.includes(bad)) {
			throw new JsonLdValidationError(`JSON-LD must be data only — disallowed token "${bad}".`);
		}
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err: unknown) {
		throw new JsonLdValidationError(`Invalid JSON: ${(err as Error).message}`);
	}

	if (parsed === null || typeof parsed !== "object") {
		throw new JsonLdValidationError("JSON-LD must be an object or an array of objects.");
	}
	if (
		Array.isArray(parsed) &&
		parsed.some((item) => item === null || typeof item !== "object" || Array.isArray(item))
	) {
		throw new JsonLdValidationError("Every top-level JSON-LD array item must be an object.");
	}

	// Re-serialise the parsed value and re-check: catches anything that survived
	// parsing (and normalises away weird escapes) before it can reach the host.
	const reserialised = JSON.stringify(parsed).toLowerCase();
	for (const bad of FORBIDDEN_SUBSTRINGS) {
		if (reserialised.includes(bad)) {
			throw new JsonLdValidationError(`JSON-LD must be data only — disallowed token "${bad}".`);
		}
	}

	// Guard against any non-plain values that JSON.parse can't produce but a caller
	// might pass (functions/symbols). JSON.parse never yields these, but assert anyway.
	assertPlainData(parsed);
	const duplicateIds = duplicateSchemaDefinitionIds(parsed);
	if (duplicateIds.length) {
		throw new JsonLdValidationError(
			`JSON-LD defines the same entity @id more than once: ${duplicateIds.join(", ")}. Use a bare {"@id":"..."} reference instead.`,
		);
	}

	return parsed as Record<string, unknown> | Record<string, unknown>[];
}

function assertPlainData(value: unknown): void {
	const t = typeof value;
	if (value === null) return;
	if (t === "string" || t === "number" || t === "boolean") return;
	if (Array.isArray(value)) {
		for (const item of value) assertPlainData(item);
		return;
	}
	if (t === "object") {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (FORBIDDEN_KEYS.has(k)) {
				throw new JsonLdValidationError(`JSON-LD contains a disallowed key: ${k}.`);
			}
			assertPlainData(v);
		}
		return;
	}
	throw new JsonLdValidationError(`JSON-LD contains an unsupported value type: ${t}.`);
}

// Deep-walk a parsed JSON-LD value and run resolveTemplate on every STRING. Returns
// a NEW structure — never mutates the input. Object keys are left untouched (only
// values are templated), which is the safe and expected RankMath-like behaviour.
export function applyVarsDeep<T>(obj: T, vars: Record<string, string>): T {
	if (typeof obj === "string") {
		return resolveTemplate(obj, vars) as unknown as T;
	}
	if (Array.isArray(obj)) {
		return obj.map((item) => applyVarsDeep(item, vars)) as unknown as T;
	}
	if (obj && typeof obj === "object") {
		const out: Record<string, unknown> = Object.create(null);
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			out[k] = applyVarsDeep(v, vars);
		}
		return out as unknown as T;
	}
	return obj;
}

/** Thrown when a bounded expansion would exceed its remaining work or output. */
export class TemplateExpansionLimitError extends Error {
	readonly limit: "work" | "output";

	constructor(limit: "work" | "output") {
		super(limit === "work" ? "Template expansion exceeds its work budget." : "Template expansion exceeds its output budget.");
		this.name = "TemplateExpansionLimitError";
		this.limit = limit;
	}
}

/**
 * Remaining allowance shared by every expansion that receives it. `work`
 * counts visited values and variable tokens; `outputBytes` counts the UTF-8
 * bytes of the expanded strings.
 */
export interface TemplateExpansionBudget {
	work: number;
	outputBytes: number;
}

/**
 * UTF-8 byte length of `text[start, end)` without allocating it. With a
 * `limit`, counting stops once the length passes it and the partial count,
 * already above `limit`, is returned.
 */
export function utf8ByteLength(text: string, start = 0, end = text.length, limit = Number.POSITIVE_INFINITY): number {
	let bytes = 0;
	for (let index = start; index < end && bytes <= limit; index += 1) {
		const code = text.charCodeAt(index);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && index + 1 < end) {
			const next = text.charCodeAt(index + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				index += 1;
			} else bytes += 3;
		} else bytes += 3;
	}
	return bytes;
}

function spendExpansionWork(budget: TemplateExpansionBudget, units: number): void {
	budget.work -= units;
	if (budget.work < 0) throw new TemplateExpansionLimitError("work");
}

/**
 * The result of `applyVarsDeep` under a budget. Each string's expanded size is
 * projected from its literal text and the variable values before the string is
 * built; every measurement stops at the remaining output allowance, so a huge
 * value fails after reading only that much of it. Strings are then built with
 * `resolveTemplate` itself, so the output is the public expansion exactly; one
 * pass, never a second expansion of its result.
 */
export function applyVarsDeepBounded<T>(
	obj: T,
	vars: Record<string, string>,
	budget: TemplateExpansionBudget,
): T {
	// Only complete measurements are kept; a cut-off one has already failed.
	const valueBytes = new Map<string, number>();
	const visit = (value: unknown): unknown => {
		spendExpansionWork(budget, 1);
		if (typeof value === "string") {
			let projected = 0;
			let cursor = 0;
			const measure = (text: string, from: number, to: number): void => {
				projected += utf8ByteLength(text, from, to, budget.outputBytes - projected);
				if (projected > budget.outputBytes) throw new TemplateExpansionLimitError("output");
			};
			for (const match of value.matchAll(TEMPLATE_TOKEN_PATTERN)) {
				spendExpansionWork(budget, 1);
				measure(value, cursor, match.index);
				cursor = match.index + match[0].length;
				const key = match[1];
				const replacement = vars[key];
				if (typeof replacement !== "string") continue;
				const known = valueBytes.get(key);
				if (known !== undefined) {
					projected += known;
					if (projected > budget.outputBytes) throw new TemplateExpansionLimitError("output");
					continue;
				}
				const before = projected;
				measure(replacement, 0, replacement.length);
				valueBytes.set(key, projected - before);
			}
			measure(value, cursor, value.length);
			budget.outputBytes -= projected;
			return resolveTemplate(value, vars);
		}
		if (Array.isArray(value)) return value.map(visit);
		if (value && typeof value === "object") {
			const out: Record<string, unknown> = Object.create(null);
			for (const [key, child] of Object.entries(value as Record<string, unknown>)) out[key] = visit(child);
			return out;
		}
		return value;
	};
	return visit(obj) as T;
}

function jsonStringBytes(text: string, limit: number): number {
	let bytes = 2;
	for (let index = 0; index < text.length && bytes <= limit; index += 1) {
		const code = text.charCodeAt(index);
		if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) bytes += 2;
		else if (code < 0x20) bytes += 6;
		else if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff) {
			const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				index += 1;
			} else bytes += 6;
		} else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
		else bytes += 3;
	}
	return bytes;
}

/**
 * The UTF-8 length of `JSON.stringify(value)` for plain JSON data, counted
 * without building the text. Returns `null` as soon as the count passes
 * `limit`, so an oversized value costs at most `limit` bytes of counting.
 * A shared or repeated object is counted at each occurrence, as serialization
 * would write it. Keys are enumerated one at a time and counting stops at
 * the first one past the limit; callers bound how large a value can be before
 * measuring it.
 */
export function jsonUtf8LengthWithin(value: unknown, limit: number): number | null {
	let total = 0;
	const add = (bytes: number): boolean => {
		total += bytes;
		return total <= limit;
	};
	const visit = (item: unknown, depth: number): boolean => {
		if (depth > 512) throw new TypeError("Value is nested too deeply to measure.");
		if (item === null) return add(4);
		switch (typeof item) {
			case "string":
				return add(jsonStringBytes(item, limit - total));
			case "number":
				return add(Number.isFinite(item) ? String(item).length : 4);
			case "boolean":
				return add(item ? 4 : 5);
			case "object": {
				if (typeof (item as { toJSON?: unknown }).toJSON === "function") {
					throw new TypeError("Values with toJSON cannot be measured.");
				}
				if (Array.isArray(item)) {
					if (!add(2 + Math.max(0, item.length - 1))) return false;
					for (const child of item) {
						const kind = typeof child;
						if (kind === "undefined" || kind === "function" || kind === "symbol") {
							if (!add(4)) return false;
						} else if (!visit(child, depth + 1)) return false;
					}
					return true;
				}
				if (!add(2)) return false;
				let first = true;
				for (const key in item) {
					if (!Object.hasOwn(item, key)) continue;
					const child = (item as Record<string, unknown>)[key];
					const kind = typeof child;
					if (kind === "undefined" || kind === "function" || kind === "symbol") continue;
					if (!add((first ? 0 : 1) + jsonStringBytes(key, limit - total) + 1)) return false;
					first = false;
					if (!visit(child, depth + 1)) return false;
				}
				return true;
			}
			default:
				throw new TypeError(`Values of type ${typeof item} cannot be measured.`);
		}
	};
	return visit(value, 0) ? total : null;
}

// ---------------------------------------------------------------------------
// Schema preset builders — return plain DATA objects including the schema.org
// @context (matches the documented page:metadata jsonld example, so each emitted
// graph is valid standalone JSON-LD). Built from the page context + global settings.
// ---------------------------------------------------------------------------

const SCHEMA_CONTEXT = "https://schema.org";

export const SCHEMA_PRESET_KEYS = [
	"organization",
	"website",
	"webPage",
	"blogPosting",
	"service",
	"breadcrumbList",
	"person",
	"faqPage",
	"localBusiness",
	"product",
	"event",
	"videoObject",
] as const;

export type SchemaPresetKey = (typeof SCHEMA_PRESET_KEYS)[number];
export type SchemaPresetValues = Record<SchemaPresetKey, boolean>;

const POSTS_COLLECTION = "posts";
const SERVICES_COLLECTION = "services";

/** The schema.org type a content type represents; "none" emits no type-specific graph. */
export const SCHEMA_CONTENT_TYPE_ROLES = ["none", "blogPosting", "service", "webPage"] as const;
export type SchemaContentTypeRole = (typeof SCHEMA_CONTENT_TYPE_ROLES)[number];
export type SchemaContentTypeRoles = Readonly<Record<string, SchemaContentTypeRole>>;
/**
 * A stored mapping that cannot be read. Content pages then get no role-owned
 * graph, so neither a stale default nor a corrupt value reaches public output.
 */
export const INVALID_SCHEMA_CONTENT_TYPE_ROLES = "invalid" as const;

// Sites that never saved a mapping keep the original posts and services behavior.
export function defaultSchemaContentTypeRole(collection: string | undefined): SchemaContentTypeRole {
	if (collection === POSTS_COLLECTION) return "blogPosting";
	if (collection === SERVICES_COLLECTION) return "service";
	return "none";
}

export function schemaContentTypeRole(
	collection: string | undefined,
	roles?: SchemaContentTypeRoles,
): SchemaContentTypeRole {
	if (collection && roles && Object.prototype.hasOwnProperty.call(roles, collection)) return roles[collection];
	return defaultSchemaContentTypeRole(collection);
}

// Entry data may hold preset objects directly or inside the first of these.
export const SCHEMA_PRESET_DATA_CONTAINERS = ["schemaData", "schema_data", "structuredData"] as const;

export interface SchemaPresetRequirements {
	/** The preset only emits on entries of content types mapped to this role. */
	readonly contentTypeRole?: Exclude<SchemaContentTypeRole, "none">;
	/** The preset only emits when the theme passes breadcrumbs in the page context. */
	readonly breadcrumbs?: true;
	/** Entry data paths. Every group must resolve through one of its paths; `[]` marks list items. */
	readonly data?: readonly (readonly string[])[];
	readonly note?: string;
}

// What each preset needs besides its switch. Every listed path is read by the
// matching builder below.
export const SCHEMA_PRESET_REQUIREMENTS: Readonly<Partial<Record<SchemaPresetKey, SchemaPresetRequirements>>> = {
	blogPosting: { contentTypeRole: "blogPosting" },
	service: { contentTypeRole: "service" },
	breadcrumbList: { breadcrumbs: true },
	person: {
		data: [["person.name", "author.name", "author"]],
		note: "Posts can also use the article author the theme passes to the page.",
	},
	faqPage: {
		data: [["faq[].question"], ["faq[].answer"]],
		note: "Items can also come from faqItems, faqs, or faqPage.items.",
	},
	localBusiness: {
		data: [
			["localBusiness.name"],
			["localBusiness.address.streetAddress"],
			["localBusiness.address.addressLocality"],
			["localBusiness.address.postalCode"],
			["localBusiness.address.addressCountry"],
		],
	},
	product: {
		data: [["product.name"], ["product.image"], ["product.offers.price"], ["product.offers.priceCurrency"]],
		note: "Entries in a products collection can use these fields without the product prefix.",
	},
	event: {
		data: [
			["event.name"],
			["event.startDate"],
			["event.location.name"],
			["event.location.address.streetAddress"],
			["event.location.address.addressLocality"],
			["event.location.address.postalCode"],
			["event.location.address.addressCountry"],
		],
		note: "Entries in an events collection can use these fields without the event prefix.",
	},
	videoObject: {
		data: [["video.name"], ["video.thumbnailUrl"], ["video.uploadDate"], ["video.contentUrl", "video.embedUrl"]],
		note: "Entries in a videos collection can use these fields without the video prefix.",
	},
};

export interface BuiltSchemaPreset {
	key: SchemaPresetKey;
	type: string;
	contributionId: string;
	graph: Record<string, unknown>;
}

type DataRecord = Record<string, unknown>;

function dataRecord(value: unknown): DataRecord | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as DataRecord
		: null;
}

function dataText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return "";
}

function firstText(source: DataRecord | null, keys: readonly string[]): string {
	if (!source) return "";
	for (const key of keys) {
		const value = dataText(source[key]);
		if (value) return value;
	}
	return "";
}

function firstRecord(source: DataRecord | null, keys: readonly string[]): DataRecord | null {
	if (!source) return null;
	for (const key of keys) {
		const value = dataRecord(source[key]);
		if (value) return value;
	}
	return null;
}

function firstArray(source: DataRecord | null, keys: readonly string[]): unknown[] {
	if (!source) return [];
	for (const key of keys) {
		const value = source[key];
		if (Array.isArray(value)) return value;
	}
	return [];
}

function structuredDataRoot(data: unknown): DataRecord {
	const root = dataRecord(data) ?? {};
	return firstRecord(root, SCHEMA_PRESET_DATA_CONTAINERS) ?? root;
}

function structuredRecord(data: unknown, keys: readonly string[]): DataRecord | null {
	const root = dataRecord(data) ?? {};
	const structured = structuredDataRoot(root);
	return firstRecord(structured, keys) ?? (structured === root ? null : firstRecord(root, keys));
}

function structuredArray(data: unknown, keys: readonly string[]): unknown[] {
	const root = dataRecord(data) ?? {};
	const structured = structuredDataRoot(root);
	const nested = firstArray(structured, keys);
	return nested.length ? nested : structured === root ? [] : firstArray(root, keys);
}

function stringList(value: unknown): string[] {
	const values = Array.isArray(value) ? value : value == null ? [] : [value];
	return values.map(dataText).filter(Boolean);
}

function absoluteSchemaUrl(value: unknown, siteUrl: string): string {
	const candidate = dataText(value);
	if (!candidate) return "";
	if (isHttpUrl(candidate)) return candidate;
	const root = siteRoot(siteUrl);
	if (!root) return "";
	try {
		return new URL(candidate, root).href;
	} catch {
		return "";
	}
}

// Stored logos may be site-relative media paths; schema consumers need an absolute http(s) URL.
function schemaHttpUrl(value: unknown, siteUrl: string): string {
	const url = absoluteSchemaUrl(value, siteUrl);
	return isHttpUrl(url) ? url : "";
}

function canonicalUrl(page: PublicPageContext, settings: GlobalSeoSettings): string {
	return absoluteSchemaUrl(page.canonical ?? page.url, settings.siteUrl);
}

function pageEntityId(page: PublicPageContext, settings: GlobalSeoSettings, fragment: string): string {
	const canonical = canonicalUrl(page, settings);
	return canonical ? `${canonical.split("#", 1)[0]}#${fragment}` : "";
}

function validDate(value: unknown): string {
	const candidate = dataText(value);
	return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : "";
}

function schemaTypeToken(value: unknown): string {
	const candidate = dataText(value);
	return /^[A-Za-z][A-Za-z0-9]*$/.test(candidate) ? candidate : "";
}

function schemaUrl(value: unknown): string {
	const candidate = dataText(value);
	if (!candidate) return "";
	if (/^https:\/\/schema\.org\/[A-Za-z][A-Za-z0-9]*$/.test(candidate)) return candidate;
	const token = schemaTypeToken(candidate);
	return token ? `https://schema.org/${token}` : "";
}

function mediaUrl(value: unknown, siteUrl: string): string {
	const candidate = Array.isArray(value) ? value[0] : value;
	const record = dataRecord(candidate);
	return absoluteSchemaUrl(
		record ? record.url ?? record.src ?? record.href ?? record.path : candidate,
		siteUrl,
	);
}

function postalAddress(value: unknown): Record<string, unknown> | null {
	const source = dataRecord(value);
	if (!source) return null;
	const streetAddress = firstText(source, ["streetAddress", "street", "addressLine1"]);
	const addressLocality = firstText(source, ["addressLocality", "city", "locality"]);
	const postalCode = firstText(source, ["postalCode", "postcode", "zip"]);
	const countryValue = source.addressCountry ?? source.country;
	const countryRecord = dataRecord(countryValue);
	const addressCountry = countryRecord
		? firstText(countryRecord, ["name", "code", "identifier"])
		: dataText(countryValue);
	if (!streetAddress || !addressLocality || !postalCode || !addressCountry) return null;
	const addressRegion = firstText(source, ["addressRegion", "region", "state"]);
	return {
		"@type": "PostalAddress",
		streetAddress,
		addressLocality,
		postalCode,
		addressCountry,
		...(addressRegion ? { addressRegion } : {}),
	};
}

// The subset of global settings the preset builders read. Kept loose so the
// runtime can pass whatever it loaded from KV.
export interface GlobalSeoSettings {
	siteName: string;
	siteUrl: string;
	publisherType?: "organization" | "person";
	orgName: string;
	orgLogo: string;
	personName?: string;
	sameAs: string[];
	defaultOgImage: string;
	twitterHandle: string;
}

function siteRoot(siteUrl: string): string {
	if (!isHttpUrl(siteUrl)) return "";
	return `${new URL(siteUrl).origin}/`;
}

function siteEntityId(siteUrl: string, fragment: string): string {
	const root = siteRoot(siteUrl);
	return root ? `${root}#${fragment}` : "";
}

function publisherEntityId(s: GlobalSeoSettings): string {
	return siteEntityId(s.siteUrl, s.publisherType === "person" ? "person" : "organization");
}

// Organization — the publishing entity. Emit site-wide.
export function organizationSchema(s: GlobalSeoSettings): Record<string, unknown> {
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "Organization",
		name: s.orgName || s.siteName,
	};
	const root = siteRoot(s.siteUrl);
	const id = siteEntityId(s.siteUrl, "organization");
	if (id) node["@id"] = id;
	if (root) node.url = root;
	const logo = schemaHttpUrl(s.orgLogo, s.siteUrl);
	if (logo) node.logo = logo;
	const sameAs = (s.sameAs ?? []).filter((u) => isHttpUrl(u));
	if (sameAs.length) node.sameAs = sameAs;
	return node;
}

export function sitePublisherSchema(s: GlobalSeoSettings): Record<string, unknown> {
	if (s.publisherType !== "person") return organizationSchema(s);
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "Person",
		name: s.personName?.trim() || s.siteName,
	};
	const root = siteRoot(s.siteUrl);
	const id = publisherEntityId(s);
	if (id) node["@id"] = id;
	if (root) node.url = root;
	const sameAs = (s.sameAs ?? []).filter((url) => isHttpUrl(url));
	if (sameAs.length) node.sameAs = sameAs;
	return node;
}

/**
 * A publisher that replaces the legacy settings publisher on one page. `graph`
 * is null when the page must not carry it; links then use `inline`.
 */
export interface SchemaIdentityPublisher {
	kind: "identity";
	entityId: string;
	/** The entity ID in every spelling the identity owns. */
	ownedIds: readonly string[];
	/** Owned IDs that custom graphs on this page define while the publisher is left off. */
	definedOnPage: readonly string[];
	/** Bare references that resolve to this publisher. */
	referenceIds: readonly string[];
	graph: Record<string, unknown> | null;
	type: string;
	/** The minimal shape without an ID, for inline links and reference expansion. */
	inline: Record<string, unknown>;
}

/** Omitted: the legacy settings publisher. `none`: no publisher, no publisher links, no expansion. */
export type SchemaPublisherSource = SchemaIdentityPublisher | { kind: "none" };

/** `undefined` keeps the legacy inline shape; `null` omits the link. */
type PublisherFallback = Record<string, unknown> | null | undefined;

function publisherLink(publisherId: string, fallback: Record<string, unknown> | null): Record<string, unknown> | null {
	if (publisherId) return { "@id": publisherId };
	return fallback ? { ...fallback } : null;
}

function inlinePublisher(
	s: GlobalSeoSettings,
	shape: "minimal" | "article" | "full" = "full",
): Record<string, unknown> {
	if (shape !== "full") {
		const publisher: Record<string, unknown> = s.publisherType === "person"
			? { "@type": "Person", name: s.personName?.trim() || s.siteName }
			: { "@type": "Organization", name: s.orgName || s.siteName };
		if (shape === "article" && s.publisherType !== "person") {
			const logo = schemaHttpUrl(s.orgLogo, s.siteUrl);
			if (logo) publisher.logo = { "@type": "ImageObject", url: logo };
		}
		return publisher;
	}
	const { "@context": _context, "@id": _id, ...publisher } = sitePublisherSchema(s);
	return publisher;
}

// WebSite — the site itself. Emit site-wide.
// A publisher id links only to an entity emitted on the same page.
export function webSiteSchema(
	s: GlobalSeoSettings,
	publisherId = publisherEntityId(s),
	fallback?: PublisherFallback,
): Record<string, unknown> {
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "WebSite",
		name: s.siteName,
	};
	const root = siteRoot(s.siteUrl);
	const id = siteEntityId(s.siteUrl, "website");
	if (id) node["@id"] = id;
	if (root) node.url = root;
	if (fallback !== undefined) {
		const publisher = publisherLink(publisherId, fallback);
		if (publisher) node.publisher = publisher;
	} else if (s.orgName || s.personName || s.siteName) {
		node.publisher = publisherId ? { "@id": publisherId } : inlinePublisher(s, "minimal");
	}
	return node;
}

// WebPage. As a content type role it is that type's primary graph. The global
// preset only adds it beside other roles and is off by default because many
// themes already own their primary page entity.
export function webPageSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	websiteId = "",
): Record<string, unknown> | null {
	const canonical = canonicalUrl(page, s);
	const name = str(page.pageTitle ?? page.title).trim();
	if (!canonical || !name) return null;
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "WebPage",
		"@id": `${canonical.split("#", 1)[0]}#webpage`,
		url: canonical,
		name,
	};
	const description = str(page.description ?? page.seo?.ogDescription ?? "").trim();
	if (description) node.description = description;
	if (websiteId) node.isPartOf = { "@id": websiteId };
	const image = absoluteSchemaUrl(page.image ?? page.seo?.ogImage ?? s.defaultOgImage, s.siteUrl);
	if (image) node.primaryImageOfPage = { "@type": "ImageObject", url: image };
	return node;
}

// BlogPosting — for posts.
// `publisherId` follows the same rule as in webSiteSchema.
export function blogPostingSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	publisherId = publisherEntityId(s),
	webPageId = "",
	fallback?: PublisherFallback,
): Record<string, unknown> {
	const article = page.articleMeta ?? {};
	const canonical = canonicalUrl(page, s);
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "BlogPosting",
		...(canonical && { "@id": `${canonical}#article` }),
		headline: str(page.pageTitle ?? page.title),
		mainEntityOfPage: webPageId ? { "@id": webPageId } : canonical || page.url,
	};
	const desc = str(page.description ?? page.seo?.ogDescription ?? "");
	if (desc) node.description = desc;
	const image = absoluteSchemaUrl(page.image ?? page.seo?.ogImage ?? s.defaultOgImage, s.siteUrl);
	if (image) node.image = image;
	if (article.publishedTime) node.datePublished = str(article.publishedTime);
	if (article.modifiedTime) node.dateModified = str(article.modifiedTime);
	if (article.author) node.author = { "@type": "Person", name: str(article.author) };
	if (fallback !== undefined) {
		const publisher = publisherLink(publisherId, fallback);
		if (publisher) node.publisher = publisher;
	} else if (s.orgName || s.personName || s.siteName) {
		node.publisher = publisherId ? { "@id": publisherId } : inlinePublisher(s, "article");
	}
	return node;
}

// Service — for the services collection.
// Pass `publisherId` only when that publisher node is emitted on the same page.
export function serviceSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	publisherId = "",
	fallback?: PublisherFallback,
): Record<string, unknown> {
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "Service",
		name: str(page.pageTitle ?? page.title),
	};
	const desc = str(page.description ?? page.seo?.ogDescription ?? "");
	if (desc) node.description = desc;
	const url = canonicalUrl(page, s);
	if (url) {
		node.url = url;
		node["@id"] = `${url.split("#", 1)[0]}#service`;
	}
	if (fallback !== undefined) {
		const provider = publisherLink(publisherId, fallback);
		if (provider) node.provider = provider;
	} else if (publisherId) {
		node.provider = { "@id": publisherId };
	} else if (s.orgName || s.personName || s.siteName) {
		node.provider = inlinePublisher(s, "minimal");
	}
	return node;
}

// BreadcrumbList — built from page.breadcrumbs. Returns null when there is nothing
// meaningful to emit (no breadcrumbs).
export function breadcrumbListSchema(page: PublicPageContext): Record<string, unknown> | null {
	const crumbs = page.breadcrumbs ?? [];
	if (!Array.isArray(crumbs) || crumbs.length === 0) return null;
	return {
		"@context": SCHEMA_CONTEXT,
		"@type": "BreadcrumbList",
		itemListElement: crumbs.map((c, i) => ({
			"@type": "ListItem",
			position: i + 1,
			name: str(c.name),
			item: str(c.url),
		})),
	};
}

// Person — requires a real name. Structured author/person data is preferred;
// articleMeta.author is a conservative fallback for existing posts.
export function personSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	data?: unknown,
): Record<string, unknown> | null {
	const root = dataRecord(data) ?? {};
	const source = structuredRecord(root, ["person", "author"]);
	const rawAuthor = structuredDataRoot(root).author ?? root.author;
	const name = firstText(source, ["name", "title"]) || dataText(rawAuthor) || str(page.articleMeta?.author).trim();
	if (!name) return null;
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "Person",
		name,
	};
	const id = pageEntityId(page, s, "person");
	if (id) node["@id"] = id;
	const url = absoluteSchemaUrl(source?.url, s.siteUrl);
	if (url) node.url = url;
	const image = absoluteSchemaUrl(source?.image ?? source?.photo, s.siteUrl);
	if (image) node.image = image;
	const jobTitle = firstText(source, ["jobTitle", "role", "position"]);
	if (jobTitle) node.jobTitle = jobTitle;
	const sameAs = stringList(source?.sameAs ?? source?.socialProfiles)
		.map((item) => absoluteSchemaUrl(item, s.siteUrl))
		.filter(Boolean);
	if (sameAs.length) node.sameAs = [...new Set(sameAs)];
	return node;
}

function faqAnswer(value: unknown): string {
	if (typeof value === "string") return value.trim();
	const record = dataRecord(value);
	return firstText(record, ["text", "answer", "content", "description"]);
}

// FAQPage remains valid schema.org vocabulary, but the UI deliberately avoids
// promising a Google rich result because eligibility is now highly restricted.
export function faqPageSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	data?: unknown,
): Record<string, unknown> | null {
	const root = dataRecord(data) ?? {};
	const source = structuredRecord(root, ["faqPage", "faq"]);
	const candidates = firstArray(source, ["items", "questions", "mainEntity"]);
	const items = candidates.length
		? candidates
		: structuredArray(root, ["faqItems", "faqs", "faq", "questions"]);
	const canonical = canonicalUrl(page, s);
	const mainEntity = items.flatMap((item, index) => {
		const record = dataRecord(item);
		if (!record) return [];
		const name = firstText(record, ["question", "name", "title"]);
		const answer = faqAnswer(record.answer ?? record.acceptedAnswer ?? record.text ?? record.content);
		if (!name || !answer) return [];
		return [{
			"@type": "Question",
			...(canonical ? { "@id": `${canonical.split("#", 1)[0]}#faq-question-${index + 1}` } : {}),
			name,
			acceptedAnswer: { "@type": "Answer", text: answer },
		}];
	});
	if (!mainEntity.length) return null;
	return {
		"@context": SCHEMA_CONTEXT,
		"@type": "FAQPage",
		...(canonical ? { "@id": `${canonical.split("#", 1)[0]}#faq` } : {}),
		mainEntity,
	};
}

// LocalBusiness — only emits when a complete physical PostalAddress is present.
export function localBusinessSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	data?: unknown,
): Record<string, unknown> | null {
	const source = structuredRecord(data, ["localBusiness", "business"]);
	if (!source) return null;
	const name = firstText(source, ["name", "title"]);
	const address = postalAddress(source.address ?? source.postalAddress);
	if (!name || !address) return null;
	const subtype = schemaTypeToken(source.type ?? source.subtype);
	const type = subtype && subtype !== "LocalBusiness" ? ["LocalBusiness", subtype] : "LocalBusiness";
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": type,
		name,
		address,
	};
	const id = pageEntityId(page, s, "local-business") || siteEntityId(s.siteUrl, "local-business");
	if (id) node["@id"] = id;
	const url = absoluteSchemaUrl(source.url ?? page.canonical ?? page.url, s.siteUrl);
	if (url) node.url = url;
	const image = absoluteSchemaUrl(source.image ?? source.logo, s.siteUrl);
	if (image) node.image = image;
	const telephone = firstText(source, ["telephone", "phone"]);
	if (telephone) node.telephone = telephone;
	const priceRange = firstText(source, ["priceRange"]);
	if (priceRange) node.priceRange = priceRange;
	const openingHours = stringList(source.openingHours);
	if (openingHours.length) node.openingHours = openingHours;
	return node;
}

// Product — a complete Offer is required so an enabled preset cannot publish a
// misleading or structurally incomplete commerce entity.
export function productSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	data?: unknown,
): Record<string, unknown> | null {
	const root = dataRecord(data) ?? {};
	const source = structuredRecord(root, ["product"])
		?? (page.content?.collection === "products" ? root : null);
	if (!source) return null;
	const name = firstText(source, ["name", "title"]);
	const image = mediaUrl(source.image ?? source.images ?? source.featuredImage, s.siteUrl);
	const offer = firstRecord(source, ["offers", "offer"]) ?? source;
	const price = firstText(offer, ["price"]);
	const currency = firstText(offer, ["priceCurrency", "currency"]).toUpperCase();
	if (!name || !image || !price || !/^[A-Z]{3}$/.test(currency)) return null;
	const offers: Record<string, unknown> = {
		"@type": "Offer",
		price,
		priceCurrency: currency,
	};
	const availability = schemaUrl(offer.availability);
	if (availability) offers.availability = availability;
	const offerUrl = absoluteSchemaUrl(offer.url ?? source.url ?? page.canonical ?? page.url, s.siteUrl);
	if (offerUrl) offers.url = offerUrl;
	const validThrough = validDate(offer.priceValidUntil);
	if (validThrough) offers.priceValidUntil = validThrough;
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "Product",
		name,
		image,
		offers,
	};
	const id = pageEntityId(page, s, "product");
	if (id) node["@id"] = id;
	const description = firstText(source, ["description", "summary", "excerpt"]);
	if (description) node.description = description;
	const sku = firstText(source, ["sku", "productId"]);
	if (sku) node.sku = sku;
	const brandValue = source.brand;
	const brandRecord = dataRecord(brandValue);
	const brand = brandRecord ? firstText(brandRecord, ["name"]) : dataText(brandValue);
	if (brand) node.brand = { "@type": "Brand", name: brand };
	return node;
}

// Event — physical events only for now. Requiring venue and complete address
// keeps the output inside the well-supported rich-result subset.
export function eventSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	data?: unknown,
): Record<string, unknown> | null {
	const root = dataRecord(data) ?? {};
	const source = structuredRecord(root, ["event"])
		?? (page.content?.collection === "events" ? root : null);
	if (!source) return null;
	const name = firstText(source, ["name", "title"]);
	const startDate = validDate(source.startDate ?? source.start_date);
	const location = firstRecord(source, ["location", "venue"]);
	const locationName = firstText(location, ["name", "title"]);
	const address = postalAddress(location?.address ?? source.address);
	if (!name || !startDate || !locationName || !address) return null;
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "Event",
		name,
		startDate,
		location: {
			"@type": "Place",
			name: locationName,
			address,
		},
	};
	const id = pageEntityId(page, s, "event");
	if (id) node["@id"] = id;
	const endDate = validDate(source.endDate ?? source.end_date);
	if (endDate) node.endDate = endDate;
	const description = firstText(source, ["description", "summary", "excerpt"]);
	if (description) node.description = description;
	const image = mediaUrl(source.image ?? source.images ?? source.featuredImage, s.siteUrl);
	if (image) node.image = image;
	const url = absoluteSchemaUrl(source.url ?? page.canonical ?? page.url, s.siteUrl);
	if (url) node.url = url;
	const status = schemaUrl(source.eventStatus ?? source.status);
	if (status) node.eventStatus = status;
	return node;
}

// VideoObject — requires the fields needed for a trustworthy searchable video
// entity plus at least one playable or embeddable URL.
export function videoObjectSchema(
	page: PublicPageContext,
	s: GlobalSeoSettings,
	data?: unknown,
): Record<string, unknown> | null {
	const root = dataRecord(data) ?? {};
	const source = structuredRecord(root, ["videoObject", "video"])
		?? (page.content?.collection === "videos" ? root : null);
	if (!source) return null;
	const name = firstText(source, ["name", "title"]);
	const thumbnailUrl = mediaUrl(source.thumbnailUrl ?? source.thumbnail ?? source.image, s.siteUrl);
	const uploadDate = validDate(source.uploadDate ?? source.publishedAt ?? source.published_at);
	const contentUrl = absoluteSchemaUrl(source.contentUrl ?? source.videoUrl ?? source.url, s.siteUrl);
	const embedUrl = absoluteSchemaUrl(source.embedUrl ?? source.embed_url, s.siteUrl);
	if (!name || !thumbnailUrl || !uploadDate || (!contentUrl && !embedUrl)) return null;
	const node: Record<string, unknown> = {
		"@context": SCHEMA_CONTEXT,
		"@type": "VideoObject",
		name,
		thumbnailUrl,
		uploadDate,
		...(contentUrl ? { contentUrl } : {}),
		...(embedUrl ? { embedUrl } : {}),
	};
	const id = pageEntityId(page, s, "video");
	if (id) node["@id"] = id;
	const description = firstText(source, ["description", "summary", "excerpt"]);
	if (description) node.description = description;
	const duration = firstText(source, ["duration"]);
	if (duration) node.duration = duration;
	return node;
}

export function buildSchemaPresetGraphs(input: {
	page: PublicPageContext;
	settings: GlobalSeoSettings;
	presets: SchemaPresetValues;
	data?: unknown;
	/** Presets the caller will not emit on this page. They are still built, but nothing links to them. */
	disabledPresets?: Iterable<string>;
	/** Saved content type roles; collections without an entry use the defaults. */
	contentTypeRoles?: SchemaContentTypeRoles | typeof INVALID_SCHEMA_CONTENT_TYPE_ROLES;
	/** Omitted: the legacy settings publisher, unchanged. */
	publisher?: SchemaPublisherSource;
}): BuiltSchemaPreset[] {
	const { page, settings, presets, data } = input;
	const disabled = new Set(input.disabledPresets ?? []);
	const collection = page.content?.collection;
	const rolesUnreadable = input.contentTypeRoles === INVALID_SCHEMA_CONTENT_TYPE_ROLES;
	const role = !page.content
		? "none"
		: rolesUnreadable
			? null
			: schemaContentTypeRole(collection, input.contentTypeRoles as SchemaContentTypeRoles | undefined);
	const built: BuiltSchemaPreset[] = [];
	const add = (
		key: SchemaPresetKey,
		type: string,
		contributionId: string,
		graph: Record<string, unknown> | null,
	) => {
		if (presets[key] && graph) built.push({ key, type, contributionId, graph });
	};

	const source = input.publisher;
	let publisherId: string;
	let fallback: PublisherFallback;
	if (!source) {
		const publisher = sitePublisherSchema(settings);
		const publisherType = settings.publisherType === "person" ? "Person" : "Organization";
		add("organization", publisherType, "preset:organization", publisher);
		publisherId = presets.organization && !disabled.has("organization") ? dataText(publisher["@id"]) : "";
	} else if (source.kind === "none") {
		publisherId = "";
		fallback = null;
	} else {
		add("organization", source.type, "preset:organization", source.graph);
		publisherId = presets.organization && !disabled.has("organization") && source.graph ? source.entityId : "";
		fallback = source.inline;
	}
	// On content pages the role, not the theme's pageType, decides which graph
	// claims "primary". EmDash defaults content pages to "article" and fills an
	// unclaimed "primary" with its own BlogPosting, so WebSite must claim it for
	// every other role.
	const article = page.content ? role === "blogPosting" : page.pageType === "article";
	const website = article || role === null ? null : webSiteSchema(settings, publisherId, fallback);
	const websiteId = presets.website && !disabled.has("website") ? dataText(website?.["@id"]) : "";
	const webPage = webPageSchema(page, settings, websiteId);
	// A WebPage role owns "primary" without the global switch. WebSite moves to
	// its own ID only while that WebPage is emitted; otherwise it keeps
	// "primary" so EmDash cannot fill the slot with a BlogPosting.
	const webPagePrimary = role === "webPage" && webPage !== null && !disabled.has("webPage");
	add("website", "WebSite", webPagePrimary ? "preset:website" : "primary", website);
	if (role === "webPage") {
		if (webPage) {
			built.push({
				key: "webPage",
				type: "WebPage",
				contributionId: webPagePrimary ? "primary" : "preset:webPage",
				graph: webPage,
			});
		}
	} else {
		add("webPage", "WebPage", "preset:webPage", webPage);
	}
	const webPageId = presets.webPage && !disabled.has("webPage") ? dataText(webPage?.["@id"]) : "";
	if (role === "blogPosting") {
		add("blogPosting", "BlogPosting", "primary", blogPostingSchema(page, settings, publisherId, webPageId, fallback));
	}
	if (role === "service") {
		add("service", "Service", "preset:service", serviceSchema(page, settings, publisherId, fallback));
	}
	add("breadcrumbList", "BreadcrumbList", "preset:breadcrumbList", breadcrumbListSchema(page));
	add("person", "Person", "preset:person", personSchema(page, settings, data));
	add("faqPage", "FAQPage", "preset:faqPage", faqPageSchema(page, settings, data));
	add("localBusiness", "LocalBusiness", "preset:localBusiness", localBusinessSchema(page, settings, data));
	add("product", "Product", "preset:product", productSchema(page, settings, data));
	add("event", "Event", "preset:event", eventSchema(page, settings, data));
	add("videoObject", "VideoObject", "preset:videoObject", videoObjectSchema(page, settings, data));
	return built;
}

// Return identities for entity DEFINITIONS only. A bare {"@id":"..."}
// reference intentionally does not claim ownership of that identity.
export function schemaDefinitionIdentities(value: unknown): string[] {
	const identities: string[] = [];
	const seen = new WeakSet<object>();
	const visit = (item: unknown, depth: number) => {
		if (depth > 48 || item === null || typeof item !== "object") return;
		if (seen.has(item)) return;
		seen.add(item);
		if (Array.isArray(item)) {
			for (const child of item) visit(child, depth + 1);
			return;
		}
		const node = item as Record<string, unknown>;
		const id = dataText(node["@id"]);
		const definingKeys = Object.keys(node).filter((key) => key !== "@id" && key !== "@context");
		if (id && definingKeys.length) identities.push(id);
		for (const child of Object.values(node)) visit(child, depth + 1);
	};
	visit(value, 0);
	return identities;
}

export function duplicateSchemaDefinitionIds(value: unknown): string[] {
	const counts = new Map<string, number>();
	for (const id of schemaDefinitionIdentities(value)) counts.set(id, (counts.get(id) ?? 0) + 1);
	return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

// A bare site-publisher reference must resolve even if the preset is off.
// Legacy Organization links follow a switch to Person unless the custom graph
// defines that Organization itself.
export function resolveSchemaOrganizationReferences<T>(
	graph: T,
	settings: GlobalSeoSettings,
	publisherEmitted: boolean,
	publisher?: SchemaPublisherSource,
): T {
	if (publisher?.kind === "none") return graph;
	if (publisher) return resolveIdentityReferences(graph, publisher, publisherEmitted);
	const root = siteRoot(settings.siteUrl);
	if (!root) return graph;
	const canonicalId = publisherEntityId(settings);
	const legacyOrganizationId = `${root}#organization`;
	const referenceIds = new Set([
		canonicalId,
		`${root.slice(0, -1)}#${settings.publisherType === "person" ? "person" : "organization"}`,
		`${root}/#${settings.publisherType === "person" ? "person" : "organization"}`,
		legacyOrganizationId,
		`${root.slice(0, -1)}#organization`,
		`${root}/#organization`,
	]);
	const definitions = new Set(schemaDefinitionIdentities(graph));
	const publisherAvailable = publisherEmitted || definitions.has(canonicalId);
	const inline = inlinePublisher(settings);
	const visit = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(visit);
		if (!value || typeof value !== "object") return value;
		const node = value as Record<string, unknown>;
		const referenceId = dataText(node["@id"]);
		if (Object.keys(node).length === 1 && referenceIds.has(referenceId)) {
			if (definitions.has(referenceId)) return { "@id": referenceId };
			return publisherAvailable ? { "@id": canonicalId } : { ...inline };
		}
		return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, visit(child)]));
	};
	return visit(graph) as T;
}

// Definitions outside `@context`; term mappings there are not entities.
function graphDefinitionIds(graph: unknown): Set<string> {
	const ids = new Set<string>();
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!value || typeof value !== "object") return;
		const node = value as Record<string, unknown>;
		const id = dataText(node["@id"]);
		if (id && Object.keys(node).some((key) => key !== "@id" && key !== "@context")) ids.add(id);
		for (const [key, child] of Object.entries(node)) {
			if (key !== "@context") visit(child);
		}
	};
	visit(graph);
	return ids;
}

// While a business identity is active, its owned IDs (and, for an adopted
// Person, the legacy Organization forms) resolve to it; a graph that defines
// one of those IDs itself keeps its own reference. `@context` is copied
// verbatim: a term mapped to an owned ID is vocabulary, not a reference.
function resolveIdentityReferences<T>(graph: T, publisher: SchemaIdentityPublisher, publisherEmitted: boolean): T {
	const referenceIds = new Set(publisher.referenceIds);
	const definitions = graphDefinitionIds(graph);
	// When the publisher is left off a page because a custom graph defines it,
	// references keep pointing at that definition instead of being expanded.
	const defined = publisher.ownedIds.find((id) => definitions.has(id)) ?? publisher.definedOnPage[0];
	const visit = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(visit);
		if (!value || typeof value !== "object") return value;
		const node = value as Record<string, unknown>;
		const referenceId = dataText(node["@id"]);
		if (Object.keys(node).length === 1 && referenceIds.has(referenceId)) {
			if (definitions.has(referenceId)) return { "@id": referenceId };
			if (publisherEmitted) return { "@id": publisher.entityId };
			return defined ? { "@id": defined } : { ...publisher.inline };
		}
		return Object.fromEntries(
			Object.entries(node).map(([key, child]) => [key, key === "@context" ? child : visit(child)]),
		);
	};
	return visit(graph) as T;
}

// ---------------------------------------------------------------------------
// Small shared utilities
// ---------------------------------------------------------------------------

// Only http/https URLs are valid for canonical/link contributions (host requirement).
export function isHttpUrl(value: unknown): boolean {
	if (typeof value !== "string" || value === "") return false;
	try {
		const u = new URL(value);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
}

// Split a multiline textarea (one value per line) into a trimmed, non-empty list.
export function splitLines(raw: unknown): string[] {
	if (typeof raw !== "string") return [];
	return raw
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l !== "");
}
