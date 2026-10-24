import {
	INDEXNOW_HISTORY_PAGE_SIZE,
	INDEXNOW_MANUAL_URL_LIMIT as CONTRACT_MANUAL_URL_LIMIT,
	type IndexNowSettingsField,
	type IndexNowSettingsValues,
	type IndexNowSubmissionCounts,
	type IndexNowSubmissionSource,
	type IndexNowSubmissionStatus,
	type SeoAdminIndexNowContentTypeRule,
	type SeoAdminIndexNowDelivery,
	type SeoAdminIndexNowHistoryPage,
	type SeoAdminIndexNowHistoryResult,
	type SeoAdminIndexNowSubmission,
	type SeoAdminIndexNowStatus,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

export const INDEXNOW_MANUAL_URL_LIMIT = CONTRACT_MANUAL_URL_LIMIT;
export const INDEXNOW_MANUAL_TEXT_LIMIT = INDEXNOW_MANUAL_URL_LIMIT * 2_050;

export function indexNowSetupCopy(status: {
	setup: Pick<SeoAdminIndexNowStatus["setup"], "installation" | "keyRoute" | "keySaved">;
	values: Pick<IndexNowSettingsValues, "keyLocation">;
}) {
	const defaultLocation = status.values.keyLocation === "/indexnow-key.txt";
	const existingFile = defaultLocation && status.setup.keyRoute === "existing";
	const reuseKey = existingFile && status.setup.installation === "astro" && !status.setup.keySaved;
	return {
		description: !defaultLocation
			? "Enable IndexNow checks your custom verification file, then turns delivery on."
			: existingFile
				? reuseKey
					? "Enable IndexNow reuses the valid key in this site's file, checks it, then turns delivery on."
					: "Enable IndexNow checks the saved key against this site's file, then turns delivery on."
				: status.setup.keyRoute === "injected"
					? "Enable IndexNow creates and checks the public key file, then turns delivery on. No copying or pasting."
					: "Enable IndexNow prepares the key, checks its public file, then turns delivery on.",
		keyTitle: status.setup.keySaved ? "Use the saved key" : reuseKey ? "Use the site's key" : "Create a key",
		keyDescription: status.setup.keySaved
			? "Saved for this site. Delivery stays off until the check passes."
			: reuseKey
				? "A valid key in the site's existing file is reused automatically."
				: "Created automatically when you turn IndexNow on.",
		fileDescription: !defaultLocation
			? "Read the custom verification file at its public address."
			: existingFile
				? "Read the site's existing verification file at its public address."
				: status.setup.keyRoute === "injected"
					? "Read the file served by this plugin at your public site address."
					: "Read from your site address to confirm the site is yours.",
	};
}

export function indexNowKeyLocationHelp(
	keyRoute: SeoAdminIndexNowStatus["setup"]["keyRoute"],
	keyLocation: string,
): string {
	if (keyLocation.trim() && keyLocation !== "/indexnow-key.txt") {
		return "This custom file must serve the saved key as plain text. The plugin does not replace it.";
	}
	if (keyRoute === "injected") return "The plugin serves the saved key at /indexnow-key.txt. No file upload is needed.";
	if (keyRoute === "existing") return "The site owns /indexnow-key.txt. Its contents must match the saved key; the plugin does not replace this file.";
	if (keyRoute === "unavailable") return "This installation cannot serve /indexnow-key.txt. Check its public site address and root path.";
	return "The public file must serve the saved key. Check its location before enabling IndexNow.";
}

export type IndexNowUrlIssueReason = "format" | "other-site" | "too-long";

export interface IndexNowUrlIssue {
	line: number;
	text: string;
	reason: IndexNowUrlIssueReason;
}

export interface IndexNowUrlList {
	urls: string[];
	duplicates: number;
	/** Lines left out of the submission and kept for correction. */
	invalid: IndexNowUrlIssue[];
	/** A problem with the whole list; nothing can be submitted. */
	error: string | null;
}

/** Accepts complete URLs and root-relative paths on this site, one per line. */
export function parseIndexNowUrlList(input: string, siteOrigin: string | null): IndexNowUrlList {
	const empty = { urls: [], duplicates: 0, invalid: [] };
	if (!input.trim()) return { ...empty, error: null };
	if (input.length > INDEXNOW_MANUAL_TEXT_LIMIT)
		return { ...empty, error: "The URL list is too large. Submit it in smaller groups." };
	const lines = input.split(/\r\n|\n|\r/);
	if (lines.filter((line) => line.trim()).length > INDEXNOW_MANUAL_URL_LIMIT)
		return { ...empty, error: `Submit up to ${INDEXNOW_MANUAL_URL_LIMIT.toLocaleString("en")} URLs at a time.` };
	let origin: URL;
	try { origin = new URL(siteOrigin ?? ""); }
	catch { return { ...empty, error: "URLs can be submitted once this site's public address is set up." }; }
	const urls = new Set<string>();
	const invalid: IndexNowUrlIssue[] = [];
	let duplicates = 0;
	for (const [index, line] of lines.entries()) {
		const text = line.trim();
		if (!text) continue;
		let reason: IndexNowUrlIssueReason | null = null;
		let href = "";
		try {
			if (/[\s\\\u0000-\u001f\u007f]/.test(text) || text.startsWith("//") ||
				(!text.startsWith("/") && !/^https?:\/\//i.test(text))) throw new Error();
			const url = new URL(text, origin);
			if (url.username || url.password) throw new Error();
			url.hash = "";
			href = url.href;
			if (url.host !== origin.host || url.protocol !== origin.protocol) reason = "other-site";
			else if (text.length > 2_048 || href.length > 2_048) reason = "too-long";
		} catch {
			reason = "format";
		}
		if (reason) invalid.push({ line: index + 1, text, reason });
		else if (urls.has(href)) duplicates += 1;
		else urls.add(href);
	}
	return { urls: [...urls], duplicates, invalid, error: null };
}

const ISSUE_TEXT: Record<IndexNowUrlIssueReason, string> = {
	format: "not a complete URL or a path starting with /",
	"other-site": "not on this site",
	"too-long": "longer than 2,048 characters",
};

export function indexNowUrlIssueSummary(invalid: readonly IndexNowUrlIssue[]): string | null {
	if (!invalid.length) return null;
	const shown = invalid.slice(0, 5).map((issue) => `Line ${issue.line}: ${ISSUE_TEXT[issue.reason]}`);
	return `${shown.join(". ")}${invalid.length > 5 ? `. And ${invalid.length - 5} more` : ""}.`;
}

/** After a submission, keep exactly the lines that still need correction. */
export function remainingIndexNowUrlList(
	current: string,
	submitted: string,
	result: { success: boolean; rejected?: string[] },
	invalid: readonly IndexNowUrlIssue[] = [],
): string {
	if (current !== submitted || !result.success) return current;
	return [...invalid.map((issue) => issue.text), ...(result.rejected ?? [])].join("\n");
}

export function indexNowSubmissionSummary(
	result: {
		enqueued: number; skipped: number; rejected: string[]; contentTypeNoindexUrls?: string[];
		history?: "recorded" | "partial" | "unavailable";
	},
	options: { invalid?: number; waiting?: number; background?: boolean } = {},
): string {
	const urls = (count: number) => `${count} ${count === 1 ? "URL" : "URLs"}`;
	const kept = result.rejected.length + (options.invalid ?? 0);
	const ruled = result.contentTypeNoindexUrls?.length ?? 0;
	return `${urls(result.enqueued)} queued.` +
		(ruled ? ` ${urls(ruled)} not submitted because ${ruled === 1 ? "its address matches" : "their addresses match"} a content type with a noindex rule in Indexing rules.` : "") +
		(result.skipped ? ` ${urls(result.skipped)} skipped because ${result.skipped === 1 ? "it was" : "they were"} submitted recently.` : "") +
		(kept ? ` ${urls(kept)} kept in the list for correction.` : "") +
		(options.waiting ? options.background
			? ` ${urls(options.waiting)} wait for the next batch.`
			: ` ${urls(options.waiting)} wait. Use Send waiting URLs to send them.` : "") +
		(result.history === "unavailable"
			? " Submission history is unavailable on this site."
			: result.history === "partial"
				? " Submission history could not be fully recorded."
				: " Each request appears in Submission history.");
}

export interface IndexNowSettingsSnapshot {
	values: IndexNowSettingsValues;
	updatedAt: string | null;
}

export interface IndexNowDraftState {
	values: IndexNowSettingsValues;
	baseUpdatedAt: string | null;
}

/** Fields edited in Advanced settings; the content type scope has its own draft. */
export const INDEXNOW_ADVANCED_FIELDS = [
	"apiKey", "keyLocation", "batchSize", "minIntervalSeconds", "maxAttempts",
] as const satisfies readonly IndexNowSettingsField[];
export const INDEXNOW_SCOPE_FIELDS = ["autoSubmitContentTypes"] as const satisfies readonly IndexNowSettingsField[];

export function unavailableIndexNowSelectedTypes(
	selected: readonly string[] | null,
	available: readonly { collection: string }[],
): string[] {
	if (selected === null) return [];
	const names = new Set(available.map((item) => item.collection));
	return selected.filter((collection) => !names.has(collection));
}

/** Null (every eligible type), an empty list and an explicit list are different selections. */
export function equalIndexNowScope(left: readonly string[] | null, right: readonly string[] | null): boolean {
	if (left === null || right === null) return left === right;
	const items = new Set(left);
	return items.size === new Set(right).size && right.every((item) => items.has(item));
}

export function indexNowScopeIncludes(scope: readonly string[] | null, collection: string): boolean {
	return scope === null || scope.includes(collection);
}

/** Changing one box turns an all-eligible selection into the explicit list shown. */
export function toggleIndexNowScope(
	scope: readonly string[] | null,
	collection: string,
	checked: boolean,
	available: readonly string[],
): string[] {
	const base = scope === null ? [...available] : [...scope];
	return checked
		? [...new Set([...base, collection])]
		: base.filter((item) => item !== collection);
}

export function eligibleIndexNowScope(scope: readonly string[] | null, available: readonly string[]): string[] {
	return available.filter((collection) => indexNowScopeIncludes(scope, collection));
}

/** Types automatic submission can use: listed and without a content type noindex rule. */
export function submittableIndexNowTypes(
	available: readonly string[],
	rules: readonly Pick<SeoAdminIndexNowContentTypeRule, "collection">[] | undefined,
): string[] {
	const ruled = new Set(rules?.map((rule) => rule.collection) ?? []);
	return available.filter((collection) => !ruled.has(collection));
}

/** Shown with the manual list while a rule applies; null without one. */
export function indexNowContentTypeRuleNote(rules: readonly SeoAdminIndexNowContentTypeRule[] | undefined): string | null {
	if (!rules?.length) return null;
	const named = rules.map((rule) => `${rule.label} (${rule.urlPattern})`).join(", ");
	return `URLs whose address matches a content type with a noindex rule in Indexing rules are not submitted: ${named}.`;
}

export interface IndexNowScopeRow {
	collection: string;
	label: string;
	checked: boolean;
	/** `saved`: checked and saved; `unsaved`: differs from what automatic submission uses. */
	state: "saved" | "unsaved" | null;
	/** A content type noindex rule keeps this type out of submission; the choice stays stored. */
	noindexRule: boolean;
}

export function indexNowScopeRows(
	available: readonly { collection: string; label: string }[],
	saved: readonly string[] | null,
	draft: readonly string[] | null,
	rules?: readonly Pick<SeoAdminIndexNowContentTypeRule, "collection">[],
): IndexNowScopeRow[] {
	const ruled = new Set(rules?.map((rule) => rule.collection) ?? []);
	return available.map((item) => {
		const checked = indexNowScopeIncludes(draft, item.collection);
		const savedChecked = indexNowScopeIncludes(saved, item.collection);
		return {
			collection: item.collection,
			label: item.label,
			checked,
			state: checked !== savedChecked ? "unsaved" : checked ? "saved" : null,
			noindexRule: ruled.has(item.collection),
		};
	});
}

function sameFields(
	left: IndexNowSettingsValues,
	right: IndexNowSettingsValues,
	fields: readonly IndexNowSettingsField[],
): boolean {
	return fields.every((field) => field === "autoSubmitContentTypes"
		? equalIndexNowScope(left.autoSubmitContentTypes, right.autoSubmitContentTypes)
		: left[field] === right[field]);
}

/**
 * Reconciles a draft that edits only `fields` with a newer server snapshot. A
 * clean draft follows the server; a dirty one is rebased only when the server
 * left its fields unchanged, so a stale base still fails the save as a conflict.
 */
export function reconcileIndexNowFieldDraft(
	current: IndexNowDraftState | null,
	previous: IndexNowSettingsSnapshot | null,
	next: IndexNowSettingsSnapshot,
	fields: readonly IndexNowSettingsField[],
): IndexNowDraftState {
	if (!current || (previous && sameFields(current.values, previous.values, fields)) ||
		sameFields(current.values, next.values, fields))
		return { values: { ...next.values }, baseUpdatedAt: next.updatedAt };
	if (previous && current.baseUpdatedAt === previous.updatedAt && sameFields(previous.values, next.values, fields)) {
		const values: IndexNowSettingsValues = Object.assign(
			{ ...next.values },
			Object.fromEntries(fields.map((field) => [field, current.values[field]])),
		);
		return { values, baseUpdatedAt: next.updatedAt };
	}
	return current;
}

/** Responses can arrive out of order; only a newer settings revision replaces the shown one. */
export function isNewerIndexNowStatus(
	current: { updatedAt: string | null; generatedAt: string } | null,
	next: { updatedAt: string | null; generatedAt: string },
): boolean {
	if (!current) return true;
	const left = current.updatedAt ?? "";
	const right = next.updatedAt ?? "";
	return right !== left ? right > left : next.generatedAt >= current.generatedAt;
}

export interface IndexNowSettingsView<Status extends { values: IndexNowSettingsValues; updatedAt: string | null; generatedAt: string }> {
	status: Status | null;
	advanced: IndexNowDraftState | null;
	scope: IndexNowDraftState | null;
}

/**
 * Applies a status from any response. An older revision arriving late is
 * ignored, so neither draft nor its base revision moves backwards.
 */
export function receiveIndexNowStatus<Status extends { values: IndexNowSettingsValues; updatedAt: string | null; generatedAt: string }>(
	view: IndexNowSettingsView<Status>,
	next: Status,
): IndexNowSettingsView<Status> {
	if (!isNewerIndexNowStatus(view.status, next)) return view;
	return {
		status: next,
		advanced: reconcileIndexNowFieldDraft(view.advanced, view.status, next, INDEXNOW_ADVANCED_FIELDS),
		scope: reconcileIndexNowFieldDraft(view.scope, view.status, next, INDEXNOW_SCOPE_FIELDS),
	};
}

export function equalIndexNowSettings(
	left: IndexNowSettingsValues,
	right: IndexNowSettingsValues,
): boolean {
	return (
		left.enabled === right.enabled &&
		left.autoSubmit === right.autoSubmit &&
		(left.autoSubmitContentTypes === null
			? right.autoSubmitContentTypes === null
			: right.autoSubmitContentTypes !== null &&
				left.autoSubmitContentTypes.length === right.autoSubmitContentTypes.length &&
				left.autoSubmitContentTypes.every((item, index) => item === right.autoSubmitContentTypes?.[index])) &&
		left.apiKey === right.apiKey &&
		left.keyLocation === right.keyLocation &&
		left.batchSize === right.batchSize &&
		left.minIntervalSeconds === right.minIntervalSeconds &&
		left.maxAttempts === right.maxAttempts
	);
}

export function reconcileIndexNowDraft(
	current: IndexNowDraftState | null,
	previous: IndexNowSettingsSnapshot | null,
	next: IndexNowSettingsSnapshot | null,
): IndexNowDraftState | null {
	if (!next) return current;
	if (!current) {
		return {
			values: { ...next.values },
			baseUpdatedAt: next.updatedAt,
		};
	}
	if (previous && equalIndexNowSettings(current.values, previous.values)) {
		return {
			values: { ...next.values },
			baseUpdatedAt: next.updatedAt,
		};
	}
	if (equalIndexNowSettings(current.values, next.values)) {
		return { ...current, baseUpdatedAt: next.updatedAt };
	}
	return current;
}

export function reconcileGeneratedIndexNowDraft(
	current: IndexNowDraftState | null,
	requestDraft: IndexNowSettingsValues,
	next: IndexNowSettingsSnapshot,
): IndexNowDraftState {
	if (!current) {
		return {
			values: { ...next.values },
			baseUpdatedAt: next.updatedAt,
		};
	}
	return {
		values: {
			...current.values,
			apiKey: current.values.apiKey === requestDraft.apiKey
				? next.values.apiKey
				: current.values.apiKey,
		},
		baseUpdatedAt: next.updatedAt,
	};
}

export function reconcileSavedIndexNowDraft(
	current: IndexNowDraftState | null,
	submitted: IndexNowSettingsValues,
	next: IndexNowSettingsSnapshot,
): IndexNowDraftState {
	return {
		values:
			!current || equalIndexNowSettings(current.values, submitted)
				? { ...next.values }
				: current.values,
		baseUpdatedAt: next.updatedAt,
	};
}

export interface IndexNowHistoryRequest {
	id: number;
	cursor: string | null;
	status: IndexNowSubmissionStatus | null;
	source: IndexNowSubmissionSource | null;
	pageIndex: number;
}

/** History is separate from settings: its responses never touch a settings draft. */
export interface IndexNowHistoryState {
	requestId: number;
	status: IndexNowSubmissionStatus | null;
	source: IndexNowSubmissionSource | null;
	/** cursors[i] loads page i; the first page has no cursor. */
	cursors: Array<string | null>;
	pageIndex: number;
	page: SeoAdminIndexNowHistoryPage | null;
	loading: boolean;
	error: string | null;
}

export function initialIndexNowHistoryState(): IndexNowHistoryState {
	return { requestId: 0, status: null, source: null, cursors: [null], pageIndex: 0, page: null, loading: false, error: null };
}

export type IndexNowHistoryChange =
	| { kind: "reload" }
	| { kind: "filters"; status: IndexNowSubmissionStatus | null; source: IndexNowSubmissionSource | null }
	| { kind: "next" }
	| { kind: "previous" };

export function startIndexNowHistoryRequest(
	state: IndexNowHistoryState,
	change: IndexNowHistoryChange,
): { state: IndexNowHistoryState; request: IndexNowHistoryRequest } | null {
	let next = state;
	if (change.kind === "filters") {
		next = { ...state, status: change.status, source: change.source, cursors: [null], pageIndex: 0 };
	} else if (change.kind === "next") {
		const cursor = state.page?.cursor ?? null;
		if (!cursor) return null;
		const cursors = state.cursors.slice(0, state.pageIndex + 1);
		cursors[state.pageIndex + 1] = cursor;
		next = { ...state, cursors, pageIndex: state.pageIndex + 1 };
	} else if (change.kind === "previous") {
		if (state.pageIndex === 0) return null;
		next = { ...state, pageIndex: state.pageIndex - 1 };
	}
	const request: IndexNowHistoryRequest = {
		id: state.requestId + 1,
		cursor: next.cursors[next.pageIndex] ?? null,
		status: next.status,
		source: next.source,
		pageIndex: next.pageIndex,
	};
	return { state: { ...next, requestId: request.id, loading: true, error: null }, request };
}

/** A response for anything but the latest request is ignored. */
export function finishIndexNowHistoryRequest(
	state: IndexNowHistoryState,
	request: IndexNowHistoryRequest,
	result: SeoAdminIndexNowHistoryResult | { success: false; error: "network"; detail: string },
): IndexNowHistoryState {
	if (request.id !== state.requestId) return state;
	if (result.success) return { ...state, page: result.history, loading: false, error: null };
	if (result.error === "invalid_cursor") {
		return { ...state, cursors: [null], pageIndex: 0, page: null, loading: false, error: result.detail };
	}
	return { ...state, loading: false, error: result.detail };
}

export function indexNowHistoryRange(state: IndexNowHistoryState): { from: number; to: number; total: number } | null {
	const page = state.page;
	if (!page || !page.items.length) return null;
	const from = state.pageIndex * page.pageSize + 1;
	return { from, to: from + page.items.length - 1, total: page.total };
}

export const INDEXNOW_HISTORY_DEFAULT_PAGE_SIZE = INDEXNOW_HISTORY_PAGE_SIZE;

const EVENT_LABELS: Record<string, string> = {
	publish: "Published",
	update: "Updated",
	unpublish: "Unpublished",
	delete: "Deleted",
	"url-change": "Address changed",
};

export function indexNowEventLabel(event: SeoAdminIndexNowSubmission["event"]): string {
	return event === null ? "Not set" : EVENT_LABELS[event] ?? "Not set";
}

export function indexNowSourceLabel(source: IndexNowSubmissionSource): string {
	return source === "manual" ? "Manual" : "Automatic";
}

export type IndexNowTone = "neutral" | "info" | "success" | "warning" | "error";

export interface IndexNowStatusPresentation {
	label: string;
	tone: IndexNowTone;
	detail: string | null;
}

export function indexNowSubmissionPresentation(
	entry: Pick<SeoAdminIndexNowSubmission, "status" | "attempts" | "nextAttemptAt" | "lastDetail" | "counts">,
	maxAttempts: number,
	formatTime: (value: string) => string,
): IndexNowStatusPresentation {
	const storedDetail = entry.lastDetail?.trim();
	const reason = storedDetail ? storedDetail.length > 500 ? storedDetail.slice(0, 497) + "..." : storedDetail : null;
	const explain = (summary: string | null) => [summary, reason].filter(Boolean).join(". ") || null;
	switch (entry.status) {
		case "queued":
			return { label: "Queued", tone: "neutral", detail: "Waiting for the next batch" };
		case "retry":
			return {
				label: "Retry scheduled",
				tone: "warning",
				detail: explain(`${entry.nextAttemptAt ? `Next attempt ${formatTime(entry.nextAttemptAt)}, ` : ""}attempt ${Math.min(entry.attempts + 1, maxAttempts)} of ${maxAttempts}`),
			};
		case "sent":
			return { label: "Sent", tone: "success", detail: null };
		case "accepted":
			return { label: "Accepted", tone: "info", detail: "Key validation pending" };
		case "failed":
			return {
				label: "Failed",
				tone: "error",
				detail: explain(entry.attempts >= maxAttempts ? `Stopped after ${entry.attempts} attempts` : null),
			};
		default:
			return { label: "Queued again", tone: "neutral", detail: "A later submission took over these URLs" };
	}
}

const BUCKET_LABELS: Array<[keyof IndexNowSubmissionCounts, string]> = [
	["queued", "waiting"],
	["retrying", "retrying"],
	["sent", "sent"],
	["accepted", "accepted"],
	["failed", "failed"],
	["skipped", "skipped as recent"],
	["superseded", "queued again later"],
];

/** Counts for a group, only when its URLs did not all end the same way. */
export function indexNowCountsSummary(entry: Pick<SeoAdminIndexNowSubmission, "counts" | "urlCount">): string | null {
	const parts = BUCKET_LABELS.filter(([bucket]) => entry.counts[bucket] > 0);
	if (parts.length < 2) return null;
	return parts.map(([bucket, label]) => `${entry.counts[bucket]} ${label}`).join(", ");
}

export function indexNowHttpResult(entry: Pick<SeoAdminIndexNowSubmission, "lastHttpStatus" | "lastAttemptAt">): string {
	if (entry.lastHttpStatus !== null) return String(entry.lastHttpStatus);
	return entry.lastAttemptAt ? "No response" : "None yet";
}

export function indexNowDisplayUrl(url: string, origin: string | null): string {
	try {
		const parsed = new URL(url);
		if (origin && parsed.origin === new URL(origin).origin) return `${parsed.pathname}${parsed.search}`;
	} catch {
		return url;
	}
	return url;
}

/** Delivery records written before history recorded source and event. */
export function legacyIndexNowDeliveries(
	deliveries: readonly SeoAdminIndexNowDelivery[],
	historyStartedAt: string | null,
): SeoAdminIndexNowDelivery[] {
	return historyStartedAt === null
		? [...deliveries]
		: deliveries.filter((delivery) => delivery.createdAt < historyStartedAt);
}
