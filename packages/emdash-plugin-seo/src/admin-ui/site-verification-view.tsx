import * as React from "react";
import { ApiResponseError, fetchSettings, updateSettings, useCurrentUser } from "@emdash-cms/admin";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { ArrowClockwise, ArrowCounterClockwise, ArrowSquareOut, WarningCircle } from "@phosphor-icons/react";

import {
	VERIFICATION_CODE_MAX_LENGTH,
	VERIFICATION_PROVIDERS,
	VERIFICATION_PROVIDER_FIELDS,
	createVerificationOwner,
	createVerificationWriteRegistry,
	editVerificationDraft,
	loadVerificationSettings,
	mergeVerificationSnapshot,
	recoverVerificationOutcome,
	removeVerificationCode,
	resolveVerificationChange,
	restoreVerificationIntent,
	saveVerificationCodes,
	settleVerificationFields,
	verificationCarriedUnsaved,
	undoVerificationField,
	verificationChanges,
	verificationCodeLength,
	verificationDraftSummary,
	verificationEditable,
	verificationFieldStatus,
	verificationFieldsFrom,
	verificationIntent,
	verificationMetaTag,
	verificationNoticeAfterEdit,
	verificationNoticeAfterHandoff,
	verificationNoticeAfterReload,
	verificationReadActions,
	verificationReadState,
	verificationRecoveryHandoff,
	verificationRefusalRereadsRole,
	verificationRoleHints,
	verificationRoleRefreshWanted,
	verificationSaveBlockers,
	verificationSaveHandoff,
	verificationSaveMayHaveCommitted,
	verificationStoredCodeIsPlain,
	verificationWriteChanges,
	type VerificationChange,
	type VerificationDraftProblem,
	type VerificationFieldState,
	type VerificationFieldStatus,
	type VerificationFields,
	type VerificationNotice,
	type VerificationOwner,
	type VerificationPending,
	type VerificationPortResult,
	type VerificationProvider,
	type VerificationReadProblem,
	type VerificationRequestFailure,
	type VerificationSaveBlocker,
	type VerificationSaveResult,
	type VerificationSettingsPort,
	type VerificationSnapshot,
	type VerificationStoredCode,
	type VerificationWriteRefusal,
} from "../site-verification.ts";
import { useWorkspaceDraftHold } from "./workspace-shell.tsx";

const CORE_SEO_SETTINGS_PATH = "/_emdash/admin/settings/seo";
const VERIFICATION_SETTING_IDS: Record<VerificationProvider, string> = { google: "googleCode", bing: "bingCode" };

async function settingsCall(run: () => Promise<unknown>): Promise<VerificationPortResult> {
	try {
		return { ok: true, data: await run() };
	} catch (error) {
		if (error instanceof ApiResponseError) {
			return { ok: false, failure: { type: "response", status: error.status, code: error.code, message: error.message } };
		}
		if (error instanceof SyntaxError) return { ok: false, failure: { type: "malformed", detail: "the response was not JSON" } };
		return { ok: false, failure: { type: "transport", message: error instanceof Error ? error.message : "The request did not complete." } };
	}
}

// EmDash's own settings endpoint through the admin package's helpers. The
// write body is only the patch of changed codes.
const settingsPort: VerificationSettingsPort = {
	read: () => settingsCall(() => fetchSettings()),
	write: (patch) => settingsCall(() => updateSettings(patch)),
};

// Module scope, so it outlives the view within this admin document: a save
// started before leaving the view still blocks another save, and an unknown
// outcome survives reopening. Other tabs and other people are not covered.
const writeRegistry = createVerificationWriteRegistry();

/**
 * Host facts the plugin page reads outside its own query client: the EmDash
 * version from the admin manifest already loaded, and invalidation of the host
 * admin's cached site settings, which its settings pages post in full.
 */
export const SiteVerificationHostContext = React.createContext<{
	hostVersion: string | null;
	onSettingsChanged: (() => void) | null;
}>({ hostVersion: null, onSettingsChanged: null });

const PROVIDER_COPY: Record<VerificationProvider, {
	name: string;
	short: string;
	example: string;
	finish: string;
	console: { label: string; href: string };
	guide: { label: string; href: string };
}> = {
	google: {
		name: "Google Search Console",
		short: "Google",
		example: "AbC123xyz",
		finish: "After saving, choose Verify in Search Console. The HTML tag method needs a URL-prefix property; a Domain property is verified through DNS instead.",
		console: { label: "Open Search Console", href: "https://search.google.com/search-console" },
		guide: { label: "Google's HTML tag steps", href: "https://support.google.com/webmasters/answer/9008080?hl=en" },
	},
	bing: {
		name: "Bing Webmaster Tools",
		short: "Bing",
		example: "0123ABCD4567EF89",
		finish: "After saving, choose Verify for the HTML meta tag method in Bing Webmaster Tools.",
		console: { label: "Open Bing Webmaster Tools", href: "https://www.bing.com/webmasters" },
		guide: { label: "Bing's meta tag steps", href: "https://learn.microsoft.com/en-us/bingwebmaster/verifying-wordpress" },
	},
};

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

const STATUS_BADGES: Record<VerificationFieldStatus, { label: string; variant: BadgeVariant }> = {
	saved: { label: "Saved", variant: "secondary" },
	"not-configured": { label: "Not configured", variant: "outline" },
	unsaved: { label: "Unsaved", variant: "info" },
	unconfirmed: { label: "Unconfirmed", variant: "warning" },
	unreadable: { label: "Not readable", variant: "error" },
	changed: { label: "Changed elsewhere", variant: "warning" },
};

const READ_PROBLEMS: Record<VerificationReadProblem, { title: string; description: string }> = {
	"signed-out": { title: "Your session has ended", description: "Sign in again, then reload this view." },
	forbidden: { title: "Your role cannot read site settings", description: "EmDash refused to show its site settings, so the verification codes are not shown." },
	refused: { title: "EmDash refused the request", description: "The settings request was refused. Nothing is shown in place of the stored codes." },
	unavailable: { title: "EmDash could not read its site settings", description: "Nothing is shown in place of the stored codes. Try again." },
	malformed: { title: "EmDash returned settings this view cannot read", description: "Nothing is shown in place of the stored codes, and saving is off. The stored data is not changed from here." },
	network: { title: "The settings request did not complete", description: "Check the connection and try again. Nothing is shown in place of the stored codes." },
};

const BLOCKER_TEXT: Partial<Record<VerificationSaveBlocker, string>> = {
	role: "You can view these codes. Changing them needs an Administrator, because EmDash requires the settings:manage permission.",
	"role-unknown": "Your role is not confirmed yet, so saving is off. Reload if this stays.",
	unconfirmed: "Check the stored codes before saving again.",
	"write-in-progress": "A save started earlier on this page is still running.",
	changed: "A code changed in EmDash after you started editing it. Choose which code to keep in its card.",
	invalid: "Fix or undo the code marked in red before saving.",
};

function failureCode(failure: VerificationRequestFailure): string {
	if (failure.type === "response") return `${failure.status} ${failure.code}: ${failure.message}`;
	return failure.type === "malformed" ? failure.detail : failure.message;
}

function readableTime(date: Date): string {
	return date.toLocaleString("en", { dateStyle: "medium", timeStyle: "medium" });
}

function listProviders(providers: readonly VerificationProvider[]): string {
	return providers.map((provider) => PROVIDER_COPY[provider].short).join(" and ");
}

function problemText(provider: VerificationProvider, problem: VerificationDraftProblem): string {
	const copy = PROVIDER_COPY[provider];
	switch (problem.reason) {
		case "markup":
			return problem.code
				? "This is the whole meta tag. Paste only the value of its content attribute, or use the button below."
				: `Paste only the code, not HTML. In <meta name="${VERIFICATION_PROVIDER_FIELDS[provider].metaName}" content="${copy.example}"> the code is ${copy.example}.`;
		case "other-provider":
			return `This is the ${PROVIDER_COPY[problem.provider].short} tag. Paste the ${copy.short} code here instead.`;
		case "spaces":
			return "A code has no spaces, line breaks or invisible characters.";
		case "too-long":
			return `This code has ${problem.length} characters. EmDash accepts up to ${VERIFICATION_CODE_MAX_LENGTH}.`;
		case "empty":
			return "Enter a code, or choose Remove code to stop adding this tag.";
	}
}

function changeSummary(changes: readonly VerificationChange[], fields: VerificationFields): string {
	const parts = changes.map((change) => {
		const intent = verificationIntent(change.provider, fields[change.provider]);
		const action = intent.kind === "change" ? intent.action : "replace";
		const verb = action === "add" ? "adds" : action === "remove" ? "removes" : "replaces";
		return `${verb} the ${PROVIDER_COPY[change.provider].short} code`;
	});
	return parts.length ? `Saving ${parts.join(" and ")}.` : "";
}

type Load =
	| { status: "loading" }
	| { status: "failed"; problem: VerificationReadProblem; failure: VerificationRequestFailure }
	| { status: "ready"; snapshot: VerificationSnapshot; loadedAt: Date };

type Outcome = VerificationNotice;

export function SiteVerificationView() {
	const host = React.useContext(SiteVerificationHostContext);
	const user = useCurrentUser();
	const write = React.useSyncExternalStore(writeRegistry.subscribe, writeRegistry.current, writeRegistry.current);
	const [load, setLoad] = React.useState<Load>({ status: "loading" });
	const [fields, setFields] = React.useState<VerificationFields | null>(null);
	const [busy, setBusy] = React.useState<"reload" | "save" | "recovery" | null>(null);
	const [outcome, setOutcome] = React.useState<Outcome | null>(null);
	const [foreignSettle, setForeignSettle] = React.useState(false);
	const owner = React.useRef<VerificationOwner | null>(null);
	const lastSettled = React.useRef(writeRegistry.current().settled);

	const snapshot = load.status === "ready" ? load.snapshot : null;
	const hints = verificationRoleHints({ status: user.status, role: user.data?.role });
	const pending: VerificationPending | null = write.status === "unconfirmed" || write.status === "checking" ? write.pending : null;
	const blockers = verificationSaveBlockers({ snapshot, fields, hostVersion: host.hostVersion, manage: hints.manage, write, busy: busy !== null });
	const editable = verificationEditable({ snapshot, hostVersion: host.hostVersion, manage: hints.manage, write, busy: busy !== null });
	const canSave = blockers.length === 0;
	const readActions = verificationReadActions({ write, busy: busy !== null });
	const fieldChanges = fields ? verificationChanges(fields) : null;
	const unsavedCodes = fieldChanges !== null && (fieldChanges.changes.length > 0 || fieldChanges.problems.length > 0);
	const canDiscard = editable && unsavedCodes && pending === null;
	useWorkspaceDraftHold("verification-codes", unsavedCodes || busy !== null);

	React.useEffect(() => {
		const current = createVerificationOwner();
		owner.current = current;
		const token = current.claim();
		void loadVerificationSettings(settingsPort).then((result) => {
			if (!current.owns(token)) return;
			if (!result.ok) {
				setLoad({ status: "failed", problem: result.problem, failure: result.failure });
				return;
			}
			setLoad({ status: "ready", snapshot: result.snapshot, loadedAt: new Date() });
			// Codes of a save or check started before the view was reopened, read
			// when this first read answers, which can be after that operation did.
			const carried = writeRegistry.takeHandoff();
			const restored = restoreVerificationIntent(verificationFieldsFrom(result.snapshot), [...verificationWriteChanges(writeRegistry.current()), ...carried]);
			setFields(restored);
			const unsaved = verificationCarriedUnsaved(restored, result.snapshot, carried);
			setOutcome((previous) => verificationNoticeAfterHandoff(previous, unsaved));
		});
		return () => current.close();
	}, []);

	// A save or check this mount did not run has finished, for example one
	// started before the view was left and reopened.
	React.useEffect(() => {
		if (write.settled === lastSettled.current) return;
		lastSettled.current = write.settled;
		if (write.status !== "idle") return;
		setForeignSettle(true);
		// Without loaded fields, the first read takes the handoff instead.
		if (!fields) return;
		const carried = writeRegistry.takeHandoff();
		if (!carried.length) return;
		setFields((previous) => (previous ? restoreVerificationIntent(previous, carried) : previous));
		// Compared with this view's last read; EmDash may store something else by now.
		const unsaved = snapshot ? verificationCarriedUnsaved(restoreVerificationIntent(fields, carried), snapshot, carried) : [];
		setOutcome((previous) => verificationNoticeAfterHandoff(previous, unsaved));
	}, [write]);

	function refreshRole(problem: VerificationReadProblem | VerificationWriteRefusal) {
		// The cached role is only a hint; read it again after the endpoint refused.
		if (verificationRefusalRereadsRole(problem)) void user.refetch();
	}

	// Once per owner-requested read; returns whether the role is being reread.
	function refreshRoleForRead(): boolean {
		if (!verificationRoleRefreshWanted(hints.manage, user.isFetching)) return false;
		void user.refetch();
		return true;
	}

	async function reload() {
		const current = owner.current;
		if (!current || !readActions.reload) return;
		const token = current.claim();
		const roleRefreshed = refreshRoleForRead();
		setBusy("reload");
		const result = await loadVerificationSettings(settingsPort);
		if (!current.owns(token)) return;
		setBusy(null);
		setForeignSettle(false);
		if (!result.ok) {
			if (!roleRefreshed) refreshRole(result.problem);
			if (load.status === "ready") setOutcome((previous) => verificationNoticeAfterReload(previous, { ok: false, failure: result.failure }));
			else setLoad({ status: "failed", problem: result.problem, failure: result.failure });
			return;
		}
		setLoad({ status: "ready", snapshot: result.snapshot, loadedAt: new Date() });
		const carried = writeRegistry.takeHandoff();
		// Inputs are read-only while the reload runs, so the fields of this render are current.
		const next = restoreVerificationIntent(fields ? mergeVerificationSnapshot(fields, result.snapshot) : verificationFieldsFrom(result.snapshot), carried);
		setFields(next);
		setOutcome((previous) => verificationNoticeAfterReload(previous, { ok: true, fields: next, snapshot: result.snapshot }));
	}

	async function save() {
		const current = owner.current;
		// Eligibility from this render; the inputs are read-only while it runs.
		if (!current || !fields || !canSave) return;
		const sent = fields;
		const { changes } = verificationChanges(sent);
		const ticket = writeRegistry.beginSave(changes);
		if (!ticket) return;
		const token = current.claim();
		setBusy("save");
		setOutcome(null);
		setForeignSettle(false);
		let result: VerificationSaveResult;
		try {
			result = await saveVerificationCodes(settingsPort, changes);
		} catch (error) {
			const failure: VerificationRequestFailure = { type: "transport", message: error instanceof Error ? error.message : "The save did not complete." };
			result = { status: "unconfirmed", pending: { changes, cause: "write", failure } };
		}
		// Settled and invalidated even when the view has been left meanwhile.
		writeRegistry.finish(ticket, result.status === "unconfirmed" ? result.pending : null, verificationSaveHandoff(changes, result));
		lastSettled.current = writeRegistry.current().settled;
		if (verificationSaveMayHaveCommitted(result)) host.onSettingsChanged?.();
		// When the view has been left, the next one takes the unsettled codes.
		if (!current.owns(token)) return;
		writeRegistry.takeHandoff();
		setBusy(null);
		const changed = changes.map((change) => change.provider);
		switch (result.status) {
			case "confirmed": {
				const latest = result.latest;
				const confirmed = result.providers;
				setLoad({ status: "ready", snapshot: latest, loadedAt: new Date() });
				setFields((previous) => settleVerificationFields(previous ?? sent, sent, latest, changed, confirmed));
				setOutcome({ status: "saved", providers: confirmed });
				return;
			}
			case "conflict": {
				const { latest, confirmed } = result;
				setLoad({ status: "ready", snapshot: latest, loadedAt: new Date() });
				setFields((previous) => settleVerificationFields(previous ?? sent, sent, latest, changed, confirmed));
				setOutcome(result);
				return;
			}
			case "stale": {
				const latest = result.latest;
				setLoad({ status: "ready", snapshot: latest, loadedAt: new Date() });
				setFields((previous) => mergeVerificationSnapshot(previous ?? sent, latest));
				setOutcome(result);
				return;
			}
			case "rejected":
				refreshRole(result.refusal);
				setOutcome(result);
				return;
			case "not-checked":
				refreshRole(result.problem);
				setOutcome(result);
				return;
			case "unconfirmed":
				return;
		}
	}

	async function recover() {
		const current = owner.current;
		const state = writeRegistry.current();
		if (!current || !readActions.check || state.status !== "unconfirmed") return;
		const ticket = writeRegistry.beginRecovery();
		if (!ticket) return;
		const token = current.claim();
		const roleRefreshed = refreshRoleForRead();
		setBusy("recovery");
		setOutcome(null);
		setForeignSettle(false);
		const result = await recoverVerificationOutcome(settingsPort, state.pending);
		writeRegistry.finish(ticket, result.ok ? null : state.pending, result.ok ? verificationRecoveryHandoff(state.pending, result.outcomes) : []);
		lastSettled.current = writeRegistry.current().settled;
		// When the view has been left, the next one takes the codes not found stored.
		if (!current.owns(token)) return;
		writeRegistry.takeHandoff();
		setBusy(null);
		if (!result.ok) {
			if (!roleRefreshed) refreshRole(result.problem);
			setOutcome({ status: "recovery-failed", failure: result.failure });
			return;
		}
		const latest = result.latest;
		const changed = state.pending.changes.map((change) => change.provider);
		const stored = result.outcomes.filter((item) => item.outcome === "sent").map((item) => item.provider);
		setLoad({ status: "ready", snapshot: latest, loadedAt: new Date() });
		setFields((previous) => {
			// After a failed initial read or a reopened view the sent codes come from the registry, not the form.
			const before = restoreVerificationIntent(previous ?? verificationFieldsFrom(latest), state.pending.changes);
			return settleVerificationFields(before, before, latest, changed, stored);
		});
		setOutcome({ status: "recovered", outcomes: result.outcomes });
	}

	/** Never writes: every code returns to the stored value its draft started from. */
	function discard() {
		if (!canDiscard) return;
		edit((previous) => VERIFICATION_PROVIDERS.reduce((next, provider) => undoVerificationField(next, provider), previous));
	}

	function edit(update: (previous: VerificationFields) => VerificationFields) {
		if (!editable) return;
		setFields((previous) => (previous ? update(previous) : previous));
		setOutcome((previous) => verificationNoticeAfterEdit(previous));
	}

	const unconfirmedBanner = pending ? (
		<Banner
			role="alert"
			variant="error"
			icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
			title={pending.cause === "readback" ? "EmDash accepted the save, but it is not confirmed" : "The save may or may not have been applied"}
			description={pending.cause === "readback"
				? `The read after saving failed (${failureCode(pending.failure)}). Check the stored codes before saving again.`
				: `The response was lost or unreadable (${failureCode(pending.failure)}), so EmDash may have stored the ${listProviders(pending.changes.map((change) => change.provider))} code. Nothing is retried or undone automatically, and saving stays off until you check what is stored.`}
			action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={write.status === "checking"} disabled={!readActions.check} onClick={() => void recover()}>Check stored codes</Button>}
		/>
	) : null;

	const heading = (
		<div className="shipit-seo-section-heading">
			<div>
				<span className="shipit-seo-eyebrow">Search engines</span>
				<h2 id="seo-verification-title">Site verification</h2>
			</div>
			{load.status === "ready" ? (
				<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={busy === "reload"} disabled={!readActions.reload} onClick={() => void reload()}>
					Reload
				</Button>
			) : null}
		</div>
	);

	if (load.status === "loading") {
		return <p className="shipit-seo-muted" role="status">Loading the stored verification codes</p>;
	}
	if (load.status === "failed" || !fields) {
		const problem = load.status === "failed" ? READ_PROBLEMS[load.problem] : READ_PROBLEMS.unavailable;
		const state = load.status === "failed" ? verificationReadState(load.problem) : "unavailable";
		return (
			<section className="shipit-seo-panel shipit-seo-verification-panel" aria-labelledby="seo-verification-title">
				{heading}
				{unconfirmedBanner}
				<Banner
					role="alert"
					variant={state === "denied" ? "alert" : "error"}
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={problem.title}
					description={`${problem.description}${load.status === "failed" ? ` (${failureCode(load.failure)})` : ""}`}
					action={pending ? undefined : (
						<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={busy === "reload"} disabled={!readActions.reload} onClick={() => void reload()}>Try again</Button>
					)}
				/>
			</section>
		);
	}

	const current = load.snapshot;
	const draftSummary = verificationDraftSummary(fields);
	const notices = blockers.filter((item) => BLOCKER_TEXT[item]);
	const hostUnverified = blockers.includes("host-unverified");
	const statusLine = pending
		? "The outcome of the last save is unconfirmed."
		: busy === "save"
			? "Saving: checking the stored codes, writing the changed ones, then reading them back."
			: draftSummary.kind === "invalid"
				? `Unsaved changes. Fix or undo the ${listProviders(draftSummary.problems)} code before saving.`
				: draftSummary.kind === "ready"
					? changeSummary(draftSummary.changes, fields)
					: `No unsaved changes. Stored codes loaded ${readableTime(load.loadedAt)}.`;

	return (
		<div className="shipit-seo-verification-page">
			<section className="shipit-seo-panel shipit-seo-verification-panel" aria-labelledby="seo-verification-title">
				{heading}
				<p className="shipit-seo-verification-copy">
					Paste the code from the HTML tag method of Google Search Console and Bing Webmaster Tools. EmDash adds each
					saved code as a meta tag in the head of pages that render EmDashHead. Saving a code does not verify the site:
					finish with Verify in the provider's tool.
				</p>
				<p className="shipit-seo-verification-host-note">
					EmDash Settings {">"} SEO edits the same Google and Bing fields; whichever save happens last is kept.{" "}
					<a className="shipit-seo-verification-link" href={CORE_SEO_SETTINGS_PATH}>Open EmDash SEO settings</a>
				</p>
				{unconfirmedBanner}
				{foreignSettle ? (
					<Banner
						role="status"
						variant="alert"
						icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
						title="A save started earlier has finished"
						description="The codes shown here were read before it finished. Reload to see what EmDash stores now."
					/>
				) : null}
				<SaveOutcome outcome={outcome} />
				{hostUnverified ? (
					<Banner
						role="status"
						variant="alert"
						icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
						title="Saving here is off for this EmDash version"
						description={`This EmDash version does not support safe verification updates through this editor. ${host.hostVersion ? `This site runs EmDash ${host.hostVersion}.` : "The EmDash version could not be read."} Use EmDash's own SEO settings instead.`}
						action={<a className="shipit-seo-verification-link" href={CORE_SEO_SETTINGS_PATH}>Open SEO settings</a>}
					/>
				) : null}
			</section>

			<div className="shipit-seo-verification-providers">
				{VERIFICATION_PROVIDERS.map((provider) => (
					<ProviderCard
						key={provider}
						provider={provider}
						field={fields[provider]}
						latest={current.codes[provider]}
						status={verificationFieldStatus({ provider, field: fields[provider], latest: current.codes[provider], pending })}
						editable={editable}
						onDraft={(draft) => edit((previous) => editVerificationDraft(previous, provider, draft))}
						onRemove={() => edit((previous) => removeVerificationCode(previous, provider))}
						onUndo={() => edit((previous) => undoVerificationField(previous, provider))}
						onResolve={(choice) => edit((previous) => resolveVerificationChange(previous, provider, current.codes[provider], choice))}
					/>
				))}
			</div>

			<section className="shipit-seo-panel shipit-seo-verification-save" aria-label="Save Google and Bing codes">
				<p className="shipit-seo-verification-copy">Saves only the Google and Bing codes in EmDash's SEO settings. Custom tags below have their own save.</p>
				<div className="shipit-seo-verification-actions">
					<p className="shipit-seo-verification-copy" role="status">{statusLine}</p>
					<div className="shipit-seo-verification-buttons">
						<Button type="button" variant="secondary" icon={ArrowCounterClockwise} disabled={!canDiscard} onClick={discard}>
							Discard changes
						</Button>
						<Button type="button" variant="primary" loading={busy === "save"} disabled={!canSave} onClick={() => void save()}>
							Save Google and Bing codes
						</Button>
					</div>
				</div>
				{notices.length ? (
					<ul className="shipit-seo-verification-notes">
						{notices.map((item) => <li key={item}>{BLOCKER_TEXT[item]}</li>)}
					</ul>
				) : null}
			</section>

			<details className="shipit-seo-panel shipit-seo-verification-help">
				<summary>How EmDash publishes these codes</summary>
				<ul>
					<li>
						EmDash core stores both codes in its SEO settings. <a className="shipit-seo-verification-link" href={CORE_SEO_SETTINGS_PATH}>EmDash's SEO settings</a> edit
						the same fields; this plugin keeps no copy.
					</li>
					<li>
						Core adds the tags to every page that renders EmDashHead. A theme without EmDashHead does not output them, and a
						tag with the same name from a plugin or the theme can replace or duplicate core's tag. Check the page source
						of your home page before choosing Verify.
					</li>
					<li>
						Saving checks the stored codes first and reads them back afterwards. EmDash keeps whichever save lands last, so
						a save from another tab or from EmDash's SEO settings between those two steps can still replace yours.
					</li>
					<li>Removing a code stops EmDash adding its tag. Providers can check the tag again later, so keep it after verification.</li>
				</ul>
			</details>
		</div>
	);
}

function storedDetail(provider: VerificationProvider, stored: VerificationStoredCode): string {
	if (stored.kind === "none") return "No code is stored, so no tag is added.";
	if (stored.kind === "unreadable") return `The stored value is not text (${stored.type}), so it is not shown. It is kept unless you enter a new code or remove it.`;
	return verificationStoredCodeIsPlain(provider, stored)
		? "EmDash adds this code as a meta tag. Saved does not mean verified."
		: "The stored value has spaces or HTML characters that providers do not use in a code. EmDash outputs it as stored.";
}

function ProviderCard({ provider, field, latest, status, editable, onDraft, onRemove, onUndo, onResolve }: {
	provider: VerificationProvider;
	field: VerificationFieldState;
	latest: VerificationStoredCode;
	status: VerificationFieldStatus;
	editable: boolean;
	onDraft: (draft: string) => void;
	onRemove: () => void;
	onUndo: () => void;
	onResolve: (choice: "use-stored" | "keep-mine") => void;
}) {
	const copy = PROVIDER_COPY[provider];
	const metaName = VERIFICATION_PROVIDER_FIELDS[provider].metaName;
	const intent = verificationIntent(provider, field);
	const problem = intent.kind === "problem" ? intent.problem : null;
	const extracted = problem?.reason === "markup" ? problem.code : null;
	const titleId = `seo-verification-${provider}-title`;
	const length = verificationCodeLength(field.draft.trim());
	const edited = field.remove || field.draft !== (field.base.kind === "code" ? field.base.code : "");
	const liveCode = !field.remove && field.draft.trim() && !problem ? field.draft.trim() : null;
	const liveLabel = liveCode === null ? "Tag shape"
		: status === "unconfirmed" ? "Tag from the unconfirmed save"
			: edited ? "Tag EmDash adds after saving" : "Tag EmDash adds";
	const badge = STATUS_BADGES[status];
	const detail = status === "unconfirmed"
		? "The last save of this code is unconfirmed. Choose Check stored codes to see what EmDash stores."
		: status === "changed"
			? `The stored code changed after you started editing. EmDash now has ${latest.kind === "code" ? latest.code : latest.kind === "none" ? "no code" : "a value that is not text"}.`
			: intent.kind === "change"
				? intent.action === "remove"
					? `Saving removes this code, and EmDash stops adding the ${copy.short} tag.`
					: "Not saved yet. Pages keep the stored code until you save."
				: storedDetail(provider, field.base);

	return (
		<section className="shipit-seo-panel shipit-seo-verification-card" aria-labelledby={titleId}>
			<div className="shipit-seo-section-heading">
				<h3 id={titleId}>{copy.name}</h3>
				<Badge variant={badge.variant}>{badge.label}</Badge>
			</div>
			<Input
				label="Verification code"
				data-seo-setting={VERIFICATION_SETTING_IDS[provider]}
				description={`Copy only the code. In <meta name="${metaName}" content="${copy.example}"> it is ${copy.example}. Up to ${VERIFICATION_CODE_MAX_LENGTH} characters.`}
				value={field.draft}
				placeholder={field.remove ? "Removed when you save" : "Paste the content value"}
				readOnly={!editable}
				error={problem ? problemText(provider, problem) : undefined}
				aria-invalid={problem ? true : undefined}
				spellCheck={false}
				autoCapitalize="off"
				autoCorrect="off"
				autoComplete="off"
				passwordManagerIgnore
				onChange={(event) => onDraft(event.target.value)}
			/>
			<p className="shipit-seo-verification-note">
				{detail}
				{field.draft.trim() && !problem ? ` ${length} of ${VERIFICATION_CODE_MAX_LENGTH} characters.` : ""}
			</p>
			{editable && (extracted || status === "changed" || edited || field.base.kind !== "none") ? (
				<div className="shipit-seo-verification-field-actions">
					{extracted ? <Button size="sm" variant="secondary" onClick={() => onDraft(extracted)}>Use code {extracted}</Button> : null}
					{status === "changed" ? (
						<>
							<Button size="sm" variant="secondary" onClick={() => onResolve("use-stored")}>Use stored code</Button>
							<Button size="sm" variant="secondary" onClick={() => onResolve("keep-mine")}>Keep my edit</Button>
						</>
					) : null}
					{edited && status !== "changed" ? <Button size="sm" variant="secondary" onClick={onUndo}>Undo</Button> : null}
					{field.base.kind !== "none" && !field.remove && status !== "changed" ? (
						<Button size="sm" variant="secondary-destructive" onClick={onRemove}>Remove code</Button>
					) : null}
				</div>
			) : null}
			{field.remove ? null : (
				<div className="shipit-seo-verification-live-tag">
					<span>{liveLabel}</span>
					<code>{verificationMetaTag(provider, liveCode ?? "YOUR_CODE")}</code>
				</div>
			)}
			{status === "unconfirmed" && latest.kind === "code" ? (
				<details className="shipit-seo-verification-tag">
					<summary>Previously loaded tag</summary>
					<pre tabIndex={0}>{verificationMetaTag(provider, latest.code)}</pre>
				</details>
			) : null}
			<p className="shipit-seo-verification-copy">{copy.finish}</p>
			<ul className="shipit-seo-verification-links">
				<li>
					<a className="shipit-seo-verification-link" href={copy.console.href} target="_blank" rel="noopener noreferrer">
						{copy.console.label}
						<ArrowSquareOut size={13} aria-hidden="true" />
						<span className="shipit-seo-visually-hidden"> (opens in a new tab)</span>
					</a>
				</li>
				<li>
					<a className="shipit-seo-verification-link" href={copy.guide.href} target="_blank" rel="noopener noreferrer">
						{copy.guide.label}
						<ArrowSquareOut size={13} aria-hidden="true" />
						<span className="shipit-seo-visually-hidden"> (opens in a new tab)</span>
					</a>
				</li>
			</ul>
		</section>
	);
}

function SaveOutcome({ outcome }: { outcome: Outcome | null }) {
	if (!outcome) return null;
	const icon = <WarningCircle size={20} weight="fill" aria-hidden="true" />;
	switch (outcome.status) {
		case "carried":
			return (
				<Banner role="status" variant="alert" icon={icon} title="An earlier save left unsaved entries"
					description={outcome.providers.length === 1
						? `The ${listProviders(outcome.providers)} entry differs from what this view last read from EmDash and is kept as unsaved. Reload to see what EmDash stores now, and review it before saving.`
						: `The ${listProviders(outcome.providers)} entries differ from what this view last read from EmDash and are kept as unsaved. Reload to see what EmDash stores now, and review them before saving.`} />
			);
		case "saved":
			return (
				<Banner role="status" variant="default" title={`${listProviders(outcome.providers)} code saved and read back`}
					description={`EmDash adds the saved tags to pages that render EmDashHead. This is not verification: finish with Verify in ${outcome.providers.map((provider) => PROVIDER_COPY[provider].name).join(" and ")}.`} />
			);
		case "conflict":
			return (
				<Banner role="status" variant="alert" icon={icon} title="Saved, then replaced by another save"
					description={`EmDash accepted your save, but the read straight after shows a different ${listProviders(outcome.replaced)} code. Your entry is kept in the field. The last save wins.`} />
			);
		case "stale":
			return (
				<Banner role="status" variant="alert" icon={icon} title="Nothing was saved: a code changed after you loaded it"
					description={`The stored ${listProviders(outcome.providers)} code changed in EmDash since this page read it. Choose which code to keep in its card, then save again.`} />
			);
		case "not-checked":
			return outcome.problem === "signed-out"
				? <Banner role="alert" variant="error" icon={icon} title="Your session has ended"
					description={`Nothing was saved; your entries are kept (${failureCode(outcome.failure)}). Sign in again in another tab, then reload this view and save.`} />
				: <Banner role="alert" variant="error" icon={icon} title="Nothing was saved"
					description={`The stored codes could not be checked before saving (${failureCode(outcome.failure)}). Your entries are kept.`} />;
		case "rejected": {
			const titles = {
				invalid: "EmDash rejected the codes",
				"signed-out": "Your session has ended",
				forbidden: "Your role cannot change site settings",
				refused: "EmDash refused the save",
			} as const;
			return (
				<Banner role="alert" variant="error" icon={icon} title={titles[outcome.refusal]}
					description={`Nothing was saved; your entries are kept (${failureCode(outcome.failure)}).${outcome.refusal === "signed-out" ? " Sign in again in another tab, then reload this view and save." : ""}`} />
			);
		}
		case "recovered":
			return (
				<Banner role="status" variant="alert" icon={icon} title="Stored codes checked"
					description={outcome.outcomes.map(({ provider, outcome: found }) => {
						const name = PROVIDER_COPY[provider].short;
						if (found === "sent") return `${name}: EmDash stores the code you sent.`;
						if (found === "previous") return `${name}: EmDash stores the code you started from. Whether your save was applied and then replaced is unknown; your entry is kept.`;
						return `${name}: EmDash stores a different code, so another save happened. Your entry is kept.`;
					}).join(" ")} />
			);
		case "recovery-failed":
			return <Banner role="alert" variant="error" icon={icon} title="The stored codes could not be read"
				description={`Saving stays off (${failureCode(outcome.failure)}). Try the check again.`} />;
		case "reload-failed":
			return <Banner role="alert" variant="error" icon={icon} title="The stored codes could not be reloaded"
				description={`Your entries are kept (${failureCode(outcome.failure)}).`} />;
	}
}
