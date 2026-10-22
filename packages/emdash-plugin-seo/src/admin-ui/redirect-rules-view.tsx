import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Table } from "@cloudflare/kumo/components/table";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowBendUpRight,
	ArrowClockwise,
	ArrowSquareOut,
	CheckCircle,
	FloppyDisk,
	Info,
	MagnifyingGlass,
	PencilSimple,
	Plus,
	WarningCircle,
	X,
} from "@phosphor-icons/react";
import {
	REDIRECT_PATH_MAX_LENGTH,
	REDIRECT_SEARCH_MAX_LENGTH,
	redirectTypeLabel,
	validateRedirectRuleDraft,
	type RedirectRule,
	type RedirectRuleCreateAccess,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import type { RedirectRuleEditAccess, RedirectRuleEditFieldErrors } from "../admin-contract.ts";
import {
	createSeoAdminRedirectRule,
	fetchSeoAdminRedirectRules,
	reconcileSeoAdminRedirectRule,
} from "./api.ts";
import { createRedirectEditApi } from "./redirect-edit-api.ts";
import {
	checkRedirectEdit,
	closeRedirectEdit,
	createRedirectEditStore,
	dismissRedirectEditCompletion,
	firstInvalidRedirectEditField,
	hideRedirectEdit,
	openRedirectEdit,
	redirectEditAnnouncement,
	redirectEditCanSave,
	redirectEditRetained,
	redirectEditUnresolved,
	redirectRowAction,
	releaseRedirectEdit,
	reloadRedirectEdit,
	rememberRedirectEditFilters,
	retryRedirectEditLoad,
	saveRedirectEdit,
	updateRedirectEditDraft,
	type RedirectEditActions,
	type RedirectEditNotice,
	type RedirectEditSession,
	type RedirectRowAction,
} from "./redirect-edit-model.ts";
import {
	INITIAL_REDIRECT_FILTERS,
	checkRedirectRule,
	classifyRedirectRequestError,
	createRedirectFormStore,
	firstInvalidRedirectField,
	initialRedirectPaging,
	nextRedirectPage,
	prefillRedirectForm,
	previousRedirectPage,
	redirectEmptyPage,
	redirectFieldAnnouncement,
	redirectFiltersActive,
	redirectFormLocked,
	redirectFormUnresolved,
	redirectListRequest,
	resetRedirectForm,
	saveRedirectRule,
	withRedirectFilters,
	type RedirectFormActions,
	type RedirectOriginFilter,
	type RedirectStatusFilter,
} from "./redirect-rules-model.ts";
import { seoWorkspaceKeys } from "./workspace-model.ts";
import { useSeoToasts } from "./workspace-shell.tsx";

const CORE_REDIRECTS_URL = "/_emdash/admin/redirects";
const FIELD_IDS = { source: "shipit-redirect-source", destination: "shipit-redirect-destination", type: "shipit-redirect-type" };

// One form per admin page: an unresolved save survives closing the dialog,
// switching tabs and leaving the Redirects workspace.
const redirectFormStore = createRedirectFormStore();

function useRedirectForm() {
	return React.useSyncExternalStore(redirectFormStore.subscribe, redirectFormStore.get, redirectFormStore.get);
}

// One edit session per admin page, separate from the create form. It also
// keeps the applied list filters and the last confirmed save while the
// Redirect rules tab is not mounted.
const redirectEditStore = createRedirectEditStore();
const redirectEditApi = createRedirectEditApi();

function useRedirectEdit() {
	return React.useSyncExternalStore(redirectEditStore.subscribe, redirectEditStore.get, redirectEditStore.get);
}

const EDIT_FIELD_IDS = {
	source: "shipit-redirect-edit-source",
	destination: "shipit-redirect-edit-destination",
	type: "shipit-redirect-edit-type",
};
const EDIT_PRIMARY_ID = "shipit-redirect-edit-primary";
const EDIT_REVIEW_ID = "shipit-redirect-edit-review";
const EDIT_SUMMARY_DISMISS_ID = "shipit-redirect-edit-summary-dismiss";
const RULES_HEADING_ID = "seo-redirect-rules-title";
const NO_FIELD_ERRORS: RedirectRuleEditFieldErrors = Object.freeze({});

const EDIT_UNAVAILABLE: Record<Exclude<RedirectRuleEditAccess, "available">, string> = {
	"no-permission": "Only administrators can change redirects. You can review this one here.",
	"read-only": "This installation lets this plugin read redirects but not change them. Change this one in EmDash Redirects.",
};

const STATUS_FILTERS: Record<RedirectStatusFilter, string> = {
	all: "All states",
	enabled: "Enabled",
	disabled: "Disabled",
};

const ORIGIN_FILTERS: Record<RedirectOriginFilter, string> = {
	all: "Created by anyone",
	manual: "Created manually",
	automatic: "Created automatically",
};

const TYPE_OPTIONS: Record<"301" | "302", string> = {
	301: "301 Permanent",
	302: "302 Temporary",
};

const CREATE_UNAVAILABLE: Record<Exclude<RedirectRuleCreateAccess, "available">, string> = {
	"no-permission": "Only administrators can create redirects.",
	"read-only": "This installation lets this plugin read redirects but not create them.",
};

function readableDate(value: string | null): string {
	if (!value) return "Never";
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? "Unknown"
		: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function errorText(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function RuleFlags({ rule, onGroup }: { rule: RedirectRule; onGroup: (group: string) => void }) {
	if (!rule.isPattern && !rule.auto && rule.groupName === null) return null;
	return (
		<div className="shipit-seo-redirect-rules__flags">
			{rule.isPattern ? <Badge variant="beta">Pattern</Badge> : null}
			{rule.auto ? <Badge variant="secondary">Automatic</Badge> : null}
			{rule.groupName !== null ? (
				<button
					type="button"
					className="shipit-redirects-group"
					onClick={() => onGroup(rule.groupName!)}
					aria-label={`Show only rules in group ${rule.groupName}`}
				>
					{rule.groupName || "Unnamed group"}
				</button>
			) : null}
		</div>
	);
}

function SavedRule({ rule }: { rule: RedirectRule }) {
	return (
		<dl className="shipit-redirects-record">
			<div><dt>Source</dt><dd><code>{rule.source}</code></dd></div>
			<div><dt>Destination</dt><dd><code>{rule.destination}</code></dd></div>
			<div><dt>Status code</dt><dd>{redirectTypeLabel(rule.type)}</dd></div>
			<div><dt>State</dt><dd>{rule.enabled ? "Enabled" : "Disabled"}</dd></div>
			<div><dt>Created</dt><dd>{readableDate(rule.createdAt)}</dd></div>
			<div><dt>EmDash ID</dt><dd><code>{rule.id}</code></dd></div>
		</dl>
	);
}

function RedirectForm({
	open,
	onOpenChange,
	actions,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	actions: RedirectFormActions;
}) {
	const { draft, touched, form, attempt } = useRedirectForm();
	const [announcement, setAnnouncement] = React.useState("");
	const validation = validateRedirectRuleDraft(draft);
	const locked = redirectFormLocked(form);
	const busy = form.phase === "saving" || form.phase === "checking";
	const serverErrors = Boolean(form.fieldErrors.source || form.fieldErrors.destination || form.fieldErrors.type);
	const shownErrors = serverErrors ? form.fieldErrors : validation.valid ? {} : validation.errors;
	const fieldError = (field: "source" | "destination") =>
		touched[field] || form.fieldErrors[field] ? shownErrors[field]?.message : undefined;

	// Each stopped save moves focus to the first field to fix and announces it.
	const handledAttempt = React.useRef(attempt);
	React.useEffect(() => {
		if (attempt <= handledAttempt.current) return;
		handledAttempt.current = attempt;
		setAnnouncement(redirectFieldAnnouncement(shownErrors));
		const field = firstInvalidRedirectField(shownErrors);
		if (field && open) requestAnimationFrame(() => document.getElementById(FIELD_IDS[field])?.focus());
	}, [attempt, open, shownErrors]);

	const reset = () => {
		setAnnouncement("");
		resetRedirectForm(redirectFormStore);
	};

	const update = (field: "source" | "destination", value: string) => {
		redirectFormStore.update((current) => ({
			...current,
			draft: { ...current.draft, [field]: value },
			form: { ...current.form, fieldErrors: {}, notice: current.form.phase === "editing" ? null : current.form.notice },
		}));
	};

	const preview = validation.valid ? validation.rule : null;

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				// Closing never drops an unresolved save; it stays in the store.
				if (!next && form.phase === "saved") reset();
				if (!next && form.phase === "editing") {
					redirectFormStore.update((current) => ({ ...current, form: { ...current.form, notice: null, fieldErrors: {} } }));
				}
				onOpenChange(next);
			}}
		>
			<Dialog size="lg" className="shipit-redirects-dialog">
				<Dialog.Title>New redirect</Dialog.Title>
				<Dialog.Description>
					Sends visitors from one exact path on this site to another path with a 301 or 302 status. EmDash stores and serves the rule.
				</Dialog.Description>
				<p className="sr-only" role="alert">{announcement}</p>

				{form.phase === "saved" && form.saved ? (
					<div className="shipit-redirects-result" role="status">
						<div className="shipit-redirects-result__title">
							<CheckCircle size={20} weight="fill" aria-hidden="true" />
							<strong>{form.notice?.title}</strong>
						</div>
						<p>{form.notice?.message}</p>
						<SavedRule rule={form.saved} />
						<div className="shipit-redirects-links">
							<a href={form.saved.source} target="_blank" rel="noreferrer">
								Open {form.saved.source} <ArrowSquareOut size={13} aria-hidden="true" />
							</a>
							<a href={CORE_REDIRECTS_URL}>
								Open EmDash Redirects <ArrowSquareOut size={13} aria-hidden="true" />
							</a>
						</div>
					</div>
				) : (
					<form
						className="shipit-redirects-form"
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							void saveRedirectRule(redirectFormStore, actions);
						}}
					>
						<Input
							id={FIELD_IDS.source}
							label="Source path"
							description="The exact path visitors request, such as /old-page. EmDash does not redirect query strings, # parts or paths ending in a file extension such as .html."
							placeholder="/old-page"
							value={draft.source}
							maxLength={REDIRECT_PATH_MAX_LENGTH * 2}
							spellCheck={false}
							autoComplete="off"
							disabled={locked}
							error={fieldError("source")}
							aria-invalid={Boolean(fieldError("source"))}
							onBlur={() => redirectFormStore.update((current) => ({ ...current, touched: { ...current.touched, source: true } }))}
							onChange={(event) => update("source", event.target.value)}
						/>
						<Input
							id={FIELD_IDS.destination}
							label="Destination path"
							description="A path on this site, such as /new-page. A query string or # part here is kept in the redirect."
							placeholder="/new-page"
							value={draft.destination}
							maxLength={REDIRECT_PATH_MAX_LENGTH * 2}
							spellCheck={false}
							autoComplete="off"
							disabled={locked}
							error={fieldError("destination")}
							aria-invalid={Boolean(fieldError("destination"))}
							onBlur={() => redirectFormStore.update((current) => ({ ...current, touched: { ...current.touched, destination: true } }))}
							onChange={(event) => update("destination", event.target.value)}
						/>
						<Select<"301" | "302">
							id={FIELD_IDS.type}
							label="Status code"
							value={String(draft.type) as "301" | "302"}
							items={TYPE_OPTIONS}
							disabled={locked}
							onValueChange={(value) => {
								if (value === "301" || value === "302") {
									redirectFormStore.update((current) => ({ ...current, draft: { ...current.draft, type: Number(value) as 301 | 302 } }));
								}
							}}
						/>
						<p className="shipit-redirects-hint">
							{preview
								? <>Requests for <code>{preview.source}</code> will get a {preview.type} to <code>{preview.destination}</code>. Query strings on those requests are not carried over.</>
								: "Use 301 when the move is permanent and 302 while it is temporary."}
						</p>
						{form.notice ? (
							<div className="shipit-redirects-notice" data-tone={form.notice.tone} role={form.notice.tone === "error" ? "alert" : "status"}>
								<WarningCircle size={18} weight="fill" aria-hidden="true" />
								<div>
									<strong>{form.notice.title}</strong>
									<p>{form.notice.message}</p>
									{form.existing ? (
										<p>
											Existing rule: <code>{form.existing.source}</code> to <code>{form.existing.destination}</code>, {redirectTypeLabel(form.existing.type)}, {form.existing.enabled ? "enabled" : "disabled"}.
										</p>
									) : null}
									{redirectFormUnresolved(form) || form.existing || form.notice.title === "This redirect could not be checked" ? (
										<a href={CORE_REDIRECTS_URL}>
											Open EmDash Redirects <ArrowSquareOut size={13} aria-hidden="true" />
										</a>
									) : null}
								</div>
							</div>
						) : null}
						{/* Submitting with Enter goes through the same checks as the button. */}
						<button type="submit" hidden tabIndex={-1} aria-hidden="true" />
					</form>
				)}

				<div className="shipit-redirects-dialog__actions">
					{form.phase === "saved" ? (
						<>
							<Button type="button" variant="secondary" onClick={reset}>Create another</Button>
							<Dialog.Close render={(props) => <Button {...props} type="button" variant="primary" onClick={reset}>Done</Button>} />
						</>
					) : form.phase === "uncertain" || form.phase === "checking" ? (
						<>
							<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Close</Button>} />
							<Button
								type="button"
								variant="primary"
								icon={ArrowClockwise}
								loading={form.phase === "checking"}
								disabled={busy}
								onClick={() => void checkRedirectRule(redirectFormStore, actions)}
							>
								Check again
							</Button>
						</>
					) : (
						<>
							<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">{busy ? "Close" : "Cancel"}</Button>} />
							<Button
								type="button"
								variant="primary"
								icon={ArrowBendUpRight}
								loading={form.phase === "saving"}
								disabled={busy}
								onClick={() => void saveRedirectRule(redirectFormStore, actions)}
							>
								Save redirect
							</Button>
						</>
					)}
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

/** Configuration and activity of one record as EmDash returned it. */
function RuleRecord({ rule }: { rule: RedirectRule }) {
	return (
		<dl className="shipit-redirects-record">
			<div><dt>Source</dt><dd><code>{rule.source}</code></dd></div>
			<div><dt>Destination</dt><dd><code>{rule.destination}</code></dd></div>
			<div><dt>Status code</dt><dd>{redirectTypeLabel(rule.type)}</dd></div>
			<div><dt>State</dt><dd>{rule.enabled ? "Enabled" : "Disabled"}</dd></div>
			<div><dt>Group</dt><dd>{rule.groupName === null ? "None" : rule.groupName || "Unnamed group"}</dd></div>
			<div><dt>Created</dt><dd>{rule.auto ? "Automatically" : "Manually"}, {readableDate(rule.createdAt)}</dd></div>
			<div><dt>Hits</dt><dd>{rule.hits}</dd></div>
			<div><dt>Last hit</dt><dd>{readableDate(rule.lastHitAt)}</dd></div>
			<div><dt>EmDash ID</dt><dd><code>{rule.id}</code></dd></div>
		</dl>
	);
}

function EditNotice({ notice, related, relatedLabel }: {
	notice: RedirectEditNotice;
	related: RedirectRule | null;
	relatedLabel: string;
}) {
	const NoticeIcon = notice.tone === "info" ? Info : WarningCircle;
	return (
		<div className="shipit-redirects-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
			<NoticeIcon size={18} weight="fill" aria-hidden="true" />
			<div>
				<strong>{notice.title}</strong>
				<p>{notice.message}</p>
				{related ? (
					<p>
						{relatedLabel}: <code>{related.source}</code> to <code>{related.destination}</code>, {redirectTypeLabel(related.type)}, {related.enabled ? "enabled" : "disabled"}.
					</p>
				) : null}
				{notice.coreAdmin ? (
					<a href={CORE_REDIRECTS_URL}>
						Open EmDash Redirects <ArrowSquareOut size={13} aria-hidden="true" />
					</a>
				) : null}
			</div>
		</div>
	);
}

function editSummary(session: RedirectEditSession): { title: string; message: string } {
	return session.confirmed?.confirmedBy === "recovery"
		? {
			title: "Change found in EmDash",
			message: "A check read this redirect back from EmDash and found the settings you asked for. EmDash currently has these settings.",
		}
		: { title: "Redirect updated", message: "EmDash saved the change and currently has these settings." };
}

function RedirectEditDialog({
	open,
	onOpenChange,
	onClosed,
	actions,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onClosed: () => void;
	actions: RedirectEditActions;
}) {
	const { session, attempt } = useRedirectEdit();
	const [announcement, setAnnouncement] = React.useState<{ token: number | null; text: string }>({ token: null, text: "" });
	const phase = session?.phase ?? null;
	const draft = session?.draft ?? null;
	const loaded = session?.loaded ?? null;
	const fieldErrors = session?.fieldErrors ?? NO_FIELD_ERRORS;
	const canSave = redirectEditCanSave(session);
	const locked = !canSave;
	const token = session?.token ?? null;
	// Rendered only while it still describes this session's current field
	// errors, so fixing one of several fields or opening another redirect
	// never leaves an outdated error in the alert.
	const shownAnnouncement = announcement.token === token && announcement.text === redirectEditAnnouncement(fieldErrors)
		? announcement.text
		: "";

	// Each stopped save moves focus to the first field to fix and announces it.
	// The alert is emptied first, so a repeated identical refusal is announced again.
	const handledAttempt = React.useRef(attempt);
	React.useEffect(() => {
		if (attempt <= handledAttempt.current) return;
		handledAttempt.current = attempt;
		const text = redirectEditAnnouncement(fieldErrors);
		const field = firstInvalidRedirectEditField(fieldErrors);
		setAnnouncement({ token, text: "" });
		requestAnimationFrame(() => {
			setAnnouncement({ token, text });
			if (field && open) document.getElementById(EDIT_FIELD_IDS[field])?.focus();
		});
	}, [attempt, open, fieldErrors, token]);

	// A loaded record moves focus to its first field; a finished request whose
	// button went away moves focus to the next action instead of the page.
	const previousPhase = React.useRef(phase);
	React.useEffect(() => {
		const before = previousPhase.current;
		previousPhase.current = phase;
		if (!open || before === phase) return;
		const frame = requestAnimationFrame(() => {
			if (phase === "editing" && canSave && (before === "loading" || before === "reloading")) {
				document.getElementById(EDIT_FIELD_IDS.source)?.focus();
				return;
			}
			const active = document.activeElement;
			if (!active || active === document.body || active.getAttribute("role") === "dialog") {
				document.getElementById(EDIT_PRIMARY_ID)?.focus();
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [open, phase, canSave]);

	const update = (field: "source" | "destination", value: string) =>
		updateRedirectEditDraft(redirectEditStore, field === "source" ? { source: value } : { destination: value });
	const save = () => void saveRedirectEdit(redirectEditStore, actions);
	const showForm = draft !== null && phase !== "saved" && phase !== "blocked" && phase !== "load-failed" && phase !== "loading";
	const relatedLabel = phase === "stale" || phase === "reloading" ? "EmDash now has" : phase === "blocked" ? "This rule" : "Existing rule";

	return (
		<Dialog.Root
			open={open}
			onOpenChange={onOpenChange}
			onOpenChangeComplete={(next) => {
				if (!next) onClosed();
			}}
		>
			<Dialog size="lg" className="shipit-redirects-dialog shipit-redirects-dialog--edit">
				<Dialog.Title>Edit redirect</Dialog.Title>
				<Dialog.Description>
					Change where visitors are sent and whether this redirect is active. Saved changes apply to your site.
				</Dialog.Description>
				<p className="sr-only" role="alert">{shownAnnouncement}</p>

				{phase === "loading" ? <p className="shipit-redirects-hint" role="status">Loading this redirect from EmDash.</p> : null}
				{phase === "reloading" ? <p className="shipit-redirects-hint" role="status">Loading the current version from EmDash.</p> : null}
				{session?.deferred ? (
					<p className="shipit-redirects-hint" role="status">
						{redirectEditUnresolved(session)
							? "Another redirect cannot be edited until this change is confirmed or found not saved."
							: "Close this result to edit another redirect."}
					</p>
				) : null}

				{phase === "saved" && session?.confirmed ? (
					<div className="shipit-redirects-result" role="status">
						<div className="shipit-redirects-result__title">
							<CheckCircle size={20} weight="fill" aria-hidden="true" />
							<strong>{editSummary(session).title}</strong>
						</div>
						<p>{editSummary(session).message}</p>
						<RuleRecord rule={session.confirmed.rule} />
						<div className="shipit-redirects-links">
							{session.confirmed.rule.enabled ? (
								<a href={session.confirmed.rule.source} target="_blank" rel="noreferrer">
									Open {session.confirmed.rule.source} <ArrowSquareOut size={13} aria-hidden="true" />
								</a>
							) : null}
							<a href={CORE_REDIRECTS_URL}>
								Open EmDash Redirects <ArrowSquareOut size={13} aria-hidden="true" />
							</a>
						</div>
					</div>
				) : null}

				{session?.notice ? <EditNotice notice={session.notice} related={session.related} relatedLabel={relatedLabel} /> : null}
				{phase === "editing" && loaded && loaded.access !== "available" ? (
					<EditNotice
						notice={{ tone: "info", title: "You can review this redirect", message: EDIT_UNAVAILABLE[loaded.access], coreAdmin: true }}
						related={null}
						relatedLabel=""
					/>
				) : null}

				{showForm && draft ? (
					<form
						className="shipit-redirects-form"
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							save();
						}}
					>
						<Input
							id={EDIT_FIELD_IDS.source}
							label="Source path"
							description="The exact path visitors request. A path you leave as it is stays exactly as EmDash has it."
							value={draft.source}
							spellCheck={false}
							autoComplete="off"
							disabled={locked}
							error={fieldErrors.source?.message}
							aria-invalid={Boolean(fieldErrors.source)}
							onChange={(event) => update("source", event.target.value)}
						/>
						<Input
							id={EDIT_FIELD_IDS.destination}
							label="Destination path"
							description="A path on this site. A query string or # part here is kept in the redirect."
							value={draft.destination}
							spellCheck={false}
							autoComplete="off"
							disabled={locked}
							error={fieldErrors.destination?.message}
							aria-invalid={Boolean(fieldErrors.destination)}
							onChange={(event) => update("destination", event.target.value)}
						/>
						<Select<"301" | "302">
							id={EDIT_FIELD_IDS.type}
							label="Status code"
							value={String(draft.type) as "301" | "302"}
							items={TYPE_OPTIONS}
							disabled={locked}
							onValueChange={(value) => {
								if (value === "301" || value === "302") updateRedirectEditDraft(redirectEditStore, { type: Number(value) as 301 | 302 });
							}}
						/>
						<Switch
							label="Enabled"
							controlFirst={false}
							checked={draft.enabled}
							disabled={locked}
							onCheckedChange={(enabled) => updateRedirectEditDraft(redirectEditStore, { enabled })}
						/>
						<p className="shipit-redirects-hint">
							{draft.enabled
								? "While enabled, EmDash answers the source path with this redirect."
								: "While disabled, EmDash keeps the rule and normal site routing answers the source path."}
							{" "}A changed state applies only once EmDash confirms the save. This plugin checks other redirects for duplicates and loops first, but a change saved elsewhere at the same moment is not part of that check.
						</p>
						{/* Submitting with Enter goes through the same command as the button. */}
						<button type="submit" hidden tabIndex={-1} aria-hidden="true" />
					</form>
				) : null}

				{loaded && phase !== "saved" && phase !== "blocked" ? (
					<section className="shipit-redirects-current" aria-labelledby="shipit-redirect-edit-current">
						{/* While a save is pending or the record changed, the loaded copy may no longer be what EmDash has. */}
						<h3 id="shipit-redirect-edit-current">{phase === "editing" ? "Saved in EmDash" : "Version you opened"}</h3>
						<RuleRecord rule={loaded.rule} />
					</section>
				) : null}

				<div className="shipit-redirects-dialog__actions">
					{phase === "saved" ? (
						<Dialog.Close render={(props) => <Button {...props} id={EDIT_PRIMARY_ID} type="button" variant="primary">Done</Button>} />
					) : phase === "uncertain" || phase === "checking" ? (
						<>
							<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Close</Button>} />
							<Button
								id={EDIT_PRIMARY_ID}
								type="button"
								variant="primary"
								icon={ArrowClockwise}
								loading={phase === "checking"}
								disabled={phase === "checking"}
								onClick={() => void checkRedirectEdit(redirectEditStore, actions)}
							>
								Check saved redirect
							</Button>
						</>
					) : phase === "stale" || phase === "reloading" ? (
						<>
							<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Close</Button>} />
							<Button
								id={EDIT_PRIMARY_ID}
								type="button"
								variant="primary"
								icon={ArrowClockwise}
								loading={phase === "reloading"}
								disabled={phase === "reloading"}
								onClick={() => void reloadRedirectEdit(redirectEditStore, actions)}
							>
								Reload and review
							</Button>
						</>
					) : phase === "load-failed" ? (
						<>
							<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Close</Button>} />
							<Button
								id={EDIT_PRIMARY_ID}
								type="button"
								variant="primary"
								icon={ArrowClockwise}
								onClick={() => void retryRedirectEditLoad(redirectEditStore, actions)}
							>
								Try again
							</Button>
						</>
					) : canSave || phase === "saving" ? (
						<>
							<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">{phase === "saving" ? "Close" : "Cancel"}</Button>} />
							<Button
								id={EDIT_PRIMARY_ID}
								type="button"
								variant="primary"
								icon={FloppyDisk}
								loading={phase === "saving"}
								disabled={phase === "saving"}
								onClick={save}
							>
								Save changes
							</Button>
						</>
					) : (
						<Dialog.Close
							render={(props) => (
								<Button {...props} id={EDIT_PRIMARY_ID} type="button" variant="secondary">
									{phase === "loading" ? "Cancel" : "Close"}
								</Button>
							)}
						/>
					)}
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

function RowEditAction({ rule, action, onEdit }: {
	rule: RedirectRule;
	action: RedirectRowAction;
	onEdit: (id: string, opener: HTMLElement) => void;
}) {
	if (action === "core") {
		return (
			<a
				className="shipit-redirects-row-action"
				href={CORE_REDIRECTS_URL}
				data-redirect-edit={rule.id}
				aria-label={`Edit in EmDash: the redirect from ${rule.source}`}
			>
				Edit in EmDash <ArrowSquareOut size={13} aria-hidden="true" />
			</a>
		);
	}
	const review = action === "review";
	return (
		<Button
			type="button"
			size="xs"
			variant={review ? "primary" : "secondary"}
			icon={review ? WarningCircle : PencilSimple}
			data-redirect-edit={rule.id}
			aria-label={review ? `Review change: the redirect from ${rule.source}` : `Edit redirect from ${rule.source}`}
			onClick={(event) => onEdit(rule.id, event.currentTarget)}
		>
			{review ? "Review change" : "Edit"}
		</Button>
	);
}

/** A request to open New redirect with this source; `request` grows with each ask. */
export interface RedirectPrefillRequest {
	source: string;
	request: number;
}

export function RedirectRulesView({ prefill = null, onPrefillHandled }: {
	prefill?: RedirectPrefillRequest | null;
	onPrefillHandled?: () => void;
} = {}) {
	const queryClient = useQueryClient();
	const toasts = useSeoToasts();
	const { form, draft } = useRedirectForm();
	const { session: edit, completion } = useRedirectEdit();
	const [paging, setPaging] = React.useState(() => initialRedirectPaging(redirectEditStore.get().filters));
	const [searchText, setSearchText] = React.useState(() => redirectEditStore.get().filters.search);
	const [formOpen, setFormOpen] = React.useState(false);
	const [editOpen, setEditOpen] = React.useState(false);
	const [highlight, setHighlight] = React.useState<string | null>(null);
	const editOpener = React.useRef<{ element: HTMLElement; id: string } | null>(null);
	// Read when the close animation ends, which can be after a reopen.
	const editShown = React.useRef(false);
	const showEdit = (next: boolean) => {
		editShown.current = next;
		// Decided at close intent, so an answer arriving during the close
		// animation is kept for review instead of ending with the dialog.
		if (!next) hideRedirectEdit(redirectEditStore);
		setEditOpen(next);
	};
	const request = redirectListRequest(paging);
	const query = useQuery({
		queryKey: [...seoWorkspaceKeys.redirectRules, "page", request],
		queryFn: () => fetchSeoAdminRedirectRules(request),
		placeholderData: keepPreviousData,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		staleTime: 20_000,
		retry: false,
	});
	const result = query.data;
	const createAccess = result?.status === "ok" ? result.create : null;
	const unresolved = redirectFormUnresolved(form);
	const [prefillNotice, setPrefillNotice] = React.useState<string | null>(null);

	// Applied once the list says whether this user may create redirects.
	React.useEffect(() => {
		if (!prefill || createAccess === null) return;
		onPrefillHandled?.();
		if (createAccess !== "available" && !unresolved) {
			setPrefillNotice(`No redirect was started for ${prefill.source}. ${CREATE_UNAVAILABLE[createAccess]}`);
			return;
		}
		setPrefillNotice(prefillRedirectForm(redirectFormStore, prefill.source) === "unresolved"
			? `An earlier redirect save is not confirmed yet. Review it before creating a redirect for ${prefill.source}.`
			: null);
		setFormOpen(true);
	}, [prefill, createAccess, unresolved, onPrefillHandled]);

	const actions = React.useMemo<RedirectFormActions>(() => ({
		create: createSeoAdminRedirectRule,
		reconcile: reconcileSeoAdminRedirectRule,
		onSaved(rule) {
			setHighlight(rule.id);
			setPaging((current) => initialRedirectPaging(current.filters));
			void queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.redirectRules });
			toasts.success("Redirect saved", `${rule.source} to ${rule.destination}, ${redirectTypeLabel(rule.type)}.`);
		},
	}), [queryClient, toasts]);

	const editActions = React.useMemo<RedirectEditActions>(() => ({
		load: redirectEditApi.load,
		update: redirectEditApi.update,
		reconcile: redirectEditApi.reconcile,
		refresh(filters) {
			// Every cached page is stale after a save. Only the first page for
			// the kept filters is fetched, once; a list mounted later fetches
			// its own stale page.
			void queryClient.invalidateQueries({ queryKey: seoWorkspaceKeys.redirectRules, refetchType: "none" });
			void queryClient.refetchQueries({
				queryKey: [...seoWorkspaceKeys.redirectRules, "page", redirectListRequest(initialRedirectPaging(filters))],
				exact: true,
			});
		},
	}), [queryClient]);

	React.useEffect(() => {
		rememberRedirectEditFilters(redirectEditStore, paging.filters);
	}, [paging.filters]);

	// Leaving the tab ends a settled session; an unresolved save stays locked.
	React.useEffect(() => () => {
		closeRedirectEdit(redirectEditStore);
	}, []);

	// A confirmed save makes later page cursors obsolete; the filters stay.
	const appliedCompletion = React.useRef(completion?.sequence ?? 0);
	React.useEffect(() => {
		if (!completion || completion.sequence <= appliedCompletion.current) return;
		appliedCompletion.current = completion.sequence;
		setPaging((current) => initialRedirectPaging(current.filters));
	}, [completion]);

	const openEdit = (id: string, opener: HTMLElement) => {
		editOpener.current = { element: opener, id };
		void openRedirectEdit(redirectEditStore, editActions, id);
		showEdit(true);
	};

	// When a redirect's control has gone: the same redirect's row action, the
	// update summary, the unconfirmed-change banner, then the list heading.
	const listFocusTarget = (id: string | null): HTMLElement | null =>
		(id ? document.querySelector<HTMLElement>(`[data-redirect-edit="${CSS.escape(id)}"]`) : null) ??
		document.getElementById(EDIT_SUMMARY_DISMISS_ID) ?? document.getElementById(EDIT_REVIEW_ID) ??
		document.getElementById(RULES_HEADING_ID);

	// Focus that someone already moved to another control, including another
	// dialog, is left there. Only the closing edit dialog itself does not count.
	const focusLost = () => {
		const active = document.activeElement;
		return !active || active === document.body || !active.isConnected || active.closest(".shipit-redirects-dialog--edit") !== null;
	};

	const restoreEditFocus = () => {
		const opener = editOpener.current;
		editOpener.current = null;
		requestAnimationFrame(() => {
			if (!focusLost()) return;
			const target = (opener?.element.isConnected ? opener.element : null) ?? listFocusTarget(opener?.id ?? null);
			target?.focus();
		});
	};

	// A refresh after the dialog closed can remove the row whose action has
	// focus; focus then moves to the list instead of the page.
	const focusedRowAction = React.useRef<HTMLElement | null>(null);
	React.useEffect(() => {
		const lost = focusedRowAction.current;
		if (!lost || lost.isConnected) return;
		focusedRowAction.current = null;
		if (focusLost()) listFocusTarget(lost.dataset.redirectEdit ?? null)?.focus();
	}, [result, completion, edit]);

	const editUnresolved = redirectEditUnresolved(edit);
	const editRetained = redirectEditRetained(edit);

	const applySearch =() => setPaging((current) => withRedirectFilters(current, { search: searchText.trim() }));
	const clearFilters = () => {
		setSearchText("");
		setPaging(initialRedirectPaging(INITIAL_REDIRECT_FILTERS));
	};
	const pager = result?.status === "ok" ? (
		<div className="shipit-redirects-pagination">
			<span>
				Page {paging.page + 1}, {result.items.length} {result.items.length === 1 ? "rule" : "rules"} shown
				{result.hasMore ? ", more on the next page" : ""}
			</span>
			<div>
				{paging.page > 1 ? (
					<Button size="sm" variant="secondary" disabled={query.isFetching} onClick={() => setPaging((current) => initialRedirectPaging(current.filters))}>First page</Button>
				) : null}
				<Button size="sm" variant="secondary" disabled={paging.page === 0 || query.isFetching} onClick={() => setPaging(previousRedirectPage)}>Previous</Button>
				<Button size="sm" variant="secondary" disabled={!result.cursor || query.isFetching} onClick={() => result.cursor && setPaging((current) => nextRedirectPage(current, result.cursor!))}>Next</Button>
			</div>
		</div>
	) : null;

	let body: React.ReactNode;
	if (query.isPending) {
		body = <p className="shipit-seo-muted" role="status">Loading redirect rules</p>;
	} else if (query.isError) {
		const denied = classifyRedirectRequestError(query.error) === "denied";
		body = (
			<Banner
				variant={denied ? "alert" : "error"}
				icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
				title={denied ? "You cannot view redirect rules" : "Redirect rules could not be loaded"}
				description={denied
					? "Viewing redirects needs the redirects:read permission, which EmDash gives editors and administrators."
					: errorText(query.error, "EmDash did not return the redirect rules.")}
				action={denied ? undefined : <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry</Button>}
			/>
		);
	} else if (result?.status === "unavailable" || result?.status === "failed") {
		body = (
			<Banner
				variant={result.status === "unavailable" ? "alert" : "error"}
				icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
				title={result.status === "unavailable" ? "Redirect rules are unavailable" : "Redirect rules could not be loaded"}
				description={result.message}
				action={result.status === "failed" ? <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry</Button> : undefined}
			/>
		);
	} else if (result?.status === "invalid-cursor") {
		body = (
			<Banner
				variant="alert"
				title="This page is no longer valid"
				description={result.message}
				action={<Button size="sm" variant="secondary" onClick={() => setPaging((current) => initialRedirectPaging(current.filters))}>First page</Button>}
			/>
		);
	} else if (result?.status === "ok" && !result.items.length) {
		const empty = redirectEmptyPage(paging);
		body = empty === "page-emptied" ? (
			<>
				<Empty
					size="sm"
					icon={<ArrowBendUpRight size={32} aria-hidden="true" />}
					title="No rules on this page"
					description="Rules may have been deleted in EmDash Redirects since the earlier pages were loaded."
				/>
				{pager}
			</>
		) : empty === "no-matches" ? (
			<Empty
				size="sm"
				icon={<MagnifyingGlass size={32} aria-hidden="true" />}
				title="No rules match these filters"
				description="Search looks for text anywhere in the source or destination path."
				contents={<Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
			/>
		) : (
			<Empty
				size="sm"
				icon={<ArrowBendUpRight size={32} aria-hidden="true" />}
				title="No redirect rules yet"
				description="Rules you create here or in EmDash Redirects appear in this list."
			/>
		);
	} else if (result?.status === "ok") {
		body = (
			<>
				<div className="shipit-seo-table-wrap shipit-seo-table-wrap--fluid" aria-busy={query.isFetching}>
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.Head>Source</Table.Head>
								<Table.Head>Destination</Table.Head>
								<Table.Head>Status code</Table.Head>
								<Table.Head>State</Table.Head>
								<Table.Head>Hits</Table.Head>
								<Table.Head>Last hit</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{result.items.map((rule) => (
								<Table.Row key={rule.id} data-highlight={rule.id === highlight || rule.id === completion?.id ? "true" : undefined}>
									<Table.Cell>
										<div className="shipit-seo-redirect-rules__source">
											<code>{rule.source}</code>
											<RuleFlags rule={rule} onGroup={(group) => setPaging((current) => withRedirectFilters(current, { group }))} />
											<div className="shipit-redirects-row-actions">
												<RowEditAction rule={rule} action={redirectRowAction(rule, edit)} onEdit={openEdit} />
											</div>
										</div>
										<div className="shipit-seo-mobile-meta">
											<div>
												<Badge variant="secondary">{redirectTypeLabel(rule.type)}</Badge>
												<Badge variant={rule.enabled ? "success" : "secondary"}>{rule.enabled ? "Enabled" : "Disabled"}</Badge>
												<span>{rule.hits} hits</span>
											</div>
											<p>to <code>{rule.destination}</code></p>
											<time dateTime={rule.lastHitAt ?? undefined}>Last hit {readableDate(rule.lastHitAt)}</time>
										</div>
									</Table.Cell>
									<Table.Cell><code className="shipit-seo-redirect-rules__destination">{rule.destination}</code></Table.Cell>
									<Table.Cell>{redirectTypeLabel(rule.type)}</Table.Cell>
									<Table.Cell>
										<Badge variant={rule.enabled ? "success" : "secondary"}>{rule.enabled ? "Enabled" : "Disabled"}</Badge>
									</Table.Cell>
									<Table.Cell>{rule.hits}</Table.Cell>
									<Table.Cell>{readableDate(rule.lastHitAt)}</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</div>
				{pager}
			</>
		);
	}

	return (
		<section
			className="shipit-seo-panel shipit-seo-redirect-rules"
			aria-labelledby="seo-redirect-rules-title"
			onFocus={(event) => {
				const target = event.target;
				focusedRowAction.current = target instanceof HTMLElement && target.dataset.redirectEdit !== undefined ? target : null;
			}}
			onBlur={(event) => {
				const target = event.target;
				// Still in the page means the user moved on; a removed row is handled after render.
				queueMicrotask(() => {
					if (focusedRowAction.current === target && target.isConnected) focusedRowAction.current = null;
				});
			}}
		>
			<div className="shipit-seo-section-heading">
				<div>
					<span className="shipit-seo-eyebrow">EmDash core rules</span>
					<h2 id={RULES_HEADING_ID} tabIndex={-1}>Redirect rules</h2>
				</div>
				<div className="shipit-seo-heading-badges">
					<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={query.isFetching && !query.isPending} onClick={() => void query.refetch()}>
						Refresh
					</Button>
					{createAccess === "available" || unresolved ? (
						<Button size="sm" icon={Plus} onClick={() => setFormOpen(true)}>
							{unresolved ? "Review unconfirmed redirect" : "New redirect"}
						</Button>
					) : null}
				</div>
			</div>

			<p className="shipit-seo-redirect-rules__note">
				EmDash stores and serves these rules. Exact-path 301 and 302 rules can be edited here; every rule also appears in{" "}
				<a href={CORE_REDIRECTS_URL}>EmDash Redirects <ArrowSquareOut size={13} aria-hidden="true" /></a>
				, where you can manage patterns, other status codes and deletion.
				{createAccess && createAccess !== "available" ? ` ${CREATE_UNAVAILABLE[createAccess]}` : ""}
			</p>

			{edit && (editUnresolved || editRetained) ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={editRetained
						? "A redirect change needs review"
						: edit.phase === "uncertain" ? "A redirect change is not confirmed" : edit.phase === "checking" ? "Checking a redirect change" : "A redirect change is being saved"}
					description={
						<span className="shipit-redirects-summary">
							{editRetained ? (
								<>EmDash answered after the dialog closed. Review the result for the redirect from <code>{edit.loaded?.rule.source ?? edit.id}</code>; your changes are kept until you close it.</>
							) : (
								<>The redirect from <code>{edit.loaded?.rule.source ?? edit.id}</code> stays locked until EmDash confirms whether the change was saved.</>
							)}
						</span>
					}
					action={
						<Button id={EDIT_REVIEW_ID} size="sm" variant="secondary" onClick={(event) => openEdit(edit.id, event.currentTarget)}>
							Review
						</Button>
					}
				/>
			) : null}

			{completion ? (
				<Banner
					icon={<CheckCircle size={20} weight="fill" aria-hidden="true" />}
					title={completion.confirmedBy === "host" ? "Last confirmed redirect update" : "Last confirmed redirect update, found by a check"}
					description={
						<span className="shipit-redirects-summary">
							Settings confirmed at that time: <code>{completion.rule.source}</code> to <code>{completion.rule.destination}</code>, {redirectTypeLabel(completion.rule.type)}, {completion.rule.enabled ? "enabled" : "disabled"}.
							{" "}This summary is not read again, so the rule may have changed or been deleted in EmDash since.
							{redirectFiltersActive(paging.filters) ? " It stays even if the rule no longer matches the filters." : ""}
						</span>
					}
					action={
						<Button
							size="sm"
							variant="secondary"
							id={EDIT_SUMMARY_DISMISS_ID}
							aria-label="Dismiss the last confirmed update summary"
							onClick={() => {
								dismissRedirectEditCompletion(redirectEditStore);
								requestAnimationFrame(() => document.getElementById(RULES_HEADING_ID)?.focus());
							}}
						>
							Dismiss
						</Button>
					}
				/>
			) : null}

			{prefillNotice ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Create redirect"
					description={prefillNotice}
					action={<Button size="sm" variant="secondary" onClick={() => setPrefillNotice(null)}>Dismiss</Button>}
				/>
			) : null}

			{unresolved && !formOpen ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={form.phase === "uncertain" ? "A redirect save is not confirmed" : "A redirect is being saved"}
					description={`The redirect from ${draft.source} stays locked until EmDash confirms whether it was saved.`}
					action={<Button size="sm" variant="secondary" onClick={() => setFormOpen(true)}>Review</Button>}
				/>
			) : null}

			<form
				className="shipit-redirects-filters"
				role="search"
				onSubmit={(event) => {
					event.preventDefault();
					applySearch();
				}}
			>
				<Input
					label="Search"
					type="search"
					placeholder="Text in the source or destination"
					value={searchText}
					maxLength={REDIRECT_SEARCH_MAX_LENGTH}
					onChange={(event) => setSearchText(event.target.value)}
				/>
				<Button type="submit" variant="secondary" icon={MagnifyingGlass}>Search</Button>
				<Select<RedirectStatusFilter>
					label="State"
					value={paging.filters.status}
					items={STATUS_FILTERS}
					onValueChange={(value) => {
						if (value) setPaging((current) => withRedirectFilters(current, { status: value }));
					}}
				/>
				<Select<RedirectOriginFilter>
					label="Created by"
					value={paging.filters.origin}
					items={ORIGIN_FILTERS}
					onValueChange={(value) => {
						if (value) setPaging((current) => withRedirectFilters(current, { origin: value }));
					}}
				/>
				{paging.filters.group !== null ? (
					<Button
						type="button"
						size="sm"
						variant="secondary"
						icon={X}
						aria-label={`Remove the group filter ${paging.filters.group}`}
						onClick={() => setPaging((current) => withRedirectFilters(current, { group: null }))}
					>
						Group: {paging.filters.group || "Unnamed group"}
					</Button>
				) : null}
				{redirectFiltersActive(paging.filters) ? (
					<Button type="button" size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>
				) : null}
			</form>

			{body}

			<RedirectForm open={formOpen} onOpenChange={setFormOpen} actions={actions} />
			<RedirectEditDialog
				open={editOpen}
				onOpenChange={showEdit}
				onClosed={() => {
					if (editShown.current) return;
					releaseRedirectEdit(redirectEditStore);
					restoreEditFocus();
				}}
				actions={editActions}
			/>
		</section>
	);
}
