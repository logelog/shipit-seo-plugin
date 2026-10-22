import { Banner } from "@cloudflare/kumo/components/banner";
import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { ArrowsClockwise, Pause, Play, Stop, X } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CONTENT_SCORING_RESOURCE_NOTICE_VERSION } from "@shipitseo/emdash-plugin-seo/admin-contract";
import type {
	SeoAdminScoreScanCommand,
	SeoAdminScoreScanResult,
	SeoAdminScoreScanTaxonomy,
	SeoAdminScoreScanView,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as React from "react";

import {
	commandSeoScoreScan,
	fetchSeoAdminSettings,
	fetchSeoAuditContentOptions,
	fetchSeoScoreScan,
	fetchSeoScoreScanTaxonomies,
	fetchSeoScoreScanTerms,
	saveSeoContentScoring,
	startSeoScoreScan,
} from "./api.ts";
import {
	NO_SCORE_SCAN_REQUESTS,
	SCORE_SCAN_NOTES,
	SCORE_SCAN_TERMS_PER_TAXONOMY_MAX,
	SCORE_SCAN_TERM_SEARCH_DEBOUNCE_MS,
	SCORE_SCAN_TERM_SEARCH_MAX,
	addScoreScanTerm,
	initialScoreScanForm,
	nextScoreScanStep,
	reconcileScoreScanRequests,
	removeScoreScanTerm,
	scoreScanCommandId,
	scoreScanDetailCounters,
	scoreScanFailureMessage,
	scoreScanFormErrors,
	scoreScanFormForCollections,
	scoreScanHistoryWarning,
	scoreScanNeedsAnalysisEnabled,
	scoreScanNeedsProfileRefresh,
	scoreScanOutcomePresentation,
	scoreScanPrimaryCounters,
	scoreScanProgressText,
	scoreScanQueryKeys,
	scoreScanRequestsFor,
	scoreScanStartRequest,
	scoreScanStatePresentation,
	scoreScanTermLimitReached,
	type ScoreScanForm,
	type ScoreScanLoopStep,
	type ScoreScanRequests,
	type ScoreScanTaxonomyDraft,
} from "./score-scan-model.ts";
import { invalidateScoreData } from "./score-refresh.ts";
import { SEO_SETTINGS_UNREADABLE_VIEW, SEO_WORKSPACE_VIEW_LABELS, seoWorkspaceKeys } from "./workspace-model.ts";
import { AssessmentProfileControl, collectionAnalysisProfileKey, useCollectionAnalysisProfile } from "./assessment-profile-control.tsx";

const STATUS_LABELS = { all: "All statuses", published: "Published", draft: "Draft", scheduled: "Scheduled" } as const;
// One shared empty list, so a pending or failed discovery keeps a stable dependency.
const NO_COLLECTIONS: ReadonlyArray<{ collection: string; label: string }> = [];

/** A lost response is retried once with the same command ID, so the server can replay its receipt. */
async function sendScoreScanCommand(
	command: SeoAdminScoreScanCommand,
	view: SeoAdminScoreScanView,
): Promise<SeoAdminScoreScanResult> {
	const request = { command, runId: view.runId, expectedRevision: view.revision, commandId: scoreScanCommandId() };
	try {
		return await commandSeoScoreScan(request);
	} catch {
		return commandSeoScoreScan(request);
	}
}

const FEATURE_CONTROLS_URL = "/_emdash/admin/plugins/shipit-seo/seo?view=modules";

function scoringPolicyLabel(state: string | undefined): string {
	return state === "enabled" ? "Enabled" : state === "paused" ? "Paused"
		: state === "pending-confirmation" ? "Review required" : "Unavailable";
}

/** The activation owner for automatic updates and bulk scans. */
export function ContentAnalysisActivation() {
	const queryClient = useQueryClient();
	const settingsQuery = useQuery({
		queryKey: seoWorkspaceKeys.settings, queryFn: fetchSeoAdminSettings,
		staleTime: 20_000, refetchOnWindowFocus: false,
	});
	const [acknowledged, setAcknowledged] = React.useState(false);
	const [saving, setSaving] = React.useState(false);
	const [mustReload, setMustReload] = React.useState(false);
	const [message, setMessage] = React.useState("");
	const [error, setError] = React.useState("");
	const writing = React.useRef(false);
	const settings = settingsQuery.data;
	const policy = settings?.contentScoring;
	const readable = settings?.values !== undefined && settings.values !== null;
	const policyUnavailable = policy?.state === "unavailable";
	const noticeMatches = readable && (policyUnavailable || policy?.currentNoticeVersion === CONTENT_SCORING_RESOURCE_NOTICE_VERSION);
	const enabled = policy?.state === "enabled";
	const locked = saving || mustReload || settingsQuery.isPending || settingsQuery.isError || !readable;

	React.useEffect(() => { setAcknowledged(false); }, [policy?.state, settings?.revision]);

	const reload = async () => {
		const result = await settingsQuery.refetch();
		if (result.isError || !result.data?.values) return;
		setMustReload(false);
		setError("");
		setAcknowledged(false);
	};
	const save = async (nextEnabled: boolean) => {
		if (locked || writing.current || !readable || !settings?.values || (nextEnabled && (!acknowledged || !noticeMatches))) return;
		writing.current = true;
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const result = await saveSeoContentScoring({
				contentScoringEnabled: nextEnabled,
				expectedContentScoringEnabled: settings.values.contentScoringEnabled,
				expectedRevision: settings.revision,
				expectedLegacyGuard: settings.legacyGuard,
				...(nextEnabled ? { resourceNoticeVersion: CONTENT_SCORING_RESOURCE_NOTICE_VERSION } : {}),
			});
			if (!result.success) {
				setError(result.errors.contentScoringEnabled ?? result.errors._form ?? "The analysis preference could not be changed.");
				setMustReload(true);
				return;
			}
			queryClient.setQueryData(seoWorkspaceKeys.settings, result.settings);
			setAcknowledged(false);
			setMessage(nextEnabled
				? "Automatic & bulk analysis enabled. Choose an assessment profile for saved-content updates. No catch-up scan was started."
				: "Automatic & bulk analysis paused. Manual entry analysis remains available; scans admit no further entries.");
			void invalidateScoreData(queryClient);
		} catch {
			setError("The change could not be confirmed. Reload the saved state before trying again.");
			setMustReload(true);
		} finally {
			writing.current = false;
			setSaving(false);
		}
	};

	return (
		<section className="shipit-seo-panel shipit-seo-analysis-activation" aria-labelledby="seo-analysis-activation-title">
			<div className="shipit-seo-section-heading">
				<div><span className="shipit-seo-eyebrow">Resource use</span><h2 id="seo-analysis-activation-title" tabIndex={-1} data-seo-setting="automaticAnalysis">Automatic &amp; bulk analysis</h2></div>
				<div className="shipit-seo-heading-badges">
					<Badge variant="outline">Saves immediately</Badge>
					<Badge variant={enabled ? "success" : "secondary"}>{settingsQuery.isPending ? "Loading" : scoringPolicyLabel(policy?.state)}</Badge>
				</div>
			</div>
			<p>Analyze saved changes automatically and run selected scans. Manual entry analysis is available separately in the editor.</p>
			<div className="shipit-seo-analysis-activation__notice" role="note">
				<strong>Analysis uses hosting resources</strong>
				<p>Saved edits and selected scans use server CPU and database reads and writes. Hosting charges may increase. Enabling starts no catch-up scan.</p>
				<p>Provider billing limits are managed with your host. Public metadata rendering also uses host resources.</p>
			</div>
			{policy?.state === "pending-confirmation" ? <p className="shipit-seo-muted">Automatic and bulk analysis stay paused until you review and acknowledge resource use. Saved scores and history are preserved.</p> : null}
			{settingsQuery.isError || !readable && !settingsQuery.isPending ? <p role="alert">The saved settings could not be read. Reload them before changing analysis.</p> : null}
			{readable && policyUnavailable ? <p role="alert">The saved acknowledgement is unavailable. Automatic and bulk analysis stay paused. Review resource use to enable them, or save a paused preference.</p> : null}
			{readable && !noticeMatches ? <p role="alert">This resource notice is out of date. Update the plugin before enabling analysis.</p> : null}
			{!enabled && readable && noticeMatches ? (
				<Checkbox label="I understand that analysis uses hosting resources and may affect hosting charges."
					checked={acknowledged} disabled={locked} onCheckedChange={(checked) => setAcknowledged(checked === true)} />
			) : null}
			<div className="shipit-seo-analysis-activation__actions">
				<Button type="button" variant={enabled ? "secondary" : "primary"} loading={saving}
					disabled={locked || (!enabled && (!acknowledged || !noticeMatches))} onClick={() => void save(!enabled)}>
					{enabled ? "Pause automatic & bulk" : "Enable automatic & bulk"}
				</Button>
				{readable && policyUnavailable && settings.values.contentScoringEnabled ? <Button type="button" variant="secondary" disabled={locked} onClick={() => void save(false)}>Pause automatic &amp; bulk</Button> : null}
				{mustReload || settingsQuery.isError || !readable ? <Button type="button" variant="secondary" disabled={saving} onClick={() => void reload()}>Reload saved state</Button> : null}
			</div>
			{message ? <p role="status">{message}</p> : null}
			{error ? <p className="shipit-seo-form-error" role="alert">{error}</p> : null}
		</section>
	);
}

/** Opens Feature controls in place when the workspace can; the link still works on its own. It changes no setting. */
export function AnalysisOffNotice({ onOpenFeatureControls }: { onOpenFeatureControls?: () => void }) {
	return <Banner variant="default" className="shipit-seo-analysis-off"
		title="Enable analysis to scan content"
		description="To scan your content, enable Automatic & bulk analysis in Feature controls."
		action={<LinkButton href={FEATURE_CONTROLS_URL} size="sm" variant="primary" onClick={(event) => {
			if (!onOpenFeatureControls || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			event.preventDefault();
			onOpenFeatureControls();
		}}>Open Feature controls</LinkButton>} />;
}

export function ContentScoringControls({ onOpenSettings, onOpenFeatureControls }: { onOpenSettings?: () => void; onOpenFeatureControls?: () => void } = {}) {
	const queryClient = useQueryClient();
	const settingsQuery = useQuery({
		queryKey: seoWorkspaceKeys.settings,
		queryFn: fetchSeoAdminSettings,
		staleTime: 20_000,
		refetchOnWindowFocus: false,
	});
	const collectionsQuery = useQuery({
		queryKey: ["shipit-seo", "audit-content-options", "collections"],
		queryFn: ({ signal }) => fetchSeoAuditContentOptions({ signal }),
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
	});
	const scanQuery = useQuery({
		queryKey: scoreScanQueryKeys.state,
		queryFn: ({ signal }) => fetchSeoScoreScan({ signal }),
		staleTime: 0,
		refetchOnWindowFocus: false,
	});
	const [form, setForm] = React.useState<ScoreScanForm>(() => initialScoreScanForm());
	const [view, setView] = React.useState<SeoAdminScoreScanView | null>(null);
	const [driving, setDriving] = React.useState(false);
	const [requested, setRequested] = React.useState<ScoreScanRequests>(NO_SCORE_SCAN_REQUESTS);
	const [replaceConfirmed, setReplaceConfirmed] = React.useState(false);
	const [message, setMessage] = React.useState("");
	const [error, setError] = React.useState("");
	const mounted = React.useRef(true);
	const requestedRef = React.useRef<ScoreScanRequests>(NO_SCORE_SCAN_REQUESTS);
	const busy = React.useRef(false);
	const collections = collectionsQuery.data?.collections ?? NO_COLLECTIONS;
	const settingsValues = settingsQuery.data?.values ?? null;
	const settingsUnreadable = settingsQuery.data !== undefined && settingsValues === null;
	const policy = settingsQuery.data?.contentScoring;
	const enabled = policy?.state === "enabled" && !settingsQuery.isError && settingsValues !== null;
	const analysisOff = scoreScanNeedsAnalysisEnabled({ isError: settingsQuery.isError, values: settingsQuery.data?.values, policyState: policy?.state });
	const assessmentQuery = useCollectionAnalysisProfile(form.collection);
	const assessmentConfigured = assessmentQuery.data?.selection.state === "configured" && !assessmentQuery.isError;
	const [assessmentDirty, setAssessmentDirty] = React.useState(false);
	const runAssessmentQuery = useCollectionAnalysisProfile(view?.scope.collection ?? "", view !== null);
	const runAssessmentConfigured = runAssessmentQuery.data?.selection.state === "configured" && !runAssessmentQuery.isError;
	const scanResult = scanQuery.data;
	const scanFailure = scanResult && !scanResult.success ? scanResult : null;
	const formErrors = scoreScanFormErrors(form);
	const activeRun = view && (view.state === "running" || view.state === "paused") ? view : null;

	React.useEffect(() => {
		mounted.current = true;
		return () => { mounted.current = false; };
	}, []);
	React.useEffect(() => {
		setForm((current) => scoreScanFormForCollections(current, collections));
	}, [collections]);
	const setRequests = (next: ScoreScanRequests) => {
		requestedRef.current = next.pause || next.stop ? next : NO_SCORE_SCAN_REQUESTS;
		setRequested(requestedRef.current);
	};
	/** Records or clears a request for one run; a request for another run is replaced. */
	const request = (runId: string, next: Partial<Pick<ScoreScanRequests, "pause" | "stop">>) => {
		const current = requestedRef.current.runId === runId ? requestedRef.current : { ...NO_SCORE_SCAN_REQUESTS, runId };
		setRequests({ ...current, ...next });
	};
	React.useEffect(() => {
		if (busy.current || !scanResult?.success) return;
		setView(scanResult.scan);
		// A confirmed state answers its own run's requests; another run never inherits them.
		setRequests(reconcileScoreScanRequests(requestedRef.current, scanResult.scan));
	}, [scanResult]);

	/** Runs one command at a time and continues only while this panel is mounted. */
	const drive = async (first: () => Promise<SeoAdminScoreScanResult>, requestedCollection: string) => {
		if (busy.current) return;
		busy.current = true;
		setDriving(true);
		setError("");
		setMessage("");
		let runId = view?.runId ?? null;
		try {
			let result = await first();
			while (mounted.current) {
				if (scoreScanNeedsProfileRefresh(result)) {
					void queryClient.invalidateQueries({ queryKey: collectionAnalysisProfileKey(requestedCollection), exact: true });
				}
				if (result.scan) setView(result.scan);
				if (result.success) {
					runId = result.scan.runId;
					setRequests(reconcileScoreScanRequests(requestedRef.current, result.scan));
				}
				// A started run replaces the old one, so a request made for the old run ends with it.
				if (result.success && result.command === "start") setRequests(NO_SCORE_SCAN_REQUESTS);
				if (result.success && result.command === "pause") request(result.scan.runId, { pause: false });
				if (result.success && result.command === "stop") request(result.scan.runId, { stop: false });
				const step: ScoreScanLoopStep = nextScoreScanStep(result, scoreScanRequestsFor(requestedRef.current, runId), runId);
				if (step.kind === "idle") {
					// An unapplied Stop or Pause stays visible for its own run until it is confirmed or retried.
					setRequests(runId ? { runId, ...step.pending } : NO_SCORE_SCAN_REQUESTS);
					if (step.error) setError(step.error);
					if (step.message) setMessage(step.message);
					if (step.reload) void scanQuery.refetch();
					break;
				}
				result = await sendScoreScanCommand(step.kind, step.view);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "The score scan request failed.");
			void scanQuery.refetch();
		} finally {
			busy.current = false;
			if (mounted.current) setDriving(false);
			try { await invalidateScoreData(queryClient); } catch { /* Lists reload on their next visit. */ }
		}
	};

	const command = (kind: SeoAdminScoreScanCommand) => {
		if (!view || (kind === "resume" && (!enabled || !runAssessmentConfigured || (view.scope.collection === form.collection && assessmentDirty)))) return;
		if (kind === "pause") request(view.runId, { pause: true });
		if (kind === "stop") request(view.runId, { stop: true });
		if (kind === "resume") request(view.runId, { pause: false, stop: false });
		if (busy.current) return;
		void drive(() => sendScoreScanCommand(kind, view), view.scope.collection);
	};

	const start = () => {
		const startRequest = scoreScanStartRequest(form, scoreScanCommandId(), view);
		if (!startRequest || !enabled || !assessmentConfigured || assessmentDirty || (activeRun && !replaceConfirmed)) return;
		setReplaceConfirmed(false);
		void drive(async () => {
			try {
				return await startSeoScoreScan(startRequest);
			} catch {
				return startSeoScoreScan(startRequest);
			}
		}, startRequest.collection);
	};


	const updateForm = (next: Partial<ScoreScanForm>) => {
		setForm((current) => ({ ...current, ...next, ...(next.collection !== undefined && next.collection !== current.collection ? { taxonomies: [] } : {}) }));
		if (next.collection !== undefined && next.collection !== form.collection) setAssessmentDirty(false);
		setMessage("");
		setError("");
	};

	const pendingRequests = scoreScanRequestsFor(reconcileScoreScanRequests(requested, view), view?.runId ?? null);
	const presentation = view ? scoreScanStatePresentation(view, { driving, ...pendingRequests, scoringEnabled: settingsValues ? enabled : null }) : null;
	const historyWarning = view ? scoreScanHistoryWarning(view.counters) : null;
	const canResume = Boolean(view && (view.state === "paused" || (view.state === "running" && !driving)));
	const canStart = enabled && assessmentConfigured && !assessmentDirty && !driving && Object.keys(formErrors).length === 0 && (!activeRun || replaceConfirmed);

	return (
		<section className="shipit-seo-panel shipit-seo-settings-form" aria-labelledby="seo-score-controls-title">
			<div className="shipit-seo-section-heading">
				<div>
					<span className="shipit-seo-eyebrow">Content health</span>
					<h2 id="seo-score-controls-title">Analyze saved content</h2>
				</div>
			</div>
			{settingsQuery.isError ? <p role="alert">Scoring settings could not be loaded. <Button type="button" variant="secondary" onClick={() => void settingsQuery.refetch()}>Retry</Button></p> : null}
			{settingsUnreadable ? <p role="alert">{settingsQuery.data?.state === "corrupt" ? "The stored SEO settings are invalid" : "The SEO settings could not be read"}, so the scoring control is unavailable. Open {SEO_WORKSPACE_VIEW_LABELS[SEO_SETTINGS_UNREADABLE_VIEW]} for details.{" "}
				{onOpenSettings ? <Button type="button" variant="secondary" onClick={onOpenSettings}>Open {SEO_WORKSPACE_VIEW_LABELS[SEO_SETTINGS_UNREADABLE_VIEW]}</Button> : null}{" "}
				<Button type="button" variant="secondary" onClick={() => void settingsQuery.refetch()}>Retry</Button></p> : null}
			{analysisOff ? <AnalysisOffNotice onOpenFeatureControls={onOpenFeatureControls} />
				: !settingsQuery.isPending && !settingsQuery.isError && settingsValues !== null ? <div className="shipit-seo-analysis-status" role="status">
				<div><strong>Automatic &amp; bulk analysis: {scoringPolicyLabel(policy?.state).toLowerCase()}</strong>
					<span>{enabled ? "Saved edits may update results. Scans run only while this panel stays open."
						: "Manual entry analysis remains available in the editor. Scans currently require automatic analysis to be enabled."}</span></div>
				<a href={FEATURE_CONTROLS_URL}>Manage in Feature controls</a>
			</div> : null}

			{scanQuery.isError ? <p role="alert">The score scan could not be loaded. <Button type="button" variant="secondary" onClick={() => void scanQuery.refetch()}>Retry</Button></p> : null}
			{scanFailure ? <p className="shipit-seo-muted" role="status">{scoreScanFailureMessage(scanFailure.error, null)}</p> : null}

			{view && presentation ? (
				<div className="shipit-seo-scan" aria-labelledby="seo-score-scan-run-title">
					<div className="shipit-seo-scan__status" data-tone={presentation.tone} role="status">
						<div>
							<strong id="seo-score-scan-run-title">{presentation.label}</strong>
							<span>{presentation.detail}</span>
						</div>
						<div className="shipit-seo-refresh-controls">
							{canResume ? <Button type="button" variant="secondary" icon={Play} disabled={!enabled || !runAssessmentConfigured || (view.scope.collection === form.collection && assessmentDirty)} onClick={() => command("resume")}>{view.unit?.active ? "Take over and resume" : "Resume"}</Button> : null}
							{view.state === "running" && (driving || pendingRequests.pauseRequested) ? <Button type="button" variant="secondary" icon={Pause} disabled={driving && (pendingRequests.pauseRequested || pendingRequests.stopRequested)} onClick={() => command("pause")}>Pause</Button> : null}
							{view.state === "running" || view.state === "paused" ? <Button type="button" variant="secondary" icon={Stop} disabled={driving && pendingRequests.stopRequested} onClick={() => command("stop")}>Stop</Button> : null}
						</div>
					</div>
					<p className="shipit-seo-scan__scope">
						{collections.find((item) => item.collection === view.scope.collection)?.label ?? view.scope.collection}
						{" · "}{STATUS_LABELS[view.scope.status]}
						{" · "}{view.scope.locale ?? "All locales"}
						{view.scope.taxonomies.map((selection) => ` · ${selection.taxonomy}: ${selection.termIds.length} ${selection.termIds.length === 1 ? "term" : "terms"}${selection.includeDescendants ? ` with descendants (${selection.termGroupCount} groups)` : ""}`).join("")}
						{" · "}{view.target.mode === "all" ? "All matching content" : `${view.target.count.toLocaleString("en")} matching entries`}
					</p>
					<p className="shipit-seo-scan__progress">{scoreScanProgressText(view)}</p>
					<dl className="shipit-seo-scan__counters">
						{scoreScanPrimaryCounters(view.counters).map((row) => (
							<div key={row.key}><dt>{row.label}</dt><dd>{row.value.toLocaleString("en")}</dd></div>
						))}
					</dl>
					<p className="shipit-seo-muted">{SCORE_SCAN_NOTES.processed}</p>
					{view.retry ? <p className="shipit-seo-muted">One processed entry will be analyzed again when you resume. It is not counted twice.</p> : null}
					{historyWarning ? <p className="shipit-seo-scan__warning" role="note">{historyWarning}</p> : null}
					{view.failureStreak > 0 && view.state === "running" ? <p className="shipit-seo-scan__warning" role="note">{view.failureStreak} {view.failureStreak === 1 ? "entry has" : "entries have"} failed in a row; three pause the scan.</p> : null}
					<details className="shipit-seo-scan__details">
						<summary>Details</summary>
						<dl className="shipit-seo-scan__counters shipit-seo-scan__counters--detail">
							{scoreScanDetailCounters(view.counters).map((row) => (
								<div key={row.key}><dt>{row.label}</dt><dd>{row.value.toLocaleString("en")}</dd></div>
							))}
						</dl>
						<dl className="shipit-seo-scan__facts">
							<div><dt>Run</dt><dd>{view.runId}, revision {view.revision}</dd></div>
							<div><dt>Waiting matches</dt><dd>{view.bufferedReferences}{view.exhausted ? ", end of content reached" : ""}</dd></div>
							{view.unit ? <div><dt>Entry in progress</dt><dd>{view.unit.ref}, {view.unit.phase === "history" ? "recording history" : "analysis"}, {view.unit.active ? "held" : "lease expired"} until {new Date(view.unit.leaseExpiresAt).toLocaleString()}</dd></div> : null}
							{view.retry ? <div><dt>Kept for retry</dt><dd>{view.retry.ref} (entry {view.retry.admission})</dd></div> : null}
						</dl>
						{view.outcomes.length ? (
							<div className="shipit-seo-scan__outcomes">
								<h3>Latest outcomes</h3>
								<ol>
									{[...view.outcomes].reverse().map((outcome) => {
										const shown = scoreScanOutcomePresentation(outcome);
										return (
											<li key={outcome.attemptId} className="shipit-seo-scan__outcome" data-tone={shown.tone}>
												<strong>{shown.label}</strong>
												<span className="shipit-seo-scan__ref">{outcome.ref}{outcome.locale ? ` (${outcome.locale})` : ""}</span>
												{shown.detail ? <span>{shown.detail}</span> : null}
											</li>
										);
									})}
								</ol>
							</div>
						) : null}
						<p className="shipit-seo-muted">{SCORE_SCAN_NOTES.outcomes}</p>
					</details>
				</div>
			) : null}

			{!scanFailure ? (
				<div className="shipit-seo-scan__form">
					<h3>{view ? "Start a new run" : "Analyze selected content"}</h3>
					<div className="shipit-seo-refresh-controls shipit-seo-score-scope">
						<label>Content type <select value={form.collection} disabled={driving || collectionsQuery.isPending} onChange={(event) => updateForm({ collection: event.target.value })}>
							{collections.length ? collections.map((item) => <option key={item.collection} value={item.collection}>{item.label}</option>) : <option value="">No content types</option>}
						</select></label>
						<label>Status <select value={form.status} disabled={driving} onChange={(event) => updateForm({ status: event.target.value as ScoreScanForm["status"] })}>
							{(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
						</select></label>
						<label>Locale <input value={form.locale} disabled={driving} maxLength={35} placeholder="All locales" onChange={(event) => updateForm({ locale: event.target.value })} /></label>
						<label>Amount <select value={form.mode} disabled={driving} onChange={(event) => updateForm({ mode: event.target.value as ScoreScanForm["mode"] })}>
							<option value="count">Selected count</option><option value="all">All matching content</option>
						</select></label>
						{form.mode === "count" ? <label>Entries <input type="number" min={1} max={100000} value={form.count} disabled={driving} onChange={(event) => updateForm({ count: event.target.value })} /></label> : null}
					</div>
					{form.mode === "count" ? <p className="shipit-seo-scan__selection-note">Starts at the first match; reused scores count toward this limit.</p> : null}
					{form.collection ? <AssessmentProfileControl key={form.collection} collection={form.collection}
						disabled={driving} onDraftChange={setAssessmentDirty} /> : null}
					{!assessmentConfigured && form.collection ? <p className="shipit-seo-muted" role="status">Choose and save a profile before starting or resuming analysis. Previous results remain available.</p> : null}
					{formErrors.locale ? <p className="shipit-seo-form-error">{formErrors.locale}</p> : null}
					{formErrors.count ? <p className="shipit-seo-form-error">{formErrors.count}</p> : null}
					{form.collection ? (
						<TaxonomySelector
							collection={form.collection}
							locale={form.locale.trim() || null}
							drafts={form.taxonomies}
							disabled={driving}
							onChange={(taxonomies) => updateForm({ taxonomies })}
						/>
					) : null}
					{formErrors.taxonomies ? <p className="shipit-seo-form-error">{formErrors.taxonomies}</p> : null}
					{form.status === "scheduled" ? <p className="shipit-seo-scan__selection-note">{SCORE_SCAN_NOTES.status}</p> : null}
					{activeRun ? <label className="shipit-seo-scan__confirm"><input type="checkbox" checked={replaceConfirmed} disabled={driving} onChange={(event) => setReplaceConfirmed(event.target.checked)} /> Replace the current run. Its progress ends; saved scores and history remain.</label> : null}
					<div className="shipit-seo-refresh-controls">
						<Button type="button" variant="secondary" icon={ArrowsClockwise} loading={driving && !view} disabled={!canStart} onClick={start}>{view ? "Start new run" : "Start analysis"}</Button>
					</div>
					<details className="shipit-seo-scan__help">
						<summary>How analysis works</summary>
						<p>Choose an assessment profile and a bounded selection. Content lists read saved results; opening them runs no analysis.</p>
						<ul className="shipit-seo-scan__notes">
							<li>{SCORE_SCAN_NOTES.panel}</li>
							{form.mode === "count" ? <li>{SCORE_SCAN_NOTES.count}</li> : null}
							<li>{SCORE_SCAN_NOTES.taxonomy}</li>
							<li>{SCORE_SCAN_NOTES.scope}</li>
						</ul>
					</details>
				</div>
			) : null}
			{message ? <p role="status">{message}</p> : null}
			{error ? <p className="shipit-seo-form-error" role="alert">{error}</p> : null}
		</section>
	);
}

function TaxonomySelector(props: {
	collection: string;
	locale: string | null;
	drafts: ScoreScanTaxonomyDraft[];
	disabled: boolean;
	onChange(drafts: ScoreScanTaxonomyDraft[]): void;
}) {
	const taxonomiesQuery = useQuery({
		queryKey: scoreScanQueryKeys.taxonomies(props.collection),
		queryFn: ({ signal }) => fetchSeoScoreScanTaxonomies(props.collection, { signal }),
		staleTime: 60_000,
		refetchOnWindowFocus: false,
	});
	const result = taxonomiesQuery.data;
	if (taxonomiesQuery.isError) return <p className="shipit-seo-form-error" role="alert">Taxonomies could not be loaded.</p>;
	if (!result) return null;
	if (!result.success) {
		return result.error === "taxonomies_unavailable"
			? <p className="shipit-seo-form-error" role="alert">Taxonomies could not be read, so this scan cannot filter by terms.</p>
			: null;
	}
	if (!result.taxonomies.length) return <p className="shipit-seo-muted">No taxonomies are attached to this content type.</p>;
	const draftFor = (taxonomy: SeoAdminScoreScanTaxonomy): ScoreScanTaxonomyDraft =>
		props.drafts.find((draft) => draft.taxonomy === taxonomy.name) ??
		{ taxonomy: taxonomy.name, label: taxonomy.label, hierarchical: taxonomy.hierarchical, includeDescendants: false, terms: [] };
	const replace = (next: ScoreScanTaxonomyDraft) =>
		props.onChange([...props.drafts.filter((draft) => draft.taxonomy !== next.taxonomy), next].filter((draft) => draft.terms.length > 0 || draft.includeDescendants));
	return (
		<div className="shipit-seo-scan-terms">
			{result.taxonomies.map((taxonomy) => (
				<TermPicker key={taxonomy.name} collection={props.collection} locale={props.locale} draft={draftFor(taxonomy)} disabled={props.disabled} onChange={replace} />
			))}
		</div>
	);
}

function TermPicker(props: {
	collection: string;
	locale: string | null;
	draft: ScoreScanTaxonomyDraft;
	disabled: boolean;
	onChange(draft: ScoreScanTaxonomyDraft): void;
}) {
	const { draft } = props;
	const [open, setOpen] = React.useState(false);
	const [search, setSearch] = React.useState("");
	const [query, setQuery] = React.useState("");
	const [cursors, setCursors] = React.useState<Array<string | null>>([null]);
	React.useEffect(() => {
		const timer = setTimeout(() => { setQuery(search.trim()); setCursors([null]); }, SCORE_SCAN_TERM_SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [search]);
	React.useEffect(() => { setCursors([null]); }, [props.collection, props.locale]);
	const cursor = cursors[cursors.length - 1] ?? null;
	const termsQuery = useQuery({
		queryKey: scoreScanQueryKeys.terms(props.collection, draft.taxonomy, props.locale, query, cursor),
		queryFn: ({ signal }) => fetchSeoScoreScanTerms({ collection: props.collection, taxonomy: draft.taxonomy, locale: props.locale, search: query, cursor }, { signal }),
		enabled: open,
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	});
	const page = termsQuery.data;
	const full = scoreScanTermLimitReached(draft);
	const id = `seo-scan-terms-${draft.taxonomy}`;
	return (
		<details className="shipit-seo-scan-terms__picker" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
			<summary>{draft.label}{draft.terms.length ? ` (${draft.terms.length} selected)` : ""}</summary>
			{draft.terms.length ? (
				<ul className="shipit-seo-scan-terms__chips" aria-label={`Selected ${draft.label}`}>
					{draft.terms.map((term) => (
						<li key={term.id} className="shipit-seo-scan-terms__chip">
							<span>{term.label}</span>
							<button type="button" aria-label={`Remove ${term.label}`} disabled={props.disabled} onClick={() => props.onChange(removeScoreScanTerm(draft, term.id))}><X aria-hidden="true" /></button>
						</li>
					))}
				</ul>
			) : null}
			{draft.hierarchical ? (
				<label className="shipit-seo-scan-terms__descendants">
					<input type="checkbox" checked={draft.includeDescendants} disabled={props.disabled} onChange={(event) => props.onChange({ ...draft, includeDescendants: event.target.checked })} />
					Include descendants of the selected terms
				</label>
			) : null}
			{full ? <p className="shipit-seo-muted" role="note">{SCORE_SCAN_TERMS_PER_TAXONOMY_MAX} terms are selected, the most one taxonomy allows. Remove a term to add another.</p> : null}
			<label className="shipit-seo-scan-terms__search" htmlFor={id}>Find terms</label>
			<input id={id} className="shipit-seo-scan-terms__input" type="search" value={search} maxLength={SCORE_SCAN_TERM_SEARCH_MAX} disabled={props.disabled} placeholder="Search by name or slug" onChange={(event) => setSearch(event.target.value)} />
			{termsQuery.isError ? <p className="shipit-seo-form-error" role="alert">Terms could not be loaded.</p> : null}
			{page && !page.success ? <p className="shipit-seo-form-error" role="alert">{page.error === "invalid_selection" && page.detail ? page.detail : "Terms could not be loaded."}</p> : null}
			{page?.success ? (
				<>
					{page.terms.length ? (
						<ul className="shipit-seo-scan-terms__results">
							{page.terms.map((term) => {
								const selected = draft.terms.some((item) => item.id === term.id);
								return (
									<li key={term.id}>
										<span>{term.label}<small>{term.locale}</small></span>
										<Button type="button" variant="secondary" size="sm" disabled={props.disabled || selected || full} onClick={() => props.onChange(addScoreScanTerm(draft, term))}>{selected ? "Selected" : "Add"}</Button>
									</li>
								);
							})}
						</ul>
					) : <p className="shipit-seo-muted">No matching terms.</p>}
					<div className="shipit-seo-scan-terms__pager">
						<Button type="button" variant="secondary" size="sm" disabled={cursors.length <= 1} onClick={() => setCursors((current) => current.slice(0, -1))}>Previous</Button>
						<Button type="button" variant="secondary" size="sm" disabled={!page.nextCursor} onClick={() => page.nextCursor && setCursors((current) => [...current, page.nextCursor])}>Next</Button>
					</div>
				</>
			) : null}
		</details>
	);
}
