import { createIndexNowKeyRoute } from "./indexnow-astro.ts";

export const prerender = false;
export const GET = createIndexNowKeyRoute();
export const HEAD = GET;
