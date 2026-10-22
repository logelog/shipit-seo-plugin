import assert from "node:assert/strict";
import {
	customVerificationContributions,
	isStoredCustomVerificationTags,
	validateCustomVerificationTags,
} from "./custom-verification-tags.ts";

let cases = 0;
function check(name: string, run: () => void): void {
	run();
	cases += 1;
	console.log("  PASS  " + name);
}
const tag = (name = "service-verification", content = "synthetic-code") => ({ name, content });
function valid(input: unknown) {
	const result = validateCustomVerificationTags(input);
	assert.equal(result.success, true, JSON.stringify(result));
	assert.ok(result.success);
	return result.tags;
}
function invalid(input: unknown): void {
	const result = validateCustomVerificationTags(input);
	assert.equal(result.success, false);
	if (!result.success) assert.ok(result.error.length > 0 && !result.error.includes("synthetic-code"));
	assert.equal(isStoredCustomVerificationTags(input), false);
	assert.deepEqual(customVerificationContributions(input), []);
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

check("empty and absent settings emit no custom contribution", () => {
	assert.deepEqual(valid([]), []);
	assert.equal(isStoredCustomVerificationTags([]), true);
	assert.deepEqual(customVerificationContributions([]), []);
	for (const input of [undefined, null, "", {}, 1, true]) invalid(input);
});

check("input normalization is copied and canonical admission is strict", () => {
	const input = [tag("  Service.Verification_X:ID-2  ", "  synthetic-code  ")];
	const before = structuredClone(input);
	const normalized = valid(input);
	assert.deepEqual(normalized, [tag("service.verification_x:id-2")]);
	assert.deepEqual(input, before);
	assert.equal(isStoredCustomVerificationTags(input), false);
	assert.deepEqual(customVerificationContributions(input), []);
	assert.equal(isStoredCustomVerificationTags(normalized), true);
	assert.deepEqual(customVerificationContributions(normalized), [{ kind: "meta", ...normalized[0] }]);
	assert.equal(isStoredCustomVerificationTags([{ content: "synthetic-code", name: "service-verification" }]), true,
		"JSON object property order is not a normalization difference");
});

check("common third-party verification names remain available", () => {
	const input = ["yandex-verification", "facebook-domain-verification", "p:domain_verify", "ahrefs-site-verification", "norton-safeweb-site-verification"].map((name) => tag(name));
	assert.deepEqual(valid(input), input);
	assert.equal(isStoredCustomVerificationTags(input), true);
});

check("reserved standard and controlled names cannot be case-folded around", () => {
	for (const name of [
		"google-site-verification", "msvalidate.01", "verify-v1", "robots", "googlebot", "googlebot-news",
		"bingbot", "bingbot-news", "msnbot", "slurp", "duckduckbot", "baiduspider", "yandex",
		"oai-searchbot", "applebot-extended", "robots:noindex", "custom-crawler", "custom-spider",
		"description", "title", "keywords", "author", "publisher", "application-name", "generator",
		"viewport", "referrer", "theme-color", "color-scheme", "format-detection", "charset",
		"http-equiv", "content-type", "refresh", "content-security-policy", "set-cookie", "csrf-token",
		"og:title", "twitter:card", "fb:app_id", "article:author", "book:author", "music:duration",
		"profile:first_name", "video:actor", "al:ios:url", "dc.title", "dcterms.subject",
		"citation_title", "geo.position", "apple-mobile-web-app-title", "msapplication-tilecolor",
	]) invalid([tag("  " + name.toUpperCase() + "  ")]);
});

check("duplicates are rejected after name normalization and leave input untouched", () => {
	const input = [tag("Service"), tag(" service ", "second")];
	const before = structuredClone(input);
	invalid(input);
	assert.deepEqual(input, before);
});

check("rows allow only their two own typed fields", () => {
	assert.equal(isStoredCustomVerificationTags([tag()]), true);
	for (const input of [
		[null], [[]], ["row"], [{ name: "service" }], [{ content: "code" }],
		[{ name: 1, content: "code" }], [{ name: "service", content: 1 }],
		[{ ...tag(), property: "og:title" }], [{ ...tag(), "http-equiv": "refresh" }],
		[{ ...tag(), html: "<script>" }], [{ ...tag(), extra: undefined }],
		[Object.assign(Object.create({ name: "service" }), { content: "code" })],
		[{ ...tag(), [Symbol("extra")]: true }],
	]) invalid(input);
});

check("tag count and ASCII name boundaries are enforced", () => {
	const ten = Array.from({ length: 10 }, (_, index) => tag("service-" + index));
	assert.deepEqual(valid(ten), ten);
	invalid([...ten, tag("service-10")]);
	assert.equal(valid([tag("a" + "x".repeat(127))])[0].name.length, 128);
	invalid([tag("a" + "x".repeat(128))]);
	for (const name of ["", " ", "1service", "-service", ".service", "_service", ":service", "service/name", "service name", "service=name", "service@name", "tést", "ｓervice", "Kervice"]) invalid([tag(name)]);
});

check("control, invisible and markup input is refused before trimming", () => {
	const forbidden = ["\u0000", "\u0001", "\u001f", "\u007f", "\u0085", "\t", "\n", "\r", "\u00a0", "\u200b", "\u200d", "\u2028", "\u2029", "\u202e", "\u2066", "\ufeff", "\u034f", "\ufe0f", "\ud800", "\udc00", "\u2800"];
	for (const character of forbidden) {
		invalid([tag("service" + character)]);
		invalid([tag("service", character + "code")]);
		invalid([tag("service", "co" + character + "de")]);
	}
	for (const content of ["", " ", "code value", "<meta>", "code<value", "code>value", "<script>alert(1)</script>"]) invalid([tag("service", content)]);
});

check("code limits count Unicode points instead of UTF-16 units", () => {
	const content = "\u{1f9b7}".repeat(1024);
	assert.equal(content.length, 2048);
	assert.equal(valid([tag("service", content)])[0].content, content);
	invalid([tag("service", content + "x")]);
});

check("canonical serialized UTF-8 limit accepts exactly 8192 bytes", () => {
	const input = Array.from({ length: 8 }, (_, index) => tag("v" + index, "x"));
	let remaining = 8192 - bytes(input);
	for (const row of input) {
		const extra = Math.min(1023, remaining);
		row.content += "x".repeat(extra);
		remaining -= extra;
	}
	assert.equal(remaining, 0);
	assert.equal(bytes(input), 8192);
	assert.deepEqual(valid(input), input);
	const overByte = structuredClone(input);
	overByte.at(-1)!.content = "é" + overByte.at(-1)!.content.slice(1);
	assert.equal(bytes(overByte), 8193);
	invalid(overByte);
});

check("JSON escaping overhead participates in the array byte limit", () => {
	const input = Array.from({ length: 4 }, (_, index) => tag("v" + index, '"'.repeat(1024)));
	assert.ok(input.every((row) => Array.from(row.content).length === 1024));
	assert.ok(bytes(input) > 8192);
	invalid(input);
});

check("typed contributions retain escaping-sensitive code as data", () => {
	const content = "token\"single'quote&equals=slash/back\\slash";
	const input = [tag("service-verification", content)];
	assert.deepEqual(valid(input), input);
	const output = customVerificationContributions(input);
	assert.deepEqual(output, [{ kind: "meta", name: "service-verification", content }]);
	assert.deepEqual(Object.keys(output[0]), ["kind", "name", "content"]);
	assert.notEqual(output[0], input[0]);
	output[0].content = "changed output";
	assert.equal(input[0].content, content);
});

console.log("Custom verification tag self-check passed (" + cases + " cases).");
