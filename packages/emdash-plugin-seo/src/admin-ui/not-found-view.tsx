import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Table } from "@cloudflare/kumo/components/table";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import {
	ArrowClockwise,
	ArrowSquareOut,
	CheckCircle,
	EyeSlash,
	Info,
	WarningCircle,
} from "@phosphor-icons/react";
import type {
	SeoAdmin404Monitor,
	SeoAdmin404MonitorItem,
	SeoNotFoundStatus,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	fetchSeoAdmin404Monitor,
	triageSeoAdmin404,
} from "./api.ts";
import { Core404Activity } from "./core-404-activity-view.tsx";
import { forwardedPathsState } from "./forwarded-paths-model.ts";
import { RedirectRulesView, type RedirectPrefillRequest } from "./redirect-rules-view.tsx";
import { useSeoToasts } from "./workspace-shell.tsx";
import { WRAPPING_TABS, useTablistName } from "./workspace-tabs.ts";

function readableDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? value
		: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusBadge(status: SeoNotFoundStatus) {
	if (status === "resolved") return <Badge variant="success">Resolved</Badge>;
	if (status === "ignored") return <Badge variant="secondary">Ignored</Badge>;
	return <Badge variant="warning">Open</Badge>;
}

function openCoreRedirects(): void {
	window.location.assign("/_emdash/admin/redirects");
}

function ForwardedPathsNotice({
	title,
	children,
	onOpenModules,
}: {
	title: string;
	children: React.ReactNode;
	onOpenModules?: () => void;
}) {
	return (
		<div className="shipit-forwarded-paths__notice">
			<Info size={18} aria-hidden="true" />
			<div>
				<strong>{title}</strong>
				<p>{children}</p>
			</div>
			{onOpenModules ? (
				<Button size="sm" variant="secondary" onClick={onOpenModules}>Open feature controls</Button>
			) : null}
		</div>
	);
}

function NotFoundTriage({ onOpenModules }: { onOpenModules: () => void }) {
	const toasts = useSeoToasts();
	const [monitor, setMonitor] = React.useState<SeoAdmin404Monitor | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [busyId, setBusyId] = React.useState<string | null>(null);
	const [loadError, setLoadError] = React.useState<string | null>(null);
	const [actionError, setActionError] = React.useState<string | null>(null);

	const load = React.useCallback(async () => {
		setLoading(true);
		setLoadError(null);
		setActionError(null);
		try {
			setMonitor(await fetchSeoAdmin404Monitor());
		} catch (cause) {
			setLoadError(cause instanceof Error ? cause.message : "Failed to load the 404 monitor");
		} finally {
			setLoading(false);
		}
	}, []);

	React.useEffect(() => { void load(); }, [load]);

	const triage = async (item: SeoAdmin404MonitorItem, status: "ignored" | "open") => {
		setBusyId(item.id);
		setActionError(null);
		try {
			const result = await triageSeoAdmin404({ id: item.id, status, redirectTarget: null });
			if (!result.success) {
				const detail = "The 404 record could not be updated.";
				setActionError(detail);
				toasts.error("404 update failed", detail);
				return;
			}
			setMonitor(result.monitor);
			toasts.success(
				status === "ignored" ? "404 path ignored" : "404 path reopened",
				item.path,
			);
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "The 404 record could not be updated.";
			setActionError(detail);
			toasts.error("404 update failed", detail);
		} finally {
			setBusyId(null);
		}
	};

	if (loading && !monitor) {
		return <section className="shipit-seo-panel shipit-seo-not-found-loading" aria-busy="true" role="status">Loading forwarded paths</section>;
	}

	const state = monitor ? forwardedPathsState(monitor) : null;

	return (
		<div className="shipit-seo-not-found-view">
			{loadError ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={monitor ? "Forwarded paths could not be refreshed" : "Forwarded paths could not be loaded"}
					description={monitor ? `${loadError} The list below is from the last successful load.` : loadError}
					action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}
				/>
			) : null}

			{actionError ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="The 404 record update could not be confirmed"
					description={`${actionError} Refresh to see the record's current state.`}
					action={<Button size="sm" variant="secondary" onClick={() => void load()}>Refresh</Button>}
				/>
			) : null}

			{monitor && state ? (
				<section className="shipit-seo-panel shipit-seo-not-found-panel shipit-forwarded-paths" aria-labelledby="seo-forwarded-paths-title">
					<div className="shipit-seo-section-heading">
						<div>
							<span className="shipit-seo-eyebrow">Optional site integration</span>
							<h2 id="seo-forwarded-paths-title">Forwarded paths</h2>
						</div>
						<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={loading} onClick={() => void load()}>
							Refresh
						</Button>
					</div>
					<p className="shipit-seo-redirect-rules__note">
						Missing paths that the site forwards to this plugin, kept apart from EmDash's own 404 log in 404 activity. Suggested paths are possible destinations, not redirect rules.
					</p>

					{state.kind === "off-empty" ? (
						<ForwardedPathsNotice title="Capture is off and no paths are stored" onOpenModules={onOpenModules}>
							This plugin records a path here only after the site forwards it and 404 Monitor is on in Feature controls. Turning the setting on does not connect the site; forwarding needs a separate site integration.
						</ForwardedPathsNotice>
					) : state.kind === "on-empty" ? (
						<ForwardedPathsNotice title="No forwarded paths are stored">
							404 Monitor is on in Feature controls, but no paths have been stored. The setting does not confirm that the site forwards missing paths.
						</ForwardedPathsNotice>
					) : (
						<>
							{state.captureOff ? (
								<ForwardedPathsNotice title="Capture is off" onOpenModules={onOpenModules}>
									These paths were stored earlier. New paths are recorded only when 404 Monitor is on in Feature controls and the site actually forwards missing paths; turning the setting on alone does not connect the site.
								</ForwardedPathsNotice>
							) : null}

							<div className="shipit-seo-not-found-summary" aria-label="Forwarded path summary">
								<div><span>Total hits</span><strong>{monitor.summary.totalHits}</strong></div>
								<div><span>Unique paths</span><strong>{monitor.summary.uniquePaths}</strong></div>
								<div><span>Open</span><strong>{monitor.summary.openPaths}</strong></div>
								<div><span>Ignored</span><strong>{Math.max(0, monitor.summary.uniquePaths - monitor.summary.openPaths - monitor.summary.resolvedPaths)}</strong></div>
								{monitor.summary.resolvedPaths ? (
									<div><span>Resolved elsewhere</span><strong>{monitor.summary.resolvedPaths}</strong></div>
								) : null}
							</div>

							{monitor.items.length ? (
								<div className="shipit-seo-table-wrap shipit-seo-table-wrap--fluid">
									<Table>
										<Table.Header>
											<Table.Row>
												<Table.Head>Missing path</Table.Head>
												<Table.Head>Hits</Table.Head>
												<Table.Head>Last seen</Table.Head>
												<Table.Head>Suggested path</Table.Head>
												<Table.Head>Status</Table.Head>
												<Table.Head><span className="sr-only">Actions</span></Table.Head>
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{monitor.items.map((item) => {
												const suggestion = item.suggestions[0];
												const busy = busyId === item.id;
											return (
												<Table.Row key={item.id}>
													<Table.Cell>
														<code className="shipit-seo-not-found-path">{item.path}</code>
														<div className="shipit-seo-mobile-meta">
															<div>
																<span>{item.hits} {item.hits === 1 ? "hit" : "hits"}</span>
																{statusBadge(item.status)}
															</div>
															<p>{suggestion ? <>Suggested: <code>{suggestion.path}</code></> : "No close match"}</p>
															<time dateTime={item.lastSeenAt}>Last seen {readableDate(item.lastSeenAt)}</time>
															<div className="shipit-seo-not-found-actions">
																{item.status === "open" ? (
																	<Button size="sm" variant="secondary" icon={EyeSlash} loading={busy} onClick={() => void triage(item, "ignored")}>Ignore</Button>
																) : (
																	<Button size="sm" variant="secondary" loading={busy} onClick={() => void triage(item, "open")}>Reopen</Button>
																)}
															</div>
														</div>
													</Table.Cell>
													<Table.Cell>{item.hits}</Table.Cell>
													<Table.Cell>{readableDate(item.lastSeenAt)}</Table.Cell>
													<Table.Cell>
														{suggestion ? (
															<div className="shipit-seo-not-found-suggestion">{suggestion.title} <code>{suggestion.path}</code></div>
														) : <span className="shipit-seo-muted">No close match</span>}
														{item.redirectTarget ? <div className="shipit-seo-muted">Target recorded outside this screen: <code>{item.redirectTarget}</code></div> : null}
													</Table.Cell>
													<Table.Cell>{statusBadge(item.status)}</Table.Cell>
													<Table.Cell>
														<div className="shipit-seo-not-found-actions">
															{item.status === "open" ? (
																<Button size="sm" variant="secondary" icon={EyeSlash} loading={busy} onClick={() => void triage(item, "ignored")}>Ignore</Button>
															) : (
																<Button size="sm" variant="secondary" loading={busy} onClick={() => void triage(item, "open")}>Reopen</Button>
															)}
															<Button size="sm" variant="secondary" icon={ArrowSquareOut} onClick={openCoreRedirects}>Manage in EmDash</Button>
														</div>
													</Table.Cell>
												</Table.Row>
											);
											})}
										</Table.Body>
									</Table>
								</div>
							) : null}
						</>
					)}
				</section>
			) : null}
		</div>
	);
}

export function NotFoundView({ onOpenModules }: { onOpenModules: () => void }) {
	const [tab, setTab] = React.useState<"activity" | "triage" | "rules">("rules");
	const [prefill, setPrefill] = React.useState<RedirectPrefillRequest | null>(null);
	const createRedirect = React.useCallback((source: string) => {
		setPrefill((current) => ({ source, request: (current?.request ?? 0) + 1 }));
		setTab("rules");
	}, []);
	const prefillHandled = React.useCallback(() => setPrefill(null), []);
	const tabsRef = useTablistName<HTMLDivElement>({ label: "Redirects & 404s sections" });
	return (
		<div ref={tabsRef} className="shipit-seo-redirects-workspace">
			<div className="shipit-seo-view-header">
				<div>
					<span className="shipit-seo-eyebrow">Traffic recovery</span>
					<h2>Redirects &amp; 404s</h2>
					<p>Review missing paths and redirect rules recorded by EmDash.</p>
				</div>
		</div>
			<Tabs
				variant="segmented"
				{...WRAPPING_TABS}
				tabs={[
					{ value: "rules", label: "Redirect rules" },
					{ value: "activity", label: "404 activity" },
					{ value: "triage", label: "Forwarded paths" },
				]}
				value={tab}
				onValueChange={(value) => {
					if (value === "activity" || value === "triage" || value === "rules") setTab(value);
				}}
			/>
			{tab === "rules" ? <RedirectRulesView prefill={prefill} onPrefillHandled={prefillHandled} /> : null}
			{tab === "activity" ? <Core404Activity onCreateRedirect={createRedirect} /> : null}
			{tab === "triage" ? <NotFoundTriage onOpenModules={onOpenModules} /> : null}
		</div>
	);
}
