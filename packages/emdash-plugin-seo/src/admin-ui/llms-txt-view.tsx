import * as React from "react";
import { ApiResponseError } from "@emdash-cms/admin";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Textarea } from "@cloudflare/kumo/components/input";
import { Switch } from "@cloudflare/kumo/components/switch";
import { ArrowClockwise, Article, DownloadSimple, WarningCircle } from "@phosphor-icons/react";
import type { SeoAdminLlmsTxt, SeoLlmsTxtOwner } from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	LLMS_TXT_DOCUMENT_MAX_BYTES,
	LLMS_TXT_DOCUMENT_PROBLEM_TEXT,
	LLMS_TXT_HEADING_PROBLEM_TEXT,
	LLMS_TXT_PATH,
	checkLlmsTxtActivation,
	checkLlmsTxtDocument,
	classifyLlmsTxtObservation,
	llmsTxtUtf8Bytes,
	type LlmsTxtDocumentProblem,
	type LlmsTxtHeadingProblem,
	type LlmsTxtObservationResult,
} from "../llms-txt-document.ts";
import { fetchSeoAdminLlmsTxt, resetSeoAdminLlmsTxt, saveSeoAdminLlmsTxt, setSeoAdminLlmsTxtEnabled } from "./api.ts";
import {
	LLMS_TXT_OBSERVATION_MAX_BYTES,
	llmsTxtAuthoritative,
	llmsTxtDraftDirty,
	llmsTxtDraftFrom,
	llmsTxtDraftText,
	llmsTxtEditable,
	llmsTxtExpectedAnswer,
	llmsTxtLineEndConsentNeeded,
	llmsTxtLineEnds,
	llmsTxtObservationAllowed,
	llmsTxtObservationExpectation,
	llmsTxtOutputBlockers,
	llmsTxtReadProblem,
	llmsTxtResetBlockers,
	llmsTxtSaveBlockers,
	llmsTxtSegments,
	llmsTxtStartsWithBom,
	llmsTxtStoredText,
	llmsTxtUncertainOutcome,
	readLlmsTxtObservationBody,
	runLlmsTxtWrite,
	type LlmsTxtBlocker,
	type LlmsTxtDraft,
	type LlmsTxtOperation,
	type LlmsTxtPort,
	type LlmsTxtPortResult,
	type LlmsTxtReadProblem,
	type LlmsTxtRequestFailure,
	type LlmsTxtWriteOutcome,
} from "./llms-txt-model.ts";
import { useSeoToasts, useWorkspaceDraftHold, useWorkspacePageActive } from "./workspace-shell.tsx";

const OBSERVATION_TIMEOUT_MS = 10_000;

async function call<T>(run: () => Promise<T>): Promise<LlmsTxtPortResult<T>> {
	try {
		return { ok: true, value: await run() };
	} catch (error) {
		if (error instanceof ApiResponseError) {
			return { ok: false, failure: { type: "response", status: error.status, code: error.code, message: error.message } };
		}
		if (error instanceof SyntaxError || (error instanceof Error && error.message.startsWith("Invalid SEO admin response"))) {
			return { ok: false, failure: { type: "malformed", detail: error.message } };
		}
		return { ok: false, failure: { type: "transport", message: error instanceof Error ? error.message : "The request did not complete." } };
	}
}

const port: LlmsTxtPort = {
	read: () => call(() => fetchSeoAdminLlmsTxt()),
	save: (body) => call(() => saveSeoAdminLlmsTxt(body)),
	setEnabled: (revision, enabled) => call(() => setSeoAdminLlmsTxtEnabled(revision, enabled)),
	reset: (revision) => call(() => resetSeoAdminLlmsTxt(revision)),
};

const OWNER_LABELS: Record<SeoLlmsTxtOwner, string> = {
	shipit: "This plugin",
	unsettled: "Not confirmed",
	unknown: "Unknown",
	"site-route": "Site route",
	"static-file": "Static file",
	integration: "Another integration",
	"competing-route": "Another route",
	"unsupported-routing": "Unsupported routing",
	"unsupported-host": "Unverified EmDash version",
	"not-installed": "Not recorded",
};

function ownerExplanation(owner: SeoLlmsTxtOwner, detail: string | null): string {
	switch (owner) {
		case "unsettled":
			return "The build did not record which route answers /llms.txt. Restart or rebuild the site; changes stay off until it is confirmed.";
		case "unknown":
			return `${detail ?? "Part of the site configuration could not be read"}, so it is not known whether the site has its own llms.txt. Fix the permission and restart; changes stay off.`;
		case "site-route":
			return `The site's own page${detail ? ` (${detail})` : ""} answers /llms.txt. Edit that file; text saved here would not be served.`;
		case "static-file":
			return `The site publishes ${detail ?? "a static llms.txt"}, which is served before any route. Edit or remove that file; text saved here would not be served.`;
		case "integration":
			return `${detail ?? "Another integration"} can serve llms.txt for this site. Change its configuration; text saved here would not be served.`;
		case "competing-route":
			return `${detail ?? "Another route answers /llms.txt"}. This plugin does not take the address from it, so changes are off. A catch-all page such as /[...slug] counts as such a route.`;
		case "unsupported-routing":
			return `${detail ?? "This routing setup"} is not verified for /llms.txt, so this plugin does not serve it here.`;
		case "unsupported-host":
			return `This EmDash version is not supported by this editor${detail ? ` (${detail})` : ""}.`;
		case "not-installed":
			return "Install the plugin through its Astro integration so the build records who serves /llms.txt. Until then changes are off.";
		default:
			return "";
	}
}

const READ_PROBLEMS: Record<LlmsTxtReadProblem, { title: string; description: string }> = {
	unauthorized: { title: "Your session has ended", description: "Sign in again, then reload this view." },
	denied: { title: "Your role cannot manage plugins", description: "llms.txt is managed with the plugin management permission. Nothing is shown." },
	"not-found": { title: "The llms.txt route is not available", description: "The plugin may be inactive or older than this admin. Nothing is shown." },
	refused: { title: "EmDash refused the request", description: "Nothing is shown in place of the stored document." },
	service: { title: "llms.txt could not be read", description: "Nothing is shown in place of the stored document. Try again." },
	malformed: { title: "The response could not be read", description: "Nothing is shown in place of the stored document." },
	network: { title: "The request did not complete", description: "Check the connection and try again." },
};

const BLOCKER_TEXT: Partial<Record<LlmsTxtBlocker, string>> = {
	owner: "This plugin does not serve /llms.txt on this site, so changes are off.",
	storage: "This EmDash host cannot save with a revision check, so changes are off.",
	unavailable: "The stored document could not be read, so changes are off.",
	corrupt: "The stored record is invalid. Download its copy and reset it before saving.",
	uncertain: "Reload the stored document before saving again.",
	"reload-required": "Reload the stored document before saving again.",
	"line-ends": "Confirm the line-end change above to save.",
};

function readableTime(date: Date | null): string {
	return date ? date.toLocaleString("en", { dateStyle: "medium", timeStyle: "medium" }) : "Not yet";
}

function failureCode(failure: LlmsTxtRequestFailure): string {
	if (failure.type === "response") return `${failure.status} ${failure.code}: ${failure.message}`;
	return failure.type === "malformed" ? failure.detail : failure.message;
}

function problemText(problem: LlmsTxtDocumentProblem | LlmsTxtHeadingProblem): string {
	return problem in LLMS_TXT_DOCUMENT_PROBLEM_TEXT
		? `The text is refused: ${LLMS_TXT_DOCUMENT_PROBLEM_TEXT[problem as LlmsTxtDocumentProblem]}`
		: LLMS_TXT_HEADING_PROBLEM_TEXT[problem as LlmsTxtHeadingProblem];
}

function storedSummary(state: SeoAdminLlmsTxt): string {
	switch (state.state) {
		case "absent":
			return "No document saved";
		case "stored":
			return `${(state.bytes ?? 0).toLocaleString("en")} UTF-8 bytes`;
		case "corrupt":
			return "Invalid record";
		default:
			return "Could not be read";
	}
}

function outputSetting(state: SeoAdminLlmsTxt): string {
	if (state.state === "unavailable") return "Unknown: the record could not be read";
	if (state.state === "corrupt") return "Unusable: the record is invalid";
	if (state.state === "absent") return "Off: no document";
	return state.enabled ? "On" : "Off: the document is kept";
}

function expectedAnswerText(state: SeoAdminLlmsTxt): string {
	const expected = llmsTxtExpectedAnswer(state);
	if (state.owner !== "shipit") return "None: this plugin does not serve /llms.txt here";
	if (expected === null) return "Unknown until the record can be read";
	return expected === 200 ? "200 with the stored text" : expected === 404 ? "404, not served" : "503, temporarily unavailable";
}

interface Observation {
	status: "idle" | "checking" | "done" | "stale";
	checkedAt: Date | null;
	result: LlmsTxtObservationResult | null;
	httpStatus: number | null;
	contentType: string | null;
	cacheControl: string | null;
	body: string | null;
}

const OBSERVATION_IDLE: Observation = { status: "idle", checkedAt: null, result: null, httpStatus: null, contentType: null, cacheControl: null, body: null };

function observationText(observation: Observation, path: string): { label: string; tone: "success" | "secondary" | "error"; detail: string } {
	const result = observation.result;
	if (observation.status === "checking") return { label: "Checking", tone: "secondary", detail: "Reading the public file once." };
	if (observation.status === "stale") return { label: "Not checked since the change", tone: "secondary", detail: "The previous result was cleared because the stored record may have changed." };
	if (!result) return { label: "Not checked", tone: "secondary", detail: "" };
	switch (result.status) {
		case "matches":
			return { label: "Serves the stored text", tone: "success", detail: `${path} answered 200 with exactly the stored bytes as UTF-8 plain text.` };
		case "expected-status":
			return { label: `Answers ${observation.httpStatus}`, tone: "secondary", detail: observation.httpStatus === 404 ? `${path} is not served, as the stored state predicts.` : `${path} answers 503, as an invalid stored record predicts.` };
		case "different-text":
			return { label: "Different text", tone: "error", detail: "Status 200 with other text: a cache, another owner or a later save answered. Compare it below." };
		case "wrong-type":
			return { label: "Different content type", tone: "error", detail: `The text matches, but the response type is ${result.contentType ?? "missing"}.` };
		case "served-unexpectedly":
			return { label: "Still served", tone: "error", detail: "A file is served although the stored state predicts none. A cache can keep the earlier response for up to 5 minutes, or another owner answers." };
		case "unexpected-status":
			return { label: `Answers ${observation.httpStatus}`, tone: "error", detail: "The status differs from what the stored state predicts." };
		case "observed":
			return { label: `Answers ${observation.httpStatus}`, tone: "secondary", detail: "Nothing is predicted here, because this plugin does not serve this file or the record could not be read. The response is shown without a comparison." };
		default:
			return {
				label: "Not verified",
				tone: "error",
				detail: result.reason === "redirect" ? "The address answered with a redirect, which this check does not follow." :
					result.reason === "too-large" ? `The response is larger than ${LLMS_TXT_OBSERVATION_MAX_BYTES.toLocaleString("en")} bytes, so it was not read to the end.` :
					result.reason === "invalid-encoding" ? "The response contains bytes that are not UTF-8, so it cannot equal the stored text." :
					result.reason === "timeout" ? `The address did not answer within ${OBSERVATION_TIMEOUT_MS / 1000} seconds.` : "The request did not complete.",
			};
	}
}

/** Exact text as React text nodes, never HTML; optional marks for spaces, line ends and invisible characters. */
function ExactText({ text, showWhitespace, labelledBy }: { text: string; showWhitespace: boolean; labelledBy: string }) {
	return (
		<pre className="shipit-seo-llms-body" tabIndex={0} aria-labelledby={labelledBy}>
			{showWhitespace
				? llmsTxtSegments(text).map((segment, index) => {
					if (segment.kind === "eol") {
						return <React.Fragment key={index}><span className="shipit-seo-llms-mark" aria-hidden="true">{segment.label}</span>{"\n"}</React.Fragment>;
					}
					if (segment.kind === "space") return <span key={index} className="shipit-seo-llms-space">{segment.text}</span>;
					if (segment.kind === "mark") return <span key={index} className="shipit-seo-llms-mark" title={segment.label}>{segment.label}</span>;
					return <React.Fragment key={index}>{segment.text}</React.Fragment>;
				})
				: text}
		</pre>
	);
}

function downloadCopy(copy: string, revision: string | null) {
	const url = URL.createObjectURL(new Blob([copy], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = `llms-txt-stored-value-${(revision ?? "unknown").slice(0, 12)}.json`;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type Outcome =
	| LlmsTxtWriteOutcome
	| { status: "reload-failed"; problem: LlmsTxtReadProblem }
	| { status: "still-unavailable" };

export function LlmsTxtView() {
	const toasts = useSeoToasts();
	const [load, setLoad] = React.useState<
		| { status: "loading" }
		| { status: "failed"; problem: LlmsTxtReadProblem; failure: LlmsTxtRequestFailure }
		| { status: "ready"; state: SeoAdminLlmsTxt; loadedAt: Date }
	>({ status: "loading" });
	// Null until an authoritative read gives the editor a basis; then only an
	// explicit discard, a confirmed save or a reset replaces it.
	const [draft, setDraft] = React.useState<LlmsTxtDraft | null>(null);
	const [busy, setBusy] = React.useState<"save" | "output" | "reset" | "reload" | null>(null);
	// Set after an uncertain write until an authoritative reload succeeds.
	const [uncertain, setUncertain] = React.useState<{ operation: LlmsTxtOperation; failure: LlmsTxtRequestFailure } | null>(null);
	const [reloadRequired, setReloadRequired] = React.useState(false);
	const [lineEndsAccepted, setLineEndsAccepted] = React.useState(false);
	const [outcome, setOutcome] = React.useState<Outcome | null>(null);
	const [showWhitespace, setShowWhitespace] = React.useState(false);
	const [resetOpen, setResetOpen] = React.useState(false);
	const [copySaved, setCopySaved] = React.useState(false);
	const [observation, setObservation] = React.useState<Observation>(OBSERVATION_IDLE);
	const observeToken = React.useRef(0);
	const observeController = React.useRef<AbortController | null>(null);
	const writing = React.useRef(false);

	const state = load.status === "ready" ? load.state : null;
	const origin = typeof window === "undefined" ? "" : window.location.origin;

	const observe = React.useCallback(async (current: SeoAdminLlmsTxt) => {
		const token = ++observeToken.current;
		observeController.current?.abort();
		const controller = new AbortController();
		observeController.current = controller;
		setObservation((previous) => ({ ...previous, status: "checking" }));
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, OBSERVATION_TIMEOUT_MS);
		let next: Observation;
		try {
			// This admin's own origin and the fixed path only, without cookies or the browser cache.
			const response = await fetch(new URL(LLMS_TXT_PATH, window.location.origin), {
				cache: "no-store", credentials: "omit", redirect: "manual", signal: controller.signal,
			});
			const redirected = response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
			const read = redirected
				? { text: "", bytes: 0, truncated: false, invalidEncoding: false }
				: await readLlmsTxtObservationBody(response.body);
			const contentType = response.headers.get("content-type");
			next = {
				status: "done",
				checkedAt: new Date(),
				httpStatus: response.status,
				contentType,
				cacheControl: response.headers.get("cache-control"),
				body: read.invalidEncoding ? null : read.text,
				result: classifyLlmsTxtObservation(llmsTxtObservationExpectation(current), {
					status: response.status, redirected, contentType, body: read.text, truncated: read.truncated, invalidEncoding: read.invalidEncoding,
				}),
			};
		} catch {
			next = { ...OBSERVATION_IDLE, status: "done", checkedAt: new Date(), result: { status: "not-observed", reason: timedOut ? "timeout" : "network" } };
		} finally {
			clearTimeout(timer);
			if (observeController.current === controller) observeController.current = null;
		}
		// A write, a newer check or unmounting since this one started makes its result stale.
		if (token === observeToken.current) setObservation(next);
	}, []);

	const invalidateObservation = React.useCallback(() => {
		observeToken.current += 1;
		observeController.current?.abort();
		observeController.current = null;
		setObservation({ ...OBSERVATION_IDLE, status: "stale" });
	}, []);

	React.useEffect(() => () => {
		observeToken.current += 1;
		observeController.current?.abort();
	}, []);

	const applyState = React.useCallback((next: SeoAdminLlmsTxt, mode: "new-basis" | "keep-draft") => {
		setLoad({ status: "ready", state: next, loadedAt: new Date() });
		const basis = next.state === "absent" || next.state === "stored" ? llmsTxtDraftFrom(llmsTxtStoredText(next)) : null;
		if (mode === "new-basis") {
			setDraft(basis);
			setLineEndsAccepted(false);
		} else {
			setDraft((current) => current ?? basis);
		}
	}, []);

	const reload = React.useCallback(async () => {
		if (writing.current) return;
		setBusy("reload");
		const result = await port.read();
		setBusy(null);
		if (!result.ok) {
			if (load.status !== "ready") setLoad({ status: "failed", problem: llmsTxtReadProblem(result.failure), failure: result.failure });
			else setOutcome({ status: "reload-failed", problem: llmsTxtReadProblem(result.failure) });
			return;
		}
		applyState(result.value, "keep-draft");
		if (!llmsTxtAuthoritative(result.value)) {
			// No record was read, so an uncertain write or a conflict stays open.
			setOutcome({ status: "still-unavailable" });
			return;
		}
		if (uncertain) {
			setOutcome({ status: "uncertain", failure: uncertain.failure, reload: { ok: true, state: result.value, outcome: llmsTxtUncertainOutcome(uncertain.operation, result.value) } });
		} else setOutcome(null);
		setUncertain(null);
		setReloadRequired(false);
	}, [applyState, load.status, uncertain]);

	React.useEffect(() => {
		let active = true;
		void port.read().then((result) => {
			if (!active) return;
			if (!result.ok) setLoad({ status: "failed", problem: llmsTxtReadProblem(result.failure), failure: result.failure });
			else applyState(result.value, "new-basis");
		});
		return () => {
			active = false;
		};
	}, [applyState]);

	const flags = { state, uncertain: uncertain !== null, reloadRequired, busy: busy !== null };

	// One observation per loaded state: on load, after a settled write and on demand.
	const observedFor = React.useRef<SeoAdminLlmsTxt | null>(null);
	React.useEffect(() => {
		if (!state || observedFor.current === state || !llmsTxtObservationAllowed(flags)) return;
		observedFor.current = state;
		void observe(state);
	});

	const stored = llmsTxtStoredText(state);
	const currentDraft = draft ?? llmsTxtDraftFrom(stored);
	const text = llmsTxtDraftText(currentDraft);
	const dirty = state !== null && draft !== null && llmsTxtDraftDirty(draft, stored);
	useWorkspaceDraftHold("llms-document", dirty || busy !== null || uncertain !== null || reloadRequired);
	const pageActive = useWorkspacePageActive();
	React.useEffect(() => {
		if (!pageActive) setResetOpen(false);
	}, [pageActive]);
	const saveBlockers = draft ? llmsTxtSaveBlockers({ ...flags, draft, lineEndsAccepted }) : ["loading" as const];
	const editable = draft !== null && llmsTxtEditable(flags);
	const nextEnabled = !(state?.enabled ?? false);
	const outputBlockers = llmsTxtOutputBlockers({ ...flags, draft: currentDraft, enabled: nextEnabled });
	const resetBlockers = llmsTxtResetBlockers({ ...flags, copySaved });
	const observationAllowed = llmsTxtObservationAllowed(flags);

	async function write(operation: LlmsTxtOperation, kind: "save" | "output" | "reset") {
		if (writing.current) return;
		writing.current = true;
		invalidateObservation();
		setBusy(kind);
		setOutcome(null);
		const result = await runLlmsTxtWrite(port, operation);
		writing.current = false;
		setBusy(null);
		setOutcome(result);
		setResetOpen(false);
		setCopySaved(false);
		if (result.status === "stored") {
			// A reset deletes only the invalid record; a draft the editor already holds is kept.
			applyState(result.state, kind === "save" ? "new-basis" : "keep-draft");
			if (result.changed) {
				toasts.success(
					kind === "save" ? "llms.txt saved" : kind === "reset" ? "Invalid record reset" : result.state.enabled ? "Output setting turned on" : "Output setting turned off",
					"This is the saved state. The public check on this page shows what is actually served; caches can keep an earlier copy for up to 5 minutes.",
				);
			}
		} else if (result.status === "refused" && (result.reason === "conflict" || result.reason === "unavailable")) {
			setReloadRequired(true);
		} else if (result.status === "uncertain") {
			if (result.reload.ok) applyState(result.reload.state, "keep-draft");
			else setUncertain({ operation, failure: result.failure });
		}
	}

	function save() {
		if (!state || !draft || saveBlockers.length) return;
		void write({ kind: "save", base: state, text: llmsTxtDraftText(draft) }, "save");
	}

	function toggleOutput() {
		if (!state || state.revision === null || outputBlockers.length) return;
		void write({ kind: "output", base: { ...state, revision: state.revision }, enabled: nextEnabled }, "output");
	}

	function reset() {
		if (!state || state.revision === null || resetBlockers.length) return;
		void write({ kind: "reset", base: { ...state, revision: state.revision } }, "reset");
	}

	function discardDraft() {
		if (!state || busy || !llmsTxtAuthoritative(state) || state.state === "corrupt") return;
		setDraft(llmsTxtDraftFrom(stored));
		setLineEndsAccepted(false);
	}

	if (load.status === "loading") return <p className="shipit-seo-muted" role="status">Loading the stored llms.txt</p>;
	if (load.status === "failed") {
		const problem = READ_PROBLEMS[load.problem];
		return (
			<section className="shipit-seo-panel shipit-seo-llms-panel" aria-labelledby="seo-llms-title">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Indexing</span>
						<h2 id="seo-llms-title">llms.txt</h2>
					</div>
				</div>
				<Banner variant="error" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />} title={problem.title}
					description={`${problem.description} (${failureCode(load.failure)})`}
					action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={busy === "reload"} onClick={() => void reload()}>Try again</Button>} />
			</section>
		);
	}

	const current = load.state;
	const bytes = llmsTxtUtf8Bytes(text);
	const documentCheck = checkLlmsTxtDocument(text);
	const activation = checkLlmsTxtActivation(text);
	const observed = observationText(observation, `${origin}${LLMS_TXT_PATH}`);
	const lineEnds = llmsTxtLineEnds(currentDraft.basis);
	const consentNeeded = llmsTxtLineEndConsentNeeded(currentDraft);
	const statusLine = busy === "save"
		? "Saving."
		: uncertain
			? "The outcome of the last change is unknown until the stored document is reloaded."
			: dirty
				? "Unsaved changes. The stored document stays as it is until you save."
				: current.state === "absent"
					? "No document saved yet. The output setting is off."
					: `Stored state loaded ${readableTime(load.loadedAt)}.`;
	const notices = saveBlockers.filter((item) => BLOCKER_TEXT[item]);
	const preview = dirty ? text : stored;
	const shipitServes = current.owner === "shipit" && current.state === "stored" && current.enabled;

	return (
		<div className="shipit-seo-llms-page">
			<div className="shipit-seo-llms-layout">
				<div className="shipit-seo-llms-main">
					<section className="shipit-seo-panel shipit-seo-llms-panel" aria-labelledby="seo-llms-title">
						<div className="shipit-seo-section-heading">
							<div>
								<span className="shipit-seo-eyebrow">Indexing</span>
								<h2 id="seo-llms-title">llms.txt</h2>
							</div>
							<div className="shipit-seo-llms-header-actions">
								<Badge variant="secondary">{`Owner: ${OWNER_LABELS[current.owner]}`}</Badge>
								<Switch
									label={current.enabled ? "Output on (saved setting)" : "Output off (saved setting)"}
									data-seo-setting="llmsOutput"
									aria-describedby="seo-llms-output-help"
									checked={current.enabled}
									controlFirst={false}
									disabled={outputBlockers.length > 0}
									onCheckedChange={() => toggleOutput()}
								/>
							</div>
						</div>
						<div className="shipit-seo-llms-output-help" id="seo-llms-output-help">
							<p>Applies immediately. Text changes need Save.</p>
							{outputBlockers.includes("unsaved") ? <p>Save or discard the draft before changing output.</p> : null}
							{outputBlockers.includes("no-document") ? <p>Save a document before turning output on.</p> : null}
							{outputBlockers.includes("activation") ? <p>Output needs an H1 as the first non-blank line.</p> : null}
						</div>
						<p className="shipit-seo-llms-copy">
							Write a short Markdown overview of this site for tools that read /llms.txt: an H1 with the site name,
							then any summary and lists of links you choose. The file is optional. It does not control crawling,
							search engines do not require it, and it does not guarantee that any AI service reads, cites or ranks the site.
						</p>

						{current.owner !== "shipit" ? (
							<Banner variant="alert" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="Text saved here would not change /llms.txt" description={ownerExplanation(current.owner, current.ownerDetail)} />
						) : null}
						{!current.conditionalStorage ? (
							<Banner variant="alert" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="This host cannot save with a revision check" description="Saving and output changes are off." />
						) : null}
						{current.state === "unavailable" ? (
							<Banner variant="error" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="The stored llms.txt could not be read"
								description={`Nothing is shown in its place and nothing can be saved over it.${current.owner === "shipit" ? " The origin answers 503 for /llms.txt while it stays unreadable." : ""} Your text on this page is kept. See Operator recovery below.`}
								action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={busy === "reload"} disabled={busy !== null} onClick={() => void reload()}>Reload</Button>} />
						) : null}
						{current.state === "corrupt" && current.corrupt ? (
							<Banner variant="error" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="The stored llms.txt record is invalid"
								description={`${current.corrupt.detail}${current.owner === "shipit" ? " The origin answers 503 for /llms.txt until it is reset." : ""} ${current.corrupt.copy === null ? "The value is too large to offer as a copy here; see Operator recovery below." : "Download a copy, then reset it."}`}
								action={current.corrupt.copy !== null ? (
									<Button size="sm" variant="secondary"
										disabled={llmsTxtResetBlockers({ ...flags, copySaved: true }).length > 0}
										onClick={() => { setCopySaved(false); setResetOpen(true); }}>Review and reset</Button>
								) : undefined} />
						) : null}
						{lineEnds.cr + lineEnds.crlf > 0 ? (
							<Banner variant="alert" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="The text you started from uses CR or CRLF line ends"
								description="They are kept while you do not edit the text. The text box works with LF line ends, so saving an edit stores LF line ends."
								action={consentNeeded ? <Checkbox label="Save with LF line ends" checked={lineEndsAccepted} disabled={!editable} onCheckedChange={(value) => setLineEndsAccepted(value === true)} /> : undefined} />
						) : null}
						{llmsTxtStartsWithBom(preview) ? (
							<p className="shipit-seo-llms-note">The text starts with a byte order mark (U+FEFF). It is kept as the first three bytes; the H1 check skips it.</p>
						) : null}
						<WriteOutcome outcome={outcome} busy={busy} onReload={() => void reload()} />

						<Textarea
							label="Markdown text"
							data-seo-setting="llmsText"
							description="Saved exactly as entered. This plugin adds nothing and does not rewrite it."
							rows={14}
							spellCheck={false}
							autoCapitalize="off"
							autoCorrect="off"
							className="shipit-seo-llms-editor"
							readOnly={!editable}
							value={currentDraft.editorValue}
							error={!documentCheck.ok ? problemText(documentCheck.problem) : undefined}
							onChange={(event) => {
								const editorValue = event.target.value;
								setDraft((previous) => (previous ? { ...previous, editorValue } : previous));
							}}
						/>
						<p className="shipit-seo-llms-count" aria-live="polite">
							{bytes.toLocaleString("en")} of {LLMS_TXT_DOCUMENT_MAX_BYTES.toLocaleString("en")} UTF-8 bytes.
							{" "}{activation.ok ? `H1 found on line ${activation.line}: ${activation.heading}` : `No H1 for output yet: ${problemText(activation.problem)}`}
						</p>
						<div className="shipit-seo-llms-actions">
							<p className="shipit-seo-llms-copy" role="status">{statusLine}</p>
							<div className="shipit-seo-llms-buttons">
								{dirty ? <Button type="button" variant="secondary" disabled={busy !== null} onClick={discardDraft}>Discard changes</Button> : null}
								<Button type="button" variant="primary" loading={busy === "save"} disabled={saveBlockers.length > 0} onClick={save}>Save</Button>
							</div>
						</div>
						{notices.length ? <ul className="shipit-seo-llms-notes">{notices.map((item) => <li key={item}>{BLOCKER_TEXT[item]}</li>)}</ul> : null}
					</section>

					<section className="shipit-seo-panel shipit-seo-llms-panel" aria-labelledby="seo-llms-preview-title">
						<div className="shipit-seo-section-heading">
							<div>
								<span className="shipit-seo-eyebrow">{dirty ? "Unsaved draft" : current.state === "stored" ? "Stored text" : "No stored text"}</span>
								<h2 id="seo-llms-preview-title">Exact text</h2>
							</div>
							<Checkbox label="Show spaces and line ends" checked={showWhitespace} onCheckedChange={(value) => setShowWhitespace(value === true)} />
						</div>
						<p className="shipit-seo-llms-copy">
							{dirty ? "The bytes a save would store." : "The stored bytes."}
							{" "}{shipitServes && !dirty ? "With this plugin as owner and output on, the origin is expected to answer with these bytes." : ""}
							{" "}Only the public check shows what is actually served. Markdown is shown as plain text, not rendered.
						</p>
						{preview ? <ExactText text={preview} showWhitespace={showWhitespace} labelledBy="seo-llms-preview-title" /> : <p className="shipit-seo-muted">Empty.</p>}
					</section>

					<details className="shipit-seo-panel shipit-seo-llms-help">
						<summary>How the file is published and recovered</summary>
						<div className="shipit-seo-llms-help-body">
							<p>This plugin answers /llms.txt only when the build found no page, public file, integration, route or redirect for it, at the root path without Astro i18n. That decision is recorded when the site starts or builds; restart after adding or removing such a file or route.</p>
							<p>The text and the output setting are one record with one revision. Every change checks that revision, so a save from another tab is never overwritten silently. Turning output off keeps the document.</p>
							<p>Operator recovery: if the record cannot be read at all, EmDash cannot return it to this editor. With the site stopped, back up the database, then inspect the options row named plugin:shipit-seo:configuration:llms-txt:v1. Repair it to valid JSON with exactly the fields version (1), enabled and text, or delete that one row; then start the site and save again here.</p>
						</div>
					</details>
				</div>

				<aside className="shipit-seo-panel shipit-seo-llms-status" aria-labelledby="seo-llms-status-title">
					<span className="shipit-seo-module-icon"><Article size={20} aria-hidden="true" /></span>
					<h2 id="seo-llms-status-title">Public file</h2>
					<p className="shipit-seo-llms-copy">
						{origin ? <>On this host the file is at <a href={`${origin}${LLMS_TXT_PATH}`} target="_blank" rel="noopener noreferrer">{`${origin}${LLMS_TXT_PATH}`}<span className="sr-only"> (opens in a new tab)</span></a>.</> : `The file is at ${LLMS_TXT_PATH}.`}
						{" "}The output switch is the saved setting; whether the file is actually served is shown by the check below.
					</p>
					<dl className="shipit-seo-details">
						<div><dt>Owner of /llms.txt</dt><dd>{`${OWNER_LABELS[current.owner]}${current.ownerDetail ? ` (${current.ownerDetail})` : ""}`}</dd></div>
						<div><dt>Stored document</dt><dd>{storedSummary(current)}</dd></div>
						<div><dt>Output setting</dt><dd>{outputSetting(current)}</dd></div>
						<div><dt>Expected origin answer</dt><dd>{expectedAnswerText(current)}</dd></div>
						<div>
							<dt>Observed here</dt>
							<dd><Badge variant={observed.tone === "success" ? "success" : observed.tone === "error" ? "error" : "secondary"}>{observed.label}</Badge></dd>
						</div>
						<div><dt>Checked</dt><dd>{observation.status === "stale" ? "Cleared" : readableTime(observation.checkedAt)}{observation.status === "done" && observation.httpStatus ? `, status ${observation.httpStatus}` : ""}</dd></div>
						<div><dt>Cache-Control</dt><dd>{observation.status === "done" && observation.httpStatus ? observation.cacheControl ?? "None sent" : "Not observed"}</dd></div>
					</dl>
					{observed.detail ? <p className="shipit-seo-llms-copy" role="status">{observed.detail}</p> : null}
					<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={observation.status === "checking"} disabled={!observationAllowed}
						onClick={() => { if (observationAllowed) void observe(current); }}>Check again</Button>
					{observation.status === "done" && observation.body && observation.result && observation.result.status !== "matches" && observation.result.status !== "expected-status" ? (
						<details className="shipit-seo-llms-observed">
							<summary>Observed response</summary>
							<pre className="shipit-seo-llms-body" tabIndex={0}>{observation.body}</pre>
						</details>
					) : null}
					<p className="shipit-seo-llms-note">
						This check reads {origin}{LLMS_TXT_PATH} once from this browser, without cookies. A stored setting is not a
						verified public response. Files served by this plugin carry {current.cacheControl}, so browsers, CDNs and
						crawlers can keep an earlier copy for up to 5 minutes after a change. Other public addresses of the site were not checked.
					</p>
				</aside>
			</div>

			<Dialog.Root role="alertdialog" open={pageActive && resetOpen} onOpenChange={setResetOpen}>
				<Dialog size="sm" className="shipit-seo-delete-dialog">
					<Dialog.Title>Reset the invalid llms.txt record?</Dialog.Title>
					<Dialog.Description>
						The record is deleted only if it is still the one loaded here. Afterwards no document is stored and output
						is off. First download its copy: the stored value as EmDash returns it, written out again as JSON. Its
						formatting can differ from the database text, so it is a recovery copy, not a byte-identical backup.
					</Dialog.Description>
					<div className="shipit-seo-dialog-actions">
						<Button type="button" variant="secondary" icon={DownloadSimple} disabled={busy !== null || !current.corrupt?.copy}
							onClick={() => { if (current.corrupt?.copy) { downloadCopy(current.corrupt.copy, current.revision); setCopySaved(true); } }}>
							Download copy
						</Button>
						<Button type="button" variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button>
						<Button type="button" variant="destructive" loading={busy === "reset"} disabled={resetBlockers.length > 0} onClick={reset}>Reset record</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}

function WriteOutcome({ outcome, busy, onReload }: {
	outcome: Outcome | null;
	busy: string | null;
	onReload: () => void;
}) {
	if (!outcome) return null;
	const icon = <WarningCircle size={20} weight="fill" aria-hidden="true" />;
	const reloadButton = <Button size="sm" variant="secondary" icon={ArrowClockwise} loading={busy === "reload"} onClick={onReload}>Reload stored document</Button>;
	switch (outcome.status) {
		case "stored":
			return null;
		case "refused":
			if (outcome.reason === "conflict") {
				return <Banner variant="alert" icon={icon} title="The stored llms.txt changed after you loaded it"
					description="Nothing was saved. Reload the stored document; your text stays in the editor so you can compare and save again." action={reloadButton} />;
			}
			if (outcome.reason === "unavailable") {
				return <Banner variant="error" icon={icon} title="Nothing was changed" description={outcome.message} action={reloadButton} />;
			}
			return <Banner variant="error" icon={icon} title={outcome.reason === "invalid" ? "The change was refused" : "Changes are off"} description={`${outcome.message} Nothing was saved; your text is kept.`} />;
		case "rejected": {
			const titles = {
				unauthorized: "Your session has ended",
				denied: "Your role cannot manage plugins",
				"too-large": "The request is too large",
				"invalid-request": "EmDash rejected the request",
				"not-found": "The llms.txt route is not available",
				refused: "EmDash refused the request",
			} as const;
			return <Banner variant="error" icon={icon} title={titles[outcome.problem]}
				description={`Nothing was saved; your text is kept on this page (${failureCode(outcome.failure)}).${outcome.problem === "unauthorized" ? " Sign in again in another tab, then save." : ""}`} />;
		}
		case "not-sent":
			return <Banner variant="error" icon={icon} title="The request would be too large"
				description={`It would need ${outcome.bytes.toLocaleString("en")} bytes, above EmDash's 1,048,576-byte limit for this route. Nothing was sent.`} />;
		case "uncertain":
			if (!outcome.reload.ok) {
				return <Banner variant="error" icon={icon} title="The change may or may not have been applied"
					description={`The response was lost (${failureCode(outcome.failure)}) and the reload ${outcome.reload.problem === "record-unavailable" ? "could not read the record" : "failed too"}. Changes and the public check stay off until a reload reads the record; your text is kept. Nothing was retried.`} action={reloadButton} />;
			}
			return outcome.reload.outcome === "sent-value"
				? <Banner variant="alert" icon={icon} title="The response was lost; the stored record now holds your change" description="A reload after the lost response shows your change as the stored state. Nothing was retried." />
				: outcome.reload.outcome === "previous-value"
					? <Banner variant="alert" icon={icon} title="The response was lost; the stored record is unchanged" description="The revision is the one you started from. Your text is kept; you can save again." />
					: <Banner variant="alert" icon={icon} title="The response was lost; the stored record holds another change" description="Another save happened. Your text is kept; review the stored text before saving again." />;
		case "reload-failed":
			return <Banner variant="error" icon={icon} title="The stored document could not be reloaded" description="Your text is kept. Try again." action={reloadButton} />;
		case "still-unavailable":
			return <Banner variant="error" icon={icon} title="The record still could not be read"
				description="The reload answered, but without the record, so nothing is settled. Changes stay off; your text is kept." action={reloadButton} />;
		default:
			return null;
	}
}
