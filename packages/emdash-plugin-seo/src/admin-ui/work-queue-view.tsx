import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { useQuery } from "@tanstack/react-query";
import { ArrowSquareOut, ListChecks } from "@phosphor-icons/react";
import {
	auditSeoContent,
	fetchSeoAdminConfiguration,
	fetchSeoAdminContentOptions,
	fetchSeoAuditContentOptions,
	fetchSeoContentScores,
} from "./api.ts";
import { contentEditorUrl } from "./content-editor-url.ts";
import {
	buildSeoWorkQueue,
	analysisPresentation,
	scoreBadgeVariant,
	scorePresentationBadgeText,
	seoWorkQueueEmptyState,
	seoWorkQueueScoreCoverage,
	summarizeSeoWorkQueue,
	type SeoImageQueueAvailability,
	type SeoWorkQueueItem,
	type SeoWorkQueueScope,
} from "./content-extension-model.ts";
import { loadSeoWorkQueueScores } from "./work-queue-data.ts";
import {
	createSeoSessionAudit,
	changedSeoSessionAuditRefs,
	mergeSeoSessionAudit,
	nextSeoSessionAuditRefs,
	SEO_SESSION_AUDIT_BATCH_LIMIT,
	SEO_SESSION_AUDIT_RETAIN_LIMIT,
} from "./session-audit-model.ts";
import { seoWorkspaceKeys } from "./workspace-model.ts";
import { ViewErrorState } from "./workspace-shell.tsx";

const ISSUE_FILTERS = {
	all: "All issues",
	fail: "Failing checks",
	review: "Needs review",
	priority: "High priority",
} as const;

type IssueFilter = keyof typeof ISSUE_FILTERS;

type QueueSource = "stored" | "session";

interface AuditPageRequest {
	collection: string;
	cursor?: string;
	number: number;
}

const QUEUE_SOURCES: Record<QueueSource, string> = {
	stored: "Stored analysis",
	session: "Session audit",
};

const SCOPE_FILTERS: Record<SeoWorkQueueScope, string> = {
	all: "All issues",
	images: "Image alt checks",
};

function issueVariant(item: SeoWorkQueueItem) {
	return item.check.status === "fail" ? "error" : "warning";
}

function collectionLabel(value: string) {
	return value
		.split(/[-_]/g)
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function matchesIssueFilter(item: SeoWorkQueueItem, filter: IssueFilter) {
	if (filter === "all") return true;
	if (filter === "priority") {
		return item.check.severity === "critical" || item.check.severity === "high";
	}
	return item.check.status === filter;
}

function issueCountLabel(value: number, scope: SeoWorkQueueScope) {
	const subject = scope === "images" ? "image review" : "open issue";
	return `${value} ${subject}${value === 1 ? "" : "s"}`;
}

function QueueSummary({ items }: { items: readonly SeoWorkQueueItem[] }) {
	const summary = React.useMemo(() => summarizeSeoWorkQueue(items), [items]);
	return (
		<dl className="shipit-seo-queue-summary" aria-label="Work queue summary">
			<div><dt>Affected content</dt><dd>{summary.affectedContent}</dd></div>
			<div><dt>Failing checks</dt><dd>{summary.failing}</dd></div>
			<div><dt>Needs review</dt><dd>{summary.review}</dd></div>
			<div><dt>High priority</dt><dd>{summary.highPriority}</dd></div>
		</dl>
	);
}

interface WorkQueueViewProps {
	scope: SeoWorkQueueScope;
	onScopeChange(scope: SeoWorkQueueScope): void;
}

export function WorkQueueView({ scope, onScopeChange }: WorkQueueViewProps) {
	const [query, setQuery] = React.useState("");
	const [issueFilter, setIssueFilter] = React.useState<IssueFilter>("all");
	const [collection, setCollection] = React.useState("all");
	const [scoreCursor, setScoreCursor] = React.useState<string | undefined>();
	const [scorePageNumber, setScorePageNumber] = React.useState(1);
	const [issuePageNumber, setIssuePageNumber] = React.useState(1);
	const [source, setSource] = React.useState<QueueSource>("session");
	const [session, setSession] = React.useState(createSeoSessionAudit);
	const [auditRunning, setAuditRunning] = React.useState(false);
	const auditController = React.useRef<AbortController | null>(null);
	const pageController = React.useRef<AbortController | null>(null);
	const [contentPage, setContentPage] = React.useState<Awaited<ReturnType<typeof fetchSeoAuditContentOptions>> | null>(null);
	const [pageRequest, setPageRequest] = React.useState<AuditPageRequest | null>(null);
	const activePageRequest = React.useRef<AuditPageRequest | null>(null);
	const [pageLoading, setPageLoading] = React.useState(false);
	const [pageError, setPageError] = React.useState<Error | null>(null);
	const [returnCheck, setReturnCheck] = React.useState<string | null>(null);
	const sessionMode = source === "session";

	React.useEffect(() => () => {
		auditController.current?.abort();
		pageController.current?.abort();
	}, []);

	const auditCollectionsQuery = useQuery({
		queryKey: ["shipit-seo", "audit-content-options", "collections"],
		queryFn: ({ signal }) => fetchSeoAuditContentOptions({ signal }),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
		enabled: sessionMode,
	});
	const contentCollectionsQuery = useQuery({
		queryKey: seoWorkspaceKeys.contentOptionPage(null),
		queryFn: () => fetchSeoAdminContentOptions(),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
		enabled: !sessionMode,
	});
	const inventory = React.useMemo(
		() => (contentPage?.items ?? []).slice(0, SEO_SESSION_AUDIT_BATCH_LIMIT),
		[contentPage],
	);
	const nextRefs = nextSeoSessionAuditRefs(
		inventory.filter((item) => item.collection === collection).map((item) => item.ref),
		session.attemptedRefs,
	);
	const sessionScores = React.useMemo(
		() => session.entries.flatMap((entry) => entry.score ? [entry.score] : []),
		[session.entries],
	);
	const inventoryByRef = React.useMemo(
		() => new Map(inventory.map((item) => [item.ref, item])),
		[inventory],
	);

	function clearContentPage() {
		activePageRequest.current = null;
		auditController.current?.abort();
		auditController.current = null;
		pageController.current?.abort();
		pageController.current = null;
		setAuditRunning(false);
		setContentPage(null);
		setPageRequest(null);
		setPageError(null);
		setPageLoading(false);
		setReturnCheck(null);
	}

	async function loadContentPage(selectedCollection: string, cursor?: string, number = 1) {
		if (auditController.current || selectedCollection === "all") return;
		pageController.current?.abort();
		const controller = new AbortController();
		pageController.current = controller;
		const request = { collection: selectedCollection, cursor, number };
		activePageRequest.current = request;
		setContentPage(null);
		setPageRequest(request);
		setPageLoading(true);
		setPageError(null);
		setReturnCheck(null);
		try {
			const page = await fetchSeoAuditContentOptions({ collection: selectedCollection, cursor, signal: controller.signal });
			if (!controller.signal.aborted) setContentPage(page);
		} catch (error) {
			if (!controller.signal.aborted) {
				setPageError(error instanceof Error ? error : new Error("Could not load this content page."));
			}
		} finally {
			if (!controller.signal.aborted) {
				pageController.current = null;
				setPageLoading(false);
			}
		}
	}

	const runAudit = React.useCallback(async (refs: readonly string[]) => {
		if (auditController.current || pageController.current || refs.length === 0) return;
		const selectedRefs = Array.from(new Set(refs)).slice(0, SEO_SESSION_AUDIT_BATCH_LIMIT);
		const controller = new AbortController();
		auditController.current = controller;
		setAuditRunning(true);
		try {
			const response = await auditSeoContent(selectedRefs, { signal: controller.signal });
			if (!controller.signal.aborted) {
				setSession((previous) => mergeSeoSessionAudit(previous, selectedRefs, response));
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				const message = error instanceof Error ? error.message : "Analysis failed. Try again.";
				setSession((previous) => mergeSeoSessionAudit(previous, selectedRefs, {
					items: [],
					failures: selectedRefs.map((ref) => ({ ref, error: message })),
				}));
			}
		} finally {
			if (!controller.signal.aborted) {
				auditController.current = null;
				setAuditRunning(false);
			}
		}
	}, []);

	const configurationQuery = useQuery({
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		queryKey: seoWorkspaceKeys.configuration,
		queryFn: () => fetchSeoAdminConfiguration(),
		retry: 1,
		staleTime: 20_000,
		enabled: scope === "images",
	});
	const imageModule = configurationQuery.data?.modules.items.find(
		(item) => item.key === "imageSeo",
	);
	const imageAvailability: SeoImageQueueAvailability =
		scope !== "images"
			? "enabled"
			: imageModule
				? imageModule.enabled
					? "enabled"
					: "disabled"
				: configurationQuery.isPending
					? "loading"
					: "unavailable";
	const canLoadScores =
		scope !== "images" || imageAvailability === "enabled";

	React.useEffect(() => {
		async function recheckChangedContent() {
			if (!sessionMode || !canLoadScores || !pageRequest || !contentPage ||
				activePageRequest.current !== pageRequest || auditController.current || pageController.current) return;
			const retainedRefs = new Set(sessionScores.map((score) => score.ref));
			if (!contentPage.items.some((item) => retainedRefs.has(item.ref))) return;
			const controller = new AbortController();
			pageController.current = controller;
			setPageLoading(true);
			setPageError(null);
			setReturnCheck("Checking this page for content updates...");
			try {
				const page = await fetchSeoAuditContentOptions({ collection: pageRequest.collection, cursor: pageRequest.cursor, signal: controller.signal });
				if (controller.signal.aborted || activePageRequest.current !== pageRequest) return;
				setContentPage(page);
				const changed = changedSeoSessionAuditRefs(page.items, sessionScores);
				pageController.current = null;
				setPageLoading(false);
				setReturnCheck(changed.length
					? `Detected ${changed.length} changed ${changed.length === 1 ? "entry" : "entries"} on this page; only those entries are rechecked.`
					: "Previously analyzed entries on this page are unchanged; their results were reused.");
				if (changed.length) await runAudit(changed);
			} catch (error) {
				if (!controller.signal.aborted && activePageRequest.current === pageRequest) {
					setPageError(error instanceof Error ? error : new Error("Could not check this page for updates."));
					setReturnCheck(null);
				}
			} finally {
				if (!controller.signal.aborted && activePageRequest.current === pageRequest) {
					if (pageController.current === controller) pageController.current = null;
					setPageLoading(false);
				}
			}
		}
		const handleFocus = () => { void recheckChangedContent(); };
		window.addEventListener("focus", handleFocus);
		return () => window.removeEventListener("focus", handleFocus);
	}, [canLoadScores, contentPage, pageRequest, runAudit, sessionMode, sessionScores]);

	const scoresQuery = useQuery({
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		queryKey: seoWorkspaceKeys.workQueueCollection(collection, scoreCursor),
		queryFn: ({ signal }) =>
			loadSeoWorkQueueScores({
				collection,
				cursor: scoreCursor,
				fetchContentScores: (options) => fetchSeoContentScores({ ...options, signal }),
			}),
		retry: 1,
		staleTime: 20_000,
		enabled: canLoadScores && !sessionMode && collection !== "all",
	});
	const scores = scoresQuery.data ?? null;
	const scoreCoverage = React.useMemo(
		() => seoWorkQueueScoreCoverage(sessionMode ? sessionScores : scores?.items ?? []),
		[scores, sessionMode, sessionScores],
	);
	const currentScores = scoreCoverage.currentScores;
	const imageStatusFailed =
		imageAvailability === "unavailable" && configurationQuery.isError;
	const loading =
		imageAvailability === "loading" ||
		(sessionMode ? auditRunning || pageLoading || auditCollectionsQuery.isPending :
			contentCollectionsQuery.isPending ||
			(canLoadScores && collection !== "all" && (scoresQuery.isPending || scoresQuery.isFetching)));
	const hasAnalyzedContent = currentScores.length > 0;
	const hasUsableAnalysis =
		hasAnalyzedContent &&
		(scope !== "images" || imageAvailability === "enabled");

	const queue = React.useMemo(
		() => buildSeoWorkQueue(currentScores, scope, imageAvailability),
		[currentScores, scope, imageAvailability],
	);
	const collectionItems = React.useMemo(() => {
		const items: Record<string, string> = { all: "Choose content type" };
		const definitions = sessionMode
			? auditCollectionsQuery.data?.collections
			: contentCollectionsQuery.data?.collections;
		for (const item of definitions ?? []) {
			items[item.collection] = item.label;
		}
		for (const value of Array.from(new Set(currentScores.map((item) => item.collection))).sort()) {
			items[value] ??= collectionLabel(value);
		}
		return items;
	}, [currentScores, sessionMode, auditCollectionsQuery.data, contentCollectionsQuery.data]);
	const filtered = React.useMemo(() => {
		const needle = query.trim().toLowerCase();
		return queue.filter((item) =>
			(collection === "all" || item.collection === collection) &&
			matchesIssueFilter(item, issueFilter) &&
			(!needle || [
				item.title,
				item.check.label,
				item.check.detail,
				item.check.recommendation,
			].some((value) => value.toLowerCase().includes(needle))),
		);
	}, [collection, issueFilter, query, queue]);
	React.useEffect(() => setIssuePageNumber(1), [query, issueFilter, collection, scoreCursor, scope, source, scores, sessionScores]);
	const issuePageCount = Math.max(1, Math.ceil(filtered.length / 100));
	const issuePage = Math.min(issuePageNumber, issuePageCount);
	const issueStart = (issuePage - 1) * 100;
	const visible = filtered.slice(issueStart, issueStart + 100);
	const storedEmptyState = seoWorkQueueEmptyState(
		queue.length,
		scoreCoverage.state,
		scope,
		imageAvailability,
	);
	const emptyState = !sessionMode && collection === "all"
		? {
			title: "Choose a content type",
			description: "Select a content type to load its stored analysis and prioritized issues.",
		}
		: sessionMode && imageAvailability === "enabled"
		? hasAnalyzedContent
			? {
				title: queue.length ? "No issues match these filters"
					: scope === "images" ? "No missing-alt issues found" : "No issues found in the analyzed content",
				description: scope === "images" && !queue.length
					? "No missing-alt issues were found in the retained session results. Empty-alt intent and image quality still need review."
					: "This reflects the retained session results and selected scope. Recheck an entry after saving changes.",
			}
			: {
				title: session.entries.length ? "No successful analysis yet" : "Start a session audit",
				description: session.entries.length
					? "Review the failed entries below and retry their analysis."
					: "Analyze up to 25 entries at a time to find content fixes without saving scores.",
			}
		: storedEmptyState;
	const failedEntries = session.entries.filter((entry) => entry.error);

	return (
		<section
			className="shipit-seo-panel shipit-seo-work-queue"
			aria-busy={loading}
			aria-labelledby="seo-work-queue-title"
		>
			<div className="shipit-seo-queue-head">
				<div>
					<span className="shipit-seo-eyebrow">{scope === "images" ? "Accessibility and search" : "Prioritized content fixes"}</span>
					<h2 id="seo-work-queue-title">{scope === "images" ? "Image alt review" : "Work queue"}</h2>
				</div>
				{hasUsableAnalysis ? (
					<Badge variant="secondary">{issueCountLabel(queue.length, scope)}</Badge>
				) : null}
			</div>

			{!sessionMode && loading && scores ? (
				<span className="sr-only" role="status" aria-live="polite">Updating the SEO work queue...</span>
			) : null}

			<div className="shipit-seo-queue-banner">
				<Select<QueueSource>
					label="Analysis source"
					value={source}
					items={QUEUE_SOURCES}
					disabled={auditRunning}
					onValueChange={(next) => {
						if (next) {
							clearContentPage();
							setSource(next);
							setCollection("all");
							setScoreCursor(undefined);
							setScorePageNumber(1);
						}
					}}
				/>
			</div>
			<div className="shipit-seo-queue-filters">
				<Input
					label="Search work queue"
					value={query}
					placeholder="Content or issue"
					onChange={(event) => setQuery(event.target.value)}
				/>
				<Select<SeoWorkQueueScope>
					label="Scope"
					value={scope}
					items={SCOPE_FILTERS}
					onValueChange={(next) => next && onScopeChange(next)}
				/>
				<Select<IssueFilter>
					label="Issue priority"
					value={issueFilter}
					items={ISSUE_FILTERS}
					onValueChange={(next) => next && setIssueFilter(next)}
				/>
				<Select<string>
					label="Content type"
					value={collection}
					items={collectionItems}
					disabled={auditRunning}
					onValueChange={(next) => {
						if (!next) return;
						clearContentPage();
						setCollection(next);
						setScoreCursor(undefined);
						setScorePageNumber(1);
						if (sessionMode && next !== "all") void loadContentPage(next);
					}}
				/>
			</div>

			{sessionMode ? (
				<div className="shipit-seo-queue-banner shipit-seo-queue-intro">
					<p><strong>Session audit</strong> analyzes current content on demand. Results stay in this open workspace and clear when you leave or reload it. Stored scores and Trends are unchanged.</p>
					<p>Editors open in a new tab. The audit rechecks changed entries when you return from the editor, using only the current page and reusing unchanged results. Use manual Recheck after changing SEO settings.</p>
					{auditCollectionsQuery.isError ? (
						<ViewErrorState title="Content types unavailable" error={auditCollectionsQuery.error} onRetry={() => void auditCollectionsQuery.refetch()} />
					) : pageError && pageRequest ? (
						<ViewErrorState title="Content page unavailable" error={pageError} onRetry={() => void loadContentPage(pageRequest.collection, pageRequest.cursor, pageRequest.number)} />
					) : (
						<p className="shipit-seo-queue-limit">
							{auditCollectionsQuery.isPending ? "Loading content types..." : collection === "all"
								? "Choose a content type to load one page of up to 25 entries."
								: pageLoading ? "Loading this content page..."
									: `Page ${pageRequest?.number ?? 1}: ${inventory.length} entries from ${collectionItems[collection] ?? collection}.`}
							{" "}Only this selected page is loaded. Further pages load when you choose Next content page.
						</p>
					)}
					<div className="shipit-seo-queue-actions">
						<Button type="button" variant="primary" disabled={auditRunning || pageLoading || !contentPage || !canLoadScores || nextRefs.length === 0} onClick={() => void runAudit(nextRefs)}>
							Analyze this page
						</Button>
						<Button type="button" variant="secondary" disabled={auditRunning || pageLoading || !contentPage?.hasMore || !contentPage.cursor} onClick={() => {
							if (contentPage?.cursor) void loadContentPage(collection, contentPage.cursor, (pageRequest?.number ?? 1) + 1);
						}}>
							Next content page
						</Button>
						<Button type="button" variant="secondary" disabled={auditRunning || pageLoading || !canLoadScores || session.lastBatchRefs.length === 0} onClick={() => void runAudit(session.lastBatchRefs)}>
							Recheck last batch
						</Button>
						<Button type="button" variant="secondary" disabled={auditRunning || pageLoading || session.attemptedRefs.length === 0} onClick={() => setSession(createSeoSessionAudit())}>
							Reset session
						</Button>
					</div>
					<p role="status" aria-live="polite" className="shipit-seo-queue-limit">
						{auditRunning ? "Analyzing this batch. No other batch will start automatically." : session.lastBatch
							? `Last batch: ${session.lastBatch.analyzed} analyzed, ${session.lastBatch.failed} failed. `
							: "Analysis starts only when you choose a batch. "}
						{!auditRunning && !pageLoading && contentPage
							? nextRefs.length ? `This page has ${nextRefs.length} unattempted entries.` : "No unattempted entries remain on this page. Recheck, retry failures, or choose another page."
							: null}
					</p>
					{returnCheck ? <p role="status" className="shipit-seo-queue-limit">{returnCheck}</p> : null}
					<p className="shipit-seo-queue-limit">
						{sessionScores.length} analyzed entry results and {failedEntries.length} failed entries retained. Coverage is limited to the entries you chose to analyze. Only the latest {SEO_SESSION_AUDIT_RETAIN_LIMIT} entry results are retained. Results reflect each entry when it was last checked.
					</p>
					{failedEntries.length ? (
						<div role="status" className="shipit-seo-queue-banner">
							<strong>Analysis failed for {failedEntries.length} entries</strong>
							<ul>
								{failedEntries.map((entry) => (
									<li key={entry.ref}>
										<strong>{inventoryByRef.get(entry.ref)?.title ?? entry.ref}</strong>: {entry.error}{" "}
										<Button type="button" size="sm" variant="secondary" disabled={auditRunning || pageLoading || !canLoadScores} onClick={() => void runAudit([entry.ref])}>Retry</Button>
									</li>
								))}
							</ul>
						</div>
					) : null}
				</div>
			) : (
				<div className="shipit-seo-queue-banner shipit-seo-queue-intro">
					<p>Choose a content type to load stored analysis. Choose Session audit to analyze current content without saving scores.</p>
					{collection !== "all" ? (
						<p className="shipit-seo-queue-limit">Page {scorePageNumber} of {collectionItems[collection] ?? collection}. Stored scores load lowest first, up to 100 per page. Outdated scores are hidden; issue ranking and totals cover this page only.</p>
					) : null}
					{scores?.hasMore && scores.items.length === 0 ? (
						<p className="shipit-seo-queue-limit">This page has no current stored scores. Continue to the next page for more entries.</p>
					) : null}
					{scorePageNumber > 1 ? (
						<Button type="button" variant="secondary" onClick={() => {
							setScoreCursor(undefined);
							setScorePageNumber(1);
						}}>First score page</Button>
					) : null}
					{scores?.hasMore && scores.cursor ? (
						<Button type="button" variant="secondary" disabled={scoresQuery.isFetching} onClick={() => {
							setScoreCursor(scores.cursor);
							setScorePageNumber((number) => number + 1);
						}}>Next score page</Button>
					) : null}
				</div>
			)}

			{hasUsableAnalysis ? <QueueSummary items={queue} /> : null}
			{!sessionMode && canLoadScores && scoreCoverage.state === "mixed" ? (
				<p className="shipit-seo-queue-limit" role="status">
					Some content is omitted because its stored analysis is out of date. Refresh scores before treating this queue as complete.
				</p>
			) : null}

			{!sessionMode && contentCollectionsQuery.isError ? (
				<div className="shipit-seo-queue-banner">
					<ViewErrorState title="Content types unavailable" error={contentCollectionsQuery.error} onRetry={() => void contentCollectionsQuery.refetch()} />
				</div>
			) : imageStatusFailed ? (
				<div className="shipit-seo-queue-banner">
					<ViewErrorState
						title="Image alt check status unavailable"
						error={configurationQuery.error}
						onRetry={() => void configurationQuery.refetch()}
					/>
				</div>
			) : !sessionMode && canLoadScores && scoresQuery.isError ? (
				<div className="shipit-seo-queue-banner">
					<ViewErrorState
						title="Work queue unavailable"
						error={scoresQuery.error}
						onRetry={() => void scoresQuery.refetch()}
					/>
				</div>
			) : !sessionMode && loading && !scores && imageAvailability !== "loading" ? (
				<div className="shipit-seo-queue-loading" role="status" aria-live="polite">
					<span>Loading prioritized issues...</span>
				</div>
			) : visible.length ? (
				<ol className="shipit-seo-queue-list">
					{visible.map((item, index) => (
						<li key={item.id} className={`shipit-seo-queue-item shipit-seo-queue-item--${item.check.status}`}>
							<div className="shipit-seo-queue-rank" aria-hidden="true">{issueStart + index + 1}</div>
							<div className="shipit-seo-queue-body">
								<div className="shipit-seo-queue-title">
									<a href={contentEditorUrl(item.collection, item.entryId)} target={sessionMode ? "_blank" : undefined} rel={sessionMode ? "noopener noreferrer" : undefined}>{item.title}{sessionMode ? <span className="sr-only"> (opens in a new tab)</span> : null}</a>
									<div>
										<span title={[item.presentation.label, item.presentation.qualifier].filter(Boolean).join(". ")}><Badge variant={scoreBadgeVariant(item.presentation)}>{scorePresentationBadgeText(item.score, item.presentation)}</Badge></span>
										<Badge variant={issueVariant(item)}>{item.check.severity}</Badge>
									</div>
								</div>
								<div className="shipit-seo-queue-meta">
									<span>{collectionLabel(item.collection)}</span>
									<span>{item.check.category}</span>
									<strong>{item.check.label}</strong>
								</div>
								<p>{item.check.detail}</p>
								{scope === "images" && typeof item.check.evidence.actual === "string" && item.check.evidence.actual ? (
									<div className="shipit-seo-queue-location">
										<strong>Detected at</strong>
										<code>{item.check.evidence.actual}</code>
									</div>
								) : null}
								<div className="shipit-seo-queue-next">
									<strong>Next action</strong>
									<span>{item.check.recommendation}</span>
								</div>
								{sessionMode ? <Button type="button" size="sm" variant="secondary" disabled={auditRunning || pageLoading || !canLoadScores} onClick={() => void runAudit([item.ref])}>Recheck {item.title}</Button> : null}
							</div>
							<a
								className="shipit-seo-open shipit-seo-queue-open"
								href={contentEditorUrl(item.collection, item.entryId)}
								title={`Edit ${item.title}`}
								target={sessionMode ? "_blank" : undefined}
								rel={sessionMode ? "noopener noreferrer" : undefined}
							>
								<ArrowSquareOut size={18} aria-hidden="true" />
								<span className="sr-only">Edit {item.title}{sessionMode ? " (opens in a new tab)" : ""}</span>
							</a>
						</li>
					))}
				</ol>
			) : (
				<div className="shipit-seo-queue-empty">
					<Empty
						size="sm"
						icon={<ListChecks size={32} aria-hidden="true" />}
						title={emptyState.title}
						description={emptyState.description}
					/>
				</div>
			)}

			{filtered.length > 0 ? (
				<div className="shipit-seo-queue-banner">
					<p className="shipit-seo-queue-limit">Showing issues {issueStart + 1}-{issueStart + visible.length} of {filtered.length} matching issues{sessionMode ? " in this session." : " on this score page."}</p>
					{issuePage > 1 ? (
						<>
							<Button type="button" variant="secondary" onClick={() => setIssuePageNumber(1)}>First issue page</Button>
							<Button type="button" variant="secondary" onClick={() => setIssuePageNumber(issuePage - 1)}>Previous issue page</Button>
						</>
					) : null}
					{issuePage < issuePageCount ? (
						<Button type="button" variant="secondary" onClick={() => setIssuePageNumber(issuePage + 1)}>Next issue page</Button>
					) : null}
				</div>
			) : null}
			{sessionMode && sessionScores.length ? (
				<details>
					<summary>Analyzed entries ({sessionScores.length})</summary>
					<p className="shipit-seo-queue-limit">Entries stay here after their issues are resolved, so you can recheck them again.</p>
					<ul>
						{sessionScores.map((item) => (
							<li key={item.ref}>
								<a href={contentEditorUrl(item.collection, item.entryId)} target="_blank" rel="noopener noreferrer">{item.title}<span className="sr-only"> (opens in a new tab)</span></a>{" "}
								<span>{scorePresentationBadgeText(item.score, analysisPresentation(item))}</span>{" "}
								<Button type="button" size="sm" variant="secondary" disabled={auditRunning || pageLoading || !canLoadScores} onClick={() => void runAudit([item.ref])}>Recheck</Button>
							</li>
						))}
					</ul>
				</details>
			) : null}
		</section>
	);
}
