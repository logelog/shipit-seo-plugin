const SITE_URL_ERROR = "IndexNow site URL must be an HTTPS origin with a public DNS hostname.";
const NONPUBLIC_SUFFIXES = new Set([
	"localhost", "local", "internal", "intranet", "lan", "home", "corp",
	"test", "invalid", "example", "onion", "arpa",
]);

export function indexNowSiteOriginUrl(siteUrl: string): URL {
	let url: URL;
	try {
		if (typeof siteUrl !== "string" || !siteUrl.startsWith("https://") ||
			siteUrl.includes("?") || siteUrl.includes("#") || siteUrl.includes("@") ||
			/[\u0000-\u0020\u007f\\]/.test(siteUrl)) throw new Error(SITE_URL_ERROR);
		const pathStart = siteUrl.indexOf("/", "https://".length);
		if (pathStart !== -1 && siteUrl.slice(pathStart) !== "/") throw new Error(SITE_URL_ERROR);
		url = new URL(siteUrl);
	} catch {
		throw new Error(SITE_URL_ERROR);
	}
	const labels = url.hostname.split(".");
	const suffix = labels.at(-1)!;
	if (url.protocol !== "https:" || url.username || url.password || url.port ||
		url.pathname !== "/" || url.search || url.hash ||
		url.hostname.length > 253 || labels.length < 2 ||
		labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
		!/[a-z]/.test(suffix) || suffix.length < 2 || NONPUBLIC_SUFFIXES.has(suffix)) {
		throw new Error(SITE_URL_ERROR);
	}
	return new URL(url.origin);
}
