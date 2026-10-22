// Business identity: one publisher and, for a local business, one location,
// stored as one versioned document. This module holds the shared model,
// validation, output and ownership rules used by the public hook, previews,
// analysis and the admin commands.
// No React, DOM, Node, SQL or network dependencies.

import type { PublicPageContext } from "emdash";

import {
	isFoodEstablishmentType,
	isLocalBusinessType,
	localBusinessTypeExclusion,
	type LocalBusinessType,
} from "./local-business-catalogue.ts";
import {
	applyVarsDeep,
	isHttpUrl,
	validateCustomJsonLd,
	type SchemaIdentityPublisher,
	type SchemaPublisherSource,
} from "./lib.ts";

export const BUSINESS_IDENTITY_STORAGE_VERSION = 1 as const;
/** The key under `ctx.settings`; `ctx.kv` addresses the same row with the `settings:` prefix. */
export const BUSINESS_IDENTITY_SETTINGS_KEY = "business-identity:v1";
export const BUSINESS_IDENTITY_KV_KEY = `settings:${BUSINESS_IDENTITY_SETTINGS_KEY}`;
export const BUSINESS_IDENTITY_MAX_BYTES = 16_384;
export const BUSINESS_IDENTITY_URL_MAX_LENGTH = 2048;

export const BUSINESS_IDENTITY_KINDS = ["Person", "Organization", "LocalBusiness"] as const;
export const BUSINESS_IDENTITY_CONTACT_TYPES = [
	"customer service",
	"technical support",
	"billing support",
	"sales",
	"reservations",
	"emergency",
] as const;
export const BUSINESS_IDENTITY_DAYS = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
] as const;
export const BUSINESS_IDENTITY_AREA_KINDS = ["Country", "State", "City", "Place"] as const;

export const BUSINESS_IDENTITY_LIMITS = {
	name: 120,
	alternateName: 120,
	legalName: 160,
	description: 500,
	telephone: 32,
	email: 254,
	contactPoints: 5,
	contactLanguages: 10,
	contactCountries: 10,
	sameAs: 10,
	streetAddress: 200,
	addressLocality: 100,
	addressRegion: 100,
	postalCode: 20,
	areaServed: 10,
	areaName: 100,
	periodsPerDay: 4,
	periodsPerWeek: 28,
	priceRange: 99,
	cuisines: 5,
	cuisine: 60,
	targetTitle: 200,
	mediaDimension: 100_000,
} as const;

/** Google asks for a logo of at least this many pixels on each side. */
export const BUSINESS_IDENTITY_LOGO_MIN_PIXELS = 112;
/** Google asks for coordinates with at least this many decimal places. */
export const BUSINESS_IDENTITY_GEO_DECIMALS = 5;

export type BusinessIdentityKind = (typeof BUSINESS_IDENTITY_KINDS)[number];
/** One most-specific type from the Schema.org catalogue in `local-business-catalogue.ts`. */
export type BusinessIdentityType = LocalBusinessType;
export type BusinessIdentityContactType = (typeof BUSINESS_IDENTITY_CONTACT_TYPES)[number];
export type BusinessIdentityDay = (typeof BUSINESS_IDENTITY_DAYS)[number];
export type BusinessIdentityFamily = "person" | "organization";

export interface BusinessIdentityMediaRef {
	url: string;
	width?: number;
	height?: number;
}

export interface BusinessIdentityContactPoint {
	contactType: BusinessIdentityContactType;
	telephone?: string;
	email?: string;
	availableLanguage: string[];
	areaServed: string[];
}

export interface BusinessIdentityAddress {
	streetAddress: string;
	addressLocality: string;
	addressRegion?: string;
	postalCode?: string;
	addressCountry: string;
}

export type BusinessIdentityAreaServed =
	| { kind: "Country"; countryCode: string }
	| { kind: "State" | "City" | "Place"; name: string; countryCode?: string };

export interface BusinessIdentityPeriod {
	opens: string;
	closes: string;
}

export type BusinessIdentityDayHours =
	| { state: "unknown" }
	| { state: "closed" }
	| { state: "open24" }
	| { state: "periods"; periods: BusinessIdentityPeriod[] };

export type BusinessIdentityHours =
	| { mode: "unpublished" }
	| { mode: "weekly"; days: Record<BusinessIdentityDay, BusinessIdentityDayHours> };

export interface BusinessIdentityLocation {
	geo?: { latitude: string; longitude: string };
	mapUrl?: string;
	hours: BusinessIdentityHours;
}

/**
 * Cuisine, menu and reservations for the FoodEstablishment family. The stored
 * key stays `restaurant` so records saved before the catalogue remain valid.
 */
export interface BusinessIdentityRestaurant {
	servesCuisine: string[];
	menuUrl?: string;
	acceptsReservations?: boolean;
}

export type BusinessIdentityTarget =
	| { kind: "home" }
	| { kind: "content"; collection: string; entryId: string; locale: string | null; title: string };

/** The facts the form edits. The commands own version, time, state and the entity ID. */
export interface BusinessIdentityFacts {
	kind: BusinessIdentityKind;
	businessType?: BusinessIdentityType;
	name: string;
	alternateName?: string;
	legalName?: string;
	description?: string;
	logo?: BusinessIdentityMediaRef;
	image?: BusinessIdentityMediaRef;
	telephone?: string;
	email?: string;
	contactPoints: BusinessIdentityContactPoint[];
	sameAs: string[];
	address?: BusinessIdentityAddress;
	areaServed: BusinessIdentityAreaServed[];
	location?: BusinessIdentityLocation;
	priceRange?: string;
	restaurant?: BusinessIdentityRestaurant;
	target: BusinessIdentityTarget;
}

export interface BusinessIdentityRecord extends BusinessIdentityFacts {
	version: typeof BUSINESS_IDENTITY_STORAGE_VERSION;
	updatedAt: string;
	active: boolean;
	entityId: string;
	/**
	 * Set only when a Person was adopted from a legacy Person publisher: bare
	 * references to the legacy `#organization` IDs then keep resolving to it, as
	 * they did before adoption. Entity transitions clear it.
	 */
	organizationReferenceAliases?: true;
}

/** Dotted field paths, such as `contactPoints.0.telephone`, mapped to one message each. */
export type BusinessIdentityFieldErrors = Record<string, string>;

export type BusinessIdentityValidation<T> =
	| { success: true; value: T }
	| { success: false; errors: BusinessIdentityFieldErrors };

const COLLECTION_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~%-]{0,119}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DECIMAL_PATTERN = /^[+-]?\d{1,3}(?:\.\d+)?$/;
const COORDINATE_MAX_LENGTH = 32;
const TELEPHONE_PATTERN = /^\+[0-9 ()-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEDIA_PATH_PREFIX = "/_emdash/api/media/file/";

type DataRecord = Record<string, unknown>;

/** Officially assigned ISO 3166-1 alpha-2 codes (249). */
export const ISO_3166_ALPHA2_CODES: readonly string[] = (
	"AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
	"CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
	"GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
	"KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
	"MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
	"SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
	"UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");
const ISO_3166_ALPHA2 = new Set(ISO_3166_ALPHA2_CODES);

function dataRecord(value: unknown): DataRecord | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as DataRecord) : null;
}

function utf8Length(value: string): number {
	return new TextEncoder().encode(value).length;
}

/** Collects field errors while a validator walks one input. */
class Collector {
	readonly errors: BusinessIdentityFieldErrors = {};

	add(path: string, message: string): void {
		if (!(path in this.errors)) this.errors[path] = message;
	}

	get failed(): boolean {
		return Object.keys(this.errors).length > 0;
	}

	unknownKeys(source: DataRecord, allowed: readonly string[], path: string): void {
		for (const key of Object.keys(source)) {
			if (!allowed.includes(key)) this.add(path ? `${path}.${key}` : key, "This field is not supported.");
		}
	}

	/** Trimmed text; an empty optional value is treated as absent. */
	text(source: DataRecord, key: string, path: string, max: number, required: boolean): string | undefined {
		const value = source[key];
		if (value === undefined) {
			if (required) this.add(path, "Enter a value.");
			return undefined;
		}
		if (typeof value !== "string") {
			this.add(path, "Enter text.");
			return undefined;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			if (required) this.add(path, "Enter a value.");
			return undefined;
		}
		if (trimmed.length > max) {
			this.add(path, `Use at most ${max} characters.`);
			return undefined;
		}
		return trimmed;
	}

	list(source: DataRecord, key: string, path: string, max: number): unknown[] {
		const value = source[key];
		if (value === undefined) return [];
		if (!Array.isArray(value)) {
			this.add(path, "Send a list.");
			return [];
		}
		if (value.length > max) {
			this.add(path, `Add at most ${max}.`);
			return [];
		}
		return value;
	}
}

/**
 * An absolute https URL as written: the parser repairs a missing "//",
 * backslashes and embedded whitespace, but the stored text is what pages
 * publish, so such spellings are rejected rather than repaired.
 */
function httpsUrl(value: string): boolean {
	if (value.length > BUSINESS_IDENTITY_URL_MAX_LENGTH || !/^https:\/\/[^/\\\s]/.test(value) || /[\s\\]/.test(value)) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && Boolean(url.hostname);
	} catch {
		return false;
	}
}

/** The comparison form of a valid https URL, so two spellings of one address count once. */
function comparableUrl(value: string): string {
	try {
		return new URL(value).href;
	} catch {
		return value;
	}
}

/** A media library path exactly as the host serves it: no dot segments, query, fragment or empty key. */
function mediaPath(value: string): boolean {
	if (!value.startsWith(MEDIA_PATH_PREFIX) || value.length <= MEDIA_PATH_PREFIX.length) return false;
	try {
		const url = new URL(value, "https://media.invalid");
		return url.origin === "https://media.invalid" && url.pathname === value && url.pathname.startsWith(MEDIA_PATH_PREFIX);
	} catch {
		return false;
	}
}

function telephoneValid(value: string): boolean {
	if (!TELEPHONE_PATTERN.test(value)) return false;
	const digits = value.replace(/\D/g, "").length;
	return digits >= 7 && digits <= 15;
}

const TELEPHONE_HINT = "Use an international number starting with +, for example +31 20 123 4567.";

function validateMedia(c: Collector, value: unknown, path: string): BusinessIdentityMediaRef | undefined {
	if (value === undefined) return undefined;
	const source = dataRecord(value);
	if (!source) {
		c.add(path, "Choose an image.");
		return undefined;
	}
	c.unknownKeys(source, ["url", "width", "height"], path);
	const url = c.text(source, "url", `${path}.url`, BUSINESS_IDENTITY_URL_MAX_LENGTH, true);
	if (url && !mediaPath(url) && !httpsUrl(url)) {
		c.add(`${path}.url`, "Choose an image from the media library or enter an https address.");
	}
	const media: BusinessIdentityMediaRef = { url: url ?? "" };
	for (const dimension of ["width", "height"] as const) {
		const size = source[dimension];
		if (size === undefined) continue;
		if (
			typeof size !== "number" ||
			!Number.isInteger(size) ||
			size < 1 ||
			size > BUSINESS_IDENTITY_LIMITS.mediaDimension
		) {
			c.add(`${path}.${dimension}`, "Image size must be a positive whole number of pixels.");
		} else media[dimension] = size;
	}
	return media;
}

function validateCountry(c: Collector, value: unknown, path: string): string | undefined {
	if (typeof value !== "string" || !ISO_3166_ALPHA2.has(value)) {
		c.add(path, "Choose a country.");
		return undefined;
	}
	return value;
}

function validateContactPoint(
	c: Collector,
	value: unknown,
	path: string,
	kind: BusinessIdentityKind,
): BusinessIdentityContactPoint | null {
	const source = dataRecord(value);
	if (!source) {
		c.add(path, "Describe the contact point.");
		return null;
	}
	c.unknownKeys(source, ["contactType", "telephone", "email", "availableLanguage", "areaServed"], path);
	const contactType = source.contactType;
	if (!BUSINESS_IDENTITY_CONTACT_TYPES.includes(contactType as BusinessIdentityContactType)) {
		c.add(`${path}.contactType`, "Choose a contact type.");
	}
	const telephone = c.text(source, "telephone", `${path}.telephone`, BUSINESS_IDENTITY_LIMITS.telephone, false);
	if (telephone && !telephoneValid(telephone)) c.add(`${path}.telephone`, TELEPHONE_HINT);
	const email = c.text(source, "email", `${path}.email`, BUSINESS_IDENTITY_LIMITS.email, false);
	if (email && !EMAIL_PATTERN.test(email)) c.add(`${path}.email`, "Enter an email address.");
	if (!telephone && !email && !(`${path}.telephone` in c.errors) && !(`${path}.email` in c.errors)) {
		c.add(`${path}.telephone`, "Enter a phone number or an email address.");
	}
	const languages: string[] = [];
	c.list(source, "availableLanguage", `${path}.availableLanguage`, BUSINESS_IDENTITY_LIMITS.contactLanguages)
		.forEach((language, index) => {
			if (typeof language !== "string" || !LANGUAGE_PATTERN.test(language)) {
				c.add(`${path}.availableLanguage.${index}`, "Choose a language.");
			} else if (languages.includes(language)) {
				c.add(`${path}.availableLanguage.${index}`, "This language is already listed.");
			} else languages.push(language);
		});
	const countries: string[] = [];
	const areas = c.list(source, "areaServed", `${path}.areaServed`, BUSINESS_IDENTITY_LIMITS.contactCountries);
	if (kind === "Person" && areas.length) {
		c.add(`${path}.areaServed`, "A person's contact point has no service countries.");
	} else {
		areas.forEach((country, index) => {
			const code = validateCountry(c, country, `${path}.areaServed.${index}`);
			if (code && countries.includes(code)) c.add(`${path}.areaServed.${index}`, "This country is already listed.");
			else if (code) countries.push(code);
		});
	}
	return {
		contactType: contactType as BusinessIdentityContactType,
		...(telephone ? { telephone } : {}),
		...(email ? { email } : {}),
		availableLanguage: languages,
		areaServed: countries,
	};
}

function validateAddress(c: Collector, value: unknown, path: string): BusinessIdentityAddress | undefined {
	const source = dataRecord(value);
	if (!source) {
		c.add(path, "Enter the address.");
		return undefined;
	}
	c.unknownKeys(source, ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"], path);
	const L = BUSINESS_IDENTITY_LIMITS;
	const streetAddress = c.text(source, "streetAddress", `${path}.streetAddress`, L.streetAddress, true);
	const addressLocality = c.text(source, "addressLocality", `${path}.addressLocality`, L.addressLocality, true);
	const addressRegion = c.text(source, "addressRegion", `${path}.addressRegion`, L.addressRegion, false);
	const postalCode = c.text(source, "postalCode", `${path}.postalCode`, L.postalCode, false);
	const addressCountry = validateCountry(c, source.addressCountry, `${path}.addressCountry`);
	return {
		streetAddress: streetAddress ?? "",
		addressLocality: addressLocality ?? "",
		...(addressRegion ? { addressRegion } : {}),
		...(postalCode ? { postalCode } : {}),
		addressCountry: addressCountry ?? "",
	};
}

function validateArea(c: Collector, value: unknown, path: string): BusinessIdentityAreaServed | null {
	const source = dataRecord(value);
	if (!source || !BUSINESS_IDENTITY_AREA_KINDS.includes(source.kind as never)) {
		c.add(`${path}.kind`, "Choose what kind of area this is.");
		return null;
	}
	if (source.kind === "Country") {
		c.unknownKeys(source, ["kind", "countryCode"], path);
		const countryCode = validateCountry(c, source.countryCode, `${path}.countryCode`);
		return { kind: "Country", countryCode: countryCode ?? "" };
	}
	c.unknownKeys(source, ["kind", "name", "countryCode"], path);
	const name = c.text(source, "name", `${path}.name`, BUSINESS_IDENTITY_LIMITS.areaName, true);
	const countryCode = source.countryCode === undefined || source.countryCode === ""
		? undefined
		: validateCountry(c, source.countryCode, `${path}.countryCode`);
	return {
		kind: source.kind as "State" | "City" | "Place",
		name: name ?? "",
		...(countryCode ? { countryCode } : {}),
	};
}

function minutes(time: string): number {
	return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function validateHours(c: Collector, value: unknown, path: string): BusinessIdentityHours {
	const source = dataRecord(value);
	if (!source || (source.mode !== "unpublished" && source.mode !== "weekly")) {
		c.add(`${path}.mode`, "Choose whether opening hours are published.");
		return { mode: "unpublished" };
	}
	if (source.mode === "unpublished") {
		c.unknownKeys(source, ["mode"], path);
		return { mode: "unpublished" };
	}
	c.unknownKeys(source, ["mode", "days"], path);
	const daysSource = dataRecord(source.days);
	if (!daysSource) {
		c.add(`${path}.days`, "Set the hours for each day.");
		return { mode: "unpublished" };
	}
	c.unknownKeys(daysSource, BUSINESS_IDENTITY_DAYS, `${path}.days`);
	const days = {} as Record<BusinessIdentityDay, BusinessIdentityDayHours>;
	let total = 0;
	for (const day of BUSINESS_IDENTITY_DAYS) {
		const dayPath = `${path}.days.${day}`;
		const daySource = dataRecord(daysSource[day]);
		const state = daySource?.state;
		if (!daySource || !["unknown", "closed", "open24", "periods"].includes(state as string)) {
			c.add(`${dayPath}.state`, "Choose the hours for this day.");
			days[day] = { state: "unknown" };
			continue;
		}
		if (state !== "periods") {
			c.unknownKeys(daySource, ["state"], dayPath);
			days[day] = { state } as BusinessIdentityDayHours;
			continue;
		}
		c.unknownKeys(daySource, ["state", "periods"], dayPath);
		const raw = Array.isArray(daySource.periods) ? daySource.periods : null;
		if (!raw || raw.length < 1) {
			c.add(`${dayPath}.periods`, "Add the opening and closing time.");
			days[day] = { state: "periods", periods: [] };
			continue;
		}
		if (raw.length > BUSINESS_IDENTITY_LIMITS.periodsPerDay) {
			c.add(`${dayPath}.periods`, `Add at most ${BUSINESS_IDENTITY_LIMITS.periodsPerDay} periods a day.`);
			days[day] = { state: "periods", periods: [] };
			continue;
		}
		total += raw.length;
		const periods: BusinessIdentityPeriod[] = [];
		raw.forEach((item, index) => {
			const periodPath = `${dayPath}.periods.${index}`;
			const period = dataRecord(item);
			if (!period) {
				c.add(`${periodPath}.opens`, "Enter the opening time as HH:MM.");
				return;
			}
			c.unknownKeys(period, ["opens", "closes"], periodPath);
			const opens = typeof period.opens === "string" && TIME_PATTERN.test(period.opens) ? period.opens : "";
			const closes = typeof period.closes === "string" && TIME_PATTERN.test(period.closes) ? period.closes : "";
			if (!opens) c.add(`${periodPath}.opens`, "Enter the opening time as HH:MM, for example 09:00.");
			if (!closes) c.add(`${periodPath}.closes`, "Enter the closing time as HH:MM, for example 17:30.");
			if (opens && closes && opens === closes) {
				c.add(`${periodPath}.closes`, "The closing time must differ from the opening time.");
			}
			periods.push({ opens, closes });
		});
		days[day] = { state: "periods", periods };
	}
	if (total > BUSINESS_IDENTITY_LIMITS.periodsPerWeek) {
		c.add(`${path}.days`, `Add at most ${BUSINESS_IDENTITY_LIMITS.periodsPerWeek} opening periods a week.`);
	}
	if (!c.failed) validateHourOverlaps(c, days, path);
	return { mode: "weekly", days };
}

// An overnight period (closes before opens) occupies the rest of its own day
// and the start of the next one, wrapping from Sunday to Monday.
function validateHourOverlaps(
	c: Collector,
	days: Record<BusinessIdentityDay, BusinessIdentityDayHours>,
	path: string,
): void {
	BUSINESS_IDENTITY_DAYS.forEach((day, dayIndex) => {
		const hours = days[day];
		if (hours.state !== "periods") return;
		const spans = hours.periods
			.map((period, index) => {
				const start = minutes(period.opens);
				const end = minutes(period.closes);
				return { index, start, end: end < start ? 1440 : end };
			})
			.sort((left, right) => left.start - right.start);
		for (let index = 1; index < spans.length; index += 1) {
			if (spans[index].start < spans[index - 1].end) {
				c.add(`${path}.days.${day}.periods.${spans[index].index}.opens`, "This period overlaps another period on the same day.");
			}
		}
		const overnight = hours.periods.find((period) => minutes(period.closes) < minutes(period.opens));
		if (!overnight) return;
		const nextDay = BUSINESS_IDENTITY_DAYS[(dayIndex + 1) % BUSINESS_IDENTITY_DAYS.length];
		const next = days[nextDay];
		if (next.state === "closed" || next.state === "open24") {
			c.add(
				`${path}.days.${nextDay}.state`,
				`${day} stays open until ${overnight.closes}, so ${nextDay} cannot be ${next.state === "closed" ? "closed all day" : "open 24 hours"}.`,
			);
		} else if (next.state === "periods" && next.periods.length) {
			const first = next.periods.reduce((earliest, period) =>
				minutes(period.opens) < minutes(earliest.opens) ? period : earliest,
			);
			const firstIndex = next.periods.indexOf(first);
			if (minutes(first.opens) < minutes(overnight.closes)) {
				c.add(
					`${path}.days.${nextDay}.periods.${firstIndex}.opens`,
					`${day} stays open until ${overnight.closes}; ${nextDay} can open from then on.`,
				);
			}
		}
	});
}

/**
 * A decimal in range, as text exactly as entered. The range is checked on the
 * text, so a value just past the limit is not rounded into range.
 */
function validateCoordinate(c: Collector, value: unknown, path: string, limit: number): string | undefined {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text || text.length > COORDINATE_MAX_LENGTH || !DECIMAL_PATTERN.test(text)) {
		c.add(path, "Enter a decimal number, for example 52.37403.");
		return undefined;
	}
	const [whole, fraction = ""] = text.replace(/^[+-]/, "").split(".");
	const integer = Number(whole);
	if (integer > limit || (integer === limit && /[1-9]/.test(fraction))) {
		c.add(path, `Enter a value from -${limit} to ${limit}.`);
		return undefined;
	}
	return text;
}

function validateLocation(c: Collector, value: unknown, path: string): BusinessIdentityLocation | undefined {
	const source = dataRecord(value);
	if (!source) {
		c.add(path, "Describe the location.");
		return undefined;
	}
	c.unknownKeys(source, ["geo", "mapUrl", "hours"], path);
	let geo: BusinessIdentityLocation["geo"];
	if (source.geo !== undefined) {
		const geoSource = dataRecord(source.geo);
		if (!geoSource) c.add(`${path}.geo`, "Enter both latitude and longitude.");
		else {
			c.unknownKeys(geoSource, ["latitude", "longitude"], `${path}.geo`);
			for (const key of ["latitude", "longitude"] as const) {
				if (geoSource[key] !== undefined && typeof geoSource[key] !== "string") {
					c.add(`${path}.geo.${key}`, "Enter the coordinate as decimal text, for example 52.37403.");
				}
			}
			const latPresent = typeof geoSource.latitude === "string" && geoSource.latitude.trim() !== "";
			const lngPresent = typeof geoSource.longitude === "string" && geoSource.longitude.trim() !== "";
			if (`${path}.geo.latitude` in c.errors || `${path}.geo.longitude` in c.errors) {
				// The type errors above already describe the problem.
			} else if (latPresent !== lngPresent) {
				c.add(`${path}.geo.${latPresent ? "longitude" : "latitude"}`, "Enter both latitude and longitude, or neither.");
			} else if (latPresent) {
				const latitude = validateCoordinate(c, geoSource.latitude, `${path}.geo.latitude`, 90);
				const longitude = validateCoordinate(c, geoSource.longitude, `${path}.geo.longitude`, 180);
				if (latitude !== undefined && longitude !== undefined) geo = { latitude, longitude };
			}
		}
	}
	const mapUrl = c.text(source, "mapUrl", `${path}.mapUrl`, BUSINESS_IDENTITY_URL_MAX_LENGTH, false);
	if (mapUrl && !httpsUrl(mapUrl)) c.add(`${path}.mapUrl`, "Enter an https address.");
	const hours = validateHours(c, source.hours, `${path}.hours`);
	return { ...(geo ? { geo } : {}), ...(mapUrl ? { mapUrl } : {}), hours };
}

function validateRestaurant(c: Collector, value: unknown, path: string): BusinessIdentityRestaurant | undefined {
	const source = dataRecord(value);
	if (!source) {
		c.add(path, "Describe the food establishment.");
		return undefined;
	}
	c.unknownKeys(source, ["servesCuisine", "menuUrl", "acceptsReservations"], path);
	const servesCuisine: string[] = [];
	c.list(source, "servesCuisine", `${path}.servesCuisine`, BUSINESS_IDENTITY_LIMITS.cuisines).forEach((item, index) => {
		const cuisine = typeof item === "string" ? item.trim() : "";
		if (!cuisine || cuisine.length > BUSINESS_IDENTITY_LIMITS.cuisine) {
			c.add(`${path}.servesCuisine.${index}`, `Enter a cuisine of at most ${BUSINESS_IDENTITY_LIMITS.cuisine} characters.`);
		} else if (servesCuisine.some((existing) => existing.toLowerCase() === cuisine.toLowerCase())) {
			c.add(`${path}.servesCuisine.${index}`, "This cuisine is already listed.");
		} else servesCuisine.push(cuisine);
	});
	const menuUrl = c.text(source, "menuUrl", `${path}.menuUrl`, BUSINESS_IDENTITY_URL_MAX_LENGTH, false);
	if (menuUrl && !httpsUrl(menuUrl)) c.add(`${path}.menuUrl`, "Enter an https address.");
	const reservations = source.acceptsReservations;
	if (reservations !== undefined && typeof reservations !== "boolean") {
		c.add(`${path}.acceptsReservations`, "Choose whether reservations are accepted.");
	}
	return {
		servesCuisine,
		...(menuUrl ? { menuUrl } : {}),
		...(typeof reservations === "boolean" ? { acceptsReservations: reservations } : {}),
	};
}

function validateTarget(c: Collector, value: unknown): BusinessIdentityTarget {
	const source = dataRecord(value);
	if (source?.kind === "home") {
		c.unknownKeys(source, ["kind"], "target");
		return { kind: "home" };
	}
	if (source?.kind !== "content") {
		c.add("target", "Choose the page that shows these details.");
		return { kind: "home" };
	}
	c.unknownKeys(source, ["kind", "collection", "entryId", "locale", "title"], "target");
	const collection = typeof source.collection === "string" && COLLECTION_PATTERN.test(source.collection) ? source.collection : "";
	const entryId = typeof source.entryId === "string" && ENTRY_ID_PATTERN.test(source.entryId) ? source.entryId : "";
	const locale = source.locale === null
		? null
		: typeof source.locale === "string" && LANGUAGE_PATTERN.test(source.locale) ? source.locale : undefined;
	const title = typeof source.title === "string" ? source.title.trim() : "";
	if (!collection || !entryId) c.add("target", "Choose a page from the page list.");
	else if (locale === undefined || typeof source.title !== "string" || title.length > BUSINESS_IDENTITY_LIMITS.targetTitle) {
		c.add("target", "Choose the page again from the page list.");
	}
	return { kind: "content", collection, entryId, locale: locale ?? null, title };
}

const FACT_KEYS = [
	"kind",
	"businessType",
	"name",
	"alternateName",
	"legalName",
	"description",
	"logo",
	"image",
	"telephone",
	"email",
	"contactPoints",
	"sameAs",
	"address",
	"areaServed",
	"location",
	"priceRange",
	"restaurant",
	"target",
] as const;

function absent(value: unknown): boolean {
	return value === undefined;
}

function validateFactsInto(c: Collector, source: DataRecord): BusinessIdentityFacts {
	const L = BUSINESS_IDENTITY_LIMITS;
	const kind = source.kind as BusinessIdentityKind;
	if (!BUSINESS_IDENTITY_KINDS.includes(kind)) c.add("kind", "Choose a person, an organization or a local business.");
	const notFor = (key: string, rule: boolean, message: string) => {
		if (rule && !absent(source[key])) c.add(key, message);
		return rule;
	};
	let businessType: BusinessIdentityType | undefined;
	if (kind === "LocalBusiness") {
		if (isLocalBusinessType(source.businessType)) businessType = source.businessType;
		else if (localBusinessTypeExclusion(source.businessType)) {
			c.add("businessType", `${localBusinessTypeExclusion(source.businessType)} Choose a current type.`);
		} else if (typeof source.businessType === "string" && source.businessType) {
			c.add("businessType", `${source.businessType} is not a business type this version supports. Choose one from the list.`);
		} else c.add("businessType", "Choose a business type.");
	} else notFor("businessType", true, "Only a local business has a business type.");
	const person = kind === "Person";
	const local = kind === "LocalBusiness";
	const name = c.text(source, "name", "name", L.name, true);
	const alternateName = c.text(source, "alternateName", "alternateName", L.alternateName, false);
	const legalName = notFor("legalName", person, "A person has no legal name here.")
		? undefined
		: c.text(source, "legalName", "legalName", L.legalName, false);
	const description = c.text(source, "description", "description", L.description, false);
	const logo = notFor("logo", person, "A person has no logo.") ? undefined : validateMedia(c, source.logo, "logo");
	const image = validateMedia(c, source.image, "image");
	const telephone = c.text(source, "telephone", "telephone", L.telephone, false);
	if (telephone && !telephoneValid(telephone)) c.add("telephone", TELEPHONE_HINT);
	const email = c.text(source, "email", "email", L.email, false);
	if (email && !EMAIL_PATTERN.test(email)) c.add("email", "Enter an email address.");
	const contactPoints = c
		.list(source, "contactPoints", "contactPoints", L.contactPoints)
		.map((item, index) => validateContactPoint(c, item, `contactPoints.${index}`, kind))
		.filter((item): item is BusinessIdentityContactPoint => item !== null);
	const sameAs: string[] = [];
	c.list(source, "sameAs", "sameAs", L.sameAs).forEach((item, index) => {
		const url = typeof item === "string" ? item.trim() : "";
		if (!httpsUrl(url)) c.add(`sameAs.${index}`, "Enter the full https address of an official profile.");
		else if (sameAs.some((existing) => comparableUrl(existing) === comparableUrl(url))) c.add(`sameAs.${index}`, "This profile is already listed.");
		else sameAs.push(url);
	});
	const address = notFor("address", person, "A person's address is not published here.") || absent(source.address)
		? undefined
		: validateAddress(c, source.address, "address");
	let areaServed: BusinessIdentityAreaServed[] = [];
	if (person) {
		if (source.areaServed !== undefined && !(Array.isArray(source.areaServed) && source.areaServed.length === 0)) {
			c.add("areaServed", "A person has no service area here.");
		}
	} else {
		areaServed = c
			.list(source, "areaServed", "areaServed", L.areaServed)
			.map((item, index) => validateArea(c, item, `areaServed.${index}`))
			.filter((item): item is BusinessIdentityAreaServed => item !== null);
	}
	const location = notFor("location", !local, "Only a local business has a location.") || absent(source.location)
		? undefined
		: validateLocation(c, source.location, "location");
	const priceRange = notFor("priceRange", !local, "Only a local business has a price range.")
		? undefined
		: c.text(source, "priceRange", "priceRange", L.priceRange, false);
	const restaurant = notFor(
		"restaurant",
		!(local && isFoodEstablishmentType(businessType)),
		"Only a food establishment, such as a restaurant or bakery, has cuisine, menu and reservation details.",
	) ||
		absent(source.restaurant)
		? undefined
		: validateRestaurant(c, source.restaurant, "restaurant");
	const target = validateTarget(c, source.target);
	return {
		kind,
		...(businessType ? { businessType } : {}),
		name: name ?? "",
		...(alternateName ? { alternateName } : {}),
		...(legalName ? { legalName } : {}),
		...(description ? { description } : {}),
		...(logo ? { logo } : {}),
		...(image ? { image } : {}),
		...(telephone ? { telephone } : {}),
		...(email ? { email } : {}),
		contactPoints,
		sameAs,
		...(address ? { address } : {}),
		areaServed,
		...(location ? { location } : {}),
		...(priceRange ? { priceRange } : {}),
		...(restaurant ? { restaurant } : {}),
		target,
	};
}

/** Validates the editable facts. Unknown keys, inapplicable fields and oversize values are errors. */
export function validateBusinessIdentityFacts(input: unknown): BusinessIdentityValidation<BusinessIdentityFacts> {
	const source = dataRecord(input);
	const c = new Collector();
	if (!source) return { success: false, errors: { _form: "Send the business identity details." } };
	c.unknownKeys(source, FACT_KEYS, "");
	const facts = validateFactsInto(c, source);
	if (!c.failed && utf8Length(JSON.stringify(facts)) > BUSINESS_IDENTITY_MAX_BYTES - 512) {
		c.add("_form", "These details are too long to save. Shorten the description or remove some entries.");
	}
	return c.failed ? { success: false, errors: c.errors } : { success: true, value: facts };
}

export function businessIdentityFamily(kind: BusinessIdentityKind): BusinessIdentityFamily {
	return kind === "Person" ? "person" : "organization";
}

/** `<origin>/#organization` or `<origin>/#person`; empty when the site URL is not http(s). */
export function businessIdentityEntityIdFor(siteUrl: string, family: BusinessIdentityFamily): string {
	if (!isHttpUrl(siteUrl)) return "";
	return `${new URL(siteUrl).origin}/#${family}`;
}

/** The family an entity ID names, or null when it is not a supported identity ID. */
export function businessIdentityEntityFamily(entityId: string): BusinessIdentityFamily | null {
	if (typeof entityId !== "string" || entityId.length > BUSINESS_IDENTITY_URL_MAX_LENGTH || !isHttpUrl(entityId)) return null;
	const url = new URL(entityId);
	if (url.pathname !== "/" || url.search || url.username || url.password) return null;
	if (entityId !== `${url.origin}/${url.hash}`) return null;
	return url.hash === "#organization" ? "organization" : url.hash === "#person" ? "person" : null;
}

export function businessIdentityEntityOrigin(entityId: string): string {
	return businessIdentityEntityFamily(entityId) ? new URL(entityId).origin : "";
}

/** Validates a stored record. A stored JSON null or any unknown key is invalid. */
export function validateBusinessIdentityRecord(value: unknown): BusinessIdentityValidation<BusinessIdentityRecord> {
	const source = dataRecord(value);
	if (!source) return { success: false, errors: { _form: "The saved business identity is not a record." } };
	const c = new Collector();
	c.unknownKeys(source, [...FACT_KEYS, "version", "updatedAt", "active", "entityId", "organizationReferenceAliases"], "");
	if (source.version !== BUSINESS_IDENTITY_STORAGE_VERSION) c.add("version", "The saved record uses an unsupported version.");
	if (
		typeof source.updatedAt !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source.updatedAt) ||
		Number.isNaN(Date.parse(source.updatedAt)) ||
		new Date(source.updatedAt).toISOString() !== source.updatedAt
	) {
		c.add("updatedAt", "The saved record has no valid update time.");
	}
	if (typeof source.active !== "boolean") c.add("active", "The saved record has no valid state.");
	const facts = validateFactsInto(c, source);
	const family = businessIdentityEntityFamily(source.entityId as string);
	if (!family) c.add("entityId", "The saved record has no valid entity ID.");
	else if (BUSINESS_IDENTITY_KINDS.includes(facts.kind) && family !== businessIdentityFamily(facts.kind)) {
		c.add("entityId", "The saved entity ID does not match the entity kind.");
	}
	const aliases = source.organizationReferenceAliases;
	if (aliases !== undefined && (aliases !== true || family !== "person")) {
		c.add("organizationReferenceAliases", "The saved reference aliases are not valid.");
	}
	if (!c.failed && utf8Length(JSON.stringify(source)) > BUSINESS_IDENTITY_MAX_BYTES) {
		c.add("_form", "The saved record is larger than 16 KiB.");
	}
	if (c.failed) return { success: false, errors: c.errors };
	const record: BusinessIdentityRecord = {
		version: BUSINESS_IDENTITY_STORAGE_VERSION,
		updatedAt: source.updatedAt as string,
		active: source.active as boolean,
		entityId: source.entityId as string,
		...(aliases === true ? { organizationReferenceAliases: true as const } : {}),
		...facts,
	};
	// The commands only store normalized records, so any difference (a null, an
	// untrimmed value, a number where text belongs) means the row was changed elsewhere.
	if (canonicalJson(record) !== canonicalJson(source)) {
		return { success: false, errors: { _form: "The saved record is not in the form this version writes." } };
	}
	return { success: true, value: record };
}

/**
 * The facts a kind can carry. Fields it cannot carry are left out and named,
 * so a confirmation can list them before an entity change.
 */
export function businessIdentityFactsForKind(
	facts: BusinessIdentityFacts,
	kind: BusinessIdentityKind,
): { facts: BusinessIdentityFacts; dropped: string[] } {
	const dropped: string[] = [];
	const next: BusinessIdentityFacts = { ...facts, kind };
	const drop = (key: keyof BusinessIdentityFacts, present: boolean) => {
		if (!present) return;
		dropped.push(key);
		delete next[key];
	};
	if (kind !== "LocalBusiness") {
		drop("businessType", facts.businessType !== undefined);
		drop("location", facts.location !== undefined);
		drop("priceRange", facts.priceRange !== undefined);
	}
	if (kind !== "LocalBusiness" || !isFoodEstablishmentType(facts.businessType)) drop("restaurant", facts.restaurant !== undefined);
	if (kind === "Person") {
		drop("legalName", facts.legalName !== undefined);
		drop("logo", facts.logo !== undefined);
		drop("address", facts.address !== undefined);
		if (facts.areaServed.length) dropped.push("areaServed");
		next.areaServed = [];
		if (facts.contactPoints.some((point) => point.areaServed.length)) dropped.push("contactPoints.areaServed");
		next.contactPoints = facts.contactPoints.map((point) => ({ ...point, areaServed: [] }));
	}
	return { facts: next, dropped };
}

export function businessIdentityRecordBytes(record: BusinessIdentityRecord): number {
	return utf8Length(JSON.stringify(record));
}

export function businessIdentityFactsOf(record: BusinessIdentityRecord): BusinessIdentityFacts {
	const {
		version: _version,
		updatedAt: _updatedAt,
		active: _active,
		entityId: _entityId,
		organizationReferenceAliases: _aliases,
		...facts
	} = record;
	return facts;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value as DataRecord)
			.filter((key) => (value as DataRecord)[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as DataRecord)[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function sameBusinessIdentityFacts(left: BusinessIdentityFacts, right: BusinessIdentityFacts): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

/** Records equal apart from their update time. */
export function sameBusinessIdentityRecord(left: BusinessIdentityRecord, right: BusinessIdentityRecord): boolean {
	return canonicalJson({ ...left, updatedAt: "" }) === canonicalJson({ ...right, updatedAt: "" });
}

// ---------------------------------------------------------------------------
// Legacy settings and adoption
// ---------------------------------------------------------------------------

/** The legacy publisher fields in the existing site settings. */
export interface BusinessIdentityLegacySettings {
	siteName: string;
	siteUrl: string;
	publisherType: "organization" | "person";
	organizationName: string;
	organizationLogo: string;
	personName: string;
	socialProfiles: readonly string[];
	personProfiles: readonly string[];
}

export const BUSINESS_IDENTITY_LEGACY_PUBLISHER_FIELDS = [
	"publisherType",
	"organizationName",
	"organizationLogo",
	"personName",
	"socialProfiles",
	"personProfiles",
] as const;

/**
 * A form draft prefilled from the legacy publisher. Values outside the new
 * bounds stay in the draft so the owner sees and fixes them; nothing is saved.
 */
export function legacyBusinessIdentityDraft(settings: BusinessIdentityLegacySettings): {
	draft: DataRecord;
	issues: BusinessIdentityFieldErrors;
} {
	const person = settings.publisherType === "person";
	const name = (person ? settings.personName : settings.organizationName).trim() || settings.siteName.trim();
	const logo = settings.organizationLogo.trim();
	const draft: DataRecord = {
		kind: person ? "Person" : "Organization",
		name,
		...(!person && logo ? { logo: { url: logo } } : {}),
		contactPoints: [],
		sameAs: [...(person ? settings.personProfiles : settings.socialProfiles)],
		areaServed: [],
		target: { kind: "home" },
	};
	const validation = validateBusinessIdentityFacts(draft);
	return { draft, issues: validation.success ? {} : validation.errors };
}

/** The ID adoption stores: the publisher ID the legacy settings emit today. */
export function legacyPublisherEntityId(settings: Pick<BusinessIdentityLegacySettings, "siteUrl" | "publisherType">): string {
	return businessIdentityEntityIdFor(settings.siteUrl, settings.publisherType === "person" ? "person" : "organization");
}

// ---------------------------------------------------------------------------
// Owned IDs
// ---------------------------------------------------------------------------

/** IDs the identity owns: its entity ID written with and without the root slash. */
export function businessIdentityOwnedIds(entityId: string): string[] {
	const family = businessIdentityEntityFamily(entityId);
	if (!family) return [];
	const origin = new URL(entityId).origin;
	return [`${origin}/#${family}`, `${origin}#${family}`, `${origin}//#${family}`];
}

/** Bare references that resolve to the publisher: owned IDs plus the legacy Organization forms for an adopted Person. */
export function businessIdentityReferenceIds(record: Pick<BusinessIdentityRecord, "entityId" | "organizationReferenceAliases">): string[] {
	const owned = businessIdentityOwnedIds(record.entityId);
	if (!record.organizationReferenceAliases || !owned.length) return owned;
	const origin = new URL(record.entityId).origin;
	return [...owned, `${origin}/#organization`, `${origin}#organization`, `${origin}//#organization`];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const SCHEMA_CONTEXT = "https://schema.org";

/** The site root used for `url` and site-relative media: the site URL, else the entity ID's origin. */
function outputRoot(record: BusinessIdentityRecord, siteUrl: string): string {
	if (isHttpUrl(siteUrl)) return `${new URL(siteUrl).origin}/`;
	const origin = businessIdentityEntityOrigin(record.entityId);
	return origin ? `${origin}/` : "";
}

function mediaOutput(media: BusinessIdentityMediaRef | undefined, root: string): string {
	if (!media?.url) return "";
	if (media.url.startsWith(MEDIA_PATH_PREFIX)) {
		if (!root) return "";
		try {
			return new URL(media.url, root).href;
		} catch {
			return "";
		}
	}
	return httpsUrl(media.url) ? media.url : "";
}

/** The schema type on the selected page. */
export function businessIdentityFullType(record: Pick<BusinessIdentityFacts, "kind" | "businessType">): string {
	if (record.kind === "LocalBusiness") return record.businessType ?? "LocalBusiness";
	return record.kind;
}

/** The schema type everywhere else: a local business is typed as its organization. */
export function businessIdentityMinimalType(record: Pick<BusinessIdentityFacts, "kind">): "Person" | "Organization" {
	return record.kind === "Person" ? "Person" : "Organization";
}

function minimalFields(record: BusinessIdentityRecord, siteUrl: string): DataRecord {
	const root = outputRoot(record, siteUrl);
	const node: DataRecord = { "@type": businessIdentityMinimalType(record), name: record.name };
	if (root) node.url = root;
	if (record.kind !== "Person") {
		const logo = mediaOutput(record.logo, root);
		if (logo) node.logo = logo;
	}
	if (record.sameAs.length) node.sameAs = [...record.sameAs];
	return node;
}

/** The publisher on every page except the selected one: type, ID, name, URL, logo and profiles. */
export function businessIdentityMinimalGraph(record: BusinessIdentityRecord, siteUrl: string): DataRecord {
	const { "@type": type, ...rest } = minimalFields(record, siteUrl);
	return { "@context": SCHEMA_CONTEXT, "@type": type, "@id": record.entityId, ...rest };
}

/** The minimal shape without an ID, for inline publisher links and reference expansion. */
export function businessIdentityInlinePublisher(record: BusinessIdentityRecord, siteUrl: string): DataRecord {
	return minimalFields(record, siteUrl);
}

function hoursOutput(hours: BusinessIdentityHours): DataRecord[] {
	if (hours.mode !== "weekly") return [];
	const groups = new Map<string, { opens: string; closes: string; days: BusinessIdentityDay[] }>();
	const add = (day: BusinessIdentityDay, opens: string, closes: string) => {
		const key = `${opens}-${closes}`;
		const group = groups.get(key) ?? { opens, closes, days: [] };
		group.days.push(day);
		groups.set(key, group);
	};
	for (const day of BUSINESS_IDENTITY_DAYS) {
		const value = hours.days[day];
		if (value.state === "closed") add(day, "00:00:00", "00:00:00");
		else if (value.state === "open24") add(day, "00:00:00", "23:59:00");
		else if (value.state === "periods") {
			for (const period of value.periods) add(day, `${period.opens}:00`, `${period.closes}:00`);
		}
	}
	return [...groups.values()].map((group) => ({
		"@type": "OpeningHoursSpecification",
		dayOfWeek: group.days,
		opens: group.opens,
		closes: group.closes,
	}));
}

function areaOutput(area: BusinessIdentityAreaServed): DataRecord {
	if (area.kind === "Country") return { "@type": "Country", name: area.countryCode };
	return {
		"@type": area.kind,
		name: area.name,
		...(area.countryCode ? { containedInPlace: { "@type": "Country", name: area.countryCode } } : {}),
	};
}

/** The complete definition, emitted only on the selected page. */
export function businessIdentityFullGraph(record: BusinessIdentityRecord, siteUrl: string): DataRecord {
	const root = outputRoot(record, siteUrl);
	const node: DataRecord = {
		"@context": SCHEMA_CONTEXT,
		"@type": businessIdentityFullType(record),
		"@id": record.entityId,
		name: record.name,
	};
	if (record.alternateName) node.alternateName = record.alternateName;
	if (record.kind !== "Person" && record.legalName) node.legalName = record.legalName;
	if (record.description) node.description = record.description;
	if (root) node.url = root;
	if (record.kind !== "Person") {
		const logo = mediaOutput(record.logo, root);
		if (logo) node.logo = logo;
	}
	const image = mediaOutput(record.image, root);
	if (image) node.image = image;
	if (record.telephone) node.telephone = record.telephone;
	if (record.email) node.email = record.email;
	if (record.contactPoints.length) {
		node.contactPoint = record.contactPoints.map((point) => ({
			"@type": "ContactPoint",
			contactType: point.contactType,
			...(point.telephone ? { telephone: point.telephone } : {}),
			...(point.email ? { email: point.email } : {}),
			...(point.availableLanguage.length ? { availableLanguage: [...point.availableLanguage] } : {}),
			...(record.kind !== "Person" && point.areaServed.length ? { areaServed: [...point.areaServed] } : {}),
		}));
	}
	if (record.sameAs.length) node.sameAs = [...record.sameAs];
	if (record.kind !== "Person") {
		if (record.address) {
			node.address = {
				"@type": "PostalAddress",
				streetAddress: record.address.streetAddress,
				addressLocality: record.address.addressLocality,
				...(record.address.addressRegion ? { addressRegion: record.address.addressRegion } : {}),
				...(record.address.postalCode ? { postalCode: record.address.postalCode } : {}),
				addressCountry: record.address.addressCountry,
			};
		}
		if (record.areaServed.length) node.areaServed = record.areaServed.map(areaOutput);
	}
	if (record.kind === "LocalBusiness") {
		const location = record.location;
		if (location?.geo) {
			node.geo = {
				"@type": "GeoCoordinates",
				latitude: Number(location.geo.latitude),
				longitude: Number(location.geo.longitude),
			};
		}
		if (location?.mapUrl) node.hasMap = location.mapUrl;
		const hours = location ? hoursOutput(location.hours) : [];
		if (hours.length) node.openingHoursSpecification = hours;
		if (record.priceRange) node.priceRange = record.priceRange;
		if (isFoodEstablishmentType(record.businessType) && record.restaurant) {
			if (record.restaurant.servesCuisine.length) node.servesCuisine = [...record.restaurant.servesCuisine];
			// Schema.org 30.1 supersedes `menu` with `hasMenu`; Google still documents
			// `menu`, so both carry the same URL.
			if (record.restaurant.menuUrl) {
				node.hasMenu = record.restaurant.menuUrl;
				node.menu = record.restaurant.menuUrl;
			}
			if (typeof record.restaurant.acceptsReservations === "boolean") {
				node.acceptsReservations = record.restaurant.acceptsReservations;
			}
		}
	}
	return node;
}

function normalizedPath(page: Pick<PublicPageContext, "path" | "url">): string | null {
	let path = typeof page.path === "string" ? page.path : "";
	if (!path && typeof page.url === "string") {
		try {
			path = new URL(page.url).pathname;
		} catch {
			return null;
		}
	}
	if (!path) return null;
	const bare = path.split(/[?#]/, 1)[0].replace(/\/+$/, "");
	return bare === "" ? "/" : bare;
}

/** Content targets match the exact entry ID; the homepage target matches the path `/`. */
export function businessIdentityTargetMatches(
	target: BusinessIdentityTarget,
	page: Pick<PublicPageContext, "path" | "url" | "content">,
): boolean {
	if (target.kind === "content") {
		return page.content?.collection === target.collection && page.content?.id === target.entryId;
	}
	return normalizedPath(page) === "/";
}

// ---------------------------------------------------------------------------
// Owned definitions inside custom graphs
// ---------------------------------------------------------------------------

/** Nodes deeper than this are not inspected; a graph that reaches it is reported as incompletely scanned. */
export const BUSINESS_IDENTITY_SCAN_MAX_DEPTH = 64;

const SCHEMA_ORG_CONTEXTS = new Set(["https://schema.org", "https://schema.org/", "http://schema.org", "http://schema.org/"]);

/** Only the plain schema.org context has a meaning known here; term definitions or other contexts could turn text into references. */
function standardContext(value: unknown): boolean {
	if (typeof value === "string") return SCHEMA_ORG_CONTEXTS.has(value.trim());
	return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && SCHEMA_ORG_CONTEXTS.has(item.trim()));
}

/**
 * Visits every node object outside `@context`, whose term mappings are not
 * entities. `contextUncertain` is true when the node's own or an inherited
 * context is anything but plain schema.org. Returns false when the graph is
 * deeper than the scan limit, so callers can fail closed instead of treating
 * a partial scan as complete.
 */
export function walkJsonLdNodes(
	graph: unknown,
	visit: (node: DataRecord, scope: { contextUncertain: boolean }) => "skip" | void,
): boolean {
	let complete = true;
	const walk = (value: unknown, depth: number, inherited: boolean) => {
		if (!complete || value === null || typeof value !== "object") return;
		if (depth > BUSINESS_IDENTITY_SCAN_MAX_DEPTH) {
			complete = false;
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) walk(item, depth + 1, inherited);
			return;
		}
		const node = value as DataRecord;
		const contextUncertain = inherited || ("@context" in node && !standardContext(node["@context"]));
		if (visit(node, { contextUncertain }) === "skip") return;
		for (const [key, child] of Object.entries(node)) {
			if (key !== "@context") walk(child, depth + 1, contextUncertain);
		}
	};
	walk(graph, 0, false);
	return complete;
}

function nodeId(node: DataRecord): string {
	return typeof node["@id"] === "string" ? node["@id"].trim() : "";
}

function definesId(node: DataRecord): boolean {
	return Object.keys(node).some((key) => key !== "@id" && key !== "@context");
}

export interface OwnedDefinitionScan {
	/** Owned IDs the graph defines. */
	ids: string[];
	/** False when the graph was too deep to inspect completely. */
	complete: boolean;
}

/** Every owned ID the graph defines, nested definitions included. */
export function scanOwnedDefinitions(graph: unknown, owned: readonly string[]): OwnedDefinitionScan {
	const ownedSet = new Set(owned);
	const ids: string[] = [];
	const complete = walkJsonLdNodes(graph, (node) => {
		const id = nodeId(node);
		if (id && ownedSet.has(id) && definesId(node) && !ids.includes(id)) ids.push(id);
	});
	return { ids, complete };
}

// ---------------------------------------------------------------------------
// Page resolution
// ---------------------------------------------------------------------------

/** What one request read from storage. Only `absent` and an inactive record use the legacy publisher. */
export type BusinessIdentityRenderState =
	| { state: "absent" }
	| { state: "valid"; record: BusinessIdentityRecord }
	| { state: "invalid" }
	| { state: "unavailable" };

export interface BusinessIdentityPageConflict {
	customId: string;
	ownedIds: string[];
	/** `incomplete`: the graph was too deep to check. Either way the automatic publisher is left off this page. */
	outcome: "publisher_omitted" | "incomplete";
}

/** Custom graphs on one page that define any of `ids`; a graph too deep to inspect counts as one. */
export function customOwnedIdConflicts(
	customs: ReadonlyArray<{ id: string; graph: unknown }>,
	ids: readonly string[],
): BusinessIdentityPageConflict[] {
	if (!ids.length) return [];
	const conflicts: BusinessIdentityPageConflict[] = [];
	for (const custom of customs) {
		const scan = scanOwnedDefinitions(custom.graph, ids);
		if (!scan.complete) conflicts.push({ customId: custom.id, ownedIds: scan.ids, outcome: "incomplete" });
		else if (scan.ids.length) conflicts.push({ customId: custom.id, ownedIds: scan.ids, outcome: "publisher_omitted" });
	}
	return conflicts;
}

export interface BusinessIdentityPageResolution {
	/** Undefined keeps the legacy publisher path unchanged. */
	publisher: SchemaPublisherSource | undefined;
	conflicts: BusinessIdentityPageConflict[];
	/** True when the identity's full definition is the publisher graph on this page. */
	fullDefinition: boolean;
}

/**
 * Resolves the identity publisher for one page. `customs` are the custom graphs
 * the caller will emit on this page, after template expansion; they are never
 * changed. When one defines an ID the identity owns or answers to, that page
 * gets no identity publisher, no publisher or provider links and no inline
 * publisher facts, so the custom definition is the only one.
 */
export function resolveBusinessIdentityGraphs(input: {
	identity: BusinessIdentityRenderState;
	siteUrl: string;
	page: Pick<PublicPageContext, "path" | "url" | "content">;
	customs: ReadonlyArray<{ id: string; graph: unknown }>;
}): BusinessIdentityPageResolution {
	const identity = input.identity;
	if (identity.state === "absent" || (identity.state === "valid" && !identity.record.active)) {
		return { publisher: undefined, conflicts: [], fullDefinition: false };
	}
	if (identity.state !== "valid") return { publisher: { kind: "none" }, conflicts: [], fullDefinition: false };
	const record = identity.record;
	const conflicts = customOwnedIdConflicts(input.customs, businessIdentityReferenceIds(record));
	if (conflicts.length) return { publisher: { kind: "none" }, conflicts, fullDefinition: false };
	const target = businessIdentityTargetMatches(record.target, input.page);
	const publisher: SchemaIdentityPublisher = {
		kind: "identity",
		entityId: record.entityId,
		ownedIds: businessIdentityOwnedIds(record.entityId),
		definedOnPage: [],
		referenceIds: businessIdentityReferenceIds(record),
		graph: target ? businessIdentityFullGraph(record, input.siteUrl) : businessIdentityMinimalGraph(record, input.siteUrl),
		type: target ? businessIdentityFullType(record) : businessIdentityMinimalType(record),
		inline: businessIdentityInlinePublisher(record, input.siteUrl),
	};
	return { publisher, conflicts, fullDefinition: target };
}

// ---------------------------------------------------------------------------
// Custom record checks for the admin commands
// ---------------------------------------------------------------------------

/** One stored custom JSON-LD record, as the admin commands see it. */
export interface BusinessIdentityCustomRecord {
	id: string;
	name: string;
	scope: string;
	json: string;
	enabled: boolean;
	/** The exact entry an entry-owned record belongs to. */
	target?: { collection: string; entryId: string; locale: string | null } | null;
}

/** Variable values for one page a record can reach. */
export type BusinessIdentityTemplateContext = Record<string, string>;

const PAGE_VARIABLES = ["title", "description", "canonical", "image", "author", "publishedAt", "updatedAt", "collection", "slug"];
const OPAQUE_PATTERN = /\u0000[A-Za-z]+\u0000/;
const URL_VARIABLES = new Set(["canonical", "image"]);

/** Page variables as opaque markers; an ID that still names an owned ID did not depend on them. */
export function businessIdentityOpaqueContext(siteName: string, siteUrl: string): BusinessIdentityTemplateContext {
	return { ...Object.fromEntries(PAGE_VARIABLES.map((key) => [key, `\u0000${key}\u0000`])), siteName, siteUrl };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether an ID with page variables left in could become an owned ID on some page. */
function couldBecomeOwned(id: string, owned: readonly string[]): boolean {
	if (!OPAQUE_PATTERN.test(id)) return false;
	const pattern = new RegExp(`^${id.split(new RegExp(OPAQUE_PATTERN.source, "g")).map(escapeRegExp).join("[\\s\\S]*")}$`);
	return owned.some((ownedId) => pattern.test(ownedId));
}

/**
 * Whether a graph defines an ID that depends on page variables and could equal
 * an owned ID on some page; only then do the exact pages a record reaches
 * need to be resolved.
 */
export function ownedIdDependsOnPage(
	parsed: unknown,
	owned: readonly string[],
	siteName: string,
	siteUrl: string,
): { possible: boolean; fragmentFromPage: boolean; complete: boolean } {
	let possible = false;
	let fragmentFromPage = false;
	const complete = walkJsonLdNodes(applyVarsDeep(parsed, businessIdentityOpaqueContext(siteName, siteUrl)), (node) => {
		const id = nodeId(node);
		if (!id || !definesId(node) || !couldBecomeOwned(id, owned)) return;
		possible = true;
		// A literal "#fragment" after the last variable means the variables only
		// supply the address. Otherwise the last variable supplies the fragment,
		// unless it holds a page URL: canonical and image are absolute URLs, and a
		// canonical carrying "#organization" is outside what this check covers.
		const tail = id.split(new RegExp(OPAQUE_PATTERN.source, "g")).pop() ?? "";
		const markers = [...id.matchAll(new RegExp(OPAQUE_PATTERN.source, "g"))];
		const last = markers.length ? markers[markers.length - 1][0].slice(1, -1) : "";
		if (!tail.includes("#") && !URL_VARIABLES.has(last)) fragmentFromPage = true;
	});
	return { possible, fragmentFromPage, complete };
}

/** The entry a record's scope names, as `collection` and an ID or slug. */
export function customRecordEntryRef(record: BusinessIdentityCustomRecord): { collection: string; identifier: string } | null {
	if (record.target) return { collection: record.target.collection, identifier: record.target.entryId };
	const match = /^([a-z][a-z0-9_-]{0,63}):(.+)$/.exec(record.scope);
	return match ? { collection: match[1], identifier: match[2] } : null;
}

/** Whether a record can apply to some entry of the collection. */
export function customRecordReachesCollection(record: BusinessIdentityCustomRecord, collection: string): boolean {
	if (record.target) return record.target.collection === collection;
	return record.scope === "global" || record.scope === collection || record.scope.startsWith(`${collection}:`);
}

/**
 * Contexts a record is checked in: page variables as opaque values (an ID that
 * still names an owned ID did not depend on them), the homepage for site-wide
 * records, and the selected content page when the record applies to it.
 */
export function businessIdentityTemplateContexts(input: {
	record: BusinessIdentityCustomRecord;
	siteName: string;
	siteUrl: string;
	target?: { collection: string; entryId: string; slug: string | null; vars: BusinessIdentityTemplateContext } | null;
	/** Variables of the exact entry the record's own scope names, when resolved. */
	entries?: readonly BusinessIdentityTemplateContext[];
}): BusinessIdentityTemplateContext[] {
	const site = { siteName: input.siteName, siteUrl: input.siteUrl };
	const contexts: BusinessIdentityTemplateContext[] = [businessIdentityOpaqueContext(input.siteName, input.siteUrl)];
	const scope = input.record.scope;
	if (scope === "global" && !input.record.target && isHttpUrl(input.siteUrl)) {
		const root = `${new URL(input.siteUrl).origin}/`;
		contexts.push({
			...Object.fromEntries(PAGE_VARIABLES.map((key) => [key, ""])),
			canonical: root,
			...site,
		});
	}
	const target = input.target;
	if (target && customRecordAppliesToEntry(input.record, target)) contexts.push({ ...target.vars, ...site });
	for (const vars of input.entries ?? []) contexts.push({ ...vars, ...site });
	return contexts;
}

/** Canonical JSON with sorted keys, for content comparisons and digests. */
export function canonicalBusinessIdentityJson(value: unknown): string {
	return canonicalJson(value);
}

export function customRecordAppliesToEntry(
	record: BusinessIdentityCustomRecord,
	entry: { collection: string; entryId: string; slug: string | null },
): boolean {
	if (record.target) return record.target.collection === entry.collection && record.target.entryId === entry.entryId;
	return [
		"global",
		entry.collection,
		`${entry.collection}:${entry.entryId}`,
		...(entry.slug ? [`${entry.collection}:${entry.slug}`] : []),
	].includes(record.scope);
}

/**
 * Owned IDs a parsed graph defines in any of the given contexts. Invalid JSON
 * defines nothing, because it is never emitted; a graph too deep to inspect
 * is incomplete.
 */
export function graphOwnedDefinitions(
	parsed: unknown,
	owned: readonly string[],
	contexts: readonly BusinessIdentityTemplateContext[],
): { ids: string[]; complete: boolean } {
	const found = new Set<string>();
	let complete = true;
	for (const vars of contexts) {
		const scan = scanOwnedDefinitions(applyVarsDeep(parsed, vars), owned);
		for (const id of scan.ids) found.add(id);
		if (!scan.complete) complete = false;
	}
	return { ids: [...found], complete };
}

export function customRecordOwnedDefinitions(
	record: BusinessIdentityCustomRecord,
	owned: readonly string[],
	contexts: readonly BusinessIdentityTemplateContext[],
): { ids: string[]; complete: boolean } {
	let parsed: unknown;
	try {
		parsed = validateCustomJsonLd(record.json);
	} catch {
		return { ids: [], complete: true };
	}
	return graphOwnedDefinitions(parsed, owned, contexts);
}

export interface BusinessIdentityOwnedDefinition {
	id: string;
	name: string;
	scope: string;
	ownedIds: string[];
}

export interface BusinessIdentitySameBusinessWarning {
	source: "custom" | "entry-data";
	id: string;
	name: string;
	scope: string;
	types: string[];
	matched: Array<"name" | "telephone" | "address">;
	/** The definition uses the deprecated ProfessionalService type. */
	deprecatedType: boolean;
}

function comparableText(value: unknown): string {
	return typeof value === "string" ? value.trim().toLocaleLowerCase().replace(/\s+/g, " ") : "";
}

function telephoneDigits(value: unknown): string {
	return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function nodeTypes(node: DataRecord): string[] {
	const type = node["@type"];
	return (Array.isArray(type) ? type : [type]).filter((item): item is string => typeof item === "string");
}

/** Which identity facts a graph node repeats. */
export function sameBusinessMatches(
	node: DataRecord,
	facts: Pick<BusinessIdentityFacts, "name" | "telephone" | "address">,
): Array<"name" | "telephone" | "address"> {
	const matched: Array<"name" | "telephone" | "address"> = [];
	const name = comparableText(facts.name);
	if (name && comparableText(node.name) === name) matched.push("name");
	const telephone = telephoneDigits(facts.telephone);
	if (telephone && telephoneDigits(node.telephone) === telephone) matched.push("telephone");
	const address = dataRecord(node.address);
	if (
		facts.address &&
		address &&
		comparableText(address.streetAddress) === comparableText(facts.address.streetAddress) &&
		comparableText(address.addressLocality) === comparableText(facts.address.addressLocality)
	) {
		matched.push("address");
	}
	return matched;
}

/** Nodes in a graph that repeat the identity's name, telephone or street and locality. */
export function sameBusinessNodes(
	graph: unknown,
	facts: Pick<BusinessIdentityFacts, "name" | "telephone" | "address">,
	owned: readonly string[],
): Array<{ types: string[]; matched: Array<"name" | "telephone" | "address"> }> {
	const ownedSet = new Set(owned);
	const results: Array<{ types: string[]; matched: Array<"name" | "telephone" | "address"> }> = [];
	walkJsonLdNodes(graph, (node) => {
		if (ownedSet.has(nodeId(node)) || !nodeTypes(node).length) return;
		const matched = sameBusinessMatches(node, facts);
		if (matched.length) results.push({ types: nodeTypes(node), matched });
	});
	return results;
}

// ---------------------------------------------------------------------------
// Review notices
// ---------------------------------------------------------------------------

export type BusinessIdentityNoticeCode =
	| "visibility"
	| "local-business-address"
	| "name-differs"
	| "logo-size"
	| "contact-order"
	| "geo-precision"
	| "origin-differs"
	| "schema-off"
	| "publisher-off"
	| "automatic-off"
	| "ownership-unknown"
	| "inactive";

export interface BusinessIdentityNotice {
	code: BusinessIdentityNoticeCode;
	message: string;
}

export function decimalPlaces(value: string): number {
	const dot = value.indexOf(".");
	return dot < 0 ? 0 : value.length - dot - 1;
}

/** Notices name an unmet documented requirement or a fact the owner should check; none claims an outcome. */
export function businessIdentityNotices(input: {
	facts: BusinessIdentityFacts;
	entityId: string;
	siteName: string;
	siteUrl: string;
	active: boolean;
	moduleEnabled: boolean;
	presetEnabled: boolean;
	/** From the separate ownership record; omitted is automatic. */
	publisherOutput?: "automatic" | "none" | "unknown";
}): BusinessIdentityNotice[] {
	const { facts } = input;
	const notices: BusinessIdentityNotice[] = [];
	const automatic = (input.publisherOutput ?? "automatic") === "automatic";
	if (!input.moduleEnabled) {
		notices.push({ code: "schema-off", message: "The Schema switch in Feature controls is off, so no publisher is added to any page." });
	} else if (input.publisherOutput === "none") {
		notices.push({ code: "automatic-off", message: "Automatic publisher output is off. These details stay saved, and this plugin adds no publisher, publisher links or inline publisher facts to any page until it is turned back on." });
	} else if (input.publisherOutput === "unknown") {
		notices.push({ code: "ownership-unknown", message: "The publisher output setting cannot be read, so this plugin adds no automatic publisher to any page until it is repaired." });
	} else if (!input.presetEnabled) {
		notices.push({ code: "publisher-off", message: "The Site publisher schema is turned off, so pages get no separate publisher graph. Website, article and service schema still name the publisher inline with its name, URL, logo and profiles." });
	}
	if (!input.active) {
		notices.push({
			code: "inactive",
			message: automatic
				? "This identity is saved but inactive. Where this plugin adds a publisher, it uses the one from the site settings."
				: "This identity is saved but inactive.",
		});
	}
	notices.push({
		code: "visibility",
		message: "Show each published fact visibly on the selected page. Structured data should describe content people can see there.",
	});
	if (facts.kind === "LocalBusiness" && !facts.address) {
		notices.push({
			code: "local-business-address",
			message: "Google's local business structured data requires a street address. Without one, this business is described but does not meet that requirement.",
		});
	}
	const siteName = comparableText(input.siteName);
	if (siteName && comparableText(facts.name) !== siteName && comparableText(facts.alternateName) !== siteName) {
		notices.push({
			code: "name-differs",
			message: `The name differs from the site name "${input.siteName}". Google suggests the site name matches the organization name, or that the site name is given as an alternate name.`,
		});
	}
	if (facts.kind !== "Person" && facts.logo) {
		const { width, height } = facts.logo;
		if (width === undefined || height === undefined) {
			notices.push({ code: "logo-size", message: "The logo size is unknown. Google asks for a logo of at least 112 by 112 pixels." });
		} else if (width < BUSINESS_IDENTITY_LOGO_MIN_PIXELS || height < BUSINESS_IDENTITY_LOGO_MIN_PIXELS) {
			notices.push({ code: "logo-size", message: `The logo is ${width} by ${height} pixels. Google asks for at least 112 by 112 pixels.` });
		}
	}
	if (facts.kind === "LocalBusiness" && facts.contactPoints.length && !facts.telephone && !facts.email) {
		notices.push({
			code: "contact-order",
			message: "Google prefers a local business's main phone number or email on the business itself, in addition to contact points.",
		});
	}
	const geo = facts.location?.geo;
	if (facts.kind === "LocalBusiness" && geo) {
		const places = Math.min(decimalPlaces(geo.latitude), decimalPlaces(geo.longitude));
		if (places < BUSINESS_IDENTITY_GEO_DECIMALS) {
			notices.push({
				code: "geo-precision",
				message: `The coordinates have ${places} decimal place${places === 1 ? "" : "s"}. Google asks for at least ${BUSINESS_IDENTITY_GEO_DECIMALS}. Nothing is added to what you entered.`,
			});
		}
	}
	const origin = businessIdentityEntityOrigin(input.entityId);
	if (origin && isHttpUrl(input.siteUrl) && new URL(input.siteUrl).origin !== origin) {
		notices.push({
			code: "origin-differs",
			message: `The entity ID ${input.entityId} keeps the earlier site address. References written as {{siteUrl}}/#${businessIdentityEntityFamily(input.entityId)} now name a different ID. Move the ID to the current site address when you are ready.`,
		});
	}
	return notices;
}
