import type { MiddlewareHandler } from "astro";
import { finalizeOwnMetadataContributions } from "./plugin-coexistence-metadata.ts";

type MetadataCollector = (page: unknown) => Promise<unknown>;
const wrappedFacades = new WeakMap<object, MetadataCollector>();

/** Wrap this request's public facade; the host's cached contributions stay intact. */
export function installMetadataCoexistenceGuard(facade: unknown): boolean {
	if (!facade || typeof facade !== "object") return false;
	const descriptor = Object.getOwnPropertyDescriptor(facade, "collectPageMetadata");
	if (!descriptor || typeof descriptor.value !== "function") return false;
	if (wrappedFacades.get(facade) === descriptor.value) return true;
	if (descriptor.writable !== true) return false;
	const collect = descriptor.value as MetadataCollector;
	const pages = new WeakMap<object, Promise<unknown>>();
	const wrapped = (page: unknown): Promise<unknown> => {
		const key = page !== null && typeof page === "object" ? page : null;
		if (key) {
			const cached = pages.get(key);
			if (cached) return cached;
		}
		const result = Promise.resolve().then(async () => {
			const contributions = await collect.call(facade, page);
			if (!Array.isArray(contributions)) return contributions;
			const robots = (page as { seo?: { robots?: unknown } } | null)?.seo?.robots;
			return finalizeOwnMetadataContributions(contributions, robots);
		});
		if (key) pages.set(key, result);
		return result;
	};
	try {
		Object.defineProperty(facade, "collectPageMetadata", { ...descriptor, value: wrapped });
		wrappedFacades.set(facade, wrapped);
		return true;
	} catch {
		return false;
	}
}

export function createPluginCoexistenceMiddleware(): MiddlewareHandler {
	return (context, next) => {
		installMetadataCoexistenceGuard((context.locals as Record<string, unknown>).emdash);
		return next();
	};
}
