// Astro middleware entry added by shipitSeo(). Vite generates the owner
// module after the configuration and routes are final.
import owner from "virtual:shipit-seo/llms-txt-owner";

import { createLlmsTxtMiddleware } from "./llms-txt-middleware.ts";

export const onRequest = createLlmsTxtMiddleware(owner);
