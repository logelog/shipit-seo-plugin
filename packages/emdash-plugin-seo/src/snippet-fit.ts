import { UNSPACED_SCRIPT } from "./keyword-match.ts";
import { SNIPPET_PREVIEW_PROFILES, fitSnippetPreviewText } from "./snippet-metrics.ts";

export type SeoSnippetField = "title" | "description";
export type SeoSnippetDevice = "mobile" | "desktop";

export const SEO_SNIPPET_DEVICE_LABELS: Readonly<Record<SeoSnippetDevice, string>> = Object.freeze({
	mobile: "phones",
	desktop: "desktop",
});

export const SEO_SNIPPET_ESTIMATE_NOTE =
	"Estimated with preview widths of about 340 px on phones and 540 px on desktop. Real widths vary. The estimate measures the resolved text, including what a metadata template adds, such as the site name in a title; text the theme adds when it renders the page is not included.";

export interface SeoSnippetDeviceFit {
	device: SeoSnippetDevice;
	clipped: boolean;
	/** The text left before the cut, without the ellipsis; the whole value when it fits. */
	visible: string;
}

const DATE_PREFIX_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };

/**
 * The publication date a result shows before the description. The preview, the
 * field estimate and Description fit all take it from here, so their cut points agree.
 */
export function seoSnippetDatePrefix(publishedAt: string | null | undefined, locale?: string | null): string {
	if (!publishedAt) return "";
	const time = Date.parse(publishedAt);
	if (Number.isNaN(time)) return "";
	try {
		return new Intl.DateTimeFormat(locale || "en", DATE_PREFIX_FORMAT).format(new Date(time)) + " \u2014 ";
	} catch {
		return new Intl.DateTimeFormat("en", DATE_PREFIX_FORMAT).format(new Date(time)) + " \u2014 ";
	}
}

/**
 * The editor preview's own fit on phones first, then desktop. The analyzer
 * and the preview share these widths and font metrics, so a row that names a
 * cut point names the one the preview shows. A description prefix shares the
 * description's lines; `visible` never includes it.
 */
export function seoSnippetFit(value: string, field: SeoSnippetField, descriptionPrefix = ""): SeoSnippetDeviceFit[] {
	return (["mobile", "desktop"] as const).map((device) => {
		const fitted = fitSnippetPreviewText(value, SNIPPET_PREVIEW_PROFILES[device][field], field === "description" ? descriptionPrefix : "");
		const visible = fitted.clipped ? fitted.text.replace(/…$/u, "").trimEnd() : fitted.text;
		return { device, clipped: fitted.clipped, visible };
	});
}

/** Text without spaces between words is quoted by its last graphemes, so a cut point never quotes the whole value. */
const UNSPACED_CUT_POINT_GRAPHEMES = 12;

function graphemes(text: string): string[] {
	return typeof Intl.Segmenter === "function"
		? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment)
		: Array.from(text);
}

/** The last few visible words, quoted as the place a result is cut. */
export function seoSnippetCutPoint(visible: string): string {
	const words = visible.split(/\s+/u).filter(Boolean);
	if (!words.length) return "";
	const tail = words.slice(-3).join(" ");
	if (UNSPACED_SCRIPT.test(tail)) {
		const parts = graphemes(tail);
		if (parts.length > UNSPACED_CUT_POINT_GRAPHEMES) return `...${parts.slice(-UNSPACED_CUT_POINT_GRAPHEMES).join("")}`;
	}
	return `...${tail}`;
}
