export interface CustomVerificationTag {
	name: string;
	content: string;
}

const MAX_TAGS = 10;
const MAX_NAME_LENGTH = 128;
const MAX_CODE_POINTS = 1024;
const MAX_JSON_BYTES = 8192;
const encoder = new TextEncoder();
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/;
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\u2800]/u;
const NON_SPACE_WHITESPACE = /[^\S ]/u;
const RESERVED_NAMES = new Set([
	"google-site-verification", "msvalidate.01", "verify-v1",
	"title", "description", "keywords", "author", "creator", "publisher",
	"application-name", "generator", "referrer", "viewport", "theme-color", "color-scheme",
	"copyright", "abstract", "subject", "topic", "category", "classification",
	"coverage", "distribution", "rating", "revisit-after", "language", "resource-type",
	"doc-type", "doc-class", "doc-rights", "target", "handheldfriendly", "mobileoptimized",
	"format-detection", "mobile-web-app-capable", "icbm",
	"robots", "google", "googlebot", "googlebot-news", "bingbot", "msnbot",
	"slurp", "duckduckbot", "baiduspider", "yandex", "yandexbot", "seznambot",
	"teoma", "ia_archiver", "mediapartners-google", "adsbot-google",
	"no-email-collection", "nocrwl",
	"charset", "http-equiv", "content-type", "content-language", "content-style-type",
	"content-script-type", "content-security-policy", "content-security-policy-report-only",
	"permissions-policy", "refresh", "set-cookie", "cache-control", "expires", "pragma",
	"last-modified", "reply-to", "x-ua-compatible", "x-dns-prefetch-control",
	"nonce", "csp-nonce", "csrf-token", "csrf-param", "x-csrf-token",
	"og", "twitter", "fb",
]);
const RESERVED_PREFIXES = [
	"og:", "twitter:", "fb:", "article:", "book:", "music:", "profile:", "video:", "al:",
	"dc.", "dcterms.", "citation_", "geo.", "apple-", "msapplication-",
];

function isReservedName(name: string): boolean {
	return RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
		/(?:bot|crawler|spider)(?:$|[-_.:])/.test(name) || /^robots[-_.:]/.test(name);
}

function invalidCharacters(value: string): boolean {
	return CONTROL_OR_INVISIBLE.test(value) || NON_SPACE_WHITESPACE.test(value) || /[<>]/.test(value);
}

export function validateCustomVerificationTags(input: unknown):
	{ success: true; tags: CustomVerificationTag[] } | { success: false; error: string } {
	if (!Array.isArray(input)) return { success: false, error: "Custom verification tags must be an array." };
	if (input.length > MAX_TAGS) return { success: false, error: "Add no more than 10 custom verification tags." };
	const tags: CustomVerificationTag[] = [];
	const names = new Set<string>();
	for (const [index, row] of input.entries()) {
		const prefix = "Tag " + (index + 1) + ": ";
		if (!row || typeof row !== "object" || Array.isArray(row) ||
			Reflect.ownKeys(row).length !== 2 || !Object.hasOwn(row, "name") || !Object.hasOwn(row, "content") ||
			typeof row.name !== "string" || typeof row.content !== "string")
			return { success: false, error: prefix + "provide only a name and verification code." };
		if (invalidCharacters(row.name))
			return { success: false, error: prefix + "the name contains unsupported characters." };
		const rawName = row.name.trim();
		if (!rawName || rawName.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(rawName))
			return { success: false, error: prefix + "use a name starting with a letter and up to 128 ASCII letters, numbers, dots, underscores, colons or hyphens." };
		const name = rawName.toLowerCase();
		if (isReservedName(name))
			return { success: false, error: prefix + "this name belongs to an existing verification, indexing or page metadata control." };
		if (names.has(name)) return { success: false, error: prefix + "each verification tag name must be unique." };
		if (invalidCharacters(row.content))
			return { success: false, error: prefix + "the code contains markup, control or invisible characters." };
		const content = row.content.trim();
		if (!content || /\s/u.test(content))
			return { success: false, error: prefix + "enter a nonempty verification code without internal whitespace." };
		let codePoints = 0;
		for (const _character of content) {
			if (++codePoints > MAX_CODE_POINTS)
				return { success: false, error: prefix + "the verification code exceeds 1024 Unicode characters." };
		}
		names.add(name);
		tags.push({ name, content });
	}
	if (encoder.encode(JSON.stringify(tags)).byteLength > MAX_JSON_BYTES)
		return { success: false, error: "Custom verification tags exceed the 8192-byte storage limit." };
	return { success: true, tags };
}

/** Only canonical stored rows may contribute to the public head. */
export function isStoredCustomVerificationTags(input: unknown): input is CustomVerificationTag[] {
	const result = validateCustomVerificationTags(input);
	return result.success && Array.isArray(input) && result.tags.every((tag, index) =>
		tag.name === input[index].name && tag.content === input[index].content);
}

export function customVerificationContributions(input: unknown): { kind: "meta"; name: string; content: string }[] {
	return isStoredCustomVerificationTags(input)
		? input.map((tag) => ({ kind: "meta", name: tag.name, content: tag.content }))
		: [];
}
