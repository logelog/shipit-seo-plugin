import {
	SEO_SCORE_VERSION,
	classifySeoContentCheck,
	seoScoreBandLabel,
	type SeoContentCheck,
	type SeoScoreBand,
	type SeoScoreDisplay,
} from "./analysis.ts";
import { isCollectionAnalysisProfileSelection, type CollectionAnalysisProfile } from "./collection-analysis-profile.ts";
import {
	LEGACY_BRAND_FULL_NAME,
	LEGACY_BRAND_NAME,
	LEGACY_BRAND_NOUNS,
	LEGACY_BRAND_PHRASES,
	LEGACY_BRAND_PRESENT,
	LEGACY_BRAND_VERBS,
} from "./legacy-brand-text.ts";

/**
 * The one presentation of analyzer rows for the editor, the list, the
 * overview and the sandbox panel. Every surface groups, words, orders and
 * counts rows here, so a header total is always the sum of its group pills.
 */

export type SeoCheckGroupId = "basic" | "additional" | "search-snippet" | "content-readability";

/** Group membership and table order of the checklist. */
const SEO_CHECK_GROUP_TABLE: ReadonlyArray<{ id: SeoCheckGroupId; label: string; checkIds: readonly string[] }> = [
	{ id: "basic", label: "Basic SEO", checkIds: [
		"title", "description", "url", "content-depth", "focus-keyword", "keyword-title", "keyword-description",
		"keyword-content", "keyword-url", "keyword-introduction", "keyword-heading", "secondary-keyword-coverage",
	] },
	{ id: "additional", label: "Additional", checkIds: [
		"social-image", "social-image-fallback", "image-alt-text", "internal-links", "descriptive-link-text",
		"keyword-repetition", "featured-image", "schema", "canonical-policy-review", "image-empty-alt-review",
	] },
	{ id: "search-snippet", label: "Search snippet", checkIds: ["title-display-length", "description-display-length", "keyword-title-position"] },
	{ id: "content-readability", label: "Content readability", checkIds: ["sentence-readability", "paragraph-length", "heading-structure"] },
];

/** A row ID the table does not name joins this group, after the named rows. */
const FALLBACK_GROUP_ID: SeoCheckGroupId = "additional";

export const SEO_CHECK_GROUPS: ReadonlyArray<{ id: SeoCheckGroupId; label: string }> =
	SEO_CHECK_GROUP_TABLE.map(({ id, label }) => ({ id, label }));

export type SeoCheckRowKind = "failed" | "partly-met" | "suggestion" | "not-checked" | "passed" | "earlier";

export const SEO_CHECK_ROW_WORDS: Readonly<Record<SeoCheckRowKind, string>> = {
	failed: "Failed",
	"partly-met": "Partly met",
	suggestion: "Suggestion",
	"not-checked": "Not checked",
	passed: "Passed",
	earlier: "Earlier result",
};

const ROW_KIND_ORDER: Readonly<Record<SeoCheckRowKind, number>> = {
	failed: 0,
	"partly-met": 1,
	suggestion: 2,
	"not-checked": 3,
	passed: 4,
	earlier: 5,
};

export const SEO_EARLIER_ANALYZER_TEXT = "Earlier analyzer. Analyze again.";
export const SEO_EARLIER_ANALYZER_LABEL = "Earlier analyzer";

export type SeoCheckActionTarget = "keyword" | "title" | "description" | "slug" | "image" | "advanced";

export const SEO_CHECK_ACTION_VERBS: Readonly<Record<SeoCheckActionTarget, string>> = {
	keyword: "Add keyword",
	title: "Edit title",
	description: "Edit description",
	// The slug is edited in the host's URL settings; this opens the saved URL review.
	slug: "Review URL",
	image: "Edit image",
	advanced: "Open Advanced",
};

/** Body rows have no target: the body is edited in the host editor, which has no stable focus target. */
const CHECK_ACTION_TARGETS: Readonly<Record<string, SeoCheckActionTarget>> = {
	"focus-keyword": "keyword",
	title: "title",
	"keyword-title": "title",
	"title-display-length": "title",
	"keyword-title-position": "title",
	description: "description",
	"keyword-description": "description",
	"description-display-length": "description",
	"keyword-url": "slug",
	"social-image": "image",
	"social-image-fallback": "image",
	url: "advanced",
	"canonical-policy-review": "advanced",
};

/** Where a current row's fix lives, whatever its outcome; null when the editor has no field for it. */
export function seoCheckActionTarget(check: Pick<SeoContentCheck, "id">): SeoCheckActionTarget | null {
	return Object.hasOwn(CHECK_ACTION_TARGETS, check.id) ? CHECK_ACTION_TARGETS[check.id] : null;
}

export interface SeoCheckRowAction {
	target: SeoCheckActionTarget;
	verb: string;
}

export interface SeoCheckRow {
	check: SeoContentCheck;
	kind: SeoCheckRowKind;
	word: string;
	/** Only Failed, Partly met and Suggestion rows offer an action. */
	action: SeoCheckRowAction | null;
	/** The recommendation is shown for every row that is not Passed. */
	showRecommendation: boolean;
}

export interface SeoNotApplicableItem {
	reason: string;
	checks: Array<{ id: string; label: string }>;
	text: string;
}

export interface SeoCheckCounts {
	/** Failed and Partly met rows. */
	issues: number;
	suggestions: number;
	notChecked: number;
	notApplicable: number;
	passed: number;
}

export type SeoCheckPillTone = "good" | "review" | "poor" | "info" | "neutral";

export interface SeoCheckPill {
	text: string;
	tone: SeoCheckPillTone;
}

export interface SeoCheckGroupPresentation {
	id: SeoCheckGroupId;
	label: string;
	rows: SeoCheckRow[];
	/** Rows that do not apply, collapsed by their shared reason. */
	notApplicable: SeoNotApplicableItem[];
	/** `N not applicable`, or null without such rows. */
	notApplicableLabel: string | null;
	counts: SeoCheckCounts;
	pill: SeoCheckPill;
	legacy: boolean;
}

export interface SeoCheckPresentation {
	groups: SeoCheckGroupPresentation[];
	totals: SeoCheckCounts;
	legacy: boolean;
	/** The first group with issues, else suggestions, else not-checked rows; null when nothing needs a look. */
	defaultOpenGroupId: SeoCheckGroupId | null;
}

export interface SeoCheckPresentationInput {
	checks: readonly SeoContentCheck[];
	scoreVersion?: number;
	assessmentProfile?: unknown;
}

type Placement =
	| { kind: SeoCheckRowKind }
	| { kind: "not-applicable" }
	| { kind: "hidden" };

function profileOf(input: Pick<SeoCheckPresentationInput, "assessmentProfile">): CollectionAnalysisProfile | undefined {
	return isCollectionAnalysisProfileSelection(input.assessmentProfile) ? input.assessmentProfile.profile : undefined;
}

function capitalized(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function cleanUnquoted(text: string, startsText: boolean): string {
	let source = text;
	for (const [earlier, current] of LEGACY_BRAND_PHRASES) source = source.split(earlier).join(current);
	let output = "";
	let cursor = 0;
	let capitalizeNext = false;
	const append = (value: string) => {
		output += capitalizeNext && value ? capitalized(value) : value;
		if (value) capitalizeNext = false;
	};
	for (const match of source.matchAll(LEGACY_BRAND_NAME)) {
		const at = match.index;
		append(source.slice(cursor, at));
		const end = at + match[0].length;
		const sentenceStart = (startsText && output === "") || /[.!?]\s+$/.test(output);
		const next = /^ ([A-Za-z][\w-]*)/.exec(source.slice(end))?.[1] ?? null;
		const subject = (value: string) => sentenceStart ? capitalized(value) : value;
		if (match[2]) append(subject("the plugin's"));
		else if (next !== null && LEGACY_BRAND_VERBS.has(next)) append(subject("the plugin"));
		else if (next !== null && match[1] === LEGACY_BRAND_FULL_NAME) append("SEO");
		else if (next !== null && Object.hasOwn(LEGACY_BRAND_NOUNS, next)) {
			const standIn = LEGACY_BRAND_NOUNS[next]!;
			append(subject(standIn));
			capitalizeNext = sentenceStart && !standIn;
			cursor = end + 1;
			continue;
		} else if (next === null && /^(?:[\s;:,.)!?]|$)/.test(source.slice(end))) append(subject("the plugin"));
		// Any other following word is the site's own text, such as a business name.
		else append(match[0]);
		cursor = end;
	}
	append(source.slice(cursor));
	return output;
}

/**
 * Stored analysis text as it reads today. Rows written before the current
 * wording keep their stored text; this is applied only when they are shown.
 * Quoted spans are entry content and stay exactly as stored.
 */
export function cleanStoredSeoText(text: string): string {
	if (!LEGACY_BRAND_PRESENT.test(text)) return text;
	return text.split(/("[^"]*"|\u201c[^\u201d]*\u201d)/).map((part, index) => index % 2 ? part : cleanUnquoted(part, index === 0)).join("");
}

/** A stored row with its wording cleaned; the measured value is entry content and is never changed. */
export function cleanStoredSeoCheck<Check extends SeoContentCheck>(check: Check): Check {
	const fields = [check.label, check.detail, check.recommendation, check.limitation, check.evidence?.expected, check.evidence?.source];
	if (!fields.some((value) => typeof value === "string" && LEGACY_BRAND_PRESENT.test(value))) return check;
	const clean = (value: string) => typeof value === "string" ? cleanStoredSeoText(value) : value;
	return {
		...check,
		label: clean(check.label),
		detail: clean(check.detail),
		recommendation: clean(check.recommendation),
		limitation: clean(check.limitation),
		...(check.evidence ? { evidence: { ...check.evidence, expected: clean(check.evidence.expected), source: clean(check.evidence.source) } } : {}),
	};
}

export function isEarlierAnalyzerResult(input: Pick<SeoCheckPresentationInput, "scoreVersion">): boolean {
	return input.scoreVersion !== undefined && input.scoreVersion !== SEO_SCORE_VERSION;
}

/**
 * Rule 1 of the contract. The indexing directive is never a row, and a set
 * focus keyword hides its own row. Earlier-analyzer rows are never read
 * through the current policy, which throws on their weights.
 */
function placeCheck(check: SeoContentCheck, legacy: boolean, profile: CollectionAnalysisProfile | undefined): Placement {
	if (check.id === "indexability" || check.condition !== undefined) return { kind: "hidden" };
	if (check.basis === "not-applicable") return { kind: "not-applicable" };
	if (legacy) return { kind: "earlier" };
	if (check.basis === "unavailable") return { kind: "not-checked" };
	if (check.id === "focus-keyword" && check.status === "pass") return { kind: "hidden" };
	const { role, eligible } = classifySeoContentCheck(check, profile);
	if (role === "condition") return { kind: "hidden" };
	if (eligible) return { kind: check.status === "pass" ? "passed" : check.status === "review" ? "partly-met" : "failed" };
	return { kind: check.status === "pass" ? "passed" : "suggestion" };
}

/** The row word for one check, `Not applicable` for a row that would be listed as such, or null when it is never shown. */
export function seoCheckRowWord(check: SeoContentCheck, result: Omit<SeoCheckPresentationInput, "checks">): string | null {
	const placement = placeCheck(check, isEarlierAnalyzerResult(result), profileOf(result));
	if (placement.kind === "hidden") return null;
	if (placement.kind === "not-applicable") return "Not applicable";
	return SEO_CHECK_ROW_WORDS[placement.kind];
}

function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}

function groupPill(counts: SeoCheckCounts, rows: readonly SeoCheckRow[], legacy: boolean): SeoCheckPill {
	if (legacy) return { text: SEO_EARLIER_ANALYZER_LABEL, tone: "neutral" };
	if (counts.issues > 0) return {
		text: `${plural(counts.issues, "issue")}${counts.suggestions > 0 ? `, ${plural(counts.suggestions, "suggestion")}` : ""}`,
		tone: rows.some((row) => row.kind === "failed") ? "poor" : "review",
	};
	if (counts.suggestions > 0) return { text: plural(counts.suggestions, "suggestion"), tone: "info" };
	if (counts.notChecked > 0) return { text: `${counts.notChecked} not checked`, tone: "neutral" };
	if (rows.length > 0) return { text: "All good", tone: "good" };
	return { text: "Not applicable", tone: "neutral" };
}

function collapseNotApplicable(checks: readonly SeoContentCheck[]): SeoNotApplicableItem[] {
	const byReason = new Map<string, SeoNotApplicableItem>();
	for (const check of checks) {
		const reason = check.detail.trim() || "Does not apply to this entry.";
		const item = byReason.get(reason) ?? { reason, checks: [], text: "" };
		item.checks.push({ id: check.id, label: check.label });
		byReason.set(reason, item);
	}
	return [...byReason.values()].map((item) => ({ ...item, text: `${item.checks.map((check) => check.label).join(", ")}: ${item.reason}` }));
}

const EMPTY_COUNTS: SeoCheckCounts = Object.freeze({ issues: 0, suggestions: 0, notChecked: 0, notApplicable: 0, passed: 0 });

/** The header totals: always the sums of the group counts. */
export function seoCheckTotals(groups: ReadonlyArray<Pick<SeoCheckGroupPresentation, "counts">>): SeoCheckCounts {
	return groups.reduce<SeoCheckCounts>((total, group) => ({
		issues: total.issues + group.counts.issues,
		suggestions: total.suggestions + group.counts.suggestions,
		notChecked: total.notChecked + group.counts.notChecked,
		notApplicable: total.notApplicable + group.counts.notApplicable,
		passed: total.passed + group.counts.passed,
	}), { ...EMPTY_COUNTS });
}

/** `N issues, M suggestions[, K not checked]`, or `No issues` when all three are zero. */
export function seoCheckTotalsText(totals: Pick<SeoCheckCounts, "issues" | "suggestions" | "notChecked">): string {
	if (totals.issues === 0 && totals.suggestions === 0 && totals.notChecked === 0) return "No issues";
	return `${plural(totals.issues, "issue")}, ${plural(totals.suggestions, "suggestion")}${totals.notChecked > 0 ? `, ${totals.notChecked} not checked` : ""}`;
}

export function presentSeoChecks(result: SeoCheckPresentationInput): SeoCheckPresentation {
	const legacy = isEarlierAnalyzerResult(result);
	const profile = profileOf(result);
	const order = new Map<string, { group: SeoCheckGroupId; index: number }>();
	for (const group of SEO_CHECK_GROUP_TABLE)
		group.checkIds.forEach((id, index) => order.set(id, { group: group.id, index }));
	const buckets = new Map<SeoCheckGroupId, { rows: Array<SeoCheckRow & { position: number }>; notApplicable: SeoContentCheck[] }>(
		SEO_CHECK_GROUP_TABLE.map((group) => [group.id, { rows: [], notApplicable: [] }]));
	result.checks.map(cleanStoredSeoCheck).forEach((check, inputIndex) => {
		const placement = placeCheck(check, legacy, profile);
		if (placement.kind === "hidden") return;
		const known = order.get(check.id);
		const bucket = buckets.get(known?.group ?? FALLBACK_GROUP_ID)!;
		if (placement.kind === "not-applicable") {
			bucket.notApplicable.push(check);
			return;
		}
		const kind = placement.kind;
		const target = kind === "failed" || kind === "partly-met" || kind === "suggestion" ? seoCheckActionTarget(check) : null;
		bucket.rows.push({
			check,
			kind,
			word: SEO_CHECK_ROW_WORDS[kind],
			action: target ? { target, verb: SEO_CHECK_ACTION_VERBS[target] } : null,
			showRecommendation: kind !== "passed" && kind !== "earlier",
			position: known ? known.index : SEO_CHECK_GROUP_TABLE.length * 100 + inputIndex,
		});
	});
	const groups: SeoCheckGroupPresentation[] = [];
	for (const definition of SEO_CHECK_GROUP_TABLE) {
		const bucket = buckets.get(definition.id)!;
		if (bucket.rows.length === 0 && bucket.notApplicable.length === 0) continue;
		const rows = bucket.rows
			.sort((left, right) => ROW_KIND_ORDER[left.kind] - ROW_KIND_ORDER[right.kind] ||
				(left.kind === "earlier" ? 0 : right.check.weight - left.check.weight) ||
				left.position - right.position)
			.map(({ position: _position, ...row }) => row);
		const counts: SeoCheckCounts = {
			issues: rows.filter((row) => row.kind === "failed" || row.kind === "partly-met").length,
			suggestions: rows.filter((row) => row.kind === "suggestion").length,
			notChecked: rows.filter((row) => row.kind === "not-checked").length,
			notApplicable: bucket.notApplicable.length,
			passed: rows.filter((row) => row.kind === "passed").length,
		};
		groups.push({
			id: definition.id,
			label: definition.label,
			rows,
			notApplicable: collapseNotApplicable(bucket.notApplicable),
			notApplicableLabel: bucket.notApplicable.length ? `${bucket.notApplicable.length} not applicable` : null,
			counts,
			pill: groupPill(counts, rows, legacy),
			legacy,
		});
	}
	const firstWith = (key: "issues" | "suggestions" | "notChecked") => groups.find((group) => group.counts[key] > 0)?.id;
	return {
		groups,
		totals: seoCheckTotals(groups),
		legacy,
		defaultOpenGroupId: legacy ? null : firstWith("issues") ?? firstWith("suggestions") ?? firstWith("notChecked") ?? null,
	};
}

export { seoScoreBandLabel };

/** The band words for a stored grade of the current analyzer, whose grade follows the band. */
export function seoGradeBandLabel(grade: string): string {
	const band: SeoScoreBand | null = grade === "excellent" || grade === "good" ? "good"
		: grade === "needs-work" ? "needs-improvement" : grade === "poor" ? "poor" : null;
	return band ? seoScoreBandLabel(band) : "Not scored";
}

/** Short text for toasts and tables: `77/100, Needs improvement`, or the dash label and its reason. */
export function seoScoreDisplayText(display: Pick<SeoScoreDisplay, "score" | "label" | "qualifier">): string {
	if (display.score !== null) return `${display.score}/100, ${display.label}`;
	return display.qualifier ? `${display.label}. ${display.qualifier}` : display.label;
}
