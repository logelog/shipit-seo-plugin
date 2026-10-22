export const LLMS_TXT_MAX_SECTIONS = 32 as const;
export const LLMS_TXT_MAX_LINKS_PER_SECTION = 64 as const;
export const LLMS_TXT_MAX_TOTAL_LINKS = 512 as const;
export const LLMS_TXT_MAX_TITLE_LENGTH = 200 as const;
export const LLMS_TXT_MAX_SUMMARY_LENGTH = 1_000 as const;
export const LLMS_TXT_MAX_BODY_LENGTH = 8_000 as const;
export const LLMS_TXT_MAX_SECTION_TITLE_LENGTH = 200 as const;
export const LLMS_TXT_MAX_LINK_LABEL_LENGTH = 300 as const;
export const LLMS_TXT_MAX_LINK_DESCRIPTION_LENGTH = 1_000 as const;
export const LLMS_TXT_MAX_URL_LENGTH = 2_048 as const;
export const LLMS_TXT_MAX_OUTPUT_LENGTH = 131_072 as const;

export const LLMS_TXT_LIMITS = {
	sections: LLMS_TXT_MAX_SECTIONS,
	linksPerSection: LLMS_TXT_MAX_LINKS_PER_SECTION,
	totalLinks: LLMS_TXT_MAX_TOTAL_LINKS,
	titleLength: LLMS_TXT_MAX_TITLE_LENGTH,
	summaryLength: LLMS_TXT_MAX_SUMMARY_LENGTH,
	bodyLength: LLMS_TXT_MAX_BODY_LENGTH,
	sectionTitleLength: LLMS_TXT_MAX_SECTION_TITLE_LENGTH,
	linkLabelLength: LLMS_TXT_MAX_LINK_LABEL_LENGTH,
	linkDescriptionLength: LLMS_TXT_MAX_LINK_DESCRIPTION_LENGTH,
	urlLength: LLMS_TXT_MAX_URL_LENGTH,
	outputLength: LLMS_TXT_MAX_OUTPUT_LENGTH,
} as const;

export interface LlmsTxtLink {
	readonly label: string;
	readonly url: string;
	readonly description?: string | null;
}

export interface LlmsTxtSection {
	readonly title: string;
	readonly links: readonly LlmsTxtLink[];
	readonly optional?: boolean;
}

export interface LlmsTxtDocument {
	readonly title: string;
	readonly summary?: string | null;
	readonly body?: string | null;
	readonly sections?: readonly LlmsTxtSection[];
	readonly optional?: readonly LlmsTxtLink[];
}

export interface LlmsTxtRenderOptions {
	readonly origin?: string | URL;
}

interface NormalizedLink {
	label: string;
	destination: string;
	description: string;
}

interface RenderState {
	output: string;
	sectionCount: number;
	totalLinks: number;
	seenDestinations: Set<string>;
}

const MARKDOWN_INLINE_SPECIALS = new Set(["\\", "`", "*", "_", "[", "]", "<", ">", "#", "~"]);
const RAW_FIELD_WORK_MULTIPLIER = 4;

export function renderLlmsTxt(
	document: LlmsTxtDocument,
	options: LlmsTxtRenderOptions = {},
): string {
	const source = document && typeof document === "object" ? document : ({} as Partial<LlmsTxtDocument>);
	const title = sanitizeMarkdownField(source.title, LLMS_TXT_MAX_TITLE_LENGTH) || "Untitled";
	const blocks = [`# ${title}`];
	const summary = sanitizeMarkdownField(source.summary, LLMS_TXT_MAX_SUMMARY_LENGTH);
	const body = sanitizeMarkdownField(source.body, LLMS_TXT_MAX_BODY_LENGTH);
	if (summary) blocks.push(`> ${summary}`);
	if (body) blocks.push(body);

	const state: RenderState = {
		output: blocks.join("\n\n"),
		sectionCount: 0,
		totalLinks: 0,
		seenDestinations: new Set(),
	};
	const allowedOrigin = resolveAllowedOrigin(options?.origin);
	const sections = Array.isArray(source.sections) ? source.sections : [];
	const sectionLimit = Math.min(sections.length, LLMS_TXT_MAX_SECTIONS);

	for (let index = 0; index < sectionLimit; index += 1) {
		if (
			state.sectionCount >= LLMS_TXT_MAX_SECTIONS ||
			state.totalLinks >= LLMS_TXT_MAX_TOTAL_LINKS
		) {
			break;
		}
		const section = sections[index];
		if (!section || typeof section !== "object") continue;
		const heading = sanitizeMarkdownField(section.title, LLMS_TXT_MAX_SECTION_TITLE_LENGTH);
		if (!heading || isOptionalSection(section, heading)) continue;
		appendSection(state, heading, [section.links], allowedOrigin);
	}

	if (
		state.sectionCount < LLMS_TXT_MAX_SECTIONS &&
		state.totalLinks < LLMS_TXT_MAX_TOTAL_LINKS
	) {
		const optionalSources: unknown[] = [];
		for (let index = 0; index < sectionLimit; index += 1) {
			const section = sections[index];
			if (!section || typeof section !== "object") continue;
			const heading = sanitizeMarkdownField(section.title, LLMS_TXT_MAX_SECTION_TITLE_LENGTH);
			if (isOptionalSection(section, heading)) optionalSources.push(section.links);
		}
		if (Array.isArray(source.optional)) optionalSources.push(source.optional);
		appendSection(state, "Optional", optionalSources, allowedOrigin);
	}

	return `${state.output}\n`;
}

function appendSection(
	state: RenderState,
	heading: string,
	sources: readonly unknown[],
	allowedOrigin: string | null | undefined,
): void {
	if (
		state.sectionCount >= LLMS_TXT_MAX_SECTIONS ||
		state.totalLinks >= LLMS_TXT_MAX_TOTAL_LINKS
	) {
		return;
	}

	let sectionLinks = 0;
	for (const source of sources) {
		if (!Array.isArray(source)) continue;
		const sourceLimit = Math.min(source.length, LLMS_TXT_MAX_LINKS_PER_SECTION);
		for (let index = 0; index < sourceLimit; index += 1) {
			if (
				sectionLinks >= LLMS_TXT_MAX_LINKS_PER_SECTION ||
				state.totalLinks >= LLMS_TXT_MAX_TOTAL_LINKS
			) {
				return;
			}
			const link = normalizeLink(source[index], allowedOrigin);
			if (!link || state.seenDestinations.has(link.destination)) continue;
			const description = link.description ? `: ${link.description}` : "";
			const line = `- [${link.label}](${link.destination})${description}`;
			const addition =
				sectionLinks === 0 ? `\n\n## ${heading}\n\n${line}` : `\n${line}`;
			if (state.output.length + addition.length + 1 > LLMS_TXT_MAX_OUTPUT_LENGTH) {
				continue;
			}

			state.output += addition;
			state.seenDestinations.add(link.destination);
			state.totalLinks += 1;
			sectionLinks += 1;
			if (sectionLinks === 1) state.sectionCount += 1;
		}
	}
}

function normalizeLink(
	value: unknown,
	allowedOrigin: string | null | undefined,
): NormalizedLink | null {
	if (!value || typeof value !== "object" || allowedOrigin === null) return null;
	const candidate = value as Partial<LlmsTxtLink>;
	const label = sanitizeMarkdownLinkLabel(candidate.label);
	if (!label || typeof candidate.url !== "string") return null;

	if (candidate.url.length > LLMS_TXT_MAX_URL_LENGTH) return null;
	const rawUrl = candidate.url.trim();
	if (
		!rawUrl ||
		rawUrl.length > LLMS_TXT_MAX_URL_LENGTH ||
		/[\u0000-\u001f\u007f-\u009f]/u.test(rawUrl)
	) {
		return null;
	}

	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username || url.password) return null;
	if (allowedOrigin !== undefined && url.origin !== allowedOrigin) return null;

	const destination = markdownSafeDestination(url.href);
	if (!destination || destination.length > LLMS_TXT_MAX_URL_LENGTH) return null;
	return {
		label,
		destination,
		description: sanitizeMarkdownField(
			candidate.description,
			LLMS_TXT_MAX_LINK_DESCRIPTION_LENGTH,
		),
	};
}

function resolveAllowedOrigin(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" && !(value instanceof URL)) return null;
	try {
		const url = new URL(value.toString());
		return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
	} catch {
		return null;
	}
}

function isOptionalSection(section: LlmsTxtSection, heading: string): boolean {
	return section.optional === true || heading.toLowerCase() === "optional";
}

function markdownSafeDestination(value: string): string {
	return value.replace(/[\\()\"]/g, (character) =>
		`%${character.codePointAt(0)?.toString(16).toUpperCase().padStart(2, "0")}`,
	);
}

function sanitizeMarkdownField(value: unknown, maxLength: number): string {
	if (typeof value !== "string") return "";
	const rawWorkLimit = maxLength * RAW_FIELD_WORK_MULTIPLIER;
	const bounded = value.length > rawWorkLimit ? value.slice(0, rawWorkLimit) : value;
	const collapsed = bounded
		.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	let result = "";
	for (const character of collapsed) {
		const rendered = MARKDOWN_INLINE_SPECIALS.has(character) ? `\\${character}` : character;
		if (result.length + rendered.length > maxLength) break;
		result += rendered;
	}
	return result;
}

function sanitizeMarkdownLinkLabel(value: unknown): string {
	return sanitizeMarkdownField(value, LLMS_TXT_MAX_LINK_LABEL_LENGTH)
		.replace(/\\[\[\]]/gu, "");
}
