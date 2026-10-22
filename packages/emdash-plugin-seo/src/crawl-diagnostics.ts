export const SEO_CRAWL_DIAGNOSTICS_VERSION = 2 as const;

export const SEO_CRAWL_LIMITS = Object.freeze({
	maxEntries: 1_000,
	maxLinks: 20_000,
	maxFindingsPerType: 250,
	maxDocumentNodes: 5_000,
	maxTotalDocumentNodes: 100_000,
});

export type SeoCrawlCoverage = "complete" | "partial";
export type SeoOrphanConfidence = "high" | "review";

export interface SeoCrawlLinkInput {
	href: string;
	text?: string;
}

export interface SeoCrawlEntryInput {
	ref: string;
	collection: string;
	entryId: string;
	title: string;
	url: string;
	indexable: boolean;
	bodySource?: string | null;
	structured: boolean;
	links: readonly SeoCrawlLinkInput[];
}

export interface SeoUnresolvedInternalLink {
	id: string;
	sourceRef: string;
	sourceCollection: string;
	sourceEntryId: string;
	sourceTitle: string;
	sourcePath: string;
	href: string;
	targetPath: string;
	anchorText: string;
}

export interface SeoPossibleOrphanEntry {
	ref: string;
	collection: string;
	entryId: string;
	title: string;
	path: string;
	incomingLinks: number;
	confidence: SeoOrphanConfidence;
}

export interface SeoCrawlDiagnosticsResult {
	diagnosticsVersion: typeof SEO_CRAWL_DIAGNOSTICS_VERSION;
	coverage: SeoCrawlCoverage;
	summary: {
		scannedEntries: number;
		indexableEntries: number;
		knownRoutes: number;
		scannedLinks: number;
		matchedInternalLinks: number;
		unresolvedInternalLinks: number;
		possibleOrphans: number;
		structuredSources: number;
		partialSources: number;
	};
	limits: {
		maxEntries: number;
		maxLinks: number;
		maxFindingsPerType: number;
		maxDocumentNodes: number;
		maxTotalDocumentNodes: number;
		inspectedRecords: number;
		scannedDocumentNodes: number;
		reachedEntryLimit: boolean;
		reachedLinkLimit: boolean;
		reachedDocumentLimit: boolean;
		unresolvedLinksOmitted: number;
		orphanEntriesOmitted: number;
	};
	unresolvedLinks: SeoUnresolvedInternalLink[];
	orphanEntries: SeoPossibleOrphanEntry[];
}

const NON_PAGE_EXTENSION = /\.(?:avif|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|pdf|png|svg|txt|webm|webp|woff2?|xml)$/i;
const IGNORED_PREFIXES = ["/_emdash", "/api", "/.well-known"];

function stableId(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizePathname(pathname: string): string | null {
	let path = pathname.replace(/\/{2,}/g, "/");
	if (!path.startsWith("/")) path = `/${path}`;
	if (path.length > 1) path = path.replace(/\/+$/, "");
	if (!path || path.length > 1_024) return null;
	return path;
}

export function normalizeCrawlRoute(value: unknown, baseUrl?: string): string | null {
	if (typeof value !== "string") return null;
	const input = value.trim();
	if (!input || input.startsWith("#") || /^(?:mailto|tel|sms|javascript|data):/i.test(input)) return null;

	try {
		const base = baseUrl ? new URL(baseUrl, "https://crawl.invalid/") : null;
		const target = new URL(input.startsWith("//") ? `https:${input}` : input, base ?? "https://crawl.invalid/");
		if (target.protocol !== "http:" && target.protocol !== "https:") return null;
		if (base) {
			if (target.origin !== base.origin) return null;
		}
		return normalizePathname(target.pathname);
	} catch {
		if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return null;
		const [pathname] = input.split(/[?#]/, 1);
		return normalizePathname(pathname);
	}
}

export function isCrawlDocumentRoute(path: string): boolean {
	const normalized = normalizeCrawlRoute(path);
	if (!normalized || NON_PAGE_EXTENSION.test(normalized)) return false;
	return !IGNORED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export interface SeoCrawlDocumentLinks {
	structured: boolean;
	links: SeoCrawlLinkInput[];
	scannedNodes: number;
	limited: boolean;
}

/** Read only link-bearing body nodes; prose analysis is unnecessary for a link graph. */
export function extractSeoCrawlLinks(
	document: unknown,
	options: { maxNodes?: number; maxLinks?: number } = {},
): SeoCrawlDocumentLinks {
	const budget = (value: number | undefined, fallback: number) => Number.isFinite(value) ? Math.max(0, Math.min(fallback, Math.trunc(value!))) : fallback;
	const maxNodes = budget(options.maxNodes, SEO_CRAWL_LIMITS.maxDocumentNodes);
	const maxLinks = budget(options.maxLinks, SEO_CRAWL_LIMITS.maxLinks);
	const links: SeoCrawlLinkInput[] = [];
	type Link = SeoCrawlLinkInput;
	type Task = { value: unknown; portable?: Map<string, Link>; direct?: Link; index?: number };
	const stack: Task[] = [{ value: document }];
	let scannedNodes = 0;
	let limited = false;
	let structured = false;
	const spend = () => {
		if (scannedNodes >= maxNodes) { limited = true; return false; }
		scannedNodes += 1;
		return true;
	};
	const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
	const text = (value: unknown) => typeof value === "string" ? value.slice(0, 512).replace(/\s+/g, " ").trim() : "";
	const href = (value: Record<string, unknown>): string => {
		const attrs = record(value.attrs) ? value.attrs : {};
		for (const candidate of [value.href, attrs.href]) {
			if (typeof candidate !== "string") continue;
			if (candidate.length > 2_048) { limited = true; continue; }
			if (candidate.trim()) return candidate.trim();
		}
		return "";
	};
	const add = (url: string, anchor = ""): Link | undefined => {
		if (!url) return undefined;
		structured = true;
		if (links.length >= maxLinks) { limited = true; return undefined; }
		const link = { href: url, text: anchor };
		links.push(link);
		return link;
	};
	const append = (link: Link | undefined, value: unknown) => {
		if (!link) return;
		link.text = `${link.text ?? ""} ${text(value)}`.slice(0, 512).trim();
	};
	while (stack.length) {
		const task = stack.pop()!;
		const value = task.value;
		if (Array.isArray(value)) {
			const index = task.index ?? 0;
			if (index >= value.length) continue;
			if (!spend()) break;
			stack.push({ ...task, index: index + 1 }, { value: value[index], portable: task.portable, direct: task.direct });
			continue;
		}
		if (!spend()) break;
		if (!record(value)) continue;
		const type = value.type ?? value._type;
		if ((value._type === "block" && Array.isArray(value.children)) || type === "paragraph" || type === "heading" || type === "image") structured = true;
		let portable = task.portable;
		if (value._type === "block" && Array.isArray(value.markDefs) && Array.isArray(value.children)) {
			portable = new Map();
			for (const definition of value.markDefs) {
				if (!spend()) break;
				if (!record(definition) || typeof definition._key !== "string") continue;
				const link = add(href(definition));
				if (link) portable.set(definition._key, link);
			}
		}
		let direct = task.direct;
		if (type === "link") direct = add(href(value));
		if (typeof value.text === "string") {
			append(direct, value.text);
			if (Array.isArray(value.marks)) for (const mark of value.marks) {
				if (!spend()) break;
				if (typeof mark === "string") append(portable?.get(mark), value.text);
				else if (record(mark) && (mark.type === "link" || mark._type === "link")) add(href(mark), text(value.text));
			}
		}
		if (Array.isArray(value.content)) stack.push({ value: value.content, portable, direct });
		if (Array.isArray(value.children)) stack.push({ value: value.children, portable, direct });
	}
	return { structured, links, scannedNodes, limited };
}

export function analyzeSeoCrawlGraph(
	entries: readonly SeoCrawlEntryInput[],
	additionalKnownRoutes: readonly string[] = ["/"],
	coverageLimited = false,
): SeoCrawlDiagnosticsResult {
	const reachedEntryLimit = entries.length > SEO_CRAWL_LIMITS.maxEntries;
	const normalizedEntries = entries.slice(0, SEO_CRAWL_LIMITS.maxEntries).flatMap((entry) => {
		const path = normalizeCrawlRoute(entry.url);
		return path ? [{ ...entry, path }] : [];
	});
	const knownPaths = new Set<string>();
	for (const path of additionalKnownRoutes.slice(0, SEO_CRAWL_LIMITS.maxEntries)) {
		const normalized = normalizeCrawlRoute(path);
		if (normalized) knownPaths.add(normalized);
	}
	for (const entry of normalizedEntries) knownPaths.add(entry.path);

	const incoming = new Set<string>();
	const entriesByPath = new Map(normalizedEntries.map((entry) => [entry.path, entry]));
	const unresolvedKeys = new Set<string>();
	const unresolved: SeoUnresolvedInternalLink[] = [];
	let scannedLinks = 0;
	let matchedInternalLinks = 0;
	let reachedLinkLimit = false;
	outer: for (const source of normalizedEntries) {
		for (const link of source.links) {
			if (scannedLinks >= SEO_CRAWL_LIMITS.maxLinks) { reachedLinkLimit = true; break outer; }
			scannedLinks += 1;
			const targetPath = normalizeCrawlRoute(link.href, source.url);
			if (!targetPath || !isCrawlDocumentRoute(targetPath)) continue;
			const target = entriesByPath.get(targetPath);
			if (target || knownPaths.has(targetPath)) {
				matchedInternalLinks += 1;
				if (target && target.ref !== source.ref) incoming.add(target.ref);
				continue;
			}
			const key = `${source.ref}\u0000${targetPath}`;
			if (unresolvedKeys.has(key)) continue;
			unresolvedKeys.add(key);
			if (unresolved.length >= SEO_CRAWL_LIMITS.maxFindingsPerType) continue;
			unresolved.push({
				id: `link-${stableId(key)}`,
				sourceRef: source.ref,
				sourceCollection: source.collection,
				sourceEntryId: source.entryId,
				sourceTitle: source.title.slice(0, 512),
				sourcePath: source.path,
				href: link.href.slice(0, 2_048).trim(),
				targetPath,
				anchorText: String(link.text ?? "").slice(0, 512).trim(),
			});
		}
	}
	const partialSources = normalizedEntries.filter(
		(entry) => !entry.structured || String(entry.bodySource ?? "").toLocaleLowerCase("en") === "template",
	).length;
	const orphanCandidates = normalizedEntries.filter((entry) => entry.indexable && entry.path !== "/" && !incoming.has(entry.ref));
	const unresolvedLinksOmitted = unresolvedKeys.size - unresolved.length;
	const orphanEntriesOmitted = Math.max(0, orphanCandidates.length - SEO_CRAWL_LIMITS.maxFindingsPerType);
	const coverage: SeoCrawlCoverage = partialSources === 0 && !coverageLimited && !reachedEntryLimit && !reachedLinkLimit && !unresolvedLinksOmitted && !orphanEntriesOmitted ? "complete" : "partial";
	const orphanEntries = orphanCandidates
		.slice(0, SEO_CRAWL_LIMITS.maxFindingsPerType)
		.map((entry): SeoPossibleOrphanEntry => ({
			ref: entry.ref,
			collection: entry.collection,
			entryId: entry.entryId,
			title: entry.title.slice(0, 512),
			path: entry.path,
			incomingLinks: 0,
			confidence: coverage === "complete" ? "high" : "review",
		}))
		.sort((left, right) => left.path.localeCompare(right.path, "en"));
	const unresolvedLinks = unresolved.sort(
		(left, right) => left.sourcePath.localeCompare(right.sourcePath, "en") || left.targetPath.localeCompare(right.targetPath, "en"),
	);
	return {
		diagnosticsVersion: SEO_CRAWL_DIAGNOSTICS_VERSION,
		coverage,
		summary: {
			scannedEntries: normalizedEntries.length,
			indexableEntries: normalizedEntries.filter((entry) => entry.indexable).length,
			knownRoutes: knownPaths.size,
			scannedLinks,
			matchedInternalLinks,
			unresolvedInternalLinks: unresolvedKeys.size,
			possibleOrphans: orphanCandidates.length,
			structuredSources: normalizedEntries.length - partialSources,
			partialSources,
		},
		limits: {
			...SEO_CRAWL_LIMITS,
			inspectedRecords: Math.min(entries.length, SEO_CRAWL_LIMITS.maxEntries),
			scannedDocumentNodes: 0,
			reachedEntryLimit,
			reachedLinkLimit,
			reachedDocumentLimit: false,
			unresolvedLinksOmitted,
			orphanEntriesOmitted,
		},
		unresolvedLinks,
		orphanEntries,
	};
}
