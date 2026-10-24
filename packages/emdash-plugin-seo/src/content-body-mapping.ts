import { extractSeoDocumentSignals, supportedSeoDocumentNode } from "./document-signals.ts";

/** Paths name saved fields; * visits repeater items in order. No code is evaluated. */
export interface SeoBodyField {
	kind: "text" | "heading" | "richText" | "link" | "image" | "group";
	path: readonly string[];
	level?: number;
	/** Additional text fields joined into this heading. */
	append?: readonly (readonly string[])[];
	href?: readonly string[];
	alt?: readonly string[];
	fields?: readonly SeoBodyField[];
}

export interface SeoBodyBlock {
	type: string;
	version: number;
	when?: { path: readonly string[]; oneOf: readonly string[] };
	/** An empty list explicitly excludes a block the template does not render. */
	fields: readonly SeoBodyField[];
}

export interface SeoBodyMapping {
	collection: string;
	slugs?: readonly string[];
	bodyField: string;
	fields?: readonly SeoBodyField[];
	blocks: readonly SeoBodyBlock[];
}

export interface SeoContentAnalysisOptions {
	mappings: readonly SeoBodyMapping[];
}

export interface SeoBodyPlan {
	version?: 1;
	bodyField: string | null;
	mapping?: SeoBodyMapping;
}

export interface SeoBodyProjection {
	document: unknown;
	incomplete: boolean;
}

const hosts = new WeakMap<object, SeoContentAnalysisOptions>();
const badKeys = new Set(["__proto__", "prototype", "constructor"]);

const record = (v: unknown): v is Record<string, any> =>
	!!v && typeof v === "object" && !Array.isArray(v) &&
	(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) &&
	Object.values(Object.getOwnPropertyDescriptors(v)).every(d => "value" in d);

function jsonData(value: unknown, depth = 0, seen = new Set<object>(), budget = { nodes: 0 }): boolean {
	if (++budget.nodes > 10_000 || depth > 24) return false;
	if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))
		return true;
	if (typeof value === "string") return value.length <= 65_536;
	if (typeof value !== "object" || !value || seen.has(value) || (!Array.isArray(value) && !record(value)))
		return false;
	if (Array.isArray(value) && (value.length > 10_000 || Object.getOwnPropertyNames(value).length !== value.length + 1)) return false;
	seen.add(value);
	for (const d of Object.values(Object.getOwnPropertyDescriptors(value)))
		if (!("value" in d) || !jsonData(d.value, depth + 1, seen, budget)) return false;
	seen.delete(value);
	return true;
}

const key = (v: unknown): v is string =>
	typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(v) && !badKeys.has(v);
const path = (v: unknown): v is string[] =>
	Array.isArray(v) && v.length <= 8 && v.every(x => x === "*" || key(x));
const keys = (v: Record<string, unknown>, allowed: string[]) =>
	Object.keys(v).every(k => allowed.includes(k));

/** Shared by build-time validation and the read-only editor response parser. */
export function validSeoBodyMapping(value: unknown): value is SeoBodyMapping {
	if (!jsonData(value)) return false;
	let count = 0;
	const fields = (v: unknown, depth = 0): boolean => {
		const used = new Set<string>();
		return Array.isArray(v) && v.length <= 128 && depth <= 8 && v.every(f => {
			if (
				++count > 512 || !record(f) ||
				!keys(f, ["kind", "path", "level", "append", "href", "alt", "fields"]) || !path(f.path)
			) return false;
			if (
				!["text", "heading", "richText", "link", "image", "group"].includes(f.kind) ||
				f.kind === "group" && f.path.length === 0
			) return false;
			const selector = f.path.join(".");
			if ([...used].some(p => p === selector || p.startsWith(selector + ".") || selector.startsWith(p + ".")))
				return false;
			used.add(selector);
			// Composite repeated fields need a group so companions belong to that item.
			if ((f.kind === "link" || f.kind === "image" && f.alt || f.append) && f.path.includes("*"))
				return false;
			if (f.kind === "heading" ? !Number.isInteger(f.level) || f.level < 1 || f.level > 6 : f.level !== undefined)
				return false;
			if (
				f.append !== undefined &&
				(f.kind !== "heading" || !Array.isArray(f.append) || f.append.length > 8 ||
					!f.append.every((p: unknown) => path(p) && !p.includes("*")))
			) return false;
			for (const extra of f.append ?? []) {
				const extraSelector = extra.join(".");
				if ([...used].some(p =>
					p === extraSelector || p.startsWith(extraSelector + ".") || extraSelector.startsWith(p + ".")
				)) return false;
				used.add(extraSelector);
			}
			if (f.kind === "link" ? !path(f.href) || f.href.includes("*") : f.href !== undefined) return false;
			if (f.alt !== undefined && (f.kind !== "image" || !path(f.alt) || f.alt.includes("*"))) return false;
			return f.kind === "group" ? fields(f.fields, depth + 1) : f.fields === undefined;
		});
	};
	if (
		!record(value) || !keys(value, ["collection", "slugs", "bodyField", "fields", "blocks"]) ||
		!key(value.collection) || !key(value.bodyField)
	) return false;
	if (
		value.slugs !== undefined &&
		(!Array.isArray(value.slugs) || !value.slugs.length || value.slugs.length > 128 ||
			!value.slugs.every(s => typeof s === "string" && s.length > 0 && s.length <= 256))
	) return false;
	if (
		value.fields !== undefined &&
		(!fields(value.fields) || value.fields.some((f: SeoBodyField) => f.path[0] === value.bodyField))
	) return false;
	return Array.isArray(value.blocks) && value.blocks.length <= 128 && value.blocks.every(b =>
		record(b) && keys(b, ["type", "version", "when", "fields"]) && key(b.type) &&
		Number.isSafeInteger(b.version) && b.version >= 1 &&
		(b.when === undefined || (
			record(b.when) && keys(b.when, ["path", "oneOf"]) && path(b.when.path) &&
			Array.isArray(b.when.oneOf) && b.when.oneOf.length > 0 && b.when.oneOf.length <= 32 &&
			b.when.oneOf.every((s: unknown) => typeof s === "string" && s.length <= 256)
		)) && fields(b.fields));
}

export function checkContentAnalysisOptions(value: unknown): SeoContentAnalysisOptions | undefined {
	if (value === undefined) return undefined;
	if (
		!jsonData(value) || !record(value) || !keys(value, ["mappings"]) ||
		!Array.isArray(value.mappings) || value.mappings.length > 32 ||
		!value.mappings.every(validSeoBodyMapping) || JSON.stringify(value).length > 65_536
	)
		throw new Error("shipitSeo contentAnalysis must contain bounded, explicit saved-body mappings.");
	// Copy configuration so later caller mutations cannot change a running engine.
	const copy = JSON.parse(JSON.stringify(value));
	const freeze = (v: any): any => {
		if (v && typeof v === "object") {
			for (const x of Object.values(v)) freeze(x);
			Object.freeze(v);
		}
		return v;
	};
	return freeze(copy);
}

export function contentAnalysisOptions(ctx: object): SeoContentAnalysisOptions | undefined {
	return hosts.get(ctx);
}

export function copyContentAnalysis(source: object, target: object): void {
	const options = hosts.get(source);
	if (options) hosts.set(target, options);
}

export function bindContentAnalysis(ctx: object, options: SeoContentAnalysisOptions): void {
	hosts.set(ctx, options);
}

export function contentBodyPlan(ctx: object, collection: string, slug: string, bodyField: string | null): SeoBodyPlan {
	const mappings = hosts.get(ctx)?.mappings ?? [];
	const mapping = mappings.find(m => m.collection === collection && m.slugs?.includes(slug)) ??
		mappings.find(m => m.collection === collection && !m.slugs);
	return mapping ? { version: 1, bodyField: mapping.bodyField, mapping } : { version: 1, bodyField };
}

export function contentAnalysisRevision(options: SeoContentAnalysisOptions | undefined): string {
	if (!options) return "";
	return options.mappings.map(mapping => bodyMappingRevision({ bodyField: mapping.bodyField, mapping })).join("");
}

export function bodyMappingRevision(plan: SeoBodyPlan): string {
	if (!plan.mapping) return "";
	const value = JSON.stringify(plan.mapping);
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193);
	return `:body-mapping-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Project declared visible fields once, without walking arbitrary block properties. */
export function projectContentBody(data: Record<string, unknown>, plan: SeoBodyPlan): SeoBodyProjection {
	const body = plan.mapping
		? data[plan.bodyField!]
		: Object.hasOwn(data, "content")
			? data.content
			: plan.bodyField && Object.hasOwn(data, plan.bodyField) ? data[plan.bodyField] : undefined;
	if (!plan.mapping) return { document: body, incomplete: false };
	const out: unknown[] = [];
	let nodes = 0, chars = 0, incomplete = false;
	const spend = () => {
		if (++nodes > 10_000) throw new Error("body limit");
	};
	const own = (v: unknown, k: string) => record(v) && Object.hasOwn(v, k) ? v[k] : undefined;
	const values = (root: unknown, selector: readonly string[]): unknown[] => {
		let result = [root];
		for (const part of selector) {
			const next: unknown[] = [];
			for (const v of result) {
				spend();
				if (part === "*") {
					if (v == null) continue;
					if (!Array.isArray(v)) {
						incomplete = true;
						continue;
					}
					if (v.length > 2_000) throw new Error("body limit");
					for (const child of v) {
						spend();
						next.push(child);
					}
				} else {
					spend();
					next.push(own(v, part));
				}
			}
			result = next;
		}
		return result;
	};
	const text = (v: unknown): string => {
		if (v == null) return "";
		if (typeof v !== "string") {
			incomplete = true;
			return "";
		}
		chars += v.length;
		if (chars > 262_144) throw new Error("body limit");
		return v;
	};
	const paragraph = (value: string, level?: number, href?: string) => {
		if (!value.trim()) return;
		out.push({
			_type: "block",
			style: level ? `h${level}` : "normal",
			children: [{ _type: "span", text: value, marks: href ? ["body-link"] : [] }],
			markDefs: href ? [{ _key: "body-link", _type: "link", href }] : []
		});
	};
	const checkedTree = (v: unknown, depth = 0, nodePosition = true): unknown => {
		spend();
		if (depth > 32) throw new Error("body limit");
		if (typeof v === "string") {
			text(v);
			if (nodePosition && depth > 0) { incomplete = true; return null; }
			return v;
		}
		if (v == null || typeof v === "boolean" || typeof v === "number") {
			if (nodePosition) incomplete = true;
			return v;
		}
		if (Array.isArray(v)) {
			if (v.length > 2_000) throw new Error("body limit");
			return v.map(x => checkedTree(x, depth + 1, nodePosition)).filter(x => x !== null);
		}
		if (!record(v)) {
			incomplete = true;
			return null;
		}
		if (nodePosition && v._type === "code" && typeof v.code === "string") return null;
		if (nodePosition && !supportedSeoDocumentNode(v)) {
			incomplete = true;
			return null;
		}
		let allowed: readonly string[] | null = null;
		if (nodePosition) {
			if (v._type === "block") {
				allowed = ["_type", "_key", "style", "children", "markDefs", "listItem", "level"];
				if (!Array.isArray(v.children)) incomplete = true;
			} else if (v._type === "span" || v.type === "text") {
				allowed = ["_type", "_key", "type", "text", "marks"];
				if (typeof v.text !== "string") incomplete = true;
			} else if (v._type === "image" || v.type === "image") {
				allowed = ["_type", "_key", "type", "src", "url", "previewUrl", "id", "asset", "attrs", "alt", "altText", "alternativeText"];
			} else if (v._type === "break") {
				allowed = ["_type", "_key"];
			} else if (v._type === "link" || v.type === "link") {
				const primaryChildren = v._type === "link" ? "children" : "content";
				const fallbackChildren = primaryChildren === "children" ? "content" : "children";
				const renderedChildren = Array.isArray(v[primaryChildren]) ? primaryChildren : Array.isArray(v[fallbackChildren]) ? fallbackChildren : null;
				allowed = ["_type", "_key", "type", "href", "attrs", renderedChildren ?? "text"];
			} else if (v.type === "hardBreak" || v.type === "horizontalRule") {
				allowed = ["type", "attrs"];
			} else {
				allowed = ["type", "attrs", "content"];
			}
		}
		const result: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v)) {
			if (allowed && !allowed.includes(k)) continue;
			if (badKeys.has(k)) {
				incomplete = true;
				continue;
			}
			result[k] = checkedTree(x, depth + 1, nodePosition && (k === "children" || k === "content"));
		}
		return result;
	};
	const emit = (root: unknown, fields: readonly SeoBodyField[], depth = 0): void => {
		if (depth > 8) throw new Error("body limit");
		for (const field of fields) for (const value of values(root, field.path)) {
			spend();
			if (field.kind === "group") {
				if (value != null && !record(value)) incomplete = true;
				else if (value != null) emit(value, field.fields!, depth + 1);
			} else if (field.kind === "richText") {
				if (value == null) continue;
				const tree = checkedTree(value);
				const signals = extractSeoDocumentSignals(tree);
				if (signals.bodyFormat === "unsupported" || signals.unsupportedBlockCount > 0) incomplete = true;
				if (Array.isArray(tree)) out.push(...tree);
				else if (record(tree) && tree.type === "doc" && Array.isArray(tree.content)) out.push(...tree.content);
				else if (typeof tree === "string") paragraph(tree);
				else if (tree) out.push(tree);
			} else if (field.kind === "image") {
				const src = text(value);
				const alt = field.alt ? text(values(root, field.alt)[0]) : undefined;
				if (src) out.push({ _type: "image", src, ...(alt === undefined ? {} : { alt }) });
			} else {
				const label = [text(value), ...(field.append ?? []).flatMap(p => values(root, p).map(text))]
					.filter(Boolean).join(" ");
				const href = field.kind === "link" ? text(values(root, field.href!)[0]) : undefined;
				if (field.kind === "link" && Boolean(label) !== Boolean(href)) incomplete = true;
				paragraph(label, field.kind === "heading" ? field.level : undefined, href);
			}
		}
	};
	try {
		emit(data, plan.mapping.fields ?? []);
		const blocks = Array.isArray(body) ? body : record(body) && body.type === "doc" && Array.isArray(body.content) ? body.content : null;
		if (blocks === null) incomplete = true;
		else {
			if (blocks.length > 2_000) throw new Error("body limit");
			for (const block of blocks) {
				spend();
				if (!record(block)) {
					incomplete = true;
					continue;
				}
				const rule = plan.mapping.blocks.find(b =>
					b.type === block._type && b.version === block._version &&
					(!b.when || values(block, b.when.path).some(v => b.when!.oneOf.includes(v as string))));
				if (rule) emit(block, rule.fields);
				else if (block._type === "code" && typeof block.code === "string") { /* Code is not body prose. */ }
				else if (["block", "image", "break"].includes(block._type) || typeof block.type === "string") {
					const tree = checkedTree(block);
					const signals = extractSeoDocumentSignals([tree]);
					if (signals.bodyFormat === "unsupported" || signals.unsupportedBlockCount) incomplete = true;
					out.push(tree);
				} else incomplete = true;
			}
		}
	} catch {
		incomplete = true;
	}
	return { document: out, incomplete };
}
