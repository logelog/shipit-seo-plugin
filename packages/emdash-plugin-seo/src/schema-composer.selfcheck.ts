import {
	SEO_SCHEMA_COMPOSER_RECIPES,
	composeSeoSchema,
	defaultSeoSchemaComposerInput,
	seoSchemaComposerFields,
	type SeoSchemaComposerInput,
	type SeoSchemaComposerRecipe,
} from "./schema-composer.ts";
import { validateCustomJsonLd } from "./lib.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

function inputFor(
	recipe: SeoSchemaComposerRecipe,
	values: Record<string, string> = {},
	overrides: Partial<SeoSchemaComposerInput> = {},
): SeoSchemaComposerInput {
	const defaults = defaultSeoSchemaComposerInput(recipe);
	const required: Record<SeoSchemaComposerRecipe, Record<string, string>> = {
		howTo: { steps: "Plan | Define the intended outcome\nPublish | Complete and review the work" },
		course: {},
		jobPosting: { addressLocality: "Amsterdam", addressCountry: "NL" },
		softwareApplication: { currency: "USD" },
		product: { currency: "CAD" },
		event: {
			startDate: "2026-09-20T19:30:00+02:00",
			locationName: "Shipit Studio",
			streetAddress: "Example Street 1",
			addressLocality: "Amsterdam",
			postalCode: "1011 AB",
			addressCountry: "NL",
		},
		localBusiness: {
			description: "A studio for search and content work.",
			streetAddress: "Example Street 1",
			addressLocality: "Amsterdam",
			postalCode: "1011 AB",
			addressCountry: "NL",
		},
		videoObject: { contentUrl: "https://cdn.example.com/video.mp4" },
	};
	return {
		...defaults,
		scope: "pages:example",
		...overrides,
		values: {
			...defaults.values,
			...required[recipe],
			...values,
			...(overrides.values ?? {}),
		},
	};
}

for (const recipe of SEO_SCHEMA_COMPOSER_RECIPES) {
	const result = composeSeoSchema(inputFor(recipe.key));
	check(`${recipe.label} recipe composes`, result.success, result.success ? "" : JSON.stringify(result.errors));
	if (!result.success) continue;
	const graph = JSON.parse(result.output.json) as Record<string, unknown>;
	const graphTypes = Array.isArray(graph["@type"]) ? graph["@type"] : [graph["@type"]];
	check(`${recipe.label} emits its schema type`, graphTypes.includes(recipe.schemaType), String(graph["@type"]));
	check(`${recipe.label} emits validated data`, Boolean(validateCustomJsonLd(result.output.json)));
	check(`${recipe.label} keeps a versioned snapshot`, result.output.snapshot.version === 1);
	check(`${recipe.label} exposes guided fields`, seoSchemaComposerFields(recipe.key).length >= 8);
}

const howTo = composeSeoSchema(inputFor("howTo", {
	steps: "Research | Confirm audience needs\nDraft | Write the first version\nReview the final result",
	tools: "Analytics suite\nContent editor",
	supplies: "Approved brief",
	totalTime: "PT3H",
	estimatedCost: "49.50",
	currency: "eur",
}));
if (howTo.success) {
	const graph = howTo.output.graph as any;
	check("HowTo emits ordered nested steps", graph.step.length === 3 && graph.step[1].position === 2);
	check("HowTo supports named and unnamed steps", graph.step[0].name === "Research" && graph.step[2].name === undefined);
	check("HowTo emits tools and supplies", graph.tool.length === 2 && graph.supply.length === 1);
	check("HowTo normalizes monetary data", graph.estimatedCost.currency === "EUR" && graph.estimatedCost.value === 49.5);
}

const customCourse = composeSeoSchema(inputFor("course", {
	providerName: "Shipit Academy",
	providerUrl: "https://example.com/academy",
	courseCode: "SEO-101",
	courseMode: "Blended",
	workload: "PT10H",
}));
if (customCourse.success) {
	const graph = customCourse.output.graph as any;
	check("Course emits a custom nested provider", graph.provider.name === "Shipit Academy");
	check("Course emits a delivery instance", graph.hasCourseInstance.courseMode === "Blended");
}
const siteCourse = composeSeoSchema(inputFor("course"));
check(
	"Course can reuse the site Organization entity",
	siteCourse.success && (siteCourse.output.graph.provider as any)["@id"] === "{{siteUrl}}/#organization",
);

const job = composeSeoSchema(inputFor("jobPosting", {
	datePosted: "2026-07-14",
	validThrough: "2026-08-31",
	streetAddress: "Example Street 1",
	postalCode: "1011 AB",
	addressCountry: "nl",
}));
if (job.success) {
	const graph = job.output.graph as any;
	check("JobPosting emits a nested postal address", graph.jobLocation.address.streetAddress === "Example Street 1");
	check("JobPosting normalizes the country code", graph.jobLocation.address.addressCountry === "NL");
	check("JobPosting reuses the site Organization by default", graph.hiringOrganization["@id"] === "{{siteUrl}}/#organization");
}

const software = composeSeoSchema(inputFor("softwareApplication", { price: "19.99", currency: "usd" }));
if (software.success) {
	const graph = software.output.graph as any;
	check("SoftwareApplication emits a normalized offer", graph.offers.price === 19.99 && graph.offers.priceCurrency === "USD");
	check("SoftwareApplication uses the canonical Organization id", graph.publisher["@id"] === "{{siteUrl}}/#organization");
}

const product = composeSeoSchema(inputFor("product", {
	sku: "SHIPIT-SEO-1",
	brand: "Shipit",
	price: "79.95",
	currency: "eur",
	priceValidUntil: "2026-12-31",
}));
if (product.success) {
	const graph = product.output.graph as any;
	check("Product emits its image and identifiers", graph.image === "{{image}}" && graph.sku === "SHIPIT-SEO-1");
	check("Product emits a rich-result offer", graph.offers.price === 79.95 && graph.offers.priceCurrency === "EUR");
	check("Product emits a typed brand", graph.brand["@type"] === "Brand" && graph.brand.name === "Shipit");
}

const event = composeSeoSchema(inputFor("event", {
	endDate: "2026-09-20T22:00:00+02:00",
	eventAttendanceMode: "https://schema.org/MixedEventAttendanceMode",
	virtualLocationUrl: "https://example.com/events/join",
	organizerName: "Shipit Events",
	organizerUrl: "https://example.com/events",
}));
if (event.success) {
	const graph = event.output.graph as any;
	check("Event emits physical and virtual locations", Array.isArray(graph.location) && graph.location.length === 2);
	check("Event emits a complete postal address", graph.location[0].address.addressCountry === "NL");
	check("Event emits a custom organizer", graph.organizer.name === "Shipit Events");
}
const siteEvent = composeSeoSchema(inputFor("event"));
check("Event uses the canonical Organization id", siteEvent.success && (siteEvent.output.graph.organizer as any)["@id"] === "{{siteUrl}}/#organization");

const localBusiness = composeSeoSchema(inputFor("localBusiness", {
	businessType: "ProfessionalService",
	telephone: "+31 20 000 0000",
	priceRange: "EUR 100-250",
	openingHours: "Mo-Fr 09:00-18:00\nSa 10:00-16:00",
}));
if (localBusiness.success) {
	const graph = localBusiness.output.graph as any;
	check("LocalBusiness emits a supported subtype", Array.isArray(graph["@type"]) && graph["@type"][1] === "ProfessionalService");
	check("LocalBusiness emits a complete address", graph.address.postalCode === "1011 AB");
	check("LocalBusiness emits bounded opening hours", graph.openingHours.length === 2);
}

const video = composeSeoSchema(inputFor("videoObject", {
	contentUrl: "",
	embedUrl: "https://player.example.com/embed/123",
	duration: "PT2M30S",
}));
if (video.success) {
	const graph = video.output.graph as any;
	check("VideoObject emits Google-required discovery fields", graph.thumbnailUrl === "{{image}}" && graph.uploadDate === "{{publishedAt}}");
	check("VideoObject accepts an embed URL fallback", graph.embedUrl === "https://player.example.com/embed/123" && graph.duration === "PT2M30S");
}

const invalidRecipe = composeSeoSchema({
	recipe: "script",
	schemaName: "Unsafe",
	scope: "global",
	enabled: true,
	values: {},
});
check("unknown recipes are rejected", !invalidRecipe.success && Boolean(invalidRecipe.errors.recipe));

const invalidUrl = composeSeoSchema(inputFor("course", { url: "javascript:alert(1)" }));
check("non-http URLs are rejected", !invalidUrl.success && Boolean(invalidUrl.errors.url));

const unknownVariable = composeSeoSchema(inputFor("course", { name: "{{unknownField}}" }));
check("unknown page variables are rejected", !unknownVariable.success && Boolean(unknownVariable.errors.name));

const invalidDuration = composeSeoSchema(inputFor("howTo", { totalTime: "three hours" }));
check("invalid ISO durations are rejected", !invalidDuration.success && Boolean(invalidDuration.errors.totalTime));

const missingSteps = composeSeoSchema(inputFor("howTo", { steps: "Only one step" }));
check("HowTo requires at least two steps", !missingSteps.success && Boolean(missingSteps.errors.steps));

const invalidDates = composeSeoSchema(inputFor("jobPosting", {
	datePosted: "2026-08-31",
	validThrough: "2026-08-01",
}));
check("JobPosting rejects a closing date before publication", !invalidDates.success && Boolean(invalidDates.errors.validThrough));

const invalidCategory = composeSeoSchema(inputFor("softwareApplication", { applicationCategory: "AnythingApplication" }));
check("select fields reject unsupported values", !invalidCategory.success && Boolean(invalidCategory.errors.applicationCategory));

const productWithoutImage = composeSeoSchema(inputFor("product", { image: "" }));
check("Product requires a crawlable image", !productWithoutImage.success && Boolean(productWithoutImage.errors.image));

const invalidEventDates = composeSeoSchema(inputFor("event", {
	startDate: "2026-09-20T22:00:00+02:00",
	endDate: "2026-09-20T19:30:00+02:00",
}));
check("Event rejects an end before its start", !invalidEventDates.success && Boolean(invalidEventDates.errors.endDate));

const onlineEventWithoutUrl = composeSeoSchema(inputFor("event", {
	eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
	virtualLocationUrl: "",
}));
check("Online Event requires a virtual location", !onlineEventWithoutUrl.success && Boolean(onlineEventWithoutUrl.errors.virtualLocationUrl));

const localBusinessWithInvalidCountry = composeSeoSchema(inputFor("localBusiness", { addressCountry: "Netherlands" }));
check("LocalBusiness requires an ISO country code", !localBusinessWithInvalidCountry.success && Boolean(localBusinessWithInvalidCountry.errors.addressCountry));

const videoWithoutPlayback = composeSeoSchema(inputFor("videoObject", { contentUrl: "", embedUrl: "" }));
check("VideoObject requires a playback URL", !videoWithoutPlayback.success && Boolean(videoWithoutPlayback.errors.contentUrl));

for (const recipe of SEO_SCHEMA_COMPOSER_RECIPES) {
	check(`${recipe.label} default names no collection`, defaultSeoSchemaComposerInput(recipe.key).scope === "");
	const unscoped = composeSeoSchema(inputFor(recipe.key, {}, { scope: "" }));
	check(`${recipe.label} requires an explicit scope`, !unscoped.success && Boolean(unscoped.errors.scope));
}

for (const recipe of ["product", "event", "jobPosting"] as const) {
	for (const scope of ["pages", "global"]) {
		const repeated = composeSeoSchema(inputFor(recipe, {}, { scope }));
		check(`${recipe} rejects the repeating scope ${scope}`, !repeated.success && Boolean(repeated.errors.scope));
	}
}

check("LocalBusiness draft preselects no country", !defaultSeoSchemaComposerInput("localBusiness").values.addressCountry);
for (const [recipe, field] of [
	["howTo", "currency"],
	["jobPosting", "addressCountry"],
	["softwareApplication", "currency"],
	["product", "currency"],
	["event", "addressCountry"],
] as const) {
	check(`${recipe} draft preselects no ${field}`, !defaultSeoSchemaComposerInput(recipe).values[field]);
	check(`${recipe} has no locale-specific ${field} placeholder`,
		!seoSchemaComposerFields(recipe).some((item) => item.key === field && /\b(?:NL|EUR)\b/.test(item.placeholder ?? "")));
}
for (const [recipe, field] of [
	["jobPosting", "addressCountry"],
	["softwareApplication", "currency"],
	["product", "currency"],
	["event", "addressCountry"],
] as const) {
	const missing = composeSeoSchema(inputFor(recipe, { [field]: "" }));
	check(`${recipe} still requires ${field}`, !missing.success && Boolean(missing.errors[field]));
}
const businessWithoutCountry = composeSeoSchema(inputFor("localBusiness", { addressCountry: "" }));
check("LocalBusiness requires an entered country", !businessWithoutCountry.success && Boolean(businessWithoutCountry.errors.addressCountry));

const businessPerCollection = composeSeoSchema(inputFor("localBusiness", {}, { scope: "pages" }));
check("LocalBusiness rejects a collection scope", !businessPerCollection.success && Boolean(businessPerCollection.errors.scope));
const siteBusiness = composeSeoSchema(inputFor("localBusiness", {}, { scope: "global" }));
check("LocalBusiness defaults describe the whole site", siteBusiness.success, siteBusiness.success ? "" : JSON.stringify(siteBusiness.errors));
if (siteBusiness.success) {
	check("site-wide LocalBusiness keeps one entity id", (siteBusiness.output.graph as any)["@id"] === "{{siteUrl}}#local-business");
}
const pageVaryingBusiness = composeSeoSchema(inputFor("localBusiness", { name: "{{title}}", url: "{{canonical}}" }, { scope: "global" }));
check(
	"site-wide LocalBusiness rejects page variables",
	!pageVaryingBusiness.success && Boolean(pageVaryingBusiness.errors.name) && Boolean(pageVaryingBusiness.errors.url),
);
const locationPageBusiness = composeSeoSchema(inputFor("localBusiness", { url: "{{canonical}}" }, { scope: "pages:contact" }));
check("one-entry LocalBusiness may use page variables", locationPageBusiness.success);

for (const scope of ["posts", "global"]) {
	const reusable = composeSeoSchema(inputFor("howTo", {}, { scope }));
	check(`HowTo still allows the ${scope} scope`, reusable.success);
}

const tooManySteps = Array.from({ length: 51 }, (_, index) => `Step ${index + 1}`).join("\n");
const oversizedHowTo = composeSeoSchema(inputFor("howTo", { steps: tooManySteps }));
check("nested item counts are bounded", !oversizedHowTo.success && Boolean(oversizedHowTo.errors.steps));

console.log(failures === 0 ? "\nALL SEO SCHEMA COMPOSER CHECKS PASSED" : `\n${failures} SEO SCHEMA COMPOSER CHECK(S) FAILED`);
if (failures > 0) throw new Error(`${failures} SEO schema composer self-check(s) failed`);
