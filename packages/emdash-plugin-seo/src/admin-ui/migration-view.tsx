import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import {
	ArrowCounterClockwise,
	ArrowsClockwise,
	CheckCircle,
	ClockCounterClockwise,
	Database,
	DownloadSimple,
	ShieldCheck,
	Trash,
	WarningCircle,
} from "@phosphor-icons/react";
import type {
	CoreSeoFieldPlan,
	CoreSeoMigrationConflictPolicy,
	SeoAdminLegacyDiscardResult,
	SeoAdminMigrationOperationResult,
	SeoAdminMigrationPlanItem,
	SeoAdminMigrationPlanResponse,
	SeoAdminMigrationStatusResponse,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as React from "react";

import {
	applySeoAdminMigration,
	discardSeoAdminLegacyOverride,
	fetchSeoAdminMigrationPlan,
	fetchSeoAdminMigrationStatus,
	rollbackSeoAdminMigration,
} from "./api.ts";
import {
	batchesFromMigrationHistory,
	fetchCompleteMigrationBatch,
	mergeMigrationHistoryPages,
	type MigrationBatch,
} from "./migration-history.ts";
import {
	seoMigrationFeedback,
	type SeoMigrationAction,
} from "./migration-feedback.ts";
import {
	LEGACY_BACKUP_UNAVAILABLE_MESSAGES,
	acknowledgeLegacyBackup,
	beginLegacyDiscard,
	initialLegacyDiscardState,
	legacyBackupFilename,
	legacyDiscardEligibility,
	legacyDiscardBusy,
	legacyDiscardGuard,
	legacyDiscardSubject,
	markLegacyBackupDownloaded,
	receiveLegacyBackup,
	resetLegacyDiscard,
	settleLegacyDiscard,
	startLegacyBackup,
	type LegacyDiscardEligibility,
	type LegacyDiscardState,
	type LegacyDiscardTarget,
} from "./legacy-discard-model.ts";
import { useSeoToasts } from "./workspace-shell.tsx";

const APPLY_CONFIRMATION = "MIGRATE_TO_CORE_SEO";
const ROLLBACK_CONFIRMATION = "ROLLBACK_CORE_SEO";

interface MigrationViewProps {
	legacyCount: number;
	onOverviewRefresh: () => Promise<void>;
}

function stateVariant(state: string): "success" | "warning" | "error" | "secondary" {
	if (state === "ready" || state === "applied" || state === "rolled-back") return "success";
	if (state === "conflict" || state === "prepared" || state === "changed-since-migration") return "warning";
	if (state === "empty") return "secondary";
	return "error";
}

function stateLabel(state: string): string {
	return state
		.replace(/^not-applied:/, "Not applied: ")
		.split("-")
		.map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
		.join(" ");
}

function fieldActionVariant(action: CoreSeoFieldPlan["action"]): "success" | "warning" | "error" | "secondary" {
	if (action === "copy" || action === "same") return "success";
	if (action === "overwrite-core") return "warning";
	if (action === "conflict") return "error";
	return "secondary";
}

function displayValue(value: string | boolean | null): string {
	if (value === null) return "Not set";
	if (typeof value === "boolean") return value ? "Yes" : "No";
	return value;
}

function readableDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? "Unknown"
		: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function operationDescription(result: SeoAdminMigrationOperationResult): string {
	if ("error" in result) {
		return result.error === "confirmation_required"
			? "The confirmation phrase did not match. No records were changed."
			: "The conditional write capabilities required for migration are unavailable. No records were changed.";
	}
	const summary = Object.entries(result.summary)
		.map(([status, count]) => `${count} ${stateLabel(status).toLowerCase()}`)
		.join(", ");
	return summary || "The operation completed without changing a record.";
}

function FieldMapping({ field }: { field: CoreSeoFieldPlan }) {
	return (
		<div className="shipit-seo-migration-field">
			<div>
				<strong>{stateLabel(field.field)}</strong>
				<Badge variant={fieldActionVariant(field.action)}>
					{stateLabel(field.action)}
				</Badge>
			</div>
			<dl>
				<div>
					<dt>Legacy</dt>
					<dd>{displayValue(field.legacy)}</dd>
				</div>
				<div>
					<dt>Current core</dt>
					<dd>{displayValue(field.current)}</dd>
				</div>
				<div>
					<dt>After migration</dt>
					<dd>{displayValue(field.target)}</dd>
				</div>
			</dl>
		</div>
	);
}

const LEGACY_DISCARD_MESSAGES: Record<Extract<SeoAdminLegacyDiscardResult, { success: false }>["error"], string> = {
	invalid_input: "The request was incomplete. Rebuild the plan and try again.",
	confirmation_required: "The discard was not confirmed.",
	not_found: "The legacy record no longer exists.",
	recovery_pending: "A migration of this record is in progress. Apply the migration again to finish it.",
	preview_stale: "The record or the entry changed after this plan was built. Review the rebuilt plan.",
};

function backupSize(bytes: number): string {
	return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/** Saves the delivered export unchanged; the browser's download is not proof that it was kept. */
function downloadLegacyBackup(contents: string, filename: string): void {
	const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.rel = "noopener";
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

const ALIAS_NO_REMOVAL =
	"This record is stored under a slug that any entry with the same slug shares, so removal is not offered here.";

/** Backup, acknowledgement and guarded removal for one exact-ID record. */
function LegacyDiscardControls({
	item,
	eligibility,
	state,
	stale,
	busy,
	onPrepare,
	onDownload,
	onAcknowledge,
	onConfirm,
}: {
	item: SeoAdminMigrationPlanItem;
	eligibility: LegacyDiscardEligibility;
	/** The workflow state when it concerns this record, otherwise null. */
	state: LegacyDiscardState | null;
	stale: boolean;
	/** Another record's delete is in flight. */
	busy: boolean;
	onPrepare: () => void;
	onDownload: () => void;
	onAcknowledge: (acknowledged: boolean) => void;
	onConfirm: () => void;
}) {
	if (!eligibility.eligible) {
		return eligibility.reason === "alias" ? <p className="shipit-seo-migration-discard">{ALIAS_NO_REMOVAL}</p> : null;
	}
	if (stale) {
		return (
			<p className="shipit-seo-migration-discard" role="status">
				Out of date. This row stays disabled until the rebuilt plan loads.
			</p>
		);
	}
	if (state?.status === "ready" || state?.status === "discarding") {
		const ready = state.status === "ready" ? state : null;
		const binding = state.binding;
		const unsupported = item.plan?.unmappedRobots ?? [];
		return (
			<div className="shipit-seo-migration-discard">
				<p>
					Backup of the complete stored record for {binding.ref}
					{binding.locale ? ` (${binding.locale})` : ""}, {backupSize(ready?.bytes ?? 0)}, plan{" "}
					<code>{binding.fingerprint.slice(7, 19)}</code>. Downloading it is not enough; keep the file outside this site.
				</p>
				<div className="shipit-seo-migration-discard__actions">
					<Button type="button" size="sm" variant="secondary" icon={DownloadSimple} disabled={!ready} onClick={onDownload}>
						{ready?.downloaded ? "Download again" : "Download backup"}
					</Button>
					<label className="shipit-seo-migration-discard__acknowledge">
						<input
							type="checkbox"
							checked={ready?.acknowledged ?? false}
							disabled={!ready}
							onChange={(event) => onAcknowledge(event.target.checked)}
						/>
						<span>I saved this backup outside the site</span>
					</label>
					<Dialog.Root role="alertdialog">
						<Dialog.Trigger
							render={(props) => (
								<Button
									{...props}
									type="button"
									size="sm"
									variant="secondary"
									icon={Trash}
									loading={state.status === "discarding"}
									disabled={!ready?.acknowledged}
								>
									Discard legacy record
								</Button>
							)}
						/>
						<Dialog size="sm" className="shipit-seo-delete-dialog">
							<Dialog.Title>Discard this legacy SEO record?</Dialog.Title>
							<Dialog.Description>
								Removing {binding.sourceOverrideId} is irreversible on this site and there is no automatic
								restore. Only the backup you saved can be used to re-create it by hand. This record stops
								supplying values; another legacy record, EmDash SEO values or this plugin's defaults may then decide
								those fields.{" "}
								{unsupported.length
									? `Robots directives EmDash SEO cannot store may stop applying: ${unsupported.join(", ")}.`
									: "Robots directives EmDash SEO cannot store may stop applying."}{" "}
								Check the public page after removal to see its actual output.
							</Dialog.Description>
							<div className="shipit-seo-dialog-actions">
								<Dialog.Close
									render={(props) => (
										<Button {...props} type="button" variant="secondary">
											Cancel
										</Button>
									)}
								/>
								<Dialog.Close
									render={(props) => (
										<Button {...props} type="button" variant="destructive" onClick={onConfirm}>
											Discard record
										</Button>
									)}
								/>
							</div>
						</Dialog>
					</Dialog.Root>
				</div>
			</div>
		);
	}
	return (
		<div className="shipit-seo-migration-discard">
			{state?.status === "unavailable" ? (
				<p role="status">
					{LEGACY_BACKUP_UNAVAILABLE_MESSAGES[state.reason]}
					{state.message ? ` ${state.message}` : ""}
				</p>
			) : null}
			<Button
				type="button"
				size="sm"
				variant="secondary"
				icon={DownloadSimple}
				loading={state?.status === "preparing"}
				disabled={state?.status === "preparing" || busy}
				onClick={onPrepare}
			>
				Prepare backup before removal
			</Button>
		</div>
	);
}

function MigrationPlanRow({
	item,
	selected,
	writeAvailable,
	discardEligibility,
	discardState,
	stale,
	discardBusy,
	onSelectedChange,
	onPrepareBackup,
	onDownloadBackup,
	onAcknowledgeBackup,
	onConfirmDiscard,
}: {
	item: SeoAdminMigrationPlanItem;
	selected: boolean;
	writeAvailable: boolean;
	discardEligibility: LegacyDiscardEligibility;
	discardState: LegacyDiscardState | null;
	stale: boolean;
	discardBusy: boolean;
	onSelectedChange: (selected: boolean) => void;
	onPrepareBackup: () => void;
	onDownloadBackup: () => void;
	onAcknowledgeBackup: (acknowledged: boolean) => void;
	onConfirmDiscard: () => void;
}) {
	const selectable = writeAvailable && item.state === "ready" && !stale && !discardBusy;
	const mappedOnly = !writeAvailable && item.state === "ready";
	return (
		<article className={`shipit-seo-migration-row shipit-seo-migration-row--${item.state}`}>
			<div className="shipit-seo-migration-row__main">
				{writeAvailable ? (
					<label className="shipit-seo-migration-check">
						<input
							type="checkbox"
							checked={selected}
							disabled={!selectable}
							onChange={(event) => onSelectedChange(event.target.checked)}
						/>
						<span className="sr-only">Select {item.title ?? item.ref}</span>
					</label>
				) : (
					<span aria-hidden="true" />
				)}
				<div className="shipit-seo-migration-row__content">
					<div className="shipit-seo-migration-row__title">
						<div>
							<strong>{item.title ?? item.ref}</strong>
							<code>{item.ref}</code>
						</div>
						<Badge variant={stale ? "warning" : mappedOnly ? "secondary" : stateVariant(item.state)}>
							{stale ? "Out of date" : mappedOnly ? "Mapped" : stateLabel(item.state)}
						</Badge>
					</div>
					<p>{mappedOnly ? "Field mapping is available for review. This host cannot apply the migration." : item.detail}</p>
					<div className="shipit-seo-migration-row__meta">
						{item.collection ? <Badge variant="secondary">{item.collection}</Badge> : null}
						{item.plan ? <span>{item.plan.mappedFields.length} mapped fields</span> : null}
						{item.plan?.conflicts.length ? <span>{item.plan.conflicts.length} conflicts</span> : null}
						{item.plan?.unmappedRobots?.length ? (
							<span>Not carried to core SEO: {item.plan.unmappedRobots.join(", ")}</span>
						) : null}
					</div>
					<LegacyDiscardControls
						item={item}
						eligibility={discardEligibility}
						state={discardState}
						stale={stale}
						busy={discardBusy}
						onPrepare={onPrepareBackup}
						onDownload={onDownloadBackup}
						onAcknowledge={onAcknowledgeBackup}
						onConfirm={onConfirmDiscard}
					/>
				</div>
			</div>
			{item.plan ? (
				<details className="shipit-seo-migration-details">
					<summary>Review field mapping</summary>
					<div className="shipit-seo-migration-fields">
						{item.plan.fields.map((field) => <FieldMapping key={field.field} field={field} />)}
					</div>
				</details>
			) : null}
		</article>
	);
}

function BatchHistory({
	batches,
	activeBatchId,
	onActiveBatchChange,
}: {
	batches: MigrationBatch[];
	activeBatchId: string | null;
	onActiveBatchChange: (batchId: string) => void;
}) {
	return (
		<div className="shipit-seo-migration-batches" aria-label="Migration batches">
			{batches.map((batch) => {
				const applied = batch.records.filter((record) => record.status === "applied").length;
				const rolledBack = batch.records.filter((record) => record.status === "rolled-back").length;
				return (
					<button
						key={batch.id}
						type="button"
						aria-pressed={batch.id === activeBatchId}
						className={batch.id === activeBatchId ? "is-active" : ""}
						onClick={() => onActiveBatchChange(batch.id)}
					>
						<span>
							<strong>{readableDate(batch.createdAt)}</strong>
							<code>{batch.id}</code>
						</span>
						<span>{batch.records.length} records</span>
						<Badge variant={applied ? "success" : rolledBack ? "secondary" : "warning"}>
							{applied ? `${applied} applied` : rolledBack ? `${rolledBack} rolled back` : "Needs review"}
						</Badge>
					</button>
				);
			})}
		</div>
	);
}

export function MigrationView({ legacyCount, onOverviewRefresh }: MigrationViewProps) {
	const toasts = useSeoToasts();
	const [policy, setPolicy] = React.useState<CoreSeoMigrationConflictPolicy>("skip");
	const [plan, setPlan] = React.useState<SeoAdminMigrationPlanResponse | null>(null);
	const [history, setHistory] = React.useState<SeoAdminMigrationStatusResponse | null>(null);
	const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
	const [activeBatchId, setActiveBatchId] = React.useState<string | null>(null);
	const [activeBatch, setActiveBatch] = React.useState<MigrationBatch | null>(null);
	const [activeBatchLoading, setActiveBatchLoading] = React.useState(false);
	const [activeBatchError, setActiveBatchError] = React.useState<string | null>(null);
	const [applyConfirmation, setApplyConfirmation] = React.useState("");
	const [rollbackConfirmation, setRollbackConfirmation] = React.useState("");
	const [loadingPlan, setLoadingPlan] = React.useState(true);
	const [loadingHistory, setLoadingHistory] = React.useState(true);
	const [applying, setApplying] = React.useState(false);
	const [rollingBack, setRollingBack] = React.useState(false);
	const [planError, setPlanError] = React.useState<string | null>(null);
	const [historyError, setHistoryError] = React.useState<string | null>(null);
	const [operation, setOperation] = React.useState<{
		action: SeoMigrationAction;
		result: SeoAdminMigrationOperationResult;
	} | null>(null);

	const [planCursors, setPlanCursors] = React.useState<Array<string | undefined>>([undefined]);
	const [loadingOlderHistory, setLoadingOlderHistory] = React.useState(false);

	// Only the newest plan and history requests may write state; an older
	// response resolving later would otherwise replace fresher data.
	const planRequest = React.useRef(0);
	const historyRequest = React.useRef(0);

	// Async completions compare against the ref, so a backup or discard
	// finishing after a refresh or a newer selection cannot overwrite it.
	const [discardState, setDiscardStateValue] = React.useState<LegacyDiscardState>(initialLegacyDiscardState);
	const discardStateRef = React.useRef(discardState);
	const updateDiscardState = React.useCallback(
		(next: LegacyDiscardState | ((current: LegacyDiscardState) => LegacyDiscardState)) => {
			const value = typeof next === "function" ? next(discardStateRef.current) : next;
			discardStateRef.current = value;
			setDiscardStateValue(value);
		},
		[],
	);
	/** Rows a refused or unconfirmed removal left out of date until a rebuilt plan loads. */
	const [staleSources, setStaleSources] = React.useState<ReadonlySet<string>>(() => new Set());

	const mounted = React.useRef(true);
	React.useEffect(() => () => {
		mounted.current = false;
	}, []);

	const loadPlanPage = React.useCallback(async (
		cursor: string | undefined,
		options: { retain?: boolean; keepDiscard?: boolean } = {},
	) => {
		const request = ++planRequest.current;
		if (!options.keepDiscard) updateDiscardState(resetLegacyDiscard);
		setLoadingPlan(true);
		if (!options.retain) {
			setPlan(null);
			setStaleSources(new Set());
		}
		setPlanError(null);
		setSelected(new Set());
		try {
			const next = await fetchSeoAdminMigrationPlan(policy, undefined, cursor);
			if (request === planRequest.current) {
				setPlan(next);
				setStaleSources(new Set());
			}
		} catch (cause) {
			if (request === planRequest.current) {
				setPlanError(cause instanceof Error ? cause.message : "Failed to build the migration plan");
			}
		} finally {
			if (request === planRequest.current) setLoadingPlan(false);
		}
	}, [policy, updateDiscardState]);

	const loadPlan = React.useCallback(async () => {
		setPlanCursors([undefined]);
		await loadPlanPage(undefined);
	}, [loadPlanPage]);

	const nextPlanPage = () => {
		const cursor = plan?.cursor;
		if (!cursor) return;
		setPlanCursors((stack) => [...stack, cursor]);
		void loadPlanPage(cursor);
	};

	const previousPlanPage = () => {
		if (planCursors.length < 2) return;
		const stack = planCursors.slice(0, -1);
		setPlanCursors(stack);
		void loadPlanPage(stack[stack.length - 1]);
	};

	const loadHistory = React.useCallback(async () => {
		const request = ++historyRequest.current;
		setLoadingHistory(true);
		setLoadingOlderHistory(false);
		setHistoryError(null);
		try {
			const next = await fetchSeoAdminMigrationStatus({ limit: 100, latest: true });
			if (request === historyRequest.current) setHistory(next);
		} catch (cause) {
			if (request === historyRequest.current) {
				setHistoryError(cause instanceof Error ? cause.message : "Failed to load migration history");
			}
		} finally {
			if (request === historyRequest.current) setLoadingHistory(false);
		}
	}, []);

	const loadOlderHistory = React.useCallback(async () => {
		if (!history?.hasMore || !history.cursor) return;
		const request = ++historyRequest.current;
		const loaded = history;
		const cursor = history.cursor;
		setLoadingOlderHistory(true);
		setHistoryError(null);
		try {
			const next = await fetchSeoAdminMigrationStatus({ limit: 100, latest: true, cursor });
			if (request === historyRequest.current) setHistory(mergeMigrationHistoryPages(loaded, next));
		} catch (cause) {
			if (request === historyRequest.current) {
				setHistoryError(cause instanceof Error ? cause.message : "Failed to load older migration history");
			}
		} finally {
			if (request === historyRequest.current) setLoadingOlderHistory(false);
		}
	}, [history]);

	React.useEffect(() => {
		void loadPlan();
	}, [loadPlan]);

	React.useEffect(() => {
		void loadHistory();
	}, [loadHistory]);

	const historyBatches = React.useMemo(
		() => batchesFromMigrationHistory(history),
		[history],
	);
	React.useEffect(() => {
		setActiveBatchId((current) =>
			current && historyBatches.some((batch) => batch.id === current)
				? current
				: historyBatches[0]?.id ?? null,
		);
	}, [historyBatches]);

	React.useEffect(() => {
		if (!activeBatchId) {
			setActiveBatch(null);
			setActiveBatchError(null);
			setActiveBatchLoading(false);
			return;
		}
		let cancelled = false;
		setActiveBatch(null);
		setActiveBatchError(null);
		setActiveBatchLoading(true);
		void fetchCompleteMigrationBatch(activeBatchId, (options) =>
			fetchSeoAdminMigrationStatus(options),
		)
			.then((batch) => {
				if (!cancelled) setActiveBatch(batch);
			})
			.catch((cause: unknown) => {
				if (!cancelled)
					setActiveBatchError(
						cause instanceof Error
							? cause.message
							: "Failed to load the complete migration batch",
					);
			})
			.finally(() => {
				if (!cancelled) setActiveBatchLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeBatchId, history]);

	const completeActiveBatch =
		activeBatch?.id === activeBatchId ? activeBatch : null;
	const batches = React.useMemo(
		() =>
			historyBatches.map((batch) =>
				batch.id === completeActiveBatch?.id ? completeActiveBatch : batch,
			),
		[completeActiveBatch, historyBatches],
	);

	const readySources =
		plan?.items.filter((item) => item.state === "ready").map((item) => item.sourceOverrideId) ?? [];
	const writeAvailable = plan?.writeAvailable === true;
	const rollbackWriteAvailable =
		history?.writeAvailable === true && !loadingHistory && !loadingOlderHistory && !historyError;
	const canApply = writeAvailable && selected.size > 0 && applyConfirmation === APPLY_CONFIRMATION && !applying &&
		discardState.status !== "discarding";
	const canRollback = Boolean(
		rollbackWriteAvailable &&
		completeActiveBatch?.records.some((record) => record.status === "applied") &&
		rollbackConfirmation === ROLLBACK_CONFIRMATION &&
		!activeBatchLoading &&
		!activeBatchError &&
		!rollingBack &&
		discardState.status !== "discarding",
	);

	const planPager = plan && (planCursors.length > 1 || plan.hasMore) ? (
		<div className="shipit-seo-migration-selection">
			<span>
				Page {planCursors.length}
				{plan.hasMore ? ". More legacy records remain." : ". This is the last page."}
			</span>
			<div>
				<Button type="button" size="sm" variant="secondary" disabled={planCursors.length < 2 || loadingPlan || applying || discardState.status === "discarding"} onClick={previousPlanPage}>
					Previous page
				</Button>
				<Button type="button" size="sm" variant="secondary" disabled={!plan.hasMore || loadingPlan || applying || discardState.status === "discarding"} onClick={nextPlanPage}>
					Next page
				</Button>
			</div>
		</div>
	) : null;

	const setItemSelected = React.useCallback((ref: string, nextSelected: boolean) => {
		setSelected((current) => {
			const next = new Set(current);
			if (nextSelected) next.add(ref);
			else next.delete(ref);
			return next;
		});
	}, []);

	const discardTarget = (item: SeoAdminMigrationPlanItem): LegacyDiscardTarget => ({
		sourceOverrideId: item.sourceOverrideId,
		fingerprint: item.fingerprint,
		conflictPolicy: policy,
	});
	/** Keeps the reviewed rows visible, marked out of date, while the plan is built again. */
	const rebuildRetainedPlan = (sourceOverrideId: string, keepDiscard = false) => {
		setStaleSources((current) => new Set(current).add(sourceOverrideId));
		return loadPlanPage(planCursors[planCursors.length - 1], { retain: true, keepDiscard });
	};
	const prepareBackup = async (item: SeoAdminMigrationPlanItem) => {
		const target = discardTarget(item);
		const preparing = startLegacyBackup(discardStateRef.current, target);
		updateDiscardState(preparing);
		let received: LegacyDiscardState;
		try {
			const response = await fetchSeoAdminMigrationPlan(target.conflictPolicy, [target.sourceOverrideId], undefined, { snapshot: true });
			received = receiveLegacyBackup(discardStateRef.current, preparing.generation, { plan: response });
		} catch (error) {
			received = receiveLegacyBackup(discardStateRef.current, preparing.generation, { error });
		}
		if (received === discardStateRef.current) return;
		updateDiscardState(received);
		if (received.status === "unavailable" && received.reason === "plan-changed") {
			await rebuildRetainedPlan(target.sourceOverrideId);
		}
	};
	const downloadBackup = () => {
		const current = discardStateRef.current;
		if (current.status !== "ready") return;
		downloadLegacyBackup(current.document, legacyBackupFilename(current.binding));
		updateDiscardState(markLegacyBackupDownloaded(current, current.generation));
	};
	const acknowledgeBackup = (acknowledged: boolean) => {
		const current = discardStateRef.current;
		updateDiscardState(acknowledgeLegacyBackup(current, current.generation, acknowledged));
	};
	const confirmDiscard = async (item: SeoAdminMigrationPlanItem) => {
		// Checked again here: a refresh or another selection may have happened after the dialog opened.
		const current = discardStateRef.current;
		const binding = legacyDiscardGuard(current, discardTarget(item), current.generation);
		if (!binding || staleSources.has(item.sourceOverrideId)) {
			updateDiscardState(resetLegacyDiscard);
			toasts.error("Legacy record not discarded", "Prepare and acknowledge a backup of the current plan first.");
			return;
		}
		updateDiscardState(beginLegacyDiscard(current, binding));
		let outcome: "removed" | "refused" | "failed" = "failed";
		let message: string | undefined;
		let removedResult: Extract<SeoAdminLegacyDiscardResult, { success: true }> | null = null;
		try {
			const result = await discardSeoAdminLegacyOverride(
				{ sourceOverrideId: binding.sourceOverrideId, fingerprint: binding.fingerprint },
				binding.conflictPolicy,
				"DISCARD_LEGACY_SEO",
			);
			if (result.success) {
				outcome = "removed";
				removedResult = result;
			} else {
				outcome = "refused";
				message = LEGACY_DISCARD_MESSAGES[result.error];
			}
		} catch (cause) {
			message = cause instanceof Error ? cause.message : undefined;
		}
		if (removedResult) {
			toasts.success(
				"Legacy record discarded",
				removedResult.nextOwner.kind === "legacy"
					? `Another legacy record, ${removedResult.nextOwner.sourceOverrideId}, still applies to this entry.`
					: removedResult.nextOwner.kind === "plugin-defaults"
						? "EmDash SEO fields are off for this content type, so plugin templates and defaults now apply."
						: `EmDash core SEO values now apply to ${binding.ref}. Check the public page to confirm its output.`,
			);
		}
		// The overview belongs to the workspace, so a removal refreshes it even after this view closed.
		const overview = outcome === "removed" ? onOverviewRefresh() : Promise.resolve();
		if (!mounted.current) {
			await overview;
			return;
		}
		const settled = settleLegacyDiscard(discardStateRef.current, binding, outcome);
		if (!removedResult && settled.current) toasts.error("Legacy record not discarded", message);
		updateDiscardState(settled.state);
		// A removal always rebuilds the plan shown before it; a late one keeps an unrelated newer workflow.
		if (settled.rebuild && settled.staleSourceOverrideId) {
			await Promise.all([rebuildRetainedPlan(settled.staleSourceOverrideId, !settled.current), overview]);
		} else {
			await overview;
		}
	};
	const discardAvailable = plan?.discardAvailable === true;
	const discardBusy = legacyDiscardBusy(discardState);
	const discardStateFor = (sourceOverrideId: string): LegacyDiscardState | null =>
		legacyDiscardSubject(discardState) === sourceOverrideId ? discardState : null;

	const applyMigration = React.useCallback(async () => {
		if (!canApply) return;
		setApplying(true);
		setOperation(null);
		setPlanError(null);
		try {
			const selectedPlans =
				plan?.items
					.filter((item) => selected.has(item.sourceOverrideId))
					.map((item) => ({
						sourceOverrideId: item.sourceOverrideId,
						fingerprint: item.fingerprint,
					})) ?? [];
			const result = await applySeoAdminMigration(
				selectedPlans,
				policy,
				applyConfirmation,
			);
			setOperation({ action: "apply", result });
			if ("batchId" in result) setActiveBatchId(result.batchId);
			setApplyConfirmation("");
			const feedback = seoMigrationFeedback(result, "apply");
			if (feedback.outcome === "complete") toasts.success(feedback.title);
			else toasts.error(
				feedback.title,
				"Check the operation summary for details.",
			);
			await Promise.all([loadPlan(), loadHistory(), onOverviewRefresh()]);
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "Failed to migrate SEO records";
			setPlanError(detail);
			toasts.error("Migration failed", detail);
		} finally {
			setApplying(false);
		}
	}, [
		applyConfirmation,
		canApply,
		loadHistory,
		loadPlan,
		onOverviewRefresh,
		plan,
		policy,
		selected,
		toasts,
	]);

	const rollbackMigration = React.useCallback(async () => {
		if (!canRollback || !completeActiveBatch) return;
		setRollingBack(true);
		setOperation(null);
		setHistoryError(null);
		try {
			const result = await rollbackSeoAdminMigration(
				completeActiveBatch.id,
				rollbackConfirmation,
			);
			setOperation({ action: "rollback", result });
			setRollbackConfirmation("");
			const feedback = seoMigrationFeedback(result, "rollback");
			if (feedback.outcome === "complete") toasts.success(feedback.title);
			else toasts.error(
				feedback.title,
				"Check the operation summary for details.",
			);
			await Promise.all([loadPlan(), loadHistory(), onOverviewRefresh()]);
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "Failed to roll back the migration";
			setHistoryError(detail);
			toasts.error("Rollback failed", detail);
		} finally {
			setRollingBack(false);
		}
	}, [canRollback, completeActiveBatch, loadHistory, loadPlan, onOverviewRefresh, rollbackConfirmation, toasts]);

	const operationFeedback = operation
		? seoMigrationFeedback(operation.result, operation.action)
		: null;

	return (
		<div className="shipit-seo-migration-workspace">
			{operation ? (
				<Banner
					variant={operationFeedback?.outcome === "complete" ? "default" : "alert"}
					icon={operationFeedback?.outcome === "complete" ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : <WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={operationFeedback?.title ?? "Migration operation needs review"}
					description={operationDescription(operation.result)}
				/>
			) : null}

			<section className="shipit-seo-panel shipit-seo-migration-plan" aria-labelledby="seo-migration-plan-title">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Dry run</span>
						<h2 id="seo-migration-plan-title">Legacy to core SEO</h2>
					</div>
					<ShieldCheck size={20} aria-hidden="true" />
				</div>
				<p className="shipit-seo-migration-intro">
					Preview every field before moving legacy plugin overrides into EmDash
					core SEO. Planning never writes content and loads at most 100 records
					per migration batch.
				</p>
				{plan && !writeAvailable ? (
					<Banner
						variant="alert"
						title="Migration writes unavailable on this host"
						description="This EmDash host does not provide the conditional write capabilities needed to apply or roll back safely. The plan and history remain available for review."
					/>
				) : null}
				{plan && !discardAvailable ? (
					<Banner
						variant="alert"
						title="Guarded removal unavailable on this host"
						description="This EmDash host cannot delete a legacy record conditionally, so removal is not offered. Records remain available for review."
					/>
				) : null}
				{plan && (staleSources.size > 0 || loadingPlan) ? (
					<Banner
						variant="default"
						title="Showing the plan built earlier"
						description={loadingPlan
							? "The plan is being rebuilt. Rows shown here may be out of date and are not offered for removal until it loads."
							: "A removal was refused or could not be confirmed, and the plan could not be rebuilt. Rows marked out of date stay disabled."}
					/>
				) : null}

				<div className="shipit-seo-migration-toolbar">
					<label>
						<span>{writeAvailable ? "Conflict policy" : "Preview conflict policy"}</span>
						<select value={policy} disabled={applying || discardBusy} onChange={(event) => setPolicy(event.target.value as CoreSeoMigrationConflictPolicy)}>
							<option value="skip">Stop on conflicts (recommended)</option>
							<option value="prefer-core">Keep existing core values</option>
							<option value="prefer-legacy">
								Overwrite core with legacy values
							</option>
						</select>
					</label>
					<Button type="button" variant="secondary" icon={ArrowsClockwise} loading={loadingPlan} disabled={loadingPlan || applying || discardBusy} onClick={() => void loadPlan()}>
						Rebuild plan
					</Button>
				</div>

				{writeAvailable && policy === "prefer-legacy" ? (
					<Banner variant="alert" title="Legacy values can overwrite newer core SEO" description="Review every field mapping before selecting a record. This policy is recorded in the migration journal." />
				) : writeAvailable && policy === "prefer-core" ? (
					<Banner variant="default" title="Existing core SEO stays authoritative" description="Conflicting legacy values are archived in the journal but are not copied into core SEO." />
				) : null}

				{planError ? <Banner variant="error" title="Migration plan unavailable" description={planError} /> : null}
				{plan ? (
					<div className="shipit-seo-migration-summary" aria-label="Migration plan summary">
						<div>
							<span>{planCursors.length > 1 || plan.hasMore ? `Legacy records, page ${planCursors.length}` : "Legacy records"}</span>
							<strong>{plan.summary.total}</strong>
						</div>
						<div>
							<span>{writeAvailable ? "Ready" : "Mapped"}</span>
							<strong>{plan.summary.ready}</strong>
						</div>
						<div>
							<span>Conflicts</span>
							<strong>{plan.summary.conflicts}</strong>
						</div>
						<div>
							<span>Unresolved</span>
							<strong>{plan.summary.unresolved}</strong>
						</div>
					</div>
				) : null}

				{loadingPlan && !plan ? (
					<div className="shipit-seo-migration-loading" role="status">
						Building a read-only migration plan...
					</div>
				) : null}
				{plan?.items.length ? (
					<>
						{writeAvailable ? (
							<div className="shipit-seo-migration-selection">
								<span>{selected.size} selected</span>
								<div>
									<Button
										type="button"
										size="sm"
										variant="secondary"
										disabled={!readySources.length || applying || discardBusy}
										onClick={() => setSelected(new Set(readySources))}
									>
										Select ready
									</Button>
									<Button type="button" size="sm" variant="ghost" disabled={!selected.size || applying} onClick={() => setSelected(new Set())}>
										Clear
									</Button>
								</div>
							</div>
						) : null}
						<div className="shipit-seo-migration-list">
							{plan.items.map((item) => (
								<MigrationPlanRow
									key={item.sourceOverrideId}
									item={item}
									selected={selected.has(item.sourceOverrideId)}
									writeAvailable={writeAvailable}
									discardEligibility={legacyDiscardEligibility(item, discardAvailable)}
									discardState={discardStateFor(item.sourceOverrideId)}
									stale={staleSources.has(item.sourceOverrideId) || loadingPlan}
									discardBusy={discardBusy && legacyDiscardSubject(discardState) !== item.sourceOverrideId}
									onSelectedChange={(next) =>
										setItemSelected(item.sourceOverrideId, next)
									}
									onPrepareBackup={() => void prepareBackup(item)}
									onDownloadBackup={downloadBackup}
									onAcknowledgeBackup={acknowledgeBackup}
									onConfirmDiscard={() => void confirmDiscard(item)}
								/>
							))}
						</div>
						{planPager}
						{writeAvailable ? (
							<div className="shipit-seo-migration-action">
								<div>
									<strong>Apply selected migration</strong>
									<p>
										A backup journal is written before core SEO changes. The
										legacy owner is removed only after verification.
									</p>
								</div>
								<Input
									label={`Type ${APPLY_CONFIRMATION}`}
									value={applyConfirmation}
									required={false}
									description="Exact confirmation is required for every apply operation."
									onChange={(event) => setApplyConfirmation(event.target.value)}
								/>
								<Button type="button" variant="primary" icon={Database} loading={applying} disabled={!canApply} onClick={() => void applyMigration()}>
									Migrate {selected.size || "selected"}
								</Button>
							</div>
						) : null}
					</>
				) : plan && !loadingPlan && planPager ? (
					<>
						<p className="shipit-seo-migration-intro">
							{plan.hasMore
								? "This page has no records to review. Continue to the next page."
								: "This page has no records to review."}
						</p>
						{planPager}
					</>
				) : plan && !loadingPlan ? (
					<Empty
						size="sm"
						icon={<ShieldCheck size={32} aria-hidden="true" />}
						title="No legacy SEO records"
						description={legacyCount ? "The latest plan found no migratable records. Rebuild it after checking storage." : "No legacy SEO overrides were found."}
					/>
				) : null}
			</section>

			<section className="shipit-seo-panel shipit-seo-migration-history" aria-labelledby="seo-migration-history-title">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Recovery journal</span>
						<h2 id="seo-migration-history-title">Migration history</h2>
					</div>
					<ClockCounterClockwise size={20} aria-hidden="true" />
				</div>
				<p className="shipit-seo-migration-intro">
					Every selected entry keeps before, after, policy, and source snapshots
					for conflict-aware rollback.
				</p>
				<div className="shipit-seo-migration-history-toolbar">
					<span>{history?.items.length ?? 0} journal records</span>
					<Button type="button" variant="secondary" icon={ArrowsClockwise} loading={loadingHistory} disabled={loadingHistory || loadingOlderHistory || rollingBack} onClick={() => void loadHistory()}>
						Refresh history
					</Button>
				</div>
				{historyError ? <Banner variant="error" title="Migration history unavailable" description={historyError} /> : null}
				{history?.hasMore ? (
					<Banner
						variant="alert"
						title={`Showing the newest ${history.items.length} records`}
						description="Load older records to see earlier batches. Batch summaries can be partial; select a batch to load its complete journal before rollback is enabled."
						action={
							<Button type="button" size="sm" variant="secondary" loading={loadingOlderHistory} disabled={loadingOlderHistory || loadingHistory || rollingBack} onClick={() => void loadOlderHistory()}>
								Load older records
							</Button>
						}
					/>
				) : null}
				{loadingHistory && !history ? (
					<div className="shipit-seo-migration-loading" role="status">
						Loading migration journal...
					</div>
				) : null}
				{batches.length ? (
					<div className="shipit-seo-migration-history-grid">
						<BatchHistory batches={batches} activeBatchId={activeBatchId} onActiveBatchChange={(batchId) => { setActiveBatch(null); setActiveBatchError(null); setActiveBatchId(batchId); setRollbackConfirmation(""); }} />
						{activeBatchLoading ? (
							<div className="shipit-seo-migration-loading" role="status">
								Loading the complete migration batch...
							</div>
						) : activeBatchError ? (
							<Banner
								variant="error"
								title="Migration batch unavailable"
								description={activeBatchError}
							/>
						) : completeActiveBatch ? (
							<div className="shipit-seo-migration-batch-detail">
								<div className="shipit-seo-migration-batch-heading">
									<div>
										<strong>{readableDate(completeActiveBatch.createdAt)}</strong>
										<code>{completeActiveBatch.id}</code>
									</div>
									<Badge variant="secondary">
										{completeActiveBatch.records.length} records
									</Badge>
								</div>
								<div className="shipit-seo-migration-records">
									{completeActiveBatch.records.map((record) => (
										<div key={record.id}>
											<span>
												<strong>{record.ref}</strong>
												<small>{record.conflictPolicy}</small>
											</span>
											<Badge variant={stateVariant(record.status)}>
												{stateLabel(record.status)}
											</Badge>
											{record.error ? <p>{record.error}</p> : null}
										</div>
									))}
								</div>
								{completeActiveBatch.records.some((record) => record.status === "applied") && rollbackWriteAvailable ? (
									<div className="shipit-seo-migration-rollback">
										<div>
											<strong>Roll back this batch</strong>
											<p>
												Rollback stops if core SEO was edited later or a
												different legacy record now exists.
											</p>
										</div>
										<Input
											label={`Type ${ROLLBACK_CONFIRMATION}`}
											value={rollbackConfirmation}
											required={false}
											onChange={(event) => setRollbackConfirmation(event.target.value)}
										/>
										<Button type="button" variant="destructive" icon={ArrowCounterClockwise} loading={rollingBack} disabled={!canRollback} onClick={() => void rollbackMigration()}>
											Roll back batch
										</Button>
									</div>
								) : completeActiveBatch.records.some((record) => record.status === "applied") ? (
									<div className="shipit-seo-migration-closed">
										<ShieldCheck size={18} aria-hidden="true" />
										{loadingHistory
											? "Checking rollback availability..."
											: historyError || !history
												? "Rollback availability could not be confirmed. Refresh history to retry."
												: "Rollback is unavailable because this host lacks safe migration writes."}
									</div>
								) : (
									<div className="shipit-seo-migration-closed">
										<CheckCircle size={18} aria-hidden="true" />
										This batch has no applied records to roll back.
									</div>
								)}
							</div>
						) : null}
					</div>
				) : history && !loadingHistory ? (
					<Empty
						size="sm"
						icon={<ClockCounterClockwise size={32} aria-hidden="true" />}
						title="No migration history"
						description="Applied migrations and rollback results will appear here."
					/>
				) : null}
			</section>
		</div>
	);
}
