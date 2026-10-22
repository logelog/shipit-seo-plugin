import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Table } from "@cloudflare/kumo/components/table";
import { Toasty } from "@cloudflare/kumo/components/toast";
import { ApiResponseError, MediaPickerModal } from "@emdash-cms/admin";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowSquareOut,
  Eye,
  FileText,
  GlobeHemisphereWest,
  ImageSquare,
  MagnifyingGlass,
  Plus,
  ShareNetwork,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import type {
  SeoAdminConfiguration,
  SeoAdminContentScore,
  SeoAdminOverview,
  SeoAdminReadableSettings,
  SeoAdminSettingsErrors,
  SeoAdminSettings,
  SeoAdminSettingsField,
  SeoAdminSettingsValues,
  SeoAdminSitemapConfiguration,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { validateSeoAdminSettings } from "@shipitseo/emdash-plugin-seo/admin-contract";
import { MutationCache, QueryCache, QueryClient, QueryClientContext, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useSeoI18n } from "./i18n/index.ts";

import {
  fetchSeoAdminConfiguration,
  fetchSeoAdminEntryPreview,
  fetchSeoAdminOverview,
  fetchSeoAdminSettings,
  fetchSeoAdminSitemap,
  fetchSeoAdminTemplates,
  fetchSeoContentScores,
  resetSeoAdminSettings,
  saveSeoAdminSettings,
} from "./api.ts";
import { ModulesView, SchemaView } from "./configuration-views.tsx";
import { patchSchemaContentTypes } from "./schema-content-types-model.ts";
import { contentEditorUrl } from "./content-editor-url.ts";
import { LOCAL_MEDIA_PREFIX, selectedLocalMediaUrl } from "./local-media.ts";
import {
  BusinessIdentitySection,
  LocalSeoNavigation,
  cancelBusinessIdentityProfileFocus,
  refreshBusinessIdentity,
  requestBusinessIdentityFocus,
  usePublisherSource,
} from "./business-identity-view.tsx";
import type { PublisherProfileDestination } from "./business-identity-model.ts";
import { ContentScoringControls } from "./content-scoring-controls.tsx";
import {
  buildSeoAdminSearch,
  parseEntryRef,
  parseSeoAdminLocation,
  type SeoAdminLocationState,
  type SeoAdminView,
  type SeoWorkQueueScope,
} from "./content-extension-model.ts";
import { CrawlDiagnosticsView } from "./crawl-diagnostics-view.tsx";
import { IndexNowView } from "./indexnow-view.tsx";
import { OverviewView } from "./overview-view.tsx";
import { contentHealthFreshnessRefs, contentHealthScoreCell } from "./overview-model.ts";
import { MigrationView } from "./migration-view.tsx";
import { NotFoundView } from "./not-found-view.tsx";
import { PortabilityView } from "./portability-view.tsx";
import { PluginOverlapLine } from "./plugin-coexistence-view.tsx";
import {
  SEO_HOST_MANIFEST_KEY,
  createSeoPluginAvailabilityWatch,
  seoPluginDisabled,
  seoPluginManifestState,
} from "./plugin-availability-model.ts";
import { SeoPluginDisabledState } from "./plugin-disabled-view.tsx";
import { SeoBrandProvider, seoAdminBrandFromManifest } from "./brand-context.ts";
import {
  invalidateScoreData,
} from "./score-refresh.ts";
import { LlmsTxtView } from "./llms-txt-view.tsx";
import { RobotsHostSettingsContext, RobotsTxtView } from "./robots-txt-view.tsx";
import { SiteVerificationHostContext, SiteVerificationView } from "./site-verification-view.tsx";
import { CustomVerificationView } from "./custom-verification-view.tsx";
import { verificationHostVersion } from "../site-verification.ts";
import { SitemapView } from "./sitemap-view.tsx";
import { TemplatePreview, TemplatesView } from "./template-views.tsx";
import { nextTemplateStamp, type TemplatesRead } from "./metadata-templates-model.ts";
import { TrendsView } from "./trends-view.tsx";
import { WorkQueueView } from "./work-queue-view.tsx";
import {
  SEO_SETTINGS_UNREADABLE_VIEW,
  SEO_WORKSPACE_DRAFT_VIEWS,
  SEO_WORKSPACE_VIEW_LABELS,
  seoWorkspaceDraftHold,
  seoWorkspaceHiddenViews,
  seoWorkspaceMountedDraftViews,
  isSeoContractMismatchError,
  seoSettingsRestoredMessage,
  seoSettingsSourceLabel,
  seoSettingsUnreadableNotice,
  seoWorkspaceKeys,
  type SeoWorkspaceDraftHolds,
  type SeoWorkspaceDraftView,
} from "./workspace-model.ts";
import { SettingsActionBar } from "./settings-action-bar.tsx";
import {
  ContractMismatchScreen,
  SeoViewBoundary,
  ViewErrorState,
  ViewSkeleton,
  WorkspaceDraftProvider,
  WorkspacePageActiveProvider,
  WorkspaceNavigation,
  IndexingNavigation,
  focusSettingField,
  revealWorkspaceTop,
  useSeoToasts,
  type WorkspaceDraftReport,
} from "./workspace-shell.tsx";

import "./admin.css";
import { TaxonomyIndexingContainer } from "./taxonomy-indexing-container.tsx";
import { ContentTypeIndexingContainer } from "./content-type-indexing-container.tsx";
import { IndexingChoiceGroup, IndexingPendingState, IndexingSavedState } from "./indexing-rule-status.tsx";
import { indexingSitemapServing, rebaseIndexingNameLists, siteIndexingStatus } from "./indexing-rules-model.ts";
import "./indexing-settings.css";
import "./taxonomy-indexing-controls.css";
import "./workspace.css";
import "./schema-map.css";
import "./content-editor.css";

function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

/* ------------------------------------------------------------------ */
/* Shared workspace queries                                            */
/* ------------------------------------------------------------------ */

function useOverviewQuery(enabled = true) {
  return useQuery({
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryKey: seoWorkspaceKeys.overview,
    queryFn: () => fetchSeoAdminOverview(),
    retry: 1,
    staleTime: 20_000,
    enabled,
  });
}

function useSettingsQuery(enabled = true) {
  return useQuery({
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryKey: seoWorkspaceKeys.settings,
    queryFn: () => fetchSeoAdminSettings(),
    retry: 1,
    staleTime: 20_000,
    enabled,
  });
}

function useSitemapQuery(enabled = true) {
  return useQuery({
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryKey: seoWorkspaceKeys.sitemap,
    queryFn: () => fetchSeoAdminSitemap(),
    retry: 1,
    staleTime: 20_000,
    enabled,
  });
}

function useConfigurationQuery(enabled = true) {
  return useQuery({
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryKey: seoWorkspaceKeys.configuration,
    queryFn: () => fetchSeoAdminConfiguration(),
    retry: 1,
    staleTime: 20_000,
    enabled,
  });
}

function useTemplatesQuery() {
  return useQuery({
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryKey: seoWorkspaceKeys.templates,
    // Stamped when requested, so an older read never replaces a newer one.
    queryFn: async ({ signal }): Promise<TemplatesRead> => {
      const requestedAt = nextTemplateStamp();
      return { configuration: await fetchSeoAdminTemplates({ signal }), requestedAt };
    },
    retry: 1,
    staleTime: 20_000,
  });
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function OverviewContainer({ onOpenPriority, settings, hideNextStep }: { onOpenPriority: (view: SeoAdminView) => void; settings?: SeoAdminSettings; hideNextStep?: boolean }) {
  const query = useOverviewQuery();
  if (query.isPending) return <ViewSkeleton label="Loading the SEO overview..." />;
  if (query.isError) {
    return (
      <ViewErrorState
        title="SEO overview unavailable"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <OverviewView data={query.data} settings={settings} onOpenPriority={onOpenPriority} onRefresh={() => void query.refetch()} refreshing={query.isFetching} hideNextStep={hideNextStep} />;
}

/* ------------------------------------------------------------------ */
/* Content health                                                      */
/* ------------------------------------------------------------------ */

function EntryPreviewDialogBody({ previewRef }: { previewRef: string }) {
  const query = useQuery({
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryKey: seoWorkspaceKeys.entryPreview(previewRef),
		queryFn: ({ signal }) => fetchSeoAdminEntryPreview(previewRef, undefined, { signal }),
    retry: 1,
    staleTime: 15_000,
  });
  if (query.isPending) {
    return (
      <div className="shipit-seo-template-loading" role="status">
        Resolving entry metadata...
      </div>
    );
  }
  if (query.isError) {
    return (
      <ViewErrorState
        title="Preview unavailable"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data.success) {
    return (
      <p className="shipit-seo-form-error">
        {query.data.error === "not_found"
          ? "This content entry no longer exists."
          : "Preview could not be resolved."}
      </p>
    );
  }
	return <TemplatePreview preview={query.data.preview} loading={query.isFetching} />;
}

function ContentAudit({
  data,
  requestedRef,
  collection,
  onCollectionChange,
  checked,
  freshnessStatus,
  onOpenInTemplates,
}: {
  data: SeoAdminOverview;
  requestedRef: string | null;
  collection: string;
  onCollectionChange: (collection: string) => void;
  /** Stored-only results for this snapshot's rows, by ref; empty until fetched after mount. */
  checked: ReadonlyMap<string, SeoAdminContentScore>;
  freshnessStatus: string;
  onOpenInTemplates: (ref: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [previewRef, setPreviewRef] = React.useState<string | null>(null);
  const focusedItem = requestedRef
    ? data.content.find((item) => item.ref === requestedRef)
    : undefined;
  const requestedEntry = requestedRef ? parseEntryRef(requestedRef) : null;
	const previewItem = previewRef ? data.content.find((item) => item.ref === previewRef) : undefined;
  const previewEntry = previewRef ? parseEntryRef(previewRef) : null;

  React.useEffect(() => {
    if (!focusedItem) return;
    setQuery("");
  }, [focusedItem]);

  const filtered = data.content.filter((item) => {
		const matchesCollection = collection === "all" || item.collection === collection;
    const needle = query.trim().toLowerCase();
		return matchesCollection && (!needle || item.title.toLowerCase().includes(needle));
  });
	const collections = Array.from(new Set(data.content.map((item) => item.collection))).sort();
  const rows = filtered.map((item) => ({ item, score: contentHealthScoreCell(item, checked.get(item.ref)) }));

  return (
		<section className="shipit-seo-panel shipit-seo-content" aria-labelledby="seo-content-title">
      <div className="shipit-seo-content-head">
        <div>
					<span className="shipit-seo-eyebrow">{data.summary.sampleSize} recent saved scores</span>
          <h2 id="seo-content-title">Content health</h2>
					<p className="shipit-seo-muted">This is a sample of up to 50 recent saved scores, not the full content inventory. The 10 most recent rows of the selected type are checked against current content each time this view opens; other rows show their saved score. Results without a number, results from an earlier analyzer and results saved under earlier settings are not listed. Search and filters apply only to these rows.</p>
					<p className="shipit-seo-muted" role="status">{freshnessStatus}</p>
        </div>
        <div className="shipit-seo-filters">
          <label className="shipit-seo-search">
            <MagnifyingGlass size={16} aria-hidden="true" />
							<span className="sr-only">Search sampled scores</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
							placeholder="Search this sample"
            />
          </label>
          <label>
							<span className="sr-only">Filter sampled scores by content type</span>
						<select value={collection} onChange={(event) => onCollectionChange(event.target.value)}>
							<option value="all">All types in sample</option>
              {collections.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {requestedRef && !focusedItem ? (
        <div className="shipit-seo-content-focus-note" role="status">
          <div>
            <strong>This entry is outside the current audit sample.</strong>
            <span>Open the entry to see its stored score, or analyze its content in SEO score.</span>
          </div>
          {requestedEntry ? (
						<a href={contentEditorUrl(requestedEntry.collection, requestedEntry.entryId)}>
              Open entry
            </a>
          ) : null}
        </div>
      ) : null}
      {filtered.length ? (
        <div className="shipit-seo-table-wrap">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Content</Table.Head>
                <Table.Head>Type</Table.Head>
                <Table.Head>Score</Table.Head>
                <Table.Head>First issue</Table.Head>
                <Table.Head>Updated</Table.Head>
                <Table.Head>
                  <span className="sr-only">Open</span>
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map(({ item, score }) => (
                <Table.Row
                  key={item.ref}
                  className={
										item.ref === requestedRef ? "shipit-seo-content-row--focused" : undefined
                  }
                >
                  <Table.Cell>
                    <a
                      className="shipit-seo-content-link"
                      href={contentEditorUrl(item.collection, item.entryId)}
                    >
                      <strong>{item.title}</strong>
                    </a>
                    <div className="shipit-seo-mobile-meta">
                      <div>
												<Badge variant="secondary">{item.collectionLabel}</Badge>
                        <Badge variant={score.variant}>
                          {score.accessiblePrefix ? <span className="sr-only">{`${score.accessiblePrefix} `}</span> : null}
                          {score.badgeText}
                        </Badge>
                        <span>{score.label}</span>
                        {score.qualifier ? <small>{score.qualifier}</small> : null}
                      </div>
                      <p>{item.firstIssue}</p>
											<time dateTime={item.updatedAt}>{readableDate(item.updatedAt)}</time>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant="secondary">{item.collectionLabel}</Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="shipit-seo-score-cell">
                      <Badge variant={score.variant}>
                        {score.accessiblePrefix ? <span className="sr-only">{`${score.accessiblePrefix} `}</span> : null}
                        {score.badgeText}
                      </Badge>
                      <span className="shipit-seo-score-cell__label">{score.label}</span>
                      {score.qualifier ? <small>{score.qualifier}</small> : null}
                    </div>
                  </Table.Cell>
									<Table.Cell className="shipit-seo-issue">{item.firstIssue}</Table.Cell>
                  <Table.Cell>{readableDate(item.updatedAt)}</Table.Cell>
                  <Table.Cell>
                    <div className="shipit-seo-content-actions">
                      <button
                        type="button"
                        className="shipit-seo-open"
                        title={`Preview ${item.title}`}
                        onClick={() => setPreviewRef(item.ref)}
                      >
                        <Eye size={17} aria-hidden="true" />
                        <span className="sr-only">Preview {item.title}</span>
                      </button>
                      <a
                        className="shipit-seo-open"
                        href={contentEditorUrl(item.collection, item.entryId)}
                        title={`Edit ${item.title}`}
                      >
                        <ArrowSquareOut size={17} aria-hidden="true" />
                        <span className="sr-only">Edit {item.title}</span>
                      </a>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      ) : (
		<Empty
          size="sm"
          icon={<FileText size={32} aria-hidden="true" />}
					title={data.content.length ? "No matching scores in this sample" : "No recent scores for current settings"}
          description={
            data.content.length
							? "Adjust the search or content type filter."
							: "Use SEO score above to analyze a selected content type."
          }
        />
      )}

      <Dialog.Root
        open={Boolean(previewRef)}
        onOpenChange={(open) => {
          if (!open) setPreviewRef(null);
        }}
      >
        <Dialog size="lg" className="shipit-seo-content-preview-dialog">
          <Dialog.Title>{previewItem?.title ?? "Entry preview"}</Dialog.Title>
          <Dialog.Description>
						Resolved metadata from the live resolver, the same output scoring uses.
          </Dialog.Description>
					{previewRef ? <EntryPreviewDialogBody previewRef={previewRef} /> : null}
          <div className="shipit-seo-dialog-actions">
            {previewEntry ? (
              <Button
                type="button"
                variant="secondary"
                icon={ArrowSquareOut}
                onClick={() =>
                  window.location.assign(
                    contentEditorUrl(previewEntry.collection, previewEntry.entryId),
                  )
                }
              >
                Edit entry
              </Button>
            ) : null}
            {previewRef ? (
              <Button
                type="button"
                variant="secondary"
                icon={FileText}
                onClick={() => {
                  const ref = previewRef;
                  setPreviewRef(null);
                  if (ref) onOpenInTemplates(ref);
                }}
              >
                Open in Templates
              </Button>
            ) : null}
            <Dialog.Close
              render={(props) => (
                <Button {...props} type="button" variant="primary">
                  Close
                </Button>
              )}
            />
          </div>
        </Dialog>
      </Dialog.Root>
    </section>
  );
}

function ContentAuditContainer({
  requestedRef,
  onOpenInTemplates,
}: {
  requestedRef: string | null;
  onOpenInTemplates: (ref: string) => void;
}) {
  const query = useOverviewQuery();
  const [filter, setFilter] = React.useState<{ collection: string; focus?: SeoAdminOverview["content"][number] }>({ collection: "all" });
  const focusedItem = requestedRef ? query.data?.content.find((item) => item.ref === requestedRef) : undefined;
  // The focused row's type applies in the render that finds it, so no check goes out for the previous filter.
  const collection = focusedItem && focusedItem !== filter.focus ? focusedItem.collection : filter.collection;
  if (focusedItem !== filter.focus) setFilter({ collection, focus: focusedItem });
  const refs = contentHealthFreshnessRefs(
    query.data?.content.filter((item) => collection === "all" || item.collection === collection) ?? [],
    focusedItem?.ref,
  );
  const freshness = useQuery({
    queryKey: seoWorkspaceKeys.contentHealthFreshness(query.data?.generatedAt ?? "", refs),
    queryFn: ({ signal }) => fetchSeoContentScores({ refs, limit: refs.length, storedOnly: true, signal }),
    enabled: refs.length > 0 && !query.isFetching && !query.isError,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  // Only a result fetched since this view opened, not being replaced and not followed by a failed read,
  // describes current content. A failed refetch keeps the earlier data on the query.
  const checkedItems = freshness.isFetchedAfterMount && !freshness.isFetching && !freshness.isError ? freshness.data?.items : undefined;
  const checked = React.useMemo(() => new Map((checkedItems ?? []).map((item) => [item.ref, item])), [checkedItems]);
	if (query.isPending) return <ViewSkeleton label="Loading content scores..." />;
  if (query.isError) {
    return (
      <ViewErrorState
        title="Content health unavailable"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return (
    <ContentAudit
      data={query.data}
      requestedRef={requestedRef}
      collection={collection}
      onCollectionChange={(value) => setFilter((current) => ({ ...current, collection: value }))}
      checked={checked}
      freshnessStatus={freshness.isFetching
        ? "Checking recent rows against current content..."
        : freshness.isError ? "Current content could not be checked. Saved scores are shown." : ""}
      onOpenInTemplates={onOpenInTemplates}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Settings (Site identity / Search & social)                          */
/* ------------------------------------------------------------------ */

type SettingsChange = (field: SeoAdminSettingsField, value: string | string[] | boolean) => void;

interface SettingsViewProps {
  draft: SeoAdminSettingsValues;
  /** The stored values the draft started from. */
  saved: SeoAdminSettingsValues;
  hostSiteUrl: string;
  errors: SeoAdminSettingsErrors;
  dirty: boolean;
  saving: boolean;
  restoring: boolean;
  savedMessage: string | null;
  /** Set after a save whose outcome is unknown; every write stays off until onReload reads the stored settings. */
  reloadNotice: SettingsReloadNotice | null;
  source: Pick<SeoAdminReadableSettings, "state" | "updatedAt" | "legacyPresent">;
  onChange: SettingsChange;
  onReset: () => void;
  onRestore: () => Promise<SettingsRestoreOutcome>;
  onSave: () => Promise<void>;
  onReload: () => void;
  onOpenProfiles: (destination: PublisherProfileDestination | null) => void;
  onOpenIdentity: () => void;
  /** Opens another workspace page without a reload; the draft stays with its section. */
  onOpenView?: (view: SeoAdminView) => void;
  /** False while the section stays rendered behind another page; its reads are then passive. */
  active?: boolean;
}

type SettingsRestoreOutcome = { restored: true } | { restored: false; message: string };

interface SettingsReloadNotice {
  title: string;
  description: string;
  action: string;
  status: string;
  reloading: boolean;
  /** Set after a reload read failed; the draft and the lock stay until a read succeeds. */
  failure: string | null;
}

function SettingsReloadBanner({ notice, onReload }: { notice: SettingsReloadNotice; onReload: () => void }) {
  return (
    <>
      <Banner
        role="alert"
        variant="alert"
        icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
        title={notice.title}
        description={notice.description}
        action={<Button type="button" size="sm" variant="secondary" loading={notice.reloading} onClick={onReload}>{notice.action}</Button>}
      />
      {notice.failure ? <p className="shipit-seo-form-error" role="alert">{notice.failure}</p> : null}
    </>
  );
}

function SettingsActions({
  dirty,
  saving,
  restoring,
  savedMessage,
  reloadNotice,
  source,
  onReset,
  onRestore,
  saveLabel,
}: Pick<
  SettingsViewProps,
	"dirty" | "saving" | "restoring" | "savedMessage" | "reloadNotice" | "source" | "onReset" | "onRestore"
> & { saveLabel: string }) {
  const busy = saving || restoring || reloadNotice !== null;
  const stored = source.state === "saved" || source.state === "historical-seed";
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);
  // Closes only after a confirmed restore; a refusal stays visible in the dialog.
  const confirmRestore = async () => {
    setRestoreError(null);
    const outcome = await onRestore();
    if (outcome.restored) setRestoreOpen(false);
    else setRestoreError(outcome.message);
  };
  const restore = (
    <Dialog.Root
      role="alertdialog"
      open={restoreOpen}
      onOpenChange={(open) => {
        if (restoring) return;
        if (open) setRestoreError(null);
        setRestoreOpen(open);
      }}
    >
      <Dialog.Trigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            variant="secondary-destructive"
            icon={ArrowCounterClockwise}
            disabled={!stored || busy}
          >
            Restore inherited
          </Button>
        )}
      />
      <Dialog size="sm" className="shipit-seo-delete-dialog">
        <Dialog.Title>Restore inherited SEO settings?</Dialog.Title>
        <Dialog.Description>
					The site identity and social defaults return to the values inherited from legacy
					settings or the site and are saved with the current site-wide noindex setting, which
					does not change. The content type and taxonomy archive noindex rules in Indexing rules
					are kept. Content scoring is turned back on. The business identity is stored
					separately and is kept.
        </Dialog.Description>
        {restoreError ? (
          <p className="shipit-seo-form-error" role="alert">{restoreError}</p>
        ) : null}
        <div className="shipit-seo-dialog-actions">
          <Button type="button" variant="secondary" disabled={restoring} onClick={() => setRestoreOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={restoring}
            disabled={restoring}
            onClick={() => void confirmRestore()}
          >
            Restore inherited
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
  return (
    <SettingsActionBar
      status={reloadNotice?.status ?? savedMessage ?? (dirty ? "Unsaved changes" : seoSettingsSourceLabel(source, readableDate))}
      restore={restore}
      discardDisabled={!dirty || busy}
      onDiscard={onReset}
      saveLabel={saveLabel}
      saveDisabled={!dirty || busy}
      saving={saving}
    />
  );
}

function profileLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function previewImageUrl(imageUrl: string, siteUrl: string): string {
  if (!imageUrl) return "";
  try {
    if (imageUrl.startsWith(LOCAL_MEDIA_PREFIX) && typeof window !== "undefined") {
      return new URL(imageUrl, window.location.origin).href;
    }
    const image = new URL(imageUrl);
    if (image.protocol !== "http:" && image.protocol !== "https:") return "";
    let site: URL | null = null;
    try {
      site = siteUrl ? new URL(siteUrl) : null;
    } catch {
      site = null;
    }
    if (site && image.origin === site.origin && typeof window !== "undefined") {
			return new URL(`${image.pathname}${image.search}${image.hash}`, window.location.origin).href;
    }
    return image.href;
  } catch {
    return "";
  }
}

/** The saved Website values inside Local SEO; editing opens the Website form and its own save. */
function WebsiteSummaryCard({ overrides, onEdit }: { overrides: SettingsOverrides; onEdit: () => void }) {
  const query = useSettingsQuery();
  const values = query.data?.values ?? null;
  const unsaved = values !== null && (Object.keys(overrides) as Array<keyof SeoAdminSettingsValues>)
    .some((field) => JSON.stringify(values[field]) !== JSON.stringify(overrides[field]));
  return (
    <section className="shipit-seo-website-summary" aria-label="Website">
      <div>
        <span>Website</span>
        {values ? (
          <>
            <strong>{values.siteName || "No website name saved"}</strong>
            {values.siteUrl ? <code>{values.siteUrl}</code> : <span>No production URL saved</span>}
          </>
        ) : (
          <span role="status">{query.isError ? "Website settings could not be read." : query.isPending ? "Loading website settings" : "Website settings cannot be read."}</span>
        )}
        {unsaved ? <span>The Website form has unsaved changes.</span> : null}
      </div>
      <Button type="button" size="sm" variant="secondary" icon={GlobeHemisphereWest} onClick={onEdit}>
        Edit website
      </Button>
    </section>
  );
}

function SiteIdentitySettings(props: SettingsViewProps) {
  const {
    draft,
    errors,
    dirty,
    saving,
    restoring,
    savedMessage,
    reloadNotice,
    source,
    onChange,
    onReset,
    onRestore,
    onSave,
    onReload,
    onOpenView,
  } = props;
  return (
    <form
      className="shipit-seo-settings-layout"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <section
        className="shipit-seo-panel shipit-seo-settings-form"
        aria-labelledby="seo-identity-settings-title"
      >
        {onOpenView ? (
          <div className="shipit-seo-back-row">
            <Button type="button" size="sm" variant="ghost" icon={ArrowLeft} onClick={() => onOpenView("identity")}>
              Back to business identity
            </Button>
          </div>
        ) : null}
        <div className="shipit-seo-section-heading">
          <div>
            <span className="shipit-seo-eyebrow">Local SEO</span>
            <h2 id="seo-identity-settings-title">Website</h2>
          </div>
          <GlobeHemisphereWest size={20} aria-hidden="true" />
        </div>
        <p className="shipit-seo-muted">
          Set the website name and canonical address. Saving sends the site settings as they were loaded, with only your changes here, and is refused if they changed elsewhere in the meantime. The business identity has its own save.
        </p>
        <div className="shipit-seo-form-grid">
          <Input
            label="Website name"
            data-seo-setting="siteName"
            value={draft.siteName}
            required
            maxLength={120}
            error={errors.siteName}
            onChange={(event) => onChange("siteName", event.target.value)}
          />
          <Input
            label="Production site URL"
            data-seo-setting="siteUrl"
            type="url"
            placeholder="https://example.com"
            value={draft.siteUrl}
            required={false}
            description="Canonical and schema origin."
            error={errors.siteUrl}
            onChange={(event) => onChange("siteUrl", event.target.value)}
          />
        </div>
        {reloadNotice ? <SettingsReloadBanner notice={reloadNotice} onReload={onReload} />
          : errors._form ? <p className="shipit-seo-form-error">{errors._form}</p> : null}
        <SettingsActions
          {...{
            dirty,
            saving,
            restoring,
            savedMessage,
            reloadNotice,
            source,
            onReset,
            onRestore,
          }}
          saveLabel="Save website settings"
        />
      </section>
    </form>
  );
}

function SearchSocialSettings(props: SettingsViewProps) {
  const {
    draft,
    errors,
    dirty,
    saving,
    restoring,
    savedMessage,
    reloadNotice,
    source,
    onChange,
    onReset,
    onRestore,
    onSave,
    onReload,
    onOpenProfiles,
  } = props;
  const { profileDestination } = usePublisherSource();
  const previewSource = React.useMemo(
    () => previewImageUrl(draft.defaultSocialImage, draft.siteUrl),
    [draft.defaultSocialImage, draft.siteUrl],
  );
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const [imagePickerOpen, setImagePickerOpen] = React.useState(false);
  const [imagePickerError, setImagePickerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPreviewFailed(false);
  }, [previewSource]);

  return (
    <form
      className="shipit-seo-settings-layout"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <section
        className="shipit-seo-panel shipit-seo-settings-form"
        aria-labelledby="seo-search-social-title"
      >
        <div className="shipit-seo-section-heading">
          <div>
            <span className="shipit-seo-eyebrow">Site-wide defaults</span>
            <h2 id="seo-search-social-title">Search &amp; social</h2>
          </div>
          <ShareNetwork size={20} aria-hidden="true" />
        </div>
        <div className="shipit-seo-form-grid">
          <div className="shipit-seo-image-input">
            <Input
              label="Default social image URL"
              data-seo-setting="defaultSocialImage"
              type="text"
              placeholder="https://example.com/og-default.jpg"
              value={draft.defaultSocialImage}
              required={false}
              description="Fallback image when an entry has no social image."
              error={errors.defaultSocialImage}
              onChange={(event) => {
                setImagePickerError(null);
                onChange("defaultSocialImage", event.target.value);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              icon={ImageSquare}
              className="shipit-seo-image-picker-button"
              disabled={saving || restoring}
              onClick={() => {
                setImagePickerError(null);
                setImagePickerOpen(true);
              }}
            >
              Choose or upload image
            </Button>
            {imagePickerError ? (
              <p className="shipit-seo-form-error" role="alert">{imagePickerError}</p>
            ) : null}
          </div>
          <Input
            label="X card attribution"
            data-seo-setting="twitterHandle"
            placeholder="@example"
            value={draft.twitterHandle}
            required={false}
            maxLength={16}
            description="The @handle credited on X cards. Manage profile URLs in Local SEO."
            error={errors.twitterHandle}
            onChange={(event) => onChange("twitterHandle", event.target.value)}
          />
        </div>
        <div className="shipit-seo-profile-guidance">
          <h3>Official social and review profiles</h3>
          <p>Manage full profile URLs in Local SEO's Social tab. They identify the business or person and are separate from X card attribution.</p>
          <Button type="button" variant="secondary" onClick={() => onOpenProfiles(profileDestination)}>
            Open Local SEO profiles
          </Button>
        </div>
				{reloadNotice ? <SettingsReloadBanner notice={reloadNotice} onReload={onReload} />
					: errors._form ? <p className="shipit-seo-form-error">{errors._form}</p> : null}
        <SettingsActions
          {...{
            dirty,
            saving,
            restoring,
            savedMessage,
            reloadNotice,
            source,
            onReset,
            onRestore,
          }}
          saveLabel="Save search & social settings"
        />
      </section>

      <aside
        className="shipit-seo-panel shipit-seo-social-output"
        aria-labelledby="seo-social-output-title"
      >
        <div className="shipit-seo-section-heading">
          <div>
            <span className="shipit-seo-eyebrow">Fallback preview</span>
            <h2 id="seo-social-output-title">Social card</h2>
          </div>
          <ImageSquare size={20} aria-hidden="true" />
        </div>
        <div className="shipit-seo-social-preview">
          {previewSource && !previewFailed ? (
            <img
              src={previewSource}
              alt="Configured default social preview"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <div className="shipit-seo-social-image-empty">
              <ImageSquare size={24} aria-hidden="true" />
              <strong>{draft.defaultSocialImage ? "Image preview unavailable" : "No plugin default image"}</strong>
              <p>{draft.defaultSocialImage
                ? "Check the image URL or choose an image from your library."
                : "An entry image or EmDash's default may still apply. Choose a fallback for entries without their own image."}</p>
              <Button type="button" variant="secondary" disabled={saving || restoring} onClick={() => {
                setImagePickerError(null);
                setImagePickerOpen(true);
              }}>
                Choose or upload image
              </Button>
            </div>
          )}
          <div>
						<span>{draft.siteUrl ? profileLabel(draft.siteUrl) : "Production domain"}</span>
            <strong>{draft.siteName || "Site name"}</strong>
						<p>Entry-specific titles, descriptions, and images override these defaults.</p>
          </div>
        </div>
        {draft.twitterHandle ? <p className="shipit-seo-muted">X card attribution: {draft.twitterHandle}</p> : null}
      </aside>
      <MediaPickerModal
        open={imagePickerOpen}
        onOpenChange={setImagePickerOpen}
        mediaKind="image"
        mimeTypeFilters={["image/jpeg", "image/png", "image/webp", "image/gif"]}
        localOnly
        title="Choose default social image"
        onSelect={(item) => {
          const selectedUrl = selectedLocalMediaUrl(item.url);
          if (selectedUrl) {
            onChange("defaultSocialImage", selectedUrl);
            setImagePickerError(null);
          } else {
            setImagePickerError("This image could not be used. Choose another image.");
          }
          setImagePickerOpen(false);
        }}
      />
    </form>
  );
}

function IndexingSettings({
  draft, saved, errors, dirty, saving, restoring, savedMessage, reloadNotice, source,
  onChange, onReset, onSave, onReload, onOpenView, active = true,
}: SettingsViewProps) {
  const { locale, t } = useSeoI18n();
  const sitemap = useSitemapQuery(active);
  const busy = saving || restoring || reloadNotice !== null;
  const unconfirmed = reloadNotice !== null;
  const site = siteIndexingStatus(saved.noindex, draft.noindex);
  const serving = indexingSitemapServing(sitemap.data?.owner);
  const savedDate = source.updatedAt && !Number.isNaN(Date.parse(source.updatedAt))
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(source.updatedAt))
    : null;
  const status = saving ? t("indexing.status.saving")
    : reloadNotice ? reloadNotice.status
    : dirty ? t("indexing.status.unsaved")
    : savedMessage ?? (savedDate ? t("indexing.status.savedAt", { date: savedDate })
      : t("indexing.status.unchanged"));

  return (
    <form className="shipit-seo-panel shipit-seo-indexing-settings" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (dirty && !busy) void onSave();
    }} aria-labelledby="seo-indexing-title">
      <div className="shipit-seo-section-heading">
        <div>
          <h2 id="seo-indexing-title" tabIndex={-1}>{t("indexing.title")}</h2>
        </div>
      </div>
      <section className="shipit-seo-indexing-site" aria-labelledby="seo-indexing-site-title">
        <div className="shipit-seo-indexing-site__head">
          <h3 id="seo-indexing-site-title">{t("indexing.site.title")}</h3>
          <IndexingSavedState effect={site.saved} withSource={false} />
        </div>
        <div data-seo-setting="siteNoindex">
          <IndexingChoiceGroup legend={t("indexing.site.legend")} value={draft.noindex ? "noindex" : "index"} disabled={busy}
            onChange={(choice) => onChange("noindex", choice === "noindex")} />
        </div>
        <p className="shipit-seo-indexing-site__effect">{draft.noindex ? t("indexing.site.noindexEffect") : t("indexing.site.indexEffect")}</p>
        <IndexingPendingState effect={site.after} withSource={false} unconfirmed={unconfirmed} />
      </section>
      {errors.noindex ? <p className="shipit-seo-form-error" role="alert">{errors.noindex}</p> : null}
      {draft.noindex ? <p className="shipit-seo-indexing-override" role="note">{t("indexing.site.overrideNote")}</p> : null}
      <ContentTypeIndexingContainer selected={draft.contentTypeNoindex ?? []} saved={saved.contentTypeNoindex ?? []} disabled={busy} active={active}
        siteNoindex={draft.noindex} savedSiteNoindex={saved.noindex} unconfirmed={unconfirmed} validationError={errors.contentTypeNoindex}
        onChange={(names) => onChange("contentTypeNoindex", names)}
        onOpenSitemaps={onOpenView ? () => onOpenView("sitemap") : undefined} />
      <TaxonomyIndexingContainer selected={draft.taxonomyArchiveNoindex ?? []} saved={saved.taxonomyArchiveNoindex ?? []} disabled={busy} active={active}
        siteNoindex={draft.noindex} savedSiteNoindex={saved.noindex} unconfirmed={unconfirmed} validationError={errors.taxonomyArchiveNoindex}
        onChange={(names) => onChange("taxonomyArchiveNoindex", names)} />
      <details className="shipit-seo-indexing-help">
        <summary>{t("indexing.help.summary")}</summary>
        <div>
          <p>{t("indexing.precedence.description")}</p>
          <ol>
            <li><strong>{t("indexing.precedence.siteLabel")}</strong> {t("indexing.precedence.site")}</li>
            <li><strong>{t("indexing.precedence.typeLabel")}</strong> {t("indexing.precedence.type")}</li>
            <li><strong>{t("indexing.precedence.entryLabel")}</strong> {t("indexing.precedence.entry")}</li>
          </ol>
          <p>{t("indexing.precedence.optIn")}</p>
          <p>{t("indexing.help.sitemap")}</p>
          {serving ? <p>{serving === "served" ? t("indexing.help.sitemapServed") : t("indexing.help.sitemapNotServed")}</p> : null}
          <p>{t("indexing.help.archives")}</p>
          <p>{t("indexing.help.robots")}</p>
        </div>
      </details>
      {reloadNotice ? <SettingsReloadBanner notice={reloadNotice} onReload={onReload} />
        : errors._form ? <p className="shipit-seo-form-error" role="alert">{errors._form}</p> : null}
      <SettingsActionBar status={status} discardLabel={t("indexing.discard")} discardDisabled={!dirty || busy} onDiscard={onReset}
        saveLabel={t("indexing.save")} saveDisabled={!dirty || busy} saving={saving} />
    </form>
  );
}

type SettingsOverrides = Partial<SeoAdminSettingsValues>;

/**
 * One settings section with an independent draft: overrides for this section
 * are merged over the last saved values. Saving one section never commits
 * another section's unsaved overrides.
 */
function SettingsSectionContainer({
  section,
  overrides,
  onOverridesChange,
  onRestoredInherited,
  onScoreConfigurationChange,
  onOpenProfiles,
  onOpenIdentity,
  onOpenView,
  active = true,
}: {
  section: "identity" | "social" | "indexing";
  active?: boolean;
  onOpenProfiles: (destination: PublisherProfileDestination | null) => void;
  onOpenIdentity: () => void;
  onOpenView?: (view: SeoAdminView) => void;
  overrides: SettingsOverrides;
  onOverridesChange: React.Dispatch<React.SetStateAction<SettingsOverrides>>;
  onRestoredInherited: () => void;
  onScoreConfigurationChange: () => void;
}) {
  const { t } = useSeoI18n();
  const queryClient = useQueryClient();
  const toasts = useSeoToasts();
  const query = useSettingsQuery(active);
  const [errors, setErrors] = React.useState<SeoAdminSettingsErrors>({});
  const [saving, setSaving] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  const [savedNotice, setSavedNotice] = React.useState<{ kind: "saved" } | { kind: "restored"; message: string } | null>(null);
  const [fatalError, setFatalError] = React.useState<unknown>(null);
  const [reloadRequired, setReloadRequired] = React.useState(false);
  const [reloading, setReloading] = React.useState(false);
  const [reloadFailed, setReloadFailed] = React.useState(false);
  // A list override holds the whole list, so it stays relative to the stored values last shown: when
  // they change, from any read or another page's save, only its own added and removed names move onto
  // the newer lists.
  const storedValues = query.data?.values ?? null;
  const draftBase = React.useRef(storedValues);
  React.useLayoutEffect(() => {
    const base = draftBase.current;
    if (!storedValues || storedValues === base) return;
    draftBase.current = storedValues;
    if (base) onOverridesChange((current) => current.contentTypeNoindex || current.taxonomyArchiveNoindex
      ? rebaseIndexingNameLists(current, base, storedValues) : current);
  }, [storedValues, onOverridesChange]);
  // The form that replaces the error or unreadable page removes its focused Reload button, and focus
  // left on the page body then moves to the form heading.
  const reloadFocus = React.useRef(false);
  const formShown = !fatalError && !query.isPending && query.data?.values != null;
  React.useLayoutEffect(() => {
    if (!formShown || !reloadFocus.current) return;
    reloadFocus.current = false;
    if (active && typeof document !== "undefined" && (document.activeElement === null || document.activeElement === document.body)) {
      document.getElementById("seo-indexing-title")?.focus();
    }
  }, [formShown, active]);

	const sectionLabel = section === "indexing" ? t("indexing.title")
    : section === "identity" ? "Website" : "Search & social";
  const savedMessage = savedNotice?.kind === "saved"
    ? (section === "indexing" ? t("indexing.status.saved") : "SEO settings saved")
    : savedNotice?.message ?? null;
  const unconfirmedNotice = (): SettingsReloadNotice => section === "indexing" ? {
    title: t("indexing.unconfirmedTitle"),
    description: t("indexing.unconfirmedHelp"),
    action: t("indexing.reloadSaved"),
    status: t("indexing.status.unconfirmed"),
    reloading,
    failure: reloadFailed ? t("indexing.reloadFailed") : null,
  } : {
    title: `${sectionLabel} save not confirmed`,
    description: "The change may have been saved. Your draft is kept. Reload the saved settings before saving again.",
    action: "Reload saved settings",
    status: "Save not confirmed",
    reloading,
    failure: reloadFailed ? "The saved settings could not be read. Your draft is kept and saving stays off; reload the saved settings again." : null,
  };

  // Website and Search & social dialogs portal out of the hidden pane, so those sections render nothing
  // while hidden. Indexing rules has no dialog and stays rendered, which keeps its form mounted.
  if (!active && section !== "indexing") return null;

  if (fatalError) {
    return (
      <ContractMismatchScreen
        error={fatalError}
        onRetry={() => {
          setFatalError(null);
          void query.refetch();
        }}
      />
    );
  }
  if (query.isPending)
		return <ViewSkeleton label={section === "indexing" ? t("indexing.status.loading") : `Loading ${sectionLabel.toLowerCase()} settings...`} />;
  // A failed refresh keeps the page mounted, so an unconfirmed save keeps its lock and draft.
  if (query.isError && !query.data) {
    return (
      <ViewErrorState
        title={section === "indexing" ? t("indexing.unavailable") : "SEO settings unavailable"}
        error={query.error}
        onRetry={() => {
          reloadFocus.current = section === "indexing";
          void query.refetch();
        }}
        retryLabel={section === "indexing" ? t("indexing.retry") : undefined}
      />
    );
  }

  if (query.data.values === null) {
    const notice = seoSettingsUnreadableNotice(query.data);
    return (
      <Banner
        variant="error"
        icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
        title={section === "indexing" ? t("indexing.unreadableTitle") : notice.title}
        description={section === "indexing" ? `${t("indexing.unreadableHelp")} ${notice.description}` : notice.description}
        action={
          <Button size="sm" variant="secondary" onClick={() => {
            reloadFocus.current = section === "indexing";
            void query.refetch();
          }}>
            {section === "indexing" ? t("indexing.retry") : "Reload"}
          </Button>
        }
      />
    );
  }

  const settings = query.data;
  const draft: SeoAdminSettingsValues = { ...settings.values, ...overrides };
  const dirty = JSON.stringify(settings.values) !== JSON.stringify(draft);

  const updateSetting: SettingsChange = (field, value) => {
    onOverridesChange((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      delete next._form;
      return next;
    });
    setSavedNotice(null);
  };

  const resetSection = () => {
    onOverridesChange({});
    setErrors({});
    setSavedNotice(null);
  };

  const save = async () => {
    if (reloadRequired) return;
    const validation = validateSeoAdminSettings(draft);
    if (!validation.success) {
      setErrors(validation.errors);
      setSavedNotice(null);
      return;
    }
    setSaving(true);
    setErrors({});
    setSavedNotice(null);
    try {
      const result = await saveSeoAdminSettings(validation.values, settings);
      if (!result.success) {
        setErrors(result.errors);
        toasts.error(
          section === "indexing" ? t("indexing.status.saveFailed") : `${sectionLabel} settings not saved`,
          result.errors._form ?? "Fix the highlighted fields and try again.",
        );
        if (result.conflict) await query.refetch();
        return;
      }
      queryClient.setQueryData(seoWorkspaceKeys.settings, result.settings);
      onScoreConfigurationChange();
      onOverridesChange({});
      // The status beside Save reports the save; a toast would cover the action bar.
      setSavedNotice({ kind: "saved" });
      void refreshBusinessIdentity();
      // Content type rules change which sitemap files are listed.
      if (section === "indexing") void queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.sitemap });
      await queryClient.invalidateQueries({
        queryKey: seoWorkspaceKeys.overview,
      });
    } catch (cause) {
      if (isSeoContractMismatchError(cause)) {
        setFatalError(cause);
        return;
      }
      // A 4xx other than a timeout, conflict or rate limit is refused before anything is written.
      if (cause instanceof ApiResponseError && cause.status >= 400 && cause.status < 500 && ![408, 409, 429].includes(cause.status)) {
        setErrors({ _form: cause.message });
        toasts.error(section === "indexing" ? t("indexing.status.saveFailed") : `${sectionLabel} settings not saved`, cause.message);
        return;
      }
      // A lost or failed response can follow a committed write, so only a fresh read shows what is stored.
      setReloadRequired(true);
      const notice = unconfirmedNotice();
      toasts.error(notice.title, notice.description);
    } finally {
      setSaving(false);
    }
  };

  const reloadSaved = async () => {
    if (reloading) return;
    setReloading(true);
    setReloadFailed(false);
    const result = await query.refetch().finally(() => setReloading(false));
    // A failed read still returns the earlier snapshot, which says nothing about the unconfirmed save.
    if (result.isError) {
      setReloadFailed(true);
      return;
    }
    const stored = result.data?.values;
    if (!stored) return;
    // A newer revision means the unconfirmed save committed, so its follow-ups are owed.
    if (result.data?.revision !== settings.revision) {
      onScoreConfigurationChange();
      void refreshBusinessIdentity();
      if (section === "indexing") void queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.sitemap });
      void queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.overview });
    }
    // Overrides the stored settings already hold are a completed save, not a draft.
    onOverridesChange((current) =>
      JSON.stringify({ ...stored, ...current }) === JSON.stringify(stored) ? {} : current);
    setErrors({});
    setReloadRequired(false);
  };

  const restore = async (): Promise<SettingsRestoreOutcome> => {
    if (settings.revision === null) {
      return { restored: false, message: "No stored settings are loaded. Reload and try again." };
    }
    setRestoring(true);
    setErrors({});
    setSavedNotice(null);
    try {
      const result = await resetSeoAdminSettings(settings.revision);
      if (!result.success) {
        const message = result.errors._form ?? "Inherited settings were not restored.";
        setErrors(result.errors);
        toasts.error("Inherited settings not restored", message);
        if (result.conflict) await query.refetch();
        return { restored: false, message };
      }
      queryClient.setQueryData(seoWorkspaceKeys.settings, result.settings);
      onScoreConfigurationChange();
      onRestoredInherited();
      void refreshBusinessIdentity();
      const message = seoSettingsRestoredMessage(result);
      setSavedNotice({ kind: "restored", message });
      toasts.success("Inherited SEO settings restored", message);
      await queryClient.invalidateQueries({
        queryKey: seoWorkspaceKeys.overview,
      });
      return { restored: true };
    } catch (cause) {
      const detail =
				cause instanceof Error ? cause.message : "Failed to restore inherited SEO settings";
      if (isSeoContractMismatchError(cause)) {
        setFatalError(cause);
        return { restored: false, message: detail };
      }
      setErrors({ _form: detail });
      toasts.error("Inherited settings not restored", detail);
      return { restored: false, message: detail };
    } finally {
      setRestoring(false);
    }
  };

  const viewProps: SettingsViewProps = {
    draft,
    hostSiteUrl: settings.hostSiteUrl ?? "",
    errors,
    dirty,
    saving,
    restoring,
    savedMessage,
    reloadNotice: reloadRequired ? unconfirmedNotice() : null,
    saved: settings.values,
    source: settings,
    onChange: updateSetting,
    onReset: resetSection,
    onRestore: restore,
    onSave: save,
    onReload: () => void reloadSaved(),
    onOpenProfiles,
    onOpenIdentity,
    onOpenView,
    active,
  };

  return section === "indexing" ? (
    <IndexingSettings {...viewProps} />
  ) : section === "identity" ? (
    <SiteIdentitySettings {...viewProps} />
  ) : (
    <SearchSocialSettings {...viewProps} />
  );
}

/* ------------------------------------------------------------------ */
/* Remaining view containers                                           */
/* ------------------------------------------------------------------ */

function TemplatesContainer({
  requestedRef,
  onRequestedRefChange,
  onScoreConfigurationChange,
}: {
  requestedRef: string | null;
  onRequestedRefChange: (ref: string | null) => void;
  onScoreConfigurationChange: () => void;
}) {
  const queryClient = useQueryClient();
  const templatesQuery = useTemplatesQuery();
  if (templatesQuery.isPending) {
    return <ViewSkeleton label="Loading SEO templates..." />;
  }
  if (templatesQuery.isError) {
    return (
      <ViewErrorState
        title="SEO templates unavailable"
        error={templatesQuery.error}
        onRetry={() => void templatesQuery.refetch()}
      />
    );
  }
  return (
    <TemplatesView
      read={templatesQuery.data}
      reloading={templatesQuery.isFetching}
      onReload={() => void templatesQuery.refetch()}
      requestedRef={requestedRef}
      onRequestedRefChange={onRequestedRefChange}
      onChanged={() => {
        void invalidateScoreData(queryClient);
        onScoreConfigurationChange();
      }}
    />
  );
}

function ModulesContainer({
  onScoreConfigurationChange,
  onOpenIdentity,
  onOpenView,
}: {
  onScoreConfigurationChange: () => void;
  onOpenIdentity: () => void;
  onOpenView: (view: SeoAdminView, queueScope?: SeoWorkQueueScope) => void;
}) {
  const queryClient = useQueryClient();
  const query = useConfigurationQuery();
  if (query.isPending) return <ViewSkeleton label="Loading SEO modules..." />;
  // A failed refresh keeps the page mounted, so an unconfirmed save keeps its lock and draft.
  if (query.isError && !query.data) {
    return (
      <ViewErrorState
        title="SEO modules unavailable"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return (
    <ModulesView
      configuration={query.data.modules}
      onSaved={(modules) => {
        onScoreConfigurationChange();
        queryClient.setQueryData<SeoAdminConfiguration>(
          seoWorkspaceKeys.configuration,
          (current) => (current ? { ...current, modules } : current),
        );
				const sitemapModule = modules.items.find((item) => item.key === "sitemap");
        if (sitemapModule) {
          queryClient.setQueryData<SeoAdminSitemapConfiguration>(
            seoWorkspaceKeys.sitemap,
						(current) => (current ? { ...current, moduleEnabled: sitemapModule.enabled } : current),
          );
        }
      }}
      onOverviewRefresh={() =>
        queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.overview })
      }
      onReload={async () => {
        const next = await query.refetch();
        if (next.isError || !next.data) return null;
        // A newer revision means a save committed, so its follow-ups are owed.
        if (next.data.modules.revision !== query.data?.modules.revision) {
          onScoreConfigurationChange();
          void queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.sitemap });
          void queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.overview });
        }
        return next.data.modules;
      }}
      onOpenIdentity={onOpenIdentity}
      onOpenView={onOpenView}
    />
  );
}

function SchemaContainer({
  route,
  onRouteChange,
  onOpenIdentity,
  active,
  onScoreConfigurationChange,
}: {
  route: "schema" | "library";
  onRouteChange: (route: "schema" | "library") => void;
  onOpenIdentity: () => void;
  active: boolean;
  onScoreConfigurationChange: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useConfigurationQuery(active);
  const settings = useSettingsQuery(active);
  const publisher = usePublisherSource();
  React.useEffect(() => { if (active) void refreshBusinessIdentity(); }, [active]);
	if (query.isPending && !query.data) return <ViewSkeleton label="Loading schema configuration..." />;
  if (query.isError && !query.data) {
    return (
      <ViewErrorState
        title="Schema configuration unavailable"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) return null;
  return (
    <>
    {query.isError ? <ViewErrorState title="Schema refresh unavailable; drafts are kept" error={query.error} onRetry={() => void query.refetch()} /> : null}
    <SchemaView
      route={route}
      onRouteChange={onRouteChange}
      mapContext={{ settings: settings.isError ? null : settings.data ?? null, publisher: publisher.summary, publisherOutput: publisher.publisherOutput, refreshFailed: query.isError, onOpenIdentity }}
      active={active}
      configuration={query.data.schema}
      outputEnabled={query.data.modules.items.find((item) => item.key === "schema")?.enabled !== false}
      onReload={async () => (await query.refetch()).isSuccess}
      onSaved={(update) => {
        onScoreConfigurationChange();
        queryClient.setQueryData<SeoAdminConfiguration>(
          seoWorkspaceKeys.configuration,
          (current) => (current ? { ...current, schema: update(current.schema) } : current),
        );
      }}
      onContentTypesSaved={(contentTypes) => {
        onScoreConfigurationChange();
        queryClient.setQueryData<SeoAdminConfiguration>(
          seoWorkspaceKeys.configuration,
          (current) => patchSchemaContentTypes(current, contentTypes),
        );
      }}
      onOverviewRefresh={() =>
        queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.overview })
      }
    />
    </>
  );
}

function SitemapContainer({ onOpenModules }: { onOpenModules: () => void }) {
  const queryClient = useQueryClient();
  const query = useSitemapQuery();
	if (query.isPending) return <ViewSkeleton label="Loading sitemap settings..." />;
  // A failed refresh keeps the page mounted, so an unconfirmed save keeps its lock and draft.
  if (query.isError && !query.data) {
    return (
      <ViewErrorState
        title="Sitemap settings unavailable"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return (
    <SitemapView
      configuration={query.data}
			onSaved={(sitemap) => queryClient.setQueryData(seoWorkspaceKeys.sitemap, sitemap)}
      onOpenModules={onOpenModules}
      onReload={async () => {
        const next = await query.refetch();
        return next.isError || !next.data ? null : next.data;
      }}
    />
  );
}

function MigrationContainer({
  onContentConfigurationChange,
}: {
  onContentConfigurationChange: () => void;
}) {
  const queryClient = useQueryClient();
  const overview = useOverviewQuery();
  return (
    <MigrationView
      legacyCount={overview.data?.summary.legacyOverrides ?? 0}
      onOverviewRefresh={() => {
        onContentConfigurationChange();
        return queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.overview });
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Workspace shell                                                     */
/* ------------------------------------------------------------------ */

function SeoAdminWorkspace() {
  const queryClient = useQueryClient();
  const [location, setLocation] = React.useState<SeoAdminLocationState>(() =>
		parseSeoAdminLocation(typeof window === "undefined" ? "" : window.location.search),
  );
	const [templatePreviewRef, setTemplatePreviewRef] = React.useState<string | null>(null);
	const [identityOverrides, setIdentityOverrides] = React.useState<SettingsOverrides>({});
	const [socialOverrides, setSocialOverrides] = React.useState<SettingsOverrides>({});
  const [indexingOverrides, setIndexingOverrides] = React.useState<SettingsOverrides>({});
  const [settingsVisited, setSettingsVisited] = React.useState<Partial<Record<SeoAdminView, boolean>>>(() =>
    ["site", "social", "indexing"].includes(location.view) ? { [location.view]: true } : {});
  React.useEffect(() => {
    if (!["site", "social", "indexing"].includes(location.view)) return;
    setSettingsVisited((current) => current[location.view] ? current : { ...current, [location.view]: true });
  }, [location.view]);
  React.useEffect(() => {
    if (location.view === "identity") return;
    cancelBusinessIdentityProfileFocus();
  }, [location.view]);
  const workspaceRef = React.useRef<HTMLDivElement>(null);
  const previousView = React.useRef(location.view);
  React.useLayoutEffect(() => {
    if (previousView.current === location.view) return;
    previousView.current = location.view;
    if (workspaceRef.current) revealWorkspaceTop(workspaceRef.current);
  }, [location.view]);
  // Library is a tab of Schema with its own deep link, so both routes share one retained Schema owner.
  const schemaRoute = location.view === "schema" || location.view === "library";
  const [schemaVisited, setSchemaVisited] = React.useState(schemaRoute);
  React.useEffect(() => {
    if (schemaRoute) setSchemaVisited(true);
  }, [schemaRoute]);
  // A draft page stays mounted, hidden, only while one of its forms holds work.
  const [draftHolds, setDraftHolds] = React.useState<SeoWorkspaceDraftHolds>({});
  // Stable per page, so a report never re-runs a form's own effects.
  const [draftReporters] = React.useState(() => Object.fromEntries(SEO_WORKSPACE_DRAFT_VIEWS.map((draftView) => [draftView,
    (key: string, held: boolean) => setDraftHolds((current) => seoWorkspaceDraftHold(current, draftView, key, held))])) as Record<SeoWorkspaceDraftView, WorkspaceDraftReport>);
  const [migrationOpened, setMigrationOpened] = React.useState(location.view === "migration");
  React.useEffect(() => {
    if (location.view === "migration") setMigrationOpened(true);
  }, [location.view]);
  const resetScoreRefreshContinuation = React.useCallback(() => {
    queryClient.removeQueries({
      queryKey: seoWorkspaceKeys.workQueue,
    });
  }, [queryClient]);

  // Passive cache subscription: powers the header badge and nav counts
  // without forcing an overview request on views that do not need it.
  const passiveOverview = useOverviewQuery(false);
  const overviewData = passiveOverview.data ?? null;
  const hiddenViews = seoWorkspaceHiddenViews({ activeView: location.view, summary: overviewData?.summary, migrationOpened });
  // Settings saves and restores update the settings cache directly, so it wins
  // over the overview snapshot once either settings view has loaded.
  const passiveSettings = useSettingsQuery(false);
  const settingsUnreadable = passiveSettings.data
    ? passiveSettings.data.values === null
    : overviewData?.site.indexable === null;
  const siteNoindex = passiveSettings.data
    ? passiveSettings.data.values?.noindex === true
    : overviewData?.site.indexable === false;

  // Normalize the URL once without creating a history entry.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const search = buildSeoAdminSearch(
      window.location.search,
      location.view,
      location.ref,
      location.queueScope,
    );
    if (search === window.location.search) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search}${window.location.hash}`,
    );
    // Only on mount: later navigation pushes entries explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser back/forward traverses workspace views.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      setLocation(parseSeoAdminLocation(window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const selectView = React.useCallback(
    (nextView: SeoAdminView, options: { ref?: string | null; queueScope?: SeoWorkQueueScope } = {}) => {
      const nextRef =
				nextView === "content" ? (options.ref !== undefined ? options.ref : location.ref) : null;
      const nextQueueScope = nextView !== "queue" ? "all"
        : options.queueScope ?? (location.view === "queue" ? location.queueScope : "all");
      if (
        nextView === location.view &&
        nextRef === location.ref &&
        nextQueueScope === location.queueScope
      )
        return;
      setLocation({ view: nextView, ref: nextRef, queueScope: nextQueueScope });
      if (typeof window === "undefined") return;
			const search = buildSeoAdminSearch(window.location.search, nextView, nextRef, nextQueueScope);
      if (search === window.location.search) return;
      window.history.pushState(
        window.history.state,
        "",
        `${window.location.pathname}${search}${window.location.hash}`,
      );
    },
    [location],
  );

  const openProfiles = (_destination: PublisherProfileDestination | null) => {
    requestBusinessIdentityFocus("profiles");
    selectView("identity");
  };
  const openIdentity = () => {
    requestBusinessIdentityFocus();
    selectView("identity");
  };

  const selectQueueScope = React.useCallback(
    (queueScope: SeoWorkQueueScope) => {
			if (location.view !== "queue" || queueScope === location.queueScope) return;
      setLocation({ view: "queue", ref: null, queueScope });
      if (typeof window === "undefined") return;
			const search = buildSeoAdminSearch(window.location.search, "queue", null, queueScope);
      if (search === window.location.search) return;
      window.history.pushState(
        window.history.state,
        "",
        `${window.location.pathname}${search}${window.location.hash}`,
      );
    },
    [location],
  );

  const view = location.view;

  return (
    <div className="shipit-seo-admin" ref={workspaceRef}>
      <div className="shipit-seo-workspace-shell">
        <WorkspaceNavigation
          value={view}
          counts={{ content: overviewData?.summary.needsAttention ?? 0 }}
          hiddenViews={hiddenViews}
          onChange={(next) => selectView(next)}
        />
        <div className="shipit-seo-workspace-content" data-view={view}>
          <IndexingNavigation value={view} hiddenViews={hiddenViews} onChange={(next) => selectView(next)} />
          {view === "identity" ? <LocalSeoNavigation /> : null}
          {settingsUnreadable && view !== "social" && view !== "site" && view !== "indexing" ? (
            <Banner
              variant="error"
              title="SEO settings cannot be read"
              description={`Public pages get no SEO metadata from this plugin until the settings can be read. Open ${SEO_WORKSPACE_VIEW_LABELS[SEO_SETTINGS_UNREADABLE_VIEW]} for details.`}
              action={
                <Button type="button" size="sm" variant={view === "overview" ? "primary" : "secondary"} onClick={() => selectView(SEO_SETTINGS_UNREADABLE_VIEW)}>
                  {view === "overview" ? "Review settings" : `Open ${SEO_WORKSPACE_VIEW_LABELS[SEO_SETTINGS_UNREADABLE_VIEW]}`}
                </Button>
              }
            />
          ) : null}
          {siteNoindex && view !== "indexing" ? (
            <Banner
              variant="alert"
              title="Search engines are told not to index supported pages"
              description={view === "overview" ? "This plugin adds noindex, nofollow metadata to supported pages. Keep this preference if intentional." : "This plugin adds noindex, nofollow metadata site-wide. Review it in Indexing when the site should appear in search results."}
              action={
                <Button type="button" size="sm" variant={view === "overview" ? "primary" : "secondary"} onClick={() => selectView("indexing")}>
                  {view === "overview" ? "Review visibility" : "Open Indexing"}
                </Button>
              }
            />
          ) : null}
          <PluginOverlapLine view={view} onOpenModules={() => selectView("modules")} />
          <SeoViewBoundary resetKey={view}>
            {view === "overview" ? <OverviewContainer onOpenPriority={selectView} settings={passiveSettings.data} hideNextStep={settingsUnreadable || siteNoindex} /> : null}
            {view === "content" ? (
              <>
                <ContentScoringControls onOpenSettings={() => selectView(SEO_SETTINGS_UNREADABLE_VIEW)}
                  onOpenFeatureControls={() => { selectView("modules"); focusSettingField("automaticAnalysis"); }} />
                <ContentAuditContainer
                  requestedRef={location.ref}
                  onOpenInTemplates={(ref) => {
                    setTemplatePreviewRef(ref);
                    selectView("templates");
                  }}
                />
              </>
            ) : null}
            {view === "queue" ? (
							<WorkQueueView scope={location.queueScope} onScopeChange={selectQueueScope} />
            ) : null}
            {view === "trends" ? <TrendsView /> : null}
            {view === "crawl" ? <CrawlDiagnosticsView /> : null}
            {view === "monitor404" ? (
              <NotFoundView onOpenModules={() => selectView("modules")} />
            ) : null}
            {view === "templates" ? (
              <TemplatesContainer
                requestedRef={templatePreviewRef}
                onRequestedRefChange={setTemplatePreviewRef}
                onScoreConfigurationChange={resetScoreRefreshContinuation}
              />
            ) : null}
            {view === "identity" ? (
              <BusinessIdentitySection onOpenSiteSettings={() => selectView("site")} showStepNavigation={false}
                websiteSummary={<WebsiteSummaryCard overrides={identityOverrides} onEdit={() => selectView("site")} />} />
            ) : null}
            {view === "migration" ? (
							<MigrationContainer onContentConfigurationChange={resetScoreRefreshContinuation} />
            ) : null}
            {view === "portability" ? (
              <PortabilityView
                onApplied={() => {
                  resetScoreRefreshContinuation();
                  return queryClient.invalidateQueries({
                    queryKey: seoWorkspaceKeys.all,
                  });
                }}
              />
            ) : null}
          </SeoViewBoundary>
          {(["site", "social", "indexing"] as const).map((settingsView) =>
            settingsVisited[settingsView] || view === settingsView ? (
              <div key={settingsView} className="shipit-seo-settings-pane" data-settings-view={settingsView} hidden={view !== settingsView}>
                <SeoViewBoundary resetKey={`settings-${settingsView}`}>
                  <SettingsSectionContainer
                    active={view === settingsView}
                    section={settingsView === "site" ? "identity" : settingsView}
                    onOpenProfiles={openProfiles}
                    onOpenIdentity={openIdentity}
                    onOpenView={(next) => selectView(next)}
                    overrides={settingsView === "site" ? identityOverrides : settingsView === "social" ? socialOverrides : indexingOverrides}
                    onOverridesChange={settingsView === "site" ? setIdentityOverrides : settingsView === "social" ? setSocialOverrides : setIndexingOverrides}
                    onScoreConfigurationChange={resetScoreRefreshContinuation}
                    onRestoredInherited={() => {
                      setIdentityOverrides({});
                      setSocialOverrides({});
                    }}
                  />
                </SeoViewBoundary>
              </div>
            ) : null,
          )}
          {seoWorkspaceMountedDraftViews(view, draftHolds).map((draftView) => (
            <div key={draftView} className="shipit-seo-draft-pane" data-draft-view={draftView} hidden={view !== draftView}>
              <SeoViewBoundary resetKey={`draft-${draftView}`}>
                <WorkspaceDraftProvider value={draftReporters[draftView]}>
                  <WorkspacePageActiveProvider value={view === draftView}>
                  {draftView === "modules" ? (
										<ModulesContainer onScoreConfigurationChange={resetScoreRefreshContinuation} onOpenIdentity={() => selectView("identity")}
											onOpenView={(next, queueScope) => selectView(next, queueScope ? { queueScope } : {})} />
                  ) : draftView === "sitemap" ? (
                    <SitemapContainer onOpenModules={() => selectView("modules")} />
                  ) : draftView === "robots" ? <RobotsTxtView />
                    : draftView === "llms" ? <LlmsTxtView />
                    : draftView === "indexnow" ? <IndexNowView />
                    : <div className="shipit-seo-verification-page"><SiteVerificationView /><CustomVerificationView /></div>}
                  </WorkspacePageActiveProvider>
                </WorkspaceDraftProvider>
              </SeoViewBoundary>
            </div>
          ))}
            {schemaVisited || schemaRoute ? (
              <div className="shipit-seo-schema-pane" hidden={!schemaRoute}>
                <SeoViewBoundary resetKey="schema"><SchemaContainer route={view === "library" ? "library" : "schema"} onRouteChange={(next) => selectView(next)} onOpenIdentity={() => selectView("identity")} active={schemaRoute} onScoreConfigurationChange={resetScoreRefreshContinuation} /></SeoViewBoundary>
              </div>
            ) : null}
        </div>
      </div>
    </div>
  );
}

function SeoAdminPage() {
  // The host admin's client, outside this page's own provider. Its settings
  // pages cache EmDash's site settings under ["settings"] (admin 1.1.0).
  const hostQueryClient = React.useContext(QueryClientContext);
  const invalidateHostSettings = React.useCallback(() => {
    void hostQueryClient?.invalidateQueries({ queryKey: ["settings"] });
  }, [hostQueryClient]);
  // The host loads its admin manifest before any plugin page; reading the cache sends nothing.
  const verificationHost = React.useMemo(() => ({
    hostVersion: verificationHostVersion(hostQueryClient?.getQueryData(["manifest"])),
    onSettingsChanged: invalidateHostSettings,
  }), [hostQueryClient, invalidateHostSettings]);
  // EmDash still renders this page while the plugin is disabled; only its manifest flag and route answers say so.
  const subscribeHostManifest = React.useCallback(
    (notify: () => void) => hostQueryClient ? hostQueryClient.getQueryCache().subscribe(notify) : () => {},
    [hostQueryClient],
  );
  const readHostManifest = React.useCallback(() => hostQueryClient?.getQueryData(SEO_HOST_MANIFEST_KEY), [hostQueryClient]);
  const hostManifest = React.useSyncExternalStore(subscribeHostManifest, readHostManifest, readHostManifest);
  const brand = React.useMemo(() => seoAdminBrandFromManifest(hostManifest), [hostManifest]);
  const [availability] = React.useState(() => createSeoPluginAvailabilityWatch(() => {
    void hostQueryClient?.invalidateQueries({ queryKey: SEO_HOST_MANIFEST_KEY, refetchType: "all" });
  }));
  const routeMissing = React.useSyncExternalStore(availability.subscribe, availability.routeMissing, availability.routeMissing);
  const disabled = seoPluginDisabled(seoPluginManifestState(hostManifest), routeMissing);
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: availability.report }),
        mutationCache: new MutationCache({ onError: availability.report }),
        defaultOptions: {
          queries: {
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SeoBrandProvider value={brand}>
        <RobotsHostSettingsContext.Provider value={invalidateHostSettings}>
          <SiteVerificationHostContext.Provider value={verificationHost}>
            <Toasty>
              {disabled ? <SeoPluginDisabledState /> : <SeoAdminWorkspace />}
            </Toasty>
          </SiteVerificationHostContext.Provider>
        </RobotsHostSettingsContext.Provider>
      </SeoBrandProvider>
    </QueryClientProvider>
  );
}

export const pages = {
  "/seo": SeoAdminPage,
};

export { contentEditorPanels, contentListColumns } from "./content-extension-registration.ts";
