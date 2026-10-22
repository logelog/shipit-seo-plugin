import { extractSeoDocumentText, type SeoDocumentImageInput } from "./document-signals.ts";

export function contentBodyValue(
	data: Record<string, any>,
	definition: { portableTextBodyField: string | null } | null,
): unknown {
	if (Object.prototype.hasOwnProperty.call(data, "content")) return data.content;
	return definition?.portableTextBodyField ? data[definition.portableTextBodyField] : undefined;
}

function safeImageUrl(value: unknown): string | undefined {
	const text = clean(value);
	if (!text) return undefined;
	try {
		const resolved = new URL(text, "https://media.invalid/");
		return resolved.protocol === "http:" || resolved.protocol === "https:" ? text : undefined;
	} catch {
		return undefined;
	}
}

/** Resolve a stored native media value without fetching the asset or its provider. */
function contentImageUrl(value: unknown): string {
	if (typeof value === "string") return safeImageUrl(value) ?? "";
	if (!value || typeof value !== "object" || Array.isArray(value)) return "";
	const record = value as Record<string, unknown>;
	const asset = record.asset && typeof record.asset === "object" && !Array.isArray(record.asset)
		? record.asset as Record<string, unknown>
		: record;
	const direct = safeImageUrl(asset.src) ?? safeImageUrl(asset.url) ?? safeImageUrl(asset.previewUrl);
	if (direct) return direct;
	const provider = clean(asset.provider) ?? clean(record.provider);
	if (provider && provider !== "local") return "";
	const meta = asset.meta && typeof asset.meta === "object" && !Array.isArray(asset.meta)
		? asset.meta as Record<string, unknown>
		: {};
	const key = clean(meta.storageKey) ?? clean(asset.id) ?? clean(asset._ref);
	if (!key) return "";
	// Match EmDash's native file route: keep delimiters inside their path segments.
	const segments = key.split("/");
	const encoded = segments.some((segment) => segment === "" || segment === "." || segment === "..")
		? encodeURIComponent(key)
		: segments.map(encodeURIComponent).join("/");
	return `/_emdash/api/media/file/${encoded}`;
}

export function imageFromContentData(data: Record<string, any>): string {
	const candidates = [data.featured_image, data.featuredImage, data.image, data.logo, data.ogImage];
	for (const candidate of candidates) {
		const url = contentImageUrl(candidate);
		if (url) return url;
	}
	return "";
}

// Article rules apply to any content type mapped to Blog posting, so the
// analyzer also accepts image fields named like cover or hero images.
export function featuredImageFromContentData(data: Record<string, any>): string {
	const known = imageFromContentData(data);
	if (known) return known;
	for (const { value } of contentImageInputs(data)) {
		const url = contentImageUrl(value);
		if (url) return url;
	}
	return "";
}

const IMAGE_FIELD_NAMES = new Set([
	"avatar",
	"coverimage",
	"featuredimage",
	"heroimage",
	"image",
	"images",
	"logo",
	"photo",
	"poster",
	"thumbnail",
	"thumbnailurl",
]);

export function contentImageInputs(data: Record<string, any>): SeoDocumentImageInput[] {
	return Object.entries(data).flatMap(([source, value]) => {
		if (source === "content" || source === "seo") return [];
		const normalizedSource = source.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("en");
		if (!IMAGE_FIELD_NAMES.has(normalizedSource) && !isImageMediaValue(value)) return [];
		return [{ source, value }];
	});
}

function isImageMediaValue(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const media = value as Record<string, unknown>;
	const meta =
		media.meta && typeof media.meta === "object" && !Array.isArray(media.meta)
			? (media.meta as Record<string, unknown>)
			: {};
	const mimeType =
		clean(media.mimeType) ??
		clean(media.contentType) ??
		clean(meta.mimeType) ??
		clean(meta.contentType);
	return Boolean(mimeType?.toLocaleLowerCase("en").startsWith("image/"));
}

function generatedDescriptionExcerpt(value: string): string {
	const characters: string[] = [];
	for (const character of value) {
		if (characters.length === 180) return characters.slice(0, 179).join("") + "\u2026";
		characters.push(character);
	}
	return characters.join("");
}

/**
 * The description excerpt generated from body text, or "" when the entry has
 * a written excerpt, summary or description that takes its place.
 */
export function generatedContentDescription(
	data: Record<string, any>,
	definition: { portableTextBodyField: string | null } | null,
): string {
	if (clean(data.excerpt) || clean(data.summary) || clean(data.description)) return "";
	return generatedDescriptionExcerpt(extractSeoDocumentText(contentBodyValue(data, definition)).replace(/\s+/gu, " ").trim());
}

/**
 * Whether a resolved description was built from the generated excerpt. Text
 * the entry's own SEO fields hold is written, even when it repeats the excerpt.
 */
export function isGeneratedDescription(description: string, source: string | undefined, generated: string): boolean {
	return Boolean(generated) && (source === "content" || source === "template") && description.includes(generated);
}

export function keywordFromContent(data: Record<string, any>, item: any): string | undefined {
	const itemSeo = item?.seo && typeof item.seo === "object" ? item.seo : {};
	const dataSeo = data.seo && typeof data.seo === "object" ? data.seo : {};
	return (
		clean(data.focus_keyword) ??
		clean(data.focusKeyword) ??
		clean(dataSeo.focusKeyword) ??
		clean(itemSeo.focusKeyword)
	);
}

function clean(value: unknown): string | undefined {
	const text = typeof value === "string" ? value.trim() : "";
	return text || undefined;
}
