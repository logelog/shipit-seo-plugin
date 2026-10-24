import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Input, Textarea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import {
	ArrowClockwise,
	CaretDown,
	CaretRight,
	CheckCircle,
	Info,
	Key,
	PaperPlaneTilt,
	WarningCircle,
} from "@phosphor-icons/react";
import {
	validateIndexNowSettings,
	type IndexNowSettingsErrors,
	type IndexNowSettingsValues,
	type IndexNowSubmissionSource,
	type IndexNowSubmissionStatus,
	type SeoAdminIndexNowHistoryUrlsPage,
	type SeoAdminIndexNowSetupStep,
	type SeoAdminIndexNowStatus,
	type SeoAdminIndexNowSubmission,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	drainSeoAdminIndexNow,
	fetchSeoAdminIndexNow,
	fetchSeoAdminIndexNowHistory,
	fetchSeoAdminIndexNowHistoryUrls,
	generateSeoAdminIndexNowKey,
	retrySeoAdminIndexNow,
	retrySeoAdminIndexNowSubmission,
	saveSeoAdminIndexNow,
	saveSeoAdminIndexNowAutomation,
	setupSeoAdminIndexNow,
	submitSeoAdminIndexNow,
} from "./api.ts";
import {
	INDEXNOW_ADVANCED_FIELDS,
	INDEXNOW_HISTORY_DEFAULT_PAGE_SIZE,
	INDEXNOW_MANUAL_TEXT_LIMIT,
	INDEXNOW_MANUAL_URL_LIMIT,
	eligibleIndexNowScope,
	equalIndexNowScope,
	finishIndexNowHistoryRequest,
	indexNowContentTypeRuleNote,
	indexNowCountsSummary,
	indexNowDisplayUrl,
	indexNowEventLabel,
	indexNowHistoryRange,
	indexNowHttpResult,
	indexNowKeyLocationHelp,
	indexNowSetupCopy,
	indexNowScopeRows,
	indexNowSourceLabel,
	indexNowSubmissionPresentation,
	indexNowSubmissionSummary,
	indexNowUrlIssueSummary,
	initialIndexNowHistoryState,
	legacyIndexNowDeliveries,
	parseIndexNowUrlList,
	receiveIndexNowStatus,
	remainingIndexNowUrlList,
	startIndexNowHistoryRequest,
	submittableIndexNowTypes,
	toggleIndexNowScope,
	unavailableIndexNowSelectedTypes,
	type IndexNowHistoryChange,
	type IndexNowHistoryState,
	type IndexNowSettingsView,
	type IndexNowTone,
} from "./indexnow-view-model.ts";
import { useSeoToasts, useWorkspaceDraftHold, useWorkspacePageActive } from "./workspace-shell.tsx";
import { WRAPPING_UNDERLINE_TABS, useTablistName } from "./workspace-tabs.ts";

type Tab = "automatic" | "history";
type Busy = "refresh" | "setup" | "automation" | "advanced" | "key" | "disable" | "submit" | "drain" | "retry" | null;

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const shortDateTime = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function formatDate(value: string | null, format = dateTime): string {
	if (!value) return "Never";
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? "Unknown" : format.format(date);
}

function formatTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return "an unknown time";
	return date.toDateString() === new Date().toDateString() ? timeOnly.format(date) : shortDateTime.format(date);
}

const TONE_BADGE: Record<IndexNowTone, "neutral" | "info" | "success" | "warning" | "error"> = {
	neutral: "neutral", info: "info", success: "success", warning: "warning", error: "error",
};

const STATUS_FILTERS: Record<"all" | IndexNowSubmissionStatus, string> = {
	all: "All statuses",
	queued: "Queued",
	retry: "Retry scheduled",
	sent: "Sent",
	accepted: "Accepted",
	failed: "Failed",
	superseded: "Queued again",
};

const SOURCE_FILTERS: Record<"all" | IndexNowSubmissionSource, string> = {
	all: "All sources",
	automatic: "Automatic",
	manual: "Manual",
};

function headerState(status: SeoAdminIndexNowStatus): { label: string; variant: "success" | "neutral" | "warning" | "error" } {
	if (!status.values.enabled) return { label: "Off", variant: "neutral" };
	if (status.readiness.state === "ready") return { label: "Ready", variant: "success" };
	if (status.readiness.state === "needs-setup") return { label: "Needs setup", variant: "warning" };
	return { label: "Needs attention", variant: "error" };
}

interface StepView {
	title: string;
	description: string;
	state: string;
	tone: "done" | "waiting" | "blocked" | "failed" | "running";
}

function setupSteps(status: SeoAdminIndexNowStatus, running: boolean, failedStep: SeoAdminIndexNowSetupStep | null): StepView[] {
	const issue = status.setup.issue;
	const copy = indexNowSetupCopy(status);
	const verified = status.setup.verifiedAt !== null;
	const keyFailed = failedStep === "key";
	const verifyFailed = failedStep === "verify" || failedStep === "origin";
	return [
		{
			title: copy.keyTitle,
			description: copy.keyDescription,
			state: keyFailed ? "Not saved" : status.setup.keySaved ? "Saved" : running ? "Preparing" : "Automatic",
			tone: keyFailed ? "failed" : status.setup.keySaved ? "done" : running ? "running" : "waiting",
		},
		{
			title: "Check the key file",
			description: copy.fileDescription,
			state: issue ? issue.code === "local-site" || issue.code === "missing-site" || issue.code === "invalid-site" ? "Needs a public HTTPS address" : "Needs installation"
				: verifyFailed ? "Check failed" : verified ? "Verified" : running ? "Checking" : "Waiting",
			tone: issue ? "blocked" : verifyFailed ? "failed" : verified ? "done" : running ? "running" : "waiting",
		},
		{
			title: "Turn IndexNow on",
			description: "Only when the check passes.",
			state: failedStep === "enable" ? "Not turned on" : status.values.enabled && verified ? "On" : "After the check",
			tone: failedStep === "enable" ? "failed" : status.values.enabled && verified ? "done" : "waiting",
		},
	];
}

function SetupStepList({ steps }: { steps: StepView[] }) {
	return (
		<ol className="shipit-indexnow-steps">
			{steps.map((step, index) => (
				<li key={step.title} data-tone={step.tone}>
					<span className="shipit-indexnow-step-number" aria-hidden="true">
						{step.tone === "done" ? <CheckCircle size={16} weight="fill" /> : index + 1}
					</span>
					<div>
						<strong>{step.title}</strong>
						<p>{step.description}</p>
					</div>
					<span className="shipit-indexnow-step-state">
						{step.tone === "blocked" || step.tone === "failed" ? <WarningCircle size={14} weight="fill" aria-hidden="true" /> : null}
						{step.state}
					</span>
				</li>
			))}
		</ol>
	);
}

export function IndexNowView() {
	const toasts = useSeoToasts();
	const tabsRef = useTablistName<HTMLDivElement>({ label: "IndexNow sections" });
	const [view, setView] = React.useState<IndexNowSettingsView<SeoAdminIndexNowStatus>>({ status: null, advanced: null, scope: null });
	const viewRef = React.useRef(view);
	const [loadError, setLoadError] = React.useState<string | null>(null);
	const [tab, setTab] = React.useState<Tab>("automatic");
	const [busy, setBusy] = React.useState<Busy>(null);
	const busyRef = React.useRef<Busy>(null);
	const [message, setMessage] = React.useState<{ tone: "info" | "error"; text: string } | null>(null);
	const [setupFailure, setSetupFailure] = React.useState<{ step: SeoAdminIndexNowSetupStep | null; text: string } | null>(null);
	const [automationError, setAutomationError] = React.useState<string | null>(null);
	const [advancedErrors, setAdvancedErrors] = React.useState<IndexNowSettingsErrors>({});
	const [advancedOpen, setAdvancedOpen] = React.useState(false);
	const advancedRef = React.useRef<HTMLDetailsElement>(null);
	const focusInvalidField = React.useRef(false);
	const [manualOpen, setManualOpen] = React.useState(false);
	const [turnOffOpen, setTurnOffOpen] = React.useState(false);
	const [manualText, setManualText] = React.useState("");
	const [manualMessage, setManualMessage] = React.useState<string | null>(null);
	const [manualTooLarge, setManualTooLarge] = React.useState(false);
	const [history, setHistory] = React.useState<IndexNowHistoryState>(initialIndexNowHistoryState);
	const historyRef = React.useRef(history);
	const [historyStale, setHistoryStale] = React.useState(true);
	const [expanded, setExpanded] = React.useState<Record<string, { loading: boolean; page?: SeoAdminIndexNowHistoryUrlsPage; error?: string }>>({});
	const scopeHelpId = React.useId();

	const status = view.status;
	const setViewState = React.useCallback((update: (current: typeof view) => typeof view) => {
		const next = update(viewRef.current);
		viewRef.current = next;
		setView(next);
	}, []);

	const applyStatus = React.useCallback((next: SeoAdminIndexNowStatus) => {
		setViewState((current) => receiveIndexNowStatus(current, next));
	}, [setViewState]);

	const beginBusy = React.useCallback((name: Exclude<Busy, null>) => {
		if (busyRef.current) return false;
		busyRef.current = name;
		setBusy(name);
		return true;
	}, []);

	const endBusy = React.useCallback(() => {
		busyRef.current = null;
		setBusy(null);
	}, []);

	const load = React.useCallback(async () => {
		setLoadError(null);
		try {
			applyStatus(await fetchSeoAdminIndexNow());
		} catch (cause) {
			setLoadError(cause instanceof Error ? cause.message : "Failed to load IndexNow status");
		}
	}, [applyStatus]);

	React.useEffect(() => {
		void load();
	}, [load]);

	React.useEffect(() => {
		if (!advancedOpen || !focusInvalidField.current) return;
		focusInvalidField.current = false;
		advancedRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}, [advancedOpen, advancedErrors]);

	const loadHistory = React.useCallback(async (change: IndexNowHistoryChange) => {
		const started = startIndexNowHistoryRequest(historyRef.current, change);
		if (!started) return;
		historyRef.current = started.state;
		setHistory(started.state);
		setHistoryStale(false);
		let result: Parameters<typeof finishIndexNowHistoryRequest>[2];
		try {
			result = await fetchSeoAdminIndexNowHistory({
				cursor: started.request.cursor,
				limit: INDEXNOW_HISTORY_DEFAULT_PAGE_SIZE,
				status: started.request.status,
				source: started.request.source,
			});
		} catch (cause) {
			result = { success: false, error: "network", detail: cause instanceof Error ? cause.message : "Submission history could not be loaded." };
		}
		const finished = finishIndexNowHistoryRequest(historyRef.current, started.request, result);
		historyRef.current = finished;
		setHistory(finished);
		if (finished !== started.state) setExpanded({});
	}, []);

	React.useEffect(() => {
		if (tab === "history" && historyStale) void loadHistory({ kind: "reload" });
	}, [historyStale, loadHistory, tab]);

	const markHistoryChanged = React.useCallback(() => {
		setHistoryStale(true);
	}, []);

	const refresh = React.useCallback(async () => {
		if (!beginBusy("refresh")) return;
		setMessage(null);
		try {
			applyStatus(await fetchSeoAdminIndexNow());
			if (tab === "history") markHistoryChanged();
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "IndexNow status could not be refreshed.";
			setMessage({ tone: "error", text: detail });
		} finally {
			endBusy();
		}
	}, [applyStatus, beginBusy, endBusy, markHistoryChanged, tab]);

	const setup = React.useCallback(async () => {
		const current = viewRef.current.status;
		if (!current || !beginBusy("setup")) return;
		setMessage(null);
		setSetupFailure(null);
		try {
			const result = await setupSeoAdminIndexNow(current.updatedAt);
			if (!result.success) {
				const detail = Object.values(result.errors).join(" ") || "IndexNow setup did not complete.";
				setSetupFailure({ step: result.failedStep ?? null, text: detail });
				toasts.error("IndexNow is not on yet", detail);
				applyStatus(await fetchSeoAdminIndexNow());
				return;
			}
			applyStatus(result.indexNow);
			const text = result.indexNow.readiness.state === "ready"
				? `Setup is verified for ${result.indexNow.setup.origin ?? "this site"}.`
				: result.indexNow.readiness.description;
			setMessage({ tone: result.indexNow.readiness.state === "ready" ? "info" : "error", text });
			if (result.indexNow.readiness.state === "ready") toasts.success("IndexNow is on", text);
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "IndexNow setup did not complete.";
			setSetupFailure({ step: null, text: detail });
			toasts.error("IndexNow is not on yet", detail);
		} finally {
			endBusy();
		}
	}, [applyStatus, beginBusy, endBusy, toasts]);

	const checkAgain = React.useCallback(() => {
		const current = viewRef.current.status;
		if (current?.values.enabled && !current.setup.issue) void setup();
		else void refresh();
	}, [refresh, setup]);

	const saveAutomation = React.useCallback(async (action: "start" | "stop" | "scope") => {
		const current = viewRef.current;
		if (!current.status || !current.scope || !beginBusy("automation")) return;
		setAutomationError(null);
		setMessage(null);
		const scopeDirty = !equalIndexNowScope(current.scope.values.autoSubmitContentTypes, current.status.values.autoSubmitContentTypes);
		try {
			const result = await saveSeoAdminIndexNowAutomation({
				action,
				expectedUpdatedAt: action === "stop" ? current.status.updatedAt : current.scope.baseUpdatedAt,
				...(action === "stop" ? {} : { contentTypes: current.scope.values.autoSubmitContentTypes }),
			});
			if (!result.success) {
				const detail = Object.values(result.errors).join(" ") || "Automatic submission was not changed.";
				setAutomationError(detail);
				return;
			}
			applyStatus(result.indexNow);
			const text = action === "start"
				? "Automatic submission is on. Future changes to the selected content types are submitted. Existing content is not submitted."
				: action === "stop"
					? "Automatic submission is off. Manual submission keeps working."
					: scopeDirty ? "Content types saved." : "Nothing to save.";
			setMessage({ tone: "info", text });
			toasts.success(text);
		} catch (cause) {
			setAutomationError(cause instanceof Error ? cause.message : "Automatic submission was not changed.");
		} finally {
			endBusy();
		}
	}, [applyStatus, beginBusy, endBusy, toasts]);

	const updateScope = React.useCallback((collection: string, checked: boolean) => {
		setViewState((current) => {
			if (!current.status || !current.scope) return current;
			const available = current.status.contentTypes.map((item) => item.collection);
			return {
				...current,
				scope: {
					...current.scope,
					values: {
						...current.scope.values,
						autoSubmitContentTypes: toggleIndexNowScope(current.scope.values.autoSubmitContentTypes, collection, checked, available),
					},
				},
			};
		});
		setAutomationError(null);
	}, [setViewState]);

	const discardScope = React.useCallback(() => {
		setViewState((current) => current.status
			? { ...current, scope: { values: { ...current.status.values }, baseUpdatedAt: current.status.updatedAt } }
			: current);
		setAutomationError(null);
	}, [setViewState]);

	const updateAdvanced = React.useCallback(<K extends keyof IndexNowSettingsValues>(key: K, value: IndexNowSettingsValues[K]) => {
		setViewState((current) => current.advanced
			? { ...current, advanced: { ...current.advanced, values: { ...current.advanced.values, [key]: value } } }
			: current);
		setAdvancedErrors((current) => {
			const next = { ...current };
			delete next[key];
			delete next._form;
			return next;
		});
	}, [setViewState]);

	const discardAdvanced = React.useCallback(() => {
		setViewState((current) => current.status
			? { ...current, advanced: { values: { ...current.status.values }, baseUpdatedAt: current.status.updatedAt } }
			: current);
		setAdvancedErrors({});
	}, [setViewState]);

	const saveAdvanced = React.useCallback(async () => {
		const current = viewRef.current;
		if (!current.status || !current.advanced) return;
		const values: IndexNowSettingsValues = { ...current.status.values };
		const advanced = current.advanced.values;
		Object.assign(values, Object.fromEntries(INDEXNOW_ADVANCED_FIELDS.map((field) => [field, advanced[field]])));
		const validation = validateIndexNowSettings(values);
		if (!validation.success) {
			setAdvancedErrors(validation.errors);
			focusInvalidField.current = true;
			setAdvancedOpen(true);
			return;
		}
		if (!beginBusy("advanced")) return;
		try {
			const result = await saveSeoAdminIndexNow(validation.values, current.advanced.baseUpdatedAt);
			if (!result.success) {
				setAdvancedErrors(result.errors);
				focusInvalidField.current = true;
				return;
			}
			applyStatus(result.indexNow);
			setAdvancedErrors({});
			setMessage({ tone: "info", text: "Advanced settings saved." });
			toasts.success("Advanced settings saved");
		} catch (cause) {
			setAdvancedErrors({ _form: cause instanceof Error ? cause.message : "Advanced settings were not saved." });
		} finally {
			endBusy();
		}
	}, [applyStatus, beginBusy, endBusy, toasts]);

	const generateKey = React.useCallback(async () => {
		const current = viewRef.current;
		if (!current.status || !beginBusy("key")) return;
		try {
			const result = await generateSeoAdminIndexNowKey(current.status.updatedAt);
			if (!result.success) {
				setAdvancedErrors(result.errors);
				return;
			}
			applyStatus(result.indexNow);
			setMessage({ tone: "info", text: "A new key was saved. Check the key file again before URLs are sent." });
		} catch (cause) {
			setAdvancedErrors({ _form: cause instanceof Error ? cause.message : "A new key was not generated." });
		} finally {
			endBusy();
		}
	}, [applyStatus, beginBusy, endBusy]);

	const turnOff = React.useCallback(async () => {
		const current = viewRef.current.status;
		if (!current || !beginBusy("disable")) return;
		try {
			const result = await saveSeoAdminIndexNow({ ...current.values, enabled: false }, current.updatedAt);
			if (!result.success) {
				setAdvancedErrors(result.errors);
				return;
			}
			applyStatus(result.indexNow);
			setMessage({ tone: "info", text: "IndexNow is off. No new URLs are queued or sent. Your key and choices are kept." });
		} catch (cause) {
			setAdvancedErrors({ _form: cause instanceof Error ? cause.message : "IndexNow was not turned off." });
		} finally {
			endBusy();
		}
	}, [applyStatus, beginBusy, endBusy]);

	const manualList = React.useMemo(
		() => parseIndexNowUrlList(manualText, status?.setup.origin ?? null),
		[manualText, status?.setup.origin],
	);

	const submitManual = React.useCallback(async () => {
		const list = manualList;
		if (list.error || !list.urls.length || !viewRef.current.status?.manualSubmissionReady || !beginBusy("submit")) return;
		const submitted = manualText;
		setManualMessage(null);
		try {
			const result = await submitSeoAdminIndexNow(list.urls);
			if (result.indexNow) applyStatus(result.indexNow);
			setManualText((current) => remainingIndexNowUrlList(current, submitted, result, list.invalid));
			markHistoryChanged();
			if (!result.success) {
				setManualMessage(result.detail);
				return;
			}
			const summary = indexNowSubmissionSummary(result, {
				invalid: list.invalid.length,
				waiting: result.indexNow.queue.pending,
				background: result.indexNow.capabilities.cron,
			});
			setManualMessage(summary);
			toasts.success("URL list queued", summary);
		} catch (cause) {
			setManualMessage(cause instanceof Error ? cause.message : "The URLs were not submitted. Your list was kept.");
		} finally {
			endBusy();
		}
	}, [applyStatus, beginBusy, endBusy, manualList, manualText, markHistoryChanged, toasts]);

	const runQueueAction = React.useCallback(async (
		name: "drain" | "retry",
		action: () => ReturnType<typeof drainSeoAdminIndexNow>,
		success: string,
	) => {
		if (!beginBusy(name)) return;
		try {
			const result = await action();
			if (result.indexNow) applyStatus(result.indexNow);
			markHistoryChanged();
			setMessage(result.success ? { tone: "info", text: success } : { tone: "error", text: result.detail });
		} catch (cause) {
			setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "The queue action did not complete." });
		} finally {
			endBusy();
		}
	}, [applyStatus, beginBusy, endBusy, markHistoryChanged]);

	const loadEntryPage = React.useCallback(async (entry: SeoAdminIndexNowSubmission, page: number) => {
		setExpanded((current) => ({ ...current, [entry.id]: { ...current[entry.id], loading: true } }));
		try {
			const result = await fetchSeoAdminIndexNowHistoryUrls(entry.id, page);
			setExpanded((current) => ({
				...current,
				[entry.id]: result.success ? { loading: false, page: result.urls } : { loading: false, error: result.detail },
			}));
		} catch (cause) {
			setExpanded((current) => ({
				...current,
				[entry.id]: { loading: false, error: cause instanceof Error ? cause.message : "The URL list could not be loaded." },
			}));
		}
	}, []);

	const toggleEntry = React.useCallback((entry: SeoAdminIndexNowSubmission) => {
		if (expanded[entry.id]) {
			setExpanded((current) => {
				const next = { ...current };
				delete next[entry.id];
				return next;
			});
			return;
		}
		void loadEntryPage(entry, 0);
	}, [expanded, loadEntryPage]);

	const unsavedSettings = view.status !== null && (
		(view.scope !== null && !equalIndexNowScope(view.scope.values.autoSubmitContentTypes, view.status.values.autoSubmitContentTypes)) ||
		(view.advanced !== null && INDEXNOW_ADVANCED_FIELDS.some((field) => view.advanced!.values[field] !== view.status!.values[field])));
	useWorkspaceDraftHold("indexnow-settings", unsavedSettings || busy !== null);
	const pageActive = useWorkspacePageActive();
	React.useEffect(() => {
		if (pageActive) return;
		setTurnOffOpen(false);
		setManualOpen(false);
	}, [pageActive]);

	if (loadError) {
		return (
			<Banner
				variant="error"
				icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
				title="IndexNow unavailable"
				description={loadError}
				action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}
			/>
		);
	}
	if (!status || !view.advanced || !view.scope) return <div className="shipit-seo-loading" role="status">Loading IndexNow...</div>;

	const pill = headerState(status);
	const issue = status.setup.issue;
	const verified = status.values.enabled && status.setup.verifiedAt !== null;
	const showSetup = !verified || status.readiness.state !== "ready";
	const setupCopy = indexNowSetupCopy(status);
	const available = status.contentTypes.map((item) => item.collection);
	const submittable = submittableIndexNowTypes(available, status.contentTypeRules);
	const savedScope = status.values.autoSubmitContentTypes;
	const draftScope = view.scope.values.autoSubmitContentTypes;
	const scopeDirty = !equalIndexNowScope(draftScope, savedScope);
	const scopeRows = indexNowScopeRows(status.contentTypes, savedScope, draftScope, status.contentTypeRules);
	const ruledRows = scopeRows.some((row) => row.noindexRule);
	const manualRuleNote = indexNowContentTypeRuleNote(status.contentTypeRules);
	const automationOn = status.values.enabled && status.values.autoSubmit;
	const automationActive = automationOn && status.readiness.state === "ready" && eligibleIndexNowScope(savedScope, submittable).length > 0;
	const missingTypes = automationOn ? unavailableIndexNowSelectedTypes(savedScope, status.contentTypes) : [];
	const draftOnlyRuled = eligibleIndexNowScope(draftScope, available).length > 0 && eligibleIndexNowScope(draftScope, submittable).length === 0;
	const canStart = verified && status.readiness.state === "ready" && status.capabilities.cron &&
		status.contentTypeDiscoveryAvailable && eligibleIndexNowScope(draftScope, submittable).length > 0;
	const advancedDirty = INDEXNOW_ADVANCED_FIELDS.some((field) => view.advanced!.values[field] !== status.values[field]);
	const waiting = status.queue.pending + status.queue.retrying;
	const legacyDeliveries = history.page
		? legacyIndexNowDeliveries(status.deliveries, history.page.historyStartedAt)
		: [];
	const range = indexNowHistoryRange(history);
	const enableReason = issue
		? issue.description
		: !status.capabilities.network
			? "This host does not give the plugin network access."
			: null;

	return (
		<div className="shipit-indexnow">
			<div className="shipit-indexnow-header">
				<div>
					<h2>IndexNow</h2>
					<p>Tell search engines that support IndexNow when your published pages change.</p>
					<p>Participating engines such as Bing receive these URLs. Google Search is not an IndexNow participant.</p>
				</div>
				<div className="shipit-indexnow-header-actions">
					<Badge variant={pill.variant} appearance="dot">{pill.label}</Badge>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						icon={ArrowClockwise}
						loading={busy === "refresh" || (busy === "setup" && verified)}
						disabled={busy !== null}
						onClick={checkAgain}
					>
						Check again
					</Button>
				</div>
			</div>

			{message ? (
				<p className="shipit-indexnow-message" data-tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>
			) : null}

			{showSetup ? (
				<section className="shipit-indexnow-card shipit-indexnow-setup" aria-labelledby="shipit-indexnow-setup-title">
					{issue ? (
						<div className="shipit-indexnow-notice" data-tone={issue.code === "local-site" ? "info" : "warning"} role="note">
							<Info size={18} weight="fill" aria-hidden="true" />
							<div>
								<strong>{issue.title}</strong>
								<p>{issue.description}</p>
							</div>
						</div>
					) : null}
					{status.values.enabled && !issue && status.readiness.state !== "ready" ? (
						<div className="shipit-indexnow-notice" data-tone="warning" role="note">
							<WarningCircle size={18} weight="fill" aria-hidden="true" />
							<div>
								<strong>{status.readiness.title}</strong>
								<p>{status.readiness.description}</p>
							</div>
						</div>
					) : null}
					<h3 id="shipit-indexnow-setup-title">{status.values.enabled ? "Finish IndexNow setup" : "Turn on IndexNow"}</h3>
					<p>{setupCopy.description}</p>
					<SetupStepList steps={setupSteps(status, busy === "setup", setupFailure?.step ?? null)} />
					{setupFailure ? <p className="shipit-seo-form-error" role="alert">{setupFailure.text}</p> : null}
					<div className="shipit-indexnow-setup-action">
						<Button
							type="button"
							icon={PaperPlaneTilt}
							loading={busy === "setup"}
							disabled={busy !== null || enableReason !== null}
							onClick={() => void setup()}
						>
							{setupFailure ? "Try again" : status.values.enabled ? "Check and turn on" : "Enable IndexNow"}
						</Button>
						{enableReason ? <p className="shipit-indexnow-muted">{issue?.code === "local-site" ? "Unavailable on this local address. Open IndexNow in the admin of your public site to turn it on." : enableReason}</p> : null}
					</div>
				</section>
			) : (
				<div className="shipit-indexnow-card shipit-indexnow-verified" role="status">
					<CheckCircle size={20} weight="fill" aria-hidden="true" />
					<div>
						<strong>Setup is verified for {status.setup.origin}</strong>
						<p>Ready describes setup and key verification. It does not tell you whether URLs are indexed. Last checked {formatDate(status.setup.verifiedAt)}.</p>
					</div>
				</div>
			)}

			<section className="shipit-indexnow-card shipit-indexnow-main" aria-label="IndexNow submission">
				<div ref={tabsRef} className="shipit-indexnow-tabs">
					<Tabs
						variant="underline"
						{...WRAPPING_UNDERLINE_TABS}
						tabs={[
							{ value: "automatic", label: "Automatic submission" },
							{ value: "history", label: "Submission history" },
						]}
						value={tab}
						onValueChange={(value) => {
							if (value === "automatic" || value === "history") setTab(value);
						}}
					/>
					<Button type="button" variant="secondary" icon={PaperPlaneTilt} onClick={() => { setManualMessage(null); setManualOpen(true); }}>
						Submit URLs manually
					</Button>
				</div>

				{tab === "automatic" ? (
					<div className="shipit-indexnow-tab shipit-indexnow-automatic">
						<div className="shipit-indexnow-row">
							<div>
								<h3>Submit changes automatically</h3>
								<p>When an entry of a saved content type is published, or a published entry changes, its URL is submitted. Drafts, private entries and noindex entries are skipped. Removed public URLs and old addresses after a URL change are reported as separate removal notifications.</p>
								<p>Existing content is not submitted when this is turned on. Turning it off stops automatic submission only. Manual submission keeps working.</p>
							</div>
							<div className="shipit-indexnow-row-action">
								{automationOn ? (
									<Switch
										label={automationActive ? "On" : "On, not active"}
										controlFirst={false}
										checked
										disabled={busy !== null}
										onCheckedChange={(checked) => { if (!checked) void saveAutomation("stop"); }}
									/>
								) : (
									<>
										<Badge variant="neutral" appearance="dot">Off</Badge>
										<Button type="button" variant="primary" loading={busy === "automation"} disabled={busy !== null || !canStart} onClick={() => void saveAutomation("start")}>
											Start automatic submission
										</Button>
									</>
								)}
							</div>
						</div>
						{!automationOn && !canStart ? (
							<p className="shipit-indexnow-muted">
								{!verified
									? "Available after IndexNow is on and its key file is verified."
									: !status.capabilities.cron
										? "This host cannot run background work, so only manual submission is available."
										: !status.contentTypeDiscoveryAvailable
											? "This site could not list its public content types. Manual submission remains available."
											: draftOnlyRuled
												? "Every selected content type has a noindex rule in Indexing rules. Choose another content type."
												: "Choose at least one public content type."}
							</p>
						) : null}
						{automationOn && !automationActive && status.readiness.state !== "ready" ? (
							<p className="shipit-indexnow-muted">{status.readiness.description}</p>
						) : null}

						<fieldset className="shipit-indexnow-types" aria-describedby={scopeHelpId}>
							<legend>Content types</legend>
							<p id={scopeHelpId}>Choose the content types to submit, then save. Checking a box does not change what is submitted until you save.</p>
							{savedScope === null ? (
								<p className="shipit-indexnow-muted">All public content types are selected, including types added later. Changing a box saves the checked types instead.</p>
							) : null}
							{status.contentTypeDiscoveryAvailable ? (
								scopeRows.length ? (
									<ul>
										{scopeRows.map((row) => (
											<li key={row.collection}>
												<Checkbox
													label={row.label}
													checked={row.checked}
													disabled={busy !== null}
													onCheckedChange={(checked) => updateScope(row.collection, checked === true)}
												/>
												{row.state !== null || row.noindexRule ? (
													<span className="shipit-indexnow-type-state">
														{row.noindexRule ? <Badge variant="warning">Noindex rule</Badge> : null}
														{row.state === "saved" ? <span className="shipit-indexnow-saved">Saved</span> : null}
														{row.state === "unsaved" ? <span className="shipit-indexnow-unsaved">Not saved yet</span> : null}
													</span>
												) : null}
											</li>
										))}
									</ul>
								) : <p>This site has no public content types to submit automatically.</p>
							) : <p>Public content types could not be listed. Manual submission remains available.</p>}
							{ruledRows ? (
								<p className="shipit-indexnow-muted">Types marked Noindex rule are not submitted while their content type rule is on. Their choice is kept for when the rule is removed.</p>
							) : null}
							{missingTypes.length ? (
								<p className="shipit-indexnow-muted">Saved types not found on this site are ignored: {missingTypes.join(", ")}.</p>
							) : null}
							{scopeDirty ? (
								<div className="shipit-indexnow-unsaved-bar" role="status">
									<p>
										<strong>Unsaved selection.</strong>{" "}
										{automationOn
											? `Automatic submission still covers ${savedScope === null && submittable.length === available.length ? "every public content type" : eligibleIndexNowScope(savedScope, submittable).map((name) => status.contentTypes.find((item) => item.collection === name)?.label ?? name).join(", ") || "no content type"} until you save.`
											: "Save to keep this selection."}
									</p>
									<div>
										<Button type="button" variant="secondary" disabled={busy !== null} onClick={discardScope}>Discard changes</Button>
										<Button type="button" variant="primary" loading={busy === "automation"} disabled={busy !== null} onClick={() => void saveAutomation("scope")}>Save content types</Button>
									</div>
								</div>
							) : null}
							{automationError ? <p className="shipit-seo-form-error" role="alert">{automationError}</p> : null}
							<p className="shipit-indexnow-muted">Only content types with public pages are listed. Private collections, such as form submissions, never appear. Entry pages are submitted. Category and tag archive pages are not. Noindexed entries are skipped, including every entry of a content type with a noindex rule in Indexing rules.</p>
						</fieldset>

						<details
							ref={advancedRef}
							className="shipit-indexnow-advanced"
							open={advancedOpen}
							onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
						>
							<summary>
								<span>
									<strong>Advanced</strong>
									<span>Key, key file location, batch size, retry limits, turn off IndexNow</span>
								</span>
								<CaretDown size={16} aria-hidden="true" />
							</summary>
							<form
								className="shipit-indexnow-advanced-content"
								noValidate
								onSubmit={(event) => { event.preventDefault(); void saveAdvanced(); }}
							>
								<div className="shipit-indexnow-key-row">
									<Input
										label="Verification key"
										data-seo-setting="indexNowKey"
										description="This key verifies your site. It is public in the verification file."
										value={view.advanced.values.apiKey}
										maxLength={128}
										error={advancedErrors.apiKey}
										aria-invalid={Boolean(advancedErrors.apiKey)}
										onChange={(event) => updateAdvanced("apiKey", event.target.value)}
									/>
									<Button type="button" variant="secondary" icon={Key} loading={busy === "key"} disabled={busy !== null} onClick={() => void generateKey()}>
										Generate new key
									</Button>
								</div>
								<Input
									label="Key file location"
									data-seo-setting="indexNowKeyLocation"
									description={indexNowKeyLocationHelp(status.setup.keyRoute, view.advanced.values.keyLocation)}
									value={view.advanced.values.keyLocation}
									error={advancedErrors.keyLocation}
									aria-invalid={Boolean(advancedErrors.keyLocation)}
									onChange={(event) => updateAdvanced("keyLocation", event.target.value)}
								/>
								<div className="shipit-indexnow-number-grid">
									<Input label="Batch size" data-seo-setting="indexNowBatchSize" type="number" min={1} max={1000} value={String(view.advanced.values.batchSize)} error={advancedErrors.batchSize} aria-invalid={Boolean(advancedErrors.batchSize)} onChange={(event) => updateAdvanced("batchSize", Number(event.target.value))} />
									<Input label="Resend interval (seconds)" data-seo-setting="indexNowResendInterval" type="number" min={300} max={86400} value={String(view.advanced.values.minIntervalSeconds)} error={advancedErrors.minIntervalSeconds} aria-invalid={Boolean(advancedErrors.minIntervalSeconds)} onChange={(event) => updateAdvanced("minIntervalSeconds", Number(event.target.value))} />
									<Input label="Maximum attempts" data-seo-setting="indexNowMaxAttempts" type="number" min={1} max={10} value={String(view.advanced.values.maxAttempts)} error={advancedErrors.maxAttempts} aria-invalid={Boolean(advancedErrors.maxAttempts)} onChange={(event) => updateAdvanced("maxAttempts", Number(event.target.value))} />
								</div>
								{advancedErrors._form ? <p className="shipit-seo-form-error" role="alert">{advancedErrors._form}</p> : null}
								<div className="shipit-indexnow-form-footer">
									<span>{advancedDirty ? "Unsaved changes" : "Saved"}</span>
									<div>
										<Button type="button" variant="secondary" disabled={!advancedDirty || busy !== null} onClick={discardAdvanced}>Discard changes</Button>
										<Button type="submit" variant="primary" loading={busy === "advanced"} disabled={!advancedDirty || busy !== null}>Save advanced settings</Button>
									</div>
								</div>
								<details className="shipit-indexnow-technical">
									<summary>Technical details</summary>
									<dl>
										<div><dt>Site address</dt><dd>{status.setup.origin ?? "Not set"}</dd></div>
										<div><dt>Installation</dt><dd>{status.setup.installation === "astro" ? "Astro integration" : status.setup.installation === "legacy" ? "Plugin options" : "Not reported by this host"}</dd></div>
										<div><dt>Key file check access</dt><dd>{status.setup.hostPermission === null ? "Not reported" : status.setup.hostPermission ? "Allowed for this hostname" : "Not allowed"}</dd></div>
										<div><dt>Key file route</dt><dd>{status.setup.keyRoute === "injected" ? "/indexnow-key.txt from this plugin" : status.setup.keyRoute === "existing" ? "Served by the site" : status.setup.keyRoute === "unavailable" ? "Unavailable (site not at its root path)" : "Not reported"}</dd></div>
										<div><dt>Key file</dt><dd>{status.keyLocationUrl ?? "Not available"}</dd></div>
										<div><dt>Endpoint</dt><dd>{status.endpoint}</dd></div>
										<div><dt>Background queue</dt><dd>{status.capabilities.cron ? "Available" : "Unavailable"}</dd></div>
									</dl>
									<p>Developers install the plugin through its Astro integration in the Astro configuration and set Astro's <code>site</code> option to the public HTTPS address. The integration serves the key file unless the site already owns its route. These installation settings cannot be changed from this admin.</p>
								</details>
								{status.values.enabled ? (
									<div className="shipit-indexnow-danger">
										<div>
											<strong>Turn off IndexNow</strong>
											<p>Stops queuing and sending. The key and your choices are kept.</p>
										</div>
										<Button type="button" variant="secondary-destructive" loading={busy === "disable"} disabled={busy !== null} onClick={() => setTurnOffOpen(true)}>Turn off IndexNow</Button>
									</div>
								) : null}
							</form>
						</details>
					</div>
				) : (
					<HistoryPanel
						status={status}
						history={history}
						range={range}
						busy={busy}
						expanded={expanded}
						legacyDeliveries={legacyDeliveries}
						waiting={waiting}
						onChange={(change) => void loadHistory(change)}
						onToggle={toggleEntry}
						onPage={(entry, page) => void loadEntryPage(entry, page)}
						onRetry={(entry) => void runQueueAction("retry", () => retrySeoAdminIndexNowSubmission(entry.id), "The failed URLs of this submission were queued again.")}
						onRetryAll={() => void runQueueAction("retry", retrySeoAdminIndexNow, "Failed URLs were queued again.")}
						onSendWaiting={() => void runQueueAction("drain", () => drainSeoAdminIndexNow(true), "Delivery was attempted for the next batch. Check Submission history for each result.")}
					/>
				)}
			</section>

			<Dialog.Root role="alertdialog" open={pageActive && turnOffOpen} onOpenChange={(open) => { if (busy !== "disable") setTurnOffOpen(open); }}>
				<Dialog size="sm" className="shipit-seo-delete-dialog">
					<Dialog.Title>Turn off IndexNow?</Dialog.Title>
					<Dialog.Description>
						Queued and retrying URLs stop being sent, and no new URLs are queued. The key, the content types and the other settings are kept, so you can turn it on again.
					</Dialog.Description>
					<div className="shipit-seo-dialog-actions">
						<Button type="button" variant="secondary" disabled={busy === "disable"} onClick={() => setTurnOffOpen(false)}>Cancel</Button>
						<Button type="button" variant="destructive" loading={busy === "disable"} disabled={busy !== null && busy !== "disable"}
							onClick={() => void turnOff().then(() => setTurnOffOpen(false))}>
							Turn off IndexNow
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			<Dialog.Root open={pageActive && manualOpen} onOpenChange={setManualOpen}>
				<Dialog size="lg" className="shipit-indexnow-dialog">
					<Dialog.Title>Submit URLs manually</Dialog.Title>
					<Dialog.Description>
						Paste URLs from {status.setup.origin ?? "this site"}, one per line, or paths that start with /. Up to {INDEXNOW_MANUAL_URL_LIMIT.toLocaleString("en")} at a time. Manual submission works while automatic submission is off.
					</Dialog.Description>
					<Textarea
						label="URLs"
						rows={8}
						spellCheck={false}
						value={manualText}
						placeholder={"/about\n/blog/latest-post"}
						error={manualTooLarge ? "The pasted list is too large. Split it into smaller groups; the previous list was kept." : manualList.error ?? undefined}
						onChange={(event) => {
							if (event.target.value.length > INDEXNOW_MANUAL_TEXT_LIMIT) {
								setManualTooLarge(true);
								return;
							}
							setManualTooLarge(false);
							setManualText(event.target.value);
						}}
					/>
					{manualText.trim() && !manualList.error ? (
						<p className="shipit-indexnow-muted" role="status">
							{manualList.urls.length} {manualList.urls.length === 1 ? "URL" : "URLs"} ready
							{manualList.duplicates ? `, ${manualList.duplicates} ${manualList.duplicates === 1 ? "duplicate" : "duplicates"} removed` : ""}
							{manualList.invalid.length ? `, ${manualList.invalid.length} ${manualList.invalid.length === 1 ? "line needs" : "lines need"} correction and will stay in the list` : ""}.
						</p>
					) : null}
					{manualList.invalid.length ? <p className="shipit-seo-form-error">{indexNowUrlIssueSummary(manualList.invalid)}</p> : null}
					{manualRuleNote ? <p className="shipit-indexnow-muted">{manualRuleNote}</p> : null}
					{!status.manualSubmissionReady ? <p className="shipit-indexnow-muted">Available after IndexNow is on and its key file is verified.</p> : null}
					{manualMessage ? <p className="shipit-indexnow-message" data-tone="info" role="status">{manualMessage}</p> : null}
					<div className="shipit-seo-dialog-actions">
						<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Close</Button>} />
						<Button
							type="button"
							icon={PaperPlaneTilt}
							loading={busy === "submit"}
							disabled={busy !== null || Boolean(manualList.error) || !manualList.urls.length || !status.manualSubmissionReady}
							onClick={() => void submitManual()}
						>
							{manualList.urls.length ? `Submit ${manualList.urls.length} ${manualList.urls.length === 1 ? "URL" : "URLs"}` : "Submit URLs"}
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}

function HistoryPanel({
	status,
	history,
	range,
	busy,
	expanded,
	legacyDeliveries,
	waiting,
	onChange,
	onToggle,
	onPage,
	onRetry,
	onRetryAll,
	onSendWaiting,
}: {
	status: SeoAdminIndexNowStatus;
	history: IndexNowHistoryState;
	range: ReturnType<typeof indexNowHistoryRange>;
	busy: Busy;
	expanded: Record<string, { loading: boolean; page?: SeoAdminIndexNowHistoryUrlsPage; error?: string }>;
	legacyDeliveries: SeoAdminIndexNowStatus["deliveries"];
	waiting: number;
	onChange: (change: IndexNowHistoryChange) => void;
	onToggle: (entry: SeoAdminIndexNowSubmission) => void;
	onPage: (entry: SeoAdminIndexNowSubmission, page: number) => void;
	onRetry: (entry: SeoAdminIndexNowSubmission) => void;
	onRetryAll: () => void;
	onSendWaiting: () => void;
}) {
	const page = history.page;
	const origin = status.setup.origin;
	return (
		<div className="shipit-indexnow-tab shipit-indexnow-history">
			<div className="shipit-indexnow-filters">
				<Select<"all" | IndexNowSubmissionStatus>
					label="Status"
					value={history.status ?? "all"}
					items={STATUS_FILTERS}
					onValueChange={(value) => {
						if (value) onChange({ kind: "filters", status: value === "all" ? null : value, source: history.source });
					}}
				/>
				<Select<"all" | IndexNowSubmissionSource>
					label="Source"
					value={history.source ?? "all"}
					items={SOURCE_FILTERS}
					onValueChange={(value) => {
						if (value) onChange({ kind: "filters", status: history.status, source: value === "all" ? null : value });
					}}
				/>
				<div className="shipit-indexnow-filter-actions">
					{waiting > 0 && status.manualSubmissionReady ? (
						<Button type="button" size="sm" variant="secondary" loading={busy === "drain"} disabled={busy !== null} onClick={onSendWaiting}>
							Send {waiting} waiting {waiting === 1 ? "URL" : "URLs"}
						</Button>
					) : null}
					{status.queue.failed > 0 && status.manualSubmissionReady ? (
						<Button type="button" size="sm" variant="secondary" loading={busy === "retry"} disabled={busy !== null} onClick={onRetryAll}>
							Retry all failed
						</Button>
					) : null}
					<Button type="button" size="sm" variant="secondary" icon={ArrowClockwise} loading={history.loading} disabled={history.loading} onClick={() => onChange({ kind: "reload" })}>
						Refresh
					</Button>
				</div>
			</div>
			<p className="shipit-indexnow-muted">Sent means IndexNow answered 200. Accepted means it answered 202 and key validation is pending. Neither confirms that a URL is indexed, and indexing dates are not available.</p>
			{history.error ? <p className="shipit-seo-form-error" role="alert">{history.error}</p> : null}
			{page && !page.available ? (
				<p className="shipit-indexnow-notice" data-tone="warning" role="note">Submission history is unavailable on this site. URLs are still queued and sent.</p>
			) : null}
			{page?.available && page.items.length === 0 && !history.loading ? (
				<p className="shipit-indexnow-empty">No submissions {history.status || history.source ? "match these filters" : "yet"}. A URL appears here as soon as it is queued.</p>
			) : null}
			{page?.items.length ? (
				<div className="shipit-indexnow-table-wrap">
					<table className="shipit-indexnow-table" aria-busy={history.loading}>
						<thead>
							<tr>
								<th scope="col">URL</th>
								<th scope="col">Source</th>
								<th scope="col">Change</th>
								<th scope="col">Last attempt</th>
								<th scope="col">Status</th>
								<th scope="col">HTTP result</th>
								<th scope="col"><span className="shipit-seo-visually-hidden">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{page.items.map((entry) => {
								const presentation = indexNowSubmissionPresentation(entry, page.maxAttempts, formatTime);
								const counts = indexNowCountsSummary(entry);
								const open = expanded[entry.id];
								const group = entry.urlCount > 1;
								return (
									<React.Fragment key={entry.id}>
										<tr>
											<td data-label="URL">
												{group ? (
													<button
														type="button"
														className="shipit-indexnow-group-toggle"
														aria-expanded={Boolean(open)}
														onClick={() => onToggle(entry)}
													>
														{open ? <CaretDown size={14} aria-hidden="true" /> : <CaretRight size={14} aria-hidden="true" />}
														<span>
															<strong>{entry.urlCount} URLs</strong>
															<small>{entry.source === "manual" ? "Manual list" : indexNowEventLabel(entry.event)}</small>
														</span>
													</button>
												) : (
													<span className="shipit-indexnow-url">{indexNowDisplayUrl(entry.sampleUrls[0]!, origin)}</span>
												)}
											</td>
											<td data-label="Source">{indexNowSourceLabel(entry.source)}</td>
											<td data-label="Change">{indexNowEventLabel(entry.event)}</td>
											<td data-label="Last attempt">{entry.lastAttemptAt ? formatTime(entry.lastAttemptAt) : "No attempt yet"}</td>
											<td data-label="Status">
												<div>
													<Badge variant={TONE_BADGE[presentation.tone]}>{presentation.label}</Badge>
													{presentation.detail ? <small>{presentation.detail}</small> : null}
													{counts ? <small>{counts}</small> : null}
												</div>
											</td>
											<td data-label="HTTP result">{indexNowHttpResult(entry)}</td>
											<td data-label="Actions">
												{entry.status === "failed" && status.manualSubmissionReady ? (
													<Button type="button" size="sm" variant="secondary" loading={busy === "retry"} disabled={busy !== null} onClick={() => onRetry(entry)}>Retry</Button>
												) : null}
											</td>
										</tr>
										{group && open ? (
											<tr className="shipit-indexnow-detail-row">
												<td colSpan={7}>
													<HistoryUrls entry={entry} state={open} origin={origin} onPage={(next) => onPage(entry, next)} />
												</td>
											</tr>
										) : null}
									</React.Fragment>
								);
							})}
						</tbody>
					</table>
				</div>
			) : null}
			{page?.available && (range || history.pageIndex > 0) ? (
				<div className="shipit-indexnow-pagination">
					<span>{range ? `Showing ${range.from} to ${range.to} of ${range.total} submissions` : "No submissions on this page"}</span>
					<div>
						<Button type="button" size="sm" variant="secondary" disabled={history.loading || history.pageIndex === 0} onClick={() => onChange({ kind: "previous" })}>Previous</Button>
						<Button type="button" size="sm" variant="secondary" disabled={history.loading || !page.cursor} onClick={() => onChange({ kind: "next" })}>Next</Button>
					</div>
				</div>
			) : null}
			{legacyDeliveries.length ? (
				<details className="shipit-indexnow-legacy">
					<summary>Earlier requests ({legacyDeliveries.length})</summary>
					<p className="shipit-indexnow-muted">These requests were sent before submission history existed. Their source and change were not recorded.</p>
					<ul>
						{legacyDeliveries.map((delivery) => (
							<li key={delivery.id}>
								<span>{formatDate(delivery.createdAt, shortDateTime)}</span>
								<span>{delivery.urlCount} {delivery.urlCount === 1 ? "URL" : "URLs"}</span>
								<span>{delivery.status === "accepted" ? delivery.httpStatus === 202 ? "Accepted" : "Sent" : delivery.status === "retry" ? "Retry scheduled" : "Failed"}</span>
								<span>{delivery.httpStatus ?? "No response"}</span>
							</li>
						))}
					</ul>
				</details>
			) : null}
		</div>
	);
}

function HistoryUrls({
	entry,
	state,
	origin,
	onPage,
}: {
	entry: SeoAdminIndexNowSubmission;
	state: { loading: boolean; page?: SeoAdminIndexNowHistoryUrlsPage; error?: string } | undefined;
	origin: string | null;
	onPage: (page: number) => void;
}) {
	if (state?.loading && !state.page) return <p className="shipit-indexnow-muted" role="status">Loading URLs...</p>;
	if (state?.error) return <p className="shipit-seo-form-error" role="alert">{state.error}</p>;
	const page = state?.page;
	if (!page) return null;
	if (page.detail === "expired" || page.detail === "expiring") {
		return (
			<div className="shipit-indexnow-detail">
				<p className="shipit-indexnow-muted">
					{page.detail === "expired"
						? "Full details expired to keep history storage small. The first URLs, counts, source and change are kept."
						: "Full details are not available for this submission. The first URLs, counts, source and change are kept."}
				</p>
				<ul>
					{entry.sampleUrls.map((url, index) => (
						<li key={url}>{indexNowDisplayUrl(url, origin)}{entry.sampleSkipped.includes(index) ? <small> Skipped, submitted recently</small> : null}</li>
					))}
				</ul>
			</div>
		);
	}
	return (
		<div className="shipit-indexnow-detail">
			<ul>
				{page.items.map((item) => (
					<li key={item.url}>{indexNowDisplayUrl(item.url, origin)}{item.skipped ? <small> Skipped, submitted recently</small> : null}</li>
				))}
			</ul>
			{page.pageCount > 1 ? (
				<div className="shipit-indexnow-detail-pages">
					<span>URLs {page.page * 100 + 1} to {page.page * 100 + page.items.length} of {page.urlCount}</span>
					<Button type="button" size="sm" variant="secondary" disabled={state?.loading || page.page === 0} onClick={() => onPage(page.page - 1)}>Previous URLs</Button>
					<Button type="button" size="sm" variant="secondary" disabled={state?.loading || page.page >= page.pageCount - 1} onClick={() => onPage(page.page + 1)}>Next URLs</Button>
				</div>
			) : null}
		</div>
	);
}
