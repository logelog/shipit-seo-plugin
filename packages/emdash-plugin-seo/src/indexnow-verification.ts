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

function keyFileLocation(settings: IndexNowSettingsValues, siteUrl: string): string {
	let site: URL;
	try { site = indexNowSiteOriginUrl(siteUrl); }
	catch { throw new IndexNowSetupError("Automatic setup requires this website's public HTTPS domain in the site settings and plugin network configuration.", "origin"); }
	const location = resolveIndexNowKeyLocation(settings.keyLocation, site.origin);
	if (!location) throw new IndexNowSetupError("The verification file must belong to this website.", "key");
	const url = new URL(location);
	if (url.origin !== site.origin || url.username || url.password || url.search ||
		!/^\/[A-Za-z0-9._~-]+\.txt$/.test(url.pathname))
		throw new IndexNowSetupError("Use a text verification file at the root of this website.", "key");
	return url.href;
}

export function indexNowVerificationUrl(settings: IndexNowSettingsValues, siteUrl: string): string {
	const location = keyFileLocation(settings, siteUrl);
	if (!isValidIndexNowKey(settings.apiKey)) throw new IndexNowSetupError("The verification key is invalid.", "key");
	return location;
}

export const INDEXNOW_KEY_VERIFICATION_USER_AGENT = "IndexNowKeyVerifier/1.0";

async function readIndexNowKeyFile(ctx: PluginContext, location: string): Promise<string> {
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
				headers: { accept: "text/plain", "user-agent": INDEXNOW_KEY_VERIFICATION_USER_AGENT }, signal,
			});
			void request.then((late) => {
				if (signal.aborted) void late.body?.cancel().catch(() => {});
			}, () => {});
			response = await Promise.race([request, aborted]);
		} catch (error) {
			if (error instanceof IndexNowSetupError) throw error;
			throw new IndexNowSetupError("The key file could not be reached at the public site address. Check that the deployed site is online and installed through the plugin's Astro integration, then try again.");
		}
		const rejectResponse = (message: string): never => {
			void response.body?.cancel().catch(() => {});
			throw new IndexNowSetupError(message);
		};
		if (response.status >= 300 && response.status < 400)
			rejectResponse("The key file redirects to another address. Serve it directly at the configured public address, then try again.");
		if (response.status === 403)
			rejectResponse("The key file returned HTTP 403. Check firewall or access rules that block public verification requests, then try again.");
		if (response.status === 404)
			rejectResponse("The key file returned HTTP 404. Check that the deployed site serves the configured verification file, then try again.");
		if (response.status !== 200)
			rejectResponse("The key file returned HTTP " + response.status + ". It must respond with HTTP 200 before IndexNow can turn on.");
		if (response.redirected || (response.url && response.url !== location))
			rejectResponse("The key file redirects to another address. Serve it directly at the configured public address, then try again.");
		if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/plain")
			rejectResponse("The key file was not served as plain text. Serve only the verification key with a text/plain content type.");
		reader = response.body?.getReader();
		if (!reader) throw new IndexNowSetupError("The host did not provide a readable verification file.");
		while (true) {
			const chunk = await Promise.race([reader.read(), aborted]);
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > 256) throw new IndexNowSetupError("The verification file is larger than 256 bytes. Serve only the IndexNow key.");
			try { text += decoder.decode(chunk.value, { stream: true }); }
			catch { throw new IndexNowSetupError("The verification file is not valid UTF-8 plain text."); }
		}
		try { text += decoder.decode(); }
		catch { throw new IndexNowSetupError("The verification file is not valid UTF-8 plain text."); }
	} catch (error) {
		if (error instanceof IndexNowSetupError) throw error;
		throw new IndexNowSetupError("The verification file could not be read completely. Check the public file and try again.");
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", onAbort);
		void reader?.cancel().catch(() => {});
	}
	const key = text.trim();
	if (!isValidIndexNowKey(key))
		throw new IndexNowSetupError("The verification file must contain one valid IndexNow key as plain text.");
	return key;
}

function verification(settings: IndexNowSettingsValues, siteUrl: string, apiKey: string): IndexNowVerification {
	return {
		siteOrigin: indexNowSiteOriginUrl(siteUrl).origin, keyLocation: settings.keyLocation,
		apiKey, checkedAt: new Date().toISOString(),
	};
}

/** Read a site-owned key before the first setup, without replacing its file. */
export async function readExistingIndexNowKey(
	ctx: PluginContext,
	settings: IndexNowSettingsValues,
	siteUrl: string,
): Promise<IndexNowVerification> {
	const key = await readIndexNowKeyFile(ctx, keyFileLocation(settings, siteUrl));
	return verification(settings, siteUrl, key);
}

export async function verifyIndexNowKey(
	ctx: PluginContext,
	settings: IndexNowSettingsValues,
	siteUrl: string,
): Promise<IndexNowVerification> {
	const key = await readIndexNowKeyFile(ctx, indexNowVerificationUrl(settings, siteUrl));
	if (key !== settings.apiKey)
		throw new IndexNowSetupError("The verification file does not contain the current key. Match the saved key and the site's file without replacing an existing key unintentionally, then try again.");
	return verification(settings, siteUrl, settings.apiKey);
}
