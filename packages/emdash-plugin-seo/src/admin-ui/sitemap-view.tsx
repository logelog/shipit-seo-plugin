import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input, Textarea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Table } from "@cloudflare/kumo/components/table";
import { useQuery } from "@tanstack/react-query";
import { ArrowClockwise, ArrowCounterClockwise, ArrowUpRight, CaretLeft, CaretRight, MagnifyingGlass, TreeStructure, WarningCircle } from "@phosphor-icons/react";
import {
	validateSeoAdminSitemapValues,
	type SeoAdminSitemapConfiguration,
	type SeoAdminSitemapErrors,
	type SeoAdminSitemapPreviewEntry,
	type SeoSitemapAvailability,
	type SeoSitemapOwner,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { previewSeoAdminSitemap, resetSeoAdminSitemap, saveSeoAdminSitemap } from "./api.ts";
import {
	filterSitemapExplorer, initialSitemapExplorerFilters, pageSitemapExplorer, publicLinkText,
	sitemapExplorerRequest, sitemapFileLinks, sitemapPlanSummary, sitemapPreviewDisplay,
	sitemapPreviewMatches, sitemapPreviewReadDenied, sitemapPreviewRowsLabel, sitemapPreviewScope, sitemapPreviewSelection,
	type SitemapPreviewPosition, type SitemapPreviewStatus, type SitemapPreviewSuccess,
} from "./sitemap-view-model.ts";
import { seoWorkspaceKeys } from "./workspace-model.ts";
import { useSeoToasts, useWorkspaceDraftHold, useWorkspacePageActive } from "./workspace-shell.tsx";
import { SettingsActionBar } from "./settings-action-bar.tsx";

interface SitemapViewProps {
	configuration: SeoAdminSitemapConfiguration;
	onSaved: (configuration: SeoAdminSitemapConfiguration) => void;
	onOpenModules: () => void;
	/** Reads the stored sitemap settings again after a conflict or a save whose outcome is unknown; null when that read failed. */
	onReload: () => Promise<SeoAdminSitemapConfiguration | null>;
}

const OWNER_LABELS: Record<SeoSitemapOwner, string> = {
	shipit: "Served by this plugin",
	"module-off": "EmDash core",
	"site-route": "Site route",
	"static-file": "Static file",
	integration: "Another integration",
	"competing-route": "Another route",
	unknown: "Not confirmed",
	"unsupported-routing": "EmDash core",
	"unsupported-host": "EmDash core",
	"not-installed": "EmDash core",
};

function ownerExplanation(owner: SeoSitemapOwner, detail: string | null): string {
	switch (owner) {
		case "module-off":
			return "The sitemap feature is turned off in Feature controls, so EmDash core serves /sitemap.xml and these choices are not applied.";
		case "site-route":
			return `The site defines its own sitemap route${detail ? ` (${detail})` : ""}. That route stays in charge and these choices do not change it.`;
		case "static-file":
			return `The site publishes a static sitemap file${detail ? ` (${detail})` : ""}. It stays in charge and these choices do not change it.`;
		case "integration":
			return `${detail ?? "Another integration"} builds this site's sitemap. It stays in charge and these choices do not change it.`;
		case "competing-route":
			return `Another route answers ${detail ?? "/sitemap.xml"}. It stays in charge and these choices do not change it.`;
		case "unknown":
			return `The site's sitemap files could not be inspected${detail ? ` (${detail})` : ""}. This plugin leaves the sitemap unchanged. Restore access to the files, then restart or rebuild the site to check ownership again.`;
		case "unsupported-routing":
			return `This plugin cannot describe this site's public addresses (${detail ?? "unsupported routing"}), so EmDash core keeps serving /sitemap.xml.`;
		case "unsupported-host":
			return `Sitemap control needs a verified EmDash version${detail ? `; this site runs ${detail}` : ""}. EmDash core keeps serving /sitemap.xml.`;
		case "not-installed":
			return "This installation does not serve sitemap XML through this plugin. Install the plugin through its Astro integration to apply these choices; until then EmDash core serves /sitemap.xml.";
		default:
			return "";
	}
}

const AVAILABILITY_NOTICES: Partial<Record<SeoSitemapAvailability, { title: string; description: string; variant: "alert" | "error" }>> = {
	"settings-corrupt": {
		variant: "error",
		title: "Stored sitemap settings are invalid",
		description: "The public sitemap answers 503 until they are replaced. Review the choices below and save to replace the stored record.",
	},
	"settings-unavailable": {
		variant: "error",
		title: "Sitemap settings could not be read",
		description: "The public sitemap answers 503 while the stored settings cannot be read. Reload to try again.",
	},
	"feature-controls-invalid": {
		variant: "error",
		title: "The Feature controls record is invalid",
		description: "The Sitemaps switch cannot be read, so the public sitemap answers 503 instead of guessing. Save Feature controls again to replace the stored record.",
	},
	"site-settings-invalid": {
		variant: "error",
		title: "The stored site settings are invalid",
		description: "The site URL and site-wide noindex cannot be read, so the public sitemap answers 503 instead of guessing. Saving is off while the record is invalid; restore it from a backup or follow the recovery steps in the plugin guide under \"Site-wide indexing\".",
	},
	"no-origin": {
		variant: "alert",
		title: "The public site URL is missing",
		description: "Sitemaps list absolute URLs. Set the production URL in Local SEO's Website settings; until then the public sitemap answers 503.",
	},
	"source-unavailable": {
		variant: "error",
		title: "Published entries could not be read",
		description: "The public sitemap answers 503 instead of listing part of the site. Reload to try again.",
	},
	"route-conflict": {
		variant: "error",
		title: "Selected content types can share addresses",
		description: "The public sitemap answers 503 until each selected content type gives every entry its own address. Clear the content types marked below.",
	},
	"site-noindex": {
		variant: "alert",
		title: "Site-wide noindex is on",
		description: "Every page asks search engines not to index it, so /sitemap.xml lists no files while that setting stays on.",
	},
};

const STATUS_LABELS: Record<SeoAdminSitemapPreviewEntry["status"], string> = {
	included: "Listed",
	"locale-unrouted": "Locale has no address",
	"unresolved-route": "URL pattern not resolved",
	noindex: "Noindex",
	"excluded-path": "Excluded path",
	"canonical-elsewhere": "Canonical elsewhere",
	"canonical-invalid": "Invalid canonical",
	"invalid-url": "Invalid URL",
	"duplicate-url": "Duplicate address",
};

interface SitemapDraft {
	contentTypes: Record<string, boolean>;
	excludedText: string;
}

function draftFrom(configuration: SeoAdminSitemapConfiguration): SitemapDraft {
	return {
		contentTypes: Object.fromEntries(configuration.groups.map((group) => [group.key, configuration.values.contentTypes[group.key] === true])),
		excludedText: configuration.values.excludedPaths.join("\n"),
	};
}

function excludedLines(text: string): string[] {
	return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function sameDraft(left: SitemapDraft, right: SitemapDraft): boolean {
	return JSON.stringify(left.contentTypes) === JSON.stringify(right.contentTypes) &&
		excludedLines(left.excludedText).join("\n") === excludedLines(right.excludedText).join("\n");
}

function readableDate(value: string | null): string {
	if (!value) return "Not recorded";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

/** Without a label the address itself is shown, breakable between its path parts. */
function PublicLink({ url, children }: { url: string; children?: string }) {
	const { parts, end } = publicLinkText(children ?? url, children === undefined);
	return (
		<a className="shipit-seo-public-link" href={url} target="_blank" rel="noopener noreferrer">
			{parts.map((part, index) => <React.Fragment key={index}>{index ? <wbr /> : null}{part}</React.Fragment>)}
			<span className="shipit-seo-public-link__end">{end}<ArrowUpRight size={14} aria-hidden="true" /></span>
			<span className="sr-only"> (opens in a new tab)</span>
		</a>
	);
}

export function SitemapView({ configuration, onSaved, onOpenModules, onReload }: SitemapViewProps) {
	const toasts = useSeoToasts();
	const [draft, setDraft] = React.useState<SitemapDraft>(() => draftFrom(configuration));
	const [baseline, setBaseline] = React.useState<SitemapDraft>(() => draftFrom(configuration));
	// A newer read never moves the revision unsaved choices started from, so saving them after a change elsewhere conflicts.
	const [draftRevision, setDraftRevision] = React.useState(configuration.revision);
	const [errors, setErrors] = React.useState<SeoAdminSitemapErrors>({});
	const [conflict, setConflict] = React.useState(false);
	const [unconfirmed, setUnconfirmed] = React.useState(false);
	const [reloading, setReloading] = React.useState(false);
	const [reloadFailed, setReloadFailed] = React.useState(false);
	const [busy, setBusy] = React.useState<"save" | "reset" | null>(null);
	const [resetOpen, setResetOpen] = React.useState(false);
	const dirty = !sameDraft(draft, baseline);
	useWorkspaceDraftHold("sitemap-choices", dirty || busy !== null || conflict || unconfirmed || reloading);
	const pageActive = useWorkspacePageActive();
	React.useEffect(() => {
		if (!pageActive) setResetOpen(false);
	}, [pageActive]);

	// A newer server configuration replaces the form only while nothing is unsaved.
	React.useEffect(() => {
		const next = draftFrom(configuration);
		if (sameDraft(draft, baseline) || sameDraft(draft, next)) setDraftRevision(configuration.revision);
		setBaseline(next);
		setDraft((current) => (sameDraft(current, baseline) ? next : current));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [configuration]);

	const owned = configuration.owner === "shipit";
	const corrupt = configuration.settings === "corrupt";
	const notice = owned ? AVAILABILITY_NOTICES[configuration.availability] : undefined;
	const planByCollection = new Map((configuration.plan ?? []).map((plan) => [plan.collection, plan]));
	const overlapKeys = new Set(configuration.overlaps.flatMap((overlap) => overlap.collections));
	const ruledKeys = new Set(configuration.noindexContentTypes ?? []);
	const fileCount = (configuration.plan ?? []).reduce((total, plan) => total + plan.files.length, 0);

	async function save() {
		if (unconfirmed || reloading) return;
		const values = { contentTypes: draft.contentTypes, excludedPaths: excludedLines(draft.excludedText) };
		const local = validateSeoAdminSitemapValues(values);
		if (!local.success) {
			setErrors(local.errors);
			return;
		}
		setBusy("save");
		setErrors({});
		try {
			const result = await saveSeoAdminSitemap(local.values, draftRevision, corrupt);
			if (result.success) {
				setConflict(false);
				setDraftRevision(result.sitemap.revision);
				const next = draftFrom(result.sitemap);
				setBaseline(next);
				setDraft(next);
				// The status beside Save reports the save; a toast would cover the action bar.
				onSaved(result.sitemap);
			} else {
				setConflict(result.conflict === true);
				setErrors(result.errors);
			}
		} catch {
			// A lost or failed response can follow a committed write, so only a fresh read shows what is stored.
			setUnconfirmed(true);
		} finally {
			setBusy(null);
		}
	}

	async function reset() {
		setBusy("reset");
		setErrors({});
		try {
			const result = await resetSeoAdminSitemap(configuration.revision);
			setResetOpen(false);
			if (result.success) {
				setConflict(false);
				setDraftRevision(result.sitemap.revision);
				const next = draftFrom(result.sitemap);
				setBaseline(next);
				setDraft(next);
				onSaved(result.sitemap);
				toasts.success("Sitemap defaults restored", "Pages and Posts are listed when they are public collections.");
			} else {
				setConflict(result.conflict === true);
				setErrors(result.errors);
			}
		} catch (error) {
			setErrors({ _form: error instanceof Error ? error.message : "Sitemap defaults could not be restored." });
		} finally {
			setBusy(null);
		}
	}

	async function reload() {
		if (reloading) return;
		setReloading(true);
		setReloadFailed(false);
		setErrors({});
		try {
			// The lock and the draft stay until a fresh read answers; only that read decides what is safe to show.
			const fresh = await onReload();
			if (!fresh) {
				setReloadFailed(true);
				return;
			}
			const next = draftFrom(fresh);
			setConflict(false);
			setUnconfirmed(false);
			setBaseline(next);
			// The same revision means nothing was stored, so the draft stays for an explicit Save.
			if (fresh.revision !== draftRevision) setDraft(next);
			setDraftRevision(fresh.revision);
		} finally {
			setReloading(false);
		}
	}

	const formLocked = busy !== null || unconfirmed || reloading || !configuration.writable;

	return (
		<div className="shipit-seo-sitemap-page">
			<div className="shipit-seo-sitemap-layout">
				<div className="shipit-seo-sitemap-main">
					<section className="shipit-seo-panel shipit-seo-sitemap-panel" aria-labelledby="seo-sitemaps-title">
						<div className="shipit-seo-section-heading">
							<div>
								<span className="shipit-seo-eyebrow">Discovery</span>
								<h2 id="seo-sitemaps-title">Sitemaps</h2>
							</div>
							<Badge variant={owned ? "success" : "secondary"}>{OWNER_LABELS[configuration.owner]}</Badge>
						</div>

						<p className="shipit-seo-sitemap-index-link">
							<span>Sitemap index:</span>{" "}
							{configuration.publicFiles.sitemapUrl
								? <PublicLink url={configuration.publicFiles.sitemapUrl} />
								: <code>/sitemap.xml</code>}
						</p>
						<p className="shipit-seo-sitemap-copy">
							Choose which public content types appear in /sitemap.xml and which exact addresses stay out.
							Leaving a page out of the sitemap does not add noindex, block crawling, unpublish it or restrict access.
						</p>

						{!owned ? (
							<Banner
								variant="alert"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="These choices do not change the public sitemap"
								description={ownerExplanation(configuration.owner, configuration.ownerDetail)}
								action={configuration.owner === "module-off"
									? <Button size="sm" variant="secondary" onClick={onOpenModules}>Open Feature controls</Button>
									: undefined}
							/>
						) : null}
						{notice ? (
							<Banner
								variant={notice.variant}
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title={notice.title}
								description={notice.description}
							/>
						) : null}
						{conflict ? (
							<Banner
								variant="alert"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="Sitemap settings changed elsewhere"
								description="Nothing was saved. Reload to review the latest choices; your unsaved edits will be discarded."
								action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={reloading} disabled={reloading} onClick={() => void reload()}>Reload latest</Button>}
							/>
						) : unconfirmed ? (
							<Banner
								variant="alert"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="Sitemap save not confirmed"
								description="The change may have been saved. Reload to read the saved choices before saving again. If the save did not land, your edits stay for another Save; otherwise the saved choices replace them."
								action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={reloading} disabled={reloading} onClick={() => void reload()}>Reload latest</Button>}
							/>
						) : errors._form ? (
							<Banner
								variant="error"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="Sitemap settings were not saved"
								description={errors._form}
							/>
						) : null}
						{reloadFailed ? <p className="shipit-seo-form-error" role="alert">The saved sitemap settings could not be read. Your edits are kept and saving stays off; choose Reload latest again.</p> : null}

						<fieldset className="shipit-seo-sitemap-types" aria-describedby="seo-sitemap-types-help">
							<legend>Content types</legend>
							<p id="seo-sitemap-types-help" className="shipit-seo-sitemap-copy">
								Select content types whose published pages anyone can open. If the site limits published
								pages to members or behind a password, leave that content type unselected or exclude
								those addresses; the sitemap cannot tell which published pages are restricted.
							</p>
							{configuration.groups.length ? (
								<div className="shipit-seo-sitemap-groups">
									{configuration.groups.map((group) => {
										const checked = draft.contentTypes[group.key] === true;
										const plan = planByCollection.get(group.key);
										const pattern = group.urlPattern ?? `/${group.key}/{slug}`;
										const blocked = !group.unique || overlapKeys.has(group.key);
										const ruled = ruledKeys.has(group.key);
										const files = owned && checked && checked === baseline.contentTypes[group.key]
											? sitemapFileLinks(configuration.publicFiles.origin, plan)
											: { urls: [], more: 0 };
										return (
											<div className="shipit-seo-sitemap-row" key={group.key}>
												<span className="shipit-seo-module-icon"><TreeStructure size={18} aria-hidden="true" /></span>
												<div>
													<Checkbox
														label={group.label}
														checked={checked}
														disabled={formLocked || (!checked && !group.unique)}
														onCheckedChange={(value) => setDraft((current) => ({
															...current,
															contentTypes: { ...current.contentTypes, [group.key]: value === true },
														}))}
													/>
													<span><code>{pattern}</code>{plan && checked === baseline.contentTypes[group.key]
														? ` · ${sitemapPlanSummary(plan)}`
														: ""}</span>
													{!group.unique ? (
														<span className="shipit-seo-sitemap-warning">This URL pattern has no {"{slug}"} or {"{id}"}, so entries can share one address. It cannot be listed.</span>
													) : overlapKeys.has(group.key) ? (
														<span className="shipit-seo-sitemap-warning">Its addresses can match another selected content type. Select only one of them.</span>
													) : null}
													{ruled ? (
														<span className="shipit-seo-sitemap-rule-note">A content type noindex rule in Indexing rules leaves this type out of the sitemap. This choice is kept for when the rule is removed.</span>
													) : null}
													{files.urls.length ? (
														<span className="shipit-seo-sitemap-files">
															{files.urls.map((url) => <PublicLink key={url} url={url}>{url.replace(/^https?:\/\/[^/]+/, "")}</PublicLink>)}
															{files.more ? <span>{`and ${files.more.toLocaleString("en")} more ${files.more === 1 ? "file" : "files"}`}</span> : null}
														</span>
													) : null}
												</div>
												{blocked && checked ? <Badge variant="error">Blocks the sitemap</Badge>
													: ruled && checked ? <Badge variant="warning">Noindex rule</Badge>
													: group.source === "default" ? <Badge variant="secondary">Default</Badge> : null}
											</div>
										);
									})}
								</div>
							) : (
								<Empty size="sm" title="No public content types" description="EmDash reports no routable collections for this site." />
							)}
							{owned && configuration.plan?.length ? (
								<p className="shipit-seo-sitemap-copy">
									Counts include every published entry. A file leaves out entries marked noindex, excluded paths and entries
									whose canonical URL points elsewhere; Preview shows why each entry is listed or left out.
								</p>
							) : null}
							{errors.contentTypes ? <p className="shipit-seo-sitemap-error" role="alert">{errors.contentTypes}</p> : null}
							{configuration.preservedKeys.length ? (
								<p className="shipit-seo-sitemap-note">
									Saved choices for content types that are not public here are kept unchanged: {configuration.preservedKeys.join(", ")}.
								</p>
							) : null}
						</fieldset>

						<Textarea
							label="Excluded paths"
							data-seo-setting="excludedPaths"
							description="One exact site path per line, such as /thank-you. Locale prefixes are part of the path. Wildcards, queries and full URLs are not accepted."
							rows={6}
							spellCheck={false}
							disabled={formLocked}
							value={draft.excludedText}
							error={errors.excludedPaths}
							placeholder={"/thank-you\n/campaign-preview"}
							onChange={(event) => setDraft((current) => ({ ...current, excludedText: event.target.value }))}
						/>

						<SettingsActionBar
							status={unconfirmed ? "Save not confirmed. Choose Reload latest before saving again." : dirty
								? "Unsaved changes. The public sitemap keeps the saved choices until you save."
								: configuration.updatedAt
									? `Saved ${readableDate(configuration.updatedAt)}.`
									: "Defaults: Pages and Posts are listed. Nothing is stored yet."}
							restore={(
								<Button
									type="button"
									variant="secondary-destructive"
									icon={ArrowCounterClockwise}
									disabled={formLocked || configuration.revision === null}
									onClick={() => setResetOpen(true)}
								>
									Restore defaults
								</Button>
							)}
							discardDisabled={busy !== null || unconfirmed || !dirty}
							onDiscard={() => { setDraft(baseline); setDraftRevision(configuration.revision); setErrors({}); }}
							saveLabel={corrupt ? "Replace stored settings" : "Save sitemap settings"}
							saveDisabled={formLocked || (!dirty && !corrupt)}
							saving={busy === "save"}
							onSave={() => void save()}
						/>
						{!configuration.writable ? (
							<p className="shipit-seo-sitemap-note">
								Saving is unavailable: this host cannot store sitemap settings with a revision check, or its content types could not be listed.
							</p>
						) : null}
					</section>
				</div>

				<aside className="shipit-seo-panel shipit-seo-sitemap-status" aria-labelledby="seo-sitemap-files-title">
					<span className="shipit-seo-module-icon"><TreeStructure size={20} aria-hidden="true" /></span>
					<h2 id="seo-sitemap-files-title">Public file</h2>
					<dl className="shipit-seo-details">
						<div>
							<dt>Sitemap index</dt>
							<dd>
								{configuration.publicFiles.sitemapUrl
									? <PublicLink url={configuration.publicFiles.sitemapUrl} />
									: <code>/sitemap.xml</code>}
							</dd>
						</div>
						<div>
							<dt>Served by</dt>
							<dd>{owned ? "This plugin" : OWNER_LABELS[configuration.owner]}</dd>
						</div>
						{owned && configuration.plan ? (
							<div>
								<dt>Files listed</dt>
								<dd>{fileCount.toLocaleString("en")} {fileCount === 1 ? "file" : "files"}, up to {configuration.pageSize.toLocaleString("en")} published entries each</dd>
							</div>
						) : null}
					</dl>
					<p className="shipit-seo-sitemap-note">
						{configuration.publicFiles.source === "site-identity"
							? "Addresses use the production URL from Local SEO's Website settings."
							: configuration.publicFiles.source === "emdash-site"
								? "Addresses use EmDash's site URL. Set the production URL in Local SEO's Website settings if the public site uses another address."
								: configuration.publicFiles.source === "astro-site"
									? "Addresses use the public site URL from the Astro configuration until a site URL is saved."
									: "Set the production URL in Local SEO's Website settings to publish sitemap addresses."}
					</p>
					{owned ? (
						<p className="shipit-seo-sitemap-copy">
							Saved changes apply to the next sitemap request. Browsers and shared caches may keep a file for up to 5 minutes.
						</p>
					) : null}
				</aside>
			</div>

			{owned && configuration.availability === "ready" && configuration.plan ? (
				<SitemapPreview configuration={configuration} />
			) : null}

			<Dialog.Root role="alertdialog" open={pageActive && resetOpen} onOpenChange={setResetOpen}>
				<Dialog size="sm" className="shipit-seo-delete-dialog">
					<Dialog.Title>Restore sitemap defaults?</Dialog.Title>
					<Dialog.Description>
						The stored choices and excluded paths are removed. Pages and Posts are listed when they are public
						collections; other content types stay out until you select them.
					</Dialog.Description>
					<div className="shipit-seo-dialog-actions">
						<Button type="button" variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button>
						<Button type="button" variant="destructive" loading={busy === "reset"} onClick={() => void reset()}>Restore defaults</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}

function SitemapPreview({ configuration }: { configuration: SeoAdminSitemapConfiguration }) {
	const plans = (configuration.plan ?? []).filter((plan) => plan.files.length > 0);
	const [position, setPosition] = React.useState<SitemapPreviewPosition>({ collection: plans[0]?.collection ?? null, fileIndex: 0 });
	const [filters, setFilters] = React.useState(initialSitemapExplorerFilters);
	const [searchText, setSearchText] = React.useState("");
	const [previous, setPrevious] = React.useState<SitemapPreviewSuccess | null>(null);
	const [refresh, setRefresh] = React.useState(0);
	const selection = sitemapPreviewSelection(plans, position);
	const scope = selection ? sitemapPreviewScope(configuration.revision, selection) : "";
	const request = selection ? sitemapExplorerRequest(selection, scope, filters) : null;
	const query = useQuery({
		queryKey: [...seoWorkspaceKeys.sitemap, "preview", scope, request, refresh],
		queryFn: ({ signal }) => previewSeoAdminSitemap(request!, { signal }),
		enabled: request !== null,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const response = query.data;
	React.useEffect(() => {
		if (request && response?.success && sitemapPreviewMatches(request, response)) setPrevious(response);
	}, [request?.collection, request?.after, request?.search, request?.status, request?.limit, response]);
	const failed = query.isError || response?.success === false;
	const denied = sitemapPreviewReadDenied(query.error);
	React.useEffect(() => { if (denied) setPrevious(null); }, [denied]);
	const display = request ? sitemapPreviewDisplay(request, response, previous, failed, denied) : null;
	const refreshFirstPage = () => {
		setFilters((current) => pageSitemapExplorer(current, scope, null));
		setRefresh((current) => current + 1);
	};
	const moveFile = (next: SitemapPreviewPosition) => {
		setPosition(next);
		setFilters((current) => pageSitemapExplorer(current, "", null));
	};

	if (!selection) {
		return (
			<section className="shipit-seo-panel shipit-seo-sitemap-panel" aria-labelledby="seo-sitemap-preview-title">
				<h2 id="seo-sitemap-preview-title">Explore sitemap</h2>
				<Empty size="sm" title="The sitemap lists no files" description="No selected content type has published entries." />
			</section>
		);
	}
	const result = display?.result;
	return (
		<section className="shipit-seo-panel shipit-seo-sitemap-panel shipit-seo-sitemap-explorer" aria-labelledby="seo-sitemap-preview-title">
			<div className="shipit-seo-section-heading">
				<div>
					<h2 id="seo-sitemap-preview-title">Explore sitemap</h2>
					<p className="shipit-seo-sitemap-copy">Review entries using saved settings.</p>
				</div>
				<Button size="sm" variant="secondary" icon={ArrowClockwise} aria-label="Refresh sitemap results from the first page" loading={query.isFetching} onClick={refreshFirstPage}>Refresh</Button>
			</div>
			<div className="shipit-seo-sitemap-explorer-controls">
				<div className="shipit-seo-sitemap-explorer-files">
					<Select<string>
						label="Content type"
						value={selection.collection}
						items={Object.fromEntries(plans.map((item) => [item.collection, item.label]))}
						onValueChange={(value) => { if (value) moveFile({ collection: value, fileIndex: 0 }); }}
					/>
					{selection.count > 1 ? (
						<div className="shipit-seo-sitemap-explorer-file-choice">
							<Select<string>
								label="Sitemap file"
								value={String(selection.index)}
								items={Object.fromEntries(Array.from({ length: selection.count }, (_, index) => [String(index), `File ${index + 1} of ${selection.count}`]))}
								onValueChange={(value) => { if (value !== null) moveFile({ collection: selection.collection, fileIndex: Number(value) }); }}
							/>
							<nav className="shipit-seo-sitemap-pager" aria-label="Sitemap files">
								<Button size="sm" variant="secondary" icon={CaretLeft} aria-label="Previous sitemap file" disabled={!selection.previous} onClick={() => selection.previous && moveFile(selection.previous)} />
								<Button size="sm" variant="secondary" icon={CaretRight} aria-label="Next sitemap file" disabled={!selection.next} onClick={() => selection.next && moveFile(selection.next)} />
							</nav>
						</div>
					) : null}
				</div>
				<div className="shipit-seo-sitemap-explorer-filters">
					<form className="shipit-seo-sitemap-explorer-search" role="search" aria-label="Search this sitemap file" onSubmit={(event) => {
						event.preventDefault();
						setFilters((current) => filterSitemapExplorer(current, { search: searchText.trim() }));
					}}>
						<Input label="Search this file" type="search" placeholder="URL, path, entry ID or canonical" maxLength={160} value={searchText} onChange={(event) => setSearchText(event.target.value)} />
						<Button type="submit" variant="secondary" icon={MagnifyingGlass}>Search</Button>
						{searchText || filters.search ? <Button type="button" variant="secondary" onClick={() => {
							setSearchText("");
							setFilters((current) => filterSitemapExplorer(current, { search: "" }));
						}}>Clear</Button> : null}
					</form>
					<Select<SitemapPreviewStatus> label="Status" value={filters.status} items={{ all: "All", included: "Listed", excluded: "Left out" }}
						onValueChange={(value) => { if (value) setFilters((current) => filterSitemapExplorer(current, { status: value })); }} />
				</div>
			</div>
			{query.isFetching ? <p className="shipit-seo-muted" role="status">Loading results for File {selection.index + 1} of {selection.count}</p> : null}
			{failed ? (
				<Banner variant="alert" title={display?.stale ? "These results need refreshing" : "The preview could not be loaded"}
					description={response?.success === false ? response.errors._form : query.error instanceof Error ? query.error.message : "Try refreshing this file."}
					action={<Button size="sm" variant="secondary" onClick={refreshFirstPage}>Refresh first page</Button>} />
			) : null}
			{result ? (
				<>
					<div className="shipit-seo-sitemap-explorer-summary">
						<p><strong>{result.total.toLocaleString("en")} {result.total === 1 ? "entry" : "entries"}</strong><span>{result.included.toLocaleString("en")} listed · {result.excluded.toLocaleString("en")} left out</span></p>
						{result.fileUrl ? <PublicLink url={result.fileUrl}>Open XML</PublicLink> : null}
					</div>
					{display?.stale ? <p className="shipit-seo-sitemap-explorer-stale" role="status">Showing earlier results for this file. The row counts and filters below describe those earlier results.</p> : null}
					{result.entries.length === 0 ? <Empty size="sm" title="No matching entries in this file" description="Clear the search, choose another status or select a different file." /> : (
						<div className="shipit-seo-table-wrap shipit-seo-table-wrap--fluid shipit-seo-table-wrap--sitemap">
							<Table>
								<Table.Header><Table.Row><Table.Head>Address</Table.Head><Table.Head>Status</Table.Head><Table.Head>Last modified</Table.Head></Table.Row></Table.Header>
								<Table.Body>
									{result.entries.map((entry) => (
										<Table.Row key={`${entry.id}:${entry.locale}`}>
											<Table.Cell>
												<code className="shipit-seo-sitemap-address">{entry.url ?? entry.path ?? entry.id}</code>
												<span className="shipit-seo-sitemap-entry-meta">
													{entry.locale}{entry.alternates ? ` · ${entry.alternates} language links` : ""}{entry.image ? " · image listed" : ""}{entry.canonical ? ` · canonical ${entry.canonical}` : ""}
												</span>
												<div className="shipit-seo-sitemap-entry-details">
													<span className="shipit-seo-sitemap-entry-status"><Badge variant={entry.status === "included" ? "success" : "secondary"}>{STATUS_LABELS[entry.status]}</Badge></span>
													<time dateTime={entry.lastmod ?? undefined}>Modified {readableDate(entry.lastmod)}</time>
												</div>
											</Table.Cell>
											<Table.Cell><Badge variant={entry.status === "included" ? "success" : "secondary"}>{STATUS_LABELS[entry.status]}</Badge></Table.Cell>
											<Table.Cell><time dateTime={entry.lastmod ?? undefined}>{readableDate(entry.lastmod)}</time></Table.Cell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</div>
					)}
					<div className="shipit-seo-sitemap-explorer-footer">
						<p className="shipit-seo-sitemap-copy" role="status">{sitemapPreviewRowsLabel(result)}</p>
						<div className="shipit-seo-sitemap-explorer-pagination">
							<Select<string> label="Rows per page" value={String(filters.limit)} items={{ "25": "25", "50": "50" }}
								onValueChange={(value) => { if (value === "25" || value === "50") setFilters((current) => filterSitemapExplorer(current, { limit: Number(value) as 25 | 50 })); }} />
							{result.previousCursor || result.nextCursor ? <nav className="shipit-seo-sitemap-pager" aria-label="Preview rows">
								<Button size="sm" variant="secondary" icon={CaretLeft} disabled={query.isFetching || Boolean(display?.stale) || !result.previousCursor} onClick={() => setFilters((current) => pageSitemapExplorer(current, scope, result.previousCursor))}>Previous rows</Button>
								<Button size="sm" variant="secondary" icon={CaretRight} disabled={query.isFetching || Boolean(display?.stale) || !result.nextCursor} onClick={() => setFilters((current) => pageSitemapExplorer(current, scope, result.nextCursor))}>Next rows</Button>
							</nav> : null}
						</div>
					</div>
				</>
			) : null}
		</section>
	);
}
