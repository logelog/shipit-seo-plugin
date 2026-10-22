import type { PluginContext } from "emdash";
import type { SeoAdminIndexNowSetupStep } from "./admin-contract.ts";
import { isValidIndexNowKey, resolveIndexNowKeyLocation, type IndexNowSettingsValues } from "./indexnow.ts";
import { indexNowSiteOriginUrl } from "./indexnow-site.ts";

export class IndexNowSetupError extends Error {
	readonly step: SeoAdminIndexNowSetupStep;

	constructor(message: string, step: SeoAdminIndexNowSetupStep = "verify") {
		super(message);
		this.step = step;
	}
}

export interface IndexNowVerification {
	siteOrigin: string;
	keyLocation: string;
	apiKey: string;
	checkedAt: string;
}

export function matchesIndexNowVerification(
	value: unknown,
	settings: IndexNowSettingsValues,
	siteOrigin: string,
): value is IndexNowVerification {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Partial<IndexNowVerification>;
	return typeof siteOrigin === "string" && siteOrigin.length > 0 &&
		candidate.siteOrigin === siteOrigin && candidate.apiKey === settings.apiKey &&
		isValidIndexNowKey(settings.apiKey) &&
		candidate.keyLocation === settings.keyLocation && typeof candidate.checkedAt === "string" &&
		Number.isFinite(Date.parse(candidate.checkedAt));
}

export function indexNowVerificationUrl(settings: IndexNowSettingsValues, siteUrl: string): string {
	let site: URL;
	try { site = indexNowSiteOriginUrl(siteUrl); }
	catch { throw new IndexNowSetupError("Automatic setup requires this website's public HTTPS domain in the site settings and plugin network configuration.", "origin"); }
	if (!isValidIndexNowKey(settings.apiKey)) throw new IndexNowSetupError("The verification key is invalid.", "key");
	const location = resolveIndexNowKeyLocation(settings.keyLocation, site.origin);
	if (!location) throw new IndexNowSetupError("The verification file must belong to this website.", "key");
	const url = new URL(location);
	if (url.origin !== site.origin || url.username || url.password || url.search ||
		!/^\/[A-Za-z0-9._~-]+\.txt$/.test(url.pathname))
		throw new IndexNowSetupError("Use a text verification file at the root of this website.", "key");
	return url.href;
}

export async function verifyIndexNowKey(
	ctx: PluginContext,
	settings: IndexNowSettingsValues,
	siteUrl: string,
): Promise<IndexNowVerification> {
	const location = indexNowVerificationUrl(settings, siteUrl);
	if (!ctx.http) throw new IndexNowSetupError("IndexNow network access is unavailable.");
	const controller = new AbortController();
	const { signal } = controller;
	let rejectAbort!: (reason: Error) => void;
	const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
	const onAbort = () => rejectAbort(new IndexNowSetupError("Verification timed out. Try again."));
	signal.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => controller.abort(), 5_000);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let text = "";
	let size = 0;
	const decoder = new TextDecoder("utf-8", { fatal: true });
	try {
		let response: Response;
		try {
			const request = ctx.http.fetch(location, {
				method: "GET", redirect: "manual", credentials: "omit",
				headers: { accept: "text/plain" }, signal,
			});
			void request.then((late) => {
				if (signal.aborted) void late.body?.cancel().catch(() => {});
			}, () => {});
			response = await Promise.race([request, aborted]);
		} catch (error) {
			if (error instanceof IndexNowSetupError) throw error;
			throw new IndexNowSetupError("The key file could not be reached at the public site address. Check that the deployed site is online and installed through the plugin's Astro integration, then try again.");
		}
		if (response.status !== 200 || response.redirected || (response.url && response.url !== location) ||
			response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/plain") {
			void response.body?.cancel().catch(() => {});
			throw new IndexNowSetupError("The website must serve the verification file directly as plain text. Check its route and access rules.");
		}
		reader = response.body?.getReader();
		if (!reader) throw new IndexNowSetupError("The host did not provide a readable verification file.");
		while (true) {
			const chunk = await Promise.race([reader.read(), aborted]);
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > 256) throw new IndexNowSetupError("The verification file contains unexpected content.");
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", onAbort);
		void reader?.cancel().catch(() => {});
	}
	if (text.trim() !== settings.apiKey)
		throw new IndexNowSetupError("The verification file does not contain the current key. Check the deployed route and try again.");
	return {
		siteOrigin: new URL(siteUrl).origin, keyLocation: settings.keyLocation,
		apiKey: settings.apiKey, checkedAt: new Date().toISOString(),
	};
}
