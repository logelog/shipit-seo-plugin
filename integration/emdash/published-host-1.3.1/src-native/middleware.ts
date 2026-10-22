import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(({ url }, next) => {
  const isDevShortcut = url.pathname === "/_emdash/api/auth/dev-bypass" || url.pathname.startsWith("/_emdash/api/setup/dev-");
  if (isDevShortcut && !(import.meta.env.DEV && url.origin === "http://127.0.0.1:4365")) {
    return new Response("Development authentication shortcuts are unavailable outside the local preview.", { status: 403 });
  }
  return next();
});
