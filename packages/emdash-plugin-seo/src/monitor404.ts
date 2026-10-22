export const SEO_404_MONITOR_LEGACY_STORAGE_VERSION = 1 as const;
export const SEO_404_MONITOR_STORAGE_VERSION = 2 as const;
export const SEO_404_MONITOR_MAX_PATH_LENGTH = 1_024;
export const SEO_404_MONITOR_MAX_RECORDS = 500;
export const SEO_404_SUGGESTION_INPUT_BUDGET = 3_200;
export const SEO_404_SUGGESTION_CANDIDATE_BUDGET = 12;
export const SEO_404_SUGGESTION_EDIT_LENGTH_BUDGET = 128;
const SEO_404_SUGGESTION_TOKEN_BUDGET = 32;
const SEO_404_SUGGESTION_TOKEN_LENGTH_BUDGET = 64;

export type SeoNotFoundStatus = "open" | "ignored" | "resolved";

export interface SeoNotFoundRecord {
	storageVersion:
		| typeof SEO_404_MONITOR_LEGACY_STORAGE_VERSION
		| typeof SEO_404_MONITOR_STORAGE_VERSION;
	id: string;
	path: string;
	hits: number;
	firstSeenAt: string;
	lastSeenAt: string;
	status: SeoNotFoundStatus;
	redirectTarget: string | null;
	legacyMove?: {
		sourceId: string;
		sourceFingerprint: string;
	};
}

export interface SeoRedirectCandidate {
	path: string;
	title: string;
	collection: string | null;
}

export interface SeoRedirectSuggestion extends SeoRedirectCandidate {
	score: number;
}

interface PreparedRedirectPath {
	comparableLength: number;
	editComparable: string;
	tokens: ReadonlySet<string>;
	leaf: string;
	editLeaf: string;
}

interface PreparedRedirectCandidate {
	value: SeoRedirectCandidate;
	prepared: PreparedRedirectPath;
}

export interface SeoRedirectSuggestionIndex {
	readonly inspectedCandidates: number;
	readonly candidateCount: number;
	readonly candidates: readonly PreparedRedirectCandidate[];
}

export interface SeoRedirectSuggestionRun {
	suggestions: SeoRedirectSuggestion[];
	stats: {
		scoredCandidates: number;
		levenshteinEvaluations: number;
	};
}

const IGNORED_PREFIXES = ["/_emdash", "/api", "/.well-known"];
const ASSET_EXTENSION = /\.(?:avif|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp4|ogg|pdf|png|svg|txt|webm|webp|woff2?|xml)$/i;

export function normalizeNotFoundPath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const input = value.trim();
	if (!input || input.length > SEO_404_MONITOR_MAX_PATH_LENGTH) return null;

	let pathname: string;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
		try {
			pathname = new URL(input).pathname;
		} catch {
			return null;
		}
	} else {
		[pathname] = input.split(/[?#]/, 1);
	}

	pathname = pathname.replace(/\/{2,}/g, "/");
	if (!pathname.startsWith("/")) pathname = `/${pathname}`;
	if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
	if (!pathname || pathname.length > SEO_404_MONITOR_MAX_PATH_LENGTH) return null;
	return pathname;
}

export function shouldTrackNotFoundPath(path: string): boolean {
	const normalized = normalizeNotFoundPath(path);
	if (!normalized || normalized === "/404") return false;
	if (IGNORED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) return false;
	return !ASSET_EXTENSION.test(normalized);
}

export function legacyNotFoundRecordId(path: string): string {
	const normalized = normalizeNotFoundPath(path) ?? "/";
	let hash = 0x811c9dc5;
	for (let index = 0; index < normalized.length; index += 1) {
		hash ^= normalized.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `404-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function notFoundRecordId(path: string): Promise<string> {
	const normalized = normalizeNotFoundPath(path) ?? "/";
	const input = new TextEncoder().encode(`shipit-seo:not-found:v2\0${normalized}`);
	const digest = await crypto.subtle.digest("SHA-256", input);
	const hex = [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `404-v2-${hex}`;
}

function comparablePath(path: string): string {
	try {
		return decodeURIComponent(path).toLocaleLowerCase("en");
	} catch {
		return path.toLocaleLowerCase("en");
	}
}

function pathTokens(path: string): string[] {
	const tokens = path
		.split(/[\/_-]+/)
		.map((part) => part.trim())
		.filter(Boolean);
	const bounded =
		tokens.length <= SEO_404_SUGGESTION_TOKEN_BUDGET
			? tokens
			: [
					...tokens.slice(0, SEO_404_SUGGESTION_TOKEN_BUDGET / 2),
					...tokens.slice(-SEO_404_SUGGESTION_TOKEN_BUDGET / 2),
				];
	return bounded.map((token) => token.slice(0, SEO_404_SUGGESTION_TOKEN_LENGTH_BUDGET));
}

function boundedEditValue(value: string): string {
	if (value.length <= SEO_404_SUGGESTION_EDIT_LENGTH_BUDGET) return value;
	const headLength = Math.ceil(SEO_404_SUGGESTION_EDIT_LENGTH_BUDGET / 2);
	return `${value.slice(0, headLength)}${value.slice(
		-(SEO_404_SUGGESTION_EDIT_LENGTH_BUDGET - headLength),
	)}`;
}

function prepareRedirectPath(path: string): PreparedRedirectPath {
	const comparable = comparablePath(path);
	const tokens = pathTokens(comparable);
	const leaf = tokens.at(-1) ?? "";
	return {
		comparableLength: comparable.length,
		editComparable: boundedEditValue(comparable),
		tokens: new Set(tokens),
		leaf,
		editLeaf: boundedEditValue(leaf),
	};
}

function levenshtein(left: string, right: string): number {
	if (left === right) return 0;
	if (!left.length) return right.length;
	if (!right.length) return left.length;
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	const current = new Array<number>(right.length + 1);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		current[0] = leftIndex;
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
			current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
		}
		for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
	}
	return previous[right.length];
}

function tokenSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) intersection += 1;
	}
	const union = left.size + right.size - intersection;
	return union ? intersection / union : 0;
}

function commonPrefixSimilarity(left: string, right: string): number {
	const maxLength = Math.max(left.length, right.length, 1);
	const sharedLimit = Math.min(left.length, right.length);
	let shared = 0;
	while (shared < sharedLimit && left[shared] === right[shared]) shared += 1;
	return shared / maxLength;
}

function cheapSimilarity(left: PreparedRedirectPath, right: PreparedRedirectPath): number {
	const lengthSimilarity =
		1 - Math.abs(left.comparableLength - right.comparableLength) /
			Math.max(left.comparableLength, right.comparableLength, 1);
	return Math.max(
		tokenSimilarity(left.tokens, right.tokens) * 0.9,
		commonPrefixSimilarity(left.editComparable, right.editComparable) * 0.75 +
			lengthSimilarity * 0.25,
		commonPrefixSimilarity(left.leaf, right.leaf) * 0.8 + lengthSimilarity * 0.15,
		lengthSimilarity * 0.15,
	);
}

function similarity(left: PreparedRedirectPath, right: PreparedRedirectPath): number {
	const maxLength = Math.max(left.editComparable.length, right.editComparable.length, 1);
	const editSimilarity =
		1 - levenshtein(left.editComparable, right.editComparable) / maxLength;
	const sharedTokenSimilarity = tokenSimilarity(left.tokens, right.tokens);
	const leafLength = Math.max(left.editLeaf.length, right.editLeaf.length, 1);
	const leafSimilarity = 1 - levenshtein(left.editLeaf, right.editLeaf) / leafLength;
	return Math.max(editSimilarity, sharedTokenSimilarity * 0.9, leafSimilarity * 0.85);
}

export function prepareRedirectSuggestionIndex(
	candidates: readonly SeoRedirectCandidate[],
): SeoRedirectSuggestionIndex {
	const unique = new Map<string, PreparedRedirectCandidate>();
	let inspected = 0;
	for (const candidate of candidates) {
		if (inspected >= SEO_404_SUGGESTION_INPUT_BUDGET) break;
		inspected += 1;
		const candidatePath = normalizeNotFoundPath(candidate.path);
		if (!candidatePath || unique.has(candidatePath)) continue;
		unique.set(candidatePath, {
			value: { ...candidate, path: candidatePath },
			prepared: prepareRedirectPath(candidatePath),
		});
	}
	const prepared = [...unique.values()];
	return {
		inspectedCandidates: inspected,
		candidateCount: prepared.length,
		candidates: prepared,
	};
}

export function suggestRedirectsFromIndex(
	path: string,
	index: SeoRedirectSuggestionIndex,
	limit = 3,
): SeoRedirectSuggestionRun {
	const source = normalizeNotFoundPath(path);
	const boundedLimit = Number.isFinite(limit)
		? Math.max(0, Math.min(Math.floor(limit), 10))
		: 0;
	if (!source || !boundedLimit) {
		return { suggestions: [], stats: { scoredCandidates: 0, levenshteinEvaluations: 0 } };
	}
	const preparedSource = prepareRedirectPath(source);
	const shortlist = index.candidates
		.slice(0, SEO_404_SUGGESTION_INPUT_BUDGET)
		.filter((candidate) => candidate.value.path !== source)
		.map((candidate) => ({
			candidate,
			cheapScore: cheapSimilarity(preparedSource, candidate.prepared),
		}))
		.sort(
			(left, right) =>
				right.cheapScore - left.cheapScore ||
				left.candidate.value.path.localeCompare(right.candidate.value.path, "en"),
		)
		.slice(0, SEO_404_SUGGESTION_CANDIDATE_BUDGET);
	const suggestions = shortlist
		.map(({ candidate }) => ({
			...candidate.value,
			score: Number(similarity(preparedSource, candidate.prepared).toFixed(3)),
		}))
		.filter((candidate) => candidate.score >= 0.42)
		.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path, "en"))
		.slice(0, boundedLimit);
	return {
		suggestions,
		stats: {
			scoredCandidates: shortlist.length,
			levenshteinEvaluations: shortlist.length * 2,
		},
	};
}

export function suggestRedirects(
	path: string,
	candidates: readonly SeoRedirectCandidate[],
	limit = 3,
): SeoRedirectSuggestion[] {
	return suggestRedirectsFromIndex(path, prepareRedirectSuggestionIndex(candidates), limit).suggestions;
}
