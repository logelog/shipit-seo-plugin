import { indexNowSiteOriginUrl } from "./indexnow-site.ts";

export const INDEXNOW_PROTOCOL_VERSION = 1 as const;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_MAX_PROTOCOL_BATCH_SIZE = 10_000;
export const INDEXNOW_MAX_STORAGE_BATCH_SIZE = 1_000;
export const INDEXNOW_DEFAULT_KEY_LOCATION = "/indexnow-key.txt";
export const INDEXNOW_MIN_RESUBMIT_SECONDS = 300;
export const INDEXNOW_MAX_URL_LENGTH = 2_048;
export const INDEXNOW_MANUAL_URL_LIMIT = 1_000;
/** New installations review these types first; other public types are opt-in. */
export const INDEXNOW_DEFAULT_CONTENT_TYPES: readonly string[] = Object.freeze(["pages", "posts"]);
export const INDEXNOW_HISTORY_PAGE_SIZE = 10;
export const INDEXNOW_HISTORY_MAX_PAGE_SIZE = 50;
/** URLs kept on every history entry, also after its full URL list expires. */
export const INDEXNOW_HISTORY_SAMPLE_URLS = 3;
/** URLs per stored detail page of a longer group. */
export const INDEXNOW_HISTORY_URL_PAGE_SIZE = 100;
/**
 * Stored URLs across all full group details (at most about 10 MB of URL text
 * at the 2,048-character URL limit). The oldest group's details expire first.
 */
export const INDEXNOW_HISTORY_DETAIL_URL_BUDGET = 5_000;
/** Settled history entries kept; entries still waiting for delivery are never pruned. */
export const INDEXNOW_HISTORY_RETENTION = 500;

export interface IndexNowSettingsValues {
	enabled: boolean;
	autoSubmit: boolean;
	/**
	 * Null is the legacy "every eligible public type, including later ones";
	 * an empty list selects none. Both are kept as saved.
	 */
	autoSubmitContentTypes: string[] | null;
	apiKey: string;
	keyLocation: string;
	batchSize: number;
	minIntervalSeconds: number;
	maxAttempts: number;
}

export type IndexNowSettingsField = keyof IndexNowSettingsValues;
export type IndexNowSettingsErrors = Partial<Record<IndexNowSettingsField | "_form", string>>;
export type IndexNowSettingsValidation =
	| { success: true; values: IndexNowSettingsValues }
	| { success: false; errors: IndexNowSettingsErrors };

export type IndexNowDeliveryDisposition = "accepted" | "retry" | "failed";

export interface IndexNowResponseDisposition {
	disposition: IndexNowDeliveryDisposition;
	status: number;
	detail: string;
}

export interface IndexNowPayload {
	host: string;
	key: string;
	keyLocation: string;
	urlList: string[];
}

export function defaultIndexNowSettings(): IndexNowSettingsValues {
	return {
		enabled: false,
		autoSubmit: false,
		autoSubmitContentTypes: [...INDEXNOW_DEFAULT_CONTENT_TYPES],
		apiKey: "",
		keyLocation: INDEXNOW_DEFAULT_KEY_LOCATION,
		batchSize: 100,
		minIntervalSeconds: INDEXNOW_MIN_RESUBMIT_SECONDS,
		maxAttempts: 5,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
	if (typeof value !== "number" || !Number.isInteger(value)) return null;
	return value >= minimum && value <= maximum ? value : null;
}

export function isValidIndexNowKey(value: string): boolean {
	return value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9-]+$/.test(value);
}

export function validateIndexNowSettings(input: unknown): IndexNowSettingsValidation {
	if (!isRecord(input)) return { success: false, errors: { _form: "IndexNow settings are invalid." } };

	const errors: IndexNowSettingsErrors = {};
	const defaults = defaultIndexNowSettings();
	const enabled = typeof input.enabled === "boolean" ? input.enabled : null;
	const autoSubmit = typeof input.autoSubmit === "boolean" ? input.autoSubmit : null;
	let autoSubmitContentTypes: string[] | null = null;
	if (input.autoSubmitContentTypes !== undefined && input.autoSubmitContentTypes !== null) {
		if (!Array.isArray(input.autoSubmitContentTypes) || input.autoSubmitContentTypes.length > 100 ||
			input.autoSubmitContentTypes.some((collection) =>
				typeof collection !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(collection)) ||
			new Set(input.autoSubmitContentTypes).size !== input.autoSubmitContentTypes.length) {
			errors.autoSubmitContentTypes = "Choose up to 100 unique public content types.";
		} else {
			autoSubmitContentTypes = [...input.autoSubmitContentTypes];
		}
	}
	const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
	const keyLocation = typeof input.keyLocation === "string"
		? input.keyLocation.trim() || defaults.keyLocation
		: defaults.keyLocation;
	const batchSize = boundedInteger(input.batchSize, 1, INDEXNOW_MAX_STORAGE_BATCH_SIZE);
	const minIntervalSeconds = boundedInteger(input.minIntervalSeconds, INDEXNOW_MIN_RESUBMIT_SECONDS, 86_400);
	const maxAttempts = boundedInteger(input.maxAttempts, 1, 10);

	if (enabled === null) errors.enabled = "Choose whether IndexNow is enabled.";
	if (autoSubmit === null) errors.autoSubmit = "Choose whether content changes are submitted automatically.";
	if (apiKey && !isValidIndexNowKey(apiKey)) {
		errors.apiKey = "Use 8-128 letters, numbers, or hyphens.";
	} else if (enabled && !apiKey) {
		errors.apiKey = "Add or generate an API key before enabling IndexNow.";
	}
	if (!validKeyLocationShape(keyLocation)) {
		errors.keyLocation = "Use a root-relative path or an absolute HTTP(S) URL.";
	}
	if (batchSize === null) errors.batchSize = `Use a whole number from 1 to ${INDEXNOW_MAX_STORAGE_BATCH_SIZE}.`;
	if (minIntervalSeconds === null) {
		errors.minIntervalSeconds = "Use a resubmission interval from 300 to 86400 seconds.";
	}
	if (maxAttempts === null) errors.maxAttempts = "Use a whole number from 1 to 10.";

	if (Object.keys(errors).length) return { success: false, errors };
	return {
		success: true,
		values: {
			enabled: enabled as boolean,
			autoSubmit: autoSubmit as boolean,
			autoSubmitContentTypes,
			apiKey,
			keyLocation,
			batchSize: batchSize as number,
			minIntervalSeconds: minIntervalSeconds as number,
			maxAttempts: maxAttempts as number,
		},
	};
}

function validKeyLocationShape(value: string): boolean {
	if (value.startsWith("/") && !value.startsWith("//")) return true;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function indexNowPublicOrigin(value: string): { ready: true; origin: string } | { ready: false; reason: string } {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { ready: false, reason: "Set a valid production site URL first." };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { ready: false, reason: "The production URL must use HTTP or HTTPS." };
	}
	if (isLocalIndexNowHost(url.hostname)) {
		return { ready: false, reason: "IndexNow delivery is disabled for local or private hosts." };
	}
	return { ready: true, origin: url.origin };
}

export function isLocalIndexNowHost(value: string): boolean {
	const hostname = value.toLowerCase();
	return hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname === "[::1]" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local") ||
		isPrivateIpv4(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split(".").map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
	return parts[0] === 10 ||
		parts[0] === 127 ||
		(parts[0] === 169 && parts[1] === 254) ||
		(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
		(parts[0] === 192 && parts[1] === 168);
}

export function resolveIndexNowKeyLocation(value: string, siteOrigin: string): string | null {
	try {
		const origin = new URL(siteOrigin);
		const resolved = new URL(value, origin);
		if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
		if (resolved.host !== origin.host) return null;
		resolved.hash = "";
		return resolved.href;
	} catch {
		return null;
	}
}

export function normalizeIndexNowUrl(value: string, siteOrigin: string): string | null {
	if (!value || value.length > INDEXNOW_MAX_URL_LENGTH) return null;
	try {
		const origin = new URL(siteOrigin);
		const url = new URL(value, origin);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		if (url.host !== origin.host || url.username || url.password) return null;
		url.hash = "";
		return url.href;
	} catch {
		return null;
	}
}

export function uniqueIndexNowUrls(values: readonly string[], siteOrigin: string): string[] {
	const urls = new Set<string>();
	for (const value of values) {
		const normalized = normalizeIndexNowUrl(value, siteOrigin);
		if (normalized) urls.add(normalized);
	}
	return [...urls];
}

export function buildIndexNowPayload(
	urls: readonly string[],
	settings: IndexNowSettingsValues,
	siteOrigin: string,
): IndexNowPayload {
	const origin = new URL(siteOrigin);
	const urlList = uniqueIndexNowUrls(urls, origin.origin);
	if (!urlList.length) throw new Error("IndexNow requires at least one same-host URL.");
	if (urlList.length > INDEXNOW_MAX_PROTOCOL_BATCH_SIZE) {
		throw new Error(`IndexNow accepts at most ${INDEXNOW_MAX_PROTOCOL_BATCH_SIZE} URLs per request.`);
	}
	if (!isValidIndexNowKey(settings.apiKey)) throw new Error("IndexNow API key is invalid.");
	const keyLocation = resolveIndexNowKeyLocation(settings.keyLocation, origin.origin);
	if (!keyLocation) throw new Error("IndexNow key location must use the submitted URL host.");
	return { host: origin.host, key: settings.apiKey, keyLocation, urlList };
}

export function classifyIndexNowResponse(status: number): IndexNowResponseDisposition {
	if (status === 200) return { disposition: "accepted", status, detail: "URLs accepted by IndexNow." };
	if (status === 202) return { disposition: "accepted", status, detail: "URLs accepted while the API key is verified." };
	if (status === 429) return { disposition: "retry", status, detail: "IndexNow rate limit reached." };
	if (status >= 500 && status <= 599) return { disposition: "retry", status, detail: "IndexNow is temporarily unavailable." };
	if (status === 400) return { disposition: "failed", status, detail: "IndexNow rejected the request format." };
	if (status === 403) return { disposition: "failed", status, detail: "IndexNow could not verify the API key." };
	if (status === 422) return { disposition: "failed", status, detail: "IndexNow rejected the host, key, or submitted URLs." };
	return { disposition: "failed", status, detail: `IndexNow returned HTTP ${status}.` };
}

export function indexNowRetryAt(
	attempt: number,
	retryAfter: string | null | undefined,
	now = new Date(),
	minimumDelaySeconds = INDEXNOW_MIN_RESUBMIT_SECONDS,
): string {
	const headerDelay = retryAfterDelay(retryAfter, now);
	const fallbackSeconds = [300, 900, 3_600, 21_600, 43_200, 86_400][Math.max(0, attempt - 1)] ?? 86_400;
	const delayMs = Math.min(
		Math.max(minimumDelaySeconds * 1_000, headerDelay ?? fallbackSeconds * 1_000),
		86_400_000,
	);
	return new Date(now.getTime() + Math.max(1_000, delayMs)).toISOString();
}

function retryAfterDelay(value: string | null | undefined, now: Date): number | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000;
	const timestamp = Date.parse(trimmed);
	return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - now.getTime());
}

export function createIndexNowKey(bytes?: Uint8Array): string {
	const source = bytes ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
	if (source.length < 16) throw new Error("IndexNow key generation requires at least 16 random bytes.");
	return [...source.slice(0, 16)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function createIndexNowDeliveryNonce(bytes?: Uint8Array): string {
	const source = bytes ?? globalThis.crypto.getRandomValues(new Uint8Array(8));
	if (source.length < 8) throw new Error("IndexNow delivery nonces require at least 8 random bytes.");
	return [...source.slice(0, 8)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function indexNowJobId(url: string): string {
	return `url:${encodeURIComponent(url)}`;
}

export function indexNowDeliveryId(
	createdAt: string,
	urls: readonly string[],
	attempt: number,
	nonce?: string,
): string {
	if (!Number.isInteger(attempt) || attempt < 1) {
		throw new Error("IndexNow delivery attempts must be positive integers.");
	}
	let hash = 2166136261;
	for (const character of urls.join("\n")) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	const suffix = nonce ? `:${encodeURIComponent(nonce)}` : "";
	return `delivery:${createdAt}:attempt-${attempt}:${(hash >>> 0).toString(16).padStart(8, "0")}${suffix}`;
}

export type IndexNowSiteIssue = "missing" | "local" | "not-https" | "path" | "port" | "not-public";

export interface IndexNowSiteClassification {
	/** Public HTTPS origin that a narrow hostname permission can be bound to. */
	siteUrl: string | null;
	/** Origin of the configured site, also when IndexNow cannot use it. */
	siteOrigin: string | null;
	issue: IndexNowSiteIssue | null;
}

export function classifyIndexNowSite(site: unknown): IndexNowSiteClassification {
	if (typeof site !== "string" || !site.trim()) return { siteUrl: null, siteOrigin: null, issue: "missing" };
	let url: URL;
	try {
		url = new URL(site);
	} catch {
		return { siteUrl: null, siteOrigin: null, issue: "missing" };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return { siteUrl: null, siteOrigin: null, issue: "not-public" };
	const siteOrigin = url.origin;
	if (isLocalIndexNowHost(url.hostname)) return { siteUrl: null, siteOrigin, issue: "local" };
	if (url.protocol !== "https:") return { siteUrl: null, siteOrigin, issue: "not-https" };
	if (url.username || url.password) return { siteUrl: null, siteOrigin, issue: "not-public" };
	if (url.port) return { siteUrl: null, siteOrigin, issue: "port" };
	if (url.pathname !== "/" || url.search || url.hash) return { siteUrl: null, siteOrigin, issue: "path" };
	try {
		return { siteUrl: indexNowSiteOriginUrl(siteOrigin).origin, siteOrigin, issue: null };
	} catch {
		return { siteUrl: null, siteOrigin, issue: "not-public" };
	}
}

export type IndexNowKeyRoute = "injected" | "existing" | "unavailable";

/** Installation facts the host adapter supplies; the engine never widens them. */
export interface IndexNowInstallation {
	/** `astro`: the single Astro entry point; `legacy`: plugin options only; `unknown`: no facts. */
	mode: "astro" | "legacy" | "unknown";
	siteUrl: string | null;
	siteOrigin: string | null;
	siteIssue: IndexNowSiteIssue | null;
	keyRoute: IndexNowKeyRoute | null;
}

export const UNKNOWN_INDEXNOW_INSTALLATION: IndexNowInstallation = Object.freeze({
	mode: "unknown", siteUrl: null, siteOrigin: null, siteIssue: null, keyRoute: null,
});

export type IndexNowSetupIssueCode = "missing-site" | "local-site" | "invalid-site" | "permission" | "key-route";

export interface IndexNowSetupIssue {
	code: IndexNowSetupIssueCode;
	title: string;
	description: string;
}

const SITE_ISSUE_DESCRIPTIONS: Record<Exclude<IndexNowSiteIssue, "missing" | "local">, (origin: string) => string> = {
	"not-https": (origin) => `IndexNow needs an HTTPS address, but the site is configured as ${origin}.`,
	path: () => "IndexNow needs the site's root address, without a path, query or fragment.",
	port: (origin) => `IndexNow needs the standard HTTPS port, but the site is configured as ${origin}.`,
	"not-public": (origin) => origin
		? `IndexNow needs a public domain name, and ${origin} is not one.`
		: "IndexNow needs a public HTTPS domain name.",
};

function localSiteIssue(origin: string): IndexNowSetupIssue {
	return {
		code: "local-site",
		title: "This site is running on a local address",
		description: `IndexNow can only be verified on a public HTTPS address. Search engines cannot reach ${origin}, so nothing is sent from this site.`,
	};
}

/** The first installation fact that prevents setup on this site, before any key is stored. */
export function indexNowSetupIssue(installation: IndexNowInstallation, origin: string): IndexNowSetupIssue | null {
	if (installation.mode === "astro") {
		if (installation.siteIssue === "missing" || (!installation.siteUrl && !installation.siteOrigin)) return {
			code: "missing-site",
			title: "Public site address missing",
			description: "IndexNow needs this site's public HTTPS address. Ask the site developer to set it as Astro's site option and deploy again.",
		};
		if (installation.siteIssue === "local") return localSiteIssue(installation.siteOrigin ?? origin);
		if (installation.siteIssue) return {
			code: "invalid-site",
			title: "Public site address not supported",
			description: `${SITE_ISSUE_DESCRIPTIONS[installation.siteIssue](installation.siteOrigin ?? "")} Ask the site developer to set Astro's site option to the public HTTPS address, such as https://www.example.com.`,
		};
		if (installation.keyRoute === "unavailable") return {
			code: "key-route",
			title: "Key file cannot be served",
			description: "The site is not mounted at its root path, so the key file cannot be published at /indexnow-key.txt.",
		};
		return null;
	}
	let url: URL | null = null;
	try { url = new URL(origin); } catch { url = null; }
	if (url && isLocalIndexNowHost(url.hostname)) return localSiteIssue(url.origin);
	if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return {
		code: "missing-site",
		title: "Public site address missing",
		description: "Set this site's public HTTPS address before turning on IndexNow.",
	};
	if (installation.mode === "legacy") {
		let bound: string | null = null;
		try { bound = installation.siteUrl ? new URL(installation.siteUrl).hostname : null; } catch { bound = null; }
		if (bound !== url.hostname) return {
			code: "permission",
			title: "Installation needs the public site address",
			description: `This installation cannot read the key file on ${url.origin}. Ask the site developer to install the plugin with this public HTTPS address and deploy again.`,
		};
	}
	return null;
}

export type IndexNowSubmissionSource = "automatic" | "manual";
export type IndexNowSubmissionEvent = "publish" | "update" | "unpublish" | "delete" | "url-change";
export type IndexNowSubmissionStatus = "queued" | "retry" | "sent" | "accepted" | "failed" | "superseded";
export const INDEXNOW_SUBMISSION_STATUSES: readonly IndexNowSubmissionStatus[] = Object.freeze([
	"queued", "retry", "sent", "accepted", "failed", "superseded",
]);
export const INDEXNOW_SETTLED_SUBMISSION_STATUSES: readonly IndexNowSubmissionStatus[] = Object.freeze([
	"sent", "accepted", "failed", "superseded",
]);

/** Every recorded URL of a submission is in exactly one bucket. */
export interface IndexNowSubmissionCounts {
	queued: number;
	retrying: number;
	sent: number;
	accepted: number;
	failed: number;
	skipped: number;
	superseded: number;
}

export const INDEXNOW_SUBMISSION_BUCKETS: readonly (keyof IndexNowSubmissionCounts)[] = Object.freeze([
	"queued", "retrying", "sent", "accepted", "failed", "skipped", "superseded",
]);

export function emptyIndexNowSubmissionCounts(): IndexNowSubmissionCounts {
	return { queued: 0, retrying: 0, sent: 0, accepted: 0, failed: 0, skipped: 0, superseded: 0 };
}

export function indexNowSubmissionStatus(counts: IndexNowSubmissionCounts): IndexNowSubmissionStatus {
	if (counts.retrying > 0) return "retry";
	if (counts.queued > 0) return "queued";
	if (counts.failed > 0) return "failed";
	if (counts.accepted > 0) return "accepted";
	if (counts.sent > 0) return "sent";
	return "superseded";
}

export function indexNowSubmissionReason(
	source: IndexNowSubmissionSource,
	event: IndexNowSubmissionEvent | null,
): "publish" | "update" | "unpublish" | "delete" | "manual" {
	if (source === "manual" || event === null) return "manual";
	return event === "url-change" ? "unpublish" : event;
}

export function indexNowHistoryScope(filters: { status?: string | null; source?: string | null }): string {
	return `status=${filters.status ?? "all"};source=${filters.source ?? "all"}`;
}

/** A history cursor only continues the filter it was issued for. */
export function encodeIndexNowHistoryCursor(scope: string, hostCursor: string): string {
	let binary = "";
	for (const byte of new TextEncoder().encode(JSON.stringify({ v: 1, scope, cursor: hostCursor })))
		binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeIndexNowHistoryCursor(token: unknown, scope: string): string | null {
	if (typeof token !== "string" || !token || token.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
	try {
		const binary = atob(token.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((token.length + 3) % 4));
		const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
			Uint8Array.from(binary, (character) => character.charCodeAt(0)),
		)) as { v?: unknown; scope?: unknown; cursor?: unknown };
		return value?.v === 1 && value.scope === scope && typeof value.cursor === "string" &&
			value.cursor.length > 0 && value.cursor.length <= 512 ? value.cursor : null;
	} catch {
		return null;
	}
}
