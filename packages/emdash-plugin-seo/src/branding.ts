// Site branding shared by the build adapter, the runtime and the admin. It has
// no Node or host imports, so every bundle can read the same rules.

/** The admin menu label and workspace name of an installation without branding. */
export const SEO_DEFAULT_BRAND_NAME = "SHIPIT SEO";
/** Shown in place of branding that cannot be read; never the default name. */
export const SEO_FALLBACK_BRAND_NAME = "SEO";

export const SEO_BRAND_NAME_MAX_LENGTH = 32;
/** Longer names wrap in the workspace heading and may be shortened by the host menu. */
export const SEO_BRAND_NAME_COMFORTABLE_LENGTH = 16;
export const SEO_BRAND_LOGO_MIN_SIDE = 64;
export const SEO_BRAND_LOGO_MAX_SIDE = 2048;

export type SeoBrandLogoType = "image/svg+xml" | "image/png" | "image/webp";

export const SEO_BRAND_LOGO_FORMATS: Readonly<Record<"svg" | "png" | "webp", { type: SeoBrandLogoType; maxBytes: number }>> = {
	svg: { type: "image/svg+xml", maxBytes: 64 * 1024 },
	png: { type: "image/png", maxBytes: 256 * 1024 },
	webp: { type: "image/webp", maxBytes: 256 * 1024 },
};

/** A validated logo file in the site's public directory, addressed with its content hash. */
export interface SeoBrandLogo {
	src: string;
	type: SeoBrandLogoType;
	width: number;
	height: number;
}

/** Branding as the Astro adapter records it in the plugin options. */
export interface SeoInstalledBranding {
	name: string;
	logo: SeoBrandLogo | null;
	logoDark: SeoBrandLogo | null;
}

/** The logo read the admin requests; the name comes from the host's menu label. */
export interface SeoAdminBranding {
	logo: SeoBrandLogo | null;
	logoDark: SeoBrandLogo | null;
}

export type SeoBrandState =
	| { kind: "default" }
	| { kind: "configured"; branding: SeoInstalledBranding }
	| { kind: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** User-perceived characters, so a name of accented or combined letters is measured as it reads. */
export function seoBrandNameLength(value: string): number {
	if (typeof Intl === "object" && typeof Intl.Segmenter === "function") {
		let count = 0;
		for (const _segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) count += 1;
		return count;
	}
	return [...value].length;
}

export function normalizeSeoBrandName(value: string): string {
	return value.normalize("NFC").trim();
}

// C0 and C1 controls, DEL, line and paragraph separators, the byte order mark
// and bidirectional controls, which could reorder the menu or the heading.
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
// The host passes menu labels through its message compiler, which reads braces and backslashes.
const RESERVED_NAME_CHARACTERS = /[{}\\<>]/;

/** Why a normalized name cannot be shown, or null when it can. */
export function seoBrandNameProblem(value: unknown): string | null {
	if (typeof value !== "string") return "must be text";
	if (!value) return "must not be empty";
	if (UNSAFE_NAME_CHARACTERS.test(value)) return "must not contain control, line break or text direction characters";
	if (RESERVED_NAME_CHARACTERS.test(value)) return "must not contain { } \\ < or >";
	if (seoBrandNameLength(value) > SEO_BRAND_NAME_MAX_LENGTH) return `must be at most ${SEO_BRAND_NAME_MAX_LENGTH} characters`;
	return null;
}

/** The logo format a site path names, from its extension. */
export function seoBrandLogoFormat(path: string): keyof typeof SEO_BRAND_LOGO_FORMATS | null {
	const match = /\.(svg|png|webp)$/i.exec(path);
	return match ? match[1]!.toLowerCase() as keyof typeof SEO_BRAND_LOGO_FORMATS : null;
}

/** Why a configured logo path cannot name a file in public/, or null when its form is valid. */
export function seoBrandLogoPathProblem(value: unknown): string | null {
	if (typeof value !== "string" || !value) return "must be a path such as /brand/logo.svg";
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith("//")) return "must be a file in public/, not a remote or data address";
	if (!value.startsWith("/")) return "must start with / and name a file in public/, such as /brand/logo.svg";
	if (!/^[A-Za-z0-9._~/-]+$/.test(value)) return "may contain only letters, digits and . _ ~ / -";
	if (value.slice(1).split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
		return "must not contain empty, . or .. path segments";
	}
	if (!seoBrandLogoFormat(value)) return "must be an .svg, .png or .webp file";
	return null;
}

function validLogo(value: unknown): SeoBrandLogo | null {
	if (!isRecord(value)) return null;
	const keys = Object.keys(value).sort().join(",");
	if (keys !== "height,src,type,width") return null;
	const { src, type, width, height } = value;
	if (typeof src !== "string" || src.length > 1_024) return null;
	const match = /^(\/[A-Za-z0-9._~/-]*)\?v=[0-9a-f]{12}$/.exec(src);
	const format = match ? seoBrandLogoFormat(match[1]!) : null;
	if (!format || SEO_BRAND_LOGO_FORMATS[format].type !== type) return null;
	const side = (candidate: unknown) => Number.isInteger(candidate) &&
		(candidate as number) >= SEO_BRAND_LOGO_MIN_SIDE && (candidate as number) <= SEO_BRAND_LOGO_MAX_SIDE;
	if (!side(width) || !side(height)) return null;
	return { src, type: type as SeoBrandLogoType, width: width as number, height: height as number };
}

/** The serialized logo pair, or null when any part of it does not match what the adapter writes. */
export function validSeoAdminBranding(value: unknown): SeoAdminBranding | null {
	if (!isRecord(value) || Object.keys(value).sort().join(",") !== "logo,logoDark") return null;
	const logo = value.logo === null ? null : validLogo(value.logo);
	const logoDark = value.logoDark === null ? null : validLogo(value.logoDark);
	if ((value.logo !== null && !logo) || (value.logoDark !== null && !logoDark) || (logoDark && !logo)) return null;
	return { logo, logoDark };
}

/** Recorded branding, or null when it does not match what the adapter writes. */
export function validSeoInstalledBranding(value: unknown): SeoInstalledBranding | null {
	if (!isRecord(value) || Object.keys(value).sort().join(",") !== "logo,logoDark,name") return null;
	if (typeof value.name !== "string" || normalizeSeoBrandName(value.name) !== value.name || seoBrandNameProblem(value.name)) return null;
	const logos = validSeoAdminBranding({ logo: value.logo, logoDark: value.logoDark });
	return logos ? { name: value.name, ...logos } : null;
}

/** Absent branding is the default; unreadable branding never falls back to the default name. */
export function seoBrandState(recorded: unknown): SeoBrandState {
	if (recorded === undefined) return { kind: "default" };
	const branding = validSeoInstalledBranding(recorded);
	return branding ? { kind: "configured", branding } : { kind: "invalid" };
}

export function seoBrandMenuLabel(state: SeoBrandState): string {
	return state.kind === "configured" ? state.branding.name
		: state.kind === "invalid" ? SEO_FALLBACK_BRAND_NAME : SEO_DEFAULT_BRAND_NAME;
}
