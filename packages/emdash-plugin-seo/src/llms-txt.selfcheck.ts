import assert from "node:assert/strict";

import {
	LLMS_TXT_LIMITS,
	LLMS_TXT_MAX_LINKS_PER_SECTION,
	LLMS_TXT_MAX_OUTPUT_LENGTH,
	LLMS_TXT_MAX_SECTIONS,
	LLMS_TXT_MAX_TOTAL_LINKS,
	renderLlmsTxt,
	type LlmsTxtDocument,
} from "./llms-txt.ts";

const baseline = renderLlmsTxt({
	title: "Example Site",
	summary: "A concise guide.",
	body: "Use these resources to learn more.",
	sections: [
		{
			title: "Docs",
			links: [
				{
					label: "Getting started",
					url: "https://example.com/start",
					description: "The primary guide.",
				},
			],
		},
	],
});
assert.equal(
	baseline,
	"# Example Site\n\n> A concise guide.\n\nUse these resources to learn more.\n\n## Docs\n\n- [Getting started](https://example.com/start): The primary guide.\n",
);
assert.match(baseline, /\n$/u);
assert.doesNotMatch(baseline, /\n\n$/u);

const injected = renderLlmsTxt({
	title: "Site\n## Injected",
	summary: "Summary\n## Summary injection",
	body: "# Body injection\n## More",
	sections: [
		{
			title: "Docs\n## Section injection",
			links: [
				{
					label: "Escape](javascript:alert(1))\n## Link injection",
					url: "https://example.com/a)(javascript:alert(1)",
					description: "[Injected](javascript:alert(1))\n## Description injection <script>",
				},
			],
		},
	],
});
assert.equal((injected.match(/^## /gmu) ?? []).length, 1);
assert.doesNotMatch(injected, /(?<!\\)\]\(javascript:/u);
assert.doesNotMatch(injected, /<script>/u);
assert.match(injected, /a%29%28javascript:alert%281%29/u);
const parsedInjectedLink = /^- \[([^\]]+)\]\(([^)]+)\)/mu.exec(injected);
assert.equal(parsedInjectedLink?.[2], "https://example.com/a%29%28javascript:alert%281%29");

const parserEscape = renderLlmsTxt(
	{
		title: "Reference parser",
		sections: [
			{
				title: "Links",
				links: [
					{
						label: "Trusted](https://attacker.example/payload)",
						url: "https://example.com/safe",
					},
				],
			},
		],
	},
	{ origin: "https://example.com" },
);
const parsedSafeLink = /^- \[([^\]]+)\]\(([^)]+)\)/mu.exec(parserEscape);
assert.equal(parsedSafeLink?.[2], "https://example.com/safe");
assert.equal((parserEscape.match(/^- \[/gmu) ?? []).length, 1);

const schemes = renderLlmsTxt({
	title: "Schemes",
	sections: [
		{
			title: "Links",
			links: [
				{ label: "JavaScript", url: "javascript:alert(1)" },
				{ label: "Data", url: "data:text/plain,hello" },
				{ label: "Mail", url: "mailto:test@example.com" },
				{ label: "Credentials", url: "https://user:secret@example.com/private" },
				{ label: "Padded", url: `${" ".repeat(LLMS_TXT_LIMITS.urlLength)}https://example.com/padded` },
				{ label: "Relative", url: "/relative" },
				{ label: "Empty", url: "" },
				{ label: "", url: "https://example.com/empty-label" },
				{ label: "Safe", url: "https://example.com/safe" },
			],
		},
	],
});
assert.equal((schemes.match(/^- \[/gmu) ?? []).length, 1);
assert.match(schemes, /https:\/\/example\.com\/safe/u);
assert.doesNotMatch(schemes, /user|secret|private/u);

const sameOrigin = renderLlmsTxt(
	{
		title: "Origin",
		sections: [
			{
				title: "Links",
				links: [
					{ label: "Same", url: "https://EXAMPLE.com:443/same" },
					{ label: "Other", url: "https://other.example/other" },
					{ label: "Downgrade", url: "http://example.com/insecure" },
				],
			},
		],
	},
	{ origin: "https://example.com/site" },
);
assert.match(sameOrigin, /https:\/\/example\.com\/same/u);
assert.doesNotMatch(sameOrigin, /other|insecure/u);
assert.doesNotMatch(
	renderLlmsTxt(
		{
			title: "Invalid origin",
			sections: [{ title: "Links", links: [{ label: "Link", url: "https://example.com" }] }],
		},
		{ origin: "not an origin" },
	),
	/^- \[/mu,
);

const deduplicated = renderLlmsTxt({
	title: "Dedupe",
	sections: [
		{
			title: "First",
			links: [{ label: "First", url: "https://EXAMPLE.com:443" }],
		},
		{
			title: "Second",
			links: [{ label: "Duplicate", url: "https://example.com/" }],
		},
	],
	optional: [{ label: "Also duplicate", url: "https://example.com" }],
});
assert.equal((deduplicated.match(/https:\/\/example\.com\//gu) ?? []).length, 1);
assert.doesNotMatch(deduplicated, /^## Second$/mu);
assert.doesNotMatch(deduplicated, /^## Optional$/mu);

const optional = renderLlmsTxt({
	title: "Optional resources",
	sections: [
		{
			title: "Extras",
			optional: true,
			links: [{ label: "Extra", url: "https://example.com/extra" }],
		},
		{
			title: "Optional",
			links: [{ label: "Alternate", url: "https://example.com/alternate" }],
		},
	],
	optional: [{ label: "Archive", url: "https://example.com/archive" }],
});
assert.equal((optional.match(/^## Optional$/gmu) ?? []).length, 1);
assert.equal((optional.match(/^- \[/gmu) ?? []).length, 3);
assert.doesNotMatch(optional, /^## Extras$/mu);

const sectionCapped = renderLlmsTxt({
	title: "Section cap",
	sections: Array.from({ length: LLMS_TXT_MAX_SECTIONS + 10 }, (_, index) => ({
		title: `Section ${index}`,
		links: [{ label: `Link ${index}`, url: `https://example.com/section-${index}` }],
	})),
});
assert.equal((sectionCapped.match(/^## /gmu) ?? []).length, LLMS_TXT_MAX_SECTIONS);

const perSectionCapped = renderLlmsTxt({
	title: "Per-section cap",
	sections: [
		{
			title: "Links",
			links: Array.from({ length: LLMS_TXT_MAX_LINKS_PER_SECTION + 10 }, (_, index) => ({
				label: `Link ${index}`,
				url: `https://example.com/link-${index}`,
			})),
		},
	],
});
assert.equal((perSectionCapped.match(/^- \[/gmu) ?? []).length, LLMS_TXT_MAX_LINKS_PER_SECTION);

const totalCapped = renderLlmsTxt({
	title: "Total cap",
	sections: Array.from({ length: LLMS_TXT_MAX_SECTIONS }, (_, sectionIndex) => ({
		title: `Section ${sectionIndex}`,
		links: Array.from({ length: LLMS_TXT_MAX_LINKS_PER_SECTION }, (_, linkIndex) => ({
			label: "Link",
			url: `https://example.com/${sectionIndex}/${linkIndex}`,
		})),
	})),
});
assert.equal((totalCapped.match(/^- \[/gmu) ?? []).length, LLMS_TXT_MAX_TOTAL_LINKS);

const fieldsCapped = renderLlmsTxt({
	title: "t".repeat(LLMS_TXT_LIMITS.titleLength + 100),
	summary: "s".repeat(LLMS_TXT_LIMITS.summaryLength + 100),
	body: "b".repeat(LLMS_TXT_LIMITS.bodyLength + 100),
	sections: [
		{
			title: "h".repeat(LLMS_TXT_LIMITS.sectionTitleLength + 100),
			links: [
				{
					label: "l".repeat(LLMS_TXT_LIMITS.linkLabelLength + 100),
					url: "https://example.com/capped",
					description: "d".repeat(LLMS_TXT_LIMITS.linkDescriptionLength + 100),
				},
				{
					label: "Long URL",
					url: `https://example.com/${"u".repeat(LLMS_TXT_LIMITS.urlLength)}`,
				},
			],
		},
	],
});
const fieldLines = fieldsCapped.trimEnd().split("\n");
assert.ok((fieldLines[0]?.length ?? 0) - 2 <= LLMS_TXT_LIMITS.titleLength);
assert.ok((fieldLines[2]?.length ?? 0) - 2 <= LLMS_TXT_LIMITS.summaryLength);
assert.ok((fieldLines[4]?.length ?? 0) <= LLMS_TXT_LIMITS.bodyLength);
assert.equal((fieldsCapped.match(/^- \[/gmu) ?? []).length, 1);

const rawWorkCapped = renderLlmsTxt({
	title: `${" ".repeat(LLMS_TXT_LIMITS.titleLength * 100)}discarded`,
	body: `${"b".repeat(LLMS_TXT_LIMITS.bodyLength * 100)}discarded`,
});
assert.ok(rawWorkCapped.length <= LLMS_TXT_LIMITS.bodyLength + LLMS_TXT_LIMITS.titleLength + 16);
assert.doesNotMatch(rawWorkCapped, /discarded/u);

const outputCapped = renderLlmsTxt({
	title: "Output cap",
	sections: Array.from({ length: LLMS_TXT_MAX_SECTIONS }, (_, sectionIndex) => ({
		title: `Section ${sectionIndex}`,
		links: Array.from({ length: LLMS_TXT_MAX_LINKS_PER_SECTION }, (_, linkIndex) => ({
			label: `Link ${sectionIndex}-${linkIndex}`,
			url: `https://example.com/large/${sectionIndex}/${linkIndex}`,
			description: "description ".repeat(LLMS_TXT_LIMITS.linkDescriptionLength),
		})),
	})),
});
assert.ok(outputCapped.length <= LLMS_TXT_MAX_OUTPUT_LENGTH);
assert.match(outputCapped, /\n$/u);

const deterministicDocument: LlmsTxtDocument = {
	title: "Deterministic",
	sections: [
		{
			title: "Ordered",
			links: [
				{ label: "B", url: "https://example.com/b" },
				{ label: "A", url: "https://example.com/a" },
			],
		},
	],
};
const before = JSON.stringify(deterministicDocument);
assert.equal(renderLlmsTxt(deterministicDocument), renderLlmsTxt(deterministicDocument));
assert.equal(JSON.stringify(deterministicDocument), before);

console.log("SEO llms.txt renderer self-check passed.");
