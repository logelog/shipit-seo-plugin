import type { PluginContext } from "emdash";

export interface SeoPublicUrlRoute {
	collection: string;
	locale: string;
	/** Omit for a {slug} pattern; exact slug rules take precedence. */
	slug?: string;
	/** Read this saved data field before falling back to the native slug. */
	slugField?: string;
	path: string;
}

/** Native site route declarations; these do not register or rewrite routes. */
export interface SeoPublicUrlOptions {
	routes: readonly SeoPublicUrlRoute[];
}

interface PublicUrlHost {
	options: SeoPublicUrlOptions;
	origin: string | null;
}

const hosts = new WeakMap<object, PublicUrlHost>();
const key = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value) && !["prototype", "constructor"].includes(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u0020\u007f]/.test(value);

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value) &&
		(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
		Object.values(Object.getOwnPropertyDescriptors(value)).every((property) => "value" in property);
}

function pathIsValid(path: unknown, exact: boolean): path is string {
	if (typeof path !== "string" || path.length > 1024 || !path.startsWith("/") || path.startsWith("//") || /[\\?#\u0000-\u0020\u007f]/.test(path)) return false;
	if (exact ? /[{}]/.test(path) : (path.match(/\{slug\}/g)?.length !== 1 || /[{}]/.test(path.replace("{slug}", "probe")))) return false;
	const probe = path.replace("{slug}", "probe");
	try {
		const url = new URL(probe, "https://example.invalid");
		return url.origin === "https://example.invalid" && url.pathname === probe && !/%(?:2e|2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(probe);
	} catch { return false; }
}

export function checkSeoPublicUrlOptions(value: unknown): SeoPublicUrlOptions | undefined {
	if (value === undefined) return undefined;
	if (!record(value) || Object.keys(value).some((name) => name !== "routes") || !Array.isArray(value.routes) || value.routes.length < 1 || value.routes.length > 256 ||
		Object.getOwnPropertyNames(value.routes).length !== value.routes.length + 1 ||
		Array.from({ length: value.routes.length }, (_, index) => Object.getOwnPropertyDescriptor(value.routes, String(index))).some((property) => !property || !("value" in property))) {
		throw new Error("publicUrls must contain 1 to 256 native site route rules.");
	}
	const identities = new Set<string>();
	const fields = new Map<string, unknown>();
	const routes = value.routes.map((route) => {
		if (!record(route) || Object.keys(route).some((name) => !["collection", "locale", "slug", "slugField", "path"].includes(name)) ||
			!key(route.collection) || typeof route.locale !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(route.locale) ||
			(route.slug !== undefined && !text(route.slug)) || (route.slugField !== undefined && !key(route.slugField)) ||
			!pathIsValid(route.path, route.slug !== undefined)) {
			throw new Error("publicUrls contains an invalid collection, locale, slug or local path.");
		}
		const identity = JSON.stringify([route.collection, route.locale, route.slugField ?? null, route.slug ?? null]);
		if (identities.has(identity)) throw new Error("publicUrls contains a duplicate route rule.");
		const collectionLocale = JSON.stringify([route.collection, route.locale]);
		if (fields.has(collectionLocale) && fields.get(collectionLocale) !== route.slugField) throw new Error("publicUrls has conflicting slug fields for one collection and locale.");
		fields.set(collectionLocale, route.slugField);
		identities.add(identity);
		return Object.freeze({
			collection: route.collection,
			locale: route.locale,
			...(route.slug === undefined ? {} : { slug: route.slug as string }),
			...(route.slugField === undefined ? {} : { slugField: route.slugField as string }),
			path: route.path,
		});
	});
	return Object.freeze({ routes: Object.freeze(routes) });
}

/** Each invocation gets its own binding, even when two native engines share a host context. */
export function scopeSeoPublicUrlsContext(ctx: object, options: SeoPublicUrlOptions, origin: string | null): object {
	const scoped = Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx)) as object;
	hosts.set(scoped, { options, origin });
	return scoped;
}

export function hasSeoPublicUrlCollection(ctx: object, collection: string): boolean {
	return hosts.get(ctx)?.options.routes.some((route) => route.collection === collection) ?? false;
}

export function hasSeoPublicUrls(ctx: object): boolean {
	return hosts.has(ctx);
}

/** Restricted read/replay facades retain the same immutable route facts. */
export function copySeoPublicUrls(source: object, target: object): void {
	const host = hosts.get(source);
	if (host) hosts.set(target, host);
}

/** undefined delegates to the host; an invalid configured result suppresses URL selection. */
export function configuredSeoPublicUrl(ctx: PluginContext, collection: string, item: any): string | undefined {
	const host = hosts.get(ctx as object);
	if (!host) return undefined;
	const locale = item?.locale ?? item?.data?.locale ?? ctx.site?.locale;
	const rules = host.options.routes.filter((route) => route.collection === collection && route.locale === locale);
	if (rules.length === 0 && hasSeoPublicUrlCollection(ctx, collection)) return "";
	const slugFor = (route: SeoPublicUrlRoute) => {
		const selected = route.slugField ? item?.data?.[route.slugField] : undefined;
		return typeof selected === "string" && selected.trim() ? selected.trim() : item?.slug ?? item?.data?.slug;
	};
	const rule = rules.find((route) => route.slug !== undefined && route.slug === slugFor(route)) ??
		rules.find((route) => route.slug === undefined);
	if (!rule) return hasSeoPublicUrlCollection(ctx, collection) ? "" : undefined;
	const slug = slugFor(rule);
	if (!text(slug) || !text(item?.id) || !host.origin) return "";
	try {
		const origin = new URL(host.origin);
		if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== host.origin || origin.username || origin.password) return "";
		const path = rule.path.replace("{slug}", encodeURIComponent(slug));
		const url = new URL(path, origin);
		return url.origin === origin.origin && url.pathname === path && url.href.length <= 2048 && !url.search && !url.hash && !url.username && !url.password ? url.href : "";
	} catch { return ""; }
}
