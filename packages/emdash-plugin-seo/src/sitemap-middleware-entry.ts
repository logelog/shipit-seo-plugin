// Astro middleware entry added by shipitSeo(). Vite generates the owner
// module after the configuration and routes are final.
import owner from "virtual:shipit-seo/sitemap-owner";

import { createSitemapMiddleware } from "./sitemap-middleware.ts";

export const onRequest = createSitemapMiddleware(owner);
