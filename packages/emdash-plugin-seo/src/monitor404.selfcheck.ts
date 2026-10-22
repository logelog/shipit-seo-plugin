import {
	SEO_404_SUGGESTION_CANDIDATE_BUDGET,
	SEO_404_SUGGESTION_INPUT_BUDGET,
	normalizeNotFoundPath,
	notFoundRecordId,
	prepareRedirectSuggestionIndex,
	shouldTrackNotFoundPath,
	suggestRedirects,
	suggestRedirectsFromIndex,
} from "./monitor404.ts";

let failures = 0;

function check(label: string, condition: boolean): void {
	if (condition) console.log(`  PASS  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}`);
	}
}

check("normalizes absolute URLs without query data", normalizeNotFoundPath("https://example.com/Services/?utm_source=test") === "/Services");
check("collapses duplicate and trailing slashes", normalizeNotFoundPath("//services///seo//") === "/services/seo");
check("rejects oversized paths", normalizeNotFoundPath(`/${"x".repeat(1_100)}`) === null);
check("ignores admin requests", shouldTrackNotFoundPath("/_emdash/admin/missing") === false);
check("ignores asset requests", shouldTrackNotFoundPath("/images/missing.svg") === false);
check("tracks public document paths", shouldTrackNotFoundPath("/services/technical-seo") === true);
check(
	"record IDs are stable",
	(await notFoundRecordId("/missing")) ===
		(await notFoundRecordId("https://example.com/missing?x=1")),
);
check(
	"record IDs use the full SHA-256 digest",
	(await notFoundRecordId("/missing")) ===
		"404-v2-159844c6c62d86d7332741f819215df94a4fb74202a27e4808732c005ca4934c",
);

const collisionLeft = "/abw0bwdszo4sf5mt";
const collisionRight = "/9t9qbdqq878y6voz";
check(
	"record IDs use the storage-v2 digest namespace",
	(await notFoundRecordId(collisionLeft)).startsWith("404-v2-"),
);
check(
	"record IDs separate known FNV-1a collision paths",
	(await notFoundRecordId(collisionLeft)) !== (await notFoundRecordId(collisionRight)),
);

const suggestions = suggestRedirects("/servcies/seo-ai-visiblity", [
	{ path: "/", title: "Home", collection: "pages" },
	{ path: "/services/seo-ai-visibility", title: "SEO & AI Visibility", collection: "services" },
	{ path: "/services/social-media-management", title: "Social Media Management", collection: "services" },
]);
check("suggests the closest real route first", suggestions[0]?.path === "/services/seo-ai-visibility");
check("does not suggest unrelated low-confidence routes", suggestions.some((item) => item.path === "/") === false);
check("deduplicates candidate paths", suggestRedirects("/servcies", [
	{ path: "/services", title: "Services", collection: "pages" },
	{ path: "/services/", title: "Duplicate", collection: "pages" },
]).length === 1);

const boundedCandidates = [
	{ path: "/services/seo-ai-visibility", title: "SEO & AI Visibility", collection: "services" },
	...Array.from({ length: 5_000 }, (_, index) => ({
		path: `/archive/item-${index.toString(36)}`,
		title: `Archive item ${index}`,
		collection: "posts",
	})),
];
const boundedIndex = prepareRedirectSuggestionIndex(boundedCandidates);
const boundedRun = suggestRedirectsFromIndex(
	"/servcies/seo-ai-visiblity",
	boundedIndex,
	3,
);
check(
	"suggestion indexes enforce their input budget",
	boundedIndex.inspectedCandidates === SEO_404_SUGGESTION_INPUT_BUDGET &&
		boundedIndex.candidateCount <= SEO_404_SUGGESTION_INPUT_BUDGET,
);
check(
	"bounded suggestions keep the closest route",
	boundedRun.suggestions[0]?.path === "/services/seo-ai-visibility",
);
check(
	"suggestion runs bound expensive candidate scoring",
	boundedRun.stats.scoredCandidates <= SEO_404_SUGGESTION_CANDIDATE_BUDGET,
);
check(
	"suggestion runs bound Levenshtein evaluations",
	boundedRun.stats.levenshteinEvaluations <= SEO_404_SUGGESTION_CANDIDATE_BUDGET * 2,
);

if (failures) {
	console.error(`\n${failures} SEO 404 monitor self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nAll SEO 404 monitor self-checks passed.");
}
