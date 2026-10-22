import {
	templateVariables,
	unknownTemplateVariables,
	validateCustomJsonLd,
} from "./lib.ts";

export const SEO_SCHEMA_COMPOSER_VERSION = 1 as const;

export type SeoSchemaScopeKind = "global" | "collection" | "entry";

// Recipe values other than page variables are fixed, so a scope wider than one
// entry repeats them on every matching page. Recipes that describe one real-world
// thing stay on a single entry; a business may also describe the whole site.
const ANY_SCOPE = ["entry", "collection", "global"] as const satisfies readonly SeoSchemaScopeKind[];
const ENTRY_SCOPE = ["entry"] as const satisfies readonly SeoSchemaScopeKind[];
const BUSINESS_SCOPE = ["entry", "global"] as const satisfies readonly SeoSchemaScopeKind[];

export const SEO_SCHEMA_COMPOSER_RECIPES = [
	{
		key: "howTo",
		label: "HowTo",
		schemaType: "HowTo",
		description: "A guided process with ordered steps, tools, supplies, duration, and cost.",
		scopes: ANY_SCOPE,
	},
	{
		key: "course",
		label: "Course",
		schemaType: "Course",
		description: "A course and optional delivery instance connected to its provider.",
		scopes: ANY_SCOPE,
	},
	{
		key: "jobPosting",
		label: "Job posting",
		schemaType: "JobPosting",
		description: "A dated vacancy with employment type, organization, and physical location.",
		scopes: ENTRY_SCOPE,
	},
	{
		key: "softwareApplication",
		label: "Software application",
		schemaType: "SoftwareApplication",
		description: "An application with platform, category, publisher, and price offer.",
		scopes: ANY_SCOPE,
	},
	{
		key: "product",
		label: "Product",
		schemaType: "Product",
		description: "A product with identifiers, brand, image, and a purchasable offer.",
		scopes: ENTRY_SCOPE,
	},
	{
		key: "event",
		label: "Event",
		schemaType: "Event",
		description: "A scheduled physical, online, or mixed event with a verifiable location.",
		scopes: ENTRY_SCOPE,
	},
	{
		key: "localBusiness",
		label: "Local business",
		schemaType: "LocalBusiness",
		description: "A physical business location with a complete postal address and opening hours.",
		scopes: BUSINESS_SCOPE,
	},
	{
		key: "videoObject",
		label: "Video",
		schemaType: "VideoObject",
		description: "A searchable video with thumbnail, publication date, and playback URL.",
		scopes: ANY_SCOPE,
	},
] as const;

export type SeoSchemaComposerRecipe = (typeof SEO_SCHEMA_COMPOSER_RECIPES)[number]["key"];

export type SeoSchemaComposerFieldKey =
	| "name"
	| "description"
	| "url"
	| "image"
	| "steps"
	| "totalTime"
	| "tools"
	| "supplies"
	| "estimatedCost"
	| "currency"
	| "courseCode"
	| "providerName"
	| "providerUrl"
	| "courseMode"
	| "workload"
	| "datePosted"
	| "validThrough"
	| "employmentType"
	| "organizationName"
	| "organizationUrl"
	| "locationName"
	| "streetAddress"
	| "addressLocality"
	| "addressRegion"
	| "postalCode"
	| "addressCountry"
	| "operatingSystem"
	| "applicationCategory"
	| "price"
	| "sku"
	| "brand"
	| "availability"
	| "itemCondition"
	| "priceValidUntil"
	| "startDate"
	| "endDate"
	| "eventStatus"
	| "eventAttendanceMode"
	| "virtualLocationUrl"
	| "organizerName"
	| "organizerUrl"
	| "businessType"
	| "telephone"
	| "priceRange"
	| "openingHours"
	| "thumbnailUrl"
	| "uploadDate"
	| "duration"
	| "contentUrl"
	| "embedUrl"
	| "expires";

export interface SeoSchemaComposerFieldOption {
	label: string;
	value: string;
}

export interface SeoSchemaComposerFieldDefinition {
	key: SeoSchemaComposerFieldKey;
	label: string;
	description: string;
	required?: boolean;
	multiline?: boolean;
	placeholder?: string;
	options?: readonly SeoSchemaComposerFieldOption[];
}

const COMMON_FIELDS: readonly SeoSchemaComposerFieldDefinition[] = [
	{
		key: "name",
		label: "Entity name",
		description: "The public name or title of this entity.",
		required: true,
		placeholder: "{{title}}",
	},
	{
		key: "description",
		label: "Description",
		description: "A concise, factual description. Page variables are supported.",
		required: true,
		multiline: true,
		placeholder: "{{description}}",
	},
	{
		key: "url",
		label: "Canonical URL",
		description: "A full public URL or the {{canonical}} page variable.",
		required: true,
		placeholder: "{{canonical}}",
	},
	{
		key: "image",
		label: "Image URL",
		description: "Optional representative image URL or {{image}}.",
		placeholder: "{{image}}",
	},
];

const RECIPE_FIELDS: Record<SeoSchemaComposerRecipe, readonly SeoSchemaComposerFieldDefinition[]> = {
	howTo: [
		{
			key: "steps",
			label: "Steps",
			description: "One step per line. Use Title | instructions to add a step name.",
			required: true,
			multiline: true,
			placeholder: "Prepare | Gather the required materials\nBuild | Follow the documented process",
		},
		{
			key: "totalTime",
			label: "Total time",
			description: "Optional ISO 8601 duration, for example PT45M or P2D.",
			placeholder: "PT45M",
		},
		{
			key: "tools",
			label: "Tools",
			description: "Optional tool names, one per line.",
			multiline: true,
			placeholder: "Analytics dashboard\nContent editor",
		},
		{
			key: "supplies",
			label: "Supplies",
			description: "Optional supply or material names, one per line.",
			multiline: true,
		},
		{
			key: "estimatedCost",
			label: "Estimated cost",
			description: "Optional non-negative amount without a currency symbol.",
			placeholder: "49.00",
		},
		{
			key: "currency",
			label: "Currency",
			description: "Three-letter ISO currency used when a cost is supplied.",
			placeholder: "ISO 4217 code",
		},
	],
	course: [
		{
			key: "courseCode",
			label: "Course code",
			description: "Optional public identifier used by the provider.",
		},
		{
			key: "providerName",
			label: "Provider name",
			description: "Leave blank to use the site organization.",
		},
		{
			key: "providerUrl",
			label: "Provider URL",
			description: "Optional URL for a custom provider.",
		},
		{
			key: "courseMode",
			label: "Course mode",
			description: "How the course is delivered.",
			options: [
				{ label: "Online", value: "Online" },
				{ label: "Onsite", value: "Onsite" },
				{ label: "Blended", value: "Blended" },
			],
		},
		{
			key: "workload",
			label: "Course workload",
			description: "Optional ISO 8601 duration, for example PT10H or P5D.",
			placeholder: "PT10H",
		},
	],
	jobPosting: [
		{
			key: "datePosted",
			label: "Date posted",
			description: "ISO date or {{publishedAt}}.",
			required: true,
			placeholder: "{{publishedAt}}",
		},
		{
			key: "validThrough",
			label: "Valid through",
			description: "Optional closing date in ISO format.",
			placeholder: "2026-12-31",
		},
		{
			key: "employmentType",
			label: "Employment type",
			description: "The primary employment arrangement.",
			required: true,
			options: [
				{ label: "Full time", value: "FULL_TIME" },
				{ label: "Part time", value: "PART_TIME" },
				{ label: "Contractor", value: "CONTRACTOR" },
				{ label: "Temporary", value: "TEMPORARY" },
				{ label: "Intern", value: "INTERN" },
				{ label: "Volunteer", value: "VOLUNTEER" },
			],
		},
		{
			key: "organizationName",
			label: "Hiring organization",
			description: "Leave blank to use the site organization.",
		},
		{
			key: "organizationUrl",
			label: "Organization URL",
			description: "Optional URL for a custom hiring organization.",
		},
		{
			key: "locationName",
			label: "Location name",
			description: "Optional office or venue name.",
		},
		{
			key: "streetAddress",
			label: "Street address",
			description: "Optional street and house number.",
		},
		{
			key: "addressLocality",
			label: "City",
			description: "City or locality for this role.",
			required: true,
		},
		{
			key: "addressRegion",
			label: "Region",
			description: "Optional state, province, or region.",
		},
		{
			key: "postalCode",
			label: "Postal code",
			description: "Optional postal code.",
		},
		{
			key: "addressCountry",
			label: "Country code",
			description: "Two-letter ISO 3166-1 country code.",
			required: true,
			placeholder: "ISO 3166-1 code",
		},
	],
	softwareApplication: [
		{
			key: "operatingSystem",
			label: "Operating system",
			description: "Supported platform, for example Web, Windows, iOS, or Android.",
			required: true,
			placeholder: "Web",
		},
		{
			key: "applicationCategory",
			label: "Application category",
			description: "The closest schema.org application category.",
			required: true,
			options: [
				{ label: "Business application", value: "BusinessApplication" },
				{ label: "Design application", value: "DesignApplication" },
				{ label: "Developer application", value: "DeveloperApplication" },
				{ label: "Finance application", value: "FinanceApplication" },
				{ label: "Game application", value: "GameApplication" },
				{ label: "Mobile application", value: "MobileApplication" },
				{ label: "Web application", value: "WebApplication" },
			],
		},
		{
			key: "price",
			label: "Price",
			description: "Non-negative amount. Use 0 for a free application.",
			required: true,
			placeholder: "0",
		},
		{
			key: "currency",
			label: "Currency",
			description: "Three-letter ISO currency for the offer.",
			required: true,
			placeholder: "ISO 4217 code",
		},
	],
	product: [
		{
			key: "sku",
			label: "SKU",
			description: "Optional merchant-specific product identifier.",
		},
		{
			key: "brand",
			label: "Brand",
			description: "Optional public brand name for the product.",
		},
		{
			key: "price",
			label: "Price",
			description: "Current non-negative offer price without a currency symbol.",
			required: true,
			placeholder: "49.00",
		},
		{
			key: "currency",
			label: "Currency",
			description: "Three-letter ISO currency for the offer.",
			required: true,
			placeholder: "ISO 4217 code",
		},
		{
			key: "availability",
			label: "Availability",
			description: "Current inventory state for the offer.",
			required: true,
			options: [
				{ label: "In stock", value: "https://schema.org/InStock" },
				{ label: "Out of stock", value: "https://schema.org/OutOfStock" },
				{ label: "Pre-order", value: "https://schema.org/PreOrder" },
				{ label: "Back order", value: "https://schema.org/BackOrder" },
				{ label: "Limited availability", value: "https://schema.org/LimitedAvailability" },
			],
		},
		{
			key: "itemCondition",
			label: "Item condition",
			description: "Condition of the product attached to this offer.",
			required: true,
			options: [
				{ label: "New", value: "https://schema.org/NewCondition" },
				{ label: "Used", value: "https://schema.org/UsedCondition" },
				{ label: "Refurbished", value: "https://schema.org/RefurbishedCondition" },
				{ label: "Damaged", value: "https://schema.org/DamagedCondition" },
			],
		},
		{
			key: "priceValidUntil",
			label: "Price valid until",
			description: "Optional ISO date after which this price should no longer be used.",
			placeholder: "2026-12-31",
		},
	],
	event: [
		{
			key: "startDate",
			label: "Start date",
			description: "Event start in ISO date or date-time format.",
			required: true,
			placeholder: "2026-09-20T19:30:00Z",
		},
		{
			key: "endDate",
			label: "End date",
			description: "Optional event end in ISO date or date-time format.",
			placeholder: "2026-09-20T22:00:00Z",
		},
		{
			key: "eventStatus",
			label: "Event status",
			description: "Current lifecycle state for the event.",
			required: true,
			options: [
				{ label: "Scheduled", value: "https://schema.org/EventScheduled" },
				{ label: "Postponed", value: "https://schema.org/EventPostponed" },
				{ label: "Rescheduled", value: "https://schema.org/EventRescheduled" },
				{ label: "Cancelled", value: "https://schema.org/EventCancelled" },
				{ label: "Moved online", value: "https://schema.org/EventMovedOnline" },
			],
		},
		{
			key: "eventAttendanceMode",
			label: "Attendance mode",
			description: "Whether visitors attend physically, online, or both.",
			required: true,
			options: [
				{ label: "Physical", value: "https://schema.org/OfflineEventAttendanceMode" },
				{ label: "Online", value: "https://schema.org/OnlineEventAttendanceMode" },
				{ label: "Mixed", value: "https://schema.org/MixedEventAttendanceMode" },
			],
		},
		{
			key: "locationName",
			label: "Venue name",
			description: "Required for physical and mixed events.",
		},
		{
			key: "streetAddress",
			label: "Street address",
			description: "Required for physical and mixed events.",
		},
		{
			key: "addressLocality",
			label: "City",
			description: "Required for physical and mixed events.",
		},
		{
			key: "addressRegion",
			label: "Region",
			description: "Optional state, province, or region.",
		},
		{
			key: "postalCode",
			label: "Postal code",
			description: "Required for physical and mixed events.",
		},
		{
			key: "addressCountry",
			label: "Country code",
			description: "Two-letter ISO 3166-1 country code for the venue.",
			placeholder: "ISO 3166-1 code",
		},
		{
			key: "virtualLocationUrl",
			label: "Online event URL",
			description: "Required for online and mixed events.",
			placeholder: "https://example.com/events/join",
		},
		{
			key: "organizerName",
			label: "Organizer name",
			description: "Leave blank to use the site organization.",
		},
		{
			key: "organizerUrl",
			label: "Organizer URL",
			description: "Optional URL for a custom organizer.",
		},
	],
	localBusiness: [
		{
			key: "businessType",
			label: "Business type",
			description: "Choose the closest supported LocalBusiness subtype.",
			required: true,
			options: [
				{ label: "Local business", value: "LocalBusiness" },
				{ label: "Professional service", value: "ProfessionalService" },
				{ label: "Store", value: "Store" },
				{ label: "Restaurant", value: "Restaurant" },
				{ label: "Home and construction business", value: "HomeAndConstructionBusiness" },
				{ label: "Health and beauty business", value: "HealthAndBeautyBusiness" },
			],
		},
		{
			key: "streetAddress",
			label: "Street address",
			description: "Street, house number, and unit where relevant.",
			required: true,
		},
		{
			key: "addressLocality",
			label: "City",
			description: "City or locality for this business location.",
			required: true,
		},
		{
			key: "addressRegion",
			label: "Region",
			description: "Optional state, province, or region.",
		},
		{
			key: "postalCode",
			label: "Postal code",
			description: "Postal code for this business location.",
			required: true,
		},
		{
			key: "addressCountry",
			label: "Country code",
			description: "Two-letter ISO 3166-1 country code.",
			required: true,
			placeholder: "ISO 3166-1 code",
		},
		{
			key: "telephone",
			label: "Telephone",
			description: "Optional public telephone number including country code.",
			placeholder: "+[country code] [number]",
		},
		{
			key: "priceRange",
			label: "Price range",
			description: "Optional compact public price indicator, for example $$$.",
		},
		{
			key: "openingHours",
			label: "Opening hours",
			description: "Optional schema.org opening-hours value, one period per line.",
			multiline: true,
			placeholder: "Mo-Fr 09:00-18:00\nSa 10:00-16:00",
		},
	],
	videoObject: [
		{
			key: "thumbnailUrl",
			label: "Thumbnail URL",
			description: "Unique crawlable thumbnail image for this video.",
			required: true,
			placeholder: "{{image}}",
		},
		{
			key: "uploadDate",
			label: "Upload date",
			description: "First publication date or date-time in ISO format.",
			required: true,
			placeholder: "{{publishedAt}}",
		},
		{
			key: "duration",
			label: "Duration",
			description: "Optional ISO 8601 duration, for example PT2M30S.",
			placeholder: "PT2M30S",
		},
		{
			key: "contentUrl",
			label: "Video file URL",
			description: "Preferred direct URL to the actual video file.",
			placeholder: "https://cdn.example.com/video.mp4",
		},
		{
			key: "embedUrl",
			label: "Player embed URL",
			description: "Player URL when a direct video file URL is unavailable.",
			placeholder: "https://player.example.com/embed/123",
		},
		{
			key: "expires",
			label: "Expires",
			description: "Optional ISO date or date-time after which the video is unavailable.",
		},
	],
};

export interface SeoSchemaComposerInput {
	id?: string;
	recipe: SeoSchemaComposerRecipe;
	schemaName: string;
	scope: string;
	enabled: boolean;
	values: Partial<Record<SeoSchemaComposerFieldKey, unknown>>;
}

export interface SeoSchemaComposerSnapshot {
	version: typeof SEO_SCHEMA_COMPOSER_VERSION;
	recipe: SeoSchemaComposerRecipe;
	values: Partial<Record<SeoSchemaComposerFieldKey, string>>;
}

export type SeoSchemaComposerErrorKey =
	| "id"
	| "recipe"
	| "schemaName"
	| "scope"
	| "enabled"
	| SeoSchemaComposerFieldKey
	| "_form";

export type SeoSchemaComposerErrors = Partial<Record<SeoSchemaComposerErrorKey, string>>;

export interface SeoSchemaComposerOutput {
	id?: string;
	recipe: SeoSchemaComposerRecipe;
	schemaName: string;
	scope: string;
	enabled: boolean;
	values: Partial<Record<SeoSchemaComposerFieldKey, string>>;
	graph: Record<string, unknown>;
	json: string;
	snapshot: SeoSchemaComposerSnapshot;
}

export type SeoSchemaComposerResult =
	| { success: true; output: SeoSchemaComposerOutput }
	| { success: false; errors: SeoSchemaComposerErrors };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}(?::[A-Za-z0-9][A-Za-z0-9._~%-]{0,119})?$/;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DURATION_PATTERN = /^P(?=.+\d)(?:\d+(?:\.\d+)?D)?(?:T(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$/;
const TEMPLATE_PATTERN = /\{\{\s*[\w.]+\s*\}\}/g;

export function isSeoSchemaComposerRecipe(value: unknown): value is SeoSchemaComposerRecipe {
	return typeof value === "string" && SEO_SCHEMA_COMPOSER_RECIPES.some((recipe) => recipe.key === value);
}

export function seoSchemaComposerRecipe(recipe: SeoSchemaComposerRecipe) {
	return SEO_SCHEMA_COMPOSER_RECIPES.find((item) => item.key === recipe)!;
}

export function seoSchemaScopeKind(scope: string): SeoSchemaScopeKind {
	if (scope === "global") return "global";
	return scope.includes(":") ? "entry" : "collection";
}

export function seoSchemaComposerScopes(recipe: SeoSchemaComposerRecipe): readonly SeoSchemaScopeKind[] {
	return seoSchemaComposerRecipe(recipe).scopes;
}

export function seoSchemaComposerFields(recipe: SeoSchemaComposerRecipe): readonly SeoSchemaComposerFieldDefinition[] {
	const common = COMMON_FIELDS.flatMap((field) => {
		if (recipe === "videoObject" && field.key === "image") return [];
		if (recipe === "product" && field.key === "image") {
			return [{ ...field, label: "Product image URL", required: true }];
		}
		return [field];
	});
	return [...common, ...RECIPE_FIELDS[recipe]];
}

export function defaultSeoSchemaComposerInput(recipe: SeoSchemaComposerRecipe): SeoSchemaComposerInput {
	const definition = seoSchemaComposerRecipe(recipe);
	const values: Partial<Record<SeoSchemaComposerFieldKey, string>> = {
		name: "{{title}}",
		description: "{{description}}",
		url: "{{canonical}}",
	};
	if (recipe === "course") Object.assign(values, { courseMode: "Online" });
	if (recipe === "jobPosting") {
		Object.assign(values, {
			datePosted: "{{publishedAt}}",
			employmentType: "FULL_TIME",
		});
	}
	if (recipe === "softwareApplication") {
		Object.assign(values, {
			operatingSystem: "Web",
			applicationCategory: "BusinessApplication",
			price: "0",
		});
	}
	if (recipe === "product") {
		Object.assign(values, {
			image: "{{image}}",
			price: "0",
			availability: "https://schema.org/InStock",
			itemCondition: "https://schema.org/NewCondition",
		});
	}
	if (recipe === "event") {
		Object.assign(values, {
			eventStatus: "https://schema.org/EventScheduled",
			eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
		});
	}
	if (recipe === "localBusiness") {
		Object.assign(values, {
			name: "{{siteName}}",
			description: "",
			url: "{{siteUrl}}",
			businessType: "ProfessionalService",
		});
	}
	if (recipe === "videoObject") {
		Object.assign(values, {
			thumbnailUrl: "{{image}}",
			uploadDate: "{{publishedAt}}",
		});
	}
	return {
		recipe,
		schemaName: `${definition.label} schema`,
		scope: "",
		enabled: true,
		values,
	};
}

const SITE_VARIABLES = new Set(["siteName", "siteUrl"]);

function scopeMessage(recipe: SeoSchemaComposerRecipe): string {
	const definition = seoSchemaComposerRecipe(recipe);
	const scopes = seoSchemaComposerScopes(recipe);
	if (scopes.includes("collection")) return "Choose All pages, a content type, or one entry.";
	if (scopes.includes("global")) {
		return `Use global for the whole site or collection:entry-id for one page. A collection would repeat the same ${definition.schemaType} on every entry.`;
	}
	return `Use collection:entry-id for the one page this ${definition.schemaType} describes. A wider scope would repeat it on every matching page.`;
}

function cleanLineEndings(value: string): string {
	return value.replace(/\r\n?/g, "\n");
}

function textValue(
	input: Partial<Record<SeoSchemaComposerFieldKey, unknown>>,
	field: SeoSchemaComposerFieldDefinition,
	errors: SeoSchemaComposerErrors,
): string {
	const raw = input[field.key];
	if (raw === undefined || raw === null) {
		if (field.required) errors[field.key] = `${field.label} is required.`;
		return "";
	}
	if (typeof raw !== "string") {
		errors[field.key] = `${field.label} must be text.`;
		return "";
	}
	const value = field.multiline ? cleanLineEndings(raw).trim() : raw.trim();
	if (field.required && !value) errors[field.key] = `${field.label} is required.`;
	if (value.length > (field.multiline ? 20_000 : 2_048)) {
		errors[field.key] = `${field.label} is too long.`;
	}
	if (CONTROL_PATTERN.test(value)) errors[field.key] = `${field.label} contains unsupported control characters.`;
	const unknown = unknownTemplateVariables(value);
	if (unknown.length) errors[field.key] = `Unknown page variable: ${unknown.map((item) => `{{${item}}}`).join(", ")}.`;
	return value;
}

function isTemplateOnly(value: string): boolean {
	return /^\{\{\s*[\w.]+\s*\}\}$/.test(value);
}

function validateUrlField(
	field: SeoSchemaComposerFieldKey,
	value: string,
	errors: SeoSchemaComposerErrors,
): void {
	if (!value || errors[field]) return;
	const candidate = value.replace(TEMPLATE_PATTERN, "https://example.com");
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
	} catch {
		errors[field] = "Use a full http(s) URL or a supported page variable.";
	}
}

function validateDurationField(
	field: SeoSchemaComposerFieldKey,
	value: string,
	errors: SeoSchemaComposerErrors,
): void {
	if (!value || errors[field] || isTemplateOnly(value)) return;
	if (!DURATION_PATTERN.test(value) || value.endsWith("T")) {
		errors[field] = "Use an ISO 8601 duration such as PT45M, PT10H, or P2D.";
	}
}

function validateDateField(
	field: SeoSchemaComposerFieldKey,
	value: string,
	errors: SeoSchemaComposerErrors,
): void {
	if (!value || errors[field] || isTemplateOnly(value)) return;
	if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value) || Number.isNaN(Date.parse(value))) {
		errors[field] = "Use an ISO date, ISO date-time, or supported page variable.";
	}
}

function validateMoney(
	amountField: "estimatedCost" | "price",
	amount: string,
	currency: string,
	errors: SeoSchemaComposerErrors,
	required: boolean,
): void {
	if (required && !amount) errors[amountField] = "Enter a non-negative amount.";
	if (amount && (!/^\d+(?:\.\d{1,4})?$/.test(amount) || !Number.isFinite(Number(amount)))) {
		errors[amountField] = "Enter a non-negative amount with up to four decimals.";
	}
	if ((required || amount) && !/^[A-Za-z]{3}$/.test(currency)) {
		errors.currency = "Use a three-letter ISO currency code.";
	}
}

function requireValue(
	field: SeoSchemaComposerFieldKey,
	label: string,
	values: Partial<Record<SeoSchemaComposerFieldKey, string>>,
	errors: SeoSchemaComposerErrors,
): void {
	if (!values[field] && !errors[field]) errors[field] = `${label} is required.`;
}

function validateCountryCode(
	value: string,
	errors: SeoSchemaComposerErrors,
): void {
	if (!/^[A-Za-z]{2}$/.test(value)) {
		errors.addressCountry = "Use a two-letter ISO country code.";
	}
}

function lineItems(
	field: SeoSchemaComposerFieldKey,
	value: string,
	errors: SeoSchemaComposerErrors,
	minimum = 0,
): string[] {
	const items = cleanLineEndings(value).split("\n").map((item) => item.trim()).filter(Boolean);
	if (items.length < minimum) errors[field] = `Enter at least ${minimum} items, one per line.`;
	else if (items.length > 50) errors[field] = "Use 50 items or fewer.";
	else if (items.some((item) => item.length > 500)) errors[field] = "Keep each line to 500 characters or fewer.";
	return items;
}

function entityId(url: string, fragment: string): string {
	return `${url.replace(/#.*$/, "")}#${fragment}`;
}

function organizationNode(name: string, url: string): Record<string, unknown> {
	if (!name) return { "@id": "{{siteUrl}}/#organization" };
	return {
		"@type": "Organization",
		name,
		...(url ? { url } : {}),
	};
}

function commonGraph(type: string, fragment: string, values: Record<string, string>): Record<string, unknown> {
	return {
		"@context": "https://schema.org",
		"@type": type,
		"@id": entityId(values.url, fragment),
		name: values.name,
		description: values.description,
		url: values.url,
		...(values.image ? { image: values.image } : {}),
	};
}

function buildHowTo(values: Record<string, string>): Record<string, unknown> {
	const steps = lineItems("steps", values.steps, {}, 0).map((line, index) => {
		const separator = line.indexOf("|");
		const title = separator >= 0 ? line.slice(0, separator).trim() : "";
		const text = separator >= 0 ? line.slice(separator + 1).trim() : line;
		return {
			"@type": "HowToStep",
			position: index + 1,
			...(title ? { name: title } : {}),
			text,
		};
	});
	const tools = lineItems("tools", values.tools, {}).map((name) => ({ "@type": "HowToTool", name }));
	const supplies = lineItems("supplies", values.supplies, {}).map((name) => ({ "@type": "HowToSupply", name }));
	return {
		...commonGraph("HowTo", "how-to", values),
		step: steps,
		...(values.totalTime ? { totalTime: values.totalTime } : {}),
		...(tools.length ? { tool: tools } : {}),
		...(supplies.length ? { supply: supplies } : {}),
		...(values.estimatedCost ? {
			estimatedCost: {
				"@type": "MonetaryAmount",
				currency: values.currency.toUpperCase(),
				value: Number(values.estimatedCost),
			},
		} : {}),
	};
}

function buildCourse(values: Record<string, string>): Record<string, unknown> {
	const hasInstance = Boolean(values.courseMode || values.workload);
	return {
		...commonGraph("Course", "course", values),
		provider: organizationNode(values.providerName, values.providerUrl),
		...(values.courseCode ? { courseCode: values.courseCode } : {}),
		...(hasInstance ? {
			hasCourseInstance: {
				"@type": "CourseInstance",
				...(values.courseMode ? { courseMode: values.courseMode } : {}),
				...(values.workload ? { courseWorkload: values.workload } : {}),
			},
		} : {}),
	};
}

function buildJobPosting(values: Record<string, string>): Record<string, unknown> {
	return {
		...commonGraph("JobPosting", "job", values),
		title: values.name,
		datePosted: values.datePosted,
		...(values.validThrough ? { validThrough: values.validThrough } : {}),
		employmentType: values.employmentType,
		hiringOrganization: organizationNode(values.organizationName, values.organizationUrl),
		jobLocation: {
			"@type": "Place",
			...(values.locationName ? { name: values.locationName } : {}),
			address: {
				"@type": "PostalAddress",
				...(values.streetAddress ? { streetAddress: values.streetAddress } : {}),
				addressLocality: values.addressLocality,
				...(values.addressRegion ? { addressRegion: values.addressRegion } : {}),
				...(values.postalCode ? { postalCode: values.postalCode } : {}),
				addressCountry: values.addressCountry.toUpperCase(),
			},
		},
	};
}

function buildSoftwareApplication(values: Record<string, string>): Record<string, unknown> {
	return {
		...commonGraph("SoftwareApplication", "software", values),
		operatingSystem: values.operatingSystem,
		applicationCategory: values.applicationCategory,
		publisher: organizationNode("", ""),
		offers: {
			"@type": "Offer",
			price: Number(values.price),
			priceCurrency: values.currency.toUpperCase(),
			url: values.url,
		},
	};
}

function postalAddressNode(values: Record<string, string>): Record<string, unknown> {
	return {
		"@type": "PostalAddress",
		streetAddress: values.streetAddress,
		addressLocality: values.addressLocality,
		...(values.addressRegion ? { addressRegion: values.addressRegion } : {}),
		postalCode: values.postalCode,
		addressCountry: values.addressCountry.toUpperCase(),
	};
}

function buildProduct(values: Record<string, string>): Record<string, unknown> {
	return {
		...commonGraph("Product", "product", values),
		...(values.sku ? { sku: values.sku } : {}),
		...(values.brand ? { brand: { "@type": "Brand", name: values.brand } } : {}),
		offers: {
			"@type": "Offer",
			url: values.url,
			price: Number(values.price),
			priceCurrency: values.currency.toUpperCase(),
			availability: values.availability,
			itemCondition: values.itemCondition,
			...(values.priceValidUntil ? { priceValidUntil: values.priceValidUntil } : {}),
		},
	};
}

function buildEvent(values: Record<string, string>): Record<string, unknown> {
	const attendanceMode = values.eventAttendanceMode;
	const hasPhysicalLocation = attendanceMode !== "https://schema.org/OnlineEventAttendanceMode";
	const hasVirtualLocation = attendanceMode !== "https://schema.org/OfflineEventAttendanceMode";
	const locations: Record<string, unknown>[] = [];
	if (hasPhysicalLocation) {
		locations.push({
			"@type": "Place",
			name: values.locationName,
			address: postalAddressNode(values),
		});
	}
	if (hasVirtualLocation) {
		locations.push({
			"@type": "VirtualLocation",
			url: values.virtualLocationUrl,
		});
	}
	return {
		...commonGraph("Event", "event", values),
		startDate: values.startDate,
		...(values.endDate ? { endDate: values.endDate } : {}),
		eventStatus: values.eventStatus,
		eventAttendanceMode: attendanceMode,
		location: locations.length === 1 ? locations[0] : locations,
		organizer: organizationNode(values.organizerName, values.organizerUrl),
	};
}

function buildLocalBusiness(values: Record<string, string>): Record<string, unknown> {
	const graph = commonGraph("LocalBusiness", "local-business", values);
	if (values.businessType !== "LocalBusiness") {
		graph["@type"] = ["LocalBusiness", values.businessType];
	}
	const openingHours = lineItems("openingHours", values.openingHours, {});
	return {
		...graph,
		address: postalAddressNode(values),
		...(values.telephone ? { telephone: values.telephone } : {}),
		...(values.priceRange ? { priceRange: values.priceRange } : {}),
		...(openingHours.length ? { openingHours } : {}),
	};
}

function buildVideoObject(values: Record<string, string>): Record<string, unknown> {
	return {
		...commonGraph("VideoObject", "video", values),
		thumbnailUrl: values.thumbnailUrl,
		uploadDate: values.uploadDate,
		...(values.duration ? { duration: values.duration } : {}),
		...(values.contentUrl ? { contentUrl: values.contentUrl } : {}),
		...(values.embedUrl ? { embedUrl: values.embedUrl } : {}),
		...(values.expires ? { expires: values.expires } : {}),
	};
}

function buildGraph(recipe: SeoSchemaComposerRecipe, values: Record<string, string>): Record<string, unknown> {
	if (recipe === "howTo") return buildHowTo(values);
	if (recipe === "course") return buildCourse(values);
	if (recipe === "jobPosting") return buildJobPosting(values);
	if (recipe === "softwareApplication") return buildSoftwareApplication(values);
	if (recipe === "product") return buildProduct(values);
	if (recipe === "event") return buildEvent(values);
	if (recipe === "localBusiness") return buildLocalBusiness(values);
	return buildVideoObject(values);
}

export function composeSeoSchema(input: unknown): SeoSchemaComposerResult {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return { success: false, errors: { _form: "Schema composer input must be an object." } };
	}
	const source = input as Partial<SeoSchemaComposerInput>;
	const errors: SeoSchemaComposerErrors = {};
	const recipe = source.recipe;
	if (!isSeoSchemaComposerRecipe(recipe)) {
		return { success: false, errors: { recipe: "Choose a supported schema recipe." } };
	}

	let id: string | undefined;
	if (source.id !== undefined) {
		if (typeof source.id !== "string" || !ID_PATTERN.test(source.id.trim())) errors.id = "The schema identifier is invalid.";
		else id = source.id.trim();
	}
	const schemaName = typeof source.schemaName === "string" ? source.schemaName.trim() : "";
	if (!schemaName) errors.schemaName = "Enter an internal schema name.";
	else if (schemaName.length > 120) errors.schemaName = "Use 120 characters or fewer.";
	else if (CONTROL_PATTERN.test(schemaName)) errors.schemaName = "The schema name contains unsupported characters.";

	const scope = typeof source.scope === "string" ? source.scope.trim() : "";
	const scopeKind = seoSchemaScopeKind(scope);
	if ((scope !== "global" && !SCOPE_PATTERN.test(scope)) || !seoSchemaComposerScopes(recipe).includes(scopeKind)) {
		errors.scope = scopeMessage(recipe);
	}
	if (typeof source.enabled !== "boolean") errors.enabled = "Choose an enabled or disabled state.";
	const rawValues = source.values && typeof source.values === "object" && !Array.isArray(source.values)
		? source.values
		: {};
	const values: Partial<Record<SeoSchemaComposerFieldKey, string>> = {};
	for (const field of seoSchemaComposerFields(recipe)) {
		values[field.key] = textValue(rawValues, field, errors);
		if (
			field.options?.length &&
			values[field.key] &&
			!field.options.some((option) => option.value === values[field.key])
		) errors[field.key] = `Choose a supported ${field.label.toLowerCase()}.`;
	}

	validateUrlField("url", values.url ?? "", errors);
	validateUrlField("image", values.image ?? "", errors);
	if (recipe === "howTo") {
		lineItems("steps", values.steps ?? "", errors, 2);
		lineItems("tools", values.tools ?? "", errors);
		lineItems("supplies", values.supplies ?? "", errors);
		validateDurationField("totalTime", values.totalTime ?? "", errors);
		validateMoney("estimatedCost", values.estimatedCost ?? "", values.currency ?? "", errors, false);
	}
	if (recipe === "course") {
		validateUrlField("providerUrl", values.providerUrl ?? "", errors);
		if (values.providerUrl && !values.providerName) errors.providerName = "Enter a provider name when a custom provider URL is used.";
		validateDurationField("workload", values.workload ?? "", errors);
	}
	if (recipe === "jobPosting") {
		validateDateField("datePosted", values.datePosted ?? "", errors);
		validateDateField("validThrough", values.validThrough ?? "", errors);
		if (
			values.datePosted &&
			values.validThrough &&
			!isTemplateOnly(values.datePosted) &&
			!isTemplateOnly(values.validThrough) &&
			Date.parse(values.validThrough) <= Date.parse(values.datePosted)
		) errors.validThrough = "The closing date must be after the posting date.";
		validateUrlField("organizationUrl", values.organizationUrl ?? "", errors);
		if (values.organizationUrl && !values.organizationName) {
			errors.organizationName = "Enter an organization name when a custom URL is used.";
		}
		if (!/^[A-Za-z]{2}$/.test(values.addressCountry ?? "")) {
			errors.addressCountry = "Use a two-letter ISO country code.";
		}
	}
	if (recipe === "softwareApplication") {
		validateMoney("price", values.price ?? "", values.currency ?? "", errors, true);
	}
	if (recipe === "product") {
		validateMoney("price", values.price ?? "", values.currency ?? "", errors, true);
		validateDateField("priceValidUntil", values.priceValidUntil ?? "", errors);
	}
	if (recipe === "event") {
		validateDateField("startDate", values.startDate ?? "", errors);
		validateDateField("endDate", values.endDate ?? "", errors);
		if (
			values.startDate &&
			values.endDate &&
			!isTemplateOnly(values.startDate) &&
			!isTemplateOnly(values.endDate) &&
			Date.parse(values.endDate) <= Date.parse(values.startDate)
		) errors.endDate = "The end date must be after the start date.";
		validateUrlField("virtualLocationUrl", values.virtualLocationUrl ?? "", errors);
		validateUrlField("organizerUrl", values.organizerUrl ?? "", errors);
		if (values.organizerUrl && !values.organizerName) {
			errors.organizerName = "Enter an organizer name when a custom URL is used.";
		}
		const attendanceMode = values.eventAttendanceMode;
		const needsPhysical = attendanceMode !== "https://schema.org/OnlineEventAttendanceMode";
		const needsVirtual = attendanceMode !== "https://schema.org/OfflineEventAttendanceMode";
		if (needsPhysical) {
			requireValue("locationName", "Venue name", values, errors);
			requireValue("streetAddress", "Street address", values, errors);
			requireValue("addressLocality", "City", values, errors);
			requireValue("postalCode", "Postal code", values, errors);
			requireValue("addressCountry", "Country code", values, errors);
			if (values.addressCountry) validateCountryCode(values.addressCountry, errors);
		}
		if (needsVirtual) requireValue("virtualLocationUrl", "Online event URL", values, errors);
	}
	if (recipe === "localBusiness") {
		validateCountryCode(values.addressCountry ?? "", errors);
		lineItems("openingHours", values.openingHours ?? "", errors);
		if (scopeKind === "global" && !errors.scope) {
			for (const field of seoSchemaComposerFields(recipe)) {
				const value = values[field.key] ?? "";
				if (errors[field.key] || !templateVariables(value).some((name) => !SITE_VARIABLES.has(name))) continue;
				errors[field.key] = "A business on all pages can only use {{siteName}} and {{siteUrl}}. Page variables would change it on every page.";
			}
		}
	}
	if (recipe === "videoObject") {
		validateUrlField("thumbnailUrl", values.thumbnailUrl ?? "", errors);
		validateUrlField("contentUrl", values.contentUrl ?? "", errors);
		validateUrlField("embedUrl", values.embedUrl ?? "", errors);
		validateDateField("uploadDate", values.uploadDate ?? "", errors);
		validateDateField("expires", values.expires ?? "", errors);
		validateDurationField("duration", values.duration ?? "", errors);
		if (!values.contentUrl && !values.embedUrl) {
			errors.contentUrl = "Add a direct video file URL or a player embed URL.";
			errors.embedUrl = "Add a player embed URL or a direct video file URL.";
		}
	}

	if (Object.keys(errors).length) return { success: false, errors };
	const normalizedValues = values as Record<string, string>;
	const graph = buildGraph(recipe, normalizedValues);
	let json: string;
	try {
		json = JSON.stringify(validateCustomJsonLd(JSON.stringify(graph)), null, 2);
	} catch (error: unknown) {
		return {
			success: false,
			errors: { _form: error instanceof Error ? error.message : "The generated JSON-LD is invalid." },
		};
	}
	return {
		success: true,
		output: {
			...(id ? { id } : {}),
			recipe,
			schemaName,
			scope,
			enabled: source.enabled as boolean,
			values,
			graph,
			json,
			snapshot: { version: SEO_SCHEMA_COMPOSER_VERSION, recipe, values },
		},
	};
}
