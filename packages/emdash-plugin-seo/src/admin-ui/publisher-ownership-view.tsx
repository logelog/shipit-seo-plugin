import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { WarningCircle } from "@phosphor-icons/react";
import * as React from "react";

import type { PublisherOwnershipMode } from "../publisher-ownership.ts";
import { fetchSeoAdminPublisherOwnership, saveSeoAdminPublisherOwnership } from "./api.ts";
import { refreshBusinessIdentity } from "./business-identity-view.tsx";
import { classifyEntrySchemaRequestError, withEntrySchemaDeadline } from "./entry-schema-model.ts";
import {
	createOwnershipStore,
	ownershipGateText,
	ownershipLocked,
	ownershipNextMode,
	ownershipStatusText,
	type OwnershipState,
} from "./publisher-ownership-model.ts";

const ownershipStore = createOwnershipStore();
const WRITE_DEADLINE_MS = 20_000;

function useOwnership(): OwnershipState {
	return React.useSyncExternalStore(ownershipStore.subscribe, ownershipStore.get, ownershipStore.get);
}

function failureMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

let plainRead: Promise<void> | null = null;

async function readOwnership(explicit: boolean, check?: { mode: PublisherOwnershipMode; expectedRevision: string | null }): Promise<void> {
	const request = ownershipStore.nextRequest();
	ownershipStore.dispatch({ type: "read-start", request, explicit });
	try {
		const result = await fetchSeoAdminPublisherOwnership(check ? { check } : {});
		ownershipStore.dispatch({ type: "read-result", request, view: result.ownership, ...(result.check ? { check: result.check } : {}) });
	} catch (error: unknown) {
		ownershipStore.dispatch({
			type: "read-failed",
			request,
			denied: classifyEntrySchemaRequestError(error) === "denied",
			message: failureMessage(error, "The publisher output setting could not be loaded."),
		});
	}
}

/** One read of the saved setting, shared by every view asking at the same time. Never writes. */
export function loadPublisherOwnership(): Promise<void> {
	plainRead ??= readOwnership(false).finally(() => {
		plainRead = null;
	});
	return plainRead;
}

/** The owner's reload: after an unknown outcome it compares the stored setting with the request. */
function reloadOwnership(): Promise<void> {
	const notice = ownershipStore.get().notice;
	if (notice?.kind === "unconfirmed") return readOwnership(true, { mode: notice.intended, expectedRevision: notice.expectedRevision });
	return readOwnership(true);
}

async function changeOwnership(mode: PublisherOwnershipMode): Promise<void> {
	const state = ownershipStore.get();
	if (ownershipNextMode(state) !== mode || !state.view) return;
	const expectedRevision = state.view.revision;
	const request = ownershipStore.nextRequest();
	ownershipStore.dispatch({ type: "write-start", request, mode, expectedRevision });
	// A shared read already in flight is ignored from here on, so later callers start a new one.
	plainRead = null;
	try {
		const result = await withEntrySchemaDeadline((signal) => saveSeoAdminPublisherOwnership({ mode, expectedRevision }, signal), WRITE_DEADLINE_MS);
		ownershipStore.dispatch({ type: "write-result", request, result });
		// The identity view reports the same setting in its banners and notices.
		if (result.success && result.changed) void refreshBusinessIdentity();
	} catch (error: unknown) {
		ownershipStore.dispatch({
			type: "write-failed",
			request,
			failure: classifyEntrySchemaRequestError(error),
			message: failureMessage(error, "The request failed before a result was returned."),
		});
	}
}

function StatusBadge({ state }: { state: OwnershipState }) {
	const view = state.view;
	if (!view) return <Badge variant="secondary">{state.loadError ? "Not loaded" : "Loading"}</Badge>;
	if (view.effective === "unknown") return <Badge variant="error">Unknown</Badge>;
	return view.effective === "automatic" ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>;
}

function OwnershipNotice({ state }: { state: OwnershipState }) {
	const notice = state.notice;
	if (!notice) return null;
	const icon = <WarningCircle size={20} weight="fill" aria-hidden="true" />;
	const dismiss = (
		<Button type="button" variant="secondary" size="sm" onClick={() => ownershipStore.dispatch({ type: "dismiss" })}>
			Dismiss
		</Button>
	);
	switch (notice.kind) {
		case "saved":
		case "unchanged":
		case "info":
			return <Banner variant="secondary" title={notice.kind === "info" ? "Setting reloaded" : notice.kind === "saved" ? "Saved" : "No change"} description={notice.message} action={dismiss} />;
		case "conflict": {
			const next = ownershipNextMode(state);
			return (
				<Banner
					variant="alert"
					icon={icon}
					title="Changed elsewhere"
					description={`${notice.message} ${ownershipStatusText(state.view)}`}
					action={
						<div className="shipit-seo-ownership-actions">
							{next === notice.requested ? (
								<Button type="button" variant="primary" size="sm" onClick={() => void changeOwnership(notice.requested)}>
									{notice.requested === "automatic" ? "Turn on again" : "Turn off again"}
								</Button>
							) : null}
							<Button type="button" variant="secondary" size="sm" onClick={() => ownershipStore.dispatch({ type: "dismiss" })}>
								Keep saved setting
							</Button>
						</div>
					}
				/>
			);
		}
		case "preflight":
			return (
				<div className="shipit-seo-ownership-notice">
					<Banner variant="error" icon={icon} title="Automatic output was not turned back on" description={notice.message} action={dismiss} />
					{notice.preflight.definitions.length ? (
						<ul className="shipit-seo-ownership-definitions">
							{notice.preflight.definitions.map((item) => (
								<li key={item.id}>
									<strong>{item.name || item.id}</strong> ({item.scope}) defines {item.ownedIds.join(", ")}
								</li>
							))}
							{notice.preflight.more ? <li>and {notice.preflight.more} more</li> : null}
						</ul>
					) : null}
				</div>
			);
		case "unconfirmed":
		case "uncertain":
			return (
				<Banner
					variant="alert"
					icon={icon}
					title={notice.kind === "unconfirmed" ? "Change not confirmed" : "Storage refused the change"}
					description={notice.message}
					action={
						<Button type="button" variant="secondary" size="sm" disabled={state.reading !== null} onClick={() => void reloadOwnership()}>
							Reload saved setting
						</Button>
					}
				/>
			);
		case "denied":
			return <Banner variant="error" icon={icon} title="Permission needed" description={notice.message} action={dismiss} />;
		default:
			return <Banner variant="error" icon={icon} title="Not changed" description={notice.message} action={dismiss} />;
	}
}

const HELP = {
	feature:
		"Adds the automatic site publisher from Local SEO: the Person, Organization or LocalBusiness, its full details on the selected page, and publisher and provider links in website, article and service schema. Off keeps the saved identity and your custom schema. It does not turn off per-entry Person or Local business presets built from content fields, EmDash's own markup or theme markup. Website name and URL keep working.",
	identity:
		"Turn this off when custom schema or another integration provides the publisher. This plugin then adds no Person, Organization or LocalBusiness publisher, no publisher or provider links and no inline publisher facts. Saved details and custom schema are kept, and per-entry Person or Local business presets are unchanged.",
} as const;

/**
 * The one control for the saved publisher ownership setting. Site identity and
 * Feature controls render it over the same store; it writes on its own and is
 * never part of another form's Save.
 */
export function PublisherOwnershipPanel({
	variant,
	onOpenIdentity,
	advancedContent,
}: {
	variant: "identity" | "feature";
	onOpenIdentity?: () => void;
	advancedContent?: React.ReactNode;
}) {
	const state = useOwnership();
	const headingId = React.useId();
	React.useEffect(() => {
		void loadPublisherOwnership();
	}, []);
	const view = state.view;
	const next = ownershipNextMode(state);
	const gate = ownershipGateText(view);
	const gatesUnavailable = view !== null && view.gates === null;
	const Heading = variant === "feature" ? "h2" : "h3";
	const intro = (
		<>
			<div className="shipit-seo-ownership-head">
				<Heading id={headingId} tabIndex={-1}>{variant === "feature" ? "Publisher schema & Local SEO" : "Automatic publisher output"}</Heading>
				{variant === "feature" ? (
					<div className="shipit-seo-heading-badges">
						<Badge variant="outline">Saves immediately</Badge>
						<StatusBadge state={state} />
					</div>
				) : <StatusBadge state={state} />}
			</div>
			<p className="shipit-seo-muted">{HELP[variant]}</p>
			<p className="shipit-seo-ownership-status" role="status">
				{state.pending ? "Saving the publisher output setting." : ownershipStatusText(view)}
			</p>
			{gate && !(variant === "identity" && gatesUnavailable) ? <p className="shipit-seo-muted">{gate}</p> : null}
			{variant === "feature" ? (
				<p className="shipit-seo-muted">
					This setting is saved on its own, separately from Save modules. The Schema switch above is a separate gate that also stops custom schema.
				</p>
			) : null}
		</>
	);
	const notices = (
		<>
			{variant === "identity" && gatesUnavailable && gate ? (
				<Banner variant="alert" title="Publisher output switches could not be read" description={gate} />
			) : null}
			{variant === "identity" && (!view && !state.loadError || state.pending) ? (
				<p className="shipit-seo-muted" role="status">{state.pending ? "Saving the publisher output setting." : "Loading the publisher output setting."}</p>
			) : null}
			{view?.effective === "unknown" && !view.message ? (
				<Banner variant="error" title="Publisher ownership is unknown" description="Automatic publisher output is paused until the setting can be read." />
			) : null}
			{state.loadError ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={view ? "The setting could not be refreshed" : "The setting could not be loaded"}
					description={view ? `${state.loadError} Showing the last setting read; changes wait for a successful reload.` : state.loadError}
					action={
						<Button type="button" variant="secondary" size="sm" disabled={state.reading !== null} onClick={() => void readOwnership(true)}>
							Try again
						</Button>
					}
				/>
			) : null}
			{view?.message ? (
				<Banner
					variant={view.effective === "unknown" ? "error" : "alert"}
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={view.effective === "unknown" ? "Ownership unknown" : "Read only on this site"}
					description={view.message}
				/>
			) : null}
			<div aria-live="polite">
				<OwnershipNotice state={state} />
			</div>
		</>
	);
	const actions = (
		<>
			<div className="shipit-seo-ownership-actions">
				{view && view.effective !== "unknown" && view.writable ? (
					<Button
						type="button"
						variant={view.effective === "automatic" ? "secondary" : "primary"}
						disabled={next === null}
						onClick={() => {
							if (next) void changeOwnership(next);
						}}
					>
						{state.pending
							? "Saving"
							: view.effective === "automatic"
								? "Turn off automatic publisher"
								: "Turn on automatic publisher"}
					</Button>
				) : null}
				{onOpenIdentity ? (
					<Button type="button" variant="secondary" onClick={onOpenIdentity}>
						Open Local SEO
					</Button>
				) : null}
			</div>
			{ownershipLocked(state) ? null : view?.effective === "none" ? (
				<p className="shipit-seo-muted">
					Turning it back on first checks custom schema that applies to the whole site for the publisher's ID. Per-page schema is handled when
					each page renders.
				</p>
			) : null}
		</>
	);
	return (
		<section
			className={variant === "feature" ? "shipit-seo-panel shipit-seo-ownership shipit-seo-ownership-feature" : "shipit-seo-publisher-settings"}
			aria-labelledby={variant === "feature" ? headingId : undefined}
			aria-label={variant === "identity" ? "Publisher settings" : undefined}
			aria-busy={state.reading !== null || state.pending !== null ? true : undefined}
		>
			{variant === "identity" ? (
				<>
					{notices}
					<details className="shipit-seo-publisher-advanced">
						<summary>Advanced publisher settings</summary>
						<div className="shipit-seo-publisher-advanced-body">
							{intro}
							<p className="shipit-seo-muted">Turning automatic publisher output on or off saves immediately, separately from Save settings and the business identity form.</p>
							{actions}
							{advancedContent}
						</div>
					</details>
				</>
			) : (
				<>{intro}{notices}{actions}</>
			)}
		</section>
	);
}

/** The saved setting's effect, from the same store as the control; null before the first read. */
export function usePublisherOwnershipEffective(): "automatic" | "none" | "unknown" | null {
	const state = useOwnership();
	React.useEffect(() => {
		void loadPublisherOwnership();
	}, []);
	return state.view?.effective ?? null;
}
