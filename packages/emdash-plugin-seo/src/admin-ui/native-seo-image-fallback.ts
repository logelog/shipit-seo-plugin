import type { SeoAdminEntryPreview } from "../admin-contract.ts";

export type NativeSeoImageFallback = NonNullable<SeoAdminEntryPreview["social"]["fallbackImage"]>;

/** What sharing uses once the custom image is cleared; without a server report it names no image. */
export function nativeSeoImageFallbackSentence(fallback: NativeSeoImageFallback | null | undefined): string {
	if (!fallback) return "The inherited image shows after saving.";
	if (!fallback.value) return "After saving, no sharing image is set.";
	const image = fallback.source === "content" ? "the featured image"
		: fallback.source === "site-default" ? "the site sharing image" : "the inherited image";
	return `After saving, sharing uses ${image}.`;
}
