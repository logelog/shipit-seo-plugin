import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Checkbox } from "@cloudflare/kumo/components/checkbox";
import { CodeBlock } from "@cloudflare/kumo/components/code";
import { Collapsible } from "@cloudflare/kumo/components/collapsible";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Input, InputArea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import {
	type ContentEditorPanelContext,
	type ContentItem,
	type ContentListColumnCellContext,
	type ContentSeoInput,
} from "@emdash-cms/admin";
import {
	ArrowSquareOut,
	ArrowsClockwise,
	CaretRight,
	ChartBar,
	Check,
	CheckCircle,
	Desktop,
	DeviceMobile,
	Eye,
	EyeSlash,
	FacebookLogo,
	Info,
	Lightbulb,
	LinkSimple,
	MagnifyingGlass,
	PencilSimple,
	Plus,
	Question,
	ShareNetwork,
	SlidersHorizontal,
	Star,
	Trash,
	TreeStructure,
	Warning,
	WarningCircle,
	X,
	XCircle,
	XLogo,
} from "@phosphor-icons/react";
import {
	SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT,
	SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH,
	SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH,
	SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH,
	SEO_SCORE_VERSION,
	ENTRY_SCHEMA_NAME_MAX_LENGTH,
	seoKeywordIdentity,
	validateEntrySchemaJson,
	type SeoAdminContentScore,
	type SeoAdminEntrySchemaGraph,
	type SeoAdminEntryPreview,
	type SeoAdminFocusKeywordOperationError,
	type SeoAdminRobotsDirectives,
	type SeoAdminSettingsValues,
	type SeoAdminSocialOverrideSaveResult,
	type SeoAdminSocialOverrideValues,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	QueryClientContext,
	QueryClientProvider,
	useIsFetching,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import * as React from "react";

import { SEO_WORKSPACE_URL } from "./api-routes.ts";
import { socialSaveNoticeMessage } from "./social-save-copy.ts";
import {
	beginSocialRecovery,
	beginSocialSave,
	canCloseSocialSave,
	canSaveSocialValues,
	closeSocialSave,
	normaliseSocialSaveValues,
	reviewSocialSaveValues,
	type SocialSaveState,
	type SocialSaveTarget,
} from "./social-save-state.ts";
import { createSocialEditorStore, type SocialEditorStore, type SocialOverrideDraftState } from "./social-editor-store.ts";
import { acquireSocialEditorOwner } from "./social-editor-owner.ts";
import { AssessmentProfileControl, collectionAnalysisProfileKey, useCollectionAnalysisProfile } from "./assessment-profile-control.tsx";
import { SearchPreview as ResolvedSearchPreview, SocialPreview as ResolvedSocialPreview } from "./search-social-preview.tsx";
import { buildSocialEditorPreview, type SocialEditorPreview } from "./social-editor-preview.ts";
import { legacyRecordGuidance, SavedMetadataReview } from "./saved-metadata-review.tsx";
import { SeoBrandProvider, useSeoBrand, useSeoHostBrand } from "./brand-context.ts";
import { NativeSeoHostProvider, useHostEntryRefresh, useNativeSeoEditor } from "./native-seo-editor.tsx";
import {
	NativeSeoImageField,
	NativeSeoRecoveryActions,
	NativeSeoSaveButton,
	NativeSeoSaveStatus,
	NativeSeoTextFields,
	nativeSeoCharacterCount,
	nativeSeoHasChanges,
	nativeSeoSaveOutstanding,
	type NativeSeoEditorController,
} from "./native-seo-editor-fields.tsx";
import { buildNativeSeoSearchPreview, buildNativeSeoSocialPreview } from "./native-seo-editor-preview.ts";
import {
	analyzeSavedSeoContent,
	auditSeoContent,
	fetchSeoAnalysisProfile,
	fetchSeoAdminEntryPreview,
	fetchSeoAdminEntrySocial,
	fetchSeoAdminSettings,
	fetchSeoContentScore,
	fetchSeoEntryAnalysisIdentity,
	fetchSeoEntryDirectives,
	fetchSeoEntryCustomSchemas,
	fetchSeoEntrySchemaPreview,
	removeSeoEntryCustomSchema,
	SavedContentChangedError,
	saveSeoAdminEntrySocial,
	saveSeoEntryCustomSchema,
	saveSeoEntryDirectives,
	saveSeoFocusKeywords,
} from "./api.ts";
import {
	buildSavedSearchPreviewModel,
	createCancellableDebounce,
	DIALOG_TABBABLE_SELECTOR,
	dialogTabWrapTarget,
	entryRef,
	analysisPresentation,
	contentCheckPresentation,
	localeGraphDiagnosticLabel,
	hasCurrentEditorAnalysis,
	keywordCheckCoverage,
	searchExclusionCheck,
	selectEditorScore,
	SEO_CHECK_BASIS_LABELS,
	readAfterMountConfirmed,
	resolveCheckFixTarget,
	retainEntryPreview,
	resolveSeoDraftIndexability,
	editorScoreStateCopy,
	editorManualAnalysisState,
	savedAnalysisNotice,
	savedAnalysisRequestFailureNotice,
	storedScoreSummary,
	validateSeoCanonicalDraft,
	type SeoCheckEvidenceBasis,
	type SeoCheckGroupId,
	type SeoContentCheckGroup,
	type SeoContentCheck,
	type RetainedEntryPreview,
	type SeoEditorDraftSnapshot,
	type SeoSavedAnalysisNotice,
} from "./content-extension-model.ts";
import {
	SEO_OWNERSHIP_REASON_LABELS,
	buildSeoAdminSearch,
	isPermissionDenied,
	resolveSeoOwnershipNotice,
	seoOwnershipFieldViews,
	seoOwnershipSummary,
	type SeoOwnershipNotice,
	type SeoOwnershipRetention,
} from "./content-extension-model.ts";
import { contentExtensionQueryClient, entrySchemaPanelStoreFor } from "./content-extension-session.ts";
import { contentScoreColumnPresentation, contentScorePageQueryOptions, visibleContentScoreRefs } from "./content-score-column.ts";
import {
	ENTRY_SCHEMA_DEADLINES,
	ENTRY_SCHEMA_DENIED_MESSAGE,
	ENTRY_SCHEMA_SOURCE_LABELS,
	acquireEntrySchemaOperation,
	addEntrySchemaEditor,
	canCloseEntrySchemaEditor,
	classifyEntrySchemaRequestError,
	createEntrySchemaOpeningController,
	entrySchemaEditorDetached,
	entrySchemaConfirmationDetached,
	entrySchemaEditorCanSave,
	entrySchemaInUseRows,
	entrySchemaNotAddedRows,
	entrySchemaPlaceholderPaths as jsonLdPlaceholderPaths,
	entrySchemaOutputState,
	entrySchemaPanelLocked,
	entrySchemaRemovalRequest,
	firstEntrySchemaErrorField,
	newEntrySchemaId,
	otherEmittedEntrySchemaGraphs,
	withEntrySchemaDeadline,
	type EntrySchemaDraft,
	type EntrySchemaInUseRow,
	type EntrySchemaRowSource,
} from "./entry-schema-model.ts";
import { EntrySchemaAuthoringControls } from "./entry-schema-authoring-controls.tsx";
import {
	createEntrySchemaAuthoring,
	decodeEntrySchemaAuthoring,
	encodeEntrySchemaAuthoring,
	entrySchemaAuthoringErrors,
} from "./entry-schema-authoring.ts";
import { savedSnapshotMatches, type SavedContentSnapshot } from "./saved-content-snapshot.ts";
import {
	EntrySchemaCandidatePreview,
	EntrySchemaTemplatePicker,
	entrySchemaCandidateStoreFor,
} from "./entry-schema-library-controls.tsx";
import {
	createEditorSessionAnalysis,
	editorSavedVersion,
	editorSessionScoreForSavedVersion,
	type EditorSessionAnalysisState,
} from "./editor-session-analysis.ts";
import {
	createSavedAnalysisReadback,
	savedAnalysisReadbackWarning,
	verifiedSavedAnalysisForTarget,
	type SavedAnalysisReadbackState,
} from "./saved-analysis-readback.ts";
import { InternalLinkSuggestions } from "./internal-link-suggestions.tsx";
import {
	classifyProfileSaveFailure,
	deriveProfileSaveState,
	keywordStatementFromScore,
	keywordStatementsMatch,
	normaliseKeywordChip,
	normaliseKeywordChips,
	profileSaveErrorFromRoute,
	scoreMatchesProfile,
	type SeoKeywordStatement,
	type SeoProfileSaveState,
} from "./keyword-profile.ts";

import { seoScoreDisplay } from "../analysis.ts";
import { seoKeywordMatchRanges } from "../keyword-match.ts";
import { seoSnippetDatePrefix } from "../snippet-fit.ts";
import { SEO_EARLIER_ANALYZER_LABEL, seoCheckTotalsText, type SeoCheckRow, type SeoCheckRowKind } from "../check-presentation.ts";
import {
	resolveEditorBasicAnalysis,
	resolveEditorBasicKeywordOwnership,
	type EditorBasicAnalysis,
} from "./editor-basic-analysis.ts";

const SCORE_QUERY_SCOPE = "shipit-seo-content-scores";
const KEYWORD_AUTOSAVE_DELAY_MS = 800;

interface ContentEditorPanelDraft {
	data: Readonly<Record<string, unknown>>;
	slug: string;
	seo?: ContentSeoInput;
	isDirty: boolean;
}

interface ContentEditorPanelActions {
	updateField(name: string, value: unknown): void;
	updateSlug(value: string): void;
	updateSeo?: (seo: ContentSeoInput) => Promise<void>;
}

interface ShipitContentEditorPanelContext extends ContentEditorPanelContext {
	draft?: ContentEditorPanelDraft;
	actions?: ContentEditorPanelActions;
}

function entryQueryKey(ref: string, revision?: string | null) {
	return [SCORE_QUERY_SCOPE, "entry", ref, revision ?? null] as const;
}

function previewQueryKey(ref: string, revision: string | null, locale: string | null) {
	return [SCORE_QUERY_SCOPE, "preview", ref, revision, locale] as const;
}

function ScorePill({ score }: { score: SeoAdminContentScore }) {
	const { tone, stale, freshness, badgeText, description } = contentScoreColumnPresentation(score);
	return (
		<span
			className="shipit-seo-native-score"
			role="img"
			data-tone={tone}
			data-freshness={freshness}
			title={description}
			aria-label={description}
		>
			{stale ? <ArrowsClockwise aria-hidden="true" size={12} /> : <span aria-hidden="true" />}
			{badgeText}
		</span>
	);
}

function ScorePlaceholder({ state }: { state: "loading" | "missing" | "error" }) {
	const labels = {
		loading: "Loading SEO score",
		missing: "Not analyzed",
		error: "SEO score unavailable",
	};
	return (
		<span
			className="shipit-seo-native-score"
			role="img"
			data-tone="pending"
			title={labels[state]}
			aria-label={labels[state]}
		>
			<span aria-hidden="true" />
			{state === "loading" ? "..." : "--"}
		</span>
	);
}

function SeoScoreCell({ collection, locale, item, visibleItems }: ContentListColumnCellContext) {
	const refs = React.useMemo(
		() => visibleContentScoreRefs(collection, item, visibleItems),
		[collection, item.id, visibleItems],
	);
	const scores = useQuery(contentScorePageQueryOptions(collection, refs, locale));

	if (scores.isPending) return <ScorePlaceholder state="loading" />;
	if (scores.isError) return <ScorePlaceholder state="error" />;
	const score = scores.data.get(entryRef(collection, item.id));
	return score ? <ScorePill score={score} /> : <ScorePlaceholder state="missing" />;
}

export function SeoScoreCellRoot(context: ContentListColumnCellContext) {
	return (
		<QueryClientProvider client={contentExtensionQueryClient}>
			<SeoScoreCell {...context} />
		</QueryClientProvider>
	);
}

interface SeoAnalysisDisclosureProps {
	score: SeoAdminContentScore | null;
	unavailableContent?: React.ReactNode;
	advancedNotice?: React.ReactNode;
	keywordEditorVisible?: boolean;
	keywordCoverageConfirmed?: boolean;
	keywordProfile?: { status: "loading" | "unavailable" | "ready"; known: boolean; onRetry: () => void };
	/**
	 * Lays out the panel's own analysis area around the one checklist, which is
	 * null while no source exists, and the session check section, which is null
	 * without a result to recheck.
	 */
	renderLocalAnalysis?: (onFix: CheckFixHandler, checklist: React.ReactNode, sessionCheck: React.ReactNode) => React.ReactNode;
	/** The explicit saved-entry analysis control and its outcome, shown with the score. */
	headerAction?: React.ReactNode;
	headerNotice?: React.ReactNode;
	analysisHelp?: string | null;
	basicAnalysis?: Extract<EditorBasicAnalysis, { state: "ready" | "partial" }>;
	/** The browser checks shown are the last ones while their inputs are read again. */
	analysisUpdating?: boolean;
	/** No checks are shown yet because their inputs are still being read. */
	analysisLoading?: boolean;
	localKeywordsPending?: boolean;
	onChooseCheckProfile?: () => void;
	preview: SeoAdminEntryPreview | null;
	/** The saved entry the host passed to the panel, offered to the native SEO draft as a newer guard. */
	savedEntry?: ContentItem | null;
	savedSnapshot?: SavedContentSnapshot | null;
	locale?: string | null;
	siteSettings: SeoAdminSettingsValues | null;
	previewLoading: boolean;
	previewError: boolean;
	previewObservation?: SocialPreviewObservation;
	workspaceUrl: string;
	refreshing: boolean;
	sessionDisabled?: boolean;
	refreshError: boolean;
	/** Why the last refresh did not produce a current result, when known. */
	refreshErrorMessage?: string | null;
	/** A shown stored score is known to be out of date, not merely unconfirmed. */
	storedOutOfDate?: boolean;
	keywordsValue: readonly string[];
	keywordsInherited: boolean;
	keywordInputValue: string;
	keywordSaveState: SeoProfileSaveState;
	onKeywordRetry: () => void;
	pillar: boolean;
	onPillarChange: (value: boolean) => void;
	directives: { robots: SeoAdminRobotsDirectives } | null;
	directivesLoading: boolean;
	directivesLoadError: boolean;
	directivesSaving: boolean;
	directivesError: boolean;
	onDirectivesSave: (change: SeoRobotsDirectiveChange) => void;
	onDirectivesRetry: () => void;
	onPreviewRetry: () => void;
	onRefresh: () => void;
	onKeywordInputChange: (value: string) => void;
	onKeywordAdd: () => void;
	onKeywordRemove: (index: number) => void;
	onKeywordPromote: (index: number) => void;
	onSocialSave: SocialSaveHandler;
	socialEditor: SocialEditorController;
	editorActions?: ContentEditorPanelActions;
	editorDraft?: SeoEditorDraftSnapshot;
}

type EditorPanelView = "analysis" | "advanced";
type PreviewDevice = "desktop" | "mobile";
type SnippetDialogView = "general" | "social" | "schema";

type SocialSaveHandler = (
	ref: string,
	values: SeoAdminSocialOverrideValues & { expectedRevision: string | null },
) => Promise<SeoAdminSocialOverrideSaveResult>;

/** The retained Social controller for this panel's form and target, or null for component-local state. */
const SocialEditorOwnerContext = React.createContext<SocialEditorStore | null>(null);

/**
 * Resolves the retained Social controller from the committed root's enclosing
 * form. The panel waits one layout pass for that node, so no view starts with
 * a provisional controller it would later abandon.
 */
function useSocialEditorOwner(target: SocialSaveTarget | null) {
	// The host admin's client, read outside Shipit's private provider.
	const hostClient = React.useContext(QueryClientContext);
	const client = hostClient === contentExtensionQueryClient ? undefined : hostClient;
	const probe = React.useRef<HTMLSpanElement>(null);
	const form = React.useRef<HTMLFormElement | null | undefined>(undefined);
	const [resolved, setResolved] = React.useState<{ key: string; store: SocialEditorStore | null } | null>(null);
	const [revocations, setRevocations] = React.useState(0);
	const key = target ? JSON.stringify([target.ref, target.locale]) : null;
	React.useLayoutEffect(() => {
		if (!target || key === null) return;
		if (form.current === undefined) {
			const candidate = probe.current?.closest("form");
			form.current = candidate instanceof HTMLFormElement && candidate.ownerDocument === probe.current?.ownerDocument ? candidate : null;
		}
		const lease = form.current && client
			? acquireSocialEditorOwner({ form: form.current, client, target, onRevoke: () => setRevocations((value) => value + 1) })
			: null;
		setResolved({ key, store: lease?.store ?? null });
		return () => lease?.release();
	}, [client, key, revocations]);
	return { pending: key !== null && resolved?.key !== key, probe, store: resolved?.key === key ? resolved.store : null };
}

function useSocialEditor(owned: SocialEditorStore | null, ref: string, locale: string | null) {
	const retained = owned !== null && owned.live() && owned.target.ref === ref && owned.target.locale === locale ? owned : null;
	const local = React.useRef<SocialEditorStore | null>(null);
	if (!retained && !local.current?.live()) local.current = createSocialEditorStore({ ref, locale }, { disposeWhenReleased: true });
	const store = retained ?? local.current!;
	const { state, draft } = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	React.useEffect(() => store.retain(), [store]);
	return {
		state, draft, retained: retained !== null,
		stateRef: store.stateRef, draftRef: store.draftRef,
		previewOwnerRef: store.previewOwnerRef, previewEpochRef: store.previewEpochRef,
		setDraft: store.setDraft, installState: store.installState, updateState: store.updateState,
		observeEditing: store.observeEditing, settle: store.settle,
	};
}

type SocialEditorController = ReturnType<typeof useSocialEditor>;

interface SocialPreviewObservation {
	target: SocialSaveState["target"];
	owner: symbol;
	canonicalEpoch: number;
}

/** Request from the panel strip to open the snippet dialog on a given tab. */
interface SnippetDialogRequest {
	view: SnippetDialogView;
	/** Select saved-value guidance without claiming a host field can be focused. */
	reviewField?: SnippetDraftField;
	ref: string;
	locale: string | null;
	nonce: number;
}

const SNIPPET_DIALOG_VIEWS: readonly SnippetDialogView[] = ["general", "social", "schema"];
function normaliseKeywordDraft(value: string) {
	return normaliseKeywordChip(value);
}

function focusKeywordErrorMessage(error: SeoAdminFocusKeywordOperationError): string {
	if (error === "keyword_too_long")
		return `Use ${SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH} characters or fewer.`;
	if (error === "too_many_keywords")
		return `Use no more than ${SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT} focus keywords.`;
	if (error === "not_found") return "This content entry no longer exists.";
	if (error === "storage_unavailable") return "Keyword storage is unavailable.";
	return "The focus keyword could not be saved.";
}

type KeywordCoverageAnalysis = Parameters<typeof keywordCheckCoverage>[2];

interface FocusKeywordEditorProps {
	idPrefix: string;
	contentLabel: string;
	keywords: readonly string[];
	/** True when the chips are inherited content metadata, not saved profile data. */
	inherited: boolean;
	inputValue: string;
	saveState: SeoProfileSaveState;
	onRetry: () => void;
	pillar: boolean;
	onPillarChange: (value: boolean) => void;
	/** The checks shown below; chips read their coverage from the same rows. */
	coverageAnalysis: KeywordCoverageAnalysis;
	onInputChange: (value: string) => void;
	onAdd: () => void;
	onRemove: (index: number) => void;
	onPromote: (index: number) => void;
}

const FocusKeywordEditor = React.memo(function FocusKeywordEditor({
	idPrefix,
	contentLabel,
	keywords,
	inherited,
	inputValue,
	saveState,
	onRetry,
	pillar,
	onPillarChange,
	coverageAnalysis,
	onInputChange,
	onAdd,
	onRemove,
	onPromote,
}: FocusKeywordEditorProps) {
	const candidate = normaliseKeywordDraft(inputValue);
	const unmatchable = Boolean(candidate) && !seoKeywordIdentity(candidate);
	const duplicate = !unmatchable && keywords.some(
		(keyword) => seoKeywordIdentity(keyword) === seoKeywordIdentity(candidate),
	);
	const atLimit = keywords.length >= SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT;
	const canAdd = Boolean(candidate) && !unmatchable && !duplicate && !atLimit;

	return (
		<section
			className="shipit-seo-native-panel__keyword"
			aria-labelledby={`${idPrefix}-focus-keywords-label`}
		>
			<div className="shipit-seo-native-panel__keyword-heading">
				<label id={`${idPrefix}-focus-keywords-label`} htmlFor={`${idPrefix}-focus-keyword`}>
					Focus keywords
				</label>
				<span aria-label={`${keywords.length} of 5 focus keywords configured`}>
					{keywords.length}/5
				</span>
			</div>
			<div
				className="shipit-seo-native-panel__keyword-field"
				data-empty={keywords.length === 0 || undefined}
				onClick={(event) => {
					if (event.target instanceof HTMLElement && event.target.closest("button")) {
						return;
					}
					document.getElementById(`${idPrefix}-focus-keyword`)?.focus();
				}}
			>
				{keywords.map((keyword, index) => {
					const coverage = keywordCheckCoverage(keyword, index === 0 ? "primary" : "secondary", coverageAnalysis);
					const role = index === 0 ? "Primary keyword" : "Secondary keyword";
					const inheritedNote = inherited
						? " Inherited from content metadata and not saved in the SEO profile yet. Any keyword edit saves the list explicitly."
						: "";
					return (
						<span
							key={`${keyword}-${index}`}
							className="shipit-seo-native-panel__keyword-chip"
							data-primary={index === 0 || undefined}
							data-inherited={inherited || undefined}
							data-tone={coverage?.tone ?? undefined}
							aria-label={
								`${role}: ${keyword}` +
								(inherited ? ", inherited from content metadata" : "") +
								(coverage ? `, ${coverage.label}` : "")
							}
							title={
								`${role}${inherited ? ". Inherited" : ""}` +
								(coverage ? `. ${coverage.label}` : "") +
								inheritedNote
							}
						>
							<span className="shipit-seo-native-panel__keyword-chip-label">{keyword}</span>
							{inherited ? (
								<span className="shipit-seo-native-panel__keyword-chip-inherited">Inherited</span>
							) : null}
							{coverage?.count ? (
								<span className="shipit-seo-native-panel__keyword-chip-count" aria-hidden="true">
									{coverage.count}
								</span>
							) : null}
							{index > 0 ? (
								<button
									type="button"
									onClick={() => onPromote(index)}
									aria-label={`Set ${keyword} as the primary keyword`}
									title="Make primary"
								>
									<Star size={11} aria-hidden="true" />
								</button>
							) : (
								<Star size={11} weight="fill" aria-hidden="true" />
							)}
							<button
								type="button"
								onClick={() => onRemove(index)}
								aria-label={`Remove keyword ${keyword}`}
								title="Remove keyword"
							>
								<X size={11} aria-hidden="true" />
							</button>
						</span>
					);
				})}
				<input
					id={`${idPrefix}-focus-keyword`}
					value={inputValue}
					maxLength={SEO_ADMIN_FOCUS_KEYWORD_MAX_LENGTH}
					placeholder={
						atLimit
							? "Keyword limit reached"
							: keywords.length
								? "Add another…"
								: "Add focus keyword…"
					}
					autoComplete="off"
					disabled={atLimit}
					onChange={(event) => onInputChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Backspace" && !inputValue && keywords.length) {
							event.preventDefault();
							onRemove(keywords.length - 1);
							return;
						}
						if (event.key !== "Enter") return;
						event.preventDefault();
						if (canAdd) onAdd();
					}}
				/>
			</div>
			{unmatchable || duplicate || atLimit || inherited ? (
				<p className="shipit-seo-native-panel__keyword-help">
					{unmatchable
						? "Use letters or numbers. Symbols alone cannot be found in the text."
						: duplicate
							? "This keyword is already in the list."
							: atLimit
								? "Keyword limit reached. Remove one to add another."
								: "This keyword comes from existing content metadata. Editing the list saves it to the SEO profile; removing it keeps analysis keyword-free."}
				</p>
			) : null}
			<label className="shipit-seo-native-panel__pillar">
				<input
					type="checkbox"
					checked={pillar}
					onChange={(event) => onPillarChange(event.target.checked)}
				/>
				<span
					className="shipit-seo-native-panel__pillar-box"
					data-checked={pillar || undefined}
					aria-hidden="true"
				>
					{pillar ? <Check size={10} aria-hidden="true" /> : null}
				</span>
				<span>This {contentLabel.toLocaleLowerCase()} is pillar content</span>
				<Question size={13} aria-hidden="true" />
				<span className="shipit-seo-visually-hidden">
					Mark this as a main reference page for its topic.
				</span>
			</label>
			{saveState.status !== "clean" ? (
				<p
					className="shipit-seo-native-panel__keyword-status"
					role="status"
					data-state={saveState.status}
				>
					{saveState.status === "pending" ? (
						"Unsaved changes"
					) : saveState.status === "saving" ? (
						"Saving…"
					) : saveState.status === "saved" ? (
						"Saved"
					) : (
						<>
							<span>{saveState.failure.message}</span>
							<button
								type="button"
								className="shipit-seo-native-panel__keyword-retry"
								onClick={onRetry}
							>
								Retry
							</button>
						</>
					)}
				</p>
			) : null}
		</section>
	);
});

function sourceLabel(value: string) {
	return value
		.split("-")
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function checkFieldLabel(check: SeoContentCheck): string | null {
	const source = check.evidence.source.toLowerCase();
	if (source.includes("seo.title")) return "SEO Title";
	if (source.includes("seo.description")) return "Meta Description";
	if (source.includes("seo.image")) return "OG Image";
	if (source.includes("seo.noindex") || source.includes("robots"))
		return "Indexing directive";
	if (source.includes("seo.canonical") || source.includes("public route")) return "Canonical URL";
	if (["content", "readability", "links", "images"].includes(check.category)) return "Content";
	return null;
}

type SnippetDraftField = "title" | "slug" | "description";

function SearchSnippetFrame({
	preview,
	device,
	locale,
	resultPage = false,
	descriptionDisplay = "compact",
	lastLoaded = false,
	updating = false,
	nativeEditor,
	keyword = "",
	indexingNote = true,
}: {
	preview: SeoAdminEntryPreview;
	device: PreviewDevice;
	locale?: string | null;
	resultPage?: boolean;
	descriptionDisplay?: "compact" | "full" | "external";
	lastLoaded?: boolean;
	/** The panel is reading a newer saved entry for this preview. */
	updating?: boolean;
	nativeEditor?: NativeSeoEditorController;
	/** False where the Excluded from search banner already states the directive. */
	indexingNote?: boolean;
	/** The primary focus keyword; its whole-phrase matches are bold in the description. */
	keyword?: string;
}) {
	const datePrefix = seoSnippetDatePrefix(preview.search.publishedAt, locale);
	const savedModel = buildSavedSearchPreviewModel(preview, device, datePrefix);
	const model = nativeEditor ? buildNativeSeoSearchPreview(savedModel, preview, nativeEditor.state,
		nativeEditor.allowedFields ?? [], datePrefix) : savedModel;
	return (
		<div className="shipit-seo-native-preview-model">
			{!preview.indexable && indexingNote ? (
				<p className="shipit-seo-native-preview-model__noindex">
					<EyeSlash size={14} aria-hidden="true" />
					<span>Noindex is on. Search engines are asked not to show this page.</span>
				</p>
			) : null}
			<ResolvedSearchPreview model={model} presentation={resultPage ? "result-page" : "native"}
				descriptionDisplay={descriptionDisplay} lastLoaded={lastLoaded} updating={updating || nativeEditor?.previewUpdating}
				descriptionEmphasis={keyword ? seoKeywordMatchRanges(model.fittedDescription.displayText, keyword) : undefined} />
		</div>
	);
}

/**
 * Full results-page context around the snippet (design: toggled through the
 * device buttons in the dialog header). Purely presentational chrome.
 */
function SerpContext({
	device,
	query,
	children,
}: {
	device: PreviewDevice;
	query: string;
	children: React.ReactNode;
}) {
	return (
		<div className="shipit-seo-serp-context" data-device={device}>
			<div className="shipit-seo-serp-context__bar">
				<MagnifyingGlass size={15} aria-hidden="true" />
				<span>{query || "Search"}</span>
			</div>
			<div className="shipit-seo-serp-context__tabs" aria-hidden="true">
				<span data-active="true">All</span>
				<span>Images</span>
				<span>Videos</span>
				<span>News</span>
				<span>Maps</span>
				<span>More</span>
			</div>
			<p className="shipit-seo-serp-context__stats">
				Approximate preview. Google may display different text.
			</p>
			{children}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Per-entry schema management (dialog Schema tab)
// ---------------------------------------------------------------------------

const ENTRY_SCHEMA_CATALOG: ReadonlyArray<{
	key: string;
	label: string;
	type: string;
	stub: Record<string, unknown>;
}> = [
	{
		key: "book",
		label: "Book",
		type: "Book",
		stub: {
			"@context": "https://schema.org",
			"@type": "Book",
			name: "",
			author: { "@type": "Person", name: "" },
		},
	},
	{
		key: "course",
		label: "Course",
		type: "Course",
		stub: {
			"@context": "https://schema.org",
			"@type": "Course",
			name: "",
			description: "",
			provider: { "@type": "Organization", name: "" },
		},
	},
	{
		key: "dataset",
		label: "Dataset",
		type: "Dataset",
		stub: {
			"@context": "https://schema.org",
			"@type": "Dataset",
			name: "",
			description: "",
		},
	},
	{
		key: "event",
		label: "Event",
		type: "Event",
		stub: {
			"@context": "https://schema.org",
			"@type": "Event",
			name: "",
			startDate: "",
			location: { "@type": "Place", name: "" },
		},
	},
	{
		key: "fact-check",
		label: "FactCheck",
		type: "ClaimReview",
		stub: {
			"@context": "https://schema.org",
			"@type": "ClaimReview",
			claimReviewed: "",
			reviewRating: { "@type": "Rating", ratingValue: "5", bestRating: "5" },
		},
	},
	{
		key: "faq",
		label: "FAQ",
		type: "FAQPage",
		stub: {
			"@context": "https://schema.org",
			"@type": "FAQPage",
			mainEntity: [
				{
					"@type": "Question",
					name: "",
					acceptedAnswer: { "@type": "Answer", text: "" },
				},
			],
		},
	},
	{
		key: "how-to",
		label: "HowTo",
		type: "HowTo",
		stub: {
			"@context": "https://schema.org",
			"@type": "HowTo",
			name: "",
			step: [{ "@type": "HowToStep", name: "", text: "" }],
		},
	},
	{
		key: "job-posting",
		label: "Job Posting",
		type: "JobPosting",
		stub: {
			"@context": "https://schema.org",
			"@type": "JobPosting",
			title: "",
			datePosted: "",
			hiringOrganization: { "@type": "Organization", name: "" },
		},
	},
	{
		key: "movie",
		label: "Movie",
		type: "Movie",
		stub: {
			"@context": "https://schema.org",
			"@type": "Movie",
			name: "",
			director: { "@type": "Person", name: "" },
		},
	},
	{
		key: "music",
		label: "Music",
		type: "MusicRecording",
		stub: {
			"@context": "https://schema.org",
			"@type": "MusicRecording",
			name: "",
			byArtist: { "@type": "MusicGroup", name: "" },
		},
	},
	{
		key: "person",
		label: "Person",
		type: "Person",
		stub: {
			"@context": "https://schema.org",
			"@type": "Person",
			name: "",
			jobTitle: "",
		},
	},
	{
		key: "product",
		label: "Product",
		type: "Product",
		stub: {
			"@context": "https://schema.org",
			"@type": "Product",
			name: "",
			offers: {
				"@type": "Offer",
				price: "",
				priceCurrency: "",
				availability: "",
			},
		},
	},
	{
		key: "recipe",
		label: "Recipe",
		type: "Recipe",
		stub: {
			"@context": "https://schema.org",
			"@type": "Recipe",
			name: "",
			recipeIngredient: [],
			recipeInstructions: [],
		},
	},
	{
		key: "restaurant",
		label: "Restaurant",
		type: "Restaurant",
		stub: {
			"@context": "https://schema.org",
			"@type": "Restaurant",
			name: "",
			servesCuisine: "",
			address: { "@type": "PostalAddress", addressLocality: "" },
		},
	},
	{
		key: "service",
		label: "Service",
		type: "Service",
		stub: {
			"@context": "https://schema.org",
			"@type": "Service",
			name: "",
			provider: { "@type": "Organization", name: "" },
		},
	},
	{
		key: "software",
		label: "Software Application",
		type: "SoftwareApplication",
		stub: {
			"@context": "https://schema.org",
			"@type": "SoftwareApplication",
			name: "",
			applicationCategory: "",
		},
	},
];

const STARTER_ITEMS = [
	{ value: "none", label: "Empty" },
	...ENTRY_SCHEMA_CATALOG.map((item) => ({ value: item.key, label: item.label })),
];

const SOURCE_BADGES: Readonly<Record<EntrySchemaRowSource, { variant: "info" | "secondary" | "outline" | "neutral"; appearance?: "dot" }>> = {
	entry: { variant: "info" },
	"content-type": { variant: "secondary" },
	shared: { variant: "outline" },
	site: { variant: "neutral" },
};

function schemaSuppressionLabel(row: SeoAdminEntrySchemaGraph): string | null {
	if (row.emitted) return null;
	if (row.suppressedReason === "disabled") return "Disabled for this entry";
	if (row.suppressedReason === "entity-conflict") {
		return row.conflictId
			? `Not published: duplicate entity ${row.conflictId}`
			: "Not published: duplicate entity";
	}
	if (row.suppressedReason === "duplicate-definition") {
		return "Not published: graph defines the same entity twice";
	}
	if (row.suppressedReason === "duplicate-contribution") {
		return "Not published: contribution ID is already in use";
	}
	return "Not published: invalid JSON-LD";
}

function entrySchemaSavedSnapshot(preview: SeoAdminEntryPreview, snapshot: SavedContentSnapshot | null | undefined, locale: string | null): SavedContentSnapshot | null {
	return snapshot && savedSnapshotMatches({ ...preview, ref: preview.content.ref }, snapshot) &&
		preview.ownership?.sourceVersion === snapshot.sourceVersion && preview.ownership.locale === locale
		? snapshot : null;
}

function EntrySchemaManager({ preview, savedSnapshot, locale = null, onPreviewRetry }: {
	preview: SeoAdminEntryPreview;
	savedSnapshot?: SavedContentSnapshot | null;
	locale?: string | null;
	onPreviewRetry?: () => void;
}) {
	const queryClient = useQueryClient();
	const ref = preview.content.ref;
	const entry = { collection: preview.content.collection, entryId: preview.content.entryId };
	const listKey = ["shipit-seo-entry-custom-schemas", entry.collection, entry.entryId] as const;
	const fieldIds = React.useId();
	const store = entrySchemaPanelStoreFor(ref);
	const candidates = entrySchemaCandidateStoreFor(ref);
	const state = React.useSyncExternalStore(store.subscribe, store.get, store.get);
	const dispatch = store.dispatch;
	const { editor, fieldErrors, notice, unconfirmed, confirming, pending } = state;
	const [expandedId, setExpandedId] = React.useState<string | null>(null);
	const [starter, setStarter] = React.useState("");
	const nameRef = React.useRef<HTMLInputElement>(null);
	const jsonRef = React.useRef<HTMLTextAreaElement>(null);
	const currentOutputRef = React.useRef<HTMLDetailsElement>(null);
	const enabledRef = React.useRef<HTMLButtonElement>(null);
	const addRef = React.useRef<HTMLButtonElement>(null);
	const noticeRef = React.useRef<HTMLDivElement>(null);
	const recoveryRef = React.useRef<HTMLDivElement>(null);
	const cancelRemoveRef = React.useRef<HTMLButtonElement>(null);
	const hadEditor = React.useRef(false);
	const hadConfirmation = React.useRef(false);

	const listQuery = useQuery({
		queryKey: listKey,
		queryFn: ({ signal }) => fetchSeoEntryCustomSchemas(entry, { signal }),
		staleTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const confirmedSnapshot = entrySchemaSavedSnapshot(preview, savedSnapshot, locale);
	const graphsQuery = useQuery({
		queryKey: ["shipit-seo-entry-schema-graphs", ref, confirmedSnapshot?.sourceVersion ?? null, locale],
		queryFn: async ({ signal }) => {
			if (!confirmedSnapshot) throw new Error("The saved entry is not confirmed.");
			const result = await fetchSeoEntrySchemaPreview(ref, { signal, snapshot: confirmedSnapshot, savedVersion: confirmedSnapshot.sourceVersion, locale });
			if (!result.success) {
				throw new Error("Resolved schema could not be loaded.");
			}
			return { items: result.items, sourceVersion: confirmedSnapshot.sourceVersion, locale };
		},
		enabled: confirmedSnapshot !== null,
		staleTime: 0,
		refetchOnMount: "always",
		retry: 1,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	// Shares the panel's directives cache: preset toggles persist through the
	// same per-entry record that stores the robots directives.
	const directivesQuery = useQuery({
		queryKey: [SCORE_QUERY_SCOPE, "directives", ref],
		queryFn: async ({ signal }) => {
			const result = await fetchSeoEntryDirectives(ref, { signal });
			if (!result.success) {
				throw new Error("Robots directives could not be loaded.");
			}
			return result.item;
		},
		staleTime: 300_000,
		retry: 1,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const confirmationDetached = listQuery.data?.success ? entrySchemaConfirmationDetached(state, listQuery.data.items) : false;
	const openingLocale = listQuery.data?.success ? listQuery.data.entry.locale : undefined;
	const openingController = React.useMemo(() => createEntrySchemaOpeningController(store), [store, ref, openingLocale]);
	React.useLayoutEffect(() => () => openingController.cancel(), [openingController]);
	const refreshSchemaState = () => {
		void queryClient.invalidateQueries({ queryKey: listKey });
		void queryClient.invalidateQueries({ queryKey: ["shipit-seo-entry-schema-graphs", ref] });
		void queryClient.invalidateQueries({ queryKey: [SCORE_QUERY_SCOPE, "preview", ref] });
		void queryClient.invalidateQueries({ queryKey: [SCORE_QUERY_SCOPE, "entry", ref] });
	};
	// A default switch save refreshes the preview, the list and the graphs. Until they settle the panel
	// keeps the read it showed, so its open section and the focused switch stay in place.
	const [switchRefresh, setSwitchRefresh] = React.useState<{ presetKey: string; disabled: boolean } | null>(null);
	const [defaultsOpen, setDefaultsOpen] = React.useState(false);
	const previewRefreshing = useIsFetching({ queryKey: [SCORE_QUERY_SCOPE, "preview", ref] }) > 0;
	const listedRead = listQuery.data?.success ? listQuery.data : null;
	const shownRead = React.useRef<{ listed: NonNullable<typeof listedRead>; graphs: NonNullable<typeof graphsQuery.data>["items"] } | null>(null);
	const presetToggle = useMutation({
		onMutate: (input: { presetKey: string; disabled: boolean }) => { setSwitchRefresh(input); },
		onError: () => { setSwitchRefresh(null); },
		mutationFn: async (input: { presetKey: string; disabled: boolean }) => {
			// The record is written without a revision, so the list is rebuilt from
			// a read taken now; the cached read can predate another admin's change.
			const read = await fetchSeoEntryDirectives(ref);
			if (!read.success) {
				throw new Error("The schema toggle could not be saved.");
			}
			const current = new Set(read.item?.disabledPresets ?? []);
			if (input.disabled) current.add(input.presetKey);
			else current.delete(input.presetKey);
			const result = await saveSeoEntryDirectives(ref, undefined, {
				disabledPresets: [...current],
			});
			if (!result.success) {
				throw new Error("The schema toggle could not be saved.");
			}
			return result;
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [SCORE_QUERY_SCOPE, "directives", ref],
				exact: true,
			});
			refreshSchemaState();
		},
	});

	const switchSettling = switchRefresh !== null && shownRead.current !== null &&
		(presetToggle.isPending || previewRefreshing || listQuery.isFetching || graphsQuery.isFetching || directivesQuery.isFetching) &&
		!listQuery.isError && !graphsQuery.isError && !directivesQuery.isError;
	React.useEffect(() => {
		if (switchRefresh && !switchSettling) setSwitchRefresh(null);
	}, [switchRefresh, switchSettling]);
	React.useEffect(() => {
		if (notice && notice.kind !== "info") noticeRef.current?.focus();
	}, [notice]);
	React.useEffect(() => {
		if (unconfirmed) recoveryRef.current?.focus();
	}, [unconfirmed]);
	React.useEffect(() => {
		if (confirming) cancelRemoveRef.current?.focus();
		// The confirmation unmounts with its buttons; keep focus inside the panel.
		else if (hadConfirmation.current && !unconfirmed) addRef.current?.focus();
		hadConfirmation.current = confirming !== null;
	}, [confirming, unconfirmed, confirmationDetached]);
	React.useEffect(() => {
		const first = firstEntrySchemaErrorField(fieldErrors);
		if (first) (first === "name" ? nameRef : first === "json" ? jsonRef : enabledRef).current?.focus();
	}, [fieldErrors]);
	React.useEffect(() => {
		if (editor && !hadEditor.current) {
			setStarter("");
			nameRef.current?.focus();
		}
		if (!editor && hadEditor.current) addRef.current?.focus();
		hadEditor.current = editor !== null;
	}, [editor]);

	const graphReadCurrent = Boolean(confirmedSnapshot && graphsQuery.data?.sourceVersion === confirmedSnapshot.sourceVersion && graphsQuery.data.locale === locale && graphsQuery.isFetchedAfterMount && !graphsQuery.isError);
	if (!switchSettling && !confirmedSnapshot) return (
		<div className="shipit-seo-entry-schema__state" role="status">
			<p>Confirm the saved entry before reviewing its schema prediction. Your schema draft is kept.</p>
			<button type="button" disabled={!onPreviewRetry} onClick={onPreviewRetry}>Reload saved entry</button>
		</div>
	);
	if (!switchSettling && (listQuery.isPending || graphsQuery.isPending || graphsQuery.isFetching || directivesQuery.isPending)) {
		return (
			<p className="shipit-seo-entry-schema__state" role="status">
				Loading this entry's schema
			</p>
		);
	}
	if (!switchSettling && (listQuery.isError || !listedRead || graphsQuery.isError || directivesQuery.isError || !graphReadCurrent || listedRead.entry.locale !== locale)) {
		const message =
			listQuery.data && !listQuery.data.success
				? listQuery.data.message
				: classifyEntrySchemaRequestError(listQuery.error) === "denied"
					? ENTRY_SCHEMA_DENIED_MESSAGE
					: "This entry's schema could not be loaded. Nothing is shown rather than an incomplete list.";
		return (
			<div className="shipit-seo-entry-schema__state" role="alert">
				<span>{message}</span>
				<button
					type="button"
					onClick={() => {
						void listQuery.refetch();
						void graphsQuery.refetch();
						void directivesQuery.refetch();
					}}
				>
					Retry
				</button>
			</div>
		);
	}

	const held = switchSettling ? shownRead.current : null;
	const listed = held ? held.listed : listedRead!;
	const graphs = held ? held.graphs : graphsQuery.data?.items ?? [];
	if (!held) shownRead.current = { listed, graphs };
	const existingGraphs = otherEmittedEntrySchemaGraphs(graphs, editor?.id);
	const existingOutputTypes = [...new Set(existingGraphs.flatMap((graph) => graph.types))];
	const busy = pending !== null || state.opening !== null;
	const schemaLocale = listed.entry.locale;
	const published = listed.entry.status === "published";
	const draft = editor?.draft ?? null;
	const review = draft ? validateEntrySchemaJson(draft.json) : null;
	const emptyPaths = review?.ok ? jsonLdPlaceholderPaths(draft?.json ?? "") : [];
	const authoringMode = editor?.authoringMode ?? "advanced";
	const decodedAuthoring = draft ? decodeEntrySchemaAuthoring(draft.json) : null;
	const rawEditing = authoringMode === "advanced" || (authoringMode === "guided" && !decodedAuthoring?.ok);
	const guidedReady = authoringMode !== "guided" || Boolean(decodedAuthoring?.ok && !Object.keys(entrySchemaAuthoringErrors(decodedAuthoring)).length);
	const canSave = entrySchemaEditorCanSave(editor) && !busy && !unconfirmed && !fieldErrors.json;
	const canPreviewSchema = Boolean(draft?.name.trim() && review?.ok) && authoringMode !== "choose" && guidedReady && !busy && !unconfirmed;
	const atLimit = listed.items.length >= listed.limits.perEntry;
	const locked = busy || entrySchemaPanelLocked(state);
	const canClose = canCloseEntrySchemaEditor(state) && !busy;

	const updateDraft = (patch: Partial<EntrySchemaDraft>) => dispatch({ type: "edit", patch });
	const candidateTarget = { collection: entry.collection, entryId: entry.entryId, locale: schemaLocale, savedVersion: preview.sourceVersion ?? null };
	const closeEditor = () => dispatch({ type: "close" });
	const openStoredSchema = (id: string, action: "edit" | "remove") =>
		openingController.open({ ...entry, locale: schemaLocale, id, action }, (signal) =>
			fetchSeoEntryCustomSchemas({ ...entry, locale: schemaLocale, inspectId: id }, { signal }));

	const save = async () => {
		const target = store.get().editor;
		if (!target || !canSave || !entrySchemaEditorCanSave(target)) return;
		if (!acquireEntrySchemaOperation(store, "save")) return;
		try {
			const result = await withEntrySchemaDeadline(
				(signal) =>
					saveSeoEntryCustomSchema(
						{
							...entry,
							locale: schemaLocale,
							id: target.id,
							expectedRevision: target.expectedRevision,
							name: target.draft.name,
							json: target.draft.json,
							enabled: target.draft.enabled,
						},
						{ signal },
					),
				ENTRY_SCHEMA_DEADLINES.writeMs,
			);
			dispatch({ type: "save-result", result });
			if (result.success || (result.error !== "invalid_values" && result.error !== "unconfirmed")) refreshSchemaState();
		} catch (error: unknown) {
			dispatch({ type: "save-error", failure: classifyEntrySchemaRequestError(error) });
		}
	};

	const remove = async () => {
		// The captured confirmation, not the row a later refresh may have replaced.
		const current = store.get();
		const target = current.confirming;
		const request = entrySchemaRemovalRequest(current);
		if (!target || !request) return;
		if (!acquireEntrySchemaOperation(store, "remove")) return;
		try {
			const result = await withEntrySchemaDeadline(
				(signal) => removeSeoEntryCustomSchema({ ...entry, locale: schemaLocale, ...request }, { signal }),
				ENTRY_SCHEMA_DEADLINES.writeMs,
			);
			dispatch({ type: "remove-result", target, result });
			if (result.success || result.error !== "unconfirmed") refreshSchemaState();
		} catch (error: unknown) {
			dispatch({ type: "remove-error", target, failure: classifyEntrySchemaRequestError(error) });
		}
	};

	const checkCurrentState = async () => {
		const current = store.get();
		const inspectId = current.unconfirmed?.action === "remove" ? current.unconfirmed.id : current.editor?.id;
		if (!current.unconfirmed || !inspectId) return;
		if (!acquireEntrySchemaOperation(store, "check")) return;
		try {
			// One exact versioned read: leaving this entry's list does not mean the row is gone.
			const fresh = await fetchSeoEntryCustomSchemas({ ...entry, inspectId });
			if (!fresh.success || !fresh.inspected) {
				dispatch({ type: "check-failed", message: fresh.success ? "The stored schema could not be inspected." : fresh.message });
				return;
			}
			dispatch({ type: "check-result", inspected: fresh.inspected });
			refreshSchemaState();
		} catch {
			dispatch({ type: "check-failed", message: "The current state could not be read." });
		}
	};

	const outputNote = !listed.outputEnabled
		? "Schema output is off in Feature controls, so nothing saved here is added to the page."
		: published
			? "This entry is published. Saving or removing a schema here changes its public page immediately."
			: "This entry is not published. Saved schemas reach the public page only after it is published.";
	const savingNote = `Saved with Save schema, separately from the entry: the editor's Save and Publish buttons do not save it.${!listed.outputEnabled
		? ""
		: published ? " This entry is published, so changes reach its public page immediately." : " Saved schemas reach the public page once this entry is published."}`;
	const bannerIcon = (variant: "default" | "alert" | "error") =>
		variant === "default" ? (
			<Info size={20} weight="fill" aria-hidden="true" />
		) : variant === "alert" ? (
			<Warning size={20} weight="fill" aria-hidden="true" />
		) : (
			<WarningCircle size={20} weight="fill" aria-hidden="true" />
		);

	const renderRecovery = () =>
		unconfirmed ? (
			<div ref={recoveryRef} tabIndex={-1} className="shipit-seo-entry-schema__status" role="alert">
				<Banner
					variant="alert"
					icon={bannerIcon("alert")}
					title={unconfirmed.action === "save" ? "Save not confirmed" : "Removal not confirmed"}
					description={unconfirmed.message}
					action={
						<Button type="button" size="sm" variant="secondary" loading={pending === "check"} disabled={busy} onClick={() => void checkCurrentState()}>
							Check current state
						</Button>
					}
				/>
			</div>
		) : null;

	const renderNotice = () => {
		if (!notice) return null;
		const variant = notice.kind === "info" ? "default" : notice.kind === "conflict" ? "alert" : "error";
		return (
			<div
				ref={noticeRef}
				tabIndex={-1}
				className="shipit-seo-entry-schema__status"
				role={notice.kind === "info" ? "status" : "alert"}
			>
				<Banner
					variant={variant}
					icon={bannerIcon(variant)}
					title={notice.kind === "conflict" ? "Changed elsewhere" : notice.message}
					description={notice.kind === "conflict" ? notice.message : undefined}
				/>
				{notice.kind === "conflict" && editor ? (
					notice.current ? (
						<>
							<p className="shipit-seo-entry-schema__context">Saved version</p>
							<CodeBlock lang="jsonc" code={notice.current.json} />
							<div className="shipit-seo-entry-schema__actions">
								<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => notice.current && dispatch({ type: "use-saved", current: notice.current })}>
									Use the saved version
								</Button>
								<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => notice.current && dispatch({ type: "keep-edits", current: notice.current })}>
									Keep my edits
								</Button>
							</div>
						</>
					) : (
						<div className="shipit-seo-entry-schema__actions">
							<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => dispatch({ type: "save-as-new", id: newEntrySchemaId() })}>
								Save as a new schema
							</Button>
						</div>
					)
				) : null}
			</div>
		);
	};

	const renderRemovalConfirmation = () => confirming ? (
		<div
			className="shipit-seo-entry-schema__status"
			role="group"
			aria-label={`Confirm removing ${confirming.name}`}
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.stopPropagation();
				if (!busy) dispatch({ type: "cancel-remove" });
			}}
		>
			<Banner
				variant="error"
				icon={bannerIcon("error")}
				title={`Remove “${confirming.name}” from this entry?`}
				description={`${published && listed.outputEnabled && confirming.enabled
					? "It leaves the public page immediately."
					: "It is not on the public page now."} This cannot be undone here.`}
			/>
			<div className="shipit-seo-entry-schema__actions">
				<Button type="button" size="sm" variant="destructive" loading={pending === "remove"} disabled={busy} onClick={() => void remove()}>
					Remove
				</Button>
				<Button ref={cancelRemoveRef} type="button" size="sm" variant="secondary" disabled={busy} onClick={() => dispatch({ type: "cancel-remove" })}>
					Cancel
				</Button>
			</div>
		</div>
	) : null;

	const renderForm = () => {
		if (!editor || !draft) return null;
		const nameError = fieldErrors.name;
		const jsonError = fieldErrors.json ?? (review && !review.ok && draft.json.trim() ? review.message : undefined);
		const emptyValuesError = !jsonError && emptyPaths.length
			? `Fill or remove empty values: ${emptyPaths.slice(0, 4).join(", ")}${emptyPaths.length > 4 ? ` and ${emptyPaths.length - 4} more` : ""}.`
			: undefined;
		const title = editor.mode === "add" ? "Add schema" : `Edit ${editor.original.name}`;
		return (
			<form
				className="shipit-seo-entry-schema__form"
				aria-label={title}
				onSubmit={(event) => {
					// A portal submit must not save the host content draft.
					event.preventDefault();
					event.stopPropagation();
					void save();
				}}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return;
					event.stopPropagation();
					if (canClose) closeEditor();
				}}
			>
				<h4 className="shipit-seo-entry-schema__form-title">{title}</h4>
				<EntrySchemaAuthoringControls
					json={draft.json}
					mode={authoringMode}
					disabled={busy || unconfirmed !== null}
					existingOutputTypes={existingOutputTypes}
					onShowExistingOutput={() => {
						const disclosure = currentOutputRef.current;
						if (!disclosure) return;
						disclosure.open = true;
						disclosure.querySelector("summary")?.focus();
					}}
					onModeChange={(mode) => dispatch({ type: "authoring", mode })}
					onChooseType={(type) => {
						const current = store.get().editor;
						if (!current) return;
						dispatch({
							type: "authoring", mode: "guided", json: createEntrySchemaAuthoring(type),
							...(current.draft.name.trim() ? {} : { name: `${type === "FAQPage" ? "FAQ" : type === "BlogPosting" ? "Blog post" : type}, ${preview.content.title}`.slice(0, ENTRY_SCHEMA_NAME_MAX_LENGTH) }),
						});
					}}
					onPatch={(patch) => {
						const current = store.get().editor;
						if (!current) return;
						const changed = encodeEntrySchemaAuthoring(current.draft.json, patch);
						if (changed.ok) updateDraft({ json: changed.json });
						else dispatch({ type: "authoring-error", message: changed.message });
					}}
				/>
				<details ref={currentOutputRef} className="shipit-seo-entry-schema__details">
					<summary>Current schema output</summary>
					<p className="shipit-seo-entry-schema__context">Prediction for the confirmed saved entry, including saved draft content and slug. Publication dates come from stored entry metadata and may change on publish. Theme and other plugin output are not inspected.</p>
					{existingGraphs.length ? existingGraphs.map((graph) => (
						<div key={graph.id} className="shipit-seo-entry-schema__code">
							<strong>{graph.name}</strong>
							<CodeBlock lang="jsonc" code={graph.graph === null ? "This schema resolves at render time." : JSON.stringify(graph.graph, null, 2)} />
						</div>
					)) : <p>No other saved graphs are predicted for this entry.</p>}
				</details>
				<EntrySchemaTemplatePicker store={store} disabled={busy || unconfirmed !== null} />
				{authoringMode !== "choose" ? <>
					<Input
						ref={nameRef}
						label="Schema name"
						description="Only shown in the admin."
						value={draft.name}
						maxLength={ENTRY_SCHEMA_NAME_MAX_LENGTH}
						error={nameError}
						disabled={busy || unconfirmed !== null}
						onChange={(event) => updateDraft({ name: event.target.value })}
					/>
					{rawEditing ? <>
						{editor.mode === "add" ? (
							<Select<string>
								label="JSON-LD starter"
								value={starter || "none"}
								items={STARTER_ITEMS}
								disabled={busy || unconfirmed !== null || Boolean(draft.json.trim())}
								description="Fills an empty JSON editor."
								onValueChange={(value) => {
									const choice = ENTRY_SCHEMA_CATALOG.find((item) => item.key === value);
									setStarter(choice ? choice.key : "");
									if (choice && !draft.json.trim()) updateDraft({ json: JSON.stringify(choice.stub, null, 2), ...(draft.name.trim() ? {} : { name: `${choice.label}, ${preview.content.title}`.slice(0, ENTRY_SCHEMA_NAME_MAX_LENGTH) }) });
								}}
							/>
						) : null}
						<InputArea
							ref={jsonRef}
							label="JSON-LD"
							className="shipit-seo-entry-schema__code-input"
							rows={10}
							value={draft.json}
							spellCheck={false}
							placeholder={'{"@context": "https://schema.org", "@type": "Article", "headline": "{{title}}"}'}
							error={jsonError ?? emptyValuesError}
							description={review?.ok && emptyPaths.length === 0 ? "Passes local syntax and data-safety checks." : "Describe content visible on this page."}
							disabled={busy || unconfirmed !== null}
							onChange={(event) => updateDraft({ json: event.target.value })}
						/>
						<Collapsible.Root className="shipit-seo-entry-schema__details">
							<Collapsible.DefaultTrigger>JSON-LD help</Collapsible.DefaultTrigger>
							<Collapsible.DefaultPanel><p className="shipit-seo-entry-schema__context">Use documented variables such as {"{{title}}"}, {"{{description}}"} and {"{{canonical}}"}. Syntax checks do not confirm a match with the visible page or eligibility for a search feature.</p></Collapsible.DefaultPanel>
						</Collapsible.Root>
					</> : jsonError ? <p className="shipit-seo-entry-schema__error" role="alert">{jsonError}</p> : null}
					<Checkbox
						ref={enabledRef}
						label="Include in page output"
						checked={draft.enabled}
						disabled={busy || unconfirmed !== null}
						onCheckedChange={(checked) => updateDraft({ enabled: checked === true })}
					/>
					{fieldErrors.enabled ? <p className="shipit-seo-entry-schema__error" role="alert">{fieldErrors.enabled}</p> : null}
					<p className="shipit-seo-entry-schema__context">{outputNote}</p>
					<EntrySchemaCandidatePreview
						panel={store}
						candidates={candidates}
						target={candidateTarget}
						canPreview={canPreviewSchema}
						actions={<>
							<Button type="submit" size="sm" variant="primary" loading={pending === "save"} disabled={!canSave}>Save schema</Button>
							<Button type="button" size="sm" variant="secondary" disabled={!canClose} aria-describedby={unconfirmed ? `${fieldIds}-cancel-note` : undefined} onClick={closeEditor}>Cancel</Button>
						</>}
					/>
					{unconfirmed ? <p id={`${fieldIds}-cancel-note`} className="shipit-seo-entry-schema__context">Check the current state before closing this form.</p> : null}
				</> : <Button type="button" size="sm" variant="secondary" disabled={!canClose} onClick={closeEditor}>Cancel</Button>}
			</form>
		);
	};

	const collectionLabel = preview.content.collectionLabel;
	const inUseRows = entrySchemaInUseRows({ items: listed.items, inherited: listed.inherited, graphs, collectionLabel, outputEnabled: listed.outputEnabled });
	const notAddedRows = entrySchemaNotAddedRows({ items: listed.items, inherited: listed.inherited, graphs, collectionLabel, outputEnabled: listed.outputEnabled, locale });
	const defaultRows = graphs.filter((row) => row.source === "preset");
	const switchBusy = presetToggle.isPending || directivesQuery.isFetching || switchSettling;
	const shownDisabled = (row: (typeof defaultRows)[number]) => switchRefresh && switchRefresh.presetKey === row.presetKey ? switchRefresh.disabled : row.disabled;
	const shownSuppression = (row: (typeof defaultRows)[number]) => switchRefresh && switchRefresh.presetKey === row.presetKey
		? switchRefresh.disabled ? "Disabled for this entry" : null : schemaSuppressionLabel(row);
	const manageHref = `${SEO_WORKSPACE_URL}?view=schema`;
	const reviewToggle = (row: SeoAdminEntrySchemaGraph, name: string) => {
		const expanded = expandedId === row.id;
		return (
			<Button
				type="button"
				size="sm"
				variant="ghost"
				shape="square"
				icon={expanded ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
				aria-label={`${expanded ? "Hide" : "Show"} JSON-LD for ${name}`}
				aria-expanded={expanded}
				onClick={() => setExpandedId(expanded ? null : row.id)}
			/>
		);
	};
	const resolvedReview = (row: SeoAdminEntrySchemaGraph, name: string) =>
		expandedId === row.id ? (
			<div className="shipit-seo-entry-schema__code" aria-label={`Resolved JSON-LD for ${name}`} role="group">
				<CodeBlock
					lang="jsonc"
					code={row.graph === null ? "This schema resolves at render time." : JSON.stringify(row.graph, null, 2)}
				/>
			</div>
		) : null;
	const sourceBadge = (source: EntrySchemaRowSource) => (
		<span className="shipit-seo-entry-schema__source"><Badge {...SOURCE_BADGES[source]}>{ENTRY_SCHEMA_SOURCE_LABELS[source]}</Badge></span>
	);
	const manageLink = (name: string, href: string) => (
		<a className="shipit-seo-entry-schema__manage" href={href} aria-label={`Manage in Schema: ${name}`}>
			Manage in Schema
			<ArrowSquareOut size={14} aria-hidden="true" />
		</a>
	);
	const renderInUseRow = (row: EntrySchemaInUseRow) => {
		const typeText = row.types.length === 1 && row.types[0] === row.name ? "" : row.types.join(", ") || "No type";
		const detail = typeText ? `${typeText}, ${row.scope.charAt(0).toLowerCase()}${row.scope.slice(1)}` : row.scope;
		const schema = row.schema;
		if (!schema) {
			return (
				<li key={row.key} data-source={row.source} data-expanded={expandedId === row.key || undefined}>
					<strong>
						{row.name}
						<small>{detail}</small>
						{row.note ? <small>{row.note}</small> : null}
					</strong>
					{sourceBadge(row.source)}
					<span className="shipit-seo-entry-schema__row-actions">
						{row.graph ? reviewToggle(row.graph, row.name) : null}
						{manageLink(row.name, row.source === "shared" ? `${manageHref}#custom-schema-title` : manageHref)}
					</span>
					{row.graph ? resolvedReview(row.graph, row.name) : null}
				</li>
			);
		}
		const outputState = entrySchemaOutputState(schema, {
			outputEnabled: listed.outputEnabled,
			entryStatus: listed.entry.status,
			graph: row.graph ?? undefined,
		});
		const editing = editor?.mode === "edit" && editor.id === schema.id;
		return (
			<li key={row.key} data-source="entry" data-invalid={!schema.valid || undefined}>
				<strong>
					{schema.name}
					<small>{detail}</small>
					<small className="shipit-seo-entry-schema__output" data-tone={outputState.tone}>
						{outputState.label}
					</small>
				</strong>
				{sourceBadge("entry")}
				<span className="shipit-seo-entry-schema__row-actions">
					{row.graph ? reviewToggle(row.graph, schema.name) : null}
					<Button
						type="button"
						size="sm"
						variant="ghost"
						shape="square"
						icon={<PencilSimple size={16} aria-hidden="true" />}
						aria-label={`Edit ${schema.name}`}
						disabled={locked}
						onClick={() => void openStoredSchema(schema.id, "edit")}
					/>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						shape="square"
						icon={<Trash size={16} aria-hidden="true" />}
						aria-label={`Remove ${schema.name}`}
						disabled={locked}
						onClick={() => void openStoredSchema(schema.id, "remove")}
					/>
				</span>
				{row.graph ? resolvedReview(row.graph, schema.name) : null}
				{confirming?.id === schema.id ? renderRemovalConfirmation() : null}
				{editing && !entrySchemaEditorDetached(state, listed.items) ? renderForm() : null}
			</li>
		);
	};
	const addButton = (
		<Button
			ref={addRef}
			type="button"
			size="sm"
			variant="primary"
			icon={<Plus size={14} aria-hidden="true" />}
			disabled={locked || atLimit}
			onClick={() => dispatch({ type: "open", editor: addEntrySchemaEditor() })}
		>
			Add schema
		</Button>
	);

	return (
		<div className="shipit-seo-entry-schema">
			<p className="shipit-seo-entry-schema__context">
				Structured data this plugin adds for this entry, predicted from the saved entry.
			</p>
			{!listed.outputEnabled ? (
				<Banner variant="alert" icon={bannerIcon("alert")} title="Schema output is off" description={outputNote} />
			) : null}
			{state.opening ? <p className="shipit-seo-entry-schema__state" role="status">Loading schema...</p> : null}
			{renderRecovery()}
			{renderNotice()}

			{inUseRows.length ? (
				<section className="shipit-seo-entry-schema__section" aria-labelledby={`${fieldIds}-in-use`}>
					<div className="shipit-seo-entry-schema__section-head">
						<div>
							<h3 id={`${fieldIds}-in-use`}>Schema in use</h3>
							<p className="shipit-seo-entry-schema__context">
								This preview covers this plugin's output only; EmDash, your theme or other plugins can add JSON-LD. Check the public page source for full output.
							</p>
						</div>
					</div>
					<ul className="shipit-seo-entry-schema__list">{inUseRows.map(renderInUseRow)}</ul>
				</section>
			) : null}
			{entrySchemaConfirmationDetached(state, listed.items) ? renderRemovalConfirmation() : null}

			<div className="shipit-seo-entry-schema__add">
				<div className="shipit-seo-entry-schema__actions">
					{addButton}
					{editor ? null : <EntrySchemaTemplatePicker store={store} disabled={locked || atLimit} />}
				</div>
				<p className="shipit-seo-entry-schema__context">{savingNote}</p>
				{atLimit ? (
					<p className="shipit-seo-entry-schema__context">
						This entry has the maximum of {listed.limits.perEntry} custom schemas. Remove one to add another.
					</p>
				) : null}
			</div>
			{entrySchemaEditorDetached(state, listed.items) ? renderForm() : null}

			{defaultRows.length || notAddedRows.length ? (
				<Collapsible.Root className="shipit-seo-entry-schema__details" open={defaultsOpen} onOpenChange={setDefaultsOpen}>
					<Collapsible.DefaultTrigger>Defaults for this entry ({defaultRows.length})</Collapsible.DefaultTrigger>
					<Collapsible.DefaultPanel>
						<div className="shipit-seo-entry-schema__disclosure">
							{defaultRows.length ? (
								<section aria-labelledby={`${fieldIds}-defaults`}>
									<h4 id={`${fieldIds}-defaults`}>Built-in defaults</h4>
									<p className="shipit-seo-entry-schema__context">
										Turn a default off for this entry only. Switches save immediately, separately from the schema form; EmDash's built-in graph may remain.
									</p>
									{switchSettling ? <p className="shipit-seo-entry-schema__context" role="status">Updating this entry's schema</p> : null}
									<ul className="shipit-seo-entry-schema__list">
										{defaultRows.map((row) => (
											<li
												key={row.id}
												data-disabled={shownDisabled(row) || undefined}
												data-suppressed={!row.emitted && !shownDisabled(row) && !(switchRefresh && switchRefresh.presetKey === row.presetKey) ? "true" : undefined}
											>
												<strong>
													{row.name}
													{row.replacesCore ? (
														<small>
															{row.presetKey === "webPage"
																? "Main graph from this content type's default"
																: shownDisabled(row) ? "Using EmDash's built-in graph" : "Enriches EmDash's built-in graph"}
														</small>
													) : null}
													{shownSuppression(row) ? <small>{shownSuppression(row)}</small> : null}
												</strong>
												<Switch
													aria-label={
														row.replacesCore && row.presetKey !== "webPage"
															? `${shownDisabled(row) ? "Enable" : "Disable"} the enriched ${row.name} graph for this entry (EmDash's built-in graph remains when disabled)`
															: `${shownDisabled(row) ? "Enable" : "Disable"} ${row.name} for this entry`
													}
													checked={!shownDisabled(row)}
													aria-disabled={switchBusy || undefined}
													onCheckedChange={(checked) => {
														// Busy switches stay focusable; a disabled one would drop keyboard focus to the page.
														if (switchBusy) return;
														presetToggle.mutate({
															presetKey: row.presetKey ?? "",
															disabled: !checked,
														});
													}}
												/>
											</li>
										))}
									</ul>
								</section>
							) : null}
							{notAddedRows.length ? (
								<section aria-labelledby={`${fieldIds}-not-added`}>
									<h4 id={`${fieldIds}-not-added`}>Shared schemas not added here</h4>
									<ul className="shipit-seo-entry-schema__list">
										{notAddedRows.map((row) => (
											<li key={row.key}>
												<strong>
													{row.name}
													<small>{row.scope}</small>
													<small>{row.reason}</small>
												</strong>
												{sourceBadge("shared")}
												<span className="shipit-seo-entry-schema__row-actions">{manageLink(row.name, `${manageHref}#custom-schema-title`)}</span>
											</li>
										))}
									</ul>
								</section>
							) : null}
							{presetToggle.isError ? (
								<p className="shipit-seo-entry-schema__error" role="alert">
									The schema toggle could not be saved. Try again.
								</p>
							) : null}
						</div>
					</Collapsible.DefaultPanel>
				</Collapsible.Root>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Search preview + the "Edit SEO" dialog
// ---------------------------------------------------------------------------

function snippetDialogDescription(view: SnippetDialogView, field: SnippetDraftField | null): string {
	if (view === "general" && field === "title") return "Edit this entry's SEO title and preview your changes.";
	if (view === "general" && field === "description") return "Edit this entry's meta description and preview your changes.";
	if (view === "general" && field === "slug") return "Review the saved slug or resolved URL used by the keyword check. The card URL may be canonical and differ from the checked slug.";
	return "Edit SEO and sharing metadata. Preview changes before saving.";
}

function SavedSnippetReviewNote({
	preview, field, previewError,
}: {
	preview: SeoAdminEntryPreview;
	field: SnippetDraftField | null;
	previewError?: boolean;
}) {
	return <SavedMetadataReview preview={preview} field={field} previewError={previewError} />;
}

function SearchPreview({
	preview,
	savedEntry,
	previewUpdating = false,
	exclusionBannerShown = false,
	savedSnapshot,
	locale,
	device,
	onDeviceChange,
	serpQuery,
	dialogRequest,
	onDialogClose,
	socialEditor,
	onSocialSave,
	previewError,
	previewObservation,
	onPreviewRetry,
}: {
	preview: SeoAdminEntryPreview;
	savedEntry?: ContentItem | null;
	/** A newer saved version is loading while this preview stays shown. */
	previewUpdating?: boolean;
	exclusionBannerShown?: boolean;
	savedSnapshot?: SavedContentSnapshot | null;
	locale?: string | null;
	siteSettings: SeoAdminSettingsValues | null;
	device: PreviewDevice;
	onDeviceChange: (device: PreviewDevice) => void;
	serpQuery: string;
	dialogRequest: SnippetDialogRequest | null;
	onDialogClose?: () => void;
	editorActions?: ContentEditorPanelActions;
	editorDraft?: SeoEditorDraftSnapshot;
	onSocialSave: SocialSaveHandler;
	socialEditor: SocialEditorController;
	previewError?: boolean;
	previewObservation?: SocialPreviewObservation;
	onPreviewRetry?: () => void;
}) {
	const brand = useSeoBrand();
	const [editing, setEditing] = React.useState(false);
	const previewContainerRef = React.useRef<HTMLElement>(null);
	const [dialogView, setDialogView] = React.useState<SnippetDialogView>("general");
	const [reviewField, setReviewField] = React.useState<SnippetDraftField | null>(null);
	const [serpContext, setSerpContext] = React.useState(false);
	const [platform, setPlatform] = React.useState<SocialPreviewPlatform>("facebook");
	const [imagePickerOpen, setImagePickerOpen] = React.useState(false);
	const [imagePickerError, setImagePickerError] = React.useState<string | null>(null);
	const nativeEditor = useNativeSeoEditor({ preview, locale: locale ?? null, open: editing, entry: savedEntry ?? undefined, onConfirmed: onPreviewRetry });
	const nativeBusy = Boolean(nativeEditor.state?.writePending || nativeEditor.state?.readback);
	const nativePhase = nativeEditor.state?.phase ?? null;
	const {
		state: socialState, stateRef: socialStateRef, draft: socialDraft,
		setDraft: setSocialDraft, draftRef: socialDraftRef, retained: socialRetained,
		installState: installSocialState, updateState: updateSocialState,
		observeEditing: observeSocialEditing, settle: settleSocial,
	} = socialEditor;
	const dialogTabId = React.useId();
	const dialogTabsRef = React.useRef<HTMLDivElement | null>(null);
	// Kumo Tabs passes no props to its list, so the dialog names it when the wrapper mounts. Each open
	// mounts the portal content without rendering this component again, so an effect here misses it.
	const nameDialogTabs = React.useCallback((node: HTMLDivElement | null) => {
		dialogTabsRef.current = node;
		node?.querySelector('[role="tablist"]')?.setAttribute("aria-label", "Edit SEO sections");
	}, []);
	const savedOverride = socialState.baseline?.override ?? null;
	const hasSavedOverride = Boolean(savedOverride);
	const currentDraft = socialDraft ?? { customizing: hasSavedOverride };
	const socialValues = normaliseSocialSaveValues(currentDraft.customizing ? {
		title: currentDraft.title ?? savedOverride?.title ?? "",
		description: currentDraft.description ?? savedOverride?.description ?? "",
	} : { title: "", description: "" });
	const socialDirty = Boolean(socialDraft && (
		socialValues.title !== (savedOverride?.title ?? "") ||
		socialValues.description !== (savedOverride?.description ?? "")
	));
	const socialBusy = !canCloseSocialSave(socialState);
	const socialLocked = !canSaveSocialValues(socialState);
	const saveNotice = socialSaveNoticeMessage(socialState.notice, Boolean(socialDraft && socialState.acknowledgedDraftIdentity));
	const savedSocialPreview = buildSocialEditorPreview({
		target: { ref: preview.content.ref, locale: locale ?? null },
		state: socialState,
		draft: socialDraft,
		loaded: previewObservation ? {
			target: previewObservation.target,
			preview,
			receivedAfterCanonicalChange: previewObservation.owner === socialEditor.previewOwnerRef.current &&
				previewObservation.canonicalEpoch === socialEditor.previewEpochRef.current,
		} : null,
		platform,
		previewError,
	});
	const socialPreview = buildNativeSeoSocialPreview(savedSocialPreview, nativeEditor.state,
		nativeEditor.allowedFields ?? [], { ref: preview.content.ref, locale: locale ?? null }, preview.social.fallbackImage);
	const updateSocialDraft = (patch: Partial<SocialOverrideDraftState>) => {
		const next = {
			...(socialDraftRef.current ?? { customizing: hasSavedOverride }),
			...patch,
		};
		setSocialDraft(next);
		updateSocialState({ type: "draft", draftIdentity: next });
	};
	React.useEffect(() => {
		setReviewField(null);
	}, [preview.content.ref, locale]);
	React.useEffect(() => {
		if (!dialogRequest || dialogRequest.ref !== preview.content.ref || dialogRequest.locale !== (locale ?? null)) return;
		setReviewField(dialogRequest.reviewField ?? null);
		setDialogView(dialogRequest.view);
		setEditing(true);
	}, [dialogRequest, preview.content.ref, locale]);
	React.useEffect(() => {
		observeSocialEditing(preview.social.editing);
	}, [observeSocialEditing, preview.social.editing]);
	const wasEditing = React.useRef(false);
	React.useEffect(() => {
		if (wasEditing.current && !editing) onDialogClose?.();
		wasEditing.current = editing;
	}, [editing, onDialogClose]);
	// A focused save control that disables or unmounts drops focus to the page body; it returns to the save status.
	// The browser moves focus off a disabled control only at its next rendering step, so the move happens in this
	// commit, before the body holds focus for a frame; the later pass covers a status that renders after it.
	const nativeSaveStep = `${nativePhase}:${nativeBusy}`;
	const previousSaveStep = React.useRef<string | null>(null);
	React.useLayoutEffect(() => {
		const previous = previousSaveStep.current;
		previousSaveStep.current = editing ? nativeSaveStep : null;
		if (!editing || previous === null || previous === nativeSaveStep) return;
		const restore = () => {
			const owner = previewContainerRef.current?.ownerDocument;
			const active = owner?.activeElement ?? null;
			if (!owner || (active && active !== owner.body && active.getAttribute("role") !== "dialog" && !active.matches(":disabled"))) return;
			const dialog = owner.querySelector<HTMLElement>(".shipit-seo-snippet-dialog");
			(dialog?.querySelector<HTMLElement>("[data-native-seo-status]") ??
				dialog?.querySelector<HTMLElement>("[data-dialog-footer] button:not(:disabled)"))?.focus();
		};
		restore();
		return afterPaint(restore);
	}, [editing, nativeSaveStep]);
	// A requested title or description takes focus from the autofocused tab once its field is editable.
	const focusRequested = dialogRequest?.nonce;
	const nativeFieldsReady = !nativeEditor.loading && Boolean(nativeEditor.state?.baseline);
	React.useEffect(() => {
		if (!editing || dialogView !== "general" || (reviewField !== "title" && reviewField !== "description")) return;
		return afterPaint(() => {
			const active = document.activeElement;
			if (active && active !== document.body && !active.closest("[data-dialog-view]")) return;
			document.querySelector<HTMLElement>(
				`.shipit-seo-snippet-dialog [data-native-seo-fields] [id$="-${reviewField}"]:not(:disabled)`,
			)?.focus();
		});
	}, [editing, dialogView, reviewField, focusRequested, nativeFieldsReady]);
	React.useEffect(() => {
		if (!editing) return;
		const wrapTab = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			const dialog = dialogTabsRef.current?.closest<HTMLElement>('[role="dialog"]');
			if (!dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) return;
			const tabbables = [...dialog.querySelectorAll<HTMLElement>(DIALOG_TABBABLE_SELECTOR)].filter((element) =>
				element.tabIndex >= 0 && !element.hasAttribute("data-base-ui-focus-guard") &&
				!element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0);
			const target = dialogTabWrapTarget(tabbables, document.activeElement, event.shiftKey);
			if (!target) return;
			event.preventDefault();
			target.focus();
		};
		// Capture runs before the dialog's own handlers; a nested picker dialog is outside this one.
		document.addEventListener("keydown", wrapTab, true);
		return () => document.removeEventListener("keydown", wrapTab, true);
	}, [editing]);
	const handleEditorOpenChange = (open: boolean) => {
		if (!open && (!canCloseSocialSave(socialStateRef.current) || nativeBusy)) return;
		setReviewField(null);
		// Edit snippet opens on General; the Social and Schema openers arrive as requests instead.
		if (open) setDialogView("general");
		if (!open) {
			const next = closeSocialSave(socialStateRef.current);
			installSocialState(next);
			if (!next.draftIdentity) setSocialDraft(null);
		}
		setEditing(open);
	};
	React.useEffect(() => {
		const sheet = previewContainerRef.current?.closest('nav[data-sidebar="sidebar"][data-mobile="true"]');
		if (!(sheet instanceof HTMLElement)) return;
		const keepSheetFocus = (event: FocusEvent) => {
			const destination = event.relatedTarget;
			if (!(destination instanceof Element)) return;
			if (!destination.closest('[role="dialog"]')?.classList.contains("shipit-seo-snippet-dialog")) return;
			// Focus entering this portaled dialog stays within the mobile settings workflow.
			event.stopPropagation();
		};
		sheet.addEventListener("focusout", keepSheetFocus, true);
		return () => sheet.removeEventListener("focusout", keepSheetFocus, true);
	}, []);
	const saveSocial = async () => {
		const submittedDraft = socialDraftRef.current;
		if (!submittedDraft || !socialDirty) return;
		const started = beginSocialSave(socialStateRef.current, { draftIdentity: submittedDraft, values: socialValues });
		installSocialState(started.state);
		if (!started.attempt) return;
		const attempt = started.attempt;
		try {
			const result = await onSocialSave(attempt.target.ref, { ...attempt.values, expectedRevision: attempt.expectedRevision });
			settleSocial({ type: "save-result", attempt, result });
		} catch {
			settleSocial({ type: "save-unconfirmed", attempt });
		}
	};
	const checkSavedSocial = async () => {
		const started = beginSocialRecovery(socialStateRef.current);
		installSocialState(started.state);
		if (!started.request) return;
		const request = started.request;
		try {
			const result = await fetchSeoAdminEntrySocial(request.target.ref);
			settleSocial({ type: "recovery-result", request, result });
		} catch {
			settleSocial({ type: "recovery-unavailable", request });
		}
	};
	// The sidebar is narrower than a desktop result, so it shows the phone fit; the dialog shows both devices.
	const snippet = <SearchSnippetFrame preview={preview} device="mobile" locale={locale} lastLoaded={previewError} updating={previewUpdating} keyword={serpQuery}
		indexingNote={!exclusionBannerShown} />;
	const nativeChanged = nativeSeoHasChanges(nativeEditor);
	// A confirmed save stays visible on the tab it was made from until the next edit.
	const nativeFooter = dialogView !== "schema" || nativeSeoSaveOutstanding(nativeEditor) || nativePhase === "confirmed";
	const previewRetryNotice = previewError ? (
		<div className="shipit-seo-search-preview-retry" role="alert">
			<WarningCircle size={16} aria-hidden="true" />
			<span>Resolved metadata could not be refreshed. The last loaded values are shown.</span>
			{onPreviewRetry ? <Button type="button" size="sm" variant="secondary" icon={ArrowsClockwise} onClick={onPreviewRetry}>Retry preview</Button> : null}
		</div>
	) : null;
	return (
		<section
			ref={previewContainerRef}
			className="shipit-seo-native-preview"
			data-device="mobile"
			aria-label="Search preview"
		>
			<div className="shipit-seo-native-preview__heading">
				<span>Search preview</span>
			</div>
			{snippet}
			{previewRetryNotice}
			{nativeEditor.restoredDraft && !editing ? (
				<p className="shipit-seo-native-preview__pending" role="status">
					<WarningCircle size={14} aria-hidden="true" />
					<span>Unsaved SEO edits from earlier in this session are kept. Open Edit snippet to save or discard them.</span>
				</p>
			) : null}
			<Dialog.Root open={editing} onOpenChange={handleEditorOpenChange}>
				<Dialog.Trigger
					render={(props) => (
						<button
							{...props}
							type="button"
							className="shipit-seo-native-preview__edit"
							aria-expanded={editing}
						>
							<PencilSimple size={13} aria-hidden="true" />
							Edit snippet
						</button>
					)}
				/>
				<Dialog size="lg" className="shipit-seo-snippet-dialog">
					<div className="shipit-seo-snippet-dialog__header">
						<div className="shipit-seo-snippet-dialog__title-row">
							<Dialog.Title>Edit SEO</Dialog.Title>
						</div>
						<div ref={nameDialogTabs} className="shipit-seo-snippet-dialog__tabs">
							<Tabs
								variant="underline"
								activateOnFocus
								value={dialogView}
								onValueChange={(value) => {
									if (SNIPPET_DIALOG_VIEWS.includes(value as SnippetDialogView) && value !== dialogView) {
										setReviewField(null);
										setDialogView(value as SnippetDialogView);
									}
								}}
								tabs={SNIPPET_DIALOG_VIEWS.map((view) => ({
									value: view,
									label: <span className="shipit-seo-snippet-dialog__tab-label">
										{view === "general" ? <SlidersHorizontal size={14} aria-hidden="true" /> : view === "social" ? <ShareNetwork size={14} aria-hidden="true" /> : <TreeStructure size={14} aria-hidden="true" />}
										{view === "general" ? "General" : view === "social" ? "Social" : "Schema"}
									</span>,
									render: (props) => (
										<button
											{...props}
											type="button"
											autoFocus={view === dialogView}
											id={dialogTabId + "-" + view + "-tab"}
											aria-controls={dialogTabId + "-" + view + "-panel"}
											data-dialog-view={view}
										/>
									),
								}))}
							/>
						</div>
						{/* Focus reaches these after the tabs; the header grid places them beside the title. */}
						{dialogView === "general" ? (
							<div className="shipit-seo-snippet-dialog__view-tools">
								<div
									className="shipit-seo-snippet-dialog__device"
									role="group"
									aria-label="Preview device"
								>
									<button
										type="button"
										aria-pressed={device === "desktop"}
										onClick={() => onDeviceChange("desktop")}
									>
										<Desktop size={14} aria-hidden="true" />
										<span>Desktop</span>
									</button>
									<button
										type="button"
										aria-pressed={device === "mobile"}
										onClick={() => onDeviceChange("mobile")}
									>
										<DeviceMobile size={14} aria-hidden="true" />
										<span>Mobile</span>
									</button>
								</div>
								<button
									type="button"
									className="shipit-seo-snippet-dialog__context-toggle"
									aria-label="Toggle search result page context"
									aria-pressed={serpContext}
									onClick={() => setSerpContext((value) => !value)}
								>
									<MagnifyingGlass size={14} aria-hidden="true" />
									Result page
								</button>
							</div>
						) : null}
					</div>
					<Dialog.Description className="shipit-seo-visually-hidden">
						{snippetDialogDescription(dialogView, reviewField)}
					</Dialog.Description>
					<div
						className="shipit-seo-snippet-dialog__panel"
						role="tabpanel"
						id={dialogTabId + "-general-panel"}
						aria-labelledby={dialogTabId + "-general-tab"}
						hidden={dialogView !== "general"}
					>
						{dialogView === "general" ? (
							<>
								<div className="shipit-seo-snippet-dialog__metadata-layout" data-device={device}>
									<section
										className="shipit-seo-snippet-dialog__preview"
										aria-label="Search result preview"
									>
										<h3 className="shipit-seo-snippet-dialog__preview-title">Search preview</h3>
										{serpContext ? (
											<SerpContext device={device} query={serpQuery}>
												<SearchSnippetFrame preview={preview} device={device} locale={locale} resultPage descriptionDisplay="external" lastLoaded={previewError} nativeEditor={nativeEditor} keyword={serpQuery} />
											</SerpContext>
										) : <SearchSnippetFrame preview={preview} device={device} locale={locale} descriptionDisplay="external" lastLoaded={previewError} nativeEditor={nativeEditor} keyword={serpQuery} />}
									</section>
									{reviewField === "slug" ? <SavedSnippetReviewNote preview={preview} field={reviewField} previewError={previewError} /> : (
										<section className="shipit-seo-snippet-dialog__metadata" aria-label="SEO fields">
											<NativeSeoTextFields controller={nativeEditor} preview={preview} legacyGuidance={legacyRecordGuidance(brand.name)}
												datePrefix={seoSnippetDatePrefix(preview.search.publishedAt, locale)} />
										</section>
									)}
								</div>
								{previewRetryNotice}
							</>
						) : null}
					</div>
					<div
						className="shipit-seo-snippet-dialog__panel"
						role="tabpanel"
						id={dialogTabId + "-social-panel"}
						aria-labelledby={dialogTabId + "-social-tab"}
						hidden={dialogView !== "social"}
					>
						{dialogView === "social" ? (
							<>
							<SocialPreview
								preview={preview}
								view={socialPreview}
								platform={platform}
								onPlatformChange={setPlatform}
								draft={currentDraft}
								onDraftChange={updateSocialDraft}
								savedTitle={savedOverride?.title ?? ""}
								savedDescription={savedOverride?.description ?? ""}
								editable={Boolean(socialState.baseline) && socialState.editing.state === "ready"}
								phase={socialState.phase}
								dirty={socialDirty}
								onPreviewRetry={onPreviewRetry}
								nativeEditor={nativeEditor}
								imagePickerOpen={imagePickerOpen}
								onImagePickerOpenChange={setImagePickerOpen}
								imagePickerError={imagePickerError}
								onImagePickerError={setImagePickerError}
							/>
							{socialState.reviewSnapshot ? (
								<section className="shipit-seo-social-recovery" aria-label="Currently stored social values">
									<strong>Currently stored values</strong>
									<p>Title: {socialState.reviewSnapshot.override?.title || "No entry override"}</p>
									<p>Description: {socialState.reviewSnapshot.override?.description || "No entry override"}</p>
									<Button type="button" variant="secondary" onClick={() => installSocialState(reviewSocialSaveValues(socialStateRef.current))}>
										Keep draft with this saved version
									</Button>
								</section>
							) : null}
							</>
						) : null}
					</div>
					<div
						className="shipit-seo-snippet-dialog__panel"
						role="tabpanel"
						id={dialogTabId + "-schema-panel"}
						aria-labelledby={dialogTabId + "-schema-tab"}
						hidden={dialogView !== "schema"}
					>
						{dialogView === "schema" ? <EntrySchemaManager preview={preview} savedSnapshot={savedSnapshot} locale={locale} onPreviewRetry={onPreviewRetry} /> : null}
					</div>
					<div className="shipit-seo-snippet-dialog__actions" data-dialog-footer>
						<div className="shipit-seo-snippet-dialog__footer-status">
							{nativeFooter ? <NativeSeoSaveStatus controller={nativeEditor} publicationStatus={savedEntry?.status ?? null} /> : null}
							{saveNotice ? <p role="status">{saveNotice}</p> : null}
							{dialogView !== "social" && socialDirty && !socialBusy ? (
								<p role="note">
									Local Social edits are kept while you switch tabs. Return to
									the Social tab to review them.
								</p>
							) : null}
							{socialState.phase === "unconfirmed" || socialState.phase === "review" ? (
								<p role="note">{socialRetained
									? "Closing this dialog keeps this attempt and your local edits. Leaving this entry or locale, signing out or reloading clears them."
									: "Closing this dialog keeps this attempt and your local edits. Switching between desktop and mobile layouts, leaving this entry or locale, or reloading clears them."}</p>
							) : !socialBusy && socialDirty ? (
								<p role="note">Closing discards this unsaved Social draft.</p>
							) : null}
						</div>
						<div className="shipit-seo-snippet-dialog__footer-secondary">
							{nativeFooter ? <NativeSeoRecoveryActions controller={nativeEditor} /> : null}
							{dialogView === "social" && (socialLocked || !socialPreview.context.metadataCurrent) && socialState.phase !== "saving" ? (
								<Button type="button" variant="secondary" loading={socialState.phase === "checking"} disabled={socialBusy} onClick={() => void checkSavedSocial()}>
									Check saved social text
								</Button>
							) : null}
						</div>
						<div className="shipit-seo-snippet-dialog__footer-primary">
							<Button type="button" variant="secondary" disabled={socialBusy || nativeBusy} onClick={() => handleEditorOpenChange(false)}>Close</Button>
							{socialDirty || socialState.phase === "saving" ? (
								<Button
									type="button"
									variant={nativeChanged ? "secondary" : "primary"}
									loading={socialState.phase === "saving"}
									disabled={socialBusy || nativeBusy || socialLocked}
									onClick={() => void saveSocial()}
								>
									Save social text
								</Button>
							) : null}
							<NativeSeoSaveButton controller={nativeEditor} primary={nativeChanged} />
						</div>
					</div>
				</Dialog>
			</Dialog.Root>
		</section>
	);
}

function PreviewState({
	loading,
	error,
	onRetry,
}: {
	loading: boolean;
	error: boolean;
	onRetry: () => void;
}) {
	if (loading) {
		return (
			<p className="shipit-seo-native-panel__preview-state" role="status">
				Loading resolved preview...
			</p>
		);
	}
	if (error) {
		return (
			<div className="shipit-seo-native-panel__preview-state" role="alert">
				<span>Resolved preview could not be loaded.</span>
				<button type="button" onClick={onRetry}>
					Retry
				</button>
			</div>
		);
	}
	return (
		<p className="shipit-seo-native-panel__preview-state">
			No resolved preview is available for this entry.
		</p>
	);
}

type SocialPreviewPlatform = "facebook" | "x";

function SocialPreview({
	preview,
	view,
	platform,
	onPlatformChange,
	draft,
	onDraftChange,
	savedTitle,
	savedDescription,
	editable,
	phase,
	dirty,
	onPreviewRetry,
	nativeEditor,
	imagePickerOpen,
	onImagePickerOpenChange,
	imagePickerError,
	onImagePickerError,
}: {
	preview: SeoAdminEntryPreview;
	view: SocialEditorPreview;
	platform: SocialPreviewPlatform;
	onPlatformChange: (platform: SocialPreviewPlatform) => void;
	draft: SocialOverrideDraftState;
	onDraftChange: (patch: Partial<SocialOverrideDraftState>) => void;
	savedTitle: string;
	savedDescription: string;
	editable: boolean;
	phase: SocialSaveState["phase"];
	dirty: boolean;
	onPreviewRetry?: () => void;
	nativeEditor: NativeSeoEditorController;
	imagePickerOpen: boolean;
	onImagePickerOpenChange(open: boolean): void;
	imagePickerError: string | null;
	onImagePickerError(error: string | null): void;
}) {
	const brand = useSeoBrand();
	const title = draft.title ?? savedTitle;
	const description = draft.description ?? savedDescription;
	const fieldId = React.useId();
	return (
		<div className="shipit-seo-native-social">
			<div className="shipit-seo-native-social__preview">
				<div className="shipit-seo-native-social__preview-heading">
					<span>Share preview</span>
					<div role="group" aria-label="Social preview platform">
						<button
							type="button"
							aria-label="Facebook preview"
							aria-pressed={platform === "facebook"}
							onClick={() => onPlatformChange("facebook")}
						>
							<FacebookLogo size={14} aria-hidden="true" /> Facebook
						</button>
						<button
							type="button"
							aria-label="X preview"
							aria-pressed={platform === "x"}
							onClick={() => onPlatformChange("x")}
						>
							<XLogo size={14} aria-hidden="true" /> X
						</button>
					</div>
				</div>
				<div className="shipit-seo-native-preview-model">
					<ResolvedSocialPreview model={view.model} fieldBasis={view.fieldBasis} caption={view.caption} loadImage presentation="native" />
				</div>
				{view.context.metadataNeedsRefresh || view.context.clearMayRevealAlias ? (
					<div className="shipit-seo-native-social__preview-notice" role="status">
						<p>{view.context.clearMayRevealAlias
							? view.context.persistenceUncertain
								? "Inherited sharing text is unresolved until the saved result is confirmed."
								: view.context.hasLocalChanges
									? "Clearing both fields can reveal inherited sharing text. Save, then refresh to review it."
									: "Refresh to review inherited sharing text."
							: "The preview may be out of date. Refresh to check the latest values."}</p>
						<Button type="button" size="sm" variant="secondary" onClick={onPreviewRetry}>Refresh preview</Button>
					</div>
				) : null}
			</div>
			<div className="shipit-seo-native-social__settings">
				<NativeSeoImageField controller={nativeEditor} preview={preview} legacyGuidance={legacyRecordGuidance(brand.name)} pickerOpen={imagePickerOpen}
					onPickerOpenChange={onImagePickerOpenChange} pickerError={imagePickerError} onPickerError={onImagePickerError} />
				<div className="shipit-seo-native-social__customize">
					<div>
						<strong>Customize for social</strong>
						<span>Override the page's sharing text.</span>
					</div>
					<Switch
						aria-label="Customize title and description for social sharing"
						disabled={!editable}
						checked={draft.customizing}
						onCheckedChange={(checked) => onDraftChange({ customizing: checked })}
					/>
				</div>
				{draft.customizing ? (
					<div className="shipit-seo-native-social__fields">
						<div className="shipit-seo-native-social__field">
							<div className="shipit-seo-native-social__field-heading">
								<label htmlFor={`${fieldId}-title`}>Social title</label>
								<span id={`${fieldId}-title-limit`}>{nativeSeoCharacterCount(title, SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH)}</span>
							</div>
							<input
								id={`${fieldId}-title`}
								dir="auto"
								aria-describedby={`${fieldId}-title-limit ${fieldId}-title-help`}
								value={title}
								disabled={!editable}
								maxLength={SEO_ADMIN_SOCIAL_TITLE_MAX_LENGTH}
								placeholder={preview.social.fallbackTitle}
								onChange={(event) => onDraftChange({ title: event.target.value })}
							/>
							<p className="shipit-seo-native-social__field-help" id={`${fieldId}-title-help`}>Leave blank to inherit sharing text.</p>
						</div>
						<div className="shipit-seo-native-social__field">
							<div className="shipit-seo-native-social__field-heading">
								<label htmlFor={`${fieldId}-description`}>Social description</label>
								<span id={`${fieldId}-description-limit`}>{nativeSeoCharacterCount(description, SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH)}</span>
							</div>
							<textarea
								id={`${fieldId}-description`}
								dir="auto"
								aria-describedby={`${fieldId}-description-limit ${fieldId}-description-help`}
								value={description}
								disabled={!editable}
								maxLength={SEO_ADMIN_SOCIAL_DESCRIPTION_MAX_LENGTH}
								placeholder={preview.social.fallbackDescription}
								onChange={(event) => onDraftChange({ description: event.target.value })}
							/>
							<p className="shipit-seo-native-social__field-help" id={`${fieldId}-description-help`}>Input limit; platforms may show less.</p>
						</div>
					</div>
				) : null}
				<p
					className="shipit-seo-native-social__status"
					role="status"
					data-state={phase === "unconfirmed" || phase === "review" || !editable ? "error" : phase === "saving" || phase === "checking" ? "saving" : dirty ? "dirty" : "saved"}
				>
					{phase === "saving"
							? "Saving social text..."
							: phase === "checking" ? "Checking the saved values without submitting changes..."
							: phase === "unconfirmed" || phase === "review" ? "Review the saved values before another save. Your local edits are kept."
							: !editable ? "The saved Social record could not be confirmed. Check saved social text before editing."
							: dirty ? "Unsaved changes. Saving updates published sharing text immediately."
							: "Blank fields inherit the page's sharing text."}
				</p>
			</div>
		</div>
	);
}

function canonicalStatusLabel(
	status: SeoAdminEntryPreview["canonicalValidation"]["status"],
): string {
	const labels: Record<SeoAdminEntryPreview["canonicalValidation"]["status"], string> = {
		matches: "Matches public path",
		invalid: "Invalid or unresolved",
		"off-origin": "Points to another origin",
		"different-path": "Points to another path",
		"query-or-fragment": "Contains query or fragment",
	};
	return labels[status];
}


const ROBOTS_DIRECTIVE_DEFAULTS: SeoAdminRobotsDirectives = {
	nofollow: false,
	noarchive: false,
	nosnippet: false,
	noimageindex: false,
	notranslate: false,
};

type SeoRobotsDirectiveChange = { key: keyof SeoAdminRobotsDirectives; value: boolean };

const ADVANCED_ROBOTS_OPTIONS: ReadonlyArray<{
	key: keyof SeoAdminRobotsDirectives;
	label: string;
}> = [
	{ key: "noarchive", label: "No archive" },
	{ key: "nosnippet", label: "No snippet" },
	{ key: "noimageindex", label: "No image index" },
	{ key: "notranslate", label: "No translate" },
];

const INDEXING_WORKSPACE_URL = `${SEO_WORKSPACE_URL}${buildSeoAdminSearch("", "indexing")}`;

function AdvancedPanel({
	preview,
	siteNoindex = null,
	directives,
	directivesLoading,
	directivesLoadError,
	directivesSaving,
	directivesError,
	onDirectivesSave,
	onDirectivesRetry,
	editorActions,
	editorDraft,
}: {
	preview: SeoAdminEntryPreview;
	/** Site-wide noindex from the loaded settings; null while unknown. */
	siteNoindex?: boolean | null;
	directives: { robots: SeoAdminRobotsDirectives } | null;
	directivesLoading: boolean;
	directivesLoadError: boolean;
	directivesSaving: boolean;
	directivesError: boolean;
	onDirectivesSave: (change: SeoRobotsDirectiveChange) => void;
	onDirectivesRetry: () => void;
	editorActions?: ContentEditorPanelActions;
	editorDraft?: SeoEditorDraftSnapshot;
}) {
	const canWriteSeo = Boolean(editorActions?.updateSeo && editorDraft);
	const savedSeoFieldKnown = (field: "noIndex" | "canonical") => preview.ownership?.status === "current" &&
		preview.ownership.fields.some((item) => item.field === field && item.state !== "unknown");
	const draftIndexability = resolveSeoDraftIndexability(preview, editorDraft);
	const { entryIndexable, effectiveIndexable } = draftIndexability;
	// From the same preview snapshot as the effective state; older servers omit it.
	const typeRule = preview.noindexSources?.includes("content-type-rule") === true;
	const siteRule = siteNoindex === true || preview.noindexSources?.includes("site-setting") === true;
	// The entry's own setting, unless an earlier rule in the order already makes the page noindex.
	const savedIndexing = !savedSeoFieldKnown("noIndex") ? "Not confirmed"
		: !entryIndexable ? "Noindex"
		: siteRule ? "Noindex from site-wide setting"
		: typeRule ? "Noindex from content type rule"
		: siteNoindex === false ? "Index (site default)"
		: "Index allowed";
	const robots = directives?.robots ?? ROBOTS_DIRECTIVE_DEFAULTS;
	const [canonicalDraft, setCanonicalDraft] = React.useState("");
	const [canonicalApplied, setCanonicalApplied] = React.useState(false);
	const [canonicalError, setCanonicalError] = React.useState<string | null>(null);
	const savedCanonical =
		editorDraft?.seo?.canonical !== undefined
			? (editorDraft.seo.canonical?.trim() ?? "")
			: preview.sources.canonical === "core-seo"
				? preview.canonicalValidation.canonical
				: "";
	const canonicalValidation = validateSeoCanonicalDraft(canonicalDraft);

	React.useEffect(() => {
		setCanonicalDraft(savedCanonical);
		setCanonicalApplied(false);
		setCanonicalError(null);
	}, [preview.content.ref, savedCanonical]);

	const applyCanonical = () => {
		const value = canonicalValidation.value;
		if (!canWriteSeo || value === savedCanonical) return;
		if (!canonicalValidation.valid) {
			setCanonicalError(canonicalValidation.message);
			return;
		}
		setCanonicalError(null);
		editorActions?.updateSeo?.({ canonical: value || null });
		setCanonicalApplied(true);
	};

	const toggleDirective = (key: keyof SeoAdminRobotsDirectives) => {
		onDirectivesSave({ key, value: !robots[key] });
	};
	const groupId = React.useId();

	return (
		<div className="shipit-seo-native-advanced">
			<section className="shipit-seo-native-advanced__group" aria-labelledby={`${groupId}-entry`}>
				<div className="shipit-seo-native-advanced__group-heading">
					<h4 id={`${groupId}-entry`}>Saved with the entry</h4>
					<p>{canWriteSeo ? "These fields change the editor draft. Save the entry to apply them." : "These fields are stored on the entry and shown here read-only."}</p>
				</div>
				{canWriteSeo ? <fieldset className="shipit-seo-native-advanced__robots-mode">
					<legend>Robots meta</legend>
					<label
						className="shipit-seo-native-advanced__radio-card"
						data-selected={entryIndexable || undefined}
					>
						<input
							type="radio"
							name="shipit-seo-robots-mode"
							checked={entryIndexable}
							onChange={() => editorActions?.updateSeo?.({ noIndex: false })}
						/>
						<span>
							<strong>{siteNoindex === false && !typeRule ? "Index (site default)" : "Index"}</strong>
							<small>{typeRule ? "The content type rule still adds noindex" : "Allow indexing for this entry"}</small>
						</span>
					</label>
					<label
						className="shipit-seo-native-advanced__radio-card"
						data-selected={!entryIndexable || undefined}
					>
						<input
							type="radio"
							name="shipit-seo-robots-mode"
							checked={!entryIndexable}
							onChange={() => editorActions?.updateSeo?.({ noIndex: true })}
						/>
						<span>
							<strong>Noindex</strong>
							<small>Ask search engines not to index</small>
						</span>
					</label>
				</fieldset> : <div role="group" aria-label="Saved SEO fields, read-only">
					<div className="shipit-seo-native-advanced__row">
						<span>Entry indexing</span>
						<strong title={savedIndexing}>{savedIndexing}</strong>
					</div>
					<div className="shipit-seo-native-advanced__row">
						<span>Canonical URL</span>
						<strong>{savedSeoFieldKnown("canonical") ? preview.canonicalValidation.canonical || preview.search.url : "Not confirmed"}</strong>
					</div>
					<p className="shipit-seo-native-advanced__readonly-note">Edit these fields in EmDash's native SEO panel. Its changes save separately and can affect the live page immediately.</p>
					{preview.ownership?.reason === "core-seo-unavailable" ? <p className="shipit-seo-native-advanced__readonly-note">
						SEO fields are disabled for this content type. <a href={`/_emdash/admin/content-types/${encodeURIComponent(preview.content.collection)}`}>Open content type settings</a> to enable SEO, then reopen the entry. For a content type managed in code, enable SEO in its definition.
					</p> : null}
				</div>}
				{!entryIndexable && (canWriteSeo || savedSeoFieldKnown("noIndex")) ? (
					<p className="shipit-seo-native-advanced__noindex-note" role="status">
						<WarningCircle size={14} weight="fill" aria-hidden="true" />
						A noindex directive is selected. Confirm the rendered page after saving changes.
					</p>
				) : null}
				{siteNoindex === true ? (
					<p className="shipit-seo-native-advanced__noindex-note" data-scope="site">
						<Info size={14} weight="fill" aria-hidden="true" />
						<span>
							Site-wide noindex is on, so search engines are asked not to index any page, including this one.{" "}
							<a href={INDEXING_WORKSPACE_URL}>Open Indexing rules</a>
						</span>
					</p>
				) : null}
				{typeRule ? (
					<p className="shipit-seo-native-advanced__noindex-note" data-scope="content-type">
						<Info size={14} weight="fill" aria-hidden="true" />
						<span>
							Inherited: a content type rule adds noindex to every {preview.content.collectionLabel} entry, including this one. The entry
							cannot opt back in, because its own setting can only add noindex. Order: site-wide noindex, then the content type
							rule, then this entry's setting.{" "}
							<a href={INDEXING_WORKSPACE_URL}>Open Indexing rules</a>
						</span>
					</p>
				) : null}
				{canWriteSeo ? <div className="shipit-seo-native-advanced__canonical">
					<label htmlFor="shipit-seo-canonical-input">Canonical URL</label>
					<input
						id="shipit-seo-canonical-input"
						type="url"
						value={canonicalDraft}
						placeholder={preview.search.url}
						disabled={!canWriteSeo}
						onChange={(event) => {
							setCanonicalDraft(event.target.value);
							setCanonicalApplied(false);
							setCanonicalError(validateSeoCanonicalDraft(event.target.value).message);
						}}
						onBlur={applyCanonical}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							applyCanonical();
						}}
					/>
					{canonicalError ? (
						<p role="alert" data-state="error">
							{canonicalError}
						</p>
					) : null}
					<p>
						Leave empty to use the public URL. Override only for intentional consolidation or
						cross-domain syndication.
						{canonicalApplied ? " Applied to the editor draft. Save the entry to persist." : ""}
					</p>
				</div> : null}
			</section>

			<section className="shipit-seo-native-advanced__group" aria-labelledby={`${groupId}-live`}>
				<div className="shipit-seo-native-advanced__group-heading">
					<h4 id={`${groupId}-live`}>Applies to the live page now</h4>
					<p>Robots directives apply to the live page as soon as they change; they are not part of the entry draft.</p>
				</div>
				<div className="shipit-seo-native-advanced__directives">
					{directivesLoadError ? (
						<p
							className="shipit-seo-native-advanced__directives-status"
							role="alert"
							data-state="error"
						>
							Robots directives could not be loaded. Existing settings remain unchanged.{" "}
							<button type="button" onClick={onDirectivesRetry}>
								Retry
							</button>
						</p>
					) : null}
					<Switch
						label="Nofollow links"
						controlFirst={false}
						checked={robots.nofollow || !effectiveIndexable}
						disabled={directivesLoading || directivesLoadError || directivesSaving || !effectiveIndexable}
						onCheckedChange={() => toggleDirective("nofollow")}
					/>
					<p>
						{effectiveIndexable
							? "Ask crawlers not to follow links on this page."
							: "Noindex pages also get nofollow, as EmDash does for its own noindex setting."}
					</p>
					<span className="shipit-seo-native-advanced__directives-label">Advanced robots</span>
					<div
						className="shipit-seo-native-advanced__directives-grid"
						role="group"
						aria-label="Advanced robots directives"
					>
						{ADVANCED_ROBOTS_OPTIONS.map((option) => (
							<label
								key={option.key}
								className="shipit-seo-native-advanced__directive"
								data-checked={robots[option.key] || undefined}
							>
								<input
									type="checkbox"
									checked={robots[option.key]}
									disabled={directivesLoading || directivesLoadError || directivesSaving}
									onChange={() => toggleDirective(option.key)}
								/>
								{option.label}
							</label>
						))}
					</div>
					<p
						className="shipit-seo-native-advanced__directives-status"
						role="status"
						data-state={directivesError ? "error" : directivesSaving ? "saving" : "idle"}
					>
						{directivesError
							? "Robots directives could not be saved. Toggle again to retry."
							: directivesSaving
								? "Saving robots directives..."
								: ""}
					</p>
				</div>
			</section>

			<details className="shipit-seo-native-advanced__status">
				<summary>
					<CaretRight size={12} aria-hidden="true" />
					Status &amp; diagnostics
				</summary>
				<div>
					<div className="shipit-seo-native-advanced__row">
						<span>Resolved noindex metadata</span>
						<strong data-positive={canWriteSeo || savedSeoFieldKnown("noIndex") ? effectiveIndexable : undefined}>
							{!canWriteSeo && !savedSeoFieldKnown("noIndex") ? "Not confirmed" : draftIndexability.pending
								? "Pending save"
								: effectiveIndexable
									? "Noindex off"
									: "Noindex"}
						</strong>
					</div>
					<div className="shipit-seo-native-advanced__row">
						<span>Canonical validation</span>
						<strong data-positive={preview.canonicalValidation.status === "matches"}>
							{canonicalStatusLabel(preview.canonicalValidation.status)}
						</strong>
					</div>
					<div className="shipit-seo-native-advanced__row">
						<span>Canonical source</span>
						<strong>{sourceLabel(preview.sources.canonical)}</strong>
					</div>
					<div className="shipit-seo-native-advanced__row">
						<span>International SEO</span>
						<strong data-status={preview.localeGraph.status}>
							{localeGraphDiagnosticLabel(preview.localeGraph)}
						</strong>
					</div>
					{preview.localeGraph.issues.length > 0 ? (
						<ul className="shipit-seo-native-advanced__locale-issues">
							{preview.localeGraph.issues.map((item) => (
								<li key={`${item.code}:${item.locale ?? "global"}`} data-severity={item.severity}>
									{item.message}
								</li>
							))}
						</ul>
					) : null}
					<div className="shipit-seo-native-advanced__row">
						<span>Schema output</span>
						<strong>
							{preview.schemaTypes.length > 0 ? preview.schemaTypes.join(", ") : "None resolved"}
						</strong>
					</div>
				</div>
			</details>
		</div>
	);
}

type BrowserAnalysis = Extract<EditorBasicAnalysis, { state: "ready" | "partial" }>;
type CheckFixHandler = (check: SeoContentCheck, origin?: HTMLElement | null) => void;

/**
 * The one result the header, checklist and calculation describe: the verified
 * analysis of this saved version and its saved keywords, otherwise the browser
 * checks. Stale, unverified and earlier-analyzer results are never a source.
 */
type EditorAnalysisSource =
	| { kind: "stored" | "session"; score: SeoAdminContentScore }
	| { kind: "browser"; analysis: BrowserAnalysis };

function editorAnalysisSource(score: SeoAdminContentScore | null, analysis: BrowserAnalysis | undefined): EditorAnalysisSource | null {
	if (analysis?.profileSource === "default") return { kind: "browser", analysis };
	if (score && hasCurrentEditorAnalysis(score)) return { kind: score.persistence === "session" ? "session" : "stored", score };
	return analysis ? { kind: "browser", analysis } : null;
}

function sourceResult(source: EditorAnalysisSource) {
	return source.kind === "browser" ? source.analysis.result : source.score;
}

/** Partial browser checks have no number or band. */
function sourceDisplay(source: EditorAnalysisSource) {
	if (source.kind !== "browser") return seoScoreDisplay(source.score);
	return source.analysis.state === "ready" ? seoScoreDisplay(source.analysis.result) : null;
}

const CHECK_ROW_STATUS: Readonly<Record<SeoCheckRowKind, string>> = {
	failed: "fail",
	"partly-met": "review",
	suggestion: "suggestion",
	"not-checked": "info",
	passed: "pass",
	earlier: "info",
};

function CheckStatusIcon({ kind }: { kind: SeoCheckRowKind }) {
	if (kind === "passed") return <CheckCircle size={15} weight="fill" aria-hidden="true" />;
	if (kind === "failed") return <XCircle size={15} weight="fill" aria-hidden="true" />;
	if (kind === "partly-met") return <WarningCircle size={15} weight="fill" aria-hidden="true" />;
	if (kind === "suggestion") return <Lightbulb size={15} weight="fill" aria-hidden="true" />;
	if (kind === "earlier") return <ArrowsClockwise size={15} aria-hidden="true" />;
	return <Question size={15} weight="fill" aria-hidden="true" />;
}

function checkDisplayLabel(check: SeoContentCheck): string {
	if (check.id === "title") return "Title present";
	if (check.id === "description") return "Description present";
	return check.label;
}

const AnalysisCheckRow = React.memo(function AnalysisCheckRow({
	row,
	onFix,
	canReviewSnippet,
	canAddKeyword,
}: {
	row: SeoCheckRow;
	onFix: CheckFixHandler;
	canReviewSnippet: boolean;
	canAddKeyword: boolean;
}) {
	const { check, kind, word, action } = row;
	const label = checkDisplayLabel(check);
	const basis: SeoCheckEvidenceBasis = kind === "earlier" ? "legacy" : check.basis ?? "legacy";
	// A disabled or hidden target cannot take focus, so its action is not offered.
	const actionAvailable = action !== null &&
		(action.target === "keyword" ? canAddKeyword : action.target === "advanced" || canReviewSnippet);
	return (
		<li className="shipit-seo-native-panel__check" data-status={CHECK_ROW_STATUS[kind]} data-kind={kind} data-basis={basis}>
			<details className="shipit-seo-native-panel__check-details">
				<summary>
					<span className="shipit-seo-native-panel__check-icon">
						<CheckStatusIcon kind={kind} />
					</span>
					<span className="shipit-seo-native-panel__check-summary">
						<span className="shipit-seo-native-panel__check-heading">
							<strong title={label}>{label}</strong>
							<small className="shipit-seo-native-panel__check-status">{word}</small>
						</span>
						{check.detail ? <span className="shipit-seo-native-panel__check-detail">{check.detail}</span> : null}
					</span>
					<CaretRight size={12} className="shipit-seo-native-panel__check-caret" aria-hidden="true" />
					{/* Reserves the row action's width on line 1, so the open details can span the whole row. */}
					{actionAvailable ? <span className="shipit-seo-native-panel__check-action-space" aria-hidden="true">{action.verb}</span> : null}
				</summary>
				<div className="shipit-seo-native-panel__check-copy">
					{row.showRecommendation && check.recommendation ? (
						<p className="shipit-seo-native-panel__check-recommendation">{check.recommendation}</p>
					) : null}
					<p className="shipit-seo-native-panel__check-evidence">
						<span className="shipit-seo-native-panel__basis" data-basis={basis}>{SEO_CHECK_BASIS_LABELS[basis]}</span>
						{check.evidence.source ? <span>{check.evidence.source}</span> : null}
					</p>
					{basis !== "legacy" && check.limitation ? (
						<p className="shipit-seo-native-panel__check-limitation">{check.limitation}</p>
					) : null}
				</div>
			</details>
			{actionAvailable ? (
				<button
					type="button"
					aria-label={`${action.verb}: ${label}`}
					onClick={(event) => onFix(check, event?.currentTarget ?? null)}
				>
					{action.verb}
				</button>
			) : null}
		</li>
	);
});

const AnalysisCheckGroup = React.memo(function AnalysisCheckGroup({
	group,
	open,
	onOpenChange,
	onFix,
	canReviewSnippet,
	canAddKeyword,
}: {
	group: SeoContentCheckGroup;
	open: boolean;
	onOpenChange: (id: SeoCheckGroupId, open: boolean) => void;
	onFix: CheckFixHandler;
	canReviewSnippet: boolean;
	canAddKeyword: boolean;
}) {
	return (
		<details
			className="shipit-seo-native-panel__group"
			data-group-id={group.id}
			open={open}
			// Setting `open` also fires toggle; only a change away from it is the user's choice.
			onToggle={(event) => {
				if (event.currentTarget.open !== open) onOpenChange(group.id, event.currentTarget.open);
			}}
		>
			<summary data-group-summary={group.id}>
				<CaretRight size={12} aria-hidden="true" />
				<strong>{group.label}</strong>
				<span data-tone={group.pill.tone}>{group.pill.text}</span>
			</summary>
			<div className="shipit-seo-native-panel__group-body">
				{group.rows.length ? (
					<ul className="shipit-seo-native-panel__checks">
						{group.rows.map((row) => (
							<AnalysisCheckRow
								key={row.check.id}
								row={row}
								onFix={onFix}
								canReviewSnippet={canReviewSnippet}
								canAddKeyword={canAddKeyword}
							/>
						))}
					</ul>
				) : null}
				{group.notApplicableLabel ? (
					<details className="shipit-seo-native-panel__not-applicable">
						<summary><CaretRight size={11} aria-hidden="true" />{group.notApplicableLabel}</summary>
						<ul>
							{group.notApplicable.map((item) => <li key={item.reason}>{item.text}</li>)}
						</ul>
					</details>
				) : null}
			</div>
		</details>
	);
});

/** One checklist for every source, so a source change keeps each group's open state by ID. */
function AnalysisChecklist({ source, onFix, canReviewSnippet, canAddKeyword }: {
	source: EditorAnalysisSource;
	onFix: CheckFixHandler;
	canReviewSnippet: boolean;
	canAddKeyword: boolean;
}) {
	const result = sourceResult(source);
	const presentation = React.useMemo(() => contentCheckPresentation(result), [result]);
	const [openGroups, setOpenGroups] = React.useState<Partial<Record<SeoCheckGroupId, boolean>>>({});
	const setGroupOpen = React.useCallback((id: SeoCheckGroupId, open: boolean) => {
		setOpenGroups((current) => ({ ...current, [id]: open }));
	}, []);
	return (
		<div className="shipit-seo-native-panel__groups" role="group" aria-label="SEO checks">
			{presentation.groups.map((group) => (
				<AnalysisCheckGroup
					key={group.id}
					group={group}
					open={openGroups[group.id] ?? group.id === presentation.defaultOpenGroupId}
					onOpenChange={setGroupOpen}
					onFix={onFix}
					canReviewSnippet={canReviewSnippet}
					canAddKeyword={canAddKeyword}
				/>
			))}
		</div>
	);
}

const ANALYSIS_SCOPE_TEXT: Readonly<Record<EditorAnalysisSource["kind"], string>> = {
	browser: "Checks use saved content.",
	stored: "Saved analysis of this entry.",
	session: "Temporary check of saved content.",
};

/** Explain what the reader can rely on without exposing score arithmetic. */
function AnalysisScopeNote({ source, keywordsPending }: { source: EditorAnalysisSource; keywordsPending: boolean }) {
	const result = sourceResult(source);
	const display = sourceDisplay(source);
	const bodyUnavailable = result.checks.some((check) => check.id === "content-depth" && check.basis === "unavailable");
	const profileLabel = source.kind === "browser" ? source.analysis.profileLabel
		: result.assessmentProfile?.profile === "article" ? "Article" : "General content";
	const partialReason = source.kind === "browser" && source.analysis.state === "partial" ? source.analysis.reason : null;
	const note = partialReason ?? (display?.label === "Too little text to score"
		? "Add more page text to get a score."
		: display?.score == null
			? bodyUnavailable
				? "Some page content can't be checked, so a complete score isn't available."
				: "Some SEO information is unavailable, so a complete score can't be shown."
			: ANALYSIS_SCOPE_TEXT[source.kind]);
	return (<>
		<p>{profileLabel ? `${profileLabel} checks. ${note}` : note}</p>
		{keywordsPending ? <p>{source.kind === "browser" ? "Using your keyword changes." : "This saved result does not include your keyword changes."}</p> : null}
	</>);
}

interface AnalysisHeaderSlots {
	/** The explicit saved-entry analysis control, at the end of the header row. */
	action?: React.ReactNode;
	/** Its outcome and recovery controls, between the header row and the details. */
	notice?: React.ReactNode;
	/** What the action uses, or why it is unavailable. */
	actionHelp?: string | null;
}

function AnalysisScoreHeader({ score, label, tone, lines, keywordsPending, action, notice, actionHelp, children }: AnalysisHeaderSlots & {
	score: number | null;
	label: string;
	tone: "good" | "review" | "poor" | "neutral";
	lines: readonly string[];
	keywordsPending: boolean;
	children: React.ReactNode;
}) {
	const ringCircumference = 2 * Math.PI * 19;
	const ringProgress = ((score ?? 0) * ringCircumference) / 100;
	return (<>
		<header className="shipit-seo-native-panel__summary">
			<div
				className="shipit-seo-native-panel__ring"
				data-tone={tone}
				data-empty={score === null}
				data-digits={score === null ? undefined : String(score).length}
				role="img"
				aria-label={score === null ? "No SEO score" : `SEO score ${score} out of 100`}
			>
				<svg viewBox="0 0 46 46" focusable="false" aria-hidden="true">
					<circle className="shipit-seo-native-panel__ring-track" cx="23" cy="23" r="19" fill="none" strokeWidth="4.5" />
					{score !== null ? <circle className="shipit-seo-native-panel__ring-progress" cx="23" cy="23" r="19" fill="none" strokeWidth="4.5" strokeLinecap="round" strokeDasharray={`${ringProgress.toFixed(1)} ${ringCircumference.toFixed(1)}`} transform="rotate(-90 23 23)" /> : null}
				</svg>
				<span aria-hidden="true">{score ?? "-"}</span>
			</div>
			<div className="shipit-seo-native-panel__summary-copy">
				<strong>{label}</strong>
				{lines.map((line) => <span key={line}>{line}</span>)}
				{keywordsPending ? <span>Unsaved keywords</span> : null}
			</div>
			{action ? <div className="shipit-seo-native-panel__summary-action">{action}</div> : null}
		</header>
		{notice}
		<div className="shipit-seo-native-panel__summary-details">
			{children}
			{actionHelp ? <p>{actionHelp}</p> : null}
		</div>
	</>);
}

const BAND_TONES = { good: "good", "needs-improvement": "review", poor: "poor" } as const;

/** The number, band and counts of the source; with no source, a stored result only as a dash. */
function AnalysisHeader({ source, score, keywordsPending, updating = false, loading = false, onChooseCheckProfile, ...slots }: AnalysisHeaderSlots & {
	source: EditorAnalysisSource | null;
	score: SeoAdminContentScore | null;
	keywordsPending: boolean;
	/** The shown result is kept while a newer one loads. */
	updating?: boolean;
	/** The checks' inputs are still being read; nothing has failed. */
	loading?: boolean;
	onChooseCheckProfile?: () => void;
}) {
	if (!source) {
		const presentation = score ? analysisPresentation(score) : null;
		const earlier = presentation?.label === SEO_EARLIER_ANALYZER_LABEL;
		return (
			<AnalysisScoreHeader score={null} label={presentation?.label ?? (loading ? "Loading checks..." : "Not checked")} tone="neutral"
				lines={[]} keywordsPending={keywordsPending} {...slots}>
				<p>{!score ? loading ? "The saved content and settings are being read." : "No analysis result is available."
					: earlier ? "This saved result is from an earlier version. Save a new analysis in Analysis options."
						: score.freshness === "stale" ? "This saved result is out of date. Save a new analysis in Analysis options."
							: "This saved result has not been checked against the current content. Save a new analysis in Analysis options."}</p>
				{keywordsPending ? <p>This analysis does not include the local keyword draft.</p> : null}
			</AnalysisScoreHeader>
		);
	}
	const display = sourceDisplay(source);
	const defaultProfile = source.kind === "browser" && source.analysis.profileSource === "default";
	const totals = contentCheckPresentation(sourceResult(source)).totals;
	const lines = [seoCheckTotalsText(totals), ...(display && display.score !== null && display.qualifier ? [display.qualifier] : []),
		...(updating ? ["Updating checks..."] : [])];
	return (
		<AnalysisScoreHeader score={display?.score ?? null} label={display?.label ?? "Partially checked"}
			tone={display?.band ? BAND_TONES[display.band] : "neutral"} lines={lines} keywordsPending={keywordsPending} {...slots}>
			<AnalysisScopeNote source={source} keywordsPending={keywordsPending} />
			{defaultProfile && onChooseCheckProfile ? <Button type="button" size="sm" variant="secondary" onClick={onChooseCheckProfile}>Change check profile</Button> : null}
		</AnalysisScoreHeader>
	);
}

interface SeoEditorWorkflowProps extends Pick<SeoAnalysisDisclosureProps,
	"preview" | "savedEntry" | "savedSnapshot" | "locale" | "siteSettings" | "previewLoading" | "previewError" | "previewObservation" |
	"directives" | "directivesLoading" | "directivesLoadError" | "directivesSaving" | "directivesError" |
	"onDirectivesSave" | "onDirectivesRetry" | "onPreviewRetry" | "onSocialSave" | "socialEditor" | "editorActions" | "editorDraft" | "advancedNotice"
> {
	tone?: string;
	serpQuery?: string;
	header: (showAnalysis: () => void) => React.ReactNode;
	beforeBody?: React.ReactNode;
	/** The Excluded from search banner is shown, so the sidebar snippet omits its own noindex note. */
	searchExclusionShown?: boolean;
	renderKeywordEditor?: (idPrefix: string) => React.ReactNode;
	renderAnalysis: (onFix: CheckFixHandler) => React.ReactNode;
	afterBody?: React.ReactNode;
}

/** Focus only this panel's existing profile form after its disclosure opens. */
function focusEditorCheckProfile(section: HTMLElement | null): void {
	if (!section?.isConnected || section.closest("[hidden]")) return;
	const disclosure = section.closest("details");
	if (disclosure && !disclosure.open) return;
	section.scrollIntoView({ block: "nearest" });
	const select = section.querySelector<HTMLSelectElement>("select:not(:disabled)");
	(select ?? section).focus({ preventScroll: true });
}

/** Runs after the next paint, once focus moves made while closing a dialog have settled. */
function afterPaint(run: () => void): () => void {
	let second = 0;
	const first = window.requestAnimationFrame(() => { second = window.requestAnimationFrame(run); });
	return () => {
		window.cancelAnimationFrame(first);
		window.cancelAnimationFrame(second);
	};
}

function SeoEditorWorkflow({
	preview,
	savedEntry,
	savedSnapshot,
	locale,
	siteSettings,
	previewLoading,
	previewError,
	previewObservation,
	directives,
	directivesLoading,
	directivesLoadError,
	directivesSaving,
	directivesError,
	onDirectivesSave,
	onDirectivesRetry,
	onPreviewRetry,
	onSocialSave,
	socialEditor,
	editorActions,
	editorDraft,
	tone, serpQuery = "", header, beforeBody, searchExclusionShown = false, renderKeywordEditor, renderAnalysis, afterBody, advancedNotice,
}: SeoEditorWorkflowProps) {
	const [activeView, setActiveView] = React.useState<EditorPanelView>("analysis");
	const [previewDevice, setPreviewDevice] = React.useState<PreviewDevice>("mobile");
	const [dialogRequest, setDialogRequest] = React.useState<SnippetDialogRequest | null>(null);
	React.useEffect(() => {
		setDialogRequest(null);
	}, [preview?.content.ref, locale]);
	const requestDialog = (view: SnippetDialogView, reviewField?: SnippetDraftField) => {
		// The dialog lives inside SearchPreview, which only mounts once the
		// resolved preview loaded; queueing a request before that would pop the
		// dialog open later, disconnected from any user action.
		if (!preview) return;
		setDialogRequest((current) => ({
			view,
			reviewField,
			ref: preview.content.ref,
			locale: locale ?? null,
			nonce: (current?.nonce ?? 0) + 1,
		}));
	};
	const tabId = React.useId();
	const workflowRef = React.useRef<HTMLElement>(null);
	// The check action that opened the dialog; focus returns to it, or to its group, on close.
	const fixOrigin = React.useRef<{ element: HTMLElement; groupId: string | null } | null>(null);
	const restoreFixFocus = () => {
		const origin = fixOrigin.current;
		fixOrigin.current = null;
		if (!origin) return;
		afterPaint(() => {
			if (origin.element.isConnected) {
				origin.element.focus();
				return;
			}
			if (origin.groupId) workflowRef.current?.querySelector<HTMLElement>(`[data-group-summary="${origin.groupId}"]`)?.focus();
		});
	};
	const selectView = (view: EditorPanelView) => {
		setActiveView(view);
	};
	// Arrow keys only move focus between tabs; Enter or Space selects the focused one.
	const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const strip = event.currentTarget.parentElement;
		if (!strip) return;
		const buttons = Array.from(
			strip.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-strip-entry]'),
		);
		const current = buttons.indexOf(event.currentTarget);
		const nextIndex =
			event.key === "Home"
				? 0
				: event.key === "End"
					? buttons.length - 1
					: (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
		buttons[nextIndex]?.focus();
	};
	const openDialogFrom = (view: "social" | "schema", opener: HTMLElement) => {
		fixOrigin.current = { element: opener, groupId: null };
		requestDialog(view);
	};

	const handleCheckFix: CheckFixHandler = (check, origin) => {
		const target = resolveCheckFixTarget(check);
		if (!target) return;
		if (target.kind === "dialog") {
			fixOrigin.current = origin
				? { element: origin, groupId: origin.closest("[data-group-id]")?.getAttribute("data-group-id") ?? null }
				: null;
			requestDialog(target.view, target.field);
			return;
		}
		if (target.kind === "keyword") {
			setActiveView("analysis");
			window.requestAnimationFrame(() => {
				document.getElementById(`${tabId}-focus-keyword`)?.focus();
			});
			return;
		}
		if (target.kind === "advanced") {
			setActiveView("advanced");
			// The selected Advanced tab keeps focus in view once the analysis view is hidden.
			window.requestAnimationFrame(() => {
				workflowRef.current?.querySelector<HTMLElement>('[data-strip-entry="advanced"]')?.focus();
			});
			return;
		}
	};

	return (
		<section ref={workflowRef} className="shipit-seo-native-panel shipit-seo-native-panel--sidebar" data-tone={tone}>
			{header(() => setActiveView("analysis"))}
			{beforeBody}
			<div className="shipit-seo-native-panel__body">
				<div className="shipit-seo-native-panel__body-inner">
					<div className="shipit-seo-native-panel__analysis-layout" role="group" aria-label="SEO analysis">
						<div className="shipit-seo-native-panel__general-editor">
							{renderKeywordEditor?.(tabId)}
							{preview ? (
								<SearchPreview
									key={preview.content.ref + ":" + (locale ?? "")}
									locale={locale}
									preview={preview}
									savedEntry={savedEntry}
									previewUpdating={previewLoading}
									exclusionBannerShown={searchExclusionShown}
									savedSnapshot={savedSnapshot}
									siteSettings={siteSettings}
									device={previewDevice}
									onDeviceChange={setPreviewDevice}
									serpQuery={serpQuery}
									dialogRequest={dialogRequest}
									onDialogClose={restoreFixFocus}
									editorActions={editorActions}
									editorDraft={editorDraft}
									onSocialSave={onSocialSave}
									socialEditor={socialEditor}
									previewError={previewError}
									previewObservation={previewObservation}
									onPreviewRetry={onPreviewRetry}
								/>
							) : (
								<PreviewState
									loading={previewLoading}
									error={previewError}
									onRetry={onPreviewRetry}
								/>
							)}
							<div className="shipit-seo-native-panel__openers">
								<button
									type="button"
									className="shipit-seo-native-panel__opener"
									data-dialog-opener="social"
									title={preview ? "Opens Edit SEO on the Social tab" : "Available once the preview loads"}
									aria-haspopup="dialog"
									disabled={!preview}
									onClick={(event) => openDialogFrom("social", event.currentTarget)}
								>
									<ShareNetwork size={14} aria-hidden="true" />
									<span>Social</span>
								</button>
								<button
									type="button"
									className="shipit-seo-native-panel__opener"
									data-dialog-opener="schema"
									title={preview ? "Opens Edit SEO on the Schema tab" : "Available once the preview loads"}
									aria-haspopup="dialog"
									disabled={!preview}
									onClick={(event) => openDialogFrom("schema", event.currentTarget)}
								>
									<TreeStructure size={14} aria-hidden="true" />
									<span>Schema</span>
								</button>
							</div>
						</div>

						<div className="shipit-seo-native-panel__workflow">
							<div
								className="shipit-seo-native-panel__strip"
								role="tablist"
								aria-label="SEO sections"
							>
								<button
									type="button"
									role="tab"
									id={`${tabId}-analysis-tab`}
									aria-controls={`${tabId}-analysis-panel`}
									aria-selected={activeView === "analysis"}
									tabIndex={activeView === "analysis" ? 0 : -1}
									data-strip-entry="analysis"
									onClick={() => selectView("analysis")}
									onKeyDown={handleTabKeyDown}
								>
									<ChartBar size={14} aria-hidden="true" />
									Analysis
								</button>
								<button
									type="button"
									role="tab"
									id={`${tabId}-advanced-tab`}
									aria-controls={`${tabId}-advanced-panel`}
									aria-selected={activeView === "advanced"}
									tabIndex={activeView === "advanced" ? 0 : -1}
									data-strip-entry="advanced"
									onClick={() => selectView("advanced")}
									onKeyDown={handleTabKeyDown}
								>
									<SlidersHorizontal size={14} aria-hidden="true" />
									Advanced
								</button>
							</div>

							<div
								className="shipit-seo-native-panel__view"
								role="tabpanel"
								id={`${tabId}-analysis-panel`}
								aria-labelledby={`${tabId}-analysis-tab`}
								data-editor-view="analysis"
								hidden={activeView !== "analysis"}
							>
								{renderAnalysis(handleCheckFix)}
							</div>
							<div
								className="shipit-seo-native-panel__view"
								role="tabpanel"
								id={`${tabId}-advanced-panel`}
								aria-labelledby={`${tabId}-advanced-tab`}
								data-editor-view="advanced"
								hidden={activeView !== "advanced"}
							>
								{activeView === "advanced" ? <>
									{advancedNotice}
									{preview ? (
										<AdvancedPanel
											preview={preview}
											siteNoindex={siteSettings ? siteSettings.noindex === true : null}
											directives={directives}
											directivesLoading={directivesLoading}
											directivesLoadError={directivesLoadError}
											directivesSaving={directivesSaving}
											directivesError={directivesError}
											onDirectivesSave={onDirectivesSave}
											onDirectivesRetry={onDirectivesRetry}
											editorActions={editorActions}
											editorDraft={editorDraft}
										/>
									) : (
										<PreviewState
											loading={previewLoading}
											error={previewError}
											onRetry={onPreviewRetry}
										/>
									)}
								</> : null}
							</div>
						</div>
					</div>

					{afterBody}
				</div>
			</div>
		</section>
	);
}

export function SeoAnalysisDisclosure({
	score,
	unavailableContent,
	advancedNotice,
	keywordEditorVisible = true,
	keywordCoverageConfirmed = false,
	keywordProfile,
	renderLocalAnalysis,
	headerAction,
	headerNotice,
	analysisHelp,
	basicAnalysis,
	analysisUpdating = false,
	analysisLoading = false,
	localKeywordsPending = false,
	onChooseCheckProfile,
	preview,
	savedEntry,
	savedSnapshot,
	locale,
	siteSettings,
	previewLoading,
	previewError,
	previewObservation,
	workspaceUrl,
	refreshing,
	sessionDisabled = false,
	refreshError,
	refreshErrorMessage,
	storedOutOfDate,
	keywordsValue,
	keywordsInherited,
	keywordInputValue,
	keywordSaveState,
	onKeywordRetry,
	pillar,
	onPillarChange,
	directives,
	directivesLoading,
	directivesLoadError,
	directivesSaving,
	directivesError,
	onDirectivesSave,
	onDirectivesRetry,
	onPreviewRetry,
	onRefresh,
	onKeywordInputChange,
	onKeywordAdd,
	onKeywordRemove,
	onKeywordPromote,
	onSocialSave,
	socialEditor,
	editorActions,
	editorDraft,
}: SeoAnalysisDisclosureProps) {
	const currentAnalysis = score !== null && hasCurrentEditorAnalysis(score);
	const source = editorAnalysisSource(score, basicAnalysis);
	const sourceBand = source ? sourceDisplay(source)?.band ?? null : null;
	const tone = source ? sourceBand ? BAND_TONES[sourceBand] : "neutral" : score ? analysisPresentation(score).tone : "neutral";
	const searchExclusion = source?.kind === "browser"
		? source.analysis.state === "ready"
			? source.analysis.result.checks.find((check) => check.basis === "measured" && check.condition === "excluded-from-search") ?? null
			: null
		: source ? searchExclusionCheck(source.score) : null;
	// Browser rows count only once their preview was confirmed for this saved version.
	const keywordCoverageAnalysis: KeywordCoverageAnalysis = source?.kind === "browser"
		? keywordCoverageConfirmed ? { ...source.analysis.result, keywords: keywordsValue } : null
		: source?.score ?? null;
	const canAddKeyword = keywordEditorVisible && (!keywordProfile || (keywordProfile.known && keywordProfile.status === "ready"));
	const sessionCheck = score ? (
		<section className="shipit-seo-analysis-options__section">
			<h4>Temporary session check</h4>
			<p>Checks the saved version for this session only. It does not update stored scores, badges or history.</p>
			<Button type="button" size="sm" variant="secondary" data-keep-mobile-sidebar-open loading={refreshing} disabled={refreshing || sessionDisabled} onClick={onRefresh}>Run without saving</Button>
		</section>
	) : null;

	return (
		<SeoEditorWorkflow
			advancedNotice={advancedNotice}
			preview={preview}
			savedEntry={savedEntry}
			savedSnapshot={savedSnapshot}
			locale={locale}
			siteSettings={siteSettings}
			previewLoading={previewLoading}
			previewError={previewError}
			previewObservation={previewObservation}
			directives={directives}
			directivesLoading={directivesLoading}
			directivesLoadError={directivesLoadError}
			directivesSaving={directivesSaving}
			directivesError={directivesError}
			onDirectivesSave={onDirectivesSave}
			onDirectivesRetry={onDirectivesRetry}
			onPreviewRetry={onPreviewRetry}
			onSocialSave={onSocialSave}
			socialEditor={socialEditor}
			editorActions={editorActions}
			editorDraft={editorDraft}
			tone={tone}
			serpQuery={keywordsValue[0] ?? ""}
			header={(showAnalysis) => <AnalysisHeader source={source} score={score} keywordsPending={localKeywordsPending}
				updating={analysisUpdating && source?.kind === "browser"} loading={analysisLoading}
				action={headerAction} notice={headerNotice} actionHelp={analysisHelp}
				onChooseCheckProfile={onChooseCheckProfile ? () => { showAnalysis(); onChooseCheckProfile(); } : undefined} />}
			searchExclusionShown={Boolean(searchExclusion)}
			beforeBody={searchExclusion ? (
				<p className="shipit-seo-native-panel__condition" role="status">
					<EyeSlash size={15} weight="fill" aria-hidden="true" />
					<span>
						<strong>Excluded from search.</strong> {searchExclusion.detail}
					</span>
				</p>
			) : null}
			renderKeywordEditor={keywordEditorVisible ? (tabId) => (<>
				{keywordProfile && keywordProfile.status !== "ready" ? (
					<div className="shipit-seo-native-panel__keyword-availability" role={keywordProfile.status === "unavailable" ? "alert" : "status"}>
						<strong>Focus keywords</strong>
						<span>{keywordProfile.status === "unavailable" ? keywordProfile.known ? "Focus keywords could not be refreshed. Your local changes are kept." : "Focus keywords could not be read. Retry before editing." : "Loading focus keywords..."}</span>
						{keywordProfile.status === "unavailable" ? <button type="button" onClick={keywordProfile.onRetry}>Retry keywords</button> : null}
					</div>
				) : null}
				{!keywordProfile || keywordProfile.known ? (
				<fieldset className="shipit-seo-native-panel__keyword-controls" disabled={Boolean(keywordProfile && keywordProfile.status !== "ready")}>
				<FocusKeywordEditor
					idPrefix={tabId}
					contentLabel={
						preview?.content.collection === "posts"
							? "post"
							: preview?.content.collection === "pages"
								? "page"
								: preview?.content.collection === "services"
									? "service"
									: "content"
					}
					keywords={keywordsValue}
					inherited={keywordsInherited}
					inputValue={keywordInputValue}
					saveState={keywordSaveState}
					onRetry={onKeywordRetry}
					pillar={pillar}
					onPillarChange={onPillarChange}
					coverageAnalysis={keywordCoverageAnalysis}
					onInputChange={onKeywordInputChange}
					onAdd={onKeywordAdd}
					onRemove={onKeywordRemove}
					onPromote={onKeywordPromote}
				/>
				</fieldset>
				) : null}
			</>
			) : undefined}
			renderAnalysis={(handleCheckFix) => {
				const checklist = source ? (
					<AnalysisChecklist source={source} onFix={handleCheckFix} canReviewSnippet={Boolean(preview)} canAddKeyword={canAddKeyword} />
				) : null;
				if (renderLocalAnalysis) return renderLocalAnalysis(handleCheckFix, checklist, sessionCheck);
				if (checklist) return checklist;
				return score ? (
					<div className="shipit-seo-native-panel-state" role="status">
						<p>{score.scoreVersion !== SEO_SCORE_VERSION
							? "Saved with an earlier analyzer."
							: storedOutOfDate
								? "Content or settings changed since the previous analysis."
								: "This analysis has not been checked against the saved content and current settings."}</p>
						<p>Use Save analysis in Analysis options to check this version.{score.persistence !== "session" ? " Previous results remain in your score history." : ""}</p>
					</div>
				) : unavailableContent;
			}}
			afterBody={<>
				{score && refreshError ? (
					<p className="shipit-seo-native-panel__error" role="alert">
						{refreshErrorMessage || "The score could not be refreshed."}
					</p>
				) : null}
				{!renderLocalAnalysis && sessionCheck ? (
					<details className="shipit-seo-analysis-details shipit-seo-analysis-options">
						<summary>Analysis options</summary>
						{sessionCheck}
					</details>
				) : null}
				<div className="shipit-seo-native-panel__footer">
					{score ? <>
					<span
						className="shipit-seo-native-panel__live"
						data-state="saved"
					>
						<span aria-hidden="true" />
						{!currentAnalysis
							? score.scoreVersion !== SEO_SCORE_VERSION
								? "Earlier analyzer. Analyze again."
								: score.freshness === "stale"
									? "Previous analysis; not verified for the current saved content"
									: "Saved analysis; current content not checked"
							: score.persistence === "session"
							? "Saving content rechecks only this entry during this session"
							: "Stored analysis matches this saved entry and its settings"}
					</span>
					</> : null}
					<a className="shipit-seo-native-panel__workspace" href={workspaceUrl}>
						Open SEO workspace
						<ArrowSquareOut size={13} aria-hidden="true" />
					</a>
				</div>
			</>}
		/>
	);
}

/** A permission refusal is final for this panel; retrying it only delays the explanation. */
function retryUnlessDenied(failureCount: number, error: unknown): boolean {
	return !isPermissionDenied(error) && failureCount < 1;
}

const OWNERSHIP_WORKSPACE_URL = `${SEO_WORKSPACE_URL}${buildSeoAdminSearch("", "migration")}`;

function ownershipStaleText(notice: Extract<SeoOwnershipNotice, { kind: "stale" }>): string {
	const earlier = notice.savedVersionChanged ? "an earlier save of this entry" : "this saved version";
	if (notice.cause === "refreshing") return `Out of date while the saved values are checked again. Shown for ${earlier}.`;
	if (notice.cause === "failed") return `Out of date: the saved values could not be checked again. Shown for ${earlier}.`;
	return `Out of date${notice.reason ? `: ${SEO_OWNERSHIP_REASON_LABELS[notice.reason]}` : "."} Shown for ${earlier}.`;
}

/**
 * Who decides each saved SEO field, from Shipit's preview of this entry. It
 * describes saved values only and writes nothing; EmDash's SEO panel stays the
 * only editor of core SEO.
 */
function SavedOwnershipNotice({ notice, published }: { notice: SeoOwnershipNotice; published: boolean }) {
	const brand = useSeoBrand();
	if (notice.kind === "loading" || notice.kind === "permission-denied") return null;
	if (notice.kind === "unavailable") {
		return (
			<section className="shipit-seo-field-ownership" data-state="unknown" aria-label="Saved SEO ownership">
				<strong>Saved SEO ownership is unknown</strong>
				<p role="status">
					{notice.reason
						? SEO_OWNERSHIP_REASON_LABELS[notice.reason]
						: notice.cause === "failed"
							? "The saved values could not be checked. A legacy record may still decide some fields."
							: "This plugin could not establish which record decides each saved field."}
				</p>
			</section>
		);
	}
	const { ownership } = notice;
	const views = seoOwnershipFieldViews(ownership);
	const summary = seoOwnershipSummary(ownership);
	const stale = notice.kind === "stale";
	const staleNote = stale ? <p className="shipit-seo-field-ownership__stale" role="status">{ownershipStaleText(notice)}</p> : null;
	const draftNote = !published
		? <p>This entry is not published, so it has no public page yet. These are its saved values.</p>
		: null;
	if (summary.coreOnly) {
		// Empty core values still fall back to Shipit templates and defaults, so this never claims core decides everything.
		return (
			<section className="shipit-seo-field-ownership" data-state={stale ? "stale" : "core"} aria-label="Saved SEO ownership">
				{staleNote}
				<p>
					No legacy record applies to this entry. Its saved EmDash SEO values and configured
					defaults determine the supported metadata.
				</p>
				{draftNote}
			</section>
		);
	}
	const equal = views.filter((view) => view.state === "equal");
	const notShadowed = views.filter((view) => view.state === "not-shadowed");
	const record = ownership.record;
	return (
		<section className="shipit-seo-field-ownership" data-state={stale ? "stale" : "legacy"} aria-label="Saved SEO ownership">
			{staleNote}
			<strong>{record ? "A legacy record decides saved SEO fields" : "Saved SEO ownership"}</strong>
			{record ? (
				<p>
					Record <code>{record.sourceOverrideId}</code>{" "}
					{record.keyKind === "id"
						? "is stored under this entry's ID."
						: "is stored under this entry's slug. Any entry with the same slug in this collection shares it."}
				</p>
			) : null}
			{draftNote}
			<dl className="shipit-seo-field-ownership__fields">
				{views.filter((view) => view.state === "conflict" || view.state === "unknown").map((view) => (
					<div key={view.field} data-state={view.state}>
						<dt>{view.label}</dt>
						<dd>
							{view.state === "conflict" ? (
								<>
									Uses <q>{view.effective}</q> from the legacy record. Saved in EmDash SEO and not used: <q>{view.core}</q>.
								</>
							) : (
								<>Unknown. {view.reason}</>
							)}
							{view.social ? <> {view.social}</> : null}
						</dd>
					</div>
				))}
			</dl>
			{equal.length ? (
				<p>Same value in EmDash SEO and the legacy record: {equal.map((view) => view.label).join(", ")}.</p>
			) : null}
			{notShadowed.length ? (
				<p>EmDash SEO or this plugin's defaults decide: {notShadowed.map((view) => view.label).join(", ")}.</p>
			) : null}
			{ownership.unsupportedDirectives.state === "present" ? (
				<p>Robots directives EmDash SEO cannot store: {ownership.unsupportedDirectives.tokens.join(", ")}.</p>
			) : ownership.unsupportedDirectives.state === "unknown" ? (
				<p>The legacy record's robots directives could not be read.</p>
			) : null}
			{record ? <a href={OWNERSHIP_WORKSPACE_URL}>Review legacy records in {brand.name}</a> : null}
		</section>
	);
}

function SeoEditorPanel(context: ShipitContentEditorPanelContext) {
	if (!context.entry) {
		return (
			<div className="shipit-seo-native-panel-state">
				<span>Save this entry before running SEO analysis.</span>
			</div>
		);
	}

	return (
		<>
			<SavedSeoEditorPanel
				key={entryRef(context.collection, context.entry.id) + ":" + (context.locale ?? context.entry.locale ?? "")}
				{...context}
				entry={context.entry}
			/>
			<InternalLinkSuggestions
				key={JSON.stringify([context.collection, context.entry.id, context.entry.locale ?? null])}
				collection={context.collection}
				entryId={context.entry.id}
				entryLocale={typeof context.entry.locale === "string" ? context.entry.locale : null}
				contextLocale={context.locale ?? null}
				savedVersion={editorSavedVersion(context.entry)}
			/>
		</>
	);
}

export function SeoEditorPanelRoot(context: ShipitContentEditorPanelContext) {
	const socialOwner = useSocialEditorOwner(context.entry ? {
		ref: entryRef(context.collection, context.entry.id),
		locale: context.locale ?? (typeof context.entry.locale === "string" ? context.entry.locale : null),
	} : null);
	const hostClient = React.useContext(QueryClientContext);
	const brand = useSeoHostBrand(hostClient === contentExtensionQueryClient ? null : hostClient);
	if (socialOwner.pending) return <span hidden ref={socialOwner.probe} />;
	return (
		<NativeSeoHostProvider>
		<QueryClientProvider client={contentExtensionQueryClient}>
			<SeoBrandProvider value={brand}>
			<SocialEditorOwnerContext.Provider value={socialOwner.store}>
				<SeoEditorPanel {...context} />
			</SocialEditorOwnerContext.Provider>
			</SeoBrandProvider>
		</QueryClientProvider>
		</NativeSeoHostProvider>
	);
}

/** A stored score shown as recorded, with no analysis and no editable inputs. */
function StoredScoreHistory({ score, notice }: { score: SeoAdminContentScore; notice: string }) {
	const summary = storedScoreSummary(score);
	return (
		<div className="shipit-seo-native-panel-state">
			<strong>{summary.label}</strong>
			<span>{notice}</span>
			<span>{summary.keywords}</span>
		</div>
	);
}

function SavedSeoEditorPanel({
	collection,
	locale,
	entry,
	actions,
	draft,
}: ShipitContentEditorPanelContext & { entry: ContentItem }) {
	const queryClient = useQueryClient();
	const previewLocale = locale ?? (typeof entry.locale === "string" ? entry.locale : null);
	// The draft/baseline pair tracks the PROFILE STATEMENT (null = the user has
	// made none), never the effective analyzer keywords: inherited content
	// keywords stay display-only until an intentional keyword edit adopts them.
	const [keywordDraft, setKeywordDraft] = React.useState<SeoKeywordStatement>(null);
	const [keywordBaseline, setKeywordBaseline] = React.useState<SeoKeywordStatement>(null);
	const [keywordInput, setKeywordInput] = React.useState("");
	const [pillarDraft, setPillarDraft] = React.useState(false);
	const [pillarBaseline, setPillarBaseline] = React.useState(false);
	const [keywordSavedFlash, setKeywordSavedFlash] = React.useState(false);
	const [keywordWriteUnconfirmed, setKeywordWriteUnconfirmed] = React.useState(false);
	const keywordWriteEpoch = React.useRef(0);
	// Resetting a mutation observer does not cancel its network write.
	const keywordWrites = React.useRef(new Set<number>());
	const [keywordWritesPending, setKeywordWritesPending] = React.useState(0);
	const ref = entryRef(collection, entry.id);
	const entryLocale = typeof entry.locale === "string" ? entry.locale : null;
	const socialEditor = useSocialEditor(React.useContext(SocialEditorOwnerContext), ref, locale ?? entryLocale);
	const savedVersion = React.useMemo(() => editorSavedVersion(entry), [entry]);
	const resolvedPreviewKey = previewQueryKey(ref, savedVersion, previewLocale);
	const profileKey = [SCORE_QUERY_SCOPE, "profile", ref];
	// Keep the saved-analysis action description available to keyboard and assistive-technology users.
	const analysisHelpId = React.useId();
	const settingsQuery = useQuery({
		queryKey: [SCORE_QUERY_SCOPE, "site-settings"],
		queryFn: () => fetchSeoAdminSettings(),
		staleTime: 0,
		retry: retryUnlessDenied,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
		refetchOnReconnect: false,
	});
	// A focus or visibility refetch must not swap the panel for a loading state:
	// that unmounts the open SEO dialog and its unsaved input.
	const settingsConfirmed = React.useRef(false);
	settingsConfirmed.current = readAfterMountConfirmed(settingsConfirmed.current, settingsQuery);
	const settingsReady = settingsConfirmed.current;
	const scoringPolicy = settingsQuery.data?.contentScoring;
	const scoringEnabled = settingsReady && scoringPolicy?.state === "enabled";
	const assessmentQuery = useCollectionAnalysisProfile(collection);
	const assessmentSelection = assessmentQuery.data?.selection;
	const assessmentReady = assessmentQuery.isFetchedAfterMount && assessmentQuery.isSuccess && !assessmentQuery.isFetching && !assessmentQuery.isError;
	const assessmentConfigured = assessmentSelection?.state === "configured" && !assessmentQuery.isError;
	const assessmentBoundary = JSON.stringify(assessmentSelection ?? null);
	const [assessmentDirty, setAssessmentDirty] = React.useState(false);
	const [assessmentDisclosureOpen, setAssessmentDisclosureOpen] = React.useState(false);
	const assessmentControlRef = React.useRef<HTMLElement>(null);
	const assessmentFocusCancel = React.useRef<(() => void) | null>(null);
	React.useLayoutEffect(() => () => {
		assessmentFocusCancel.current?.();
		assessmentFocusCancel.current = null;
	}, [ref, previewLocale]);
	const chooseCheckProfile = React.useCallback(() => {
		assessmentFocusCancel.current?.();
		setAssessmentDisclosureOpen(true);
		assessmentFocusCancel.current = afterPaint(() => {
			assessmentFocusCancel.current = null;
			focusEditorCheckProfile(assessmentControlRef.current);
		});
	}, []);
	// Settings that load without values leave the scoring state unknown, which is not scoring off.
	const scoringUnknown = settingsReady && (settingsQuery.data?.values === null || scoringPolicy?.state === "unavailable");
	const profileQuery = useQuery({
		queryKey: profileKey,
		queryFn: async ({ signal }) => {
			const result = await fetchSeoAnalysisProfile(ref, { signal });
			if (!result.success) throw new Error("Analysis settings could not be loaded.");
			return result;
		},
		enabled: true,
		staleTime: 0,
		retry: retryUnlessDenied,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const analysisAdmitted = scoringEnabled && assessmentConfigured && !assessmentDirty && !settingsQuery.isError && !profileQuery.isError;
	// Saved results stay readable whatever the scoring, settings or profile state.
	const storedScoreQuery = useQuery({
		queryKey: [SCORE_QUERY_SCOPE, "stored-entry", ref, savedVersion],
		queryFn: ({ signal }) => fetchSeoContentScore(ref, { storedOnly: true, snapshotOnly: true, signal }),
		staleTime: 0,
		retry: retryUnlessDenied,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const profileReady = profileQuery.isFetchedAfterMount && profileQuery.isSuccess && !profileQuery.isFetching;
	const profileInitialized = React.useRef(false);
	const refreshRequest = React.useRef(0);
	const [sessionState, setSessionState] = React.useState<EditorSessionAnalysisState>({
		score: null, savedVersion: null, pending: false, error: null,
	});
	const [savedReadbackState, setSavedReadbackState] = React.useState<SavedAnalysisReadbackState>({
		target: null, score: null, pending: false, failure: null,
	});
	const [savedReadback] = React.useState(() => createSavedAnalysisReadback({
		read: (requestedRef, signal) => fetchSeoContentScore(requestedRef, { storedOnly: true, signal }),
		onChange: setSavedReadbackState,
	}));
	// Each return to the tab expires a confirmed stored result; this asks for it to be confirmed again.
	const [storedCheckEpoch, setStoredCheckEpoch] = React.useState(0);
	const settingsBoundary = JSON.stringify([settingsQuery.data?.values ?? null, scoringPolicy ?? null]);
	const profileBoundary = JSON.stringify([profileQuery.data?.profile ?? null, assessmentBoundary]);
	React.useEffect(() => {
		savedReadback.invalidate();
	}, [savedReadback, savedVersion, entryLocale, scoringEnabled, settingsBoundary, profileBoundary, settingsQuery.isError, profileQuery.isError]);
	React.useEffect(() => queryClient.getQueryCache().subscribe((event) => {
		if (event.type === "updated" && event.action.type === "invalidate" &&
			event.query.queryKey[0] === SCORE_QUERY_SCOPE && event.query.queryKey[1] === "preview" && event.query.queryKey[2] === ref)
			savedReadback.invalidate();
	}), [queryClient, ref, savedReadback]);
	const [profileRefreshFailed, setProfileRefreshFailed] = React.useState(false);
	const [sessionAnalysis] = React.useState(() => createEditorSessionAnalysis({
		ref,
		savedUpdatedAt: entry.updatedAt ?? null,
		savedVersion,
		locale: typeof entry.locale === "string" ? entry.locale : null,
		onChange: setSessionState,
		analyze: async (requestedRef, signal, analysisOptions) => {
			const result = await auditSeoContent([requestedRef], { signal });
			const score = result.items.find((item) => item.ref === requestedRef);
			if (!score) throw new Error("This entry could not be analyzed. Try again.");
			if (!keywordStatementsMatch(score.profileKeywords ?? null, analysisOptions.keywords) ||
				score.pillar !== (analysisOptions.pillar ?? false)) {
				throw new Error("Analysis settings changed. Refresh this entry's analysis.");
			}
			return score;
		},
		currentIdentity: (requestedRef, signal) => fetchSeoEntryAnalysisIdentity(requestedRef, { signal }),
	}));
	React.useEffect(() => () => {
		refreshRequest.current += 1;
		sessionAnalysis.cancel();
		savedReadback.invalidate();
	}, [sessionAnalysis, savedReadback]);
	React.useEffect(() => {
		if (!analysisAdmitted) {
			refreshRequest.current += 1;
			sessionAnalysis.cancel();
		}
	}, [analysisAdmitted, sessionAnalysis]);
	React.useEffect(() => {
		sessionAnalysis.cancel();
		void sessionAnalysis.updateSavedVersion(entry.updatedAt ?? null, savedVersion);
	}, [sessionAnalysis, entry.updatedAt, savedVersion]);
	React.useEffect(() => {
		if (!profileReady || !profileQuery.data || profileQuery.isError) return;
		const profile = profileQuery.data.profile;
		if (!profileInitialized.current || (keywordStatementsMatch(keywordDraft, keywordBaseline) && pillarDraft === pillarBaseline)) {
			setKeywordDraft(profile?.keywords ?? null);
			setKeywordBaseline(profile?.keywords ?? null);
			setPillarDraft(profile?.pillar ?? false);
			setPillarBaseline(profile?.pillar ?? false);
			profileInitialized.current = true;
		}
	}, [profileReady, profileQuery.data, profileQuery.isError]);
	React.useEffect(() => {
		if (!analysisAdmitted || !profileReady || !profileQuery.data) return;
		const profile = profileQuery.data.profile;
		const analysisOptions = { keywords: profile?.keywords ?? null, pillar: profile?.pillar ?? false };
		// A refetch with the same profile must not abort the analysis Refresh just started.
		if (!sessionAnalysis.hasAnalysisOptions(analysisOptions)) {
			sessionAnalysis.cancel();
			void sessionAnalysis.updateAnalysisOptions(analysisOptions);
		}
		// A result kept from earlier in this page load returns only after the engine confirms it.
		void sessionAnalysis.resume();
	}, [analysisAdmitted, profileReady, profileQuery.data, assessmentBoundary, sessionAnalysis]);
	React.useEffect(() => {
		if (!analysisAdmitted) return;
		// Settings can change in another tab or view; a shown result is confirmed again on return.
		const revalidate = () => {
			savedReadback.invalidate();
			if (document.visibilityState === "visible") {
				void sessionAnalysis.revalidate();
				setStoredCheckEpoch((value) => value + 1);
			}
		};
		window.addEventListener("focus", revalidate);
		document.addEventListener("visibilitychange", revalidate);
		return () => {
			window.removeEventListener("focus", revalidate);
			document.removeEventListener("visibilitychange", revalidate);
		};
	}, [analysisAdmitted, sessionAnalysis, savedReadback]);
	React.useEffect(() => {
		if (analysisAdmitted) return;
		// A manual proof expires on return without starting a freshness read or analysis.
		const invalidate = () => savedReadback.invalidate();
		window.addEventListener("focus", invalidate);
		document.addEventListener("visibilitychange", invalidate);
		return () => {
			window.removeEventListener("focus", invalidate);
			document.removeEventListener("visibilitychange", invalidate);
		};
	}, [analysisAdmitted, savedReadback]);
	const sessionScore = analysisAdmitted && sessionState.score?.assessmentProfile?.profile ===
		(assessmentSelection?.state === "configured" ? assessmentSelection.profile : null)
		? editorSessionScoreForSavedVersion(sessionState.score, entry.updatedAt ?? null, sessionState.savedVersion, savedVersion) : null;
	const storedSnapshot = storedScoreQuery.data
		? editorSessionScoreForSavedVersion(
			storedScoreQuery.data,
			entry.updatedAt ?? null,
			storedScoreQuery.data.sourceVersion ?? null,
			savedVersion,
		)
		: null;
	const verifiedStoredScore = verifiedSavedAnalysisForTarget(savedReadbackState, { ref, locale: entryLocale, savedVersion });
	const profileScore = verifiedStoredScore ?? storedSnapshot;
	const storedProfileChanged = profileScore && (
		(profileReady && !scoreMatchesProfile(profileScore, profileQuery.data?.profile ?? null)) ||
		!assessmentConfigured || profileScore.assessmentProfile?.profile !==
			(assessmentSelection?.state === "configured" ? assessmentSelection.profile : null));
	const { score, storedOutOfDate } = selectEditorScore({
		sessionScore,
		storedSnapshot,
		verifiedStoredScore,
		storedProfileChanged: Boolean(storedProfileChanged),
	});
	// A stored result for this saved version and its saved keywords is shown once one freshness
	// read confirms it, including after a reload; otherwise the browser checks stay the source.
	const storedCandidate = !verifiedStoredScore && storedSnapshot && storedSnapshot.freshness !== "stale" &&
		storedSnapshot.persistence !== "session" && storedSnapshot.scoreVersion === SEO_SCORE_VERSION &&
		storedSnapshot.sourceVersion === savedVersion && profileReady && !storedProfileChanged ? storedSnapshot : null;
	const storedCheckKey = storedCandidate ? JSON.stringify([ref, entryLocale, savedVersion, storedCandidate.inputIdentity ?? null,
		storedCandidate.analysisRevision ?? null, profileBoundary, storedCheckEpoch]) : null;
	const storedCheckRequested = React.useRef<string | null>(null);
	const refreshHostEntry = useHostEntryRefresh();
	// The host can show a cached entry when it is reopened; each newer saved version a preview read
	// reports refreshes it once, so a host that stays behind cannot start a loop.
	const hostRefreshedVersions = React.useRef(new Set<string>());
	const hostRefreshRequest = React.useRef(0);
	const [hostRefresh, setHostRefresh] = React.useState<{ from: string; done: boolean; changed: boolean } | null>(null);
	// A changed host entry reaches this panel as a new saved version, which ends the refresh.
	const hostRefreshing = hostRefresh !== null && hostRefresh.from === savedVersion && (!hostRefresh.done || hostRefresh.changed);
	const previewQuery = useQuery({
		queryKey: resolvedPreviewKey,
		queryFn: async ({ signal }) => {
			const observation: SocialPreviewObservation = {
				target: { ref, locale: previewLocale },
				owner: socialEditor.previewOwnerRef.current,
				canonicalEpoch: socialEditor.previewEpochRef.current,
			};
			const result = await fetchSeoAdminEntryPreview(ref, undefined, { entryOnly: true, savedVersion, signal });
			if (!result.success) throw new Error("Resolved metadata could not be loaded.");
			return { ...result, observation };
		},
		enabled: true,
		staleTime: 60_000,
		// One request per read and per Retry; a newer saved entry is answered by refreshing the host entry.
		retry: false,
		// Ownership is current only from a response this panel requested.
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	// Every Retry sends a request: the host entry read when the saved entry is newer, else the preview read.
	const retryPreview = () => {
		if (!(previewQuery.error instanceof SavedContentChangedError) || !refreshHostEntry) {
			void previewQuery.refetch();
			return;
		}
		const request = ++hostRefreshRequest.current;
		const from = savedVersion;
		setHostRefresh({ from, done: false, changed: false });
		void refreshHostEntry(collection, entry.id, entryLocale).then(({ changed }) => {
			if (request !== hostRefreshRequest.current) return;
			setHostRefresh({ from, done: true, changed });
			if (!changed) void previewQuery.refetch();
		});
	};
	const newerSavedVersion = previewQuery.error instanceof SavedContentChangedError && previewQuery.error.sourceVersion !== savedVersion
		? previewQuery.error.sourceVersion : null;
	React.useEffect(() => {
		if (newerSavedVersion === null || hostRefreshedVersions.current.has(newerSavedVersion)) return;
		hostRefreshedVersions.current.add(newerSavedVersion);
		retryPreview();
	}, [newerSavedVersion]);
	// The refresh above starts after this render, so a newer saved entry reads as updating from its first frame.
	const previewRefreshing = hostRefreshing || (newerSavedVersion !== null &&
		(!hostRefreshedVersions.current.has(newerSavedVersion) || previewQuery.isFetching));
	const preview = previewQuery.data?.success && savedSnapshotMatches(
		{ ...previewQuery.data.preview, ref: previewQuery.data.preview.content.ref },
		{ ref, sourceVersion: savedVersion },
	) ? previewQuery.data.preview : null;
	// Keyed by entry and locale only, so a newer saved version keeps the open SEO dialog mounted.
	const previewRetention = React.useRef<RetainedEntryPreview<{ preview: SeoAdminEntryPreview; observation?: SocialPreviewObservation }> | null>(null);
	const shownPreview = retainEntryPreview(previewRetention.current, JSON.stringify([ref, previewLocale]),
		preview ? { preview, observation: previewQuery.data?.observation } : null);
	previewRetention.current = shownPreview.retained;
	// Kept per mount: navigation and a requested-locale switch remount the panel and start empty.
	const ownershipRetention = React.useRef<SeoOwnershipRetention | null>(null);
	const ownershipResolution = resolveSeoOwnershipNotice({
		ref,
		savedVersion,
		retained: ownershipRetention.current,
		observation: {
			preview,
			fetchedAfterMount: previewQuery.isFetchedAfterMount,
			fetching: previewQuery.isFetching || previewRefreshing,
			error: previewRefreshing ? null : previewQuery.error,
		},
	});
	ownershipRetention.current = ownershipResolution.retained;
	const refresh = {
		isPending: sessionState.pending,
		isError: sessionState.error !== null || profileRefreshFailed,
		mutate: () => {
			if (!analysisAdmitted) return;
			savedReadback.invalidate();
			const request = ++refreshRequest.current;
			setProfileRefreshFailed(false);
			void (async () => {
				const refreshed = await profileQuery.refetch();
				if (request !== refreshRequest.current) return;
				if (!refreshed.data || refreshed.isError) {
					setProfileRefreshFailed(true);
					// Nothing shown stays current when its inputs could not be read again.
					sessionAnalysis.invalidate();
					return;
				}
				const profile = refreshed.data.profile;
				// One request with the refetched profile; no automatic run starts first.
				await sessionAnalysis.analyze({ keywords: profile?.keywords ?? null, pillar: profile?.pillar ?? false });
			})();
		},
	};
	// A result belongs to the saved version and locale it was requested for; a
	// late answer never becomes the notice of a newer saved version.
	const savedAnalysisEpoch = JSON.stringify([ref, entryLocale, savedVersion, assessmentBoundary]);
	const [savedAnalysisResult, setSavedAnalysisResult] = React.useState<{ epoch: string; notice: SeoSavedAnalysisNotice } | null>(null);
	const savedAnalysis = useMutation({
		retry: false,
		mutationFn: (request: { epoch: string; locale: string | null; savedVersion: string; readbackToken: number }) => analyzeSavedSeoContent(ref, request.locale),
		onSuccess: async (result, request) => {
			if (result.success || result.error === "profile_required" || result.error === "profile_unavailable") {
				void queryClient.invalidateQueries({ queryKey: collectionAnalysisProfileKey(collection), exact: true });
			}
			let notice = savedAnalysisNotice(result, request.savedVersion);
			if (result.success) {
				// A session result confirmed earlier no longer outranks the newer stored one.
				if (savedReadback.isCurrent(request.readbackToken)) sessionAnalysis.invalidate();
				void Promise.allSettled([
					queryClient.invalidateQueries({ queryKey: [SCORE_QUERY_SCOPE, "stored-entry", ref] }),
					queryClient.invalidateQueries({ queryKey: [SCORE_QUERY_SCOPE, "collection", collection] }),
				]);
				const confirmation = await savedReadback.verify(result, {
					ref, locale: request.locale, savedVersion: request.savedVersion,
				}, request.readbackToken);
				const warning = savedAnalysisReadbackWarning(confirmation);
				if (warning) notice = { tone: "warning", message: `${notice.message} ${warning}` };
			} else if (result.error === "scoring_disabled" || result.error === "activation_required") {
				void settingsQuery.refetch();
			}
			setSavedAnalysisResult({ epoch: request.epoch, notice });
		},
		onError: (error, request) => {
			setSavedAnalysisResult({ epoch: request.epoch, notice: savedAnalysisRequestFailureNotice(isPermissionDenied(error)) });
		},
	});
	React.useEffect(() => {
		if (!storedCheckKey || !storedCandidate || storedCheckRequested.current === storedCheckKey || savedAnalysis.isPending) return;
		storedCheckRequested.current = storedCheckKey;
		void savedReadback.confirmStored(storedCandidate, { ref, locale: entryLocale, savedVersion }, savedReadback.begin());
	}, [storedCheckKey, savedAnalysis.isPending]);
	const savedNotice = savedAnalysisResult?.epoch === savedAnalysisEpoch ? savedAnalysisResult.notice : null;
	const savedNoticeElement = savedNotice ? (
		<p className="shipit-seo-native-panel-state" role={savedNotice.tone === "success" ? "status" : "alert"}>
			{savedNotice.message}
		</p>
	) : null;
	const historyScore = verifiedStoredScore ?? storedSnapshot;
	const storedHistory = (notice: string) => historyScore ? <StoredScoreHistory score={historyScore} notice={notice} /> : null;

	// Handler-scope mirrors so a mutation response can tell whether the user
	// kept editing while the request was in flight.
	const keywordDraftRef = React.useRef<SeoKeywordStatement>(null);
	const pillarDraftRef = React.useRef(false);
	React.useEffect(() => {
		keywordDraftRef.current = keywordDraft;
		pillarDraftRef.current = pillarDraft;
	}, [keywordDraft, pillarDraft]);
	const keywordSavedFlashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	React.useEffect(
		() => () => {
			if (keywordSavedFlashTimer.current !== null) {
				clearTimeout(keywordSavedFlashTimer.current);
			}
		},
		[],
	);
	const keywordSave = useMutation({
		onMutate: () => {
			const writeEpoch = ++keywordWriteEpoch.current;
			keywordWrites.current.add(writeEpoch);
			setKeywordWritesPending(keywordWrites.current.size);
			setKeywordWriteUnconfirmed(true);
			savedReadback.invalidate();
			return writeEpoch;
		},
		scope: { id: `seo-keyword-profile:${ref}` },
		// The profile write is last-writer-wins and a failed request may already
		// be stored, so a failure waits for the user's Retry.
		retry: false,
		mutationFn: async (input: { keywords: SeoKeywordStatement; pillar: boolean }) => {
			const result = await saveSeoFocusKeywords(ref, input.keywords, {
				pillar: input.pillar,
				profileOnly: true,
			});
			if (!result.success) {
				throw profileSaveErrorFromRoute(result.error, focusKeywordErrorMessage(result.error));
			}
			return result;
		},
		onSuccess: async (result, variables, writeEpoch) => {
			refreshRequest.current += 1;
			await queryClient.cancelQueries({ queryKey: profileKey, exact: true });
			// The baseline is the PROFILE STATEMENT, not the analyzer's effective
			// keywords: the score echo can include the content-derived fallback
			// keyword, and treating that as baseline would re-arm the autosave
			// forever after the user clears the list.
			const profileStatement: SeoKeywordStatement = result.profile
				? result.profile.keywords === null
					? null
					: normaliseKeywordChips(result.profile.keywords)
				: null;
			const profilePillar = result.profile?.pillar ?? false;
			const isCurrentDraft =
				keywordStatementsMatch(keywordDraftRef.current, variables.keywords) &&
				pillarDraftRef.current === variables.pillar;
			setKeywordBaseline(profileStatement);
			setPillarBaseline(profilePillar);
			if (isCurrentDraft) {
				setKeywordDraft(profileStatement);
				setPillarDraft(profilePillar);
			}
			setKeywordSavedFlash(isCurrentDraft);
			if (keywordSavedFlashTimer.current !== null) {
				clearTimeout(keywordSavedFlashTimer.current);
			}
			keywordSavedFlashTimer.current = setTimeout(() => setKeywordSavedFlash(false), 2_500);
			queryClient.setQueryData(profileKey, result);
			if (writeEpoch === keywordWriteEpoch.current) setKeywordWriteUnconfirmed(false);
		},
		onSettled: (_result, _error, _variables, writeEpoch) => {
			if (writeEpoch !== undefined) keywordWrites.current.delete(writeEpoch);
			setKeywordWritesPending(keywordWrites.current.size);
		},
	});
	const directivesQuery = useQuery({
		queryKey: [SCORE_QUERY_SCOPE, "directives", ref],
		queryFn: async ({ signal }) => {
			const result = await fetchSeoEntryDirectives(ref, { signal });
			// A rejected read must surface as a query error, never as "no
			// directives" — defaults rendered as editable state could otherwise
			// silently overwrite the real stored record on the next toggle.
			if (!result.success) {
				throw new Error("Robots directives could not be loaded.");
			}
			return result.item;
		},
		staleTime: 300_000,
		retry: 1,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const directivesSave = useMutation({
		onMutate: () => savedReadback.invalidate(),
		mutationFn: async (change: SeoRobotsDirectiveChange) => {
			// The record is written without a revision, so the whole robots object is
			// rebuilt from a read taken now; the cached read can predate another
			// admin's change.
			const read = await fetchSeoEntryDirectives(ref);
			if (!read.success) {
				throw new Error("Robots directives could not be saved.");
			}
			const robots = { ...(read.item?.robots ?? ROBOTS_DIRECTIVE_DEFAULTS), [change.key]: change.value };
			const result = await saveSeoEntryDirectives(ref, robots);
			if (!result.success) {
				throw new Error("Robots directives could not be saved.");
			}
			return result;
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [SCORE_QUERY_SCOPE, "directives", ref],
				exact: true,
			});
		},
	});
	const socialSave = useMutation({
		onMutate: () => savedReadback.invalidate(),
		mutationFn: (input: { ref: string; values: SeoAdminSocialOverrideValues & { expectedRevision: string | null } }) =>
			saveSeoAdminEntrySocial(input.ref, input.values),
		onSuccess: (result, input) => {
			if (result.success) void queryClient.invalidateQueries({
				queryKey: [SCORE_QUERY_SCOPE, "preview", input.ref],
			});
		},
	});

	// Keyword-profile autosave: chip edits persist on their own after a short
	// pause ("Score follows the primary keyword" only works when the profile is
	// actually saved). A newer edit always cancels the pending save so a stale
	// payload can never overwrite fresher input.
	const keywordSaveMutateRef = React.useRef(keywordSave.mutate);
	keywordSaveMutateRef.current = keywordSave.mutate;
	const keywordAutosave = React.useMemo(
		() =>
			createCancellableDebounce<{
				keywords: SeoKeywordStatement;
				pillar: boolean;
			}>((input) => keywordSaveMutateRef.current(input), KEYWORD_AUTOSAVE_DELAY_MS),
		[ref],
	);
	React.useEffect(() => () => keywordAutosave.cancel(), [keywordAutosave]);
	React.useEffect(() => {
		if (!profileReady || profileQuery.isError) {
			keywordAutosave.cancel();
			return;
		}
		if (!profileInitialized.current || (keywordStatementsMatch(keywordDraft, keywordBaseline) && pillarDraft === pillarBaseline)) {
			keywordAutosave.cancel();
			return;
		}
		// A pillar-only change sends `keywords: null` so the engine preserves the
		// stored statement instead of adopting an inherited content keyword.
		keywordAutosave.schedule({ keywords: keywordDraft, pillar: pillarDraft });
	}, [profileReady, profileQuery.isError, keywordAutosave, keywordDraft, keywordBaseline, pillarDraft, pillarBaseline]);
	const workspaceUrl = `${SEO_WORKSPACE_URL}?view=content&ref=${encodeURIComponent(ref)}`;
	const keywordStatement = profileInitialized.current ? keywordDraft : profileQuery.data?.profile?.keywords ?? null;
	const savedSnapshot = previewQuery.data?.savedSnapshot ?? null;
	const basicPreviewReady = Boolean(preview) && previewQuery.isFetchedAfterMount && previewQuery.isSuccess && !previewQuery.isFetching && !previewQuery.isError;
	const basicKeywordOwnership = React.useMemo(() => resolveEditorBasicKeywordOwnership({
		snapshot: savedSnapshot, ref, sourceVersion: savedVersion, profile: profileQuery.data?.profile ?? null,
		profileReady, keywords: keywordStatement,
	}), [savedSnapshot, ref, savedVersion, profileQuery.data, profileReady, keywordStatement]);
	const basicAnalysis = React.useMemo(() => resolveEditorBasicAnalysis({
		preview: basicPreviewReady ? preview : null, snapshot: savedSnapshot, ref, sourceVersion: savedVersion, locale: previewLocale,
		profile: profileQuery.data?.profile ?? null, profileReady, keywords: keywordStatement,
		assessment: assessmentSelection ?? null, assessmentReady,
		publicationStatus: entry.status, pillar: profileInitialized.current ? pillarDraft : profileQuery.data?.profile?.pillar,
	}), [preview, basicPreviewReady, savedSnapshot, ref, savedVersion, previewLocale, profileQuery.data, profileReady, keywordStatement,
		assessmentSelection, assessmentReady, entry.status, pillarDraft]);
	// Inputs being read again keep the last browser checks on screen, marked as updating.
	const basicRetention = React.useRef<{ key: string; analysis: Extract<EditorBasicAnalysis, { state: "ready" | "partial" }> } | null>(null);
	const basicRetentionKey = JSON.stringify([ref, previewLocale]);
	if (basicAnalysis.state !== "unavailable") basicRetention.current = { key: basicRetentionKey, analysis: basicAnalysis };
	const basicInputsRefreshing = (previewQuery.isFetching || previewRefreshing || assessmentQuery.isFetching || profileQuery.isFetching) &&
		(!previewQuery.isError || previewRefreshing) && !assessmentQuery.isError && !profileQuery.isError;
	const retainedBasic = basicAnalysis.state === "unavailable" && basicInputsRefreshing && basicRetention.current?.key === basicRetentionKey
		? basicRetention.current.analysis : null;
	const shownBasic = basicAnalysis.state !== "unavailable" ? basicAnalysis : retainedBasic;
	// A cached preview read again on return is not a failure: no reload instruction until a read ends unusable.
	const basicChecksLoading = shownBasic === null &&
		(previewQuery.isPending || profileQuery.isPending || assessmentQuery.isPending || basicInputsRefreshing);
	const retryBasicChecks = () => {
		if (!profileReady) void profileQuery.refetch();
		else if (!assessmentReady) void assessmentQuery.refetch();
		else retryPreview();
	};


	if ([settingsQuery.error, assessmentQuery.error, profileQuery.error, storedScoreQuery.error, previewQuery.error].some(isPermissionDenied)) return (
		<div className="shipit-seo-native-panel-state" role="status">
			<strong>Advanced SEO details are not available</strong>
			<span>They need administrator access. EmDash's own SEO fields still save normally.</span>
		</div>
	);
	// Ownership does not depend on scoring, settings or the profile, so it stays visible in every state below.
	const ownershipNotice = ownershipResolution.notice.kind === "loading" || ownershipResolution.notice.kind === "permission-denied" ? null : (
		<details className="shipit-seo-analysis-details shipit-seo-analysis-details--ownership">
			<summary>Metadata ownership</summary>
			<SavedOwnershipNotice notice={ownershipResolution.notice} published={entry.status === "published"} />
		</details>
	);
	const profileRequired = assessmentSelection?.state === "unconfigured";
	const profileUnavailable = assessmentQuery.isError || assessmentSelection?.state === "unavailable";
	const assessmentControl = <AssessmentProfileControl key={collection} collection={collection}
		disabled={savedAnalysis.isPending || refresh.isPending} onDraftChange={setAssessmentDirty}
		onChanged={() => { savedReadback.invalidate(); sessionAnalysis.invalidate(); }} />;
	// A failed background refresh keeps the last confirmed settings and children.
	const refreshFailure = settingsQuery.isError
		? { label: "SEO settings could not be refreshed. Showing the settings loaded earlier.", retry: () => void settingsQuery.refetch() }
		: profileQuery.isError
			? { label: "Analysis settings could not be refreshed. Showing the settings loaded earlier.", retry: () => void profileQuery.refetch() }
			: null;
	const refreshAlert = refreshFailure ? (
		<div className="shipit-seo-native-panel-state" role="alert">
			<span>{refreshFailure.label}</span>
			<Button size="sm" variant="secondary" onClick={refreshFailure.retry}>Retry</Button>
		</div>
	) : null;

	// Chips show what actually drives analysis; `inherited` marks a content
	// fallback the user has not saved. Any keyword-list edit first materialises
	// the visible list as the explicit draft ("what you see is what you save").
	const keywordOwnership = basicKeywordOwnership ?? {
		display: keywordStatement === null ? [] : normaliseKeywordChips(keywordStatement), inherited: false,
	};
	const displayKeywords = keywordOwnership.display;
	const keywordDirty =
		!keywordStatementsMatch(keywordDraft, keywordBaseline) || pillarDraft !== pillarBaseline;
	const keywordSaveState = deriveProfileSaveState({
		dirty: keywordDirty,
		inFlight: keywordSave.isPending,
		failure: keywordSave.isError ? classifyProfileSaveFailure(keywordSave.error) : null,
		recentlySaved: keywordSavedFlash,
	});
	const analysisTargetReady = Boolean(entry.id && savedVersion && (locale == null || locale === entryLocale));
	const manualState = editorManualAnalysisState({
		settingsReady: settingsQuery.isFetchedAfterMount && settingsQuery.isSuccess && !settingsQuery.isFetching &&
			!settingsQuery.isError && settingsQuery.data?.values != null && scoringPolicy !== undefined && scoringPolicy.state !== "unavailable",
		assessmentReady, assessmentConfigured, assessmentDirty, profileReady,
		keywordDirty, keywordSaving: keywordSave.isPending || keywordWritesPending > 0, keywordUnconfirmed: keywordWriteUnconfirmed,
		savedTargetReady: analysisTargetReady,
	});
	const manualSavedAnalysisAdmitted = manualState.admitted;
	// A disabled button cannot take focus to announce why, so a reason the editor must act on is also shown.
	const analysisBlockedReason = !manualSavedAnalysisAdmitted && (assessmentDirty || !analysisTargetReady) ? manualState.detail : null;
	const analysisHelp = manualState.detail ?? "Save a result for the saved content and keywords. Unsaved page edits are not included.";
	// This action never activates the session controller or automatic analysis.
	const savedActionElement = (<>
		<Button
			data-keep-mobile-sidebar-open
			size="sm"
			variant="secondary"
			title={analysisHelp}
			aria-describedby={analysisHelpId}
			disabled={savedAnalysis.isPending || refresh.isPending || !manualSavedAnalysisAdmitted}
			onClick={() => { if (manualSavedAnalysisAdmitted && keywordWrites.current.size === 0) savedAnalysis.mutate({ epoch: savedAnalysisEpoch, locale: entryLocale, savedVersion, readbackToken: savedReadback.begin() }); }}
		>
			{savedAnalysis.isPending ? "Saving analysis..." : "Save analysis"}
		</Button>
		<span id={analysisHelpId} hidden>{analysisHelp}</span>
	</>);
	const keywordReloadElement = keywordWriteUnconfirmed && !keywordSave.isPending ? (
		<Button size="sm" variant="secondary" disabled={keywordWritesPending > 0} onClick={() => {
			if (keywordWrites.current.size > 0) return;
			const writeEpoch = keywordWriteEpoch.current;
			void profileQuery.refetch().then((result) => {
				if (!result.isError && result.data && keywordWrites.current.size === 0 && writeEpoch === keywordWriteEpoch.current) setKeywordWriteUnconfirmed(false);
			});
		}}>Reload saved keywords</Button>
	) : null;
	const savedActionNotice = savedNoticeElement || keywordReloadElement || analysisBlockedReason ? (
		<div className="shipit-seo-analysis-action">
			{analysisBlockedReason ? <p className="shipit-seo-analysis-action__reason">{analysisBlockedReason}</p> : null}
			{savedNoticeElement}
			{keywordReloadElement}
		</div>
	) : null;
	const panelState = editorScoreStateCopy({ scoringEnabled, scoringUnknown, storedUnavailable: storedScoreQuery.isError,
		settingsUnavailable: settingsQuery.isError || (!settingsQuery.isPending && (settingsQuery.data?.values == null || scoringPolicy === undefined || scoringPolicy.state === "unavailable")),
		profileRequired, profileUnavailable, profileLoading: !assessmentReady && !profileUnavailable });
	const unavailableAnalysis = !score || !assessmentConfigured ? (<>
		<div className="shipit-seo-native-panel-state shipit-seo-native-panel-state--availability" role="status">
			<strong>{panelState.heading}</strong>
			<span>{panelState.detail}</span>
			{scoringUnknown || settingsQuery.isError ? (
				<Button size="sm" variant="secondary" onClick={() => void settingsQuery.refetch()}>Retry settings</Button>
			) : null}
		</div>
		{storedHistory(!assessmentConfigured
			? "This historical result is not verified against a selected assessment profile."
			: "This is the last stored result. Choose Save analysis to confirm this version.")}
		{storedScoreQuery.isError ? (
			<div className="shipit-seo-native-panel-state" role="alert">
				<span>The saved SEO score could not be loaded.</span>
				<Button size="sm" variant="secondary" onClick={() => void storedScoreQuery.refetch()}>Retry score</Button>
			</div>
		) : null}
		{sessionState.error && scoringEnabled ? <p role="alert">{sessionState.error}</p> : null}
	</>) : null;
	// Unsaved keyword or profile changes make a stored result describe other inputs than the ones shown.
	const shownScore = unavailableAnalysis ? null
		: score && (keywordDirty || keywordWriteUnconfirmed || assessmentDirty) ? { ...score, freshness: "stale" as const } : score;
	const retryKeywordSave = () => {
		if (!profileReady || profileQuery.isError) return;
		keywordAutosave.cancel();
		keywordSave.mutate({
			keywords: keywordDraftRef.current,
			pillar: pillarDraftRef.current,
		});
	};
	// Keyed by collection, so the profile form keeps its draft while sections and analysis states change.
	const analysisOptionsElement = (sessionCheck: React.ReactNode) => (
		<details key={"assessment:" + collection} className="shipit-seo-analysis-details shipit-seo-analysis-options" open={assessmentDisclosureOpen}
			onToggle={(event) => setAssessmentDisclosureOpen(event.currentTarget.open)}>
			<summary>Analysis options</summary>
			<section ref={assessmentControlRef} className="shipit-seo-analysis-options__section" tabIndex={-1} aria-label="Analysis settings">
				<h4>Analysis settings</h4>
				{assessmentControl}
			</section>
			<section className="shipit-seo-analysis-options__section">
				<h4>Saved analysis &amp; history</h4>
				{savedActionElement}
				<p className="shipit-seo-muted">{analysisHelp}</p>
				{unavailableAnalysis ?? storedHistory(shownScore && hasCurrentEditorAnalysis(shownScore) && shownScore.persistence !== "session"
					? "The checks above show this stored result."
					: "This is the last stored result. Browser checks above are separate and are not saved to history.")}
				<p className="shipit-seo-muted">Automatic analysis: {scoringEnabled ? "on" : scoringUnknown ? "unavailable" : "paused"}. <a href={`${SEO_WORKSPACE_URL}?view=modules`}>Manage automatic analysis</a></p>
			</section>
			{sessionCheck}
		</details>
	);
	const addKeyword = () => {
		const keyword = normaliseKeywordDraft(keywordInput);
		if (
			!keyword ||
			!seoKeywordIdentity(keyword) ||
			displayKeywords.length >= SEO_ADMIN_FOCUS_KEYWORD_MAX_COUNT ||
			displayKeywords.some((value) => seoKeywordIdentity(value) === seoKeywordIdentity(keyword))
		) {
			return;
		}
		keywordSave.reset();
		setKeywordDraft([...(keywordDraft ?? displayKeywords), keyword]);
		setKeywordInput("");
		setKeywordInput("");
	};

	return (
		<>
		{refreshAlert}
		<SeoAnalysisDisclosure
			key="editor-workflow"
			advancedNotice={ownershipNotice}
			keywordCoverageConfirmed={basicPreviewReady}
			keywordProfile={{
				status: profileQuery.isError ? "unavailable" : profileReady ? "ready" : "loading",
				known: profileInitialized.current || profileReady,
				onRetry: () => void profileQuery.refetch(),
			}}
			locale={previewLocale}
			score={shownScore}
			unavailableContent={unavailableAnalysis}
			basicAnalysis={shownBasic ?? undefined}
			analysisUpdating={retainedBasic !== null}
			analysisLoading={basicChecksLoading}
			localKeywordsPending={keywordDirty}
			onChooseCheckProfile={chooseCheckProfile}
			headerNotice={savedActionNotice}
			renderLocalAnalysis={(_onFix, checklist, sessionCheck) => (<>
				{checklist ?? (
					<div className="shipit-seo-native-panel-state shipit-seo-native-panel-state--availability" role="status">
						<strong>Basic SEO checks</strong>
						<span>{basicChecksLoading ? "Loading the saved content and settings..." : basicAnalysis.state === "unavailable" ? basicAnalysis.reason : null}</span>
						{previewQuery.isFetching || previewRefreshing || profileQuery.isFetching || assessmentQuery.isFetching ? null : (
							<Button type="button" size="sm" variant="secondary" icon={ArrowsClockwise} onClick={retryBasicChecks}>Retry checks</Button>
						)}
					</div>
				)}
				{analysisOptionsElement(sessionCheck)}
			</>)}
			preview={shownPreview.shown?.preview ?? null}
			savedEntry={entry}
			savedSnapshot={basicPreviewReady ? savedSnapshot : null}
			siteSettings={settingsQuery.data?.values ?? null}
			previewObservation={shownPreview.shown?.observation}
			previewLoading={previewQuery.isPending || previewRefreshing}
			previewError={(previewQuery.isError && !previewRefreshing) || (previewQuery.data?.success === true && !preview)}
			workspaceUrl={workspaceUrl}
			refreshing={refresh.isPending}
			sessionDisabled={savedAnalysis.isPending || !analysisAdmitted}
			refreshError={refresh.isError}
			refreshErrorMessage={sessionState.error ?? (profileRefreshFailed ? "Analysis settings could not be read again, so nothing shown here is current." : null)}
			storedOutOfDate={storedOutOfDate}
			keywordsValue={displayKeywords}
			keywordsInherited={keywordOwnership.inherited}
			keywordInputValue={keywordInput}
			keywordSaveState={keywordSaveState}
			onKeywordRetry={retryKeywordSave}
			pillar={profileInitialized.current ? pillarDraft : profileQuery.data?.profile?.pillar ?? false}
			onPillarChange={(value) => {
				keywordSave.reset();
				setPillarDraft(value);
			}}
			directives={directivesQuery.data ?? null}
			directivesLoading={directivesQuery.isFetching}
			directivesLoadError={directivesQuery.isError}
			directivesSaving={directivesSave.isPending}
			directivesError={directivesSave.isError}
			onDirectivesSave={(change) => directivesSave.mutate(change)}
			onDirectivesRetry={() => void directivesQuery.refetch()}
			onPreviewRetry={retryPreview}
			onRefresh={() => refresh.mutate()}
			onKeywordInputChange={(value) => {
				keywordSave.reset();
				setKeywordInput(value);
			}}
			onKeywordAdd={addKeyword}
			onKeywordRemove={(index) => {
				keywordSave.reset();
				// Removing the sole inherited chip materialises an EMPTY statement:
				// the clear persists and the content fallback stays suppressed.
				const base = keywordDraft ?? displayKeywords;
				setKeywordDraft(base.filter((_, itemIndex) => itemIndex !== index));
			}}
			onKeywordPromote={(index) => {
				keywordSave.reset();
				const base = keywordDraft ?? displayKeywords;
				const keyword = base[index];
				if (!keyword || index === 0) return;
				setKeywordDraft([keyword, ...base.filter((_, itemIndex) => itemIndex !== index)]);
			}}
			onSocialSave={(targetRef, values) => socialSave.mutateAsync({ ref: targetRef, values })}
			socialEditor={socialEditor}
			editorActions={actions}
			editorDraft={draft}
		/>
		</>
	);
}
