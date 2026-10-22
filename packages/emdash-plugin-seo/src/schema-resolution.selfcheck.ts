import {
	createSeoSchemaResolutionState,
	resolveSeoSchemaCandidate,
} from "./schema-resolution.ts";

let failures = 0;

function check(name: string, condition: boolean) {
	if (condition) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}`);
}

const state = createSeoSchemaResolutionState();
const organization = {
	"@context": "https://schema.org",
	"@type": "Organization",
	"@id": "https://example.com/#organization",
};

check(
	"first schema candidate is emitted",
	resolveSeoSchemaCandidate(state, "organization", organization).emitted,
);
check(
	"cross-graph entity conflicts are suppressed",
	resolveSeoSchemaCandidate(state, "custom:organization", organization).reason ===
		"entity-conflict",
);
check(
	"duplicate contribution IDs are suppressed",
	resolveSeoSchemaCandidate(state, "organization", {
		"@type": "WebSite",
		"@id": "https://example.com/#website",
	}).reason === "duplicate-contribution",
);
check(
	"duplicate definitions inside one graph are suppressed",
	resolveSeoSchemaCandidate(state, "custom:duplicate", {
		"@graph": [
			{ "@type": "Person", "@id": "https://example.com/#author" },
			{ "@type": "Person", "@id": "https://example.com/#author" },
		],
	}).reason === "duplicate-definition",
);
check(
	"rejected candidates do not reserve unrelated identities",
	resolveSeoSchemaCandidate(state, "website", {
		"@type": "WebSite",
		"@id": "https://example.com/#website",
	}).emitted,
);

if (failures > 0) process.exitCode = 1;
else console.log("SEO schema resolution self-check passed.");
