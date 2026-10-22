// Build-time branding checks. They run only in the site's Astro config process
// and read nothing outside the configured public directory.
import { lstatSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	SEO_BRAND_LOGO_FORMATS,
	SEO_BRAND_LOGO_MAX_SIDE,
	SEO_BRAND_LOGO_MIN_SIDE,
	normalizeSeoBrandName,
	seoBrandLogoFormat,
	seoBrandLogoPathProblem,
	seoBrandNameProblem,
	type SeoBrandLogo,
	type SeoInstalledBranding,
} from "./branding.ts";

/** The `branding` option of `shipitSeo()`. */
export interface ShipitSeoBranding {
	/** Admin menu label and workspace heading, 1 to 32 characters. */
	name: string;
	/** Site path of an .svg, .png or .webp file in `public/`, such as `/brand/logo.svg`. */
	logo?: string;
	/** The same for dark admin themes; requires `logo`. */
	logoDark?: string;
}

/** The third argument of `shipitSeo()`. */
export interface ShipitSeoOptions {
	branding?: ShipitSeoBranding;
}

export interface SeoBrandingShape {
	name: string;
	logo: string | null;
	logoDark: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function shown(value: unknown): string {
	const text = JSON.stringify(value) ?? String(value);
	return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function optionError(option: string, value: unknown, rule: string): Error {
	return new Error(`shipitSeo branding.${option} ${shown(value)}: ${rule}.`);
}

function unknownKeys(value: Record<string, unknown>, known: readonly string[]): string[] {
	return Object.keys(value).filter((key) => !known.includes(key));
}

/** Validates the option shape and the name; null when the site sets no branding. */
export function checkShipitSeoOptions(options: unknown): SeoBrandingShape | null {
	if (options === undefined) return null;
	if (!isPlainObject(options)) {
		throw new Error('shipitSeo options must be an object such as { branding: { name: "Acme SEO" } }.');
	}
	const extra = unknownKeys(options, ["branding"]);
	if (extra.length) throw new Error(`shipitSeo options: unknown option ${shown(extra[0])}. The only option is branding.`);
	const branding = options.branding;
	if (branding === undefined) return null;
	if (!isPlainObject(branding)) {
		throw new Error('shipitSeo branding must be an object such as { name: "Acme SEO", logo: "/brand/logo.svg" }.');
	}
	const extraBranding = unknownKeys(branding, ["name", "logo", "logoDark"]);
	if (extraBranding.length) {
		throw new Error(`shipitSeo branding: unknown option ${shown(extraBranding[0])}. Use name, logo and logoDark.`);
	}
	if (branding.name === undefined) throw new Error("shipitSeo branding.name is required when branding is set.");
	const name = typeof branding.name === "string" ? normalizeSeoBrandName(branding.name) : branding.name;
	const nameProblem = seoBrandNameProblem(name);
	if (nameProblem) throw optionError("name", branding.name, nameProblem);
	const path = (option: "logo" | "logoDark"): string | null => {
		const value = branding[option];
		if (value === undefined) return null;
		const problem = seoBrandLogoPathProblem(value);
		if (problem) throw optionError(option, value, problem);
		return value as string;
	};
	const logo = path("logo");
	const logoDark = path("logoDark");
	if (logoDark !== null && logo === null) throw optionError("logoDark", logoDark, "needs branding.logo as well");
	return { name: name as string, logo, logoDark };
}

interface ImageFacts {
	width: number;
	height: number;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.subarray(start, end));
}

function pngFacts(bytes: Uint8Array): ImageFacts | null {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte) || ascii(bytes, 12, 16) !== "IHDR") return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

function webpFacts(bytes: Uint8Array): ImageFacts | null {
	if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") return null;
	const chunk = ascii(bytes, 12, 16);
	const at = (index: number) => bytes[index]!;
	if (chunk === "VP8 ") {
		if (at(23) !== 0x9d || at(24) !== 0x01 || at(25) !== 0x2a) return null;
		return { width: (at(26) | (at(27) << 8)) & 0x3fff, height: (at(28) | (at(29) << 8)) & 0x3fff };
	}
	if (chunk === "VP8L") {
		if (at(20) !== 0x2f) return null;
		const bits = (at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24)) >>> 0;
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (chunk === "VP8X") {
		return { width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)), height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)) };
	}
	return null;
}

function svgLength(value: string | null): number | null {
	const match = value === null ? null : /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/.exec(value);
	return match ? Number(match[1]) : null;
}

/** Throws the rule an SVG file breaks; it is also served at its public address, where scripts would run. */
function svgFacts(bytes: Uint8Array, fail: (rule: string) => never): ImageFacts {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\ufeff/, "");
	} catch {
		return fail("is not UTF-8 SVG text");
	}
	if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("must not contain a DOCTYPE or ENTITY declaration");
	if (!/^\s*(?:<\?xml\s[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) fail("is not an SVG file; its first element must be <svg>");
	if (/<script[\s>/]/i.test(text)) fail("must not contain scripts");
	if (/<foreignObject[\s>/]/i.test(text)) fail("must not contain foreignObject");
	if (/\son[a-z]+\s*=/i.test(text)) fail("must not contain event handler attributes");
	if (/javascript:/i.test(text)) fail("must not contain javascript: addresses");
	if (/@import/i.test(text)) fail("must not import style sheets");
	const fragment = /^#[A-Za-z_][\w.:-]*$/;
	for (const match of text.matchAll(/\s(?:[A-Za-z_][\w.-]*:)?(?:href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi)) {
		const target = (match[1] ?? match[2] ?? match[3] ?? "").trim();
		if (!fragment.test(target)) fail("must not reference other files or addresses; only #fragment references are allowed");
	}
	for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
		const target = (match[1] ?? match[2] ?? match[3] ?? "").trim();
		if (!fragment.test(target)) fail("must not reference other files or addresses; only #fragment references are allowed");
	}
	const root = /<svg\b([^>]*)>/i.exec(text)?.[1] ?? "";
	const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(root)?.slice(1).find((value) => value !== undefined) ?? null;
	const width = svgLength(attribute("width"));
	const height = svgLength(attribute("height"));
	if (width !== null && height !== null) return { width: Math.round(width), height: Math.round(height) };
	const box = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
	if (box && box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) {
		return { width: Math.round(box[2]!), height: Math.round(box[3]!) };
	}
	return fail("needs width and height in px, or a viewBox, on its <svg> element");
}

function basePrefix(base: unknown, option: string, path: string): string {
	const value = typeof base === "string" && base ? base : "/";
	if (!/^\/[A-Za-z0-9._~/-]*$/.test(value)) {
		throw optionError(option, path, "needs Astro's base path to use only letters, digits and . _ ~ / -");
	}
	return value.replace(/\/+$/, "") + "/";
}

async function contentHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
	return [...digest.subarray(0, 6)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Resolves one logo inside the real public directory without following any link. */
async function inspectLogo(option: "logo" | "logoDark", path: string, publicDir: URL, base: unknown): Promise<SeoBrandLogo> {
	const fail = (rule: string): never => { throw optionError(option, path, rule); };
	const directory = publicDir.href.endsWith("/") ? publicDir : new URL(`${publicDir.href}/`);
	let realRoot: string;
	try {
		realRoot = realpathSync(fileURLToPath(directory));
	} catch {
		return fail("names no file in public/; the public directory does not exist");
	}
	const format = seoBrandLogoFormat(path)!;
	const { type, maxBytes } = SEO_BRAND_LOGO_FORMATS[format];
	const segments = path.slice(1).split("/");
	let file = "";
	let size = 0;
	for (let index = 0; index < segments.length; index += 1) {
		file = fileURLToPath(new URL(segments.slice(0, index + 1).join("/"), directory));
		let entry: Stats | undefined;
		try {
			entry = lstatSync(file, { throwIfNoEntry: false });
		} catch {
			fail("could not be read in public/");
		}
		if (!entry) fail("names no file in public/");
		if (entry!.isSymbolicLink()) fail("must not be or pass through a symbolic link");
		if (index < segments.length - 1 ? !entry!.isDirectory() : !entry!.isFile()) fail("must name a regular file in public/");
		size = entry!.size;
	}
	if (size > maxBytes) fail(`is ${Math.ceil(size / 1024)} KiB; ${format.toUpperCase()} logos may be at most ${maxBytes / 1024} KiB`);
	const separator = process.platform === "win32" ? "\\" : "/";
	let real = "";
	let bytes: Uint8Array<ArrayBuffer> = new Uint8Array();
	try {
		real = realpathSync(file);
		bytes = new Uint8Array(readFileSync(file));
	} catch {
		fail("could not be read in public/");
	}
	if (!real.startsWith(realRoot.endsWith(separator) ? realRoot : realRoot + separator)) fail("resolves outside public/");
	if (bytes.byteLength > maxBytes) fail(`is ${Math.ceil(bytes.byteLength / 1024)} KiB; ${format.toUpperCase()} logos may be at most ${maxBytes / 1024} KiB`);
	const facts = format === "svg" ? svgFacts(bytes, fail) : format === "png" ? pngFacts(bytes) : webpFacts(bytes);
	if (!facts) fail(`is not a ${format.toUpperCase()} file; its bytes do not match the extension`);
	const { width, height } = facts!;
	if ([width, height].some((side) => side < SEO_BRAND_LOGO_MIN_SIDE || side > SEO_BRAND_LOGO_MAX_SIDE)) {
		fail(`must be ${SEO_BRAND_LOGO_MIN_SIDE} to ${SEO_BRAND_LOGO_MAX_SIDE} px on each side (found ${width} x ${height})`);
	}
	return { src: `${basePrefix(base, option, path)}${path.slice(1)}?v=${await contentHash(bytes)}`, type, width, height };
}

/** Checks the logo files against the given public directory and base path. */
export async function resolveSeoBranding(
	shape: SeoBrandingShape,
	config: { publicDir: URL; base?: unknown },
): Promise<SeoInstalledBranding> {
	return {
		name: shape.name,
		logo: shape.logo === null ? null : await inspectLogo("logo", shape.logo, config.publicDir, config.base),
		logoDark: shape.logoDark === null ? null : await inspectLogo("logoDark", shape.logoDark, config.publicDir, config.base),
	};
}
