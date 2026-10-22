// Contextual internal-link suggestions for one saved entry in the native
// editor. Every command runs through the session model: the latest props and
// selected scope are applied to it before each begin, choice and settlement,
// and rendered eligibility comes from that same synced state, so a save or
// scope change removes stale actions before any effect runs. Nothing here
// inserts a link, writes plugin data, polls, retries or starts a Find by itself.

import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Copy, MagnifyingGlass, Warning, X } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { SeoAdminScoreScanTerm } from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as React from "react";

import {
	LINK_SUGGESTION_LIMITS,
	LINK_SUGGESTION_SAVED_SOURCE_NOTICE,
	canonicalLinkLocale,
	type LinkCoverageGap,
	type LinkReasonKind,
	type LinkSavedCheck,
	type LinkSuggestion,
	type LinkSuggestionAnchor,
	type LinkSuggestionResponse,
	type LinkVerificationUnavailable,
} from "../internal-link-suggestions.ts";
import { fetchSeoAdminContentOptions, fetchSeoScoreScanTaxonomies, fetchSeoScoreScanTerms } from "./api.ts";
import {
	createLinkSuggestionApi,
	type LinkCheckOutcome,
	type LinkPageOutcome,
	type LinkUnusableReason,
	type LinkVerifyOutcome,
} from "./internal-link-api.ts";
import {
	beginLinkCheck,
	beginLinkCopy,
	beginLinkFind,
	beginLinkNext,
	beginLinkVerify,
	chooseLinkSuggestion,
	createLinkSession,
	isLinkPageReferenceOnly,
	settleLinkCheck,
	settleLinkCopy,
	settleLinkPaging,
	settleLinkVerify,
	updateLinkSessionContext,
	type LinkSessionContext,
	type LinkSessionState,
	type LinkSettlement,
	type LinkTransportFailure,
} from "./internal-link-suggestions-model.ts";
import { linkExclusionRows, linkPageSummaryText, linkStaleVerdictMessages, plural } from "./internal-link-suggestions-presentation.ts";
import { SCORE_SCAN_TERM_SEARCH_MAX } from "./score-scan-model.ts";

const linkApi = createLinkSuggestionApi();

const QUERY_SCOPE = "shipit-seo-internal-links";
/** The taxonomy route lists at most this many and has no continuation. */
const TAXONOMY_LIST_LIMIT = 100;

/**
 * The link identity rule every taxonomy name and term ID in a request must
 * meet: nonempty, at most 128 UTF-16 units, no edge whitespace and no control
 * characters. Discovery accepts longer term IDs, which every link request
 * would refuse, so only identities passing this rule may be selected.
 */
function isLinkIdentity(value: string): boolean {
	return value.length > 0 && value.length <= LINK_SUGGESTION_LIMITS.identityChars && value.trim() === value &&
		!/[\u0000-\u001f\u007f]/u.test(value);
}

/** Fails `isLinkIdentity`, and only names passing it are offered, so it cannot equal an offered taxonomy. */
const NO_TAXONOMY = " none";
// Discovery reads run when a selection needs them and never again by themselves.
const DISCOVERY_QUERY = {
	retry: false,
	refetchOnWindowFocus: false,
	refetchOnReconnect: false,
	refetchInterval: false,
} as const;

export interface InternalLinkSuggestionsProps {
	collection: string;
	entryId: string;
	/** The entry's own saved `entry.locale`, never a selected view locale. */
	entryLocale: string | null;
	/** The editor context locale; when present it must equal the entry's own locale. */
	contextLocale: string | null;
	/** `editorSavedVersion` of the original saved entry; null when unknown. */
	savedVersion: string | null;
}

interface LinkScopeSelection {
	collection: string | null;
	taxonomy: { name: string; label: string } | null;
	/** Exact same-locale terms in selection order; labels are kept apart from any visible term page. */
	terms: ReadonlyArray<{ id: string; label: string }>;
}

const EMPTY_SCOPE: LinkScopeSelection = { collection: null, taxonomy: null, terms: [] };

type LinkSectionBlocker = "locale-missing" | "locale-noncanonical" | "locale-conflict" | "saved-version-unknown";

function sectionBlocker(props: InternalLinkSuggestionsProps): LinkSectionBlocker | null {
	if (!props.entryLocale) return "locale-missing";
	if (canonicalLinkLocale(props.entryLocale) !== props.entryLocale) return "locale-noncanonical";
	if (props.contextLocale !== null && props.contextLocale !== props.entryLocale) return "locale-conflict";
	if (props.savedVersion === null) return "saved-version-unknown";
	return null;
}

function blockerMessage(blocker: LinkSectionBlocker, props: InternalLinkSuggestionsProps): string {
	switch (blocker) {
		case "locale-missing":
			return "This entry has no saved language, so link suggestions cannot run.";
		case "locale-noncanonical":
			return `This entry's saved language "${props.entryLocale}" is not a canonical language tag, so link suggestions cannot run.`;
		case "locale-conflict":
			return `The editor is set to ${props.contextLocale}, but this entry is saved in ${props.entryLocale}. Open the entry in its own language to use link suggestions.`;
		case "saved-version-unknown":
			return "This entry's saved version is unknown. Save the entry, then try again.";
	}
}

/** A taxonomy without a selected term, or with an identity no link request accepts, names no destination. */
function destinationOf(scope: LinkScopeSelection): LinkSessionContext["destination"] {
	if (scope.collection === null) return null;
	if (scope.taxonomy === null) return { collection: scope.collection, taxonomy: null };
	if (scope.terms.length === 0 || !isLinkIdentity(scope.taxonomy.name) || !scope.terms.every((term) => isLinkIdentity(term.id))) return null;
	return { collection: scope.collection, taxonomy: { taxonomy: scope.taxonomy.name, termIds: scope.terms.map((term) => term.id) } };
}

/** The model context for the actual saved locale; null when that locale cannot identify the entry. */
function sessionContextOf(props: InternalLinkSuggestionsProps, scope: LinkScopeSelection): LinkSessionContext | null {
	const locale = props.entryLocale;
	if (!locale || canonicalLinkLocale(locale) !== locale) return null;
	return { collection: props.collection, entryId: props.entryId, locale, savedVersion: props.savedVersion, destination: destinationOf(scope) };
}

interface LinkEligibility {
	find: boolean;
	next: boolean;
	choose: boolean;
	verify: boolean;
	copy: boolean;
	check: boolean;
}

/**
 * One command at a time. A page kept after a failed request or a non-page
 * answer is display-only until a fresh Find succeeds.
 */
function linkEligibility(state: LinkSessionState, blocked: boolean): LinkEligibility {
	const idle = !blocked && !state.paging && !state.verifying && !state.copying && !state.checking;
	const usable = idle && state.page !== null && !isLinkPageReferenceOnly(state);
	return {
		find: idle && state.context !== null && state.context.destination !== null && state.context.savedVersion !== null,
		next: usable && state.page !== null && state.page.receipt !== null,
		choose: usable,
		verify: usable && state.chosen !== null,
		copy: usable && state.verified !== null && state.verified.submission === state.chosen,
		check: idle && state.copied !== null,
	};
}

async function writeClipboard(text: string): Promise<boolean> {
	try {
		if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Explanations

const UNUSABLE_MESSAGES: Record<LinkUnusableReason, string> = {
	oversized: "The answer was larger than its size limit, so it was not used.",
	malformed: "The answer had an unexpected form, so it was not used.",
	"owner-mismatch": "The answer belonged to another entry, saved version or scope, so it was not used.",
	"receipt-invalid": "The answer's continuation to the next page was not valid, so it was not used.",
	"target-mismatch": "The answer named a different destination, so it was not used.",
	"url-mismatch": "The returned URL does not match the chosen destination's route, so it was not used.",
	"request-invalid": "The request could not be prepared, so nothing was sent.",
};

const PAGE_FAILURE_MESSAGES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	invalid: {
		request: "The request was refused as invalid.",
		receipt: "The continuation to the next page was refused. Run Find link suggestions again.",
		"collection-unavailable": "The destination content type is not available for link suggestions.",
		"taxonomy-not-attached": "The selected taxonomy is not attached to the destination content type.",
		"term-unavailable": "A selected term is no longer available in this language.",
		"too-many-terms": "Too many terms are selected.",
	},
	stale: {
		"source-missing": "This entry's saved version could not be found.",
		"source-version-changed": "This entry was saved again during the request. Run Find link suggestions again.",
		"source-locale-changed": "This entry's saved language changed. Reopen the entry.",
		"scope-changed": "The destination content type or taxonomy changed. Run Find link suggestions again.",
		"selection-changed": "The selection changed during the request. Run Find link suggestions again.",
	},
	unavailable: {
		"adapter-absent": "Link suggestions are not available on this site.",
		"source-unavailable": "This entry's saved content could not be read.",
		"scope-unavailable": "The destination scope could not be read.",
		"candidates-unavailable": "Destinations could not be read.",
		"policy-unreadable": "Search indexing settings could not be read, so no destination can be suggested.",
	},
	unsupported: {
		"no-portable-text-field": "This content type has no rich text body to suggest links in.",
		"ambiguous-body-field": "This content type has more than one rich text field, so the body to read is ambiguous.",
	},
	refused: {
		source_body_unsupported: "The saved body has a form link suggestions cannot read.",
		source_body_malformed: "The saved body could not be read.",
		source_too_large: "The saved body is larger than link suggestions can read.",
		invalid_input: "The request was refused as invalid.",
		owner_mismatch: "The saved entry did not match the request.",
		site_url_unavailable: "The site URL is not configured, so public URLs cannot be resolved.",
		source_route_unavailable: "The body has relative links and this entry's own route is unknown, so existing links cannot be resolved.",
		candidate_page_invalid: "Destinations were returned in an unexpected form.",
		policy_unreadable: "Search indexing settings could not be read.",
		target_reads_invalid: "Destination details were returned in an unexpected form.",
		response_too_large: "The answer was larger than its size limit, so no suggestions could be returned.",
	},
};

function pageOutcomeMessage(outcome: Exclude<LinkPageOutcome, { kind: "result" }>): string {
	if (outcome.kind === "unusable") return UNUSABLE_MESSAGES[outcome.reason];
	return PAGE_FAILURE_MESSAGES[outcome.kind]?.[outcome.reason] ?? "Link suggestions could not be loaded.";
}

const VERIFY_UNAVAILABLE_MESSAGES: Record<LinkVerificationUnavailable, string> = {
	"source-unavailable": "This entry's saved content could not be read.",
	"source-unsupported": "This entry's saved body cannot be read for link suggestions.",
	"target-unavailable": "The destination could not be read.",
	"policy-unreadable": "Search indexing settings could not be read.",
	"scope-unavailable": "The destination scope could not be read.",
	"site-url-unavailable": "The site URL is not configured, so the public URL cannot be confirmed.",
	"source-route-unavailable": "This entry's own route is unknown, so its relative links cannot be resolved.",
};

function verdictMessages(outcome: LinkVerifyOutcome): string[] {
	if (outcome.kind === "unusable") return [UNUSABLE_MESSAGES[outcome.reason]];
	if (outcome.kind === "invalid") return ["The verification request was refused as invalid."];
	if (outcome.kind === "unavailable") return ["Link verification is not available on this site."];
	const verification = outcome.verification;
	if (verification.kind === "verified") return [];
	if (verification.kind === "unavailable") return [`Nothing was verified. ${VERIFY_UNAVAILABLE_MESSAGES[verification.reason]}`];
	return linkStaleVerdictMessages(verification);
}

const COVERAGE_GAP_LABELS: Record<LinkCoverageGap, string> = {
	"unsupported-content": "Tables, HTML or custom blocks were not read for existing links.",
	"possible-destination": "Some link-like values outside link annotations may already point to a destination.",
	"unreadable-link": "Some existing links could not be read.",
};

const REASON_LABELS: Record<LinkReasonKind, string> = {
	title: "Matches the destination title",
	"title-phrase": "Matches a phrase from the destination title",
	"excerpt-phrase": "Matches a phrase from the destination excerpt",
};

type SavedCheckDetail<K extends LinkSavedCheck["kind"]> = Extract<LinkSavedCheck, { kind: K; detail: string }>["detail"];

const CHECK_STALE_MESSAGES: Record<SavedCheckDetail<"stale">, string> = {
	"paragraph-missing": "The chosen paragraph is no longer in the saved body.",
	"paragraph-changed": "The chosen paragraph changed in the saved body, so this anchor cannot be checked.",
};

const CHECK_INCONCLUSIVE_MESSAGES: Record<SavedCheckDetail<"inconclusive">, string> = {
	"same-saved-version": "No newer saved version exists yet. Save the entry after inserting the link, then check again.",
	"duplicate-paragraph": "More than one saved block carries this paragraph's key, so the link cannot be checked.",
	"decorators-changed": "The anchor links to this destination, but its text formatting changed, so the result is not confirmed.",
	"source-missing": "The saved entry could not be found.",
	"source-unavailable": "The saved entry could not be read. This does not mean the link is missing.",
	"source-unsupported": "The saved body cannot be read for this content type.",
	"source-unreadable": "The saved body could not be read. This does not mean the link is missing.",
	"site-url-unavailable": "The site URL is not configured, so saved links cannot be resolved.",
	"source-route-unavailable": "A relative link could not be resolved because this entry's own route is unknown.",
	"links-unreadable": "A link on the anchor could not be read. This does not mean the link is missing.",
};

/** Only a saved-check `verified` verdict proves the actual saved annotation. */
function checkPresentation(outcome: LinkCheckOutcome): { proven: boolean; message: string } {
	if (outcome.kind === "unusable") return { proven: false, message: UNUSABLE_MESSAGES[outcome.reason] };
	if (outcome.kind === "invalid") return { proven: false, message: "The check request was refused as invalid." };
	if (outcome.kind === "unavailable") return { proven: false, message: "Saved-link checks are not available on this site." };
	const check = outcome.check;
	switch (check.kind) {
		case "verified":
			return {
				proven: true,
				message: "The saved entry links the chosen anchor to this destination. This does not show that the link is published or that the URL is reachable.",
			};
		case "unlinked":
			return { proven: false, message: "The saved entry has no link on the chosen anchor yet." };
		case "partial":
			return { proven: false, message: "Only part of the chosen anchor links to this destination in the saved entry." };
		case "wrong-destination":
			return { proven: false, message: "The chosen anchor links somewhere other than this destination in the saved entry." };
		case "stale":
			return { proven: false, message: CHECK_STALE_MESSAGES[check.detail] };
		case "inconclusive":
			return { proven: false, message: CHECK_INCONCLUSIVE_MESSAGES[check.detail] };
	}
}

function failureMessage(failure: LinkTransportFailure | null, action: string): string | null {
	if (failure === null || failure.aborted) return null;
	if (failure.status === 401) return `You are signed out or your session ended, so the request to ${action} was refused. Sign in again, then try again.`;
	if (failure.status === 403) return `Your account is not allowed to ${action}. Link suggestions need permission to manage plugins.`;
	return `The request to ${action} failed${failure.status === null ? "" : ` (HTTP ${failure.status})`}. It was not retried.`;
}

function discoveryErrorMessage(error: unknown, subject: string): string {
	const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
	if (status === 401) return `${subject} could not be loaded because you are signed out. Sign in again, then try again.`;
	if (status === 403) return `Your account is not allowed to load ${subject.toLowerCase()}.`;
	return `${subject} could not be loaded.`;
}

const TAXONOMY_UNAVAILABLE_MESSAGES = {
	scan_unavailable: "Taxonomy filters are not available on this site, so suggestions use the whole content type.",
	unsupported_collection: "This content type cannot be filtered by taxonomy here, so suggestions use the whole content type.",
	taxonomies_unavailable: "Taxonomies could not be read, so suggestions can only use the whole content type.",
} as const;

const TERM_UNAVAILABLE_MESSAGES = {
	scan_unavailable: "Term lists are not available on this site.",
	unsupported_collection: "Terms cannot be listed for this content type.",
	invalid_selection: "This term search was refused.",
	source_unavailable: "Terms could not be read.",
} as const;

// ---------------------------------------------------------------------------
// Presentation

function SavedParagraph({ anchor, locale }: { anchor: LinkSuggestionAnchor; locale: string }) {
	return (
		<figure className="shipit-seo-link-suggestions__paragraph">
			<figcaption>Saved paragraph</figcaption>
			<blockquote lang={locale}>
				{anchor.paragraph.slice(0, anchor.paragraphStart)}
				<mark>{anchor.paragraph.slice(anchor.paragraphStart, anchor.paragraphEnd)}</mark>
				{anchor.paragraph.slice(anchor.paragraphEnd)}
			</blockquote>
		</figure>
	);
}

function occurrenceText(occurrence: LinkSuggestionAnchor["occurrence"]): string {
	return occurrence.total === 1
		? "The only occurrence of this phrase in the saved body."
		: `Occurrence ${occurrence.ordinal} of ${occurrence.total} of this phrase in the saved body.`;
}

function SuggestionItem(props: {
	suggestion: LinkSuggestion;
	sourceLocale: string;
	headingId: string;
	chosen: boolean;
	canChoose: boolean;
	onChoose(): void;
}) {
	const { target, anchor, reason } = props.suggestion;
	return (
		<li className="shipit-seo-link-suggestions__item" data-chosen={props.chosen || undefined}>
			<h5 id={props.headingId} className="shipit-seo-link-suggestions__title" lang={target.locale}>{target.title}</h5>
			<SavedParagraph anchor={anchor} locale={props.sourceLocale} />
			<dl className="shipit-seo-link-suggestions__facts">
				<div>
					<dt>Anchor</dt>
					<dd><q lang={props.sourceLocale}>{anchor.text}</q> {occurrenceText(anchor.occurrence)}</dd>
				</div>
				{anchor.heading !== null ? (
					<div>
						<dt>Under heading</dt>
						<dd lang={props.sourceLocale}>{anchor.heading}</dd>
					</div>
				) : null}
				<div>
					<dt>Reason</dt>
					<dd>{REASON_LABELS[reason.kind]}: <q lang={target.locale}>{reason.quote}</q></dd>
				</div>
				<div>
					<dt>Destination language</dt>
					<dd>{target.locale}</dd>
				</div>
				<div>
					<dt>Public URL, not verified</dt>
					<dd className="shipit-seo-link-suggestions__url">{target.publicUrl}</dd>
				</div>
			</dl>
			<div className="shipit-seo-link-suggestions__actions">
				<Button
					type="button"
					variant={props.chosen ? "primary" : "secondary"}
					size="sm"
					aria-pressed={props.chosen}
					aria-describedby={props.headingId}
					disabled={!props.canChoose}
					onClick={props.onChoose}
				>
					Choose
				</Button>
				{props.chosen ? <span className="shipit-seo-muted">Chosen for verification</span> : null}
			</div>
		</li>
	);
}

function PageSummary({ response, referenceOnly }: { response: LinkSuggestionResponse; referenceOnly: boolean }) {
	const { page, coverage, excluded, omittedForResponseLimit } = response;
	const exclusions = linkExclusionRows(excluded);
	return (
		<div className="shipit-seo-link-suggestions__meta">
			<p>{linkPageSummaryText(page, referenceOnly)}</p>
			<p>One bounded page is not an analysis of the whole site. Suggestions come from phrase matching and carry no relevance score.</p>
			{omittedForResponseLimit > 0 ? (
				<p>{`${plural(omittedForResponseLimit, "suggestion was", "suggestions were")} left out to keep the answer within its size limit.`}</p>
			) : null}
			{coverage.kind === "partial" ? (
				<div role="note">
					<p><strong>Partial coverage.</strong> {coverage.limitation}</p>
					<ul>
						{coverage.gaps.map((gap) => <li key={gap}>{COVERAGE_GAP_LABELS[gap]}</li>)}
					</ul>
				</div>
			) : null}
			{exclusions.length ? (
				<details className="shipit-seo-link-suggestions__excluded">
					<summary>Not suggested on this page</summary>
					<dl>
						{exclusions.map(({ reason, label, count }) => (
							<div key={reason}>
								<dt>{label}</dt>
								<dd>{count}</dd>
							</div>
						))}
					</dl>
				</details>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Section

export function InternalLinkSuggestions(props: InternalLinkSuggestionsProps) {
	// Handlers and settlements read the latest props and scope through these refs, never a render closure.
	const latestProps = React.useRef(props);
	latestProps.current = props;
	const [scope, setScope] = React.useState<LinkScopeSelection>(EMPTY_SCOPE);
	const scopeRef = React.useRef(scope);
	const [session, setSession] = React.useState<LinkSessionState>(createLinkSession);
	const sessionRef = React.useRef(session);
	const controllers = React.useRef(new Map<number, AbortController>());
	const mounted = React.useRef(false);
	const [open, setOpen] = React.useState(false);
	const [termDraft, setTermDraft] = React.useState("");
	const [termSearch, setTermSearch] = React.useState("");
	const [termCursors, setTermCursors] = React.useState<ReadonlyArray<string | null>>([null]);
	const idPrefix = React.useId();

	React.useEffect(() => {
		mounted.current = true;
		const owned = controllers.current;
		return () => {
			mounted.current = false;
			for (const controller of owned.values()) controller.abort();
			owned.clear();
		};
	}, []);

	/** Records a model state and aborts every request it no longer owns. */
	const commit = (next: LinkSessionState): LinkSessionState => {
		if (next !== sessionRef.current) {
			sessionRef.current = next;
			setSession(next);
		}
		const live = new Set([next.paging?.id, next.verifying?.id, next.checking?.id]);
		for (const [id, controller] of controllers.current) {
			if (live.has(id)) continue;
			controller.abort();
			controllers.current.delete(id);
		}
		return next;
	};

	const sync = (): LinkSessionState => {
		const context = sessionContextOf(latestProps.current, scopeRef.current);
		return commit(context ? updateLinkSessionContext(sessionRef.current, context) : sessionRef.current);
	};

	const allowed = (state: LinkSessionState) => linkEligibility(state, sectionBlocker(latestProps.current) !== null);

	async function send<T>(id: number, request: (signal: AbortSignal) => Promise<T>): Promise<LinkSettlement<T>> {
		const controller = new AbortController();
		controllers.current.set(id, controller);
		try {
			return { ok: true, value: await request(controller.signal) };
		} catch (error: unknown) {
			return { ok: false, error };
		} finally {
			controllers.current.delete(id);
		}
	}

	async function find() {
		const synced = sync();
		if (!allowed(synced).find) return;
		const begun = beginLinkFind(synced);
		const operation = begun.operation;
		if (!operation) return;
		commit(begun.state);
		const settlement = await send(operation.id, (signal) => linkApi.find(operation.request, signal));
		if (mounted.current) commit(settleLinkPaging(sync(), operation, settlement));
	}

	async function next() {
		const synced = sync();
		if (!allowed(synced).next) return;
		const begun = beginLinkNext(synced);
		const operation = begun.operation;
		if (!operation) return;
		commit(begun.state);
		const settlement = await send(operation.id, (signal) => linkApi.next(operation.request, signal));
		if (mounted.current) commit(settleLinkPaging(sync(), operation, settlement));
	}

	function choose(entryId: string) {
		const synced = sync();
		if (allowed(synced).choose) commit(chooseLinkSuggestion(synced, entryId));
	}

	async function verify() {
		const synced = sync();
		if (!allowed(synced).verify) return;
		const begun = beginLinkVerify(synced);
		const operation = begun.operation;
		if (!operation) return;
		commit(begun.state);
		const settlement = await send(operation.id, (signal) => linkApi.verify(operation.submission, signal));
		if (mounted.current) commit(settleLinkVerify(sync(), operation, settlement));
	}

	async function copy() {
		const synced = sync();
		if (!allowed(synced).copy) return;
		const begun = beginLinkCopy(synced);
		const operation = begun.operation;
		if (!operation) return;
		commit(begun.state);
		// Started inside the click, before any await, so the browser still treats it as user-initiated.
		const copied = await writeClipboard(operation.url);
		if (mounted.current) commit(settleLinkCopy(sync(), operation, copied));
	}

	async function check() {
		const synced = sync();
		if (!allowed(synced).check) return;
		const begun = beginLinkCheck(synced);
		const operation = begun.operation;
		if (!operation) return;
		commit(begun.state);
		const settlement = await send(operation.id, (signal) => linkApi.checkSaved(operation.submission, signal));
		if (mounted.current) commit(settleLinkCheck(sync(), operation, settlement));
	}

	function changeScope(nextScope: LinkScopeSelection) {
		scopeRef.current = nextScope;
		setScope(nextScope);
		sync();
	}

	function resetTermBrowsing() {
		setTermDraft("");
		setTermSearch("");
		setTermCursors([null]);
	}

	function chooseCollection(collection: string | null) {
		if (collection === scopeRef.current.collection) return;
		resetTermBrowsing();
		changeScope({ collection, taxonomy: null, terms: [] });
	}

	function chooseTaxonomy(taxonomy: LinkScopeSelection["taxonomy"]) {
		if (taxonomy?.name === scopeRef.current.taxonomy?.name || (taxonomy !== null && !isLinkIdentity(taxonomy.name))) return;
		resetTermBrowsing();
		changeScope({ ...scopeRef.current, taxonomy, terms: [] });
	}

	function addTerm(term: SeoAdminScoreScanTerm) {
		const current = scopeRef.current;
		if (!isLinkIdentity(term.id) || term.locale !== latestProps.current.entryLocale ||
			current.terms.length >= LINK_SUGGESTION_LIMITS.taxonomyTerms || current.terms.some((item) => item.id === term.id)) return;
		changeScope({ ...current, terms: [...current.terms, { id: term.id, label: term.label }] });
	}

	function removeTerm(id: string) {
		const current = scopeRef.current;
		changeScope({ ...current, terms: current.terms.filter((term) => term.id !== id) });
	}

	function searchTerms() {
		setTermSearch(termDraft.trim());
		setTermCursors([null]);
	}

	const context = sessionContextOf(props, scope);
	const contextKey = context === null ? null : JSON.stringify(context);
	// Rendering already derives from the latest context; this records it so superseded requests are aborted.
	React.useEffect(() => {
		if (contextKey !== null) sync();
	}, [contextKey]);

	const view = context ? updateLinkSessionContext(session, context) : session;
	const blocker = sectionBlocker(props);
	const can = linkEligibility(view, blocker !== null);
	const locale = context?.locale ?? null;

	const collectionsQuery = useQuery({
		queryKey: [QUERY_SCOPE, "collections"],
		queryFn: ({ signal }) => fetchSeoAdminContentOptions({ signal }),
		enabled: open && context !== null,
		staleTime: 60_000,
		...DISCOVERY_QUERY,
	});
	const destinations = (collectionsQuery.data?.collections ?? []).filter((item) => item.routable);
	const taxonomiesQuery = useQuery({
		queryKey: [QUERY_SCOPE, "taxonomies", scope.collection],
		queryFn: ({ signal }) => fetchSeoScoreScanTaxonomies(scope.collection as string, { signal }),
		enabled: open && context !== null && scope.collection !== null,
		staleTime: 60_000,
		...DISCOVERY_QUERY,
	});
	const taxonomyResult = taxonomiesQuery.data?.collection === scope.collection ? taxonomiesQuery.data ?? null : null;
	const linkTaxonomies = taxonomyResult?.success ? taxonomyResult.taxonomies.filter((taxonomy) => isLinkIdentity(taxonomy.name)) : [];
	const unusableTaxonomies = taxonomyResult?.success ? taxonomyResult.taxonomies.length - linkTaxonomies.length : 0;
	const termCursor = termCursors[termCursors.length - 1] ?? null;
	const termsQuery = useQuery({
		queryKey: [QUERY_SCOPE, "terms", scope.collection, scope.taxonomy?.name ?? null, locale, termSearch, termCursor],
		queryFn: ({ signal }) => fetchSeoScoreScanTerms({
			collection: scope.collection as string,
			taxonomy: scope.taxonomy?.name as string,
			locale,
			search: termSearch,
			cursor: termCursor,
		}, { signal }),
		enabled: open && locale !== null && scope.collection !== null && scope.taxonomy !== null,
		staleTime: 30_000,
		...DISCOVERY_QUERY,
	});
	const termsResult = termsQuery.data && termsQuery.data.collection === scope.collection &&
		termsQuery.data.taxonomy === scope.taxonomy?.name ? termsQuery.data : null;
	const termsFull = scope.terms.length >= LINK_SUGGESTION_LIMITS.taxonomyTerms;
	const unusableTerms = termsResult?.success ? termsResult.terms.filter((term) => !isLinkIdentity(term.id)).length : 0;

	const page = view.page;
	const displayOnly = isLinkPageReferenceOnly(view);
	const pageFailureText = failureMessage(view.pageFailure, "load link suggestions");
	const verifyFailureText = failureMessage(view.verifyFailure, "verify the destination");
	const checkFailureText = failureMessage(view.checkFailure, "check the saved link");
	const checked = view.copied && view.checked?.receiptId === view.copied.id ? checkPresentation(view.checked.outcome) : null;
	const verdictLines = view.verdict ? verdictMessages(view.verdict) : [];
	const findHint = blocker !== null || can.find || view.paging ? null
		: scope.collection === null ? "Choose a destination content type to find suggestions."
		: scope.taxonomy !== null && scope.terms.length === 0 ? "Choose at least one term, or remove the taxonomy filter."
		: null;
	const id = (part: string) => `${idPrefix}-${part}`;

	return (
		<details className="shipit-seo-link-suggestions" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
			<summary className="shipit-seo-link-suggestions__summary">Internal link suggestions</summary>
			<div className="shipit-seo-link-suggestions__body">
				<Banner variant="alert" role="note" icon={<Warning weight="fill" aria-hidden="true" />} description={LINK_SUGGESTION_SAVED_SOURCE_NOTICE} />
				{blocker !== null ? <p className="shipit-seo-form-error" role="alert">{blockerMessage(blocker, props)}</p> : null}
				{context !== null ? (
					<>
						<fieldset className="shipit-seo-link-suggestions__scope">
							<legend>Destinations</legend>
							{collectionsQuery.isError ? (
								<div className="shipit-seo-link-suggestions__actions" role="alert">
									<span className="shipit-seo-form-error">{discoveryErrorMessage(collectionsQuery.error, "Content types")}</span>
									<Button type="button" variant="secondary" size="sm" onClick={() => void collectionsQuery.refetch()}>Try again</Button>
								</div>
							) : null}
							<Select<string>
								label="Destination content type"
								placeholder={collectionsQuery.isFetching ? "Loading content types" : "Choose a content type"}
								value={scope.collection}
								items={destinations.map((item) => ({ value: item.collection, label: item.label }))}
								disabled={!collectionsQuery.isSuccess || destinations.length === 0}
								onValueChange={(value) => chooseCollection(typeof value === "string" ? value : null)}
							/>
							{collectionsQuery.isSuccess && destinations.length === 0 ? (
								<p className="shipit-seo-muted">No routable content types are offered as destinations.</p>
							) : null}
							{scope.collection !== null ? (
								taxonomiesQuery.isError ? (
									<div className="shipit-seo-link-suggestions__actions" role="alert">
										<span className="shipit-seo-form-error">{discoveryErrorMessage(taxonomiesQuery.error, "Taxonomies")}</span>
										<Button type="button" variant="secondary" size="sm" onClick={() => void taxonomiesQuery.refetch()}>Try again</Button>
									</div>
								) : taxonomyResult === null ? (
									<p className="shipit-seo-muted" role="status">Loading taxonomies.</p>
								) : !taxonomyResult.success ? (
									<p className="shipit-seo-muted" role="status">{TAXONOMY_UNAVAILABLE_MESSAGES[taxonomyResult.error]}</p>
								) : taxonomyResult.taxonomies.length === 0 ? (
									<p className="shipit-seo-muted">No taxonomies are attached to this content type, so suggestions use the whole content type.</p>
								) : (
									<>
										{linkTaxonomies.length ? (
											<Select<string>
												label="Filter by taxonomy"
												value={scope.taxonomy?.name ?? NO_TAXONOMY}
												items={[
													{ value: NO_TAXONOMY, label: "No taxonomy filter" },
													...linkTaxonomies.map((taxonomy) => ({ value: taxonomy.name, label: taxonomy.label })),
												]}
												onValueChange={(value) => {
													const taxonomy = linkTaxonomies.find((item) => item.name === value);
													chooseTaxonomy(taxonomy ? { name: taxonomy.name, label: taxonomy.label } : null);
												}}
											/>
										) : null}
										{unusableTaxonomies > 0 ? (
											<p className="shipit-seo-muted" role="note">
												{`${plural(unusableTaxonomies, "attached taxonomy has a name", "attached taxonomies have names")} that link suggestions cannot use, so ${unusableTaxonomies === 1 ? "it is" : "they are"} not offered.`}
												{linkTaxonomies.length === 0 ? " Suggestions use the whole content type." : ""}
											</p>
										) : null}
										{taxonomyResult.taxonomies.length >= TAXONOMY_LIST_LIMIT ? (
											<p className="shipit-seo-muted" role="note">
												{`Only the first ${TAXONOMY_LIST_LIMIT} taxonomies are listed. Others attached to this content type are not shown.`}
											</p>
										) : null}
									</>
								)
							) : null}
							{scope.taxonomy !== null ? (
								<div className="shipit-seo-link-suggestions__terms">
									<p id={id("selected-terms")}>
										{`Selected ${scope.taxonomy.label} terms: ${scope.terms.length} of ${LINK_SUGGESTION_LIMITS.taxonomyTerms}`}
									</p>
									{scope.terms.length ? (
										<ul className="shipit-seo-link-suggestions__chips" aria-labelledby={id("selected-terms")}>
											{scope.terms.map((term) => (
												<li key={term.id} className="shipit-seo-link-suggestions__chip">
													<span lang={locale ?? undefined}>{term.label}</span>
													<button type="button" aria-label={`Remove ${term.label}`} onClick={() => removeTerm(term.id)}>
														<X size={12} aria-hidden="true" />
													</button>
												</li>
											))}
										</ul>
									) : (
										<p className="shipit-seo-muted" role="status">Choose at least one term, or set the filter back to No taxonomy filter.</p>
									)}
									<p className="shipit-seo-muted">
										{`Terms match exactly in ${locale}. Child terms and translations are not included.`}
										{termsFull ? ` ${LINK_SUGGESTION_LIMITS.taxonomyTerms} terms are selected, the most allowed.` : ""}
									</p>
									<div className="shipit-seo-link-suggestions__term-search" role="search">
										<Input
											label="Search terms"
											value={termDraft}
											maxLength={SCORE_SCAN_TERM_SEARCH_MAX}
											autoComplete="off"
											onChange={(event) => setTermDraft(event.target.value)}
											onKeyDown={(event) => {
												if (event.key !== "Enter") return;
												event.preventDefault();
												searchTerms();
											}}
										/>
										<Button type="button" variant="secondary" size="sm" icon={MagnifyingGlass} onClick={searchTerms}>Search</Button>
									</div>
									{termsQuery.isError ? (
										<div className="shipit-seo-link-suggestions__actions" role="alert">
											<span className="shipit-seo-form-error">{discoveryErrorMessage(termsQuery.error, "Terms")}</span>
											<Button type="button" variant="secondary" size="sm" onClick={() => void termsQuery.refetch()}>Try again</Button>
										</div>
									) : termsResult === null ? (
										<p className="shipit-seo-muted" role="status">Loading terms.</p>
									) : !termsResult.success ? (
										<p className="shipit-seo-form-error" role="alert">
											{termsResult.error === "invalid_selection" && termsResult.detail ? termsResult.detail : TERM_UNAVAILABLE_MESSAGES[termsResult.error]}
										</p>
									) : (
										<>
											{termsResult.terms.length ? (
												<ul className="shipit-seo-link-suggestions__term-results" aria-label={`${scope.taxonomy.label} terms`}>
													{termsResult.terms.map((term) => {
														const selected = scope.terms.some((item) => item.id === term.id);
														return (
															<li key={term.id}>
																<span>
																	<span lang={term.locale}>{term.label}</span>
																	<small>{term.locale}</small>
																</span>
																<Button
																	type="button"
																	variant="secondary"
																	size="sm"
																	aria-label={selected ? `${term.label} selected` : `Add ${term.label}`}
																	disabled={selected || termsFull || term.locale !== locale || !isLinkIdentity(term.id)}
																	onClick={() => addTerm(term)}
																>
																	{selected ? "Selected" : "Add"}
																</Button>
															</li>
														);
													})}
												</ul>
											) : <p className="shipit-seo-muted">No matching terms.</p>}
											{termsResult.terms.some((term) => term.locale !== locale) ? (
												<p className="shipit-seo-muted">{`Only terms in ${locale} can be added.`}</p>
											) : null}
											{unusableTerms > 0 ? (
												<p className="shipit-seo-muted" role="note">
													{`${plural(unusableTerms, "term on this page has an ID", "terms on this page have IDs")} that link suggestions cannot use, so ${unusableTerms === 1 ? "it" : "they"} cannot be added.`}
												</p>
											) : null}
											<div className="shipit-seo-link-suggestions__pager">
												<Button type="button" variant="secondary" size="sm" disabled={termCursors.length <= 1} onClick={() => setTermCursors((current) => current.slice(0, -1))}>
													Previous terms
												</Button>
												<Button
													type="button"
													variant="secondary"
													size="sm"
													disabled={!termsResult.nextCursor}
													onClick={() => {
														const cursor = termsResult.nextCursor;
														if (cursor) setTermCursors((current) => [...current, cursor]);
													}}
												>
													Next terms
												</Button>
											</div>
										</>
									)}
								</div>
							) : null}
						</fieldset>

						<div className="shipit-seo-link-suggestions__actions">
							<Button type="button" variant="primary" icon={MagnifyingGlass} loading={view.paging?.kind === "find"} disabled={!can.find} onClick={() => void find()}>
								Find link suggestions
							</Button>
						</div>
						{findHint ? <p className="shipit-seo-muted">{findHint}</p> : null}
						{pageFailureText ? <p className="shipit-seo-form-error" role="alert">{pageFailureText}</p> : null}
						{view.pageOutcome ? <p className="shipit-seo-form-error" role="alert">{pageOutcomeMessage(view.pageOutcome)}</p> : null}

						{page ? (
							<section className="shipit-seo-link-suggestions__results" aria-labelledby={id("results")}>
								<h4 id={id("results")}>Suggestions</h4>
								{displayOnly ? (
									<p className="shipit-seo-muted" role="note">This page is shown for reference only. Run Find link suggestions again before choosing a suggestion.</p>
								) : null}
								<PageSummary response={page.response} referenceOnly={displayOnly} />
								{page.response.suggestions.length ? (
									<ul className="shipit-seo-link-suggestions__list">
										{page.response.suggestions.map((suggestion, index) => (
											<SuggestionItem
												key={suggestion.target.collection + ":" + suggestion.target.entryId}
												suggestion={suggestion}
												sourceLocale={page.response.owner.source.locale}
												headingId={id(`suggestion-${index}`)}
												chosen={view.chosen?.target.entryId === suggestion.target.entryId &&
													view.chosen.target.collection === suggestion.target.collection}
												canChoose={can.choose}
												onChoose={() => choose(suggestion.target.entryId)}
											/>
										))}
									</ul>
								) : <p className="shipit-seo-muted">No suggestions on this page.</p>}
								{page.receipt ? (
									<div className="shipit-seo-link-suggestions__actions">
										<Button type="button" variant="secondary" loading={view.paging?.kind === "next"} disabled={!can.next} onClick={() => void next()}>
											Next page
										</Button>
									</div>
								) : null}
							</section>
						) : null}

						{view.chosen ? (
							<section className="shipit-seo-link-suggestions__verify" aria-labelledby={id("verify")}>
								<h4 id={id("verify")}>Verify the chosen destination</h4>
								<p>
									<span lang={view.chosen.request.suggestion.target.locale}>{view.chosen.request.suggestion.target.title}</span>
									{" for the anchor "}
									<q lang={locale ?? undefined}>{view.chosen.request.suggestion.anchor.text}</q>
								</p>
								<div className="shipit-seo-link-suggestions__actions">
									<Button type="button" variant="primary" loading={view.verifying !== null} disabled={!can.verify} onClick={() => void verify()}>
										Verify destination
									</Button>
								</div>
								{verifyFailureText ? <p className="shipit-seo-form-error" role="alert">{verifyFailureText}</p> : null}
								{verdictLines.length ? (
									<div role="alert">
										<ul className="shipit-seo-link-suggestions__messages">
											{verdictLines.map((message) => <li key={message}>{message}</li>)}
										</ul>
									</div>
								) : null}
								{view.verified ? (
									<div className="shipit-seo-link-suggestions__verified">
										<dl className="shipit-seo-link-suggestions__facts">
											<div>
												<dt>Verified URL</dt>
												<dd className="shipit-seo-link-suggestions__url">{view.verified.url}</dd>
											</div>
										</dl>
										<div className="shipit-seo-link-suggestions__actions">
											<Button type="button" variant="secondary" icon={Copy} loading={view.copying !== null} disabled={!can.copy} onClick={() => void copy()}>
												Copy URL
											</Button>
										</div>
									</div>
								) : null}
							</section>
						) : page && !displayOnly && page.response.suggestions.length ? (
							<p className="shipit-seo-muted">Choose a suggestion to verify its destination.</p>
						) : null}
						{view.copying !== null && !view.verified ? <p className="shipit-seo-muted" role="status">Copying the verified URL.</p> : null}
						{view.copyFailed ? (
							<p className="shipit-seo-form-error" role="alert">
								{"The latest Copy failed, so nothing was recorded."}
								{view.verified ? " You can select the verified URL and copy it yourself, but Check saved link needs a successful Copy." : ""}
								{view.copied ? " The copied link below is from an earlier Copy." : ""}
							</p>
						) : null}
					</>
				) : null}

				{view.copied ? (
					<section className="shipit-seo-link-suggestions__copied" aria-labelledby={id("copied")}>
						<h4 id={id("copied")}>Copied link</h4>
						<p role="status">
							<strong>{checked === null ? "URL copied, link not checked." : checked.proven ? "Saved link found." : "Saved link not confirmed. See the check result below."}</strong>
						</p>
						<p className="shipit-seo-link-suggestions__url">{view.copied.url}</p>
						<p>
							{"Destination: "}
							<span lang={view.copied.submission.request.suggestion.target.locale}>{view.copied.submission.request.suggestion.target.title}</span>
						</p>
						<SavedParagraph anchor={view.copied.submission.request.suggestion.anchor} locale={view.copied.submission.request.owner.source.locale} />
						<ol className="shipit-seo-link-suggestions__steps">
							<li>
								{"In the editor, select the marked text "}
								<q lang={view.copied.submission.request.owner.source.locale}>{view.copied.submission.request.suggestion.anchor.text}</q>
								{" in this paragraph."}
							</li>
							<li>Choose <strong>Insert Link</strong>, then paste the URL into <strong>Search or type a URL</strong>.</li>
							<li>Choose <strong>Apply</strong>, then save the entry.</li>
							<li>Choose <strong>Check saved link</strong>.</li>
						</ol>
						<div className="shipit-seo-link-suggestions__actions">
							<Button type="button" variant="secondary" loading={view.checking !== null} disabled={!can.check} onClick={() => void check()}>
								Check saved link
							</Button>
						</div>
						{checkFailureText ? <p className="shipit-seo-form-error" role="alert">{checkFailureText}</p> : null}
						{checked ? (
							<p className={checked.proven ? "shipit-seo-link-suggestions__proven" : "shipit-seo-muted"} role="status">{checked.message}</p>
						) : null}
					</section>
				) : null}
			</div>
		</details>
	);
}
