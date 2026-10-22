import {
	decideSeoSitemapEntry,
	normalizeSeoSitemapPath,
	validateSeoCanonical,
} from "./sitemap-policy.ts";

function check(label: string, condition: boolean): void {
	if (!condition) throw new Error(`SEO sitemap policy self-check failed: ${label}`);
}

const baseline = {
	path: "/blog/example",
	published: true,
	siteNoindex: false,
	moduleEnabled: true,
	entryNoindex: false,
	contentTypeEnabled: true,
	excludedPaths: [] as string[],
	image: "https://example.com/image.jpg",
};

const included = decideSeoSitemapEntry(baseline);
check("eligible entries are included", included.included && included.reason === "included");
check("eligible absolute images are included", included.imageIncluded && included.image?.endsWith("/image.jpg") === true);
check("entry noindex wins", decideSeoSitemapEntry({ ...baseline, entryNoindex: true }).reason === "entry-noindex");
check("site noindex wins", decideSeoSitemapEntry({ ...baseline, siteNoindex: true }).reason === "site-noindex");
check("drafts stay out", decideSeoSitemapEntry({ ...baseline, published: false }).reason === "not-published");
check("disabled content groups stay out", decideSeoSitemapEntry({ ...baseline, contentTypeEnabled: false }).reason === "content-type-disabled");
check("exact path exclusions stay out", decideSeoSitemapEntry({ ...baseline, excludedPaths: ["/blog/example"] }).reason === "path-excluded");
check("unsafe images are ignored", decideSeoSitemapEntry({ ...baseline, image: "javascript:alert(1)" }).image === null);
check("site paths normalize", normalizeSeoSitemapPath("/blog/example/") === "/blog/example");
check("encoded traversal is rejected", normalizeSeoSitemapPath("/blog/%2e%2e/admin") === null);

check(
	"matching canonicals pass",
	validateSeoCanonical("https://example.com/blog/example", "https://example.com", "/blog/example").status === "matches",
);
check(
	"off-origin canonicals are reported",
	validateSeoCanonical("https://other.example/blog/example", "https://example.com", "/blog/example").status === "off-origin",
);
check(
	"different canonical paths are reported",
	validateSeoCanonical("https://example.com/blog/other", "https://example.com", "/blog/example").status === "different-path",
);
check(
	"canonical queries are reported",
	validateSeoCanonical("https://example.com/blog/example?preview=1", "https://example.com", "/blog/example").status === "query-or-fragment",
);

console.log("SEO sitemap policy self-check passed.");
