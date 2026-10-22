import * as React from "react";
import { ApiResponseError, fetchSettings, updateSettings, useCurrentUser } from "@emdash-cms/admin";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Textarea } from "@cloudflare/kumo/components/input";
import { useQuery } from "@tanstack/react-query";
import { ArrowClockwise, ArrowCounterClockwise, Robot, WarningCircle } from "@phosphor-icons/react";
import type { SeoAdminRobotsTxtFacts, SeoRobotsTxtOwner } from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	ROBOTS_TXT_CACHE_CONTROL,
	ROBOTS_TXT_MAX_CODE_POINTS,
	ROBOTS_TXT_PATH,
	robotsTxtCodePoints,
	type RobotsObservationResult,
	type RobotsSitemapOriginSource,
} from "../robots-txt.ts";
import { fetchSeoAdminRobotsTxtFacts } from "./api.ts";
import {
	ROBOTS_OBSERVATION_MAX_BYTES,
	loadRobotsSettings,
	readRobotsObservationBody,
	robotsDraftChanged,
	robotsEditable,
	robotsEditorText,
	robotsHasCarriageReturns,
	robotsObservation,
	robotsRoleHints,
	robotsServedPreview,
	robotsSettingsUpdate,
	robotsStoredPreview,
	robotsUncertainOutcome,
	robotsWriteAllowed,
	robotsWriteBlockers,
	saveRobotsText,
	type RobotsPortResult,
	type RobotsReadProblem,
	type RobotsRequestFailure,
	type RobotsSaveResult,
	type RobotsServedPreview,
	type RobotsSettingsPort,
	type RobotsSettingsSnapshot,
	type RobotsStoredText,
	type RobotsWriteBlocker,
} from "./robots-txt-model.ts";
import { seoWorkspaceKeys } from "./workspace-model.ts";
import { useSeoToasts, useWorkspaceDraftHold, useWorkspacePageActive } from "./workspace-shell.tsx";
import { SettingsActionBar } from "./settings-action-bar.tsx";

const EMDASH_SEO_SETTINGS_URL = "/_emdash/admin/settings/seo";

const OBSERVATION_TIMEOUT_MS = 10_000;

async function settingsCall(run: () => Promise<unknown>): Promise<RobotsPortResult> {
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

// EmDash's own settings endpoint through the admin package's helpers.
const settingsPort: RobotsSettingsPort = {
	read: () => settingsCall(() => fetchSettings()),
	write: (text) => settingsCall(() => updateSettings(robotsSettingsUpdate(text))),
};

const OWNER_LABELS: Record<SeoRobotsTxtOwner, string> = {
	"emdash-core": "EmDash core",
	unsettled: "Not confirmed",
	unknown: "Not confirmed",
	"site-route": "Site route",
	"static-file": "Static file",
	integration: "Another integration",
	"competing-route": "Another route",
	"unsupported-routing": "Base path",
	"unsupported-host": "Unverified EmDash version",
	"not-served": "No route",
	"not-installed": "Not recorded",
};

function ownerExplanation(owner: SeoRobotsTxtOwner, detail: string | null): string {
	switch (owner) {
		case "unsettled":
			return "The build did not record which route answers /robots.txt. Restart or rebuild the site; saving stays off until EmDash's route is confirmed.";
		case "unknown":
			return `The site's robots.txt files could not be inspected${detail ? ` (${detail})` : ""}. Saving stays off. Restore access to the files, then restart or rebuild the site to check ownership again.`;
		case "site-route":
			return `The site's own route${detail ? ` (${detail})` : ""} answers /robots.txt. Edit that file; text saved here would not be served.`;
		case "static-file":
			return `The site publishes ${detail ?? "a static robots.txt"}, which is served before EmDash's route. Edit or remove that file; text saved here would not be served.`;
		case "integration":
			return `${detail ?? "Another integration"} can write or serve robots.txt for this site. Change its configuration; text saved here may not be served.`;
		case "competing-route":
			return `${detail ?? "Another route answers /robots.txt"}. Remove the extra route; text saved here may not be served.`;
		case "unsupported-routing":
			return `This site is mounted under a base path${detail ? ` (${detail})` : ""}. Crawlers read robots.txt only at the root of a host, which EmDash's route does not serve here.`;
		case "unsupported-host":
			return `This editor supports EmDash 1.1.0, 1.2.0, 1.3.0 and 1.3.1${detail ? `; this site runs ${detail}` : ""}. Edit robots.txt in EmDash's settings.`;
		case "not-served":
			return "No route answers /robots.txt on this build, so saved text would not be served.";
		case "not-installed":
			return "Install the plugin through its Astro integration so the build records who serves /robots.txt. Until then saving is off.";
		default:
			return "";
	}
}

const READ_PROBLEMS: Record<RobotsReadProblem, { title: string; description: string }> = {
	unauthorized: { title: "Your session has ended", description: "Sign in again, then reload this view." },
	"read-denied": { title: "Your role cannot read site settings", description: "EmDash refused to show its site settings, so the robots.txt text is not shown." },
	refused: { title: "EmDash refused the request", description: "The settings request was refused. Nothing is shown in place of the stored text." },
	service: { title: "EmDash could not read its site settings", description: "Nothing is shown in place of the stored text. Try again." },
	malformed: { title: "EmDash returned settings this editor cannot read", description: "Nothing is shown in place of the stored text." },
	network: { title: "The settings request did not complete", description: "Check the connection and try again. Nothing is shown in place of the stored text." },
};

const BLOCKER_TEXT: Partial<Record<RobotsWriteBlocker, string>> = {
	"ownership-pending": "Checking who serves /robots.txt.",
	"ownership-unknown": "Who serves /robots.txt could not be confirmed, so saving is off.",
	"not-core": "EmDash core does not serve /robots.txt on this site, so saving is off.",
	role: "Your role can read but not change site settings. Saving needs an Administrator.",
	"role-unknown": "Your role is not confirmed yet, so saving is off. Reload if this stays.",
	"seo-malformed": "EmDash's stored SEO settings are not an object, and a save would merge into them. Saving is off.",
	"line-ends": "Confirm the line-end change above to save.",
	uncertain: "Reload the stored text before saving again.",
	"too-long": `robots.txt text is limited to ${ROBOTS_TXT_MAX_CODE_POINTS.toLocaleString("en")} characters.`,
};

const ORIGIN_NOTES: Record<RobotsSitemapOriginSource, string> = {
	"site-settings": "from the Site URL in EmDash's settings, used exactly as saved without one trailing slash",
	"emdash-config": "from the siteUrl option in EmDash's Astro configuration",
	environment: "from EMDASH_SITE_URL or SITE_URL as this server process reads it now; EmDash keeps the value it read first, so restart the server after changing it",
	request: "from the address of each request, because no site URL is configured; behind a proxy this can be an internal address. Set the Site URL in EmDash's settings to fix it",
};

function readableTime(date: Date | null): string {
	return date ? date.toLocaleString("en", { dateStyle: "medium", timeStyle: "medium" }) : "Not yet";
}

function failureCode(failure: RobotsRequestFailure): string {
	if (failure.type === "response") return `${failure.status} ${failure.code}: ${failure.message}`;
	return failure.type === "malformed" ? failure.detail : failure.message;
}

function storedSummary(snapshot: RobotsSettingsSnapshot): string {
	const stored = snapshot.stored;
	if (stored.kind === "unset") return "Not set: EmDash's default is served";
	if (stored.kind === "invalid") return `Not text (${stored.type}): EmDash serves its ${stored.served === "default" ? "default" : "permissive fallback"}`;
	if (!stored.text) return "Empty: EmDash's default is served";
	return `Custom, ${robotsTxtCodePoints(stored.text).toLocaleString("en")} characters`;
}

interface Observation {
	status: "idle" | "checking" | "done";
	checkedAt: Date | null;
	result: RobotsObservationResult | null;
	httpStatus: number | null;
	cacheControl: string | null;
	body: string | null;
	truncated: boolean;
}

const OBSERVATION_IDLE: Observation = { status: "idle", checkedAt: null, result: null, httpStatus: null, cacheControl: null, body: null, truncated: false };

function observationText(observation: Observation, origin: string): { label: string; tone: "success" | "secondary" | "error"; detail: string } {
	const result = observation.result;
	if (observation.status === "checking") return { label: "Checking", tone: "secondary", detail: "Reading the public file once." };
	if (!result) return { label: "Not checked", tone: "secondary", detail: "" };
	switch (result.status) {
		case "matches":
			return { label: "Matches stored text", tone: "success", detail: `The file at ${origin}${ROBOTS_TXT_PATH} is exactly the body EmDash builds from the stored text.` };
		case "other-origin":
			return {
				label: "Different Sitemap address",
				tone: "secondary",
				detail: `The text matches, but the Sitemap line uses ${result.observedOrigin}. EmDash took that address from the request or from the environment it read when the server started; this is not a confirmed match.`,
			};
		case "fallback":
			return { label: "Permissive fallback", tone: "error", detail: "EmDash served its fallback (allow everything, no Sitemap line, no cache header), which means it could not use its settings. This is not the stored configuration." };
		case "different":
			return { label: "Different file", tone: "error", detail: "Another owner, a middleware or a cache answered with other text. Compare it below." };
		default:
			return {
				label: "Not observed",
				tone: "error",
				detail: result.reason === "redirect" ? "The address answered with a redirect, which this check does not follow." :
					result.reason === "status" ? `The address answered with status ${observation.httpStatus ?? "unknown"}.` :
					result.reason === "too-large" ? `The file is larger than ${ROBOTS_OBSERVATION_MAX_BYTES.toLocaleString("en")} bytes, so it was not read to the end and is not verified.` :
					result.reason === "timeout" ? `The address did not answer within ${OBSERVATION_TIMEOUT_MS / 1000} seconds.` : "The request did not complete.",
			};
	}
}

/** The exact body, with core's added lines marked and optional visible whitespace. */
function EffectiveBody({ preview, showWhitespace, labelledBy }: { preview: RobotsServedPreview; showWhitespace: boolean; labelledBy: string }) {
	const parts = preview.kind === "fallback"
		? [{ text: preview.body, added: true }]
		: preview.file.kind === "default"
			? [{ text: preview.file.body, added: false }]
			: [{ text: preview.file.stored, added: false }, { text: preview.file.added, added: true }];
	const render = (text: string, key: string) => {
		if (!showWhitespace) return text;
		return text.split(/(\r\n|\n|\r|[ \t]+)/).map((piece, index) => {
			if (piece === "\n" || piece === "\r\n" || piece === "\r") {
				const label = piece === "\n" ? "LF" : piece === "\r\n" ? "CRLF" : "CR";
				return <React.Fragment key={`${key}-${index}`}><span className="shipit-seo-robots-eol" aria-hidden="true">{label}</span>{"\n"}</React.Fragment>;
			}
			if (/^[ \t]+$/.test(piece)) return <span key={`${key}-${index}`} className="shipit-seo-robots-space" title={piece.includes("\t") ? "Tab or spaces" : "Spaces"}>{piece}</span>;
			return piece;
		});
	};
	return (
		<pre className="shipit-seo-robots-body" tabIndex={0} aria-labelledby={labelledBy}>
			{parts.filter((part) => part.text).map((part, index) => part.added
				? <mark key={index} className="shipit-seo-robots-added">{render(part.text, `p${index}`)}</mark>
				: <React.Fragment key={index}>{render(part.text, `p${index}`)}</React.Fragment>)}
		</pre>
	);
}

function previewSummary(preview: RobotsServedPreview): string {
	if (preview.kind === "fallback") {
		return preview.reason === "site-url-invalid"
			? "EmDash cannot read its stored Site URL, so /robots.txt serves the permissive fallback whatever text is stored."
			: "The stored value is not text, so EmDash serves its permissive fallback.";
	}
	if (preview.file.disallowAiTraining) {
		if (preview.file.kind === "default") return "EmDash's default with its admin exclusion, AI training crawler rules and Sitemap line.";
		return preview.file.kind === "custom-with-ai-training"
			? "Your text with trailing whitespace removed, then the AI training rules from EmDash's Site settings (marked). The existing Sitemap text is kept."
			: "Your text with trailing whitespace removed, then the AI training rules and Sitemap line EmDash adds (marked).";
	}
	switch (preview.file.kind) {
		case "default":
			return "EmDash's default: allow every path except its admin and API routes, then the Sitemap line.";
		case "custom-verbatim":
			return "Served exactly as written, because the text contains \"sitemap:\" (in any letter case, also inside a comment). EmDash adds nothing.";
		default:
			return preview.file.stored.trim()
				? "Your text with trailing whitespace removed, then a blank line and the Sitemap line EmDash adds (marked)."
				: "The text has only whitespace, so it counts as custom: EmDash serves two blank lines and its Sitemap line, without the admin exclusion.";
	}
}

/**
 * Marks the host admin's cached site settings stale. EmDash's own settings
 * pages keep them without expiry and send every cached field when they save.
 */
export const RobotsHostSettingsContext = React.createContext<(() => void) | null>(null);

export function RobotsTxtView() {
	const onSettingsChanged = React.useContext(RobotsHostSettingsContext);
	const toasts = useSeoToasts();
	const user = useCurrentUser();
	const facts = useQuery({
		queryKey: seoWorkspaceKeys.robots,
		queryFn: () => fetchSeoAdminRobotsTxtFacts(),
		retry: false,
		staleTime: 0,
	});
	const [load, setLoad] = React.useState<
		| { status: "loading" }
		| { status: "failed"; problem: RobotsReadProblem; failure: RobotsRequestFailure }
		| { status: "ready"; snapshot: RobotsSettingsSnapshot; loadedAt: Date }
	>({ status: "loading" });
	const [draft, setDraft] = React.useState("");
	const [busy, setBusy] = React.useState<"save" | "restore" | "reload" | null>(null);
	// Set while a write's outcome is unknown and no reload has succeeded yet.
	const [uncertain, setUncertain] = React.useState<{ base: RobotsStoredText; sent: string; failure: RobotsRequestFailure } | null>(null);
	const [lineEndsAccepted, setLineEndsAccepted] = React.useState(false);
	const [outcome, setOutcome] = React.useState<RobotsSaveResult | { status: "reload-failed"; problem: RobotsReadProblem } | null>(null);
	const [restoreOpen, setRestoreOpen] = React.useState(false);
	const [showWhitespace, setShowWhitespace] = React.useState(false);
	const [observation, setObservation] = React.useState<Observation>(OBSERVATION_IDLE);
	const observeToken = React.useRef(0);
	const writing = React.useRef(false);

	const requestOrigin = typeof window === "undefined" ? "" : window.location.origin;
	const factsData: SeoAdminRobotsTxtFacts | undefined = facts.data;
	const origin = {
		configuredOrigin: factsData?.configuredOrigin ?? null,
		configuredOriginKnown: factsData?.configuredOriginKnown ?? false,
		requestOrigin,
		hostVersion: factsData?.hostVersion ?? null,
	};
	const snapshot = load.status === "ready" ? load.snapshot : null;
	const hints = robotsRoleHints(factsData?.hostVersion ?? null, { status: user.status, role: user.data?.role });

	const observe = React.useCallback(async (current: RobotsSettingsSnapshot) => {
		const token = ++observeToken.current;
		setObservation((previous) => ({ ...previous, status: "checking" }));
		const originNow = {
			configuredOrigin: facts.data?.configuredOrigin ?? null,
			configuredOriginKnown: facts.data?.configuredOriginKnown ?? false,
			requestOrigin: window.location.origin,
			hostVersion: facts.data?.hostVersion ?? null,
		};
		let next: Observation;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), OBSERVATION_TIMEOUT_MS);
		try {
			// Same origin, fixed path, no cookies and no browser cache: what an anonymous reader gets here.
			const response = await fetch(new URL(ROBOTS_TXT_PATH, window.location.origin), {
				cache: "no-store", credentials: "omit", redirect: "manual", signal: controller.signal,
			});
			const redirected = response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
			const read = redirected ? { text: "", bytes: 0, truncated: false } : await readRobotsObservationBody(response.body);
			next = {
				status: "done",
				checkedAt: new Date(),
				httpStatus: response.status,
				cacheControl: response.headers.get("cache-control"),
				body: read.text,
				truncated: read.truncated,
				result: robotsObservation(current, originNow, { status: response.status, redirected, body: read.text, truncated: read.truncated }),
			};
		} catch {
			next = {
				...OBSERVATION_IDLE,
				status: "done",
				checkedAt: new Date(),
				result: { status: "unavailable", reason: controller.signal.aborted ? "timeout" : "network" },
			};
		} finally {
			clearTimeout(timer);
		}
		if (token === observeToken.current) setObservation(next);
	}, [facts.data]);

	const applySnapshot = React.useCallback((next: RobotsSettingsSnapshot, mode: "replace-draft" | "keep-draft") => {
		setLoad({ status: "ready", snapshot: next, loadedAt: new Date() });
		if (mode === "replace-draft") setDraft(robotsEditorText(next.stored));
		setLineEndsAccepted(false);
	}, []);

	const reload = React.useCallback(async (mode: "replace-draft" | "keep-draft") => {
		setBusy("reload");
		const result = await loadRobotsSettings(settingsPort);
		setBusy(null);
		if (!result.ok) {
			if (load.status !== "ready") setLoad({ status: "failed", problem: result.problem, failure: result.failure });
			else setOutcome({ status: "reload-failed", problem: result.problem });
			return null;
		}
		if (uncertain) {
			const outcomeNow = robotsUncertainOutcome(result.snapshot.stored, uncertain.base, uncertain.sent);
			setOutcome({ status: "uncertain", failure: uncertain.failure, reload: { ok: true, snapshot: result.snapshot, outcome: outcomeNow } });
			void onSettingsChanged?.();
		}
		setUncertain(null);
		applySnapshot(result.snapshot, mode);
		return result.snapshot;
	}, [applySnapshot, load.status, uncertain, onSettingsChanged]);

	React.useEffect(() => {
		let active = true;
		void loadRobotsSettings(settingsPort).then((result) => {
			if (!active) return;
			if (!result.ok) setLoad({ status: "failed", problem: result.problem, failure: result.failure });
			else applySnapshot(result.snapshot, "replace-draft");
		});
		return () => {
			active = false;
		};
	}, [applySnapshot]);

	// One observation per confirmed stored state, after the ownership facts settle.
	const observedFor = React.useRef<{ snapshot: RobotsSettingsSnapshot; hostVersion: string | null } | null>(null);
	React.useEffect(() => {
		const hostVersion = factsData?.hostVersion ?? null;
		if (!snapshot || facts.isPending || (observedFor.current?.snapshot === snapshot && observedFor.current.hostVersion === hostVersion)) return;
		observedFor.current = { snapshot, hostVersion };
		void observe(snapshot);
	}, [snapshot, facts.isPending, factsData?.hostVersion, observe]);

	const factsState = facts.isPending
		? { status: "pending" as const }
		: facts.isError || !factsData ? { status: "error" as const } : { status: "ready" as const, owner: factsData.owner };
	const blockers = robotsWriteBlockers({ snapshot, facts: factsState, manage: hints.manage, uncertain: uncertain !== null, busy: busy !== null, draft, lineEndsAccepted });
	const canSave = blockers.save.length === 0;
	const canRestore = blockers.restore.length === 0;
	const editable = robotsEditable({ snapshot, facts: factsState, manage: hints.manage, uncertain: uncertain !== null, busy: busy !== null });
	const dirty = snapshot ? robotsDraftChanged(snapshot.stored, draft) : false;
	useWorkspaceDraftHold("robots-text", dirty || busy !== null || uncertain !== null);
	const pageActive = useWorkspacePageActive();
	React.useEffect(() => {
		if (!pageActive) setRestoreOpen(false);
	}, [pageActive]);
	const characters = robotsTxtCodePoints(draft);
	const tooLong = characters > ROBOTS_TXT_MAX_CODE_POINTS;

	async function write(text: string, kind: "save" | "restore") {
		// Eligibility from this render, checked at confirmation time.
		if (!snapshot || writing.current || !robotsWriteAllowed(kind, blockers)) return;
		writing.current = true;
		setBusy(kind);
		setOutcome(null);
		const result = await saveRobotsText(settingsPort, snapshot.stored, text);
		writing.current = false;
		setBusy(null);
		setRestoreOpen(false);
		setOutcome(result);
		if (result.status === "saved") {
			if (result.snapshot) applySnapshot(result.snapshot, result.replacedAfter ? "keep-draft" : "replace-draft");
			onSettingsChanged?.();
			if (!result.replacedAfter) {
				toasts.success(kind === "restore" ? "EmDash's default robots.txt restored" : "Robots.txt saved", "The next request for /robots.txt uses it. Caches can keep an older copy.");
			}
		} else if (result.status === "uncertain") {
			onSettingsChanged?.();
			if (result.reload.ok) applySnapshot(result.reload.snapshot, "keep-draft");
			else setUncertain({ base: snapshot.stored, sent: text, failure: result.failure });
		} else if (result.status === "rejected" && (result.problem === "save-denied" || result.problem === "unauthorized")) {
			// The cached role was only a hint; read it again after the endpoint refused.
			void user.refetch();
		} else if (result.status === "not-checked" && result.problem === "unauthorized") {
			void user.refetch();
		}
	}

	function resolveConflict(latest: RobotsSettingsSnapshot, keepDraft: boolean) {
		applySnapshot(latest, keepDraft ? "keep-draft" : "replace-draft");
		setOutcome(null);
	}

	if (load.status === "loading") {
		return <p className="shipit-seo-muted" role="status">Loading the stored robots.txt text</p>;
	}
	if (load.status === "failed") {
		const problem = READ_PROBLEMS[load.problem];
		return (
			<section className="shipit-seo-panel shipit-seo-robots-panel" aria-labelledby="seo-robots-title">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Crawling</span>
						<h2 id="seo-robots-title">Robots.txt</h2>
					</div>
				</div>
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={problem.title}
					description={`${problem.description} (${failureCode(load.failure)})`}
					action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={busy === "reload"} onClick={() => void reload("replace-draft")}>Try again</Button>}
				/>
			</section>
		);
	}

	const current = load.snapshot;
	const storedPreview = robotsStoredPreview(current, origin);
	const draftPreview = robotsServedPreview({ ...origin, siteUrl: current.siteUrl, text: draft, disallowAiTraining: current.disallowAiTraining });
	const shownPreview = dirty ? draftPreview : storedPreview;
	const expectedPublic = storedPreview.kind === "file" ? storedPreview.sitemapBase : null;
	let publicOrigin: string | null = null;
	try {
		publicOrigin = expectedPublic && expectedPublic.source !== "request" ? new URL(expectedPublic.base).origin : requestOrigin;
	} catch {
		publicOrigin = null;
	}
	const observed = observationText(observation, requestOrigin);
	const owner = factsData?.owner ?? null;
	const statusLine = uncertain
		? "The outcome of the last save is unknown until the stored text is reloaded."
		: dirty
			? "Unsaved changes. /robots.txt keeps serving the stored text until you save."
			: `Stored text loaded ${readableTime(load.loadedAt)}.`;
	const notices = blockers.save.filter((item) => item !== "unchanged" && item !== "busy" && BLOCKER_TEXT[item]);

	return (
		<div className="shipit-seo-robots-page">
			<div className="shipit-seo-robots-layout">
				<div className="shipit-seo-robots-main">
					<section className="shipit-seo-panel shipit-seo-robots-panel" aria-labelledby="seo-robots-title">
						<div className="shipit-seo-section-heading">
							<div>
								<span className="shipit-seo-eyebrow">Crawling</span>
								<h2 id="seo-robots-title">Robots.txt</h2>
							</div>
							<Badge variant={owner === "emdash-core" ? "success" : "secondary"}>
								{owner ? OWNER_LABELS[owner] : facts.isPending ? "Checking owner" : "Owner unknown"}
							</Badge>
						</div>
						<p className="shipit-seo-robots-copy">
							Edit the robots.txt text EmDash serves at /robots.txt. It asks crawlers not to fetch paths; it does not
							hide pages, remove them from search results or restrict access, and some crawlers ignore it. To keep a
							page out of search results, use noindex instead.
						</p>

						{owner && owner !== "emdash-core" ? (
							<Banner
								variant="alert"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="Text saved here would not change /robots.txt"
								description={ownerExplanation(owner, factsData?.ownerDetail ?? null)}
							/>
						) : null}
						{facts.isError ? (
							<Banner
								variant="alert"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="Who serves /robots.txt could not be confirmed"
								description={facts.error instanceof Error ? facts.error.message : "Saving stays off."}
								action={<Button size="sm" variant="secondary" icon={ArrowClockwise} onClick={() => void facts.refetch()}>Check again</Button>}
							/>
						) : null}
						{current.siteUrl.kind === "invalid" ? (
							<Banner variant="error" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="EmDash's stored Site URL is not text"
								description="EmDash cannot build robots.txt from it and serves its permissive fallback until the Site URL is saved again in EmDash's settings." />
						) : null}
						{current.stored.kind === "invalid" ? (
							<Banner variant="error" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="The stored robots.txt value is not text"
								description={current.seoMergeable
									? "It is not shown here. Saving text, or restoring the default, replaces it."
									: "EmDash's SEO settings are stored as something other than an object. Saving is off, because EmDash would merge the new text into them."} />
						) : null}
						{robotsHasCarriageReturns(current.stored) ? (
							<Banner variant="alert" icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="The stored text uses CR or CRLF line ends"
								description="EmDash serves them as stored and the effective file on this page shows that original. The editor works with LF line ends, so saving here stores LF line ends."
								action={<Checkbox label="Save with LF line ends" checked={lineEndsAccepted} disabled={!editable} onCheckedChange={(value) => setLineEndsAccepted(value === true)} />} />
						) : null}
						<SaveOutcome
							outcome={outcome}
							busy={busy}
							onReload={() => void reload("keep-draft")}
							onResolveConflict={resolveConflict}
						/>

						<Textarea
							label="robots.txt text"
							data-seo-setting="robotsText"
							description="Leave empty to use EmDash's default."
							rows={12}
							spellCheck={false}
							autoCapitalize="off"
							autoCorrect="off"
							className="shipit-seo-robots-editor"
							readOnly={!editable}
							value={draft}
							error={tooLong ? `This text has ${characters.toLocaleString("en")} characters; the limit is ${ROBOTS_TXT_MAX_CODE_POINTS.toLocaleString("en")}.` : undefined}
							onChange={(event) => setDraft(event.target.value)}
						/>
						<p className="shipit-seo-robots-count" id="seo-robots-count">
							{characters.toLocaleString("en")} of {ROBOTS_TXT_MAX_CODE_POINTS.toLocaleString("en")} characters. Characters are counted in the same way as EmDash.
						</p>
						<p className="shipit-seo-robots-note">
							EmDash Settings &gt; SEO edits the same robots.txt text; whichever save happens last is kept.{" "}
							<a href={EMDASH_SEO_SETTINGS_URL}>Open EmDash SEO settings</a>
						</p>

						<SettingsActionBar
							status={statusLine}
							restore={(
								<Button type="button" variant="secondary-destructive" icon={ArrowCounterClockwise} disabled={!canRestore} onClick={() => setRestoreOpen(true)}>
									Restore default
								</Button>
							)}
							discardDisabled={!dirty || !editable}
							onDiscard={() => setDraft(robotsEditorText(current.stored))}
							saveLabel="Save robots.txt"
							saveDisabled={!canSave}
							saving={busy === "save"}
							onSave={() => void write(draft, "save")}
						/>
						{notices.length ? (
							<ul className="shipit-seo-robots-notes">
								{notices.map((item) => <li key={item}>{BLOCKER_TEXT[item]}</li>)}
							</ul>
						) : null}
					</section>

					<section className="shipit-seo-panel shipit-seo-robots-panel" aria-labelledby="seo-robots-preview-title">
						<div className="shipit-seo-section-heading">
							<div>
								<span className="shipit-seo-eyebrow">{dirty ? "Unsaved draft" : "Stored text"}</span>
								<h2 id="seo-robots-preview-title">Effective file</h2>
							</div>
							<Checkbox label="Show spaces and line ends" checked={showWhitespace} onCheckedChange={(value) => setShowWhitespace(value === true)} />
						</div>
						<p className="shipit-seo-robots-copy">{previewSummary(shownPreview)}</p>
						<EffectiveBody preview={shownPreview} showWhitespace={showWhitespace} labelledBy="seo-robots-preview-title" />
						{shownPreview.kind === "file" && (shownPreview.file.kind === "default" || shownPreview.file.kind === "custom-with-sitemap") ? (
							<p className="shipit-seo-robots-note">
								Sitemap address {shownPreview.sitemapBase.base}/sitemap.xml, {ORIGIN_NOTES[shownPreview.sitemapBase.source]}.
								{shownPreview.originKnown ? "" : " The build recorded no EmDash site address, so a configured one may replace it."}
							</p>
						) : null}
						{shownPreview.kind === "file" && shownPreview.file.disallowAiTraining ? (
							<p className="shipit-seo-robots-note">
								AI training rules come from EmDash's Site settings. Saving text or restoring the default here keeps that setting.
							</p>
						) : null}
						<p className="shipit-seo-robots-note">
							This preview applies EmDash's rules to the text. It is not a crawler check: search engines read
							and interpret the file themselves.
						</p>
					</section>
				</div>

				<aside className="shipit-seo-panel shipit-seo-robots-status" aria-labelledby="seo-robots-status-title">
					<span className="shipit-seo-module-icon"><Robot size={20} aria-hidden="true" /></span>
					<h2 id="seo-robots-status-title">Public file</h2>
					<dl className="shipit-seo-details">
						<div>
							<dt>Served by</dt>
							<dd>{owner ? `${OWNER_LABELS[owner]}${factsData?.ownerDetail ? ` (${factsData.ownerDetail})` : ""}` : "Not confirmed"}</dd>
						</div>
						<div>
							<dt>Stored text</dt>
							<dd>{storedSummary(current)}</dd>
						</div>
						<div>
							<dt>Observed here</dt>
							<dd><Badge variant={observed.tone === "success" ? "success" : observed.tone === "error" ? "error" : "secondary"}>{observed.label}</Badge></dd>
						</div>
						<div>
							<dt>Checked</dt>
							<dd>{readableTime(observation.checkedAt)}{observation.httpStatus ? `, status ${observation.httpStatus}` : ""}</dd>
						</div>
						<div>
							<dt>Cache-Control</dt>
							<dd>{observation.status === "done" && observation.httpStatus ? observation.cacheControl ?? "None sent" : "Not observed"}</dd>
						</div>
					</dl>
					{observed.detail ? <p className="shipit-seo-robots-copy" role="status">{observed.detail}</p> : null}
					<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={observation.status === "checking"} onClick={() => void observe(current)}>
						Check again
					</Button>
					{observation.body !== null && observation.result && observation.result.status !== "matches" && observation.body.length ? (
						<details className="shipit-seo-robots-observed">
							<summary>Observed file{observation.truncated ? ` (first ${ROBOTS_OBSERVATION_MAX_BYTES.toLocaleString("en")} bytes, not verified)` : ""}</summary>
							<pre className="shipit-seo-robots-body" tabIndex={0}>{observation.body}</pre>
						</details>
					) : null}
					<p className="shipit-seo-robots-note">
						This check reads {requestOrigin}{ROBOTS_TXT_PATH} once from this browser without cookies. A saved setting is
						not a verified live response. EmDash sends {ROBOTS_TXT_CACHE_CONTROL}, so browsers, CDNs and crawlers can
						keep an older copy for up to a day.
						{publicOrigin && publicOrigin !== requestOrigin ? ` The public address ${publicOrigin}${ROBOTS_TXT_PATH} was not checked from here.` : ""}
					</p>
				</aside>
			</div>

			<Dialog.Root role="alertdialog" open={pageActive && restoreOpen} onOpenChange={setRestoreOpen}>
				<Dialog size="sm" className="shipit-seo-delete-dialog">
					<Dialog.Title>Restore EmDash's default robots.txt?</Dialog.Title>
					<Dialog.Description>
						{storedPreview.kind === "file" && storedPreview.file.disallowAiTraining
							? "The stored text is replaced with an empty value. EmDash serves its default with the AI training rules selected in Site settings and its Sitemap line. Unsaved edits on this page are discarded."
							: "The stored text is replaced with an empty value, so EmDash serves its default: allow every path except /_emdash/, then the Sitemap line. Unsaved edits on this page are discarded."}
					</Dialog.Description>
					<div className="shipit-seo-dialog-actions">
						<Button type="button" variant="secondary" onClick={() => setRestoreOpen(false)}>Cancel</Button>
						<Button type="button" variant="destructive" loading={busy === "restore"} disabled={!canRestore} onClick={() => void write("", "restore")}>Restore default</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}

function SaveOutcome({ outcome, busy, onReload, onResolveConflict }: {
	outcome: RobotsSaveResult | { status: "reload-failed"; problem: RobotsReadProblem } | null;
	busy: string | null;
	onReload: () => void;
	onResolveConflict: (latest: RobotsSettingsSnapshot, keepDraft: boolean) => void;
}) {
	if (!outcome) return null;
	const icon = <WarningCircle size={20} weight="fill" aria-hidden="true" />;
	const reloadButton = <Button size="sm" variant="secondary" icon={ArrowClockwise} loading={busy === "reload"} onClick={onReload}>Reload stored text</Button>;
	switch (outcome.status) {
		case "saved":
			if (outcome.replacedAfter) {
				return <Banner variant="alert" icon={icon} title="Saved, then replaced by another save"
					description="Your text reached EmDash, but a reload shows other text now. Your text is kept in the editor; the stored text is shown on the right. The last save wins." />;
			}
			return outcome.confirmation === "response-only"
				? <Banner variant="alert" icon={icon} title="Saved; the confirming reload failed" description="EmDash answered the save with the stored text. Reload to confirm it again." action={reloadButton} />
				: null;
		case "conflict":
			return (
				<Banner variant="alert" icon={icon} title="The stored text changed after you loaded it"
					description="Nothing was saved. EmDash keeps whichever save happens last, so choose which text to continue with."
					action={
						<div className="shipit-seo-robots-banner-actions">
							<Button size="sm" variant="secondary" onClick={() => onResolveConflict(outcome.latest, false)}>Use stored text</Button>
							<Button size="sm" variant="secondary" onClick={() => onResolveConflict(outcome.latest, true)}>Keep my text</Button>
						</div>
					} />
			);
		case "not-checked":
			return outcome.problem === "unauthorized"
				? <Banner variant="error" icon={icon} title="Your session has ended"
					description={`Nothing was saved; your text is kept on this page (${failureCode(outcome.failure)}). Sign in again in another tab, then save.`} />
				: <Banner variant="error" icon={icon} title="Nothing was saved"
					description={`The stored text could not be checked before saving (${failureCode(outcome.failure)}). Your text is kept.`} />;
		case "rejected": {
			const titles = {
				invalid: "EmDash rejected the text",
				unauthorized: "Your session has ended",
				"save-denied": "Your role cannot change site settings",
				refused: "EmDash refused the save",
			} as const;
			return <Banner variant="error" icon={icon} title={titles[outcome.problem]}
				description={`Nothing was saved; your text is kept on this page (${failureCode(outcome.failure)}).${outcome.problem === "unauthorized" ? " Sign in again in another tab, then save." : ""}`} />;
		}
		case "uncertain":
			if (!outcome.reload.ok) {
				return <Banner variant="error" icon={icon} title="The save may or may not have been applied"
					description={`The response was lost (${failureCode(outcome.failure)}) and the reload failed too. Saving stays off until a reload succeeds; your text is kept.`}
					action={reloadButton} />;
			}
			return outcome.reload.outcome === "sent-text"
				? <Banner variant="alert" icon={icon} title="The response was lost; the stored text is now yours"
					description="A reload after the lost response shows your text as the stored text." />
				: outcome.reload.outcome === "previous-text"
					? <Banner variant="alert" icon={icon} title="The response was lost; the stored text is the one you started from"
						description="Whether your save was applied and then replaced is unknown. Your text is kept; you can save again." />
					: <Banner variant="alert" icon={icon} title="The response was lost; the stored text is neither yours nor the one you loaded"
						description="Another save happened. Your text is kept; review the stored text before saving again." />;
		case "reload-failed":
			return <Banner variant="error" icon={icon} title="The stored text could not be reloaded" description="Your text is kept. Try again." action={reloadButton} />;
		default:
			return null;
	}
}
