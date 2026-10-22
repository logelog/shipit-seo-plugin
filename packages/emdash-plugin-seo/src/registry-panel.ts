// Saved-entry SEO overview for the content editor sidebar (Block Kit).
// Entry identity comes only from the host-attested `routeCtx.ui.entry`; the
// interaction body never selects which entry is read. Opening the panel reads
// stored state only. The explicit check analyzes the saved version in memory
// and must never write scores, score history or analysis revisions.
import type { PluginContext } from "emdash";

import type { SeoAdminMetadataSource } from "./admin-contract.ts";
import { SEO_SCORE_VERSION, seoScoreDisplay, type SeoContentCheck } from "./analysis.ts";
import {
	SEO_EARLIER_ANALYZER_TEXT,
	presentSeoChecks,
	seoCheckTotalsText,
	type SeoCheckPresentation,
} from "./check-presentation.ts";
import {
	analyzeContentPreview,
	contentRef,
	entryCanonicalValidation,
	hydrateStoredScoreDraft,
	publicUrlForContent,
	readAdminModules,
	readAdminTemplates,
	readStoredScoreSnapshot,
	resolveContentCollection,
	resolveEffectiveContentMetadata,
	resolveOverrideForContentItem,
	scoreContentSourceVersion,
	templateRevisionFor,
	type EffectiveSeoMetadata,
	type SeoScoreRecord,
} from "./entry-analysis-runtime.ts";
import { mergeRobotsDirectives, readMetaOverride } from "./meta-overrides.ts";
import { contentTypeNoindexApplies } from "./content-type-noindex-policy.ts";
import { getContentScoringEnabled, readSiteSettings } from "./settings-runtime.ts";
import { isReadableSiteSettings } from "./settings-state.ts";
import type { SeoCanonicalStatus } from "./sitemap-policy.ts";

export const SEO_OVERVIEW_PANEL = {
	id: "seo-overview",
	title: "SEO overview",
	route: "seo-overview-panel",
	collections: ["pages", "posts"],
	order: 10,
} as const;

export const SEO_OVERVIEW_CHECK_ACTION = "seo-overview:check";

// The sandbox bridge exposes every storage name and rejects undeclared ones at
// call time, so shared readers would fail instead of treating them as absent.
export const SEO_REGISTRY_STORAGE = ["scores", "overrides", "schemas"] as const;

function declaredStorageContext(ctx: PluginContext): PluginContext {
	const storage = Object.fromEntries(SEO_REGISTRY_STORAGE.map((name) => [name, (ctx.storage as any)[name]]));
	return { ...ctx, storage } as PluginContext;
}

// Native data in the camelCase analysisProfiles, metaOverrides and
// socialOverrides collections reads as absent here. Every value or check that
// would use it must say so instead of presenting the default as the site's data.
const UNREADABLE_DATA_SUMMARY =
	"focus keywords, pillar status, per-entry robots and schema settings, or social overrides";

const UNREADABLE_DATA_CHECKS: Record<string, string> = {
	"focus-keyword": "needs the stored focus keyword",
	"secondary-keyword-coverage": "needs the stored focus keywords",
	schema: "needs per-entry schema settings",
};

function unreadableDataReason(check: SeoContentCheck): string | null {
	return UNREADABLE_DATA_CHECKS[check.id] ?? (check.category === "keyword" ? "needs the stored focus keyword" : null);
}

type Block = Record<string, unknown> & { type: string };

interface PanelResponse {
	blocks: Block[];
	toast?: { message: string; type: "success" | "error" | "info" };
}

interface EntryIdentity {
	collection: string;
	id: string;
	locale: string | null;
	version: number;
}

type Interaction =
	| { kind: "load" }
	| { kind: "check"; version: number }
	| { kind: "invalid" };

type StoredFreshness =
	| { kind: "version-match" }
	| { kind: "stale"; reasons: string[] }
	| { kind: "untracked" };

type ScoreView =
	| { kind: "absent" }
	| { kind: "stored"; score: SeoScoreRecord; freshness: StoredFreshness }
	| { kind: "session"; score: SeoScoreRecord };

interface Notice {
	variant: "default" | "alert" | "error";
	title: string;
	description?: string;
}

interface OverviewModel {
	identity: EntryIdentity;
	collectionLabel: string;
	status: string;
	effective: EffectiveSeoMetadata;
	publicUrl: string;
	canonicalStatus: SeoCanonicalStatus;
	noindexReasons: string[];
	entryNoindex: boolean;
	robots: string;
	scoringEnabled: boolean;
	score: ScoreView;
}

class PanelStateError extends Error {
	readonly notice: Notice;

	constructor(notice: Notice) {
		super(notice.title);
		this.notice = notice;
	}
}

const SOURCE_LABELS: Record<SeoAdminMetadataSource, string> = {
	"core-seo": "Entry SEO field",
	template: "Metadata template",
	content: "Entry content",
	"legacy-override": "Legacy SEO override",
	"plugin-social-override": "Social override",
	"site-default": "Site default",
	generated: "Entry URL",
};

const CANONICAL_STATUS_LABELS: Record<SeoCanonicalStatus, string> = {
	matches: "Matches the entry's public URL",
	"different-path": "Points to a different page than this entry",
	"off-origin": "Points to another site",
	"query-or-fragment": "Contains a query string or fragment",
	invalid: "Not a valid URL for this site",
};

const STATUS_LABELS: Record<string, string> = {
	published: "Published",
	draft: "Draft",
	scheduled: "Scheduled",
	archived: "Archived",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function panelIdentity(ui: unknown): EntryIdentity | null {
	if (!isRecord(ui) || ui.surface !== "content-editor-panel" || ui.extensionId !== SEO_OVERVIEW_PANEL.id)
		return null;
	const entry = ui.entry;
	if (!isRecord(entry)) return null;
	const { collection, id, locale, version } = entry;
	if (typeof collection !== "string" || typeof id !== "string" || !collection || !id) return null;
	if (locale !== null && typeof locale !== "string") return null;
	if (typeof version !== "number" || !Number.isSafeInteger(version)) return null;
	if (!(SEO_OVERVIEW_PANEL.collections as readonly string[]).includes(collection)) return null;
	return { collection, id, locale, version };
}

export function panelInteraction(input: unknown): Interaction {
	if (!isRecord(input)) return { kind: "invalid" };
	if (input.type === "panel_load") return { kind: "load" };
	if (input.type !== "block_action" || input.action_id !== SEO_OVERVIEW_CHECK_ACTION) return { kind: "invalid" };
	const value = input.value;
	if (!isRecord(value) || Object.keys(value).length !== 1) return { kind: "invalid" };
	const version = value.version;
	return typeof version === "number" && Number.isSafeInteger(version)
		? { kind: "check", version }
		: { kind: "invalid" };
}

interface ReviewableChecks {
	/** The editor's groups, pills and rows for the checks this build can show. */
	presentation: SeoCheckPresentation;
	unreadable: Array<{ check: SeoContentCheck; reason: string }>;
}

function reviewableChecks(score: Exclude<ScoreView, { kind: "absent" }>): ReviewableChecks {
	const unreadable: ReviewableChecks["unreadable"] = [];
	const checks: SeoContentCheck[] = [];
	for (const check of score.score.checks) {
		const reason = score.kind === "session" ? unreadableDataReason(check) : null;
		if (reason) unreadable.push({ check, reason });
		else checks.push(check);
	}
	return {
		presentation: presentSeoChecks({ checks, scoreVersion: score.score.scoreVersion, assessmentProfile: score.score.assessmentProfile }),
		unreadable,
	};
}

// A stored score's configuration fingerprint covers every custom schema on the
// site. The panel never reads that inventory, so it can prove a score stale but
// never current: a match on every tracked revision stays "version-match".
async function storedScoreFreshness(
	ctx: PluginContext,
	collection: string,
	item: unknown,
	score: SeoScoreRecord,
): Promise<StoredFreshness> {
	if (typeof score.sourceVersion !== "string" || !("templateUpdatedAt" in score) || !("modulesUpdatedAt" in score))
		return { kind: "untracked" };
	const reasons: string[] = [];
	if (score.sourceVersion !== scoreContentSourceVersion(item)) reasons.push("The entry was saved after this score.");
	if (score.scoreVersion !== SEO_SCORE_VERSION) reasons.push("The analysis rules changed since this score.");
	if (reasons.length) return { kind: "stale", reasons };
	const [templates, modules] = await Promise.all([readAdminTemplates(ctx), readAdminModules(ctx)]);
	if (score.templateUpdatedAt !== templateRevisionFor(templates, collection))
		reasons.push("The SEO template for this content type changed since this score.");
	if (score.modulesUpdatedAt !== modules.updatedAt) reasons.push("The SEO feature controls changed since this score.");
	return reasons.length ? { kind: "stale", reasons } : { kind: "version-match" };
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

function formatDate(value: string | null | undefined): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function evidenceText(check: SeoContentCheck): string | null {
	const { actual, expected } = check.evidence ?? {};
	if (actual === null || actual === undefined || actual === "" || !expected) return null;
	return `Found: ${String(actual)}. Expected: ${expected}.`;
}

function versionLabel(identity: EntryIdentity): string {
	return identity.locale ? `version ${identity.version}, ${identity.locale}` : `version ${identity.version}`;
}

async function readOverview(
	ctx: PluginContext,
	identity: EntryIdentity,
	options: { analyze: boolean },
): Promise<OverviewModel> {
	if (!ctx.content) {
		throw new PanelStateError({
			variant: "error",
			title: "This plugin cannot read this entry",
			description: "The plugin does not have content read access on this site.",
		});
	}
	const definition = await resolveContentCollection(ctx, identity.collection);
	if (!definition) {
		throw new PanelStateError({
			variant: "default",
			title: "SEO overview is not available for this content type",
			description: "This plugin covers public, routable collections. This collection is hidden or has no public URLs.",
		});
	}
	const item: any = await ctx.content.get(identity.collection, identity.id);
	if (!item) {
		throw new PanelStateError({
			variant: "error",
			title: "This entry could not be found",
			description: "It may have been deleted. Reload the editor.",
		});
	}
	if (String(item.id) !== identity.id || (item.locale ?? null) !== identity.locale) {
		throw new PanelStateError({
			variant: "error",
			title: "The entry did not match the editor",
			description: "This plugin did not read or analyze it. Reload the editor.",
		});
	}
	if (item.version !== identity.version) {
		throw new PanelStateError({
			variant: "alert",
			title: "This entry was saved while the panel was loading",
			description: "Close and reopen the panel to see the latest saved version.",
		});
	}

	let saved: any;
	try {
		saved = await hydrateStoredScoreDraft(ctx, identity.collection, item);
	} catch (error: unknown) {
		ctx.log?.warn?.("seo: overview could not read the saved draft revision", { error: String(error) });
		throw new PanelStateError({
			variant: "error",
			title: "The saved draft could not be read",
			description: "This plugin needs revision read access to describe a saved draft. Nothing was analyzed.",
		});
	}

	const site = await readSiteSettings(ctx);
	if (!isReadableSiteSettings(site)) {
		throw new PanelStateError({
			variant: "error",
			title: "SEO settings cannot be read",
			description: site.state === "corrupt"
				? "The stored SEO settings are invalid. Nothing was analyzed."
				: "The SEO settings could not be read. Nothing was analyzed.",
		});
	}
	const siteNoindex = site.values.noindex;
	const ref = contentRef(identity.collection, item);
	const [effective, publicUrl, override, metaOverride, scoringEnabled] = await Promise.all([
		resolveEffectiveContentMetadata(ctx, identity.collection, saved, undefined, site.values),
		publicUrlForContent(ctx, identity.collection, saved),
		resolveOverrideForContentItem(ctx, identity.collection, saved),
		readMetaOverride(ctx, ref),
		getContentScoringEnabled(ctx),
	]);
	const canonicalStatus = entryCanonicalValidation(
		effective.canonical.value,
		publicUrl,
		effective.vars.siteUrl || ctx.site?.url || "",
	).status;
	const noindexReasons: string[] = [];
	if (siteNoindex) noindexReasons.push("The site-wide noindex setting is on.");
	if (contentTypeNoindexApplies(site.values.contentTypeNoindex, identity.collection))
		noindexReasons.push("A content type rule in Indexing rules asks search engines not to index every entry of this type.");
	if (saved?.seo?.noIndex === true) noindexReasons.push("The entry's EmDash SEO setting asks search engines not to index it.");
	if ((override?.robots ?? "").toLowerCase().includes("noindex"))
		noindexReasons.push("A legacy SEO override sets noindex.");

	let score: ScoreView = { kind: "absent" };
	if (options.analyze && scoringEnabled) {
		const session = await analyzeContentPreview(ctx, identity.collection, saved, undefined, item);
		score = { kind: "session", score: session };
	} else {
		const stored = await readStoredScoreSnapshot(ctx, ref);
		if (stored) {
			score = { kind: "stored", score: stored, freshness: await storedScoreFreshness(ctx, identity.collection, item, stored) };
		}
	}

	return {
		identity,
		collectionLabel: definition.labelSingular,
		status: typeof item.status === "string" ? item.status : "draft",
		effective,
		publicUrl,
		canonicalStatus,
		noindexReasons,
		entryNoindex: saved?.seo?.noIndex === true,
		robots: mergeRobotsDirectives(effective.robots, metaOverride?.robots),
		scoringEnabled,
		score,
	};
}

function checkButton(identity: EntryIdentity, label: string): Block {
	return {
		type: "button",
		action_id: SEO_OVERVIEW_CHECK_ACTION,
		label,
		style: "primary",
		value: { version: identity.version },
	};
}

function noticeBlock(notice: Notice, blockId: string): Block {
	return {
		type: "banner",
		block_id: blockId,
		variant: notice.variant,
		title: notice.title,
		...(notice.description ? { description: notice.description } : {}),
	};
}

function scoreBlocks(model: OverviewModel): Block[] {
	const blocks: Block[] = [];
	const { score, identity } = model;
	if (score.kind === "absent") {
		blocks.push({
			type: "banner",
			block_id: "seo-overview:score",
			variant: "default",
			title: "No saved score yet",
			description: model.scoringEnabled
				? "Opening this panel never runs a check. Check the saved version to see findings."
				: "Content scoring is off for this site, so no check runs here.",
		});
	} else if (score.kind === "session") {
		const { presentation, unreadable } = reviewableChecks(score);
		blocks.push({
			type: "stats",
			block_id: "seo-overview:score",
			items: [
				{ label: "Issues", value: presentation.totals.issues },
				{ label: "Suggestions", value: presentation.totals.suggestions },
				{ label: "Not checked", value: presentation.totals.notChecked },
			],
		});
		blocks.push({
			type: "context",
			text: `Session check of the saved ${versionLabel(identity)}, ${formatDate(score.score.updatedAt) ?? "just now"}. Not saved to score history. No overall score is shown because ${plural(unreadable.length, "check needs", "checks need")} data this build cannot read.`,
		});
	} else {
		const savedAt = formatDate(score.score.updatedAt);
		// The editor's display decision: earlier analyzers and dashed results never render a number or meter.
		const display = seoScoreDisplay(score.score);
		const { presentation } = reviewableChecks(score);
		if (display.score !== null) {
			blocks.push({
				type: "meter",
				block_id: "seo-overview:score",
				label: "Saved SEO score",
				value: display.score,
				min: 0,
				max: 100,
				custom_value: `${display.score} / 100`,
			});
		}
		blocks.push({
			type: "context",
			text: presentation.legacy
				? SEO_EARLIER_ANALYZER_TEXT
				: `${display.label}${display.qualifier ? `. ${display.qualifier}` : ""}. ${seoCheckTotalsText(presentation.totals)}.`,
		});
		if (score.freshness.kind === "version-match") {
			blocks.push({
				type: "context",
				text: `Matches the saved ${versionLabel(identity)}, its content type template and SEO feature controls${savedAt ? `. Scored ${savedAt}` : ""}. Site-wide SEO settings and custom schemas are not re-checked when this panel opens.`,
			});
		} else if (score.freshness.kind === "stale") {
			blocks.push({
				type: "banner",
				block_id: "seo-overview:freshness",
				variant: "alert",
				title: "Saved score is out of date",
				description: `${score.freshness.reasons.join(" ")} Its findings may no longer apply.`,
			});
		} else {
			blocks.push({
				type: "banner",
				block_id: "seo-overview:freshness",
				variant: "alert",
				title: "This saved score has no version record",
				description: "It was saved before scores tracked versions, so it cannot be matched to this entry's saved version.",
			});
		}
	}
	if (!model.scoringEnabled) {
		if (score.kind !== "absent") {
			blocks.push({
				type: "context",
				text: "Content scoring is off for this site. Saved scores stay readable, but no new check runs.",
			});
		}
	} else {
		blocks.push({
			type: "actions",
			block_id: "seo-overview:actions",
			elements: [checkButton(identity, score.kind === "session" ? "Check saved version again" : "Check saved version")],
		});
	}
	blocks.push(
		{
			type: "context",
			text: `Covers the saved ${versionLabel(identity)}. Unsaved changes in the editor are not included.`,
		},
		{
			type: "banner",
			block_id: "seo-overview:limits",
			variant: "default",
			title: "Registry build limits",
			description: `Live page tags come from EmDash and your theme; this build does not publish them yet. It cannot read ${UNREADABLE_DATA_SUMMARY}, so values and checks that depend on them are marked.`,
		},
	);
	return blocks;
}

function findingsBlocks(model: OverviewModel): Block[] {
	const { score } = model;
	if (score.kind === "absent") {
		return [{
			type: "empty",
			size: "sm",
			title: "No findings yet",
			description: model.scoringEnabled
				? "Findings appear after a saved score exists or after you check the saved version."
				: "Content scoring is off for this site.",
		}];
	}
	const { presentation, unreadable } = reviewableChecks(score);
	const blocks: Block[] = [];
	if (presentation.legacy) {
		blocks.push({
			type: "banner",
			variant: "default",
			title: "Earlier analyzer",
			description: "This result was saved with an earlier analyzer. Analyze this entry to update it.",
		});
	} else if (presentation.totals.issues === 0) {
		blocks.push({
			type: "banner",
			variant: "default",
			title: "No issues",
			description: presentation.totals.suggestions > 0
				? "No Failed or Partly met rows for this version. Suggestions are listed below."
				: "No Failed or Partly met rows for this version.",
		});
	}
	for (const group of presentation.groups) {
		const inner: Block[] = [];
		for (const row of group.rows) {
			inner.push({ type: "section", text: `${row.word}: ${row.check.label}` });
			const detail = [row.check.detail, row.showRecommendation ? row.check.recommendation : null,
				row.kind === "earlier" ? null : evidenceText(row.check)].filter(Boolean).join(" ");
			if (detail) inner.push({ type: "context", text: detail });
		}
		if (group.notApplicableLabel) {
			inner.push({
				type: "context",
				text: `${group.notApplicableLabel}: ${group.notApplicable.map((item) => item.text).join(" ")}`,
			});
		}
		blocks.push({
			type: "accordion",
			block_id: `seo-overview:findings:${group.id}`,
			label: `${group.label}: ${group.pill.text}`,
			default_open: group.id === presentation.defaultOpenGroupId,
			blocks: inner,
		});
	}
	if (unreadable.length > 0) {
		blocks.push({
			type: "accordion",
			block_id: "seo-overview:findings:unreadable",
			label: `Not evaluated in this build: ${unreadable.length}`,
			blocks: [
				{ type: "context", text: "These checks ran without data this registry build cannot read, so their results are not shown or counted." },
				...unreadable.map(({ check, reason }) => ({ type: "context", text: `${check.label}: ${reason}.` })),
			],
		});
	}
	return blocks;
}

function metadataField(label: string, value: string, source: SeoAdminMetadataSource, extra?: string): Block[] {
	const text = value.trim();
	return [
		{ type: "section", text: `${label}: ${text || "Not set"}` },
		{
			type: "context",
			text: [`Source: ${SOURCE_LABELS[source] ?? source}`, text ? `${text.length} characters` : null, extra ?? null]
				.filter(Boolean)
				.join(". ") + ".",
		},
	];
}

const SOCIAL_OVERRIDE_CAVEAT = "This build cannot read per-entry social overrides, which would replace this value";

function searchBlocks(model: OverviewModel): Block[] {
	const { effective } = model;
	return [
		...metadataField("Title", effective.title.value, effective.title.source),
		...metadataField("Description", effective.description.value, effective.description.source),
		...metadataField("Social title", effective.socialTitle.value, effective.socialTitle.source, SOCIAL_OVERRIDE_CAVEAT),
		...metadataField("Social description", effective.socialDescription.value, effective.socialDescription.source, SOCIAL_OVERRIDE_CAVEAT),
		...metadataField("Social image", effective.image.value, effective.image.source),
	];
}

function indexingBlocks(model: OverviewModel): Block[] {
	const { effective } = model;
	const published = model.status === "published";
	const blocks: Block[] = [{
		type: "fields",
		fields: [
			{ label: "Status", value: STATUS_LABELS[model.status] ?? model.status },
			{ label: "EmDash noindex", value: model.entryNoindex ? "On" : "Off" },
		],
	}];
	if (!effective.indexable) {
		blocks.push({
			type: "banner",
			variant: "alert",
			title: "SEO rules block indexing",
			description: model.noindexReasons.join(" ") || "A noindex rule applies to this entry.",
		});
	}
	if (!published) {
		blocks.push({
			type: "context",
			text: "Not public yet. Search engines cannot reach this entry until it is published.",
		});
	}
	blocks.push(
		{ type: "section", text: `Robots under SEO rules: ${model.robots || "none, so search engines index and follow by default"}` },
		{
			type: "context",
			text: "Per-entry robots directives (nofollow, noarchive, nosnippet, noimageindex, notranslate) are not included: this build cannot read them.",
		},
		{ type: "section", text: `Canonical URL: ${effective.canonical.value || "Not available"}` },
		{
			type: "context",
			text: `Source: ${SOURCE_LABELS[effective.canonical.source] ?? effective.canonical.source}. ${
				model.publicUrl || model.canonicalStatus !== "invalid"
					? CANONICAL_STATUS_LABELS[model.canonicalStatus]
					: "Can be checked once the entry has a public URL"
			}.`,
		},
		{ type: "section", text: `Public URL: ${model.publicUrl || "None yet"}` },
	);
	return blocks;
}

export function renderOverview(model: OverviewModel, extra: Notice[] = []): Block[] {
	const findingCount = model.score.kind === "absent"
		? null
		: reviewableChecks(model.score).presentation.totals.issues;
	return [
		...extra.map((notice, index) => noticeBlock(notice, `seo-overview:notice:${index}`)),
		...scoreBlocks(model),
		{
			type: "tab",
			block_id: "seo-overview:tabs",
			default_tab: 0,
			panels: [
				{ label: findingCount === null ? "Findings" : `Findings (${findingCount})`, blocks: findingsBlocks(model) },
				{ label: "Search", blocks: searchBlocks(model) },
				{ label: "Indexing", blocks: indexingBlocks(model) },
			],
		},
	];
}

function stateResponse(notice: Notice, toast?: PanelResponse["toast"]): PanelResponse {
	return { blocks: [noticeBlock(notice, "seo-overview:state")], ...(toast ? { toast } : {}) };
}

export async function handleSeoOverviewPanel(
	routeCtx: { input?: unknown; ui?: unknown },
	ctx: PluginContext,
): Promise<PanelResponse> {
	const identity = panelIdentity(routeCtx.ui);
	if (!identity) {
		return stateResponse({
			variant: "error",
			title: "Open this overview from the content editor",
			description: "The request did not carry an editor entry, so nothing was read.",
		});
	}
	const interaction = panelInteraction(routeCtx.input);
	ctx = declaredStorageContext(ctx);
	try {
		if (interaction.kind === "invalid") {
			const model = await readOverview(ctx, identity, { analyze: false });
			return {
				blocks: renderOverview(model, [{
					variant: "alert",
					title: "That action is not available",
					description: "Nothing was analyzed. Use the button below to check the saved version.",
				}]),
				toast: { message: "Nothing was analyzed.", type: "error" },
			};
		}
		if (interaction.kind === "check" && interaction.version !== identity.version) {
			const model = await readOverview(ctx, identity, { analyze: false });
			return {
				blocks: renderOverview(model, [{
					variant: "alert",
					title: "The entry was saved again",
					description: `The check was for version ${interaction.version}. This is the saved ${versionLabel(identity)}; check it again to see current findings.`,
				}]),
				toast: { message: "Nothing was analyzed because the entry changed.", type: "info" },
			};
		}
		const analyze = interaction.kind === "check";
		const model = await readOverview(ctx, identity, { analyze });
		if (analyze && !model.scoringEnabled) {
			return {
				blocks: renderOverview(model),
				toast: { message: "Content scoring is off, so nothing was analyzed.", type: "info" },
			};
		}
		if (analyze && model.score.kind === "session") {
			const { presentation, unreadable } = reviewableChecks(model.score);
			const count = presentation.totals.issues;
			const found = count === 0 ? "No issues among evaluated checks." : `${plural(count, "issue", "issues")} found.`;
			return {
				blocks: renderOverview(model),
				toast: {
					message: `Check complete. ${found} ${plural(unreadable.length, "check was", "checks were")} not evaluated.`,
					type: "success",
				},
			};
		}
		return { blocks: renderOverview(model) };
	} catch (error: unknown) {
		if (error instanceof PanelStateError) return stateResponse(error.notice);
		const message = error instanceof Error ? error.message : String(error);
		ctx.log?.warn?.("seo: overview panel failed", { error: message });
		const changed = /changed during analysis/i.test(message);
		return stateResponse(
			{
				variant: changed ? "alert" : "error",
				title: changed ? "The entry or SEO settings changed during the check" : "The SEO overview could not be loaded",
				description: changed
					? "No result was kept. Run the check again."
					: "This plugin hit an error. Nothing was saved. Try again, and check the server log if it repeats.",
			},
			interaction.kind === "check" ? { message: "The check did not finish.", type: "error" } : undefined,
		);
	}
}

export const seoOverviewRoutes = {
	[SEO_OVERVIEW_PANEL.route]: {
		permission: "content:edit_own" as const,
		handler: handleSeoOverviewPanel,
	},
};
