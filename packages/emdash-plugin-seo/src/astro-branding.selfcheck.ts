import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { shipitSeo } from "./astro.ts";
import type { SeoPluginOptions } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "seo-branding-"));
let counter = 0;

function site(files: Record<string, string | Uint8Array> = {}): string {
	const root = join(workspace, `site-${counter++}`);
	mkdirSync(join(root, "node_modules", "emdash"), { recursive: true });
	writeFileSync(join(root, "node_modules", "emdash", "package.json"), JSON.stringify({ name: "emdash", version: "1.3.0", main: "index.js" }));
	writeFileSync(join(root, "node_modules", "emdash", "index.js"), "");
	mkdirSync(join(root, "src", "pages"), { recursive: true });
	mkdirSync(join(root, "public"));
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, "public", path)), { recursive: true });
		writeFileSync(join(root, "public", path), content);
	}
	return root;
}

const svg = (attributes = 'width="96" height="96"', body = '<rect width="96" height="96" fill="#123456"/>') =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>\n`;

function png(width: number, height: number, size = 64): Uint8Array {
	const bytes = new Uint8Array(size);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

function webp(kind: "VP8 " | "VP8L" | "VP8X", width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(40);
	const ascii = (text: string, at: number) => bytes.set([...text].map((char) => char.charCodeAt(0)), at);
	ascii("RIFF", 0); ascii("WEBP", 8); ascii(kind, 12);
	if (kind === "VP8 ") {
		bytes.set([0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8], 23);
	} else if (kind === "VP8L") {
		const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;
		bytes.set([0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], 20);
	} else {
		const w = width - 1;
		const h = height - 1;
		bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
	}
	return bytes;
}

const hash = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex").slice(0, 12);

interface Settled {
	options: SeoPluginOptions;
	adminPages: unknown;
	warnings: string[];
}

async function settle(root: string, options: unknown, config: { base?: string; donePublic?: string } = {}): Promise<Settled> {
	let descriptor: { options?: SeoPluginOptions; adminPages?: unknown } = {};
	const fakeEmdash = (emdashConfig: { plugins?: unknown[] }) => {
		descriptor = (emdashConfig.plugins ?? [])[0] as typeof descriptor;
		return { name: "emdash", hooks: { "astro:config:setup": async () => undefined } } as never;
	};
	const integration = (shipitSeo as (...args: unknown[]) => ReturnType<typeof shipitSeo>)(fakeEmdash, {}, ...(options === undefined ? [] : [options]));
	const astroConfig = (publicDir: string) => ({
		root: pathToFileURL(root + "/"), srcDir: pathToFileURL(join(root, "src") + "/"), publicDir: pathToFileURL(publicDir + "/"),
		base: config.base ?? "/", trailingSlash: "ignore", integrations: [{ name: "emdash" }], site: undefined,
	});
	const warnings: string[] = [];
	const logger = { warn: (message: string) => { warnings.push(message); }, info: () => undefined };
	const hooks = integration.hooks as Record<string, (params: unknown) => Promise<unknown>>;
	await hooks["astro:config:setup"]({
		config: astroConfig(join(root, "public")), logger, addMiddleware: () => undefined, updateConfig: () => undefined, injectRoute: () => undefined,
	});
	await hooks["astro:config:done"]({ config: astroConfig(config.donePublic ?? join(root, "public")), logger });
	return { options: descriptor.options ?? {}, adminPages: descriptor.adminPages, warnings: warnings.filter((warning) => /branding/.test(warning)) };
}

const recorded = (result: Settled) => (result.options.installation as { branding?: unknown } | undefined)?.branding;

async function rejects(root: string, options: unknown, message: RegExp, label: string, config: { base?: string; donePublic?: string } = {}) {
	await assert.rejects(async () => { await settle(root, options, config); }, message, label);
}

let cases = 0;
try {
	{
		const result = await settle(site(), undefined);
		assert.equal(recorded(result), undefined, "the two-argument form records no branding");
		assert.deepEqual(result.adminPages, [{ path: "/seo", label: "SHIPIT SEO", icon: "search" }]);
		assert.deepEqual(result.warnings, []);
		assert.equal(recorded(await settle(site(), {})), undefined, "an empty third argument changes nothing");
		assert.equal(recorded(await settle(site(), { branding: undefined })), undefined);
		cases += 1;
	}

	{
		const content = svg();
		const result = await settle(site({ "brand/acme.svg": content }), { branding: { name: "  Acme SEO  ", logo: "/brand/acme.svg" } });
		assert.deepEqual(recorded(result), {
			name: "Acme SEO",
			logo: { src: `/brand/acme.svg?v=${hash(content)}`, type: "image/svg+xml", width: 96, height: 96 },
			logoDark: null,
		});
		assert.deepEqual(result.adminPages, [{ path: "/seo", label: "Acme SEO", icon: "search" }], "the host menu label carries the name");
		assert.deepEqual(result.warnings, []);
		const nameOnly = await settle(site(), { branding: { name: "Acme SEO" } });
		assert.deepEqual(recorded(nameOnly), { name: "Acme SEO", logo: null, logoDark: null });
		cases += 1;
	}

	{
		const light = png(256, 128);
		const dark = webp("VP8X", 512, 512);
		const result = await settle(site({ "logo.png": light, "brand/dark.webp": dark }),
			{ branding: { name: "Acme", logo: "/logo.png", logoDark: "/brand/dark.webp" } }, { base: "/docs" });
		assert.deepEqual(recorded(result), {
			name: "Acme",
			logo: { src: `/docs/logo.png?v=${hash(light)}`, type: "image/png", width: 256, height: 128 },
			logoDark: { src: `/docs/brand/dark.webp?v=${hash(dark)}`, type: "image/webp", width: 512, height: 512 },
		}, "addresses follow Astro's base path");
		for (const [kind, width, height] of [["VP8 ", 100, 200], ["VP8L", 2048, 64]] as const) {
			const bytes = webp(kind, width, height);
			const facts = recorded(await settle(site({ "logo.webp": bytes }), { branding: { name: "Acme", logo: "/logo.webp" } })) as { logo: { width: number; height: number } };
			assert.deepEqual([facts.logo.width, facts.logo.height], [width, height], kind);
		}
		const box = recorded(await settle(site({ "box.svg": svg('viewBox="0 0 120 80"') }), { branding: { name: "Acme", logo: "/box.svg" } })) as { logo: { width: number; height: number } };
		assert.deepEqual([box.logo.width, box.logo.height], [120, 80], "a viewBox gives the size when width and height are absent");
		cases += 1;
	}

	{
		const result = await settle(site(), { branding: { name: "Northwind Dental Marketing" } });
		assert.equal(result.warnings.length, 1);
		assert.match(result.warnings[0]!, /^branding\.name "Northwind Dental Marketing" is longer than 16 characters, so the workspace heading wraps/);
		assert.deepEqual((await settle(site(), { branding: { name: "x".repeat(16) } })).warnings, []);
		cases += 1;
	}

	{
		const control = String.fromCharCode(7);
		const rejectedOptions: Array<[unknown, RegExp]> = [
			["Acme", /^Error: shipitSeo options must be an object/],
			[[], /^Error: shipitSeo options must be an object/],
			[{ brand: { name: "Acme" } }, /^Error: shipitSeo options: unknown option "brand"\. The only option is branding\.$/],
			[{ branding: "Acme" }, /^Error: shipitSeo branding must be an object/],
			[{ branding: { name: "Acme", color: "#fff" } }, /^Error: shipitSeo branding: unknown option "color"\. Use name, logo and logoDark\.$/],
			[{ branding: { logo: "/logo.svg" } }, /^Error: shipitSeo branding\.name is required when branding is set\.$/],
			[{ branding: { name: "" } }, /^Error: shipitSeo branding\.name "": must not be empty\.$/],
			[{ branding: { name: "   " } }, /^Error: shipitSeo branding\.name "   ": must not be empty\.$/],
			[{ branding: { name: 7 } }, /^Error: shipitSeo branding\.name 7: must be text\.$/],
			[{ branding: { name: "x".repeat(33) } }, /^Error: shipitSeo branding\.name "x{33}": must be at most 32 characters\.$/],
			[{ branding: { name: `Acme${control}SEO` } }, /^Error: shipitSeo branding\.name "Acme\\u0007SEO": must not contain control, line break or text direction characters\.$/],
			[{ branding: { name: "Acme\nSEO" } }, /must not contain control, line break or text direction characters/],
			[{ branding: { name: `Acme${String.fromCharCode(0x202e)}SEO` } }, /must not contain control, line break or text direction characters/],
			...["{", "}", "\\", "<", ">"].map((character): [unknown, RegExp] => [{ branding: { name: `Acme ${character} SEO` } }, /: must not contain \{ \} \\ < or >\.$/]),
			[{ branding: { name: "Acme", logo: "https://cdn.example.com/logo.svg" } }, /^Error: shipitSeo branding\.logo "https:\/\/cdn\.example\.com\/logo\.svg": must be a file in public\/, not a remote or data address\.$/],
			[{ branding: { name: "Acme", logo: "data:image/png;base64,AAAA" } }, /branding\.logo .*not a remote or data address/],
			[{ branding: { name: "Acme", logo: "/brand/../logo.svg" } }, /branding\.logo "\/brand\/\.\.\/logo\.svg": must not contain empty, \. or \.\. path segments\./],
			[{ branding: { name: "Acme", logo: "logo.svg" } }, /branding\.logo "logo\.svg": must start with \//],
			[{ branding: { name: "Acme", logo: "/logo.gif" } }, /^Error: shipitSeo branding\.logo "\/logo\.gif": must be an \.svg, \.png or \.webp file\.$/],
			[{ branding: { name: "Acme", logo: 12 } }, /branding\.logo 12: must be a path such as \/brand\/logo\.svg\./],
			[{ branding: { name: "Acme", logoDark: "/dark.svg" } }, /^Error: shipitSeo branding\.logoDark "\/dark\.svg": needs branding\.logo as well\.$/],
		];
		for (const [options, message] of rejectedOptions) {
			assert.throws(() => shipitSeo(() => ({ name: "emdash", hooks: { "astro:config:setup": async () => undefined } }) as never, {}, options as never),
				message, JSON.stringify(options));
		}
		cases += 1;
	}

	{
		const big = svg('width="96" height="96"', `<desc>${"x".repeat(64 * 1024)}</desc>`);
		const files: Record<string, string | Uint8Array> = {
			"directory.svg/inner.svg": svg(),
			"svg-as.png": svg(),
			"png-as.webp": png(96, 96),
			"big.svg": big,
			"big.png": png(96, 96, 256 * 1024 + 1),
			"small.png": png(32, 96),
			"huge.webp": webp("VP8X", 4096, 512),
			"script.svg": svg(undefined, "<script>alert(1)</script>"),
			"handler.svg": svg('width="96" height="96" onload="alert(1)"'),
			"foreign.svg": svg(undefined, "<foreignObject><div>x</div></foreignObject>"),
			"external.svg": svg(undefined, '<image href="https://cdn.example.com/a.png" width="96" height="96"/>'),
			"xlink.svg": svg('width="96" height="96" xmlns:xlink="http://www.w3.org/1999/xlink"', '<use xlink:href="other.svg#mark"/>'),
			"style-url.svg": svg(undefined, '<rect style="fill: url(https://cdn.example.com/p.svg#x)"/>'),
			"import.svg": svg(undefined, "<style>@import 'x.css';</style>"),
			"js.svg": svg(undefined, '<a href="javascript:alert(1)"><rect/></a>'),
			"doctype.svg": `<!DOCTYPE svg [<!ENTITY x "y">]>\n<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"/>`,
			"no-size.svg": svg(""),
			"percent.svg": svg('width="100%" height="100%"'),
			"html.svg": "<html><body>not an image</body></html>",
			"latin1.svg": new Uint8Array([...new TextEncoder().encode(svg(undefined, "<desc>")), 0xff, 0xfe, ...new TextEncoder().encode("</desc></svg>")]),
		};
		const root = site(files);
		mkdirSync(join(workspace, "outside"), { recursive: true });
		writeFileSync(join(workspace, "outside", "logo.svg"), svg());
		symlinkSync(join(workspace, "outside", "logo.svg"), join(root, "public", "linked.svg"));
		symlinkSync(join(workspace, "outside"), join(root, "public", "linked-directory"));
		const fileRules: Array<[string, RegExp]> = [
			["/missing.svg", /^Error: shipitSeo branding\.logo "\/missing\.svg": names no file in public\/\.$/],
			["/linked.svg", /branding\.logo "\/linked\.svg": must not be or pass through a symbolic link\./],
			["/linked-directory/logo.svg", /must not be or pass through a symbolic link/],
			["/directory.svg", /must name a regular file in public\//],
			["/svg-as.png", /"\/svg-as\.png": is not a PNG file; its bytes do not match the extension\./],
			["/png-as.webp", /is not a WEBP file; its bytes do not match the extension/],
			["/big.svg", /"\/big\.svg": is 65 KiB; SVG logos may be at most 64 KiB\./],
			["/big.png", /"\/big\.png": is 257 KiB; PNG logos may be at most 256 KiB\./],
			["/small.png", /"\/small\.png": must be 64 to 2048 px on each side \(found 32 x 96\)\./],
			["/huge.webp", /must be 64 to 2048 px on each side \(found 4096 x 512\)/],
			["/script.svg", /"\/script\.svg": must not contain scripts\./],
			["/handler.svg", /must not contain event handler attributes/],
			["/foreign.svg", /must not contain foreignObject/],
			["/external.svg", /must not reference other files or addresses; only #fragment references are allowed/],
			["/xlink.svg", /must not reference other files or addresses/],
			["/style-url.svg", /must not reference other files or addresses/],
			["/import.svg", /must not import style sheets/],
			["/js.svg", /must not contain javascript: addresses/],
			["/doctype.svg", /must not contain a DOCTYPE or ENTITY declaration/],
			["/no-size.svg", /needs width and height in px, or a viewBox, on its <svg> element/],
			["/percent.svg", /needs width and height in px, or a viewBox/],
			["/html.svg", /is not an SVG file; its first element must be <svg>/],
			["/latin1.svg", /is not UTF-8 SVG text/],
		];
		for (const [logo, rule] of fileRules) await rejects(root, { branding: { name: "Acme", logo } }, rule, logo);
		const local = svg(undefined, '<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="96" height="96"/><use href="#g"/>');
		writeFileSync(join(root, "public", "local.svg"), local);
		assert.ok(recorded(await settle(root, { branding: { name: "Acme", logo: "/local.svg" } })), "local #fragment references are allowed");
		await rejects(root, { branding: { name: "Acme", logo: "/local.svg", logoDark: "/script.svg" } }, /^Error: shipitSeo branding\.logoDark "\/script\.svg": must not contain scripts\.$/, "dark logo");
		cases += 1;
	}

	{
		const root = site({ "logo.svg": svg() });
		const other = join(workspace, "final-public");
		mkdirSync(other, { recursive: true });
		await rejects(root, { branding: { name: "Acme", logo: "/logo.svg" } }, /names no file in public\//, "the final public directory decides", { donePublic: other });
		const replaced = svg('width="128" height="128"');
		writeFileSync(join(other, "logo.svg"), replaced);
		const result = await settle(root, { branding: { name: "Acme", logo: "/logo.svg" } }, { donePublic: other });
		assert.deepEqual((recorded(result) as { logo: unknown }).logo, { src: `/logo.svg?v=${hash(replaced)}`, type: "image/svg+xml", width: 128, height: 128 },
			"the hash follows the file in the final public directory");
		await rejects(site({ "logo.svg": svg() }), { branding: { name: "Acme", logo: "/logo.svg" } }, /needs Astro's base path to use only letters/, "base path", { base: "/d%C3%A9" });
		cases += 1;
	}
} finally {
	rmSync(workspace, { recursive: true, force: true });
}

console.log(`SEO branding option self-check passed (${cases} groups).`);
