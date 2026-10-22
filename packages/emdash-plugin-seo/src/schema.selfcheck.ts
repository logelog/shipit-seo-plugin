import assert from "node:assert/strict";
import type { PublicPageContext } from "emdash";
import { generateBaseSeoContributions, resolvePageMetadata } from "emdash/page";

import { SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS, SEO_ADMIN_SETTINGS_STORAGE_VERSION, SEO_ENGINE_VERSION } from "./admin-contract.ts";
import {
	INVALID_SCHEMA_CONTENT_TYPE_ROLES,
	SCHEMA_PRESET_DATA_CONTAINERS,
	SCHEMA_PRESET_KEYS,
	SCHEMA_PRESET_REQUIREMENTS,
	TEMPLATE_VARS,
	blogPostingSchema,
	breadcrumbListSchema,
	buildSchemaPresetGraphs,
	buildVars,
	defaultSchemaContentTypeRole,
	duplicateSchemaDefinitionIds,
	eventSchema,
	faqPageSchema,
	localBusinessSchema,
	organizationSchema,
	personSchema,
	productSchema,
	resolveSchemaOrganizationReferences,
	sitePublisherSchema,
	schemaDefinitionIdentities,
	serviceSchema,
	validateCustomJsonLd,
	videoObjectSchema,
	webPageSchema,
	webSiteSchema,
	type GlobalSeoSettings,
	type SchemaContentTypeRoles,
	type SchemaPresetKey,
	type SchemaPresetValues,
} from "./lib.ts";
import { createSeoEngine } from "./sandbox-entry.ts";
import { createSeoSchemaResolutionState, resolveSeoSchemaCandidate } from "./schema-resolution.ts";
import { defaultSettingsValues } from "./settings-state.ts";

const settings: GlobalSeoSettings = {
	siteName: "Example Studio",
	siteUrl: "https://example.com",
	orgName: "Example Studio BV",
	orgLogo: "https://example.com/logo.png",
	sameAs: ["https://www.linkedin.com/company/example"],
	defaultOgImage: "https://example.com/social.jpg",
	twitterHandle: "@example",
};

const articlePage: PublicPageContext = {
	url: "https://example.com/blog/schema-graphs",
	path: "/blog/schema-graphs",
	locale: "en",
	kind: "content",
	pageType: "article",
	title: "Schema graphs - Example Studio",
	pageTitle: "Schema graphs",
	description: "A complete schema graph fixture.",
	canonical: "https://example.com/blog/schema-graphs",
	image: "/images/schema.jpg",
	content: { collection: "posts", id: "post-1", slug: "schema-graphs" },
	articleMeta: {
		author: "Ada Example",
		publishedTime: "2026-07-14T08:00:00.000Z",
		modifiedTime: "2026-07-14T09:00:00.000Z",
	},
	breadcrumbs: [
		{ name: "Home", url: "https://example.com/" },
		{ name: "Blog", url: "https://example.com/blog" },
		{ name: "Schema graphs", url: "https://example.com/blog/schema-graphs" },
	],
	siteName: settings.siteName,
	siteUrl: settings.siteUrl,
};

const servicePage: PublicPageContext = {
	...articlePage,
	url: "https://example.com/services/seo",
	path: "/services/seo",
	pageType: "content",
	title: "SEO service - Example Studio",
	pageTitle: "SEO service",
	canonical: "https://example.com/services/seo",
	content: { collection: "services", id: "service-1", slug: "seo" },
	articleMeta: undefined,
};

assert.ok(TEMPLATE_VARS.includes("siteUrl"), "siteUrl must be available to reusable schema entity references");
assert.equal(buildVars(articlePage).siteUrl, settings.siteUrl, "page variables expose the canonical site origin");

const completeData = {
	schemaData: {
		person: {
			name: "Ada Example",
			url: "/team/ada",
			image: "/images/ada.jpg",
			jobTitle: "SEO strategist",
			sameAs: ["https://www.linkedin.com/in/ada-example"],
		},
		faqPage: {
			items: [
				{ question: "What is structured data?", answer: "Machine-readable page context." },
				{ name: "Does it guarantee rich results?", acceptedAnswer: { text: "No." } },
			],
		},
		localBusiness: {
			name: "Example Studio Amsterdam",
			type: "ProfessionalService",
			url: "/contact",
			telephone: "+31 20 000 0000",
			address: {
				streetAddress: "Example Street 1",
				addressLocality: "Amsterdam",
				postalCode: "1000 AA",
				addressCountry: "NL",
			},
		},
		product: {
			name: "SEO audit",
			image: "/images/audit.jpg",
			description: "A technical and content audit.",
			sku: "AUDIT-01",
			brand: "Example Studio",
			offers: {
				price: 499,
				priceCurrency: "eur",
				availability: "InStock",
				url: "/services/seo-audit",
			},
		},
		event: {
			name: "SEO workshop",
			startDate: "2026-09-18T10:00:00+02:00",
			endDate: "2026-09-18T16:00:00+02:00",
			location: {
				name: "Example Hall",
				address: {
					street: "Event Lane 2",
					city: "Amsterdam",
					postcode: "1000 AB",
					country: "NL",
				},
			},
		},
		videoObject: {
			name: "Schema graph walkthrough",
			thumbnailUrl: "/images/video-thumb.jpg",
			uploadDate: "2026-07-14",
			contentUrl: "/media/schema-walkthrough.mp4",
			duration: "PT3M12S",
		},
	},
};

assert.equal(organizationSchema(settings)["@type"], "Organization");
const personPublisherSettings: GlobalSeoSettings = {
	...settings,
	publisherType: "person",
	personName: "Ada Publisher",
};
assert.deepEqual(
	sitePublisherSchema(personPublisherSettings),
	{
		"@context": "https://schema.org",
		"@type": "Person",
		name: "Ada Publisher",
		"@id": "https://example.com/#person",
		url: "https://example.com/",
		sameAs: settings.sameAs,
	},
	"Person publisher has a stable site identity",
);
assert.equal(webSiteSchema(settings)["@id"], "https://example.com/#website");
assert.equal(webPageSchema(servicePage, settings)?.["@id"], "https://example.com/services/seo#webpage");
assert.equal(blogPostingSchema(articlePage, settings)["@type"], "BlogPosting");
assert.equal(serviceSchema(servicePage, settings)["@id"], "https://example.com/services/seo#service");
assert.equal(breadcrumbListSchema(articlePage)?.itemListElement instanceof Array, true);

const person = personSchema(articlePage, settings, completeData);
assert.equal(person?.name, "Ada Example");
assert.equal(person?.url, "https://example.com/team/ada");
assert.equal(personSchema({ ...articlePage, articleMeta: undefined }, settings, {}), null);

const faq = faqPageSchema(articlePage, settings, completeData);
assert.equal((faq?.mainEntity as unknown[])?.length, 2);
assert.equal(faqPageSchema(articlePage, settings, { faqItems: [{ question: "Missing answer" }] }), null);

const business = localBusinessSchema(articlePage, settings, completeData);
assert.deepEqual(business?.["@type"], ["LocalBusiness", "ProfessionalService"]);
assert.equal(localBusinessSchema(articlePage, settings, {
	localBusiness: { name: "Incomplete", address: { city: "Amsterdam" } },
}), null);

const product = productSchema(articlePage, settings, completeData);
assert.equal((product?.offers as Record<string, unknown>)?.priceCurrency, "EUR");
assert.equal((product?.offers as Record<string, unknown>)?.availability, "https://schema.org/InStock");
assert.equal(productSchema(articlePage, settings, {
	product: { name: "Incomplete", image: "/product.jpg", price: "10" },
}), null);

const event = eventSchema(articlePage, settings, completeData);
assert.equal((event?.location as Record<string, unknown>)?.["@type"], "Place");
assert.equal(eventSchema(articlePage, settings, {
	event: { name: "Incomplete", startDate: "2026-09-18", location: { name: "Nowhere" } },
}), null);

const video = videoObjectSchema(articlePage, settings, completeData);
assert.equal(video?.contentUrl, "https://example.com/media/schema-walkthrough.mp4");
assert.equal(videoObjectSchema(articlePage, settings, {
	video: { name: "Incomplete", thumbnailUrl: "/thumb.jpg", uploadDate: "2026-07-14" },
}), null);

const allPresets = Object.fromEntries(SCHEMA_PRESET_KEYS.map((key) => [key, true])) as SchemaPresetValues;
const built = buildSchemaPresetGraphs({ page: servicePage, settings, presets: allPresets, data: completeData });
const builtKeys = new Set(built.map((item) => item.key));
for (const key of [
	"organization",
	"website",
	"webPage",
	"service",
	"breadcrumbList",
	"person",
	"faqPage",
	"localBusiness",
	"product",
	"event",
	"videoObject",
] as const) assert.equal(builtKeys.has(key), true, `${key} should emit`);
assert.equal(builtKeys.has("blogPosting"), false);

const incompleteBuilt = buildSchemaPresetGraphs({ page: servicePage, settings, presets: allPresets, data: {} });
for (const key of ["faqPage", "localBusiness", "product", "event", "videoObject"] as const) {
	assert.equal(incompleteBuilt.some((item) => item.key === key), false, `${key} should require data`);
}

const entityId = "https://example.com/#organization";
const referenceAndDefinition = [
	{ "@id": entityId },
	{ "@id": entityId, "@type": "Organization", name: "Example Studio" },
];
assert.deepEqual(schemaDefinitionIdentities(referenceAndDefinition), [entityId]);
assert.deepEqual(duplicateSchemaDefinitionIds(referenceAndDefinition), []);
assert.doesNotThrow(() => validateCustomJsonLd(JSON.stringify(referenceAndDefinition)));

const duplicateDefinitions = [
	{ "@id": entityId, "@type": "Organization", name: "Example Studio" },
	{ "@id": entityId, "@type": "Organization", url: "https://example.com" },
];
assert.deepEqual(duplicateSchemaDefinitionIds(duplicateDefinitions), [entityId]);
assert.throws(() => validateCustomJsonLd(JSON.stringify(duplicateDefinitions)), /same entity @id/);

const organization = organizationSchema(settings);
const article = blogPostingSchema(articlePage, settings);
assert.deepEqual(duplicateSchemaDefinitionIds([organization, article]), []);

const organizationId = "https://example.com/#organization";
const linkedService = built.find((item) => item.key === "service");
assert.deepEqual(linkedService?.graph.provider, { "@id": organizationId }, "Service links to the emitted Organization");
const linkedResolution = createSeoSchemaResolutionState();
for (const item of built) {
	const decision = resolveSeoSchemaCandidate(linkedResolution, item.contributionId, item.graph);
	if (item.key === "organization" || item.key === "service") {
		assert.equal(decision.emitted, true, `${item.key} survives schema resolution beside its linked entity`);
	}
}
const unlinkedService = buildSchemaPresetGraphs({
	page: servicePage,
	settings,
	presets: { ...allPresets, organization: false },
	data: {},
}).find((item) => item.key === "service");
assert.deepEqual(
	unlinkedService?.graph.provider,
	{ "@type": "Organization", name: "Example Studio BV" },
	"Service names its provider inline when no Organization is emitted",
);
const originlessService = buildSchemaPresetGraphs({
	page: servicePage,
	settings: { ...settings, siteUrl: "" },
	presets: allPresets,
	data: {},
}).find((item) => item.key === "service");
assert.equal((originlessService?.graph.provider as Record<string, unknown>)?.["@id"], undefined);

const neutralPage: PublicPageContext = {
	...servicePage,
	url: "https://example.com/about",
	path: "/about",
	canonical: "https://example.com/about",
	content: { collection: "pages", id: "page-1", slug: "about" },
	breadcrumbs: [],
};
const sampleValues: Record<string, string> = {
	startDate: "2026-10-01T10:00:00+02:00",
	uploadDate: "2026-07-14",
	price: "10",
	priceCurrency: "EUR",
	image: "https://example.com/item.jpg",
	thumbnailUrl: "https://example.com/thumb.jpg",
	contentUrl: "https://example.com/video.mp4",
	embedUrl: "https://example.com/embed/1",
	addressCountry: "NL",
};

function withPath(target: Record<string, unknown>, path: string): Record<string, unknown> {
	const keys = path.split(".");
	let node = target;
	keys.forEach((segment, index) => {
		const list = segment.endsWith("[]");
		const key = list ? segment.slice(0, -2) : segment;
		if (index === keys.length - 1) {
			node[key] = sampleValues[key] ?? `Sample ${key}`;
			return;
		}
		if (list) {
			const items = (node[key] ??= [{}]) as Record<string, unknown>[];
			node = items[0];
		} else {
			node = (node[key] ??= {}) as Record<string, unknown>;
		}
	});
	return target;
}

function onlyPreset(key: SchemaPresetKey): SchemaPresetValues {
	return Object.fromEntries(SCHEMA_PRESET_KEYS.map((item) => [item, item === key])) as SchemaPresetValues;
}

function emits(
	key: SchemaPresetKey,
	page: PublicPageContext,
	data: unknown,
	contentTypeRoles?: SchemaContentTypeRoles,
): boolean {
	return buildSchemaPresetGraphs({ page, settings, presets: onlyPreset(key), data, contentTypeRoles }).some(
		(item) => item.key === key,
	);
}

function inCollection(collection: string): PublicPageContext {
	return { ...neutralPage, content: { ...neutralPage.content!, collection } };
}

for (const definition of SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS) {
	if (definition.emission !== "data-required") continue;
	assert.ok(SCHEMA_PRESET_REQUIREMENTS[definition.key]?.data?.length, `${definition.key} lists the entry data it needs`);
}
for (const [key, requirements] of Object.entries(SCHEMA_PRESET_REQUIREMENTS) as Array<
	[SchemaPresetKey, NonNullable<(typeof SCHEMA_PRESET_REQUIREMENTS)[SchemaPresetKey]>]
>) {
	if (requirements.contentTypeRole) {
		const role = requirements.contentTypeRole;
		const defaultCollection = role === "blogPosting" ? "posts" : "services";
		assert.equal(defaultSchemaContentTypeRole(defaultCollection), role, `${defaultCollection} defaults to ${role}`);
		assert.equal(emits(key, inCollection(defaultCollection), {}), true, `${key} emits in ${defaultCollection} by default`);
		assert.equal(emits(key, neutralPage, {}), false, `${key} stays off in an unmapped collection`);
		assert.equal(
			emits(key, inCollection("articles"), {}, { articles: role }),
			true,
			`${key} emits in a collection mapped to ${role}`,
		);
		assert.equal(
			emits(key, inCollection(defaultCollection), {}, { [defaultCollection]: "none" }),
			false,
			`${key} stays off when ${defaultCollection} is mapped to no type-specific schema`,
		);
		assert.equal(
			emits(key, inCollection(defaultCollection), {}, { articles: role }),
			true,
			`${key} keeps the ${defaultCollection} default when only another collection is mapped`,
		);
		assert.equal(
			emits(key, { ...inCollection("articles"), content: undefined }, {}, { articles: role }),
			false,
			`${key} needs a content entry`,
		);
	}
	if (requirements.breadcrumbs) {
		assert.equal(emits(key, { ...neutralPage, breadcrumbs: articlePage.breadcrumbs }, {}), true, `${key} emits with breadcrumbs`);
		assert.equal(emits(key, neutralPage, {}), false, `${key} needs breadcrumbs`);
	}
	const groups = requirements.data ?? [];
	if (!groups.length) continue;
	const complete = groups.reduce((data, group) => withPath(data, group[0]), {} as Record<string, unknown>);
	assert.equal(emits(key, neutralPage, complete), true, `${key} emits from its listed paths`);
	assert.equal(
		emits(key, neutralPage, { [SCHEMA_PRESET_DATA_CONTAINERS[0]]: complete }),
		true,
		`${key} emits from its listed paths inside ${SCHEMA_PRESET_DATA_CONTAINERS[0]}`,
	);
	groups.forEach((group, groupIndex) => {
		const others = groups.filter((_, index) => index !== groupIndex);
		const missing = others.reduce((data, other) => withPath(data, other[0]), {} as Record<string, unknown>);
		assert.equal(emits(key, neutralPage, missing), false, `${key} needs ${group.join(" or ")}`);
		for (const path of group) {
			assert.equal(emits(key, neutralPage, withPath(structuredClone(missing), path)), true, `${key} accepts ${path}`);
		}
	});
}

const linkedArticle = buildSchemaPresetGraphs({ page: articlePage, settings, presets: allPresets });
assert.deepEqual(
	linkedArticle.find((item) => item.key === "blogPosting")?.graph.mainEntityOfPage,
	{ "@id": "https://example.com/blog/schema-graphs#webpage" },
	"BlogPosting links to WebPage when that preset emits",
);
for (const [label, presets, disabledPresets] of [
	["globally off", { ...allPresets, webPage: false }, []],
	["disabled on entry", allPresets, ["webPage"]],
] as const) {
	const graphs = buildSchemaPresetGraphs({ page: articlePage, settings, presets, disabledPresets });
	assert.equal(
		graphs.find((item) => item.key === "blogPosting")?.graph.mainEntityOfPage,
		articlePage.canonical,
		`BlogPosting uses the canonical page URL when WebPage is ${label}`,
	);
}
const linkedWebPage = buildSchemaPresetGraphs({ page: servicePage, settings, presets: allPresets });
assert.deepEqual(
	linkedWebPage.find((item) => item.key === "webPage")?.graph.isPartOf,
	{ "@id": "https://example.com/#website" },
	"WebPage links to WebSite when that preset emits",
);
for (const [label, presets, disabledPresets] of [
	["globally off", { ...allPresets, website: false }, []],
	["disabled on entry", allPresets, ["website"]],
] as const) {
	const graphs = buildSchemaPresetGraphs({ page: servicePage, settings, presets, disabledPresets });
	assert.equal(
		graphs.find((item) => item.key === "webPage")?.graph.isPartOf,
		undefined,
		`WebPage omits isPartOf when WebSite is ${label}`,
	);
}
assert.equal(
	linkedArticle.find((item) => item.key === "webPage")?.graph.isPartOf,
	undefined,
	"WebPage on an article does not link to the WebSite preset, which only emits on non-article pages",
);

const aboutPage: PublicPageContext = {
	...servicePage,
	url: "https://example.com/about",
	path: "/about",
	pageType: "website",
	title: "About - Example Studio",
	pageTitle: "About",
	canonical: "https://example.com/about",
	content: { collection: "pages", id: "page-1", slug: "about" },
};
const pageRoles = { pages: "webPage" } as const;
const contributions = (graphs: ReturnType<typeof buildSchemaPresetGraphs>) =>
	graphs.filter((item) => ["website", "webPage"].includes(item.key)).map((item) => [item.type, item.contributionId]);
for (const webPageSwitch of [true, false]) {
	const graphs = buildSchemaPresetGraphs({
		page: aboutPage,
		settings,
		presets: { ...allPresets, webPage: webPageSwitch },
		contentTypeRoles: pageRoles,
	});
	assert.deepEqual(
		contributions(graphs),
		[["WebSite", "preset:website"], ["WebPage", "primary"]],
		`a Web page role claims primary once, beside a separate WebSite, with the WebPage switch ${webPageSwitch ? "on" : "off"}`,
	);
	assert.deepEqual(graphs.find((item) => item.key === "webPage")?.graph.isPartOf, { "@id": "https://example.com/#website" });
}
assert.deepEqual(
	contributions(buildSchemaPresetGraphs({ page: aboutPage, settings, presets: allPresets, disabledPresets: ["webPage"], contentTypeRoles: pageRoles })),
	[["WebSite", "primary"], ["WebPage", "preset:webPage"]],
	"a WebPage turned off on the entry returns primary to WebSite, so EmDash adds no BlogPosting",
);
assert.deepEqual(
	contributions(buildSchemaPresetGraphs({ page: { ...aboutPage, pageTitle: "", title: "" }, settings, presets: allPresets, contentTypeRoles: pageRoles })),
	[["WebSite", "primary"]],
	"without a page name no WebPage is built and WebSite keeps primary",
);
assert.deepEqual(
	contributions(buildSchemaPresetGraphs({ page: aboutPage, settings, presets: allPresets, contentTypeRoles: {} })),
	[["WebSite", "primary"], ["WebPage", "preset:webPage"]],
	"other roles keep the WebPage adjunct and the WebSite primary",
);
const unreadable = buildSchemaPresetGraphs({ page: articlePage, settings, presets: allPresets, contentTypeRoles: INVALID_SCHEMA_CONTENT_TYPE_ROLES });
assert.deepEqual(
	unreadable.filter((item) => ["website", "blogPosting", "service"].includes(item.key) || item.contributionId === "primary"),
	[],
	"an unreadable mapping emits no role-owned or primary graph on content pages",
);
assert.equal(
	buildSchemaPresetGraphs({ page: { ...articlePage, content: undefined, pageType: "website" }, settings, presets: allPresets, contentTypeRoles: INVALID_SCHEMA_CONTENT_TYPE_ROLES })
		.find((item) => item.contributionId === "primary")?.type,
	"WebSite",
	"pages without content keep WebSite when the mapping is unreadable",
);

const customOrganizationLinks = {
	provider: { "@id": organizationId },
	nested: [{ "@id": "https://example.com#organization" }, { "@id": "https://other.example/#organization" }],
	definition: { "@id": "https://example.com/#other", "@type": "Thing", name: "Other" },
};
const normalizedLinks = resolveSchemaOrganizationReferences(customOrganizationLinks, settings, true);
assert.deepEqual(normalizedLinks.provider, { "@id": organizationId });
assert.deepEqual(normalizedLinks.nested[0], { "@id": organizationId }, "legacy composer references use the canonical site id");
assert.deepEqual(normalizedLinks.nested[1], customOrganizationLinks.nested[1], "other entity links remain untouched");
assert.deepEqual(
	resolveSchemaOrganizationReferences(
		{ provider: { "@id": "https://example.com//#organization" } },
		{ ...settings, siteUrl: "https://example.com/" },
		true,
	).provider,
	{ "@id": organizationId },
	"a trailing slash in the site URL still resolves to the canonical Organization id",
);
const inlineLinks = resolveSchemaOrganizationReferences(customOrganizationLinks, settings, false);
assert.equal((inlineLinks.provider as Record<string, unknown>)["@type"], "Organization");
assert.equal((inlineLinks.provider as Record<string, unknown>).name, settings.orgName);
assert.equal((inlineLinks.provider as Record<string, unknown>)["@id"], undefined);
assert.equal((inlineLinks.nested[0] as Record<string, unknown>)["@id"], undefined);
assert.deepEqual(inlineLinks.definition, customOrganizationLinks.definition, "authored definitions remain untouched");
const selfDefinedOrganization = {
	"@graph": [
		{ "@id": organizationId, "@type": "Organization", name: "Custom publisher" },
		{ "@type": "Course", provider: { "@id": organizationId } },
	],
};
assert.deepEqual(
	resolveSchemaOrganizationReferences(selfDefinedOrganization, settings, false),
	selfDefinedOrganization,
	"a custom graph keeps references to its own Organization definition",
);

const mediaLogo = "/_emdash/api/media/file/01JLOGO.png";
const mediaLogoSettings = { ...settings, orgLogo: mediaLogo };
assert.equal(organizationSchema(mediaLogoSettings).logo, `https://example.com${mediaLogo}`, "a media logo becomes absolute");
assert.equal(organizationSchema(settings).logo, settings.orgLogo, "an absolute logo is kept");
assert.equal(organizationSchema({ ...mediaLogoSettings, siteUrl: "" }).logo, undefined, "a media logo without a site origin is omitted");
assert.equal(organizationSchema({ ...settings, orgLogo: "javascript:alert(1)" }).logo, undefined, "a non-http logo is omitted");
const inlinePublisher = blogPostingSchema(articlePage, mediaLogoSettings, "").publisher as Record<string, unknown>;
assert.deepEqual(
	inlinePublisher,
	{ "@type": "Organization", name: "Example Studio BV", logo: { "@type": "ImageObject", url: `https://example.com${mediaLogo}` } },
	"an inline article publisher carries the absolute media logo",
);
assert.equal(
	(blogPostingSchema(articlePage, { ...mediaLogoSettings, siteUrl: "" }).publisher as Record<string, unknown>).logo,
	undefined,
	"an inline article publisher omits a logo it cannot make absolute",
);

function organizationReferences(value: unknown): number {
	if (Array.isArray(value)) return value.reduce((total: number, item) => total + organizationReferences(item), 0);
	if (!value || typeof value !== "object") return 0;
	const node = value as Record<string, unknown>;
	const own = node["@id"] === organizationId && Object.keys(node).every((key) => key === "@id") ? 1 : 0;
	return own + Object.values(node).reduce((total: number, item) => total + organizationReferences(item), 0);
}

for (const page of [servicePage, articlePage]) {
	const linked = buildSchemaPresetGraphs({ page, settings, presets: allPresets, data: {} });
	assert.ok(organizationReferences(linked.map((item) => item.graph)) > 0, `${page.path} links to the emitted Organization`);

	const disabledPresets = new Set(["organization"]);
	const unlinked = buildSchemaPresetGraphs({ page, settings, presets: allPresets, data: {}, disabledPresets });
	assert.ok(unlinked.some((item) => item.key === "organization"), `${page.path} still builds the disabled Organization for previews`);
	const emitted = unlinked.filter((item) => !disabledPresets.has(item.key));
	assert.equal(organizationReferences(emitted.map((item) => item.graph)), 0, `${page.path} leaves no dangling Organization reference`);
	for (const item of emitted) {
		const owner = (item.graph.publisher ?? item.graph.provider) as Record<string, unknown> | undefined;
		if (owner) assert.equal(owner.name, "Example Studio BV", `${item.key} names its organization inline`);
	}
}
assert.equal(
	organizationReferences(buildSchemaPresetGraphs({
		page: servicePage,
		settings,
		presets: { ...allPresets, organization: false },
		data: {},
	}).map((item) => item.graph)),
	0,
	"a globally disabled Organization is not referenced either",
);

for (const page of [servicePage, articlePage]) {
	const personGraphs = buildSchemaPresetGraphs({ page, settings: personPublisherSettings, presets: allPresets, data: {} });
	const publisher = personGraphs.find((item) => item.key === "organization");
	assert.equal(publisher?.type, "Person");
	assert.equal(publisher?.graph["@id"], "https://example.com/#person");
	const owner = personGraphs.find((item) => item.key === (page.pageType === "article" ? "blogPosting" : "service"))?.graph;
	assert.deepEqual(owner?.[page.pageType === "article" ? "publisher" : "provider"], { "@id": "https://example.com/#person" });
	const disabled = buildSchemaPresetGraphs({
		page,
		settings: personPublisherSettings,
		presets: allPresets,
		data: {},
		disabledPresets: ["organization"],
	});
	const inline = disabled.find((item) => item.key === (page.pageType === "article" ? "blogPosting" : "service"))?.graph;
	assert.deepEqual(inline?.[page.pageType === "article" ? "publisher" : "provider"], { "@type": "Person", name: "Ada Publisher" });
}
const personId = "https://example.com/#person";
assert.deepEqual(
	resolveSchemaOrganizationReferences({ provider: { "@id": organizationId } }, personPublisherSettings, true),
	{ provider: { "@id": personId } },
	"legacy publisher links follow a switch to Person",
);
assert.deepEqual(
	resolveSchemaOrganizationReferences({ provider: { "@id": personId } }, personPublisherSettings, false).provider,
	{ "@type": "Person", name: "Ada Publisher", url: "https://example.com/", sameAs: settings.sameAs },
	"disabled Person publisher is inlined without a dangling id",
);

// A served post through the real page:metadata hook and EmDash's merge, where the host Site URL
// differs from the saved Website URL. The page is what the host hands the hook after overlaying
// the entry's SEO panel: a stored site-relative image made absolute on the host's own origin.
// Structured data names the image og:image names, by the same URL; which image it uses is unchanged.
{
	const website = "https://www.example.com";
	const hostSite = "https://cms.example.net";
	const storedImage = "/_emdash/api/media/file/01JPOSTIMAGE.png";
	const definition = { slug: "posts", label: "Posts", routable: true, hasSeo: true, hidden: false };
	const refuse = async () => { throw new Error("Metadata cannot write data."); };
	const siteSettings = { version: SEO_ADMIN_SETTINGS_STORAGE_VERSION, updatedAt: "2026-10-20T00:00:00.000Z",
		...defaultSettingsValues({ siteName: "Example Studio", siteUrl: website }), indexingPreferenceConfirmed: true };
	const served = async (seoImage: string | null, pageImage: string | null, data: Record<string, unknown> = {}) => {
		const item = { id: "post-1", slug: "schema-graphs", status: "published", locale: "en", updatedAt: "2026-10-20T00:00:00.000Z",
			data: { title: "Schema graphs", excerpt: "A served post.", ...data },
			seo: { title: null, description: null, canonical: null, image: seoImage, noIndex: false } };
		const store = { get: async () => null, getMany: async () => new Map(), query: async () => ({ items: [], hasMore: false }),
			count: async () => 0, put: refuse, putMany: refuse, delete: refuse, deleteMany: refuse };
		const ctx: any = {
			plugin: { id: "shipit-seo", version: SEO_ENGINE_VERSION }, site: { url: hostSite, name: "Example Studio", locale: "en" },
			kv: {
				get: async () => null,
				getVersioned: async (key: string) => key === "settings:global:v1" ? { revision: "fixture-settings", value: structuredClone(siteSettings) } : null,
				set: refuse, delete: refuse, compareAndSet: refuse, compareAndDelete: refuse,
			},
			storage: new Proxy({}, { get: () => store }),
			content: { get: async (_collection: string, id: string) => id === "post-1" ? structuredClone(item) : null,
				getPublicUrl: async () => website + "/blog/schema-graphs", listCollections: async () => [definition] },
			schema: { getCollection: async () => definition, listCollections: async () => [definition] },
			settings: { get: async () => null, getVersioned: async () => null, getAll: async () => ({}) },
			http: { fetch: async () => { throw new Error("No provider requests."); } },
			cron: { schedule: refuse, cancel: refuse },
			log: { warn() {}, info() {}, error() {} },
		};
		const page: PublicPageContext = { url: hostSite + "/blog/schema-graphs", path: "/blog/schema-graphs", locale: "en",
			kind: "content", pageType: "article", title: "Schema graphs", pageTitle: "Schema graphs", description: "A served post.",
			canonical: website + "/blog/schema-graphs", image: pageImage, content: { collection: "posts", id: "post-1", slug: "schema-graphs" },
			...(pageImage ? { seo: { ogImage: pageImage } } : {}), siteName: "Example Studio" };
		const output = await createSeoEngine().hooks["page:metadata"].handler({ page }, ctx) as any[];
		const merged = resolvePageMetadata([...output, ...generateBaseSeoContributions(page)]);
		const ogImage = merged.properties.filter((tag) => tag.property === "og:image").map((tag) => tag.content);
		const twitterImage = merged.meta.filter((tag) => tag.name === "twitter:image").map((tag) => tag.content);
		const primary = merged.jsonld.filter((graph) => graph.id === "primary").map((graph) => JSON.parse(graph.json));
		assert.equal(ogImage.length, 1, "one og:image reaches the page");
		assert.deepEqual(twitterImage, ogImage, "twitter:image names the og:image URL");
		assert.equal(primary.length, 1);
		assert.equal(primary[0]["@type"], "BlogPosting");
		assert.equal(primary[0]["@id"], website + "/blog/schema-graphs#article", "the post's own BlogPosting is the primary graph");
		return { ogImage: ogImage[0], schemaImage: primary[0].image as string | undefined };
	};

	const themeImage = await served(storedImage, hostSite + "/images/theme-card.png");
	assert.equal(themeImage.ogImage, website + storedImage);
	assert.equal(themeImage.schemaImage, hostSite + "/images/theme-card.png", "a page image that is another image stays the one structured data uses");

	const featuredOnly = await served(null, null, { featured_image: "/_emdash/api/media/file/01JFEATURED.png" });
	assert.equal(featuredOnly.ogImage, website + "/_emdash/api/media/file/01JFEATURED.png");
	assert.equal(featuredOnly.schemaImage, undefined, "the featured image does not become a structured data image");

	const remote = "https://cdn.example.org/cards/post.png";
	const remoteImage = await served(remote, remote);
	assert.deepEqual([remoteImage.ogImage, remoteImage.schemaImage], [remote, remote], "an absolute stored image keeps its own origin");

	const ownImage = await served(storedImage, hostSite + storedImage);
	assert.equal(ownImage.ogImage, website + storedImage, "og:image resolves the stored image against the Website URL");
	assert.equal(ownImage.schemaImage, ownImage.ogImage, "the BlogPosting image is og:image's URL, not the host Site URL copy");
}

console.log("SEO schema self-check passed.");
