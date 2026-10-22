import assert from "node:assert/strict";

import { SEO_ADMIN_API_ROUTES } from "./admin-contract.ts";
import {
	SEO_DEFAULT_BRAND_NAME,
	SEO_FALLBACK_BRAND_NAME,
	seoBrandLogoPathProblem,
	seoBrandMenuLabel,
	seoBrandNameLength,
	seoBrandNameProblem,
	seoBrandState,
	validSeoAdminBranding,
	validSeoInstalledBranding,
	type SeoInstalledBranding,
} from "./branding.ts";
import { SEO_ADMIN_PAGE, seoBranding, seoPlugin, type SeoPluginOptions } from "./index.ts";
import { createPlugin } from "./native-entry.ts";
import engine, { createSeoEngine } from "./sandbox-entry.ts";

let cases = 0;
async function check(name: string, run: () => void | Promise<void>) {
	try { await run(); } catch (error) { throw new Error(name + ": " + (error instanceof Error ? error.message : String(error))); }
	cases += 1;
}

const logo = { src: "/brand/acme.svg?v=0123456789ab", type: "image/svg+xml", width: 96, height: 96 } as const;
const darkLogo = { src: "/brand/acme-dark.png?v=ba9876543210", type: "image/png", width: 128, height: 128 } as const;
const branding: SeoInstalledBranding = { name: "Acme SEO", logo, logoDark: darkLogo };
const installation = { siteOrigin: null, siteIssue: "missing", keyRoute: "unavailable" } as const;
const options = (recorded: unknown): SeoPluginOptions => ({ installation: { ...installation, branding: recorded } });

await check("names keep to the length and character rules", () => {
	assert.equal(seoBrandNameProblem("Acme SEO"), null);
	assert.equal(seoBrandNameProblem("Ağaç Dijital SEO"), null);
	assert.equal(seoBrandNameProblem("x".repeat(32)), null);
	assert.match(seoBrandNameProblem("x".repeat(33))!, /at most 32 characters/);
	assert.equal(seoBrandNameLength("e\u0301".repeat(32)), 32, "combined letters count as one character");
	assert.equal(seoBrandNameProblem("e\u0301".repeat(32)), null);
	assert.match(seoBrandNameProblem("")!, /empty/);
	assert.match(seoBrandNameProblem(42)!, /text/);
	for (const name of ["Acme {SEO}", "Acme }", "Acme \\u0041", "<b>Acme</b>", "Acme > SEO"]) {
		assert.match(seoBrandNameProblem(name)!, /must not contain \{ \} \\ < or >/, name);
	}
	for (const name of ["Acme\nSEO", "Acme\u0007", "Acme\u2028SEO", "\ufeffAcme", "Acme\u202eOES", "Acme\u2066SEO", "Acme\u200fSEO", "Acme\u0085"]) {
		assert.match(seoBrandNameProblem(name)!, /control, line break or text direction/, JSON.stringify(name));
	}
});

await check("logo paths name a file in public/ and nothing else", () => {
	for (const path of ["/brand/logo.svg", "/logo.PNG", "/a/b-c_d~e.webp"]) assert.equal(seoBrandLogoPathProblem(path), null, path);
	const rejected: Array<[unknown, RegExp]> = [
		["https://cdn.example/logo.svg", /remote or data address/],
		["data:image/svg+xml,<svg/>", /remote or data address/],
		["javascript:alert(1)", /remote or data address/],
		["//cdn.example/logo.svg", /remote or data address/],
		["brand/logo.svg", /start with \//],
		["/brand/../secret.svg", /\.\. path segments/],
		["/brand/./logo.svg", /\.\. path segments/],
		["/brand//logo.svg", /empty, \. or \.\. path segments/],
		["/brand/logo.svg?x=1", /only letters, digits/],
		["/brand/logo%2esvg", /only letters, digits/],
		["/brand\\logo.svg", /only letters, digits/],
		["/brand/logo.gif", /\.svg, \.png or \.webp/],
		["/brand/", /empty/],
		["", /path such as/],
		[null, /path such as/],
	];
	for (const [path, rule] of rejected) assert.match(seoBrandLogoPathProblem(path)!, rule, String(path));
});

await check("recorded branding is read only in the shape the adapter writes", () => {
	assert.deepEqual(validSeoInstalledBranding(branding), branding);
	assert.deepEqual(validSeoInstalledBranding({ name: "Acme SEO", logo: null, logoDark: null }), { name: "Acme SEO", logo: null, logoDark: null });
	const invalid: unknown[] = [
		null, "Acme", { name: "Acme SEO" }, { ...branding, extra: true }, { ...branding, name: " Acme SEO" }, { ...branding, name: "Acme {SEO}" },
		{ ...branding, logo: null }, { ...branding, logo: { ...logo, src: "https://cdn.example/a.svg?v=0123456789ab" } },
		{ ...branding, logo: { ...logo, src: "/brand/acme.svg" } }, { ...branding, logo: { ...logo, type: "image/png" } },
		{ ...branding, logo: { ...logo, width: 32 } }, { ...branding, logo: { ...logo, height: 4096 } }, { ...branding, logo: { ...logo, width: 96.5 } },
		{ ...branding, logo: { ...logo, extra: 1 } },
	];
	for (const value of invalid) assert.equal(validSeoInstalledBranding(value), null, JSON.stringify(value));
	assert.deepEqual(validSeoAdminBranding({ logo, logoDark: null }), { logo, logoDark: null });
	assert.equal(validSeoAdminBranding({ logo: null, logoDark: darkLogo }), null, "a dark logo needs a light one");
	assert.equal(validSeoAdminBranding({ logo }), null);
});

await check("the admin menu label is the configured name, the default, or a neutral label", () => {
	assert.equal(SEO_ADMIN_PAGE.label, SEO_DEFAULT_BRAND_NAME);
	assert.equal(seoBrandMenuLabel(seoBrandState(undefined)), "SHIPIT SEO");
	assert.equal(seoBrandMenuLabel(seoBrandState(branding)), "Acme SEO");
	assert.equal(seoBrandMenuLabel(seoBrandState({ name: "Acme {SEO}", logo: null, logoDark: null })), SEO_FALLBACK_BRAND_NAME);
	assert.equal(SEO_FALLBACK_BRAND_NAME, "SEO");
	assert.deepEqual(seoPlugin().adminPages, [SEO_ADMIN_PAGE], "the two-argument installation keeps the default entry");
	assert.deepEqual(seoPlugin({ installation }).adminPages, [{ path: "/seo", label: "SHIPIT SEO", icon: "search" }]);
	assert.deepEqual(seoPlugin(options(branding)).adminPages, [{ path: "/seo", label: "Acme SEO", icon: "search" }]);
	assert.deepEqual(seoPlugin(options({ name: 7 })).adminPages, [{ path: "/seo", label: "SEO", icon: "search" }]);
	assert.deepEqual(seoPlugin(options(branding)).options, { installation: { ...installation, branding } }, "the record reaches the runtime unchanged");
	assert.equal(seoBranding({ installation: null as never }).kind, "default");
});

await check("the native runtime names its page from branding and never throws on an unreadable record", () => {
	const warnings: unknown[][] = [];
	const warn = console.warn;
	console.warn = (...args: unknown[]) => { warnings.push(args); };
	try {
		assert.deepEqual(createPlugin().admin.pages, [{ path: "/seo", label: "SHIPIT SEO", icon: "search" }]);
		assert.deepEqual(createPlugin(options(branding)).admin.pages, [{ path: "/seo", label: "Acme SEO", icon: "search" }]);
		assert.equal(warnings.length, 0);
		const broken = createPlugin(options({ name: "Acme SEO", logo: "/brand/acme.svg", logoDark: null }));
		assert.deepEqual(broken.admin.pages, [{ path: "/seo", label: "SEO", icon: "search" }]);
		assert.ok(broken.hooks["page:metadata"], "public metadata keeps working");
		assert.equal(warnings.length, 1);
		assert.doesNotMatch(String(warnings[0]![0]), /Shipit|SHIPIT/);
	} finally {
		console.warn = warn;
	}
});

await check("one read-only route reports the logos and nothing else", async () => {
	assert.ok(SEO_ADMIN_API_ROUTES.includes("admin-branding"));
	const route = (plugin: typeof engine) => (plugin.routes as Record<string, any>)["admin-branding"];
	assert.equal(route(engine).permission, "plugins:read");
	assert.deepEqual(route(engine).methods, ["GET"]);
	assert.deepEqual(await route(engine).handler({ input: {} }, {}), { logo: null, logoDark: null }, "a sandbox host has no branding");
	const bound = createSeoEngine(undefined, { branding });
	assert.deepEqual(await route(bound).handler({ input: {} }, {}), { logo, logoDark: darkLogo });
	const unbound = createSeoEngine(undefined, { branding: { name: "Acme SEO", logo: null, logoDark: null } });
	assert.deepEqual(await route(unbound).handler({ input: {} }, {}), { logo: null, logoDark: null });
});

console.log(`SEO branding self-check passed (${cases} cases).`);
