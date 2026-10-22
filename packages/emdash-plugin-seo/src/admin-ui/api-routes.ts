import {
	SEO_ADMIN_API_ROUTES,
	SEO_ENGINE_PLUGIN_ID,
	type SeoAdminApiRoute,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

const SEO_API = `/_emdash/api/plugins/${SEO_ENGINE_PLUGIN_ID}`;
export const SEO_WORKSPACE_URL = `/_emdash/admin/plugins/${SEO_ENGINE_PLUGIN_ID}/seo`;

export { SEO_ADMIN_API_ROUTES };
export type { SeoAdminApiRoute };

export function seoAdminApiUrl(route: SeoAdminApiRoute): string {
	return `${SEO_API}/${route}`;
}
