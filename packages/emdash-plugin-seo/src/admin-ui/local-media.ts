// Media chosen in the host picker is stored as its same-origin local path,
// never as an absolute URL that would pin the admin origin.

export const LOCAL_MEDIA_PREFIX = "/_emdash/api/media/file/";

export function selectedLocalMediaUrl(value: string): string {
  try {
    if (value.includes("?") || value.includes("#")) return "";
    const origin = typeof window === "undefined" ? "https://emdash.invalid" : window.location.origin;
    const absolute = /^https?:\/\//i.test(value);
    if (!absolute && !value.startsWith("/")) return "";
    const url = new URL(value, origin);
    const rawPath = absolute ? value.slice(value.indexOf("/", value.indexOf("://") + 3)) : value;
    if (url.origin !== origin || url.username || url.password || url.pathname !== rawPath) return "";
    return url.pathname.startsWith(LOCAL_MEDIA_PREFIX) && url.pathname.length > LOCAL_MEDIA_PREFIX.length
      ? url.pathname
      : "";
  } catch {
    return "";
  }
}
