import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { SEO_ADMIN_CONTRACT_VERSION } from "@shipitseo/emdash-plugin-seo/admin-contract";

import { SEO_ADMIN_VIEWS } from "./content-extension-model.ts";
import { invalidateScoreData } from "./score-refresh.ts";
import { SEO_CATALOGUES, createSeoI18n } from "./i18n/messages.ts";
import {
	SEO_MODULE_SETTING_IDS,
	SEO_SETTINGS_SEARCH_INDEX,
	SEO_SETTINGS_UNREADABLE_VIEW,
	SEO_WORKSPACE_INDEXING_VIEWS,
	SEO_WORKSPACE_NAV_GROUPS,
	SEO_WORKSPACE_NAV_PARENT,
	SEO_WORKSPACE_VIEW_LABELS,
	SEO_SETTINGS_SECTION_FIELDS,
	buildSeoOverviewContentSummary,
	describeSeoContractMismatch,
	isSeoContractMismatchError,
	seoSettingsRestoredMessage,
	seoSettingsSourceLabel,
	seoSettingsUnreadableNotice,
	seoWorkspaceHiddenViews,
	seoWorkspaceIndexingTools,
	seoWorkspacePrimaryTarget,
	seoWorkspaceNavGroup,
	seoWorkspaceRail,
	seoWorkspaceSearch,
	seoWorkspaceTopScroll,
	seoWorkspaceVisibleNavGroups,
	seoWorkspaceKeys,
} from "./workspace-model.ts";

assert.deepEqual(
	seoWorkspaceHiddenViews({ activeView: "overview", summary: { legacyOverrides: 0, migrationRecords: 0 } }),
	["migration"],
	"Migration is not listed when there is nothing to review",
);
assert.deepEqual(seoWorkspaceHiddenViews({ activeView: "overview", summary: { legacyOverrides: 2, migrationRecords: 0 } }), []);
assert.deepEqual(seoWorkspaceHiddenViews({ activeView: "overview", summary: { legacyOverrides: 0, migrationRecords: 4 } }), []);
assert.deepEqual(
	seoWorkspaceHiddenViews({ activeView: "migration", summary: { legacyOverrides: 0, migrationRecords: 0 } }),
	[],
	"an open Migration deep link stays listed",
);
assert.deepEqual(seoWorkspaceHiddenViews({ activeView: "overview", summary: null }), ["migration"],
	"an unknown summary does not list Migration, so the row never appears and then disappears");
assert.deepEqual(seoWorkspaceHiddenViews({ activeView: "sitemap", summary: undefined }), ["migration"]);
// Across a page sequence the row only changes once: added when it is needed, then kept.
const railSequence = [
	{ activeView: "sitemap", summary: undefined, migrationOpened: false },
	{ activeView: "overview", summary: { legacyOverrides: 0, migrationRecords: 0 }, migrationOpened: false },
	{ activeView: "robots", summary: { legacyOverrides: 0, migrationRecords: 0 }, migrationOpened: false },
	{ activeView: "migration", summary: { legacyOverrides: 0, migrationRecords: 0 }, migrationOpened: true },
	{ activeView: "templates", summary: { legacyOverrides: 0, migrationRecords: 0 }, migrationOpened: true },
	{ activeView: "overview", summary: { legacyOverrides: 0, migrationRecords: 0 }, migrationOpened: true },
] as const;
const listed = railSequence.map((step) => !seoWorkspaceHiddenViews(step).includes("migration"));
assert.deepEqual(listed, [false, false, false, true, true, true], "once opened, Migration stays listed for the session");
assert.equal(listed.slice(1).filter((value, index) => value !== listed[index]).length, 1, "the row changes state at most once");

// Contract mismatch detection: strict-parser failures.
assert.equal(
	isSeoContractMismatchError(new Error("Invalid SEO admin response: summary.needsAttention")),
	true,
);
// Contract mismatch detection: version-handshake failures from assertContractVersion.
assert.equal(
	isSeoContractMismatchError(
		new Error(
			`SEO engine/admin mismatch: expected contract ${SEO_ADMIN_CONTRACT_VERSION}, received 9. ` +
				"Restart EmDash after rebuilding plugins, or install matching SEO engine and admin versions. (overview)",
		),
	),
	true,
);
// Plain failures must not be classified as contract mismatches.
assert.equal(isSeoContractMismatchError(new Error("Failed to load SEO overview")), false);
assert.equal(isSeoContractMismatchError(new Error("Request aborted")), false);
assert.equal(isSeoContractMismatchError(null), false);
assert.equal(isSeoContractMismatchError(undefined), false);
assert.equal(isSeoContractMismatchError(42), false);
// String errors are recognized too.
assert.equal(isSeoContractMismatchError("Invalid SEO admin response: items"), true);

const versionDetails = describeSeoContractMismatch(
	new Error(
		`SEO engine/admin mismatch: expected contract ${SEO_ADMIN_CONTRACT_VERSION}, received 9. (settings)`,
	),
);
assert.ok(versionDetails);
assert.equal(versionDetails.kind, "version");
assert.equal(versionDetails.expected, SEO_ADMIN_CONTRACT_VERSION);
assert.equal(versionDetails.received, "9");

const missingDetails = describeSeoContractMismatch(
	new Error(
		"SEO engine/admin mismatch: expected contract 14, received missing. (overview)",
	),
);
assert.ok(missingDetails);
assert.equal(missingDetails.received, "missing");

const shapeDetails = describeSeoContractMismatch(
	new Error("Invalid SEO admin response: readiness.score"),
);
assert.ok(shapeDetails);
assert.equal(shapeDetails.kind, "shape");
assert.equal(shapeDetails.received, null);

assert.equal(describeSeoContractMismatch(new Error("Failed to load")), null);

// Every route appears once; primary choices reuse only eligible destinations.
const navViews = SEO_WORKSPACE_NAV_GROUPS.flatMap((group) => [...group.views]);
assert.deepEqual([...navViews].sort(), [...SEO_ADMIN_VIEWS].sort());
assert.equal(new Set(navViews).size, SEO_ADMIN_VIEWS.length);
for (const view of SEO_ADMIN_VIEWS) assert.ok(SEO_WORKSPACE_VIEW_LABELS[view], "label missing for view " + view);
assert.equal(SEO_ADMIN_VIEWS.length, 21);
assert.deepEqual(SEO_WORKSPACE_NAV_GROUPS.map((group) => [group.id, group.label, [...group.views]]), [
	["overview", "Overview", ["overview"]],
	["content", "Content", ["queue", "content", "trends"]],
	["appearance", "Search appearance", ["templates", "social", "schema", "library", "identity", "site"]],
	["indexing", "Indexing", ["indexing", "sitemap", "robots", "llms", "indexnow", "crawl", "monitor404"]],
	["settings", "Settings", ["modules", "verification", "migration", "portability"]],
]);
assert.deepEqual([...SEO_WORKSPACE_INDEXING_VIEWS], ["indexing", "sitemap", "robots", "llms", "indexnow", "crawl", "monitor404"],
	"Indexing tools run rules, submission, then diagnostics");
assert.deepEqual(SEO_WORKSPACE_NAV_PARENT, { library: "schema", site: "identity" });
for (const group of SEO_WORKSPACE_NAV_GROUPS) {
	for (const view of group.views) {
		assert.equal(seoWorkspaceNavGroup(view), group.id);
		assert.equal(seoWorkspacePrimaryTarget(group.id, view, { [group.id]: group.views[0] }), view,
			"The current page wins over an older remembered page");
		const other = group.id === "overview" ? "social" : "overview";
		assert.equal(seoWorkspacePrimaryTarget(group.id, other), group.views[0], "Unvisited groups use their canonical first page");
		assert.equal(seoWorkspacePrimaryTarget(group.id, other, { [group.id]: view }), view, "Visited groups reuse their eligible page");
		assert.equal(seoWorkspacePrimaryTarget(group.id, other, { [group.id]: other }), group.views[0],
			"A route from another section cannot be restored as this section's memory");
		assert.equal(seoWorkspacePrimaryTarget(group.id, other, { [group.id]: view }, group.views), null,
			"An empty section never invents a destination");
	}
}
assert.equal(seoWorkspacePrimaryTarget("settings", "social", { settings: "migration" }, ["migration"]), "modules",
	"A hidden remembered Migration falls back without reopening hidden work");
assert.equal(seoWorkspacePrimaryTarget("indexing", "social", { indexing: "crawl" }), "crawl");
assert.equal(seoWorkspacePrimaryTarget("indexing", "social", { indexing: "crawl" }, ["crawl"]), "indexing");
assert.equal(seoWorkspacePrimaryTarget("overview", "social", { overview: "schema" }), "overview");
const visible = seoWorkspaceVisibleNavGroups(["migration"]);
assert.equal(visible.flatMap((group) => group.views).length, 20);
assert.deepEqual(visible.find((group) => group.id === "settings")?.views, ["modules", "verification", "portability"],
	"Feature controls leads Settings");
assert.deepEqual(seoWorkspaceVisibleNavGroups(SEO_ADMIN_VIEWS), []);
assert.equal(seoWorkspaceVisibleNavGroups(["queue", "content", "trends"]).some((group) => group.id === "content"), false);
assert.equal(SEO_WORKSPACE_NAV_GROUPS.find((group) => group.id === "settings")?.views.includes("migration"), true);
assert.equal(SEO_WORKSPACE_VIEW_LABELS.identity, "Local SEO");
assert.equal(seoWorkspaceNavGroup("identity"), "appearance");
assert.equal(SEO_WORKSPACE_VIEW_LABELS.site, "Website");
assert.equal(seoWorkspaceNavGroup("site"), "appearance", "Website opens from Local SEO");
assert.equal(seoWorkspaceNavGroup("social"), "appearance");

// The rail derives from the one model: headings, parent rows and one Indexing row.
{
	const rail = seoWorkspaceRail("social", ["migration"]);
	assert.deepEqual(rail.map((group) => [group.id, group.heading]), [
		["overview", false], ["content", true], ["appearance", true], ["indexing", false], ["settings", true],
	]);
	const rows = (group: string, active = rail) => active.find((item) => item.id === group)!.rows;
	const indexingRow = (view: typeof SEO_ADMIN_VIEWS[number], current: "page" | "true" | null) => [{ kind: "group", group: "indexing", view, current }];
	assert.deepEqual(rows("appearance").map((row) => [row.view, row.current]),
		[["templates", null], ["social", "page"], ["schema", null], ["identity", null]], "Search & social follows Templates; children have no row");
	assert.deepEqual(rows("indexing"), indexingRow("indexing", null), "Indexing is one row that opens Indexing rules");
	assert.deepEqual(rows("settings").map((row) => row.view), ["modules", "verification", "portability"]);
	for (const view of SEO_WORKSPACE_INDEXING_VIEWS) {
		const open = seoWorkspaceRail(view, ["migration"]);
		assert.deepEqual(rows("indexing", open), indexingRow("indexing", view === "indexing" ? "page" : "true"), "The one Indexing row is current for every tool");
		assert.equal(open.flatMap((group) => group.rows).filter((row) => row.current).length, 1);
	}
	assert.deepEqual(rows("indexing", seoWorkspaceRail("sitemap", ["indexing"])), indexingRow("sitemap", "page"), "The row opens the first visible tool");
	assert.deepEqual(rows("indexing", seoWorkspaceRail("robots", ["indexing"])), indexingRow("sitemap", "true"));
	assert.equal(seoWorkspaceRail("social", SEO_WORKSPACE_INDEXING_VIEWS).some((group) => group.id === "indexing"), false, "A fully hidden Indexing group has no row");
	for (const [child, parent] of [["site", "identity"], ["library", "schema"]] as const) {
		const marked = seoWorkspaceRail(child).flatMap((group) => group.rows).filter((row) => row.current);
		assert.deepEqual(marked, [{ kind: "view", view: parent, current: "true" }], child + " marks its parent row");
	}
	assert.equal(seoWorkspaceRail("migration").find((group) => group.id === "settings")!.rows.some((row) => row.view === "migration"), true);
	assert.deepEqual(seoWorkspaceRail("overview", SEO_ADMIN_VIEWS), []);
	assert.deepEqual(seoWorkspaceIndexingTools(["migration"]), [...SEO_WORKSPACE_INDEXING_VIEWS], "Every Indexing tool, in canonical order");
	assert.deepEqual(seoWorkspaceIndexingTools(["crawl", "llms", "migration"]), ["indexing", "sitemap", "robots", "indexnow", "monitor404"],
		"Hidden tools are left out and the others keep their order");
	assert.deepEqual(seoWorkspaceIndexingTools(SEO_WORKSPACE_INDEXING_VIEWS), []);
}

// Unreadable settings have one destination.
assert.equal(SEO_SETTINGS_UNREADABLE_VIEW, "indexing");

// Settings search: about 40 setting labels, each translated, each on a real page.
{
	const ids = SEO_SETTINGS_SEARCH_INDEX.map((entry) => entry.id);
	assert.ok(ids.length >= 40, "At least 40 setting labels are indexed");
	assert.equal(new Set(ids).size, ids.length, "Setting ids are unique");
	for (const entry of SEO_SETTINGS_SEARCH_INDEX) {
		assert.ok(SEO_ADMIN_VIEWS.includes(entry.view), entry.id + " opens a canonical view");
		for (const [locale, catalogue] of Object.entries(SEO_CATALOGUES)) {
			const value = (catalogue as Record<string, string>)["nav.setting." + entry.id];
			assert.ok(typeof value === "string" && value.trim(), locale + " labels " + entry.id);
		}
	}
	const sources = readdirSync(new URL(".", import.meta.url)).filter((name) => name.endsWith(".tsx"))
		.map((name) => readFileSync(new URL("./" + name, import.meta.url), "utf8"));
	const mapped = new Set<string>([...Object.values(SEO_MODULE_SETTING_IDS)] as string[]);
	for (const entry of SEO_SETTINGS_SEARCH_INDEX.filter((item) => item.field)) {
		const marked = mapped.has(entry.id) || sources.some((source) =>
			source.includes(`data-seo-setting="${entry.id}"`) || source.includes("data-seo-setting") && source.includes(`: "${entry.id}"`));
		assert.ok(marked, entry.id + " has a field marked with data-seo-setting");
	}
	const { t } = createSeoI18n("en");
	const search = (query: string, views: readonly typeof SEO_ADMIN_VIEWS[number][] = SEO_ADMIN_VIEWS, locale = "en") => {
		const i18n = createSeoI18n(locale);
		return seoWorkspaceSearch(query, {
			locale, views, viewLabel: (view) => i18n.t(`nav.view.${view}`), settingLabel: (id) => i18n.t(`nav.setting.${id}`),
		});
	};
	const bing = search("bing");
	assert.deepEqual(bing.views, []);
	assert.deepEqual(bing.settings.map((entry) => [entry.id, entry.view, entry.field]), [["bingCode", "verification", true]]);
	assert.equal(t("nav.settingResult", { setting: t("nav.setting.bingCode"), page: t("nav.view.verification") }), "Bing verification code (Site verification)");
	assert.deepEqual(search("EXCLUDED").settings.map((entry) => [entry.id, entry.view]), [["excludedPaths", "sitemap"]]);
	assert.deepEqual(search("  schema ").views, ["schema", "library"], "Page names still match");
	assert.ok(search("schema").settings.length > 0, "Setting names match beside pages");
	assert.deepEqual(search(""), { views: [], settings: [] });
	assert.deepEqual(search("bing", SEO_ADMIN_VIEWS.filter((view) => view !== "verification")).settings, [], "A hidden page offers no settings");
	assert.deepEqual(search("no-such-setting"), { views: [], settings: [] });
	assert.deepEqual(search("ŞEMA ÇIKTISI", SEO_ADMIN_VIEWS, "tr").settings.map((entry) => entry.id), ["schemaModule"], "Search uses the locale's case rules");
	assert.deepEqual(search("noindex").settings.map((entry) => [entry.id, entry.view, entry.field]),
		[["siteNoindex", "indexing", true], ["contentTypeNoindex", "indexing", false]], "The content type rule is found beside site-wide noindex");
	assert.ok(search("content type").settings.some((entry) => entry.id === "contentTypeNoindex"));
	assert.deepEqual(search("noindex-regels", SEO_ADMIN_VIEWS, "nl").settings.map((entry) => entry.id), ["contentTypeNoindex"]);
	assert.deepEqual(search("İÇERİK TÜRÜ", SEO_ADMIN_VIEWS, "tr").settings.map((entry) => entry.id), ["contentTypeNoindex"]);
	assert.deepEqual(search("noindex", SEO_ADMIN_VIEWS.filter((view) => view !== "indexing")).settings, [], "Indexing rules hidden, no rule result");
}
assert.equal(SEO_WORKSPACE_VIEW_LABELS.indexing, "Indexing rules");
assert.equal(SEO_WORKSPACE_VIEW_LABELS.templates, "Templates");
assert.equal(SEO_WORKSPACE_VIEW_LABELS.library, "Schema library");
assert.deepEqual(SEO_SETTINGS_SECTION_FIELDS.indexing, ["noindex", "taxonomyArchiveNoindex"]);
assert.deepEqual(SEO_SETTINGS_SECTION_FIELDS.social, ["defaultSocialImage", "twitterHandle"]);
const fieldOwners = Object.values(SEO_SETTINGS_SECTION_FIELDS).flat();
assert.equal(fieldOwners.filter((field) => field === "noindex").length, 1, "Indexing has one settings draft owner");
assert.equal(new Set(fieldOwners).size, fieldOwners.length, "Settings sections cannot silently share editable fields");

// Query keys stay inside one scope so cross-feature invalidation is safe.
assert.equal(seoWorkspaceKeys.overview[0], seoWorkspaceKeys.all[0]);
assert.equal(seoWorkspaceKeys.trends(30, null)[0], seoWorkspaceKeys.all[0]);
assert.deepEqual(seoWorkspaceKeys.trends(7, "posts").slice(1), ["trends", 7, "posts"]);
assert.notDeepEqual(seoWorkspaceKeys.contentOptionPage("posts", "next"), seoWorkspaceKeys.contentOptionPage("pages", "next"));
assert.notDeepEqual(seoWorkspaceKeys.contentOptionPage("posts", "next"), seoWorkspaceKeys.contentOptionPage("posts"));
assert.notDeepEqual(seoWorkspaceKeys.workQueueCollection("posts"), seoWorkspaceKeys.workQueueCollection("pages"));
assert.notDeepEqual(seoWorkspaceKeys.workQueueCollection("posts"), seoWorkspaceKeys.workQueueCollection("posts", "next"));
assert.equal(seoWorkspaceKeys.entryPreview("posts:1")[0], seoWorkspaceKeys.all[0]);

// An exact Templates example read is keyed by collection and ID, outside every prefix a template or score save invalidates.
{
	const invalidated: Array<readonly unknown[]> = [];
	await invalidateScoreData({ invalidateQueries: async ({ queryKey }) => { invalidated.push(queryKey); } });
	const exact = seoWorkspaceKeys.templateExample("posts", "p1");
	const covers = (prefix: readonly unknown[]) => prefix.length <= exact.length && prefix.every((part, index) => exact[index] === part);
	assert.ok(invalidated.length > 0);
	assert.deepEqual(invalidated.filter(covers), [], "saving or resetting templates does not refetch an exact example read");
	assert.equal(covers(seoWorkspaceKeys.templateExamples("posts")), false, "the published pager prefix is separate");
	assert.equal(exact[0], seoWorkspaceKeys.all[0]);
	assert.notDeepEqual(seoWorkspaceKeys.templateExample("posts", "p1"), seoWorkspaceKeys.templateExample("posts", "p2"));
	assert.notDeepEqual(seoWorkspaceKeys.templateExample("posts", "p1"), seoWorkspaceKeys.templateExample("pages", "p1"));
}

assert.deepEqual(
	buildSeoOverviewContentSummary({
		sampleSize: 0,
		averageContentScore: null,
		needsAttention: 0,
	}),
	{
		averageValue: "--",
		averageDetail: "No saved score sample",
		needsWorkValue: "--",
		needsWorkDetail: "Analyze content to measure",
	},
);
for (const state of ["corrupt", "unavailable"] as const) {
	assert.deepEqual(
		buildSeoOverviewContentSummary({ sampleSize: 0, averageContentScore: null, needsAttention: 0 }, state),
		{
			averageValue: "--",
			averageDetail: "Scores unavailable while SEO settings cannot be read",
			needsWorkValue: "--",
			needsWorkDetail: "Unknown until the settings can be read",
		},
		`${state} settings do not read as an empty score sample`,
	);
}
assert.equal(
	buildSeoOverviewContentSummary({ sampleSize: 0, averageContentScore: null, needsAttention: 0 }, "absent").averageDetail,
	"No saved score sample",
);
assert.deepEqual(
	buildSeoOverviewContentSummary({
		sampleSize: 1,
		averageContentScore: 72,
		needsAttention: 1,
	}),
	{
		averageValue: 72,
		averageDetail: "1 recent saved score",
		needsWorkValue: 1,
		needsWorkDetail: "Entry needs attention in this saved sample",
	},
);
assert.deepEqual(
	buildSeoOverviewContentSummary({
		sampleSize: 6,
		averageContentScore: 91,
		needsAttention: 0,
	}),
	{
		averageValue: 91,
		averageDetail: "6 recent saved scores",
		needsWorkValue: 0,
		needsWorkDetail: "Entries need attention in this saved sample",
	},
);

const date = (iso: string) => `on ${iso.slice(0, 10)}`;
assert.equal(seoSettingsSourceLabel({ state: "saved", updatedAt: "2026-10-03T05:00:00.000Z", legacyPresent: false }, date), "Saved on 2026-10-03");
assert.match(seoSettingsSourceLabel({ state: "absent", updatedAt: null, legacyPresent: false }, date), /adds no site-wide noindex/);
assert.match(seoSettingsSourceLabel({ state: "absent", updatedAt: null, legacyPresent: true }, date), /legacy and site values/);
assert.match(seoSettingsSourceLabel({ state: "legacy", updatedAt: null, legacyPresent: true }, date), /legacy settings/);
assert.match(seoSettingsSourceLabel({ state: "historical-seed", updatedAt: null, legacyPresent: false }, date), /site-wide noindex on/);
for (const label of ["absent", "legacy", "historical-seed"] as const) {
	assert.doesNotMatch(seoSettingsSourceLabel({ state: label, updatedAt: null, legacyPresent: false }, date), /^Saved/, `${label} is never shown as saved`);
}
const corruptNotice = seoSettingsUnreadableNotice({ state: "corrupt", revision: "r1" });
assert.match(corruptNotice.title, /invalid/);
assert.match(corruptNotice.description, /stored SEO settings record/);
assert.match(seoSettingsUnreadableNotice({ state: "corrupt", revision: null }).description, /legacy SEO settings key/);
assert.match(seoSettingsUnreadableNotice({ state: "unavailable", revision: null }).title, /could not be read/);
const restoredBase = {
	contractVersion: SEO_ADMIN_CONTRACT_VERSION, storageVersion: 1 as const, engineVersion: "test", state: "saved" as const,
	contentScoring: { state: "pending-confirmation" as const, revision: "r2", intentEnabled: true, acknowledgedNoticeVersion: null, currentNoticeVersion: 1 },
	updatedAt: "2026-10-03T05:00:00.000Z", revision: "r2", legacyGuard: null, legacyPresent: false, indexingPreferenceConfirmed: false,
};
const values = {
	siteName: "Site", siteUrl: "", publisherType: "organization" as const, organizationName: "Site", organizationLogo: "",
	personName: "", socialProfiles: [], personProfiles: [], defaultSocialImage: "", twitterHandle: "", noindex: true,
	contentScoringEnabled: true,
};
assert.match(seoSettingsRestoredMessage({ success: true, settings: { ...restoredBase, values } }), /noindex stays on/);
assert.match(seoSettingsRestoredMessage({ success: true, settings: { ...restoredBase, values: { ...values, noindex: false } } }), /noindex stays off/);

// A page change scrolls only a real scroll container, and only when the workspace top is out of view above it.
{
	const hostWrapper = { node: "wrapper", overflowY: "hidden", scrollable: true, top: 0 } as const;
	const main = { node: "main", overflowY: "auto", scrollable: true, top: 56 } as const;
	assert.equal(seoWorkspaceTopScroll(80, [main, hostWrapper]), null, "A workspace top already in view scrolls nothing");
	assert.equal(seoWorkspaceTopScroll(56, [main, hostWrapper]), null, "A top level with the container top is in view");
	assert.deepEqual(seoWorkspaceTopScroll(-280, [main, hostWrapper]), { container: "main", by: -336 }, "A top scrolled away returns to the container top");
	assert.deepEqual(seoWorkspaceTopScroll(-280, [hostWrapper, main]), { container: "main", by: -336 },
		"An overflow-hidden ancestor is skipped even when nearer and scrollable");
	for (const overflowY of ["hidden", "clip", "visible"]) {
		assert.deepEqual(seoWorkspaceTopScroll(-40, [{ ...main, overflowY }]), { container: null, by: -40 }, overflowY + " is not a scroll container: the document scrolls");
	}
	assert.deepEqual(seoWorkspaceTopScroll(-40, [{ ...main, overflowY: "scroll" }]), { container: "main", by: -96 });
	assert.deepEqual(seoWorkspaceTopScroll(-40, [{ ...main, scrollable: false }, { node: "outer", overflowY: "auto", scrollable: true, top: 0 }]),
		{ container: "outer", by: -40 }, "An auto container without overflow cannot move the workspace, so the next one is used");
	assert.deepEqual(seoWorkspaceTopScroll(-40, [{ ...main, top: -120 }]), { container: "main", by: -40 }, "Visible area starts at the viewport top at the latest");
	assert.equal(seoWorkspaceTopScroll(10, []), null, "The document scrolls nothing while the top is in view");
	assert.deepEqual(seoWorkspaceTopScroll(-15, []), { container: null, by: -15 });
}

console.log("SEO workspace model self-check passed.");
