import {
	SEO_ADMIN_CONTRACT_VERSION,
	type SeoAdminOverview,
	type SeoAdminReadableSettings,
	type SeoAdminSettingsSaveResult,
	type SeoAdminUnreadableSettings,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import type { SeoAdminView } from "./content-extension-model.ts";

/**
 * Scope prefix for every workspace react-query key. Kept distinct from the
 * editor-panel scope ("shipit-seo-content-scores") so invalidating workspace
 * data never evicts editor caches and vice versa.
 */
export const SEO_WORKSPACE_QUERY_SCOPE = "shipit-seo-workspace";

export const seoWorkspaceKeys = {
	all: [SEO_WORKSPACE_QUERY_SCOPE] as const,
	overview: [SEO_WORKSPACE_QUERY_SCOPE, "overview"] as const,
	settings: [SEO_WORKSPACE_QUERY_SCOPE, "settings"] as const,
	indexingTaxonomies: [SEO_WORKSPACE_QUERY_SCOPE, "indexing-taxonomies"] as const,
	sitemap: [SEO_WORKSPACE_QUERY_SCOPE, "sitemap"] as const,
	robots: [SEO_WORKSPACE_QUERY_SCOPE, "robots"] as const,
	configuration: [SEO_WORKSPACE_QUERY_SCOPE, "configuration"] as const,
	templates: [SEO_WORKSPACE_QUERY_SCOPE, "templates"] as const,
	templateExamples: (collection: string, cursor?: string) =>
		[SEO_WORKSPACE_QUERY_SCOPE, "template-examples", collection, cursor ?? null] as const,
	/** One exact entry; outside every prefix that saving templates or scores invalidates. */
	templateExample: (collection: string, entryId: string) =>
		[SEO_WORKSPACE_QUERY_SCOPE, "template-example", collection, entryId] as const,
	contentOptions: [SEO_WORKSPACE_QUERY_SCOPE, "content-options"] as const,
	contentOptionPage: (collection: string | null, cursor?: string) =>
		[SEO_WORKSPACE_QUERY_SCOPE, "content-options", collection, cursor ?? null] as const,
	workQueue: [SEO_WORKSPACE_QUERY_SCOPE, "work-queue"] as const,
	workQueueCollection: (collection: string, cursor?: string) =>
		[SEO_WORKSPACE_QUERY_SCOPE, "work-queue", collection, cursor ?? null] as const,
	trendsAll: [SEO_WORKSPACE_QUERY_SCOPE, "trends"] as const,
	trends: (days: number, collection: string | null) =>
		[SEO_WORKSPACE_QUERY_SCOPE, "trends", days, collection] as const,
	entryPreviewAll: [SEO_WORKSPACE_QUERY_SCOPE, "entry-preview"] as const,
	entryPreview: (ref: string) =>
		[SEO_WORKSPACE_QUERY_SCOPE, "entry-preview", ref] as const,
	/** Keyed by the overview snapshot it checks; outside the overview and score prefixes, so invalidation never rechecks old rows. */
	contentHealthFreshness: (generatedAt: string, refs: readonly string[]) =>
		[SEO_WORKSPACE_QUERY_SCOPE, "content-health-freshness", generatedAt, refs] as const,
	redirectRules: [SEO_WORKSPACE_QUERY_SCOPE, "redirect-rules"] as const,
	schemaLibrary: [SEO_WORKSPACE_QUERY_SCOPE, "schema-library"] as const,
};

/** Maximum entries requested for one selected collection page. */
export const SEO_WORKSPACE_CONTENT_OPTIONS_LIMIT = 25;

export interface SeoOverviewContentSummary {
	averageValue: number | "--";
	averageDetail: string;
	needsWorkValue: number | "--";
	needsWorkDetail: string;
}

/**
 * Keeps a missing analysis sample distinct from a completed sample with no
 * findings. The overview readiness score describes site setup, not content.
 */
export function buildSeoOverviewContentSummary(
	summary: Pick<
		SeoAdminOverview["summary"],
		"sampleSize" | "averageContentScore" | "needsAttention"
	>,
	settingsState?: SeoAdminOverview["site"]["settingsState"],
): SeoOverviewContentSummary {
	// The saved-score sample is unavailable without readable site settings.
	if (settingsState === "corrupt" || settingsState === "unavailable") {
		return {
			averageValue: "--",
			averageDetail: "Scores unavailable while SEO settings cannot be read",
			needsWorkValue: "--",
			needsWorkDetail: "Unknown until the settings can be read",
		};
	}
	if (summary.sampleSize <= 0) {
		return {
			averageValue: "--",
			averageDetail: "No saved score sample",
			needsWorkValue: "--",
			needsWorkDetail: "Analyze content to measure",
		};
	}

	return {
		averageValue: summary.averageContentScore ?? "--",
		averageDetail: `${summary.sampleSize} recent saved ${summary.sampleSize === 1 ? "score" : "scores"}`,
		needsWorkValue: summary.needsAttention,
		needsWorkDetail: `${summary.needsAttention === 1 ? "Entry needs" : "Entries need"} attention in this saved sample`,
	};
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "";
}

/**
 * True when an error indicates the SEO engine and this admin package disagree
 * about the response contract: either the payload failed the strict parsers
 * ("Invalid SEO admin response: <field>") or the explicit contract-version
 * handshake failed (see assertContractVersion in contract.ts).
 */
export function isSeoContractMismatchError(error: unknown): boolean {
	const message = errorMessage(error);
	if (!message) return false;
	if (message.startsWith("Invalid SEO admin response")) return true;
	return message.includes("engine/admin mismatch") && message.includes("contract");
}

export interface SeoContractMismatchDetails {
	/** "version" = explicit handshake failure; "shape" = strict parser failure. */
	kind: "version" | "shape";
	/** Contract version this admin build expects. */
	expected: number;
	/** Version reported by the engine, when the message carries one. */
	received: string | null;
	/** Original error message for support/debugging. */
	message: string;
}

/**
 * Structured details for the dedicated contract-mismatch screen. Returns null
 * when the error is not a contract mismatch.
 */
export function describeSeoContractMismatch(
	error: unknown,
): SeoContractMismatchDetails | null {
	if (!isSeoContractMismatchError(error)) return null;
	const message = errorMessage(error);
	if (message.startsWith("Invalid SEO admin response")) {
		return {
			kind: "shape",
			expected: SEO_ADMIN_CONTRACT_VERSION,
			received: null,
			message,
		};
	}
	const received = /received\s+([^.\s]+)/.exec(message)?.[1] ?? null;
	return {
		kind: "version",
		expected: SEO_ADMIN_CONTRACT_VERSION,
		received,
		message,
	};
}

export type SeoWorkspaceNavGroupId = "overview" | "content" | "appearance" | "indexing" | "settings";

export interface SeoWorkspaceNavGroupModel {
	id: SeoWorkspaceNavGroupId;
	label: string;
	views: readonly SeoAdminView[];
}

/**
 * The only navigation model: the rail, the compact Select and the Indexing
 * tools read it. Route keys remain canonical across them and deep links.
 */
export const SEO_WORKSPACE_NAV_GROUPS: readonly SeoWorkspaceNavGroupModel[] = [
	{ id: "overview", label: "Overview", views: ["overview"] },
	{ id: "content", label: "Content", views: ["queue", "content", "trends"] },
	{ id: "appearance", label: "Search appearance", views: ["templates", "social", "schema", "library", "identity", "site"] },
	{ id: "indexing", label: "Indexing", views: ["indexing", "sitemap", "robots", "llms", "indexnow", "crawl", "monitor404"] },
	{ id: "settings", label: "Settings", views: ["modules", "verification", "migration", "portability"] },
];

export const SEO_WORKSPACE_INDEXING_VIEWS: readonly SeoAdminView[] =
	SEO_WORKSPACE_NAV_GROUPS.find((group) => group.id === "indexing")!.views;

/** Pages opened from another page's rail row; they have no row of their own. */
export const SEO_WORKSPACE_NAV_PARENT: Readonly<Partial<Record<SeoAdminView, SeoAdminView>>> = {
	library: "schema",
	site: "identity",
};

/**
 * Pages whose forms keep their own local drafts. Each stays mounted, hidden,
 * while one of its forms holds work. Settings sections, Schema, Templates and
 * Local SEO keep their drafts in owners outside the page instead.
 */
export const SEO_WORKSPACE_DRAFT_VIEWS = ["modules", "sitemap", "robots", "llms", "indexnow", "verification"] as const satisfies readonly SeoAdminView[];
export type SeoWorkspaceDraftView = (typeof SEO_WORKSPACE_DRAFT_VIEWS)[number];
export type SeoWorkspaceDraftHolds = Readonly<Partial<Record<SeoWorkspaceDraftView, readonly string[]>>>;

export function isSeoWorkspaceDraftView(view: SeoAdminView): view is SeoWorkspaceDraftView {
	return (SEO_WORKSPACE_DRAFT_VIEWS as readonly SeoAdminView[]).includes(view);
}

/** Records one form's hold; an unchanged report returns the same object so it causes no render. */
export function seoWorkspaceDraftHold(
	holds: SeoWorkspaceDraftHolds,
	view: SeoWorkspaceDraftView,
	key: string,
	held: boolean,
): SeoWorkspaceDraftHolds {
	const keys = holds[view] ?? [];
	if (keys.includes(key) === held) return holds;
	return { ...holds, [view]: held ? [...keys, key] : keys.filter((item) => item !== key) };
}

/** The open draft page, plus every other draft page that still holds work. */
export function seoWorkspaceMountedDraftViews(active: SeoAdminView, holds: SeoWorkspaceDraftHolds): SeoWorkspaceDraftView[] {
	return SEO_WORKSPACE_DRAFT_VIEWS.filter((view) => view === active || (holds[view]?.length ?? 0) > 0);
}

/** One ancestor of the workspace, nearest first, as the page-change scroll reads it. */
export interface SeoScrollAncestor<T> {
	node: T;
	/** Computed overflow-y. */
	overflowY: string;
	/** Its content is taller than its box. */
	scrollable: boolean;
	/** Top of its box, in viewport pixels. */
	top: number;
}

/**
 * The scroll that brings the workspace top into view after a page change: only the nearest
 * ancestor that scrolls (overflow-y auto or scroll), or the document when `container` is null,
 * and only while that top is above the visible area. An overflow-hidden ancestor is never
 * chosen: it has no scrollbar, so nothing could scroll it back.
 */
export function seoWorkspaceTopScroll<T>(
	workspaceTop: number,
	ancestors: readonly SeoScrollAncestor<T>[],
): { container: T | null; by: number } | null {
	const container = ancestors.find((ancestor) => ancestor.scrollable && (ancestor.overflowY === "auto" || ancestor.overflowY === "scroll"));
	const visibleTop = Math.max(container?.top ?? 0, 0);
	return workspaceTop < visibleTop ? { container: container?.node ?? null, by: workspaceTop - visibleTop } : null;
}

export type SeoWorkspaceRailRow =
	| { kind: "view"; view: SeoAdminView; current: "page" | "true" | null }
	| { kind: "group"; group: "indexing"; view: SeoAdminView; current: "page" | "true" | null };

export interface SeoWorkspaceRailGroup {
	id: SeoWorkspaceNavGroupId;
	heading: boolean;
	rows: SeoWorkspaceRailRow[];
}

/** Indexing has one row, current for every Indexing tool; the tools are listed by seoWorkspaceIndexingTools. */
export function seoWorkspaceRail(
	active: SeoAdminView,
	hiddenViews: readonly SeoAdminView[] = [],
): SeoWorkspaceRailGroup[] {
	return seoWorkspaceVisibleNavGroups(hiddenViews).map((group): SeoWorkspaceRailGroup => {
		if (group.id === "indexing") {
			const view = group.views[0];
			const current = active === view ? "page" : SEO_WORKSPACE_INDEXING_VIEWS.includes(active) ? "true" : null;
			return { id: group.id, heading: false, rows: [{ kind: "group", group: "indexing", view, current }] };
		}
		const rows: SeoWorkspaceRailRow[] = group.views
			.filter((view) => !SEO_WORKSPACE_NAV_PARENT[view])
			.map((view) => ({
				kind: "view",
				view,
				current: view === active ? "page" : SEO_WORKSPACE_NAV_PARENT[active] === view ? "true" : null,
			}));
		return { id: group.id, heading: group.id !== "overview", rows };
	}).filter((group) => group.rows.length > 0);
}

export function seoWorkspaceIndexingTools(hiddenViews: readonly SeoAdminView[] = []): SeoAdminView[] {
	return SEO_WORKSPACE_INDEXING_VIEWS.filter((view) => !hiddenViews.includes(view));
}

export function seoWorkspaceNavGroup(view: SeoAdminView): SeoWorkspaceNavGroupId {
	return SEO_WORKSPACE_NAV_GROUPS.find((group) => group.views.includes(view))!.id;
}

export function seoWorkspaceVisibleNavGroups(hiddenViews: readonly SeoAdminView[] = []): SeoWorkspaceNavGroupModel[] {
	return SEO_WORKSPACE_NAV_GROUPS.map((group) => ({
		...group,
		views: group.views.filter((view) => !hiddenViews.includes(view)),
	})).filter((group) => group.views.length > 0);
}

export type SeoWorkspaceNavMemory = Partial<Record<SeoWorkspaceNavGroupId, SeoAdminView>>;

/** A primary destination reuses an eligible page without restoring a hidden route. */
export function seoWorkspacePrimaryTarget(
	group: SeoWorkspaceNavGroupId,
	currentView: SeoAdminView,
	remembered: Readonly<SeoWorkspaceNavMemory> = {},
	hiddenViews: readonly SeoAdminView[] = [],
): SeoAdminView | null {
	const visible = seoWorkspaceVisibleNavGroups(hiddenViews).find((item) => item.id === group)?.views;
	if (!visible?.length) return null;
	if (visible.includes(currentView)) return currentView;
	const previous = remembered[group];
	return previous && visible.includes(previous) ? previous : visible[0];
}

/**
 * Migration only reviews legacy plugin records, so it is listed once the
 * overview shows legacy records or journal history, while it is open and for
 * the rest of the session after it was opened. An unknown summary lists
 * nothing extra, so the row is only ever added, never shown and then removed.
 */
export function seoWorkspaceHiddenViews(input: {
	activeView: SeoAdminView;
	summary: { legacyOverrides: number; migrationRecords?: number } | null | undefined;
	/** True once Migration has been open in this admin page session. */
	migrationOpened?: boolean;
}): SeoAdminView[] {
	if (input.activeView === "migration" || input.migrationOpened) return [];
	if (!input.summary) return ["migration"];
	return input.summary.legacyOverrides > 0 || (input.summary.migrationRecords ?? 0) > 0 ? [] : ["migration"];
}

export const SEO_WORKSPACE_VIEW_LABELS: Record<SeoAdminView, string> = {
	overview: "Overview",
	content: "Content health",
	queue: "Work queue",
	trends: "Trends",
	crawl: "Crawl diagnostics",
	monitor404: "Redirects & 404s",
	templates: "Templates",
	identity: "Local SEO",
	site: "Website",
	social: "Search & social",
	modules: "Feature controls",
	schema: "Schema",
	library: "Schema library",
	sitemap: "Sitemaps",
	robots: "Robots.txt",
	llms: "llms.txt",
	indexnow: "IndexNow",
	indexing: "Indexing rules",
	verification: "Site verification",
	migration: "Migration",
	portability: "Export & import",
};

/** Every entry point for unreadable settings opens this page. */
export const SEO_SETTINGS_UNREADABLE_VIEW: SeoAdminView = "indexing";

export type SeoSettingSearchId =
	| "defaultSocialImage" | "twitterHandle" | "siteName" | "siteUrl" | "siteNoindex" | "contentTypeNoindex" | "taxonomyArchives"
	| "sitemapContentTypes" | "excludedPaths" | "robotsText" | "llmsText" | "llmsOutput"
	| "indexNowAutomatic" | "indexNowContentTypes" | "indexNowKey" | "indexNowKeyLocation" | "indexNowBatchSize"
	| "indexNowResendInterval" | "indexNowMaxAttempts" | "indexNowManual"
	| "googleCode" | "bingCode" | "customTags"
	| "schemaModule" | "sitemapModule" | "monitorModule" | "imageAltModule" | "automaticAnalysis" | "automaticPublisher" | "pluginOverlap"
	| "titleTemplate" | "descriptionTemplate" | "socialTitleTemplate" | "socialDescriptionTemplate" | "templateVariables"
	| "schemaDefaults" | "customSchemas" | "schemaTemplates"
	| "businessIdentity" | "officialProfiles"
	| "redirectRules" | "missingPaths" | "forwardedPaths" | "renderedCrawl"
	| "exportConfiguration" | "importConfiguration";

export interface SeoSettingSearchEntry {
	id: SeoSettingSearchId;
	view: SeoAdminView;
	/** The page marks the control with data-seo-setting set to the id. */
	field: boolean;
}

/** Setting labels live in the catalogues as nav.setting.<id>. */
export const SEO_SETTINGS_SEARCH_INDEX: readonly SeoSettingSearchEntry[] = [
	{ id: "defaultSocialImage", view: "social", field: true },
	{ id: "twitterHandle", view: "social", field: true },
	{ id: "siteName", view: "site", field: true },
	{ id: "siteUrl", view: "site", field: true },
	{ id: "siteNoindex", view: "indexing", field: true },
	{ id: "contentTypeNoindex", view: "indexing", field: false },
	{ id: "taxonomyArchives", view: "indexing", field: false },
	{ id: "sitemapContentTypes", view: "sitemap", field: false },
	{ id: "excludedPaths", view: "sitemap", field: true },
	{ id: "robotsText", view: "robots", field: true },
	{ id: "llmsText", view: "llms", field: true },
	{ id: "llmsOutput", view: "llms", field: true },
	{ id: "indexNowAutomatic", view: "indexnow", field: false },
	{ id: "indexNowContentTypes", view: "indexnow", field: false },
	{ id: "indexNowKey", view: "indexnow", field: true },
	{ id: "indexNowKeyLocation", view: "indexnow", field: true },
	{ id: "indexNowBatchSize", view: "indexnow", field: true },
	{ id: "indexNowResendInterval", view: "indexnow", field: true },
	{ id: "indexNowMaxAttempts", view: "indexnow", field: true },
	{ id: "indexNowManual", view: "indexnow", field: false },
	{ id: "googleCode", view: "verification", field: true },
	{ id: "bingCode", view: "verification", field: true },
	{ id: "customTags", view: "verification", field: false },
	{ id: "schemaModule", view: "modules", field: true },
	{ id: "sitemapModule", view: "modules", field: true },
	{ id: "monitorModule", view: "modules", field: true },
	{ id: "imageAltModule", view: "modules", field: true },
	{ id: "automaticAnalysis", view: "modules", field: false },
	{ id: "automaticPublisher", view: "modules", field: false },
	{ id: "pluginOverlap", view: "modules", field: false },
	{ id: "titleTemplate", view: "templates", field: true },
	{ id: "descriptionTemplate", view: "templates", field: true },
	{ id: "socialTitleTemplate", view: "templates", field: true },
	{ id: "socialDescriptionTemplate", view: "templates", field: true },
	{ id: "templateVariables", view: "templates", field: false },
	{ id: "schemaDefaults", view: "schema", field: false },
	{ id: "customSchemas", view: "schema", field: false },
	{ id: "schemaTemplates", view: "library", field: false },
	{ id: "businessIdentity", view: "identity", field: false },
	{ id: "officialProfiles", view: "identity", field: false },
	{ id: "redirectRules", view: "monitor404", field: false },
	{ id: "missingPaths", view: "monitor404", field: false },
	{ id: "forwardedPaths", view: "monitor404", field: false },
	{ id: "renderedCrawl", view: "crawl", field: false },
	{ id: "exportConfiguration", view: "portability", field: false },
	{ id: "importConfiguration", view: "portability", field: false },
];

/** Module switches carry these setting ids; a key without one has no search entry. */
export const SEO_MODULE_SETTING_IDS: Readonly<Partial<Record<string, SeoSettingSearchId>>> = {
	schema: "schemaModule",
	sitemap: "sitemapModule",
	monitor404: "monitorModule",
	imageSeo: "imageAltModule",
};

/** Page names match before setting names; a setting on a hidden page is never offered. */
export function seoWorkspaceSearch(
	query: string,
	input: {
		locale: string;
		views: readonly SeoAdminView[];
		viewLabel: (view: SeoAdminView) => string;
		settingLabel: (id: SeoSettingSearchId) => string;
	},
): { views: SeoAdminView[]; settings: SeoSettingSearchEntry[] } {
	const needle = query.trim().toLocaleLowerCase(input.locale);
	if (!needle) return { views: [], settings: [] };
	const matches = (text: string) => text.toLocaleLowerCase(input.locale).includes(needle);
	return {
		views: input.views.filter((view) => matches(input.viewLabel(view))),
		settings: SEO_SETTINGS_SEARCH_INDEX.filter((entry) => input.views.includes(entry.view) && matches(input.settingLabel(entry.id))),
	};
}

export type SeoSettingsSection = "identity" | "social" | "indexing";

export const SEO_SETTINGS_SECTION_FIELDS = {
	identity: [
		"siteName",
		"siteUrl",
		"publisherType",
		"organizationName",
		"organizationLogo",
		"personName",
		"socialProfiles",
		"personProfiles",
	],
	social: ["defaultSocialImage", "twitterHandle"],
	indexing: ["noindex", "taxonomyArchiveNoindex"],
} as const satisfies Record<SeoSettingsSection, readonly string[]>;

/** Status line for a readable settings snapshot with no unsaved edits. */
export function seoSettingsSourceLabel(
	settings: Pick<SeoAdminReadableSettings, "state" | "updatedAt" | "legacyPresent">,
	formatDate: (iso: string) => string,
): string {
	switch (settings.state) {
		case "saved":
			return settings.updatedAt ? `Saved ${formatDate(settings.updatedAt)}` : "Saved";
		case "historical-seed":
			return "Using an earlier version's install defaults with site-wide noindex on. Saving records your choice.";
		case "legacy":
			return "Using legacy settings, including their noindex choice";
		case "absent":
			return settings.legacyPresent
				? "Using legacy and site values. No indexing preference is saved, so this plugin adds no site-wide noindex."
				: "No saved settings. This plugin adds no site-wide noindex.";
	}
}

/** Shown instead of the form: nothing is presented as a saved or default value. */
export function seoSettingsUnreadableNotice(
	settings: Pick<SeoAdminUnreadableSettings, "state" | "revision">,
): { title: string; description: string } {
	if (settings.state === "unavailable") {
		return {
			title: "SEO settings could not be read",
			description: "Saving, restoring and content scoring changes are off until the settings can be read. Public pages get no SEO metadata from this plugin meanwhile. Reload to try again.",
		};
	}
	return {
		title: "Stored SEO settings are invalid",
		description: `${settings.revision === null ? "A legacy SEO settings key" : "The stored SEO settings record"} has an invalid value. This plugin adds no metadata to public pages, and saving, restoring and content scoring changes are off. Restore the record from a backup or follow the recovery steps in the plugin guide under "Site-wide indexing".`,
	};
}

export function seoSettingsRestoredMessage(result: Extract<SeoAdminSettingsSaveResult, { success: true }>): string {
	return `Inherited values restored and saved. Site-wide noindex stays ${result.settings.values.noindex ? "on" : "off"}.`;
}
