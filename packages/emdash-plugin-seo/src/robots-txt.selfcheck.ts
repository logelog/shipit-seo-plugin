import assert from "node:assert/strict";

import {
	ROBOTS_TXT_CORE_FALLBACK_BODY,
	ROBOTS_TXT_MAX_CODE_POINTS,
	classifyRobotsObservation,
	effectiveRobotsTxt,
	isPlainHttpOrigin,
	robotsConfiguredOrigin,
	robotsSitemapBase,
	robotsTxtCodePoints,
	robotsTxtTooLong,
	type RobotsSitemapBase,
} from "./robots-txt.ts";

const base = "https://example.com";

// Default body, byte for byte as EmDash 1.1.0 builds it.
const defaults = effectiveRobotsTxt(undefined, base);
assert.equal(defaults.kind, "default");
assert.equal(
	defaults.body,
	"User-agent: *\nAllow: /\n\n# Disallow admin and API routes\nDisallow: /_emdash/\n\nSitemap: https://example.com/sitemap.xml\n",
);
assert.equal(effectiveRobotsTxt("", base).body, defaults.body, "an empty string restores the default");
assert.equal(effectiveRobotsTxt(null, base).kind, "default");

// Custom text: trailing whitespace trimmed, blank line, directive, final newline.
const custom = effectiveRobotsTxt("User-agent: *\nDisallow: /private/  \n\n\t", base);
assert.equal(custom.kind, "custom-with-sitemap");
assert.equal(custom.body, "User-agent: *\nDisallow: /private/\n\nSitemap: https://example.com/sitemap.xml\n");
assert.equal(custom.stored + custom.added, custom.body);
assert.equal(effectiveRobotsTxt("  User-agent: *", base).body.startsWith("  User-agent: *\n\n"), true, "leading whitespace is kept");

// Whitespace-only text is custom: no admin exclusion, two newlines and the directive.
const whitespace = effectiveRobotsTxt(" \n\t ", base);
assert.equal(whitespace.kind, "custom-with-sitemap");
assert.equal(whitespace.body, "\n\nSitemap: https://example.com/sitemap.xml\n");

// Any `sitemap:` substring, in any case and even inside a comment, keeps the text verbatim.
for (const text of ["Sitemap: https://cdn.example.net/map.xml", "# see SITEMAP: later  \n", "User-agent: *\n#sitemap:none"]) {
	const verbatim = effectiveRobotsTxt(text, base);
	assert.equal(verbatim.kind, "custom-verbatim");
	assert.equal(verbatim.body, text, "verbatim text keeps its whitespace");
	assert.equal(verbatim.added, "");
}
assert.equal(effectiveRobotsTxt("Site map: x", base).kind, "custom-with-sitemap", "only the literal substring counts");
assert.equal(effectiveRobotsTxt("sitemap :x", base).kind, "custom-with-sitemap");
// CRLF text is served as stored; only trailing whitespace is trimmed before the directive.
assert.equal(effectiveRobotsTxt("User-agent: *\r\nAllow: /\r\n", base).body, "User-agent: *\r\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n");

// Origin precedence: settings.url literally (one trailing slash removed, path kept),
// then config.siteUrl, then EMDASH_SITE_URL || SITE_URL origin, then the request.
const request = "http://127.0.0.1:4362";
assert.deepEqual(robotsSitemapBase({ settingsUrl: "https://www.example.com/blog/", configuredOrigin: null, requestOrigin: request }),
	{ base: "https://www.example.com/blog", source: "site-settings" });
assert.deepEqual(robotsSitemapBase({ settingsUrl: "https://example.com//", configuredOrigin: null, requestOrigin: request }),
	{ base: "https://example.com/", source: "site-settings" }, "only one trailing slash is removed");
assert.deepEqual(robotsSitemapBase({ settingsUrl: "", configuredOrigin: { origin: "https://cms.example.org", source: "emdash-config" }, requestOrigin: request }),
	{ base: "https://cms.example.org", source: "emdash-config" });
assert.deepEqual(robotsSitemapBase({ settingsUrl: null, configuredOrigin: null, requestOrigin: `${request}/` }),
	{ base: request, source: "request" });
assert.deepEqual(robotsConfiguredOrigin("https://a.example", { EMDASH_SITE_URL: "https://b.example" }),
	{ origin: "https://a.example", source: "emdash-config" });
assert.deepEqual(robotsConfiguredOrigin(null, { EMDASH_SITE_URL: "https://b.example/path?q", SITE_URL: "https://c.example" }),
	{ origin: "https://b.example", source: "environment" });
assert.deepEqual(robotsConfiguredOrigin(null, { SITE_URL: "https://c.example/x" }), { origin: "https://c.example", source: "environment" });
assert.equal(robotsConfiguredOrigin(null, { EMDASH_SITE_URL: "ftp://b.example", SITE_URL: "https://c.example" }), null,
	"an invalid EMDASH_SITE_URL does not fall through to SITE_URL");
assert.equal(robotsConfiguredOrigin(null, { EMDASH_SITE_URL: "not a url" }), null);
assert.equal(robotsConfiguredOrigin(null, undefined), null);

// The 5,000 limit counts code points like EmDash's validator (zod 4.5.4): a
// surrogate pair once, a lone surrogate as one. The native smoke proves the endpoint.
assert.equal(robotsTxtCodePoints("😀"), 1);
assert.equal(robotsTxtCodePoints("a😀b"), 3);
assert.equal(robotsTxtCodePoints("\uD83D"), 1, "a lone high surrogate");
assert.equal(robotsTxtCodePoints("\uDE00\uD83D"), 2, "a reversed pair is two lone surrogates");
assert.equal(robotsTxtCodePoints("\uD83D\uD83D\uDE00"), 2);
for (const text of ["", "plain", "😀".repeat(7), "x\uD83Dy\uDE00😀"]) {
	assert.equal(robotsTxtCodePoints(text), [...text].length, JSON.stringify(text));
}
const nonBmp = "😀".repeat(ROBOTS_TXT_MAX_CODE_POINTS);
assert.deepEqual([nonBmp.length, robotsTxtTooLong(nonBmp)], [10_000, false], "5,000 emoji fit");
assert.equal(robotsTxtTooLong(`${nonBmp}a`), true);
assert.equal(robotsTxtTooLong("a".repeat(ROBOTS_TXT_MAX_CODE_POINTS)), false);
assert.equal(robotsTxtTooLong("a".repeat(ROBOTS_TXT_MAX_CODE_POINTS + 1)), true);

// Observation compares the full body; the fallback is never a match.
const settingsBase: RobotsSitemapBase = { base, source: "site-settings" };
const requestBase: RobotsSitemapBase = { base: request, source: "request" };
assert.deepEqual(classifyRobotsObservation({ status: 200, body: defaults.body, stored: "", sitemapBase: settingsBase }),
	{ status: "matches" });
assert.deepEqual(classifyRobotsObservation({ status: 200, body: ROBOTS_TXT_CORE_FALLBACK_BODY, stored: "", sitemapBase: settingsBase }),
	{ status: "fallback" });
assert.deepEqual(classifyRobotsObservation({ status: 200, body: defaults.body, stored: "User-agent: *", sitemapBase: settingsBase }),
	{ status: "different" });
assert.deepEqual(classifyRobotsObservation({ status: 404, body: "", stored: "", sitemapBase: settingsBase }),
	{ status: "unavailable", reason: "status" });
assert.deepEqual(classifyRobotsObservation({ status: 200, redirected: true, body: defaults.body, stored: "", sitemapBase: settingsBase }),
	{ status: "unavailable", reason: "redirect" });
// With the request fallback a proxy can change the address. The origin is reported,
// never counted as a match, and only a plain HTTP(S) origin qualifies.
const proxied = effectiveRobotsTxt("User-agent: *", "http://internal:4321").body;
assert.deepEqual(classifyRobotsObservation({ status: 200, body: proxied, stored: "User-agent: *", sitemapBase: requestBase }),
	{ status: "other-origin", observedOrigin: "http://internal:4321" });
assert.deepEqual(classifyRobotsObservation({ status: 200, body: proxied, stored: "User-agent: *", sitemapBase: { base: "https://env.example", source: "environment" } }),
	{ status: "other-origin", observedOrigin: "http://internal:4321" }, "core may keep an environment origin read earlier");
assert.deepEqual(classifyRobotsObservation({ status: 200, body: proxied, stored: "User-agent: *", sitemapBase: { base: "https://cfg.example", source: "emdash-config" } }),
	{ status: "different" });
assert.deepEqual(classifyRobotsObservation({ status: 200, body: proxied, stored: "User-agent: *", sitemapBase: settingsBase }),
	{ status: "different" }, "a configured address must match exactly");
for (const odd of ["https://example.com/blog", "https://user:pw@example.com", "https://example.com/", "javascript:alert(1)", "example.com", ""]) {
	const body = effectiveRobotsTxt("User-agent: *", odd).body;
	assert.deepEqual(classifyRobotsObservation({ status: 200, body, stored: "User-agent: *", sitemapBase: requestBase }),
		{ status: "different" }, `not an origin: ${odd}`);
}
assert.deepEqual(classifyRobotsObservation({ status: 200, body: `${proxied}# extra\n`, stored: "User-agent: *", sitemapBase: requestBase }),
	{ status: "different" });
assert.deepEqual(classifyRobotsObservation({ status: 200, body: "Sitemap: x", stored: "Sitemap: x", sitemapBase: requestBase }),
	{ status: "matches" });
assert.equal(isPlainHttpOrigin("http://127.0.0.1:4362"), true);
assert.equal(isPlainHttpOrigin("http://127.0.0.1:4362/"), false);

// Released 1.3.0 adds this exact core-owned policy before a generated Sitemap.
const trainingRules = [
	"# Disallow AI training",
	"User-agent: *",
	"Content-Signal: search=yes, ai-train=no",
	"Disallow:",
	"",
	"User-agent: Amazonbot",
	"Disallow: /",
	"",
	"User-agent: Applebot-Extended",
	"Disallow: /",
	"",
	"User-agent: Bytespider",
	"Disallow: /",
	"",
	"User-agent: CCBot",
	"Disallow: /",
	"",
	"User-agent: ClaudeBot",
	"Disallow: /",
	"",
	"User-agent: Google-Extended",
	"Disallow: /",
	"",
	"User-agent: GPTBot",
	"Disallow: /",
	"",
	"User-agent: meta-externalagent",
	"Disallow: /",
].join("\n");
const trainingPolicy = { hostVersion: "1.3.0", disallowAiTraining: true };
const trainingDefault = `User-agent: *\nAllow: /\n\n# Disallow admin and API routes\nDisallow: /_emdash/\n\n${trainingRules}\n\nSitemap: ${base}/sitemap.xml\n`;
for (const text of [undefined, null, ""]) {
	const file = effectiveRobotsTxt(text, base, trainingPolicy);
	assert.equal(file.body, trainingDefault, "1.3 default inserts training rules before Sitemap");
	assert.equal(file.kind, "default");
	assert.equal(file.disallowAiTraining, true);
}
for (const text of ["User-agent: *\r\nDisallow: /private/  \n\t", " \n\t ", "\uFEFFAllow: /"]) {
	const file = effectiveRobotsTxt(text, base, trainingPolicy);
	assert.equal(file.body, `${text.trimEnd()}\n\n${trainingRules}\n\nSitemap: ${base}/sitemap.xml\n`);
	assert.equal(file.kind, "custom-with-sitemap");
	assert.equal(file.stored + file.added, file.body, "only the trimmed custom prefix is stored");
}
for (const text of ["Sitemap: https://cdn.example.net/map.xml  \r\n\t", "# see SITEMAP: later  \n", "Allow: /\r\nSitemap: x\r\n"]) {
	const file = effectiveRobotsTxt(text, base, trainingPolicy);
	assert.equal(file.kind, "custom-with-ai-training");
	assert.equal(file.body, `${text.trimEnd()}\n\n${trainingRules}\n`, "existing Sitemap keeps its value; only the trailing whitespace is trimmed");
	assert.equal(file.stored + file.added, file.body);
}
for (const text of [undefined, "", " \n", "Allow: /\r\n", "Sitemap: x  \n"]) {
	assert.equal(effectiveRobotsTxt(text, base, { hostVersion: "1.3.0", disallowAiTraining: false }).body, effectiveRobotsTxt(text, base).body, "1.3 opt-out off preserves the earlier route");
	for (const hostVersion of ["1.1.0", "1.2.0", "1.3.2", "1.4.0", "1.3.0-rc.1", null, undefined]) {
		const file = effectiveRobotsTxt(text, base, { hostVersion, disallowAiTraining: true });
		assert.equal(file.body, effectiveRobotsTxt(text, base).body, `the flag has no effect on ${hostVersion}`);
		assert.equal(file.disallowAiTraining, false);
	}
}
for (const stored of ["", "Allow: /", "Sitemap: https://cdn.example.net/map.xml  \n"]) {
	const body = effectiveRobotsTxt(stored, base, trainingPolicy).body;
	assert.deepEqual(classifyRobotsObservation({ status: 200, body, stored, sitemapBase: settingsBase, ...trainingPolicy }), { status: "matches" });
	assert.deepEqual(classifyRobotsObservation({ status: 200, body: effectiveRobotsTxt(stored, base).body, stored, sitemapBase: settingsBase, ...trainingPolicy }), { status: "different" }, "a response missing the enabled rules is not a match");
	assert.deepEqual(classifyRobotsObservation({ status: 200, body, stored, sitemapBase: settingsBase, hostVersion: "1.3.0", disallowAiTraining: false }), { status: "different" });
}
for (const stored of ["", "Allow: /"]) {
	const body = effectiveRobotsTxt(stored, "http://internal:4321", trainingPolicy).body;
	assert.deepEqual(classifyRobotsObservation({ status: 200, body, stored, sitemapBase: requestBase, ...trainingPolicy }), { status: "other-origin", observedOrigin: "http://internal:4321" });
	assert.deepEqual(classifyRobotsObservation({ status: 200, body: body.replace("ai-train=no", "ai-train=yes"), stored, sitemapBase: requestBase, ...trainingPolicy }), { status: "different" }, "origin estimation never accepts altered AI rules");
}
assert.deepEqual(classifyRobotsObservation({ status: 200, body: ROBOTS_TXT_CORE_FALLBACK_BODY, stored: "", sitemapBase: settingsBase, ...trainingPolicy }), { status: "fallback" });

console.log("robots-txt selfcheck passed");
