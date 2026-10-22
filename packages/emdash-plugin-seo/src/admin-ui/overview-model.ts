import type {
	SeoAdminContentScore,
	SeoAdminOverview,
	SeoAdminSettings,
	SeoAdminSettingsState,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { SEO_SCORE_VERSION, seoScoreDisplay } from "@shipitseo/emdash-plugin-seo/admin-contract";
import { SEO_EARLIER_ANALYZER_LABEL } from "../check-presentation.ts";
import { analysisPresentation, scoreBadgeVariant, type SeoAdminView } from "./content-extension-model.ts";
import { SEO_SETTINGS_UNREADABLE_VIEW, buildSeoOverviewContentSummary, type SeoOverviewContentSummary } from "./workspace-model.ts";

export interface SeoOverviewNextStep {
	kind: "settings-unreadable" | "noindex" | "missing-url" | "no-sample" | "saved-results";
	tone: "error" | "warning" | "neutral";
	title: string;
	description: string;
	actionLabel: string;
	view: SeoAdminView;
}

export interface SeoOverviewModel {
	nextStep: SeoOverviewNextStep;
	contentSummary: SeoOverviewContentSummary;
	sampleState: "unavailable" | "empty" | "available";
	sampleSize: number | null;
	settingsState: SeoAdminSettingsState;
	indexable: boolean | null;
	effectiveSiteUrl: string | null;
	siteUrlKnown: boolean;
	/** Compatible with known settings, not proof of current public output or score freshness. */
	setupSnapshotCurrent: boolean;
}

function unreadable(state: SeoAdminSettingsState): boolean {
	return state === "corrupt" || state === "unavailable";
}

/** Unknown owners stay unlinked rather than guessing a Content health destination. */
export function priorityViewForArea(area: string, check?: string): SeoAdminView | null {
	if (check === "Site URL") return "site";
	if (check === "SameAs profiles") return "identity";
	switch (area) {
		case "Site identity": return "identity";
		case "Search & social": return "social";
		case "Schema": return "schema";
		case "Templates": return "templates";
		case "Modules": return "modules";
		default: return null;
	}
}

export function buildSeoOverviewModel(data: SeoAdminOverview, settings?: SeoAdminSettings): SeoOverviewModel {
	const settingsState = settings?.state ?? data.site.settingsState;
	const settingsUnreadable = settings ? settings.values === null : unreadable(settingsState) || data.site.indexable === null;
	// A cached settings result has the same precedence as the workspace notices.
	const indexable = settingsUnreadable ? null : settings?.values ? !settings.values.noindex : data.site.indexable;
	const siteUrlKnown = settingsUnreadable ? false : !settings || Boolean(settings.values?.siteUrl.trim()) || settings.hostSiteUrl !== undefined;
	const effectiveSiteUrl = settingsUnreadable ? null : settings?.values
		? settings.values.siteUrl.trim() || settings.hostSiteUrl?.trim() || null
		: data.site.url?.trim() || null;
	const oldSampleUnavailable = unreadable(data.site.settingsState) || data.site.indexable === null;
	const sampleUnavailable = settingsUnreadable || oldSampleUnavailable;
	const sampleState = sampleUnavailable ? "unavailable" : data.summary.sampleSize > 0 ? "available" : "empty";
	let contentSummary = buildSeoOverviewContentSummary(data.summary,
		sampleUnavailable ? unreadable(settingsState) ? settingsState : "unavailable" : data.site.settingsState);
	if (!settingsUnreadable && oldSampleUnavailable) {
		contentSummary = {
			...contentSummary,
			averageDetail: "Saved results need reloading",
			needsWorkDetail: "Open Content health to review saved results",
		};
	}
	const settingsTime = settings?.values && settings.updatedAt ? Date.parse(settings.updatedAt) : null;
	const generatedTime = Date.parse(data.generatedAt);
	const setupSnapshotCurrent = !settingsUnreadable && !unreadable(data.site.settingsState) &&
		data.site.settingsState === settingsState && data.site.indexable === indexable && siteUrlKnown &&
		(data.site.url?.trim() || null) === effectiveSiteUrl &&
		(settingsTime === null || Number.isFinite(settingsTime) && Number.isFinite(generatedTime) && settingsTime <= generatedTime);

	let nextStep: SeoOverviewNextStep;
	if (settingsUnreadable) {
		nextStep = {
			kind: "settings-unreadable", tone: "error", title: "SEO settings need attention",
			description: "This plugin adds no metadata to public pages while its settings cannot be read.",
			actionLabel: "Review settings", view: SEO_SETTINGS_UNREADABLE_VIEW,
		};
	} else if (indexable === false) {
		nextStep = {
			kind: "noindex", tone: "warning", title: "Search visibility is restricted",
			description: "This plugin adds noindex, nofollow to supported pages. Keep this preference if intentional.",
			actionLabel: "Review visibility", view: "indexing",
		};
	} else if (siteUrlKnown && !effectiveSiteUrl) {
		nextStep = {
			kind: "missing-url", tone: "neutral", title: "Set your site address",
			description: "Add the production URL used for canonical links and structured data.",
			actionLabel: "Set site address", view: "site",
		};
	} else if (sampleState === "empty") {
		nextStep = {
			kind: "no-sample", tone: "neutral", title: "Start with one page",
			description: "Choose content and review the analysis options before running a check.",
			actionLabel: "Choose content", view: "content",
		};
	} else {
		nextStep = {
			kind: "saved-results", tone: "neutral", title: "Review your saved results",
			description: sampleState === "unavailable"
				? "Saved results are unavailable in this overview. Open Content health to review them."
				: `${data.summary.sampleSize} recent saved ${data.summary.sampleSize === 1 ? "result" : "results"}. Open an entry to check its latest analysis.`,
			actionLabel: "Review saved results", view: "content",
		};
	}
	return {
		nextStep, contentSummary, sampleState, sampleSize: sampleUnavailable ? null : data.summary.sampleSize,
		settingsState, indexable, effectiveSiteUrl, siteUrlKnown, setupSnapshotCurrent,
	};
}

/** Rows checked against current content each time Content health opens. */
export const CONTENT_HEALTH_FRESHNESS_CHECKS = 10;

/** The first rows of the list as given, plus the focused row when it is further down. */
export function contentHealthFreshnessRefs(rows: readonly Pick<SeoAdminOverview["content"][number], "ref">[], focusedRef?: string | null): string[] {
	const refs = rows.slice(0, CONTENT_HEALTH_FRESHNESS_CHECKS).map((row) => row.ref);
	return focusedRef && !refs.includes(focusedRef) ? [...refs, focusedRef] : refs;
}

export interface ContentHealthScoreCell {
	badgeText: string;
	variant: ReturnType<typeof scoreBadgeVariant>;
	label: string;
	qualifier: string | null;
	/** Verified against current content by this check, so its band may be shown. */
	current: boolean;
	/** Screen-reader text before a saved number that this check did not verify. */
	accessiblePrefix: "Saved score" | "Last known score" | null;
}

const STALE_CELL_PRESENTATION = { label: "Analysis needs refreshing", qualifier: "Saved inputs or analysis version no longer match", tone: "neutral" } as const;

/**
 * A check describes a row only when it is the same stored result the overview
 * listed and reports its freshness; any other check is ignored. The number is
 * always the saved one, and a current result that shows no number keeps the dash.
 */
export function contentHealthScoreCell(row: SeoAdminOverview["content"][number], checked?: SeoAdminContentScore): ContentHealthScoreCell {
	const same = checked !== undefined && checked.ref === row.ref && checked.score === row.score &&
		checked.updatedAt === row.updatedAt && checked.scoreVersion === SEO_SCORE_VERSION;
	if (same && checked.freshness === "current") {
		const presentation = analysisPresentation(checked);
		return {
			badgeText: seoScoreDisplay(checked).score === null ? "-" : String(row.score), variant: scoreBadgeVariant(presentation),
			label: presentation.label, qualifier: presentation.qualifier, current: true, accessiblePrefix: null,
		};
	}
	if (same && checked.freshness === "stale") return {
		badgeText: String(row.score), variant: scoreBadgeVariant(STALE_CELL_PRESENTATION), label: STALE_CELL_PRESENTATION.label,
		qualifier: STALE_CELL_PRESENTATION.qualifier, current: false, accessiblePrefix: "Last known score",
	};
	const presentation = row.presentation;
	const variant = scoreBadgeVariant(presentation);
	if (!presentation) return { badgeText: "-", variant, label: "Previous analysis", qualifier: null, current: false, accessiblePrefix: null };
	if (presentation.label === SEO_EARLIER_ANALYZER_LABEL)
		return { badgeText: SEO_EARLIER_ANALYZER_LABEL, variant, label: presentation.label, qualifier: presentation.qualifier, current: false, accessiblePrefix: null };
	return { badgeText: String(row.score), variant, label: presentation.label, qualifier: presentation.qualifier, current: false, accessiblePrefix: "Saved score" };
}
