import assert from "node:assert/strict";

import { contentTypeRoutePattern, createContentTypeRouteMatcher } from "./content-type-noindex-routes.ts";
import { resolveSitemapRoute, type SitemapRouting } from "./sitemap-engine.ts";

const plain: SitemapRouting = { trailingSlash: "ignore", i18n: null };
let cases = 0;
function check(name: string, run: () => void) {
	run();
	cases += 1;
	console.log("  PASS  " + name);
}

check("the host default pattern applies without a stored pattern", () => {
	assert.equal(contentTypeRoutePattern({ collection: "posts", urlPattern: null }), "/posts/{slug}");
	assert.equal(contentTypeRoutePattern({ collection: "posts", urlPattern: "/blog/{slug}" }), "/blog/{slug}");
	const match = createContentTypeRouteMatcher([{ collection: "posts", urlPattern: null }], null);
	assert.equal(match("/posts/hello"), "posts");
	assert.equal(match("/posts/hello/"), "posts", "a trailing slash names the same address");
	assert.equal(match("/posts"), null);
	assert.equal(match("/posts/hello/more"), null);
	assert.equal(match("/other/hello"), null);
});

check("literal text, placeholders and dates must all match their segment", () => {
	const match = createContentTypeRouteMatcher([
		{ collection: "events", urlPattern: "/events/{year}/{month}/{slug}" },
		{ collection: "notes", urlPattern: "/notes/note-{id}.html" },
	], plain);
	assert.equal(match("/events/2026/10/open-day"), "events");
	assert.equal(match("/events/26/10/open-day"), null, "a year has four digits");
	assert.equal(match("/events/2026/october/open-day"), null);
	assert.equal(match("/notes/note-42.html"), "notes");
	assert.equal(match("/notes/42.html"), null);
	assert.equal(match("/Notes/note-42.html"), null, "addresses compare case-sensitively");
});

check("percent-encoded and decoded forms name the same address, an encoded slash does not split a segment", () => {
	const match = createContentTypeRouteMatcher([{ collection: "posts", urlPattern: "/blog/{slug}" }], plain);
	assert.equal(match("/blog/%C3%BCber"), "posts");
	assert.equal(match("/blog/a%2Fb"), "posts");
	assert.equal(match("//blog//hello"), "posts", "repeated slashes collapse like host routes");
});

check("a pattern made only of placeholders claims every address of its shape", () => {
	const match = createContentTypeRouteMatcher([{ collection: "pages", urlPattern: "/{slug}" }], plain);
	assert.equal(match("/about"), "pages");
	assert.equal(match("/blog"), "pages", "a static page of the same shape is matched too");
	assert.equal(match("/"), null);
	assert.equal(match("/blog/hello"), null);
});

check("an unresolvable token or a non-path never matches", () => {
	const match = createContentTypeRouteMatcher([
		{ collection: "broken", urlPattern: "/x/{author}/{slug}" },
		{ collection: "posts", urlPattern: "/posts/{slug}" },
	], plain);
	assert.equal(match("/x/ada/hello"), null);
	assert.equal(match("/posts/hello"), "posts", "other routes still match");
	assert.equal(match("posts/hello"), null);
	assert.equal(match("" as string), null);
	assert.equal(createContentTypeRouteMatcher([], plain)("/posts/hello"), null);
});

check("routed locale prefixes match exactly as the host prefixes content routes", () => {
	const routing: SitemapRouting = { trailingSlash: "always", i18n: { defaultLocale: "en", locales: ["en", "fr"], prefixDefaultLocale: false } };
	const match = createContentTypeRouteMatcher([{ collection: "posts", urlPattern: "/posts/{slug}" }], routing);
	for (const locale of ["en", "fr"]) {
		const route = resolveSitemapRoute({ pattern: "/posts/{slug}", collection: "posts", slug: "hello", id: "1", publishedAt: null, locale }, routing);
		assert.ok(route.path, locale);
		assert.equal(match(route.path), "posts", "the address the host resolves for " + locale);
	}
	assert.equal(match("/de/posts/hello/"), null, "an unrouted locale is not a prefix");
	assert.equal(match("/en/posts/hello/"), null, "the unprefixed default locale has no prefix form");
	const prefixed = createContentTypeRouteMatcher([{ collection: "posts", urlPattern: "/posts/{slug}" }],
		{ ...routing, i18n: { ...routing.i18n!, prefixDefaultLocale: true } });
	assert.equal(prefixed("/en/posts/hello/"), "posts");
	assert.equal(prefixed("/posts/hello/"), null);
	assert.equal(createContentTypeRouteMatcher([{ collection: "posts", urlPattern: "/posts/{slug}" }], plain)("/fr/posts/hello"), null,
		"without routed locales no prefix is accepted");
});

check("the first listed type wins when shapes overlap", () => {
	const match = createContentTypeRouteMatcher([
		{ collection: "pages", urlPattern: "/{slug}" },
		{ collection: "landing", urlPattern: "/{id}" },
	], plain);
	assert.equal(match("/about"), "pages");
});

console.log(`Content type noindex route self-check passed (${cases} groups).`);
